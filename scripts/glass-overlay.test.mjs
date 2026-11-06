/**
 * The floating layer: every panel that leaves the flow is translucent on glass.
 *
 * THE OPERATOR'S REPORT IS THE CASE THIS PINS. With window glass on, the columns
 * were translucent and every panel that FLOATED was still an opaque plate - the
 * sidebar's move-to menu, the Bridge conversation menu, a tooltip, the update card.
 * The cause was structural rather than a missed class: every glass rule in the
 * stylesheet is keyed on `data-glass-region`, and a Radix PORTAL has no region
 * ancestor - it is painted at the document body - so nothing in that vocabulary
 * could reach one. The fix is one marker (`data-glass-overlay`) on the panel
 * element of each portalled primitive plus one rule gated on the document root, and
 * this file holds both halves of that contract.
 *
 * WHAT IT CAN AND CANNOT SEE. It asserts the marker's placement per ELEMENT -
 * derived twice, once from the primitives that render a Portal and once from the
 * app's own "this leaves the flow" vocabulary (`shadow-overlay` on a panel with its
 * own ground, whether the class string is written on the element or composed into a
 * module-level constant it wears) - the rule's shape and gate, the ink rebinding that
 * keeps the dim register legible on the translucent panel, and the alpha's arithmetic
 * over the shipped modules. THE DERIVATION HAS EDGES and they are named where it
 * lives (`moduleLevelClassConstants`): a ground or shadow that arrives through an
 * inline style, a class string composed at runtime, an alias assigned in a ternary or
 * a constant imported from another module is outside the walk, so this file does not
 * promise that no overlay can ever be born invisible - it promises that the two shapes
 * this codebase actually writes are decisions. It cannot see pixels either: the
 * computed alpha, the blur and legibility over real content are the browser run's
 * evidence (`scripts/window-glass-cdp.test.mjs`'s rig, and the PR's own frames), never
 * this file's.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import {
	LANE_ALPHA_CEILING,
	deriveOverlayFloor,
} from "./derive-glass-floors.mjs";
import { openingTags } from "./jsx-opening-tags.mjs";

const ROOT = process.cwd();
const UI_DIR = "src/renderer/src/shared/components/ui";
const CSS_PATH = "src/renderer/src/styles/index.css";
const read = (path) => readFileSync(join(ROOT, path), "utf8");
const CSS = read(CSS_PATH);
const CSS_NO_COMMENTS = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
const FLOORS = JSON.parse(
	readFileSync(`${ROOT}/src/shared/window-glass-floors.json`, "utf8"),
);

const bundleOf = async (entry) => {
	const bundle = await build({
		stdin: { contents: `export * from "${entry}";`, resolveDir: ROOT },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		loader: { ".json": "json" },
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
	);
};

/**
 * THE DERIVATION, NOT A LIST. The panels that leave the flow are exactly the
 * primitives that render a Radix Portal, found by scanning the primitive layer for
 * one - the same derivation `overlay-drag-zones.test.mjs` makes for the drag
 * opt-out, repeated here rather than imported because that file registers its own
 * tests on import. A new portalled primitive therefore fails this test until it
 * carries the marker, which is what stops the next overlay being born opaque.
 */
const PORTAL_RENDERERS = readdirSync(join(ROOT, UI_DIR)).filter(
	(name) =>
		name.endsWith(".tsx") &&
		/\.Portal[ >]|<[A-Za-z]*Portal[ >]/.test(read(`${UI_DIR}/${name}`)),
);

/**
 * The one floating panel with no portal to find it by, named with its reason.
 *
 * `UpdateContainer` is `fixed` and mounted from the update store, so it reaches the
 * top of the window without a Radix Portal and this scan cannot see it. It is the
 * panel the operator named as the opaque update/changelog popup, so it is a member
 * of the class, not an exemption from it.
 */
const NAMED_PANELS = {
	"src/renderer/src/shared/components/common/update-notification.tsx":
		"UpdateContainer",
};

/**
 * THE PORTALLED PRIMITIVES THAT MUST **NOT** WEAR THE MARKER: the two that sit on
 * the MODAL SCRIM.
 *
 * Design round 1's D1 is the reason this list exists rather than the marker simply
 * being deleted. A floating panel's floor is derived against what a panel actually
 * floats over - the app's own column. A dialog and a sheet composite their ground
 * over the scrim, the one backdrop the derivation never measured, and the alpha
 * costs the semantic inks their AA floor there: measured on the delete-conversation
 * dialog in the light palette, `danger` reads 5.83:1 on the opaque plate, 3.73:1 at
 * the default intensity and 3.36:1 at the slider floor, with every semantic register
 * at or under 3.80:1. A modal already occludes the desktop it would be showing
 * through, so the translucency buys nothing and costs legibility.
 *
 * REVERSED FROM THE OBVIOUS ENTRY, which is why it is asserted in BOTH directions: a
 * modal that starts carrying the marker again fails here with the measurement
 * attached, rather than silently regressing to the state design round 1 caught.
 */
const SCRIM_PANELS = {
	"dialog.tsx":
		"a modal sits on the scrim, so its ground is the one backdrop the overlay floor was not derived against - it keeps the opaque `elevated` role (design round 1, D1)",
	"sheet.tsx":
		"a sheet is a modal too, on the same scrim and the same measured loss of the semantic inks' floor (design round 1, D1)",
};

/**
 * THE SECOND DERIVATION: the floating panels that are not primitives at all.
 *
 * The portal scan above is exact but narrow - it only sees `shared/components/ui`.
 * Round 1's MINOR-2 was that gap exactly: three feature-level panels floated opaque
 * next to a translucent menu and nothing here could see them. Scanning the features
 * for portals does not help - they are plain positioned divs.
 *
 * SO THE SIGNATURE COMES FROM THE DESIGN SYSTEM, not from a list. `shadow-overlay`
 * is the one shadow the app has for elements that leave the page flow
 * (`docs/branding.md` § 2 "Elevation"), and the components that spend it say so in
 * their own comments - "a true floating overlay, so this is one of the few places
 * `shadow-overlay` belongs". Pair that with the two things that make an element a
 * PANEL rather than a floating control - its own ground (`bg-elevated` or
 * `bg-floating`) and an out-of-flow placement (`absolute`, `fixed`, or the
 * `pointer-events-auto` panel a positioned wrapper carries; two of the three panels
 * this closed are positioned by their parent) - and the class falls out of the code
 * without anyone enumerating it.
 *
 * THE SHAPE IS OFTEN NOT ON THE TAG. A panel whose classes were worth factoring out
 * (`const LARGE_PREVIEW = cn("invisible absolute ... bg-elevated shadow-overlay")`)
 * is applied as `className={LARGE_PREVIEW}`, so the tag carries a NAME and the answer
 * is three hundred lines up - which means the tag-level scan misses exactly the tidier
 * code. `moduleLevelClassConstants` is the second half of this derivation for that
 * reason, and round 2 of review is what named the gap.
 */
const FLOATING_PANEL_SIGNATURE = (text) =>
	/\bshadow-overlay\b/.test(text) &&
	/\bbg-(elevated|floating)\b/.test(text) &&
	/\b(absolute|fixed|pointer-events-auto)\b/.test(text);

/** Every renderer `.tsx` outside the primitive layer, minus stories and tests. */
const rendererFeatureFiles = (dir = "src/renderer/src", out = []) => {
	for (const entry of readdirSync(join(ROOT, dir))) {
		const path = `${dir}/${entry}`;
		if (statSync(join(ROOT, path)).isDirectory())
			rendererFeatureFiles(path, out);
		else if (
			entry.endsWith(".tsx") &&
			!entry.includes(".stories.") &&
			!entry.includes(".test.") &&
			!path.startsWith(UI_DIR)
		)
			out.push(path);
	}
	return out;
};

/**
 * THE PANELS THE SIGNATURE FINDS AND THIS PR DELIBERATELY LEAVES OPAQUE, named with
 * the reason, so the next one has to be a decision rather than a silent gap.
 *
 * They are the same object as the marked ones - one attribute each, and the rule
 * already covers them - and they are the follow-up scope, not an exemption. The bar
 * for marking a surface is that someone looked at it: this round's remediation was
 * the three panels review round 1 named, and every entry here changes pixels on a
 * surface a remediation cycle had no browser run to verify. A panel marked blind is
 * the failure mode this contract exists to prevent.
 *
 * TWO ENTRIES WAIT FOR A STRONGER REASON THAN THE OTHERS. The browser's suggestions
 * and the inline image tile's action cluster do not float over a column the app
 * painted - they float over the web view and over the picture itself, i.e. over
 * arbitrary content - so `overlayFloor`'s premise (a translucent app surface under a
 * translucent panel) does not hold for them at all, and marking them would assert a
 * floor nobody derived for that backdrop.
 *
 * THE BROWSER'S ADDRESS SUGGESTIONS ARE ALSO A DIFFERENT CASE, and worth stating
 * separately because they inherit the band's problem (moving content beneath) rather
 * than this row's.
 */
const DEFERRED_PANELS = {
	"src/renderer/src/features/browser/components/browser-url-bar.tsx":
		"floats over the page, not over app-painted content: a different backdrop class, not this row's floor",
	"src/renderer/src/features/chat/components/mermaid-diagram.tsx":
		"the diagram controls, over the rendered diagram in the canvas pane",
	"src/renderer/src/features/chat/components/run-details/job-cancel-popover.tsx":
		"the job-cancel confirmation card",
	"src/renderer/src/features/chat/components/run-details/wake-cancel-popover.tsx":
		"the wake-cancel confirmation card",
	"src/renderer/src/features/team-bridge/team-bridge-message-toolbar.tsx":
		"the message actions toolbar over a Bridge row",
	"src/renderer/src/shared/components/common/find-replace-widget.tsx":
		"the find bar floating inside the editor",
	"src/renderer/src/features/chat/components/attachments-preview.tsx":
		"the composer tile's dwell preview, a 300px surface that marking blind changes with no browser run in this cycle to look at it",
	"src/renderer/src/features/chat/components/canvas/inline-edit.tsx":
		"the canvas inline-edit popover over the CodeMirror surface: the same unverified-pixels reason",
	"src/renderer/src/features/team-bridge/attachments/inline-image-tile.tsx":
		"the tile's action cluster floats over the picture itself - arbitrary image content, not a column the app painted - so overlayFloor was never derived against its backdrop",
	/*
	 * THE FOUR PICKERS JOINED THIS CLASS ON 2026-11-06, and they are deferred for the
	 * one reason this list is for rather than for a backdrop problem. They floated
	 * with `border border-control` + Tailwind's `shadow-lg`; the operator's report
	 * retired the stroke on every floating surface, so they took `shadow-overlay` -
	 * which is what makes them visible to this derivation for the first time. Their
	 * backdrop IS an app-painted surface (the composer input, a Bridge row), so the
	 * floor's premise holds; what is missing is the other half of this file's own bar
	 * for marking: someone has to LOOK at the translucent ground, and the change that
	 * removed the stroke has no browser run on glass in its cycle. Naming them is the
	 * decision this list exists to force; marking them blind is the failure mode it
	 * exists to prevent.
	 */
	"src/renderer/src/features/chat/components/at-picker.tsx":
		"the `@` suggestions over the composer's own ground: joined the floating vocabulary when its border became the shadow (2026-11-06), waiting on a rendered look at the translucent ground",
	"src/renderer/src/features/chat/components/message-item/message-controls.tsx":
		"the hover toolbar over a transcript row: it separated with a hairline until 2026-11-06 and now carries the one shadow, so it is new to this class and waiting on the same rendered look",
	"src/renderer/src/features/console/components/console-pane.tsx":
		"the console's cleanup notice over the terminal: it carried `shadow-md` and a `border-control` until 2026-11-06, and its backdrop is terminal output rather than a column the app painted, so the floor's premise would need checking as well as looking",
};

/** A class constant's opening: a class-combining call or a string literal. */
const CLASS_STRING_VALUE = /^(cn|clsx|twMerge)\(|^["`]/;
/** A module-level `const NAME =` (top level, `export` allowed). No `g`: per-call copy. */
const CLASS_CONSTANT_DECLARATION =
	/(?:^|\n)(?:export\s+)?const\s+([A-Za-z_$][\w$]*)\s*(?::[^=\n]+)?=/;

/**
 * MODULE-LEVEL CLASS CONSTANTS: the other half of the class derivation above.
 *
 * `const LARGE_PREVIEW = cn("invisible absolute ... bg-elevated shadow-overlay ...")`
 * reaches its element as `className={LARGE_PREVIEW}`, and `openingTags` reads class
 * text INSIDE an opening tag only - so a panel whose classes were factored out is
 * invisible to the tag-level scan no matter how exactly it matches the signature.
 * That is the wrong way round: factoring the string out is the tidier code and so the
 * likelier shape for the next overlay too. Round 2 of review named two panels missing
 * for this reason (`attachments-preview.tsx`, `inline-image-tile.tsx`); running this
 * resolver on the tree also surfaced a third nobody had named (`inline-edit.tsx`),
 * which is the evidence that the gap was structural rather than those two files.
 *
 * WHAT IT READS, and therefore what it cannot: a `const NAME = <value>` at column 0
 * (an `export` in front is fine) whose value starts with a `cn(`/`clsx(`/`twMerge(`
 * call or a string literal, ending at the first `;` outside brackets and strings. A
 * value that is an object or an inline-style map is NOT a class string and is not
 * read - which is what keeps `themed-toast-container.tsx`'s
 * `boxShadow: "var(--shadow-overlay)"` out of the class (toasts may legitimately be a
 * surface of their own; that is a naming decision, not this row's). Still out of
 * reach, and stated rather than implied: a constant declared inside a component, an
 * alias assigned through a ternary, a string concatenated at runtime, and a constant
 * imported from another module.
 */
const moduleLevelClassConstants = (source) => {
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const constants = new Map();
	/* A fresh lastIndex per call: the shared literal carries no `g` on purpose. */
	const declaration = new RegExp(CLASS_CONSTANT_DECLARATION, "g");
	let match = declaration.exec(stripped);
	while (match !== null) {
		const start = match.index + match[0].length;
		let depth = 0;
		let quote = null;
		let end = -1;
		for (let i = start; i < stripped.length; i++) {
			const ch = stripped[i];
			if (quote !== null) {
				if (ch === quote && stripped[i - 1] !== "\\") quote = null;
				continue;
			}
			if (ch === '"' || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "(" || ch === "{" || ch === "[") depth += 1;
			else if (ch === ")" || ch === "}" || ch === "]") depth -= 1;
			else if (ch === ";" && depth === 0) {
				end = i;
				break;
			}
		}
		if (end !== -1) {
			declaration.lastIndex = end;
			const value = stripped.slice(start, end).trim();
			if (CLASS_STRING_VALUE.test(value)) constants.set(match[1], value);
		}
		match = declaration.exec(stripped);
	}
	return constants;
};

/**
 * Every floating panel in one file, marked or not: a tag whose own class text carries
 * the signature, or a tag wearing a module-level class constant that does.
 *
 * The constant is matched by name anywhere in the opening tag rather than only inside
 * `className={...}`, because a hand-rolled expression parser to find the className
 * boundary is a worse trade than the one assumption this makes - a constant that
 * matches the signature is a class string, so a tag naming it is an element wearing
 * it. The marker is read off the same tag, which is where `data-glass-overlay` has
 * to be for the rule to paint the panel.
 */
const floatingPanelsIn = (file) => {
	const source = read(file);
	const constants = moduleLevelClassConstants(source);
	const panels = [];
	for (const tag of openingTags(source)) {
		const marked = tag.text.includes('data-glass-overlay=""');
		if (FLOATING_PANEL_SIGNATURE(tag.text)) {
			panels.push({ name: tag.name, marked });
			continue;
		}
		for (const [constant, value] of constants)
			if (
				new RegExp(`\\b${constant}\\b`).test(tag.text) &&
				FLOATING_PANEL_SIGNATURE(value)
			)
				panels.push({ name: `${tag.name} className={${constant}}`, marked });
	}
	return panels;
};

/** The feature-level panels the signature finds that are still unmarked. */
const unmarkedFloatingPanels = () => {
	const found = [];
	for (const file of rendererFeatureFiles())
		for (const panel of floatingPanelsIn(file))
			if (!panel.marked) found.push({ file, name: panel.name });
	return found;
};

test("O-1 every portalled primitive's panel carries the floating-layer marker", () => {
	assert.ok(
		PORTAL_RENDERERS.length >= 7,
		`the scan found ${PORTAL_RENDERERS.length} portalled primitive(s); the derivation is broken if it stops finding them`,
	);
	/* The seven that exist today, so a file silently leaving the scan is caught. */
	for (const known of [
		"context-menu.tsx",
		"dialog.tsx",
		"dropdown-menu.tsx",
		"popover.tsx",
		"select.tsx",
		"sheet.tsx",
		"tooltip.tsx",
	])
		assert.ok(
			PORTAL_RENDERERS.includes(known),
			`${known} renders a portal but the scan stopped seeing it`,
		);
	/* A scrim entry that no longer renders a portal is a stale exemption. */
	for (const name of Object.keys(SCRIM_PANELS))
		assert.ok(
			PORTAL_RENDERERS.includes(name),
			`${name} is named as a scrim surface but no longer renders a portal; drop the entry`,
		);
	for (const name of PORTAL_RENDERERS) {
		const source = read(`${UI_DIR}/${name}`);
		/*
		 * THE ANCHOR IS THE PANEL THE DRAG CONTRACT ALREADY NAMES, not a name suffix.
		 *
		 * `overlay-drag-zones.test.mjs` (F-2) already requires every portalled `*Content`
		 * element to carry `data-drag-surface`, so that attribute is the established,
		 * independently-asserted proof of "this element is the panel". Matching on the
		 * suffix instead was this test's first version and it failed honestly:
		 * `tooltip.tsx` renders `<TooltipContent>` (its own wrapper) as well as
		 * `<TooltipPrimitive.Content>` (the panel), and the suffix matches both - a
		 * marker on the wrapper would satisfy it while the panel stayed opaque.
		 *
		 * TIED TO THE DRAG MARKER rather than to a list of primitive tags, so a new
		 * panel is caught by whichever contract it breaks first: a panel with no drag
		 * opt-out fails F-2, a panel with no overlay marker fails here.
		 */
		const panels = openingTags(source).filter((tag) =>
			tag.text.includes('data-titlebar-no-drag=""'),
		);
		const tooltipPanel = openingTags(source).filter((tag) =>
			tag.text.includes('data-lo-tooltip-panel=""'),
		);
		assert.ok(
			panels.length + tooltipPanel.length > 0,
			`${name}: no panel element found by either anchor; the scan is looking in the wrong shape of file`,
		);
		if (SCRIM_PANELS[name]) {
			for (const tag of [...panels, ...tooltipPanel])
				assert.equal(
					tag.text.includes('data-glass-overlay=""'),
					false,
					`${name}: this surface is a modal on the scrim and must stay OPAQUE - ${SCRIM_PANELS[name]}. Marking it again reopens the sub-AA semantic inks design round 1 measured`,
				);
			continue;
		}
		for (const tag of [...panels, ...tooltipPanel])
			assert.ok(
				tag.text.includes('data-glass-overlay=""'),
				`${name}: <${tag.name}> leaves the flow and paints at the document body, where no \`data-glass-region\` ancestor describes it; without the marker it stays an opaque \`bg-elevated\` plate over a translucent window - the panel the operator reported`,
			);
	}
});

test("O-2 the floating panel with no portal is a named member, with its reason", () => {
	for (const [path, component] of Object.entries(NAMED_PANELS)) {
		const source = read(path);
		const panels = openingTags(source).filter((tag) =>
			tag.name.includes(component),
		);
		assert.ok(
			panels.length > 0,
			`${path}: ${component} not found as an element; the named entry is stale`,
		);
		assert.ok(
			source.includes('data-glass-overlay=""'),
			`${path}: ${component} is pinned over the app and was reported as an opaque plate; it must carry the marker the derived scan cannot reach it by`,
		);
	}
});

test("O-3 one rule paints the layer, gated on the root, with no element opacity", () => {
	const rules = [
		...CSS_NO_COMMENTS.matchAll(
			/([^{}]*\[data-glass-overlay\][^{}]*)\{([^}]*)\}/g,
		),
	];
	assert.equal(
		rules.length,
		1,
		`the floating layer must have exactly ONE rule (a second selector is a second opinion about the same ground); found ${rules.length}`,
	);
	const [rule] = rules;
	/*
	 * THE GATE IS THE DOCUMENT ROOT, not a region and not a coverage kind. A portal
	 * is painted at the body, so `<html>` is the only ancestor every one of them
	 * shares - and `data-glass` is absent whenever glass is off or gated (Reduce
	 * transparency, an unsupported platform, the explicit OFF), which is what keeps
	 * the shipped opaque look byte for byte unchanged.
	 */
	assert.match(
		rule[1].trim(),
		/^html\[data-glass\]\s*\[data-glass-overlay\]$/,
		"the rule must be gated on the root glass attribute alone",
	);
	assert.match(
		rule[2],
		/background-color:\s*color-mix\(\s*in srgb,\s*var\(--lo-elevated\)\s*calc\(\s*var\(--lo-glass-a-overlay,\s*1\)\s*\*\s*100%\s*\),\s*transparent\s*\);/,
		"the panel takes the elevated ROLE at the overlay's own derived alpha, with an opaque fallback",
	);
	assert.match(
		rule[2],
		/backdrop-filter:\s*blur\(12px\);/,
		"the blur is what isolates the panel from whatever floats under it; the tint alone leaves text colliding with text",
	);
	/*
	 * NO WHOLE-ELEMENT OPACITY, ever: `opacity` would fade the text, the icons, the
	 * focus ring and every disabled row along with the ground. Only the fill and the
	 * backdrop are translucent.
	 */
	assert.equal(
		/opacity\s*:/.test(rule[2]),
		false,
		"the floating layer must never be faded as a whole - text, icons and focus rings stay crisp",
	);
	/*
	 * THE ONE INK REBINDING, and it is load-bearing rather than cosmetic. The third
	 * text register the panel carries - `DropdownMenuLabel`, an item's shortcut,
	 * `SelectPrimitive.Label` - is `ink-dim`. Measured on this composite it lands at
	 * 3.62:1 (dark) / 3.59:1 (light) at the panel's floor, and 3.90 / 3.96 at the
	 * default 80, so it is under the 4.5 the flat contract holds that register to wherever
	 * the slider is put. The panel cannot pay for it with opacity either: `ink-dim` needs
	 * alpha 0.86 / 0.71, denser than the `elevated` rung's own floor (0.68 / 0.45) and a
	 * step under the band's (0.88 / 0.78) - a panel more opaque than the plate it
	 * replaces. So the ink is lifted instead, once, for every panel carrying the marker:
	 * drop this line and every glass menu label and shortcut drops back below AA
	 * silently.
	 */
	assert.match(
		rule[2],
		/--color-ink-dim:\s*var\(--color-ink-muted\);/,
		"the floating panel must remap its dim text register to the muted one: unmapped it measures 3.62:1 dark / 3.59:1 light at the panel's floor, under the 4.5 the app holds that register to",
	);
	/*
	 * THE SEMANTIC REGISTERS, rebound in the same rule (design round 1, D1). Every one
	 * of the five is text on this layer somewhere - a destructive menu item, a result
	 * link, a changelog link - and each measures 3.03-3.66:1 (dark) / 3.23-3.33:1
	 * (light) at the floor over the worst backdrop unrebound, under the 4.5 the flat
	 * contract holds them to. The fill cannot pay for them: that solve needs alpha 1.00
	 * (dark) / 0.82 (light), which is the opaque plate this layer exists to replace.
	 */
	for (const role of ["danger", "success", "warning", "info"])
		assert.match(
			rule[2],
			new RegExp(
				`--color-${role}:\\s*color-mix\\(\\s*in srgb,\\s*var\\(--lo-ink\\)\\s*calc\\(\\s*var\\(--lo-glass-overlay-ink-mix,\\s*0\\)\\s*\\*\\s*100%\\s*\\)\\s*,\\s*var\\(--lo-${role}\\)\\s*\\);`,
			),
			`the panel must step --color-${role} toward ink by the derived overlayInkMix: unrebound it is a mid-tone meaning colour on a mid-tone ground and drops under 4.5:1 at the slider's floor`,
		);
	/*
	 * THE BOUNDARY IS A ROLE, not the fill's own colour (design round 1, D2) - and
	 * since 2026-11-06 it is spent on the SHADOW, not on a stroke. The hairline sat on
	 * the panel's fill at 1.03:1 dark / 1.18:1 light, so the edge did no separating;
	 * the derived step repaired that as a 1px `border-color`, and the operator's
	 * four-screenshot report retired the border on every floating surface. The same
	 * derived colour now feeds the contact layer of the one shadow, so the panel keeps
	 * the boundary's darkness while compositing over an already-translucent column and
	 * gains blur instead of a line. `--lo-hairline` is deliberately no longer a term
	 * here: there is no stroke left to tint.
	 */
	assert.match(
		rule[2],
		/--lo-shadow-contact:\s*color-mix\(\s*in srgb,\s*var\(--lo-ink\)\s*calc\(\s*var\(--lo-glass-overlay-edge-mix,\s*0\)\s*\*\s*100%\s*\)\s*,\s*var\(--lo-scrim\)\s*\);/,
		"the panel's boundary must be its own derived role, spent on the shadow's contact layer: the hairline alone measures 1.03:1 dark / 1.18:1 light against the panel's own fill and does not separate it",
	);
	/* The scrim is a deliberate non-member: it covers the whole window and is a role
	 * (`bg-scrim`), not a ground that floats over the app. */
	assert.equal(
		/\[data-glass-overlay\][^{]*Scrim/i.test(CSS_NO_COMMENTS),
		false,
		"the dialog scrim is not a floating surface",
	);
});

test("O-4 the alpha tracks the slider from the ceiling down to the derived floor", async () => {
	const glass = await bundleOf("./src/shared/window-glass.ts");
	for (const scheme of ["dark", "light"]) {
		const floor = FLOORS.overlayFloor[scheme];
		let previous = 1;
		for (const intensity of [0, 25, 50, 75, 100]) {
			const a = glass.glassOverlayAlpha({ intensity, scheme });
			assert.ok(
				a >= floor - 0.001,
				`overlay alpha ${a} at ${intensity} is below the derived floor ${floor} (${scheme})`,
			);
			assert.ok(
				a <= glass.GLASS_ALPHA_CEILING,
				`overlay alpha ${a} is past the veil ceiling`,
			);
			assert.ok(
				a <= previous,
				`overlay alpha rose from ${previous} to ${a} as the slider went from frosted to clear (${scheme})`,
			);
			previous = a;
		}
		assert.equal(
			glass.glassOverlayAlpha({ intensity: 0, scheme }),
			glass.GLASS_ALPHA_CEILING,
			"the frosted end is the veil ceiling",
		);
		assert.equal(glass.glassOverlayAlpha({ intensity: 100, scheme }), floor);
		/*
		 * THE CLAIM THE OPERATOR ASKED FOR, in the one form that is TRUE in both
		 * schemes: the floating layer is materially clearer than the ISOLATING BAND's
		 * floor - the number a panel over arbitrary content otherwise has to take.
		 *
		 * It is deliberately NOT compared against `elevated`'s own floor. On the light
		 * palettes that rung is the CLEAREST in the ladder (a white plate at
		 * 0.45-0.75), so "below the elevated rung" is false there by construction -
		 * and this test failed on exactly that comparison before it was rewritten,
		 * which is the discriminator doing its job on the test's own claim rather
		 * than on the code.
		 */
		assert.ok(
			floor < FLOORS.bandFloor[scheme],
			`overlayFloor/${scheme} (${floor}) is not clearer than the band floor (${FLOORS.bandFloor[scheme]})`,
		);
	}
});

test("O-4b the floor's MEANING: every palette's text registers clear AA at both ends of the slider", async () => {
	const { loadPalettes } = await import("./palette-source.mjs");
	const { composite, ratio, schemeOf } = await import(
		"./derive-glass-floors.mjs"
	);
	/*
	 * BOTH ENDS, not the floor alone: the panel's alpha travels from the veil ceiling to
	 * the floor as the slider moves, and its registers have to hold at every position the
	 * user can put it in. The default (80) and the clearest (100) are the two the
	 * contract also measures, so this test and `scripts/contrast-contract.mjs` assert the
	 * same table through two independent code paths over the same 59 palettes. The
	 * ceiling here is the model's own, IMPORTED rather than copied: a literal here would
	 * keep measuring a panel slightly denser than the real one if the ceiling moved, and
	 * a denser panel can only get easier to pass - drift that reads as green. The model
	 * pins `LANE_ALPHA_CEILING === GLASS_ALPHA_CEILING` (`window-glass.test.mjs`) and
	 * `glassOverlayAlpha` is linear.
	 */
	const CEILING = LANE_ALPHA_CEILING;
	const ends = [
		["the default 80", 80],
		["max transparency", 100],
	];
	let checked = 0;
	for (const scheme of ["dark", "light"]) {
		const floor = FLOORS.overlayFloor[scheme];
		/* The least opaque column the app can draw - the derivation's worst case. */
		let backing = 1;
		for (const tier of Object.keys(FLOORS.alphaFloor))
			backing = Math.min(backing, FLOORS.alphaFloor[tier][scheme].canvas);
		const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
		for (const { palette, id } of loadPalettes()) {
			if (schemeOf(palette) !== scheme) continue;
			checked += 1;
			for (const [at, intensity] of ends) {
				const top = Math.max(CEILING, floor);
				const alpha =
					Math.round((top - (intensity / 100) * (top - floor)) * 100) / 100;
				const ground = composite(
					palette.elevated,
					alpha,
					composite(palette.canvas, backing, backdrop),
				);
				/*
				 * THE REGISTER THAT RENDERS, not the hex the palette authors: inside a marked
				 * panel `index.css` rebinds `--color-ink-dim` to `--color-ink-muted`, so a dim
				 * label draws in the muted ink. Asserting the palette's `inkDim` here would
				 * measure a colour the panel never paints - and would pass only if the panel
				 * were opaque again, which is the trade review round 1 settled the other way.
				 */
				for (const [register, colour] of [
					["ink", palette.ink],
					["ink-muted (and the remapped ink-dim)", palette.inkMuted],
				]) {
					const got = ratio(colour, ground);
					assert.ok(
						got >= 4.5,
						`${id}: ${register} is ${got.toFixed(2)}:1 on the floating panel ${at} (${scheme} ${alpha}), under the 4.5 text floor - the panel would be a hole with text on it`,
					);
				}
			}
		}
	}
	assert.ok(
		checked >= 50,
		`only ${checked} palettes were measured; the scheme split is broken`,
	);
});

test("O-5 the committed overlay floor is the derived one, and is not a copy of a ground rung", () => {
	assert.deepEqual(
		deriveOverlayFloor(FLOORS.alphaFloor),
		FLOORS.overlayFloor,
		"the committed overlay floor is the derived one (never hand-lowered)",
	);
	/*
	 * COMPUTED, NOT A LITERAL, proved by perturbing the model it is computed from:
	 * raise the canvas floors - the column the panel is measured against - and the
	 * overlay floor must fall, because a denser column beneath the panel does more of
	 * the contrast work. A hand-written constant would not move at all.
	 *
	 * IT IS NOT ASSERTED AS "below every ground floor": the light schemes make that
	 * false by construction, because there `elevated` is the clearest rung in the
	 * ladder. This test failed on exactly that comparison before it was rewritten -
	 * an invented claim about the design rather than a property of it.
	 */
	const perturbedInput = JSON.parse(JSON.stringify(FLOORS.alphaFloor));
	for (const tier of Object.keys(perturbedInput))
		for (const scheme of ["dark", "light"])
			perturbedInput[tier][scheme].canvas = Math.min(
				1,
				perturbedInput[tier][scheme].canvas + 0.1,
			);
	const perturbed = deriveOverlayFloor(perturbedInput);
	for (const scheme of ["dark", "light"])
		assert.ok(
			perturbed[scheme] <= FLOORS.overlayFloor[scheme],
			`raising the canvas floors did not lower the ${scheme} overlay floor (${FLOORS.overlayFloor[scheme]} -> ${perturbed[scheme]}); the number is not being derived from the model`,
		);
});

test("O-6 the alpha is published, and the switch-off path clears it", () => {
	assert.match(
		read("src/shared/window-glass.ts"),
		/"--lo-glass-a-overlay":\s*String\(\s*glassOverlayAlpha\(/,
		"`glassPaintFor` must publish the floating layer's alpha",
	);
	assert.match(
		read("src/renderer/src/shared/hooks/use-window-glass.ts"),
		/"--lo-glass-a-overlay",/,
		"the renderer must list the variable among the ones a switch-off removes, or glass turned off mid-session leaves a stale alpha on the root",
	);
});

test("O-7 the rest of the class: a floating panel outside the primitive layer is marked or named", () => {
	const unmarked = unmarkedFloatingPanels();
	assert.ok(
		unmarked.length + Object.keys(DEFERRED_PANELS).length >= 8,
		`the signature found ${unmarked.length} unmarked panel(s) and ${Object.keys(DEFERRED_PANELS).length} named one(s); the scan is looking in the wrong shape of file if it stops finding this class`,
	);
	/*
	 * THE THREE REVIEW ROUND 1 NAMED, pinned so the derivation cannot quietly lose
	 * them: they are the reason this test exists and the reason the slice exists.
	 */
	for (const path of [
		"src/renderer/src/features/settings/components/settings-search.tsx",
		"src/renderer/src/features/chat/canonical/thread-search-overlay.tsx",
		"src/renderer/src/features/session-switcher/components/session-switcher.tsx",
	])
		assert.ok(
			read(path).includes('data-glass-overlay=""'),
			`${path}: the feature-level floating panel round 1 named is not marked; on glass it paints an opaque \`bg-elevated\` plate over a translucent column - the defect this slice exists for`,
		);
	for (const { file, name } of unmarked)
		assert.ok(
			DEFERRED_PANELS[file],
			`${file}: <${name}> pairs \`shadow-overlay\` (the system's one shadow for what leaves the flow) with its own ground, and it paints opaque over the glass. Mark it with \`data-glass-overlay=""\`, or name it in DEFERRED_PANELS with the reason it is not marked yet`,
		);
	/*
	 * AND THE NAMED LIST CANNOT OUTLIVE ITS SUBJECT: an entry whose panel carries the
	 * marker is a stale exemption, and one whose file no longer has a panel of this
	 * shape is dead text. Either way the list stops being the follow-up scope and
	 * starts hiding the next regression in the same file.
	 */
	for (const [file, reason] of Object.entries(DEFERRED_PANELS)) {
		assert.ok(reason.length > 10, `${file}: the listed reason is not a reason`);
		assert.ok(
			floatingPanelsIn(file).length > 0,
			`${file}: no panel with the signature is in this file any more; drop the DEFERRED_PANELS entry`,
		);
		assert.ok(
			unmarked.some((panel) => panel.file === file),
			`${file}: every panel with the signature here is marked now, so the DEFERRED_PANELS entry is stale - delete it`,
		);
	}
});
