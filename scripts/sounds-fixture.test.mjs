import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";
import {
	SOUNDS_COUNT,
	SOUNDS_SESSION,
	soundSample,
	writeSoundsFixture,
} from "./sounds-fixture.mjs";

const bundle = await build({
	stdin: {
		contents:
			'export {applyHistoryPage, EMPTY_TRANSCRIPT} from "./src/renderer/src/features/chat/canonical/transcript-reducer";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
});
const { applyHistoryPage, EMPTY_TRANSCRIPT } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);

test("sounds native preflight: journal mounts audio and Highlights; fixture has real nonzero PCM", () => {
	assert.match(SOUNDS_SESSION, /^[a-f0-9]{12}$/);
	const root = mkdtempSync(join(homedir(), "sounds-fixture-"));
	const fixture = writeSoundsFixture(root);
	const entries = readFileSync(
		join(root, "sessions", fixture.sessionId, "transcript.jsonl"),
		"utf8",
	)
		.trim()
		.split("\n")
		.map((line) => JSON.parse(line));
	const state = applyHistoryPage(EMPTY_TRANSCRIPT, {
		entries,
		has_more: false,
	});
	const sound = state.records.find((row) => row.kind === "tool").images[0];
	assert.equal(sound.kind, "audio");
	assert.equal(sound.attachment, fixture.digest);
	assert.equal(sound.durationS, 12);
	assert.match(sound.sourceUrl, /expired-signed-audio/);
	assert.equal(
		state.records.find((row) => row.kind === "supplement").sounds[0].attachment,
		fixture.digest,
	);
	/*
	 * THE COLLAGE'S INPUT: fourteen DISTINCT sounds on one row, every digest
	 * backed by its own bytes and sidecar. The layout cases (condensed and
	 * expanded) assert the count in the DOM; this preflight is what proves the
	 * fixture really seeds fourteen, so a scene that found one could not pass
	 * for the wrong reason.
	 */
	const highlights = state.records.find((row) => row.kind === "supplement");
	assert.equal(highlights.sounds.length, SOUNDS_COUNT);
	assert.equal(
		new Set(highlights.sounds.map((row) => row.attachment)).size,
		SOUNDS_COUNT,
	);
	assert.deepEqual(
		highlights.sounds.map((row) => row.attachment),
		fixture.digests,
	);
	for (const [tone, digest] of fixture.digests.entries()) {
		assert.equal(
			readFileSync(join(root, "attachments", `${digest}.bin`)).length,
			fixture.bytes,
			`sound ${tone + 1} has its own bytes`,
		);
		const sidecar = JSON.parse(
			readFileSync(join(root, "attachments", `${digest}.peaks.json`), "utf8"),
		);
		assert.equal(sidecar.peaks.length, sidecar.bars);
	}
	const wav = soundSample();
	assert.equal(wav.toString("ascii", 0, 4), "RIFF");
	assert.notEqual(
		wav.readInt16LE(46),
		0,
		"zero-gain proof cannot use a silent input sample",
	);
	const peaks = JSON.parse(
		readFileSync(join(root, "attachments", `${fixture.digest}.peaks.json`)),
	);
	assert.equal(peaks.peaks.length, peaks.bars);
});
