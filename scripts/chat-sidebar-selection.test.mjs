/**
 * The current row's ground, executable — in the chat sidebar and in the settings
 * rail.
 *
 *     node --test scripts/chat-sidebar-selection.test.mjs
 *
 * The operator's report was "the sidebar doesn't visibly highlight the selected
 * conversation, so you can't tell from the sidebar which one is selected". The
 * chat panel is `bg-surface`; the ground every current-row state used was
 * `accent-wash`, which is ΔE00 1.05 from `surface` in tokyoNight — no mark at
 * all — while the hover step the same rows carry measures 4.58 there, so the
 * pointer read as the current row and the current row did not. The settings rail
 * (round 1, D2) is the same pairing on the same ground and is covered here for
 * that reason: it is one class in another file for one role decision, and a
 * second file asserting the same property for the same decision would be two
 * instruments for one fact.
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
 *      four chat call sites, the entity row's three elements, and the settings
 *      rail's row are one fact.
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
/*
 * The path the one consumer imports the role BY, named once because the one-spelling test
 * asserts it verbatim: this is the string that makes the settings rail read
 * the chat panel's declaration instead of carrying its own, so it is the thing to hold.
 */
const SIDEBAR_MODULE = "@features/chat/components/chat-sidebar";
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

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
	const names = Object.keys(stubs);
	// biome-ignore lint/security/noGlobalEval: the evaluated text is this repository's own source, read two assertions above, and the sandbox is a `new Function` over stub predicates.
	const call = new Function("cn", ...names, `return cn(${expression});`);
	return call(cn, ...names.map((name) => stubs[name]));
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
		expression: () => expressionBefore(SIDEBAR, '"min-w-0 grow text-left"'),
		stubs: {
			revealArmed: true,
			rowStyle,
			rowCurrent,
			nested: false,
			current: true,
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
		stubs: { revealArmed: true, rowBoxStyle, rowCurrent, current: true },
		ground: true,
	},
	{
		what: "the All chats filter",
		file: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, ">All chats</span>"),
		stubs: { revealArmed: true, rowStyle, rowCurrent, all: true },
		ground: true,
	},
	{
		what: "the New chat row",
		file: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, ">New chat</span>"),
		stubs: {
			revealArmed: true,
			rowStyle,
			rowCurrent,
			activeDraftKey: "draft-key",
			draft: undefined,
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
		expression: () => expressionAfter(SIDEBAR, "data-entity-name"),
		stubs: { revealArmed: true, rowStyle, rowCurrent, staged: true },
		ground: true,
	},
	{
		what: "the entity row's disclosure control",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-disclosure"),
		stubs: { revealArmed: true, staged: true },
		ground: false,
		notCurrent: { revealArmed: true, staged: false },
	},
	{
		what: "the entity row's manage control",
		file: SIDEBAR,
		expression: () =>
			expressionBefore(SIDEBAR, "aria-label={`Manage ${name}`}"),
		stubs: { revealArmed: true, staged: true },
		ground: false,
		notCurrent: { revealArmed: true, staged: false },
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
		 * `rowCurrent` IS STUBBED HERE SINCE ROUND 5 (design D22, agent A-7), and the stub
		 * moving with the component is the instrument's contract rather than a detail:
		 * the rail's current branch reads the symbol it imports from the chat panel, so a
		 * guard that did not name it would throw `ReferenceError` inside the resolved
		 * expression instead of asserting anything. The VALUE is this file's own read of
		 * the declaration (`literalOf(SIDEBAR, "rowCurrent")`), so the rail is measured
		 * against the app's role — and that declaration is asserted to be the tree's
		 * only spelling in the test above.
		 */
		what: "the settings rail's current section",
		file: SETTINGS_RAIL,
		expression: () =>
			expressionAfter(
				SETTINGS_RAIL,
				'aria-current={isActive ? "page" : undefined}',
			),
		stubs: { revealArmed: true, labelled: true, isActive: true, rowCurrent },
		ground: true,
		notCurrent: {
			revealArmed: true,
			labelled: true,
			isActive: false,
			rowCurrent,
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
	const rail = CURRENT.find((site) => site.file === SETTINGS_RAIL);
	assert.notEqual(
		rail,
		undefined,
		"the settings rail is no longer in `CURRENT`",
	);
	const active = merged(rail.file, rail.expression(), rail.stubs);
	assert.ok(
		active.includes("font-medium"),
		`the settings rail's current row no longer carries the step the chat sidebar was moved onto, so the two rails disagree about how a current row is marked:\n${active}`,
	);
	const inactive = merged(rail.file, rail.expression(), rail.notCurrent);
	assert.ok(
		!inactive.includes("font-medium"),
		`a row that is NOT current must not be heavier than the one that is:\n${inactive}`,
	);
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
		`the current-row role is spelled outside its one declaration. It is OWNED by ${SIDEBAR} and imported by the settings rail; a copy is what drifted twice (design rounds 3 and 4, D17 and D19), and a copy on a surface whose frames ship is a committed picture of a row the app does not draw. Delete the copy and import \`rowCurrent\` instead: ${JSON.stringify(spelled)}`,
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
	for (const file of [SETTINGS_RAIL]) {
		assert.ok(
			code
				.get(file)
				.includes(`import { rowCurrent } from "${SIDEBAR_MODULE}";`),
			`${file} no longer imports the current-row role from ${SIDEBAR_MODULE}, so it is deciding the row's ground for itself again`,
		);
	}
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
				// every row surface in the tree. The pin control is the sixth because a
				// control inside a row takes the ROW's own hover step, exactly as the two
				// 24px controls beside it do: its ground is the row's state, not a menu's.
				"hover:bg-row-hover": 6,
				// `rowCurrent` (1), the ground that beats the step above by merge order.
				"hover:bg-row-selected": 1,
				// The New chat row's disabled reset: it paints NOTHING, which is why no
				// expression has to resolve it. The bulk read receipt carries no reset of
				// its own: it is the shared `Button` primitive now, whose disabled styling
				// lives in that component, and its in-flight state is `aria-disabled`
				// rather than `disabled` — so it never paints as a disabled control.
				"hover:bg-transparent": 1,
			},
		],
		[
			SETTINGS_RAIL,
			{
				// The inactive section's own step (1).
				"hover:bg-row-hover": 1,
				// NO role-hover literal HERE ANY MORE: since round 5 the rail's current
				// branch applies the chat panel's imported `rowCurrent` (design D22,
				// agent A-7), so the role's hover half is no longer a literal in this
				// file at all. That half of the row is accounted for by the
				// declaration's own count in `SIDEBAR` and by the rail's `CURRENT`
				// entry, which resolves this expression through the shipped `cn` and
				// fails without the ground; the one spelling is asserted in the test
				// above.
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
 * `rowCurrent` — the chat list, the settings rail, the app rail, both agent
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
const CANVAS_SECTION =
	"src/renderer/src/features/chat/components/canvas/index.tsx";
const FILE_ROW =
	"src/renderer/src/features/chat/components/canvas/file-row.tsx";
const SCHEDULE_ROW =
	"src/renderer/src/features/schedules/components/schedule-list-item.tsx";
const BROWSER_TABS =
	"src/renderer/src/features/browser/components/browser-tab-strip.tsx";

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
	const at = source.indexOf(anchor);
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
		expression: () => expressionBefore(SIDEBAR, '"min-w-0 grow text-left"'),
		stubs: { rowStyle, rowCurrent, nested: false, current: true },
		ground: () => literalClassAt(SIDEBAR, 'aria-label="Chats"', "after"),
		groundFile: SIDEBAR,
	},
	{
		what: "the settings rail",
		rowFile: SETTINGS_RAIL,
		expression: () =>
			expressionAfter(
				SETTINGS_RAIL,
				'aria-current={isActive ? "page" : undefined}',
			),
		stubs: { labelled: true, isActive: true, rowCurrent },
		ground: () =>
			literalClassAt(SETTINGS_RAIL, 'aria-label="Settings sections"', "after"),
		groundFile: SETTINGS_RAIL,
	},
	{
		/*
		 * THE SURFACE THIS TABLE WAS WRITTEN FOR. Its `<nav>` was `bg-sunken` and
		 * the ground now has to come from the row's own element's ANCESTOR, which is
		 * why this one entry resolves a `cn(...)` rather than a literal: the rail's
		 * class list is built from `expanded` and the two width constants.
		 */
		what: "the app rail (the surface that is not the row's own)",
		rowFile: APP_RAIL,
		expression: () => expressionAfter(APP_RAIL, "data-tour-tag={item.tourTag}"),
		stubs: { expanded: true, item: { isActive: true }, rowCurrent },
		ground: () =>
			merged(
				APP_RAIL,
				expressionBefore(APP_RAIL, "group flex shrink-0 flex-col"),
				{
					expanded: true,
					RAIL_WIDTH: { expanded: "w-[220px]", collapsed: "w-12" },
				},
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
		 * The canvas Files list. It is a `rowCurrent` call site like the other six
		 * and it is on the canvas SECTION's `surface`; it is here because the
		 * completeness assertion below is over the tree rather than over the list of
		 * surfaces the direction happens to name, and a call site nobody enumerates
		 * is exactly how the rail's ground went unmeasured.
		 */
		what: "the canvas Files list",
		rowFile: FILE_ROW,
		expression: () => expressionBefore(FILE_ROW, 'data-tour-tag="file-row"'),
		stubs: { rowCurrent, current: true },
		ground: () =>
			merged(
				CANVAS_SECTION,
				expressionAfter(CANVAS_SECTION, "data-canvas-shortcuts"),
				{},
			),
		groundFile: CANVAS_SECTION,
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
 * THE PLATE INSIDE A ROW, AND THE HALF THE PALETTE GATE CANNOT SEE.
 *
 * The rail's account row is a row state's host (`hover:bg-row-hover`) and it
 * contains an element with a ground of its own — the avatar plate. That plate
 * was chosen when the rail was `sunken`, and re-grounding the rail to `surface`
 * did not touch it, which left a shape this file's own tables do not cover: an
 * element INSIDE a row, on a rung, with the row painting a fill underneath it.
 *
 * The pair under the pointer collapses on the shipped values: `elevated` against
 * `rowHover` is byte-identical on `arcade` (ΔE00 0.00) and inside the field floor
 * on `gruvbox` 1.14, `obsidian` 1.21 and `everforest` 1.90 — hover the row at any
 * of the four and the plate is a disc of the row's own hover colour. That is not a
 * value to re-solve: a row state is authored as a STEP of the panel it sits on, so
 * some palette's state will always land on some rung (16 of the 59 already land
 * within ΔE00 2.0 of `elevated` on `rowSelected`, which is why no fill role is
 * collision-free). So the plate carries `border-control` — this system's role for
 * an edge that IS the boundary of a thing, floored at 3:1 against every ground —
 * and THAT is what this test pins, because it is the half a colour gate cannot see.
 *
 * The colour half is `scripts/contrast-contract.mjs`'s, per palette: `elevated`
 * against `rowHover` at the field floor OR `border-control` against `rowHover` at
 * the non-text floor. On exactly the four palettes the fill fails, the edge clears
 * (3.18 `arcade`, 3.13 `gruvbox`, 3.27 `obsidian`, 3.10 `everforest`), so neither
 * half is decoration and neither file can make the other's assertion — the same
 * split `ROW_STATE_GROUNDS` above records for the grounds.
 *
 * The pair is `rowHover` and NOT `rowSelected`, and that scope is asserted below
 * rather than implied: the account row is not a destination, so it never paints
 * `rowCurrent` and the plate can never be painted over a selection. If it ever
 * does, the pair in the palette gate has to grow, and it does not clear today.
 */
const ACCOUNT_ROW =
	"src/renderer/src/shared/components/navigation/user-profile-sidebar.tsx";

test("the account row's plate carries an edge a row state cannot overrun", () => {
	const row = sourceOf(ACCOUNT_ROW);
	assert.ok(
		row.includes("hover:bg-row-hover"),
		`${ACCOUNT_ROW} no longer takes \`rowHover\` under the pointer, so the pair \`scripts/contrast-contract.mjs\` asserts for its plate no longer describes this row. Re-derive that pair before removing this one`,
	);
	assert.ok(
		!row.includes("rowCurrent"),
		`${ACCOUNT_ROW} now paints or names \`rowCurrent\`, so the account row IS a destination and its plate can be painted over a selection as well as a hover — the pair in \`scripts/contrast-contract.mjs\` has to gain \`rowSelected\`, which it is not satisfiable against today (16 of the 59 palettes sit inside ΔE00 2.0 of \`elevated\` on \`rowSelected\`)`,
	);
	const plate = literalClassAt(ACCOUNT_ROW, "<AvatarFallback", "after")
		.split(/\s+/)
		.filter((c) => c.length > 0);
	assert.ok(
		plate.includes("bg-elevated"),
		`the account row's plate no longer paints \`bg-elevated\` — it reads ${JSON.stringify(plate)}. \`scripts/contrast-contract.mjs\` asserts the plate's fill as \`elevated\` against \`rowHover\`, so a re-role here has to move there too`,
	);
	assert.ok(
		plate.includes("border-control"),
		`the account row's plate is back on a FILL ALONE — it reads ${JSON.stringify(plate)} and carries no \`border-control\`, which is the one property a row's fill cannot overrun. \`elevated\` against \`rowHover\` is ΔE00 0.00 on \`arcade\` (byte-identical), 1.14 \`gruvbox\`, 1.21 \`obsidian\` and 1.90 \`everforest\`: hovering the row turns the plate into a disc of the row's own hover colour. The edge is the carrier, and the palette half of the pair is in \`scripts/contrast-contract.mjs\``,
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
 * WHAT IT CANNOT SEE, stated rather than implied, because a guard read as broader
 * than it is is worse than a narrow one: a ground carried by a component whose
 * default lives in another file is recognised only for the primitives in
 * `CARRIED_GROUNDS`, and each of those is read from that component's own class
 * expression in the test below — a NEW primitive with a default ground, or a
 * carrier behind any other component boundary, is review's business rather than
 * this scan's, the way `scripts/chrome-keychain.test.mjs` states the roots its
 * own scan does not reach.
 *
 * FOUR OF THE SEVEN CARRIERS ARE EXEMPT, and each exemption carries the FACT it
 * rests on so the record cannot rot into a sentence:
 *   - the canvas file row's `img`/`video` thumbnail: its `sunken` is the ground
 *     BEHIND real content (`object-cover` fills the box), so what the reader sees
 *     is the picture; the loading placeholder is the only state in which the fill
 *     shows, and a ring here would box every thumbnail in every row;
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
	"hover:bg-row-hover",
	"hover:bg-row-selected",
];
const GROUND_ROLES = ["bg-elevated", "bg-sunken", "bg-surface", "bg-canvas"];

/*
 * The primitives that carry a ground by DEFAULT, so a call site with no
 * `className` is still an object over its row: an `<AvatarFallback>` with no
 * override paints the primitive's `sunken`. Read from the component's own class
 * expression by the test below rather than trusted here.
 */
const CARRIED_GROUNDS = {
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
			if (
				!hostClass ||
				!ROW_STATE_TOKENS.some((token) => hostClass.includes(token))
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
					const tokens = own.split(/["'\s]+/).filter(Boolean);
					const grounds = GROUND_ROLES.filter((role) => tokens.includes(role));
					if (grounds.length === 0) continue;
					seen.add(inner[0]);
					found.push({ file, element, host, grounds, classes: own });
					continue;
				}
				const carried = CARRIED_GROUNDS[element];
				if (!carried) continue;
				seen.add(inner[0]);
				found.push({
					file,
					element,
					host,
					grounds: [carried.ground],
					classes: expressionAfter(carried.file, carried.anchor),
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
		what: "the rail's account plate",
		file: ACCOUNT_ROW,
		element: "AvatarFallback",
		edge: true,
	},
	{
		what: "the agents sidebar's avatar",
		file: AGENTS_SIDEBAR,
		element: "AvatarFallback",
		edge: true,
	},
	{
		what: "the schedules list's switch",
		file: SCHEDULE_ROW,
		element: "Switch",
		edge: true,
	},
	{
		what: "the canvas file row's image thumbnail",
		file: FILE_ROW,
		element: "img",
		edge: false,
		fact: "object-cover",
	},
	{
		what: "the canvas file row's video thumbnail",
		file: FILE_ROW,
		element: "video",
		edge: false,
		fact: "object-cover",
	},
	{
		what: "the browser tab strip's chrome cluster",
		file: BROWSER_TABS,
		element: "div",
		edge: false,
		fact: "absolute",
	},
	{
		what: "the browser tab strip's notch",
		file: BROWSER_TABS,
		element: "span",
		edge: false,
		fact: "-bottom-px",
	},
];

test("every object a row state can paint over keeps an edge, or records why it need not", async () => {
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
			tokens.includes(carried.ground),
			`<${name}> no longer paints \`${carried.ground}\` in its own class expression (${carried.file}, ${carried.anchor}), so a call site with no \`className\` is no longer an object over its row and \`CARRIED_GROUNDS\` is stale. Got: ${JSON.stringify(tokens.filter((t) => t.startsWith("bg-")))}`,
		);
	}

	const found = await carriersInsideRowStates();
	const key = (entry) => `${entry.file}#${entry.element}`;
	assert.deepEqual(
		found.map(key).sort(),
		PLATES_INSIDE_ROW_STATES.map(key).sort(),
		`${found.length} object(s) inside a row state carry a ground of their own and ${PLATES_INSIDE_ROW_STATES.length} are named in \`PLATES_INSIDE_ROW_STATES\`. The rule is that an object inside a row state keeps its own edge — a row state is a step of the panel it sits on, so on some palette it lands on the object's own rung and the object disappears into the row (measured: \`elevated\` against \`rowHover\` is ΔE00 0.00 on \`arcade\`, \`sunken\` against \`rowSelected\` 0.44 on \`alucard\`). Either give the new object \`border-control\` and name it here, or name it with the fact that makes an edge unnecessary: ${JSON.stringify(found.map(key))} vs ${JSON.stringify(PLATES_INSIDE_ROW_STATES.map(key))}`,
	);

	for (const entry of PLATES_INSIDE_ROW_STATES) {
		const hit = found.find((candidate) => key(candidate) === key(entry));
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
