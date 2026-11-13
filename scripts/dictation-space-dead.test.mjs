import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * BARE SPACE NEVER ENGAGES DICTATION (the legacy hold gesture is deleted),
 * AND THE SIDEBAR SCROLLER MUST NOT SCROLL ON SPACE.
 *
 * The bare-Space hold ("hold Space on dead space to dictate") was removed:
 * it engaged dictation from a dead-space focus that a user in the composer
 * did not expect, and its form on dead space was never the documented door.
 * The modifier PTT binding (e.g. `alt-right-hold`) is the remaining hold
 * door. What survives here: the sidebar scroller's own Space-is-dead
 * predicate (`sidebar-space-dead.ts`, kept from the same round) so Space
 * landing on the scroller never page-scrolls the conversation list.
 *
 * This file pins: (1) Space NEVER engages, whatever the focus (body, null,
 * document element, scroller, button, input, textarea), and is never
 * claimed; (2) the PTT modifier still engages with a focused element;
 * (3) the scroller predicate and its chat-sidebar wiring.
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
	`./_dictation-space-dead-${process.pid}.mjs`,
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

test("Space never engages dictation, whatever the focus, and is never claimed", () => {
	// The bare-Space hold is deleted: handler.start must NOT be called and
	// the keydown must NOT be prevented, on any of these focuses.
	const focuses = [
		fakeBody,
		null,
		fakeDocumentElement,
		scrollerStandIn(),
		{ tagName: "BUTTON", isContentEditable: false },
		{ tagName: "INPUT", isContentEditable: false },
		{ tagName: "TEXTAREA", isContentEditable: false },
	];
	for (const element of focuses) {
		const { starts, onKeyDown } = managerWithHandler();
		setFocus(element);
		const event = keyEvent();
		onKeyDown(event);
		assert.deepEqual(
			starts,
			[],
			`dictation must not engage with focus ${element?.tagName ?? "null"}`,
		);
		assert.equal(event.defaultPrevented, false, "Space is never claimed");
	}
});

test("an auto-repeat of the PTT key while engaged is claimed (the hold owns the key)", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(fakeBody);
	const binding = resolvePushToTalkBinding();
	assert.ok(binding, "a PTT binding is resolved by default");
	const first = keyEvent({
		key: binding.code === "AltRight" ? "Alt" : "Meta",
		code: binding.code,
	});
	onKeyDown(first);
	const repeat = keyEvent({
		key: binding.code === "AltRight" ? "Alt" : "Meta",
		code: binding.code,
		repeat: true,
	});
	onKeyDown(repeat);
	assert.deepEqual(starts, ["start"], "a repeat never re-engages");
	assert.equal(
		repeat.defaultPrevented,
		true,
		"the hold owns the key until keyup",
	);
});

test("the modifier PTT binding still engages with a focused element", () => {
	const { starts, onKeyDown } = managerWithHandler();
	setFocus(scrollerStandIn());
	const binding = resolvePushToTalkBinding();
	assert.ok(binding, "a PTT binding is resolved by default");
	const event = keyEvent({
		key: binding.code === "AltRight" ? "Alt" : "Meta",
		code: binding.code,
	});
	onKeyDown(event);
	assert.deepEqual(
		starts,
		["start"],
		"the modifier binding engages regardless of focus",
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
