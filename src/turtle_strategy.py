"""
Turtle Trading Strategy Engine — Python Implementation
======================================================
Complete backtesting engine implementing the classic Turtle Trading System:
- Donchian Channel entry/exit signals
- Wilder ATR for volatility-based position sizing
- Dynamic trailing stop-loss
- Pyramid adding (up to 3-4 adds at 0.5×ATR intervals)
- Commission and slippage modeling

Designed for use in notebooks/task05_analysis.ipynb

Usage:
    from turtle_strategy import TurtleStrategy
    engine = TurtleStrategy(donchian_n=20, atr_m=20, stop_mult=2.0)
    result = engine.run(df)
"""

import numpy as np
import pandas as pd
from typing import Dict, List, Tuple, Optional


class TurtleStrategy:
    """
    Complete Turtle Trading Strategy backtesting engine.

    Parameters
    ----------
    donchian_n : int, default 20
        Donchian Channel lookback period (typical range: 15-35)
    atr_m : int, default 20
        ATR smoothing period (typical range: 15-25)
    stop_mult : float, default 2.0
        Stop-loss distance in ATR multiples (range: 2.0-2.5)
    add_interval : float, default 0.5
        Add position interval in ATR multiples
    max_adds : int, default 3
        Maximum number of add positions
    risk_per_trade : float, default 0.02
        Risk per trade as fraction of equity (2%)
    commission : float, default 0.0003
        One-way commission rate (万三)
    slippage : float, default 0.0001
        One-way slippage (万二)
    initial_capital : float, default 1_000_000
        Starting capital in CNY
    """

    def __init__(
        self,
        donchian_n: int = 20,
        atr_m: int = 20,
        stop_mult: float = 2.0,
        add_interval: float = 0.5,
        max_adds: int = 3,
        risk_per_trade: float = 0.02,
        commission: float = 0.0003,
        slippage: float = 0.0001,
        initial_capital: float = 1_000_000,
    ):
        self.donchian_n = donchian_n
        self.atr_m = atr_m
        self.stop_mult = stop_mult
        self.add_interval = add_interval
        self.max_adds = max_adds
        self.risk_per_trade = risk_per_trade
        self.commission = commission
        self.slippage = slippage
        self.initial_capital = initial_capital

    def run(self, df: pd.DataFrame) -> Dict:
        """
        Execute full backtest on OHLCV DataFrame.

        Parameters
        ----------
        df : pd.DataFrame
            Must contain columns: trade_date (or date), open, high, low, close, vol

        Returns
        -------
        dict with keys:
            'bars'      — processed price data
            'indicators'— computed technical indicators
            'signals'   — trading signal markers
            'trades'    — list of completed trades
            'metrics'   — performance metrics
        """
        # Ensure sorted by date
        df = df.sort_values("trade_date").reset_index(drop=True)
        df = df.copy()

        # Compute indicators
        indicators = self._compute_indicators(df)

        # Generate signals
        signals = self._generate_signals(df, indicators)

        # Simulate trades
        trades, equity_curve = self._simulate_trades(df, indicators, signals)

        # Compute metrics
        metrics = self._compute_metrics(trades, equity_curve, df)

        return {
            "bars": df,
            "indicators": indicators,
            "signals": signals,
            "trades": trades,
            "equity_curve": equity_curve,
            "metrics": metrics,
        }

    def _compute_indicators(self, df: pd.DataFrame) -> Dict:
        """Compute Donchian Channel, ATR, and related indicators."""
        n = self.donchian_n
        m = self.atr_m

        # True Range
        tr = pd.Series(0.0, index=df.index)
        for i in range(len(df)):
            if i == 0:
                tr.iloc[i] = df["high"].iloc[i] - df["low"].iloc[i]
            else:
                hl = df["high"].iloc[i] - df["low"].iloc[i]
                hc = abs(df["high"].iloc[i] - df["close"].iloc[i - 1])
                lc = abs(df["low"].iloc[i] - df["close"].iloc[i - 1])
                tr.iloc[i] = max(hl, hc, lc)

        # Wilder ATR
        atr = pd.Series(np.nan, index=df.index)
        if len(df) >= m:
            atr.iloc[m - 1] = tr.iloc[:m].mean()
            for i in range(m, len(df)):
                atr.iloc[i] = (atr.iloc[i - 1] * (m - 1) + tr.iloc[i]) / m

        atr_pct = atr / df["close"] * 100

        # Donchian Channel
        upper = df["high"].rolling(window=n).max()
        lower = df["low"].rolling(window=n).min()
        middle = (upper + lower) / 2

        # Backfill indicators before they're valid
        upper = upper.bfill()
        lower = lower.bfill()
        middle = middle.bfill()

        return {
            "upper_channel": upper.values.tolist(),
            "lower_channel": lower.values.tolist(),
            "middle_channel": middle.values.tolist(),
            "atr": atr.values.tolist(),
            "atr_pct": atr_pct.values.tolist(),
            "true_range": tr.values.tolist(),
        }

    def _generate_signals(self, df: pd.DataFrame, indicators: Dict) -> List:
        """Generate trading signals using state machine logic."""
        n = self.donchian_n
        upper = indicators["upper_channel"]
        lower = indicators["lower_channel"]
        atr_vals = indicators["atr"]

        signals = [None] * len(df)
        position = 0  # 1=long, -1=short, 0=flat
        entry_price = 0
        stop_price = 0
        add_count = 0

        for i in range(n, len(df)):
            bar = df.iloc[i]
            prev_close = df.iloc[i - 1]["close"]
            prev_upper = upper[i - 1]
            prev_lower = lower[i - 1]
            atr_val = atr_vals[i] if not pd.isna(atr_vals[i]) else bar["high"] - bar["low"]

            if position == 0:
                # Check entry
                if bar["close"] > prev_upper and prev_close <= prev_upper:
                    entry_price = bar["close"]
                    position = 1
                    add_count = 0
                    stop_price = entry_price - self.stop_mult * atr_val
                    signals[i] = {"type": "buy", "price": entry_price, "label": "突破买入"}
                elif bar["close"] < prev_lower and prev_close >= prev_lower:
                    entry_price = bar["close"]
                    position = -1
                    add_count = 0
                    stop_price = entry_price + self.stop_mult * atr_val
                    signals[i] = {"type": "sell", "price": entry_price, "label": "突破卖出"}

            elif position == 1:
                # Trailing stop
                new_stop = bar["close"] - self.stop_mult * atr_val
                if new_stop > stop_price:
                    stop_price = new_stop

                # Add position
                if (
                    add_count < self.max_adds
                    and bar["close"] >= entry_price + (add_count + 1) * self.add_interval * atr_val
                ):
                    entry_price = bar["close"]
                    add_count += 1
                    stop_price = entry_price - self.stop_mult * atr_val
                    signals[i] = {"type": "add", "price": entry_price, "label": f"加仓{add_count}"}

                # Stop loss
                if bar["low"] <= stop_price:
                    signals[i] = {
                        "type": "stop_loss",
                        "price": min(bar["open"], stop_price),
                        "label": "止损离场",
                    }
                    position = 0

                # Exit (reverse signal)
                if position == 1 and bar["close"] < prev_lower and prev_close >= prev_lower:
                    signals[i] = {"type": "exit", "price": bar["close"], "label": "突破离场"}
                    position = 0

            elif position == -1:
                # Trailing stop (shorts go downward)
                new_stop = bar["close"] + self.stop_mult * atr_val
                if new_stop < stop_price:
                    stop_price = new_stop

                # Add position (shorts add as price goes lower)
                if (
                    add_count < self.max_adds
                    and bar["close"] <= entry_price - (add_count + 1) * self.add_interval * atr_val
                ):
                    entry_price = bar["close"]
                    add_count += 1
                    stop_price = entry_price + self.stop_mult * atr_val
                    signals[i] = {"type": "add_short", "price": entry_price, "label": f"加仓{add_count}"}

                # Stop loss
                if bar["high"] >= stop_price:
                    signals[i] = {
                        "type": "stop_loss",
                        "price": max(bar["open"], stop_price),
                        "label": "止损离场",
                    }
                    position = 0

                # Exit
                if position == -1 and bar["close"] > prev_upper and prev_close <= prev_upper:
                    signals[i] = {"type": "exit", "price": bar["close"], "label": "突破离场"}
                    position = 0

        return signals

    def _simulate_trades(
        self, df: pd.DataFrame, indicators: Dict, signals: List
    ) -> Tuple[List[Dict], List[float]]:
        """Simulate trades with position sizing and equity tracking."""
        cash = self.initial_capital
        trades = []
        position = 0  # 0=flat, 1=long, -1=short
        entry_price = 0
        shares = 0
        current_trade = None

        for i in range(len(df)):
            sig = signals[i]
            bar = df.iloc[i]
            comm = self.commission
            slip = self.slippage
            atr_val = (
                indicators["atr"][i]
                if not pd.isna(indicators["atr"][i])
                else bar["high"] - bar["low"]
            )

            if sig is not None:
                if sig["type"] == "buy":
                    risk_amount = cash * self.risk_per_trade
                    stop_dist = self.stop_mult * atr_val
                    shares = max(100, int(risk_amount / stop_dist / 100) * 100)

                    fill_price = sig["price"] * (1 + slip)
                    cost = shares * fill_price * (1 + comm)

                    if cost <= cash:
                        cash -= cost
                        position = 1
                        entry_price = fill_price
                        current_trade = {
                            "entry_date": str(df.iloc[i]["trade_date"]),
                            "entry_price": fill_price,
                            "type": "long",
                            "shares": shares,
                            "exit_date": None,
                            "exit_price": None,
                            "pnl": None,
                            "pnl_pct": None,
                            "holding_days": None,
                            "adds": 0,
                        }
                        trades.append(current_trade)

                elif sig["type"] == "sell":
                    risk_amount = cash * self.risk_per_trade
                    stop_dist = self.stop_mult * atr_val
                    shares = max(100, int(risk_amount / stop_dist / 100) * 100)

                    fill_price = sig["price"] * (1 - slip)
                    cost = shares * fill_price * (1 + comm)

                    if cost <= cash:
                        cash -= cost
                        position = -1
                        entry_price = fill_price
                        current_trade = {
                            "entry_date": str(df.iloc[i]["trade_date"]),
                            "entry_price": fill_price,
                            "type": "short",
                            "shares": shares,
                            "exit_date": None,
                            "exit_price": None,
                            "pnl": None,
                            "pnl_pct": None,
                            "holding_days": None,
                            "adds": 0,
                        }
                        trades.append(current_trade)

                elif sig["type"] == "add" and position == 1 and current_trade:
                    add_shares = max(100, int(shares * 0.5 / 100) * 100)
                    fill_price = sig["price"] * (1 + slip)
                    cost = add_shares * fill_price * (1 + comm)
                    if cost <= cash:
                        cash -= cost
                        current_trade["shares"] += add_shares
                        current_trade["adds"] += 1
                        entry_price = (
                            entry_price * (current_trade["shares"] - add_shares)
                            + fill_price * add_shares
                        ) / current_trade["shares"]

                elif sig["type"] == "add_short" and position == -1 and current_trade:
                    add_shares = max(100, int(shares * 0.5 / 100) * 100)
                    fill_price = sig["price"] * (1 - slip)
                    cost = add_shares * fill_price * (1 + comm)
                    if cost <= cash:
                        cash -= cost
                        current_trade["shares"] += add_shares
                        current_trade["adds"] += 1
                        entry_price = (
                            entry_price * (current_trade["shares"] - add_shares)
                            + fill_price * add_shares
                        ) / current_trade["shares"]

                elif sig["type"] in ("stop_loss", "exit") and position != 0 and current_trade:
                    fill_price = (
                        sig["price"] * (1 - slip)
                        if position == 1
                        else sig["price"] * (1 + slip)
                    )
                    revenue = current_trade["shares"] * fill_price * (1 - comm)
                    cash += revenue

                    current_trade["exit_date"] = str(df.iloc[i]["trade_date"])
                    current_trade["exit_price"] = fill_price
                    pnl_raw = (
                        (fill_price - current_trade["entry_price"]) * current_trade["shares"]
                        if position == 1
                        else (current_trade["entry_price"] - fill_price) * current_trade["shares"]
                    )
                    current_trade["pnl"] = pnl_raw - abs(pnl_raw) * comm * 2
                    current_trade["pnl_pct"] = (
                        (fill_price / current_trade["entry_price"] - 1) * 100
                        if position == 1
                        else (current_trade["entry_price"] / fill_price - 1) * 100
                    )

                    entry_idx = df[df["trade_date"].astype(str) == current_trade["entry_date"]].index
                    if len(entry_idx) > 0:
                        current_trade["holding_days"] = i - entry_idx[0]

                    position = 0
                    current_trade = None

        # Close open position at last bar
        if position != 0 and current_trade:
            last_bar = df.iloc[-1]
            fill_price = last_bar["close"]
            revenue = current_trade["shares"] * fill_price * (1 - self.commission)
            cash += revenue
            current_trade["exit_date"] = str(last_bar["trade_date"])
            current_trade["exit_price"] = fill_price
            pnl_raw = (
                (fill_price - current_trade["entry_price"]) * current_trade["shares"]
                if position == 1
                else (current_trade["entry_price"] - fill_price) * current_trade["shares"]
            )
            current_trade["pnl"] = pnl_raw - abs(pnl_raw) * self.commission * 2
            current_trade["pnl_pct"] = (
                (fill_price / current_trade["entry_price"] - 1) * 100
                if position == 1
                else (current_trade["entry_price"] / fill_price - 1) * 100
            )

        # === Rebuild equity curve bar-by-bar from trade state ===
        # Track cash + position_value for every bar
        equity_curve = []
        eq_cash = self.initial_capital
        eq_position = 0  # 0 flat, 1 long, -1 short
        eq_shares = 0
        eq_entry = 0
        trade_idx = 0
        open_trades = [t for t in trades]  # all trades
        active_trade = None

        for i in range(len(df)):
            bar = df.iloc[i]
            sig = signals[i]

            if sig is not None:
                comm_f = self.commission
                slip_f = self.slippage
                atr_v = (
                    indicators["atr"][i]
                    if not pd.isna(indicators["atr"][i])
                    else bar["high"] - bar["low"]
                )

                if sig["type"] == "buy":
                    risk_amt = eq_cash * self.risk_per_trade
                    stop_d = self.stop_mult * atr_v
                    eq_shares = max(100, int(risk_amt / stop_d / 100) * 100)
                    fill = sig["price"] * (1 + slip_f)
                    cost = eq_shares * fill * (1 + comm_f)
                    if cost <= eq_cash:
                        eq_cash -= cost
                        eq_position = 1
                        eq_entry = fill
                        active_trade = open_trades[trade_idx]
                        trade_idx += 1

                elif sig["type"] == "sell":
                    risk_amt = eq_cash * self.risk_per_trade
                    stop_d = self.stop_mult * atr_v
                    eq_shares = max(100, int(risk_amt / stop_d / 100) * 100)
                    fill = sig["price"] * (1 - slip_f)
                    cost = eq_shares * fill * (1 + comm_f)
                    if cost <= eq_cash:
                        eq_cash -= cost
                        eq_position = -1
                        eq_entry = fill
                        active_trade = open_trades[trade_idx]
                        trade_idx += 1

                elif sig["type"] == "add" and eq_position == 1:
                    add_s = max(100, int(eq_shares * 0.5 / 100) * 100)
                    fill = sig["price"] * (1 + slip_f)
                    cost = add_s * fill * (1 + comm_f)
                    if cost <= eq_cash:
                        eq_cash -= cost
                        eq_shares += add_s
                        eq_entry = (
                            eq_entry * (eq_shares - add_s) + fill * add_s
                        ) / eq_shares

                elif sig["type"] == "add_short" and eq_position == -1:
                    add_s = max(100, int(eq_shares * 0.5 / 100) * 100)
                    fill = sig["price"] * (1 - slip_f)
                    cost = add_s * fill * (1 + comm_f)
                    if cost <= eq_cash:
                        eq_cash -= cost
                        eq_shares += add_s
                        eq_entry = (
                            eq_entry * (eq_shares - add_s) + fill * add_s
                        ) / eq_shares

                elif sig["type"] in ("stop_loss", "exit") and eq_position != 0:
                    fill = (
                        sig["price"] * (1 - slip_f)
                        if eq_position == 1
                        else sig["price"] * (1 + slip_f)
                    )
                    revenue = eq_shares * fill * (1 - comm_f)
                    eq_cash += revenue
                    eq_position = 0
                    eq_shares = 0
                    active_trade = None

            # Calculate portfolio value for this bar
            if eq_position == 1:
                position_value = eq_shares * bar["close"]
                total = eq_cash + position_value
            elif eq_position == -1:
                # For shorts: value = cash + (entry - current) * shares
                position_pnl = (eq_entry - bar["close"]) * eq_shares
                total = eq_cash + eq_shares * eq_entry + position_pnl
            else:
                total = eq_cash

            equity_curve.append(total)

        return trades, equity_curve

    def _compute_metrics(
        self, trades: List[Dict], equity_curve: List[float], df: pd.DataFrame
    ) -> Dict:
        """Compute performance metrics."""
        equity = np.array(equity_curve)
        initial = self.initial_capital
        final = equity[-1]
        total_return = (final - initial) / initial * 100

        # Annualized return
        trading_days = len(df)
        years = trading_days / 244
        ann_return = (pow(final / initial, 1 / years) - 1) * 100 if years > 0 else 0

        # Max drawdown
        peak = np.maximum.accumulate(equity)
        dd = (peak - equity) / peak
        max_dd = dd.max() * 100
        max_dd_start = np.argmax(peak != equity)
        max_dd_end = np.argmax(dd)

        # Sharpe ratio
        daily_returns = np.diff(equity) / equity[:-1]
        mean_ret = np.mean(daily_returns) if len(daily_returns) > 0 else 0
        std_ret = np.std(daily_returns, ddof=1) if len(daily_returns) > 1 else 1
        sharpe = (mean_ret / std_ret * np.sqrt(244)) if std_ret != 0 else 0

        # Win rate
        completed = [t for t in trades if t["exit_price"] is not None]
        winners = [t for t in completed if t["pnl"] and t["pnl"] > 0]
        win_rate = len(winners) / len(completed) * 100 if completed else 0

        # Average holding days
        avg_hold = (
            np.mean([t["holding_days"] for t in completed if t["holding_days"] is not None])
            if completed
            else 0
        )

        # Profit factor
        total_win = sum(t["pnl"] for t in winners) if winners else 0
        total_loss = abs(sum(t["pnl"] for t in completed if t["pnl"] and t["pnl"] <= 0))
        profit_factor = total_win / total_loss if total_loss > 0 else float("inf")

        # Benchmark return
        bench_return = (df["close"].iloc[-1] - df["close"].iloc[0]) / df["close"].iloc[0] * 100

        return {
            "total_return": total_return,
            "annual_return": ann_return,
            "sharpe_ratio": sharpe,
            "max_drawdown": max_dd,
            "max_dd_days": max_dd_end - max_dd_start,
            "win_rate": win_rate,
            "total_trades": len(completed),
            "winning_trades": len(winners),
            "losing_trades": len(completed) - len(winners),
            "avg_holding_days": avg_hold,
            "profit_factor": profit_factor,
            "benchmark_return": bench_return,
            "final_equity": final,
            "initial_capital": initial,
        }
