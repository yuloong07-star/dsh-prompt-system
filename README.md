# dsh-prompt-system

DeepSeek Harness（DSH）提示词优化插件：在对话输入框的模型选择按钮左侧提供「✨ 优化提示词」按钮，点击后由**当前对话模型**结合**对话历史**与**工作区文件**，把草稿优化为「角色 / 背景 / 注意 / 技能 / 目标 / 约束 / 流程 / 输出格式 / 建议」分析式结构提示词，支持一键撤销。

## 行为

| 交互 | 行为 |
|---|---|
| 点击「✨ 优化提示词」 | 第一步先创建快照（保存优化前原文），然后调用当前对话模型优化；成功后按钮变「撤销」 |
| 点击「撤销」 | 无条件恢复快照原文，不触发任何优化请求；恢复后清空快照、按钮复位 |
| 发送提示词 | 立即清空快照，按钮复位为「优化提示词」 |
| 撤销态下手动编辑草稿 | 保持撤销态，快照保留，随时可撤销 |
| Ctrl+Z | 输入框自身的文本编辑撤销，不影响按钮与快照 |

## 优化产物格式

优化产物是一段可直接使用的新提示词，包含十一个部分（分析式结构优化）：

```
# Role：[角色名称]

## Background：[背景描述]

## Attention：[注意要点和动机激励]

## Profile：
- Author / Version / Language / Description
### Skills: 5 条

## Goals: 5 条

## Constrains: 5 条

## Workflow: 5 步

## OutputFormat: 3 条

## Suggestions: 5 条（角色内在工作方法论）

## Initialization
作为[Role]，你必须遵守[Constrains]，使用默认[Language]与用户交流。
```

约束：直接输出优化后的提示词，不加解释性文字、不用代码块包围；每个部分都要有具体内容，不使用空泛模板占位符；原始提示词里的双花括号变量占位符（如 `{{variable_name}}`）逐字保留。若模型仍用围栏包裹，插件只剥掉最外层一层。

## 模型与上下文

- **模型绑定**：优先读当前会话的 `modelSelection` 会话投影（`pending ?? lastUsed`，即作曲家里这个会话选定的模型）；会话尚无选择时回退到 `agentDefaultModel.currentSelection()` 全局默认值。不写死任何模型名。
- **所用路由可见**：优化成功后按钮 tooltip 显示 `优化提示词 · provider/model`，即本次实际调用的模型。
- **上下文**：会话最近 ≤12 条对话（≤8000 字符）+ 工作区文件摘要（目录树 ≤60 项 + 关键文件 ≤30 个、每文件 ≤2500 字符、总量 ≤12000 字符，跳过 node_modules/.git 等）。两者与草稿一起放进证据 JSON 的 `conversationContext` / `workspaceContext` / `originalPrompt` 字段。
- **缓存**：键 = provider + model + 对话历史 hash(FNV-1a) + 草稿；模型标识读取时校验，对话历史变化即重新优化。
- **提示词体积**：单次未命中缓存的优化请求，system 与用户脚手架合计约 2.6 KB（不含上下文证据）。

## 安装

**方式一：npm（推荐）**

```bash
dsh plugin --profile web add dsh-prompt-system
```

或在 DSH 设置 → 插件市场搜索安装。安装后重启 DSH web 服务生效。

**方式二：本地包**

1. 把本包目录复制（或软链）到 `~/.dsh/profiles/web/node_modules/dsh-prompt-system`（即 `$DSH_HOME/profiles/web/node_modules/dsh-prompt-system`）；
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: prompt-system
      name: 'dsh-prompt-system'
```

3. 在 profile 的 `package.json` 的 `dependencies` 中记录 `"dsh-prompt-system": "0.2.0"`；
4. 重启 DSH web 服务生效。

## 结构

```
lib/index.js    Host：Typert Remote `promptOptimizer.optimizePrompt`（扫描/上下文/缓存/LLM 调用）
lib/client.js   浏览器：模型选择左侧按钮、状态机、撤销快照
cordis.patch.yml  profile 补丁层：插入 prompt-system 宿主行
```

远程调用契约：Typert Remote 方法解析为 `RemoteResult<T>` = `{ ok: true, value }` | `{ ok: false, error }`，宿主返回的业务对象（`{ ok, optimized, route }`）在 `value` 里。客户端必须解包后再读 `optimized` / `error`，否则成功的结果会被误判成失败。

## 配套文档

- 系统提示词全文与「插件注入版」：`prompt-optimizer-system-prompt.md`（同仓库上游工作区）
- 迭代改动清单：`prompt-optimizer-plugin-changelog.md`

## 许可证与致谢

本插件以 **AGPL-3.0-only** 分发，全文见 [LICENSE](LICENSE)。

`lib/index.js` 中的系统提示词与用户脚手架逐字移植自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的 `analytical-optimize`（分析式结构优化）模板，该项目同样以 AGPL-3.0-only 授权，版权归 Copyright (C) 2025 linshenkx 所有。插件其余部分（Typert Remote 宿主半、浏览器半、上下文采集与缓存）为本仓库原创。
