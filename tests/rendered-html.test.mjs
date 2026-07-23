import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const templateRoot = new URL("../", import.meta.url);

async function render(pathname = "/", headers = {}) {
  process.env.ALLOWED_USER_EMAIL = "owner@example.com";
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}-${Math.random()}`);
  const { default: worker } = await import(workerUrl.href);

  return worker.fetch(
    new Request(`http://localhost${pathname}`, {
      headers: { accept: "text/html", ...headers },
    }),
    {
      ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) },
      ALLOWED_USER_EMAIL: "owner@example.com",
    },
    { waitUntil() {}, passThroughOnException() {} },
  );
}

test("server-renders the PanLayer immersive landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /<title>盘层 PanLayer/);
  assert.match(html, /Read beneath/);
  assert.match(html, /the market move/);
  assert.match(html, /进入今日复盘/);
  assert.match(html, /市场有迹，情绪有层/);
  assert.match(html, /property="og:image" content="http:\/\/localhost\/og\.png"/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton|Your site is taking shape/);
});

test("server-renders the protected review dashboard for the allowed user", async () => {
  const response = await render("/dashboard", {
    "oai-authenticated-user-email": "owner@example.com",
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.match(html, /今日总览/);
  assert.match(html, /市场温度/);
  assert.match(html, /连板梯队/);
  assert.match(html, /行业 ETF/);
  assert.match(html, /ETF 全品类/);
  assert.match(html, /近20日均成交/);
  assert.match(html, /历史数据表/);
  assert.match(html, /120日新高/);
  assert.match(html, /连板收盘溢价/);
  const historyTable = html.match(/<table class="history-table">[\s\S]*?<\/table>/)?.[0] ?? "";
  assert.ok(historyTable.indexOf("热点板块") < historyTable.indexOf("日期"), "历史表应将热点板块放在日期之前，方便优先选择");
  assert.match(html, /固定表头/);
  assert.match(html, /查看120日新高股票/);
  assert.match(html, /查看历史新高股票/);
  assert.doesNotMatch(html, /市场情绪震荡修复/);
  assert.match(html, /仅供市场复盘，不构成投资建议/);
  assert.match(html, /数据来源/);
  assert.match(html, /更新时间/);
  assert.match(html, /状态口径/);
  assert.match(html, /当天早参尚未生成/);
  assert.doesNotMatch(html, /演示来源占位/);
  assert.match(html, /完整/);
  assert.match(html, /部分/);
  assert.match(html, /失败/);
  assert.match(html, /演示/);
  assert.doesNotMatch(html, /OPENAI_API_KEY|FIRECRAWL_API_KEY|fc-[A-Za-z0-9_-]+|TWELVE_DATA_API_KEY|ALPHA_VANTAGE_API_KEY|FRED_API_KEY|EIA_API_KEY/);
});

test("binds morning brief cards to source-aware details instead of a placeholder URL", async () => {
  const [dashboard, renderer] = await Promise.all([
    readFile(new URL("../app/components/Dashboard.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/components/brief/BriefBlockRenderer.tsx", import.meta.url), "utf8"),
  ]);
  assert.match(dashboard, /BriefDetailDrawer/);
  assert.match(dashboard, /BriefRegenerateButton/);
  assert.doesNotMatch(dashboard, /href="https:\/\/example\.com"/);
  assert.doesNotMatch(renderer, /dangerouslySetInnerHTML|innerHTML/);
});

test("removes the disposable starter preview", async () => {
  const [page, layout, packageJson] = await Promise.all([
    readFile(new URL("../app/page.tsx", import.meta.url), "utf8"),
    readFile(new URL("../app/layout.tsx", import.meta.url), "utf8"),
    readFile(new URL("../package.json", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(page, /_sites-preview|codex-preview|SkeletonPreview/);
  assert.match(layout, /盘层 PanLayer/);
  assert.doesNotMatch(packageJson, /react-loading-skeleton/);
  await assert.rejects(access(new URL("../app/_sites-preview", templateRoot)));
});

test("expands the ETF K-line into a full-width row on medium screens", async () => {
  const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
  const responsiveRule = css.match(/@media \(max-width:1180px\) \{[^}]+(?:\}[^@]*)*/)?.[0] ?? "";
  assert.match(responsiveRule, /\.etf-chart-panel \{ grid-column:1\/-1;/);
  assert.match(responsiveRule, /\.etf-chart-canvas \{ height:500px;/);
});

test("infers chart time from each bar instead of the selected period", async () => {
  const chart = await readFile(new URL("../app/components/etf/EtfChart.tsx", import.meta.url), "utf8");
  assert.match(chart, /time\.includes\(" "\)/);
  assert.doesNotMatch(chart, /chartTime\s*=\s*\(time:\s*string,\s*period:/);
});

test("loads persisted review, brief, and history before using demo fallbacks", async () => {
  const page = await readFile(new URL("../app/dashboard/page.tsx", import.meta.url), "utf8");
  assert.match(page, /readLatestReview/);
  assert.match(page, /readBrief/);
  assert.match(page, /readHistory/);
  assert.match(page, /storedReview\s*\?\?/);
  assert.match(page, /storedBrief\s*\?\?/);
});
