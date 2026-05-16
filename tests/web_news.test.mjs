import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";

function loadNewsRenderer() {
  const source = readFileSync(new URL("../web/js/news.js", import.meta.url), "utf8");
  const context = {
    document: {
      addEventListener() {},
    },
    window: {},
  };
  vm.createContext(context);
  vm.runInContext(source, context);
  return context;
}

test("createArticleHTML removes dangling source fragments from API bodies", () => {
  const { createArticleHTML } = loadNewsRenderer();
  const html = createArticleHTML({
    id: "DIS_1368_1",
    headline: "永新州（今江西永新）大雨、涝水灾",
    body: "水灾永新州（今江西永新）大雨、涝：六月戊辰，江西永新州大风雨，蛟出，江水入城，高八尺，人多溺死。事闻，使赈之。曹州（今山东菏泽）决口：（河）决曹州双河口，入鱼台。（《",
  }, true);

  assert.match(html, /入鱼台。/);
  assert.doesNotMatch(html, /（《/);
});
