import type { Layer as PaintLayer } from '@paintcodex/protocol';
import { useEffect, useRef } from 'react';
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
  const initialLayersRef = useRef<PaintLayer[]>(canvasDocument?.layers ?? []);

  const width = canvasDocument?.width ?? FALLBACK_WIDTH;
  const height = canvasDocument?.height ?? FALLBACK_HEIGHT;
  const backgroundColor = canvasDocument?.backgroundColor ?? '#ffffff';

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

      void state
        .createLayer({
          name: `Stroke ${current.layers.length + 1}`,
          type: 'vector',
          content: { kind: 'fabric', json: JSON.stringify(path.toJSON()) },
        })
        .catch(() => {
          canvas.remove(path);
          canvas.requestRenderAll();
        });
    };

    canvas.on('path:created', handlePathCreated);

    let disposed = false;

    void (async () => {
      const objects = await Promise.all(
        initialLayersRef.current.map((layer) => createFabricObject(layer)),
      );

      if (disposed) {
        return;
      }

      for (const object of objects) {
        if (object) {
          canvas.add(object);
        }
      }

      canvas.requestRenderAll();
    })();

    return () => {
      disposed = true;
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
