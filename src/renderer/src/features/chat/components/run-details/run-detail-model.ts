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
 * The states a child row can render, enumerated from the WORDS THE WIRE CAN
 * CARRY rather than from `subagent_panel.status_glyph`'s table — which answers
 * a different question and is one branch short of this one.
 *
 * There are two producers of `frontend.jobs` rows, and the second is why this
 * list is longer than `JobState.status`:
 *
 * - The execution ledgers: `JobState.status` is
 *   `running|completed|failed|cancelled|interrupted`
 *   (`harness/jobs.py:215`, `session/frontend_state.py:1279-1291`) plus the
 *   `queued` flag.
 * - The DURABLE GRAPH, for the cold-restart case: `frontend_state._jobs`
 *   appends one `JobState` per `SubagentNode` whose id is not already in the
 *   live rows, with `status=getattr(node, "status", "gone")`, and
 *   `SubagentNode.status` is `SubagentComms._describe(record, now).status`
 *   (`harness/comms.py:793`) — the roster vocabulary `_describe` derives
 *   (`comms.py:1207-1345`):
 *   `pausing|paused|running|queued|starting|completed|failed|cancelled|interrupted|gone`.
 *   The `ChildInfo.status` docstring (`comms.py:288-299`) enumerates nine of
 *   those and omits `interrupted`, which reaches a row from a restored outcome
 *   and from `JobStatus` — `harness/jobs.py:205-215` documents it as
 *   RESTORE-only, so it is in this union on the same authority as `paused`. A
 *   nested child is exactly one whose job row never reaches the root's sidecar,
 *   so this is the branch that materialises them.
 *
 * So the words that can arrive here are `running`, `queued`, `starting`,
 * `pausing`, `paused`, `completed`, `failed`, `cancelled`, `interrupted` and
 * `gone`, and `foldStatus` below folds every one of them explicitly. `paused`
 * is in that list from the restored path and NOT from a live pause: a live
 * pause is mechanically a cancel and still arrives as `cancelled`.
 *
 * The two remaining states are this model's own, for words it has not been
 * taught: `gone` is the graph's own word for a row swept without an outcome,
 * and `unknown` is what a word from a runtime this renderer has never seen
 * becomes. **Neither is `done`** — see `foldStatus` for why that rule is worth
 * the extra mark.
 */
export type ChildStatus =
	| "running"
	| "queued"
	| "paused"
	| "interrupted"
	| "done"
	| "cancelled"
	| "gone"
	| "unknown"
	| "failed";

/**
 * The statuses that mean "this child has not settled", which is what §3.3's
 * visibility rule and the roster's rank both turn on.
 *
 * `paused` is one of them, and it is reachable: a restored record whose child
 * was paused before the process ended comes back through the durable-graph
 * branch with the word `paused` (`_ChildRecord.paused` outranks the recorded
 * outcome in `_describe`, and `record_outcome` deliberately does not clear the
 * flag). A row the user parked to come back to is open work — excluding it
 * would let a restored pause hide the trigger and render the child as a settled
 * green check, which is the defect this membership fixes.
 *
 * A LIVE pause still arrives as `cancelled` and is still indistinguishable
 * from a cancel: nothing publishes `_ChildRecord.paused` onto the job row or
 * the desktop frontend, and §10 records that follow-up with the mechanism the
 * harness actually allows.
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
 * The band's roster vocabulary, in its own words (`status_glyph:371-391`), for
 * every state that HAS a word of its own.
 *
 * `unknown` is deliberately not a key: that state's word is the wire's, not this
 * table's, so a fixed entry here would be a word the model invented for a status
 * it has just said it does not know (`SubagentRow.stateWord`). `satisfies` keeps
 * the completeness check that the `Record` would have given, so adding a state
 * without a word is still a compile error.
 */
const CHILD_STATE_WORD = {
	running: "running",
	queued: "queued",
	paused: "paused",
	interrupted: "interrupted",
	done: "done",
	cancelled: "cancelled",
	gone: "gone",
	failed: "failed",
} as const satisfies Record<Exclude<ChildStatus, "unknown">, string>;

/**
 * The rank the overflow slice evicts by (`subagent_panel._EVICTION_RANK:256-262`).
 *
 * Running and queued share the top rank — a child behind the capacity gate is
 * still work the user is waiting on — then failure, then the two states that end
 * without settling, `interrupted` and `paused` (the TUI ranks both at 2), then
 * everything settled quietly, which is where `cancelled`, `gone` and an
 * unrecognised word sit: the TUI gives them its default 3, and `done` is the
 * one state that means the child finished.
 */
const EVICTION_RANK: Record<ChildStatus, number> = {
	running: 0,
	queued: 0,
	failed: 1,
	interrupted: 2,
	paused: 2,
	done: 3,
	cancelled: 3,
	gone: 3,
	unknown: 3,
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
	/**
	 * The clock `elapsedLabel` was measured from, kept so the label can be
	 * re-measured at a later instant without re-reading the wire; `null` on both
	 * when the job has no launch time at all.
	 */
	startSeconds: number | null;
	settledSeconds: number | null;
	/** `46%`, or `null` when either half of the fraction is unknown. */
	contextLabel: string | null;
	/** `$0.31`, or `null` when no cost has been reported. */
	costLabel: string | null;
	/** `latest_details.progress`, while the child is running or queued. */
	activity: string | null;
	/** The first line of `error_text`, on a failed child. */
	errorLine: string | null;
	/**
	 * The state in words, for the reader who cannot see the mark (`§6.4`).
	 *
	 * The band's own word for a state this model knows, and the WIRE's own word
	 * for one it does not: a status nobody has taught this renderer is announced
	 * exactly as it arrived rather than translated into a word the model
	 * invented. That is the same rule the failure row's exception follows — a
	 * fabricated rendering of machine text is a claim nobody can check — and it
	 * is what makes `unknown` falsifiable in the panel instead of being a
	 * second, vaguer vocabulary for the same fact.
	 */
	stateWord: string;
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
 * A phase as the CAPPED list renders it.
 *
 * `items` are the rows that survived the item cap and `hidden` is how many of
 * this phase's own closed rows it hid, so the disclosure can sit inside the
 * phase that lost them (`§6.3`). Two facts stay counted over the WHOLE phase
 * rather than over the slice: `closed`/`total` behind the header, because a
 * header that shrank as rows overflowed would read as work disappearing.
 */
export type TodoPhaseSlice = TodoPhaseView & {
	hidden: number;
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
	/** Children that have not settled: running or queued (`§3.3`). */
	openChildren: number;
	/** Ids of every failed child, in roster order — the "unseen failure" ledger. */
	failedChildIds: string[];
	/** To-do items still open — pending or blocked (`§3.3`). */
	openTodos: number;
	doneTodos: number;
	droppedTodos: number;
	totalTodos: number;
	/**
	 * The instant this model was measured at, in EPOCH MILLISECONDS — the unit
	 * the model's own arithmetic works in, and NOT the unit the wire uses.
	 *
	 * Every clock on the wire (`start_time`, `settled_at`) is epoch SECONDS, so
	 * the derivation divides this by 1000 before comparing (`readClock`). A
	 * caller that passed milliseconds where the wire's unit was expected, or
	 * seconds here, would be off by three orders of magnitude with nothing on
	 * screen to say so — which is why the unit is spelled out on both sides of
	 * that division rather than only on the wire's.
	 *
	 * The second stamp is the wall-clock instant the derivation actually ran.
	 * Two stamps rather than one because only the first is a fact about the
	 * session: a story PINS it so its frames are reproducible, and cannot pin the
	 * second. Adding real elapsed time to the pinned instant is what lets the
	 * same 1Hz tick advance a fixture and a live session alike; reading the wall
	 * clock directly against a pinned fixture would report the months between.
	 */
	measuredAtMs: number;
	measuredAtRealMs: number;
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
 * Fold the job manager's word plus the capacity flag into one renderable state.
 *
 * Every word the wire can put on a row is folded here EXPLICITLY (the union is
 * enumerated on `ChildStatus`), because a fall-through is a guess about a state
 * nobody has reasoned about. The two rules that need stating:
 *
 * - The capacity flag is read BEFORE the word: a queued child's live status is
 *   still `running`, and the flag is the only thing that distinguishes it.
 * - **An unrecognised word is never `done`.** The TUI's `status_glyph` ends
 *   `GLYPH_DONE, status or "completed"` — an unknown status painted the
 *   completed check with its own word — and that default is the one branch of
 *   its table this port refuses. Silently promoting a state to "finished" is
 *   how a row the user is waiting on disappears: it stops counting as open work
 *   in §3.3's visibility rule, it is ranked with the settled rows in the slice,
 *   and it renders as a green check. An unrecognised word instead gets its own
 *   quiet settled mark and ITS OWN WORD (`SubagentRow.stateWord`), so the row
 *   stays visible and says what the wire actually said. Same reason `gone` —
 *   the graph's word for a row swept without an outcome — is its own state
 *   rather than the TUI's default check.
 *
 * `paused` is folded from the WORD, which is the shape the restored path sends
 * (`_describe` returns it ahead of the recorded outcome, and `record_outcome`
 * keeps the flag set across the child's exit). A live pause never carries it:
 * pause is mechanically a cancel, so a live pause still arrives as `cancelled`.
 */
const foldStatus = (raw: string, queued: boolean): ChildStatus => {
	const status = raw.toLowerCase();
	if (queued) return "queued";
	switch (status) {
		case "running":
			return "running";
		// `pausing`: the pause flag is set before the cancel it awaits, so the
		// child is demonstrably still going. `status_glyph:371-376` gates its
		// paused branch on `status != "running"` for exactly this window; folding
		// `pausing` to `running` is that guard expressed once, in the model.
		case "pausing":
			return "running";
		// `starting`: the capacity gate has admitted the child but its runner has
		// not been entered. It takes the `queued` mark ("has not started") and
		// stays OPEN, which is the fact §3.3's visibility rule needs.
		case "starting":
			return "queued";
		case "paused":
			return "paused";
		case "failed":
			return "failed";
		case "cancelled":
		// The other spelling of the same word, so a runtime that sends it lands on
		// the same mark rather than on `unknown`.
		case "canceled":
			return "cancelled";
		case "interrupted":
			return "interrupted";
		// The wire's own word for a clean finish (`JobStatus`) and the dock band's
		// word for the same fact: both are accepted so the two spellings cannot
		// diverge into two states.
		case "completed":
		case "done":
			return "done";
		case "gone":
			return "gone";
		default:
			return "unknown";
	}
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

type JobClock = {
	/** Launch instant in epoch seconds, or `null` when the job has no clock. */
	startSeconds: number | null;
	/** Settle instant in epoch seconds, or `null` while the job is still open. */
	settledSeconds: number | null;
};

/**
 * A job's own clock inputs, read from the wire.
 *
 * The elapsed LABEL is a string because that is what a row draws, but a running
 * child's duration is the one figure in this model that is a function of WHEN
 * the model is read; every other field is a fact about the job. Keeping the two
 * inputs as well is what lets that one figure be re-measured later from the
 * model itself (`retimeRunDetails`), so the 1Hz clock can live in the panel
 * that draws it rather than in a parent — where a tick would re-render the
 * transcript's own tree once a second to move one number.
 */
const readClock = (job: Record<string, unknown>): JobClock => {
	const start = wireNumber(job.start_time);
	// `job_elapsed:414-417`: epoch zero is not a launch time, and "0s" would
	// invent a duration for a row that has no clock at all.
	if (start === null || start <= 0) {
		return { startSeconds: null, settledSeconds: null };
	}
	const settled = wireNumber(job.settled_at);
	return {
		startSeconds: start,
		settledSeconds: settled !== null && settled > 0 ? settled : null,
	};
};

/**
 * The clock's own word: a settled job measured against its settle time, an open
 * one against the instant the model was read.
 */
const clockLabel = (clock: JobClock, nowSeconds: number): string | null => {
	if (clock.startSeconds === null) return null;
	const end = clock.settledSeconds ?? nowSeconds;
	return formatElapsed(Math.max(end - clock.startSeconds, 0));
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
	const clock = readClock(job);
	const rawStatus = wireText(job.status) || "running";
	const status = foldStatus(rawStatus, job.queued === true);
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
		// The band's word for a state this model knows; the wire's own word,
		// verbatim, for one it does not (`SubagentRow.stateWord`).
		stateWord: status === "unknown" ? rawStatus : CHILD_STATE_WORD[status],
		elapsedLabel: clockLabel(clock, nowSeconds),
		startSeconds: clock.startSeconds,
		settledSeconds: clock.settledSeconds,
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
		// silently read as finished work. The child roster now makes the same
		// call, by its own route: an unrecognised status is its own quiet
		// settled state carrying the wire's own word, never `done` (`foldStatus`).
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
	const nowMs = input?.nowMs ?? Date.now();
	const nowSeconds = nowMs / 1000;

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
		measuredAtMs: nowMs,
		measuredAtRealMs: Date.now(),
	};
}

/**
 * The same model re-measured against a later instant.
 *
 * Only elapsed labels move, and only on children whose clock is still live (no
 * `settled_at`): a settled child's duration is a fact about the job, and
 * everything else here — statuses, activity, error lines, counts, the plan — is
 * likewise a fact about the run rather than about when it was read. So nothing
 * else is recomputed and the wire is never re-read.
 *
 * `nowMs` is passed in the model's own clock, normally as
 * `measuredAtMs + (real elapsed since measurement)`; see `measuredAtMs`.
 *
 * Returns the SAME object when no open child carries a clock, so the ordinary
 * case — a settled roster, or a plan being read with nothing running — takes no
 * re-render at all.
 */
export function retimeRunDetails(
	details: RunDetails,
	nowMs: number,
): RunDetails {
	const nowSeconds = nowMs / 1000;
	let moved = false;
	const subagents = details.subagents.map((row) => {
		if (row.startSeconds === null || row.settledSeconds !== null) return row;
		const label = clockLabel(row, nowSeconds);
		if (label === row.elapsedLabel) return row;
		moved = true;
		return { ...row, elapsedLabel: label };
	});
	return moved ? { ...details, subagents } : details;
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
 * The failure set an OPEN panel records as read (`§3.3`).
 *
 * `openedWith` is exactly the failures that were on screen at the instant the
 * panel opened, and the rule is that only those are acknowledged: a failure that
 * arrives WHILE the panel is open is not, because the reader may be scrolled
 * down in the plan and never see the row it belongs to — and the dot it keeps is
 * the only thing that will tell them, on the next view, that there is one.
 *
 * `alreadySeen` is carried forward rather than replaced by the snapshot, so a
 * failure whose row leaves the wire for a frame (a roster that sheds, a
 * reconnect that republishes) cannot re-light a dot the user has already read.
 *
 * It is a pure function rather than three lines inside an effect because the
 * claim being made is about a rule, and a rule that lives only in an effect's
 * dependency array cannot be asserted: the version this replaces re-recorded the
 * WHOLE failure set on every change while the panel was open, which marked
 * failures the reader had never been shown as read and cleared the dot when they
 * closed the panel.
 */
export function acknowledgedOnOpen(
	openedWith: readonly string[],
	alreadySeen: SeenFailures = NOTHING_SEEN,
): SeenFailures {
	// Identity is preserved when the snapshot adds nothing, so an open panel that
	// is re-rendered with the same failures does not churn its own state.
	if (openedWith.every((id) => alreadySeen.has(id))) return alreadySeen;
	const next = new Set(alreadySeen);
	for (const id of openedWith) next.add(id);
	return next;
}

/**
 * The failure set a CLOSING panel records as read (`§3.3`).
 *
 * The second half of the dot's promise, and the mirror of `acknowledgedOnOpen`:
 * opening acknowledges the failures that were on screen AT THE OPEN, and closing
 * acknowledges the failures whose ROWS THE PANEL SHOWED while it was open.
 * `shownWhileOpen` is `visibleFailures` accumulated across the open period
 * rather than a snapshot taken at the close, so a failure the reader watched
 * arrive and that a later arrival then displaced is still read.
 *
 * The rule is one sentence, and it is wrong in both directions if either half
 * is dropped: the dot must not claim "you have not looked" about a row the
 * reader has just read, and it must keep claiming it about a row they never saw.
 * A failure behind `+N more` is not in `visibleFailures`, so it keeps its dot
 * for the next view and the trigger's failure clause survives the close with it.
 *
 * It shares `acknowledgedOnOpen`'s union rather than re-implementing it — the
 * carry-forward and the identity-preservation guarantees are the same — so only
 * the set of ids is a rule of its own, and that rule is `visibleFailures`.
 */
export function acknowledgedOnClose(
	shownWhileOpen: readonly string[],
	alreadySeen: SeenFailures = NOTHING_SEEN,
): SeenFailures {
	return acknowledgedOnOpen(shownWhileOpen, alreadySeen);
}

/**
 * Whether any row's clock is still running, which is the ONE condition that
 * justifies a 1Hz timer (`§8`).
 *
 * A settled child is measured against its own `settled_at`, and a child with no
 * launch time shows no duration at all, so neither of them can go stale and
 * neither of them can pay for a timer. Extracted from `useRunDetailsClock` so
 * the predicate is a rule a test can hold rather than a claim in a comment; what
 * remains outside this file is the timer's LIFETIME — that it starts, ticks and
 * is cleared when the panel closes — which is a behaviour, and is exercised live
 * rather than asserted here.
 */
export function hasLiveChildClock(rows: readonly SubagentRow[]): boolean {
	return rows.some(
		(row) => row.startSeconds !== null && row.settledSeconds === null,
	);
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
 * the tally degrades toward the one number that matters. `gone` and an
 * unrecognised word sort last for the same reason: they are rare, quiet, and
 * neither of them is a count the reader acts on.
 */
export function subagentTally(rows: SubagentRow[], maxChars?: number): string {
	const segments: string[] = [];
	for (const status of [
		"running",
		"queued",
		"failed",
		"interrupted",
		"paused",
		"cancelled",
		"done",
		"gone",
		"unknown",
	] as ChildStatus[]) {
		const matched = rows.filter((row) => row.status === status);
		if (matched.length === 0) continue;
		/*
		 * Grouped by the row's own WORD rather than by the folded state, because
		 * an unrecognised word is the wire's and two rows can carry two of them
		 * (`"1 reticulating · 1 frobnicating"`) — one segment saying "2
		 * unrecognised" would be a number the reader cannot trace to a row.
		 */
		const words = new Map<string, number>();
		for (const row of matched) {
			words.set(row.stateWord, (words.get(row.stateWord) ?? 0) + 1);
		}
		for (const [word, count] of words) segments.push(`${count} ${word}`);
	}
	return shedSegments(segments, maxChars);
}

/**
 * The to-dos section's trailing tally: `10 of 14 resolved · 1 dropped`.
 *
 * **`resolved` is closure — done OR dropped — and it is the same notion the
 * phase headers count** (`TodoPhaseView.closed`). One word for one fact, or the
 * section and the headers beneath it disagree: a tally that said `9 of 14 done`
 * over a header reading `4/5` was counting two different things under two
 * spellings, with nothing on screen saying which was which.
 *
 * The `dropped` segment is the breakdown of that closure, not a second count:
 * `resolved` says how much of the plan is finished with, and `dropped` says how
 * much of it was abandoned rather than done. Both facts are worth stating — a
 * plan that quietly abandoned a third of itself should not read like one that
 * completed — which is why the word survives alongside the count that contains
 * it.
 *
 * The TUI's `n/total resolved` is the same claim in a terminal's compression.
 */
export function todoTally(
	details: RunDetails | null | undefined,
	maxChars?: number,
): string {
	if (!details) return "";
	const segments = [
		`${resolvedTodos(details)} of ${details.totalTodos} resolved`,
		...(details.droppedTodos > 0 ? [`${details.droppedTodos} dropped`] : []),
	];
	return shedSegments(segments, maxChars);
}

/**
 * How much of the plan is finished with, in the one sense of "finished with"
 * this surface uses: done plus dropped. The TUI's `RESOLVED_STATUSES`.
 */
export function resolvedTodos(details: RunDetails): number {
	return details.doneTodos + details.droppedTodos;
}

/* ------------------------------------------------------------------ */
/* Overflow                                                            */
/* ------------------------------------------------------------------ */

/**
 * The clock a row is ranked by when ranks tie: when it settled, or when it
 * started if it has not. Both are epoch SECONDS on the wire.
 *
 * The TUI ties by `-index`, and that is correct THERE because `job_ids` is its
 * own list in start order, so a later index IS a later start. It is wrong here:
 * `frontend.jobs` is not append-ordered. QA measured a nine-child live roster as
 * `Hold, Canvas failure, Role, Slow, File inventory, Arithmetic, Broken tier,
 * Quiet window, Clock` — no time order in either direction — because the list is
 * whatever the comms graph and the execution ledgers hand back. Index is not a
 * timestamp, and reading it as one selected an arbitrary subset of settled rows
 * (the two MOST RECENT completions ended up behind `+N more` while the two
 * oldest stayed on screen) and let the list's own order change between frames.
 */
const recencyKey = (row: SubagentRow): number | null =>
	row.settledSeconds ?? row.startSeconds;

/**
 * `b` before `a` when `b` is newer, with no clock at all ordered last.
 *
 * "No clock at all" is the epoch-zero row — a child that never launched
 * (`init`'s own `start_time: 0`) — and it is not a timestamp either: ranking it
 * by the wire's position would reinstate the bug above for exactly the rows that
 * have nothing to be newest BY. It goes after every row that does have a clock,
 * and rows with no clock keep the wire's order between themselves.
 */
const byRecency = (a: SubagentRow, b: SubagentRow): number => {
	const at = recencyKey(a);
	const bt = recencyKey(b);
	if (at !== null && bt !== null) return at === bt ? 0 : bt - at;
	if (at === null && bt === null) return 0;
	return at === null ? 1 : -1;
};

/** Rank, then recency. Stable, so equal rows keep the order they arrived in. */
const byPriority = (a: SubagentRow, b: SubagentRow): number =>
	EVICTION_RANK[a.status] - EVICTION_RANK[b.status] || byRecency(a, b);

/**
 * The rows the roster shows, and how many it had to hide.
 *
 * Ordering is the priority slice's own (`§6.3`): running/queued, then failed,
 * then interrupted, then settled, ties to the NEWEST by the child's own clock.
 * It is applied to the WHOLE roster rather than only to the overflowing one,
 * because a list that reordered the moment a seventh child arrived would reflow
 * under the reader — a defect the design names in the very paragraph that
 * removes the TUI's other reflow (`§2.2`). The TUI itself keeps start order
 * because its DOM is `_sync_rows`'s and reordering it would thrash; a keyed
 * React list has no such constraint, so the rule the slice picks by is the rule
 * the list shows.
 *
 * **A failed row is never shed WHILE THE FAILURES FIT THE CAP.** Rank alone
 * does not guarantee even that: six running children is ordinary
 * (`DEFAULT_MAX_RUNNING_JOBS` is 15), and at a cap of six the failed row — which
 * ranks BELOW running — was the one pushed out. The `danger` dot then promised
 * "a child failed and you have not looked" while the panel it opened could not
 * show which child failed or print its exception, and opening the panel cleared
 * the dot. So failures are reserved first: the quietest visible rows are
 * evicted to make room, one per dropped failure, and the disclosure count
 * reports what is actually hidden rather than what the cap arithmetic would
 * have said. Reserving first rather than appending keeps the displayed order the
 * rank order `§6.3` describes.
 *
 * The reservation is bounded by the cap like everything else on this list, and
 * the bound is stated rather than left to be found: once EVERY kept row is
 * already a failure the walk has no victim left (`victim === -1`, below) and it
 * stops, so eight failures at a cap of six show six of them and hide the two
 * oldest behind `+N more` like any other over-cap rows. That is the arithmetic
 * maximum a six-row cap allows and the disclosure still counts them, but it is
 * not the absolute the earlier wording of this comment claimed — and the dot's
 * promise, once the reader has closed the panel, is redeemed only for the
 * failures the slice showed (`visibleFailures`).
 */
export function visibleSubagents(rows: SubagentRow[]): {
	rows: SubagentRow[];
	hidden: number;
} {
	const ordered = [...rows].sort(byPriority);
	if (ordered.length <= SUBAGENT_ROW_CAP) {
		return { rows: ordered, hidden: 0 };
	}
	const kept = ordered.slice(0, SUBAGENT_ROW_CAP);
	/*
	 * Every settled row keeps a slot only if nothing failed needs one. `kept` is
	 * in rank order, so the LAST non-failed row is the quietest thing on screen
	 * — the one the reader loses least by — and evicting from the tail is what
	 * leaves the order above it untouched. Written as a backward walk rather than
	 * `findLastIndex` because the renderer's `lib` predates it.
	 */
	for (const failed of ordered.slice(SUBAGENT_ROW_CAP)) {
		if (failed.status !== "failed") continue;
		let victim = -1;
		for (let index = kept.length - 1; index >= 0; index--) {
			if (kept[index].status !== "failed") {
				victim = index;
				break;
			}
		}
		if (victim === -1) break;
		kept[victim] = failed;
	}
	kept.sort(byPriority);
	return { rows: kept, hidden: ordered.length - kept.length };
}

/**
 * The failed children the roster's VISIBLE slice puts on screen (`§3.3`).
 *
 * The other half of the `danger` dot's promise, and the reason it is a function
 * here rather than a few lines in the trigger: "a child failed and you have not
 * looked" is answered by which rows the reader could actually see, and the
 * slice that decides that is the same one the panel renders (`visibleSubagents`)
 * — the cap, the reservation and the rank order all apply, so a failure behind
 * `+N more` is not in this list and keeps its dot.
 */
export function visibleFailures(rows: readonly SubagentRow[]): string[] {
	return visibleSubagents([...rows])
		.rows.filter((row) => row.status === "failed")
		.map((row) => row.id);
}

/**
 * The rows the to-dos section shows, and how many it hid.
 *
 * `§6.3`: cap the item rows at `TODO_ITEM_CAP`, **never dropping an open or
 * blocked item**. Within that, the OLDEST closed rows go first — earliest phase
 * first, and within a phase the earlier item first — so a long plan sheds the
 * settled work at its start and keeps its recent end plus every item that is
 * still asking for something.
 *
 * **The direction is load-bearing and is not interchangeable.** Shedding the
 * NEWEST closed rows instead reads as a plan that stopped recording: the recent
 * end is the part a reader is checking against the live work, and a phase that
 * keeps its oldest rows while losing the ones just finished looks like it lost
 * track. It is also what the TUI's own budget does (`todo_panel.py`), which is
 * the model this ports.
 *
 * The hidden rows are attributed per phase rather than only totalled: a plan
 * that went from fourteen rows to ten has to say WHERE the four went, or every
 * phase header below the cut is silently unaccountable to the rows under it.
 *
 * The cap is a ceiling, not a guarantee: ten open items are ten rows, because
 * the alternative is hiding work the user has to act on.
 */
export function visibleTodoPhases(phases: TodoPhaseView[]): {
	phases: TodoPhaseSlice[];
	hidden: number;
} {
	const total = phases.reduce((sum, phase) => sum + phase.items.length, 0);
	if (total <= TODO_ITEM_CAP) {
		return {
			phases: phases.map((phase) => ({ ...phase, hidden: 0 })),
			hidden: 0,
		};
	}

	const isOpen = (item: TodoItemView): boolean =>
		OPEN_TODO_STATUSES.includes(item.status);
	const closedCount = phases.reduce(
		(sum, phase) => sum + phase.items.filter((item) => !isOpen(item)).length,
		0,
	);
	const openCount = total - closedCount;
	const closedBudget = Math.max(0, TODO_ITEM_CAP - openCount);
	// How many of the plan's closed rows fall off the FRONT: the oldest first.
	const shed = Math.max(0, closedCount - closedBudget);

	let seenClosed = 0;
	const slices = phases.map((phase) => {
		const items: TodoItemView[] = [];
		let hidden = 0;
		for (const item of phase.items) {
			if (isOpen(item)) {
				items.push(item);
				continue;
			}
			// A closed row's position in the plan's own closed sequence decides
			// whether it survives, which is what makes the shed oldest-first
			// across phase boundaries rather than per phase.
			const index = seenClosed++;
			if (index < shed) hidden += 1;
			else items.push(item);
		}
		return { ...phase, items, hidden };
	});
	return {
		phases: slices,
		hidden: slices.reduce((sum, phase) => sum + phase.hidden, 0),
	};
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

/**
 * The state word a row carries for a reader who cannot see its icon (`§6.4`).
 *
 * Read off the row rather than derived from the folded status: an unrecognised
 * word's own word is the WIRE's (`SubagentRow.stateWord`), and a table lookup
 * here would announce this model's guess about a state it has just said it does
 * not know.
 */
export function childStateLabel(row: SubagentRow): string {
	return row.stateWord;
}
