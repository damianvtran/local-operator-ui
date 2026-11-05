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
 * WHAT IT CAN AND CANNOT SEE. It asserts the marker's placement per ELEMENT, the
 * rule's shape and gate, and the alpha's arithmetic over the shipped modules. It
 * cannot see pixels: the computed alpha, the blur and legibility over real content
 * are the browser run's evidence (`scripts/window-glass-cdp.test.mjs`'s rig, and the
 * PR's own frames), never this file's.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import { deriveOverlayFloor } from "./derive-glass-floors.mjs";
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

test("O-4b the floor's MEANING: every palette's ink clears AA over the worst desktop", async () => {
	const { loadPalettes } = await import("./palette-source.mjs");
	const { composite, ratio, schemeOf } = await import(
		"./derive-glass-floors.mjs"
	);
	let checked = 0;
	for (const scheme of ["dark", "light"]) {
		const floor = FLOORS.overlayFloor[scheme];
		/* The least opaque column the app can draw - the derivation's worst case. */
		let backing = 1;
		for (const tier of Object.keys(FLOORS.alphaFloor))
			backing = Math.min(backing, FLOORS.alphaFloor[tier][scheme].canvas);
		const backdrop = scheme === "dark" ? "#ffffff" : "#000000";
		for (const { palette, name } of loadPalettes()) {
			if (schemeOf(palette) !== scheme) continue;
			const ground = composite(
				palette.elevated,
				floor,
				composite(palette.canvas, backing, backdrop),
			);
			for (const ink of ["ink", "inkMuted"])
				assert.ok(
					ratio(palette[ink], ground) >= 4.5,
					`${name}: ${ink} on the floating layer measures ${ratio(palette[ink], ground).toFixed(2)}:1 at the ${scheme} floor ${floor}, under the 4.5 text floor - the panel would be a hole with text on it`,
				);
			checked += 1;
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
