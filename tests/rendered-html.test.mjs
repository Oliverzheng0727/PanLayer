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
  assert.match(html, /仅供市场复盘，不构成投资建议/);
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
