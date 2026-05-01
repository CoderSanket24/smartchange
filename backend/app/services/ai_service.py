"""
app/services/ai_service.py
==========================
Service layer for all AI-related business logic.

Routers call these functions; they must never touch rl_inference or
rl_backtest directly.  This layer:
  - Resolves symbol aliases (HDFC ↔ HDFCBANK)
  - Validates stock-universe membership
  - Calls the inference module
  - Reads model artefact files
  - Assembles the final response dicts

FastAPI HTTP concerns (HTTPException, status codes) are handled here
so that the router stays thin.
"""

from __future__ import annotations

import json
import logging
from fastapi import HTTPException

from app.core.config import (
    MODELS_DIR,
    MODEL_VERSION,
    DATASET_METADATA,
    YFINANCE_TO_UNIVERSE,
    UNIVERSE_TO_YFINANCE,
)
from app.ai.rl_inference import get_recommendations, get_stock_features

log = logging.getLogger(__name__)


# ── Internal helpers ──────────────────────────────────────────────────────────

def _get_stock_universe() -> dict:
    """Lazy import to avoid circular deps with the portfolio router."""
    from app.routers.portfolio import STOCK_UNIVERSE
    return STOCK_UNIVERSE


def _resolve_symbol(raw_symbol: str) -> tuple[str, str, dict]:
    """
    Accept either a STOCK_UNIVERSE key (HDFC) or a yfinance name (HDFCBANK).
    Returns (yfin_sym, univ_key, stock_info) or raises HTTP 404.
    """
    symbol   = raw_symbol.upper()
    yfin_sym = UNIVERSE_TO_YFINANCE.get(symbol, symbol)   # HDFC  → HDFCBANK
    univ_key = YFINANCE_TO_UNIVERSE.get(yfin_sym, yfin_sym)  # HDFCBANK → HDFC
    info     = _get_stock_universe().get(univ_key)

    if info is None:
        raise HTTPException(
            status_code=404,
            detail=(
                f"'{symbol}' not in stock universe. "
                f"Available: {list(_get_stock_universe().keys())}"
            ),
        )
    return yfin_sym, univ_key, info


# ── Public service functions ──────────────────────────────────────────────────

def run_ai_recommendation(amount: float, top_n: int) -> dict:
    """
    Orchestrate a PPO portfolio recommendation.

    Returns the full response dict ready for the router to return,
    including user-agnostic fields (username is injected by the router).
    """
    result = get_recommendations(amount=amount, top_n=top_n)
    return result


def get_stock_explanation(raw_symbol: str) -> dict:
    """
    Return a live PPO feature breakdown and decision_reason for one stock.
    Raises HTTP 404 if symbol not in universe, HTTP 502 if yfinance fails.
    """
    yfin_sym, univ_key, info = _resolve_symbol(raw_symbol)

    feats = get_stock_features(raw_symbol)
    if not feats:
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch live market data for '{yfin_sym}' from yfinance.",
        )

    return {
        "stock_symbol":    yfin_sym,
        "universe_key":    univ_key,
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


def get_backtest_results() -> dict:
    """
    Return saved backtest results (PPO vs Equal-Weight vs NIFTY-50).
    Raises HTTP 404 if the backtest script has not been run yet.
    """
    results_path = MODELS_DIR / "backtest_results.json"
    if not results_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Backtest results not found. "
                "Run: docker exec -it smartchange_backend "
                "python app/ai/rl_backtest.py"
            ),
        )
    return json.loads(results_path.read_text())


def get_model_info() -> dict:
    """
    Build and return the full PPO model card.
    Merges model_meta.json with backtest_results.json (if available).
    """
    meta_path = MODELS_DIR / "model_meta.json"

    if not meta_path.exists():
        return {
            "status":           "not_trained",
            "model_version":    MODEL_VERSION,
            "message":          "PPO model has not been trained yet.",
            "train_command":    "docker exec -it smartchange_backend python app/ai/rl_train.py",
            "dataset_metadata": DATASET_METADATA,
        }

    meta: dict = json.loads(meta_path.read_text())
    meta["status"]           = "trained"
    meta["model_version"]    = MODEL_VERSION
    meta["dataset_metadata"] = DATASET_METADATA

    # Attach test-set performance from backtest if available
    results_path = MODELS_DIR / "backtest_results.json"
    if results_path.exists():
        results = json.loads(results_path.read_text())
        ppo_r   = results.get("ppo_rl", {})
        n50_ret = results.get("nifty50", {}).get("total_return_pct")
        meta["test_performance"] = {
            "return_pct":         ppo_r.get("total_return_pct"),
            "ann_volatility_pct": ppo_r.get("ann_volatility_pct"),
            "sharpe_ratio":       ppo_r.get("sharpe_ratio"),
            "sortino_ratio":      ppo_r.get("sortino_ratio"),
            "max_drawdown_pct":   ppo_r.get("max_drawdown_pct"),
            "n_trading_days":     ppo_r.get("n_trading_days"),
            "vs_nifty50_return":  (
                round(ppo_r.get("total_return_pct", 0) - n50_ret, 3)
                if n50_ret is not None else None
            ),
        }
    else:
        meta["test_performance"] = None

    return meta
