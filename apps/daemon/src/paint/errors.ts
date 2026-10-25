export class CanvasNotFoundError extends Error {
  constructor() {
    super('Canvas not found');
    this.name = 'CanvasNotFoundError';
  }
}

export class LayerNotFoundError extends Error {
  constructor() {
    super('Layer not found');
    this.name = 'LayerNotFoundError';
  }
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `Canvas revision ${currentRevision} does not match expected revision ${expectedRevision}`,
    );
    this.name = 'RevisionConflictError';
  }
}
