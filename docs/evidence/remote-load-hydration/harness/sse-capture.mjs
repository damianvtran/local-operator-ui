#!/usr/bin/env node
/**
 * SSE capture v2 for the turn-order pin (session 53e0a8a53bc5).
 *
 * Differences from the lane's sse-capture.mjs:
 * - polls for a NEW remote session every 120ms (its own subscribe races the
 *   app's attach as closely as possible);
 * - timestamps EVERY SSE event boundary (`\n\n`) with epoch ms, plus the raw
 *   chunk, so a DOM flip can be attributed to a frame within ±1s;
 * - logs poll start / found / first-byte times into a meta file;
 * - accepts an optional session-id prefix filter (`--match <substr>`).
 *
 * Usage: node sse-capture2.mjs <out-dir> <known-ids-file> [--match <substr>] [--maxMs 240000]
 */
import { appendFileSync, readFileSync, writeFileSync } from "node:fs";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";

const TOKEN = readFileSync(
	`${process.env.HOME}/Library/Application Support/Local Operator/desktop-token`,
	"utf8",
).trim();
const OUT = process.argv[2];
mkdirSync(OUT, { recursive: true });
const known = new Set(
	readFileSync(process.argv[3], "utf8")
		.split("\n")
		.map((s) => s.trim())
		.filter(Boolean),
);
const matchAt = process.argv.indexOf("--match");
const MATCH = matchAt === -1 ? null : process.argv[matchAt + 1];
const maxMsAt = process.argv.indexOf("--maxMs");
const MAX_MS = maxMsAt === -1 ? 240_000 : Number(process.argv[maxMsAt + 1]);

const sidecar = join(OUT, `sse-capture2-${process.pid}.log`);
const log = (line) => appendFileSync(sidecar, `${Date.now()} ${line}\n`);
log(`poll start; known=${known.size} match=${MATCH ?? "*"}`);

function newRemoteSessions(rows) {
	return rows.filter(
		(r) =>
			r.locality === "remote" &&
			r.id &&
			!known.has(r.id) &&
			(MATCH === null || String(r.id).startsWith(MATCH)),
	);
}

let target = null;
const t0 = Date.now();
while (Date.now() - t0 < MAX_MS && !target) {
	try {
		const res = await fetch(
			"http://127.0.0.1:1111/v1/desktop/sessions?limit=120&include_peers=true",
			{ headers: { Authorization: `Bearer ${TOKEN}` } },
		);
		const data = await res.json();
		const rows = newRemoteSessions(data.result?.sessions ?? []);
		if (rows.length > 0) {
			// Newest first by created/updated when present, else take the first.
			rows.sort(
				(a, b) =>
					Number(b.created_at ?? b.updated_at ?? 0) -
					Number(a.created_at ?? a.updated_at ?? 0),
			);
			target = rows[0].id;
			break;
		}
	} catch (e) {
		/* keep polling */
	}
	await new Promise((r) => setTimeout(r, 120));
}
if (!target) {
	log("no new remote session appeared");
	console.log("sse-capture2: no new remote session appeared within timeout");
	process.exit(1);
}
const file = join(OUT, `sse2-${target}.txt`);
log(`found target=${target}; subscribing`);
console.log(`sse-capture2: capturing ${target} -> ${file}`);
appendFileSync(file, `# capture of ${target} subscribe-start ${Date.now()}\n`);

const controller = new AbortController();
const hardStop = setTimeout(() => controller.abort(), MAX_MS + 200_000);
try {
	const tSub = Date.now();
	const res = await fetch(
		`http://127.0.0.1:1111/v1/desktop/sessions/${target}/events`,
		{
			headers: { Authorization: `Bearer ${TOKEN}` },
			signal: controller.signal,
		},
	);
	log(`subscribed http=${res.status}`);
	const reader = res.body.getReader();
	const dec = new TextDecoder();
	let buf = "";
	let first = true;
	for (;;) {
		const { value, done } = await reader.read();
		if (done) break;
		const at = Date.now();
		if (first) {
			first = false;
			log(`first bytes +${at - tSub}ms`);
		}
		buf += dec.decode(value, { stream: true });
		// SSE events are separated by a blank line; emit each with its own stamp.
		let idx;
		while ((idx = buf.indexOf("\n\n")) !== -1) {
			const eventText = buf.slice(0, idx);
			buf = buf.slice(idx + 2);
			// A chunk may carry multiple events; the stamp is the read time for all
			// of them (they arrived in one TCP read), which is within a few ms.
			appendFileSync(file, `\n@@ ${at}\n` + eventText);
		}
	}
} catch (error) {
	if (error?.name !== "AbortError")
		appendFileSync(file, `\n@@ capture error: ${error?.message}\n`);
}
clearTimeout(hardStop);
appendFileSync(file, `\n@@ capture ends ${Date.now()}\n`);
log("capture ended");
console.log(`sse-capture2: capture of ${target} ended`);
