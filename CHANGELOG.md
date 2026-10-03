# Changelog

本文件记录本仓库的发布版本。版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## Unreleased

## 1.0.1

### 修复：点击 ✨ 报 `HTTP 404`

- **症状**：按钮与设置页都在、插件条目也显示「运行中」，但点击 ✨ 固定失败：
  `client api: promptOptimizer/optimizePrompt failed: transport failure for /api/promptOptimizer/optimizePrompt: HTTP 404`。
- **根因（两条链条叠加）**：
  1. 条目级 `Config` 校验把 `strength` 等字段解析成 `Volatile<T>` 引用后，`apply(ctx, config)` 又把这份**已解析**的 config 原样交给 `ctx.plugin(PromptOptimizerGateway, config)`；子 fiber 再拿 `OptimizerConfig` 校验一次，等于拿引用对象去匹配 `z.union(["light", …])`，抛 `invalid config: $.strength expected "light" | … but got {}`。
  2. 该错误只经 `ctx.logger.error` 输出、宿主端看不见 → 子 fiber 静默 `FAIL`，`promptOptimizer` 服务从未构造 → 网关 `collectSrcClaims()` 无从发现 → `claimsEndpoint()` 返回 false → `/api` 共享通道回 `not found` 404。（插件清单显示「运行中」只代表模块条目 fiber，内部派生的子 fiber 失败是看不到的。）
- **修复**：
  1. `PromptOptimizerGateway` 去掉 `static Config` —— 配置校验只由模块导出的 `Config` 承担一次；子 fiber 继承已解析的 config，`readSettings()` 经 `.get()` 现读，设置页改档仍可热更新。
  2. 新增 `HOST_TYPERT` 严格调用描述符，构造函数里 `ctx.typert.register()` 写入 `ctx.typert.local`，使 `claimsEndpoint()` 走**实时读取**的首个分支，认领不再依赖只计算一次的 SRC 快照与插件挂载顺序。注册失败时捕获并退回 SRC 路径、留下告警，不连累插件本体。
- **验证**：从 asar 解出真实 `dsh-typert-registry@0.2.0-rc.2`、`dsh-api-gateway`、`@deepseek-ai/cordis`、`dsh-typert-protocol` 跑端到端：修复前子 fiber `state=FAIL`、服务 `undefined`、`local.get(endpoint)` 为 `undefined`（即 404 条件）；修复后 9/9 通过 —— `claimsEndpoint() === true`、`resolveDescriptor()` 返回描述符、`prepareInvocation()` 解出 wire 参数、`invokePrepared()` 真实跑通 `optimizePrompt` 并返回 `{ok:true, optimized, route, template}`、恰好一次 `llm.stream` 调用、结果经严格 codec + JSON 往返无损。

### 分发收敛

- 收敛分发渠道：README 的安装说明只保留 GitHub 源与本地包两种方式，移除包管理器的发布配置与自动化发布工作流。

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

