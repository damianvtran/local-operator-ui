#!/usr/bin/env node
/**
 * THE `imagegen-card` SCENE'S FIXTURE: a synthetic transcript journal carrying
 * generating-image calls in every state a DURABLE transcript can hold.
 *
 * The card's evidence has to run against the real stack the same way the
 * checkpoint rail's does (`transcript-rail-fixture.mjs`): the daemon derives
 * every page from a journal on disk, the app paints what it reads, and nothing
 * on screen is stubbed. This script writes the conversation the daemon reads,
 * into the config root the run owns, BEFORE its daemon starts:
 * `sessions/<id>/transcript.jsonl`, in the journal's own row format
 * (the shapes `local-operator`'s transcript writer emits and this repo's
 * `transcript-reducer.ts` `durableRecord` reads).
 *
 * THE SPLIT THIS FIXTURE CANNOT CARRY, and why it is stated here rather than
 * discovered from a frame: a durable row is SETTLED by construction, so the
 * three settled endings are all reachable - done (with a real image), failed
 * (with the frozen platform sentence on the result), cancelled (the runtime's
 * own `__fault: aborted` marker). `queued`, `running` and `cancelling` are
 * LIVE states, produced by `tool_execution_start` frames and the pane's own
 * stop fact, and no producer on this wire generates them for this tool yet -
 * the live progress fields are the harness lane's to freeze. Those states'
 * frames are the Storybook set's (`image-gen-card.stories.tsx`), and the scene
 * asserts their ABSENCE from the durable page rather than inventing them.
 *
 * THE DONE IMAGE IS REAL BYTES OVER THE REAL ROUTE. The row carries the
 * externalised shape (`{attachment: <digest>, mime_type}` - the encoder strips
 * inline base64 over the 1 KiB floor), and the fixture writes the bytes into
 * the same content-addressed store the transcript writer would have used
 * (`<config>/attachments/<digest>.bin` + its `.json` sidecar, the layout
 * `local-operator`'s `session/attachments.py` defines and `get` re-verifies by
 * hashing). So the renderer's fetch of
 * `GET /v1/desktop/sessions/<id>/attachments/<digest>` on the run's own daemon
 * is the shipped path end to end, and a broken route or a stripped blob: CSP
 * fails the scene's image check rather than hiding behind a placeholder.
 *
 * Usage: node scripts/imagegen-card-fixture.mjs <config_dir>
 *
 * The scene's full command line (daemon + token + driver) is the scene's own
 * doc block in `scripts/renderer-driver.mjs`.
 */
import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { isEntryPoint } from "./entry-point.mjs";

/** The conversation this fixture writes; the scene opens it by this id. */
export const IMAGEGEN_FIXTURE_SESSION = "1a9efacade01";

/**
 * The call ids of the four generating calls, in turn order.
 *
 * EXPORTED so the scene's selectors and this file's rows are one fact: a call
 * id written twice is a call id that drifts, and `tool:<callId>` is exactly
 * what the transcript's record lookup keys on.
 */
export const IMAGEGEN_CALL_DONE = "call-img-done";
export const IMAGEGEN_CALL_FAILED = "call-img-failed";
export const IMAGEGEN_CALL_CANCELLED = "call-img-cancelled";
export const IMAGEGEN_CALL_FOLD = "call-img-fold";

const BASE_TS = 1781500000; // epoch seconds; ~2026-06-15, increasing across the log

/* ------------------------------------------------------------------ the PNG */

/** CRC32 (a PNG chunk's checksum), table-driven once per process. */
const CRC_TABLE = (() => {
	const table = new Uint32Array(256);
	for (let n = 0; n < 256; n += 1) {
		let c = n;
		for (let k = 0; k < 8; k += 1) {
			c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
		}
		table[n] = c >>> 0;
	}
	return table;
})();

function crc32(bytes) {
	let c = 0xffffffff;
	for (const b of bytes) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
	return (c ^ 0xffffffff) >>> 0;
}

/** One PNG chunk: length, type, data, CRC over type+data. */
function chunk(type, data) {
	const out = Buffer.alloc(8 + data.length + 4);
	out.writeUInt32BE(data.length, 0);
	out.write(type, 4, "ascii");
	data.copy(out, 8);
	out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
	return out;
}

/**
 * A deterministic truecolour PNG: a vertical gradient from `from` to `to`.
 *
 * WHY A GENERATOR AND NOT A COMMITTED .png: the fixture must be reproducible
 * from the repository alone (the rail fixture's own rule - it mints every
 * journal row it needs), and a gradient is exactly what makes two generated
 * candidates distinguishable in one frame. The bytes are what matter, not the
 * picture: the digest that goes in the journal is this file's sha256, so any
 * drift between "what the row references" and "what the store holds" fails the
 * store's own re-hash on read and the scene's image check after it.
 */
function gradientPng(width, height, from, to) {
	const raw = Buffer.alloc(height * (1 + width * 3));
	for (let y = 0; y < height; y += 1) {
		const t = y / (height - 1);
		const row = y * (1 + width * 3);
		raw[row] = 0; // filter: none
		for (let x = 0; x < width; x += 1) {
			const at = row + 1 + x * 3;
			raw[at] = Math.round(from[0] + (to[0] - from[0]) * t);
			raw[at + 1] = Math.round(from[1] + (to[1] - from[1]) * t);
			raw[at + 2] = Math.round(from[2] + (to[2] - from[2]) * t);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8; // bit depth
	ihdr[9] = 2; // colour type: truecolour
	// ihdr[10..12] stay 0: deflate compression, adaptive filtering, no interlace.
	return Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/**
 * Write one image into the content-addressed store the transcript writer reads,
 * and return the digest its row references.
 *
 * The digest is `sha256(bytes)[:32]` hex, and the sidecar is the store's own
 * shape (`{"digest", "mime_type", "bytes"}`) - written exactly as
 * `session/attachments.py`'s `put` writes it, because `get` re-hashes the
 * content against the filename and treats a mismatch as missing. A sidecar
 * this fixture invented would resolve to a placeholder in the frame.
 */
function writeAttachment(root, png) {
	const digest = createHash("sha256").update(png).digest("hex").slice(0, 32);
	const dir = join(root, "attachments");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${digest}.bin`), png);
	writeFileSync(
		join(dir, `${digest}.json`),
		JSON.stringify({
			digest,
			mime_type: "image/png",
			bytes: png.length,
		}),
	);
	return digest;
}

/* -------------------------------------------------------------- the journal */

const user = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "user", content: [{ text }] },
});

const assistant = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "assistant", content: [{ text }] },
});

/**
 * The assistant row that carried the calls: no prose, `tool_calls` only - the
 * shape `durableRecord` reads into `argsByCall` and deliberately paints as an
 * empty row (its comment: the paired `tool` results are the rows). A closing
 * text row follows where a turn had one.
 */
const calls = (id, ts, toolCalls) => ({
	id,
	ts,
	type: "message",
	payload: {
		kind: "message",
		role: "assistant",
		content: [],
		tool_calls: toolCalls,
	},
});

/**
 * One `tool` result row, in the durable shape the reducer's `role === "tool"`
 * branch reads: `tool_call_id` + `tool_name` are the row's identity, `content`
 * carries the blocks (`{text}` for prose, `{attachment, mime_type}` for an
 * externalised image), `is_error` is the wire's own verdict, and
 * `provider_payload` carries the measured `duration_s` beside the runtime's
 * `details` (where `__fault` classifies an interrupted end - the marker the
 * durable half of the interrupt reading turns on).
 */
const toolResult = (
	id,
	ts,
	{ callId, toolName, content, isError, durationS, fault },
) => ({
	id,
	ts,
	type: "message",
	payload: {
		kind: "message",
		role: "tool",
		tool_call_id: callId,
		tool_name: toolName,
		content,
		is_error: isError,
		provider_payload: {
			duration_s: durationS,
			...(fault === undefined ? {} : { details: { __fault: fault } }),
		},
	},
});

const call = (callId, toolName, args) => ({
	tool_call_id: callId,
	tool_name: toolName,
	arguments: args,
});

/**
 * The journal: four turns, one per state a durable transcript can hold plus a
 * folded run.
 *
 *   - turn 1: a COMPLETED generation - the image, its digest resolving to the
 *     bytes written beside this file, and the backend's own duration;
 *   - turn 2: a FAILED generation - the frozen platform sentence on the
 *     result, verbatim, which is what the card renders;
 *   - turn 3: the user's stop - the runtime's `aborted` fault on the result,
 *     no error flag, no image;
 *   - turn 4: a settled run of three calls (shell, a second generation, a
 *     read) - the group the transcript condenses, whose collapsed bar carries
 *     the run's pictures (the fold's media strip) and whose expanded rows hold
 *     the card among its neighbours.
 */
export function journalRows() {
	const rows = [];
	let ts = BASE_TS;

	/* Turn 1: done. */
	ts += 20;
	rows.push(
		user(
			"e-img-u1",
			ts,
			"Generate a hero image for the landing page: a dusk skyline over calm water.",
		),
	);
	ts += 15;
	rows.push(
		calls("e-img-a1", ts, [
			call(IMAGEGEN_CALL_DONE, "generate_image", {
				prompt: "dusk skyline over calm water, wide",
			}),
		]),
	);
	ts += 25;
	const doneDigest = DONE_PNG_DIGEST;
	rows.push(
		toolResult("e-img-t1", ts, {
			callId: IMAGEGEN_CALL_DONE,
			toolName: "generate_image",
			content: [
				{ attachment: doneDigest, mime_type: "image/png" },
				{ text: "Generated image: dusk_skyline.png (1024x640)" },
			],
			isError: false,
			durationS: 12.4,
		}),
	);
	ts += 20;
	rows.push(
		assistant(
			"e-img-a2",
			ts,
			"Here's the first pass - say the word if you want the sky warmer.",
		),
	);
	ts += 40;

	/* Turn 2: failed. */
	rows.push(
		user("e-img-u2", ts, "Now try it with no lettering at all, pure pattern."),
	);
	ts += 15;
	rows.push(
		calls("e-img-a3", ts, [
			call(IMAGEGEN_CALL_FAILED, "generate_image", {
				prompt: "pure geometric pattern, no text",
			}),
		]),
	);
	ts += 25;
	rows.push(
		toolResult("e-img-t2", ts, {
			callId: IMAGEGEN_CALL_FAILED,
			toolName: "generate_image",
			content: [{ text: "This generation failed before producing output." }],
			isError: true,
			durationS: 3.2,
			fault: "execution",
		}),
	);
	ts += 20;
	rows.push(
		assistant("e-img-a4", ts, "That attempt did not produce an image."),
	);
	ts += 40;

	/* Turn 3: cancelled. */
	rows.push(user("e-img-u3", ts, "One more, then stop - something quick."));
	ts += 15;
	rows.push(
		calls("e-img-a5", ts, [
			call(IMAGEGEN_CALL_CANCELLED, "generate_image", {
				prompt: "something quick",
			}),
		]),
	);
	ts += 25;
	rows.push(
		toolResult("e-img-t3", ts, {
			callId: IMAGEGEN_CALL_CANCELLED,
			toolName: "generate_image",
			content: [],
			isError: false,
			durationS: 0.5,
			fault: "aborted",
		}),
	);
	ts += 40;

	/* Turn 4: the settled run of three calls, one of them a generation. */
	rows.push(
		user(
			"e-img-u4",
			ts,
			"Sweep the assets directory and draft one more candidate from the file list.",
		),
	);
	ts += 15;
	rows.push(
		calls("e-img-a6", ts, [
			call("call-img-fold-bash", "bash", { command: "ls assets" }),
			call(IMAGEGEN_CALL_FOLD, "generate_image", {
				prompt: "pattern candidate from assets",
			}),
			call("call-img-fold-read", "read", { path: "assets/candidate.png" }),
		]),
	);
	ts += 10;
	rows.push(
		toolResult("e-img-t4a", ts, {
			callId: "call-img-fold-bash",
			toolName: "bash",
			content: [{ text: "exit code: 0\nhero.png\ncandidate.png" }],
			isError: false,
			durationS: 0.4,
		}),
	);
	ts += 20;
	rows.push(
		toolResult("e-img-t4b", ts, {
			callId: IMAGEGEN_CALL_FOLD,
			toolName: "generate_image",
			content: [
				{ attachment: FOLD_PNG_DIGEST, mime_type: "image/png" },
				{ text: "Generated image: pattern_candidate.png (896x576)" },
			],
			isError: false,
			durationS: 9.1,
		}),
	);
	ts += 20;
	rows.push(
		toolResult("e-img-t4c", ts, {
			callId: "call-img-fold-read",
			toolName: "read",
			content: [{ text: "read candidate.png (204 KB)" }],
			isError: false,
			durationS: 0.2,
		}),
	);
	ts += 20;
	rows.push(
		assistant(
			"e-img-a7",
			ts,
			"One more candidate is in - the strip above keeps it.",
		),
	);

	return rows;
}

/*
 * The two generated candidates, minted once at module load so `journalRows` is
 * deterministic and the digests in the rows are derived from the same bytes the
 * writer stores. Dusk for the hero, a cooler teal for the fold's candidate -
 * two visibly different pictures, which is what makes "the strip counts the
 * finished image" readable from the frame rather than from the log.
 */
const DONE_PNG = gradientPng(1024, 640, [42, 30, 79], [242, 153, 74]);
const FOLD_PNG = gradientPng(896, 576, [15, 42, 63], [55, 198, 160]);
const DONE_PNG_DIGEST = createHash("sha256")
	.update(DONE_PNG)
	.digest("hex")
	.slice(0, 32);
const FOLD_PNG_DIGEST = createHash("sha256")
	.update(FOLD_PNG)
	.digest("hex")
	.slice(0, 32);

/** Write the journal and both images into the config root; report what went. */
export function writeImagegenFixture(root) {
	const dir = join(root, "sessions", IMAGEGEN_FIXTURE_SESSION);
	mkdirSync(dir, { recursive: true });
	const rows = journalRows();
	const path = join(dir, "transcript.jsonl");
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	const attachments = [
		writeAttachment(root, DONE_PNG),
		writeAttachment(root, FOLD_PNG),
	];
	return { path, rows: rows.length, attachments };
}

/*
 * The shared entry-point helper, not `process.argv[1]?.endsWith(...)`: through
 * a symlinked directory the lexical comparison is the silent no-op
 * `entry-point.test.mjs` scans for, and a fixture that never runs exits 0.
 */
if (isEntryPoint(import.meta.url)) {
	const root = process.argv[2];
	if (!root) {
		console.error("usage: node scripts/imagegen-card-fixture.mjs <config_dir>");
		process.exit(2);
	}
	const written = writeImagegenFixture(root);
	console.log(
		`wrote ${written.rows} rows for ${IMAGEGEN_FIXTURE_SESSION} -> ${written.path}`,
	);
	for (const digest of written.attachments) {
		console.log(
			`wrote attachment ${digest} under ${join(root, "attachments")}`,
		);
	}
}
