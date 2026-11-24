import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * THE SETTINGS TAB GRAMMAR, asserted without a renderer.
 *
 * `settings-tabs.ts` is the pure half of the tab change: which tab a URL
 * selects, what a rail row pushes, when a page-local search jump survives a
 * navigation, and where each tab's scroll position lives. The page's DOM side
 * (one `<section hidden>` per tab, twelve rail rows) is exercised by
 * `scripts/renderer-driver.mjs --scene settings-tabs` against the built app.
 *
 * WHY A SOURCE SCAN IS PART OF THIS FILE. The tab list exists in four places
 * that a type cannot join: the `SETTINGS_TAB_IDS` literal, the page's
 * `sectionRefs` seed (what a `?section=` link resolves against), the twelve
 * `<SettingsTabPanel>` wrappers, and the rail's own `DEFAULT_SETTINGS_SECTIONS`.
 * A set that disagrees in any one of them is a link that lands on General with
 * nothing said — the defect `settings-section-routes.test.mjs` documents for
 * routes, one layer up.
 *
 * Bundled small: no MUI, no Shepherd, no i18n catalogue enters this process
 * (the machine's memory guard has killed runners that pulled the page's graph).
 */
const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/settings/settings-tabs";
			export { isTourTargetVisible, revealSettingsTab } from "./src/renderer/src/features/onboarding/tour/tour-settings-tab";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	loader: { ".css": "empty" },
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	write: false,
});
const dataUrl = `data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`;
const {
	SETTINGS_TAB_IDS,
	TOUR_TAGS,
	FALLBACK_SETTINGS_TAB,
	buildSettingsTabHref,
	createTabScrollMemory,
	lastSettingsTab,
	rememberSettingsTab,
	resetSettingsTabMemory,
	resolveSettingsTab,
	settingsPanelOf,
	shouldClearSearchJump,
	isTourTargetVisible,
	revealSettingsTab,
	bindTabScrollMemory,
} = await import(dataUrl);

const sectionForKey = (key) => (key === "model_effort" ? "general" : "backend");
const all = SETTINGS_TAB_IDS;
const resolve = (search, extra = {}) =>
	resolveSettingsTab({
		search,
		available: all,
		lastTab: null,
		sectionForKey,
		...extra,
	});

test("the twelve tabs are the twelve section ids, in the page's order", () => {
	assert.equal(SETTINGS_TAB_IDS.length, 12);
	assert.equal(new Set(SETTINGS_TAB_IDS).size, 12);
	assert.equal(FALLBACK_SETTINGS_TAB, "general");
	assert.deepEqual(Object.keys(TOUR_TAGS).sort(), [
		"appearance",
		"general",
		"integrations",
		"radient",
		"updates",
	]);
});

test("a named destination outranks an implied one, and setting= outranks section=", () => {
	assert.equal(resolve("?section=speech").tab, "speech");
	assert.deepEqual(resolve("?section=speech"), { tab: "speech", stale: false });
	// A promoted key's control lives elsewhere, and the promotion map decides.
	assert.equal(resolve("?setting=model_effort&section=backend").tab, "general");
	assert.equal(resolve("?setting=web_search").tab, "backend");
	// A section the link names wins over a provider/mcp/filter it also carries.
	assert.equal(resolve("?provider=radient&section=backend").tab, "backend");
	assert.equal(resolve("?provider=radient").tab, "providers");
	assert.equal(resolve("?mcp=hubspot").tab, "integrations");
	assert.equal(resolve("?filter=web").tab, "backend");
});

test("lastTab is read ONLY for a bare /settings, and stale is about the URL", () => {
	assert.deepEqual(resolve(""), { tab: "general", stale: false });
	assert.deepEqual(resolve("", { lastTab: "keyboard" }), {
		tab: "keyboard",
		stale: false,
	});
	// A link never loses to the memory.
	assert.deepEqual(resolve("?section=updates", { lastTab: "keyboard" }), {
		tab: "updates",
		stale: false,
	});
	// A URL naming something this build cannot show falls back AND says so.
	const absent = resolve("?section=agent-messages", {
		available: all.filter((id) => id !== "agent-messages"),
	});
	assert.deepEqual(absent, { tab: "general", stale: true });
	assert.deepEqual(resolve("?section=credentials"), {
		tab: "general",
		stale: true,
	});
	// An empty destination parameter is not a destination.
	assert.deepEqual(resolve("?section="), { tab: "general", stale: false });
});

test("the run's last-tab memory is written only when asked", () => {
	resetSettingsTabMemory();
	assert.equal(lastSettingsTab(), null);
	rememberSettingsTab("backend");
	assert.equal(lastSettingsTab(), "backend");
	resetSettingsTabMemory();
	assert.equal(lastSettingsTab(), null);
});

test("a tab's URL is the section grammar every existing link already speaks", () => {
	assert.equal(
		buildSettingsTabHref("appearance"),
		"/settings?section=appearance",
	);
	assert.equal(
		buildSettingsTabHref("agent-messages"),
		"/settings?section=agent-messages",
	);
	// What selectTab pushes must resolve back to the same tab.
	for (const tab of SETTINGS_TAB_IDS) {
		assert.equal(resolve(`?section=${tab}`).tab, tab);
	}
});

test("a search jump survives the page's own tab push and dies on the reader's link", () => {
	// The page's own navigation: never a cancel, or the jump cancels itself.
	assert.equal(
		shouldClearSearchJump("?section=general", "?section=backend", true),
		false,
	);
	// The reader's link: a destination parameter changed.
	assert.equal(
		shouldClearSearchJump("?section=general", "?section=backend", false),
		true,
	);
	assert.equal(
		shouldClearSearchJump("?section=general", "?setting=web_search", false),
		true,
	);
	// Nothing deep-link-ish moved: keep the jump.
	assert.equal(
		shouldClearSearchJump(
			"?section=general",
			"?section=general&debug=1",
			false,
		),
		false,
	);
	assert.equal(
		shouldClearSearchJump("?section=general", "?section=general", false),
		false,
	);
	// A second render of the same URL must not clear a fresh jump.
	assert.equal(shouldClearSearchJump("", "", false), false);
});

test("scroll memory is per tab and survives a switch in both directions", () => {
	const memory = createTabScrollMemory();
	assert.equal(memory.trackedTab(), null);
	assert.equal(memory.recall("general"), undefined);
	memory.track("general");
	memory.record(120);
	memory.track("backend");
	memory.record(40);
	assert.equal(memory.trackedTab(), "backend");
	memory.track("general");
	assert.equal(
		memory.recall("general"),
		120,
		"the first tab kept its own position",
	);
	assert.equal(
		memory.recall("backend"),
		40,
		"the other tab did not inherit it",
	);
	assert.equal(
		memory.recall("imports"),
		undefined,
		"a tab never shown has none",
	);
	// Recording with no tracked tab attributes nothing to anyone.
	const cold = createTabScrollMemory();
	cold.record(900);
	cold.track("speech");
	assert.equal(cold.recall("speech"), undefined);
});

test("the panel lookup reads the nearest panel, and nothing outside one", () => {
	const panel = {
		getAttribute: (name) => (name === "data-settings-panel" ? "speech" : null),
	};
	const inside = {
		closest: (selector) =>
			selector === "[data-settings-panel]" ? panel : null,
	};
	assert.equal(settingsPanelOf(inside), "speech");
	assert.equal(settingsPanelOf({ closest: () => null }), null);
	assert.equal(settingsPanelOf(null), null);
});

test("the tour reveals a tab by clicking its row only when the row would move", async () => {
	const clickedFor = async (attributes) => {
		let clicked = 0;
		const row = {
			getAttribute: (name) => attributes[name] ?? null,
			click: () => {
				clicked += 1;
			},
		};
		await revealSettingsTab("settings-sidebar-appearance", {
			waitMs: 20,
			pollMs: 5,
			doc: { querySelector: () => row },
		});
		return clicked;
	};
	assert.equal(await clickedFor({}), 1, "another tab is showing: click");
	assert.equal(
		await clickedFor({ "aria-current": "page" }),
		0,
		"already showing: a click would only add a duplicate history entry",
	);

	let polls = 0;
	await revealSettingsTab("settings-sidebar-updates", {
		waitMs: 30,
		pollMs: 5,
		doc: {
			querySelector: () => {
				polls += 1;
				return null;
			},
		},
	});
	assert.ok(polls > 1, "a row that has not painted is waited for, bounded");

	// The guard's own reading of "visible": in the document is not enough.
	const hiddenAncestor = { isConnected: true };
	const insideHidden = {
		closest: (selector) => (selector === "[hidden]" ? hiddenAncestor : null),
	};
	const insidePanel = {
		closest: (selector) => (selector === "[hidden]" ? null : null),
	};
	assert.equal(isTourTargetVisible(insideHidden), false);
	assert.equal(isTourTargetVisible(insidePanel), true);
	assert.equal(isTourTargetVisible(null), false);
});

/*
 * SOURCE SCANS. Four spellings of one list; a type cannot join them.
 */
const page = readFileSync(
	"src/renderer/src/features/settings/components/settings-page.tsx",
	"utf8",
);
const sidebar = readFileSync(
	"src/renderer/src/features/settings/components/settings-sidebar.tsx",
	"utf8",
);
const panel = readFileSync(
	"src/renderer/src/features/settings/components/settings-tab-panel.tsx",
	"utf8",
);

/** The page's live key set: the `sectionRefs` seed literal. */
function sectionRefKeys() {
	const start = page.indexOf(
		"const sectionRefs = useRef<Record<string, RefObject<HTMLDivElement>>>({",
	);
	assert.notEqual(
		start,
		-1,
		"sectionRefs seed not found — did the page change shape?",
	);
	const body = page.slice(start);
	const end = body.indexOf("}).current;");
	assert.notEqual(end, -1, "sectionRefs seed has no closing `}).current;`");
	const seed = body.slice(0, end);
	return [...seed.matchAll(/^\s+(?:"([^"]+)"|([A-Za-z][\w-]*))\s*:/gm)].map(
		(match) => match[1] ?? match[2],
	);
}

test("twelve panels, twelve rail rows, twelve refs, one id list", () => {
	const panelTabs = [
		...page.matchAll(/<SettingsTabPanel\s+tab="([^"]+)"/g),
	].map((match) => match[1]);
	assert.equal(panelTabs.length, 12, "one panel per section");
	assert.deepEqual(
		new Set(panelTabs),
		new Set(SETTINGS_TAB_IDS),
		"the panels are the tabs",
	);
	assert.deepEqual(
		new Set(sectionRefKeys()),
		new Set(SETTINGS_TAB_IDS),
		"every deep link resolves against a key the page mounts",
	);
	assert.deepEqual(
		new Set(
			[...sidebar.matchAll(/^\s+id: "([a-z-]+)",\s*$/gm)].map((m) => m[1]),
		),
		new Set(SETTINGS_TAB_IDS),
		"the rail lists the same destinations",
	);
	// The rail row carries the tab id PR3's links and the palette rows will read.
	assert.equal(
		sidebar.match(/data-settings-tab=\{section\.id\}/g)?.length,
		1,
		"the rail row must carry data-settings-tab",
	);
	// A hidden panel leaves the tab order and the a11y tree; `inert` and
	// `content-visibility` do not make the same statement.
	assert.match(panel, /hidden=\{!active\}/);
	assert.match(panel, /data-settings-panel=\{tab\}/);
	assert.match(panel, /id=\{`settings-panel-\$\{tab\}`\}/);
	assert.ok(
		!/\sinert=|contentVisibility/.test(panel) &&
			!/content-visibility:/.test(panel),
		"hiding is the hidden attribute, not inert or content-visibility",
	);
});

test("the tour's tags name rail rows this page renders", () => {
	for (const [tab, tag] of Object.entries(TOUR_TAGS)) {
		assert.ok(SETTINGS_TAB_IDS.includes(tab), `${tag} names a real tab`);
		assert.ok(sidebar.includes(`id: "${tab}"`), `${tag} is a rail destination`);
	}
	// The sidebar reads the one map; a second copy is how a rename goes silent.
	assert.ok(
		sidebar.includes("TOUR_TAGS"),
		"the rail must read the shared tags",
	);
	assert.equal(
		sidebar.match(/const TOUR_TAGS/g),
		null,
		"the rail must not carry its own tag map",
	);
});

test("the seed is read once per mount, so Back to the bare entry keeps its tab", () => {
	/*
	 * Round 1: M1. A bare `/settings` entry means "the tab this visit opened on".
	 * Replaying the page's own calls with the seed captured ONCE (what the hook's
	 * `useState` does) is the sequence that was broken: gear -> Appearance -> Back
	 * used to re-show Appearance, because the memory had been rewritten to it.
	 */
	resetSettingsTabMemory();
	const seed = lastSettingsTab(); // the cold-start read the hook does on mount
	const resolveNow = (search) =>
		resolveSettingsTab({
			search,
			available: all,
			lastTab: seed,
			sectionForKey,
		});
	assert.equal(resolveNow("").tab, "general", "gear on a cold start");
	rememberSettingsTab("general"); // the arrival effect, on General
	assert.equal(resolveNow("?section=appearance").tab, "appearance");
	rememberSettingsTab("appearance"); // the arrival effect, on Appearance
	assert.equal(
		resolveNow("").tab,
		"general",
		"Back to the entry the visit opened on keeps that entry's tab",
	);

	// A NEW visit mounts again: it reads the memory as it is now.
	assert.equal(
		resolveSettingsTab({
			search: "",
			available: all,
			lastTab: lastSettingsTab(),
			sectionForKey,
		}).tab,
		"appearance",
		"a fresh open still lands on the run's last tab",
	);
	resetSettingsTabMemory();
});

test("the hook and the page carry the mount-scoped shapes, not the per-resolve ones", () => {
	/*
	 * The two round-1 mechanisms are one line each, and the line is the contract:
	 * a per-resolve `lastSettingsTab()` is M1 returning, and a listener effect
	 * without the scroller's identity is M2 returning.
	 */
	const hook = readFileSync(
		"src/renderer/src/features/settings/use-settings-tab.ts",
		"utf8",
	);
	assert.match(
		hook,
		/useState<string \| null>\(\(\) => lastSettingsTab\(\)\)/,
		"the seed is state, read once per mount",
	);
	assert.match(hook, /lastTab: seed/, "the resolver reads that seed");
	assert.ok(
		!/lastTab: lastSettingsTab\(\)/.test(hook),
		"the resolver must not re-read the memory on every resolve",
	);
	const page = readFileSync(
		"src/renderer/src/features/settings/components/settings-page.tsx",
		"utf8",
	);
	assert.match(
		page,
		/bindTabScrollMemory\(scrollerNode, scrollMemory\)/,
		"the listener binds the element that is mounted, not a ref captured once",
	);
	assert.match(
		page,
		/ref=\{contentScrollerRef\}/,
		"the scroller publishes itself through the callback ref",
	);
});

test("the scroll listener binds to the element it is given, whenever that is", () => {
	/*
	 * M2's seam: the scroller does not exist while the page is loading or in an
	 * error state, so binding must take the element as an argument and work when
	 * it appears later.
	 */
	const memory = createTabScrollMemory();
	const handlers = [];
	const scroller = {
		scrollTop: 0,
		addEventListener(type, fn, options) {
			handlers.push({ type, fn, options });
		},
		removeEventListener(type, fn) {
			const at = handlers.findIndex(
				(entry) => entry.type === type && entry.fn === fn,
			);
			if (at >= 0) handlers.splice(at, 1);
		},
	};
	memory.track("speech");
	const unbind = bindTabScrollMemory(scroller, memory);
	assert.equal(
		handlers.length,
		1,
		"one passive listener on the mounted element",
	);
	assert.equal(handlers[0].type, "scroll");
	assert.deepEqual(handlers[0].options, { passive: true });
	scroller.scrollTop = 240;
	handlers[0].fn();
	assert.equal(
		memory.recall("speech"),
		240,
		"a scroller that mounted after the first effect still records",
	);
	unbind();
	assert.equal(handlers.length, 0, "the unbind is the effect's cleanup");
});
