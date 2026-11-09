import assert from "node:assert/strict";
import { test } from "node:test";
import { build } from "esbuild";

const compiled = await build({
	entryPoints: [
		"src/renderer/src/features/chat/canonical/music-receipt-model.ts",
	],
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { musicReceiptOf } = await import(
	`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString("base64")}`
);
const digest = "a".repeat(32);

test("only structured music evidence admits audio, never a checksum in prose", () => {
	assert.equal(
		musicReceiptOf({ text: `Music ready digest ${digest}`, artifacts: [] }),
		undefined,
	);
	assert.equal(
		musicReceiptOf({ material: "music", tracks: "invalid" }),
		undefined,
	);
});

test("identical bytes retain distinct logical track identities and exact receipt costs", () => {
	const value = musicReceiptOf({
		material: "music",
		attribution: "Approved co-branding",
		tracks: [
			{
				id: "one",
				title: "Piano",
				variant_index: 0,
				cost: { amount_usd: 0.0075, basis: "billed" },
			},
			{
				id: "two",
				title: "Piano",
				variant_index: 1,
				cost: { amount_usd: 0.0075, basis: "billed" },
			},
		],
		artifacts: [
			{
				digest,
				track_id: "one",
				artifact_id: "first",
				role: "full_mix",
				name: "piano-1.mp3",
				duration_s: 3.1,
			},
			{
				digest,
				track_id: "two",
				artifact_id: "second",
				role: "full_mix",
				name: "piano-2.mp3",
				duration_s: 3.2,
			},
		],
	});
	assert.equal(value.tracks.length, 2);
	assert.notEqual(value.tracks[0].images[0].id, value.tracks[1].images[0].id);
	assert.equal(
		value.tracks[0].images[0].attachment,
		value.tracks[1].images[0].attachment,
	);
	assert.equal(value.tracks[0].cost.basis, "billed");
	assert.equal(value.tracks[1].images[0].durationS, 3.2);
	assert.equal(value.attribution, "Approved co-branding");
});

test("failed siblings and missing-byte errors never erase purchased audio", () => {
	const value = musicReceiptOf({
		material: "music",
		tracks: [
			{ id: "one", variant_index: 0 },
			{ id: "two", variant_index: 1, error_type: "audio_failed" },
			{ id: "three", variant_index: 2, registration_error: "hash_mismatch" },
		],
		artifacts: [
			{ digest, track_id: "one", artifact_id: "first", role: "full_mix" },
		],
	});
	assert.equal(value.tracks.length, 3);
	assert.equal(value.tracks[0].images.length, 1);
	assert.equal(value.tracks[1].error, true);
	assert.equal(value.tracks[2].error, true);
});
