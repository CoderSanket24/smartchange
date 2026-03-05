"""
routers/ai.py — PPO AI Endpoints (Research-Quality)
=====================================================
All endpoints use the trained PPO model.
Falls back to equal-weight allocation when model is unavailable.
"""

import json
from pathlib import Path
from fastapi import APIRouter, Depends, Query, HTTPException
from app.models.user import User
from app.dependencies import get_current_user
from app.ai.rl_inference import get_recommendations, get_stock_features

router    = APIRouter(prefix="/ai", tags=["AI"])
MODELS_DIR = Path(__file__).parent.parent / "ai" / "models"

MODEL_VERSION = "ppo_v1.0"
DATASET_META  = {
    "source":    "Yahoo Finance (yfinance)",
    "period":    "2 years daily OHLCV",
    "frequency": "daily",
    "universe":  ["RELIANCE", "TCS", "INFY", "HDFCBANK", "WIPRO",
                  "ITC", "TATASTEEL", "AXISBANK"],
}


# ── /ai/recommend ─────────────────────────────────────────────────────────────
@router.get("/recommend")
def recommend(
    amount: float = Query(default=100.0, gt=0, description="Total ₹ to allocate"),
    top_n:  int   = Query(default=4, ge=1, le=8, description="Number of top stocks"),
    current_user: User = Depends(get_current_user),
):
    """
    PPO-based portfolio recommendations.
    Returns only actively allocated stocks (allocation_pct > 0).
    Falls back to equal-weight allocation if PPO model is unavailable.
    """
    result = get_recommendations(amount=amount, top_n=top_n)
    return {"user": current_user.username, "total_amount": amount, **result}


# ── /ai/explain/{symbol} ──────────────────────────────────────────────────────
@router.get("/explain/{stock_symbol}")
def explain_stock(
    stock_symbol: str,
    current_user: User = Depends(get_current_user),
):
    """
    Live PPO feature breakdown for a single stock.

    Returns the 5 input features the model actually receives, the model's
    current policy_weight (normalised allocation), and a human-readable
    decision_reason explaining the allocation level.

    Accepts both the STOCK_UNIVERSE key (HDFC) and the yfinance name (HDFCBANK).
    """
    from app.routers.portfolio import STOCK_UNIVERSE
    from app.ai.rl_inference import YFINANCE_TO_UNIVERSE, UNIVERSE_TO_YFINANCE
    import app.ai.rl_inference as rl_inf

    symbol   = stock_symbol.upper()
    # Accept both HDFC (universe) and HDFCBANK (yfinance); normalise to yfinance
    yfin_sym = UNIVERSE_TO_YFINANCE.get(symbol, symbol)
    univ_key = YFINANCE_TO_UNIVERSE.get(yfin_sym, yfin_sym)
    info     = STOCK_UNIVERSE.get(univ_key, None)

    if info is None:
        raise HTTPException(
            status_code=404,
            detail=f"'{symbol}' not in stock universe. "
                   f"Available: {list(STOCK_UNIVERSE.keys())}",
        )

    feats = get_stock_features(symbol)
    if not feats:
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch live market data for '{yfin_sym}' from yfinance.",
        )

    return {
        "stock_symbol":    yfin_sym,           # canonical yfinance name
        "universe_key":    univ_key,           # STOCK_UNIVERSE key
        "stock_name":      info["name"],
        "sector":          info.get("sector", "N/A"),
        "live_close":      feats["close_price"],
        "policy_weight":   feats["policy_weight"],
        "decision_reason": feats["decision_reason"],
        "features": {
            "log_return":   {
                "raw":  feats["log_return"],
                "desc": "Log price return since previous close (additive, stable)",
            },
            "sma14_norm":   {
                "raw":  feats["sma_norm"],
                "desc": "14-day SMA normalised to [0,1] over the 90-day window",
            },
            "volatility14": {
                "raw":  feats["vol_norm"],
                "desc": "14-day rolling std normalised by episode max",
            },
            "rsi14_norm":   {
                "raw":  feats["rsi_norm"],
                "desc": "RSI(14)/100 — lower = oversold (more attractive to PPO)",
            },
            "momentum5d":   {
                "raw":  feats["momentum_5d"],
                "desc": "5-day price percentage change",
            },
        },
        "note":  feats.get("note", ""),
        "model": "PPO (Stable-Baselines3)",
    }


# ── /ai/backtest ──────────────────────────────────────────────────────────────
@router.get("/backtest")
def get_backtest(current_user: User = Depends(get_current_user)):
    """
    PPO vs Equal-Weight vs NIFTY-50 backtest results (held-out test period).
    To regenerate: docker exec -it smartchange_backend python app/ai/rl_backtest.py
    """
    results_path = MODELS_DIR / "backtest_results.json"
    if not results_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Backtest results not found. "
                "Run: docker exec -it smartchange_backend python app/ai/rl_backtest.py"
            ),
        )
    return json.loads(results_path.read_text())


# ── /ai/model-info (Model Card) ───────────────────────────────────────────────
@router.get("/model-info")
def model_info(current_user: User = Depends(get_current_user)):
    """
    Full PPO model card: version, hyperparameters, dataset metadata,
    and test-set performance metrics (if backtest has been run).
    """
    meta_path = MODELS_DIR / "model_meta.json"
    if not meta_path.exists():
        return {
            "status":          "not_trained",
            "model_version":   MODEL_VERSION,
            "message":         "PPO model has not been trained yet.",
            "train_command":   "docker exec -it smartchange_backend python app/ai/rl_train.py",
            "dataset_metadata": DATASET_META,
        }

    meta = json.loads(meta_path.read_text())
    meta["status"]           = "trained"
    meta["model_version"]    = MODEL_VERSION
    meta["dataset_metadata"] = DATASET_META

    # Attach test performance from backtest if available
    results_path = MODELS_DIR / "backtest_results.json"
    if results_path.exists():
        results = json.loads(results_path.read_text())
        ppo_r   = results.get("ppo_rl", {})
        meta["test_performance"] = {
            "return_pct":         ppo_r.get("total_return_pct"),
            "ann_volatility_pct": ppo_r.get("ann_volatility_pct"),
            "sharpe_ratio":       ppo_r.get("sharpe_ratio"),
            "sortino_ratio":      ppo_r.get("sortino_ratio"),
            "max_drawdown_pct":   ppo_r.get("max_drawdown_pct"),
            "n_trading_days":     ppo_r.get("n_trading_days"),
            "vs_nifty50_return":  (
                round(ppo_r.get("total_return_pct", 0)
                      - results.get("nifty50", {}).get("total_return_pct", 0), 3)
                if "nifty50" in results else None
            ),
        }
    else:
        meta["test_performance"] = None

    return meta
