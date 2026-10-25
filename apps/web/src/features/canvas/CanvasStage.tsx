import { useEffect, useRef } from 'react';
import { Canvas } from 'fabric';
import { useCanvasStore } from '../../services/canvas-store';

const FALLBACK_WIDTH = 1920;
const FALLBACK_HEIGHT = 1080;

export function CanvasStage() {
  const canvasDocument = useCanvasStore((state) => state.canvas);
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);

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

    return () => {
      void canvas.dispose();
    };
  }, [width, height, backgroundColor]);

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
