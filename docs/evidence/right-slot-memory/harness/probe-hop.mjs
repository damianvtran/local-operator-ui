/**
 * The hop, sampled frame by frame: the bound on "the occupant changes in the same
 * frame the transcript does".
 *
 *   node probe-hop.mjs --after http://localhost:5321 --scratch <rig scratch> \
 *        [--theme localOperatorDark] [--out probe-hop-after.json]
 *
 * WHY A SEPARATE SCRIPT AND A LONGER BURST. `drive-slot.mjs`'s samplers ride each
 * case (2.5s across a hop), because a report wants the frames beside the stills. The
 * question a reader actually asks of this feature - *did the previous conversation's
 * pane ever paint over the new one?* - is a question about a COUNT over a window, so
 * it wants a burst longer than any plausible arrival, and it wants the counts read
 * off the page rather than eyeballed off two stills. This is the asks lane's
 * `probe-switch-flash.mjs` shape, one slot over: sample every animation frame from
 * the switch, then report how many painted frames on the DESTINATION still carried a
 * pane, and which pane.
 *
 * The reading that matters is `onB.withAPane`, and the claim is that it is ZERO on
 * the branch and NON-ZERO on `main`: on the before tree the four flags are the
 * window's, so the canvas the reader left on A is still mounted over B's transcript
 * until something closes it. `onB.withTheLeftPanesPane` narrows that to the pane the
 * reader actually left open, so the number cannot be satisfied by B legitimately
 * opening a pane of its own.
 *
 * ONE Chrome, one page, one context: nothing here writes `localStorage` except the
 * first-run seed, and the conversation it hops between is the rig's own.
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import {
	SESSION,
	connect,
	launchChrome,
	makeProfile,
	openPage,
	summariseTimeline,
	wait,
} from "./rig-lib.mjs";

const argv = process.argv.slice(2);
const flag = (name) => {
	const at = argv.indexOf(`--${name}`);
	return at === -1 ? null : (argv[at + 1] ?? "");
};
const AFTER = flag("after");
const BEFORE = flag("before");
const SCRATCH = flag("scratch");
const OUT = flag("out");
const THEME = flag("theme") ?? "localOperatorDark";
const BURST_MS = Number(flag("burst") ?? 6000);
if ((!AFTER && !BEFORE) || !SCRATCH) {
	console.error(
		"usage: probe-hop.mjs (--after <url> | --before <url>) --scratch <rig scratch> [--theme <palette>] [--out <file>]",
	);
	process.exit(2);
}
if (AFTER && BEFORE) {
	console.error("probe-hop.mjs: one arm per invocation (see drive-slot.mjs's note)");
	process.exit(2);
}
const url = AFTER ?? BEFORE;
const arm = AFTER ? "after" : "before";

const profile = makeProfile();
const chrome = launchChrome({ profile });
const { raw, close } = await connect(chrome);

/** The marks on one conversation: what the sampler read while the route was there. */
function onConversation(marks, sessionId) {
	return marks.filter((mark) => mark.hash === sessionId);
}

/**
 * What a burst says about one hop, as the numbers the claim is stated in.
 *
 * COUNTED OVER THE RAW MARKS, one per animation frame - not over a collapsed summary
 * of the states they passed through. `summariseTimeline` keeps only the frames where
 * something MOVED, which is the right shape for a report beside stills and the wrong
 * shape for "how many painted frames carried the wrong pane": a collapsed list would
 * report that question as one or two. The counts below are frames.
 */
function readHop(marks, destination, leftBehind) {
	const hop = summariseTimeline(marks);
	const onDestination = onConversation(marks, SESSION[destination]);
	return {
		framesSampled: hop.framesSampled,
		distinctStates: hop.changes,
		framesOnDestination: onDestination.length,
		withAPane: onDestination.filter((mark) => mark.drawn !== "").length,
		withTheLeftPanesPane: onDestination.filter((mark) => mark.drawn === leftBehind)
			.length,
		withALitItem: onDestination.filter((mark) => mark.lit !== "").length,
		firstMarks: onDestination.slice(0, 6),
		lastMarks: onDestination.slice(-3),
	};
}

const report = { arm, theme: THEME, origin: url, burstMs: BURST_MS };
try {
	const page = await openPage(raw, {
		url,
		outDir: join(SCRATCH, "probe"),
		arm,
		theme: THEME,
	});
	await page.open(`#/chat/${SESSION.A}`);
	await wait(2500);
	await page.pressRail("canvas");
	await page.waitFor(
		`document.querySelector('[data-tour-tag="canvas-dock"]') !== null`,
		"the canvas pane",
	);
	await wait(2500);
	report.openedOnA = { probe: await page.probe(), memory: await page.memory() };

	await page.startSampler(BURST_MS);
	await wait(150);
	await page.pressRow("B");
	await wait(BURST_MS + 500);
	report.hopAtoB = readHop(await page.timeline(), "B", "canvas");
	report.settledOnB = { probe: await page.probe(), memory: await page.memory() };

	await page.startSampler(BURST_MS);
	await wait(150);
	await page.pressRow("A");
	await wait(BURST_MS + 500);
	report.hopBtoA = readHop(await page.timeline(), "A", "canvas");
	report.settledOnA = { probe: await page.probe(), memory: await page.memory() };

	await page.close();
} catch (error) {
	report.fatal = String(error?.stack ?? error);
} finally {
	const text = `${JSON.stringify(report, null, 2)}\n`;
	console.log(text);
	if (OUT) {
		mkdirSync(dirname(OUT), { recursive: true });
		writeFileSync(OUT, text);
	}
	try {
		await close();
	} catch {
		/* already gone */
	}
	chrome.kill();
	await wait(600);
}
