/**
 * 画布缩略图：画布被打开时由浏览器渲染一帧 320×180 PNG 上传，daemon 不渲染
 * （spec §4、ADR-0010 §4）。阈值与尺寸全部写在前端常量里，服务端只负责存储。
 */

/** 缩略图输出固定尺寸。 */
export const THUMBNAIL_TARGET_WIDTH = 320;
export const THUMBNAIL_TARGET_HEIGHT = 180;

/**
 * 画布就绪、且距最后一次变更至少静默这么久才渲染。覆盖一笔结束后的网络在途
 * 与一次 SSE snapshot_changed，避免边画边生成。
 */
export const THUMBNAIL_IDLE_DEBOUNCE_MS = 800;

/**
 * 裁剪策略（写死）：**中心裁剪**到 16:9。
 *
 * 用 Fabric `toDataURL({ left, top, width, height, multiplier })` 直接在快照里
 * 裁出目标比例的源矩形，再按宽度算 multiplier 放大到 320 宽——不开新的离屏画布，
 * 也不做留白（留白需要合成一张新 canvas，与「不新开离屏画布」的要求冲突）。
 * 默认画布 1920×1080 本身就是 16:9，此时裁剪矩形就是整张画布。
 */
export interface ThumbnailCrop {
  left: number;
  top: number;
  width: number;
  height: number;
  multiplier: number;
}

export function computeThumbnailCrop(
  docWidth: number,
  docHeight: number,
): ThumbnailCrop {
  const targetAspect = THUMBNAIL_TARGET_WIDTH / THUMBNAIL_TARGET_HEIGHT;

  let cropWidth = docWidth;
  let cropHeight = docHeight;

  if (docWidth / docHeight > targetAspect) {
    // 文档比 16:9 更宽：以高度为准，裁掉左右两侧。
    cropWidth = docHeight * targetAspect;
  } else {
    // 文档比 16:9 更高（或等比）：以宽度为准，裁掉上下。
    cropHeight = docWidth / targetAspect;
  }

  return {
    left: (docWidth - cropWidth) / 2,
    top: (docHeight - cropHeight) / 2,
    width: cropWidth,
    height: cropHeight,
    multiplier: THUMBNAIL_TARGET_WIDTH / cropWidth,
  };
}

/** 上传缩略图；失败由调用方静默吞掉，不向用户报错。 */
export async function uploadCanvasThumbnail(
  canvasId: string,
  imageUrl: string,
  revision: number,
): Promise<void> {
  const response = await fetch(
    `/paint/canvas/${encodeURIComponent(canvasId)}/thumbnail`,
    {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ imageUrl, revision }),
    },
  );

  if (!response.ok) {
    throw new Error(`缩略图上传失败：HTTP ${response.status}`);
  }
}

/** 调度器在每次相关状态变化后被 `notify()`，满足条件才真正渲染上传。 */
export interface ThumbnailSnapshot {
  canvasId: string;
  revision: number;
  /** Fabric 画布已挂载、图层已同步。 */
  ready: boolean;
  /** 仍有画布 mutation 在途（保存中）。 */
  inFlightMutation: boolean;
}

export interface ThumbnailSchedulerDeps {
  getSnapshot: () => ThumbnailSnapshot | null;
  /** 走 Fabric 现有 toDataURL，返回 PNG data URL；取不到画布时返回 null。 */
  renderDataUrl: () => string | null;
  upload: (canvasId: string, imageUrl: string, revision: number) => Promise<void>;
  debug: (message: string) => void;
  /** 可注入的定时器，便于测试用假时钟。 */
  setTimeout?: typeof setTimeout;
  clearTimeout?: typeof clearTimeout;
}

/**
 * 懒生成调度器。要点：
 * - 距最后一次 `notify()` 静默 `THUMBNAIL_IDLE_DEBOUNCE_MS` 后才动手；
 * - 动手前再确认一次 `ready && !inFlightMutation`；
 * - 每个 canvasId 只上传到过的那个 revision，切换画布/刷新不重复上传；
 * - 上传失败只打 debug，不抛错、不影响画画与保存。
 */
export class ThumbnailScheduler {
  private readonly uploadedRevision = new Map<string, number>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private uploading = false;

  constructor(private readonly deps: ThumbnailSchedulerDeps) {}

  notify(): void {
    this.schedule();
  }

  dispose(): void {
    this.clearTimer();
  }

  private clearTimer(): void {
    if (this.timer !== null) {
      (this.deps.clearTimeout ?? clearTimeout)(this.timer);
      this.timer = null;
    }
  }

  private schedule(): void {
    this.clearTimer();
    this.timer = (this.deps.setTimeout ?? setTimeout)(() => {
      this.timer = null;
      void this.fire();
    }, THUMBNAIL_IDLE_DEBOUNCE_MS);
  }

  private async fire(): Promise<void> {
    if (this.uploading) {
      return;
    }

    const snapshot = this.deps.getSnapshot();

    if (!snapshot || !snapshot.ready || snapshot.inFlightMutation) {
      return;
    }

    const { canvasId, revision } = snapshot;

    if (this.uploadedRevision.get(canvasId) === revision) {
      return;
    }

    const imageUrl = this.deps.renderDataUrl();

    if (!imageUrl) {
      return;
    }

    this.uploading = true;

    try {
      await this.deps.upload(canvasId, imageUrl, revision);
      this.uploadedRevision.set(canvasId, revision);
    } catch (error) {
      this.deps.debug(`缩略图上传失败（静默，不影响画画）：${String(error)}`);
    } finally {
      this.uploading = false;
    }
  }
}
