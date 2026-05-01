"""
rl_env.py — Custom Gymnasium Portfolio Environment for SmartChange
=========================================================
Design decisions:
  - Log returns (not raw prices) → additive, stable, academically standard
  - Per-episode MinMax normalisation of SMA/volatility features
  - Rolling 14-period portfolio std for volatility penalty (not full-episode)
  - Action: Box(-1, 1, n_stocks) → clip(0) → L1-normalise inside step()
  - VecNormalize wraps this env during training for obs/reward normalisation
"""

import numpy as np
import pandas as pd
import gymnasium as gym
from gymnasium import spaces

from app.core.config import ROLL_WINDOW, RISK_LAMBDA, TRANSACTION_COST


class PortfolioEnv(gym.Env):
    """
    A portfolio allocation environment for PPO training.

    Observation (per step):
        For each stock (n_stocks × 6 features):
            [log_return, sma_norm, vol_norm, rsi_norm, momentum, cur_weight]
        + 1 scalar: normalised current portfolio value
        Total shape: (n_stocks * 6 + 1,)

    Action:
        Box(-1, 1, shape=(n_stocks,))
        Inside step(): clip to [0,∞), then L1-normalise → allocation weights

    Reward:
        log(portfolio_value_t / portfolio_value_{t-1})
        − λ * rolling_std(last ROLL_WINDOW portfolio log-returns)
        − turnover_penalty * turnover  (0.01 per unit turnover)
        − conc_penalty * max(0, max_weight - 0.40)  (1.0 coefficient)
        ≈ Sharpe-like risk-adjusted reward with diversification incentives
    """

    metadata = {"render_modes": []}

    ROLL_WINDOW      = ROLL_WINDOW       # rolling vol-penalty window (from config)
    LAMBDA           = RISK_LAMBDA       # volatility penalty weight (from config)
    TRANSACTION_COST = TRANSACTION_COST  # one-way cost fraction (from config)
    CONC_MAX_WEIGHT  = 0.50              # ↑ from 0.40 — penalty kicks in above 50%
    CONC_PENALTY     = 0.75             # ↓ from 1.00 — moderate concentration discouragement
    TURNOVER_PENALTY = 0.001            # ↓ from 0.01 — light nudge against over-trading

    def __init__(self, price_df: pd.DataFrame, initial_balance: float = 10_000.0):
        """
        Args:
            price_df: DataFrame with shape (T, N) — columns are stock symbols,
                      index is DatetimeIndex, values are adjusted close prices.
            initial_balance: Starting virtual portfolio value (₹).
        """
        super().__init__()

        self.price_df     = price_df.astype(np.float64)
        self.n_stocks     = price_df.shape[1]
        self.symbols      = list(price_df.columns)
        self.initial_bal  = initial_balance

        # ── Feature pre-computation ───────────────────────────────────────────
        # CAUSAL ONLY: all arrays use only data from t=0..t, never future candles.

        # Log returns: r_t = log(P_t / P_{t-1}); row 0 is NaN → fill with 0
        self._log_returns = np.log(
            self.price_df / self.price_df.shift(1)
        ).fillna(0.0).values                              # shape (T, N)

        # SMA-14: min_periods=1 avoids NaN at rows 0-12 (causal, no future data)
        sma14_df = self.price_df.rolling(14, min_periods=1).mean()
        self._sma14 = sma14_df.values                     # shape (T, N)

        # Vol-14: std with min_periods=2 (std undefined for 1 sample); fill 0 rows
        vol14_df = (
            self.price_df.rolling(14, min_periods=2).std()
            .bfill()              # fill initial rows with first valid std
            .fillna(1e-8)         # safety: any remaining NaN → tiny positive
            .replace(0.0, 1e-8)   # guard divide-by-zero
        )
        self._vol14 = vol14_df.values                     # shape (T, N)

        self._rsi14  = self._compute_rsi(self.price_df, 14)  # (T, N) ∈ [0,1]
        self._mom5   = (
            self.price_df.pct_change(5)
              .fillna(0.0)
        ).values                                          # shape (T, N)

        # ── Causal normalisation arrays (expanding window, no future data) ───
        # sma_min[t] = min(sma14[0..t])  — O(T), strictly causal
        self._sma_min_arr = np.minimum.accumulate(self._sma14, axis=0) + 1e-8
        self._sma_max_arr = np.maximum.accumulate(self._sma14, axis=0) + 1e-8
        self._vol_max_arr = np.maximum.accumulate(self._vol14, axis=0) + 1e-8

        # Per-episode normalisation scratch (kept for API compat — no longer used)
        self._sma_min  = None
        self._sma_max  = None
        self._vol_max  = None

        # ── Spaces ───────────────────────────────────────────────────────────
        n_obs = self.n_stocks * 6 + 1
        self.observation_space = spaces.Box(
            low=-np.inf, high=np.inf, shape=(n_obs,), dtype=np.float32
        )
        # PPO outputs in (-1, 1); we clip+normalise inside step()
        self.action_space = spaces.Box(
            low=-1.0, high=1.0, shape=(self.n_stocks,), dtype=np.float32
        )

        # State variables (initialised in reset)
        self.t              = 0
        self.portfolio_val  = initial_balance
        self.weights        = np.ones(self.n_stocks, dtype=np.float64) / self.n_stocks
        self._port_log_rets = []   # rolling portfolio returns for vol penalty

    # ── RSI helper ────────────────────────────────────────────────────────────
    @staticmethod
    def _compute_rsi(price_df: pd.DataFrame, period: int = 14) -> np.ndarray:
        """Returns RSI scaled to [0, 1], shape (T, N). Uses causal rolling mean."""
        delta = price_df.diff().fillna(0.0)          # row 0 diff = 0 (no future)
        gain  = delta.clip(lower=0).rolling(period, min_periods=1).mean()
        loss  = (-delta.clip(upper=0)).rolling(period, min_periods=1).mean()
        rs    = gain / (loss + 1e-8)
        rsi   = 100 / (1 + rs)          # inverted: high value = oversold
        return (rsi / 100.0).fillna(0.5).values   # NaN safety: 0.5 = neutral

    # ── Episode start ─────────────────────────────────────────────────────────
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        # Start at step 14 so all rolling features have full 14-day history
        self.t             = 14
        self.portfolio_val = self.initial_bal
        self.weights       = np.ones(self.n_stocks, dtype=np.float64) / self.n_stocks
        self._port_log_rets = []

        return self._get_obs(), {}

    # ── Observation ───────────────────────────────────────────────────────────
    def _get_obs(self) -> np.ndarray:
        t = self.t
        feats = []
        for i in range(self.n_stocks):
            log_ret  = float(self._log_returns[t, i])
            # Causal normalization: use expanding-window min/max up to step t
            sma_min  = self._sma_min_arr[t, i]
            sma_max  = self._sma_max_arr[t, i]
            sma_norm = (self._sma14[t, i] - sma_min) / (sma_max - sma_min + 1e-8)
            vol_norm = self._vol14[t, i] / (self._vol_max_arr[t, i] + 1e-8)
            rsi_norm = float(self._rsi14[t, i])    # already [0,1]
            mom      = float(self._mom5[t, i])
            cur_w    = float(self.weights[i])
            feats.extend([log_ret, sma_norm, vol_norm, rsi_norm, mom, cur_w])

        # Normalised portfolio value (relative to starting balance)
        port_norm = self.portfolio_val / self.initial_bal
        feats.append(port_norm)

        obs = np.array(feats, dtype=np.float32)
        # Hard NaN guard — replace any residual NaN/Inf with 0 so PPO never crashes
        obs = np.nan_to_num(obs, nan=0.0, posinf=1.0, neginf=-1.0)
        return obs

    # ── Step ──────────────────────────────────────────────────────────────────
    def step(self, action: np.ndarray):
        # ── Safe action normalisation ────────────────────────────────
        new_weights = np.clip(action, 0.0, None).astype(np.float64)
        new_weights = new_weights / (new_weights.sum() + 1e-8)   # L1-normalise

        # ── Transaction cost (turnover-based) ─────────────────────────
        # turnover = sum of absolute weight changes (one-way, ∈ [0, 2])
        turnover   = float(np.abs(new_weights - self.weights).sum())
        tc_cost    = self.TRANSACTION_COST * turnover           # fraction of value
        tc_log     = float(np.log(1.0 - tc_cost + 1e-8))       # log-space deduction
        self.weights = new_weights

        # ── Portfolio gross return (before transaction cost) ────────────
        stock_log_rets = self._log_returns[self.t]              # shape (N,)
        gross_log_ret  = float(np.dot(new_weights, stock_log_rets))

        # Net return = gross minus transaction cost
        port_log_ret   = gross_log_ret + tc_log

        old_val            = self.portfolio_val
        self.portfolio_val = old_val * np.exp(port_log_ret)
        self._port_log_rets.append(port_log_ret)

        # ── Rolling volatility penalty (last ROLL_WINDOW steps) ────────
        if len(self._port_log_rets) >= self.ROLL_WINDOW:
            rolling_vol = float(np.std(self._port_log_rets[-self.ROLL_WINDOW:]))
        else:
            rolling_vol = 0.0

        reward = port_log_ret - self.LAMBDA * rolling_vol

        # ── Turnover penalty ──────────────────────────────────────
        # Discourages excessive rebalancing by penalizing large weight changes.
        # turnover already computed above for transaction costs
        turnover_penalty = self.TURNOVER_PENALTY * turnover
        reward          -= turnover_penalty

        # ── Concentration penalty ──────────────────────────────────
        # Discourages any allocation exceeding 40% in a single stock.
        max_weight     = float(new_weights.max())
        conc_excess    = max(0.0, max_weight - self.CONC_MAX_WEIGHT)
        conc_penalty   = self.CONC_PENALTY * conc_excess    # 1.00 × excess
        reward        -= conc_penalty

        # ── Turnover penalty ────────────────────────────────────
        # Penalises excessive rebalancing; turnover already computed above.
        turnover_penalty = self.TURNOVER_PENALTY * turnover  # 0.01 × Σ|Δw|
        reward          -= turnover_penalty

        # ── Advance timestep ─────────────────────────────────────
        self.t   += 1
        done      = self.t >= len(self.price_df) - 1
        truncated = False

        obs  = self._get_obs() if not done else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {
            "portfolio_value":  self.portfolio_val,
            "port_log_return":  port_log_ret,
            "gross_log_return": gross_log_ret,
            "transaction_cost": tc_cost,
            "turnover":         turnover,
            "turnover_penalty": turnover_penalty,
            "rolling_vol":      rolling_vol,
            "max_weight":       max_weight,
            "conc_penalty":     conc_penalty,
        }
        return obs, reward, done, truncated, info

    def render(self):
        pass
