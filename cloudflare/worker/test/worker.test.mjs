import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import worker from "../src/index.js";

const processedTimeline = JSON.parse(
  readFileSync(new URL("../../../data/processed/timeline/ming_timeline.json", import.meta.url), "utf8"),
);
const processedDisasters = JSON.parse(
  readFileSync(new URL("../../../data/processed/timeline/ming_disasters.json", import.meta.url), "utf8"),
);

async function readJson(response) {
  return JSON.parse(await response.text());
}

function makeKv(initial = {}) {
  const calls = { get: [], put: [] };
  const values = new Map(Object.entries(initial));
  return {
    calls,
    async get(key, type) {
      calls.get.push({ key, type });
      const value = values.get(key);
      if (!value) return null;
      return type === "json" ? JSON.parse(value) : value;
    },
    async put(key, value) {
      calls.put.push({ key, value });
      values.set(key, value);
    },
  };
}

function makeOpenAiFetch({ body, status = 200, calls = [] } = {}) {
  return async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });
  };
}

function makeWorkersAiRun({ body, calls = [] } = {}) {
  return async (model, input = {}) => {
    calls.push({ model, input });
    return body;
  };
}

function makeEnv(initial = {}) {
  return {
    ISSUE_CACHE: makeKv({
      "data:v1:ming:timeline": JSON.stringify(processedTimeline),
      "data:v1:ming:disasters": JSON.stringify(processedDisasters),
      ...initial,
    }),
  };
}

test("GET /api/issue/latest generates the epoch issue from KV history data", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "application/json; charset=utf-8");
  assert.equal(data.period.label, "洪武1年第1季度");
  assert.equal(data.period.start_label, "洪武1年1月");
  assert.equal(data.period.end_label, "洪武1年3月");
  assert.equal(data.lead.headline, "朱元璋称帝，建元洪武");
  assert.equal(data.sections["评论"][0].event_type, "opinion");
});

test("GET /api/issue/latest can generate a later quarter by request date", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.period.label, "洪武1年第2季度");
  assert.equal(data.period.start_label, "洪武1年4月");
  assert.equal(data.period.end_label, "洪武1年6月");
  assert.notEqual(data.lead.headline, "朱元璋称帝，建元洪武");
});

test("GET /api/issue/latest removes dangling source fragments from disaster lead bodies", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.lead.headline, "永新州（今江西永新）大雨、涝水灾");
  assert.equal(data.lead.body.endsWith("入鱼台。"), true);
  assert.equal(data.lead.body.includes("（《"), false);
});

test("GET /api/issue/latest ignores stale v3 cache with dangling disaster fragments", async () => {
  const env = makeEnv({
    "issue:v3:1368:4": JSON.stringify({
      period: { start_year: 1368, start_month: 4, label: "洪武1年第2季度" },
      lead: {
        headline: "永新州（今江西永新）大雨、涝水灾",
        body: "水灾永新州（今江西永新）大雨、涝：六月戊辰，江西永新州大风雨，蛟出，江水入城，高八尺，人多溺死。事闻，使赈之。曹州（今山东菏泽）决口：（河）决曹州双河口，入鱼台。（《",
      },
      articles: [],
      sections: {},
    }),
  });

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.lead.body.endsWith("入鱼台。"), true);
  assert.equal(data.lead.body.includes("（《"), false);
  assert.equal(env.ISSUE_CACHE.calls.get.some((call) => call.key === "issue:v3:1368:4"), false);
});

test("GET /api/issue/latest rejects invalid request dates", async () => {
  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-99-99"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 400);
  assert.equal(data.ok, false);
  assert.equal(data.error, "invalid_date");
});

test("GET /api/issue/latest caches generated issues by Ming quarter", async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;

  const first = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const firstData = await readJson(first);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-16"), env);
  const secondData = await readJson(second);

  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.deepEqual(secondData, firstData);
  assert.equal(kv.calls.get.filter((call) => call.key === "issue:v4:1368:4").length, 2);
  assert.equal(kv.calls.put.filter((call) => call.key === "issue:v4:1368:4").length, 1);
});

test("GET /api/issue/latest returns rule issue immediately and upgrades cache asynchronously when AI is available", async () => {
  const aiCalls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        calls: aiCalls,
        body: {
          response: JSON.stringify({
            headline: "社论：灾情逼近中枢，国家能力就不能停在口号上",
            subhead: "本报评论本季京师旱情：灾害进入京畿之后，财政、仓储与赈济调度必须立即接受检验。",
            body: "围绕“京师（今江苏南京旱灾”，本季真正的问题已经不是是否有灾，而是国家机器能否比灾情更快一步启动。京师受旱意味着政治中心直接面对粮价、仓储、赈济和民心压力，任何迟缓都会被放大成对朝廷能力的怀疑。若中枢只强调开国声威，而不能把减赋、发仓、问责和地方执行一并压实，那么灾害就会从自然损失转化为制度损耗。对新朝而言，真正需要建立的不是解释灾异的话语，而是应对风险的治理常态。",
          }),
        },
      }),
    },
  };
  const waitUntilCalls = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    },
  );
  const firstData = await readJson(first);
  const firstOpinion = firstData.sections["评论"][0];

  assert.equal(first.status, 200);
  assert.equal(firstOpinion.byline, "本报编辑部");
  assert.equal(firstOpinion.sources.includes("Cloudflare Workers AI 生成评论"), false);
  assert.equal(waitUntilCalls.length, 1);
  assert.equal(aiCalls.length, 1);

  await Promise.all(waitUntilCalls);

  assert.equal(aiCalls.length, 1);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19"), env);
  const secondData = await readJson(second);
  const secondOpinion = secondData.sections["评论"][0];

  assert.equal(secondOpinion.byline, "本报评论部");
  assert.equal(secondOpinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
});

test("GET /api/issue/latest keeps cached rule issue when async AI upgrade fails", async () => {
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        body: {
          response: "{",
        },
      }),
    },
  };
  const waitUntilCalls = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    },
  );
  const firstData = await readJson(first);
  const firstOpinion = firstData.sections["评论"][0];

  assert.equal(firstOpinion.byline, "本报编辑部");
  assert.equal(waitUntilCalls.length, 1);
  await Promise.all(waitUntilCalls);

  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19"), env);
  const secondData = await readJson(second);
  const secondOpinion = secondData.sections["评论"][0];

  assert.equal(secondOpinion.byline, "本报编辑部");
  assert.equal(secondOpinion.sources.includes("Cloudflare Workers AI 生成评论"), false);
});

test("GET /api/issue/latest retries async AI upgrade and stores upgraded issue after a transient failure", async () => {
  const aiCalls = [];
  let attempt = 0;
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: async (model, input = {}) => {
        aiCalls.push({ model, input });
        attempt += 1;
        if (attempt === 1) {
          return { response: "{" };
        }
        return {
          response: JSON.stringify({
            headline: "社论：灾情逼近中枢，国家能力就不能停在口号上",
            subhead: "本报评论本季京师旱情：灾害进入京畿之后，财政、仓储与赈济调度必须立即接受检验。",
            body: "围绕“京师（今江苏南京旱灾”，本季真正的问题已经不是是否有灾，而是国家机器能否比灾情更快一步启动。京师受旱意味着政治中心直接面对粮价、仓储、赈济和民心压力，任何迟缓都会被放大成对朝廷能力的怀疑。若中枢只强调开国声威，而不能把减赋、发仓、问责和地方执行一并压实，那么灾害就会从自然损失转化为制度损耗。对新朝而言，真正需要建立的不是解释灾异的话语，而是应对风险的治理常态。",
          }),
        };
      },
    },
  };
  const waitUntilCalls = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    {
      waitUntil(promise) {
        waitUntilCalls.push(promise);
      },
    },
  );
  const firstData = await readJson(first);
  assert.equal(firstData.sections["评论"][0].byline, "本报编辑部");

  await Promise.all(waitUntilCalls);

  assert.equal(aiCalls.length, 2);
  const second = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19"), env);
  const secondData = await readJson(second);
  const secondOpinion = secondData.sections["评论"][0];

  assert.equal(secondOpinion.byline, "本报评论部");
  assert.equal(secondOpinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
});

test("GET /api/issue/latest retries background AI upgrade when cached rule issue is requested again", async () => {
  let attempt = 0;
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: async () => {
        attempt += 1;
        if (attempt <= 2) {
          return { response: "{" };
        }
        return {
          response: {
            headline: "洪武2年第一季度：战后重建与财政挑战",
            subhead: "旱灾、北方元廷残余与卫所建设考验朝廷应对能力",
            body: "洪武2年第一季度，京师（今江苏南京）遭遇旱灾，朝廷祭祀风云雷雨岳镇海渎山川城隍旗纛诸神，祈求雨水，这一事件凸显了战后重建期的复杂性和挑战性。同时，北方元廷残余与各地卫所建设仍牵动朝廷注意，军务上需持续面对这些安全威胁。开国整饬期进入本季议程，户籍赋役与军政制度仍在重建，财政秩序的基础工程如黄册、鱼鳞图册、里甲与赋役编审等成为关键。新朝若不能将灾异应对、边防调度与财政重建统筹起来，所谓秩序就会停留在文书与祭告层面，而不能转化为真正可执行的国家能力。",
          },
        };
      },
    },
  };
  const firstWaits = [];
  const secondWaits = [];

  const first = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    {
      waitUntil(promise) {
        firstWaits.push(promise);
      },
    },
  );
  const firstData = await readJson(first);
  assert.equal(firstData.sections["评论"][0].byline, "本报编辑部");
  await Promise.all(firstWaits);

  const second = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-19"),
    env,
    {
      waitUntil(promise) {
        secondWaits.push(promise);
      },
    },
  );
  const secondData = await readJson(second);
  assert.equal(secondData.sections["评论"][0].byline, "本报编辑部");
  assert.equal(secondWaits.length, 1);
  await Promise.all(secondWaits);

  const third = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19"), env);
  const thirdData = await readJson(third);
  assert.equal(thirdData.sections["评论"][0].byline, "本报评论部");
  assert.equal(thirdData.sections["评论"][0].sources.includes("Cloudflare Workers AI 生成评论"), true);
});

test("GET /api/issue/latest enhances the opinion with OpenAI when configured", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    OPENAI_API_KEY: "test-key",
    OPENAI_MODEL: "gpt-5.4-mini",
    OPENAI_FETCH: makeOpenAiFetch({
      calls,
      body: {
        output_text: JSON.stringify({
          headline: "社论：胜利不是秩序，财政才是疆土的边界",
          subhead: "本报评论本季开国政治：头条之外，更要看朝廷能否把战果变成治理能力。",
          body: "本季真正值得警惕的，不是捷报能否写入诏书，而是朝廷是否有能力把军事胜利转化为可征税、可供粮、可派官的地方秩序。围绕“朱元璋称帝，建元洪武”，新朝已经取得名分优势，但名分并不自动带来户籍、仓储和卫所。若北伐继续推进而财政、粮运和地方官缺位，朝廷得到的将不是稳定版图，而是一张需要长期输血的军事账单。下一季的关键，是制度能否跟上战线，而不是诏书写得多漂亮。",
        }),
      },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.headline, "社论：胜利不是秩序，财政才是疆土的边界");
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.event_type, "opinion");
  assert.equal(opinion.category, "commentary");
  assert.equal(opinion.sources.includes("OpenAI 生成评论"), true);
  assert.match(opinion.body, /朱元璋称帝，建元洪武/);
  assert.match(opinion.body, /财政/);
});

test("GET /api/issue/latest enhances the opinion with chat completions when LLM is configured", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      calls,
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "社论：名分已经到手，治理才刚开始",
              subhead: "本报评论本季开国热点：称帝只是政治起点，财政与地方执行才决定新朝成色。",
              body: "围绕“朱元璋称帝，建元洪武”，本季最要紧的判断是：新朝已经取得名分，但名分还不是治理。真正考验朝廷的，是能否把开国声威转化为户籍、赋役、仓储和卫所的连续执行。若地方只听见新国号，却看不见可执行的官制、粮道与财政安排，开国政治就会停在仪式层面。下一季的风险，不在诏书是否庄严，而在国家能力能否压住军政扩张带来的财政缺口。",
            }),
          },
        }],
      },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];
  const requestBody = JSON.parse(calls[0].init.body);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://api.chatanywhere.tech/v1/chat/completions");
  assert.equal(requestBody.model, "gpt-4o-mini");
  assert.equal(requestBody.messages[0].role, "system");
  assert.equal(requestBody.messages[1].role, "user");
  assert.equal(opinion.headline, "社论：名分已经到手，治理才刚开始");
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("ChatAnywhere 生成评论"), true);
});

test("GET /api/issue/latest accepts fenced chat completion JSON and partial headline references", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      calls,
      body: {
        choices: [{
          message: {
            content: "```json\n{\"headline\":\"社论：南京旱灾不是天象，是治理压力测试\",\"subhead\":\"本报评论本季灾异热点：京师灾情照见财政、仓储与地方执行的薄弱处。\",\"body\":\"本季的京师旱灾不只是灾异记录，更是新朝治理能力的压力测试。南京作为政治中枢，一旦旱情牵动粮价、仓储和赈济，朝廷面对的就不是单一自然风险，而是财政调度、地方执行和民力承受之间的连锁反应。若政令只停留在安民口号，而不能落实到粮仓、税役减免和官员问责，灾异就会从地方痛点变成朝廷信用的损耗。下一步关键，是用制度响应灾情，而不是用祥异解释灾情。\"}\n```",
          },
        }],
      },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.headline, "社论：南京旱灾不是天象，是治理压力测试");
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("ChatAnywhere 生成评论"), true);
});

test("GET /api/issue/latest enhances the opinion with Cloudflare Workers AI when binding is configured", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        calls,
        body: {
          response: {
            headline: "社论：灾情逼近中枢，国家能力就不能停在口号上",
            subhead: "本报评论本季京师旱情：灾害进入京畿之后，财政、仓储与赈济调度必须立即接受检验。",
            body: "围绕“京师（今江苏南京旱灾”，本季真正的问题已经不是是否有灾，而是国家机器能否比灾情更快一步启动。京师受旱意味着政治中心直接面对粮价、仓储、赈济和民心压力，任何迟缓都会被放大成对朝廷能力的怀疑。若中枢只强调开国声威，而不能把减赋、发仓、问责和地方执行一并压实，那么灾害就会从自然损失转化为制度损耗。对新朝而言，真正需要建立的不是解释灾异的话语，而是应对风险的治理常态。",
          },
        },
      }),
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].model, "@cf/meta/llama-3.3-70b-instruct-fp8-fast");
  assert.equal(calls[0].input.messages[0].role, "system");
  assert.equal(calls[0].input.messages[1].role, "user");
  assert.equal(calls[0].input.response_format.type, "json_schema");
  assert.deepEqual(calls[0].input.response_format.json_schema.required, ["headline", "subhead", "body"]);
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
  assert.equal(data._debug.ai.provider, "workers_ai");
  assert.equal(data._debug.ai.responseOk, true);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest prefers Cloudflare Workers AI over external chat completions", async () => {
  const aiCalls = [];
  const llmCalls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        calls: aiCalls,
        body: {
          response: {
            headline: "社论：灾异当前，真正受考的是财政与执行",
            subhead: "本报评论本季治理焦点：面对京师灾情，朝廷必须拿出可兑现的制度响应。",
            body: "围绕“京师（今江苏南京旱灾”，本季最严厉的追问不是灾情有多重，而是朝廷能否把财政、仓储、赈济和地方执行组织成一套能立刻生效的治理动作。灾情一旦进入京畿，就不再只是地方事务，而是对中枢调度能力的正面考试。若只有安民之辞，没有仓廪之实与问责之严，那么新朝声威越高，地方对国家能力的失望反而越大。制度若不能先于风险到位，任何整饬都只能停留在文书层面。",
          },
        },
      }),
    },
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      calls: llmCalls,
      body: {
        choices: [{ message: { content: "{}" } }],
      },
    }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(aiCalls.length, 1);
  assert.equal(llmCalls.length, 0);
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
});

test("GET /api/issue/latest exposes sanitized AI debug metadata on demand", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      calls,
      body: {
        choices: [{
          message: {
            content: JSON.stringify({
              headline: "社论：名分已经到手，治理才刚开始",
              subhead: "本报评论本季开国热点：称帝只是政治起点，财政与地方执行才决定新朝成色。",
              body: "围绕“朱元璋称帝，建元洪武”，本季最要紧的判断是：新朝已经取得名分，但名分还不是治理。真正考验朝廷的，是能否把开国声威转化为户籍、赋役、仓储和卫所的连续执行。若地方只听见新国号，却看不见可执行的官制、粮道与财政安排，开国政治就会停在仪式层面。下一季的风险，不在诏书是否庄严，而在国家能力能否压住军政扩张带来的财政缺口。",
            }),
          },
        }],
      },
    }),
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(data._debug.cache.hit, false);
  assert.equal(data._debug.cache.bypassed, true);
  assert.equal(data._debug.ai.provider, "chat_completions");
  assert.equal(data._debug.ai.providerSource, "ChatAnywhere 生成评论");
  assert.equal(data._debug.ai.providerHost, "api.chatanywhere.tech");
  assert.equal(data._debug.ai.responseOk, true);
  assert.equal(data._debug.ai.status, 200);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
  assert.equal(typeof data._debug.ai.durationMs, "number");
  assert.equal(data._debug.ai.errorMessage, null);
});

test("GET /api/issue/latest debug shows AI failure details without secrets", async () => {
  const env = {
    ...makeEnv(),
    LLM_API_KEY: "test-chatanywhere-key",
    LLM_API_BASE: "https://api.chatanywhere.tech/v1",
    LLM_API_TYPE: "chat_completions",
    LLM_MODEL: "gpt-4o-mini",
    LLM_FETCH: makeOpenAiFetch({
      status: 502,
      body: { error: { message: "upstream overloaded" } },
    }),
  };

  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15&debug=1&refresh=1"),
    env,
  );
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报编辑部");
  assert.equal(data._debug.ai.provider, "chat_completions");
  assert.equal(data._debug.ai.responseOk, false);
  assert.equal(data._debug.ai.status, 502);
  assert.equal(data._debug.ai.parseOk, false);
  assert.equal(data._debug.ai.validationOk, false);
  assert.match(data._debug.ai.errorMessage, /HTTP 502/);
  assert.match(data._debug.ai.errorMessage, /upstream overloaded/);
  assert.equal(data._debug.ai.outputPreview, "{\"error\":{\"message\":\"upstream overloaded\"}}");
  assert.equal(data._debug.ai.errorMessage.includes("test-chatanywhere-key"), false);
});

test("GET /api/issue/latest uses the runtime fetch binding when no custom AI fetch is provided", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = function runtimeBoundFetch(url, init = {}) {
    if (this !== globalThis) {
      throw new TypeError("Illegal invocation");
    }
    return Promise.resolve(new Response(JSON.stringify({
      choices: [{
        message: {
          content: JSON.stringify({
            headline: "社论：旱情先到，财政与赈济就不能迟到",
            subhead: "本报评论本季灾情观察：京师旱灾暴露的，是中枢调度与地方执行的真实压力。",
            body: "围绕“京师（今江苏南京旱灾”，本季真正需要追问的，不是灾异如何书写，而是财政、仓储与赈济是否已经进入随时可用的状态。京师先旱，意味着政治中枢也直接暴露在粮价、供给和民心压力之下。若朝廷仍把主要精力停留在开国声威，而不能把救济、赋役减缓和地方官问责一并压实，那么灾情就会迅速转化为对国家能力的质疑。新朝若要立住，不靠祥瑞解释，而靠制度兑现。",
          }),
        },
      }],
    }), {
      status: 200,
      headers: { "content-type": "application/json" },
    }));
  };

  try {
    const env = {
      ...makeEnv(),
      LLM_API_KEY: "test-chatanywhere-key",
      LLM_API_BASE: "https://api.chatanywhere.tech/v1",
      LLM_API_TYPE: "chat_completions",
      LLM_MODEL: "gpt-4o-mini",
    };

    const response = await worker.fetch(
      new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"),
      env,
    );
    const data = await readJson(response);
    const opinion = data.sections["评论"][0];

    assert.equal(response.status, 200);
    assert.equal(opinion.byline, "本报评论部");
    assert.equal(opinion.sources.includes("ChatAnywhere 生成评论"), true);
    assert.equal(data._debug.ai.responseOk, true);
    assert.equal(data._debug.ai.validationOk, true);
    assert.equal(data._debug.ai.errorMessage, null);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GET /api/issue/latest tolerates Workers AI JSON with literal newlines in body", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        calls,
        body: {
          response: "{\n\"headline\":\"社论：灾情当前，真正受考的是朝廷执行力\",\n\"subhead\":\"本报评论本季京师旱情：真正的压力不在天象，而在财政与赈济调度。\",\n\"body\":\"围绕京师（今江苏南京旱灾），本季真正需要追问的不是灾异如何解释，\n而是中枢能否把财政、仓储、赈济和地方执行快速组织起来。京师受旱意味着政治中心直接面对粮价与民心压力。若朝廷只有安民之辞，没有减赋、发仓与问责之实，那么灾情就会迅速转化为对国家能力的怀疑。真正决定新朝成色的，不是口号，而是制度是否先于风险到位。\"}",
        },
      }),
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-19&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
  assert.equal(data._debug.ai.parseOk, true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest flattens structured Workers AI body objects into commentary text", async () => {
  const calls = [];
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        calls,
        body: {
          response: "```json\n{\n  \"headline\": \"战后秩序重建与财政承压\",\n  \"subhead\": \"北伐灭元后，明朝面临财政、治理与地方执行的多重压力\",\n  \"body\": [\n    {\n      \"判断\": \"明军攻占大都、元朝灭亡之后，明朝进入战后秩序重建阶段。\",\n      \"热点切入\": \"本季度最重要的一条热点新闻，是明军攻占大都、元朝灭亡后留下的治理与接收压力。\",\n      \"制度分析\": \"战后秩序重建与财政承压彼此缠绕。若黄册、赋役、仓储与地方军政编制不能及时落地，新朝就会在扩张之后立刻面对治理真空。\",\n      \"风险结论\": \"真正危险的不是战果不够，而是朝廷能否把胜利转化为可以持续运转的财政与制度能力。\"\n    }\n  ]\n}\n```",
        },
      }),
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.body, /明军攻占大都/);
  assert.match(opinion.body, /财政承压/);
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest accepts commentary that cites a secondary quarterly hotspot", async () => {
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.1-8b-instruct",
    AI: {
      run: makeWorkersAiRun({
        body: {
          response: JSON.stringify({
            headline: "洪武开国整饬期的财政挑战",
            subhead: "本季度朝政观察：赋役、仓储与漕运仍为民生命脉",
            body: "本季度的新闻报道显示，洪武开国整饬期仍面临着财政挑战。户部与地方州县仍需围绕田赋、漕粮、仓储和转输维持日常运作。民生稳定不仅取决于收成，也取决于地方官能否把赋役、救济和运输安排在可承受范围内。同时，战后秩序、户籍赋役与军政制度仍在重建，财政栏目需持续观察具体情况。",
          }),
        },
      }),
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-17&debug=1&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报评论部");
  assert.equal(opinion.sources.includes("Cloudflare Workers AI 生成评论"), true);
  assert.equal(data._debug.ai.validationOk, true);
});

test("GET /api/issue/latest normalizes AI commentary into a sharper editorial frame", async () => {
  const env = {
    ...makeEnv(),
    AI_MODEL: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
    AI: {
      run: makeWorkersAiRun({
        body: {
          response: {
            headline: "洪武元年季度评论：战后秩序重建与权力结构",
            subhead: "新朝立足未稳，真正的考验不在登基礼成，而在制度能否压住战后失序",
            body: "本季度的新闻报道显示，朱元璋称帝，建元洪武之后，新朝正处于建立和巩固的关键时期。同时，北方元廷残余和各地卫所建设仍然是朝廷关注的重要问题。朝廷需要通过黄册、鱼鳞图册、里甲和赋役编审来重建财政秩序，也需要重点建设国子学、科举取士和礼制。综上所述，战后秩序重建与权力结构调整是当前的重要任务。",
          },
        },
      }),
    },
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15&refresh=1"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报评论部");
  assert.match(opinion.headline, /^社论：/);
  assert.doesNotMatch(opinion.headline, /季度评论|综述|观察/);
  assert.doesNotMatch(opinion.body, /本季度的新闻报道显示/);
  assert.doesNotMatch(opinion.body, /综上所述/);
  assert.ok(opinion.sources.includes("Cloudflare Workers AI 生成评论"));
});

test("GET /api/issue/latest falls back to rule opinion when OpenAI fails", async () => {
  const env = {
    ...makeEnv(),
    OPENAI_API_KEY: "test-key",
    OPENAI_FETCH: makeOpenAiFetch({ status: 500, body: { error: { message: "model unavailable" } } }),
  };

  const response = await worker.fetch(new Request("https://example.test/api/issue/latest?date=2026-05-15"), env);
  const data = await readJson(response);
  const opinion = data.sections["评论"][0];

  assert.equal(response.status, 200);
  assert.equal(opinion.byline, "本报编辑部");
  assert.equal(opinion.sources.includes("OpenAI 生成评论"), false);
});

test("scheduled pre-generates the current issue in KV", async () => {
  const env = makeEnv();
  const kv = env.ISSUE_CACHE;
  const waitUntilCalls = [];

  await worker.scheduled({ scheduledTime: Date.UTC(2026, 4, 17) }, env, {
    waitUntil(promise) {
      waitUntilCalls.push(promise);
    },
  });
  await Promise.all(waitUntilCalls);

  const issueWrites = kv.calls.put.filter((call) => call.key === "issue:v4:1368:7");
  assert.equal(issueWrites.length, 1);
  const cached = JSON.parse(issueWrites[0].value);
  assert.equal(cached.period.label, "洪武1年第3季度");
});

test("GET /api/issue/latest returns 503 when historical data is missing", async () => {
  const response = await worker.fetch(
    new Request("https://example.test/api/issue/latest?date=2026-05-15"),
    { ISSUE_CACHE: makeKv() },
  );
  const data = await readJson(response);

  assert.equal(response.status, 503);
  assert.equal(data.ok, false);
  assert.equal(data.error, "history_data_unavailable");
});

test("GET /health returns service metadata", async () => {
  const response = await worker.fetch(new Request("https://example.test/health"), makeEnv());
  const data = await readJson(response);

  assert.equal(response.status, 200);
  assert.equal(data.ok, true);
  assert.equal(data.service, "ming-post-api");
  assert.equal(typeof data.issue.label, "string");
  assert.notEqual(data.issue.label.length, 0);
});

test("unknown routes return JSON 404", async () => {
  const response = await worker.fetch(new Request("https://example.test/missing"));
  const data = await readJson(response);

  assert.equal(response.status, 404);
  assert.equal(data.ok, false);
  assert.equal(data.error, "not_found");
});
