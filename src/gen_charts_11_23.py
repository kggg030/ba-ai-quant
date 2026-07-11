#!/usr/bin/env python3
"""Generate remaining charts (Figs 11-23) for Task 5 report."""
import os, sys
os.environ['MPLBACKEND'] = 'Agg'
os.chdir(os.path.join(os.path.dirname(__file__), '..', 'notebooks'))
sys.path.insert(0, os.path.join('..', 'src'))

import pandas as pd
import numpy as np
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import matplotlib.dates as mdates
import matplotlib.ticker as mticker
import seaborn as sns
from matplotlib.patches import Patch
from turtle_strategy import TurtleStrategy

plt.rcParams['font.sans-serif'] = ['SimHei', 'Microsoft YaHei', 'DejaVu Sans']
plt.rcParams['axes.unicode_minus'] = False
sns.set_style('darkgrid')

REPORT_DIR = '../reports'
DATA_DIR = '../data/task05_stocks'

STOCKS = {
    '688981.SH': '中芯国际A', '002594.SZ': '比亚迪A',
    '600900.SH': '长江电力A', '000333.SZ': '美的集团A', '601318.SH': '中国平安A',
}
STOCKS_SHORT = {k: v.replace('A', '') for k, v in STOCKS.items()}

# Load & run
data, results = {}, {}
for code in STOCKS:
    df = pd.read_csv(os.path.join(DATA_DIR, f'{code}.csv'), dtype={'trade_date': str})
    data[code] = df
    engine = TurtleStrategy(donchian_n=20, atr_m=20, stop_mult=2.0)
    results[code] = engine.run(df)

codes = list(STOCKS.keys())
names_short = [STOCKS_SHORT[c] for c in codes]

# ========== Fig 11: Performance comparison 2x2 ==========
annual_rets = [results[c]['metrics']['annual_return'] for c in codes]
sharpes = [results[c]['metrics']['sharpe_ratio'] for c in codes]
mdds = [results[c]['metrics']['max_drawdown'] for c in codes]
avg_holdings = [results[c]['metrics']['avg_holding_days'] for c in codes]

fig, axes = plt.subplots(2, 2, figsize=(14, 10))
x = np.arange(len(names_short)); bw = 0.55

# Subplot 1: Annual return
ax = axes[0, 0]
colors1 = ['#2e7d32' if v >= 0 else '#c62828' for v in annual_rets]
bars = ax.bar(x, annual_rets, bw, color=colors1, edgecolor='white', linewidth=0.5)
ax.axhline(y=0, color='black', linewidth=0.8)
for i, (bar, val) in enumerate(zip(bars, annual_rets)):
    yp = val + 0.3 if val >= 0 else val - 0.8
    ax.text(bar.get_x() + bar.get_width()/2, yp, f'{val:.2f}%',
            ha='center', va='bottom', fontsize=9, fontweight='bold', color=colors1[i])
ax.set_title('年化收益率', fontsize=12, fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels(names_short, fontsize=9)
ax.set_ylabel('年化收益 (%)', fontsize=10)
ax.grid(True, alpha=0.25, axis='y', linestyle='--')

# Subplot 2: Sharpe
ax = axes[0, 1]
colors2 = ['#2e7d32' if v >= 0 else '#c62828' for v in sharpes]
bars = ax.bar(x, sharpes, bw, color=colors2, edgecolor='white', linewidth=0.5)
ax.axhline(y=0, color='black', linewidth=0.8)
for i, (bar, val) in enumerate(zip(bars, sharpes)):
    yp = val + 0.03 if val >= 0 else val - 0.08
    ax.text(bar.get_x() + bar.get_width()/2, yp, f'{val:.2f}',
            ha='center', va='bottom', fontsize=9, fontweight='bold', color=colors2[i])
ax.set_title('夏普比率', fontsize=12, fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels(names_short, fontsize=9)
ax.set_ylabel('夏普比率', fontsize=10)
ax.grid(True, alpha=0.25, axis='y', linestyle='--')

# Subplot 3: MDD (inverted Y)
ax = axes[1, 0]
colors3 = ['#2e7d32' if v <= 15 else ('#f57c00' if v <= 25 else '#c62828') for v in mdds]
neg_mdds = [-v for v in mdds]
bars = ax.bar(x, neg_mdds, bw, color=colors3, edgecolor='white', linewidth=0.5)
for i, (bar, val) in enumerate(zip(bars, mdds)):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() - 2.5, f'{val:.2f}%',
            ha='center', va='top', fontsize=9, fontweight='bold', color='white')
ax.set_title('最大回撤 (Y轴反转)', fontsize=12, fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels(names_short, fontsize=9)
ax.set_ylabel('最大回撤 (%)', fontsize=10)
ax.yaxis.set_major_formatter(mticker.FuncFormatter(lambda v, _: f'{abs(v):.0f}%'))
ax.grid(True, alpha=0.25, axis='y', linestyle='--')

# Subplot 4: Avg holding days
ax = axes[1, 1]
colors4 = ['#1565c0'] * len(avg_holdings)
bars = ax.bar(x, avg_holdings, bw, color=colors4, edgecolor='white', linewidth=0.5)
for i, (bar, val) in enumerate(zip(bars, avg_holdings)):
    ax.text(bar.get_x() + bar.get_width()/2, bar.get_height() + 0.3, f'{val:.0f}天',
            ha='center', va='bottom', fontsize=9, fontweight='bold')
ax.set_title('平均持仓天数', fontsize=12, fontweight='bold')
ax.set_xticks(x); ax.set_xticklabels(names_short, fontsize=9)
ax.set_ylabel('持仓天数', fontsize=10)
ax.grid(True, alpha=0.25, axis='y', linestyle='--')

fig.suptitle('图11：五只标的海龟策略绩效对比（2023.07-2026.07）',
             fontsize=16, fontweight='bold', y=1.01)
plt.tight_layout()
fp = os.path.join(REPORT_DIR, 'fig11_performance_comparison.png')
plt.savefig(fp, dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
print('[OK] Fig 11: performance comparison')

# ========== Figs 12-16: Sensitivity heatmaps ==========
N_range = [15, 20, 25, 30, 35]
M_range = [15, 20, 25]
for s_idx, (code, name) in enumerate(STOCKS.items()):
    sharpe_grid = np.zeros((len(M_range), len(N_range)))
    for i, m_val in enumerate(M_range):
        for j, n_val in enumerate(N_range):
            engine = TurtleStrategy(donchian_n=n_val, atr_m=m_val, stop_mult=2.0)
            r = engine.run(data[code])
            sharpe_grid[i, j] = r['metrics']['sharpe_ratio']
    best = np.unravel_index(np.argmax(sharpe_grid), sharpe_grid.shape)
    print(f'  {name} | Best N={N_range[best[1]]}, M={M_range[best[0]]} | Sharpe={sharpe_grid[best]:.2f}')

    fig, ax = plt.subplots(figsize=(12, 6))
    im = ax.imshow(sharpe_grid, cmap='RdYlGn', aspect='auto', vmin=-0.5, vmax=1.5)
    ax.set_xticks(range(len(N_range)))
    ax.set_xticklabels([f'N={n}' for n in N_range], fontsize=10)
    ax.set_yticks(range(len(M_range)))
    ax.set_yticklabels([f'M={m}' for m in M_range], fontsize=10)
    ax.set_xlabel('Donchian 通道周期 N', fontsize=12, fontweight='bold')
    ax.set_ylabel('ATR 周期 M', fontsize=12, fontweight='bold')
    for i in range(len(M_range)):
        for j in range(len(N_range)):
            val = sharpe_grid[i, j]
            is_best = (i == best[0] and j == best[1])
            ax.text(j, i, f'{val:.2f}', ha='center', va='center', fontsize=10,
                    color='white', fontweight='bold' if is_best else 'normal')
    cbar = plt.colorbar(im, ax=ax, shrink=0.85, pad=0.02)
    cbar.set_label('Sharpe Ratio', fontsize=11, fontweight='bold')
    fig_num = 12 + s_idx
    ax.set_title(f'图{fig_num}：{code} {name} 参数敏感性热力图（夏普比率）',
                fontsize=14, fontweight='bold', pad=15)
    plt.tight_layout()
    fp = os.path.join(REPORT_DIR, f'fig{fig_num}_{code}_sensitivity.png')
    plt.savefig(fp, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    print(f'[OK] Fig {fig_num}: {code} sensitivity')

# ========== Figs 17-21: Trade scatter ==========
for s_idx, (code, name) in enumerate(STOCKS.items()):
    r = results[code]
    trades = r['trades']
    m = r['metrics']
    completed = [t for t in trades if t['exit_price'] is not None]
    if not completed:
        print(f'  {name}: no completed trades, skip.')
        continue

    holding_days = [t.get('holding_days', 0) or 0 for t in completed]
    pnl_pcts = [t.get('pnl_pct', 0) or 0 for t in completed]
    shares_list = [t.get('shares', 100) or 100 for t in completed]
    colors = ['#2e7d32' if p >= 0 else '#c62828' for p in pnl_pcts]
    max_s = max(shares_list) if max(shares_list) > 0 else 1
    bubble_sizes = [max(30, min(300, s / max_s * 250 + 30)) for s in shares_list]

    fig, ax = plt.subplots(figsize=(14, 8))
    ax.scatter(holding_days, pnl_pcts, c=colors, s=bubble_sizes,
               alpha=0.65, edgecolors='white', linewidth=0.5, zorder=5)
    ax.axhline(y=0, color='black', linewidth=0.8, linestyle='--', alpha=0.6)
    ax.axvline(x=30, color='#1565c0', linewidth=0.8, linestyle=':', alpha=0.5,
               label='30天参考线')
    summary_text = (
        f"交易笔数: {m['total_trades']}\n"
        f"胜率: {m['win_rate']:.1f}%\n"
        f"盈亏比: {m['profit_factor']:.2f}\n"
        f"平均持仓: {m['avg_holding_days']:.0f}天"
    )
    ax.text(0.97, 0.97, summary_text, transform=ax.transAxes, fontsize=10,
            va='top', ha='right',
            bbox=dict(boxstyle='round,pad=0.5', facecolor='lightyellow',
                      alpha=0.9, edgecolor='gray'),
            family='monospace')
    fig_num = 17 + s_idx
    ax.set_title(f'图{fig_num}：{code} {name} 单笔交易盈亏分布散点图',
                fontsize=14, fontweight='bold', pad=15)
    ax.set_xlabel('持仓天数', fontsize=12)
    ax.set_ylabel('收益率 (%)', fontsize=12)
    ax.grid(True, alpha=0.25, linestyle='--')
    legend_elements = [
        Patch(facecolor='#2e7d32', alpha=0.65, label='盈利交易'),
        Patch(facecolor='#c62828', alpha=0.65, label='亏损交易'),
    ]
    ax.legend(handles=legend_elements, loc='upper left', fontsize=9, framealpha=0.9)
    plt.tight_layout()
    fp = os.path.join(REPORT_DIR, f'fig{fig_num}_{code}_scatter.png')
    plt.savefig(fp, dpi=150, bbox_inches='tight', facecolor='white')
    plt.close()
    print(f'[OK] Fig {fig_num}: {code} scatter')

# ========== Fig 22: All equity curves ==========
fig, ax = plt.subplots(figsize=(14, 8))
colors_stocks = ['#1565c0', '#e53935', '#2e7d32', '#f57c00', '#7b1fa2']
for idx, (code, name) in enumerate(STOCKS.items()):
    r = results[code]
    eq = np.array(r['equity_curve'])
    eq_norm = eq / eq[0] * 100
    dates = pd.to_datetime(r['bars']['trade_date'], format='%Y%m%d')
    ax.plot(dates, eq_norm, color=colors_stocks[idx], linewidth=1.8, alpha=0.85,
            label=f'{STOCKS_SHORT[code]} ({code})')
ax.axhline(y=100, color='gray', linewidth=0.8, linestyle='--', alpha=0.5)
ax.set_title('图22：五只标的策略净值曲线对比（归一化起始=100）',
             fontsize=14, fontweight='bold', pad=15)
ax.set_xlabel('日期', fontsize=12)
ax.set_ylabel('净值 (起始=100)', fontsize=12)
ax.xaxis.set_major_formatter(mdates.DateFormatter('%Y-%m'))
ax.xaxis.set_major_locator(mdates.MonthLocator(interval=3))
plt.setp(ax.xaxis.get_majorticklabels(), rotation=45, ha='right', fontsize=9)
ax.set_xlim(dates.iloc[0], dates.iloc[-1])
ax.legend(loc='upper left', fontsize=9, framealpha=0.9, ncol=2)
ax.grid(True, alpha=0.25, linestyle='--')
plt.tight_layout()
fp = os.path.join(REPORT_DIR, 'fig22_equity_all.png')
plt.savefig(fp, dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
print('[OK] Fig 22: equity all')

# ========== Fig 23: Applicability quadrant ==========
fig, ax = plt.subplots(figsize=(14, 8))
scatter_x = [results[c]['metrics']['max_drawdown'] for c in codes]
scatter_y = [results[c]['metrics']['annual_return'] for c in codes]
scatter_size = [max(80, min(500, results[c]['metrics']['total_trades'] * 15)) for c in codes]
scatter_sharpe = [results[c]['metrics']['sharpe_ratio'] for c in codes]
cmap = plt.cm.RdYlGn
for i, code in enumerate(codes):
    color = cmap(max(0, min(1, (scatter_sharpe[i] + 0.5) / 1.5)))
    ax.scatter(scatter_x[i], scatter_y[i], s=scatter_size[i], c=[color],
               alpha=0.7, edgecolors='white', linewidth=1.5, zorder=5)
    ox = 1.5 if i % 2 == 0 else -1.5
    ax.annotate(f'{STOCKS_SHORT[code]}\nSharpe:{scatter_sharpe[i]:.2f}',
                xy=(scatter_x[i], scatter_y[i]),
                xytext=(scatter_x[i] + ox, scatter_y[i] + 1.0),
                fontsize=9, fontweight='bold',
                arrowprops=dict(arrowstyle='->', color='gray', lw=1, alpha=0.6))
ax.axhline(y=0, color='gray', linewidth=1, linestyle='--', alpha=0.5)
ax.axvline(x=15, color='gray', linewidth=1, linestyle=':', alpha=0.4)
ax.text(5, 8, '理想区域\n低回撤·高收益', fontsize=10, ha='center',
        bbox=dict(boxstyle='round', facecolor='#c8e6c9', alpha=0.6))
ax.text(35, 8, '高风险高回报', fontsize=10, ha='center',
        bbox=dict(boxstyle='round', facecolor='#fff9c4', alpha=0.6))
ax.text(5, -10, '保守低收益', fontsize=10, ha='center',
        bbox=dict(boxstyle='round', facecolor='#bbdefb', alpha=0.6))
ax.text(35, -10, '策略失效区', fontsize=10, ha='center',
        bbox=dict(boxstyle='round', facecolor='#ffcdd2', alpha=0.6))
ax.set_title('图23：海龟策略适用场景分类 — 风险收益象限图',
             fontsize=14, fontweight='bold', pad=15)
ax.set_xlabel('最大回撤 (%)', fontsize=12)
ax.set_ylabel('年化收益 (%)', fontsize=12)
ax.grid(True, alpha=0.25, linestyle='--')
plt.tight_layout()
fp = os.path.join(REPORT_DIR, 'fig23_applicability.png')
plt.savefig(fp, dpi=150, bbox_inches='tight', facecolor='white')
plt.close()
print('[OK] Fig 23: applicability')

print('\n=== ALL CHARTS GENERATED SUCCESSFULLY ===')
