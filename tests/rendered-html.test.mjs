import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function render(path = "/") {
  const workerUrl = new URL("../dist/server/index.js", import.meta.url);
  workerUrl.searchParams.set("test", `${process.pid}-${Date.now()}`);
  const { default: worker } = await import(workerUrl.href);
  return worker.fetch(new Request(`http://localhost${path}`, { headers: { accept: "text/html" } }), { ASSETS: { fetch: async () => new Response("Not found", { status: 404 }) } }, { waitUntil() {}, passThroughOnException() {} });
}

test("renders the cinematic Lumen landing page", async () => {
  const response = await render();
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^text\/html\b/i);
  const html = await response.text();
  assert.match(html, /<title>Lumen — AI Decision Intelligence<\/title>/i);
  assert.match(html, /See the decision/);
  assert.match(html, /Three moves from raw to ready/);
  assert.match(html, /Simple pricing/);
  assert.doesNotMatch(html, /codex-preview|Your site is taking shape/);
});

test("renders dedicated login and registration pages", async () => {
  const [login, register] = await Promise.all([render("/login"), render("/register")]);
  assert.equal(login.status, 200);
  assert.equal(register.status, 200);
  assert.match(await login.text(), /Sign in to Lumen/);
  assert.match(await register.text(), /Create your workspace/);
});

test("includes provider settings, private dataset sessions, charts, and an AI route", async () => {
  const [workspace, store, sessionStorage, analysis, intelligence, visualization, route] = await Promise.all([
    readFile(new URL("../components/analytics-workspace.tsx", import.meta.url), "utf8"),
    readFile(new URL("../lib/store.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/session-storage.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/analysis.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/dataset-intelligence.ts", import.meta.url), "utf8"),
    readFile(new URL("../lib/visualization.ts", import.meta.url), "utf8"),
    readFile(new URL("../app/api/ai/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /function SettingsView/);
  assert.match(workspace, /function HistoryView/);
  assert.match(workspace, /function AnalysisView/);
  assert.match(workspace, /function MarkdownMessage/);
  assert.match(workspace, /Analysis skills/);
  assert.match(workspace, /skill\.prompt/);
  assert.match(workspace, /Wrap long headers/);
  assert.match(workspace, /Page \{page \+ 1\} \/ \{pageCount\}/);
  assert.match(workspace, /visibleRows\.map/);
  assert.match(workspace, /Fields \{columns\.length\}\/\{allColumns\.length\}/);
  assert.match(workspace, /grid-cols-\[72px_minmax\(0,1fr\)_0px\]/);
  assert.match(workspace, /data-ai-open/);
  assert.match(store, /OpenRouter/);
  assert.match(store, /Anthropic/);
  assert.match(store, /Ollama \(local\)/);
  assert.match(store, /defaultModelId: "qwen3:8b"/);
  assert.match(store, /Sankey/);
  assert.match(store, /aiOpen: false/);
  assert.match(store, /activeView: "analysis"/);
  assert.match(store, /activeView === "analysis" \? true/);
  assert.match(route, /chat\/completions/);
  assert.match(route, /anthropic-version/);
  assert.match(route, /keep_alive: 0/);
  assert.match(route, /num_ctx: 4096/);
  assert.match(route, /runOllamaSerially/);
  assert.match(route, /getAnalysisSkill/);
  assert.match(store, /activeAnalysisSkill/);
  assert.match(workspace, /Start with your data, not ours\./);
  assert.match(store, /activeSessionId: null/);
  assert.doesNotMatch(store, /Northstar_FY25/);
  assert.doesNotMatch(analysis, /export const sampleData/);
  assert.match(analysis, /return source\.map\(\(item\) =>/);
  assert.doesNotMatch(analysis, /source\.slice\(0,\s*5000\)/);
  assert.match(sessionStorage, /lumen-private-workspaces/);
  assert.match(sessionStorage, /session\.ownerId === ownerId/);
  assert.match(workspace, /questionSessionId/);
  assert.match(workspace, /AI is understanding your data/);
  assert.match(workspace, /Source dataset:/);
  assert.match(workspace, /rowFileFieldsRole/);
  assert.match(workspace, /Start with meaning and evidence/);
  assert.match(workspace, /Open dashboard/);
  assert.match(workspace, /AI visual canvas/);
  assert.match(workspace, /AI-generated visuals/);
  assert.match(workspace, /addVisualization\(requestedVisualization\)/);
  assert.match(workspace, /ai-generated-charts/);
  assert.match(workspace, /visualizationFromPrompt/);
  assert.match(workspace, /GeneratedVisualization/);
  assert.match(workspace, /Suggested next analyses/);
  assert.match(intelligence, /Media messaging operations/);
  assert.match(intelligence, /ensureDatasetSourceDescription/);
  assert.match(intelligence, /uploaded.*dataset contains/i);
  assert.match(intelligence, /filesize\|file_size\|bytes/);
  assert.match(route, /dataset-discovery/);
  assert.match(route, /format: "json"/);
  assert.match(route, /never draw ASCII/);
  assert.match(route, /Source boundary:/);
  assert.match(route, /referenced attachment or record/);
  assert.match(visualization, /function inferVisualization/);
  assert.match(visualization, /function visualizationFromPrompt/);
  assert.match(visualization, /function semanticDimension/);
  assert.match(visualization, /function buildVisualizationData/);
  assert.match(sessionStorage, /visualization\?: VisualizationSpec/);
  assert.match(sessionStorage, /visualizations\?: VisualizationSpec\[\]/);
});

test("provides a standard Next.js build for Vercel", async () => {
  const [packageJson, vercelConfig, nextConfig] = await Promise.all([
    readFile(new URL("../package.json", import.meta.url), "utf8"),
    readFile(new URL("../vercel.json", import.meta.url), "utf8"),
    readFile(new URL("../next.config.ts", import.meta.url), "utf8"),
  ]);
  assert.match(packageJson, /"build:vercel": "VERCEL=1 next build"/);
  assert.match(vercelConfig, /"framework": "nextjs"/);
  assert.match(vercelConfig, /"buildCommand": "npm run build:vercel"/);
  assert.match(nextConfig, /tsconfig\.vercel\.json/);
});
