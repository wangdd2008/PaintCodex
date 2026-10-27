import type { CanvasDocument, Layer, UpdateLayerPatch } from '@paintcodex/protocol';
import type { CommandDispatcher } from '../../command-dispatcher.js';
import {
  CanvasNotFoundError,
  LayerNotFoundError,
  NothingToUndoError,
  RevisionConflictError,
} from '../../errors.js';
import type { PaintService } from '../../service.js';
import type { ObservabilityLogger, TraceContext } from '../../../observability/logger.js';
import type {
  ConfirmationOutcome,
  ConfirmationRequest,
} from './confirmation.js';
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
  /**
   * Ask the user before an irreversible action. The runtime binds this to the
   * turn that owns the call; a tool that needs confirmation just awaits it.
   */
  requestConfirmation?(
    request: ConfirmationRequest,
  ): Promise<ConfirmationOutcome>;
}

export interface CanvasToolSet {
  declarations: DynamicToolSpec[];
  execute(tool: string, args: unknown, context: CanvasToolContext): Promise<CanvasToolResult>;
}

export interface CanvasToolSetOptions {
  dispatcher: Pick<CommandDispatcher, 'dispatch' | 'undo'>;
  service: Pick<PaintService, 'getCanvas' | 'getUndoTarget'>;
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

const UPDATE_LAYER_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_update_layer',
  description:
    'Change one existing layer in place. Pass only the fields that change: name, ' +
    'visible, opacity, or a complete replacement SVG (`patch.svg`). The SVG rules ' +
    'are the same as for canvas_create_layer: standalone <svg>, canvas viewBox, no ' +
    'scripts, handlers, embedded images, or remote references. Read the canvas ' +
    'first so the layer id is real.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to change.' },
      layerId: { type: 'string', description: 'Id of the layer to change.' },
      patch: {
        type: 'object',
        description: 'Only the fields that change; at least one is required.',
        properties: {
          name: { type: 'string', description: 'New layer name, at most 80 characters.' },
          visible: { type: 'boolean' },
          opacity: { type: 'number', minimum: 0, maximum: 1 },
          svg: {
            type: 'string',
            description: 'Complete replacement SVG markup for this layer.',
          },
        },
        additionalProperties: false,
      },
    },
    required: ['canvasId', 'layerId', 'patch'],
    additionalProperties: false,
  },
};

const DELETE_LAYER_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_delete_layer',
  description:
    'Delete one layer by id. This is irreversible for the user, so the user is ' +
    'asked to confirm before it runs; say what you are deleting in your reply. ' +
    'If the user declines or does not answer, the tool returns user_declined and ' +
    'nothing is deleted.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to change.' },
      layerId: { type: 'string', description: 'Id of the layer to delete.' },
    },
    required: ['canvasId', 'layerId'],
    additionalProperties: false,
  },
};

const UNDO_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_undo',
  description:
    'Undo the latest step on the canvas, but only when that step was made by the ' +
    'assistant. If the latest step belongs to the user, this returns ' +
    'top_action_is_user and the user has to undo it themselves.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to undo.' },
    },
    required: ['canvasId'],
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
      case 'canvas_update_layer':
        return updateLayer(options.dispatcher, options.service, args, context);
      case 'canvas_delete_layer':
        return deleteLayer(options.dispatcher, options.service, args, context);
      case 'canvas_undo':
        return undo(options.dispatcher, options.service, args, context);
      default:
        return {
          ok: false,
          code: 'unknown_tool',
          message: `未声明的画布工具：${tool}`,
        };
    }
  };

  return {
    declarations: [
      GET_CONTEXT_DECLARATION,
      CREATE_LAYER_DECLARATION,
      UPDATE_LAYER_DECLARATION,
      DELETE_LAYER_DECLARATION,
      UNDO_DECLARATION,
    ],
    async execute(tool, args, context) {
      const startedAt = now();
      let result: CanvasToolResult;

      try {
        result = await dispatchTool(tool, args, context);
      } catch (error) {
        result = failureFromError(error);
      }

      const layerId =
        result.ok && typeof result.layer === 'object' && result.layer !== null
          ? (result.layer as { id?: unknown }).id
          : undefined;

      options.logger?.log({
        category: 'canvas-tool',
        level: result.ok ? 'info' : 'warn',
        message: 'tool_call',
        canvasId: context.canvasId,
        actor: 'agent',
        traceId: context.trace?.traceId ?? null,
        parentId: context.trace?.spanId ?? null,
        durationMs: now() - startedAt,
        payload: {
          tool,
          ok: result.ok,
          argumentSummary: summarizeArguments(args),
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
    return failureFromError(error);
  }
}

function updateLayer(
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

  if (typeof object.layerId !== 'string' || object.layerId.length === 0) {
    return invalidArguments('layerId 必须是字符串');
  }

  const layerId = object.layerId;
  const patchInput = asObject(object.patch);

  if (!patchInput) {
    return invalidArguments('patch 必须是对象');
  }

  const patchKeys = Object.keys(patchInput);

  if (patchKeys.length === 0) {
    return invalidArguments('patch 不能为空');
  }

  const patch: UpdateLayerPatch = {};

  for (const key of patchKeys) {
    switch (key) {
      case 'name': {
        const name = readLayerName(patchInput.name);

        if (typeof name !== 'string') {
          return invalidArguments(name.reason);
        }

        patch.name = name;
        break;
      }

      case 'visible': {
        if (typeof patchInput.visible !== 'boolean') {
          return invalidArguments('visible 必须是布尔值');
        }

        patch.visible = patchInput.visible;
        break;
      }

      case 'opacity': {
        if (
          typeof patchInput.opacity !== 'number' ||
          patchInput.opacity < 0 ||
          patchInput.opacity > 1
        ) {
          return invalidArguments('opacity 必须是 0 到 1 之间的数字');
        }

        patch.opacity = patchInput.opacity;
        break;
      }

      case 'svg': {
        if (typeof patchInput.svg !== 'string') {
          return invalidArguments('patch.svg 必须是字符串');
        }

        const svgReason = unsafeSvgReason(patchInput.svg);

        if (svgReason !== null) {
          return { ok: false, code: 'invalid_svg', message: svgReason };
        }

        patch.content = { kind: 'svg', svg: patchInput.svg };
        break;
      }

      default:
        return invalidArguments(`patch 不支持字段：${key}`);
    }
  }

  const canvas = service.getCanvas(canvasId);

  if (!canvas) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      expectedRevision: canvas.revision,
      action: { type: 'canvas_update_layer', layerId, patch },
    });
    const layer = updated.layers.find((candidate) => candidate.id === layerId);

    return {
      ok: true,
      layer: { id: layerId, name: layer?.name ?? '' },
      revision: updated.revision,
    };
  } catch (error) {
    return failureFromError(error);
  }
}

async function deleteLayer(
  dispatcher: Pick<CommandDispatcher, 'dispatch'>,
  service: Pick<PaintService, 'getCanvas'>,
  args: unknown,
  context: CanvasToolContext,
): Promise<CanvasToolResult> {
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

  if (typeof object.layerId !== 'string' || object.layerId.length === 0) {
    return invalidArguments('layerId 必须是字符串');
  }

  const layerId = object.layerId;
  const canvas = service.getCanvas(canvasId);

  if (!canvas) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  const layer = canvas.layers.find((candidate) => candidate.id === layerId);

  // Asking to confirm a delete that cannot happen would waste the user's one
  // answer; validate the target first.
  if (!layer) {
    return { ok: false, code: 'layer_not_found', message: '图层不存在' };
  }

  const refusal = await requireConfirmation(context, {
    title: `删除图层「${layer.name}」`,
    detail: '这是不可逆操作：确认后该图层会从画布上移除。',
  });

  if (refusal) {
    return refusal;
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      expectedRevision: canvas.revision,
      action: { type: 'canvas_delete_layer', layerId },
    });

    return { ok: true, layerId, revision: updated.revision };
  } catch (error) {
    return failureFromError(error);
  }
}

function undo(
  dispatcher: Pick<CommandDispatcher, 'undo'>,
  service: Pick<PaintService, 'getCanvas' | 'getUndoTarget'>,
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

  const target = service.getUndoTarget(canvasId);

  if (!target) {
    return { ok: false, code: 'nothing_to_undo', message: '没有可撤销的操作' };
  }

  // Undo is scoped to the agent's own steps: a user's latest action is the
  // user's to undo, never the assistant's to quietly discard.
  if (target.actor !== 'agent') {
    return {
      ok: false,
      code: 'top_action_is_user',
      message: '栈顶是你自己的操作，需要你自己撤销。',
    };
  }

  try {
    const updated = dispatcher.undo(canvasId, canvas.revision, 'agent');

    return {
      ok: true,
      revision: updated.revision,
      undoneAction: target.action,
    };
  } catch (error) {
    return failureFromError(error);
  }
}

function failureFromError(error: unknown): CanvasToolResult {
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

  if (error instanceof NothingToUndoError) {
    return { ok: false, code: 'nothing_to_undo', message: '没有可撤销的操作' };
  }

  return {
    ok: false,
    code: 'tool_failed',
    message: error instanceof Error ? error.message : '画布工具执行失败',
  };
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

/**
 * The one call a destructive tool makes before it acts. `null` means the user
 * approved; any other result is the model-readable refusal to return instead.
 * A context without a channel fails closed: no confirmation, no irreversible
 * action.
 */
async function requireConfirmation(
  context: CanvasToolContext,
  request: ConfirmationRequest,
): Promise<CanvasToolResult | null> {
  const ask = context.requestConfirmation;

  if (!ask) {
    return {
      ok: false,
      code: 'user_declined',
      message: '确认通道不可用，操作已取消。',
    };
  }

  let outcome: ConfirmationOutcome;

  try {
    outcome = await ask(request);
  } catch {
    return {
      ok: false,
      code: 'user_declined',
      message: '确认请求发送失败，操作已取消。',
    };
  }

  if (outcome === 'approved') {
    return null;
  }

  return {
    ok: false,
    code: 'user_declined',
    message: refusalMessage(outcome),
  };
}

function refusalMessage(outcome: ConfirmationOutcome): string {
  switch (outcome) {
    case 'timeout':
      return '用户未答复（超过 60 秒），操作已取消。';
    case 'disconnected':
      return '用户已离开对话，操作已取消。';
    case 'interrupted':
      return '用户中断了本轮对话，操作已取消。';
    default:
      return '用户取消了这次操作。';
  }
}

/**
 * A compact, log-safe fingerprint of a tool's arguments: enough to see what the
 * model asked for (ids, names, patch shape) without storing whole SVG documents.
 */
function summarizeArguments(args: unknown): Record<string, unknown> {
  const object = asObject(args);

  if (!object) {
    return { kind: typeof args };
  }

  const summary: Record<string, unknown> = {
    keys: Object.keys(object).sort(),
  };

  if (typeof object.canvasId === 'string') {
    summary.canvasId = object.canvasId;
  }

  if (typeof object.layerId === 'string') {
    summary.layerId = object.layerId;
  }

  if (typeof object.name === 'string') {
    summary.name = object.name;
  }

  if (typeof object.visible === 'boolean') {
    summary.visible = object.visible;
  }

  if (typeof object.opacity === 'number') {
    summary.opacity = object.opacity;
  }

  if (typeof object.svg === 'string') {
    summary.svgLength = object.svg.length;
  }

  const patch = asObject(object.patch);

  if (patch) {
    summary.patchKeys = Object.keys(patch).sort();

    if (typeof patch.svg === 'string') {
      summary.svgLength = patch.svg.length;
    }

    if (typeof patch.name === 'string') {
      summary.name = patch.name;
    }
  }

  return summary;
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
