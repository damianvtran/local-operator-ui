/**
 * The chat row's context menu (#694), executable: the parity between the menu's
 * items and the hover pair, the spelling the hold must NOT be authored with, and
 * the structural half of the opener/focus contract.
 *
 *     node --test scripts/chat-sidebar-row-menu.test.mjs
 *
 * WHAT THIS FILE CAN AND CANNOT PROVE, because the split is the whole reason for
 * its shape. The menu is Radix's primitive driven by React state; this
 * repository's desktop suite has no DOM harness, so:
 *
 *   - the PREDICATE PARITY, the withheld-never-disabled rule and the opener's
 *     structure are read off the shipped source, in the idiom
 *     `chat-sidebar-archive.test.mjs` established, because "the item exists
 *     exactly when the control does" and "no code path consumes the ambient
 *     coordinates" are facts about the JSX and handlers that mount both;
 *   - the CHORD SPELLINGS are executed in `chat-keyboard-regions.test.mjs`,
 *     which is the file that owns `chatRowActCap` and its joined sibling;
 *   - everything about PIXELS - the held reveal, the ground, the panel, the
 *     flyout - is the frames' job (`docs/evidence/chat-sidebar-row-context-menu/`);
 *     a green assertion about a class string is not evidence that anything moved.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const read = (relative) => readFileSync(relative, "utf8");
/**
 * Comments stripped, so a rule can never be satisfied by prose about the rule -
 * the form `chat-sidebar-pins.test.mjs` documents: this change's own comments
 * name the forbidden `data-[state` spelling twice, and the guard below has to
 * read the code, not the note explaining why there is none in it.
 */
const code = (relative) =>
	read(relative)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(/(^|[^:])\/\/.*$/gm, "$1");
const between = (source, from, to) => {
	const at = source.indexOf(from);
	assert.notEqual(at, -1, `no source matches ${JSON.stringify(from)}`);
	const end = source.indexOf(to, at + from.length);
	assert.notEqual(
		end,
		-1,
		`no source matches ${JSON.stringify(to)} after ${JSON.stringify(from)}`,
	);
	return source.slice(at, end);
};

const SIDEBAR_CODE = code(SIDEBAR);
/** The menu's own items, as mounted. */
const MENU = between(
	SIDEBAR_CODE,
	"<ContextMenuContent",
	"</ContextMenuContent>",
);

test("the menu's items are drawn from the same predicates the pair reads", () => {
	/*
	 * §8's parity requirement, and it is the reason this test exists beside the
	 * archive/pins files rather than inside either: the menu and the pair are two
	 * surfaces for the same two acts, and a row whose menu offered an act its
	 * control withheld (or the reverse) would be two answers to one question.
	 * The pair's own gates are asserted present BEFORE the menu in the same file,
	 * and the items reuse their two literals verbatim - `archiveEnabled` for the
	 * archive act, `row.pinned !== undefined` for the pin (NOT `pinned`, which is
	 * `=== true` and would offer Pin on a row whose pin state is unknown).
	 */
	const pair = SIDEBAR_CODE.slice(
		0,
		SIDEBAR_CODE.indexOf("<ContextMenuContent"),
	);
	assert.ok(
		pair.includes("{row.pinned !== undefined && ("),
		"the pin CONTROL's gate is no longer `row.pinned !== undefined`",
	);
	assert.ok(
		pair.includes("{archiveEnabled && ("),
		"the archive CONTROL's gate is no longer `archiveEnabled`",
	);
	/*
	 * THE THIRD GATE, and it is shared rather than copied: the drag handle and the
	 * menu's two Move items both read `offersMove`, which is `offersPinnedMove` over
	 * the row. Two spellings would be two chances for the handle and the menu to
	 * appear on different rows.
	 */
	assert.ok(
		pair.includes(
			"const offersMove = offersPinnedMove(row.session_id, nested);",
		),
		"the grip's predicate is no longer the one the menu's items read",
	);
	const archiveItem = between(
		MENU,
		"{archiveEnabled && (",
		"</ContextMenuItem>",
	);
	const pinItem = between(
		MENU,
		"{row.pinned !== undefined && (",
		"</ContextMenuItem>",
	);
	assert.ok(
		archiveItem.startsWith("{archiveEnabled && ("),
		"the archive ITEM exists outside the capability gate the control reads",
	);
	assert.ok(
		pinItem.startsWith("{row.pinned !== undefined && ("),
		"the pin ITEM exists outside the pin-state gate the control reads",
	);
	/*
	 * WITHDRAWN, NEVER DISABLED - WITH ONE DELIBERATE EXCEPTION (2026-09-30).
	 * The rule is about an act the row cannot take AT ALL: that is an absent row, not
	 * a greyed one. The row menu's two Move items are the exception, and it is WCAG
	 * 2.5.7's: a move the row cannot make in ONE DIRECTION is a BOUNDARY rather than
	 * an absent act, and the app's own idiom for a refused target is `aria-disabled`
	 * (the drafts' discard act, `older-history-slot.tsx`) - a real `disabled` would
	 * drop the item out of the flow a keyboard reader walks AND stop the activation,
	 * swallowing the `pinMoveBoundaryNote` sentence that says which boundary it is. So
	 * the assertion is about the PROP, plus a check that `aria-disabled` appears
	 * nowhere in this menu but on those two items.
	 */
	assert.equal(
		/[\s"'{]disabled[=>\s]/.test(MENU.replace(/aria-disabled/g, "")),
		false,
		"a menu item is disabled rather than withheld - the row's own rule is that an affordance that cannot act on a row is not drawn at all, and the two Move items state their boundary with `aria-disabled` instead",
	);
	for (const item of MENU.split("<ContextMenuItem").slice(1)) {
		if (!item.includes("aria-disabled")) continue;
		assert.match(
			item,
			/Move conversation (?:up|down)/,
			"`aria-disabled` is on something other than the two boundary-bearing Move items",
		);
	}
	/*
	 * THE COPY AND THE ORDER. Sentence case, verb + object, and the pair's own
	 * measured order (the archive glyph is `order-first` in the strip): archive
	 * first, so the two surfaces present the same two acts in the same sequence
	 * however they were opened.
	 */
	assert.ok(
		archiveItem.includes(
			'{archived ? "Unarchive conversation" : "Archive conversation"}',
		),
		"the archive item no longer words its act as the row/palette spelling",
	);
	assert.ok(
		pinItem.includes('{pinned ? "Unpin conversation" : "Pin conversation"}'),
		"the pin item no longer words its act as the pair's control does",
	);
	assert.ok(
		MENU.indexOf('pressRowAct(row.session_id, "archive")') <
			MENU.indexOf('pressRowAct(row.session_id, "pin")'),
		"the menu no longer reads Archive then Pin",
	);
	/*
	 * AND THE TWO MOVE ITEMS COME AFTER THEM (2026-09-30), in the order the deleted
	 * arrow pair was drawn: the row's own acts first, then the refinement of the order
	 * they only apply to. They are gated on `offersMove`, which is the SAME predicate
	 * the row's drag handle reads - asserted against the grip's own line above, so
	 * neither surface can be moved to a different set of rows alone.
	 */
	assert.ok(
		MENU.includes("{offersMove && ("),
		"the menu's Move items exist outside the predicate the row's grip reads",
	);
	assert.ok(
		MENU.indexOf('pressRowAct(row.session_id, "pin")') <
			MENU.indexOf("Move conversation up"),
		"the menu no longer reads Archive, Pin, then the moves",
	);
	assert.ok(
		MENU.indexOf("Move conversation up") <
			MENU.indexOf("Move conversation down"),
		"the menu no longer reads Move up then Move down",
	);
	/*
	 * AND THE PRESS IS THE CONTROL'S OWN. `.click()` on the row's control takes the
	 * same path as Enter on it - the guards, the store write and the focus
	 * correction all arrive unchanged - so the item cannot reimplement a write
	 * whose guards it does not know about.
	 */
	const press = between(SIDEBAR_CODE, "const pressRowAct = (", "};");
	assert.ok(
		press.includes("?.click()"),
		"pressRowAct no longer presses the row's own control",
	);
	assert.ok(
		press.includes("CHAT_ROW_ACT_ATTR[act]"),
		"pressRowAct no longer resolves the control through the chord's own attribute table",
	);
});

test("Fork is the menu's third row: its order, copy, withheld condition and wiring (#739)", () => {
	/*
	 * THE RESERVED THIRD ROW, SPENT. Fork is not a press on a row control (there
	 * is none), so the pins below read the three things that make it THIS menu's
	 * item rather than a second fork implementation: where it sits, what it asks
	 * for, and the one condition that withholds it.
	 */
	const forkItem = between(MENU, "{forkable && (", "</ContextMenuItem>");
	/*
	 * ORDER: Archive, Pin, Fork, Copy session ID, then the conditional Move pair
	 * (round-1 design review, D2; Copy added by #893). The principle, stated so the
	 * next act has something to apply: rows 1-2 are the mirrored pair in the strip's
	 * own order, rows 3-4 are the UNCONDITIONAL run - so those two slots keep one
	 * identity in every state instead of changing between a singleton and
	 * `Move conversation up` - and the conditional block trails it. The two Move
	 * items stay adjacent to each other under either arrangement.
	 */
	const archiveAt = MENU.indexOf('pressRowAct(row.session_id, "archive")');
	const pinAt = MENU.indexOf('pressRowAct(row.session_id, "pin")');
	const forkAt = MENU.indexOf('"session.fork"');
	const copyAt = MENU.indexOf("copySessionId(row.session_id)");
	const renameAt = MENU.indexOf('"session.rename"');
	const moveUpAt = MENU.indexOf("movePinnedRow(row.session_id, -1, true)");
	const moveDownAt = MENU.indexOf("movePinnedRow(row.session_id, 1, true)");
	assert.ok(
		archiveAt !== -1 &&
			archiveAt < pinAt &&
			pinAt < forkAt &&
			forkAt < copyAt &&
			copyAt < renameAt &&
			renameAt < moveUpAt &&
			moveUpAt < moveDownAt,
		"the menu no longer reads Archive, Pin, Fork, Copy session ID, Rename conversation, Move up, Move down (D2, #893, #920) - the mirrored pair, the unconditional run, then the conditional block",
	);
	assert.equal(
		MENU.split("<ContextMenuItem").length - 1,
		7,
		"the menu's row count moved without this file: the seven-row budget (design \u00a77) is #743's four plus #739's Fork plus #893's Copy session ID plus #920's Rename conversation, and each addition passed the rule an eighth would have to pass - the act must be one on THIS row with no other door (the row-scoped id has none: the header's overflow names the PANE's session; so does the row-scoped name: the header's inline editor and /rename write the PANE's conversation), so the number moved rather than a row being replaced",
	);
	/*
	 * COPY: verb + object, the pair's register, with the icon `aria-hidden` like
	 * its siblings - and NO chord, because fork has none. A `KeyboardShortcut`
	 * here would print a hint for a gesture that does nothing.
	 */
	assert.ok(
		forkItem.includes("<span>Fork conversation</span>"),
		"the fork item no longer reads `Fork conversation`",
	);
	assert.ok(
		forkItem.includes('<GitFork aria-hidden="true" />'),
		"the fork item lost its aria-hidden glyph",
	);
	assert.equal(
		forkItem.includes("KeyboardShortcut"),
		false,
		"the fork item prints a chord, but fork has none",
	);
	/*
	 * THE WITHHELD CONDITION: one named predicate, read once, and it is the
	 * sidebar's own `unstarted` statement - the draft that holds this row's id and
	 * never carried a message, i.e. the session the backend refuses ("has no
	 * transcript to fork"). `row.pending` is deliberately NOT the gate: it names
	 * a parked approval/ask, which only a session with a transcript can carry.
	 */
	assert.ok(
		SIDEBAR_CODE.includes("const forkable = !unstarted.has(row.session_id);"),
		"the fork predicate is no longer the row's own `unstarted` statement",
	);
	assert.equal(
		SIDEBAR_CODE.split("forkable").length - 1,
		2,
		"`forkable` is spelled more than once at its definition and its one use - two copies are two chances to disagree",
	);
	assert.equal(
		/row\.pending/.test(MENU) || /forkable[^;]*pending/.test(SIDEBAR_CODE),
		false,
		"the fork gate reads `row.pending`, which names a parked gate and not a session without a transcript",
	);
	assert.equal(
		[/disabled/, /aria-disabled/].some((pattern) => pattern.test(forkItem)),
		false,
		"the fork item is disabled or marked as a boundary rather than withheld - its one condition is an ABSENT row, and `aria-disabled` belongs to the two Move items",
	);
	/*
	 * THE WIRING: the register's own picker, asked for through the
	 * panel-presentation store (the palette's idiom) with THIS row's id as the
	 * third argument - the pane's session is generally not the row's - and the
	 * palette's two navigation lines. The invoker is the row's own button, not
	 * the item, which unmounts with the menu.
	 */
	assert.ok(
		forkItem.includes("requestPanel("),
		"the fork item no longer asks the panel-presentation store",
	);
	const request = between(forkItem, "requestPanel(", ");");
	assert.ok(
		request.includes('"session.fork"') &&
			request.includes("[data-chat-row]") &&
			request.includes("row.session_id,"),
		"the request no longer names the register's fork picker, the row's own button as the invoker, and the row's conversation",
	);
	assert.ok(
		request.trimEnd().endsWith("row.session_id,"),
		"the row's session id is no longer the request's LAST argument (the addressed conversation)",
	);
	assert.ok(
		forkItem.includes(
			'if (!location.pathname.startsWith("/chat")) navigate("/chat");',
		),
		"the fork item no longer routes to the pane only when none is mounted (the palette's idiom)",
	);
	assert.ok(
		forkItem.indexOf("requestPanel(") < forkItem.indexOf('navigate("/chat")'),
		"the request must be written BEFORE the navigation, or it races the pane's mount",
	);
	/*
	 * NO SECOND FORK IMPLEMENTATION: the sidebar neither imports the picker nor
	 * posts the op.
	 */
	assert.equal(
		/ForkPicker|sessions\.fork|desktopResult/.test(SIDEBAR_CODE),
		false,
		"the sidebar carries its own fork - the picker is the register's and the pane presents it",
	);
});

test("Copy session ID is the menu's sixth row, unconditional and chord-free (#893)", () => {
	/*
	 * The act that spent the sixth slot (#893). It is a plain press on no row
	 * control - the value is the row's own id - so the pins read the four things
	 * that make it this menu's item: it is drawn unconditionally, it copies
	 * `row.session_id` rather than anything else on the row, and its label and
	 * glyph are the ones the design record names.
	 */
	const itemAt = MENU.indexOf("copySessionId(row.session_id)");
	assert.notEqual(
		itemAt,
		-1,
		"the Copy session ID item is gone from the row menu",
	);
	const tagAt = MENU.lastIndexOf("<ContextMenuItem", itemAt);
	assert.ok(
		tagAt !== -1 && tagAt < itemAt,
		"the copy call is no longer an item's `onSelect`",
	);
	const item = MENU.slice(tagAt, MENU.indexOf("</ContextMenuItem>", itemAt));
	/*
	 * UNCONDITIONAL, like Fork and unlike the pair above it and the Move pair
	 * below: the JSX between the previous item's close and this tag carries no
	 * `{... && (` gate, and the item carries neither `disabled` nor `aria-disabled`.
	 * Copying an id works on EVERY row the menu is drawn on - a row whose pin state
	 * is unknown, a row behind the archived list, a remote row - so there is no
	 * predicate it could honestly be gated on, and the brief says so.
	 */
	const gap = MENU.slice(MENU.lastIndexOf("</ContextMenuItem>", itemAt), tagAt);
	assert.equal(
		/&&/.test(gap),
		false,
		"the Copy item gained a gate - it is drawn whenever the menu is, like Fork, because every row has an id",
	);
	assert.equal(
		/disabled/.test(item),
		false,
		"the Copy item is disabled rather than unconditional: it has no unusable state",
	);
	/*
	 * LABEL AND GLYPH. Verb + object, the pair's register (`Archive conversation`,
	 * `Fork conversation`), and lucide's `Copy` - the two overlapping squares, NOT
	 * `ClipboardCopy`, which the file-actions menu wears - with the `aria-hidden`
	 * mark every glyph in this menu carries.
	 */
	assert.ok(
		item.includes("<span>Copy session ID</span>"),
		"the copy item's label moved: it reads `Copy session ID`, the one spelling both of its doors use",
	);
	assert.ok(
		item.includes('<Copy aria-hidden="true" />'),
		"the copy item's glyph is no longer lucide's `Copy` with its aria-hidden mark",
	);
	assert.equal(
		item.includes("ClipboardCopy"),
		false,
		"the copy item wears `ClipboardCopy` (the file-actions menu's glyph); the design record names `Copy` for this one",
	);
	/*
	 * NO CHORD, the rule Fork's own test states: nothing binds a copy-session-id
	 * gesture, and a `KeyboardShortcut` here would print a hint for a gesture that
	 * does nothing - and would move the accessible name as well.
	 */
	assert.equal(
		item.includes("KeyboardShortcut"),
		false,
		"the copy item prints a chord, but no chord is bound to copying a session id",
	);
});

test("Rename conversation is the menu's fifth row, and it acts on the row it was opened on (#920)", () => {
	/*
	 * The act that spent the seventh slot (#920). Like Fork and Copy it is a plain
	 * press on no row control, so the pins read the four things that make it this
	 * menu's item: it is drawn unconditionally, it addresses THIS row's conversation
	 * (never the pane's - the asymmetry the issue is about), it carries the name the
	 * row DRAWS so the dialog cannot open on the other conversation's name, and its
	 * label and glyph are the ones the design record names. Its wiring is the Fork
	 * item's, read the same way: a request through the panel-presentation store that
	 * names the row's own button as the invoker and the row's id as the subject.
	 */
	const itemAt = MENU.indexOf('"session.rename"');
	assert.notEqual(
		itemAt,
		-1,
		"the Rename conversation item is gone from the row menu",
	);
	const tagAt = MENU.lastIndexOf("<ContextMenuItem", itemAt);
	assert.ok(
		tagAt !== -1 && tagAt < itemAt,
		"the rename request is no longer an item's `onSelect`",
	);
	const item = MENU.slice(tagAt, MENU.indexOf("</ContextMenuItem>", itemAt));
	/*
	 * UNCONDITIONAL, like Fork and Copy and unlike the two above them and the Move
	 * pair below: renaming needs a conversation, and every row IS one - a row whose
	 * pin state is unknown, a row behind the archived list, a remote row - so there
	 * is no predicate it could honestly be gated on, and none is authored.
	 */
	const gap = MENU.slice(MENU.lastIndexOf("</ContextMenuItem>", itemAt), tagAt);
	assert.equal(
		/&&/.test(gap),
		false,
		"the Rename item gained a gate - it is drawn whenever the menu is, like Fork and Copy, because every row has a conversation to rename",
	);
	assert.equal(
		/disabled/.test(item),
		false,
		"the Rename item is disabled rather than unconditional: it has no unusable state",
	);
	/*
	 * LABEL AND GLYPH: verb + object, the register the sibling items share, and the
	 * same pencil the header's rename control wears (`chat-header.tsx`) with the
	 * `aria-hidden` mark every glyph in this menu carries. It opens the register's
	 * own dialog, so the label deliberately carries no ellipsis - the spelling the
	 * header control and that dialog both use.
	 */
	assert.ok(
		item.includes("<span>Rename conversation</span>"),
		"the rename item's label moved: it reads `Rename conversation`, the spelling the header control and the dialog both use",
	);
	assert.ok(
		item.includes('<Pencil aria-hidden="true" />'),
		"the rename item's glyph is no longer the header control's pencil, aria-hidden",
	);
	/*
	 * NO CHORD, the rule Fork's and Copy's own tests state: nothing binds a rename
	 * gesture, and a `KeyboardShortcut` here would print a hint for a gesture that
	 * does nothing.
	 */
	assert.equal(
		item.includes("KeyboardShortcut"),
		false,
		"the rename item prints a chord, but no chord is bound to renaming",
	);
	/*
	 * THE WIRING: the register's own picker, asked for through the panel-presentation
	 * store (the Fork item's idiom) for THIS row's conversation - not the pane's - and
	 * with the ROW's displayed name riding along, so the dialog's field cannot open on
	 * the pane's title. The invoker is the row's own button, not the item, which
	 * unmounts with the menu.
	 */
	assert.ok(
		item.includes("requestPanel("),
		"the rename item no longer asks the panel-presentation store",
	);
	const request = between(item, "requestPanel(", ");");
	assert.ok(
		request.includes('"session.rename"') &&
			request.includes("[data-chat-row]") &&
			request.includes("row.session_id,"),
		"the request no longer names the register's rename picker, the row's own button as the invoker, and the row's conversation",
	);
	assert.ok(
		request.includes('{ subjectName: row.title || "Untitled chat" }'),
		"the request no longer carries the name the row DRAWS - the presenter holds a pane, not the row that was pointed at",
	);
	assert.ok(
		item.includes(
			'if (!location.pathname.startsWith("/chat")) navigate("/chat");',
		),
		"the rename item no longer routes to the pane only when none is mounted (the palette's idiom)",
	);
	assert.ok(
		item.indexOf("requestPanel(") < item.indexOf('navigate("/chat")'),
		"the request must be written BEFORE the navigation, or it races the pane's mount",
	);
	/*
	 * NO SECOND RENAME IMPLEMENTATION: the sidebar neither imports the picker nor
	 * posts the command itself - the write is the pane's, and the header's inline
	 * editor submits the same `sessions.command` `rename` through the same hook.
	 */
	assert.equal(
		/RenamePicker|sessions\.command|desktopResult/.test(SIDEBAR_CODE),
		false,
		"the sidebar carries its own rename - the picker is the register's and the pane presents it",
	);
});

test("no rule on the row box is authored against `data-state`", () => {
	/*
	 * THE GUARD §3 REQUIRES (UX round, U-D3). The row's box is ALREADY a Radix
	 * trigger - the shared Tooltip's - and carries the tooltip's `data-state`
	 * while the flyout is drawn, which is exactly the state a right-click happens
	 * in. A `ContextMenu.Trigger` on the same element writes the same attribute
	 * with the menu's own values, so a rule authored against it holds or drops
	 * depending on which component re-rendered last; the design record calls
	 * `data-[state=open]:bg-row-hover` and `group-data-[state=open]:flex` defects
	 * by name. The sidebar reads only ONE spelling for the held state -
	 * `openMenuRowId`, through `menuOpen` - and this test is what keeps the other
	 * one from being reintroduced silently.
	 */
	const boxAt = SIDEBAR_CODE.indexOf("data-session-row={row.session_id}");
	assert.notEqual(boxAt, -1, "the row's box no longer carries its own id");
	const classOpen = SIDEBAR_CODE.indexOf("className={cn(", boxAt);
	const boxClasses = SIDEBAR_CODE.slice(
		classOpen,
		SIDEBAR_CODE.indexOf(")}", classOpen),
	);
	assert.equal(
		boxClasses.includes("data-[state="),
		false,
		"the row's box authors a rule against `data-state`, the attribute two triggers share - author the hold against `openMenuRowId` instead",
	);
	/*
	 * AND NOWHERE ELSE IN THIS PANEL, which is the stronger reading of the same
	 * rule: the attribute's value on the row box is composed by two triggers, and
	 * a rule shaped like the two above would read as a variant here no matter
	 * which element it named. A future component with a legitimate use extends
	 * this assertion with its reason - it is deliberately not spelled so an
	 * exception can ride in unnoticed.
	 */
	assert.equal(
		SIDEBAR_CODE.includes("data-[state="),
		false,
		"`data-[state=` appears in the sidebar's code",
	);
	/*
	 * AND THE SANCTIONED SPELLING IS PRESENT, so the guard above cannot pass by
	 * the hold being deleted: the ground on `!current` rows, and the reveal's
	 * authoring sites - the pin glyph, the archive glyph, and (with #697 folded in)
	 * the pin strip's own grip - because a hold on the wrapper alone renders a
	 * `flex` box with nothing in it. THE MOVE PAIR'S TWO CLAUSES WENT WITH THE PAIR
	 * (2026-09-30): its acts are the row menu's Move items now, and a menu row is in
	 * the menu's portal, where the row's hold does not reach.
	 */
	assert.ok(
		boxClasses.includes('menuOpen && !current && "bg-row-hover"'),
		"the held ground (`menuOpen && !current`) is gone or renamed",
	);
	assert.equal(
		SIDEBAR_CODE.split('menuOpen && "flex text-ink-muted"').length - 1,
		3,
		"the held reveal no longer covers every revealing site (both glyphs and #697's grip: three clauses; the wrapper holds separately)",
	);
	assert.ok(
		SIDEBAR_CODE.includes("pinned || menuOpen"),
		"the pair wrapper no longer holds itself revealed while its menu is open",
	);
});

test("the withdrawn panel carries no trigger, and the menu exists only where a capability does", () => {
	/*
	 * §4's byte-identity row: with NEITHER per-row capability there is no trigger
	 * element, no attribute and no handler - the panel is the one it had before
	 * this feature existed. The early return below is that panel; the trigger
	 * lives only in the capable path after it.
	 */
	const withdrawn = between(
		SIDEBAR_CODE,
		"if (!pinsEnabled && !archiveEnabled) {",
		"const bothControls =",
	);
	assert.equal(
		withdrawn.includes("ContextMenu"),
		false,
		"the withdrawn panel carries a menu root or trigger",
	);
	assert.equal(
		withdrawn.includes("data-session-menu-trigger"),
		false,
		"the withdrawn panel carries the menu's driver hook",
	);
	assert.equal(
		withdrawn.includes("onKeyDown"),
		false,
		"the withdrawn panel carries the keyboard opener",
	);
	assert.ok(
		withdrawn.includes("className={cn(rowBoxStyle, current && rowCurrent)}"),
		"the withdrawn panel's box is no longer the pre-feature box",
	);
	/*
	 * And the capable path carries all three: the hook, the opener, and the
	 * asChild trigger inside the Tooltip (so the flyout keeps anchoring to the
	 * box that does not shrink).
	 */
	assert.ok(
		SIDEBAR_CODE.includes("data-session-menu-trigger"),
		"no row carries the menu's driver hook any more",
	);
	assert.ok(
		SIDEBAR_CODE.includes("onKeyDown={openRowMenuAtKeyboard}"),
		"the box no longer answers the keyboard opener",
	);
	assert.ok(
		SIDEBAR_CODE.includes(
			"<ContextMenuTrigger asChild>{rowBox}</ContextMenuTrigger>",
		),
		"the box is no longer the trigger (asChild), so a wrapper element would have entered the list",
	);
});

test("the keyboard opener synthesises its point and never reads the platform's", () => {
	/*
	 * §3's structural contract, which is what stands in for a platform
	 * measurement the design round could not take: no code path on the keyboard
	 * opener may consume `event.clientX/clientY`, and the point it dispatches is
	 * the row's own box edge (`rect.left`, `rect.bottom - 1`). The dispatch is
	 * the trigger's own `contextmenu`, so the primitive's own `handleOpen` stores
	 * the point and sets `hasInteractedRef` before `open` - the "position is
	 * indeterminate" path is unreachable by construction.
	 */
	const opener = SIDEBAR_CODE.slice(
		SIDEBAR_CODE.indexOf("const openRowMenuAtKeyboard = (event"),
		SIDEBAR_CODE.indexOf("const keyDown = (event"),
	);
	assert.ok(
		opener.includes('event.key !== "ContextMenu"') &&
			opener.includes('event.shiftKey && event.key === "F10"'),
		"the opener no longer answers `ContextMenu` and `Shift+F10`",
	);
	assert.ok(
		opener.includes("event.preventDefault()"),
		"the opener no longer prevents the platform's default",
	);
	assert.equal(
		opener.includes("event.clientX") || opener.includes("event.clientY"),
		false,
		"the keyboard opener consumes the ambient event's coordinates",
	);
	assert.ok(
		opener.includes('new MouseEvent("contextmenu"'),
		"the opener no longer dispatches the trigger's own contextmenu",
	);
	assert.ok(
		opener.includes("clientX: rect.left") &&
			opener.includes("clientY: rect.bottom - 1"),
		"the synthesised point is no longer the row box's own edge",
	);
	/*
	 * FOCUS, both edges of it: the keyboard path lands in the FIRST ITEM on open
	 * (U-D4's minimum - focus visible, so a reader who pressed `Shift+F10` can act
	 * without first pressing an arrow) and returns the caret to the row's button on
	 * close; both prevent the primitive's default, and `menuOpenedByKeyboard` is
	 * the one splitter. The pointer path takes no focus of its own but GIVES BACK
	 * WHAT THE MENU TOOK (U8 below), read at the press itself (QA round 3's Q-1 -
	 * the press's own default moves focus, so the capture must run first).
	 */
	const open = between(MENU, "onFocus={(event) => {", "onCloseAutoFocus");
	assert.ok(
		open.includes("if (!menuOpenedByKeyboard.current) return;"),
		"the open-focus splitter is gone, so the pointer path would take item focus",
	);
	assert.ok(
		open.includes("event.target !== event.currentTarget"),
		"the focus redirect no longer restricts itself to the CONTAINER's own focus",
	);
	assert.ok(
		open.includes('[role="menuitem"]'),
		"the keyboard path no longer focuses the first item",
	);
	const close = between(
		MENU,
		"onCloseAutoFocus={(event) => {",
		"}}\n\t\t\t\t>",
	);
	assert.ok(
		close.includes("event.preventDefault()") &&
			close.includes("[data-chat-row]") &&
			close.includes("?.focus()"),
		"the close-focus path no longer prevents the default and returns the caret to the row's button",
	);
	/*
	 * AND THE POINTER CLOSE GIVES BACK WHAT THE MENU TOOK (UX round 2, U8): the
	 * primitive moves focus into the panel on open even under the pointer, so the
	 * close must focus the element the open captured - with the row's button as
	 * the deliberate fallback when that node is gone - or the caret falls to
	 * `<body>` and a reader who was typing must click before the next keystroke
	 * lands (QA round 2's reading).
	 */
	const openChange = between(
		SIDEBAR_CODE,
		"onOpenChange={(open) => {",
		"<RowMenuOwner",
	);
	assert.ok(
		openChange.includes("document.activeElement") &&
			openChange.includes("menuFocusReturnRef.current ="),
		"the open no longer captures the pre-open focus target the pointer close returns to (U8)",
	);
	/*
	 * AND THE PRESS ITSELF IS THE CAPTURE MOMENT (QA round 3, Q-1): a real
	 * right-press's own `mousedown` default moves focus to the row's button
	 * BEFORE the menu opens, so a capture inside `onOpenChange` remembered the
	 * button - Escape returned it and the next keystroke began the row's
	 * type-to-filter (measured live). The box reads the pre-press focus on
	 * `pointerdown`'s capture phase, where the press's default has not run yet;
	 * `onOpenChange`'s capture remains for opens with no press and is guarded by
	 * the ref's emptiness so it cannot overwrite the press-time value.
	 */
	const pressCapture = between(
		SIDEBAR_CODE,
		"const rememberFocusBeforePress = () => {",
		"};",
	);
	assert.ok(
		pressCapture.includes("document.activeElement") &&
			pressCapture.includes("menuFocusReturnRef.current ="),
		"the pre-press focus is no longer read on pointerdown's capture phase (QA r3 Q-1)",
	);
	assert.ok(
		SIDEBAR_CODE.includes("onPointerDownCapture={rememberFocusBeforePress}"),
		"the row box no longer wires the capture-phase reader (QA r3 Q-1)",
	);
	assert.ok(
		openChange.includes("menuFocusReturnRef.current === null"),
		"the open-time capture is no longer guarded against overwriting the press-time value (QA r3 Q-1)",
	);
	assert.ok(
		close.includes("menuFocusReturnRef.current") &&
			close.includes("isConnected") &&
			close.includes("[data-chat-row]"),
		"the pointer close no longer returns the captured focus, falling back to the row's button (U8)",
	);
	assert.ok(
		close.includes("if (!menuOpenedByKeyboard.current) {"),
		"the pointer close went back to returning without a focus destination (U8)",
	);
	/*
	 * AND THE LIST STANDS DOWN WHILE THE MENU IS OPEN (§6): the panel's keydown
	 * answers an unknown target with `rows[0]`, so without this guard an arrow
	 * pressed inside the open menu would move focus out of it to the first
	 * conversation.
	 */
	const keyDown = SIDEBAR_CODE.slice(
		SIDEBAR_CODE.indexOf("const keyDown = (event"),
	);
	assert.ok(
		keyDown.indexOf("if (openMenuRowId !== null) return;") <
			keyDown.indexOf("const target = event.target"),
		"the panel's keydown no longer yields while a row's menu is open",
	);
	/*
	 * THE MENU'S OWN SENTENCE (U-D5): the trigger adds no `aria-haspopup`, so the
	 * menu is announced through this row's existing description channel - an
	 * `sr-only` span the button's `aria-describedby` names, rendered whenever the
	 * row carries the menu.
	 */
	assert.ok(
		SIDEBAR_CODE.includes(
			"menuEnabled ? rowMenuClauseId(row.session_id) : null",
		),
		"the row button's describedby list no longer names the menu clause",
	);
	assert.ok(
		SIDEBAR_CODE.includes("{menuRemedy}"),
		"the menu clause is no longer rendered beside the row's other remedies",
	);
});

test("the open-menu id is reconciled when the row that set it leaves the tree", () => {
	/*
	 * U1's guard (UX round 1): Radix's context-menu root does nothing on unmount,
	 * so a row that left the tree with its menu open used to leave `openMenuRowId`
	 * naming a row that no longer renders - and the list's keydown stood down for
	 * the rest of the session (arrow-walk, Home/End, the two chords and
	 * type-to-filter all dead). The reconcile rides the ROW INSTANCE: every
	 * menu-carrying row renders `RowMenuOwner`, whose unmount cleanup clears the
	 * id and the keyboard flag TOGETHER - guarded by the sidebar's latest value,
	 * so an unrelated row's departure touches nothing. Pinned here because this
	 * suite cannot mount the sidebar (it reads the router, the store and the
	 * capability hooks - see the file header), and the behaviour itself is QA's
	 * scene in round 2.
	 */
	const owner = between(
		SIDEBAR_CODE,
		"const RowMenuOwner: FC<{",
		"return null;",
	);
	assert.ok(
		owner.includes("if (openMenuRowIdRef.current !== id) return;"),
		"the unmount cleanup no longer checks the id still names the row that is leaving",
	);
	assert.ok(
		owner.includes("setOpenMenuRowId(null)") &&
			owner.includes("openedByKeyboard.current = false"),
		"the unmount cleanup no longer clears the id and the keyboard flag together",
	);
	const rowMenu = between(SIDEBAR_CODE, "<ContextMenu\n", "</ContextMenu>");
	assert.ok(
		rowMenu.includes("<RowMenuOwner"),
		"the menu-carrying row no longer mounts the unmount cleanup",
	);
	assert.ok(
		SIDEBAR_CODE.includes("openMenuRowIdRef.current = openMenuRowId;"),
		"the latest-value mirror the cleanup reads is no longer kept",
	);
});
