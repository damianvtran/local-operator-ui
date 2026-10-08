/**
 * The chat surface's keyboard model, and the drafts the sidebar lists.
 *
 *     node --test scripts/chat-keyboard-regions.test.mjs
 *
 * WHY THIS FILE EXISTS. UX round 2's U2 counted the walk from the bottom of the
 * surface to its top at ~70 presses, and U8 found that `⌘N` moved the window off
 * a session-less draft's key with nothing left pointing at it. Both fixes are
 * rules about STATE rather than about pixels — which region comes next, which
 * press is the row acts' chord, which drafts are rows — so both are pure
 * functions in `chat-regions.ts` and `draft-rows.ts` and both are asserted here
 * against the very objects the components build.
 *
 * THE TWO THINGS IT CANNOT SAY, and both are said where they can be seen:
 *
 *   - whether `F6` actually moves focus in the running app. That is the driver's
 *     frame and the press counts it records (`renderer-driver.mjs`), because a
 *     predicate that returns "composer" is not a caret in the composer.
 *   - whether the roving tabindex leaves EXACTLY ONE stop. The stop is written
 *     by a `useLayoutEffect` over the live DOM (`chat-sidebar.tsx`'s
 *     `applyRowStop`), which this suite has no DOM to mount. What IS asserted
 *     here is the source contract that keeps it honest: no row carries a
 *     `tabIndex` prop, so React cannot fight the effect, and both of the row's
 *     acts are out of the ring.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
const COMPOSER =
	"src/renderer/src/shared/components/composer/message-input.tsx";
const TRANSCRIPT =
	"src/renderer/src/features/chat/canonical/canonical-transcript.tsx";

const bundle = await build({
	stdin: {
		contents: [
			'export * from "./src/renderer/src/features/chat/chat-regions";',
			'export * from "./src/renderer/src/features/chat/draft-rows";',
			/*
			 * The Move pair's chord spellings live with the move order, not with the
			 * row acts: `chat-pin-order.ts` owns them and this bundle has to reach them
			 * to assert the joined sibling (round-1 design review, D1).
			 */
			'export * from "./src/renderer/src/features/chat/chat-pin-order";',
			'export * from "./src/renderer/src/features/chat/canvas-shortcut";',
		].join("\n"),
		resolveDir: ROOT,
		loader: "ts",
	},
	format: "esm",
	bundle: true,
	write: false,
});
const mod = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

const press = (key, extra = {}) => ({
	key,
	metaKey: false,
	ctrlKey: false,
	shiftKey: false,
	altKey: false,
	...extra,
});

test("the four regions are in the spec's reading order (§C4)", () => {
	assert.deepEqual(
		[...mod.CHAT_REGIONS],
		["sidebar", "header", "transcript", "composer"],
	);
});

test("the canvas chord is ⌘⇧C / ⌘+Shift+C, and the unshifted ⌘C is never claimed (U14)", () => {
	/*
	 * UX round 2, U14: the canvas control printed `⌘+Shift+C` and nothing answered
	 * it. The predicate is the half a suite can press; the header binds it, and
	 * `chat-header`'s own source is asserted to call it so the cap cannot be
	 * printed by a control that never listens.
	 */
	assert.equal(
		mod.isCanvasTogglePress(press("c", { metaKey: true, shiftKey: true })),
		true,
	);
	// The uppercase spelling is what a shifted press produces on layouts that
	// report the character rather than the base key.
	assert.equal(
		mod.isCanvasTogglePress(press("C", { metaKey: true, shiftKey: true })),
		true,
	);
	assert.equal(
		mod.isCanvasTogglePress(press("c", { ctrlKey: true, shiftKey: true })),
		true,
	);
	// NOT the unshifted chord: ⌘C is Copy and belongs to the reader's selection.
	assert.equal(mod.isCanvasTogglePress(press("c", { metaKey: true })), false);
	assert.equal(mod.isCanvasTogglePress(press("c")), false);
	assert.equal(
		mod.isCanvasTogglePress(
			press("c", { metaKey: true, shiftKey: true, altKey: true }),
		),
		false,
	);
	assert.equal(
		mod.isCanvasTogglePress(press("b", { metaKey: true, shiftKey: true })),
		false,
	);

	const header = readFileSync(
		"src/renderer/src/features/chat/components/chat-header.tsx",
		"utf8",
	);
	/* The control that PRINTS the cap moved to the panel rail (#872); the listener
	 * that answers it did not. The cap and the predicate still share one module. */
	const rail = readFileSync(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
		"utf8",
	);
	assert.match(
		rail,
		/canvasToggleCap\(isMac\)/,
		"the control's printed cap no longer comes from the shared module, so what it promises and what answers it can drift",
	);
	assert.doesNotMatch(
		rail,
		/addEventListener\(\s*"keydown"/,
		"the rail adds no chord: the listener that answers the printed cap stays bound exactly once, in the header",
	);
	assert.match(
		header,
		/document\.addEventListener\("keydown", onKeyDown\)/,
		"the canvas chord is printed but not bound",
	);
	assert.match(
		header,
		/isCanvasTogglePress\(event\)/,
		"the header's key listener no longer asks the shared predicate",
	);
});

test("F6 and its reverse are the walk's chords, and nothing else on that key", () => {
	assert.equal(mod.chatRegionStep(press("F6")), 1);
	assert.equal(mod.chatRegionStep(press("F6", { shiftKey: true })), -1);
	// `⌘F6`/`Ctrl+F6` belong to the OS; answering them would take the platform's
	// own display switch away without ever binding it here.
	assert.equal(mod.chatRegionStep(press("F6", { metaKey: true })), null);
	assert.equal(mod.chatRegionStep(press("F6", { ctrlKey: true })), null);
	assert.equal(mod.chatRegionStep(press("F6", { altKey: true })), null);
});

test("⌘⌥↓ is the second spelling, and ⌘⌥↑ the reverse (§C4)", () => {
	assert.equal(
		mod.chatRegionStep(press("ArrowDown", { metaKey: true, altKey: true })),
		1,
	);
	assert.equal(
		mod.chatRegionStep(press("ArrowUp", { metaKey: true, altKey: true })),
		-1,
	);
	assert.equal(
		mod.chatRegionStep(press("ArrowDown", { ctrlKey: true, altKey: true })),
		1,
	);
	// A bare arrow is the transcript's own paging key and the composer's caret
	// movement; claiming it here would be the defect, not the feature.
	assert.equal(mod.chatRegionStep(press("ArrowDown")), null);
	assert.equal(mod.chatRegionStep(press("ArrowDown", { metaKey: true })), null);
	assert.equal(mod.chatRegionStep(press("ArrowDown", { altKey: true })), null);
});

test("a region is read off the node's ancestry, and a hand-edited name is refused", () => {
	const leaf = {
		closest: (selector) =>
			selector === mod.CHAT_REGION_SELECTOR
				? { getAttribute: () => "header" }
				: null,
	};
	assert.equal(mod.chatRegionOf(leaf), "header");
	const bogus = { closest: () => ({ getAttribute: () => "sideways" }) };
	assert.equal(mod.chatRegionOf(bogus), null);
	assert.equal(mod.chatRegionOf(null), null);
	// A target with no `closest` — `<body>`, `window`, a synthetic event's null —
	// belongs to no region, which is what makes `F6` from a cold start enter the
	// first one rather than doing nothing.
	assert.equal(mod.chatRegionOf({}), null);
});

test("the walk wraps, and steps over a region that is not mounted", () => {
	/** A document stub that answers `querySelector` for the regions it holds. */
	const doc = (...present) => ({
		querySelector: (selector) => {
			const name = selector.slice(selector.indexOf('="') + 2, -2);
			return present.includes(name) ? { name } : null;
		},
	});
	const all = doc("sidebar", "header", "transcript", "composer");
	assert.equal(mod.nextChatRegion(all, "sidebar", 1), "header");
	assert.equal(mod.nextChatRegion(all, "composer", 1), "sidebar");
	assert.equal(mod.nextChatRegion(all, "sidebar", -1), "composer");
	// A cold start (no active element inside any region) enters the first one.
	assert.equal(mod.nextChatRegion(all, null, 1), "sidebar");
	assert.equal(mod.nextChatRegion(all, null, -1), "composer");
	// A route with no chat surface at all answers with nothing rather than
	// pretending: `F6` is then a key this app does not implement, not a dead one.
	assert.equal(mod.nextChatRegion(doc(), "sidebar", 1), null);
	// The sidebar alone is still a walk, which is the state this app is in for the
	// whole of a cold engage before the transcript mounts.
	const sidebarOnly = doc("sidebar");
	assert.equal(mod.nextChatRegion(sidebarOnly, "sidebar", 1), "sidebar");
});

test("the row acts' chord is ⌘⇧P / ⌘⇧A, and a bare letter is never claimed", () => {
	assert.equal(
		mod.chatRowAct(press("p", { metaKey: true, shiftKey: true })),
		"pin",
	);
	assert.equal(
		mod.chatRowAct(press("A", { metaKey: true, shiftKey: true })),
		"archive",
	);
	assert.equal(
		mod.chatRowAct(press("a", { ctrlKey: true, shiftKey: true })),
		"archive",
	);
	// The list's own `keyDown` treats a printable key on a row as type-to-filter,
	// so these two presses must belong to the filter and not to the acts.
	assert.equal(mod.chatRowAct(press("p")), null);
	assert.equal(mod.chatRowAct(press("a")), null);
	// `⌘P` is print, `⌘A` is select-all, `⌥`-modified presses are other chords.
	assert.equal(mod.chatRowAct(press("p", { metaKey: true })), null);
	assert.equal(mod.chatRowAct(press("a", { metaKey: true })), null);
	assert.equal(
		mod.chatRowAct(press("p", { metaKey: true, shiftKey: true, altKey: true })),
		null,
	);
});

test("the cap and the attribute the chord presses are one spelling", () => {
	assert.equal(mod.chatRowActCap("pin", true), "⌘⇧P");
	assert.equal(mod.chatRowActCap("archive", true), "⌘⇧A");
	assert.equal(mod.chatRowActCap("pin", false), "Ctrl+Shift+P");
	/*
	 * THE JOINED SIBLING (spec §3): `KeyboardShortcut` splits its prop on `+`, so the
	 * macOS cap the menu PRINTS needs the separators the handler's spelling does
	 * not have - `⌘⇧P` fed to the component as-is renders as ONE cap three glyphs
	 * wide - while the non-mac spelling already carries them. The property that
	 * keeps the two from drifting: split the joined form on `+`, and the parts
	 * concatenate back to the handler's spelling.
	 */
	assert.equal(mod.chatRowActCapJoined("pin", true), "⌘+⇧+P");
	assert.equal(mod.chatRowActCapJoined("archive", true), "⌘+⇧+A");
	assert.equal(mod.chatRowActCapJoined("pin", false), "Ctrl+Shift+P");
	assert.equal(
		mod.chatRowActCapJoined("pin", true).split("+").join(""),
		mod.chatRowActCap("pin", true),
	);
	/*
	 * AND THE NON-MAC FORM IS PINNED TO ITS LITERAL (agent review round 1, R2). The
	 * first spelling of this line compared `chatRowActCapJoined("pin", false)`
	 * joined against `chatRowActCap("pin", false)` joined - and the joined non-mac
	 * form IS that function's output, so both sides were one computation and the
	 * assertion could not fail. The round trip above is the load-bearing property;
	 * this pins the bytes themselves.
	 */
	assert.equal(
		mod.chatRowActCapJoined("pin", false).split("+").join(""),
		"CtrlShiftP",
	);
	/*
	 * AND THE MOVE PAIR'S JOINED SIBLING (round-1 design review, D1). The row
	 * menu's two Move items were the one place feeding `KeyboardShortcut` the
	 * handler's spelling - `chatPinMoveCap` returns `⌘⇧↑`, which the component
	 * splits into ONE cap three glyphs wide, so the two rows drew a 21px cap where
	 * the rows above them drew three caps across 52px. Same property as the pair
	 * above: reconstruct the handler's spelling by splitting the joined form, and
	 * pin the non-mac bytes (whose joined form IS the handler's string, so the
	 * assertion has to name the literal or it cannot fail).
	 */
	assert.equal(mod.chatPinMoveCap(-1, true), "⌘⇧↑");
	assert.equal(mod.chatPinMoveCap(1, true), "⌘⇧↓");
	assert.equal(mod.chatPinMoveCapJoined(-1, true), "⌘+⇧+↑");
	assert.equal(mod.chatPinMoveCapJoined(1, true), "⌘+⇧+↓");
	assert.equal(
		mod.chatPinMoveCapJoined(-1, true).split("+").join(""),
		mod.chatPinMoveCap(-1, true),
	);
	assert.equal(
		mod.chatPinMoveCapJoined(1, true).split("+").join(""),
		mod.chatPinMoveCap(1, true),
	);
	assert.equal(mod.chatPinMoveCapJoined(-1, false), "Ctrl+Shift+↑");
	assert.equal(
		mod.chatPinMoveCapJoined(1, false).split("+").join(""),
		"CtrlShift↓",
	);
	/*
	 * AND THE MENU PRINTS THROUGH IT. The property the two functions cannot state
	 * on their own: the sidebar's two Move items call the joined sibling, not the
	 * handler's spelling - which is what D1 found and what a future edit to either
	 * row could undo silently.
	 */
	const sidebar = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	assert.equal(
		sidebar.includes("shortcut={chatPinMoveCap("),
		false,
		"a Move item feeds `KeyboardShortcut` the handler's spelling again - it renders as ONE cap three glyphs wide (D1)",
	);
	assert.equal(
		sidebar.split("chatPinMoveCapJoined(").length - 1,
		2,
		"the two Move items no longer both print their chord through the joined sibling",
	);
	assert.equal(mod.CHAT_ROW_ACT_ATTR.pin, "data-session-pin");
	assert.equal(mod.CHAT_ROW_ACT_ATTR.archive, "data-session-archive");
});

test("the chord finds the act inside the row's own box, and nowhere else", () => {
	const pin = { name: "pin" };
	const rowBox = {
		querySelector: (selector) =>
			selector === "[data-session-pin]" ? pin : null,
	};
	const rowButton = {
		closest: (selector) => (selector === "[data-session-row]" ? rowBox : null),
	};
	assert.equal(mod.chatRowActControl(rowButton, "pin"), pin);
	// A press outside any row -- the search field, the brand row -- presses nothing.
	assert.equal(mod.chatRowActControl({ closest: () => null }, "pin"), null);
	assert.equal(mod.chatRowActControl(null, "archive"), null);
});

test("a draft's row is its first non-blank line, capped", () => {
	assert.equal(
		mod.draftRowTitle("Fix the flaky scroll test"),
		"Fix the flaky scroll test",
	);
	// A draft that opens with a blank line is a real shape (paste, a paragraph
	// break) and rendering it as an empty row would read as a lost draft.
	assert.equal(mod.draftRowTitle("\n\nSecond line"), "Second line");
	assert.equal(mod.draftRowTitle("  padded  \nnext"), "padded");
	const long = mod.draftRowTitle("x".repeat(60));
	assert.equal(long.length, 49);
	assert.ok(long.endsWith("…"));
});

const drafts = (entries) =>
	Object.fromEntries(entries.map(([key, draft]) => [key, { key, ...draft }]));
const input = (entries) =>
	Object.fromEntries(
		entries.map(([key, currentInput]) => [key, { currentInput }]),
	);

test("only untargeted, unlisted, non-empty drafts become rows", () => {
	const rows = mod.untargetedDraftRows(
		drafts([
			["draft:one", {}],
			["draft:two", { sessionId: "s-1" }],
			["draft:three", { target: { kind: "agent", name: "coder" } }],
			["draft:four", {}],
		]),
		input([
			["draft:one", "kept"],
			["draft:two", "a draft that became a session"],
			["draft:three", "a draft for an agent"],
			// `draft:four` has no input row at all, which is the state a launch
			// seed writes and the state after a relaunch of an untouched pane.
		]),
		/*
		 * The sessions the caller is listing (agent review round 2, D6): `s-1`'s own
		 * row is on screen, so the draft that became it is refused.
		 */
		new Set(["s-1"]),
	);
	assert.deepEqual(
		rows.map((row) => row.key),
		["draft:one"],
	);
	assert.equal(rows[0].label, "Draft: kept");
	assert.equal(rows[0].text, "kept");
});

test("a whitespace-only draft is not a row", () => {
	assert.deepEqual(
		mod.untargetedDraftRows(
			drafts([["draft:blank", {}]]),
			input([["draft:blank", "   \n  "]]),
		),
		[],
	);
});

test("a draft with an open claim keeps its row after the composer clears", () => {
	/*
	 * DESIGN REVIEW ROUND 1, D3. The composer clears at the press, and this row
	 * used to clear with it - so the chat lost its only sidebar presence for the
	 * whole create hop, and a create that died in that window left the
	 * conversation unreachable from the list at all (UX round 1, U2). The claim's
	 * own `submittedText` is the fallback: it is kept on the draft until the
	 * claim resolves, so the row can name what is in flight.
	 */
	const rows = mod.untargetedDraftRows(
		drafts([
			["draft:inflight", { submittedText: "Summarise yesterday's Q3 numbers" }],
			["draft:typed", { submittedText: "the claim the hit sent" }],
		]),
		input([["draft:typed", "what the user is typing now"]]),
	);
	assert.deepEqual(
		rows.map((row) => row.key),
		["draft:typed", "draft:inflight"],
		"insertion order reversed, as the module documents for the newest-last list",
	);
	assert.equal(
		rows[1].label,
		"Draft: Summarise yesterday's Q3 numbers",
		"the cleared box's chat is still findable, under the text it sent",
	);
	assert.equal(
		rows[1].text,
		"Summarise yesterday's Q3 numbers",
		"and the row carries the claim's text, not only its label",
	);
	assert.equal(
		rows[0].label,
		"Draft: what the user is typing now",
		"the composer still wins while it holds text: the row tracks the typing",
	);
	// Once the claim resolves the session exists, so the owned draft gives way to
	// that session's own row and nothing here can keep two rows for one
	// conversation.
	assert.deepEqual(
		mod.untargetedDraftRows(
			drafts([["draft:done", { sessionId: "s-1", submittedText: "sent" }]]),
			input([]),
			new Set(["s-1"]),
		),
		[],
	);
	/*
	 * AND WHILE THAT ROW IS NOT LISTED YET, the draft row is the only presence
	 * (UX round 2's U6): the catalogue lags the create, and a reader who watched
	 * their first message refuse could not click back to it at all. The same
	 * state, without the session in the list, keeps the row.
	 */
	assert.deepEqual(
		mod
			.untargetedDraftRows(
				drafts([["draft:done", { sessionId: "s-1", submittedText: "sent" }]]),
				input([]),
				new Set(),
			)
			.map((row) => row.key),
		["draft:done"],
	);
	/*
	 * AND THE RESOLVED SHAPE FINDS ITS TEXT TOO (UX round 2's U6, the live frame
	 * that measured it): `resolveHeldFromServer` clears `submittedText` when it
	 * writes `undelivered`, so a just-refused chat was textless and skipped - the
	 * chat vanished from the list at exactly the moment the reader looked for it.
	 * `undelivered.text` is what the row itself paints from.
	 */
	const resolvedRows = mod.untargetedDraftRows(
		drafts([
			[
				"draft:resolved",
				{
					sessionId: "s-1",
					undelivered: {
						recordId: "r",
						text: "the refused message",
						attachments: [],
					},
				},
			],
		]),
		input([]),
		new Set(),
	);
	assert.deepEqual(
		resolvedRows.map((row) => row.key),
		["draft:resolved"],
	);
	assert.equal(resolvedRows[0].label, "Draft: the refused message");
});

test("D6/U6: a live send's own draft gives way to the conversation's row", () => {
	/*
	 * THE SHAPE AGENT REVIEW ROUND 2 MEASURED (D6): a send into an EXISTING
	 * conversation is keyed `send:<sessionId>` and writes no `sessionId` field, so
	 * the old condition 1 never refused it - the sidebar drew `Draft: A refusal…`
	 * beside the conversation's own row for a message that was in flight or
	 * failed. The owner is read from the key, and the session's own row is the
	 * presence.
	 */
	assert.deepEqual(
		mod.untargetedDraftRows(
			drafts([["send:s-9", { submittedText: "a message already sent into" }]]),
			input([]),
			new Set(["s-9"]),
		),
		[],
	);
	/* Absent that row, the same draft stands as the only way back to it (U6). */
	const rows = mod.untargetedDraftRows(
		drafts([["send:s-9", { submittedText: "a message already sent into" }]]),
		input([]),
		new Set(),
	);
	assert.deepEqual(
		rows.map((row) => row.key),
		["send:s-9"],
	);
	assert.equal(rows[0].label, "Draft: a message already sent into");
});

test("the rows are newest-last in the store's own order, rendered reversed", () => {
	const rows = mod.untargetedDraftRows(
		drafts([
			["draft:a", {}],
			["draft:b", {}],
			["draft:c", {}],
		]),
		input([
			["draft:a", "first"],
			["draft:b", "second"],
			["draft:c", "third"],
		]),
	);
	assert.deepEqual(
		rows.map((row) => row.text),
		["third", "second", "first"],
	);
	assert.equal(mod.DRAFT_ROW_PREFIX, "Draft: ");
});

/*
 * THE SOURCE CONTRACT, for the half no `node:test` can mount. These are
 * assertions about the shipped file because the alternative is no assertion at
 * all: the roving tabindex is a DOM write at layout time, and the four region
 * markers are attributes on components this suite cannot render.
 */
const sidebarSource = readFileSync(SIDEBAR, "utf8");

test("no chat row carries a tabIndex prop, so the roving stop is the only writer", () => {
	/*
	 * The stop is asserted imperatively (`row.tabIndex = …` in `applyRowStop`). A
	 * `tabIndex` PROP on a row would make React re-assert it on every render, and
	 * the panel would flicker between one stop and seventy.
	 *
	 * The count is the guard rather than a forbidding of the attribute: the three
	 * sites round 1 sanctioned are the panel's own door and the two row acts, all
	 * `-1` and all deliberately out of the ring, and UX round 2's U16 added a
	 * FOURTH with its own reason - the chats SCROLLER, which Chromium makes
	 * keyboard-focusable on its own (a scrollable section), so it appeared in the
	 * ring as an unnamed stop the arrow walk already covers. That is still not a
	 * ROW: `applyRowStop` owns the rows, and the scroller's own `-1` is what keeps
	 * the ring free of the container that carries them. A fifth one is a decision
	 * somebody has to make - which is the point - and the message names the four so
	 * the decision starts from what is already there.
	 *
	 * THE FIFTH AND SIXTH WERE THE PINNED ROW'S MOVE PAIR (issue #693), and they are
	 * DELETED (2026-09-30): their acts are the two Move items in the row's own menu
	 * now, with the chords reaching the same write, so the row keeps ONE Tab stop and
	 * answers its moves from a surface that is not in the row at all.
	 *
	 * THE FIFTH IS THE PIN DRAG HANDLE (issue #697), the pair's own case one
	 * control over: a drag is a POINTER gesture, so the handle has no chord to
	 * answer it with (the chords are how a keyboard reader reorders), and the row's
	 * one stop stays the row's. It is drawn on the rows the moves are offered on,
	 * which is why it sits here rather than in a ring of its own: a handle in the
	 * Tab ring would give every pinned row a second stop to reach a gesture the
	 * keyboard cannot make.
	 */
	const props = [...sidebarSource.matchAll(/^\s*tabIndex=\{/gm)];
	assert.equal(
		props.length,
		5,
		`the sidebar declares ${props.length} tabIndex prop(s); the sanctioned five are the nav's door, the two row acts (applyRowStop owns the rows), the chats scroller's own -1 (U16) and the pinned row's drag handle (#697) - all five are deliberately out of the ring`,
	);
	/*
	 * AND THE RING'S OWN EXCLUSION (agent review round 2's R7): a row the caret
	 * cannot reach is not a stop, so `applyRowStop` filters the unreachable rows
	 * out of the ring's set AND refuses them `tabIndex` 0 - a `disabled` row can
	 * neither hold the stop nor re-enter the ring through this loop.
	 */
	assert.match(
		sidebarSource,
		/row\.tabIndex = rows\.includes\(row\) && row === target \? 0 : -1;/,
	);
	assert.match(
		sidebarSource,
		/id=\{CHAT_REGION_ID\}[\s\S]{0,600}?tabIndex=\{-1\}/,
		"the scroller's own -1 is the U16 site, and it is the fourth the count above sanctions",
	);
});

test("both row acts are out of the Tab ring, and the chord is what presses them", () => {
	// The window is wide because both controls carry a block comment explaining
	// WHY they left the ring; the assertion is about the pair, not about prose.
	assert.match(sidebarSource, /data-session-pin[\s\S]{0,2000}?tabIndex=\{-1\}/);
	assert.match(
		sidebarSource,
		/data-session-archive[\s\S]{0,2000}?tabIndex=\{-1\}/,
	);
	assert.match(sidebarSource, /const act = chatRowAct\(event\);/);
	assert.match(sidebarSource, /control\.click\(\);/);
});

test("the sidebar is a region, and its door is the row the reader is on", () => {
	assert.match(sidebarSource, /data-chat-region="sidebar"/);
	// The stop marks itself as the region's door rather than a second attribute
	// being kept in step with it by hand.
	assert.match(
		sidebarSource,
		/toggleAttribute\(\s*CHAT_REGION_ENTRY_ATTR,\s*rows\.includes\(row\) && row === target,?\s*\)/,
	);
});

test("the other three region roots carry the marker the walk looks for", () => {
	assert.match(readFileSync(HEADER, "utf8"), /data-chat-region="header"/);
	assert.match(
		readFileSync(TRANSCRIPT, "utf8"),
		/data-chat-region="transcript"/,
	);
	assert.match(readFileSync(COMPOSER, "utf8"), /data-chat-region="composer"/);
	// The door into the composer is the field, not the form: `F6` into the
	// composer is a request to type.
	assert.match(readFileSync(COMPOSER, "utf8"), /data-region-entry/);
});
