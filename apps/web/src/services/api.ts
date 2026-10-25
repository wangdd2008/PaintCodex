import type {
  CanvasDocument,
  CreateCanvasRequest,
  CreateLayerInput,
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
      body?.error?.message ?? `Request failed with status ${response.status}`,
      response.status,
      body?.error?.code,
    );
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
