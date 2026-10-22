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
 * (`surface` on every column — the settings rail was re-grounded flat on
 * 2026-09-30 after a round on `elevated`; the two agent rosters were already
 * `surface`), the file each column is painted in still carries that same rung's
 * `bg-<ground>` (so the value and the paint fail together - review round 1, M1),
 * and the band is still derived from the measured edge rather than from
 * the sidebar's width alone. The columns draw no right rule any more: the
 * operator's report of 2026-09-27 - "the right border doesn't go all the way up
 * ... either make it extend all the way up or remove the right border" - is
 * answered with the removal, because every boundary those rules drew is a tone
 * step now (the rail's `surface` against the `canvas` content, the rosters'
 * `surface` against the same content), and a rule over a tone step is the
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
 * The legacy roster's drawable box - the pane the wrapper hands over, where
 * that route's right rule used to live, and the file its ground is painted in.
 * Kept beside the list (and above it, since the list names it) because the rule
 * sweep has to follow the element rather than the file that wraps it.
 */
const AGENTS_SIDEBAR =
	"src/renderer/src/features/agents/components/agents-sidebar.tsx";

/**
 * Every route that draws a leading column of its own, the element it hands
 * over, the rung it stands on, and the file its box is PAINTED in. The list is
 * the sweep the operator asked for, not the two views he screenshotted: a route
 * added to this list without the hand-over fails below, and `agents-page.tsx` /
 * `legacy-agents-page.tsx` are two separate components that draw the SAME
 * roster - which is exactly how a fix carried by one fails to reach the other.
 * The ground is part of each entry because the hand-over now NAMES it: the lane
 * paints that role across the column's width, so a route that moves its column
 * without moving its ground (or the reverse) is the drift this list exists to
 * catch. `paintedBy` is the file the box's ground lives in - the same file for
 * `/agents`, where the ref sits on the painted `<aside>` itself, and one hop
 * further out for the settings rail and the legacy roster, whose wrappers hand
 * over the component whose ROOT box is painted - so the handed value and the
 * painted class are read together and fail together (review round 1, M1).
 */
const LEADING_COLUMN_ROUTES = [
	{
		path: "src/renderer/src/features/settings/components/settings-page.tsx",
		ground: "surface",
		paintedBy:
			"src/renderer/src/features/settings/components/settings-sidebar.tsx",
	},
	{
		path: "src/renderer/src/features/agents/components/agents-page.tsx",
		ground: "surface",
		paintedBy: "src/renderer/src/features/agents/components/agents-page.tsx",
	},
	{
		path: "src/renderer/src/features/agents/components/legacy-agents-page.tsx",
		ground: "surface",
		paintedBy: AGENTS_SIDEBAR,
	},
	{
		path: "src/renderer/src/features/library/components/library-page.tsx",
		ground: "surface",
		paintedBy: "src/renderer/src/features/library/components/library-page.tsx",
	},
];

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

test("the box a route hands over is painted in the ground it names", () => {
	/*
	 * THE PAINTED GROUND AND THE HANDED VALUE FAIL TOGETHER (review round 1,
	 * M1). The sweep read the hand-over file per route - and `agents-sidebar.tsx`
	 * only for rule spellings - so re-grounding the painting box alone passed
	 * every gate and was caught only by the `route-tops` scene, which needs a
	 * built app and a backend. What a text sweep can resolve is the FILE the box
	 * is painted in, named per entry above, and the class is read there in its
	 * className form so a box's own ground is what is asserted: the rail's
	 * `bg-surface` root, the rosters' `bg-surface` boxes. The token is exact
	 * (review round 2's nit): a slash form (`bg-surface/50`) is a wash OF the
	 * rung, not the rung, and the lookahead refuses it. A file that loses the
	 * class, or a value the file never paints, fails on this line instead of on a
	 * review of two files that were each moved alone.
	 */
	for (const { path, ground, paintedBy } of LEADING_COLUMN_ROUTES) {
		assert.match(
			readSource(paintedBy),
			new RegExp(`className="[^"]*(?<![:\\w-])bg-${ground}(?![\\w/-])[^"]*"`),
			`${paintedBy} no longer paints the ground ${path} hands over ("${ground}") as a box's own className: the value and the paint are one decision, and a re-grounding that moves only one of them paints the wrong rung from y0 down - the same drift this list exists to catch`,
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

test("the lane is an overlay and panels paint from y0", () => {
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.match(
		layout,
		/data-titlebar-lane=""/,
		"the shell must still draw its drag lane over the window's top edge",
	);
	assert.match(
		layout,
		/className="absolute inset-x-0 top-0 z-30 h-\[var\(--chrome-strip-h\)\]"/,
		"the lane must be an OVERLAY at y0, not a row that reserves height: a reserved row is exactly the band that makes the sidebar and view start 32px down (operator report, 2026-10-20, third occurrence)",
	);
	assert.match(
		layout,
		/\{flushTop \? \(/,
		"the absolute overlay must be the flushTop branch: routes that have not opted into full-bleed panels keep the painted lane row and their previous first-row position",
	);
	assert.match(
		layout,
		/flushTop\?: boolean/,
		"the shell must let a route whose own panels reach y0 opt out of the column padding; otherwise the padding starts the panel 32px down",
	);
	const app = readSource("src/renderer/src/app.tsx");
	assert.match(
		app,
		/flushTop=\{pathname\.startsWith\("\/team-bridge"\)\}/,
		"the Team Bridge route must opt into flushTop, the same way chat and browser own their top row",
	);
	const page = readSource(
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
	);
	assert.match(
		page,
		/className="@container\/bridge relative flex h-full min-h-0 w-full overflow-hidden bg-canvas"/,
		"the responsive thread container must still occupy the full y0 canvas on its own ground; relative positioning anchors the narrow takeover without offsetting the panel",
	);
	assert.match(
		page,
		/pt-\[var\(--panel-top-pad,0px\)\]/,
		"Team Bridge's panels must move the traffic-light clearance INSIDE the panel as padding, never as an offset of the panel",
	);
});

/**
 * The panel surfaces the operator asked us to audit, rather than only the two
 * screenshots: the app sidebar, the canvas rail, the settings and agents rails,
 * the legacy roster and the Library route. Their roots own a ground; none may
 * draw a side rule. The preview dock counts because it is the Library's other
 * panel and its former `border-l` is the same redundant second mark.
 */
const PANEL_SURFACES = [
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	"src/renderer/src/features/settings/components/settings-sidebar.tsx",
	AGENTS_SIDEBAR,
	"src/renderer/src/features/agents/components/legacy-agents-page.tsx",
	"src/renderer/src/features/library/components/library-page.tsx",
];

test("panel surfaces are borderless and the Library rail fades at the top", () => {
	for (const path of PANEL_SURFACES) {
		assert.doesNotMatch(
			readSource(path),
			/className="[^"]*\bborder-[lr]\b/,
			`${path} draws a side rule on a panel: panels separate by ground and spacing, never by a stroke`,
		);
	}
	const rail = readSource(
		"src/renderer/src/features/library/components/library-filter-rail.tsx",
	);
	assert.match(
		rail,
		/data-lo-sidebar-edge-cues/,
		"the Library rail must take the shared scroll-edge fade: a panel scrolls under its top spacing instead of clipping against a hard boundary",
	);
	assert.match(
		rail,
		/overflow-y-auto/,
		"the Library rail must remain the scroller the fade is measured on",
	);
});

test("no route column draws a right rule any more", () => {
	/*
	 * THE OPERATOR'S FIRST SENTENCE, as a guard (2026-09-27): "the right border
	 * doesn't go all the way up ... either make it extend all the way up or remove
	 * the right border". It is the removal, on every route column, and for the same
	 * reason on each: the boundary those rules drew is a tone step now (the rail's
	 * `surface` against the `canvas` content, the rosters' `surface` against the
	 * same content) and a rule over a tone step is the redundant second mark
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

test("the non-flush lane still paints the measured grounds", () => {
	/*
	 * The flushTop branch is an overlay, but the routes that have NOT opted in
	 * keep the painted lane row exactly as it was: its width is the leading
	 * column's measured edge with the sidebar as the floor, and the ground the
	 * hand-over names is the role it paints. Losing these pins would let the
	 * untouched branch drift while the new one is reviewed.
	 */
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.match(
		layout,
		/const laneEdge = Math\.max\(columnWidth, leading\?\.edge \?\? 0\);/,
		"the lane's width must stay the measured leading edge with the sidebar as its floor",
	);
	assert.match(
		layout,
		/laneGround === "surface"/,
		"the non-flush lane must still branch on the ground the marker names",
	);
	assert.match(
		layout,
		/var\(--lo-\$\{laneGround\}\)/,
		"the non-surface ground must be a role, not a literal",
	);
	assert.match(
		layout,
		/var\(--lo-canvas\) \$\{laneEdge\}px/,
		"the non-flush lane must paint its canvas stop from the measured width",
	);
});

test("the flush-top app sidebar pads its own surface root", () => {
	const sidebar = readSource(
		"src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
	);
	assert.match(
		sidebar,
		/data-chrome-pad-top=\{chromePadTop \? "" : undefined\}/,
		"the sidebar must write the pad marker only when the shell route asked for flush top",
	);
	assert.match(
		sidebar,
		/className="group\/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-surface"/,
		"the padded panel must remain the element that paints `surface`; a shell wrapper with a ground would defeat glass (round 1 S1)",
	);
	const css = readSource("src/renderer/src/styles/index.css");
	assert.match(
		css,
		/\[data-chrome-pad-top\] \{\s*padding-top: var\(--chrome-strip-h\);\s*\}/,
		"the pad must be CSS on the marker, so the panel's ground reaches y0 while its content clears the traffic lights",
	);
});
