"""
rl_inference.py — PPO Inference Layer (Research-Quality)
=========================================================
Changes from v1:
  - policy_weight replaces q_value  (PPO is policy-gradient, not Q-learning)
  - Zero-allocation assets filtered from /ai/recommend response
  - market_data_timestamp added to every response
  - portfolio_summary: n_assets, sector_exposure
  - Weights-sum assertion after normalisation
  - Equal-weight fallback when PPO model not available
  - decision_reason in get_stock_features()
  - UNIVERSE_TO_YFINANCE reverse map for HDFC→HDFCBANK
  - PYTHONDONTWRITEBYTECODE=1 in Dockerfile removes stale .pyc issue
"""

import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd

from app.core.config import (
    MODELS_DIR,
    LIVE_PERIOD,
    YFINANCE_TO_UNIVERSE,
    UNIVERSE_TO_YFINANCE,
)

log = logging.getLogger(__name__)

MODEL_PATH = MODELS_DIR / "ppo_smartchange.zip"
VEC_PATH   = MODELS_DIR / "vecnormalize.pkl"
META_PATH  = MODELS_DIR / "model_meta.json"


# ── Lazy singletons ───────────────────────────────────────────────────────────
_model        = None
_vec_env      = None
_model_meta   = None
_symbols      = []
_rl_available = False


def _try_load_model():
    global _model, _vec_env, _model_meta, _symbols, _rl_available
    if _rl_available:
        return

    if not MODEL_PATH.exists() or not VEC_PATH.exists():
        log.warning("PPO model not found — equal-weight fallback will be used.")
        return

    try:
        from stable_baselines3 import PPO
        from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv
        from app.ai.rl_env import PortfolioEnv

        meta        = json.loads(META_PATH.read_text()) if META_PATH.exists() else {}
        _model_meta = meta
        symbols     = meta.get("symbols", [])
        n_stocks    = meta.get("n_stocks", len(symbols))
        _symbols    = symbols

        dummy_prices = pd.DataFrame(np.ones((60, n_stocks)) * 1000.0, columns=symbols)

        def _env_factory(dp=dummy_prices):
            return PortfolioEnv(dp)

        dummy_vec = DummyVecEnv([_env_factory])
        vec_env   = VecNormalize.load(str(VEC_PATH), dummy_vec)
        vec_env.training    = False
        vec_env.norm_reward = False

        _vec_env      = vec_env
        _model        = PPO.load(str(MODEL_PATH), env=vec_env)
        _rl_available = True
        log.info(f"✅ PPO model loaded. Symbols: {symbols}")

    except Exception as e:
        log.error(f"Failed to load PPO model: {e}", exc_info=True)
        _rl_available = False


# ── Technical helpers ─────────────────────────────────────────────────────────
def _rsi_norm(series: pd.Series, period: int = 14) -> float:
    delta = series.diff()
    gain  = delta.clip(lower=0).rolling(period).mean().iloc[-1]
    loss  = (-delta.clip(upper=0)).rolling(period).mean().iloc[-1] + 1e-8
    return float(1.0 / (1.0 + gain / loss))


def _build_obs(closes: pd.DataFrame, symbols: list) -> np.ndarray:
    available = [s for s in symbols if s in closes.columns]
    closes    = closes[available]
    n         = len(available)
    feats     = []
    for col in closes.columns:
        s = closes[col]
        log_ret  = float(np.log(s.iloc[-1] / (s.iloc[-2] + 1e-8) + 1e-8))
        sma14_s  = s.rolling(14).mean().dropna()
        sma14    = float(sma14_s.iloc[-1]) if len(sma14_s) else float(s.mean())
        sma_min  = float(sma14_s.min() + 1e-8) if len(sma14_s) else 1e-8
        sma_max  = float(sma14_s.max() + 1e-8) if len(sma14_s) else 1.0
        vol14_s  = s.rolling(14).std().dropna()
        vol14    = float(vol14_s.iloc[-1]) if len(vol14_s) else 0.0
        vol_max  = float(vol14_s.max() + 1e-8) if len(vol14_s) else 1.0
        feats.extend([
            log_ret,
            (sma14 - sma_min) / (sma_max - sma_min + 1e-8),
            vol14 / (vol_max + 1e-8),
            _rsi_norm(s),
            float(s.pct_change(5).iloc[-1]) if len(s) > 5 else 0.0,
            1.0 / n,
        ])
    feats.append(1.0)
    return np.array(feats, dtype=np.float32)


def _decision_reason(log_ret: float, sma_norm: float, vol_norm: float,
                     rsi_norm: float, mom5: float, policy_weight: float) -> str:
    """Generate a human-readable reason for the PPO allocation decision."""
    reasons = []

    # Momentum signal
    if mom5 < -0.02:
        reasons.append(f"negative 5-day momentum ({mom5*100:.1f}%)")
    elif mom5 > 0.02:
        reasons.append(f"positive 5-day momentum (+{mom5*100:.1f}%)")

    # Volatility
    if vol_norm > 0.75:
        reasons.append(f"high short-term volatility ({vol_norm:.2f} normalised)")
    elif vol_norm < 0.30:
        reasons.append(f"low volatility environment ({vol_norm:.2f} normalised)")

    # RSI (lower = oversold = more attractive to PPO)
    if rsi_norm < 0.40:
        reasons.append("oversold RSI (potential reversal signal)")
    elif rsi_norm > 0.65:
        reasons.append("overbought RSI (cautious signal)")

    # Trend (SMA norm)
    if sma_norm > 0.70:
        reasons.append("price trending near 14-day SMA peak")
    elif sma_norm < 0.30:
        reasons.append("price near 14-day SMA trough")

    if not reasons:
        reasons.append("neutral market conditions across all features")

    alloc_desc = (
        f"high allocation ({policy_weight*100:.1f}%)" if policy_weight > 0.25
        else f"moderate allocation ({policy_weight*100:.1f}%)" if policy_weight > 0.10
        else f"low allocation ({policy_weight*100:.1f}%)"
    )
    return f"PPO assigns {alloc_desc} — driven by: {'; '.join(reasons)}."


# ── Equal-weight fallback ─────────────────────────────────────────────────────
def _equal_weight_fallback(amount: float, top_n: int) -> dict:
    from app.routers.portfolio import STOCK_UNIVERSE
    symbols = list(STOCK_UNIVERSE.keys())[:top_n]
    w       = 1.0 / len(symbols)
    ts      = datetime.now(timezone.utc).isoformat()
    recs    = []
    for i, sym in enumerate(symbols):
        info = STOCK_UNIVERSE[sym]
        recs.append({
            "rank":             i + 1,
            "stock_symbol":     UNIVERSE_TO_YFINANCE.get(sym, sym),
            "stock_name":       info["name"],
            "sector":           info.get("sector", "N/A"),
            "current_price":    info["price"],
            "allocation_pct":   round(w * 100, 2),
            "suggested_amount": round(amount * w, 2),
            "policy_weight":    round(w, 4),
            "rationale":        f"Equal-weight fallback: 1/{len(symbols)} allocation.",
            "explanation":      {"method": "Equal-Weight (PPO not available)", "note": "Train the model at /ai/model-info"},
        })
    return {
        "model":               "Equal-Weight (PPO model not available)",
        "explanation_method":  "1/N uniform allocation",
        "market_data_timestamp": ts,
        "portfolio_summary":   {
            "n_assets": len(symbols),
            "sector_exposure": {info["sector"]: 1 for s in symbols
                                for info in [STOCK_UNIVERSE[s]] if "sector" in info},
        },
        "recommendations": recs,
    }


# ── /ai/recommend ─────────────────────────────────────────────────────────────
def get_recommendations(amount: float, top_n: int = 4) -> dict:
    """
    Returns PPO portfolio recommendations.
    Falls back to equal-weight if PPO model is unavailable.
    """
    _try_load_model()

    if not _rl_available:
        return _equal_weight_fallback(amount, top_n)

    import yfinance as yf
    from app.routers.portfolio import STOCK_UNIVERSE

    meta    = _model_meta or {}
    symbols = _symbols
    tickers = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

    raw       = yf.download(tickers, period=LIVE_PERIOD, auto_adjust=True, progress=False)
    raw_close = raw["Close"] if "Close" in raw.columns else raw
    raw_close.columns = [c.replace(".NS", "") for c in raw_close.columns]
    raw_close = raw_close.ffill().dropna()

    timestamp = datetime.now(timezone.utc).isoformat()

    obs        = _build_obs(raw_close, symbols)
    obs_normed = _vec_env.normalize_obs(obs.reshape(1, -1))

    action, _ = _model.predict(obs_normed, deterministic=True)
    action     = action.flatten()
    log.info(f"PPO raw action: min={action.min():.4f} max={action.max():.4f}")

    weights = np.clip(action, 0.0, None)
    w_sum   = weights.sum()
    if w_sum < 1e-6:
        log.warning("All PPO weights zero — using uniform allocation.")
        weights = np.ones(len(symbols)) / len(symbols)
    else:
        weights = weights / w_sum

    # ── Weights-sum validation ────────────────────────────────────────────
    assert abs(weights.sum() - 1.0) < 1e-4, f"Weights sum to {weights.sum():.6f}, not 1."

    # ── Over-concentration check ────────────────────────────────────────────
    max_weight       = float(weights.max())
    max_weight_sym   = symbols[int(weights.argmax())]
    concentration_ok = max_weight <= 0.60
    if not concentration_ok:
        log.warning(
            f"⚠️  PPO allocation concentration detected: "
            f"{max_weight_sym} = {max_weight*100:.1f}% > 60%. "
            f"Consider retraining with more timesteps or higher entropy coef."
        )

    ranked_idx  = np.argsort(weights)[::-1][:top_n]
    top_weights = weights[ranked_idx]
    top_weights = top_weights / (top_weights.sum() + 1e-8)   # re-normalise top-N

    recs = []
    sector_exposure: dict[str, int] = {}

    for rank, idx in enumerate(ranked_idx):
        sym  = symbols[idx]
        alloc = float(top_weights[rank])

        # ── Filter zero-allocation assets ─────────────────────────────────────
        if alloc < 1e-4:
            continue

        amt       = round(amount * alloc, 2)
        univ_key  = YFINANCE_TO_UNIVERSE.get(sym, sym)
        info      = STOCK_UNIVERSE.get(univ_key, {"name": sym, "sector": "N/A", "price": 0.0})
        sector    = info.get("sector", "N/A")
        pw        = round(float(weights[idx]), 4)

        sector_exposure[sector] = sector_exposure.get(sector, 0) + 1

        recs.append({
            "rank":             rank + 1,
            "stock_symbol":     sym,                        # yfinance canonical name
            "stock_name":       info.get("name", sym),
            "sector":           sector,
            "current_price":    info.get("price", 0.0),
            "allocation_pct":   round(alloc * 100, 2),
            "suggested_amount": amt,
            "policy_weight":    pw,                          # renamed from q_value
            "rationale": (
                f"PPO allocates {alloc*100:.1f}% to {sym} based on "
                f"live log-returns, RSI, SMA-14, and momentum features."
            ),
            "explanation": {
                "method":        "PPO MlpPolicy (deterministic=True)",
                "policy_weight": pw,
                "note":          "Use /ai/explain/{symbol} for live feature breakdown.",
            },
        })

    return {
        "model":               "PPO (Stable-Baselines3)",
        "explanation_method":  "RL Policy Network (deterministic=True)",
        "trained_at":          meta.get("trained_at", "unknown"),
        "timesteps":           meta.get("timesteps", 0),
        "market_data_timestamp": timestamp,
        "portfolio_summary": {
            "n_assets":            len(recs),
            "sector_exposure":     sector_exposure,
            "max_allocation_pct":  round(max_weight * 100, 2),
            "concentration_warning": (
                f"{max_weight_sym} allocated {max_weight*100:.1f}% — exceeds 60% threshold."
                if not concentration_ok else None
            ),
        },
        "recommendations": recs,
    }


# ── /ai/explain ───────────────────────────────────────────────────────────────
def get_stock_features(symbol: str) -> dict:
    """
    Live PPO feature breakdown for a single stock.
    symbol: yfinance base name (e.g. HDFCBANK) or STOCK_UNIVERSE key (e.g. HDFC).
    """
    _try_load_model()

    import yfinance as yf

    yfin_base = UNIVERSE_TO_YFINANCE.get(symbol, symbol)   # HDFC→HDFCBANK
    yfin_sym  = yfin_base if yfin_base.endswith(".NS") else yfin_base + ".NS"
    df = yf.download(yfin_sym, period=LIVE_PERIOD, auto_adjust=True, progress=False)
    if df.empty:
        return {}

    s = df["Close"].squeeze().ffill().dropna()

    log_ret  = float(np.log(s.iloc[-1] / (s.iloc[-2] + 1e-8) + 1e-8))
    sma14_s  = s.rolling(14).mean().dropna()
    sma14    = float(sma14_s.iloc[-1])
    sma_min  = float(sma14_s.min() + 1e-8)
    sma_max  = float(sma14_s.max() + 1e-8)
    sma_norm = float((sma14 - sma_min) / (sma_max - sma_min + 1e-8))
    vol14_s  = s.rolling(14).std().dropna()
    vol14    = float(vol14_s.iloc[-1])
    vol_max  = float(vol14_s.max() + 1e-8)
    vol_norm = float(vol14 / (vol_max + 1e-8))
    rsi_n    = _rsi_norm(s)
    mom5     = float(s.pct_change(5).iloc[-1]) if len(s) > 5 else 0.0

    # PPO allocation weight for this stock
    policy_weight = None
    if _rl_available and yfin_base in _symbols:
        idx  = _symbols.index(yfin_base)
        ticks = [s2 if s2.endswith(".NS") else s2 + ".NS" for s2 in _symbols]
        raw   = yf.download(ticks, period=LIVE_PERIOD, auto_adjust=True, progress=False)
        cls   = raw["Close"] if "Close" in raw.columns else raw
        cls.columns = [c.replace(".NS", "") for c in cls.columns]
        cls   = cls.ffill().dropna()
        obs_n = _vec_env.normalize_obs(_build_obs(cls, _symbols).reshape(1, -1))
        action, _ = _model.predict(obs_n, deterministic=True)
        w     = np.clip(action.flatten(), 0, None)
        w     = w / (w.sum() + 1e-8)
        policy_weight = round(float(w[idx]), 6)

    reason = _decision_reason(log_ret, sma_norm, vol_norm, rsi_n, mom5,
                               policy_weight or 0.0)

    return {
        "canonical_symbol":  yfin_base,       # always the yfinance name
        "log_return":        round(log_ret, 6),
        "sma14":             round(sma14, 2),
        "sma_norm":          round(sma_norm, 4),
        "volatility14":      round(vol14, 4),
        "vol_norm":          round(vol_norm, 4),
        "rsi_norm":          round(rsi_n, 4),
        "momentum_5d":       round(mom5, 4),
        "policy_weight":     policy_weight,
        "decision_reason":   reason,
        "close_price":       round(float(s.iloc[-1]), 2),
        "note": (
            "Features derived from live yfinance data using the same "
            "normalisation pipeline as the PPO training environment."
        ),
    }
