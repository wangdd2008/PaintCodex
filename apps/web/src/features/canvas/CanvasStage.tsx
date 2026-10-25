import { useEffect, useRef } from 'react';
import { Canvas } from 'fabric';

const CANVAS_WIDTH = 1920;
const CANVAS_HEIGHT = 1080;

export function CanvasStage() {
  const canvasElementRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const element = canvasElementRef.current;

    if (!element) {
      return;
    }

    const canvas = new Canvas(element, {
      width: CANVAS_WIDTH,
      height: CANVAS_HEIGHT,
      backgroundColor: '#ffffff',
      preserveObjectStacking: true,
    });

    return () => {
      void canvas.dispose();
    };
  }, []);

  return (
    <div className="canvas-viewport">
      <div className="canvas-frame">
        <canvas ref={canvasElementRef} aria-label="PaintCodex canvas" />
      </div>
      <p className="canvas-hint">
        Blank {CANVAS_WIDTH} × {CANVAS_HEIGHT} canvas
      </p>
    </div>
  );
}
