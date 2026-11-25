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
 *   2. A true edge-to-edge panel reaches y0 and paints its ground through the
 *      strip. Two utilities in `styles/index.css` state it once: `panel-flush`
 *      (a route root that cancels the shell's ordinary-content pad) and
 *      `panel-top-pad` (a panel column whose first row starts below the strip).
 *   3. Ordinary inset routes get one clearance on `<main>`. Settings and
 *      Agents use the matched full-height variant, where each painted pane
 *      has the marker for the shared clearance outside its scrollport.
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
 * pane rail, every legacy right-slot occupant, the Browser chrome and the standalone Bridge columns. The adopted inset columns are pinned separately below.
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
			'"panel-flush relative flex min-h-0 flex-1 flex-col outline-none!"',
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
		path: "src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		classes: [
			'className="panel-top-pad flex w-72 shrink-0 flex-col bg-surface"',
			// Standalone still pads the reading column; the Shell's frame already
			// consumed that band when Bridge owns the primary route body.
			'!clearanceReserved && "panel-top-pad"',
		],
	},
	{
		/*
		 * The shell's ROUTE-OWNED left column (the Team Bridge sidebar swap): the
		 * host the bridge rail is portaled into on `/team-bridge`. It is the panel
		 * in that mode - the hosted rail carries no pad of its own - so it is the
		 * element that must clear the traffic lights.
		 */
		path: "src/renderer/src/shared/components/common/chat-layout.tsx",
		classes: [
			'className="panel-top-pad flex h-full min-h-0 flex-col overflow-hidden bg-surface"',
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

// Pane grounds and local overflow survive the move. No inset route should
// use the legacy utilities on top of its matched route clearance.
const INSET_COLUMNS = [
	[
		LIBRARY_PAGE,
		[
			'"flex min-h-0 flex-1 overflow-hidden bg-canvas"',
			'"flex h-full w-48 shrink-0 flex-col overflow-hidden bg-surface"',
			'"flex min-w-0 flex-1 flex-col"',
			'"flex h-full shrink-0 bg-surface"',
			'"min-w-0 flex-1 bg-surface"',
			'"hidden h-full shrink-0 items-start justify-center bg-surface p-8 lg:flex"',
		],
	],
	[
		"src/renderer/src/features/settings/components/settings-page.tsx",
		[
			'"flex min-h-0 flex-1 overflow-hidden bg-surface"',
			'<WorkspaceFrame variant="full-height">',
			'"flex min-h-0 min-w-0 flex-1 flex-col"',
			'"min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-4 py-4 pe-14 sm:px-6 sm:pe-14 md:px-8 md:max-[1511px]:pe-14"',
		],
	],
	[
		"src/renderer/src/features/settings/components/settings-sidebar.tsx",
		['"flex h-full w-full flex-col overflow-hidden bg-surface"'],
	],
	[
		"src/renderer/src/features/agents/components/agents-page.tsx",
		[
			'"flex min-h-0 flex-1 overflow-hidden bg-surface text-ink"',
			'"flex w-72 shrink-0 flex-col gap-3 bg-surface px-4 pb-4 max-[999px]:data-[open=true]:hidden"',
			'<WorkspaceFrame variant="full-height">',
			'"flex min-h-0 min-w-0 flex-1 flex-col"',
		],
	],
	[
		"src/renderer/src/features/agents/components/legacy-agents-page.tsx",
		[
			'"flex min-h-0 flex-1 overflow-hidden bg-surface"',
			'<WorkspaceFrame variant="full-height">',
			'"flex h-full min-h-0 min-w-0 flex-1 flex-col overflow-hidden"',
		],
	],
	[
		AGENTS_SIDEBAR,
		['"flex h-full w-full flex-col overflow-hidden bg-surface"'],
	],
];

test("inset split routes keep their grounds and local scroll without a second clearance", () => {
	for (const [path, classes] of INSET_COLUMNS) {
		const source = readSource(path);
		for (const literal of classes) {
			assert.ok(source.includes(literal), `${path} lost ${literal}`);
		}
		// Full-height split sidebars keep page-sidebar + data-workspace-safe-content;
		// content columns sit inside WorkspaceFrame variant="full-height" (which owns
		// canvas-content) and must not duplicate data-glass-region="canvas-content".
		const sidebarPanes = [
			...source.matchAll(
				/data-glass-region="page-sidebar"\s+data-workspace-safe-content=""/g,
			),
		];
		const safeContentCount = [
			...source.matchAll(/data-workspace-safe-content=""/g),
		].length;
		const duplicateCanvasContent = [
			...source.matchAll(/data-glass-region="canvas-content"/g),
		];
		const expectedSidebars =
			path.endsWith("/agents-page.tsx") || path.endsWith("sidebar.tsx") ? 1 : 0;
		// agents-page.tsx has 3: LegacyAgentsPage Suspense fallback, roster aside,
		// and the detail column inside WorkspaceFrame.
		// settings-page.tsx has 4: configError, isLoading, !config early returns,
		// and the main content column inside WorkspaceFrame.
		const expectedSafe =
			path === LIBRARY_PAGE
				? 0
				: path.endsWith("/agents-page.tsx")
					? 3
					: path.endsWith("/settings-page.tsx")
						? 4
						: 1;
		assert.equal(
			sidebarPanes.length,
			expectedSidebars,
			`${path}: full-height sidebar owns page-sidebar + clearance`,
		);
		assert.equal(
			safeContentCount,
			expectedSafe,
			`${path}: each split column, not its scroller, owns clearance`,
		);
		if (path !== LIBRARY_PAGE) {
			assert.equal(
				duplicateCanvasContent.length,
				0,
				`${path}: WorkspaceFrame variant="full-height" owns canvas-content, not an inner wrapper`,
			);
		}
		assert.doesNotMatch(
			source,
			/["' ]panel-(?:top-pad|flush|scroll) /,
			`${path} duplicates shell clearance`,
		);
	}
});

test("legacy flush roots still reach y0 without losing their bottom edge", () => {
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
			path: "src/renderer/src/features/team-bridge/team-bridge-page.tsx",
			literal: 'clearanceReserved ? "[--panel-top-pad:0px]" : "panel-flush"',
		},
		{
			path: BROWSER_SURFACE,
			literal:
				'"panel-flush relative flex min-h-0 flex-1 flex-col outline-none!"',
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
		"src/renderer/src/features/team-bridge/team-bridge-page.tsx",
		BROWSER_SURFACE,
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

test("Chat tabs reuse the lane while the dock gets no second clearance", () => {
	const page = readSource(CHAT_PAGE);
	assert.doesNotMatch(page, /className="panel-flush/);
	const content = readSource(CHAT_CONTENT);
	assert.match(content, /<ChatWorkspace tabs=\{workspaceTabs\}>/);
	assert.doesNotMatch(content, /className="panel-top-pad [^"]*bg-canvas"/);
	const css = readSource("src/renderer/src/styles/index.css");
	assert.match(css, /\[data-workspace-inset\] \{[^}]*--panel-top-pad: 0px;/);
	assert.match(
		css,
		/margin-block-start: calc\(-1 \* var\(--panel-top-pad, 0px\)\);/,
	);
	// This intentionally older story exercises the standalone flush-panel
	// recipe, not the Chat route's native tabs. Keep its own geometry honest.
	const stories = readSource(SHELL_STORIES);
	assert.match(
		stories,
		/ref=\{rowRef\}\s*data-tour-tag="pane-row"\s*className="panel-flush flex min-h-0 w-full flex-1 overflow-hidden"/,
		"the standalone chat shell story's pane row is its flush root",
	);
	assert.match(
		stories,
		/data-tour-tag="chat-column"\s*(?:\/\*[\s\S]*?\*\/\s*)?className="panel-top-pad [^"]*bg-canvas"/,
		"the standalone story's conversation stand-in must pad itself on `canvas`",
	);
});

test("Library rail and dock keep their own ground and the viewer keeps its own scroll", () => {
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
		/data-library-rail=""[\s\S]{0,400}?className="flex h-full[^"]*overflow-hidden bg-surface"/,
		"the Library rail still owns `surface` and clips its own scroller inside the frame",
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
	assert.match(aside, /data-glass-region="pane"[\s\S]*bg-surface/);
	assert.doesNotMatch(
		aside,
		/panel-top-pad/,
		"the frame already cleared chrome",
	);
	assert.doesNotMatch(
		page.slice(
			page.indexOf("<LibraryPreview"),
			page.indexOf("/>", page.indexOf("<LibraryPreview")),
		),
		/panel-top-pad/,
		"the pad must not move into the preview: the shell owns clearance, the viewer owns only its scroll",
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

test("the chat header's title uses a 16px logical start inset", () => {
	/*
	 * The 24px transcript gutter looked too wide beside the whitespace above
	 * the title. The row uses ps-4 instead, so the title and its rename input
	 * share the same 16px start edge without changing the toolbar height.
	 * The effective value counts: an unlayered header rule in index.css once
	 * beat the row utility, leaving only 4px.
	 */
	const HEADER = "src/renderer/src/features/chat/components/chat-header.tsx";
	const TITLE_START = "4";
	const ROW =
		/"@container\/chathdr flex min-h-10 shrink-0 items-center gap-3 ([^"]*)"/;
	const leadingOf = (source) => {
		const row = source.match(ROW);
		assert.ok(row, "the chat header row class list must be findable");
		const pad = row[1].match(/(?:^|\s)ps-(\d+)(?:\s|$)/);
		return pad ? pad[1] : null;
	};
	const header = readSource(HEADER);
	assert.equal(
		leadingOf(header),
		TITLE_START,
		"the header row's logical start padding must be 16px (ps-4)",
	);
	assert.doesNotMatch(
		header,
		/chathdr[^"]*\bpx-/,
		"a symmetric px- would override or hide the start inset",
	);
	assert.doesNotMatch(
		header,
		/data-header-title=""[\s\S]{0,400}?className=\{cn\(\s*"[^"]*\b(?:ps|ms|pl|ml|px|mx)-/,
		"the h2 title must carry no start inset of its own; the row owns it",
	);
	assert.doesNotMatch(
		header,
		/data-header-rename-input=""[\s\S]{0,700}?className=\{cn\(\s*"[^"]*\b(?:ps|ms|pl|ml|px|mx)-/,
		"the rename input must carry no start inset of its own, or editing jumps",
	);

	/*
	 * The stylesheet must not take the start edge back. Any rule whose selector
	 * names the header region must leave start padding (logical, physical left,
	 * or a shorthand) to the row utility, even in the framed workspace.
	 */
	const startPaddingRules = (css) => {
		const found = [];
		for (const [, selector, body] of css
			.replace(/\/\*[\s\S]*?\*\//g, "")
			.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
			if (!/\[data-chat-region="header"\]\s*(?:,|$)/.test(selector.trim()))
				continue;
			const decl = body.match(
				/(?:^|;)\s*(padding-inline-start|padding-left|padding-inline|padding)\s*:\s*([^;]+)/,
			);
			if (decl)
				found.push(`${selector.trim()} { ${decl[1]}: ${decl[2].trim()} }`);
		}
		return found;
	};
	const css = readSource("src/renderer/src/styles/index.css");
	assert.deepEqual(
		startPaddingRules(css),
		[],
		"no stylesheet rule may set the chat header's start padding; the row's ps-4 owns it",
	);
	// Negative control: the round-3 rule that overrode the row with 4px.
	const regressed = css.replace(
		/(\[data-workspace-inset\] > \[data-chat-region="header"\] \{)/,
		"$1\n\tpadding-inline-start: 4px;",
	);
	assert.notEqual(regressed, css, "control mutation applied");
	assert.equal(
		startPaddingRules(regressed).length,
		1,
		"the guard must catch the old 4px start padding",
	);
	// Negative control: the prior row reused the transcript's 24px inset.
	const before = header.replace(ROW, (row) => row.replace("ps-4", "ps-6"));
	assert.notEqual(before, header, "control mutation applied");
	assert.equal(leadingOf(before), "6", "control restores the old 24px inset");
	assert.notEqual(
		leadingOf(before),
		TITLE_START,
		"the guard must reject the old ps-6 row",
	);
});
