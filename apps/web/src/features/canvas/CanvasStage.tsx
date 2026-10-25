import type { Layer as PaintLayer } from '@paintcodex/protocol';
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

function layerSignature(layer: PaintLayer): string {
  return JSON.stringify(layer.content);
}

export function CanvasStage() {
  const canvasDocument = useCanvasStore((state) => state.canvas);
  const tool = useToolStore((state) => state.tool);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const objectsRef = useRef(new Map<string, FabricObject>());
  const signaturesRef = useRef(new Map<string, string>());
  const pendingJsonRef = useRef(new Set<string>());
  const syncTokenRef = useRef(0);
  const [ready, setReady] = useState(false);

  const width = canvasDocument?.width ?? FALLBACK_WIDTH;
  const height = canvasDocument?.height ?? FALLBACK_HEIGHT;
  const backgroundColor = canvasDocument?.backgroundColor ?? '#ffffff';
  const layers = canvasDocument?.layers;

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
        canvas.remove(path);
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
    })();
  }, [ready, layers]);

  return (
    <div className="canvas-viewport">
      <div className="canvas-frame" style={{ aspectRatio: `${width} / ${height}` }}>
        <canvas ref={canvasElementRef} aria-label="PaintCodex canvas" />
      </div>
      <p className="canvas-hint">
        {canvasDocument
          ? `${canvasDocument.name} · ${width} × ${height}`
          : `Blank ${FALLBACK_WIDTH} × ${FALLBACK_HEIGHT} canvas`}
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
