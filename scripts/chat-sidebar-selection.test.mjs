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
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

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
		what: "the selected conversation",
		file: SIDEBAR,
		/*
		 * ANCHORED ON THE BUTTON'S OWN CLASS EXPRESSION, not on the predicate: the
		 * predicate is declared once now (review round 1, A7) and the row reads the
		 * name, so the element to resolve is the one carrying `rowStyle`.
		 */
		expression: () => expressionBefore(SIDEBAR, '"min-w-0 grow text-left"'),
		stubs: {
			rowStyle,
			rowCurrent,
			nested: false,
			current: true,
		},
		ground: true,
	},
	{
		what: "the All chats filter",
		file: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, ">All chats</span>"),
		stubs: { rowStyle, rowCurrent, all: true },
		ground: true,
	},
	{
		what: "the New chat row",
		file: SIDEBAR,
		expression: () => expressionBefore(SIDEBAR, ">New chat</span>"),
		stubs: {
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
		stubs: { rowCurrent, staged: true },
		ground: true,
	},
	{
		/* The element round 1's MAJOR was about: it carries `rowStyle`, so its
		   hover step is what used to paint over the wrapper's ground. It carries
		   the GROUND too, which is asserted below. */
		what: "the entity row's name button",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-entity-name"),
		stubs: { rowStyle, rowCurrent, staged: true },
		ground: true,
	},
	{
		what: "the entity row's disclosure control",
		file: SIDEBAR,
		expression: () => expressionAfter(SIDEBAR, "data-disclosure"),
		stubs: { staged: true },
		ground: false,
		notCurrent: { staged: false },
	},
	{
		what: "the entity row's manage control",
		file: SIDEBAR,
		expression: () =>
			expressionBefore(SIDEBAR, "aria-label={`Manage ${name}`}"),
		stubs: { staged: true },
		ground: false,
		notCurrent: { staged: false },
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
		stubs: { labelled: true, isActive: true, rowCurrent },
		ground: true,
		notCurrent: { labelled: true, isActive: false, rowCurrent },
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
				// 24px controls' `!staged` guards (2); the disclosure HEADING row
				// (1), which is never a current row — it holds a section, and the panel
				// marks the row the reader is IN, not the heading above it; and the
				// "Mark all N read" control (1), which is a heading-row sibling too —
				// a list-level action for a set the store owns, never the row the reader
				// is in, so no `CURRENT` entry can ever be asked to resolve it.
				"hover:bg-elevated": 5,
				// `rowCurrent` (1), the ground that beats the step above by merge order.
				"hover:bg-highlight": 1,
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
				"hover:bg-elevated": 1,
				// NO `hover:bg-highlight` HERE ANY MORE: since round 5 the rail's current
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
	/*
	 * THE PREDICATE IS NAMED ONCE, AND THAT IS THE PROPERTY (review round 1, A7).
	 * It used to be written out at the wrapper, at the button and at the deleted
	 * browser mark — and the mark's own copy is what let it paint `hover:bg-elevated`
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
