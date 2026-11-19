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
 *  O-2  CLASS CONSTANTS. A panel's chrome often lives in a constant rather than
 *       on the tag - `panelClasses` in the menu primitives, the sheet's `cva`,
 *       `FLOATING_TOOLBAR_CHROME`, inline-edit's `POPOVER` - and O-1 only reads
 *       tags, so before this assertion a border restored in `panelClasses`
 *       passed the whole suite (agent review round 1, R1; QA round 1, 7b/7d).
 *       Every `const` whose body wears `shadow-overlay`, and every same-file
 *       constant a marked primitive panel names, may carry no border utility.
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
 *       scan cannot see. The ONE sanctioned exception is
 *       `@media (forced-colors: active)`: forced-colors mode drops box-shadows, so
 *       there a panel would have no edge at all, and it draws a 1px `CanvasText`
 *       border. O-4b holds that rule to exactly that shape. O-5 holds the token's
 *       SHAPE: `--shadow-overlay` must
 *       compose a contact layer (`--lo-shadow-contact`) with the palette ambient.
 *       Removing the contact layer is the regression that would silently undo this
 *       whole change: every panel would keep its ground and lose its edge, and no
 *       ratio in `contrast-contract.mjs` would move.
 *
 *  O-6  ELEVATION SURVIVES FOCUS. The global focus rule resets `box-shadow` with
 *       `!important`; Radix focuses a menu's content on a pointer open, and that
 *       reset stripped every pointer-opened menu of its only separation (QA round
 *       1, Q1). Each bare focus selector carrying the reset must exclude
 *       `[data-lo-floating]`.
 *
 *  O-7  ONE SHADOW. A call site that passes another `shadow-*` utility to a
 *       floating primitive, or wears one beside `shadow-overlay`, makes
 *       tailwind-merge DROP `shadow-overlay` (its class group, `utils.ts`) - and
 *       with it the contact layer and the glass contact (agent review round 1,
 *       R3). The image lightbox's `DialogContent` is the one named exception, keyed
 *       by file AND tag so the rest of that file stays covered: it is not a panel.
 *
 *  O-8  WEARS THE SHADOW, CARRIES THE MARKER. The two stylesheet rules keyed on
 *       `[data-lo-floating]` (the focus reset's exclusion, O-6, and the
 *       forced-colors edge, O-4b) reach only what carries the marker, and ~25
 *       hand-rolled panels wore `shadow-overlay` without it - so the mini sheet
 *       and the update card, which focus THEMSELVES, lost their only separation on
 *       a keyboard open, and none of them got the forced-colors edge (agent review
 *       round 2, N1). The population is derived the O-1 way: every element that
 *       wears the one shadow is floating, including a floating CONTROL such as the
 *       scroll-to-bottom button - it leaves the flow over moving text exactly as a
 *       panel does, so it keeps its elevation on focus and gets the edge under
 *       forced colors. There is no exception list; a panel whose float is
 *       conditional (the ask drawer, the message strip) marks conditionally.
 *
 * WHAT "NO BORDER" RESTS ON. There is no DOM here, so a computed border-width is
 * argued rather than measured - this file asserts no computed value - and the
 * argument is the assertions above: a panel's border can only come from a class
 * utility (O-1, O-2) or from a stylesheet rule (O-4), and this file fails on each. That covers
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
 * the two shapes this codebase writes are decisions. O-8 has the same reach: a
 * surface that takes `var(--shadow-overlay)` through an inline style or a DOM
 * builder is not a class and is not counted. The canvas diff widget
 * (`code-editor-diff.ts`) sets the marker by hand; the toast container, the
 * spreadsheet's third-party theme and the search theme style elements this
 * renderer does not author, and are not marked.
 * The rendered confirmation over real themes and over window glass is a browser
 * run's evidence, not this file's.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { moduleLevelClassConstants } from "./jsx-class-constants.mjs";
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

/**
 * A class value for this guard: the shared resolver's strings and `cn(...)` calls,
 * plus the two shapes the primitives write their panel chrome in - an array
 * (`panelClasses`) and a `cva(...)` call (the sheet's variants).
 */
const PANEL_CLASS_VALUE = /^(cn|clsx|twMerge|cva)\(|^["`[]/;

test("O-2 no class constant a floating panel wears carries a border", () => {
	const offenders = [];
	let marked = 0;
	for (const path of rendererFiles()) {
		const source = read(path);
		const constants = moduleLevelClassConstants(source, {
			opening: PANEL_CLASS_VALUE,
		});
		/* Every constant that wears the one shadow is floating chrome wherever it is used. */
		const named = new Set(
			[...constants].filter(([, value]) => /\bshadow-overlay\b/.test(value)),
		);
		/* And every constant a MARKED panel names, whatever it carries: a border could
		 * be split into its own constant beside the one holding the shadow. */
		for (const tag of openingTags(source)) {
			if (!tag.text.includes("data-lo-floating")) continue;
			marked++;
			for (const [name, value] of constants)
				if (new RegExp(`\\b${name}\\b`).test(tag.text))
					named.add([name, value]);
		}
		for (const [name, value] of named) {
			const borders = borderUtilities(value);
			if (borders.length > 0)
				offenders.push(`${path}: const ${name} ${borders.join(", ")}`);
		}
	}
	assert.ok(
		marked >= FLOATING_PRIMITIVES.length,
		`the walk found ${marked} marked panel tags; a scan that finds none passes vacuously`,
	);
	assert.deepEqual(
		offenders,
		[],
		`a floating panel's chrome came back with a stroke through a class constant (branding § 2). Remove the border utility; the ground and \`shadow-overlay\` are the boundary:\n${offenders.join("\n")}`,
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

/**
 * The ONE sanctioned stroke: forced-colors mode drops every box-shadow, so a floating
 * panel there has no edge at all unless it draws one, and the system colour
 * `CanvasText` is what the user's own scheme says an edge is.
 */
const FORCED_COLORS_BLOCK =
	/@media\s*\(\s*forced-colors:\s*active\s*\)\s*\{((?:[^{}]*\{[^{}]*\})*[^{}]*)\}/g;

test("O-4 no stylesheet rule paints a border on a marked panel", () => {
	const css = read(CSS_PATH)
		.replace(/\/\*[\s\S]*?\*\//g, "")
		.replace(FORCED_COLORS_BLOCK, "");
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

test("O-4b forced-colors mode gives a marked panel exactly one CanvasText edge", () => {
	const css = read(CSS_PATH).replace(/\/\*[\s\S]*?\*\//g, "");
	const rules = [];
	for (const block of css.matchAll(FORCED_COLORS_BLOCK))
		for (const rule of block[1].matchAll(/([^{}]+)\{([^{}]*)\}/g))
			if (rule[1].includes("[data-lo-floating]"))
				rules.push({ selector: rule[1].trim(), body: rule[2].trim() });
	assert.equal(
		rules.length,
		1,
		"exactly one forced-colors rule may give [data-lo-floating] a border: forced-colors drops the shadow, so without it a panel has no edge, and with more than one the exception stops being one",
	);
	assert.match(
		rules[0].body,
		/^border:\s*1px\s+solid\s+CanvasText;?$/,
		"the forced-colors edge is 1px `CanvasText` and nothing else - the user's scheme's own edge colour, not a palette role the mode would override anyway",
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

test("O-6 the focus rule's box-shadow reset never reaches a floating panel", () => {
	const css = read(CSS_PATH).replace(/\/\*[\s\S]*?\*\//g, "");
	/* A selector whose SUBJECT is focus itself, with nothing narrowing it to a kind of
	 * element - the shape that can land on a focused panel. */
	const bare =
		/^(?:html\s+|\*\s*)?(?::focus-visible|\.Mui-focusVisible|:where\(:focus-visible\))(?::not\(\[data-lo-floating\]\))?$/;
	const offenders = [];
	let resets = 0;
	for (const match of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
		const [, selector, body] = match;
		if (!/box-shadow\s*:\s*none/.test(body)) continue;
		for (const part of selector.split(",").map((p) => p.trim())) {
			if (!bare.test(part)) continue;
			resets++;
			if (!part.endsWith(":not([data-lo-floating])")) offenders.push(part);
		}
	}
	assert.ok(
		resets >= 2,
		`expected the global focus rule's box-shadow reset (\`html :focus-visible\`, \`html .Mui-focusVisible\`), found ${resets} - a scan that sees none proves nothing`,
	);
	assert.deepEqual(
		offenders,
		[],
		`a focus selector resets box-shadow without excluding [data-lo-floating]. Radix focuses a menu's content on a pointer open, so this strips the panel's only separation (QA round 1, Q1):\n${offenders.join("\n")}`,
	);
});

/** The components whose panel is a shared floating primitive's panel. */
const FLOATING_CALL_SITES =
	/^(DropdownMenu(Sub)?Content|ContextMenu(Sub)?Content|PopoverContent|TooltipContent|SelectContent|DialogContent|SheetContent)$/;
/** Tailwind's own shadow scale - anything in the `shadow` group but the one shadow. */
const OTHER_SHADOW =
	/(?<![\w-])shadow-(?:2xs|xs|sm|md|lg|xl|2xl|none|inner)(?![\w-])/g;
/**
 * The one call site that may take a primitive's shadow off, with why: the lightbox
 * renders the picture on the scrim through `DialogContent` and is not a panel at all,
 * so there is nothing to lift. A new entry here needs the same kind of reason.
 */
const SHADOW_OVERRIDE_ALLOWED = new Set([
	"src/renderer/src/shared/components/common/image-lightbox.tsx DialogContent",
]);

test("O-7 no floating call site trades the one shadow for another", () => {
	const offenders = [];
	for (const path of rendererFiles()) {
		if (path.startsWith(UI_DIR)) continue;
		for (const tag of openingTags(read(path))) {
			const text = stripLineComments(tag.text);
			const floating =
				FLOATING_CALL_SITES.test(tag.name) || /\bshadow-overlay\b/.test(text);
			if (!floating) continue;
			const others = [...text.matchAll(OTHER_SHADOW)].map((m) => m[0]);
			if (
				others.length > 0 &&
				!SHADOW_OVERRIDE_ALLOWED.has(`${path} ${tag.name}`)
			)
				offenders.push(`${path}: <${tag.name}> ${others.join(", ")}`);
		}
	}
	assert.deepEqual(
		offenders,
		[],
		`tailwind-merge puts \`shadow-overlay\` in Tailwind's shadow group (\`utils.ts\`), so a second \`shadow-*\` on a floating panel DROPS it - the contact layer and the glass contact go with it (agent review round 1, R3). Remove the override:\n${offenders.join("\n")}`,
	);
});

/** The one shadow as a CLASS - the lookbehind keeps `var(--shadow-overlay)` out. */
const FLOATING_SHADOW_CLASS = /(?<![\w-])shadow-overlay(?![\w-])/;
const MARKER_ATTRIBUTE = /(?<![\w-])data-lo-floating\s*=/g;
/* No `g`: a per-tag `test`, so no lastIndex carries between tags. */
const HAS_MARKER = /(?<![\w-])data-lo-floating\s*=/;
const CLASS_NAME_PROP = /\bclassName\b/;
const LINE_BREAK = /\n/;
const stripComments = (text) =>
	stripLineComments(text.replace(/\/\*[\s\S]*?\*\//g, " "));

test("O-8 every element that wears the floating shadow carries the marker", () => {
	const offenders = [];
	let tags = 0;
	for (const path of rendererFiles()) {
		const source = read(path);
		const code = stripComments(source);
		const shadowConstants = [
			...moduleLevelClassConstants(source, { opening: PANEL_CLASS_VALUE }),
		]
			.filter(([, value]) => FLOATING_SHADOW_CLASS.test(stripComments(value)))
			.map(([name]) => new RegExp(`\\b${name}\\b`));
		/*
		 * BY ELEMENT, where the walk reaches: the marker must sit on the tag that
		 * wears the shadow (directly or through a same-file constant), not on a
		 * wrapper. `className` gates the constant path so a TypeScript generic such
		 * as `VariantProps<typeof sheetVariants>`, which the walk reads as a tag, is
		 * not mistaken for an element.
		 */
		for (const tag of openingTags(source)) {
			const text = stripLineComments(tag.text);
			const wears =
				FLOATING_SHADOW_CLASS.test(text) ||
				(CLASS_NAME_PROP.test(text) &&
					shadowConstants.some((name) => name.test(text)));
			if (!wears) continue;
			tags++;
			if (!HAS_MARKER.test(text)) offenders.push(`${path}: <${tag.name}>`);
		}
		/*
		 * BY COUNT, for what the walk cannot delimit: `/`-commands, the skill picker,
		 * the compose bar and the mini sheet are NOT reached through `openingTags`
		 * (see this file's header), and the mini sheet is one of the two panels that
		 * focus themselves. Each code line wearing the shadow class is one floating
		 * element (a constant counts once, and is worn at least once), so a file
		 * needs at least as many markers as it has such lines.
		 */
		const wearing = code
			.split(LINE_BREAK)
			.filter((line) => FLOATING_SHADOW_CLASS.test(line)).length;
		const marked = (code.match(MARKER_ATTRIBUTE) ?? []).length;
		if (marked < wearing)
			offenders.push(
				`${path}: ${wearing} element(s) wear shadow-overlay, ${marked} carry data-lo-floating`,
			);
	}
	assert.ok(
		tags >= 25,
		`the walk reached ${tags} elements wearing the shadow; a scan that sees none passes vacuously`,
	);
	assert.deepEqual(
		offenders,
		[],
		`an element wears \`shadow-overlay\` without \`data-lo-floating\`, so the focus reset strips its elevation when it takes focus and forced-colors mode leaves it edgeless (agent review round 2, N1). Add \`data-lo-floating=""\` to the element that wears the shadow (conditionally, if it only floats in one mode):\n${offenders.join("\n")}`,
	);
});

/*
 * O-9  NESTED CONTROLS DO NOT BRING THE STROKE BACK. The operator's requirement
 *      named the case: "Nested elements must not reintroduce the border: the
 *      'Message' button inside the profile popover is the example." O-1/O-2 read
 *      class utilities, and a `<Button variant="secondary">` carries its
 *      `border border-control` inside `button.tsx`'s `cva`, so a bordered control
 *      inside (or AS) a floating panel passed every assertion above: QA round 2
 *      (Q3) reverted the profile card's Message and the dialogs' `SecondaryButton`
 *      to `secondary` and the suite stayed 32/32, and found the scroll-to-bottom
 *      disc, the update card's `outline` buttons and the inline-edit Reject
 *      still stroked.
 *
 *      O-9a pins the two named controls by their own source, because neither file
 *      carries the marker (the popover and the dialog panel live in the
 *      primitives) and O-9b could not see them. O-9b is the derived half: in any
 *      file that marks a floating element, no `variant` resolves to a bordered
 *      neutral (`secondary`, `outline`). It reads per LINE rather than per tag
 *      because the files that need it most (the 4,700-line update card) are ones
 *      `openingTags` cannot fully delimit, and Biome puts each prop on its own
 *      line, conditionals included.
 *
 *      `danger` IS DELIBERATELY NOT IN THE SET (deferred, QA round 2, Q3 item 4):
 *      the job/wake cancel cards and inline-edit's stop control keep the bordered
 *      `danger`. A borderless danger is not a one-line variant - it needs its own
 *      `contract-tables.mjs` rows (rest/hover/pressed, red ink on `elevated`
 *      without a `dangerBorder` boundary) - and on a destructive action that red
 *      boundary is the semantic cue, not chrome.
 *
 *      Beyond reach, like O-1: a variant chosen through a variable or a prop
 *      default (`variant={variant}` in `floating-alert.tsx` forwards the caller's
 *      choice), and a bordered control in a file that does not mark - a child
 *      component rendered into another file's panel. The latter is why O-9a pins
 *      by name.
 */
const BORDERED_NEUTRAL_VARIANT = /"(secondary|outline)"/;
const VARIANT_PROP = /\bvariant=/;
const TONAL_VARIANT = /\bvariant="tonal"/;
const SECONDARY_BUTTON_IS_TONAL =
	/export const SecondaryButton = forwardRef[^;]*?variant="tonal"/;

/*
 * Lines in a marking file whose bordered variant is genuinely OUTSIDE the panel,
 * keyed `path: trimmed line`. Empty today: every hit the sweep found was inside
 * the panel and was moved to `tonal`. An entry needs the reason beside it.
 */
const NESTED_VARIANT_ALLOWED = new Set([]);

test("O-9a the operator's named nested controls stay borderless", () => {
	const card = read(
		"src/renderer/src/features/team-bridge/team-bridge-profile-card.tsx",
	);
	const send = card.indexOf("onMessage();");
	assert.ok(send > 0, "the profile card's Message action was not found");
	const tag = card.slice(card.lastIndexOf("<Button", send), send);
	assert.match(
		stripComments(tag),
		TONAL_VARIANT,
		"the profile popover's Message button must be `tonal`: a bordered variant redraws the stroke the operator photographed",
	);
	const dialog = read(
		"src/renderer/src/shared/components/common/base-dialog.tsx",
	);
	assert.match(
		dialog,
		SECONDARY_BUTTON_IS_TONAL,
		"the dialogs' `SecondaryButton` must render `tonal`: every dialog footer sits on a floating panel",
	);
});

test("O-9b no bordered neutral button inside a file that marks a floating element", () => {
	const offenders = [];
	let files = 0;
	let variants = 0;
	for (const path of rendererFiles()) {
		const code = stripComments(read(path));
		if (!HAS_MARKER.test(code)) continue;
		files++;
		for (const line of code.split(LINE_BREAK)) {
			if (!VARIANT_PROP.test(line)) continue;
			variants++;
			const key = `${path}: ${line.trim()}`;
			if (
				BORDERED_NEUTRAL_VARIANT.test(line) &&
				!NESTED_VARIANT_ALLOWED.has(key)
			)
				offenders.push(key);
		}
	}
	assert.ok(
		files >= 25 && variants >= 50,
		`the sweep reached ${files} marking files and ${variants} variant props; a scan that sees none passes vacuously`,
	);
	assert.deepEqual(
		offenders,
		[],
		`a bordered button (\`secondary\`/\`outline\`) sits in a file that marks a floating surface, so it redraws the stroke the panel gave up (QA round 2, Q3). Use \`tonal\` for the panel's secondary actions (\`ghost\` for icon-only/tertiary), or, if it is genuinely outside the panel, add it to NESTED_VARIANT_ALLOWED with the reason:\n${offenders.join("\n")}`,
	);
});
