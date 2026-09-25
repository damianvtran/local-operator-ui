
/* ===================================================================== *
 *        QA ROUND 6 (independent) — the /btw aside, delta ba98e4fdc..f105c9953
 *
 * Appended after rounds 1-5's helper layer and scenes, to a COPY of
 * scripts/renderer-driver.mjs. The app's source is unmodified.
 *
 * The delta under test: the U17-U21 follow-up batch (Esc's real discard on the
 * wire, the cap derived from the question's MEASURED box, the adopt floor, the
 * refusal copy reading once, the move's late-growth trigger), the R7 pins, and
 * the fold onto main deb1422f5.
 *
 *  btw-r6      U19 on the wire (refused follow-up / answered / fresh / adopted),
 *              U17's floor and its two-sided boundary, U18's copy, U21's late
 *              growth in the flow, bare /btw, and the wire counters.
 *  btw-r6-cap  U20/Q46: the edge in line boxes for a wrapping quote and a
 *              multi-line question, at the width this pass was launched with.
 *
 * WIRE READINGS come from the proxy's stats file (QA_PROXY_STATS): every aside
 * POST (status, request id, the prefix it continues), every non-GET call on one
 * aside (DELETE = close, adopt) with its status, and every aside_delta frame
 * keyed to its stream's subscription.
 * ===================================================================== */

const R6 = {
	DISCARD: "or press Esc to close the aside and discard it",
	DECLINED:
		"Ask again here to keep this exchange, or press Esc to close the aside and discard it.",
	CANT: "This aside can't continue.",
	NO_LONGER: "This aside is no longer available",
	EMPTY_COPY: "Type a question in the composer below",
	CONFIRM: "Press \u2318+F again to add the aside to the conversation.",
	ANSWER_HEAD: "Transport failures and owner",
};

/**
 * The proxy's counters, read with retries.
 *
 * THE FILE IS REWRITTEN ON EVERY REQUEST, so a read can catch it mid-write: a parse
 * failure returns the round-4 helper's empty fallback, which reads as "this pass made
 * no asks" and silently voids a wire reading (measured in this round's first pass: a
 * close op's `status` came back null because the file was mid-write when it was read).
 */
function r6stats() {
	for (let attempt = 0; attempt < 400; attempt += 1) {
		try {
			const parsed = JSON.parse(readFileSync(process.env.QA_PROXY_STATS, "utf8"));
			if (parsed && Array.isArray(parsed.asidePosts) && Array.isArray(parsed.asideOps)) return parsed;
		} catch {
			/* mid-write: try again */
		}
	}
	return { asidePosts: [], asideOps: [], streams: [], asideDeltaFrames: 0 };
}
/** Every aside POST this pass has made, in order — or those whose text carries `needle`. */
const r6posts = (needle = "") =>
	(r6stats().asidePosts ?? []).filter((p) =>
		String(p.text ?? p.questionHead ?? "").includes(needle),
	);
/** Every non-GET call on one aside, by kind (`close`, `adopt`). */
const r6ops = (kind) => (r6stats().asideOps ?? []).filter((o) => !kind || o.kind === kind);
/** Wait for the newest op of `kind` to carry the response's status (the app does not await it). */
async function r6AwaitOpStatus(kind, index, ms = 6000) {
	const until = Date.now() + ms;
	let last = null;
	while (Date.now() < until) {
		last = r6ops(kind)[index] ?? null;
		if (last && last.status !== null) return last;
		await wait(100);
	}
	return last;
}
/** The id a close/adopt call named, read off the request URL. */
function r6IdOf(url) {
	const m = /\/asides\/([^/?]+)(?:\/adopt)?$/.exec(url ?? "");
	return m ? m[1] : null;
}
/** GET every id this pass has asked under, so "nothing else was destroyed" is a reading. */
async function r6Probe(sessionId, ids) {
	const out = {};
	for (const id of ids) {
		if (!id) continue;
		const g = await r4GetAside(sessionId, id);
		out[id] = { status: g.status, turns: g.turns, complete: g.complete };
	}
	return out;
}
/** The panel's own close control (the second door the copy names). */
function r6CloseControl(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		if (!panel) return null;
		const b = panel.querySelector('button[aria-label="Close the aside"]');
		if (!b) return null;
		const r = b.getBoundingClientRect();
		return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), disabled: b.disabled };
	})()`);
}
async function r6CloseByControl(cdp, h) {
	const c = await r6CloseControl(cdp);
	if (!c) return null;
	await qaPressPoint(cdp, c);
	await h.awaitBand((b) => b.panel === null, 60);
	await wait(300);
	return c;
}
/**
 * One close case, read end to end on the wire: the ops before the door was used,
 * the DELETE the door produced, and every entry's status before and after.
 */
async function r6CloseCase(cdp, h, sessionId, { id, label, door, expectId, expectStatus, expectGet }) {
	const opsBefore = r6ops("close").length;
	const probeBefore = await r6Probe(sessionId, r6posts().map((p) => p.asideId));
	if (door === "control") await r6CloseByControl(cdp, h);
	else await h.closePanel();
	const last = await r6AwaitOpStatus("close", opsBefore);
	const close = r6ops("close").slice(opsBefore);
	const named = last ? r6IdOf(last.url) : null;
	const probeAfter = await r6Probe(sessionId, r6posts().map((p) => p.asideId));
	note(
		`${id} ${label} — the door, on the wire`,
		JSON.stringify({
			door: door === "control" ? 'the panel\'s "Close the aside" control' : "Escape in the composer",
			closeOps: close.map((o) => ({ method: o.method, url: o.url, named, status: o.status })),
			namedId: named,
			expectedId: expectId,
			namedTheExpectedEntry: named === expectId,
			probeBefore,
			probeAfter,
			entryGoneAfter: probeAfter[expectId]?.status === 404,
			panelGone: (await h.band()).panel === null,
		}),
	);
	r2check(
		`${id} ${label}: the close names the entry that holds the exchange (${String(expectId).slice(0, 8)}), answers ${expectStatus}, and that entry is gone (GET ${expectGet})`,
		close.length === 1 &&
			last.method === "DELETE" &&
			named === expectId &&
			last.status === expectStatus &&
			probeAfter[expectId]?.status === 404 &&
			(await h.band()).panel === null,
		JSON.stringify({
			closeOps: close.map((o) => ({ method: o.method, named, status: o.status })),
			expectedId: expectId,
			named,
			probeBefore: probeBefore[expectId] ?? null,
			probeAfter: probeAfter[expectId] ?? null,
			alertStillOnScreenBeforeTheDoor: null,
		}),
	);
	return { close, named, probeBefore, probeAfter };
}

/* ------------------------------------------------------------------ *
 *  A — U19 ON THE WIRE
 * ------------------------------------------------------------------ */

async function r6CaseA19(cdp, h, sessionId) {
	/* A1: a REFUSED follow-up, closed with Escape — the case UX round 3 drove:
	 * the refused turn's own id was asked to DELETE and answered 404 while the
	 * entry holding the exchange stayed 200. */
	await h.replaceComposer("/btw q47 answered base");
	await h.enter();
	await h.awaitSettled("q47 answered base");
	const base47 = r6posts("q47 answered base")[0];
	await h.ask("TOOLCALL2: q47 refused follow-up");
	await h.awaitSettled("q47 refused follow-up");
	const refused47 = r6posts("q47 refused follow-up")[0];
	const pre47 = await r6Probe(sessionId, [base47?.asideId, refused47?.asideId]);
	note(
		"Q47 the refused follow-up, as the owner holds it BEFORE the door",
		JSON.stringify({
			base: { id: base47?.asideId, status: base47?.status },
			refused: { id: refused47?.asideId, status: refused47?.status, response: (refused47?.response ?? "").slice(0, 160) },
			entryHoldingTheExchange: { id: base47?.asideId, get: pre47[base47?.asideId] ?? null },
			refusedTurnsOwnId: { id: refused47?.asideId, get: pre47[refused47?.asideId] ?? null },
		}),
	);
	r2check(
		"Q47 the repro state exists: the refused turn's own id is NOT an entry (GET 404) while the entry that holds the exchange answers 200 with its turns",
		pre47[refused47?.asideId]?.status === 404 &&
			pre47[base47?.asideId]?.status === 200 &&
			refused47?.status === 409,
		JSON.stringify({ refusedTurnId: refused47?.asideId, holdingEntryId: base47?.asideId, pre47, postStatus: refused47?.status }),
	);
	const copyOnScreen = (await h.band()).panelText ?? "";
	r2check(
		"Q47 the copy that sends the user to Escape is the one on screen (so the promise under test is the app's own words)",
		copyOnScreen.includes("No answer was produced") && copyOnScreen.includes(R6.DISCARD),
		JSON.stringify({ tail: copyOnScreen.slice(-200) }),
	);
	await h.take("q47-refused-follow-up-before-esc");
	await r6CloseCase(cdp, h, sessionId, {
		id: "Q47",
		label: "refused follow-up, Escape",
		door: "escape",
		expectId: base47?.asideId,
		expectStatus: 200,
		expectGet: 404,
	});

	/* A2: the same refused case, closed with the panel's own close control. */
	await h.replaceComposer("/btw q49 answered base");
	await h.enter();
	await h.awaitSettled("q49 answered base");
	const base49 = r6posts("q49 answered base")[0];
	await h.ask("TOOLCALL2: q49 refused follow-up");
	await h.awaitSettled("q49 refused follow-up");
	const refused49 = r6posts("q49 refused follow-up")[0];
	const pre49 = await r6Probe(sessionId, [base49?.asideId, refused49?.asideId]);
	note("Q48 the repro state (control door)", JSON.stringify({ base: base49?.asideId, refused: refused49?.asideId, pre49 }));
	r2check(
		"Q48 the same repro state before the control door: the refused turn's id is not an entry, the holding entry is 200",
		pre49[refused49?.asideId]?.status === 404 && pre49[base49?.asideId]?.status === 200,
		JSON.stringify(pre49),
	);
	await r6CloseCase(cdp, h, sessionId, {
		id: "Q48",
		label: "refused follow-up, the close control",
		door: "control",
		expectId: base49?.asideId,
		expectStatus: 200,
		expectGet: 404,
	});

	/* A3: an ANSWERED follow-up — the newest answered turn IS the entry that holds
	 * the continuation, and the prefix must not be named instead. */
	await h.replaceComposer("/btw q50 answered base");
	await h.enter();
	await h.awaitSettled("q50 answered base");
	const base50 = r6posts("q50 answered base")[0];
	await h.ask("q50 answered follow-up");
	await h.awaitSettled("q50 answered follow-up");
	const second50 = r6posts("q50 answered follow-up")[0];
	const pre50 = await r6Probe(sessionId, [base50?.asideId, second50?.asideId]);
	note(
		"Q50 the answered continuation, before the door",
		JSON.stringify({
			base: { id: base50?.asideId, get: pre50[base50?.asideId] ?? null },
			continuation: { id: second50?.asideId, continues: second50?.continues, status: second50?.status, get: pre50[second50?.asideId] ?? null },
		}),
	);
	await r6CloseCase(cdp, h, sessionId, {
		id: "Q50",
		label: "answered follow-up, Escape",
		door: "escape",
		expectId: second50?.asideId,
		expectStatus: 200,
		expectGet: 404,
	});

	/* A4: a FRESH ask (its own id is the entry), closed with the control. */
	await h.replaceComposer("/btw q51 fresh ask");
	await h.enter();
	await h.awaitSettled("q51 fresh ask");
	const fresh51 = r6posts("q51 fresh ask")[0];
	const pre51 = await r6Probe(sessionId, [fresh51?.asideId]);
	r2check(
		"Q51 a fresh ask's own id IS the entry the owner holds (GET 200 with its turns)",
		pre51[fresh51?.asideId]?.status === 200 && pre51[fresh51?.asideId]?.turns === 2,
		JSON.stringify({ id: fresh51?.asideId, get: pre51[fresh51?.asideId] ?? null }),
	);
	await r6CloseCase(cdp, h, sessionId, {
		id: "Q51",
		label: "fresh ask, the close control",
		door: "control",
		expectId: fresh51?.asideId,
		expectStatus: 200,
		expectGet: 404,
	});

	/* A5: the fallback arm — a FRESH ask the model refused. Nothing in the panel
	 * was answered, so the newest turn's id is the only id there is; the owner
	 * dropped it with the refusal, so the DELETE is the documented silent 404. */
	await h.replaceComposer("/btw TOOLCALL2: q52 fresh refused ask");
	await h.enter();
	await h.awaitSettled("q52 fresh refused ask");
	const freshRefused52 = r6posts("q52 fresh refused ask")[0];
	const idsBefore52 = r6posts().map((p) => p.asideId);
	const probeBefore52 = await r6Probe(sessionId, idsBefore52);
	const opsBefore52 = r6ops("close").length;
	await h.closePanel();
	/* The app does not await the DELETE, so its status is read AFTER it lands — the
	 * first read of this round caught the file mid-flight and reported null. */
	const last52 = await r6AwaitOpStatus("close", opsBefore52);
	const close52 = r6ops("close").slice(opsBefore52);
	const named52 = last52 ? r6IdOf(last52.url) : null;
	const status52 = last52 ? last52.status : null;
	const probeAfter52 = await r6Probe(sessionId, idsBefore52);
	note(
		"Q52 a fresh refused ask, closed",
		JSON.stringify({
			refusedId: freshRefused52?.asideId,
			postStatus: freshRefused52?.status,
			closeOps: close52.map((o) => ({ method: o.method, named: r6IdOf(o.url), status: o.status })),
			named: named52,
			status: status52,
			probeBefore: probeBefore52,
			probeAfter: probeAfter52,
		}),
	);
	const destroyed52 = idsBefore52.filter(
		(id) => probeBefore52[id]?.status === 200 && probeAfter52[id]?.status !== 200,
	);
	r2check(
		"Q52 the fallback arm: the close names the refused turn's own id, and its 404 is the silent no-op it is documented as — nothing else in this session was destroyed",
		close52.length === 1 &&
			named52 === freshRefused52?.asideId &&
			status52 === 404 &&
			destroyed52.length === 0,
		JSON.stringify({ named: named52, refusedId: freshRefused52?.asideId, status: status52, destroyed: destroyed52 }),
	);

	/* A6: an ADOPTED exchange — adopting must not put the spliced turns at risk
	 * from a later close. */
	await h.replaceComposer("/btw q53 adopted base");
	await h.enter();
	await h.awaitSettled("q53 adopted base");
	const adopted53 = r6posts("q53 adopted base")[0];
	await h.awaitBand(
		(b) => (b.panelButtons ?? []).find((x) => x.text.startsWith("Add to conversation"))?.disabled === false,
		200,
	);
	const histBefore53 = await r4History(sessionId);
	const getAdoptedBefore = await r6Probe(sessionId, [adopted53?.asideId]);
	const opsAdopt0 = r6ops("adopt").length;
	const control53 = await qaAdoptControl(cdp);
	if (control53) await qaPressPoint(cdp, control53);
	let goneAt53 = null;
	for (let i = 0; i < 200; i++) {
		if ((await h.band()).panel === null) { goneAt53 = true; break; }
		await wait(25);
	}
	await wait(900);
	const histAfter53 = await r4History(sessionId);
	const getAdoptedAfter = await r6Probe(sessionId, [adopted53?.asideId]);
	const band53 = await h.band();
	r2check(
		"Q53 the adopt lands: one adopt POST → 200, the panel detaches, the daemon's history grew by 2 and carries the question",
		r6ops("adopt").slice(opsAdopt0).length === 1 &&
			r6ops("adopt").slice(opsAdopt0)[0].status === 200 &&
			goneAt53 === true &&
			histAfter53.count === histBefore53.count + 2 &&
			histAfter53.text.includes("q53 adopted base") &&
			qaCount(band53.transcriptText, "q53 adopted base") === 1,
		JSON.stringify({
			adopt: r6ops("adopt").slice(opsAdopt0).map((o) => ({ named: r6IdOf(o.url), status: o.status })),
			history: [histBefore53.count, histAfter53.count],
			transcriptRows: qaCount(band53.transcriptText, "q53 adopted base"),
		}),
	);
	/* Escape with NO panel up: no close call may leave, and the adopted entry may
	 * not be touched by it. */
	await clickAt(cdp, R4.FIELD);
	await h.escape();
	await wait(400);
	const strayClose = r6ops("close").slice(
		r6ops("close").findIndex((o) => o.url.endsWith(String(r6IdOf(o.url)))) + 1,
	);
	const opsCloseBefore = r6ops("close").length;
	await clickAt(cdp, R4.FIELD);
	await h.escape();
	await wait(400);
	const getAdoptedAfterEsc = await r6Probe(sessionId, [adopted53?.asideId]);
	r2check(
		"Q53b Escape with no panel up leaves no close call and does not touch the adopted entry",
		r6ops("close").length === opsCloseBefore &&
			JSON.stringify(getAdoptedAfterEsc) === JSON.stringify(getAdoptedAfter),
		JSON.stringify({ closeOps: r6ops("close").length - opsCloseBefore, before: getAdoptedAfter, after: getAdoptedAfterEsc, strayClose: strayClose.length }),
	);
	/* A later aside, closed — it must name its OWN entry, and the adopted one must
	 * be exactly as it was. */
	await h.replaceComposer("/btw q54 later aside");
	await h.enter();
	await h.awaitSettled("q54 later aside");
	const later54 = r6posts("q54 later aside")[0];
	const probeBefore54 = await r6Probe(sessionId, [adopted53?.asideId, later54?.asideId]);
	await r6CloseCase(cdp, h, sessionId, {
		id: "Q54",
		label: "a later aside closed after an adopt",
		door: "control",
		expectId: later54?.asideId,
		expectStatus: 200,
		expectGet: 404,
	});
	const probeAfter54 = await r6Probe(sessionId, [adopted53?.asideId]);
	const histEnd53 = await r4History(sessionId);
	r2check(
		"Q54 closing the later aside does NOT delete what the adopt spliced into the conversation (the adopted entry is unchanged and the transcript still carries the question once)",
		JSON.stringify(probeAfter54) === JSON.stringify({ [adopted53?.asideId]: probeBefore54[adopted53?.asideId] }) &&
			histEnd53.text.includes("q53 adopted base") &&
			qaCount((await h.band()).transcriptText, "q53 adopted base") === 1,
		JSON.stringify({ adoptedEntryBefore: probeBefore54[adopted53?.asideId] ?? null, adoptedEntryAfter: probeAfter54[adopted53?.asideId] ?? null, transcriptRows: qaCount((await h.band()).transcriptText, "q53 adopted base") }),
	);
	await h.take("q53-adopt-then-a-later-close");
}

/* ------------------------------------------------------------------ *
 *  B — U17's floor, both sides of the boundary
 * ------------------------------------------------------------------ */

async function r6CaseB17(cdp, h) {
	await h.replaceComposer("/btw q55 the floor's exchange");
	await h.enter();
	await h.awaitSettled("q55 the floor's exchange");
	await h.awaitBand(
		(b) => (b.panelButtons ?? []).find((x) => x.text.startsWith("Add to conversation"))?.disabled === false,
		200,
	);
	await cdp.evaluate(`(() => { window.__qa6Keys = []; window.addEventListener("keydown", (e) => {
		if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
		window.__qa6Keys.push({ at: Date.now(), prevented: e.defaultPrevented, phase: document.querySelector('[data-lo-aside-panel]') ? "armed" : "no-panel" });
	}); return true; })()`);
	const ops0 = r6ops("adopt").length;
	/* the reflex pair: the two presses UX round 3 measured at 66 ms apart */
	await clickAt(cdp, R4.FIELD);
	await h.cmdF();
	await wait(60);
	await h.cmdF();
	const keysAfterPair = await cdp.evaluate("window.__qa6Keys");
	const gap = keysAfterPair.length >= 2 ? keysAfterPair[1].at - keysAfterPair[0].at : null;
	await wait(900);
	const afterPair = await r3Read(cdp);
	const opsAfterPair = r6ops("adopt").length - ops0;
	note(
		"Q55 the reflex pair (⌘+F twice, ~66 ms apart)",
		JSON.stringify({ keydowns: keysAfterPair, measuredGapMs: gap, adoptPosts: opsAfterPair, panelUp: afterPair.panelUp, alerts: afterPair.alerts }),
	);
	r2check(
		`Q55 U17: a ⌘+F pair ${gap} ms apart leaves NO adopt request, the panel stays and the confirm is still up`,
		opsAfterPair === 0 && afterPair.panelUp && afterPair.alerts.includes(R4.CONFIRM),
		JSON.stringify({ measuredGapMs: gap, adoptPosts: opsAfterPair, panelUp: afterPair.panelUp, alerts: afterPair.alerts }),
	);
	await h.take("q55-reflex-pair-no-adopt");
	/* a third press after a read: the same arm, and now it adopts */
	const t55 = Date.now();
	await h.cmdF();
	let gone55 = null;
	for (let i = 0; i < 200; i++) {
		if ((await h.band()).panel === null) { gone55 = Date.now() - t55; break; }
		await wait(25);
	}
	await wait(600);
	const opsEnd = r6ops("adopt").slice(ops0);
	const keysEnd = await cdp.evaluate("window.__qa6Keys");
	const thirdGap = keysEnd.length >= 3 ? keysEnd[2].at - keysEnd[1].at : null;
	r2check(
		`Q55b U17: a deliberate third press ${thirdGap} ms after the ignored one adopts (ONE adopt POST → 200, the panel detaches)`,
		opsEnd.length === 1 && opsEnd[0].status === 200 && gone55 !== null && thirdGap > 400,
		JSON.stringify({ measuredGapMs: thirdGap, adoptOps: opsEnd.map((o) => o.status), panelGoneMs: gone55, keydowns: keysEnd }),
	);
}

/* ------------------------------------------------------------------ *
 *  C — U18's copy, and U11's two arms
 * ------------------------------------------------------------------ */

async function r6CaseC18(cdp, h, sessionId) {
	await h.replaceComposer("/btw q56 the copy's exchange");
	await h.enter();
	await h.awaitSettled("q56 the copy's exchange");
	await h.ask("TOOLCALL2: q56 declined follow-up");
	await h.awaitSettled("q56 declined follow-up");
	await wait(400);
	const band = await h.band();
	const alerted = await r5Clip(cdp);
	const text = alerted?.alertText ?? band.panelAlert ?? "";
	const askAgain = (text.match(/ask again/gi) ?? []).length;
	note("Q56 the declined follow-up's copy, as painted", JSON.stringify({ alert: text, askAgainCount: askAgain, rows: alerted?.rows, visible: alerted?.rowsFullyVisible }));
	r2check(
		"Q56 U18: the declined refusal reads the remedy ONCE — the panel's clause is present and 'ask again' appears exactly once in the whole alert",
		text.includes(R6.DECLINED) && askAgain === 1,
		JSON.stringify({ askAgainCount: askAgain, alert: text }),
	);
	await h.take("q56-declined-refusal-copy");
	/* U11's other arm: the exchange the owner can no longer continue. */
	const pre = r6posts("q56 the copy's exchange")[0];
	const dropped = await r4DropAside(sessionId, pre?.asideId);
	note("Q56b out-of-band DELETE of the prefix (the owner evicting it)", JSON.stringify(dropped));
	await h.ask("q56b follow-up after the prefix was dropped");
	await h.awaitSettled("q56b follow-up after the prefix was dropped");
	const b2 = await h.band();
	const a2 = await r5Clip(cdp);
	const text2 = a2?.alertText ?? b2.panelAlert ?? "";
	note("Q56b U11's continuation arm", JSON.stringify({ alert: text2 }));
	r2check(
		"Q56b U11's continuation arm is unchanged: the owner's sentence plus the escape clause that costs the exchange, and no clause that promises a retry which cannot work",
		text2.includes(R6.CANT) && !text2.toLowerCase().includes("ask again here"),
		JSON.stringify({ alert: text2 }),
	);
	await h.closePanel();
}

/* ------------------------------------------------------------------ *
 *  D — U21's trigger in the flow: a box that grows after the settle
 * ------------------------------------------------------------------ */

/** The region, the newest turn and the diagram, from the press onward. */
function r6Diagram(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const turns = Array.from(region.children);
		const last = turns[turns.length - 1] ?? null;
		const lr = last ? last.getBoundingClientRect() : null;
		const svg = region.querySelector("svg.mermaid, svg[id^=mermaid], [data-lo-mermaid] svg, [data-lo-mermaid] svg, .lo-markdown svg");
		const sr = svg ? svg.getBoundingClientRect() : null;
		const md = last ? last.querySelector(".lo-markdown") : null;
		const rd = (x) => (x === null || x === undefined ? null : Math.round(x * 10) / 10);
		return {
			scrollTop: rd(region.scrollTop),
			maxScroll: rd(region.scrollHeight - region.clientHeight),
			contentHeight: rd(region.scrollHeight),
			clientHeight: region.clientHeight,
			turnOffset: lr ? rd(region.scrollTop + lr.top - rr.top) : null,
			turns: turns.length,
			svgPresent: svg !== null,
			svgHeight: sr ? Math.round(sr.height) : null,
			answerChars: md ? (md.textContent ?? "").length : null,
			announce: panel ? (panel.querySelector("output")?.textContent ?? null) : null,
			alertText: panel ? (panel.querySelector('[role="alert"]')?.textContent ?? "").replace(/\\s+/g, " ").trim() || null : null,
		};
	})()`);
}

async function r6CaseD21(cdp, h) {
	/* The panel must already overflow, so the newest turn's target is a real offset
	 * and the ceiling is what can stop the move: a tall first turn, then a follow-up
	 * whose own answer is short and whose DIAGRAM arrives after the settle. */
	await h.replaceComposer("/btw LONGANSWER: q57 a tall first answer");
	await h.enter();
	await h.awaitSettled("q57 a tall first answer");
	await h.idle();

	await cdp.evaluate(`(() => { window.__qa6Deltas = []; return true; })()`);
	const deltasAtPress = r4stats().asideDeltaFrames;
	await clickAt(cdp, R4.FIELD);
	await h.type("MERMAIDANS: q57b draw me the aside flow");
	const t0 = Date.now();
	await h.enter();
	const samples = [];
	let svgAt = null;
	let settledAt = null;
	let scrolledByHandAt = null;
	for (let i = 0; i < 600; i++) {
		const d = await r6Diagram(cdp);
		const ms = Date.now() - t0;
		if (d) {
			if (svgAt === null && d.svgPresent) svgAt = ms;
			const sunk = (d.answerChars ?? 0) > 0 && d.alertText !== null;
			if (settledAt === null && d.turns >= 2 && d.scrollTop > 0) settledAt = ms;
			const prev = samples[samples.length - 1];
			if (!prev || prev.scrollTop !== d.scrollTop || prev.contentHeight !== d.contentHeight || prev.svgPresent !== d.svgPresent || prev.maxScroll !== d.maxScroll)
				samples.push({ ms, scrollTop: d.scrollTop, maxScroll: d.maxScroll, contentHeight: d.contentHeight, svg: d.svgPresent, turnOffset: d.turnOffset, chars: d.answerChars });
		}
		if (svgAt !== null && ms - svgAt > 3000) break;
		await wait(50);
	}
	const end = await r6Diagram(cdp);
	const deltasAfter = r4stats().asideDeltaFrames;
	note(
		"Q57b U21: the panel from the press to 3 s after the diagram landed",
		JSON.stringify({ svgLandedMs: svgAt, deltasAtPress, deltasAfter, samples: samples.slice(0, 60), end }),
	);
	const tops = samples.map((s) => s.scrollTop);
	const monotone = tops.every((t, i) => i === 0 || t >= tops[i - 1] - 1);
	const distinct = [...new Set(tops)];
	const preSvg = samples.filter((s) => !s.svg);
	const lastPreSvg = preSvg[preSvg.length - 1] ?? null;
	/* THE STATE THE FIX IS FOR: at the last sample before the diagram, the region
	 * is still SHORT of the target the effect asks for (the clamp, or a landing
	 * that the turn's own growth has not yet made reachable). */
	const shortBefore = lastPreSvg !== null && lastPreSvg.turnOffset !== null && lastPreSvg.turnOffset > lastPreSvg.scrollTop + 1;
	const moveSamples = samples.filter((s, i) => i > 0 && s.scrollTop !== samples[i - 1].scrollTop);
	const movedOnlyAfterTheDiagram = moveSamples.length > 0 && moveSamples.every((s) => s.svg === true || (svgAt !== null && s.ms > svgAt));
	const noTextGrowthAfterSvg = samples.filter((s) => s.ms >= (svgAt ?? Infinity)).every((s) => s.chars === (samples.find((x) => x.svg) ?? s).chars);
	note(
		"Q57b the same reading, summarised",
		JSON.stringify({
			monotone,
			distinctScrollTops: distinct,
			preSvgTops: preSvg.map((s) => [s.ms, s.scrollTop, s.turnOffset, s.maxScroll, s.chars]),
			shortBefore,
			moveSamples: moveSamples.map((s) => ({ ms: s.ms, scrollTop: s.scrollTop, svg: s.svg })),
			movedOnlyAfterTheDiagram,
			noTextGrowthAfterSvg,
			atTarget: atTargetOf(end),
			end,
			deltas: [deltasAtPress, deltasAfter],
		}),
	);
	r2check(
		"Q57b U21: at the last frame before the diagram the region is SHORT of the newest question's offset, and the landing of the diagram (no store-visible change) is what closes it — the newest question ends at the region's edge, and the region only ever moved one way",
		end.svgPresent === true && shortBefore && atTargetOf(end) && monotone && movedOnlyAfterTheDiagram,
		JSON.stringify({ end, svgAt, shortBefore, lastPreSvg, moveSamples: moveSamples.map((s) => ({ ms: s.ms, scrollTop: s.scrollTop, svg: s.svg })), monotone, deltas: [deltasAtPress, deltasAfter] }),
	);
	await h.take("q57b-diagram-growth-followed");
	await h.closePanel();
}

/** `end.scrollTop` reached the target the effect asks for. */
function atTargetOf(end) {
	if (!end) return false;
	return Math.abs(end.scrollTop - Math.min(end.maxScroll, Math.max(0, end.turnOffset))) <= 1;
}

async function r6CaseD21b(cdp, h) {
	/* The reader's own scroll wins: hand-scroll before the diagram lands, and the
	 * late growth must leave the region exactly where the reader put it. */
	await h.replaceComposer("/btw LONGANSWER: q58 a tall first answer");
	await h.enter();
	await h.awaitSettled("q58 a tall first answer");
	await h.idle();
	await clickAt(cdp, R4.FIELD);
	await h.type("MERMAIDANS: q58b draw me the aside flow");
	const t0 = Date.now();
	await h.enter();
	let userAt = null;
	let svgAt = null;
	for (let i = 0; i < 600; i++) {
		const d = await r6Diagram(cdp);
		const ms = Date.now() - t0;
		if (d) {
			if (svgAt === null && d.svgPresent) svgAt = ms;
			if (userAt === null && d.scrollTop > 30 && !d.svgPresent) {
				await cdp.evaluate(`document.querySelector('[aria-label="The aside exchange"]').scrollTop -= 40`);
				userAt = (await r6Diagram(cdp)).scrollTop;
				note("Q58b the reader scrolled by hand before the diagram landed", JSON.stringify({ at: ms, userAt }));
			}
		}
		if (svgAt !== null && ms - svgAt > 2500) break;
		await wait(50);
	}
	const end = await r6Diagram(cdp);
	note("Q58b U21 with a reader's scroll in the way", JSON.stringify({ svgLandedMs: svgAt, userAt, end }));
	r2check(
		"Q58b U21 yields to the reader: a hand scroll before the diagram landed holds through the late growth (the box trigger does not re-take the region)",
		userAt !== null && end.svgPresent === true && Math.abs(end.scrollTop - userAt) <= 1,
		JSON.stringify({ userAt, endScrollTop: end.scrollTop, svgLandedMs: svgAt }),
	);
	await h.closePanel();
}

/* ------------------------------------------------------------------ *
 *  E — the cheap neighbours, in this same pass
 * ------------------------------------------------------------------ */

async function r6CaseE(cdp, h) {
	/* bare /btw: an empty panel, nothing asked, and the next Enter carries no prefix */
	await h.replaceComposer("/btw");
	const postsBefore = r6posts().length;
	await h.enter();
	await h.awaitBand((b) => b.panel !== null, 60);
	const empty = await h.band();
	r2check(
		"NE1 bare /btw attaches an empty panel and asks nothing",
		r6posts().length === postsBefore &&
			(empty.panelText ?? "").includes(R6.EMPTY_COPY) &&
			(empty.fieldValue ?? "") === "",
		JSON.stringify({ posts: r6posts().length - postsBefore, panelText: (empty.panelText ?? "").slice(0, 120), fieldValue: empty.fieldValue }),
	);
	await h.take("ne1-bare-btw-empty-panel");
	await h.ask("ne1 the first question from the empty panel");
	await h.awaitSettled("ne1 the first question from the empty panel");
	const first = r6posts("ne1 the first question")[0];
	r2check(
		"NE1b the empty panel's next Enter is the FIRST question: the POST carries no prefix to continue",
		first?.status === 200 && !first?.continues,
		JSON.stringify({ status: first?.status, continues: first?.continues, requestId: first?.asideId }),
	);
	/* Escape routing restored: with no panel up, Escape leaves no close call and
	 * the draft in the composer is not eaten. */
	await h.closePanel();
	await h.replaceComposer("a draft the conversation owns");
	const opCount = r6ops().length;
	await clickAt(cdp, R4.FIELD);
	await h.escape();
	await wait(400);
	const afterEsc = await h.band();
	r2check(
		"NE2 Escape routing is restored with no panel up: no close/adopt call leaves and the conversation's draft survives",
		r6ops().length === opCount && afterEsc.panel === null && afterEsc.fieldValue === "a draft the conversation owns",
		JSON.stringify({ ops: r6ops().length - opCount, fieldValue: afterEsc.fieldValue, panel: afterEsc.panel }),
	);
	await h.replaceComposer("");
	/* the stream's own counters: every aside_delta frame belonged to this pane's
	 * subscription, and the subscriptions are the pane's own */
	const stats = r4stats();
	const subs = Object.entries(stats.deltasBySubscription ?? {});
	const askIds = new Set(r6posts().map((p) => p.asideId));
	const asideKeys = Object.keys(stats.deltasByAside ?? {});
	note("NE3 the wire counters", JSON.stringify({ asideDeltaFrames: stats.asideDeltaFrames, deltasBySubscription: stats.deltasBySubscription, deltasByAside: stats.deltasByAside, streams: (stats.streams ?? []).map((s) => ({ sub: s.subscriptionId, deltas: s.asideDeltas, sizes: s.deltaSizes.length })), subscribedAsks: [...askIds].filter((id) => asideKeys.includes(id)) }));
	r2check(
		"NE3 every aside_delta frame this pass counted belongs to a subscription the pane opened (every stream carrying deltas has a named subscription, and the asks carried that same subscription_id), so a frame addressed to another pane's subscription would show up here",
		stats.asideDeltaFrames > 0 &&
			subs.length >= 1 &&
			subs.every(([sub]) => sub !== "null" && sub !== "undefined") &&
			(stats.streams ?? []).filter((s) => s.asideDeltas > 0).every((s) => typeof s.subscriptionId === "string" && s.subscriptionId.length > 0) &&
			r6posts().some((p) => p.subscriptionId === subs[0][0]),
		JSON.stringify({ asideDeltaFrames: stats.asideDeltaFrames, subs, asideKeys: asideKeys.length, askIds: askIds.size, asksFramed: asideKeys.filter((id) => askIds.has(id)).length }),
	);
}

/* ------------------------------------------------------------------ *
 *  the pass
 * ------------------------------------------------------------------ */

async function sceneBtwR6(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R6 session", sessionId);
	const P = `qa6-${RUN_LABEL}`;
	const h = r5Harness(cdp, P);
	await r6CaseA19(cdp, h, sessionId);
	await r6CaseB17(cdp, h);
	await r6CaseC18(cdp, h, sessionId);
	await r6CaseD21(cdp, h);
	await r6CaseD21b(cdp, h);
	await r6CaseE(cdp, h);
	return { tree: "qa6", frames: [] };
}

/* ------------------------------------------------------------------ *
 *  the cap sweep (U20/Q46), one width per pass
 * ------------------------------------------------------------------ */

async function sceneBtwR6Cap(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R6 cap session", sessionId);
	const P = `qa6cap-${RUN_LABEL}`;
	const h = r5Harness(cdp, P);
	await clickAt(cdp, R4.FIELD);
	await h.type("LONGANSWER seed for the quotes");
	await h.enter();
	await h.awaitBand((b) => (b.transcriptText ?? "").includes("stopping a run that is failing"), 400);
	await h.idle();
	/* The ordinary 45-character quote is DESIGN ROUND 4's own case: one line at
	 * 1380, two at 800. The long question is the one whose wrap round 4 measured at
	 * 6 lines narrow. */
	const SHORT1 = "The retry budget is a per-provider allowance";
	const SHORT2 = "a 4xx spends nothing";
	const WRAP = "A dropped connection, a reset stream, a timeout before the first byte and an owner 5xx each spend one unit; a 4xx spends nothing, because the request itself was refused and sending it again would be refused again.";
	const LONGQ = "with a question long enough that it has to wrap onto more than one line in the panel, because the ceiling is now said to count the question's MEASURED box and this checks what the edge does then";
	const cases = [
		{ id: "none", quotes: [], q: "q59 no quote" },
		{ id: "one", quotes: [SHORT1], q: "q59 one quote" },
		{ id: "two", quotes: [SHORT1, SHORT2], q: "q59 two quotes" },
		{ id: "wrapq", quotes: [], q: `q59 ${LONGQ}` },
		{ id: "wrapboth", quotes: [SHORT1], q: `q59 quote and ${LONGQ}` },
		{ id: "wrapboth2", quotes: [WRAP], q: `q59 a long quote and ${LONGQ}` },
		{ id: "oneshort", quotes: [SHORT2], q: "q59 one" },
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
			const qg = r5QGeo(cdp);
			const post = r6posts(`${c.q} k${k}`)[0] ?? null;
			const row = {
				case: c.id,
				k,
				staged: staged.map((s) => s.pressed),
				wireQuotes: ((post?.text ?? "").match(/<reply-to>/g) ?? []).length,
				quoteBlocks: g.questionQuoteBlocks,
				quoteLines: qg.quoteLines,
				questionLines: qg.questionLines,
				questionHeight: qg.questionHeight,
				cap: g.cap,
				clientHeight: g.clientHeight,
				answerTop: g.answerTopInRegion,
				lineHeight: g.answerLineHeight,
				rowsToEdge: g.rowsBetweenAnswerTopAndEdge,
				crossing: g.crossing,
				scrollTop: g.scrollTop,
				maxScroll: g.maxScroll,
			};
			table.push(row);
			if (k === 9 || (g.crossing.length && !table.slice(0, -1).some((r) => r.case === c.id && r.crossing.length)))
				await h.take(`q59-cap-${c.id}-k${k}`);
			await h.closePanel();
		}
		const rows = table.filter((r) => r.case === c.id);
		note(`Q59 ${c.id} sweep`, JSON.stringify(rows));
		const maxCut = Math.max(0, ...rows.flatMap((r) => r.crossing.map((x) => x.hiddenPx)));
		const edge = [...new Set(rows.map((r) => r.rowsToEdge))];
		r2check(
			`Q59 ${c.id}: the edge sits exactly 10.0 line boxes below the newest answer's top and NO answer row is cut, for PARAGRID1..9 (measured ${edge.join("/")})`,
			edge.length === 1 && edge[0] === 10 && rows.every((r) => r.crossing.length === 0) && rows.every((r) => r.quoteBlocks === c.quotes.length),
			JSON.stringify({
				edgeLineBoxes: edge,
				maxHiddenPx: maxCut,
				cutKs: rows.filter((r) => r.crossing.length).map((r) => ({ k: r.k, crossing: r.crossing })),
				cap: rows[0].cap,
				answerTop: rows[0].answerTop,
				lineHeight: rows[0].lineHeight,
				quoteLines: rows[0].quoteLines,
				questionLines: rows[0].questionLines,
				questionHeight: rows[0].questionHeight,
			}),
		);
	}
	return { tree: "qa6-cap", frames: [] };
}

/* ------------------------------------------------------------------ *
 *  btw-r6-capq — the cap's own terms in the D11 flow (diagnostic)
 *
 *  WHY: at narrow the head's D11 move stops where the baseline's keeps going, and
 *  two mutations (the box trigger, the scrollbar gutter) do not restore it. This
 *  reads the region's INLINE max-height (the cap with its measured px term spelled
 *  out), the question node's measured box, and the scroll geometry across one
 *  refusal — the raw material for the mechanism, not a verdict of its own.
 * ------------------------------------------------------------------ */

function r6Capq(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const turns = Array.from(region.children);
		const last = turns[turns.length - 1] ?? null;
		const q = last ? last.querySelector(":scope > p") : null;
		const rd = (x) => (x === null || x === undefined ? null : Math.round(x * 100) / 100);
		return {
			inlineCap: region.style.maxHeight,
			computedCap: getComputedStyle(region).maxHeight,
			clientHeight: region.clientHeight,
			scrollHeight: region.scrollHeight,
			maxScroll: rd(region.scrollHeight - region.clientHeight),
			scrollTop: rd(region.scrollTop),
			turnOffset: last ? rd(region.scrollTop + last.getBoundingClientRect().top - rr.top) : null,
			questionBox: q ? rd(q.getBoundingClientRect().height) : null,
			questionText: q ? q.textContent.replace(/\\s+/g, " ").trim().slice(0, 40) : null,
			state: last ? (last.textContent.includes("thinking") ? "thinking" : last.querySelector('[role="alert"]') ? "alert" : "other") : "none",
		};
	})()`);
}

async function sceneBtwR6Capq(cdp) {
	const facts = await factsOf(cdp);
	r2check("window mode is headless and the window is never shown", facts.windowMode === "headless" && facts.visible === false, `mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("R6 capq session", sessionId);
	const h = r5Harness(cdp, `qa6capq-${RUN_LABEL}`);
	await clickAt(cdp, R4.FIELD);
	await h.type("/btw q35 first question, answered");
	await h.enter();
	await h.awaitSettled("q35 first question, answered");
	await wait(400);
	note("CAPQ after the base settled", JSON.stringify(await r6Capq(cdp)));
	await clickAt(cdp, R4.FIELD);
	await h.type("TOOLCALL2: q35 follow-up refused by the model");
	/*
	 * A PER-FRAME WATCH ON THE REGION, installed before the press: the question this
	 * answers is whether scrollTop ever REACHED the newest question's offset and was
	 * then clamped back by the browser (a write the guard would read as a landed move
	 * and mark the turn done), which a 60 ms poll cannot see.
	 */
	await cdp.evaluate(`(() => {
		window.__qaFrames = [];
		const tick = () => {
			const r = document.querySelector('[data-lo-aside-panel] [aria-label="The aside exchange"]');
			if (r) window.__qaFrames.push([Math.round(performance.now()), Math.round(r.scrollTop * 10) / 10, r.scrollHeight, r.clientHeight, r.style.maxHeight]);
			if (window.__qaFrames.length < 1500) requestAnimationFrame(tick);
		};
		requestAnimationFrame(tick);
		return true;
	})()`);
	const t0 = Date.now();
	await h.enter();
	const samples = [];
	for (let i = 0; i < 120; i++) {
		const g = await r6Capq(cdp);
		if (g) {
			const prev = samples[samples.length - 1];
			if (!prev || JSON.stringify({ ...prev, at: 0 }) !== JSON.stringify({ ...g, at: 0 })) samples.push({ at: Date.now() - t0, ...g });
		}
		if (g && g.state === "alert" && Date.now() - t0 > 2500) break;
		await wait(60);
	}
	note("CAPQ across the refusal", JSON.stringify(samples));
	await h.awaitSettled("q35 follow-up refused by the model");
	await wait(1200);
	note("CAPQ at rest", JSON.stringify(await r6Capq(cdp)));
	{
		const frames = await cdp.evaluate("window.__qaFrames ?? []");
		const tops = frames.map((f) => f[1]);
		const peak = Math.max(...tops, 0);
		const atPeak = frames.find((f) => f[1] === peak) ?? null;
		const after = frames.slice(frames.findIndex((f) => f[1] === peak) + 1);
		note("CAPQ every frame [ms, scrollTop, scrollHeight, clientHeight, inline maxHeight] (first 6, the peak, the 6 after)", JSON.stringify({ first: frames.slice(0, 6), peak, atPeak, after: after.slice(0, 6), last: frames.slice(-3), frameCount: frames.length }));
	}
	note("CAPQ the move effect's own runs and the measurement passes", JSON.stringify(await cdp.evaluate("({ moves: window.__qaMove ?? [], measures: window.__qaMeasure ?? [] })")));
	note("CAPQ the same reading with the region's own box", JSON.stringify(await cdp.evaluate(`(() => {
		const region = document.querySelector('[data-lo-aside-panel] [aria-label="The aside exchange"]');
		if (!region) return null;
		const cs = getComputedStyle(region);
		return { inline: region.style.maxHeight, scrollbarGutter: cs.scrollbarGutter, clientWidth: region.clientWidth, offsetWidth: region.offsetWidth, clientHeight: region.clientHeight, pad: cs.paddingTop };
	})()`)));
	return { tree: "qa6-capq", frames: [] };
}
