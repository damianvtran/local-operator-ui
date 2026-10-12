#!/usr/bin/env node
/**
 * THE `image-copy` SCENE'S FIXTURE: a synthetic transcript journal carrying the
 * two images the copy-bug pair is about — one JPEG, one PNG — as real bytes
 * behind the daemon's own attachment route.
 *
 * WHY THIS EXISTS, and what it mirrors. The operator's report (2026-10-11) was
 * `Copy image` failing on a conversation's pictures; the root cause — Chromium's
 * sanitized clipboard write takes ONLY `image/png` among image types — is a fact
 * about the REAL bytes of a JPEG, so the evidence cannot run against a stub that
 * fabricates a MIME string. This script writes a conversation into the config
 * root a run owns, BEFORE its daemon starts: `sessions/<id>/transcript.jsonl`,
 * in the journal's own row format, plus the two images in the same
 * content-addressed store the transcript writer would have used
 * (`<config>/attachments/<digest>.bin` + its `.json` sidecar, the layout
 * `local-operator`'s `session/attachments.py` defines and `get` re-verifies by
 * hashing). The renderer then fetches both pictures over
 * `GET /v1/desktop/sessions/<id>/attachments/<digest>` on the run's own daemon —
 * the shipped path end to end — and the scene presses the real menu.
 *
 * THE JPEG IS AN EMBEDDED BASE64 BYTES-LITERAL, deliberately: a lossy JPEG is
 * the format whose blob the clipboard REFUSES (`Type image/jpeg not supported on
 * write.`), and the fixture must be reproducible from the repository alone
 * without a JPEG encoder among its dependencies. The bytes were generated once
 * from a deterministic raw gradient with `sharp` (320x200, quality 85,
 * 4:2:0 — the shape a screenshot re-saved as a photo would take), and are pinned
 * here so the digest in the journal and the bytes on disk cannot drift. It is a
 * REAL lossy JPEG on purpose: the transcode under test decodes it, so a fixture
 * that was secretly a PNG would exercise a different decode path than the one
 * the bug was about.
 *
 * THE PNG IS MINTED HERE, the way `imagegen-card-fixture.mjs` mints its own: a
 * gradient through the same chunk-level writer, so the pass-through half of the
 * fix is provable by comparing clipboard bytes against these exact bytes. 240x160
 * (distinct from the JPEG's 320x200, so a frame's two pictures can never be
 * confused for one another).
 *
 * Usage: node scripts/image-copy-fixture.mjs <config_dir>
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
export const COPY_FIXTURE_SESSION = "2b7ce4a91d02";

/**
 * The call ids of the two tool results carrying the pictures, in turn order.
 *
 * EXPORTED so the scene's selectors and this file's rows are one fact: a call id
 * written twice is a call id that drifts, and `tool:<callId>` is exactly what
 * the transcript's record lookup keys on.
 */
export const COPY_JPEG_CALL = "call-copy-jpeg";
export const COPY_PNG_CALL = "call-copy-png";

/** The two sources' own sizes, which the scene asserts off the clipboard. */
export const COPY_JPEG_SIZE = { width: 320, height: 200 };
export const COPY_PNG_SIZE = { width: 240, height: 160 };

const BASE_TS = 1781600000; // epoch seconds; ~2026-06-16, increasing across the log

/* ------------------------------------------------------------------ the JPEG */

/**
 * The JPEG bytes, as the base64 literal described at this file's head.
 *
 * Kept as ONE string with no wrapping so `COPY_JPEG_BYTES` below is the only
 * spelling of the bytes; the digest in the journal is derived from it, and the
 * store's own re-hash on read is what fails loudly if this literal were ever
 * hand-edited into a different picture.
 */
export const COPY_JPEG_BASE64 =
	"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";

/** The JPEG's bytes, decoded once. */
export const COPY_JPEG_BYTES = Buffer.from(COPY_JPEG_BASE64, "base64");

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
	for (const byte of bytes) {
		c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
	}
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
 * The same generator `imagegen-card-fixture.mjs` carries, and the same reason:
 * the fixture must mint every byte it needs, and a gradient makes the picture's
 * own extent unmistakable in a frame. The digest that goes in the journal is
 * this file's sha256, so drift between "what the row references" and "what the
 * store holds" fails the store's own re-hash and the scene's byte-compare after
 * it.
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

/*
 * Minted once at module load so the journal's digest and the writer's bytes come
 * from the same buffer. A cool blue-grey against the JPEG's warm gradient: two
 * visibly different pictures, so a frame that painted the wrong one for a row
 * is readable without opening the clipboard at all.
 */
export const COPY_PNG_BYTES = gradientPng(
	COPY_PNG_SIZE.width,
	COPY_PNG_SIZE.height,
	[16, 32, 64],
	[120, 180, 210],
);

/**
 * Write one image into the content-addressed store the transcript writer reads,
 * and return the digest its row references.
 *
 * The digest is `sha256(bytes)[:32]` hex, and the sidecar is the store's own
 * shape (`{"digest", "mime_type", "bytes"}`) — written exactly as
 * `session/attachments.py`'s `put` writes it, because `get` re-hashes the
 * content against the filename and treats a mismatch as missing, and because the
 * route's Content-Type (which becomes the blob's own MIME downstream) is read
 * from this sidecar by the daemon.
 */
function writeAttachment(root, bytes, mimeType) {
	const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 32);
	const dir = join(root, "attachments");
	mkdirSync(dir, { recursive: true });
	writeFileSync(join(dir, `${digest}.bin`), bytes);
	writeFileSync(
		join(dir, `${digest}.json`),
		JSON.stringify({ digest, mime_type: mimeType, bytes: bytes.length }),
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
 * The assistant row that carried the calls: no prose, `tool_calls` only — the
 * shape `durableRecord` reads into `argsByCall` and deliberately paints as an
 * empty row (its comment: the paired `tool` results are the rows).
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
 * externalised image), and `is_error` is the wire's own verdict.
 */
const toolResult = (id, ts, { callId, toolName, content, isError }) => ({
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
	},
});

const call = (callId, toolName, args) => ({
	tool_call_id: callId,
	tool_name: toolName,
	arguments: args,
});

/**
 * The journal: ONE turn holding both reads, so one collapse bar reveals the
 * pair and the two presses in the scene sit in the same settled run — the shape
 * the operator's own rows take when a turn reads several files.
 *
 * The rows are `read` results, carrying a picture each: exactly the surface the
 * operator reported on (a tool row's screenshot), with the two MIME types side
 * by side so ONE scene run can show both halves — the JPEG that was refused
 * before the fix and the PNG that always worked.
 */
export function journalRows(jpegDigest, pngDigest) {
	const rows = [];
	let ts = BASE_TS;

	ts += 20;
	rows.push(
		user(
			"e-copy-u1",
			ts,
			"Look at both of these — the photo I took and the diagram — and tell me what you see.",
		),
	);
	ts += 15;
	rows.push(
		calls("e-copy-a1", ts, [
			call(COPY_JPEG_CALL, "read", { path: "shots/desk-photo.jpg" }),
			call(COPY_PNG_CALL, "read", { path: "shots/architecture.png" }),
		]),
	);
	ts += 25;
	rows.push(
		toolResult("e-copy-t1", ts, {
			callId: COPY_JPEG_CALL,
			toolName: "read",
			content: [
				{ attachment: jpegDigest, mime_type: "image/jpeg" },
				{ text: "read shots/desk-photo.jpg (320x200)" },
			],
			isError: false,
		}),
	);
	ts += 10;
	rows.push(
		toolResult("e-copy-t2", ts, {
			callId: COPY_PNG_CALL,
			toolName: "read",
			content: [
				{ attachment: pngDigest, mime_type: "image/png" },
				{ text: "read shots/architecture.png (240x160)" },
			],
			isError: false,
		}),
	);
	ts += 20;
	rows.push(
		assistant(
			"e-copy-a2",
			ts,
			"The photo is a dusk gradient and the diagram is a cool blue one — both are in the transcript above.",
		),
	);

	return rows;
}

/** Write the journal and both images into the config root; report what went. */
export function writeImageCopyFixture(root) {
	const jpegDigest = writeAttachment(root, COPY_JPEG_BYTES, "image/jpeg");
	const pngDigest = writeAttachment(root, COPY_PNG_BYTES, "image/png");
	const dir = join(root, "sessions", COPY_FIXTURE_SESSION);
	mkdirSync(dir, { recursive: true });
	const rows = journalRows(jpegDigest, pngDigest);
	const path = join(dir, "transcript.jsonl");
	writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
	return { path, rows: rows.length, attachments: [jpegDigest, pngDigest] };
}

/*
 * The shared entry-point helper, not `process.argv[1]?.endsWith(...)`: through
 * a symlinked directory the lexical comparison is the silent no-op
 * `entry-point.test.mjs` scans for, and a fixture that never runs exits 0.
 */
if (isEntryPoint(import.meta.url)) {
	const root = process.argv[2];
	if (!root) {
		console.error("usage: node scripts/image-copy-fixture.mjs <config_dir>");
		process.exit(2);
	}
	const written = writeImageCopyFixture(root);
	console.log(
		`wrote ${written.rows} rows for ${COPY_FIXTURE_SESSION} -> ${written.path}`,
	);
	for (const digest of written.attachments) {
		console.log(
			`wrote attachment ${digest} under ${join(root, "attachments")}`,
		);
	}
}
