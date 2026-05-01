"""
app/core/config.py
==================
Centralised configuration for the SmartChange RL system.

⚠️  RETRAINING REQUIRED whenever RL_SYMBOLS changes.
    The observation space shape is (n_assets * 6 + 1,) and the action space
    shape is (n_assets,) — both derived dynamically from len(RL_SYMBOLS).
    A change in universe size invalidates the saved model and VecNormalize stats.

    To retrain:
        docker exec -it smartchange_backend python app/ai/rl_train.py
    Then backtest:
        docker exec -it smartchange_backend python app/ai/rl_backtest.py
"""

from pathlib import Path

# ── File-system paths ─────────────────────────────────────────────────────────
AI_DIR     = Path(__file__).resolve().parents[1] / "ai"
MODELS_DIR = AI_DIR / "models"

# ── Stock universe (plain NSE symbols — .NS suffix applied at download time) ──
# ~20 major NSE stocks across diversified sectors.
# ⚠️  Adding / removing symbols here requires a full model retrain.
RL_SYMBOLS: list[str] = [
    "RELIANCE",    # Energy
    "TCS",         # IT
    "INFY",        # IT
    "HDFCBANK",    # Banking
    "WIPRO",       # IT
    "ITC",         # FMCG
    "TATASTEEL",   # Metals
    "AXISBANK",    # Banking
    "SBIN",        # Banking (State Bank)
    "ICICIBANK",   # Banking
    "LT",          # Infrastructure / Engineering
    "BAJFINANCE",  # NBFC
    "MARUTI",      # Auto
    "HINDUNILVR",  # FMCG
    "ASIANPAINT",  # Paints / Consumer
    "TITAN",       # Consumer Durables
    "ULTRACEMCO",  # Cement
    "KOTAKBANK",   # Banking
    "BHARTIARTL",  # Telecom
    "ADANIENT",    # Conglomerate
]

# Maps yfinance base name → STOCK_UNIVERSE key (identity for most; overrides below)
YFINANCE_TO_UNIVERSE: dict[str, str] = {s: s for s in RL_SYMBOLS}
# HDFCBANK is stored as "HDFC" in the portfolio STOCK_UNIVERSE for legacy reasons
YFINANCE_TO_UNIVERSE["HDFCBANK"] = "HDFC"

UNIVERSE_TO_YFINANCE: dict[str, str] = {v: k for k, v in YFINANCE_TO_UNIVERSE.items()}

# ── Data settings ─────────────────────────────────────────────────────────────
DATA_PERIOD:  str   = "5y"    # yfinance download period for training
LIVE_PERIOD:  str   = "90d"   # yfinance download period for inference
TRAIN_FRAC:   float = 0.75    # fraction of data used for training

# ── Environment hyperparameters ───────────────────────────────────────────────
ROLL_WINDOW:      int   = 14    # rolling window for portfolio volatility penalty
RISK_LAMBDA:      float = 0.1   # λ: volatility-penalty weight in reward
# Reward = portfolio_log_return − RISK_LAMBDA * rolling_std(last ROLL_WINDOW returns)

# Transaction cost: fraction of traded value deducted on each rebalance.
# 0.001 = 0.1% one-way (realistic for NSE retail — includes brokerage + STT).
# Set to 0.0 to disable. Applies in rl_env.py step() and rl_backtest.py.
TRANSACTION_COST: float = 0.001

# ── PPO training hyperparameters ──────────────────────────────────────────────
# Increased to 300k timesteps to compensate for larger (20-asset) state space.
TRAIN_TIMESTEPS:   int   = 300_000
PPO_LEARNING_RATE: float = 3e-4
PPO_N_STEPS:       int   = 2048
PPO_BATCH_SIZE:    int   = 64
PPO_N_EPOCHS:      int   = 10
PPO_GAMMA:         float = 0.99
PPO_GAE_LAMBDA:    float = 0.95
PPO_CLIP_RANGE:    float = 0.2
PPO_ENT_COEF:      float = 0.05   # ↑ from 0.01 — promotes diverse allocations, reduces concentration
PPO_VF_COEF:       float = 0.5
PPO_MAX_GRAD_NORM: float = 0.5
LOG_INTERVAL:      int   = 1_000   # reward-logger callback cadence (timesteps)

# ── Model card metadata ───────────────────────────────────────────────────────
MODEL_VERSION: str = "ppo_v2.0"   # bumped — universe expanded to 20 stocks

DATASET_METADATA: dict = {
    "source":    "Yahoo Finance (yfinance)",
    "period":    f"{DATA_PERIOD} daily OHLCV",
    "frequency": "daily",
    "universe":  RL_SYMBOLS,       # dynamic — always reflects current list
    "n_assets":  len(RL_SYMBOLS),
}
