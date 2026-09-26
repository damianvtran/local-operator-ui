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
 * is a surface that reaches the strip WITHOUT a portal in this directory; one
 * such surface exists and is a NAMED entry instead (F-4, the update card, with
 * its reason in source), and `hit-zones` is where a new one would be caught in a
 * running app.
 *
 * WHICH ELEMENT OF THE FILE, because that was the first version's gap (round 1,
 * R4): F-3 matched a marker within 200 characters of an `Overlay` TOKEN in the
 * same file - so of the five files it ran over, three contained no token at all
 * and it asserted nothing, and a reformat could move the marker past the bound
 * silently. The checks below walk the source's opening tags instead (comments
 * stripped, string literals and braced expressions respected), so "the marker is
 * a direct prop of `XPrimitive.Content`" is asserted per element, and "no
 * `*Overlay` element carries it" is asserted per element too.
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

/**
 * Every opening tag in a source file, as `{ name, text }` pairs, in order.
 *
 * A parser this is not; it is the smallest walk that can say WHICH element an
 * attribute is on, which the round-1 regex could not. Block comments are
 * stripped first so a marker named in prose does not count as a marker on an
 * element. From a `<`, the tag ends at the first `>` at brace depth zero - so
 * `[&>div]` inside a className does not end it - and quotes are honoured so a
 * `>` inside a string does not either. TypeScript generics like
 * `forwardRef<HTMLDivElement, ...>` are taken as tags too; their names never end
 * in `Content` or `Overlay`, so they are inert here, and the walk resumes after
 * them.
 */
const openingTags = (source) => {
	const stripped = source.replace(/\/\*[\s\S]*?\*\//g, "");
	const tags = [];
	for (let i = 0; i < stripped.length; i++) {
		if (stripped[i] !== "<") continue;
		const next = stripped[i + 1];
		if (!(next !== undefined && /[A-Za-z]/.test(next))) continue;
		let depth = 0;
		let quote = null;
		let end = -1;
		for (let j = i + 1; j < stripped.length; j++) {
			const ch = stripped[j];
			if (quote !== null) {
				if (ch === quote && stripped[j - 1] !== "\\") quote = null;
				continue;
			}
			if (ch === '"' || ch === "'" || ch === "`") {
				quote = ch;
				continue;
			}
			if (ch === "{") depth += 1;
			else if (ch === "}") depth -= 1;
			else if (ch === ">" && depth === 0) {
				end = j;
				break;
			}
		}
		if (end === -1) continue;
		const text = stripped.slice(i, end + 1);
		const name = /^<([A-Za-z][\w.]*)/.exec(text)?.[1];
		if (name === undefined) continue;
		tags.push({ name, text });
		i = end - 1;
	}
	return tags;
};

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
		/*
		 * PER ELEMENT, not per file: the marker is a direct prop of every
		 * `*Content` tag in the file, which is the panel a click lands in. A
		 * marker moved onto the `Portal` wrapper satisfies a file-level
		 * `includes` (the first version's F-2) and does not satisfy this.
		 */
		const panels = openingTags(source).filter((tag) =>
			tag.name.endsWith("Content"),
		);
		assert.ok(
			panels.length > 0,
			`${name}: no \`*Content\` element found; the scan is looking in the wrong shape of file`,
		);
		for (const tag of panels) {
			assert.ok(
				tag.text.includes('data-titlebar-no-drag=""'),
				`${name}: <${tag.name}> renders through a portal and can paint over the window chrome; without the opt-out on the panel element itself, every control of it is swallowed as a window drag wherever a drag surface is underneath - the Analytics \`×\` was this, once`,
			);
		}
	}
});

test("F-3 the marker is on the panel a click lands in, never on the scrim", () => {
	assert.ok(
		MARKED.length >= 4,
		"the marked set is the portalled primitives minus the tooltip; a shrinking set means the scan stopped seeing one",
	);
	const scrims = {};
	for (const name of MARKED) {
		const source = read(`${UI_DIR}/${name}`);
		/*
		 * The scrim is a deliberate non-member: it covers the whole window, so
		 * subtracting it would take the strip away from the window entirely while
		 * a modal is up. Making it no-drag is the tempting one-line "fix" and it
		 * is a regression - the lane beside the panel has to keep dragging, which
		 * is what `hit-zones` reads as the preserved points.
		 */
		for (const tag of openingTags(source).filter((tag) =>
			tag.name.endsWith("Overlay"),
		)) {
			scrims[name] = (scrims[name] ?? 0) + 1;
			assert.ok(
				!tag.text.includes("data-titlebar-no-drag"),
				`${name}: <${tag.name}> is the scrim and must not subtract itself; the strip stays draggable while a modal is up, and only the panel owns what it covers`,
			);
		}
	}
	/*
	 * And the check is not vacuous: the two files that define a scrim must still
	 * be seen defining one, or `Overlay` was renamed and this test went quiet.
	 */
	for (const name of ["dialog.tsx", "sheet.tsx"]) {
		assert.ok(
			(scrims[name] ?? 0) > 0,
			`${name} defines a scrim, and the walk no longer finds its \`*Overlay\` element - the scrim half of this test is silently asserting nothing`,
		);
	}
});

/**
 * F-4 - the one named surface, because the derivation cannot see it.
 *
 * The scan above only finds portalled primitives, and that is its stated limit:
 * `UpdateContainer` is `fixed top-4 right-4 z-50`, mounted on every route, and
 * its top row sits inside a drag surface wherever one is drawn - while reaching
 * the top layer through no portal at all, so neither half of the scan sees it
 * (round 1, R3). It is named rather than derived, because "everything fixed near
 * the top" is a heuristic with false positives; the entry stays honest by
 * asserting the geometry it was written for, so a card that moves out of the
 * strip is a question rather than a silent keep.
 */
test("F-4 the fixed surface mounted above the strip carries the opt-out", () => {
	const path =
		"src/renderer/src/shared/components/common/update-notification.tsx";
	const source = read(path);
	const pinned = openingTags(source).filter((tag) =>
		tag.text.includes("fixed top-4 right-4 z-50"),
	);
	assert.ok(
		pinned.length > 0,
		`${path}: the card is no longer pinned at the window's top-right (its \`fixed top-4 right-4 z-50\` geometry is gone); if it moved out of the strip, re-read this entry's reason rather than keeping it silently`,
	);
	for (const tag of pinned) {
		assert.ok(
			tag.text.includes('data-titlebar-no-drag=""'),
			`${path}: <${tag.name}> is pinned into the drag strip and renders no portal, so the scan above cannot see it; without the marker every press on its top row is a window drag`,
		);
	}
});
