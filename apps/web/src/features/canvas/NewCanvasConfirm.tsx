import { useEffect, useRef, type KeyboardEvent } from 'react';

interface NewCanvasConfirmProps {
  canvasName: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

/**
 * A custom, in-canvas confirmation instead of `window.confirm`: the decision
 * stays inside the canvas area, is styleable and readable, and focuses
 * 「取消」 first so an Enter or Esc leaves the current canvas intact.
 */
export function NewCanvasConfirm({
  canvasName,
  busy,
  onConfirm,
  onCancel,
}: NewCanvasConfirmProps) {
  const cancelRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    cancelRef.current?.focus();
  }, []);

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key !== 'Escape' || busy) {
      return;
    }

    // 就地取消，同时避免全局 Esc（侧栏抽屉）也响应这一次按键。
    event.stopPropagation();
    onCancel();
  }

  return (
    <div
      className="new-canvas-confirm"
      role="alertdialog"
      aria-labelledby="new-canvas-confirm-title"
      aria-describedby="new-canvas-confirm-detail"
      onKeyDown={handleKeyDown}
    >
      <p id="new-canvas-confirm-title" className="new-canvas-confirm__title">
        新建画布？
      </p>
      <p id="new-canvas-confirm-detail" className="new-canvas-confirm__text">
        当前画布「{canvasName}」会保留在本地，但从界面移除。新建后可用「返回上一张」找回。
      </p>
      <div className="new-canvas-confirm__actions">
        <button
          ref={cancelRef}
          type="button"
          className="new-canvas-confirm__button"
          onClick={onCancel}
        >
          取消
        </button>
        <button
          type="button"
          className="new-canvas-confirm__button new-canvas-confirm__button--primary"
          onClick={onConfirm}
          disabled={busy}
        >
          {busy ? '新建中…' : '新建并切换'}
        </button>
      </div>
    </div>
  );
}
