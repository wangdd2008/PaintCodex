# 09: 图层名称、透明度与类型

**What to build:** 把协议与渲染已经支持的 `name`、`opacity` 暴露到界面，并把类型显示中文化；一次拖动只产生一个撤销步。

**Blocked by:** 05 (类型/名称中文化), 06 (行布局)

**Status:** done

**Covers:** UX-13

**Size:** M

## Acceptance Criteria

- [x] 行内重命名：双击名称或点小按钮进入，Enter 或失焦提交，Esc 取消，空值回退原名；PATCH 失败回滚并就地提示。
- [x] 透明度滑块 0–100%：拖动只做本地预览，松手（`change`）才发 PATCH；一次拖动 = 一个撤销步。
- [x] 透明度设为 40% 后，撤销一次回到拖动前的值。
- [x] 类型显示「笔迹」/「AI」/「图片」，不出现 `vector`。（票 05 已完成，本票未重复改动）
- [x] 改名后列表、刷新页面、导出 JSON 三处都是新名。
- [x] 不改 `zIndex`（协议不支持，属于 Phase 2 扩展）。
- [x] 自动化：断言 Esc 不产生 PATCH；断言拖动过程中 fetch 次数为 1（松手时）。

## Comments

**2026-10-27 — implementation commit `7d0aabd`**

- **范围**：只做本票尚未完成的两项——行内重命名与不透明度控件。类型中文化已由票 05 完成（`LayerPanel` 的 `LAYER_TYPE_LABELS` 输出「笔迹」/「AI」/「图片」，`localization.test.tsx` 已断言不出现 `vector`/`raster`），本票未改；图层命名唯一与画布改名（票 04/05）也没有重复实现。
- **重命名**：双击名称或行尾 ✎ 进入编辑（`LayerNameEditor`）；Enter 或失焦提交、Esc 取消（编辑态 `stopPropagation`，不冒泡到行级 ↑/↓/Delete 与窄屏抽屉的 Esc）、空值回退原名。提交前归一化（`trim` + 制表符/连续空白折叠成单个空格，上限 60 字符），只发 `PATCH { name, expectedRevision }`；提交后先显示乐观值，失败撤回原名，不出现「界面改了但服务端没改」。
- **失败提示（二选一的说明）**：选择**复用画布顶部横幅**，不新增行内第二处错误面。理由：`canvas-store.updateLayer` 已经统一 `showCanvasAlert` 并带重试，spec §2 把「操作失败」定为横幅；行高固定 38px、侧栏 260–320px 宽，再塞一行错误文本会同时压坏名称与行高契约（票 07）。空值属于本地校验（本来就不发请求），同样用横幅说明「图层名称不能为空，已保留原名」。
- **不透明度**：行尾按钮常显当前百分比（`aria-label=不透明度 N%`、`aria-expanded`），点开是 0–100%、step 5 的滑块浮层。**只有原生 `change`（松手）提交**：React 的 `onChange` 对 range 等价于原生 `input`（拖动每一帧都触发），因此 `input` 只调用 `previewLayerOpacity` 改 Fabric 对象的 `opacity`，`change` 才 `PATCH { opacity }`——一次拖动只写一个快照，即一个撤销步（ADR-0003）。浮层用 `createPortal` + `position: fixed`：图层列表是独立滚动容器（票 06），行内绝对定位会被裁切；滚动/缩放/点外部/Tab 离开都会收起。提交失败时预览与滑块一起回到快照值。
- **未破坏的既有语义**：行仍是 `role="option"` + roving `tabIndex`，↑/↓/Home/End/Enter/Space/Delete 不变（编辑态按键在输入框内 `stopPropagation`）；删除恢复条、`activeLayerId` 语义（票 08）、可见性/删除按钮都没有改动；`zIndex` 未触碰，测试直接断言 PATCH body 里没有该字段。
- **测试**：新增 `apps/web/test/layer-opacity.test.tsx` 9 条——Esc 不产生 PATCH、Enter 提交带 `name`/`expectedRevision`、空值回退、PATCH 失败回滚 + 横幅重试、✎ 键盘入口与编辑态按键隔离、拖动 0 次 fetch + 松手 1 次 PATCH、40% 后撤销一次回到 100%、透明度提交失败回滚、新控件命中区与行高 CSS 契约。`pnpm --filter @paintcodex/web test` → 26 个文件 188 条全绿（新增前 25 个文件 179 条）；`pnpm -r typecheck` 三个包全绿；`pnpm --filter @paintcodex/web build` 通过（本机 `%TEMP%` 权限导致 esbuild 清理临时文件失败，改用工作目录做 TMP 后构建成功，与本改动无关）。
- **需浏览器人工复核**：① 真实 Fabric 下拖动 0–100% 的实时观感，并在 Network 面板确认一次拖动只有 1 个 PATCH、且发生在松手之后；② 浮层在 8 层滚动、260/320px 侧栏与 200% 缩放下的定位、不裁切、不遮挡行内控件；③ 双击/✎/Enter/Space/Esc/失焦的真实键盘路径与读屏播报（NVDA/VoiceOver）；④ 改名后刷新页面与导出 JSON 的 `layer.name` 为新名；⑤ 撤销一次（Ctrl+Z 或工具栏）后画布透明度回到拖动前，撤销栈只少一步。
- **顺带观察（未改）**：`PATCH` 失败会同时把 `saveState` 置成「保存失败 · 重试」，这是票 02 的既有全局保存语义；改名/透明度复用同一条 mutation 路径，因此行为与可见性切换、删除一致。

## Notes

- 名称与透明度都作用于「该行」，与选中语义无关（票 08）。
- 类型中文化若与票 05 的白名单检查重复，以票 05 的扫描为准，本票只负责渲染。
