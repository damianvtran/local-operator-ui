/**
 * The Keyboard shortcuts settings section, driven for real (#928).
 *
 *     node --test scripts/keyboard-shortcuts-section.test.mjs
 *
 * WHY THIS FILE EXISTS. The recorder is the one place a user arms a chord, and
 * every rule it carries is invisible in a still: capture commits, a refusal
 * KEEPS the previous value and says why, Reset deletes the override rather than
 * writing the default, an unset row says so. This file mounts the REAL section
 * against the REAL store in jsdom and presses real shapes at it — the rig
 * `panel-rail.test.mjs` documents — so the states a frame can only show are
 * also the states a suite can re-run.
 */

import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const ROOT = resolve(import.meta.dirname, "..");

const bootstrap = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrap.window;
globalThis.document = bootstrap.window.document;
globalThis.localStorage = bootstrap.window.localStorage;
globalThis.sessionStorage = bootstrap.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const EXTERNAL = /^(react|react-dom)(\/.*)?$/;
const BARE_SPECIFIER = /^[^./]/;
const CACHE = join(
	ROOT,
	"node_modules",
	".cache",
	"keyboard-shortcuts-section",
);
const bundle = await build({
	stdin: {
		contents: `
				export { KeyboardShortcutsSection } from "./src/renderer/src/features/settings/components/keyboard-shortcuts-section";
				export { useUiPreferencesStore } from "./src/renderer/src/shared/store/ui-preferences-store";
				export { RESERVED_CHORDS } from "./src/renderer/src/shared/keymap/keymap-registry";
				export { browserChordIntent } from "./src/shared/browser-chord";
		`,
		resolveDir: ROOT,
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	define: { "import.meta.env": "__viteEnv" },
	banner: {
		js: 'const __viteEnv = { VITE_LOCAL_OPERATOR_API_URL: "http://127.0.0.1:45999" };',
	},
	plugins: [
		{
			name: "react-stays-out",
			setup(builder) {
				builder.onResolve({ filter: BARE_SPECIFIER }, (args) =>
					EXTERNAL.test(args.path) ? { path: args.path, external: true } : null,
				);
			},
		},
	],
	loader: { ".css": "empty" },
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	write: false,
});
mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "section.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	KeyboardShortcutsSection,
	useUiPreferencesStore,
	RESERVED_CHORDS,
	browserChordIntent,
} = await import(pathToFileURL(bundlePath).href);

const FIELD_SELECTOR = (label) =>
	`input[aria-label="${label}: press the keys you want"]`;
const RESET_SELECTOR = (label) =>
	`button[aria-label="Reset ${label} to its default"]`;
const CLEAR_SELECTOR = (label) =>
	`button[aria-label="Clear ${label}'s shortcut"]`;

/** One keydown, as the browser would dispatch it at the field. Returns
 * `dispatchEvent`'s answer — `false` means the recorder claimed the press
 * (`preventDefault` ran), `true` means the press travels on (F5: the claimed
 * half is what keeps the router from answering the same press). */
const pressKey = (element, init) => {
	let dispatched;
	act(() => {
		dispatched = element.dispatchEvent(
			new window.KeyboardEvent("keydown", {
				bubbles: true,
				cancelable: true,
				...init,
			}),
		);
	});
	return dispatched;
};

async function mount(run, chrome) {
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	const shims = {
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		Element: window.Element,
		Node: window.Node,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
		IS_REACT_ACT_ENVIRONMENT: true,
	};
	for (const [key, value] of Object.entries(shims)) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const root = createRoot(window.document.getElementById("root"));
	const api = {
		window,
		$: (selector) => window.document.querySelector(selector),
		$$: (selector) => [...window.document.querySelectorAll(selector)],
		outputs: () =>
			[...window.document.querySelectorAll("output")].map((o) => o.textContent),
		store: (patch) => {
			act(() => {
				useUiPreferencesStore.setState(patch);
			});
		},
	};
	act(() => {
		useUiPreferencesStore.setState({ shortcutBindings: {} });
	});
	/*
	 * The chrome facts, when a cell needs a platform other than the fallback:
	 * `rendererPlatform()` reads `window.api` at render time, so the stub has to
	 * exist BEFORE the render — the mac cell proves the refusal sentence follows
	 * the machine (U5).
	 */
	if (chrome) window.api = { windowChrome: { facts: () => chrome } };
	act(() => {
		root.render(React.createElement(KeyboardShortcutsSection, {}));
	});
	await act(async () => {});
	try {
		await run(api, window);
	} finally {
		act(() => root.unmount());
		await act(async () => {});
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

test("one row per action: the labels, the default chord, and the unset state", async () => {
	await mount(async (api) => {
		for (const label of [
			"Console",
			"Canvas",
			"Run details",
			"Asks",
			"Browser",
			"Code review",
		]) {
			assert.ok(api.$(FIELD_SELECTOR(label)), `the ${label} row must exist`);
		}
		/* The test host has no chrome facts, so the platform resolves `linux` —
		   the display tables' own fallback, same as everywhere else in this tree. */
		assert.equal(api.$(FIELD_SELECTOR("Console")).value, "Ctrl+J");
		assert.equal(api.$(FIELD_SELECTOR("Canvas")).value, "Ctrl+Shift+C");
		for (const label of ["Run details", "Asks", "Browser", "Code review"]) {
			assert.equal(api.$(FIELD_SELECTOR(label)).value, "No shortcut");
		}
		/*
		 * No overrides, so no Reset anywhere — but the two DEFAULTED rows offer
		 * Clear (U4: a defaulted action must be releasable), and the four rows
		 * that ship unbound have nothing to clear.
		 */
		assert.equal(api.$$("button").length, 2);
		assert.ok(api.$(CLEAR_SELECTOR("Console")));
		assert.ok(api.$(CLEAR_SELECTOR("Canvas")));
		for (const label of ["Run details", "Asks", "Browser", "Code review"]) {
			assert.equal(
				api.$(CLEAR_SELECTOR(label)),
				null,
				`an unbound ${label} has nothing to clear`,
			);
		}
	});
});

test("capture commits: the chord is written, displayed, and Reset appears", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		const claimed = pressKey(field, { key: "u", metaKey: true });
		assert.equal(
			claimed,
			false,
			"the recorder CLAIMS the accepted press (F5): `defaultPrevented` is what keeps the router from answering the same press",
		);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {
			"panel.console": "primary+u",
		});
		assert.equal(field.value, "Ctrl+U");
		assert.ok(api.$(RESET_SELECTOR("Console")), "an override shows Reset");
	});
});

test("a conflict KEEPS the previous value and names the holder", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		const claimed = pressKey(field, {
			key: "c",
			metaKey: true,
			shiftKey: true,
		});
		assert.equal(
			claimed,
			false,
			"the recorder claims the refused press too (F5) — the claim is the recorder's, before any refusal verdict",
		);
		assert.deepEqual(
			useUiPreferencesStore.getState().shortcutBindings,
			{},
			"a refused capture must not write",
		);
		assert.equal(field.value, "Ctrl+J", "the previous value is kept");
		assert.deepEqual(api.outputs(), ["Already assigned to Open canvas."]);
	});
});

test("a reserved chord is refused with its own sentence", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "n", metaKey: true });
		assert.deepEqual(api.outputs(), ["Reserved: starts a new chat."]);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/* A bare key asks for a modifier instead — in the register this machine
		   reads (U5): the test host has no chrome facts, so `linux` answers. */
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
	});
});

test("the review round's four newly-reserved chords are refused by name at the field", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		/*
		 * Review F1 = QA Q1: these four were left assignable on a rationale the
		 * app's phase order falsifies (the canvas editors listen on `window`, and
		 * the pin-move returns skip `preventDefault`), so capture must refuse each
		 * with the sentence naming the job — read at a real field, which is where
		 * a user meets it.
		 */
		const cells = [
			[{ key: "s", metaKey: true }, "Reserved: saves the canvas document."],
			[{ key: "o", metaKey: true }, "Reserved: opens a file in the canvas."],
			[
				{ key: "ArrowUp", metaKey: true, shiftKey: true },
				"Reserved: moves the focused chat up the pinned order.",
			],
			[
				{ key: "ArrowDown", metaKey: true, shiftKey: true },
				"Reserved: moves the focused chat down the pinned order.",
			],
		];
		for (const [press, sentence] of cells) {
			pressKey(field, press);
			assert.deepEqual(api.outputs(), [sentence], JSON.stringify(press));
			assert.deepEqual(
				useUiPreferencesStore.getState().shortcutBindings,
				{},
				`${JSON.stringify(press)} must not write`,
			);
			assert.equal(field.value, "Ctrl+J", "the previous value is kept");
		}
	});
});

test("re-pressing the row's own chord records nothing; pressing its default clears the override (U3)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		/* The chord the row already shows, with no override: no write, no Reset. */
		pressKey(field, { key: "j", metaKey: true });
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(api.$(RESET_SELECTOR("Console")), null, "nothing to reset");
		/* With an override, pressing the DEFAULT deletes it — the map never
		   stores a value identical to the default. */
		api.store({ shortcutBindings: { "panel.console": "primary+u" } });
		assert.equal(field.value, "Ctrl+U");
		pressKey(field, { key: "j", metaKey: true });
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(field.value, "Ctrl+J");
		assert.equal(
			api.$(RESET_SELECTOR("Console")),
			null,
			"Reset leaves with the override",
		);
	});
});

test("Clear stores the explicit no-chord state; Reset restores the default (U4)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		const clear = api.$(CLEAR_SELECTOR("Console"));
		assert.ok(clear, "a defaulted action offers Clear");
		/* The real keyboard path: the focused button deletes itself, and the
		   successor must not be `<body>` (the U2 class of defect). */
		act(() => {
			clear.focus();
		});
		act(() => {
			clear.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {
			"panel.console": null,
		});
		assert.equal(field.value, "No shortcut");
		assert.equal(
			api.window.document.activeElement,
			field,
			"Clear hands focus back to the field",
		);
		const reset = api.$(RESET_SELECTOR("Console"));
		assert.ok(reset, "the cleared row offers Reset");
		act(() => {
			reset.focus();
		});
		act(() => {
			reset.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(field.value, "Ctrl+J");
		assert.equal(
			api.window.document.activeElement,
			field,
			"Reset hands focus back too (U2): it deletes itself, so <body> must not inherit the caret",
		);
	});
});

test("the needs-a-modifier sentence follows the platform (U5)", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Console"));
		act(() => {
			field.focus();
		});
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
	});
	await mount(
		async (api) => {
			const field = api.$(FIELD_SELECTOR("Console"));
			act(() => {
				field.focus();
			});
			/* macOS keeps both spellings: `primary` is meta OR ctrl there. */
			pressKey(field, { key: "u" });
			assert.deepEqual(api.outputs(), ["A shortcut needs ⌘ or Ctrl."]);
		},
		{ platform: "mac" },
	);
});

test("Reset deletes the override and restores the default", async () => {
	await mount(async (api) => {
		api.store({ shortcutBindings: { "panel.browser": "primary+i" } });
		assert.equal(api.$(FIELD_SELECTOR("Browser")).value, "Ctrl+I");
		const reset = api.$(RESET_SELECTOR("Browser"));
		assert.ok(reset);
		act(() => {
			reset.dispatchEvent(
				new window.MouseEvent("click", { bubbles: true, cancelable: true }),
			);
		});
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		assert.equal(api.$(FIELD_SELECTOR("Browser")).value, "No shortcut");
		assert.equal(
			api.$(RESET_SELECTOR("Browser")),
			null,
			"Reset left once unset",
		);
	});
});

test("keyboard-only: the field records, Tab navigates, Escape parks the cue without dropping focus", async () => {
	await mount(async (api) => {
		const field = api.$(FIELD_SELECTOR("Asks"));
		assert.notEqual(field.getAttribute("tabindex"), "-1");
		act(() => {
			field.focus();
		});
		assert.equal(
			api.window.document.activeElement,
			field,
			"focus is the recording state",
		);
		/* The hint appears with the recording state. */
		const hint = () =>
			[...api.window.document.querySelectorAll("span")].find(
				(s) => s.textContent === "Press the keys you want; Esc cancels.",
			);
		assert.ok(hint(), "the recording hint appears while the field is focused");
		/* A modifier alone is not a candidate and not a refusal. */
		pressKey(field, { key: "Meta", metaKey: true });
		assert.deepEqual(api.outputs(), []);
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/*
		 * U1: Tab is LEFT TO THE BROWSER — no refusal, no `preventDefault` — so the
		 * press moves focus as it does anywhere else (jsdom does not implement the
		 * move itself, so the readback here is that the press travelled on
		 * UNCONSUMED and was not answered; QA walks the real move).
		 */
		assert.equal(
			pressKey(field, { key: "Tab" }),
			true,
			"Tab must not be preventDefaulted",
		);
		assert.deepEqual(api.outputs(), [], "Tab is not a refusal");
		/*
		 * U2: Escape ends the recording CUE and keeps focus on the field — the blur
		 * this replaced dropped the caret to `<body>` and sent the next Tab back to
		 * the top of the page.
		 */
		pressKey(field, { key: "Escape" });
		assert.equal(
			api.window.document.activeElement,
			field,
			"Escape never drops focus to <body>",
		);
		assert.equal(hint(), undefined, "the cue leaves with the edit");
		assert.deepEqual(useUiPreferencesStore.getState().shortcutBindings, {});
		/* ...and the next captured key re-arms the cue rather than binding blind. */
		pressKey(field, { key: "u" });
		assert.deepEqual(api.outputs(), ["A shortcut needs Ctrl."]);
		assert.ok(hint(), "the next capture re-arms the cue");
	});
});

/*
 * THE BROWSER'S SCOPE (LOH-13), driven from the one table that spells a browser
 * chord. `browser-chord.ts` is where a browser chord acquires its meaning, so a
 * chord added there is a chord whose Settings sentence must tell the reader how
 * to reach it — this cell asks that table rather than re-listing the chords.
 *
 * A chord is DUAL-SCOPE when the app answers it OUTSIDE the browser too: the
 * application menu's window close, the transcript search, chat-region walking
 * and app zoom all live outside this registry (and outside any one table), so
 * their five surfaces are named here. Everything else the browser claims is
 * browser-ONLY, and a refusal sentence for a browser-only chord that does not
 * end with the instruction leaves the reader with "the shortcut is broken".
 */
/* The copy this change owns, as top-level literals (biome's
 * `useTopLevelRegex`): one instruction ending and the paragraph's three claims. */
const FOCUS_INSTRUCTION_TAIL = /Focus the browser first\.$/;
const SCOPE_WHERE = /browser pane or a page inside it has focus/;
const SCOPE_REASON =
	/must not take those chords away from the rest of the interface/;
const SCOPE_INSTRUCTION = /To use one, focus the browser first\.$/;

const PUNCTUATION_KEYS = new Map([
	["plus", "+"],
	["=", "="],
	["-", "-"],
]);

/** The chord table's own input shape for a canonical chord, on one platform. */
const chordInput = (chord, platform) => {
	const tokens = chord.split("+");
	const last = tokens[tokens.length - 1];
	const modifiers = new Set(tokens.slice(0, -1));
	return {
		type: "keyDown",
		key: PUNCTUATION_KEYS.get(last) ?? last,
		meta: platform === "darwin" && modifiers.has("primary"),
		control: platform === "linux" && modifiers.has("primary"),
		alt: modifiers.has("alt"),
		shift: modifiers.has("shift"),
	};
};

const browserClaims = (chord) =>
	["darwin", "linux"].some(
		(platform) =>
			browserChordIntent(chordInput(chord, platform), platform) !== null,
	);

const DUAL_SCOPE = new Set([
	// Menu: closes the window outside the browser.
	"primary+w",
	/*
	 * Menu "Reload"/"Force Reload": `runBrowserMenuAction` falls THROUGH to
	 * `webContents.reload()`/`reloadIgnoringCache()` on the callback window when
	 * the browser does not own the chord, so outside the browser these reload the
	 * whole app window rather than nothing. They were wrongly pinned as
	 * browser-only, which is the claim that loses a user their renderer.
	 */
	"primary+r",
	"primary+shift+r",
	// Transcript search outside the browser.
	"primary+f",
	// Chat navigation outside the browser.
	"primary+[",
	"primary+]",
	// App zoom outside the browser.
	"primary+0",
	"primary+-",
	"primary+plus",
	"primary+=",
]);

const BROWSER_ONLY = [...RESERVED_CHORDS.keys()]
	.filter((chord) => browserClaims(chord) && !DUAL_SCOPE.has(chord))
	.sort();

const BROWSER_ONLY_EXPECTED = [
	...["1", "2", "3", "4", "5", "6", "7", "8", "9"].map(
		(digit) => `primary+${digit}`,
	),
	"primary+l",
	"primary+shift+t",
	"primary+t",
].sort();

test("every browser-owning reserved sentence tells the reader to focus the browser first", () => {
	/*
	 * The set is the table's answer, and the pin is the reviewable half: a new
	 * browser chord in `browser-chord.ts` fails here until its refusal copy is
	 * written, rather than shipping a dead-looking shortcut.
	 */
	assert.deepEqual(
		BROWSER_ONLY,
		BROWSER_ONLY_EXPECTED,
		"the browser-only set moved: a chord the browser claims needs a Settings sentence",
	);
	for (const chord of BROWSER_ONLY) {
		assert.match(
			RESERVED_CHORDS.get(chord),
			FOCUS_INSTRUCTION_TAIL,
			`${chord}'s refusal must tell the reader to focus the browser first`,
		);
	}
});

test("a dual-scope chord's row never claims the chord is browser-only", () => {
	/*
	 * THE INVERSE OF THE PIN ABOVE, and the regression that motivated it. A row
	 * whose chord the app also answers outside the browser must NOT end with the
	 * focus instruction: read literally, "Focus the browser first" says the chord
	 * does nothing anywhere else. Excluding a chord from `BROWSER_ONLY` alone
	 * would leave such a row unchecked, so the exclusion is asserted, not assumed.
	 */
	for (const chord of DUAL_SCOPE) {
		const copy = RESERVED_CHORDS.get(chord);
		if (copy === undefined) continue;
		assert.doesNotMatch(
			copy,
			FOCUS_INSTRUCTION_TAIL,
			`${chord} is dual-scope: outside the browser the app answers it, so its row must not tell the reader to focus the browser first`,
		);
	}
});

test("the section explains the browser's scope and why the app does not take those chords", async () => {
	await mount(async (api) => {
		const note = api.$('[data-shortcut-note="browser-scope"]');
		assert.ok(note, "the browser-scope paragraph must render in the section");
		const text = note.textContent;
		assert.match(
			text,
			SCOPE_WHERE,
			"the paragraph must say where the chords act",
		);
		assert.match(
			text,
			SCOPE_REASON,
			"the paragraph must give the reason the app does not claim them",
		);
		assert.match(
			text,
			SCOPE_INSTRUCTION,
			"the paragraph must tell the reader what to do",
		);
	});
});
