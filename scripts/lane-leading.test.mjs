/**
 * The shell's top edge: one transparent lane, panels that own their ground.
 *
 * WHY THIS EXISTS. The operator reported the same seam three times - "for
 * sub-views like the settings page, the sidebar and view doesn't go all the way
 * to the top" (2026-09-26), "Same issue with agents and teams" (2026-09-27),
 * and the Library right-hand dock starting 32px down (2026-10-20). The first
 * two rounds kept the shell's lane as a RESERVED ROW and taught the lane to
 * paint a mirror of each column's ground; the third route opt-in (`flushTop`)
 * lifted a route's columns over that row. The mirror could only ever know the
 * columns it was told about, and the opt-in is what left every other route -
 * and every panel that was not a leading column - 32px down.
 *
 * THE CONTRACT THIS FILE PINS:
 *   1. The lane is ONE absolute, transparent overlay for every route. It
 *      reserves no height and paints no ground. The drag surface and the
 *      `data-slot-edge` geometry handle are all that remain on it.
 *   2. A full-height panel reaches y0 and paints its own ground through the
 *      strip. Two utilities in `styles/index.css` state it once: `panel-flush`
 *      (a route root that cancels the shell's ordinary-content pad) and
 *      `panel-top-pad` (a panel column whose first row starts below the strip).
 *   3. A route's first content row is never under y32 on macOS: ordinary pages
 *      get the shell's single pad on `<main>`; panels pad their own columns.
 *   4. A scroll region clips at the panel's content edge, so its pad must sit
 *      OUTSIDE the scroller, never on it.
 *
 * WHAT A TEXT SWEEP CAN AND CANNOT PROVE. It proves the source shape - one
 * lane, no route opt-in, every migrated panel wearing the shared utility and
 * the ground it paints. It cannot prove pixels; that is the captured frames
 * (`docs/evidence-frames/panel-titlebar-seam/`, 1280x900 at strip 32: dock,
 * rail and page root at y0, every pixel at y8 a panel's own ground) and the
 * `route-tops` scene. The pair is deliberate: this runs on every PR without a
 * window.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const ROOT = process.cwd();
const readSource = (path) => readFileSync(`${ROOT}/${path}`, "utf8");

const AGENTS_SIDEBAR =
	"src/renderer/src/features/agents/components/agents-sidebar.tsx";
const LIBRARY_PAGE =
	"src/renderer/src/features/library/components/library-page.tsx";
const BROWSER_SURFACE =
	"src/renderer/src/features/browser/components/browser-surface.tsx";
const BROWSER_TAB_STRIP =
	"src/renderer/src/features/browser/components/browser-tab-strip.tsx";
const ROUTE_CHROME_WRAPPER =
	/className=\{isRoutePage \? "panel-top-pad bg-sunken" : undefined\}[\s\S]{0,200}?data-glass-region=\{isRoutePage \? "chrome" : undefined\}[\s\S]{0,200}?data-browser-route-chrome=\{isRoutePage \? "" : undefined\}[\s\S]{0,1200}?<div className="relative">/;
const STRIP_CHROME_ROLE = /data-glass-region="chrome"/;
const NESTED_CHROME_TRANSPARENT =
	/html\[data-glass~="pane"\]\s*\[data-browser-route-chrome\]\s*\[data-glass-region="chrome"\]\s*\{\s*background-color: transparent;\s*\}/;
const CHAT_PAGE = "src/renderer/src/features/chat/components/chat-page.tsx";
const CHAT_CONTENT =
	"src/renderer/src/features/chat/components/chat-content.tsx";
const SHELL_STORIES =
	"src/renderer/src/shared/components/navigation/shell.stories.tsx";

/**
 * Every full-height panel that has to paint through the strip, the file it is
 * defined in, and the class list that proves it. The list is the migration the
 * operator asked for, not only the screenshot: the app sidebar, the shell's
 * pane rail, every right-slot occupant, the Library rail/header/dock, the
 * settings rail, both agents rosters, Team Bridge's two columns and the browser
 * route. A panel added later without the utility fails here rather than in a
 * screenshot review.
 */
const PANEL_COLUMNS = [
	{
		path: "src/renderer/src/shared/components/navigation/sidebar-navigation.tsx",
		classes: [
			'className="panel-top-pad group/sidebar flex h-full min-h-0 flex-col items-center bg-surface"',
			'className="panel-top-pad group/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-surface"',
		],
	},
	{
		path: "src/renderer/src/shared/components/common/chat-layout.tsx",
		classes: ['className="panel-top-pad relative h-full shrink-0 bg-surface"'],
	},
	{
		/*
		 * The chat route's conversation column: the route root is `panel-flush`, so
		 * this column's `canvas` ground starts at y0 and its header is pushed below
		 * the strip by its own pad (design round 1, D1).
		 */
		path: CHAT_CONTENT,
		classes: [
			'className="panel-top-pad flex h-full min-h-0 grow flex-col overflow-hidden rounded-none bg-canvas"',
		],
	},
	{
		path: "src/renderer/src/features/chat/components/canvas/index.tsx",
		classes: [
			'className={cn("panel-top-pad flex h-full flex-col bg-elevated")}',
		],
	},
	{
		path: "src/renderer/src/features/chat/components/asks/ask-drawer.tsx",
		classes: [
			'className={cn("panel-top-pad flex h-full flex-col bg-elevated")}',
		],
	},
	{
		path: "src/renderer/src/features/chat/components/run-details/run-panel.tsx",
		classes: [
			'className={cn("panel-top-pad flex h-full flex-col bg-elevated")}',
		],
	},
	{
		path: "src/renderer/src/features/browser/components/browser-pane.tsx",
		classes: [
			'"panel-top-pad flex h-full flex-col bg-elevated @container/bpane"',
		],
	},
	{
		/*
		 * The Browser ROUTE host stays flush and full-height, while its chrome child
		 * owns the pad and material from y0 through the tab track and permanent
		 * address row. The pane host is NOT listed: `browser-pane.tsx` pads its own
		 * column.
		 */
		path: BROWSER_SURFACE,
		classes: [
			'"panel-flush relative flex min-h-0 flex-1 flex-col bg-elevated outline-none!"',
			'className={isRoutePage ? "panel-top-pad bg-sunken" : undefined}',
		],
	},
	{
		path: "src/renderer/src/features/console/components/console-pane.tsx",
		classes: [
			'className={cn("panel-top-pad flex h-full flex-col bg-elevated")}',
			'"panel-top-pad relative flex h-full flex-col bg-elevated @container/consolepane"',
		],
	},
	{
		path: LIBRARY_PAGE,
		classes: [
			'className="panel-top-pad flex h-full w-48 shrink-0 flex-col overflow-hidden bg-surface"',
			'className="panel-top-pad flex min-w-0 flex-1 flex-col"',
			'className="panel-top-pad flex h-full shrink-0 bg-surface"',
			/*
			 * The standalone preview's wrapper owns the `surface` ground, not only the
			 * pad: `LibraryPreview` paints `bg-surface` on its own root, which sits
			 * BELOW this pad, so a groundless wrapper left the root's `canvas` showing
			 * through the strip as a band (design round 1, D2).
			 */
			'className="panel-top-pad min-w-0 flex-1 bg-surface"',
			'className="panel-top-pad hidden h-full shrink-0 items-start justify-center bg-surface p-8 lg:flex"',
		],
	},
	{
		path: "src/renderer/src/features/settings/components/settings-sidebar.tsx",
		classes: [
			'className="panel-top-pad flex h-full w-full flex-col overflow-hidden bg-surface"',
		],
	},
	{
		path: "src/renderer/src/features/agents/components/agents-page.tsx",
		classes: [
			'className="panel-top-pad flex w-72 shrink-0 flex-col gap-3 bg-surface px-4 pb-4 max-[999px]:data-[open=true]:hidden"',
			'className="panel-top-pad flex min-w-0 flex-1 flex-col"',
		],
	},
	{
		path: AGENTS_SIDEBAR,
		classes: [
			'className="panel-top-pad flex h-full w-full flex-col overflow-hidden bg-surface"',
		],
	},
	{
		path: "src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		classes: [
			'className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"',
			// The thread column is built through `cn()` since main's narrow takeover
			// (`@max-[1024px]/bridge:invisible`) landed, so the pin is the quoted
			// class string rather than a whole `className="…"` attribute.
			'"panel-top-pad flex min-w-0 flex-1 flex-col bg-surface"',
		],
	},
];

test("every full-height panel owns the strip and pads its own first row", () => {
	for (const { path, classes } of PANEL_COLUMNS) {
		const source = readSource(path);
		for (const literal of classes) {
			assert.ok(
				source.includes(literal),
				`${path} lost a migrated panel: expected ${literal}. A panel that does not wear panel-top-pad starts its first row under the traffic lights, and one that paints from y32 leaves the wrong ground in the strip - the seam the operator reported three times`,
			);
		}
	}
});

test("the panel root utility is the only way a route reaches y0", () => {
	/*
	 * The roots are asserted separately from the columns because they do a
	 * different job: they cancel the shell's `<main>` pad so the panel's own
	 * ground can paint from y0, and their columns pad themselves. A root that
	 * keeps `h-full` without `flex-1` loses the 32px at the BOTTOM (the negative
	 * margin is compensated by the grow), which is a bottom seam nobody has
	 * photographed yet.
	 */
	const roots = [
		{
			path: LIBRARY_PAGE,
			literal:
				'className="panel-flush flex min-h-0 flex-1 overflow-hidden bg-canvas"',
		},
		{
			path: "src/renderer/src/features/settings/components/settings-page.tsx",
			literal:
				'className="panel-flush flex min-h-0 flex-1 overflow-hidden bg-canvas"',
		},
		{
			path: "src/renderer/src/features/agents/components/agents-page.tsx",
			literal: 'className="panel-flush flex min-h-0 flex-1 bg-canvas text-ink"',
		},
		{
			path: "src/renderer/src/features/agents/components/legacy-agents-page.tsx",
			literal: 'className="panel-flush flex min-h-0 flex-1 overflow-hidden"',
		},
		{
			path: "src/renderer/src/features/team-bridge/team-bridge-page.tsx",
			// `@container/bridge relative` is main's: the container query is what the
			// narrow takeover keys on, and `relative` anchors it WITHOUT offsetting
			// the panel. It rides on this PR's root contract (`panel-flush` cancels
			// the shell pad, `flex-1` keeps the bottom strip), so the pin is the
			// merged class string - re-read from the markup, never restored.
			literal:
				'className="panel-flush @container/bridge relative flex min-h-0 flex-1 w-full overflow-hidden bg-canvas"',
		},
		{
			path: BROWSER_SURFACE,
			literal:
				'"panel-flush relative flex min-h-0 flex-1 flex-col bg-elevated outline-none!"',
		},
		{
			path: CHAT_PAGE,
			literal: 'className="panel-flush flex min-h-0 flex-1 flex-col"',
		},
	];
	for (const { path, literal } of roots) {
		assert.ok(
			readSource(path).includes(literal),
			`${path} lost its flush root (${literal}): without it the page starts at the shell's ordinary-content pad and its own ground cannot reach y0`,
		);
	}
});

test("the Browser route paints its lane, tab track and address row with one chrome owner", () => {
	const surface = readSource(BROWSER_SURFACE);
	const strip = readSource(BROWSER_TAB_STRIP);
	const styles = readSource("src/renderer/src/styles/index.css");
	const wrapperAt = surface.search(ROUTE_CHROME_WRAPPER);
	const stripAt = surface.indexOf("<BrowserTabStrip", wrapperAt);
	const rowAt = surface.indexOf("<BrowserUrlBar", stripAt);
	const findAt = surface.indexOf("<BrowserFindRow", rowAt);
	assert.ok(
		wrapperAt >= 0 && stripAt > wrapperAt && rowAt > stripAt && findAt > rowAt,
		"the route-only wrapper must pad and paint through y0 around both the strip and S5's permanent address row, before the find row and page",
	);
	assert.match(
		strip,
		STRIP_CHROME_ROLE,
		"the strip keeps its established chrome role and active-tab stacking contract",
	);
	assert.match(
		styles,
		NESTED_CHROME_TRANSPARENT,
		"nested route chrome must be transparent so only the lane-and-track wrapper paints chrome alpha",
	);
});

test("no flush root leaves its content under the lane", () => {
	/*
	 * `panel-flush` moves a root's box to y0 and pads NOTHING (index.css says so).
	 * So every file that wears it must also wear a pad - `panel-top-pad` on a
	 * column or `panel-scroll` on a scroller - or its first row sits in the drag
	 * lane under the traffic lights. Round 1's F1 was exactly this: the Browser
	 * route root went flush in the merge with main and nothing inside it padded,
	 * while the route audit claimed an "own panel pad" that no frame rendered.
	 * A per-file pairing is the floor, not the whole proof; the per-panel class
	 * lists above say WHICH box pads.
	 */
	const flushFiles = [
		LIBRARY_PAGE,
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"src/renderer/src/features/agents/components/agents-page.tsx",
		"src/renderer/src/features/agents/components/legacy-agents-page.tsx",
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		BROWSER_SURFACE,
		CHAT_PAGE,
	];
	for (const path of flushFiles) {
		const source = readSource(path);
		assert.match(
			source,
			/"panel-flush[ "]/,
			`${path} is no longer a flush root`,
		);
		assert.match(
			source,
			/["\s]panel-(?:top-pad|scroll)[\s"]/,
			`${path} has a panel-flush root but nothing in it pads: its first row renders at y0, under the drag lane and the traffic lights`,
		);
	}
});

test("the chat dock pads once: the route is flush, so each column's own pad is the only one", () => {
	/*
	 * Design round 1, D1. The right-slot occupants (canvas, asks, run panel,
	 * browser and console panes) each wear `panel-top-pad`, and so does the rail
	 * host. That is only correct if the row they sit in starts at y0. On
	 * 842d2f513f the chat route was an ORDINARY page: `<main>`'s shell pad moved
	 * the whole row to y32 and each occupant then padded a second time, so the
	 * dock's ground began 32px down (a band in the strip) and its first row sat
	 * at ~y66. The fix is the contract's own: the route root is `panel-flush`,
	 * and the conversation column pads itself like every other column.
	 */
	const page = readSource(CHAT_PAGE);
	const rootAt = page.indexOf("export function ChatPage()");
	assert.notEqual(rootAt, -1, "ChatPage must stay the route component");
	// The FIRST element `ChatPage` returns, past any explanatory comment.
	const returned = page.slice(page.indexOf("return (", rootAt));
	const root = returned.slice(returned.indexOf("<div"));
	assert.match(
		root,
		/^<div className="panel-flush flex min-h-0 flex-1 flex-col">/,
		"the chat route's root must be `panel-flush` (and `flex-1`, so the bottom 32px are not lost): without it `<main>`'s pad moves the dock down and the occupants' own pad doubles it",
	);
	const content = readSource(CHAT_CONTENT);
	const column = content.slice(
		content.indexOf("ref={chatContainerRef}"),
		content.indexOf("<ChatHeader"),
	);
	assert.match(
		column,
		/className="panel-top-pad [^"]*bg-canvas"/,
		"the conversation column must pad itself on its own `canvas` ground: under a flush root nothing else keeps the chat header out of the lane",
	);
	/*
	 * The evidence scene must be built the way the route is, or its frames
	 * certify a layout the app does not draw: `ChatShellFrame` mirrors
	 * `app.tsx`'s padded `<main>`, so its route row must be the flush root and
	 * its conversation stand-in the padded column.
	 */
	const stories = readSource(SHELL_STORIES);
	assert.match(
		stories,
		/ref=\{rowRef\}\s*data-tour-tag="pane-row"\s*className="panel-flush flex min-h-0 w-full flex-1 overflow-hidden"/,
		"the chat shell story's pane row must be the route's flush root, as `ChatPage` is",
	);
	assert.match(
		stories,
		/data-tour-tag="chat-column"\s*(?:\/\*[\s\S]*?\*\/\s*)?className="panel-top-pad [^"]*bg-canvas"/,
		"the chat shell story's conversation stand-in must pad itself on `canvas`, as `chat-content` does",
	);
});

test("the Library dock and rail are the measured panels, and the dock scrolls inside its pad", () => {
	const page = readSource(LIBRARY_PAGE);
	/*
	 * THE ONE SCROLLER THAT COULD REINTRODUCE THE SEAM: the dock is a fixed
	 * header plus a scrolling viewer. Its pad must sit on the ASIDE (outside the
	 * scroller). A `panel-top-pad` on the viewer's own class list would clip at
	 * its padding BOX, so scrolled text could paint through the strip - the
	 * scroll pair the operator asked to be photographed.
	 */
	assert.match(
		page,
		/data-library-rail=""[\s\S]{0,400}?className="panel-top-pad[^"]*bg-surface"/,
		"the Library rail must be a panel: `surface` from y0, rows below the strip",
	);
	assert.match(
		page,
		/data-library-page=""/,
		"the Library page root must stay marked for the geometry rigs",
	);
	const asideStart = page.indexOf('aria-label={t("ui.library.page.preview")}');
	assert.notEqual(asideStart, -1);
	const aside = page.slice(
		page.lastIndexOf("<aside", asideStart),
		page.indexOf(">", asideStart),
	);
	assert.match(
		aside,
		/panel-top-pad/,
		"the dock aside must carry the pad itself, so its scroller begins at the panel's content edge",
	);
	assert.doesNotMatch(
		page.slice(
			page.indexOf("<LibraryPreview"),
			page.indexOf("/>", page.indexOf("<LibraryPreview")),
		),
		/panel-top-pad/,
		"the pad must not move into the preview: the panel owns the strip, the viewer owns only its scroll",
	);
});

test("the lane is one transparent overlay, and no route opts out", () => {
	const layout = readSource(
		"src/renderer/src/shared/components/common/chat-layout.tsx",
	);
	assert.equal(
		layout.split('data-titlebar-lane=""').length - 1,
		1,
		"the shell must render exactly one lane",
	);
	assert.match(
		layout,
		/className="absolute inset-x-0 top-0 z-30 h-\[var\(--chrome-strip-h\)\]"/,
		"the lane must be an absolute overlay at y0: a reserved row is the band that made every panel start 32px down",
	);
	assert.doesNotMatch(
		layout,
		/linear-gradient|data-lane-leading-column|useLaneLeadingColumn|useLaneLeadingEdge/,
		"the lane must paint no ground and hold no leading-column hand-over: both only existed to mirror columns that now paint themselves",
	);
	assert.doesNotMatch(
		layout,
		/flushTop/,
		"the per-route opt-in must stay gone",
	);
	assert.doesNotMatch(
		readSource("src/renderer/src/app.tsx"),
		/flushTop/,
		"the app must not grant a route the old lane exception",
	);
	assert.match(
		layout,
		/"--panel-top-pad": "var\(--chrome-strip-h\)"/,
		"the content column must publish the strip's height to every route, unconditionally",
	);
});

test("the two panel utilities are defined once, in the stylesheet", () => {
	const css = readSource("src/renderer/src/styles/index.css");
	assert.match(
		css,
		/@utility panel-flush \{\s*margin-top: calc\(-1 \* var\(--panel-top-pad, 0px\)\);\s*\}/,
		"panel-flush must cancel exactly the shell's pad",
	);
	assert.match(
		css,
		/@utility panel-top-pad \{\s*padding-top: var\(--panel-top-pad, var\(--chrome-strip-h, 0px\)\);\s*\}/,
		"panel-top-pad must be the one pad, with the document-level strip as its outside-the-shell fallback (the sidebar and the sheet)",
	);
	assert.match(
		css,
		/@utility panel-scroll \{\s*margin-top: var\(--panel-top-pad, var\(--chrome-strip-h, 0px\)\);\s*height: calc\(100% - var\(--panel-top-pad, var\(--chrome-strip-h, 0px\)\)\);\s*\}/,
		"panel-scroll must move the whole scroll box below the strip (a padding on the scroller would clip at the padding box, letting scrolled text paint through the strip)",
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
	LIBRARY_PAGE,
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
	 * doesn't go all the way up ... either make it extend all the way up or
	 * remove the right border". It is the removal, on every route column: the
	 * boundary those rules drew is a tone step now, and a rule over a tone step
	 * is the redundant second mark this fleet removes.
	 *
	 * Under the panel contract a rule COULD now reach y0, because the columns do
	 * - so the reason is no longer "it can only begin at the lane's lower edge",
	 * it is the design rule itself. If a rule is ever wanted here, this test is
	 * where that conversation starts.
	 */
	for (const path of PANEL_SURFACES) {
		assert.doesNotMatch(
			readSource(path),
			/border-r border-hairline/,
			`${path} draws a right rule again: the boundary beside it is a tone step, and the operator asked for the rule to go`,
		);
	}
	assert.doesNotMatch(
		readSource(AGENTS_SIDEBAR),
		/(border-hairline border-r|border-r border-hairline)/,
		`${AGENTS_SIDEBAR} draws the roster's right rule again: the roster's \`surface\` against the \`canvas\` content is a tone step`,
	);
});
