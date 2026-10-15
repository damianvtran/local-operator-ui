import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build } from "esbuild";

// In-memory compilation exercises shipped TypeScript without writing generated
// modules into a checkout or allocating another dependency tree.
async function moduleAt(file) {
	const result = await build({
		entryPoints: [file],
		bundle: true,
		write: false,
		platform: "node",
		format: "esm",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
	);
}
const { browserChordIntent } = await moduleAt("src/shared/browser-chord.ts");
const { createBrowserChordRouter, runBrowserMenuAction } = await moduleAt(
	"src/main/browser/browser-chord.ts",
);
const { chordTarget } = await moduleAt(
	"src/renderer/src/features/browser/model/tab-index-model.ts",
);
const input = (key, overrides = {}) => ({
	type: "keyDown",
	key,
	meta: true,
	control: false,
	alt: false,
	shift: false,
	isAutoRepeat: false,
	isComposing: false,
	...overrides,
});

test("one platform-strict decision table covers every browser column and leaves chat to app", () => {
	const rows = [
		["r", {}, "reload"],
		["R", { shift: true }, "hard-reload"],
		["l", {}, "focus-address"],
		["t", {}, "new-tab"],
		["T", { shift: true }, "reopen-tab"],
		["w", {}, "close-tab"],
		["[", {}, "back"],
		["]", {}, "forward"],
		["1", {}, "tab-1"],
		["8", {}, "tab-8"],
		["9", {}, "tab-9"],
		["Tab", { meta: false, control: true }, "next-tab"],
		["Tab", { meta: false, control: true, shift: true }, "prev-tab"],
	];
	for (const platform of ["darwin", "win32", "linux"])
		for (const [key, flags, intent] of rows) {
			const mods =
				key === "Tab"
					? {}
					: platform === "darwin"
						? {}
						: { meta: false, control: true };
			const event = input(key, { ...mods, ...flags });
			assert.equal(
				browserChordIntent(event, platform),
				intent,
				`${platform} ${key}`,
			);
			for (const origin of ["page", "chrome"]) {
				let count = 0;
				const router = createBrowserChordRouter({
					platform,
					ownsChrome: () => false,
					ownsPage: () => false,
					reload: () => count++,
					history: () => count++,
					send: () => count++,
					focusChrome: () => {},
				});
				assert.equal(
					router.input({ preventDefault() {} }, event, origin, false),
					false,
				);
				assert.equal(count, 0);
				assert.equal(
					router.input({ preventDefault() {} }, event, origin, true),
					true,
				);
				assert.equal(count, 1);
			}
		}
	for (const key of ["{", "["])
		assert.equal(
			browserChordIntent(input(key, { shift: true }), "darwin"),
			"prev-tab",
		);
	for (const key of ["}", "]"])
		assert.equal(
			browserChordIntent(input(key, { shift: true }), "darwin"),
			"next-tab",
		);
});
test("negative controls preserve composition/editing, platform modifiers, and reject action repeat", () => {
	for (const flags of [
		{ alt: true },
		{ isComposing: true },
		{ type: "keyUp" },
		{ type: "char" },
		{ isAutoRepeat: true },
		{ control: true },
		{ meta: false, control: true },
	])
		assert.equal(browserChordIntent(input("r", flags), "darwin"), null);
	for (const platform of ["linux", "win32"])
		assert.equal(browserChordIntent(input("r"), platform), null);
	for (const key of ["f", "p", "+", "-", "0", "o", "a", "c", "v"])
		assert.equal(browserChordIntent(input(key), "darwin"), null);
	assert.equal(
		browserChordIntent(
			input("Tab", { meta: false, control: true, isAutoRepeat: true }),
			"darwin",
		),
		"next-tab",
	);
});
test("router menu fallback ownership and rapid genuine presses have no debounce", () => {
	let chrome = false;
	let page = false;
	const actions = [];
	const r = createBrowserChordRouter({
		platform: "darwin",
		ownsChrome: () => chrome,
		ownsPage: () => page,
		reload: (hard) => actions.push(hard ? "hard" : "reload"),
		history: (d) => actions.push(d),
		send: (m) => actions.push(m.intent),
		focusChrome: () => {},
	});
	assert.equal(r.menu("reload"), false);
	chrome = true;
	assert.equal(r.menu("reload"), true);
	let prevented = 0;
	for (let i = 0; i < 2; i++)
		r.input(
			{
				preventDefault() {
					prevented++;
				},
			},
			input("r"),
			"chrome",
			true,
		);
	assert.equal(prevented, 2);
	assert.deepEqual(actions, ["reload", "reload", "reload"]);
	chrome = false;
	assert.equal(r.menu("close-tab"), false);
	page = true;
	assert.equal(r.menu("close-tab"), true);
	assert.equal(
		r.input(
			{
				preventDefault() {
					throw Error("hidden claimed");
				},
			},
			input("r"),
			"page",
			false,
		),
		false,
	);
});
test("menu fallback respects actual popup/mini target even with stale main chrome focus", () => {
	const calls = [];
	const window = (name) => ({
		webContents: {
			reload: () => calls.push(`${name}:reload`),
			reloadIgnoringCache: () => calls.push(`${name}:hard`),
		},
		close: () => calls.push(`${name}:close`),
	});
	const main = window("main");
	const popup = window("popup");
	const route = (intent) => {
		calls.push(`browser:${intent}`);
		return true;
	};
	for (const intent of ["reload", "hard-reload", "close-tab"])
		runBrowserMenuAction(intent, popup, main, route);
	assert.deepEqual(calls, ["popup:reload", "popup:hard", "popup:close"]);
	runBrowserMenuAction("reload", main, main, route);
	assert.equal(calls.at(-1), "browser:reload");
	runBrowserMenuAction("close-tab", main, main, () => false);
	assert.equal(calls.at(-1), "main:close");
	const count = calls.length;
	runBrowserMenuAction("reload", null, main, route);
	assert.equal(calls.length, count);
});

test("ordinal/cycle use the grouped scoped strip order, never registry order", () => {
	const tabs = [
		{ tabId: 1, sessionId: "a" },
		{ tabId: 2, sessionId: null },
		{ tabId: 3, sessionId: "b" },
		{ tabId: 4, sessionId: "a" },
	];
	assert.equal(chordTarget(tabs, 1, "tab-2"), 4);
	assert.equal(chordTarget(tabs, 1, "tab-9"), 2);
	assert.equal(chordTarget(tabs, 1, "prev-tab"), 2);
	assert.equal(chordTarget(tabs, 2, "next-tab"), 1);
	assert.equal(
		chordTarget(
			tabs.filter((t) => t.sessionId === "a"),
			1,
			"tab-3",
		),
		null,
	);
});
test("owned menu aliases replace destructive roles; suppression is per input and focus teardown is explicit", () => {
	const app = readFileSync("src/main/index.ts", "utf8");
	const browser = readFileSync("src/main/browser/index.ts", "utf8");
	for (const role of ["reload", "forceReload", "close"])
		assert.ok(!app.includes(`role: "${role}"`));
	for (const id of ["app-reload", "app-force-reload", "app-close"])
		assert.ok(app.includes(`id: "${id}"`));
	assert.match(browser, /setIgnoreMenuShortcuts\(handled\)/);
	assert.match(browser, /host\.clearChordState\(\)/);
	assert.match(
		browser,
		/removeListener\(\s*"before-input-event",\s*onChromeInput,?\s*\)/,
	);
	const helper = readFileSync("src/main/window-raise.ts", "utf8");
	assert.match(
		helper,
		/show !== "focus"\s*\|\|\s*window\.isDestroyed\(\)\s*\|\|\s*!window\.isFocused\(\)/,
	);
	assert.ok(
		!readFileSync("src/main/browser/actions/input.ts", "utf8").includes(
			'"Input.dispatchKeyEvent"',
		),
	);
});
