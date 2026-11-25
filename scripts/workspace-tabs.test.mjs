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
	sanitizeSavedWorkspaceTabs,
	saveWorkspaceTabs,
	syncWorkspaceTabs,
	translate,
	workspaceBulkCloseKeys,
	workspaceNeighbor,
	workspaceSessionPathMatches,
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
	/\[data-workspace-tabs\]\s*\{[^}]*align-items: center;\s*min-height: 32px;/;
const TAB_PAINT_HOST =
	/\[data-workspace-tab\]\s*\{[^}]*position: relative;\s*isolation: isolate;/;
const TAB_PAINT =
	/\[data-workspace-tab\]::before\s*\{[^}]*z-index: -1;\s*inset-block: 2px;[^}]*background: var\(--workspace-tab-fill\);\s*pointer-events: none;/;
const ACTIVE_TAB_PAINT =
	/\[data-workspace-tab\]\[data-active\]\s*\{\s*--workspace-tab-fill:/;
const DRAG_SPACER = /\[data-workspace-tab-spacer\]\s*\{\s*align-self: stretch;/;
const NO_DRAG_TAB = /data-workspace-tab=""[^>]*data-titlebar-no-drag=""/;
const TAB_TARGET = /className="flex h-7 [^"]+"\s*aria-current=/;
const CLOSE_TARGET = /data-workspace-close=""\s*className="[^"\n]*\bsize-6\b/;
const MORE_TARGET =
	/data-workspace-more=""\s*data-titlebar-no-drag=""\s*className="[^"\n]*\bsize-7\b/;
const TAB_FOCUS =
	/\[data-workspace-tabs\] button:focus-visible\s*\{\s*outline: 2px solid var\(--color-accent\);\s*outline-offset: -2px;/;
const HEADER_PADDING =
	/\[data-workspace-inset\] > \[data-chat-region="header"\] \{[^}]*padding-inline-start: 4px;\s*padding-inline-end: 12px;\s*\}/;

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

test("the 32px strip leaves 4px of settled air on both sides of the tab paint without sacrificing hit area", () => {
	const css = source("styles/index.css");
	const strip = source(`${modelPath}workspace-tabs.tsx`);
	// The centered 28px target leaves 2px of native lane on each edge; another
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
 * opaque row-selected ground, full ink, weight 500 and a 2px accent indicator.
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
		/\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: var\(--color-row-selected\);\s*color: var\(--color-ink\);/,
	);
	assert.match(
		css,
		/\[data-workspace-tab\]\[data-active\] > button\[aria-current\] \{\s*font-weight: 500;/,
	);
	assert.match(
		css,
		/\[data-workspace-tab\]\[data-active\]::after \{[^}]*height: 2px;[^}]*background: var\(--color-accent\);/,
	);
	// No outline/pill: the tab block itself never draws a border.
	const tab = css.match(/\[data-workspace-tab\] \{[^}]*\}/)[0];
	assert.doesNotMatch(tab, /border(-width)?:/);
}

test("the active tab is the only filled tab, in full ink with an accent indicator", () => {
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
			/(\[data-workspace-tab\]\[data-active\] \{\s*--workspace-tab-fill: )var\(--color-row-selected\);/,
			"$1color-mix(in oklab, var(--color-row-selected) 44%, var(--color-surface));",
		);
	assert.notEqual(faint, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(faint));
	const noIndicator = css.replace(
		"[data-workspace-tab][data-active]::after",
		"[data-x]::after",
	);
	assert.notEqual(noIndicator, css, "control mutation applied");
	assert.throws(() => assertActiveTabTreatment(noIndicator));
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
	/<ContextMenu key=\{key\}>\s*<ContextMenuTrigger asChild>\s*\{renderTabRow\(/;
const KEYBOARD_OPENER_KEYS =
	/event\.key !== "ContextMenu" && !\(event\.shiftKey && event\.key === "F10"\)/;
const KEYBOARD_OPENER_CALL = /if \(openTabMenuFromKeyboard\(event\)\) return;/;
const STRIP_CLOSE_ALL =
	/data-workspace-close-all=""\s*disabled=\{closeAllKeys\.length === 0\}\s*onSelect=\{\(\) => onCloseMany\(closeAllKeys\)\}/;
/*
 * The ellipsis is MOUNTED on the active tab only (design D2, review R2): an
 * opacity-hidden trigger on every tab kept a 24px hole and a Tab stop in each.
 */
const TAB_MORE_ACTIVE_ONLY =
	/\{active && \(\s*<DropdownMenu>\s*<DropdownMenuTrigger asChild>\s*<button\s+type="button"\s+data-workspace-tab-more=""/;
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
	const everyTab = strip.replace(
		/\{active && \(\s*<DropdownMenu>/,
		"<DropdownMenu>",
	);
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
