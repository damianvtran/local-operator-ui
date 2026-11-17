/**
 * Every onboarding tour target exists in the app (PostHog D5).
 *
 * Shepherd's "The element for this Shepherd step was not found" appeared in
 * ~15 sessions because three steps pointed at `data-tour-tag`s the app no
 * longer rendered (`agent-list-panel`, `agent-list-item-button-0`,
 * `settings-integrations-section`). `guardTourTargets` now skips a step whose
 * target is absent at runtime; this sweep catches the cause at review time:
 * a tour selector that no component outside the tour can render fails here.
 *
 * Sweeps every `.ts`/`.tsx` under the renderer (not stories or tests), and
 * accepts a tag written as a literal attribute or as a `tourTag` prop value.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = "src/renderer/src";
const TOUR = "src/renderer/src/features/onboarding/tour/tour-steps.ts";
const TAG = /data-tour-tag="([^"$]+)"/g;
const PROP = /tourTag[=:]\s*"([^"]+)"/g;

function* sources(dir) {
	for (const name of readdirSync(dir)) {
		const path = join(dir, name);
		if (statSync(path).isDirectory()) {
			if (name === "node_modules") continue;
			yield* sources(path);
		} else if (/\.(ts|tsx)$/.test(name) && !/\.(stories|test)\./.test(name)) {
			yield path;
		}
	}
}

test("every data-tour-tag the tour targets is rendered somewhere outside the tour", () => {
	const tour = readFileSync(TOUR, "utf8");
	const wanted = new Set([...tour.matchAll(TAG)].map((m) => m[1]));
	assert.ok(
		wanted.size > 20,
		`the sweep found the tour's selectors (${wanted.size})`,
	);
	const rendered = new Set();
	for (const path of sources(ROOT)) {
		if (path.includes("features/onboarding/tour")) continue;
		const text = readFileSync(path, "utf8");
		for (const m of text.matchAll(TAG)) rendered.add(m[1]);
		for (const m of text.matchAll(PROP)) rendered.add(m[1]);
		// A tag passed as a prop or a variable (`data-tour-tag={tourTag}`) is
		// written as a plain quoted string at its call site.
		for (const tag of wanted) if (text.includes(`"${tag}"`)) rendered.add(tag);
	}
	const missing = [...wanted].filter((tag) => !rendered.has(tag)).sort();
	assert.deepEqual(
		missing,
		[],
		`tour targets with no element in the app: ${missing.join(", ")}`,
	);
});

test("every attached step is guarded against a missing target at show time", () => {
	const tour = readFileSync(TOUR, "utf8");
	assert.match(tour, /guardTourTargets\(buildTourSteps\(\)/);
	assert.match(
		tour,
		/showOn: \(\) => \{[\s\S]*?if \(present\(element\)\) return true;[\s\S]*?onSkipped\?\.\(/,
	);
});
