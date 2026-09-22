# dsh-prompt-system

DeepSeek Harness（DSH）提示词优化插件：在对话输入框的模型选择按钮左侧提供 ✨ 按钮，点击后由**当前对话模型**结合**对话历史**与**工作区文件**优化草稿；插件按草稿意图**自动路由模板**（图片创作 → 图像提示词模板，其余 → 紧凑结构化模板），通用模板可选**轻/中/高/最高四档强度**（决定输出段数）或自定义骨架，图片模板可选标准或自定义，支持一键撤销。

## 行为

| 交互 | 行为 |
|---|---|
| 点击 ✨ | 第一步先创建快照（保存优化前原文），然后调用当前对话模型优化；成功后按钮变红色「撤销」 |
| 优化中 | 按钮显示旋转指示 + 秒数；tooltip 显示「优化中…」 |
| 点击「撤销」 | 无条件恢复快照原文，不触发任何优化请求；恢复后清空快照、按钮复位 ✨ |
| 发送提示词 | 立即清空快照，按钮复位 ✨ |
| 撤销态下手动编辑草稿 | 保持撤销态，快照保留，随时可撤销 |
| Ctrl+Z | 输入框自身的文本编辑撤销，不影响按钮与快照 |

三态都保留无障碍名（`aria-label`）与 tooltip：idle = `优化提示词`，优化中 = `优化中…`，撤销态 = `撤销`。

## 意图路由与模板

插件对草稿做一次**确定性关键词判定**（无额外模型调用、零延迟），在两个模板间路由：

| 模板 | 产物形态 | 来源 |
|---|---|---|
| `general`（默认） | 紧凑纯文本，段落集合由**强度档位**决定（2 / 4 / 7 / 9 段）或用户自定义骨架；逐行连续、无空行、无 `#` 号 | 精简改编自上游 `analytical-optimize` |
| `image` | 3–6 句分层自然语言图像描述（主体 → 光线配色 → 氛围风格 → 可选：材质 / 构图画幅 / 叙事张力），每名词 2–3 个修饰词；分标准 / 自定义两种模式 | 精简改编自上游 `general-image-optimize` |

路由规则：强词表（画 / 图片 / 图像 / 插画 / 插图 / 海报 / 壁纸 / 头像 / 照片 / 摄影 / 渲染图 / photo / poster / illustration / wallpaper / avatar / drawing / sketch）命中 1 个即判 `image`；否则弱词表（构图 / 配色 / 光效 / 光线 / 质感 / 纹理 / 画风 / 手绘 / 水彩 / 油画 / 像素 / 二次元 / 写实 / 赛博朋克 / 镜头感 / render / cyberpunk / anime）命中 ≥2 判 `image`；其余 `general`。草稿同时含「动画 / 视频 / 分镜」时，「画」不再作为强判定（那些词里的「画」不是绘图动词）。

**已知局限**（启发式的固有边界，均由 general 模板内的意图逃生句与撤销按钮兜底）：

- 纯名词式画图描述（如「一只赛博朋克机械猫，霓虹，雨夜」）不识别，落入 `general`；
- 「画一个函数执行流程图」这类 diagram 请求会误判 `image`；
- 上游 prompt-optimizer 暂无「AI 视频」「代码开发」专用模板，故不设对应类别，此类草稿走 `general`。

## 优化产物格式（general 模板）

产物是一段可直接投放的**紧凑纯文本**提示词：段名原样保留但不加 `#` 号，行与行连续排列，不出现空行，也不使用星号、反引号等装饰性 Markdown 标记。

默认档「高」输出七段，「最高」档输出九段：

```
Role：[角色名称]
Background：[背景描述]
Attention：[注意要点和动机激励]
Skills：
- [技能1]
- [技能2]
Goals：
- [目标1]
Constrains：
- [约束1]
Workflow：
1. [第一步]
OutputFormat：
- [输出格式要求1]
Suggestions：
- [工作方法建议1]
```

任何档位都**刻意不输出** `Profile`（其 `Language` / `Description` 说明行在投放时不需要）与 `Initialization`（整段）。

其余约束：直接输出优化后的提示词，不加解释性文字、不用代码块包围；每个部分都要有具体内容，不使用空泛模板占位符；原始提示词里的双花括号变量占位符（如 `{{variable_name}}`）逐字保留。若模型仍用围栏包裹，插件只剥掉最外层一层。

## 设置：优化强度与自定义模板

设置页在 **侧栏设置 →「优化提示词」**（页面标题带一颗 ✨，与 composer 按钮同一视觉标识），改动**即时生效**（无需重启）：优化请求每次调用时现读已解析设置。

页面分「通用模板」与「图片模板」两个区域，每个区域下方固定一个**只读信息框**（浅灰底、细边框、低对比度辅助文字），一眼看清当前模板包含哪些段落；信息框没有任何编辑入口。

### 通用模板（默认「高」）

| 档位 | 段数 | 段落（按此顺序输出） |
|---|---|---|
| 轻 | 2 | Goals、Constrains |
| 中 | 4 | Background、Attention、Goals、Constrains |
| **高（默认）** | **7** | Role、Background、Attention、Goals、Constrains、Workflow、OutputFormat |
| 最高 | 9 | 上述 7 段 + Skills、Suggestions |
| 自定义 | 用户定 | 用户填写的骨架，逐字替换段落列表 |

逐档在前一档上加段。**默认「高」**——页面初次加载、或用户尚未做过任何选择时即按 7 段生效；**「最高」九段与 0.3.0 的输出逐字相同**。每段条数不随档位缩放，任何档位都不输出 `Profile` 与 `Initialization`。

选「自定义」时，只读信息框变为**编辑框**，上方多一行**段名标签区**（Role / Background / Attention / Skills / Goals / Constrains / Workflow / OutputFormat / Suggestions）：

- 点选某个段名 → 把该段名追加进骨架；已在骨架中的标为已加入，再点不会重复添加；
- 也可以**完全跳过点选**，直接在编辑框里手写任意段落名与内容；
- 骨架留空则回落到默认档。

### 图片模板（不分强度）

| 模式 | 说明 |
|---|---|
| 标准（默认） | 内置图像模板：硬约束保真（第一原则）+ 句式结构 + 修饰词密度 + 输出要求 |
| 自定义 | 用你填写的指令逐字替换图像模板的系统指令 |

两种模式都保留收尾的「保留全部硬约束与双花括号占位符」要求，作为占位符保护的安全网。

## 模型与上下文

- **模型绑定**：优先读当前会话的 `modelSelection` 会话投影（`pending ?? lastUsed`，即作曲家里这个会话选定的模型）；会话尚无选择时回退到 `agentDefaultModel.currentSelection()` 全局默认值。不写死任何模型名。
- **所用路由与模板**：宿主在返回值里带上 `route`（provider/model）与 `template`（命中的模板 id）；当前界面不展示它们，仅作为调用方可读的事实。
- **上下文**：会话最近 ≤12 条对话（≤8000 字符）+ 工作区文件摘要（目录树 ≤60 项 + 关键文件 ≤30 个、每文件 ≤2500 字符、总量 ≤12000 字符，跳过 node_modules/.git 等）。两者与草稿一起放进证据 JSON 的 `conversationContext` / `workspaceContext` / `originalPrompt` 字段。
- **缓存**：键 = 模板集版本 + 模板变体（档位与自定义模板）+ provider + model + 对话历史 hash(FNV-1a) + 草稿；模型标识读取时校验，对话历史变化即重新优化；模板文本或词表变化时版本号 +1，换档位也会自然未命中。
- **超时兜底**：单次优化有 `timeoutMs` 上限（默认 300 秒）。到点即中止底层流并返回「优化超时」错误——不会永远停在「优化中」。
- **提示词体积**：单次未命中缓存的优化请求，system 与用户脚手架合计约 2.7 KB（通用模板默认「高」档；九段「最高」档 2.7 KB）/ 3.0 KB（图片模板标准档），不含上下文证据；档位越低骨架越短。

## 配置

设置页写的是**用户覆盖层**；profile 行里的 `config` 是 `base` 层。解析顺序：schema 默认值 → 行 `config` → 用户覆盖。清空某字段即回到行 `config` 的值。

```yaml
- insert:
    - id: prompt-system
      name: 'dsh-prompt-system'
      config:
        strength: high      # light | medium | high | max | custom（默认 high）
        timeoutMs: 300000   # 单次优化超时（毫秒）
```

| 字段 | 默认 | 说明 |
|---|---|---|
| `strength` | `high` | 通用模板强度：`light` / `medium` / `high` / `max` / `custom` |
| `customTemplate` | 空 | `custom` 时的段落骨架（每行一段，形如「段名：说明」）；留空回落到 `max` |
| `imageMode` | `standard` | 图片模板模式：`standard` / `custom` |
| `customImageTemplate` | 空 | `custom` 时的图像指令；留空回落到 `standard` |
| `temperature` / `maxTokens` | 不发送 | 默认不带这两个参数；只有显式配置才发送 |
| `timeoutMs` | `300000` | 单次优化超时；到点中止底层流并返回「优化超时」错误 |

> `temperature` / `maxTokens` 默认不发送是有意的：不同 OpenAI 兼容中转（如 SCNet）对显式采样参数的接受度不一致，默认沿用部署侧模型自带的参数最稳。需要固定温度或封顶输出时再显式打开。

## 安装

**方式一：GitHub 源（当前可用）**

```bash
dsh plugin --profile <profile> add github:yuloong07-star/dsh-prompt-system
```

该路径已实测可用：安装后 `dsh.profile.bundles` 会选入 `dsh-prompt-system`，无 “declares no dsh.bundle” 警告。远端当前为 **1.0.0**。

**方式二：npm（暂不可用）**

```bash
dsh plugin --profile <profile> add dsh-prompt-system
```

⚠️ npm 上现存的 `0.1.0` 是旧版：它的 `dsh` 字段**没有 `bundle` 声明**、tarball 里也没有 `cordis.patch.yml`，装上去只会作为普通依赖、不会激活，并打印 “declares no dsh.bundle” 警告。本仓库已发布到 **1.0.0**，但 npm 侧尚未同步，因此当前请用方式一（GitHub 源）或方式三（本地包）。

**方式三：本地包**

1. 把本包目录复制到 `<DSH_HOME>/profiles/<profile>/node_modules/dsh-prompt-system`；
2. 在 `<DSH_HOME>/profiles/<profile>/cordis.patch.yml` 末尾追加：

```yaml
- insert:
    - id: prompt-system
      name: 'dsh-prompt-system'
```

3. 在 profile 的 `package.json` 的 `dependencies` 中记录 `"dsh-prompt-system": "1.0.0"`；
4. 重启 DSH 生效（宿主半代码不在 HMR 监视范围内）。

## 结构

```
lib/index.js    Host：Typert Remote `promptOptimizer.optimizePrompt`（扫描/上下文/缓存/LLM 调用）
                + 设置命名空间 `prompt-optimizer`（档位与自定义模板）
lib/client.js   浏览器：模型选择左侧按钮、状态机、撤销快照；设置页「优化提示词」
cordis.patch.yml  profile 补丁层：插入 prompt-system 宿主行
```

远程调用契约：Typert Remote 方法解析为 `RemoteResult<T>` = `{ ok: true, value }` | `{ ok: false, error }`，宿主返回的业务对象（`{ ok, optimized, route, template }`）在 `value` 里。客户端必须解包后再读 `optimized` / `template` / `error`，否则成功的结果会被误判成失败。

## 许可证与致谢

本插件以 **AGPL-3.0-only** 分发，全文见 [LICENSE](LICENSE)。

`lib/index.js` 中的 general 模板精简改编自 [linshenkx/prompt-optimizer](https://github.com/linshenkx/prompt-optimizer) 的 `analytical-optimize`（分析式结构优化），image 模板精简改编自其 `general-image-optimize`（通用自然语言图像优化）。上游项目同样以 AGPL-3.0-only 授权，版权归 Copyright (C) 2025 linshenkx 所有；精简改编属于衍生作品，故本插件整体沿用 AGPL-3.0-only。插件其余部分（意图路由、Typert Remote 宿主半、浏览器半、上下文采集与缓存）为本仓库原创。
