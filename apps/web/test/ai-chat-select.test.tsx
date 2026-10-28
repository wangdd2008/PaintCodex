// @vitest-environment jsdom
import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { AiChatPanel } from '../src/features/ai-chat/AiChatPanel';
import { useChatStore } from '../src/features/ai-chat/chat-store';
import { useCanvasStore } from '../src/services/canvas-store';

const LAYER: Layer = {
  id: 'layer-1',
  canvasId: 'canvas-1',
  name: '红圆',
  type: 'vector',
  zIndex: 0,
  visible: true,
  opacity: 1,
  content: { kind: 'fabric', json: '{"type":"path"}' },
  metadata: { createdBy: 'user', createdAt: 1 },
  createdAt: 1,
};

function readyCanvas(): CanvasDocument {
  return {
    id: 'canvas-1',
    name: '测试画布',
    width: 1920,
    height: 1080,
    backgroundColor: '#ffffff',
    revision: 1,
    createdAt: 0,
    updatedAt: 0,
    history: { canUndo: false, canRedo: false },
    layers: [LAYER],
  };
}

const encoder = new TextEncoder();

function controlledStream() {
  let streamController: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      streamController = controller;
    },
  });

  return {
    body,
    push(payload: unknown) {
      streamController?.enqueue(
        encoder.encode(`data: ${JSON.stringify(payload)}\n\n`),
      );
    },
    close() {
      streamController?.close();
    },
  };
}

function stubFetch(body: ReadableStream<Uint8Array>): void {
  vi.stubGlobal(
    'fetch',
    vi.fn(async () => ({ ok: true, status: 200, body }) as unknown as Response),
  );
}

async function sendMessage(text: string): Promise<void> {
  fireEvent.change(screen.getByPlaceholderText('描述你想画的内容…'), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole('button', { name: '发送' }));
  await screen.findByText(text);
}

beforeEach(() => {
  Object.defineProperty(Element.prototype, 'scrollTo', {
    configurable: true,
    value: () => undefined,
  });
  useCanvasStore.setState({
    canvas: readyCanvas(),
    status: 'ready',
    error: null,
    requestedCanvasId: 'canvas-1',
    saving: false,
    activeLayerId: null,
    activeLayerRequest: 0,
    aiSelection: null,
    isDrawing: false,
  });
  // 会话记录现在是模块级 store，每个用例从空桶开始。
  useChatStore.setState({ transcripts: {} });
});

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  useCanvasStore.setState({
    canvas: null,
    status: 'idle',
    error: null,
    requestedCanvasId: null,
    saving: false,
    activeLayerId: null,
    activeLayerRequest: 0,
    aiSelection: null,
    isDrawing: false,
  });
});

describe('AiChatPanel 的 canvas_select 帧', () => {
  it('把目标图层设为活动图层，并且不抢已有输入框的焦点', async () => {
    render(
      <>
        <input aria-label="备注" />
        <AiChatPanel />
      </>,
    );
    const stream = controlledStream();
    stubFetch(stream.body);

    const note = screen.getByLabelText('备注');
    note.focus();
    expect(document.activeElement).toBe(note);

    await sendMessage('看我刚画的那一笔');
    stream.push({ select: { canvasId: 'canvas-1', layerId: LAYER.id } });

    await waitFor(() =>
      expect(useCanvasStore.getState().activeLayerId).toBe(LAYER.id),
    );
    // 不是用户点击：不能重放「定位」反馈，也不能动焦点。
    expect(useCanvasStore.getState().activeLayerRequest).toBe(0);
    expect(document.activeElement).toBe(note);
  });
});
