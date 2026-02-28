import random
import numpy as np

# ---------------------------------------------------------------------------
# Stock universe — same as portfolio router so recommendations are coherent
# ---------------------------------------------------------------------------
STOCK_UNIVERSE = {
    "RELIANCE":  {"name": "Reliance Industries",   "sector": "Energy",       "base_price": 2950.0, "volatility": 0.18, "momentum": 0.65, "pe_ratio": 22.4, "market_cap_cr": 1995000},
    "TCS":       {"name": "Tata Consultancy Svcs", "sector": "IT",           "base_price": 3820.0, "volatility": 0.14, "momentum": 0.72, "pe_ratio": 31.2, "market_cap_cr": 1390000},
    "INFY":      {"name": "Infosys",               "sector": "IT",           "base_price": 1780.0, "volatility": 0.15, "momentum": 0.68, "pe_ratio": 27.8, "market_cap_cr": 740000},
    "HDFC":      {"name": "HDFC Bank",             "sector": "Finance",      "base_price": 1620.0, "volatility": 0.12, "momentum": 0.55, "pe_ratio": 18.6, "market_cap_cr": 1230000},
    "WIPRO":     {"name": "Wipro",                 "sector": "IT",           "base_price": 480.0,  "volatility": 0.20, "momentum": 0.48, "pe_ratio": 24.1, "market_cap_cr": 250000},
    "ITC":       {"name": "ITC Limited",           "sector": "FMCG",         "base_price": 440.0,  "volatility": 0.11, "momentum": 0.60, "pe_ratio": 26.3, "market_cap_cr": 550000},
    "TATASTEEL": {"name": "Tata Steel",            "sector": "Metals",       "base_price": 145.0,  "volatility": 0.28, "momentum": 0.42, "pe_ratio": 8.4,  "market_cap_cr": 175000},
    "AXISBANK":  {"name": "Axis Bank",             "sector": "Finance",      "base_price": 1100.0, "volatility": 0.17, "momentum": 0.58, "pe_ratio": 15.9, "market_cap_cr": 340000},
}

# Feature weights the RL agent has "learned" (simulates trained Q-values)
FEATURE_WEIGHTS = {
    "momentum":      0.35,   # Higher momentum → more reward
    "low_volatility": 0.25,  # Lower volatility → safer → more reward
    "value":         0.20,   # Lower P/E → better value
    "large_cap":     0.20,   # Higher market cap → more stable
}


class RLAgent:
    """
    Epsilon-greedy RL agent for virtual stock allocation.

    State   : feature vector per stock (momentum, volatility, PE, market cap)
    Action  : pick top-N stocks and compute allocation weights via softmax
    Reward  : weighted sum of features (simulates learned Q-value)
    Explain : feature importance breakdown per recommendation (SHAP-style)
    """

    def __init__(self, epsilon: float = 0.10):
        self.epsilon = epsilon   # 10% random exploration

    def _feature_score(self, symbol: str) -> dict:
        """Compute normalised feature scores and the weighted Q-value."""
        s = STOCK_UNIVERSE[symbol]

        # Normalise each feature to [0, 1] relative to the universe
        all_mom  = [v["momentum"]    for v in STOCK_UNIVERSE.values()]
        all_vol  = [v["volatility"]  for v in STOCK_UNIVERSE.values()]
        all_pe   = [v["pe_ratio"]    for v in STOCK_UNIVERSE.values()]
        all_cap  = [v["market_cap_cr"] for v in STOCK_UNIVERSE.values()]

        def norm(val, vals, invert=False):
            lo, hi = min(vals), max(vals)
            n = (val - lo) / (hi - lo) if hi != lo else 0.5
            return round(1 - n if invert else n, 4)

        features = {
            "momentum":       norm(s["momentum"],        all_mom),
            "low_volatility": norm(s["volatility"],      all_vol,  invert=True),
            "value":          norm(s["pe_ratio"],        all_pe,   invert=True),
            "large_cap":      norm(s["market_cap_cr"],   all_cap),
        }

        q_value = sum(FEATURE_WEIGHTS[f] * features[f] for f in features)
        return {"features": features, "q_value": round(q_value, 4)}

    def recommend(self, top_n: int = 4, amount: float = 100.0) -> list[dict]:
        """
        Returns top_n stock recommendations with:
          - allocation percentage
          - SHAP-style feature importance scores
          - buy rationale text
        """
        symbols = list(STOCK_UNIVERSE.keys())

        # ε-greedy: 10% chance of random shuffle (exploration)
        if random.random() < self.epsilon:
            random.shuffle(symbols)
            ranked = symbols[:top_n]
        else:
            scores = {sym: self._feature_score(sym) for sym in symbols}
            ranked = sorted(symbols, key=lambda s: scores[s]["q_value"], reverse=True)[:top_n]

        # Softmax allocation over Q-values
        scores = {sym: self._feature_score(sym) for sym in ranked}
        q_vals = np.array([scores[sym]["q_value"] for sym in ranked])
        exp_q  = np.exp(q_vals - q_vals.max())          # stable softmax
        alloc  = (exp_q / exp_q.sum() * 100).round(2)

        recommendations = []
        for i, sym in enumerate(ranked):
            s     = STOCK_UNIVERSE[sym]
            feat  = scores[sym]["features"]
            q     = scores[sym]["q_value"]
            pct   = float(alloc[i])
            amt   = round(amount * pct / 100, 2)

            # Build human-readable rationale
            top_feature = max(feat, key=feat.get)
            rationale_map = {
                "momentum":       f"{sym} shows strong upward price momentum ({s['momentum']*100:.0f}% score), indicating continued growth.",
                "low_volatility": f"{sym} has low price volatility ({s['volatility']*100:.0f}%), making it a stable choice for micro-investments.",
                "value":          f"{sym} is undervalued with a P/E of {s['pe_ratio']}, offering good entry value.",
                "large_cap":      f"{sym} is a large-cap stock (₹{s['market_cap_cr']:,} Cr), providing stability and liquidity.",
            }

            recommendations.append({
                "rank":             i + 1,
                "stock_symbol":     sym,
                "stock_name":       s["name"],
                "sector":           s["sector"],
                "current_price":    s["base_price"],
                "allocation_pct":   pct,
                "suggested_amount": amt,
                "q_value":          q,
                "rationale":        rationale_map[top_feature],
                "explanation": {
                    "feature_scores": feat,
                    "feature_weights": FEATURE_WEIGHTS,
                    "top_factor": top_feature,
                    "shap_values": {
                        k: round(FEATURE_WEIGHTS[k] * feat[k], 4)
                        for k in feat
                    },
                },
            })

        return recommendations


# Singleton agent instance
agent = RLAgent(epsilon=0.10)
