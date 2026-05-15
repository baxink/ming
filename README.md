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
| 评论 | 基于本季热点的时事述评 | 当季头条 + 阶段语境 |

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
│   └── config.js       # 线上 Worker API 地址
├── cloudflare/worker/  # Worker API、运行时生成器、KV 绑定
├── tests/              # 测试
├── schemas/            # 数据模型
├── tools/              # 工具脚本
└── generate_news.py    # 本地预览生成脚本
```

## 快速开始

```bash
# 生成本地预览数据
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
# 1. 运行 Python 侧测试
python3 tests/test_generate_news.py
python3 tests/test_time.py
python3 tests/test_geography.py
python3 tests/test_institutions.py

# 2. 运行 Worker 测试
cd cloudflare/worker && npm test

# 3. 本地预览（可选；生成的 web/data/issue.json 不提交）
python3 generate_news.py --serve
```

`generate_news.py` 只用于本地预览和回归测试；线上季报由 Cloudflare Worker 运行时生成。生成脚本会使用 `jsonschema` 对 `issue.json` 执行正式校验；季报数据契约见 `schemas/issue.schema.json`。

季报以三个月为一个新闻周期。新闻编辑引擎会把当季明确史事、制度运行、军政压力和地方风险组织成完整版面；开国期、中期、晚明期会使用不同的历史语气和关注重点。

## 部署

### GitHub Pages 前端

前端是 `web/` 下的静态站点。推送到 GitHub 后，在仓库设置里启用 GitHub Pages，并选择 GitHub Actions 作为来源；`.github/workflows/pages.yml` 会把 `web/` 发布出去。

前端通过 `web/config.js` 读取 Cloudflare Worker 数据：

```js
window.MING_POST_CONFIG = {
  apiBaseUrl: "https://ming-post-api.fanxj137616.workers.dev",
};
```

未配置 `apiBaseUrl` 时，前端才会尝试读取本地预览文件 `web/data/issue.json`；该文件不提交到 GitHub。

### Cloudflare Worker 后端

Worker 位于 `cloudflare/worker/`，当前提供：

- `GET /health`：服务健康检查和当前期次摘要
- `GET /api/issue/latest`：按当天日期生成并返回最新季报 JSON
- `GET /api/issue/latest?date=YYYY-MM-DD`：按指定真实日期生成季报，用于测试和回溯

Worker 从 Workers KV 读取历史数据：

| KV key | 内容 |
|--------|------|
| `data:v1:ming:timeline` | `data/processed/timeline/ming_timeline.json` |
| `data:v1:ming:disasters` | `data/processed/timeline/ming_disasters.json` |

生成后的季报会缓存到 `issue:v2:<明朝年>:<起始月>`；定时触发器每天北京时间约 00:05 预生成当天季报。

部署前先上传历史数据、安装依赖并验证：

```bash
cd cloudflare/worker
npm install
npm test

# 读取本地 .env.example 中的 CLOUDFLARE_API_TOKEN，不要提交该文件
TOKEN="$(awk -F= '/^CLOUDFLARE_API_TOKEN=/ { v=$0; sub(/^[^=]*=/, "", v); gsub(/^[ \t]+|[ \t]+$/, "", v); print v; exit }' ../../.env.example)"

NODE_TLS_REJECT_UNAUTHORIZED=0 CLOUDFLARE_API_TOKEN="$TOKEN" \
  npx wrangler kv key put data:v1:ming:timeline \
  --path ../../data/processed/timeline/ming_timeline.json \
  --namespace-id 3c3cb6334e2a4e19b3e14d3dee8b610f --remote

NODE_TLS_REJECT_UNAUTHORIZED=0 CLOUDFLARE_API_TOKEN="$TOKEN" \
  npx wrangler kv key put data:v1:ming:disasters \
  --path ../../data/processed/timeline/ming_disasters.json \
  --namespace-id 3c3cb6334e2a4e19b3e14d3dee8b610f --remote

npm run deploy
```

Worker 不读取仓库里的静态 `issue.json`，也不需要本地每日生成后再上传 GitHub。

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
