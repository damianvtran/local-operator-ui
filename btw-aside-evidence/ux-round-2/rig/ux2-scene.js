
/* ===================================================================== *
 *        UX ROUND 2 (independent) — PR #482 at 0bc4a97bb
 *
 * Driver-only, uncommitted: appended to a COPY of scripts/renderer-driver.mjs
 * (scripts/renderer-driver-ux2.mjs, untracked) after QA round 1's helper layer.
 * Every step is a real Input.dispatchKeyEvent / insertText / mouse event, and every
 * reading is the app's own DOM: document.activeElement, the placeholder, the box's
 * value, the panel, its live region, the composer's alert line, the transcript.
 * ===================================================================== */

async function ux2Read(cdp) {
	const t0 = Date.now();
	const v = await cdp.evaluate(`(() => {
		const flat = (el) => (el ? el.textContent.replace(/\\s+/g, " ").trim() : null);
		const field = document.querySelector('textarea[aria-label="Message"]');
		const panel = document.querySelector("[data-lo-aside-panel]");
		const send = document.querySelector('button[aria-label="Send message"], button[aria-label="Ask the aside"]');
		const band = document.querySelector("[data-lo-composer-band]");
		const a = document.activeElement;
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		const turns = region ? Array.from(region.children) : [];
		const last = turns.at(-1) || null;
		const clip = region ? region.getBoundingClientRect() : null;
		const lt = last ? last.getBoundingClientRect() : null;
		const adopt = panel ? Array.from(panel.querySelectorAll("button")).find((b) => b.textContent.trim().startsWith("Add to conversation")) : null;
		const bandAlerts = band ? Array.from(band.querySelectorAll('[role="alert"]')).filter((n) => !n.closest("[data-lo-aside-panel]")).map(flat) : [];
		const desc = adopt && adopt.getAttribute("aria-describedby") ? document.getElementById(adopt.getAttribute("aria-describedby")) : null;
		return {
			placeholder: field ? field.placeholder : null,
			fieldValue: field ? field.value : null,
			active: a ? a.tagName.toLowerCase() + (a.getAttribute("aria-label") ? "[" + a.getAttribute("aria-label") + "]" : "") + (a.tagName === "BUTTON" ? "{" + a.textContent.replace(/\\s+/g, " ").trim().slice(0, 30) + "}" : "") : null,
			activeIsField: a === field,
			activeIsBody: a === document.body,
			panel: panel !== null,
			panelText: flat(panel),
			announce: panel ? flat(panel.querySelector("output")) : null,
			panelAlert: panel ? flat(panel.querySelector('[role="alert"]')) : null,
			adopt: adopt ? { disabled: adopt.disabled, describedBy: desc ? flat(desc) : null } : null,
			send: send ? { disabled: send.disabled, label: send.getAttribute("aria-label") } : null,
			bandAlerts,
			region: region ? {
				tabIndex: region.tabIndex, scrollTop: Math.round(region.scrollTop), scrollHeight: region.scrollHeight, clientHeight: region.clientHeight,
				turns: turns.length,
				lastTop: lt ? Math.round(lt.top - clip.top) : null,
				lastTopVisible: lt ? lt.top >= clip.top - 1 && lt.top <= clip.bottom - 8 : null,
				lastBottomVisible: lt ? lt.bottom <= clip.bottom + 1 : null,
			} : null,
			transcript: flat(document.querySelector("[data-lo-transcript-content]")),
			hero: (() => { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim() === "What can I help you with today?") return n.parentElement.getClientRects().length > 0; return false; })(),
			busy: document.querySelector('button[aria-label="Stop agent"]') !== null || document.querySelector("[data-lo-canonical-transcript] [data-lo-working-line]") !== null,
		};
	})()`);
	const ms = Date.now() - t0;
	if (ms > 1500) note("SLOW READ", String(ms) + "ms");
	return v;
}

/** Where a sentence landed: panel / composer band / transcript / toast / elsewhere. */
function ux2Where(cdp, needle) {
	return cdp.evaluate(`(() => {
		const needle = ${JSON.stringify(needle)};
		const out = [];
		const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			if (!n.nodeValue || !n.nodeValue.includes(needle)) continue;
			const el = n.parentElement;
			const zone = el.closest("[data-lo-aside-panel]") ? "panel" : el.closest("[data-lo-transcript-content]") ? "transcript" : el.closest("[data-sonner-toast]") ? "toast" : el.closest("[data-lo-composer-band]") ? "composer-band" : "elsewhere";
			const roleEl = el.closest("[role]");
			const r = el.getBoundingClientRect();
			out.push({ zone, role: roleEl ? roleEl.getAttribute("role") : null, visible: r.width > 0 && r.height > 0, text: el.textContent.replace(/\\s+/g, " ").trim().slice(0, 300) });
		}
		return out;
	})()`);
}

/** Hover an element (real mouse move) and read the tooltip it raises. */
async function ux2Tooltip(cdp, selectorExpr) {
	const box = await cdp.evaluate(`(() => { const el = ${selectorExpr}; if (!el) return null; const r = el.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
	if (!box) return { box: null, tooltip: null };
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: box.x, y: box.y, button: "none", buttons: 0 });
	let tip = null;
	for (let i = 0; i < 20 && !tip; i++) {
		await wait(100);
		tip = await cdp.evaluate(`(() => { const t = document.querySelector('[role="tooltip"]'); return t ? t.textContent.replace(/\\s+/g, " ").trim() : null; })()`);
	}
	return { box, tooltip: tip };
}

async function ux2MouseAway(cdp) {
	await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: 5, y: 5, button: "none", buttons: 0 });
	await wait(250);
}

async function sceneBtwUx2(cdp) {
	const FIELD = 'textarea[aria-label="Message"]';
	const TAIL = "wrong, not the provider";
	const LONG_TAIL = "exhaust the allowance";
	const REFUSAL = "The model did not answer your aside";
	const log = (label, value) => note(label, JSON.stringify(value));
	const facts = await factsOf(cdp);
	check("window mode is headless and never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	log("session", sessionId);
	const take = async (label) => {
		const frame = await capture(cdp, `ux2-${label}`);
		note("frame", JSON.stringify({ label: frame.label, ...frame.pixels }));
	};
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const esc = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const tab = (shift) => pressChord(cdp, { key: "Tab", code: "Tab", virtualKeyCode: 9, modifiers: shift ? MODIFIER.shift : 0 });
	const cmdF = () => pressChord(cdp, { key: "f", code: "KeyF", virtualKeyCode: 70, modifiers: MODIFIER.meta });
	const type = async (text) => { await cdp.send("Input.insertText", { text }); await wait(200); };
	const clearBox = async () => {
		await clickAt(cdp, FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8, commands: ["deleteBackward"] });
		await wait(150);
	};
	const until = async (pred, ms = 15000) => {
		const t0 = Date.now();
		let r = await ux2Read(cdp);
		while (!pred(r) && Date.now() - t0 < ms) { await wait(80); r = await ux2Read(cdp); }
		return { ...r, waitedMs: Date.now() - t0, met: pred(r) };
	};
	const count = (s, n) => (s ?? "").split(n).length - 1;
	const settled = (r) => r.adopt && r.adopt.disabled === false;
	const idle = (r) => r.panel && !(r.panelText ?? "").includes("thinking…") && r.announce !== "Asking the aside";
	const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
	const STD = ["fieldValue", "placeholder", "active", "announce", "panelAlert", "bandAlerts", "adopt", "send", "region"];

	const rest = await ux2Read(cdp);
	log("0 at rest", pick(rest, ["placeholder", "active", "send", "hero"]));

	// ===== FLOW 8 + U10 + U8: one-line door, settle, announce, hover cap, ⌘F adopt into an EMPTY conversation =====
	const Q1 = "what does the retry budget actually cap?";
	await clickAt(cdp, FIELD);
	await type(`/btw ${Q1}`);
	await enter();
	const t1 = Date.now();
	const th = await until((r) => (r.panelText ?? "").includes(Q1), 5000);
	log("8a one-line door right after Enter", { ms: Date.now() - t1, ...pick(th, STD) });
	const s1 = await until((r) => settled(r) && (r.panelText ?? "").includes(TAIL), 20000);
	log("8b settled (U10 announce)", { msSinceEnter: Date.now() - t1, ...pick(s1, STD) });
	await take("01-settled-first-answer");
	const capTip = await ux2Tooltip(cdp, `(() => { const p = document.querySelector("[data-lo-aside-panel]"); if (!p) return null; const k = Array.from(p.querySelectorAll("kbd, span")).find((n) => /⌘\\+F|Ctrl\\+F/.test(n.textContent) && n.childElementCount <= 3); return k || null; })()`);
	log("U8 hover the ⌘+F cap", capTip);
	await take("02-cap-tooltip");
	await ux2MouseAway(cdp);
	await clickAt(cdp, FIELD);
	await cdp.evaluate(`(() => {
		window.__ux2T = []; const t0 = performance.now(); let lastKey = "";
		const Q = ${JSON.stringify(Q1)};
		const tick = () => {
			const panel = !!document.querySelector("[data-lo-aside-panel]");
			let hero = false; { const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT); for (let n = w.nextNode(); n; n = w.nextNode()) if (n.nodeValue.trim() === "What can I help you with today?") { hero = n.parentElement.getClientRects().length > 0; break; } }
			const tr = document.querySelector("[data-lo-transcript-content]");
			const rows = !!(tr && tr.textContent.includes(Q));
			const key = panel + "/" + hero + "/" + rows;
			if (key !== lastKey) { window.__ux2T.push({ t: Math.round(performance.now() - t0), panel, hero, rows }); lastKey = key; }
			if (performance.now() - t0 < 4000) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
	})()`);
	await cmdF();
	await wait(4200);
	const timeline = await cdp.evaluate("window.__ux2T");
	const afterAdopt = await ux2Read(cdp);
	log("8c ⌘F adopt timeline (panel/hero/rows by rAF)", timeline);
	log("8d after ⌘F adopt", { ...pick(afterAdopt, ["panel", "active", "activeIsField", "placeholder", "send"]), transcriptHasQ1: (afterAdopt.transcript ?? "").includes(Q1) });
	await take("03-after-cmdf-adopt");

	// ===== FLOW 1 (U1): fresh refusal, retry in place; then a refused CONTINUATION, retry in place =====
	await clickAt(cdp, FIELD);
	await type("/btw TOOLCALL2: the first ask of this panel is refused");
	await enter();
	const r1 = await until((r) => r.panelAlert !== null, 20000);
	log("1a fresh ask refused", { ...pick(r1, STD), panelText: r1.panelText });
	await take("04-fresh-ask-refused");
	const RETRY1 = "a plain question after the refusal";
	await type(RETRY1);
	const typedRetry = await ux2Read(cdp);
	log("1b retry typed (box/send before Enter)", pick(typedRetry, ["fieldValue", "send", "bandAlerts", "placeholder"]));
	await enter();
	const r1b = await until((r) => settled(r) && count(r.panelText, TAIL) >= 1 && (r.panelText ?? "").includes(RETRY1), 20000);
	log("1c retry in place after a FRESH refusal", { met: r1b.met, ...pick(r1b, STD), panelText: r1b.panelText, escapeClauseShown: (r1b.panelText ?? "").includes("Close this aside") });
	await take("05-retry-after-fresh-refusal-answered");
	await type("TOOLCALL2: a follow-up that is refused");
	await enter();
	const r1c = await until((r) => r.panelAlert !== null && (r.panelText ?? "").includes("a follow-up that is refused") && !(r.panelText ?? "").endsWith("thinking…"), 20000);
	log("1d refused CONTINUATION", { ...pick(r1c, STD), panelText: r1c.panelText });
	await take("06-continuation-refused");
	const RETRY2 = "asking again in place after the continuation refusal";
	await type(RETRY2);
	await enter();
	const r1d = await until((r) => (r.panelText ?? "").includes(RETRY2) && ((settled(r) && count(r.panelText, TAIL) >= 2) || ((r.panelText ?? "").split(RETRY2)[1] ?? "").length > 20 && !(r.panelText ?? "").endsWith("thinking…")), 20000);
	await wait(600);
	const r1e = await ux2Read(cdp);
	log("1e retry in place AFTER the continuation refusal (the escape clause said close & reopen)", { ...pick(r1e, STD), panelText: r1e.panelText, answered: count(r1e.panelText, TAIL) >= 2 });
	await take("07-retry-after-continuation-refusal");
	await esc();
	await wait(300);

	// ===== FLOW 2 (U2): follow-up pressed mid-stream, both doors =====
	await clearBox();
	const QA = "mid-stream follow-up base question";
	await type(`/btw ${QA}`);
	await enter();
	await until((r) => (r.panelText ?? "").includes("Transport failures"), 15000);
	const QB = "follow-up pressed before the first answer ends";
	await type(QB);
	const beforeB = await ux2Read(cdp);
	await enter();
	await wait(400);
	const x1 = await ux2Read(cdp);
	log("2a follow-up Enter mid-stream (composer door)", { sendBefore: beforeB.send, ...pick(x1, STD), questionOnPanel: (x1.panelText ?? "").includes(QB), where: await ux2Where(cdp, "still answering") });
	await take("08-followup-midstream-held");
	const x2 = await until((r) => settled(r), 20000);
	log("2b first answer settled; is the busy line still up and the text still there?", { ...pick(x2, STD), where: await ux2Where(cdp, "still answering") });
	await take("09-after-settle-busy-line-still");
	await clickAt(cdp, FIELD);
	await enter();
	const x3 = await until((r) => (r.panelText ?? "").includes(QB) && settled(r) && count(r.panelText, TAIL) >= 2, 20000);
	log("2c Enter again after settle", { met: x3.met, ...pick(x3, STD) });
	await take("10-followup-sent-after-settle");
	// slash door while streaming
	await type("third question to set a stream going");
	await enter();
	await until((r) => (r.panelText ?? "").split("third question to set a stream going")[1]?.includes("Transport failures"), 15000);
	await type("/btw slash door pressed while streaming");
	await enter();
	await wait(500);
	const x4 = await ux2Read(cdp);
	log("2d /btw <q> door mid-stream", { ...pick(x4, STD), where: await ux2Where(cdp, "still answering") });
	await take("11-slash-door-midstream");
	await until((r) => settled(r), 20000);
	await esc();
	await wait(300);
	await clearBox();

	// ===== FLOW 5 (U6/U7/D6): long answer, follow-up into view, region reachable, focus after close/adopt =====
	await type("/btw LONGANSWER: explain the budget in full");
	await enter();
	await until((r) => settled(r) && (r.panelText ?? "").includes(LONG_TAIL), 20000);
	const QF = "and does a 429 spend it?";
	await type(QF);
	await enter();
	await wait(700);
	const f1 = await ux2Read(cdp);
	log("5a follow-up asked while the exchange overflows (D6)", pick(f1, ["region", "announce"]));
	await take("12-followup-into-view");
	const f2 = await until((r) => settled(r) && count(r.panelText, TAIL) >= 1, 20000);
	log("5b follow-up settled", pick(f2, ["region", "announce"]));
	await take("13-followup-settled");
	const walk = [];
	await clickAt(cdp, FIELD);
	for (let i = 0; i < 5; i++) { await tab(true); await wait(150); walk.push((await ux2Read(cdp)).active); }
	log("5c Shift+Tab walk from the composer (U7)", walk);
	// focus the region by walking to it, then scroll it with keys
	await clickAt(cdp, FIELD);
	let reached = false;
	for (let i = 0; i < 5 && !reached; i++) { await tab(true); await wait(150); reached = ((await ux2Read(cdp)).active ?? "").includes("The aside exchange"); }
	const rg0 = (await ux2Read(cdp)).region;
	await pressChord(cdp, { key: "Home", code: "Home", virtualKeyCode: 36 });
	await wait(300);
	const rg1 = (await ux2Read(cdp)).region;
	await pressChord(cdp, { key: "End", code: "End", virtualKeyCode: 35 });
	await wait(300);
	const rg2 = (await ux2Read(cdp)).region;
	await pressChord(cdp, { key: "PageUp", code: "PageUp", virtualKeyCode: 33 });
	await wait(300);
	const rg3 = (await ux2Read(cdp)).region;
	log("5d region reached by keyboard and scrolled by Home/End/PageUp", { reached, before: rg0.scrollTop, home: rg1.scrollTop, end: rg2.scrollTop, pageUp: rg3.scrollTop, max: rg0.scrollHeight - rg0.clientHeight });
	await take("14-region-focused");
	// Esc from the focused region
	await esc();
	await wait(300);
	const escRegion = await ux2Read(cdp);
	log("5e Esc with focus on the exchange region", pick(escRegion, ["panel", "active", "activeIsField"]));
	if (escRegion.panel) { await esc(); await wait(300); }
	// close control with the pointer
	await clickAt(cdp, FIELD);
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	await clickAt(cdp, 'button[aria-label="Close the aside"]');
	await wait(300);
	const cx = await ux2Read(cdp);
	log("5f close control pressed (U6)", pick(cx, ["panel", "active", "activeIsField"]));
	// keyboard into the close control, Esc
	await clickAt(cdp, FIELD);
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	await clickAt(cdp, FIELD);
	const toClose = [];
	for (let i = 0; i < 3; i++) { await tab(true); await wait(120); const a = (await ux2Read(cdp)).active; toClose.push(a); if ((a ?? "").includes("Close the aside")) break; }
	await esc();
	await wait(300);
	const ex = await ux2Read(cdp);
	log("5g Esc with focus on the close control (U6)", { walked: toClose, ...pick(ex, ["panel", "active", "activeIsField"]) });
	// Enter on the focused close control
	await clickAt(cdp, FIELD);
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	await clickAt(cdp, FIELD);
	for (let i = 0; i < 3; i++) { await tab(true); await wait(120); if (((await ux2Read(cdp)).active ?? "").includes("Close the aside")) break; }
	await pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	await wait(300);
	const ek = await ux2Read(cdp);
	log("5h Enter on the focused close control (U6)", pick(ek, ["panel", "active", "activeIsField"]));
	if (ek.panel) { await esc(); await wait(200); }
	// click adopt
	await clickAt(cdp, FIELD);
	const Q3 = "one-line door: what is a 4xx worth?";
	await type(`/btw ${Q3}`);
	await enter();
	await until((r) => settled(r), 20000);
	const btn = await qaAdoptControl(cdp);
	await qaPressPoint(cdp, btn);
	const clicked = await until((r) => !r.panel, 8000);
	await wait(800);
	const afterClick = await ux2Read(cdp);
	log("5i click adopt (U6)", { panelGoneMs: clicked.waitedMs, ...pick(afterClick, ["active", "activeIsField"]), inTranscript: (afterClick.transcript ?? "").includes(Q3) });
	await take("15-after-click-adopt");

	// ===== FLOW 4 (U5): a thread-shaped message typed with the panel up =====
	await clearBox();
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	const up = await ux2Read(cdp);
	log("4a bare /btw: routing cues before typing", pick(up, ["placeholder", "send", "active"]));
	await take("16-bare-btw-placeholder");
	const THREADY = "please run the tests in the workspace";
	await type(THREADY);
	const typed = await ux2Read(cdp);
	const sendTip = await ux2Tooltip(cdp, `document.querySelector('button[aria-label="Ask the aside"]')`);
	log("4b thread-shaped message typed with the panel up", { ...pick(typed, ["placeholder", "fieldValue", "send"]), sendTooltip: sendTip.tooltip });
	await take("17-thready-message-typed-send-tooltip");
	await ux2MouseAway(cdp);
	await clickAt(cdp, FIELD);
	await enter();
	await wait(600);
	const went = await ux2Read(cdp);
	log("4c where it went", { panelHasIt: (went.panelText ?? "").includes(THREADY), transcriptHasIt: (went.transcript ?? "").includes(THREADY), fieldValue: went.fieldValue, busy: went.busy });
	await until((r) => settled(r), 20000);
	await esc();
	await wait(300);

	// ===== FLOW 3 (U4 / D7 / D8): panel closed, THEN the ask is refused, both doors =====
	await clearBox();
	await type("/btw TOOLCALL2 SLOW: slash door closed early");
	await enter();
	await until((r) => r.panel);
	await wait(300);
	await esc();
	const t6 = Date.now();
	let slashNote = [];
	for (let i = 0; i < 150 && slashNote.length === 0; i++) { await wait(100); slashNote = await ux2Where(cdp, "got no answer"); }
	log("3a /btw <q> door: closed, then refused", { msAfterEsc: Date.now() - t6, where: slashNote });
	await take("18-closed-then-refused-slash-door");
	await clickAt(cdp, FIELD);
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	await type("TOOLCALL2 SLOW: composer door closed early");
	await enter();
	await wait(300);
	await esc();
	const t6b = Date.now();
	let comp = [];
	for (let i = 0; i < 150; i++) { await wait(100); comp = (await ux2Where(cdp, "got no answer")).filter((w) => w.zone === "composer-band"); if (comp.length) break; }
	const c1 = await ux2Read(cdp);
	log("3b composer door: closed, then refused", { msAfterEsc: Date.now() - t6b, where: comp, ...pick(c1, ["fieldValue", "bandAlerts", "active"]) });
	await take("19-closed-then-refused-composer-door");
	await type("next thought");
	await wait(1800);
	await type(" and more");
	await wait(400);
	const c2 = await ux2Read(cdp);
	log("3c typing after the composer-door refusal (false suffix?)", pick(c2, ["fieldValue", "bandAlerts"]));
	await take("20-typing-after-composer-refusal");
	await clearBox();
	await wait(300);
	const c3 = await ux2Read(cdp);
	log("3d box cleared", pick(c3, ["bandAlerts"]));

	// ===== FLOW 7 (U3, and U2's gate in the held window) =====
	await clearBox();
	await type("SLOWTURN: take your time answering this one");
	await enter();
	const working = await until((r) => r.busy, 15000);
	log("7a conversation working", pick(working, ["busy", "placeholder"]));
	const Q7 = "an aside while the agent works";
	await clickAt(cdp, FIELD);
	await type(`/btw ${Q7}`);
	await enter();
	const t7 = Date.now();
	const w1 = await until((r) => (r.panelText ?? "").includes(TAIL), 25000);
	await wait(1500);
	const w2 = await ux2Read(cdp);
	log("7b aside answer text complete while the turn runs", { msSinceAsk: Date.now() - t7, ...pick(w2, STD), busy: w2.busy });
	await take("21-answer-complete-turn-running");
	const QW = "follow-up while the agent works";
	await type(QW);
	await enter();
	await wait(500);
	const w3 = await ux2Read(cdp);
	log("7c follow-up pressed with the answer complete but the turn running", { ...pick(w3, STD), where: await ux2Where(cdp, "still answering") });
	await take("22-followup-refused-while-turn-runs");
	const freed = await until((r) => r.adopt && r.adopt.disabled === false, 60000);
	log("7d turn ended: adopt live", { waitedMs: freed.waitedMs, msSinceAsk: Date.now() - t7, ...pick(freed, STD), busy: freed.busy });
	await take("23-after-turn-ended");
	note("UX2 scene", "finished");
}

/* ---- pass B: re-checks the wide pass could not settle, run at the narrow width ---- */
async function sceneBtwUx2b(cdp) {
	const FIELD = 'textarea[aria-label="Message"]';
	const TAIL = "wrong, not the provider";
	const log = (label, value) => note(label, JSON.stringify(value));
	const facts = await factsOf(cdp);
	check("window mode is headless and never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	const take = async (label) => { const f = await capture(cdp, `ux2b-${label}`); note("frame", JSON.stringify({ label: f.label, ...f.pixels })); };
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const esc = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const type = async (text) => { await cdp.send("Input.insertText", { text }); await wait(200); };
	const clearBox = async () => {
		await clickAt(cdp, FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8, commands: ["deleteBackward"] });
		await wait(150);
	};
	const until = async (pred, ms = 15000) => {
		const t0 = Date.now();
		let r = await ux2Read(cdp);
		while (!pred(r) && Date.now() - t0 < ms) { await wait(80); r = await ux2Read(cdp); }
		return { ...r, waitedMs: Date.now() - t0, met: pred(r) };
	};
	const count = (s, n) => (s ?? "").split(n).length - 1;
	const settled = (r) => r.adopt && r.adopt.disabled === false;
	const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
	const STD = ["fieldValue", "placeholder", "active", "announce", "panelAlert", "bandAlerts", "adopt", "send", "region"];
	const chips = () => cdp.evaluate(`Array.from(document.querySelectorAll('[aria-label="Remove reply"]')).map((b) => (b.closest("[class]")?.parentElement?.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 120))`);

	// ===== B1 (U1): a refused CONTINUATION, wait for it to LAND, then ask again in place =====
	await clickAt(cdp, FIELD);
	await type("/btw first question of this panel");
	await enter();
	await until((r) => settled(r) && (r.panelText ?? "").includes(TAIL), 20000);
	await type("TOOLCALL2: a follow-up that is refused");
	await enter();
	const landed = await until((r) => (r.panelText ?? "").includes("Close this aside and start a new one"), 20000);
	log("B1a continuation refusal landed", { met: landed.met, ...pick(landed, STD) });
	await take("01-continuation-refused-landed");
	const RETRY = "asking again in place after the continuation refusal";
	await type(RETRY);
	await enter();
	const t = Date.now();
	const again = await until((r) => (r.panelText ?? "").includes(RETRY) && (settled(r) || (r.panelText ?? "").split(RETRY)[1]?.includes("did not answer") || (r.panelText ?? "").split(RETRY)[1]?.includes("no longer available")), 20000);
	await wait(400);
	const a2 = await ux2Read(cdp);
	log("B1b asked again IN PLACE, after being told to close and reopen", { msSinceEnter: Date.now() - t, answered: count(a2.panelText, TAIL) >= 2, ...pick(a2, STD), panelText: a2.panelText });
	await take("02-retry-in-place-after-continuation-refusal");
	await esc();
	await wait(300);

	// ===== B2 (U2): the busy line — does it stay after the answer settles? when does it go? =====
	await clearBox();
	await type("/btw base question for the busy line");
	await enter();
	await until((r) => (r.panelText ?? "").includes("Transport failures"), 15000);
	await type("follow-up pressed mid-stream");
	await enter();
	await wait(300);
	const b0 = await ux2Read(cdp);
	const tS = Date.now();
	const st = await until((r) => settled(r), 20000);
	const seq = [];
	for (let i = 0; i < 16; i++) { const r = await ux2Read(cdp); seq.push({ ms: Date.now() - tS, line: (r.bandAlerts[0] ?? "").slice(0, 40), settled: settled(r) }); await wait(500); }
	log("B2 busy line through the settle (no typing)", { atPress: b0.bandAlerts, settledAfterMs: st.waitedMs, seq });
	await take("03-busy-line-after-settle");
	await esc();
	await wait(300);
	await clearBox();

	// ===== B3 (fold): a staged QUOTE through the aside, refused then answered =====
	await type("plain thread question to have an assistant row");
	await enter();
	await until((r) => (r.transcript ?? "").includes(TAIL) && !r.busy, 25000);
	await wait(800);
	const sel = await cdp.evaluate(`(() => {
		const tr = document.querySelector("[data-lo-transcript-content]");
		const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
		for (let n = w.nextNode(); n; n = w.nextNode()) {
			const i = n.nodeValue.indexOf("within a moving window");
			if (i >= 0) { const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + "within a moving window".length); const s = getSelection(); s.removeAllRanges(); s.addRange(r); return true; }
		}
		return false;
	})()`);
	await wait(600);
	const qb = await cdp.evaluate(`(() => { const b = document.querySelector('button[aria-label="Quote"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
	if (qb) await qaPressPoint(cdp, qb);
	await wait(600);
	log("B3a quote staged", { selected: sel, quoteButton: qb, chips: await chips() });
	await clickAt(cdp, FIELD);
	await type("/btw");
	await enter();
	await until((r) => r.panel);
	log("B3b bare /btw with a quote staged", { chips: await chips() });
	await type("TOOLCALL2 SLOW: refused with a quote staged");
	await enter();
	await wait(400);
	const q1 = await ux2Read(cdp);
	log("B3c right after Enter (quote staged, refused ask)", { chips: await chips(), ...pick(q1, ["fieldValue"]), panelText: q1.panelText });
	await take("04-quote-staged-ask-in-flight");
	const q2 = await until((r) => r.panelAlert !== null, 20000);
	log("B3d refused", { chips: await chips(), panelText: q2.panelText });
	await take("05-quote-staged-ask-refused");
	await type("answered with a quote staged");
	await enter();
	await wait(400);
	log("B3e answered ask in flight", { chips: await chips() });
	const q3 = await until((r) => settled(r), 20000);
	await wait(300);
	log("B3f answered", { chips: await chips(), panelText: q3.panelText });
	await take("06-quote-staged-ask-answered");
	await esc();
	note("UX2B scene", "finished");
}

/* ---- pass C: the U4 suffix read at the first keystroke, and the busy line under typing ---- */
async function sceneBtwUx2c(cdp) {
	const FIELD = 'textarea[aria-label="Message"]';
	const log = (label, value) => note(label, JSON.stringify(value));
	const facts = await factsOf(cdp);
	check("window mode is headless and never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible}`);
	await qaOpenSession(cdp);
	const take = async (label) => { const f = await capture(cdp, `ux2c-${label}`); note("frame", JSON.stringify({ label: f.label, ...f.pixels })); };
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const esc = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const key = (k) => pressChord(cdp, { key: k, code: `Key${k.toUpperCase()}`, virtualKeyCode: k.toUpperCase().charCodeAt(0) });
	const until = async (pred, ms = 15000) => { const t0 = Date.now(); let r = await ux2Read(cdp); while (!pred(r) && Date.now() - t0 < ms) { await wait(80); r = await ux2Read(cdp); } return { ...r, waitedMs: Date.now() - t0 }; };
	const settled = (r) => r.adopt && r.adopt.disabled === false;
	// C1: composer door, closed, then refused; one real keystroke; read at 0/300/1000/2000 ms
	await clickAt(cdp, FIELD);
	await cdp.send("Input.insertText", { text: "/btw" }); await wait(150);
	await enter();
	await until((r) => r.panel);
	await cdp.send("Input.insertText", { text: "TOOLCALL2 SLOW: composer door closed early" }); await wait(150);
	await enter();
	await wait(300);
	await esc();
	await until((r) => r.bandAlerts.length > 0, 15000);
	const seq = [];
	await key("n");
	const t0 = Date.now();
	for (const at of [0, 300, 1000, 2000]) { while (Date.now() - t0 < at) await wait(20); const r = await ux2Read(cdp); seq.push({ ms: Date.now() - t0, box: r.fieldValue, line: r.bandAlerts }); if (at === 300) await take("01-first-keystroke-after-refusal"); }
	log("C1 composer-door refusal: alert after ONE keystroke", seq);
	await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8, commands: ["deleteBackward"] });
	// C2: busy line while the user keeps typing
	await cdp.send("Input.insertText", { text: "/btw base question for the busy line" }); await wait(150);
	await enter();
	await until((r) => (r.panelText ?? "").includes("Transport failures"), 15000);
	await cdp.send("Input.insertText", { text: "follow-up" }); await wait(100);
	await enter();
	await wait(200);
	const c2 = [];
	const t1 = Date.now();
	for (let i = 0; i < 8; i++) { await key("x"); await wait(400); const r = await ux2Read(cdp); c2.push({ ms: Date.now() - t1, settled: settled(r), line: (r.bandAlerts[0] ?? "").slice(0, 60) }); }
	log("C2 busy line while typing on", c2);
	await esc();
	note("UX2C scene", "finished");
}
