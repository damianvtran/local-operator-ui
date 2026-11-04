/*
 * The notification-sound settings model, bound without a DOM.
 *
 *     node --test scripts/notification-sound-settings-model.test.mjs
 *
 * WHY. Every judgement Settings -> Notifications makes that a reviewer has to
 * be able to read lives in `notification-sound-model.ts` (settings spec §11):
 * which registry rows the group owns, how the daemon's listing is believed,
 * which sentence a refused upload earns and which remedy it offers, what the
 * volume readout and icon say, and where focus lands after a removal. These
 * tests pin each against the daemon's own wire shapes (local-operator #3403,
 * `server/routes/notification_sounds.py`).
 *
 * The bundle shape is `theme-grid-navigation.test.mjs`'s: esbuild the pure
 * module and import it from a data URL.
 */

import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `
			export * from "./src/renderer/src/features/settings/notification-sound-model";
			export { PROMOTED_SETTING_SECTIONS, sectionForSettingKey } from "./src/renderer/src/features/settings/promoted-setting-sections";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	define: { "import.meta.env": "{}" },
	// Fully bundled: a data-URL module has no base path to resolve a bare
	// import from (the model's only package is `lucide-react`).
	jsx: "automatic",
	write: false,
});
const model = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

/** The daemon's listing as #3403 serves it, trimmed to three built-ins. */
const LISTING = {
	sounds: [
		{
			id: "soft-pulse",
			label: "Soft pulse",
			builtin: true,
			duration_s: 0.83,
			is_default: true,
		},
		{
			id: "two-note-chime",
			label: "Two-note chime",
			builtin: true,
			duration_s: 0.87,
			is_default: false,
		},
		{
			id: "system",
			label: "System sound",
			builtin: true,
			duration_s: null,
			is_default: false,
		},
		{
			id: "custom-brass-ping-3fa9c1",
			label: "Brass ping",
			builtin: false,
			duration_s: 2.1,
			is_default: false,
			source_name: "brass.wav",
			normalized: true,
			created_at: "2026-11-03T12:00:00Z",
		},
	],
	selected: "soft-pulse",
	enabled: true,
	volume: 70,
	limits: {
		max_sounds: 50,
		max_bytes: 10485760,
		max_duration_s: 10,
		max_name_chars: 40,
	},
};

test("the listing is believed only in the daemon's shape", () => {
	const parsed = model.parseNotificationSoundListing(LISTING);
	assert.equal(parsed.sounds.length, 4);
	assert.equal(parsed.selected, "soft-pulse");
	assert.equal(parsed.volume, 70);
	assert.deepEqual(parsed.limits, LISTING.limits);
	// `system` carries no audio, which a null duration says.
	assert.equal(parsed.sounds[2].duration_s, null);

	assert.equal(model.parseNotificationSoundListing(null), null);
	assert.equal(model.parseNotificationSoundListing({ sounds: "x" }), null);
	assert.equal(model.parseNotificationSoundListing([]), null);
});

test("one malformed row is dropped, not the listing", () => {
	const parsed = model.parseNotificationSoundListing({
		...LISTING,
		sounds: [...LISTING.sounds, { label: "no id" }, 7],
	});
	assert.equal(parsed.sounds.length, 4);
});

test("missing limits fall back to the daemon's own numbers", () => {
	const { limits, ...rest } = LISTING;
	const parsed = model.parseNotificationSoundListing(rest);
	assert.deepEqual(parsed.limits, {
		max_sounds: 50,
		max_bytes: 10 * 1024 * 1024,
		max_duration_s: 10,
		max_name_chars: 40,
	});
});

test("the list renders Built-in, then System, then Your sounds", () => {
	const groups = model.groupNotificationSounds(
		model.parseNotificationSoundListing(LISTING).sounds,
	);
	assert.deepEqual(
		groups.builtin.map((row) => row.id),
		["soft-pulse", "two-note-chime"],
	);
	assert.equal(groups.system.id, "system");
	assert.deepEqual(
		groups.custom.map((row) => row.id),
		["custom-brass-ping-3fa9c1"],
	);
});

test("the group selects its rows by key and reports a missing one", () => {
	const rows = [
		{ key: "notifications.sound.enabled", value: true },
		{ key: "notifications.sound.id", value: "soft-pulse" },
		{ key: "unrelated", value: 1 },
	];
	const { byKey, missing } = model.notificationSoundRows(rows);
	assert.equal(byKey["notifications.sound.id"].value, "soft-pulse");
	assert.deepEqual(missing, ["notifications.sound.volume"]);
});

test("every key the section renders is promoted to it", () => {
	for (const key of [
		"display.notifications",
		"display.notification_session_name",
		"notifications.sound.enabled",
		"notifications.sound.id",
		"notifications.sound.volume",
	]) {
		assert.equal(model.sectionForSettingKey(key, "backend"), "notifications");
	}
	assert.equal(
		model.sectionForSettingKey("memory.enabled", "backend"),
		"backend",
	);
});

test("the readout says Default only at the registry default", () => {
	assert.deepEqual(model.volumeReadout(70, 70), {
		key: "ui.settings.notifications.volume.readout_default",
		value: 70,
	});
	assert.deepEqual(model.volumeReadout(45, 70), {
		key: "ui.settings.notifications.volume.readout",
		value: 45,
	});
	// A value set elsewhere (73) reads as itself, not snapped (§4.2).
	assert.equal(model.volumeReadout(73, 70).value, 73);
});

test("the volume icon is an indicator with audio-attachment's thresholds", () => {
	const x = model.volumeIcon(0);
	const one = model.volumeIcon(49);
	const two = model.volumeIcon(50);
	assert.notEqual(x, one);
	assert.notEqual(x, two);
	assert.notEqual(one, two);
	assert.equal(model.volumeIcon(100), two);
	assert.equal(model.volumeIcon(1), one);
});

test("the slider's description follows System, then mute, then the hint", () => {
	assert.equal(
		model.volumeDescriptionKey(70, "system"),
		"ui.settings.notifications.volume.system",
	);
	assert.equal(
		model.volumeDescriptionKey(0, "soft-pulse"),
		"ui.settings.notifications.volume.muted",
	);
	assert.equal(
		model.volumeDescriptionKey(70, "soft-pulse"),
		"ui.settings.notifications.volume.description",
	);
});

test("a custom duration reads m:ss and never under a second", () => {
	assert.equal(model.formatSoundDuration(2.1), "0:02");
	assert.equal(model.formatSoundDuration(0.3), "0:01");
	assert.equal(model.formatSoundDuration(9.6), "0:10");
	assert.equal(model.formatSoundDuration(null), null);
});

test("each upload refusal code earns its own sentence and remedy (§5.2)", () => {
	const cases = [
		[{ code: "too_large" }, "error.too_large", "choose_another"],
		[
			{ code: "unsupported_format", params: { format: "aiff" } },
			"error.unsupported_format",
			"choose_another",
		],
		[
			{ code: "unsupported_format", params: { format: "opus" } },
			"error.unsupported_codec",
			"choose_another",
		],
		[
			{ code: "unsupported_format", params: { format: "m4a" } },
			"error.unsupported_codec",
			"choose_another",
		],
		[
			{ code: "unsupported_format", params: { format: "aac" } },
			"error.unsupported_codec",
			"choose_another",
		],
		[
			{ code: "too_long", params: { seconds: "12.4" } },
			"error.too_long",
			"choose_another",
		],
		[{ code: "undecodable" }, "error.undecodable", "choose_another"],
		[{ code: "silent" }, "error.undecodable", "choose_another"],
		[{ code: "limit_reached" }, "custom.full", "choose_another"],
		[{ code: null }, "error.network", "retry"],
		[{ code: "store_failed" }, "error.network", "retry"],
	];
	for (const [refusal, key, action] of cases) {
		assert.deepEqual(
			model.uploadErrorCopyKey(refusal),
			{ key: `ui.settings.notifications.${key}`, action },
			JSON.stringify(refusal),
		);
	}
});

test("a too_long refusal names the measured seconds, else the limit", () => {
	assert.equal(
		model.refusalSeconds(
			{ code: "too_long", params: { seconds: "184.2" } },
			10,
		),
		"184.2",
	);
	assert.equal(
		model.refusalSeconds({ code: "too_long", params: { seconds: 12.44 } }, 10),
		"12.4",
	);
	assert.equal(model.refusalSeconds({ code: "too_long" }, 10), "10");
});

test("an added file is named by its stem, cut to the name limit", () => {
	assert.equal(model.fileStem("Door knock.wav", 40), "Door knock");
	assert.equal(model.fileStem("archive.tar.flac", 40), "archive.tar");
	assert.equal(model.fileStem(".hidden", 40), ".hidden");
	assert.equal(model.fileStem("C:\\sounds\\bell.mp3", 40), "bell");
	assert.equal(model.fileStem(`${"a".repeat(60)}.ogg`, 40).length, 40);
	// Code points, not UTF-16 units: an emoji is never split in half.
	assert.equal(
		Array.from(model.fileStem(`${"😀".repeat(45)}.wav`, 40)).length,
		40,
	);
});

test("files beyond the remaining slots are refused without a request", () => {
	assert.deepEqual(model.partitionBySlots(["a", "b", "c"], 48, 50), {
		accepted: ["a", "b"],
		overLimit: ["c"],
	});
	assert.deepEqual(model.partitionBySlots(["a"], 50, 50), {
		accepted: [],
		overLimit: ["a"],
	});
	assert.deepEqual(model.partitionBySlots(["a", "b"], 0, 50).overLimit, []);
});

test("rename validation: empty and over-long names are named inline", () => {
	assert.equal(
		model.renameError("   ", 40),
		"ui.settings.notifications.custom.rename_empty",
	);
	assert.equal(
		model.renameError("x".repeat(41), 40),
		"ui.settings.notifications.custom.rename_long",
	);
	assert.equal(model.renameError("Brass ping", 40), null);
	// Duplicates are allowed: ids are unique, names are not.
	assert.equal(model.renameError("Soft pulse", 40), null);
});

test("after a removal focus goes next, else previous, else Add", () => {
	const ids = ["a", "b", "c"];
	assert.equal(model.nextFocusAfterRemove(ids, "b"), "c");
	assert.equal(model.nextFocusAfterRemove(ids, "c"), "b");
	assert.equal(model.nextFocusAfterRemove(["a"], "a"), null);
	assert.equal(model.nextFocusAfterRemove(ids, "zz"), null);
});

test("the constants the spec fixes", () => {
	assert.equal(model.PREVIEW_OWNER_ID, "notification-sound-preview");
	assert.equal(model.SELECTION_WRITE_DEBOUNCE_MS, 400);
	assert.equal(model.VOLUME_STEP, 5);
	assert.equal(model.VOLUME_PAGE_STEP, 20);
	assert.equal(model.DEFAULT_VOLUME, 70);
	assert.equal(model.DEFAULT_SOUND_ID, "soft-pulse");
});
