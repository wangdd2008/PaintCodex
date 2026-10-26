import { create } from 'zustand';

export type Tool = 'brush' | 'select';

export interface BrushColorPreset {
  value: string;
  label: string;
}

/** 默认颜色与宽度来自 spec §10：黑、宽 6（1264×625 视口下屏幕笔宽约 2.7px）。 */
export const DEFAULT_BRUSH_COLOR = '#111111';
export const DEFAULT_BRUSH_WIDTH = 6;

/** 常用色板；自定义颜色走 <input type="color">。 */
export const BRUSH_COLOR_PRESETS: readonly BrushColorPreset[] = [
  { value: '#111111', label: '黑色' },
  { value: '#4b5563', label: '深灰色' },
  { value: '#dc2626', label: '红色' },
  { value: '#ea580c', label: '橙色' },
  { value: '#2563eb', label: '蓝色' },
  { value: '#16a34a', label: '绿色' },
];

/** 四档笔宽；默认宽度 6 不在档位里，由 spec 指定。 */
export const BRUSH_WIDTHS = [2, 4, 8, 16] as const;

interface ToolState {
  tool: Tool;
  brushColor: string;
  brushWidth: number;
  setTool: (tool: Tool) => void;
  setBrushColor: (color: string) => void;
  setBrushWidth: (width: number) => void;
}

/**
 * 画笔设置只存在内存里：刷新页面回到默认，持久化明确不在本轮范围内。
 */
export const useToolStore = create<ToolState>((set) => ({
  tool: 'brush',
  brushColor: DEFAULT_BRUSH_COLOR,
  brushWidth: DEFAULT_BRUSH_WIDTH,
  setTool: (tool) => set({ tool }),
  setBrushColor: (color) => set({ brushColor: color }),
  setBrushWidth: (width) => set({ brushWidth: width }),
}));
