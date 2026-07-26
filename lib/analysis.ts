export type DataRow = Record<string, string | number | boolean | null>;

export const sampleData: DataRow[] = [
  { month: "Jan", revenue: 284000, margin: 31.2, orders: 1840, risk: 2.1, region: "North" },
  { month: "Feb", revenue: 296000, margin: 31.8, orders: 1910, risk: 2.4, region: "North" },
  { month: "Mar", revenue: 318000, margin: 33.1, orders: 2030, risk: 2.0, region: "East" },
  { month: "Apr", revenue: 309000, margin: 32.6, orders: 1998, risk: 3.1, region: "East" },
  { month: "May", revenue: 342000, margin: 34.2, orders: 2180, risk: 2.7, region: "Central" },
  { month: "Jun", revenue: 351000, margin: 34.8, orders: 2250, risk: 2.5, region: "Central" },
  { month: "Jul", revenue: 373000, margin: 35.3, orders: 2380, risk: 3.2, region: "West" },
  { month: "Aug", revenue: 387000, margin: 35.7, orders: 2440, risk: 3.5, region: "West" },
  { month: "Sep", revenue: 401000, margin: 36.1, orders: 2520, risk: 4.8, region: "South" },
  { month: "Oct", revenue: 395000, margin: 35.4, orders: 2485, risk: 5.9, region: "South" },
  { month: "Nov", revenue: 428000, margin: 36.9, orders: 2660, risk: 4.2, region: "North" },
  { month: "Dec", revenue: 461000, margin: 38.1, orders: 2810, risk: 3.6, region: "North" },
];

export function normalizeRows(input: unknown): DataRow[] {
  const source = Array.isArray(input) ? input : typeof input === "object" && input ? [input] : [];
  return source.slice(0, 5000).map((item) => {
    if (typeof item !== "object" || !item) return { value: String(item) };
    const result: DataRow = {};
    Object.entries(item as Record<string, unknown>).slice(0, 80).forEach(([key, value]) => {
      if (value == null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
        result[String(key).slice(0, 80)] = value as DataRow[string];
      } else result[String(key).slice(0, 80)] = JSON.stringify(value).slice(0, 500);
    });
    return result;
  });
}

export function getColumns(rows: DataRow[]) {
  const names = Array.from(new Set(rows.flatMap((row) => Object.keys(row))));
  return names.map((name) => {
    const values = rows.map((r) => r[name]).filter((v) => v !== null && v !== "");
    const numeric = values.length > 0 && values.filter((v) => typeof v === "number" || (typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))).length / values.length > .75;
    return { name, type: numeric ? "number" as const : "text" as const };
  });
}

export function summarize(rows: DataRow[]) {
  const columns = getColumns(rows);
  const numeric = columns.filter((c) => c.type === "number");
  const primary = numeric[0]?.name;
  const values = primary ? rows.map((r) => Number(r[primary])).filter(Number.isFinite) : [];
  const total = values.reduce((a, b) => a + b, 0);
  const avg = values.length ? total / values.length : 0;
  const first = values[0] || 0;
  const last = values.at(-1) || 0;
  const growth = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const mean = avg;
  const deviation = values.length ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) : 0;
  const anomalies = values.filter((v) => deviation && Math.abs(v - mean) > deviation * 1.5).length;
  return { columns, numeric, primary, values, total, avg, growth, anomalies };
}

export function localAnalystAnswer(question: string, rows: DataRow[]) {
  const s = summarize(rows);
  const q = question.toLowerCase();
  const metric = s.primary || "the primary metric";
  if (q.includes("fraud") || q.includes("risk") || q.includes("anomal")) {
    return `I found ${s.anomalies || 1} unusual movement${s.anomalies === 1 ? "" : "s"} in ${metric}. Prioritize records furthest from the average and validate duplicates, timing, and authorization fields before escalation.`;
  }
  if (q.includes("visual") || q.includes("chart")) {
    return `Use a line chart for ${metric} over sequence, a ranked bar chart for the strongest category, and a compact exception table for outliers. That combination shows direction, contribution, and evidence without clutter.`;
  }
  if (q.includes("executive") || q.includes("summary") || q.includes("board")) {
    return `${metric} totals ${formatCompact(s.total)} across ${rows.length.toLocaleString()} records, with ${s.growth >= 0 ? "an upward" : "a downward"} endpoint movement of ${Math.abs(s.growth).toFixed(1)}%. The immediate management question is whether the change is broad-based or concentrated in a small number of records.`;
  }
  return `${metric} is the strongest quantitative signal in this dataset. Its average is ${formatCompact(s.avg)}, and endpoint movement is ${s.growth.toFixed(1)}%. I would segment this by the first categorical field, then investigate the highest-variance records.`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}
