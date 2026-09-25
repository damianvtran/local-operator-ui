
/* ===================================================================== *
 *   UX ROUND 4 (independent) — PR #482 at f105c9953
 *
 * A DELTA-CONFIRMATION scene, not a new round's. The delta since UX round 3's
 * TERMINAL head (ba98e4fdc) is f26026fdd (U19's close path names the entry that
 * holds the exchange), 88c528137 (U18's composed refusal states the remedy once),
 * 5952bd660 (U17's floor between two adopt presses), e0c22348a (U21/R7-3: the
 * move re-runs when the newest turn's BOX grows, so a diagram landing after the
 * settle no longer grows a finished answer un-followed) and 5ee9c68f6 (the
 * ceiling rule, whose arithmetic design round 5 has already confirmed on the
 * rendered surface at both widths).
 *
 * Driver-only and uncommitted: appended to a COPY of scripts/renderer-driver.mjs
 * after rounds 1-5's helper layer and scenes. The app's source is unmodified.
 *
 *  btw-ux4   wide   — U19's three arms in order (refused → Esc, answered → Esc,
 *                     adopted → close), U17's floor (a reflex double-tap, a press
 *                     inside the floor, a press after it), a deliberate two-press
 *                     adopt, and U18's copy read on both arms (the composed
 *                     continuation and a fresh refusal's own sentence).
 *  btw-ux4b  narrow — the same U18 copy and the same U19 refused arm with the
 *                     clip and the row count measured (Q33 in the flow), and
 *                     U16/U17's two presses where the confirm has 234px to fit in.
 *  btw-ux4c  wide   — U21 in the flow, three ways: a diagram that lands after the
 *                     settle (does the move follow the BOX), a long streamed
 *                     answer (does it follow every chunk, and does it stop once
 *                     the move is done), and a hand-scroll before the growth (does
 *                     the reader still win).
 *
 * Every step is a real Input.dispatchKeyEvent / insertText / mouse event, and every
 * reading is the app's own DOM plus the daemon's own responses.
 * ===================================================================== */

const UX4 = {
	FIELD: 'textarea[aria-label="Message"]',
	TAIL: "wrong, not the provider",
	DECLINED_BODY: "The model did not answer your aside in text",
	DECLINED_OPTIONS:
		"Ask again here to keep this exchange, or press Esc to close the aside and discard it.",
	CONFIRM: "Press \u2318+F again to add the aside to the conversation. Once added, it stays there.",
	OWNER_REMEDY: "ask again.",
	ADOPT: "Add to conversation",
};

/** Every occurrence of a phrase, case-insensitively - the U18 stutter is a count. */
function ux4Times(text, needle) {
	return qaCount((text ?? "").toLowerCase(), needle.toLowerCase());
}

/** The close request the APP sent last, and the id it named. */
function ux4LastClose() {
	const ops = r4ops("close");
	const last = ops[ops.length - 1] ?? null;
	return { count: ops.length, op: last, targetId: last ? last.url.split("/").pop() : null };
}

/**
 * The close request, waited for its RESPONSE.
 *
 * The proxy records the request as it is forwarded, so a read taken the moment the
 * panel detaches catches the DELETE still in flight and reports `status: null` -
 * measured in this round's first attempt at arm 1, where the id and the 404 were
 * both right and only the status was unborn. Polling for a status is the difference
 * between reading the app's request and reading the owner's answer to it.
 */
async function ux4LastCloseSettled() {
	for (let i = 0; i < 50; i++) {
		const close = ux4LastClose();
		if (close.op && close.op.status !== null) return close;
		await wait(100);
	}
	return ux4LastClose();
}

/**
 * The newest turn's own boxes, relative to the region's own frame.
 *
 * `questionAbs` is `scrollTop + (questionTop - regionTop)`: the offset the move
 * exists to bring to zero, and invariant under scrolling. `questionRel` is where
 * the question is ON SCREEN (0 = its top is exactly at the region's top, positive
 * = it sits that far DOWN the region, negative = it has been scrolled out above).
 */
function ux4Boxes(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const clip = rr.top + region.clientHeight;
		const turn = region.lastElementChild;
		const q = turn ? turn.querySelector("p") : null;
		const tr = turn ? turn.getBoundingClientRect() : null;
		const qr = q ? q.getBoundingClientRect() : null;
		const svg = region.querySelector("svg");
		const rows = Array.from(region.querySelectorAll("p, li, pre, span"));
		const last = rows.length ? rows[rows.length - 1].getBoundingClientRect() : null;
		const rd = (x) => Math.round(x * 10) / 10;
		return {
			scrollTop: rd(region.scrollTop),
			maxScroll: region.scrollHeight - region.clientHeight,
			clientHeight: region.clientHeight,
			contentHeight: region.scrollHeight,
			questionRel: qr ? rd(qr.top - rr.top) : null,
			questionAbs: qr ? rd(region.scrollTop + qr.top - rr.top) : null,
			questionBoxH: qr ? rd(qr.height) : null,
			turnRel: tr ? rd(tr.top - rr.top) : null,
			turnBoxH: tr ? rd(tr.height) : null,
			svgPresent: svg !== null,
			svgHeight: svg ? Math.round(svg.getBoundingClientRect().height) : null,
			lastRowBottomVsClip: last ? rd(last.bottom - clip) : null,
		};
	})()`);
}

/**
 * Descend into a fresh aside exchange whose question carries a STUB MARKER.
 *
 * `ux3Base` types `/btw <question>` and nothing else, so a scene that needs the
 * scripted provider's own markers (`LONGANSWER`, `MERMAIDANS`, `TOOLCALL2`)
 * cannot use it: this is the same walk with the whole slash command spelled out.
 */
async function ux4BaseWith(cdp, h, slashText, needle, ms = 60000) {
	const open = await h.read();
	if (open.panelUp) {
		await clickAt(cdp, UX4.FIELD);
		await h.esc();
		await h.until((r) => r.panelUp === false, 6000);
		await wait(250);
	}
	await h.replaceComposer(slashText);
	await clickAt(cdp, UX4.FIELD);
	await h.enter();
	const base = await h.until(
		(r) => (r.panelText ?? "").includes(needle) && r.panelUp && h.settled(r),
		ms,
	);
	return { base, asideId: (r4posts(needle)[0] ?? {}).asideId ?? null };
}

/** A refused FOLLOW-UP on the open exchange, read once the refusal is painted. */
async function ux4RefusedFollowUp(cdp, h, marker, needle) {
	await clickAt(cdp, UX4.FIELD);
	await h.type(`${marker}: ${needle}`);
	await h.enter();
	const painted = await h.until((r) => r.refusalText !== null, 30000);
	await wait(800);
	const r = await h.read();
	return { r, post: r4posts(needle)[0] ?? null };
}

/* ===================================================================== *
 *  PASS A — WIDE: U19's three arms, U17's floor, U18's copy
 * ===================================================================== */

async function sceneBtwUx4(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"headless and never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX4 session", sessionId);
	const h = await ux3Harness(cdp, `ux4-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));
	const pick = (r, keys) => Object.fromEntries(keys.map((k) => [k, r[k]]));
	const STD = ["active", "activeIsField", "fieldValue", "refusalText", "noticeText", "noticeCount", "adoptDisabled", "adoptReason", "region"];
	const count = (s, n) => qaCount(s ?? "", n);

	await h.replaceComposer("ux4 seed turn");
	await clickAt(cdp, UX4.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX4.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/* =====================================================================
	 * 1. U19's fix, ARM ONE — a REFUSED follow-up, then Esc.
	 *
	 * The copy the user acts on sends them to Esc ("press Esc to close the
	 * aside and discard it"), so this arm asks the question the copy raises:
	 * does the exchange the user can see actually go, and does the request
	 * name the entry that holds it rather than a turn the owner has dropped?
	 * ===================================================================== */
	{
		const A = await ux4BaseWith(cdp, h, "/btw UA1 what does the retry budget cap", "UA1 what does the retry budget cap");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const entryId = A.asideId;
		const refused = await ux4RefusedFollowUp(cdp, h, "TOOLCALL2", "UA1 the follow-up the model declines");
		const refusedTurnId = refused.post?.asideId ?? null;
		const entryBefore = await r4GetAside(sessionId, entryId);
		const clip = await r5Clip(cdp);
		log("1a the declined follow-up, as painted", { ...pick(refused.r, STD), ms: refused.r.waitedMs });
		log("1a the composed refusal's own text", { text: refused.r.refusalText });
		log("1a where the remedy is stated", {
			askAgainCount: ux4Times(refused.r.refusalText, "ask again"),
			clauseCount: ux4Times(refused.r.refusalText, UX4.DECLINED_OPTIONS),
			whereClause: await ux3Where(cdp, "discard it"),
		});
		log("1a refusal in the region (Q33 in the flow)", clip);
		/*
		 * U18, judged in the flow. The remedy has to be stated ONCE - the panel
		 * appends its own clause to the owner's sentence, and round 3 measured the
		 * composed text saying "ask again" twice in a row - and the clause still has
		 * to name BOTH options, because a trimmed clause that lost the Esc half would
		 * trade a stutter for a gap.
		 */
		r2check(
			"1a the composed refusal states the remedy once, and still names both options",
			ux4Times(refused.r.refusalText, "ask again") === 1 &&
				(refused.r.refusalText ?? "").includes(UX4.DECLINED_BODY) &&
				(refused.r.refusalText ?? "").includes(UX4.DECLINED_OPTIONS),
			JSON.stringify({
				text: refused.r.refusalText,
				askAgain: ux4Times(refused.r.refusalText, "ask again"),
				namesClause: (refused.r.refusalText ?? "").includes(UX4.DECLINED_OPTIONS),
			}),
		);
		r2check(
			"1a the whole refusal is inside the region's clip (the words that name Esc's cost are read, not implied)",
			clip !== null && clip.hiddenBelowPx <= 0.5 && clip.phrase?.visible === true,
			JSON.stringify(clip),
		);
		r2check(
			"1a the exchange the refused follow-up belongs to is still held, with both turns, before the key",
			entryBefore.status === 200 && entryBefore.turns === 2,
			JSON.stringify({ entryId, refusedTurnId, entryBefore }),
		);
		await h.take("01-u19a-refused-refusal-once");

		const tEsc = Date.now();
		await h.esc();
		const afterEsc = await h.until((r) => r.panelUp === false, 6000);
		/*
		 * The discard is its own fire-and-forget request, so the entry's record is POLLED
		 * rather than read once at the frame the panel vanished - and how long the owner
		 * went on holding it is part of the reading.
		 */
		let entryAfter = await r4GetAside(sessionId, entryId);
		for (let i = 0; i < 60 && entryAfter.status === 200; i++) {
			await wait(100);
			entryAfter = await r4GetAside(sessionId, entryId);
		}
		const refusedTurnAfter = await r4GetAside(sessionId, refusedTurnId);
		const chips = await ux3Chips(cdp);
		const after = await h.read();
		const close = await ux4LastCloseSettled();
		log("1b after Esc: what the user has left", { ms: Date.now() - tEsc, panelUp: afterEsc.panelUp, active: afterEsc.active, activeIsField: afterEsc.activeIsField });
		log("1b the id the app asked the owner to drop", { close: { count: close.count, targetId: close.targetId, status: close.op?.status }, entryId, refusedTurnId, namedTheEntry: close.targetId === entryId, namedTheRefusedTurn: close.targetId === refusedTurnId });
		log("1b the entry that held the exchange, after Esc", entryAfter);
		log("1b the refused turn's own id, after Esc", refusedTurnAfter);
		log("1b the transcript", { base: count(after.transcriptText, "UA1 what does the retry budget cap"), followUp: count(after.transcriptText, "UA1 the follow-up the model declines"), replies: chips });
		/*
		 * U19's fix, in the words the copy uses. Round 3 measured the DELETE naming
		 * the REFUSED TURN's id, which the owner does not hold (404), while the entry
		 * holding the exchange survived at 200 - so the sentence "discard it" was
		 * true of what the user could SEE and false about the thing the app named.
		 * The fix is that closing names the entry the ask path continues.
		 */
		r2check(
			"1b closing names the entry that holds the exchange - the same id the ask path continues - and the owner answers 200",
			close.targetId === entryId && close.targetId !== refusedTurnId && close.op?.status === 200,
			JSON.stringify({ target: close.targetId, entryId, refusedTurnId, status: close.op?.status }),
		);
		r2check(
			"1b the exchange really goes: the entry the copy told the user to discard is no longer held",
			entryAfter.status !== 200,
			JSON.stringify({ entryAfter }),
		);
		r2check(
			"1b Esc takes the exchange off the screen: the panel is gone, focus is back in the box, and neither question is anywhere the user can reach",
			afterEsc.panelUp === false && afterEsc.activeIsField === true &&
				count(after.transcriptText, "UA1 what does the retry budget cap") === 0 &&
				count(after.transcriptText, "UA1 the follow-up the model declines") === 0 &&
				chips.length === 0,
			JSON.stringify({ panelUp: afterEsc.panelUp, active: afterEsc.active, base: count(after.transcriptText, "UA1 what does the retry budget cap"), chips }),
		);
		await h.take("02-u19a-after-esc-the-exchange-really-went");
	}

	/* =====================================================================
	 * 2. U19's fix, ARM TWO — an ANSWERED exchange, then Esc.
	 * ===================================================================== */
	{
		const B = await ux4BaseWith(cdp, h, "/btw UB1 the answered exchange to be closed", "UB1 the answered exchange to be closed");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const ops0 = r4ops("close").length;
		const tEsc = Date.now();
		await h.esc();
		const afterB = await h.until((r) => r.panelUp === false, 6000);
		let entryB = await r4GetAside(sessionId, B.asideId);
		for (let i = 0; i < 60 && entryB.status === 200; i++) {
			await wait(100);
			entryB = await r4GetAside(sessionId, B.asideId);
		}
		const settledClose = await ux4LastCloseSettled();
		const closes = r4ops("close").slice(ops0).map((o) => ({ id: o.url.split("/").pop(), status: o.status }));
		const after = await h.read();
		log("2 an answered exchange's Esc", { ms: Date.now() - tEsc, panelUp: afterB.panelUp, active: afterB.active, entryId: B.asideId, closes, entryAfter: entryB, inTranscript: count(after.transcriptText, "UB1 the answered exchange to be closed") });
		r2check(
			"2 an answered exchange is closed by its own entry's id, answered 200, and the entry goes",
			closes.length === 1 && closes[0].id === B.asideId && closes[0].status === 200 && entryB.status !== 200,
			JSON.stringify({ closes, entryId: B.asideId, entryAfter: entryB }),
		);
		r2check(
			"2 the answered arm costs the reader the same thing the copy says: nothing on screen, nothing in the transcript",
			afterB.panelUp === false && afterB.activeIsField === true && count(after.transcriptText, "UB1 the answered exchange to be closed") === 0,
			JSON.stringify({ panelUp: afterB.panelUp, active: afterB.active, inTranscript: count(after.transcriptText, "UB1 the answered exchange to be closed") }),
		);
		await h.take("03-u19b-answered-closed");
	}

	/* =====================================================================
	 * 3. U19's fix, ARM THREE — an ADOPTED exchange, then a close.
	 *
	 * Adopting hands the exchange to the conversation; the risk the third arm
	 * exists for is a close that then takes it back. The promise is checked
	 * where the user can see it (the rows stay, once each, across a leave and
	 * re-enter) and on the owner's own record (the close changes nothing).
	 * ===================================================================== */
	{
		const C = await ux4BaseWith(cdp, h, "/btw UC1 the exchange adopted then closed", "UC1 the exchange adopted then closed");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const entryId = C.asideId;
		const hist0 = await r4History(sessionId);
		const ops0 = r4ops("adopt").length;
		await clickAt(cdp, UX4.FIELD);
		await h.cmdF();
		await h.until((r) => (r.noticeText ?? "") === UX4.CONFIRM, 8000);
		/*
		 * 1.1s, not "as soon as the confirm paints": this arm is a user who READ
		 * the line, which is the population U17's floor budgets for.
		 */
		await wait(1100);
		const tChord = Date.now();
		await h.cmdF();
		const goneC = await h.until((r) => r.panelUp === false, 8000);
		const paint = await r5PollPaint(cdp, tChord, ["UC1 the exchange adopted then closed"], hist0.text ?? "", 20000);
		await wait(900);
		const afterC = await h.read();
		const hist1 = await r4History(sessionId);
		const entryAfterAdopt = await r4GetAside(sessionId, entryId);
		log("3a adopting by the second chord", { panelGoneMs: goneC.waitedMs, painted: paint.at, active: goneC.active, adoptOps: r4ops("adopt").length - ops0 });
		log("3a the owner's record", { history: [hist0.count, hist1.count], hasQuestion: count(hist1.text, "UC1 the exchange adopted then closed"), entryAfterAdopt });
		r2check(
			"3a the second press adopts once: the rows paint live, the panel detaches, focus returns",
			r4ops("adopt").length === ops0 + 1 && goneC.panelUp === false && goneC.activeIsField === true &&
				paint.at["UC1 the exchange adopted then closed"] !== undefined,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, active: goneC.active, painted: paint.at }),
		);
		const closeOpsAfterAdopt = r4ops("close").length;
		await h.take("04-u19c-adopted");

		/* What a user would do next: press Esc on a panel that is already gone. */
		await h.esc();
		await wait(900);
		const afterEscC = await h.read();
		const entryAfterEsc = await r4GetAside(sessionId, entryId);
		log("3b Esc after adopting", {
			panelUp: afterEscC.panelUp, active: afterEscC.active,
			rows: count(afterEscC.transcriptText, "UC1 the exchange adopted then closed"),
			entryBefore: entryAfterAdopt, entryAfter: entryAfterEsc,
			closeOps: [closeOpsAfterAdopt, r4ops("close").length],
		});
		r2check(
			"3b closing after adopting takes nothing back: the adopted rows are still painted and the owner's record is untouched",
			count(afterEscC.transcriptText, "UC1 the exchange adopted then closed") === 1 &&
				entryAfterEsc.status === entryAfterAdopt.status &&
				r4ops("close").length === closeOpsAfterAdopt,
			JSON.stringify({ rows: count(afterEscC.transcriptText, "UC1 the exchange adopted then closed"), before: entryAfterAdopt.status, after: entryAfterEsc.status, closes: r4ops("close").length - closeOpsAfterAdopt }),
		);
		await h.take("05-u19c-after-esc-nothing-taken-back");

		const { away, awayUrl } = await ux3Leave(cdp, "/settings");
		const tRe = Date.now();
		await verb(cdp, "navigate", `/chat/${sessionId}`);
		const re = await r5PollPaint(cdp, tRe, ["UC1 the exchange adopted then closed"], "", 25000);
		await wait(600);
		const reBand = await h.read();
		log("3c away and back", { awayUrl, whileAway_mounted: away.transcriptText !== null, whileAway_hasQuestion: count(away.transcriptText, "UC1 the exchange adopted then closed"), reEntryMs: re.at["UC1 the exchange adopted then closed"] ?? null, occurrencesAfter: count(reBand.transcriptText, "UC1 the exchange adopted then closed") });
		r2check(
			"3c the adopted rows survive leaving the conversation and coming back, once each",
			count(away.transcriptText, "UC1 the exchange adopted then closed") === 0 &&
				count(reBand.transcriptText, "UC1 the exchange adopted then closed") === 1,
			JSON.stringify({ after: count(reBand.transcriptText, "UC1 the exchange adopted then closed") }),
		);
		await h.take("06-u19c-after-reentering");
	}

	/* =====================================================================
	 * 4. U17's floor — the reflex double-tap, and what a press inside the
	 *    floor does to the gesture.
	 * ===================================================================== */
	{
		const D = await ux4BaseWith(cdp, h, "/btw UD1 the exchange a reflex double-tap meets", "UD1 the exchange a reflex double-tap meets");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const ops0 = r4ops("adopt").length;
		await clickAt(cdp, UX4.FIELD);
		await cdp.evaluate(`(() => { window.__ux4Keys = []; window.addEventListener("keydown", (e) => {
			if ((e.key || "").toLowerCase() !== "f" || !(e.metaKey || e.ctrlKey)) return;
			window.__ux4Keys.push(Math.round(performance.now()));
		}); return true; })()`);
		const t0 = Date.now();
		await h.cmdF();
		await wait(66);
		await h.cmdF();
		await wait(500);
		const afterTap = await h.read();
		const keys = await cdp.evaluate("window.__ux4Keys");
		log("4a a reflex double-tap, 66ms apart", {
			panelUp: afterTap.panelUp, notice: afterTap.noticeText, adoptOps: r4ops("adopt").length - ops0,
			keys, gapMs: keys.length >= 2 ? keys[1] - keys[0] : null, msFromFirstPress: Date.now() - t0,
			refusal: afterTap.refusalText, bandLines: afterTap.bandLines,
		});
		r2check(
			"4a a reflex double-tap does NOT adopt: no adopt request leaves, the panel is still up, and the confirm is still the whole answer",
			r4ops("adopt").length === ops0 && afterTap.panelUp === true && (afterTap.noticeText ?? "") === UX4.CONFIRM,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, panelUp: afterTap.panelUp, notice: afterTap.noticeText, keys }),
		);
		r2check(
			"4a the swallowed press surfaces nothing of its own: the panel's one alert is still the confirm, nothing is red on it, and the composer line stays empty",
			afterTap.noticeCount === 1 && afterTap.refusalText === UX4.CONFIRM &&
				(afterTap.bandLines ?? []).every((l) => !l.includes("Press")),
			JSON.stringify({ refusal: afterTap.refusalText, noticeCount: afterTap.noticeCount, bandLines: afterTap.bandLines }),
		);
		await h.take("07-u17a-reflex-double-tap-does-not-adopt");

		/*
		 * The floor is a floor on the GESTURE, not a disarm: a third press that
		 * arrives after the reading a deliberate one needs still adopts, so a user
		 * whose second press was swallowed is not left pressing into a dead arm.
		 */
		const tThird = Date.now();
		await h.cmdF();
		const goneD = await h.until((r) => r.panelUp === false, 8000);
		log("4b the press after the floor", { msAfterTheConfirm: tThird - t0, panelUp: goneD.panelUp, active: goneD.active, adoptOps: r4ops("adopt").length - ops0 });
		r2check(
			"4b a swallowed press is not a withdraw: the next press adopts, once",
			r4ops("adopt").length === ops0 + 1 && goneD.panelUp === false,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, panelUp: goneD.panelUp }),
		);
		await h.take("08-u17b-the-press-after-the-floor-adopts");
	}

	/* =====================================================================
	 * 5. U17 — a deliberate second press, at reading speed.
	 * ===================================================================== */
	{
		const E = await ux4BaseWith(cdp, h, "/btw UE1 the exchange a deliberate press meets", "UE1 the exchange a deliberate press meets");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const ops0 = r4ops("adopt").length;
		const hist0 = await r4History(sessionId);
		await clickAt(cdp, UX4.FIELD);
		await h.cmdF();
		await h.until((r) => (r.noticeText ?? "") === UX4.CONFIRM, 8000);
		await wait(1200);
		const tChord = Date.now();
		await h.cmdF();
		const goneE = await h.until((r) => r.panelUp === false, 8000);
		const paint = await r5PollPaint(cdp, tChord, ["UE1 the exchange a deliberate press meets"], hist0.text ?? "", 20000);
		log("5 a deliberate two-press adopt", { panelGoneMs: goneE.waitedMs, painted: paint.at, adoptOps: r4ops("adopt").length - ops0, active: goneE.active });
		r2check(
			"5 a user who reads the confirm and presses again adopts first time - no third press needed",
			r4ops("adopt").length === ops0 + 1 && goneE.panelUp === false &&
				paint.at["UE1 the exchange a deliberate press meets"] !== undefined,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, painted: paint.at }),
		);
		await h.take("09-u17c-deliberate-press-adopts");
	}

	/* =====================================================================
	 * 6. U18's other arm — a FRESH refused ask states the owner's sentence,
	 *    remedy included, with no clause. The trim must be invisible here.
	 * ===================================================================== */
	{
		await h.replaceComposer("/btw TOOLCALL2: UF1 a fresh ask the model declines");
		await clickAt(cdp, UX4.FIELD);
		await h.enter();
		const fresh = await h.until((r) => r.refusalText !== null, 30000);
		log("6 a fresh refused ask", { ...pick(fresh, STD), text: fresh.refusalText, endsWithOwnerRemedy: /[Aa]sk again\.$/.test((fresh.refusalText ?? "").trim()) });
		r2check(
			"6 a fresh refusal still states the owner's sentence alone, its own remedy intact and no clause",
			(fresh.refusalText ?? "").includes(UX4.DECLINED_BODY) &&
				!(fresh.refusalText ?? "").includes(UX4.DECLINED_OPTIONS) &&
				ux4Times(fresh.refusalText, "ask again") === 1,
			JSON.stringify({ text: fresh.refusalText, askAgain: ux4Times(fresh.refusalText, "ask again"), hasClause: (fresh.refusalText ?? "").includes(UX4.DECLINED_OPTIONS) }),
		);
		await h.take("10-u18-fresh-refusal-keeps-its-own-remedy");
		await h.esc();
		await wait(400);
	}

	note("UX4 scene", "finished");
}

/* ===================================================================== *
 *  PASS B — NARROW: the copy and the clip with 234px to fit in
 * ===================================================================== */

async function sceneBtwUx4b(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"headless and never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX4b session", sessionId);
	const h = await ux3Harness(cdp, `ux4b-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));
	const count = (s, n) => qaCount(s ?? "", n);

	await h.replaceComposer("ux4b seed turn");
	await clickAt(cdp, UX4.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX4.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/* --- U18 + U19's refused arm at 800px ---------------------------------- */
	{
		const A = await ux4BaseWith(cdp, h, "/btw UN1 what does the retry budget cap", "UN1 what does the retry budget cap");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const entryId = A.asideId;
		const refused = await ux4RefusedFollowUp(cdp, h, "TOOLCALL2", "UN1 the follow-up the model declines");
		const clip = await r5Clip(cdp);
		log("1a the composed refusal at narrow", { text: refused.r.refusalText, askAgain: ux4Times(refused.r.refusalText, "ask again"), region: refused.r.region });
		log("1a refusal in the region at narrow (Q33)", clip);
		r2check(
			"1a at 800px the composed refusal still states the remedy once and names both options",
			ux4Times(refused.r.refusalText, "ask again") === 1 &&
				(refused.r.refusalText ?? "").includes(UX4.DECLINED_OPTIONS),
			JSON.stringify({ text: refused.r.refusalText, askAgain: ux4Times(refused.r.refusalText, "ask again") }),
		);
		r2check(
			"1a at 800px the whole refusal is inside the region's clip and the clause that names Esc's cost is readable",
			clip !== null && clip.hiddenBelowPx <= 0.5 && clip.phrase?.visible === true && clip.rows > 0 && clip.rowsFullyVisible === clip.rows,
			JSON.stringify(clip),
		);
		await h.take("b01-narrow-composed-refusal-once");

		const tEsc = Date.now();
		await h.esc();
		const afterEsc = await h.until((r) => r.panelUp === false, 6000);
		let entryAfter = await r4GetAside(sessionId, entryId);
		for (let i = 0; i < 60 && entryAfter.status === 200; i++) {
			await wait(100);
			entryAfter = await r4GetAside(sessionId, entryId);
		}
		const close = await ux4LastCloseSettled();
		log("1b at narrow, after Esc", { ms: Date.now() - tEsc, panelUp: afterEsc.panelUp, active: afterEsc.active, targetId: close.targetId, entryId, status: close.op?.status, entryAfter });
		r2check(
			"1b at 800px Esc still names the entry that holds the exchange, and the exchange goes",
			close.targetId === entryId && close.op?.status === 200 && entryAfter.status !== 200 && afterEsc.activeIsField === true,
			JSON.stringify({ target: close.targetId, entryId, status: close.op?.status, entryAfter, active: afterEsc.active }),
		);
		await h.take("b02-narrow-refused-arm-after-esc");
	}

	/* --- U11's first arm at narrow: the retry in the same panel ------------ */
	{
		const B = await ux4BaseWith(cdp, h, "/btw UN2 the retry in place", "UN2 the retry in place");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		await ux4RefusedFollowUp(cdp, h, "TOOLCALL2", "UN2 the declined follow-up");
		const before = await h.read();
		const retry = await h.ask("UN2 retry in the same panel", 40000);
		const post = r4posts("UN2 retry in the same panel")[0] ?? null;
		log("2 the retry in place at narrow", { retryMs: retry.ms, status: post?.status, continues: post?.continues, tails: count(retry.panelText, UX4.TAIL), turns: retry.region?.turns, refusalStillThere: (before.refusalText ?? "") !== null });
		r2check(
			"2 at 800px the copy's first option is still true: asking again in the same panel is answered, and the refusal's own turn is kept",
			post?.status === 200 && count(retry.panelText, UX4.TAIL) >= 2 && (retry.region?.turns ?? 0) === 3,
			JSON.stringify({ status: post?.status, tails: count(retry.panelText, UX4.TAIL), turns: retry.region?.turns }),
		);
		await h.take("b03-narrow-retry-answered-in-place");
		await h.esc();
		await wait(300);
	}

	/* --- U16/U17's two presses where the confirm has 234px ---------------- */
	{
		const C = await ux4BaseWith(cdp, h, "/btw UN3 the exchange to adopt", "UN3 the exchange to adopt");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		const ops0 = r4ops("adopt").length;
		await clickAt(cdp, UX4.FIELD);
		await h.cmdF();
		await wait(700);
		const first = await h.read();
		const clip = await r5Clip(cdp);
		log("3a the first ⌘+F at narrow", { notice: first.noticeText, noticeCount: first.noticeCount, adoptOps: r4ops("adopt").length - ops0, region: first.region });
		r2check(
			"3a at 800px the first press only confirms, and the confirm sits with the control it names",
			r4ops("adopt").length === ops0 && first.panelUp === true && (first.noticeText ?? "") === UX4.CONFIRM &&
				first.noticeGapPx !== null && first.noticeGapPx < 12,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, notice: first.noticeText, gapPx: first.noticeGapPx }),
		);
		await h.take("b04-narrow-first-cmdf-confirm");

		const hist0 = await r4History(sessionId);
		await wait(900);
		const tChord = Date.now();
		await h.cmdF();
		const gone = await h.until((r) => r.panelUp === false, 8000);
		const paint = await r5PollPaint(cdp, tChord, ["UN3 the exchange to adopt"], hist0.text ?? "", 20000);
		log("3b the second press at narrow", { panelGoneMs: gone.waitedMs, painted: paint.at, adoptOps: r4ops("adopt").length - ops0 });
		r2check(
			"3b at 800px a deliberate second press adopts, once, and the rows paint",
			r4ops("adopt").length === ops0 + 1 && gone.panelUp === false && paint.at["UN3 the exchange to adopt"] !== undefined,
			JSON.stringify({ ops: r4ops("adopt").length - ops0, painted: paint.at }),
		);
		await h.take("b05-narrow-second-press-adopts");
	}

	note("UX4b scene", "finished");
}

/* ===================================================================== *
 *  PASS C — WIDE: U21 in the flow, three ways
 * ===================================================================== */

async function sceneBtwUx4c(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"headless and never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX4c session", sessionId);
	const h = await ux3Harness(cdp, `ux4c-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));

	await h.replaceComposer("ux4c seed turn");
	await clickAt(cdp, UX4.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX4.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/*
	 * A tall FIRST turn above the diagram turn, so the newest question's own
	 * offset from the region's top is not zero: the move's clamp can then bite
	 * (the turn is shorter than the region) and the question can sit at the
	 * region's BOTTOM until something grows the turn past the region's height.
	 * That is the state R7-3 named, and it needs a turn above to exist at all.
	 */
	{
		const prev = await ux4BaseWith(cdp, h, "/btw LONGANSWER UM0 the tall turn above the diagram", "UM0 the tall turn above the diagram");
		await h.idle();
		await h.until((r) => h.settled(r), 60000);
		const boxes = await ux4Boxes(cdp);
		log("0 the tall turn above", { entryId: prev.asideId, boxes });
		r2check(
			"0 the first turn overflows the region, so a later turn's question has somewhere to come from",
			boxes !== null && boxes.maxScroll > 0,
			JSON.stringify(boxes),
		);
		await h.take("c00-tall-turn-above");
	}

	/* --- U21 ARM ONE: a diagram that lands AFTER the settle ---------------- */
	{
		await h.replaceComposer("/btw MERMAIDANS UM1 draw me the aside flow");
		await clickAt(cdp, UX4.FIELD);
		const tPress = Date.now();
		await h.enter();
		const samples = [];
		let sawText = null;
		let sawSvg = null;
		let preDiagram = null;
		for (let i = 0; i < 400; i++) {
			const b = await ux4Boxes(cdp);
			const ms = Date.now() - tPress;
			if (b) {
				if (sawText === null && (b.contentHeight ?? 0) > 0) sawText = ms;
				if (sawSvg === null && b.svgPresent) sawSvg = ms;
				if (preDiagram === null && b.svgPresent === false && (b.contentHeight ?? 0) > 200) preDiagram = { ms, ...b };
				const prev = samples[samples.length - 1];
				if (!prev || prev.contentHeight !== b.contentHeight || prev.svgPresent !== b.svgPresent || prev.scrollTop !== b.scrollTop)
					samples.push({ ms, svg: b.svgPresent, contentHeight: b.contentHeight, scrollTop: b.scrollTop, maxScroll: b.maxScroll, questionRel: b.questionRel, questionAbs: b.questionAbs });
			}
			if (sawSvg !== null && ms - sawSvg > 2500) break;
			await wait(40);
		}
		const settled = await ux4Boxes(cdp);
		log("1 the region from the press to the diagram", { sawTextMs: sawText, sawSvgMs: sawSvg, preDiagram, samples: samples.slice(0, 24) });
		log("1 after the diagram landed", settled);
		/*
		 * The state R7-3 named: at the moment the answer's TEXT was in, the newest
		 * turn was shorter than the region, so the move's clamp held the question at
		 * the region's bottom (questionRel > 0) and the move had NOT reached its
		 * target. The chart then grows the turn past the region's own height - which
		 * is the growth no store trigger can see.
		 */
		r2check(
			"1 the arm reached the state U21 is about: before the diagram the newest question sat BELOW the region's top with the move's clamp biting",
			preDiagram !== null && preDiagram.questionRel > 4 && preDiagram.maxScroll >= 0,
			JSON.stringify({ preDiagram }),
		);
		r2check(
			"1 the diagram really did grow a finished turn (the growth the store cannot see)",
			preDiagram !== null && settled !== null && settled.contentHeight - preDiagram.contentHeight > 100 && settled.svgPresent === true,
			JSON.stringify({ before: preDiagram?.contentHeight, after: settled?.contentHeight, svg: settled?.svgPresent }),
		);
		r2check(
			"1 the move followed the BOX: after the growth the newest question is at the region's top (questionRel 0) - which nothing but a layout observation could have re-asked",
			settled !== null && settled.questionRel !== null && Math.abs(settled.questionRel) <= 1,
			JSON.stringify({ questionRel: settled?.questionRel, questionAbs: settled?.questionAbs, scrollTop: settled?.scrollTop, maxScroll: settled?.maxScroll }),
		);
		await h.take("c01-diagram-after-the-settle-is-followed");
	}

	/* --- U21 ARM TWO: a long streamed answer (never per chunk) ------------- */
	{
		await h.esc();
		await wait(400);
		const base = await ux4BaseWith(cdp, h, "/btw UM2 a base turn for the long stream", "UM2 a base turn for the long stream");
		await h.idle();
		await h.until((r) => h.settled(r), 60000);
		const entryId = base.asideId;
		await clickAt(cdp, UX4.FIELD);
		await h.type("LONGANSWER UM2 the long streamed follow-up");
		await h.enter();
		const tPress = Date.now();
		const trail = [];
		let latch = null;
		for (let i = 0; i < 700; i++) {
			const b = await ux4Boxes(cdp);
			const ms = Date.now() - tPress;
			if (b) {
				const prev = trail[trail.length - 1];
				if (!prev || prev.contentHeight !== b.contentHeight || prev.scrollTop !== b.scrollTop || prev.questionRel !== b.questionRel)
					trail.push({ ms, contentHeight: b.contentHeight, scrollTop: b.scrollTop, questionRel: b.questionRel, maxScroll: b.maxScroll });
				if (latch === null && b.questionRel !== null && Math.abs(b.questionRel) <= 1 && b.maxScroll > 0) latch = { ms, ...b };
			}
			const r = await h.read();
			if (r.announce && r.announce !== "Asking the aside" && ms > 1500 && latch !== null && i % 5 === 0) {
				const last = trail[trail.length - 1];
				if (last && ms > latch.ms + 2500) break;
			}
			await wait(50);
		}
		await wait(600);
		const end = await ux4Boxes(cdp);
		const afterLatch = latch ? trail.filter((s) => s.ms >= latch.ms) : [];
		const grewAfterLatch = afterLatch.length > 1 ? afterLatch[afterLatch.length - 1].contentHeight - afterLatch[0].contentHeight : 0;
		const movedAfterLatch = afterLatch.length > 1 ? Math.max(...afterLatch.map((s) => Math.abs(s.scrollTop - afterLatch[0].scrollTop))) : 0;
		log("2 the long stream", { latch, entries: trail.length, tail: trail.slice(-14), grewAfterLatch, movedAfterLatch });
		/*
		 * D11's promise, measured: the target is FIXED, so once the question is at the
		 * region's top the region does not chase the answer's tail. The check needs the
		 * stream to have gone on growing after the move landed - `grewAfterLatch`, not a
		 * green "nothing moved" over a finished stream.
		 */
		r2check(
			"2 the move lands with the question at the region's top, and the region does NOT follow every chunk after that",
			latch !== null && grewAfterLatch > 40 && movedAfterLatch <= 1.1,
			JSON.stringify({ latch: latch && { ms: latch.ms, scrollTop: latch.scrollTop }, grewAfterLatch, movedAfterLatch }),
		);
		r2check(
			"2 the move never passes the question: the newest question's top is never above the region's top by more than a pixel of rounding",
			trail.every((s) => s.questionRel === null || s.questionRel >= -1.1),
			JSON.stringify({ worst: Math.min(...trail.map((s) => s.questionRel ?? 0)) }),
		);
		log("2 after the long stream settled", { end, entryId });
		await h.take("c02-long-stream-does-not-follow-every-chunk");
	}

	/* --- U21 ARM THREE: the reader scrolls by hand, then the box grows ----- */
	{
		await h.esc();
		await wait(400);
		const base = await ux4BaseWith(cdp, h, "/btw UM3 a base turn under the hand-scroll arm", "UM3 a base turn under the hand-scroll arm");
		await h.idle();
		await h.until((r) => h.settled(r), 30000);
		await h.replaceComposer("/btw MERMAIDANS UM3 draw me the aside flow again");
		await clickAt(cdp, UX4.FIELD);
		const tPress = Date.now();
		await h.enter();
		/* Wait for the text with no SVG yet: the window before the diagram lands. */
		let early = null;
		for (let i = 0; i < 200; i++) {
			const b = await ux4Boxes(cdp);
			if (b && b.svgPresent === false && (b.contentHeight ?? 0) > 120 && b.maxScroll > 0) { early = { ms: Date.now() - tPress, ...b }; break; }
			await wait(40);
		}
		/* The reader's own scroll: real keys, with the region itself focused. */
		await clickAt(cdp, UX4.FIELD);
		for (let i = 0; i < 4; i++) {
			await h.tab(true);
			await wait(150);
			const r = await h.read();
			if ((r.active ?? "").includes("The aside exchange")) break;
		}
		const focused = await h.read();
		const beforeHand = await ux4Boxes(cdp);
		for (let i = 0; i < 3; i++) {
			await pressChord(cdp, { key: "PageUp", code: "PageUp", virtualKeyCode: 33 });
			await wait(120);
		}
		const afterHand = await ux4Boxes(cdp);
		/* Now let the diagram land, and see whether the growth moves the reader. */
		let sawSvg = null;
		for (let i = 0; i < 200; i++) {
			const b = await ux4Boxes(cdp);
			if (b && b.svgPresent) { sawSvg = { ms: Date.now() - tPress, ...b }; break; }
			await wait(50);
		}
		await wait(900);
		const final = await ux4Boxes(cdp);
		log("3 the hand-scroll arm", { early, focus: focused.active, beforeHand, afterHand, sawSvg, final, handMs: afterHand && early ? afterHand.scrollTop - early.scrollTop : null });
		r2check(
			"3 the reader's own scroll moved the region (the arm is real, not a no-op)",
			afterHand !== null && beforeHand !== null && beforeHand.scrollTop - afterHand.scrollTop > 4,
			JSON.stringify({ before: beforeHand?.scrollTop, after: afterHand?.scrollTop }),
		);
		r2check(
			"3 the reader wins: when the box grows after a hand-scroll, the move does NOT drag the region back",
			afterHand !== null && final !== null && sawSvg !== null && Math.abs(final.scrollTop - afterHand.scrollTop) <= 1.1 &&
				(final.contentHeight ?? 0) - (afterHand.contentHeight ?? 0) > 100,
			JSON.stringify({ hand: afterHand?.scrollTop, final: final?.scrollTop, grew: (final?.contentHeight ?? 0) - (afterHand?.contentHeight ?? 0) }),
		);
		await h.take("c03-hand-scroll-wins-over-the-late-growth");
	}

	note("UX4c scene", "finished");
}
