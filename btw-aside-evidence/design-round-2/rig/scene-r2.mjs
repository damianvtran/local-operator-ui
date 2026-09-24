/**
 * design-482-r2 ONLY (never committed): the shipped `btw-aside` scene, then the
 * surfaces that changed after design round 1 and that it does not reach:
 *   r2-01/02  a long answer against the derived exchange ceiling (top + scrolled)
 *   r2-03     the adopted exchange repainted in the transcript
 *   r2-04     a refused ask on the COMPOSER door after the panel was closed (error line)
 *   r2-05     a refused ask on the `/btw <q>` door after the panel was closed (F9 note)
 */
async function sceneBtwAsideR2(cdp) {
	await sceneBtwAside(cdp);
	const FIELD = 'textarea[aria-label="Message"]';
	const PANEL = "[data-lo-aside-panel]";
	const TAG = RUN_LABEL ? `r2-${RUN_LABEL}` : "r2";
	const shot = async (label) => {
		const frame = await captureSettled(cdp, `${TAG}-${label}`);
		note("frame", JSON.stringify({ label: frame.label, stable: frame.stable, ...frame.pixels }));
		return frame;
	};
	const raw = async (label) => {
		const frame = await capture(cdp, `${TAG}-${label}`);
		note("frame", JSON.stringify({ label: frame.label, mode: "raw", ...frame.pixels }));
		return frame;
	};
	const esc = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const clearBox = async () => {
		await clickAt(cdp, FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
	};
	/** Geometry of the panel, its capped exchange, and where the cap edge falls in the answer's line boxes. */
	const geo = () =>
		cdp.evaluate(`(() => {
			const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
			const panel = document.querySelector(${JSON.stringify(PANEL)});
			const field = document.querySelector(${JSON.stringify(FIELD)});
			const region = panel ? Array.from(panel.querySelectorAll("div")).find((d) => d.style.maxHeight) : null;
			const out = { panel: r(panel), viewport: { w: innerWidth, h: innerHeight }, field: r(field), fieldValue: field ? field.value : null, activeIsField: document.activeElement === field };
			out.panelText = panel ? panel.textContent.replace(/\\s+/g, " ").trim() : null;
			out.theme = document.documentElement.getAttribute("data-theme") || document.documentElement.className;
			if (region) {
				const cs = getComputedStyle(region);
				const rb = region.getBoundingClientRect();
				out.region = { ...r(region), styleMaxHeight: region.style.maxHeight, computedMaxHeight: cs.maxHeight, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight, scrollTop: region.scrollTop };
				const kids = Array.from(region.children);
				out.regionChildren = kids.map((k) => ({ tag: k.tagName.toLowerCase(), cls: String(k.className).slice(0, 60), ...r(k) }));
				// Line boxes of every text node in the region, deduplicated by top.
				const lines = [];
				const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
				for (let n = walker.nextNode(); n; n = walker.nextNode()) {
					if (!n.textContent.trim()) continue;
					const range = document.createRange(); range.selectNodeContents(n);
					const el = n.parentElement; const ecs = getComputedStyle(el);
					if (el.closest(".sr-only")) continue;
					for (const b of range.getClientRects()) {
						if (b.width < 1) continue;
						const key = Math.round(b.top);
						if (!lines.some((l) => Math.abs(l.top - b.top) < 2)) lines.push({ top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), fontSize: ecs.fontSize, lineHeight: ecs.lineHeight, tag: el.tagName.toLowerCase() });
					}
				}
				lines.sort((a, b) => a.top - b.top);
				const edge = rb.bottom;
				out.lineCount = lines.length;
				out.firstLines = lines.slice(0, 3);
				out.cutLines = lines.filter((l) => l.top < edge - 0.5 && l.bottom > edge + 0.5).map((l) => ({ ...l, visiblePx: +(edge - l.top).toFixed(1), ofPx: +(l.bottom - l.top).toFixed(1) }));
				out.lastFullyVisible = lines.filter((l) => l.bottom <= edge + 0.5).at(-1) ?? null;
				out.regionBottom = +edge.toFixed(1);
				const ps = Array.from(region.querySelectorAll("p, li, ul, ol"));
				out.blockMargins = ps.slice(0, 6).map((p) => { const c = getComputedStyle(p); return { tag: p.tagName.toLowerCase(), mt: c.marginTop, mb: c.marginBottom, fs: c.fontSize, lh: c.lineHeight }; });
			}
			const alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((a) => ({ text: a.textContent.replace(/\\s+/g, " ").trim(), inPanel: panel ? panel.contains(a) : false, ...r(a), color: getComputedStyle(a).color }));
			out.alerts = alerts;
			const content = document.querySelector("[data-lo-transcript-content]");
			out.transcriptText = content ? content.textContent.replace(/\\s+/g, " ").trim().slice(-900) : null;
			return out;
		})()`);

	const waitFor = async (pred, tries = 200, gap = 100) => {
		let g = await geo();
		for (let i = 0; i < tries && !pred(g); i++) { await wait(gap); g = await geo(); }
		return g;
	};

	// The shipped scene leaves the refused panel attached; close it and start clean.
	await esc();
	await waitFor((g) => g.panel === null, 40);
	await clearBox();

	// ---- r2-01/02: a long answer against the derived ceiling -----------------
	const LONGQ = "LONGANSWER: how does the retry budget work, in full?";
	await cdp.send("Input.insertText", { text: `/btw ${LONGQ}` });
	await wait(150);
	await enter();
	const longDone = await waitFor((g) => (g.panelText ?? "").includes("old one's debt") && !(g.panelText ?? "").includes("still settling"), 300);
	note("r2 long answer, settled, scrolled to top", JSON.stringify(longDone));
	check("r2: the long answer overflows the exchange region", longDone.region && longDone.region.scrollHeight > longDone.region.clientHeight, JSON.stringify(longDone.region));
	check("r2: the exchange's cap edge lands between two line boxes at rest", (longDone.cutLines ?? [1]).length === 0, JSON.stringify(longDone.cutLines));
	await shot("01-long-answer-at-rest");
	await cdp.evaluate(`(() => { const p = document.querySelector(${JSON.stringify(PANEL)}); const d = Array.from(p.querySelectorAll("div")).find((x) => x.style.maxHeight); d.scrollTop = d.scrollHeight; return d.scrollTop; })()`);
	await wait(200);
	const longBottom = await geo();
	note("r2 long answer, scrolled to the end", JSON.stringify({ region: longBottom.region, cutLines: longBottom.cutLines }));
	await shot("02-long-answer-scrolled-end");

	// ---- r2-02b/c: a follow-up asked while the first answer overflows -------
	await cdp.evaluate(`(() => { const p = document.querySelector(${JSON.stringify(PANEL)}); const d = Array.from(p.querySelectorAll("div")).find((x) => x.style.maxHeight); d.scrollTop = 0; return 0; })()`);
	await clickAt(cdp, FIELD);
	const FOLLOW = "and does a 429 spend it?";
	await cdp.send("Input.insertText", { text: FOLLOW });
	await wait(150);
	await enter();
	await wait(700);
	const fAsked = await geo();
	const fVis = await cdp.evaluate(`(() => { const p = document.querySelector(${JSON.stringify(PANEL)}); const d = Array.from(p.querySelectorAll("div")).find((x) => x.style.maxHeight); const q = Array.from(d.querySelectorAll("p")).find((x) => x.textContent.includes(${JSON.stringify(FOLLOW)})); const t = Array.from(d.querySelectorAll("p")).find((x) => x.textContent === "thinking…"); const rb = d.getBoundingClientRect(); const vis = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1), regionTop: +rb.top.toFixed(1), regionBottom: +rb.bottom.toFixed(1), visible: b.bottom > rb.top && b.top < rb.bottom }; }; return { question: vis(q), thinking: vis(t), scrollTop: d.scrollTop, scrollHeight: d.scrollHeight, clientHeight: d.clientHeight }; })()`);
	note("r2 follow-up asked while the region overflows (+700ms)", JSON.stringify({ fVis, blocked: (fAsked.panelText ?? "").slice(-90) }));
	check("r2: the follow-up question is visible in the capped region when asked", fVis.question && fVis.question.visible === true, JSON.stringify(fVis));
	await raw("02b-followup-asked-while-overflowing");
	const fDone = await waitFor((g) => (g.panelText ?? "").includes("wrong, not the provider") && !(g.panelText ?? "").includes("still settling"), 200);
	const fVis2 = await cdp.evaluate(`(() => { const p = document.querySelector(${JSON.stringify(PANEL)}); const d = Array.from(p.querySelectorAll("div")).find((x) => x.style.maxHeight); const q = Array.from(d.querySelectorAll("p")).find((x) => x.textContent.includes(${JSON.stringify(FOLLOW)})); const b = q.getBoundingClientRect(); const rb = d.getBoundingClientRect(); return { qTop: b.top, regionBottom: rb.bottom, visible: b.bottom > rb.top && b.top < rb.bottom, scrollTop: d.scrollTop, scrollHeight: d.scrollHeight }; })()`);
	note("r2 follow-up settled", JSON.stringify({ fVis2, cutLines: fDone.cutLines }));
	await shot("02c-followup-settled");

	// ---- r2-03: adopt, and the transcript repaint (timeline) ----------------
	await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(PANEL)} + " button")).find((x) => x.textContent.trim().startsWith("Add to conversation")); if (!b) return null; b.setAttribute("data-r2-adopt", "1"); return { disabled: b.disabled }; })()`);
	const probe = `(() => { const c = document.querySelector("[data-lo-transcript-content]"); const t = c ? c.textContent : ""; return { panel: !!document.querySelector(${JSON.stringify(PANEL)}), hasQ: t.includes(${JSON.stringify(FOLLOW)}), hasA: t.includes("wrong, not the provider"), hero: document.body.textContent.includes("What can I help you with today?"), rows: c ? c.children.length : -1 }; })()`;
	const t0 = Date.now();
	await clickAt(cdp, "[data-r2-adopt]");
	const timeline = [];
	let rawTaken = false;
	for (let i = 0; i < 120; i++) {
		const s = await cdp.evaluate(probe);
		const last = timeline.at(-1);
		if (!last || JSON.stringify({ ...last, ms: 0 }) !== JSON.stringify({ ...s, ms: 0 })) timeline.push({ ms: Date.now() - t0, ...s });
		if (!rawTaken && !s.panel) { await raw("03a-adopt-first-frame-without-panel"); rawTaken = true; }
		if (s.hasQ && s.hasA) break;
		await wait(50);
	}
	note("r2 adopt timeline (state changes only)", JSON.stringify(timeline));
	const fin = timeline.at(-1);
	check("r2: the adopted exchange repaints in the transcript without a reload", fin && fin.hasQ && fin.hasA && !fin.panel, JSON.stringify(fin));
	await wait(600);
	await shot("03-adopted-in-transcript");

	// ---- r2-04: composer door, panel closed before a refusal ------------------
	await clearBox();
	await cdp.send("Input.insertText", { text: "/btw" });
	await wait(150);
	await enter();
	await waitFor((g) => g.panel !== null, 60);
	await cdp.send("Input.insertText", { text: "SLOW TOOLCALL2 asked from the composer" });
	await wait(150);
	await enter();
	const asked = await waitFor((g) => (g.panelText ?? "").includes("asked from the composer"), 60);
	note("r2 composer-door ask on the panel", JSON.stringify({ panelText: asked.panelText, field: asked.fieldValue }));
	await esc();
	const closedAt = Date.now();
	const composerErr = await waitFor((g) => g.alerts.some((a) => !a.inPanel), 300);
	note("r2 composer-door refusal after close", JSON.stringify({ ms: Date.now() - closedAt, alerts: composerErr.alerts, field: composerErr.fieldValue, activeIsField: composerErr.activeIsField, panel: composerErr.panel }));
	check("r2: the composer states a refusal the closed panel cannot", composerErr.alerts.some((a) => !a.inPanel), JSON.stringify(composerErr.alerts));
	await shot("04-composer-error-line");
	const errGeo = await cdp.evaluate(`(() => { const f = document.querySelector(${JSON.stringify(FIELD)}); const a = Array.from(document.querySelectorAll('[role="alert"]')).find((x) => !x.closest("[data-lo-aside-panel]")); const box = f ? f.closest('[class*="@min-[750px]/chatcol:max-w-[900px]"]') : null; const R = (e) => { const b = e.getBoundingClientRect(); return { x: b.x, y: b.y, right: b.right, bottom: b.bottom, h: b.height }; }; const t = a ? a.querySelector("p, span, div") : null; return { alert: a ? R(a) : null, alertText: a ? a.textContent.trim() : null, alertChild: t ? { ...R(t), fs: getComputedStyle(t).fontSize, color: getComputedStyle(a).color } : null, composerBox: box ? R(box) : null, buttons: a ? Array.from(a.querySelectorAll("button")).map((b) => b.textContent.trim()) : [] }; })()`);
	note("r2 composer error line geometry", JSON.stringify(errGeo));

	// ---- r2-05: `/btw <q>` door, panel closed before a refusal (F9) ----------
	await clearBox();
	await wait(300);
	await cdp.send("Input.insertText", { text: "/btw SLOW TOOLCALL2 asked from the command" });
	await wait(150);
	await enter();
	const asked2 = await waitFor((g) => (g.panelText ?? "").includes("asked from the command"), 60);
	note("r2 command-door ask on the panel", JSON.stringify({ panelText: asked2.panelText }));
	await raw("05a-command-door-asked-before-escape");
	await esc();
	const closed2 = Date.now();
	const noted = await waitFor((g) => (g.transcriptText ?? "").includes("tool call") || (g.transcriptText ?? "").toLowerCase().includes("aside"), 300);
	await wait(800);
	const noted2 = await geo();
	note("r2 command-door refusal after close", JSON.stringify({ ms: Date.now() - closed2, transcriptTail: noted2.transcriptText, alerts: noted2.alerts, field: noted2.fieldValue }));
	await shot("05-command-door-transcript-note");
	const noteGeo = await cdp.evaluate(`(() => { const c = document.querySelector("[data-lo-transcript-content]"); if (!c) return null; const all = Array.from(c.querySelectorAll("*")).filter((e) => e.children.length === 0 && /answer|aside|tool/i.test(e.textContent)); return all.slice(-4).map((e) => { const b = e.getBoundingClientRect(); const cs = getComputedStyle(e); return { tag: e.tagName.toLowerCase(), cls: String(e.className).slice(0, 80), text: e.textContent.trim().slice(0, 200), x: b.x, y: b.y, w: b.width, h: b.height, fs: cs.fontSize, color: cs.color, role: e.getAttribute("role") || (e.parentElement && e.parentElement.getAttribute("role")) }; }); })()`);
	note("r2 transcript note geometry", JSON.stringify(noteGeo));

	// ---- does the composer's refusal line outlive a keystroke / a thread send?
	await clickAt(cdp, FIELD);
	await cdp.send("Input.insertText", { text: "x" });
	await wait(400);
	const afterKey = await geo();
	note("r2 alerts after one keystroke in the composer", JSON.stringify(afterKey.alerts.map((a) => ({ text: a.text.slice(0, 40), inPanel: a.inPanel }))));
}
