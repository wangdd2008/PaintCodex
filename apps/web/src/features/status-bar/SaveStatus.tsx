import { useEffect, useState } from 'react';
import { useCanvasStore, type SaveState } from '../../services/canvas-store';

export const JUST_NOW_SECONDS = 15;

/** 保存失败时状态栏按钮的唯一文案。 */
const SAVE_FAILED_RETRY_TEXT = '保存失败 · 重试';

/** 保存状态的相对时间；每秒刷新一次。 */
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

/**
 * 保存状态文案。失败态由状态栏按钮单独承担，不会走到这里；
 * 因此入参排除 `'error'`，避免留下不可达的分支。
 */
export function saveStatusText(
  saveState: Exclude<SaveState, 'error'>,
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
    default:
      return '—';
  }
}

/**
 * 状态栏里唯一的保存状态位置。失败时保持为按钮，
 * 这样横幅被关掉后仍能从同一处重试同一次 mutation。
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
        {SAVE_FAILED_RETRY_TEXT}
      </button>
    );
  }

  return (
    <span className="status-bar__save" aria-live="polite">
      {saveStatusText(saveState, lastSavedAt, now)}
    </span>
  );
}
