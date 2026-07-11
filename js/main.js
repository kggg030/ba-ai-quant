/**
 * Main Application Module
 * Data binding, CSV loading, interaction logic, and dashboard orchestration
 *
 * @module MainApp
 */

class TurtleDashboard {
  constructor() {
    this.engine = new TurtleEngine();
    this.renderer = new ChartRenderer();
    this.currentStock = '688981.SH';
    this.stockData = {};
    this.results = {};
    this.isLoading = false;

    this.stocks = [
      { code: '688981.SH', name: '中芯国际', file: './data/task05_stocks/688981.SH.csv' },
      { code: '002594.SZ', name: '比亚迪', file: './data/task05_stocks/002594.SZ.csv' },
      { code: '600900.SH', name: '长江电力', file: './data/task05_stocks/600900.SH.csv' },
      { code: '000333.SZ', name: '美的集团', file: './data/task05_stocks/000333.SZ.csv' },
      { code: '601318.SH', name: '中国平安', file: './data/task05_stocks/601318.SH.csv' },
    ];

    this._init();
  }

  /**
   * Initialize dashboard
   */
  async _init() {
    this._buildUI();
    this._bindEvents();
    await this._loadStockData(this.currentStock);
  }

  /**
   * Build UI elements dynamically
   */
  _buildUI() {
    const stockNameMap = {};
    this.stocks.forEach((s) => (stockNameMap[s.code] = s.name));

    // Build tab navigation
    const tabNav = document.getElementById('stockTabs');
    this.stocks.forEach((stock, idx) => {
      const btn = document.createElement('button');
      btn.className = 'tab-btn' + (idx === 0 ? ' active' : '');
      btn.textContent = stock.name;
      btn.dataset.code = stock.code;
      btn.setAttribute('aria-label', `选择 ${stock.name} (${stock.code})`);
      tabNav.appendChild(btn);
    });

    // Set default values
    document.getElementById('paramN').value = this.engine.config.donchianN;
    document.getElementById('paramM').value = this.engine.config.atrM;
    document.getElementById('paramStopMult').value = this.engine.config.stopMultiplier;
  }

  /**
   * Bind event handlers
   */
  _bindEvents() {
    // Tab switching
    document.getElementById('stockTabs').addEventListener('click', (e) => {
      const btn = e.target.closest('.tab-btn');
      if (!btn) return;
      this._switchStock(btn.dataset.code);
    });

    // Run button
    document.getElementById('btnRun').addEventListener('click', () => this._runAnalysis());

    // Reset button
    document.getElementById('btnReset').addEventListener('click', () => this._resetParams());

    // Window resize
    window.addEventListener('resize', () => this.renderer.resizeAll());
  }

  /**
   * Load data for a stock — tries preloaded JS global first, falls back to fetch
   */
  async _loadStockData(stockCode) {
    if (this.stockData[stockCode]) {
      this._runAnalysis();
      return;
    }

    this._showLoading(stockCode);

    try {
      // Try preloaded global variable first (works with file:// protocol)
      const varName = 'stockData_' + stockCode.replace(/\./g, '_');
      if (typeof window[varName] !== 'undefined' && Array.isArray(window[varName]) && window[varName].length > 0) {
        this.stockData[stockCode] = window[varName];
        this._hideLoading(stockCode);
        this._runAnalysis();
        return;
      }

      // Fallback: try fetching CSV from server (for GitHub Pages / http://)
      const stock = this.stocks.find((s) => s.code === stockCode);
      if (!stock) throw new Error('Stock not found');

      const response = await fetch(stock.file);
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }

      const text = await response.text();
      const data = this._parseCSV(text);

      if (data.length < 720) {
        this._showError(`数据量不足: ${stock.name} 仅有 ${data.length} 条记录，需要至少 720 条。`);
        this._hideLoading(stockCode);
        return;
      }

      this.stockData[stockCode] = data;
      this._hideLoading(stockCode);
      this._runAnalysis();
    } catch (error) {
      this._hideLoading(stockCode);
      this._showError(
        `无法加载数据: ${error.message}。请使用本地服务器运行（python -m http.server 8000）或检查数据文件。`
      );
    }
  }

  /**
   * Parse CSV text to array of objects
   */
  _parseCSV(text) {
    const lines = text.trim().split('\n');
    if (lines.length < 2) return [];

    const headers = lines[0].split(',').map((h) => h.trim());
    const data = [];

    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',');
      if (values.length !== headers.length) continue;

      const row = {};
      headers.forEach((h, idx) => {
        row[h.trim()] = values[idx].trim();
      });
      data.push(row);
    }

    return data;
  }

  /**
   * Switch active stock
   */
  async _switchStock(stockCode) {
    if (this.currentStock === stockCode) return;

    this.currentStock = stockCode;

    // Update tab UI
    document.querySelectorAll('.tab-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.code === stockCode);
    });

    // Load data if needed
    await this._loadStockData(stockCode);
  }

  /**
   * Run backtest analysis
   */
  _runAnalysis() {
    const rawData = this.stockData[this.currentStock];
    if (!rawData) return;

    // Read parameters
    const n = parseInt(document.getElementById('paramN').value) || 20;
    const m = parseInt(document.getElementById('paramM').value) || 20;
    const stopMult = parseFloat(document.getElementById('paramStopMult').value) || 2.0;

    // Update engine config
    this.engine.config.donchianN = n;
    this.engine.config.atrM = m;
    this.engine.config.stopMultiplier = stopMult;

    try {
      const result = this.engine.run(rawData);
      this.results[this.currentStock] = result;
      this._updateDashboard(result);
    } catch (error) {
      this._showError(`回测计算错误: ${error.message}`);
    }
  }

  /**
   * Update all dashboard components
   */
  _updateDashboard(result) {
    const { bars, metrics, trades } = result;
    const stock = this.stocks.find((s) => s.code === this.currentStock);

    // Update metrics cards
    this._updateMetricCards(metrics);

    // Update chart annotations
    this._updateChartAnnotations(stock, metrics);

    // Render charts
    this.renderer.renderPriceWithSignals('chartPrice', result);
    this.renderer.renderATR('chartATR', result);
    this.renderer.renderEquityCurve('chartEquity', result);

    // Render trade scatter only if there are completed trades
    const completed = trades.filter((t) => t.exitPrice !== null);
    if (completed.length > 0) {
      document.getElementById('scatterSection').style.display = '';
      document.getElementById('noTradeMsg').style.display = 'none';
      this.renderer.renderTradeScatter('chartScatter', result);
    } else {
      document.getElementById('scatterSection').style.display = 'none';
      document.getElementById('noTradeMsg').style.display = 'block';
    }

    // Update trade table
    this._updateTradeTable(trades);

    // Update analysis summary
    this._updateSummary(metrics, completed);

    // Hide any error messages
    const errorEl = document.getElementById('errorMessage');
    if (errorEl) errorEl.style.display = 'none';
  }

  /**
   * Update metric cards
   */
  _updateMetricCards(metrics) {
    const cards = [
      { id: 'metricReturn', value: metrics.totalReturn, suffix: '%', fmt: 'pct' },
      { id: 'metricAnnual', value: metrics.annualReturn, suffix: '%', fmt: 'pct' },
      { id: 'metricSharpe', value: metrics.sharpeRatio, suffix: '', fmt: 'dec2' },
      { id: 'metricMDD', value: -metrics.maxDrawdown, suffix: '%', fmt: 'pct' },
      { id: 'metricWinRate', value: metrics.winRate, suffix: '%', fmt: 'pct' },
      { id: 'metricTrades', value: metrics.totalTrades, suffix: '笔', fmt: 'int' },
    ];

    cards.forEach((card) => {
      const el = document.getElementById(card.id);
      if (!el) return;

      let text;
      if (card.fmt === 'pct') {
        text = (card.value >= 0 ? '+' : '') + card.value.toFixed(2) + card.suffix;
      } else if (card.fmt === 'dec2') {
        text = card.value.toFixed(2) + card.suffix;
      } else {
        text = card.value + card.suffix;
      }
      el.textContent = text;

      // Color coding
      el.className = 'metric-value';
      if (card.id === 'metricMDD') {
        // MDD is always negative (show in red when large drawdown)
        if (metrics.maxDrawdown > 20) el.classList.add('negative');
        else if (metrics.maxDrawdown > 10) el.classList.add('neutral');
        else el.classList.add('positive');
      } else if (card.id === 'metricSharpe') {
        if (metrics.sharpeRatio > 1) el.classList.add('positive');
        else if (metrics.sharpeRatio > 0) el.classList.add('neutral');
        else el.classList.add('negative');
      } else if (card.id === 'metricTrades') {
        el.classList.add('neutral');
      } else {
        if (typeof card.value === 'number' && card.value > 0) el.classList.add('positive');
        else if (typeof card.value === 'number' && card.value < 0) el.classList.add('negative');
        else el.classList.add('neutral');
      }
    });
  }

  /**
   * Update chart section annotations
   */
  _updateChartAnnotations(stock, metrics) {
    document.getElementById('chartPriceTitle').textContent =
      `${stock.name} (${stock.code}) — 价格与海龟通道`;
    document.getElementById('chartEquityFooter').textContent =
      `策略累计收益率 ${metrics.totalReturn.toFixed(2)}%，买入持有基准收益率 ${metrics.benchmarkReturn.toFixed(2)}%`;
  }

  /**
   * Update trade table
   */
  _updateTradeTable(trades) {
    const tbody = document.getElementById('tradeTableBody');
    const completed = trades.filter((t) => t.exitPrice !== null);
    tbody.innerHTML = '';

    if (completed.length === 0) {
      tbody.innerHTML =
        '<tr><td colspan="8" style="text-align:center;color:#5a768e;padding:20px;">当前参数下无完整交易记录</td></tr>';
      return;
    }

    // Sort by entry date, most recent first
    const sorted = [...completed].sort(
      (a, b) => b.entryDate.localeCompare(a.entryDate)
    );

    sorted.forEach((t) => {
      const tr = document.createElement('tr');
      const pnlClass = t.pnl >= 0 ? 'trade-buy' : 'trade-sell';
      tr.innerHTML = `
        <td>${t.entryDate}</td>
        <td>${t.exitDate}</td>
        <td>${t.type}</td>
        <td>${t.entryPrice.toFixed(2)}</td>
        <td>${t.exitPrice.toFixed(2)}</td>
        <td>${t.holdingDays}天</td>
        <td class="${pnlClass}">${t.pnlPct.toFixed(2)}%</td>
        <td class="${pnlClass}">¥${t.pnl.toFixed(0)}</td>
      `;
      tbody.appendChild(tr);
    });
  }

  /**
   * Update analysis summary text
   */
  _updateSummary(metrics, trades) {
    const summaryEl = document.getElementById('analysisSummary');
    const stock = this.stocks.find((s) => s.code === this.currentStock);

    let text = `${stock.name} (${stock.code}) 回测总结：\n\n`;
    text += `在 ${this.engine.config.donchianN} 日 Donchian 通道与 ${this.engine.config.atrM} 日 ATR 参数配置下，`;

    if (metrics.totalReturn > 0) {
      text += `策略实现累计收益率 ${metrics.totalReturn.toFixed(2)}%（年化 ${metrics.annualReturn.toFixed(2)}%），`;
    } else {
      text += `策略累计收益率为 ${metrics.totalReturn.toFixed(2)}%，`;
    }

    text += `最大回撤 ${metrics.maxDrawdown.toFixed(2)}%。`;
    text += `同期买入持有收益率为 ${metrics.benchmarkReturn.toFixed(2)}%，`;

    if (metrics.totalReturn > metrics.benchmarkReturn) {
      text += `策略显著跑赢基准。`;
    } else {
      text += `策略未能跑赢基准，可能与标的在该区间内趋势特征不足以支撑海龟策略获利有关。`;
    }

    text += `\n\n共完成 ${metrics.totalTrades} 笔交易，胜率 ${metrics.winRate.toFixed(1)}%，`;
    text += `盈亏比 ${metrics.profitFactor.toFixed(2)}，平均持仓 ${metrics.avgHoldingDays.toFixed(0)} 天。`;
    text += `夏普比率 ${metrics.sharpeRatio.toFixed(2)}，`;

    if (metrics.sharpeRatio > 1) {
      text += `风险调整后收益表现良好。`;
    } else if (metrics.sharpeRatio > 0) {
      text += `风险调整后收益为正，但仍有优化空间。`;
    } else {
      text += `风险调整后收益为负，需审视策略适用性。`;
    }

    summaryEl.textContent = text;
  }

  /**
   * Reset parameters to defaults
   */
  _resetParams() {
    document.getElementById('paramN').value = 20;
    document.getElementById('paramM').value = 20;
    document.getElementById('paramStopMult').value = 2.0;
    this._runAnalysis();
  }

  /**
   * Show loading state
   */
  _showLoading(stockCode) {
    const chartIds = ['chartPrice', 'chartATR', 'chartEquity'];
    chartIds.forEach((id) => {
      const container = document.getElementById(id);
      if (container) {
        const overlay = document.createElement('div');
        overlay.className = 'loading-overlay';
        overlay.id = `loading-${id}`;
        overlay.innerHTML = `<div style="text-align:center"><div class="loading-spinner"></div><div class="loading-text">加载 ${stockCode} 数据中...</div></div>`;
        container.parentElement.style.position = 'relative';
        container.parentElement.appendChild(overlay);
      }
    });
  }

  /**
   * Hide loading state
   */
  _hideLoading(stockCode) {
    const chartIds = ['chartPrice', 'chartATR', 'chartEquity'];
    chartIds.forEach((id) => {
      const overlay = document.getElementById(`loading-${id}`);
      if (overlay) overlay.remove();
    });
  }

  /**
   * Show error message
   */
  _showError(message) {
    let errorEl = document.getElementById('errorMessage');
    if (!errorEl) {
      errorEl = document.createElement('div');
      errorEl.id = 'errorMessage';
      errorEl.className = 'error-message';
      errorEl.setAttribute('role', 'alert');
      const controls = document.querySelector('.controls-panel');
      controls.parentNode.insertBefore(errorEl, controls.nextSibling);
    }
    errorEl.textContent = message;
    errorEl.style.display = 'block';
  }
}

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.dashboard = new TurtleDashboard();
});
