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
 * the marker's VALUE is the rung the lane must paint across the column's width
 * (`elevated` for the settings rail since 2026-09-27, `surface` for the two agent
 * rosters), and the band is still derived from the measured edge rather than from
 * the sidebar's width alone. The columns draw no right rule any more: the
 * operator's report of 2026-09-27 - "the right border doesn't go all the way up
 * ... either make it extend all the way up or remove the right border" - is
 * answered with the removal, because every boundary those rules drew is a tone
 * step now (the rail's `elevated` against the sidebar and the content, the
 * rosters' `surface` against the content), and a rule over a tone step is the
 * redundant second mark this fleet removes (#564 took the dock's leading rule for
 * the same reason). It does NOT prove the lane reaches the column on screen -
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
 * Every route that draws a leading column of its own, the element it hands
 * over, and the rung it stands on. The list is the sweep the operator asked
 * for, not the two views he screenshotted: a route added to this list without
 * the hand-over fails below, and `agents-page.tsx` / `legacy-agents-page.tsx`
 * are two separate components that draw the SAME roster - which is exactly how
 * a fix carried by one fails to reach the other. The ground is part of each
 * entry because the hand-over now NAMES it: the lane paints that role across
 * the column's width, so a route that moves its column without moving its
 * ground (or the reverse) is the drift this list exists to catch.
 */
const LEADING_COLUMN_ROUTES = [
	{
		path: "src/renderer/src/features/settings/components/settings-page.tsx",
		ground: "elevated",
	},
	{
		path: "src/renderer/src/features/agents/components/agents-page.tsx",
		ground: "surface",
	},
	{
		path: "src/renderer/src/features/agents/components/legacy-agents-page.tsx",
		ground: "surface",
	},
];

/**
 * The legacy roster's drawable box - the pane the wrapper hands over, and where
 * that route's right rule used to live. Kept beside the list because the rule
 * sweep has to follow the element rather than the file that wraps it.
 */
const AGENTS_SIDEBAR =
	"src/renderer/src/features/agents/components/agents-sidebar.tsx";

test("every route that draws a leading column hands it to the shell", () => {
	for (const { path, ground } of LEADING_COLUMN_ROUTES) {
		const source = readSource(path);
		assert.match(
			source,
			/useLaneLeadingColumn/,
			`${path} must take the shell's hand-over hook: a leading column nobody hands over keeps the lane's ground painted across its width, which is the defect this exists to stop`,
		);
		assert.match(
			source,
			new RegExp(`useLaneLeadingColumn\\(\\s*"${ground}"\\s*\\)`),
			`${path} must hand its column over on the rung it actually stands on ("${ground}"): the lane paints the ground the marker names across the column's width, so a stale value paints the wrong rung from y0 down - the same class of defect, one layer up`,
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
		/column\.setAttribute\(LANE_LEADING_COLUMN, ground\)/,
		"the hand-over hook writes the marker itself, with the ground it was handed",
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
		/if \(\s*(?:column\s*&&\s*register|register\s*&&\s*column)\s*\)[\s\S]{0,80}?setAttribute\(\s*LANE_LEADING_COLUMN, ground\s*\)/,
		"the hand-over hook writes the marker only while a shell (`register`) is there to hand the column to: written from outside the shell, the marker describes a hand-over that never happened",
	);
	assert.doesNotMatch(
		layout.replace(/column\.setAttribute\([^)]*\)/, ""),
		/data-lane-leading-column=/,
		"nothing else may spell the marker out: two writers is how the attribute and the registration separate",
	);
	for (const { path } of LEADING_COLUMN_ROUTES) {
		assert.doesNotMatch(
			readSource(path),
			/data-lane-leading-column=/,
			`${path} must not spell the marker itself - it comes from the hand-over, so that an element wearing it is exactly an element the shell was handed`,
		);
	}
});

test("the lane paints the column's own rung, and a surface column keeps the old band", () => {
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.match(
		layout,
		/const laneEdge = Math\.max\(columnWidth, leading\?\.edge \?\? 0\);/,
		"the band's width is the measured leading edge with the sidebar's width as its floor: max() rather than the measured value, because a route column is always to the RIGHT of the sidebar and a stale or absent measurement must not narrow the band below the column the lane already carried",
	);
	assert.match(
		layout,
		/laneGround === "surface"/,
		"the lane must branch on the ground the marker names: a `surface` column IS the band (the historic two-stop gradient), and any other rung splits it so the sidebar's width stays `surface` and the column's width takes the named role",
	);
	assert.match(
		layout,
		/var\(--lo-\$\{laneGround\}\)/,
		"the non-`surface` shape must paint the role rather than a colour: a literal here is a value the next palette cannot move",
	);
	assert.match(
		layout,
		/var\(--lo-canvas\) \$\{laneEdge\}px/,
		"the lane's gradient must be painted from the measured width rather than the sidebar's - the sidebar's alone is the defect",
	);
	assert.doesNotMatch(
		layout,
		/\$\{columnWidth\}px, var\(--lo-canvas\) \$\{columnWidth\}px/,
		"the lane must not go back to stopping at the app sidebar's edge",
	);
});

test("no route column draws a right rule any more", () => {
	/*
	 * THE OPERATOR'S FIRST SENTENCE, as a guard (2026-09-27): "the right border
	 * doesn't go all the way up ... either make it extend all the way up or remove
	 * the right border". It is the removal, on every route column, and for the same
	 * reason on each: the boundary those rules drew is a tone step now (the rail's
	 * `elevated` against the sidebar and the content, the rosters' `surface`
	 * against the content) and a rule over a tone step is the redundant second mark
	 * this fleet removes (`#564` took the dock's leading rule for the same reason).
	 *
	 * AND A RULE COULD NEVER HAVE BEEN EXTENDED FROM THE ROUTE ITSELF: nothing a
	 * route renders reaches y0 - two clipped ancestors - so its top 32px are the
	 * shell lane's to paint, and a rule that came back would begin at the lane's
	 * lower edge, which is the half-drawn edge being reported. If a rule is ever
	 * wanted here, it is a lane feature and this test is where that conversation
	 * starts.
	 */
	for (const { path } of LEADING_COLUMN_ROUTES) {
		assert.doesNotMatch(
			readSource(path),
			/border-r border-hairline/,
			`${path} draws a right rule again: the boundary beside it is a tone step, and the rule can only begin at the lane's lower edge (y 32) - the operator's report verbatim`,
		);
	}
	/*
	 * The legacy roster's rule lives one file further in - the wrapper hands over
	 * `AgentsSidebar`, which is where the drawable box actually is - so the sweep
	 * follows the element rather than the wrapper's file. `border-hairline
	 * border-r` was its spelling (order and all); both spellings are refused.
	 */
	assert.doesNotMatch(
		readSource(AGENTS_SIDEBAR),
		/(border-hairline border-r|border-r border-hairline)/,
		`${AGENTS_SIDEBAR} draws the roster's right rule again: the roster's \`surface\` against the \`canvas\` content is a tone step, and the rule would stop at the lane's lower edge - the operator's report verbatim`,
	);
});
