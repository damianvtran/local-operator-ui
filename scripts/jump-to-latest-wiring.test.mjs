import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

/*
 * The jump-to-latest chip's WIRING, at the source.
 *
 * `new-activity.test.mjs` proves the register's decisions; this file proves the
 * decisions reach the control, and that the two regressions the change exists
 * to fix cannot come back silently:
 *
 * 1. the new-activity register has a producer on BOTH surfaces (the chat page
 *    and the child reader), instead of a prop that is forever false;
 * 2. the chip's visibility is the paging policy's own following predicate, so
 *    a record arriving while the reader is scrolled up cannot blank it.
 *
 * There is no jsdom in this tree, so placement and prop-flow are pinned at the
 * source, as `composer-tabs.test.mjs` does for the same reasons. The rendered
 * behaviour of the chip (appears, grows the label, hides on return) is
 * proven by the headless frames under `docs/pr-evidence/jump-to-latest/`.
 */
const code = (path) =>
	readFileSync(path, "utf8")
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/[^\n]*/g, "$1");

const HOOK = "src/renderer/src/shared/hooks/use-scroll-to-bottom.ts";
const SEND_HOOK = "src/renderer/src/shared/hooks/use-message-input.ts";
const CHAT_PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";
const CHAT_CONTENT =
	"src/renderer/src/features/chat/components/chat-content.tsx";
const MESSAGE_INPUT =
	"src/renderer/src/shared/components/composer/message-input.tsx";
const CHILD_READER =
	"src/renderer/src/features/chat/components/run-details/run-child-reader.tsx";
const CHIP =
	"src/renderer/src/features/chat/components/scroll-to-bottom-button.tsx";

test("the chip's visibility is the paging policy's following predicate", () => {
	const hook = code(HOOK);
	/*
	 * The 50px threshold lived only here, so between 24 and 50px the paging
	 * policy said "not following the tail" while this control said there was
	 * nothing to go back to. One import, one epsilon.
	 */
	assert.doesNotMatch(hook, /buttonThreshold/);
	assert.match(hook, /chipVisibleAt\(scrollTop, scrollHeight, clientHeight\)/);
	assert.match(hook, /followsTail\(scrollTop\)/);
});

test("a new record does not reset the chip; a conversation does", () => {
	const hook = code(HOOK);
	// The old reset blanked the state on every contentKey change and re-derived
	// it a frame later; the record count as the key made that every record.
	assert.doesNotMatch(hook, /setIsFarFromBottom\(false\)/);
	assert.match(hook, /registerRef\.current = initialActivityState/);
	assert.match(hook, /updateScrollPosition\(\);/);
});

test("the send receipt leaves the transcript's scroll position to the pane", () => {
	const page = code(CHAT_PAGE);
	// The echo commits before receipt. A reader can already be away from the
	// tail or move there while the receipt is pending; neither case is consent
	// to move. The reversed scroller already follows for a pinned reader.
	const admit = page.indexOf("const id = await flushSync(() =>");
	const done = page.indexOf("trackFirstMessageSent();", admit);
	assert.ok(admit >= 0 && done > admit, "locate the send and its receipt");
	const send = page.slice(admit, done);
	assert.match(send, /admitChatDraft\(/);
	assert.doesNotMatch(send, /snapToBottom\(|scrollToBottom\(/);
});

test("only a send without an echo uses the composer scroll fallback", () => {
	const hook = code(SEND_HOOK);
	assert.match(
		hook,
		/onSubmit\?\.\(\s*submitted,\s*\(\) => \{\s*echoPainted = true;/,
	);
	assert.match(
		hook,
		/if \(!echoPainted && scrollToBottom\) \{\s*requestAnimationFrame\(\(\) => \{\s*scrollToBottom\(\);/,
	);
});

test("the chat page derives the register from its transcript and passes it on", () => {
	const page = code(CHAT_PAGE);
	assert.match(page, /activityFingerprint\(canonical\.transcript\.records\)/);
	assert.match(page, /contentKey: streamId/);
	assert.match(page, /activity: newActivityFingerprint/);
	// Through the composer props to the control mounted above it.
	assert.match(page, /hasNewActivity=\{hasNewActivity\}/);
	assert.match(code(MESSAGE_INPUT), /hasNewActivity=\{hasNewActivity\}/);
	assert.match(code(CHIP), /hasNewActivity/);
});

test("the child reader carries the same register, not a row count", () => {
	const reader = code(CHILD_READER);
	assert.match(reader, /activityFingerprint\(transcript\.records\)/);
	assert.match(reader, /contentKey: row\.childSessionId \?\? row\.id/);
	assert.match(reader, /hasNewActivity=\{hasNewActivity\}/);
	// The hook owns the epsilon now; the call site must not pass its own.
	assert.doesNotMatch(reader, /useScrollToBottom\(\s*TAIL_EPS_PX/);
});

test("chat-content still forwards the prop to the composer", () => {
	const content = code(CHAT_CONTENT);
	assert.match(content, /isFarFromBottom=\{isFarFromBottom\}/);
	assert.match(content, /hasNewActivity=\{hasNewActivity\}/);
});

test("the new-activity label is translated into every shipped locale", () => {
	const languages = JSON.parse(
		readFileSync("i18n/languages.json", "utf8"),
	).languages;
	const read = (locale, namespace) =>
		JSON.parse(
			readFileSync(`src/i18n/catalogues/${locale}/${namespace}.json`, "utf8"),
		);
	for (const { code: locale, status } of languages) {
		const chat = read(locale, "ui.chat");
		const chrome = read(locale, "ui.chat.page_chrome");
		const label = chat["ui.chat.scroll_to_bottom.label_new_activity"];
		const chip = chrome["ui.chat.page_chrome.scroll_to_bottom.new_activity"];
		assert.equal(typeof label, "string", `${locale} accessible name`);
		assert.equal(typeof chip, "string", `${locale} chip label`);
		assert.ok(label.trim().length > 0, `${locale} accessible name empty`);
		assert.ok(chip.trim().length > 0, `${locale} chip label empty`);
		// The chip sits beside an icon in a small floating button: a sentence
		// there wraps the disc taller than the row it floats over.
		assert.ok(chip.length <= 40, `${locale} chip label too long: ${chip}`);
		if (status === "source") {
			assert.equal(chip, "Jump to latest");
			assert.equal(label, "New activity, jump to latest");
		}
	}
});
