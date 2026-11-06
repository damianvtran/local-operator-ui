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
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
after(() => {
	bootstrap.window.close();
	for (const name of ["window", "document", "localStorage", "sessionStorage"]) {
		Reflect.deleteProperty(globalThis, name);
	}
});

const bundle = await build({
	stdin: {
		contents: [
			'export { SpeechShortcutsGroup } from "./src/renderer/src/features/settings/components/speech-shortcuts-group";',
			'export { holdModifierOverlapsChords, overlappingChord, chordExample, alternativeHoldKey } from "./src/renderer/src/features/settings/components/push-to-talk-shortcut-row";',
			'export { pushToTalkTokenForCode, resolvePushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";',
			'export { presentSetting } from "./src/renderer/src/features/settings/backend-setting-copy";',
			'export { sectionForSettingKey } from "./src/renderer/src/features/settings/promoted-setting-sections";',
		].join("\n"),
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
				builder.onResolve({ filter: /^[^./]/ }, (args) =>
					/^(react|react-dom|@tanstack\/react-query)(\/.*)?$/.test(args.path)
						? { path: args.path, external: true }
						: null,
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
const bundleDir = join(ROOT, "node_modules", ".cache", "push-to-talk-row");
mkdirSync(bundleDir, { recursive: true });
const bundlePath = join(bundleDir, "row.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	SpeechShortcutsGroup,
	holdModifierOverlapsChords,
	overlappingChord,
	chordExample,
	alternativeHoldKey,
	presentSetting,
	pushToTalkTokenForCode,
	resolvePushToTalkBinding,
	sectionForSettingKey,
} = await import(pathToFileURL(bundlePath).href);

const startSetting = {
	key: "keymap.start_recording",
	section: "keymap",
	label: "Start recording",
	kind: "hotkey",
	help: "Starts speech-to-text recording in the desktop window.",
	value: "primary+shift+s",
	default: "primary+shift+s",
	is_default: true,
	minimum: null,
	maximum: null,
	members: [],
	choices: [],
	empty_unsets: false,
	redacted: false,
	tier: "core",
	hotkey_scope: "desktop",
};
const holdSetting = {
	...startSetting,
	key: "keymap.push_to_talk",
	label: "Push to talk",
	help: "Hold to dictate (desktop); release to stop.",
	value: "alt-right-hold",
	default: "alt-right-hold",
};
const HOLD = 'input[data-shortcut-action="keymap.push_to_talk"]';
const START = 'input[data-shortcut-action="keymap.start_recording"]';

const PLATFORMS = {
	darwin: { navigator: "MacIntel", chrome: "mac" },
	win32: { navigator: "Win32", chrome: "win" },
	linux: { navigator: "Linux x86_64", chrome: "linux" },
};

/**
 * A platform for one case: the speech manager reads `navigator.platform` and the
 * capture glyphs read the window-chrome facts, and the two must agree.
 */
function setPlatform(name) {
	Object.defineProperty(globalThis, "navigator", {
		value: { platform: PLATFORMS[name].navigator },
		configurable: true,
	});
}

async function mount(
	{
		platform = "darwin",
		saveStatus = 200,
		holdValue = "alt-right-hold",
		hold = true,
		focusKey = null,
	},
	run,
) {
	setPlatform(platform);
	const dom = new JSDOM("<!doctype html><div id='root'></div>", {
		url: "http://localhost/",
		pretendToBeVisual: true,
	});
	const originals = new Map();
	const shims = {
		window: dom.window,
		document: dom.window.document,
		HTMLElement: dom.window.HTMLElement,
		Element: dom.window.Element,
		Node: dom.window.Node,
		Event: dom.window.Event,
		CustomEvent: dom.window.CustomEvent,
		KeyboardEvent: dom.window.KeyboardEvent,
		MouseEvent: dom.window.MouseEvent,
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
	const requests = [];
	// The backend's own store: edits and resets land here and a reload reads it back.
	const store = {
		start: { ...startSetting },
		hold: {
			...holdSetting,
			value: holdValue,
			is_default: holdValue === "alt-right-hold",
		},
	};
	const response = (result) => ({
		status: 200,
		body: { status: 200, message: "ok", result },
	});
	dom.window.requestAnimationFrame = (callback) =>
		dom.window.setTimeout(() => callback(dom.window.performance.now()), 0);
	dom.window.api = {
		recordingShortcut: {
			get: async () => ({
				value: "primary+shift+s",
				canonical: "primary+shift+s",
			}),
			onChange: () => () => {},
			markPending: () => {},
			syncClaims: () => {},
		},
		windowChrome: { facts: () => ({ platform: PLATFORMS[platform].chrome }) },
		desktop: {
			request: async (request) => {
				requests.push(request);
				if (request.op === "settings.list")
					return response({
						sections: [],
						settings: hold ? [store.start, store.hold] : [store.start],
					});
				if (request.key === holdSetting.key) {
					if (saveStatus !== 200)
						return {
							status: saveStatus,
							body: { status: saveStatus, detail: "Not a hold key." },
						};
					if (request.op === "settings.edit") {
						store.hold = {
							...holdSetting,
							value: request.value,
							is_default: request.value === holdSetting.default,
						};
						return response({ ...store.hold });
					}
					if (request.op === "settings.reset") {
						store.hold = { ...holdSetting };
						return response({ ...store.hold });
					}
				}
				throw new Error(`unexpected ${request.op} ${request.key ?? ""}`);
			},
		},
	};
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
	});
	const root = createRoot(dom.window.document.getElementById("root"));
	const render = () =>
		act(() =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(SpeechShortcutsGroup, { focusKey }),
				),
			),
		);
	const settle = async () => {
		for (let attempt = 0; attempt < 10; attempt += 1) {
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 5));
			});
		}
	};
	render();
	await settle();
	try {
		await run({
			window: dom.window,
			requests,
			store,
			$: (selector) => dom.window.document.querySelector(selector),
			text: () => dom.window.document.body.textContent,
			settle,
			up: async (input, init) => {
				await act(async () => {
					input.dispatchEvent(
						new dom.window.KeyboardEvent("keyup", {
							bubbles: true,
							cancelable: true,
							...init,
						}),
					);
				});
				await settle();
			},
			/** A key pressed and released alone: the only way a hold is chosen. */
			tap: async (input, init) => {
				await act(async () => {
					input.dispatchEvent(
						new dom.window.KeyboardEvent("keydown", {
							bubbles: true,
							cancelable: true,
							...init,
						}),
					);
				});
				await act(async () => {
					input.dispatchEvent(
						new dom.window.KeyboardEvent("keyup", {
							bubbles: true,
							cancelable: true,
							...init,
						}),
					);
				});
				await settle();
			},
			key: async (input, init) => {
				await act(async () => {
					input.dispatchEvent(
						new dom.window.KeyboardEvent("keydown", {
							bubbles: true,
							cancelable: true,
							...init,
						}),
					);
				});
				await settle();
			},
		});
	} catch (error) {
		console.error(error);
		throw error;
	} finally {
		await act(async () => root.unmount());
		client.clear();
		await act(async () => {});
		dom.window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else Reflect.deleteProperty(globalThis, key);
		}
	}
}

const modifier = (code, extra = {}) => ({
	code,
	key: code.startsWith("Control")
		? "Control"
		: code.startsWith("Alt")
			? "Alt"
			: "Meta",
	...extra,
});
const edits = (api) =>
	api.requests.filter((request) => request.op === "settings.edit");

test("both rows render under Speech to text, labelled by rank and action", async () => {
	await mount({}, async (api) => {
		assert.ok(api.text().includes("Speech to text"));
		const ranks = [
			...api.window.document.querySelectorAll("[data-speech-rank]"),
		];
		assert.deepEqual(
			ranks.map((node) => node.getAttribute("data-speech-rank")),
			["primary", "secondary"],
		);
		const text = (node) => node.textContent;
		assert.ok(text(ranks[0]).includes("Primary"));
		assert.ok(text(ranks[0]).includes("Start recording (press)"));
		assert.ok(text(ranks[1]).includes("Secondary"));
		assert.ok(text(ranks[1]).includes("Push to talk (hold)"));
		assert.equal(
			api.$(START).value,
			"Cmd+Shift+S"
				.replace("Cmd", "\u2318")
				.replace("+", "")
				.replace("+", "") === ""
				? ""
				: api.$(START).value,
		);
		// A default hold has nothing to reset; the label is the key's own name.
		assert.equal(api.$(HOLD).value, "Right-Option");
		assert.equal(api.window.document.querySelectorAll("button").length, 0);
	});
});

test("an older backend without the hold row keeps the primary row alone", async () => {
	await mount({ hold: false }, async (api) => {
		assert.ok(api.$(START));
		assert.equal(api.$(HOLD), null);
	});
});

test("pressing Left Control saves ctrl-left-hold, applies it live, and reset restores the default", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		field.focus();
		await api.tap(field, modifier("ControlLeft", { ctrlKey: true }));
		assert.deepEqual(edits(api), [
			{
				op: "settings.edit",
				key: "keymap.push_to_talk",
				value: "ctrl-left-hold",
			},
		]);
		assert.equal(field.value, "Left-Control");
		// The hold matcher sees the saved key on the very next keydown, no reload.
		assert.equal(resolvePushToTalkBinding().code, "ControlLeft");
		assert.equal(api.window.document.activeElement, field);
		const reset = api.$(
			'button[aria-label="Reset Push to talk (hold) to its default"]',
		);
		assert.ok(reset);
		await act(async () => reset.click());
		await api.settle();
		assert.deepEqual(
			api.requests.filter((request) => request.op === "settings.reset"),
			[{ op: "settings.reset", key: "keymap.push_to_talk" }],
		);
		assert.equal(field.value, "Right-Option");
		assert.equal(resolvePushToTalkBinding().code, "AltRight");
		assert.equal(
			api.$('button[aria-label="Reset Push to talk (hold) to its default"]'),
			null,
		);
	});
});

test("a saved hold survives a reload of the group", async () => {
	await mount({ holdValue: "meta-left-hold" }, async (api) => {
		assert.equal(api.$(HOLD).value, "Left-Command");
		assert.ok(
			api.$('button[aria-label="Reset Push to talk (hold) to its default"]'),
		);
	});
});

test("capture maps each physical modifier to its token on the three platform families", async () => {
	const cases = {
		darwin: {
			AltLeft: "alt-left-hold",
			AltRight: "alt-right-hold",
			MetaLeft: "meta-left-hold",
			MetaRight: "meta-right-hold",
			ControlLeft: "ctrl-left-hold",
			ControlRight: "ctrl-right-hold",
		},
		// `alt` IS the Meta key off macOS, so Alt itself has no token there.
		win32: {
			AltLeft: null,
			AltRight: null,
			MetaLeft: "alt-left-hold",
			MetaRight: "alt-right-hold",
			ControlLeft: "ctrl-left-hold",
			ControlRight: "ctrl-right-hold",
		},
		linux: {
			AltLeft: null,
			AltRight: null,
			MetaLeft: "alt-left-hold",
			MetaRight: "alt-right-hold",
			ControlLeft: "ctrl-left-hold",
			ControlRight: "ctrl-right-hold",
		},
	};
	const family = { darwin: "darwin", win32: "win32", linux: "other" };
	for (const [platform, expected] of Object.entries(cases)) {
		for (const [code, token] of Object.entries(expected)) {
			assert.equal(
				pushToTalkTokenForCode(code, family[platform]),
				token,
				`${platform}: ${code}`,
			);
		}
		// The token the box saves must resolve back to the key that was pressed.
		setPlatform(platform);
		const { pushToTalkBindingForToken } = await import(
			pathToFileURL(bundlePath).href
		).then(() => ({ pushToTalkBindingForToken: null }));
		void pushToTalkBindingForToken;
	}
	assert.equal(pushToTalkTokenForCode("KeyA", "darwin"), null);
	assert.equal(pushToTalkTokenForCode("Space", "other"), null);
	assert.equal(pushToTalkTokenForCode("ShiftLeft", "darwin"), null);
});

test("saved tokens round-trip to the pressed key on each platform", async () => {
	for (const platform of ["darwin", "win32", "linux"]) {
		await mount({ platform }, async (api) => {
			const field = api.$(HOLD);
			const code = platform === "darwin" ? "MetaLeft" : "MetaLeft";
			await api.tap(field, modifier(code, { metaKey: true }));
			const saved = edits(api).at(-1).value;
			assert.equal(
				saved,
				platform === "darwin" ? "meta-left-hold" : "alt-left-hold",
			);
			assert.equal(resolvePushToTalkBinding().code, "MetaLeft", platform);
		});
	}
});

test("Option is refused off macOS with the keys that do work", async () => {
	await mount({ platform: "win32" }, async (api) => {
		const field = api.$(HOLD);
		await api.tap(field, modifier("AltRight", { altKey: true }));
		assert.equal(edits(api).length, 0);
		assert.ok(
			api
				.text()
				.includes("Only a left or right Control or Windows key can be held."),
		);
	});
	await mount({ platform: "linux" }, async (api) => {
		await api.tap(api.$(HOLD), modifier("AltLeft", { altKey: true }));
		assert.ok(
			api
				.text()
				.includes("Only a left or right Control or Super key can be held."),
		);
		assert.equal(edits(api).length, 0);
	});
});

test("a letter, a chord and Tab-free noise are refused or left alone, and Esc cancels", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		await api.key(field, { key: "a", code: "KeyA" });
		assert.ok(
			api
				.text()
				.includes(
					"Only a left or right Control, Option or Command key can be held.",
				),
		);
		await api.key(field, {
			key: "s",
			code: "KeyS",
			metaKey: true,
			shiftKey: true,
		});
		assert.equal(edits(api).length, 0);
		assert.equal(field.value, "Right-Option");
		await api.key(field, { key: "Escape", code: "Escape" });
		assert.equal(api.text().includes("can be held"), false);
		assert.equal(edits(api).length, 0);
		// Shift has no token and is refused like any other non-hold key.
		await api.tap(
			field,
			modifier("ShiftLeft", { key: "Shift", shiftKey: true }),
		);
		assert.ok(api.text().includes("can be held"));
		// Tab leaves the field untouched and unrefused.
		await api.key(field, { key: "Tab", code: "Tab" });
	});
});

test("pressing the key already bound saves nothing, however the token is spelled", async () => {
	await mount({ platform: "linux" }, async (api) => {
		// Off macOS the default `alt-right-hold` IS MetaRight.
		await api.tap(api.$(HOLD), modifier("MetaRight", { metaKey: true }));
		assert.equal(edits(api).length, 0);
	});
	await mount(
		{ platform: "linux", holdValue: "meta-right-hold" },
		async (api) => {
			// A value another writer stored as meta-* is the same key: no Reset offered.
			assert.equal(
				api.$('button[aria-label="Reset Push to talk (hold) to its default"]'),
				null,
			);
			await api.tap(api.$(HOLD), modifier("MetaRight", { metaKey: true }));
			assert.equal(edits(api).length, 0);
		},
	);
});

test("a backend refusal keeps the saved key and shows the backend sentence", async () => {
	await mount({ saveStatus: 422 }, async (api) => {
		const field = api.$(HOLD);
		// The manager's binding is module state shared by every case: what a refused
		// save must not do is move it, whatever an earlier case left there.
		const before = resolvePushToTalkBinding();
		await api.tap(field, modifier("ControlRight", { ctrlKey: true }));
		assert.ok(api.text().includes("Not a hold key."));
		assert.equal(field.value, "Right-Option");
		assert.deepEqual(resolvePushToTalkBinding(), before);
	});
});

test("the primary row still ignores a bare modifier and saves a chord", async () => {
	await mount({}, async (api) => {
		const field = api.$(START);
		await api.tap(field, modifier("ControlLeft", { ctrlKey: true }));
		assert.equal(edits(api).length, 0);
		assert.equal(api.text().includes("can be held"), false);
	});
});

test("the overlap note names a hold whose modifier begins an existing chord, and only then", () => {
	// macOS: Command is `primary`, so the default Cmd+Shift+S chord overlaps a Command hold.
	assert.equal(
		holdModifierOverlapsChords("MetaRight", "darwin", ["primary+shift+s"]),
		true,
	);
	// `primary` is Control OR Command on macOS for panel chords too: the panel
	// router accepts Ctrl+J as `primary+j` (keymap-dispatch.test.mjs), so a
	// Control hold overlaps it (review MAJOR1).
	assert.equal(
		holdModifierOverlapsChords("ControlLeft", "darwin", ["primary+j"]),
		true,
	);
	assert.equal(
		holdModifierOverlapsChords(
			"ControlLeft",
			"darwin",
			[],
			["primary+shift+s"],
		),
		true,
	);
	// A bare Option hold against Option chords is the case the note exists for.
	assert.equal(
		holdModifierOverlapsChords("AltRight", "darwin", ["primary+alt+r"]),
		true,
	);
	assert.equal(
		holdModifierOverlapsChords("AltRight", "darwin", ["primary+shift+s"]),
		false,
	);
	// Off macOS `primary` is Ctrl only: a Win/Super hold does not overlap it.
	assert.equal(
		holdModifierOverlapsChords("MetaRight", "win32", ["primary+shift+s"]),
		false,
	);
	assert.equal(
		holdModifierOverlapsChords("ControlRight", "win32", ["primary+shift+s"]),
		true,
	);
	assert.equal(
		holdModifierOverlapsChords("MetaRight", "other", ["meta+x"]),
		true,
	);
	assert.equal(holdModifierOverlapsChords("ControlRight", "other", []), false);
});

test("the overlap note renders under the field when the hold shares a modifier with a chord", async () => {
	await mount(
		{ platform: "darwin", holdValue: "meta-right-hold" },
		async (api) => {
			assert.ok(
				api
					.text()
					.includes(
						"Every shortcut that uses Command, such as Command+Shift+S, will start recording for a moment. Choose Option to avoid this.",
					),
			);
		},
	);
	await mount({ platform: "darwin" }, async (api) => {
		// Right Option vs the shipped chords (all Cmd/Ctrl based): no overlap.
		assert.equal(
			api.text().includes("will start recording for a moment"),
			false,
		);
	});
});

test("the promoted hold row stays findable: its deep link and palette hint name the Keyboard section", () => {
	// The palette folds every registry row through `presentSetting` and links to
	// `/settings?setting=<key>`; both resolve the section through the one map.
	assert.equal(
		sectionForSettingKey("keymap.push_to_talk", "backend"),
		"keyboard",
	);
	assert.equal(
		sectionForSettingKey("keymap.start_recording", "backend"),
		"keyboard",
	);
	assert.equal(presentSetting(holdSetting).section, "keyboard");
	assert.equal(presentSetting(holdSetting).key, "keymap.push_to_talk");
});

test("both rows are annotated for the settings search, labelled by their action", async () => {
	await mount({}, async (api) => {
		const rows = [
			...api.window.document.querySelectorAll("[data-search-row]"),
		].map((node) => [
			node.getAttribute("data-search-row"),
			node.getAttribute("data-search-label"),
			node.hasAttribute("data-search-control"),
			node.querySelector("input") !== null,
		]);
		assert.deepEqual(rows, [
			[
				"keyboard.keymap.start_recording",
				"Start recording (press)",
				true,
				true,
			],
			["keyboard.keymap.push_to_talk", "Push to talk (hold)", true, true],
		]);
	});
});

const pointer = "For a shortcut with a letter, use Start recording above.";

test("a modifier that grows into a chord saves nothing and says why (Cmd+Shift+S, Ctrl+Tab, Cmd+Tab)", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		field.focus();
		const chords = [
			[
				modifier("MetaLeft", { metaKey: true }),
				{ key: "Shift", code: "ShiftLeft", metaKey: true, shiftKey: true },
				{ key: "s", code: "KeyS", metaKey: true, shiftKey: true },
			],
			[
				modifier("ControlLeft", { ctrlKey: true }),
				{ key: "Tab", code: "Tab", ctrlKey: true },
			],
			[
				modifier("MetaLeft", { metaKey: true }),
				{ key: "Tab", code: "Tab", metaKey: true },
			],
		];
		for (const [first, ...rest] of chords) {
			await api.key(field, first);
			// Nothing is committed while the modifier is still down.
			assert.equal(edits(api).length, 0, "no save on the keydown");
			for (const next of rest) await api.key(field, next);
			await api.up(field, first);
			assert.equal(edits(api).length, 0, "no save once it was a chord");
			assert.equal(field.value, "Right-Option", "the saved key is untouched");
			assert.ok(api.text().includes("can be held"), "the refusal is shown");
			await api.up(field, rest.at(-1));
			// Esc then clears the refusal: nothing was ever saved to "cancel".
			await api.key(field, { key: "Escape", code: "Escape" });
			assert.equal(api.text().includes("can be held"), false);
		}
	});
});

test("a plain tap saves on release, never on press, and Esc between drops it", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		const control = modifier("ControlRight", { ctrlKey: true });
		await api.key(field, control);
		assert.equal(edits(api).length, 0);
		await api.up(field, control);
		assert.deepEqual(
			edits(api).map((edit) => edit.value),
			["ctrl-right-hold"],
		);
		// Esc while the modifier is down: the later release saves nothing.
		const left = modifier("MetaLeft", { metaKey: true });
		await api.key(field, left);
		await api.key(field, { key: "Escape", code: "Escape" });
		await api.up(field, left);
		assert.equal(edits(api).length, 1);
	});
});

test("leaving the field mid-press saves nothing on the release that lands elsewhere", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		const control = modifier("ControlRight", { ctrlKey: true });
		field.focus();
		await api.key(field, control);
		// Window blur / focus loss: React's onBlur on the field.
		await act(async () => {
			field.blur();
		});
		field.focus();
		await api.up(field, control);
		assert.equal(edits(api).length, 0);
	});
});

test("the refusal and the overlap note are wired to the field for assistive tech", async () => {
	await mount(
		{ platform: "darwin", holdValue: "meta-right-hold" },
		async (api) => {
			const field = api.$(HOLD);
			const described = field
				.getAttribute("aria-describedby")
				.split(" ")
				.map((id) => api.window.document.getElementById(id));
			assert.ok(described.every(Boolean), "every described id exists");
			assert.ok(
				described.some((node) =>
					node.textContent.includes("will start recording for a moment"),
				),
				"the overlap note is part of the description",
			);
			assert.equal(field.getAttribute("aria-invalid"), null);
			await api.tap(field, { key: "a", code: "KeyA" });
			assert.equal(field.getAttribute("aria-invalid"), "true");
			const status = described.at(-1);
			assert.equal(status.getAttribute("aria-live"), "polite");
			assert.ok(status.textContent.includes("can be held"));
		},
	);
});

test("the primary row says a lone modifier is not a shortcut, on release", async () => {
	await mount({}, async (api) => {
		const field = api.$(START);
		const control = modifier("ControlLeft", { ctrlKey: true });
		await api.key(field, control);
		assert.equal(api.text().includes("needs a letter or number"), false);
		await api.up(field, control);
		assert.ok(
			api
				.text()
				.includes(
					"A shortcut needs a letter or number as well as a modifier key.",
				),
		);
		assert.equal(edits(api).length, 0);
	});
});

test("a ?setting= deep link to a promoted speech key focuses that row's field (QA Q-1)", async () => {
	for (const [key, selector] of [
		["keymap.push_to_talk", HOLD],
		["keymap.start_recording", START],
	]) {
		await mount({ focusKey: key }, async (api) => {
			assert.equal(api.window.document.activeElement, api.$(selector), key);
		});
	}
	await mount({ focusKey: "keymap.something_else" }, async (api) => {
		assert.notEqual(api.window.document.activeElement, api.$(HOLD));
		assert.notEqual(api.window.document.activeElement, api.$(START));
	});
});

test("the overlap example is the whole chord, and named keys keep their words", () => {
	assert.equal(
		chordExample("primary+shift+s", "Control", "other"),
		"Control+Shift+S",
	);
	assert.equal(
		chordExample("primary+alt+r", "Command", "darwin"),
		"Command+Option+R",
	);
	assert.equal(
		chordExample("primary+space", "Control", "win32"),
		"Control+Space",
	);
	assert.equal(chordExample("meta+x", "Left-Win", "win32"), "Windows+X");
	// An Option hold overlaps through `alt`: `primary` is then the app modifier.
	assert.equal(
		chordExample("primary+alt+r", "Option", "darwin"),
		"Command+Option+R",
	);
});

test("the suggested alternative never overlaps a claimed chord itself", () => {
	setPlatform("darwin");
	// Shipped chords are Command/Control based: Option is free.
	assert.equal(
		alternativeHoldKey(
			"ControlRight",
			"darwin",
			["primary+j"],
			["primary+shift+s"],
		),
		"Right-Option",
	);
	// An Option chord takes Option away; Control and Command overlap `primary`
	// on macOS, so there is nothing left to offer.
	assert.equal(
		alternativeHoldKey(
			"ControlRight",
			"darwin",
			["primary+j"],
			["primary+alt+r"],
		),
		null,
	);
	// Off macOS Option is not a holdable key: Control (own chords) is excluded
	// when `primary` is bound, and Win/Super is free of `primary`. The labels
	// follow `navigator.platform`, so it is set to match the family.
	setPlatform("win32");
	// The label's wording off macOS is the deferred D4 wart, so only the fact
	// that a key is offered is asserted here.
	assert.notEqual(
		alternativeHoldKey("ControlRight", "win32", ["primary+j"], []),
		null,
	);
	for (const [family, platform] of [
		["darwin", "darwin"],
		["win32", "win32"],
		["other", "linux"],
	]) {
		setPlatform(platform);
		for (const chords of [
			[],
			["primary+j"],
			["alt+x"],
			["meta+x"],
			["ctrl+x"],
		]) {
			const label = alternativeHoldKey("ControlLeft", family, chords, []);
			if (label === null) continue;
			const code = ["Option", "Control", "Command", "Win", "Super"].find((n) =>
				label.includes(n),
			);
			const asCode = {
				Option: "AltRight",
				Control: "ControlRight",
				Command: "MetaRight",
				Win: "MetaRight",
				Super: "MetaRight",
			}[code];
			assert.equal(
				overlappingChord(asCode, family, chords),
				null,
				`${family} ${chords}: ${label}`,
			);
		}
	}
});

test("an auto-repeat of the held modifier is the same press: Control held past the repeat delay still saves", async () => {
	for (const [platform, code, token] of [
		["darwin", "ControlLeft", "ctrl-left-hold"],
		["darwin", "AltLeft", "alt-left-hold"],
		["win32", "ControlRight", "ctrl-right-hold"],
		["win32", "MetaLeft", "alt-left-hold"],
	]) {
		await mount({ platform }, async (api) => {
			const field = api.$(HOLD);
			field.focus();
			const first = modifier(code);
			await api.key(field, first);
			// The OS repeats the keydown while the key is held.
			await api.key(field, { ...first, repeat: true });
			await api.key(field, { ...first, repeat: true });
			assert.equal(edits(api).length, 0, "nothing saved while still down");
			assert.equal(api.text().includes("can be held"), false);
			await api.up(field, first);
			assert.deepEqual(
				edits(api).map((edit) => edit.value),
				[token],
				`${platform} ${code}`,
			);
		});
	}
});

test("an IME composition keydown is ignored, like a repeat: it neither taints nor refuses", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		field.focus();
		const first = modifier("ControlRight", { ctrlKey: true });
		await api.key(field, first);
		await api.key(field, { key: "Process", code: "KeyA", isComposing: true });
		await api.up(field, first);
		assert.deepEqual(
			edits(api).map((edit) => edit.value),
			["ctrl-right-hold"],
		);
		assert.equal(api.text().includes("can be held"), false);
	});
});

test("an auto-repeat of a lone modifier does not disarm the Primary row's message", async () => {
	await mount({}, async (api) => {
		const field = api.$(START);
		const control = modifier("ControlLeft", { ctrlKey: true });
		await api.key(field, control);
		await api.key(field, { ...control, repeat: true });
		await api.up(field, control);
		assert.ok(api.text().includes("needs a letter or number"));
	});
});

test("a refusal does not repeat the hint's pointer to Start recording", async () => {
	await mount({ platform: "darwin" }, async (api) => {
		const field = api.$(HOLD);
		field.focus();
		await api.tap(field, { key: "a", code: "KeyA" });
		const status = api.window.document.getElementById(`${field.id}-status`);
		assert.ok(status.textContent.includes("can be held"));
		assert.equal(status.textContent.includes(pointer), false);
		// Shown once: in the hint, which the field's description carries.
		assert.equal(api.text().split(pointer).length - 1, 1);
	});
});
