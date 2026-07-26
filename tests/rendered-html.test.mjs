import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the Lumen workspace", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Lumen — AI Decision Intelligence<\/title>/i);
  assert.match(html, /Executive pulse/);
  assert.match(html, /Lumen Analyst/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("includes provider settings, history, charts, and an AI route", async () => {
  const [workspace, store, route] = await Promise.all([
    readFile(new URL("../components/analytics-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /function SettingsView/);
  assert.match(workspace, /function HistoryView/);
  assert.match(workspace, /onClick=\{\(\) => void ask\(p\)\}/);
  assert.match(workspace, /grid-cols-\[72px_minmax\(0,1fr\)\]/);
  assert.match(store, /OpenRouter/);
  assert.match(store, /Anthropic/);
  assert.match(store, /Sankey/);
  assert.match(store, /aiOpen: false/);
  assert.match(store, /setActiveView: \(activeView\) => set\(\{ activeView, aiOpen: false \}\)/);
  assert.match(route, /chat\/completions/);
  assert.match(route, /anthropic-version/);
});
