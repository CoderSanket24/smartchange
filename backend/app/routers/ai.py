"""
routers/ai.py — AI Recommendation & Explanation Endpoints
=========================================================
Phase 4 – Updated to use PPO RL inference with heuristic fallback.
"""

import json
from pathlib import Path
from fastapi import APIRouter, Depends, Query, HTTPException
from app.models.user import User
from app.dependencies import get_current_user
from app.ai.rl_inference import get_recommendations

router = APIRouter(prefix="/ai", tags=["AI"])

MODELS_DIR = Path(__file__).parent.parent / "ai" / "models"


# ── Recommendation ────────────────────────────────────────────────────────────
@router.get("/recommend")
def recommend(
    amount: float = Query(default=100.0, gt=0, description="Total ₹ to allocate"),
    top_n:  int   = Query(default=4,     ge=1, le=8, description="Number of stocks"),
    current_user: User = Depends(get_current_user)
):
    """
    AI-powered stock recommendations.
    Uses PPO RL agent when trained, falls back to heuristic automatically.
    """
    result = get_recommendations(amount=amount, top_n=top_n)
    return {
        "user":           current_user.username,
        "total_amount":   amount,
        **result,                               # model, explanation_method, recommendations
    }


# ── Single-stock SHAP-style Explanation (heuristic layer, always available) ───
@router.get("/explain/{stock_symbol}")
def explain_stock(
    stock_symbol: str,
    current_user: User = Depends(get_current_user)
):
    """
    SHAP-style feature importance for a single stock (from the heuristic scorer).
    Always available regardless of RL model training status.
    """
    from app.ai.rl_agent import STOCK_UNIVERSE, FEATURE_WEIGHTS, RLAgent
    symbol = stock_symbol.upper()
    if symbol not in STOCK_UNIVERSE:
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not in universe.")

    agent  = RLAgent(epsilon=0.0)
    scores = agent._feature_score(symbol)
    s      = STOCK_UNIVERSE[symbol]
    feat   = scores["features"]
    shap   = {k: round(FEATURE_WEIGHTS[k] * feat[k], 4) for k in feat}
    top    = max(shap, key=shap.get)

    return {
        "stock_symbol":    symbol,
        "stock_name":      s["name"],
        "sector":          s["sector"],
        "current_price":   s["base_price"],
        "q_value":         scores["q_value"],
        "raw_features":    {"momentum": s["momentum"], "volatility": s["volatility"],
                            "pe_ratio": s["pe_ratio"], "market_cap_cr": s["market_cap_cr"]},
        "normalised_scores":  feat,
        "feature_weights":    FEATURE_WEIGHTS,
        "shap_values":        shap,
        "top_factor":         top,
        "verdict": (
            f"The heuristic scorer rates {symbol} primarily due to '{top}' "
            f"(SHAP: {shap[top]:.4f}). Q-value: {scores['q_value']:.4f}/1.00."
        ),
    }


# ── Backtest Results ───────────────────────────────────────────────────────────
@router.get("/backtest")
def get_backtest(current_user: User = Depends(get_current_user)):
    """
    Returns the 3-strategy backtest comparison (PPO vs Heuristic vs Equal-Weight).
    Run `python app/ai/rl_backtest.py` inside the container to generate results.
    """
    results_path = MODELS_DIR / "backtest_results.json"
    if not results_path.exists():
        raise HTTPException(
            status_code=404,
            detail=(
                "Backtest results not found. "
                "Run: docker exec -it smartchange_backend python app/ai/rl_backtest.py"
            )
        )
    return json.loads(results_path.read_text())


# ── Model Metadata ────────────────────────────────────────────────────────────
@router.get("/model-info")
def model_info(current_user: User = Depends(get_current_user)):
    """
    Returns metadata about the currently loaded RL model.
    Shows training date, timesteps, symbols, and hyperparameters.
    """
    meta_path = MODELS_DIR / "model_meta.json"
    if not meta_path.exists():
        return {
            "status":  "not_trained",
            "message": "PPO model has not been trained yet. Using heuristic fallback.",
            "train_command": "docker exec -it smartchange_backend python app/ai/rl_train.py",
        }
    meta = json.loads(meta_path.read_text())
    meta["status"] = "trained"
    return meta
