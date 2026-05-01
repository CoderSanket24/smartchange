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
from app.core.config import MODELS_DIR, TRANSACTION_COST

RISK_FREE        = 0.06 / 252   # Indian risk-free rate, daily
CONC_THRESHOLD   = 0.60         # warn if any single stock > 60%
INITIAL_CAPITAL  = 100_000.0   # ₹1 L reference portfolio for equity curves

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


# ── Strategy 1: PPO ────────────────────────────────────────────────────────────────
def run_ppo(test_df: pd.DataFrame, model):
    """
    Roll the PPO agent through test_df (deterministic).
    Returns a dict with:
      log_rets, n_conc, max_w_seen, avg_max_w,
      avg_turnover, max_turnover,
      avg_entropy, min_entropy,
      weights_history  (list of (date, weights_array))
    """
    log.info("Running PPO strategy (deterministic=True) …")
    env      = PortfolioEnv(test_df)
    obs, _   = env.reset()
    done     = False

    log_rets:       list[float]         = []
    max_w_steps:    list[float]         = []
    turnover_steps: list[float]         = []
    entropy_steps:  list[float]         = []
    weights_history: list[tuple]        = []   # (date_str, np.ndarray)
    n_conc          = 0
    prev_weights    = np.ones(env.n_stocks) / env.n_stocks  # initial 1/N

    while not done:
        action, _ = model.predict(obs.reshape(1, -1), deterministic=True)
        flat      = action.flatten()

        # Normalise to get portfolio weights
        w  = np.clip(flat, 0.0, None)
        w  = w / (w.sum() + 1e-8)
        mw = float(w.max())

        # ── Over-concentration check ────────────────────────────────
        if mw > CONC_THRESHOLD:
            n_conc += 1
            log.warning(
                f"  ⚠️  PPO concentration detected: max_weight={mw*100:.1f}% > 60% "
                f"at step t={env.t}  (stock idx={int(w.argmax())})"
            )

        # ── Turnover: Σ|Δw| vs previous step ────────────────────────────
        turnover = float(np.abs(w - prev_weights).sum())
        prev_weights = w.copy()

        # ── Entropy: −Σ w · log(w+ε) (higher = more diversified) ─────────
        entropy = float(-np.sum(w * np.log(w + 1e-8)))

        # ── Record date for weights CSV ───────────────────────────────
        date_str = test_df.index[env.t].strftime("%Y-%m-%d")

        obs, _, done, _, info = env.step(flat)
        log_rets.append(info["port_log_return"])
        max_w_steps.append(info.get("max_weight", mw))
        turnover_steps.append(turnover)
        entropy_steps.append(entropy)
        weights_history.append((date_str, w))

    if n_conc == 0:
        log.info("  ✅ No concentration events (all weights ≤ 60%).")
    else:
        log.warning(f"  Total concentration events: {n_conc} / {len(log_rets)} steps")

    mwa  = np.array(max_w_steps)
    ta   = np.array(turnover_steps)
    ea   = np.array(entropy_steps)

    return {
        "log_rets":        np.array(log_rets),
        "n_conc":          n_conc,
        "max_w_seen":      float(mwa.max()),
        "avg_max_w":       float(mwa.mean()),
        "avg_turnover":    round(float(ta.mean()), 6),
        "max_turnover":    round(float(ta.max()),  6),
        "avg_entropy":     round(float(ea.mean()), 6),
        "min_entropy":     round(float(ea.min()),  6),
        "weights_history": weights_history,          # list[(date_str, np.ndarray)]
    }


# ── Strategy 2: Equal-Weight ─────────────────────────────────────────────────
def run_equal_weight(test_df: pd.DataFrame) -> np.ndarray:
    """
    1/N daily-rebalanced strategy with transaction costs applied.
    Turnover each day = sum(|new_w - old_w|). Since weights are constant 1/N,
    turnover only arises from price drift pushing weights away from 1/N.
    """
    log.info("Running Equal-Weight strategy (1/N with TC) …")
    n      = test_df.shape[1]
    target = np.ones(n) / n
    log_ret_df = np.log(test_df / test_df.shift(1)).dropna()

    net_rets = []
    weights  = target.copy()                      # start at 1/N
    for i in range(len(log_ret_df)):
        row_ret  = log_ret_df.values[i]           # gross log-returns this day
        gross    = float(np.dot(weights, row_ret))
        # Update weights with price drift (before rebalancing)
        drift_w  = weights * np.exp(row_ret)
        drift_w  = drift_w / (drift_w.sum() + 1e-8)
        # Cost of rebalancing back to 1/N
        turnover = float(np.abs(target - drift_w).sum())
        tc       = TRANSACTION_COST * turnover
        net_rets.append(gross + np.log(1.0 - tc + 1e-8))
        weights  = target.copy()                  # rebalanced
    return np.array(net_rets)


# ── Strategy 3: NIFTY-50 Benchmark ───────────────────────────────────────────
def run_nifty50(cutoff_date: pd.Timestamp) -> np.ndarray:
    log.info("Downloading NIFTY-50 benchmark (^NSEI) …")
    nifty = yf.download("^NSEI", period="2y", auto_adjust=True, progress=False)
    nifty = nifty["Close"].squeeze().ffill().dropna()
    nifty = nifty[nifty.index >= cutoff_date]
    log_rets = np.log(nifty / nifty.shift(1)).dropna().values
    return log_rets


# ── Entry Point ────────────────────────────────────────────────────────────────

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

    # PPO — now returns a rich dict
    ppo = run_ppo(test_df, ppo_model)
    ppo_rets = ppo["log_rets"]

    results["ppo_rl"] = _compute_metrics(ppo_rets)
    results["ppo_rl"].update({
        "strategy":               "PPO RL Agent (deterministic)",
        "concentration_warnings": ppo["n_conc"],
        "max_weight_seen":        round(ppo["max_w_seen"] * 100, 2),
        "avg_max_weight":         round(ppo["avg_max_w"]  * 100, 2),
        "avg_turnover":           ppo["avg_turnover"],
        "max_turnover":           ppo["max_turnover"],
        "avg_entropy":            ppo["avg_entropy"],
        "min_entropy":            ppo["min_entropy"],
    })

    log.info(
        f"  Turnover avg={ppo['avg_turnover']:.4f}  max={ppo['max_turnover']:.4f}  "
        f"Entropy avg={ppo['avg_entropy']:.4f}  min={ppo['min_entropy']:.4f}"
    )

    # Equal-Weight (TC applied internally)
    eq_rets = run_equal_weight(test_df)
    results["equal_weight"] = _compute_metrics(eq_rets)
    results["equal_weight"]["strategy"] = "Equal-Weight (1/N)"

    # NIFTY-50
    nifty_rets = None
    try:
        nifty_rets = run_nifty50(cutoff_date)
        min_len    = min(len(ppo_rets), len(nifty_rets))
        nifty_rets = nifty_rets[:min_len]
        results["nifty50"] = _compute_metrics(nifty_rets)
        results["nifty50"]["strategy"] = "NIFTY-50 Benchmark (Buy & Hold)"
    except Exception as e:
        log.warning(f"NIFTY-50 download failed: {e}. Skipping benchmark.")

    # ── Portfolio Weights CSV ────────────────────────────────────────────
    # Long-form: date, stock_symbol, weight  (one row per stock per day)
    wh_rows = []
    for date_str, wvec in ppo["weights_history"]:
        for sym, wval in zip(symbols, wvec):
            wh_rows.append({"date": date_str, "stock_symbol": sym,
                            "weight": round(float(wval), 6)})
    weights_df = pd.DataFrame(wh_rows)
    w_csv_path = MODELS_DIR / "portfolio_weights.csv"
    weights_df.to_csv(w_csv_path, index=False)
    log.info(f"📊 Portfolio weights saved → {w_csv_path}  "
             f"({len(weights_df):,} rows: {len(ppo['weights_history'])} days × {len(symbols)} stocks)")

    # ── Equity Curves ─────────────────────────────────────────────────────
    # PPO dates: env resets at t=14, so returns correspond to test_df.index[14:14+len]
    n_ppo      = len(ppo_rets)
    ppo_start  = 14                                    # env reset offset
    ppo_dates  = test_df.index[ppo_start:ppo_start + n_ppo]

    ppo_equity = INITIAL_CAPITAL * np.exp(np.cumsum(ppo_rets))

    # EW returns: log_ret_df has index = test_df.index[1:], so row j → test_df[j+1]
    # To align with ppo_dates (test_df[14..14+n_ppo-1]) we need eq_rets[13..13+n_ppo-1]
    eq_offset   = ppo_start - 1                        # 13
    eq_aligned  = eq_rets[eq_offset:eq_offset + n_ppo]
    eq_equity   = INITIAL_CAPITAL * np.exp(np.cumsum(eq_aligned))

    equity_data = {
        "date":                ppo_dates.strftime("%Y-%m-%d").tolist(),
        "ppo_value":           np.round(ppo_equity, 2).tolist(),
        "equal_weight_value":  np.round(eq_equity,  2).tolist(),
    }

    # NIFTY-50: align by length to PPO dates
    if nifty_rets is not None and len(nifty_rets) >= n_ppo:
        nifty_equity = INITIAL_CAPITAL * np.exp(np.cumsum(nifty_rets[:n_ppo]))
        equity_data["nifty_value"] = np.round(nifty_equity, 2).tolist()
    elif nifty_rets is not None:
        nifty_equity = INITIAL_CAPITAL * np.exp(np.cumsum(nifty_rets))
        padded = np.full(n_ppo, np.nan)
        padded[:len(nifty_rets)] = nifty_equity
        equity_data["nifty_value"] = np.round(padded, 2).tolist()

    equity_df  = pd.DataFrame(equity_data)
    csv_path   = MODELS_DIR / "equity_curves.csv"
    equity_df.to_csv(csv_path, index=False)
    log.info(f"\n📈 Equity curves saved → {csv_path}")
    log.info(f"   Initial capital: ₹{INITIAL_CAPITAL:,.0f}  |  Period: {ppo_dates[0].date()} → {ppo_dates[-1].date()}")

    # ── Save backtest results ─────────────────────────────────────────────────
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
