import type { CanvasDocument, Layer } from '@paintcodex/protocol';
import type { CommandDispatcher } from '../../command-dispatcher.js';
import {
  CanvasNotFoundError,
  LayerNotFoundError,
  RevisionConflictError,
} from '../../errors.js';
import type { PaintService } from '../../service.js';
import type { ObservabilityLogger, TraceContext } from '../../../observability/logger.js';
import type { DynamicToolSpec } from './protocol.js';
import { unsafeSvgReason } from './validate-svg.js';

/**
 * Every tool returns either a success payload or a failure the model can read.
 * Failures are results, not thrown errors: the agent has to see what went wrong
 * in order to correct itself.
 */
export type CanvasToolResult =
  | ({ ok: true } & Record<string, unknown>)
  | { ok: false; code: string; message: string } & Record<string, unknown>;

export interface CanvasToolContext {
  /** Canvas of the active thread; null for a conversation without a canvas. */
  canvasId: string | null;
  /** The user message that opened this turn, stored on created layers. */
  prompt: string;
  trace?: TraceContext;
}

export interface CanvasToolSet {
  declarations: DynamicToolSpec[];
  execute(tool: string, args: unknown, context: CanvasToolContext): Promise<CanvasToolResult>;
}

export interface CanvasToolSetOptions {
  dispatcher: Pick<CommandDispatcher, 'dispatch'>;
  service: Pick<PaintService, 'getCanvas'>;
  logger?: ObservabilityLogger;
  /** Injectable clock for tool duration measurements. */
  now?: () => number;
}

const MAX_LAYER_NAME_LENGTH = 80;

const GET_CONTEXT_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_get_context',
  description:
    'Read the current canvas: dimensions, revision, history flags, and the layer list with ids. ' +
    'Pass layerId to inspect one layer in detail (including its content). ' +
    'Call this before changing a layer so the arguments use real ids.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to read.' },
      layerId: { type: 'string', description: 'Optional layer id for a detailed read.' },
    },
    required: ['canvasId'],
    additionalProperties: false,
  },
};

const CREATE_LAYER_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_create_layer',
  description:
    'Create one new SVG layer on the canvas. The SVG must be a standalone <svg> ' +
    'document with a viewBox matching the canvas. Scripts, event handlers, embedded ' +
    'images, and remote references are rejected. Returns the created layer id.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to draw on.' },
      name: { type: 'string', description: 'Short layer name, at most 80 characters.' },
      svg: { type: 'string', description: 'Complete standalone SVG markup.' },
      visible: { type: 'boolean', description: 'Defaults to true.' },
      opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Defaults to 1.' },
    },
    required: ['canvasId', 'name', 'svg'],
    additionalProperties: false,
  },
};

export function createCanvasToolSet(options: CanvasToolSetOptions): CanvasToolSet {
  const now = options.now ?? Date.now;

  const dispatchTool = async (
    tool: string,
    args: unknown,
    context: CanvasToolContext,
  ): Promise<CanvasToolResult> => {
    switch (tool) {
      case 'canvas_get_context':
        return readContext(options.service, args, context);
      case 'canvas_create_layer':
        return createLayer(options.dispatcher, options.service, args, context);
      default:
        return {
          ok: false,
          code: 'unknown_tool',
          message: `未声明的画布工具：${tool}`,
        };
    }
  };

  return {
    declarations: [GET_CONTEXT_DECLARATION, CREATE_LAYER_DECLARATION],
    async execute(tool, args, context) {
      const startedAt = now();
      let result: CanvasToolResult;

      try {
        result = await dispatchTool(tool, args, context);
      } catch (error) {
        result = {
          ok: false,
          code: 'tool_failed',
          message: error instanceof Error ? error.message : '画布工具执行失败',
        };
      }

      const layerId =
        result.ok && typeof result.layer === 'object' && result.layer !== null
          ? (result.layer as { id?: unknown }).id
          : undefined;

      options.logger?.log({
        category: 'canvas-tool',
        level: result.ok ? 'info' : 'warn',
        message: 'tool_result',
        canvasId: context.canvasId,
        actor: 'agent',
        traceId: context.trace?.traceId ?? null,
        parentId: context.trace?.spanId ?? null,
        durationMs: now() - startedAt,
        payload: {
          tool,
          ok: result.ok,
          ...(typeof layerId === 'string' ? { layerId } : {}),
          ...(result.ok ? {} : { code: result.code }),
        },
      });

      return result;
    },
  };
}

/** The tool set for a conversation that has no canvas yet. */
export const EMPTY_CANVAS_TOOLS: CanvasToolSet = {
  declarations: [],
  async execute(tool) {
    return {
      ok: false,
      code: 'unknown_tool',
      message: `未声明的画布工具：${tool}`,
    };
  },
};

function readContext(
  service: Pick<PaintService, 'getCanvas'>,
  args: unknown,
  context: CanvasToolContext,
): CanvasToolResult {
  const object = asObject(args);

  if (!object) {
    return invalidArguments('参数必须是对象');
  }

  const canvasId = readCanvasId(object, context);

  if (!canvasId) {
    return {
      ok: false,
      code: 'canvas_required',
      message: '请先打开画布再让 AI 绘制。',
    };
  }

  const canvas = service.getCanvas(canvasId);

  if (!canvas) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  const layerId = object.layerId;

  if (layerId === undefined) {
    return {
      ok: true,
      canvas: canvasSummary(canvas),
      layers: canvas.layers.map(layerSummary),
    };
  }

  if (typeof layerId !== 'string') {
    return invalidArguments('layerId 必须是字符串');
  }

  const layer = canvas.layers.find((candidate) => candidate.id === layerId);

  if (!layer) {
    return { ok: false, code: 'layer_not_found', message: '图层不存在' };
  }

  return {
    ok: true,
    canvas: canvasSummary(canvas),
    layer: layerDetail(layer),
  };
}

function createLayer(
  dispatcher: Pick<CommandDispatcher, 'dispatch'>,
  service: Pick<PaintService, 'getCanvas'>,
  args: unknown,
  context: CanvasToolContext,
): CanvasToolResult {
  const object = asObject(args);

  if (!object) {
    return invalidArguments('参数必须是对象');
  }

  const canvasId = readCanvasId(object, context);

  if (!canvasId) {
    return {
      ok: false,
      code: 'canvas_required',
      message: '请先打开画布再让 AI 绘制。',
    };
  }

  const name = readLayerName(object.name);

  if (typeof name !== 'string') {
    return invalidArguments(name.reason);
  }

  if (typeof object.svg !== 'string') {
    return invalidArguments('svg 必须是字符串');
  }

  const svgReason = unsafeSvgReason(object.svg);

  if (svgReason !== null) {
    return { ok: false, code: 'invalid_svg', message: svgReason };
  }

  if (object.visible !== undefined && typeof object.visible !== 'boolean') {
    return invalidArguments('visible 必须是布尔值');
  }

  if (
    object.opacity !== undefined &&
    (typeof object.opacity !== 'number' || object.opacity < 0 || object.opacity > 1)
  ) {
    return invalidArguments('opacity 必须是 0 到 1 之间的数字');
  }

  const canvas = service.getCanvas(canvasId);

  if (!canvas) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      expectedRevision: canvas.revision,
      action: {
        type: 'canvas_create_layer',
        layer: {
          name,
          type: 'ai-generated',
          content: { kind: 'svg', svg: object.svg },
          ...(object.visible === undefined ? {} : { visible: object.visible }),
          ...(object.opacity === undefined ? {} : { opacity: object.opacity }),
          metadata: { prompt: context.prompt },
        },
      },
    });

    const created = updated.layers[updated.layers.length - 1];

    if (!created) {
      return { ok: false, code: 'tool_failed', message: 'AI 图层没有被创建' };
    }

    return {
      ok: true,
      layer: { id: created.id, name: created.name },
      revision: updated.revision,
    };
  } catch (error) {
    if (error instanceof RevisionConflictError) {
      return {
        ok: false,
        code: 'revision_conflict',
        message: error.message,
        currentRevision: error.currentRevision,
      };
    }

    if (error instanceof CanvasNotFoundError) {
      return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
    }

    if (error instanceof LayerNotFoundError) {
      return { ok: false, code: 'layer_not_found', message: '图层不存在' };
    }

    return {
      ok: false,
      code: 'tool_failed',
      message: error instanceof Error ? error.message : '画布工具执行失败',
    };
  }
}

function readCanvasId(
  object: Record<string, unknown>,
  context: CanvasToolContext,
): string | null {
  if (object.canvasId !== undefined) {
    if (typeof object.canvasId !== 'string' || object.canvasId.length === 0) {
      return null;
    }

    return object.canvasId;
  }

  return context.canvasId;
}

function readLayerName(value: unknown): string | { reason: string } {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return { reason: 'name 不能为空' };
  }

  const trimmed = value.trim();

  if (trimmed.length > MAX_LAYER_NAME_LENGTH) {
    return { reason: `name 不能超过 ${MAX_LAYER_NAME_LENGTH} 个字符` };
  }

  return trimmed;
}

function invalidArguments(message: string): CanvasToolResult {
  return { ok: false, code: 'invalid_arguments', message };
}

function asObject(value: unknown): Record<string, unknown> | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return null;
  }

  return value as Record<string, unknown>;
}

function canvasSummary(canvas: CanvasDocument) {
  return {
    id: canvas.id,
    name: canvas.name,
    width: canvas.width,
    height: canvas.height,
    backgroundColor: canvas.backgroundColor,
    revision: canvas.revision,
    layerCount: canvas.layers.length,
    canUndo: canvas.history.canUndo,
    canRedo: canvas.history.canRedo,
  };
}

function layerSummary(layer: Layer) {
  return {
    id: layer.id,
    name: layer.name,
    type: layer.type,
    zIndex: layer.zIndex,
    visible: layer.visible,
    opacity: layer.opacity,
    contentKind: layer.content.kind,
    createdBy: layer.metadata.createdBy,
    createdAt: layer.createdAt,
  };
}

function layerDetail(layer: Layer) {
  return {
    ...layerSummary(layer),
    content: layer.content,
    metadata: layer.metadata,
  };
}
