import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * SPACE-HOLD DICTATION MUST ONLY ENGAGE ON DEAD SPACE (focus +
 * auto-repeat), AND THE SIDEBAR SCROLLER MUST NOT SCROLL ON SPACE.
 *
 * The operator report: focus sits somewhere invisible (the sidebar's scroller
 * `<div tabIndex={-1} data-sidebar-region="scroller">`, focused by a click on
 * its empty area, no focus ring), holding Space starts voice dictation, and
 * Chromium's own Space action scrolls the sidebar to the bottom.
 *
 * Root causes, driven here against the shipped manager:
 *  (a) `spaceFocusGuardRefuses()` refused bare-Space only for
 *      INPUT/TEXTAREA/contentEditable. Any other focused element — the
 *      scroller, a button, a link — let Space engage dictation. The legacy
 *      gesture is 'hold Space, outside any editable field', meant for DEAD
 *      space (focus on body), not an orphaned focus target.
 *  (b) The `event.repeat` branch returned before `engage()`, so only the
 *      first keydown got `preventDefault`; every auto-repeat keydown kept
 *      Chromium's default Space action = page-scroll of the focused scroller.
 *  (c) The sidebar scroller itself never ignored Space.
 *
 * Fix: bare-Space engages only when `document.activeElement` is null, body or
 * the document element; a repeating key for an engaged hold calls
 * `preventDefault()` before returning; the scroller calls `preventDefault()`
 * when Space lands on the scroller itself (rows keep their own behaviour).
 */

const listeners = [];
globalThis.window = {
	addEventListener: (type, fn, options) => {
		listeners.push({
			type,
			fn,
			capture: options === true || options?.capture === true,
		});
	},
	removeEventListener: (type, fn) => {
		const index = listeners.findIndex((l) => l.type === type && l.fn === fn);
		if (index !== -1) listeners.splice(index, 1);
	},
	electron: {
		ipcRenderer: {
			on: () => {},
			removeListener: () => {},
		},
	},
};
Object.defineProperty(globalThis, "navigator", {
	value: { platform: "MacIntel" },
	configurable: true,
});

// A mutable document stand-in — the manager reads `document.activeElement`
// live at key time, so each case sets the element it needs.
const fakeBody = { tagName: "BODY" };
const fakeDocumentElement = { tagName: "HTML" };
const fakeDocument = {
	activeElement: fakeBody,
	body: fakeBody,
	documentElement: fakeDocumentElement,
};
globalThis.document = fakeDocument;

const managerBundle = await build({
	stdin: {
		contents: `
			export { SpeechToTextManager, SpeechToTextPriority, resolvePushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: { ".css": "empty", ".svg": "text" },
	define: { "import.meta.env": "{}" },
	plugins: [
		{
			name: "headless-fixtures",
			setup(builder) {
				builder.onResolve(
					{ filter: /^@shared\/api\/local-operator\/desktop-api$/ },
					() => ({ path: "desktop-api", namespace: "fixture" }),
				);
				builder.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
					contents:
						"export function desktopResult() { return Promise.resolve({ sections: [], settings: [] }); }",
					loader: "js",
				}));
			},
		},
	],
	write: false,
});
const bundlePath = new URL(
	`./_space-hold-focus-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, managerBundle.outputFiles[0].text);
const { SpeechToTextManager, SpeechToTextPriority, resolvePushToTalkBinding } =
	await import(bundlePath.href);
await unlink(bundlePath);

/*
 * The sidebar helper is bundled in memory from its shipped TS (the
 * `sidebar-focus-hold.ts` pattern): it imports nothing, and importing it
 * into the manager bundle above would keep the two subjects' failure modes
 * (an unresolved side file) fused into one.
 */
const helperBundle = await build({
	stdin: {
		contents:
			'export * from "./src/renderer/src/features/chat/sidebar-space-dead";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { sidebarScrollerSpaceIsDead } = await import(
	`data:text/javascript;base64,${Buffer.from(helperBundle.outputFiles[0].text).toString("base64")}`
);

const keyEvent = ({ key = " ", code = "Space", repeat = false } = {}) => ({
	key,
	code,
	isComposing: false,
	repeat,
	defaultPrevented: false,
	preventDefault() {
		this.defaultPrevented = true;
	},
});

const captureKeydown = () =>
	listeners.find((l) => l.type === "keydown" && l.capture)?.fn;

const managerWithHandler = () => {
	listeners.length = 0;
	const starts = [];
	const stops = [];
	const manager = new SpeechToTextManager();
	manager.register(
		"test",
		SpeechToTextPriority.MESSAGE_INPUT,
		{
			start: () => starts.push("start"),
			stop: (reason) => stops.push(reason ?? "release"),
		},
		() => true,
	);
	const onKeyDown = captureKeydown();
	assert.ok(onKeyDown, "the manager installs a capture-phase keydown listener");
	// The registration kicks an async binding refresh; settle it so the
	// resolver serves the platform default deterministically.
	return { manager, starts, stops, onKeyDown };
};

const setFocus = (element) => {
	fakeDocument.activeElement = element;
};

const scrollerStandIn = () => ({
	tagName: "DIV",
	isContentEditable: false,
	tabIndex: -1,
	dataset: { sidebarRegion: "scroller" },
});

test("Space with a focused scroller div refuses dictation and never preventDefaults", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(scrollerStandIn());
	const event = keyEvent();
	onKeyDown(event);
	assert.deepEqual(starts, [], "dictation must not engage on the scroller");
	assert.equal(
		event.defaultPrevented,
		false,
		"the refused press is not claimed",
	);
});

test("Space with a focused BUTTON refuses dictation", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus({ tagName: "BUTTON", isContentEditable: false });
	const event = keyEvent();
	onKeyDown(event);
	assert.deepEqual(starts, [], "dictation must not engage on a button");
	assert.equal(event.defaultPrevented, false);
});

test("Space with a focused INPUT or TEXTAREA still refuses", () => {
	for (const tagName of ["INPUT", "TEXTAREA"]) {
		const { starts, onKeyDown } = managerWithHandler();
		setFocus({ tagName, isContentEditable: false });
		const event = keyEvent();
		onKeyDown(event);
		assert.deepEqual(starts, [], `dictation must not engage on ${tagName}`);
		assert.equal(event.defaultPrevented, false);
	}
});

test("Space on body engages dictation and the first keydown is claimed", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(fakeBody);
	const event = keyEvent();
	onKeyDown(event);
	assert.deepEqual(starts, ["start"], "dictation engages on dead space");
	assert.equal(event.defaultPrevented, true, "engage claims the press");
});

test("Space with no active element engages dictation", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(null);
	const event = keyEvent();
	onKeyDown(event);
	assert.deepEqual(starts, ["start"]);
	assert.equal(event.defaultPrevented, true);
});

test("Space on the document element engages dictation", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(fakeDocumentElement);
	const event = keyEvent();
	onKeyDown(event);
	assert.deepEqual(starts, ["start"]);
	assert.equal(event.defaultPrevented, true);
});

test("an auto-repeat while engaged is claimed so the scroller never scrolls", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(fakeBody);
	onKeyDown(keyEvent());
	const repeat = keyEvent({ repeat: true });
	onKeyDown(repeat);
	assert.deepEqual(starts, ["start"], "a repeat never re-engages");
	assert.equal(
		repeat.defaultPrevented,
		true,
		"the hold owns the key until keyup",
	);
});

test("an auto-repeat while NOT engaged is ignored without claiming", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(fakeBody);
	const repeat = keyEvent({ repeat: true });
	onKeyDown(repeat);
	assert.deepEqual(starts, [], "a lone repeat starts nothing");
	assert.equal(
		repeat.defaultPrevented,
		false,
		"nothing to hold, nothing claimed",
	);
});

test("the modifier PTT binding still engages with a focused element", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(scrollerStandIn());
	const binding = resolvePushToTalkBinding();
	const event = keyEvent({
		key: binding.code === "AltRight" ? "Alt" : "Meta",
		code: binding.code,
	});
	onKeyDown(event);
	assert.deepEqual(
		starts,
		["start"],
		"the modifier binding never consults the guard",
	);
	assert.equal(event.defaultPrevented, true);
});

test("the scroller Space predicate is true only for Space on the scroller itself", () => {
	const scroller = {};
	const row = {};
	assert.equal(
		sidebarScrollerSpaceIsDead({
			target: scroller,
			currentTarget: scroller,
			code: "Space",
			key: " ",
		}),
		true,
		"Space landing on the scroller is dead",
	);
	assert.equal(
		sidebarScrollerSpaceIsDead({
			target: row,
			currentTarget: scroller,
			code: "Space",
			key: " ",
		}),
		false,
		"a focused row keeps its own Space behaviour",
	);
	assert.equal(
		sidebarScrollerSpaceIsDead({
			target: scroller,
			currentTarget: scroller,
			code: "Enter",
			key: "Enter",
		}),
		false,
		"non-Space keys are untouched",
	);
	assert.equal(
		sidebarScrollerSpaceIsDead({
			target: scroller,
			currentTarget: scroller,
			code: "ArrowDown",
			key: "ArrowDown",
		}),
		false,
		"arrows keep scrolling the list",
	);
});

test("chat-sidebar.tsx wires the scroller predicate onto the scroller region", () => {
	const source = readFileSync(
		"src/renderer/src/features/chat/components/chat-sidebar.tsx",
		"utf8",
	);
	const scrollerIndex = source.indexOf('data-sidebar-region="scroller"');
	assert.ok(scrollerIndex !== -1, "the scroller region exists");
	const after = source.slice(scrollerIndex, scrollerIndex + 1200);
	assert.match(
		after,
		/onKeyDown=\{claimDeadSpace\}/,
		"the scroller's keydown claims dead space",
	);
	const helper = source;
	assert.ok(
		helper.includes("sidebarScrollerSpaceIsDead(event)") &&
			helper.includes("claimDeadSpace"),
		"the handler consults sidebarScrollerSpaceIsDead",
	);
});
