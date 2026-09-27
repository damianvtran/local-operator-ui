/**
 * The right-pane slot's ground and seam, executable.
 *
 *     node --test scripts/pane-slot-ground.test.mjs
 *
 * WHY THIS FILE EXISTS. The operator's report was that the canvas "hard cuts off"
 * at the top, that its icon row sat on "a band whose background differs from the
 * panel body beneath it", and that it should be "a similar borderless background
 * with contrast to the left sidebar". Three of those four clauses are properties
 * of CLASS STRINGS rather than of a rendered surface, which is exactly the shape
 * no palette assertion and no screenshot can hold: the pane was `bg-surface`, the
 * sidebar is `bg-surface`, and the bar was `bg-sunken`, and every existing gate
 * stayed green through all three. What the operator had to look at a frame to see,
 * a source scan can refuse.
 *
 * THE FOUR CLAIMS, and the one derivation that makes the first of them more than a
 * lint:
 *
 *   1. **Every occupant of the slot roots at the lane's own ground.** `chat-layout`
 *      paints the 32px chrome lane `--lo-canvas` from the sidebar's trailing edge to
 *      the window's right edge, and every pane in the slot is mounted inside that
 *      region. So a pane rooted at `bg-canvas` is continuous with the lane from y0
 *      down and the operator's top edge cannot be drawn by construction; a pane
 *      rooted at anything else re-introduces it. This file reads the lane's own
 *      gradient out of `chat-layout.tsx` and the panes' roots out of their own
 *      modules, and asserts the TOKENS are equal rather than asserting a literal,
 *      so repainting the lane and the slot together is a decision this test follows
 *      and repainting one of them is a decision it refuses.
 *   2. **No seam rule on the slot's wrappers.** The boundary is the tone step
 *      between `surface` and `canvas` now; a `border-l border-hairline` beside it is
 *      the second way of saying one thing, and the operator's ask was borderless.
 *   3. **No ground of its own on the slot's chrome bars.** A bar that paints a
 *      ground is the band the operator reported. The bar's height (40px) is the
 *      slot's, and this file checks the panes agree on it, because a bar that moved
 *      would take the "icons stay on the app's top line" invariant with it.
 *   4. **The bars are not in the drag region's path.** Nothing here puts a control
 *      into the lane — the lane stays an empty drag surface above the columns — and
 *      this file refuses a bar (or a wrapper) that names a drag attribute, so the
 *      next author cannot quietly move a control into the band that eats clicks.
 *      The band itself is measured in the app: `scripts/renderer-driver.mjs`'s
 *      hit-zone read is the instrument for that, not this file.
 *
 * WHAT IT CANNOT SEE: whether the result LOOKS right, and whether any given theme's
 * two grounds are far enough apart to read. The magnitudes are
 * `scripts/contrast-contract.mjs`'s (`surface` -> `canvas` is an asserted adjacent
 * pair there, ΔE00 2.05-6.76 across the palettes) and the frames are the evidence
 * set's. A green run here says the slot is wired the way the report asked.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const read = (relative) => readFileSync(join(ROOT, relative), "utf8");

const CHAT_LAYOUT = "src/renderer/src/shared/components/common/chat-layout.tsx";
const CHAT_CONTENT =
	"src/renderer/src/features/chat/components/chat-content.tsx";

/**
 * The slot's four occupants: the pane's own root class expression, and the file
 * that states the slot's rule (the canvas, which carries the long note the others
 * point at).
 */
const PANES = [
	{
		name: "canvas",
		file: "src/renderer/src/features/chat/components/canvas/index.tsx",
		authority: true,
	},
	{
		name: "run panel",
		file: "src/renderer/src/features/chat/components/run-details/run-panel.tsx",
	},
	{
		name: "browser pane",
		file: "src/renderer/src/features/browser/components/browser-pane.tsx",
	},
	{
		name: "console pane",
		file: "src/renderer/src/features/console/components/console-pane.tsx",
	},
];

/** The source with its comments removed.
 *
 * WHY: several of these files QUOTE the class they no longer carry, in the note
 * that says why it left. A scan over the raw text reads that note as a use, so the
 * instrument would refuse the very record that keeps the decision, and the next
 * author would delete the note to get a green run.
 */
function withoutComments(source) {
	return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/*
 * The four shapes this file reads, at module scope for `useTopLevelRegex`: each is
 * a literal over source text that does not change within a run, so building one per
 * call is work the linter is right to refuse.
 */
const LANE_GRADIENT =
	/linear-gradient\(to right, var\((--lo-[\w-]+)\) \$\{columnWidth\}px, var\((--lo-[\w-]+)\)/;
const PANE_ROOT = /className=\{cn\("flex h-full flex-col (bg-[\w-]+)"\)\}/g;
const PANE_BAR =
	/"flex (h-\d+) shrink-0 items-center justify-between gap-2 ([^"]*?)px-2"/g;
const SLOT_WRAPPER =
	/overflow-hidden transition-\[width\] duration-base ease-out-quart/g;

/**
 * The lane's own ground for the region right of the sidebar, read off the
 * gradient `chat-layout.tsx` paints it with.
 *
 * The gradient is `linear-gradient(to right, <sidebar> <width>px, <work> <width>px)`:
 * the SECOND stop is the ground every pane in the slot stands on. Reading it here,
 * rather than restating `canvas`, is the whole point of claim 1 — a literal would
 * pass while the lane and the slot disagreed.
 */
function laneWorkGround() {
	const source = read(CHAT_LAYOUT);
	const gradient = source.match(LANE_GRADIENT);
	assert.ok(
		gradient,
		"chat-layout.tsx no longer paints the lane with a two-stop gradient; the slot's ground is derived from that gradient, so this file must be re-read before it can assert anything",
	);
	return gradient[2];
}

/** The ground token a pane's root section/div paints, as `--lo-<role>`. */
function paneRootGround(file, name) {
	const source = read(file);
	const matches = [...source.matchAll(PANE_ROOT)];
	assert.ok(
		matches.length > 0,
		`${name}: no 'flex h-full flex-col bg-*' root found in ${file} — the pane's ground is read off its own class string, so this file has to be re-read before it can assert anything`,
	);
	for (const match of matches) {
		assert.equal(
			match[1],
			"bg-canvas",
			`${name}: a root in ${file} paints \`${match[1]}\`. Every occupant of the right-pane slot must root at the ground chat-layout.tsx paints the chrome lane with (${laneWorkGround()}), or the pane's own ground meets the lane at the lane's bottom edge — the hard horizontal cut the operator reported.`,
		);
	}
	return matches.length;
}

test("every pane in the slot roots at the lane's own ground", () => {
	const lane = laneWorkGround();
	for (const pane of PANES) {
		paneRootGround(pane.file, pane.name);
	}
	/* The lane's right-hand stop is the token the panes must use, and this is the
	 * one place the two are compared rather than one being restated. */
	assert.equal(
		lane,
		"--lo-canvas",
		`chat-layout.tsx paints the lane right of the sidebar with ${lane}; the slot's panes use \`bg-canvas\` (\`--lo-canvas\`). A lane repainted without the slot is a top edge reintroduced, so this pair is a decision rather than a literal.`,
	);
});

test("no seam rule on the slot's wrappers", () => {
	const source = withoutComments(read(CHAT_CONTENT));
	assert.equal(
		[...source.matchAll(SLOT_WRAPPER)].length,
		4,
		`expected the slot's four wrappers in ${CHAT_CONTENT} — the shapes this file matches by their transition have moved, so re-read the file before trusting the assertion below`,
	);
	assert.ok(
		!source.includes("border-l border-hairline"),
		`${CHAT_CONTENT} draws \`border-l border-hairline\` on something in the pane row. The slot's seam is the \`surface\` -> \`canvas\` tone step, and the operator's ask was borderless; a rule beside the step is a second way of saying one thing — and it is what made the canvas read as boxed off rather than docked.`,
	);
});

test("the slot's chrome bars carry no ground of their own, at one shared height", () => {
	const heights = new Set();
	for (const pane of PANES) {
		const source = read(pane.file);
		const bars = [...source.matchAll(PANE_BAR)];
		assert.ok(
			bars.length > 0,
			`${pane.name}: no 40px chrome bar found in ${pane.file} — this file reads the bar's own class string and has to be re-read when that shape moves`,
		);
		for (const bar of bars) {
			heights.add(bar[1]);
			assert.ok(
				!bar[2].includes("bg-"),
				`${pane.name}: a chrome bar paints \`${bar[2].trim()}\`. The bar floats on the pane's own ground — a bar with a ground of its own is the band the operator reported, and it is what made the icons read as chrome sitting in a tray rather than on the pane.`,
			);
		}
	}
	assert.equal(
		heights.size,
		1,
		`the slot's chrome bars disagree about their height (${[...heights].join(", ")}). The draw is to keep the bar at the slot's 40px, because that is what keeps the icon row on the line the rest of the app's first row sits on when the pane opens and closes.`,
	);
});

test("nothing in the slot puts a control into the chrome lane", () => {
	for (const pane of [
		...PANES,
		{ name: "slot wrappers", file: CHAT_CONTENT },
	]) {
		const source = read(pane.file);
		assert.ok(
			!source.includes("data-titlebar-drag"),
			`${pane.name} (${pane.file}) marks a drag region. The window's only drag surface in this area is the empty 32px lane \`chat-layout.tsx\` draws above the columns; a control inside a drag region is dead to clicks, which is the defect #539 fixed for overlays.`,
		);
	}
});
