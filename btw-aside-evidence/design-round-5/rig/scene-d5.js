
/* ===================================================================== *
 *   DESIGN ROUND 5 (design-482-r5) — scratch copy, never committed.
 *
 *   Appended after rounds 1-5's helper layer and scenes, design round 3's
 *   scene and design round 4's scene, to a COPY of
 *   scripts/renderer-driver.mjs (rig/patch-driver-d5.sh). The app's source is
 *   unmodified. ONE scene, three cases:
 *
 *     cap     the amended ceiling rule (commit 5ee9c68f6) measured on the
 *             rendered surface: 0 / 1 / 2 single-line quotes, a WRAPPING
 *             quote and a MULTI-LINE question, at both widths. The claim
 *             under test is `rowsToEdge === 10` with NO row cut, i.e. the
 *             edge lands on a whole line box and the px cut is 0.
 *     gutter  the delta's other rendered change: the exchange region now
 *             reserves a scrollbar gutter always ([scrollbar-gutter:stable]).
 *             Measured in both states (content shorter than the cap, content
 *             overflowing) at both widths, against a SYNTHETIC control so
 *             "this platform reserves nothing for the property" can be told
 *             apart from "the app's declaration is not taking effect".
 *     d10     the previously approved no-scrollbar / no-cut behaviour for
 *             9-, 10- and 11-line answers, on this head.
 * ===================================================================== */

const D5Q = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	// The three needles are sentences of the stub's own LONG answer, so a quote
	// staged from the transcript carries the text the panel then has to lay out.
	SHORT1: "The retry budget is a per-provider allowance",
	SHORT2: "a 4xx spends nothing",
	WRAP:
		"A dropped connection, a reset stream, a timeout before the first byte and an owner 5xx each spend one unit; a 4xx spends nothing, because the request itself was refused and sending it again would be refused again.",
	LONGQ:
		"with a question long enough that it has to wrap onto more than one line in the panel, because the ceiling counts a single question line and this checks where the edge falls when it does not",
};

const d5posts = (needle) => (r4stats().asidePosts ?? []).filter((p) => (p.text ?? "").includes(needle));

/**
 * The panel, the exchange region, the newest answer's ROWS against the clip,
 * and the region's SCROLLBAR GUTTER.
 *
 * The row rects are text Ranges, so their height is the glyph box the browser
 * paints rather than the line box: "how much of a row is visible" is a glyph
 * measurement and the cap's arithmetic is a line-box measurement, so both are
 * reported side by side. `rowsToEdge` is the claim itself: the whole number of
 * answer line boxes between the answer's top and the region's clip.
 *
 * The gutter is `offsetWidth - clientWidth - borders`, which is the layout
 * width the scrollbars took, whatever the platform's reason: a reserved
 * `scrollbar-gutter` and a scrollbar that is actually laid out are the same
 * number here, and `gutterStyle` says which declaration the app shipped.
 */
function d5Geo(cdp) {
	return cdp.evaluate(`(() => {
		const rd = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
		const panel = document.querySelector("[data-lo-aside-panel]");
		if (!panel) return null;
		const region = panel.querySelector('[aria-label="The aside exchange"]');
		if (!region) return null;
		const pr = panel.getBoundingClientRect();
		const rr = region.getBoundingClientRect();
		const clip = rr.top + region.clientHeight;
		const turns = Array.from(region.children);
		const last = turns[turns.length - 1] ?? null;
		const q = last ? last.querySelector(":scope > p") : null;
		const md = last ? last.querySelector(".lo-markdown") : null;
		const qr = q ? q.getBoundingClientRect() : null;
		const mr = md ? md.getBoundingClientRect() : null;
		const cs = md ? getComputedStyle(md) : null;
		const lh = cs ? parseFloat(cs.lineHeight) : null;
		const quotes = q ? Array.from(q.querySelectorAll("span.border-l-2")) : [];
		const lineRows = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rows = []; for (const x of r.getClientRects()) if (!rows.some((y) => Math.abs(y.top - x.top) < 2)) rows.push(x.top); return rows.length; };
		const lines = [];
		if (md) {
			const walk = document.createTreeWalker(md, NodeFilter.SHOW_TEXT);
			let n = walk.nextNode();
			while (n) {
				if (n.nodeValue && n.nodeValue.trim()) {
					const range = document.createRange();
					range.selectNodeContents(n);
					const block = n.parentElement
						? n.parentElement.closest("p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th, .katex-display")
						: null;
					for (const rc of range.getClientRects())
						lines.push({ top: rc.top, bottom: rc.bottom, h: rc.height, block, text: n.nodeValue.trim().slice(0, 48) });
				}
				n = walk.nextNode();
			}
		}
		const rows = [];
		for (const l of lines.sort((a, b) => a.top - b.top)) {
			const row = rows.find((r) => Math.abs(r.top - l.top) < 2);
			if (row) { row.bottom = Math.max(row.bottom, l.bottom); row.texts.push(l.text); }
			else rows.push({ top: l.top, bottom: l.bottom, h: l.h, block: l.block, texts: [l.text] });
		}
		const crossing = rows
			.filter((r) => r.top < clip - 0.5 && r.bottom > clip + 0.5)
			.map((r) => ({
				tag: r.block ? r.block.tagName.toLowerCase() : null,
				text: (r.texts[0] ?? "").slice(0, 44),
				rowH: rd(r.h),
				visiblePx: rd(clip - r.top),
				hiddenPx: rd(r.bottom - clip),
			}));
		const neighbour = rows
			.filter((r) => r.bottom <= clip + 0.5)
			.slice(-1)
			.map((r) => ({ tag: r.block ? r.block.tagName.toLowerCase() : null, text: (r.texts[0] ?? "").slice(0, 44), bottomVsClip: rd(r.bottom - clip) }))[0] ?? null;
		const style = getComputedStyle(region);
		const borders = parseFloat(style.borderLeftWidth) + parseFloat(style.borderRightWidth);
		return {
			panelWidth: rd(pr.width),
			cap: style.maxHeight,
			capPx: rd(parseFloat(style.maxHeight)),
			clientHeight: region.clientHeight,
			scrollHeight: region.scrollHeight,
			maxScroll: rd(region.scrollHeight - region.clientHeight),
			scrollTop: rd(region.scrollTop),
			overflowing: region.scrollHeight > region.clientHeight + 0.5,
			clientWidth: region.clientWidth,
			offsetWidth: region.offsetWidth,
			gutterPx: rd(region.offsetWidth - region.clientWidth - borders),
			gutterStyle: style.scrollbarGutter,
			overflowY: style.overflowY,
			regionWidth: rd(rr.width),
			turns: turns.length,
			questionQuoteBlocks: quotes.length,
			quoteHeights: quotes.map((s) => rd(s.getBoundingClientRect().height)),
			quoteLines: quotes.map(lineRows),
			questionLines: q ? lineRows(q) - quotes.reduce((m, s) => m + lineRows(s), 0) : null,
			questionTopInRegion: qr ? rd(qr.top - rr.top) : null,
			questionBoxH: qr ? rd(qr.height) : null,
			answerFontSize: cs ? cs.fontSize : null,
			answerLineHeight: lh,
			answerTopInRegion: mr ? rd(mr.top - rr.top) : null,
			answerWidth: mr ? rd(mr.width) : null,
			rowPitch: rows.length > 1 ? rd(rows[1].top - rows[0].top) : null,
			rowsToEdge: mr && lh ? rd((clip - mr.top) / lh) : null,
			rows: rows.length,
			fullyVisibleRows: rows.filter((r) => r.top >= rr.top - 0.5 && r.bottom <= clip + 0.5).length,
			rowCrossingClipCount: rows.filter((r) => r.top < clip - 0.5 && r.bottom > clip + 0.5).length,
			crossing,
			lastWholeRow: neighbour,
			paragraphGap: (() => { const ps = md ? Array.from(md.querySelectorAll("p")) : []; return ps.length > 1 ? rd(parseFloat(getComputedStyle(ps[1]).marginTop)) : null; })(),
		};
	})()`);
}

/**
 * THE PLATFORM CONTROL for the gutter question.
 *
 * "The region reports a 0 px gutter" has two possible causes and they need
 * different verdicts: this platform paints overlay scrollbars, so NOTHING
 * reserves layout width (the shipped declaration is a no-op HERE and the panel
 * is unchanged on macOS); or the declaration is not taking effect anywhere,
 * which would leave the cap's own width term unprotected on the platforms
 * design round 4's ruling was written for.
 *
 * So a detached, unrendered-to-the-viewer twin is measured in the same engine
 * and the same frame: one box with `scrollbar-gutter: auto` and one with
 * `stable`, both with `overflow-y: auto` and both forced to overflow. The
 * difference between the two twins is what the PROPERTY is worth on this
 * platform, and the shipped region is then read against it.
 */
function d5PlatformProbe(cdp) {
	return cdp.evaluate(`(() => {
		const rd = (x) => Math.round(x * 10) / 10;
		const father = document.createElement("div");
		father.style.cssText = "position:fixed;left:-9999px;top:0;width:200px;height:60px;";
		document.body.appendChild(father);
		// A 15 px custom webkit scrollbar makes Chromium paint a scrollbar that TAKES
		// layout width - the platform class design round 4's ruling was written for -
		// so the cost of the reserve can be measured on THIS engine rather than assumed.
		const css = document.createElement("style");
		css.textContent = ".d5classic::-webkit-scrollbar{width:15px;height:15px}";
		document.head.appendChild(css);
		// The two states that matter, and they are different questions: content that
		// FITS (what the reserve costs beside a short answer, since with no scrollbar
		// to lay out only the gutter can take width) and content that OVERFLOWS (what
		// an un-reserved region would take away the moment the answer outgrows the cap).
		const twin = (gutter, classic, content) => {
			const box = document.createElement("div");
			box.className = classic ? "d5classic" : "";
			box.style.cssText = "width:200px;height:60px;overflow-y:auto;border:0;padding:0;scrollbar-gutter:" + gutter + ";";
			box.innerHTML = "<div style='height:" + (content === "overflows" ? 400 : 20) + "px'></div>";
			father.appendChild(box);
			return { gutter: gutter, content: content, layoutWidthTaken: rd(box.offsetWidth - box.clientWidth), clientWidth: box.clientWidth };
		};
		const pair = (classic) => {
			const fits = { auto: twin("auto", classic, "fits"), stable: twin("stable", classic, "fits") };
			const overflows = { auto: twin("auto", classic, "overflows"), stable: twin("stable", classic, "overflows") };
			return {
				fits: fits,
				overflows: overflows,
				reserveBesideShortContent: rd(fits.stable.layoutWidthTaken - fits.auto.layoutWidthTaken),
				reflowWhenOverflowStarts: rd(overflows.stable.layoutWidthTaken - overflows.auto.layoutWidthTaken),
			};
		};
		const platform = pair(false);
		const classic = pair(true);
		father.remove();
		css.remove();
		return { platform: platform, classic: classic };
	})()`);
}

async function sceneBtwD5(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("d5 session", sessionId);
	const frames = [];
	const PREFIX = RUN_LABEL ? `d5-${RUN_LABEL}` : "d5";
	const take = async (label, mode = "settled") => {
		const frame = mode === "settled" ? await captureSettled(cdp, `${PREFIX}-${label}`) : await capture(cdp, `${PREFIX}-${label}`);
		frames.push({ ...frame, mode });
		note("frame", JSON.stringify({ label: frame.label, mode, ...frame.pixels }));
		return frame;
	};
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const escape = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const type = async (text) => { await cdp.send("Input.insertText", { text }); await wait(150); };
	const replaceComposer = async (text) => {
		await clickAt(cdp, D5Q.FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
		if (text) await cdp.send("Input.insertText", { text });
		await wait(200);
	};
	const band = () => readQaBand(cdp);
	const awaitBand = (want, n = 80) => qaAwaitPanel(cdp, want, n);
	const idle = () => awaitBand((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	const ask = async (text) => {
		await clickAt(cdp, D5Q.FIELD);
		await type(text);
		await enter();
		for (let i = 0; i < 400; i++) {
			const post = d5posts(text)[0];
			const b = await band();
			if (post && post.status !== null && b.panelAnnounce !== "Asking the aside") return { post, band: b };
			await wait(100);
		}
		return { post: d5posts(text)[0] ?? null, band: await band() };
	};
	const closePanel = async () => { await clickAt(cdp, D5Q.FIELD); await escape(); await awaitBand((b) => b.panel === null, 60); };
	const openPanel = async () => {
		await replaceComposer("/btw");
		await enter();
		return awaitBand((b) => b.panel !== null, 60);
	};

	// ---- S0: one long transcript answer, which is what the quotes are staged from
	await clickAt(cdp, D5Q.FIELD);
	await type("LONGANSWER seed for the design round-5 quotes");
	await enter();
	await awaitBand((b) => (b.transcriptText ?? "").includes(D5Q.TAIL ?? "wrong, not the provider"), 400);
	await idle();

	// `qaOpenSession` sets the dark theme; a light pass asks for it explicitly so
	// the same scene can be driven twice without a second scene.
	if (process.env.D5_THEME) await verb(cdp, "setTheme", process.env.D5_THEME);
	const CASES = (process.env.D5_CASES || "cap,gutter,d10").split(",");
	const table = [];

	/** Open a panel (optionally with staged quotes), ask `PARAGRID<k>`, read the edge. */
	const capCase = async (id, k, { quotes = [], question = "" } = {}) => {
		await replaceComposer("");
		let staged = 0;
		for (const needle of quotes) {
			const s = await r3StageQuote(cdp, needle);
			if (s.pressed) staged += 1;
		}
		await replaceComposer("/btw");
		await enter();
		await awaitBand((b) => b.panel !== null, 60);
		const text = `PARAGRID${k}: ${id} ${question}`.trim();
		await ask(text);
		await wait(350);
		const g = await d5Geo(cdp);
		const post = d5posts(text)[0] ?? null;
		const row = {
			case: id,
			k,
			stagedQuotes: staged,
			wireQuotes: ((post?.text ?? "").match(/<reply-to>/g) ?? []).length,
			quoteBlocks: g?.questionQuoteBlocks ?? null,
			quoteLines: g?.quoteLines ?? null,
			quoteHeights: g?.quoteHeights ?? null,
			questionLines: g?.questionLines ?? null,
			questionBoxH: g?.questionBoxH ?? null,
			capPx: g?.capPx ?? null,
			clientHeight: g?.clientHeight ?? null,
			scrollHeight: g?.scrollHeight ?? null,
			maxScroll: g?.maxScroll ?? null,
			answerTop: g?.answerTopInRegion ?? null,
			lineHeight: g?.answerLineHeight ?? null,
			rowPitch: g?.rowPitch ?? null,
			rowsToEdge: g?.rowsToEdge ?? null,
			rows: g?.rows ?? null,
			fullyVisibleRows: g?.fullyVisibleRows ?? null,
			cut: g?.crossing ?? null,
			lastWholeRow: g?.lastWholeRow ?? null,
			paragraphGap: g?.paragraphGap ?? null,
			scrollTop: g?.scrollTop ?? null,
			gutterPx: g?.gutterPx ?? null,
			answerWidth: g?.answerWidth ?? null,
			clientWidth: g?.clientWidth ?? null,
		};
		table.push(row);
		note(`d5 cap ${id} k${k}`, JSON.stringify(row));
		const cut = row.cut ?? [];
		r2check(
			`d5 cap ${id} k${k}: the edge is 10.0 answer line boxes below the answer's top and NO row is cut`,
			row.rowsToEdge !== null && Math.abs(row.rowsToEdge - 10) <= 0.05 && cut.length === 0,
			JSON.stringify({ rowsToEdge: row.rowsToEdge, answerTop: row.answerTop, lineHeight: row.lineHeight, capPx: row.capPx, clientHeight: row.clientHeight, cut, lastWholeRow: row.lastWholeRow, quoteLines: row.quoteLines, questionLines: row.questionLines }),
		);
		return { g, row };
	};

	if (CASES.includes("cap")) {
		const SUBJECTS = [
			["none", 5, {}],
			["one", 1, { quotes: [D5Q.SHORT1] }],
			["one", 5, { quotes: [D5Q.SHORT1] }],
			["two", 5, { quotes: [D5Q.SHORT1, D5Q.SHORT2] }],
			["wrapquote", 1, { quotes: [D5Q.WRAP] }],
			["wrapquote", 5, { quotes: [D5Q.WRAP] }],
			["wrapq", 1, { question: D5Q.LONGQ }],
			["wrapq", 5, { question: D5Q.LONGQ }],
		];
		for (const [id, k, opts] of SUBJECTS) {
			const { g } = await capCase(id, k, opts);
			if (k === 5 || id === "wrapquote" || id === "wrapq") await take(`cap-${id}-k${k}`);
			if (k === 5 && id === "none") note("cap none k5 geometry", JSON.stringify(g));
			if (k === 5 && id === "one") note("cap one k5 geometry", JSON.stringify(g));
			if (k === 1 && id === "wrapquote") note("cap wrapquote k1 geometry", JSON.stringify(g));
			if (k === 1 && id === "wrapq") note("cap wrapq k1 geometry", JSON.stringify(g));
			await closePanel();
		}
	}

	if (CASES.includes("gutter")) {
		/*
		 * The delta's other rendered change. Both states are measured with the
		 * SAME question text family, so the only difference between the two
		 * readings is whether the content overflows the cap: if reserving the
		 * gutter cost layout width beside short answers, `clientWidth` would
		 * differ between them, and if the property is simply a no-op on this
		 * platform both readings and the twin control agree at 0.
		 */
		const plat = await d5PlatformProbe(cdp);
		note("gutter platform control (detached twins in the same engine: default styling, and a 15px classic scrollbar)", JSON.stringify(plat));
		await openPanel();
		await ask("NLINES2: d5 a short answer beside the gutter");
		await wait(600);
		const shortG = await d5Geo(cdp);
		await take("gutter-short-content");
		note("gutter short-content geometry", JSON.stringify(shortG));
		await ask("NLINES20: d5 an answer that overflows the region");
		await wait(700);
		const longG = await d5Geo(cdp);
		await take("gutter-overflowing");
		note("gutter overflowing geometry", JSON.stringify(longG));
		r2check(
			"gutter: the region's layout width is the same whether the exchange is short or overflowing (the reserve does not appear with the overflow)",
			shortG && longG ? shortG.clientWidth === longG.clientWidth : false,
			JSON.stringify({ shortClientWidth: shortG?.clientWidth, longClientWidth: longG?.clientWidth, shortGutter: shortG?.gutterPx, longGutter: longG?.gutterPx, shortOverflow: shortG?.overflowing, longOverflow: longG?.overflowing, gutterStyle: longG?.gutterStyle }),
		);
		r2check(
			"gutter: the declaration is in effect (this platform's own reserve matches the shipped region's reserve)",
			plat.platform.fits.stable.layoutWidthTaken === (longG?.gutterPx ?? null),
			JSON.stringify({ platformStableFitting: plat.platform.fits.stable.layoutWidthTaken, platformAutoFitting: plat.platform.fits.auto.layoutWidthTaken, reserveBesideShortContent: plat.platform.reserveBesideShortContent, shipped: longG?.gutterPx, gutterStyle: longG?.gutterStyle }),
		);
		r2check(
			"gutter: where scrollbars take layout width, the always-on reserve is present in BOTH states (no reflow when the exchange starts to overflow)",
			plat.classic.fits.stable.layoutWidthTaken === 15 && plat.classic.fits.auto.layoutWidthTaken === 0 && plat.classic.overflows.auto.layoutWidthTaken === 15,
			JSON.stringify({ classicFitsStable: plat.classic.fits.stable.layoutWidthTaken, classicFitsAuto: plat.classic.fits.auto.layoutWidthTaken, classicOverflowsAuto: plat.classic.overflows.auto.layoutWidthTaken, reserveBesideShortContent: plat.classic.reserveBesideShortContent }),
		);
		await closePanel();
	}

	if (CASES.includes("d10")) {
		// The previously approved no-scrollbar / no-cut behaviour, on this head.
		for (const n of [9, 10, 11]) {
			await replaceComposer("");
			await replaceComposer("/btw");
			await enter();
			await awaitBand((b) => b.panel !== null, 60);
			await ask(`NLINES${n}: d5 the D10 row count`);
			await wait(500);
			const g = await d5Geo(cdp);
			note(`d10 ${n} lines`, JSON.stringify({ capPx: g?.capPx, clientHeight: g?.clientHeight, scrollHeight: g?.scrollHeight, maxScroll: g?.maxScroll, rows: g?.rows, rowsToEdge: g?.rowsToEdge, fullyVisibleRows: g?.fullyVisibleRows, rowCrossingClipCount: g?.rowCrossingClipCount, cut: g?.crossing, gutterPx: g?.gutterPx, clientWidth: g?.clientWidth }));
			r2check(
				`d10: a ${n}-line answer ${n <= 10 ? "shows no scrollbar (content fits the cap)" : "overflows the cap"} and cuts no row`,
				n <= 10 ? (g?.maxScroll ?? 99) <= 0 : (g?.maxScroll ?? 0) > 0,
				JSON.stringify({ maxScroll: g?.maxScroll, clientHeight: g?.clientHeight, scrollHeight: g?.scrollHeight, capPx: g?.capPx }),
			);
			r2check(
				`d10: a ${n}-line answer leaves every visible row whole`,
				g?.rowCrossingClipCount === 0,
				JSON.stringify({ rowCrossingClipCount: g?.rowCrossingClipCount, cut: g?.crossing, lastWholeRow: g?.lastWholeRow, rowsToEdge: g?.rowsToEdge }),
			);
			if (n === 11) await take("d10-11-line-answer");
			await closePanel();
		}
	}


	/*
	 * THE QUOTE STAGED WHILE THE PANEL IS OPEN, in both orders.
	 *
	 * The cap cases above stage their quotes BEFORE `/btw` opens the panel. This
	 * case is the other order - the one design round 4's own step measurement used,
	 * where an unquoted turn is already on screen: does the cap follow the NEW
	 * question's measured box when the quoted turn arrives on an open panel?
	 *
	 * It needs both orders because the first pass here found the F-shaped order
	 * (stage, then CLEAR the composer with select-all + Backspace, then type the
	 * question) sends a message with no quote in it at all - the proxy's own record
	 * of the post shows `reply-to=0` - so that shape measures a question that has no
	 * quote block, and a cap that matches it is not a stale measurement.
	 * `wireQuotes` is the daemon-facing truth (the `<reply-to>` blocks in the text
	 * the proxy saw posted) and is reported beside the DOM's own `questionQuoteBlocks`.
	 *
	 * The region is scrolled to its top by the rig before the edge is read: the cap's
	 * promise is about the edge measured from the ANSWER's top, and a settled answer
	 * leaves the region at its own scroll position. The scroll is the instrument.
	 */
	if (CASES.includes("staged")) {
		const impliedQ = (g) => (g && g.answerLineHeight ? Math.round((g.capPx - 10 * g.answerLineHeight - 4) * 10) / 10 : null);
		const scrollTop0 = () => cdp.evaluate('(() => { const r = document.querySelector(\'[aria-label="The aside exchange"]\'); if (!r) return null; r.scrollTop = 0; return r.scrollTop; })()');
		// The cap's promise is measured against the ANSWER's top, so a reading taken
		// before the newest turn has an answer is not a reading of it: wait for the
		// newest turn's markdown to exist, then measure.
		const awaitAnswer = async (n = 100) => {
			let g = await d5Geo(cdp);
			for (let i = 0; i < n && (!g || g.answerTopInRegion === null); i++) { await wait(200); g = await d5Geo(cdp); }
			return g;
		};
		/*
		 * WHERE THE QUOTE PRESS ACTUALLY LANDS.
		 *
		 * The staging helper presses the Quote control's centre point, so at narrow -
		 * where the aside panel overlays the transcript's right side - the question
		 * "did the app drop the quote or did the press miss" needs the DOM's own
		 * answer: the control's box, and what is under that point. Reported beside
		 * the staging result so the wire evidence can be attributed.
		 */
		const quoteProbe = () => cdp.evaluate(`(() => {
			const b = document.querySelector('button[aria-label="Quote"]');
			if (!b) return { present: false };
			const r = b.getBoundingClientRect();
			const cx = Math.round(r.x + r.width / 2), cy = Math.round(r.y + r.height / 2);
			const at = document.elementFromPoint(cx, cy);
			return {
				present: true,
				rect: { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) },
				centre: { cx: cx, cy: cy },
				atPoint: at ? at.tagName.toLowerCase() + "." + String(at.className || "").slice(0, 40) : null,
				underThePanel: !!(at && at.closest && at.closest("[data-lo-aside-panel]")),
			};
		})()`);
		const brief = (g, text) => ({
			capPx: g?.capPx, questionBoxH: g?.questionBoxH, questionQuoteBlocks: g?.questionQuoteBlocks, quoteLines: g?.quoteLines,
			answerTop: g?.answerTopInRegion, lineHeight: g?.answerLineHeight, rowsToEdge: g?.rowsToEdge,
			rowCrossingClipCount: g?.rowCrossingClipCount, cut: g?.crossing, lastWholeRow: g?.lastWholeRow,
			scrollTop: g?.scrollTop, maxScroll: g?.maxScroll, clientHeight: g?.clientHeight,
			impliedQ: impliedQ(g), wireQuotes: ((d5posts(text)[0]?.text ?? "").match(/<reply-to>/g) ?? []).length,
		});

		await openPanel();
		await ask("SENTENCE4: d5 the unquoted first turn");
		await wait(700);
		await scrollTop0();
		await wait(200);
		const t1 = await d5Geo(cdp);
		note("staged turn1 (unquoted, first) geometry", JSON.stringify(brief(t1, "SENTENCE4: d5 the unquoted first turn")));

		// (B) THE F-SHAPED ORDER: stage, then clear the composer, then type.
		await replaceComposer("");
		const stagedB = await r3StageQuote(cdp, D5Q.SHORT1);
		note("staged (B) the Quote control and what is under its centre", JSON.stringify(await quoteProbe()));
		await replaceComposer("NLINES12: d5 the quoted follow-up, composer cleared");
		await enter();
		await idle();
		await wait(400);
		await scrollTop0();
		await wait(200);
		const t2b = await awaitAnswer();
		note("staged (B: cleared composer) turn2 geometry", JSON.stringify({ staged: stagedB, ...brief(t2b, "NLINES12: d5 the quoted follow-up, composer cleared") }));
		await take("staged-b-cleared-composer");

		// (A) THE APPEND ORDER: stage, then type the question without clearing.
		await replaceComposer("");
		const stagedA = await r3StageQuote(cdp, D5Q.SHORT1);
		note("staged (A) the Quote control and what is under its centre", JSON.stringify(await quoteProbe()));
		await clickAt(cdp, D5Q.FIELD);
		await cdp.send("Input.insertText", { text: "NLINES12: d5 the quoted follow-up, appended" });
		await wait(250);
		await enter();
		await idle();
		await wait(400);
		await scrollTop0();
		await wait(200);
		const t3 = await awaitAnswer();
		note("staged (A: appended) turn3 geometry", JSON.stringify({ staged: stagedA, ...brief(t3, "NLINES12: d5 the quoted follow-up, appended") }));
		await take("staged-a-appended");
		r2check(
			"staged: the cap's Q term is the newest question's own measured box, for a quote staged against an OPEN panel",
			t3 && t3.questionBoxH !== null && impliedQ(t3) !== null && Math.abs(impliedQ(t3) - t3.questionBoxH) <= 0.6,
			JSON.stringify({ capPx: t3?.capPx, questionBoxH: t3?.questionBoxH, impliedQ: impliedQ(t3), questionQuoteBlocks: t3?.questionQuoteBlocks }),
		);
		r2check(
			"staged: the edge is 10.0 line boxes below the answer's top and no row is cut for a quoted follow-up asked on an open panel",
			t3 && t3.rowsToEdge !== null && Math.abs(t3.rowsToEdge - 10) <= 0.05 && t3.rowCrossingClipCount === 0,
			JSON.stringify({ rowsToEdge: t3?.rowsToEdge, answerTop: t3?.answerTopInRegion, clientHeight: t3?.clientHeight, rowCrossingClipCount: t3?.rowCrossingClipCount, cut: t3?.crossing, lastWholeRow: t3?.lastWholeRow }),
		);
		await closePanel();
	}

	note("d5 cap table", JSON.stringify(table));
	r2FramesCheck(frames);
	return { tree: "d5", frames };
}
