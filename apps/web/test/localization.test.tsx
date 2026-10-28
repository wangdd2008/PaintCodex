// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  AgentLog,
  CanvasDocument,
  CreateLayerInput,
  Layer,
  MonitorStats,
} from '@paintcodex/protocol';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CanvasNameEditor } from '../src/features/canvas/CanvasNameEditor';
import { CanvasStage } from '../src/features/canvas/CanvasStage';
import { LayerPanel } from '../src/features/layer-panel/LayerPanel';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { MonitorPage } from '../src/features/monitor/MonitorPage';
import { useCanvasStore } from '../src/services/canvas-store';
import { displayCanvasName, nextStrokeLayerName } from '../src/services/naming';
import { useToolStore } from '../src/services/tool-store';

const testDir = dirname(fileURLToPath(import.meta.url));

/**
 * jsdom 没有 2D context，Fabric 只能用替身。这里只需要 CanvasStage 用到的
 * 事件注册、对象装载与 `path:created` 载荷，真实绘制由浏览器人工复核。
 */
const fabricDouble = vi.hoisted(() => {
  type Handler = (event: unknown) => void;

  class FakeCanvas {
    static instances: FakeCanvas[] = [];

    isDrawingMode = false;
    selection = false;
    freeDrawingBrush: { color: string; width: number } | null = null;
    handlers = new Map<string, Handler>();

    constructor() {
      FakeCanvas.instances.push(this);
    }

    on(name: string, handler: Handler): void {
      this.handlers.set(name, handler);
    }

    off(name: string): void {
      this.handlers.delete(name);
    }

    add(): void {}

    remove(): void {}

    discardActiveObject(): void {}

    requestRenderAll(): void {}

    setDimensions() {}
    setViewportTransform() {}
    zoomToPoint() {}
    relativePan() {}

    async dispose(): Promise<void> {}
  }

  return {
    FakeCanvas,
    enlivenObjects: async (values: unknown[]) =>
      values.map(() => ({ set(): void {}, toSVG: (): string => '' })),
  };
});

vi.mock('fabric', () => ({
  Canvas: fabricDouble.FakeCanvas,
  PencilBrush: class {
    color = '#111111';
    width = 6;
  },
  loadSVGFromString: vi.fn(),
  util: {
    enlivenObjects: fabricDouble.enlivenObjects,
    groupSVGElements: vi.fn(),
  },
}));

/** MonitorPage 会订阅 `/monitor/events`；jsdom 没有 EventSource。 */
class FakeEventSource {
  static instances: FakeEventSource[] = [];

  onopen: (() => void) | null = null;
  onerror: (() => void) | null = null;
  listeners = new Map<string, (event: MessageEvent<string>) => void>();

  constructor(readonly url: string) {
    FakeEventSource.instances.push(this);
  }

  addEventListener(type: string, listener: (event: MessageEvent<string>) => void): void {
    this.listeners.set(type, listener);
  }

  close(): void {}
}

function makeLayer(index: number, overrides: Partial<Layer> = {}): Layer {
  return {
    id: `layer-${index}`,
    canvasId: 'canvas-1',
    name: `笔迹 ${index}`,
    type: 'vector',
    zIndex: index,
    visible: true,
    opacity: 1,
    content: { kind: 'fabric', json: JSON.stringify({ id: `layer-${index}` }) },
    metadata: { createdBy: 'user', createdAt: 0 },
    createdAt: 0,
    ...overrides,
  };
}

function makeCanvas(layers: Layer[], name = '测试画布'): CanvasDocument {
  return {
    id: 'canvas-1',
    name,
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    layers,
    history: { canUndo: false, canRedo: false },
  };
}

function seedCanvas(layers: Layer[], name = '测试画布'): void {
  useCanvasStore.setState({
    canvas: makeCanvas(layers, name),
    status: 'ready',
    error: null,
    requestedCanvasId: 'canvas-1',
    previousCanvasId: null,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    activeLayerId: null,
    activeLayerRequest: 0,
  });
}

function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as unknown as Response;
}

class FakeStroke {
  set(): void {}

  toJSON() {
    return {
      type: 'path',
      stroke: '#111111',
      strokeWidth: 6,
      path: [
        ['M', 10, 10],
        ['L', 20, 20],
      ],
    };
  }
}

beforeEach(() => {
  fabricDouble.FakeCanvas.instances.length = 0;
  FakeEventSource.instances.length = 0;
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    previousCanvasId: null,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    activeLayerId: null,
    activeLayerRequest: 0,
  });
  useToolStore.setState({ tool: 'brush' });
  vi.stubGlobal('EventSource', FakeEventSource);
  // jsdom 不实现布局滚动。
  Object.defineProperty(Element.prototype, 'scrollIntoView', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    writable: true,
    value: vi.fn(),
  });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    previousCanvasId: null,
    saving: false,
    saveState: 'idle',
    lastSavedAt: null,
    saveError: null,
    unsavedStrokes: 0,
    canvasAlert: null,
    canvasRetry: null,
    activeLayerId: null,
    activeLayerRequest: 0,
  });
});

function canvasInstance(): InstanceType<typeof fabricDouble.FakeCanvas> {
  const instance = fabricDouble.FakeCanvas.instances[0];

  if (!instance) {
    throw new Error('CanvasStage did not create a fabric canvas');
  }

  return instance;
}

function fireStroke(): void {
  canvasInstance().handlers.get('path:created')?.({ path: new FakeStroke() });
}

describe('语言声明', () => {
  it('<html lang="zh-CN">，不再声明英文', () => {
    const html = readFileSync(resolve(testDir, '../index.html'), 'utf8');

    expect(html).toMatch(/<html\s+lang="zh-CN"/);
    expect(html).not.toMatch(/<html\s+lang="en"/);
  });
});

describe('图层命名唯一', () => {
  it('8 层删掉第 4 层再画，新图层是「笔迹 9」，已有图层不改名', async () => {
    const layers = Array.from({ length: 8 }, (_, index) => makeLayer(index + 1));
    const initial = makeCanvas(layers);
    let current = initial;

    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);

      if (init?.method === 'DELETE') {
        const deletedId = /\/layers\/([^?]+)/.exec(url)?.[1];
        current = {
          ...current,
          revision: current.revision + 1,
          layers: current.layers.filter((layer) => layer.id !== deletedId),
        };
        return jsonResponse(current);
      }

      if (url === '/paint/canvas/canvas-1/layers' && init?.method === 'POST') {
        const payload = JSON.parse(String(init.body)) as CreateLayerInput;
        const created: Layer = {
          id: 'layer-new',
          canvasId: current.id,
          name: payload.name,
          type: payload.type,
          zIndex: current.layers.length,
          visible: true,
          opacity: 1,
          content: payload.content,
          metadata: { createdBy: 'user', createdAt: 0 },
          createdAt: 0,
        };
        current = {
          ...current,
          revision: current.revision + 1,
          layers: [...current.layers, created],
        };
        return jsonResponse(current);
      }

      return jsonResponse(current);
    });

    vi.stubGlobal('fetch', fetchMock);
    seedCanvas(layers);

    render(
      <>
        <LayerPanel />
        <CanvasStage />
      </>,
    );

    fireEvent.click(screen.getByRole('button', { name: '删除 笔迹 4' }));

    await waitFor(() =>
      expect(useCanvasStore.getState().canvas?.layers).toHaveLength(7),
    );

    fireStroke();

    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([url, init]) =>
            String(url) === '/paint/canvas/canvas-1/layers' &&
            init?.method === 'POST',
        ),
      ).toBe(true),
    );

    const createCall = fetchMock.mock.calls.find(
      ([url, init]) =>
        String(url) === '/paint/canvas/canvas-1/layers' && init?.method === 'POST',
    );
    const payload = JSON.parse(String(createCall?.[1]?.body)) as CreateLayerInput;

    expect(payload.name).toBe('笔迹 9');
    expect(payload.type).toBe('vector');

    const names = useCanvasStore.getState().canvas?.layers.map((layer) => layer.name);

    expect(names).toEqual([
      '笔迹 1',
      '笔迹 2',
      '笔迹 3',
      '笔迹 5',
      '笔迹 6',
      '笔迹 7',
      '笔迹 8',
      '笔迹 9',
    ]);
  });

  it('没有「笔迹 N」时从「笔迹 1」开始，编号由名字而不是列表长度决定', () => {
    expect(nextStrokeLayerName([])).toBe('笔迹 1');
    expect(
      nextStrokeLayerName([{ name: '背景' }, { name: '笔迹 3' }, { name: '手写' }]),
    ).toBe('笔迹 4');
    expect(nextStrokeLayerName([{ name: '笔迹 7' }, { name: '背景' }])).toBe('笔迹 8');
  });
});

const SEMANTIC_ATTRIBUTES = ['aria-label', 'title', 'placeholder', 'alt'] as const;

/**
 * 白名单：产品名、格式名、AI 缩写、技术标识符、监控分类名，以及时长单位。
 * 除此之外，界面语义文本里不应再出现英文单词。
 */
const ALLOWED_TOKENS = new Set([
  'PaintCodex',
  'PNG',
  'JSON',
  'SVG',
  'AI',
  // 协议名：票 03 的指标卡固定写作「HTTP 错误率」，与 PNG/JSON 同类。
  'HTTP',
  'Codex',
  'CLI',
  'traceId',
  'http_request',
  'sse_subscribe',
  'chat_completed',
  // 监控分类名（协议值，AI 对话分类含连字符）。
  'codex-runtime',
  'canvas-tool',
  'ai-chat',
  'canvas-action',
  'http',
  'sse',
  'system',
  // 时长单位，不是英文文案。
  'ms',
]);

function semanticText(root: Element): string {
  const parts: string[] = [];
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);

  // 逐个文本节点收集：`textContent` 会把相邻单元格粘成一个假单词。
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const value = node.nodeValue?.trim();

    if (value) {
      parts.push(value);
    }
  }

  for (const element of root.querySelectorAll(SEMANTIC_ATTRIBUTES.map((name) => `[${name}]`).join(','))) {
    for (const attribute of SEMANTIC_ATTRIBUTES) {
      const value = element.getAttribute(attribute);

      if (value) {
        parts.push(value);
      }
    }
  }

  return parts.join('\n');
}

function unexpectedEnglish(text: string): string[] {
  const tokens = text.match(/[A-Za-z][A-Za-z0-9_-]*/g) ?? [];

  return Array.from(new Set(tokens.filter((token) => !ALLOWED_TOKENS.has(token))));
}

const BANNED_LITERALS = [
  /Untitled/,
  /\bBlank\b/,
  /\bvector\b/,
  /AI chat/,
  /PaintCodex canvas/,
  /Logs:/,
  /\bchats\b/,
  /\bStroke\s+\d+/,
  /\bspans\b/,
];

function expectNoEnglishUi(root: Element): void {
  const text = semanticText(root);

  expect(unexpectedEnglish(text)).toEqual([]);

  for (const pattern of BANNED_LITERALS) {
    expect(text).not.toMatch(pattern);
  }
}

describe('语义化文本中文化', () => {
  it('图层面板：类型显示「笔迹」/「AI」/「图片」，没有 vector 等英文', () => {
    seedCanvas([
      makeLayer(1),
      makeLayer(2, {
        type: 'ai-generated',
        name: 'AI 图层',
        content: { kind: 'svg', svg: '<svg><g /></svg>' },
      }),
      makeLayer(3, {
        type: 'raster',
        name: '照片图层',
        content: { kind: 'fabric', json: '{"id":"layer-3"}' },
      }),
    ]);

    const { container } = render(<LayerPanel />);

    expect(screen.getByText('笔迹')).toBeTruthy();
    expect(screen.getByText('AI')).toBeTruthy();
    expect(screen.getByText('图片')).toBeTruthy();
    expect(screen.queryByText('vector')).toBeNull();
    expect(screen.queryByText('raster')).toBeNull();

    expectNoEnglishUi(container);
  });

  it('AI 对话：标题与读屏名称是中文，空态与输入提示没有英文', () => {
    seedCanvas([]);

    const { container } = render(<AiChatPanel />);

    expect(screen.getByRole('region', { name: 'AI 对话' })).toBeTruthy();
    expect(screen.getByPlaceholderText('描述你想画的内容…')).toBeTruthy();

    expectNoEnglishUi(container);
  });

  it('监控页：日志、统计、追踪文案中文化，分类名与级别不再显示英文', async () => {
    const now = Date.now();
    const log: AgentLog = {
      id: 1,
      traceId: '1700000000000',
      spanId: null,
      parentId: null,
      timestamp: now,
      level: 'error',
      category: 'ai-chat',
      message: 'chat_completed',
      payload: {},
      durationMs: 12,
      error: null,
      canvasId: 'canvas-1',
      revision: 1,
      actor: 'user',
    };
    const stats: MonitorStats = {
      windowMs: 300_000,
      totalLogs: 1,
      errorCount: 1,
      errorRate: 0,
      requestCount: 1,
      requestsPerSecond: 0.01,
      avgDurationMs: 12,
      httpFailureCount: 0,
      httpConflictCount: 0,
      aiChatCount: 1,
      aiChatSuccessCount: 1,
      aiChatAbortedCount: 0,
      aiChatSuccessRate: null,
      categoryCounts: [
        { category: 'http', count: 1, errorCount: 0 },
        { category: 'ai-chat', count: 1, errorCount: 1 },
      ],
    };

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);

        if (url.startsWith('/monitor/logs')) {
          return jsonResponse({ items: [log], total: 1, limit: 200, offset: 0 });
        }

        if (url.startsWith('/monitor/stats')) {
          return jsonResponse(stats);
        }

        return jsonResponse({ traceId: log.traceId, roots: [] });
      }),
    );

    const { container } = render(<MonitorPage />);

    expect(await screen.findByText('chat_completed')).toBeTruthy();
    expect(await screen.findByText('HTTP 错误率')).toBeTruthy();
    // 级别徽标用中文，原始 enum 只留在筛选值里。
    expect(screen.getAllByText('错误').length).toBeGreaterThan(0);
    expect(screen.queryByText('info')).toBeNull();
    expect(screen.queryByText('debug')).toBeNull();

    expectNoEnglishUi(container);
  });
});

describe('旧画布名的显示兜底', () => {
  it('空名与 Untitled 只显示「未命名」，原值不变', () => {
    expect(displayCanvasName('')).toBe('未命名');
    expect(displayCanvasName('   ')).toBe('未命名');
    expect(displayCanvasName('Untitled')).toBe('未命名');
    expect(displayCanvasName('红色练习')).toBe('红色练习');
  });

  it('打开旧画布不改名：进入重命名后按 Enter 不发出 PATCH', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    seedCanvas([], 'Untitled');

    render(<CanvasNameEditor />);

    expect(screen.getByText('未命名')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: '重命名画布' }));

    const input = screen.getByRole('textbox', { name: '画布名称' });

    expect((input as HTMLInputElement).value).toBe('未命名');

    fireEvent.keyDown(input, { key: 'Enter' });

    await act(async () => {
      await Promise.resolve();
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(useCanvasStore.getState().canvas?.name).toBe('Untitled');
  });
});
