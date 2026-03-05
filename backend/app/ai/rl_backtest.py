"""
rl_backtest.py — PPO vs NIFTY-50 vs Equal-Weight Backtesting
=============================================================
Run AFTER training:
    docker exec -it smartchange_backend python app/ai/rl_backtest.py

Evaluates 3 strategies on held-out TEST set (last 25% — no leakage):
  1. PPO RL Agent         (deterministic=True)
  2. Equal-Weight         (1/N allocation, rebalanced daily)
  3. NIFTY-50 Benchmark   (buy-and-hold ^NSEI index)

Metrics:
  - Total Return (%)
  - Annualised Volatility (%)
  - Sharpe Ratio          (excess return / total std)
  - Sortino Ratio         (excess return / downside std)
  - Maximum Drawdown (%)

Saves: app/ai/models/backtest_results.json
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

MODELS_DIR = Path(__file__).parent / "models"
RISK_FREE  = 0.06 / 252   # Indian risk-free rate, daily

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger(__name__)


# ── Metrics ────────────────────────────────────────────────────────────────────
def _compute_metrics(daily_returns: np.ndarray) -> dict:
    n_days       = len(daily_returns)
    total_return = float(np.exp(daily_returns.sum()) - 1) * 100
    ann_vol      = float(daily_returns.std() * np.sqrt(252)) * 100
    excess       = daily_returns - RISK_FREE

    # Sharpe
    sharpe = float(excess.mean() / (daily_returns.std() + 1e-8) * np.sqrt(252))

    # Sortino — penalise only downside deviation
    downside = daily_returns[daily_returns < RISK_FREE]
    downside_std = float(downside.std() + 1e-8) if len(downside) > 1 else 1e-8
    sortino  = float(excess.mean() / downside_std * np.sqrt(252))

    # Max Drawdown
    cum         = np.exp(daily_returns.cumsum())
    running_max = np.maximum.accumulate(cum)
    max_dd      = float(((cum - running_max) / (running_max + 1e-8) * 100).min())

    return {
        "total_return_pct":   round(total_return, 3),
        "ann_volatility_pct": round(ann_vol, 3),
        "sharpe_ratio":       round(sharpe, 4),
        "sortino_ratio":      round(sortino, 4),
        "max_drawdown_pct":   round(max_dd, 3),
        "n_trading_days":     n_days,
    }


# ── Data ───────────────────────────────────────────────────────────────────────
def load_test_data():
    split_meta  = json.loads((MODELS_DIR / "split_meta.json").read_text())
    model_meta  = json.loads((MODELS_DIR / "model_meta.json").read_text())
    cutoff_date = pd.Timestamp(split_meta["cutoff_date"])
    symbols     = model_meta["symbols"]
    tickers     = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

    log.info(f"Downloading portfolio stocks: {tickers}")
    raw    = yf.download(tickers, period="2y", auto_adjust=True, progress=False)
    closes = raw["Close"].ffill().dropna()
    closes.columns = [c.replace(".NS", "") for c in closes.columns]

    test_df = closes[closes.index >= cutoff_date].copy()
    log.info(
        f"Test period: {test_df.index[0].date()} → {test_df.index[-1].date()} "
        f"({len(test_df)} days)"
    )
    return test_df, symbols, cutoff_date


# ── Strategy 1: PPO ─────────────────────────────────────────────────────────
def run_ppo(test_df: pd.DataFrame, model) -> np.ndarray:
    log.info("Running PPO strategy (deterministic=True) …")
    env      = PortfolioEnv(test_df)
    obs, _   = env.reset()
    done     = False
    log_rets = []
    while not done:
        action, _ = model.predict(obs.reshape(1, -1), deterministic=True)
        obs, _, done, _, info = env.step(action.flatten())
        log_rets.append(info["port_log_return"])
    return np.array(log_rets)


# ── Strategy 2: Equal-Weight ─────────────────────────────────────────────────
def run_equal_weight(test_df: pd.DataFrame) -> np.ndarray:
    log.info("Running Equal-Weight strategy (1/N) …")
    n  = test_df.shape[1]
    w  = np.ones(n) / n
    lr = np.log(test_df / test_df.shift(1)).dropna()
    return (lr.values @ w)


# ── Strategy 3: NIFTY-50 Benchmark ───────────────────────────────────────────
def run_nifty50(cutoff_date: pd.Timestamp) -> np.ndarray:
    log.info("Downloading NIFTY-50 benchmark (^NSEI) …")
    nifty = yf.download("^NSEI", period="2y", auto_adjust=True, progress=False)
    nifty = nifty["Close"].squeeze().ffill().dropna()
    nifty = nifty[nifty.index >= cutoff_date]
    log_rets = np.log(nifty / nifty.shift(1)).dropna().values
    return log_rets


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    if not (MODELS_DIR / "ppo_smartchange.zip").exists():
        log.error("Model not found. Run rl_train.py first.")
        sys.exit(1)

    model_meta = json.loads((MODELS_DIR / "model_meta.json").read_text())
    symbols    = model_meta["symbols"]
    n_stocks   = model_meta["n_stocks"]

    dummy_prices = pd.DataFrame(np.ones((60, n_stocks)) * 1000.0, columns=symbols)
    dummy_vec    = DummyVecEnv([lambda dp=dummy_prices: PortfolioEnv(dp)])
    vec_env      = VecNormalize.load(str(MODELS_DIR / "vecnormalize.pkl"), dummy_vec)
    vec_env.training    = False
    vec_env.norm_reward = False

    ppo_model = PPO.load(str(MODELS_DIR / "ppo_smartchange"), env=vec_env)
    test_df, symbols, cutoff_date = load_test_data()

    results = {}

    # PPO
    ppo_rets = run_ppo(test_df, ppo_model)
    results["ppo_rl"] = _compute_metrics(ppo_rets)
    results["ppo_rl"]["strategy"] = "PPO RL Agent (deterministic)"

    # Equal-Weight
    eq_rets = run_equal_weight(test_df)
    results["equal_weight"] = _compute_metrics(eq_rets)
    results["equal_weight"]["strategy"] = "Equal-Weight (1/N)"

    # NIFTY-50
    try:
        nifty_rets = run_nifty50(cutoff_date)
        # Align length with portfolio (trading days may differ slightly)
        min_len = min(len(ppo_rets), len(nifty_rets))
        nifty_rets = nifty_rets[:min_len]
        results["nifty50"] = _compute_metrics(nifty_rets)
        results["nifty50"]["strategy"] = "NIFTY-50 Benchmark (Buy & Hold)"
    except Exception as e:
        log.warning(f"NIFTY-50 download failed: {e}. Skipping benchmark.")

    out_path = MODELS_DIR / "backtest_results.json"
    out_path.write_text(json.dumps(results, indent=2))
    log.info(f"\n✅ Backtest complete → {out_path}")

    log.info(f"\n{'='*72}")
    log.info(
        f"{'Strategy':<38} {'Ret%':>7} {'Vol%':>6} "
        f"{'Sharpe':>8} {'Sortino':>8} {'MaxDD%':>8}"
    )
    log.info("─" * 72)
    for m in results.values():
        log.info(
            f"{m['strategy']:<38} "
            f"{m['total_return_pct']:>7.2f} "
            f"{m['ann_volatility_pct']:>6.2f} "
            f"{m['sharpe_ratio']:>8.4f} "
            f"{m['sortino_ratio']:>8.4f} "
            f"{m['max_drawdown_pct']:>8.2f}"
        )
