/*
 * DESIGN ROUND 6 (PR #482), scene `d6-answer`.
 *
 * WHY THIS SCENE EXISTS, and why it is the round's method change. Design
 * round 5's D11 evidence came from its own d4 scene's E case, which asked a
 * `LONGSLOW` follow-up in a panel the scene had just opened. The narrow
 * regression was NOT visible there, and round 5 never drove the scene that
 * carries the broken case at all. This scene drives the SAME thing the broken
 * case is - an ANSWERED follow-up on an exchange whose first answer already
 * overflows the 800 px region - and it samples the geometry across the whole
 * stream, not once at settle:
 *
 *   - `questionTopInRegion` every ~90 ms from the press, so a region that
 *     reaches the newest question's offset and then stops short, or drifts
 *     back, is a reading rather than a lucky end state;
 *   - a frame just after the press, one mid-stream and one settled, because a
 *     still at the end cannot show a region that only got there at the end.
 *
 * The follow-up's question is `LONGANSWER`, the arm the failing QA round-6
 * case (Q38 in `btw-r5-clip`) uses, so a pass here is the same claim on the
 * same arm and not a neighbouring one.
 */

async function sceneD6Answer(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("d6 answer session", sessionId);
	const h = r5Harness(cdp, `d6ans-${RUN_LABEL}`);

	/* The first turn has to overflow the region on its own, which is the state
	 * the finding is about: a short exchange has nothing to follow. */
	const FIRST = "LONGANSWER: d6 first question, a long answer that already overflows";
	await h.ask(`/btw ${FIRST}`);
	await h.awaitSettled(FIRST);
	await wait(400);
	const gFirst = await r4Geo(cdp);
	note("d6 first turn geometry", JSON.stringify(gFirst));
	r2check(
		"d6 the first turn already overflows the region (so the follow-up has somewhere to move from)",
		gFirst.maxScroll > 0,
		JSON.stringify({ maxScroll: gFirst.maxScroll, scrollTop: gFirst.scrollTop, clientHeight: gFirst.clientHeight, cap: gFirst.cap }),
	);

	await clickAt(cdp, R4.FIELD);
	await h.type("LONGANSWER: d6 the answered follow-up whose question must hold the top");
	const t0 = Date.now();
	await h.enter();

	const samples = [];
	let justAsked = false;
	let midStream = false;
	for (let i = 0; i < 200; i++) {
		const c = await r5Clip(cdp);
		const g = await r4Geo(cdp);
		samples.push([
			Date.now() - t0,
			c?.scrollTop ?? null,
			c?.maxScroll ?? null,
			c?.target ?? null,
			c?.state ?? null,
			g?.questionTopInRegion ?? null,
			g?.answerTopInRegion ?? null,
		]);
		if (!justAsked && samples.length >= 3) {
			justAsked = true;
			await h.take("answered-followup-just-asked", "raw");
		}
		if (!midStream && samples.length >= 16) {
			midStream = true;
			await h.take("answered-followup-midstream", "raw");
		}
		if (i > 6 && c && c.state !== "thinking" && Math.abs(c.scrollTop - Math.min(c.maxScroll, Math.max(0, c.target))) <= 1) break;
		await wait(90);
	}
	await h.awaitSettled("d6 the answered follow-up whose question must hold the top");
	await wait(400);
	const gEnd = await r4Geo(cdp);
	const cEnd = await r5Clip(cdp);
	await h.take("answered-followup-settled");

	const dedup = samples.filter((s, i) => i === 0 || JSON.stringify(s.slice(1)) !== JSON.stringify(samples[i - 1].slice(1)));
	note("d6 answered-followup samples [ms, scrollTop, maxScroll, target, state, questionTopInRegion, answerTopInRegion]", JSON.stringify(dedup));
	note("d6 answered-followup rest", JSON.stringify({ ...cEnd, questionTopInRegion: gEnd.questionTopInRegion, answerTopInRegion: gEnd.answerTopInRegion, cap: gEnd.cap, clientHeight: gEnd.clientHeight, answerLineHeight: gEnd.answerLineHeight, rowsToEdge: gEnd.rowsBetweenAnswerTopAndEdge, crossing: gEnd.crossing }));

	const monotone = samples.every((s, i) => i === 0 || s[1] === null || s[1] >= samples[i - 1][1] - 1);
	r2check(
		"d6 the answered follow-up's question sits at the region's top (`questionTopInRegion` within 1.5 px) and its first answer row is inside the clip, at rest and for every sample after the region reached the turn",
		(gEnd.questionTopInRegion ?? 99) <= 1.5 && (gEnd.answerTopInRegion ?? 99) < (gEnd.clientHeight ?? 0) && monotone,
		JSON.stringify({
			questionTopInRegion: gEnd.questionTopInRegion,
			answerTopInRegion: gEnd.answerTopInRegion,
			clientHeight: gEnd.clientHeight,
			scrollTop: cEnd?.scrollTop,
			target: cEnd?.target,
			maxScroll: cEnd?.maxScroll,
			monotone,
			shortestGapPx: Math.min(...samples.filter((s) => s[1] !== null && s[3] !== null && s[3] <= (s[2] ?? 0)).map((s) => s[3] - s[1])),
		}),
	);

	await h.closePanel();
	return { tree: "d6-answer", frames: [] };
}
