/**
 * The other half of the drag vocabulary: every overlay surface subtracts itself
 * from the window's draggable region.
 *
 * WHY THIS IS A SOURCE-LEVEL CONTRACT, and what it deliberately does not do.
 * The draggable region is computed inside Chromium from element rects
 * (`LocalFrameView::CollectDraggableRegions`) and only exists in a real window:
 * a test process cannot hold one, and the OS-level hit test the user meets
 * (`WebContentsView::NonClientHitTest`, `region->contains(point)`) cannot be
 * called from here at all. So the two halves are split, and both are named:
 *
 *   - the RUNNING half is `--scene hit-zones` in `scripts/renderer-driver.mjs`,
 *     which reproduces the rect walk in the page, cross-checks its count and
 *     bounds against Electron's own `[draggable-regions]` debugger log, and
 *     samples every control of every overlay it can open;
 *   - the SOURCE half is this file - one line of CSS and one marker per
 *     portalled surface - because that is what the region computation reads, and
 *     a unit test CAN see it.
 *
 * THE OPERATOR'S REPORT IS THE CASE THIS PINS. The Analytics panel's corner `×`
 * was unclickable: the panel painted over the chat header's drag row, the region
 * walk never sees the top layer, and the click was taken as a window drag
 * instead. A swallowed event is indistinguishable from a dead handler, so the
 * fix is not "move the button" - it is the surface declaring the opt-out.
 *
 * THE DERIVATION, NOT A LIST. The surfaces that can paint into the top layer are
 * exactly the primitives that render a Radix Portal, found by scanning the
 * primitive layer for one. A new portalled primitive therefore fails this test
 * until it either carries the marker or is exempted with its reason, which is
 * what stops the next overlay being born inside the region. What it cannot see
 * is a surface that reaches the top layer WITHOUT a portal in this directory;
 * that limit is stated rather than implied, and `hit-zones` is where a new one
 * would be caught in a running app.
 */
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const ROOT = process.cwd();
const UI_DIR = "src/renderer/src/shared/components/ui";
const read = (path) => readFileSync(join(ROOT, path), "utf8");

const PORTAL_RENDERERS = readdirSync(join(ROOT, UI_DIR)).filter(
	(name) =>
		name.endsWith(".tsx") &&
		/* Both spellings the primitive layer uses: a `<XPrimitive.Portal>` and a
		 * component aliased as `XPortal` (`dialog.tsx`, `sheet.tsx`, `tooltip.tsx`). */
		/\.Portal[ >]|<[A-Za-z]*Portal[ >]/.test(read(`${UI_DIR}/${name}`)),
);

/**
 * The one overlay whose content cannot take a click, with the reason in source.
 *
 * A tooltip subtracts nothing because nothing in it is clickable: its content is
 * `pointer-events: none`, so there is no control for the region to swallow. The
 * exemption is asserted (below) rather than trusted - make a tooltip clickable
 * and the next run of this test asks the question again.
 */
const NOT_INTERACTIVE = {
	"tooltip.tsx": "pointer-events-none",
};

const MARKED = PORTAL_RENDERERS.filter((name) => !(name in NOT_INTERACTIVE));

test("F-1 the opt-out stands on its own, not only inside a drag row", () => {
	const css = read("src/renderer/src/styles/index.css").replace(
		/\/\*[\s\S]*?\*\//g,
		"",
	);
	assert.match(
		css,
		/\[data-chrome-mode="integrated"\]\s+\[data-titlebar-no-drag\]\s*\{\s*-webkit-app-region:\s*no-drag;/,
		"a region is built from rects in layout order and never sees the top layer, so the attribute has to be able to subtract a surface that is NOT a descendant of a drag row - that is the whole class `hit-zones` found",
	);
});

test("F-2 every portalled surface carries the opt-out, or is exempt with its reason", () => {
	assert.ok(
		PORTAL_RENDERERS.length >= 5,
		`the scan found ${PORTAL_RENDERERS.length} portalled primitive(s); the derivation is broken if it stops finding them`,
	);
	for (const name of PORTAL_RENDERERS) {
		const source = read(`${UI_DIR}/${name}`);
		const exemption = NOT_INTERACTIVE[name];
		if (exemption !== undefined) {
			/*
			 * The exemption is only valid while its reason holds. This is the
			 * assertion that keeps it from outliving the reason: a tooltip that
			 * gains a clickable control must stop being exempt, and the way to say
			 * so is via the marker, not by editing this table.
			 */
			assert.ok(
				source.includes(exemption),
				`${name} is exempt from the opt-out only because its content cannot take a click; its \`${exemption}\` is gone, so the exemption is stale`,
			);
			continue;
		}
		assert.ok(
			source.includes('data-titlebar-no-drag=""'),
			`${name} renders a portal and can paint over the window chrome; without the opt-out, every control of it is swallowed as a window drag wherever a drag surface is underneath - the Analytics \`×\` was this, once`,
		);
	}
});

test("F-3 the marker is on the panel a click lands in, never on the scrim", () => {
	assert.ok(
		MARKED.length >= 4,
		"the marked set is the portalled primitives minus the tooltip; a shrinking set means the scan stopped seeing one",
	);
	for (const name of MARKED) {
		const source = read(`${UI_DIR}/${name}`);
		/*
		 * The scrim is a deliberate non-member: it covers the whole window, so
		 * subtracting it would take the strip away from the window entirely while
		 * a modal is up. Making it no-drag is the tempting one-line "fix" and it
		 * is a regression - the lane beside the panel has to keep dragging, which
		 * is what `hit-zones` reads as the preserved points.
		 */
		assert.doesNotMatch(
			source,
			/Overlay[^>]{0,200}data-titlebar-no-drag/,
			`${name}: the scrim must not subtract itself; the strip stays draggable while a modal is up, and only the panel owns what it covers`,
		);
	}
});
