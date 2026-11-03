#!/usr/bin/env node
/**
 * The button-slot claim, read off a `composer-readings-geometry.mjs` capture:
 * in every state the composer can be photographed in, the mic's press point
 * (slot A) and the primary slot (slot B) keep the x they have when idle, and the
 * recording trio only ADDS a box to their left.
 *
 *     node scripts/composer-readings-geometry.mjs --label=after \
 *         --states=idle,idle-text,running,running-text,stopping,recording,mic-off,sendrec-hang,sendrec-ok,sendrec-empty,sendrec-error,sendrec-running \
 *         --widths=1024,520 --themes=both --only=-plain- --out=<dir>
 *     node scripts/composer-slots-proof.mjs <dir>/numbers.json [--tree=before|after]
 *
 * Reads the capture, writes `<dir>/slot-proof.json` beside it and exits 1 when
 * the claim fails. Run with `--tree=before` on a capture from a tree without the
 * slot markers to see the claim FAIL (the mic moves when Stop appears); the
 * before tree has no `data-composer-slot` markers, so its slots are identified
 * by order from the right edge (last button = primary).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const [file, ...rest] = process.argv.slice(2);
if (!file) {
	console.error("usage: composer-slots-proof.mjs <numbers.json> [--tree=...]");
	process.exit(2);
}
const TREE = (
	rest.find((a) => a.startsWith("--tree=")) ?? "--tree=after"
).slice(7);
const rows = Object.values(JSON.parse(readFileSync(file, "utf8")));

/** Slot A is the button 36px (one control + gap) left of the primary, slot B the last one. */
const positions = (row) => {
	const buttons = row.slots ?? [];
	const b = buttons.find((s) => s.slot === "b") ?? buttons[buttons.length - 1];
	const a =
		buttons.find((s) => s.slot === "a") ??
		buttons.find((s) => s.label === "Start recording");
	return { a, b, count: buttons.length };
};

const byGroup = new Map();
for (const row of rows) {
	if (!row.fixture)
		throw new Error(
			`${row.id}: no readings fixture name; capture with a rig that records \`fixture\``,
		);
	const key = `${row.width}|${row.theme}|${row.fixture}`;
	if (!byGroup.has(key)) byGroup.set(key, []);
	byGroup.get(key).push(row);
}

const out = { tree: TREE, groups: [], failures: [] };
for (const [key, group] of byGroup) {
	// One group per (width, theme, readings fixture): the idle reference has to be
	// the same row the other states are compared with.
	const idle = group.find((r) => r.state === "idle");
	if (!idle) continue;
	const ref = positions(idle);
	const states = [];
	for (const row of group) {
		const { a, b, count } = positions(row);
		const entry = {
			state: row.state,
			boxes: count,
			slotA: a ? { label: a.label, left: a.left } : null,
			slotB: b ? { label: b.label, left: b.left } : null,
			clusterWidth: row.controls?.width,
			aEqualsIdle: a?.left === ref.a?.left,
			bEqualsIdle: b?.left === ref.b?.left,
			// The row must never overflow its card: a control pushed past the edge is
			// the failure the preparing caption caused (QA round 1, Q1).
			rowOverflow: row.row?.overflow ?? null,
			sent: row.sent?.length ?? 0,
			boxValue: row.boxValue,
		};
		states.push(entry);
		if (entry.rowOverflow !== null && entry.rowOverflow > 0)
			out.failures.push(
				`${key} ${row.state}: the row overflows by ${entry.rowOverflow}px`,
			);
		if (!entry.aEqualsIdle || !entry.bEqualsIdle)
			out.failures.push(
				`${key} ${row.state}: A ${a?.left} B ${b?.left} vs idle A ${ref.a?.left} B ${ref.b?.left}`,
			);
	}
	out.groups.push({ key, idleA: ref.a?.left, idleB: ref.b?.left, states });
}
out.verdict = out.failures.length === 0 ? "PASS" : "FAIL";
writeFileSync(
	join(dirname(file), "slot-proof.json"),
	`${JSON.stringify(out, null, 2)}\n`,
);
for (const g of out.groups) {
	console.log(`\n${g.key}  idle A=${g.idleA} B=${g.idleB}`);
	for (const s of g.states)
		console.log(
			`  ${s.state.padEnd(14)} ov=${String(s.rowOverflow).padEnd(4)} boxes=${s.boxes} A=${String(s.slotA?.left).padEnd(5)} B=${String(s.slotB?.left).padEnd(5)} cluster=${s.clusterWidth}  A=idle:${s.aEqualsIdle} B=idle:${s.bEqualsIdle}`,
		);
}
console.log(`\n${out.verdict} (${out.failures.length} failure(s))`);
for (const f of out.failures) console.log(`  ${f}`);
process.exit(out.failures.length === 0 ? 0 : 1);
