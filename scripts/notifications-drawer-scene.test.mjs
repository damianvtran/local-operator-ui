/**
 * Narrow tests for the drawer scene's revised-row wait; no Electron, core or
 * provider launch. Regression for run 44677507218 (PR #2001), where the final
 * "Mark read" pressed a row still drawn at revision 1 and core correctly skipped it
 * as `stale_revision`. See `untilRevisionRendered` in the scene for the full why.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
	REVISED_TITLE,
	untilRevisionRendered,
} from "./notifications-drawer-scene.mjs";

/* A CDP stand-in that answers the probe from a scripted sequence of rendered
 * titles, evaluating the scene's own probe against a minimal DOM. */
function fakeCdp(titles) {
	const probes = [];
	let tick = 0;
	return {
		probes,
		async evaluate(expression) {
			probes.push(expression);
			const title = titles[Math.min(tick++, titles.length - 1)];
			const row = { textContent: title };
			const document = {
				querySelector: (selector) =>
					selector === '[data-drawer-update="n_row"]' ? row : null,
			};
			const CSS = { escape: (value) => value };
			return new Function("document", "CSS", `return ${expression}`)(
				document,
				CSS,
			);
		},
	};
}

/* `until`'s contract with a bounded number of polls instead of wall time. */
const boundedWait = (polls) => async (check, label) => {
	let last;
	for (let index = 0; index < polls; index += 1) {
		last = await check();
		if (last) return last;
	}
	throw new Error(`${label}: timed out (${JSON.stringify(last)})`);
};

test("waits until the revised revision is drawn, not just any row", async () => {
	const cdp = fakeCdp([
		"Drawer update 11: detailed verification",
		"Drawer update 11: detailed verification",
		REVISED_TITLE,
	]);
	assert.equal(await untilRevisionRendered(cdp, "n_row", boundedWait(5)), true);
	assert.equal(cdp.probes.length, 3);
});

test("a row that stays at its old revision is a timeout, never a press", async () => {
	const cdp = fakeCdp(["Drawer update 11: detailed verification"]);
	await assert.rejects(
		untilRevisionRendered(cdp, "n_row", boundedWait(4)),
		/revised revision rendered: timed out \(false\)/,
	);
});

test("the final Mark read waits for the revised row, after Undo and before the press", () => {
	const source = readFileSync(
		new URL("./notifications-drawer-scene.mjs", import.meta.url),
		"utf8",
	);
	const undo = source.indexOf('surface: "Undo refusal and retry"');
	const wait = source.indexOf("await untilRevisionRendered(cdp, stale.id)");
	const press = source.indexOf(
		'await click(cdp, "[data-drawer-mark-all-read]")',
		wait,
	);
	const empty = source.indexOf('"last unread empty state",', press);
	assert.ok(undo > 0 && wait > undo, "wait must follow the Undo retry");
	assert.ok(press > wait && empty > press, "wait must precede the final press");
	assert.ok(
		source.includes("title=${JSON.stringify(REVISED_TITLE)}"),
		"revise() must write the title the wait looks for",
	);
});
