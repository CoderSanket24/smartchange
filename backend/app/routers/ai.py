from fastapi import APIRouter, Depends, Query
from app.models.user import User
from app.dependencies import get_current_user
from app.ai.rl_agent import agent

router = APIRouter(prefix="/ai", tags=["AI"])


@router.get("/recommend")
def get_recommendations(
    amount: float = Query(default=100.0, gt=0, description="Total ₹ amount to allocate"),
    top_n: int = Query(default=4, ge=1, le=8, description="Number of stocks to recommend"),
    current_user: User = Depends(get_current_user)
):
    """
    Get AI-powered stock recommendations using the RL agent.

    Returns top-N stocks with:
    - Allocation percentage (softmax over Q-values)
    - Suggested ₹ amount per stock
    - SHAP-style feature importance breakdown
    - Human-readable rationale
    """
    recommendations = agent.recommend(top_n=top_n, amount=amount)

    return {
        "user": current_user.username,
        "total_amount": amount,
        "model": "Epsilon-Greedy RL Agent (ε=0.10)",
        "explanation_method": "SHAP-style Feature Importance",
        "features_used": [
            {"name": "momentum",        "weight": 0.35, "description": "Price upward trend strength"},
            {"name": "low_volatility",  "weight": 0.25, "description": "Inverse of price volatility (stability)"},
            {"name": "value",           "weight": 0.20, "description": "Inverse of P/E ratio (undervaluation)"},
            {"name": "large_cap",       "weight": 0.20, "description": "Market capitalisation (stability)"},
        ],
        "recommendations": recommendations,
    }


@router.get("/explain/{stock_symbol}")
def explain_stock(
    stock_symbol: str,
    current_user: User = Depends(get_current_user)
):
    """
    Get a detailed SHAP-style explanation for a single stock —
    why the RL agent rates it the way it does.
    """
    from app.ai.rl_agent import STOCK_UNIVERSE, FEATURE_WEIGHTS
    symbol = stock_symbol.upper()

    if symbol not in STOCK_UNIVERSE:
        from fastapi import HTTPException
        raise HTTPException(status_code=404, detail=f"Stock '{symbol}' not found.")

    scores = agent._feature_score(symbol)
    s = STOCK_UNIVERSE[symbol]
    feat = scores["features"]

    shap_vals = {k: round(FEATURE_WEIGHTS[k] * feat[k], 4) for k in feat}
    top_factor = max(shap_vals, key=shap_vals.get)

    return {
        "stock_symbol":   symbol,
        "stock_name":     s["name"],
        "sector":         s["sector"],
        "current_price":  s["base_price"],
        "q_value":        scores["q_value"],
        "raw_features": {
            "momentum":     s["momentum"],
            "volatility":   s["volatility"],
            "pe_ratio":     s["pe_ratio"],
            "market_cap_cr": s["market_cap_cr"],
        },
        "normalised_scores":  feat,
        "feature_weights":    FEATURE_WEIGHTS,
        "shap_values":        shap_vals,
        "top_factor":         top_factor,
        "verdict": (
            f"The RL agent rates {symbol} primarily due to its strong '{top_factor}' score "
            f"({shap_vals[top_factor]:.4f} SHAP contribution). "
            f"Overall Q-value: {scores['q_value']:.4f}/1.00."
        )
    }
