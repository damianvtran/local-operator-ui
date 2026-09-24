
/* ===================================================================== *
 *   UX ROUND 3 (independent) — PR #482 at ba98e4fdc, the delta since UX round 2
 *
 * Driver-only and uncommitted: appended to a COPY of scripts/renderer-driver.mjs
 * after rounds 1-5's helper layer and scenes. The app's source is unmodified.
 *
 *  btw-ux3   wide  — U11's two arms walked in order (declined follow-up → read what
 *                    the panel says → retry in the same panel → the Esc arm and what
 *                    it actually costs), the dropped exchange, a fresh refusal's
 *                    sentence alone, U16's two-press confirm (placement, survival,
 *                    withdrawal, the keyboard-only path), U12's end state, U13, U14,
 *                    U15, U3/U7, and the adopt end to end with the re-entry.
 *  btw-ux3b  narrow — the same U11 arms with the clip measured (Q33 in the flow),
 *                    U16's confirm line where it has 236px to fit in, and a wrapped
 *                    staged quote at the region's edge (Q46, judged in the flow).
 *
 * Every step is a real Input.dispatchKeyEvent / insertText / mouse event, and every
 * reading is the app's own DOM.
 * ===================================================================== */

const UX3 = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	DECLINED_BODY: "The model did not answer your aside in text",
	DECLINED_OPTIONS: "Ask again here to keep this exchange, or press Esc to close the aside and discard it.",
	CANT_CONTINUE: "This aside can't continue. Press Esc to close it, which discards this exchange, then start a new one with /btw.",
	NO_LONGER: "This aside is no longer available",
	CONFIRM: "Press \u2318+F again to add the aside to the conversation. Once added, it stays there.",
	BUSY: "The aside is still answering. Press Enter again once the answer is in.",
	RETRY_SUFFIX: "Your message is still in the composer",
	ADOPT: "Add to conversation",
};

/**
 * One reading of everything a UX judgement needs at a step: the panel's two alert
 * surfaces kept APART (the exchange's refusal vs the notice under the adopt row),
 * where they sit, what has focus, and where each sentence landed.
 */
function ux3Read(cdp) {
	return cdp.evaluate(`(() => {
		const flat = (el) => (el ? el.textContent.replace(/\\s+/g, " ").trim() : null);
		const box = (el) => {
			if (!el) return null;
			const r = el.getBoundingClientRect();
			return { x: Math.round(r.x), y: Math.round(r.y), right: Math.round(r.right),
				bottom: Math.round(r.bottom), w: Math.round(r.width), h: Math.round(r.height) };
		};
		const panel = document.querySelector("[data-lo-aside-panel]");
		const field = document.querySelector('textarea[aria-label="Message"]');
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		const band = document.querySelector("[data-lo-composer-band]");
		const alerts = panel ? Array.from(panel.querySelectorAll('[role="alert"]')) : [];
		const adopt = panel ? Array.from(panel.querySelectorAll("button")).find((b) => b.textContent.trim() === "Add to conversation") : null;
		const notice = alerts.length ? alerts[alerts.length - 1] : null;
		const refusal = alerts.length ? alerts[0] : null;
		const a = document.activeElement;
		const replyCount = document.querySelectorAll('[aria-label="Remove reply"]').length;
		return {
			panelUp: panel !== null,
			panelText: flat(panel),
			refusalText: flat(refusal),
			noticeText: alerts.length ? flat(notice) : null,
			noticeCount: alerts.length,
			noticeBox: box(notice),
			adoptBox: box(adopt),
			noticeGapPx: (adopt && notice && notice !== adopt) ? Math.round((notice.getBoundingClientRect().top - adopt.getBoundingClientRect().bottom) * 10) / 10 : null,
			adoptDisabled: adopt ? adopt.disabled : null,
			adoptReason: (() => {
				if (!adopt) return null;
				const id = adopt.getAttribute("aria-describedby");
				const el = id ? document.getElementById(id) : null;
				return el ? flat(el) : null;
			})(),
			refusalBox: box(refusal),
			regionBox: box(region),
			region: region ? { scrollTop: Math.round(region.scrollTop), maxScroll: region.scrollHeight - region.clientHeight, clientHeight: region.clientHeight, turns: region.children.length, tabIndex: region.tabIndex } : null,
			answerHasQuoteBlock: panel ? panel.querySelectorAll('span[class*="border-l-2"]').length : null,
			panelHasReplyMarkup: panel ? /<reply-to>|&lt;reply-to&gt;/.test(panel.textContent) : null,
			announce: panel ? flat(panel.querySelector("output")) : null,
			fieldValue: field ? field.value : null,
			placeholder: field ? field.placeholder : null,
			sendLabel: (() => { const s = document.querySelector('button[type="submit"][aria-label="Send message"], button[type="submit"][aria-label="Ask the aside"]'); return s ? s.getAttribute("aria-label") : null; })(),
			active: a ? a.tagName.toLowerCase() + (a.getAttribute("aria-label") ? "[" + a.getAttribute("aria-label") + "]" : "") + (a.tagName === "BUTTON" ? "{" + a.textContent.replace(/\\s+/g, " ").trim().slice(0, 28) + "}" : "") : null,
			activeIsField: a === field,
			bandLines: band ? Array.from(band.querySelectorAll("p, [role=alert]")).filter((n) => !n.closest("[data-lo-aside-panel]")).filter((n) => !(n.parentElement && n.parentElement.closest("p, [role=alert]"))).map(flat).filter(Boolean) : [],
			transcriptText: flat(document.querySelector("[data-lo-transcript-content]")),
			transcriptWorking: document.querySelector("[data-lo-canonical-transcript] [data-lo-working-line]") !== null,
			transcriptStreaming: document.querySelector("[data-lo-canonical-transcript] [data-lo-streaming]") !== null,
			replies: replyCount,
			busy: document.querySelector('button[aria-label="Stop agent"]') !== null,
		};
	})()`);
}

/** The sentence's own zone, wherever it landed (panel / band / transcript / toast). */
function ux3Where(cdp, needle) {
	return cdp.evaluate(`(() => {
		const needle = ${JSON.stringify(needle)};
		const out = [];
		const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
		for (let n = walk.nextNode(); n; n = walk.nextNode()) {
			if (!n.nodeValue || !n.nodeValue.includes(needle)) continue;
			const el = n.parentElement;
			const zone = el.closest("[data-lo-aside-panel]") ? "panel"
				: el.closest("[data-lo-transcript-content]") ? "transcript"
				: el.closest("[data-sonner-toast]") ? "toast"
				: el.closest("[data-lo-composer-band]") ? "composer-band" : "elsewhere";
			const r = el.getBoundingClientRect();
			out.push({ zone, visible: r.width > 0 && r.height > 0, text: el.textContent.replace(/\\s+/g, " ").trim().slice(0, 200) });
		}
		return out;
	})()`);
}

/** The reply chip's own tooltip, which is what the user can hover to read the quote. */
function ux3Chips(cdp) {
	return cdp.evaluate(`Array.from(document.querySelectorAll('[aria-label="Remove reply"]')).map((b) => {
		const span = b.closest("div") ? b.closest("div").querySelector("span[title]") : null;
		return span ? span.getAttribute("title") : "?";
	})`);
}

async function ux3Harness(cdp, prefix) {
	const enter = () => pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const esc = () => pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const cmdF = () => pressChord(cdp, { key: "f", code: "KeyF", virtualKeyCode: 70, modifiers: MODIFIER.meta });
	const tab = (shift) => pressChord(cdp, { key: "Tab", code: "Tab", virtualKeyCode: 9, modifiers: shift ? MODIFIER.shift : 0 });
	const type = async (text) => { await cdp.send("Input.insertText", { text }); await wait(120); };
	const replaceComposer = async (text) => {
		await clickAt(cdp, UX3.FIELD);
		await pressChord(cdp, { key: "a", code: "KeyA", virtualKeyCode: 65, modifiers: MODIFIER.meta, commands: ["selectAll"] });
		await pressChord(cdp, { key: "Backspace", code: "Backspace", virtualKeyCode: 8 });
		if (text) await cdp.send("Input.insertText", { text });
		await wait(180);
	};
	const read = () => ux3Read(cdp);
	const until = async (want, ms = 20000) => {
		const t0 = Date.now();
		let r = await read();
		while (!want(r) && Date.now() - t0 < ms) { await wait(60); r = await read(); }
		return { ...r, waitedMs: Date.now() - t0, met: want(r) };
	};
	const idle = () => until((r) => !r.transcriptWorking && !r.transcriptStreaming, 90000);
	const settled = (r) => r.adoptDisabled === false;
	/**
	 * Ask in the composer and wait for the ASK ITSELF to be over.
	 *
	 * The wire is the authority: a continuation leaves the earlier turn's alert on the
	 * panel, so "an alert is on screen" answers a question about the exchange rather
	 * than about this ask. The proxy's own log for this question's text is what says
	 * the POST returned, and the panel's stream for it is what says the answer settled.
	 */
	const ask = async (text, ms = 30000, viaSlash = false) => {
		await clickAt(cdp, UX3.FIELD);
		await type(viaSlash ? `/btw ${text}` : text);
		const t0 = Date.now();
		await enter();
		let post = null;
		let announce = null;
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			const r = await read();
			if (announce === null && r.announce !== null && r.announce !== "Asking the aside") announce = r.announce;
			post = r4posts(text)[0] ?? null;
			/*
			 * The ask is over when the POST returned AND the panel's live region has left
			 * "Asking the aside" - which is the moment the answer settled or the refusal
			 * landed. `settled` is NOT the right term here: with a conversation turn
			 * running, the adopt control is disabled for that reason and the ask itself has
			 * long finished.
			 */
			if (post && post.status !== null && (announce !== null || r.panelUp === false)) break;
			await wait(100);
		}
		await wait(300);
		const r = await read();
		if (announce === null && r.announce !== null && r.announce !== "Asking the aside") announce = r.announce;
		return { ms: Date.now() - t0, post, announce, ...r };
	};
	const take = async (label) => {
		const f = await capture(cdp, `${prefix}-${label}`);
		note("frame", JSON.stringify({ label: f.label, ...f.pixels }));
		return f;
	};
	return { enter, esc, cmdF, tab, type, replaceComposer, read, until, idle, settled, ask, take };
}

/** The owner's own record for one aside, RAW (so a status the helper drops is visible). */
async function ux3AsideRaw(sessionId, asideId) {
	const response = await fetch(
		`${BACKEND}/v1/desktop/sessions/${sessionId}/asides/${asideId}`,
		{ headers: r4auth(), },
	).catch(() => null);
	if (!response) return { status: null, body: null };
	const body = await response.json().catch(() => null);
	return { status: response.status, body };
}

/** Leave the conversation, read the URL and the DOM WHILE away, then come back. */
async function ux3Leave(cdp, path = "/settings") {
	await verb(cdp, "navigate", path);
	await wait(1800);
	const away = await readQaBand(cdp);
	const awayUrl = await cdp.evaluate("location.hash || location.pathname");
	return { away, awayUrl };
}

/**
 * Descend into a fresh aside exchange, returning the answered base turn.
 *
 * The panel is closed first WHERE ONE IS UP: an ask continues the last answered
 * entry in the attached exchange (`askAside`'s `continuation`), so a "base turn"
 * typed over a live panel is a follow-up and not the fresh exchange this helper
 * promises.
 */
async function ux3Base(cdp, h, question) {
	const open = await h.read();
	if (open.panelUp) {
		await clickAt(cdp, UX3.FIELD);
		await h.esc();
		await h.until((r) => r.panelUp === false, 6000);
		await wait(250);
	}
	await h.replaceComposer(`/btw ${question}`);
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	/*
	 * SETTLED, not merely painted. The streamed text can be complete on screen while the
	 * POST is still in flight (round 2's measurement), and in that window the owner
	 * refuses a continuation - so a follow-up typed here is held, and an out-of-band
	 * DELETE is answered 409 "Wait for the aside to finish before closing it". The
	 * scene's base turn has to be a finished one.
	 */
	const base = await h.until((r) => (r.panelText ?? "").includes(UX3.TAIL) && r.panelUp && h.settled(r), 40000);
	const post = r4posts(question)[0] ?? null;
	return { base, asideId: post?.asideId ?? null, post };
}

/* ===================================================================== *
 *  PASS A — WIDE
 * ===================================================================== */

async function sceneBtwUx3(cdp) {
	const facts = await factsOf(cdp);
	r2check("headless and never shown", facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX3 session", sessionId);
	const P = `ux3-${RUN_LABEL}`;
	const h = await ux3Harness(cdp, P);
	const log = (label, value) => note(label, JSON.stringify(value));
	const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
	const STD = ["active", "activeIsField", "fieldValue", "refusalText", "noticeText", "noticeCount", "adoptDisabled", "adoptReason", "bandLines", "region"];
	const count = (s, n) => qaCount(s ?? "", n);

	// --- seed a conversation so the transcript has its own rows ---------------
	await h.replaceComposer("seed turn for the round-3 UX walk");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const seeded = await h.until((r) => (r.transcriptText ?? "").includes(UX3.TAIL) && !r.transcriptWorking, 60000);
	r2check("the seed turn is in the transcript before the aside starts", (seeded.transcriptText ?? "").includes(UX3.TAIL), JSON.stringify({ met: seeded.met, working: seeded.transcriptWorking }));
	await h.idle();

	/* =====================================================================
	 * 1. U11 — ARM ONE: a declined follow-up, read, then the retry in place
	 * ===================================================================== */
	const A = await ux3Base(cdp, h, "U11a what does the retry budget cap");
	log("1a base turn answered", pick(A.base, STD));
	await h.take("01-u11a-base-answered");

	const t1 = Date.now();
	await clickAt(cdp, UX3.FIELD);
	await h.type("TOOLCALL2: U11a the follow-up the model declines");
	await h.enter();
	const decl = await h.until((r) => r.refusalText !== null, 30000);
	const declMs = Date.now() - t1;
	await wait(700);
	const declR = await h.until((r) => r.refusalText !== null && r.adoptDisabled !== null, 5000);
	const clipDecl = await r5Clip(cdp);
	log("1b the declined follow-up's refusal, as painted", { msFromPress: declMs, met: decl.met, ...pick(declR, STD) });
	log("1b refusal in the region (Q33 in the flow)", clipDecl);
	log("1b where the two clauses sit", await ux3Where(cdp, UX3.DECLINED_OPTIONS));
	r2check("1b the refusal names BOTH options in one sentence the user can act on",
		(declR.refusalText ?? "").includes(UX3.DECLINED_BODY) && (declR.refusalText ?? "").includes(UX3.DECLINED_OPTIONS),
		JSON.stringify({ text: declR.refusalText }));
	r2check("1b the whole refusal is inside the region's clip (the words that name Esc's cost are read, not implied)",
		clipDecl !== null && clipDecl.hiddenBelowPx <= 0.5 && clipDecl.phrase?.visible === true,
		JSON.stringify(clipDecl));
	r2check("1b the refusal reaches the user without a press (it is on the panel, not behind a hover)",
		declR.activeIsField === true && (declR.panelText ?? "").includes(UX3.DECLINED_OPTIONS),
		JSON.stringify({ active: declR.active }));
	await h.take("02-u11a-declined-refusal");

	// the retry in place: the promise the copy makes must hold
	const retry = await h.ask("U11a retry in the same panel after the refusal", 30000);
	const retryPost = r4posts("U11a retry in the same panel")[0] ?? null;
	log("1c the retry in the same panel", { ms: retry.ms, ...pick(retry, STD), wire: retryPost && { status: retryPost.status, continues: retryPost.continues } });
	/*
	 * The refused turn KEEPS its alert on the panel (it is the exchange's history), so
	 * "no refusal on screen" is the wrong test for a retry. The right one is the retry's
	 * own answer: a second copy of the answer's tail, and its own POST answered 200
	 * continuing this exchange's entry.
	 */
	r2check("1c the copy's first option is true: asking again in the same panel is answered",
		retryPost?.status === 200 && count(retry.panelText, UX3.TAIL) >= 2 && (retry.region?.turns ?? 0) === 3,
		JSON.stringify({ status: retryPost?.status, tails: count(retry.panelText, UX3.TAIL), turns: retry.region?.turns }));
	await h.take("03-u11a-retry-answered-in-place");

	/* =====================================================================
	 * 2. U11 — ARM TWO: Escape, and what the user actually loses
	 * ===================================================================== */
	const B = await ux3Base(cdp, h, "U11b a second base question");
	await clickAt(cdp, UX3.FIELD);
	await h.type("TOOLCALL2: U11b the follow-up before Esc");
	await h.enter();
	const b2 = await h.until((r) => r.refusalText !== null, 30000);
	const beforeEsc = await r4GetAside(sessionId, B.asideId);
	const beforeTranscript = b2.transcriptText ?? "";
	log("2a before Esc: the panel's state", pick(b2, STD));
	log("2a before Esc: the owner's entry", beforeEsc);
	r2check("2a the exchange on screen is answered and holds two turns before the key",
		beforeEsc.turns === 2 && beforeTranscript.includes("U11b a second base question") === false,
		JSON.stringify({ turns: beforeEsc.turns, inTranscript: beforeTranscript.includes("U11b a second base question") }));
	await h.take("04-u11b-refusal-before-esc");

	const tEsc = Date.now();
	await h.esc();
	const afterEsc = await h.until((r) => r.panelUp === false, 5000);
	/*
	 * The discard is a request of its own (`sessions.aside.close`, fire-and-forget), so
	 * the entry's own record is polled rather than read once at the frame where the panel
	 * vanished - and how long the owner went on holding it is part of the reading.
	 */
	let afterEscAside = await r4GetAside(sessionId, B.asideId);
	const tDiscard = Date.now();
	for (let i = 0; i < 60 && afterEscAside.status === 200; i++) {
		await wait(100);
		afterEscAside = await r4GetAside(sessionId, B.asideId);
	}
	const discardMs = Date.now() - tDiscard;
	const chipAfterEsc = await ux3Chips(cdp);
	const after = await h.read();
	log("2b after Esc: what the user has left", { ms: Date.now() - tEsc, panelUp: afterEsc.panelUp, active: afterEsc.active, activeIsField: afterEsc.activeIsField });
	log("2b after Esc: the owner's entry (the id the panel held)", { ...afterEscAside, msUntilTheOwnerLetGo: discardMs });
	log("2b after Esc: what the app asked the owner to drop", r4ops("close").map((o) => ({ id: o.url.split("/").pop(), status: o.status })));
	const survivor = await ux3AsideRaw(sessionId, B.asideId);
	log("2b after Esc: the exchange's own entry, read raw", { status: survivor.status, turns: survivor.body?.data?.turns?.length ?? null });
	log("2b after Esc: the transcript", { hasBaseQuestion: count(after.transcriptText, "U11b a second base question"), hasFollowUp: count(after.transcriptText, "U11b the follow-up before Esc"), replies: chipAfterEsc });
	r2check("2b Esc takes the exchange off the screen: the panel is gone, focus is back in the box, and neither question is anywhere the user can reach",
		afterEsc.panelUp === false && afterEsc.activeIsField === true &&
			count(after.transcriptText, "U11b a second base question") === 0 &&
			count(after.transcriptText, "U11b the follow-up before Esc") === 0 &&
			chipAfterEsc.length === 0,
		JSON.stringify({ panelUp: afterEsc.panelUp, active: afterEsc.active, inTranscript: count(after.transcriptText, "U11b a second base question") }));
	r2check("2b Esc returns focus to the composer", afterEsc.activeIsField === true, JSON.stringify({ active: afterEsc.active }));
	await h.take("05-u11b-after-esc-what-was-lost");

	// a FRESH refusal must state the owner's sentence alone (there is no exchange for Esc to cost)
	await h.replaceComposer("/btw TOOLCALL2: U11c a fresh ask the model declines");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const fresh = await h.until((r) => r.refusalText !== null, 30000);
	log("2c a fresh refused ask", pick(fresh, STD));
	r2check("2c a fresh refusal states the owner's sentence alone - no clause sending the user away from a panel that recovered by itself",
		(fresh.refusalText ?? "").includes(UX3.DECLINED_BODY) &&
			!(fresh.refusalText ?? "").includes(UX3.DECLINED_OPTIONS) &&
			!(fresh.refusalText ?? "").includes(UX3.CANT_CONTINUE),
		JSON.stringify({ text: fresh.refusalText }));
	await h.take("06-u11c-fresh-refusal-sentence-alone");
	await h.esc();
	await wait(400);

	/* =====================================================================
	 * 3. U11 / U1 — the dropped exchange, then a fresh ask
	 * ===================================================================== */
	const C = await ux3Base(cdp, h, "U11d base for the dropped exchange");
	const dropped = await r4DropAside(sessionId, C.asideId);
	log("3a out-of-band DELETE of the answered entry (the owner evicting it)", dropped);
	await clickAt(cdp, UX3.FIELD);
	await h.type("U11d a follow-up after the owner dropped the prefix");
	await h.enter();
	const drop = await h.until((r) => r.refusalText !== null, 30000);
	const dropClip = await r5Clip(cdp);
	const dropPost = r4posts("U11d a follow-up after the owner dropped")[0] ?? null;
	log("3b the dropped-exchange refusal", { ...pick(drop, STD), wire: dropPost && { status: dropPost.status, continues: dropPost.continues } });
	log("3b the dropped exchange in the region", dropClip);
	r2check("3b the dropped exchange is stated with the owner's sentence AND the one exit that works, and names what the exit costs",
		(drop.refusalText ?? "").includes(UX3.NO_LONGER) && (drop.refusalText ?? "").includes(UX3.CANT_CONTINUE),
		JSON.stringify({ text: drop.refusalText, status: dropPost?.status }));
	r2check("3b the dropped-exchange refusal names no retry that cannot work",
		!(drop.refusalText ?? "").toLowerCase().includes("ask again here") &&
			dropClip !== null && dropClip.hiddenBelowPx <= 0.5 && dropClip.phrase?.visible === true,
		JSON.stringify({ text: drop.refusalText, clip: dropClip }));
	await h.take("07-u11d-dropped-exchange-refusal");
	await h.esc();
	await wait(400);
	const freshAfterDrop = await h.ask("U11d a fresh aside after the dropped one", 30000, true);
	log("3c a fresh ask after the dropped exchange", { ms: freshAfterDrop.ms, ...pick(freshAfterDrop, STD) });
	r2check("3c a fresh aside after a dropped exchange is answered, and states no clause",
		(freshAfterDrop.panelText ?? "").includes(UX3.TAIL) && freshAfterDrop.refusalText === null,
		JSON.stringify({ refusal: freshAfterDrop.refusalText }));
	await h.take("08-u11d-fresh-ask-answered-after-the-drop");

	/* =====================================================================
	 * 4. U16 — the two-press confirm
	 * ===================================================================== */
	await h.idle();
	const D = await ux3Base(cdp, h, "U16 the exchange to be adopted by chord");
	await h.idle();
	const d0 = await h.until((r) => h.settled(r), 30000);
	log("4a adoptable exchange", pick(d0, STD));
	const beforeU16 = await h.read();
	const keyLog = await cdp.evaluate(`(() => { window.__ux3Keys = []; window.addEventListener("keydown", (e) => {
		if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
		window.__ux3Keys.push({ prevented: e.defaultPrevented, path: e.composedPath().slice(0, 3).map((n) => n.tagName || String(n)) });
	}); return true; })()`);
	const ops0 = r4ops("adopt").length;
	await clickAt(cdp, UX3.FIELD);
	await h.cmdF();
	await wait(700);
	const first = await h.read();
	const k1 = await cdp.evaluate("window.__ux3Keys[window.__ux3Keys.length - 1] ?? null");
	log("4b the FIRST ⌘+F", { ...pick(first, STD), key: k1, adoptOps: r4ops("adopt").length });
	r2check("4b the first press only confirms: no adopt request, the panel stays, and the confirm says what a second press will do",
		r4ops("adopt").length === ops0 && first.panelUp === true && (first.noticeText ?? "") === UX3.CONFIRM,
		JSON.stringify({ ops: r4ops("adopt").length, notice: first.noticeText }));
	r2check("4b the confirm sits with the control it names, inside the panel (not a toast, not the composer line)",
		first.noticeBox !== null && first.adoptBox !== null && first.noticeBox.y >= first.adoptBox.y - 4 &&
			first.noticeGapPx !== null && first.noticeGapPx < 12 && (first.bandLines ?? []).every((l) => !l.includes("Press")),
		JSON.stringify({ gapPx: first.noticeGapPx, noticeY: first.noticeBox?.y, adoptY: first.adoptBox?.y, bandLines: first.bandLines }));
	await h.take("09-u16-first-cmdf-confirm");

	// does it survive what it should? a keystroke in the composer is not a state change of the exchange
	await h.type("a draft the user was writing");
	await wait(400);
	const typed = await h.read();
	log("4c the confirm with a draft in the box", pick(typed, STD));
	r2check("4c a keystroke in the composer does not withdraw the confirm (nothing about the exchange changed)",
		(typed.noticeText ?? "") === UX3.CONFIRM && typed.fieldValue === "a draft the user was writing",
		JSON.stringify({ notice: typed.noticeText, fieldValue: typed.fieldValue }));
	await h.replaceComposer("");
	const cleared = await h.read();
	log("4c2 the confirm after the box was emptied", { notice: cleared.noticeText, fieldValue: cleared.fieldValue });
	// and a follow-up in the panel IS a state change: the arm must not carry over
	const beforeFollow = await h.read();
	void beforeFollow;
	const follow = await h.ask("U16 a follow-up asked after the first press", 30000);
	const afterFollow = await h.read();
	log("4d the confirm after a follow-up was asked", pick(afterFollow, STD));
	r2check("4d a follow-up asked after the first press withdraws the confirm (it cannot linger over a turn the user has not been shown)",
		(afterFollow.noticeText ?? "").includes(UX3.CONFIRM) === false || afterFollow.noticeText === null,
		JSON.stringify({ notice: afterFollow.noticeText, refusal: afterFollow.refusalText }));
	const ops1 = r4ops("adopt").length;
	await clickAt(cdp, UX3.FIELD);
	await h.cmdF();
	await wait(700);
	const rearmed = await h.read();
	log("4e the chord after the new turn: armed again, not adopted", { ...pick(rearmed, STD), adoptOps: r4ops("adopt").length });
	r2check("4e the arm does not carry over to a turn the user has not seen confirmed",
		r4ops("adopt").length === ops1 && (rearmed.noticeText ?? "") === UX3.CONFIRM,
		JSON.stringify({ ops: r4ops("adopt").length, notice: rearmed.noticeText }));
	await h.take("10-u16-rearmed-on-the-new-turn");
	// withdraw it again, because the keyboard-only path is the next subject
	await h.esc();
	await wait(300);

	/* --- the keyboard-only user: no chord at all ------------------------------ */
	const E = await ux3Base(cdp, h, "U16k the exchange adopted from the keyboard");
	await h.idle();
	await clickAt(cdp, UX3.FIELD);
	const stops = [];
	for (let i = 0; i < 4; i++) {
		await h.tab(true);
		await wait(250);
		const r = await h.read();
		stops.push(r.active);
		if ((r.active ?? "").includes(UX3.ADOPT.slice(0, 12))) break;
	}
	log("4f Shift+Tab stops from the composer, with an adoptable exchange up", stops);
	r2check("4f the adopt control is the composer's own Shift+Tab neighbour, so a keyboard user reaches it without the chord",
		(stops[0] ?? "").includes("Add to conversation"), JSON.stringify({ stops }));
	const ops2 = r4ops("adopt").length;
	const tEnter = Date.now();
	await h.enter();
	const goneK = await h.until((r) => r.panelUp === false, 8000);
	const painted = await r5PollPaint(cdp, tEnter, ["U16k the exchange adopted from the keyboard"], beforeU16.transcriptText ?? "", 20000);
	log("4g Enter on the focused control", { panelGoneMs: goneK.waitedMs, active: goneK.active, paintedMs: painted.at["U16k the exchange adopted from the keyboard"] ?? null, adoptOps: r4ops("adopt").length });
	r2check("4g Enter on the focused adopt control adopts, the panel detaches, and focus returns to the composer",
		r4ops("adopt").length === ops2 + 1 && goneK.panelUp === false && goneK.activeIsField === true,
		JSON.stringify({ ops: r4ops("adopt").length, active: goneK.active }));
	await h.take("11-u16k-adopted-from-the-keyboard");

	/* =====================================================================
	 * 5. The chord adopts: rows, then leave and re-enter the conversation
	 * ===================================================================== */
	await h.idle();
	const F = await ux3Base(cdp, h, "U16b the exchange adopted by the second chord");
	await h.ask("U16b a second turn in the same exchange", 30000);
	await h.idle();
	const f0 = await h.until((r) => h.settled(r), 30000);
	const beforeChord = await h.read();
	const hist0 = await r4History(sessionId);
	const ops3 = r4ops("adopt").length;
	await clickAt(cdp, UX3.FIELD);
	await h.cmdF();
	await h.until((r) => (r.noticeText ?? "") === UX3.CONFIRM, 8000);
	const tChord = Date.now();
	await h.cmdF();
	const goneC = await h.until((r) => r.panelUp === false, 8000);
	const chordPaint = await r5PollPaint(cdp, tChord, ["U16b the exchange adopted by the second chord", "U16b a second turn in the same exchange"], beforeChord.transcriptText ?? "", 20000);
	await wait(900);
	const afterChord = await h.read();
	const hist1 = await r4History(sessionId);
	log("5a the second press", { panelGoneMs: goneC.waitedMs, painted: chordPaint.at, active: goneC.active, adoptOps: r4ops("adopt").length });
	log("5a the daemon's record", { history: [hist0.count, hist1.count], hasQuestion: count(hist1.text, "U16b the exchange adopted by the second chord") });
	r2check("5a the second press adopts once: rows paint live, the panel detaches, focus returns",
		r4ops("adopt").length === ops3 + 1 && goneC.panelUp === false && goneC.activeIsField === true &&
			chordPaint.at["U16b the exchange adopted by the second chord"] !== undefined,
		JSON.stringify({ ops: r4ops("adopt").length, active: goneC.active, painted: chordPaint.at }));
	r2check("5a the exchange is in the conversation's own order, question then answer, and the question appears once",
		count(afterChord.transcriptText, "U16b the exchange adopted by the second chord") === 1 &&
			(afterChord.transcriptText ?? "").indexOf("U16b the exchange adopted by the second chord") < (afterChord.transcriptText ?? "").indexOf("U16b a second turn in the same exchange"),
		JSON.stringify({ occurrences: count(afterChord.transcriptText, "U16b the exchange adopted by the second chord") }));
	await h.take("12-u16b-second-press-adopted");

	const { away, awayUrl } = await ux3Leave(cdp, "/settings");
	const tRe = Date.now();
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	const re = await r5PollPaint(cdp, tRe, ["U16b the exchange adopted by the second chord"], "", 25000);
	await wait(600);
	const reBand = await h.read();
	log("5b away and back", { awayUrl, whileAway_transcriptMounted: away.transcriptText !== null, whileAway_hasQuestion: count(away.transcriptText, "U16b the exchange adopted by the second chord"), reEntryMs: re.at["U16b the exchange adopted by the second chord"] ?? null, occurrencesAfter: count(reBand.transcriptText, "U16b the exchange adopted by the second chord") });
	r2check("5b the adopted rows are still there after leaving the conversation and coming back, once each",
		count(away.transcriptText, "U16b the exchange adopted by the second chord") === 0 &&
			count(reBand.transcriptText, "U16b the exchange adopted by the second chord") === 1,
		JSON.stringify({ after: count(reBand.transcriptText, "U16b the exchange adopted by the second chord") }));
	await h.take("13-u16b-after-reentering");

	/* =====================================================================
	 * 6. U12 — the busy line's end state; U13 — the refused /btw note
	 * ===================================================================== */
	await h.idle();
	/*
	 * The busy window is the POST's flight, not the stream: `beginAsk` sets `streaming`
	 * at the press, so the follow-up has to be pressed BEFORE the answer lands.
	 * `SLOWANS` paces this ask's own chunks at 2 s each (this round's stub addition),
	 * which holds the window open long enough to type into.
	 */
	await h.replaceComposer("/btw SLOWANS: U12 a base turn for the busy window");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const inFlight = await h.until((r) => r.panelUp === true && r.announce === "Asking the aside", 6000);
	log("6a0 the aside is still answering", pick(inFlight, ["announce", "panelThinking", "panelText", "fieldValue"]));
	// press a follow-up while the aside is still answering (the POST is in flight)
	await clickAt(cdp, UX3.FIELD);
	await h.type("U12 a follow-up pressed before the answer lands");
	await h.enter();
	const busy = await h.until((r) => (r.bandLines ?? []).some((l) => l.includes("still answering")), 12000);
	log("6a the press while the aside is answering", pick(busy, STD));
	r2check("6a a follow-up pressed mid-answer stays in the composer and is told when and how to send it, without a second line saying to send it now",
		(busy.fieldValue ?? "").includes("U12 a follow-up pressed before the answer lands") &&
			(busy.bandLines ?? []).some((l) => l === UX3.BUSY) &&
			(busy.bandLines ?? []).every((l) => !l.includes(UX3.RETRY_SUFFIX)),
		JSON.stringify({ fieldValue: busy.fieldValue, bandLines: busy.bandLines }));
	await h.take("14-u12-busy-line-at-the-press");
	// the end state: the line retires when the answer is in
	const answered = await h.until((r) => (r.panelText ?? "").includes(UX3.TAIL) && r.adoptDisabled !== null, 30000);
	const rested = await h.until((r) => (r.bandLines ?? []).every((l) => !l.includes("still answering")), 20000);
	log("6b after the answer landed", pick(rested, STD));
	r2check("6b the busy line retires by itself once the answer is in, and the draft is still held",
		(rested.bandLines ?? []).every((l) => !l.includes("still answering")) &&
			(rested.fieldValue ?? "").includes("U12 a follow-up pressed before the answer lands"),
		JSON.stringify({ bandLines: rested.bandLines, fieldValue: rested.fieldValue }));
	await h.take("15-u12-busy-line-retired");
	// U13: the /btw door during the same kind of window
	await h.replaceComposer("/btw SLOWANS: U13 a second base turn for the slash door");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => r.panelUp === true && r.announce === "Asking the aside", 6000);
	await h.replaceComposer("/btw TOOLCALL2: U13 the slash door pressed mid-answer");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const slashBusy = await h.until((r) => (r.bandLines ?? []).some((l) => l.includes("still answering")) || (r.refusalText ?? "").includes("still answering"), 12000);
	log("6c the /btw door mid-answer", { ...pick(slashBusy, STD), where: await ux3Where(cdp, "still answering") });
	r2check("6c the /btw door mid-answer states the busy sentence on the composer's own line, not as a transcript receipt",
		(slashBusy.bandLines ?? []).some((l) => l.includes("still answering")) &&
			count(slashBusy.transcriptText, "got no answer") === 0,
		JSON.stringify({ bandLines: slashBusy.bandLines, transcriptHasReceipt: count(slashBusy.transcriptText, "got no answer") }));
	await h.take("16-u13-slash-door-mid-answer");
	await h.esc();
	await wait(400);

	/* =====================================================================
	 * 7. U14 — a staged quote in the aside; U15 — the announcement
	 * ===================================================================== */
	await h.idle();
	await h.replaceComposer("U14 a plain thread question to have a row to quote");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX3.TAIL) && !r.transcriptWorking, 60000);
	await wait(700);
	/*
	 * The Quote control only exists while the selection does, and a press that lands
	 * between the selection and the toolbar's own render stages nothing (measured in
	 * this pass: a press with the toolbar present and the chip list empty). So the
	 * selection and the press are retried together until the composer shows the chip -
	 * and how many attempts it took is part of the reading.
	 */
	let chips = [];
	let attempts = 0;
	for (let i = 0; i < 3 && chips.length === 0; i++) {
		attempts += 1;
		/*
		 * THE ROW HAS TO BE ON SCREEN BEFORE THE TOOLBAR IS PRESSED. The toolbar is
		 * anchored to the selection, so a quote taken from a row that has scrolled out
		 * of the viewport puts the Quote control ABOVE the window (measured this pass:
		 * x 583, y -691) and a press at that point reaches nothing at all.
		 */
		const sel = await cdp.evaluate(`(() => {
			const tr = document.querySelector("[data-lo-transcript-content]");
			const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
			for (let n = w.nextNode(); n; n = w.nextNode()) {
				const i = n.nodeValue.indexOf("inside a moving window");
				if (i >= 0) {
					const row = n.parentElement.closest("[data-lo-transcript-row], div");
					(row || n.parentElement).scrollIntoView({ block: "center" });
					const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + "inside a moving window".length);
					const s = getSelection(); s.removeAllRanges(); s.addRange(r);
					return { selected: true, rowTop: Math.round((row || n.parentElement).getBoundingClientRect().top) };
				}
			}
			return { selected: false, rowTop: null };
		})()`);
		await wait(800);
		const qb = await cdp.evaluate(`(() => { const b = document.querySelector('button[aria-label="Quote"]'); if (!b) return null; const r = b.getBoundingClientRect(); const inside = r.top > 40 && r.bottom < window.innerHeight - 40; return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), onScreen: inside, innerHeight: window.innerHeight }; })()`);
		if (qb && qb.onScreen) await qaPressPoint(cdp, qb);
		await wait(800);
		chips = await ux3Chips(cdp);
		log("7a the quote staged (attempt " + attempts + ")", { selected: sel, quoteButton: qb, chips });
	}
	r2check("7a the transcript's quote control stages a chip (so the panel's own question is the subject of 7b)", chips.length === 1, JSON.stringify({ attempts, chips }));
	await h.replaceComposer("/btw");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => r.panelUp === true, 8000);
	const quoteAnswered = await h.ask("U14 the question asked with a quote staged", 30000);
	const quoteGeo = await r3Read(cdp);
	const quoteNow = await h.read();
	log("7b the panel's question with a quote staged", { panelText: quoteNow.panelText, hasReplyMarkup: quoteNow.panelHasReplyMarkup, quoteBlock: quoteNow.answerHasQuoteBlock, questionText: quoteGeo.geo?.questionText, chips: await ux3Chips(cdp) });
	r2check("7b the panel paints the staged quote as a quote, never as <reply-to> markup",
		quoteNow.panelHasReplyMarkup === false && (quoteGeo.geo?.questionText ?? "").includes("inside a moving window") &&
			(quoteGeo.geo?.questionText ?? "").includes("U14 the question asked with a quote staged"),
		JSON.stringify({ markup: quoteNow.panelHasReplyMarkup, question: quoteGeo.geo?.questionText }));
	log("7c the settle announcement (U15: no markdown reaches the reader)", { announce: quoteAnswered.announce, hasAsterisks: /\*/.test(quoteAnswered.announce ?? "") });
	r2check("7c the announcement carries no markdown syntax into the screen reader",
		quoteAnswered.announce !== null && !/\*\*|__|~~/.test(quoteAnswered.announce ?? ""),
		JSON.stringify({ announce: quoteAnswered.announce }));
	await h.take("17-u14-quote-in-the-panel");
	await h.esc();
	await wait(400);

	// U15 read at the settle of a fresh ask whose answer carries markdown
	const ann = await h.ask("U15 an ask whose answer carries markdown", 30000, true);
	log("7d the announcement for an answer with markdown in it", { announce: ann.announce, hasMarkdownSyntax: /\*\*|__|~~/.test(ann.announce ?? "") });
	r2check("7d a screen reader hears the words, not the markdown",
		(ann.announce ?? "").length > 0 && !/\*\*|__|~~/.test(ann.announce ?? ""),
		JSON.stringify({ announce: ann.announce }));
	await h.take("18-u15-announcement");

	/* =====================================================================
	 * 8. U3 and U7 — the two flow properties the scroll rules moved under
	 * ===================================================================== */
	await h.esc();
	await wait(400);
	await h.idle();
	await h.replaceComposer("SLOWTURN: U3 take your time answering this one");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const working = await h.until((r) => r.transcriptWorking === true, 20000);
	log("8a the conversation is working", pick(working, ["busy", "placeholder", "transcriptWorking", "active"]));
	const t3 = Date.now();
	await h.replaceComposer("/btw LONGANSWER U3 an aside while the agent works");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	const u3r = await h.ask("U3 an aside while the agent works", 30000);
	await wait(900);
	log("8b the aside answered while the turn ran", { msSinceAsk: Date.now() - t3, ...pick(u3r, STD) });
	r2check("8b the answer completes and is announced while the conversation still works",
		(u3r.panelText ?? "").includes("LONG-END.") && u3r.transcriptWorking === true && (u3r.announce ?? "").includes("The aside answered"),
		JSON.stringify({ announce: u3r.announce, working: u3r.transcriptWorking }));
	r2check("8b the blocked reason names the conversation while it works, and nothing says 'a moment' under a finished answer",
		(u3r.adoptReason ?? "").includes("This conversation is working") && !(u3r.panelText ?? "").includes("A moment"),
		JSON.stringify({ reason: u3r.adoptReason }));
	await h.take("19-u3-answered-while-working");
	const freed = await h.until((r) => h.settled(r), 60000);
	log("8c the turn ended", { msSinceAsk: Date.now() - t3, active: freed.active, adoptDisabled: freed.adoptDisabled, reason: freed.adoptReason, busy: freed.busy });
	r2check("8c the adopt goes live by itself when the turn ends, with no press",
		freed.adoptDisabled === false, JSON.stringify({ ms: Date.now() - t3 }));
	await h.take("20-u3-adopt-live-after-the-turn");
	// U7: the region reachable and scrollable by keyboard
	await clickAt(cdp, UX3.FIELD);
	const u7stops = [];
	for (let i = 0; i < 4; i++) {
		await h.tab(true);
		await wait(250);
		const r = await h.read();
		u7stops.push(r.active);
		if ((r.active ?? "").includes("The aside exchange")) break;
	}
	const regionScroll = async (key, code, vk) => {
		await pressChord(cdp, { key, code, virtualKeyCode: vk });
		await wait(300);
		return (await h.read()).region;
	};
	const rTop = await regionScroll("Home", "Home", 36);
	const rEnd = await regionScroll("End", "End", 35);
	const rUp = await regionScroll("PageUp", "PageUp", 33);
	log("8d the region by keyboard", { stops: u7stops, home: rTop, end: rEnd, pageUp: rUp });
	r2check("8d the exchange region is reachable from the composer and scrolls under the keyboard",
		u7stops.some((s) => (s ?? "").includes("The aside exchange")) &&
			rTop !== null && rEnd !== null && (rTop.maxScroll ?? 0) > 0 && rEnd.scrollTop > rTop.scrollTop,
		JSON.stringify({ stops: u7stops, home: rTop?.scrollTop ?? null, end: rEnd?.scrollTop ?? null, maxScroll: rTop?.maxScroll ?? null }));
	await h.take("21-u7-region-focused");
	await clickAt(cdp, UX3.FIELD);

	/* =====================================================================
	 * 9. The adopt end to end — what was added, and is it obviously part of the
	 *    conversation.
	 * ===================================================================== */
	await h.idle();
	const QADOPT = "UADOPT the exchange adopted end to end";
	await ux3Base(cdp, h, QADOPT);
	await h.idle();
	await h.until((r) => r.adoptDisabled === false, 40000);
	const placeBefore = (await h.read()).placeholder;
	const beforeAdv = await h.read();
	const histA0 = await r4History(sessionId);
	await h.take("22-uadopt-panel-before-the-chord");
	const ops = r4ops("adopt").length;

	await clickAt(cdp, UX3.FIELD);
	await h.cmdF();
	await wait(700);
	const armedAdv = await h.read();
	log("9a after the first chord", { ...pick(armedAdv, STD), adoptOps: r4ops("adopt").length });
	r2check("9a the first chord confirms and adds nothing",
		r4ops("adopt").length === ops && armedAdv.panelUp === true && (armedAdv.noticeText ?? "") === UX3.CONFIRM,
		JSON.stringify({ ops: r4ops("adopt").length, notice: armedAdv.noticeText }));
	await h.take("23-uadopt-first-chord-confirm");

	const tAdopt = Date.now();
	await h.cmdF();
	let goneAdv = null;
	for (let i = 0; i < 200; i++) { if ((await h.read()).panelUp === false) { goneAdv = Date.now() - tAdopt; break; } await wait(25); }
	const paintAdv = await r5PollPaint(cdp, tAdopt, [QADOPT], beforeAdv.transcriptText ?? "");
	await wait(900);
	const afterAdv = await h.read();
	const histA1 = await r4History(sessionId);
	const at = paintAdv.at[QADOPT];
	/*
	 * WHERE THE NEW ROWS LANDED, relative to the viewport the reader is looking at:
	 * the transcript's nearest scrollable ancestor against the adopted question's own
	 * box. A row spliced in below the fold is added but not SEEN, which is a different
	 * experience from the panel vanishing and the exchange appearing in front of you.
	 */
	const visAdv = await cdp.evaluate(`(() => {
		const content = document.querySelector("[data-lo-transcript-content]");
		if (!content) return null;
		const needle = ${JSON.stringify(QADOPT)};
		const walk = document.createTreeWalker(content, NodeFilter.SHOW_TEXT);
		let found = null;
		for (let n = walk.nextNode(); n; n = walk.nextNode()) { if (n.nodeValue.includes(needle)) { found = n.parentElement; break; } }
		if (!found) return { found: false };
		let scroller = found.parentElement;
		while (scroller && scroller !== document.body) {
			const s = getComputedStyle(scroller);
			if ((s.overflowY === "auto" || s.overflowY === "scroll") && scroller.scrollHeight > scroller.clientHeight + 1) break;
			scroller = scroller.parentElement;
		}
		const r = found.getBoundingClientRect();
		const v = scroller ? scroller.getBoundingClientRect() : { top: 0, bottom: window.innerHeight };
		return { found: true, scrollerTag: scroller ? scroller.tagName + "." + (scroller.className || "").slice(0, 40) : null,
			rowTop: Math.round(r.top), rowBottom: Math.round(r.bottom), viewTop: Math.round(v.top), viewBottom: Math.round(v.bottom),
			rowFullyInView: r.top >= v.top - 1 && r.bottom <= v.bottom + 1,
			rowAboveViewBottomByPx: Math.round(v.bottom - r.bottom), occurrences: ${JSON.stringify(QADOPT)} && (content.textContent.split(needle).length - 1) };
	})()`);
	log("9b the adopt", { panelGoneMs: goneAdv, questionPaintedMs: at, occurrences: visAdv?.occurrences,
		rows: { ...pick(afterAdv, ["panelUp", "active", "activeIsField", "placeholder", "bandLines"]) }, visAdv,
		history: [histA0.count, histA1.count], adoptOps: r4ops("adopt").length - ops });
	r2check("9b the second chord adopts: one POST, the panel detaches, the question paints once, and it is in the daemon's record",
		r4ops("adopt").length - ops === 1 && goneAdv !== null && at !== undefined && visAdv?.occurrences === 1 && histA1.count === histA0.count + 2,
		JSON.stringify({ goneAdv, paintedMs: at, occurrences: visAdv?.occurrences, history: [histA0.count, histA1.count] }));
	r2check("9b the adopted exchange lands in the reader's view rather than below the fold",
		visAdv?.found === true && visAdv.rowFullyInView === true,
		JSON.stringify(visAdv));
	r2check("9b the off-the-record affordance is gone once the exchange is part of the conversation",
		(afterAdv.placeholder ?? "").includes("Ask off the record") === false && afterAdv.activeIsField === true && (afterAdv.bandLines ?? []).length === 0,
		JSON.stringify({ placeholderBefore: placeBefore, placeholderAfter: afterAdv.placeholder, active: afterAdv.active }));
	await h.take("24-uadopt-adopted-in-the-transcript");

	// the exchange is part of the conversation after LEAVING it and coming backAdv
	const { away: awayAdv, awayUrl: awayUrlAdv } = await ux3Leave(cdp, "/settings");
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	const reTAdv = Date.now();
	const backAdv = await h.until((r) => qaCount(r.transcriptText, QADOPT) > 0, 400);
	const reMsAdv = Date.now() - reTAdv;
	const reAdv = await h.read();
	log("9c after leaving and re-entering", { awayUrlAdv, transcriptMountedWhileAway: awayAdv.transcriptText !== null, msSinceReEnter: reMsAdv,
		occurrences: qaCount(reAdv.transcriptText, QADOPT) });
	r2check("9c the adopted exchange is still part of the conversation after leaving it and coming back, once",
		awayAdv.transcriptText === null && qaCount(reAdv.transcriptText, QADOPT) === 1,
		JSON.stringify({ awayUrlAdv, occurrences: qaCount(reAdv.transcriptText, QADOPT) }));
	await h.take("25-uadopt-after-reentering");
	note("UX3 scene", "finished");
}

/* ===================================================================== *
 *  PASS B — NARROW (800x900): the same arms where the region is 234px wide
 * ===================================================================== */

async function sceneBtwUx3b(cdp) {
	const facts = await factsOf(cdp);
	r2check("headless and never shown", facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX3b session", sessionId);
	const P = `ux3b-${RUN_LABEL}`;
	const h = await ux3Harness(cdp, P);
	const log = (label, value) => note(label, JSON.stringify(value));
	const STD = ["active", "fieldValue", "refusalText", "noticeText", "adoptDisabled", "adoptReason", "bandLines", "region"];
	const count = (s, n) => qaCount(s ?? "", n);
	const width = await cdp.evaluate("window.innerWidth");
	log("B0 the window", { innerWidth: width, innerHeight: await cdp.evaluate("window.innerHeight") });

	await h.replaceComposer("narrow seed turn");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX3.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	// --- U11 at narrow, with the clip measured -------------------------------
	const A = await ux3Base(cdp, h, "UN what does the retry budget cap");
	await clickAt(cdp, UX3.FIELD);
	await h.type("TOOLCALL2: UN the follow-up the model declines");
	await h.enter();
	const decl = await h.until((r) => r.refusalText !== null, 30000);
	await wait(900);
	const declR = await h.read();
	const clip = await r5Clip(cdp);
	log("B1 the declined follow-up's refusal at narrow", { ...Object.fromEntries(STD.map((k) => [k, declR[k]])), clip });
	r2check("B1 at narrow the whole refusal is in view - every clause of it, the one naming Esc's cost included",
		clip !== null && clip.rows === clip.rowsFullyVisible && clip.hiddenBelowPx <= 0.5 && clip.phrase?.visible === true,
		JSON.stringify(clip));
	await h.take("b01-narrow-declined-refusal");
	const retry = await h.ask("UN the retry in place", 40000);
	r2check("B1 at narrow the retry in the same panel is answered too",
		count(retry.panelText, UX3.TAIL) >= 2 && (retry.region?.turns ?? 0) === 3,
		JSON.stringify({ tails: count(retry.panelText, UX3.TAIL), turns: retry.region?.turns }));
	await h.take("b02-narrow-retry-answered");

	// --- U16 at narrow: the confirm has 236px to fit in ----------------------
	await h.idle();
	const D = await ux3Base(cdp, h, "UN16 the exchange adopted by chord");
	await h.idle();
	await h.until((r) => r.adoptDisabled === false, 30000);
	await clickAt(cdp, UX3.FIELD);
	const ops0 = r4ops("adopt").length;
	await h.cmdF();
	await wait(700);
	const first = await h.read();
	const confirmGeo = await cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		if (!panel) return null;
		const alerts = Array.from(panel.querySelectorAll('[role="alert"]'));
		const n = alerts[alerts.length - 1];
		if (!n) return null;
		const rr = n.getBoundingClientRect();
		const r = document.createRange(); r.selectNodeContents(n);
		const rows = [];
		for (const x of r.getClientRects()) { if (!rows.some((y) => Math.abs(y.top - x.top) < 2)) rows.push({ top: x.top, bottom: x.bottom, w: x.width }); }
		rows.sort((a, b) => a.top - b.top);
		return { text: n.textContent.replace(/\\s+/g, " ").trim(), rows: rows.length, boxW: Math.round(rr.width), boxH: Math.round(rr.height),
			rowsFullyInPanel: rows.filter((y) => y.top >= rr.top - 0.5 && y.bottom <= rr.bottom + 0.5).length,
			longestRowFraction: Math.round((Math.max(...rows.map((y) => y.width)) / rr.width) * 100) / 100,
			ellipsised: n.scrollWidth > n.clientWidth + 1 || n.scrollHeight > n.clientHeight + 1 };
	})()`);
	log("B2 the confirm at narrow", { ...Object.fromEntries(STD.map((k) => [k, first[k]])), confirmGeo, adoptOps: r4ops("adopt").length });
	r2check("B2 at narrow the confirm is whole: every row of it is on the panel, nothing is clipped or ellipsised",
		confirmGeo !== null && confirmGeo.rows === confirmGeo.rowsFullyInPanel && confirmGeo.ellipsised === false &&
			confirmGeo.rows >= 2 && r4ops("adopt").length === ops0,
		JSON.stringify(confirmGeo));
	r2check("B2 the first press still only confirms at narrow", r4ops("adopt").length === ops0 && first.panelUp === true, JSON.stringify({ ops: r4ops("adopt").length }));
	await h.take("b03-narrow-confirm-line");

	// --- Q46 judged in the flow: a WRAPPED staged quote at the region's edge --
	const quote = "inside a moving window";
	let chipsB = [];
	for (let i = 0; i < 3 && chipsB.length === 0; i++) {
		const selB = await cdp.evaluate(`(() => {
			const tr = document.querySelector("[data-lo-transcript-content]");
			const w = document.createTreeWalker(tr, NodeFilter.SHOW_TEXT);
			for (let n = w.nextNode(); n; n = w.nextNode()) {
				const i = n.nodeValue.indexOf(${JSON.stringify(quote)});
				if (i >= 0) {
					const row = n.parentElement.closest("[data-lo-transcript-row], div");
					(row || n.parentElement).scrollIntoView({ block: "center" });
					const r = document.createRange(); r.setStart(n, i); r.setEnd(n, i + ${JSON.stringify(quote)}.length);
					const s = getSelection(); s.removeAllRanges(); s.addRange(r);
					return true;
				}
			}
			return false;
		})()`);
		await wait(800);
		const qb = await cdp.evaluate(`(() => { const b = document.querySelector('button[aria-label="Quote"]'); if (!b) return null; const r = b.getBoundingClientRect(); return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2), onScreen: r.top > 40 && r.bottom < window.innerHeight - 40 }; })()`);
		if (qb && qb.onScreen) await qaPressPoint(cdp, qb);
		await wait(800);
		chipsB = await ux3Chips(cdp);
		log("B3 the quote staged at narrow (attempt " + (i + 1) + ")", { selected: selB, quoteButton: qb, chips: chipsB });
	}
	await h.replaceComposer("/btw");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => r.panelUp === true, 8000);
	const wrappedQ = await h.ask("UN46 the question under a quote that wraps", 40000);
	const wrappedNow = await h.read();
	const wrapped = await r5Clip(cdp);
	const wrappedGeo = await r3Read(cdp);
	log("B3 the panel's edge with a wrapped quote", { chips: chipsB, questionText: wrappedGeo.geo?.questionText, clip: wrapped,
		clippedLastLineFraction: wrappedNow.exchange?.clippedLastLineFraction, panelText: (wrappedNow.panelText ?? "").slice(0, 200) });
	r2check("B3 at narrow the four-line confirm and a wrapped quote are on the same panel together",
		chipsB.length === 1 && (wrappedGeo.geo?.questionText ?? "").includes("inside a moving window"),
		JSON.stringify({ chips: chipsB, question: wrappedGeo.geo?.questionText }));
	await h.take("b04-narrow-wrapped-quote-at-the-edge");
	note("UX3b scene", "finished");
}

/* ===================================================================== *
 *  PASS C — the ⌘+F hazard itself, at the edges the two-press rule leaves
 * ===================================================================== */

async function sceneBtwUx3c(cdp) {
	const facts = await factsOf(cdp);
	r2check("headless and never shown", facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX3c session", sessionId);
	const P = `ux3c-${RUN_LABEL}`;
	const h = await ux3Harness(cdp, P);
	const log = (label, value) => note(label, JSON.stringify(value));
	await cdp.evaluate(`(() => { window.__ux3Keys = []; window.addEventListener("keydown", (e) => {
		if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
		window.__ux3Keys.push({ prevented: e.defaultPrevented, at: Math.round(performance.now()) });
	}); return true; })()`);

	await h.replaceComposer("ux3c seed turn");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX3.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	// --- C1: a HABITUAL DOUBLE-TAP, 60ms apart, on an adoptable exchange ---------
	await ux3Base(cdp, h, "UC1 the exchange a double-tap meets");
	await h.idle();
	await h.until((r) => r.adoptDisabled === false, 40000);
	await clickAt(cdp, UX3.FIELD);
	const ops0 = r4ops("adopt").length;
	const t0 = Date.now();
	await h.cmdF();
	await wait(60);
	await h.cmdF();
	await wait(1200);
	const afterTap = await h.read();
	const keys = await cdp.evaluate("window.__ux3Keys");
	log("C1 two ⌘+F presses 60ms apart", { panelUp: afterTap.panelUp, notice: afterTap.noticeText, adoptOps: r4ops("adopt").length - ops0,
		keys, msFromFirstPress: Date.now() - t0, adoptDisabled: afterTap.adoptDisabled });
	/*
	 * A note rather than a check: this is the reading the U16 judgement is made on, and the
	 * honest expectation is not obvious in advance - the arm is keyed on the TURN ID and not
	 * on a clock, so two presses that arrive back to back are as good as two deliberate ones.
	 */
	await h.take("c01-double-tap");

	// --- C2: the chord with the caret NOT in the box ------------------------------
	{
		/* The double-tap above adopted, so this arm builds its own exchange. */
		await ux3Base(cdp, h, "UC2 the exchange a chord outside the box meets");
		await h.idle();
		await h.until((r) => r.adoptDisabled === false, 40000);
		const opsBeforeC2 = r4ops("adopt").length;
		const focusStops = [];
		for (let i = 0; i < 3; i++) {
			await h.tab(true);
			await wait(250);
			const r = await h.read();
			focusStops.push(r.active);
			if ((r.active ?? "").includes("The aside exchange")) break;
		}
		const beforeC2 = await h.read();
		await h.cmdF();
		await wait(800);
		const afterC2 = await h.read();
		log("C2 ⌘+F with the caret out of the box", { focusStops, focusBefore: beforeC2.active, focusAfter: afterC2.active,
			noticeBefore: beforeC2.noticeText, noticeAfter: afterC2.noticeText, adoptOps: r4ops("adopt").length - opsBeforeC2,
			keys: await cdp.evaluate("window.__ux3Keys") });
		r2check("C2 a ⌘+F pressed outside the composer neither adopts nor confirms - the chord belongs to the box",
			r4ops("adopt").length === opsBeforeC2 && (afterC2.noticeText ?? null) === (beforeC2.noticeText ?? null),
			JSON.stringify({ ops: r4ops("adopt").length - opsBeforeC2, noticeBefore: beforeC2.noticeText, noticeAfter: afterC2.noticeText }));
		await h.take("c02-chord-outside-the-box");
		await clickAt(cdp, UX3.FIELD);
	}

	// --- C3: an UNFIT press (the exchange still settling) ------------------------
	await h.esc();
	await wait(400);
	await h.replaceComposer("/btw SLOWANS UC3 an exchange that is still settling when ⌘+F is pressed");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => r.panelUp === true && r.announce === "Asking the aside", 6000);
	const beforeC3 = await h.read();
	await h.cmdF();
	await wait(900);
	const afterC3 = await h.read();
	log("C3 ⌘+F while the exchange is still settling", { active: beforeC3.active, adoptDisabled: beforeC3.adoptDisabled,
		reason: beforeC3.adoptReason, noticeBefore: beforeC3.noticeText, noticeAfter: afterC3.noticeText, bandLines: afterC3.bandLines,
		keys: await cdp.evaluate("window.__ux3Keys") });
	r2check("C3 an unfit chord falls through with no adopt and no confirm, and the panel is already saying why the control is not live",
		afterC3.noticeText === null && (beforeC3.adoptReason ?? "").length > 0,
		JSON.stringify({ notice: afterC3.noticeText, reason: beforeC3.adoptReason }));
	await h.take("c03-unfit-chord");
	note("UX3c scene", "finished");
}

/* ===================================================================== *
 *  PASS D — R7-3 in the flow: a diagram that lands AFTER the settle
 * ===================================================================== */

async function sceneBtwUx3d(cdp) {
	const facts = await factsOf(cdp);
	r2check("headless and never shown", facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX3d session", sessionId);
	const h = await ux3Harness(cdp, `ux3d-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));

	await h.replaceComposer("ux3d seed turn");
	await clickAt(cdp, UX3.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX3.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/* The reading: the region and the newest answer, as the diagram replaces its fence. */
	const diagram = () => cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const svg = region.querySelector("svg.mermaid, svg[id^=mermaid], [data-lo-mermaid] svg, svg");
		const svgR = svg ? svg.getBoundingClientRect() : null;
		const rows = Array.from(region.querySelectorAll("[style*='line-height'], p, li, span"));
		const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
		return {
			scrollTop: Math.round(region.scrollTop * 10) / 10,
			maxScroll: region.scrollHeight - region.clientHeight,
			clientHeight: region.clientHeight,
			contentHeight: region.scrollHeight,
			svgPresent: svg !== null,
			svgTop: svgR ? Math.round(svgR.top - rr.top) : null,
			svgBottom: svgR ? Math.round(svgR.bottom - rr.top) : null,
			svgFullyInView: svgR ? svgR.top >= rr.top - 0.5 && svgR.bottom <= rr.bottom + 0.5 : null,
			svgHeight: svgR ? Math.round(svgR.height) : null,
			lastRowBottomVsClip: last ? Math.round((last.bottom - rr.bottom) * 10) / 10 : null,
			text: (region.textContent || "").replace(/\s+/g, " ").trim().slice(-90),
		};
	})()`);

	await h.replaceComposer("/btw MERMAIDANS draw me the aside flow");
	await clickAt(cdp, UX3.FIELD);
	const tPress = Date.now();
	await h.enter();
	/*
	 * Sampled FROM THE PRESS, not from the settle: the diagram's module is a dynamic
	 * import, so the interesting frames are the ones between the text landing and the
	 * SVG replacing its fence - and a reading taken after the settle has already missed
	 * them (measured in the first attempt at this arm: the SVG was present in the very
	 * first sample).
	 */
	const samples = [];
	let sawText = null;
	let sawSvg = null;
	for (let i = 0; i < 500; i++) {
		const d = await diagram();
		const ms = Date.now() - tPress;
		if (d) {
			if (sawText === null && d.contentHeight > 0) sawText = ms;
			if (sawSvg === null && d.svgPresent) sawSvg = ms;
			const prev = samples[samples.length - 1];
			if (!prev || prev.contentHeight !== d.contentHeight || prev.svgPresent !== d.svgPresent || prev.scrollTop !== d.scrollTop)
				samples.push({ ms, svg: d.svgPresent, contentHeight: d.contentHeight, scrollTop: d.scrollTop, maxScroll: d.maxScroll });
		}
		if (sawSvg !== null && ms - sawSvg > 3000) break;
		await wait(50);
	}
	const settled = await diagram();
	log("D1 the panel from the press to the diagram", { sawTextMs: sawText, sawSvgMs: sawSvg, samples: samples.slice(0, 30) });
	log("D1 after the diagram landed", settled);
	/*
	 * Is anything LOST, or only not brought into view? Scrolling the region to its own
	 * maximum answers that: if the diagram's bottom is reachable there, the user can see
	 * all of it, which is the difference between a rough edge (Q46) and a loss.
	 */
	const reachable = await cdp.evaluate(`(() => {
		const region = document.querySelector('[data-lo-aside-panel] [aria-label="The aside exchange"]');
		if (!region) return null;
		region.scrollTop = region.scrollHeight;
		const rr = region.getBoundingClientRect();
		const svg = region.querySelector("svg");
		const s = svg ? svg.getBoundingClientRect() : null;
		return { scrollTop: Math.round(region.scrollTop), maxScroll: region.scrollHeight - region.clientHeight,
			svgBottomInRegion: s ? Math.round(s.bottom - rr.top) : null, clientHeight: region.clientHeight,
			svgFullyInView: s ? s.top >= rr.top - 0.5 && s.bottom <= rr.bottom + 0.5 : null };
	})()`);
	log("D1 with the region scrolled to its own end", reachable);
	/*
	 * NOT "the whole diagram is in view": the diagram is 486px tall in a 248px region, so no
	 * scroll position can hold all of it, and demanding one would be a check that cannot
	 * pass. What matters is that every part of it is REACHABLE - its top at the region's
	 * start, its bottom at the region's end - which is the line between a rough edge and a
	 * loss.
	 */
	r2check("D1 a late diagram is reachable: its top is in view at the region's start and its bottom at the region's end",
		settled !== null && settled.svgTop >= 0 && reachable !== null && reachable.svgBottomInRegion <= reachable.clientHeight,
		JSON.stringify({ svgTopAtRest: settled?.svgTop, reachable }));
	r2check("D1 the region did not chase the growth on its own (the trigger names phase and length, and a diagram changes neither)",
		settled !== null && settled.scrollTop === 0 && settled.maxScroll > 0,
		JSON.stringify({ scrollTop: settled?.scrollTop, maxScroll: settled?.maxScroll, contentHeight: settled?.contentHeight }));
	await h.take("d01-diagram-lands-after-the-settle");
	note("UX3d scene", "finished");
}
