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
 * WHAT IT CANNOT PROVE: that the ground is *visible*. That is a property of the
 * role against its neighbours across every palette, and it is
 * `scripts/contrast-contract.mjs`'s job — it asserts `highlight` against
 * `surface`, `elevated` and `sunken` at the field floor of ΔE00 2.0, with the
 * authored values measuring 2.18-2.28 from `surface`, 2.52-5.05 from `elevated`
 * (the row's hover step, the binding pair) and 2.15-15.43 from `sunken`. It also
 * cannot prove the row reads as the current one on screen; that is the frames in
 * `docs/evidence/chat-sidebar-selection/`.
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
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

const ROOT = process.cwd();
const SIDEBAR = "src/renderer/src/features/chat/components/chat-sidebar.tsx";
const SETTINGS_RAIL =
	"src/renderer/src/features/settings/components/settings-sidebar.tsx";
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
	const source = code.get(file);
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
	const source = code.get(file);
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
	const source = code.get(file);
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

const rowStyle = literalOf(SIDEBAR, "rowStyle");
const rowCurrent = literalOf(SIDEBAR, "rowCurrent");

/* The four chat call sites and the entity row's three elements. Every predicate
   is stubbed TRUE, so each entry is the class list that element carries while
   its row is the current one. */
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
		expression: () => expressionAfter(SIDEBAR, "data-child"),
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
		stubs: { revealArmed: true, rowCurrent, current: true },
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
		   hover step is what used to paint over the wrapper's ground. */
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
		what: "the settings rail's current section",
		file: SETTINGS_RAIL,
		expression: () =>
			expressionAfter(
				SETTINGS_RAIL,
				'aria-current={isActive ? "page" : undefined}',
			),
		stubs: { revealArmed: true, labelled: true, isActive: true },
		ground: true,
		notCurrent: { revealArmed: true, labelled: true, isActive: false },
	},
];

test("the current row's ground is a step off its panel, not a wash", () => {
	assert.ok(
		rowCurrent.includes("bg-highlight"),
		`the current row's ground must be the role authored for it — \`highlight\`, a shallow step off \`surface\` in the direction the mode runs (ΔE00 2.18-2.28): above the perceptual threshold, and under the \`sunken\` well it replaced (3.75-14.94, the operator's dark box). Got:\n${rowCurrent}`,
	);
	assert.ok(
		!rowCurrent.includes("bg-accent-wash"),
		`\`accent-wash\` is ΔE00 1.05 from the chat panel's ground in tokyoNight — the defect this row was reported for. Got:\n${rowCurrent}`,
	);
	assert.ok(
		rowCurrent.includes("text-ink"),
		`the ground is a ground for text, and \`ink\` is the role whose 7:1 floor \`highlight\` is asserted on. Got:\n${rowCurrent}`,
	);
});

/*
 * THE SECOND SIGNAL, and why one ground is not enough.
 *
 * A ground alone has to outrank the step the rows AROUND it take under the
 * pointer, and after the selection was quietened it stopped doing so: measured in
 * the shipped frames, a hovered neighbour paints `elevated` at ΔE00 2.20-4.58 from
 * the panel while the current row paints `highlight` at 2.18-2.35, so on the dark
 * palettes the pointer's transient mark became the louder of the two (selection
 * over hover was 0.93 / 0.97 / 1.89 before this change and 0.48 / 0.52 / 0.49
 * after — design round 1, D1). The answer is not a louder ground: the operator
 * asked for a SUBTLE selection, and raising `highlight` would trade that away.
 * It is the second, non-colour step the settings rail's active row has always
 * carried — `font-medium` — which is now on both rails rather than one.
 */
test("a current row carries a non-colour step, and a row that is not current does not", () => {
	assert.ok(
		rowCurrent.includes("font-medium"),
		`the current row must carry a second signal beside its ground: with the selection quietened, a hovered neighbour's \`elevated\` step outranks \`highlight\` on the dark palettes, so colour alone makes the pointer the louder mark. Got:\n${rowCurrent}`,
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

test("every current-row element keeps the ground under the pointer", () => {
	for (const site of CURRENT) {
		const classes = merged(site.file, site.expression(), site.stubs);
		if (site.ground) {
			assert.ok(
				classes.includes("bg-highlight"),
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
			!classes.includes("hover:bg-elevated"),
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
			classes.includes("hover:bg-elevated"),
			`${site.what} must keep the pointer's step while its row is NOT current:\n${classes}`,
		);
		assert.ok(
			!classes.includes("bg-highlight"),
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
				// it); and the disclosure HEADING row (1), which is never a current row —
				// it holds a section, and the panel marks the row the reader is IN, not
				// the heading above it.
				"hover:bg-elevated": 5,
				// `rowCurrent` (1), the ground that beats the step above by merge order.
				"hover:bg-highlight": 1,
				// The New chat row's disabled reset: it paints NOTHING, which is why no
				// expression has to resolve it.
				"hover:bg-transparent": 1,
			},
		],
		[SETTINGS_RAIL, { "hover:bg-elevated": 1, "hover:bg-highlight": 1 }],
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
	 * the element's own `rowStyle` carries `hover:bg-elevated`, so an expression
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
	 * Stated so a later reader cannot "fix" this by deleting `hover:bg-highlight`:
	 * the raw concatenation the browser would see WITHOUT `cn` carries both
	 * rules, and `hover:bg-elevated` wins on cascade order.
	 */
	assert.ok(
		`${rowStyle} ${rowCurrent}`.includes("hover:bg-elevated"),
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
	const source = read(SIDEBAR);
	/*
	 * ONE DECISION, FOUR CONSUMERS. The predicate used to be spelled out at each site
	 * that needed it; it is now computed once as `current`, because the row's box
	 * gained a second place that must carry the name of the same decision - the ground
	 * has to span the pin slot (review round 1, M1), and a container wearing a
	 * re-spelled copy of the predicate is how "the ground and the accessibility tree
	 * disagree" comes back.
	 *
	 * So the assertion is about the DECLARATION and its readers rather than about one
	 * class expression: a row that paints a ground the accessibility tree does not
	 * claim misreports where the user is for a screen reader, and one that claims a
	 * ground it does not paint does it for everyone else. `!activeDraftKey` is the
	 * second term and it is half the fact: a staged draft owns the current-row mark
	 * instead.
	 */
	const declarationAt = source.indexOf("const current = ");
	assert.notEqual(
		declarationAt,
		-1,
		"the session row no longer names its current-row decision once, so this file cannot say what its readers read",
	);
	const declaration = source.slice(
		declarationAt,
		source.indexOf(";", declarationAt),
	);
	for (const term of [
		"selectedConversation === row.session_id",
		"!activeDraftKey",
	]) {
		assert.ok(
			declaration.includes(term),
			`the current-row decision no longer reads \`${term}\`, so every site wearing it is making a different claim than the one this file checked:\n${declaration}`,
		);
	}
	/*
	 * ...and the literal is spelled ONCE. A second copy inside the row is the defect
	 * this test exists to catch, so the count is asserted rather than each site's text:
	 * a site that reads `current` cannot drift from the declaration, and a site that
	 * re-derives the predicate fails here before it can.
	 */
	const rowSource = source.slice(
		source.indexOf("const sessionRow = ("),
		source.indexOf("const entity = ("),
	);
	/*
	 * ...and every spelling in the row carries the SAME two terms. The count is not the
	 * property the shape needs any more - a site that reads the declaration cannot drift
	 * - but a site that RE-DERIVES the predicate with one term dropped is exactly how the
	 * ground and the accessibility tree part company, so each spelling is read for its
	 * terms rather than counted.
	 */
	const spellings = rowSource
		.split("selectedConversation === row.session_id")
		.slice(1);
	assert.ok(
		spellings.length >= 1,
		"the row wears the current-row predicate nowhere, so the mark below is unreachable",
	);
	for (const spelling of spellings) {
		assert.ok(
			/^\s*&&\s*!activeDraftKey/.test(spelling),
			`a site spells the current-row predicate with different terms than this file checked:\n${spelling.slice(0, 90)}`,
		);
	}
	const at = source.indexOf("aria-current={");
	assert.notEqual(at, -1, "the session row has no aria-current");
	const ariaCurrent = source.slice(
		at,
		source.indexOf("}", source.indexOf("?", at)),
	);
	assert.ok(
		ariaCurrent.includes("current"),
		`aria-current no longer reads the row's own decision, so it and the ground can disagree:\n${ariaCurrent}`,
	);
	/*
	 * Both elements that paint the mark are resolved from the shipped expressions with
	 * `current` stubbed true and false, which is the property the ground has to have
	 * after M1: on while the row is current (container and button), off when it is not.
	 */
	for (const what of [
		"the selected conversation",
		"the conversation row's box",
	]) {
		const site = CURRENT.find((entry) => entry.what === what);
		assert.notEqual(site, undefined, `\`${what}\` left the CURRENT table`);
		assert.ok(
			merged(site.file, site.expression(), {
				...site.stubs,
				current: true,
			}).includes("bg-highlight"),
			`${what} paints no ground while the row is current`,
		);
		assert.ok(
			!merged(site.file, site.expression(), {
				...site.stubs,
				current: false,
			}).includes("bg-highlight"),
			`${what} paints the current-row ground while the row is NOT current`,
		);
	}
});
