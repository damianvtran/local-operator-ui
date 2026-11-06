/**
 * A floating surface separates by surface contrast and elevation, never by a
 * stroke.
 *
 * THE OPERATOR'S REPORT IS WHAT THIS PINS (2026-11-06): four screenshots of a
 * session-list tooltip, the canvas rail's tooltip, the agent-profile popover and
 * the sidebar overflow menu, each a rounded 1px lighter-than-surface stroke on a
 * panel that had already left the flow. The stroke was doing a job it could not do
 * well - a hairline measures 1.03-1.18:1 against the panel's own fill, i.e. a
 * boundary of nothing - while the ambient half of `--shadow-overlay` starts 12px
 * out and left the panel's actual edge bare. So the panels lost the border and the
 * shadow gained a contact layer that darkens the boundary itself (see
 * "-- elevation --" in `styles/index.css`), and this file makes that a rule rather
 * than a preference.
 *
 * WHAT IT ASSERTS, in the two directions the contract needs:
 *
 *  O-1  SOURCE, DERIVED. Every JSX opening tag in the renderer that wears
 *       `shadow-overlay` carries no border utility. `shadow-overlay` is the one
 *       shadow in the system and by § 2 it belongs ONLY to objects that leave the
 *       flow, so "wears the shadow" is the app's own vocabulary for "is floating",
 *       and a floating panel may not have a stroke. Deriving the population this
 *       way - rather than from a hand-kept list - is what makes a NEW panel of the
 *       shape a decision: it is covered the moment it wears the shadow, and adding
 *       a hairline to it fails here without anyone remembering to add a row.
 *       O-1b is the walk's own negative control.
 *
 *  O-3  THE PRIMITIVES, BY ELEMENT. Each portalled primitive's panel element
 *       carries `data-lo-floating`. That marker is what names the set for
 *       stylesheets and for a reader; it is asserted per ELEMENT, not per file, so
 *       a marker that drifts onto a wrapper (or onto the content div rather than
 *       the panel) is caught.
 *
 *  O-4  THE STYLESHEET. No rule whose selector names `[data-lo-floating]` may
 *       declare a border property - the marker exists to make the rule reachable
 *       from CSS, and a stylesheet that re-adds a stroke is the one place a class
 *       scan cannot see. O-5 holds the token's SHAPE: `--shadow-overlay` must
 *       compose a contact layer (`--lo-shadow-contact`) with the palette ambient.
 *       Removing the contact layer is the regression that would silently undo this
 *       whole change: every panel would keep its ground and lose its edge, and no
 *       ratio in `contrast-contract.mjs` would move.
 *
 * WHAT "COMPUTED BORDER-WIDTH IS 0" RESTS ON. There is no DOM here, so the
 * computed value is argued rather than measured, and the argument is the two
 * assertions above: a panel's border-width can only come from a class utility
 * (O-1) or from a stylesheet rule (O-4), and this file fails on both. That covers
 * exactly what this codebase writes. The residue is the same one
 * `glass-overlay.test.mjs` names for its own derivation, plus one this change
 * measured: the walk delimits an opening tag by brace depth and quotes and cannot
 * delimit every tag in the largest JSX files - `/`-commands, the skill picker and
 * the Bridge mention popover are NOT reached through `openingTags` (probed
 * directly), so their borders were removed by hand and this file holds them only
 * as far as the stylesheet assertion reaches.
 *
 * Beyond the walk's reach: an INLINE `style` that sets a border, a class string
 * composed at runtime, and a class constant imported from another module - so this
 * file does not promise no panel can ever again carry a stroke, it promises that
 * the two shapes this codebase writes are decisions.
 * The rendered confirmation over real themes and over window glass is a browser
 * run's evidence, not this file's.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { openingTags } from "./jsx-opening-tags.mjs";

const ROOT = process.cwd();
const RENDERER = "src/renderer/src";
const UI_DIR = "src/renderer/src/shared/components/ui";
const CSS_PATH = "src/renderer/src/styles/index.css";
const read = (path) => readFileSync(join(ROOT, path), "utf8");

/**
 * A border utility, and deliberately not a substring test.
 *
 * The lookbehind matters: `\bborder\b` matches inside `box-border` (`-` is a word
 * boundary and `b` is a word character), and `box-border` is a layout utility that
 * appears on the same elements as the floats it must not red on. The exclusions are
 * the two `border-*` utilities that are not strokes at all: a table's
 * `border-collapse` and `border-spacing`.
 *
 * LINE COMMENTS ARE STRIPPED FIRST, and that is a measured correction rather than
 * tidiness: the browser's address suggestions carry a `//` note inside their
 * opening tag that says which `border-*` role the element used to take, and
 * without this the walk read the PROSE as a declaration and red a panel that has no
 * border at all. A guard that fails on a comment teaches people to delete the
 * comment, which is the opposite of what this file is for. `openingTags` strips
 * block comments for the same reason. The `(?<!:)` keeps a `//` inside a URL
 * (`https://...`) from eating the rest of the tag - the cost of a wrong guess there
 * is a narrower scan, never a false red.
 */
const stripLineComments = (text) => text.replace(/(?<!:)\/\/[^\n]*/g, " ");

const BORDER_UTILITY =
	/(?<![\w-])border(?:-[a-z0-9-]+)?(?![\w-])(?!-collapse|-spacing)/g;

const borderUtilities = (text) =>
	[...stripLineComments(text).matchAll(BORDER_UTILITY)].map(
		(match) => match[0],
	);

/** Every renderer `.tsx`/`.ts` outside the primitive layer, minus stories and tests. */
const rendererFiles = (dir = RENDERER, out = []) => {
	for (const entry of readdirSync(join(ROOT, dir))) {
		const path = `${dir}/${entry}`;
		if (statSync(join(ROOT, path)).isDirectory()) rendererFiles(path, out);
		else if (
			(entry.endsWith(".tsx") || entry.endsWith(".ts")) &&
			!entry.includes(".stories.") &&
			!entry.includes(".test.")
		)
			out.push(path);
	}
	return out;
};

/**
 * The portalled primitives whose panel element carries the marker.
 *
 * Named here rather than derived from "renders a Portal", because `sheet.tsx` and
 * `dialog.tsx` wrap `*Primitive.Content` in their own component and the walk said
 * the population by hand the last time this was derived (`glass-overlay.test.mjs`,
 * `PORTAL_RENDERERS`). Two derivations of the same population that could disagree
 * is worse than one list a reader can check against the files.
 */
const FLOATING_PRIMITIVES = [
	"context-menu.tsx",
	"dialog.tsx",
	"dropdown-menu.tsx",
	"popover.tsx",
	"select.tsx",
	"sheet.tsx",
	"tooltip.tsx",
];

test("O-1 no element that wears the floating shadow wears a border", () => {
	const offenders = [];
	for (const path of rendererFiles()) {
		for (const tag of openingTags(read(path))) {
			if (!/\bshadow-overlay\b/.test(tag.text)) continue;
			const borders = borderUtilities(tag.text);
			if (borders.length > 0)
				offenders.push(`${path}: <${tag.name}> ${borders.join(", ")}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`a floating surface separates by its ground and the one shadow, never by a stroke (branding § 2; operator report 2026-11-06). Remove the border utility, keeping the ground and \`shadow-overlay\`:\n${offenders.join("\n")}`,
	);
});

test("O-1b the derivation reaches the app's floating panels", () => {
	/*
	 * A NEGATIVE CONTROL ON THE WALK ITSELF, so a refactor that stops the scan from
	 * seeing class strings cannot pass as a clean tree. `openingTags` is shared with
	 * two other contracts and has already been corrected once for a quote-handling
	 * bug that made it stop visiting a whole file (see its header); this test fails
	 * loudly if the population it derives collapses.
	 */
	const withShadow = rendererFiles().filter((path) =>
		/\bshadow-overlay\b/.test(read(path)),
	);
	assert.ok(
		withShadow.length >= 20,
		`expected the renderer's floating panels to be visible to the walk, found ${withShadow.length} files - a walk that sees nothing passes every assertion above`,
	);
});

test("O-3 every portalled primitive marks its panel element", () => {
	const missing = [];
	for (const file of FLOATING_PRIMITIVES) {
		const path = `${UI_DIR}/${file}`;
		const tagged = openingTags(read(path)).filter((tag) =>
			tag.text.includes("data-lo-floating"),
		);
		if (tagged.length === 0) missing.push(path);
	}
	assert.deepEqual(
		missing,
		[],
		`the marker is what names the floating set for stylesheets and for a reader; it belongs on the PANEL element of each portalled primitive:\n${missing.join("\n")}`,
	);
});

test("O-4 no stylesheet rule paints a border on a marked panel", () => {
	const css = read(CSS_PATH).replace(/\/\*[\s\S]*?\*\//g, "");
	const offenders = [];
	for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [, selector, body] = match;
		if (!selector.includes("[data-lo-floating]")) continue;
		if (/(?<![\w-])border(?:-[a-z0-9-]+)?\s*:/i.test(body))
			offenders.push(selector.trim());
	}
	assert.deepEqual(
		offenders,
		[],
		`a rule on [data-lo-floating] re-added a border property. The boundary is the elevation's contact layer, not a stroke:\n${offenders.join("\n")}`,
	);
});

test("O-5 the one shadow composes a contact layer with the palette ambient", () => {
	const css = read(CSS_PATH).replace(/\/\*[\s\S]*?\*\//g, "");
	const declaration = /--shadow-overlay:\s*([^;]+);/.exec(css)?.[1];
	assert.ok(
		declaration !== undefined,
		"--shadow-overlay is gone; every floating panel in the app separates through it",
	);
	assert.match(
		declaration,
		/var\(--lo-shadow-contact\)/,
		"the ambient alone starts 12px out and leaves the panel's own edge bare, which is the gap the border used to cover: the contact layer is not optional",
	);
	assert.match(
		declaration,
		/var\(--lo-shadow-ambient\)/,
		"the palette-ambient layer is still the far field; dropping it flattens every panel onto its background",
	);
	/* The ambient arrives through a named pass-through rather than inline, because the
	 * theme generator requires each palette role to appear in @theme as a pairing whose
	 * value is a bare `var()` of that role (see the token's own comment). Following it
	 * one step keeps the assertion about the SHADOW rather than about the spelling. */
	assert.match(
		/--lo-shadow-ambient:\s*var\(--lo-overlay-shadow\);/.exec(css)?.[0] ?? "",
		/var\(--lo-overlay-shadow\)/,
		"`--lo-shadow-ambient` must be the palette's own `--lo-overlay-shadow`, not a hand-tuned constant; the palettes are where the ambient was tuned",
	);
	/*
	 * A CONTACT LAYER IS NOT A RING. `0 0 0 1px` is a border drawn with a shadow -
	 * zero blur, so it has the hard edge and the exact 1px of the stroke this change
	 * removed, and it would reintroduce the operator's complaint while passing every
	 * assertion above. The contact layers must have BLUR and a negative spread, which
	 * is what makes the darkening falloff rather than draw a line.
	 */
	const contact = /--lo-shadow-contact:\s*([^;]+);/.exec(css)?.[1];
	assert.ok(contact !== undefined, "--lo-shadow-contact is gone");
	for (const layer of declaration.match(/0\s+0\s+0\s+1px/g) ?? [])
		assert.fail(
			`\`${layer}\` is a zero-blur spread ring, i.e. a border drawn with a shadow; use a blurred, negatively-spread contact instead`,
		);
});
