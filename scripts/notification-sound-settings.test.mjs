import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * SETTINGS -> NOTIFICATIONS, rendered from the shipped component against the
 * daemon's own wire shapes (local-operator #3403).
 *
 *     node --test scripts/notification-sound-settings.test.mjs
 *
 * WHAT IT BINDS. The interactions the settings spec makes promises about, on
 * the real section with a stubbed desktop bridge:
 *
 *  - choosing a row plays it once at the current volume, through the daemon's
 *    gain-baked render (`?volume=`), and writes `notifications.sound.id` ONCE,
 *    400ms after the last change (§3.2, C5);
 *  - first load plays nothing (only the user's act plays);
 *  - a failed save reverts the radio to the saved value and offers Retry;
 *  - the System row has no preview, and selecting it disables the slider;
 *  - sound off and notifications off grey nothing out (C2) and say why;
 *  - an old backend gets one line in place of the Sound group, and is never
 *    asked for the listing;
 *  - remove of the selected sound names the fallback BEFORE the act, then the
 *    radio moves to Soft pulse WITHOUT playing (§5.4, C4);
 *  - an upload refused `too_long` becomes an error row with its own sentence
 *    and "Choose another file", never a trim (C10); one accepted file is
 *    selected and played (§5.1);
 *  - the Backend list no longer renders the promoted keys, and a deep link to
 *    any of them resolves to this section.
 *
 * NO SOUND REACHES A DEVICE. `globalThis.Audio` is a fake installed before the
 * engine module loads (the guard in `audio-engine.test.mjs`), and jsdom has no
 * audio output at all.
 *
 * The harness is `speech-settings.test.mjs`'s: esbuild bundles the shipped
 * component against the renderer's aliases, jsdom with a real React root.
 */

const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// A few jsdom accessors refuse to be read out of context.
	}
}
globalThis.window = bootstrapDOM.window;
/*
 * jsdom's own File, not Node's: the component reads a chosen file with
 * jsdom's `FileReader`, which refuses a Blob from another realm. (A real
 * renderer has one realm, so this is the harness's constraint only.)
 */
globalThis.File = bootstrapDOM.window.File;
globalThis.Blob = bootstrapDOM.window.Blob;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.sessionStorage = bootstrapDOM.window.sessionStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// Radix measures elements it positions; jsdom has no ResizeObserver.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.window.ResizeObserver = globalThis.ResizeObserver;
// Blob URLs: jsdom has no object-URL store; the engine only needs a string.
let blobCounter = 0;
globalThis.URL.createObjectURL = () => `blob:fake-${++blobCounter}`;
globalThis.URL.revokeObjectURL = () => {};

/** The fake element the engine plays. It never reaches a device. */
const played = [];
class FakeAudio {
	constructor() {
		this.src = null;
		this.paused = true;
		this.currentTime = 0;
		this.duration = 0;
		this.volume = 1;
		this.playbackRate = 1;
		this.preload = "";
	}
	play() {
		played.push(this.src);
		this.paused = false;
		return Promise.resolve();
	}
	pause() {
		this.paused = true;
	}
	removeAttribute(name) {
		if (name === "src") this.src = null;
	}
	load() {}
	addEventListener() {}
	removeEventListener() {}
}
globalThis.Audio = FakeAudio;
globalThis.window.Audio = FakeAudio;

const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

globalThis.window.api = {
	backend: {
		getStatus: async () => ({ state: "attached", url: "http://127.0.0.1:9/" }),
	},
	desktop: {
		request: async () => ({ status: 200, body: { result: {} } }),
		media: async () => ({ status: 500, kind: "error", detail: "unset" }),
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { NotificationsSection } from "./src/renderer/src/features/settings/components/notifications-section";
			export { BackendSettingsSection } from "./src/renderer/src/features/settings/components/backend-settings-section";
			export { sectionForSettingKey } from "./src/renderer/src/features/settings/promoted-setting-sections";
			export { useAudioEngineStore } from "./src/renderer/src/shared/store/audio-engine-store";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	write: false,
});
const bundlePath = new URL(
	"./_notification-sound-settings.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	NotificationsSection,
	BackendSettingsSection,
	sectionForSettingKey,
	useAudioEngineStore,
	createElement,
} = await import(bundlePath.href);

const registry = JSON.parse(
	readFileSync("scripts/fixtures/backend-settings-registry.json", "utf8"),
);

const BUILTINS = [
	["soft-pulse", "Soft pulse"],
	["two-note-chime", "Two-note chime"],
	["felt-marimba", "Felt marimba"],
];
const CUSTOM_ID = "custom-brass-ping-3fa9c1";

/**
 * One fake daemon. `state` is mutable so a write is visible to the next read,
 * the way the real config file is.
 */
const makeDaemon = (options = {}) => {
	const state = {
		notificationsOn: options.notificationsOn ?? true,
		soundOn: options.soundOn ?? true,
		selected: options.selected ?? "soft-pulse",
		volume: options.volume ?? 70,
		custom: options.custom ?? [
			{ id: CUSTOM_ID, label: "Brass ping", duration_s: 2.1 },
		],
	};
	const asked = [];
	const media = [];
	const edits = [];
	const row = (key, kind, value, def, extra = {}) => ({
		key,
		section: "notification_sound",
		label: key,
		kind,
		help: "",
		value,
		default: def,
		is_default: value === def,
		minimum: null,
		maximum: null,
		members: [],
		choices: [],
		empty_unsets: false,
		redacted: false,
		warning: "",
		placeholder: "",
		gated_by: null,
		state_note: "",
		read_only: false,
		hotkey_scope: "",
		unit: "",
		...extra,
	});
	const settings = () => {
		const base = registry.settings.map((setting) =>
			setting.key === "display.notifications"
				? { ...setting, value: state.notificationsOn }
				: setting,
		);
		const sound = [
			row("notifications.sound.enabled", "bool", state.soundOn, true),
			row("notifications.sound.id", "enum", state.selected, "soft-pulse"),
			...(options.missingVolume
				? []
				: [
						row("notifications.sound.volume", "int", state.volume, 70, {
							minimum: 0,
							maximum: 100,
							unit: "percent",
						}),
					]),
		];
		return { sections: registry.sections, settings: [...base, ...sound] };
	};
	const listing = () => ({
		sounds: [
			...BUILTINS.map(([id, label]) => ({
				id,
				label,
				builtin: true,
				duration_s: 0.9,
				is_default: id === "soft-pulse",
			})),
			{
				id: "system",
				label: "System sound",
				builtin: true,
				duration_s: null,
				is_default: false,
			},
			...state.custom.map((sound) => ({
				...sound,
				builtin: false,
				is_default: false,
			})),
		],
		selected: state.selected,
		enabled: state.soundOn,
		volume: state.volume,
		limits: {
			max_sounds: 50,
			max_bytes: 10485760,
			max_duration_s: 10,
			max_name_chars: 40,
		},
	});
	const ok = (result) => ({
		status: 200,
		body: { status: 200, message: "ok", result },
	});
	const request = async (input) => {
		asked.push(input.op);
		switch (input.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						settings: 1,
						desktop_feed: 1,
						...(options.older ? {} : { notification_sounds: 1 }),
					},
				});
			case "settings.list":
				if (options.settingsFail)
					return {
						status: 503,
						body: { detail: "The server is not answering." },
					};
				return ok(settings());
			case "settings.edit": {
				edits.push({ key: input.key, value: input.value });
				if (options.failEdits)
					return {
						status: 503,
						body: {
							detail: {
								code: "backend_unavailable",
								text: "The backend could not complete this request.",
							},
						},
					};
				// A test can hold the FIRST write of a key open (review r2, M3).
				if (
					options.holdFirstEdit?.key === input.key &&
					!options.holdFirstEdit.used
				) {
					options.holdFirstEdit.used = true;
					await options.holdFirstEdit.gate;
				} else if (
					options.holdFirstEdit?.key === input.key &&
					options.holdFirstEdit.second
				) {
					// The second write waits too, so the first one's refetch lands
					// in between: the window where a stale prop could flip the switch.
					await options.holdFirstEdit.second;
				}
				if (options.saveFails && input.key === "notifications.sound.id")
					return {
						status: 503,
						body: {
							detail: {
								code: "setting_write_failed",
								text: "The settings file could not be written.",
							},
						},
					};
				if (input.key === "display.notifications")
					state.notificationsOn = input.value;
				if (input.key === "notifications.sound.enabled")
					state.soundOn = input.value;
				if (input.key === "notifications.sound.id")
					state.selected = input.value;
				if (input.key === "notifications.sound.volume")
					state.volume = input.value;
				return ok({});
			}
			case "settings.reset":
				edits.push({ key: input.key, reset: true });
				if (input.key === "notifications.sound.volume") state.volume = 70;
				return ok({});
			case "notification_sounds.list":
				if (options.listingFails)
					return { status: 500, body: { detail: "store unreadable" } };
				return ok(listing());
			case "notification_sounds.remove": {
				const wasSelected = state.selected === input.id;
				state.custom = state.custom.filter((sound) => sound.id !== input.id);
				if (wasSelected) state.selected = "soft-pulse";
				return ok({
					id: input.id,
					selection_reset: wasSelected,
					...(wasSelected ? { selected: "soft-pulse" } : {}),
				});
			}
			case "notification_sounds.rename": {
				const sound = state.custom.find((entry) => entry.id === input.id);
				if (sound) sound.label = input.name;
				return ok({ id: input.id, label: input.name });
			}
			default:
				return {
					status: 404,
					body: { detail: { code: "not_implemented", message: input.op } },
				};
		}
	};
	const mediaHandler = async (input, bytes) => {
		media.push({ request: input, bytes: bytes?.byteLength ?? 0 });
		// A test can hold the upload open to reach the "processing" phase.
		if (input.op === "notification_sounds.upload" && options.uploadGate)
			await options.uploadGate;
		if (input.op === "notification_sounds.audio")
			return {
				status: 200,
				kind: "bytes",
				mimeType: "audio/wav",
				data: new Uint8Array([82, 73, 70, 70]),
			};
		if (input.op === "notification_sounds.upload") {
			if (input.fileName.includes("long"))
				return {
					status: 422,
					kind: "error",
					detail: "too long",
					refusal: { code: "too_long", params: { seconds: "184.2" } },
				};
			const stem = input.name ?? "sound";
			const id = `custom-${stem}-000001`;
			state.custom.push({ id, label: stem, duration_s: 1.2 });
			return {
				status: 201,
				kind: "json",
				body: { status: 201, message: "Sound added.", result: { id } },
			};
		}
		return { status: 404, kind: "error", detail: "not here" };
	};
	return { state, asked, media, edits, request, media_: mediaHandler, options };
};

/** The desktop feed, faked: a test pushes frames through `emitFrame`. */
const feedListeners = new Set();
let feedSeq = 0;
const emitFrame = async (changedKeys) => {
	await act(async () => {
		for (const listener of feedListeners)
			listener({
				type: "config",
				epoch: "e1",
				seq: ++feedSeq,
				payload: { changed_keys: changedKeys, language: "en" },
			});
	});
};
const installBridge = (daemon) => {
	globalThis.window.api.desktop.request = daemon.request;
	globalThis.window.api.desktop.media = daemon.media_;
	globalThis.window.api.desktop.feed = {
		subscribe: (onFrame) => {
			feedListeners.add(onFrame);
			return () => feedListeners.delete(onFrame);
		},
		watchState: (onState) => {
			onState({ connected: true });
			return () => {};
		},
	};
};

const settle = async (turns = 4, ms = 0) => {
	for (let turn = 0; turn < turns; turn += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, ms));
		});
	}
};

/** One readable line naming the predicate a failed wait was watching. */
const describePredicate = (predicate) =>
	String(predicate)
		.replace(/\s+/g, " ")
		.trim()
		.replace(/^\(?\s*\)?\s*=>\s*/, "")
		.slice(0, 300);

/*
 * A TIMEOUT IS LOUD, AND NAMES THE WAIT THAT MISSED.
 *
 * This used to return `false` when its bound expired. A starved runner then
 * failed the test at whatever assertion came next, naming a symptom instead of
 * the wait that never settled: Q8 ("the section-level Retry also reloads the
 * sound list") reddened on
 *
 *     assert.ok(!container.textContent.includes("Couldn't load"),
 *               "one Retry recovers both reads");
 *
 * while the `waitFor` above it had already timed out unnoticed, and the file
 * carries no evidence the read ever re-failed (run 42543029193, shard 0/4, head
 * 186a8b1b: the same window measured 61 ms healthy against a 3 s bound, so the
 * miss was runner starvation - ~50x the same work - not a logic race). Two
 * sightings of one message three lines from the cause is what this fixes.
 *
 * NOTHING DEPENDED ON THE `false`: all 28 call sites are bare `await waitFor`
 * (29 before this change - Q8's is now `drainReads`), none reads the result
 * (audited when this changed). A site that wants "this never happens" must
 * assert absence of its own accord, not wait for it.
 *
 * THE BOUND IS A HANG GUARD, NOT A PERFORMANCE ASSERTION. Prefer a condition
 * that settles on its own (`drainReads` below) where one exists; a bound is for
 * the case where nothing will ever change.
 */
const waitFor = async (predicate, timeout = 2000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await settle(1, 20);
	}
	// One last look: the final turn may have made it true.
	if (predicate()) return true;
	throw new Error(
		`waitFor timed out after ${timeout}ms waiting for: ${describePredicate(predicate)}`,
	);
};

/*
 * Wait for the section's reads to settle, bounded in work units AND wall time.
 *
 * TWO INSTRUMENTS, TWO FAILURE MODES - neither one alone covers both:
 *
 *  - A CPU-STARVED RUNNER stretches the same work 50x in wall time (Q8's window
 *    measured 61 ms on an idle host against over 3 s on CI shard 0/4 of run
 *    42543029193), so a wall clock expires while the fixture is healthy. Act
 *    turns stretch with the host, so a turn budget is the honest unit there:
 *    200 turns is ~250 ms idle and buys less work the busier the host is.
 *  - A SLOW-BUT-PROGRESSING READ PATH (a read debounce, `retry: true`) burns
 *    wall time without consuming extra turns, so a turn budget is the wrong
 *    unit there: at 200 turns, a 1.5 s read delay exhausted the whole budget in
 *    the time 200 turns take - measured here at 1.16-2.76 ms/turn, so 230-550 ms
 *    - and failed 3/3 with both reads still fetching, where the 3 s wall clock
 *    this replaced passed that same injection 3/3. That is the regression this
 *    floor closes: ~250 ms against 3000 ms, the 12x tighter bound the reviewer
 *    measured, failing with a message that reads exactly like a product hang.
 *
 * So the wait ends when the reads are QUIET, or at the 3000 ms floor - never at a
 * spent turn budget, which is exactly what makes the floor a floor (`turn <
 * turns || Date.now() < deadline`): slow-but-progressing reads outlive the turn
 * budget and still settle. The floor is 3000 ms because that is the exact bound
 * this replaces; anything below it is tighter than the thing it superseded,
 * which is how the 200-turn-only version regressed. The turn budget is what
 * carries a starved host (3000 ms buys far fewer turns there), so its spent
 * count is reported with the failure - a large count says the work kept
 * churning, a tiny one says the host was slow.
 *
 * Quiescence is still the state that carries meaning (the harness answers every
 * request itself, so the sequence completes in a bounded number of turns
 * whatever the host); the budgets exist only so a cache that never quiets fails
 * LOUDLY, naming the bound that tripped and what was still fetching.
 */
const drainReads = async (client, { turns = 200, ms = 3000 } = {}) => {
	const started = Date.now();
	const deadline = started + ms;
	const inFlight = () =>
		client
			.getQueryCache()
			.findAll()
			.filter((query) => query.state.fetchStatus === "fetching")
			.map((query) => query.queryKey.join("/"));
	let turn = 0;
	while (turn < turns || Date.now() < deadline) {
		turn += 1;
		await settle(1, 0);
		if (inFlight().length > 0) continue;
		// Quiet, but the settled state still has to reach React.
		await settle(1, 0);
		if (inFlight().length === 0) return;
	}
	throw new Error(
		`reads never went quiet: the ${ms}ms floor spent after ${
			Date.now() - started
		}ms and ${turn} turns (turn budget ${turns}); still fetching: ${
			inFlight().join(", ") || "(none - the state kept changing)"
		}`,
	);
};

/** Mount the section; teardown is armed first (speech-settings' rule). */
const mount = async (t, daemon, props = {}) => {
	const mounted = {};
	t.after(async () => {
		await act(async () => {
			try {
				mounted.root?.unmount();
			} finally {
				mounted.client?.clear();
			}
		});
		mounted.container?.remove();
		useAudioEngineStore.getState().stop();
	});
	played.length = 0;
	installBridge(daemon);
	mounted.client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	mounted.container = document.createElement("div");
	document.body.appendChild(mounted.container);
	mounted.root = createRoot(mounted.container);
	await act(async () => {
		mounted.root.render(
			createElement(
				QueryClientProvider,
				{ client: mounted.client },
				createElement(NotificationsSection, props),
			),
		);
	});
	await waitFor(
		() =>
			mounted.container.querySelector("[role=radiogroup]") !== null ||
			mounted.container.textContent.includes("need a newer") ||
			mounted.container.textContent.includes("Couldn't load"),
	);
	await settle(3);
	// `client` is exposed for `drainReads`, which reads the cache's own state.
	return { container: mounted.container, client: mounted.client };
};

const radio = (container, id) =>
	container.querySelector(`#notification-sound-${id}`);

const click = async (node) => {
	await act(async () => {
		node.dispatchEvent(
			new window.MouseEvent("pointerdown", { bubbles: true, button: 0 }),
		);
		node.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true }));
		node.dispatchEvent(new window.MouseEvent("pointerup", { bubbles: true }));
		node.dispatchEvent(new window.MouseEvent("mouseup", { bubbles: true }));
		node.click();
	});
};

const audioAsks = (daemon) =>
	daemon.media.filter(
		(entry) => entry.request.op === "notification_sounds.audio",
	);

const addFiles = async (container, files) => {
	const input = container.querySelector('input[type="file"]');
	assert.ok(input, "the hidden file input exists");
	Object.defineProperty(input, "files", { configurable: true, value: files });
	await act(async () => {
		input.dispatchEvent(new window.Event("change", { bubbles: true }));
	});
};

/* ------------------------------------------------------------- the tests */

test("first load renders the list and plays nothing", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	const radios = container.querySelectorAll("[role=radio]");
	assert.equal(radios.length, 5, "3 built-ins + System + 1 custom");
	assert.equal(
		radio(container, "soft-pulse").getAttribute("data-state"),
		"checked",
	);
	assert.match(container.textContent, /Default/);
	assert.match(container.textContent, /70% · Default/);
	assert.deepEqual(audioAsks(daemon), [], "a non-user selection never plays");
	assert.ok(daemon.asked.includes("notification_sounds.list"));
});

test("choosing a row plays it at the current volume and writes once after 400ms", async (t) => {
	const daemon = makeDaemon({ volume: 45 });
	const { container } = await mount(t, daemon);
	await click(radio(container, "two-note-chime"));
	await click(radio(container, "felt-marimba"));
	await settle(2);
	assert.equal(
		radio(container, "felt-marimba").getAttribute("data-state"),
		"checked",
	);
	const asks = audioAsks(daemon).map((entry) => [
		entry.request.soundId,
		entry.request.volume,
	]);
	assert.deepEqual(asks, [
		["two-note-chime", 45],
		["felt-marimba", 45],
	]);
	assert.deepEqual(daemon.edits, [], "no write inside the debounce window");
	await settle(10, 60);
	assert.deepEqual(daemon.edits, [
		{ key: "notifications.sound.id", value: "felt-marimba" },
	]);
	assert.ok(played.length >= 1, "the fake element was started");
});

test("a failed save reverts to the saved sound and offers Retry", async (t) => {
	const daemon = makeDaemon({ saveFails: true });
	const { container } = await mount(t, daemon);
	await click(radio(container, "two-note-chime"));
	await settle(10, 60);
	await waitFor(() => container.textContent.includes("Couldn't save"));
	assert.match(
		container.textContent,
		/Couldn't save your sound\. The settings file could not be written\./,
	);
	assert.equal(
		radio(container, "soft-pulse").getAttribute("data-state"),
		"checked",
	);
	const retry = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === "Retry",
	);
	assert.ok(retry, "Retry is offered");
});

test("the System row has no preview, and choosing it disables the slider", async (t) => {
	const daemon = makeDaemon({ selected: "system" });
	const { container } = await mount(t, daemon);
	assert.equal(container.querySelector('[data-preview="system"]'), null);
	assert.ok(container.querySelector('[data-preview="soft-pulse"]'));
	const range = container.querySelector('input[type="range"]');
	assert.equal(range.disabled, true);
	assert.match(
		container.textContent,
		/Volume doesn't change the system sound\./,
	);
});

test("sound off greys nothing out and keeps the choice", async (t) => {
	const daemon = makeDaemon({ soundOn: false });
	const { container } = await mount(t, daemon);
	assert.match(
		container.textContent,
		/Banners are silent\. Your choice below is kept\./,
	);
	for (const node of container.querySelectorAll("[role=radio]"))
		assert.equal(node.hasAttribute("data-disabled"), false);
	assert.equal(container.querySelector('input[type="range"]').disabled, false);
});

test("notifications off: the notice turns them on through the promoted switch", async (t) => {
	const daemon = makeDaemon({ notificationsOn: false });
	const { container } = await mount(t, daemon);
	assert.match(
		container.textContent,
		/Notifications are off, so no sounds play\./,
	);
	const action = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === "Turn on notifications",
	);
	await click(action);
	await settle(4, 20);
	assert.deepEqual(daemon.edits[0], {
		key: "display.notifications",
		value: true,
	});
	await waitFor(() => !container.textContent.includes("Notifications are off"));
	assert.doesNotMatch(container.textContent, /Notifications are off/);
});

test("an old backend gets one line and is never asked for the listing", async (t) => {
	const daemon = makeDaemon({ older: true });
	const { container } = await mount(t, daemon);
	assert.match(
		container.textContent,
		/Notification sounds need a newer Local Operator\./,
	);
	assert.equal(daemon.asked.includes("notification_sounds.list"), false);
	assert.match(
		container.textContent,
		/Desktop notifications/,
		"the master switch still renders",
	);
	assert.equal(container.querySelector("[role=radiogroup]"), null);
});

test("a failed listing keeps the switch and volume usable, with Retry", async (t) => {
	const daemon = makeDaemon({ listingFails: true });
	const { container } = await mount(t, daemon);
	await waitFor(() => container.textContent.includes("Couldn't load"));
	assert.match(container.textContent, /Couldn't load notification sounds\./);
	assert.ok(container.querySelector('input[type="range"]'));
});

test("a missing registry key is named, not silently dropped", async (t) => {
	const daemon = makeDaemon({ missingVolume: true });
	const { container } = await mount(t, daemon);
	assert.match(container.textContent, /notifications\.sound\.volume/);
	assert.equal(container.querySelector('input[type="range"]'), null);
});

test("removing the selected sound names the fallback first, then resets silently", async (t) => {
	const daemon = makeDaemon({ selected: CUSTOM_ID });
	const { container } = await mount(t, daemon, {
		listPresets: {
			initialMode: {
				id: CUSTOM_ID,
				mode: { kind: "confirm-remove", removing: false, error: null },
			},
		},
	});
	assert.match(
		container.textContent,
		/Remove Brass ping\? It's your current sound, so Soft pulse plays instead\./,
	);
	const remove = [...container.querySelectorAll("button")].find(
		(node) => node.textContent === "Remove",
	);
	await click(remove);
	await waitFor(() => radio(container, CUSTOM_ID) === null);
	await settle(4, 20);
	assert.equal(
		radio(container, "soft-pulse").getAttribute("data-state"),
		"checked",
	);
	assert.deepEqual(
		audioAsks(daemon),
		[],
		"the reset is not a choice, so it does not play",
	);
	assert.match(
		container.querySelector("output.sr-only").textContent,
		/Soft pulse is selected again/,
	);
});

test("rename saves through the daemon and rejects an empty name inline", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon, {
		listPresets: {
			initialMode: {
				id: CUSTOM_ID,
				mode: { kind: "renaming", saving: false, error: null },
			},
		},
	});
	const field = container.querySelector('[data-row-mode="renaming"] input');
	assert.ok(field);
	const setValue = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	const type = async (value) => {
		await act(async () => {
			setValue.call(field, value);
			field.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
	};
	const enter = async () => {
		await act(async () => {
			field.dispatchEvent(
				new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
			);
		});
	};
	await type("   ");
	await enter();
	assert.match(container.textContent, /Name can't be empty\./);
	await type("Bright ping");
	await enter();
	await waitFor(
		() =>
			container.textContent.includes("Bright ping") &&
			!container.querySelector('[data-row-mode="renaming"]'),
	);
	assert.equal(daemon.state.custom[0].label, "Bright ping");
});

test("an over-length clip is refused with its own sentence, never trimmed (C10)", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	await addFiles(container, [
		new window.File([new Uint8Array(32)], "long-song.mp3", {
			type: "audio/mpeg",
		}),
	]);
	await waitFor(
		() => container.querySelector('[data-pending-phase="error"]') !== null,
		3000,
	);
	const text = container.textContent;
	assert.match(
		text,
		/long-song\.mp3 is 184\.2 seconds long\. Sounds can be up to 10 seconds\./,
		"the row's own sentence, with the measured length",
	);
	assert.match(text, /Choose another file/);
	assert.doesNotMatch(text, /Trimmed/, "a long clip is refused, never trimmed");
	assert.deepEqual(daemon.edits, [], "a refusal selects nothing");
});

test("one accepted file is added, selected and played once (§5.1)", async (t) => {
	const daemon = makeDaemon({ custom: [] });
	const { container } = await mount(t, daemon);
	await addFiles(container, [
		new window.File([new Uint8Array(64)], "door-knock.wav", {
			type: "audio/wav",
		}),
	]);
	await waitFor(() => container.textContent.includes("door-knock"), 3000);
	await settle(4);
	const upload = daemon.media.find(
		(m) => m.request.op === "notification_sounds.upload",
	);
	assert.equal(upload.request.fileName, "door-knock.wav");
	assert.equal(upload.request.name, "door-knock");
	assert.equal(upload.bytes, 64);
	await settle(10, 60);
	assert.deepEqual(
		daemon.edits.map((e) => [e.key, e.value]),
		[["notifications.sound.id", "custom-door-knock-000001"]],
	);
	assert.equal(
		radio(container, "custom-door-knock-000001").getAttribute("data-state"),
		"checked",
	);
	assert.ok(
		daemon.media.some(
			(m) =>
				m.request.op === "notification_sounds.audio" &&
				m.request.soundId === "custom-door-knock-000001",
		),
		"the new sound plays once so the user hears its matched level",
	);
});

test("files beyond the 50-sound limit are refused without a request", async (t) => {
	const custom = Array.from({ length: 49 }, (_, i) => ({
		id: `custom-s-${i}`,
		label: `S ${i}`,
		duration_s: 1,
	}));
	const daemon = makeDaemon({ custom });
	const { container } = await mount(t, daemon);
	await addFiles(container, [
		new window.File([new Uint8Array(8)], "a.wav"),
		new window.File([new Uint8Array(8)], "b.wav"),
	]);
	await waitFor(
		() => container.querySelector('[data-pending-phase="error"]') !== null,
	);
	await settle(6);
	const uploads = daemon.media.filter(
		(m) => m.request.op === "notification_sounds.upload",
	);
	assert.equal(uploads.length, 1, "only the file that fits is sent");
	assert.match(container.textContent, /You have 50 sounds, the most allowed/);
});

test("the Backend list no longer renders the promoted keys", async (t) => {
	const daemon = makeDaemon();
	installBridge(daemon);
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => {
			root.unmount();
			client.clear();
		});
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(BackendSettingsSection, { hideNotifications: true }),
			),
		);
	});
	await settle(6);
	const keys = [...container.querySelectorAll("[data-setting-key]")].map((n) =>
		n.getAttribute("data-setting-key"),
	);
	assert.ok(keys.length > 10, `the registry rendered (${keys.length} rows)`);
	for (const key of [
		"display.notifications",
		"display.notification_session_name",
		"notifications.sound.enabled",
		"notifications.sound.id",
		"notifications.sound.volume",
	]) {
		assert.ok(!keys.includes(key), `${key} is not a Backend row`);
		assert.equal(sectionForSettingKey(key, "backend"), "notifications");
	}
});

/* ------------------------------------------------- round 1 remediation */

/* Radix's roving focus moves focus in a `setTimeout`, so wait one turn. */
const keyOn = async (node, key, init = {}) => {
	await act(async () => {
		node.dispatchEvent(
			new window.KeyboardEvent("keydown", { key, bubbles: true, ...init }),
		);
		await new Promise((resolve) => setTimeout(resolve, 0));
	});
};
const keyUpOn = async (node, key) => {
	await act(async () => {
		node.dispatchEvent(
			new window.KeyboardEvent("keyup", { key, bubbles: true }),
		);
	});
};
const slider = (container) =>
	container.querySelector(
		'[data-notification-sound-group] input[type="range"]',
	);
const soundSwitch = (container) =>
	container.querySelector(
		'[data-search-row="notifications.sound.enabled"] [role="switch"]',
	);

test("A: keyboard volume keeps focus across three steps, each written in order (QA Q1 / UX U1)", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	const range = slider(container);
	range.focus();
	const setValue = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	for (const next of [65, 60, 55]) {
		await keyOn(range, "ArrowLeft");
		await act(async () => {
			setValue.call(range, String(next));
			range.dispatchEvent(new window.Event("input", { bubbles: true }));
		});
		await keyUpOn(range, "ArrowLeft");
		await settle(1);
		assert.equal(document.activeElement, range, `focus kept after ${next}`);
		assert.equal(range.disabled, false, "the range is never disabled mid-save");
	}
	await waitFor(() => daemon.state.volume === 55, 3000);
	assert.deepEqual(
		daemon.edits
			.filter((e) => e.key === "notifications.sound.volume")
			.map((e) => e.value),
		[65, 60, 55],
		"three writes, in the order made",
	);
});

test("A: Space twice on Play a sound keeps focus and lands both writes (QA Q1 / UX U1)", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	const sw = soundSwitch(container);
	sw.focus();
	await click(sw);
	await settle(1);
	assert.equal(
		document.activeElement,
		soundSwitch(container),
		"focus kept after first press",
	);
	await click(soundSwitch(container));
	await waitFor(
		() =>
			daemon.edits.filter((e) => e.key === "notifications.sound.enabled")
				.length === 2,
		3000,
	);
	await settle(4);
	assert.equal(
		document.activeElement,
		soundSwitch(container),
		"focus kept after second press",
	);
	assert.deepEqual(
		daemon.edits
			.filter((e) => e.key === "notifications.sound.enabled")
			.map((e) => e.value),
		[false, true],
	);
	assert.equal(daemon.state.soundOn, true);
	assert.equal(soundSwitch(container).getAttribute("aria-checked"), "true");
});

test("B: Turn on notifications flips the promoted switch above it (QA Q2 / UX U3)", async (t) => {
	const daemon = makeDaemon({ notificationsOn: false });
	const { container } = await mount(t, daemon);
	const master = () => [...container.querySelectorAll('[role="switch"]')][0];
	assert.equal(master().getAttribute("aria-checked"), "false");
	const turnOn = [...container.querySelectorAll("button")].find(
		(b) => b.textContent === "Turn on notifications",
	);
	await click(turnOn);
	await waitFor(() => daemon.state.notificationsOn === true, 3000);
	await settle(6);
	assert.equal(
		master().getAttribute("aria-checked"),
		"true",
		"switch follows the write",
	);
});

test("C: a config frame from elsewhere moves the radio and adds the row, silently (UX U2)", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	daemon.state.custom.push({
		id: "custom-made-by-aida-1",
		label: "Made by Aida",
		duration_s: 1,
	});
	daemon.state.selected = "custom-made-by-aida-1";
	await emitFrame(["notifications"]);
	await waitFor(
		() =>
			radio(container, "custom-made-by-aida-1")?.getAttribute("data-state") ===
			"checked",
		3000,
	);
	assert.equal(
		radio(container, "custom-made-by-aida-1").getAttribute("data-state"),
		"checked",
	);
	assert.deepEqual(audioAsks(daemon), [], "a feed-driven change never plays");
});

test("C: an unrelated config frame does not re-read", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	const before = daemon.asked.filter(
		(op) => op === "notification_sounds.list",
	).length;
	await emitFrame(["theme"]);
	await settle(4, 20);
	assert.equal(
		daemon.asked.filter((op) => op === "notification_sounds.list").length,
		before,
	);
	assert.ok(container);
});

test("D: leaving within the debounce still saves the choice (review M1)", async (t) => {
	const daemon = makeDaemon();
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false, gcTime: 0 } },
	});
	installBridge(daemon);
	const container = document.createElement("div");
	document.body.appendChild(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => client.clear());
		container.remove();
	});
	await act(async () => {
		root.render(
			createElement(
				QueryClientProvider,
				{ client },
				createElement(NotificationsSection, {}),
			),
		);
	});
	await waitFor(() => radio(container, "felt-marimba") !== null);
	await settle(3);
	await click(radio(container, "felt-marimba"));
	await settle(1, 50);
	await act(async () => root.unmount());
	await settle(4, 50);
	assert.deepEqual(
		daemon.edits.map((e) => [e.key, e.value]),
		[["notifications.sound.id", "felt-marimba"]],
	);
});

test("E: once sent, the upload row offers no Cancel and says Finishing… (review M2 / UX U5)", async (t) => {
	let release;
	const uploadGate = new Promise((resolve) => {
		release = resolve;
	});
	const daemon = makeDaemon({ uploadGate });
	const { container } = await mount(t, daemon);
	await addFiles(container, [
		new window.File([new Uint8Array(16)], "knock.wav"),
	]);
	await waitFor(
		() => container.querySelector('[data-pending-phase="processing"]') !== null,
		3000,
	);
	const row = container.querySelector('[data-pending-phase="processing"]');
	assert.match(row.textContent, /Finishing…/);
	assert.equal(
		row.querySelector("button"),
		null,
		"no Cancel once the bytes are sent",
	);
	release();
	await waitFor(() => radio(container, "custom-knock-000001") !== null, 3000);
	assert.ok(
		radio(container, "custom-knock-000001"),
		"the sound the daemon stored is shown",
	);
});

test("Q7: the first arrow after a click selects and plays", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	await click(radio(container, "soft-pulse"));
	radio(container, "soft-pulse").focus();
	await settle(2);
	const asksBefore = audioAsks(daemon).length;
	await keyOn(radio(container, "soft-pulse"), "ArrowDown");
	await keyUpOn(document.activeElement, "ArrowDown");
	await settle(3);
	assert.equal(
		radio(container, "two-note-chime").getAttribute("data-state"),
		"checked",
	);
	assert.equal(audioAsks(daemon).length, asksBefore + 1, "and it played once");
});

test("U4: an auto-repeat selects silently and plays only the row it stops on", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	radio(container, "soft-pulse").focus();
	await settle(1);
	// soft-pulse -> two-note-chime (a press) -> felt-marimba (a repeat).
	await keyOn(radio(container, "soft-pulse"), "ArrowDown");
	await keyOn(document.activeElement, "ArrowDown", { repeat: true });
	const during = audioAsks(daemon).map((m) => m.request.soundId);
	await keyUpOn(document.activeElement, "ArrowDown");
	await settle(3);
	const after = audioAsks(daemon).map((m) => m.request.soundId);
	assert.deepEqual(
		during,
		["two-note-chime"],
		"only the first, non-repeat press played",
	);
	assert.deepEqual(
		after,
		["two-note-chime", "felt-marimba"],
		"the row the repeat stopped on plays once, on release",
	);
	assert.equal(
		radio(container, "felt-marimba").getAttribute("data-state"),
		"checked",
	);
});

test("U7: clicking away from a valid rename saves it", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon, {
		listPresets: {
			initialMode: {
				id: CUSTOM_ID,
				mode: { kind: "renaming", saving: false, error: null },
			},
		},
	});
	const field = container.querySelector('[data-row-mode="renaming"] input');
	const setValue = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setValue.call(field, "Brass ping 2");
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await act(async () => {
		field.dispatchEvent(new window.FocusEvent("focusout", { bubbles: true }));
		field.dispatchEvent(new window.FocusEvent("blur"));
	});
	await waitFor(() => daemon.state.custom[0].label === "Brass ping 2", 3000);
	assert.equal(daemon.state.custom[0].label, "Brass ping 2");
});

test("m5: a silent clip gets its own sentence", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon, {
		listPresets: {
			initialPending: [
				{
					key: "e",
					fileName: "quiet.wav",
					stem: "quiet",
					phase: "error",
					refusal: { code: "silent" },
				},
			],
		},
	});
	assert.match(
		container.textContent,
		/quiet\.wav is silent\. Choose a clip you can hear\./,
	);
});

/* ------------------------------------------------- round 2 remediation */

const held = (key) => {
	let release;
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	return { hold: { key, gate, used: false }, release: () => release() };
};
const setRange = async (range, next) => {
	const setValue = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await keyOn(range, "ArrowLeft");
	await act(async () => {
		setValue.call(range, String(next));
		range.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	await keyUpOn(range, "ArrowLeft");
	await settle(1);
};

test("M3: 70 -> 65 -> 70 with the first save held open writes both, thumb ends at 70", async (t) => {
	const { hold, release } = held("notifications.sound.volume");
	const daemon = makeDaemon({ holdFirstEdit: hold });
	const { container } = await mount(t, daemon);
	const range = slider(container);
	range.focus();
	await setRange(range, 65);
	await setRange(range, 70);
	release();
	await waitFor(
		() =>
			daemon.edits.filter((e) => e.key === "notifications.sound.volume")
				.length === 2,
		3000,
	);
	await settle(8, 20);
	assert.deepEqual(
		daemon.edits
			.filter((e) => e.key === "notifications.sound.volume")
			.map((e) => e.value),
		[65, 70],
	);
	assert.equal(daemon.state.volume, 70, "the daemon ends at 70");
	assert.equal(slider(container).value, "70", "and so does the thumb");
});

test("m1 (r2): on -> off -> on with the first save held never flips the switch back", async (t) => {
	const { hold, release } = held("notifications.sound.enabled");
	let releaseSecond;
	hold.second = new Promise((resolve) => {
		releaseSecond = resolve;
	});
	const daemon = makeDaemon({ holdFirstEdit: hold });
	const { container } = await mount(t, daemon);
	const sw = soundSwitch(container);
	sw.focus();
	await click(sw); // -> off (held)
	await click(soundSwitch(container)); // -> on (queued)
	const seen = [];
	const observer = new window.MutationObserver(() =>
		seen.push(soundSwitch(container)?.getAttribute("aria-checked")),
	);
	observer.observe(container, {
		attributes: true,
		subtree: true,
		attributeFilter: ["aria-checked"],
	});
	release();
	// The first write lands and its refetch reports `false`, with the second
	// write still in flight.
	await waitFor(() => daemon.state.soundOn === false, 3000);
	await settle(8, 20);
	releaseSecond();
	await waitFor(() => daemon.state.soundOn === true, 3000);
	await settle(8, 20);
	observer.disconnect();
	assert.ok(
		!seen.includes("false"),
		`never shown off after the second press: ${JSON.stringify(seen)}`,
	);
	assert.equal(soundSwitch(container).getAttribute("aria-checked"), "true");
	assert.equal(daemon.state.soundOn, true);
});

test("U13: Turn on notifications moves focus to the switch it turned on", async (t) => {
	const daemon = makeDaemon({ notificationsOn: false });
	const { container } = await mount(t, daemon);
	const button = [...container.querySelectorAll("button")].find((b) =>
		b.textContent.includes("Turn on notifications"),
	);
	assert.ok(button, "the gated callout offers the action");
	button.focus();
	await click(button);
	await waitFor(() => daemon.state.notificationsOn === true, 3000);
	await settle(4, 40);
	const active = document.activeElement;
	assert.equal(active?.getAttribute("role"), "switch");
	assert.equal(active?.getAttribute("aria-checked"), "true");
	assert.equal(
		active?.getAttribute("aria-labelledby") &&
			document
				.getElementById(active.getAttribute("aria-labelledby"))
				.textContent.trim(),
		"Desktop notifications",
	);
});

test("U13: a successful volume Reset moves focus to the slider", async (t) => {
	const daemon = makeDaemon({ volume: 40 });
	const { container } = await mount(t, daemon);
	const reset = [...container.querySelectorAll("button")].find(
		(b) => b.textContent.trim() === "Reset",
	);
	assert.ok(reset, "Reset shows away from the default");
	reset.focus();
	await click(reset);
	await waitFor(() => daemon.state.volume === 70, 3000);
	await settle(4, 40);
	assert.equal(document.activeElement, slider(container));
});

test("Q8: the section-level Retry also reloads the sound list", async (t) => {
	const daemon = makeDaemon();
	const { container, client } = await mount(t, daemon);
	const before = daemon.asked.filter(
		(op) => op === "notification_sounds.list",
	).length;
	daemon.options.settingsFail = true;
	daemon.options.listingFails = true;
	await act(async () => {
		window.dispatchEvent(new window.Event("focus"));
	});
	await emitFrame(["notifications"]);
	await waitFor(() => container.textContent.includes("Couldn't load"), 3000);
	daemon.options.settingsFail = false;
	daemon.options.listingFails = false;
	const retry = [...container.querySelectorAll("button")].find(
		(b) => b.textContent.trim() === "Retry",
	);
	await click(retry);
	/*
	 * ASSERT THE CONDITION, NOT THE CLOCK. One Retry kicks two refetches this
	 * harness answers itself, so the end state is a fixed number of act turns
	 * away and only the wall time those turns take depends on the host. This
	 * wait used to allow 3 s: on a starved shard the same sequence took over
	 * 3 s and the wait timed out silently, reddening the assertion below with a
	 * message about "Couldn't load" rather than about the wait that missed
	 * (run 42543029193, shard 0/4). Waiting for QUIET takes the runner's speed
	 * out of the assertion; `drainReads` bounds itself in work units and wall
	 * time, and names what is still fetching if it never settles.
	 *
	 * TWO BARRIERS, because they watch different things: the drain watches the
	 * CACHE, the wait below watches the RENDER, and quiescence only means the
	 * fetches finished, not that React has painted the result. Measured with a
	 * 600 ms delay on both reads (well inside the floor), a fixed two-turn
	 * settle still caught stale "Couldn't load" text in 1 run of 4 - the exact
	 * downstream-symptom failure this test exists to stop reporting. So the
	 * render barrier is the end state itself, and it is LOUD (`waitFor` throws
	 * naming its predicate): with the cache already drained it waits for one
	 * render, so a starved host costs a flush, not the whole sequence.
	 */
	await drainReads(client);
	await waitFor(
		() =>
			radio(container, "soft-pulse") !== null &&
			!container.textContent.includes("Couldn't load"),
		3000,
	);
	assert.ok(
		daemon.asked.filter((op) => op === "notification_sounds.list").length >
			before + 1,
		"the retry re-asked the listing",
	);
	assert.ok(
		!container.textContent.includes("Couldn't load"),
		"one Retry recovers both reads",
	);
	// The other half of the wait this test used to make: the listing is back.
	assert.ok(
		radio(container, "soft-pulse") !== null,
		"the sound list is back after one Retry",
	);
});

/* ------------------------------------------------- round 3 remediation */

test("M4: a step still held when the first save settles is kept and written (70 -> 65 -> 70)", async (t) => {
	const { hold, release } = held("notifications.sound.volume");
	const daemon = makeDaemon({ holdFirstEdit: hold });
	const { container } = await mount(t, daemon);
	const range = slider(container);
	range.focus();
	const setValue = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	// ← pressed and released: 65 is committed (its save is held open).
	await setRange(range, 65);
	// → pressed and HELD: the thumb shows 70, nothing committed yet.
	await keyOn(range, "ArrowRight");
	await act(async () => {
		setValue.call(range, "70");
		range.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	// The first save settles while → is still down; its refetch reports 65.
	release();
	await waitFor(() => daemon.state.volume === 65, 3000);
	await settle(8, 20);
	assert.equal(
		slider(container).value,
		"70",
		"the unreleased step is not pulled back to the daemon's 65",
	);
	// → released: 70 is written.
	await keyUpOn(range, "ArrowRight");
	await waitFor(() => daemon.state.volume === 70, 3000);
	await settle(8, 20);
	assert.deepEqual(
		daemon.edits
			.filter((e) => e.key === "notifications.sound.volume")
			.map((e) => e.value),
		[65, 70],
	);
	assert.equal(slider(container).value, "70");
});

test("m2 (r3): a section Retry that recovers clears stale row write errors", async (t) => {
	const daemon = makeDaemon();
	const { container } = await mount(t, daemon);
	daemon.options.failEdits = true;
	await click(soundSwitch(container));
	await waitFor(
		() => container.querySelector("output.text-danger") !== null,
		3000,
	);
	daemon.options.failEdits = false;
	daemon.options.settingsFail = true;
	await emitFrame(["notifications"]);
	await waitFor(() => container.textContent.includes("Couldn't load"), 3000);
	daemon.options.settingsFail = false;
	const retry = [...container.querySelectorAll("button")].find(
		(b) => b.textContent.trim() === "Retry",
	);
	await click(retry);
	await waitFor(() => radio(container, "soft-pulse") !== null, 3000);
	await settle(6, 20);
	assert.equal(
		container.querySelectorAll("output.text-danger").length,
		0,
		"no row keeps the outage's write error",
	);
});
