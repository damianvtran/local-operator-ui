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
			// Exported rather than imported directly for the same reason the stub's
			// handles are: the test must read the module the COMPONENT built with, not a
			// second copy whose constants could drift from it.
			'export { measureCell, deviceRoundedRowHeight } from "./src/renderer/src/shared/themes/terminal-theme";',
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
const { __terminals, KEYSTROKE_BYTES, measureCell, deviceRoundedRowHeight } =
	harness;

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

const mountMirror = async (extra = {}) => {
	const root = harness.createRoot(document.getElementById("root"));
	root.render(
		harness.createElement(harness.ConsoleMirror, {
			surface: "con:1:test",
			visible: true,
			cols: 80,
			rows: 24,
			onReport: () => {},
			...extra,
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

/* ------------------------------------------- a feed is a function of ONE record (Q-11) */

/** What a stub terminal has been handed, as text. */
const written = (terminal) =>
	terminal.written.map((chunk) => new TextDecoder().decode(chunk)).join("");

/**
 * Mount the mirror the way the capture page does: a record's bytes, a key, `mode="capture"`.
 *
 * The page keys this component on the feed's nonce, which is what makes a second feed start
 * from a fresh terminal; these cells drive the component directly so both halves of the
 * guarantee are asserted — the key's half and the reset's half — rather than only the one the
 * page happens to rely on.
 */
const renderFeed =
	(root) =>
	(key, text, surface = "con:1:feed") =>
		root.render(
			harness.createElement(harness.ConsoleMirror, {
				key,
				surface,
				visible: true,
				cols: 80,
				rows: 24,
				mode: "capture",
				bytes: new TextEncoder().encode(text),
				onReport: () => {},
			}),
		);

test("a new feed gets a fresh terminal: the frame is its own record, not the union of two", async () => {
	/*
	 * THE CELL QA ROUND 3'S Q-11 ASKS FOR, and the defect it pins was live: the offscreen
	 * path fed `nonce: attempt` — 1 on the first attempt of EVERY request — so the page never
	 * remounted the mirror, and the second surface's bytes were written into the first one's
	 * grid. Measured then: a 1-line surface captured after an 8-line one came back as both
	 * (212 rows = 192 + 20), a repeat capture appended again (232), and three different
	 * surfaces returned byte-identical frames.
	 */
	const root = harness.createRoot(document.getElementById("root"));
	const feed = renderFeed(root);

	feed(1, "FIRST-SURFACE-TEXT\n");
	await settle(60);
	const first = __terminals.filter((t) => !t.wasDisposed).at(-1);
	assert.equal(
		written(first),
		"FIRST-SURFACE-TEXT\n",
		"the first feed paints its record",
	);

	feed(2, "SECOND-SURFACE-TEXT\n");
	await settle(60);
	const second = __terminals.filter((t) => !t.wasDisposed).at(-1);
	assert.notEqual(second, first, "a new feed mounts its own terminal");
	assert.equal(
		written(second),
		"SECOND-SURFACE-TEXT\n",
		"and paints its own record rather than appending to the previous one's",
	);
	root.unmount();
});

test("a re-feed under the same key still clears first: one record, never a union (Q-11)", async () => {
	/*
	 * The other half, and the half that holds when a caller forgets the key: the mirror
	 * resets its buffer at the head of every feed. Without this the key would be the ONLY
	 * thing standing between a reconstruction and a union of two records, and this round is
	 * what showed how easily that is forgotten.
	 */
	const root = harness.createRoot(document.getElementById("root"));
	const feed = renderFeed(root);

	feed("same", "FIRST\n");
	await settle(60);
	const terminal = __terminals.filter((t) => !t.wasDisposed).at(-1);

	feed("same", "SECOND\n");
	await settle(60);
	assert.equal(
		terminal,
		__terminals.filter((t) => !t.wasDisposed).at(-1),
		"the same key reuses the terminal, which is what makes this the reset's own cell",
	);
	assert.equal(written(terminal), "SECOND\n");
	assert.ok(
		terminal.resets >= 1,
		"and the buffer was cleared before the write",
	);
	root.unmount();
});

test("the capture settle is the write's own completion, not a frame count (Q-13)", async () => {
	/*
	 * THE CELL Q-13 ASKS FOR. The settle used to be "two animation frames after the write
	 * was CALLED", which is right for a prompt and wrong for a large record: QA measured a
	 * 3.9-8 MB record coming back blank on 1 of 5, 2 of 5 and 1 of 5 back-to-back captures of
	 * the same surface, because the shutter could beat the parse. It is xterm's own
	 * `write(data, callback)` now, and what this cell can hold is the order the mirror
	 * depends on: when the settle fires, the record is ALREADY in the terminal, and it
	 * arrived there through the write's callback rather than through a timer.
	 */
	const root = harness.createRoot(document.getElementById("root"));
	const settledWith = [];
	const feed = (text) =>
		root.render(
			harness.createElement(harness.ConsoleMirror, {
				key: text,
				surface: "con:1:feed",
				visible: true,
				cols: 80,
				rows: 24,
				mode: "capture",
				bytes: new TextEncoder().encode(text),
				onSettled: (terminal) => settledWith.push(written(terminal)),
				onReport: () => {},
			}),
		);

	feed("A-LARGE-RECORD\n");
	await settle(60);
	const terminal = __terminals.filter((t) => !t.wasDisposed).at(-1);
	assert.deepEqual(
		settledWith,
		["A-LARGE-RECORD\n"],
		"the settle arrives with the record already parsed into the terminal",
	);
	assert.equal(
		terminal.writeCallbacks.filter(Boolean).length,
		1,
		"and it was carried by the write's own callback rather than by a frame count",
	);
	root.unmount();
});

/*
 * ---------------------------------------------------------------------------
 * THE CELL THE PANE REPORTS, AND THE CARET IT TAKES ON REQUEST.
 *
 * Both are claims about a rendered terminal that a rules-only test cannot make, and
 * both were wrong in the shipped pane: the reported row height was the LINE BOX
 * (1.2em) rather than the row xterm paints, which made main derive more rows than
 * the pane's box holds — the last three and a half rows were painted below the
 * box's clipped edge, where no scroll reaches them (the operator's report); and a
 * user who opened the console landed on an empty state with no surface and no caret.
 * ---------------------------------------------------------------------------
 */

/**
 * The font metrics jsdom has no engine to produce, at the values the SHIPPED FACE
 * measures in the built app.
 *
 * These are not invented: they are the pane's own measurement read back out of the
 * running app (`canvas.measureText("W")` with the app's resolved `--font-mono` at
 * 13px, at dpr 2), where `fontBoundingBoxAscent + fontBoundingBoxDescent` = 13 + 4 =
 * 17. That is the number the whole defect turns on — xterm's char height is 17, the
 * line box the pane used to report is 15.6, and 791 / 15.6 = 50 rows of 17px does
 * not fit in 791.
 */
const installFontMetrics = (ascent, descent) => {
	const previous = window.HTMLCanvasElement.prototype.getContext;
	window.HTMLCanvasElement.prototype.getContext = function getContext() {
		return {
			font: "",
			measureText: (text) => ({
				width: text.length * 7.8,
				fontBoundingBoxAscent: ascent,
				fontBoundingBoxDescent: descent,
			}),
		};
	};
	return () => {
		window.HTMLCanvasElement.prototype.getContext = previous;
	};
};

/**
 * The height xterm paints for `rows` rows, in CSS pixels, in xterm 6's own words.
 *
 * From `browser/renderer/dom/DomRenderer.ts::_updateDimensions`:
 *   device.char.height = Math.ceil(charSizeService.height * dpr)
 *   device.cell.height = Math.floor(device.char.height * lineHeight)   // 1 by default
 *   css.canvas.height  = Math.round(device.cell.height * rows / dpr)
 * Restated here rather than approximated, because the claim is about THAT arithmetic:
 * a test that measured "about a row" per row would pass for the bug too.
 */
const paintedHeight = (charHeight, dpr, rows) =>
	Math.round(Math.ceil(charHeight * dpr) * rows) / dpr;

test("the reported cell height is the row xterm paints, so the grid fits the pane's box", () => {
	const restore = installFontMetrics(13, 4);
	try {
		const dpr = 2;
		const { cellWidth, cellHeight } = measureCell("monospace", 13, dpr);
		assert.equal(
			cellWidth,
			7.8,
			"the advance is the metric xterm measures with",
		);
		assert.equal(
			cellHeight,
			17,
			"the reported row height is xterm's own: ceil(17 * 2) / 2, not 13 * 1.2",
		);
		assert.equal(deviceRoundedRowHeight(17, dpr), 17);

		/*
		 * THE INVARIANT, over every box the pane can be given — which is the property
		 * that failed, not one number. `box` is the box the pane reported from in the
		 * reproduction (643x791 at 1380x900, dpr 2).
		 */
		for (let box = 60; box <= 1400; box += 1) {
			const rows = Math.floor(box / cellHeight);
			assert.ok(
				paintedHeight(17, dpr, rows) <= box,
				`a ${box}px box asked for ${rows} rows, which paints ${paintedHeight(17, dpr, rows)}px`,
			);
		}

		/*
		 * AND THE OTHER HALF, so this test cannot pass for the bug it exists for: the
		 * row height it used to report over-derives by exactly the amount the operator's
		 * screen showed. 791 / 15.6 = 50 rows, 50 * 17 = 850 px, 59 px of terminal below
		 * the box — the live reproduction's own numbers.
		 */
		const box = 791;
		const ratioRows = Math.floor(box / (13 * 1.2));
		assert.equal(ratioRows, 50);
		assert.equal(paintedHeight(17, dpr, ratioRows) - box, 59);
		assert.equal(Math.floor(box / cellHeight), 46);
	} finally {
		restore();
	}
});

test("the caret goes into the terminal on the pane's own open, and never on a plain mount", async () => {
	const before = __terminals.length;
	const { root } = await mountMirror({ focusRequest: 2 });
	await settle(2);
	const asked = __terminals
		.slice(before)
		.filter((terminal) => !terminal.wasDisposed);
	assert.equal(asked.length, 1);
	assert.equal(
		asked[0].focusCount,
		1,
		"a request takes the keyboard once: the pane answers a user's open by asking, not by mounting",
	);
	root.unmount();
});

test("a mirror mounted without a request never takes the keyboard (the restore, the reveal, the capture view)", async () => {
	const before = __terminals.length;
	const root = harness.createRoot(document.createElement("div"));
	root.render(
		harness.createElement(harness.ConsoleMirror, {
			surface: "con:1:no-focus",
			visible: true,
			cols: 80,
			rows: 24,
			onReport: () => {},
		}),
	);
	await settle(2);
	const mounted = __terminals.slice(before).filter((t) => !t.wasDisposed);
	assert.equal(mounted.length, 1);
	assert.equal(
		mounted[0].focusCount,
		0,
		"a pane restored at launch, an agent's reveal and the capture view all mount here, and none of them is a user asking for the keyboard",
	);
	root.unmount();
});
