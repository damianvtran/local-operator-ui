import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { nextPickerEscapeAction } from "../src/renderer/src/features/chat/chat-tag-escape.ts";

/*
 * The picker's Escape decision, as an executed contract with no DOM.
 *
 * WHY THIS SHAPE. The same interaction was first written as a jsdom test that
 * mounted the dialog and dispatched Escape twice; it took the process group to
 * 9-10 GB and was killed by the runner's memory guard, twice, in two different
 * mounts. The decision underneath it is two booleans, so it is lifted into
 * `chat-tag-escape.ts` and asserted here in a plain `node:test` process - no
 * React, no jsdom, no esbuild bundle - while the dialog handler calls the same
 * function. The rendered interaction itself stays with QA/design, which is where
 * a real dismissal belongs.
 *
 * WHAT THIS FILE DOES NOT CLAIM: that Radix dismisses the picker. That is the
 * dialog layer's contract, and it is still exercised by the Manage Escape case
 * inside the jsdom behaviour suite, which uses the real dialog primitive.
 */

test("a write in flight swallows Escape while the list is open", () => {
	assert.equal(
		nextPickerEscapeAction({ pending: true, listOpen: true }),
		"ignore",
	);
});

test("a write in flight swallows Escape after the list is collapsed", () => {
	assert.equal(
		nextPickerEscapeAction({ pending: true, listOpen: false }),
		"ignore",
	);
});

test("Escape over an open suggestion list collapses it", () => {
	assert.equal(
		nextPickerEscapeAction({ pending: false, listOpen: true }),
		"collapse",
	);
});

test("Escape over a closed list asks the dialog to close", () => {
	assert.equal(
		nextPickerEscapeAction({ pending: false, listOpen: false }),
		"close",
	);
});

test("the picker's Escape handler never writes", () => {
	// The handler may narrow the surface or let the dialog dismiss, and nothing
	// else: there is no staged draft, so an Escape that touched the store would
	// be an undo the surface never offered.
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-session-tags-dialog.tsx",
		"utf8",
	);
	const handler = source.slice(source.lastIndexOf("onEscapeKeyDown"));
	for (const call of [
		"setIds(",
		"setHeld(",
		"assignSessionTags(",
		"toggle(",
		"createAndAssign(",
		"replaceCategories(",
	]) {
		assert.ok(
			!handler.includes(call),
			`Escape must not write to the tag state (found ${call})`,
		);
	}
	assert.ok(
		handler.includes("nextPickerEscapeAction("),
		"the handler delegates the decision to the tested helper",
	);
});
