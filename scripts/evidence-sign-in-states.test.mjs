/**
 * The frames that CLAIM a panel state must not be the same image as the frames
 * that claim another one.
 *
 * WHY THIS FILE EXISTS. `panel-succeeded-with-default`, `panel-expired`,
 * `panel-gone-404` and `panel-failed` were committed byte-identical to each other
 * and to both waiting frames: the capture shoot ran 900 ms after the click while
 * those stories settle about 1.5 s in, so four terminal states shipped as four
 * copies of the WAITING panel and the PR's evidence claimed states it did not
 * have (code round 1 M3, design round 1 D1, QA round 1 Q8). The rig now waits for
 * `[data-sign-in-state=...]` before the shutter (see the rows in
 * `scripts/capture-evidence.mjs`), and this is the half that fails if someone
 * removes that wait again: a hash comparison over the committed bytes, which
 * costs nothing and needs no browser.
 *
 * WHY THE TWO WAITING FRAMES ARE ALLOWED TO MATCH. They are the same UI reached
 * from two backend shapes; the difference is the readout, not the pixels, and
 * that pair is the set's own demonstration that both shapes work.
 */

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import { test } from "node:test";

const SET = "docs/evidence/provider-sign-in-onboarding";

/** The states whose frames must be images of DIFFERENT screens. */
const DISTINCT_STATES = [
	"panel-succeeded-with-default",
	"panel-expired",
	"panel-gone-404",
	"panel-failed",
	"panel-cancelled-superseded",
	"panel-waiting-first-click-released-backend",
	"panel-waiting-url-on-start-reply",
	"panel-paste-required",
	"panel-paste-required-no-url",
];

const hashOf = (state) => {
	const file = `${SET}/${state}/localOperatorDark.webp`;
	assert.ok(existsSync(file), `the set must carry ${file}`);
	return createHash("sha256").update(readFileSync(file)).digest("hex");
};

test("every terminal panel state is its own image, and not the waiting one", () => {
	const hashes = new Map();
	for (const state of DISTINCT_STATES) hashes.set(state, hashOf(state));

	/*
	 * The two waiting frames are ONE screen reached two ways, so they are allowed
	 * to be equal to each other and to nothing else.
	 */
	const waiting = new Set([
		hashes.get("panel-waiting-first-click-released-backend"),
		hashes.get("panel-waiting-url-on-start-reply"),
	]);
	for (const [state, hash] of hashes) {
		if (state.startsWith("panel-waiting")) continue;
		assert.ok(
			!waiting.has(hash),
			`${state} is byte-identical to a waiting frame: the capture shot before the state it names`,
		);
	}

	for (const [a, hashA] of hashes) {
		for (const [b, hashB] of hashes) {
			if (a >= b) continue;
			if (a.startsWith("panel-waiting") && b.startsWith("panel-waiting"))
				continue;
			assert.notEqual(
				hashA,
				hashB,
				`${a} and ${b} are the same image, so one of the two states has no evidence`,
			);
		}
	}
});
