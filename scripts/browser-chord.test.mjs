import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { build, transform } from "esbuild";

const SHARED_MENU_OWNER = /ownsChrome,/;
const GUARDED_CHROME_INPUT = /chords\.chromeInput\(event, input\)/;
const BLUR_RESETS_SUPPRESSION_ONLY =
	/window\.on\("blur", resetMenuShortcutSuppression\)/;

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
const {
	browserChromeOwnsChord,
	browserPageOwnsChord,
	createBrowserChordRouter,
	runBrowserMenuAction,
} = await moduleAt("src/main/browser/browser-chord.ts");
const { TabRegistry } = await moduleAt("src/main/browser/registry.ts");

// WHY this lives above the first test(): `input` was previously declared at
// module scope AFTER the first test() registration, so a test callback that
// ran before module evaluation reached that declaration hit the temporal
// dead zone (ReferenceError: Cannot access 'input' before initialization).
// Whether the callback won that race varied run to run, which made the suite
// intermittently red on an unchanged file. This helper closes over nothing
// declared later, so hoisting the identical definition above its first use
// removes the race without changing what any test asserts. The pre-move blob
// was identical on main and on unrelated PR heads, so those failures were
// this latent ordering bug, not a regression introduced by any such PR.
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

// Execute the actual production entries without booting index.ts/Electron.
// Exact, uniquely delimited source keeps this coupled to the reached caller, not a lookalike that
// merely reasserts the router predicate (the missing coverage behind review R1).
async function productionChromeDoors(activeHost, ownsChrome, suppression) {
	const source = readFileSync("src/main/browser/index.ts", "utf8");
	const unique = (marker) => {
		const at = source.indexOf(marker);
		assert.ok(
			at >= 0 && source.indexOf(marker, at + marker.length) < 0,
			`unique production marker required: ${marker}`,
		);
		return at;
	};
	const early = source.slice(
		unique("export function routeBrowserZoomInput("),
		unique("export function routeBrowserMenu("),
	);
	const later = source.slice(
		unique("const onChromeInput ="),
		unique("const resetChordFocus ="),
	);
	const compiled = await transform(`${early}\nexport ${later}`, {
		loader: "ts",
		format: "cjs",
		target: "node22",
	});
	const module = { exports: {} };
	new Function(
		"module",
		"exports",
		"activeHost",
		"browserChordIntent",
		"process",
		"chords",
		"ownsChrome",
		"options",
		compiled.code,
	)(
		module,
		module.exports,
		activeHost,
		browserChordIntent,
		{ platform: "darwin" },
		activeHost?.chords,
		ownsChrome,
		{
			window: {
				webContents: {
					setIgnoreMenuShortcuts: (value) => suppression.push(value),
				},
			},
		},
	);
	return module.exports;
}

test("R1 actual earlier zoom door and later chrome handler share guarded ownership, not a retained raw flag", async (t) => {
	for (const context of [
		"foreground",
		"inactive",
		"hidden",
		"chrome-hidden",
		"modal",
		"destroyed",
		"foreign",
		"no-host",
	]) {
		const facts = {
			logicalFocus: true,
			chromeVisible: !["chrome-hidden", "modal"].includes(context),
		};
		const native = {
			isDestroyed: () => context === "destroyed",
			isVisible: () => {
				assert.notEqual(context, "destroyed");
				return context !== "hidden";
			},
			isFocused: () => !["inactive", "foreign"].includes(context),
		};
		const ownsChrome = () =>
			browserChromeOwnsChord({ ...facts, window: native });
		const mutations = [];
		const suppression = [];
		const router = createBrowserChordRouter({
			platform: "darwin",
			ownsChrome,
			ownsPage: () => false,
			reload: () => mutations.push(["reload", 3]),
			zoom: (command) => mutations.push(["zoom", 3, command]),
			history: () => {},
			send: (message) => mutations.push([message.intent, 3]),
			focusChrome: () => {},
		});
		const host =
			context === "no-host"
				? null
				: { chords: router, host: { chordFocus: true } };
		const doors = await productionChromeDoors(host, ownsChrome, suppression);
		const event = () => ({
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
		});
		const e = event();
		const handled = doors.routeBrowserZoomInput(e, input("="));
		const expected = context === "foreground";
		t.diagnostic(
			JSON.stringify({
				tier: "actual-production-source/fake-window-facts",
				context,
				guardedOwner: ownsChrome(),
				handled,
				zoomCallbacks: [...mutations],
			}),
		);
		assert.equal(
			handled,
			expected,
			`${context}: earlier production door must not trust raw logical=true`,
		);
		assert.deepEqual(mutations, expected ? [["zoom", 3, "in"]] : [], context);
		assert.equal(e.defaultPrevented, expected);
		if (host) {
			// This is the SAME event the second listener receives: no doubled zoom.
			doors.onChromeInput(e, input("="));
			assert.deepEqual(mutations, expected ? [["zoom", 3, "in"]] : [], context);
		}
		for (const flags of [{ isAutoRepeat: true }, { isComposing: true }]) {
			mutations.length = 0;
			assert.equal(
				doors.routeBrowserZoomInput(event(), input("=", flags)),
				expected,
				`${context}: rejection consumption preserved`,
			);
			assert.deepEqual(mutations, []);
		}
		for (const key of ["r", "t"]) {
			mutations.length = 0;
			const ordinary = event();
			assert.equal(
				doors.routeBrowserZoomInput(ordinary, input(key)),
				false,
				"non-zoom is never consumed by early app-zoom entry",
			);
			assert.equal(ordinary.defaultPrevented, false);
			if (host) doors.onChromeInput(ordinary, input(key));
			assert.deepEqual(
				mutations,
				expected ? [[key === "r" ? "reload" : "new-tab", 3]] : [],
				`${context}: R/T executed at most once by later door`,
			);
		}
	}
});

test("RT-only visibility uses actual registry setters, not absence of an active page", () => {
	const registry = new TabRegistry(() => {
		throw new Error("No native view may be created by this source control");
	});
	assert.equal(registry.activeTab, null);
	assert.equal(registry.chromeVisible, false);
	registry.setContentRect({ x: 0, y: 0, width: 400, height: 300 });
	assert.equal(
		registry.chromeVisible,
		true,
		"blank browser chrome still owns New tab",
	);
	registry.setViewVisible(false);
	assert.equal(
		registry.chromeVisible,
		false,
		"blocking-overlay intent refuses native shortcuts",
	);
	registry.setViewVisible(true);
	assert.equal(registry.chromeVisible, true);
	registry.setContentRect(null);
	assert.equal(
		registry.chromeVisible,
		false,
		"unmounted chrome never owns a shortcut",
	);
});

test("the browser's own state page hides the VIEW but keeps its shortcuts; an overlay takes them", () => {
	const registry = new TabRegistry(() => {
		throw new Error("No native view may be created by this source control");
	});
	registry.setContentRect({ x: 0, y: 0, width: 400, height: 300 });
	/*
	 * THE TWO FACTS THIS PINS APART. The browser surface hides the native view
	 * for its OWN state pages (start page, load-failure panel) so their DOM can
	 * paint, and reports `ownPage: true` with that hide. The chrome band is still
	 * on screen and still the browser, so the keys are the browser's. An overlay
	 * (`ownPage: false`) covers the chrome too, so they are not.
	 *
	 * Before this distinction existed the surface sent only `false`, main read
	 * it as "no chrome", and Cmd+L/T/R fell through to the app menu - where
	 * `app-reload` reloaded the WHOLE APP WINDOW from the start page.
	 */
	registry.setViewVisible(false, true);
	assert.equal(
		registry.chromeVisible,
		true,
		"a state page is the browser the user is looking at",
	);
	const effects = [];
	const router = createBrowserChordRouter({
		platform: "darwin",
		ownsChrome: () =>
			browserChromeOwnsChord({
				logicalFocus: true,
				chromeVisible: registry.chromeVisible,
				window: {
					isDestroyed: () => false,
					isVisible: () => true,
					isFocused: () => true,
				},
			}),
		ownsPage: () => false,
		reload: (hard) => effects.push(["reload", hard]),
		history: () => {},
		send: (m) => effects.push([m.intent, m.origin]),
		focusChrome: () => {},
	});
	for (const key of ["l", "t", "r"]) {
		const event = {
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};
		assert.equal(router.chromeInput(event, input(key)), true, key);
		assert.equal(
			event.defaultPrevented,
			true,
			`${key}: consumed, so the app menu accelerator never receives it`,
		);
	}
	assert.deepEqual(effects, [
		["focus-address", "chrome"],
		["new-tab", "chrome"],
		["reload", false],
	]);

	// NEGATIVE CONTROL: a real overlay still refuses every one of them.
	registry.setViewVisible(false, false);
	assert.equal(registry.chromeVisible, false);
	const before = effects.length;
	for (const key of ["l", "t", "r"]) {
		const event = {
			defaultPrevented: false,
			preventDefault() {
				this.defaultPrevented = true;
			},
		};
		assert.equal(router.chromeInput(event, input(key)), false, key);
		assert.equal(event.defaultPrevented, false, `${key}: not consumed`);
	}
	assert.deepEqual(effects.slice(before), []);
	assert.equal(router.menu("reload"), false);

	// A visible view with the reason still set is still just the browser.
	registry.setViewVisible(true);
	assert.equal(registry.chromeVisible, true);
	// ...and an unmounted surface owns nothing whatever the reason said.
	registry.setViewVisible(false, true);
	registry.setContentRect(null);
	assert.equal(registry.chromeVisible, false);
});

const { chordTarget } = await moduleAt(
	"src/renderer/src/features/browser/model/tab-index-model.ts",
);
test("logical BODY/header ownership is never native authorization without real foreground chrome facts", () => {
	for (let mask = 0; mask < 32; mask++) {
		const facts = {
			logicalFocus: Boolean(mask & 1),
			chromeVisible: Boolean(mask & 2),
			windowVisible: Boolean(mask & 4),
			windowFocused: Boolean(mask & 8),
			destroyed: Boolean(mask & 16),
		};
		const eligibility = () =>
			browserChromeOwnsChord({
				logicalFocus: facts.logicalFocus,
				chromeVisible: facts.chromeVisible,
				window: {
					isDestroyed: () => facts.destroyed,
					isVisible: () => {
						assert.equal(
							facts.destroyed,
							false,
							"never read native methods on a destroyed window",
						);
						return facts.windowVisible;
					},
					isFocused: () => facts.windowFocused,
				},
			});
		const owned = eligibility();
		assert.equal(owned, mask === 15, JSON.stringify(facts));
		const effects = [];
		let prevented = 0;
		const router = createBrowserChordRouter({
			platform: "darwin",
			ownsChrome: eligibility,
			ownsPage: () => false,
			reload: (hard) => effects.push(["reload", hard]),
			history: () => {},
			send: (m) => effects.push([m.intent, m.origin]),
			focusChrome: () => {},
		});
		const event = {
			preventDefault() {
				prevented++;
			},
		};
		assert.equal(router.input(event, input("r"), "chrome", owned), owned);
		assert.equal(router.input(event, input("t"), "chrome", owned), owned);
		assert.equal(
			router.input(event, input("t"), "chrome", owned),
			owned,
			"genuine rapid presses are distinct, no clock debounce",
		);
		assert.equal(
			router.menu("reload"),
			owned,
			"app-menu alias reads the exact same owner",
		);
		assert.deepEqual(
			effects,
			owned
				? [
						["reload", false],
						["new-tab", "chrome"],
						["new-tab", "chrome"],
						["reload", false],
					]
				: [],
		);
		assert.equal(prevented, owned ? 3 : 0);
	}
	const facts = {
		logicalFocus: true,
		chromeVisible: true,
		visible: true,
		focused: false,
	};
	const effects = [];
	const route = createBrowserChordRouter({
		platform: "darwin",
		ownsChrome: () =>
			browserChromeOwnsChord({
				logicalFocus: facts.logicalFocus,
				chromeVisible: facts.chromeVisible,
				window: {
					isDestroyed: () => false,
					isVisible: () => facts.visible,
					isFocused: () => facts.focused,
				},
			}),
		ownsPage: () => false,
		reload: () => effects.push("reload"),
		history: () => {},
		send: (m) => effects.push(m.intent),
		focusChrome: () => {},
	});
	assert.equal(route.menu("reload"), false);
	facts.focused = true;
	assert.equal(route.menu("reload"), true);
	assert.deepEqual(
		effects,
		["reload"],
		"same logical browser context returns without another focus IPC",
	);
	facts.logicalFocus = false;
	assert.equal(
		route.menu("reload"),
		false,
		"chat/outside ownership clears the retained claim",
	);
	assert.deepEqual(effects, ["reload"]);
	const source = readFileSync("src/main/browser/index.ts", "utf8");
	assert.match(source, SHARED_MENU_OWNER);
	assert.match(source, GUARDED_CHROME_INPUT);
	assert.ok(
		source.includes("activeHost.chords.chromeInput(event, input)"),
		"earlier zoom caller uses the same guarded entry",
	);
	assert.match(
		source,
		BLUR_RESETS_SUPPRESSION_ONLY,
		"OS blur clears shortcut suppression, not logical DOM ownership",
	);
	for (const lifetime of ["render-process-gone", "closed"])
		assert.ok(
			source.includes(`"${lifetime}", resetChordFocus`),
			"renderer/window destruction still forgets ownership",
		);
});

test("one platform-strict decision table covers every browser column and leaves chat to app", () => {
	const rows = [
		["f", {}, "find-page"],
		["+", {}, "zoom-in"],
		["=", {}, "zoom-in"],
		["-", {}, "zoom-out"],
		["0", {}, "zoom-reset"],
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
	for (const key of ["p", "o", "a", "c", "v"])
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
test("page ownership accepts the view's own focus fact when getFocusedWebContents answers null", () => {
	const activeTab = { tabId: 7, webContentsId: 21, presented: true };
	const foreground = (overrides = {}) => ({
		isDestroyed: () => false,
		isVisible: () => true,
		isFocused: () => true,
		...overrides,
	});
	assert.equal(
		browserPageOwnsChord({
			activeTab,
			focusedContents: () => 21,
			focusedViewTabId: null,
			window: foreground(),
		}),
		true,
		"the documented focused-contents fact still owns the page",
	);
	// Measured on Electron 44.3.0: page.focus() emits the view's focus event while
	// getFocusedWebContents() stays null in a not-yet-activated window.
	assert.equal(
		browserPageOwnsChord({
			activeTab,
			focusedContents: () => null,
			focusedViewTabId: 7,
			window: foreground(),
		}),
		true,
		"a view's tracked focus owns the page when the getter is null",
	);
	assert.equal(
		browserPageOwnsChord({
			activeTab,
			focusedContents: () => null,
			focusedViewTabId: 8,
			window: foreground(),
		}),
		false,
		"a stale focus fact for another tab never routes into the active page",
	);
	assert.equal(
		browserPageOwnsChord({
			activeTab: { ...activeTab, presented: false },
			focusedContents: () => 21,
			focusedViewTabId: 7,
			window: foreground(),
		}),
		false,
		"a hidden/suppressed page is never the accelerator owner",
	);
	assert.equal(
		browserPageOwnsChord({
			activeTab: null,
			focusedContents: () => 21,
			focusedViewTabId: 7,
			window: foreground(),
		}),
		false,
		"no active tab is no page owner",
	);
	// THE SAME WINDOW FLOOR AS CHROME OWNERSHIP (review M1): a stale focus fact is
	// never authorization for a destroyed, hidden or unfocused window.
	for (const [label, windowFacts] of [
		["destroyed", foreground({ isDestroyed: () => true })],
		["hidden", foreground({ isVisible: () => false })],
		["unfocused", foreground({ isFocused: () => false })],
	]) {
		assert.equal(
			browserPageOwnsChord({
				activeTab,
				focusedContents: () => 21,
				focusedViewTabId: 7,
				window: windowFacts,
			}),
			false,
			`a ${label} window never routes a page accelerator`,
		);
	}
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
	/*
	 * NO CALLBACK WINDOW IS NOT "NO OWNER". A focused WebContentsView can reach an
	 * accelerator with `target` undefined; the browser's native route is asked
	 * first, and only when it declines does the missing target mean no action.
	 */
	runBrowserMenuAction("reload", null, main, route);
	assert.equal(calls.at(-1), "browser:reload");
	const count = calls.length;
	runBrowserMenuAction("reload", null, main, () => false);
	assert.equal(calls.length, count);
});

test("Cmd+T has a native menu route that never falls through to a window action", () => {
	const calls = [];
	const main = {
		webContents: {
			reload: () => calls.push("main:reload"),
			reloadIgnoringCache: () => calls.push("main:hard"),
		},
		close: () => calls.push("main:close"),
	};
	assert.equal(
		runBrowserMenuAction("new-tab", main, main, (intent) => {
			calls.push(`browser:${intent}`);
			return true;
		}),
		undefined,
	);
	assert.deepEqual(calls, ["browser:new-tab"]);
	// Outside browser ownership, Cmd+T must do nothing: the old fallback branch
	// would have closed the window for any intent that was not reload/close-tab.
	calls.length = 0;
	runBrowserMenuAction("new-tab", main, main, () => false);
	assert.deepEqual(calls, []);
	// With no callback window the browser route still wins when it owns the key.
	const nullTargetRoutes = [];
	runBrowserMenuAction("new-tab", null, main, (intent) => {
		nullTargetRoutes.push(intent);
		return true;
	});
	assert.deepEqual(nullTargetRoutes, ["new-tab"]);
	assert.deepEqual(calls, []);
});

test("tab digits fall back to the physical key on layouts whose digit row types symbols (review R11)", () => {
	// AZERTY: key is "&" with code Digit1; no shift is held, so ordinals work.
	assert.equal(
		browserChordIntent(input("&", { code: "Digit1" }), "darwin"),
		"tab-1",
	);
	assert.equal(
		browserChordIntent(input("\u00e0", { code: "Digit9" }), "darwin"),
		"tab-9",
	);
	// The fallback is digits only, and never beats a held Alt or the wrong modifier.
	assert.equal(
		browserChordIntent(input("&", { code: "KeyA" }), "darwin"),
		null,
	);
	assert.equal(
		browserChordIntent(input("&", { code: "Digit1", alt: true }), "darwin"),
		null,
	);
	assert.equal(
		browserChordIntent(
			input("&", { code: "Digit1", meta: false, control: true }),
			"darwin",
		),
		null,
	);
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
	for (const id of [
		"app-new-tab",
		"app-reload",
		"app-force-reload",
		"app-close",
	])
		assert.ok(app.includes(`id: "${id}"`));
	// Cmd+T now has a native menu route, and it goes through the browser owner
	// predicate rather than a window role (the missing item was the T gap).
	assert.match(
		app,
		/id: "app-new-tab",[\s\S]{0,900}?accelerator: "CmdOrCtrl\+T"[\s\S]{0,900}?runBrowserMenuAction\(\s*"new-tab"/,
	);
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

test("find/zoom share focus classifier with platform/Alt/IME/repeat negatives", () => {
	for (const key of ["f", "+", "=", "-", "0"]) {
		assert.ok(browserChordIntent(input(key), "darwin"));
		for (const flags of [
			{ alt: true },
			{ isComposing: true },
			{ isAutoRepeat: true },
			{ control: true },
			{ meta: false, control: true },
		])
			assert.equal(browserChordIntent(input(key, flags), "darwin"), null);
		assert.ok(
			browserChordIntent(input(key, { meta: false, control: true }), "win32"),
		);
	}
});

test("native zoom routing never takes the page caret through chrome", () => {
	const zooms = [];
	let focused = 0;
	let sent = 0;
	const router = createBrowserChordRouter({
		platform: "darwin",
		ownsChrome: () => false,
		ownsPage: () => true,
		reload: () => {},
		history: () => {},
		zoom: (command) => zooms.push(command),
		send: () => sent++,
		focusChrome: () => focused++,
	});
	let prevented = 0;
	const event = { preventDefault: () => prevented++ };
	router.input(event, input("+"), "page", true);
	router.menu("zoom-reset");
	assert.deepEqual(zooms, ["in", "reset"]);
	assert.equal(focused, 0);
	assert.equal(sent, 0);
	assert.equal(prevented, 1);
});
