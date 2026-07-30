export type DataRow = Record<string, string | number | boolean | null>;

export function normalizeRows(input: unknown): DataRow[] {
  const source = Array.isArray(input) ? input : typeof input === "object" && input ? [input] : [];
  return source.map((item) => {
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

function nameTokens(name: string) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

function isIdentifierColumn(name: string) {
  const tokens = nameTokens(name);
  return tokens.some((token) => ["id", "uuid", "guid"].includes(token)) || ["key", "code"].includes(tokens.at(-1) || "");
}

function populatedValues(rows: DataRow[], name: string) {
  return rows.map((row) => row[name]).filter((value) => value !== null && value !== "" && value !== undefined);
}

export function summarize(rows: DataRow[], options?: { primaryMetric?: string | null; primaryDimension?: string | null }) {
  const columns = getColumns(rows);
  const allNumeric = columns.filter((column) => column.type === "number");
  const technicalMeasure = /(filesize|file_size|bytes|characters|wordcount|word_count|page|index|sequence|timestamp)/i;
  const numeric = allNumeric.filter((column) => !isIdentifierColumn(column.name) && !technicalMeasure.test(column.name));
  const preferredMetric = /(revenue|sales|amount|value|price|cost|profit|margin|score|risk|duration|count|quantity|total|rate|percent|volume|balance)/i;
  const rankedNumeric = numeric.map((column) => {
    const values = populatedValues(rows, column.name).map(Number).filter(Number.isFinite);
    const uniqueRatio = values.length ? new Set(values).size / values.length : 0;
    const mean = values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;
    let minimum = Infinity;
    let maximum = -Infinity;
    values.forEach((value) => {
      if (value < minimum) minimum = value;
      if (value > maximum) maximum = value;
    });
    const spread = values.length ? maximum - minimum : 0;
    const variation = mean ? Math.min(Math.abs(spread / mean), 5) : spread ? 1 : 0;
    return { column, score: (preferredMetric.test(column.name) ? 10 : 0) + variation + (uniqueRatio < .98 ? 1 : 0) };
  }).sort((a, b) => b.score - a.score);
  const requestedMetric = options && Object.prototype.hasOwnProperty.call(options, "primaryMetric") ? options.primaryMetric : undefined;
  const primary = requestedMetric === null ? undefined : requestedMetric && numeric.some((column) => column.name === requestedMetric) ? requestedMetric : rankedNumeric[0]?.column.name;
  const values = primary ? rows.map((r) => Number(r[primary])).filter(Number.isFinite) : [];
  const total = values.reduce((a, b) => a + b, 0);
  const avg = values.length ? total / values.length : 0;
  const first = values[0] || 0;
  const last = values.at(-1) || 0;
  const growth = first ? ((last - first) / Math.abs(first)) * 100 : 0;
  const mean = avg;
  const deviation = values.length ? Math.sqrt(values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length) : 0;
  const anomalies = values.filter((v) => deviation && Math.abs(v - mean) > deviation * 1.5).length;
  const categorical = columns.filter((column) => column.type === "text" && !isIdentifierColumn(column.name)).map((column) => {
    const values = populatedValues(rows, column.name).map(String);
    const counts = new Map<string, number>();
    values.forEach((value) => counts.set(value, (counts.get(value) || 0) + 1));
    const breakdown = Array.from(counts, ([name, count]) => ({ name, count, share: values.length ? count / values.length * 100 : 0 })).sort((a, b) => b.count - a.count).slice(0, 8);
    const semantic = /(status|state|result|outcome)/i.test(column.name) ? 15 : /(type|category|region|segment|channel|team|department|country|city|priority)/i.test(column.name) ? 10 : 0;
    const cardinalityScore = counts.size > 1 && counts.size <= Math.min(50, Math.max(10, rows.length * .25)) ? 5 - counts.size / Math.max(rows.length, 1) : -5;
    return { name: column.name, breakdown, unique: counts.size, score: semantic + cardinalityScore };
  }).sort((a, b) => b.score - a.score);
  const requestedDimension = options?.primaryDimension;
  const categoryProfile = requestedDimension ? categorical.find((profile) => profile.name === requestedDimension) ?? categorical[0] : categorical[0];
  const category = categoryProfile?.name;
  const categoryBreakdown = categoryProfile?.breakdown ?? [];
  const populatedCells = columns.reduce((count, column) => count + populatedValues(rows, column.name).length, 0);
  const totalCells = rows.length * columns.length;
  const completeness = totalCells ? populatedCells / totalCells * 100 : 0;
  const missingRows = rows.filter((row) => columns.some((column) => row[column.name] === null || row[column.name] === "" || row[column.name] === undefined)).length;
  const seenRows = new Set<string>();
  let duplicateRows = 0;
  rows.forEach((row) => { const signature = JSON.stringify(row); if (seenRows.has(signature)) duplicateRows += 1; else seenRows.add(signature); });
  const exceptions = Math.min(rows.length, anomalies + missingRows + duplicateRows);
  return { columns, allNumeric, numeric, primary, values, total, avg, growth, anomalies, category, categoryBreakdown, completeness, missingRows, duplicateRows, exceptions };
}

export function localAnalystAnswer(question: string, rows: DataRow[]) {
  const s = summarize(rows);
  const q = question.toLowerCase();
  const metric = s.primary || "record volume";
  const dominant = s.categoryBreakdown[0];
  if (q.includes("fraud") || q.includes("risk") || q.includes("anomal")) {
    return `I found ${s.exceptions.toLocaleString()} record-level exception${s.exceptions === 1 ? "" : "s"}: ${s.missingRows.toLocaleString()} rows with missing values, ${s.duplicateRows.toLocaleString()} duplicates, and ${s.anomalies.toLocaleString()} statistical outliers${s.primary ? ` in ${metric}` : ""}. Validate source context before escalation.`;
  }
  if (q.includes("visual") || q.includes("chart")) {
    return s.primary ? `Use a line chart for ${metric} over sequence and a ranked bar chart by ${s.category || "category"}. That combination shows direction and contribution without clutter.` : `Use a ranked bar chart of record count by ${s.category || "category"}${dominant ? `; ${dominant.name} currently represents ${dominant.share.toFixed(1)}%` : ""}. Add an exception table for missing and duplicate records.`;
  }
  if (q.includes("executive") || q.includes("summary") || q.includes("board")) {
    return s.primary ? `${metric} totals ${formatCompact(s.total)} across ${rows.length.toLocaleString()} records, with ${s.growth >= 0 ? "an upward" : "a downward"} endpoint movement of ${Math.abs(s.growth).toFixed(1)}%. Data completeness is ${s.completeness.toFixed(1)}%.` : `${rows.length.toLocaleString()} records span ${s.columns.length} fields with ${s.completeness.toFixed(1)}% completeness.${dominant ? ` ${dominant.name} is the largest ${s.category} group at ${dominant.share.toFixed(1)}%.` : ""} Review ${s.exceptions.toLocaleString()} record-level exceptions before making operational conclusions.`;
  }
  return s.primary ? `${metric} is the strongest non-identifier quantitative signal. Its average is ${formatCompact(s.avg)}, and endpoint movement is ${s.growth.toFixed(1)}%. Segment it by ${s.category || "the strongest categorical field"}, then investigate high-variance records.` : `This is an identifier-heavy dataset with ${rows.length.toLocaleString()} records and no reliable business measure. Start with counts by ${s.category || "a categorical field"}, completeness, duplicates, and status distribution instead of summing IDs.`;
}

export function formatCompact(value: number) {
  return new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value || 0);
}
