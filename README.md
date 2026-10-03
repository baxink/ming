# 大明新闻季报 (The Ming Post)

> 以报纸形式回看明朝历史；1 个自然日对应明朝 1 个季度。允许现代回望，区分史事、解读与后续影响。

## 核心定位

- **不是** 一次性原型
- **不是** 学术数据库
- **是** 面向线上发布的明朝历史新闻季报

## 时间映射

```
纪元: 2026-05-15 00:00 CST = 洪武元年正月
速率: 1 自然日 = 1 明朝季度 = 3 明朝月 (4 天 = 1 明朝年)
跨度: 1368 — 1644，现有时间系统在 1644 年四月封顶
```

## 版面

| 版面 | 内容 | 数据来源 |
|------|------|---------|
| 朝政要闻 | 皇帝诏令、朝堂动态、大臣任免 | ming_timeline.json |
| 边关军事 | 北方边防、倭寇、战事报道 | ming_timeline.json |
| 经济民生 | 赋税、漕运、田亩、物价 | ming_timeline.json |
| 科举文教 | 有具体记录的科举与文化事件 | ming_timeline.json |
| 灾异志 | 水旱蝗疫、地震、天文异象 | ming_disasters.json |
| 人事任免 | 有具体记录的官员任免 | ming_timeline.json |
| 本年纪事 | 仅知年份、月份不详的记录 | 年末独立刊登，不冒充当季事件 |
| 评论 | 可选的现代历史分析 | 已核验、附出处和原文的当季史实 |

栏目随可用材料出现，不再用通用背景稿补齐七栏。没有当季材料时允许缩版或展示资料缺口；CBDB、军事和制度资料尚未接入主出报链路。

### 内容规则

- 文章标注 `content_type`、`time_precision`、`verification_status`，并提供可展开的出处、摘录和编者按。`background` 与 `later_effects` 单独展示。
- 只有输入明确标注 `verification_status: "verified"` 且有出处与原文摘录的记录，才可作为已核验史事。解析成功不等于史实核验。
- 既有年表缺少可定位出处，保留为待核验史料辑要，不伪造引文或记者署名，不用于 AI 评论事实包。既有灾害材料同样不自动获得已核验状态。
- 月份不详的年表记录仅编入第四季度的 `annual_events`，显示“月份不详”，不参与当季头条。疑似串行、截断或跨季度混合的灾害记录暂不自动刊登。
- 历史季度按史料中的正月至十二月分组，并非现代公历转换；明确标识的闰月随同名月归属处理。不从年份或污染的年号字段猜月份。
- 灾害月份须出现在事件正文中，不能仅由引文日期推定；正文或引文的明确年份与记录年份冲突时暂不刊登，保留原数据待校订。
- AI 评论只使用已核验史事及其资料包；材料不足或调用失败时不生成评论，也不回填通用社论。模型生成评论标注未经人工核验，不等同于史料原文。

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
│       ├── timeline/   # 90 条年表记录、2548 条灾害加工记录（仍需核验）
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

通过 `--serve` 在 localhost / 127.0.0.1 预览时，网页读取刚生成的 `data/issue.json`，保留指定日期。线上网页继续读取 Worker API；直接打开文件时建议使用 `--standalone` 单文件预览。

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

季报以三个月为一个新闻周期，`--window` 固定为 3。两套生成器均按证据选稿，不设最低文章数。现有资料不足以支撑所有季度的完整版面；后续需要分批补充时间、可定位出处、原文与人工核验状态，不能依赖模板补稿。

1403—1406 年样刊新增 15 条地方灾害、赈济和水利记录，摘自现有《灾害通史》本地文本，附摘录行号和该书转引文献。仅完成二手摘录对照，未校核所引史籍原本，因此仍标注待核验，不进入 AI 事实包。`python3 tests/test_editorial_regression.py` 会在内存中检查连续 16 期样刊的来源与版面边界，并逐期比对整个时间跨度的 1106 个日期映射（包含封顶期）；不覆盖本地预览文件。

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

生成后的季报会缓存到 `issue:v6:<明朝年>:<起始月>:<史料内容摘要>`；旧版本缓存不再读取。史料内存缓存有效期 1 分钟；`refresh=1` 和每日定时生成会重新读取 KV 史料。史料更新后自动切换季报缓存，未变的史料继续复用缓存及评论。普通网页另有 5 分钟 HTTP 缓存，数据更新最多约 6 分钟后可见，另受 KV 传播时间影响。定时触发器每天北京时间约 00:05，按北京时间日期预生成当天季报。

具备合格事实包时，评论生成按以下配置优先级选择一个服务：

1. `Cloudflare Workers AI`（推荐，直接在 Worker 内运行）
2. `OpenAI-compatible Chat Completions API`
3. `OpenAI Responses API`

上游失败、返回格式不合法或内容未通过校验时，Worker 保留不含评论的基础版，不逐层调用其他服务，整期季报不会因评论失败而失败。当前已验证 `ChatAnywhere` 免费 key 不支持从 Cloudflare Worker / 反向代理出口访问，因此不再作为线上默认方案。
当前默认 Workers AI 评论模型为 `@cf/meta/llama-3.3-70b-instruct-fp8-fast`；评论生成同时启用 JSON schema 约束，以提高线上出稿稳定性。

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

# 可选：配置 OpenAI-compatible 评论生成密钥。密钥只进 Cloudflare secret，不进 Git。
NODE_TLS_REJECT_UNAUTHORIZED=0 CLOUDFLARE_API_TOKEN="$TOKEN" \
  npx wrangler secret put LLM_API_KEY

# 可选：配置 OpenAI 官方密钥，作为次级回退
NODE_TLS_REJECT_UNAUTHORIZED=0 CLOUDFLARE_API_TOKEN="$TOKEN" \
  npx wrangler secret put OPENAI_API_KEY

npm run deploy
```

Worker 不读取仓库里的静态 `issue.json`，也不需要本地每日生成后再上传 GitHub。

如需排查评论生成链路，可临时请求：

- `GET /api/issue/latest?date=YYYY-MM-DD&debug=1&refresh=1`

其中 `debug=1` 会返回脱敏后的模型调用状态，`refresh=1` 会绕过当季缓存、重新读取 KV 史料并立即重算。

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
