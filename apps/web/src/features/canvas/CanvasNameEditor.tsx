import { MAX_CANVAS_NAME_LENGTH } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { displayCanvasName } from '../../services/naming';
import { useCanvasStore } from '../../services/canvas-store';
import './canvas-name.css';

/**
 * The canvas name is the identity the user owns. Double-click (or the ✎
 * button) edits it in place; Enter/blur saves, Esc cancels, an empty value
 * reverts. The displayed name only ever comes from the daemon response, so a
 * failed rename cannot leave the menu bar claiming a name that was not saved.
 */
export function CanvasNameEditor() {
  const canvasId = useCanvasStore((state) => state.canvas?.id ?? null);
  const name = useCanvasStore((state) => state.canvas?.name ?? '');
  const renameCanvas = useCanvasStore((state) => state.renameCanvas);
  const [editing, setEditing] = useState(false);
  // 编辑器里显示的也走兜底名；草稿同样从显示值开始，避免「Untitled」出现在输入框。
  const [draft, setDraft] = useState(() => displayCanvasName(name));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Esc unmounts the input; the blur that follows must not save. */
  const cancelRequestedRef = useRef(false);

  useEffect(() => {
    if (!editing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // Switching canvases (new one or 返回上一张) must not carry this draft over.
  useEffect(() => {
    setEditing(false);
    setDraft(displayCanvasName(name));
    setError(null);
  }, [canvasId]);

  function beginEdit() {
    cancelRequestedRef.current = false;
    setDraft(displayCanvasName(name));
    setError(null);
    setEditing(true);
  }

  async function commit() {
    if (!editing || saving) {
      return;
    }

    const original = name;
    const originalDisplay = displayCanvasName(original);
    const trimmed = draft.trim();

    setEditing(false);

    // 空值或未改动回退原名；旧画布只显示「未命名」，不因为打开/确认编辑就写回。
    if (trimmed === '' || trimmed === originalDisplay) {
      setDraft(originalDisplay);
      return;
    }

    setSaving(true);

    try {
      await renameCanvas(trimmed);
      setError(null);
    } catch (caught) {
      // 失败回滚显示并就地提示，不出现「界面改了但服务端没改」。
      setDraft(originalDisplay);
      setError(caught instanceof Error ? caught.message : '画布改名失败');
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    cancelRequestedRef.current = true;
    setEditing(false);
    setDraft(displayCanvasName(name));
    setError(null);
  }

  function handleBlur() {
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false;
      return;
    }

    void commit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'Escape') {
      // 同时阻止全局 Esc（侧栏抽屉）抢走这次取消。
      event.preventDefault();
      event.stopPropagation();
      cancel();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      void commit();
    }
  }

  return (
    <span className="canvas-name">
      {editing ? (
        <input
          ref={inputRef}
          className="canvas-name__input"
          aria-label="画布名称"
          value={draft}
          maxLength={MAX_CANVAS_NAME_LENGTH}
          disabled={saving}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleBlur}
          onKeyDown={handleKeyDown}
        />
      ) : (
        <>
          <span
            className="document-name canvas-name__text"
            title="双击重命名"
            onDoubleClick={beginEdit}
          >
            {displayCanvasName(name)}
          </span>
          <button
            type="button"
            className="canvas-name__edit"
            aria-label="重命名画布"
            title="重命名画布"
            onClick={beginEdit}
            onKeyDown={(event) => {
              // 键盘走同一条入口：Tab 到 ✎，Enter/Space 进入编辑。
              if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
                event.preventDefault();
                beginEdit();
              }
            }}
            disabled={saving}
          >
            ✎
          </button>
        </>
      )}
      {error ? (
        <span className="canvas-name__error" role="alert">
          {error}
        </span>
      ) : null}
    </span>
  );
}
