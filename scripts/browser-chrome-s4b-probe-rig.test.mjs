import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const SOURCE = readFileSync(
	new URL("./browser-chrome-s4b-probe.mjs", import.meta.url),
	"utf8",
);
const FATAL_ERROR_CLASS = /class HistorySceneRigError extends Error/;
const NAMED_RAISE_FAILURE = /if \(!raised\)\s*throw new HistorySceneRigError\(/;
const RAISE_STEP_MESSAGE =
	/`history scene: \$\{step\}: address row did not take focus`/;
const UNNAMED_RAISE = /await raise\(cdp\);/;
const FATAL_SCENE_RETHROW =
	/\} catch \(error\) \{\s*if \(error instanceof HistorySceneRigError\) throw error;/;

test("history raise failures stop at their named step instead of cascading blocked rows", () => {
	/*
	 * A permanent row that does not take focus is a product-state failure the
	 * scene must report where it happened. Letting that false raise fall through
	 * to typeInAddressField used to turn it into "no address input", then the catch labelled
	 * every remaining row BLOCKED and left the notice matrix pending. A fatal rig
	 * error must cross the scene catch so only the outer failure path reports it.
	 */
	assert.match(SOURCE, FATAL_ERROR_CLASS);
	assert.match(SOURCE, NAMED_RAISE_FAILURE);
	assert.match(SOURCE, RAISE_STEP_MESSAGE);
	assert.doesNotMatch(
		SOURCE,
		UNNAMED_RAISE,
		"every raise must name the step whose product state failed",
	);
	assert.match(SOURCE, FATAL_SCENE_RETHROW);
});
