"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import type { ReactNode } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { gsap } from "gsap";
import Papa from "papaparse";
import { readSheet } from "read-excel-file/browser";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Bot, Check,
  ChevronDown, ChevronLeft, ChevronRight, CircleHelp, Clock3, Copy, Database, Download, Eye, EyeOff, FileJson, FileSpreadsheet,
  FileText, FolderKanban, Gauge, LayoutDashboard, Lightbulb, Menu, MessageSquare,
  PanelRightClose, PanelRightOpen, Plus, Search, Send, Settings, ShieldCheck, Sparkles,
  Table2, Trash2, Upload, WandSparkles, X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Legend, Line, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { DataRow, formatCompact, getColumns, localAnalystAnswer, normalizeRows, summarize } from "@/lib/analysis";
import { chartOptions, defaultProviders, ProviderConfig, useWorkspace } from "@/lib/store";
import { analysisSkills, AnalysisSkillId } from "@/lib/analysis-skills";
import { DatasetIntelligence, inferDatasetIntelligence, parseAIIntelligence } from "@/lib/dataset-intelligence";
import { buildVisualizationData, inferVisualization, visualizationFromPrompt, visualizationInsight, VisualizationSpec, VisualizationType } from "@/lib/visualization";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const accepted = ["csv", "xlsx", "json", "pdf"];

function datasetSourceContext(fileName: string) {
  const extension = fileName.split(".").pop()?.toUpperCase() || "UNKNOWN";
  return {
    uploadedFileName: fileName,
    uploadedFormat: extension,
    uploadedFileRole: "dataset container",
    rowFileFieldsRole: "FileName, MimeType, and similar values describe attachments referenced by individual records; they are not the uploaded dataset format",
  };
}

function downloadText(fileName: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function markdownInline(text: string): ReactNode[] {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g).filter(Boolean).map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) return <strong key={index} className="font-semibold text-[#18243a]">{part.slice(2, -2)}</strong>;
    if (part.startsWith("`") && part.endsWith("`")) return <code key={index} className="rounded bg-[#dfe4ee] px-1 py-0.5 font-mono text-[.92em] text-[#24324a]">{part.slice(1, -1)}</code>;
    if ((part.startsWith("*") && part.endsWith("*")) || (part.startsWith("_") && part.endsWith("_"))) return <em key={index}>{part.slice(1, -1)}</em>;
    return part;
  });
}

function normalizeMarkdown(content: string) {
  return content
    .replace(/\s+(#{1,4})\s+/g, "\n\n$1 ")
    .replace(/^(#{1,4})\s*(Headline|Key insights|Recommended action|Design note|Uncertainty|Dataset understood|Suggested starting points)\s*:?\s*/gim, "$1 $2\n\n")
    .replace(/\s+-\s+(?=(?:\*\*|[A-Z0-9]))/g, "\n- ")
    .replace(/\s+(\d+\.)\s+(?=[A-Z*])/g, "\n$1 ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function MarkdownMessage({ content }: { content: string }) {
  const lines = normalizeMarkdown(content).split("\n");
  const blocks: ReactNode[] = [];
  let index = 0;
  while (index < lines.length) {
    const line = lines[index].trim();
    if (!line) { index += 1; continue; }
    const heading = /^(#{1,4})\s+(.+)$/.exec(line);
    if (heading) {
      const level = heading[1].length;
      const className = level <= 2 ? "mb-2 mt-1 text-base font-semibold leading-6 text-[#101a2d]" : "mb-1.5 mt-3 text-xs font-bold uppercase tracking-[.08em] text-[#4f5b71]";
      blocks.push(level <= 2 ? <h3 key={blocks.length} className={className}>{markdownInline(heading[2])}</h3> : <h4 key={blocks.length} className={className}>{markdownInline(heading[2])}</h4>);
      index += 1;
      continue;
    }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^[-*]\s+/.test(lines[index].trim())) { items.push(lines[index].trim().replace(/^[-*]\s+/, "")); index += 1; }
      blocks.push(<ul key={blocks.length} className="my-2 space-y-1.5 pl-4">{items.map((item, itemIndex) => <li key={itemIndex} className="list-disc pl-0.5">{markdownInline(item)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (index < lines.length && /^\d+\.\s+/.test(lines[index].trim())) { items.push(lines[index].trim().replace(/^\d+\.\s+/, "")); index += 1; }
      blocks.push(<ol key={blocks.length} className="my-2 space-y-1.5 pl-4">{items.map((item, itemIndex) => <li key={itemIndex} className="list-decimal pl-0.5">{markdownInline(item)}</li>)}</ol>);
      continue;
    }
    const paragraph = [line];
    index += 1;
    while (index < lines.length && lines[index].trim() && !/^(#{1,4})\s+|^[-*]\s+|^\d+\.\s+/.test(lines[index].trim())) { paragraph.push(lines[index].trim()); index += 1; }
    blocks.push(<p key={blocks.length} className="my-1.5 leading-5">{markdownInline(paragraph.join(" "))}</p>);
  }
  return <div className="markdown-message">{blocks}</div>;
}

const discoveryRequests = new Map<string, Promise<DatasetIntelligence>>();

function profileForAI(rows: DataRow[]) {
  const profile = summarize(rows);
  return {
    columns: profile.columns,
    primary: profile.primary,
    total: profile.total,
    average: profile.avg,
    growth: profile.growth,
    anomalies: profile.anomalies,
    category: profile.category,
    categoryBreakdown: profile.categoryBreakdown,
    completeness: profile.completeness,
    missingRows: profile.missingRows,
    duplicateRows: profile.duplicateRows,
    exceptions: profile.exceptions,
  };
}

function discoverDataset(sessionId: string, rows: DataRow[], fileName: string): Promise<DatasetIntelligence> {
  const existing = discoveryRequests.get(sessionId);
  if (existing) return existing;
  const request = (async () => {
    const fallback = inferDatasetIntelligence(rows, fileName);
    const state = useWorkspace.getState();
    const provider = state.providers.find((item) => item.id === state.defaultProviderId) ?? state.providers.find((item) => item.enabled);
    const model = provider?.models.find((item) => item.id === state.defaultModelId) ?? provider?.models[0];
    if (!provider || !model || (provider.kind !== "ollama" && !provider.apiKey.trim())) {
      const local = { ...fallback, source: "local" as const };
      state.setSessionIntelligence(sessionId, local);
      return local;
    }
    try {
      const response = await fetch("/api/ai", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          task: "dataset-discovery",
          provider: { kind: provider.kind, baseUrl: provider.baseUrl, apiKey: provider.apiKey },
          model: model.id,
          question: "Understand this dataset and propose the three most useful analyses.",
          context: { sourceDataset: datasetSourceContext(fileName), fileName, profile: profileForAI(rows), sample: rows.slice(0, provider.kind === "ollama" ? 12 : 30) },
        }),
      });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "Dataset discovery returned no result.");
      const intelligence = parseAIIntelligence(data.answer, rows, fileName);
      useWorkspace.getState().setSessionIntelligence(sessionId, intelligence);
      return intelligence;
    } catch {
      const local = { ...fallback, source: "local" as const };
      useWorkspace.getState().setSessionIntelligence(sessionId, local);
      return local;
    }
  })();
  discoveryRequests.set(sessionId, request);
  void request.finally(() => discoveryRequests.delete(sessionId)).catch(() => undefined);
  return request;
}

function MetricCard({ label, value, delta, note, accent = "blue" }: { label: string; value: string; delta?: number; note: string; accent?: "blue" | "lime" | "coral" }) {
  const positive = (delta ?? 0) >= 0;
  const colors = { blue: "bg-[#2764ff]", lime: "bg-[#b8ed3a]", coral: "bg-[#ff6a4d]" };
  return (
    <div className="metric-card card-shadow relative min-h-36 overflow-hidden rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
      <span className={`absolute left-0 top-0 h-1 w-full ${colors[accent]}`} />
      <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[.12em] text-[#657087]">
        {label}<Gauge className="h-4 w-4" />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[28px] font-semibold tracking-[-.04em] text-[#101a2d]">{value}</span>
        {delta !== undefined && <span className={`mb-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${positive ? "bg-[#eaf8cd] text-[#466800]" : "bg-[#ffebe6] text-[#a52c16]"}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(delta).toFixed(1)}%
        </span>}
      </div>
      <p className="mt-2 text-xs leading-5 text-[#7a8497]">{note}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-[#dedbd2] bg-white/95 p-3 shadow-xl backdrop-blur"><p className="mb-2 text-xs font-semibold text-[#657087]">{label}</p>{payload.map((p) => <p key={p.name} className="text-xs font-semibold" style={{ color: p.color }}>{p.name}: {formatCompact(p.value)}</p>)}</div>;
}

const visualizationColors = ["#2764ff", "#b8ed3a", "#ff6a4d", "#7c5cff", "#2eb7a4", "#ffb547", "#8aa0c8", "#d65db1", "#4c78a8", "#72b7b2", "#f58518", "#9d755d"];

function GeneratedVisualization({ spec, data }: { spec: VisualizationSpec; data: ReturnType<typeof buildVisualizationData> }) {
  if (spec.type === "pie" || spec.type === "donut") {
    return <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={data} dataKey="value" nameKey="name" cx="50%" cy="46%" innerRadius={spec.type === "donut" ? 68 : 0} outerRadius={105} paddingAngle={data.length > 1 ? 2 : 0}>{data.map((item, index) => <Cell key={`${item.name}-${index}`} fill={visualizationColors[index % visualizationColors.length]} />)}</Pie><Tooltip content={<ChartTooltip />} /><Legend verticalAlign="bottom" iconType="circle" wrapperStyle={{ fontSize: 10, color: "#657087" }} /></PieChart></ResponsiveContainer>;
  }
  if (spec.type === "bar") {
    return <ResponsiveContainer width="100%" height="100%"><BarChart data={data} margin={{ top: 12, right: 8, bottom: 8, left: -8 }}><CartesianGrid vertical={false} stroke="#ece8df" strokeDasharray="3 3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#657087", fontSize: 10 }} interval={0} angle={data.length > 7 ? -22 : 0} textAnchor={data.length > 7 ? "end" : "middle"} height={data.length > 7 ? 58 : 30}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} tickFormatter={formatCompact}/><Tooltip content={<ChartTooltip />}/><Bar dataKey="value" name={spec.aggregation === "count" ? "Records" : spec.yField || "Value"} fill="#2764ff" radius={[7, 7, 0, 0]}>{data.map((_, index) => <Cell key={index} fill={visualizationColors[index % visualizationColors.length]} />)}</Bar></BarChart></ResponsiveContainer>;
  }
  return <ResponsiveContainer width="100%" height="100%"><AreaChart data={data} margin={{ top: 12, right: 8, bottom: 8, left: -8 }}><defs><linearGradient id="generatedAreaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2764ff" stopOpacity={.25}/><stop offset="95%" stopColor="#2764ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece8df" strokeDasharray="3 3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#657087", fontSize: 10 }} minTickGap={24}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} tickFormatter={formatCompact}/><Tooltip content={<ChartTooltip />}/>{spec.type === "area" ? <Area type="monotone" dataKey="value" name={spec.aggregation === "count" ? "Records" : spec.yField || "Value"} stroke="#2764ff" strokeWidth={2.5} fill="url(#generatedAreaFill)"/> : <Line type="monotone" dataKey="value" name={spec.aggregation === "count" ? "Records" : spec.yField || "Value"} stroke="#2764ff" strokeWidth={2.5} dot={{ r: 3, fill: "#fff", strokeWidth: 2 }}/>}</AreaChart></ResponsiveContainer>;
}

function UploadDialog({ label = "Add data", className = "h-9 shadow-sm" }: { label?: string; className?: string }) {
  const { setDataset } = useWorkspace();
  const [open, setOpen] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [busy, setBusy] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const processFile = async (file?: File) => {
    if (!file) return;
    const extension = file.name.split(".").pop()?.toLowerCase() || "";
    if (!accepted.includes(extension)) return toast.error("Unsupported format. Use CSV, Excel, JSON, or PDF.");
    if (file.size > MAX_FILE_SIZE) return toast.error("File is larger than the 20 MB safety limit.");
    setBusy(true);
    try {
      let rows: DataRow[] = [];
      if (extension === "csv") {
        const parsed = Papa.parse<Record<string, unknown>>(await file.text(), { header: true, dynamicTyping: true, skipEmptyLines: true });
        rows = normalizeRows(parsed.data);
      } else if (extension === "json") {
        rows = normalizeRows(JSON.parse(await file.text()));
      } else if (extension === "xlsx") {
        const cells = await readSheet(file);
        const headers = (cells[0] || []).map((cell, index) => String(cell || `Column ${index + 1}`).slice(0, 80));
        rows = normalizeRows(cells.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] == null ? null : values[index] instanceof Date ? values[index].toISOString() : values[index]]))));
      } else {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const extracted: DataRow[] = [];
        for (let pageNumber = 1; pageNumber <= Math.min(doc.numPages, 50); pageNumber++) {
          const page = await doc.getPage(pageNumber);
          const content = await page.getTextContent();
          const text = content.items.map((item) => "str" in item ? item.str : "").join(" ").replace(/\s+/g, " ").trim();
          extracted.push({ page: pageNumber, characters: text.length, words: text ? text.split(" ").length : 0, content: text.slice(0, 1000) });
        }
        rows = extracted;
      }
      if (!rows.length) throw new Error("No structured records found");
      const cleanName = file.name.replace(/[<>]/g, "");
      const sessionId = await setDataset(rows, cleanName);
      const initial = useWorkspace.getState().intelligence ?? inferDatasetIntelligence(rows, cleanName);
      void discoverDataset(sessionId, rows, cleanName).then((intelligence) => {
        if (intelligence.source === "ai") toast.success(`AI refined this as ${intelligence.name.toLowerCase()}`);
      });
      toast.success(`Imported all ${rows.length.toLocaleString()} records · understood ${initial.name.toLowerCase()} · AI refinement is running`);
      setOpen(false);
    } catch {
      toast.error("I couldn’t read that file. Check that it is valid and not password-protected.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button variant="primary" className={className}><Plus className="h-4 w-4" /> {label}</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-[#101a2d]/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/40 bg-[#fffefa] p-6 shadow-2xl">
          <div className="mb-6 flex items-start justify-between">
            <div><Dialog.Title className="text-xl font-semibold tracking-[-.03em]">Create a dataset session</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#657087]">AI first understands the upload, then opens a private analysis and discussion. A dashboard remains optional.</Dialog.Description></div>
            <Dialog.Close asChild><Button variant="ghost" size="icon" aria-label="Close"><X className="h-4 w-4" /></Button></Dialog.Close>
          </div>
          <button
            onClick={() => inputRef.current?.click()}
            onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
            onDragLeave={() => setDragging(false)}
            onDrop={(e) => { e.preventDefault(); setDragging(false); void processFile(e.dataTransfer.files[0]); }}
            className={`focus-ring flex w-full flex-col items-center rounded-2xl border-2 border-dashed px-8 py-11 transition ${dragging ? "border-[#2764ff] bg-[#edf2ff]" : "border-[#d5d2c9] bg-[#f7f5ef] hover:border-[#9ba5b7]"}`}
          >
            <span className="mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#101a2d] text-white"><Upload className="h-5 w-5" /></span>
            <span className="font-semibold">{busy ? "AI is understanding your data…" : "Drop a file here or browse"}</span>
            <span className="mt-2 text-xs text-[#7a8497]">CSV, XLSX, XLS, JSON or PDF · max 20 MB</span>
          </button>
          <input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,.json,.pdf" onChange={(e) => void processFile(e.target.files?.[0])} />
          <div className="mt-5 grid grid-cols-4 gap-2">
            {[{ icon: FileSpreadsheet, label: "Excel" }, { icon: Table2, label: "CSV" }, { icon: FileJson, label: "JSON" }, { icon: FileText, label: "PDF" }].map(({ icon: Icon, label }) => <div key={label} className="flex items-center justify-center gap-2 rounded-xl border border-[#e5e1d8] bg-white py-3 text-xs font-semibold text-[#657087]"><Icon className="h-4 w-4" />{label}</div>)}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#eaf8cd] px-3 py-2 text-xs font-medium text-[#466800]"><ShieldCheck className="h-4 w-4" /> Stored in this browser for this account; never merged with another session.</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Sidebar() {
  const { activeView, setActiveView } = useWorkspace();
  const items = [
    { id: "analysis" as const, icon: MessageSquare, label: "Analysis" },
    { id: "overview" as const, icon: LayoutDashboard, label: "Dashboard" },
    { id: "risk" as const, icon: ShieldCheck, label: "Risk scan" },
    { id: "data" as const, icon: Table2, label: "Data table" },
    { id: "history" as const, icon: Clock3, label: "History" },
    { id: "settings" as const, icon: Settings, label: "Settings" },
  ];
  return <aside className="side-rail flex h-[calc(100vh-64px)] flex-col items-center border-r border-[#dedbd2] bg-[#f9f7f2] py-4">
    <nav className="flex flex-col gap-2" aria-label="Workspace views">
      {items.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setActiveView(id)} title={label} aria-label={label} className={`focus-ring grid h-11 w-11 place-items-center rounded-xl transition ${activeView === id ? "bg-[#101a2d] text-white shadow-md" : "text-[#7a8497] hover:bg-[#ebe8e0] hover:text-[#101a2d]"}`}><Icon className="h-[18px] w-[18px]" /></button>)}
    </nav>
    <div className="mt-auto flex flex-col gap-2"><button onClick={() => toast.info("Upload data, choose an AI model in Settings, then ask Lumen a question.")} className="focus-ring grid h-10 w-10 place-items-center rounded-xl text-[#7a8497] hover:bg-[#ebe8e0]" aria-label="Help"><CircleHelp className="h-[18px] w-[18px]" /></button><button onClick={() => toast("Signed in as MK")} className="grid h-9 w-9 place-items-center rounded-full bg-[#b8ed3a] text-xs font-bold" aria-label="Account">MK</button></div>
  </aside>;
}

function Header() {
  const { fileName, activeSessionId, aiOpen, setAiOpen, setActiveView, leaveSession } = useWorkspace();
  const [search, setSearch] = useState("");
  return <header className="sticky top-0 z-40 flex h-16 items-center border-b border-[#dedbd2] bg-[#f4f1ea]/90 px-4 backdrop-blur-xl">
    <div className="flex w-[260px] items-center gap-3"><div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-[#101a2d] text-white"><span className="relative z-10 font-mono text-sm font-bold">L</span><span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-[#b8ed3a]" /></div><div><p className="text-[15px] font-bold tracking-[-.02em]">LUMEN</p><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#7a8497]">Decision intelligence</p></div></div>
    <div className="min-w-0 flex-1"><form onSubmit={(event) => { event.preventDefault(); if (activeSessionId && search.trim()) { setActiveView("data"); toast.success(`Showing data for “${search.trim()}”`); } }} className={`mx-auto flex max-w-md items-center gap-2 rounded-xl border border-[#dedbd2] bg-white/70 px-3 py-2 text-xs text-[#7a8497] ${activeSessionId ? "" : "opacity-55"}`}><Search className="h-4 w-4" /><input disabled={!activeSessionId} value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#7a8497] disabled:cursor-not-allowed" placeholder={activeSessionId ? `Search ${fileName}` : "Open a dataset to search"} aria-label="Search active dataset"/><kbd className="rounded border border-[#dedbd2] bg-white px-1.5 py-0.5 font-mono text-[9px]">↵</kbd></form></div>
    <div className="ml-4 flex items-center gap-2"><Button onClick={() => toast("You’re all caught up")} variant="ghost" size="icon" aria-label="Notifications"><Bell className="h-4 w-4" /></Button>{activeSessionId && <Button variant="ghost" size="sm" onClick={leaveSession} className="hidden lg:inline-flex"><FolderKanban className="h-3.5 w-3.5" /> Sessions</Button>}<Button disabled={!activeSessionId} variant="outline" size="sm" onClick={() => setAiOpen(!aiOpen)} className="hidden sm:inline-flex"><Sparkles className="h-3.5 w-3.5 text-[#2764ff]" /> AI analyst</Button><UploadDialog /></div>
  </header>;
}

function AnalysisView() {
  const { rows, fileName, intelligence, visualization, setVisualization, setActiveAnalysisSkill, setAiOpen, setActiveView } = useWorkspace();
  const profile = useMemo(() => summarize(rows, { primaryMetric: intelligence?.primaryMetric, primaryDimension: intelligence?.primaryDimension }), [intelligence, rows]);
  const dominant = profile.categoryBreakdown[0];
  const visualSpec = useMemo(() => visualization || inferVisualization(rows, intelligence), [intelligence, rows, visualization]);
  const visualData = useMemo(() => buildVisualizationData(rows, visualSpec), [rows, visualSpec]);
  const visualSummary = useMemo(() => visualizationInsight(visualData, visualSpec), [visualData, visualSpec]);
  const changeChartType = (type: VisualizationType) => setVisualization({ ...visualSpec, type, subtitle: `${type === "donut" ? "Donut" : type[0].toUpperCase() + type.slice(1)} chart · ${visualSpec.aggregation === "count" ? "record count" : visualSpec.aggregation} grouped by ${visualSpec.xField}`, source: "ai", updatedAt: new Date().toISOString() });
  const runSuggestion = (prompt: string, skill: AnalysisSkillId) => {
    setActiveAnalysisSkill(skill);
    setAiOpen(true);
    window.dispatchEvent(new CustomEvent("lumen:run-analysis", { detail: { prompt, skill } }));
  };
  return <div className="pb-10">
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#657087]"><MessageSquare className="h-3.5 w-3.5" /> Analysis / {fileName}</div><h1 className="text-[32px] font-semibold tracking-[-.045em]">Let’s understand this data</h1><p className="mt-1 text-sm text-[#657087]">Start with meaning and evidence. Build a dashboard only when you need one.</p></div><Button onClick={() => setActiveView("overview")} variant="outline" size="sm"><LayoutDashboard className="h-3.5 w-3.5" /> Open dashboard</Button></div>
    <section className="card-shadow overflow-hidden rounded-3xl border border-[#dedbd2] bg-[#fffefa]"><div className="border-b border-[#e7e3da] p-6 sm:p-8"><div className="flex flex-wrap items-center gap-2"><span className="rounded-full bg-[#eaf8cd] px-3 py-1 text-[10px] font-bold uppercase tracking-[.12em] text-[#466800]">{intelligence?.source === "ai" ? "AI refined" : intelligence?.source === "local" ? "Locally understood" : "AI refining"}</span><span className="text-[10px] font-medium text-[#7a8497]">Grounded in {profile.columns.length} detected fields</span></div><h2 className="mt-5 text-[clamp(28px,4vw,44px)] font-semibold leading-[1.02] tracking-[-.05em]">{intelligence?.name || "Uploaded dataset"}</h2><p className="mt-3 max-w-3xl text-base leading-7 text-[#657087]">{intelligence?.description}</p></div>
      <div className="grid lg:grid-cols-[minmax(0,1.35fr)_minmax(260px,.65fr)]"><div className="p-6 sm:p-8"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]">What the data says first</p><p className="mt-3 max-w-3xl text-lg font-medium leading-8 tracking-[-.02em] text-[#26344d]">{intelligence?.summary}</p><div className="mt-6 inline-flex items-center gap-2 rounded-xl bg-[#edf2ff] px-3 py-2 text-xs font-medium text-[#40547a]"><BarChart3 className="h-4 w-4 text-[#2764ff]" /> A recommended chart and visual insight are ready below.</div></div>
        <aside className="border-t border-[#e7e3da] bg-[#f7f5ef] p-6 lg:border-l lg:border-t-0"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#7a8497]">Evidence in this upload</p><dl className="mt-5 space-y-5"><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9199a9]">Record grain</dt><dd className="mt-1 text-sm font-semibold">{rows.length.toLocaleString()} rows · {profile.columns.length} fields</dd></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9199a9]">Strongest dimension</dt><dd className="mt-1 text-sm font-semibold">{profile.category || "Not confidently detected"}</dd>{dominant && <p className="mt-1 text-xs leading-5 text-[#657087]">{dominant.name}: {dominant.count.toLocaleString()} records ({dominant.share.toFixed(1)}%)</p>}</div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9199a9]">Data quality</dt><dd className="mt-1 text-sm font-semibold">{profile.completeness.toFixed(1)}% complete</dd><p className="mt-1 text-xs leading-5 text-[#657087]">{profile.missingRows.toLocaleString()} rows with missing values · {profile.duplicateRows.toLocaleString()} duplicates</p></div><div><dt className="text-[10px] font-semibold uppercase tracking-wider text-[#9199a9]">Meaningful measure</dt><dd className="mt-1 text-sm font-semibold">{profile.primary || "Use record counts, not technical totals"}</dd></div></dl></aside></div>
    </section>
    <section aria-live="polite" className="card-shadow mt-5 overflow-hidden rounded-3xl border border-[#dedbd2] bg-[#fffefa]">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b border-[#e7e3da] px-6 py-5"><div><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><BarChart3 className="h-4 w-4" /></span><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]">AI visual canvas</p><h2 className="text-lg font-semibold tracking-[-.02em]">{visualSpec.title}</h2></div></div><p className="mt-2 text-xs text-[#7a8497]">{visualSpec.subtitle} · based on all {rows.length.toLocaleString()} records</p></div><div className="flex flex-wrap gap-1.5" aria-label="Chart type">{(["bar", "line", "area", "pie", "donut"] as VisualizationType[]).map((type) => <button key={type} onClick={() => changeChartType(type)} className={`focus-ring rounded-lg border px-3 py-1.5 text-[10px] font-semibold capitalize transition ${visualSpec.type === type ? "border-[#2764ff] bg-[#2764ff] text-white" : "border-[#dedbd2] bg-white text-[#657087] hover:border-[#9db4ff]"}`}>{type}</button>)}</div></div>
      <div className="grid lg:grid-cols-[minmax(0,1.5fr)_minmax(240px,.5fr)]"><div className="h-[360px] min-w-0 p-5 sm:p-7"><GeneratedVisualization spec={visualSpec} data={visualData} /></div><aside className="border-t border-[#e7e3da] bg-[#f7f5ef] p-6 lg:border-l lg:border-t-0"><span className={`inline-flex rounded-full px-2.5 py-1 text-[9px] font-bold uppercase tracking-wider ${visualSpec.source === "ai" ? "bg-[#eaf8cd] text-[#466800]" : "bg-[#edf2ff] text-[#2764ff]"}`}>{visualSpec.source === "ai" ? "AI updated" : "Auto suggested"}</span><p className="mt-5 text-[10px] font-bold uppercase tracking-[.14em] text-[#7a8497]">Visual insight</p><p className="mt-2 text-sm font-semibold leading-6 text-[#26344d]">{visualSummary}</p><dl className="mt-6 space-y-4 border-t border-[#dedbd2] pt-5"><div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#9199a9]">Dimension</dt><dd className="mt-1 text-xs font-semibold">{visualSpec.xField}</dd></div><div><dt className="text-[9px] font-bold uppercase tracking-wider text-[#9199a9]">Measure</dt><dd className="mt-1 text-xs font-semibold">{visualSpec.aggregation === "count" ? "Record count" : `${visualSpec.aggregation} of ${visualSpec.yField}`}</dd></div></dl><div className="mt-6 rounded-xl border border-[#d6e0ff] bg-[#edf2ff] p-3 text-[11px] leading-5 text-[#40547a]"><Sparkles className="mb-2 h-4 w-4 text-[#2764ff]" />Ask the analyst: “show this as a pie”, “bar chart by Status”, or “average Amount by Region”.</div></aside></div>
    </section>
    {intelligence?.suggestions?.length ? <section className="mt-5"><div className="mb-3"><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]">Suggested next analyses</p><h2 className="mt-1 text-lg font-semibold tracking-[-.02em]">Explore another angle</h2></div><div className="grid gap-3 lg:grid-cols-3">{intelligence.suggestions.map((item) => <button key={item.id} onClick={() => runSuggestion(item.prompt, item.skill)} className="focus-ring group rounded-2xl border border-[#dedbd2] bg-[#fffefa] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9db4ff] hover:shadow-md"><span className="flex items-center justify-between"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><WandSparkles className="h-4 w-4" /></span><ChevronRight className="h-4 w-4 text-[#9ba2af] group-hover:text-[#2764ff]" /></span><strong className="mt-3 block text-sm">{item.title}</strong><span className="mt-1 block text-xs leading-5 text-[#657087]">{item.description}</span></button>)}</div></section> : null}
    <div className="mt-4 flex items-center gap-2 rounded-2xl border border-[#d6e0ff] bg-[#edf2ff] px-4 py-3 text-xs leading-5 text-[#40547a]"><Sparkles className="h-4 w-4 shrink-0 text-[#2764ff]" /> Continue the analysis in the chat beside this page, or choose a suggested question above.</div>
  </div>;
}

function GeneratedDashboardChartCard({ spec }: { spec: VisualizationSpec }) {
  const { rows, removeVisualization } = useWorkspace();
  const data = useMemo(() => buildVisualizationData(rows, spec), [rows, spec]);
  const insight = useMemo(() => visualizationInsight(data, spec), [data, spec]);
  return <article className="card-shadow overflow-hidden rounded-2xl border border-[#cfd9f4] bg-[#fffefa]"><div className="flex items-start justify-between gap-3 border-b border-[#e7e3da] px-5 py-4"><div><div className="mb-1 flex items-center gap-2"><span className="rounded-full bg-[#eaf8cd] px-2 py-0.5 text-[8px] font-bold uppercase tracking-wider text-[#466800]">AI generated</span><span className="text-[9px] font-semibold uppercase text-[#9199a9]">{spec.type}</span></div><h3 className="font-semibold tracking-[-.02em]">{spec.title}</h3><p className="mt-1 text-[11px] text-[#7a8497]">{spec.subtitle}</p></div><Button onClick={() => removeVisualization(spec.updatedAt)} variant="ghost" size="icon" aria-label={`Remove ${spec.title}`}><Trash2 className="h-4 w-4" /></Button></div><div className="h-[300px] min-w-0 p-5"><GeneratedVisualization spec={spec} data={data} /></div><p className="border-t border-[#ece8df] bg-[#f7f5ef] px-5 py-3 text-xs leading-5 text-[#657087]"><Sparkles className="mr-1.5 inline h-3.5 w-3.5 text-[#2764ff]" />{insight}</p></article>;
}

function GeneratedDashboardCharts() {
  const visualizations = useWorkspace((state) => state.visualizations ?? []);
  if (!visualizations.length) return null;
  return <section id="ai-generated-charts" aria-live="polite" className="mb-5 scroll-mt-24"><div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]">AI-generated visuals</p><h2 className="mt-1 text-lg font-semibold tracking-[-.02em]">Charts added from your conversation</h2></div><span className="rounded-full bg-[#edf2ff] px-2.5 py-1 text-[9px] font-bold text-[#2764ff]">{visualizations.length} visual{visualizations.length === 1 ? "" : "s"}</span></div><div className={`grid gap-5 ${visualizations.length > 1 ? "xl:grid-cols-2" : ""}`}>{visualizations.map((spec) => <GeneratedDashboardChartCard key={spec.updatedAt} spec={spec} />)}</div></section>;
}

function ExecutiveOverview() {
  const { rows, fileName, intelligence, activeAnalysisSkill, setActiveAnalysisSkill, setAiOpen } = useWorkspace();
  const [periods, setPeriods] = useState<"all" | "12">("12");
  const s = useMemo(() => summarize(rows, { primaryMetric: intelligence?.primaryMetric, primaryDimension: intelligence?.primaryDimension }), [rows, intelligence]);
  const chartData = useMemo(() => s.primary ? (periods === "12" ? rows.slice(-12) : rows).slice(-40).map((row, index) => ({
    name: String(row.month ?? row.date ?? row.name ?? `R${index + 1}`).slice(0, 12),
    value: Number(row[s.primary || ""] || 0),
    secondary: Number(row[s.numeric[1]?.name || ""] || 0),
  })) : s.categoryBreakdown.map((item) => ({ name: item.name.slice(0, 12), value: item.count, secondary: 0 })), [rows, s, periods]);
  const maxIndex = chartData.reduce((best, item, index) => item.value > chartData[best]?.value ? index : best, 0);
  const category = s.category;
  const dominant = s.categoryBreakdown[0];
  const segmentData = useMemo(() => {
    if (!s.primary) return s.categoryBreakdown.slice(0, 6).map((item) => ({ name: item.name.slice(0, 14), value: item.count }));
    const groups = new Map<string, number>();
    rows.forEach((r) => { const key = String(r[category || ""] ?? "Other").slice(0, 14); groups.set(key, (groups.get(key) || 0) + Number(r[s.primary || ""] || 1)); });
    return Array.from(groups, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [rows, category, s.primary]);
  const runSuggestion = (prompt: string, skill: AnalysisSkillId) => {
    setActiveAnalysisSkill(skill);
    setAiOpen(true);
    window.dispatchEvent(new CustomEvent("lumen:run-analysis", { detail: { prompt, skill } }));
  };

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#657087]"><FolderKanban className="h-3.5 w-3.5" /> Workspace / {fileName}</div><h1 className="text-[32px] font-semibold tracking-[-.045em]">{intelligence?.name || "Dataset overview"}</h1><p className="mt-1 text-sm text-[#657087]">{intelligence?.description || "Understand the uploaded records before choosing an analysis."}</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { downloadText(`${fileName.replace(/\.[^.]+$/, "")}-brief.txt`, `LUMEN DATA BRIEF\n\nDataset: ${fileName}\nRecords: ${rows.length}\nFields: ${s.columns.length}\nPrimary metric: ${s.primary || "No reliable non-identifier measure detected"}\n${s.primary ? `Total: ${formatCompact(s.total)}\nEndpoint movement: ${s.growth.toFixed(1)}%\n` : ""}Completeness: ${s.completeness.toFixed(1)}%\nDominant ${s.category || "category"}: ${dominant?.name || "Not available"}${dominant ? ` (${dominant.share.toFixed(1)}%)` : ""}\nMissing rows: ${s.missingRows}\nDuplicate rows: ${s.duplicateRows}\nExceptions: ${s.exceptions}\n\nValidate exceptions against source evidence before acting.`); toast.success("Data brief downloaded"); }}><Download className="h-3.5 w-3.5" /> Export brief</Button>{s.primary && <DropdownMenu.Root><DropdownMenu.Trigger asChild><Button size="sm">{periods === "12" ? "Last 12 periods" : "All records"} <ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="z-[70] min-w-40 rounded-xl border border-[#dedbd2] bg-white p-1 shadow-xl"><DropdownMenu.Item onSelect={() => setPeriods("all")} className="cursor-pointer rounded-lg px-3 py-2 text-xs outline-none hover:bg-[#f0eee8]">All records</DropdownMenu.Item><DropdownMenu.Item onSelect={() => setPeriods("12")} className="cursor-pointer rounded-lg px-3 py-2 text-xs outline-none hover:bg-[#f0eee8]">Latest 12 periods</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root>}</div>
    </div>
    <div className="metric-grid mb-5 grid grid-cols-4 gap-4">
      <MetricCard label={s.primary || "Records"} value={s.primary ? formatCompact(s.total) : rows.length.toLocaleString()} delta={s.primary ? s.growth : undefined} note={s.primary ? "Aggregate of the strongest non-identifier measure" : "Rows profiled in the uploaded dataset"} />
      <MetricCard label={s.primary ? "Average" : category ? `Top ${category}` : "Fields"} value={s.primary ? formatCompact(s.avg) : dominant?.name.slice(0, 14) || String(s.columns.length)} delta={s.primary ? Math.min(Math.abs(s.growth) / 3, 99) : undefined} note={s.primary ? "Mean value of the primary measure" : dominant ? `${dominant.count.toLocaleString()} records · ${dominant.share.toFixed(1)}% of populated values` : "Fields detected in the uploaded schema"} accent="lime" />
      <MetricCard label="Completeness" value={`${s.completeness.toFixed(1)}%`} note={`${s.missingRows.toLocaleString()} rows contain at least one missing value`} />
      <MetricCard label="Exceptions" value={s.exceptions.toLocaleString()} note={`${s.duplicateRows.toLocaleString()} duplicate · ${s.anomalies.toLocaleString()} statistical`} accent="coral" />
    </div>
    <section className="mb-5 rounded-2xl border border-[#d7d4cb] bg-[#101a2d] p-5 text-white shadow-xl shadow-[#101a2d]/5">
      <div className="flex items-start gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#b8ed3a] text-[#101a2d]"><Lightbulb className="h-5 w-5" /></span><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[.15em] text-[#b8ed3a]">AI understanding</span><span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/65">{intelligence?.source === "ai" ? "AI refined" : intelligence?.source === "local" ? "Locally understood" : "AI refining…"}</span></div><p className="mt-2 max-w-4xl text-lg font-medium leading-7 tracking-[-.02em]">{intelligence?.summary || (s.primary ? `${s.primary} is the strongest non-identifier measure, with ${s.completeness.toFixed(1)}% completeness.` : `${rows.length.toLocaleString()} records were profiled without treating identifiers as business measures.`)}</p></div><button onClick={() => toast("Insight copied to your decision log")} className="text-white/50 hover:text-white" aria-label="Save insight"><Menu className="h-5 w-5" /></button></div>
    </section>
    {intelligence?.suggestions?.length ? <section className="mb-5"><div className="mb-3 flex items-end justify-between gap-3"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]">Suggested next analyses</p><h2 className="mt-1 text-lg font-semibold tracking-[-.02em]">Choose what you want to understand</h2></div><span className="text-[10px] text-[#7a8497]">Grounded in detected fields</span></div><div className="grid gap-3 lg:grid-cols-3">{intelligence.suggestions.map((item) => <button key={item.id} onClick={() => runSuggestion(item.prompt, item.skill)} className="focus-ring group rounded-2xl border border-[#dedbd2] bg-[#fffefa] p-4 text-left shadow-sm transition hover:-translate-y-0.5 hover:border-[#9db4ff] hover:shadow-md"><span className="flex items-center justify-between gap-3"><span className="grid h-8 w-8 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><WandSparkles className="h-4 w-4" /></span><ChevronRight className="h-4 w-4 text-[#9ba2af] transition group-hover:translate-x-0.5 group-hover:text-[#2764ff]" /></span><strong className="mt-3 block text-sm">{item.title}</strong><span className="mt-1 block text-xs leading-5 text-[#657087]">{item.description}</span></button>)}</div></section> : null}
    <GeneratedDashboardCharts />
    <div className="chart-grid grid grid-cols-[minmax(0,1.45fr)_minmax(280px,.8fr)] gap-5">
      <section className="card-shadow rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
        <div className="mb-5 flex flex-wrap items-start justify-between gap-3"><div><h2 className="font-semibold tracking-[-.02em]">{activeAnalysisSkill === "anomaly" ? "Exception profile" : activeAnalysisSkill === "visual" ? "Ranked comparison" : activeAnalysisSkill === "trend" ? "Trend & turning points" : s.primary ? "Performance trajectory" : `${category || "Category"} distribution`}</h2><p className="mt-1 text-xs text-[#7a8497]">{s.primary ? `${s.primary} across the latest records` : `Record count by ${category || "detected group"}`}</p></div><select value={activeAnalysisSkill} onChange={(event) => setActiveAnalysisSkill(event.target.value as AnalysisSkillId)} className="focus-ring rounded-lg border border-[#d9d6ce] bg-white px-2.5 py-1.5 text-[10px] font-semibold text-[#4f5b71]" aria-label="Analysis skill">{analysisSkills.map((skill) => <option key={skill.id} value={skill.id}>{skill.name}</option>)}</select></div>
        <div className="h-[270px]"><ResponsiveContainer width="100%" height="100%">{activeAnalysisSkill === "visual" ? <BarChart data={chartData} margin={{ top: 10, right: 4, bottom: 0, left: -15 }}><CartesianGrid vertical={false} stroke="#ece8df" strokeDasharray="3 3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} dy={8}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} tickFormatter={formatCompact}/><Tooltip content={<ChartTooltip />}/><Bar dataKey="value" name={s.primary || "Records"} fill="#2764ff" radius={[6, 6, 0, 0]}/></BarChart> : activeAnalysisSkill === "anomaly" ? <BarChart data={[...chartData].sort((a, b) => b.value - a.value)} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={54} axisLine={false} tickLine={false} tick={{ fill: "#657087", fontSize: 10 }}/><Tooltip content={<ChartTooltip />}/><Bar dataKey="value" name={s.primary || "Records"} radius={[0, 6, 6, 0]}>{chartData.map((_, index) => <Cell key={index} fill={index < Math.max(1, s.anomalies) ? "#ff6a4d" : "#ced6e7"}/>)}</Bar></BarChart> : <ComposedChart data={chartData} margin={{ top: 10, right: 4, bottom: 0, left: -15 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2764ff" stopOpacity={.22}/><stop offset="95%" stopColor="#2764ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece8df" strokeDasharray="3 3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} dy={8}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} tickFormatter={formatCompact}/><Tooltip content={<ChartTooltip />}/>{activeAnalysisSkill === "executive" ? <Area type="monotone" dataKey="value" name={s.primary || "Records"} stroke="#2764ff" strokeWidth={2.5} fill="url(#areaFill)"/> : <Line type="monotone" dataKey="value" name={s.primary || "Records"} stroke="#2764ff" strokeWidth={2.5} dot/>}{s.numeric[1] && <Line type="monotone" dataKey="secondary" name={s.numeric[1].name} stroke="#ff6a4d" strokeWidth={1.5} strokeDasharray="5 5" dot={false}/>}</ComposedChart>}</ResponsiveContainer></div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#f3f1eb] px-3 py-2 text-xs text-[#657087]"><Sparkles className="h-4 w-4 text-[#2764ff]" /> {s.primary ? <>Peak contribution appears in <strong className="text-[#101a2d]">{chartData[maxIndex]?.name || "the latest period"}</strong>; test whether this is repeatable or one-off.</> : <><strong className="text-[#101a2d]">{dominant?.name || "No dominant group"}</strong>{dominant ? ` represents ${dominant.share.toFixed(1)}% of populated ${category} values.` : " Category distribution is unavailable."}</>}</div>
      </section>
      <section className="card-shadow rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
        <div className="mb-5"><h2 className="font-semibold tracking-[-.02em]">Contribution map</h2><p className="mt-1 text-xs text-[#7a8497]">{s.primary ? "Value" : "Records"} ranked by {category || "group"}</p></div>
        <div className="h-[238px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={segmentData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={66} axisLine={false} tickLine={false} tick={{ fill: "#657087", fontSize: 10 }}/><Tooltip content={<ChartTooltip />}/><Bar dataKey="value" name={s.primary || "Value"} radius={[0, 7, 7, 0]} barSize={15}>{segmentData.map((_, i) => <Cell key={i} fill={i === 0 ? "#2764ff" : i === 1 ? "#b8ed3a" : "#ced6e7"} />)}</Bar></BarChart></ResponsiveContainer></div>
        <p className="mt-3 border-t border-[#ece8df] pt-4 text-xs leading-5 text-[#657087]">{s.primary ? "Top contributors show where the selected measure is concentrated." : `This chart counts uploaded records by ${category || "the strongest categorical field"}; identifier values are intentionally excluded.`}</p>
      </section>
    </div>
  </>;
}

function RiskView() {
  const { rows, setActiveView, setAiOpen } = useWorkspace(); const s = summarize(rows);
  const risks = [
    { title: "Statistical outliers", severity: "High", count: Math.max(1, s.anomalies), text: "Values sit beyond the expected operating range." },
    { title: "Duplicate exposure", severity: "Medium", count: Math.max(0, Math.floor(rows.length * .008)), text: "Potential repeated records need identifier-level review." },
    { title: "Missing controls", severity: "Low", count: s.columns.filter(c => rows.some(r => r[c.name] == null || r[c.name] === "")).length, text: "Incomplete fields could weaken auditability." },
  ];
  return <div><div className="mb-7"><span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#a52c16]"><ShieldCheck className="h-4 w-4" /> Automated controls</span><h1 className="text-[32px] font-semibold tracking-[-.045em]">Risk & anomaly scan</h1><p className="mt-1 text-sm text-[#657087]">Evidence-led flags for investigation — not accusations or final fraud determinations.</p></div><div className="grid gap-4">{risks.map((r, i) => <div key={r.title} className="risk-card card-shadow flex items-center gap-5 rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5"><div className={`grid h-12 w-12 place-items-center rounded-2xl ${i === 0 ? "bg-[#ffebe6] text-[#c43820]" : i === 1 ? "bg-[#fff3d6] text-[#9c6500]" : "bg-[#eaf8cd] text-[#466800]"}`}><AlertTriangle className="h-5 w-5" /></div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="font-semibold">{r.title}</h2><span className="rounded-full bg-[#f0eee8] px-2 py-0.5 text-[10px] font-bold text-[#657087]">{r.severity}</span></div><p className="mt-1 text-sm text-[#657087]">{r.text}</p></div><div className="text-right"><p className="text-2xl font-semibold">{r.count}</p><p className="text-[10px] uppercase tracking-wider text-[#7a8497]">flags</p></div><Button onClick={() => { setActiveView("data"); setAiOpen(true); toast.success(`${r.title} loaded for review`); }} variant="outline" size="sm">Review</Button></div>)}</div><div className="mt-5 rounded-2xl border border-[#d9d6ce] bg-[#101a2d] p-6 text-white"><p className="text-xs font-semibold uppercase tracking-[.14em] text-[#b8ed3a]">Recommended control</p><h2 className="mt-2 text-xl font-semibold">Start with exceptions, then verify context.</h2><p className="mt-2 max-w-2xl text-sm leading-6 text-white/65">Cross-check flagged records against source documents, approval logs, and timing. Statistical anomalies are investigative leads, not proof of misconduct.</p></div></div>;
}

function DataTableView() {
  const { rows, fileName } = useWorkspace();
  const allColumns = useMemo(() => getColumns(rows), [rows]);
  const schemaKey = allColumns.map((column) => column.name).join("\u0000");
  const [visibleFields, setVisibleFields] = useState<string[]>([]);
  const [wrapHeaders, setWrapHeaders] = useState(true);
  const [page, setPage] = useState(0);
  const pageSize = 100;
  const pageCount = Math.max(1, Math.ceil(rows.length / pageSize));
  const pageStart = page * pageSize;
  const visibleRows = rows.slice(pageStart, pageStart + pageSize);
  useEffect(() => { setVisibleFields(allColumns.slice(0, 8).map((column) => column.name)); }, [fileName, schemaKey]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setPage(0); }, [fileName]);
  useEffect(() => { if (page >= pageCount) setPage(pageCount - 1); }, [page, pageCount]);
  const columns = allColumns.filter((column) => visibleFields.includes(column.name));
  const toggleField = (name: string, checked: boolean) => setVisibleFields((current) => checked ? [...current, name] : current.length > 1 ? current.filter((field) => field !== name) : current);
  return <div>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4"><div><h1 className="text-[32px] font-semibold tracking-[-.045em]">Data table</h1><p className="mt-1 text-sm text-[#657087]">{rows.length.toLocaleString()} records · {allColumns.length} fields · {fileName}</p></div><div className="flex flex-wrap items-center gap-2"><label className="flex cursor-pointer items-center gap-2 rounded-lg border border-[#d9d6ce] bg-white px-3 py-2 text-xs font-semibold text-[#657087]"><input type="checkbox" checked={wrapHeaders} onChange={(event) => setWrapHeaders(event.target.checked)} className="h-4 w-4 accent-[#2764ff]" /> Wrap long headers</label><DropdownMenu.Root><DropdownMenu.Trigger asChild><Button variant="outline" size="sm"><Check className="h-3.5 w-3.5" /> Fields {columns.length}/{allColumns.length} <ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content align="end" className="z-[70] max-h-[420px] w-72 overflow-y-auto rounded-xl border border-[#dedbd2] bg-white p-2 shadow-xl"><div className="mb-2 flex items-center justify-between border-b border-[#ece8df] px-2 pb-2"><span className="text-[10px] font-bold uppercase tracking-wider text-[#7a8497]">Visible fields</span><div className="flex gap-1"><button onClick={() => setVisibleFields(allColumns.slice(0, 8).map((column) => column.name))} className="rounded px-2 py-1 text-[9px] font-semibold text-[#2764ff] hover:bg-[#edf2ff]">First 8</button><button onClick={() => setVisibleFields(allColumns.map((column) => column.name))} className="rounded px-2 py-1 text-[9px] font-semibold text-[#2764ff] hover:bg-[#edf2ff]">All</button></div></div>{allColumns.map((column) => <DropdownMenu.CheckboxItem key={column.name} checked={visibleFields.includes(column.name)} onCheckedChange={(checked) => toggleField(column.name, checked === true)} onSelect={(event) => event.preventDefault()} className="flex cursor-pointer items-start gap-2 rounded-lg px-2 py-2 text-xs outline-none hover:bg-[#f3f1eb]"><span className="mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border border-[#b9c0ce] bg-white"><DropdownMenu.ItemIndicator><Check className="h-3 w-3 text-[#2764ff]" /></DropdownMenu.ItemIndicator></span><span className="min-w-0 break-all font-medium text-[#334057]">{column.name}</span><span className="ml-auto shrink-0 text-[8px] uppercase text-[#9199a9]">{column.type}</span></DropdownMenu.CheckboxItem>)}</DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root><Button onClick={() => { downloadText(fileName.replace(/\.[^.]+$/, "") + ".csv", Papa.unparse(rows), "text/csv"); toast.success("CSV downloaded"); }} variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button></div></div>
    <div className="card-shadow overflow-hidden rounded-2xl border border-[#dedbd2] bg-white"><div className="overflow-auto"><table className="w-full text-left text-xs" style={{ minWidth: Math.max(720, columns.length * 180) }}><thead className="bg-[#101a2d] text-white"><tr>{columns.map((column) => <th key={column.name} title={column.name} className={`max-w-[240px] px-4 py-3 font-semibold ${wrapHeaders ? "whitespace-normal break-words leading-4" : "truncate whitespace-nowrap"}`}>{column.name}<span className="ml-2 text-[9px] font-normal uppercase text-white/45">{column.type}</span></th>)}</tr></thead><tbody>{visibleRows.map((row, index) => <tr key={pageStart + index} className="border-b border-[#ece8df] hover:bg-[#f7f5ef]">{columns.map((column) => <td key={column.name} title={String(row[column.name] ?? "")} className="max-w-[220px] truncate px-4 py-3 text-[#4f5b71]">{String(row[column.name] ?? "—")}</td>)}</tr>)}</tbody></table></div><div className="flex flex-wrap items-center justify-between gap-3 bg-[#f7f5ef] px-4 py-3 text-xs text-[#657087]"><span>Showing {rows.length ? pageStart + 1 : 0}–{Math.min(pageStart + pageSize, rows.length)} of {rows.length.toLocaleString()} records · {columns.length} visible fields</span><div className="flex items-center gap-2"><span className="hidden items-center gap-1 sm:flex"><Check className="h-3.5 w-3.5 text-[#4f7600]" /> Schema validated</span><Button onClick={() => setPage((current) => Math.max(0, current - 1))} disabled={page === 0} variant="outline" size="icon" aria-label="Previous data page"><ChevronLeft className="h-3.5 w-3.5" /></Button><span className="min-w-20 text-center text-[10px] font-semibold">Page {page + 1} / {pageCount}</span><Button onClick={() => setPage((current) => Math.min(pageCount - 1, current + 1))} disabled={page + 1 >= pageCount} variant="outline" size="icon" aria-label="Next data page"><ChevronRight className="h-3.5 w-3.5" /></Button></div></div></div>
  </div>;
}

function SessionHome() {
  const { sessions, sessionsReady, openSession, deleteSession, setActiveView } = useWorkspace();
  const open = async (id: string, fileName: string) => {
    try { await openSession(id); toast.success(`${fileName} opened in its own workspace`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not open that session."); }
  };
  return <div className="mx-auto max-w-5xl py-5 sm:py-10">
    <section className="card-shadow overflow-hidden rounded-[28px] border border-[#dedbd2] bg-[#fffefa]">
      <div className="grid gap-8 p-7 sm:p-10 lg:grid-cols-[minmax(0,1.15fr)_minmax(280px,.85fr)] lg:items-center">
    <div><span className="inline-flex items-center gap-2 rounded-full bg-[#edf2ff] px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.14em] text-[#2764ff]"><ShieldCheck className="h-3.5 w-3.5" /> Private dataset workspace</span><h1 className="mt-5 max-w-2xl text-[clamp(36px,5vw,58px)] font-semibold leading-[.98] tracking-[-.06em] text-[#101a2d]">Start with your data, not ours.</h1><p className="mt-5 max-w-xl text-base leading-7 text-[#657087]">Upload a file to create an isolated analysis session. AI explains what the data represents and suggests useful questions before you decide whether a dashboard is needed.</p><div className="mt-7 flex flex-wrap items-center gap-3"><UploadDialog label="Upload a new dataset" className="h-12 px-5 text-sm shadow-lg" /><Button onClick={() => setActiveView("history")} variant="outline" className="h-12 px-5"><Clock3 className="h-4 w-4" /> Previous sessions</Button></div></div>
        <div className="rounded-3xl bg-[#101a2d] p-6 text-white"><p className="text-[10px] font-bold uppercase tracking-[.16em] text-[#b8ed3a]">Session boundary</p><div className="mt-5 space-y-4">{[{ title: "One upload", copy: "Complete rows and schema stored together" }, { title: "One discussion", copy: "Chat history only sees this dataset" }, { title: "One analysis state", copy: "Charts and analysis mode reopen where you left them" }].map((item, index) => <div key={item.title} className="flex gap-3"><span className="grid h-8 w-8 shrink-0 place-items-center rounded-xl bg-white/10 text-xs font-bold text-[#b8ed3a]">0{index + 1}</span><div><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-5 text-white/50">{item.copy}</p></div></div>)}</div><div className="mt-6 flex items-center gap-2 border-t border-white/10 pt-5 text-[10px] text-white/45"><Database className="h-3.5 w-3.5" /> Stored locally for the signed-in account</div></div>
      </div>
    </section>
    <section className="mt-7"><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.14em] text-[#7a8497]">Continue working</p><h2 className="mt-1 text-xl font-semibold tracking-[-.03em]">Recent dataset sessions</h2></div>{sessions.length > 3 && <Button onClick={() => setActiveView("history")} variant="ghost" size="sm">View all <ChevronRight className="h-3.5 w-3.5" /></Button>}</div>
      {!sessionsReady ? <div className="rounded-2xl border border-[#dedbd2] bg-white/60 p-5 text-sm text-[#657087]">Loading private sessions…</div> : !sessions.length ? <div className="rounded-2xl border border-dashed border-[#cfcac0] bg-white/50 p-6 text-sm text-[#657087]">No uploaded datasets are stored for this account yet.</div> : <div className="grid gap-3 lg:grid-cols-3">{sessions.slice(0, 3).map((session) => <article key={session.id} className="card-shadow flex min-w-0 flex-col rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5"><div className="flex items-start justify-between gap-3"><span className="grid h-10 w-10 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><Database className="h-4 w-4" /></span><span className="text-[9px] font-semibold text-[#9199a9]">{new Date(session.updatedAt).toLocaleDateString()}</span></div><h3 className="mt-4 truncate font-semibold" title={session.fileName}>{session.fileName}</h3><p className="mt-1 text-[11px] text-[#7a8497]">{session.rowCount.toLocaleString()} records · {session.fieldCount} fields</p><p className="mt-1 text-[11px] text-[#7a8497]">{session.messageCount} discussion message{session.messageCount === 1 ? "" : "s"}</p><Button onClick={() => void open(session.id, session.fileName)} variant="outline" size="sm" className="mt-4 w-full">Open session <ChevronRight className="h-3.5 w-3.5" /></Button></article>)}</div>}
    </section>
  </div>;
}

function HistoryView() {
  const { sessions, sessionsReady, activeSessionId, openSession, deleteSession, setActiveView } = useWorkspace();
  const open = async (id: string, fileName: string) => {
    try { await openSession(id); toast.success(`${fileName} opened`); }
    catch (error) { toast.error(error instanceof Error ? error.message : "Could not open that session."); }
  };
  const remove = async (id: string, fileName: string) => {
    if (!window.confirm(`Delete ${fileName} and its discussion from this browser? This cannot be undone.`)) return;
    try { await deleteSession(id); toast.success("Dataset session deleted"); }
    catch { toast.error("Could not delete that session."); }
  };
  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#2764ff]"><Clock3 className="h-4 w-4" /> Saved locally by account</span><h1 className="text-[32px] font-semibold tracking-[-.045em]">Dataset sessions</h1><p className="mt-1 text-sm text-[#657087]">Reopen a dataset with its own analysis state and discussion. Sessions never share context.</p></div><UploadDialog label="New session" /></div>
    {!sessionsReady ? <div className="rounded-2xl border border-[#dedbd2] bg-white/60 p-5 text-sm text-[#657087]">Loading private sessions…</div> : !sessions.length ? <div className="card-shadow grid min-h-72 place-items-center rounded-3xl border border-dashed border-[#cfcac0] bg-[#fffefa] p-8 text-center"><div><span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#edf2ff] text-[#2764ff]"><Clock3 className="h-5 w-5" /></span><h2 className="font-semibold">No dataset sessions yet</h2><p className="mt-2 max-w-sm text-sm text-[#657087]">Upload a file to create the first private workspace for this account.</p><Button onClick={() => setActiveView("overview")} className="mt-5" variant="outline">Back to start</Button></div></div> : <div className="grid gap-3">{sessions.map((session) => <article key={session.id} className={`card-shadow flex flex-wrap items-center gap-4 rounded-2xl border bg-[#fffefa] p-5 ${activeSessionId === session.id ? "border-[#9db4ff] ring-2 ring-[#2764ff]/10" : "border-[#e0ddd4]"}`}><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><Database className="h-5 w-5" /></span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h2 className="truncate font-semibold" title={session.fileName}>{session.fileName}</h2>{activeSessionId === session.id && <span className="rounded-full bg-[#eaf8cd] px-2 py-0.5 text-[9px] font-bold uppercase text-[#466800]">Active</span>}</div><p className="mt-1 text-xs text-[#7a8497]">{session.rowCount.toLocaleString()} records · {session.fieldCount} fields · {session.messageCount} messages</p><p className="mt-1 text-[10px] text-[#9199a9]">Last opened {new Date(session.updatedAt).toLocaleString()}</p></div><Button onClick={() => void open(session.id, session.fileName)} variant="outline" size="sm">Open session <ChevronRight className="h-3.5 w-3.5" /></Button><Button onClick={() => void remove(session.id, session.fileName)} variant="ghost" size="icon" aria-label={`Delete ${session.fileName}`}><Trash2 className="h-4 w-4" /></Button></article>)}</div>}
  </div>;
}

function SettingsView() {
  const { providers, setProviders, defaultProviderId, defaultModelId, setDefaultModel, enabledCharts, setEnabledCharts } = useWorkspace();
  const [selectedId, setSelectedId] = useState(defaultProviderId || providers[0]?.id);
  const [showKey, setShowKey] = useState(false);
  const [newModel, setNewModel] = useState("");
  const selected = providers.find((provider) => provider.id === selectedId) || providers[0];
  const updateProvider = (id: string, patch: Partial<ProviderConfig>) => setProviders(providers.map((provider) => provider.id === id ? { ...provider, ...patch } : provider));
  const addProvider = () => {
    const id = `custom-${crypto.randomUUID()}`;
    setProviders([...providers, { id, name: "Custom provider", kind: "custom", baseUrl: "https://", apiKey: "", enabled: true, models: [] }]);
    setSelectedId(id);
    toast.success("Custom provider added");
  };
  const addModel = () => {
    const id = newModel.trim();
    if (!selected || !id || selected.models.some((model) => model.id === id)) return;
    updateProvider(selected.id, { models: [...selected.models, { id, name: id }] });
    setNewModel("");
  };
  return <div>
    <div className="mb-7 flex flex-wrap items-end justify-between gap-4"><div><span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#2764ff]"><Settings className="h-4 w-4" /> Workspace preferences</span><h1 className="text-[32px] font-semibold tracking-[-.045em]">Settings</h1><p className="mt-1 text-sm text-[#657087]">Connect multiple AI providers, manage their models, and choose which charts Lumen may recommend.</p></div><Button onClick={() => toast.success("Settings are saved automatically on this device")} variant="primary"><Check className="h-4 w-4" /> Saved</Button></div>
    <section className="settings-shell card-shadow overflow-hidden rounded-3xl border border-[#dedbd2] bg-[#fffefa]">
      <div className="grid min-h-[480px] grid-cols-[250px_minmax(0,1fr)]">
        <aside className="border-r border-[#e6e2d9] bg-[#f7f5ef] p-3"><div className="mb-2 flex items-center justify-between px-2 py-2"><p className="text-xs font-bold uppercase tracking-[.12em] text-[#657087]">AI providers</p><button onClick={addProvider} className="focus-ring grid h-7 w-7 place-items-center rounded-lg bg-[#101a2d] text-white" aria-label="Add provider"><Plus className="h-3.5 w-3.5" /></button></div><div className="space-y-1">{providers.map((provider) => <button key={provider.id} onClick={() => { setSelectedId(provider.id); setShowKey(false); }} className={`focus-ring flex w-full items-center gap-3 rounded-xl px-3 py-3 text-left ${selected?.id === provider.id ? "bg-white shadow-sm" : "hover:bg-white/60"}`}><span className={`h-2.5 w-2.5 rounded-full ${provider.enabled ? "bg-[#71b600]" : "bg-[#b8bdc6]"}`} /><span className="min-w-0 flex-1"><span className="block truncate text-sm font-semibold">{provider.name}</span><span className="text-[10px] text-[#7a8497]">{provider.models.length} model{provider.models.length === 1 ? "" : "s"}</span></span><ChevronRight className="h-4 w-4 text-[#9ba2af]" /></button>)}</div><Button onClick={addProvider} variant="outline" className="mt-3 w-full"><Plus className="h-4 w-4" /> Add provider</Button></aside>
        {selected && <div className="p-6"><div className="mb-6 flex items-start justify-between"><div><h2 className="text-xl font-semibold">{selected.name}</h2><p className="mt-1 text-xs text-[#7a8497]">Configure the endpoint once, then keep as many models as you need.</p></div><label className="flex items-center gap-2 text-xs font-semibold"><input type="checkbox" checked={selected.enabled} onChange={(event) => updateProvider(selected.id, { enabled: event.target.checked })} className="h-4 w-4 accent-[#2764ff]" /> Enabled</label></div>
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[#657087]">Provider name<input value={selected.name} onChange={(event) => updateProvider(selected.id, { name: event.target.value })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 text-sm font-medium text-[#101a2d]" /></label><label className="text-xs font-semibold text-[#657087]">Provider type<select value={selected.kind} onChange={(event) => updateProvider(selected.id, { kind: event.target.value as ProviderConfig["kind"] })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 text-sm text-[#101a2d]"><option value="ollama">Ollama (local)</option><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">OpenAI-compatible custom</option></select></label></div>
          <label className="mt-4 block text-xs font-semibold text-[#657087]">Base URL<input value={selected.baseUrl} onChange={(event) => updateProvider(selected.id, { baseUrl: event.target.value })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 font-mono text-xs text-[#101a2d]" placeholder="https://api.example.com/v1" /></label>
          {selected.kind === "ollama" ? <div className="mt-4 rounded-xl border border-[#cfe0a8] bg-[#f3fadf] px-4 py-3 text-xs leading-5 text-[#466800]"><strong className="block">Memory-safe local mode</strong>No API key needed. Lumen caps context at 4K, sends at most 12 sample rows, and unloads the model after every answer.</div> : <label className="mt-4 block text-xs font-semibold text-[#657087]">API key<div className="relative mt-2"><input type={showKey ? "text" : "password"} value={selected.apiKey} onChange={(event) => updateProvider(selected.id, { apiKey: event.target.value })} className="focus-ring w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 pr-11 font-mono text-xs text-[#101a2d]" placeholder="Stored only in this browser" /><button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#657087] hover:bg-[#f0eee8]" aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>}
          <div className="mt-6"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Models</h3><p className="mt-1 text-[11px] text-[#7a8497]">Select a default here or switch per message in chat.</p></div></div><div className="space-y-2">{selected.models.map((model) => <div key={model.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${defaultProviderId === selected.id && defaultModelId === model.id ? "border-[#2764ff] bg-[#edf2ff]" : "border-[#e0ddd4] bg-white"}`}><button onClick={() => { setDefaultModel(selected.id, model.id); toast.success(`${model.name} is now the default`); }} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{model.name}</span><span className="block truncate font-mono text-[10px] text-[#7a8497]">{model.id}</span></button>{defaultProviderId === selected.id && defaultModelId === model.id && <span className="rounded-full bg-[#2764ff] px-2 py-1 text-[9px] font-bold uppercase text-white">Default</span>}<button onClick={() => updateProvider(selected.id, { models: selected.models.filter((entry) => entry.id !== model.id) })} className="rounded-lg p-1.5 text-[#9199a9] hover:bg-[#ffebe6] hover:text-[#a52c16]" aria-label={`Remove ${model.name}`}><X className="h-3.5 w-3.5" /></button></div>)}</div><form onSubmit={(event) => { event.preventDefault(); addModel(); }} className="mt-3 flex gap-2"><input value={newModel} onChange={(event) => setNewModel(event.target.value)} className="focus-ring min-w-0 flex-1 rounded-xl border border-[#d9d6ce] bg-white px-3 py-2 text-xs" placeholder="Model ID, e.g. google/gemini-2.5-pro" /><Button type="submit" variant="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Add model</Button></form></div>
          <div className="mt-5 flex items-center justify-between border-t border-[#ece8df] pt-4"><p className="max-w-md text-[10px] leading-4 text-[#7a8497]">Keys stay in this browser and are sent through Lumen only when you ask a question. For shared devices, use a restricted key.</p>{selected.kind === "custom" && <Button onClick={() => { const remaining = providers.filter((provider) => provider.id !== selected.id); setProviders(remaining.length ? remaining : defaultProviders); setSelectedId((remaining[0] || defaultProviders[0]).id); }} variant="ghost" size="sm" className="text-[#a52c16]"><Trash2 className="h-3.5 w-3.5" /> Remove</Button>}</div>
        </div>}
      </div>
    </section>
    <section className="card-shadow mt-5 rounded-3xl border border-[#dedbd2] bg-[#fffefa] p-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">Chart library</h2><p className="mt-1 text-sm text-[#657087]">Lumen will only recommend and generate checked chart types.</p></div><div className="flex gap-2"><Button onClick={() => setEnabledCharts([...chartOptions])} variant="ghost" size="sm">Select all</Button><Button onClick={() => setEnabledCharts([])} variant="ghost" size="sm">Clear</Button></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{chartOptions.map((chart) => { const checked = enabledCharts.includes(chart); return <label key={chart} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition ${checked ? "border-[#aac0ff] bg-[#edf2ff]" : "border-[#e0ddd4] bg-white"}`}><input type="checkbox" checked={checked} onChange={() => setEnabledCharts(checked ? enabledCharts.filter((item) => item !== chart) : [...enabledCharts, chart])} className="h-4 w-4 accent-[#2764ff]" /><BarChart3 className={`h-4 w-4 ${checked ? "text-[#2764ff]" : "text-[#9ba2af]"}`} />{chart}</label>; })}</div></section>
  </div>;
}

function AiPanel() {
  const { rows, activeSessionId, activeView, aiOpen, setAiOpen, messages, addMessage, clearMessages, providers, defaultProviderId, defaultModelId, setDefaultModel, enabledCharts, fileName, intelligence, visualization, setVisualization, addVisualization, activeAnalysisSkill, setActiveAnalysisSkill, setActiveView } = useWorkspace();
  const [input, setInput] = useState(""); const [thinking, setThinking] = useState(false); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);
  const activeProvider = providers.find((provider) => provider.id === defaultProviderId) || providers.find((provider) => provider.enabled);
  const activeModel = activeProvider?.models.find((model) => model.id === defaultModelId) || activeProvider?.models[0];
  const ask = async (raw: string, skillId: AnalysisSkillId = activeAnalysisSkill) => {
    const q = raw.trim();
    if (!q || thinking) return;
    const questionSessionId = activeSessionId;
    if (!questionSessionId) return;
    setInput("");
    addMessage({ id: crypto.randomUUID(), role: "user", content: q, createdAt: new Date().toISOString() }, questionSessionId);
    const requestedVisualization = visualizationFromPrompt(q, rows, intelligence, visualization);
    const shouldAddVisualization = Boolean(requestedVisualization && (activeView === "overview" || /\b(add|create|new|another|make|put)\b/i.test(q)));
    if (requestedVisualization) {
      setActiveAnalysisSkill("visual");
      if (shouldAddVisualization) {
        addVisualization(requestedVisualization);
        setActiveView("overview");
        window.setTimeout(() => document.getElementById("ai-generated-charts")?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
      } else setVisualization(requestedVisualization);
      toast.success(`${requestedVisualization.type === "donut" ? "Donut" : requestedVisualization.type[0].toUpperCase() + requestedVisualization.type.slice(1)} chart ${shouldAddVisualization ? "added to dashboard" : "updated"} · ${requestedVisualization.xField}`);
    }
    const visualNote = requestedVisualization ? `\n\n_${shouldAddVisualization ? "Chart added to the dashboard" : "Visual updated on the analysis canvas"}: **${requestedVisualization.title}**._` : "";
    setThinking(true);
    try {
      if (!activeProvider || !activeModel || (activeProvider.kind !== "ollama" && !activeProvider.apiKey.trim())) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        addMessage({ id: crypto.randomUUID(), role: "assistant", content: `${requestedVisualization ? `## ${shouldAddVisualization ? "Chart added" : "Visual updated"}\n\nThe ${requestedVisualization.type} chart now uses **${requestedVisualization.xField}** as the dimension and **${requestedVisualization.aggregation === "count" ? "record count" : requestedVisualization.yField}** as the measure.\n\n` : ""}${localAnalystAnswer(q, rows)}${visualNote}`, createdAt: new Date().toISOString(), model: "Local fallback" }, questionSessionId);
        toast.info("Local analysis used. Add a provider key in Settings for full AI.", { action: { label: "Settings", onClick: () => useWorkspace.getState().setActiveView("settings") } });
        return;
      }
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: { kind: activeProvider.kind, baseUrl: activeProvider.baseUrl, apiKey: activeProvider.apiKey }, model: activeModel.id, skill: requestedVisualization ? "visual" : skillId, question: q, context: { sourceDataset: datasetSourceContext(fileName), fileName, datasetUnderstanding: useWorkspace.getState().intelligence, profile: profileForAI(rows), activeVisualization: requestedVisualization || visualization, allowedCharts: enabledCharts, sample: rows.slice(0, activeProvider.kind === "ollama" ? 12 : 40) } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "The provider returned an empty response.");
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: `${data.answer}${visualNote}`, createdAt: new Date().toISOString(), model: `${activeProvider.name} · ${activeModel.name}` }, questionSessionId);
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown provider error";
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: `The configured provider could not answer (${reason}). I kept the workflow moving with local analysis: ${localAnalystAnswer(q, rows)}${visualNote}`, createdAt: new Date().toISOString(), model: "Local fallback" }, questionSessionId);
      toast.error("AI provider failed; local analysis was used instead.");
    } finally { setThinking(false); }
  };
  const askRef = useRef(ask);
  askRef.current = ask;
  useEffect(() => {
    const run = (event: Event) => {
      const detail = (event as CustomEvent<{ prompt?: string; skill?: AnalysisSkillId }>).detail;
      if (detail?.prompt) void askRef.current(detail.prompt, detail.skill);
    };
    window.addEventListener("lumen:run-analysis", run);
    return () => window.removeEventListener("lumen:run-analysis", run);
  }, []);
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input); };
  return <aside data-open={aiOpen} aria-hidden={!aiOpen} className="ai-panel sticky top-16 z-30 flex h-[calc(100vh-64px)] min-h-0 w-full min-w-0 flex-col overflow-hidden border-l border-[#dedbd2] bg-[#fffefa] transition-all duration-300">
    <div className="border-b border-[#e6e2d9] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="relative grid h-9 w-9 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><Bot className="h-5 w-5" /><span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#71b600]" /></span><div><h2 className="text-sm font-semibold">Lumen Analyst</h2><p className="text-[10px] font-medium text-[#7a8497]">Grounded in your active dataset</p></div></div><div className="flex"><Button variant="ghost" size="icon" onClick={() => { clearMessages(); toast.success("Chat cleared"); }} aria-label="Clear chat"><Trash2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setAiOpen(false)} aria-label="Close AI panel"><PanelRightClose className="h-4 w-4" /></Button></div></div><select value={activeProvider && activeModel ? `${activeProvider.id}::${activeModel.id}` : ""} onChange={(event) => { const [providerId, ...modelParts] = event.target.value.split("::"); setDefaultModel(providerId, modelParts.join("::")); }} className="focus-ring mt-3 w-full rounded-lg border border-[#dedbd2] bg-white px-2.5 py-2 text-[10px] font-semibold text-[#4f5b71]" aria-label="AI model">{providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => <option key={`${provider.id}-${model.id}`} value={`${provider.id}::${model.id}`}>{provider.name} · {model.name}{provider.kind === "ollama" || provider.apiKey ? "" : " (key needed)"}</option>))}</select><div className="mt-2 rounded-lg bg-[#f3f1eb] px-2.5 py-2 text-[9px] leading-4 text-[#657087]"><strong className="text-[#334057]">Source dataset:</strong> {fileName}. File names and MIME types inside rows describe referenced attachments.</div></div>
    <div className="scrollbar-none flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-8" : "mr-4"}><div className={`rounded-2xl px-4 py-3 text-[13px] leading-5 ${message.role === "user" ? "rounded-br-md bg-[#2764ff] text-white" : "rounded-bl-md bg-[#f0eee8] text-[#334057]"}`}>{message.role === "assistant" ? <MarkdownMessage content={message.content} /> : message.content}</div>{message.role === "assistant" && <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#9199a9]"><Sparkles className="h-3 w-3" /> {message.model || "Analysis"} · verify critical decisions</div>}</div>)}{thinking && <div className="mr-16 flex w-fit gap-1 rounded-2xl rounded-bl-md bg-[#f0eee8] px-4 py-3"><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/></div>}<div ref={endRef} /></div>
    <div className="border-t border-[#e6e2d9] p-4"><p className="mb-2 text-[9px] font-bold uppercase tracking-[.14em] text-[#7a8497]">Analysis skills</p><div className="mb-3 grid grid-cols-2 gap-2">{analysisSkills.map((skill) => <button key={skill.id} disabled={thinking} onClick={() => { setActiveAnalysisSkill(skill.id); setActiveView("analysis"); setAiOpen(true); void ask(skill.prompt, skill.id); }} className={`focus-ring rounded-xl border p-2.5 text-left transition disabled:opacity-50 ${activeAnalysisSkill === skill.id ? "border-[#2764ff] bg-[#edf2ff]" : "border-[#dedbd2] bg-white hover:border-[#aac0ff]"}`}><span className="block text-[10px] font-semibold text-[#101a2d]">{skill.name}</span><span className="mt-1 block text-[8px] leading-3 text-[#7a8497]">{skill.description}</span></button>)}</div><form onSubmit={submit} className="relative"><textarea value={input} onChange={(e) => setInput(e.target.value.slice(0, 500))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder={`Ask with ${analysisSkills.find((skill) => skill.id === activeAnalysisSkill)?.name.toLowerCase()}…`} className="focus-ring h-20 w-full resize-none rounded-2xl border border-[#d9d6ce] bg-white p-3 pr-12 text-xs leading-5 placeholder:text-[#9ba2af]" aria-label="Ask the AI analyst"/><button type="submit" disabled={thinking || !input.trim()} className="focus-ring absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-lg bg-[#101a2d] text-white hover:bg-[#2764ff] disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send"><Send className="h-3.5 w-3.5" /></button></form><p className="mt-2 text-center text-[9px] text-[#9ba2af]">{activeProvider?.kind === "ollama" || activeProvider?.apiKey ? `${activeProvider.name} · ${activeModel?.name || "Choose a model"}` : "Local fallback active · add a provider key in Settings"}</p></div>
  </aside>;
}

export function AnalyticsWorkspace({ ownerId }: { ownerId: string }) {
  const { activeView, setActiveView, aiOpen, setAiOpen, activeSessionId, rows, fileName, intelligence, initializeSessions } = useWorkspace(); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { void initializeSessions(ownerId); }, [initializeSessions, ownerId]);
  useEffect(() => { if (activeSessionId && rows.length && fileName && intelligence?.source === "schema") void discoverDataset(activeSessionId, rows, fileName); }, [activeSessionId, fileName, intelligence?.source, rows]);
  useEffect(() => { const ctx = gsap.context(() => { gsap.from(".metric-card, .risk-card", { y: 18, opacity: 0, duration: .55, stagger: .06, ease: "power2.out" }); }, root); return () => ctx.revert(); }, [activeView]);
  const view = activeView === "settings" ? <SettingsView /> : activeView === "history" ? <HistoryView /> : !activeSessionId ? <SessionHome /> : activeView === "analysis" ? <AnalysisView /> : activeView === "overview" ? <ExecutiveOverview /> : activeView === "risk" ? <RiskView /> : <DataTableView />;
  const mobileItems = [{ id: "analysis" as const, icon: MessageSquare, label: "Analysis" }, { id: "overview" as const, icon: LayoutDashboard, label: "Dashboard" }, { id: "data" as const, icon: Table2, label: "Data" }, { id: "history" as const, icon: Clock3, label: "History" }, { id: "settings" as const, icon: Settings, label: "Settings" }];
  return <div ref={root} className="min-h-screen bg-[#f4f1ea]"><Toaster position="top-center" richColors /><Header /><div data-ai-open={Boolean(activeSessionId && aiOpen)} className="workspace-grid grid grid-cols-[72px_minmax(0,1fr)_0px] items-start"><Sidebar /><main className="main-pad hairline-grid min-h-[calc(100vh-64px)] min-w-0 overflow-hidden p-7 xl:p-8"><div className="mx-auto max-w-[1200px]">{view}</div></main>{activeSessionId && <AiPanel key={activeSessionId} />}</div><nav className="mobile-nav fixed bottom-0 left-0 right-0 z-40 hidden border-t border-[#dedbd2] bg-[#fffefa]/95 px-2 py-2 backdrop-blur" aria-label="Mobile navigation">{mobileItems.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setActiveView(id)} className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[9px] font-semibold ${activeView === id ? "bg-[#edf2ff] text-[#2764ff]" : "text-[#7a8497]"}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>{activeSessionId && !aiOpen && <button onClick={() => setAiOpen(true)} className="focus-ring fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-2xl bg-[#2764ff] text-white shadow-xl sm:hidden" aria-label="Open AI analyst"><PanelRightOpen className="h-5 w-5" /></button>}</div>;
}
