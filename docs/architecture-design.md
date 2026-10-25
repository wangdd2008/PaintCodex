# AI 画图软件架构设计文档

> 基于 OpenCreator 架构模式参考设计的个人 AI 画图工具

---

## 一、项目定位

一款面向个人用户的 AI 辅助画图软件，支持 Web 和 Desktop（Electron）双端，融合传统画图工具（笔刷、形状、文字）与 AI 辅助画图（代码生成式 AI 绘图）。

核心设计理念：**"人机同权"**——人类用户和 AI Agent 共用同一套命令接口和状态机。

---

## 二、架构决策汇总

| 编号 | 决策项 | 选择 | 说明 |
|------|--------|------|------|
| Q1 | 数据模型 | 单文件模式 | 一个作品就是一个文件，内部包含图层、历史记录、元数据 |
| Q2 | AI 交互模式 | 融合模式 | 侧边栏对话面板（复杂任务）+ 画布内快捷指令（快速修改） |
| Q3 | 渲染引擎 | Fabric.js / Konva.js | 基于成熟的 Canvas 2D 库，快速验证核心逻辑 |
| Q4 | 文件格式 | 双格式导出 | 工作时保存专有格式（完整信息），导出时生成标准图片 |
| Q5 | AI 图层策略 | 强制新建 AI 图层 | 每次 AI 操作新建图层，用户可删除或合并 |
| Q6 | 存储策略 | 统一后端存储 | Web 和 Desktop 共用 Daemon 后端，Desktop 额外桥接本地文件选择 |
| Q7 | Codex 工具集 | 8 个核心工具 | get_context, create_layer, apply_filter, select_region, generate_image, inpaint, import_image, export_image |
| Q8 | Undo/Redo | 快照级撤销 | 每次操作后保存画布完整快照，Undo 时恢复 |
| Q9 | AI 安全策略 | 智能确认 | 可逆操作自动执行，不可逆操作请求确认 |
| Q10 | AI 图片生成 | 纯 Codex 代码生成 | AI 通过生成 Canvas/SVG 代码来绘制图形，而非调用图像生成 API |
| Q11 | AI 上下文 | 完整 JSON 描述 | 将画布状态（图层列表、尺寸、选中区域）转为 JSON 传给 Codex |
| Q12 | UI 布局 | 侧边栏极简布局 | 参考 Figma——左侧工具面板，右侧属性/图层面板，中间大面积画布 |

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
│  │  │ Builder  │ │ Adapter  │ │ Registry │   │             │
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

#### 4.3.1 上下文构建（Context Builder）

```typescript
// context-builder.ts
function buildContext(canvas) {
  return {
    canvasId: canvas.id,
    dimensions: { width: canvas.width, height: canvas.height },
    layers: canvas.layers.map(l => ({
      id: l.id,
      name: l.name,
      type: l.type,
      visible: l.visible,
      position: { x: l.x, y: l.y },
      size: { width: l.width, height: l.height }
    })),
    activeLayerId: canvas.activeLayerId,
    selectedRegion: canvas.selectedRegion,
    recentActions: canvas.history.slice(-5).map(h => h.action)
  };
}
```

#### 4.3.2 Codex 适配器

```typescript
// codex-adapter.ts
function startTurn(input) {
  return codexAppServer.start({
    prompt: paintPrompt(input),
    developerInstructions: paintInstructions,
    skills: [{ name: 'ai-paint-runtime' }],
    onNotification: (event) => { /* 接收 AI 输出 */ },
    onApprovalRequest: (req) => { /* 危险操作拦截 */ }
  });
}
```

### 4.4 工具集设计（Codex Skills）

AI 通过以下工具操作画布：

```typescript
// ai-paint-runtime skill 提供的工具
{
  "canvas_get_context": {
    description: "获取画布完整上下文（图层列表、尺寸、选中区域）",
    params: { "canvasId": "string" }
  },
  "canvas_create_layer": {
    description: "创建新图层（用于放置 AI 生成内容）",
    params: { "canvasId": "string", "name": "string", "content": "SVGString | null" }
  },
  "canvas_delete_layer": {
    description: "删除指定图层（危险操作，需要确认）",
    params: { "canvasId": "string", "layerId": "string" },
    requiresApproval: true
  },
  "canvas_apply_filter": {
    description: "对指定图层应用滤镜（模糊、锐化、调色等）",
    params: { "canvasId": "string", "layerId": "string", "filter": "FilterConfig" }
  },
  "canvas_select_region": {
    description: "选中画布上的某个区域",
    params: { "canvasId": "string", "region": "{x, y, width, height}" }
  },
  "canvas_draw_shape": {
    description: "在指定位置绘制基础形状（矩形、圆形、线条）",
    params: { "canvasId": "string", "shape": "ShapeConfig", "targetLayerId": "string" }
  },
  "canvas_import_image": {
    description: "将图片导入为新的图层",
    params: { "canvasId": "string", "imageUrl": "string" }
  },
  "canvas_export_image": {
    description: "导出当前画布为 PNG/JPG",
    params: { "canvasId": "string", "format": "'png' | 'jpg'" },
    requiresApproval: true
  }
}
```

### 4.5 AI 代码生成模式

由于选择**纯 Codex 代码生成**模式，AI 生成内容的方式是：

```typescript
// AI 生成图形的流程
1. 用户说："帮我画一个红色的圆"
2. Codex 生成 Canvas/SVG 代码：
   const svg = `<circle cx="100" cy="100" r="50" fill="red" />`;
3. Codex 调用 canvas_create_layer 工具：
   { action: "canvas_create_layer", name: "AI-红色圆", content: svg }
4. 系统创建新图层，将 SVG 渲染到画布上
5. 用户可以在画布上继续编辑这个图层
```

**优势**：
- AI 生成的是可编辑的矢量代码，而非静态像素图
- 用户可以进一步修改 AI 生成的图形（改颜色、改大小、改形状）
- 不需要调用外部图像生成 API，完全离线可用

**局限**：
- 不适合照片级真实感图像
- 复杂场景需要多步代码生成

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

### 7.1 AI 操作流程

```
用户输入自然语言指令
         │
         ▼
┌─────────────────────┐
│  Context Builder    │  ← 构建画布上下文（图层列表、尺寸、选中区域）
└──────────┬──────────
           │
           ▼
┌─────────────────────┐
│  Codex Adapter      │  ← 启动 Codex，传入上下文和指令
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Codex 推理         │  ← AI 理解需求，决定调用哪个工具
└──────────┬──────────┘
           │
           ▼
─────────────────────┐
│  Tool Call          │  ← AI 调用 canvas_create_layer 等工具
│  actor='agent'      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Command Dispatcher │  ← 与人类操作走同一入口
│  applyAction()      │
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  Service 状态机     │  ← 执行状态转移，保存快照
└──────────┬──────────┘
           │
           ▼
┌─────────────────────┐
│  SSE 广播           │  ← 前端实时收到变更通知
└─────────────────────┘
```

### 7.2 代码生成示例

**用户指令**："画一个红色的圆"

**Codex 生成代码**：
```javascript
// AI 生成的 Canvas 代码
const canvas = document.getElementById('canvas');
const ctx = canvas.getContext('2d');

ctx.beginPath();
ctx.arc(100, 100, 50, 0, Math.PI * 2);
ctx.fillStyle = 'red';
ctx.fill();
```

**或者 SVG 代码**：
```svg
<svg width="200" height="200">
  <circle cx="100" cy="100" r="50" fill="red" />
</svg>
```

**系统处理**：
1. Codex 调用 `canvas_create_layer` 工具
2. 系统创建新图层，类型为 `ai-generated`
3. 图层内容保存为 SVG 代码
4. Fabric.js 渲染 SVG 到画布上
5. 用户可以在画布上继续编辑（移动、缩放、改颜色）

---

## 八、项目目录结构建议

参考 OpenCreator 的 Monorepo 结构：

```
ai-paint/                        # 项目根目录
├── apps/
│   ├── daemon/                   # 后端守护进程（Node.js/TypeScript）
│   │   ├── src/
│   │   │   ├── paint/            # 画图核心（CommandDispatcher、状态机等）
│   │   │   ├── api/              # HTTP API 路由（Fastify）
│   │   │   ├── codex/            # Codex AI 运行时适配
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
| **AI 引擎** | Codex CLI（OpenAI） |
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

### Phase 2：AI 集成
- [ ] 集成 Codex CLI，实现 AI 对话面板
- [ ] 实现 Context Builder（画布状态 → JSON）
- [ ] 实现 Codex 工具集（8 个核心工具）
- [ ] 实现 AI 代码生成（Canvas/SVG → 新图层）
- [ ] 实现智能确认机制

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
| **AI 角色** | 项目管理者（推进阶段） | 图形生成器（代码生成） |
| **渲染引擎** | React DOM | Fabric.js / Konva.js |
| **AI 生成方式** | 调用 API（视频/图片生成） | Codex 代码生成（Canvas/SVG） |
| **状态同步** | SSE + 乐观锁 | SSE + 乐观锁 |
| **架构模式** | 人机同权 Command Dispatcher | 人机同权 Command Dispatcher |

---

## 十二、一句话总结

> **这是一款参考 OpenCreator "人机同权"架构的 AI 辅助画图软件：Codex AI 作为另一个 actor，通过工具调用操作画布图层，生成可编辑的 Canvas/SVG 代码，与人类用户共用同一套 Command Dispatcher 和状态机。**
