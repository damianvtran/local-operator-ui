
/* ===================================================================== *
 *   UX ROUND 4 — the probe scene (scene-ux4d)
 *
 * Two things scene-ux4 could not answer:
 *
 *  D1. WHY the narrow refusal landed where it did. scene-ux4b's reading at 800px
 *      shows the newest question at the region's top with the refusal cut (1 of 7
 *      rows inside the clip), and r5Clip's `target` (the region's LAST child, at
 *      content-offset 293.1) is greater than the region's `maxScroll` (222) - so the
 *      move's own target was unreachable and the region should have rested at the
 *      clamp (222), not at 104.5. This scene samples the geometry from BEFORE the
 *      ask to the settle, and dumps the region's own children, so the path and the
 *      resting place are read rather than inferred. It then presses End with the
 *      region focused, which is the user's own escape from wherever it rests.
 *
 *  D2. THE READER-WINS arm, with a window the rig can actually catch. scene-ux4c's
 *      third arm scrolled by hand before a mermaid diagram landed, but the mermaid
 *      module is cached by then, so on its second use in a run the SVG arrives
 *      inside one 40ms poll and the pre-diagram window is unobservable - the arm
 *      never reached its own state (its log: `early: null`). A long streamed answer
 *      gives the same property with a window seconds wide: the region is growing
 *      while the move keeps re-asking, the reader scrolls, and the rest of the
 *      answer arrives.
 * ===================================================================== */

/** The region's children and the boxes inside it, as the DOM has them. */
function ux4dGeo(cdp) {
	return cdp.evaluate(`(() => {
		const panel = document.querySelector("[data-lo-aside-panel]");
		const region = panel ? panel.querySelector('[aria-label="The aside exchange"]') : null;
		if (!region) return null;
		const rr = region.getBoundingClientRect();
		const rd = (x) => Math.round(x * 10) / 10;
		const kids = Array.from(region.children).map((c) => {
			const r = c.getBoundingClientRect();
			return {
				cls: String(c.className || "").slice(0, 48),
				top: rd(r.top - rr.top),
				topAbs: rd(region.scrollTop + r.top - rr.top),
				h: rd(r.height),
				text: (c.textContent || "").replace(/\\s+/g, " ").trim().slice(0, 36),
			};
		});
		const ps = Array.from(region.querySelectorAll("p")).map((p) => {
			const r = p.getBoundingClientRect();
			return { topAbs: rd(region.scrollTop + r.top - rr.top), h: rd(r.height) };
		});
		const alert = region.querySelector('[role="alert"]');
		const ar = alert ? alert.getBoundingClientRect() : null;
		return {
			scrollTop: rd(region.scrollTop),
			maxScroll: region.scrollHeight - region.clientHeight,
			clientHeight: region.clientHeight,
			contentHeight: region.scrollHeight,
			children: kids,
			paragraphsAbs: ps,
			alert: ar ? { topAbs: rd(region.scrollTop + ar.top - rr.top), h: rd(ar.height) } : null,
			text: (region.textContent || "").replace(/\\s+/g, " ").trim().slice(-60),
		};
	})()`);
}

async function sceneBtwUx4d(cdp) {
	const facts = await factsOf(cdp);
	r2check("headless and never shown", facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`);
	const { sessionId } = await qaOpenSession(cdp);
	note("UX4d session", sessionId);
	const h = await ux3Harness(cdp, `ux4d-${RUN_LABEL}`);
	const log = (label, value) => note(label, JSON.stringify(value));

	await h.replaceComposer("ux4d seed turn");
	await clickAt(cdp, UX4.FIELD);
	await h.enter();
	await h.until((r) => (r.transcriptText ?? "").includes(UX4.TAIL) && !r.transcriptWorking, 60000);
	await h.idle();

	/* --- D1: the settle path of a refused follow-up at this width ---------- */
	const A = await ux4BaseWith(cdp, h, "/btw UD1 what does the retry budget cap", "UD1 what does the retry budget cap");
	await h.idle();
	await h.until((r) => h.settled(r), 30000);
	const beforeAsk = await ux4dGeo(cdp);
	log("D1 the region before the refused follow-up", beforeAsk);

	/*
	 * The sampler runs BESIDE the press rather than after it: the interesting moment is
	 * the one where the refusal replaces the thinking line, and a reading taken after
	 * the dust settles has already missed the path that got there.
	 */
	const tPress = Date.now();
	const trail = [];
	let last = null;
	let stop = false;
	const sampler = (async () => {
		while (!stop) {
			const g = await ux4dGeo(cdp).catch(() => null);
			if (g) {
				const key = `${g.scrollTop}|${g.contentHeight}|${g.alert?.topAbs ?? "x"}`;
				if (!last || last !== key) {
					last = key;
					trail.push({ ms: Date.now() - tPress, scrollTop: g.scrollTop, maxScroll: g.maxScroll, contentHeight: g.contentHeight, children: g.children.map((c) => `${c.top}+${c.h}`), alertTopAbs: g.alert?.topAbs ?? null });
				}
			}
			await wait(60);
		}
	})();
	await clickAt(cdp, UX4.FIELD);
	await h.type("TOOLCALL2: UD1 the follow-up the model declines");
	await h.enter();
	const decl = await h.until((r) => r.refusalText !== null, 30000);
	await wait(2600);
	stop = true;
	await sampler;
	const settled = await ux4dGeo(cdp);
	const clip = await r5Clip(cdp);
	log("D1 the path, from the press to the settle", { trail, met: decl.met });
	log("D1 the settled geometry", settled);
	log("D1 the clip at the settle", clip);
	r2check("D1 the refusal is not fully inside the region's clip at 800px on the settled reading",
		clip !== null && clip.rows !== clip.rowsFullyVisible && clip.phrase?.visible === false,
		JSON.stringify({ rows: clip?.rows, fullyVisible: clip?.rowsFullyVisible, hiddenBelowPx: clip?.hiddenBelowPx, phrase: clip?.phrase }));
	const restScroll = settled?.scrollTop ?? null;
	const target = clip?.target ?? null;
	/*
	 * A diagnostic, not a verdict, and worded so it can FAIL: the region's resting
	 * place cannot be the move's target (the newest turn's top, `target`) because
	 * `target > maxScroll` - so a move that ran to completion there is impossible -
	 * and it is not the clamp either, which is where a move that found its target
	 * unreachable must stop (D11's "keep asking until the clamp stops biting").
	 */
	r2check("D1 the resting place is neither end of the region: mid-content, with the move's own target beyond the region's maximum scroll",
		settled !== null && clip !== null && restScroll !== null && target !== null &&
			restScroll > 0.5 && restScroll < settled.maxScroll - 0.5 && target > settled.maxScroll + 0.5,
		JSON.stringify({ restScroll, maxScroll: settled?.maxScroll, target, children: settled?.children }));
	await h.take("d01-the-settled-refusal-at-the-edge");

	/* The user's own escape: End with the region focused. */
	await clickAt(cdp, UX4.FIELD);
	const stops = [];
	for (let i = 0; i < 4; i++) {
		await h.tab(true);
		await wait(150);
		const r = await h.read();
		stops.push(r.active);
		if ((r.active ?? "").includes("The aside exchange")) break;
	}
	await pressChord(cdp, { key: "End", code: "End", virtualKeyCode: 35 });
	await wait(400);
	const afterEnd = await ux4dGeo(cdp);
	const clipAfterEnd = await r5Clip(cdp);
	log("D1 after End with the region focused", { stops, afterEnd, clipAfterEnd });
	r2check("D1 one key press on the region brings the whole refusal into the clip (the remedy is reachable, not lost)",
		clipAfterEnd !== null && clipAfterEnd.hiddenBelowPx <= 0.5 && clipAfterEnd.phrase?.visible === true &&
			afterEnd !== null && afterEnd.scrollTop >= (settled?.maxScroll ?? 0) - 1,
		JSON.stringify({ scrollTop: afterEnd?.scrollTop, maxScroll: settled?.maxScroll, hiddenBelowPx: clipAfterEnd?.hiddenBelowPx, phrase: clipAfterEnd?.phrase }));
	await h.take("d02-after-end-the-refusal-is-read");

	/* --- D2: the reader wins, on a growth the rig can catch ---------------- */
	await h.esc();
	await wait(400);
	const B = await ux4BaseWith(cdp, h, "/btw UD2 a base turn above the interrupted answer", "UD2 a base turn above the interrupted answer");
	await h.idle();
	await h.until((r) => h.settled(r), 30000);
	await h.replaceComposer("/btw LONGANSWER UD2 the answer the reader interrupts");
	await clickAt(cdp, UX4.FIELD);
	const tStream = Date.now();
	await h.enter();
	let ready = null;
	for (let i = 0; i < 300; i++) {
		const b = await ux4Boxes(cdp);
		if (b && b.maxScroll > 40 && (b.contentHeight ?? 0) > 500) { ready = { ms: Date.now() - tStream, ...b }; break; }
		await wait(50);
	}
	await clickAt(cdp, UX4.FIELD);
	for (let i = 0; i < 4; i++) {
		await h.tab(true);
		await wait(150);
		const r = await h.read();
		if ((r.active ?? "").includes("The aside exchange")) break;
	}
	const beforeHand = await ux4Boxes(cdp);
	for (let i = 0; i < 3; i++) {
		await pressChord(cdp, { key: "PageUp", code: "PageUp", virtualKeyCode: 33 });
		await wait(120);
	}
	const afterHand = await ux4Boxes(cdp);
	const after = [];
	let prev = null;
	for (let i = 0; i < 400; i++) {
		const b = await ux4Boxes(cdp);
		if (b && (!prev || b.contentHeight !== prev.contentHeight || b.scrollTop !== prev.scrollTop)) {
			after.push({ ms: Date.now() - tStream, scrollTop: b.scrollTop, contentHeight: b.contentHeight, questionAbs: b.questionAbs, questionRel: b.questionRel });
			prev = b;
		}
		const r = await h.read();
		if (r.adoptDisabled === false) break;
		await wait(60);
	}
	const end = await ux4Boxes(cdp);
	log("D2 the reader's scroll mid-stream", { ready, focus: (await h.read()).active, beforeHand, afterHand, after, end });
	r2check("D2 the arm is real: the answer was still growing when the reader scrolled, and the scroll moved the region",
		ready !== null && afterHand !== null && beforeHand !== null && beforeHand.scrollTop - afterHand.scrollTop > 4 &&
			(end?.contentHeight ?? 0) - (afterHand?.contentHeight ?? 0) > 100,
		JSON.stringify({ before: beforeHand?.scrollTop, after: afterHand?.scrollTop, grew: (end?.contentHeight ?? 0) - (afterHand?.contentHeight ?? 0) }));
	r2check("D2 the reader wins: the rest of the stream does not drag the region back",
		afterHand !== null && end !== null && Math.abs(end.scrollTop - afterHand.scrollTop) <= 1.1 &&
			after.slice(1).every((s) => Math.abs(s.scrollTop - afterHand.scrollTop) <= 1.1),
		JSON.stringify({ hand: afterHand?.scrollTop, end: end?.scrollTop, trail: after.map((s) => s.scrollTop) }));
	await h.take("d03-the-reader-wins-on-a-streamed-answer");

	note("UX4d scene", "finished");
}
