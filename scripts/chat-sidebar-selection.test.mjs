/**
 * The selected conversation's ground and the settings destinations' flat rail,
 * executable. Settings deliberately opts out of the persistent chat fill; its
 * current-page dot and weight identify a destination on a continuous surface.
 *
 *     node --test scripts/chat-sidebar-selection.test.mjs
 *
 * The operator's report was "the sidebar doesn't visibly highlight the selected
 * conversation, so you can't tell from the sidebar which one is selected". The
 * chat panel is `bg-surface`; the ground every current-row state used was
 * `accent-wash`, which is ΔE00 1.05 from `surface` in tokyoNight — no mark at
 * all — while the hover step the same rows carry measures 4.58 there, so the
 * pointer read as the current row and the current row did not. The settings rail
 * originally shared that selected-fill contract. It now has a deliberately
 * different resting-surface contract, asserted below in both layouts, while
 * the chat consumers retain their original fill checks.
 *
 * THREE THINGS THIS FILE ASSERTS, AND WHY EACH NEEDS ITS OWN INSTRUMENT:
 *
 *   1. the GROUND a current row paints is a step off its panel, not a wash —
 *      read off the shipped class strings, because no palette assertion can see
 *      a class and every one of them stayed green while this shipped;
 *   2. the ground SURVIVES THE POINTER, resolved through the SHIPPED `cn` over
 *      the expression the component actually passes. This is the instrument
 *      round 1 asked for and the reason this file no longer merges strings it
 *      wrote itself: the property is a tailwind-merge resolution (the two
 *      `hover:bg-*` land in one conflict group and the LAST one wins), so a
 *      call-site reorder, or dropping the `hover:` half, or moving the ground
 *      off the element that carries the hover step, all move it. The entity
 *      row's ground is on two elements for exactly that reason — a child's
 *      background paints over its parent's — so `merged()` below resolves every
 *      element of a current row that this file's `CURRENT` table names, and a
 *      separate assertion counts the `hover:bg-*` class literals in both panels
 *      and requires the file to account for every one of them, so a control
 *      added to a row cannot be resolved by nobody;
 *   3. every current-row state in those two panels takes the same role — the
 *      the chat call sites and the entity row's elements are one fact. Settings
 *      destinations are the documented flat-surface exception.
 *
 * TWO OF THE INSTRUMENTS THIS FILE CARRIED ARE RETIRED WITH THE SURFACES THEY
 * MEASURED (operator ask, 2026-09-18: the sidebar's per-row browser mark was removed),
 * and they are recorded rather than deleted silently because both were answers to a
 * review finding:
 *
 *   - the mark's disclosure step (`expanded && "text-ink"`) was asserted as a
 *     TOKEN, because `text-ink-muted` and `hover:text-ink` both CONTAIN it as a
 *     substring — the distinction between "the state is visible" being a claim
 *     and being a checked one (review round 3, A-1). The control is gone, so no
 *     current-row element carries a conditional ink step any more and there is no
 *     token left to read;
 *   - the SPECIMEN the mark's committed frames were taken through was a THIRD
 *     import of the role, resolved on both of its elements, because the two drifts
 *     this file exists for (rounds 3 and 4, D17 and D19) both landed at an ELEMENT
 *     while the copied string above it stayed verbatim (round 5: design D22, agent
 *     A-7). The story file and its `docs/evidence/browser-conversation-mark/` set
 *     are deleted with the control. What that pair proved is still asserted, against
 *     the consumers that remain: no class literal in the shipped tree spells the role
 *     a second time, AND each consumer resolves the whole role through the shipped
 *     `cn`;
 *
 * WHAT IT CANNOT PROVE: that the ground is *visible*, and that it steps in the
 * right DIRECTION. Both are properties of the role against its neighbours across
 * every palette, and they are `scripts/contrast-contract.mjs`'s job - it asserts
 * `rowSelected` against `surface`, `rowHover` and the grounds at the row-state
 * bands (ΔE00 4.0 off `surface` and 2.0 off `rowHover`), asserts the SIGN of the
 * `L*` step (lighter on a dark palette, darker on a light one, with a floor on
 * the magnitude), and carries one CLASS rather than a ledger of named palettes:
 * `ROW_STATE_NEUTRAL_ACCENT`, for the monochrome palette whose `accent` has no
 * chroma to spend. It also cannot
 * prove the row reads as the current one on screen; that is the frames in
 * `docs/evidence/chat-sidebar-current-row/`.
 *
 * PROCEDURE NOTE. The sidebar cannot be rendered in isolation — it reads the
 * router, the canonical-sessions store and the desktop capability hooks — and
 * this repository's desktop suite has no DOM harness, so the rows' `cn(...)`
 * expressions are read as source TEXT and then RUN against the real `cn`, with
 * every predicate stubbed true so the merged answer is the class list the
 * current row really carries. The comment scanner below is the one in
 * `scripts/new-chat-row.test.mjs`: comments have to come out before class
 * literals are read, or a note explaining the ground re-arms a pin (that file
 * records the round it bit).
 */

import assert from "node:assert/strict";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build, transform } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const SETTINGS_RAIL =
	"src/renderer/src/features/settings/components/settings-sidebar.tsx";
const LIBRARY_CARD =
	"src/renderer/src/features/library/components/library-card.tsx";
const LIBRARY_FILTER_RAIL =
	"src/renderer/src/features/library/components/library-filter-rail.tsx";
const LIBRARY_PAGE =
	"src/renderer/src/features/library/components/library-page.tsx";
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");
/**
 * The sidebar nav's accessible name comes from the English catalogue now: the
 * ground below is found by the key the nav renders AND the message a reader
 * hears, so a renamed key cannot leave this table reading an unrelated element.
 */
const SIDEBAR_COPY = JSON.parse(
	read("src/i18n/catalogues/en/ui.chat.sidebar.json"),
);

/*
 * React stays out of this bundle and so does every package: `packages:
 * "external"` keeps bare specifiers bare, which is why the bundle is written to
 * a real file rather than handed to `import()` as a `data:` URL — nothing
 * resolves a bare specifier from a data URL. From `node_modules/.cache/` it
 * resolves what this process resolves, to the same paths, so `cn` here is the
 * `cn` the renderer ships.
 */
const CACHE = join(ROOT, "node_modules/.cache/chat-sidebar-selection");
const bundleInto = async (name, contents) => {
	const bundle = await build({
		stdin: { contents, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		packages: "external",
		write: false,
	});
	mkdirSync(CACHE, { recursive: true });
	const file = join(CACHE, `${name}.mjs`);
	writeFileSync(file, bundle.outputFiles[0].text);
	return import(pathToFileURL(file).href);
};

const { cn } = await bundleInto(
	"utils",
	`export { cn } from "./src/renderer/src/shared/lib/utils";`,
);

/**
 * Strip `//` and comment-block comments, outside string literals.
 *
 * A scanner rather than two `replace()` passes because a slice can legitimately
 * contain a `//` inside a quoted string, and a regular expression cannot tell
 * that from the start of a comment.
 */
const stripComments = (text) => {
	let out = "";
	let quote = null;
	for (let i = 0; i < text.length; ) {
		const char = text[i];
		const next = text[i + 1];
		if (quote) {
			if (char === "\\") {
				out += text.slice(i, i + 2);
				i += 2;
				continue;
			}
			if (char === quote) quote = null;
			out += char;
			i += 1;
			continue;
		}
		if (char === '"' || char === "'" || char === "`") {
			quote = char;
			out += char;
			i += 1;
			continue;
		}
		if (char === "/" && next === "/") {
			while (i < text.length && text[i] !== "\n") i += 1;
			continue;
		}
		if (char === "/" && next === "*") {
			i += 2;
			while (i < text.length && !(text[i] === "*" && text[i + 1] === "/"))
				i += 1;
			i += 2;
			continue;
		}
		out += char;
		i += 1;
	}
	return out;
};

const code = new Map([
	[SIDEBAR, stripComments(read(SIDEBAR))],
	[SETTINGS_RAIL, stripComments(read(SETTINGS_RAIL))],
]);

/**
 * The comment-stripped source of a file, cached in the map above.
 *
 * The two entries the map is seeded with are the panels this file was written
 * for; everything else it reads — the other `rowCurrent` surfaces and the files
 * their grounds live in — comes through here, so a new surface costs no
 * plumbing and the comment-stripping is the same one pass.
 */
const sourceOf = (file) => {
	if (!code.has(file)) code.set(file, stripComments(read(file)));
	return code.get(file);
};

/**
 * Every comment-stripped `.ts`/`.tsx` source under a directory, with its path, so a test can
 * ask a question of the whole shipped tree rather than of a table of files.
 *
 * This is the second half of the round-5 instrument (design D22, agent A-7), and the half that
 * makes "one spelling" a property rather than a habit: the other half resolves what a call
 * site PAINTS, this one asks whether the role has been written down somewhere else at all. The
 * two drifts this file exists for were both copies of the role in a file no instrument read,
 * so with the role imported by all three consumers a copy comes back as a REINTRODUCTION — and
 * a reintroduction is exactly what a tree-wide read can see.
 *
 * `scripts/` is deliberately outside the walk: `scripts/contrast-contract.mjs` quotes the
 * declaration as a pin, whose job is to FAIL when the role's terms change so the palette half
 * is re-measured. That is a different instrument from this one.
 */
const sourcesIn = (dir) => {
	const found = [];
	const walk = (path) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const child = join(path, entry.name);
			if (entry.isDirectory()) {
				walk(child);
				continue;
			}
			if (!/\.tsx?$/.test(entry.name)) continue;
			found.push({
				file: relative(ROOT, child),
				source: stripComments(readFileSync(child, "utf8")),
			});
		}
	};
	walk(join(ROOT, dir));
	return found;
};

/** Every `"..."` literal in the shipped renderer, with the file it is in. */
const classLiteralsIn = (dir) =>
	sourcesIn(dir).flatMap(({ file, source }) =>
		[...source.matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)].map((match) => ({
			file,
			literal: match[1],
		})),
	);

/** The argument list of the `cn(...)` a `className` is built from. */
const argumentsFrom = (source, open) => {
	const start = source.indexOf("cn(", open);
	assert.notEqual(
		start,
		-1,
		"the element at this anchor no longer routes its className through `cn`, so this file cannot resolve what it paints",
	);
	const end = source.indexOf(")}", start);
	assert.notEqual(end, -1, "unterminated `cn(` in the source slice");
	return source.slice(start + "cn(".length, end);
};

/** The next element's `cn(...)` at or after an anchor. */
const expressionAfter = (file, anchor) => {
	const source = sourceOf(file);
	const at = source.indexOf(anchor);
	assert.notEqual(
		at,
		-1,
		`no element in ${file} matches ${JSON.stringify(anchor)}`,
	);
	return argumentsFrom(source, at);
};

/**
 * The next element's `cn(...)` at or after an anchor, searched only AFTER an
 * earlier anchor.
 *
 * WHY THIS EXISTS (round 1, U2). `expressionAfter` takes the FIRST occurrence of
 * its anchor in the whole file, which was unambiguous while the only `data-entity-name`
 * in the sidebar was the button itself. The paged catalogue's focus effect names
 * the same attribute in a `querySelector` - earlier in the file, and legitimately -
 * so the anchor moved into that effect and the extraction landed in `sessionRow`.
 * Scoping the search after the entity wrapper keeps the pin on the element it names
 * and no longer depends on nothing else mentioning the attribute.
 */
const expressionAfterWithin = (file, from, anchor) => {
	const source = sourceOf(file);
	const start = source.indexOf(from);
	assert.notEqual(
		start,
		-1,
		`no element in ${file} matches ${JSON.stringify(from)}`,
	);
	const at = source.indexOf(anchor, start);
	assert.notEqual(
		at,
		-1,
		`no element in ${file} matches ${JSON.stringify(anchor)} after ${JSON.stringify(from)}`,
	);
	return argumentsFrom(source, at);
};

/** The `cn(...)` that owns an anchor sitting INSIDE its own argument list. */
const expressionBefore = (file, anchor) => {
	const source = sourceOf(file);
	const at = source.indexOf(anchor);
	assert.notEqual(
		at,
		-1,
		`no element in ${file} matches ${JSON.stringify(anchor)}`,
	);
	const open = source.lastIndexOf("className={cn(", at);
	assert.notEqual(
		open,
		-1,
		`the element carrying ${JSON.stringify(anchor)} no longer has a cn() class expression`,
	);
	return argumentsFrom(source, open);
};

/**
 * Resolve one element's class list by RUNNING its own expression through the
 * shipped `cn`, with every predicate stubbed true.
 *
 * This is the instrument the review asked for: a merge over strings this file
 * wrote itself cannot see a call-site REORDER, and a substring search cannot see
 * the ground landing on an element the pointer never paints.
 */
const merged = (file, expression, stubs) => {
	/*
	 * EVERY PREDICATE STUBBED TRUE, which is this helper's documented contract - `pinned` now
	 * appears in the archive control's own class expression (UX round 3, U6: a pinned row keeps
	 * that slot so its mark cannot move under the reader's aim), so it is defaulted here rather
	 * than in each caller. A caller needing the other branch passes `pinned: false`, and the
	 * spread below lets it win. `menuOpen` joins the defaults with the row menu (#694): the
	 * hold clauses (`menuOpen && ...`) are in the boxes' and the controls' own class
	 * expressions, and the held state is the one where every predicate this helper merges for
	 * is live.
	 */
	const withDefaults = { menuOpen: true, pinned: true, ...stubs };
	const names = Object.keys(withDefaults);
	// biome-ignore lint/security/noGlobalEval: the evaluated text is this repository's own source, read two assertions above, and the sandbox is a `new Function` over stub predicates.
	const call = new Function("cn", ...names, `return cn(${expression});`);
	return call(cn, ...names.map((name) => withDefaults[name]));
};

/** The literal class strings a row declares, comments removed. */
const literalOf = (file, name) => {
	const source = sourceOf(file);
	const at = source.indexOf(`const ${name} =`);
	assert.notEqual(at, -1, `${file} no longer declares \`${name}\``);
	const match = source.slice(at, source.indexOf(";", at)).match(/"([^"]*)"/);
	assert.notEqual(
		match,
		null,
		`\`${name}\` is no longer a plain class literal, so this file cannot read it and the ground is no longer pinned anywhere`,
	);
	return match[1];
};

/**
 *
 * Whether a resolved class list carries the current row's GROUND.
 *
 * A single token, unlike the two it took while the row also carried a 1px
 * `outline-control` ring beside it: that half is retired (design round 1, D3 —
 * the role is § 2's *sole boundary of a control* and both rails drew it with the
 * search field's own ink, radius and height, so the current row read as a filled
 * field). The mark is the row role (`bg-row-selected`) plus `font-medium`, and
 * both are asserted here. The 2px `accent` bar was the third until the refinement
 * round removed it, so what `font-medium` has to carry is stated in the test
 * below rather than assumed.
 */
const carriesGround = (classes) => classes.includes("bg-row-selected");

const rowStyle = literalOf(SIDEBAR, "rowStyle");
const rowBoxStyle = literalOf(SIDEBAR, "rowBoxStyle");
const rowCurrent = literalOf(SIDEBAR, "rowCurrent");
const TEAM_BRIDGE_PAGE =
	"src/renderer/src/features/team-bridge/team-bridge-page.tsx";
const TEAM_BRIDGE_RAIL =
	"src/renderer/src/features/team-bridge/team-bridge-rail.tsx";
/**
 * The rail's own row base, as the module spells it (stubbed into its `cn`).
 *
 * The module spells it `RAIL_ROW`. The owner-audit round (b2e790dac63) renamed it
 * from `ROW` and exported it, because the audit section reuses the base rather
 * than copying the class; the string and the role are the same one. So do NOT
 * "restore" a local `ROW` here: `merged()` builds the call out of the rail's own
 * argument text, and the stub key has to be the identifier that text reads.
 */
const RAIL_ROW = literalOf(TEAM_BRIDGE_RAIL, "RAIL_ROW");

const rowDragging = literalOf(SIDEBAR, "rowDragging");
const rowDraggingMark = literalOf(SIDEBAR, "rowDraggingMark");

/*
 * The current row's mark, and which elements carry it.
 *
 * `ground` is what makes the row readable as the current one. The entity row's
 * name button carries it as well as its wrapper, deliberately: it carries
 * `rowStyle`, so its own hover step would otherwise paint over the wrapper's
 * ground — round 1's MAJOR — and the ground on both is one state spread
 * over the DOM rather than two decisions.
 */
const CURRENT = [
	{
		/*
		 * The conversation BUTTON: the row's `flex-1` half, which keeps the ground under
		 * the pointer. Anchored on its own hook (`data-child`) rather than on the current
		 * row's predicate, because that predicate is now computed once as `current` and
		 * worn by three elements - see the `same terms` test below, which is what holds
		 * that single decision together.
		 */
		what: "the selected conversation",
		file: SIDEBAR,
		/*
		 * ANCHORED ON THE BUTTON'S OWN CLASS EXPRESSION, not on the predicate: the
		 * predicate is declared once now (review round 1, A7) and the row reads the
		 * name, so the element to resolve is the one carrying `rowStyle`.
		 */
		expression: () => expressionBefore(SIDEBAR, '"min-w-0 grow text-start"'),
		stubs: {
			revealArmed: true,
			rowStyle,
			rowCurrent,
			nested: false,
			current: true,
			// Grouped, current, but not held: cursor opt-in must coexist with selection.
			tagDraggable: true,
			rowTagDrag: { armedId: null },
			row: { session_id: "synthetic-current-row" },
		},
		ground: true,
	},
	{
		/*
		 * The row's BOX, added with the split row (review round 1, M1). The ground has
		 * to be on the container and not only inside the button, because the pin slot is
		 * a sibling: a mark painted only in the button stops at the slot's edge, and the
		 * filled pin - which is the state the ground is there to sit behind - is drawn
		 * outside the row that says it is current. Same shape as the entity row's
		 * wrapper, which carries `staged && rowCurrent` for the same reason.
		 */
		what: "the conversation row's box",
		file: SIDEBAR,
		// The JSX attribute rather than the attribute's name: the move-anchoring
		// effect also SELECTS `[data-session-row="…"]`, and a bare search finds that
		// mention first.
		expression: () =>
			expressionAfter(SIDEBAR, "data-session-row={row.session_id}"),
		stubs: {
			revealArmed: true,
			rowBoxStyle,
			rowCurrent,
			/*
			 * THE DRAG'S OWN TWO TERMS (issue #697): the box now reads `dragging` for the
			 * `data-dragging` mark and `rowDragging` for the fill it steps to. `false` is
			 * the state this entry is about - no gesture is running, so the box must
			 * resolve to exactly the class list it had before the drag existed.
			 */
			dragging: false,
			rowDragging,
			current: true,
			// Both per-row capabilities present: the box the ground is asserted on is
			// carried while EITHER control is mounted, and this is the delivered
			// state (the pin and the archive control both advertised).
			pinsEnabled: true,
			archiveEnabled: true,
		},
		ground: true,
	},
	{
		what: "the entity row's wrapper",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-entity>"),
		stubs: { revealArmed: true, rowCurrent, staged: true },
		ground: true,
	},
	{
		/* The element round 1's MAJOR was about: it carries `rowStyle`, so its
		   hover step is what used to paint over the wrapper's ground. It carries
		   the GROUND too, which is asserted below. */
		what: "the entity row's name button",
		file: SIDEBAR,
		expression: () =>
			expressionAfterWithin(SIDEBAR, "data-entity>", "data-entity-name"),
		stubs: { revealArmed: true, rowStyle, rowCurrent, staged: true },
		ground: true,
	},
	{
		what: "the entity row's disclosure control",
		file: SIDEBAR,
		expression: () =>
			expressionAfterWithin(SIDEBAR, "data-entity>", "data-disclosure"),
		stubs: { revealArmed: true, staged: true },
		ground: false,
		notCurrent: { revealArmed: true, staged: false },
	},
	{
		what: "the entity row's manage control",
		file: SIDEBAR,
		expression: () =>
			/*
			 * Keyed copy (i18n wave A): the control's accessible name is the
			 * catalogue's, so the anchor is the expression the source carries -
			 * matched in its formatted multi-line shape, where `expressionBefore`
			 * reads the file as text.
			 */
			expressionBefore(
				SIDEBAR,
				'aria-label={t("ui.chat.sidebar.entity.manage", {',
			),
		stubs: { revealArmed: true, staged: true },
		ground: false,
		notCurrent: { revealArmed: true, staged: false },
	},
	{
		/*
		 * The entity row's PIN control, added with the agents roster (issue #663).
		 * It sits in the same trailing cluster as the manage control above and
		 * answers the pointer the same way, so it is a row surface for the same
		 * reason: `hover:bg-row-hover` is its only sanctioned ground and the
		 * `!staged` guard is what keeps the pointer from painting over the ground
		 * while the row is the staged one. It is revealed by OPACITY, like the
		 * `MessageSquarePlus` glyph, which is why the merge is asked for the hover
		 * step even though the element is transparent at rest - opacity paints
		 * nothing, the ground under the pointer is still the row's.
		 */
		what: "the entity row's pin control",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-agent-pin={pinKey}"),
		stubs: { revealArmed: true, staged: true, pinnedAgent: false },
		ground: false,
		notCurrent: { revealArmed: true, staged: false, pinnedAgent: false },
	},
	{
		/*
		 * The conversation row's pin control, added with the pinned section. It sits
		 * INSIDE a row that can be current, which is exactly the case this table's
		 * count exists to force somebody to notice: it carries `hover:bg-elevated`
		 * like the two 24px controls above, and it drops it while the row is the
		 * current one, so the pointer cannot paint over the ground that says where
		 * the reader is. Stubbed on a row that is NOT pinned, because that is the
		 * state in which the control is revealed and the pointer is over it.
		 */
		what: "the conversation row's pin control",
		file: SIDEBAR,
		// The JSX attribute, newline-terminated: the panel also SELECTS
		// `[data-session-pin]` in the effect that restores focus after a pin moves a
		// row, and a bare search for the name finds that selector first.
		expression: () => expressionAfter(SIDEBAR, "data-session-pin\n"),
		stubs: { revealArmed: true, pinned: false, current: true },
		ground: false,
		notCurrent: { revealArmed: true, pinned: false, current: false },
	},
	{
		/*
		 * The session row's archive control, which is the row's SECOND sibling control
		 * (the pin work lands the first). It is a row surface for the same reason the
		 * entity row's two 24px controls are: it sits INSIDE a row's box and answers
		 * the pointer, so `hover:bg-row-hover` is its only sanctioned ground and a
		 * `!current` guard is what keeps the pointer from replacing the mark that says
		 * where the reader is.
		 *
		 * Resolved FORWARD from the control's own `aria-label`, and NOT from a
		 * `data-session-archived` anchor: that attribute's first occurrence in the file
		 * is the row BUTTON's archived flag (the control's sibling), so a forward search
		 * from it lands on the row's own class expression - which is how this entry
		 * first reported `ReferenceError: rowStyle is not defined` instead of the
		 * control's classes.
		 */
		what: "the session row's archive control",
		file: SIDEBAR,
		expression: () =>
			expressionAfter(
				SIDEBAR,
				"aria-label={archiveControlLabel(label, archived)}",
			),
		stubs: { current: true },
		ground: false,
		notCurrent: { current: false },
	},
	{
		/*
		 * The pinned row's DRAG HANDLE (issue #697): the pair's own shape one control
		 * over - revealed by the pointer, `tabIndex={-1}`, and carrying
		 * `hover:bg-row-hover` guarded `!current`, because it sits inside a row's box
		 * exactly as the pair does. The grip is a SIBLING of the row's button, so the
		 * pointer can reach it without leaving the row, which is why the guard is the
		 * pointer's step rather than a new rule.
		 *
		 * Resolved FORWARD from the control's own attribute (the pair's shape again):
		 * the attribute precedes the `className` in the source, so a forward search
		 * lands on this control's expression and not on the one below it. `ground:
		 * false` for the pair's reason - the element that owns the ground is the ROW
		 * BOX, and this entry exists so the `!current` guard is exercised on a control
		 * that can sit inside a current row.
		 */
		what: "the pinned row's drag handle",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-session-pin-grip\n"),
		stubs: { current: true },
		ground: false,
		notCurrent: { current: false },
	},
	{
		/*
		 * The draft row's BOX, added with the sidebar's own discard act (operator,
		 * 2026-09-26: "Each one should have a deletion on hover"). Same shape and
		 * same reason as the conversation row's box above: `rowStyle`'s own `hover:`
		 * step fires only while the pointer is over the BUTTON, and the discard act
		 * is a SIBLING outside that button - so the box carries the row's hover step,
		 * guarded `!current` exactly like the conversation row's, and the row keeps
		 * its ground while the pointer is on the glyph. Resolved from the draft row's
		 * own attribute (the box is the nearest `className={cn(` before it).
		 *
		 * The section's `Clear all` foot carries a row-state step too and cannot sit
		 * inside a current row; it is accounted for in the count expectation below,
		 * the same door the bulk read receipt's sibling took.
		 */
		what: "the draft row's box",
		file: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, "data-draft-row={row.key}"),
		stubs: { revealArmed: true, rowBoxStyle, rowCurrent, current: true },
		ground: true,
		notCurrent: {
			revealArmed: true,
			rowBoxStyle,
			rowCurrent,
			current: false,
		},
	},
];

test("the current row's ground is a step off its panel, not a wash", () => {
	assert.ok(
		rowCurrent.includes("bg-row-selected"),
		`the current row's ground must be the role authored for it — \`rowSelected\`, the ROW STATE the row-state pass added: a step of the palette's OWN panel, at the panel's own hue, asserted at the file's field floor (ΔE00 2.0) off \`surface\` and ranked above \`rowHover\` (the role the rows around it now take under the pointer) on both \`L*\` and cast, with a 1.5-5.0 \`L*\` step in the direction the mode runs. Its own fill is a bigger step than the wash it replaced (\`accent-wash\`, ΔE00 1.05 on this panel's ground in tokyoNight), and on the selected row it is carried by that fill and by \`font-medium\` — the 2px \`accent\` bar was removed with the refinement round, because the fill now carries the ranking and the bar squared the row's leading edge. The floors, the rank and the direction are asserted in \`scripts/contrast-contract.mjs\`, which is where a colour can be measured. Got:\n${rowCurrent}`,
	);
	assert.ok(
		!rowCurrent.includes("bg-accent-wash"),
		`\`accent-wash\` is ΔE00 1.05 from the chat panel's ground in tokyoNight — the defect this row was reported for — and it is the TRANSIENT idiom (a pointer hover, and a keyboard-focused option in an open list) rather than a persistent "you are here". Got:\n${rowCurrent}`,
	);
	assert.ok(
		rowCurrent.includes("text-ink"),
		`the ground is a ground for text, and \`ink\` is the role whose 7:1 floor \`rowSelected\` is asserted on. Got:\n${rowCurrent}`,
	);
});

/*
 * THE MARK'S NON-COLOUR HALF, and why a ground is not enough.
 *
 * The ROW-STATE PASS REPLACED THE PREMISE OF THIS BLOCK rather than its finding.
 * It used to say that a ground alone cannot outrank the step the rows AROUND it
 * take under the pointer, because the ink floors cap how far the row's mark can
 * climb while the hover the neighbours carried — `elevated` — could not come down
 * to meet it: `elevated` is also every menu, popover and tooltip ground in the
 * app. That is exactly the bound the two new roles remove. The hover is
 * `rowHover`, its own role, and the selection is `rowSelected`, ranked above it on
 * both `L*` and cast. The order of the two marks is a contract now rather than a
 * coincidence of two values that happened to land the right way round.
 *
 * WHAT THE REFINEMENT ROUND CHANGED HERE is only WHICH half is non-colour. The
 * 2px `accent` BAR is gone (the operator asked for it; it also squared the row's
 * leading edge over `rowStyle`'s `rounded-md`), and the roles it ranked are no
 * longer two strengths of one hue: each is now a step of its own panel, ranked by
 * the fill. So the mark is the ground plus `font-medium` — the weight the settings
 * rail's active row already carried, and the WHOLE of the mark on the palette whose
 * panel has almost no cast (`obsidian`, C* 2.08, whose pair still separates by
 * ΔE00 3.18). What is asserted below is that the weight is still there, that a row
 * that is NOT current does not carry it, and that nothing in the mark moves the
 * row's box. An earlier round added a 1px `outline-control` boundary beside the
 * ground and it is RETIRED (design round 1, D3), because `border-control` is § 2's
 * *sole boundary of a control* and both rails drew it with the search field's own
 * ink, height and radius — the current row read as a filled field.
 *
 * `scripts/contrast-contract.mjs` asserts the floors, the DIRECTION of each step,
 * the two rank floors and the pair's separation; this file cannot see a colour at
 * all.
 */
test("a current row carries a non-colour step, and a row that is not current does not", () => {
	assert.ok(
		rowCurrent.includes("font-medium"),
		`the current row must carry a second signal beside its ground: the two row states are told apart by their fill, so colour alone leaves the reader without a non-colour mark to fall back on — on \`obsidian\` and on any palette whose panel has almost no cast, this weight IS the mark. Got:\n${rowCurrent}`,
	);
	for (const site of CURRENT.filter((entry) => entry.notCurrent)) {
		const inactive = merged(site.file, site.expression(), site.notCurrent);
		assert.ok(!inactive.split(/\s+/).includes("font-medium"));
	}
});

test("the current-row role is spelled once in the shipped tree, and imported everywhere else", () => {
	/*
	 * THE SINGLE SPELLING, ASSERTED RATHER THAN ASKED FOR. The pass-4 guard pinned the one
	 * copy it knew about and could not see the class at all; the fix is that there is no
	 * copy — the role is declared in the chat panel, which owns it, and imported by the
	 * settings rail. That is a convention until something reads it, so this reads the whole
	 * renderer: any class literal carrying all four of the role's terms is a second spelling,
	 * wherever it lands. The declaration itself has to be the ONLY match — that is the
	 * assertion, not `>= 1` — because a second one is how the frames came to show a row the
	 * app does not draw, twice.
	 *
	 * The import half is what keeps the consumers ON the symbol: a file that re-spells the
	 * terms fails above, and a file that quietly drops back to its own literal fails above
	 * too, but a file that never takes the role at all (deleting the ground is a visible
	 * change, not a silent one — the element loses it) has only this assertion. IT USED TO
	 * WATCH TWO FILES, the settings rail and the browser mark's story specimen; the specimen
	 * was deleted with the mark (operator ask, 2026-09-18), so the list below is one entry
	 * shorter rather than pointing at a file that is not in the tree.
	 *
	 * `scripts/` is deliberately outside the walk: `scripts/contrast-contract.mjs` quotes
	 * the declaration as a pin whose job is to FAIL when the role's terms change, so the
	 * palette half is re-measured. That is a different instrument from this one and both
	 * are wanted.
	 */
	const terms = rowCurrent.split(" ");
	const spelled = classLiteralsIn("src").filter(({ literal }) =>
		terms.every((term) => literal.split(" ").includes(term)),
	);
	assert.deepEqual(
		spelled,
		[{ file: SIDEBAR, literal: rowCurrent }],
		`the current-row role is spelled outside its one declaration. It is OWNED by ${SIDEBAR} and imported by selected-row consumers; a copy is what drifted twice (design rounds 3 and 4, D17 and D19), and a copy on a surface whose frames ship is a committed picture of a row the app does not draw. Delete the copy and import \`rowCurrent\` instead: ${JSON.stringify(spelled)}`,
	);
	/*
	 * THE DECLARATION ITSELF, which the four-term read above cannot see once a copy has
	 * drifted (a copy carrying ONE
	 * of the role's four terms is found only in the shapes a term-set search is
	 * least likely to take). A second declaration is the reintroduction in its most
	 * dangerous form — a local one SHADOWS the import, so the elements below still name
	 * `rowCurrent` and resolve, through this file's own stub, to the app's role: the row
	 * would paint something else and every assertion here would stay green while
	 * `pnpm check-types` was the only thing left to notice. There is one declaration, in
	 * the module that owns the role.
	 */
	const declarations = sourcesIn("src")
		.filter(({ source }) => /(?:const|let|var)\s+rowCurrent\s*=/.test(source))
		.map(({ file }) => file);
	assert.deepEqual(
		declarations,
		[SIDEBAR],
		`\`rowCurrent\` is declared in ${declarations.length} file(s) (${JSON.stringify(declarations)}) where the tree keeps ONE, in ${SIDEBAR}. A second declaration shadows the import it sits beside, so the row still reads the name and paints something else: import the symbol, do not declare it`,
	);
});

test("the entity row's name button paints the ground inside its wrapper, and no element is boxed twice", () => {
	/*
	 * The element round 1's MAJOR was about: a child's background paints over its
	 * parent's, so the name button has to carry the ground its wrapper paints. What
	 * it must NOT carry is a second boundary: with the row's `outline-control` ring
	 * retired (design round 1, D3) that is a guard on the whole panel rather than on
	 * one element — a `border-*` or `outline-*` structural role applied to a current
	 * row's box here would re-open the defect this file's sibling set of frames was
	 * re-shot for, which is a row that reads as a filled input.
	 */
	for (const site of CURRENT) {
		const classes = merged(site.file, site.expression(), site.stubs);
		for (const token of classes.split(" ")) {
			const structural =
				(token.startsWith("border-") &&
					!token.includes("border-transparent")) ||
				(token.startsWith("outline-") &&
					!token.startsWith("outline-offset") &&
					!token.includes("outline-none"));
			assert.ok(
				!structural || token.startsWith("focus-visible:"),
				`${site.what} now draws a structural boundary (\`${token}\`); the current row's mark is its ground plus its weight, and a boundary in \`border-control\`'s role is the search field's own line one row below it — design round 1, D3, is what retired it:\n${classes}`,
			);
		}
	}
	const nameButton = CURRENT.find(
		(site) => site.what === "the entity row's name button",
	);
	assert.notEqual(
		nameButton,
		undefined,
		"the entity row's name button is no longer in `CURRENT`",
	);
	const inner = merged(
		nameButton.file,
		nameButton.expression(),
		nameButton.stubs,
	);
	assert.ok(
		carriesGround(inner),
		`the entity row's name button no longer paints the current row's ground, so on the row whose pointer is somewhere else the mark is carried by the wrapper alone — and this element's own hover step is what then paints over it (round 1's MAJOR):\n${inner}`,
	);
});

test("the mark is colour plus weight, and neither one can move the row", () => {
	/*
	 * The guard on the CONSTANT. `bg-row-selected` and `font-medium` are both paint,
	 * and the row's box has to be untouched by the mark: the New chat row's own
	 * comment records that a 1px `border-control` there stepped its icon and label
	 * 1px out of line with the row above (the app is `box-sizing: border-box`), and
	 * the operator asked for that border to go. So no class in the mark may carry
	 * geometry, which is asserted on the tokens rather than described.
	 *
	 * THE ALLOWLIST IS GONE WITH THE BAR (refinement round). It existed for the 2px
	 * `accent` bar's `relative` containing block and its `before:inset-y-0` /
	 * `before:left-0` / `before:w-0.5` geometry, all of which read as geometry to the
	 * regex below and were geometry — of an absolutely positioned pseudo-element. The
	 * bar is removed, so the mark has no exception to make, and the guard is now the
	 * whole of what it always claimed: ANY token here that carries layout or box is a
	 * reflow waiting to happen.
	 */
	const GEOMETRY =
		/^-?(m|p|size|w|h|gap|border|inset|top|left|right|bottom|translate|scale)/;
	for (const token of rowCurrent.split(" ")) {
		assert.ok(
			!GEOMETRY.test(token.replace(/^[a-z-]+:/, "")),
			`\`${token}\` in the current row's mark is a layout or box class, so the mark can move the row in the current state only — the reflow the New chat row's own comment records as the reason its border was removed:\n${rowCurrent}`,
		);
	}
	assert.ok(
		!rowCurrent.includes("before:"),
		`the current row's mark carries a \`before:\` pseudo-element again: the 2px \`accent\` bar was removed by the refinement round because the fill ranks the pair itself, and with the bar went \`relative\` — a pseudo-element here would be positioned against whatever ancestor is positioned, off the row it marks:\n${rowCurrent}`,
	);
	assert.ok(
		!rowCurrent.includes("outline-control"),
		`the current row is drawn with a \`border-control\`-role boundary again; that role is § 2's *sole boundary of an input, select, checkbox or outlined button*, and the ring rendered as the search field one row below the list (design round 1, D3):\n${rowCurrent}`,
	);
});

test("the grouped current conversation keeps selection while its cursor is held", () => {
	const site = CURRENT.find(
		(entry) => entry.what === "the selected conversation",
	);
	assert.ok(site, "the selected conversation must remain in CURRENT");
	const idle = merged(site.file, site.expression(), site.stubs).split(/\s+/);
	assert.ok(idle.includes("cursor-grab"));
	const held = merged(site.file, site.expression(), {
		...site.stubs,
		rowTagDrag: { armedId: "synthetic-current-row" },
	}).split(/\s+/);
	assert.ok(held.includes("cursor-grabbing"));
	assert.ok(!held.includes("cursor-grab"));
	assert.ok(
		carriesGround(held),
		"the held cursor must not replace the current-row ground",
	);
});

test("every current-row element keeps the ground under the pointer", () => {
	for (const site of CURRENT) {
		const classes = merged(site.file, site.expression(), site.stubs);
		if (site.ground) {
			assert.ok(
				classes.includes("bg-row-selected"),
				`${site.what} paints no ground of its own while it is the current row:\n${classes}`,
			);
		}
		/*
		 * The assertion the entity-row MAJOR needed: an element with the hover
		 * step left on it paints OVER whichever ancestor holds the ground, so
		 * "the merged string contains `rowCurrent`" was never the property. This
		 * one fails if the step survives — a revert, a dropped `hover:` half, an
		 * `!staged` guard removed, or the arguments reordered.
		 */
		assert.ok(
			!classes.includes("hover:bg-row-hover"),
			`${site.what} paints the HOVER ground while it is the current row, so the pointer replaces the mark:\n${classes}`,
		);
	}
});

test("a row that is NOT current still gets the pointer's step", () => {
	/*
	 * The other side of the same property, without which the assertion above
	 * could pass by the hover step having been deleted everywhere: the two 24px
	 * controls and the settings rail's inactive rows keep it, and an inactive
	 * settings row does not carry the ground at all.
	 *
	 * Resolved from the SAME expression the assertion above uses, deliberately:
	 * reading a second anchor out of the same file is how this file first went
	 * green against the wrong element (the manage button's `className` sits
	 * BEFORE its `aria-label`, so a forward search found a later row's class).
	 */
	for (const site of CURRENT.filter((entry) => entry.notCurrent)) {
		const classes = merged(site.file, site.expression(), site.notCurrent);
		assert.ok(
			classes.includes("hover:bg-row-hover"),
			`${site.what} must keep the pointer's step while its row is NOT current:\n${classes}`,
		);
		assert.ok(
			!classes.includes("bg-row-selected"),
			`${site.what} must not carry the current-row ground while it is not current:\n${classes}`,
		);
	}
});

test("the file accounts for every hover ground the two panels declare", () => {
	/*
	 * The mechanism behind the file's headline claim, asserted instead of assumed.
	 * `CURRENT` names its elements by ANCHOR, so a NEW control inside a current row
	 * would be resolved by nobody — which is round 1's MAJOR class, one element
	 * over. Counting the `hover:bg-*` literals in each panel's source closes it:
	 * adding a control that answers the pointer with a ground turns this red until
	 * its expression is added above (or this expectation is extended with the
	 * reason it can never sit inside a current row).
	 *
	 * Comment-stripped, because the count is a fact about the code the browser
	 * gets — the same reason this file strips comments before reading any literal.
	 */
	const declared = new Map([
		[
			SIDEBAR,
			{
				// `rowStyle` (1), resolved through every expression that carries it; the two
				// 24px controls' `!staged` guards (2); the conversation row's pin control
				// (1), whose own guard is `!current` (its `CURRENT` entry above resolves
				// it); the disclosure HEADING row (1), which is never a current row —
				// it holds a section, and the panel marks the row the reader is IN, not
				// the heading above it; and the "Mark all N read" control (1), which is a
				// heading-row sibling too — a list-level action for a set the store owns,
				// never the row the reader is in, so no `CURRENT` entry can ever be asked
				// to resolve it.
				// ALL SIX rows' hovers are the row state now, so there is no
				// `hover:bg-elevated` left in this panel to account for: `elevated`
				// is a GROUND (it is every menu, popover, tooltip and dialog in the
				// app) and a row state is not a ground — that is the boundary the
				// two `row*` roles exist to draw, and the test below holds it for
				// every row surface in the tree. The pin control is the SIXTH because a
				// control inside a row takes the ROW's own hover step, exactly as the two
				// 24px controls beside it do: its ground is the row's state, not a menu's.
				//
				// The SEVENTH is the session row's ARCHIVE control, this branch's: a second
				// sibling inside the row's own box, revealed by opacity and answering the
				// pointer with the same `rowHover` step its neighbours take. It carries a
				// `!current` guard, so it is one of the elements `CURRENT` resolves - see its
				// entry above, which is also what keeps a new control inside a current row
				// from being seen by nobody.
				// SEVEN: the archive control added one more row-state step beside the pin,
				// the entity disclosure, its name button and the two row boxes. It takes
				// the ROW state (never a ground), which is what this expectation exists
				// to hold.
				// EIGHT: the archive control added one row-state step beside the pin, and the
				// shared control the pair used to shed into added the last one - WHICH IS NOW
				// GONE (design D9, `docs/design/sidebar-row-space.md`): the narrow band's single
				// shared menu was deleted with the shed that justified it, so the count comes
				// DOWN by one rather than being extended. Every element left takes the ROW
				// state, never a ground, which is what this expectation exists to hold.
				//
				// EIGHT (design round 2, D13): the ROW BOX itself carries the step, on the
				// wrapper `data-session-row` names. `rowStyle`'s `hover:` fires only while
				// the pointer is over the BUTTON, and the row's two sibling controls sit
				// inside the row's box and outside its button - so the ground used to
				// vanish the moment the pointer reached either glyph, under a pointer that
				// never left the row. This entry is the row's own box rather than a control
				// inside one, it is guarded by `!current`, and it therefore can never sit
				// inside a current row: the guard is what keeps the selected ground from
				// being repainted as the pointer's, which is this table's subject.
				// TWELVE (the sidebar band and the view popover, 2026-09-25). Four more
				// row-state steps arrived with the band's create menu and the two cap
				// controls: `data-sidebar-create-agent` and `data-sidebar-create-team`
				// (the two rows of the create popover), `data-sidebar-section-more` (the
				// Agents and Teams lists' cap foot) and `data-sidebar-page-more` (the
				// chats page's). None of the four can sit inside a current row, and that
				// is a structural fact rather than a promise: three are rows of a PORTAL
				// (the popover renders outside this panel's subtree) and the two feet are
				// siblings of the sections, never descendants of a row. They take the ROW
				// state rather than a ground, which is what this expectation exists to
				// hold - a foot that answered the pointer with `elevated` would be the
				// menu ground leaking into the list.
				// FOURTEEN (the sidebar's own draft rows, 2026-09-26). The draft row's
				// BOX carries the pointer's step (guarded `!current` - the `CURRENT`
				// entry above resolves it): the discard act is a sibling of the row's
				// button, so `rowStyle`'s own step stops at the button's edge and the
				// act's glyph would otherwise drop the row's ground under a pointer that
				// never left it. The section's `Clear all` foot carries one too, and it
				// can never sit inside a current row: it is a list-level action for the
				// whole drafts group, like the bulk read receipt's heading sibling. Both
				// take the ROW state rather than a ground.
				// SIXTEEN (issue #693, 2026-09-30). The pinned row's move pair added TWO
				// more, one per control: they are the row's own siblings, revealed by the
				// pointer, and both are resolved by their own `CURRENT` entries above -
				// the count is what forced those entries to exist rather than a promise
				// that somebody wrote them.
				// FIFTEEN (2026-09-30). The arrow pair is DELETED - its acts are the
				// two Move items in the row's menu now, and those are MENU rows: they
				// render in the menu's portal, take the menu's own highlight ground, and
				// can never sit inside the row that opened them. So the count comes back
				// DOWN by two, and the two `CURRENT` entries that resolved them went with
				// them: an entry is for a row SURFACE, which is the thing this table is a
				// list of.
				// SEVENTEEN (issue #697, 2026-09-30). The pin DRAG HANDLE adds one: it is the
				// pair's own shape one control over (revealed by the pointer, guarded
				// `!current`, resolved by its own `CURRENT` entry above), and it sits inside
				// a pinned row's box like every other control counted here.
				// SEVENTEEN AGAIN (PR #697's round-2 remediation, design D7 + UX U6): the
				// EIGHTEENTH literal round 1 added - `rowDraggingCurrent`'s hover half - is
				// GONE, and the held state no longer has a second fill at all. That constant
				// gave the held row the `row-hover` role while it was also the current one,
				// and that is the fill the row under the pointer wears, so two rows on screen
				// read alike (measured in both palettes). The held cue is now a 1px INSET
				// OUTLINE (`rowDraggingMark`), which is not a ground role and so is not counted
				// here - the ground underneath is the row's own, `rowDragging`'s selected
				// step, and that spelling is still the literal PLUS ONE below.
				// EIGHTEEN (the agents roster, issue #663): the entity row's pin control
				// takes the ROW state - its ground is `hover:bg-row-hover`, guarded
				// `!staged` - for the same reason the two 24px controls beside it do: it
				// is a control inside the row's box, so a menu ground would leak a
				// popover's surface into the list. Its own `CURRENT` entry above is what
				// keeps it from being resolved by nobody. The two narratives' numbers
				// MEET here rather than either replacing the other: #693/#697's
				// seventeen and this feature's one literal are additive, and the arrow
				// pair's deletion (FIFTEEN above) takes two of them away again -
				// 17 - 2 + 1 = SIXTEEN.
				"hover:bg-row-hover": 16,
				// `rowCurrent` (1), the ground that beats the step above by merge order.
				// PLUS ONE: the band's view-options button paints `row-selected` while the
				// view differs from the default (`viewIsCustom`) - the mode's own
				// "selected" meaning, and the filled pill the operator's reference draws.
				// It is a BAND control, so it is outside both regions and cannot be a
				// current row; the `CURRENT` table could never be asked to resolve it.
				// PLUS ONE (issue #697, agent review round 1, R1's neighbour D1): the
				// DRAGGED row's ground - `rowDragging`'s expression - restates `row-selected`
				// at the hover variant, for the reason measured on both the frames and a live
				// run: a bare `bg-row-selected` LOSES to the row box's own `hover:bg-row-hover`,
				// and the pointer that armed the drag never leaves the captured row, so the
				// dragged row painted exactly what a merely hovered row paints. The
				// restatement is `rowCurrent`'s own idiom one state over, and it is a CONSTANT
				// rather than a class in a JSX expression, so no `CURRENT` entry can resolve it
				// - the count is the honest place for it.
				"hover:bg-row-selected": 3,
				// ROUND 2's NINTH LITERAL returns this spelling to the file: the drafts
				// foot's `Clear all` stills its hover GROUND while inapplicable
				// (`aria-disabled:hover:bg-transparent!`, agent review round 2's R7 and
				// design round 2's D5 - a refused control must not take the pointer's
				// step). Like the "Mark all N read" control above, it is a list-level
				// foot for the drafts group and can never sit inside a current row; it
				// paints NOTHING here rather than taking a row state, which is why no
				// expression has to resolve it.
				// PLUS TWO (issue #693, re-pointed 2026-09-30): the two inapplicable-row
				// resets are the row MENU's Move items now - the arrow controls that used to
				// carry them are deleted. Same two literals, a different surface: a menu row
				// renders in the menu's portal, so it can never sit inside the current row
				// and no `CURRENT` entry can or should resolve it. The refusal still has to
				// LOOK like a refusal, which is why the pair is kept.
				// PLUS ONE (sidebar tags v3): the remote Tags… refusal carries the
				// same reset. It is a ContextMenuItem in the portalled row menu,
				// not an element inside a current conversation row; it cannot
				// override rowCurrent and needs no CURRENT-table expression.
				"hover:bg-transparent": 4,
				// The New chat row's disabled reset: it paints NOTHING, which is why no
				// expression has to resolve it. The bulk read receipt carries no reset of
				// its own: it is the shared `Button` primitive now, whose disabled styling
				// lives in that component, and its in-flight state is `aria-disabled`
				// THE `disabled:hover:bg-transparent` LITERAL IS NOT HERE ANY MORE: the
				// panel holds no disabled row since `New chat` moved to the rail's own
				// primary rows (§C1, design round 1, D1), and the only other disabled
				// control in the list is the mark-all-read receipt, which keeps its ring
				// stop and refuses the click rather than painting as disabled.
			},
		],
		[
			SETTINGS_RAIL,
			{
				// Both current and inactive settings destinations share this hover.
				// Their common idle ground is checked by settingsClasses below.
				"hover:bg-row-hover": 1,
			},
		],
	]);
	for (const [file, expected] of declared) {
		const found = {};
		for (const match of code.get(file).matchAll(/hover:bg-[a-z-]+/g)) {
			found[match[0]] = (found[match[0]] ?? 0) + 1;
		}
		assert.deepEqual(
			found,
			expected,
			`a \`hover:bg-*\` class in ${file} is not one this file accounts for: found ${JSON.stringify(found)} where it expects ${JSON.stringify(expected)}. Add the element's own class expression to the CURRENT table above if it can sit inside a current row, or extend this expectation and say why it cannot`,
		);
	}
});

test("the ground is passed AFTER the class string that carries the hover step", () => {
	/*
	 * The argument order is load-bearing and this is the assertion that says so:
	 * the element's own `rowStyle` carries `hover:bg-row-hover`, so an expression
	 * that passes the ground BEFORE it hands the last word on the hover state back
	 * to the step — which is the defect, restored by a reorder rather than by a
	 * deletion. `merged()` above catches that wherever the ground appears ONCE; at
	 * a site whose ground also appears inside its own predicate the duplicate is
	 * last and the merge is fine, which is exactly when the position has to be
	 * asserted instead of inferred.
	 */
	for (const site of CURRENT) {
		const expression = site.expression();
		const styleAt = expression.indexOf("rowStyle");
		const groundAt = expression.indexOf("rowCurrent");
		if (styleAt === -1 || groundAt === -1) continue;
		assert.ok(
			groundAt > styleAt,
			`${site.what} passes the ground BEFORE the class string that carries the hover step, so the pointer would get the last word on it:\n${expression}`,
		);
	}
});

test("the entity row's current-row predicate is the draft's own target", () => {
	const source = code.get(SIDEBAR);
	assert.ok(
		/const staged = draft\?\.target\?\.kind === kind && draft\.target\.name === name;/.test(
			source,
		),
		"the entity row no longer decides `staged` from the staged draft's kind and name, so the ground can land on an entity the reader is not in",
	);
});

test("the merge is load-bearing rather than incidental", () => {
	/*
	 * Stated so a later reader cannot "fix" this by deleting `hover:bg-row-selected`
	 * from the role: the raw concatenation the browser would see WITHOUT `cn` carries
	 * both rules, and `rowStyle`'s `hover:bg-row-hover` wins on cascade order.
	 */
	assert.ok(
		`${rowStyle} ${rowCurrent}`.includes("hover:bg-row-hover"),
		"the raw class strings no longer both carry a hover rule, so this test is no longer measuring tailwind-merge",
	);
});

test("no current-row class literal in either panel is on the wash", () => {
	for (const file of [SIDEBAR, SETTINGS_RAIL]) {
		const washes = [...code.get(file).matchAll(/"([^"\\]*(?:\\.[^"\\]*)*)"/g)]
			.map((match) => match[1])
			.filter((literal) => literal.includes("bg-accent-wash"));
		assert.deepEqual(
			washes,
			[],
			`a class literal in ${file} is back on the wash, which is invisible on \`surface\` (tokyoNight ΔE00 1.05) — and below the 2.0 field floor in seven of the fifty-nine palettes (worst
			catppuccinMacchiato 0.80, then tokyoNight 1.05): ${JSON.stringify(washes)}`,
		);
	}
});

test("the selected row's mark and its aria-current read the same terms", () => {
	const source = code.get(SIDEBAR);
	/*
	 * THE PREDICATE IS NAMED ONCE, AND THAT IS THE PROPERTY (review round 1, A7).
	 * It used to be written out at the wrapper, at the button and at the deleted
	 * browser mark — and the mark's own copy is what let it paint a hover step
	 * over the selected row's ground while the sidebar's comment claimed it dropped
	 * the fill there. `current` is now the one read, so this test asserts BOTH halves
	 * of the old property on the name: the declaration carries the two terms,
	 * `aria-current` and the row's ground both read the name — and every further
	 * element the row grows has to take it from here too, which the count below is
	 * what enforces.
	 *
	 * A row that paints a ground the accessibility tree does not claim misreports
	 * where the user is for a screen reader; one that claims a ground it does not
	 * paint does it for everyone else. Two spellings of the predicate is how the
	 * third element (the mark) came to disagree with both — and with the mark gone,
	 * the pair that remains is still the pair that can disagree.
	 */
	const declaration =
		"const current = selectedConversation === row.session_id && !activeDraftKey;";
	assert.ok(
		source.includes(declaration),
		`the session row's current-row predicate is no longer one named read, so the wrapper and the button can disagree about it:\n${declaration}`,
	);
	const ariaCurrent = 'aria-current={current ? "page" : undefined}';
	assert.ok(
		source.includes(ariaCurrent),
		`aria-current no longer reads the named predicate, so it and the row's ground can disagree:\n${ariaCurrent}`,
	);
	/*
	 * Three reads after the declaration: the wrapper's ground, the button's ground and
	 * `aria-current`. It was four while the mark was handed the same predicate as a prop;
	 * the floor stays at three because it is the two grounds and the accessibility claim,
	 * and a row that drops either half of that pair is the defect this case exists for.
	 * Asserted as a COUNT rather than by anchor, because the point is that nothing writes
	 * a second predicate.
	 */
	const reads =
		source
			.slice(source.indexOf(declaration))
			.match(/current &&|current=\{|current \?/g) ?? [];
	assert.ok(
		reads.length >= 3,
		`the named predicate feeds fewer than three elements (${reads.length}) — the wrapper's ground, the button's ground and \`aria-current\` — so one of them is deciding for itself:\n${JSON.stringify(reads)}`,
	);
});

/*
 * THE NAME RULE, held for every row surface in the tree.
 *
 * The row-state pass split one word's two jobs: a ROW's hover and selection are
 * the two `row*` states, and the four grounds (`canvas`, `surface`, `elevated`,
 * `sunken`) are grounds — `elevated` is every menu, popover, tooltip, dialog and
 * footer in the app, so it can neither be raised to meet a hover nor read as a
 * state. The boundary is stated in the roles' own doc in `palette-contract.ts`;
 * this is the half that can SEE a class, and it is the reason the rule is a fact
 * rather than a convention: on six of the forty-one dark themes the mark the old
 * idiom produced was weaker than the hover beside it (`obsidian` 2.02 against
 * 3.42), and no palette assertion can see which class a row paints.
 *
 * The list is the row surfaces, named per file so that a NEW row surface is an
 * edit here rather than a silent exemption. What is NOT in it, and why:
 *
 *   - `button.tsx`'s own `hover:bg-elevated` — a control primitive's state is
 *     that primitive's state, which the boundary states explicitly;
 *   - `browser-tab-strip`'s `group-hover:bg-elevated` — a container revealing its
 *     controls is not a row state, and the lookbehind below is what keeps it from
 *     being counted as one;
 *   - the transcript's disclosure rows (`tool-row`, `trace-line`, `ask-options`,
 *     `run-details`) — a ledger row is not one of a set of sibling rows with a
 *     selected counterpart, and the tool row's own states stay on the ladder by
 *     `palette-contract.ts`'s slot table.
 */
const ROW_SURFACES = [
	SIDEBAR,
	SETTINGS_RAIL,
	"src/renderer/src/features/settings/components/settings-group-header.tsx",
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	"src/renderer/src/shared/components/navigation/user-profile-sidebar.tsx",
	"src/renderer/src/features/agent-hub/components/agent-categories-sidebar.tsx",
	"src/renderer/src/features/agents/components/agents-sidebar.tsx",
	"src/renderer/src/features/agents/components/agents-page.tsx",
	"src/renderer/src/features/schedules/components/schedule-list-item.tsx",
	"src/renderer/src/features/schedules/components/wake-conversation-row.tsx",
	"src/renderer/src/features/chat/components/canvas/canvas-tabs.tsx",
	/*
	 * The canvas Files list's rows. They were absent from this list until design
	 * round 2 (D11) found `hover:bg-elevated` on them - the guard passed because a
	 * new surface is not enumerated by default, which is the silent exemption this
	 * list exists to prevent. The row now takes `hover:bg-row-hover`, and it names
	 * `rowCurrent` by import (the sibling test above), so it belongs here.
	 */
	"src/renderer/src/features/chat/components/canvas/file-row.tsx",
	"src/renderer/src/features/browser/components/browser-tab-strip.tsx",
	"src/renderer/src/features/providers/provider-grid.tsx",
];

test("no row surface in the tree hovers or selects on a ground role", () => {
	const sources = new Map(
		sourcesIn("src").map(({ file, source }) => [file, source]),
	);
	/*
	 * The lookbehind is the whole of the discrimination: `group-hover:` and
	 * `@max-2xl:group-hover:` are a container revealing its controls, and they
	 * CONTAIN the string this looks for.
	 */
	const GROUND_STATE =
		/(?<![\w-])(?:hover|active):bg-(?:canvas|surface|elevated|sunken)\b/g;
	const offenders = [];
	for (const file of ROW_SURFACES) {
		const source = sources.get(file);
		assert.notEqual(
			source,
			undefined,
			`${file} is gone; the row-surface list is stale`,
		);
		for (const match of source.matchAll(GROUND_STATE)) {
			offenders.push(`${file}: ${match[0]}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`a row surface paints a GROUND as its hover or selection: ${JSON.stringify(offenders)}. A row state is one of the two \`row*\` roles (\`hover:bg-row-hover\`, \`bg-row-selected\`), which is what the operator's "the sidebar hover is much too subtle" is answered with; a ground cannot do the job, because \`elevated\` is also every menu, popover, tooltip and dialog in the app. If the element really is a control primitive's own state rather than a row's, take it off this list and say why here.`,
	);
});

/*
 * And the other half of the same rule: the two role names are painted through the
 * ONE declaration of the selected-row mark. Every selected row in the app takes
 * `rowCurrent` — the chat list, the app rail, both agent
 * rosters and the categories sidebar — so a surface that spells its own
 * `bg-row-selected` is a second copy of the role, which is what drifted twice
 * (design rounds 3 and 4, D17/D19) and what the single-spelling test above
 * already reads out of the tree. This asserts the IMPORT rather than the absence,
 * because a surface that simply drops the mark loses the capability silently.
 */
test("every selected row in the tree takes the role by import, not by copy", () => {
	const sources = sourcesIn("src");
	const declared = sources.filter(({ source }) =>
		/(?:const|let|var)\s+rowCurrent\s*=/.test(source),
	);
	assert.deepEqual(
		declared.map(({ file }) => file),
		[SIDEBAR],
		`\`rowCurrent\` is declared in ${declared.length} file(s) (${JSON.stringify(declared.map(({ file }) => file))}) where the tree keeps ONE, in ${SIDEBAR}`,
	);
	/*
	 * The owner is excluded: it is where the declaration lives, so it names the
	 * symbol without importing it. Every OTHER surface that names the role has to
	 * be importing it, or it is painting something else while reading the name.
	 */
	const byFile = new Map(sources.map(({ file, source }) => [file, source]));
	const missing = ROW_SURFACES.filter((file) => {
		if (file === SIDEBAR) return false;
		const source = byFile.get(file);
		if (source === undefined || !source.includes("rowCurrent")) return false;
		return !source.includes("import { rowCurrent } from");
	});
	assert.deepEqual(
		missing,
		[],
		`a row surface names \`rowCurrent\` without importing it, so it is using a local or a copy: ${JSON.stringify(missing)}`,
	);
});

/*
 * ============================================================================
 * THE GROUND A ROW STATE IS PAINTED ON.
 *
 * Both roles are authored as a step of the palette's own `surface`
 * (`docs/design/row-states-refinement.md` § 4): `rowSelected` and `rowHover` are
 * measured AGAINST `surface`, which is the plane a row is drawn on. So a surface
 * that paints either role has to WEAR `surface` — and that is an invariant of the
 * app, not something a palette can be re-solved for. Re-asserting the roles
 * against the rungs was measured and refused: on the light fleet the largest
 * ink-legal fill reaches ΔE00 1.73-2.81 against `canvas`, and clearing `sunken`
 * forces `alucard`'s selection to a 2.36 `L*` step, under the pair's own floors.
 *
 * THE DEFECT THIS EXISTS FOR, because it shipped green and no instrument in the
 * tree could see it: the app rail's own `<nav>` was `bg-sunken` and the agent-hub
 * categories rail's column painted nothing at all, so both lists were painted on
 * a rung. Measured on the shipped values: the current row's fill sat ΔE00 0.44
 * off the rail on `alucard` (7 of the 59 palettes under the contract's own 2.0
 * field floor) and 0.83 off `canvas` on `kanagawaLotus`, and on 13 of the 59 the
 * row under the POINTER read at least as far off the rail's ground as the row the
 * reader was ON — the defect `sidebar-navigation.tsx`'s own comment records
 * fixing once before, reintroduced by the ground rather than by the mark. Both
 * surfaces were re-grounded (the rail taking `border-r border-hairline` for the
 * boundary its `sunken` step used to carry) and this table asserts the result.
 *
 * IT IS A TABLE OF CALL SITES, so a NEW one fails here rather than shipping: the
 * completeness assertion below reads the whole tree for the role and requires
 * every file that paints it to be named, and each entry resolves BOTH halves
 * through the shipped `cn` — the row must still take a row role, and the element
 * that paints the ground must resolve to `surface` and to no rung.
 *
 * WHAT IT DOES NOT CATCH, stated rather than implied, because a guard read as
 * broader than it is is worse than a narrow one: the ground is asserted per
 * NAMED SURFACE (per file), not re-derived per element. A new call site added
 * inside a file that is already named — on a rung, while that file's own named
 * ground still resolves to `surface` — passes this file. That shape was probed
 * and it does pass, and what catches it instead is review plus the entry's own
 * row selector: an element on a rung inside one of these files is a change to
 * the surface the entry already describes. The shapes this DOES fail are the two
 * defects that shipped on this branch (either named ground moved back onto a
 * rung) and a NEW surface painting the role at all (the completeness assertion,
 * whichever ground it is on) — all three probed, in a scratch copy of the tree,
 * with the failures quoted in the round's remediation comment.
 *
 * THE RAIL'S TWO TIGHTEST PAIRS, for the reader who wonders whether `surface` is
 * still chrome on the light fleet: this rail's ground against the `canvas` beside
 * it measures ΔE00 2.32 on `localOperatorLight` and 2.60 on `alucard` — the two
 * tightest of the FOUR RAIL PALETTES this evidence set renders — and the hairline
 * is the only boundary on both. They are not the fleet's tightest pairs, and the
 * sentence that said so was wrong: `surface` against `canvas` measures 2.05 on
 * `sage`, 2.08 on `catppuccinMacchiato` and 2.10 on `oneLight` (`localOperatorLight`
 * is ninth at 2.32, `alucard` twenty-third at 2.60), and none of those three
 * carries a rail frame. The fleet-wide discipline is asserted in
 * `scripts/contrast-contract.mjs`; this pair is the worst case the frames can show. The rail's ⌘K cap is FILL-LESS (it carries no fill and no
 * border by construction — `shared/components/common/keyboard-shortcut.tsx`,
 * `CAP`), so the re-grounding cannot collapse a key into it; the evidence README
 * records that as a DOM readback beside the rail's frames rather than as a claim.
 * ============================================================================
 */

const APP_RAIL =
	"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx";
const CATEGORIES_RAIL =
	"src/renderer/src/features/agent-hub/components/agent-categories-sidebar.tsx";
const CATEGORIES_COLUMN =
	"src/renderer/src/features/agent-hub/agent-hub-page.tsx";
const AGENTS_SIDEBAR =
	"src/renderer/src/features/agents/components/agents-sidebar.tsx";
const AGENTS_PAGE =
	"src/renderer/src/features/agents/components/agents-page.tsx";
const SKILLS_LIBRARY =
	"src/renderer/src/features/agents/components/skills-library.tsx";
const CANVAS_SECTION =
	"src/renderer/src/features/chat/components/canvas/index.tsx";
const FILE_ROW =
	"src/renderer/src/features/chat/components/canvas/file-row.tsx";
/* The Files-family plane moved with its scroller into Finder. The pane root in
 * CANVAS_SECTION still stands at the lane's last stop, not the rows' surface. */
const FINDER_FILES_VIEW =
	"src/renderer/src/features/chat/components/canvas/finder-files-view.tsx";
const SCHEDULE_ROW =
	"src/renderer/src/features/schedules/components/schedule-list-item.tsx";
const BROWSER_TABS =
	"src/renderer/src/features/browser/components/browser-tab-strip.tsx";
const HUB_LINK_MARK =
	"src/renderer/src/features/chat/components/hub-link-sidebar-mark.tsx";
const PROJECT_TIMELINE =
	"src/renderer/src/features/projects/components/project-timeline.tsx";

/*
 * The regex metacharacters an anchor may carry, and the literal spaces that stand
 * for a run of whitespace inside one. Module scope for `useTopLevelRegex`; both feed
 * the anchor pattern `literalClassAt` builds per call, which is where the anchor's
 * own policy is stated.
 */
const REGEX_META = /[.*+?^${}()|[\]\\]/g;
const ANCHOR_SPACE = / /g;

/** The comment-stripped source of a file, cached the way the two above are. */
/*
 * A plain `className="..."` literal, addressed by a nearby anchor and a
 * direction. The ground elements in this table are containers rather than the
 * rows themselves, and a container is where a call site's own expression cannot
 * reach: the row resolves what IT paints, and this resolves what it is painted
 * ON. It reads the file rather than a string written here, which is the whole
 * point of the table.
 */
const literalClassAt = (file, anchor, where) => {
	const source = sourceOf(file);
	/*
	 * THE ANCHOR IS READ AS WHITESPACE, NOT AS BYTES (review round 1, B1). `<aside `
	 * was an `indexOf`, and this repository's formatter is free to break a line after
	 * a tag name — it did, in the very change this guard rode in on — at which point
	 * the scan reported "no element" for an element that was still there, still the
	 * one ground this table reads. Every literal space in an anchor now matches any
	 * whitespace (a newline, and the indent after it), so the guard cannot fail for a
	 * reason that is the formatter's rather than the ground's. Nothing else is
	 * relaxed: the anchor's tokens are still required verbatim, so a renamed or
	 * rewritten element still fails by name, and the className read below still walks
	 * the same window from the same element.
	 */
	const at = source.search(
		new RegExp(
			anchor.replace(REGEX_META, "\\$&").replace(ANCHOR_SPACE, "\\s+"),
		),
	);
	assert.notEqual(
		at,
		-1,
		`no element in ${file} matches ${JSON.stringify(anchor)}`,
	);
	const window =
		where === "before" ? source.slice(0, at) : source.slice(at, at + 2000);
	const matches = [...window.matchAll(/className="([^"]*)"/g)];
	assert.notEqual(
		matches.length,
		0,
		`the element at ${JSON.stringify(anchor)} in ${file} carries no plain className literal, so this file cannot read the ground a row state is painted on`,
	);
	return matches[where === "before" ? matches.length - 1 : 0][1];
};

const ROW_STATE_GROUNDS = [
	{
		what: "the chat sidebar's list panel",
		rowFile: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, '"min-w-0 grow text-start"'),
		stubs: {
			rowStyle,
			rowCurrent,
			nested: false,
			current: true,
			tagDraggable: true,
			rowTagDrag: { armedId: null },
			row: { session_id: "synthetic-current-row" },
		},
		ground: () =>
			literalClassAt(
				SIDEBAR,
				'aria-label={t("ui.chat.sidebar.nav.chats")}',
				"after",
			),
		groundFile: SIDEBAR,
	},
	{
		/*
		 * THE SURFACE THIS TABLE WAS WRITTEN FOR. Its `<nav>` was `bg-sunken` and
		 * the ground now has to come from the row's own element's ANCESTOR, which is
		 * why this one entry resolves a `cn(...)` rather than a literal: the rail's
		 * class list is built from `expanded` and the two width constants.
		 */
		what: "the one sidebar (the surface that is not the row's own)",
		rowFile: APP_RAIL,
		/*
		 * THE ROW MOVED, and the anchor moved with it. It used to be the
		 * destination's own `<button>`; since the rail and the chat list were merged
		 * into one column the row is the `<li>` that holds it, because `Agents`
		 * carries a disclosure button BESIDE the destination's own press - and a
		 * button inside a button is invalid HTML no browser delivers a press to. The
		 * state is therefore painted on the box both controls sit in, which is the
		 * only element that can carry it for the pair.
		 */
		expression: () => expressionBefore(APP_RAIL, "rowState,"),
		/*
		 * THE HELD BRANCH IS PART OF THE SAME EXPRESSION (sidebar customisation,
		 * design D2): a row being dragged wears `rowDragging` plus
		 * `rowDraggingMark` on the same `<li>`, so the call site paints one of the
		 * row roles in either state and both are resolved here.
		 */
		stubs: {
			expanded: true,
			rowState: rowCurrent,
			held: true,
			rowDragging,
			rowDraggingMark,
		},
		ground: () =>
			literalClassAt(
				APP_RAIL,
				"flex h-10 shrink-0 items-center gap-1 pe-2 ps-4",
				"before",
			),
		groundFile: APP_RAIL,
	},
	{
		/*
		 * The ground is in ANOTHER FILE, and it is on the column rather than on this
		 * component: `agent-hub-page.tsx`'s tour-tagged div. The design record this
		 * change carries names `agent-hub-page.tsx:133` as the page's ground, and
		 * that line is `AgentCardSkeleton`'s CARD — the page root carries no ground
		 * at all, and the rows' painted ancestor is this column.
		 */
		what: "the agent-hub categories rail",
		rowFile: CATEGORIES_RAIL,
		expression: () =>
			expressionAfter(CATEGORIES_RAIL, "aria-pressed={selected}"),
		stubs: { selected: true, rowCurrent },
		ground: () =>
			literalClassAt(
				CATEGORIES_COLUMN,
				'data-tour-tag="agent-hub-sidebar-container"',
				"before",
			),
		groundFile: CATEGORIES_COLUMN,
	},
	{
		what: "the agents sidebar",
		rowFile: AGENTS_SIDEBAR,
		expression: () =>
			expressionAfter(AGENTS_SIDEBAR, 'data-tour-tag="agent-list-item-button"'),
		stubs: { isSelected: true, rowCurrent },
		ground: () => literalClassAt(AGENTS_SIDEBAR, "<SidebarHeader", "before"),
		groundFile: AGENTS_SIDEBAR,
	},
	{
		/*
		 * The Team Bridge rail's conversation rows (and, by the same `selected ?
		 * rowCurrent` shape, its person and chief-of-staff rows). The rows live in
		 * the rail module and the ground on the page's `<aside>`, which is why the
		 * ground is read from a different file than the row. Design round 1 (D2)
		 * measured the selected row at 1.06:1 on `paper` while the aside had no
		 * ground of its own; this entry is what keeps it on `surface`.
		 */
		what: "the Team Bridge rail",
		rowFile: TEAM_BRIDGE_RAIL,
		expression: () =>
			expressionAfter(
				TEAM_BRIDGE_RAIL,
				"data-conversation-id={conversation.id}",
			),
		stubs: {
			RAIL_ROW,
			selected: true,
			unread: 0,
			organizationName: "",
			rowCurrent,
		},
		ground: () =>
			literalClassAt(
				TEAM_BRIDGE_PAGE,
				'data-glass-region="page-sidebar"',
				"after",
			),
		groundFile: TEAM_BRIDGE_PAGE,
	},
	{
		/*
		 * The Team Bridge page's own "Archived channels" entry (design round 1, D3).
		 * It sits in the same `<aside>` as the rail's rows, so it is asserted on the
		 * same ground: the selected fill is a step of `surface`, and the entry is the
		 * one place on this page that paints the role outside the rail module.
		 */
		what: "the Team Bridge page's Archived channels entry",
		rowFile: TEAM_BRIDGE_PAGE,
		expression: () => expressionBefore(TEAM_BRIDGE_PAGE, "? rowCurrent"),
		stubs: { quickView: "archived", rowCurrent },
		ground: () =>
			literalClassAt(
				TEAM_BRIDGE_PAGE,
				'data-glass-region="page-sidebar"',
				"after",
			),
		groundFile: TEAM_BRIDGE_PAGE,
	},
	{
		what: "the agents page's roster row",
		rowFile: AGENTS_PAGE,
		expression: () =>
			expressionBefore(AGENTS_PAGE, "row.name === name && rowCurrent"),
		stubs: { row: { name: "agent" }, name: "agent", rowCurrent },
		ground: () => literalClassAt(AGENTS_PAGE, "<aside ", "after"),
		groundFile: AGENTS_PAGE,
	},
	{
		/*
		 * THE SKILLS TAB'S ROW (#1443). It is a sibling of the agents roster row
		 * above: the same selected-row role, painted in the roster scroller that sits
		 * inside the page's one `<aside>`, so the ground is the SAME element and the
		 * contrast numbers the design review measured for the Agents roster hold here
		 * too. The row lives in its own module and the ground in the page, hence two
		 * files. `card.name === selected` is the row's own predicate (a skill's name is
		 * its identity), stubbed true so the role is resolved as painted.
		 */
		what: "the agents page's Skills roster row",
		rowFile: SKILLS_LIBRARY,
		expression: () =>
			expressionBefore(SKILLS_LIBRARY, "card.name === selected && rowCurrent"),
		stubs: { card: { name: "skill" }, selected: "skill", rowCurrent },
		ground: () => literalClassAt(AGENTS_PAGE, "<aside ", "after"),
		groundFile: AGENTS_PAGE,
	},
	{
		/* The retained FileRowItem module still names/paints rowCurrent, so the
		 * tree census must not silently exempt it. It has no current runtime
		 * importer: this entry preserves its row-style contract against the
		 * Files family's actual plane, NOT a claim that Finder mounts this legacy
		 * renderer. The live Finder row has its own independent entry below.
		 * canvas-file-viewer now delegates to Finder and owns no scroller. */
		what: "the retained legacy canvas row contract",
		rowFile: FILE_ROW,
		expression: () => expressionBefore(FILE_ROW, 'data-tour-tag="file-row"'),
		stubs: { rowCurrent, current: true },
		ground: () =>
			merged(
				FINDER_FILES_VIEW,
				expressionAfter(FINDER_FILES_VIEW, 'data-tour-tag="files-scroller"'),
				{},
			),
		groundFile: FINDER_FILES_VIEW,
	},
	{
		/* Finder has its own rowCurrent caller, separate from the fallback's
		 * FILE_ROW. The tree-wide census must name both; adding this entry does
		 * not exempt the new caller. Resolve its shipped row and scroller cn
		 * expressions so moving Finder onto an elevation rung still fails. */
		what: "the Finder Files list",
		rowFile: FINDER_FILES_VIEW,
		expression: () =>
			expressionBefore(FINDER_FILES_VIEW, 'data-tour-tag="file-row"'),
		stubs: { rowCurrent, current: true },
		ground: () =>
			merged(
				FINDER_FILES_VIEW,
				expressionAfter(FINDER_FILES_VIEW, 'data-tour-tag="files-scroller"'),
				{},
			),
		groundFile: FINDER_FILES_VIEW,
	},
	/* card: its own ground; tailwind-merge drops the resting bg-surface once
	 * bg-row-selected follows it, so read the ground with the role stubbed out */
	{
		what: "the Library asset card",
		rowFile: LIBRARY_CARD,
		expression: () => expressionAfter(LIBRARY_CARD, "export const LibraryCard"),
		stubs: { selected: true, rowCurrent },
		ground: () =>
			merged(
				LIBRARY_CARD,
				expressionAfter(LIBRARY_CARD, "export const LibraryCard"),
				{ selected: true, rowCurrent: "" },
			),
		groundFile: LIBRARY_CARD,
	},
	/* list row: same file, second call site */
	{
		what: "the Library asset list row",
		rowFile: LIBRARY_CARD,
		expression: () =>
			expressionAfterWithin(
				LIBRARY_CARD,
				"export const LibraryRow",
				"data-library-card-id",
			),
		stubs: { selected: true, rowCurrent },
		ground: () =>
			merged(
				LIBRARY_CARD,
				expressionAfterWithin(
					LIBRARY_CARD,
					"export const LibraryRow",
					"data-library-card-id",
				),
				{ selected: true, rowCurrent: "" },
			),
		groundFile: LIBRARY_CARD,
	},
	/* rail: rows are painted on the page-sidebar aside, which owns bg-surface */
	{
		what: "the Library filter rail",
		rowFile: LIBRARY_FILTER_RAIL,
		expression: () => expressionAfter(LIBRARY_FILTER_RAIL, "const RailRow"),
		stubs: { active: true, indent: false, rowCurrent },
		ground: () =>
			literalClassAt(LIBRARY_PAGE, 'data-glass-region="page-sidebar"', "after"),
		groundFile: LIBRARY_PAGE,
	},
	{
		/* THE SECOND MOUNT. The same rail is rendered inside the mobile filter
		 * Sheet, whose shared shell is `bg-elevated`; rows must not be painted on
		 * it. The content wrapper inside that shell owns `bg-surface`, so the
		 * mobile mount gets its own ground assertion rather than inheriting the
		 * desktop aside's. */
		what: "the Library filter rail inside the mobile sheet",
		rowFile: LIBRARY_FILTER_RAIL,
		expression: () => expressionAfter(LIBRARY_FILTER_RAIL, "const RailRow"),
		stubs: { active: true, indent: false, rowCurrent },
		ground: () =>
			literalClassAt(LIBRARY_PAGE, 'data-library-filter-sheet=""', "after"),
		groundFile: LIBRARY_PAGE,
	},
];

/* Every grounding class a row state may NOT be painted on. `elevated` is in the
   list even though the withdrawal keeps its exemption: the exemption is about a
   dialog's ground or an input well, and no row is painted on one — a row painted
   on `elevated` is a row on a menu. */
const RUNGS = ["bg-canvas", "bg-elevated", "bg-sunken"];

test("every call site that paints a row state is painted on `surface`", () => {
	/*
	 * Completeness first, and it is over the TREE: every file that paints
	 * `rowCurrent` has to be named above, so a new call site is an edit to this
	 * table rather than a silent exemption. `rowCurrent` in a file that only
	 * MENTIONS the symbol (a docstring, a comment) is not a call site — the
	 * comment-stripped read is what makes that distinction, and the two are worth
	 * separating: `file-row.tsx` names it in prose as well as painting it.
	 */
	const painters = sourcesIn("src")
		.filter(({ source }) => /rowCurrent/.test(source))
		.map(({ file }) => file)
		.sort();
	const named = [...new Set(ROW_STATE_GROUNDS.map((e) => e.rowFile))].sort();
	assert.deepEqual(
		painters,
		named,
		`${painters.length} file(s) in the tree paint or name \`rowCurrent\` and ${named.length} are named in ROW_STATE_GROUNDS. A surface that paints the role has to have its ground asserted here; one that only names it in prose belongs in neither list, which is why the read excludes comments: ${JSON.stringify(painters)} vs ${JSON.stringify(named)}`,
	);

	assert.equal(
		SIDEBAR_COPY["ui.chat.sidebar.nav.chats"],
		"Chats",
		"the sidebar's nav announces something other than `Chats`; the ground below is read from the element that name finds",
	);

	for (const entry of ROW_STATE_GROUNDS) {
		const row = merged(entry.rowFile, entry.expression(), entry.stubs);
		assert.ok(
			carriesGround(row.split(/\s+/)),
			`${entry.what}: the row's own expression no longer resolves to a row role. Got:\n${row}`,
		);
		const classes = entry
			.ground()
			.split(/\s+/)
			.filter((c) => c.length > 0);
		assert.ok(
			classes.includes("bg-surface"),
			`${entry.what}: the ground a row state is painted on resolves to ${JSON.stringify(classes)}, not to \`bg-surface\`. Both row roles are steps of the palette's own \`surface\`, so a surface that paints them has to BE \`surface\` — on a rung the fill lands inside the ladder instead of out of the panel (measured: ΔE00 0.44 on \`alucard\` for the app rail, 0.83 on \`kanagawaLotus\` for the categories rail). See the ground note at the head of this block.`,
		);
		const rung = RUNGS.find((r) => classes.includes(r));
		assert.equal(
			rung,
			undefined,
			`${entry.what}: the ground is \`${rung}\`, a rung of the elevation ladder. A row state is authored against \`surface\` and the withdrawal's exemption is for \`elevated\` as a DIALOG's ground, not for a row painted on one. Got:\n${classes.join(" ")}`,
		);
		/* The file the ground was read from has to be the one named, so a reader
		   chasing a failure lands in the right place. */
		assert.ok(
			typeof entry.groundFile === "string" && entry.groundFile.length > 0,
			`${entry.what}: no ground file named`,
		);
	}
});

/*
 * THE OTHER HALF OF THE RAIL'S GROUND, and the half the nav pin above cannot see
 * (review round 1, R1-1). `settings-sidebar.tsx`'s ground note promises that a
 * future re-grounding - "or a list re-acquiring a ground of its own" - fails by
 * name. The entry above resolves the NAV, the element the rows are painted on,
 * so restoring the group lists' old `bg-surface` leaves every assertion in the
 * grounds table green: the nav is `surface` either way. What regresses is the
 * rail's appearance - the lists become the mismatched blocks the operator
 * reported - and that is a fact about a class on an element no entry reads.
 *
 * So the list is read directly and the ABSENCE is what is asserted: the rail's
 * one `<ul>` carries layout classes and no ground role at all. `SECTION_GROUPS.map`
 * renders one list per group from ONE source literal, and the anchor is the tag
 * itself, so the read lands on the list's own class literal (the same walk
 * `literalClassAt` does for every other ground in this file, pointed at an
 * element that is deliberately NOT one).
 *
 * FALSIFIED BEFORE IT WAS TRUSTED: putting the list back on
 * `cn("flex flex-col gap-0.5 bg-surface")` fails this test and nothing else in
 * either suite.
 */
/* Settings destinations intentionally differ from selected conversations: the
 * operator requested one resting surface even on the current section. Resolve
 * the shipped cn expression in both layouts, not a replica of its class list. */
const settingsClasses = (isActive, labelled) =>
	merged(
		SETTINGS_RAIL,
		expressionAfter(
			SETTINGS_RAIL,
			'aria-current={isActive ? "page" : undefined}',
		),
		{ isActive, labelled, rowCurrent },
	).split(/\s+/);

test("settings destinations share a resting ground and hover in both layouts", () => {
	assert.equal(
		JSON.parse(read("src/i18n/catalogues/en/ui.settings.navigation.json"))[
			"ui.settings.navigation.settings_sidebar.settings_sections"
		],
		"Settings sections",
	);
	assert.ok(
		// Anchor the translated accessible name, not its former inline English.
		literalClassAt(
			SETTINGS_RAIL,
			'aria-label={t( "ui.settings.navigation.settings_sidebar.settings_sections", )}',
			"after",
		)
			.split(/\s+/)
			.includes("bg-surface"),
	);
	for (const labelled of [true, false]) {
		for (const isActive of [true, false]) {
			const classes = settingsClasses(isActive, labelled);
			assert.deepEqual(
				classes.filter((token) => token.startsWith("bg-")),
				["bg-transparent"],
				`settings current=${isActive} labelled=${labelled} must reveal the rail's own ground`,
			);
			assert.ok(classes.includes("hover:bg-row-hover"));
			assert.equal(classes.includes("font-semibold"), isActive);
			assert.ok(!classes.some((token) => /^(border|shadow)-/.test(token)));
		}
	}
	assert.ok(!code.get(SETTINGS_RAIL).includes("rowCurrent"));
});

test("settings current-page cue occupies the gutter without changing accessible names", () => {
	const rail = sourceOf(SETTINGS_RAIL);
	assert.match(rail, /aria-current=\{isActive \? "page" : undefined\}/);
	assert.match(rail, /aria-label=\{labelled \? undefined : section\.label\}/);
	assert.match(
		rail,
		/isActive && \(\s*<span\s+aria-hidden="true"\s+className="absolute start-1 top-1\/2 size-1 -translate-y-1\/2 rounded-full bg-accent"/,
	);
	assert.match(rail, /isActive \? "text-accent" : "text-ink-dim"/);
	assert.match(rail, /<Tooltip content=\{section\.label\} side="right">/);
});

test("the settings rail's group lists carry no ground of their own", () => {
	const classes = literalClassAt(SETTINGS_RAIL, "<ul", "after")
		.split(/\s+/)
		.filter((c) => c.length > 0);
	const ground = GROUND_ROLES.find((role) => classes.includes(role));
	assert.equal(
		ground,
		undefined,
		`the settings rail's group list carries \`${ground}\` again: ${JSON.stringify(classes)}. The rail is a flat \`surface\` and its rows sit directly on the rail's own ground, so a list with a tone of its own is the mismatched-block defect the operator reported on 2026-09-30. A ground belongs on the nav, not on a list inside it - see the ground note in settings-sidebar.tsx.`,
	);
});

/*
 * THE PLATE INSIDE A ROW, AND THE HALF THE PALETTE GATE CANNOT SEE.
 *
 * The rail's account row is a row state's host (`hover:bg-row-hover`) and it
 * contains an element with a ground of its own — the avatar plate. A row state is
 * authored as a STEP of the panel it sits on, so on some palette it lands on some
 * rung: `elevated` against `rowHover` is byte-identical on `arcade` (ΔE00 0.00),
 * which is why this plate used to wear `bg-elevated` plus a `border-control` ring.
 *
 * BORDERLESS SINCE THE OWN-AVATAR CHANGE (design review round 1, D1/D2). The
 * operator asked for borderless, rounded-square avatars, and the ring dropped
 * away visibly the moment the photo landed. The plate now wears Team Bridge's
 * `media-surface` fill, which is not a rung: `scripts/contrast-contract.mjs`
 * measures it per palette against `surface` and `rowHover` (`team bridge
 * borderless person and agent plates`) with `inkMuted` initials on it (`team
 * bridge person initial plate`). What THIS test pins is the half that gate cannot
 * see: the class text still names that fill on both the root (a transparent photo
 * keeps the backing) and the fallback, in Team Bridge's `rounded-md` shape, with
 * no edge.
 *
 * The pair is `rowHover` and NOT `rowSelected`, and that scope is asserted below
 * rather than implied: `media-surface` bottoms out at ΔE00 1.83 against
 * `rowSelected`, so if the account row ever paints `rowCurrent` the plate needs
 * the selected-row step Team Bridge's rail takes (`surface`).
 */
const ACCOUNT_ROW =
	"src/renderer/src/shared/components/navigation/user-profile-sidebar.tsx";
const TEAM_BRIDGE_MESSAGES =
	"src/renderer/src/features/team-bridge/team-bridge-message-list.tsx";
const TEAM_BRIDGE_COMPOSE =
	"src/renderer/src/features/team-bridge/team-bridge-compose-bar.tsx";
const TEAM_BUBBLE =
	"src/renderer/src/features/chat/components/team-avatar-bubble.tsx";

/**
 * The mark's face, as the module writes it: the badge's own exported call with
 * the quiet-count triple. A PATTERN rather than a byte string so the formatter
 * may break the arguments across lines without failing this assertion - the
 * property is "composes the shared register", not "spells it on one line".
 */
const TEAM_BUBBLE_COMPOSITION =
	/badgeVariants\(\{[\s\S]*?variant:\s*"attentionQuiet"[\s\S]*?shape:\s*"pill"[\s\S]*?size:\s*"count"/;

test("the account row's plate is Team Bridge's borderless rounded-square plate", () => {
	const row = sourceOf(ACCOUNT_ROW);
	assert.ok(
		row.includes("hover:bg-row-hover"),
		`${ACCOUNT_ROW} no longer takes \`rowHover\` under the pointer, so the pair \`scripts/contrast-contract.mjs\` asserts for its plate no longer describes this row. Re-derive that pair before removing this one`,
	);
	assert.ok(
		!row.includes("rowCurrent"),
		`${ACCOUNT_ROW} now paints or names \`rowCurrent\`, so the account row IS a destination and its plate can be painted over a selection as well as a hover — \`media-surface\` bottoms out at ΔE00 1.83 against \`rowSelected\`, so the plate needs the selected-row step Team Bridge's rail takes`,
	);
	for (const element of ["<Avatar ", "<AvatarFallback"]) {
		const plate = literalClassAt(ACCOUNT_ROW, element, "after")
			.split(/\s+/)
			.filter((c) => c.length > 0);
		assert.ok(
			plate.includes("bg-media-surface"),
			`the account row's ${element.trim()} no longer paints \`bg-media-surface\` — it reads ${JSON.stringify(plate)}. \`scripts/contrast-contract.mjs\` measures that fill against \`surface\` and \`rowHover\`; on the root it is also the backing a transparent photo needs once Radix unmounts the fallback (design review round 1, D4)`,
		);
		assert.ok(
			plate.includes("rounded-md") && !plate.includes("rounded-full"),
			`the account row's ${element.trim()} is not Team Bridge's rounded-square plate — it reads ${JSON.stringify(plate)}. \`TeamBridgeAvatar\` draws the same person's photo at \`rounded-md\`, and one person must not be two shapes (design review round 1, D1)`,
		);
		const edge = plate.find((c) => EDGE_LIKE.test(c));
		assert.equal(
			edge,
			undefined,
			`the account row's ${element.trim()} drew an edge back (${JSON.stringify(edge)}). The plate is borderless by the operator's ask; its separation is the measured \`media-surface\` fill (design review round 1, D2)`,
		);
	}
});

/*
 * THE TEAM MARK, AND WHY IT IS ASSERTED HERE INSTEAD OF DISCOVERED.
 *
 * The team avatar bubble (the compact initials mark the chat sidebar's session
 * rows draw, operator ask 2026-10-01) is a site the scan above cannot see, and
 * that is a BOUNDARY rather than an oversight: the bubble is written in its own
 * module, so `carriersInsideRowStates` reads an element with no `className` of
 * its own where the bubble is USED and never enters the subtree that carries the
 * ground. It is the same shape as `CARRIED_GROUNDS` (a ground that lives in
 * another file) and it takes the same remedy: name the carrier, read its class
 * text from the file it is written in, and assert the fact here.
 *
 * IT LEFT THE CLASS ABOVE ON 2026-10-02. It used to be a `sunken` plate with its
 * own `borderControl` edge, resting on the agents sidebar's pair; the operator's
 * report replaced that face with the rail's quiet-count register (verbatim:
 * "should probably be more similar to the borderless bubble of the sidebar
 * notification counts — slight contrast vs backdrop, smaller more subtle text,
 * in the case there's no picture. Currently it looks kind of ugly"). The mark is
 * no longer an object whose boundary has to survive a row state's fill, so the
 * rule that block states does not apply to it: its legibility is the INITIALS'
 * own floor (`inkDim` on `elevated`, asserted per palette in
 * `scripts/contrast-contract.mjs`) and its identity is the SHARED call it
 * composes - `badgeVariants({ variant: "attentionQuiet", shape: "pill", size:
 * "count" })`, the same composition the sidebar rail's notification count makes.
 *
 * WHAT THIS TEST ADDS is the half a colour gate cannot see: that the shipped
 * class text is still that composition, and that the image path still renders
 * through the same mark. A palette assertion cannot read a `className`, and a
 * copied class string is exactly what the composition exists to prevent, so the
 * two halves are separate and neither file can make the other's assertion.
 */
test("the team avatar bubble wears the shared badge's composition", () => {
	const source = sourceOf(TEAM_BUBBLE);
	/*
	 * The face is the badge's own exported call, read as a pattern rather than a
	 * byte string so the formatter may break the arguments across lines.
	 */
	assert.ok(
		TEAM_BUBBLE_COMPOSITION.test(source),
		`${TEAM_BUBBLE} no longer composes the badge's quiet-count register - the call that turns the mark into the same face as the sidebar rail's notification count is gone. The mark must be \`badgeVariants({ variant: "attentionQuiet", shape: "pill", size: "count" })\` (operator report, 2026-10-02), which is why the pair it wears is asserted in \`scripts/contrast-contract.mjs\` under \`team avatar bubble\``,
	);
	const avatar = literalClassAt(TEAM_BUBBLE, "<Avatar ", "after")
		.split(/\s+/)
		.filter((token) => token.length > 0);
	assert.ok(
		avatar.includes("h-4"),
		`the team avatar bubble's avatar is no longer the badge's height - <Avatar> in ${TEAM_BUBBLE} reads ${JSON.stringify(avatar)}. The mark's geometry IS the badge's (16px), and the picture is meant to render inside it; the old \`size-5\` circle is what the operator's 2026-10-02 report asked to be brought into the badge family`,
	);
	assert.ok(
		!avatar.some((token) => token === "border" || token === "border-control"),
		`the team avatar bubble is back on an edge - <Avatar> in ${TEAM_BUBBLE} reads ${JSON.stringify(avatar)}. The mark is borderless now: its boundary is the initials' own ink floor, per the rail badge's register and its row in \`scripts/contrast-contract.mjs\` (\`edge: false\`)`,
	);
	const fallback = literalClassAt(TEAM_BUBBLE, "<AvatarFallback ", "after")
		.split(/\s+/)
		.filter((token) => token.length > 0);
	assert.ok(
		fallback.includes("bg-transparent"),
		`the team avatar bubble's fallback no longer defers to the mark's own ground - <AvatarFallback> in ${TEAM_BUBBLE} reads ${JSON.stringify(fallback)}. It has to override the primitive's \`bg-sunken\` with \`bg-transparent\`, so the initials sit on the root's \`elevated\`: an absent URL, a 404, a blocked request and a decoding failure all land on ONE face, which is what \`scripts/contrast-contract.mjs\` measures`,
	);
	assert.ok(
		!fallback.includes("bg-sunken"),
		`the team avatar bubble's fallback is back on the \`sunken\` plate - <AvatarFallback> in ${TEAM_BUBBLE} reads ${JSON.stringify(fallback)}. That plate (with its edge) is the pair the 2026-10-02 operator report called ugly and the row in \`scripts/contrast-contract.mjs\` was moved off`,
	);
	assert.ok(
		fallback.includes("text-inherit"),
		`the team avatar bubble's fallback pins its own ink instead of inheriting the mark's - <AvatarFallback> in ${TEAM_BUBBLE} reads ${JSON.stringify(fallback)}. \`text-inherit\` is what keeps the letters on the composition's \`ink-dim\` and stops the primitive's \`text-ink-muted\` from taking over`,
	);
});

/*
 * THE CLASS RATHER THAN THE CALL SITE: EVERY OBJECT A ROW STATE CAN PAINT OVER
 * KEEPS ITS OWN EDGE.
 *
 * The rule the two fixes state, in the design owner's words for the document: a
 * row is a state, and **an object inside a state keeps its own edge**. It is a
 * rule about a CLASS because the collision is a property of the roles rather than
 * of any one element — a row state is authored as a step of the panel it sits on,
 * so on some palette a state lands on whatever rung an object inside the row
 * wears. The rail's account plate (`elevated`, ΔE00 0.00 on `arcade`) and the
 * agents sidebar's avatar (`sunken`, 0.44 on `alucard`) are two instances of that
 * one fact, and shipping one fixed while the other stays live is incoherent.
 *
 * SO THE SET IS DISCOVERED FROM THE TREE, not listed by hand. The scan below
 * walks every `.tsx`, keeps the ones that name a row state AND carry a ground,
 * and resolves each element's own `className` through `esbuild`'s classic JSX
 * transform — the same declared dependency the `cn` bundle above uses — asking
 * whether a ground-carrying element sits INSIDE an element whose own class names
 * a row role. A new one therefore FAILS here until it is named below, which is
 * the property a per-call-site assertion cannot have.
 *
 * THE LEXICAL PRECONDITION, stated rather than implied, because a guard read as
 * broader than it is is worse than a narrow one: **this scan reads class text
 * that is WRITTEN, as a string or template literal, where the element is.** It
 * tokenises the `className` expression the JSX transform hands it, so a class
 * token it is asked about has to be a literal in that expression. Seven shapes
 * therefore pass it silently, and a future author must not write them expecting
 * this file to notice — each is a blind spot, not a bug in the scan:
 *   1. a class assembled with a substitution — `` `bg-${rung}` ``. The tripwire
 *      test below catches the flavour that carries a rung or a role token beside
 *      the substitution; the rest is review's;
 *   2. a ground that arrives through an identifier — `className={plateGround}` or
 *      `cn(plateGround)`. The scan sees `plateGround` and not the class, so
 *      neither the ground nor the edge question reaches the table;
 *   3. a class with the important modifier — `bg-sunken!` is a different token
 *      from `bg-sunken` to a string compare, and the role system bans `!`
 *      anyway. The token reader strips it, so this one is no longer silent;
 *   4. a bare `bg-row-hover` as a host with no `hover:` prefix — a row state
 *      painted statically. `ROW_STATE_TOKENS` carries both spellings now, so
 *      this one is no longer silent either;
 *   5. a ground that is NOT a rung of the ladder (`bg-accent`, `bg-control`).
 *      `GROUND_ROLES` is the ladder the row states are authored against, and a
 *      ground off it cannot be a state collision — a state lands on a rung. It
 *      is outside the rule's REASON rather than its reach, so it stays out of the
 *      table and is named here instead: this file asserts the rule about the
 *      palettes' rungs, and an off-ladder ground is a different question;
 *   6. a ground that arrives by SPREAD — `<span {...plate} />` with the class in
 *      the spread object. There is no `className` in the props to read, so the
 *      element looks like a carrier with no class of its own and the scan moves
 *      on. Named by QA's round-4 discovery probes, which found it passing;
 *   7. a ROW STATE that arrives by variable on the HOST — `className={qaRole}`.
 *      The host test asks whether the host's class text names a role, and a
 *      variable names nothing, so the scan never enters that subtree and neither
 *      does anything the row state can paint over. The one arm that still speaks
 *      is the stale-entry assertion below, and only for a carrier that was
 *      ALREADY named: a plate that stops being discovered because its host's role
 *      moved into a variable fails there. A brand-new variable-hosted row state
 *      is invisible.
 *
 * The first four of QA's round-4 discovery probes are answered by 2, 1, 3 and 6
 * respectively — the two it found passing that this file did not name (`bg-sunken!`
 * and the template literal) are closed by the token reader and the tripwire, and
 * the two that remain (`className={qaGround}`, `{...spread}`) are the shapes 2 and
 * 6 above, declared rather than implied.
 *
 * WHAT IT CANNOT SEE THROUGH A BOUNDARY is a second limit: a ground carried by a
 * component whose default lives in another file is recognised only for the
 * primitives in `CARRIED_GROUNDS`, and each of those is read from that
 * component's own class expression in the test below — a NEW primitive with a
 * default ground, or a carrier behind any other component boundary, is review's
 * business rather than this scan's, the way `scripts/chrome-keychain.test.mjs`
 * states the roots its own scan does not reach.
 *
 * FOUR OF THE SEVEN CARRIERS ARE EXEMPT, and each exemption carries the FACT it
 * rests on so the record cannot rot into a sentence:
 *   - the canvas file row's `img`/`video` thumbnail: its `sunken` is the ground
 *     BEHIND real content (`object-cover` fills the box), so what the reader sees
 *     is the picture; the state the fill shows is the slot BEFORE the picture
 *     arrives, whether it is still loading or never comes, and a ring here would
 *     box every thumbnail in every row;
 *   - the browser tab strip's chrome cluster: an overlay BAND whose ground exists
 *     so the title's tail is not read through it (its own comment earned that
 *     ground, review round 3) — a cover, not a mark, and the two controls it
 *     holds keep their own ink over the row's fill;
 *   - the tab's notch: a 1px line (`-bottom-px h-px`) painted on the ACTIVE tab,
 *     whose own fill is the role it paints, so it is not an object over a row
 *     state at all — the host names `hover:bg-row-hover` for the INACTIVE branch.
 */
const ROW_STATE_TOKENS = [
	"rowCurrent",
	"bg-row-selected",
	"bg-row-hover",
	"hover:bg-row-hover",
	"hover:bg-row-selected",
];
const GROUND_ROLES = [
	"bg-elevated",
	"bg-sunken",
	"bg-surface",
	"bg-canvas",
	/*
	 * `bg-media-surface` is the borderless-tile FILL ROLE rather than a rung of the
	 * ladder (see `docs/branding.md`), and Team Bridge's initial plates wear it
	 * with no edge on purpose. It is listed here so those plates stay VISIBLE to
	 * this sweep: a plate that stopped carrying a rung would otherwise drop out of
	 * the inventory silently, which is the failure this table exists to prevent.
	 * Its separation from a row state is measured, not assumed - the
	 * `team bridge borderless person and agent plates` row in
	 * `scripts/contrast-contract.mjs`.
	 */
	"bg-media-surface",
];

/*
 * The class tokens a `className` expression names, read the way a browser would
 * match them rather than by substring: a quoted or backticked literal is split on
 * whitespace, and the important modifier is stripped so `bg-sunken!` reads as
 * `bg-sunken` (blind spot 3 in the block comment above - a string compare on the
 * raw text missed it, which is one of the five shapes the round-4 review used to
defeat an earlier version of this scan).
 *
 * Deliberately NOT a JS evaluator: a substitution and an identifier are left in
 * the token list as themselves, so the caller still sees that it could not read
 * them. See the tripwire test below for the one shape that is detected rather
 * than only documented.
 */
const classTokens = (text) =>
	String(text)
		.replace(/[`"']/g, " ")
		.split(/\s+/)
		.filter(Boolean)
		.map((token) => token.replace(/!+$/, ""));

/*
 * The primitives that carry a ground by DEFAULT, so a call site with no
 * `className` is still an object over its row: an `<AvatarFallback>` with no
 * override paints the primitive's `sunken`. Read from the component's own class
 * expression by the test below rather than trusted here.
 */
const TEAM_BRIDGE_PROFILE =
	"src/renderer/src/features/team-bridge/team-bridge-profile-card.tsx";
const CARRIED_GROUNDS = {
	// Extraction must not make the rail's shared avatar invisible to the sweep.
	TeamBridgeAvatar: {
		ground: "bg-surface,bg-media-surface",
		file: TEAM_BRIDGE_PROFILE,
		anchor: "export function TeamBridgeAvatar",
	},
	AvatarFallback: {
		ground: "bg-sunken",
		file: "src/renderer/src/shared/components/ui/avatar.tsx",
		anchor: "<AvatarPrimitive.Fallback",
	},
	Switch: {
		ground: "bg-sunken",
		file: "src/renderer/src/shared/components/ui/switch.tsx",
		anchor: "<SwitchPrimitive.Root",
	},
};

/* A `/` STARTS A REGEX when the last meaningful character before it cannot end an
   expression; the transform keeps the source's own literals, and the scanner has
   to walk past them rather than through them. */
const REGEX_AFTER = new Set([
	"(",
	",",
	"{",
	"}",
	"[",
	";",
	":",
	"=",
	"!",
	"&",
	"|",
	"?",
	"+",
	"-",
	"*",
	"%",
	"^",
	"<",
	">",
	"~",
]);
const regexAllowedAt = (text, i) => {
	let j = i - 1;
	while (j >= 0 && /\s/.test(text[j])) j -= 1;
	if (j < 0) return true;
	if (REGEX_AFTER.has(text[j])) return true;
	const word = /([A-Za-z_$][\w$]*)\s*$/.exec(text.slice(0, j + 1));
	return (
		word !== null &&
		/\b(return|typeof|case|in|of|new|delete|void|instanceof|do|else|yield|await)$/.test(
			word[1],
		)
	);
};

/** The index just past the atomic token at `i`: a string, a comment, or a regex. */
const jsSkip = (text, i) => {
	const char = text[i];
	const next = text[i + 1];
	if (char === '"' || char === "'" || char === "`") {
		let k = i + 1;
		while (k < text.length && text[k] !== char) k += text[k] === "\\" ? 2 : 1;
		return k + 1;
	}
	if (char === "/" && next === "/") {
		let k = i;
		while (k < text.length && text[k] !== "\n") k += 1;
		return k;
	}
	if (char === "/" && next === "*") {
		let k = i + 2;
		while (k < text.length && !(text[k] === "*" && text[k + 1] === "/")) k += 1;
		return k + 2;
	}
	if (char === "/" && regexAllowedAt(text, i)) {
		let k = i + 1;
		let inClass = false;
		while (k < text.length) {
			const at = text[k];
			if (at === "\\") {
				k += 2;
				continue;
			}
			if (at === "[") inClass = true;
			else if (at === "]") inClass = false;
			else if (at === "/" && !inClass) return k + 1;
			else if (at === "\n") return k;
			k += 1;
		}
		return k;
	}
	return i + 1;
};

/** The same JS with every comment removed, so a note can answer for no class. */
const withoutComments = (text) => {
	let out = "";
	for (let i = 0; i < text.length; ) {
		if (text[i] === "/" && (text[i + 1] === "/" || text[i + 1] === "*")) {
			i = jsSkip(text, i);
			continue;
		}
		const next = jsSkip(text, i);
		out += text.slice(i, next);
		i = next;
	}
	return out;
};

/** The index of the `)` closing the `(` at `open`. */
const jsMatchParen = (text, open) => {
	let depth = 0;
	for (let i = open; i < text.length; ) {
		if (text[i] === "(") depth += 1;
		else if (text[i] === ")") {
			depth -= 1;
			if (depth === 0) return i;
		}
		i = jsSkip(text, i);
	}
	return -1;
};

/** An argument list split at its own top-level commas. */
const jsTopLevel = (text) => {
	const parts = [];
	let depth = 0;
	let start = 0;
	for (let i = 0; i < text.length; ) {
		const char = text[i];
		if ("([{".includes(char)) depth += 1;
		else if (")]}".includes(char)) depth -= 1;
		else if (char === "," && depth === 0) {
			parts.push(text.slice(start, i));
			start = i + 1;
		}
		i = jsSkip(text, i);
	}
	parts.push(text.slice(start));
	return parts;
};

/** The `className` value expression inside an element's props object text. */
const jsClassName = (props) => {
	const at = /(?:^|[,{\s])className\s*:/.exec(props);
	if (!at) return null;
	return jsTopLevel(props.slice(at.index + at[0].length))[0].trim();
};

/*
 * Every element in the tree that carries a ground of its own INSIDE an element
 * whose own class names a row state. Each hit is `{ file, element, host,
 * grounds, classes }`, and `classes` is the element's own class text — the call
 * site's when it has one, and the carrying primitive's for the two primitives in
 * `CARRIED_GROUNDS`, so a reviewer reads the same string the `cn` resolution
 * would produce.
 */
const carriersInsideRowStates = async () => {
	const candidates = [];
	for (const { file } of sourcesIn("src")) {
		if (!/\.tsx$/.test(file)) continue;
		const source = read(file);
		if (!ROW_STATE_TOKENS.some((token) => source.includes(token))) continue;
		if (
			!GROUND_ROLES.some((role) => source.includes(role)) &&
			!Object.keys(CARRIED_GROUNDS).some((name) => source.includes(`<${name}`))
		)
			continue;
		candidates.push({ file, source });
	}
	const found = [];
	for (const { file, source } of candidates) {
		const { code } = await transform(source, {
			loader: "tsx",
			jsx: "transform",
			format: "esm",
		});
		const js = withoutComments(code);
		/* An element nested inside TWO row-state hosts is one object, and is
		   recorded once; two elements of the same kind in one file are two, and
		   both have to be named. */
		const seen = new Set();
		const calls = [];
		for (const match of js.matchAll(/React\.createElement\(/g)) {
			const open = match.index + match[0].length - 1;
			calls.push([match.index, open, jsMatchParen(js, open)]);
		}
		for (const outer of calls) {
			if (outer[2] === -1) continue;
			const outerArgs = jsTopLevel(js.slice(outer[1] + 1, outer[2]));
			const host = outerArgs[0].trim().replace(/^"|"$/g, "");
			const hostProps =
				outerArgs.length > 1 && outerArgs[1].trim().startsWith("{")
					? outerArgs[1]
					: null;
			const hostClass = hostProps ? jsClassName(hostProps) : null;
			const hostTokens = hostClass ? classTokens(hostClass) : [];
			if (
				!hostClass ||
				!ROW_STATE_TOKENS.some((token) => hostTokens.includes(token))
			)
				continue;
			for (const inner of calls) {
				if (!(inner[0] > outer[0] && inner[2] !== -1 && inner[2] < outer[2]))
					continue;
				if (seen.has(inner[0])) continue;
				const args = jsTopLevel(js.slice(inner[1] + 1, inner[2]));
				const element = args[0].trim().replace(/^"|"$/g, "");
				const props =
					args.length > 1 && args[1].trim().startsWith("{") ? args[1] : null;
				const own = props ? jsClassName(props) : null;
				if (own !== null) {
					const tokens = classTokens(own);
					const grounds = GROUND_ROLES.filter((role) => tokens.includes(role));
					if (grounds.length > 0) {
						seen.add(inner[0]);
						found.push({ file, element, host, grounds, classes: own });
						continue;
					}
					// A size/ink override does not remove a primitive's own ground.
					// Fall through to its carrier instead of losing the extracted plate.
				}
				const carried = CARRIED_GROUNDS[element];
				if (!carried) continue;
				seen.add(inner[0]);
				found.push({
					file,
					element,
					host,
					grounds: carried.ground.split(","),
					classes: `${expressionAfter(carried.file, carried.anchor)} ${own ?? ""}`,
				});
			}
		}
	}
	return found;
};

/*
 * THE SET, and the one assertion each entry carries. `edge` entries must wear
 * `border-control` in their own class text; the exempted ones must still carry
 * the fact their reason rests on. The mirror of this table is the palette half in
 * `scripts/contrast-contract.mjs`, which measures the two plates' fills and edges
 * per palette, and the design record (§ 9.2) states the rule both halves assert.
 */
const PLATES_INSIDE_ROW_STATES = [
	{
		/* Borderless since the own-avatar change (design review round 1, D2): the
		   rail's account plate takes Team Bridge's measured `media-surface` fill on
		   both its root and its fallback, so the sweep finds two objects. */
		what: "the rail's account plate",
		file: ACCOUNT_ROW,
		element: "Avatar",
		ground: "bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		what: "the rail's account plate's initials",
		file: ACCOUNT_ROW,
		element: "AvatarFallback",
		ground: "bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		what: "the agents sidebar's avatar",
		file: AGENTS_SIDEBAR,
		element: "AvatarFallback",
		ground: "bg-sunken",
		edge: true,
	},
	{
		what: "the schedules list's switch",
		file: SCHEDULE_ROW,
		element: "Switch",
		ground: "bg-sunken",
		edge: true,
	},
	{
		what: "the hub link mark's origin-count badge",
		file: HUB_LINK_MARK,
		element: "span",
		ground: "bg-surface",
		edge: true,
	},
	{
		what: "the canvas file row's media thumbnail plate",
		file: FILE_ROW,
		element: "RowThumbnail",
		ground: "bg-sunken",
		edge: false,
		fact: "object-cover",
	},
	{
		/*
		 * THE TEAM BRIDGE INITIAL PLATES ARE BORDERLESS BY REQUEST (the operator,
		 * 2026-10-25), and their FILL is what replaced the edge they used to wear.
		 * They carried `sunken` + `border-control` because `sunken` lands on the
		 * row-hover rung on some palettes; they now carry `media-surface`, and the
		 * pair is measured rather than argued: it clears `canvas` deltaE00 >= 4.00,
		 * `surface` >= 5.96 and `row-hover` >= 3.70 across all 59 palettes, where
		 * the baseline `sunken` bottoms out at 1.86 against `row-hover`. That row
		 * lives in `scripts/contrast-contract.mjs` as `team bridge borderless person
		 * and agent plates`.
		 *
		 * THE PIN THAT KEEPS THIS ENTRY HONEST IS THE FILL ITSELF. This table's key
		 * carries the ground, so moving the plate back onto a rung does not quietly
		 * pass: the sweep stops finding this entry and the stale-entry assertion
		 * fires. The same plate is drawn on the rail, in the compose suggestions and
		 * in the thread-intro header; the sweep sees the three call sites that sit
		 * inside a row state; `TEAM_BRIDGE_PLATE_SITES` below also follows the shared
		 * primitive and the caller overrides after profile extraction.
		 */
		what: "the Team Bridge thread's sender avatar",
		file: TEAM_BRIDGE_MESSAGES,
		element: "span",
		ground: "bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		/* The To: suggestion list's person initial, the same plate: the active option
		   takes `rowHover`, and the fill is what keeps the initial visible there. */
		what: "the Team Bridge compose suggestion's initial",
		file: TEAM_BRIDGE_COMPOSE,
		element: "span",
		ground: "bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		/* Directory-backed suggestions use the shared primitive; the span above
		   remains the fallback for recipients without a directory member. The
		   scanner inventories both possible primitive fills conservatively, while
		   this caller uses its default unselected media-surface fill. */
		what: "the Team Bridge compose suggestion's shared avatar",
		file: TEAM_BRIDGE_COMPOSE,
		element: "TeamBridgeAvatar",
		ground: "bg-surface,bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		/* The chief's inline shared avatar is visible to the row-state sweep.
		   The person's precomputed avatar uses the same primitive; its selection
		   forwarding and both call-site overrides are pinned below. */
		what: "the Team Bridge rail shared avatar",
		file: TEAM_BRIDGE_RAIL,
		element: "TeamBridgeAvatar",
		/* TWO GROUNDS, the shape this table already allows: the plate takes
		   `media-surface` on a plain row and `surface` on the SELECTED row, because
		   `rowSelected` is where the quiet fill bottoms out (design round 1, D1). */
		ground: "bg-surface,bg-media-surface",
		edge: false,
		fact: "bg-media-surface",
	},
	{
		/* NOT PART OF THE PLATE WORK, recorded because the sweep now watches the
		   borderless fill role. The canvas finder's media thumbnail is a tile whose
		   fill IS its extent (the `media-surface` contract) and it clips its own
		   picture, so it needs no control edge; this entry states that rather than
		   leaving an unlisted object now that `bg-media-surface` is a watched
		   ground. */
		what: "the canvas finder's media thumbnail",
		file: FINDER_FILES_VIEW,
		element: "span",
		ground: "bg-media-surface",
		edge: false,
		fact: "overflow-hidden",
	},
	{
		/*
		 * The timeline's label rail is `bg-canvas` inside a row state: it is the
		 * STICKY scroll-under column (the same role the timeline's sticky header
		 * rails carry), deliberately solid, and it is the row's own label column
		 * rather than a plate laid over the row's fill. Recorded as a sticky
		 * ground, not as a plate needing an edge.
		 */
		what: "the timeline's sticky label rail",
		file: PROJECT_TIMELINE,
		element: "span",
		ground: "bg-canvas",
		edge: false,
		fact: "sticky",
	},
	{
		/*
		 * A milestone mark is a SMALL DELIBERATE MARK (a 8px diamond, the same
		 * class as a chip or a badge), and it already carries its own semantic
		 * edge (`border-ink-muted`) rather than the control edge. It is not a
		 * plate the row's fill can disappear into.
		 */
		what: "the timeline's upcoming milestone mark",
		file: PROJECT_TIMELINE,
		element: "span",
		ground: "bg-surface",
		edge: false,
		fact: "border-ink-muted",
	},
];

/*
 * THE PLATE CALL SITES AND SHARED PRIMITIVE, AND THE EDGE THAT MUST NOT COME BACK.
 *
 * The row-state sweep above records that a plate NEEDS no edge (`edge: false`),
 * but nothing there rejects one: re-adding `border border-control` to a plate
 * would keep it green. This is the other half of the operator's ask (2026-10-26,
 * "remove the avatar borders") - a source assertion over every Team Bridge
 * initial plate, because a guard that only states why an edge is unnecessary
 * cannot notice one arriving.
 *
 * Each entry names the file and the class expression that draws the plate; the
 * assertion is that the expression carries the borderless fill and none of the
 * shapes that would put a line back: a `border` utility, a `ring`, a `divide`,
 * or a `shadow`.
 */
const TEAM_BRIDGE_PLATE_SITES = [
	{
		what: "the shared rail avatar's initial plate",
		file: TEAM_BRIDGE_PROFILE,
		anchor: 'selected ? "bg-surface" : "bg-media-surface"',
	},
	{
		what: "the message row's sender plate",
		file: "src/renderer/src/features/team-bridge/team-bridge-message-list.tsx",
		anchor: '? "bg-media-surface text-accent"',
	},
	{
		what: "the rail's person plate",
		file: "src/renderer/src/features/team-bridge/team-bridge-rail.tsx",
		anchor: 'className="rounded-[5px] text-[10px]"',
	},
	{
		what: "the rail's chief plate",
		file: "src/renderer/src/features/team-bridge/team-bridge-rail.tsx",
		anchor: 'className="rounded-[5px] text-accent"',
	},
	{
		what: "the compose suggestion's initial",
		file: "src/renderer/src/features/team-bridge/team-bridge-compose-bar.tsx",
		anchor: '? "bg-media-surface text-accent"',
	},
	{
		what: "the thread intro's header plate",
		file: "src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		anchor: '? "bg-media-surface text-accent"',
	},
];

const EDGE_LIKE =
	/(^|[\s"'`])(border(-[a-z]+)?|ring(-[a-z0-9]+)?|divide(-[a-z]+)?|shadow(-[a-z0-9]+)?)([\s"'`]|$)/;

// The person's avatar is computed before the row JSX, so the lexical row sweep
// cannot follow that variable. Pin both callers to the same selected-aware
// primitive as well as sweeping the chief's inline carrier.
function assertRailAvatarContract(rail, expression) {
	const calls = [...rail.matchAll(/<TeamBridgeAvatar\b[\s\S]*?\/>/g)];
	assert.equal(
		calls.length,
		2,
		"both rail avatars must use the shared primitive",
	);
	for (const [call] of calls) {
		assert.match(
			call,
			/selected=\{selected\}/,
			"rail selection must reach the avatar",
		);
	}
	assert.match(
		expression,
		/selected\s*\?\s*"bg-surface"\s*:\s*"bg-media-surface"/,
		"the selected avatar must retain its distinct fill",
	);
	assert.doesNotMatch(
		expression,
		EDGE_LIKE,
		"the shared initial plate must stay borderless",
	);
}

test("shared rail avatars preserve selection and reject broken paint contracts", () => {
	const rail = sourceOf(TEAM_BRIDGE_RAIL);
	const expression = expressionAfter(
		TEAM_BRIDGE_PROFILE,
		"export function TeamBridgeAvatar",
	);
	assertRailAvatarContract(rail, expression);
	// Negative controls prove the extraction guard still rejects the regressions
	// the old inline-span anchors were intended to prevent.
	assert.throws(
		() =>
			assertRailAvatarContract(
				rail.replace("selected={selected}", "selected={false}"),
				expression,
			),
		/rail selection must reach the avatar/,
	);
	assert.throws(
		() =>
			assertRailAvatarContract(
				rail,
				expression.replace('"bg-surface"', '"bg-media-surface"'),
			),
		/selected avatar must retain its distinct fill/,
	);
	assert.throws(
		() => assertRailAvatarContract(rail, `${expression} "border-control"`),
		/shared initial plate must stay borderless/,
	);
});

test("no Team Bridge initial plate regrows a border, ring, divider or shadow", () => {
	for (const site of TEAM_BRIDGE_PLATE_SITES) {
		/*
		 * THE CODE AROUND THE PLATE, NEVER THE PROSE BESIDE IT: these sites carry
		 * comments that quote `border-control` to explain why the ring is gone, so the
		 * comments are stripped from the WHOLE file first and the window is taken from
		 * what remains. Stripping only the window fails when it opens inside a comment
		 * (the opening delimiter is not in the slice), which is exactly what happened
		 * the first time this guard ran.
		 */
		const code = read(site.file)
			.replace(/\/\*[\s\S]*?\*\//g, (comment) => " ".repeat(comment.length))
			.replace(/\/\/[^\n]*/g, (comment) => " ".repeat(comment.length));
		assert.ok(
			code.includes(site.anchor),
			`${site.what}: the plate's fill expression moved (${site.file}). Re-read the site before trusting this guard - it is anchored on the two fills that make the plate borderless.`,
		);
		const at = code.indexOf(site.anchor);
		const nearby = code.slice(Math.max(0, at - 700), at + 200);
		const found = nearby.match(EDGE_LIKE);
		assert.equal(
			found,
			null,
			`${site.what} drew an edge back: ${JSON.stringify(found?.[0])} in ${site.file}. The plates are borderless by the operator's ask; separate them by fill value (scripts/contrast-contract.mjs) rather than by a line.`,
		);
	}
});

test("every object a row state can paint over keeps an edge, or records why it need not", async () => {
	/*
	 * THE TAB ACTIONS HAVE LEFT THIS INVENTORY (LOH-13 operator report,
	 * 2026-10-25). They are a native Electron menu now: the OS draws the panel
	 * outside this document, so there is no renderer plate that could paint a
	 * ground over the row and nothing to carry an edge. The former popout's
	 * boxless `<div className="contents">` wrapper went with it. The pin is the
	 * ABSENCE: a renderer panel reappearing here must fail until its paint is
	 * accounted for in the inventory.
	 */
	const browserTabs = read(BROWSER_TABS);
	assert.ok(
		!browserTabs.includes('data-tour-tag="browser-tab-actions"'),
		"the tab-actions menu must not paint a renderer panel; restore its painted-plate inventory entry if it starts painting again",
	);
	assert.ok(
		browserTabs.includes('aria-haspopup="menu"'),
		"and its trigger must still be the native menu's own button",
	);

	/*
	 * The map first, because everything below is measured through it: the two
	 * primitives have to carry the ground they are read for, or this test is
	 * asking about a `sunken` that moved.
	 */
	for (const [name, carried] of Object.entries(CARRIED_GROUNDS)) {
		const tokens = expressionAfter(carried.file, carried.anchor)
			.split(/["'\s]+/)
			.filter(Boolean);
		assert.ok(
			carried.ground.split(",").every((ground) => tokens.includes(ground)),
			`<${name}> no longer paints \`${carried.ground}\` in its own class expression (${carried.file}, ${carried.anchor}), so a call site with no \`className\` is no longer an object over its row and \`CARRIED_GROUNDS\` is stale. Got: ${JSON.stringify(tokens.filter((t) => t.startsWith("bg-")))}`,
		);
	}

	const found = await carriersInsideRowStates();
	/*
	 * THE KEY CARRIES THE GROUND. One file can hold two `span` plates inside its
	 * rows (the project timeline's sticky label rail and its milestone mark, both
	 * added when the timeline row became a `row-hover` state); keyed on file and
	 * tag alone the second is indistinguishable from the first and its own
	 * exemption can never be read.
	 */
	const key = (entry) => `${entry.file}#${entry.element}#${entry.ground}`;
	assert.deepEqual(
		found
			.map((entry) => key({ ...entry, ground: entry.grounds.join(",") }))
			.sort(),
		PLATES_INSIDE_ROW_STATES.map(key).sort(),
		`${found.length} object(s) inside a row state carry a ground of their own and ${PLATES_INSIDE_ROW_STATES.length} are named in \`PLATES_INSIDE_ROW_STATES\`. The rule is that an object inside a row state keeps its own edge — a row state is a step of the panel it sits on, so on some palette it lands on the object's own rung and the object disappears into the row (measured: \`elevated\` against \`rowHover\` is ΔE00 0.00 on \`arcade\`, \`sunken\` against \`rowSelected\` 0.44 on \`alucard\`). Either give the new object \`border-control\` and name it here, or name it with the fact that makes an edge unnecessary: ${JSON.stringify(found.map(key))} vs ${JSON.stringify(PLATES_INSIDE_ROW_STATES.map(key))}`,
	);

	for (const entry of PLATES_INSIDE_ROW_STATES) {
		const hit = found.find(
			(candidate) =>
				key({ ...candidate, ground: candidate.grounds.join(",") }) ===
				key(entry),
		);
		assert.notEqual(
			hit,
			undefined,
			`${entry.what} is named in PLATES_INSIDE_ROW_STATES but the scan no longer finds it — the entry is stale: ${JSON.stringify(entry)}`,
		);
		const tokens = (hit.classes ?? "").split(/["'\s]+/).filter(Boolean);
		if (entry.edge) {
			assert.ok(
				tokens.includes("border-control"),
				`${entry.what} is an object inside a row state and wears no \`border-control\`: it reads ${JSON.stringify(hit.classes)} on \`${hit.host}\`. \`${hit.grounds.join("`, `")}\` is a rung of the ladder, so the row's own state lands on it — the palette half of the pair is in \`scripts/contrast-contract.mjs\`, and the rule is that the object inside the state keeps its OWN edge`,
			);
		} else {
			assert.ok(
				tokens.includes(entry.fact),
				`${entry.what} is exempted because it carries \`${entry.fact}\`, and its class text no longer does: it reads ${JSON.stringify(hit.classes)}. Re-read the reason in the block above before removing this entry — an exemption whose fact has moved is a plate that needs an edge`,
			);
		}
	}
});

/*
 * THE TRIPWIRE FOR THE ONE BLIND SPOT A SCAN CAN SEE: A RUNG OR A ROLE NAMED
 * BESIDE A SUBSTITUTION.
 *
 * Blind spot 1 in the block above is a class assembled at runtime — `` `bg-${rung}` ``
 * — which no string scan can resolve. But the shape that gets written by accident
 * is narrower than that: an author interpolates a VARIANT or a size into a string
 * that also names the rung or the role, which is a class the row state can land
 * on and which this file cannot read. That shape is detectable without evaluating
 * anything: the template literal's own literal parts still carry the token.
 *
 * Deliberately a TRIPWIRE rather than a rule: it fails when the two appear in one
 * template literal, and its fix is to write the class out, not to teach this file
 * to evaluate JavaScript. The remaining blind spots are documented above instead,
 * because a guard that pretends to see an identifier it cannot read is the defect
 * this block exists to prevent.
 *
 * `*.stories.tsx` is outside the walk: a story is a dev-only fixture, nothing
 * renders it inside a row, and the two hits the tree does carry (`bg-canvas` in a
 * notification-feed story's height literal, `bg-surface` in the chat hydration
 * placeholder's measure literal) are the fixture's own frame rather than a class
 * a row state can land on. Excluding them is a scope decision with the same
 * reason `scripts/` sits outside `sourcesIn`: this file asks about the app's
 * surfaces, and a story is not one.
 */
test("no template literal builds a row state or a rung beside a substitution", () => {
	const offences = [];
	for (const { file, source } of sourcesIn("src")) {
		if (/\.stories\.tsx$/.test(file)) continue;
		if (
			!ROW_STATE_TOKENS.some((token) => source.includes(token)) &&
			!GROUND_ROLES.some((role) => source.includes(role))
		)
			continue;
		for (const match of source.matchAll(/`(?:[^`\\]|\\.)*`/g)) {
			const literal = match[0];
			if (!literal.includes("${")) continue;
			const named = [...ROW_STATE_TOKENS, ...GROUND_ROLES].filter((token) =>
				classTokens(literal.replace(/\$\{[^}]*\}/g, " ")).includes(token),
			);
			if (named.length > 0)
				offences.push(
					`${file}: ${JSON.stringify(literal.slice(0, 120))} names ${named.join(", ")}`,
				);
		}
	}
	assert.deepEqual(
		offences,
		[],
		`a template literal names a row state or a rung of the ladder AND builds part of the class at runtime, so this file's scan cannot read what the element paints: ${JSON.stringify(offences)}. Write the class out as a literal, or - if the substitution is genuinely needed - take the element out of the rule's reach on purpose and record why beside the other exemptions`,
	);
});

/*
 * THE TWO ROW-STATE SITES THAT STILL RIDE A RUNG, RECORDED RATHER THAN
 * RE-GROUNDED, and why the record is a table and not an assertion over the tree.
 *
 * Both are `hover`-only: neither paints `rowCurrent`, so neither can be
 * re-grounded by the rule this block asserts (a surface that paints the
 * PERSISTENT state wears `surface`) without moving a surface the direction
 * deliberately scoped out. The canvas document-tab strip has been outside that
 * scope since § 10; the schedules page's annex is a ground an earlier round
 * chose on purpose. They are named here WITH their numbers so the next reader
 * does not rediscover them as a regression, and each entry asserts the facts it
 * claims — the file paints the hover role, and the rung is really where the
 * entry says it is — so the record cannot rot into a sentence.
 */
const HOVER_STATES_ON_A_RUNG = [
	{
		what: "the canvas document-tab strip",
		rowFile: "src/renderer/src/features/chat/components/canvas/canvas-tabs.tsx",
		rowAnchor: "bg-sunken px-1 py-1",
		rungFile:
			"src/renderer/src/features/chat/components/canvas/canvas-tabs.tsx",
		rungAnchor: "bg-sunken px-1 py-1",
		rung: "bg-sunken",
		note: "the selected tab takes `bg-surface` and the rest hover on `rowHover` while the strip is `sunken`: hover-off-`sunken` measures ΔE00 1.86 at its worst (`iceberg`, 1 of the 59 palettes under the field floor). § 10 of the direction scopes this surface out, which is a recorded fact rather than a sentence now.",
	},
	{
		what: "the schedules page's legacy annex",
		rowFile:
			"src/renderer/src/features/schedules/components/schedule-list-item.tsx",
		rowAnchor: "hover:bg-row-hover",
		rungFile:
			"src/renderer/src/features/schedules/components/schedules-page.tsx",
		rungAnchor: "bg-sunken",
		rung: "bg-sunken",
		note: "the annex is `sunken` and its rows take `rowHover`; it is a deliberate ground of an earlier round (that file's own D5), so it is recorded and not re-grounded here. Its rows never carry `rowCurrent`.",
	},
];

test("the hover-only row sites that ride a rung are recorded, and the record is true", () => {
	for (const entry of HOVER_STATES_ON_A_RUNG) {
		const row = sourceOf(entry.rowFile);
		assert.ok(
			row.includes("hover:bg-row-hover"),
			`${entry.what}: ${entry.rowFile} no longer paints \`hover:bg-row-hover\`, so this record is stale — remove the entry or re-point it`,
		);
		assert.ok(
			!row.includes("rowCurrent"),
			`${entry.what}: ${entry.rowFile} now paints \`rowCurrent\`, so it is NOT a hover-only site any more and it has to be a ROW_STATE_GROUNDS entry on \`surface\` rather than a recorded exception`,
		);
		assert.ok(
			sourceOf(entry.rungFile).includes(entry.rungAnchor),
			`${entry.what}: ${entry.rungFile} no longer paints \`${entry.rungAnchor}\`, so the rung this record names is gone — check whether the site still rides one at all`,
		);
		assert.ok(
			entry.note.includes("ΔE00") || entry.what.includes("schedules"),
			`${entry.what}: the record has to carry its measurement, not just the fact`,
		);
	}
});
