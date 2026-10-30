import { useEffect, useState } from 'react';
import type { CanvasSummary } from '@paintcodex/protocol';
import {
  deleteCanvas,
  listCanvases,
  renameCanvas,
} from '../../services/api';
import { describeCanvasError, useCanvasStore } from '../../services/canvas-store';
import { useChatStore } from '../ai-chat/chat-store';
import { displayCanvasName } from '../../services/naming';
import { buildCanvasUrl } from '../../app/view-route';
import { formatRelativeTime } from './canvas-library-time';
import './canvas-library.css';

const PAGE_SIZE = 50;

interface CanvasLibraryPageProps {
  /** 点卡片打开一张画布：外层负责 pushState 与 loadCanvas。 */
  onOpenCanvas: (id: string) => void;
  /** 空态/菜单 CTA：外层负责新建 + replaceState 到新画布。 */
  onCreateCanvas: () => void;
}

/**
 * 画布库（ADR-0010）：找回入口，不负责写入。进入时拉一次列表，不订阅 SSE。
 */
export function CanvasLibraryPage({
  onOpenCanvas,
  onCreateCanvas,
}: CanvasLibraryPageProps) {
  const [items, setItems] = useState<CanvasSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function loadFirstPage() {
    setLoading(true);
    setLoadError(null);
    try {
      const page = await listCanvases(PAGE_SIZE, 0);
      setItems(page.items);
      setTotal(page.total);
    } catch (error) {
      setLoadError(describeCanvasError(error, '画布列表加载失败'));
    } finally {
      setLoading(false);
    }
  }

  async function loadMore() {
    if (loadingMore) {
      return;
    }

    setLoadingMore(true);
    try {
      const page = await listCanvases(PAGE_SIZE, items.length);
      setItems((prev) => [...prev, ...page.items]);
      setTotal(page.total);
    } finally {
      setLoadingMore(false);
    }
  }

  useEffect(() => {
    void loadFirstPage();
    // 进入库时拉一次即可（spec Out of Scope：库不实时刷新）。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleCardOpened(id: string) {
    onOpenCanvas(id);
  }

  function handleRenamed(id: string, name: string) {
    setItems((prev) => prev.map((item) => (item.id === id ? { ...item, name } : item)));
  }

  function handleDeleted(id: string) {
    setItems((prev) => prev.filter((item) => item.id !== id));
    setTotal((prev) => Math.max(0, prev - 1));

    // 画布没了，它的会话记录也没有归属了；留着只会在 sessionStorage 里堆积。
    useChatStore.getState().dropTranscript(id);

    // 删的是当前打开的画布：工作区里那张已经不存在了，清掉活动画布槽。
    if (useCanvasStore.getState().canvas?.id === id) {
      useCanvasStore.getState().closeActiveCanvas();
    }
  }

  if (loading) {
    return (
      <main className="library-area" aria-busy="true">
        <h1 className="library-title">画布库</h1>
        加载中…
      </main>
    );
  }

  if (loadError) {
    return (
      <main className="library-area">
        <h1 className="library-title">画布库</h1>
        <p role="alert" className="library-error">
          {loadError}
        </p>
        <button type="button" className="menu-button" onClick={() => void loadFirstPage()}>
          重试
        </button>
      </main>
    );
  }

  if (items.length === 0) {
    return (
      <main className="library-area library-area--empty">
        <div className="library-empty">
          <h1 className="library-title">画布库</h1>
          <p className="library-empty__text">还没有画布。新建一张，开始绘画。</p>
          <button type="button" className="library-cta" onClick={onCreateCanvas}>
            新建画布
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="library-area">
      <h1 className="library-title">画布库</h1>
      <div className="library-grid">
        {items.map((item) => (
          <CanvasCard
            key={item.id}
            summary={item}
            onOpen={handleCardOpened}
            onRenamed={handleRenamed}
            onDeleted={handleDeleted}
          />
        ))}
      </div>
      {items.length < total ? (
        <div className="library-more">
          <button
            type="button"
            className="menu-button"
            disabled={loadingMore}
            onClick={() => void loadMore()}
          >
            {loadingMore ? '加载中…' : '加载更多'}
          </button>
        </div>
      ) : null}
    </main>
  );
}

interface CanvasCardProps {
  summary: CanvasSummary;
  onOpen: (id: string) => void;
  onRenamed: (id: string, name: string) => void;
  onDeleted: (id: string) => void;
}

function CanvasCard({ summary, onOpen, onRenamed, onDeleted }: CanvasCardProps) {
  const [confirming, setConfirming] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const displayName = displayCanvasName(summary.name);

  function handleOpen(event: React.MouseEvent<HTMLAnchorElement>) {
    // 真实 <a> 保留中键/新标签语义；左键交给外层做无刷新的 pushState。
    if (event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) {
      return;
    }

    event.preventDefault();
    onOpen(summary.id);
  }

  async function confirmDelete() {
    if (deleting) {
      return;
    }

    setDeleting(true);
    setDeleteError(null);

    try {
      await deleteCanvas(summary.id);
      onDeleted(summary.id);
    } catch (error) {
      // 失败就地提示，卡片保留在列表里。
      setDeleteError(describeCanvasError(error, '删除失败'));
      setDeleting(false);
      setConfirming(false);
    }
  }

  return (
    <article className="canvas-card">
      {confirming ? (
        <div className="canvas-card__confirm" role="alertdialog" aria-label={`删除画布「${displayName}」`}>
          <p className="canvas-card__confirm-text">
            删除画布「{displayName}」？此操作不可恢复。
          </p>
          <div className="canvas-card__confirm-actions">
            <button type="button" className="menu-button" onClick={() => setConfirming(false)}>
              取消
            </button>
            <button
              type="button"
              className="menu-button menu-button--danger"
              onClick={() => void confirmDelete()}
              disabled={deleting}
            >
              {deleting ? '删除中…' : '删除'}
            </button>
          </div>
        </div>
      ) : (
        <>
          <a
            className="canvas-card__open"
            href={buildCanvasUrl(window.location.href, summary.id)}
            onClick={handleOpen}
          >
            <div className="canvas-card__thumb" style={{ backgroundColor: summary.backgroundColor }}>
              {summary.hasThumbnail ? (
                <img
                  className="canvas-card__thumb-img"
                  src={`/paint/canvas/${encodeURIComponent(summary.id)}/thumbnail`}
                  alt=""
                />
              ) : (
                <span className="canvas-card__thumb-fallback">{displayName.charAt(0)}</span>
              )}
            </div>
            <div className="canvas-card__body">
              <CardNameField summary={summary} onRenamed={onRenamed} />
              <div className="canvas-card__meta">
                <span>
                  {summary.width} × {summary.height}
                </span>
                <span>{summary.layerCount} 层</span>
              </div>
              <div className="canvas-card__time">{formatRelativeTime(summary.updatedAt)}</div>
            </div>
          </a>
          <div className="canvas-card__actions">
            <button
              type="button"
              className="menu-button canvas-card__delete"
              aria-label={`删除画布「${displayName}」`}
              title="删除画布"
              onClick={() => {
                setDeleteError(null);
                setConfirming(true);
              }}
            >
              删除
            </button>
          </div>
          {deleteError ? (
            <p role="alert" className="canvas-card__error">
              {deleteError}
            </p>
          ) : null}
        </>
      )}
    </article>
  );
}

interface CardNameFieldProps {
  summary: CanvasSummary;
  onRenamed: (id: string, name: string) => void;
}

/**
 * 卡片上的行内重命名，与菜单栏 CanvasNameEditor 同一条交互规范：
 * ✎ 进入，Enter/失焦提交，Esc 取消，空值回退原名，失败回滚并就地提示。
 */
function CardNameField({ summary, onRenamed }: CardNameFieldProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(displayCanvasName(summary.name));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  function beginEdit() {
    setDraft(displayCanvasName(summary.name));
    setError(null);
    setEditing(true);
  }

  async function commit() {
    if (!editing || saving) {
      return;
    }

    const original = displayCanvasName(summary.name);
    const trimmed = draft.trim();
    setEditing(false);

    if (trimmed === '' || trimmed === original) {
      setDraft(original);
      return;
    }

    setSaving(true);
    try {
      const updated = await renameCanvas(summary.id, trimmed);
      onRenamed(summary.id, updated.name);
      setError(null);
    } catch (caught) {
      setDraft(original);
      setError(describeCanvasError(caught, '重命名失败'));
    } finally {
      setSaving(false);
    }
  }

  function cancel() {
    setEditing(false);
    setDraft(displayCanvasName(summary.name));
    setError(null);
  }

  if (editing) {
    return (
      <input
        className="canvas-card__name-input"
        aria-label="画布名称"
        autoFocus
        value={draft}
        disabled={saving}
        onChange={(event) => setDraft(event.target.value)}
        onBlur={() => void commit()}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.stopPropagation();
            cancel();
          } else if (event.key === 'Enter') {
            event.preventDefault();
            void commit();
          }
        }}
      />
    );
  }

  return (
    <div className="canvas-card__name-row">
      <span className="canvas-card__name" title="双击重命名" onDoubleClick={beginEdit}>
        {displayCanvasName(summary.name)}
      </span>
      <button
        type="button"
        className="canvas-card__rename"
        aria-label={`重命名画布「${displayCanvasName(summary.name)}」`}
        title="重命名"
        onClick={beginEdit}
        disabled={saving}
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
      {error ? (
        <span role="alert" className="canvas-card__error">
          {error}
        </span>
      ) : null}
    </div>
  );
}
