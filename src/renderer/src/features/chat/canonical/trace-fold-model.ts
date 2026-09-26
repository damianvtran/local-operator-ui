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

import type { Row } from "./transcript-rows";

/** §E2: a run of three or more consecutive actions folds. */
export const FOLD_MIN_ACTIONS = 3;

export type FoldableAction = {
	/** The ledger's own name for the call (`ledgerName`), already case-folded. */
	name: string;
	failed: boolean;
	/** Seconds, when the row carries one. */
	durationS?: number | null;
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
			durationS: number | null;
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
 * any action this table cannot classify - reports the only true thing left:
 * the count.
 */
export function foldSummary(actions: FoldableAction[]): string {
	const counts = new Map<string, number>();
	let unknown = 0;
	for (const action of actions) {
		const cls = actionClass(action.name);
		if (cls === null) unknown += 1;
		else counts.set(cls, (counts.get(cls) ?? 0) + 1);
	}
	if (unknown > 0 || counts.size > 2) return `${actions.length} actions`;

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

/** Seconds across a run, summed when every row reported one. */
export function runDuration(actions: FoldableAction[]): number | null {
	const known = actions
		.map((action) => action.durationS)
		.filter((value): value is number => typeof value === "number");
	if (known.length === 0) return null;
	return known.reduce((total, value) => total + value, 0);
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
		isFoldable: (row: Row) => boolean;
	},
): FoldGroup[] {
	const groups: FoldGroup[] = [];
	let run: Row[] = [];
	const flush = () => {
		if (run.length === 0) return;
		const actions: FoldableAction[] = run.map((row) => ({
			name: options.nameOf(row),
			failed: options.failedOf(row),
			durationS: options.durationOf ? options.durationOf(row) : null,
		}));
		if (run.length >= FOLD_MIN_ACTIONS) {
			groups.push({
				kind: "run",
				id: run[0].record.id,
				gap: run[0].gap,
				rows: run,
				actions,
				summary: foldSummary(actions),
				failedCount: actions.filter((action) => action.failed).length,
				durationS: runDuration(actions),
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
