import type { TranscriptRecord } from "../../canonical/transcript-reducer";

/**: the arithmetic behind the header popover.
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

/**
 * The action each state of the toggle names.
 *
 * A toggle's accessible name has to say what a press WILL do, so it flips with
 * the pane rather than naming the surface (`§3.3`). The canvas button beside it
 * carries no pressed state and no flipping label because it is a one-way door;
 * this one is not, and a control whose name did not flip would tell a reader
 * that pressing it opens something they are already looking at.
 */
const LABEL_OPEN = "Open run details";
const LABEL_CLOSE = "Close run details";
/**
 * The seam between the action and its first clause.
 *
 * An em dash rather than `CLAUSE_SEAM`'s comma: the clauses are the run's state
 * and the verb is the control's, so this boundary is a different kind of join
 * from the comma between two counts — the same distinction `SEAM` (the counts
 * seam) draws for the tallies.
 */
export const LABEL_SEAM = " — ";

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
	 * `error_text`, the WHOLE thing, on a failed child.
	 *
	 * `errorLine` stays the ROSTER's field — a list row's summary is one line
	 * (`§4.1`) — and this is the reader's, whose outcome block prints the
	 * exception verbatim (`§5.1`). Two fields rather than one because the two
	 * surfaces want different amounts of the same string, and a row that carried
	 * only the full text would make the roster's shed rule a formatting decision
	 * inside a list row.
	 */
	errorText: string | null;
	/**
	 * `result_text`, whole, on a settled child.
	 *
	 * The reader's outcome block renders this instead of reading the child's
	 * transcript for it (`§5.1`): the roster row already carries the outcome, and
	 * the TUI makes the same choice for the same reason.
	 */
	resultText: string | null;
	/**
	 * The child's own durable session directory name, from `session_id`.
	 *
	 * It is the READER's key: the transcript route is addressed by
	 * `(session_id, child_id)` ids and never by a path, so this is what the
	 * reader can hand it. `session_dir` also rides the wire and is deliberately
	 * NOT read — the renderer must never be able to submit a path.
	 */
	childSessionId: string | null;
	/** The job that launched this child, or `null` for a root child. */
	parentJobId: string | null;
	/**
	 * How many children this child launched.
	 *
	 * Derived in the renderer by grouping the session's `task` rows on
	 * `parent_job_id` (`lineage`) rather than read from the wire, because the wire
	 * carries the lineage and not the count: a `childCount` field would be a
	 * second statement of a fact the parent/child edges already make, and two
	 * statements can disagree. Counted over the whole LINEAGE rather than the
	 * roster, so a parent's control counts the descendants the roster does not
	 * list (`§ 4`'s membership rule).
	 */
	childCount: number;
	/** `model_label` — the child's own model, read only by the reader's facts row. */
	modelLabel: string | null;
	/**
	 * The child's authored brief (`§5.1`): `launch_prompts[launch_message_id]`
	 * when the map carries the current launch, else `prompt`.
	 *
	 * `null` when the wire carries neither — a restored row from a runtime that
	 * predates both fields.
	 */
	brief: string | null;
	/**
	 * The launch identity of the CURRENT launch turn, or `""`.
	 *
	 * The reader uses it for ONE decision: whether the durable transcript already
	 * holds that turn. When it does, the row is reconciled in place and the
	 * synthetic brief head is suppressed, because rendering both is what makes a
	 * reader open on a duplicated full role/team/system preamble (`§5.1`).
	 */
	launchMessageId: string;
	/**
	 * Every launch identity in this lineage mapped to its concise authored
	 * prompt — `launch_prompts`, which the runtime stamps with one entry per
	 * collapsed ATTEMPT rather than only the newest.
	 *
	 * That is what makes "every attempt alias is reconciled the same way" need no
	 * second mechanism: `attempt_aliases` names earlier JOBS, and each alias's
	 * launch entry id (`subagent-launch:<job_id>`) is itself a key of this map,
	 * so a row left alone here is a row no alias could have named either.
	 */
	launchPrompts: Readonly<Record<string, string>>;
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
 * `name` is `null` for a phase that renders headerless: the flat single-phase
 * case, and every phase of a mixed plan whose name IS the implicit one (`§6.2`
 * applies the test per phase rather than to the whole plan, because a plan the
 * backend lazily grew an implicit phase in beside a named one used to render a
 * `To-dos` section over a `Todos` phase — the same plan named twice).
 *
 * There is no per-phase count here, and its absence is the fix rather than an
 * omission: the phase header's `n/n resolved` was a partition of the section
 * tally's own number, stated in the same weight one line below it, so the plan
 * measured one closure twice ({@link todoTally}). The TUI's header count exists
 * because its dock HIDES a settled phase after 60s and the count is the only
 * evidence it was complete; this panel hides no phase, so the count had no job.
 */
export type TodoPhaseView = {
	name: string | null;
	items: TodoItemView[];
};

/**
 * A phase as the CAPPED list renders it.
 *
 * `items` are the rows that survived the item cap and `hidden` is how many of
 * this phase's own closed rows it hid, so the disclosure can sit inside the
 * phase that lost them (`§6.3`).
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
	/**
	 * The ROSTER: one row per member (`§ 4`'s membership rule, `rosterMembers`).
	 *
	 * This is what the roster renders, what the tally counts and what the
	 * `danger` dot's ledger is built from — one list, so the three cannot
	 * disagree. It is NOT every `task` row on the wire: a grandchild is a
	 * descendant reachable through its parent's control (`lineage`, below).
	 */
	subagents: SubagentRow[];
	/**
	 * Every `task` row on the wire, members and descendants alike.
	 *
	 * The reader navigates THIS list and never the roster: a path is walked over
	 * `parent_job_id` (`§ 5.5`), and a walk that could only see members would
	 * stop at the first level — taking the breadcrumb's ancestors, the peer
	 * stepper and the `N children` control with it. So the roster is a VIEW of
	 * the lineage (`subagents ⊆ lineage`) and the reader is a walk over it.
	 */
	lineage: SubagentRow[];
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
 * The failures a trigger has already acknowledged, and the same shape for the
 * MCP ledger: two key spaces (failed child job ids, MCP server names) that the
 * one seen-set TYPE serves, each with its own VALUE so the two ledgers cannot
 * acknowledge each other's rows.
 */
export type SeenFailures = ReadonlySet<string>;

/** Acknowledged MCP server names. See `SeenFailures` for why it is a type.
 *
 * A separate value rather than one shared set: a job id and a server name are
 * both strings, and folding them into one set would make "a server called
 * `job-ledger`" able to acknowledge a failed child.
 */
export type SeenMcpProblems = ReadonlySet<string>;

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
		// The bare WORD, which the durable graph's rows can carry: `_describe`
		// returns `queued` as text, and the restored branch copies it onto the row
		// verbatim. The flag is read first (above), so this is the same state
		// arriving the other way — and without this case it fell to `unknown`, a
		// word `_describe` can emit landing on the branch this model reserves for
		// words it has NOT been taught (§3.3).
		case "queued":
			return "queued";
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

/**
 * The wire's own word for a row whose state the fold did NOT recognise (§3.3).
 *
 * Verbatim is a claim about the WORD, not about the bytes: the string is painted
 * in the visible tally and in a row's `sr-only` label, so it goes through the
 * same display boundary as the activity and error lines
 * (`oneLine(firstLine(...))`) — a word carrying a newline or a control character
 * would otherwise break both lines.
 *
 * Flattening alone is not enough, because the fold reads the WHOLE raw string
 * while the word is its first line: `"done\u0000"` folds to `unknown`, and the
 * surviving `done` would then be a RECOGNISED state word on a row drawn as the
 * question mark — with the tally's `1 done` stating exactly the count
 * `foldStatus` reserves for words it has not been taught. So a sanitised word is
 * kept only when the fold does not recognise it either, which is the rule that
 * keeps a row's word and its mark saying the same thing. A word with nothing
 * readable left in it takes the union's own name for the state (`"unknown"`),
 * which is what the row's mark already says.
 */
const unrecognisedStateWord = (rawStatus: string): string => {
	const sanitised = oneLine(firstLine(rawStatus));
	return sanitised !== "" && foldStatus(sanitised, false) === "unknown"
		? sanitised
		: "unknown";
};

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
	const fullErrorText = wireText(job.error_text).trim();
	const fullResultText = wireText(job.result_text).trim();
	const launchPrompts = toWireStringMap(job.launch_prompts);
	const launchMessageId = wireText(job.launch_message_id);
	const rawPrompt = wireText(job.prompt).trim();

	return {
		id,
		label,
		role,
		status,
		// The band's word for a state this model knows; the wire's own word for one
		// it does not (`SubagentRow.stateWord`) — sanitised, and refused when the
		// sanitised text is itself a state the fold recognises
		// (`unrecognisedStateWord`).
		stateWord:
			status === "unknown"
				? unrecognisedStateWord(rawStatus)
				: CHILD_STATE_WORD[status],
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
		// The failure's WHOLE text and the settled run's whole result: the reader's
		// outcome block prints either verbatim (`§5.1`), which is why these are not
		// derived from `errorLine`. `error_text` is NOT gated on the folded status:
		// a runtime whose word this renderer does not recognise still failed, and
		// the reader must be able to show why.
		errorText: fullErrorText || null,
		resultText: fullResultText || null,
		childSessionId: wireText(job.session_id) || null,
		parentJobId: wireText(job.parent_job_id) || null,
		// Filled in by `deriveRunDetails`, which is the layer that can see the
		// whole roster: a row cannot count its own children.
		childCount: 0,
		modelLabel: wireText(job.model_label) || null,
		// `frontend_state.py:1413`, `:1461-1486`: the authoured prompt of the
		// CURRENT launch when the map carries it, else the row's own `prompt`.
		// The brief is ABSENT rather than empty when the wire reported neither: an
		// empty string renders a folded block with one blank row, which claims the
		// parent delegated nothing in as many words.
		brief: launchPrompts[launchMessageId] ?? (rawPrompt || null),
		launchMessageId,
		launchPrompts,
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

const deriveTodoPhase = (phase: unknown): TodoPhaseView => {
	const record = isRecord(phase) ? phase : {};
	const rawItems = Array.isArray(record.items) ? record.items : [];
	return {
		// Headerless whenever the phase is not NAMED — the implicit phase the
		// backend lazily creates is the one whose name would restate the section
		// label immediately above it (`§6.2`). Applied per PHASE rather than to the
		// whole plan: the single-phase case this used to cover is the same case, and
		// a plan that mixes the implicit phase with a named one now folds only the
		// implicit half instead of heading a `Todos` phase with `To-dos`.
		name: isNamedPhase(phase) ? wireText(record.name) : null,
		items: rawItems.map(deriveTodoItem),
	};
};

/**
 * A wire `Record<string, string>`, ignoring anything that is not a string.
 *
 * `launch_prompts` is `dict[str, str]` on this runtime and a plain object on a
 * newer one; a value the renderer cannot use is dropped rather than coerced, so
 * a malformed map degrades to "no reconciliation" — which the reader treats as
 * "keep the brief and whatever the transcript holds", the safe direction.
 */
const toWireStringMap = (value: unknown): Record<string, string> => {
	if (!isRecord(value)) return {};
	const map: Record<string, string> = {};
	for (const [key, entry] of Object.entries(value)) {
		if (key && typeof entry === "string") map[key] = entry;
	}
	return map;
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

	/*
	 * The wire's rows are an execution snapshot, not a roster.
	 *
	 * `frontend.jobs` is `comms.job_rows()`, which walks the ROOT session's job
	 * manager AND every live child's (`harness/comms.py:799-815`) — so the list
	 * carries, beside the delegated children, the parent's own tool jobs and each
	 * child's own tool calls, all minted by the same ledger as the task rows. A
	 * roster that painted them answered "which sub-agents are running" with the
	 * one child's `bash` call (round 1, Q1/U1-4: `2 running` over a single
	 * delegation, with the bash row sorted above the child it belonged to), and
	 * the same list inflated the tally.
	 *
	 * The discriminator is the row's own `type`, which the wire already stamps,
	 * and the vocabulary is exactly two words: `JobType = Literal["bash",
	 * "task"]` (`harness/jobs.py:216`). A delegated child's row is `task`
	 * (`harness/subagent.py:546`), and EVERY tool row is `bash` — not the tool's
	 * name. A background `eval` registers as `bash` deliberately, because a
	 * settled job's completion is auto-delivered only for types in
	 * `("task", "bash")` and a third literal would silently strip that delivery
	 * (`tools/eval.py:938-945`); the label carries the distinction instead
	 * (`bash: <command>`, `tools/builtin.py:2187`). And a foreground `read` never
	 * gets a row at all: the only two register paths a tool call has are the
	 * shell's own detach moments (`tools/builtin.py:2250`, `:2306`). So a
	 * non-member row is always a `bash` row here, and the filter below is the one
	 * place that has to know it. (Round 3, R3-1: this comment said "the tool's
	 * name (`bash`, `read`, …)", which describes rows the runtime cannot
	 * produce.)
	 *
	 * Membership is therefore a filter on `type` — NOT on `agent_role`, which is a
	 * display field whose default value `task` is suppressed, and NOT on
	 * `session_id`, which a restored row can lack while still being a real child.
	 *
	 * A row with NO `type` at all is kept. Every `JobState` this wire has shipped
	 * carries one, so the case is a runtime this renderer has not met; keeping the
	 * row shows a child that a stricter filter would hide, and the failure this
	 * rule exists to stop is over-reporting work, not losing it.
	 */
	const taskRows = jobs
		.filter((job) => {
			const type = wireText(job.type);
			return type === "" || type === "task";
		})
		.map((job) => deriveChild(job, nowSeconds));
	/*
	 * `childCount` is the parent/child edges counted over the WHOLE lineage — see
	 * `SubagentRow.childCount` for why it is derived rather than read, and
	 * `rosterMembers` below for why the count and the roster are two different
	 * questions about the same edges.
	 */
	const childrenByParent = new Map<string, number>();
	for (const row of taskRows) {
		if (!row.parentJobId) continue;
		childrenByParent.set(
			row.parentJobId,
			(childrenByParent.get(row.parentJobId) ?? 0) + 1,
		);
	}
	const lineage = taskRows.map((row) => ({
		...row,
		childCount: childrenByParent.get(row.id) ?? 0,
	}));
	const roster = rosterMembers(lineage);
	// The implicit phase is folded per PHASE (`§6.2`), which is `deriveTodoPhase`'s
	// own rule now: it needs no whole-plan flag.
	const todos = rawTodos.map(deriveTodoPhase);
	const items = todos.flatMap((phase) => phase.items);

	return {
		subagents: roster,
		lineage,
		todos,
		openChildren: roster.filter((row) => !isSettled(row.status)).length,
		failedChildIds: roster
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
 * Which of the session's `task` rows the ROSTER owns (`§ 4`'s membership rule).
 *
 * A roster member is a `task` row whose PARENT is not itself a task row on the
 * wire: its parent is the session, so it launched from the top level. A row
 * whose parent IS present launched from another child and is a DESCENDANT — a
 * grandchild. Painting it as a top-level row double-reported the same work in
 * the tally and beside its own parent (round 1, Q2), and `job-5`'s `N children`
 * control is the documented way to reach it (`§ 5.5`).
 *
 * The absent-parent test rather than `parent_job_id == null`, and the difference
 * is real rather than defensive: `comms.job_rows()` returns a child's raw
 * `parent_job_id` when the record it names is no longer in the graph
 * (`_record(...) is None`, `harness/comms.py:800-812`), and resumed attempts
 * have their predecessor ids dropped from the snapshot entirely
 * (`key not in self._aliases`). A row whose parent is not in the list has no
 * control anywhere that could reach it, so it is a member by construction —
 * which is also why this is expressed as a question about the LIST rather than
 * about the row alone.
 */
const rosterMembers = (lineage: readonly SubagentRow[]): SubagentRow[] => {
	const ids = new Set(lineage.map((row) => row.id));
	return lineage.filter(
		(row) => row.parentJobId === null || !ids.has(row.parentJobId),
	);
};

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
	const subagents = retimeRows(details.subagents, nowMs);
	const lineage = retimeRows(details.lineage, nowMs);
	return subagents === details.subagents && lineage === details.lineage
		? details
		: { ...details, subagents, lineage };
}

/** One row, re-measured at `nowMs`; returns the same row when nothing moved. */
export function retimeChildRow(row: SubagentRow, nowMs: number): SubagentRow {
	if (row.startSeconds === null || row.settledSeconds !== null) return row;
	const label = clockLabel(row, nowMs / 1000);
	return label === row.elapsedLabel ? row : { ...row, elapsedLabel: label };
}

/**
 * A list of rows re-measured, identity-preserving in BOTH directions.
 *
 * It returns the same ARRAY when no row moved, which is what keeps
 * `retimeRunDetails` on the no-re-render path, and the same ROW objects for the
 * rows that did not move, which keeps a memoised row from repainting beside one
 * that had to.
 */
const retimeRows = (rows: SubagentRow[], nowMs: number): SubagentRow[] => {
	let moved = false;
	const next = rows.map((row) => {
		const retimed = retimeChildRow(row, nowMs);
		if (retimed !== row) moved = true;
		return retimed;
	});
	return moved ? next : rows;
};

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
 * The failure set a panel that is OPEN acknowledges, continuously (`§3.4`).
 *
 * The rule, in one sentence: **while the panel is open, every failed child whose
 * row is in the rendered slice is acknowledged; when it is closed, nothing is.**
 *
 * `shown` is the rendered slice — `onScreenFailures` over `panelSlice` — and it
 * is accumulated rather than replaced, so a failure whose row leaves the slice
 * for a frame (a roster that sheds, a reconnect that republishes) cannot re-light
 * a dot the reader has already read.
 *
 * **What this replaces, and why the old pair is gone rather than ported.** The
 * popover's rule was bound to two INSTANTS (`acknowledgedOnOpen` at the open,
 * `acknowledgedOnClose` at the close) because opening a transient surface is an
 * event. A persistent pane is not opened, so the transitions have no successor
 * in that shape and both functions are deleted. What survives untouched is the
 * question they were both asked — `onScreenFailures`, the slice the panel
 * actually renders — and `accumulateSeen`, the union they both performed.
 *
 * The property the old design protected is preserved: a failure that arrives
 * while the panel is open and IS in the slice is acknowledged because it is
 * genuinely on screen, which is what the dot claims. The old objection ("the
 * reader may be scrolled down in the plan") was an argument about a popover that
 * could place a row outside the viewport; the roster is the panel's scroll owner
 * and a row in its slice is a row in the list it scrolls.
 *
 * It is a pure function rather than three lines inside a component because the
 * claim being made is about a RULE, and a rule that lives only in a render
 * cannot be asserted — which is exactly how the version this replaces recorded
 * the whole failure set on every change while the panel was open and marked
 * failures the reader had never been shown as read.
 */
export function acknowledgeWhileOpen(
	shown: readonly string[],
	alreadySeen: ReadonlySet<string> = NOTHING_SEEN,
): ReadonlySet<string> {
	return accumulateSeen(alreadySeen, shown);
}

/**
 * Add ids to a seen set, handing back the SAME set when nothing is new.
 *
 * The union every acknowledgement performs, named once because four call sites
 * need it and they have to agree: the failure ledger's continuous
 * acknowledgement, the MCP ledger's, and the tests that pin both. A second
 * implementation beside this one is how the two instants drifted in the first
 * place — the open half was asking a different question from the close half
 * (`onScreenFailures`).
 *
 * It takes the bare `ReadonlySet<string>` rather than `SeenFailures` because the
 * MCP ledger is the same TYPE over a different KEY SPACE: failed child job ids
 * and MCP server names. Sharing the union is safe; sharing the VALUE would not
 * be, which is why each ledger keeps its own set.
 *
 * The identity guarantee is load-bearing rather than tidy: handing back the SAME
 * set when an acknowledgement adds nothing is what lets React bail out of the
 * state update instead of re-rendering the header for a change that did not
 * happen.
 */
export function accumulateSeen(
	previous: ReadonlySet<string>,
	added: readonly string[],
): ReadonlySet<string> {
	if (added.every((id) => previous.has(id))) return previous;
	const next = new Set(previous);
	for (const id of added) next.add(id);
	return next;
}

/**
 * Whether any row's clock is still running, which is the ONE condition that

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
 * Whether the session has anything OUTSTANDING at all.
 *
 * **No longer a visibility predicate.** The trigger is gated on `details !== null`
 * alone (`§3.3`): a persistent pane's button is not raised by work, it is simply
 * there in a canonical session, so this stopped deciding whether that button
 * exists. What it still answers — "is anything asking for something right now?"
 * — is a fact the PANEL states instead, and the panel's quiet state is the only
 * place it is read (`run-details-panel.tsx`).
 *
 * Settled work alone does not make it true: a finished roster is history, and
 * history lives in the transcript.
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

/**
 * Replace the child's durable launch turns with their concise authored prompts.
 *
 * The port of `SubagentView._chronological_entries` (`subagent_view.py:2520-2570`),
 * and its reason is the one recorded there: the durable launch row carries the
 * full role/team/system preamble, so a reader that does not reconcile it opens
 * on a wall of wrapper text instead of on what the parent actually asked for.
 *
 * The match is a STRING IDENTITY: a durable user row's entry id is the launch's
 * message id (`session/transcript.py:656-672`), and `launch_prompts` holds one
 * entry per collapsed ATTEMPT — so "every attempt alias is reconciled" needs no
 * second lookup here, because each alias's own `subagent-launch:<job_id>` id is
 * already a key of this map.
 *
 * A child whose record predates `launch_message_id` matches nothing and keeps
 * both its brief and whatever the transcript holds. That is the TUI's own chosen
 * failure mode: duplicating wrapper text is safer than rewriting a user row the
 * map cannot actually vouch for.
 *
 * Identity is preserved when nothing matched, because the reader hands the
 * result to a memoised transcript renderer and a fresh array every render would
 * repaint every row for no change.
 */
export function reconcileLaunchTurns(
	records: TranscriptRecord[],
	launchPrompts: Readonly<Record<string, string>>,
): TranscriptRecord[] {
	let changed = false;
	const next = records.map((record) => {
		if (record.kind !== "user") return record;
		const concise = launchPrompts[record.id];
		if (concise === undefined || concise === record.text) return record;
		changed = true;
		return { ...record, text: concise };
	});
	return changed ? next : records;
}

/**
 * Whether the transcript already carries the brief, so the reader does not say it
 * twice.
 *
 * It usually does. `launch_prompts` holds the CONCISE authored prompt, the same
 * string `row.brief` is read from (`§5.1`), and `reconcileLaunchTurns` rewrites the
 * durable launch row with it — so in the ordinary case the instruction is already
 * on screen, in its own chronological place, as a normal user turn. Rendering the
 * brief block above it put the same sentence in the pane twice, 12px mono and
 * 14px prose apart (`reader-resumed`), which is the sort of near-duplication that
 * reads as a rendering fault rather than as emphasis.
 *
 * The brief block is therefore the FALLBACK: it renders when the transcript does
 * not already say it — a child whose record predates `launch_message_id` and
 * matched no launch row, exactly the case `reconcileLaunchTurns` documents.
 * Comparing the RECONCILED list (not the raw one) is what makes this agree with
 * what is painted; comparing the brief against the raw rows would keep the block
 * for a preamble the reader never renders.
 *
 * Whitespace-insensitive comparison, because a trailing newline in a stored
 * prompt is not a difference a reader can see — and NOT plain equality, because
 * the wire ABBREVIATES `launch_prompts`. Measured: the live pairing behind
 * `docs/evidence/chat-run-panel-live/README.md` delivered a 201-character entry
 * ending `…` where the row's own `prompt` carries all 264, so the reconciled
 * launch row is a TRUNCATED copy of the brief and equality failed on two strings
 * that say the same thing — the duplication this rule exists to prevent, back
 * through the one path it did not cover. A record whose whole text is a prefix
 * of the brief is that same instruction.
 */
export function briefIsInTranscript(
	records: readonly TranscriptRecord[],
	brief: string | null,
): boolean {
	const wanted = normalizeBrief(brief);
	if (!wanted) return false;
	return records.some((record) => {
		// Only a USER turn can be the launch: an assistant quoting the
		// instruction back at itself is not the instruction.
		if (record.kind !== "user") return false;
		const painted = normalizeBrief(record.text);
		if (!painted) return false;
		if (painted === wanted) return true;
		const head = painted.replace(BRIEF_TRAILING_ELLIPSIS, "").trim();
		// A short prefix is a coincidence (`Run`, `Check the`), not a copy of the
		// same instruction: the floor is what stops a two-word record from
		// silencing a paragraph the reader still needs.
		return head.length >= BRIEF_PREFIX_FLOOR && wanted.startsWith(head);
	});
}

/*
 * Top-level literals, not inline ones: the project's linter asks for it, and the
 * reason is real rather than stylistic — a regex constructed per call in a
 * function the roster calls per row is a per-row allocation for a constant.
 */
const BRIEF_WHITESPACE = /\s+/g;
const BRIEF_TRAILING_ELLIPSIS = /…+$/;

/** Whitespace-insensitive: two copies of one instruction may wrap differently. */
const normalizeBrief = (text: string | null): string =>
	(text ?? "").replace(BRIEF_WHITESPACE, " ").trim();

/** Shortest prefix that counts as the same instruction (see the rule above). */
const BRIEF_PREFIX_FLOOR = 32;

/**
 * How many lines of the brief are shown before the expander offers the rest.
 *
 * A handful rather than a fixed height: the block is the child's authored
 * instruction, and the design's requirement is only that it reads as a head
 * block and states what expanding would cost (`§5.1`). The TUI states the count
 * for the same reason — `⟨expand⟩` alone cannot tell two more lines from fifty.
 */
export const BRIEF_PREVIEW_LINES = 6;

/** The brief, folded to a summary plus the number of lines withheld. */
export function foldBrief(
	text: string | null,
	maxLines = BRIEF_PREVIEW_LINES,
): { lines: string[]; hidden: number } {
	const lines = (text ?? "").split("\n");
	if (lines.length <= maxLines) return { lines, hidden: 0 };
	return { lines: lines.slice(0, maxLines), hidden: lines.length - maxLines };
}

/* ------------------------------------------------------------------ */
/* MCP servers                                                         */
/* ------------------------------------------------------------------ */

/**
 * The transport states `mcp/manager.py:1330-1341` can report, plus the cold
 * facade's `cold`, which is not a transport state at all: it says no runtime is
 * attached, so there is nothing to be connected TO rather than something wrong.
 *
 * `auth-required` is deliberately its own state on the wire because its fix
 * differs from a dead process's, and a server the operator cannot authenticate
 * is exactly the failure they reported as invisible.
 */
export type McpStatus =
	| "connected"
	| "connecting"
	| "auth-required"
	| "disconnected"
	| "cold";

/**
 * The states that are NOT problems, stated as a negative (`§ 7.3`).
 *
 * The predicate is written as a negation rather than as a positive list of
 * problems, and the reason is the TUI band's own recorded bug on this same data:
 * its `== "failed"` test "only ever matched the projection's own placeholder …
 * so an auth-blocked server projected as `auth-required` and this band stayed calm
 * while the owner's went red" (`tui/app.py:8498-8504`), and `_mcp_status`'s
 * docstring (`:14650`) states the rule the fix adopted: *"Every TERMINAL
 * non-connected state is a failure, named as a negative rather than as equality
 * with "disconnected": the status vocabulary grew `auth-required`, and an
 * equality test on the old string silently stops counting a server whose grant
 * expired."* A two-word positive list has that same defect one vocabulary change
 * later, and the operator's complaint is a MISSED problem: a spurious dot costs
 * one glance and self-clears when the panel is opened, while a missed one is
 * invisible forever.
 *
 * `connecting` is not a problem: the startup gate leaves slow OAuth servers here
 * on every launch, and lighting for it would make a red lamp the normal boot. A
 * queued child is not a failed one, and the same ladder applies. `cold` is not
 * either — no runtime is attached, which is a fact about the session rather than
 * a fault of the server.
 *
 * An unrecognised word IS a problem, and stays QUIET while taking attention: the
 * renderer must not claim a `danger` failure it cannot name (see `MCP_INK`'s
 * fallback in `run-detail-mcp.tsx`), and the two refusals agree on the thing that
 * matters, which is never to claim the GOOD state. `foldStatus` refuses to call
 * an unrecognised child status `done` for the same reason.
 */
const MCP_NOT_A_PROBLEM: readonly string[] = [
	"connected",
	"connecting",
	"cold",
];

/**
 * The one-line remedy per KNOWN problem state, and why it is a hint rather than
 * a control (`§ 7.2`).
 *
 * The panel is a live VIEW: it must not grow a reauth button, and the control
 * stays where the configuration lives — `settings/components/mcp-management-section.tsx`,
 * which is the only surface that can act on a server. The hints name that
 * surface's own controls (`Grant account access`, `Reconnect`), because a fix a
 * reader cannot find in the UI is not a hint.
 *
 * There is deliberately NO entry for an unrecognised word: a fix for a word this
 * build cannot name would be a guess, and a guess is worse than the quiet
 * unknown row that does still take attention.
 */
const MCP_HINT: Record<string, string> = {
	"auth-required": "Grant this server account access in Settings",
	disconnected: "Reconnect this server in Settings",
};

/** One configured MCP server, as the panel's MCP section renders it. */
export type McpServerRow = {
	name: string;
	/**
	 * The wire's own status word, VERBATIM.
	 *
	 * A word this renderer has not been taught is carried through rather than
	 * folded, because folding it is how a broken server comes to read as a
	 * working one — the failure the operator reported.
	 */
	status: string;
	/** Whether this row is asking for something (see `MCP_PROBLEM_STATUSES`). */
	problem: boolean;
	/** `tool_count`, on a connected server only; `null` when nothing reported it. */
	toolCount: number | null;
	/**
	 * The quiet qualifier: the config's owned scope, else the source it came from.
	 *
	 * One string rather than two because both answer the same reader question —
	 * "where is this server configured?" — and a row that printed both would spend
	 * its scarcest column on a distinction only the settings page acts on.
	 */
	scope: string | null;
	/** The one-line remedy on a problem row, `null` on every other state. */
	hint: string | null;
	/**
	 * The wire's own failure text for this server, when the read carries one.
	 *
	 * `mcp.list` does NOT carry it — `MCPDesktop.snapshot()` publishes name,
	 * status, tool count and config, and nothing else — so this comes from the
	 * canonical projection's `frontend.mcp_servers[].error`
	 * (`frontend_state._mcp_state`, fed from `mcp_startup.failures`), which is the
	 * only place the runtime states WHY a server failed to come up: QA's dead
	 * command produced `[Errno 2] No such file or directory: '/nonexistent/…'`
	 * and the pane offered a reconnect hint instead (round 1, U1-8).
	 *
	 * That projection is otherwise a CHANGE SIGNAL and never a rendering source
	 * (`use-mcp-servers.ts`: it can be minutes stale and cannot build this row).
	 * The error is the one field it can state and this read cannot, so it is
	 * rendered — but only on a row the RENDERED read already calls a problem, so
	 * a startup failure cannot contradict a live `connected`.
	 */
	errorText: string | null;
};

/**
 * Fold the `mcp.list` payload's server rows (`mcp/desktop.py:127-152`).
 *
 * Deliberately tolerant, like `deriveRunDetails`: this is JSON off a backend
 * that may be older or newer than the renderer, so a row missing every field
 * still renders as a named server in an unknown state rather than throwing.
 *
 * A row with NO NAME is dropped instead: it cannot be pointed at, and a nameless
 * "problem" would light a dot no surface could ever acknowledge.
 *
 * Sorted by name so the list is stable across refetches — the payload's own
 * order is config load order, which shifts as configuration is edited, and a
 * section that reorders itself every 15 s is a section nobody can read.
 */
export function deriveMcpServers(
	rows: unknown,
	/**
	 * The canonical projection's per-server failure text, keyed by name.
	 *
	 * Optional, and absent from every caller that has no canonical session (the
	 * story set, the legacy path): a row then falls back to its remedy line, which
	 * is the behaviour this section shipped with.
	 */
	errors: Readonly<Record<string, string>> = {},
): McpServerRow[] {
	return toWireList(rows)
		.map((row) => {
			const name = wireText(row.name);
			if (!name) return null;
			// `cold` is the documented default for a payload that does not say: it
			// claims nothing about a server it knows nothing about, where a default of
			// `connected` would be a lie and `disconnected` a false alarm.
			const status = wireText(row.status) || "cold";
			const problem = !MCP_NOT_A_PROBLEM.includes(status);
			return {
				name,
				status,
				problem,
				// Only a connected server has a meaningful tool count: a disconnected
				// one reports the tools its last session knew about, and printing that
				// beside `disconnected` would claim tools that are not reachable.
				toolCount: status === "connected" ? wireNumber(row.tool_count) : null,
				// `owned_scope` is the field the route actually sends (`§ 7.1`: the
				// Settings section reads a `scope` key that does not exist on this
				// payload, and that bug is deliberately not copied here). The fallback is
				// the source config's BASENAME: a full path in the qualifier column would
				// spend the row's widest segment on something the reader cannot act on,
				// and its tail is the only part that says which file it came from.
				scope: wireText(row.owned_scope) || sourceBasename(row.source) || null,
				hint: problem ? (MCP_HINT[status] ?? null) : null,
				// Renderable only on a problem row: see the field's own note for why a
				// stale startup failure must not sit under a healthy word.
				errorText: problem ? wireText(errors[name]) || null : null,
			};
		})
		.filter((row): row is McpServerRow => row !== null)
		.sort((a, b) => a.name.localeCompare(b.name));
}

/** Both separators, at module level: a regex literal inside the function would be
 * rebuilt per call, which is the lint rule this satisfies (`useTopLevelRegex`). */
const PATH_SEPARATORS = /[\\/]/;

/** The last path segment of a config source, or `""` when there is none.
 *
 * The qualifier column wants `mcp.json`, not
 * `/Users/someone/.local-operator/mcp.json`: a full path spends the row's widest
 * segment on something the reader cannot act on, and its tail is the only part
 * that says which file the server came from.
 */
const sourceBasename = (value: unknown): string => {
	const source = wireText(value);
	if (!source) return "";
	const parts = source.split(PATH_SEPARATORS);
	return parts[parts.length - 1] ?? "";
};

/**
 * Whether the whole payload is the cold facade's.
 *
 * The route's cold branch stamps `"status": "cold"` on every configured server
 * and `cold: true` on the envelope (`desktop_lifecycle.py:111-134`), so the rows
 * already say it and the envelope's flag cannot disagree with them — both come
 * from the same branch. Reading it off the rows avoids threading a second field
 * through the hook, the page and the pane for a fact the rows carry.
 *
 * It matters because `cold` is the SECTION's state rather than the row's: a
 * per-row status column would print one jargon word N times, and the tally would
 * read `0 of N connected`, which claims three servers are down when in truth none
 * was asked to be up.
 */
export function mcpServersAreCold(rows: readonly McpServerRow[]): boolean {
	return rows.length > 0 && rows.every((row) => row.status === "cold");
}

/**
 * The canonical projection's per-server failure text, keyed by name.
 *
 * The DIAGNOSIS half of an MCP problem row (`McpServerRow.errorText`), and the
 * only field of `frontend.mcp_servers` this pane renders: `mcp.list` reports
 * status, tool count and config and nothing about WHY a server is down, while
 * the canonical state carries the runtime's own failure strings from
 * `mcp_startup.failures` (`frontend_state._mcp_state`). Without it the section
 * offered a remedy that cannot work for a server broken by its own command
 * (round 1, U1-8).
 *
 * Names with no error are absent rather than empty, so a lookup miss and an
 * empty failure are the same thing to the caller — there is nothing to print
 * either way. The projection is otherwise a CHANGE SIGNAL and not a rendering
 * source (it can be minutes stale), so nothing else from it is carried here.
 */
export function mcpErrorTexts(rows: unknown): Record<string, string> {
	const out: Record<string, string> = {};
	for (const row of toWireList(rows)) {
		const name = wireText(row.name);
		const error = wireText(row.error);
		if (name && error) out[name] = error;
	}
	return out;
}

/**
 * The MCP section's trailing tally, in the model because the TRIGGER already
 * counts the same servers there and the two must not disagree.
 *
 * Same grammar as its two sibling sections (label left, quiet right-aligned
 * tally) and its own rule: the connected count against the whole list, plus the
 * problem count when there is one. Those are two different facts rather than one
 * restated — `connecting` is neither connected nor a problem, so the healthy
 * count does not imply the problem count — which is why `§ 6.2`'s
 * de-duplication argument does not apply here.
 *
 * The problem clause AGREES with the trigger's own label, and the agreement is
 * enforced by construction rather than by two spellings that happen to match:
 * `runDetailTriggerLabel` says `1 MCP server needs attention` while this section
 * said `1 need attention` for the same server (round 1, U1-7/Q7) — one count,
 * two spellings, one of them ungrammatical, on the two surfaces a single reader
 * sees together. Both now call `attentionClause`/`attentionVerb` below, which is
 * the only place the verb is chosen (round 3's last nit).
 */
export function mcpTally(rows: readonly McpServerRow[]): string {
	if (mcpServersAreCold(rows)) return MCP_COLD_LINE;
	const connected = rows.filter((row) => row.status === "connected").length;
	const problems = rows.filter((row) => row.problem).length;
	const base = `${connected} of ${rows.length} connected`;
	if (problems === 0) return base;
	return `${base} · ${attentionClause(problems)}`;
}

/**
 * The cold sentence, and why it replaces the tally rather than annotating it.
 *
 * With no runtime attached there IS no status to report, so the section shows
 * which servers are CONFIGURED — worth having on its own — and says plainly that
 * nothing was checked. It is one line for the whole section because the route's
 * cold branch stamps `status: "cold"` on EVERY row, so a per-row word would
 * print one jargon term N times and the tally would read `0 of N connected`,
 * claiming three servers are down when none was asked to be up. It lights no
 * dot, because nothing is wrong.
 */
export const MCP_COLD_LINE =
	"No session is running — server status cannot be checked.";

/** Every MCP name that is asking for something right now. */
export function mcpProblemNames(rows: readonly McpServerRow[]): string[] {
	return rows.filter((row) => row.problem).map((row) => row.name);
}

/**
 * The MCP ledger's whole rule, in one pure function: **prune, then union**.
 *
 * `seen' = seen ∩ problems(rows)`, and then the rows on screen are acknowledged.
 *
 * The prune is the RE-ARM rule (`§ 7.3`) and it exists because this ledger's key
 * space is one that RECURS: a server NAME outlives the problem. A server
 * acknowledged while `auth-required`, whose grant is later repaired and which
 * then breaks again, would stay silent forever under `accumulateSeen`'s
 * union-never-subtract rule — and that failure is invisible by construction,
 * since no frame of a correctly-quiet dot can distinguish "acknowledged" from
 * "never re-armed". `auth-required` is re-checked on the backend's own 60s clock
 * (`AUTH_REVALIDATE_INTERVAL_S`), so a heal-and-break-again cycle is ordinary,
 * not hypothetical.
 *
 * The CHILD ledger needs no such rule and the asymmetry is not an oversight: a
 * job id names one EPISODE, so a set that never subtracts is exactly right for
 * it.
 *
 * The caller evaluates this only while the list is on screen (`§ 3.4`), so a
 * reader covering the section neither acknowledges nor prunes — the set is left
 * exactly as the reader found it.
 */
export function acknowledgeMcpWhileShown(
	rows: readonly McpServerRow[],
	seen: ReadonlySet<string> = NOTHING_SEEN,
): ReadonlySet<string> {
	const problems = mcpProblemNames(rows);
	const stillBroken = new Set(problems.filter((name) => seen.has(name)));
	const next = accumulateSeen(stillBroken, problems);
	/*
	 * Hand back the CALLER's set when nothing changed — no new problem, nothing
	 * pruned. The identity guarantee is the same one `accumulateSeen` makes and for
	 * the same reason: the trigger updates state during its own render, so a fresh
	 * set on the ordinary evaluation (the rows did not move) would re-render the
	 * header on every frame for a status nobody learned.
	 */
	if (next.size === seen.size && [...next].every((name) => seen.has(name))) {
		return seen;
	}
	return next;
}

/**
 * The MCP rows that are asking for something and nobody has looked at yet.
 *
 * The failure dot's rule (`§ 3.4`) applies unchanged, over this key space. The
 * rendered slice and the whole set are the same list here: the MCP section has NO
 * CAP (`§ 7.2`), because a cap is an answer to an unbounded stream of children
 * rather than to the finite servers a user configured — and a cap here would put
 * a problem behind a control.
 */
export function unseenMcpProblems(
	rows: readonly McpServerRow[],
	seen: ReadonlySet<string> = NOTHING_SEEN,
): string[] {
	return rows
		.filter((row) => row.problem && !seen.has(row.name))
		.map((row) => row.name);
}

/** Whether the MCP section has a problem nobody has looked at. */
export function hasUnseenMcpProblem(
	rows: readonly McpServerRow[],
	seen: ReadonlySet<string> = NOTHING_SEEN,
): boolean {
	return unseenMcpProblems(rows, seen).length > 0;
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
 * The header's own paddings (`px-3`) plus the 8px gap between the label and the
 * tally: the fixed steal every tally pays before its own text. */
const TALLY_CHROME_PX = 12 + 8 + 12;

/**
 * `Subagents` at `text-meta` — the WIDER of the two section labels (`To-dos` is
 * the other), so one budget fits both sections.
 */
const TALLY_LABEL_PX = 66;

/**
 * The advance of one `text-meta` character in the average tally string.
 *
 * Measured, not chosen: the committed `chat-run-panel/narrow-800` frame draws
 * `2 running · 1 queued · 1 failed · 1 interr…` across x562-784, i.e. 222px for
 * 43 characters = 5.16px. Rounded UP to 6px so the budget errs short — an
 * under-budget sheds one whole segment earlier, while an over-budget is the
 * mid-word ellipsis this exists to prevent.
 */
const TALLY_CHAR_PX = 6;

/**
 * The pane's default width, mirrored from `ui-preferences-store`'s
 * `DEFAULT_RUN_PANEL_WIDTH`.
 *
 * Duplicated rather than imported, and this is the only place the duplication is
 * acceptable: importing the store here would drag zustand into a module that is
 * otherwise pure arithmetic — the module the model test bundles and runs without
 * a DOM — to obtain one number the CALLER always has. The real width is passed in
 * by the pane (`chat-content.tsx`), so this is only the fallback for a width that
 * is not a usable number at all.
 */
const FALLBACK_PANE_PX = 420;

/**
 * How many characters a section's trailing tally may occupy, from the PANE's own
 * width.
 *
 * The pane is resizable (320/420/640, `§ 8`), so a budget pinned to the default
 * was wrong at the pane's own floor: `subagentTally`'s 48 characters fit 420px
 * and burst 320px, where the CSS `truncate` then cut the value mid-word
 * (`… 1 interr…`) — the failure clause shedding exists to prevent, arriving
 * through the one path shedding does not cover.
 *
 * A width that is not a finite positive number falls back to the design's
 * default rather than propagating: `Math.max(1, NaN)` is `NaN`, and a `NaN`
 * budget makes the shedding comparison false for every segment — i.e. it would
 * silently degrade to "shed nothing", which is the clipping failure again.
 */
export const tallyBudget = (paneWidth: number): number => {
	const width =
		Number.isFinite(paneWidth) && paneWidth > 0 ? paneWidth : FALLBACK_PANE_PX;
	return Math.max(
		1,
		Math.floor((width - TALLY_CHROME_PX - TALLY_LABEL_PX) / TALLY_CHAR_PX),
	);
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
 * The to-dos section's trailing tally: `10 of 14 closed · 1 dropped`.
 *
 * **`closed` is closure — done OR dropped — and it is the word the phase model
 * already uses** (`TodoPhaseView.closed`). One word for one fact, or the section
 * and the model beneath it disagree: a tally that said `9 of 14 done` over a
 * phase closure of `4/5` was counting two different things under two spellings,
 * with nothing on screen saying which was which.
 *
 * `resolved` was that word and it was WRONG, not merely redundant: `3 of 3
 * resolved · 1 dropped` is uncheckable against the three rows under it when one
 * of them is the dropped one (3 + 1 > 3), and `§8`'s "every claim checkable" is
 * the clause it broke. `closed` is true of both settled states, which is what
 * the count actually means.
 *
 * The `dropped` segment is the breakdown of that closure, not a second count:
 * `closed` says how much of the plan is finished with, and `dropped` says how
 * much of it was abandoned rather than done. Both facts are worth stating — a
 * plan that quietly abandoned a third of itself should not read like one that
 * completed — which is why the word survives alongside the count that contains
 * it.
 */
export function todoTally(
	details: RunDetails | null | undefined,
	maxChars?: number,
): string {
	if (!details) return "";
	const segments = [
		`${closedTodos(details)} of ${details.totalTodos} closed`,
		...(details.droppedTodos > 0 ? [`${details.droppedTodos} dropped`] : []),
	];
	return shedSegments(segments, maxChars);
}

/**
 * How much of the plan is finished with, in the one sense of "finished with"
 * this surface uses: done plus dropped. The TUI's `RESOLVED_STATUSES`.
 */
export function closedTodos(details: RunDetails): number {
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
export function visibleSubagents(
	rows: SubagentRow[],
	/**
	 * How many rows fit. The collapsed roster's cap by default, and the `+N more`
	 * disclosure's own bound when the reader expands it (`§ 4`, item 3) — a bound
	 * the reader asked for rather than one the surface decided.
	 */
	cap: number = SUBAGENT_ROW_CAP,
): {
	rows: SubagentRow[];
	hidden: number;
} {
	const ordered = [...rows].sort(byPriority);
	if (ordered.length <= cap) {
		return { rows: ordered, hidden: 0 };
	}
	const kept = ordered.slice(0, cap);
	/*
	 * Every settled row keeps a slot only if nothing failed needs one. `kept` is
	 * in rank order, so the LAST non-failed row is the quietest thing on screen
	 * — the one the reader loses least by — and evicting from the tail is what
	 * leaves the order above it untouched. Written as a backward walk rather than
	 * `findLastIndex` because the renderer's `lib` predates it.
	 */
	for (const failed of ordered.slice(cap)) {
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
 * The subagents section's slice: the rows it renders, and how many it hid.
 *
 * This is the ONE slice the section and the `danger` dot are both built from, and
 * it is named rather than spelled at each end because the two ends can drift: a
 * filter or a cap applied at the PANEL's call site would leave the
 * acknowledgement predicates counting a slice the reader was never shown, so past
 * the cap a failure behind `+N more` would be marked read by a panel that never
 * displayed it (`§3.3`). The panel renders `panelSlice(...).rows` and
 * `visibleFailures` counts failures out of the same call, so the two are one
 * expression — and `scripts/run-detail-model.test.mjs` pins BOTH call sites by
 * source text, because a model test cannot see which slice a component renders.
 *
 * A renamed or re-tuned slice still has to come through here, which is the point:
 * the cap, the failure reservation and the rank order all live in
 * `visibleSubagents`, and nothing but the panel's own rendering may narrow them
 * further.
 */
export function panelSlice(
	rows: readonly SubagentRow[],
	/**
	 * The cap to slice by. Defaulted, and defaulted to the COLLAPSED one on
	 * purpose: this function is what the `danger` dot's acknowledgement counts
	 * out of, and `§ 3.4` fixes that slice as the collapsed roster's. An expanded
	 * roster therefore renders more rows than the dot's slice holds — expanding
	 * reveals a row without acknowledging it — which is the design's own
	 * definition of "the rendered slice" rather than an oversight here.
	 */
	cap: number = SUBAGENT_ROW_CAP,
): {
	rows: SubagentRow[];
	hidden: number;
} {
	return visibleSubagents([...rows], cap);
}

/**
 * The failed children the roster's VISIBLE slice puts on screen (`§3.3`).
 *
 * The other half of the `danger` dot's promise, and the reason it is a function
 * here rather than a few lines in the trigger: "a child failed and you have not
 * looked" is answered by which rows the reader could actually see, and the
 * slice that decides that is the same one the panel renders (`panelSlice`) —
 * the cap, the reservation and the rank order all apply, so a failure behind
 * `+N more` is not in this list and keeps its dot.
 */
export function visibleFailures(rows: readonly SubagentRow[]): string[] {
	return panelSlice(rows)
		.rows.filter((row) => row.status === "failed")
		.map((row) => row.id);
}

/**
 * The failures a panel OPEN at this instant puts on screen — the ONE predicate
 * both acknowledgement ledgers are asked about (`§3.3`).
 *
 * It is `visibleFailures(details.subagents)` and nothing more, and it is a named
 * function rather than that expression written twice because two instants of the
 * RETIRED trigger drifted apart over exactly this expression: its close half
 * asked `visibleFailures` while its open half asked `details.failedChildIds` —
 * the WHOLE roster — so past the cap a failure behind the disclosure was marked
 * read by an open that never displayed it. A name both call sites share is what
 * makes that a compile-visible edit rather than a silent difference, and it is
 * still the single expression the two ledgers on the live trigger share, so the
 * name is kept even though the popover that motivated it is gone.
 *
 * `details` may be null (the trigger's ref is read at click time), and a null
 * view model has no rows to show.
 */
export function onScreenFailures(
	details: RunDetails | null | undefined,
): string[] {
	return visibleFailures(details?.subagents ?? []);
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

/**
 * The plan's count, in the app's one spelling of it: `1 to-do open`,
 * `4 to-dos open`, `0 to-dos open`.
 *
 * EXPORTED, and deliberately not re-derived anywhere (round 1's U1-7/Q7 is the
 * precedent this follows): the composer's plan chip states the very fact the
 * trigger's tooltip states, and those two surfaces are read together in one
 * glance — the chip above the box and the button's tooltip two rows below it.
 * A second pluralisation, or a second tally, is how `1 to-dos open` reaches a
 * user on one of them and nothing but review would catch it. Callers pass
 * `RunDetails["openTodos"]` — pending plus blocked, over the WHOLE wire list —
 * so the count has exactly one derivation and this function only spells it.
 *
 * A settled plan prints `0 to-dos open` rather than nothing: see
 * `docs/composer-status-tabs.md` § 5.1 for why the composer's chip must not
 * vanish when the last item closes.
 */
export const todoClause = (count: number): string =>
	count === 1 ? "1 to-do open" : `${count} to-dos open`;

const failureClause = (count: number): string =>
	`${plural(count, "subagent")} failed`;

/**
 * The attention GRAMMAR, stated once (`§ 3.4`, `§ 7.2`; round 3's nit).
 *
 * Three surfaces report an MCP problem with the same two words and differ only
 * in what they name — the trigger's clause names the servers (`1 MCP server needs
 * attention`), the section's tally states the count against the list
 * (`1 of 3 connected · 1 needs attention`) — so the verb lives here and the
 * clauses are built from it. Two copies of one rule is how round 1's U1-7/Q7
 * happened: `1 need attention` drifted from `1 MCP server needs attention` on the
 * two surfaces a single reader sees together, and nothing but review would have
 * caught it. `needs` for a count of one, `need` otherwise.
 */
const attentionVerb = (count: number): string =>
	count === 1 ? "needs" : "need";

/** The clause that names no subject: `1 needs attention`, `3 need attention`. */
const attentionClause = (count: number): string =>
	`${count} ${attentionVerb(count)} attention`;

/** The MCP ledger's clause, with the protocol's own name left singular. */
const mcpClause = (count: number): string =>
	`${plural(count, "MCP server")} ${attentionVerb(count)} attention`;

/**
 * The tooltip and `aria-label` copy (`§3.3`, `§6.2`).
 *
 * Built as ordered clauses rather than as a sentence so that pressure sheds a
 * whole clause instead of truncating one: the count is the first thing the
 * label exists to say, and `Open run details — 2 subag…` says nothing at all.
 *
 * **The two ATTENTION clauses — an unseen failure and an MCP problem — are the
 * last the budget may shed** (`§ 3.4`): they are what explains the dot, and a lit
 * dot whose accessible name lost its reason is the unreadable state this surface
 * exists to prevent. They therefore LEAD the list and are kept before any count
 * is added, while the counts (`n subagents running`, `n to-dos open`) queue
 * behind them and shed first.
 *
 * `MCP` stays singular as the protocol's own name, and the clause is spent after
 * the failure clause: `§ 3.4` fixes both, and a tooltip that reported a broken
 * server before a failed child would rank two facts the design merges rather than
 * ranks.
 *
 * The verb is the toggle's own state, and it is spent before everything: the
 * action is the one clause that may never be shed, because a control whose name
 * lost its verb names nothing.
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
	options: {
		open?: boolean;
		maxChars?: number;
		/** Problem servers nobody has looked at, from the MCP ledger's own set. */
		mcpProblems?: number;
	} = {},
): string {
	const prefix = options.open ? LABEL_CLOSE : LABEL_OPEN;
	if (!details) return prefix;
	const attention: string[] = [];
	const counts: string[] = [];
	const failures = unseenFailures(details, seen).length;
	if (failures > 0) attention.push(failureClause(failures));
	if ((options.mcpProblems ?? 0) > 0) {
		attention.push(mcpClause(options.mcpProblems ?? 0));
	}
	if (details.openChildren > 0) counts.push(childClause(details.openChildren));
	if (details.openTodos > 0) counts.push(todoClause(details.openTodos));
	const clauses = [...attention, ...counts];
	if (clauses.length === 0) return prefix;

	if (options.maxChars !== undefined) {
		/*
		 * What the dot needs is kept before anything is added, and the COUNTS queue
		 * behind it. When there is no attention clause the first count takes the
		 * leading slot, which is this budget's pre-existing behaviour.
		 */
		const leading = attention.length > 0 ? attention : counts.slice(0, 1);
		const rest = attention.length > 0 ? counts : counts.slice(1);
		let kept = [...leading];
		for (const clause of rest) {
			if (
				(prefix + LABEL_SEAM + [...kept, clause].join(CLAUSE_SEAM)).length >
				options.maxChars
			) {
				break;
			}
			kept = [...kept, clause];
		}
		return prefix + LABEL_SEAM + kept.join(CLAUSE_SEAM);
	}
	return prefix + LABEL_SEAM + clauses.join(CLAUSE_SEAM);
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

/**
 * Whether a row has a conversation the reader could actually open.
 *
 * `childSessionId` is the READER's key — the transcript route is addressed by
 * `(session_id, child_id)` and never by a path — and the wire leaves it null for
 * a job the runtime has not given a durable directory yet (a child the manager
 * has queued but not started). A row with no key is not a control: pressing it
 * mounted a reader whose loader returned immediately on every read, so the pane
 * sat on `Loading this subagent's conversation…` for as long as it was open. The
 * honest thing to say about a row that cannot be read is nothing at all, which
 * is what the roster's quiet (non-button) branch already says — and the reader
 * keeps its own terminal line for the one way in this cannot cover
 * (`run-child-reader.tsx`, the breadcrumb and the sibling stepper).
 */
export const childOpenable = (row: SubagentRow): boolean =>
	row.childSessionId !== null;
