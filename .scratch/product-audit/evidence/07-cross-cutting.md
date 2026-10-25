# 跨领域体验：响应式、可访问性、本地化、连接与错误反馈

## 响应式：390×844 视口下画布几乎不可用

现场把视口切到 390×844，并已有画布：

```json
{
  "viewport": [390, 844],
  "bodyScroll": [440, 844],
  "header": { "w": 439.92, "scrollW": 440 },
  "workspace": { "w": 439.92, "h": 772, "scrollW": 440 },
  "canvas": { "x": 81, "y": 393, "w": 34, "h": 18 },
  "sidePanel": { "x": 140, "w": 300 }
}
```

- 页面横向溢出 50px（body scrollWidth 440 > 390）。
- 侧栏固定 300px，工具条 56px，画布区被压缩到约 84px 宽。
- 画布实际显示 **34×18 px**，无法绘画。
- 菜单栏子项延伸到 x=424，超出视口。
- `app.css` 没有针对工作区的媒体查询；只有 `monitor.css` 有 1100px/640px 断点。

结论：在手机或窄窗口中，画布工作区不可用；没有折叠侧栏、没有工具条横向布局、没有最小画布尺寸策略。

## 可访问性

### 语言声明

- `apps/web/index.html`：`<html lang="en">`。
- 实际 UI 绝大多数为中文。
- 屏幕阅读器会用英文语音规则读中文；影响所有中文用户的无障碍体验。

### 键盘可达性

- 图层行 `<li>`：`tabIndex=-1`、无 `role`、无键盘处理。键盘用户只能 Tab 到“隐藏/删除”按钮，不能选中图层。
- 画布 `<canvas>` 有 `aria-label="PaintCodex canvas"`，但不可聚焦，没有键盘绘画替代方案；这对绘画应用可以接受，但应在产品上明确。
- 菜单/工具按钮可按 Tab 到达。
- 没有全局 `:focus-visible` 样式；依赖浏览器默认轮廓，部分自定义按钮在深色背景上可能不明显。

### 目标尺寸

- 图层可见性按钮 7×11 px。
- 图层删除按钮 16×16 px。
- 工具按钮约 39×36 px。
- 菜单按钮高 32 px。
- 均低于 WCAG 2.5.8 的 24×24 最低目标和常见 44×44 触控建议。

### 标签与语义

- AI 输入框只有 placeholder，没有显式 `<label>` 或 `aria-label`。
- 可见性按钮 `aria-label` 是动作（“隐藏/显示”），`aria-pressed` 是状态，语义混用。
- 聊天消息容器 `aria-live="polite"`，流式增量会不断触发朗读；长回复时可能非常吵。
- 图层类型 `vector` 是英文技术词，没有中文解释。

### 对比度

现场计算（WCAG 相对亮度）：

```json
[
  { "selector": ".panel-empty", "color": "rgb(116,119,133)", "bg": "rgb(27,28,33)", "font": "13px", "ratio": 3.82 },
  { "selector": ".ai-chat__empty", "color": "rgb(116,119,133)", "bg": "rgb(27,28,33)", "font": "13px", "ratio": 3.82 },
  { "selector": ".document-name", "color": "rgb(154,157,170)", "bg": "rgb(31,32,38)", "font": "12px", "ratio": 6.02 },
  { "selector": ".status-bar", "color": "rgb(154,157,170)", "bg": "rgb(31,32,38)", "font": "12px", "ratio": 6.02 }
]
```

- 空状态 13px 文本对比度 3.82:1，低于 AA 的 4.5:1。
- 次要文本（`.layer-item__type`、`.monitor-muted`）使用同一颜色，也存在同类问题。

## 本地化

现场可见的中英混用：

- `Untitled`（画布名、导出文件名）
- `Blank 1920 × 1080 canvas`
- `vector`（图层类型）
- `AI chat`（region aria-label，不可见但屏幕阅读器会读）
- `Logs:`（监控错误前缀）
- `chats`（AI 成功率单位）
- `<html lang="en">`

其余主要 UI 已是中文。近期提交在持续本地化，这些是遗漏点。

## 连接与实时状态

- 画布页没有任何“已连接/同步中/离线”指示。
- `subscribeToCanvas` 提供 `onError`，但 `App.tsx` 没有传入处理函数。
- SSE 断开时，用户仍可继续画，但其他标签页的修改不会出现；界面不会提示。
- 监控页有完整的 live 状态，但普通画布用户看不到。

## 保存与反馈

- 没有“保存中 / 已保存 / 保存失败”的常驻状态。
- `saving` 只用于禁用撤销、重做、删除；用户不知道后台正在写。
- 保存失败时错误显示在菜单栏 12px 红字，容易被忽略。
- 删除、隐藏、AI 生成图层都没有 toast 或操作结果提示。
- 自动下载 JSON 是唯一的“保存”可见行为，但它是错误的反馈形式。

## 错误与空状态

- 无画布时，图层面板说“尚未加载画布”，没有恢复动作。
- 无画布时画笔仍可用，画了会消失（见 `01-first-run.md`）。
- 导出失败、刷新失败都只在菜单栏显示短文本，没有重试。
- 监控页错误有 `role="alert"`，聊天错误也有；画布错误没有。

## 可引用的源码位置

- `apps/web/index.html`：lang。
- `apps/web/src/app/app.css`：固定 56px/300px 栅格，无工作区媒体查询。
- `apps/web/src/features/layer-panel/layer-panel.css`：目标尺寸。
- `apps/web/src/features/ai-chat/ai-chat.css`：`aria-live` 由组件设置，样式影响可读性。
- `apps/web/src/runtime/paint-sse.ts` 与 `apps/web/src/app/App.tsx`：onError 未使用。
- `apps/web/src/services/canvas-store.ts`：saving/error 状态。

## 待 PM 判断

1. 本轮是否承诺“桌面优先、窄屏可用”而不是完整移动端？
2. 7×11 目标、lang、对比度、图层键盘可达性，哪些必须本轮修？
3. 画布连接状态是否应复用监控页的 live 指示？
4. 中英混用应统一到中文，还是保留技术词？
