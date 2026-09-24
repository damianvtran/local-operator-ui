
/* ===================================================================== *
 *   DESIGN ROUND 4 (design-482-r4) — scratch copy, never committed.
 *
 *   Appended after rounds 1-5's helper layer and scenes, to a COPY of
 *   scripts/renderer-driver.mjs (rig/patch-driver-d4.sh). The app's source is
 *   unmodified. One scene:
 *
 *     btw-d4   the ceiling at this head, measured on the rendered surface:
 *              (A) D12's paragraph break, 0 quotes, k = 1..9
 *              (B) R6-4: 1 and 2 staged quotes, k = 1..9  (the 10.0 claim)
 *              (C) Q46: a WRAPPING quote and a WRAPPING question, k = 1..9
 *              (D) lists, headings, fenced code and a blockquote at the edge
 *              (E) D11: a follow-up's answer staying in view, sampled per 80 ms
 *              (F) the per-quote height jump: panel and region geometry sampled
 *                  across the moment a quoted turn arrives, with frames either side
 * ===================================================================== */

const D4Q = {
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

const d4posts = (needle) => (r4stats().asidePosts ?? []).filter((p) => (p.text ?? "").includes(needle));

/**
 * The panel, its exchange region, and the newest answer's ROWS against the clip.
 *
 * The row rects are text Ranges, so their height is the glyph box the browser
 * actually paints (round 3 read 16.5px inside a 22.4px row) rather than the line
 * box: "how much of a row is visible" is a glyph measurement, and the cap's
 * arithmetic is a line-box measurement, so both are reported side by side.
 */
function d4Geo(cdp) {
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
		// --- every glyph row of the newest answer, merged per visual row --------
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
		const blocks = Array.from(md ? md.querySelectorAll("p, li, h1, h2, h3, h4, h5, h6, pre, blockquote, td, th") : []);
		const blockType = (el) => (el ? el.tagName.toLowerCase() + (el.tagName === "PRE" ? ":pre" : "") : null);
		const crossing = rows
			.filter((r) => r.top < clip - 0.5 && r.bottom > clip + 0.5)
			.map((r) => ({
				tag: blockType(r.block),
				text: (r.texts[0] ?? "").slice(0, 44),
				rowH: rd(r.h),
				visiblePx: rd(clip - r.top),
				hiddenPx: rd(r.bottom - clip),
				visibleFraction: rd((clip - r.top) / r.h),
				topInRegion: rd(r.top - rr.top),
				blockTopInRegion: r.block ? rd(r.block.getBoundingClientRect().top - rr.top) : null,
				blockBottomInRegion: r.block ? rd(r.block.getBoundingClientRect().bottom - rr.top) : null,
				blockBoxH: r.block ? rd(r.block.getBoundingClientRect().height) : null,
			}));
		const neighbour = rows.length
			? rows
					.filter((r) => r.bottom <= clip + 0.5)
					.slice(-1)
					.map((r) => ({ tag: blockType(r.block), text: (r.texts[0] ?? "").slice(0, 44), bottomVsClip: rd(r.bottom - clip) }))[0] ?? null
			: null;
		const style = getComputedStyle(region);
		const band = document.querySelector("[data-lo-composer-band]");
		const content = document.querySelector("[data-lo-transcript-content]");
		return {
			panel: { top: rd(pr.top), height: rd(pr.height), bottom: rd(pr.bottom), width: rd(pr.width) },
			cap: style.maxHeight,
			capPx: rd(parseFloat(style.maxHeight)),
			transition: style.transitionProperty + " / " + style.transitionDuration,
			clientHeight: region.clientHeight,
			scrollHeight: region.scrollHeight,
			maxScroll: rd(region.scrollHeight - region.clientHeight),
			scrollTop: rd(region.scrollTop),
			regionTop: rd(rr.top),
			turns: turns.length,
			questionQuoteBlocks: quotes.length,
			quoteHeights: quotes.map((s) => rd(s.getBoundingClientRect().height)),
			quoteLines: quotes.map(lineRows),
			questionLines: q ? lineRows(q) - quotes.reduce((m, s) => m + lineRows(s), 0) : null,
			questionTopInRegion: qr ? rd(qr.top - rr.top) : null,
			questionHeightIfRegion: qr ? rd(qr.height) : null,
			lastTurnTopInRegion: last ? rd(last.getBoundingClientRect().top - rr.top) : null,
			answerFontSize: cs ? cs.fontSize : null,
			answerLineHeight: lh,
			answerTopInRegion: mr ? rd(mr.top - rr.top) : null,
			rowPitch: rows.length > 1 ? rd((rows[1].top - rows[0].top)) : null,
			rowsToEdge: mr && lh ? rd((clip - mr.top) / lh) : null,
			rows: rows.length,
			fullyVisibleRows: rows.filter((r) => r.top >= rr.top - 0.5 && r.bottom <= clip + 0.5).length,
			rowCrossingClipCount: rows.filter((r) => r.top < clip - 0.5 && r.bottom > clip + 0.5).length,
			crossing,
			lastWholeRow: neighbour,
			blockCounts: blocks.reduce((m, el) => ((m[blockType(el)] = (m[blockType(el)] ?? 0) + 1), m), {}),
			paragraphGap: (() => { const ps = md ? Array.from(md.querySelectorAll("p")) : []; return ps.length > 1 ? rd(parseFloat(getComputedStyle(ps[1]).marginTop)) : null; })(),
			mdClass: md ? md.className : null,
			transcriptTop: content ? rd(content.getBoundingClientRect().top) : null,
			bandTop: band ? rd(band.getBoundingClientRect().top) : null,
		};
	})()`);
}

/** The ceiling, sampled across the arrival of a quoted turn. */
function d4JumpSample(cdp) {
	return cdp.evaluate(`(() => {
		const rd = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		const content = document.querySelector("[data-lo-transcript-content]");
		const band = document.querySelector("[data-lo-composer-band]");
		const pr = panel ? panel.getBoundingClientRect() : null;
		const rr = region ? region.getBoundingClientRect() : null;
		return {
			panelTop: rd(pr && pr.top), panelH: rd(pr && pr.height), panelBottom: rd(pr && pr.bottom),
			capPx: region ? rd(parseFloat(getComputedStyle(region).maxHeight)) : null,
			regionH: region ? region.clientHeight : null,
			scrollTop: region ? rd(region.scrollTop) : null,
			scrollHeight: region ? region.scrollHeight : null,
			turns: region ? region.children.length : null,
			transcriptTop: content ? rd(content.getBoundingClientRect().top) : null,
			bandTop: band ? rd(band.getBoundingClientRect().top) : null,
			panelText: panel ? panel.textContent.replace(/\\s+/g, " ").trim().slice(0, 90) : null,
		};
	})()`);
}

async function sceneBtwD4(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("d4 session", sessionId);
	const frames = [];
	const PREFIX = RUN_LABEL ? `d4-${RUN_LABEL}` : "d4";
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
		await clickAt(cdp, D4Q.FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
		if (text) await cdp.send("Input.insertText", { text });
		await wait(200);
	};
	const band = () => readQaBand(cdp);
	const awaitBand = (want, n = 80) => qaAwaitPanel(cdp, want, n);
	const idle = () => awaitBand((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	const ask = async (text) => {
		await clickAt(cdp, D4Q.FIELD);
		await type(text);
		await enter();
		for (let i = 0; i < 400; i++) {
			const post = d4posts(text)[0];
			const b = await band();
			if (post && post.status !== null && b.panelAnnounce !== "Asking the aside") return { post, band: b };
			await wait(100);
		}
		return { post: d4posts(text)[0] ?? null, band: await band() };
	};
	const closePanel = async () => { await clickAt(cdp, D4Q.FIELD); await escape(); await awaitBand((b) => b.panel === null, 60); };
	/**
	 * Attach an aside and leave the panel up. The round's first attempt at the
	 * follow-up and jump subjects forgot this and sent plain thread messages, so
	 * every reading came back null: an ask is only an aside once `/btw` has
	 * attached one.
	 */
	const openPanel = async () => {
		await replaceComposer("/btw");
		await enter();
		return awaitBand((b) => b.panel !== null, 60);
	};

	// ---- S0: one long transcript answer, which is what the quotes are staged from
	await clickAt(cdp, D4Q.FIELD);
	await type("LONGANSWER seed for the design round-4 quotes");
	await enter();
	await awaitBand((b) => (b.transcriptText ?? "").includes(D4Q.TAIL), 400);
	await idle();

	const KS = [1, 3, 5, 7, 9];
	const CASES = (process.env.D4_CASES ?? "para,quotes,wrap,blocks,followup,jump").split(",");
	// `qaOpenSession` sets the dark theme; a light pass asks for it explicitly so
	// the same scene can be driven twice without a second scene.
	if (process.env.D4_THEME) await verb(cdp, "setTheme", process.env.D4_THEME);
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
		const g = await d4Geo(cdp);
		const post = d4posts(text)[0] ?? null;
		const row = {
			case: id,
			k,
			stagedQuotes: staged,
			wireQuotes: ((post?.text ?? "").match(/<reply-to>/g) ?? []).length,
			quoteBlocks: g?.questionQuoteBlocks ?? null,
			quoteLines: g?.quoteLines ?? null,
			questionLines: g?.questionLines ?? null,
			capPx: g?.capPx ?? null,
			clientHeight: g?.clientHeight ?? null,
			answerTop: g?.answerTopInRegion ?? null,
			lineHeight: g?.answerLineHeight ?? null,
			rowsToEdge: g?.rowsToEdge ?? null,
			cut: (g?.crossing ?? []).map((c) => ({ tag: c.tag, hiddenPx: c.hiddenPx, visiblePx: c.visiblePx, text: c.text })),
			lastWholeRow: g?.lastWholeRow ?? null,
			paragraphGap: g?.paragraphGap ?? null,
			scrollTop: g?.scrollTop ?? null,
			maxScroll: g?.maxScroll ?? null,
		};
		table.push(row);
		note(`d4 cap ${id} k${k}`, JSON.stringify(row));
		return { g, row };
	};

	if (CASES.includes("para")) {
		// (A) D12's subject: an answer with paragraph breaks, no quote.
		for (const k of KS) {
			const { g, row } = await capCase("para", k);
			if (k === 5) await take(`a-paragraph-break-k${k}`);
			if (k === 5) note("A-paragraph-break-k5 geometry", JSON.stringify(g));
			await closePanel();
			void row;
		}
	}

	if (CASES.includes("quotes")) {
		// (B) R6-4: 1 and 2 single-line quotes. The edge is claimed to stay 10.0.
		for (const [id, quotes] of [["one", [D4Q.SHORT1]], ["two", [D4Q.SHORT1, D4Q.SHORT2]]]) {
			for (const k of [1, 5, 9]) {
				const { g } = await capCase(id, k, { quotes });
				if (k === 5) await take(`b-${id}-quote-k${k}`);
				if (k === 5) note(`B-${id}-quote-k5 geometry`, JSON.stringify(g));
				await closePanel();
			}
		}
	}

	if (CASES.includes("wrap")) {
		// (C) Q46: a quote long enough to WRAP, and a question long enough to wrap.
		for (const k of [1, 5, 9]) {
			const { g } = await capCase("wrapquote", k, { quotes: [D4Q.WRAP] });
			if (k === 1) await take(`c-wrapquote-k${k}`);
			if (k === 1) note(`C-wrapquote-k1 geometry`, JSON.stringify(g));
			await closePanel();
		}
		for (const k of [1, 5, 9]) {
			const { g } = await capCase("wrapq", k, { question: D4Q.LONGQ });
			if (k === 1) await take(`c-wrapq-k${k}`);
			if (k === 1) note(`C-wrapq-k1 geometry`, JSON.stringify(g));
			await closePanel();
		}
	}

	if (CASES.includes("blocks")) {
		// (D) lists, headings, fenced code and a blockquote against the edge.
		// The default set is one offset per block type; `D4_BLOCK_MARKERS` sweeps
		// offsets, because whether the edge lands INSIDE a row depends on where the
		// block's own (off-grid) margins put it.
		const BLOCK_CASES = (
			process.env.D4_BLOCK_MARKERS ??
			"LISTEDGE4:list,HEADEDGE3:heading,CODEEDGE3:code,QUOTEEDGE3:blockquote"
		)
			.split(",")
			.map((entry) => {
				const [marker, id] = entry.split(":");
				return [id, marker, Number(marker.match(/\\d+$/)?.[0] ?? 0)];
			});
		for (const [id, marker, n] of BLOCK_CASES) {
			// The panel has to be up first: an aside ask is only an aside once `/btw`
			// has attached one, otherwise this is an ordinary thread turn.
			await replaceComposer("");
			await replaceComposer("/btw");
			await enter();
			await awaitBand((b) => b.panel !== null, 60);
			const text = `${marker}: d4 ${id} at the edge`;
			await ask(text);
			await wait(400);
			const g = await d4Geo(cdp);
			note(`d4 block ${id}`, JSON.stringify(g));
			const row = {
				case: id, k: n, capPx: g?.capPx ?? null, clientHeight: g?.clientHeight ?? null,
				answerTop: g?.answerTopInRegion ?? null, rowsToEdge: g?.rowsToEdge ?? null,
				blockCounts: g?.blockCounts ?? null, cut: (g?.crossing ?? []).map((c) => ({ tag: c.tag, hiddenPx: c.hiddenPx, visiblePx: c.visiblePx, text: c.text, blockTopInRegion: c.blockTopInRegion, blockBottomInRegion: c.blockBottomInRegion, blockBoxH: c.blockBoxH })),
				lastWholeRow: g?.lastWholeRow ?? null, scrollTop: g?.scrollTop ?? null, maxScroll: g?.maxScroll ?? null,
			};
			table.push(row);
			await take(`d-edge-${id}`);
			await closePanel();
		}
	}

	if (CASES.includes("followup")) {
		// (E) D11: a long follow-up's answer, sampled from the press. The FIRST turn
		// has to be a long answer too, so the region is already overflowing when the
		// follow-up arrives - which is the state the finding is about.
		await openPanel();
		await ask("LONGANSWER: d4 the long answer resting first");
		await wait(400);
		await take("e-01-long-answer-at-rest");
		await clickAt(cdp, D4Q.FIELD);
		await type("LONGSLOW: d4 the follow-up whose answer must stay in view");
		const t0 = Date.now();
		await enter();
		const samples = [];
		let landedAt = null;
		for (let i = 0; i < 260; i++) {
			const j = await d4JumpSample(cdp);
			samples.push([Date.now() - t0, j.scrollTop, j.scrollHeight, j.turns, j.capPx]);
			if (samples.length === 3) await take("e-02-followup-just-asked", "raw");
			if (samples.length === 12) await take("e-03-followup-midstream", "raw");
			if (landedAt === null && j.turns >= 3) landedAt = Date.now();
			if (landedAt !== null && Date.now() - landedAt > 1500) break;
			await wait(80);
		}
		const g = await d4Geo(cdp);
		const dedup = samples.filter((s, i) => i === 0 || JSON.stringify(s.slice(1)) !== JSON.stringify(samples[i - 1].slice(1)));
		note("E follow-up samples [ms, scrollTop, scrollHeight, turns, capPx]", JSON.stringify(dedup));
		note("E follow-up geometry", JSON.stringify(g));
		r2check(
			"E D11: the follow-up's question is at the region's top and its first answer row is in view",
			(g?.questionTopInRegion ?? 99) <= 1.5 && (g?.answerTopInRegion ?? 99) < (g?.clientHeight ?? 0),
			JSON.stringify({ questionTopInRegion: g?.questionTopInRegion, answerTopInRegion: g?.answerTopInRegion, clientHeight: g?.clientHeight, scrollTop: g?.scrollTop, maxScroll: g?.maxScroll, turns: g?.turns }),
		);
		await take("e-04-followup-settled");
		await closePanel();
	}

	if (CASES.includes("jump")) {
		// (F) the ceiling's own step: a quoted follow-up arriving on an unquoted panel.
		await openPanel();
		await ask("SENTENCE6: d4 unquoted first turn");
		await wait(600);
		const before = await d4JumpSample(cdp);
		await take("f-01-before-the-quoted-turn");
		// Stage the quote while the panel is up, then ask the quoted follow-up.
		await replaceComposer("");
		const stagedQuote = await r3StageQuote(cdp, D4Q.SHORT1);
		await replaceComposer("SENTENCE4: d4 quoted follow-up");
		const pre = await d4JumpSample(cdp);
		const t0 = Date.now();
		await enter();
		const samples = [];
		for (let i = 0; i < 60; i++) {
			const j = await d4JumpSample(cdp);
			samples.push([Date.now() - t0, j.capPx, j.panelTop, j.panelH, j.regionH, j.scrollTop, j.scrollHeight, j.turns]);
			if (samples.length === 1) await take("f-02-at-the-press", "raw");
			if (j.turns >= 3 && samples.filter((s) => s[7] >= 3).length >= 2) break;
			await wait(40);
		}
		await wait(1200);
		const after = await d4JumpSample(cdp);
		await take("f-03-after-the-quoted-turn");
		const dedup = samples.filter((s, i) => i === 0 || JSON.stringify(s.slice(1)) !== JSON.stringify(samples[i - 1].slice(1)));
		note("F jump staged", JSON.stringify(stagedQuote));
		note("F jump before", JSON.stringify(before));
		note("F jump pre-press", JSON.stringify(pre));
		note("F jump samples [ms, capPx, panelTop, panelH, regionH, scrollTop, scrollHeight, turns]", JSON.stringify(dedup));
		note("F jump after", JSON.stringify(after));
		r2check(
			"F the ceiling steps by the quote block and the panel's top is what moves",
			(after?.capPx ?? 0) - (before?.capPx ?? 0) === 27.5,
			JSON.stringify({ beforeCap: before?.capPx, afterCap: after?.capPx, beforeTop: before?.panelTop, afterTop: after?.panelTop, beforeH: before?.panelH, afterH: after?.panelH, beforeRegion: before?.regionH, afterRegion: after?.regionH }),
		);
		await closePanel();
	}

	note("d4 cap table", JSON.stringify(table));
	r2FramesCheck(frames);
	return { tree: "d4", frames };
}
