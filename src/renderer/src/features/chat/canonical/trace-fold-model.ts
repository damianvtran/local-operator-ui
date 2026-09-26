/**
 * The aggregation tier's arithmetic, as a pure model (§E2, amendment A3).
 *
 * A turn of forty tool calls is forty lines today, and the reader's question at
 * the top of such a turn is "what did it do", not "what was call thirty-one". So
 * a run of three or more consecutive actions inside one turn FOLDS into one
 * summary line whose copy is generated from the counts by class.
 *
 * Everything with a right answer lives here rather than in the component: which
 * rows fold, what the summary says, and what a turn's foot line reports are all
 * questions a test can ask without rendering anything (`scripts/trace-fold-model.test.mjs`).
 * The component's half is the disclosure and the frames.
 *
 * ## What the CONDENSED header carries, and why it lives here too
 *
 * A collapsed group has to answer two questions on its own, because the rows
 * that would answer them are unmounted: what the run has DONE (the summary —
 * the counts by class, or `foldCounts` when no sentence can phrase it) and what
 * it is doing RIGHT NOW (`foldLive`: the in-flight call's own label, which is
 * the operator's sharpest point — a collapsed group that hides the live command
 * is worse than no group at all). It also carries the run's wall-clock span
 * (`foldSpan`: first start to last completion, never a sum of the rows'
 * durations, which is what read `0s` beside a run of fast calls). All three are
 * arithmetic over the row list, so all three are here and tested here.
 *
 * ## What a fold is NOT
 *
 * It is a VIEW, never a reorder. Folding hides rows; it does not group them into
 * a new parent that could claim a different position in the transcript. That is
 * branding §7's placement rule, and the transcript already has a guard for the
 * ordering half of it (`applyLiveSeed`/`withTimeOrder`) which a reordering fold
 * would quietly defeat. `foldRuns` therefore returns the rows in the order it
 * received them, always - the fold's own id is derived from its first row, so a
 * fold can never sort ahead of the action it starts with.
 *
 * ## Why the counts are by CLASS and not by tool
 *
 * `Ran pnpm vitest run` and `Ran pnpm vitest run --coverage` are one activity to
 * a reader, and so are four different `read` calls. The classes below are the
 * ones §E2 names, and anything the app does not classify falls into the count
 * that makes no claim: "N actions".
 */

import { displayName, toolRowLabel } from "../components/trace/tool-row-model";
import type { Row } from "./transcript-rows";

/** §E2: a run of three or more consecutive actions folds. */
export const FOLD_MIN_ACTIONS = 3;

export type FoldableAction = {
	/** The ledger's own name for the call (`ledgerName`), already case-folded. */
	name: string;
	failed: boolean;
	/** Seconds, when the row carries one. */
	durationS?: number | null;
	/**
	 * The row's own object text — the words its row prints beside the verb
	 * (`summaryFromArgs`, or the composing/queued status). The fold's live clause
	 * names a running call with them, and they come through an option rather than
	 * from `name` so the fold shows the row's words rather than a second guess at
	 * them.
	 */
	summary?: string;
	/**
	 * The row's own running predicate: `phase !== "done"`.
	 *
	 * The row's word, so the fold cannot disagree with the row about whether a
	 * call is finished: it blocks the condense (a fold must not hide a live call)
	 * and it is what makes the span's end "now".
	 */
	running?: boolean;
	/**
	 * Ms epoch when the call began EXECUTING (`startedAt`), which the live layer
	 * clears once the call settles.
	 */
	startedAtMs?: number | null;
	/**
	 * Ms epoch when the call completed (`endedAt`), which the live layer stamps
	 * only from its own end frame.
	 */
	endedAtMs?: number | null;
};

export type FoldGroup =
	| { kind: "row"; row: Row }
	| {
			kind: "run";
			/**
			 * Stable identity for the fold, derived from its FIRST row: the fold's
			 * place in the transcript is that row's place, so it cannot move when the
			 * run grows.
			 */
			id: string;
			/**
			 * The gap tier of the run's FIRST row, which is the fold's own margin:
			 * when the run opens a turn this is the turn's 32px, and the first row
			 * inside the fold is drawn at the trace tier instead of carrying it.
			 */
			gap: Row["gap"];
			rows: Row[];
			actions: FoldableAction[];
			summary: string;
			failedCount: number;
			/** The wall-clock span, when the run can date itself (see `foldSpan`). */
			span: FoldSpan | null;
			/** The in-flight call, when one is inside this run (see `foldLive`). */
			live: FoldLive | null;
	  };

/**
 * The run's wall-clock span: FIRST start to LAST completion.
 *
 * The operator's definition, and the right one: a sum of measured call durations
 * ignores the gaps between calls and reads `0s` for a run of fast ones, while
 * the span is what "how long was spent in this section" means. `endedAtMs` is
 * null while the run is still in flight — the caller computes the end against
 * its own clock then — and `running` says which of the two the caller is
 * looking at. Emitted ONLY when the run can date itself: no stamps, no span, and
 * the header renders nothing rather than a made-up `0s`.
 */
export type FoldSpan = {
	/** Earliest known execution start across the run, ms epoch. */
	startedAtMs: number;
	/** Latest known completion, ms epoch; null until one action has completed. */
	endedAtMs: number | null;
	/** Some call in the run has not settled: the span runs to `now`. */
	running: boolean;
};

/**
 * The call the condensed header names while its run is in flight.
 *
 * The same two columns `ToolRow` paints (`toolRowLabel`), lifted so a collapsed
 * group still answers "what is it doing right now?" — the operator's sharpest
 * point, because the answer is usually a long-blocking command (`wait`) that a
 * bare count hides entirely.
 */
export type FoldLive = {
	/** The verb column: `Running`, `Waiting`, `Calling`. */
	verb: string;
	/** The object column: the call's own words, e.g. `wait 3600000`. */
	object: string;
};

/**
 * The class a ledger name belongs to, in §E2's own vocabulary.
 *
 * `null` is a REAL answer: a name this table does not know must not be filed
 * into a class, because the summary is a claim about what the turn did and a
 * wrong class is a wrong claim. Unknown names still fold - they just count
 * toward "N actions" instead of toward "Explored 4 files".
 */
export const actionClass = (
	name: string,
): "files" | "searches" | "commands" | "edits" | "web" | "delegated" | null => {
	// Lowercased here rather than at every call site: the ledger's names arrive in
	// both cases (`Web_Fetch` is a real wire name), and a case-sensitive table
	// silently classified it as unknown.
	const n = name.toLowerCase();
	if (
		n === "read" ||
		n === "grep" ||
		n === "glob" ||
		n === "ls" ||
		n === "list"
	)
		return "files";
	if (n === "search_the_web" || n === "web_search" || n === "search")
		return "web";
	if (n === "bash" || n === "exec" || n === "shell" || n === "run")
		return "commands";
	if (n === "edit" || n === "write" || n === "multiedit") return "edits";
	if (n === "task" || n === "delegate" || n === "agent") return "delegated";
	if (n === "fetch" || n === "web_fetch" || n === "fetch_url")
		return "searches";
	return null;
};

/**
 * §E2's copy, generated from the counts by class.
 *
 * A single class is named ("Ran 4 commands", "Edited 2 files"). Two phraseable
 * classes are joined ("Explored 4 files, 1 search"), which is the spec's own
 * example and the shape a reader can act on. Anything else - three classes, or
 * any action this table cannot classify - falls to `foldCounts`: the counts by
 * KIND, because a bare total (`4 actions`) tells a reader nothing they can act
 * on and the operator asked for the shape of the work instead ("3 shell · 1
 * python").
 */
export function foldSummary(actions: FoldableAction[]): string {
	const counts = new Map<string, number>();
	let unknown = 0;
	for (const action of actions) {
		const cls = actionClass(action.name);
		if (cls === null) unknown += 1;
		else counts.set(cls, (counts.get(cls) ?? 0) + 1);
	}
	if (unknown > 0 || counts.size > 2) return foldCounts(actions);

	/*
	 * Ordered by §E2's own sentence order, not by the order the calls happened to
	 * arrive: "Explored 4 files, 1 search" reads as one activity, and a summary
	 * whose wording depended on which call came first would change under a reader
	 * who had not changed anything.
	 */
	const order = ["files", "searches", "web", "commands", "edits", "delegated"];
	const parts: string[] = [];
	for (const cls of order) {
		const count = counts.get(cls) ?? 0;
		if (count === 0) continue;
		if (cls === "files")
			parts.push(`Explored ${count} file${count === 1 ? "" : "s"}`);
		if (cls === "searches")
			parts.push(`${count} search${count === 1 ? "" : "es"}`);
		if (cls === "web")
			parts.push(`Searched the web ${count} time${count === 1 ? "" : "s"}`);
		if (cls === "commands")
			parts.push(`Ran ${count} command${count === 1 ? "" : "s"}`);
		if (cls === "edits")
			parts.push(`Edited ${count} file${count === 1 ? "" : "s"}`);
		if (cls === "delegated")
			parts.push(`Delegated ${count} task${count === 1 ? "" : "s"}`);
	}
	if (parts.length === 0) return `${actions.length} actions`;
	// A two-class sentence reads as "Explored 4 files, 1 search"; the second part
	// keeps the join's own lowercase, which is why the first part is the only one
	// that capitalises.
	return parts.length === 1
		? parts[0]
		: `${parts[0]}, ${parts[1].charAt(0).toLowerCase()}${parts[1].slice(1)}`;
}

/**
 * The per-KIND count line: `3 shell · 1 python`, `2 files · 1 shell`.
 *
 * The fallback's replacement for a bare total, in the operator's own example -
 * `3 shell · 1 python`. Two vocabularies, both the app's:
 *
 * - the command kinds are named by their RUNTIME (`shell` for `bash`/`exec`,
 *   `python` for `eval`, whose row verb `Ran Python` already carries the word),
 *   because merging them into "commands" would hide exactly the shape the
 *   operator asked to see, and they are kind NAMES, not count nouns, so they
 *   stay singular (`3 shell`, as written);
 * - everything else counts under its class's own noun from the sentence table
 *   above (files, searches, web searches, edits, tasks), pluralized the way
 *   that sentence pluralizes it.
 *
 * An action this app cannot classify counts under its own display name rather
 * than being filed into somebody else's class: the summary is a claim about
 * what the turn did, and `2 files` for a Linear call would be a wrong claim.
 *
 * Ordered by the SENTENCE's own order, never by arrival: the same three actions
 * in a different order say the same thing (the reason `foldSummary` orders its
 * parts too). Unknown kinds follow, most-frequent first, alphabetically on a
 * tie, so the line is stable instead of depending on which call came first.
 */
export function foldCounts(actions: FoldableAction[]): string {
	type Kind = { noun: string; plural: string | null };
	const counts = new Map<string, { kind: Kind; count: number }>();
	const bump = (key: string, kind: Kind) => {
		const seen = counts.get(key);
		if (seen) seen.count += 1;
		else counts.set(key, { kind, count: 1 });
	};
	for (const action of actions) {
		const n = action.name.toLowerCase();
		if (n === "bash" || n === "exec" || n === "shell" || n === "run") {
			bump("kind:shell", { noun: "shell", plural: null });
			continue;
		}
		if (n === "eval") {
			bump("kind:python", { noun: "python", plural: null });
			continue;
		}
		const cls = actionClass(action.name);
		if (cls === "files") bump("class:files", { noun: "file", plural: "files" });
		else if (cls === "searches")
			bump("class:searches", { noun: "search", plural: "searches" });
		else if (cls === "web")
			bump("class:web", { noun: "web search", plural: "web searches" });
		else if (cls === "edits")
			bump("class:edits", { noun: "edit", plural: "edits" });
		else if (cls === "delegated")
			bump("class:delegated", { noun: "task", plural: "tasks" });
		else {
			const name = displayName(action.name);
			bump(`name:${name}`, { noun: name, plural: null });
		}
	}
	/*
	 * The sentence's order, with the command kinds in the slot `commands` held:
	 * files, searches, web, shell, python, edits, tasks.
	 */
	const order = [
		"class:files",
		"class:searches",
		"class:web",
		"kind:shell",
		"kind:python",
		"class:edits",
		"class:delegated",
	];
	const parts: string[] = [];
	const fact = (count: number, kind: Kind) =>
		`${count} ${count === 1 || kind.plural === null ? kind.noun : kind.plural}`;
	for (const key of order) {
		const seen = counts.get(key);
		if (seen) parts.push(fact(seen.count, seen.kind));
	}
	const rest = [...counts.entries()]
		.filter(([key]) => !order.includes(key))
		.sort(
			([, a], [, b]) =>
				b.count - a.count || a.kind.noun.localeCompare(b.kind.noun),
		);
	for (const [, seen] of rest) parts.push(fact(seen.count, seen.kind));
	// Only reachable for an empty run, which `foldRuns` never emits a summary for.
	return parts.length > 0 ? parts.join(" · ") : `${actions.length} actions`;
}

/**
 * The wall-clock bounds of ONE action, or null when it cannot date itself.
 *
 * A settled action's start is RECONSTRUCTED as `endedAt - durationS`: the
 * record documents those as two readings of the same span ("the execution
 * start, not the compose start, so it measures the same span the settled
 * `durationS` reports"), and the live layer clears `startedAt` when a call
 * settles so the ticking clock stops — this is where the start comes back from.
 * A call with no stamp on either side contributes NOTHING rather than a guess:
 * the span this feeds is a claim about time, and an invented zero is the claim
 * the operator reported as broken.
 */
function actionBounds(
	action: FoldableAction,
): { startMs: number; endMs: number | null } | null {
	if (action.running === true) {
		if (typeof action.startedAtMs !== "number") return null;
		return { startMs: action.startedAtMs, endMs: null };
	}
	if (
		typeof action.endedAtMs !== "number" ||
		typeof action.durationS !== "number"
	)
		return null;
	return {
		startMs: action.endedAtMs - action.durationS * 1000,
		endMs: action.endedAtMs,
	};
}

/**
 * The run's wall-clock span: FIRST start to LAST completion, or null when the
 * run cannot date itself.
 *
 * The operator's definition, and the right one: a SUM of the measured call
 * durations ignores the gaps between calls and reads `0s` for a run of fast
 * ones — while "how long was spent in this action group" is exactly the span
 * those gaps live in. The span is emitted only when at least one action carries
 * a start and either one carries a completion or the run is still in flight;
 * an older row restored from history carries durations but NO stamps (the
 * durable tool shape persists `duration_s` and no times), so its run shows no
 * clock at all rather than a made-up zero — the header's rule is "nothing when
 * we do not know", the same one `DiffCounters` states for `+0`.
 *
 * `running` is true while ANY action has not settled, and it is deliberately
 * the row's own predicate (`phase !== "done"`): the numbers between calls are
 * part of the section too, so the clock keeps running until the run is over and
 * then freezes at its last completion — it never ticks backward.
 */
export function foldSpan(actions: FoldableAction[]): FoldSpan | null {
	let startedAtMs: number | null = null;
	let endedAtMs: number | null = null;
	let running = false;
	for (const action of actions) {
		if (action.running === true) running = true;
		const bounds = actionBounds(action);
		if (!bounds) continue;
		startedAtMs =
			startedAtMs === null
				? bounds.startMs
				: Math.min(startedAtMs, bounds.startMs);
		if (bounds.endMs !== null)
			endedAtMs =
				endedAtMs === null ? bounds.endMs : Math.max(endedAtMs, bounds.endMs);
	}
	if (startedAtMs === null) return null;
	if (endedAtMs === null && !running) return null;
	return { startedAtMs, endedAtMs, running };
}

/**
 * The call the condensed header names while the run is in flight, or null when
 * every call has settled.
 *
 * The LAST unsettled action is the one being watched — calls run one at a time,
 * so it is the newest activity in the run — and its label is assembled through
 * `toolRowLabel`, the same composition `ToolRow` paints, so the collapsed group
 * and the expanded row cannot say two different things. No output fallback is
 * passed: a call that has not settled has no output to stand in with.
 *
 * This is also the fold's own settle predicate: `foldLive(...) === null` IS
 * "nothing in this run is still running", which is what the component's
 * condense waits on.
 */
export function foldLive(actions: FoldableAction[]): FoldLive | null {
	for (let index = actions.length - 1; index >= 0; index -= 1) {
		const action = actions[index];
		if (action.running !== true) continue;
		return toolRowLabel(action.name, action.summary ?? "", null, true);
	}
	return null;
}

/**
 * The rows, split into single rows and folds.
 *
 * A run is consecutive SAME-TURN actions: a row whose `gap` is `"turn"` opens a
 * new turn and therefore a new run, which is how the boundary between two turns
 * is respected without this model knowing anything about turns. Rows the
 * transcript does not treat as trace-like (prose, notices, receipts that are not
 * calls) break a run even when they sit between two calls, because folding
 * across them would hide a statement behind a summary of actions.
 */
export function foldRuns(
	rows: Row[],
	options: {
		/** `ledgerName` for a row, injected so this module stays pure. */
		nameOf: (row: Row) => string;
		failedOf: (row: Row) => boolean;
		durationOf?: (row: Row) => number | null;
		/** The row's own object text, for the fold's live clause. */
		summaryOf?: (row: Row) => string;
		/** The row's own running predicate: `phase !== "done"`. */
		runningOf?: (row: Row) => boolean;
		/** Ms epoch the call began executing, when the row carries one. */
		startedAtOf?: (row: Row) => number | null;
		/** Ms epoch the call completed, when the row carries one. */
		endedAtOf?: (row: Row) => number | null;
		isFoldable: (row: Row) => boolean;
	},
): FoldGroup[] {
	const groups: FoldGroup[] = [];
	let run: Row[] = [];
	const flush = () => {
		if (run.length === 0) return;
		const actions: FoldableAction[] = run.map((row) => {
			const action: FoldableAction = {
				name: options.nameOf(row),
				failed: options.failedOf(row),
				durationS: options.durationOf ? options.durationOf(row) : null,
				startedAtMs: options.startedAtOf ? options.startedAtOf(row) : null,
				endedAtMs: options.endedAtOf ? options.endedAtOf(row) : null,
			};
			if (options.summaryOf) action.summary = options.summaryOf(row);
			if (options.runningOf) action.running = options.runningOf(row);
			return action;
		});
		if (run.length >= FOLD_MIN_ACTIONS) {
			groups.push({
				kind: "run",
				id: run[0].record.id,
				gap: run[0].gap,
				rows: run,
				actions,
				summary: foldSummary(actions),
				failedCount: actions.filter((action) => action.failed).length,
				span: foldSpan(actions),
				live: foldLive(actions),
			});
		} else {
			for (const row of run) groups.push({ kind: "row", row });
		}
		run = [];
	};

	for (const row of rows) {
		/*
		 * A ROW THAT OPENS A TURN STARTS A NEW RUN, and it is IN that run (design
		 * round 1, D8). It used to be excluded - the run began at the turn's SECOND
		 * action - because the opening row carries the turn's 32px gap and a
		 * margin that size inside a fold's content would open a hole under the
		 * summary line. The cost was a standalone `read` row above `7 actions`
		 * while the turn's foot said `8 actions`: two counts for one turn. The gap
		 * now belongs to the GROUP (`gap` below), which the transcript paints on the
		 * fold's own wrapper, and the row inside the fold is drawn at the trace
		 * tier - so the fold holds the whole consecutive run (§E2) and its count is
		 * the foot's.
		 */
		const opensTurn = row.gap === "turn" || row.gap === "first";
		if (opensTurn) flush();
		if (options.isFoldable(row)) {
			run.push(row);
			continue;
		}
		flush();
		groups.push({ kind: "row", row });
	}
	flush();
	return groups;
}

/** What a finished turn's foot line reports (§E3). */
export type TurnFoot = {
	actions: number;
	failed: number;
	/** Summed seconds, when the turn reported any. */
	durationS: number | null;
	/** The first failed row in the turn, for §E3's jump (U14). */
	firstFailedId: string | null;
};

/**
 * The foot line's data, per turn-closing row id.
 *
 * A turn is the rows between one `user` row and the next turn's opening, which
 * is the same fact the transcript already computes as `closesTurn`; this walks
 * the same list and accumulates up to that point, so the count a reader sees at
 * the foot is the count of rows ABOVE it rather than of the whole conversation.
 */
export function turnFeet(
	rows: Row[],
	options: {
		failedOf: (row: Row) => boolean;
		durationOf?: (row: Row) => number | null;
		isAction: (row: Row) => boolean;
	},
): Map<string, TurnFoot> {
	const feet = new Map<string, TurnFoot>();
	let actions = 0;
	let failed = 0;
	let durationS: number | null = null;
	let firstFailedId: string | null = null;

	for (const row of rows) {
		/*
		 * A row that opens a turn RESETS the tally: a foot line reports what the
		 * turn above it did, and carrying the previous turn's counts into the next
		 * one would report the conversation rather than the turn.
		 */
		if (row.gap === "turn" || row.gap === "first") {
			actions = 0;
			failed = 0;
			durationS = null;
			firstFailedId = null;
		}
		if (options.isAction(row)) {
			actions += 1;
			if (options.failedOf(row)) {
				failed += 1;
				firstFailedId ??= row.record.id;
			}
			const seconds = options.durationOf ? options.durationOf(row) : null;
			if (typeof seconds === "number") durationS = (durationS ?? 0) + seconds;
		}
		if (row.closesTurn) {
			feet.set(row.record.id, { actions, failed, durationS, firstFailedId });
		}
	}
	return feet;
}
