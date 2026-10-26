import type { CanvasDocument, Layer as PaintLayer } from '@paintcodex/protocol';
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
import { useToolStore } from '../../services/tool-store';

const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;
const BRUSH_COLOR = '#111111';
const BRUSH_WIDTH = 4;
const SVG_NAMESPACE = 'http://www.w3.org/2000/svg';

/**
 * Locating a brush layer is a transient, client-only cue: the stroke is
 * repainted in a louder color for 800ms and then restored from the values we
 * captured. Nothing here is written back to the daemon.
 */
const LOCATE_HIGHLIGHT_COLOR = '#ff8a00';
const LOCATE_HIGHLIGHT_STROKE_WIDTH = 8;
const LOCATE_HIGHLIGHT_DURATION_MS = 800;

const NETWORK_ERROR_PATTERN =
  /failed to fetch|networkerror|load failed|network request failed/i;

/**
 * Turns technical transport failures into a Chinese, actionable reason. The
 * daemon already answers in Chinese; only network-level errors need mapping.
 */
function describeCanvasFailure(error: string | null): string {
  if (!error) {
    return '无法加载画布，请稍后重试。';
  }

  return NETWORK_ERROR_PATTERN.test(error)
    ? '无法连接本地服务，请确认服务已启动后重试。'
    : error;
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
   * call sees "loading" and does nothing.
   */
  const startCanvas = () => {
    const state = useCanvasStore.getState();

    if (state.canvas || state.status === 'loading') {
      return;
    }

    void state.createNewCanvas();
  };

  const retry = () => {
    const state = useCanvasStore.getState();

    if (state.canvas || state.status === 'loading') {
      return;
    }

    if (state.requestedCanvasId) {
      void state.loadCanvas(state.requestedCanvasId);
    } else {
      void state.createNewCanvas();
    }
  };

  if (canvasDocument) {
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
    <div className="canvas-gate canvas-gate--empty">
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
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const objectsRef = useRef(new Map<string, FabricObject>());
  const signaturesRef = useRef(new Map<string, string>());
  const pendingJsonRef = useRef(new Set<string>());
  const syncTokenRef = useRef(0);
  const lastSelectionRequestRef = useRef(activeLayerRequest);
  const lastLocateRequestRef = useRef(activeLayerRequest);
  const [ready, setReady] = useState(false);
  const [objectsVersion, setObjectsVersion] = useState(0);
  const [blockedStroke, setBlockedStroke] = useState<string | null>(null);

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

    const brush = new PencilBrush(canvas);
    brush.color = BRUSH_COLOR;
    brush.width = BRUSH_WIDTH;
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
      pendingJsonRef.current.add(json);

      void state
        .createLayer({
          name: `Stroke ${current.layers.length + 1}`,
          type: 'vector',
          content: { kind: 'fabric', json },
        })
        .then((created) => {
          pendingJsonRef.current.delete(json);

          if (created) {
            setBlockedStroke(null);
            objectsRef.current.set(created.id, path);
            signaturesRef.current.set(
              created.id,
              JSON.stringify({ kind: 'fabric', json }),
            );
          }
        })
        .catch(() => {
          pendingJsonRef.current.delete(json);
          canvas.remove(path);
          canvas.requestRenderAll();
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

  return (
    <div className="canvas-viewport">
      <div className="canvas-frame" style={{ aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvasElementRef} aria-label="PaintCodex canvas" />
      </div>
      {blockedStroke ? (
        <p className="canvas-warning" role="alert">
          {blockedStroke}
        </p>
      ) : null}
      <p className="canvas-hint">
        {canvasDocument.name} · {width} × {height}
      </p>
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
