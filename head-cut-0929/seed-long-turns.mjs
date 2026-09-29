#!/usr/bin/env node
/**
 * Seed ONE long-turn conversation for the head-cut condensation repro.
 *
 *     node seed-long-turns.mjs <config-dir>
 *
 * WHY A CUSTOM SHAPE. The committed `transcript-rail-fixture.mjs` builds turns
 * of ~7 rows, so any jump lands with the turn's head inside the same durable
 * page and the shipped alignment ("snap + <=2-page fetch") can always reach it.
 * This fixture makes turns of several HUNDRED rows so the head of the turn a
 * reader lands in is several 100-row pages above the loaded set - the case the
 * operator reports ("the previous message is a few chunk loads up").
 *
 * Rows are the journal's own shape (`transcript.jsonl`, the shapes
 * `local-operator`'s tests pin): attention_started -> user -> [assistant step,
 * tool step] * K -> final assistant -> completion marker. K per turn is chosen
 * so the LAST turn is ~6 pages tall (the open state) and turn 7 is ~4.5 pages
 * tall with a jumpable completion tick ~7 pages back.
 *
 * Session id and row-id prefixes are fixed and session-unique (`a`), so the
 * probe can name its ticks and never collides with any other fixture.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const CONFIG = process.argv[2];
if (!CONFIG) {
	console.error("usage: node seed-long-turns.mjs <config-dir>");
	process.exit(2);
}

export const SESSION = "be1a9fef00a1";
const BASE_TS = 1780500000; // epoch seconds

/* K per turn: 2K+4 rows per turn. Sum = 2*(220+260+220+260+220+260+220+300)+32 = 3952 rows. */
const KS = [220, 260, 220, 260, 220, 260, 220, 300];

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
const tool = (id, ts, text) => ({
	id,
	ts,
	type: "message",
	payload: { kind: "message", role: "tool", content: [{ text }] },
});
const start = (id, ts, token) => ({
	id,
	ts,
	type: "custom",
	payload: {
		custom_type: "attention_started",
		details: { conversation_id: `session/${SESSION}`, token },
	},
});
const marker = (id, ts, token) => ({
	id,
	ts,
	type: "custom",
	payload: {
		custom_type: "completion_attention",
		details: {
			conversation_id: `session/${SESSION}`,
			token,
			eligible: true,
			kind: "complete",
			anchor: "a-anchor",
		},
	},
});

const rows = [];
let ts = BASE_TS;
KS.forEach((K, i) => {
	const turn = i + 1;
	const tag = String(turn).padStart(4, "0");
	const token = `atok-${tag}`;
	ts += 20;
	rows.push(start(`aatt${tag}`, ts, token));
	ts += 5;
	rows.push(
		user(`au${tag}`, ts, `Long-turn fixture turn ${turn}: keep going through the steps.`),
	);
	for (let step = 0; step < K; step += 1) {
		const s = String(step + 1).padStart(3, "0");
		ts += 2;
		rows.push(
			assistant(
				`ap${tag}${s}`,
				ts,
				`Step ${step + 1} of ${K} for turn ${turn}: checked the ledger; nothing needs a decision yet.`,
			),
		);
		ts += 2;
		rows.push(
			tool(
				`at${tag}${s}`,
				ts,
				`command ${turn}.${step + 1}: exit 0, 0.3s, no output kept`,
			),
		);
	}
	ts += 30;
	rows.push(
		assistant(`an${tag}`, ts, `Turn ${turn} settled; the work is done and nothing is left open.`),
	);
	ts += 10;
	rows.push(marker(`acm${tag}`, ts, token));
	ts += 60;
});

const root = resolve(CONFIG);
const dir = join(root, "sessions", SESSION);
mkdirSync(dir, { recursive: true });
const path = join(dir, "transcript.jsonl");
writeFileSync(path, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`);
console.log(`wrote ${rows.length} rows for ${SESSION} -> ${path}`);
