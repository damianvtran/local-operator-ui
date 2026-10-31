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
 *   1. **Every occupant of the slot roots at the slot's own ground, from y0.**
 *      The lane is a transparent overlay (the panel contract), so there is no
 *      gradient left to derive the slot's rung from: each pane must paint
 *      `bg-elevated` itself and wear `panel-top-pad`, which makes its ground
 *      continuous from y0 down and its first row sit below the strip. A pane
 *      rooted anywhere else - the conversation's `canvas` included - shows the
 *      wrong ground in the strip, and one without the pad puts its toolbar under
 *      the traffic lights. This file reads each pane's own class string.
 *   2. **No seam rule on the slot's wrappers.** The boundary is the tone step
 *      the ladder already draws — the sidebar's `surface`, the conversation's
 *      `canvas` and the slot's `elevated` — and a `border-l border-hairline`
 *      beside the step is the second way of saying one thing, and the operator's
 *      ask was borderless.
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
 * pair there, ΔE00 2.05-6.76 across the palettes, and `canvas` -> `elevated` the
 * region pair its `REGION_SEPARATION_FLOOR` holds at 4.0) and the frames are the
 * evidence set's. A green run here says the slot is wired the way the report asked.
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
const UI_STORE = "src/renderer/src/shared/store/ui-preferences-store.ts";

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
	/*
	 * The asks drawer joined the family in the side-canvas change (design note §2):
	 * it is the slot's FIFTH occupant, so it is held to the same two facts as the
	 * other four - its root at the lane's last stop, and a 40px chrome bar with no
	 * ground of its own. A pane that were given a chrome bar of a different height
	 * would break the "the icons stay on the app's top line" invariant for every pane
	 * that opens beside it.
	 */
	{
		name: "asks drawer",
		file: "src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
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
/* A class-utility match, not a substring one: `border`, `divide`, `shadow`, `ring`
 * and `outline` as the START of a utility (after whitespace, a variant colon, a
 * quote or the important `!`), whole word up to its `-` suffix, so `ring-surface`
 * and `border-l` count and a word that merely contains them does not. */
const RAIL_RULE_UTILITY =
	/(?:^|[\s"'`:!])(?:border|divide|shadow|ring|outline)(?![a-zA-Z])/;
/* The rail root's ground, the one class the negative pin must still find. */
const RAIL_GROUND = /\bbg-surface\b/;
/* The panel rail host's own ground (#872), in the shell. */
const RAIL_HOST_GROUND =
	/data-panel-rail-host=""[\s\S]{0,500}?className="[^"]*\b(bg-[\w-]+)\b[^"]*"/;
/* Trailing utilities are allowed after the ground: the browser pane's root carries its
 * `@container/bpane` there (#872, D5), and the ground is still the token that follows
 * `flex h-full flex-col`. */
const PANE_ROOT =
	/className=\{cn\(\s*"((?=[^"]*\bpanel-top-pad\b)[^"]*flex h-full flex-col (bg-[\w-]+)[^"]*)"\s*,?\s*\)\}/g;
const PANE_BAR =
	/"flex (h-\d+) shrink-0 items-center justify-between gap-2 ([^"]*?)px-2"/g;
const SLOT_BOX =
	/"relative h-full overflow-hidden transition-\[width\] duration-base ease-out-quart"/;

/** A drag attribute anywhere in the slot the dock is mounted in. */
const DRAG_IN_SLOT = /<PaneSlot[\s\S]{0,400}?data-titlebar-drag/;
/* The drawer slot's own two reads (agent review round 1, N3), at module scope for
 * the reason the note above the other shapes gives: a literal rebuilt per call is
 * work `useTopLevelRegex` is right to refuse. */
const ASK_SLOT_MODE = /data-ask-mode=\{canvasDocked \? "docked" : "overlay"\}/;
const RIGHT_SLOT_OCCUPIED = /const rightSlotOccupied =([\s\S]{0,400}?);/;
/* #868's publisher and mount-gate reads, at module scope for the same reason.
 * The publisher's shape shrank to `{mounted, session}` with the always-visible
 * rail (D2): every durable pane mounts on any chat route, so the session
 * drawer's term is the only gate left for the store to mirror. */
const ROUTE_PUBLISH =
	/setRightSlotRoute\(\{\s*mounted: true,\s*session: hasSession\s*\}\)/;
const ROUTE_PUBLISH_DEPS = /\[\s*setRightSlotRoute,\s*hasSession\s*\]/;
const HAS_SESSION = /const hasSession = Boolean\(sessionId\);/;
const SESSION_ASKS_GATE =
	/const sessionAsksOpen =\s*isAskDrawerOpen && askDrawerScope === "session" && Boolean\(sessionId\);/;
const DRAWABLE_BODY = /const rightSlotPaneDrawable = \([\s\S]*?\n\};\n/;
/* The asks drawer's content measure and the scroller it hangs inside (design review
 * round 1, D1). The wrappers are read by shape rather than by position: the measure
 * must be a CHILD of the scroller that keeps the pane's width, or the scrollbar
 * ends up inside the constrained column and narrows it whenever the queue grows. */
const DRAWER_SCROLLER = /"min-h-0 flex-1 flex-col overflow-y-auto px-3 py-2"/;
const DRAWER_MEASURE = /className=\{cn\("w-full max-w-\[720px\]"\)\}/;
const DRAWABLE_ASK =
	/if \(pane === "ask"\) \{\s*return \(\s*state\.askDrawerScope === "fleet" \|\|\s*\(state\.rightSlotRoute\.mounted && state\.rightSlotRoute\.session\)\s*\);\s*\}/;
/* Every durable pane draws on a mounted route (the always-visible rail, D2): the
   tail of the function is the bare `mounted` fact, with no per-pane term after it. */
const DRAWABLE_MOUNTED = /\n\treturn state\.rightSlotRoute\.mounted;\n\};\n$/;
const FLEET_GATE =
	/const fleetAsksOpen = askDrawerOpen && askDrawerScope === "fleet";/;
/* The yield is the fifth argument and the rail's width (#872) the sixth, so the
 * pin is the PAIR: the derivation still feeds the yield and nothing else sits there. */
const SIDEBAR_YIELD_ARG = /slotYieldsSidebar,\s*railWidth,\s*\);/;
const SIDEBAR_YIELD_READ =
	/useUiPreferencesStore\(\s*resolveRightSlotYieldsSidebar,?\s*\)/;
const HEADER_OCCUPIED_READ =
	/useUiPreferencesStore\(\s*resolveRightSlotOccupied,?\s*\)/;
const SIDEBAR_BARE_FLAGS = /canvasOpen\s*\|\|\s*askDrawerOpen/;
const SLOT_COMPONENT =
	"src/renderer/src/shared/components/common/pane-slot.tsx";

/**
 * Every file that mounts a pane or stands in for the slot around one.
 *
 * THE STORY ARMS ARE IN THIS LIST BECAUSE THEY WERE THE DEFECT. The first version
 * of this file scanned the app's own wrapper and nothing else, and the evidence
 * stories - `canvas.stories.tsx`, `run-details.stories.tsx`,
 * `browser-pane.stories.tsx` - each wrote their own copy of the slot with the
 * leading `border-l border-hairline` still on it. So the app stopped drawing a
 * seam, the harness kept drawing one, and every before/after frame in the
 * delivered set showed a boundary the product no longer had (design review round
 * 1, D1). A guard that reads only the app cannot see the instrument.
 */
const PANE_HOSTS = [
	SLOT_COMPONENT,
	CHAT_CONTENT,
	"src/renderer/src/features/chat/components/canvas/canvas.stories.tsx",
	"src/renderer/src/features/chat/components/run-details/run-details.stories.tsx",
	"src/renderer/src/features/browser/components/browser-pane.stories.tsx",
	"src/renderer/src/shared/components/navigation/shell.stories.tsx",
];

/**
 * The lane's own stops, read off the gradient `chat-layout.tsx` paints it with.
 *
 * The gradient is `linear-gradient(to right, <sidebar> <band>px,
 * <conversation> <band>px, <conversation> <edge>px, <slot> <edge>px)`: the
 * sidebar's ground to the band's width, the CONVERSATION'S TOKEN REPEATED at
 * the slot's leading edge, and the slot's own ground from that edge to the
 * window's right edge. Reading those tokens here, rather than restating them, is
 * the whole point of claim 1 — a literal would pass while the lane and the slot
 * disagreed.
 *
 * The repeat is asserted rather than assumed, because the shape it refuses is
 * the near-miss: a three-stop gradient from the conversation's token to the
 * slot's interpolates one ground into the other across the conversation's whole
 * width, which is a band that fades rather than a stop that lands.
 *
 * THE BAND'S OWN STOP IS DELIBERATELY NOT READ HERE, beyond its existence: it is
 * the sidebar's width on a route with no column of its own and that column's
 * right edge where one exists (`Math.max` over the two), and that geometry is
 * `lane-leading.test.mjs`'s subject rather than this file's. What this file
 * holds is the SHAPE — six stops, the conversation's token repeated, the slot's
 * ground starting exactly where the conversation's ends, and (#872) the rail's
 * ground starting exactly where the slot's ends — and the stop count, so
 * any other shape is a re-read rather than a silently ignored band.
 */
const CHAT_VIEW_GROUND =
	/"flex h-full min-h-0 grow flex-col overflow-hidden rounded-none (bg-[\w-]+)"/;

/** `bg-elevated` -> `--lo-elevated`, the two spellings of one role. */
const tokenOf = (utility) => `--lo-${utility.slice(3)}`;

/** The ground the conversation's column declares, as `--lo-<role>`. */
function conversationGround() {
	const view = read(CHAT_CONTENT).match(CHAT_VIEW_GROUND);
	assert.ok(
		view,
		"chat-content.tsx no longer declares the chat view's ground as `overflow-hidden rounded-none bg-*`; the lane's conversation stop is derived from that literal, so this file must be re-read before it can assert anything",
	);
	return tokenOf(view[1]);
}

/** The ground token a pane's root section/div paints, as `bg-<role>`. */
function paneRootGround(file, name) {
	const source = read(file);
	const matches = [...source.matchAll(PANE_ROOT)];
	assert.ok(
		matches.length > 0,
		`${name}: no 'panel-top-pad flex h-full flex-col bg-*' root found in ${file} - the pane's ground and its pad are read off its own class string, so this file has to be re-read before it can assert anything`,
	);
	for (const match of matches) {
		assert.equal(
			match[2],
			"bg-elevated",
			`${name}: a root in ${file} paints \`${match[2]}\`. Every occupant of the right-pane slot must paint the slot's own \`elevated\` ground from y0; the lane no longer paints it, so anything else shows the conversation's canvas in the strip - the seam the operator reported, one layer up.`,
		);
	}
	return matches.length;
}

test("every pane in the slot paints its own ground and pads its first row", () => {
	/*
	 * The lane is transparent now, so the slot's continuity is the panes' own
	 * `bg-elevated` plus the shared `panel-top-pad`, not a token the shell paints
	 * above them. `PANE_ROOT` requires both, so a root that drops either fails on
	 * this line rather than in a screenshot.
	 */
	for (const pane of PANES) {
		paneRootGround(pane.file, pane.name);
	}
	const layout = read(CHAT_LAYOUT);
	assert.doesNotMatch(
		layout,
		/linear-gradient|style=\{\{\s*background/,
		"the lane must paint no ground: the panes paint their own, and a gradient above them is the mirror that could not know about a panel it was not told about",
	);
	assert.match(
		layout,
		/data-titlebar-lane=""/,
		"the lane must still exist as the drag surface",
	);
});

test("the panel rail paints the lane's final stop with no rule on its leading edge, on both ground branches (#872)", () => {
	/*
	 * The lane is a mirror of the columns' grounds, and the rail is a column: the
	 * host's own class and the lane's last stop are ONE decision stated twice, so
	 * they are compared here rather than either being restated as a literal. The
	 * rail is chrome (`surface`, the sidebar's rung), NOT a slot wrapper - its file
	 * is not in PANE_HOSTS - and it draws NO rule of its own: the boundary to the
	 * slot's `elevated` (or the conversation's `canvas` with no pane) is the tone
	 * step, the same way the sidebar's edge is carried, and the `border-l
	 * border-hairline` that used to sit here was the same second-way-of-saying-one-
	 * thing the no-seam test below refuses for the slot's wrappers. This is a
	 * NEGATIVE pin - the rail root's class list carries its ground and nothing that
	 * draws a line - so a rule cannot quietly return to the window's edge.
	 */
	const layoutSource = read(CHAT_LAYOUT);
	const host = layoutSource.match(RAIL_HOST_GROUND);
	assert.ok(
		host,
		`${CHAT_LAYOUT} no longer declares the rail host with \`data-panel-rail-host=""\` and a ground class`,
	);
	assert.equal(
		host[1],
		"bg-surface",
		"the rail host must paint the rail's own `surface` from y0: it is the panel in that column now, and the lane cannot paint it",
	);
	const rail = read(
		"src/renderer/src/shared/components/navigation/panel-rail.tsx",
	);
	/*
	 * THE WHOLE `cn(...)` ARGUMENT LIST, not its first literal. The root's classes
	 * are computed from several arguments (the ground literal, then the caption-inset
	 * padding literal, with prose comments between them), and a rule utility added
	 * to any later one would draw the edge just as well as one in the first. A
	 * pattern anchored on one literal proved absence in that string only, so the call
	 * is cut out by its balanced parentheses from the root's `className={cn(` and
	 * read after `withoutComments`, which keeps the comment that QUOTES the removed
	 * `border-l border-hairline` from tripping the pin it justifies.
	 */
	const start = rail.indexOf('data-panel-rail=""');
	const open = rail.indexOf("className={cn(", start);
	assert.ok(
		start !== -1 && open !== -1,
		"panel-rail.tsx no longer declares the rail root as `data-panel-rail` followed by `className={cn(...)}` - update the pin, not the spelling, or a rule can hide behind the miss",
	);
	let depth = 0;
	let end = -1;
	const callStart = open + "className={cn".length;
	/* Parentheses balance across the call's literals (`calc(var(...))`), so a plain
	 * depth count finds the call's own close without parsing strings. Comments are
	 * stripped from the TAIL first so a `)` in prose cannot unbalance it. */
	const tail = withoutComments(rail.slice(callStart));
	for (let i = 0; i < tail.length; i++) {
		if (tail[i] === "(") depth++;
		else if (tail[i] === ")" && --depth === 0) {
			end = i;
			break;
		}
	}
	assert.ok(end !== -1, "the rail root's `cn(...)` call never closes");
	const rootClasses = tail.slice(0, end + 1);
	assert.ok(
		rootClasses.length > 20,
		"the rail root's class computation is empty - the pin would pass vacuously",
	);
	assert.doesNotMatch(
		rootClasses,
		RAIL_RULE_UTILITY,
		"the rail root carries a rule utility again. The rail's edge is the tone step (`surface` against `elevated`/`canvas`); a border, divide or shadow beside it is a second way of saying one thing - and the operator's report on the shipped rail was exactly that line: the hairline began at y=32 under the lane and read as a line that did not go all the way up.",
	);
	assert.match(
		rootClasses,
		RAIL_GROUND,
		"the rail root lost its ground: `surface` is the sidebar's rung and the lane's final stop (asserted just above)",
	);
});

/*
 * THE DRAWER'S CONTENT MEASURE (design review round 1, D1). The slot's one ceiling
 * reaches 1200 with the one-band change, and until this measure existed the card
 * filled it: 1176 wide around a 277px question run at a 1200 pane. The card is a
 * decision, not a surface to scan, so the column stops at 720 - and the mount is
 * checked, not just the constant, because a measure that drifted onto the scroller
 * would look identical at the 640 default and only show up as a reflowing measure
 * on a queue taller than the window.
 */
test("the asks drawer's content stops at one measure, inside a full-width scroller", () => {
	const source = withoutComments(
		read("src/renderer/src/features/chat/components/asks/ask-drawer.tsx"),
	);
	const scroller = DRAWER_SCROLLER.exec(source);
	assert.ok(
		scroller,
		"the drawer's scroller lost the class this test reads; without it the pane has no column that owns the overflow",
	);
	const measure = DRAWER_MEASURE.exec(source);
	assert.ok(
		measure,
		"the asks drawer has no content measure again: at a 1200 pane the card fills the band around a 277px question run",
	);
	assert.ok(
		scroller.index < measure.index &&
			!/max-w-/.test(source.slice(scroller.index, measure.index)),
		"the measure moved onto the scroller (or above it): the scrollbar would then sit inside the constrained column and narrow the measure whenever the queue overflows",
	);
});

test("no seam rule on the slot's wrappers, in the app or in the harness", () => {
	for (const host of PANE_HOSTS) {
		const source = withoutComments(read(host));
		assert.ok(
			!source.includes("border-l border-hairline"),
			`${host} draws \`border-l border-hairline\` beside the pane slot. The slot's seam is the tone step the ladder already draws (\`surface\` / \`canvas\` / \`elevated\`), and the operator's ask was borderless; a rule beside the step is a second way of saying one thing — and a harness copy of it photographs a boundary the product does not draw (design review round 1, D1).`,
		);
	}
});

test("the slot's box is spelled once, and every mount site uses that one", () => {
	const sources = PANE_HOSTS.map((host) => [host, withoutComments(read(host))]);
	const spellings = sources.filter(([, source]) => SLOT_BOX.test(source));
	assert.deepEqual(
		spellings.map(([host]) => host),
		[SLOT_COMPONENT],
		`the slot's box class list is spelled in ${spellings.map(([host]) => host).join(", ")}. It belongs in ${SLOT_COMPONENT} alone: the app's four mount sites, the three story arms and the shell story all mount \`<PaneSlot>\`, so a second spelling of the box is a copy that can drift from it — which is exactly how the \`border-l\` outlived its removal.`,
	);
	const app = withoutComments(read(CHAT_CONTENT));
	assert.equal(
		[...app.matchAll(/<PaneSlot\b/g)].length,
		6,
		`expected the app's six mount sites in ${CHAT_CONTENT} to use \`<PaneSlot>\` (canvas, run panel, browser, console, asks drawer, code review pane). A seventh pane, or one that went back to a bare div, changes where the slot's ground and seam are decided.`,
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

test("the header's drag rect and the lane are the window's drag surfaces, and the dock's band is neither", () => {
	/*
	 * The lane is the empty drag surface above the columns, and the chat header is
	 * a second one (measured with the header on screen: the lane at `0,0 -> W,32`
	 * and `header[data-tour-tag="chat-header"]` at `56,32 -> 540,72` in a 960px
	 * story viewport). A first version of this pass read the window's drag shape
	 * from a no-backend boot, where the chat route paints its refusal surface and no
	 * header exists, so it saw one surface and reported that (UX round 1, U1).
	 *
	 * What this file can hold without a DOM is the half that can be refused: the
	 * panes and the slot name no drag attribute, so nothing the dock draws can
	 * swallow a press. The rects themselves are measured in a browser - and the
	 * reading is taken from the shell story rather than a backed app boot, because
	 * `src/renderer/index.html` pins `connect-src` to 1111 and 8080 and both are
	 * held by other lanes on this machine.
	 */
	const header = withoutComments(read(CHAT_CONTENT));
	assert.ok(
		!DRAG_IN_SLOT.test(header),
		`${CHAT_CONTENT} marks the slot's box (or the pane in it) as a drag region. The dock's band is where its controls live; a drag region over it is dead to clicks.`,
	);
});

test("nothing in the slot puts a control into the chrome lane", () => {
	for (const pane of [
		...PANES,
		{ name: "slot wrappers", file: CHAT_CONTENT },
		{ name: "slot box", file: SLOT_COMPONENT },
	]) {
		const source = read(pane.file);
		assert.ok(
			!source.includes("data-titlebar-drag"),
			`${pane.name} (${pane.file}) marks a drag region. The window's only drag surface in this area is the empty 32px lane \`chat-layout.tsx\` draws above the columns; a control inside a drag region is dead to clicks, which is the defect #539 fixed for overlays.`,
		);
	}
});

test("the drawer's slot is readable, and the header's OS corner is reserved for it too", () => {
	const source = withoutComments(read(CHAT_CONTENT));
	/*
	 * AGENT REVIEW ROUND 1, N3. Two facts about this call site had no re-reader: the
	 * drawer's slot wrote `data-ask-mode` and nothing read it (the canvas's own
	 * `data-canvas-mode` is read by `scripts/renderer-driver.mjs`), and
	 * `rightSlotOccupied` had gained the drawer's term for the header's OS-control
	 * corner with no test and no frame. Both are properties of this file rather than
	 * of a rendered surface, so they are pinned here - and the docked frame the
	 * evidence set carries (`docs/evidence/ask-drawer/after/dock-asks/`) is the
	 * visual half of the reservation.
	 *
	 * (#868 evolved the second pin: `rightSlotOccupied` now reads the store's own
	 * derivation rather than restating the five flags, because a bare flag cannot
	 * tell a CLAIMED pane from one the route can DRAW - the second copy is what
	 * reserved the corner for a pane that was not on screen.)
	 */
	const mode = source.match(ASK_SLOT_MODE);
	assert.ok(
		mode,
		`${CHAT_CONTENT} no longer writes the drawer slot's \`data-ask-mode\` from \`canvasDocked\`. The canvas dock's \`data-canvas-mode\` is what a rig reads to tell a docked pane from one that has stopped docking; the drawer's slot is read the same way or a rig cannot tell them apart either.`,
	);
	const reservation = source.match(RIGHT_SLOT_OCCUPIED);
	assert.ok(
		reservation,
		`${CHAT_CONTENT} no longer derives \`rightSlotOccupied\` as one expression. It decides whether the chat header has to reserve the window's OS-control corner (§J4); this file reads that expression's text, so a rewrite has to re-read this pin.`,
	);
	/*
	 * #868: THE DISJUNCTION MOVED INTO THE STORE, where the route facts live. The
	 * pin is now that the header reads the ONE derivation rather than restating
	 * the five flags - the second copy is exactly what reserved a corner for a
	 * pane no route mounts. The store's own route matrix is
	 * `right-slot-width.test.mjs`'s subject.
	 */
	assert.ok(
		HEADER_OCCUPIED_READ.test(reservation[1]),
		`${CHAT_CONTENT}'s \`rightSlotOccupied\` no longer reads the store's \`resolveRightSlotOccupied\` derivation (#868). The header's reservation has to answer from the same claim and the same route facts as the lane's stop and the column's deficit; a disjunction of bare flags here is the second copy that reserved a corner for a pane that is not on screen.`,
	);
});

test("the published route facts are the mount gates' own terms (#868)", () => {
	/*
	 * THE LINK THE FIX RESTS ON, pinned. `rightSlotRoute` is a COPY of the
	 * conditions that live in `chat-content`'s JSX; the store answers from the
	 * copy, so a gate that grew a term the copy does not know would draw (or fail
	 * to draw) a pane the lane, the column and the header disagree about - the
	 * empty band this issue is about, back by a different door. Both halves are
	 * read as text because neither is observable until a route reaches the
	 * disagreeing state: the publisher's expressions here, each pane's mount
	 * condition below, and `rightSlotPaneDrawable`'s encoding of them after.
	 */
	const content = withoutComments(read(CHAT_CONTENT));
	// The publisher: the two facts, from the expression the session drawer's
	// gate reads, keyed on the BOOLEAN (an object key re-published on every live
	// frame, R1).
	assert.ok(
		HAS_SESSION.test(content),
		`${CHAT_CONTENT} no longer derives the published fact as \`Boolean(sessionId)\` - the term the session drawer's mount gate reads`,
	);
	assert.ok(
		ROUTE_PUBLISH.test(content) && ROUTE_PUBLISH_DEPS.test(content),
		`${CHAT_CONTENT} no longer publishes { mounted: true, session } keyed on the boolean.`,
	);
	// Each durable pane's mount condition is its flag ALONE (D2): a pane that
	// cannot act mounts a notice, so `rightSlotPaneDrawable` encodes every one of
	// them as the route's `mounted`.
	for (const [pane, gate] of [
		["canvas", "{isCanvasOpen && ("],
		["run panel", "{isRunPanelOpen && ("],
		["browser", "{isBrowserPaneOpen && ("],
		["console", "{isConsolePaneOpen && ("],
		["code review", "{isCodeReviewPaneOpen && ("],
	]) {
		assert.ok(
			content.includes(gate),
			`${CHAT_CONTENT}'s ${pane} mount gate is no longer \`${gate}\`. \`rightSlotPaneDrawable\` encodes that condition as the flag plus the route's \`mounted\`; change both together.`,
		);
	}
	assert.ok(
		SESSION_ASKS_GATE.test(content),
		`${CHAT_CONTENT}'s session asks gate is no longer \`isAskDrawerOpen && askDrawerScope === "session" && Boolean(sessionId)\`; \`rightSlotPaneDrawable\` encodes that condition as \`mounted && session\``,
	);
	const layout = withoutComments(read(CHAT_LAYOUT));
	assert.ok(
		FLEET_GATE.test(layout),
		`${CHAT_LAYOUT}'s fleet asks gate moved; \`rightSlotPaneDrawable\` says the fleet scope is drawable on every route because the shell mounts it unconditionally`,
	);
	const drawable = withoutComments(read(UI_STORE)).match(DRAWABLE_BODY);
	assert.ok(
		drawable,
		`${UI_STORE} no longer defines \`rightSlotPaneDrawable\``,
	);
	for (const [name, shape] of [
		["asks: fleet always, session on mounted && session", DRAWABLE_ASK],
		[
			"every other pane draws whenever the chat surface is mounted",
			DRAWABLE_MOUNTED,
		],
	]) {
		assert.ok(
			shape.test(drawable[0]),
			`\`rightSlotPaneDrawable\` no longer encodes "${name}" - the mount gates in ${CHAT_CONTENT} and ${CHAT_LAYOUT} are what it mirrors`,
		);
	}
});

test("the shell's sidebar yield reads the drawable-aware derivation (#868)", () => {
	/*
	 * `resolveSidebarLayout` is the FOURTH reader of the slot (R2): fed the bare
	 * \`isCanvasOpen || isAskDrawerOpen\` it collapsed the docked sidebar at
	 * 1024-1139px for a flag with no pane behind it, and only a window in that
	 * band shows it.
	 */
	const layout = withoutComments(read(CHAT_LAYOUT));
	assert.ok(
		SIDEBAR_YIELD_READ.test(layout) && SIDEBAR_YIELD_ARG.test(layout),
		`${CHAT_LAYOUT} no longer feeds \`resolveSidebarLayout\` from \`resolveRightSlotYieldsSidebar\`. A bare flag collapses the sidebar for a pane the route cannot draw.`,
	);
	assert.ok(
		!SIDEBAR_BARE_FLAGS.test(layout),
		`${CHAT_LAYOUT} restates the canvas/asks disjunction again - the second copy #868 removed`,
	);
});
