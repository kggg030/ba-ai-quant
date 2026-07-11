/**
 * Chart Rendering Module
 * Uses locally bundled ECharts for all visualizations
 *
 * @module ChartRenderer
 * @requires echarts (loaded from assets/echarts.min.js)
 */

class ChartRenderer {
  constructor() {
    this.charts = {};
    this.theme = 'dark';
  }

  /**
   * Initialize a chart in a DOM container
   * @param {string} containerId - DOM element ID
   * @returns {object} echarts instance
   */
  initChart(containerId) {
    const container = document.getElementById(containerId);
    if (!container) {
      console.error(`Chart container #${containerId} not found`);
      return null;
    }

    // Dispose existing chart if any
    if (this.charts[containerId]) {
      this.charts[containerId].dispose();
    }

    const chart = echarts.init(container, this.theme);
    this.charts[containerId] = chart;
    return chart;
  }

  /**
   * Chart 1: Price + Donchian Channel + Buy/Sell Signals
   */
  renderPriceWithSignals(containerId, data) {
    const chart = this.initChart(containerId);
    if (!chart) return;

    const { bars, indicators, signals } = data;

    const dates = bars.map((b) => b.date);

    // Candlestick data: [open, close, low, high]
    const candlestickData = bars.map((b) => [b.open, b.close, b.low, b.high]);

    // Donchian channels
    const upperData = indicators.upperChannel;
    const lowerData = indicators.lowerChannel;
    const middleData = indicators.middleChannel;

    // Signal markers
    const buyMarkers = [];
    const sellMarkers = [];
    const addMarkers = [];
    const stopMarkers = [];
    const exitMarkers = [];

    signals.forEach((sig, idx) => {
      if (!sig) return;
      const marker = {
        coord: [dates[idx], sig.price],
        value: sig.label,
        symbol: 'pin',
        symbolSize: 28,
      };

      switch (sig.type) {
        case 'buy':
          buyMarkers.push({ ...marker, itemStyle: { color: '#ef5350' } });
          break;
        case 'sell':
          sellMarkers.push({ ...marker, itemStyle: { color: '#66bb6a' } });
          break;
        case 'add':
          addMarkers.push({ ...marker, itemStyle: { color: '#ff7043' }, symbolSize: 22 });
          break;
        case 'stop_loss':
          stopMarkers.push({ ...marker, itemStyle: { color: '#ab47bc' } });
          break;
        case 'exit':
          exitMarkers.push({ ...marker, itemStyle: { color: '#78909c' } });
          break;
      }
    });

    const option = {
      backgroundColor: '#0f1923',
      tooltip: {
        trigger: 'axis',
        axisPointer: { type: 'cross' },
        backgroundColor: 'rgba(30, 48, 68, 0.95)',
        borderColor: '#2a4560',
        textStyle: { color: '#e8edf2', fontSize: 12 },
      },
      legend: {
        data: ['K线', '上轨', '下轨', '中轨', '买入', '卖出', '加仓', '止损', '离场'],
        top: 8,
        textStyle: { color: '#8ba1b8', fontSize: 11 },
        selectedMode: 'multiple',
      },
      grid: {
        left: '8%',
        right: '6%',
        top: '60px',
        bottom: '50px',
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#2a4560' } },
        axisLabel: {
          color: '#5a768e',
          fontSize: 10,
          formatter: (val) => val.slice(5),
        },
        axisTick: { show: false },
      },
      yAxis: {
        type: 'value',
        scale: true,
        axisLine: { lineStyle: { color: '#2a4560' } },
        axisLabel: { color: '#5a768e', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e3044' } },
      },
      dataZoom: [
        {
          type: 'inside',
          start: 0,
          end: 100,
        },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 25,
          bottom: 8,
          borderColor: '#2a4560',
          backgroundColor: '#1a2736',
          dataBackground: {
            lineStyle: { color: '#5a768e' },
            areaStyle: { color: '#5a768e' },
          },
          selectedDataBackground: {
            lineStyle: { color: '#4fc3f7' },
            areaStyle: { color: '#4fc3f7' },
          },
          textStyle: { color: '#5a768e' },
        },
      ],
      series: [
        {
          name: 'K线',
          type: 'candlestick',
          data: candlestickData,
          itemStyle: {
            color: '#ef5350',
            color0: '#66bb6a',
            borderColor: '#ef5350',
            borderColor0: '#66bb6a',
          },
          markPoint: {
            data: [
              ...buyMarkers.map((m) => ({
                ...m,
                symbol: 'arrow',
                symbolRotate: 180,
              })),
              ...sellMarkers.map((m) => ({
                ...m,
                symbol: 'arrow',
              })),
              ...addMarkers.map((m) => ({
                ...m,
                symbol: 'diamond',
              })),
              ...stopMarkers.map((m) => ({
                ...m,
                symbol: 'triangle',
              })),
              ...exitMarkers.map((m) => ({
                ...m,
                symbol: 'roundRect',
              })),
            ],
          },
        },
        {
          name: '上轨',
          type: 'line',
          data: upperData,
          lineStyle: { color: 'rgba(239, 83, 80, 0.5)', width: 1, type: 'dashed' },
          itemStyle: { color: 'rgba(239, 83, 80, 0.5)' },
          symbol: 'none',
        },
        {
          name: '下轨',
          type: 'line',
          data: lowerData,
          lineStyle: { color: 'rgba(102, 187, 106, 0.5)', width: 1, type: 'dashed' },
          itemStyle: { color: 'rgba(102, 187, 106, 0.5)' },
          symbol: 'none',
        },
        {
          name: '中轨',
          type: 'line',
          data: middleData,
          lineStyle: { color: 'rgba(255, 167, 38, 0.4)', width: 1 },
          itemStyle: { color: 'rgba(255, 167, 38, 0.4)' },
          symbol: 'none',
        },
      ],
    };

    chart.setOption(option, true);
    return chart;
  }

  /**
   * Chart 2: ATR trend and volatility
   */
  renderATR(containerId, data) {
    const chart = this.initChart(containerId);
    if (!chart) return;

    const { bars, indicators } = data;
    const dates = bars.map((b) => b.date);

    const option = {
      backgroundColor: '#0f1923',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(30, 48, 68, 0.95)',
        borderColor: '#2a4560',
        textStyle: { color: '#e8edf2', fontSize: 12 },
      },
      legend: {
        data: ['ATR', 'ATR(%)'],
        top: 8,
        textStyle: { color: '#8ba1b8', fontSize: 11 },
      },
      grid: {
        left: '8%',
        right: '6%',
        top: '60px',
        bottom: '50px',
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#2a4560' } },
        axisLabel: {
          color: '#5a768e',
          fontSize: 10,
          formatter: (val) => val.slice(5),
        },
      },
      yAxis: [
        {
          type: 'value',
          name: 'ATR',
          nameTextStyle: { color: '#8ba1b8', fontSize: 11 },
          axisLabel: { color: '#5a768e', fontSize: 10 },
          splitLine: { lineStyle: { color: '#1e3044' } },
        },
        {
          type: 'value',
          name: 'ATR(%)',
          nameTextStyle: { color: '#8ba1b8', fontSize: 11 },
          axisLabel: {
            color: '#5a768e',
            fontSize: 10,
            formatter: '{value}%',
          },
          splitLine: { show: false },
        },
      ],
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 25,
          bottom: 8,
          borderColor: '#2a4560',
          backgroundColor: '#1a2736',
          textStyle: { color: '#5a768e' },
        },
      ],
      series: [
        {
          name: 'ATR',
          type: 'line',
          data: indicators.atr,
          itemStyle: { color: '#4fc3f7' },
          lineStyle: { width: 2 },
          symbol: 'none',
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(79, 195, 247, 0.3)' },
                { offset: 1, color: 'rgba(79, 195, 247, 0.02)' },
              ],
            },
          },
        },
        {
          name: 'ATR(%)',
          type: 'line',
          yAxisIndex: 1,
          data: indicators.atrPct,
          itemStyle: { color: '#ffa726' },
          lineStyle: { width: 1, type: 'dashed' },
          symbol: 'none',
        },
      ],
    };

    chart.setOption(option, true);
    return chart;
  }

  /**
   * Chart 3: Equity curve vs benchmark
   */
  renderEquityCurve(containerId, data) {
    const chart = this.initChart(containerId);
    if (!chart) return;

    const { bars, equityCurve, metrics } = data;
    const dates = bars.map((b) => b.date);

    // Normalize benchmark to same starting value
    const initialCapital = metrics.initialCapital || 1000000;
    const startPrice = bars[0].close;
    const benchEquity = bars.map((b) => (b.close / startPrice) * initialCapital);

    const option = {
      backgroundColor: '#0f1923',
      tooltip: {
        trigger: 'axis',
        backgroundColor: 'rgba(30, 48, 68, 0.95)',
        borderColor: '#2a4560',
        textStyle: { color: '#e8edf2', fontSize: 12 },
        formatter: (params) => {
          const p = params[0];
          const ret = ((p.value - initialCapital) / initialCapital * 100).toFixed(2);
          return `${p.name}<br/>${p.seriesName}: ¥${p.value.toLocaleString()}<br/>收益率: ${ret}%`;
        },
      },
      legend: {
        data: ['策略净值', '买入持有'],
        top: 8,
        textStyle: { color: '#8ba1b8', fontSize: 11 },
      },
      grid: {
        left: '10%',
        right: '6%',
        top: '60px',
        bottom: '50px',
      },
      xAxis: {
        type: 'category',
        data: dates,
        axisLine: { lineStyle: { color: '#2a4560' } },
        axisLabel: {
          color: '#5a768e',
          fontSize: 10,
          formatter: (val) => val.slice(5),
        },
      },
      yAxis: {
        type: 'value',
        name: '净值 (¥)',
        nameTextStyle: { color: '#8ba1b8', fontSize: 11 },
        axisLabel: {
          color: '#5a768e',
          fontSize: 10,
          formatter: (val) => (val / 10000).toFixed(0) + '万',
        },
        splitLine: { lineStyle: { color: '#1e3044' } },
      },
      dataZoom: [
        { type: 'inside', start: 0, end: 100 },
        {
          type: 'slider',
          start: 0,
          end: 100,
          height: 25,
          bottom: 8,
          borderColor: '#2a4560',
          backgroundColor: '#1a2736',
          textStyle: { color: '#5a768e' },
        },
      ],
      series: [
        {
          name: '策略净值',
          type: 'line',
          data: equityCurve,
          itemStyle: { color: '#4fc3f7' },
          lineStyle: { width: 2.5 },
          symbol: 'none',
          areaStyle: {
            color: {
              type: 'linear',
              x: 0, y: 0, x2: 0, y2: 1,
              colorStops: [
                { offset: 0, color: 'rgba(79, 195, 247, 0.2)' },
                { offset: 1, color: 'rgba(79, 195, 247, 0.02)' },
              ],
            },
          },
          markLine: {
            silent: true,
            data: [
              {
                yAxis: initialCapital,
                lineStyle: { color: '#5a768e', type: 'dashed' },
                label: { formatter: '初始资金', color: '#5a768e' },
              },
            ],
          },
        },
        {
          name: '买入持有',
          type: 'line',
          data: benchEquity,
          itemStyle: { color: '#8ba1b8' },
          lineStyle: { width: 1.5, type: 'dotted' },
          symbol: 'none',
        },
      ],
    };

    chart.setOption(option, true);
    return chart;
  }

  /**
   * Chart 4: Trade P&L scatter (X=holding days, Y=return)
   */
  renderTradeScatter(containerId, data) {
    const chart = this.initChart(containerId);
    if (!chart) return;

    const { trades } = data;
    const completed = trades.filter((t) => t.exitPrice !== null);

    const scatterData = completed.map((t, idx) => ({
      value: [t.holdingDays || 0, t.pnlPct || 0],
      itemStyle: {
        color: t.pnlPct >= 0 ? '#ef5350' : '#66bb6a',
      },
      name: `${t.entryDate} → ${t.exitDate}`,
      pnl: t.pnl,
      type: t.type,
    }));

    const option = {
      backgroundColor: '#0f1923',
      tooltip: {
        trigger: 'item',
        backgroundColor: 'rgba(30, 48, 68, 0.95)',
        borderColor: '#2a4560',
        textStyle: { color: '#e8edf2', fontSize: 12 },
        formatter: (params) => {
          const d = params.data;
          return `${d.name}<br/>
            持仓天数: ${d.value[0]}天<br/>
            收益率: ${d.value[1].toFixed(2)}%<br/>
            盈亏: ¥${(d.pnl || 0).toFixed(0)}<br/>
            类型: ${d.type}`;
        },
      },
      grid: {
        left: '10%',
        right: '6%',
        top: '50px',
        bottom: '50px',
      },
      xAxis: {
        type: 'value',
        name: '持仓天数',
        nameTextStyle: { color: '#8ba1b8', fontSize: 11 },
        axisLabel: { color: '#5a768e', fontSize: 10 },
        splitLine: { lineStyle: { color: '#1e3044' } },
        axisLine: { lineStyle: { color: '#2a4560' } },
      },
      yAxis: {
        type: 'value',
        name: '收益率 (%)',
        nameTextStyle: { color: '#8ba1b8', fontSize: 11 },
        axisLabel: {
          color: '#5a768e',
          fontSize: 10,
          formatter: '{value}%',
        },
        splitLine: { lineStyle: { color: '#1e3044' } },
        axisLine: { lineStyle: { color: '#2a4560' } },
      },
      series: [
        {
          type: 'scatter',
          data: scatterData,
          symbolSize: (data) => Math.min(20, Math.max(8, Math.abs(data[1]) * 1.5 + 8)),
          emphasis: {
            scale: 1.5,
            focus: 'self',
          },
          markLine: {
            silent: true,
            data: [
              {
                yAxis: 0,
                lineStyle: { color: '#5a768e', type: 'dashed' },
                label: { formatter: '盈亏分界线', color: '#5a768e' },
              },
            ],
          },
          markArea: {
            silent: true,
            data: [
              [
                { yAxis: 0, itemStyle: { color: 'rgba(239, 83, 80, 0.05)' } },
                { yAxis: 100 },
              ],
              [
                { yAxis: -100, itemStyle: { color: 'rgba(102, 187, 106, 0.05)' } },
                { yAxis: 0 },
              ],
            ],
          },
        },
      ],
    };

    chart.setOption(option, true);
    return chart;
  }

  /**
   * Resize all charts (for window resize)
   */
  resizeAll() {
    Object.values(this.charts).forEach((chart) => {
      if (chart && !chart.isDisposed()) {
        chart.resize();
      }
    });
  }

  /**
   * Dispose all charts
   */
  disposeAll() {
    Object.values(this.charts).forEach((chart) => {
      if (chart && !chart.isDisposed()) {
        chart.dispose();
      }
    });
    this.charts = {};
  }
}
