# dsh-prompt-system

DeepSeek Harness（DSH）提示词优化插件：在对话输入框的模型选择按钮左侧提供「✨ 优化提示词」按钮，点击后由**当前对话模型**结合**对话历史**与**工作区文件**，把草稿优化为「目标 / 实现措施 / 约束」三段式精准提示词，支持一键撤销。

## 行为

| 交互 | 行为 |
|---|---|
| 点击「✨ 优化提示词」 | 第一步先创建快照（保存优化前原文），然后调用当前对话模型优化；成功后按钮变「撤销」 |
| 点击「撤销」 | 无条件恢复快照原文，不触发任何优化请求；恢复后清空快照、按钮复位 |
| 发送提示词 | 立即清空快照，按钮复位为「优化提示词」 |
| 撤销态下手动编辑草稿 | 保持撤销态，快照保留，随时可撤销 |
| Ctrl+Z | 输入框自身的文本编辑撤销，不影响按钮与快照 |

## 优化产物格式

```
【目标】把模糊描述改写为具体、可执行的任务：做什么、给谁用、期望结果。
【实现措施】每条一句话给出方向，引用工作区真实存在的文件/目录/技术栈。
【约束】最多 3 条，只保留影响输出正确性的必要规则。
```

输出风格精准克制：约束 ≤3 条、实现措施只给方向、默认不加「需人工核验」（仅当草稿明确要求时保留）；草稿原文与约束上限冲突时以草稿原文为准。

## 模型与上下文

- **模型绑定**：优化所用 LLM 与创建会话时刻界面上当前选定的模型一致（`agentDefaultModel.currentSelection()`），不写死任何模型名。
- **上下文**：会话最近 ≤12 条对话（≤8000 字符）+ 工作区文件摘要（目录树 ≤60 项 + 关键文件 ≤30 个、每文件 ≤2500 字符、总量 ≤12000 字符，跳过 node_modules/.git 等）。
- **缓存**：键 = provider + model + 对话历史 hash(FNV-1a) + 草稿；模型标识读取时校验，对话历史变化即重新优化。

## 安装

**方式一：npm 发布后（推荐）**

```bash
dsh plugin --profile web add dsh-prompt-system
```

或在 DSH 设置 → 插件市场搜索安装。安装后重启 DSH web 服务生效。

**方式二：本地包（未发布时）**

1. 把本包目录复制（或软链）到 `~/.dsh/profiles/web/node_modules/dsh-prompt-system`（即 `$DSH_HOME/profiles/web/node_modules/dsh-prompt-system`）；
2. 在 `~/.dsh/profiles/web/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: prompt-system
      name: 'dsh-prompt-system'
```

3. 在 profile 的 `package.json` 的 `dependencies` 中记录 `"dsh-prompt-system": "0.1.0"`；
4. 重启 DSH web 服务生效。

## 结构

```
lib/index.js    Host：Typert Remote `promptOptimizer.optimizePrompt`（扫描/上下文/缓存/LLM 调用）
lib/client.js   浏览器：模型选择左侧按钮、状态机、撤销快照
```

## 配套文档

- 系统提示词全文与「插件注入版」：`prompt-optimizer-system-prompt.md`（同仓库上游工作区）
- 迭代改动清单：`prompt-optimizer-plugin-changelog.md`

## License

MIT
