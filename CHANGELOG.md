# Changelog

本文件记录本仓库的发布版本。版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## 1.0.0

首个稳定版本：宿主半（Typert Remote 服务 `promptOptimizer` + 设置命名空间 `prompt-optimizer`）与浏览器半（composer 按钮 + 设置页）的接口按本版本定型。本版本相对 0.2.0 是一次重构级更新。

### 通用模板：四档强度与自定义骨架

- 强度定义为**输出段落集合**，逐档在前一档上加段：
  - 轻（2 段）：Goals、Constrains
  - 中（4 段）：+ Background、Attention
  - 高（7 段）：+ Role、Workflow、OutputFormat —— **默认档**
  - 最高（9 段）：+ Skills、Suggestions
- 任何档位都不输出 `Profile` 与 `Initialization`，并保持紧凑纯文本契约：逐行连续、无空行、无 `#` 号、双花括号占位符逐字保留。
- 「自定义」由用户在设置页直接编辑段落骨架：可用段名标签点选追加（已存在的不会重复添加），也可完全跳过点选、自行手写段落名与内容；骨架留空回落到默认档。

### 图片模板：标准 / 自定义

- 图片模板不设强度档位，只有两种模式：「标准」（内置硬约束保真（第一原则）+ 句式结构 + 修饰词密度 + 输出要求）与「自定义」（逐字替换系统指令）。
- 两种模式都保留收尾的「保留全部硬约束与双花括号占位符」要求，作为占位符保护的安全网。

### 设置页

- 宿主新增设置命名空间 `prompt-optimizer`（`ctx.settings.installSection`），浏览器半在设置面板注册「优化提示词」页（`settings.section`）。
- 「通用模板」「图片模板」两个区域下方各有一个**只读信息框**（浅灰底、细边框、低对比度辅助文字），呈现当前模板的段落构成，不含任何编辑入口；选「自定义」时信息框变为编辑框。
- 页面标题带一颗 ✨，与 composer 按钮使用同一视觉标识。
- 改动**即时生效**，无需重启；缓存键包含模板变体，换档不会命中旧档结果。

### 交互

- composer 按钮三态：idle 只显示 ✨；优化中显示旋转指示 + 秒数；成功后显示红色「撤销」。三态都保留无障碍名与 tooltip。
- 点击 ✨ → 用当前会话选定的模型，结合对话历史与工作区文件优化草稿；「撤销」无条件还原原文；发送提示词后自动复位。
- 单次优化有 `timeoutMs` 上限（默认 300 秒），到点中止底层流并返回「优化超时」错误，不会停在无限等待。

### 意图路由

- 按草稿意图在通用/图片模板间做确定性关键词路由，无额外模型调用、零延迟；草稿含「动画 / 视频 / 分镜」时，「画」不作为图片创作的强判定。

### 许可证

- 以 **AGPL-3.0-only** 分发。通用模板改编自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的 `analytical-optimize`，图片模板改编自其 `general-image-optimize`（Copyright (C) 2025 linshenkx）。

## 0.2.0

- 声明 `dsh.bundle.patch`：插件可被 `dsh plugin add` 识别为组合包，而不只是普通依赖。
- 模板移植自上游 `analytical-optimize`（分析式结构优化）。
- 修复客户端未解包 `RemoteResult` 导致成功结果被误判为「优化失败」的问题。
- 优化请求默认不发送 `temperature` / `maxTokens`，避免不同 OpenAI 兼容中转对显式采样参数行为不一致。

## 0.1.0

- 首个发布版本：提示词优化插件（对话历史 + 工作区上下文、结构化输出、撤销状态机、含对话历史 hash 的缓存键）。
