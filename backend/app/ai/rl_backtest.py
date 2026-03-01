"""
rl_backtest.py — Backtesting Script for SmartChange RL Agent
=============================================================
Run AFTER training is complete:

    docker exec -it smartchange_backend python app/ai/rl_backtest.py

Evaluates 3 strategies on the held-out TEST set (last 25% of data — no leakage):
  1. PPO RL Agent         (deterministic=True)
  2. Heuristic Baseline   (fixed weighted-feature weights)
  3. Equal-Weight         (1/N allocation, rebalanced daily)

Metrics computed:
  - Total Return (%)
  - Annualised Volatility (%)
  - Sharpe Ratio (risk-free = 6% annualised, approx Indian Tbill)
  - Maximum Drawdown (%)

Saves results to app/ai/models/backtest_results.json
"""

import json
import sys
import logging
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv

sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.ai.rl_env import PortfolioEnv
from app.ai.rl_agent import STOCK_UNIVERSE, FEATURE_WEIGHTS

MODELS_DIR   = Path(__file__).parent / "models"
RISK_FREE    = 0.06 / 252          # daily risk-free rate (6% annual / 252 trading days)

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger(__name__)


# ── Metric Helpers ─────────────────────────────────────────────────────────────
def _compute_metrics(daily_returns: np.ndarray) -> dict:
    """
    Given an array of daily log-returns, compute standard performance metrics.
    """
    n_days          = len(daily_returns)
    total_return    = float(np.exp(daily_returns.sum()) - 1) * 100       # %
    ann_vol         = float(daily_returns.std() * np.sqrt(252)) * 100    # %
    excess          = daily_returns - RISK_FREE
    sharpe          = float(excess.mean() / (daily_returns.std() + 1e-8) * np.sqrt(252))

    # Max drawdown
    cum_ret         = np.exp(daily_returns.cumsum())
    running_max     = np.maximum.accumulate(cum_ret)
    drawdown        = (cum_ret - running_max) / (running_max + 1e-8) * 100
    max_drawdown    = float(drawdown.min())

    return {
        "total_return_pct":    round(total_return, 3),
        "ann_volatility_pct":  round(ann_vol, 3),
        "sharpe_ratio":        round(sharpe, 4),
        "max_drawdown_pct":    round(max_drawdown, 3),
        "n_trading_days":      n_days,
    }


# ── Load Data and Split ────────────────────────────────────────────────────────
def load_test_data() -> tuple[pd.DataFrame, list[str]]:
    # Load split metadata saved during training
    split_meta_path = MODELS_DIR / "split_meta.json"
    if not split_meta_path.exists():
        raise FileNotFoundError("split_meta.json not found. Run rl_train.py first.")

    split_meta   = json.loads(split_meta_path.read_text())
    cutoff_date  = pd.Timestamp(split_meta["cutoff_date"])
    model_meta   = json.loads((MODELS_DIR / "model_meta.json").read_text())
    symbols      = model_meta["symbols"]
    tickers      = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

    log.info(f"Downloading data for {tickers} …")
    raw    = yf.download(tickers, period="2y", auto_adjust=True, progress=False)
    closes = raw["Close"].ffill().dropna()
    closes.columns = [c.replace(".NS", "") for c in closes.columns]

    # ── Strict date-based split — NO leakage ─────────────────────────────
    test_df = closes[closes.index >= cutoff_date].copy()
    log.info(f"Test period: {test_df.index[0].date()} → {test_df.index[-1].date()} ({len(test_df)} days)")
    return test_df, symbols


# ── Strategy 1: PPO RL Agent ───────────────────────────────────────────────────
def run_ppo(test_df: pd.DataFrame) -> np.ndarray:
    log.info("Running PPO strategy …")
    env       = PortfolioEnv(test_df)
    obs, _    = env.reset()
    done      = False
    log_rets  = []

    while not done:
        obs_batch = obs.reshape(1, -1)
        action, _ = _model.predict(obs_batch, deterministic=True)   # ← deterministic
        obs, reward, done, truncated, info = env.step(action.flatten())
        log_rets.append(info["port_log_return"])

    return np.array(log_rets)


# ── Strategy 2: Heuristic Baseline ────────────────────────────────────────────
def run_heuristic(test_df: pd.DataFrame, symbols: list[str]) -> np.ndarray:
    """Fixed weights from the heuristic agent (no retraining on test data)."""
    log.info("Running Heuristic strategy …")

    # Replicate scoring from rl_agent.py using pre-computed feature weights
    from app.ai.rl_agent import RLAgent
    agent   = RLAgent(epsilon=0.0)   # epsilon=0 → always greedy, no randomness
    recs    = agent.recommend(top_n=len(symbols), amount=1.0)
    weight_map = {r["stock_symbol"]: r["allocation_pct"] / 100.0 for r in recs}
    weights = np.array([weight_map.get(s, 1.0/len(symbols)) for s in symbols])
    weights = weights / (weights.sum() + 1e-8)

    # Compute log returns using fixed weights
    log_ret_df = np.log(test_df / test_df.shift(1)).dropna()
    port_rets  = (log_ret_df.values @ weights)
    return port_rets


# ── Strategy 3: Equal-Weight ───────────────────────────────────────────────────
def run_equal_weight(test_df: pd.DataFrame) -> np.ndarray:
    log.info("Running Equal-Weight strategy …")
    n            = test_df.shape[1]
    weights      = np.ones(n) / n
    log_ret_df   = np.log(test_df / test_df.shift(1)).dropna()
    port_rets    = (log_ret_df.values @ weights)
    return port_rets


# ── Entry Point ────────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not (MODELS_DIR / "ppo_smartchange.zip").exists():
        log.error("Model not found. Run rl_train.py first.")
        sys.exit(1)

    # Load model with frozen VecNormalize
    model_meta = json.loads((MODELS_DIR / "model_meta.json").read_text())
    symbols    = model_meta["symbols"]
    n_stocks   = model_meta["n_stocks"]

    dummy_prices = pd.DataFrame(np.ones((60, n_stocks)) * 1000.0, columns=symbols)
    dummy_vec    = DummyVecEnv([lambda: PortfolioEnv(dummy_prices)])
    vec_env      = VecNormalize.load(str(MODELS_DIR / "vecnormalize.pkl"), dummy_vec)
    vec_env.training    = False
    vec_env.norm_reward = False

    _model   = PPO.load(str(MODELS_DIR / "ppo_smartchange"), env=vec_env)
    test_df, symbols = load_test_data()

    results = {}
    # Strategy 1: PPO
    ppo_rets   = run_ppo(test_df)
    results["ppo_rl"] = _compute_metrics(ppo_rets)
    results["ppo_rl"]["strategy"] = "PPO RL Agent (deterministic)"

    # Strategy 2: Heuristic
    heur_rets  = run_heuristic(test_df, symbols)
    results["heuristic"] = _compute_metrics(heur_rets)
    results["heuristic"]["strategy"] = "Heuristic (Weighted Features)"

    # Strategy 3: Equal-Weight
    eq_rets    = run_equal_weight(test_df)
    results["equal_weight"] = _compute_metrics(eq_rets)
    results["equal_weight"]["strategy"] = "Equal-Weight (1/N)"

    out_path = MODELS_DIR / "backtest_results.json"
    out_path.write_text(json.dumps(results, indent=2))
    log.info(f"\n✅ Backtest complete. Results saved → {out_path}")

    # Pretty print summary
    log.info("\n{'='*58}")
    log.info(f"{'Strategy':<35} {'Return%':>8} {'Vol%':>7} {'Sharpe':>8} {'MaxDD%':>8}")
    log.info("─" * 58)
    for key, m in results.items():
        log.info(
            f"{m['strategy']:<35} "
            f"{m['total_return_pct']:>8.2f} "
            f"{m['ann_volatility_pct']:>7.2f} "
            f"{m['sharpe_ratio']:>8.4f} "
            f"{m['max_drawdown_pct']:>8.2f}"
        )
