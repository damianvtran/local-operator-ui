import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

const { outputFiles } = await build({
	stdin: {
		contents: `
			export * from "./workspace-tabs-model";
			export * from "./workspace-tab-cleanup";
			export { translate } from "../../../../i18n/messages";
		`,
		resolveDir: new URL("../src/renderer/src/features/chat/", import.meta.url)
			.pathname,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const {
	WORKSPACE_INACTIVE_MINUTES,
	workspaceRestRevisions,
	workspaceRowCanRest,
	displayedWorkspaceTabs,
	makeWorkspaceTab,
	moveWorkspaceTab,
	resolveWorkspaceTabTitle,
	sanitizeSavedWorkspaceTabs,
	saveWorkspaceTabs,
	saveWorkspaceTabsWithTitles,
	savedWorkspaceTabsDiffer,
	syncWorkspaceTabs,
	translate,
	workspaceBulkCloseKeys,
	workspaceHeaderTitle,
	workspaceNeighbor,
	workspaceSessionPathMatches,
	workspaceTabsAwaitingTitle,
	snapshotConversationTitle,
	workspaceTarget,
} = await import(
	`data:text/javascript;base64,${Buffer.from(outputFiles[0].contents).toString("base64")}`
);

const targetA = { kind: "session", id: "000000aaaaaa" };
const targetB = { kind: "session", id: "000000bbbbbb" };
const targetC = { kind: "session", id: "000000cccccc" };
const draft = { kind: "draft", id: "draft:synthetic" };
const sessionA = makeWorkspaceTab(targetA);
const sessionB = makeWorkspaceTab(targetB);
const sessionC = makeWorkspaceTab(targetC);
const draftTab = makeWorkspaceTab(draft);

const source = (name) =>
	readFileSync(new URL(`../src/renderer/src/${name}`, import.meta.url), "utf8");
const modelPath = "features/chat/components/";
const routePath = /^\/chat\//;
const TAB_STRIP =
	/\[data-workspace-tabs\]\s*\{[^}]*align-items: center;\s*min-height: 36px;/;
const TAB_PAINT_HOST =
	/\[data-workspace-tab\]\s*\{[^}]*position: relative;\s*isolation: isolate;/;
const TAB_PAINT =
	/\[data-workspace-tab\]::before\s*\{[^}]*z-index: -1;\s*inset-block: 2px;[^}]*background: var\(--workspace-tab-fill\);\s*pointer-events: none;/;
const ACTIVE_TAB_PAINT =
	/\[data-workspace-tab\]\[data-active\]\s*\{\s*--workspace-tab-fill:/;
const DRAG_SPACER = /\[data-workspace-tab-spacer\]\s*\{\s*align-self: stretch;/;
const NO_DRAG_TAB = /data-workspace-tab=""[^>]*data-titlebar-no-drag=""/;
const TAB_TARGET = /className="flex h-8 [^"]+"\s*aria-current=/;
const CLOSE_TARGET = /data-workspace-close=""\s*className="[^"\n]*\bsize-6\b/;
const MORE_TARGET =
	/data-workspace-more=""\s*data-titlebar-no-drag=""\s*className="[^"\n]*\bsize-7\b/;
const TAB_FOCUS =
	/\[data-workspace-tabs\] button:focus-visible\s*\{\s*outline: 2px solid var\(--color-accent\);\s*outline-offset: -2px;/;
// End padding only: the row owns the start edge, and an unlayered rule here
// would override it. lane-leading pins that.
const HEADER_PADDING =
	/\[data-workspace-inset\] > \[data-chat-region="header"\] \{[^}]*padding-inline-end: 12px;\s*\}/;

test("reopening canonical ids focuses the existing target without adding a duplicate", () => {
	const opened = syncWorkspaceTabs([], targetA, {});
	assert.strictEqual(syncWorkspaceTabs(opened, { ...targetA }, {}), opened);
	assert.deepEqual(workspaceTarget(null, targetA.id, {}), targetA);
	assert.deepEqual(
		workspaceTarget(draft.id, targetB.id, { [draft.id]: {} }),
		draft,
	);
	assert.equal(workspaceTarget(draft.id, targetB.id, {}), undefined);
	assert.equal(
		workspaceSessionPathMatches(`/chat/${targetA.id}`, targetA.id),
		true,
	);
	for (const path of [
		"/chat",
		`/chat/${targetA.id}/extra`,
		`/settings/${targetA.id}`,
	]) {
		assert.equal(workspaceSessionPathMatches(path, targetA.id), false);
	}
});

test("a background admission preserves the exact draft tab position and either pin", () => {
	const staged = [sessionB, draftTab, { ...sessionA, pinned: true }, sessionC];
	const result = syncWorkspaceTabs(
		staged,
		targetC,
		{},
		{ [draft.id]: { sessionId: targetA.id } },
	);
	assert.deepEqual(result, [
		sessionB,
		{ ...draftTab, target: targetA, pinned: true },
		sessionC,
	]);
	assert.deepEqual(
		workspaceTarget(draft.id, null, { [draft.id]: { sessionId: targetA.id } }),
		targetA,
	);
	assert.deepEqual(syncWorkspaceTabs(staged, targetC, {}), [
		sessionB,
		staged[2],
		sessionC,
	]);
});

test("re-launching the same draft target after admission creates a distinct tab", () => {
	const admitted = syncWorkspaceTabs(
		[sessionB, { ...draftTab, pinned: true }, sessionC],
		targetA,
		{ [draft.id]: { sessionId: targetA.id } },
	);
	const relaunched = syncWorkspaceTabs(admitted, draft, { [draft.id]: {} });
	assert.equal(new Set(relaunched.map(({ key }) => key)).size, 4);
	assert.deepEqual(
		relaunched.map(({ target }) => target),
		[targetB, targetA, targetC, draft],
	);
	assert.equal(relaunched[1].pinned, true);
	assert.equal(relaunched[3].pinned, false);
});

test("close fallback follows visible order and reordering cannot cross lanes", () => {
	const tabs = [sessionA, { ...sessionB, pinned: true }, sessionC];
	assert.deepEqual(
		displayedWorkspaceTabs(tabs).map((tab) => tab.key),
		[sessionB.key, sessionA.key, sessionC.key],
	);
	assert.equal(workspaceNeighbor(tabs, sessionA.key), sessionC);
	assert.equal(workspaceNeighbor(tabs, sessionB.key), sessionA);
	assert.strictEqual(moveWorkspaceTab(tabs, sessionA.key, sessionB.key), tabs);
	assert.strictEqual(moveWorkspaceTab(tabs, "external", sessionC.key), tabs);
	assert.deepEqual(
		displayedWorkspaceTabs(
			moveWorkspaceTab(tabs, sessionA.key, sessionC.key),
		).map((tab) => tab.key),
		[sessionB.key, sessionC.key, sessionA.key],
	);
});

test("saved preferences consist of known session identities, order and boolean pins only", () => {
	const saved = saveWorkspaceTabs([
		sessionB,
		{ ...draftTab, pinned: true },
		sessionA,
	]);
	assert.deepEqual(saved, [
		{ id: targetB.id, pinned: false },
		{ id: targetA.id, pinned: false },
	]);
	assert.deepEqual(
		sanitizeSavedWorkspaceTabs([
			...saved,
			{ ...saved[0], pinned: true },
			{ id: draft.id, pinned: true },
			{ id: targetC.id, pinned: "true" },
			{ id: targetC.id, pinned: true, message: "not copied" },
		]),
		[...saved, { id: targetC.id, pinned: true }],
	);
});

test("catalogue facts can veto but never certify workspace rest", () => {
	const resting = { id: targetA.id, locality: "local", jobs_running: null };
	assert.equal(workspaceRowCanRest(resting), true);
	for (const patch of [
		{ locality: undefined },
		{ locality: "remote" },
		{ link_down: true },
		{ archived: true },
		{ pinned: true },
		{ active: true },
		{ background_work: true },
		{ attention: { unseen: true } },
		{ waiting_on: 1 },
		{ jobs_running: 1 },
		{ pending: "approve" },
		{ asks_open: 1 },
		{ status: { code: "answer" } },
	])
		assert.equal(
			workspaceRowCanRest({ ...resting, ...patch }),
			false,
			JSON.stringify(patch),
		);

	const epoch = "known feed";
	const revision = "opaque-String:+-123";
	const workspace_rest = { version: 1, epoch, revision };
	const local = { ...resting, workspace_rest };
	const read = (...sessions) =>
		workspaceRestRevisions(
			{ status: 200, body: { result: { sessions } } },
			new Set([targetA.id]),
			epoch,
		);
	assert.equal(read(resting).get(targetA.id), undefined);
	assert.equal(
		read(local, { ...local, id: targetB.id }).get(targetA.id),
		revision,
	);
	assert.equal(read(local, local).get(targetA.id), undefined);
	assert.equal(
		read({ ...local, locality: "remote" }).get(targetA.id),
		undefined,
	);
	assert.equal(
		read({
			...local,
			workspace_rest: { ...workspace_rest, revision: "  " },
		}).get(targetA.id),
		undefined,
	);
});

// This label sits next to manual Close tab in a narrow menu. Keep the tab
// terminology consistent and the timeout's number/unit together where the locale calls for it.
for (const [locale, check] of Object.entries({
	fr: (label) => label.endsWith(`${WORKSPACE_INACTIVE_MINUTES}\u202fmin`),
	ur: (label, closeTab) =>
		label.includes(
			`${WORKSPACE_INACTIVE_MINUTES} منٹ تک غیر فعال رہنے کے بعد`,
		) && label.endsWith(closeTab),
	vi: (label, closeTab) =>
		label.startsWith(`${closeTab} sau ${WORKSPACE_INACTIVE_MINUTES} phút`),
	"zh-CN": (label) => label.startsWith(`闲置${WORKSPACE_INACTIVE_MINUTES}分钟`),
})) {
	test(`cleanup menu label follows ${locale} terminology and number spacing`, () => {
		const label = translate(
			"ui.chat.header.auto_close_inactive_tabs",
			{
				minutes: WORKSPACE_INACTIVE_MINUTES,
			},
			locale,
		);
		const closeTab = translate(
			"ui.browser.browser_tab_strip.close_tab",
			{},
			locale,
		);
		assert.ok(check(label, closeTab), label);
	});
}

test("the 36px fallback strip leaves settled air around the larger tab target", () => {
	const css = source("styles/index.css");
	const strip = source(`${modelPath}workspace-tabs.tsx`);
	// The centered 32px target leaves at least 2px of lane on each edge; another
	// 2px comes only out of its paint, not the scrollport or pointer target.
	assert.match(css, TAB_STRIP);
	assert.match(css, TAB_PAINT_HOST);
	assert.match(css, TAB_PAINT);
	assert.match(css, ACTIVE_TAB_PAINT);
	assert.match(css, DRAG_SPACER);
	assert.match(strip, NO_DRAG_TAB);
	assert.match(strip, TAB_TARGET);
	assert.match(strip, CLOSE_TARGET);
	assert.match(strip, MORE_TARGET);
	assert.match(css, TAB_FOCUS);
});

/*
 * THE ACTIVE-TAB TREATMENT (operator addition B on PR #2091): inactive tabs paint
 * nothing at rest and row-hover under the pointer; the active tab alone has the
 * opaque row-selected ground, full ink and weight 500 - BRIGHTENING ONLY. The
 * 2px accent rail along the active tab's bottom edge was removed at the
 * operator's request (2026-11-25: "remove that and we'll just leave the
 * brightening but no rail, that looks super dated"), so any pseudo-element
 * paint on the active tab beyond the shared `::before` ground fails here.
 * With the rail gone the selected ground mixes 4% ink into row-selected (design
 * D1 on PR #2109) so it stays distinct from a hovered neighbour's row-hover;
 * a bare row-selected fill fails.
 */
function assertActiveTabTreatment(css) {
	assert.match(
		css,
		/\[data-workspace-tab\] \{\s*--workspace-tab-fill: transparent;/,
	);
	assert.match(
		css,
		/\[data-workspace-tab\]:not\(\[data-active\]\):hover \{\s*--workspace-tab-fill: var\(--color-row-hover\);/,
	);
	assert.match(
		css,
		/\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: color-mix\(\s*in srgb,\s*var\(--color-row-selected\) 96%,\s*var\(--color-ink\)\s*\);\s*color: var\(--color-ink\);/,
	);
	assert.match(
		css,
		/\[data-workspace-tab\]\[data-active\] > button\[aria-current\] \{\s*font-weight: 500;/,
	);
	assert.doesNotMatch(css, /\[data-workspace-tab\][^{,]*::after/);
	assert.doesNotMatch(
		css.match(/\[data-workspace-tab\]\[data-active\] \{[^}]*\}/)[0],
		/border|box-shadow|accent/,
	);
	// No outline/pill: the tab block itself never draws a border.
	const tab = css.match(/\[data-workspace-tab\] \{[^}]*\}/)[0];
	assert.doesNotMatch(tab, /border(-width)?:/);
}

test("the active tab is the only filled tab, in full ink, with no indicator rail", () => {
	assertActiveTabTreatment(source("styles/index.css"));
});

test("negative control: the old faint tint on every tab fails the treatment check", () => {
	const css = source("styles/index.css");
	const faint = css
		.replace(
			/(\[data-workspace-tab\] \{\s*--workspace-tab-fill: )transparent;/,
			"$1color-mix(in oklab, var(--color-canvas) 48%, var(--color-surface));",
		)
		.replace(
			/(\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: )color-mix\([^;]*\);/,
			"$1color-mix(in oklab, var(--color-row-selected) 44%, var(--color-surface));",
		);
	assert.notEqual(faint, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(faint));
	// Re-adding the retired bottom rail must fail the check, in either spelling.
	const rail = css.replace(
		/(\[data-workspace-tab\]\[data-active\] > button\[aria-current\] \{)/,
		"[data-workspace-tab][data-active]::after {\n\theight: 2px;\n\tbackground: var(--color-accent);\n}\n$1",
	);
	assert.notEqual(rail, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(rail));
	// Reverting to the bare row-selected ground (pre-D1) must fail: with no
	// rail, it sits ~1.04:1 from a hovered neighbour.
	const bare = css.replace(
		/(\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: )color-mix\([^;]*\);/,
		"$1var(--color-row-selected);",
	);
	assert.notEqual(bare, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(bare));
	const shadowRail = css.replace(
		/(\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: color-mix\([^;]*\);)/,
		"$1\n\tbox-shadow: inset 0 -2px var(--color-accent);",
	);
	assert.notEqual(shadowRail, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(shadowRail));
});

test("header leading padding follows direction without moving its trailing actions", () => {
	assert.match(source("styles/index.css"), HEADER_PADDING);
});

test("titlebar activation and actions keep one navigation owner and never trust a drop payload", () => {
	const strip = source(`${modelPath}workspace-tabs.tsx`);
	const hook = source(`${modelPath}use-workspace-tabs.ts`);
	const page = source(`${modelPath}chat-page.tsx`);
	assert.equal((page.match(/<SessionPanel\b/g) ?? []).length, 1);
	assert.ok(strip.includes("button.focus({ preventScroll: true })"));
	assert.ok(strip.includes('data-titlebar-no-drag=""'));
	assert.ok(strip.includes('data-titlebar-drag=""'));
	assert.ok(
		strip.includes('data-workspace-pinned=""') &&
			strip.includes('data-workspace-regular=""'),
	);
	assert.ok(strip.includes('data-workspace-tab-menu=""'));
	assert.ok(strip.includes('dataTransfer.setData(WORKSPACE_DRAG, "")'));
	assert.ok(!strip.includes("dataTransfer.getData"));
	assert.ok(hook.includes("store.openDraft(target.id)"));
	assert.ok(
		hook.includes(
			'return openConversation(navigate, target.id, "open", ticket)',
		),
	);
	assert.ok(hook.includes("receipt?.ticket !== handoff.ticket"));
	assert.ok(hook.includes("receipt.confirmed"));
	assert.ok(hook.includes("state.forgotten[handoff.to] !== undefined"));
	assert.ok(!routePath.test(hook));
});

/*
 * Bulk closes from a tab's menu (operator, 2026-11-24: "close other tabs, close
 * tabs to the left, close tabs to the right, etc"). Fixture, displayed order:
 * [P1 P2 | A B C D] - two pins, then four regular tabs - with B as the anchor.
 */
const bulkFixture = () => {
	const make = (id, pinned = false) => ({
		...makeWorkspaceTab({ kind: "session", id }),
		pinned,
	});
	const [p1, p2, a, b, c, d] = [
		make("00000000p001", true),
		make("00000000p002", true),
		make("00000000000a"),
		make("00000000000b"),
		make("00000000000c"),
		make("00000000000d"),
	];
	// Stored order interleaves pins; the rule must follow DISPLAYED order.
	return { tabs: [a, p1, b, c, p2, d], p1, p2, a, b, c, d };
};
const keysOf = (...tabs) => tabs.map((tab) => tab.key);

test("bulk closes follow displayed order, spare pins, and mirror left/right in RTL", () => {
	const { tabs, p1, p2, a, b, c, d } = bulkFixture();
	const close = (key, action, rtl = false) =>
		workspaceBulkCloseKeys(tabs, key, action, rtl);
	assert.deepEqual(close(b.key, "others"), keysOf(a, c, d));
	assert.deepEqual(close(b.key, "left"), keysOf(a));
	assert.deepEqual(close(b.key, "right"), keysOf(c, d));
	assert.deepEqual(close(b.key, "all"), keysOf(a, b, c, d));
	// RTL: the strip draws displayed order right-to-left, so the visual left
	// of B is the logical end and its visual right is the logical start.
	assert.deepEqual(close(b.key, "left", true), keysOf(c, d));
	assert.deepEqual(close(b.key, "right", true), keysOf(a));
	assert.deepEqual(close(b.key, "others", true), keysOf(a, c, d));
	// "others"/"all" from a pinned tab still never close a pin.
	assert.deepEqual(close(p2.key, "others"), keysOf(a, b, c, d));
	assert.deepEqual(close(p1.key, "all"), keysOf(a, b, c, d));
	// Strip-level "Close all tabs" has no anchor tab.
	assert.deepEqual(close("", "all"), keysOf(a, b, c, d));
});

test("a bulk close that would close nothing returns no keys, so its item disables", () => {
	const { tabs, p1, a, d } = bulkFixture();
	const close = (key, action, rtl = false) =>
		workspaceBulkCloseKeys(tabs, key, action, rtl);
	// Left of the first pin is nothing; left of the first regular tab is only pins.
	assert.deepEqual(close(p1.key, "left"), []);
	assert.deepEqual(close(a.key, "left"), []);
	assert.deepEqual(close(d.key, "right"), []);
	assert.deepEqual(close(d.key, "left", true), []);
	const onlyPins = tabs.filter((tab) => tab.pinned);
	for (const action of ["others", "left", "right", "all"])
		assert.deepEqual(
			workspaceBulkCloseKeys(onlyPins, onlyPins[0].key, action, false),
			[],
		);
	// An unknown anchor closes nothing rather than guessing.
	assert.deepEqual(close("missing", "others"), []);
	assert.deepEqual(close("missing", "right"), []);
});

test("negative control: an order-blind, pin-blind rule fails the same expectations", () => {
	const { tabs, b } = bulkFixture();
	// The plausible wrong implementation: stored order, pins included, no RTL.
	const naive = (key, action) => {
		const at = tabs.findIndex((tab) => tab.key === key);
		return tabs
			.filter((_, i) => (action === "left" ? i < at : i > at))
			.map((tab) => tab.key);
	};
	assert.notDeepEqual(
		naive(b.key, "left"),
		workspaceBulkCloseKeys(tabs, b.key, "left", false),
	);
	assert.notDeepEqual(
		naive(b.key, "right"),
		workspaceBulkCloseKeys(tabs, b.key, "right", false),
	);
	assert.notDeepEqual(
		workspaceBulkCloseKeys(tabs, b.key, "left", false),
		workspaceBulkCloseKeys(tabs, b.key, "left", true),
	);
});

const TAB_CONTEXT_MENU =
	/<ContextMenu key=\{key\}(?: onOpenChange=\{menuVisibilityChanged\})?>\s*<ContextMenuTrigger asChild>\s*\{renderTabRow\(/;
const KEYBOARD_OPENER_KEYS =
	/event\.key !== "ContextMenu" && !\(event\.shiftKey && event\.key === "F10"\)/;
const KEYBOARD_OPENER_CALL = /if \(openTabMenuFromKeyboard\(event\)\) return;/;
const STRIP_CLOSE_ALL =
	/data-workspace-close-all=""\s*disabled=\{closeAllKeys\.length === 0\}\s*onSelect=\{\(\) => onCloseMany\(closeAllKeys\)\}/;
/*
 * The ellipsis is MOUNTED on the active tab only (design D2, review R2): an
 * opacity-hidden trigger on every tab kept a 24px hole and a Tab stop in each.
 */
const ACTIVE_DROPDOWN =
	/\{active && \(\s*<DropdownMenu(?: onOpenChange=\{menuVisibilityChanged\})?>/;
const TAB_MORE_ACTIVE_ONLY = new RegExp(
	`${ACTIVE_DROPDOWN.source}\\s*<DropdownMenuTrigger asChild>\\s*<button\\s+type="button"\\s+data-workspace-tab-more=""`,
);
/* Both openers group Pin | Move left, Move right | closes with the menu separator (D3). */
const CONTEXT_SEPARATED =
	/startsGroup\(entries, index\) && <ContextMenuSeparator \/>\}\s*<ContextMenuItem/;
const DROPDOWN_SEPARATED =
	/startsGroup\(entries, index\) && <DropdownMenuSeparator \/>\}\s*<DropdownMenuItem/;
/** The per-tab menu wiring, as a source guard over workspace-tabs.tsx. */
const assertTabMenuWiring = (strip, hook, page) => {
	// Right-click (and the keyboard openers) on every tab, pinned or not: the
	// ContextMenu wraps the one row renderer both lanes use.
	assert.match(strip, TAB_CONTEXT_MENU);
	assert.match(strip, KEYBOARD_OPENER_KEYS);
	assert.match(strip, KEYBOARD_OPENER_CALL);
	// Both openers draw the SAME entries.
	assert.equal((strip.match(/tabMenuEntries\(tab\)\.map/g) ?? []).length, 2);
	for (const action of ["others", "left", "right", "all"])
		assert.ok(strip.includes(`bulk("${action}"`), action);
	assert.ok(
		strip.includes("workspaceBulkCloseKeys(tabs, tab.key, action, rtl)"),
	);
	assert.ok(strip.includes("disabled: keys.length === 0"));
	// The ellipsis lives inside the tab row, before its close button, and only
	// the active tab mounts it.
	const row = strip.slice(strip.indexOf("const renderTabRow"));
	assert.ok(
		row.indexOf('data-workspace-tab-more=""') > 0 &&
			row.indexOf('data-workspace-tab-more=""') <
				row.indexOf('data-workspace-close=""'),
	);
	assert.match(row, TAB_MORE_ACTIVE_ONLY);
	assert.equal((row.match(/data-workspace-tab-more=""/g) ?? []).length, 1);
	// Grouped menus: three groups, separators drawn by both openers.
	assert.match(strip, CONTEXT_SEPARATED);
	assert.match(strip, DROPDOWN_SEPARATED);
	assert.equal((strip.match(/group: "pin",/g) ?? []).length, 1);
	assert.equal((strip.match(/group: "move",/g) ?? []).length, 1);
	assert.equal((strip.match(/group: "close",/g) ?? []).length, 2);
	// "Close all tabs" without a right-click, in the strip-level list.
	assert.match(strip, STRIP_CLOSE_ALL);
	// The active tab leaves through the existing close, choosing among survivors.
	assert.ok(hook.includes("if (active) close(active, tabs.filter(keep));"));
	assert.ok(hook.includes("const next = workspaceNeighbor(among, tab.key);"));
	assert.ok(page.includes("onCloseMany={workspace.closeMany}"));
};

test("every tab carries one right-click/keyboard/ellipsis menu with the bulk closes", () => {
	assertTabMenuWiring(
		source(`${modelPath}workspace-tabs.tsx`),
		source(`${modelPath}use-workspace-tabs.ts`),
		source(`${modelPath}chat-page.tsx`),
	);
	// No stylesheet rule hides or reveals a per-tab ellipsis any more: an inactive
	// tab has none to hide, so it keeps no gap.
	assert.doesNotMatch(
		source("styles/index.css"),
		/\[data-workspace-tab-more\]/,
	);
});

/*
 * The grouping rule itself, run: the entry order Pin, Move left, Move right,
 * Close, Close others/left/right/all puts a separator before Move left and before
 * Close, and nowhere else - two rules, three groups.
 */
function loadStartsGroup(strip) {
	const fn = strip.match(/function startsGroup\([\s\S]*?\n\}/);
	assert.ok(fn, "startsGroup located");
	const js = fn[0]
		.replace(/: readonly \{ group: string \}\[\]/, "")
		.replace(/: number/, "");
	return new Function(`${js}; return startsGroup;`)();
}

test("the per-tab menu draws separators between Pin | Move | Close groups", () => {
	const startsGroup = loadStartsGroup(source(`${modelPath}workspace-tabs.tsx`));
	const entries = ["pin", "move", "move", ...Array(5).fill("close")].map(
		(group) => ({ group }),
	);
	const breaks = entries.flatMap((_, i) =>
		startsGroup(entries, i) ? [i] : [],
	);
	assert.deepEqual(breaks, [1, 3]);
});

test("negative control: the wiring guard rejects a strip whose ellipsis left the tab or lost the keyboard opener", () => {
	const strip = source(`${modelPath}workspace-tabs.tsx`);
	const hook = source(`${modelPath}use-workspace-tabs.ts`);
	const page = source(`${modelPath}chat-page.tsx`);
	assert.throws(() =>
		assertTabMenuWiring(
			strip.replace("if (openTabMenuFromKeyboard(event)) return;", ""),
			hook,
			page,
		),
	);
	assert.throws(() =>
		assertTabMenuWiring(
			strip.replace('bulk("right"', 'bulk("rite"'),
			hook,
			page,
		),
	);
	assert.throws(() =>
		assertTabMenuWiring(
			strip,
			hook.replace("close(active, tabs.filter(keep))", "close(active)"),
			page,
		),
	);
	// The round-1 shape: an ellipsis mounted on every tab.
	const everyTab = strip.replace(ACTIVE_DROPDOWN, "<DropdownMenu>");
	assert.notEqual(everyTab, strip, "control mutation applied");
	assert.throws(() => assertTabMenuWiring(everyTab, hook, page));
	// A flat, ungrouped context menu.
	const flat = strip.replace(
		"{startsGroup(entries, index) && <ContextMenuSeparator />}",
		"",
	);
	assert.notEqual(flat, strip, "control mutation applied");
	assert.throws(() => assertTabMenuWiring(flat, hook, page));
});

test("tab titles: remembered names first, loading only while the catalogue is unsettled", () => {
	const base = { target: targetA, catalogueSettled: false };
	// Persisted title paints a restored tab before any page lands.
	assert.deepEqual(resolveWorkspaceTabTitle({ ...base, savedTitle: "Aida" }), {
		kind: "title",
		text: "Aida",
	});
	// No name anywhere and no answer yet: loading, not "New chat".
	assert.deepEqual(resolveWorkspaceTabTitle(base), { kind: "loading" });
	assert.deepEqual(resolveWorkspaceTabTitle({ ...base, savedTitle: "  " }), {
		kind: "loading",
	});
	// Loaded catalogue row outranks the remembered name; header outranks both.
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			...base,
			catalogueSettled: true,
			catalogueTitle: "Renamed",
			savedTitle: "Old",
		}),
		{ kind: "title", text: "Renamed" },
	);
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			...base,
			activeTitle: "Header",
			catalogueTitle: "Row",
		}),
		{ kind: "title", text: "Header" },
	);
	// Settled (answered or failed) with no row: the existing fallback, never a spinner.
	assert.deepEqual(
		resolveWorkspaceTabTitle({ ...base, catalogueSettled: true }),
		{
			kind: "fallback",
		},
	);
	// Drafts are "New chat" even before the catalogue answers, and ignore saved names.
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			target: draft,
			catalogueSettled: false,
			savedTitle: "x",
		}),
		{ kind: "fallback" },
	);
});

test("saved tab titles round-trip, and state written before the field still loads", () => {
	const titles = { [targetA.id]: "  Aida ", [targetB.id]: "" };
	const saved = saveWorkspaceTabs(
		[sessionA, sessionB, draftTab],
		(id) => titles[id],
	);
	assert.deepEqual(saved, [
		{ id: targetA.id, pinned: false, title: "Aida" },
		{ id: targetB.id, pinned: false },
	]);
	assert.deepEqual(
		sanitizeSavedWorkspaceTabs(JSON.parse(JSON.stringify(saved))),
		saved,
	);
	// Old blob: no title key at all.
	assert.deepEqual(
		sanitizeSavedWorkspaceTabs([{ id: targetA.id, pinned: true }]),
		[{ id: targetA.id, pinned: true }],
	);
	// Non-string or oversized titles never reach the strip unbounded.
	const [bad, long] = sanitizeSavedWorkspaceTabs([
		{ id: targetA.id, pinned: false, title: 42 },
		{ id: targetB.id, pinned: false, title: "x".repeat(1000) },
	]);
	assert.equal("title" in bad, false);
	assert.equal(long.title.length, 300);
	// A title change alone is a difference worth re-saving.
	assert.equal(
		savedWorkspaceTabsDiffer(
			saved,
			saved.map((row) => ({ ...row })),
		),
		false,
	);
	assert.equal(
		savedWorkspaceTabsDiffer(saved, [
			{ ...saved[0], title: "Other" },
			saved[1],
		]),
		true,
	);
});

function assertTitleLoadingWiring(strip, hook) {
	assert.match(strip, /resolveWorkspaceTabTitle\(/);
	assert.match(strip, /state\.head\.at > 0 \|\| state\.error !== null/);
	assert.match(
		strip,
		/data-workspace-tab-title-loading=""\s*aria-busy="true"[\s\S]*?<Skeleton aria-hidden="true" className="h-2\.5 w-20" \/>/,
	);
	assert.match(strip, /t\("ui\.chat\.canonical\.loading\.region_label"\)/);
	assert.equal((strip.match(/\{titleSlot\(tab, /g) ?? []).length, 2);
	assert.match(hook, /\}, \[tabs, sessions, seenRevision\]\);/);
	assert.match(hook, /saveWorkspaceTabsWithTitles\(tabs, \{/);
	// Every catalogue row a tab shows is remembered, not only the header.
	assert.match(
		strip,
		/onTitleSeen\(\s*tab\.key,\s*sessions\.find\(\(row\) => row\.session_id === id\)\?\.title \?\? null,/,
	);
	assert.match(
		strip,
		/if \(activeKey && activeTitle\) onTitleSeen\(activeKey, activeTitle\);/,
	);
	assert.match(hook, /savedWorkspaceTabsDiffer\(saved, store\.workspaceTabs\)/);
}

test("restored tabs draw a fixed-width loading placeholder and persist their titles", () => {
	const strip = source("features/chat/components/workspace-tabs.tsx");
	const hook = source("features/chat/components/use-workspace-tabs.ts");
	assertTitleLoadingWiring(strip, hook);
	// Negative controls: each regression shape must fail the guard.
	for (const mutated of [
		[strip.replace("state.head.at > 0 || state.error !== null", "false"), hook],
		[strip.replace('className="h-2.5 w-20"', 'className="h-2.5"'), hook],
		[strip.replace('aria-busy="true"', ""), hook],
		[strip.replace('{titleSlot(tab, "strip")}', "{title(tab)}"), hook],
		[strip, hook.replace("}, [tabs, sessions, seenRevision]);", "}, [tabs]);")],
		[
			strip.replace(
				"onTitleSeen(\n\t\t\t\ttab.key,",
				"void (\n\t\t\t\ttab.key,",
			),
			hook,
		],
	]) {
		assert.ok(
			mutated[0] !== strip || mutated[1] !== hook,
			"control mutation applied",
		);
		assert.throws(() => assertTitleLoadingWiring(...mutated));
	}
	// Model-level negative control: dropping the loading arm reads "fallback".
	assert.notDeepEqual(
		resolveWorkspaceTabTitle({ target: targetA, catalogueSettled: true }),
		{ kind: "loading" },
	);
});

/*
 * THE INVARIANT (operator, 2026-11-24, plus QA #2099 Q1B-F1 / Q1C-F1): a tab
 * that has shown a real title never regresses to "New chat" or a placeholder
 * while its row is merely absent - fallen off the head page, below it, or not
 * answered yet on a relaunch.
 */
const UNTITLED = "Untitled chat";

test("mid-session: a tab whose row falls off the head page keeps its name and saved title", () => {
	const tabs = [sessionA, sessionB];
	// t0: both rows on page one; the strip remembers each row it showed.
	const seen = { [sessionA.key]: "Quarterly model", [sessionB.key]: "Hotfix" };
	const first = saveWorkspaceTabsWithTitles(tabs, {
		rows: new Map([
			[targetA.id, "Quarterly model"],
			[targetB.id, "Hotfix"],
		]),
		seen: {},
		prior: [],
	});
	// t1: activity pushed A off the page; B is still listed.
	const after = saveWorkspaceTabsWithTitles(tabs, {
		rows: new Map([[targetB.id, "Hotfix"]]),
		seen,
		prior: first,
	});
	assert.deepEqual(after, first, "absence from the page never erases a title");
	const shown = resolveWorkspaceTabTitle({
		target: targetA,
		catalogueSettled: true,
		catalogueTitle: undefined,
		sessionTitle: seen[sessionA.key],
		savedTitle: after[0].title,
	});
	assert.deepEqual(shown, { kind: "title", text: "Quarterly model" });
	// Negative control - v0.64.0's chain for an INACTIVE tab: header (not this
	// tab) || row (gone) || titles map (held only the active header) || fallback.
	const shipped = (row, activeOnlyTitles) =>
		row || activeOnlyTitles[sessionA.key] || "New chat";
	assert.equal(shipped(undefined, {}), "New chat");
});

test("Q1B-F1: the active tab shows its saved title while the header has no real name", () => {
	// Before the catalogue answers the header's only answer is its placeholder.
	const header = workspaceHeaderTitle({
		draftSentence: null,
		liveTitle: "",
		catalogueTitle: undefined,
	});
	assert.equal(header, null);
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			target: targetA,
			activeTitle: header,
			catalogueSettled: false,
			savedTitle: "T00 Quarterly revenue model",
		}),
		{ kind: "title", text: "T00 Quarterly revenue model" },
	);
	// Negative control: the shipped wiring fed the placeholder string through.
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			target: targetA,
			activeTitle: UNTITLED,
			catalogueSettled: false,
			savedTitle: "T00 Quarterly revenue model",
		}),
		{ kind: "title", text: UNTITLED },
	);
	// Real names still pass, in the header's own order; a staged draft keeps its sentence.
	assert.equal(
		workspaceHeaderTitle({ liveTitle: " Live ", catalogueTitle: "Row" }),
		"Live",
	);
	assert.equal(workspaceHeaderTitle({ catalogueTitle: "Row" }), "Row");
	assert.equal(workspaceHeaderTitle({ draftSentence: "New chat" }), "New chat");
});

test("Q1C-F1: a conversation below page one is saved under its real header title", () => {
	// Never on the page: no row, nothing saved before; only the open header named it.
	const saved = saveWorkspaceTabsWithTitles([sessionA, sessionB], {
		rows: new Map(),
		seen: { [sessionB.key]: "T08 Old research" },
		prior: [],
	});
	assert.deepEqual(saved[1], {
		id: targetB.id,
		pinned: false,
		title: "T08 Old research",
	});
	assert.equal(
		"title" in saved[0],
		false,
		"an unnamed tab saves no placeholder",
	);
	// Relaunch: the restored tab draws that name before and after the catalogue settles.
	for (const catalogueSettled of [false, true])
		assert.deepEqual(
			resolveWorkspaceTabTitle({
				target: targetB,
				catalogueSettled,
				savedTitle: sanitizeSavedWorkspaceTabs(saved)[1].title,
			}),
			{ kind: "title", text: "T08 Old research" },
		);
	// Precedence: a listed row (renames) > seen this run > saved before.
	const ranked = saveWorkspaceTabsWithTitles([sessionA], {
		rows: new Map([[targetA.id, "Renamed"]]),
		seen: { [sessionA.key]: "Seen" },
		prior: [{ id: targetA.id, pinned: false, title: "Old" }],
	});
	assert.equal(ranked[0].title, "Renamed");
	assert.equal(
		saveWorkspaceTabsWithTitles([sessionA], {
			rows: new Map([[targetA.id, "  "]]),
			seen: { [sessionA.key]: "Seen" },
			prior: [{ id: targetA.id, pinned: false, title: "Old" }],
		})[0].title,
		"Seen",
	);
});

/*
 * THE OPERATOR'S 2026-11-25 "New chat" TAB, reproduced. Their saved strip held
 * `{"id":"3389da57a13e","pinned":false}` with NO title, between "Erys" and
 * "Self-hosted CVE scanning ...". That session has a real stored title
 * (`title.json`, written 2026-11-24 10:11) but ~287 sessions had newer activity,
 * so its row is far below the 50-row head page; the tab was not active this
 * run, so no header named it either. Every source the strip consulted was
 * empty, and once the catalogue settled it drew "New chat" for as long as the
 * app ran - and saved no title, so the next launch did the same.
 */
test("a restored tab whose row is below the head page and has no saved title asks the session for its name", () => {
	const tabs = [sessionA, sessionB, sessionC, draftTab];
	const rows = new Map([[targetA.id, "Erys"]]);
	const seen = {};
	const saved = [
		{ id: targetA.id, pinned: false, title: "Erys" },
		{ id: targetB.id, pinned: false },
		{ id: targetC.id, pinned: false, title: "Self-hosted CVE scanning" },
	];
	// The defect: the shipped chain settles B to the "New chat" fallback.
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			target: targetB,
			catalogueSettled: true,
			catalogueTitle: rows.get(targetB.id),
			sessionTitle: seen[sessionB.key],
			savedTitle: saved[1].title,
		}),
		{ kind: "fallback" },
	);
	// Only B is unnamed by every source, only once the catalogue has settled,
	// never a draft (a draft IS a new chat), and never twice in one run.
	const input = { tabs, rows, seen, saved, catalogueSettled: true };
	assert.deepEqual(
		workspaceTabsAwaitingTitle({ ...input, attempted: new Set() }),
		[{ key: sessionB.key, id: targetB.id }],
	);
	assert.deepEqual(
		workspaceTabsAwaitingTitle({
			...input,
			catalogueSettled: false,
			attempted: new Set(),
		}),
		[],
		"before the catalogue answers, the row may still arrive",
	);
	assert.deepEqual(
		workspaceTabsAwaitingTitle({ ...input, attempted: new Set([targetB.id]) }),
		[],
	);
	// The answer: Core's snapshot carries the stored title (Core #4576).
	const snapshot = {
		payload: {
			frontend: {
				snapshot: {
					conversation_title:
						"  Improve onboarding flow provider sign-in clarity ",
				},
			},
		},
	};
	const title = snapshotConversationTitle(snapshot);
	assert.equal(title, "Improve onboarding flow provider sign-in clarity");
	for (const empty of [
		null,
		{},
		{ payload: { frontend: { snapshot: { conversation_title: "" } } } },
		{ payload: { frontend: { snapshot: { conversation_title: 7 } } } },
	])
		assert.equal(snapshotConversationTitle(empty), null);
	// Remembered like a header title: the tab names itself now and saves it.
	const after = { [sessionB.key]: title };
	assert.deepEqual(
		resolveWorkspaceTabTitle({
			target: targetB,
			catalogueSettled: true,
			sessionTitle: after[sessionB.key],
		}),
		{ kind: "title", text: title },
	);
	assert.equal(
		saveWorkspaceTabsWithTitles(tabs, { rows, seen: after, prior: saved })[1]
			.title,
		title,
	);
	assert.deepEqual(
		workspaceTabsAwaitingTitle({ ...input, seen: after, attempted: new Set() }),
		[],
	);
});

function assertTitleLookupWiring(hook) {
	assert.match(hook, /workspaceTabsAwaitingTitle\(\{/);
	assert.match(
		hook,
		/desktopResult<unknown>\(\{\s*op: "sessions\.get",\s*sessionId: id,?\s*\}\)/,
	);
	assert.match(
		hook,
		/rememberTitle\(key, snapshotConversationTitle\(snapshot\)\)/,
	);
	assert.match(hook, /titleLookups\.current\.add\(id\)/);
	assert.match(hook, /state\.head\.at > 0 \|\| state\.error !== null/);
}

test("the strip hook looks each unnamed tab up once and remembers the answer", () => {
	const hook = source("features/chat/components/use-workspace-tabs.ts");
	assertTitleLookupWiring(hook);
	for (const mutated of [
		hook.replace("titleLookups.current.add(id)", "void id"),
		hook.replace(
			"rememberTitle(key, snapshotConversationTitle(snapshot))",
			"void snapshot",
		),
	]) {
		assert.notEqual(mutated, hook, "control mutation applied");
		assert.throws(() => assertTitleLookupWiring(mutated));
	}
});
