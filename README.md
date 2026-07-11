# Turtle Trading Strategy Dashboard

海龟交易策略全链路实现 — 基于三年期（2023-07-11 至 2026-07-11）A股真实行情数据的趋势跟踪系统回测与可视化看板。

## 项目概览

本项目从零构建了一个符合开源标准的静态HTML可视化看板，系统性复现并验证经典海龟交易策略。覆盖5只A股标的（中芯国际、比亚迪、长江电力、美的集团、中国平安），包含完整的数据采集、策略引擎、回测分析、参数敏感性测试与交互式可视化。

### 效果截图

![主看板](assets/screenshot_dashboard.png)

### 核心特性

- **纯静态HTML看板** — 零构建依赖，双击 `index.html` 即可本地预览
- **前端回测引擎** — JavaScript 实现完整海龟策略信号生成（Donchian Channel + ATR + 动态止损）
- **ECharts 本地化** — 图表库打包至 `assets/`，无需外部CDN
- **参数交互调节** — 看板内实时调整 Donchian 周期 N (15-35) 与 ATR 周期 M (15-25)
- **后端分析Notebook** — `notebooks/task05_analysis.ipynb` 含完整回测、绩效评估与参数网格搜索

## 快速开始

### 本地预览

1. 克隆仓库：
   ```bash
   git clone <repo-url>
   cd task05_turtle_dashboard
   ```

2. 直接双击 `index.html` 即可在浏览器中打开看板，或使用本地静态服务器：
   ```bash
   # Python 3
   python -m http.server 8000
   # 然后访问 http://localhost:8000
   ```

### GitHub Pages 部署

1. 推送代码到 GitHub 仓库
2. 进入 `Settings > Pages`
3. Source 选择 `Deploy from a branch`，分支选 `main`
4. 目录选择 `/ (root)`，保存
5. 等待部署完成后访问 `https://<username>.github.io/<repo>/`

### 数据更新

数据文件位于 `data/task05_stocks/`，如需更新：

1. 配置 Tushare Pro Token：
   ```python
   import tushare as ts
   ts.set_token('your_token_here')
   ```

2. 运行数据采集脚本：
   ```bash
   python src/data_validator.py --fetch
   ```

## 项目结构

```
task05_turtle_dashboard/
├── index.html              # 主看板入口
├── css/
│   └── style.css           # 样式文件（CSS变量主题化）
├── js/
│   ├── main.js             # 数据绑定与交互逻辑
│   ├── chart.js            # 图表渲染模块（ECharts）
│   └── turtle_engine.js    # 前端回测与信号生成核心类
├── data/
│   └── task05_stocks/      # 五年期数据（5个CSV文件）
├── notebooks/
│   └── task05_analysis.ipynb # 后端分析Notebook
├── reports/
│   └── [姓名]_TASK5.pdf    # 最终提交PDF文档
├── src/
│   ├── turtle_strategy.py  # Python策略引擎
│   └── data_validator.py   # 数据质量校验脚本
├── assets/                 # 静态资源（ECharts库、图标）
├── .gitignore
├── LICENSE                 # MIT
├── README.md
└── requirements.txt
```

## 数据说明

| 股票代码 | 名称 | 特征 | 数据文件 |
|----------|------|------|----------|
| 688981.SH | 中芯国际 | 科创板/高波动/强趋势 | 688981.SH.csv |
| 002594.SZ | 比亚迪 | 新能源/中高波动/政策驱动 | 002594.SZ.csv |
| 600900.SH | 长江电力 | 公用事业/低波动/防御标杆 | 600900.SH.csv |
| 000333.SZ | 美的集团 | 消费蓝筹/中低波动/均值回归 | 000333.SZ.csv |
| 601318.SH | 中国平安 | 金融板块/高弹性/宏观敏感 | 601318.SH.csv |

- **数据来源**: Tushare Pro API
- **时间窗口**: 2023-07-11 至 2026-07-11
- **复权方式**: 前复权（合并 adj_factor 计算）
- **质量要求**: 单只有效交易日 ≥720天，连续缺失 ≤3日

## 策略参数

| 参数 | 默认值 | 范围 | 说明 |
|------|--------|------|------|
| Donchian 周期 N | 20 | 15-35 | 入场通道周期 |
| ATR 周期 M | 20 | 15-25 | 波动率计算窗口 |
| 止损倍数 | 2.0 | 2.0-2.5 | 以ATR为单位的止损距离 |
| 加仓间隔 | 0.5 | - | 每次加仓的价格间距（ATR倍数） |
| 最大加仓次数 | 3 | - | 单笔交易最大加仓次数 |

## 技术栈

- **前端**: HTML5 + CSS3 + Vanilla JavaScript (ES6+)
- **图表**: ECharts 5.x（本地化打包）
- **后端分析**: Python 3.10+, Tushare Pro, Pandas, NumPy, Matplotlib, Seaborn
- **部署**: GitHub Pages

## License

MIT License — 详见 [LICENSE](LICENSE) 文件
