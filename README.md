# 大明新闻季报 (The Ming Post)

> 以报纸版面呈现明朝历史新闻；1 个自然日对应明朝 1 个季度。

## 核心定位

- **不是** 一次性原型
- **不是** 学术数据库
- **是** 面向线上发布的明朝历史新闻季报

## 时间映射

```
纪元: 2026-05-15 00:00 CST = 洪武元年正月
速率: 1 自然日 = 1 明朝季度 = 3 明朝月 (4 天 = 1 明朝年)
跨度: 1368 — 1644，共 1104 真实日
```

## 版面

| 版面 | 内容 | 数据来源 |
|------|------|---------|
| 朝政要闻 | 皇帝诏令、朝堂动态、大臣任免 | ming_timeline.json |
| 边关军事 | 北方边防、倭寇、战事报道 | ming_timeline.json + military_wiki |
| 经济民生 | 赋税、漕运、田亩、物价 | ming_timeline.json |
| 科举文教 | 会试殿试、翰林院、书院 | CBDB + timeline |
| 灾异志 | 水旱蝗疫、地震、天文异象 | ming_disasters.json |
| 人事任免 | 官员升迁、罢黜、致仕 | CBDB |
| 评论 | 时事述评 | 历史典籍 + LLM 辅助 |

## 目录结构

```
明朝/
├── src/
│   ├── world/          # 时间系统、地理、制度
│   ├── data/           # CBDB、地理、时间线查询
│   ├── newsroom/       # 新闻编辑引擎
│   └── config.py       # 配置管理
├── data/
│   ├── raw/            # 原始史料
│   └── processed/      # 加工后数据
│       ├── timeline/   # 明朝大事年表 (800+ 事件)
│       ├── geography/  # 明朝地理数据
│       └── ...
├── web/                # 前端
│   ├── index.html      # 报纸首页
│   ├── css/            # 华盛顿邮报风格样式
│   ├── js/             # 动态渲染
│   └── data/           # 报纸 JSON 数据
├── tests/              # 测试
├── schemas/            # 数据模型
├── tools/              # 工具脚本
└── generate_news.py    # 报纸生成脚本
```

## 快速开始

```bash
# 生成今日报纸
cd 明朝
python generate_news.py

# 启动本地静态预览
python generate_news.py --serve

# 指定日期生成
python generate_news.py --date 2028-06-01

# 查看当前明朝时间状态
python -c "from src.world.time import real_time_status; print(real_time_status())"
```

## 开发工作流

```bash
# 1. 生成最新季报 JSON（同时写入 web/data 和 cloudflare/worker/data）
python3 generate_news.py

# 2. 启动本地静态预览
python3 generate_news.py --serve

# 3. 运行 Python 侧测试
python3 tests/test_generate_news.py
python3 tests/test_time.py
python3 tests/test_geography.py
python3 tests/test_institutions.py

# 4. 运行 Worker 测试
cd cloudflare/worker && npm test
```

`generate_news.py` 会在生成后使用 `jsonschema` 对 `issue.json` 执行正式校验；季报数据契约见 `schemas/issue.schema.json`。

当某季度可精确落月的史料不足时，新闻编辑引擎会按朝代阶段自动补入背景稿，确保每期至少形成完整报纸版面，且开国期、中期、晚明期的补稿语气与关注点会有所区别。

## 部署

### GitHub Pages 前端

前端是 `web/` 下的静态站点。推送到 GitHub 后，在仓库设置里启用 GitHub Pages，并选择 GitHub Actions 作为来源；`.github/workflows/pages.yml` 会把 `web/` 发布出去。

如果要让前端读取 Cloudflare Worker 数据，把 `web/config.js` 里的 `apiBaseUrl` 改成 Worker 域名，例如：

```js
window.MING_POST_CONFIG = {
  apiBaseUrl: "https://ming-post-api.example.workers.dev",
};
```

未配置 `apiBaseUrl` 时，前端会读取仓库内的 `web/data/issue.json`。

### Cloudflare Worker 后端

Worker 位于 `cloudflare/worker/`，当前提供：

- `GET /health`：服务健康检查和当前期次摘要
- `GET /api/issue/latest`：返回最新生成的季报 JSON

部署前先安装依赖并验证：

```bash
cd cloudflare/worker
npm install
npm test
npm run deploy
```

Worker 当前读取 `cloudflare/worker/data/issue.json`。这个文件会在运行 `python generate_news.py` 时自动同步更新。

## 运行测试

```bash
cd 明朝
python tests/test_generate_news.py
python tests/test_time.py
python tests/test_geography.py
python tests/test_institutions.py
cd cloudflare/worker && npm test
```

## 数据来源

- **明代大事年表**: 整理自《明史》《明实录》《国榷》等
- **灾害记录**: 《明史·五行志》《明实录》《中国灾害通史·明代卷》
- **人物数据**: Harvard CBDB (中国历代人物传记资料库)
- **地理数据**: CBDB 行政地理
- **制度资料**: 《大明会典》《明史·职官志》

## 运营说明

这是一个线上发布项目。仓库只保留运行、部署和维护必需文件；本地生成的预览文件、密钥、原始私有资料和临时产物不进入 GitHub。
