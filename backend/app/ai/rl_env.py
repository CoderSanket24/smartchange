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
        ≈ Sharpe-like risk-adjusted reward
    """

    metadata = {"render_modes": []}

    ROLL_WINDOW = 14   # window for rolling portfolio volatility penalty
    LAMBDA      = 0.1  # volatility penalty weight

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
        self._log_returns = np.log(
            self.price_df / self.price_df.shift(1)
        ).fillna(0.0).values                              # shape (T, N)

        self._sma14 = (
            self.price_df.rolling(14).mean()
              .bfill()
        ).values                                          # shape (T, N)

        self._vol14 = (
            self.price_df.rolling(14).std()
              .bfill()
        ).values                                          # shape (T, N)

        self._rsi14  = self._compute_rsi(self.price_df, 14)  # (T, N) ∈ [0,1]
        self._mom5   = (
            self.price_df.pct_change(5)
              .fillna(0.0)
        ).values                                          # shape (T, N)

        # Per-episode normalisation stats (computed in reset)
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
        """Returns RSI scaled to [0, 1], shape (T, N)."""
        delta   = price_df.diff()
        gain    = delta.clip(lower=0).rolling(period).mean().bfill()
        loss    = (-delta.clip(upper=0)).rolling(period).mean().bfill()
        rs      = gain / (loss + 1e-8)
        rsi     = 100 / (1 + rs)          # note: inverted so high RSI = oversold safe
        return (rsi / 100.0).values       # normalise to [0, 1]

    # ── Episode start ─────────────────────────────────────────────────────────
    def reset(self, *, seed=None, options=None):
        super().reset(seed=seed)

        # Start at step 14 so rolling features are available
        self.t             = 14
        self.portfolio_val = self.initial_bal
        self.weights       = np.ones(self.n_stocks, dtype=np.float64) / self.n_stocks
        self._port_log_rets = []

        # Per-episode normalisation: MinMax over entire episode window
        episode_sma = self._sma14[14:]
        episode_vol = self._vol14[14:]
        self._sma_min = episode_sma.min(axis=0) + 1e-8
        self._sma_max = episode_sma.max(axis=0) + 1e-8
        self._vol_max = episode_vol.max(axis=0)  + 1e-8

        return self._get_obs(), {}

    # ── Observation ───────────────────────────────────────────────────────────
    def _get_obs(self) -> np.ndarray:
        t = self.t
        feats = []
        for i in range(self.n_stocks):
            log_ret  = float(self._log_returns[t, i])
            sma_norm = (self._sma14[t, i] - self._sma_min[i]) / (self._sma_max[i] - self._sma_min[i] + 1e-8)
            vol_norm = self._vol14[t, i] / (self._vol_max[i] + 1e-8)
            rsi_norm = float(self._rsi14[t, i])    # already [0,1]
            mom      = float(self._mom5[t, i])
            cur_w    = float(self.weights[i])
            feats.extend([log_ret, sma_norm, vol_norm, rsi_norm, mom, cur_w])

        # Normalised portfolio value (relative to starting balance)
        port_norm = self.portfolio_val / self.initial_bal
        feats.append(port_norm)

        return np.array(feats, dtype=np.float32)

    # ── Step ──────────────────────────────────────────────────────────────────
    def step(self, action: np.ndarray):
        # ── Safe action normalisation ─────────────────────────────────────
        weights = np.clip(action, 0.0, None).astype(np.float64)
        weights = weights / (weights.sum() + 1e-8)   # L1-normalise to sum=1
        self.weights = weights

        # ── Portfolio return ──────────────────────────────────────────────
        stock_log_rets = self._log_returns[self.t]    # shape (N,)
        port_log_ret   = float(np.dot(weights, stock_log_rets))

        old_val            = self.portfolio_val
        self.portfolio_val = old_val * np.exp(port_log_ret)
        self._port_log_rets.append(port_log_ret)

        # ── Rolling volatility penalty (last ROLL_WINDOW steps) ──────────
        if len(self._port_log_rets) >= self.ROLL_WINDOW:
            rolling_vol = float(np.std(self._port_log_rets[-self.ROLL_WINDOW:]))
        else:
            rolling_vol = 0.0

        reward = port_log_ret - self.LAMBDA * rolling_vol

        # ── Advance timestep ──────────────────────────────────────────────
        self.t   += 1
        done      = self.t >= len(self.price_df) - 1
        truncated = False

        obs  = self._get_obs() if not done else np.zeros(self.observation_space.shape, dtype=np.float32)
        info = {
            "portfolio_value":  self.portfolio_val,
            "port_log_return":  port_log_ret,
            "rolling_vol":      rolling_vol,
        }
        return obs, reward, done, truncated, info

    def render(self):
        pass
