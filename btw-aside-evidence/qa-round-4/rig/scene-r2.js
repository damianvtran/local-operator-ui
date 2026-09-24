
/* ===================================================================== *
 *        QA ROUND 2 (independent) — the /btw aside, delta since ffa9ce94d
 *
 * Appended to a COPY of scripts/renderer-driver.mjs in the QA worktree, with
 * round 1's helper layer (readQaBand, qaAwaitPanel, qaAdoptControl, qaPressPoint,
 * qaAnswerOf, qaCount, qaSessionHistory, qaSubmitTurn, qaWarmSession,
 * qaOpenSession) above it verbatim. The app's source is unmodified.
 * ===================================================================== */

const R2 = {
	FIELD: 'textarea[aria-label="Message"]',
	QUESTION: "what does the retry budget actually cap?",
	TAIL: "wrong, not the provider",
	ANSWER_HEAD: "Transport failures and owner",
	UNANSWERED: "did not answer your aside in text",
	EMPTY: "answered your aside with no text at all",
	EMPTY_COPY: "Type a question in the composer below",
	BUSY: "This conversation is working.",
	// QA round 4: D14 re-worded the off-panel form of a model refusal (deliberate delta).
	OFFPANEL: "got no answer: The model didn't reply in text. Ask again.",
};

/** check() with the detail echoed on PASS too, so the log carries readings. */
function r2check(label, ok, detail) {
	return check(label, ok, detail, detail);
}

/** Whole-page text, for "is the sentence visible ANYWHERE" (a note, a band line). */
function r2PageText(cdp) {
	return cdp.evaluate(
		`document.body.innerText.replace(/\\s+/g, " ")`,
	);
}

function r2Harness(cdp) {
	const frames = [];
	const FRAME_PREFIX = RUN_LABEL ? `qa2-${RUN_LABEL}` : "qa2";
	const take = async (label, mode = "settled") => {
		const frame =
			mode === "settled"
				? await captureSettled(cdp, `${FRAME_PREFIX}-${label}`)
				: await capture(cdp, `${FRAME_PREFIX}-${label}`);
		frames.push({ ...frame, mode });
		note("frame", JSON.stringify({ label: frame.label, mode, ...frame.pixels }));
		return frame;
	};
	const enter = () =>
		pressChord(cdp, { key: "Enter", code: "Enter", virtualKeyCode: 13 });
	const escape = () =>
		pressChord(cdp, { key: "Escape", code: "Escape", virtualKeyCode: 27 });
	const replaceComposer = async (text) => {
		await clickAt(cdp, R2.FIELD);
		await pressChord(cdp, {
			key: "a",
			code: "KeyA",
			virtualKeyCode: 65,
			modifiers: MODIFIER.meta,
			commands: ["selectAll"],
		});
		await cdp.send("Input.insertText", { text });
		await wait(200);
	};
	const adoptOf = (band) =>
		(band.panelButtons ?? []).find((b) => b.text.startsWith("Add to conversation"));
	return { frames, take, enter, escape, replaceComposer, adoptOf };
}

function r2FramesCheck(frames) {
	check(
		"every capture wrote a PNG of the requested size",
		frames.every(
			(f) =>
				f.bytes > 1000 &&
				f.pixels.width === f.viewport.width * f.viewport.devicePixelRatio &&
				f.pixels.height === f.viewport.height * f.viewport.devicePixelRatio,
		),
		frames.map((f) => `${f.label}: ${f.pixels.width}x${f.pixels.height}`).join(" | "),
	);
}

/**
 * btw-r2 — the current-daemon pass: streaming (b), the Q2 paint (a), refusal
 * 409s on the panel (e), F9 on both doors (c), and the neighbours (f).
 */
async function sceneBtwR2(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("R2 session", sessionId);
	const { frames, take, enter, escape, replaceComposer, adoptOf } = r2Harness(cdp);
	const awaitPanel = (want, n = 80) => qaAwaitPanel(cdp, want, n);

	// ---- (b) streaming ------------------------------------------------------
	await cdp.send("Input.insertText", { text: `/btw ${R2.QUESTION}` });
	await wait(200);
	await enter();
	const thinking = await awaitPanel((b) => b.panel !== null);
	r2check(
		"(b) one Enter attaches the panel with the question asked",
		(thinking.panelText ?? "").includes(R2.QUESTION),
		JSON.stringify(thinking.panelText),
	);
	await take("01-thinking", "raw");
	const samples = [];
	let partialA = null;
	let partialB = null;
	const t0 = Date.now();
	for (let i = 0; i < 300; i++) {
		const now = await readQaBand(cdp);
		const answer = qaAnswerOf(now.panelText, R2.QUESTION);
		samples.push({ ms: Date.now() - t0, len: answer.length });
		if (partialA === null && answer.length > 0 && !answer.includes(R2.TAIL)) {
			partialA = answer;
			await take("02-partial-a", "raw");
		} else if (partialA !== null && partialB === null && answer.length >= partialA.length + 15 && !answer.includes(R2.TAIL)) {
			partialB = answer;
			await take("03-partial-b", "raw");
		}
		if ((now.panelText ?? "").includes(R2.TAIL)) break;
		await wait(60);
	}
	const distinct = [...new Set(samples.map((s) => s.len))].filter((l) => l > 0);
	note("(b) visible answer length samples", JSON.stringify(samples.filter((s, i) => i % 3 === 0).slice(0, 60)));
	r2check(
		"(b) the answer was painted at >=3 distinct partial lengths before settling",
		distinct.length >= 3 && partialA !== null && partialB !== null,
		`distinct lengths ${JSON.stringify(distinct)}; partial A ${partialA?.length}, B ${partialB?.length}`,
	);
	const settled = await awaitPanel((b) => (b.panelText ?? "").includes(R2.TAIL) && adoptOf(b)?.disabled === false, 300);
	r2check(
		"(b) the settled panel holds the whole answer and adopt goes live",
		(settled.panelText ?? "").includes(R2.ANSWER_HEAD) && adoptOf(settled)?.disabled === false,
		JSON.stringify(settled.panelButtons),
	);
	await take("04-settled");

	// ---- (f) composer typing + Send while the panel is up --------------------
	const PROBE = "composer probe line";
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: PROBE });
	await wait(250);
	const typed = await readQaBand(cdp);
	r2check(
		"(f) typing with the panel up lands in the composer; caret kept; Send live",
		typed.fieldValue === PROBE && typed.activeIsField && typed.send.present && typed.send.disabled === false && !typed.stop,
		JSON.stringify({ value: typed.fieldValue, active: typed.active, send: typed.send, stop: typed.stop }),
	);
	await take("05-typed-while-panel-up");
	const beforeRoute = await readQaBand(cdp);
	await enter();
	const routed = await awaitPanel((b) => (b.panelText ?? "").includes(PROBE), 100);
	r2check(
		"(f) Enter with the panel up routes to the ASIDE (panel gains the line; transcript unchanged; box emptied at the press)",
		(routed.panelText ?? "").includes(PROBE) && routed.transcriptText === beforeRoute.transcriptText && routed.fieldValue === "",
		JSON.stringify({ panelHasIt: (routed.panelText ?? "").includes(PROBE), transcriptSame: routed.transcriptText === beforeRoute.transcriptText, value: routed.fieldValue }),
	);
	await awaitPanel((b) => qaCount(b.panelText, R2.TAIL) >= 2 && adoptOf(b)?.disabled === false, 300);
	await take("06-enter-routed-to-aside");

	// ---- (f) Esc closes, routing restored ------------------------------------
	const ESC_LINE = "escape keeps this line";
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: ESC_LINE });
	await wait(200);
	await escape();
	const closed = await awaitPanel((b) => b.panel === null, 60);
	r2check(
		"(f) Esc closes the panel and keeps the composer's text and caret",
		closed.panel === null && closed.fieldValue === ESC_LINE && closed.activeIsField,
		JSON.stringify({ panel: closed.panel, value: closed.fieldValue, active: closed.active }),
	);
	await enter();
	const threaded = await awaitPanel((b) => (b.transcriptText ?? "").includes(ESC_LINE), 200);
	r2check(
		"(f) after Esc the next Enter joins the CONVERSATION",
		(threaded.transcriptText ?? "").includes(ESC_LINE) && threaded.panel === null,
		JSON.stringify(threaded.transcriptText?.slice(-200)),
	);
	await take("07-escape-then-send-joined-thread", "raw");
	const idle = await awaitPanel((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	note("threaded turn idle", JSON.stringify({ streaming: idle.transcriptStreaming, working: idle.transcriptWorking }));

	// ---- (f) bare /btw: empty panel, next Enter is its first question -------
	await replaceComposer("/btw");
	await enter();
	const empty = await awaitPanel((b) => (b.panelText ?? "").includes(R2.EMPTY_COPY), 100);
	r2check(
		"(f) bare /btw attaches the EMPTY panel; adopt disabled with 'Nothing to add yet.'",
		(empty.panelText ?? "").includes(R2.EMPTY_COPY) && adoptOf(empty)?.disabled === true && (empty.panelText ?? "").includes("Nothing to add yet."),
		JSON.stringify(empty.panelText),
	);
	await wait(900);
	await take("08-empty-panel", "raw");
	const ADOPT_Q = "what gets adopted into the conversation?";
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: ADOPT_Q });
	await wait(200);
	await enter();
	const asked = await awaitPanel((b) => (b.panelText ?? "").includes(ADOPT_Q), 100);
	r2check(
		"(f) the next Enter on the empty panel is its first question, off the transcript",
		(asked.panelText ?? "").includes(ADOPT_Q) && qaCount(asked.transcriptText, ADOPT_Q) === 0,
		JSON.stringify({ panel: asked.panelText?.slice(0, 160) }),
	);
	await awaitPanel((b) => (b.panelText ?? "").includes(R2.TAIL) && adoptOf(b)?.disabled === false, 300);

	// ---- (f) adopt REFUSED while the session streams -------------------------
	const injected = await qaSubmitTurn(sessionId, "INJECTED TURN: speak while the aside is open");
	note("(f) injected turn", `status ${injected.status}`);
	const busy = await awaitPanel((b) => (b.panelText ?? "").includes(R2.BUSY), 200);
	const busyControl = await qaAdoptControl(cdp);
	r2check(
		"(f) while the session streams the panel says why and adopt is disabled",
		(busy.panelText ?? "").includes(R2.BUSY) && busyControl?.disabled === true,
		JSON.stringify({ text: busy.panelText?.slice(-220), control: busyControl }),
	);
	if (busyControl) await qaPressPoint(cdp, busyControl);
	await wait(500);
	const afterBusyPress = await readQaBand(cdp);
	r2check(
		"(f) pressing the disabled adopt does nothing (panel stays; question not in transcript)",
		afterBusyPress.panel !== null && qaCount(afterBusyPress.transcriptText, ADOPT_Q) === 0,
		JSON.stringify({ panel: afterBusyPress.panel !== null }),
	);
	await take("09-adopt-refused-while-streaming", "raw");

	// ---- (a) Q2: adopt paints the exchange, live and after re-entering -------
	await awaitPanel((b) => b.transcriptStreaming === false && b.transcriptWorking === false, 400);
	await awaitPanel((b) => adoptOf(b)?.disabled === false, 300);
	const beforeAdopt = await readQaBand(cdp);
	const histBefore = await qaSessionHistory(sessionId);
	const control = await qaAdoptControl(cdp);
	check("(a) adopt control is live once the session is idle", control?.disabled === false, JSON.stringify(control));
	const adoptedAt = Date.now();
	if (control) await qaPressPoint(cdp, control);
	const detached = await awaitPanel((b) => b.panel === null, 120);
	let paintedAt = null;
	let live = detached;
	for (let i = 0; i < 200; i++) {
		live = await readQaBand(cdp);
		if (qaCount(live.transcriptText, ADOPT_Q) > 0 && qaCount(live.transcriptText, R2.ANSWER_HEAD) > qaCount(beforeAdopt.transcriptText, R2.ANSWER_HEAD)) {
			paintedAt = Date.now() - adoptedAt;
			break;
		}
		await wait(100);
	}
	const histAfter = await qaSessionHistory(sessionId);
	note("(a) transcript before adopt", JSON.stringify(beforeAdopt.transcriptText));
	note("(a) transcript after adopt", JSON.stringify(live.transcriptText));
	note(
		"(a) daemon durable rows",
		`before: question present=${JSON.stringify(histBefore.body ?? {}).includes(ADOPT_Q)}; after: present=${JSON.stringify(histAfter.body ?? {}).includes(ADOPT_Q)} (status ${histBefore.status}/${histAfter.status})`,
	);
	r2check(
		"(a) LIVE: the adopted question AND answer are painted in the transcript without leaving the pane",
		detached.panel === null && paintedAt !== null,
		paintedAt === null ? "never within 20s of the adopt" : `painted ${paintedAt}ms after the press; question rows ${qaCount(live.transcriptText, ADOPT_Q)}, answer-head ${qaCount(beforeAdopt.transcriptText, R2.ANSWER_HEAD)}->${qaCount(live.transcriptText, R2.ANSWER_HEAD)}`,
	);
	r2check(
		"(a) the adopted exchange is painted exactly once (no duplicate rows from the re-read)",
		qaCount(live.transcriptText, ADOPT_Q) === 1,
		`question occurrences: ${qaCount(live.transcriptText, ADOPT_Q)}`,
	);
	await take("10-adopted-painted-live");
	await verb(cdp, "navigate", "/chat");
	await wait(900);
	await verb(cdp, "navigate", `/chat/${sessionId}`);
	let back = await readQaBand(cdp);
	let backAt = null;
	const reenter = Date.now();
	for (let i = 0; i < 200; i++) {
		back = await readQaBand(cdp);
		if (qaCount(back.transcriptText, ADOPT_Q) > 0) {
			backAt = Date.now() - reenter;
			break;
		}
		await wait(100);
	}
	await wait(600);
	back = await readQaBand(cdp);
	r2check(
		"(a) AFTER RE-ENTERING the conversation the adopted exchange is still painted, once",
		qaCount(back.transcriptText, ADOPT_Q) === 1 && qaCount(back.transcriptText, R2.ANSWER_HEAD) >= 1,
		backAt === null ? "never within 20s of re-entering" : `${backAt}ms after re-entering; question occurrences ${qaCount(back.transcriptText, ADOPT_Q)}`,
	);
	await take("11-adopted-after-reentering");

	// ---- (a') the adopt's re-read replaced the pane's subscription: does the
	// NEXT ask still stream, addressed to the new id? (proxy log carries the ids)
	const POSTQ = "after the adopt, does the stream still arrive?";
	await replaceComposer(`/btw ${POSTQ}`);
	await enter();
	await awaitPanel((b) => (b.panelText ?? "").includes(POSTQ), 80);
	const postLens = [];
	for (let i = 0; i < 300; i++) {
		const now = await readQaBand(cdp);
		postLens.push(qaAnswerOf(now.panelText, POSTQ).length);
		if ((now.panelText ?? "").includes(R2.TAIL)) break;
		await wait(60);
	}
	const postDistinct = [...new Set(postLens)].filter((l) => l > 0);
	r2check(
		"(a') an ask AFTER the adopt's re-read still streams (>=3 partial lengths)",
		postDistinct.length >= 3,
		`distinct lengths ${JSON.stringify(postDistinct)}`,
	);
	await escape();
	await awaitPanel((b) => b.panel === null, 60);

	// ---- (e) refusal 409s on the panel with the backend's copy --------------
	const refusal = async (question, expect, label) => {
		const notesBefore = qaCount(await r2PageText(cdp), expect);
		await replaceComposer(`/btw ${question}`);
		await enter();
		const band = await awaitPanel((b) => b.panelAlert !== null, 400);
		const page = await r2PageText(cdp);
		r2check(
			`(e) ${label}: the refusal is ON the panel (role=alert) with the backend's sentence`,
			(band.panelAlert ?? "").includes(expect),
			JSON.stringify(band.panelAlert),
		);
		r2check(
			`(e) ${label}: adopt disabled; stated once (not also in the transcript or composer band)`,
			adoptOf(band)?.disabled === true && qaCount(page, expect) === notesBefore + 1 && !(band.bandNotice ?? "").includes(expect),
			JSON.stringify({ adopt: adoptOf(band), pageOccurrencesBefore: notesBefore, after: qaCount(page, expect), band: band.bandNotice }),
		);
		return band;
	};
	await refusal("TOOLCALL2: keep calling tools", R2.UNANSWERED, "aside_unanswered (tool call twice)");
	await take("12-refusal-unanswered-twice");
	await escape();
	await awaitPanel((b) => b.panel === null, 60);
	await refusal("TOOLSILENT: call a tool then go quiet", R2.UNANSWERED, "aside_unanswered (a call then silence)");
	await take("13-refusal-unanswered-silence");
	await escape();
	await awaitPanel((b) => b.panel === null, 60);
	await refusal("EMPTYANS: say nothing at all", R2.EMPTY, "aside_empty_answer");
	await take("14-refusal-empty-answer");
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: "after the refusal" });
	await wait(250);
	const usable = await readQaBand(cdp);
	r2check(
		"(e) the composer is still usable after a refused ask",
		usable.fieldValue === "after the refusal" && usable.send.disabled === false && usable.panel !== null,
		JSON.stringify({ value: usable.fieldValue, send: usable.send }),
	);
	await replaceComposer("");
	await escape();
	await awaitPanel((b) => b.panel === null, 60);

	// ---- (c) F9, the /btw <question> door: Esc before the answer ------------
	const F9Q = "TOOLCALL2: F9 slash door, closed before the answer";
	const pageBeforeSlash = await r2PageText(cdp);
	const countBefore = qaCount(pageBeforeSlash, R2.OFFPANEL);
	await replaceComposer(`/btw ${F9Q}`);
	await enter();
	const up = await awaitPanel((b) => (b.panelText ?? "").includes(F9Q), 60);
	const upAnswerPending = (up.panelText ?? "").includes("thinking");
	await escape();
	const gone = await awaitPanel((b) => b.panel === null, 40);
	r2check(
		"(c) slash door: the panel was up with the question and closed by Esc BEFORE any answer",
		(up.panelText ?? "").includes(F9Q) && gone.panel === null && upAnswerPending,
		JSON.stringify({ upText: up.panelText?.slice(0, 200), closed: gone.panel === null, box: gone.fieldValue }),
	);
	let slashNote = null;
	const t1 = Date.now();
	for (let i = 0; i < 300; i++) {
		const band = await readQaBand(cdp);
		const page = await r2PageText(cdp);
		if (qaCount(page, R2.OFFPANEL) > countBefore) {
			slashNote = { ms: Date.now() - t1, inTranscript: qaCount(band.transcriptText, R2.OFFPANEL), inBand: (band.bandNotice ?? "").includes(R2.OFFPANEL), panel: band.panel };
			break;
		}
		await wait(100);
	}
	await wait(700);
	const afterSlash = await readQaBand(cdp);
	note("(c) slash door: where the refusal surfaced", JSON.stringify(slashNote));
	r2check(
		"(c) slash door: the refusal after Esc is stated in the TRANSCRIPT as a note",
		slashNote !== null && qaCount(afterSlash.transcriptText, R2.OFFPANEL) >= 1 && afterSlash.panel === null, // QA r4: read after the 700 ms settle (the first sample raced the paint)
		JSON.stringify({ slashNote, transcriptTail: afterSlash.transcriptText?.slice(-260) }),
	);
	r2check(
		"(c) slash door: the refusal is stated exactly once",
		qaCount(await r2PageText(cdp), R2.OFFPANEL) === countBefore + 1,
		`occurrences ${countBefore} -> ${qaCount(await r2PageText(cdp), R2.OFFPANEL)}`,
	);
	await take("15-f9-slash-door-note-after-esc");

	// ---- (c) F9, the composer door: bare /btw, ask, Esc, refused -----------
	await replaceComposer("/btw");
	await enter();
	await awaitPanel((b) => (b.panelText ?? "").includes(R2.EMPTY_COPY), 100);
	const COMPQ = "TOOLCALL2: F9 composer door, closed before the answer";
	const countBefore2 = qaCount(await r2PageText(cdp), R2.OFFPANEL);
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: COMPQ });
	await wait(200);
	await enter();
	const up2 = await awaitPanel((b) => (b.panelText ?? "").includes(COMPQ), 80);
	await escape();
	const gone2 = await awaitPanel((b) => b.panel === null, 40);
	r2check(
		"(c) composer door: the panel held the question and Esc closed it before the answer",
		(up2.panelText ?? "").includes(COMPQ) && (up2.panelText ?? "").includes("thinking") && gone2.panel === null,
		JSON.stringify({ up: up2.panelText?.slice(0, 200), closed: gone2.panel === null }),
	);
	let compNote = null;
	const t2 = Date.now();
	for (let i = 0; i < 300; i++) {
		const band = await readQaBand(cdp);
		const page = await r2PageText(cdp);
		if (qaCount(page, R2.OFFPANEL) > countBefore2) {
			compNote = { ms: Date.now() - t2, band: band.bandNotice, inTranscript: qaCount(band.transcriptText, R2.OFFPANEL) - qaCount(gone2.transcriptText, R2.OFFPANEL) };
			break;
		}
		await wait(100);
	}
	note("(c) composer door: where the refusal surfaced", JSON.stringify(compNote));
	r2check(
		"(c) composer door: the refusal after Esc is stated in the composer's error line",
		compNote !== null && (compNote.band ?? "").includes(R2.OFFPANEL),
		JSON.stringify(compNote),
	);
	await wait(700);
	r2check(
		"(c) composer door: the refusal is stated exactly once (not also as a transcript note)",
		qaCount(await r2PageText(cdp), R2.OFFPANEL) === countBefore2 + 1,
		`occurrences ${countBefore2} -> ${qaCount(await r2PageText(cdp), R2.OFFPANEL)}`,
	);
	await take("16-f9-composer-door-error-line-after-esc", "raw");

	r2FramesCheck(frames);
	return { tree: "qa2", frames };
}

/**
 * btw-r2-compat — (d): the proxy emulates a daemon older than the field.
 */
async function sceneBtwR2Compat(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("compat session A", sessionId);
	const { frames, take, enter, adoptOf } = r2Harness(cdp);
	const awaitPanel = (want, n = 80) => qaAwaitPanel(cdp, want, n);
	await cdp.send("Input.insertText", { text: `/btw ${R2.QUESTION}` });
	await wait(200);
	await enter();
	await awaitPanel((b) => b.panel !== null);
	const samples = [];
	const t0 = Date.now();
	let settled = null;
	for (let i = 0; i < 300; i++) {
		const now = await readQaBand(cdp);
		samples.push(qaAnswerOf(now.panelText, R2.QUESTION).length);
		if (i === 25) await take("c01-old-daemon-thinking", "raw");
		if ((now.panelText ?? "").includes(R2.TAIL)) {
			settled = now;
			break;
		}
		await wait(60);
	}
	const distinct = [...new Set(samples)].filter((l) => l > 0);
	r2check(
		"(d) against a 422-ing daemon the first ask still SETTLES with the whole answer, no alert",
		settled !== null && settled.panelAlert === null && (settled.panelText ?? "").includes(R2.ANSWER_HEAD),
		JSON.stringify({ ms: Date.now() - t0, alert: settled?.panelAlert }),
	);
	note("(d) visible lengths (no stream expected)", JSON.stringify(distinct));
	const ready = await awaitPanel((b) => adoptOf(b)?.disabled === false, 200);
	check("(d) adopt goes live after the compat settle", adoptOf(ready)?.disabled === false, JSON.stringify(ready.panelButtons));
	await take("c02-old-daemon-settled");
	const FOLLOW = "and a second question on the same owner?";
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: FOLLOW });
	await wait(200);
	await enter();
	const second = await awaitPanel((b) => qaCount(b.panelText, R2.TAIL) >= 2, 300);
	r2check(
		"(d) a later ask in the same session settles too (the proxy log shows whether it carried the field)",
		qaCount(second.panelText, R2.TAIL) >= 2 && second.panelAlert === null,
		JSON.stringify({ alert: second.panelAlert }),
	);
	await take("c03-old-daemon-second-ask");
	// a SECOND session: its first ask must carry the field again (per-session memory)
	mkdirSync(join(SCRATCH, "btw-qa-other"), { recursive: true });
	const other = await createBackendSession(join(SCRATCH, "btw-qa-other"));
	note("compat session B", String(other.id));
	if (!other.id) throw new Error(`session B was not created: ${JSON.stringify(other.body)}`);
	await verb(cdp, "navigate", `/chat/${other.id}`);
	for (let i = 0; i < 80; i++) {
		if (await cdp.evaluate(`document.querySelector(${JSON.stringify(R2.FIELD)}) !== null`)) break;
		await wait(100);
	}
	await qaWarmSession(other.id);
	await wait(1500);
	await clickAt(cdp, R2.FIELD);
	await cdp.send("Input.insertText", { text: "/btw session B first question" });
	await wait(200);
	await enter();
	const b2 = await awaitPanel((b) => (b.panelText ?? "").includes(R2.TAIL), 400);
	await take("c04-session-b-settled");
	r2check(
		"(d) session B's first ask settles too",
		(b2.panelText ?? "").includes(R2.TAIL) && b2.panelAlert === null,
		JSON.stringify({ alert: b2.panelAlert }),
	);
	r2FramesCheck(frames);
	return { tree: "qa2-compat", frames };
}
