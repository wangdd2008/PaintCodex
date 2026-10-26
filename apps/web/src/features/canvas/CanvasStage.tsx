import type {
  CanvasDocument,
  CreateLayerInput,
  Layer as PaintLayer,
} from '@paintcodex/protocol';
import { useEffect, useRef, useState } from 'react';
import {
  Canvas,
  PencilBrush,
  loadSVGFromString,
  util,
  type FabricObject,
  type Path,
} from 'fabric';
import { setActiveCanvas } from '../../services/canvas-engine';
import { useCanvasStore } from '../../services/canvas-store';
import { setLayerOpacityPreviewHandler } from '../../services/layer-preview';
import { nextStrokeLayerName } from '../../services/naming';
import {
  isNetworkFailure,
  NETWORK_FAILURE_MESSAGE,
} from '../../services/network-error';
import { useToolStore } from '../../services/tool-store';
import { computeZoomPercent, useViewportStore } from '../../services/viewport-store';

const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';
const UNSAVED_DASH = [12, 8];
const UNSAVED_OPACITY = 0.55;

/** A stroke kept on screen while persistence has not succeeded yet. */
interface PendingStroke {
  id: string;
  json: string;
  path: Path;
  input: CreateLayerInput;
  failed: boolean;
}

function unsavedMessage(count: number, reason: string): string {
  return count > 1 ? `有 ${count} 笔未保存：${reason}` : `这一笔未保存：${reason}`;
}

/**
 * Locating a brush layer is a transient, client-only cue: the stroke is
 * repainted in a louder color for 800ms and then restored from the values we
 * captured. Nothing here is written back to the daemon.
 */
const LOCATE_HIGHLIGHT_COLOR = '#ff8a00';
const LOCATE_HIGHLIGHT_STROKE_WIDTH = 8;
const LOCATE_HIGHLIGHT_DURATION_MS = 800;

/**
 * Turns technical transport failures into a Chinese, actionable reason. The
 * daemon already answers in Chinese; only network-level errors need mapping.
 */
function describeCanvasFailure(error: string | null): string {
  if (!error) {
    return '无法加载画布，请稍后重试。';
  }

  return isNetworkFailure(error) ? NETWORK_FAILURE_MESSAGE : error;
}

/**
 * The canvas area has exactly one of four mutually exclusive states: no canvas,
 * loading, load failure, or ready. Only "ready" mounts Fabric at all, so the
 * other states cannot accept pointer events or create paths.
 */
export function CanvasStage() {
  const canvasDocument = useCanvasStore((state) => state.canvas);
  const status = useCanvasStore((state) => state.status);
  const error = useCanvasStore((state) => state.error);
  const requestedCanvasId = useCanvasStore((state) => state.requestedCanvasId);

  /**
   * Guard against double activation (keyboard plus the browser's synthetic
   * click): `createNewCanvas` flips the status synchronously, so the second
   * call sees "loading" and does nothing. A stale document must not block
   * "new canvas" from the failure gate.
   */
  const startCanvas = () => {
    const state = useCanvasStore.getState();

    if (state.status === 'loading') {
      return;
    }

    void state.createNewCanvas();
  };

  const retry = () => {
    const state = useCanvasStore.getState();

    if (state.status === 'loading') {
      return;
    }

    if (state.requestedCanvasId) {
      void state.loadCanvas(state.requestedCanvasId);
    } else {
      void state.createNewCanvas();
    }
  };

  // 只有 ready 才挂载 Fabric。loading/error 时即使旧文档仍在 Store 里，
  // 也不能让它继续接受指针事件；正常刷新（refreshCanvas 不置 loading）不会走到这里。
  if (status === 'ready' && canvasDocument) {
    return <CanvasSurface canvasDocument={canvasDocument} />;
  }

  if (status === 'loading') {
    return (
      <div className="canvas-gate canvas-gate--loading" aria-busy="true">
        <p className="canvas-gate__title">正在加载画布…</p>
        <p className="canvas-gate__description">正在从本地服务读取画布内容。</p>
      </div>
    );
  }

  if (status === 'error') {
    const isLoadFailure = requestedCanvasId !== null;

    return (
      <div className="canvas-gate canvas-gate--error" role="alert">
        <p className="canvas-gate__title">
          {isLoadFailure ? '画布加载失败' : '无法新建画布'}
        </p>
        <p className="canvas-gate__reason">{describeCanvasFailure(error)}</p>
        <div className="canvas-gate__actions">
          <button type="button" className="canvas-gate__cta" onClick={retry}>
            重试
          </button>
          {isLoadFailure ? (
            <button
              type="button"
              className="canvas-gate__cta canvas-gate__cta--secondary"
              onClick={startCanvas}
            >
              新建画布
            </button>
          ) : null}
        </div>
      </div>
    );
  }

  return (
    <div className="canvas-gate canvas-gate--no-canvas">
      <p className="canvas-gate__title">还没有画布</p>
      <p className="canvas-gate__description">
        1920 × 1080，画完可以让 AI 添加图层。
      </p>
      <button
        type="button"
        className="canvas-gate__cta"
        onClick={startCanvas}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            startCanvas();
          }
        }}
      >
        开始一张画布
      </button>
    </div>
  );
}

function layerSignature(layer: PaintLayer): string {
  return JSON.stringify(layer.content);
}

/** Fabric lives here so it only ever exists while a document is ready. */
function CanvasSurface({ canvasDocument }: { canvasDocument: CanvasDocument }) {
  const tool = useToolStore((state) => state.tool);
  const activeLayerId = useCanvasStore((state) => state.activeLayerId);
  const activeLayerRequest = useCanvasStore((state) => state.activeLayerRequest);
  const brushColor = useToolStore((state) => state.brushColor);
  const brushWidth = useToolStore((state) => state.brushWidth);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const objectsRef = useRef(new Map<string, FabricObject>());
  const signaturesRef = useRef(new Map<string, string>());
  const pendingJsonRef = useRef(new Set<string>());
  const pendingStrokesRef = useRef(new Map<string, PendingStroke>());
  const pendingIdRef = useRef(0);
  const syncTokenRef = useRef(0);
  const lastSelectionRequestRef = useRef(activeLayerRequest);
  const lastLocateRequestRef = useRef(activeLayerRequest);
  const [ready, setReady] = useState(false);
  const [objectsVersion, setObjectsVersion] = useState(0);
  const [blockedStroke, setBlockedStroke] = useState<string | null>(null);
  const canvasAlert = useCanvasStore((state) => state.canvasAlert);
  const hasCanvasRetry = useCanvasStore((state) => state.canvasRetry !== null);
  const retryCanvasAlert = useCanvasStore((state) => state.retryCanvasAlert);
  const dismissCanvasAlert = useCanvasStore((state) => state.dismissCanvasAlert);

  const width = canvasDocument.width ?? FALLBACK_WIDTH;
  const height = canvasDocument.height ?? FALLBACK_HEIGHT;
  const backgroundColor = canvasDocument.backgroundColor ?? '#ffffff';
  const layers = canvasDocument.layers;

  function findLayerId(target: FabricObject): string | null {
    for (const [layerId, object] of objectsRef.current) {
      if (object === target) {
        return layerId;
      }
    }

    return null;
  }

  function failedStrokes(): PendingStroke[] {
    return Array.from(pendingStrokesRef.current.values()).filter(
      (stroke) => stroke.failed,
    );
  }

  function syncUnsavedCount(): void {
    useCanvasStore.getState().setUnsavedStrokes(failedStrokes().length);
  }

  function markPathUnsaved(path: Path): void {
    path.set({ opacity: UNSAVED_OPACITY, strokeDashArray: UNSAVED_DASH });
  }

  function markPathSaved(path: Path): void {
    path.set({ opacity: 1, strokeDashArray: null });
  }

  /**
   * The last resort: the local object cannot be reconciled with the snapshot.
   * Removing it is allowed only together with an explicit banner (ADR-0008).
   */
  function discardFailedStrokes(reason: string): void {
    const canvas = fabricRef.current;

    for (const stroke of failedStrokes()) {
      canvas?.remove(stroke.path);
      pendingStrokesRef.current.delete(stroke.id);
    }

    canvas?.requestRenderAll();
    syncUnsavedCount();
    useCanvasStore.getState().markPendingStrokesSaved();
    useCanvasStore.getState().showCanvasAlert(reason, null);
  }

  /**
   * Retries every failed stroke against the authoritative snapshot. If the
   * server already has an identical layer, the local copy is dropped (it is
   * saved); only an unreconcilable object is removed with an explicit message.
   */
  async function retryFailedStrokes(): Promise<void> {
    const canvas = fabricRef.current;
    const failed = failedStrokes();

    if (!canvas || failed.length === 0) {
      return;
    }

    await useCanvasStore.getState().refreshCanvas();

    const fresh = useCanvasStore.getState().canvas;

    if (!fresh) {
      discardFailedStrokes('这一笔未保存：画布已不存在，无法重试。');
      return;
    }

    let discardReason: string | null = null;

    for (const stroke of failed) {
      const aligned = fresh.layers.some(
        (layer) =>
          layer.content.kind === 'fabric' && layer.content.json === stroke.json,
      );

      if (aligned) {
        // The snapshot already contains this exact stroke: keep the server copy.
        canvas.remove(stroke.path);
        pendingStrokesRef.current.delete(stroke.id);
        continue;
      }

      let created: PaintLayer | null = null;

      // While the retry is in flight the snapshot sync must not add a second
      // Fabric object for this stroke; the local path becomes the canonical one.
      pendingJsonRef.current.add(stroke.json);

      try {
        created = await useCanvasStore.getState().createLayer(stroke.input);
      } catch {
        pendingJsonRef.current.delete(stroke.json);
        const state = useCanvasStore.getState();
        syncUnsavedCount();
        state.showCanvasAlert(
          unsavedMessage(failedStrokes().length, state.saveError ?? '未知原因'),
          retryFailedStrokes,
        );
        throw new Error('笔画重试失败');
      }

      const savedLayer = created
        ? useCanvasStore
            .getState()
            .canvas?.layers.find((layer) => layer.id === created?.id)
        : null;

      if (
        !created ||
        !savedLayer ||
        savedLayer.content.kind !== 'fabric' ||
        savedLayer.content.json !== stroke.json
      ) {
        pendingJsonRef.current.delete(stroke.json);
        canvas.remove(stroke.path);
        pendingStrokesRef.current.delete(stroke.id);
        discardReason = '这一笔未保存：无法与服务端快照对齐。';
        continue;
      }

      objectsRef.current.set(created.id, stroke.path);
      signaturesRef.current.set(created.id, JSON.stringify(savedLayer.content));
      markPathSaved(stroke.path);
      pendingStrokesRef.current.delete(stroke.id);
      pendingJsonRef.current.delete(stroke.json);
    }

    canvas.requestRenderAll();
    const remaining = failedStrokes();
    syncUnsavedCount();

    if (remaining.length > 0) {
      const state = useCanvasStore.getState();
      state.showCanvasAlert(
        unsavedMessage(remaining.length, state.saveError ?? '未知原因'),
        retryFailedStrokes,
      );
      throw new Error('仍有笔画未保存');
    }

    useCanvasStore.getState().markPendingStrokesSaved();

    if (discardReason) {
      useCanvasStore.getState().showCanvasAlert(discardReason, null);
      return;
    }
  }

  useEffect(() => {
    const element = canvasElementRef.current;

    if (!element) {
      return;
    }

    const canvas = new Canvas(element, {
      width,
      height,
      backgroundColor,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;
    setActiveCanvas(canvas);
    canvas.isDrawingMode = useToolStore.getState().tool === 'brush';
    canvas.selection = false;

    // The canvas is rebuilt on resize; pick up whatever the session currently holds.
    const settings = useToolStore.getState();
    const brush = new PencilBrush(canvas);
    brush.color = settings.brushColor;
    brush.width = settings.brushWidth;
    canvas.freeDrawingBrush = brush;

    const handlePathCreated = (event: { path: Path }) => {
      const path = event.path;
      path.set({ selectable: false, evented: false });

      const state = useCanvasStore.getState();
      const current = state.canvas;

      if (!current) {
        // Defensive guard: never silently discard a stroke. Keep it on screen
        // and say why it was not saved, even if the UI state is inconsistent.
        setBlockedStroke('没有画布，这一笔没有保存。');
        canvas.requestRenderAll();
        return;
      }

      const json = JSON.stringify(path.toJSON());
      const pendingId = `stroke-${++pendingIdRef.current}`;
      const input: CreateLayerInput = {
        name: nextStrokeLayerName(current.layers),
        type: 'vector',
        content: { kind: 'fabric', json },
      };

      pendingJsonRef.current.add(json);
      pendingStrokesRef.current.set(pendingId, {
        id: pendingId,
        json,
        path,
        input,
        failed: false,
      });

      void state
        .createLayer(input)
        .then((created) => {
          pendingJsonRef.current.delete(json);
          pendingStrokesRef.current.delete(pendingId);

          if (created) {
            setBlockedStroke(null);
            objectsRef.current.set(created.id, path);
            signaturesRef.current.set(
              created.id,
              JSON.stringify({ kind: 'fabric', json }),
            );
          }

          syncUnsavedCount();
        })
        .catch(() => {
          pendingJsonRef.current.delete(json);
          const pending = pendingStrokesRef.current.get(pendingId);

          if (pending) {
            // Keep the stroke visible and marked as unsaved; retry re-runs the
            // same layer mutation against the current revision.
            pending.failed = true;
            markPathUnsaved(path);
            canvas.requestRenderAll();
          }

          const store = useCanvasStore.getState();
          const count = failedStrokes().length;
          store.setUnsavedStrokes(count);
          store.showCanvasAlert(
            unsavedMessage(count, store.saveError ?? '未知原因'),
            retryFailedStrokes,
          );
        });
    };

    const handleObjectModified = (event: { target?: FabricObject }) => {
      const target = event.target;

      if (!target) {
        return;
      }

      const layerId = findLayerId(target);

      if (!layerId) {
        return;
      }

      const state = useCanvasStore.getState();
      const layer = state.canvas?.layers.find((entry) => entry.id === layerId);

      if (!layer || layer.type !== 'ai-generated') {
        return;
      }

      const svg = `<svg xmlns="${SVG_NAMESPACE}" viewBox="0 0 ${width} ${height}">${target.toSVG()}</svg>`;
      signaturesRef.current.set(layerId, JSON.stringify({ kind: 'svg', svg }));

      void state
        .updateLayer(layerId, { content: { kind: 'svg', svg } })
        .catch(() => undefined);
    };

    canvas.on('path:created', handlePathCreated);
    canvas.on('object:modified', handleObjectModified);
    setReady(true);

    return () => {
      setReady(false);
      syncTokenRef.current += 1;
      objectsRef.current.clear();
      signaturesRef.current.clear();
      pendingJsonRef.current.clear();
      pendingStrokesRef.current.clear();
      fabricRef.current = null;
      setActiveCanvas(null);
      canvas.off('path:created', handlePathCreated);
      canvas.off('object:modified', handleObjectModified);
      void canvas.dispose();
    };
  }, [width, height, backgroundColor]);

  useEffect(() => {
    const canvas = fabricRef.current;

    if (!canvas) {
      return;
    }

    canvas.isDrawingMode = tool === 'brush';
    const selectMode = tool === 'select';

    for (const [layerId, object] of objectsRef.current) {
      const layer = layers?.find((entry) => entry.id === layerId);
      const selectable = selectMode && layer?.type === 'ai-generated';
      object.set({ selectable, evented: selectable });
    }

    if (!selectMode) {
      canvas.discardActiveObject();
    }

    canvas.requestRenderAll();
  }, [tool, layers]);

  useEffect(() => {
    const brush = fabricRef.current?.freeDrawingBrush;

    if (!brush) {
      return;
    }

    brush.color = brushColor;
    brush.width = brushWidth;
  }, [brushColor, brushWidth]);

  useEffect(() => {
    const canvas = fabricRef.current;

    if (!ready || !canvas || !layers) {
      return;
    }

    const token = ++syncTokenRef.current;
    const objects = objectsRef.current;
    const signatures = signaturesRef.current;

    void (async () => {
      const seen = new Set<string>();

      for (const layer of layers) {
        seen.add(layer.id);
        const signature = layerSignature(layer);
        const existing = objects.get(layer.id);

        if (existing) {
          if (signatures.get(layer.id) === signature) {
            existing.set({ visible: layer.visible, opacity: layer.opacity });
            continue;
          }

          canvas.remove(existing);
          objects.delete(layer.id);
          signatures.delete(layer.id);
        }

        if (
          layer.content.kind === 'fabric' &&
          pendingJsonRef.current.has(layer.content.json)
        ) {
          continue;
        }

        const object = await createFabricObject(layer);

        if (token !== syncTokenRef.current) {
          return;
        }

        if (object) {
          objects.set(layer.id, object);
          signatures.set(layer.id, signature);
          canvas.add(object);
        }
      }

      if (token !== syncTokenRef.current) {
        return;
      }

      for (const [layerId, object] of Array.from(objects.entries())) {
        if (!seen.has(layerId)) {
          canvas.remove(object);
          objects.delete(layerId);
          signatures.delete(layerId);
        }
      }

      canvas.requestRenderAll();
      setObjectsVersion((version) => version + 1);
    })();
  }, [ready, layers]);

  /**
   * 透明度滑块的本地预览（票 09）：只改 Fabric 对象的 `opacity`，不发 PATCH。
   * 松手后的 `change` 由图层面板提交；失败时它会把预览改回快照值。
   */
  useEffect(() => {
    setLayerOpacityPreviewHandler((layerId, opacity) => {
      const canvas = fabricRef.current;
      const object = objectsRef.current.get(layerId);

      if (!canvas || !object) {
        return;
      }

      object.set({ opacity });
      canvas.requestRenderAll();
    });

    return () => setLayerOpacityPreviewHandler(null);
  }, []);

  /**
   * Selecting an AI layer means selecting it on the canvas: it becomes Fabric's
   * active object, so the transform box, dragging and scaling all apply, and the
   * existing `object:modified` handler writes the result back as SVG. Brush
   * layers are not selectable objects, so they get the transient highlight below.
   */
  useEffect(() => {
    const canvas = fabricRef.current;

    if (!ready || !canvas || !layers) {
      return;
    }

    const explicit = activeLayerRequest !== lastSelectionRequestRef.current;
    lastSelectionRequestRef.current = activeLayerRequest;

    if (!activeLayerId) {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }

    const layer = layers.find((entry) => entry.id === activeLayerId);
    const object = objectsRef.current.get(activeLayerId);

    if (layer?.type !== 'ai-generated') {
      canvas.discardActiveObject();
      canvas.requestRenderAll();
      return;
    }

    if (!object || !layer.visible) {
      return;
    }

    // A transform box is only usable in select mode. Only an explicit click may
    // change the tool; merely loading a canvas with an AI layer on top must not
    // take the brush away from the user.
    if (useToolStore.getState().tool !== 'select') {
      if (explicit) {
        useToolStore.getState().setTool('select');
      }

      return;
    }

    canvas.setActiveObject(object);
    canvas.requestRenderAll();
  }, [activeLayerId, activeLayerRequest, ready, layers, tool, objectsVersion]);

  /**
   * Brush-layer location feedback: temporarily repaint the stroke, then restore
   * the exact previous paint properties. `activeLayerRequest` is bumped only by
   * an explicit selection, so a newly drawn stroke (which also becomes the
   * active layer) does not flash on every brush stroke.
   */
  useEffect(() => {
    const explicit = activeLayerRequest !== lastLocateRequestRef.current;
    lastLocateRequestRef.current = activeLayerRequest;

    if (!explicit || !ready) {
      return;
    }

    const canvas = fabricRef.current;
    const layer = layers?.find((entry) => entry.id === activeLayerId);
    const object = activeLayerId ? objectsRef.current.get(activeLayerId) : undefined;

    if (
      !canvas ||
      !layer ||
      layer.type === 'ai-generated' ||
      !layer.visible ||
      !object
    ) {
      return;
    }

    const paintable = object as FabricObject & { strokeWidth: number };
    const previousStroke = paintable.stroke;
    const previousStrokeWidth = paintable.strokeWidth;

    paintable.set({
      stroke: LOCATE_HIGHLIGHT_COLOR,
      strokeWidth: LOCATE_HIGHLIGHT_STROKE_WIDTH,
    });
    canvas.requestRenderAll();

    const timer = window.setTimeout(() => {
      paintable.set({
        stroke: previousStroke,
        strokeWidth: previousStrokeWidth,
      });
      canvas.requestRenderAll();
    }, LOCATE_HIGHLIGHT_DURATION_MS);

    return () => {
      window.clearTimeout(timer);
      paintable.set({
        stroke: previousStroke,
        strokeWidth: previousStrokeWidth,
      });

      // The canvas may already be disposed when the component unmounts.
      if (fabricRef.current === canvas) {
        canvas.requestRenderAll();
      }
    };
  }, [activeLayerRequest, activeLayerId, ready, layers]);
  // The document is scaled by CSS; report the real ratio in the status bar.
  useEffect(() => {
    const element = canvasElementRef.current;

    if (!element || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver((entries) => {
      const renderedWidth = entries[0]?.contentRect.width ?? 0;

      if (renderedWidth <= 0) {
        return;
      }

      useViewportStore
        .getState()
        .setZoomPercent(computeZoomPercent(renderedWidth, width));
    });

    observer.observe(element);

    return () => observer.disconnect();
  }, [width]);

  useEffect(
    () => () => {
      useViewportStore.getState().setZoomPercent(null);
    },
    [],
  );
  return (
    <div className="canvas-viewport">
      {canvasAlert ? (
        <div className="canvas-alert" role="alert">
          <p className="canvas-alert__message">{canvasAlert}</p>
          {hasCanvasRetry ? (
            <button
              type="button"
              className="canvas-alert__retry"
              onClick={() => void retryCanvasAlert()}
            >
              重试
            </button>
          ) : null}
          <button
            type="button"
            className="canvas-alert__dismiss"
            aria-label="关闭错误提示"
            onClick={dismissCanvasAlert}
          >
            ×
          </button>
        </div>
      ) : null}
      <div className="canvas-frame" style={{ aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvasElementRef} aria-label="画布" />
      </div>
      {blockedStroke ? (
        <p className="canvas-warning" role="alert">
          {blockedStroke}
        </p>
      ) : null}
    </div>
  );
}

async function createFabricObject(layer: PaintLayer): Promise<FabricObject | null> {
  try {
    let object: FabricObject | null = null;

    if (layer.content.kind === 'fabric') {
      const [enlivened] = await util.enlivenObjects<FabricObject>([
        JSON.parse(layer.content.json),
      ]);
      object = enlivened ?? null;
    } else {
      const { objects, options } = await loadSVGFromString(layer.content.svg);
      const nonEmpty = objects.filter((entry): entry is FabricObject => Boolean(entry));
      object = nonEmpty.length > 0 ? util.groupSVGElements(nonEmpty, options) : null;
    }

    const selectable =
      layer.type === 'ai-generated' && useToolStore.getState().tool === 'select';

    object?.set({
      selectable,
      evented: selectable,
      visible: layer.visible,
      opacity: layer.opacity,
    });

    return object;
  } catch {
    return null;
  }
}
