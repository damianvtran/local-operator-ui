import assert from "node:assert/strict";
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	statSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";
import { build } from "esbuild";

/**
 * The configured notification sound (`src/main/notification-sound.ts`), the
 * four banner sites that use it, and the renderer's fallback player.
 *
 * Bundled in memory from the shipped TypeScript, like `desktop-notifier.test.mjs`.
 * Each site is bundled TOGETHER with the helper so the service the test
 * configures is the very instance the site reads. Nothing here reaches a
 * speaker: the backend is a fake that answers with an in-memory WAV, the
 * staging directory is a scratch dir (never ~/Library/Sounds), and the
 * renderer player runs on a fake element (`globalThis.Audio =` below, the
 * audio-safety guard's accepted control).
 */
const ELECTRON = /^electron$/;
const ANY = /.*/;
const STAGED_TWO_NOTE =
	/^LocalOperator-[0-9a-f]{8}-two-note-chime-40-[0-9a-f]{8}\.wav$/;
const STAGED_DEFAULT =
	/^LocalOperator-[0-9a-f]{8}-soft-pulse-70-[0-9a-f]{8}\.wav$/;
const STAGED_DEFAULT_PREFIX = /^LocalOperator-[0-9a-f]{8}-soft-pulse-70-/;
const TS_FILE = /\.ts$/;
const DTS_FILE = /\.d\.ts$/;
const electronFixture = {
	name: "electron-fixture",
	setup(builder) {
		builder.onResolve({ filter: ELECTRON }, () => ({
			path: "electron",
			namespace: "fixture",
		}));
		builder.onLoad({ filter: ANY, namespace: "fixture" }, () => ({
			contents: `
				export class Notification {
					static isSupported() { return true; }
					constructor(options) { this.options = options; (globalThis.__toasts ??= []).push(options); }
					on() {} once() {} off() {}
					show() {}
				}
			`,
			loader: "js",
		}));
	},
};

async function load(contents, platform = "node") {
	const out = await build({
		stdin: { contents, resolveDir: process.cwd() },
		bundle: true,
		format: "esm",
		platform,
		write: false,
		plugins: [electronFixture],
		logLevel: "silent",
	});
	return import(
		`data:text/javascript;base64,${Buffer.from(out.outputFiles[0].text).toString("base64")}`
	);
}

const sound = await load('export * from "./src/main/notification-sound";');

/** A tiny valid 16-bit PCM WAV, distinct per `seed` so its hash differs. */
function wav(seed = 1) {
	const samples = 64;
	const buffer = Buffer.alloc(44 + samples * 2);
	buffer.write("RIFF", 0);
	buffer.writeUInt32LE(36 + samples * 2, 4);
	buffer.write("WAVEfmt ", 8);
	buffer.writeUInt32LE(16, 16);
	buffer.writeUInt16LE(1, 20);
	buffer.writeUInt16LE(1, 22);
	buffer.writeUInt32LE(48000, 24);
	buffer.writeUInt32LE(96000, 28);
	buffer.writeUInt16LE(2, 32);
	buffer.writeUInt16LE(16, 34);
	buffer.write("data", 36);
	buffer.writeUInt32LE(samples * 2, 40);
	for (let i = 0; i < samples; i++)
		buffer.writeInt16LE((i * seed * 97) % 3000, 44 + i * 2);
	return new Uint8Array(buffer);
}

const scratch = [];
afterEach(() => {
	for (const dir of scratch.splice(0))
		rmSync(dir, { recursive: true, force: true });
	sound.configureNotificationSound(null);
});

/**
 * A fake backend. `features` is what `capabilities` advertises; `settings` the
 * `settings.list` rows; `audio` decides the media answer.
 */
function backend({
	features = { notification_sounds: 1 },
	settings = {},
	/* `{ op: response }`: answer that op with this instead (a fault). */
	faults = {},
	audio = () => ({
		status: 200,
		kind: "bytes",
		mimeType: "audio/wav",
		data: wav(),
	}),
} = {}) {
	const calls = [];
	return {
		calls,
		request: async (input) => {
			calls.push(input);
			const fault = faults[input.op];
			if (fault) return typeof fault === "function" ? fault() : fault;
			if (input.op === "capabilities")
				return { status: 200, body: { result: { features } } };
			if (input.op === "settings.list")
				return {
					status: 200,
					body: {
						result: {
							settings: Object.entries(settings).map(([key, value]) => ({
								key,
								value,
							})),
						},
					},
				};
			return { status: 404, body: null };
		},
		media: async (input) => {
			calls.push(input);
			return audio(input);
		},
		faults,
	};
}

function rig({ platform = "darwin", clock = 1_000_000, env, ...options } = {}) {
	const root = mkdtempSync(join(tmpdir(), "notification-sound-"));
	scratch.push(root);
	const soundsDir = join(root, "Sounds");
	const configDir = join(root, "config");
	const played = [];
	const logs = [];
	const fake = backend(options);
	const time = { now: clock };
	const service = sound.configureNotificationSound({
		request: fake.request,
		media: fake.media,
		playInRenderer: (bytes) => {
			played.push(bytes);
			return true;
		},
		log: (line) => logs.push(line),
		platform,
		env: { LOCAL_OPERATOR_CONFIG_DIR: configDir, ...env },
		soundsDir,
		now: () => time.now,
	});
	return {
		service,
		faults: fake.faults,
		soundsDir,
		configDir,
		played,
		logs,
		calls: fake.calls,
		time,
	};
}

test("macOS: stages the gain-baked WAV under a namespaced name and the banner names it", async () => {
	const r = rig({
		settings: {
			"notifications.sound.id": "two-note-chime",
			"notifications.sound.volume": 40,
		},
	});
	await r.service.refresh();
	const media = r.calls.find((call) => call.op === "notification_sounds.audio");
	assert.deepEqual(media, {
		op: "notification_sounds.audio",
		soundId: "two-note-chime",
		volume: 40,
	});
	const files = readdirSync(r.soundsDir);
	assert.equal(files.length, 1);
	assert.match(files[0], STAGED_TWO_NOTE);
	assert.deepEqual(
		readFileSync(join(r.soundsDir, files[0])),
		Buffer.from(wav()),
	);
	assert.deepEqual(sound.notificationSoundOptions(), {
		silent: false,
		sound: files[0],
	});
	assert.equal(
		r.played.length,
		0,
		"the OS plays it; the renderer is not asked",
	);
});

test("defaults: soft-pulse at 70 when the settings are absent", async () => {
	const r = rig();
	await r.service.refresh();
	assert.match(sound.notificationSoundOptions().sound, STAGED_DEFAULT);
});

test("macOS: a new staging prunes only its own config dir's stagings and .tmp leftovers", async () => {
	const r = rig();
	const scope = sound.stagedScopePrefix({
		LOCAL_OPERATOR_CONFIG_DIR: r.configDir,
	});
	const other = sound.stagedScopePrefix({
		LOCAL_OPERATOR_CONFIG_DIR: join(r.configDir, "..", "another"),
	});
	assert.notEqual(scope, other);
	mkdirSync(r.soundsDir, { recursive: true });
	const mine = `${scope}soft-pulse-50-deadbeef.wav`;
	const leftover = `.${scope}soft-pulse-50-deadbeef.wav.123.tmp`;
	const theirs = `${other}soft-pulse-50-deadbeef.wav`;
	const theirTmp = `.${other}x.wav.9.tmp`;
	for (const name of [mine, leftover, theirs, theirTmp, "Users Own Sound.aiff"])
		writeFileSync(join(r.soundsDir, name), "x");
	await r.service.refresh();
	const files = readdirSync(r.soundsDir);
	assert.ok(!files.includes(mine), "an older staging of this scope goes");
	assert.ok(!files.includes(leftover), "a crashed write's .tmp goes");
	assert.ok(files.includes(theirs), "another instance's staging stays");
	assert.ok(files.includes(theirTmp), "another instance's .tmp stays");
	assert.ok(files.includes("Users Own Sound.aiff"), "the user's file stays");
	assert.equal(files.filter((name) => STAGED_DEFAULT.test(name)).length, 1);
});

test("Windows/Linux: silent banner, bytes go to the renderer player", async () => {
	for (const platform of ["win32", "linux"]) {
		const r = rig({ platform });
		await r.service.refresh();
		assert.ok(!existsSync(r.soundsDir), `${platform} stages nothing`);
		assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
		assert.equal(r.played.length, 1);
		assert.deepEqual(Buffer.from(r.played[0]), Buffer.from(wav()));
		sound.configureNotificationSound(null);
	}
});

test("macOS staging failure falls back to the renderer player", async () => {
	const r = rig();
	// A FILE where the directory should be: mkdir and the write both fail.
	writeFileSync(r.soundsDir, "not a directory");
	await r.service.refresh();
	assert.equal(r.service.current().staged, null);
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	assert.equal(r.played.length, 1);
	assert.ok(
		r.logs.some((line) => line.includes("staging")),
		"the failure is logged",
	);
});

test("disabled, volume 0 and the rig switch all mean silent:true, with no fetch", async () => {
	for (const [label, options] of [
		["disabled", { settings: { "notifications.sound.enabled": false } }],
		["volume 0", { settings: { "notifications.sound.volume": 0 } }],
		["LOCAL_OPERATOR_NO_SOUND", { env: { LOCAL_OPERATOR_NO_SOUND: "1" } }],
	]) {
		const r = rig(options);
		await r.service.refresh();
		assert.deepEqual(sound.notificationSoundOptions(), { silent: true }, label);
		assert.ok(
			!r.calls.some((call) => call.op === "notification_sounds.audio"),
			label,
		);
		assert.equal(r.played.length, 0, label);
		sound.configureNotificationSound(null);
	}
});

test("only a real false disables: a hand-written string keeps the sound", async () => {
	const r = rig({ settings: { "notifications.sound.enabled": "no" } });
	await r.service.refresh();
	assert.equal(r.service.current().kind, "file");
});

test("system: silent:false with no sound name (the OS default)", async () => {
	const r = rig({ settings: { "notifications.sound.id": "system" } });
	await r.service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
	assert.ok(!r.calls.some((call) => call.op === "notification_sounds.audio"));
});

test("old backend (no capability): today's behaviour, no settings or audio read", async () => {
	const r = rig({ features: {} });
	await r.service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
	assert.deepEqual(
		r.calls.map((call) => call.op),
		["capabilities"],
	);
});

test("unconfigured (and before the first read): a site's own request passes through", () => {
	assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
	assert.deepEqual(sound.notificationSoundOptions(true), { silent: true });
});

test("throttle: one sound per 1.5 s per machine, on the file the TUI shares", async () => {
	const r = rig({ platform: "linux" });
	await r.service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	assert.equal(r.played.length, 1);
	const stamp = join(r.configDir, "run", "notification-sound.last");
	assert.equal(
		Math.round(statSync(stamp).mtimeMs),
		r.time.now,
		"the slot was taken",
	);
	r.time.now += 1000;
	sound.notificationSoundOptions();
	assert.equal(
		r.played.length,
		1,
		"a second banner inside 1.5 s makes no sound",
	);
	r.time.now += 600;
	sound.notificationSoundOptions();
	assert.equal(r.played.length, 2, "after 1.5 s it plays again");
});

test("throttle: a TUI sound <1.5 s ago silences the desktop banner on macOS", async () => {
	const r = rig();
	await r.service.refresh();
	const stamp = join(r.configDir, "run", "notification-sound.last");
	mkdirSync(join(r.configDir, "run"), { recursive: true });
	writeFileSync(stamp, "");
	// The backend's `claim_throttle` writes the mtime in seconds.
	utimesSync(stamp, (r.time.now - 500) / 1000, (r.time.now - 500) / 1000);
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	r.time.now += 1000;
	assert.equal(sound.notificationSoundOptions().silent, false);
});

test("a site asking for silence (coalesced banner) stays silent and spends no slot", async () => {
	const r = rig();
	await r.service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(true), { silent: true });
	assert.ok(!existsSync(join(r.configDir, "run", "notification-sound.last")));
	assert.equal(sound.notificationSoundOptions().silent, false);
});

test("a failed audio render keeps the last good plan", async () => {
	let fail = false;
	const r = rig({
		audio: () =>
			fail
				? { status: 503, kind: "error", detail: "store_failed" }
				: { status: 200, kind: "bytes", mimeType: "audio/wav", data: wav() },
	});
	await r.service.refresh();
	const before = sound.notificationSoundOptions();
	fail = true;
	r.time.now += 2000;
	await r.service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(), before);
});

test('live config: the real feed frame (`changed_keys: ["notifications"]`) re-reads', async () => {
	const r = rig({ settings: { "notifications.sound.enabled": true } });
	await r.service.refresh();
	assert.equal(r.service.current().kind, "file");
	/*
	 * The frame exactly as QA captured it from `GET /v1/desktop/events` on a
	 * #3403 backend after `PATCH /v1/settings/notifications.sound.enabled`:
	 * core's feed diffs TOP-LEVEL config keys, so the registry key never
	 * appears. Routed the way `index.ts` routes it.
	 */
	const frame = JSON.parse(
		'{"type":"config","payload":{"changed_keys":["notifications"],"language":"en"}}',
	);
	const before = r.calls.length;
	r.service.observeConfigChange(["language", "display.notifications"]);
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(r.calls.length, before, "unrelated keys do not re-read");
	// The user turns sounds off; the next banner must follow.
	const listing = r.calls.length;
	r.faults["settings.list"] = {
		status: 200,
		body: {
			result: {
				settings: [{ key: "notifications.sound.enabled", value: false }],
			},
		},
	};
	r.service.observeConfigChange(frame.payload.changed_keys);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.ok(r.calls.length > listing, "the real spelling re-read");
	assert.equal(r.service.current().kind, "silent");
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	// The registry spelling still works, should the feed ever send it.
	const again = r.calls.length;
	r.service.observeConfigChange(["notifications.sound.volume"]);
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.ok(r.calls.length > again);
});

/* M1 / Q1: an unanswered read must never change what the user hears. */
for (const [label, op, fault] of [
	["settings.list 504", "settings.list", { status: 504, body: null }],
	[
		"settings.list 200 without a body",
		"settings.list",
		{ status: 200, body: null },
	],
	["capabilities status 0", "capabilities", { status: 0, body: null }],
	[
		"capabilities 503",
		"capabilities",
		{ status: 503, body: { detail: "warming" } },
	],
	[
		"capabilities network error",
		"capabilities",
		() => {
			throw new Error("connect ECONNREFUSED");
		},
	],
]) {
	test(`an unanswered read keeps 'disabled': ${label}`, async () => {
		const r = rig({ settings: { "notifications.sound.enabled": false } });
		await r.service.refresh();
		assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
		r.faults[op] = fault;
		await r.service.refresh();
		assert.equal(r.service.current().kind, "silent", "plan unchanged");
		assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
		assert.ok(
			!r.calls.some((call) => call.op === "notification_sounds.audio"),
			"no default sound was fetched",
		);
	});
}

test("an unanswered read keeps a working sound too", async () => {
	const r = rig();
	await r.service.refresh();
	const plan = r.service.current();
	r.faults.capabilities = { status: 503, body: null };
	await r.service.refresh();
	assert.equal(r.service.current(), plan);
});

test("capabilities 200 WITHOUT the flag is the one answer that means legacy", async () => {
	const r = rig({ settings: { "notifications.sound.enabled": false } });
	await r.service.refresh();
	assert.equal(r.service.current().kind, "silent");
	r.faults.capabilities = {
		status: 200,
		body: { result: { features: { desktop_feed: 1 } } },
	};
	await r.service.refresh();
	assert.equal(r.service.current().kind, "legacy");
});

test("before any answered read, each banner kicks one read and follows legacy", async () => {
	const r = rig({ settings: { "notifications.sound.enabled": false } });
	r.faults.capabilities = { status: 0, body: null };
	assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(r.calls.filter((c) => c.op === "capabilities").length, 1);
	// Still unsettled: the next banner tries again (one read at a time).
	r.time.now += 2000;
	sound.notificationSoundOptions();
	sound.notificationSoundOptions();
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(r.calls.filter((c) => c.op === "capabilities").length, 2);
	// The backend answers: the plan settles and banners stop kicking reads.
	r.faults.capabilities = undefined;
	r.time.now += 2000;
	sound.notificationSoundOptions();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(r.service.current().kind, "silent");
	const reads = r.calls.length;
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	await new Promise((resolve) => setTimeout(resolve, 5));
	assert.equal(r.calls.length, reads);
});

test("an unknown or deleted id falls back to soft-pulse, as core does", async () => {
	for (const status of [404, 422]) {
		const r = rig({
			settings: { "notifications.sound.id": "custom-gone-123" },
			audio: (input) =>
				input.soundId === "soft-pulse"
					? { status: 200, kind: "bytes", mimeType: "audio/wav", data: wav() }
					: { status, kind: "error", detail: "not_found" },
		});
		await r.service.refresh();
		const plan = r.service.current();
		assert.equal(plan.kind, "file");
		assert.equal(plan.soundId, "soft-pulse");
		assert.match(plan.staged, STAGED_DEFAULT);
	}
});

test("an oversized audio answer is refused and the last plan kept", async () => {
	const r = rig({
		audio: () => ({
			status: 200,
			kind: "bytes",
			mimeType: "audio/wav",
			data: new Uint8Array(sound.MAX_NOTIFICATION_SOUND_BYTES + 1),
		}),
	});
	await r.service.refresh();
	assert.equal(r.service.current().kind, "legacy");
	assert.ok(!existsSync(r.soundsDir) || readdirSync(r.soundsDir).length === 0);
});

test("a fractional volume is rounded, the way core accepts it", async () => {
	const r = rig({ settings: { "notifications.sound.volume": 70.4 } });
	await r.service.refresh();
	const media = r.calls.find((c) => c.op === "notification_sounds.audio");
	assert.equal(media.volume, 70);
	const s = rig({ settings: { "notifications.sound.volume": 40.6 } });
	await s.service.refresh();
	assert.equal(
		s.calls.find((c) => c.op === "notification_sounds.audio").volume,
		41,
	);
});

test("Q3: system and legacy spend the shared slot when they let the OS chime", async () => {
	for (const options of [
		{ settings: { "notifications.sound.id": "system" } },
		{ features: {} },
	]) {
		const r = rig(options);
		await r.service.refresh();
		assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
		assert.deepEqual(
			sound.notificationSoundOptions(),
			{ silent: true },
			"inside 1.5 s the second banner is silent",
		);
		assert.ok(existsSync(join(r.configDir, "run", "notification-sound.last")));
		r.time.now += 1600;
		assert.deepEqual(sound.notificationSoundOptions(), { silent: false });
	}
});

test("Q3: with no window to play it, the renderer fallback spends no slot", async () => {
	const root = mkdtempSync(join(tmpdir(), "notification-sound-nowin-"));
	scratch.push(root);
	const fake = backend();
	const service = sound.configureNotificationSound({
		request: fake.request,
		media: fake.media,
		playInRenderer: () => false,
		platform: "linux",
		env: { LOCAL_OPERATOR_CONFIG_DIR: join(root, "config") },
		soundsDir: join(root, "Sounds"),
		now: () => 1_000_000,
	});
	await service.refresh();
	assert.deepEqual(sound.notificationSoundOptions(), { silent: true });
	assert.ok(
		!existsSync(join(root, "config", "run", "notification-sound.last")),
	);
});

test("a slower older read cannot overwrite a newer one", async () => {
	let releaseFirst;
	let first = true;
	const r = rig({
		audio: (input) => {
			if (!first)
				return {
					status: 200,
					kind: "bytes",
					mimeType: "audio/wav",
					data: wav(9),
				};
			first = false;
			return new Promise((resolve) => {
				releaseFirst = () =>
					resolve({
						status: 200,
						kind: "bytes",
						mimeType: "audio/wav",
						data: wav(input.volume),
					});
			});
		},
	});
	const older = r.service.refresh();
	await new Promise((resolve) => setTimeout(resolve, 5));
	await r.service.refresh();
	const newer = r.service.current();
	releaseFirst();
	await older;
	assert.equal(r.service.current(), newer);
});

/* ------------------------------------------------------------ the sites */

test("every `new Notification` site in src/main goes through the helper", () => {
	const offenders = [];
	const walk = (dir) => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (TS_FILE.test(entry.name) && !DTS_FILE.test(entry.name)) {
				const source = readFileSync(path, "utf8");
				if (!/new Notification\(/.test(source)) continue;
				if (
					!/notificationSoundOptions\(/.test(source) ||
					/silent: false/.test(source)
				)
					offenders.push(path);
			}
		}
	};
	walk("src/main");
	assert.deepEqual(
		offenders,
		[],
		"a banner that bypasses the helper ignores the user's sound setting",
	);
});

test("site: the completion notifier's banner carries the staged sound", async () => {
	const mod = await load(
		'export * from "./src/main/desktop-notifier"; export * from "./src/main/notification-sound";',
	);
	const root = mkdtempSync(join(tmpdir(), "notification-sound-site-"));
	scratch.push(root);
	const fake = backend();
	const service = mod.configureNotificationSound({
		request: fake.request,
		media: fake.media,
		playInRenderer: () => true,
		platform: "darwin",
		env: { LOCAL_OPERATOR_CONFIG_DIR: join(root, "config") },
		soundsDir: join(root, "Sounds"),
	});
	await service.refresh();
	globalThis.__toasts = [];
	const notifier = new mod.DesktopNotifier(
		() => null,
		async (input) =>
			input?.op === "capabilities"
				? { status: 200, body: { result: { features: {} } } }
				: { status: 200, body: { result: { claimed: true } } },
	);
	notifier.observe("123456abcdef", {
		session_id: "123456abcdef",
		epoch: "e",
		seq: 1,
		type: "notification",
		payload: {
			contract: 1,
			kind: "complete",
			title: "T",
			status: "Complete",
			body: "B",
			dedupe_key: "complete:123456abcdef:x",
			completion_token: "x",
			focus_policy: "when_unfocused",
		},
	});
	await new Promise((resolve) => setImmediate(resolve));
	assert.equal(globalThis.__toasts.length, 1);
	assert.equal(globalThis.__toasts[0].silent, false);
	assert.match(globalThis.__toasts[0].sound, STAGED_DEFAULT_PREFIX);
	mod.configureNotificationSound(null);
});

test("site: browser consent and Team Bridge banners honour 'disabled'", async () => {
	const consent = await load(
		'export * from "./src/main/browser/consent-notifier"; export * from "./src/main/notification-sound";',
	);
	const fake = backend({ settings: { "notifications.sound.enabled": false } });
	const root = mkdtempSync(join(tmpdir(), "notification-sound-site-"));
	scratch.push(root);
	const deps = {
		request: fake.request,
		media: fake.media,
		playInRenderer: () => true,
		platform: "darwin",
		env: { LOCAL_OPERATOR_CONFIG_DIR: join(root, "config") },
		soundsDir: join(root, "Sounds"),
	};
	await consent.configureNotificationSound(deps).refresh();
	const raised = [];
	new consent.ConsentNotifier({
		show: "focus",
		onAttention: () => {},
		createNotification: (options) => ({
			on: () => {},
			once: () => {},
			show: () => raised.push(options),
		}),
	}).announce([
		{ entryId: "e1", origin: "https://a.example", requester: "session:a" },
	]);
	assert.equal(raised.length, 1);
	assert.equal(raised[0].silent, true);
	consent.configureNotificationSound(null);

	const bridge = await load(
		'export * from "./src/main/team-bridge-notifier"; export * from "./src/main/team-bridge-notify-store"; export * from "./src/main/notification-sound";',
	);
	await bridge.configureNotificationSound(deps).refresh();
	const banners = [];
	const notifier = new bridge.TeamBridgeNotifier({
		window: () => ({
			isDestroyed: () => false,
			isFocused: () => false,
			isVisible: () => true,
			isMinimized: () => false,
		}),
		show: "focus",
		store: new bridge.TeamBridgeNotifyStore(join(root, "cursors.json")),
		host: { signalOpen: () => {}, reopen: () => {} },
		canNotify: () => true,
		platform: "darwin",
		createBanner: (options) => {
			banners.push(options);
			return { once() {}, show() {}, close() {} };
		},
	});
	notifier.setAuthority({ accountId: "acct_a", epoch: 1 });
	await notifier.notify({
		owner: { accountId: "acct_a", epoch: 1 },
		conversationId: "bcv_abc123",
		tenantId: "tnt_1",
		title: "Ada",
		body: "Hi",
		seq: 4,
	});
	assert.equal(banners.length, 1);
	assert.equal(banners[0].silent, true);
	bridge.configureNotificationSound(null);
});

/* ------------------------------------------------------ renderer player */

class FakeAudio {
	static made = [];
	constructor() {
		this.listeners = {};
		this.src = "";
		this.removed = [];
		this.refuse = false;
		FakeAudio.made.push(this);
	}
	addEventListener(event, handler) {
		this.listeners[event] = handler;
	}
	removeAttribute(name) {
		this.removed.push(name);
	}
	play() {
		return this.refuse
			? Promise.reject(new Error("NotAllowedError"))
			: Promise.resolve();
	}
}
globalThis.Audio = FakeAudio;

const player = await load(
	'export * from "./src/renderer/src/shared/lib/notification-sound-player";',
	"browser",
);

test("player: its own element per chime; the URL it made is revoked when it ends", async () => {
	FakeAudio.made = [];
	const revoked = [];
	const urls = {
		create: () => "blob:chime",
		revoke: (url) => revoked.push(url),
	};
	const routed = [];
	assert.equal(
		await player.playNotificationSound(wav(), {
			urls,
			route: (el) => routed.push(el),
		}),
		true,
	);
	assert.equal(await player.playNotificationSound(wav(), { urls }), true);
	assert.equal(FakeAudio.made.length, 2, "never a shared element");
	assert.equal(
		routed[0],
		FakeAudio.made[0],
		"the zero-gain route sees the element before play",
	);
	assert.equal(FakeAudio.made[0].src, "blob:chime");
	FakeAudio.made[0].listeners.ended();
	assert.deepEqual(revoked, ["blob:chime"]);
});

test("player: a refused play resolves false and releases the URL", async () => {
	const revoked = [];
	const element = new FakeAudio();
	element.refuse = true;
	const ok = await player.playNotificationSound(wav(), {
		createElement: () => element,
		urls: { create: () => "blob:x", revoke: (url) => revoked.push(url) },
	});
	assert.equal(ok, false);
	assert.deepEqual(revoked, ["blob:x"]);
});

test("player: never imports the shared audio engine", () => {
	const source = readFileSync(
		"src/renderer/src/shared/lib/notification-sound-player.ts",
		"utf8",
	);
	assert.doesNotMatch(source, /^import[^;]*audio-engine-store/m);
});
