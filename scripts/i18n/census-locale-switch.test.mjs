import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

// These controls keep the catalogue/model implementations fixed and change only
// the actual production invalidation sites. Neither fresh derivation nor a forced
// remount is allowed to mask a missing memo dependency or browser subscription.
const base = process.env.CENSUS_SWITCH_CONTROL;
const source = (path) =>
	base
		? execFileSync("git", ["show", `${base}:${path}`], { encoding: "utf8" })
		: readFileSync(path, "utf8");
const chatPath = "src/renderer/src/features/chat/components/chat-page.tsx";
const chat = source(chatPath);
const start = chat.indexOf("\tconst runDetails = useMemo(");
const end = chat.indexOf("\n\t/*", start);
assert.ok(start > 0 && end > start);
// Include the new locale subscription if present; keep the pre-fix memo's bytes
// intact for the negative control instead of constructing a similar fake memo.
const subscription = chat
	.slice(0, start)
	.endsWith("\tconst runDetailsLocale = useI18nLocale();\n")
	? "const runDetailsLocale = useI18nLocale();"
	: "useI18nLocale();";
const memo = chat.slice(start, end);
const index = source("src/main/browser/index.ts");
const LOCALE_WIRING =
	/const stopLocaleUpdates = observeBrowserLocale\(options\.window\);\s*rollback\.add\(stopLocaleUpdates\);/;
const wiring = index.match(LOCALE_WIRING)?.[0] ?? "";
if (!base) {
	assert.ok(
		index.includes("stop: async () => {\n\t\t\t\tstopLocaleUpdates();"),
		"normal stop must unsubscribe, as rollback does",
	);
}
// Execute the real main-owned title expression, not a copy of its English key.
// An internal lop:// page (the extension manager) takes its own title arm first;
// only that exact arm may precede the captured web-page fallback.
const hostPath = "src/main/browser/host.ts";
const TITLE_EXPRESSION =
	/title:\s*(?:parseInternalUrl\(entry\.url\)\s*\?\s*t\("ui\.browser\.extensions\.page_title"\)\s*:\s*)?(this\.titleForChrome\(entry\.title\)\s*\|\|\s*t\("ui\.browser\.browser_tab_strip\.new_tab"\))/;
const title = readFileSync(hostPath, "utf8").match(TITLE_EXPRESSION)?.[1];
assert.ok(title, "execute the production untitled-tab title expression");

async function bundle(contents) {
	const result = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		alias: { "@shared": "./src/renderer/src/shared" },
		banner: {
			js: 'import { createRequire } from "node:module"; const require = createRequire(process.cwd() + "/package.json");',
		},
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}
const renderer = await bundle(`
	import { useMemo } from "react";
	import { useI18nLocale } from "./src/renderer/src/shared/i18n/use-locale";
	import { deriveRunDetails } from "./src/renderer/src/features/chat/components/run-details/run-detail-model";
	export { createElement, act } from "react";
	export { createRoot } from "react-dom/client";
	export { setLocale } from "./src/i18n/locale";
	export { readBrowserProjection, subscribeBrowserProjection, refreshBrowserProjection } from "./src/renderer/src/features/browser/model/browser-projection-store";
	export function Probe({ sessionId, runFrontend, capture }) {
		${subscription}
		${memo}
		capture(runDetails);
		return null;
	}
`);
// Separate bundles model separate main/renderer locale owners. Advancing the
// renderer MUST NOT implicitly advance main, which was the C2 ordering trap.
const main = await bundle(
	`
	import { observeBrowserLocale } from "./src/main/browser/browser-locale";
	import { t } from "./src/i18n";
	export { setLocale } from "./src/i18n/locale";
	export { createMainLocale } from "./src/main/main-locale";
	export function connect(options, rollback) { ${wiring} }
	export function tabTitle(entry) { return (${title}).toString(); }
`.replace(
		"this.titleForChrome(entry.title)",
		'(entry.title === "about:blank" ? "" : entry.title)',
	),
);
const dom = new JSDOM("<!doctype html><div id='root'></div>");
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
after(() => dom.window.close());

const frontend = Object.freeze({
	jobs: [],
	todos: [],
	wakes: [
		{
			id: "synthetic-wake",
			message: "fixture",
			every_ms: null,
			next_due_at: 1_800_000_000_000,
		},
	],
	monitors: [
		{
			id: "synthetic-monitor",
			name: "fixture",
			every_ms: null,
			next_due_at: 1_800_000_000_000,
		},
	],
});

test("retained frontend re-derives wake AND monitor cadence on locale changes without remount", async () => {
	renderer.setLocale("en");
	const wireBefore = JSON.stringify(frontend);
	const root = renderer.createRoot(document.getElementById("root"));
	let observed;
	try {
		renderer.act(() =>
			root.render(
				renderer.createElement(renderer.Probe, {
					sessionId: "synthetic-id",
					runFrontend: frontend,
					capture: (value) => {
						observed = value;
					},
				}),
			),
		);
		const en = observed;
		assert.equal(en.wakes[0].cadence, "once");
		assert.equal(en.monitors[0].interval, "once");
		renderer.act(() => renderer.setLocale("fr"));
		assert.equal(observed.wakes[0].cadence, "une fois");
		assert.equal(observed.monitors[0].interval, "une fois");
		assert.notEqual(
			observed,
			en,
			"the derived cache must invalidate, not merely repaint",
		);
		renderer.act(() => renderer.setLocale("en"));
		assert.equal(observed.wakes[0].cadence, "once");
		assert.equal(observed.monitors[0].interval, "once");
		assert.equal(
			JSON.stringify(frontend),
			wireBefore,
			"locale switches cannot mutate wire state",
		);
		assert.equal(frontend.wakes[0].every_ms, null);
		assert.equal(frontend.monitors[0].every_ms, null);
		console.log(
			"C1: same mounted root + identical frontend: once/once -> une fois/une fois -> once/once; wire unchanged",
		);
	} finally {
		renderer.act(() => root.unmount());
		renderer.setLocale("en");
	}
});

test("existing untitled projection refreshes after delayed MAIN locale resolution; cleanup and destroyed-window guards hold", async () => {
	main.setLocale("en");
	const events = new Set();
	let reads = 0;
	let sends = 0;
	let destroyed = false;
	const rawTab = Object.freeze({
		tabId: 1,
		title: "about:blank",
		url: "about:blank",
	});
	window.api = {
		browser: {
			state: async () => {
				reads++;
				return { tabs: [{ ...rawTab, title: main.tabTitle(rawTab) }] };
			},
			onStateChanged: (fn) => {
				events.add(fn);
				return () => events.delete(fn);
			},
			onConsentChanged: () => () => {},
		},
	};
	const cleanup = [];
	main.connect(
		{
			window: {
				isDestroyed: () => destroyed,
				webContents: {
					isDestroyed: () => false,
					send: (event) => {
						assert.equal(event, "browser-state-changed");
						sends++;
						for (const fn of events) fn();
					},
				},
			},
		},
		{ add: (fn) => cleanup.push(fn) },
	);
	const off = renderer.subscribeBrowserProjection(() => {});
	await renderer.refreshBrowserProjection();
	const shown = () => renderer.readBrowserProjection().state.tabs[0].title;
	try {
		assert.equal(shown(), "New tab");
		renderer.setLocale("fr");
		assert.equal(
			shown(),
			"New tab",
			"renderer-first negotiation cannot guess main's later answer",
		);
		let resolve;
		const owner = main.createMainLocale({
			app: null,
			log: () => {},
			request: () =>
				new Promise((done) => {
					resolve = done;
				}),
		});
		const pending = owner.refresh();
		const before = reads;
		resolve({
			status: 200,
			body: { result: { language: "fr", features: { i18n: 1 } } },
		});
		await pending;
		await Promise.resolve();
		assert.equal(shown(), "Nouvel onglet");
		assert.ok(
			reads > before,
			"main's completed locale change must publish an invalidation",
		);
		main.setLocale("en");
		await Promise.resolve();
		assert.equal(shown(), "New tab");
		assert.equal(rawTab.title, "about:blank");
		assert.equal(rawTab.url, "about:blank");
		assert.equal(
			main.tabTitle({ title: "Remote document title" }),
			"Remote document title",
		);
		destroyed = true;
		const prior = sends;
		main.setLocale("fr");
		assert.equal(sends, prior, "no IPC to a destroyed window");
		for (const dispose of cleanup) dispose();
		destroyed = false;
		main.setLocale("en");
		assert.equal(sends, prior, "rollback/stop removes the locale listener");
		console.log(
			"C2: existing projection New tab -> renderer fr (still New tab) -> main fr resolves (Nouvel onglet) -> main en (New tab); raw title/url unchanged; teardown silent",
		);
	} finally {
		for (const dispose of cleanup) dispose();
		off();
		renderer.setLocale("en");
		main.setLocale("en");
		window.api = undefined;
	}
});
