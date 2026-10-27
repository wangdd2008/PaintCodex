import type {
  CanvasDocument,
  CanvasRegion,
  CanvasSelectFrame,
  Layer,
  UpdateLayerPatch,
} from '@paintcodex/protocol';
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
import type { ExportRequester } from './export-png.js';
import type { RenderPreviewRequester } from './render-preview.js';
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
  /** Asks the browser that owns the canvas for a PNG of the current state. */
  requestRender?: RenderPreviewRequester;
  /** Asks the browser to download the canvas as a PNG and report the file. */
  requestExport?: ExportRequester;
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
    'images, and remote references are rejected. Read the canvas with ' +
    'canvas_get_context first, then pass the revision it returned as expectedRevision ' +
    'so a concurrent user edit is not overwritten. Returns the created layer id and ' +
    'the resulting canvas revision.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to draw on.' },
      name: { type: 'string', description: 'Short layer name, at most 80 characters.' },
      svg: { type: 'string', description: 'Complete standalone SVG markup.' },
      visible: { type: 'boolean', description: 'Defaults to true.' },
      opacity: { type: 'number', minimum: 0, maximum: 1, description: 'Defaults to 1.' },
      expectedRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The canvas revision you last observed from canvas_get_context.',
      },
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
    'scripts, handlers, embedded images, or remote references. Read the canvas with ' +
    'canvas_get_context first, then pass the revision it returned as expectedRevision ' +
    'so a concurrent user edit is not overwritten. Returns the resulting canvas ' +
    'revision.',
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
      expectedRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The canvas revision you last observed from canvas_get_context.',
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
    'Read the canvas with canvas_get_context first, then pass the revision it ' +
    'returned as expectedRevision so an edit made while the user decides turns ' +
    'into a revision_conflict instead of a silent overwrite. If the user declines ' +
    'or does not answer, the tool returns user_declined and nothing is deleted.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to change.' },
      layerId: { type: 'string', description: 'Id of the layer to delete.' },
      expectedRevision: {
        type: 'integer',
        minimum: 0,
        description: 'The canvas revision you last observed from canvas_get_context.',
      },
    },
    required: ['canvasId', 'layerId'],
    additionalProperties: false,
  },
};

const SELECT_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_select',
  description:
    'Point the user at one layer or one area of the canvas so they can see what ' +
    'you are talking about. Pass exactly one of layerId or region. This only ' +
    'moves the UI focus (the layer becomes active, the area is circled briefly); ' +
    'it changes nothing on the canvas and needs no confirmation.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to point at.' },
      layerId: { type: 'string', description: 'Id of the layer to select.' },
      region: {
        type: 'object',
        description:
          'Canvas-space rectangle to circle. Values outside the canvas are clamped ' +
          'and reported, not rejected.',
        properties: {
          x: { type: 'number', description: 'Left edge, in canvas units.' },
          y: { type: 'number', description: 'Top edge, in canvas units.' },
          width: { type: 'number', description: 'Positive width, in canvas units.' },
          height: { type: 'number', description: 'Positive height, in canvas units.' },
        },
        required: ['x', 'y', 'width', 'height'],
        additionalProperties: false,
      },
    },
    required: ['canvasId'],
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

const EXPORT_PNG_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_export_png',
  description:
    'Download the current canvas as a PNG file on the user\'s computer. The user ' +
    'is asked to confirm the download first; if they decline or do not answer, ' +
    'the tool returns user_declined and nothing is downloaded. Returns the ' +
    'downloaded filename and its size in bytes, never the image itself.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to export.' },
    },
    required: ['canvasId'],
    additionalProperties: false,
  },
};

const RENDER_PREVIEW_DECLARATION: DynamicToolSpec = {
  type: 'function',
  name: 'canvas_render_preview',
  description: 'Render the current canvas to a PNG and return it as an image.',
  inputSchema: {
    type: 'object',
    properties: {
      canvasId: { type: 'string', description: 'Canvas id to render.' },
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
      case 'canvas_select':
        return selectTarget(options.service, args, context);
      case 'canvas_undo':
        return undo(options.dispatcher, options.service, args, context);
      case 'canvas_export_png':
        return exportPng(options.service, args, context);
      case 'canvas_render_preview':
        return renderPreview(options.service, args, context);
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
      SELECT_DECLARATION,
      EXPORT_PNG_DECLARATION,
      UNDO_DECLARATION,
      RENDER_PREVIEW_DECLARATION,
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

  const requestedRevision = readExpectedRevision(object.expectedRevision);

  if (requestedRevision === null) {
    return invalidArguments('expectedRevision 必须是整数');
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      // Without an observation the tool keeps its old behaviour (write against
      // the revision it just read); with one, the dispatcher rejects a stale
      // write instead of overwriting the user's edit.
      expectedRevision: requestedRevision ?? canvas.revision,
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

  const requestedRevision = readExpectedRevision(object.expectedRevision);

  if (requestedRevision === null) {
    return invalidArguments('expectedRevision 必须是整数');
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      expectedRevision: requestedRevision ?? canvas.revision,
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

  const requestedRevision = readExpectedRevision(object.expectedRevision);

  if (requestedRevision === null) {
    return invalidArguments('expectedRevision 必须是整数');
  }

  // Fail fast: a model working from a stale read should be told to re-read
  // *before* the user is asked to approve anything.
  const observedRevision = requestedRevision ?? canvas.revision;

  if (observedRevision !== canvas.revision) {
    return revisionConflict(observedRevision, canvas.revision);
  }

  const refusal = await requireConfirmation(context, {
    title: `删除图层「${layer.name}」`,
    detail: '这是不可逆操作：确认后该图层会从画布上移除。',
  });

  if (refusal) {
    return refusal;
  }

  // The user may have edited the canvas while deciding. Re-check what the
  // confirmation was raised against; the delete must not silently discard that
  // edit. This is a real check, not a spurious one: a confirmation is passive,
  // so an unchanged canvas has exactly the observed revision.
  const afterApproval = service.getCanvas(canvasId);

  if (!afterApproval) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  if (afterApproval.revision !== observedRevision) {
    return revisionConflict(observedRevision, afterApproval.revision);
  }

  try {
    const updated = dispatcher.dispatch(canvasId, {
      actor: 'agent',
      expectedRevision: observedRevision,
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

  if (target.kind === 'canvas_not_found') {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  // An exhausted stack is not the user's action: there is simply nothing left
  // to undo, and the model must not ask the user to undo it themselves.
  if (target.kind === 'nothing_to_undo') {
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

/**
 * The export is the browser's job (ADR-0005): the daemon only asks, and the
 * browser downloads the PNG. Like the preview, a missing or slow browser is a
 * normal failure the model can read, not a reason to fail the whole turn.
 */
async function exportPng(
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

  const canvas = service.getCanvas(canvasId);

  if (!canvas) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  // Export overwrites a file the user picked, so it is confirmed even though
  // the canvas itself is untouched. The copy says download, not delete.
  const refusal = await requireConfirmation(context, {
    title: `导出画布「${canvas.name}」为 PNG`,
    detail: '确认后会下载一张 PNG 图片到你的电脑。',
    approveLabel: '下载 PNG',
  });

  if (refusal) {
    return refusal;
  }

  if (!context.requestExport) {
    return {
      ok: false,
      code: 'export_unavailable',
      message: '当前对话没有连接中的浏览器，无法导出画布',
    };
  }

  const exported = await context.requestExport(canvasId);

  if (!exported.ok) {
    return {
      ok: false,
      code: exported.code,
      message: exported.message,
    };
  }

  // Only the pointer to the download; the PNG bytes stay in the browser.
  return { ok: true, filename: exported.filename, bytes: exported.bytes };
}

/**
 * The preview is a round trip through the browser: the daemon has no renderer.
 * No channel or a timed-out render is a normal failure the model can read, not
 * a reason to fail the whole turn.
 */
async function renderPreview(
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

  if (!service.getCanvas(canvasId)) {
    return { ok: false, code: 'canvas_not_found', message: '画布不存在' };
  }

  if (!context.requestRender) {
    return {
      ok: false,
      code: 'render_unavailable',
      message: '当前对话没有连接中的浏览器，无法渲染画布',
    };
  }

  const rendered = await context.requestRender(canvasId, undefined);

  if (!rendered.ok) {
    return {
      ok: false,
      code: rendered.code,
      message: rendered.message,
    };
  }

  return { ok: true, imageUrl: rendered.imageUrl };
}

/**
 * The one tool that does not change the canvas at all: it only tells the browser
 * where to look. `layerId` and `region` are mutually exclusive, and validating
 * that here keeps the refusal a result the model can read and correct.
 */
function selectTarget(
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

  const hasLayer = object.layerId !== undefined;
  const hasRegion = object.region !== undefined;

  if (hasLayer === hasRegion) {
    return invalidArguments(
      hasLayer ? 'layerId 与 region 只能二选一' : 'layerId 与 region 必须提供一个',
    );
  }

  if (hasLayer) {
    if (typeof object.layerId !== 'string' || object.layerId.length === 0) {
      return invalidArguments('layerId 必须是字符串');
    }

    if (!canvas.layers.some((layer) => layer.id === object.layerId)) {
      return { ok: false, code: 'layer_not_found', message: '图层不存在' };
    }

    const selection: CanvasSelectFrame = { canvasId, layerId: object.layerId };

    return { ok: true, selection };
  }

  const requested = readRegion(object.region);

  if (!requested) {
    return invalidArguments('region 必须包含 x、y、width、height 四个数字，且宽高大于 0');
  }

  const { region, clamped } = clampRegion(requested, canvas.width, canvas.height);
  const selection: CanvasSelectFrame = {
    canvasId,
    region,
    ...(clamped ? { clamped: true } : {}),
  };

  return {
    ok: true,
    selection,
    // An area partly off the canvas is still worth pointing at; the model only
    // has to know which box the user will actually see.
    ...(clamped ? { message: '区域已裁剪到画布范围内' } : {}),
  };
}

/** A region argument must be a complete rectangle of finite numbers with area. */
function readRegion(value: unknown): CanvasRegion | null {
  const object = asObject(value);

  if (!object) {
    return null;
  }

  const { x, y, width, height } = object;

  if (
    typeof x !== 'number' ||
    !Number.isFinite(x) ||
    typeof y !== 'number' ||
    !Number.isFinite(y) ||
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    width <= 0 ||
    typeof height !== 'number' ||
    !Number.isFinite(height) ||
    height <= 0
  ) {
    return null;
  }

  return { x, y, width, height };
}

/**
 * Clip a rectangle into the canvas. The result keeps a positive area even for a
 * box that starts past the edge: pointing at the edge is still a useful answer,
 * and the caller is told the box changed.
 */
function clampRegion(
  region: CanvasRegion,
  canvasWidth: number,
  canvasHeight: number,
): { region: CanvasRegion; clamped: boolean } {
  const maxX = Math.max(0, canvasWidth - 1);
  const maxY = Math.max(0, canvasHeight - 1);
  const x = Math.min(Math.max(region.x, 0), maxX);
  const y = Math.min(Math.max(region.y, 0), maxY);
  const width = Math.min(region.width, Math.max(1, canvasWidth - x));
  const height = Math.min(region.height, Math.max(1, canvasHeight - y));
  const clamped =
    x !== region.x ||
    y !== region.y ||
    width !== region.width ||
    height !== region.height;

  return { region: { x, y, width, height }, clamped };
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
 * `undefined` means the model did not observe a revision (legacy behaviour);
 * `null` means it supplied something that is not a revision. The distinction
 * matters: only an explicit observation may turn a write into a conflict.
 */
function readExpectedRevision(value: unknown): number | undefined | null {
  if (value === undefined) {
    return undefined;
  }

  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function revisionConflict(expected: number, current: number): CanvasToolResult {
  return {
    ok: false,
    code: 'revision_conflict',
    message: new RevisionConflictError(expected, current).message,
    currentRevision: current,
  };
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

  const region = asObject(object.region);

  if (region) {
    summary.region = {
      x: region.x,
      y: region.y,
      width: region.width,
      height: region.height,
    };
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
