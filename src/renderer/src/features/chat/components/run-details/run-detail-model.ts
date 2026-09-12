/**
 * The run-details view model: the arithmetic behind the header popover.
 *
 * Ported from the TUI's dock panels, which are the reference implementation for
 * both data models. Source of truth: `local_operator/tui/widgets/subagent_panel.py`
 * (roster rank, row grammar, the omission rule) and
 * `local_operator/tui/widgets/todo_panel.py` (phased plan, the luminance-plus-a-word
 * encoding, the row budget). Pure functions, no React and no DOM, so the rules
 * that have a right answer can be asserted against the Python semantics they
 * mirror — `scripts/run-detail-model.test.mjs` bundles and exercises them.
 *
 * Why port the rules at all rather than invent web-native ones: the desktop
 * surface is a second view of the same wire state (`CanonicalFrontendState.jobs`
 * and `.todos`), and a user who has learned to read the roster in the terminal
 * must not have to learn it again in the app. Which fact lands where, and which
 * fact is dropped first when there is no room, stay identical; the medium does
 * not.
 *
 * ## The one rule everything else hangs off
 *
 * **A number that is unknown is omitted, never zeroed.** `subagent_panel.py:429-450`
 * gives the reason: a child whose provider has not reported usage has no cost,
 * and `$0.0000` on a row that has spent money reads as "this was free". So every
 * optional figure here is `null` rather than `0`, and the row drops the segment.
 *
 * ## Unknown wire fields
 *
 * The wire is `Array<Record<string, unknown>>` on both lists — a runtime older
 * or newer than this renderer is normal, and `JobState`/`TodoPhaseState` both
 * carry `extra='allow'`. So every read is defensive: a missing field degrades to
 * an omitted segment or a named fallback, never to a crash or a confident zero.
 */

/* ------------------------------------------------------------------ */
/* Vocabulary                                                          */
/* ------------------------------------------------------------------ */

/**
 * The states a child row can render, which is exactly the set
 * `subagent_panel.status_glyph` has a mark for (`:345-391`).
 *
 * Anything else on the wire — a status from a runtime this renderer has not
 * been taught — folds to `done`, which is that function's own default. The
 * alternative (treating an unknown word as open) was considered and rejected
 * for parity: the TUI's roster has read `GLYPH_DONE, status or "completed"` for
 * its whole life, and a second answer here would be a second vocabulary for one
 * job. The cost is named rather than hidden: a future status must be added to
 * THIS table, or it will read as finished.
 */
export type ChildStatus =
	| "running"
	| "queued"
	| "paused"
	| "interrupted"
	| "done"
	| "cancelled"
	| "failed";

/**
 * The statuses that mean "this child has not settled", which is what §3.3's
 * visibility rule and the roster's rank both turn on.
 *
 * `starting` and `pausing` are on the wire and are deliberately handled by the
 * fold below rather than by a mark of their own:
 *
 * - `starting` — the capacity gate has admitted the child but it is not yet
 *   working, so it takes the `queued` mark (a clock: "has not started"). It
 *   stays OPEN, which is the fact the visibility rule needs.
 * - `pausing` — the pause flag is set before the cancel it awaits, so the child
 *   is demonstrably still going. `status_glyph:371-376` gates its paused branch
 *   on `status != "running"` for exactly this window; folding `pausing` to
 *   `running` is the same guard expressed once, in the model.
 */
export const OPEN_CHILD_STATUSES: readonly ChildStatus[] = [
	"running",
	"queued",
	"paused",
];

/** Every to-do state the panel draws, from the TUI's `STATUS_MARKS` (`:177`). */
export type TodoItemStatus = "pending" | "done" | "dropped" | "blocked";

/** The to-do states that are still asking for something (`todo_panel.py:283-284`). */
export const OPEN_TODO_STATUSES: readonly TodoItemStatus[] = [
	"pending",
	"blocked",
];

/**
 * The TUI's roster vocabulary, in the band's own words (`status_glyph:371-391`).
 * Used for the tally, and for the visually-hidden state each row carries so the
 * panel reads as a sentence to a screen reader rather than as a column of
 * unlabelled icons.
 */
const CHILD_STATE_WORD: Record<ChildStatus, string> = {
	running: "running",
	queued: "queued",
	paused: "paused",
	interrupted: "interrupted",
	done: "done",
	cancelled: "cancelled",
	failed: "failed",
};

/**
 * The rank the overflow slice evicts by (`subagent_panel._EVICTION_RANK:256-262`).
 *
 * Running and queued share the top rank — a child behind the capacity gate is
 * still work the user is waiting on — then failure, then interrupted/paused
 * (the two states that end without settling), then everything settled quietly.
 * The TUI ranks `interrupted` above `paused`; they are one rank apart in the
 * table but adjacent once ties fall to the newest, and collapsing them keeps
 * the ladder to the four rungs §2.1 names.
 */
const EVICTION_RANK: Record<ChildStatus, number> = {
	running: 0,
	queued: 0,
	failed: 1,
	paused: 2,
	interrupted: 2,
	done: 3,
	cancelled: 3,
};

/** Rows the subagents section shows before it starts disclosing (`§6.3`). */
export const SUBAGENT_ROW_CAP = 6;

/** Item rows the to-dos section shows before it starts disclosing (`§6.3`). */
export const TODO_ITEM_CAP = 10;

/**
 * The seam between two facts on one line. The same ` · ` the TUI's row and the
 * app's own stats runs use (`STATS_SEAM`), so a numbers run punctuates the way
 * every other run of numbers in the app does.
 */
const SEAM = " · ";

/** The seam between two clauses of a sentence, which is not the counts seam. */
const CLAUSE_SEAM = ", ";

/** The tooltip's fixed lead-in. The clauses that follow are the variable half. */
const LABEL_PREFIX = "Run details — ";

/** The TUI's name for a plan that arrived with no phases of its own. */
const IMPLICIT_PHASE_NAME = "Todos";

/* ------------------------------------------------------------------ */
/* Derived rows                                                        */
/* ------------------------------------------------------------------ */

/**
 * One child, as the roster draws it.
 *
 * Identity and the numbers run are separate fields rather than one pre-joined
 * string because each takes its own ink and the elapsed value its own
 * `tabular-nums`; the row's grammar is `§4.1`, not a format string.
 */
export type SubagentRow = {
	id: string;
	/** Falls back to the job id when the wire carries no label, as the TUI does. */
	label: string;
	/** `agent_role`, or `null` when it is absent or is the default `task`. */
	role: string | null;
	status: ChildStatus;
	/** `7m49s`, or `null` when the job has no trustworthy launch clock. */
	elapsedLabel: string | null;
	/** `46%`, or `null` when either half of the fraction is unknown. */
	contextLabel: string | null;
	/** `$0.31`, or `null` when no cost has been reported. */
	costLabel: string | null;
	/** `latest_details.progress`, while the child is running or queued. */
	activity: string | null;
	/** The first line of `error_text`, on a failed child. */
	errorLine: string | null;
};

/** One to-do item, pass-through from the wire plus the state's own word. */
export type TodoItemView = {
	text: string;
	status: TodoItemStatus;
	reason: string | null;
};

/**
 * One phase of a plan.
 *
 * `name` is `null` for the flat, single-phase case, where the TUI renders no
 * header at all (`todo_panel.py`, design §6.3: "an `init` with no phases renders
 * headerless … this is the back-compat guarantee"). `closed` counts done AND
 * dropped, matching the TUI's `RESOLVED_STATUSES` so a fully settled phase reads
 * `n/n` — the same notion its auto-hide uses.
 */
export type TodoPhaseView = {
	name: string | null;
	items: TodoItemView[];
	closed: number;
	total: number;
};

/**
 * Everything the panel and the trigger read, derived once per wire frame.
 *
 * The counts are over the WHOLE wire lists, not the visible slice: a capped
 * list still describes the same run, and `+N more` is the row that confesses
 * what is not on screen. Counting the slice instead would make the header's
 * tally shrink as rows overflow, which reads as work disappearing.
 */
export type RunDetails = {
	subagents: SubagentRow[];
	todos: TodoPhaseView[];
	/** Children that have not settled: running, queued or paused (`§3.3`). */
	openChildren: number;
	/** Ids of every failed child, in roster order — the "unseen failure" ledger. */
	failedChildIds: string[];
	/** To-do items still open — pending or blocked (`§3.3`). */
	openTodos: number;
	doneTodos: number;
	droppedTodos: number;
	totalTodos: number;
};

/**
 * The failures a trigger has already acknowledged.
 *
 * "A child has failed and the popover has not been opened since" (`§3.3`) is the
 * one visibility clause that no wire field can answer, because it is about what
 * the user has seen rather than about what is true. So the acknowledgement is
 * passed IN — the trigger owns it, the model only compares it — and the default
 * is the honest one for a caller that has never opened anything: nothing seen.
 */
export type SeenFailures = ReadonlySet<string>;

/** The empty acknowledgement set. Never mutated; `Set` is not frozen in place. */
export const NOTHING_SEEN: SeenFailures = new Set<string>();

/* ------------------------------------------------------------------ */
/* Wire reading                                                        */
/* ------------------------------------------------------------------ */

const isRecord = (value: unknown): value is Record<string, unknown> =>
	typeof value === "object" && value !== null && !Array.isArray(value);

/** A wire string, trimmed; `""` for anything else. */
const wireText = (value: unknown): string =>
	typeof value === "string" ? value.trim() : "";

/** The first line of a multi-line string, trimmed. */
const firstLine = (text: string): string => text.split("\n")[0].trim();

/**
 * A finite wire number, or `null`.
 *
 * `null` rather than a defaulted `0` for every figure that would otherwise be
 * invented: see the header. A boolean is refused because `true` stringifying to
 * `1` is a number the wire never sent.
 */
const wireNumber = (value: unknown): number | null => {
	if (typeof value !== "number" || !Number.isFinite(value)) return null;
	return value;
};

/**
 * Flatten model-written text to one line.
 *
 * The activity string is a model's own sentence and may arrive with newlines or
 * control characters in it; a row that grows to three lines because the model
 * wrote one would break the pitch of the whole list. Whitespace runs collapse to
 * a single space and control characters are dropped — the same boundary the
 * TUI's `clean_intent` runs before painting intent text.
 */
const oneLine = (text: string): string =>
	text
		// biome-ignore lint/suspicious/noControlCharactersInRegex: stripping them is the point
		.replace(/[\u0000-\u001f\u007f]+/g, " ")
		.replace(/\s+/g, " ")
		.trim();

/* ------------------------------------------------------------------ */
/* Formatting                                                          */
/* ------------------------------------------------------------------ */

/**
 * How long a job has run, in the ledger's own grammar (`7m49s`).
 *
 * Re-implemented rather than imported from `trace/tool-row-model.ts` for the
 * reason that file gives for its own settled format: this is the CHILD clock,
 * derived from `start_time`/`settled_at`, and the tool row's function takes a
 * slightly different input (a live `startedAt` in ms). Two call sites one
 * import apart that must agree is the drift these two helpers already
 * document; the shape of the string is identical, and the shared test asserts
 * the same expectations against both.
 */
const formatElapsed = (seconds: number): string => {
	const total = Math.max(0, Math.floor(seconds));
	if (total < 60) return `${total}s`;
	if (total < 3600) {
		const m = Math.floor(total / 60);
		const s = total % 60;
		return s === 0 ? `${m}m` : `${m}m${s}s`;
	}
	if (total < 86400) {
		const h = Math.floor(total / 3600);
		const m = Math.floor((total % 3600) / 60);
		return m === 0 ? `${h}h` : `${h}h${m}m`;
	}
	const d = Math.floor(total / 86400);
	if (d > 99) return "100d+";
	const h = Math.floor((total % 86400) / 3600);
	return h === 0 ? `${d}d` : `${d}d${h}h`;
};

/**
 * Context occupancy as a percentage, or `null` when it cannot be stated.
 *
 * `status_line.context_spelling(form="short")` is the spelling the TUI's
 * narrowest rows use: `46%`, never `46%/200k` — the denominator is the half a
 * reader can recover elsewhere and the row has no room for it. Two refusals are
 * ported with it:
 *
 * - **A zero reading is not reported.** `tokens <= 0` is "nothing reported yet",
 *   not "empty context", and the TUI returns `""` for it so every caller's
 *   segment disappears on the same test.
 * - **A rounded `0%` over a non-zero reading is refused** — a child holding
 *   three thousand tokens is not holding none — so a non-zero spend below 1%
 *   reads `<1%`.
 *
 * The one departure: with no `context_window` the TUI falls back to a token
 * count against an explicit unknown (`300k/—`). That spelling is six cells of a
 * terminal's compromise; in a percent slot a bare `300k` would misread as one,
 * and inventing a denominator is the thing the rule exists to prevent. So the
 * segment is omitted, which is the same answer the row already gives for a
 * child that has reported nothing.
 */
const formatContext = (
	tokens: number | null,
	window: number | null,
): string | null => {
	if (tokens === null || tokens <= 0) return null;
	if (window === null || window <= 0) return null;
	const percent = (tokens / window) * 100;
	if (percent < 1) return "<1%";
	return `${Math.round(percent)}%`;
};

/**
 * A cost in the row's dollar grammar: `$0.0021` under a cent, `$0.31` above.
 *
 * `null` is unknown — omitted — while a reported `0` is a real zero and renders
 * as one, because the wire said so. Both decimals below a cent and two above is
 * the design's own example (`§4.1`: `reviewer · 1m 12s · 46% · $0.31`) and a
 * deliberate departure from `status_line.format_cost:671-677`, which spends
 * three decimals up to a dollar. The sub-cent case keeps four, because rounding
 * a real $0.004 to `$0.00` states a cost of nothing — the same refusal the
 * omission rule makes from the other side.
 */
const formatCost = (cost: number | null): string | null => {
	if (cost === null) return null;
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(2)}`;
};

/**
 * Fold the job manager's word plus its two flags into one renderable state.
 *
 * Order is `status_glyph`'s (`:371-391`) and each step is load-bearing: a pause
 * outranks the status it cancelled, but only once `running` has cleared, so a
 * pause still landing does not paint a stopped child while it is still going; a
 * queued child's status is still `running` on the wire, so the flag has to be
 * read before the word or half the roster reads as spending tokens.
 */
const foldStatus = (
	raw: string,
	queued: boolean,
	paused: boolean,
): ChildStatus => {
	const status = raw.toLowerCase();
	if (paused && status !== "running") return "paused";
	if (queued || status === "starting") return "queued";
	if (status === "pausing") return "running";
	if (status === "running") return "running";
	if (status === "paused") return "paused";
	if (status === "failed") return "failed";
	if (status === "cancelled" || status === "canceled") return "cancelled";
	if (status === "interrupted") return "interrupted";
	return "done";
};

/** Whether a folded state has settled. */
const isSettled = (status: ChildStatus): boolean =>
	!OPEN_CHILD_STATUSES.includes(status);

/* ------------------------------------------------------------------ */
/* Derivation                                                          */
/* ------------------------------------------------------------------ */

export type RunDetailsInput = {
	jobs: Array<Record<string, unknown>>;
	todos: Array<Record<string, unknown>>;
	/**
	 * Epoch milliseconds to measure a RUNNING child against.
	 *
	 * Only a running child depends on it: a settled one is measured against its
	 * own `settled_at`, so its duration is a fact about the job rather than
	 * about when the frame happened to be derived. It is a parameter rather
	 * than a call to `Date.now()` inside the loop so a story or a test can pin
	 * the frame it is describing.
	 */
	nowMs?: number;
};

const readLatestDetails = (value: unknown): string => {
	// `JobState.latest_details` is a mapping on the live path and a bare string
	// on the replayed one, so both are read rather than only the shape this
	// renderer happens to see today.
	if (typeof value === "string") return value;
	if (isRecord(value)) return wireText(value.progress);
	return "";
};

const readElapsed = (
	job: Record<string, unknown>,
	nowSeconds: number,
): string | null => {
	const start = wireNumber(job.start_time);
	// `job_elapsed:414-417`: epoch zero is not a launch time, and "0s" would
	// invent a duration for a row that has no clock at all.
	if (start === null || start <= 0) return null;
	const settled = wireNumber(job.settled_at);
	const end = settled !== null && settled > 0 ? settled : nowSeconds;
	return formatElapsed(Math.max(end - start, 0));
};

const readUsage = (value: unknown): Record<string, unknown> | null =>
	isRecord(value) ? value : null;

const deriveChild = (
	job: Record<string, unknown>,
	nowSeconds: number,
): SubagentRow => {
	const id = wireText(job.id);
	const label = wireText(job.label) || id;
	const rawRole = wireText(job.agent_role);
	// `subagent_view.py:3168-3196` suppresses the default role in the child's own
	// title: "task" is what every child with no role of its own is called, so
	// printing it spends the row's scarcest column saying nothing.
	const role = rawRole === "" || rawRole === "task" ? null : rawRole;
	const status = foldStatus(
		wireText(job.status) || "running",
		job.queued === true,
		job.paused === true,
	);
	const usage = readUsage(job.usage);
	// `job_stats:504`: context is the last point-in-time reading, falling back to
	// `input_tokens` — a running sum, so only an approximation of occupancy, used
	// because a provider that reports no context size still reports what it was
	// billed for. Same precedence the parent's band uses.
	const tokens =
		wireNumber(usage?.context_tokens) ?? wireNumber(usage?.input_tokens);
	// The first line first, THEN flattened: `oneLine` collapses newlines, so
	// taking the line after it would return a "first line" that is the whole
	// error stuffed onto one row.
	const errorText = oneLine(firstLine(wireText(job.error_text)));

	return {
		id,
		label,
		role,
		status,
		elapsedLabel: readElapsed(job, nowSeconds),
		contextLabel: formatContext(tokens, wireNumber(job.context_window)),
		costLabel: formatCost(wireNumber(job.direct_cost)),
		// Line 2 belongs to live work: a settled row's activity was blanked by the
		// TUI (`:653-660`) to keep the settled tail of the list quiet, and the
		// failure case takes its own field instead.
		activity: isSettled(status)
			? null
			: oneLine(readLatestDetails(job.latest_details)) || null,
		// `§8`: the first line of `error_text` is a failure's one-line summary —
		// the row is the summary, the child's page is the detail.
		errorLine: status === "failed" && errorText ? errorText : null,
	};
};

const deriveTodoItem = (item: unknown): TodoItemView => {
	const record = isRecord(item) ? item : {};
	const rawStatus = wireText(record.status).toLowerCase();
	const known =
		OPEN_TODO_STATUSES.includes(rawStatus as TodoItemStatus) ||
		rawStatus === "done" ||
		rawStatus === "dropped";
	return {
		text: wireText(record.text),
		// An unrecognised status falls back to the OPEN rendering, never the
		// settled one (`todo_panel.py:1785-1788`): a future status must not
		// silently read as finished work. The child roster makes the opposite
		// call for its own reasons, and both are deliberate.
		status: known ? (rawStatus as TodoItemStatus) : "pending",
		reason: wireText(record.reason) || null,
	};
};

const deriveTodoPhase = (
	phase: unknown,
	headerless: boolean,
): TodoPhaseView => {
	const record = isRecord(phase) ? phase : {};
	const rawItems = Array.isArray(record.items) ? record.items : [];
	const items = rawItems.map(deriveTodoItem);
	return {
		name: headerless ? null : wireText(record.name) || IMPLICIT_PHASE_NAME,
		items,
		closed: items.filter((item) => !OPEN_TODO_STATUSES.includes(item.status))
			.length,
		total: items.length,
	};
};

const toWireList = (value: unknown): Array<Record<string, unknown>> =>
	Array.isArray(value) ? value.filter(isRecord) : [];

/**
 * Everything the panel draws, from the two lists the renderer already holds.
 *
 * `§8`: the view model is derived, never stored. Child lineage
 * (`parent_job_id`) and a child's own `todos` plan both ride the wire and are
 * deliberately unused here — the roster is flat, as the TUI's is, and the
 * popover shows the SESSION's plan rather than each child's.
 */
export function deriveRunDetails(input: RunDetailsInput): RunDetails {
	const jobs = toWireList(input?.jobs);
	const rawTodos = Array.isArray(input?.todos) ? input.todos : [];
	const nowSeconds = (input?.nowMs ?? Date.now()) / 1000;

	const subagents = jobs.map((job) => deriveChild(job, nowSeconds));
	// Headerless only for the flat case the TUI special-cases: ONE phase that
	// carries no name of its own. Two phases where one is called "Todos" is a
	// plan someone wrote, and it keeps its header.
	const headerlessPhase = rawTodos.length === 1;
	const todos = rawTodos.map((phase, index) =>
		deriveTodoPhase(
			phase,
			headerlessPhase && index === 0 && !isNamedPhase(phase),
		),
	);
	const items = todos.flatMap((phase) => phase.items);

	return {
		subagents,
		todos,
		openChildren: subagents.filter((row) => !isSettled(row.status)).length,
		failedChildIds: subagents
			.filter((row) => row.status === "failed")
			.map((row) => row.id),
		openTodos: items.filter((item) => OPEN_TODO_STATUSES.includes(item.status))
			.length,
		doneTodos: items.filter((item) => item.status === "done").length,
		droppedTodos: items.filter((item) => item.status === "dropped").length,
		totalTodos: items.length,
	};
}

/** Whether a phase carries a name of its own rather than the implicit default. */
const isNamedPhase = (phase: unknown): boolean => {
	if (!isRecord(phase)) return false;
	const name = wireText(phase.name);
	return name !== "" && name !== IMPLICIT_PHASE_NAME;
};

/* ------------------------------------------------------------------ */
/* Visibility                                                          */
/* ------------------------------------------------------------------ */

/** The failures among `failedChildIds` the caller has not acknowledged yet. */
export function unseenFailures(
	details: RunDetails | null | undefined,
	seen: SeenFailures = NOTHING_SEEN,
): string[] {
	if (!details) return [];
	return details.failedChildIds.filter((id) => !seen.has(id));
}

/**
 * Whether a child has failed and nobody has looked (`§3.3`).
 *
 * This is the TUI's `note_child_failed` rule (`:1837-1852`) carried over: it is
 * the one state the dock refuses to let the user miss, and the precedent for the
 * trigger's `danger` dot.
 */
export function hasUnseenFailure(
	details: RunDetails | null | undefined,
	seen: SeenFailures = NOTHING_SEEN,
): boolean {
	return unseenFailures(details, seen).length > 0;
}

/**
 * Whether the trigger should exist at all (`§3.3`).
 *
 * **Settled work alone does not raise the trigger.** A finished roster is
 * history, and history lives in the transcript; without this the button becomes
 * permanent furniture after the first `task` call. So: any open child, any open
 * to-do, or a failure nobody has seen.
 */
export function hasRunDetails(
	details: RunDetails | null | undefined,
	seen: SeenFailures = NOTHING_SEEN,
): details is RunDetails {
	if (!details) return false;
	return (
		details.openChildren > 0 ||
		details.openTodos > 0 ||
		hasUnseenFailure(details, seen)
	);
}

/* ------------------------------------------------------------------ */
/* Section tallies                                                     */
/* ------------------------------------------------------------------ */

/**
 * Keep whole segments from the front until the run stops fitting.
 *
 * Clause shedding, never truncation (`§4.1`, `§6.2`): a tally cut mid-segment
 * reads as a broken count — `2 running · 1 do…` states a number and hides what
 * it counts — so segments go whole, worst-first, from the end. The first segment
 * always survives, even alone over budget: dropping it would leave the label
 * saying nothing, which is worse than saying the most important thing at full
 * width.
 */
const shedSegments = (segments: string[], maxChars?: number): string => {
	if (segments.length === 0) return "";
	if (maxChars === undefined) return segments.join(SEAM);
	let kept = segments.slice(0, 1);
	for (const segment of segments.slice(1)) {
		if ([...kept, segment].join(SEAM).length > maxChars) break;
		kept = [...kept, segment];
	}
	return kept.join(SEAM);
};

/**
 * The subagents section's trailing tally: `2 running · 1 done`.
 *
 * Order is the eviction ladder read left to right — the states that need
 * attention first — so shedding from the end drops the quietest fact first and
 * the tally degrades toward the one number that matters.
 */
export function subagentTally(rows: SubagentRow[], maxChars?: number): string {
	const counts = new Map<ChildStatus, number>();
	for (const row of rows) {
		counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
	}
	const segments: string[] = [];
	for (const status of [
		"running",
		"queued",
		"failed",
		"paused",
		"interrupted",
		"cancelled",
		"done",
	] as ChildStatus[]) {
		const count = counts.get(status) ?? 0;
		if (count > 0) segments.push(`${count} ${CHILD_STATE_WORD[status]}`);
	}
	return shedSegments(segments, maxChars);
}

/**
 * The to-dos section's trailing tally: `4 of 9 done`, plus ` · 1 dropped`.
 *
 * Plainer than the TUI's `n/total resolved`, which is a terminal's compression
 * of the same fact: `done` counts what finished and `dropped` is named
 * separately, because "4 of 9 done" and "4 of 9 resolved" are different claims
 * about a plan that abandoned work.
 */
export function todoTally(
	details: RunDetails | null | undefined,
	maxChars?: number,
): string {
	if (!details) return "";
	const segments = [
		`${details.doneTodos} of ${details.totalTodos} done`,
		...(details.droppedTodos > 0 ? [`${details.droppedTodos} dropped`] : []),
	];
	return shedSegments(segments, maxChars);
}

/* ------------------------------------------------------------------ */
/* Overflow                                                            */
/* ------------------------------------------------------------------ */

/**
 * The rows the roster shows, and how many it had to hide.
 *
 * Ordering is the priority slice's own (`§6.3`): running/queued, then failed,
 * then interrupted/paused, then settled, ties to the newest. It is applied to
 * the WHOLE roster rather than only to the overflowing one, because a list that
 * reordered the moment a seventh child arrived would reflow under the reader —
 * a defect the design names in the very paragraph that removes the TUI's other
 * reflow (`§2.2`). The TUI itself keeps start order because its DOM is
 * `_sync_rows`'s and reordering it would thrash; a keyed React list has no such
 * constraint, so the rule the slice picks by is the rule the list shows.
 */
export function visibleSubagents(rows: SubagentRow[]): {
	rows: SubagentRow[];
	hidden: number;
} {
	const ordered = rows
		.map((row, index) => ({ row, index }))
		.sort((a, b) => {
			const rank = EVICTION_RANK[a.row.status] - EVICTION_RANK[b.row.status];
			// Newest first within a rank, which is the `[-budget:]` rule the slice
			// had before it ranked at all.
			if (rank !== 0) return rank;
			return b.index - a.index;
		})
		.map((entry) => entry.row);
	return {
		rows: ordered.slice(0, SUBAGENT_ROW_CAP),
		hidden: Math.max(0, ordered.length - SUBAGENT_ROW_CAP),
	};
}

/**
 * The items the to-dos section shows, and how many it hid.
 *
 * `§6.3`: cap the item rows at `TODO_ITEM_CAP`, **never dropping an open or
 * blocked item**. Within that, closed rows go first, earliest phase first — so a
 * long plan sheds its oldest settled work and keeps its recent end plus every
 * item that is still asking for something. A phase left with nothing is dropped
 * entirely: a header with no rows under it is the "empty heading" `§6.3` forbids
 * everywhere else.
 *
 * The cap is a ceiling, not a guarantee: ten open items are ten rows, because
 * the alternative is hiding work the user has to act on.
 */
export function visibleTodoPhases(phases: TodoPhaseView[]): {
	phases: TodoPhaseView[];
	hidden: number;
} {
	const total = phases.reduce((sum, phase) => sum + phase.items.length, 0);
	if (total <= TODO_ITEM_CAP) return { phases, hidden: 0 };

	const openCount = phases.reduce(
		(sum, phase) =>
			sum +
			phase.items.filter((item) => OPEN_TODO_STATUSES.includes(item.status))
				.length,
		0,
	);
	let closedBudget = Math.max(0, TODO_ITEM_CAP - openCount);
	// Walk the plan in order: the earliest closed item is the first to go.
	const kept = phases.map((phase) => {
		const items: TodoItemView[] = [];
		for (const item of phase.items) {
			if (OPEN_TODO_STATUSES.includes(item.status)) {
				items.push(item);
				continue;
			}
			if (closedBudget > 0) {
				closedBudget -= 1;
				items.push(item);
			}
		}
		return { ...phase, items };
	});
	const visible = kept.filter((phase) => phase.items.length > 0);
	const hidden = visible.reduce(
		(sum, phase) => sum + (phase.total - phase.items.length),
		0,
	);
	return { phases: visible, hidden };
}

/* ------------------------------------------------------------------ */
/* Trigger copy                                                        */
/* ------------------------------------------------------------------ */

const plural = (count: number, noun: string): string =>
	count === 1 ? `1 ${noun}` : `${count} ${noun}s`;

const childClause = (count: number): string =>
	`${plural(count, "subagent")} running`;

const todoClause = (count: number): string =>
	count === 1 ? "1 to-do open" : `${count} to-dos open`;

const failureClause = (count: number): string =>
	`${plural(count, "subagent")} failed`;

/**
 * The tooltip and `aria-label` copy (`§6.2`).
 *
 * Built as ordered clauses rather than as a sentence so that pressure sheds a
 * whole clause instead of truncating one: the count is the first thing the
 * label exists to say, and `Run details — 2 subag…` says nothing at all. Order
 * is what needs attention first — an unseen failure, then children at work,
 * then open to-dos — and `maxChars` drops trailing clauses while keeping the
 * leading one.
 *
 * The "running" clause counts children that have not settled, not only those
 * whose status is literally `running`: `§6.2` fixes the product's word for a
 * child at work, and the alternative (omitting a queued child from the count)
 * would under-report work the user is waiting on. The roster's own clock mark is
 * where the queued/running distinction is made.
 */
export function runDetailTriggerLabel(
	details: RunDetails | null | undefined,
	seen: SeenFailures = NOTHING_SEEN,
	maxChars?: number,
): string {
	if (!details) return "Run details";
	const clauses: string[] = [];
	const failures = unseenFailures(details, seen).length;
	if (failures > 0) clauses.push(failureClause(failures));
	if (details.openChildren > 0) clauses.push(childClause(details.openChildren));
	if (details.openTodos > 0) clauses.push(todoClause(details.openTodos));
	if (clauses.length === 0) return "Run details";

	if (maxChars !== undefined) {
		let kept = clauses.slice(0, 1);
		for (const clause of clauses.slice(1)) {
			if (
				(LABEL_PREFIX + [...kept, clause].join(CLAUSE_SEAM)).length > maxChars
			) {
				break;
			}
			kept = [...kept, clause];
		}
		return LABEL_PREFIX + kept.join(CLAUSE_SEAM);
	}
	return LABEL_PREFIX + clauses.join(CLAUSE_SEAM);
}

/** The state word a row carries for a reader who cannot see its icon (`§6.4`). */
export function childStateLabel(status: ChildStatus): string {
	return CHILD_STATE_WORD[status];
}
