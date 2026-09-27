/**
 * The shell lane's band, and the hand-over a route-owned leading column makes.
 *
 * WHY THIS EXISTS AT ALL. The operator reported one defect twice - "for sub-views
 * like the settings page, the sidebar and view doesn't go all the way to the top"
 * (2026-09-26) and "Same issue with agents and teams" (2026-09-27) - and the fix
 * for the first report (#535, which stood the route band down where the lane is
 * drawn) was in the tree on both days. What the second report was about is the
 * OTHER half: the lane's band is a MIRROR of the columns' grounds, it knows only
 * the app sidebar's width, and a route that draws a leading column of its own
 * (the settings rail, the agents list pane) therefore gets the content ground
 * painted over its width. So the mechanism here is a hand-over - a route gives
 * the shell the element that is its leading column, and the band is measured off
 * it - and this file is what keeps the three call sites from drifting apart.
 *
 * WHAT IT PROVES, AND WHAT IT CANNOT. It reads source text: each route still
 * passes a `ref` from `useLaneLeadingColumn` to its column, the marker is still
 * written by that hook rather than spelled beside it where the two could separate,
 * and the band is still derived from the measured edge rather than from the
 * sidebar's width alone. It does NOT prove the band reaches the column on screen -
 * that is geometry, and `--scene route-tops` measures it in the running app (the
 * readings the fix was built on: the band stopped at 260 against a rail ending at
 * 480 and a list pane ending at 516). The pair is deliberate: this one runs on
 * every PR without a window, the scene needs a built app and a backend.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

/**
 * Every route that draws a leading column of its own, and the element it hands
 * over. The list is the sweep the operator asked for, not the two views he
 * screenshotted: a route added to this list without the hand-over fails below,
 * and `agents-page.tsx` / `legacy-agents-page.tsx` are two separate components
 * that draw the SAME 280px roster - which is exactly how a fix carried by one
 * fails to reach the other.
 */
const LEADING_COLUMN_ROUTES = [
	"src/renderer/src/features/settings/components/settings-page.tsx",
	"src/renderer/src/features/agents/components/agents-page.tsx",
	"src/renderer/src/features/agents/components/legacy-agents-page.tsx",
];

test("every route that draws a leading column hands it to the shell", () => {
	for (const path of LEADING_COLUMN_ROUTES) {
		const source = readSource(path);
		assert.match(
			source,
			/useLaneLeadingColumn/,
			`${path} must take the shell's hand-over hook: a column on the surface ground that nobody hands over is painted over by the lane's content band, which is the defect this exists to stop`,
		);
		assert.match(
			source,
			/ref=\{laneLeadingColumn\}/,
			`${path} must attach the hand-over's ref to the column element itself: a hook call with no ref measures nothing`,
		);
	}
});

test("the marker and the registration are one thing", () => {
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	/*
	 * The attribute is what a rig reads the column by and what the hook registers;
	 * spelled in a route's JSX it could be added to an element the shell was never
	 * handed, and the rig would then describe a column the band does not know about.
	 * So the only writer is the hook.
	 */
	assert.match(
		layout,
		/column\.setAttribute\(LANE_LEADING_COLUMN, ""\)/,
		"the hand-over hook writes the marker itself",
	);
	/*
	 * GATED ON A SHELL (review round 1, N1): the marker's one meaning is "this
	 * element was handed to the shell", so its write is conditioned on a `register`
	 * existing - a route rendered outside the shell (a story) must mark nothing. The
	 * match is whitespace-tolerant for the same reason `chat-sidebar-selection`'s
	 * anchor read now is: what is asserted is the gate, not the line break a format
	 * pass may put inside it.
	 */
	assert.match(
		layout,
		/if \(\s*(?:column\s*&&\s*register|register\s*&&\s*column)\s*\)[\s\S]{0,60}?setAttribute\(\s*LANE_LEADING_COLUMN, ""\)/,
		"the hand-over hook writes the marker only while a shell (`register`) is there to hand the column to: written from outside the shell, the marker describes a hand-over that never happened",
	);
	assert.doesNotMatch(
		layout.replace(/column\.setAttribute\([^)]*\)/, ""),
		/data-lane-leading-column=""/,
		"nothing else may spell the marker out: two writers is how the attribute and the registration separate",
	);
	for (const path of LEADING_COLUMN_ROUTES) {
		assert.doesNotMatch(
			readSource(path),
			/data-lane-leading-column=""/,
			`${path} must not spell the marker itself - it comes from the hand-over, so that an element wearing it is exactly an element the shell was handed`,
		);
	}
});

test("the band is the measured edge, floored at the app sidebar's own width", () => {
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.match(
		layout,
		/const bandWidth = Math\.max\(columnWidth, leadingEdge \?\? 0\);/,
		"the band's width is the measured leading edge with the sidebar's width as its floor: max() rather than the measured value, because a route column is always to the RIGHT of the sidebar and a stale or absent measurement must not narrow the band below the column the lane already carried",
	);
	assert.match(
		layout,
		/\$\{bandWidth\}px, var\(--lo-canvas\) \$\{bandWidth\}px/,
		"the lane's gradient must be painted from that width rather than the sidebar's - the sidebar's alone is the defect",
	);
	assert.doesNotMatch(
		layout,
		/\$\{columnWidth\}px, var\(--lo-canvas\) \$\{columnWidth\}px/,
		"the lane must not go back to stopping at the app sidebar's edge",
	);
});
