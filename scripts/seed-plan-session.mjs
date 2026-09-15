#!/usr/bin/env node
/**
 * Seed a real backend session that has a To-dos plan, for the run-panel
 * evidence and for QA of the reveal.
 *
 *     node scripts/seed-plan-session.mjs <config-dir> [items] [roster] [--openable]
 *
 * `--openable` gives every roster job a `session_id` and writes that child's own
 * session directory, which is what makes a row a CONTROL rather than a member:
 * the reader's key is `(session_id, child_id)` and a job the wire leaves without
 * one is deliberately not openable (`childOpenable`, `run-detail-model.ts`). It
 * exists because the reveal's reader-first branch - press the chip WHILE a child
 * reader is open - is the one path the round-1 review could not reach: a plain
 * fixture has a plan and no openable rows, a warmed one loses its roster.
 *
 * Why a seeder rather than a real conversation, the same reasoning as
 * `scripts/seed-paging-session.mjs`: the run-details pane reads the plan off
 * the canonical frontend projection, the backend rebuilds that projection from
 * its own todo store, and the store is restored from the `todo_snapshot` custom
 * row in `transcript.jsonl` (`Session._load_todo_snapshot`). So the cheapest
 * honest fixture is that file. Everything on the path under test stays real:
 * the backend reads the transcript with its own reader, restores its own store,
 * publishes the projection over its own desktop route, the app's main-process
 * relay carries it, and the renderer's own reducer paints it. Only the
 * conversation's CONTENT is synthetic.
 *
 * The plan is long on purpose. The defect this fixture exists for is a
 * `scrollIntoView` ancestor walk in the pane's reveal, and a plan that fits
 * without scrolling gives the walk nothing to do: the section has to be tall
 * enough that the pane's own region is the only box that should move.
 *
 * Writes into an ISOLATED config dir, never the operator's real
 * `~/.local-operator`. The dir is the first argument and the script refuses to
 * run without one, and refuses the live dir outright.
 */

import { randomBytes } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CONFIG = process.argv[2];
const ITEMS = Number(process.argv[3] ?? 8);
const ROSTER = Number(process.argv[4] ?? 0);
/**
 * Whether each roster job gets a child session the reader can actually open.
 * See the usage note: without it the rows are members, not controls.
 */
const OPENABLE = process.argv.includes("--openable");

if (!CONFIG) {
	console.error("usage: seed-plan-session.mjs <config-dir> [items] [roster]");
	process.exit(1);
}
const root = resolve(CONFIG);
if (root === join(homedir(), ".local-operator")) {
	console.error("refusing to seed into the live config dir");
	process.exit(1);
}

const id = () => randomBytes(16).toString("hex");
const sessionId = randomBytes(6).toString("hex");
const dir = join(root, "sessions", sessionId);
mkdirSync(dir, { recursive: true });

const now = Date.now() / 1000;
const PLAN = [
	"Reproduce the reported view shift on the run pane",
	"Measure the document and app scroll offsets before and after the reveal",
	"Identify which ancestor of the To-dos section actually scrolls",
	"Replace the ancestor walk with a container-scoped scroll",
	"Re-measure every offset back to zero at three window sizes",
	"Drive the neighbouring surfaces: pane open and close, reader drill-in",
	"Run lint, typecheck, theme gates, desktop suite and a real build",
	"Open the pull request with the before and after frames",
];

const items = Array.from({ length: ITEMS }, (_, index) => ({
	text: PLAN[index % PLAN.length],
	status: index < 2 ? "done" : "pending",
	reason: "",
}));

const lines = [
	JSON.stringify({
		id: id(),
		ts: now - 600,
		type: "message",
		payload: {
			kind: "message",
			role: "user",
			content: [{ text: "Open the todos and check the view shift." }],
		},
	}),
	JSON.stringify({
		id: id(),
		ts: now - 540,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			content: [{ text: "Plan written. Working through it." }],
		},
	}),
	JSON.stringify({
		id: id(),
		ts: now - 520,
		type: "custom",
		payload: {
			custom_type: "todo_snapshot",
			details: { items: [{ name: "Todos", items }] },
		},
	}),
];

writeFileSync(join(dir, "transcript.jsonl"), `${lines.join("\n")}\n`);
writeFileSync(join(dir, "created_at.json"), JSON.stringify(now - 900));
/*
 * The desktop marker is what lets the pool open this session without replaying
 * a frontend checkpoint to recover a working directory.
 */
writeFileSync(
	join(dir, "desktop.json"),
	JSON.stringify({ cwd: process.env.HOME ?? homedir() }),
);
writeFileSync(
	join(dir, "title.json"),
	JSON.stringify({ title: "Plan fixture" }),
);

/*
 * The roster is opt-in because it changes WHAT IS ABOVE the plan: with settled
 * children in front of it the To-dos section starts below the pane's fold, so
 * the reveal has to scroll the pane's own region — the case where a
 * container-scoped scroll and an ancestor walk visibly differ. The shape is
 * `Session._persist_subagent_roster`'s sidecar, which is what a resumed session
 * reads its roster back from.
 */
if (ROSTER > 0) {
	/*
	 * Each job's child session, when the caller asked for openable rows: a real
	 * session directory with its own transcript, because the reader's read is a
	 * real route against the backend's own reader rather than a projection this
	 * script could fake.
	 */
	const childIds = Array.from({ length: ROSTER }, () =>
		OPENABLE ? randomBytes(6).toString("hex") : "",
	);
	if (OPENABLE) {
		for (const [index, childId] of childIds.entries()) {
			const childDir = join(root, "sessions", childId);
			mkdirSync(childDir, { recursive: true });
			const childLines = [
				JSON.stringify({
					id: id(),
					ts: now - 700 + index * 5,
					type: "message",
					payload: {
						kind: "message",
						role: "user",
						content: [{ text: `Child job ${index + 1}: check the reveal's target.` }],
					},
				}),
				JSON.stringify({
					id: id(),
					ts: now - 690 + index * 5,
					type: "message",
					payload: {
						kind: "message",
						role: "assistant",
						content: [{ text: "Read the section, measured the region." }],
					},
				}),
			];
			writeFileSync(
				join(childDir, "transcript.jsonl"),
				`${childLines.join("\n")}\n`,
			);
			writeFileSync(join(childDir, "created_at.json"), JSON.stringify(now - 800));
			writeFileSync(
				join(childDir, "desktop.json"),
				JSON.stringify({ cwd: process.env.HOME ?? homedir(), origin: "subagent" }),
			);
			writeFileSync(
				join(childDir, "title.json"),
				JSON.stringify({ title: `Child job ${index + 1}` }),
			);
		}
	}
	const LABELS = [
		"Check the reveal effect's scroll target",
		"Verify the pane's scroll region owner",
		"Measure the document geometry",
		"Re-read the composer chip wiring",
	];
	writeFileSync(
		join(dir, "subagent-roster.v1.json"),
		JSON.stringify({
			version: 1,
			generation: 1,
			jobs: Array.from({ length: ROSTER }, (_, index) => ({
				id: `job${String(index).padStart(13, "0")}`,
				session_id: childIds[index] || undefined,
				type: "task",
				status: "done",
				start_time: now - 800 + index * 20,
				started_at: now - 800 + index * 20,
				settled_at: now - 780 + index * 20,
				label: LABELS[index % LABELS.length],
				queued: false,
				agent_id: "reviewer",
				registrant_id: "main",
				model_label: "openrouter/openai/gpt-4o-mini",
				context_window: 128000,
				usage: null,
				descendant_usage: [],
				prior_attempt_usage: [],
				restored: true,
				result_text: "Settled.",
			})),
			records: [],
			accounting: [],
		}),
	);
}

console.log(
	JSON.stringify(
		{ sessionId, items: items.length, roster: ROSTER, openable: OPENABLE, dir },
		null,
		2,
	),
);
