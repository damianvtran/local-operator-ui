
/* ===================================================================== *
 *        QA ROUND 4 (independent) — the /btw aside, delta 049974b5c..8ea341d36
 *
 * Appended to a COPY of scripts/renderer-driver.mjs (after rounds 1-3's helper
 * layer and scenes). The app's source is unmodified.
 *
 * The delta under test: U11's two refusal arms (+ the fresh-ask arm), Esc's real
 * cost, U16's two-press adopt chord, D11 (keep moving toward "question at top"),
 * D12 (paragraph gap = one answer line box), D14 short off-panel form, U12/U13
 * busy line, U14 quote rendering, U15 announcement stripping.
 *
 * WIRE READINGS come from the proxy's stats file (QA_PROXY_STATS): every aside
 * POST (status, continues, subscription), every DELETE/adopt on one aside, and
 * every aside_delta frame keyed to its stream's subscription.
 * ===================================================================== */

const R4 = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	UNANSWERED: "The model did not answer your aside in text",
	EMPTY: "The model answered your aside with no text at all",
	NO_LONGER: "This aside is no longer available",
	DECLINED: "Ask again here to keep this exchange, or press Esc to close the aside and discard it.",
	CANT_CONTINUE: "This aside can't continue. Press Esc to close it, which discards this exchange, then start a new one with /btw.",
	OLD_ESCAPE: "Close this aside and start a new one with /btw.",
	CONFIRM: "Press \u2318+F again to add the aside to the conversation. Once added, it stays there.",
	BUSY: "The aside is still answering. Press Enter again once the answer is in.",
	RETRY_HINT: "Your message is still in the composer",
	OFF_PANEL_DECLINED: "got no answer: The model didn't reply in text. Ask again.",
	EMPTY_COPY: "Type a question in the composer below",
};

const r4stats = () => r3stats();
const r4posts = (needle) => r3posts(needle);
const r4ops = (kind) => (r4stats().asideOps ?? []).filter((o) => !kind || o.kind === kind);
const r4auth = () => ({ authorization: `Bearer ${process.env.LOCAL_OPERATOR_DESKTOP_TOKEN}` });

/** GET one aside straight from the daemon (through the proxy), as the owner holds it. */
async function r4GetAside(sessionId, asideId) {
	const r = await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}/asides/${asideId}`, { headers: r4auth() }).catch(() => null);
	if (!r) return { status: null };
	const body = await r.json().catch(() => null);
	const data = body?.data ?? body?.result?.data ?? body;
	return {
		status: r.status,
		detail: body?.detail ?? null,
		turns: Array.isArray(data?.turns) ? data.turns.length : null,
		firstTurnHead: Array.isArray(data?.turns) ? JSON.stringify(data.turns[0]?.content ?? data.turns[0]).slice(0, 90) : null,
		complete: data?.complete ?? null,
		adoptable: data?.adoptable ?? null,
	};
}

/** Out-of-band DELETE — the daemon dropping an entry (eviction/expiry), marked as a probe on the wire. */
async function r4DropAside(sessionId, asideId) {
	const r = await fetch(`${BACKEND}/v1/desktop/sessions/${sessionId}/asides/${asideId}`, {
		method: "DELETE",
		headers: { ...r4auth(), "x-qa-probe": "1" },
	}).catch(() => null);
	return r ? { status: r.status, body: (await r.text().catch(() => "")).slice(0, 200) } : { status: null };
}

/** The session's durable message count and text, from the daemon. */
async function r4History(sessionId) {
	const h = await qaSessionHistory(sessionId);
	const text = JSON.stringify(h.body ?? "");
	const find = (o, d = 0) => {
		if (!o || typeof o !== "object" || d > 4) return null;
		if (Array.isArray(o.entries)) return o.entries;
		for (const v of Object.values(o)) { const r = find(v, d + 1); if (r) return r; }
		return null;
	};
	const list = find(h.body);
	return { status: h.status, count: Array.isArray(list) ? list.length : null, keys: h.body ? Object.keys(h.body) : null, text };
}


/** The NEWEST refusal on the panel against the exchange region's clip: is the whole sentence in view? */
function r4AlertClip(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const alerts = Array.from(region.querySelectorAll('[role="alert"]'));
		const a = alerts[alerts.length - 1];
		if (!a) return { alerts: 0 };
		const rr = region.getBoundingClientRect();
		const ar = a.getBoundingClientRect();
		const clip = rr.top + region.clientHeight;
		const rd = (x) => Math.round(x * 10) / 10;
		const rects = Array.from(a.getClientRects ? (() => { const r = document.createRange(); r.selectNodeContents(a); return r.getClientRects(); })() : []);
		const rows = [];
		for (const x of rects) { if (!rows.some((y) => Math.abs(y.top - x.top) < 2)) rows.push({ top: x.top, bottom: x.bottom }); }
		return {
			alerts: alerts.length,
			scrollTop: rd(region.scrollTop), maxScroll: region.scrollHeight - region.clientHeight, clientHeight: region.clientHeight,
			alertTopInRegion: rd(ar.top - rr.top), alertBottomInRegion: rd(ar.bottom - rr.top),
			hiddenBelowPx: rd(Math.max(0, ar.bottom - clip)),
			alertRows: rows.length, rowsFullyVisible: rows.filter((y) => y.bottom <= clip + 0.5).length,
			visibleText: (() => { const r = document.createRange(); r.selectNodeContents(a); return null; })(),
		};
	})()`);
}

/** Everything the round needs from the panel's exchange region, as the browser laid it out. */
function r4Geo(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const turns = Array.from(region.children);
		const last = turns[turns.length - 1] ?? null;
		const q = last ? last.querySelector(":scope > p") : null;
		const md = last ? last.querySelector(".lo-markdown") : null;
		const lines = [];
		if (md) {
			const walk = document.createTreeWalker(md, NodeFilter.SHOW_TEXT);
			let n = walk.nextNode();
			while (n) {
				if (n.nodeValue && n.nodeValue.trim()) {
					const range = document.createRange();
					range.selectNodeContents(n);
					const para = n.parentElement ? n.parentElement.closest("p") : null;
					const pIdx = para ? Array.from(md.querySelectorAll("p")).indexOf(para) : -1;
					for (const rc of range.getClientRects()) lines.push({ top: rc.top, bottom: rc.bottom, h: rc.height, p: pIdx });
				}
				n = walk.nextNode();
			}
		}
		// Merge rects on the same row (inline runs split one row into several rects).
		const rows = [];
		for (const l of lines.sort((a, b) => a.top - b.top)) {
			const row = rows.find((r) => Math.abs(r.top - l.top) < 2);
			if (row) { row.bottom = Math.max(row.bottom, l.bottom); } else rows.push({ ...l });
		}
		const cs = md ? getComputedStyle(md) : null;
		const lh = cs ? parseFloat(cs.lineHeight) : null;
		const ps = md ? Array.from(md.querySelectorAll("p")) : [];
		const clipBottom = rr.top + region.clientHeight;
		const crossing = rows.filter((r) => r.top < clipBottom - 0.5 && r.bottom > clipBottom + 0.5)
			.map((r) => ({ visiblePx: Math.round((clipBottom - r.top) * 10) / 10, hiddenPx: Math.round((r.bottom - clipBottom) * 10) / 10, p: r.p }));
		const firstRow = rows[0] ?? null;
		const qr = q ? q.getBoundingClientRect() : null;
		const lr = last ? last.getBoundingClientRect() : null;
		const mdr = md ? md.getBoundingClientRect() : null;
		const rd = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
		return {
			width: Math.round(rr.width),
			scrollTop: rd(region.scrollTop),
			clientHeight: region.clientHeight,
			scrollHeight: region.scrollHeight,
			maxScroll: region.scrollHeight - region.clientHeight,
			cap: getComputedStyle(region).maxHeight,
			turns: turns.length,
			turnOffset: lr ? rd(region.scrollTop + lr.top - rr.top) : null,
			questionTopInRegion: qr ? rd(qr.top - rr.top) : null,
			questionText: q ? q.textContent.replace(/\\s+/g, " ").trim() : null,
			questionHasMarkup: q ? q.textContent.includes("<reply-to>") : null,
			questionQuoteBlocks: q ? q.querySelectorAll("span.border-l-2").length : null,
			answerFontSize: cs ? cs.fontSize : null,
			answerLineHeight: lh,
			answerTopInRegion: mdr ? rd(mdr.top - rr.top) : null,
			firstAnswerRowInRegion: firstRow ? [rd(firstRow.top - rr.top), rd(firstRow.bottom - rr.top)] : null,
			answerStartVisible: firstRow ? firstRow.top >= rr.top - 0.5 && firstRow.bottom <= clipBottom + 0.5 : null,
			rowsBetweenAnswerTopAndEdge: mdr && lh ? rd((clipBottom - mdr.top) / lh) : null,
			paragraphs: ps.length,
			paragraphGapPx: ps.length > 1 ? rd(parseFloat(getComputedStyle(ps[1]).marginTop)) : null,
			mdClass: md ? md.className : null,
			rows: rows.length,
			fullyVisibleRows: rows.filter((r) => r.top >= rr.top - 0.5 && r.bottom <= clipBottom + 0.5).length,
			crossing,
		};
	})()`);
}

async function sceneBtwR4(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("R4 session", sessionId);
	const frames = [];
	const PREFIX = RUN_LABEL ? `qa4-${RUN_LABEL}` : "qa4";
	const take = async (label, mode = "raw") => {
		const frame = mode === "settled" ? await captureSettled(cdp, `${PREFIX}-${label}`) : await capture(cdp, `${PREFIX}-${label}`);
		frames.push({ ...frame, mode });
		note("frame", JSON.stringify({ label: frame.label, mode, ...frame.pixels }));
		return frame;
	};
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
	const alerts = async () => (await r3Read(cdp)).alerts;
	// A window-level BUBBLE listener runs after React's root listener, so it sees
	// whether the app called preventDefault on a ⌘+F — "is the chord swallowed".
	await cdp.evaluate(`(() => { window.__qaKeys = []; window.addEventListener("keydown", (e) => {
		if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
		const a = document.activeElement;
		window.__qaKeys.push({ prevented: e.defaultPrevented, target: a ? a.tagName.toLowerCase() + (a.getAttribute("aria-label") ? "[" + a.getAttribute("aria-label") + "]" : "") : null });
	}); return true; })()`);
	const lastKey = () => cdp.evaluate("window.__qaKeys[window.__qaKeys.length - 1] ?? null");

	// ---- S0: a thread turn (so adopt has a conversation to join) ---------------
	await clickAt(cdp, R4.FIELD);
	await type("seed turn for the round-4 scene");
	await enter();
	await awaitBand((b) => (b.transcriptText ?? "").includes(R4.TAIL), 300);
	await idle();

	// ==== Q24 U11 arm (iii): a FRESH ask the model declines — the sentence alone ====
	await replaceComposer("/btw TOOLCALL2: q24 fresh ask declined");
	await enter();
	await awaitSettled("q24 fresh ask declined");
	const freshAlerts = await alerts();
	const freshPost = r4posts("q24 fresh ask declined")[0] ?? null;
	r2check(
		"Q24 (iii) fresh ask declined (409 aside_unanswered): the backend's sentence ALONE — no 'Ask again here', no 'can't continue', no old escape clause",
		freshAlerts.length === 1 && freshAlerts[0].startsWith(R4.UNANSWERED) && !freshAlerts[0].includes(R4.DECLINED) && !freshAlerts[0].includes(R4.CANT_CONTINUE) && !freshAlerts[0].includes(R4.OLD_ESCAPE) && freshPost?.status === 409 && freshPost?.continues === null,
		JSON.stringify({ alerts: freshAlerts, wire: freshPost && { status: freshPost.status, continues: freshPost.continues, response: freshPost.response } }),
	);
	await wait(600);
	note("Q33 refusal vs the region's clip at frame 01", JSON.stringify(await r4AlertClip(cdp)));
	await take("01-q24-fresh-declined-sentence-alone", "settled");
	note("Q33 refusal vs the region's clip after the settled capture 01", JSON.stringify(await r4AlertClip(cdp)));
	await replaceComposer("/btw EMPTYANS: q24b fresh ask empty");
	await closePanel();
	await replaceComposer("/btw EMPTYANS: q24b fresh ask empty");
	await enter();
	await awaitSettled("q24b fresh ask empty");
	const freshEmpty = await alerts();
	const freshEmptyPost = r4posts("q24b fresh ask empty")[0] ?? null;
	r2check(
		"Q24b (iii) fresh ask, 409 aside_empty_answer: the backend's sentence alone",
		freshEmpty.length === 1 && freshEmpty[0].startsWith(R4.EMPTY) && !freshEmpty[0].includes(R4.DECLINED) && !freshEmpty[0].includes(R4.CANT_CONTINUE) && freshEmptyPost?.status === 409,
		JSON.stringify({ alerts: freshEmpty, wire: freshEmptyPost && { status: freshEmptyPost.status, response: freshEmptyPost.response } }),
	);
	await closePanel();

	// ==== Q25 U11 arm (i): the MODEL declines a FOLLOW-UP ============================
	await replaceComposer("/btw q25 first question, answered");
	await enter();
	const a1 = await awaitSettled("q25 first question, answered");
	const a1Id = a1.post?.asideId ?? null;
	for (const [marker, expect, label] of [
		["TOOLCALL2: q25 follow-up, tool call twice", R4.UNANSWERED, "aside_unanswered (tool call twice)"],
		["TOOLSILENT: q25 follow-up, call then silence", R4.UNANSWERED, "aside_unanswered (a call then silence)"],
		["EMPTYANS: q25 follow-up, empty answer", R4.EMPTY, "aside_empty_answer"],
	]) {
		const before = (await alerts()).length;
		await ask(marker);
		const al = await r4AwaitAlerts(cdp, before + 1);
		const post = r4posts(marker.split(": ")[1])[0] ?? null;
		const mine = al[al.length - 1] ?? "";
		r2check(
			`Q25 (i) ${label} on a CONTINUATION: backend sentence + '${R4.DECLINED}'`,
			mine.startsWith(expect) && mine.endsWith(R4.DECLINED) && !mine.includes(R4.CANT_CONTINUE) && post?.status === 409 && post?.continues === a1Id,
			JSON.stringify({ alert: mine, wire: post && { status: post.status, continues: post.continues, answeredId: a1Id, response: (post.response ?? "").slice(0, 160) } }),
		);
	}
	await wait(600);
	note("Q33 refusal vs the region's clip at frame 02", JSON.stringify(await r4AlertClip(cdp)));
	await take("02-q25-declined-follow-ups-both-options", "settled");
	note("Q33 refusal vs the region's clip after the settled capture 02", JSON.stringify(await r4AlertClip(cdp)));
	// The PROMISE: ask again here, and the exchange is kept.
	const Q25_AGAIN = "q25 asked again in the same panel after the declines";
	const again = await ask(Q25_AGAIN);
	const againPost = again.post;
	const againBand = await band();
	const ownerView = againPost?.asideId ? await r4GetAside(sessionId, againPost.asideId) : null;
	r2check(
		"Q25c asking again IN THE SAME PANEL is ANSWERED (200) and continues the last ANSWERED turn",
		againPost?.status === 200 && againPost?.continues === a1Id && qaAnswerOf(againBand.panelText, Q25_AGAIN).includes(R4.TAIL),
		JSON.stringify({ wire: againPost && { status: againPost.status, continues: againPost.continues, answeredId: a1Id } }),
	);
	r2check(
		"Q25d 'to keep this exchange' is TRUE: the owner's new entry holds the first answered Q/A as its prefix (4 turns, complete, adoptable); the panel still shows the first answer",
		ownerView?.status === 200 && ownerView.turns === 4 && (ownerView.firstTurnHead ?? "").includes("q25 first question") && ownerView.adoptable === true && qaCount(againBand.panelText, R4.TAIL) === 2,
		JSON.stringify({ owner: ownerView, tailsOnPanel: qaCount(againBand.panelText, R4.TAIL) }),
	);
	await take("03-q25-asked-again-answered-exchange-kept", "settled");

	// ==== Q26 Esc's real cost, on an exchange that HAS answers =======================
	const histBeforeEsc = await r4History(sessionId);
	const opsBefore = r4ops().length;
	await closePanel();
	await wait(800);
	const escOps = r4ops().slice(opsBefore);
	const afterEscOwner = againPost?.asideId ? await r4GetAside(sessionId, againPost.asideId) : null;
	const firstOwner = a1Id ? await r4GetAside(sessionId, a1Id) : null;
	const histAfterEsc = await r4History(sessionId);
	const escBand = await band();
	r2check(
		"Q26 Esc on an answered exchange: panel gone, ONE DELETE of the newest entry (200), the owner now answers 404 for it, NOTHING adopted (history unchanged, no adopt POST)",
		escBand.panel === null && escOps.length === 1 && escOps[0].method === "DELETE" && escOps[0].status === 200 && afterEscOwner?.status === 404 && histAfterEsc.count === histBeforeEsc.count && !histAfterEsc.text.includes(Q25_AGAIN),
		JSON.stringify({ ops: escOps.map((o) => ({ m: o.method, kind: o.kind, status: o.status })), newestAfterEsc: afterEscOwner, firstEntryAfterEsc: firstOwner, history: [histBeforeEsc.count, histAfterEsc.count] }),
	);
	await replaceComposer("/btw");
	await enter();
	const reopened = await awaitBand((b) => (b.panelText ?? "").includes(R4.EMPTY_COPY), 60);
	r2check(
		"Q26b re-opening with /btw does NOT bring the exchange back: the empty panel, no earlier question",
		(reopened.panelText ?? "").includes(R4.EMPTY_COPY) && qaCount(reopened.panelText, "q25 first question") === 0,
		JSON.stringify({ panel: (reopened.panelText ?? "").slice(0, 200) }),
	);
	await take("04-q26-after-esc-reopened-empty", "settled");

	// ==== Q27 U11 arm (ii): a refused CONTINUATION (the prefix is gone) ============
	const q27a = await ask("q27 first question, answered");
	const q27Id = q27a.post?.asideId ?? null;
	const dropped = await r4DropAside(sessionId, q27Id);
	note("Q27 out-of-band DELETE of the answered entry (the owner evicting/expiring it)", JSON.stringify(dropped));
	const Q27_CONT = "q27 follow-up after the owner lost the prefix";
	await ask(Q27_CONT);
	const contAl = await r4AwaitAlerts(cdp, 1);
	const contPost = r4posts(Q27_CONT)[0] ?? null;
	const contMine = contAl[contAl.length - 1] ?? "";
	r2check(
		"Q27 (ii) refused continuation (409 'This aside is no longer available'): sentence + the can't-continue clause naming Esc's cost; differs from (i) and offers NO 'Ask again here'",
		contPost?.status === 409 && contPost?.continues === q27Id && (contPost?.response ?? "").includes(R4.NO_LONGER) && contMine === `${R4.NO_LONGER} ${R4.CANT_CONTINUE}` && !contMine.includes(R4.DECLINED) && !contMine.toLowerCase().includes("ask again"),
		JSON.stringify({ alert: contMine, wire: contPost && { status: contPost.status, continues: contPost.continues, response: contPost.response } }),
	);
	await wait(600);
	note("Q33 refusal vs the region's clip at frame 05", JSON.stringify(await r4AlertClip(cdp)));
	await take("05-q27-continuation-refused-cant-continue", "settled");
	note("Q33 refusal vs the region's clip after the settled capture 05", JSON.stringify(await r4AlertClip(cdp)));
	// The copy says this exchange cannot continue: is that true? Ask again anyway.
	const Q27_RETRY = "q27 retry that the copy says cannot work";
	await ask(Q27_RETRY);
	const retryPost = r4posts(Q27_RETRY)[0] ?? null;
	const retryAl = await alerts();
	r2check(
		"Q27b the copy is honest: a retry in the same panel is refused the same way (409, same dead prefix) — so not offering one is correct",
		retryPost?.status === 409 && retryPost?.continues === q27Id && (retryAl[retryAl.length - 1] ?? "").includes(R4.CANT_CONTINUE),
		JSON.stringify({ wire: retryPost && { status: retryPost.status, continues: retryPost.continues }, lastAlert: retryAl[retryAl.length - 1] }),
	);
	await closePanel();
	await replaceComposer("/btw q27 a new aside after Esc");
	await enter();
	const q27new = await awaitSettled("q27 a new aside after Esc");
	r2check(
		"Q27c the way out the copy names works: Esc, then /btw <q> is a fresh ask, answered 200",
		q27new.post?.status === 200 && q27new.post?.continues === null,
		JSON.stringify(q27new.post && { status: q27new.post.status, continues: q27new.post.continues }),
	);

	// ==== Q28 U16: the adopt chord's two presses ====================================
	await idle();
	const q28Band0 = await band();
	const adoptBefore = r4ops("adopt").length;
	const hist0 = await r4History(sessionId);
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(900);
	const k1 = await lastKey();
	const b1 = await band();
	const r1 = await r3Read(cdp);
	const hist1 = await r4History(sessionId);
	r2check(
		"Q28 FIRST ⌘+F on an adoptable exchange: NO adopt request on the wire, history unchanged, panel still up, the confirm on the panel's notice line",
		r4ops("adopt").length === adoptBefore && hist1.count === hist0.count && b1.panel !== null && r1.alerts.some((a) => a === R4.CONFIRM),
		JSON.stringify({ adoptPosts: r4ops("adopt").length - adoptBefore, history: [hist0.count, hist1.count], alerts: r1.alerts, key: k1, adoptLive: q28Band0.panelButtons?.find((x) => x.text.startsWith("Add to conversation")) }),
	);
	await take("06-q28-first-cmdf-confirm-only", "settled");
	await cmdF();
	const b2 = await awaitBand((b) => b.panel === null, 100);
	await wait(1200);
	const k2 = await lastKey();
	const adoptOps = r4ops("adopt").slice(adoptBefore);
	const hist2 = await r4History(sessionId);
	const b2b = await band();
	r2check(
		"Q28b SECOND ⌘+F on the same newest turn adopts: ONE adopt POST (200), the panel closes, the exchange enters the durable history and is painted in the transcript",
		adoptOps.length === 1 && adoptOps[0].status === 200 && b2.panel === null && hist2.count > hist1.count && hist2.text.includes("q27 a new aside after Esc") && (b2b.transcriptText ?? "").includes("q27 a new aside after Esc"),
		JSON.stringify({ adopt: adoptOps.map((o) => ({ url: o.url.replace(/.*\/asides\//, "…/asides/"), status: o.status })), history: [hist1.count, hist2.count], historyStatus: hist2.status, historyKeys: hist2.keys, questionInHistory: hist2.text.includes("q27 a new aside after Esc"), key: k2 }),
	);
	await take("07-q28-second-cmdf-adopted", "settled");

	// arm on one turn, append a follow-up, then press: must ARM again (not adopt)
	await replaceComposer("/btw q28c first turn");
	await enter();
	await awaitSettled("q28c first turn");
	await idle();
	const adoptC = r4ops("adopt").length;
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(600);
	const armedC = (await r3Read(cdp)).alerts;
	await ask("q28c follow-up appended after the arm");
	await idle();
	const afterFollow = (await r3Read(cdp)).alerts;
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(1000);
	const b3 = await band();
	const r3c = await r3Read(cdp);
	r2check(
		"Q28c an arm does not carry over to a NEW turn: after a follow-up, the next ⌘+F only confirms again (no adopt POST, panel up)",
		armedC.includes(R4.CONFIRM) && !afterFollow.includes(R4.CONFIRM) && r4ops("adopt").length === adoptC && b3.panel !== null && r3c.alerts.includes(R4.CONFIRM),
		JSON.stringify({ confirmAfterFirst: armedC, noticeAfterFollowUpAsk: afterFollow, alertsAfterPress: r3c.alerts, adoptPosts: r4ops("adopt").length - adoptC }),
	);
	// arm, Esc, re-open a DIFFERENT aside: the first press there must only confirm
	await closePanel();
	await replaceComposer("/btw");
	await enter();
	await awaitBand((b) => (b.panelText ?? "").includes(R4.EMPTY_COPY), 60);
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(600);
	const emptyPress = await r3Read(cdp);
	const kEmpty = await lastKey();
	r2check(
		"Q28d re-opened EMPTY panel: ⌘+F does nothing (no confirm, no adopt POST, not swallowed)",
		!emptyPress.alerts.includes(R4.CONFIRM) && r4ops("adopt").length === adoptC && emptyPress.panelUp,
		JSON.stringify({ alerts: emptyPress.alerts, key: kEmpty }),
	);
	await ask("q28e first turn of a different aside");
	await idle();
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(1000);
	const b5 = await band();
	const r5 = await r3Read(cdp);
	r2check(
		"Q28e a different aside after re-opening: its first ⌘+F only confirms (the earlier arm did not carry over)",
		b5.panel !== null && r5.alerts.includes(R4.CONFIRM) && r4ops("adopt").length === adoptC,
		JSON.stringify({ alerts: r5.alerts, adoptPosts: r4ops("adopt").length - adoptC }),
	);
	await take("08-q28e-reopened-first-press-confirms-only", "settled");
	// Esc with the arm pending, re-open, and press ONCE: still no adopt.
	await closePanel();
	await replaceComposer("/btw q28f re-opened after an armed Esc");
	await enter();
	await awaitSettled("q28f re-opened after an armed Esc");
	await idle();
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(1000);
	const r6 = await r3Read(cdp);
	r2check(
		"Q28f after Esc with an arm pending and a re-open, one ⌘+F still cannot adopt",
		r6.panelUp && r6.alerts.includes(R4.CONFIRM) && r4ops("adopt").length === adoptC,
		JSON.stringify({ alerts: r6.alerts, adoptPosts: r4ops("adopt").length - adoptC }),
	);
	// ⌘+F elsewhere: focus on the exchange region (not the composer), and with no aside at all.
	await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').focus()`);
	await cmdF();
	await wait(500);
	const kRegion = await lastKey();
	const r7 = await r3Read(cdp);
	await closePanel();
	await clickAt(cdp, R4.FIELD);
	await cmdF();
	await wait(500);
	const kNoAside = await lastKey();
	const findUi = await cdp.evaluate(`(() => Array.from(document.querySelectorAll('input,[role="search"],[role="dialog"]')).filter((n) => n.offsetParent !== null).map((n) => (n.getAttribute("aria-label") || n.getAttribute("placeholder") || n.tagName)).slice(0, 8))()`);
	note("Q28g ⌘+F routing", JSON.stringify({ composerFirstPress: k1, composerSecondPress: k2, emptyPanel: kEmpty, focusOnExchangeRegion: kRegion, regionPressAdopted: r4ops("adopt").length !== adoptC, regionPressPanelUp: r7.panelUp, noAsideComposer: kNoAside, visibleSearchLikeUi: findUi }));
	r2check(
		"Q28g ⌘+F is swallowed (preventDefault) ONLY on the composer with an adoptable aside; with the focus elsewhere, or no aside, it falls through and nothing opens",
		k1?.prevented === true && k2?.prevented === true && kEmpty?.prevented === false && kRegion?.prevented === false && kNoAside?.prevented === false && r4ops("adopt").length === adoptC,
		JSON.stringify({ k1, k2, kEmpty, kRegion, kNoAside }),
	);

	// ==== Q29 D11: a follow-up under a long answer — the START of its answer in view ====
	await idle();
	await replaceComposer("/btw LONGANSWER: q29 first, a long answer");
	await enter();
	await awaitSettled("q29 first, a long answer");
	const d11before = await r4Geo(cdp);
	note("Q29 geometry after the long first answer", JSON.stringify(d11before));
	const D11Q = "LONGANSWER: q29 long follow-up under a long answer";
	await clickAt(cdp, R4.FIELD);
	await type(D11Q);
	await enter();
	const samples = [];
	for (let i = 0; i < 400; i++) {
		const g = await r4Geo(cdp);
		if (g && (g.questionText ?? "").includes("q29 long follow-up")) samples.push([g.scrollTop, g.turnOffset, g.questionTopInRegion, g.maxScroll]);
		const p = r4posts("q29 long follow-up")[0];
		if (p && p.status !== null && (await band()).panelAnnounce !== "Asking the aside") break;
		await wait(50);
	}
	await wait(400);
	const d11 = await r4Geo(cdp);
	const tops = samples.map((s) => s[0]);
	const monotone = tops.every((t, i) => i === 0 || t >= tops[i - 1] - 1);
	const neverPast = samples.every((s) => s[0] <= s[1] + 1);
	note("Q29 samples [scrollTop, turnOffset, questionTopInRegion, maxScroll] (first 12 / last 4)", JSON.stringify([samples.slice(0, 12), samples.slice(-4)]));
	r2check(
		"Q29 D11 settled: the follow-up's QUESTION is at the region's top (scrollTop == its offset ±1) and the START of its answer is in view",
		d11 !== null && Math.abs(d11.scrollTop - d11.turnOffset) <= 1 && Math.abs(d11.questionTopInRegion) <= 1 && d11.answerStartVisible === true,
		JSON.stringify({ scrollTop: d11.scrollTop, turnOffset: d11.turnOffset, questionTopInRegion: d11.questionTopInRegion, firstAnswerRowInRegion: d11.firstAnswerRowInRegion, clientHeight: d11.clientHeight, scrollHeight: d11.scrollHeight }),
	);
	r2check(
		"Q29b D11 movement: scrollTop only ever moved TOWARD the target (monotone) and never past the question",
		samples.length > 3 && monotone && neverPast,
		JSON.stringify({ samples: samples.length, distinctTops: [...new Set(tops)].length, monotone, neverPast }),
	);
	await take("09-q29-d11-long-follow-up-question-at-top", "settled");
	// user scrolls away mid-stream: the effect must stop re-applying
	const D11U = "LONGANSWER: q29c the reader scrolls away mid-stream";
	await clickAt(cdp, R4.FIELD);
	await type(D11U);
	await enter();
	let userAt = null;
	let userMethod = null;
	for (let i = 0; i < 300; i++) {
		const g = await r4Geo(cdp);
		const b = await band();
		const a = qaAnswerOf(b.panelText, "q29c the reader scrolls away mid-stream");
		if (g && (g.questionText ?? "").includes("q29c") && a.length > 20 && g.scrollTop > 50) {
			const box = await cdp.evaluate(`(() => { const r = document.querySelector('[aria-label="The aside exchange"]').getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) }; })()`);
			const pre = g.scrollTop;
			await cdp.send("Input.dispatchMouseEvent", { type: "mouseWheel", x: box.x, y: box.y, deltaX: 0, deltaY: -240 });
			await wait(300);
			const g2 = await r4Geo(cdp);
			if (Math.abs(g2.scrollTop - pre) > 1) { userMethod = "mouseWheel"; userAt = g2.scrollTop; }
			else {
				await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop -= 240`);
				userMethod = "scrollTop-=240 (wheel did not move it headless)";
				userAt = (await r4Geo(cdp)).scrollTop;
			}
			note("Q29c the reader scrolled", JSON.stringify({ from: pre, to: userAt, method: userMethod }));
			break;
		}
		await wait(50);
	}
	const after = [];
	for (let i = 0; i < 300; i++) {
		const g = await r4Geo(cdp);
		after.push(g.scrollTop);
		const p = r4posts("q29c the reader scrolls away")[0];
		if (p && p.status !== null && (await band()).panelAnnounce !== "Asking the aside") break;
		await wait(60);
	}
	await wait(300);
	const final = await r4Geo(cdp);
	r2check(
		"Q29c D11 respects the reader: after a user scroll mid-stream, the region stays where they put it for the rest of the stream",
		userAt !== null && after.every((t) => Math.abs(t - userAt) <= 1) && Math.abs(final.scrollTop - userAt) <= 1,
		JSON.stringify({ userAt, method: userMethod, distinctAfter: [...new Set(after)], final: final.scrollTop, samples: after.length }),
	);
	await take("10-q29c-d11-reader-scrolled-stays", "settled");
	// a SHORT follow-up under the long answer: clamp wins; the whole turn visible
	const D11S = "q29d short follow-up under a long answer";
	await ask(D11S);
	await wait(300);
	const d11s = await r4Geo(cdp);
	r2check(
		"Q29d a short follow-up under a long answer: clamped at maxScroll with its question and the start of its answer in view",
		Math.abs(d11s.scrollTop - Math.min(d11s.maxScroll, d11s.turnOffset)) <= 1 && d11s.questionTopInRegion >= -0.5 && d11s.answerStartVisible === true,
		JSON.stringify({ scrollTop: d11s.scrollTop, maxScroll: d11s.maxScroll, turnOffset: d11s.turnOffset, questionTopInRegion: d11s.questionTopInRegion, firstAnswerRowInRegion: d11s.firstAnswerRowInRegion }),
	);
	await take("11-q29d-d11-short-follow-up", "settled");
	await closePanel();

	// ==== Q30 D12: a paragraph break at the cap — is any row cut at the edge? ====
	const grid = [];
	for (const k of [1, 2, 3, 4, 5, 6, 7, 8, 9]) {
		await replaceComposer(`/btw PARAGRID${k}: q30 sweep`);
		await enter();
		await awaitSettled(`PARAGRID${k}: q30 sweep`);
		await wait(250);
		const g = await r4Geo(cdp);
		grid.push({ k, width: g.width, fontSize: g.answerFontSize, lineHeight: g.answerLineHeight, gap: g.paragraphGapPx, paragraphs: g.paragraphs, rowsToEdge: g.rowsBetweenAnswerTopAndEdge, fullyVisibleRows: g.fullyVisibleRows, rows: g.rows, crossing: g.crossing, clientHeight: g.clientHeight, answerTop: g.answerTopInRegion, mdClass: g.mdClass });
		if (k === 4) await take("12-q30-d12-paragraph-break-at-cap", "settled");
		await closePanel();
	}
	note("Q30 D12 sweep (k = sentences in the first paragraph)", JSON.stringify(grid));
	r2check(
		"Q30 D12: with a paragraph break inside the cap, NO row is cut at the region's edge for any first-paragraph length swept",
		grid.every((g) => g.crossing.length === 0) && grid.every((g) => g.paragraphs >= 3),
		JSON.stringify(grid.map((g) => ({ k: g.k, crossing: g.crossing, fullyVisibleRows: g.fullyVisibleRows }))),
	);
	r2check(
		"Q30b D12 arithmetic: the edge sits exactly 10.0 answer line boxes below the answer's top, and the paragraph gap equals one line box",
		grid.every((g) => Math.abs(g.rowsToEdge - 10) <= 0.05 && Math.abs(g.gap - g.lineHeight) <= 0.1 && (g.mdClass ?? "").includes("lo-markdown--row-grid")),
		JSON.stringify(grid.map((g) => ({ k: g.k, rowsToEdge: g.rowsToEdge, gap: g.gap, lineHeight: g.lineHeight }))),
	);
	// the same grid under D11: follow-up scrolled to question-at-top, is the edge still on a row boundary?
	await replaceComposer("/btw q30c first, a short answer");
	await enter();
	await awaitSettled("q30c first, a short answer");
	await ask("PARAGRID5: q30c follow-up under D11");
	await wait(300);
	const gD11 = await r4Geo(cdp);
	r2check(
		"Q30c D12 x D11: a follow-up with a paragraph break, scrolled by D11 — no row cut at the edge",
		gD11.crossing.length === 0,
		JSON.stringify({ scrollTop: gD11.scrollTop, maxScroll: gD11.maxScroll, questionTopInRegion: gD11.questionTopInRegion, rowsToEdge: gD11.rowsBetweenAnswerTopAndEdge, crossing: gD11.crossing }),
	);
	await closePanel();

	// ==== Q31 U12/U13 busy line, D14 off-panel short form, U14 quote, U15 announce ====
	await replaceComposer("/btw q31 first, answer streams");
	await enter();
	await awaitBand((b) => { const a = qaAnswerOf(b.panelText, "q31 first, answer streams"); return a.length > 0 && !a.includes(R4.TAIL); }, 100);
	await type("q31 composer door mid-answer");
	await enter();
	await wait(300);
	const busyComp = await r3Read(cdp);
	await replaceComposer("/btw q31 slash door mid-answer");
	await enter();
	await wait(300);
	const busySlash = await r3Read(cdp);
	const busySlashBand = await band();
	r2check(
		"Q31 U12/U13 both doors mid-answer: the busy sentence on the COMPOSER line (not the transcript), no 'send it again' hint appended, text kept, nothing sent",
		busyComp.value === "q31 composer door mid-answer" && busyComp.bandLines.includes(R4.BUSY) && busySlash.value === "/btw q31 slash door mid-answer" && busySlash.bandLines.includes(R4.BUSY) && !busySlash.bandLines.join(" ").includes(R4.RETRY_HINT) && qaCount(busySlashBand.transcriptText, R4.BUSY) === 0 && r4posts("q31 composer door").length === 0 && r4posts("q31 slash door").length === 0,
		JSON.stringify({ comp: { value: busyComp.value, band: busyComp.bandLines }, slash: { value: busySlash.value, band: busySlash.bandLines }, inTranscript: qaCount(busySlashBand.transcriptText, R4.BUSY) }),
	);
	await take("13-q31-busy-line-on-composer", "raw");
	await awaitSettled("q31 first, answer streams");
	await wait(300);
	const retired = await r3Read(cdp);
	const announced = (await band()).panelAnnounce;
	r2check(
		"Q31b the busy line retires the moment the answer settles; U15 the announcement has no markdown markers",
		!retired.bandLines.includes(R4.BUSY) && (announced ?? "").startsWith("The aside answered:") && !(announced ?? "").includes("**"),
		JSON.stringify({ band: retired.bandLines, announce: announced }),
	);
	await replaceComposer("");
	await closePanel();
	// D14: a refusal that lands after the panel closed -> the short off-panel form
	await replaceComposer("/btw");
	await enter();
	await awaitBand((b) => (b.panelText ?? "").includes(R4.EMPTY_COPY), 60);
	await clickAt(cdp, R4.FIELD);
	await type("TOOLCALL2: q31c refused after Esc");
	await enter();
	await wait(300);
	await escape();
	let offPanel = null;
	for (let i = 0; i < 200; i++) {
		const r = await r3Read(cdp);
		const hit = r.bandLines.find((l) => l.includes("got no answer"));
		if (hit) { offPanel = hit; break; }
		await wait(100);
	}
	r2check(
		"Q31c D14 off-panel short form: 'Your aside \"…\" got no answer: The model didn't reply in text. Ask again.' under 200 chars",
		offPanel !== null && offPanel.includes(R4.OFF_PANEL_DECLINED) && offPanel.length <= 200,
		JSON.stringify({ line: offPanel, length: offPanel?.length ?? null }),
	);
	await take("14-q31c-d14-off-panel-short-form", "raw");
	// U14: a staged quote reaches the panel rendered, not as <reply-to> markup
	await replaceComposer("");
	await idle();
	const quoted = await r3StageQuote(cdp, "Transport failures and owner");
	await replaceComposer("/btw");
	await enter();
	await awaitBand((b) => b.panel !== null, 60);
	await ask("q31d asked with a quote staged");
	const gq = await r4Geo(cdp);
	const qPost = r4posts("q31d asked with a quote staged")[0] ?? null;
	r2check(
		"Q31d U14: the wire carries <reply-to>, the panel's question paints a quote block and NO markup",
		(qPost?.text ?? "").includes("<reply-to>") && gq.questionHasMarkup === false && gq.questionQuoteBlocks === 1,
		JSON.stringify({ staged: quoted, wire: qPost?.text, panelQuestion: gq.questionText, quoteBlocks: gq.questionQuoteBlocks }),
	);
	await take("15-q31d-u14-quote-rendered", "settled");
	await closePanel();

	// ==== Q32 wire summary: subscription targeting across the whole scene ==========
	const st = r4stats();
	const opened = st.streams.filter((s) => s.subscriptionId).map((s) => s.subscriptionId);
	const postSubs = [...new Set(st.asidePosts.map((p) => p.subscriptionId))];
	const deltaSubs = Object.keys(st.deltasBySubscription);
	r2check(
		"Q32 every aside POST named a subscription this pane opened, and every aside_delta went to exactly that subscription",
		postSubs.every((s) => s && opened.includes(s)) && deltaSubs.every((s) => postSubs.includes(s)) && st.asideDeltaFrames > 0,
		JSON.stringify({ asidePosts: st.asidePosts.length, postSubs, deltaSubs, asideDeltaFrames: st.asideDeltaFrames, streamsOpened: opened.length, statuses: st.asidePosts.reduce((m, p) => ((m[p.status] = (m[p.status] ?? 0) + 1), m), {}) }),
	);
	r2FramesCheck(frames);
	return { tree: "qa4", frames };
}

/** Wait until the panel carries at least `n` alerts. */
async function r4AwaitAlerts(cdp, n, attempts = 200) {
	for (let i = 0; i < attempts; i++) {
		const a = (await r3Read(cdp)).alerts;
		if (a.length >= n) return a;
		await wait(100);
	}
	return (await r3Read(cdp)).alerts;
}

/** Round 3's scene at this head, with the constants the delta deliberately re-worded. */
async function sceneBtwR3AtR4(cdp) {
	R3.ESCAPE = R4.DECLINED;
	R3.BUSY = R4.BUSY;
	return sceneBtwR3(cdp);
}

/**
 * btw-r4-clip — focused repro for Q33: where the region rests when a FOLLOW-UP is refused.
 * Samples geometry every ~50 ms from the press until 2.5 s after the refusal lands.
 */
async function sceneBtwR4Clip(cdp) {
	const { sessionId } = await qaOpenSession(cdp);
	note("R4 clip session", sessionId);
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const type = async (t) => { await cdp.send("Input.insertText", { text: t }); await wait(150); };
	const band = () => readQaBand(cdp);
	const settled = async (needle) => {
		for (let i = 0; i < 400; i++) {
			const p = r4posts(needle)[0];
			const b = await band();
			if (p && p.status !== null && b.panelAnnounce !== "Asking the aside") return p;
			await wait(100);
		}
		return r4posts(needle)[0] ?? null;
	};
	const geo = () => cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const last = region.lastElementChild;
		const lr = last.getBoundingClientRect();
		const a = last.querySelector('[role="alert"]');
		const ar = a ? a.getBoundingClientRect() : null;
		const clip = rr.top + region.clientHeight;
		const rd = (x) => Math.round(x * 10) / 10;
		return [rd(region.scrollTop), region.scrollHeight - region.clientHeight, rd(region.scrollTop + lr.top - rr.top), last.textContent.includes("thinking") ? "thinking" : a ? "alert" : "other", ar ? rd(Math.max(0, ar.bottom - clip)) : null];
	})()`);
	await clickAt(cdp, R4.FIELD);
	await type("/btw q33 first question, answered");
	await enter();
	await settled("q33 first question, answered");
	for (const [label, q] of [["unanswered", "TOOLCALL2: q33 follow-up refused by the model"], ["answered-2", "q33 second answered question"], ["empty", "EMPTYANS: q33 follow-up empty answer"]]) {
		await clickAt(cdp, R4.FIELD);
		await type(q);
		const t0 = Date.now();
		await enter();
		const samples = [];
		let landedAt = null;
		for (let i = 0; i < 400; i++) {
			const g = await geo();
			if (g) samples.push([Date.now() - t0, ...g]);
			if (landedAt === null && g && (g[3] === "alert" || g[3] === "other")) landedAt = Date.now();
			if (landedAt !== null && Date.now() - landedAt > 2500) break;
			await wait(50);
		}
		const dedup = samples.filter((s, i) => i === 0 || JSON.stringify(s.slice(1)) !== JSON.stringify(samples[i - 1].slice(1)));
		note(`Q33 ${label}: [ms, scrollTop, maxScroll, newest turn offset (the question-at-top target), state, alert px hidden below the clip]`, JSON.stringify(dedup));
		const final = samples[samples.length - 1];
		if (label !== "answered-2") {
			r2check(
				`Q33 ${label}: after the refusal lands the region reaches D11's target (question at top, or maxScroll) and the whole refusal is in view`,
				final && final[5] === 0 && Math.abs(final[1] - Math.min(final[2], final[3])) <= 1,
				JSON.stringify({ final: { scrollTop: final[1], maxScroll: final[2], target: final[3], alertHiddenPx: final[5] } }),
			);
			await captureSettled(cdp, `qa4-${RUN_LABEL}-q33-${label}-refusal-at-rest`);
		}
		await settled(q.replace(/^[A-Z0-9]+: /, ""));
	}
	return { tree: "qa4-clip", frames: [] };
}
