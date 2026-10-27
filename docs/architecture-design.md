# AI 画图软件架构设计文档

> 基于 OpenCreator 架构模式参考设计的个人 AI 画图工具

**文档状态**：2026-10-27 — 第二、四、七章与第十一章的 AI 部分已按 [ADR-0009](adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md) 重写为**目标态**（Codex dynamic tools）。**当前实现仍是 marker 协议**，逐切片补齐的计划见 `.scratch/codex-native-tools/`；画布、存储、Desktop 等章节仍为规划，Phase 1 的实际落地以 `.scratch/phase-1-mvp/` 与 README 为准。

---

## 一、项目定位

一款面向个人用户的 AI 辅助画图软件，支持 Web 和 Desktop（Electron）双端，融合传统画图工具（笔刷、形状、文字）与 AI 辅助画图（一个通过原生工具操作画布的 agent）。

核心设计理念：**"人机同权"**——人类用户和 AI Agent 共用同一套命令接口和状态机。

---

## 二、架构决策汇总

| 编号 | 决策项 | 选择 | 说明 |
|------|--------|------|------|
| Q1 | 数据模型 | 单文件模式 | 一个作品就是一个文件，内部包含图层、历史记录、元数据 |
| Q2 | AI 交互模式 | 融合模式 | 侧边栏对话面板（复杂任务）+ 画布内快捷指令（快速修改） |
| Q3 | 渲染引擎 | Fabric.js / Konva.js | 基于成熟的 Canvas 2D 库，快速验证核心逻辑 |
| Q4 | 文件格式 | 双格式导出 | 工作时保存专有格式（完整信息），导出时生成标准图片 |
| Q5 | AI 图层策略 | 强制新建 AI 图层 | 新内容一律新建 AI 图层；已存在的图层可由 canvas_update_layer 改写，删除需确认 |
| Q6 | 存储策略 | 统一后端存储 | Web 和 Desktop 共用 Daemon 后端，Desktop 额外桥接本地文件选择 |
| Q7 | Codex 工具集 | 7 个核心工具 + 1 个预览工具 | canvas_get_context, canvas_create_layer, canvas_update_layer, canvas_delete_layer, canvas_select, canvas_export_png, canvas_undo, canvas_render_preview |
| Q8 | Undo/Redo | 快照级撤销 | 每次操作后保存画布完整快照，Undo 时恢复 |
| Q9 | AI 安全策略 | 智能确认 | 可逆操作自动执行，不可逆操作请求确认 |
| Q10 | AI 图片生成 | 纯 Codex 代码生成 | AI 通过生成 Canvas/SVG 代码来绘制图形，而非调用图像生成 API |
| Q11 | AI 上下文 | 拉为主 + 最小摘要 | 提示词只给画布标识、尺寸、revision 与图层数；细节由 canvas_get_context 按需拉取 |
| Q12 | UI 布局 | 侧边栏极简布局 | 参考 Figma——左侧工具面板，右侧属性/图层面板，中间大面积画布 |
| Q13 | AI 运行时 | Codex app-server + dynamic tools | daemon 长驻一个 codex 子进程，建 thread 时声明画布工具；工具调用在 daemon 进程内应答 |
| Q14 | AI 会话 | 每画布一条持久 thread | 同一画布的连续消息共享上下文，AI 才能指代「刚才那个图层」 |
| Q15 | AI 撤销作用域 | 仅限 agent 自身动作 | canvas_undo 只能撤 agent 自己造成的上一步；栈顶是用户动作时返回拒绝并转告用户 |

---

## 三、整体架构概览

```
┌─────────────────────────────────────────────────────────────┐
│  用户入口层（两种交互方式）                                    │
│  ┌──────────────┐    ┌──────────────┐                       │
│  │ 传统画图工具  │    │ AI 辅助画图   │                       │
│  │ (笔刷/形状)  │    │ (Codex Agent) │                       │
│  └──────┬───────┘    └──────┬───────                       │
│         │                   │                               │
│         └─────────┬──────────                               │
│                   ▼                                          │
│         HTTP API + SSE (统一协议)                            │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│  Daemon 服务层    │                                          │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │         HTTP API 路由层                    │             │
│  │    /paint/canvas/:id/*                     │             │
│  └───────────────┬─────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │      Command Dispatcher                     │             │
│  │  ┌─────────────────────────────────────────┐│             │
│  │  │  dispatch(action, input, actor)         ││             │
│  │  │  actor = 'user' | 'agent'               ││             │
│  │  └─────────────────────────────────────────┘│             │
│  └───────────────┬─────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │       Paint Core (业务核心)               │             │
│  │  ┌───────── ┌─────────┐ ──────────┐     │             │
│  │  │ Service │ │ Tool    │ │Repository│     │             │
│  │  │ 状态机   │ │ 插件系统 │ │ 数据层    │     │             │
│  │  └─────────┘ └───────── └──────────┘     │             │
│  └─────────────────────────────────────────────┘             │
│                  │                                           │
│  ┌───────────────▼─────────────────────────────┐             │
│  │          Agent Layer (AI 适配层)             │             │
│  │  ┌────────── ┌──────────┐ ──────────┐   │             │
│  │  │ Context  │ │ Codex    │ │ Tool     │   │             │
│  │  │ Builder  │ │ Runtime  │ │ Registry │   │             │
│  │  └──────────┘ └──────────┘ └──────────┘   │             │
│  └─────────────────────────────────────────────┘             │
└──────────────────┬──────────────────────────────────────────┘
                   │
┌──────────────────┼──────────────────────────────────────────┐
│  数据层           │                                          │
│  ┌───────────────▼───────────────┐                           │
│  │  SQLite (状态、图层、历史)    │                           │
│  │  文件系统 (作品文件、导出图片) │                           │
│  └───────────────────────────────┘                           │
└──────────────────────────────────────────────────────────────┘
```

---

## 四、核心模块设计

### 4.1 Command Dispatcher（人机同权入口）

```typescript
// command-dispatcher.ts
function dispatch(action, input, actor) {
  // actor = 'user' → 人类操作（笔刷、点击等）
  // actor = 'agent' → AI 操作（Codex 工具调用）
  
  return service.applyAction({
    actor,
    action,
    expectedRevision,
    input
  });
}
```

**关键设计**：
- 不区分"人类 API"和"AI API"，只有**一个 `applyAction` 接口**
- 状态机不区分 actor，只关心"这个操作在当前状态下是否合法"
- 每次操作后触发快照保存（用于 Undo）

### 4.2 画布状态机（Service）

```typescript
// paint-service.ts
interface CanvasState {
  id: string;
  revision: number;
  width: number;
  height: number;
  layers: Layer[];
  selectedRegion: Region | null;
  activeLayerId: string;
  history: Snapshot[]; // 快照历史
}

interface Layer {
  id: string;
  name: string;
  type: 'raster' | 'vector' | 'ai-generated';
  visible: boolean;
  opacity: number;
  blendMode: BlendMode;
  content: CanvasImageSource | SVGElement | null;
  metadata: {
    createdBy: 'user' | 'agent';
    createdAt: number;
    prompt?: string; // AI 生成时的提示词
  };
}

function applyAction(canvasId, request) {
  const actor = request.actor ?? 'user';
  const current = getCanvas(canvasId);
  
  // 乐观锁检查
  if (current.revision !== request.expectedRevision) {
    throw new RevisionConflictError();
  }
  
  // 执行状态转移
  const nextState = canvasReducer(current, request);
  
  // 保存快照（用于 Undo）
  if (isSnapshotWorthy(request.action)) {
    saveSnapshot(canvasId, nextState);
  }
  
  // 记录操作历史
  logActivity({ actor, action: request.action, revision: nextState.revision });
  
  // 广播 SSE 事件
  events.publish({
    id: `snapshot:${nextState.revision}`,
    canvasId,
    revision: nextState.revision,
    kind: 'canvas_changed',
    payload: { revision: nextState.revision }
  });
  
  return nextState;
}
```

### 4.3 AI 层：Codex 集成

AI 与画布的关系由两件事决定：**它能看到什么**（上下文）和**它能做什么**（工具）。两者都在这一层。

#### 4.3.1 上下文构建（Context Builder）

AI 看到的画布信息分两条路：

- **推送（最小摘要）**：每条消息的提示词只带画布标识、尺寸、当前 revision、图层数与图层名摘要。
- **拉取（按需）**：图层 id、几何、内容、选中区域由 AI 在执行过程中调用 `canvas_get_context` 取回。

```typescript
// context-builder.ts
function buildPromptSummary(canvas: CanvasState, message: string) {
  return {
    canvasId: canvas.id,
    dimensions: { width: canvas.width, height: canvas.height },
    revision: canvas.revision,
    layerCount: canvas.layers.length,
    layerNames: canvas.layers.slice(0, 20).map((layer) => layer.name),
    message,
  };
}
```

**为什么不推全量状态**：一次 turn 内，画布可能在 AI 两次工具调用之间被用户改动，推送的 JSON 从生成那一刻就开始过期；拉取得到的永远是执行时刻的真实状态。而且提示词不再随图层数量膨胀。

#### 4.3.2 Codex Runtime（app-server 适配）

daemon 长驻一个 `codex app-server` 子进程，用 JSON-RPC 通信。`Codex Runtime` 是唯一接缝——它持有进程、thread、turn，其他模块只看见工具调用与文本事件：

```typescript
// apps/daemon/src/paint/agent/runtime/codex-runtime.ts
const runtime = createCodexRuntime({ command: 'codex' });

const thread = await runtime.startThread({
  canvasId: canvas.id,
  developerInstructions: PAINT_INSTRUCTIONS,
  dynamicTools: canvasTools,                      // 见 4.4
  onDelta: (text) => sse.send({ delta: text }),
  onToolCall: (call) => executeCanvasTool(call),  // 见 4.4 的执行器
  onItem: (item) => sse.send(toToolFrame(item)),
});

await thread.startTurn(promptSummary);
```

**为什么不是一次性 `codex exec`**：见 [ADR-0009](adr/0009-ai-drives-canvas-through-codex-dynamic-tools.md)。一句话——只有长驻的 app-server 才能让画布成为 AI 的原生工具，而不是让 AI 用文本语法请求 daemon 代劳；也只有它能给「每画布一条 thread」提供承载。

**版本闸门**：启动时校验 `codex --version` 不低于 `0.164`，不满足则 AI 路由拒绝注册，并给出可操作的错误（而不是在第一次对话时莫名其妙地失败）。协议类型由 `codex app-server generate-ts` 生成，不手抄、不在仓库里维护一份手写副本。

#### 4.3.3 协议事件到 SSE 帧的映射

| app-server 事件 | SSE 帧 | 前端行为 |
|---|---|---|
| `AgentMessageDelta` | `{ delta: string }` | 追加到气泡 |
| `ItemStarted` / `ItemCompleted`（dynamic tool call） | `{ tool: { id, name, status, ok? } }` | 写操作成行显示，读操作折叠（见 5.4） |
| `ToolRequestUserInput` | `{ confirm: { id, title, detail } }` | 弹确认条，答复经 `POST /paint/ai/confirm` 回传 |
| turn 完成 | `{ done: true }` | 结束计时，显示「已完成 · 用时 Ns」 |
| 错误 / 取消 | `{ error: { code, message } }` | 错误条 + 重试 |

### 4.4 工具集设计（dynamic tools）

AI 能对画布做的事**只有**下面这七个工具。工具集是刻意的小：加一个工具是决策，不是提交。

| 工具 | 参数 | 落到 | 需要确认 |
|---|---|---|---|
| `canvas_get_context` | `{ canvasId, layerId? }` | 只读（service 查询） | 否 |
| `canvas_create_layer` | `{ canvasId, name, svg, visible?, opacity? }` | `canvas_create_layer` | 否 |
| `canvas_update_layer` | `{ canvasId, layerId, patch }` | `canvas_update_layer` | 否（可撤销） |
| `canvas_delete_layer` | `{ canvasId, layerId }` | `canvas_delete_layer` | 是 |
| `canvas_select` | `{ canvasId, layerId? , region? }` | UI 焦点（不落库） | 否 |
| `canvas_export_png` | `{ canvasId }` | 客户端导出（ADR-0005） | 是 |
| `canvas_undo` | `{ canvasId }` | `undo` | 否，但仅限 agent 自身动作 |

`canvas_render_preview` 已端到端落地：返回当前渲染的 PNG，工具结果携带图片（`inputImage`），供 AI 自查「有没有画出画布」。它没有被写进开发者提示词，模型在需要时自行调用；daemon 不主动催促。

**约定**：

- 写类工具**必须**经 Command Dispatcher 落到 `PaintAction`（`actor: 'agent'`）；读类工具直接查 service，不经 dispatcher；
- SVG 入参必须过 `isSafeSvg`——marker 协议退役后，它从「解析器守卫」转职为「工具入参校验器」；
- 工具一律返回结构化结果：成功 `{ ok: true, ... }`，失败 `{ ok: false, code, message }`，**失败对模型可见**（见 7.3）；
- 每个工具调用都要有观测记录，分类 `canvas-tool`。

**明确不做**（与本文档早期设想不同）：`apply_filter`（滤镜成本高、缺快照语义）、`generate_image` / `inpaint`（需要外部图像 API，与 Q10 冲突）、`import_image`（需要远程 URL 或本地文件，破坏安全边界）。理由记录在 ADR-0009。

### 4.5 生成方式：SVG 仍是内容，工具才是手

Q10 的结论不变——AI 产出的图层内容仍然是 SVG 代码，不是外部图像 API 的产物。变的是**AI 如何把内容放上去**：

| 维度 | 旧（marker 协议） | 新（dynamic tools） |
|---|---|---|
| AI 输出 | 一句话 + `<<<CANVAS_ACTION>>>` + 一个 JSON | 零到多次工具调用 + 最终自然语言 |
| 单轮能力 | 新建一个图层 | 读上下文、多次增删改、复核结果 |
| 失败可见性 | daemon 静默丢弃非法动作 | 结构化错误回给模型 |
| 上下文 | 一次性拼进提示词 | 执行中按需拉取 |
| 会话记忆 | 无（`--ephemeral`） | 每画布一条持久 thread |

示例：用户说「把红圆放大两倍、加个投影，再复制一份放右边」——

1. `canvas_get_context` 取得 `AI-红圆` 的 id、位置与 SVG 内容；
2. `canvas_update_layer` 改写其 SVG（放大 + 投影）；
3. `canvas_get_context` 复核结果；
4. `canvas_create_layer` 复制一份并调整 x 偏移；
5. 回一句「放大了，也复制到右边了」。

**优势**：AI 的动作与人类同集合，改与删第一次成为可能；每一步都可观测、可撤销、可确认。

**局限**：工具集只到图层级，没有像素级编辑（涂抹、局部重绘）；复杂构图仍取决于模型一次写出的 SVG 质量；多步 turn 的时延明显高于单次生成。

---

## 五、前端架构

### 5.1 UI 布局（侧边栏极简布局）

```
┌─────────────────────────────────────────────────────────────┐
│  [菜单栏: 文件 编辑 视图 帮助]                                │
├──────────┬────────────────────────────────────┬─────────────┤
│          │                                    │             │
│  工具面板 │         画 布 区 域               │ 属性/图层   │
│  ─────── │                                    │ 面板        │
│  [选择]  │    ┌──────────────────────┐         │ ─────────── │
│  [画笔]  │    │                      │         │ 图层列表    │
│  [橡皮]  │    │    画布内容          │         │ - Layer 1   │
│  [形状]  │    │                      │         │ - Layer 2 ⬅ │
│  [文字]  │    │                      │         │ - AI-圆    │
│  [填充]  │    │                      │         │             │
│  ─────── │    └──────────────────────┘         │ 属性面板    │
│          │                                    │ - 颜色      │
│          │                                    │ - 透明度    │
│          │                                    │ - 混合模式  │
├──────────────────────────────────────────────┴─────────────┤
│  [状态栏: 画布尺寸 缩放比例 当前工具]                         │
└─────────────────────────────────────────────────────────────┘
```

**AI 对话面板**：右侧属性面板下方可折叠抽屉，默认收起，点击 AI 图标展开。

### 5.2 画布渲染（基于 Fabric.js）

```typescript
// canvas-engine.ts
import { Canvas } from 'fabric';

class PaintCanvasEngine {
  private canvas: Canvas;
  private layers: Map<string, fabric.Object>;
  
  constructor(element: HTMLCanvasElement) {
    this.canvas = new Canvas(element);
  }
  
  // 添加图层
  addLayer(layer: Layer): fabric.Object {
    const fabricObject = this.createFabricObject(layer);
    this.canvas.add(fabricObject);
    this.layers.set(layer.id, fabricObject);
    return fabricObject;
  }
  
  // 应用滤镜
  applyFilter(layerId: string, filter: FilterConfig) {
    const obj = this.layers.get(layerId);
    // 应用 Fabric.js 滤镜
  }
  
  // 导出图片
  export(format: 'png' | 'jpg'): Blob {
    return this.canvas.toDataURL({ format });
  }
}
```

### 5.3 状态同步（SSE）

```typescript
// paint-sse.ts
export function createPaintSnapshotSubscription(canvasId: string) {
  return createCreatorSnapshotSubscription({
    loadSnapshot: async () => fetchCanvas(canvasId),
    subscribe: (onEvent, onDisconnect) => {
      const eventSource = new EventSource(`/paint/canvas/${canvasId}/events`);
      eventSource.onmessage = (e) => onEvent(JSON.parse(e.data));
      eventSource.onerror = () => onDisconnect();
      return { close: () => eventSource.close() };
    },
    onSnapshot: (snapshot) => renderCanvas(snapshot),
    onEvent: (event) => applyIncrementalUpdate(event)
  });
}
```

---

## 六、数据模型

### 6.1 核心实体

```typescript
// 画布（单文件模式）
interface CanvasDocument {
  id: string;
  name: string;
  width: number;
  height: number;
  backgroundColor: string;
  layers: Layer[];
  activeLayerId: string;
  history: Snapshot[];
  metadata: {
    createdAt: number;
    updatedAt: number;
    version: number;
  };
}

// 图层
interface Layer {
  id: string;
  name: string;
  type: 'raster' | 'vector' | 'ai-generated';
  visible: boolean;
  locked: boolean;
  opacity: number; // 0-1
  blendMode: BlendMode;
  transform: {
    x: number;
    y: number;
    rotation: number;
    scaleX: number;
    scaleY: number;
  };
  content: LayerContent;
  metadata: {
    createdBy: 'user' | 'agent';
    createdAt: number;
    prompt?: string;
    code?: string; // AI 生成的原始代码
  };
}

// 图层内容（支持多种格式）
type LayerContent = 
  | { type: 'raster'; dataUrl: string } // base64 图片
  | { type: 'vector'; svg: string }     // SVG 代码
  | { type: 'ai-code'; code: string };  // AI 生成的 Canvas/SVG 代码

// 快照（用于 Undo/Redo）
interface Snapshot {
  id: string;
  revision: number;
  action: string;
  actor: 'user' | 'agent';
  timestamp: number;
  state: CanvasDocument; // 完整状态深拷贝
}
```

### 6.2 文件格式

**专有格式（`.aipaint`）**：

```json
{
  "version": 1,
  "canvas": {
    "id": "canvas-123",
    "name": "未命名作品",
    "width": 1920,
    "height": 1080,
    "backgroundColor": "#ffffff",
    "layers": [
      {
        "id": "layer-1",
        "name": "背景",
        "type": "raster",
        "visible": true,
        "opacity": 1.0,
        "content": { "type": "raster", "dataUrl": "data:image/png;base64,..." }
      },
      {
        "id": "layer-ai-1",
        "name": "AI-红色圆",
        "type": "ai-generated",
        "visible": true,
        "opacity": 1.0,
        "content": { "type": "ai-code", "code": "<circle cx=\"100\" cy=\"100\" r=\"50\" fill=\"red\" />" },
        "metadata": {
          "createdBy": "agent",
          "createdAt": 1698765432000,
          "prompt": "画一个红色的圆"
        }
      }
    ]
  },
  "history": [ /* 快照数组 */ ]
}
```

**导出格式**：
- `PNG`（透明背景）
- `JPG`（白色背景）
- `SVG`（矢量图层保留可编辑性）

---

## 七、Codex 集成详细设计

### 7.1 运行时拓扑

```
┌───────────────────────────┐                      ┌──────────────────────────┐
│  daemon                   │  stdin/stdout JSON-RPC│  codex app-server        │
│  ┌─────────────────────┐  │ ◄──────────────────► │  （长驻子进程）           │
│  │ Codex Runtime        │  │  notifications       │  ├ threads（每画布一条）  │
│  ├ canvas tool executor  │  │  tool-call requests  │  └ turns                 │
│  └ CommandDispatcher     │  │  user-input requests │                          │
└───────────────────────────┘                      └──────────────────────────┘
```

- 一个 daemon 一个 app-server 进程（不是每条消息一个）；
- 一个画布一条 thread（存 `canvases.codexThreadId`，随画布删除）；
- 一条用户消息一个 turn；turn 内可有多次工具调用。

### 7.2 一次 turn 的生命周期

```
用户消息
   │
   ▼
┌──────────────────┐   无 thread → startThread（声明 dynamicTools）
│  Runtime          │   有 thread → resumeThread
└────────┬─────────┘
         │ startTurn(最小摘要 + 用户消息)
         ▼
┌──────────────────┐
│ 模型推理          │───► AgentMessageDelta ──► SSE { delta }
└────────┬─────────┘
         │ 工具调用（可 0..N 次）
         ▼
┌──────────────────┐
│ 工具执行器         │──► 确认工具 → ToolRequestUserInput → SSE { confirm } → 用户答复
│  ├ 只读：查 service │──► revision 冲突 → { ok:false, code:'revision_conflict' }
│  └ 写：dispatch    │──► CommandDispatcher → Service → Snapshot → SSE snapshot_changed
└────────┬─────────┘
         │ 工具结果回传（成功/失败均可读）
         ▼
    （回到模型推理，直到不再调用工具）
         │
         ▼
  最终回复 → { done: true }
```

关键点：**工具结果会回到模型**。这正是旧 marker 协议缺的那一段回路，也是「AI 具备系统操作能力」与「AI 请求系统代为操作」的分界线。

### 7.3 工具执行语义

**修订冲突归模型**。工具用 AI 读到的 revision 作为 `expectedRevision` 提交；冲突时返回 `{ ok: false, code: 'revision_conflict', currentRevision }`，由 AI 重新拉取上下文后决定下一步。daemon 不替 AI 静默重试——静默重试会把它变成一个永远不知道自己在错的执行器。

**撤销作用域**。`canvas_undo` 只撤 agent 自己造成的上一步；若撤销栈顶属于用户动作，返回 `{ ok: false, code: 'top_action_is_user' }`，由 AI 转告用户自行撤销。实现只需比较快照的 actor（快照已记录 actor）。

**确认属于工具层**。`canvas_delete_layer` 与 `canvas_export_png` 在执行前阻塞询问；用户拒绝返回 `{ ok: false, code: 'user_declined' }`。不复用 Codex 的审批策略：审批策略管的是「让不让 Codex 动文件系统」，管不到「让不让 AI 删这张图层」。

**串行化**。同一画布的工具执行串行（单写者）；并发的两条工具调用不得彼此覆盖 revision。

### 7.4 失败、取消与超时

| 情形 | 行为 |
|---|---|
| 前端断开 SSE | 中断当前 turn（`turn/interrupt`），会话与 thread 保留 |
| app-server 进程崩溃 | 重启进程并重建 thread；当前 turn 以错误结束，前端显示可重试 |
| turn 超时 | 沿用 120s 上限，由 Runtime 计时并中断；错误码与旧实现一致 |
| `codex` 版本过低 | 启动时 AI 路由拒绝注册，`GET /health` 报告原因 |
| 工具抛异常 | 转成 `{ ok:false, code, message }` 回给模型，不吞、不升级为 500 |

### 7.5 观测性

沿用 ADR-0006 的 trace/span 体系，分类调整为：

| 分类 | 负责 | 记录内容 |
|---|---|---|
| `codex-runtime` | `runtime/*` | 进程启停、thread 建立/恢复、turn 开始/结束、协议错误 |
| `canvas-tool` | 工具执行器 | 每次工具调用的 name、参数摘要、结果码、耗时（新增） |
| `ai-chat` | `routes.ai.ts` | 请求生命周期、SSE 完成、确认往返 |
| `canvas-action` | service | 既有的画布变更记录，不变 |

`tool_call` 成为 AI 行为统计的新锚点（工具调用次数、成功率、确认拒绝率）。旧的 `codex-runner` 分类在切片 2 合入后移除。

---

## 八、项目目录结构建议

参考 OpenCreator 的 Monorepo 结构：

```
ai-paint/                        # 项目根目录
├── apps/
│   ├── daemon/                   # 后端守护进程（Node.js/TypeScript）
│   │   ├── src/
│   │   │   ├── paint/            # 画图核心（CommandDispatcher、状态机）
│   │   │   ├── paint/agent/      # Codex Runtime 与画布工具（见 4.3.2、4.4）
│   │   │   ├── api/              # HTTP API 路由（Fastify）
│   │   │   ├── storage/          # 数据存储（SQLite）
│   │   │   └── main.ts           # 入口文件
│   │   └── package.json
│   │
│   ├── web/                      # Web 前端（React + Vite + Fabric.js）
│   │   ├── src/
│   │   │   ├── app/              # 路由与页面
│   │   │   ├── features/         # 功能模块
│   │   │   │   ├── canvas/       # 画布组件
│   │   │   │   ├── toolbox/        # 工具面板
│   │   │   │   ├── layer-panel/    # 图层面板
│   │   │   │   └── ai-chat/        # AI 对话面板
│   │   │   ├── services/         # API 服务与状态管理
│   │   │   ├── runtime/          # SSE 连接
│   │   │   └── main.tsx
│   │   └── package.json
│   │
│   ├── desktop/                  # Electron 桌面应用
│   │   ├── src/                  # 主进程代码
│   │   └── package.json
│   │
│   └── harness/                  # 开发/测试工具
│       └── package.json
│
├── packages/
│   ├── config/                   # 共享配置
│   ├── protocol/                 # 前后端共享协议（类型定义）
│   └── paint-engine/             # 画布引擎封装（Fabric.js 二次封装）
│
├── docs/
│   ├── architecture-overview.md  # 架构总览
│   └── ai-paint-architecture-design.md # 本设计文档
│
├── package.json                  # 根包配置（pnpm workspace）
└── pnpm-workspace.yaml           # pnpm 工作区定义
```

---

## 九、技术栈

| 层级 | 技术 |
|------|------|
| **前端** | React + TypeScript + Vite + Fabric.js |
| **桌面** | Electron |
| **后端** | Node.js + TypeScript + Fastify |
| **AI 引擎** | Codex CLI ≥ 0.164（app-server 协议，OpenAI） |
| **数据库** | SQLite |
| **构建** | pnpm + TypeScript |
| **测试** | Vitest + Playwright |

---

## 十、实现路线图

### Phase 1：基础画布（MVP）
- [ ] 初始化 Monorepo 项目结构
- [ ] 集成 Fabric.js，实现基础画布渲染
- [ ] 实现图层管理（创建、删除、排序、可见性）
- [ ] 实现基础工具（选择、画笔、橡皮擦、形状、文字）
- [ ] 实现文件保存/打开（专有格式 `.aipaint`）
- [ ] 实现导出功能（PNG/JPG/SVG）

### Phase 2：AI 原生能力（Codex 工具化）

> 按切片推进，每片可独立验收；票据见 `.scratch/codex-native-tools/`。

- [x] 集成 Codex CLI，实现 AI 对话面板（Phase 1 已交付）
- [ ] 切片 1：Codex Runtime 接入 app-server + `canvas_get_context` / `canvas_create_layer`，并移除 marker 通路
- [ ] 切片 2：`canvas_update_layer` / `canvas_delete_layer` / `canvas_undo` + 工具事件行
- [ ] 切片 3：确认通道（删除 / 导出）+ actor 归属修正
- [ ] 切片 4：`canvas_render_preview`（带图）+ 每画布 thread 记忆接线

### Phase 3：高级功能
- [ ] 实现快照级 Undo/Redo
- [ ] 实现滤镜系统（模糊、锐化、调色等）
- [ ] 实现 AI 图层管理（合并、拆分、编辑 AI 代码）
- [ ] 实现 Desktop 端（Electron）
- [ ] 实现 SSE 实时同步

### Phase 4：优化与扩展
- [ ] 性能优化（大画布、多图层）
- [ ] 插件系统（自定义工具、滤镜）
- [ ] 云同步（可选）
- [ ] 社区模板市场（可选）

---

## 十一、与 OpenCreator 的对比

| 特性 | OpenCreator | AI 画图软件 |
|------|-------------|------------|
| **核心功能** | 视频翻译、图片生成 | 传统画图 + AI 辅助画图 |
| **数据模型** | Job + Stage（流水线） | 单文件 + 图层（画布） |
| **AI 角色** | 项目管理者（推进阶段） | 画布操作者（工具调用） |
| **渲染引擎** | React DOM | Fabric.js / Konva.js |
| **AI 生成方式** | 调用 API（视频/图片生成） | Codex 生成 SVG，经原生工具落到画布 |
| **状态同步** | SSE + 乐观锁 | SSE + 乐观锁 |
| **架构模式** | 人机同权 Command Dispatcher | 人机同权 Command Dispatcher |

---

## 十二、一句话总结

> **这是一款参考 OpenCreator "人机同权"架构的 AI 辅助画图软件：Codex AI 作为另一个 actor，通过声明给它的原生工具（读上下文、建层、改层、删层、撤销、导出）操作画布，工具结果回流给模型形成自纠回路，并与人类用户共用同一套 Command Dispatcher 和状态机。**
