/**
 * Fixture builders for the run-details stories and tests.
 *
 * These build WIRE shapes — `Array<Record<string, unknown>>` — rather than
 * `RunDetails`, so the stories exercise the same derivation the app will run and
 * not a hand-written view model that happens to look right. A fixture that
 * started from the derived shape would have made every story a picture of its own
 * input, and the omission and suppression rules would have had nothing to do.
 *
 * The whole set is covered by one test in `scripts/run-detail-model.test.mjs`
 * that derives all of it and asserts the coverage this file claims: every state
 * present, an unknown cost and context reported as absent, a default-role child
 * suppressed, a label long enough to truncate, both plans (flat and phased),
 * enough rows to trigger both overflow disclosures, and a phase all of whose rows
 * the cap sheds.
 */

import type { DesktopChildTranscriptPage } from "../../../../../../shared/desktop-session-contract";
import type { RunDetailsInput } from "./run-detail-model";

/** The instant every fixture is measured against, so frames are reproducible. */
export const FIXTURE_NOW_MS = Date.parse("2026-03-14T10:26:00Z");

/** Epoch SECONDS relative to the pinned instant — the unit `start_time` is in. */
const at = (secondsAgo: number): number => FIXTURE_NOW_MS / 1000 - secondsAgo;

type JobSpec = {
	id: string;
	label: string;
	status: string;
	/** `agent_role`. Omitted or `task` is the suppressed default. */
	role?: string;
	/** The capacity gate's flag: the status stays `running` on the wire. */
	queued?: boolean;
	startedSecondsAgo?: number;
	settledSecondsAgo?: number;
	/** `latest_details.progress` — the child's own activity line. */
	progress?: string;
	/** `error_text`, on a failure. */
	error?: string;
	/** `result_text`, on a normal settle — the reader's success outcome (`§ 5.1`). */
	result?: string;
	/** `session_id`, the reader's key. `null` is a job the runtime has not given one. */
	sessionId?: string | null;
	/** The child's own model, when it differs from the parent's. */
	model?: string;
	tokens?: number;
	window?: number;
	/** `direct_cost`. Absent means "nothing reported", which is not zero. */
	cost?: number;
};

/**
 * One `JobState`, on the wire.
 *
 * The field names are the real ones (`frontend_state.JobState`): `queued` beside
 * a `running` status, `latest_details` as a mapping carrying `progress`,
 * `start_time`/`settled_at` as epoch seconds. Two fields are deliberately NOT
 * here — `parent_job_id` and the child's own `todos` — because the panel is flat
 * and shows the session's plan (`docs/run-details.md` § 8), so a fixture that
 * carried them would invite a reader to think they mattered. A third is absent
 * for a harder reason: **there is no `paused` field on `JobState` at all**, so a
 * fixture that set one would assert a wire shape that does not exist. A paused
 * child is instead reproduced the way the wire produces one — as the WORD
 * `paused` on a restored row, which is what `foldStatus` folds and what the
 * model's own tests drive.
 */
const child = (spec: JobSpec): Record<string, unknown> => ({
	id: spec.id,
	type: "task",
	status: spec.status,
	queued: spec.queued ?? false,
	label: spec.label,
	agent: "core",
	agent_role: spec.role ?? "task",
	latest_details: spec.progress ? { progress: spec.progress } : null,
	error_text: spec.error ?? "",
	/*
	 * `result_text` is EMPTY unless a spec supplies one, and that default was a
	 * defect in the first cut of this fixture: `reader-settled` claimed an outcome
	 * block its own frame could not contain, because no story could set the field.
	 * A settled child's outcome is a state `§ 5.7` names, so the fixture has to be
	 * able to carry it.
	 */
	result_text: spec.result ?? "",
	session_id: spec.sessionId === undefined ? "a1b2c3d4e5f6" : spec.sessionId,
	model_label: spec.model ?? "claude-sonnet-4-5",
	context_window: spec.window ?? null,
	usage: spec.tokens === undefined ? null : { context_tokens: spec.tokens },
	direct_cost: spec.cost ?? null,
	// Epoch zero, not a plausible-looking default: a child that has not started
	// has no launch time at all, and the row omits the clock rather than
	// inventing one (`job_elapsed:414-417`).
	start_time:
		spec.startedSecondsAgo === undefined ? 0 : at(spec.startedSecondsAgo),
	settled_at:
		spec.settledSecondsAgo === undefined ? null : at(spec.settledSecondsAgo),
});

const item = (
	text: string,
	status: string,
	reason?: string,
): Record<string, unknown> => ({
	text,
	status,
	...(reason ? { reason } : {}),
});

const phase = (
	name: string,
	items: Array<Record<string, unknown>>,
): Record<string, unknown> => ({
	name,
	items,
});

/** A plan with phases of its own — the case that keeps its phase headers. */
const phased = (): Array<Record<string, unknown>> => [
	phase("Reconcile the March invoices", [
		item("Read invoices/march.csv", "done"),
		item("Group the unpaid rows by customer", "done"),
		item("Confirm what 'pending' means", "blocked", "two rows need a decision"),
		item("Write reports/unpaid-march.md", "pending"),
	]),
	phase("Publish the summary", [item("Revise the totals", "pending")]),
];

/**
 * A plan that arrived with no phases — the flat `init` case.
 *
 * The wire shape is the same; what makes it flat is that there is ONE phase and
 * it carries no name of its own, which is the condition `deriveRunDetails`
 * renders headerless (design § 6.3: the back-compat path).
 */
const flat = (): Array<Record<string, unknown>> => [
	phase("Todos", [
		item("Read the invoice export", "done"),
		item("Total the unpaid rows", "pending"),
		item("Write the report", "pending"),
	]),
];

/**
 * A long plan: fifteen items over three phases, eleven of them closed.
 *
 * Fifteen against a cap of ten, with four open items, leaves exactly five rows
 * to disclose — and those five are the OLDEST closed rows (`§6.3`), which is what
 * makes this fixture the one that pins the shed direction. That direction is only
 * legible if a phase can lose everything: `Reconcile` is the earliest phase and
 * is now ENTIRELY closed, so all five of its rows fall off the front and it is
 * photographed as the state `§6.3` names but no earlier fixture reached — a phase
 * header with its own `+5 more` and no rows under it. While any of its rows was
 * open, the cap kept one of them (`open rows are never shed`) and every
 * photographed phase still had a row.
 *
 * The extra pending row in `Publish` is what keeps the count honest: the plan is
 * one row longer than the fourteen-item one it replaced so the shed budget
 * reaches all five of `Reconcile`'s rows rather than four of them, and it keeps
 * the four open items the other states are measured against.
 */
const longPlan = (): Array<Record<string, unknown>> => [
	phase("Reconcile", [
		item("Read invoices/march.csv", "done"),
		item("Read invoices/april.csv", "done"),
		item("Normalise the customer names", "done"),
		item("Group the unpaid rows by customer", "done"),
		item("Compare against ledger/q1.csv", "done"),
	]),
	phase("Verify", [
		item("Spot-check ten rows by hand", "done"),
		item(
			"Confirm 'pending' means invoiced",
			"blocked",
			"waiting on the ledger",
		),
		item("Exclude pending from the totals", "done"),
		item("Re-run the totals", "done"),
		item("Diff the report against yesterday's", "dropped"),
	]),
	phase("Publish", [
		item("Write reports/unpaid-march.md", "done"),
		item("Write the covering note", "done"),
		item("Attach the report to the reply", "pending"),
		item("Send the summary", "pending"),
		item("File the reconciliation notes", "pending"),
	]),
];

/**
 * Both sections, in flight: two children at work, one of them under a label long
 * enough that a 384px row has to truncate it, plus a phased plan with a blocked
 * item and an open one — four open to-dos, the count the copy deck's own example
 * uses.
 */
export const bothInFlight = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-reconcile",
			label: "Audit the March invoices against the ledger export",
			role: "reviewer",
			status: "running",
			startedSecondsAgo: 72,
			progress: "Running pytest tests/unit/server -q",
			tokens: 92_000,
			window: 200_000,
			cost: 0.31,
		}),
		child({
			id: "job-summarise",
			label: "Summarise the findings",
			role: "writer",
			status: "running",
			startedSecondsAgo: 18,
			progress: "Drafting the summary",
			tokens: 12_400,
			window: 200_000,
			cost: 0.02,
		}),
	],
	todos: phased(),
});

/** One section: three children, no plan at all. */
export const subagentsOnly = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-probe",
			label: "Probe the staging API",
			role: "researcher",
			status: "running",
			startedSecondsAgo: 214,
			progress: "GET /v1/health",
			tokens: 41_800,
			window: 200_000,
			cost: 0.19,
		}),
		// A child the capacity gate has admitted but not started: its status is
		// still `running` on the wire and only the flag says otherwise.
		// Queued before launch, so it has reported nothing at all: no clock, no
		// context, no cost. The omission rule has to hold for every figure.
		child({
			id: "job-gated",
			label: "Draft the migration plan",
			status: "running",
			queued: true,
		}),
		child({
			id: "job-readme",
			label: "Refresh the README",
			// The default role, suppressed: every child with no role of its own is
			// called `task`, so printing it spends the row's scarcest column saying
			// nothing.
			role: "task",
			status: "done",
			startedSecondsAgo: 900,
			settledSecondsAgo: 840,
			tokens: 88_000,
			window: 200_000,
			cost: 0.44,
		}),
	],
	todos: [],
});

/**
 * One section: the plan alone, and long enough to overflow it.
 *
 * The same fifteen-item plan the crowded state carries, with no children at all —
 * so this is the frame in which the item cap, its `+5 more` and the all-shed phase
 * are actually visible. In the crowded state the to-do section starts below a
 * six-row roster and the panel's own 480px ceiling puts the disclosure past the
 * fold, which is a real property of that state rather than something a taller
 * viewport fixes: the section's position in the panel is the design's.
 */
export const todosOnly = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [],
	todos: longPlan(),
});

/**
 * The swap pair's own subject — deliberately NOT `bothInFlight()`.
 *
 * The pair's claim is about the SLOT: the canvas in it, then the run pane in it
 * (`swap-canvas-open` -> `swap-run-open`). Both frames used to be rendered from
 * `bothInFlight()`, which made `swap-run-open` byte-identical to
 * `both-in-flight`. Those two exist to prove different things — the two sections
 * coexisting, versus which pane owns the slot — and a frame that is a
 * byte-for-byte copy of another proves nothing about the state it is named for
 * (design review round 2, D2-3). One child and one open item is all the slot
 * claim needs; the both-sections frame keeps its own subject.
 */
export const swapSlot = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-slot",
			label: "Re-check the pending rows against the ledger",
			role: "reviewer",
			status: "running",
			startedSecondsAgo: 96,
			progress: "Running pytest tests/unit/server -q",
			tokens: 23_100,
			window: 200_000,
			cost: 0.08,
		}),
	],
	todos: [
		phase("Reconcile", [
			item("Compare the March export with ledger/q1.csv", "running"),
			item("List every row where the two disagree", "pending"),
		]),
	],
});

/**
 * ONE section, and the plan that arrived with no phases of its own.
 *
 * The `todos-only` half of `§ 11.3`'s `roster-only / todos-only` row is "one
 * section, no empty heading", so this fixture pairs the flat `init` shape
 * (`flat`) with an empty roster: the plan renders headerless with no section
 * heading above it.
 *
 * It exists because `todos-only` and `todos-phased` were BYTE-IDENTICAL frames —
 * both stories rendered `todosOnly()` — which made two of the set's rows describe
 * the same picture and left the flat/no-heading claim unframed. `todos-phased`
 * keeps the phased plan; this is the other half.
 */
export const todosFlat = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [],
	todos: flat(),
});

/**
 * A failure, a flat plan, and nothing else.
 *
 * The flat case is carried here rather than in a story of its own because it is
 * the same section rendering a simpler input: one implicit phase, no header, and
 * the item list where a header would have been.
 */
export const failure = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-ledger",
			label: "Re-check the pending rows against the ledger",
			role: "analyst",
			status: "failed",
			startedSecondsAgo: 96,
			settledSecondsAgo: 88,
			tokens: 23_100,
			window: 200_000,
			cost: 0.08,
			error:
				"FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'\n  raised while reading the ledger export",
		}),
		child({
			id: "job-totals",
			label: "Total the unpaid rows",
			status: "done",
			startedSecondsAgo: 400,
			settledSecondsAgo: 372,
			tokens: 61_000,
			window: 200_000,
			cost: 0.27,
		}),
	],
	todos: flat(),
});

/**
 * Nine children over a 15-item plan: both overflow disclosures at once.
 *
 * **The array's order is deliberately NOT chronological, and this is the fixture
 * that pins the slice's tie-break.** Every other fixture here is listed
 * oldest-first, which agrees with a slice that reads the array index as a clock
 * and so could never catch one: live QA measured a real nine-child roster in an
 * order with no time meaning in either direction (`Hold, Canvas failure, Role,
 * Slow, File inventory, Arithmetic, Broken tier, Quiet window, Clock`), because
 * `frontend.jobs` is whatever the comms graph and the execution ledgers hand
 * back. This fixture is shuffled so index order and clock order disagree — the
 * newest settled child (`job-e`) sits at index 5 and the oldest (`job-i`) at
 * index 3, while among the running children the newest (`job-c`) is at index 2
 * and the oldest (`job-a`) at index 4. A slice that ties by index therefore
 * keeps a DIFFERENT six rows from one that ties by `settled_at`/`start_time`,
 * which is what `scripts/run-detail-model.test.mjs` asserts and what
 * `crowded`'s frame shows.
 */
export const crowded = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-d",
			label: "Compare against ledger/q1.csv",
			role: "analyst",
			status: "failed",
			startedSecondsAgo: 300,
			settledSecondsAgo: 290,
			tokens: 18_000,
			window: 200_000,
			cost: 0.05,
			error: "FileNotFoundError: ledger/q1.csv is not in this workspace",
		}),
		child({
			id: "job-g",
			label: "Spot-check ten rows",
			role: "verifier",
			status: "done",
			startedSecondsAgo: 900,
			settledSecondsAgo: 860,
			tokens: 70_000,
			window: 200_000,
			cost: 0.36,
		}),
		child({
			id: "job-c",
			label: "Normalise the customer names",
			status: "running",
			queued: true,
			startedSecondsAgo: 9,
		}),
		child({
			id: "job-i",
			label: "Refresh the README",
			status: "done",
			startedSecondsAgo: 2_400,
			settledSecondsAgo: 2_340,
			tokens: 66_000,
			window: 200_000,
			cost: 0.29,
		}),
		child({
			id: "job-a",
			label: "Read invoices/march.csv",
			status: "running",
			startedSecondsAgo: 150,
			progress: "reading rows 1-412",
			tokens: 30_000,
			window: 200_000,
			cost: 0.11,
		}),
		// The newest settled child in this fixture, which is why it is the row
		// that shows in the frame. A LIVE pause is implemented as a cancel on the
		// wire and this row carries no flag saying otherwise — `JobState` has no
		// pause field to read — so a child the user paused in this session arrives
		// at this popover as a plain `cancelled` one. The `paused` state is
		// reachable all the same, from the durable graph after a restart
		// (`foldStatus`), which is why it has a mark and a rank of its own.
		child({
			id: "job-e",
			label: "Draft the migration plan",
			status: "cancelled",
			startedSecondsAgo: 600,
			settledSecondsAgo: 420,
			tokens: 12_000,
			window: 200_000,
			cost: 0.03,
		}),
		child({
			id: "job-b",
			label: "Read invoices/april.csv",
			role: "reader",
			status: "running",
			startedSecondsAgo: 140,
			progress: "reading rows 1-980",
			tokens: 44_000,
			window: 200_000,
			cost: 0.14,
		}),
		child({
			id: "job-h",
			label: "Write reports/unpaid-march.md",
			status: "done",
			startedSecondsAgo: 1_200,
			settledSecondsAgo: 1_150,
			tokens: 80_000,
			window: 200_000,
			cost: 0.41,
		}),
		child({
			id: "job-f",
			label: "Summarise the findings",
			status: "interrupted",
			startedSecondsAgo: 3_600,
			settledSecondsAgo: 3_100,
			tokens: 51_000,
			window: 200_000,
			cost: 0.22,
		}),
	],
	todos: longPlan(),
});

/**
 * Everything settled, and nothing unseen.
 *
 * This is the state in which the trigger does not exist at all (§ 3.3: settled
 * work alone does not raise it), so the story that uses it renders the header
 * with no run-details button rather than an empty panel.
 */
export const settled = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-1",
			label: "Read invoices/march.csv",
			status: "done",
			startedSecondsAgo: 2_400,
			settledSecondsAgo: 2_390,
			tokens: 30_000,
			window: 200_000,
			cost: 0.11,
		}),
		child({
			id: "job-2",
			label: "Total the unpaid rows",
			role: "analyst",
			status: "done",
			startedSecondsAgo: 2_360,
			settledSecondsAgo: 2_300,
			tokens: 48_000,
			window: 200_000,
			cost: 0.18,
		}),
		child({
			id: "job-3",
			label: "Diff against yesterday's report",
			status: "cancelled",
			startedSecondsAgo: 2_200,
			settledSecondsAgo: 2_150,
			tokens: 9_000,
			window: 200_000,
			cost: 0.02,
		}),
	],
	todos: [
		phase("Todos", [
			item("Read the invoice export", "done"),
			item("Total the unpaid rows", "done"),
			item("Diff against yesterday's report", "dropped"),
		]),
	],
});

/**
 * The unseen failure, and nothing else: every child settled, every to-do closed.
 *
 * This is the whole of `§3.3`'s failure clause and the reason the frame exists.
 * `hasRunDetails` is true here ONLY because a child failed and nobody has opened
 * the panel since, so this is the state where opening the panel acknowledges the
 * failure in the same commit that shows it — the one state the `danger` dot
 * announces, and the one that used to unmount the panel before it could be read.
 *
 * It is a REGRESSION frame, not decoration: re-run it against a trigger that
 * gates only on `hasRunDetails` and the panel is gone (and the capture rig's
 * shutter, which waits for `[data-run-details-panel]`, waits forever).
 *
 * The failure carries the full exception line on purpose: it is the string D4's
 * `line-clamp-2` exists for, and the identifier is the part that has to survive.
 */
export const failureUnseen = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-ledger",
			label: "Re-check the pending rows against the ledger",
			role: "analyst",
			status: "failed",
			startedSecondsAgo: 96,
			settledSecondsAgo: 88,
			tokens: 23_100,
			window: 200_000,
			cost: 0.08,
			error:
				"FileNotFoundError: [Errno 2] No such file or directory: 'ledger/q1.csv'",
		}),
		child({
			id: "job-totals",
			label: "Total the unpaid rows",
			status: "done",
			startedSecondsAgo: 400,
			settledSecondsAgo: 372,
			tokens: 61_000,
			window: 200_000,
			cost: 0.27,
		}),
	],
	// Every item closed, so the plan contributes no open work at all: the failure
	// is the only fact keeping the trigger on screen.
	todos: [
		phase("Todos", [
			item("Read the invoice export", "done"),
			item("Total the unpaid rows", "done"),
			item("Diff against yesterday's report", "dropped"),
		]),
	],
});

/** The header's own story: work in flight, the panel closed. */
export const headerTrigger = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-probe",
			label: "Probe the staging API",
			role: "researcher",
			status: "running",
			startedSecondsAgo: 214,
			progress: "GET /v1/health",
			tokens: 41_800,
			window: 200_000,
			cost: 0.19,
		}),
		child({
			id: "job-gated",
			label: "Draft the migration plan",
			status: "running",
			queued: true,
			startedSecondsAgo: 4,
		}),
	],
	todos: flat(),
});

/** The dot: a child failed and the panel has not been opened since. */
export const headerTriggerFailed = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-ledger",
			label: "Re-check the pending rows against the ledger",
			status: "failed",
			startedSecondsAgo: 96,
			settledSecondsAgo: 88,
			tokens: 23_100,
			window: 200_000,
			cost: 0.08,
			error: "FileNotFoundError: 'ledger/q1.csv'",
		}),
		child({
			id: "job-totals",
			label: "Total the unpaid rows",
			status: "done",
			startedSecondsAgo: 400,
			settledSecondsAgo: 372,
			tokens: 61_000,
			window: 200_000,
			cost: 0.27,
		}),
	],
	todos: [],
});

/**
 * The three states a LIVE session cannot produce: a restored pause, a row the
 * durable graph swept without an outcome, and a word from a runtime this
 * renderer has not been taught.
 *
 * `§ 6.4` gives all nine states a mark, and the set's other fixtures carry six
 * of them — so until this one existed, three of the nine were glyphs and inks
 * that no frame had ever shown, and one of the three (`paused`) is also the
 * state that decides whether the trigger exists at all: a restored pause is OPEN
 * work (`§ 3.3`), so this roster raises the button on a state whose mark nobody
 * had looked at.
 *
 * Every row is produced the way the WIRE produces one, which is why none of them
 * carries a clock: the durable graph's rows (`frontend_state._jobs`, one per
 * `SubagentNode`) carry `id`, `label`, `status`, `prompt`, `agent_role`, `effort`
 * and the terminal texts — no `start_time` and no `settled_at` (`§ 8`) — so a
 * restored child renders with the elapsed segment omitted rather than zeroed.
 * The paused row is the graph's own status WORD on the row
 * (`status=getattr(node, "status", "gone")`), not a `paused` field: `JobState`
 * has no such field (see `child` above), and `foldStatus` is what folds the word.
 *
 * The third row's word is deliberately one no runtime defines — `reticulating`,
 * the same word `scripts/run-detail-model.test.mjs` drives — because the claim is
 * about a word this renderer has NOT been taught; a real status here would
 * photograph the branch this one exists to distinguish from it.
 */
export const restoredAndUnrecognised = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-parked",
			label: "Confirm the ledger's opening balance",
			role: "analyst",
			status: "paused",
			tokens: 44_200,
			window: 200_000,
			cost: 0.22,
		}),
		child({
			id: "job-swept",
			label: "Reconcile the April export",
			status: "gone",
			tokens: 12_800,
			window: 200_000,
			cost: 0.06,
		}),
		child({
			id: "job-unrecognised",
			label: "Cross-check the totals again",
			status: "reticulating",
			tokens: 9_400,
			window: 200_000,
			cost: 0.03,
		}),
	],
	// No plan at all: the three marks are the subject, and a to-do section would
	// push the third row toward the panel's floor.
	todos: [],
});

/* ------------------------------------------------------------------ */
/* The pane's own states                                               */
/* ------------------------------------------------------------------ */

/**
 * A canonical session with nothing at all in flight.
 *
 * The state the OLD design could not photograph, because its trigger did not
 * exist in it: the button was gated on `hasRunDetails`, so a session with no
 * children, no plan and no failure had no button and therefore no panel. `§ 3.3`
 * inverts that — the trigger is a data gate (`details !== null`), not a work gate
 * — so `trigger-idle` photographs the icon that is on screen with nothing to
 * report, and `panel-empty` photographs what it opens onto.
 */
export const idle = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [],
	todos: [],
});

/**
 * Every child settled and the plan closed: `hasRunDetails` is false, so the
 * panel's quiet state says "nothing in flight" over a roster of history.
 *
 * Distinct from `idle` in the one way that matters to the panel's copy: there IS
 * a run here and it is finished, where `idle` has no run at all.
 */
export const settledHistory = settled;

/**
 * The plan that produced § 6.1's finding (2) AND round 1's U1-5: an implicit
 * phase beside a named one, in the order an unphased `add` produces after a
 * phase was already named.
 *
 * The backend lazily creates `Todos` when `add` is called before any phase was
 * named, and the wire cannot distinguish that from a phase an agent genuinely
 * named `Todos` — so a plan holding both rendered a `To-dos` section directly
 * above a phase headed `Todos`, one plan named twice. The fold is per PHASE now,
 * and this is the fixture the frame exists for.
 *
 * The NAMED phase comes FIRST and the untitled group second, deliberately: that
 * is the shape the fold got wrong, because it assumed the untitled group leads.
 * Its rows landed at the named phase's indent under that phase's header, with
 * nothing between them and the phase above (round 1, Q9/U1-5, measured live at
 * 420px and at the 320px floor), and the per-phase counts this change removed
 * were the only other signal. The LEADING fold is `todosFlat()`'s single
 * unnamed phase, and its frame is `todos-only`.
 */
export const mixedImplicitPhase = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [],
	todos: [
		phase("Publish", [
			item("Write reports/unpaid-march.md", "done"),
			item("Send the summary", "blocked", "waiting on the totals"),
		]),
		phase("Todos", [
			item("Read invoices/march.csv", "done"),
			item("Total the unpaid rows", "pending"),
		]),
	],
});

/** A brief long enough to fold: the reader's expander and its hidden count. */
const LONG_BRIEF = [
	"You are the reviewer for the March reconciliation.",
	"",
	"Read invoices/march.csv and group the unpaid rows by customer.",
	"Treat anything not marked paid as outstanding, and say so explicitly",
	"rather than inferring it. Then check the totals against ledger/q1.csv",
	"and report every row where the two disagree, with both numbers.",
	"",
	"Do not write the report yourself; hand the findings back.",
].join("\n");

/**
 * One TOOL job, in the shape `frontend.jobs` really carries one.
 *
 * `comms.job_rows()` snapshots the ROOT session's job manager AND every live
 * child's (`harness/comms.py:799-815`), so the list a session publishes holds
 * the children's own tool calls beside the children themselves. Every one of
 * those rows is typed `bash`, NOT named after the tool that ran: `JobType` is
 * exactly `Literal["bash", "task"]` (`harness/jobs.py:216`), a background `eval`
 * registers as `bash` on purpose (`tools/eval.py:938-945`), and a foreground
 * `read` never gets a row at all. The label carries the distinction
 * (`bash: <command>`, `tools/builtin.py:2187`).
 *
 * So `type` is an argument with a default rather than something derived from the
 * label: a helper that read the prefix would let a fixture claim a `read` row the
 * runtime cannot mint, which is what round 3's R3-1 found (it did exactly that).
 *
 * QA's live capture read `c1ccfe6839cb bash running "bash: sleep 150 ; echo
 * child-done"` beside the one real delegated child and the roster painted both
 * (round 1, Q1/U1-4). This is that row, in that shape.
 */
const toolJob = (spec: {
	id: string;
	label: string;
	/** `JobType` — `bash` for every tool row; `task` would be a child. */
	type?: "bash" | "task";
	status?: string;
	/** `start_time` in epoch seconds, for a row that is still running. */
	startedSecondsAgo?: number;
}): Record<string, unknown> => ({
	id: spec.id,
	type: spec.type ?? "bash",
	status: spec.status ?? "running",
	queued: false,
	label: spec.label,
	agent: "core",
	agent_role: null,
	latest_details: null,
	error_text: "",
	result_text: "",
	session_id: null,
	model_label: null,
	context_window: null,
	usage: null,
	direct_cost: null,
	start_time:
		spec.startedSecondsAgo === undefined ? 0 : at(spec.startedSecondsAgo),
	settled_at: null,
});

/**
 * The wire that produces the roster's membership question (`§ 4`).
 *
 * Five rows, four of which are NOT top-level children: two `bash` tool jobs (the
 * root session's own, and the running child's own), and one nested `task` row
 * (`parent_job_id: "job-audit"`) that the child launched itself. The
 * roster must paint exactly the two members — `job-audit` and `job-summarise` —
 * and count only those.
 *
 * The shapes are the live ones: the tool rows came off the wire in QA's capture,
 * and the nested row is the shape `frontend_state._with_lineage` mints for a
 * launch from inside a child (`comms.job_rows()` resolves the parent through the
 * shared graph).
 */
export const rosterMembers = (): RunDetailsInput => ({
	nowMs: FIXTURE_NOW_MS,
	jobs: [
		child({
			id: "job-audit",
			label: "Audit the March invoices against the ledger export",
			role: "reviewer",
			status: "running",
			startedSecondsAgo: 150,
			progress: "bash: sleep 150 ; echo child-done",
			model: "claude-sonnet-4-5",
			tokens: 92_000,
			window: 200_000,
			cost: 0.31,
		}),
		// The running child's OWN tool call, and the row the roster used to paint as
		// a peer sub-agent — sorted above the child it belongs to.
		toolJob({
			id: "c1ccfe6839cb",
			label: "bash: sleep 150 ; echo child-done",
			startedSecondsAgo: 131,
		}),
		child({
			id: "job-summarise",
			label: "Summarise the findings",
			role: "writer",
			status: "running",
			startedSecondsAgo: 18,
			progress: "Drafting the summary",
			tokens: 12_400,
			window: 200_000,
			cost: 0.02,
		}),
		// A GRANDCHILD: launched from inside `job-audit`, so its parent is a job row
		// that IS on the wire. It belongs to the child's own `1 child` control rather
		// than to the top level (`§ 4`, `§ 5.5`).
		{
			...child({
				id: "job-verify",
				label: "Verify the totals",
				role: "task",
				status: "done",
				startedSecondsAgo: 120,
				settledSecondsAgo: 40,
				sessionId: "bb11cc22dd33",
			}),
			parent_job_id: "job-audit",
		},
		// The ROOT session's own tool job, which is on the same list and is no more a
		// sub-agent than the child's bash call is. Typed `bash` like every tool row:
		// the runtime has no other word for one (`harness/jobs.py:216`), and a
		// fixture that named the tool here would be describing a wire that does not
		// exist (round 3, R3-1).
		toolJob({
			id: "7a41d0e2f9c3",
			label: "bash: wc -l invoices/march.csv",
			status: "succeeded",
			startedSecondsAgo: 240,
		}),
	],
	todos: [],
});

/**
 * One child with a durable launch turn, a brief long enough to fold, and a name
 * taken from the launch map.
 *
 * `launch_prompts` carries the CONCISE authored prompt against the launch
 * turn's entry id, so the reader can replace the durable row — which holds the
 * full role/team/system preamble — instead of opening on a wall of wrapper text
 * (`§ 5.1`). `launch_message_id` is the launch turn in the REAL transcript file
 * the reader fetches; a story's fixture page carries that id.
 */
export const readerChild = (
	over: Partial<JobSpec> = {},
): Record<string, unknown> => ({
	/*
	 * `session_id` comes from `child()` and can be overridden to `null` through
	 * `over.sessionId` — the row the wire leaves unaddressable, which the roster
	 * must not offer to open and the reader must not sit on `Loading…` for.
	 */
	...child({
		id: "job-reader",
		label: "Re-check the pending rows against the ledger",
		role: "reviewer",
		status: "running",
		startedSecondsAgo: 96,
		progress: "Running pytest tests/unit/server -q",
		tokens: 23_100,
		window: 200_000,
		cost: 0.08,
		...over,
	}),
	prompt: LONG_BRIEF,
	launch_message_id: "subagent-launch:job-reader",
	launch_prompts: {
		"subagent-launch:job-reader":
			"Re-check the pending rows against the ledger.",
	},
});

/** One durable transcript entry, in the wire's own shape. */
const entry = (
	id: string,
	ts: number,
	role: "user" | "assistant" | "tool",
	text: string,
	extra: Record<string, unknown> = {},
): DesktopChildTranscriptPage["entries"][number] => ({
	id,
	ts: FIXTURE_NOW_MS / 1000 - ts,
	type: "message",
	payload: {
		kind: "message",
		role,
		id,
		content: text ? [{ type: "text", text }] : [],
		tool_calls: [],
		...extra,
	},
});

/**
 * A child's transcript page, as the reader's route answers one (`§ 10.1`).
 *
 * The story set needs these because a fixture cannot prove the PULSE, but it can
 * and must prove every rendering of a page: the reader's own loader is exercised
 * against a real backend in the live frame, and the STATES are photographed from
 * here so they are reproducible without one.
 */
export const childPage = ({
	state = "ready",
	launchTurn = false,
	includeTool = false,
	includeImage = false,
}: {
	state?: "ready" | "pending" | "gone";
	launchTurn?: boolean;
	includeTool?: boolean;
	includeImage?: boolean;
} = {}): DesktopChildTranscriptPage => ({
	state,
	has_more: false,
	cursor_missing: false,
	entries: [
		...(launchTurn
			? [
					entry(
						"subagent-launch:job-reader",
						400,
						"user",
						"ROLE: reviewer\nTEAM: core\nSYSTEM: You are a subagent of the Local Operator harness…\n\nRe-check the pending rows against the ledger.",
					),
				]
			: []),
		entry("c-u1", 380, "user", "Continue the reconciliation."),
		entry(
			"c-a1",
			360,
			"assistant",
			"The March export has four rows whose status is not `paid`. I am checking them against the ledger before I total anything.",
		),
		...(includeTool
			? [
					entry("c-a2", 340, "assistant", "", {
						tool_calls: [
							{
								id: "c-tool-1",
								name: "bash",
								arguments: { command: "wc -l invoices/march.csv" },
							},
						],
					}),
					entry("c-tool-1", 330, "tool", "412 invoices/march.csv", {
						tool_name: "bash",
						tool_call_id: "c-tool-1",
					}),
				]
			: []),
		...(includeImage
			? [
					entry("c-u2", 320, "user", "", {
						/*
						 * An IMAGE CONTENT BLOCK, which is where a message keeps its
						 * pictures — not a top-level `images` key. The encoder dumps with
						 * `exclude_defaults=True`, so `type` is absent on durable rows
						 * and the reducer identifies an image by the `attachment` key
						 * (`isImageBlock`, `transcript-reducer.ts:305-318`). The first
						 * cut of this block had both of those wrong (a `kind`/`digest`
						 * object on an `images` key), which renders as a text-less user
						 * row with NO image at all — unnoticed because no story used the
						 * fixture until `reader-image` did.
						 *
						 * The digest is what the row carries and the bytes come back over
						 * the media relay, scoped to THIS child (`subagents.attachment`,
						 * `§ 10.3`): the reader hands `CanonicalTranscript` an attachment
						 * scope naming the child, so this row resolves through the
						 * child-scoped route rather than the parent's, which refuses it
						 * because a child session is not a user session.
						 */
						content: [
							{
								attachment: "0f1e2d3c4b5a69788796a5b4c3d2e1f0",
								mime_type: "image/png",
							},
						],
					}),
				]
			: []),
		entry(
			"c-a3",
			300,
			"assistant",
			"Three of the four match the ledger. The fourth has no counterpart, so I cannot confirm it from this export alone.",
		),
	],
});

/**
 * One row of an `mcp.list` payload, in the WIRE's own field names.
 *
 * `owned_scope` and `tool_count` rather than the model's `scope`/`toolCount`: the
 * fixtures are payloads and the model folds them, which is what keeps the story
 * set honest about the one part of this section that has a wire contract (`§ 10`).
 */
type McpWireRow = Record<string, unknown>;

/** The MCP server sets `§ 11.3` asks for, in the wire's own field names. */
export const mcpAllConnected = (): McpWireRow[] => [
	{ name: "files", status: "connected", tool_count: 12, owned_scope: "global" },
	{
		name: "notion",
		status: "connected",
		tool_count: 24,
		owned_scope: "project",
	},
	{ name: "linear", status: "connected", tool_count: 7, source: "~/mcp.json" },
];

export const mcpAuthRequired = (): McpWireRow[] => [
	{ name: "files", status: "connected", tool_count: 12, owned_scope: "global" },
	{ name: "notion", status: "auth-required", owned_scope: "project" },
];

export const mcpDisconnected = (): McpWireRow[] => [
	{ name: "files", status: "connected", tool_count: 12, owned_scope: "global" },
	{ name: "playwright", status: "disconnected", source: "~/.claude.json" },
];

/** A word this build has never been taught, beside one it has. */
export const mcpUnknownStatus = (): McpWireRow[] => [
	{ name: "files", status: "connected", tool_count: 12, owned_scope: "global" },
	{ name: "homeassistant", status: "reticulating", owned_scope: "global" },
];

/** The cold facade's payload: `cold` on every row, no runtime attached. */
export const mcpCold = (): McpWireRow[] => [
	{ name: "files", status: "cold", owned_scope: "global" },
	{ name: "notion", status: "cold", owned_scope: "project" },
];

/** One server coming up, which is not a problem and must not light the dot. */
export const mcpConnecting = (): McpWireRow[] => [
	{ name: "files", status: "connected", tool_count: 12, owned_scope: "global" },
	{ name: "notion", status: "connecting", owned_scope: "project" },
];
