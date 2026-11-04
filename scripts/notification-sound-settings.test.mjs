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
						...(options.older ? {} : { notification_sounds: 1 }),
					},
				});
			case "settings.list":
				return ok(settings());
			case "settings.edit": {
				edits.push({ key: input.key, value: input.value });
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
	return { state, asked, media, edits, request, media_: mediaHandler };
};

const installBridge = (daemon) => {
	globalThis.window.api.desktop.request = daemon.request;
	globalThis.window.api.desktop.media = daemon.media_;
};

const settle = async (turns = 4, ms = 0) => {
	for (let turn = 0; turn < turns; turn += 1) {
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, ms));
		});
	}
};

const waitFor = async (predicate, timeout = 2000) => {
	const deadline = Date.now() + timeout;
	while (Date.now() < deadline) {
		if (predicate()) return true;
		await settle(1, 20);
	}
	return predicate();
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
	return { container: mounted.container };
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
