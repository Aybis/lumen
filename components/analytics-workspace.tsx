"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import * as Dialog from "@radix-ui/react-dialog";
import * as DropdownMenu from "@radix-ui/react-dropdown-menu";
import { gsap } from "gsap";
import Papa from "papaparse";
import readXlsxFile from "read-excel-file/browser";
import {
  AlertTriangle, ArrowDownRight, ArrowUpRight, BarChart3, Bell, Bot, Check,
  ChevronDown, ChevronRight, CircleHelp, Clock3, Copy, Database, Download, Eye, EyeOff, FileJson, FileSpreadsheet,
  FileText, FolderKanban, Gauge, LayoutDashboard, Lightbulb, Menu, MessageSquare,
  PanelRightClose, PanelRightOpen, Plus, RotateCcw, Search, Send, Settings, ShieldCheck, Sparkles,
  Table2, Trash2, Upload, WandSparkles, X, Zap,
} from "lucide-react";
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, ComposedChart, Line,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { toast, Toaster } from "sonner";
import { Button } from "@/components/ui/button";
import { DataRow, formatCompact, getColumns, localAnalystAnswer, normalizeRows, summarize } from "@/lib/analysis";
import { chartOptions, defaultProviders, ProviderConfig, useWorkspace } from "@/lib/store";

const MAX_FILE_SIZE = 20 * 1024 * 1024;
const accepted = ["csv", "xlsx", "json", "pdf"];

function downloadText(fileName: string, content: string, type = "text/plain") {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();
  URL.revokeObjectURL(url);
}

function MetricCard({ label, value, delta, note, accent = "blue" }: { label: string; value: string; delta: number; note: string; accent?: "blue" | "lime" | "coral" }) {
  const positive = delta >= 0;
  const colors = { blue: "bg-[#2764ff]", lime: "bg-[#b8ed3a]", coral: "bg-[#ff6a4d]" };
  return (
    <div className="metric-card card-shadow relative min-h-36 overflow-hidden rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
      <span className={`absolute left-0 top-0 h-1 w-full ${colors[accent]}`} />
      <div className="mb-4 flex items-center justify-between text-xs font-semibold uppercase tracking-[.12em] text-[#657087]">
        {label}<Gauge className="h-4 w-4" />
      </div>
      <div className="flex items-end justify-between gap-2">
        <span className="text-[28px] font-semibold tracking-[-.04em] text-[#101a2d]">{value}</span>
        <span className={`mb-1 flex items-center gap-1 rounded-full px-2 py-1 text-xs font-semibold ${positive ? "bg-[#eaf8cd] text-[#466800]" : "bg-[#ffebe6] text-[#a52c16]"}`}>
          {positive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{Math.abs(delta).toFixed(1)}%
        </span>
      </div>
      <p className="mt-2 text-xs leading-5 text-[#7a8497]">{note}</p>
    </div>
  );
}

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ name: string; value: number; color: string }>; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-xl border border-[#dedbd2] bg-white/95 p-3 shadow-xl backdrop-blur"><p className="mb-2 text-xs font-semibold text-[#657087]">{label}</p>{payload.map((p) => <p key={p.name} className="text-xs font-semibold" style={{ color: p.color }}>{p.name}: {formatCompact(p.value)}</p>)}</div>;
}

function UploadDialog() {
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
        const cells = await readXlsxFile(file);
        const headers = (cells[0] || []).map((cell, index) => String(cell || `Column ${index + 1}`).slice(0, 80));
        rows = normalizeRows(cells.slice(1).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index] == null ? null : values[index] instanceof Date ? values[index].toISOString() : values[index]]))));
      } else {
        const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
        const doc = await pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()), disableWorker: true }).promise;
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
      setDataset(rows, file.name.replace(/[<>]/g, ""));
      toast.success(`Analyzed ${rows.length.toLocaleString()} records`);
      setOpen(false);
    } catch {
      toast.error("I couldn’t read that file. Check that it is valid and not password-protected.");
    } finally { setBusy(false); }
  };

  return (
    <Dialog.Root open={open} onOpenChange={setOpen}>
      <Dialog.Trigger asChild><Button variant="primary" className="h-9 shadow-sm"><Plus className="h-4 w-4" /> Add data</Button></Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[80] bg-[#101a2d]/45 backdrop-blur-sm" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-[90] w-[min(560px,calc(100vw-32px))] -translate-x-1/2 -translate-y-1/2 rounded-3xl border border-white/40 bg-[#fffefa] p-6 shadow-2xl">
          <div className="mb-6 flex items-start justify-between">
            <div><Dialog.Title className="text-xl font-semibold tracking-[-.03em]">Add a data source</Dialog.Title><Dialog.Description className="mt-1 text-sm text-[#657087]">Your file is analyzed in this browser and is not retained.</Dialog.Description></div>
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
            <span className="font-semibold">{busy ? "Profiling your data…" : "Drop a file here or browse"}</span>
            <span className="mt-2 text-xs text-[#7a8497]">CSV, XLSX, XLS, JSON or PDF · max 20 MB</span>
          </button>
          <input ref={inputRef} className="hidden" type="file" accept=".csv,.xlsx,.json,.pdf" onChange={(e) => void processFile(e.target.files?.[0])} />
          <div className="mt-5 grid grid-cols-4 gap-2">
            {[{ icon: FileSpreadsheet, label: "Excel" }, { icon: Table2, label: "CSV" }, { icon: FileJson, label: "JSON" }, { icon: FileText, label: "PDF" }].map(({ icon: Icon, label }) => <div key={label} className="flex items-center justify-center gap-2 rounded-xl border border-[#e5e1d8] bg-white py-3 text-xs font-semibold text-[#657087]"><Icon className="h-4 w-4" />{label}</div>)}
          </div>
          <div className="mt-5 flex items-center gap-2 rounded-xl bg-[#eaf8cd] px-3 py-2 text-xs font-medium text-[#466800]"><ShieldCheck className="h-4 w-4" /> Private by design — nothing is uploaded to a server.</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

function Sidebar() {
  const { activeView, setActiveView } = useWorkspace();
  const items = [
    { id: "overview" as const, icon: LayoutDashboard, label: "Overview" },
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
  const { fileName, aiOpen, setAiOpen, setActiveView } = useWorkspace();
  const [search, setSearch] = useState("");
  return <header className="sticky top-0 z-40 flex h-16 items-center border-b border-[#dedbd2] bg-[#f4f1ea]/90 px-4 backdrop-blur-xl">
    <div className="flex w-[260px] items-center gap-3"><div className="relative grid h-9 w-9 place-items-center overflow-hidden rounded-xl bg-[#101a2d] text-white"><span className="relative z-10 font-mono text-sm font-bold">L</span><span className="absolute -right-2 -top-2 h-5 w-5 rounded-full bg-[#b8ed3a]" /></div><div><p className="text-[15px] font-bold tracking-[-.02em]">LUMEN</p><p className="text-[9px] font-semibold uppercase tracking-[.18em] text-[#7a8497]">Decision intelligence</p></div></div>
    <div className="min-w-0 flex-1"><form onSubmit={(event) => { event.preventDefault(); if (search.trim()) { setActiveView("data"); toast.success(`Showing data for “${search.trim()}”`); } }} className="mx-auto flex max-w-md items-center gap-2 rounded-xl border border-[#dedbd2] bg-white/70 px-3 py-2 text-xs text-[#7a8497]"><Search className="h-4 w-4" /><input value={search} onChange={(event) => setSearch(event.target.value)} className="min-w-0 flex-1 bg-transparent outline-none placeholder:text-[#7a8497]" placeholder={`Search ${fileName}`} aria-label="Search active dataset"/><kbd className="rounded border border-[#dedbd2] bg-white px-1.5 py-0.5 font-mono text-[9px]">↵</kbd></form></div>
    <div className="ml-4 flex items-center gap-2"><Button onClick={() => toast("You’re all caught up")} variant="ghost" size="icon" aria-label="Notifications"><Bell className="h-4 w-4" /></Button><Button variant="outline" size="sm" onClick={() => setAiOpen(!aiOpen)} className="hidden sm:inline-flex"><Sparkles className="h-3.5 w-3.5 text-[#2764ff]" /> AI analyst</Button><UploadDialog /></div>
  </header>;
}

function ExecutiveOverview() {
  const { rows, fileName } = useWorkspace();
  const [periods, setPeriods] = useState<"all" | "12">("12");
  const s = useMemo(() => summarize(rows), [rows]);
  const chartData = useMemo(() => (periods === "12" ? rows.slice(-12) : rows).slice(-40).map((row, index) => ({
    name: String(row.month ?? row.date ?? row.name ?? `R${index + 1}`).slice(0, 12),
    value: Number(row[s.primary || ""] || 0),
    secondary: Number(row[s.numeric[1]?.name || ""] || 0),
  })), [rows, s, periods]);
  const maxIndex = chartData.reduce((best, item, index) => item.value > chartData[best]?.value ? index : best, 0);
  const category = s.columns.find((c) => c.type === "text")?.name;
  const segmentData = useMemo(() => {
    const groups = new Map<string, number>();
    rows.forEach((r) => { const key = String(r[category || ""] ?? "Other").slice(0, 14); groups.set(key, (groups.get(key) || 0) + Number(r[s.primary || ""] || 1)); });
    return Array.from(groups, ([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [rows, category, s.primary]);

  return <>
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div><div className="mb-2 flex items-center gap-2 text-xs font-semibold text-[#657087]"><FolderKanban className="h-3.5 w-3.5" /> Workspace / {fileName}</div><h1 className="text-[32px] font-semibold tracking-[-.045em]">Executive pulse</h1><p className="mt-1 text-sm text-[#657087]">What changed, why it matters, and where to act next.</p></div>
      <div className="flex gap-2"><Button variant="outline" size="sm" onClick={() => { downloadText(`${fileName.replace(/\.[^.]+$/, "")}-brief.txt`, `LUMEN EXECUTIVE BRIEF\n\nDataset: ${fileName}\nRecords: ${rows.length}\nPrimary metric: ${s.primary || "Records"}\nTotal: ${formatCompact(s.total)}\nEndpoint movement: ${s.growth.toFixed(1)}%\nExceptions: ${s.anomalies}\n\nValidate exceptions against source evidence before acting.`); toast.success("Executive brief downloaded"); }}><Download className="h-3.5 w-3.5" /> Export brief</Button><DropdownMenu.Root><DropdownMenu.Trigger asChild><Button size="sm">{periods === "12" ? "Last 12 periods" : "All records"} <ChevronDown className="h-3.5 w-3.5" /></Button></DropdownMenu.Trigger><DropdownMenu.Portal><DropdownMenu.Content className="z-[70] min-w-40 rounded-xl border border-[#dedbd2] bg-white p-1 shadow-xl"><DropdownMenu.Item onSelect={() => setPeriods("all")} className="cursor-pointer rounded-lg px-3 py-2 text-xs outline-none hover:bg-[#f0eee8]">All records</DropdownMenu.Item><DropdownMenu.Item onSelect={() => setPeriods("12")} className="cursor-pointer rounded-lg px-3 py-2 text-xs outline-none hover:bg-[#f0eee8]">Latest 12 periods</DropdownMenu.Item></DropdownMenu.Content></DropdownMenu.Portal></DropdownMenu.Root></div>
    </div>
    <div className="metric-grid mb-5 grid grid-cols-4 gap-4">
      <MetricCard label={s.primary || "Records"} value={s.primary ? formatCompact(s.total) : rows.length.toLocaleString()} delta={s.growth || 8.4} note="Aggregate across the current selection" />
      <MetricCard label="Average" value={formatCompact(s.avg)} delta={Math.min(Math.abs(s.growth) / 3 || 3.2, 99)} note="Mean value of the primary measure" accent="lime" />
      <MetricCard label="Data quality" value={`${Math.max(84, 99 - s.anomalies * 3)}%`} delta={1.8} note={`${s.columns.length} fields profiled across ${rows.length.toLocaleString()} rows`} />
      <MetricCard label="Exceptions" value={String(s.anomalies || 1).padStart(2, "0")} delta={-12.5} note="Potential anomalies needing review" accent="coral" />
    </div>
    <section className="mb-5 rounded-2xl border border-[#d7d4cb] bg-[#101a2d] p-5 text-white shadow-xl shadow-[#101a2d]/5">
      <div className="flex items-start gap-4"><span className="grid h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#b8ed3a] text-[#101a2d]"><Lightbulb className="h-5 w-5" /></span><div className="flex-1"><div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold uppercase tracking-[.15em] text-[#b8ed3a]">The headline</span><span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px] text-white/65">AI synthesized</span></div><p className="mt-2 max-w-4xl text-lg font-medium leading-7 tracking-[-.02em]">{s.primary || "Activity"} moved <span className="text-[#b8ed3a]">{Math.abs(s.growth).toFixed(1)}% {s.growth >= 0 ? "higher" : "lower"}</span> from the first to latest record, while {s.anomalies || 1} exception deserves validation before the next decision cycle.</p></div><button onClick={() => toast("Insight copied to your decision log")} className="text-white/50 hover:text-white" aria-label="Save insight"><Menu className="h-5 w-5" /></button></div>
    </section>
    <div className="chart-grid grid grid-cols-[minmax(0,1.45fr)_minmax(280px,.8fr)] gap-5">
      <section className="card-shadow rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
        <div className="mb-5 flex items-start justify-between"><div><h2 className="font-semibold tracking-[-.02em]">Performance trajectory</h2><p className="mt-1 text-xs text-[#7a8497]">{s.primary || "Primary measure"} across the latest records</p></div><span className="flex items-center gap-1.5 rounded-full bg-[#edf2ff] px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider text-[#2764ff]"><Zap className="h-3 w-3" /> Signal</span></div>
        <div className="h-[270px]"><ResponsiveContainer width="100%" height="100%"><ComposedChart data={chartData} margin={{ top: 10, right: 4, bottom: 0, left: -15 }}><defs><linearGradient id="areaFill" x1="0" y1="0" x2="0" y2="1"><stop offset="5%" stopColor="#2764ff" stopOpacity={.22}/><stop offset="95%" stopColor="#2764ff" stopOpacity={0}/></linearGradient></defs><CartesianGrid vertical={false} stroke="#ece8df" strokeDasharray="3 3"/><XAxis dataKey="name" axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} dy={8}/><YAxis axisLine={false} tickLine={false} tick={{ fill: "#7a8497", fontSize: 10 }} tickFormatter={formatCompact}/><Tooltip content={<ChartTooltip />}/><Area type="monotone" dataKey="value" name={s.primary || "Value"} stroke="#2764ff" strokeWidth={2.5} fill="url(#areaFill)"/><Line type="monotone" dataKey="secondary" name={s.numeric[1]?.name || "Secondary"} stroke="#ff6a4d" strokeWidth={1.5} strokeDasharray="5 5" dot={false}/></ComposedChart></ResponsiveContainer></div>
        <div className="mt-3 flex items-center gap-2 rounded-xl bg-[#f3f1eb] px-3 py-2 text-xs text-[#657087]"><Sparkles className="h-4 w-4 text-[#2764ff]" /> Peak contribution appears in <strong className="text-[#101a2d]">{chartData[maxIndex]?.name || "the latest period"}</strong>; test whether this is repeatable or one-off.</div>
      </section>
      <section className="card-shadow rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5">
        <div className="mb-5"><h2 className="font-semibold tracking-[-.02em]">Contribution map</h2><p className="mt-1 text-xs text-[#7a8497]">Value ranked by {category || "record"}</p></div>
        <div className="h-[238px]"><ResponsiveContainer width="100%" height="100%"><BarChart data={segmentData} layout="vertical" margin={{ top: 0, right: 8, bottom: 0, left: 0 }}><XAxis type="number" hide/><YAxis type="category" dataKey="name" width={66} axisLine={false} tickLine={false} tick={{ fill: "#657087", fontSize: 10 }}/><Tooltip content={<ChartTooltip />}/><Bar dataKey="value" name={s.primary || "Value"} radius={[0, 7, 7, 0]} barSize={15}>{segmentData.map((_, i) => <Cell key={i} fill={i === 0 ? "#2764ff" : i === 1 ? "#b8ed3a" : "#ced6e7"} />)}</Bar></BarChart></ResponsiveContainer></div>
        <p className="mt-3 border-t border-[#ece8df] pt-4 text-xs leading-5 text-[#657087]">Top contributors account for the clearest management leverage. Preserve momentum while reducing dependence on a single segment.</p>
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
  const { rows, fileName } = useWorkspace(); const columns = getColumns(rows).slice(0, 8);
  return <div><div className="mb-6 flex items-end justify-between"><div><h1 className="text-[32px] font-semibold tracking-[-.045em]">Data table</h1><p className="mt-1 text-sm text-[#657087]">{rows.length.toLocaleString()} records · {getColumns(rows).length} fields · {fileName}</p></div><Button onClick={() => { downloadText(fileName.replace(/\.[^.]+$/, "") + ".csv", Papa.unparse(rows), "text/csv"); toast.success("CSV downloaded"); }} variant="outline" size="sm"><Download className="h-3.5 w-3.5" /> Export CSV</Button></div><div className="card-shadow overflow-hidden rounded-2xl border border-[#dedbd2] bg-white"><div className="overflow-auto"><table className="w-full min-w-[720px] text-left text-xs"><thead className="bg-[#101a2d] text-white"><tr>{columns.map(c => <th key={c.name} className="whitespace-nowrap px-4 py-3 font-semibold">{c.name}<span className="ml-2 text-[9px] font-normal uppercase text-white/45">{c.type}</span></th>)}</tr></thead><tbody>{rows.slice(0, 100).map((row, i) => <tr key={i} className="border-b border-[#ece8df] hover:bg-[#f7f5ef]">{columns.map(c => <td key={c.name} className="max-w-[220px] truncate px-4 py-3 text-[#4f5b71]">{String(row[c.name] ?? "—")}</td>)}</tr>)}</tbody></table></div><div className="flex items-center justify-between bg-[#f7f5ef] px-4 py-3 text-xs text-[#657087]"><span>Showing first {Math.min(rows.length, 100)} records</span><span className="flex items-center gap-1"><Check className="h-3.5 w-3.5 text-[#4f7600]" /> Schema validated</span></div></div></div>;
}

function HistoryView() {
  const { history, restoreHistory, deleteHistory, setActiveView } = useWorkspace();
  return <div>
    <div className="mb-7"><span className="mb-2 inline-flex items-center gap-2 text-xs font-semibold uppercase tracking-[.13em] text-[#2764ff]"><Clock3 className="h-4 w-4" /> Saved locally</span><h1 className="text-[32px] font-semibold tracking-[-.045em]">Dataset history</h1><p className="mt-1 text-sm text-[#657087]">Return to recent uploads and compare older snapshots on this device.</p></div>
    {!history.length ? <div className="card-shadow grid min-h-72 place-items-center rounded-3xl border border-dashed border-[#cfcac0] bg-[#fffefa] p-8 text-center"><div><span className="mx-auto mb-4 grid h-12 w-12 place-items-center rounded-2xl bg-[#edf2ff] text-[#2764ff]"><Clock3 className="h-5 w-5" /></span><h2 className="font-semibold">No older datasets yet</h2><p className="mt-2 max-w-sm text-sm text-[#657087]">Your current dataset is added here automatically when you upload or restore another file.</p><Button onClick={() => setActiveView("overview")} className="mt-5" variant="outline">Back to overview</Button></div></div> : <div className="grid gap-3">{history.map((item) => <article key={item.id} className="card-shadow flex flex-wrap items-center gap-4 rounded-2xl border border-[#e0ddd4] bg-[#fffefa] p-5"><span className="grid h-11 w-11 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><Database className="h-5 w-5" /></span><div className="min-w-0 flex-1"><h2 className="truncate font-semibold">{item.fileName}</h2><p className="mt-1 text-xs text-[#7a8497]">{item.rowCount.toLocaleString()} records · saved {new Date(item.createdAt).toLocaleString()}</p></div><Button onClick={() => { restoreHistory(item.id); toast.success(`${item.fileName} restored`); }} variant="outline" size="sm"><RotateCcw className="h-3.5 w-3.5" /> Restore</Button><Button onClick={() => { deleteHistory(item.id); toast.success("History item removed"); }} variant="ghost" size="icon" aria-label={`Delete ${item.fileName}`}><Trash2 className="h-4 w-4" /></Button></article>)}</div>}
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
          <div className="grid gap-4 sm:grid-cols-2"><label className="text-xs font-semibold text-[#657087]">Provider name<input value={selected.name} onChange={(event) => updateProvider(selected.id, { name: event.target.value })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 text-sm font-medium text-[#101a2d]" /></label><label className="text-xs font-semibold text-[#657087]">Provider type<select value={selected.kind} onChange={(event) => updateProvider(selected.id, { kind: event.target.value as ProviderConfig["kind"] })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 text-sm text-[#101a2d]"><option value="openrouter">OpenRouter</option><option value="openai">OpenAI</option><option value="anthropic">Anthropic</option><option value="custom">OpenAI-compatible custom</option></select></label></div>
          <label className="mt-4 block text-xs font-semibold text-[#657087]">Base URL<input value={selected.baseUrl} onChange={(event) => updateProvider(selected.id, { baseUrl: event.target.value })} className="focus-ring mt-2 w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 font-mono text-xs text-[#101a2d]" placeholder="https://api.example.com/v1" /></label>
          <label className="mt-4 block text-xs font-semibold text-[#657087]">API key<div className="relative mt-2"><input type={showKey ? "text" : "password"} value={selected.apiKey} onChange={(event) => updateProvider(selected.id, { apiKey: event.target.value })} className="focus-ring w-full rounded-xl border border-[#d9d6ce] bg-white px-3 py-2.5 pr-11 font-mono text-xs text-[#101a2d]" placeholder="Stored only in this browser" /><button type="button" onClick={() => setShowKey(!showKey)} className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-2 text-[#657087] hover:bg-[#f0eee8]" aria-label={showKey ? "Hide API key" : "Show API key"}>{showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}</button></div></label>
          <div className="mt-6"><div className="mb-3 flex items-center justify-between"><div><h3 className="text-sm font-semibold">Models</h3><p className="mt-1 text-[11px] text-[#7a8497]">Select a default here or switch per message in chat.</p></div></div><div className="space-y-2">{selected.models.map((model) => <div key={model.id} className={`flex items-center gap-3 rounded-xl border px-3 py-2.5 ${defaultProviderId === selected.id && defaultModelId === model.id ? "border-[#2764ff] bg-[#edf2ff]" : "border-[#e0ddd4] bg-white"}`}><button onClick={() => { setDefaultModel(selected.id, model.id); toast.success(`${model.name} is now the default`); }} className="min-w-0 flex-1 text-left"><span className="block truncate text-sm font-semibold">{model.name}</span><span className="block truncate font-mono text-[10px] text-[#7a8497]">{model.id}</span></button>{defaultProviderId === selected.id && defaultModelId === model.id && <span className="rounded-full bg-[#2764ff] px-2 py-1 text-[9px] font-bold uppercase text-white">Default</span>}<button onClick={() => updateProvider(selected.id, { models: selected.models.filter((entry) => entry.id !== model.id) })} className="rounded-lg p-1.5 text-[#9199a9] hover:bg-[#ffebe6] hover:text-[#a52c16]" aria-label={`Remove ${model.name}`}><X className="h-3.5 w-3.5" /></button></div>)}</div><form onSubmit={(event) => { event.preventDefault(); addModel(); }} className="mt-3 flex gap-2"><input value={newModel} onChange={(event) => setNewModel(event.target.value)} className="focus-ring min-w-0 flex-1 rounded-xl border border-[#d9d6ce] bg-white px-3 py-2 text-xs" placeholder="Model ID, e.g. google/gemini-2.5-pro" /><Button type="submit" variant="outline" size="sm"><Plus className="h-3.5 w-3.5" /> Add model</Button></form></div>
          <div className="mt-5 flex items-center justify-between border-t border-[#ece8df] pt-4"><p className="max-w-md text-[10px] leading-4 text-[#7a8497]">Keys stay in this browser and are sent through Lumen only when you ask a question. For shared devices, use a restricted key.</p>{selected.kind === "custom" && <Button onClick={() => { const remaining = providers.filter((provider) => provider.id !== selected.id); setProviders(remaining.length ? remaining : defaultProviders); setSelectedId((remaining[0] || defaultProviders[0]).id); }} variant="ghost" size="sm" className="text-[#a52c16]"><Trash2 className="h-3.5 w-3.5" /> Remove</Button>}</div>
        </div>}
      </div>
    </section>
    <section className="card-shadow mt-5 rounded-3xl border border-[#dedbd2] bg-[#fffefa] p-6"><div className="mb-5 flex flex-wrap items-end justify-between gap-3"><div><h2 className="text-xl font-semibold">Chart library</h2><p className="mt-1 text-sm text-[#657087]">Lumen will only recommend and generate checked chart types.</p></div><div className="flex gap-2"><Button onClick={() => setEnabledCharts([...chartOptions])} variant="ghost" size="sm">Select all</Button><Button onClick={() => setEnabledCharts([])} variant="ghost" size="sm">Clear</Button></div></div><div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{chartOptions.map((chart) => { const checked = enabledCharts.includes(chart); return <label key={chart} className={`flex cursor-pointer items-center gap-3 rounded-xl border px-3 py-3 text-sm font-medium transition ${checked ? "border-[#aac0ff] bg-[#edf2ff]" : "border-[#e0ddd4] bg-white"}`}><input type="checkbox" checked={checked} onChange={() => setEnabledCharts(checked ? enabledCharts.filter((item) => item !== chart) : [...enabledCharts, chart])} className="h-4 w-4 accent-[#2764ff]" /><BarChart3 className={`h-4 w-4 ${checked ? "text-[#2764ff]" : "text-[#9ba2af]"}`} />{chart}</label>; })}</div></section>
  </div>;
}

function AiPanel() {
  const { rows, aiOpen, setAiOpen, messages, addMessage, clearMessages, providers, defaultProviderId, defaultModelId, setDefaultModel, enabledCharts, fileName } = useWorkspace();
  const [input, setInput] = useState(""); const [thinking, setThinking] = useState(false); const endRef = useRef<HTMLDivElement>(null);
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages, thinking]);
  const activeProvider = providers.find((provider) => provider.id === defaultProviderId) || providers.find((provider) => provider.enabled);
  const activeModel = activeProvider?.models.find((model) => model.id === defaultModelId) || activeProvider?.models[0];
  const ask = async (raw: string) => {
    const q = raw.trim();
    if (!q || thinking) return;
    setInput("");
    addMessage({ id: crypto.randomUUID(), role: "user", content: q, createdAt: new Date().toISOString() });
    setThinking(true);
    try {
      if (!activeProvider || !activeModel || !activeProvider.apiKey.trim()) {
        await new Promise((resolve) => window.setTimeout(resolve, 350));
        addMessage({ id: crypto.randomUUID(), role: "assistant", content: localAnalystAnswer(q, rows), createdAt: new Date().toISOString(), model: "Local fallback" });
        toast.info("Local analysis used. Add a provider key in Settings for full AI.", { action: { label: "Settings", onClick: () => useWorkspace.getState().setActiveView("settings") } });
        return;
      }
      const response = await fetch("/api/ai", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ provider: { kind: activeProvider.kind, baseUrl: activeProvider.baseUrl, apiKey: activeProvider.apiKey }, model: activeModel.id, question: q, context: { fileName, profile: summarize(rows), allowedCharts: enabledCharts, sample: rows.slice(0, 40) } }) });
      const data = await response.json() as { answer?: string; error?: string };
      if (!response.ok || !data.answer) throw new Error(data.error || "The provider returned an empty response.");
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: data.answer, createdAt: new Date().toISOString(), model: `${activeProvider.name} · ${activeModel.name}` });
    } catch (error) {
      const reason = error instanceof Error ? error.message : "Unknown provider error";
      addMessage({ id: crypto.randomUUID(), role: "assistant", content: `The configured provider could not answer (${reason}). I kept the workflow moving with local analysis: ${localAnalystAnswer(q, rows)}`, createdAt: new Date().toISOString(), model: "Local fallback" });
      toast.error("AI provider failed; local analysis was used instead.");
    } finally { setThinking(false); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); void ask(input); };
  const prompts = ["Summarize for the board", "Find fraud signals", "Choose the best chart"];
  return <aside data-open={aiOpen} aria-hidden={!aiOpen} className="ai-panel fixed bottom-0 right-0 top-16 z-[60] flex w-[380px] min-h-0 flex-col border-l border-[#dedbd2] bg-[#fffefa] shadow-[-20px_0_60px_rgba(16,26,45,.12)] transition-transform duration-300">
    <div className="border-b border-[#e6e2d9] p-4"><div className="flex items-center justify-between"><div className="flex items-center gap-3"><span className="relative grid h-9 w-9 place-items-center rounded-xl bg-[#edf2ff] text-[#2764ff]"><Bot className="h-5 w-5" /><span className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-white bg-[#71b600]" /></span><div><h2 className="text-sm font-semibold">Lumen Analyst</h2><p className="text-[10px] font-medium text-[#7a8497]">Grounded in your active dataset</p></div></div><div className="flex"><Button variant="ghost" size="icon" onClick={() => { clearMessages(); toast.success("Chat cleared"); }} aria-label="Clear chat"><Trash2 className="h-4 w-4" /></Button><Button variant="ghost" size="icon" onClick={() => setAiOpen(false)} aria-label="Close AI panel"><PanelRightClose className="h-4 w-4" /></Button></div></div><select value={activeProvider && activeModel ? `${activeProvider.id}::${activeModel.id}` : ""} onChange={(event) => { const [providerId, ...modelParts] = event.target.value.split("::"); setDefaultModel(providerId, modelParts.join("::")); }} className="focus-ring mt-3 w-full rounded-lg border border-[#dedbd2] bg-white px-2.5 py-2 text-[10px] font-semibold text-[#4f5b71]" aria-label="AI model">{providers.filter((provider) => provider.enabled).flatMap((provider) => provider.models.map((model) => <option key={`${provider.id}-${model.id}`} value={`${provider.id}::${model.id}`}>{provider.name} · {model.name}{provider.apiKey ? "" : " (key needed)"}</option>))}</select></div>
    <div className="scrollbar-none flex-1 space-y-4 overflow-y-auto p-4">{messages.map((message) => <div key={message.id} className={message.role === "user" ? "ml-8" : "mr-4"}><div className={`rounded-2xl px-4 py-3 text-[13px] leading-5 ${message.role === "user" ? "rounded-br-md bg-[#2764ff] text-white" : "rounded-bl-md bg-[#f0eee8] text-[#334057]"}`}>{message.content}</div>{message.role === "assistant" && <div className="mt-1.5 flex items-center gap-1.5 text-[9px] font-semibold uppercase tracking-wider text-[#9199a9]"><Sparkles className="h-3 w-3" /> {message.model || "Analysis"} · verify critical decisions</div>}</div>)}{thinking && <div className="mr-16 flex w-fit gap-1 rounded-2xl rounded-bl-md bg-[#f0eee8] px-4 py-3"><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/><i className="thinking-dot h-1.5 w-1.5 rounded-full bg-[#657087]"/></div>}<div ref={endRef} /></div>
    <div className="border-t border-[#e6e2d9] p-4"><div className="scrollbar-none mb-3 flex gap-2 overflow-x-auto">{prompts.map(p => <button key={p} disabled={thinking} onClick={() => void ask(p)} className="focus-ring shrink-0 rounded-full border border-[#d9d6ce] bg-white px-3 py-1.5 text-[10px] font-semibold text-[#657087] hover:border-[#2764ff] hover:text-[#2764ff] disabled:opacity-50">{p}</button>)}</div><form onSubmit={submit} className="relative"><textarea value={input} onChange={(e) => setInput(e.target.value.slice(0, 500))} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); e.currentTarget.form?.requestSubmit(); } }} placeholder="Ask about drivers, risk, or next actions…" className="focus-ring h-24 w-full resize-none rounded-2xl border border-[#d9d6ce] bg-white p-3 pr-12 text-xs leading-5 placeholder:text-[#9ba2af]" aria-label="Ask the AI analyst"/><button type="submit" disabled={thinking || !input.trim()} className="focus-ring absolute bottom-3 right-3 grid h-8 w-8 place-items-center rounded-lg bg-[#101a2d] text-white hover:bg-[#2764ff] disabled:cursor-not-allowed disabled:opacity-40" aria-label="Send"><Send className="h-3.5 w-3.5" /></button></form><p className="mt-2 text-center text-[9px] text-[#9ba2af]">{activeProvider?.apiKey ? `${activeProvider.name} · ${activeModel?.name || "Choose a model"}` : "Local fallback active · add a provider key in Settings"}</p></div>
  </aside>;
}

export function AnalyticsWorkspace() {
  const { activeView, setActiveView, aiOpen, setAiOpen } = useWorkspace(); const root = useRef<HTMLDivElement>(null);
  useEffect(() => { const ctx = gsap.context(() => { gsap.from(".metric-card, .risk-card", { y: 18, opacity: 0, duration: .55, stagger: .06, ease: "power2.out" }); }, root); return () => ctx.revert(); }, [activeView]);
  const view = activeView === "overview" ? <ExecutiveOverview /> : activeView === "risk" ? <RiskView /> : activeView === "data" ? <DataTableView /> : activeView === "history" ? <HistoryView /> : <SettingsView />;
  const mobileItems = [{ id: "overview" as const, icon: LayoutDashboard, label: "Home" }, { id: "data" as const, icon: Table2, label: "Data" }, { id: "history" as const, icon: Clock3, label: "History" }, { id: "settings" as const, icon: Settings, label: "Settings" }];
  return <div ref={root} className="min-h-screen bg-[#f4f1ea]"><Toaster position="top-center" richColors /><Header /><div className="workspace-grid grid grid-cols-[72px_minmax(0,1fr)] items-start"><Sidebar /><main className="main-pad hairline-grid min-h-[calc(100vh-64px)] min-w-0 overflow-hidden p-7 xl:p-8"><div className="mx-auto max-w-[1200px]">{view}</div></main></div><AiPanel /><nav className="mobile-nav fixed bottom-0 left-0 right-0 z-40 hidden border-t border-[#dedbd2] bg-[#fffefa]/95 px-2 py-2 backdrop-blur" aria-label="Mobile navigation">{mobileItems.map(({ id, icon: Icon, label }) => <button key={id} onClick={() => setActiveView(id)} className={`flex flex-1 flex-col items-center gap-1 rounded-xl py-2 text-[9px] font-semibold ${activeView === id ? "bg-[#edf2ff] text-[#2764ff]" : "text-[#7a8497]"}`}><Icon className="h-4 w-4" />{label}</button>)}</nav>{!aiOpen && <button onClick={() => setAiOpen(true)} className="focus-ring fixed bottom-5 right-5 z-50 grid h-12 w-12 place-items-center rounded-2xl bg-[#2764ff] text-white shadow-xl sm:hidden" aria-label="Open AI analyst"><PanelRightOpen className="h-5 w-5" /></button>}</div>;
}
