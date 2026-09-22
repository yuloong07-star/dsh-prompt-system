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
		 * 优化按钮。三态：idle 只显示 ✨；busy 显示旋转指示 + 秒数；undo 显示
		 * 红色「撤销」文字。三态都保留无障碍名与 tooltip。状态机：optimize | busy | undo。
		 *  - 点击 ✨ → 调用宿主 remote `promptOptimizer.optimizePrompt` → 成功后
		 *    按钮变红色「撤销」，快照保存优化前原文；
		 *  - 点击「撤销」→ 恢复原文并清快照，不发起任何优化请求；
		 *  - 用户发送提示词（会话 running 上升沿）→ 清快照并复位 ✨；
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
			settingsTitle: "优化提示词",
			strengthLabel: "通用模板",
			strengthLight: "轻 · 2 段",
			strengthMedium: "中 · 4 段",
			strengthHigh: "高 · 7 段",
			strengthMax: "最高 · 9 段",
			strengthCustom: "自定义",
			sectionTagsLabel: "点选添加段落（也可跳过，直接手写）",
			customTemplateLabel: "自定义段落骨架",
			customTemplateHint: "每行一段，形如「段名：说明」；逐字作为输出段落列表，留空回落到默认档。",
			imageModeLabel: "图片模板",
			imageStandard: "标准",
			imageCustom: "自定义",
			customImageTemplateLabel: "自定义图片模板指令",
			customImageTemplateHint: "逐字替换图像模板的系统指令；留空回落到标准档。",
			loading: "加载中…",
			readonly: "当前连接不可写入设置",
			saveFailed: "保存失败"
		};
		const en = {
			label: "Optimize",
			running: "Optimizing…",
			empty: "Type something first",
			failed: "Optimization failed",
			undo: "Undo",
			settingsTitle: "Prompt optimizer",
			strengthLabel: "General template",
			strengthLight: "Light · 2 sections",
			strengthMedium: "Medium · 4 sections",
			strengthHigh: "High · 7 sections",
			strengthMax: "Max · 9 sections",
			strengthCustom: "Custom",
			sectionTagsLabel: "Click to add sections (or skip and type your own)",
			customTemplateLabel: "Custom section skeleton",
			customTemplateHint: "One section per line, like \"Name: description\". Used verbatim; empty falls back to the default tier.",
			imageModeLabel: "Image template",
			imageStandard: "Standard",
			imageCustom: "Custom",
			customImageTemplateLabel: "Custom image template instruction",
			customImageTemplateHint: "Replaces the image template's system instruction verbatim; empty falls back to Standard.",
			loading: "Loading…",
			readonly: "This connection cannot write settings",
			saveFailed: "Save failed"
		};

		// busy 态旋转指示：虚线圆 + CSS 旋转，配合秒数小字给出可见进度。
		// 内联元素而非函数组件：插件运行时不经 JSX 转换，模块级元素可跨渲染复用。
		const SPINNER = react.createElement("svg", {
			key: "spin", viewBox: "0 0 16 16", width: 12, height: 12,
			"aria-hidden": "true", className: "po-spin"
		}, react.createElement("circle", {
			cx: 8, cy: 8, r: 6, fill: "none",
			stroke: "currentColor", strokeWidth: 2,
			strokeDasharray: "28 10", strokeLinecap: "round"
		}));

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
						setPhase("optimize");
						return;
					}
					const res = result && result.ok === true ? result.value : undefined;
					if (res && res.ok && typeof res.optimized === "string" && res.optimized) {
						setPrev(draft);
						setLastOptimized(res.optimized);
						inputActions.setDraft(res.optimized);
						setPhase("undo");
					} else {
						setError((res && res.error) || t("failed"));
						setPhase("optimize");
					}
				} catch (e) {
					setError(String((e && e.message) || e));
					setPhase("optimize");
				}
			};

			// 三态内容：idle 只显示 ✨；busy 旋转 + 秒数；undo 红色「撤销」文字
			const content = phase === "busy"
				? [
					SPINNER,
					react.createElement("span", { key: "secs", className: "po-secs" }, elapsed + "s"),
				]
				: phase === "undo" ? t("undo") : "✨";
			// 无障碍名：✨ 与旋转态没有可读文字，必须显式命名
			const aria = phase === "undo" ? t("undo") : phase === "busy" ? t("running") : t("label");
			const title = phase === "undo" ? t("undo") : phase === "busy" ? t("running") : t("label");

			return react.createElement("div", { className: "po-wrap" },
				react.createElement("button", {
					type: "button",
					className: "po-btn" + (phase === "undo" ? " po-undo" : ""),
					onClick,
					disabled: phase === "busy",
					title,
					"aria-label": aria,
				}, content),
				error ? react.createElement("span", { className: "po-error", title: error }, error) : null
			);
		}

		// —— 设置页：通用模板强度 + 图片模板模式 ——
		const STRENGTH_CHOICES = [
			["light", "strengthLight"],
			["medium", "strengthMedium"],
			["high", "strengthHigh"],
			["max", "strengthMax"],
			["custom", "strengthCustom"]
		];
		const IMAGE_MODE_CHOICES = [
			["standard", "imageStandard"],
			["custom", "imageCustom"]
		];

		/** 段落名（与宿主骨架逐字一致），用于只读信息框与段名标签区。 */
		const SECTION_NAMES = ["Role", "Background", "Attention", "Skills", "Goals", "Constrains", "Workflow", "OutputFormat", "Suggestions"];
		/** 每段的简短说明，只用于信息框展示。 */
		const SECTION_DESC = {
			Role: "专业角色名称",
			Background: "背景与上下文",
			Attention: "注意要点与动机激励",
			Skills: "关键专业能力",
			Goals: "来自用户核心需求的具体目标",
			Constrains: "执行规则与限制",
			Workflow: "完成任务的具体步骤",
			OutputFormat: "输出结果的格式要求",
			Suggestions: "角色内在的工作方法论"
		};
		/** 档位 → 段落集合（与宿主 SECTION_SETS 保持一致，仅用于信息框展示）。 */
		const TIER_SECTIONS = {
			light: ["Goals", "Constrains"],
			medium: ["Background", "Attention", "Goals", "Constrains"],
			high: ["Role", "Background", "Attention", "Goals", "Constrains", "Workflow", "OutputFormat"],
			max: SECTION_NAMES
		};
		/** 标准图片模板的组成部分，仅用于信息框展示。 */
		const IMAGE_STANDARD_LINES = ["硬约束保真（第一原则）", "句式结构", "修饰词密度", "输出要求"];

		/** 一行档位选择（返回元素而非函数组件：stub 与真机行为一致，便于断言）。 */
		function choiceRow(key, t, label, choices, value, disabled, onPick) {
			return react.createElement("div", { key, className: "po-set-row" },
				react.createElement("span", { className: "po-set-label" }, label),
				react.createElement("div", { className: "po-set-opts" },
					choices.map((choice) => react.createElement("button", {
						key: choice[0],
						type: "button",
						className: "po-set-opt" + (value === choice[0] ? " po-set-opt-on" : ""),
						disabled,
						onClick: () => onPick(choice[0])
					}, t(choice[1])))));
		}

		/** 只读信息框：浅灰底、细边框、低对比度辅助文字；没有编辑入口。 */
		function infoBox(key, lines) {
			return react.createElement("div", { key, className: "po-info" },
				react.createElement("pre", { className: "po-info-body" }, lines.join("\n")));
		}

		/** 段名标签区：点选把段名加进自定义骨架；也可以完全不点，直接在编辑框里写。 */
		function tagRow(key, t, present, disabled, onAdd) {
			return react.createElement("div", { key, className: "po-set-row" },
				react.createElement("span", { className: "po-set-label" }, t("sectionTagsLabel")),
				react.createElement("div", { className: "po-tags" },
					SECTION_NAMES.map((name) => react.createElement("button", {
						key: name,
						type: "button",
						className: "po-tag" + (present.has(name) ? " po-tag-on" : ""),
						disabled,
						onClick: () => onAdd(name)
					}, name))));
		}

		/** 一个多行模板编辑框；失焦时提交（值未变则不写）。 */
		function editorRow(key, label, hint, value, disabled, onChange, onCommit) {
			return react.createElement("div", { key, className: "po-set-row" },
				react.createElement("span", { className: "po-set-label" }, label),
				react.createElement("span", { className: "po-set-hint" }, hint),
				react.createElement("textarea", {
					className: "po-set-area",
					value,
					disabled,
					onChange,
					onBlur: onCommit
				}));
		}

		/**
		 * 设置页内容：通用模板（轻/中/高/最高/自定义）+ 图片模板（标准/自定义）。
		 * 每个区域下方是一个只读信息框，一眼看清当前模板包含哪些段落；没有编辑入口。
		 * 通用模板选「自定义」时信息框变为编辑框，上方多一行段名标签区（可点选添加，也可跳过直接手写）。
		 * 数据来自 inject 面的 read/write/subscribe（宿主 settings 命名空间 prompt-optimizer）。
		 */
		function SettingsSection(props) {
			const { t, read, write, subscribe } = props;
			const [snap, setSnap] = react.useState(() => read());
			const [busy, setBusy] = react.useState(false);
			const [error, setError] = react.useState(null);
			// null = 未编辑，显示已保存值；否则显示本地草稿，失焦才提交
			const [draftTemplate, setDraftTemplate] = react.useState(null);
			const [draftImage, setDraftImage] = react.useState(null);

			react.useEffect(() => {
				const sync = () => setSnap(read());
				sync();
				return subscribe(sync);
			}, [read, subscribe]);

			const value = (snap && snap.value) || {};
			const loading = !snap || snap.status === "loading";
			const writable = Boolean(snap) && snap.status !== "unavailable" && snap.writable !== false;
			const disabled = busy || !writable;

			const save = (field, next) => {
				setBusy(true);
				setError(null);
				let result;
				try { result = write(field, next); }
				catch (e) { setBusy(false); setError(String((e && e.message) || e)); return; }
				Promise.resolve(result).then(
					() => { setBusy(false); },
					(e) => { setBusy(false); setError(String((e && e.message) || e) || t("saveFailed")); }
				);
			};

			const strength = value.strength || "high";
			const imageMode = value.imageMode || "standard";
			const savedTemplate = value.customTemplate || "";
			const savedImage = value.customImageTemplate || "";
			const shownTemplate = draftTemplate === null ? savedTemplate : draftTemplate;
			const shownImage = draftImage === null ? savedImage : draftImage;
			// 已出现在骨架中的段名（标签置为已加入）
			const present = new Set(shownTemplate.split("\n").map((line) => line.split("：")[0].trim()).filter(Boolean));
			const rows = [];

			// 功能标识：与 composer 按钮同一颗星
			rows.push(react.createElement("div", { key: "brand", className: "po-set-brand" },
				react.createElement("span", { className: "po-set-star", "aria-hidden": "true" }, "✨"),
				react.createElement("span", { className: "po-set-title" }, t("settingsTitle"))));

			// —— 通用模板 ——
			rows.push(choiceRow("strength", t, t("strengthLabel"), STRENGTH_CHOICES, strength, disabled,
				(id) => save("strength", id)));

			if (strength === "custom") {
				rows.push(tagRow("tags", t, present, disabled, (name) => {
					if (present.has(name)) return;
					const lines = shownTemplate ? shownTemplate.split("\n") : [];
					lines.push(name + "：");
					const next = lines.join("\n");
					setDraftTemplate(next);
					save("customTemplate", next);
				}));
				rows.push(editorRow("tpl", t("customTemplateLabel"), t("customTemplateHint"), shownTemplate, disabled,
					(e) => setDraftTemplate(e.target.value),
					() => {
						if (draftTemplate !== null && draftTemplate !== savedTemplate) save("customTemplate", draftTemplate);
						setDraftTemplate(null);
					}));
			} else {
				const names = TIER_SECTIONS[strength] ?? TIER_SECTIONS.high;
				rows.push(infoBox("tpl-info", names.map((name) => name + "：" + SECTION_DESC[name])));
			}

			// —— 图片模板 ——
			rows.push(choiceRow("imageMode", t, t("imageModeLabel"), IMAGE_MODE_CHOICES, imageMode, disabled,
				(id) => save("imageMode", id)));

			if (imageMode === "custom") {
				rows.push(editorRow("imgtpl", t("customImageTemplateLabel"), t("customImageTemplateHint"), shownImage, disabled,
					(e) => setDraftImage(e.target.value),
					() => {
						if (draftImage !== null && draftImage !== savedImage) save("customImageTemplate", draftImage);
						setDraftImage(null);
					}));
			} else {
				rows.push(infoBox("img-info", IMAGE_STANDARD_LINES));
			}

			if (loading) rows.push(react.createElement("span", { key: "loading", className: "po-set-hint" }, t("loading")));
			else if (!writable) rows.push(react.createElement("span", { key: "ro", className: "po-set-hint" }, t("readonly")));
			if (error) rows.push(react.createElement("span", { key: "err", className: "po-set-err" }, error));

			return react.createElement("div", { className: "po-set" }, rows);
		}

		const CSS = [
			".po-wrap{display:inline-flex;align-items:center;gap:6px;flex:none}",
			".po-btn{height:28px;padding:0 10px;display:inline-flex;align-items:center;gap:4px;border:none;",
			"border-radius:999px;background:transparent;color:var(--dsw-alias-label-secondary);",
			"font-size:13px;white-space:nowrap;cursor:pointer;flex:none;transition:background-color .1s}",
			".po-btn:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}",
			".po-btn:disabled{opacity:.5;cursor:default}",
			".po-secs{font-size:12px;font-variant-numeric:tabular-nums}",
			"@keyframes po-spin{to{transform:rotate(360deg)}}",
			".po-spin{animation:po-spin .9s linear infinite}",
			".po-undo{color:var(--dsw-alias-state-error-primary)}",
			".po-undo:hover:not(:disabled){color:var(--dsw-alias-state-error-primary)}",
			".po-error{font-size:12px;color:var(--dsw-alias-state-error-primary);max-width:200px;",
			"overflow:hidden;text-overflow:ellipsis;white-space:nowrap}",
			".po-set{display:flex;flex-direction:column;gap:16px;padding:4px 0}",
			".po-set-row{display:flex;flex-direction:column;gap:6px}",
			".po-set-label{font-size:13px;font-weight:500;color:var(--dsw-alias-label-primary)}",
			".po-set-hint{font-size:12px;line-height:1.5;color:var(--dsw-alias-label-secondary)}",
			".po-set-opts{display:flex;flex-wrap:wrap;gap:8px}",
			".po-set-opt{height:28px;padding:0 12px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;",
			"background:transparent;color:var(--dsw-alias-label-secondary);font-size:13px;cursor:pointer}",
			".po-set-opt:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}",
			".po-set-opt-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}",
			".po-set-opt:disabled{opacity:.5;cursor:default}",
			".po-set-area{width:100%;min-height:120px;box-sizing:border-box;padding:8px;",
			"border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:transparent;",
			"color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.5;resize:vertical;",
			"font-family:ui-monospace,SFMono-Regular,Menlo,monospace}",
			".po-set-err{font-size:12px;color:var(--dsw-alias-state-error-primary)}",
			".po-set-brand{display:flex;align-items:center;gap:8px}",
			".po-set-star{font-size:15px;line-height:1}",
			".po-set-title{font-size:15px;font-weight:600;color:var(--dsw-alias-label-primary)}",
			".po-info{background:var(--dsw-alias-bg-layer-2);border:1px solid var(--dsw-alias-border-l1);",
			"border-radius:8px;padding:8px 10px}",
			".po-info-body{margin:0;font-size:12px;line-height:1.7;color:var(--dsw-alias-label-secondary);",
			"white-space:pre-wrap;word-break:break-word;font-family:inherit}",
			".po-tags{display:flex;flex-wrap:wrap;gap:6px}",
			".po-tag{height:24px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:999px;",
			"background:transparent;color:var(--dsw-alias-label-secondary);font-size:12px;cursor:pointer}",
			".po-tag:hover:not(:disabled){background:var(--dsw-alias-bg-layer-2)}",
			".po-tag-on{border-color:var(--dsw-alias-brand-primary);color:var(--dsw-alias-brand-primary)}",
			".po-tag:disabled{opacity:.5;cursor:default}"
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
		const inject = ["slots", "locale", "remote", "settingsScope"];

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

			// —— 设置页：优化强度与自定义模板 ——
			// 命名空间由宿主半用 installSection 注册；这里只读写，不做本地镜像。
			const settingsScope = ctx.settingsScope.bind({ namespace: "prompt-optimizer" });
			const t = ctx.locale.bind(NS);
			ctx.slots.inject("settings.section", () => ctx.slots.register({
				name: "settings.section",
				id: "prompt-optimizer",
				order: 50,
				label: () => t("settingsTitle"),
				locale: NS,
				inject: () => ({
					read: () => settingsScope.getSnapshot(),
					write: (field, value) => settingsScope.set(field, value),
					subscribe: (cb) => settingsScope.subscribe(cb)
				})
			}, SettingsSection));
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});
