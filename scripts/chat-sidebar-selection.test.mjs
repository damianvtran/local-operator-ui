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
 * WHAT IT CANNOT PROVE: that the ground is *visible*, and that it steps in the
 * right DIRECTION. Both are properties of the role against its neighbours across
 * every palette, and they are `scripts/contrast-contract.mjs`'s job — it asserts
 * `highlight` against `surface`, `elevated` and `sunken` at its own band floor of
 * ΔE00 4.0 and the field floor of 2.0 respectively, and it asserts the SIGN of
 * the `L*` step (lighter on a dark palette, darker on a light one, with a floor on
 * the magnitude), because the authored values across the tree land 4.00-5.97 from
 * `surface` (the twelve this rule was authored against at 4.01-4.15) and 3.0 or
 * better `L*` in that direction, the six ink-capped palettes pinned by name. It also cannot
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

/**
 *
 * Whether a resolved class list carries the current row's GROUND.
 *
 * A single token, unlike the two it took while the row also carried a 1px
 * `outline-control` ring beside it: that half is retired (design round 1, D3 —
 * the role is § 2's *sole boundary of a control* and both rails drew it with the
 * search field's own ink, radius and height, so the current row read as a filled
 * field). The mark is the ground plus `font-medium`, and both are asserted here.
 */
const carriesGround = (classes) => classes.includes("bg-highlight");

const rowStyle = literalOf(SIDEBAR, "rowStyle");
const rowCurrent = literalOf(SIDEBAR, "rowCurrent");

/*
 * The current row's mark, and which elements carry it.
 *
 * `ground` is what makes the row readable as the current one. The entity row's
 * name button carries it as well as its wrapper, deliberately: it carries
 * `rowStyle`, so its own `hover:bg-elevated` would otherwise paint over the
 * wrapper's ground — round 1's MAJOR — and the ground on both is one state spread
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
		 * Anchored on the row's own tour tag rather than on its predicate: the
		 * predicate is named ONCE (`isCurrent`) because the ground and
		 * `aria-current` both read it, so it no longer sits inside this element's
		 * `cn(...)` for a backward search to find.
		 */
		expression: () =>
			expressionAfter(SIDEBAR, 'data-tour-tag="chat-session-row"'),
		stubs: {
			revealArmed: true,
			rowStyle,
			rowCurrent,
			nested: false,
			isCurrent: true,
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
		stubs: { revealArmed: true, rowCurrent, isCurrent: true },
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
		stubs: { revealArmed: true, pinned: false, isCurrent: true },
		ground: false,
		notCurrent: { revealArmed: true, pinned: false, isCurrent: false },
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
		`the current row's ground must be the role authored for it — \`highlight\`, a LIGHTNESS step off \`surface\` in the direction the mode runs, larger than the ΔE00 2.18-2.28 band the operator reported as invisible and larger than the well it replaced (\`sunken\`, 3.75-14.94, the dark box he reported). The band's floor, the direction of the step and a floor on its magnitude are asserted in \`scripts/contrast-contract.mjs\`, which is where a colour can be measured. Got:\n${rowCurrent}`,
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
 * THE TWO NON-COLOUR STEPS, and why a ground is not enough on its own.
 *
 * A ground alone has to outrank the step the rows AROUND it take under the
 * pointer, and it cannot: the ink floors on `highlight` cap how far the row's
 * mark can climb (the caps and the `· lopdev` binding inside a current row are
 * drawn in `ink-dim`), while the hover step the neighbouring rows carry is
 * `elevated`, which is also every menu, popover and tooltip ground in the app
 * and so is not a value this panel can move. On eight of the twelve palettes
 * `elevated` is therefore still the LARGER step off `surface`, so the row carries
 * `font-medium` — the non-colour step the settings rail's active row already
 * carried, now on both rails (the test below). That is the whole of the second
 * step: an earlier round added a 1px `outline-control` boundary beside the
 * ground and it is RETIRED (design round 1, D3), because `border-control` is § 2's
 * *sole boundary of a control* and both rails drew it with the search field's own
 * ink, height and radius — the current row read as a filled field.
 *
 * The operator's own report is the reason the ground ITSELF also rose, and it is
 * why the role is a LIGHTNESS step: he asked first for a SUBTLE selection, saw it
 * rendered, and reported the current row as invisible beside a hovered neighbour
 * — so the role now lands ΔE00 4.01-4.15 from `surface` and 3.81-6.62 `L*` away
 * from it in the direction the mode runs, where it was authored at ΔE00
 * 2.18-2.28. `scripts/contrast-contract.mjs` states that band, asserts the
 * DIRECTION of the step and floors its magnitude; this file cannot see a colour
 * at all.
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
		`the entity row's name button no longer paints the current row's ground, so on the row whose pointer is somewhere else the mark is carried by the wrapper alone — and this element's own \`hover:bg-elevated\` is what then paints over it (round 1's MAJOR):\n${inner}`,
	);
});

test("the mark is colour plus weight, and neither one can move the row", () => {
	/*
	 * The guard on the CONSTANT. `bg-highlight` and `font-medium` are both paint,
	 * and the row's box has to be untouched by the mark: the New chat row's own
	 * comment records that a 1px `border-control` there stepped its icon and label
	 * 1px out of line with the row above (the app is `box-sizing: border-box`), and
	 * the operator asked for that border to go. So no class in the mark may carry
	 * geometry, which is asserted on the tokens rather than described.
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
		!rowCurrent.includes("outline-control"),
		`the current row is drawn with a \`border-control\`-role boundary again; that role is § 2's *sole boundary of an input, select, checkbox or outlined button*, and the ring rendered as the search field one row below the list (design round 1, D3):\n${rowCurrent}`,
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
				// (1), whose own guard is `!isCurrent` (its `CURRENT` entry above resolves
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
	const source = code.get(SIDEBAR);
	const declared = source.indexOf("const isCurrent =");
	assert.notEqual(
		declared,
		-1,
		"the session row no longer names its current-row predicate, so the ground, the edge and `aria-current` are written out separately and can disagree",
	);
	/*
	 * Both halves of the predicate, on all three readers: a row that paints a mark
	 * the accessibility tree does not claim misreports where the user is for a
	 * screen reader, and one that claims a mark it does not paint does it for
	 * everyone else. `!activeDraftKey` is what says a staged draft owns the mark
	 * instead. The declaration is the single place the two terms may live, and the
	 * other two readers have to READ it — which is why they are asserted against
	 * the name and the name against the terms, rather than each against the terms.
	 */
	const declaration = source.slice(declared, source.indexOf(";", declared));
	for (const term of [
		"selectedConversation === row.session_id",
		"!activeDraftKey",
	]) {
		assert.ok(
			declaration.includes(term),
			`\`isCurrent\` no longer reads \`${term}\`, so the row's mark and \`aria-current\` can disagree about which row is the current one:\n${declaration}`,
		);
	}
	const ariaCurrent = source.slice(
		source.indexOf("aria-current=", declared),
		declared +
			source
				.slice(declared)
				.indexOf("\n", source.indexOf("aria-current=", declared)),
	);
	assert.ok(
		ariaCurrent.includes("isCurrent"),
		`the session row's \`aria-current\` no longer reads the shared predicate:\n${ariaCurrent}`,
	);
	const rowClasses = argumentsFrom(
		source,
		source.indexOf("className={cn(", declared),
	);
	assert.ok(
		rowClasses.includes("isCurrent"),
		`the session row's class list no longer reads the shared predicate, so it can paint a mark the accessibility tree does not claim:\n${rowClasses}`,
	);
});
