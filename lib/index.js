/**
 * dsh-prompt-system — host half.
 *
 * 提示词优化插件宿主半：通过 Typert Remote 暴露 `promptOptimizer.optimizePrompt`。
 * 浏览器 Client 半（lib/client.js）点击「优化提示词」后调用它：
 *   1. 模型绑定：agentDefaultModel.currentSelection()（创建会话时刻界面选定的模型）；
 *   2. 上下文：会话最近对话（≤12 条 / ≤8000 字符）+ 工作区文件（≤30 文件 / ≤12000 字符）；
 *   3. 缓存：键 = provider + model + 对话历史 hash(FNV-1a) + 草稿，命中直接返回；
 *   4. 输出：三段式（目标/实现措施/约束，约束 ≤3 条）精准克制风格。
 */
import { Remote, TypertRemoteService } from "@deepseek-ai/dsh-typert-protocol";

const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", ".nuxt", ".cache",
  "__pycache__", ".venv", "venv", "coverage", ".idea", ".vscode", ".turbo", ".output",
]);
const SKIP_EXT = new Set([
  ".png", ".jpg", ".jpeg", ".gif", ".webp", ".ico", ".svg", ".woff", ".woff2",
  ".ttf", ".eot", ".zip", ".tar", ".gz", ".7z", ".exe", ".dll", ".so", ".bin",
  ".pdf", ".pyc", ".lock", ".map", ".min.js", ".min.css",
]);

async function scanWorkspace(fs, cwd) {
  const root = await fs.resolve(cwd);
  const entries = await fs.listDir(root);
  const tree = [];
  const ranked = [];
  for (const e of entries) {
    const name = e.name;
    if (e.type === "directory") {
      if (!SKIP_DIRS.has(name)) tree.push(name + "/");
    } else {
      const lower = name.toLowerCase();
      if (SKIP_EXT.has(lower)) continue;
      tree.push(name);
      let pri = 100;
      if (/^readme/i.test(name)) pri = 0;
      else if ([
        "package.json", "pyproject.toml", "cargo.toml", "go.mod",
        "requirements.txt", "tsconfig.json", "vite.config.ts",
        "vite.config.js", "webpack.config.js",
      ].includes(name)) pri = 1;
      else if (/\.(md|txt)$/i.test(name)) pri = 2;
      else if (/\.(ts|tsx|js|jsx|py|rs|go|java|c|cpp|h|hpp|cs|vue|svelte|json|yaml|yml|toml|ini|sh|bat|ps1|sql)$/i.test(name)) pri = 3;
      ranked.push({ e, name, pri });
    }
  }
  ranked.sort((a, b) => a.pri - b.pri);
  const MAX_FILES = 30, MAX_TOTAL = 12000, MAX_SNIPPET = 2500;
  const files = [];
  let total = 0;
  for (const { e, name } of ranked) {
    if (files.length >= MAX_FILES || total >= MAX_TOTAL) break;
    try {
      const text = await fs.readText(e.target);
      const snippet = text.slice(0, MAX_SNIPPET) + (text.length > MAX_SNIPPET ? "\n…(截断)" : "");
      files.push({ path: name, snippet });
      total += snippet.length;
    } catch { /* 跳过不可读文件 */ }
  }
  return { tree: tree.slice(0, 60), files };
}

/** 轻量字符串哈希（FNV-1a，32 位，十六进制），用于把对话历史压缩进缓存键。 */
function hashString(input) {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** 从会话最新对话消息提取纯文本上下文（最近至多 12 条、总量上限 8000 字符）。 */
function extractConversation(session) {
  if (!session || typeof session.deriveMessages !== "function") return "";
  let messages;
  try { messages = session.deriveMessages(); } catch { return ""; }
  if (!messages || messages.length === 0) return "";
  const MAX_HISTORY = 12;
  const MAX_HISTORY_CHARS = 8000;
  const recent = messages.slice(-MAX_HISTORY);
  const lines = [];
  let total = 0;
  for (const m of recent) {
    let text = "";
    const content = m && m.content;
    if (Array.isArray(content)) {
      for (const block of content) {
        if (block && block.type === "text" && typeof block.text === "string") text += block.text;
      }
    }
    if (!text) continue;
    const prefix = m.role === "assistant" ? "助手：" : "用户：";
    const line = prefix + text;
    total += line.length;
    if (total > MAX_HISTORY_CHARS) break;
    lines.push(line);
  }
  return lines.join("\n");
}

const SYSTEM = [
  "你是提示词优化引擎。用户给出草稿（原始提示词或模糊需求）与工作区文件摘要。把草稿改写为可直接执行的提示词正文，固定三段结构：",
  "【目标】把模糊描述改写为具体、可执行的任务：做什么、给谁用、期望结果。",
  "【实现措施】每条一句话给出方向即可，不写步骤细节、示例模板或完成标准；引用工作区摘要中真实存在的文件/目录/技术栈。",
  "【约束】最多 3 条，只保留影响输出正确性的必要规则；模糊措辞量化（\"简短\"→\"2-3 句\"）。",
  "改写规则：补齐指令/上下文/输入数据/输出指示四要素；否定式指令改为正向行为+兜底；指令与输入用分隔符隔离；删除无关细节。",
  "按失败模式增强：格式错→加少样本示例（分布均衡、顺序随机、格式统一）；多步推理错→示范推理过程或追加\"让我们逐步思考\"；知识错→注入资料+\"仅基于资料作答，未覆盖则明确说不知道\"+标注出处；结果不稳定→采样 3-10 条推理路径取多数；任务多步转换→拆提示链一环一转换；推理模型→不手写\"逐步思考\"，指令一句陈述句，思考力度低→中→高逐档加。",
  "要求：保持原意不臆造；与草稿同语言；只输出正文，不加解释、不包 Markdown 代码块；默认不添加\"需人工核验\"标注，仅当草稿明确要求时保留；技术栈优先取自工作区摘要，无法确定时在提示词中注明假设并允许替换；摘要未覆盖的内容不编造；草稿原文与\"约束上限 3 条\"冲突时以草稿原文为准，不擅自增删。",
].join("\n");

class PromptOptimizerGateway extends TypertRemoteService {
  static inject = ["sessions", "fs", "llm", "agentDefaultModel"];

  constructor(ctx) {
    super(ctx, "promptOptimizer");
    const decorator = Remote("optimizePrompt");
    decorator(PromptOptimizerGateway.prototype.optimizePrompt, {
      name: "optimizePrompt",
      private: false,
      static: false,
      addInitializer: (initializer) => initializer.call(this),
    });
  }

  /**
   * 优化一段草稿。参数与返回均为 JSON。
   * @param args - { sessionId: string, draft: string }
   * @returns { ok: boolean, optimized?: string, cached?: boolean, error?: string }
   */
  async optimizePrompt(args) {
    const sessions = this.ctx.get("sessions");
    const fs = this.ctx.get("fs");
    const llm = this.ctx.get("llm");
    const adm = this.ctx.get("agentDefaultModel");
    if (!sessions || !fs || !llm || !adm) return { ok: false, error: "宿主服务缺失" };

    const sessionId = args && typeof args.sessionId === "string" ? args.sessionId : "";
    const draft = args && typeof args.draft === "string" ? args.draft : "";
    if (!draft.trim()) return { ok: false, error: "输入框是空的，先写点内容再优化" };

    const session = sessions.get(sessionId);
    const cwd = session && session.header ? session.header.cwd : undefined;
    if (!cwd) return { ok: false, error: "找不到会话的工作区目录" };

    // 创建会话时刻界面选定的模型
    const def = adm.currentSelection();
    if (!def || !def.provider || !def.model) return { ok: false, error: "无法确定当前对话模型" };
    const sel = {
      provider: def.provider,
      model: def.model,
      ...(def.reasoningEffort ? { reasoningEffort: def.reasoningEffort } : {}),
    };

    const historyText = extractConversation(session);
    const historyHash = hashString(historyText);

    // 缓存：键含 provider/model/历史 hash/草稿；条目存模型标识供读取时校验
    const CACHE_LIMIT = 64;
    if (this.cache === undefined) this.cache = new Map();
    const cache = this.cache;
    const cacheKey = sel.provider + "\u0000" + sel.model + "\u0000" + historyHash + "\u0000" + draft;
    const hit = cache.get(cacheKey);
    // 缓存键已含模型标识；条目再校验一次模型一致，不一致视为未命中并重新请求
    if (hit !== undefined && hit.provider === sel.provider && hit.model === sel.model) {
      return { ok: true, optimized: hit.optimized, cached: true };
    }

    let ws;
    try { ws = await scanWorkspace(fs, cwd); } catch { ws = { tree: [], files: [] }; }

    let wsText = "";
    if (ws.tree.length) wsText += "工作区目录结构：\n" + ws.tree.join("\n") + "\n\n";
    if (ws.files.length) wsText += "关键文件内容：\n" + ws.files.map((f) => `--- ${f.path} ---\n${f.snippet}`).join("\n\n");

    const parts = [];
    if (historyText) parts.push("【当前对话上下文】\n" + historyText);
    if (wsText) parts.push("【工作区上下文】\n" + wsText);
    parts.push("【我的提示词草稿】\n" + draft);
    const userText = "请基于提供的上下文优化这段提示词。\n\n" + parts.join("\n\n");

    let out = "";
    let failed = null;
    try {
      const stream = llm.stream({
        provider: sel.provider,
        model: sel.model,
        ...(sel.reasoningEffort ? { reasoningEffort: sel.reasoningEffort } : {}),
        system: SYSTEM,
        messages: [{ role: "user", content: [{ type: "text", text: userText }] }],
      });
      for await (const chunk of stream) {
        if (chunk.type === "text-delta") out += chunk.text;
        else if (chunk.type === "finish" && (chunk.reason.kind === "error" || chunk.reason.kind === "aborted")) {
          failed = (chunk.reason.failure && chunk.reason.failure.message) || chunk.reason.kind;
        }
      }
    } catch (e) {
      return { ok: false, error: "模型调用失败：" + String((e && e.message) || e) };
    }
    if (failed) return { ok: false, error: "模型调用失败：" + failed };
    if (!out.trim()) return { ok: false, error: "模型没有返回内容" };

    const optimized = out.trim();
    if (cache.size >= CACHE_LIMIT && !cache.has(cacheKey)) {
      const oldest = cache.keys().next().value;
      if (oldest !== undefined) cache.delete(oldest);
    }
    cache.set(cacheKey, { provider: sel.provider, model: sel.model, optimized });
    return { ok: true, optimized };
  }
}

const name = "dsh-prompt-system";
const inject = ["sessions", "fs", "llm", "agentDefaultModel"];

function apply(ctx) {
  ctx.plugin(PromptOptimizerGateway);
}

export { apply, inject, name };
