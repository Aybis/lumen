"use client";

import { create } from "zustand";
import { DataRow, sampleData } from "./analysis";

export type ChatMessage = { id: string; role: "user" | "assistant"; content: string };

type WorkspaceState = {
  rows: DataRow[];
  fileName: string;
  activeView: "overview" | "risk" | "data";
  aiOpen: boolean;
  messages: ChatMessage[];
  setDataset: (rows: DataRow[], fileName: string) => void;
  setActiveView: (view: WorkspaceState["activeView"]) => void;
  setAiOpen: (open: boolean) => void;
  addMessage: (message: ChatMessage) => void;
};

export const useWorkspace = create<WorkspaceState>((set) => ({
  rows: sampleData,
  fileName: "Northstar_FY25.xlsx",
  activeView: "overview",
  aiOpen: true,
  messages: [{ id: "welcome", role: "assistant", content: "I’ve reviewed the dataset. Revenue is accelerating, but risk concentration rose in Q3. Ask me to explain a driver, detect anomalies, or reframe this for leadership." }],
  setDataset: (rows, fileName) => set({ rows, fileName, messages: [{ id: crypto.randomUUID(), role: "assistant", content: `Analysis complete. I profiled ${rows.length.toLocaleString()} records from ${fileName}. Ask for an executive summary, anomaly scan, or the best visual story.` }] }),
  setActiveView: (activeView) => set({ activeView }),
  setAiOpen: (aiOpen) => set({ aiOpen }),
  addMessage: (message) => set((state) => ({ messages: [...state.messages, message] })),
}));
