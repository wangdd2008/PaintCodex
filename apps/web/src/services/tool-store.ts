import { create } from 'zustand';

export type Tool = 'brush' | 'select';

interface ToolState {
  tool: Tool;
  setTool: (tool: Tool) => void;
}

export const useToolStore = create<ToolState>((set) => ({
  tool: 'brush',
  setTool: (tool) => set({ tool }),
}));
