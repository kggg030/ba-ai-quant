/**
 * Turtle Trading Strategy Engine
 * Pure JavaScript implementation for client-side backtesting
 *
 * Implements the classic Turtle Trading System:
 * - Donchian Channel for entry signals
 * - ATR-based position sizing and stop-loss
 * - Pyramid adding (add positions as trend continues)
 * - Dynamic trailing stop
 *
 * @module TurtleEngine
 * @version 1.0.0
 */

class TurtleEngine {
  /**
   * @param {Object} config - Strategy parameters
   * @param {number} config.donchianN - Donchian Channel period (default 20, range 15-35)
   * @param {number} config.atrM - ATR period (default 20, range 15-25)
   * @param {number} config.stopMultiplier - Stop-loss ATR multiplier (default 2.0, range 2.0-2.5)
   * @param {number} config.addInterval - Add position interval in ATR (default 0.5)
   * @param {number} config.maxAdds - Maximum add positions (default 3)
   * @param {number} config.riskPerTrade - Risk per trade as fraction of capital (default 0.02)
   * @param {number} config.commission - Commission rate (default 0.0003)
   * @param {number} config.slippage - Slippage rate (default 0.0001)
   */
  constructor(config = {}) {
    this.config = {
      donchianN: config.donchianN || 20,
      atrM: config.atrM || 20,
      stopMultiplier: config.stopMultiplier || 2.0,
      addInterval: config.addInterval || 0.5,
      maxAdds: config.maxAdds || 3,
      riskPerTrade: config.riskPerTrade || 0.02,
      commission: config.commission || 0.0003,
      slippage: config.slippage || 0.0001,
    };
  }

  /**
   * Process raw OHLCV data — sort, compute indicators, generate signals
   * @param {Array<Object>} rawData - Raw data array from CSV
   * @returns {Object} { bars, indicators, signals, trades, metrics }
   */
  run(rawData) {
    // Sort by date ascending
    const bars = rawData
      .map((d) => ({
        date: d.trade_date || d.date,
        open: parseFloat(d.open),
        high: parseFloat(d.high),
        low: parseFloat(d.low),
        close: parseFloat(d.close),
        volume: parseFloat(d.vol || d.volume || 0),
        amount: parseFloat(d.amount || 0),
      }))
      .filter((d) => !isNaN(d.close) && d.close > 0)
      .sort((a, b) => a.date.localeCompare(b.date));

    if (bars.length < this.config.donchianN + 1) {
      throw new Error(
        `Data too short: ${bars.length} bars, need at least ${this.config.donchianN + 1}`
      );
    }

    // Compute indicators
    const indicators = this._computeIndicators(bars);

    // Generate signals
    const signals = this._generateSignals(bars, indicators);

    // Simulate trades
    const { trades, equityCurve } = this._simulateTrades(bars, indicators, signals);

    // Compute performance metrics
    const metrics = this._computeMetrics(trades, equityCurve, bars);

    return {
      bars,
      indicators,
      signals,
      trades,
      equityCurve,
      metrics,
    };
  }

  /**
   * Compute all technical indicators
   * @private
   */
  _computeIndicators(bars) {
    const len = bars.length;
    const n = this.config.donchianN;
    const m = this.config.atrM;

    const upperChannel = new Array(len).fill(null);
    const lowerChannel = new Array(len).fill(null);
    const middleChannel = new Array(len).fill(null);
    const atr = new Array(len).fill(null);
    const atrPct = new Array(len).fill(null);
    const trueRange = new Array(len).fill(null);

    // Compute True Range
    for (let i = 0; i < len; i++) {
      if (i === 0) {
        trueRange[i] = bars[i].high - bars[i].low;
      } else {
        const hl = bars[i].high - bars[i].low;
        const hc = Math.abs(bars[i].high - bars[i - 1].close);
        const lc = Math.abs(bars[i].low - bars[i - 1].close);
        trueRange[i] = Math.max(hl, hc, lc);
      }
    }

    // Compute ATR using Wilder's smoothing
    if (len >= m) {
      // Initial ATR: Simple average of first M true ranges
      let sum = 0;
      for (let i = 0; i < m; i++) {
        sum += trueRange[i];
      }
      atr[m - 1] = sum / m;

      // Wilder's smoothing for subsequent values
      for (let i = m; i < len; i++) {
        atr[i] = (atr[i - 1] * (m - 1) + trueRange[i]) / m;
      }
    }

    // Compute ATR as percentage of close
    for (let i = 0; i < len; i++) {
      if (atr[i] !== null) {
        atrPct[i] = (atr[i] / bars[i].close) * 100;
      }
    }

    // Compute Donchian Channels
    for (let i = n - 1; i < len; i++) {
      let highest = bars[i].high;
      let lowest = bars[i].low;
      for (let j = i - n + 1; j <= i; j++) {
        if (bars[j].high > highest) highest = bars[j].high;
        if (bars[j].low < lowest) lowest = bars[j].low;
      }
      upperChannel[i] = parseFloat(highest.toFixed(2));
      lowerChannel[i] = parseFloat(lowest.toFixed(2));
      middleChannel[i] = parseFloat(((highest + lowest) / 2).toFixed(2));
    }

    // Backfill channels for earlier bars
    for (let i = n - 2; i >= 0; i--) {
      upperChannel[i] = upperChannel[n - 1];
      lowerChannel[i] = lowerChannel[n - 1];
      middleChannel[i] = middleChannel[n - 1];
    }

    return {
      upperChannel,
      lowerChannel,
      middleChannel,
      atr,
      atrPct,
      trueRange,
    };
  }

  /**
   * Generate trading signals using state machine logic
   * States: 0=no position, 1=holding long, -1=holding short
   * @private
   */
  _generateSignals(bars, indicators) {
    const len = bars.length;
    const signals = new Array(len).fill(null);
    const trades = [];

    const n = this.config.donchianN;
    let position = 0;
    let entryPrice = 0;
    let stopPrice = 0;
    let addCount = 0;
    let entryBar = 0;

    for (let i = n; i < len; i++) {
      const bar = bars[i];
      const prevClose = bars[i - 1].close;
      const upper = indicators.upperChannel[i];
      const lower = indicators.lowerChannel[i];

      // Note: In real turtle trading, signals are based on the PREVIOUS bar's channel
      // and trade is executed at the NEXT bar's open
      const prevUpper = indicators.upperChannel[i - 1];
      const prevLower = indicators.lowerChannel[i - 1];

      if (position === 0) {
        // No position: check for entry signals
        if (bar.close > prevUpper && prevClose <= prevUpper) {
          // Long entry — price breaks above upper channel
          entryPrice = bar.close;
          position = 1;
          addCount = 0;
          entryBar = i;
          const atrVal = indicators.atr[i] || (bar.high - bar.low);
          stopPrice = entryPrice - this.config.stopMultiplier * atrVal;
          signals[i] = {
            type: 'buy',
            price: entryPrice,
            label: '突破买入',
            position: 1,
          };
        } else if (bar.close < prevLower && prevClose >= prevLower) {
          // Short entry — price breaks below lower channel
          entryPrice = bar.close;
          position = -1;
          addCount = 0;
          entryBar = i;
          const atrVal = indicators.atr[i] || (bar.high - bar.low);
          stopPrice = entryPrice + this.config.stopMultiplier * atrVal;
          signals[i] = {
            type: 'sell',
            price: entryPrice,
            label: '突破卖出',
            position: -1,
          };
        }
      } else if (position === 1) {
        // Holding long position
        // Update stop (trailing)
        const atrVal = indicators.atr[i] || (bar.high - bar.low);
        const newStop = bar.close - this.config.stopMultiplier * atrVal;
        if (newStop > stopPrice) {
          stopPrice = newStop;
        }

        // Check add condition
        if (
          addCount < this.config.maxAdds &&
          bar.close >= entryPrice + (addCount + 1) * this.config.addInterval * atrVal
        ) {
          entryPrice = bar.close;
          addCount++;
          stopPrice = entryPrice - this.config.stopMultiplier * atrVal;
          signals[i] = {
            type: 'add',
            price: entryPrice,
            label: `加仓${addCount}`,
            position: 1,
          };
        }

        // Check stop loss
        if (bar.low <= stopPrice) {
          const exitPrice = Math.min(bar.open, stopPrice);
          signals[i] = {
            type: 'stop_loss',
            price: exitPrice,
            label: '止损离场',
            position: 0,
          };
          position = 0;
          stopPrice = 0;
        }

        // Check exit (break below lower channel)
        if (position === 1 && bar.close < prevLower && prevClose >= prevLower) {
          signals[i] = {
            type: 'exit',
            price: bar.close,
            label: '突破离场',
            position: 0,
          };
          position = 0;
          stopPrice = 0;
        }
      } else if (position === -1) {
        // Holding short position
        const atrVal = indicators.atr[i] || (bar.high - bar.low);
        const newStop = bar.close + this.config.stopMultiplier * atrVal;
        if (newStop < stopPrice) {
          stopPrice = newStop;
        }

        // Check add condition (for shorts, price goes lower)
        if (
          addCount < this.config.maxAdds &&
          bar.close <= entryPrice - (addCount + 1) * this.config.addInterval * atrVal
        ) {
          entryPrice = bar.close;
          addCount++;
          stopPrice = entryPrice + this.config.stopMultiplier * atrVal;
          signals[i] = {
            type: 'add_short',
            price: entryPrice,
            label: `加仓${addCount}`,
            position: -1,
          };
        }

        // Check stop loss (for shorts, stop is above)
        if (bar.high >= stopPrice) {
          const exitPrice = Math.max(bar.open, stopPrice);
          signals[i] = {
            type: 'stop_loss',
            price: exitPrice,
            label: '止损离场',
            position: 0,
          };
          position = 0;
          stopPrice = 0;
        }

        // Check exit (break above upper channel)
        if (position === -1 && bar.close > prevUpper && prevClose <= prevUpper) {
          signals[i] = {
            type: 'exit',
            price: bar.close,
            label: '突破离场',
            position: 0,
          };
          position = 0;
          stopPrice = 0;
        }
      }
    }

    return signals;
  }

  /**
   * Simulate trading with position sizing and equity tracking
   * @private
   */
  _simulateTrades(bars, indicators, signals) {
    const len = bars.length;
    const trades = [];

    let cash = 1000000; // Initial capital: 1M ¥
    let position = 0;
    let entryPrice = 0;
    let shares = 0;
    let currentTrade = null;

    // Pass 1: Execute trades based solely on signals (cash accounting)
    for (let i = 0; i < len; i++) {
      const sig = signals[i];
      if (!sig) continue;

      const bar = bars[i];
      const comm = this.config.commission;
      const slip = this.config.slippage;
      const atrVal = indicators.atr[i] || (bar.high - bar.low);

      if (sig.type === 'buy') {
        const atrVal = indicators.atr[i] || bars[i].high - bars[i].low;
        const riskAmount = cash * this.config.riskPerTrade;
        const stopDist = this.config.stopMultiplier * atrVal;
        shares = Math.floor(riskAmount / stopDist / 100) * 100;
        if (shares < 100) shares = 100;

        const fillPrice = sig.price * (1 + slip);
        const cost = shares * fillPrice * (1 + comm);

        if (cost <= cash) {
          cash -= cost;
          position = 1;
          entryPrice = fillPrice;
          currentTrade = {
            entryDate: bars[i].date,
            entryPrice: fillPrice,
            type: 'long',
            shares: shares,
            exitDate: null,
            exitPrice: null,
            pnl: null,
            pnlPct: null,
            holdingDays: null,
            adds: 0,
          };
          trades.push(currentTrade);
        }
      } else if (sig.type === 'sell') {
        const atrVal = indicators.atr[i] || bars[i].high - bars[i].low;
        const riskAmount = cash * this.config.riskPerTrade;
        const stopDist = this.config.stopMultiplier * atrVal;
        shares = Math.floor(riskAmount / stopDist / 100) * 100;
        if (shares < 100) shares = 100;

        const fillPrice = sig.price * (1 - slip);
        const cost = shares * fillPrice * (1 + comm);

        if (cost <= cash) {
          cash -= cost;
          position = -1;
          entryPrice = fillPrice;
          currentTrade = {
            entryDate: bars[i].date,
            entryPrice: fillPrice,
            type: 'short',
            shares: shares,
            exitDate: null,
            exitPrice: null,
            pnl: null,
            pnlPct: null,
            holdingDays: null,
            adds: 0,
          };
          trades.push(currentTrade);
        }
      } else if (sig.type === 'add' && position === 1 && currentTrade) {
        const addShares = Math.floor(shares * 0.5 / 100) * 100;
        if (addShares >= 100) {
          const fillPrice = sig.price * (1 + slip);
          const cost = addShares * fillPrice * (1 + comm);
          if (cost <= cash) {
            cash -= cost;
            currentTrade.shares += addShares;
            currentTrade.adds++;
            entryPrice =
              (entryPrice * (currentTrade.shares - addShares) + fillPrice * addShares) /
              currentTrade.shares;
          }
        }
      } else if (sig.type === 'add_short' && position === -1 && currentTrade) {
        const addShares = Math.floor(shares * 0.5 / 100) * 100;
        if (addShares >= 100) {
          const fillPrice = sig.price * (1 - slip);
          const cost = addShares * fillPrice * (1 + comm);
          if (cost <= cash) {
            cash -= cost;
            currentTrade.shares += addShares;
            currentTrade.adds++;
            entryPrice =
              (entryPrice * (currentTrade.shares - addShares) + fillPrice * addShares) /
              currentTrade.shares;
          }
        }
      } else if (sig.type === 'stop_loss' || sig.type === 'exit') {
        if (position !== 0 && currentTrade) {
          const fillPrice =
            position === 1 ? sig.price * (1 - slip) : sig.price * (1 + slip);
          const revenue = currentTrade.shares * fillPrice * (1 - comm);
          cash += revenue;

          currentTrade.exitDate = bars[i].date;
          currentTrade.exitPrice = fillPrice;
          const pnl =
            position === 1
              ? (fillPrice - currentTrade.entryPrice) * currentTrade.shares
              : (currentTrade.entryPrice - fillPrice) * currentTrade.shares;
          currentTrade.pnl = pnl - Math.abs(pnl) * comm * 2;
          currentTrade.pnlPct =
            position === 1
              ? ((fillPrice / currentTrade.entryPrice - 1) * 100)
              : ((currentTrade.entryPrice / fillPrice - 1) * 100);

          const entryIdx = bars.findIndex((b) => b.date === currentTrade.entryDate);
          const exitIdx = bars.findIndex((b) => b.date === currentTrade.exitDate);
          currentTrade.holdingDays = exitIdx - entryIdx;

          position = 0;
          entryPrice = 0;
          shares = 0;
          currentTrade = null;
        }
      }
    }

    // Close any open position at last bar
    if (position !== 0 && currentTrade) {
      const lastBar = bars[len - 1];
      const fillPrice = lastBar.close;
      const revenue = currentTrade.shares * fillPrice * (1 - this.config.commission);
      cash += revenue;

      currentTrade.exitDate = lastBar.date;
      currentTrade.exitPrice = fillPrice;
      const pnl =
        position === 1
          ? (fillPrice - currentTrade.entryPrice) * currentTrade.shares
          : (currentTrade.entryPrice - fillPrice) * currentTrade.shares;
      currentTrade.pnl = pnl - Math.abs(pnl) * this.config.commission * 2;
      currentTrade.pnlPct =
        position === 1
          ? ((fillPrice / currentTrade.entryPrice - 1) * 100)
          : ((currentTrade.entryPrice / fillPrice - 1) * 100);

      const entryIdx = bars.findIndex((b) => b.date === currentTrade.entryDate);
      currentTrade.holdingDays = len - 1 - entryIdx;
    }

    // === Rebuild equity curve bar-by-bar (total portfolio value) ===
    const equityCurve = new Array(len).fill(0);
    let eqCash = 1000000;
    let eqPosition = 0;
    let eqShares = 0;
    let eqEntry = 0;
    let tradePtr = 0;

    for (let i = 0; i < len; i++) {
      const bar = bars[i];
      const sig = signals[i];

      if (sig) {
        const cf = this.config.commission;
        const sf = this.config.slippage;
        const av = indicators.atr[i] || (bar.high - bar.low);

        if (sig.type === 'buy') {
          const ra = eqCash * this.config.riskPerTrade;
          const sd = this.config.stopMultiplier * av;
          eqShares = Math.max(100, Math.floor(ra / sd / 100) * 100);
          const fill = sig.price * (1 + sf);
          const cost = eqShares * fill * (1 + cf);
          if (cost <= eqCash) {
            eqCash -= cost;
            eqPosition = 1;
            eqEntry = fill;
            tradePtr++;
          }
        } else if (sig.type === 'sell') {
          const ra = eqCash * this.config.riskPerTrade;
          const sd = this.config.stopMultiplier * av;
          eqShares = Math.max(100, Math.floor(ra / sd / 100) * 100);
          const fill = sig.price * (1 - sf);
          const cost = eqShares * fill * (1 + cf);
          if (cost <= eqCash) {
            eqCash -= cost;
            eqPosition = -1;
            eqEntry = fill;
            tradePtr++;
          }
        } else if (sig.type === 'add' && eqPosition === 1) {
          const addS = Math.max(100, Math.floor(eqShares * 0.5 / 100) * 100);
          const fill = sig.price * (1 + sf);
          const cost = addS * fill * (1 + cf);
          if (cost <= eqCash) {
            eqCash -= cost;
            eqShares += addS;
            eqEntry = (eqEntry * (eqShares - addS) + fill * addS) / eqShares;
          }
        } else if (sig.type === 'add_short' && eqPosition === -1) {
          const addS = Math.max(100, Math.floor(eqShares * 0.5 / 100) * 100);
          const fill = sig.price * (1 - sf);
          const cost = addS * fill * (1 + cf);
          if (cost <= eqCash) {
            eqCash -= cost;
            eqShares += addS;
            eqEntry = (eqEntry * (eqShares - addS) + fill * addS) / eqShares;
          }
        } else if ((sig.type === 'stop_loss' || sig.type === 'exit') && eqPosition !== 0) {
          const fill = eqPosition === 1 ? sig.price * (1 - sf) : sig.price * (1 + sf);
          eqCash += eqShares * fill * (1 - cf);
          eqPosition = 0;
          eqShares = 0;
        }
      }

      // Portfolio value for this bar
      let total;
      if (eqPosition === 1) {
        total = eqCash + eqShares * bar.close;
      } else if (eqPosition === -1) {
        const posPnl = (eqEntry - bar.close) * eqShares;
        total = eqCash + eqShares * eqEntry + posPnl;
      } else {
        total = eqCash;
      }
      equityCurve[i] = total;
    }

    return { trades, equityCurve };
  }

  /**
   * Compute performance metrics
   * @private
   */
  _computeMetrics(trades, equityCurve, bars) {
    const len = equityCurve.length;
    const initialCapital = 1000000;
    const finalEquity = equityCurve[len - 1];
    const totalReturn = ((finalEquity - initialCapital) / initialCapital) * 100;

    // Annualized return (assuming ~244 trading days per year)
    const tradingDays = len;
    const years = tradingDays / 244;
    const annualReturn = (Math.pow(finalEquity / initialCapital, 1 / years) - 1) * 100;

    // Max Drawdown
    let peak = equityCurve[0];
    let maxDD = 0;
    let maxDDStart = 0;
    let maxDDEnd = 0;
    let ddStart = 0;

    for (let i = 0; i < len; i++) {
      if (equityCurve[i] > peak) {
        peak = equityCurve[i];
        ddStart = i;
      }
      const dd = (peak - equityCurve[i]) / peak;
      if (dd > maxDD) {
        maxDD = dd;
        maxDDStart = ddStart;
        maxDDEnd = i;
      }
    }

    // Daily returns for Sharpe ratio
    const dailyReturns = [];
    for (let i = 1; i < len; i++) {
      dailyReturns.push((equityCurve[i] - equityCurve[i - 1]) / equityCurve[i - 1]);
    }

    const meanReturn =
      dailyReturns.reduce((sum, r) => sum + r, 0) / (dailyReturns.length || 1);
    const variance =
      dailyReturns.reduce((sum, r) => sum + (r - meanReturn) ** 2, 0) /
      (dailyReturns.length || 1);
    const stdDev = Math.sqrt(variance);
    const sharpeRatio =
      stdDev !== 0 ? (meanReturn / stdDev) * Math.sqrt(244) : 0;

    // Win rate
    const completedTrades = trades.filter((t) => t.exitPrice !== null);
    const winningTrades = completedTrades.filter((t) => t.pnl > 0);
    const winRate = completedTrades.length > 0
      ? (winningTrades.length / completedTrades.length) * 100
      : 0;

    // Average holding days
    const avgHoldingDays =
      completedTrades.length > 0
        ? completedTrades.reduce((s, t) => s + (t.holdingDays || 0), 0) /
          completedTrades.length
        : 0;

    // Total PnL
    const totalPnl = completedTrades.reduce((s, t) => s + (t.pnl || 0), 0);

    // Average win / average loss
    const wins = completedTrades.filter((t) => t.pnl > 0);
    const losses = completedTrades.filter((t) => t.pnl <= 0);
    const avgWin = wins.length > 0 ? wins.reduce((s, t) => s + t.pnl, 0) / wins.length : 0;
    const avgLoss =
      losses.length > 0
        ? losses.reduce((s, t) => s + Math.abs(t.pnl), 0) / losses.length
        : 0;
    const profitFactor =
      avgLoss !== 0
        ? (wins.reduce((s, t) => s + t.pnl, 0) /
            Math.abs(losses.reduce((s, t) => s + t.pnl, 0)))
        : 0;

    // Benchmark: buy & hold return
    const benchReturn =
      ((bars[len - 1].close - bars[0].close) / bars[0].close) * 100;

    return {
      totalReturn,
      annualReturn,
      sharpeRatio,
      maxDrawdown: maxDD * 100,
      maxDrawdownDuration: maxDDEnd - maxDDStart,
      winRate,
      totalTrades: completedTrades.length,
      winningTrades: winningTrades.length,
      losingTrades: losses.length,
      avgHoldingDays,
      totalPnl,
      avgWin,
      avgLoss,
      profitFactor,
      benchmarkReturn: benchReturn,
      finalEquity,
      initialCapital,
    };
  }
}

// Export for use in other modules
if (typeof module !== 'undefined' && module.exports) {
  module.exports = TurtleEngine;
}
