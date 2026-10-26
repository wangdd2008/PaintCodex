import type { Layer } from '@paintcodex/protocol';

/**
 * 自动生成的图层名形如 `笔迹 3`。编号只看名字本身，不看列表长度：
 * 删掉中间图层后新笔画必须跳到「最大编号 + 1」，否则会和现存图层重名。
 */
const GENERATED_LAYER_NAME = /^笔迹\s+(\d+)$/;

/** 旧版本默认画布名；只作为显示兜底，不写回数据库。 */
const LEGACY_UNTITLED_NAME = 'Untitled';

/**
 * 下一个自动图层名：现有 `笔迹 N` 的最大编号 + 1，没有则从「笔迹 1」开始。
 *
 * 已有图层只参与编号计算，绝不改名——批量改写用户数据不可逆。
 */
export function nextStrokeLayerName(
  layers: ReadonlyArray<Pick<Layer, 'name'>>,
): string {
  let highest = 0;

  for (const layer of layers) {
    const match = GENERATED_LAYER_NAME.exec(layer.name.trim());
    const digits = match?.[1];

    if (digits === undefined) {
      continue;
    }

    const index = Number.parseInt(digits, 10);

    if (Number.isFinite(index) && index > highest) {
      highest = index;
    }
  }

  return `笔迹 ${highest + 1}`;
}

/**
 * 画布名的显示值：空名或旧默认名 `Untitled` 显示为「未命名」。
 *
 * 这是纯显示层兜底：请求体、快照与导出 JSON 仍使用数据库里的原值，
 * 因此打开一张旧画布不会触发任何写回。
 */
export function displayCanvasName(name: string | null | undefined): string {
  const trimmed = (name ?? '').trim();

  if (trimmed === '' || trimmed === LEGACY_UNTITLED_NAME) {
    return '未命名';
  }

  return name as string;
}
