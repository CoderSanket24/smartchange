"""
rl_train.py — Offline PPO Training Script for SmartChange
==========================================================
Run this ONCE inside the Docker backend container:

    docker exec -it smartchange_backend python app/ai/rl_train.py

It will:
  1. Download 2yr NSE data from yfinance
  2. Strict train/test split by date (first 75% = train, last 25% = test)
  3. Train PPO 100k timesteps with VecNormalize
  4. Save:
       app/ai/models/ppo_smartchange.zip
       app/ai/models/vecnormalize.pkl
       app/ai/models/training_log.csv
       app/ai/models/model_meta.json  (training date, timesteps, etc.)

DO NOT import this file from FastAPI — training is offline only.
"""

import os
import sys
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
import pandas as pd
import yfinance as yf
from stable_baselines3 import PPO
from stable_baselines3.common.env_util import make_vec_env
from stable_baselines3.common.vec_env import VecNormalize
from stable_baselines3.common.callbacks import BaseCallback

# Make sure app package is importable when run as a script
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))
from app.ai.rl_env import PortfolioEnv

# ── Configuration ─────────────────────────────────────────────────────────────
SYMBOLS = [
    "RELIANCE.NS", "TCS.NS", "INFY.NS", "HDFCBANK.NS",
    "WIPRO.NS",    "ITC.NS", "TATASTEEL.NS", "AXISBANK.NS",
]
PERIOD        = "2y"           # 2 years of daily OHLCV
TRAIN_FRAC    = 0.75           # first 75% = train (≈18 months)
TIMESTEPS     = 100_000
MODELS_DIR    = Path(__file__).parent / "models"
LOG_INTERVAL  = 1_000          # log every N timesteps

logging.basicConfig(level=logging.INFO, format="%(asctime)s  %(message)s")
log = logging.getLogger(__name__)

MODELS_DIR.mkdir(parents=True, exist_ok=True)


# ── Reward Logger Callback ────────────────────────────────────────────────────
class RewardLogger(BaseCallback):
    """Logs mean episode reward to a CSV every LOG_INTERVAL timesteps."""

    def __init__(self, log_path: Path, log_interval: int = LOG_INTERVAL):
        super().__init__()
        self.log_path     = log_path
        self.log_interval = log_interval
        self.records: list[dict] = []

    def _on_step(self) -> bool:
        if self.n_calls % self.log_interval == 0:
            ep_rews = [ep["r"] for ep in self.model.ep_info_buffer if "r" in ep]
            mean_rew = float(np.mean(ep_rews)) if ep_rews else 0.0
            self.records.append({
                "timestep": self.num_timesteps,
                "mean_reward": mean_rew
            })
            log.info(f"  step={self.num_timesteps:>7d}  mean_reward={mean_rew:.6f}")
        return True

    def _on_training_end(self):
        pd.DataFrame(self.records).to_csv(self.log_path, index=False)
        log.info(f"  Training log saved → {self.log_path}")


# ── Data Download ─────────────────────────────────────────────────────────────
def download_data() -> pd.DataFrame:
    log.info("Downloading NSE data from yfinance …")
    raw = yf.download(SYMBOLS, period=PERIOD, auto_adjust=True, progress=False)
    closes = raw["Close"].dropna(how="all").ffill()
    # Drop any stock with more than 10% missing rows
    missing_frac = closes.isna().mean()
    closes = closes.loc[:, missing_frac < 0.10].dropna()
    closes.columns = [c.replace(".NS", "") for c in closes.columns]
    log.info(f"  Stocks after cleaning: {list(closes.columns)}")
    log.info(f"  Date range: {closes.index[0].date()} → {closes.index[-1].date()} ({len(closes)} days)")
    return closes


# ── Train / Test Split ────────────────────────────────────────────────────────
def split_data(df: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    cutoff_idx = int(len(df) * TRAIN_FRAC)
    cutoff_date = df.index[cutoff_idx]
    train_df = df[df.index <  cutoff_date].copy()
    test_df  = df[df.index >= cutoff_date].copy()
    log.info(f"  Train: {train_df.index[0].date()} → {train_df.index[-1].date()} ({len(train_df)} days)")
    log.info(f"  Test : {test_df.index[0].date()} → {test_df.index[-1].date()} ({len(test_df)} days)")
    # Save split info so backtest can reproduce exact same split
    split_meta = {"cutoff_date": str(cutoff_date.date()), "n_train": len(train_df), "n_test": len(test_df)}
    (MODELS_DIR / "split_meta.json").write_text(json.dumps(split_meta, indent=2))
    return train_df, test_df


# ── Environment Factory ───────────────────────────────────────────────────────
def make_env(price_df: pd.DataFrame):
    def _init():
        return PortfolioEnv(price_df)
    return _init


# ── Training ──────────────────────────────────────────────────────────────────
def train(train_df: pd.DataFrame):
    log.info("Building vectorised environment …")
    vec_env = make_vec_env(make_env(train_df), n_envs=1)
    vec_env = VecNormalize(vec_env, norm_obs=True, norm_reward=True, clip_obs=10.0)

    log.info("Initialising PPO (MlpPolicy) …")
    model = PPO(
        "MlpPolicy",
        vec_env,
        learning_rate   = 3e-4,
        n_steps         = 2048,
        batch_size      = 64,
        n_epochs        = 10,
        gamma           = 0.99,
        gae_lambda      = 0.95,
        clip_range      = 0.2,
        ent_coef        = 0.01,
        vf_coef         = 0.5,
        max_grad_norm   = 0.5,
        verbose         = 0,
    )

    reward_logger = RewardLogger(MODELS_DIR / "training_log.csv")

    log.info(f"Training for {TIMESTEPS:,} timesteps …")
    model.learn(total_timesteps=TIMESTEPS, callback=reward_logger)

    # Save model + normalisation stats
    model.save(str(MODELS_DIR / "ppo_smartchange"))
    vec_env.save(str(MODELS_DIR / "vecnormalize.pkl"))
    log.info(f"  Model saved → {MODELS_DIR / 'ppo_smartchange.zip'}")
    log.info(f"  VecNormalize saved → {MODELS_DIR / 'vecnormalize.pkl'}")

    return model, vec_env


# ── Save Metadata ─────────────────────────────────────────────────────────────
def save_meta(symbols: list[str], n_stocks: int):
    meta = {
        "trained_at":    datetime.now(tz=timezone.utc).isoformat(),
        "timesteps":     TIMESTEPS,
        "symbols":       symbols,
        "n_stocks":      n_stocks,
        "train_frac":    TRAIN_FRAC,
        "roll_window":   PortfolioEnv.ROLL_WINDOW,
        "lambda":        PortfolioEnv.LAMBDA,
        "ppo_params": {
            "lr": 3e-4, "n_steps": 2048, "batch_size": 64,
            "n_epochs": 10, "gamma": 0.99
        },
    }
    (MODELS_DIR / "model_meta.json").write_text(json.dumps(meta, indent=2))
    log.info(f"  Metadata saved → {MODELS_DIR / 'model_meta.json'}")


# ── Entry Point ───────────────────────────────────────────────────────────────
if __name__ == "__main__":
    closes   = download_data()
    train_df, _ = split_data(closes)
    model, _    = train(train_df)
    save_meta(list(closes.columns), closes.shape[1])
    log.info("✅ Training complete.")
