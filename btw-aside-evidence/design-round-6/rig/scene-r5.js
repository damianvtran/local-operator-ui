
/* ===================================================================== *
 *        QA ROUND 5 (independent) — the /btw aside, delta 8ea341d36..ba98e4fdc
 *
 * Appended after rounds 1-4's helper layer and scenes, to a COPY of
 * scripts/renderer-driver.mjs. The app's source is unmodified.
 *
 *  btw-r5-clip   Q33: a refused follow-up (and the dropped-exchange refusal) is
 *                scrolled into view; D11's properties under the new phase trigger.
 *  btw-r5-adopt  the adopt end to end: control and second ⌘+F, paint latency,
 *                leave + re-enter, the daemon's own record; R6-5's stale confirm.
 *  btw-r5-cap    R6-4: the cap with 0/1/2 staged quotes, a wrapping quote and a
 *                wrapping question, swept over PARAGRID1..9.
 * ===================================================================== */

const R5 = {
	DISCARD: "or press Esc to close the aside and discard it",
	CANT: "This aside can't continue.",
	ANSWER_HEAD: "Transport failures and owner",
};

/** Geometry of the newest turn's refusal against the region's clip. */
function r5Clip(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const clip = rr.top + region.clientHeight;
		const last = region.lastElementChild;
		const lr = last.getBoundingClientRect();
		const a = last.querySelector('[role="alert"]');
		const rd = (x) => Math.round(x * 10) / 10;
		const out = {
			scrollTop: rd(region.scrollTop),
			maxScroll: region.scrollHeight - region.clientHeight,
			target: rd(region.scrollTop + lr.top - rr.top),
			state: last.textContent.includes("thinking") ? "thinking" : a ? "alert" : "other",
		};
		if (!a) return out;
		const ar = a.getBoundingClientRect();
		const range = document.createRange();
		range.selectNodeContents(a);
		const rows = [];
		for (const x of range.getClientRects()) { if (!rows.some((y) => Math.abs(y.top - x.top) < 2)) rows.push({ top: x.top, bottom: x.bottom }); }
		rows.sort((p, q) => p.top - q.top);
		const lastRow = rows[rows.length - 1];
		// The specific clause: where does the phrase that names Esc's cost sit?
		let phrase = null;
		const walk = document.createTreeWalker(a, NodeFilter.SHOW_TEXT);
		let n = walk.nextNode();
		while (n) {
			for (const needle of ["discard it", "discards this exchange", "start a new one with /btw"]) {
				const at = n.nodeValue.lastIndexOf(needle);
				if (at >= 0) {
					const r = document.createRange();
					r.setStart(n, at); r.setEnd(n, at + needle.length);
					const rs = Array.from(r.getClientRects());
					const b = Math.max(...rs.map((x) => x.bottom));
					phrase = { needle, bottomVsClipPx: rd(b - clip), visible: b <= clip + 0.5 && Math.min(...rs.map((x) => x.top)) >= rr.top - 0.5 };
				}
			}
			n = walk.nextNode();
		}
		return {
			...out,
			alertText: a.textContent.replace(/\\s+/g, " ").trim(),
			alertTopInRegion: rd(ar.top - rr.top),
			alertBottomInRegion: rd(ar.bottom - rr.top),
			clientHeight: region.clientHeight,
			hiddenBelowPx: rd(Math.max(0, ar.bottom - clip)),
			hiddenAbovePx: rd(Math.max(0, rr.top - ar.top)),
			rows: rows.length,
			rowsFullyVisible: rows.filter((y) => y.bottom <= clip + 0.5 && y.top >= rr.top - 0.5).length,
			lastRowBottomVsClipPx: lastRow ? rd(lastRow.bottom - clip) : null,
			phrase,
		};
	})()`);
}

function r5Harness(cdp, prefix) {
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const escape = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const cmdF = () => pressChord(cdp, { key: "f", code: "KeyF", virtualKeyCode: 70, modifiers: MODIFIER.meta });
	const type = async (text) => { await cdp.send("Input.insertText", { text }); await wait(150); };
	const replaceComposer = async (text) => {
		await clickAt(cdp, R4.FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
		if (text) await cdp.send("Input.insertText", { text });
		await wait(200);
	};
	const band = () => readQaBand(cdp);
	const awaitBand = (want, n = 80) => qaAwaitPanel(cdp, want, n);
	const idle = () => awaitBand((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	const awaitSettled = async (needle, n = 400) => {
		for (let i = 0; i < n; i++) {
			const post = r4posts(needle)[0];
			const b = await band();
			if (post && post.status !== null && b.panelAnnounce !== "Asking the aside") return { post, band: b };
			await wait(100);
		}
		return { post: r4posts(needle)[0] ?? null, band: await band() };
	};
	const ask = async (text) => { await clickAt(cdp, R4.FIELD); await type(text); await enter(); return awaitSettled(text.replace(/^\/btw /, "")); };
	const closePanel = async () => { await clickAt(cdp, R4.FIELD); await escape(); await awaitBand((b) => b.panel === null, 60); };
	const take = async (label, mode = "settled") => {
		const f = mode === "settled" ? await captureSettled(cdp, `${prefix}-${label}`) : await capture(cdp, `${prefix}-${label}`);
		note("frame", JSON.stringify({ label: f.label, mode }));
		return f;
	};
	return { enter, escape, cmdF, type, replaceComposer, band, awaitBand, idle, awaitSettled, ask, closePanel, take };
}

/**
 * Ask `q` as a follow-up in the open panel and sample the clip from the press until
 * 2.5 s after the turn lands. `onThinking` runs once, mid-thinking (for the hand scroll).
 */
async function r5SampleAsk(cdp, h, q, { onThinking = null } = {}) {
	await clickAt(cdp, R4.FIELD);
	await h.type(q);
	const t0 = Date.now();
	await h.enter();
	const samples = [];
	let landedAt = null;
	let did = false;
	for (let i = 0; i < 500; i++) {
		const g = await r5Clip(cdp);
		if (g) samples.push([Date.now() - t0, g.scrollTop, g.maxScroll, g.target, g.state, g.hiddenBelowPx ?? null]);
		if (onThinking && !did && g && g.state === "thinking" && Date.now() - t0 > 400) { did = true; await onThinking(g); }
		if (landedAt === null && g && g.state !== "thinking") landedAt = Date.now();
		if (landedAt !== null && Date.now() - landedAt > 2500) break;
		await wait(50);
	}
	const dedup = samples.filter((s, i) => i === 0 || JSON.stringify(s.slice(1)) !== JSON.stringify(samples[i - 1].slice(1)));
	const tops = samples.map((s) => s[1]);
	return { samples: dedup, tops, final: await r5Clip(cdp) };
}

async function sceneBtwR5Clip(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R5 clip session", sessionId);
	const P = `qa5-${RUN_LABEL}`;
	const h = r5Harness(cdp, P);
	const judge = (id, label, res, kind) => {
		const f = res.final;
		const monotone = res.tops.every((t, i) => i === 0 || t >= res.tops[i - 1] - 1);
		const atTarget = f && Math.abs(f.scrollTop - Math.min(f.maxScroll, Math.max(0, f.target))) <= 1;
		note(`${id} ${label} samples [ms, scrollTop, maxScroll, target, state, hiddenBelowPx]`, JSON.stringify(res.samples));
		note(`${id} ${label} final`, JSON.stringify(f));
		r2check(
			`${id} ${label}: at rest the region is at D11's target, the whole refusal is in view (0 px hidden), its last line is visible and '${kind}' is on screen; scrollTop only moved one way`,
			f && f.state === "alert" && atTarget && f.hiddenBelowPx <= 0.5 && f.hiddenAbovePx <= 0.5 && f.rows === f.rowsFullyVisible && f.phrase?.visible === true && monotone,
			JSON.stringify({ scrollTop: f?.scrollTop, maxScroll: f?.maxScroll, target: f?.target, hiddenBelowPx: f?.hiddenBelowPx, hiddenAbovePx: f?.hiddenAbovePx, rows: f?.rows, rowsFullyVisible: f?.rowsFullyVisible, lastRowBottomVsClipPx: f?.lastRowBottomVsClipPx, phrase: f?.phrase, monotone, alert: f?.alertText }),
		);
	};

	// ---- A: follow-ups on a short answered exchange (round 4's btw-r4-clip, extended) ----
	await clickAt(cdp, R4.FIELD);
	await h.type("/btw q35 first question, answered");
	await h.enter();
	await h.awaitSettled("q35 first question, answered");
	const seq = [
		["Q35a", "unanswered (tool call twice)", "TOOLCALL2: q35 follow-up refused by the model", R5.DISCARD],
		["Q35b", "answered follow-up", "q35 second answered question", null],
		["Q35c", "empty answer", "EMPTYANS: q35 follow-up empty answer", R5.DISCARD],
		["Q35d", "unanswered (a call then silence)", "TOOLSILENT: q35 follow-up call then silence", R5.DISCARD],
	];
	for (const [id, label, q, kind] of seq) {
		const res = await r5SampleAsk(cdp, h, q);
		await h.awaitSettled(q.replace(/^[A-Z0-9]+: /, ""));
		if (kind) { judge(id, label, res, kind); await h.take(`${id.toLowerCase()}-refusal-at-rest`); }
		else note(`${id} ${label} samples`, JSON.stringify(res.samples));
	}
	// ---- B: the dropped-exchange refusal ("This aside is no longer available") ----
	const b1 = await h.ask("q35e answered before the owner drops it");
	const dropped = await r4DropAside(sessionId, b1.post?.asideId);
	note("Q35e out-of-band DELETE of the answered entry (probe: the owner evicting/expiring it)", JSON.stringify(dropped));
	const resDrop = await r5SampleAsk(cdp, h, "q35e follow-up after the owner dropped the prefix");
	const dropPost = r4posts("q35e follow-up after the owner dropped")[0] ?? null;
	note("Q35e wire", JSON.stringify(dropPost && { status: dropPost.status, continues: dropPost.continues, response: dropPost.response }));
	judge("Q35e", "dropped exchange (409 no longer available)", resDrop, "can't continue");
	r2check("Q35e the dropped-exchange refusal names no retry that cannot work", (resDrop.final?.alertText ?? "").includes(R5.CANT) && !(resDrop.final?.alertText ?? "").toLowerCase().includes("ask again"), JSON.stringify({ alert: resDrop.final?.alertText }));
	await h.take("q35e-dropped-refusal-at-rest");
	await h.closePanel();

	// ---- C: a refusal under a LONG answer ----
	await h.replaceComposer("/btw LONGANSWER: q36 long first answer");
	await h.enter();
	await h.awaitSettled("q36 long first answer");
	const resLong = await r5SampleAsk(cdp, h, "TOOLCALL2: q36 refused under a long answer");
	await h.awaitSettled("q36 refused under a long answer");
	judge("Q36", "refused follow-up under a long answer", resLong, R5.DISCARD);
	await h.take("q36-refusal-under-long-answer");

	// ---- D: D11 gives up for good once the reader scrolls — even when the refusal lands later ----
	let userAt = null;
	const resUser = await r5SampleAsk(cdp, h, "TOOLCALL2: q37 the reader scrolls while it thinks", {
		onThinking: async () => {
			await wait(250);
			const pre = await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop`);
			const box = await cdp.evaluate(`(() => { const r = document.querySelector('[aria-label="The aside exchange"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
			await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -300 });
			await wait(300);
			let now = await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop`);
			let method = "mouseWheel";
			if (Math.abs(now - pre) <= 1) { await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop -= 300`); now = await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop`); method = "scrollTop-=300"; }
			userAt = now;
			note("Q37 the reader scrolled mid-thinking", JSON.stringify({ from: pre, to: now, method }));
		},
	});
	await h.awaitSettled("q37 the reader scrolls while it thinks");
	await wait(400);
	const q37 = await r5Clip(cdp);
	note("Q37 samples", JSON.stringify(resUser.samples));
	r2check(
		"Q37 D11 yields to the reader: a hand scroll during thinking holds when the refusal lands (the phase trigger does not re-take the region)",
		userAt !== null && Math.abs(q37.scrollTop - userAt) <= 1 && q37.state === "alert",
		JSON.stringify({ userAt, finalScrollTop: q37.scrollTop, maxScroll: q37.maxScroll, hiddenBelowPx: q37.hiddenBelowPx }),
	);

	// ---- E: D11 on an ANSWERED long follow-up: one direction, stops at the target, no per-chunk pin, stays at settle ----
	await h.closePanel();
	await h.replaceComposer("/btw LONGANSWER: q38 long first");
	await h.enter();
	await h.awaitSettled("q38 long first");
	const resAns = await r5SampleAsk(cdp, h, "LONGANSWER: q38 long follow-up streams");
	await h.awaitSettled("q38 long follow-up streams");
	const gEnd = await r4Geo(cdp);
	const tops = resAns.tops;
	const monotone = tops.every((t, i) => i === 0 || t >= tops[i - 1] - 1);
	const reachedIdx = resAns.samples.findIndex((s) => Math.abs(s[1] - s[3]) <= 1);
	const afterReach = reachedIdx >= 0 ? [...new Set(resAns.samples.slice(reachedIdx).map((s) => s[1]))] : null;
	note("Q38 samples [ms, scrollTop, maxScroll, target, state]", JSON.stringify(resAns.samples));
	r2check(
		"Q38 D11 on an answered follow-up: scrollTop moves one way only, reaches the question's offset, then holds for every later chunk and through the settle (no per-chunk pin, no jump at settle)",
		monotone && reachedIdx >= 0 && afterReach.length === 1 && Math.abs(gEnd.scrollTop - gEnd.turnOffset) <= 1 && gEnd.answerStartVisible === true,
		JSON.stringify({ monotone, reachedAt: reachedIdx >= 0 ? resAns.samples[reachedIdx] : null, distinctAfterReach: afterReach, final: { scrollTop: gEnd.scrollTop, turnOffset: gEnd.turnOffset, maxScroll: gEnd.maxScroll } }),
	);
	// the reader scrolls mid-STREAM; the settle (a phase change) must not pull the region back
	let userAt2 = null;
	await clickAt(cdp, R4.FIELD);
	await h.type("LONGANSWER: q38c reader scrolls mid-stream");
	await h.enter();
	for (let i = 0; i < 300; i++) {
		const g = await r4Geo(cdp);
		const a = qaAnswerOf((await h.band()).panelText, "q38c reader scrolls mid-stream");
		if (g && (g.questionText ?? "").includes("q38c") && a.length > 20 && g.scrollTop > 50) {
			await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop -= 200`);
			userAt2 = (await r4Geo(cdp)).scrollTop;
			break;
		}
		await wait(50);
	}
	await h.awaitSettled("q38c reader scrolls mid-stream");
	await wait(500);
	const gUser = await r4Geo(cdp);
	r2check("Q38c D11 yields to a mid-stream hand scroll through the settle", userAt2 !== null && Math.abs(gUser.scrollTop - userAt2) <= 1, JSON.stringify({ userAt: userAt2, final: gUser.scrollTop }));
	await h.closePanel();

	// ---- F: stacked FRESH refusals (no answered turn) on a panel that overflows ----
	await h.replaceComposer("/btw TOOLCALL2: q39 fresh refusal one");
	await h.enter();
	await h.awaitSettled("q39 fresh refusal one");
	for (const q of ["TOOLCALL2: q39 fresh refusal two", "EMPTYANS: q39 fresh refusal three", "TOOLCALL2: q39 fresh refusal four"]) {
		const r = await r5SampleAsk(cdp, h, q);
		await h.awaitSettled(q.replace(/^[A-Z0-9]+: /, ""));
		const f = r.final;
		note(`Q39 ${q}`, JSON.stringify({ samples: r.samples, final: f }));
		r2check(`Q39 stacked fresh refusal '${q}': whole alert in view at rest, the backend's sentence alone`,
			f.hiddenBelowPx <= 0.5 && f.hiddenAbovePx <= 0.5 && !f.alertText.includes("Ask again here") && !f.alertText.includes(R5.CANT),
			JSON.stringify({ scrollTop: f.scrollTop, maxScroll: f.maxScroll, hiddenBelowPx: f.hiddenBelowPx, alert: f.alertText }));
	}
	await h.take("q39-stacked-fresh-refusals");
	return { tree: "qa5-clip", frames: [] };
}

/** Poll the transcript after an adopt; returns ms to the first paint of every needle. */
async function r5PollPaint(cdp, t0, needles, before, ms = 20000) {
	const at = {};
	let last = null;
	while (Date.now() - t0 < ms) {
		last = await readQaBand(cdp);
		for (const n of needles) if (at[n] === undefined && qaCount(last.transcriptText, n) > qaCount(before, n)) at[n] = Date.now() - t0;
		if (needles.every((n) => at[n] !== undefined)) break;
		await wait(50);
	}
	return { at, band: last };
}

async function r5Snapshot(sessionId) {
	const r = await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}`, { headers: r4auth() }).catch(() => null);
	return r ? { status: r.status, text: await r.text().catch(() => "") } : { status: null, text: "" };
}

async function r5LeaveAndReenter(cdp, sessionId, otherPath = "/chat") {
	await verb(cdp, "navigate", otherPath);
	await wait(1200);
	const away = await readQaBand(cdp);
	const t0 = Date.now();
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	return { t0, away };
}

async function sceneBtwR5Adopt(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R5 adopt session A", sessionId);
	const P = `qa5-${RUN_LABEL}`;
	const h = r5Harness(cdp, P);
	await cdp.evaluate(`(() => { window.__qaKeys = []; window.addEventListener("keydown", (e) => {
		if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
		window.__qaKeys.push({ prevented: e.defaultPrevented });
	}); return true; })()`);
	// seed turn
	await clickAt(cdp, R4.FIELD);
	await h.type("seed turn for the round-5 adopt scene");
	await h.enter();
	await h.awaitBand((b) => (b.transcriptText ?? "").includes(R4.TAIL), 300);
	await h.idle();

	// ==== Q40 adopt with the PANEL'S CONTROL =====================================
	const Q40 = "q40 adopted with the panel control";
	await h.replaceComposer(`/btw ${Q40}`);
	await h.enter();
	await h.awaitSettled(Q40);
	await h.awaitBand((b) => (b.panelButtons ?? []).find((x) => x.text.startsWith("Add to conversation"))?.disabled === false, 200);
	const before40 = (await h.band()).transcriptText;
	const hist0 = await r4History(sessionId);
	const snap0 = await r5Snapshot(sessionId);
	const ops0 = r4ops("adopt").length;
	const control = await qaAdoptControl(cdp);
	const t40 = Date.now();
	if (control) await qaPressPoint(cdp, control);
	let panelGoneAt = null;
	for (let i = 0; i < 200; i++) { if ((await h.band()).panel === null) { panelGoneAt = Date.now() - t40; break; } await wait(25); }
	const p40 = await r5PollPaint(cdp, t40, [Q40, R5.ANSWER_HEAD], before40);
	await wait(800);
	const hist1 = await r4History(sessionId);
	const snap1 = await r5Snapshot(sessionId);
	const adopt40 = r4ops("adopt").slice(ops0);
	note("Q40 wire", JSON.stringify({ adoptOps: adopt40.map((o) => ({ url: o.url.replace(/.*\/sessions\/[^/]+/, "…"), status: o.status })), history: [hist0.count, hist1.count], questionInHistory: [hist0.text.includes(Q40), hist1.text.includes(Q40)], questionInSnapshot: [snap0.text.includes(Q40), snap1.text.includes(Q40)], snapshotStatus: [snap0.status, snap1.status] }));
	r2check("Q40 control adopt: ONE adopt POST → 200 and the panel detaches", adopt40.length === 1 && adopt40[0].status === 200 && panelGoneAt !== null, JSON.stringify({ adoptOps: adopt40.map((o) => o.status), panelGoneMs: panelGoneAt }));
	r2check("Q40 control adopt: the question AND its answer paint in the transcript without leaving the pane", p40.at[Q40] !== undefined && p40.at[R5.ANSWER_HEAD] !== undefined && qaCount(p40.band.transcriptText, Q40) === 1, JSON.stringify({ paintedMs: p40.at, questionRows: qaCount(p40.band.transcriptText, Q40), answerHeads: [qaCount(before40, R5.ANSWER_HEAD), qaCount(p40.band.transcriptText, R5.ANSWER_HEAD)] }));
	r2check("Q40 control adopt: the daemon's record holds the exchange (history grew by 2 and carries the question; the snapshot carries it)", hist1.count === hist0.count + 2 && !hist0.text.includes(Q40) && hist1.text.includes(Q40) && snap1.text.includes(Q40), JSON.stringify({ history: [hist0.count, hist1.count], snapshot: [snap0.text.includes(Q40), snap1.text.includes(Q40)] }));
	await h.take("q40-control-adopt-painted-live");

	// ==== Q41 adopt a TWO-TURN exchange with the second ⌘+F =======================
	const Q41a = "q41 chord adopt first turn";
	const Q41b = "q41 chord adopt second turn";
	await h.replaceComposer(`/btw ${Q41a}`);
	await h.enter();
	await h.awaitSettled(Q41a);
	await h.ask(Q41b);
	await h.idle();
	await h.awaitBand((b) => (b.panelButtons ?? []).find((x) => x.text.startsWith("Add to conversation"))?.disabled === false, 200);
	const before41 = (await h.band()).transcriptText;
	const hist2 = await r4History(sessionId);
	const ops1 = r4ops("adopt").length;
	await clickAt(cdp, R4.FIELD);
	await h.cmdF();
	await wait(900);
	const first = await r3Read(cdp);
	const k1 = await cdp.evaluate("window.__qaKeys[window.__qaKeys.length - 1] ?? null");
	r2check("Q41 first ⌘+F: NO adopt request leaves; the confirm is shown; the panel stays", r4ops("adopt").length === ops1 && first.panelUp && first.alerts.includes(R4.CONFIRM), JSON.stringify({ adoptPosts: r4ops("adopt").length - ops1, alerts: first.alerts, key: k1 }));
	await h.take("q41-first-cmdf-confirm-only");
	const t41 = Date.now();
	await h.cmdF();
	let gone41 = null;
	for (let i = 0; i < 200; i++) { if ((await h.band()).panel === null) { gone41 = Date.now() - t41; break; } await wait(25); }
	const p41 = await r5PollPaint(cdp, t41, [Q41a, Q41b], before41);
	await wait(800);
	const hist3 = await r4History(sessionId);
	const adopt41 = r4ops("adopt").slice(ops1);
	r2check("Q41 second ⌘+F: ONE adopt POST → 200, panel detaches, BOTH turns paint live, once each", adopt41.length === 1 && adopt41[0].status === 200 && gone41 !== null && p41.at[Q41a] !== undefined && p41.at[Q41b] !== undefined && qaCount(p41.band.transcriptText, Q41a) === 1 && qaCount(p41.band.transcriptText, Q41b) === 1, JSON.stringify({ adoptOps: adopt41.map((o) => o.status), panelGoneMs: gone41, paintedMs: p41.at }));
	r2check("Q41 the daemon's record holds both turns (history +4)", hist3.count === hist2.count + 4 && hist3.text.includes(Q41a) && hist3.text.includes(Q41b), JSON.stringify({ history: [hist2.count, hist3.count] }));
	await h.take("q41-second-cmdf-adopted-painted-live");

	// ==== Q42 LEAVE and RE-ENTER ====================================================
	const { t0: tRe, away } = await r5LeaveAndReenter(cdp, sessionId, "/settings");
	const awayUrl = await cdp.evaluate("location.hash || location.pathname");
	const re = await r5PollPaint(cdp, tRe, [Q40, Q41a, Q41b], "", 20000);
	await wait(800);
	const reBand = await h.band();
	note("Q42 away from the conversation", JSON.stringify({ awayUrl, transcriptMounted: away.transcriptText !== null, transcriptHasQ40: qaCount(away.transcriptText, Q40) }));
	r2check("Q42 after LEAVING the conversation (/settings: its transcript unmounted) and re-entering, all three adopted questions are painted, once each", qaCount(away.transcriptText, Q40) === 0 && [Q40, Q41a, Q41b].every((q) => qaCount(reBand.transcriptText, q) === 1), JSON.stringify({ paintedMsAfterReentry: re.at, counts: [Q40, Q41a, Q41b].map((q) => qaCount(reBand.transcriptText, q)) }));
	await h.take("q42-after-reentering");

	// ==== Q43 adopt into an EMPTY conversation (session B), then hop A <-> B ========
	const createdB = await createBackendSession(join(SCRATCH, "btw-qa-workspace"));
	note("R5 adopt session B (empty conversation)", createdB.id);
	await verb(cdp, "navigate", `/chat/${createdB.id}`);
	await h.awaitBand((b) => b.fieldValue !== null, 80);
	await wait(600);
	const Q43 = "q43 adopted into an empty conversation";
	await h.replaceComposer(`/btw ${Q43}`);
	await h.enter();
	await h.awaitSettled(Q43);
	await h.awaitBand((b) => (b.panelButtons ?? []).find((x) => x.text.startsWith("Add to conversation"))?.disabled === false, 200);
	const histB0 = await r4History(createdB.id);
	const opsB = r4ops("adopt").length;
	const cB = await qaAdoptControl(cdp);
	const t43 = Date.now();
	if (cB) await qaPressPoint(cdp, cB);
	const p43 = await r5PollPaint(cdp, t43, [Q43, R5.ANSWER_HEAD], "");
	await wait(800);
	const histB1 = await r4History(createdB.id);
	{
		const raw = await qaSessionHistory(createdB.id);
		const find = (o, d = 0) => { if (!o || typeof o !== "object" || d > 4) return null; if (Array.isArray(o.entries)) return o.entries; for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; } return null; };
		note("Q43 session B entries after the adopt (role / kind / head)", JSON.stringify((find(raw.body) ?? []).map((e) => [e.role ?? e.kind ?? e.type ?? null, JSON.stringify(e.content ?? e.text ?? e).slice(0, 70)])));
		note("Q43 session B history count before the adopt", JSON.stringify(histB0.count));
	}
	r2check("Q43 adopt into an EMPTY conversation: 200, painted live, in the daemon's record", r4ops("adopt").slice(opsB).map((o) => o.status).join() === "200" && p43.at[Q43] !== undefined && histB1.count === histB0.count + 2 && histB1.text.includes(Q43), JSON.stringify({ paintedMs: p43.at, history: [histB0.count, histB1.count] }));
	await h.take("q43-empty-conversation-adopted");
	const { t0: tB } = await r5LeaveAndReenter(cdp, createdB.id, `/chat/${sessionId}`);
	const reB = await r5PollPaint(cdp, tB, [Q43], "", 20000);
	await wait(600);
	const bBand = await h.band();
	r2check("Q43b re-entering B from A: the adopted exchange is still there, once", qaCount(bBand.transcriptText, Q43) === 1, JSON.stringify({ paintedMsAfterReentry: reB.at, count: qaCount(bBand.transcriptText, Q43) }));
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	await h.awaitBand((b) => b.fieldValue !== null, 80);
	await wait(1500);
	const aBand = await h.band();
	r2check("Q43c back in A: A's adopted rows are intact and B's did not leak into A", [Q40, Q41a, Q41b].every((q) => qaCount(aBand.transcriptText, q) === 1) && qaCount(aBand.transcriptText, Q43) === 0, JSON.stringify({ counts: [Q40, Q41a, Q41b, Q43].map((q) => qaCount(aBand.transcriptText, q)) }));

	// ==== Q44 R6-5: the arm is withdrawn when a conversation turn starts =============
	const Q44 = "q44 armed then the conversation starts a turn";
	await h.replaceComposer(`/btw ${Q44}`);
	await h.enter();
	await h.awaitSettled(Q44);
	await h.idle();
	const ops44 = r4ops("adopt").length;
	await clickAt(cdp, R4.FIELD);
	await h.cmdF();
	await wait(600);
	const armed = (await r3Read(cdp)).alerts;
	const injected = await qaSubmitTurn(sessionId, "INJECTED TURN: the conversation works while the aside is armed");
	let withdrawn = null;
	for (let i = 0; i < 100; i++) { const r = await r3Read(cdp); if (!r.alerts.includes(R4.CONFIRM)) { withdrawn = r.alerts; break; } await wait(100); }
	await h.take("q44-confirm-withdrawn-while-conversation-works", "raw");
	await h.idle();
	await wait(800);
	await clickAt(cdp, R4.FIELD);
	await h.cmdF();
	await wait(900);
	const afterTurn = await r3Read(cdp);
	r2check("Q44 R6-5: arm, then a conversation turn starts → the confirm is withdrawn; after the turn, the next ⌘+F only confirms again (0 adopt POSTs)",
		armed.includes(R4.CONFIRM) && injected.status && injected.status < 300 && withdrawn !== null && afterTurn.panelUp && afterTurn.alerts.includes(R4.CONFIRM) && r4ops("adopt").length === ops44,
		JSON.stringify({ armed, injected: injected.status, alertsAfterTurnStart: withdrawn, alertsAfterNextPress: afterTurn.alerts, adoptPosts: r4ops("adopt").length - ops44 }));
	await h.cmdF();
	await h.awaitBand((b) => b.panel === null, 100);
	const p44 = await r5PollPaint(cdp, Date.now(), [Q44], "", 10000);
	r2check("Q44b the second press then adopts (one POST 200) and paints", r4ops("adopt").slice(ops44).map((o) => o.status).join() === "200" && qaCount(p44.band.transcriptText, Q44) === 1, JSON.stringify({ adoptOps: r4ops("adopt").slice(ops44).map((o) => o.status) }));
	return { tree: "qa5-adopt", frames: [] };
}

/** The newest turn's question block geometry, beyond r4Geo. */
function r5QGeo(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const last = region.lastElementChild;
		const q = last.querySelector(":scope > p");
		const quotes = q ? Array.from(q.querySelectorAll("span.border-l-2")) : [];
		const rd = (x) => Math.round(x * 10) / 10;
		const lineRows = (el) => { const r = document.createRange(); r.selectNodeContents(el); const rows = []; for (const x of r.getClientRects()) if (!rows.some((y) => Math.abs(y - x.top) < 2)) rows.push(x.top); return rows.length; };
		return {
			questionHeight: q ? rd(q.getBoundingClientRect().height) : null,
			quoteHeights: quotes.map((s) => rd(s.getBoundingClientRect().height)),
			quoteLines: quotes.map(lineRows),
			questionLines: q ? lineRows(q) - quotes.reduce((m, s) => m + lineRows(s), 0) : null,
			capPx: parseFloat(getComputedStyle(region).maxHeight),
		};
	})()`);
}

async function sceneBtwR5Cap(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R5 cap session", sessionId);
	const P = `qa5-${RUN_LABEL}`;
	const h = r5Harness(cdp, P);
	// A long transcript answer to quote from.
	await clickAt(cdp, R4.FIELD);
	await h.type("LONGANSWER seed for the quotes");
	await h.enter();
	await h.awaitBand((b) => (b.transcriptText ?? "").includes("stopping a run that is failing"), 400);
	await h.idle();
	const SHORT1 = "The retry budget is a per-provider allowance";
	const SHORT2 = "a 4xx spends nothing";
	const WRAP = "A dropped connection, a reset stream, a timeout before the first byte and an owner 5xx each spend one unit; a 4xx spends nothing, because the request itself was refused and sending it again would be refused again.";
	const LONGQ = "with a question long enough that it has to wrap onto more than one line in the panel, because the ceiling is said to count only a single question line and this checks what the edge does then";
	const cases = [
		{ id: "none", quotes: [], q: "q45 no quote" },
		{ id: "one", quotes: [SHORT1], q: "q45 one short quote" },
		{ id: "two", quotes: [SHORT1, SHORT2], q: "q45 two short quotes" },
		{ id: "wrapquote", quotes: [WRAP], q: "q45 one wrapping quote" },
		{ id: "wrapq", quotes: [], q: `q45 ${LONGQ}` },
		{ id: "wrapboth", quotes: [SHORT1], q: `q45 quote and ${LONGQ}` },
		{ id: "oneshort", quotes: [SHORT2], q: "q45 one" },
		{ id: "twoshort", quotes: [SHORT2, "LONG-END"], q: "q45 two" },
	].filter((c) => !process.env.QA_CAP_CASES || process.env.QA_CAP_CASES.split(",").includes(c.id));
	const KS = [1, 2, 3, 4, 5, 6, 7, 8, 9];
	const table = [];
	for (const c of cases) {
		for (const k of KS) {
			await h.replaceComposer("");
			const staged = [];
			for (const needle of c.quotes) staged.push(await r3StageQuote(cdp, needle));
			await h.replaceComposer("/btw");
			await h.enter();
			await h.awaitBand((b) => b.panel !== null, 60);
			const text = `PARAGRID${k}: ${c.q} k${k}`;
			await h.ask(text);
			await wait(300);
			const g = await r4Geo(cdp);
			const qg = await r5QGeo(cdp);
			const post = r4posts(`${c.q} k${k}`)[0] ?? null;
			const row = {
				case: c.id, k, staged: staged.map((s) => s.pressed), wireQuotes: ((post?.text ?? "").match(/<reply-to>/g) ?? []).length,
				quoteBlocks: g.questionQuoteBlocks, quoteLines: qg.quoteLines, questionLines: qg.questionLines, questionHeight: qg.questionHeight,
				cap: g.cap, clientHeight: g.clientHeight, answerTop: g.answerTopInRegion, lineHeight: g.answerLineHeight,
				rowsToEdge: g.rowsBetweenAnswerTopAndEdge, crossing: g.crossing, scrollTop: g.scrollTop,
			};
			table.push(row);
			if (k === 9 || (g.crossing.length && !table.slice(0, -1).some((r) => r.case === c.id && r.crossing.length))) await h.take(`q45-cap-${c.id}-k${k}`);
			await h.closePanel();
		}
		const rows = table.filter((r) => r.case === c.id);
		note(`Q45 ${c.id} sweep`, JSON.stringify(rows));
		const maxCut = Math.max(0, ...rows.flatMap((r) => r.crossing.map((x) => x.hiddenPx)));
		const edge = [...new Set(rows.map((r) => r.rowsToEdge))];
		r2check(
			`Q45 ${c.id}: no answer row is cut at the panel's edge for PARAGRID1..9 (edge at ${edge.join("/")} line boxes below the answer's top)`,
			rows.every((r) => r.crossing.length === 0) && rows.every((r) => r.quoteBlocks === c.quotes.length),
			JSON.stringify({ edgeLineBoxes: edge, maxHiddenPx: maxCut, cutKs: rows.filter((r) => r.crossing.length).map((r) => ({ k: r.k, crossing: r.crossing })), cap: rows[0].cap, answerTop: rows[0].answerTop, quoteLines: rows[0].quoteLines, questionLines: rows[0].questionLines }),
		);
	}
	return { tree: "qa5-cap", frames: [] };
}
