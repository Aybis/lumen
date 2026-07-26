"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DataRow, sampleData } from "./analysis";

export type View = "overview" | "risk" | "data" | "history" | "settings";
export type ChatMessage = { id: string; role: "user" | "assistant"; content: string; createdAt: string; model?: string };
export type ModelConfig = { id: string; name: string };
export type ProviderConfig = {
  id: string;
  name: string;
  kind: "openai" | "openrouter" | "anthropic" | "custom";
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: ModelConfig[];
};
export type HistoryItem = { id: string; fileName: string; rows: DataRow[]; rowCount: number; createdAt: string };

export const chartOptions = [
  "Bar · 2D vertical", "Bar · 2D horizontal", "Bar · 3D", "Doughnut", "Pie · 2D",
  "Pie · 3D", "Line", "Area", "Scatter", "Sankey", "Radar", "Treemap", "Funnel", "Heatmap",
] as const;

const now = new Date().toISOString();
const initialMessages: ChatMessage[] = [{
  id: "welcome",
  role: "assistant",
  content: "I’ve reviewed the dataset. Revenue is accelerating, but risk concentration rose in Q3. Ask me to explain a driver, detect anomalies, or reframe this for leadership.",
  createdAt: now,
  model: "Local analyst",
}];

export const defaultProviders: ProviderConfig[] = [
  { id: "openrouter", name: "OpenRouter", kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabled: true, models: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini" }, { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" }] },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", enabled: true, models: [{ id: "gpt-4.1-mini", name: "GPT-4.1 mini" }, { id: "gpt-4.1", name: "GPT-4.1" }] },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "", enabled: true, models: [{ id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" }, { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" }] },
];

type WorkspaceState = {
  rows: DataRow[];
  fileName: string;
  activeView: View;
  aiOpen: boolean;
  messages: ChatMessage[];
  providers: ProviderConfig[];
  defaultProviderId: string;
  defaultModelId: string;
  enabledCharts: string[];
  history: HistoryItem[];
  setDataset: (rows: DataRow[], fileName: string, saveCurrent?: boolean) => void;
  restoreHistory: (id: string) => void;
  deleteHistory: (id: string) => void;
  setActiveView: (view: View) => void;
  setAiOpen: (open: boolean) => void;
  addMessage: (message: ChatMessage) => void;
  clearMessages: () => void;
  setProviders: (providers: ProviderConfig[]) => void;
  setDefaultModel: (providerId: string, modelId: string) => void;
  setEnabledCharts: (charts: string[]) => void;
};

function compactRows(rows: DataRow[]) {
  return rows.slice(0, 500).map((row) => Object.fromEntries(Object.entries(row).slice(0, 40).map(([key, value]) => [key, typeof value === "string" ? value.slice(0, 300) : value])));
}

export const useWorkspace = create<WorkspaceState>()(persist((set, get) => ({
  rows: sampleData,
  fileName: "Northstar_FY25.xlsx",
  activeView: "overview",
  aiOpen: true,
  messages: initialMessages,
  providers: defaultProviders,
  defaultProviderId: "openrouter",
  defaultModelId: "openai/gpt-4.1-mini",
  enabledCharts: [...chartOptions],
  history: [],
  setDataset: (rows, fileName, saveCurrent = true) => set((state) => {
    const history = saveCurrent ? [{ id: crypto.randomUUID(), fileName: state.fileName, rows: compactRows(state.rows), rowCount: state.rows.length, createdAt: new Date().toISOString() }, ...state.history].slice(0, 12) : state.history;
    return {
      rows,
      fileName,
      history,
      activeView: "overview",
      messages: [{ id: crypto.randomUUID(), role: "assistant", content: `Analysis complete. I profiled ${rows.length.toLocaleString()} records from ${fileName}. Ask for an executive summary, anomaly scan, or the best visual story.`, createdAt: new Date().toISOString(), model: "Local analyst" }],
    };
  }),
  restoreHistory: (id) => {
    const item = get().history.find((entry) => entry.id === id);
    if (item) get().setDataset(item.rows, item.fileName);
  },
  deleteHistory: (id) => set((state) => ({ history: state.history.filter((entry) => entry.id !== id) })),
  setActiveView: (activeView) => set({ activeView }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
  clearMessages: () => set({ messages: initialMessages.map((message) => ({ ...message, id: crypto.randomUUID(), createdAt: new Date().toISOString() })) }),
  setProviders: (providers) => set({ providers }),
  setDefaultModel: (defaultProviderId, defaultModelId) => set({ defaultProviderId, defaultModelId }),
  setEnabledCharts: (enabledCharts) => set({ enabledCharts }),
}), {
  name: "lumen-workspace-v2",
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    providers: state.providers,
    defaultProviderId: state.defaultProviderId,
    defaultModelId: state.defaultModelId,
    enabledCharts: state.enabledCharts,
    history: state.history,
    messages: state.messages.slice(-50),
  }),
}));
