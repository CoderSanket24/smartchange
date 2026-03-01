"""
rl_inference.py — FastAPI Inference Layer for the PPO RL Agent
==============================================================
Fixes applied:
  - BUG 1: Obs now normalised via vec_env.normalize_obs() BEFORE model.predict()
  - BUG 2: yfinance columns reordered to match training symbol order
  - BUG 3: Uniform fallback when all weights are zero after clipping
  - BUG 4: STOCK_UNIVERSE lookup with correct symbol key
"""

import json
import logging
from pathlib import Path

import numpy as np
import pandas as pd

log = logging.getLogger(__name__)

MODELS_DIR  = Path(__file__).parent / "models"
MODEL_PATH  = MODELS_DIR / "ppo_smartchange.zip"
VEC_PATH    = MODELS_DIR / "vecnormalize.pkl"
META_PATH   = MODELS_DIR / "model_meta.json"
LIVE_PERIOD = "90d"

# yfinance strips ".NS" → may differ from STOCK_UNIVERSE keys
# e.g. yfinance gives "HDFCBANK", but STOCK_UNIVERSE has "HDFC"
YFINANCE_TO_UNIVERSE: dict[str, str] = {
    "HDFCBANK": "HDFC",
    "RELIANCE": "RELIANCE",
    "TCS":      "TCS",
    "INFY":     "INFY",
    "WIPRO":    "WIPRO",
    "ITC":      "ITC",
    "TATASTEEL":"TATASTEEL",
    "AXISBANK": "AXISBANK",
}
# ── Lazy singletons ───────────────────────────────────────────────────────────
_model        = None
_vec_env      = None   # ← kept globally so we can call .normalize_obs()
_model_meta   = None
_symbols      = []     # ← ordered symbol list from training
_rl_available = False


def _try_load_model():
    global _model, _vec_env, _model_meta, _symbols, _rl_available
    if not MODEL_PATH.exists() or not VEC_PATH.exists():
        log.warning("PPO model not found — using heuristic fallback.")
        _rl_available = False
        return

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv
        from app.ai.rl_env import PortfolioEnv

        meta      = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
        _model_meta = meta
        symbols   = meta.get("symbols", [])
        n_stocks  = meta.get("n_stocks", len(symbols))
        _symbols  = symbols

        # Dummy price_df just to satisfy PortfolioEnv constructor
        dummy_prices = pd.DataFrame(
            np.ones((60, n_stocks)) * 1000.0,
            columns=symbols,
        )

        dummy_vec = DummyVecEnv([lambda: PortfolioEnv(dummy_prices)])
        vec_env   = VecNormalize.load(str(VEC_PATH), dummy_vec)
        vec_env.training    = False    # ← freeze running mean/std
        vec_env.norm_reward = False

        _vec_env      = vec_env
        _model        = PPO.load(str(MODEL_PATH), env=vec_env)
        _rl_available = True
        log.info(f"✅ PPO model loaded. Symbols: {symbols}")

    except Exception as e:
        log.error(f"Failed to load PPO model: {e}. Falling back to heuristic.")
        _rl_available = False


# ── RSI helper ────────────────────────────────────────────────────────────────
def _rsi_norm(series: pd.Series, period: int = 14) -> float:
    """Returns RSI normalised to [0,1]."""
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean().iloc[-1]
    loss  = (-delta.clip(upper=0)).rolling(period).mean().iloc[-1] + 1e-8
    rs    = gain / loss
    return float(1.0 / (1.0 + rs))


# ── Observation builder (matches PortfolioEnv._get_obs exactly) ───────────────
def _build_obs(closes: pd.DataFrame, symbols: list) -> np.ndarray:
    """
    Build one observation vector matching the shape expected by the trained model.

    IMPORTANT: columns are reordered to match the training symbol order,
    because yfinance may return them alphabetically.
    """
    # ── Reorder columns to match training order exactly ───────────────────
    available = [s for s in symbols if s in closes.columns]
    closes    = closes[available]          # exact column order = training order

    n = len(available)
    feats = []
    for col in closes.columns:
        s = closes[col]

        log_ret  = float(np.log(s.iloc[-1] / (s.iloc[-2] + 1e-8) + 1e-8))

        sma14_series = s.rolling(14).mean().dropna()
        sma14 = float(sma14_series.iloc[-1]) if len(sma14_series) else float(s.mean())
        sma_min = float(sma14_series.min() + 1e-8) if len(sma14_series) else 1e-8
        sma_max = float(sma14_series.max() + 1e-8) if len(sma14_series) else 1.0
        sma_norm = (sma14 - sma_min) / (sma_max - sma_min + 1e-8)

        vol14_series = s.rolling(14).std().dropna()
        vol14    = float(vol14_series.iloc[-1]) if len(vol14_series) else 0.0
        vol_max  = float(vol14_series.max() + 1e-8) if len(vol14_series) else 1.0
        vol_norm = vol14 / (vol_max + 1e-8)

        rsi_norm = _rsi_norm(s)
        mom5     = float(s.pct_change(5).iloc[-1]) if len(s) > 5 else 0.0
        cur_w    = 1.0 / n

        feats.extend([log_ret, sma_norm, vol_norm, rsi_norm, mom5, cur_w])

    feats.append(1.0)  # portfolio_value_norm = 1.0 at inference time
    return np.array(feats, dtype=np.float32)


# ── Public API ────────────────────────────────────────────────────────────────
def get_recommendations(amount: float, top_n: int = 4) -> dict:
    """
    Returns stock recommendations using PPO model (with heuristic fallback).
    """
    if _model is None and not _rl_available:
        _try_load_model()

    if not _rl_available:
        from app.ai.rl_agent import agent
        recs = agent.recommend(top_n=top_n, amount=amount)
        return {
            "model":              "Heuristic (fallback — PPO not trained yet)",
            "explanation_method": "Weighted Feature Scoring",
            "recommendations":    recs,
        }

    try:
        import yfinance as yf
        meta    = _model_meta or {}
        symbols = _symbols
        tickers = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

        # ── Download live data ─────────────────────────────────────────────
        raw = yf.download(tickers, period=LIVE_PERIOD, auto_adjust=True, progress=False)
        raw_close = raw["Close"] if "Close" in raw.columns else raw
        raw_close.columns = [c.replace(".NS", "") for c in raw_close.columns]
        raw_close = raw_close.ffill().dropna()

        # ── Build observation (columns reordered to match training) ────────
        obs = _build_obs(raw_close, symbols)
        log.debug(f"Raw obs stats — min={obs.min():.4f}, max={obs.max():.4f}, mean={obs.mean():.4f}")

        # ── FIX: Normalise obs through VecNormalize BEFORE predict ─────────
        obs_batch  = obs.reshape(1, -1)
        obs_normed = _vec_env.normalize_obs(obs_batch)   # ← THE KEY FIX
        log.debug(f"Normed obs stats — min={obs_normed.min():.4f}, max={obs_normed.max():.4f}")

        action, _ = _model.predict(obs_normed, deterministic=True)
        action     = action.flatten()
        log.info(f"PPO raw action: min={action.min():.4f} max={action.max():.4f} sum={action.sum():.4f}")

        # ── Safe normalisation ─────────────────────────────────────────────
        weights = np.clip(action, 0.0, None)
        w_sum   = weights.sum()

        # ── Guard: if all weights are zero (degenerate policy), use uniform ─
        if w_sum < 1e-6:
            log.warning("All PPO weights are zero — using uniform allocation as fallback.")
            weights = np.ones(len(symbols), dtype=np.float64) / len(symbols)
        else:
            weights = weights / w_sum

        # ── Take top-N by weight ───────────────────────────────────────────
        ranked_idx  = np.argsort(weights)[::-1][:top_n]
        top_weights = weights[ranked_idx]
        top_weights = top_weights / (top_weights.sum() + 1e-8)

        # ── Build response ─────────────────────────────────────────────────
        from app.routers.portfolio import STOCK_UNIVERSE
        recs = []
        for rank, idx in enumerate(ranked_idx):
            sym   = symbols[idx]
            alloc = float(top_weights[rank])
            amt   = round(amount * alloc, 2)
            info  = STOCK_UNIVERSE.get(
                YFINANCE_TO_UNIVERSE.get(sym, sym),         # translate alias first
                STOCK_UNIVERSE.get(sym, {"name": sym, "sector": "N/A", "base_price": 0.0})
            )
            recs.append({
                "rank":             rank + 1,
                "stock_symbol":     sym,
                "stock_name":       info.get("name", sym),
                "sector":           info.get("sector", "N/A"),
                "current_price":    info.get("price", 0.0),          # ← portfolio.py uses "price" not "base_price"
                "allocation_pct":   round(alloc * 100, 2),
                "suggested_amount": amt,
                "q_value":          round(float(weights[idx]), 4),
                "rationale": (
                    f"PPO agent allocates {alloc*100:.1f}% to {sym} based on "
                    f"live log-returns, RSI, SMA-14, and momentum features."
                ),
                "explanation": {
                    "method":     "PPO MlpPolicy (deterministic=True)",
                    "raw_weight": round(float(weights[idx]), 6),
                    "note":       "Use /ai/explain/{symbol} for heuristic SHAP breakdown.",
                },
            })

        return {
            "model":              "PPO (Stable-Baselines3)",
            "explanation_method": "RL Policy Network (deterministic=True)",
            "trained_at":         meta.get("trained_at", "unknown"),
            "timesteps":          meta.get("timesteps", 0),
            "recommendations":    recs,
        }

    except Exception as e:
        log.error(f"PPO inference error: {e}", exc_info=True)
        from app.ai.rl_agent import agent
        recs = agent.recommend(top_n=top_n, amount=amount)
        return {
            "model":              f"Heuristic (PPO inference error: {str(e)[:80]})",
            "explanation_method": "Weighted Feature Scoring",
            "recommendations":    recs,
        }
