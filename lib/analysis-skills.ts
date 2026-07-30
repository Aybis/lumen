export const analysisSkills = [
  {
    id: "executive",
    name: "Executive summary",
    description: "Headline, evidence, and next action",
    prompt: "Create an executive summary of this dataset. Give me one headline, three evidence-backed insights, and one recommended action.",
    instruction: "Structure the answer as Headline, Key insights, and Recommended action. Prioritize material business impact over technical detail.",
  },
  {
    id: "trend",
    name: "Trend & drivers",
    description: "Direction, turning points, and likely drivers",
    prompt: "Analyze trends and drivers in this dataset. Identify direction, turning points, concentration, and what should be validated next.",
    instruction: "Focus on direction, turning points, possible drivers supported by the sample, concentration, and one validation question. Do not invent causality.",
  },
  {
    id: "anomaly",
    name: "Anomaly scan",
    description: "Outliers, quality issues, and investigation steps",
    prompt: "Scan this dataset for anomalies and data-quality risks. Rank the most important signals and explain how to investigate them safely.",
    instruction: "Rank anomaly and data-quality signals by importance. Distinguish statistical exceptions from evidence of wrongdoing and include safe investigation steps.",
  },
  {
    id: "visual",
    name: "Chart designer",
    description: "Best chart, fields, and visual narrative",
    prompt: "Design the best visual analysis for this dataset. Recommend a chart, fields, sorting, and the key message the chart should communicate.",
    instruction: "Recommend one primary chart from the allowed chart list, name the fields for each visual encoding, specify sorting or aggregation, and state the insight it should reveal.",
  },
] as const;

export type AnalysisSkillId = typeof analysisSkills[number]["id"];

export function getAnalysisSkill(id?: string) {
  return analysisSkills.find((skill) => skill.id === id) ?? analysisSkills[0];
}
