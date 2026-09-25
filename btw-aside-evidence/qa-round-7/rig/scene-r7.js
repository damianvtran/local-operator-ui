/*
 * QA round 7 (PR #482), scene `btw-r7-fold`.
 *
 * THE QUESTION THIS SCENE EXISTS FOR. The fold onto main `a7df70995` brought in
 * three of main's own commits through a SEMANTIC merge of
 * `src/renderer/src/shared/hooks/use-canonical-session.ts` (main's rewritten file
 * as the base, this branch's lines re-applied on top). Three of those commits own
 * holds that a bad merge could silently drop:
 *
 *   - ada190446 (#490): every SEEDED tool row is labelled on open — a row whose
 *     arguments are still being read must not paint a line of the call's OUTPUT
 *     in its object column, and the `labelPending` hold is what stops it;
 *   - 8789182bb: a send into a conversation the user has LEFT goes nowhere;
 *   - 8ddc411d0: a silent open is bounded and an early send is held for the
 *     stream.
 *
 * This scene drives the FIRST of those on the running app, twice: once while the
 * turn is live, and once after leaving and RE-ENTERING mid-turn — which is the
 * join that seeds rows from the live snapshot, i.e. #490's own reproduction. The
 * `read` tool call the scripted provider makes carries `{"path": "README.md"}`,
 * so the row's summary must name README.md; the workspace README carries the
 * marker `ZZLIVEBODYZZ`, so a row that fell back to the call's OUTPUT is
 * identifiable by that marker appearing in the summary cell.
 *
 * The other two holds are driven by main's own committed rigs
 * (`session-switch-latency.mjs --held-leave` / `--held-stay`, and the node tests
 * main added), not from here.
 */

/** Every run of rows the transcript has painted, with the summary cell's text. */
function r7ToolRows(cdp) {
	return cdp.evaluate(`(() => {
		const root = document.querySelector("[data-lo-canonical-transcript]");
		if (!root) return null;
		const rows = Array.from(root.querySelectorAll("[data-record-kind]"));
		const clean = (s) => (s || "").replace(/\\s+/g, " ").trim();
		return rows.map((row) => {
			/* The summary cell is the row's one flex-1 cell (the name column is
			 * shrink-0 and the counters/outcome are their own cells), which is the
			 * cell summaryFromArgs writes into. */
			const cell = Array.from(row.querySelectorAll("span")).find((s) =>
				String(s.className || "").includes("flex-1"),
			);
			return {
				kind: row.getAttribute("data-record-kind"),
				row: clean(row.innerText || row.textContent).slice(0, 160),
				summary: clean(cell ? cell.innerText || cell.textContent : "").slice(0, 160),
				summaryTitle: clean(cell ? cell.getAttribute("title") : "").slice(0, 160),
			};
		});
	})()`);
}

async function r7AwaitToolRow(cdp, ms = 30000) {
	const t0 = Date.now();
	for (let i = 0; i < Math.ceil(ms / 250); i++) {
		const rows = await r7ToolRows(cdp);
		if (rows && rows.some((r) => (r.row || "").includes("read"))) return Date.now() - t0;
		await wait(250);
	}
	return null;
}

function r7FoldVerdict(rows, where) {
	const tool = (rows ?? []).filter((r) => (r.row || "").startsWith("read") || (r.summary || "").includes("README"));
	const labelled = tool.filter((r) => (r.summary || "").includes("README.md"));
	const outputSnippet = tool.filter((r) => (r.summary || "").includes("ZZLIVEBODYZZ"));
	/* `read composing` is the row's PENDING state: the call has been announced and
	 * its arguments have not arrived. It is honest - it states nothing the turn
	 * does not know - so it counts as not-yet-labelled rather than as a fallback to
	 * the output. What must NEVER appear in the summary cell is the call's OUTPUT. */
	const pending = tool.filter((r) => (r.summary || "").includes("composing"));
	return {
		where,
		toolRows: tool.length,
		labelled: labelled.length,
		pending: pending.length,
		carryingOutputSnippet: outputSnippet.length,
		samples: tool.slice(0, 3),
	};
}

async function sceneBtwR7Fold(cdp) {
	const facts = await factsOf(cdp);
	r2check(
		"window mode is headless and the window is never shown",
		facts.windowMode === "headless" && facts.visible === false,
		`mode=${facts.windowMode} visible=${facts.visible} focused=${facts.focused}`,
	);
	const { sessionId } = await qaOpenSession(cdp);
	note("R7 fold session", sessionId);
	const h = r5Harness(cdp, `qa7fold-${RUN_LABEL}`);

	/* A turn that keeps calling a `read` tool, so there is a window in which to
	 * leave and come back while it runs. The wait is on the row PAINTING at all,
	 * not on it being labelled: at this instant the call is likely still
	 * `composing`, which is the state #490 was reported against. */
	await clickAt(cdp, R4.FIELD);
	await h.type("TOOLCALL2: r7 fold label probe");
	await h.enter();
	const paintedAt = await r7AwaitToolRow(cdp, 30000);
	note("R7 the tool row's first paint, ms after the press", String(paintedAt));
	const band = await h.band();
	const live = await r7ToolRows(cdp);
	const liveVerdict = r7FoldVerdict(live, "live");
	note(
		"R7 LIVE rows (the turn is still streaming here, so this is the seed's own state)",
		JSON.stringify({ paintedAt, streaming: band.transcriptStreaming, verdict: liveVerdict, rows: live }),
	);
	await h.take("r7fold-1-live-tool-row");

	/* THE SEED. Leave the conversation entirely and come back BEFORE the turn
	 * settles: the pane remounts and its rows come from the live seed plus the
	 * snapshot page, which is the state #490 was reported against. */
	note("R7 streaming at the leave", String((await h.band()).transcriptStreaming));
	const left = await r5LeaveAndReenter(cdp, sessionId, "/settings");
	const t0 = left.t0;
	let seeded = null;
	for (let i = 0; i < 80; i++) {
		const rows = await r7ToolRows(cdp);
		if (rows && rows.some((r) => (r.row || "").includes("read"))) {
			seeded = rows;
			break;
		}
		await wait(250);
	}
	const streamingAtReenter = (await h.band()).transcriptStreaming;
	note("R7 seeded rows, ms after the re-enter", String(Date.now() - t0));
	note("R7 the turn was still streaming when the re-entered pane painted", String(streamingAtReenter));
	const seededVerdict = r7FoldVerdict(seeded, "seeded-on-reenter");
	note(
		"R7 SEEDED rows after a mid-turn re-enter",
		JSON.stringify({ verdict: seededVerdict, rows: (seeded ?? []).slice(0, 8) }),
	);
	await h.take("r7fold-2-seeded-after-reenter");

	r2check(
		"R7 fold a: the call's OUTPUT never reaches a tool row's summary cell (ZZLIVEBODYZZ absent while the turn is live AND after a mid-turn re-enter), and the row names its argument (README.md) as soon as the arguments have arrived",
		liveVerdict.toolRows > 0 &&
			liveVerdict.carryingOutputSnippet === 0 &&
			seededVerdict.toolRows > 0 &&
			seededVerdict.labelled === seededVerdict.toolRows &&
			seededVerdict.carryingOutputSnippet === 0,
		JSON.stringify({ live: liveVerdict, seeded: seededVerdict, streamingAtReenter }),
	);

	/* The row must survive a SETTLED reopen too: the same summary, painted this time
	 * from the durable page rather than a seed. */
	await wait(4000);
	const settled = await r7ToolRows(cdp);
	const settledVerdict = r7FoldVerdict(settled, "settled");
	note("R7 settled rows", JSON.stringify(settledVerdict));
	r2check(
		"R7 fold b: once the turn has settled the same row still names its argument and not its output",
		settledVerdict.toolRows > 0 &&
			settledVerdict.labelled === settledVerdict.toolRows &&
			settledVerdict.carryingOutputSnippet === 0,
		JSON.stringify(settledVerdict),
	);
	return { tree: "qa7-fold", frames: [] };
}
