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

export function CanvasStage() {
  const canvasDocument = useCanvasStore((state) => state.canvas);
  const tool = useToolStore((state) => state.tool);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);
  const fabricRef = useRef<Canvas | null>(null);
  const objectsRef = useRef(new Map<string, FabricObject>());
  const pendingJsonRef = useRef(new Set<string>());
  const syncTokenRef = useRef(0);
  const [ready, setReady] = useState(false);

  const width = canvasDocument?.width ?? FALLBACK_WIDTH;
  const height = canvasDocument?.height ?? FALLBACK_HEIGHT;
  const backgroundColor = canvasDocument?.backgroundColor ?? '#ffffff';
  const layers = canvasDocument?.layers;

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
          }
        })
        .catch(() => {
          pendingJsonRef.current.delete(json);
          canvas.remove(path);
          canvas.requestRenderAll();
        });
    };

    canvas.on('path:created', handlePathCreated);
    setReady(true);

    return () => {
      setReady(false);
      syncTokenRef.current += 1;
      objectsRef.current.clear();
      pendingJsonRef.current.clear();
      fabricRef.current = null;
      setActiveCanvas(null);
      canvas.off('path:created', handlePathCreated);
      void canvas.dispose();
    };
  }, [width, height, backgroundColor]);

  useEffect(() => {
    if (fabricRef.current) {
      fabricRef.current.isDrawingMode = tool === 'brush';
    }
  }, [tool]);

  useEffect(() => {
    const canvas = fabricRef.current;

    if (!ready || !canvas || !layers) {
      return;
    }

    const token = ++syncTokenRef.current;
    const objects = objectsRef.current;

    void (async () => {
      const seen = new Set<string>();

      for (const layer of layers) {
        seen.add(layer.id);
        const existing = objects.get(layer.id);

        if (existing) {
          existing.set({ visible: layer.visible, opacity: layer.opacity });
          continue;
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

    object?.set({
      selectable: false,
      evented: false,
      visible: layer.visible,
      opacity: layer.opacity,
    });

    return object;
  } catch {
    return null;
  }
}
