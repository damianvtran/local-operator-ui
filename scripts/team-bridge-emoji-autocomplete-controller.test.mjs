import assert from "node:assert/strict";
import { test } from "node:test";
import {
	autocompleteOwner,
	emojiOptionId,
	emojiPopoverPosition,
	isEmojiTyping,
	routeAutocompleteKey,
} from "../src/renderer/src/features/team-bridge/emoji/emoji-autocomplete-controller.ts";

// Pure contracts only: DOM event ordering and rendered layout still require the
// accepted dependency closure, actual hosts and independent browser validation.
test("one owner wins; the latest token wins an overlap, mentions win a tie", () => {
	assert.equal(autocompleteOwner(null, null), "none");
	assert.equal(autocompleteOwner(0, null), "mention");
	assert.equal(autocompleteOwner(null, 0), "emoji");
	assert.equal(autocompleteOwner(3, 8), "emoji");
	assert.equal(autocompleteOwner(8, 3), "mention");
	assert.equal(autocompleteOwner(3, 3), "mention");
});

test("consumed keys never reach composer or competing autocomplete", () => {
	for (const owner of ["mention", "emoji"]) {
		const calls = [];
		const event = { key: "Enter" };
		assert.equal(routeAutocompleteKey(owner, event, {
			mention: (actual) => {
				assert.equal(actual, event);
				calls.push("mention");
				return true;
			},
			emoji: (actual) => {
				assert.equal(actual, event);
				calls.push("emoji");
				return true;
			},
			composer: () => calls.push("composer"),
		}), true);
		assert.deepEqual(calls, [owner]);
	}
});

test("a refusal or no owner resumes normal composer behavior, never the other popup", () => {
	for (const owner of ["none", "mention", "emoji"]) {
		const calls = [];
		const result = routeAutocompleteKey(owner, { key: "Enter" }, {
			mention: () => {
				calls.push("mention");
				return false;
			},
			emoji: () => {
				calls.push("emoji");
				return false;
			},
			composer: () => calls.push("composer"),
		});
		assert.equal(result, false);
		assert.deepEqual(calls, owner === "none" ? ["composer"] : [owner, "composer"]);
	}
});

test("only text insertion and deletion are typing, never IME/paste/undo/redo", () => {
	for (const inputType of ["insertText", "deleteContentBackward", "deleteContentForward"]) {
		assert.equal(isEmojiTyping(inputType, false), true, inputType);
		assert.equal(isEmojiTyping(inputType, true), false, inputType);
	}
	for (const inputType of ["", "insertFromPaste", "insertFromDrop", "insertFromComposition", "insertCompositionText", "historyUndo", "historyRedo", "insertReplacementText"]) {
		assert.equal(isEmojiTyping(inputType, false), false, inputType);
	}
});

test("popup prefers 320px, eight 36px rows and opens above a bottom caret", () => {
	const position = emojiPopoverPosition({
		caret: { left: 200, right: 208, top: 700, height: 20 },
		viewportWidth: 1000,
		viewportHeight: 800,
		rows: 32,
		rtl: false,
	});
	assert.deepEqual(position, { left: 200, top: 398, width: 320, maxHeight: 296 });
	assert.equal(emojiOptionId("fixture", 0), "fixture-emoji-option-0");
});

test("top caret flips below; RTL aligns the opposite edge", () => {
	const position = emojiPopoverPosition({
		caret: { left: 200, right: 550, top: 10, height: 20 },
		viewportWidth: 1000,
		viewportHeight: 800,
		rows: 2,
		rtl: true,
	});
	assert.deepEqual(position, { left: 230, top: 36, width: 320, maxHeight: 80 });
});

test("narrow/tiny viewports and offscreen anchors stay clamped, including empty results", () => {
	for (const viewportWidth of [0, 8, 120, 320, 800]) {
		for (const viewportHeight of [0, 8, 100, 800]) {
			for (const top of [-50, 0, 50, 900]) {
				const p = emojiPopoverPosition({
					caret: { left: 900, right: 910, top, height: 20 },
					viewportWidth,
					viewportHeight,
					rows: 0,
					rtl: false,
				});
				assert.ok(p.left >= 0 && p.left + p.width <= viewportWidth);
				assert.ok(p.top >= 0 && p.top + p.maxHeight <= viewportHeight);
			}
		}
	}
});
