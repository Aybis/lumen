import { DataRow, getColumns, summarize } from "./analysis";
import { AnalysisSkillId } from "./analysis-skills";

export type AnalysisSuggestion = {
  id: string;
  title: string;
  description: string;
  prompt: string;
  skill: AnalysisSkillId;
};

export type DatasetIntelligence = {
  name: string;
  description: string;
  summary: string;
  primaryMetric: string | null;
  primaryDimension: string | null;
  timeField: string | null;
  suggestions: AnalysisSuggestion[];
  source: "schema" | "local" | "ai";
  generatedAt: string;
};

const validSkills = new Set<AnalysisSkillId>(["executive", "trend", "anomaly", "visual"]);

function field(columns: string[], pattern: RegExp) {
  return columns.find((name) => pattern.test(name)) ?? null;
}

function suggestion(title: string, description: string, prompt: string, skill: AnalysisSkillId): AnalysisSuggestion {
  return { id: `${skill}-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, title, description, prompt, skill };
}

function uploadedFormat(fileName: string) {
  return (fileName.split(".").pop() || "data").replace(/[^a-z0-9]/gi, "").toUpperCase() || "DATA";
}

function sourceAwareDescription(description: string, fileName: string) {
  const format = uploadedFormat(fileName);
  if (new RegExp(`uploaded\\s+${format}\\s+dataset`, "i").test(description)) return description;
  const detail = description.trim().replace(/^the\s+/i, "").replace(/\.$/, "");
  return `The uploaded ${format} dataset contains ${detail[0]?.toLowerCase() || ""}${detail.slice(1)}.`;
}

export function ensureDatasetSourceDescription(intelligence: DatasetIntelligence, fileName: string): DatasetIntelligence {
  return { ...intelligence, description: sourceAwareDescription(intelligence.description, fileName) };
}

export function inferDatasetIntelligence(rows: DataRow[], fileName: string): DatasetIntelligence {
  const columns = getColumns(rows);
  const names = columns.map((column) => column.name);
  const signature = names.join(" ").toLowerCase();
  const stats = summarize(rows);
  const status = field(names, /(^|[^a-z])(status|state|result|outcome)([^a-z]|$)/i);
  const category = status ?? field(names, /(type|category|region|segment|channel|team|department|priority)/i) ?? stats.category ?? null;
  const timeField = field(names, /(created|updated|sent|received|date|time|month|year|period)/i);
  const dominant = stats.categoryBreakdown[0];
  const base = { primaryDimension: category, timeField, source: "schema" as const, generatedAt: new Date().toISOString() };

  if (/(messageid|mediatype|mimetype|filename|mediaid|messagetype)/i.test(signature)) {
    const statusText = dominant && status ? `${dominant.name} represents ${dominant.share.toFixed(1)}% of populated ${status} values.` : "Status performance should be the first operational view.";
    return {
      ...base,
      name: "Media messaging operations",
      description: sourceAwareDescription("Delivery, media, and file-metadata records from a messaging workflow.", fileName),
      summary: `${rows.length.toLocaleString()} messaging-media records were identified. ${statusText} Focus first on delivery outcomes, media mix, and missing file metadata—not the sum of technical identifiers or file sizes.`,
      primaryMetric: null,
      suggestions: [
        suggestion("Delivery outcome review", "Compare completed, expired, failed, and pending records.", "Analyze delivery outcomes by status and message type. Quantify failure or expiry concentration and recommend the first validation step.", "executive"),
        suggestion("Media mix & storage", "Understand MIME types, attachment volume, and file-size distribution.", "Analyze the media and MIME-type mix. Describe file-size distribution without treating total bytes as a business KPI, and flag unusually large attachments.", "visual"),
        suggestion("Metadata quality scan", "Find missing filenames, MIME types, or inconsistent message metadata.", "Scan filename, MIME type, message type, and status fields for missing or inconsistent metadata. Rank the most important quality issues.", "anomaly"),
      ],
    };
  }

  if (/(ticket|case|incident|resolution|priority)/i.test(signature)) {
    const metric = field(names, /(resolution.*(hour|time)|response.*(hour|time)|duration)/i);
    return {
      ...base,
      name: "Service operations",
      description: sourceAwareDescription("Tickets or cases with priority, ownership, and resolution performance.", fileName),
      summary: `${rows.length.toLocaleString()} service records were identified.${dominant ? ` ${dominant.name} is the largest ${category} group at ${dominant.share.toFixed(1)}%.` : ""} Start with workload mix, resolution performance, and high-priority exceptions.`,
      primaryMetric: metric,
      suggestions: [
        suggestion("Resolution performance", "Compare resolution time across priority and team.", "Analyze resolution performance by priority and team. Identify the largest service gap and what should be validated next.", "trend"),
        suggestion("Priority workload", "Show where high-priority demand is concentrated.", "Compare ticket volume and resolution outcomes by priority. Recommend the clearest management chart.", "visual"),
        suggestion("SLA exception scan", "Find unusually slow or incomplete cases.", "Identify resolution-time outliers and incomplete cases. Rank them as investigation leads, not conclusions.", "anomaly"),
      ],
    };
  }

  if (/(revenue|sales|order|customer|amount|profit|margin)/i.test(signature)) {
    const metric = field(names, /(revenue|sales|amount|profit|margin|total|value)/i) ?? stats.primary ?? null;
    return {
      ...base,
      name: "Commercial performance",
      description: sourceAwareDescription("Sales, customer, order, or financial performance records.", fileName),
      summary: `${rows.length.toLocaleString()} commercial records were identified.${metric ? ` ${metric} is the strongest business measure.` : ""} Review performance direction, segment contribution, and material exceptions.`,
      primaryMetric: metric,
      suggestions: [
        suggestion("Performance drivers", "Explain movement and segment contribution.", "Analyze the main commercial metric over time and identify the segments contributing most to change.", "trend"),
        suggestion("Customer or segment mix", "Rank contribution without losing concentration context.", "Design a ranked contribution analysis by the strongest customer or segment field.", "visual"),
        suggestion("Commercial exceptions", "Find unusual values, missing amounts, or duplicate orders.", "Scan commercial records for unusual values, missing measures, and duplicates requiring validation.", "anomaly"),
      ],
    };
  }

  const primaryMetric = stats.primary ?? null;
  return {
    ...base,
    name: fileName.replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ").slice(0, 80) || "Dataset overview",
    description: sourceAwareDescription(`${rows.length.toLocaleString()} records across ${columns.length} detected fields.`, fileName),
    summary: primaryMetric
      ? `${primaryMetric} is the strongest non-identifier measure across ${rows.length.toLocaleString()} records. Use ${category || "the strongest category"} to explain contribution and validate ${stats.exceptions.toLocaleString()} quality or statistical exceptions.`
      : `${rows.length.toLocaleString()} records were identified without a reliable business measure. Start with record counts by ${category || "category"}, schema completeness, and exception review.`,
    primaryMetric,
    suggestions: [
      suggestion("Understand this dataset", "Clarify purpose, grain, measures, and dimensions.", "Explain what this dataset represents, its record grain, meaningful measures, useful dimensions, and important limitations.", "executive"),
      suggestion("Find the strongest pattern", "Identify concentration, direction, or meaningful differences.", "Find the strongest evidence-backed pattern in this dataset and explain why it matters.", "trend"),
      suggestion("Choose the best visual", "Recommend a chart grounded in the available fields.", "Recommend the most useful chart for this dataset, including fields, aggregation, sorting, and intended message.", "visual"),
    ],
  };
}

function cleanText(value: unknown, fallback: string, max: number) {
  return typeof value === "string" && value.trim() ? value.trim().slice(0, max) : fallback;
}

export function parseAIIntelligence(raw: string, rows: DataRow[], fileName: string): DatasetIntelligence {
  const fallback = inferDatasetIntelligence(rows, fileName);
  const cleaned = raw.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const parsed = JSON.parse(cleaned) as Record<string, unknown>;
  const columns = getColumns(rows);
  const numericNames = new Set(columns.filter((column) => column.type === "number").map((column) => column.name));
  const textNames = new Set(columns.filter((column) => column.type === "text").map((column) => column.name));
  const technical = /(id|uuid|guid|key|code|filesize|file_size|bytes|characters|wordcount|page|index|sequence)/i;
  const requestedMetric = typeof parsed.primaryMetric === "string" ? parsed.primaryMetric : null;
  const primaryMetric = requestedMetric && numericNames.has(requestedMetric) && !technical.test(requestedMetric) ? requestedMetric : fallback.primaryMetric;
  const requestedDimension = typeof parsed.primaryDimension === "string" ? parsed.primaryDimension : null;
  const primaryDimension = requestedDimension && textNames.has(requestedDimension) ? requestedDimension : fallback.primaryDimension;
  const requestedTime = typeof parsed.timeField === "string" ? parsed.timeField : null;
  const timeField = requestedTime && columns.some((column) => column.name === requestedTime) ? requestedTime : fallback.timeField;
  const suppliedSuggestions = Array.isArray(parsed.suggestions) ? parsed.suggestions : [];
  const suggestions = suppliedSuggestions.slice(0, 3).map((entry, index) => {
    const item = typeof entry === "object" && entry ? entry as Record<string, unknown> : {};
    const skill = validSkills.has(item.skill as AnalysisSkillId) ? item.skill as AnalysisSkillId : fallback.suggestions[index]?.skill ?? "executive";
    const title = cleanText(item.title, fallback.suggestions[index]?.title ?? "Suggested analysis", 70);
    return suggestion(title, cleanText(item.description, fallback.suggestions[index]?.description ?? "Explore this dataset.", 150), cleanText(item.prompt, fallback.suggestions[index]?.prompt ?? "Analyze this dataset.", 300), skill);
  });
  return {
    name: cleanText(parsed.name, fallback.name, 80),
    description: sourceAwareDescription(cleanText(parsed.description, fallback.description, 180), fileName),
    summary: cleanText(parsed.summary, fallback.summary, 500),
    primaryMetric,
    primaryDimension,
    timeField,
    suggestions: suggestions.length === 3 ? suggestions : fallback.suggestions,
    source: "ai",
    generatedAt: new Date().toISOString(),
  };
}
