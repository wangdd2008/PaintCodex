import { useEffect, useState } from 'react';
import { useCanvasStore, type SaveState } from '../../services/canvas-store';

export const JUST_NOW_SECONDS = 15;

/** Relative time for the one save status; refreshed once per second. */
export function formatSavedAt(lastSavedAt: number, now: number): string {
  const elapsedSeconds = Math.max(0, Math.floor((now - lastSavedAt) / 1000));

  if (elapsedSeconds <= JUST_NOW_SECONDS) {
    return '刚刚';
  }

  if (elapsedSeconds < 60) {
    return `${elapsedSeconds} 秒前`;
  }

  return `${Math.floor(elapsedSeconds / 60)} 分钟前`;
}

export function saveStatusText(
  saveState: SaveState,
  lastSavedAt: number | null,
  now: number,
): string {
  switch (saveState) {
    case 'saving':
      return '保存中…';
    case 'saved':
      return lastSavedAt === null
        ? '已保存'
        : `已保存 · ${formatSavedAt(lastSavedAt, now)}`;
    case 'error':
      return '保存失败 · 重试';
    default:
      return '—';
  }
}

/**
 * The single save status slot in the status bar. Failure stays a button so the
 * same mutation can be retried from here after the banner was dismissed.
 */
export function SaveStatus() {
  const saveState = useCanvasStore((state) => state.saveState);
  const lastSavedAt = useCanvasStore((state) => state.lastSavedAt);
  const hasRetry = useCanvasStore((state) => state.canvasRetry !== null);
  const retryCanvasAlert = useCanvasStore((state) => state.retryCanvasAlert);
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (saveState !== 'saved') {
      return;
    }

    setNow(Date.now());
    const timer = window.setInterval(() => setNow(Date.now()), 1000);

    return () => window.clearInterval(timer);
  }, [saveState, lastSavedAt]);

  if (saveState === 'error') {
    return (
      <button
        type="button"
        className="status-bar__retry"
        disabled={!hasRetry}
        onClick={() => void retryCanvasAlert()}
      >
        保存失败 · 重试
      </button>
    );
  }

  return (
    <span className="status-bar__save" aria-live="polite">
      {saveStatusText(saveState, lastSavedAt, now)}
    </span>
  );
}
