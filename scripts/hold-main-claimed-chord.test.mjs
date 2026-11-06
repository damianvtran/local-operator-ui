import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * A CHORD MAIN SWALLOWS MUST NOT LEAVE A HOLD ENGAGED (UX/review F2).
 *
 * The hold key can be Control (any platform) or Command (macOS) - the same
 * modifier the app's own shortcuts begin with. Main's `before-input-event` hook
 * (src/main/index.ts) claims two families of chord and calls `preventDefault`,
 * so the SECOND key of those chords never reaches the renderer's keydown
 * listener: the palette doors (Cmd/Ctrl+P, +Shift+P) and the Start recording
 * chord. The modifier's own keydown DID arrive first and engaged the hold, and
 * the manager's "a second key aborts the hold" rule never runs, because it is
 * driven by the key main took. Measured below as a failing test before the fix:
 * the hold stayed engaged through the palette opening, and the Start recording
 * IPC found the recording attempt already taken and did nothing.
 *
 * Main's side is not driven here (it needs a focused window; the palette door's
 * own matrix is `palette-main-door.test.mjs`). What this file drives is the
 * renderer's half of the contract: the IPC messages main sends INSTEAD of the
 * key.
 */

const listeners = [];
const ipc = new Map();
globalThis.window = {
	addEventListener: (type, fn, options) =>
		listeners.push({
			type,
			fn,
			capture: options === true || options?.capture === true,
		}),
	removeEventListener: (type, fn) => {
		const index = listeners.findIndex((l) => l.type === type && l.fn === fn);
		if (index !== -1) listeners.splice(index, 1);
	},
	electron: {
		ipcRenderer: {
			on: (channel, fn) => ipc.set(channel, fn),
			removeListener: (channel) => ipc.delete(channel),
		},
	},
};
Object.defineProperty(globalThis, "navigator", {
	value: { platform: "Win32" },
	configurable: true,
});

const bundle = await build({
	stdin: {
		contents: `export { SpeechToTextManager, SpeechToTextPriority, setPushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	external: ["react", "react-dom", "react/jsx-runtime"],
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
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
	`./_hold-main-claimed-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { SpeechToTextManager, SpeechToTextPriority, setPushToTalkBinding } =
	await import(bundlePath.href);
await unlink(bundlePath);

const keydown = (key, code) => ({
	key,
	code,
	isComposing: false,
	repeat: false,
	preventDefault() {},
});

/** A manager with Control as the hold key, engaged; returns what the handler saw. */
const engaged = () => {
	listeners.length = 0;
	ipc.clear();
	setPushToTalkBinding("ctrl-left-hold");
	const calls = [];
	let recording = false;
	const manager = new SpeechToTextManager();
	manager.register(
		"test",
		SpeechToTextPriority.MESSAGE_INPUT,
		{
			// The composer's own rule: a start while an attempt is open is a no-op.
			start: () => {
				if (recording) return calls.push("start-refused");
				recording = true;
				calls.push("start");
			},
			stop: (reason) => {
				recording = false;
				calls.push(`stop:${reason ?? "release"}`);
			},
		},
		() => true,
	);
	listeners
		.find((l) => l.type === "keydown" && l.capture)
		.fn(keydown("Control", "ControlLeft"));
	assert.deepEqual(calls, ["start"], "Control engages the hold");
	return { calls, manager };
};

test("the palette door, taken by main, aborts the hold that Control engaged", () => {
	for (const channel of [
		"toggle-command-palette",
		"toggle-command-palette-commands",
	]) {
		const { calls } = engaged();
		const handler = ipc.get(channel);
		assert.ok(handler, `the manager hears ${channel}`);
		handler();
		assert.deepEqual(calls, ["start", "stop:abort"], channel);
	}
});

test("the Start recording chord, taken by main, replaces the hold with a recording", () => {
	const { calls } = engaged();
	ipc.get("start-speech-to-text")();
	assert.deepEqual(
		calls,
		["start", "stop:abort", "start"],
		"the hold is aborted and the chord's own start lands",
	);
});

test("with no hold engaged the Start recording chord still just starts", () => {
	listeners.length = 0;
	ipc.clear();
	const calls = [];
	const manager = new SpeechToTextManager();
	manager.register(
		"test",
		SpeechToTextPriority.MESSAGE_INPUT,
		{ start: () => calls.push("start"), stop: (r) => calls.push(`stop:${r}`) },
		() => true,
	);
	ipc.get("start-speech-to-text")();
	assert.deepEqual(calls, ["start"]);
});

test("the two palette channels are the ones main actually sends on", () => {
	const main = readFileSync("src/main/palette-door.ts", "utf8");
	const manager = readFileSync(
		"src/renderer/src/shared/hooks/use-speech-to-text-manager.ts",
		"utf8",
	);
	for (const channel of [
		"toggle-command-palette",
		"toggle-command-palette-commands",
	]) {
		assert.ok(main.includes(`"${channel}"`), `main sends ${channel}`);
		assert.ok(manager.includes(`"${channel}"`), `the manager hears ${channel}`);
	}
});
