window.__ModuleLoader__.load({
	id: "dsh-prompt-system",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");

		/**
		 * dsh-prompt-system — client half.
		 *
		 * 在 composer 工具行模型选择按钮左侧（conversation.input.right 插槽）注册
		 * 「优化提示词」按钮。状态机：optimize | busy | undo。
		 *  - 点击「优化」→ 调用宿主 remote `promptOptimizer.optimizePrompt` → 成功后
		 *    按钮变「撤销」，快照保存优化前原文；
		 *  - 点击「撤销」→ 恢复原文并清快照，不发起任何优化请求；
		 *  - 用户发送提示词（会话 running 上升沿）→ 清快照并复位「优化提示词」；
		 *  - 撤销态下用户手动编辑草稿 → 保持撤销态（快照不丢）；
		 *  - Ctrl+Z → 输入框自身编辑撤销，不影响按钮与快照。
		 */
		const NS = "promptOptimizer";
		const zh = {
			label: "优化提示词",
			running: "优化中…",
			empty: "先输入内容再优化",
			failed: "优化失败",
			undo: "撤销",
			undoTitle: "撤销本次优化，恢复优化前的原文"
		};
		const en = {
			label: "Optimize",
			running: "Optimizing…",
			empty: "Type something first",
			failed: "Optimization failed",
			undo: "Undo",
			undoTitle: "Undo this optimization and restore the original draft"
		};

		// —— Typert Remote face（与宿主 lib/index.js 的 promptOptimizer 服务对应）——
		// strict codec 必须携带 create() 工厂：Typert 注册表校验它，宿主 decode 调用它。
		const looseCodec = () => ({
			mode: "strict",
			typeSymbol: "dsh-prompt-system/types#Json",
			create: () => ({ parse: (value) => value })
		});
		const descriptor = (method, parameters) => ({
			id: `dsh-prompt-system#promptOptimizer/${method}`,
			service: "promptOptimizer",
			namespace: "promptOptimizer",
			method,
			invocation: { kind: "direct" },
			parameters: parameters.map((name) => ({ name, wire: name, source: "json", codec: looseCodec() })),
			result: looseCodec()
		});
		const REMOTE = {
			package: "dsh-prompt-system",
			descriptors: [descriptor("optimizePrompt", ["args"])]
		};

		// —— 按钮组件 ——
		function OptimizeButton(props) {
			const { useInput, inputActions, sessionId, useSession, t, call } = props;
			const draft = useInput ? useInput((s) => s.draft) : "";
			const sessionRunning = useSession ? useSession((s) => s.running) : false;
			const [phase, setPhase] = react.useState("optimize"); // optimize | busy | undo
			const [prev, setPrev] = react.useState(null);
			const [lastOptimized, setLastOptimized] = react.useState(null);
			const [error, setError] = react.useState(null);
			// 上一次成功优化实际使用的模型路由（provider/model），仅用于 tooltip 展示
			const [route, setRoute] = react.useState(null);
			// 忙碌态已耗秒数：一次优化可能持续 1–3 分钟，给出可见进度
			const [elapsed, setElapsed] = react.useState(0);
			const runningRef = react.useRef(false);
			const prevRunningRef = react.useRef(false);

			react.useEffect(() => { runningRef.current = sessionRunning; }, [sessionRunning]);

			// 忙碌计时：进入 busy 归零并每秒 +1，离开 busy 或卸载时清理定时器。
			react.useEffect(() => {
				if (phase !== "busy") return undefined;
				setElapsed(0);
				const timer = setInterval(() => { setElapsed((n) => n + 1); }, 1000);
				return () => { clearInterval(timer); };
			}, [phase]);

			// 发送复位：会话从非运行变为运行（用户发送了提示词）时，清快照并复位。
			react.useEffect(() => {
				const edge = sessionRunning && !prevRunningRef.current;
				prevRunningRef.current = sessionRunning;
				if (!edge) return;
				setPrev(null);
				setLastOptimized(null);
				setError(null);
				setRoute(null);
				setPhase("optimize");
			}, [sessionRunning]);

			const onClick = async () => {
				if (phase === "busy") return;
				if (phase === "undo") {
					// 仅撤销：恢复原文，不发起任何优化请求；恢复后清空快照并复位
					if (prev !== null) inputActions.setDraft(prev);
					setPrev(null);
					setLastOptimized(null);
					setError(null);
					setRoute(null);
					setPhase("optimize");
					return;
				}
				const text = (draft || "").trim();
				if (!text) { setError(t("empty")); return; }
				setPhase("busy");
				setError(null);
				try {
					// Typert Remote 调用返回 RemoteResult：业务对象在 value 里，传输失败在 error 里。
					const result = await call({ sessionId, draft: text });
					if (runningRef.current) {
						// 优化期间用户已发送提示词：丢弃结果，不复位为撤销态
						setPhase("optimize");
						return;
					}
					if (result && result.ok === false) {
						// 传输层失败：RemoteError（Error 子类），取其 message
						setError(String((result.error && result.error.message) || result.error || t("failed")));
						setRoute(null);
						setPhase("optimize");
						return;
					}
					const res = result && result.ok === true ? result.value : undefined;
					if (res && res.ok && typeof res.optimized === "string" && res.optimized) {
						setPrev(draft);
						setLastOptimized(res.optimized);
						inputActions.setDraft(res.optimized);
						setRoute(typeof res.route === "string" && res.route ? res.route : null);
						setPhase("undo");
					} else {
						setError((res && res.error) || t("failed"));
						setRoute(null);
						setPhase("optimize");
					}
				} catch (e) {
					setError(String((e && e.message) || e));
					setRoute(null);
					setPhase("optimize");
				}
			};

			const busyLabel = elapsed > 0 ? t("running") + " " + elapsed + "s" : t("running");
			const label = phase === "busy" ? busyLabel : phase === "undo" ? t("undo") : "✨ " + t("label");
			const title = phase === "undo" ? t("undoTitle") : (route ? t("label") + " · " + route : t("label"));

			return react.createElement("div", { className: "po-wrap" },
				react.createElement("button", {
					type: "button",
					className: "po-btn" + (phase === "undo" ? " po-undo" : ""),
					onClick,
					disabled: phase === "busy",
					title,
				}, label),
				error ? react.createElement("span", { className: "po-error", title: error }, error) : null
			);
		}

		const CSS = [
			".po-wrap{display:inline-flex;align-items:center;gap:6px;flex:none}",
			".po-btn{height:28px;padding:0 10px;display:inline-flex;align-items:center;gap:4px;border:none;",
			"border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);",
			"font-size:13px;white-space:nowrap;cursor:pointer;flex:none;transition:background-color .1s}",
			".po-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}",
			".po-btn:disabled{opacity:.5;cursor:default}",
			".po-undo{color:var(--dsw-alias-state-warn-primary)}",
			".po-undo:hover:not(:disabled){color:var(--dsw-alias-state-warn-primary)}",
			".po-error{font-size:12px;color:var(--dsw-alias-state-error-primary);max-width:200px;",
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap}"
		].join("");

		const TAG = "dsh-prompt-system/client.css";
		function ensureCss() {
			if (typeof document === "undefined") return;
			if (document.querySelector("style[data-plugin-css=" + JSON.stringify(TAG) + "]")) return;
			const tag = document.createElement("style");
			tag.dataset.plugin = "dsh-prompt-system";
			tag.dataset.pluginCss = TAG;
			tag.textContent = CSS;
			document.head.appendChild(tag);
		}

		/** Required browser services. */
		const inject = ["slots", "locale", "remote"];

		function apply(ctx) {
			ctx.effect(() => ctx.locale.register(NS, { zh, en }), "dsh-prompt-system: dictionaries");
			ensureCss();

			let mountFailure = null;
			const mountPromise = ctx.remote.$mount(REMOTE).then((dispose) => {
				ctx.effect(() => dispose, "dsh-prompt-system: remote face");
				return true;
			}, (error) => {
				mountFailure = String((error && error.message) || error);
				console.error("dsh-prompt-system: remote face mount failed", error);
				return false;
			});

			/** Resolve the mounted namespace service, waiting for the mount. */
			const remote = async () => {
				await mountPromise;
				if (mountFailure !== null) throw new Error("promptOptimizer 远程接口未就绪: " + mountFailure);
				const service = ctx.get("remote.promptOptimizer");
				if (service === undefined || service === null || typeof service !== "object") {
					await new Promise((resolve) => setTimeout(resolve, 50));
					const retry = ctx.get("remote.promptOptimizer");
					if (retry === undefined || retry === null || typeof retry !== "object") {
						throw new Error("promptOptimizer 远程接口未注册");
					}
					return retry;
				}
				return service;
			};

			ctx.slots.inject("conversation.input.right", () => ctx.slots.register({
				name: "conversation.input.right",
				id: "prompt-optimizer",
				order: 0,
				locale: NS,
				inject: (sessionId) => ({
					call: async (args) => (await remote()).optimizePrompt(args)
				})
			}, OptimizeButton));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
