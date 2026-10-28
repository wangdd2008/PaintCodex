import type {
  CanvasDocument,
  CreateLayerInput,
  Layer as PaintLayer,
} from '@paintcodex/protocol';
import { useEffect, useRef, useState } from 'react';
import {
  Canvas,
  PencilBrush,
  Point,
  loadSVGFromString,
  util,
  type FabricObject,
  type Path,
} from 'fabric';
import { setActiveCanvas } from '../../services/canvas-engine';
import {
  computeThumbnailCrop,
  ThumbnailScheduler,
  uploadCanvasThumbnail,
} from '../../services/canvas-thumbnail';
import {
  AI_SELECTION_DURATION_MS,
  useCanvasStore,
} from '../../services/canvas-store';
import { setLayerOpacityPreviewHandler } from '../../services/layer-preview';
import { nextStrokeLayerName } from '../../services/naming';
import {
  isNetworkFailure,
  NETWORK_FAILURE_MESSAGE,
} from '../../services/network-error';
import { useToolStore } from '../../services/tool-store';
import {
  clampScale,
  docRectToScreen,
  fitViewport,
  type ScreenRect,
  type ViewportTransform,
} from '../../services/viewport-math';
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
 * `canvas_select` 在**文档空间**里要圈出的矩形（文档像素）。它是高亮的
 * 逻辑位置，与视图无关；真正渲染到 DOM 时再经 docRectToScreen 换成屏幕像素。
 */
interface DocHighlightRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

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
  const frameRef = useRef<HTMLDivElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const objectsRef = useRef(new Map<string, FabricObject>());
  const signaturesRef = useRef(new Map<string, string>());
  const pendingJsonRef = useRef(new Set<string>());
  const pendingStrokesRef = useRef(new Map<string, PendingStroke>());
  const pendingIdRef = useRef(0);
  const syncTokenRef = useRef(0);
  const lastSelectionRequestRef = useRef(activeLayerRequest);
  const lastLocateRequestRef = useRef(activeLayerRequest);
  // 缩放/平移视口态：fit 模式下容器变化重算；手动缩放过则保持 scale。
  const fitModeRef = useRef(true);
  const spaceHeldRef = useRef(false);
  const lastPanRef = useRef<{ x: number; y: number } | null>(null);
  const thumbnailSchedulerRef = useRef<ThumbnailScheduler | null>(null);
  const readyRef = useRef(false);
  const [ready, setReady] = useState(false);
  const [objectsVersion, setObjectsVersion] = useState(0);
  const [blockedStroke, setBlockedStroke] = useState<string | null>(null);
  const [aiHighlight, setAiHighlight] = useState<ScreenRect | null>(null);
  // 高亮的逻辑位置（文档像素）与最近一次落到 DOM 的屏幕矩形。缩放/平移
  // 触发 after:render 时，用当前 viewportTransform 把文档矩形重算成屏幕像素。
  const docHighlightRef = useRef<DocHighlightRect | null>(null);
  const appliedHighlightRef = useRef<ScreenRect | null>(null);
  const [panning, setPanning] = useState(false);
  const aiSelection = useCanvasStore((state) => state.aiSelection);
  const isDrawing = useCanvasStore((state) => state.isDrawing);
  const saving = useCanvasStore((state) => state.saving);
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

  /** 读当前缩放比（视口矩阵的 a 分量）。 */
  function currentScale(): number {
    return fabricRef.current?.viewportTransform?.[0] ?? 1;
  }

  function reportZoom(): void {
    useViewportStore.getState().setZoomPercent(computeZoomPercent(currentScale()));
  }

  /** 读当前 Fabric 视口矩阵；拿不到（未挂载）时返回 null。 */
  function currentViewport(): ViewportTransform | null {
    const vpt = fabricRef.current?.viewportTransform;

    if (!vpt || vpt.length < 6) {
      return null;
    }

    return [vpt[0]!, vpt[1]!, vpt[2]!, vpt[3]!, vpt[4]!, vpt[5]!];
  }

  /**
   * 把高亮的文档矩形按当前视口矩阵换算成屏幕像素并落到状态。
   * 缩放/平移（after:render）与新指示都会调用；像素级无变化时跳过 setState，
   * 避免笔画渲染时频繁重渲。
   */
  function syncHighlightToScreen(): void {
    const docRect = docHighlightRef.current;
    const vpt = currentViewport();

    if (!docRect || !vpt) {
      if (appliedHighlightRef.current !== null) {
        appliedHighlightRef.current = null;
        setAiHighlight(null);
      }

      return;
    }

    const next = docRectToScreen(docRect, vpt);
    const prev = appliedHighlightRef.current;
    const same =
      prev !== null &&
      Math.round(prev.left) === Math.round(next.left) &&
      Math.round(prev.top) === Math.round(next.top) &&
      Math.round(prev.width) === Math.round(next.width) &&
      Math.round(prev.height) === Math.round(next.height);

    if (same) {
      return;
    }

    appliedHighlightRef.current = next;
    setAiHighlight(next);
  }

  /** 容器像素尺寸应用给 Fabric，并在 fit 模式下重新居中适配。 */
  function applyFitFromFrame(): void {
    const canvas = fabricRef.current;
    const frame = frameRef.current;

    if (!canvas || !frame) {
      return;
    }

    const cw = frame.clientWidth;
    const ch = frame.clientHeight;
    canvas.setDimensions({ width: cw, height: ch });
    canvas.setViewportTransform(fitViewport(cw, ch, width, height));
    fitModeRef.current = true;
    reportZoom();
  }

  /** 以容器中心为锚点缩放一个倍率（+/− 按钮）。 */
  function zoomByFactor(factor: number): void {
    const canvas = fabricRef.current;
    const frame = frameRef.current;

    if (!canvas || !frame) {
      return;
    }

    const next = clampScale(currentScale() * factor);

    if (next === currentScale()) {
      return;
    }

    canvas.zoomToPoint(new Point(frame.clientWidth / 2, frame.clientHeight / 2), next);
    fitModeRef.current = false;
    reportZoom();
  }

  /** 回到 100%：1 文档像素 = 1 CSS 像素，内容居中。 */
  function zoomTo100(): void {
    const canvas = fabricRef.current;
    const frame = frameRef.current;

    if (!canvas || !frame) {
      return;
    }

    canvas.setViewportTransform([
      1,
      0,
      0,
      1,
      (frame.clientWidth - width) / 2,
      (frame.clientHeight - height) / 2,
    ]);
    fitModeRef.current = false;
    reportZoom();
  }

  useEffect(() => {
    const element = canvasElementRef.current;

    if (!element) {
      return;
    }

    const canvas = new Canvas(element, {
      backgroundColor,
      preserveObjectStacking: true,
    });
    fabricRef.current = canvas;
    setActiveCanvas(canvas, { width, height });
    canvas.isDrawingMode = useToolStore.getState().tool === 'brush';
    canvas.selection = false;

    // ADR-0011：Fabric 画布尺寸 = 容器像素尺寸；文档尺寸仍是 width/height。
    // 初始即 fit：内容等比缩放后居中；缩放不持久化，切画布/刷新重新 fit。
    applyFitFromFrame();

    // The canvas is rebuilt on resize; pick up whatever the session currently holds.
    const settings = useToolStore.getState();
    const brush = new PencilBrush(canvas);
    brush.color = settings.brushColor;
    brush.width = settings.brushWidth;
    canvas.freeDrawingBrush = brush;

    const handlePathCreated = (event: { path: Path }) => {
      // A finished stroke is the strongest "drawing is over" signal we get,
      // even if the pointer was released outside the canvas.
      useCanvasStore.getState().setDrawing(false);

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

    /**
     * A pointer held down on a brush canvas is a stroke in progress. The AI
     * focus cue reads this instead of guessing from fabric's private state.
     */
    const handleMouseDown = () => {
      if (useToolStore.getState().tool === 'brush') {
        useCanvasStore.getState().setDrawing(true);
      }
    };
    const handleMouseUp = () => {
      useCanvasStore.getState().setDrawing(false);
    };

    /**
     * 缩放/平移后 Fabric 重绘的同一帧：DOM 高亮紧跟视口矩阵重算，不跳位、
     * 也不延迟到下一次 React 渲染（②05）。笔画重绘也触发此事件，但像素
     * 无变化时 sync 内部跳过 setState。
     */
    const handleAfterRender = () => {
      syncHighlightToScreen();
    };

    canvas.on('mouse:down', handleMouseDown);
    canvas.on('mouse:up', handleMouseUp);
    canvas.on('after:render', handleAfterRender);
    setReady(true);

    return () => {
      setReady(false);
      useCanvasStore.getState().setDrawing(false);
      syncTokenRef.current += 1;
      objectsRef.current.clear();
      signaturesRef.current.clear();
      pendingJsonRef.current.clear();
      pendingStrokesRef.current.clear();
      fabricRef.current = null;
      setActiveCanvas(null);
      canvas.off('path:created', handlePathCreated);
      canvas.off('object:modified', handleObjectModified);
      canvas.off('mouse:down', handleMouseDown);
      canvas.off('mouse:up', handleMouseUp);
      canvas.off('after:render', handleAfterRender);
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

    // Leaving the brush ends any stroke the canvas no longer tracks.
    if (tool !== 'brush') {
      useCanvasStore.getState().setDrawing(false);
    }

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

  /**
   * `canvas_select`'s cue: outline the chosen layer (from its real bounding box)
   * or area for three seconds. It is a DOM overlay rather than a fabric
   * mutation, so showing it can never disturb a stroke; while a stroke is in
   * progress it waits for `mouse:up` instead of appearing mid-draw.
   */
  useEffect(() => {
    if (
      !ready ||
      isDrawing ||
      !aiSelection ||
      aiSelection.canvasId !== canvasDocument.id
    ) {
      docHighlightRef.current = null;
      syncHighlightToScreen();
      return;
    }

    let docRect: DocHighlightRect | null = null;

    if (aiSelection.region) {
      const { x, y, width: regionWidth, height: regionHeight } = aiSelection.region;
      // 区域指示直接给文档坐标。
      docRect = { left: x, top: y, width: regionWidth, height: regionHeight };
    } else {
      const object = aiSelection.layerId
        ? objectsRef.current.get(aiSelection.layerId)
        : undefined;
      const bounds =
        typeof object?.getBoundingRect === 'function'
          ? object.getBoundingRect()
          : null;

      if (bounds) {
        // 图层指示取对象真实包围盒（文档坐标）。
        docRect = {
          left: bounds.left,
          top: bounds.top,
          width: bounds.width,
          height: bounds.height,
        };
      }
    }

    // 存文档矩形，再按当前视口换算成屏幕像素；之后缩放/平移由 after:render 续算。
    docHighlightRef.current = docRect;
    syncHighlightToScreen();
  }, [
    aiSelection,
    isDrawing,
    ready,
    width,
    height,
    objectsVersion,
    canvasDocument.id,
  ]);

  // 容器尺寸变化：同步 Fabric 画布尺寸；fit 模式重算适配，手动缩放过则保持 scale。
  useEffect(() => {
    const frame = frameRef.current;

    if (!frame || typeof ResizeObserver === 'undefined') {
      return;
    }

    const observer = new ResizeObserver(() => {
      const canvas = fabricRef.current;

      if (!canvas) {
        return;
      }

      canvas.setDimensions({ width: frame.clientWidth, height: frame.clientHeight });

      if (fitModeRef.current) {
        canvas.setViewportTransform(
          fitViewport(frame.clientWidth, frame.clientHeight, width, height),
        );
        reportZoom();
      }
    });

    observer.observe(frame);

    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, width, height]);

  // 滚轮以指针为中心缩放；scale clamp 在 [0.05, 8]。
  useEffect(() => {
    const frame = frameRef.current;

    if (!frame) {
      return;
    }

    const handleWheel = (event: WheelEvent) => {
      const canvas = fabricRef.current;

      if (!canvas) {
        return;
      }

      event.preventDefault();
      const next = clampScale(currentScale() * (event.deltaY < 0 ? 1.1 : 1 / 1.1));

      if (next === currentScale()) {
        return;
      }

      canvas.zoomToPoint(new Point(event.offsetX, event.offsetY), next);
      fitModeRef.current = false;
      reportZoom();
    };

    frame.addEventListener('wheel', handleWheel, { passive: false });

    return () => frame.removeEventListener('wheel', handleWheel);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, width, height]);

  // 空格按住 → 平移模式；输入框内不触发。
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== ' ' && event.code !== 'Space') {
        return;
      }

      const target = event.target as HTMLElement | null;

      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.isContentEditable)
      ) {
        return;
      }

      spaceHeldRef.current = true;
    };

    const handleKeyUp = (event: KeyboardEvent) => {
      if (event.key === ' ' || event.code === 'Space') {
        spaceHeldRef.current = false;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
    };
  }, []);

  useEffect(
    () => () => {
      useViewportStore.getState().setZoomPercent(null);
    },
    [],
  );

  // 懒生成缩略图：调度器在组件挂载期间只建一次，按 revision 去重，失败静默。
  useEffect(() => {
    const scheduler = new ThumbnailScheduler({
      getSnapshot: () => {
        const state = useCanvasStore.getState();
        const doc = state.canvas;

        if (!doc) {
          return null;
        }

        return {
          canvasId: doc.id,
          revision: doc.revision,
          ready: readyRef.current,
          inFlightMutation: state.saving,
        };
      },
      renderDataUrl: () => {
        const fabric = fabricRef.current;
        const doc = useCanvasStore.getState().canvas;

        // fabric 在测试里常是缺 toDataURL 的桩对象；缺能力时返回 null 跳过本轮缩略图，
        // 由调度器的 `!imageUrl` 分支静默忽略，避免未处理的 rejection。
        if (!fabric || !doc || typeof fabric.toDataURL !== 'function') {
          return null;
        }

        // 走 Fabric 现有 toDataURL，不开新的离屏画布；裁剪策略见 computeThumbnailCrop。
        const crop = computeThumbnailCrop(doc.width, doc.height);
        return fabric.toDataURL({ format: 'png', ...crop });
      },
      upload: (id, imageUrl, revision) => uploadCanvasThumbnail(id, imageUrl, revision),
      debug: (message) => console.debug(message),
    });

    thumbnailSchedulerRef.current = scheduler;

    return () => {
      scheduler.dispose();
      thumbnailSchedulerRef.current = null;
    };
  }, []);

  // ready 用 ref 暴露给调度器的 getSnapshot，避免重建调度器。
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // 画布就绪、图层同步完、保存空闲、或 revision 变化后，通知调度器重新评估。
  useEffect(() => {
    thumbnailSchedulerRef.current?.notify();
  }, [ready, saving, objectsVersion, canvasDocument.id, canvasDocument.revision]);

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
      <div
        ref={frameRef}
        className={panning ? 'canvas-frame canvas-frame--panning' : 'canvas-frame'}
        onPointerDown={(event) => {
          const canvas = fabricRef.current;

          if (!canvas) {
            return;
          }

          // 空格按住或鼠标中键 → 平移；其余指针事件照常给笔刷/对象。
          if (!spaceHeldRef.current && event.button !== 1) {
            return;
          }

          event.preventDefault();
          setPanning(true);
          lastPanRef.current = { x: event.clientX, y: event.clientY };
          event.currentTarget.setPointerCapture(event.pointerId);
        }}
        onPointerMove={(event) => {
          const canvas = fabricRef.current;
          const start = lastPanRef.current;

          if (!canvas || !start) {
            return;
          }

          const dx = event.clientX - start.x;
          const dy = event.clientY - start.y;
          lastPanRef.current = { x: event.clientX, y: event.clientY };
          canvas.relativePan(new Point(dx, dy));
          fitModeRef.current = false;
          reportZoom();
        }}
        onPointerUp={(event) => {
          if (!lastPanRef.current) {
            return;
          }

          lastPanRef.current = null;
          setPanning(false);
          event.currentTarget.releasePointerCapture(event.pointerId);
        }}
        onPointerCancel={() => {
          lastPanRef.current = null;
          setPanning(false);
        }}
      >
        <canvas ref={canvasElementRef} aria-label="画布" />
        {aiHighlight ? (
          <div
            className="canvas-ai-highlight"
            aria-hidden="true"
            style={{
              // 绝对像素定位（②05）：文档矩形已经视口矩阵换算成屏幕 CSS 像素。
              // 3px 边框是固定 CSS，不随缩放变粗。
              left: `${aiHighlight.left}px`,
              top: `${aiHighlight.top}px`,
              width: `${aiHighlight.width}px`,
              height: `${aiHighlight.height}px`,
              // The store owns the lifetime; the fade must match it.
              animationDuration: `${AI_SELECTION_DURATION_MS}ms`,
            }}
          />
        ) : null}
        <div className="canvas-zoom-controls" role="toolbar" aria-label="画布缩放控制">
          <button type="button" onClick={applyFitFromFrame} aria-label="适应窗口">
            适应窗口
          </button>
          <span className="canvas-zoom-controls__divider" aria-hidden="true" />
          <button type="button" onClick={zoomTo100} aria-label="缩放到 100%">
            100%
          </button>
          <span className="canvas-zoom-controls__divider" aria-hidden="true" />
          <button type="button" onClick={() => zoomByFactor(1 / 1.2)} aria-label="缩小">
            −
          </button>
          <button type="button" onClick={() => zoomByFactor(1.2)} aria-label="放大">
            +
          </button>
        </div>
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
