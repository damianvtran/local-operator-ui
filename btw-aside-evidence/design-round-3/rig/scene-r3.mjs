
/**
 * design-482-r3 ONLY (never committed to the PR branch): the surfaces the
 * `97ff24e1d..0bc4a97bb` delta changed, driven with real key/mouse input and
 * measured from the app's own DOM.
 *   r3-01  D10/D1: 9-, 10- and 11-line answers against the ceiling (scrollHeight vs clientHeight)
 *   r3-02  D6: a follow-up appended under an overflowing answer; scrollTop sampled per 80 ms
 *   r3-03  U2 gate on the composer + D6 non-pinning under a long streaming follow-up
 *   r3-04  U9 aria-describedby, D9 adopt timeline, U6 focus after adopt/close
 *   r3-05  D8 composer error line, then D7 (a new /btw retires it)
 *   r3-06  D8 transcript note on the /btw <q> door
 *   r3-07  composer state matrix: #479 "Sending your message" x aside cue
 */
async function sceneBtwAsideR3(cdp) {
	const FIELD = 'textarea[aria-label="Message"]';
	const PANEL = "[data-lo-aside-panel]";
	const TAG = RUN_LABEL ? `r3-${RUN_LABEL}` : "r3";
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
	const type = (text) => cdp.send("Input.insertText", { text });
	const clearBox = async () => {
		await clickAt(cdp, FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
	};
	const geo = () =>
		cdp.evaluate(`(() => {
			const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: +b.x.toFixed(1), y: +b.y.toFixed(1), w: +b.width.toFixed(1), h: +b.height.toFixed(1), bottom: +b.bottom.toFixed(1) }; };
			const panel = document.querySelector(${JSON.stringify(PANEL)});
			const field = document.querySelector(${JSON.stringify(FIELD)});
			const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
			const frame = field ? Array.from(document.querySelectorAll('[class*="@min-[750px]/chatcol:max-w-[900px]"]')).find((e) => e.contains(field) && !e.hasAttribute("data-lo-aside-panel")) : null;
			const send = frame ? Array.from(frame.querySelectorAll("button")).find((b) => ["Ask the aside", "Send message"].includes(b.getAttribute("aria-label"))) : null;
			const active = document.activeElement;
			const out = {
				panel: r(panel), field: r(field), fieldValue: field ? field.value : null, placeholder: field ? field.placeholder : null,
				activeIsField: active === field,
				active: active ? active.tagName.toLowerCase() + (active.getAttribute("aria-label") ? "[" + active.getAttribute("aria-label") + "]" : "") : null,
				sendLabel: send ? send.getAttribute("aria-label") : null, sendDisabled: send ? send.disabled : null,
				composerText: frame ? frame.textContent.replace(/\\s+/g, " ").trim().slice(0, 400) : null,
				panelText: panel ? panel.textContent.replace(/\\s+/g, " ").trim() : null,
				liveRegion: panel ? (panel.querySelector("output, [aria-live]") || {}).textContent ?? null : null,
				workingLine: (document.querySelector("[data-lo-working-line]") || {}).textContent ?? null,
				url: location.hash || location.pathname,
			};
			if (region) {
				const rb = region.getBoundingClientRect();
				out.region = { ...r(region), styleMaxHeight: region.style.maxHeight, computedMaxHeight: getComputedStyle(region).maxHeight, clientHeight: region.clientHeight, scrollHeight: region.scrollHeight, scrollTop: region.scrollTop, overflowPx: region.scrollHeight - region.clientHeight, hasScrollbar: region.scrollHeight > region.clientHeight };
				const turns = Array.from(region.children);
				out.turns = turns.map((t) => { const b = t.getBoundingClientRect(); return { top: +(b.top - rb.top).toFixed(1), h: +b.height.toFixed(1), offsetTop: t.offsetTop, text: t.textContent.replace(/\\s+/g, " ").trim().slice(0, 50) }; });
				const lines = [];
				const walker = document.createTreeWalker(region, NodeFilter.SHOW_TEXT);
				for (let n = walker.nextNode(); n; n = walker.nextNode()) {
					if (!n.textContent.trim()) continue;
					if (n.parentElement.closest(".sr-only")) continue;
					const range = document.createRange(); range.selectNodeContents(n);
					for (const b of range.getClientRects()) { if (b.width < 1) continue; if (!lines.some((l) => Math.abs(l.top - b.top) < 2)) lines.push({ top: +b.top.toFixed(1), bottom: +b.bottom.toFixed(1) }); }
				}
				lines.sort((a, b) => a.top - b.top);
				out.lineCount = lines.length;
				out.cutLines = lines.filter((l) => l.top < rb.bottom - 0.5 && l.bottom > rb.bottom + 0.5).map((l) => ({ ...l, visiblePx: +(rb.bottom - l.top).toFixed(1) }));
				out.lastLineBottomVsRegion = lines.length ? +(lines.at(-1).bottom - rb.bottom).toFixed(1) : null;
			}
			if (panel) {
				const adopt = Array.from(panel.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Add to conversation"));
				if (adopt) { const d = adopt.getAttribute("aria-describedby"); const target = d ? document.getElementById(d) : null; out.adopt = { disabled: adopt.disabled, describedby: d, describedText: target ? target.textContent.trim() : null }; }
			}
			out.alerts = Array.from(document.querySelectorAll('[role="alert"]')).map((a) => ({ text: a.textContent.replace(/\\s+/g, " ").trim(), inPanel: panel ? panel.contains(a) : false, ...r(a) }));
			const content = document.querySelector("[data-lo-transcript-content]");
			out.transcriptTail = content ? content.textContent.replace(/\\s+/g, " ").trim().slice(-500) : null;
			return out;
		})()`);
	const waitFor = async (pred, tries = 200, gap = 100) => {
		let g = await geo();
		for (let i = 0; i < tries && !pred(g); i++) { await wait(gap); g = await geo(); }
		return g;
	};
	const closePanel = async () => { await clickAt(cdp, FIELD); await esc(); await waitFor((g) => g.panel === null, 40); await clearBox(); };
	const slim = (g) => ({ placeholder: g.placeholder, fieldValue: g.fieldValue, sendLabel: g.sendLabel, panel: g.panel !== null, alerts: g.alerts.map((a) => `${a.inPanel ? "panel" : "outside"}: ${a.text.slice(0, 160)}`), workingLine: g.workingLine, active: g.active });

	// ---- preconditions (the shipped scene's own preamble, trimmed) -----------
	const facts = await factsOf(cdp);
	check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	await verb(cdp, "navigate", "/chat");
	await verb(cdp, "setTheme", THEME ?? "localOperatorDark");
	const workspace = join(SCRATCH, "btw-workspace");
	mkdirSync(workspace, { recursive: true });
	const created = await createBackendSession(workspace);
	if (!created.id) throw new Error(`no session: ${JSON.stringify(created.body)}`);
	const sessionId = created.id;
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	for (let i = 0; i < 80; i++) { if (await cdp.evaluate(`document.querySelector(${JSON.stringify(FIELD)}) !== null`)) break; await wait(100); }
	await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}/warm`, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}` }, body: "{}" }).catch(() => null);
	for (let i = 0; i < 120; i++) {
		const res = await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}`, { headers: { authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}` } }).catch(() => null);
		const body = res ? await res.json().catch(() => null) : null;
		if (body && JSON.stringify(body).includes('"cold":false')) break;
		await wait(500);
	}
	const rest = await geo();
	note("r3 rest", JSON.stringify(slim(rest)));
	await clearBox();

	// ---- r3-01: D10 / D1 — exact line counts against the ceiling --------------
	for (const n of [9, 10, 11]) {
		await type(`/btw NLINES${n}`);
		await wait(150);
		await enter();
		const g = await waitFor((x) => (x.panelText ?? "").includes(`Line ${n} of ${n}.`) && x.adopt && x.adopt.disabled === false, 200);
		note(`r3 D10 ${n}-line answer`, JSON.stringify({ region: g.region, lineCount: g.lineCount, cutLines: g.cutLines, lastLineBottomVsRegion: g.lastLineBottomVsRegion, turns: g.turns }));
		check(`r3 D10: a ${n}-line answer ${n <= 10 ? "shows no scrollbar" : "overflows with no line cut at rest"}`, n <= 10 ? g.region && g.region.overflowPx <= 0 : g.region && g.region.overflowPx > 0 && (g.cutLines ?? [1]).length === 0, JSON.stringify(g.region));
		if (n !== 10) await shot(`01-${n}-line-answer`);
		await closePanel();
	}

	// ---- r3-02: D6 — follow-up under an overflowing first answer --------------
	await type("/btw LONGANSWER: how does the retry budget work, in full?");
	await wait(150);
	await enter();
	const longDone = await waitFor((g) => (g.panelText ?? "").includes("old one's debt") && g.adopt && g.adopt.disabled === false, 300);
	note("r3 long answer settled", JSON.stringify({ region: longDone.region, turns: longDone.turns, cut: longDone.cutLines }));
	await shot("02a-long-answer-at-rest");
	await clickAt(cdp, FIELD);
	const FOLLOW = "and does a 429 spend it?";
	await type(FOLLOW);
	await wait(150);
	await enter();
	const samples = [];
	const t0 = Date.now();
	let midShot = false;
	for (let i = 0; i < 90; i++) {
		const g = await geo();
		const last = g.turns ? g.turns.at(-1) : null;
		samples.push({ ms: Date.now() - t0, scrollTop: g.region ? g.region.scrollTop : null, scrollHeight: g.region ? g.region.scrollHeight : null, clientHeight: g.region ? g.region.clientHeight : null, newTurnTopInRegion: last ? last.top : null, newTurnH: last ? last.h : null, newTurnOffsetTop: last ? last.offsetTop : null, tail: (g.panelText ?? "").slice(-40) });
		if (i === 2) await raw("02b-followup-just-asked");
		if (!midShot && (g.panelText ?? "").includes("Transport failures") && !(g.panelText ?? "").includes("wrong, not the provider")) { await raw("02c-followup-midstream"); midShot = true; }
		if ((g.panelText ?? "").includes("wrong, not the provider") && g.adopt && g.adopt.disabled === false) break;
		await wait(80);
	}
	note("r3 D6 scroll samples (follow-up 1, short answer)", JSON.stringify(samples));
	const distinct = [...new Set(samples.map((s) => s.scrollTop))];
	note("r3 D6 distinct scrollTop values", JSON.stringify(distinct));
	const fin = await geo();
	const lastTurn = fin.turns.at(-1);
	check("r3 D6: the appended follow-up's question is inside the region's viewport", lastTurn.top >= -0.5 && lastTurn.top < fin.region.clientHeight, JSON.stringify({ lastTurn, region: fin.region }));
	check("r3 D6: the region moved exactly once (one scroll on append, none per chunk)", distinct.filter((v) => v !== samples[0].scrollTop).length <= 1, JSON.stringify(distinct));
	await shot("02d-followup-settled");

	// ---- r3-03c: a LONG follow-up, untouched by the user: how much of it is seen?
	await clickAt(cdp, FIELD);
	await type("LONGSLOW and what about a cancelled turn?");
	await wait(150);
	await enter();
	const samples3 = [];
	const t3 = Date.now();
	let midTaken = false;
	for (let i = 0; i < 160; i++) {
		const g = await geo();
		const last = g.turns ? g.turns.at(-1) : null;
		samples3.push({ ms: Date.now() - t3, scrollTop: g.region.scrollTop, scrollHeight: g.region.scrollHeight, clientHeight: g.region.clientHeight, qTop: last ? last.top : null, turnH: last ? last.h : null, visibleOfTurn: last ? +Math.max(0, Math.min(g.region.clientHeight, last.top + last.h) - Math.max(0, last.top)).toFixed(1) : null });
		if (!midTaken && last && last.h > 150) { await raw("03c-long-followup-midstream-untouched"); midTaken = true; }
		if (g.adopt && g.adopt.disabled === false && i > 5) break;
		await wait(80);
	}
	note("r3 D6 long follow-up, untouched (samples)", JSON.stringify(samples3));
	note("r3 D6 long follow-up distinct scrollTop", JSON.stringify([...new Set(samples3.map((s) => s.scrollTop))]));
	await shot("03d-long-followup-settled-untouched");

	// ---- r3-03: long streaming follow-up — U2 gate + no per-chunk pin --------
	await clickAt(cdp, FIELD);
	const FOLLOW2 = "LONGSLOW and the model switch case?";
	await type(FOLLOW2);
	await wait(150);
	await enter();
	const samples2 = [];
	const t1 = Date.now();
	let gated = null;
	let userScrolled = null;
	for (let i = 0; i < 120; i++) {
		const g = await geo();
		const last = g.turns ? g.turns.at(-1) : null;
		samples2.push({ ms: Date.now() - t1, scrollTop: g.region ? g.region.scrollTop : null, scrollHeight: g.region ? g.region.scrollHeight : null, newTurnTop: last ? last.top : null });
		if (gated === null && (g.panelText ?? "").includes("retry budget is a per-provider")) {
			// U2: a third question pressed while the second is still streaming.
			await clickAt(cdp, FIELD);
			await type("a third question, pressed mid-answer");
			await wait(120);
			await enter();
			await wait(300);
			gated = await geo();
			note("r3 U2 gate while streaming", JSON.stringify(slim(gated)));
			await raw("03a-u2-gate-composer-line");
			// user scrolls the region up mid-answer; a pin would yank it back
			await cdp.evaluate(`(() => { const d = document.querySelector('[aria-label="The aside exchange"]'); d.scrollTop = Math.max(0, d.scrollTop - 60); return d.scrollTop; })()`);
			userScrolled = (await geo()).region.scrollTop;
		}
		if ((g.panelText ?? "").includes("old one's debt") && (g.panelText ?? "").split("old one's debt").length > 2) break;
		if (g.adopt && g.adopt.disabled === false && i > 5) break;
		await wait(80);
	}
	note("r3 D6 scroll samples (follow-up 2, long streaming answer)", JSON.stringify(samples2));
	const after = samples2.filter((s) => s.ms > (samples2.find((x) => x.scrollTop !== samples2[0].scrollTop)?.ms ?? 0));
	note("r3 D6 user-scrolled value and later values", JSON.stringify({ userScrolled, later: [...new Set(samples2.slice(-20).map((s) => s.scrollTop))] }));
	const g3 = await waitFor((g) => g.adopt && g.adopt.disabled === false, 200);
	note("r3 after long follow-up settled", JSON.stringify({ region: g3.region, turns: g3.turns, alerts: g3.alerts, fieldValue: g3.fieldValue }));
	await shot("03b-long-followup-settled");

	// ---- r3-04: U9 describedby while streaming, D9 adopt timeline, U6 focus --
	await clearBox();
	await closePanel();
	await type("/btw what does the retry budget actually cap?");
	await wait(150);
	await enter();
	await wait(400);
	const thinking = await geo();
	note("r3 U9 while thinking", JSON.stringify({ adopt: thinking.adopt, live: thinking.liveRegion, placeholder: thinking.placeholder, sendLabel: thinking.sendLabel }));
	check("r3 U9: the disabled adopt names its reason via aria-describedby", thinking.adopt && thinking.adopt.disabled && thinking.adopt.describedText && thinking.adopt.describedText.length > 0, JSON.stringify(thinking.adopt));
	await raw("04a-thinking-u9");
	const settled = await waitFor((g) => g.adopt && g.adopt.disabled === false, 200);
	note("r3 U9 when live", JSON.stringify({ adopt: settled.adopt, live: settled.liveRegion }));
	await cdp.evaluate(`(() => { const b = Array.from(document.querySelectorAll(${JSON.stringify(PANEL)} + " button")).find((x) => x.textContent.trim().startsWith("Add to conversation")); b.setAttribute("data-r3-adopt", "1"); return true; })()`);
	const probe = `(() => { const c = document.querySelector("[data-lo-transcript-content]"); const t = c ? c.textContent : ""; const f = document.querySelector(${JSON.stringify(FIELD)}); return { panel: !!document.querySelector(${JSON.stringify(PANEL)}), hasQ: t.includes("actually cap?"), hasA: t.includes("wrong, not the provider"), hero: document.body.textContent.includes("What can I help you with today?"), activeIsField: document.activeElement === f, active: document.activeElement ? document.activeElement.tagName.toLowerCase() : null }; })()`;
	const ta = Date.now();
	await clickAt(cdp, "[data-r3-adopt]");
	const timeline = [];
	let rawTaken = false;
	for (let i = 0; i < 120; i++) {
		const s = await cdp.evaluate(probe);
		const last = timeline.at(-1);
		if (!last || JSON.stringify({ ...last, ms: 0 }) !== JSON.stringify({ ...s, ms: 0 })) timeline.push({ ms: Date.now() - ta, ...s });
		if (!rawTaken && !s.panel) { await raw("04b-adopt-first-frame-without-panel"); rawTaken = true; }
		if (s.hasQ && s.hasA && i > 10) break;
		await wait(50);
	}
	note("r3 adopt timeline (D9, U6)", JSON.stringify(timeline));
	check("r3 U6: focus is back in the composer after the adopt click", timeline.at(-1).activeIsField === true, JSON.stringify(timeline.at(-1)));
	await wait(500);
	await shot("04c-adopted");
	// U6 close control
	await clearBox();
	await type("/btw");
	await wait(150);
	await enter();
	await waitFor((g) => g.panel !== null, 40);
	await clickAt(cdp, '[aria-label="Close the aside"]');
	await wait(300);
	const afterClose = await geo();
	note("r3 U6 after the close control", JSON.stringify(slim(afterClose)));
	check("r3 U6: focus is back in the composer after the close control", afterClose.activeIsField === true, afterClose.active);

	// ---- r3-05: composer door refused after close (D8 copy) then D7 ----------
	await clearBox();
	await type("/btw");
	await wait(150);
	await enter();
	await waitFor((g) => g.panel !== null, 60);
	await type("SLOW TOOLCALL2 asked from the composer about the budget window");
	await wait(150);
	await enter();
	await waitFor((g) => (g.panelText ?? "").includes("asked from the composer"), 60);
	await esc();
	const ce = await waitFor((g) => g.alerts.some((a) => !a.inPanel), 300);
	note("r3 D8 composer line", JSON.stringify(slim(ce)));
	await shot("05a-composer-error-line-d8");
	// D7: a new aside from the slash door (typed into the same box)
	await clearBox();
	await wait(200);
	const beforeNew = await geo();
	note("r3 D7 alerts after clearing the box (before the new ask)", JSON.stringify(slim(beforeNew)));
	await type("/btw NLINES3 a fresh question");
	await wait(150);
	await enter();
	await wait(250);
	const d7 = await geo();
	note("r3 D7 right after a new /btw <q>", JSON.stringify(slim(d7)));
	check("r3 D7: the composer's aside refusal is gone once a new aside is asked", !d7.alerts.some((a) => !a.inPanel && a.text.includes("got no answer")), JSON.stringify(d7.alerts));
	await raw("05b-d7-new-aside-retires-line");
	await waitFor((g) => (g.panelText ?? "").includes("Line 3 of 3."), 100);
	await closePanel();

	// ---- r3-06: /btw <q> door refused after close (D8 transcript note) -------
	await type("/btw SLOW TOOLCALL2 asked from the command about the budget window");
	await wait(150);
	await enter();
	await waitFor((g) => (g.panelText ?? "").includes("asked from the command"), 60);
	await esc();
	const tn = await waitFor((g) => (g.transcriptTail ?? "").includes("got no answer"), 300);
	await wait(600);
	note("r3 D8 transcript note", JSON.stringify({ tail: tn.transcriptTail, ...slim(tn) }));
	await shot("06-transcript-note-d8");
	// D7 on the command door: attach a bare aside, does anything stale remain?
	await clearBox();

	// ---- r3-07: composer state matrix ----------------------------------------
	const matrix = [];
	const row = async (state) => { await wait(120); const g = await geo(); const r = { state, ...slim(g), composerText: g.composerText }; matrix.push(r); note(`r3 matrix: ${state}`, JSON.stringify(r)); return g; };
	await row("idle, no aside");
	await type("/btw");
	await wait(150);
	await enter();
	await waitFor((g) => g.panel !== null, 40);
	await row("aside attached, idle conversation");
	await closePanel();
	// A thread send held by the proxy (4 s) -> #479's in-flight sentence
	await type("SLOWTURN say hi");
	await wait(150);
	await enter();
	await wait(400);
	await row("thread send in flight (proxy holds POST /messages)");
	await raw("07a-sending-no-aside");
	await type("/btw");
	await wait(150);
	await enter();
	await wait(500);
	const both = await row("thread send in flight + /btw attached");
	await raw("07b-sending-plus-aside");
	await clickAt(cdp, FIELD);
	await esc();
	await wait(300);
	await row("thread send in flight, aside closed");
	await waitFor((g) => g.placeholder !== "Sending your message", 80);
	await row("send settled, agent working (stub first chunk at 6 s)");
	await clearBox();
	await type("/btw");
	await wait(150);
	await enter();
	await waitFor((g) => g.panel !== null, 40);
	await row("agent working + aside attached");
	await raw("07c-working-plus-aside");
	// does the cue outlive the aside across a conversation switch? (sidebar New chat, a real click)
	await cdp.evaluate(`(() => { const el = Array.from(document.querySelectorAll("button, a, [role=button]")).find((x) => x.textContent.replace(/\\s+/g, " ").trim().startsWith("New chat")); if (!el) return false; el.setAttribute("data-r3-newchat", "1"); return true; })()`);
	await clickAt(cdp, "[data-r3-newchat]");
	await wait(1200);
	await row("navigated to New chat with the aside still attached to the other session");
	await raw("07d-new-chat-after-switch");
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	await wait(1200);
	await row("back on the session");
	await clickAt(cdp, FIELD);
	await esc();
	await wait(300);
	await waitFor((g) => (g.workingLine ?? null) === null && g.placeholder === "Ask me for help", 150);
	await row("turn done, aside closed");
	note("r3 matrix (all rows)", JSON.stringify(matrix));
}
