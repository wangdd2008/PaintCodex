import type {
  AiExportResultRequest,
  AiRenderResultRequest,
  CanvasDocument,
  CreateCanvasRequest,
  CreateLayerInput,
  UpdateLayerPatch,
} from '@paintcodex/protocol';

interface ErrorBody {
  error?: {
    code?: string;
    message?: string;
  };
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, init);

  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as ErrorBody | null;

    throw new ApiError(
      body?.error?.message ?? `请求失败，状态码 ${response.status}`,
      response.status,
      body?.error?.code,
    );
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function createCanvas(input: CreateCanvasRequest = {}): Promise<CanvasDocument> {
  return request<CanvasDocument>('/paint/canvas', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
}

export function getCanvas(id: string): Promise<CanvasDocument> {
  return request<CanvasDocument>(`/paint/canvas/${encodeURIComponent(id)}`);
}

/** Canvas identity is the only mutable canvas field; geometry stays immutable. */
export function renameCanvas(id: string, name: string): Promise<CanvasDocument> {
  return request<CanvasDocument>(`/paint/canvas/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  });
}

export function createLayer(
  canvasId: string,
  input: CreateLayerInput,
  expectedRevision?: number,
): Promise<CanvasDocument> {
  return request<CanvasDocument>(`/paint/canvas/${encodeURIComponent(canvasId)}/layers`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...input, expectedRevision }),
  });
}

export function updateLayer(
  canvasId: string,
  layerId: string,
  patch: UpdateLayerPatch,
  expectedRevision?: number,
): Promise<CanvasDocument> {
  return request<CanvasDocument>(
    `/paint/canvas/${encodeURIComponent(canvasId)}/layers/${encodeURIComponent(layerId)}`,
    {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...patch, expectedRevision }),
    },
  );
}

export function deleteLayer(
  canvasId: string,
  layerId: string,
  expectedRevision?: number,
): Promise<CanvasDocument> {
  const query =
    expectedRevision === undefined ? '' : `?expectedRevision=${expectedRevision}`;

  return request<CanvasDocument>(
    `/paint/canvas/${encodeURIComponent(canvasId)}/layers/${encodeURIComponent(layerId)}${query}`,
    { method: 'DELETE' },
  );
}

export function undoCanvas(
  canvasId: string,
  expectedRevision?: number,
): Promise<CanvasDocument> {
  return request<CanvasDocument>(`/paint/canvas/${encodeURIComponent(canvasId)}/undo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision }),
  });
}

export function redoCanvas(
  canvasId: string,
  expectedRevision?: number,
): Promise<CanvasDocument> {
  return request<CanvasDocument>(`/paint/canvas/${encodeURIComponent(canvasId)}/redo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ expectedRevision }),
  });
}

/** Answers a `renderRequest` SSE frame with the PNG it asked for. */
export function postRenderResult(requestId: string, imageUrl: string): Promise<void> {
  const payload: AiRenderResultRequest = { requestId, imageUrl };

  return request<void>('/paint/ai/render-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

/**
 * Answers an `exportRequest` SSE frame. The browser already downloaded the
 * file, so only the filename and byte count travel back — never the image.
 */
export function postExportResult(
  requestId: string,
  outcome: { filename: string; bytes: number } | { error: string },
): Promise<void> {
  const payload: AiExportResultRequest =
    'error' in outcome
      ? { requestId, error: outcome.error }
      : { requestId, filename: outcome.filename, bytes: outcome.bytes };

  return request<void>('/paint/ai/export-result', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}
