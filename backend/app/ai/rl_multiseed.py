"""
rl_multiseed.py — Multi-Seed PPO Training & Aggregation (5 Seeds)
==================================================================
Run AFTER ensuring rl_train.py is up to date:

    docker exec -it smartchange_backend python app/ai/rl_multiseed.py

Phases:
  1. Download 5y NSE data once (shared across all seeds)
  2. For each seed in SEEDS: set RNGs, train PPO, backtest
  3. Aggregate mean ± std of key metrics across all seeds
  4. Save to  models/multi_seed_results.json

Directory layout:
  models/
    seed_1/   → ppo_smartchange.zip, vecnormalize.pkl,
                 training_log.csv, model_meta.json, backtest_results.json
    seed_7/
    seed_42/
    seed_123/
    seed_777/
    multi_seed_results.json

⚠️  Each seed ≈ 7-10 min (300k steps). Total wall time ≈ 5 × that.
"""

import json
import logging
import sys
from pathlib import Path

import numpy as np
import pandas as pd
from stable_baselines3 import PPO
from stable_baselines3.common.vec_env import VecNormalize, DummyVecEnv

# ── sys.path fix (run as script inside container) ───────────────────────────
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

from app.ai.rl_env import PortfolioEnv
from app.ai.rl_train import (
    download_data, split_data, set_seeds, train, save_meta,
)
from app.ai.rl_backtest import (
    load_test_data, run_ppo, run_equal_weight, run_nifty50, _compute_metrics,
)
from app.core.config import MODELS_DIR, TRANSACTION_COST

# ── Config ───────────────────────────────────────────────────────────────────
SEEDS: list[int] = [1, 7, 42, 123, 777]   # 5 seeds for publication-grade robustness

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger(__name__)


# ── Per-seed backtest ─────────────────────────────────────────────────────────
def backtest_seed(seed: int, seed_dir: Path) -> dict:
    """Load the model for one seed and run all 3 backtest strategies."""
    log.info(f"\n{'─'*60}")
    log.info(f"  Backtesting seed={seed} from {seed_dir}")

    model_meta = json.loads((seed_dir / "model_meta.json").read_text())
    symbols    = model_meta["symbols"]
    n_stocks   = model_meta["n_stocks"]

    # Reconstruct dummy env matching the trained model's observation space
    dummy_prices = pd.DataFrame(
        np.ones((60, n_stocks)) * 1000.0, columns=symbols
    )
    dummy_vec = DummyVecEnv([lambda dp=dummy_prices: PortfolioEnv(dp)])
    vec_env   = VecNormalize.load(str(seed_dir / "vecnormalize.pkl"), dummy_vec)
    vec_env.training    = False   # freeze normalisation stats
    vec_env.norm_reward = False

    ppo_model = PPO.load(str(seed_dir / "ppo_smartchange"), env=vec_env)

    # Load test data using the split boundary saved by this seed's training run
    test_df, _symbols, cutoff_date = _load_seed_test_data(seed_dir)

    results = {}

    # PPO — run_ppo() now returns a rich dict
    ppo = run_ppo(test_df, ppo_model)
    results["ppo_rl"] = _compute_metrics(ppo["log_rets"])
    results["ppo_rl"].update({
        "strategy":               "PPO RL Agent",
        "seed":                   seed,
        "concentration_warnings": ppo["n_conc"],
        "max_weight_seen":        round(ppo["max_w_seen"] * 100, 2),
        "avg_max_weight":         round(ppo["avg_max_w"]  * 100, 2),
        "avg_turnover":           ppo["avg_turnover"],
        "max_turnover":           ppo["max_turnover"],
        "avg_entropy":            ppo["avg_entropy"],
        "min_entropy":            ppo["min_entropy"],
    })
    # Equal-Weight (TC applied in run_equal_weight)
    eq_rets  = run_equal_weight(test_df)
    results["equal_weight"] = _compute_metrics(eq_rets)
    results["equal_weight"]["strategy"] = "Equal-Weight 1/N"
    results["equal_weight"]["seed"]     = seed

    # NIFTY-50 (buy-and-hold, no TC)
    try:
        ppo_rets   = ppo["log_rets"]
        nifty_rets = run_nifty50(cutoff_date)
        min_len    = min(len(ppo_rets), len(nifty_rets))
        results["nifty50"] = _compute_metrics(nifty_rets[:min_len])
        results["nifty50"]["strategy"] = "NIFTY-50 B&H"
        results["nifty50"]["seed"]     = seed
    except Exception as e:
        log.warning(f"  NIFTY-50 failed for seed={seed}: {e}")

    return results


def _load_seed_test_data(seed_dir: Path):
    """Load test data using the split_meta saved in seed_dir."""
    split_meta  = json.loads((seed_dir / "split_meta.json").read_text())
    model_meta  = json.loads((seed_dir / "model_meta.json").read_text())
    cutoff_date = pd.Timestamp(split_meta["cutoff_date"])
    symbols     = model_meta["symbols"]
    tickers     = [s if s.endswith(".NS") else s + ".NS" for s in symbols]

    import yfinance as yf
    raw    = yf.download(tickers, period="5y", auto_adjust=True, progress=False)
    closes = raw["Close"].ffill().dropna()
    closes.columns = [c.replace(".NS", "") for c in closes.columns]
    test_df = closes[closes.index >= cutoff_date].copy()
    return test_df, symbols, cutoff_date


# ── Aggregation ───────────────────────────────────────────────────────────────
def aggregate(all_seed_results: list[dict]) -> dict:
    """
    Compute mean and std across seeds for each strategy.
    Output keys: return_mean/std, vol_mean/std, sharpe_mean/std,
                 sortino_mean/std, maxdd_mean/std, conc_warnings_mean/std,
                 turnover_mean/std, entropy_mean/std.
    """
    strategies = list(all_seed_results[0].keys())
    summary    = {}

    for strat in strategies:
        per_seed = [r[strat] for r in all_seed_results if strat in r]
        vals = lambda key: [p[key] for p in per_seed if key in p]  # noqa: E731

        ret_v  = vals("total_return_pct")
        vol_v  = vals("ann_volatility_pct")
        shr_v  = vals("sharpe_ratio")
        sor_v  = vals("sortino_ratio")
        mdd_v  = vals("max_drawdown_pct")

        summary[strat] = {
            "strategy":      per_seed[0]["strategy"],
            "n_seeds":       len(per_seed),
            "return_mean":   round(float(np.mean(ret_v)),  3),
            "return_std":    round(float(np.std(ret_v,  ddof=0)), 3),
            "vol_mean":      round(float(np.mean(vol_v)),  3),
            "vol_std":       round(float(np.std(vol_v,  ddof=0)), 3),
            "sharpe_mean":   round(float(np.mean(shr_v)),  4),
            "sharpe_std":    round(float(np.std(shr_v,  ddof=0)), 4),
            "sortino_mean":  round(float(np.mean(sor_v)),  4),
            "sortino_std":   round(float(np.std(sor_v,  ddof=0)), 4),
            "maxdd_mean":    round(float(np.mean(mdd_v)),  3),
            "maxdd_std":     round(float(np.std(mdd_v,  ddof=0)), 3),
        }

        # PPO-specific metrics (concentration, turnover, entropy)
        if strat == "ppo_rl":
            conc_v = vals("concentration_warnings")
            turn_v = vals("avg_turnover")
            entr_v = vals("avg_entropy")
            if conc_v:
                summary[strat]["conc_warnings_mean"] = round(float(np.mean(conc_v)), 2)
                summary[strat]["conc_warnings_std"]  = round(float(np.std(conc_v, ddof=0)), 2)
            if turn_v:
                summary[strat]["turnover_mean"] = round(float(np.mean(turn_v)), 6)
                summary[strat]["turnover_std"]  = round(float(np.std(turn_v, ddof=0)), 6)
            if entr_v:
                summary[strat]["entropy_mean"] = round(float(np.mean(entr_v)), 6)
                summary[strat]["entropy_std"]  = round(float(np.std(entr_v, ddof=0)), 6)

    return summary


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    log.info(f"Multi-seed training run — seeds: {SEEDS}")
    log.info(f"Data period: 5y | Transaction cost: {TRANSACTION_COST*100:.2f}%")

    # Download data once — all seeds share the same dataset
    log.info("\n[Phase 1] Downloading market data …")
    closes = download_data()

    all_seed_results: list[dict] = []

    for seed in SEEDS:
        seed_dir = MODELS_DIR / f"seed_{seed}"
        log.info(f"\n{'='*60}")
        log.info(f"[Phase 2] Training seed={seed} → {seed_dir}")

        set_seeds(seed)
        train_df, _ = split_data(closes, out_dir=seed_dir)
        train(train_df, seed=seed, out_dir=seed_dir)
        save_meta(list(closes.columns), closes.shape[1],
                  seed=seed, out_dir=seed_dir)

        log.info(f"[Phase 3] Backtesting seed={seed} …")
        seed_results = backtest_seed(seed, seed_dir)
        all_seed_results.append(seed_results)

        # Save per-seed backtest
        (seed_dir / "backtest_results.json").write_text(
            json.dumps(seed_results, indent=2)
        )
        log.info(f"  PPO return={seed_results['ppo_rl']['total_return_pct']:.2f}%  "
                 f"Sharpe={seed_results['ppo_rl']['sharpe_ratio']:.4f}")

    # Aggregate
    log.info(f"\n{'='*60}")
    log.info(f"[Phase 4] Aggregating results across {len(SEEDS)} seeds …")
    summary = aggregate(all_seed_results)
    summary["meta"] = {
        "seeds":            SEEDS,
        "data_period":      "5y",
        "transaction_cost": TRANSACTION_COST,
        "n_stocks":         closes.shape[1],
    }

    out_path = MODELS_DIR / "multi_seed_results.json"
    out_path.write_text(json.dumps(summary, indent=2))
    log.info(f"\n\u2705 Multi-seed results saved \u2192 {out_path}")

    # ── Console summary table ────────────────────────────────────────────────
    log.info(f"\n{'='*80}")
    log.info(
        f"{'Strategy':<20} "
        f"{'Return% (mean±std)':>22} "
        f"{'Sharpe (mean±std)':>22} "
        f"{'MaxDD (mean±std)':>20}"
    )
    log.info("─" * 80)
    for strat, m in summary.items():
        if strat == "meta":
            continue
        ret_str = f"{m['return_mean']:>6.2f} ± {m['return_std']:<5.2f}"
        shr_str = f"{m['sharpe_mean']:>6.4f} ± {m['sharpe_std']:<6.4f}"
        mdd_str = f"{m['maxdd_mean']:>6.2f} ± {m['maxdd_std']:<5.2f}"
        log.info(f"{m['strategy']:<20}  {ret_str:>20}   {shr_str:>20}   {mdd_str:>18}")

    # PPO-specific metrics
    if "ppo_rl" in summary:
        ppo = summary["ppo_rl"]
        log.info(f"\n{'PPO-Specific Metrics':<20}")
        log.info("─" * 80)
        if "conc_warnings_mean" in ppo:
            log.info(f"  Concentration warnings: {ppo['conc_warnings_mean']:.2f} ± {ppo['conc_warnings_std']:.2f}")
        if "turnover_mean" in ppo:
            log.info(f"  Avg turnover:           {ppo['turnover_mean']:.6f} ± {ppo['turnover_std']:.6f}")
        if "entropy_mean" in ppo:
            log.info(f"  Avg entropy:            {ppo['entropy_mean']:.6f} ± {ppo['entropy_std']:.6f}")
