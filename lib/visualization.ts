import type { DataRow } from "./analysis";
import { getColumns, summarize } from "./analysis";
import type { DatasetIntelligence } from "./dataset-intelligence";

export type VisualizationType = "bar" | "line" | "area" | "pie" | "donut";
export type VisualizationAggregation = "count" | "sum" | "average";

export type VisualizationSpec = {
  type: VisualizationType;
  title: string;
  subtitle: string;
  xField: string;
  yField: string | null;
  aggregation: VisualizationAggregation;
  source: "auto" | "ai";
  updatedAt: string;
};

export type VisualizationDatum = {
  name: string;
  value: number;
  records: number;
};

const technicalMeasure = /(filesize|file_size|bytes|characters|wordcount|word_count|page|index|sequence|timestamp)/i;

function chartLabel(type: VisualizationType) {
  return type === "donut" ? "Donut" : type[0].toUpperCase() + type.slice(1);
}

function titleFor(type: VisualizationType, xField: string, yField: string | null, aggregation: VisualizationAggregation) {
  const measure = aggregation === "count" || !yField ? "Records" : aggregation === "average" ? `Average ${yField}` : yField;
  return `${measure} by ${xField}`;
}

function subtitleFor(type: VisualizationType, aggregation: VisualizationAggregation, xField: string) {
  return `${chartLabel(type)} chart · ${aggregation === "count" ? "record count" : aggregation} grouped by ${xField}`;
}

export function inferVisualization(rows: DataRow[], intelligence?: DatasetIntelligence | null): VisualizationSpec {
  const columns = getColumns(rows);
  const profile = summarize(rows, { primaryMetric: intelligence?.primaryMetric, primaryDimension: intelligence?.primaryDimension });
  const textColumns = columns.filter((column) => column.type === "text");
  const dimension = intelligence?.timeField || intelligence?.primaryDimension || profile.category || textColumns[0]?.name || columns[0]?.name || "Records";
  const metric = intelligence?.primaryMetric && !technicalMeasure.test(intelligence.primaryMetric) ? intelligence.primaryMetric : profile.primary || null;
  const type: VisualizationType = intelligence?.timeField && dimension === intelligence.timeField ? "line" : "bar";
  const aggregation: VisualizationAggregation = metric ? "sum" : "count";
  return {
    type,
    title: titleFor(type, dimension, metric, aggregation),
    subtitle: subtitleFor(type, aggregation, dimension),
    xField: dimension,
    yField: metric,
    aggregation,
    source: "auto",
    updatedAt: new Date().toISOString(),
  };
}

function requestedType(prompt: string): VisualizationType | null {
  if (/\b(donut|doughnut)\b/i.test(prompt)) return "donut";
  if (/\bpie\b/i.test(prompt)) return "pie";
  if (/\barea\b/i.test(prompt)) return "area";
  if (/\bline\b/i.test(prompt)) return "line";
  if (/\bbar\b/i.test(prompt)) return "bar";
  return null;
}

function semanticDimension(prompt: string, columns: ReturnType<typeof getColumns>) {
  const aliases = [
    { prompt: /\b(media\s*type|type\s*media|mime\s*type|mimetype|file\s*type|format)\b/i, field: /(mime.?type|media.?type|file.?type|format)/i },
    { prompt: /\b(message\s*type|type\s*message)\b/i, field: /message.?type/i },
    { prompt: /\b(status|outcome|result)\b/i, field: /(status|outcome|result)/i },
    { prompt: /\b(file\s*name|filename)\b/i, field: /file.?name/i },
    { prompt: /\b(region|area|location)\b/i, field: /(region|area|location)/i },
    { prompt: /\b(category|segment|channel|priority|team|department)\b/i, field: /(category|segment|channel|priority|team|department)/i },
  ];
  for (const alias of aliases) {
    if (alias.prompt.test(prompt)) {
      const match = columns.find((column) => column.type === "text" && alias.field.test(column.name));
      if (match) return match.name;
    }
  }
  return null;
}

export function visualizationFromPrompt(prompt: string, rows: DataRow[], intelligence?: DatasetIntelligence | null, current?: VisualizationSpec | null): VisualizationSpec | null {
  if (!/\b(chart|graph|visual|visualize|plot|dashboard|bar|line|area|pie|donut|doughnut)\b/i.test(prompt)) return null;
  const columns = getColumns(rows);
  const normalizedPrompt = prompt.toLowerCase();
  const mentioned = [...columns].sort((a, b) => b.name.length - a.name.length).filter((column) => column.name.length > 2 && normalizedPrompt.includes(column.name.toLowerCase()));
  const mentionedDimension = mentioned.find((column) => column.type === "text")?.name || semanticDimension(prompt, columns);
  const mentionedMetric = mentioned.find((column) => column.type === "number" && !technicalMeasure.test(column.name))?.name;
  const fallback = current || inferVisualization(rows, intelligence);
  const type = requestedType(prompt) || fallback.type;
  const xField = mentionedDimension || (mentioned.some((column) => column.name === intelligence?.timeField) ? intelligence?.timeField : null) || fallback.xField;
  const yField = mentionedMetric || fallback.yField;
  const aggregation: VisualizationAggregation = /\b(avg|average|mean)\b/i.test(prompt) ? "average" : /\b(sum|total)\b/i.test(prompt) && yField ? "sum" : /\b(count|number of|how many)\b/i.test(prompt) ? "count" : yField ? fallback.aggregation === "count" ? "sum" : fallback.aggregation : "count";
  return {
    type,
    title: titleFor(type, xField, yField, aggregation),
    subtitle: subtitleFor(type, aggregation, xField),
    xField,
    yField: aggregation === "count" ? null : yField,
    aggregation,
    source: "ai",
    updatedAt: new Date().toISOString(),
  };
}

export function buildVisualizationData(rows: DataRow[], spec: VisualizationSpec): VisualizationDatum[] {
  const groups = new Map<string, { records: number; total: number; numeric: number }>();
  rows.forEach((row) => {
    const rawName = row[spec.xField];
    const name = rawName === null || rawName === undefined || rawName === "" ? "Missing" : String(rawName);
    const current = groups.get(name) || { records: 0, total: 0, numeric: 0 };
    current.records += 1;
    if (spec.yField) {
      const value = Number(row[spec.yField]);
      if (Number.isFinite(value)) {
        current.total += value;
        current.numeric += 1;
      }
    }
    groups.set(name, current);
  });
  let data = Array.from(groups, ([name, group]) => ({
    name: name.slice(0, 28),
    records: group.records,
    value: spec.aggregation === "count" ? group.records : spec.aggregation === "average" ? group.numeric ? group.total / group.numeric : 0 : group.total,
  }));
  const isSequence = spec.type === "line" || spec.type === "area";
  data.sort((a, b) => isSequence ? a.name.localeCompare(b.name, undefined, { numeric: true }) : b.value - a.value);
  const limit = isSequence ? 30 : 12;
  if (data.length > limit && !isSequence) {
    const kept = data.slice(0, limit - 1);
    const rest = data.slice(limit - 1).reduce((total, item) => ({ name: "Other", value: total.value + item.value, records: total.records + item.records }), { name: "Other", value: 0, records: 0 });
    data = [...kept, rest];
  } else data = data.slice(0, limit);
  return data;
}

export function visualizationInsight(data: VisualizationDatum[], spec: VisualizationSpec) {
  const total = data.reduce((sum, item) => sum + item.value, 0);
  const leader = [...data].sort((a, b) => b.value - a.value)[0];
  if (!leader || !total) return `No populated values were found for ${spec.xField}.`;
  const share = leader.value / total * 100;
  return `${leader.name} is the largest visible group at ${share.toFixed(1)}% of ${spec.aggregation === "count" ? "records" : spec.yField || "the selected measure"}.`;
}
