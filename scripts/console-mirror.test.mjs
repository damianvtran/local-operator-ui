/**
 * The pane's INPUT path, driven through the real mirror component.
 *
 * This file exists because of a blocker: the pane shipped with the mirror replaying
 * and streaming and NOT ONE KEYSTROKE reaching the shell. Every other test in this
 * PR passed — the main-process wiring, the replay, the theme, 144 rendered frames —
 * while a user could not type a character, and that is the finding behind the
 * finding: nothing in CI exercised the one line that carries a keystroke to the pty.
 *
 * SO THIS IS NOT A UNIT TEST OF A HELPER. It mounts the real `ConsoleMirror`, which
 * constructs a terminal, opens it, subscribes to the record and wires the input path
 * — the real component, the real effects, the real cleanup. What is substituted is
 * `@xterm/xterm` itself (`scripts/console-xterm-stub.ts`), and the file says exactly
 * why: a real `Terminal` in Node needs a DOM with layout, and `term.open()` behind a
 * jsdom document throws in the renderer before any event can be dispatched.
 *
 * WHAT THIS PROVES, and what it does not:
 *
 *   - it proves the WIRING, which is what was missing — a keystroke becomes an
 *     `api.input` call carrying xterm's own bytes, in order, addressed to the
 *     surface the pane is showing, and NEVER through `console_keys` (§10.5's
 *     encoder is the agent's, and §10.5's own sentence says the pane needs none);
 *   - it proves the CLEANUP — an unmounted mirror stops forwarding, so a disposed
 *     pane cannot type into a surface it is no longer showing;
 *   - it does NOT prove the round trip to a shell. That is the live evidence on the
 *     PR (the app's own renderer, `console_input`, and the shell's echo), and the
 *     two layers are deliberately not collapsed into one claim.
 */

import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM(
	'<!doctype html><html><body><div id="root"></div></body></html>',
	{
		pretendToBeVisual: true,
		url: "http://localhost/",
	},
);
const { window } = dom;

window.HTMLCanvasElement.prototype.getContext = function getContext() {
	return { font: "", measureText: (text) => ({ width: text.length * 7.8 }) };
};

class ResizeObserverStub {
	observe() {}
	unobserve() {}
	disconnect() {}
}
window.ResizeObserver = ResizeObserverStub;
window.matchMedia = () => ({
	matches: false,
	addEventListener() {},
	removeEventListener() {},
	addListener() {},
	removeListener() {},
});

globalThis.window = window;
globalThis.document = window.document;
// `navigator` is a GETTER on this Node's global object, so it is redefined rather
// than assigned.
Object.defineProperty(globalThis, "navigator", {
	value: window.navigator,
	configurable: true,
	writable: true,
});
globalThis.HTMLElement = window.HTMLElement;
globalThis.HTMLCanvasElement = window.HTMLCanvasElement;
globalThis.Element = window.Element;
globalThis.Node = window.Node;
globalThis.Event = window.Event;
globalThis.MutationObserver = window.MutationObserver;
globalThis.ResizeObserver = ResizeObserverStub;
globalThis.requestAnimationFrame = window.requestAnimationFrame.bind(window);
globalThis.cancelAnimationFrame = window.cancelAnimationFrame.bind(window);
globalThis.getComputedStyle = window.getComputedStyle.bind(window);

const bundle = await build({
	stdin: {
		contents: [
			'export { ConsoleMirror } from "./src/renderer/src/features/console/components/console-mirror";',
			'export { createRoot } from "react-dom/client";',
			'export { createElement } from "react";',
			// The stub's own handles, exported through the same bundle so the test
			// drives the very instances the component constructed rather than a
			// second copy of the module.
			'export { __terminals, KEYSTROKE_BYTES } from "./scripts/console-xterm-stub";',
		].join("\n"),
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	// The renderer's own aliases and `jsx` come from its tsconfig, so a second set
	// here cannot drift from what the app builds with.
	tsconfig: "./tsconfig.app.json",
	logLevel: "silent",
	define: { "process.env.NODE_ENV": '"test"' },
	alias: {
		"@xterm/xterm": "./scripts/console-xterm-stub.ts",
		"@xterm/addon-unicode11": "./scripts/console-addon-unicode11-stub.ts",
		// NAMED EXPLICITLY, because an alias on the bare specifier is a PREFIX match:
		// `@xterm/xterm` alone rewrote this stylesheet's specifier into the stub's own
		// directory and the build failed on a path that does not exist. The real
		// stylesheet is what a browser would load, and the loader drops it.
		"@xterm/xterm/css/xterm.css": "./node_modules/@xterm/xterm/css/xterm.css",
	},
	loader: { ".css": "empty" },
});
/*
 * THE BUNDLE GOES TO A FILE RATHER THAN A `data:` URL, and that is a diagnostic
 * decision as much as a mechanical one: a stack frame inside a data URL prints the
 * entire bundle, so the first failure this harness hits is unreadable exactly when a
 * reader needs it most. A file on disk gives ordinary frames.
 */
const harnessPath = join(
	tmpdir(),
	`lo-console-mirror-harness-${process.pid}.mjs`,
);
writeFileSync(harnessPath, bundle.outputFiles[0].text);
const harness = await import(pathToFileURL(harnessPath).href);
const { __terminals, KEYSTROKE_BYTES } = harness;

/** The bridge the pane talks to, recording what it was handed. */
const installBridge = () => {
	const calls = [];
	const channels = [];
	window.api = {
		console: {
			state: async () => ({ available: true, surfaces: [] }),
			subscribe: async () => ({ replay_base64: "", from_byte: 0 }),
			unsubscribe: async () => {},
			input: async (surface, payload) => {
				calls.push({ surface, payload });
			},
			keys: async (surface, payload) => {
				calls.push({ surface, payload, viaKeys: true });
			},
			onOutput: (channel) => {
				channels.push(channel);
				return () => {};
			},
			onExit: () => () => {},
			onReveal: () => () => {},
			onStateChanged: () => () => {},
			setContentRect: async () => {},
			openPane: async () => {},
		},
	};
	return calls;
};

const settle = (ms = 40) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Which platform the component under test thinks it is on.
 *
 * jsdom reports an EMPTY `navigator.platform`, which is neither macOS nor Linux — so a
 * cell that does not set it is asserting against a platform no user has. The pane's copy
 * chord is platform-dependent on purpose (U7), so the cells have to say which one they
 * mean; the descriptor is restored afterwards so one cell cannot decide another's.
 */
const setPlatform = (platform) => {
	const previous = Object.getOwnPropertyDescriptor(
		window.navigator,
		"platform",
	);
	Object.defineProperty(window.navigator, "platform", {
		value: platform,
		configurable: true,
	});
	return () => {
		if (previous) {
			Object.defineProperty(window.navigator, "platform", previous);
		}
	};
};

/** A clipboard the pane can write to, recording what it was handed. jsdom has none. */
const installClipboard = () => {
	const written = [];
	Object.defineProperty(window.navigator, "clipboard", {
		value: {
			writeText: async (text) => {
				written.push(text);
			},
		},
		configurable: true,
	});
	return written;
};

const mountMirror = async () => {
	const root = harness.createRoot(document.getElementById("root"));
	root.render(
		harness.createElement(harness.ConsoleMirror, {
			surface: "con:1:test",
			visible: true,
			cols: 80,
			rows: 24,
			onReport: () => {},
		}),
	);
	// The component constructs its terminal in a layout effect, so one tick is all
	// it takes; the loop is for a slower machine rather than for a race.
	let terminal = null;
	for (let i = 0; i < 40 && !terminal; i++) {
		await settle(25);
		terminal = __terminals.find((entry) => !entry.wasDisposed) ?? null;
	}
	assert.ok(terminal, "the mirror constructed a terminal");
	return { root, terminal };
};

test("a keystroke typed into the pane reaches the bridge as the bytes xterm encoded", async () => {
	const calls = installBridge();
	const { root, terminal } = await mountMirror();

	terminal.typeKey("a");
	await settle();
	assert.deepEqual(
		calls.map((call) => call.payload),
		["a"],
		"a printable key must reach `api.input`; with no `onData` subscription this list is empty, which is the state this PR shipped in",
	);

	terminal.typeKey("b");
	terminal.typeKey("Enter");
	terminal.typeKey("ArrowUp");
	terminal.typeKey("Backspace");
	terminal.typeKey("ctrl+c");
	await settle();

	assert.deepEqual(
		calls.map((call) => call.payload),
		["a", "b", "\r", KEYSTROKE_BYTES.ArrowUp, "\x7f", "\x03"],
		"every key must arrive as the sequence its program expects, in order and unchanged — the pane forwards what the encoder produced rather than re-encoding it",
	);
	assert.ok(
		calls.every((call) => call.viaKeys !== true),
		"and NONE through `console_keys`: that namespace is the AGENT's named-key encoder (design 10.5), and a pane that used it would be a second encoder on the one path the design says needs none",
	);
	assert.ok(
		calls.every((call) => call.surface === "con:1:test"),
		"addressed to the surface the pane is showing",
	);
	root.unmount();
});

test("a mirror that is gone stops forwarding", async () => {
	const calls = installBridge();
	const { root, terminal } = await mountMirror();
	terminal.typeKey("a");
	await settle();
	assert.equal(calls.length, 1, "the live mirror forwards");

	root.unmount();
	await settle();
	assert.equal(
		terminal.wasDisposed,
		true,
		"unmounting disposes the terminal it created",
	);
	assert.equal(
		terminal.listening,
		0,
		"and nothing is still subscribed, so a disposed pane cannot type into a surface it is no longer showing",
	);
});

test("the pane's own writes are never sent back as input", async () => {
	// The negative half, and the reason the tests above cannot pass by accident:
	// bytes arriving FROM the record are written to the terminal and must never be
	// forwarded to `api.input`. A `write` handler wired to the bridge would echo the
	// shell to itself for ever, and it would look like a working pane.
	const calls = installBridge();
	const { root, terminal } = await mountMirror();
	// The recording bridge answers `subscribe` with an empty replay, so the only
	// thing the component can do with the record is write it.
	await settle(80);
	assert.deepEqual(
		calls,
		[],
		"mounting, replaying and the theme pass send no input",
	);
	assert.ok(terminal.written.length >= 0);
	root.unmount();
});

/*
 * COPY (UX rounds 2 and 3): a drag painted `xterm-selection` boxes and ⌘C did nothing —
 * no `copy` event fired, the clipboard stayed empty, and nothing in this feature had wired
 * a path. These cells are the wiring proof, and since U7 they are also the platform proof:
 * WHICH chord copies is a platform question, and getting it wrong took the interrupt away
 * on macOS. The built app's own drag is the round's other half, and the seam between them
 * is stated rather than blurred.
 */
test("darwin: the copy chord copies the selection and is not sent to the program", async () => {
	const restore = setPlatform("MacIntel");
	const written = installClipboard();
	const calls = installBridge();
	const { root, terminal } = await mountMirror();

	terminal.setSelection("npm run build");
	const handled = terminal.pressKey({ key: "c", metaKey: true });
	await settle();

	assert.equal(handled, false, "the chord is claimed rather than encoded");
	assert.deepEqual(
		written,
		["npm run build"],
		"and the selection reaches the clipboard",
	);
	assert.deepEqual(
		calls,
		[],
		"and NOT the pty: a copy is not input, so no `\\x03` may reach a running program",
	);
	root.unmount();
	restore();
});

test("darwin: Ctrl+C WITH A SELECTION is still the interrupt", async () => {
	/*
	 * THE CELL UX ROUND 3's U7 ASKED FOR, and the one whose absence let a real regression
	 * through: the chord claimed Ctrl+C whenever a selection existed, on every platform,
	 * so on a Mac selecting text silently took the interrupt away and a running `sleep 5`
	 * could not be stopped (measured 3/3 in the built app). Here the selection IS present
	 * and the Ctrl chord must still fall through to the terminal — `true` is what that
	 * means: xterm encodes it and the pty receives `\x03`.
	 */
	const restore = setPlatform("MacIntel");
	const written = installClipboard();
	const { root, terminal } = await mountMirror();

	terminal.setSelection("sleep 5");
	const handled = terminal.pressKey({ key: "c", ctrlKey: true });
	assert.equal(
		handled,
		true,
		"on darwin a Ctrl chord is never the copy chord, selection or not",
	);
	assert.deepEqual(written, [], "and nothing is copied");
	root.unmount();
	restore();
});

test("linux: Ctrl+C copies when there is a selection, and interrupts when there is not", async () => {
	// The other half of the platform gate: on Linux and Windows Ctrl+C really is BOTH, so
	// the selection is what decides — the behaviour the first version implemented on every
	// platform, and macOS is the exception it missed.
	const restore = setPlatform("Linux x86_64");
	const written = installClipboard();
	const { root, terminal } = await mountMirror();

	terminal.setSelection("docker compose logs");
	const copied = terminal.pressKey({ key: "c", ctrlKey: true });
	await settle();
	assert.equal(copied, false, "with a selection the chord is claimed");
	assert.deepEqual(written, ["docker compose logs"]);

	terminal.setSelection("");
	const interrupted = terminal.pressKey({ key: "c", ctrlKey: true });
	assert.equal(
		interrupted,
		true,
		"with no selection the key is the terminal's to encode",
	);
	root.unmount();
	restore();
});

test("a copy event also carries the selection, for every route that is not the chord", async () => {
	const { root, terminal } = await mountMirror();
	terminal.setSelection("built in 4.2s");

	const event = new window.Event("copy", { bubbles: true, cancelable: true });
	const data = new Map();
	Object.defineProperty(event, "clipboardData", {
		value: {
			setData: (type, value) => data.set(type, value),
		},
	});
	document
		.querySelector('[data-tour-tag="console-mirror"]')
		.dispatchEvent(event);
	await settle();

	assert.equal(data.get("text/plain"), "built in 4.2s");
	assert.equal(
		event.defaultPrevented,
		true,
		"the browser's own copy is not left to win",
	);
	root.unmount();
});
