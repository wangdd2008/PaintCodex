export class CanvasNotFoundError extends Error {
  constructor() {
    super('画布不存在');
    this.name = 'CanvasNotFoundError';
  }
}

export class LayerNotFoundError extends Error {
  constructor() {
    super('图层不存在');
    this.name = 'LayerNotFoundError';
  }
}

export class RevisionConflictError extends Error {
  constructor(
    readonly expectedRevision: number,
    readonly currentRevision: number,
  ) {
    super(
      `画布版本 ${currentRevision} 与预期版本 ${expectedRevision} 不一致`,
    );
    this.name = 'RevisionConflictError';
  }
}

export class NothingToUndoError extends Error {
  constructor() {
    super('没有可撤销的操作');
    this.name = 'NothingToUndoError';
  }
}

export class NothingToRedoError extends Error {
  constructor() {
    super('没有可重做的操作');
    this.name = 'NothingToRedoError';
  }
}
