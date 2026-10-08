import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * ESC ON THE PUSH-TO-TALK DOOR CLAIMS THE TAKE, NOT THE TURN (QA round 1, Q-1).
 *
 * The mic-button door passed round 1's fix; the PTT door did not, 3/3: holding
 * the binding mid-turn and pressing Escape cancelled the take AND killed the
 * turn (`POST .../interrupt`, `last_turn_outcome:"aborted"`). The mechanism is
 * an ORDERING one and this file drives the real one: the manager's keydown
 * listener runs in the CAPTURE phase, and its second-key abort SETTLES the
 * recording there - the settle's re-render detaches the composer's own Escape
 * listener and clears the live recording presence before any bubble listener
 * runs, so the turn interrupt's guard (whose predicate reads BOTH
 * `defaultPrevented` and the presence) found neither and fired.
 *
 * The fix is that the abort CLAIMS the press on the event itself
 * (`preventDefault`), which no later read can miss. This test drives the
 * shipped manager through its capture listener and asserts the two halves the
 * QA matrix asserted live: the take's `stop("abort")` is delivered, and the
 * interrupt's own predicate refuses the very same event.
 *
 * The manager is constructed here rather than through the React hook because
 * the hook is the only production entry point and a node test has no React to
 * mount; the module exports the class for exactly this (see its doc).
 */

/*
 * A window stand-in that records its listeners, so the capture-phase contract
 * can be driven at node level. `capture` is normalised the way the DOM does it
 * (`true` or `{ capture: true }`), because which phase a listener lands in is
 * half of what this file is about.
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
	/*
	 * The manager also subscribes the Cmd/Ctrl+Shift+S toggle over IPC; that door
	 * is not this file's subject (it is a main-process chord and not drivable
	 * headlessly), so the shim accepts the subscription and never fires it.
	 */
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

const bundle = await build({
	stdin: {
		contents: `
			export { SpeechToTextManager, SpeechToTextPriority, resolvePushToTalkBinding } from "./src/renderer/src/shared/hooks/use-speech-to-text-manager";
			export { interruptEscapeApplies } from "./src/renderer/src/features/chat/hooks/use-interrupt-on-escape";
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
	/*
	 * The desktop transport is stubbed: `register()` now kicks a settings read
	 * for the push-to-talk row (`refreshPushToTalkBinding`), and this file is
	 * about the capture-phase key contract - not IPC - so the read answers an
	 * empty settings plane and the resolver serves its platform default.
	 */
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
	`./_hold-escape-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const {
	SpeechToTextManager,
	SpeechToTextPriority,
	resolvePushToTalkBinding,
	interruptEscapeApplies,
} = await import(bundlePath.href);
await unlink(bundlePath);

/** A keydown the manager can consume, with the DOM bits it reads. */
const keyEvent = (key, code) => ({
	key,
	code,
	isComposing: false,
	repeat: false,
	defaultPrevented: false,
	preventDefault() {
		this.defaultPrevented = true;
	},
});

const captureKeydown = () =>
	listeners.find((l) => l.type === "keydown" && l.capture)?.fn;

/**
 * A fresh manager, engaged on the real binding, with the stops it delivered.
 * `prevented` is the binding's own keydown event, kept so a test can read what
 * the capture listener did to it.
 */
const engage = () => {
	/*
	 * ONE MANAGER PER TEST, and only its listeners are driven: each registration
	 * installs its own capture listener, and leaving an older one first in the
	 * array would route later tests' presses into the previous manager.
	 */
	listeners.length = 0;
	const stops = [];
	const manager = new SpeechToTextManager();
	manager.register(
		"test",
		SpeechToTextPriority.MESSAGE_INPUT,
		{
			start: () => {},
			stop: (reason) => stops.push(reason ?? "release"),
		},
		() => true,
	);
	const onKeyDown = captureKeydown();
	assert.ok(onKeyDown, "the manager installs a capture-phase keydown listener");
	const binding = resolvePushToTalkBinding();
	onKeyDown(
		keyEvent(binding.code === "AltRight" ? "Alt" : "Meta", binding.code),
	);
	return { manager, stops, onKeyDown };
};

/** The interrupt's own predicate, exactly as the page calls it. */
const interruptWouldFire = (event) =>
	interruptEscapeApplies(event, {
		sessionId: "session-under-test",
		turnAlive: true,
		available: true,
		// Deliberately false: the presence reader has already been cleared by the
		// settle's re-render on this door, which is the flip that let the old code
		// kill the turn. The claim on the EVENT is what must refuse it.
		recording: () => false,
	});

test("Escape while a hold is engaged aborts the take and claims the press", () => {
	const { stops, onKeyDown } = engage();
	const claimedEscape = keyEvent("Escape", "Escape");
	onKeyDown(claimedEscape);
	assert.deepEqual(
		stops,
		["abort"],
		"the hold's stop is delivered as an abort",
	);
	assert.equal(
		claimedEscape.defaultPrevented,
		true,
		"the abort claims the press on the event itself",
	);
});

test("the claimed press cannot reach the turn: the interrupt predicate refuses it", () => {
	const { onKeyDown } = engage();
	const claimedEscape = keyEvent("Escape", "Escape");
	onKeyDown(claimedEscape);
	assert.equal(interruptWouldFire(claimedEscape), false);
	/*
	 * The control that keeps this honest: the SAME predicate, on the SAME event
	 * shape, with no hold engaged - the claim is the only thing standing between
	 * the press and the turn.
	 */
	const unclaimed = keyEvent("Escape", "Escape");
	assert.equal(interruptWouldFire(unclaimed), true);
});

test("only Escape is claimed: an ordinary second key keeps its default", () => {
	const { stops, onKeyDown } = engage();
	const letter = keyEvent("a", "KeyA");
	onKeyDown(letter);
	assert.deepEqual(stops, ["abort"], "the combination still aborts the hold");
	assert.equal(
		letter.defaultPrevented,
		false,
		"a non-Escape key is not swallowed by the hold",
	);
});

test("a released hold still settles as a release, not an abort", () => {
	const { stops, manager } = engage();
	const keyup = listeners.find((l) => l.type === "keyup" && !l.capture)?.fn;
	assert.ok(keyup, "the manager installs the bubble keyup listener");
	const binding = resolvePushToTalkBinding();
	keyup(keyEvent(binding.code === "AltRight" ? "Alt" : "Meta", binding.code));
	assert.deepEqual(stops, ["release"]);
	manager.unregister("test");
});
