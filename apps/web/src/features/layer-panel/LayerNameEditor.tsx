import type { Layer } from '@paintcodex/protocol';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useCanvasStore } from '../../services/canvas-store';

/**
 * 图层名的长度上限。协议没有约束图层名（票 09 不改协议），只在前端兜住：
 * 60 个字符足够表达，又不会把 38px 的行撑坏；超出部分输入时即截断。
 */
export const MAX_LAYER_NAME_LENGTH = 60;

/**
 * 提交前归一化：去掉首尾空白，把制表符/换行/连续空格折叠成一个空格。
 * 名称会进入行 `aria-label`、删除恢复条与导出 JSON，不能带着控制字符到处跑。
 */
export function normalizeLayerName(value: string): string {
  return value.replace(/\s+/g, ' ').trim();
}

interface LayerNameEditorProps {
  layer: Layer;
}

/**
 * 行内重命名：双击名称或 ✎ 小按钮进入，Enter/失焦提交，Esc 取消，空值回退原名。
 *
 * 显示名只在 PATCH 成功后（快照更新）才算数：提交后先显示乐观值，失败则撤回，
 * 不会出现「界面改了但服务端没改」。失败原因与重试复用画布顶部横幅
 * （票 02 的统一错误面），不在同一行重复第二条错误信息。
 */
export function LayerNameEditor({ layer }: LayerNameEditorProps) {
  const updateLayer = useCanvasStore((state) => state.updateLayer);
  const showCanvasAlert = useCanvasStore((state) => state.showCanvasAlert);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(layer.name);
  /** 已提交、快照还没回来的名称：先显示，失败再撤回。 */
  const [pendingName, setPendingName] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const editingRef = useRef(false);
  const committingRef = useRef(false);
  /** Esc 会卸载输入框，紧随其后的 blur 不能再提交一次。 */
  const cancelRequestedRef = useRef(false);
  const displayName = pendingName ?? layer.name;

  useEffect(() => {
    if (!editing) {
      return;
    }

    inputRef.current?.focus();
    inputRef.current?.select();
  }, [editing]);

  // 快照里的名称是唯一真相：撤销、其它标签页同步、改名成功都以它为准。
  useEffect(() => {
    if (!editing) {
      setDraft(displayName);
    }
  }, [displayName, editing]);

  function switchEditing(next: boolean) {
    editingRef.current = next;
    setEditing(next);
  }

  function beginEdit() {
    cancelRequestedRef.current = false;
    setDraft(displayName);
    switchEditing(true);
  }

  function cancel() {
    cancelRequestedRef.current = true;
    setDraft(displayName);
    switchEditing(false);
  }

  async function commit() {
    if (!editingRef.current || committingRef.current) {
      return;
    }

    const normalized = normalizeLayerName(draft);
    switchEditing(false);

    if (normalized === '') {
      // 空值回退原名：服务端只校验类型、会接受空串，所以在这里主动拦住。
      setDraft(displayName);
      showCanvasAlert('图层名称不能为空，已保留原名。', null);
      return;
    }

    if (normalized === displayName) {
      setDraft(displayName);
      return;
    }

    committingRef.current = true;
    setPendingName(normalized);

    try {
      await updateLayer(layer.id, { name: normalized });
    } catch {
      // 失败回滚：清掉乐观值，显示名回到快照里的原名。
      // 原因与重试已由 updateLayer 落到画布顶部横幅。
    } finally {
      committingRef.current = false;
      setPendingName(null);
    }
  }

  function handleBlur() {
    if (cancelRequestedRef.current) {
      cancelRequestedRef.current = false;
      return;
    }

    void commit();
  }

  function handleKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    // 编辑态独占按键：既不把 ↑/↓/Home/End/Enter/Delete 交给行级导航（票 08），
    // 也不让 Esc 冒泡去关窄屏抽屉（票 14）。
    event.stopPropagation();

    if (event.key === 'Escape') {
      event.preventDefault();
      cancel();
      return;
    }

    if (event.key === 'Enter') {
      event.preventDefault();
      void commit();
    }
  }

  if (editing) {
    return (
      <span className="layer-item__name layer-item__name--editing">
        <input
          ref={inputRef}
          className="layer-item__name-input"
          aria-label={`重命名 ${displayName}`}
          value={draft}
          maxLength={MAX_LAYER_NAME_LENGTH}
          onChange={(event) => setDraft(event.target.value)}
          onBlur={handleBlur}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={handleKeyDown}
        />
      </span>
    );
  }

  return (
    <span className="layer-item__name">
      <span
        className="layer-item__name-text"
        title={`${displayName}（双击重命名）`}
        onDoubleClick={(event) => {
          event.stopPropagation();
          beginEdit();
        }}
      >
        {displayName}
      </span>
      <button
        type="button"
        className="layer-item__rename"
        aria-label={`重命名 ${displayName}`}
        title="重命名图层"
        onClick={(event) => {
          event.stopPropagation();
          beginEdit();
        }}
        onKeyDown={(event) => {
          // 原生按钮也会响应 Enter/Space；显式处理让键盘路径不依赖浏览器合成 click。
          if (event.key === 'Enter' || event.key === ' ' || event.key === 'Spacebar') {
            event.preventDefault();
            event.stopPropagation();
            beginEdit();
          }
        }}
      >
        <svg
          className="icon-edit"
          viewBox="0 0 16 16"
          width="12"
          height="12"
          aria-hidden="true"
        >
          <path
            d="M11.5 2.2 13.8 4.5 5.2 13.1 2 14 2.9 10.8z"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            strokeLinejoin="round"
          />
        </svg>
      </button>
    </span>
  );
}
