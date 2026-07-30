"use client";

import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { DataRow, getColumns } from "./analysis";
import { AnalysisSkillId } from "./analysis-skills";
import { DatasetIntelligence, ensureDatasetSourceDescription, inferDatasetIntelligence } from "./dataset-intelligence";
import { inferVisualization, VisualizationSpec } from "./visualization";
import {
  DatasetSession,
  getDatasetSession,
  listDatasetSessions,
  putDatasetSession,
  removeDatasetSession,
  SessionSummary,
  StoredChatMessage,
} from "./session-storage";

export type View = "analysis" | "overview" | "risk" | "data" | "history" | "settings";
export type ChatMessage = StoredChatMessage;
export type ModelConfig = { id: string; name: string };
export type ProviderConfig = {
  id: string;
  name: string;
  kind: "openai" | "openrouter" | "anthropic" | "ollama" | "custom";
  baseUrl: string;
  apiKey: string;
  enabled: boolean;
  models: ModelConfig[];
};

export const chartOptions = [
  "Bar · 2D vertical", "Bar · 2D horizontal", "Bar · 3D", "Doughnut", "Pie · 2D",
  "Pie · 3D", "Line", "Area", "Scatter", "Sankey", "Radar", "Treemap", "Funnel", "Heatmap",
] as const;

const ollamaProvider: ProviderConfig = {
  id: "ollama",
  name: "Ollama (local)",
  kind: "ollama",
  baseUrl: "http://localhost:11434",
  apiKey: "",
  enabled: true,
  models: [
    { id: "qwen3:8b", name: "Qwen 3 8B · low memory" },
    { id: "gemma4:e4b-mlx", name: "Gemma 4 E4B MLX" },
    { id: "gemma4:e4b", name: "Gemma 4 E4B" },
  ],
};

export const defaultProviders: ProviderConfig[] = [
  ollamaProvider,
  { id: "openrouter", name: "OpenRouter", kind: "openrouter", baseUrl: "https://openrouter.ai/api/v1", apiKey: "", enabled: true, models: [{ id: "openai/gpt-4.1-mini", name: "GPT-4.1 mini" }, { id: "anthropic/claude-3.7-sonnet", name: "Claude 3.7 Sonnet" }] },
  { id: "openai", name: "OpenAI", kind: "openai", baseUrl: "https://api.openai.com/v1", apiKey: "", enabled: true, models: [{ id: "gpt-4.1-mini", name: "GPT-4.1 mini" }, { id: "gpt-4.1", name: "GPT-4.1" }] },
  { id: "anthropic", name: "Anthropic", kind: "anthropic", baseUrl: "https://api.anthropic.com/v1", apiKey: "", enabled: true, models: [{ id: "claude-3-7-sonnet-latest", name: "Claude 3.7 Sonnet" }, { id: "claude-3-5-haiku-latest", name: "Claude 3.5 Haiku" }] },
];

type WorkspaceState = {
  ownerId: string | null;
  activeSessionId: string | null;
  sessions: SessionSummary[];
  sessionsReady: boolean;
  rows: DataRow[];
  fileName: string;
  activeView: View;
  aiOpen: boolean;
  messages: ChatMessage[];
  providers: ProviderConfig[];
  defaultProviderId: string;
  defaultModelId: string;
  activeAnalysisSkill: AnalysisSkillId;
  intelligence: DatasetIntelligence | null;
  visualization: VisualizationSpec | null;
  visualizations: VisualizationSpec[];
  enabledCharts: string[];
  initializeSessions: (ownerId: string) => Promise<void>;
  setDataset: (rows: DataRow[], fileName: string) => Promise<string>;
  setSessionIntelligence: (id: string, intelligence: DatasetIntelligence) => void;
  setVisualization: (visualization: VisualizationSpec) => void;
  addVisualization: (visualization: VisualizationSpec) => void;
  removeVisualization: (updatedAt: string) => void;
  openSession: (id: string) => Promise<void>;
  deleteSession: (id: string) => Promise<void>;
  leaveSession: () => void;
  setActiveView: (view: View) => void;
  setAiOpen: (open: boolean) => void;
  addMessage: (message: ChatMessage, sessionId?: string | null) => void;
  clearMessages: () => void;
  setProviders: (providers: ProviderConfig[]) => void;
  setDefaultModel: (providerId: string, modelId: string) => void;
  setActiveAnalysisSkill: (skill: AnalysisSkillId) => void;
  setEnabledCharts: (charts: string[]) => void;
};

function welcomeMessage(rows: DataRow[], fileName: string, intelligence?: DatasetIntelligence): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: intelligence ? intelligenceMessage(fileName, intelligence) : `## Dataset ready\n\nThis discussion is scoped only to **${fileName}**. I profiled **${rows.length.toLocaleString()} records** and will not use context from another dataset session.`,
    createdAt: new Date().toISOString(),
    model: "Local analyst",
  };
}

function intelligenceMessage(fileName: string, intelligence: DatasetIntelligence) {
  const suggestions = intelligence.suggestions.slice(0, 3).map((item) => `- **${item.title}:** ${item.description}`).join("\n");
  return `## Dataset understood\n\n**${intelligence.name}**  \n${intelligence.description}\n\n${intelligence.summary}\n\n### Suggested starting points\n\n${suggestions}\n\n_This analysis is scoped only to ${fileName}._`;
}

function toSummary(session: DatasetSession): SessionSummary {
  const { storageKey: _storageKey, rows: _rows, messages, intelligence: _intelligence, visualization: _visualization, visualizations: _visualizations, ...rest } = session;
  return { ...rest, messageCount: messages.length };
}

function buildActiveSession(state: WorkspaceState, updatedAt = new Date().toISOString()): DatasetSession | null {
  if (!state.ownerId || !state.activeSessionId || !state.fileName || !state.rows.length) return null;
  const previous = state.sessions.find((session) => session.id === state.activeSessionId);
  return {
    storageKey: `${state.ownerId}:${state.activeSessionId}`,
    id: state.activeSessionId,
    ownerId: state.ownerId,
    fileName: state.fileName,
    rows: state.rows,
    rowCount: state.rows.length,
    fieldCount: getColumns(state.rows).length,
    messages: state.messages,
    activeAnalysisSkill: state.activeAnalysisSkill,
    intelligence: state.intelligence ?? undefined,
    visualization: state.visualization ?? undefined,
    visualizations: state.visualizations ?? [],
    createdAt: previous?.createdAt ?? updatedAt,
    updatedAt,
  };
}

const sessionWriteQueues = new Map<string, Promise<void>>();

function queueSessionWrite(storageKey: string, task: () => Promise<void>): Promise<void> {
  const previous = sessionWriteQueues.get(storageKey) ?? Promise.resolve();
  const next = previous.catch(() => undefined).then(task);
  sessionWriteQueues.set(storageKey, next);
  void next.finally(() => { if (sessionWriteQueues.get(storageKey) === next) sessionWriteQueues.delete(storageKey); }).catch(() => undefined);
  return next;
}

function saveActiveSession(get: () => WorkspaceState, set: (patch: Partial<WorkspaceState>) => void) {
  const session = buildActiveSession(get());
  if (!session) return;
  set({ sessions: [toSummary(session), ...get().sessions.filter((item) => item.id !== session.id)] });
  void queueSessionWrite(session.storageKey, () => putDatasetSession(session)).catch(() => undefined);
}

export const useWorkspace = create<WorkspaceState>()(persist((set, get) => ({
  ownerId: null,
  activeSessionId: null,
  sessions: [],
  sessionsReady: false,
  rows: [],
  fileName: "",
  activeView: "analysis",
  aiOpen: false,
  messages: [],
  providers: defaultProviders,
  defaultProviderId: "ollama",
  defaultModelId: "qwen3:8b",
  activeAnalysisSkill: "executive",
  intelligence: null,
  visualization: null,
  visualizations: [],
  enabledCharts: [...chartOptions],
  initializeSessions: async (ownerId) => {
    set({ ownerId, activeSessionId: null, rows: [], fileName: "", messages: [], intelligence: null, visualization: null, visualizations: [], aiOpen: false, sessions: [], sessionsReady: false });
    try {
      const sessions = await listDatasetSessions(ownerId);
      if (get().ownerId === ownerId) set({ sessions, sessionsReady: true });
    } catch {
      if (get().ownerId === ownerId) set({ sessions: [], sessionsReady: true });
    }
  },
  setDataset: async (rows, fileName) => {
    const ownerId = get().ownerId;
    if (!ownerId) throw new Error("Your account session is not ready yet.");
    const id = crypto.randomUUID();
    const createdAt = new Date().toISOString();
    const intelligence = inferDatasetIntelligence(rows, fileName);
    const visualization = inferVisualization(rows, intelligence);
    const session: DatasetSession = {
      storageKey: `${ownerId}:${id}`,
      id,
      ownerId,
      fileName,
      rows,
      rowCount: rows.length,
      fieldCount: getColumns(rows).length,
      messages: [welcomeMessage(rows, fileName, intelligence)],
      activeAnalysisSkill: "executive",
      intelligence,
      visualization,
      visualizations: [],
      createdAt,
      updatedAt: createdAt,
    };
    await queueSessionWrite(session.storageKey, () => putDatasetSession(session));
    set((state) => ({
      activeSessionId: id,
      rows,
      fileName,
      messages: session.messages,
      activeAnalysisSkill: session.activeAnalysisSkill,
      intelligence,
      visualization,
      visualizations: session.visualizations ?? [],
      sessions: [toSummary(session), ...state.sessions.filter((item) => item.id !== id)],
      activeView: "analysis",
      aiOpen: true,
    }));
    return id;
  },
  openSession: async (id) => {
    const ownerId = get().ownerId;
    if (!ownerId) throw new Error("Your account session is not ready yet.");
    const session = await getDatasetSession(ownerId, id);
    if (!session) throw new Error("That dataset session is no longer available.");
    const intelligence = ensureDatasetSourceDescription(session.intelligence ?? inferDatasetIntelligence(session.rows, session.fileName), session.fileName);
    const visualization = session.visualization ?? inferVisualization(session.rows, intelligence);
    const visualizations = session.visualizations ?? [];
    set({
      activeSessionId: session.id,
      rows: session.rows,
      fileName: session.fileName,
      messages: session.messages,
      activeAnalysisSkill: session.activeAnalysisSkill,
      intelligence,
      visualization,
      visualizations,
      activeView: "analysis",
      aiOpen: true,
    });
  },
  setSessionIntelligence: (id, intelligence) => {
    const state = get();
    const ownerId = state.ownerId;
    if (!ownerId) return;
    intelligence = ensureDatasetSourceDescription(intelligence, state.activeSessionId === id ? state.fileName : get().sessions.find((session) => session.id === id)?.fileName || "dataset");
    const storageKey = `${ownerId}:${id}`;
    if (state.activeSessionId === id) {
      const messages = state.messages.length ? state.messages.map((message, index) => index === 0 && message.role === "assistant" ? { ...message, content: intelligenceMessage(state.fileName, intelligence) } : message) : state.messages;
      const visualization = state.visualization?.source === "ai" ? state.visualization : inferVisualization(state.rows, intelligence);
      set({ intelligence, messages, visualization });
      saveActiveSession(get, set);
      return;
    }
    void queueSessionWrite(storageKey, async () => {
      const session = await getDatasetSession(ownerId, id);
      if (!session) return;
      const messages = session.messages.map((message, index) => index === 0 && message.role === "assistant" ? { ...message, content: intelligenceMessage(session.fileName, intelligence) } : message);
      const visualization = session.visualization?.source === "ai" ? session.visualization : inferVisualization(session.rows, intelligence);
      const updated: DatasetSession = { ...session, intelligence, visualization, messages, updatedAt: new Date().toISOString() };
      await putDatasetSession(updated);
      if (get().ownerId === ownerId) set({ sessions: [toSummary(updated), ...get().sessions.filter((item) => item.id !== updated.id)] });
    }).catch(() => undefined);
  },
  setVisualization: (visualization) => {
    set((state) => ({
      visualization,
      visualizations: state.visualization ? (state.visualizations ?? []).map((item) => item.updatedAt === state.visualization?.updatedAt ? visualization : item) : state.visualizations ?? [],
      aiOpen: true,
    }));
    saveActiveSession(get, set);
  },
  addVisualization: (visualization) => {
    set((state) => ({ visualization, visualizations: [...(state.visualizations ?? []), visualization], aiOpen: true }));
    saveActiveSession(get, set);
  },
  removeVisualization: (updatedAt) => {
    set((state) => ({ visualizations: (state.visualizations ?? []).filter((item) => item.updatedAt !== updatedAt) }));
    saveActiveSession(get, set);
  },
  deleteSession: async (id) => {
    const ownerId = get().ownerId;
    if (!ownerId) return;
    await removeDatasetSession(ownerId, id);
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== id),
      ...(state.activeSessionId === id ? { activeSessionId: null, rows: [], fileName: "", messages: [], intelligence: null, visualization: null, visualizations: [], aiOpen: false, activeView: "overview" as View } : {}),
    }));
  },
  leaveSession: () => set({ activeSessionId: null, rows: [], fileName: "", messages: [], intelligence: null, visualization: null, visualizations: [], aiOpen: false, activeView: "overview" }),
  setActiveView: (activeView) => set((state) => ({ activeView, aiOpen: activeView === "analysis" ? true : activeView === "history" || activeView === "settings" ? false : state.aiOpen })),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  addMessage: (message, requestedSessionId) => {
    const targetSessionId = requestedSessionId ?? get().activeSessionId;
    const { activeSessionId, ownerId } = get();
    if (!targetSessionId || !ownerId) return;
    if (targetSessionId === activeSessionId) {
      set((state) => ({ messages: [...state.messages, message] }));
      saveActiveSession(get, set);
      return;
    }
    const storageKey = `${ownerId}:${targetSessionId}`;
    void queueSessionWrite(storageKey, async () => {
      const session = await getDatasetSession(ownerId, targetSessionId);
      if (!session) return;
      const updated: DatasetSession = { ...session, messages: [...session.messages, message], updatedAt: new Date().toISOString() };
      await putDatasetSession(updated);
      if (get().ownerId === ownerId) set({ sessions: [toSummary(updated), ...get().sessions.filter((item) => item.id !== updated.id)] });
    }).catch(() => undefined);
  },
  clearMessages: () => {
    const { rows, fileName, intelligence } = get();
    set({ messages: rows.length && fileName ? [welcomeMessage(rows, fileName, intelligence ?? undefined)] : [] });
    saveActiveSession(get, set);
  },
  setProviders: (providers) => set({ providers }),
  setDefaultModel: (defaultProviderId, defaultModelId) => set({ defaultProviderId, defaultModelId }),
  setActiveAnalysisSkill: (activeAnalysisSkill) => {
    set({ activeAnalysisSkill });
    saveActiveSession(get, set);
  },
  setEnabledCharts: (enabledCharts) => set({ enabledCharts }),
}), {
  name: "lumen-workspace-v2",
  version: 2,
  storage: createJSONStorage(() => localStorage),
  migrate: (persistedState) => {
    const state = persistedState as Partial<WorkspaceState>;
    const providers = [ollamaProvider, ...(state.providers ?? defaultProviders).filter((provider) => provider.id !== ollamaProvider.id)];
    return {
      providers,
      defaultProviderId: state.defaultProviderId || ollamaProvider.id,
      defaultModelId: state.defaultModelId || ollamaProvider.models[0].id,
      activeAnalysisSkill: state.activeAnalysisSkill || "executive",
      enabledCharts: state.enabledCharts || [...chartOptions],
    } as WorkspaceState;
  },
  partialize: (state) => ({
    providers: state.providers,
    defaultProviderId: state.defaultProviderId,
    defaultModelId: state.defaultModelId,
    enabledCharts: state.enabledCharts,
  }),
}));
