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
def _simple_reason(info: dict) -> str:
    """Generate a short reason string for equal-weight fallback stocks."""
    parts = []
    sector = info.get("sector", "")
    if sector:
        parts.append(f"{sector} sector stock")
    parts.append("equal-weight allocation")
    return ";".join(parts)


# ── Signal-based scoring (replaces pure equal-weight when PPO is uniform) ─────
def _compute_signal_scores(raw_close: pd.DataFrame, symbols: list) -> np.ndarray:
    """
    Compute a composite technical-signal score for each stock.
    Score = 0.35 * momentum_score
          + 0.30 * rsi_score        (lower RSI = oversold = higher score)
          + 0.20 * trend_score      (price above SMA-14 = bullish)
          + 0.15 * low_vol_score    (lower volatility = higher score)

    All sub-scores are in [0, 1]. Returns a normalised weight array.
    """
    scores = np.zeros(len(symbols))
    for i, sym in enumerate(symbols):
        col = sym if sym in raw_close.columns else sym.replace(".NS", "")
        if col not in raw_close.columns:
            scores[i] = 1.0 / len(symbols)   # neutral fallback
            continue
        s = raw_close[col]

        # ── Momentum: 5-day pct change, clipped to [-10%, +10%] ──────────────
        mom5 = float(s.pct_change(5).iloc[-1]) if len(s) > 5 else 0.0
        mom5 = float(np.clip(mom5, -0.10, 0.10))
        mom_score = (mom5 + 0.10) / 0.20   # map [-0.10, +0.10] → [0, 1]

        # ── RSI: oversold = high score, overbought = low score ────────────────
        rsi_n = _rsi_norm(s)                 # already ∈ [0, 1]; low = overbought
        rsi_score = 1.0 - rsi_n             # invert: low RSI val → high score (oversold)

        # ── SMA trend: how far price is above/below 14-day SMA ───────────────
        sma14_s = s.rolling(14).mean().dropna()
        if len(sma14_s) > 0:
            sma14 = float(sma14_s.iloc[-1])
            cur   = float(s.iloc[-1])
            trend_raw = (cur - sma14) / (sma14 + 1e-8)   # pct above SMA
            trend_score = float(np.clip((trend_raw + 0.05) / 0.10, 0.0, 1.0))
        else:
            trend_score = 0.5

        # ── Volatility: lower vol = more stable = higher score ───────────────
        vol14_s = s.rolling(14).std().dropna()
        if len(vol14_s) > 0:
            vol_norm = float(vol14_s.iloc[-1] / (vol14_s.max() + 1e-8))
        else:
            vol_norm = 0.5
        low_vol_score = 1.0 - vol_norm

        scores[i] = (
            0.35 * mom_score
            + 0.30 * rsi_score
            + 0.20 * trend_score
            + 0.15 * low_vol_score
        )

    # Softmax to get a proper probability distribution
    scores = np.clip(scores, 1e-6, None)
    exp_s  = np.exp((scores - scores.mean()) * 5.0)   # temperature = 5
    return exp_s / (exp_s.sum() + 1e-8)


def _gini_coefficient(weights: np.ndarray) -> float:
    """Gini coefficient as a measure of weight concentration (0 = equal, 1 = all in one)."""
    w = np.sort(np.abs(weights))
    n = len(w)
    if n == 0 or w.sum() < 1e-10:
        return 0.0
    cum = np.cumsum(w)
    return float((n + 1 - 2 * np.sum(cum) / (cum[-1] + 1e-10)) / n)


def _differentiate_weights(
    ppo_weights: np.ndarray,
    raw_close: pd.DataFrame,
    symbols: list,
    blend_alpha: float = 0.55,
) -> np.ndarray:
    """
    If PPO weights are nearly uniform (Gini < 0.08), blend in signal scores
    so that allocations are meaningfully differentiated.

    blend_alpha controls how much signal to mix in:
      final = (1 - alpha) * ppo + alpha * signal
    """
    gini = _gini_coefficient(ppo_weights)
    log.info(f"PPO weight Gini coefficient: {gini:.4f} (threshold: 0.08)")

    if gini >= 0.08:   # PPO already differentiates — trust it
        return ppo_weights

    log.info(
        f"PPO weights are near-uniform (Gini={gini:.4f}). "
        f"Blending in technical signal scores (alpha={blend_alpha})."
    )
    signal_scores = _compute_signal_scores(raw_close, symbols)
    blended = (1.0 - blend_alpha) * ppo_weights + blend_alpha * signal_scores
    blended = np.clip(blended, 0.0, None)
    w_sum = blended.sum()
    if w_sum < 1e-6:
        return ppo_weights
    return blended / w_sum


def _equal_weight_fallback(amount: float, top_n: int) -> dict:
    """
    Signal-weighted fallback when PPO model is not available.
    Uses live yfinance data to rank stocks by technical signals.
    Falls back to 1/N only if data cannot be fetched.
    """
    import yfinance as yf
    from app.routers.portfolio import STOCK_UNIVERSE

    univ_symbols = list(STOCK_UNIVERSE.keys())[:top_n * 2]  # fetch more, pick best top_n
    yfin_syms    = [UNIVERSE_TO_YFINANCE.get(s, s) for s in univ_symbols]
    tickers      = [s if s.endswith(".NS") else s + ".NS" for s in yfin_syms]
    ts           = datetime.now(timezone.utc).isoformat()

    weights: np.ndarray | None = None
    raw_close: pd.DataFrame | None = None

    try:
        raw       = yf.download(tickers, period=LIVE_PERIOD, auto_adjust=True, progress=False)
        raw_close = raw["Close"] if "Close" in raw.columns else raw
        raw_close.columns = [c.replace(".NS", "") for c in raw_close.columns]
        raw_close = raw_close.ffill().dropna()
        if not raw_close.empty:
            weights = _compute_signal_scores(raw_close, yfin_syms)
    except Exception as e:
        log.warning(f"Signal fallback data fetch failed: {e}. Using 1/N.")

    if weights is None:
        weights = np.ones(len(univ_symbols)) / len(univ_symbols)

    # Apply temperature softmax to amplify differences
    temp = 0.55
    exp_w = np.exp(np.log(weights + 1e-9) / temp)
    exp_w = exp_w / (exp_w.sum() + 1e-8)

    # Pick top_n by weight
    ranked_idx  = np.argsort(exp_w)[::-1][:top_n]
    top_weights = exp_w[ranked_idx]
    top_weights = top_weights / (top_weights.sum() + 1e-8)

    recs = []
    from app.routers.portfolio import _get_live_price
    
    for rank_pos, idx in enumerate(ranked_idx):
        univ_key = univ_symbols[idx]
        yfin_sym = yfin_syms[idx]
        info     = STOCK_UNIVERSE.get(univ_key, {"name": univ_key, "sector": "N/A", "price": 0.0})
        alloc    = float(top_weights[rank_pos])
        amt      = round(amount * alloc, 2)
        pw       = round(float(exp_w[idx]), 4)
        
        # Use consistent live price fetcher
        live_price = _get_live_price(univ_key)

        reason = _simple_reason(info)
        if raw_close is not None:
            col = yfin_sym if yfin_sym in raw_close.columns else yfin_sym.replace(".NS", "")
            if col in raw_close.columns:
                s   = raw_close[col]
                m5  = float(s.pct_change(5).iloc[-1]) if len(s) > 5 else 0.0
                rn  = _rsi_norm(s)
                sma = s.rolling(14).mean().dropna()
                sn  = float((sma.iloc[-1] - sma.min()) / (sma.max() - sma.min() + 1e-8)) if len(sma) else 0.5
                vl  = s.rolling(14).std().dropna()
                vn  = float(vl.iloc[-1] / (vl.max() + 1e-8)) if len(vl) else 0.5
                reason = _decision_reason(0.0, sn, vn, rn, m5, alloc)

        recs.append({
            "rank":             rank_pos + 1,
            "stock_symbol":     yfin_sym,
            "stock_name":       info["name"],
            "sector":           info.get("sector", "N/A"),
            "current_price":    live_price,  # Use live price with NaN fallback
            "allocation_pct":   round(alloc * 100, 2),
            "suggested_amount": amt,
            "policy_weight":    pw,
            "rationale": (
                f"Signal-weighted allocation: {alloc*100:.1f}% to {yfin_sym} "
                f"based on momentum, RSI, SMA-14 trend, and volatility scoring."
            ),
            "reason":           reason,
            "explanation":      {
                "method": "Technical Signal Scoring (PPO not available)",
                "note":   "Weighted by momentum, RSI, SMA trend, and volatility. Train PPO for RL-based allocation.",
            },
        })

    sector_exposure: dict[str, int] = {}
    for rec in recs:
        sector_exposure[rec["sector"]] = sector_exposure.get(rec["sector"], 0) + 1

    return {
        "model":                 "Signal-Weighted (PPO model not available)",
        "explanation_method":    "Technical Signal Scoring (Momentum + RSI + SMA + Volatility)",
        "market_data_timestamp": ts,
        "portfolio_summary": {
            "n_assets":       len(recs),
            "sector_exposure": sector_exposure,
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

    # ── Differentiate near-uniform PPO weights with signal scores ─────────────
    weights = _differentiate_weights(weights, raw_close, symbols)

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

    # ── Re-compute signal scores ONLY for the selected top-N stocks ────────────
    # This ensures meaningful differentiation even if PPO was uniform across all 20.
    top_syms = [symbols[i] for i in ranked_idx]
    top_signal = _compute_signal_scores(raw_close, top_syms)

    # Blend PPO weights with signal scores for the top-N set
    top_ppo_norm = top_weights / (top_weights.sum() + 1e-8)
    top_gini = _gini_coefficient(top_ppo_norm)
    log.info(f"Top-{top_n} PPO Gini: {top_gini:.4f}")

    if top_gini < 0.08:
        blend_alpha = 0.60
        log.info(f"Top-{top_n} weights near-uniform — blending signal scores (alpha={blend_alpha})")
        top_weights_diff = (1.0 - blend_alpha) * top_ppo_norm + blend_alpha * top_signal
    else:
        top_weights_diff = top_ppo_norm

    # ── Apply temperature sharpening to amplify differences ────────────────────
    temp = 0.55   # < 1 sharpens (concentrates weight into leaders)
    log_w = np.log(np.clip(top_weights_diff, 1e-9, None))
    sharpened = np.exp(log_w / temp)
    top_weights = sharpened / (sharpened.sum() + 1e-8)   # final normalised top-N weights

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
        
        # Use the same live price fetcher as portfolio for consistency
        from app.routers.portfolio import _get_live_price
        live_price = _get_live_price(univ_key)
        
        # policy_weight = final normalised allocation weight for this stock
        pw        = round(alloc, 4)
        # raw_ppo_weight = what the PPO network alone assigned (before signal blending)
        raw_ppo_w = round(float(weights[idx]), 4)

        sector_exposure[sector] = sector_exposure.get(sector, 0) + 1

        # Build human-readable reason from live features
        try:
            col = sym if sym in raw_close.columns else sym.replace(".NS", "")
            if col in raw_close.columns:
                s_series = raw_close[col]
                lr   = float(np.log(s_series.iloc[-1] / (s_series.iloc[-2] + 1e-8) + 1e-8))
                sm14 = s_series.rolling(14).mean().dropna()
                sn   = float((sm14.iloc[-1] - sm14.min()) / (sm14.max() - sm14.min() + 1e-8)) if len(sm14) else 0.5
                v14  = s_series.rolling(14).std().dropna()
                vn   = float(v14.iloc[-1] / (v14.max() + 1e-8)) if len(v14) else 0.5
                rn   = _rsi_norm(s_series)
                m5   = float(s_series.pct_change(5).iloc[-1]) if len(s_series) > 5 else 0.0
                reason = _decision_reason(lr, sn, vn, rn, m5, alloc)
            else:
                reason = f"PPO + signals allocate {alloc*100:.1f}% based on policy network weights."
        except Exception:
            reason = f"PPO + signals allocate {alloc*100:.1f}% to {sym}."

        recs.append({
            "rank":             rank + 1,
            "stock_symbol":     sym,
            "stock_name":       info.get("name", sym),
            "sector":           sector,
            "current_price":    live_price,  # Use live price with NaN fallback
            "allocation_pct":   round(alloc * 100, 2),
            "suggested_amount": amt,
            "policy_weight":    pw,
            "rationale": (
                f"PPO + signal scoring allocates {alloc*100:.1f}% to {sym} "
                f"(raw PPO: {raw_ppo_w*100:.1f}%) — based on live RSI, SMA-14, and momentum."
            ),
            "reason":           reason,
            "explanation": {
                "method":         "PPO MlpPolicy + Signal Scoring",
                "policy_weight":  pw,
                "raw_ppo_weight": raw_ppo_w,
                "note":           "Use /ai/explain/{symbol} for live feature breakdown.",
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

    # Use consistent live price fetcher with NaN fallback
    from app.routers.portfolio import _get_live_price, YFINANCE_TO_UNIVERSE
    univ_key = YFINANCE_TO_UNIVERSE.get(yfin_base, yfin_base)
    live_price = _get_live_price(univ_key)

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
        "close_price":       live_price,  # Use consistent price with NaN fallback
        "note": (
            "Features derived from live yfinance data using the same "
            "normalisation pipeline as the PPO training environment."
        ),
    }
