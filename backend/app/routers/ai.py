"""
routers/ai.py — AI Endpoints (Thin HTTP Adapter)
=================================================
This router only handles:
  - Request validation (Query params, path params)
  - Authentication (Depends(get_current_user))
  - HTTP responses

All business logic lives in app.services.ai_service.
"""

from fastapi import APIRouter, Depends, Query
from app.models.user import User
from app.dependencies import get_current_user
from app.services.ai_service import (
    run_ai_recommendation,
    get_stock_explanation,
    get_backtest_results,
    get_model_info,
)

router = APIRouter(prefix="/ai", tags=["AI"])


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
    result = run_ai_recommendation(amount=amount, top_n=top_n)
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
    return get_stock_explanation(stock_symbol)


# ── /ai/backtest ──────────────────────────────────────────────────────────────
@router.get("/backtest")
def get_backtest(current_user: User = Depends(get_current_user)):
    """
    PPO vs Equal-Weight vs NIFTY-50 backtest results (held-out test period).
    To regenerate: docker exec -it smartchange_backend python app/ai/rl_backtest.py
    """
    return get_backtest_results()


# ── /ai/model-info ────────────────────────────────────────────────────────────
@router.get("/model-info")
def model_info(current_user: User = Depends(get_current_user)):
    """
    Full PPO model card: version, hyperparameters, dataset metadata,
    and test-set performance metrics (if backtest has been run).
    """
    return get_model_info()
