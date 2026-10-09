/**
 * The arithmetic behind a tool row, ported from the TUI's ledger.
 *
 * Source of truth: `local_operator/tui/widgets/tool_card.py` and
 * `local_operator/tui/glyphs.py`. These are pure functions with no React and no
 * DOM so the port can be asserted against the Python rules it mirrors rather
 * than eyeballed in a story — `scripts/transcript-reducer.test.mjs` bundles and
 * exercises them.
 *
 * Why port the rules at all, rather than invent web-native ones: a user who
 * learns to scan a conversation in the terminal must not have to learn it again
 * in the app. The *medium* differs — proportional text, a real hover ground, no
 * cell grid — but which fact lands in which column, and which fact is dropped
 * first when there is no room, are decisions this file keeps identical.
 */

/**
 * Arguments that identify WHAT a call acted on, as opposed to its payload.
 *
 * `tool_card.py:309-321`. The order matters only in that a call's own argument
 * order decides which two survive; membership is what separates `write`'s
 * `path` from its `content`. Joining the first two scalars without this set
 * buries the filename under the first sixty characters of the file being
 * written, which is the one thing the row exists to say.
 */
const IDENTITY_ARGS = new Set([
	"command",
	"path",
	"file_path",
	"url",
	"pattern",
	"query",
	"name",
	"target",
	"message",
	/*
	 * The project tool's milestone op names its subject in `milestone` (the
	 * milestone's name), beside the flag that decides add-or-remove; without it
	 * the identity scan falls through to every scalar and the `remove` boolean
	 * leaks into the object (`Removed milestone ship-v2 true`).
	 */
	"milestone",
]);

/**
 * The string spellings of True its own validator accepts, case-insensitively.
 *
 * Measured against the running build's pydantic (2.13.5) via the tool's own
 * params class: `true`, `1`, and - any case, with no surrounding whitespace -
 * `"true" | "yes" | "y" | "t" | "on" | "1"` all reach the op as True; a
 * padded `" true "` is a validation ERROR rather than a spelling, which is why
 * the caller lowercases without trimming. The falsy spellings need no set:
 * "not truthy" is exactly what the row composes as the update, and that is
 * also what a rejected spelling gets, for lack of anything the branches can
 * claim about a call the tool refused.
 */
const TRUTHY_FLAG_SPELLINGS = new Set(["true", "yes", "y", "t", "on", "1"]);

/**
 * The arguments whose BARE scalar reads wrong, and how the object renders them.
 *
 * The fallback scan below is the TUI's "every scalar" rule, and for most names
 * a scalar IS the object. Two do not survive alone, both measured in the trace
 * label's design round 1: `hub.peek`'s `steps` prints `3` with no unit - "3"
 * could be a step index, a message count or a byte size (D1) - and `wait`'s
 * timeout prints as a second bare number beside the job id (`9360 600000`
 * reads as two ids; the second is ten minutes in milliseconds, D5). Both
 * arguments arrive as numeric STRINGS in the wild too (`16` calls with a
 * string `steps` in 36 h of transcripts; the tools' lax ints accept them), so
 * `numberFrom` feeds the renderers either spelling - a string the tools only
 * reject is left to the scalar axis untouched (review round 2, QA Q1b).
 * Keyed by tool AND argument because the meaning is the ARGUMENT's: a `steps`
 * on some other tool would not be steps, and `jobs.peek` carries no such
 * count, so it keeps its scalar.
 *
 * Applied only in the fallback scan: when identity arguments gave the object,
 * the call's subject is already named and these renderers are not the subject.
 */
const ARG_RENDERINGS: Record<
	string,
	Record<string, (value: unknown) => string>
> = {
	hub: {
		steps: (value) => {
			const n = numberFrom(value);
			return n !== null && Number.isInteger(n) && n >= 0
				? `${n} ${n === 1 ? "step" : "steps"}`
				: "";
		},
	},
	wait: {
		/*
		 * Spelled in the same vocabulary as a row's own duration
		 * (`formatDuration`, seconds in), because a span is a span; the separator
		 * is the renderer's - an id and a SPAN joined by a bare space read as two
		 * ids (D5).
		 */
		wait_ms: (value) => {
			const n = numberFrom(value);
			return n !== null && n > 0 ? `· ${formatDuration(n / 1000)}` : "";
		},
	},
};

/**
 * The number a renderer can format, from either spelling the tool accepts.
 *
 * The tools' pydantic fields are lax, so `"3"` and `"600000"` execute exactly
 * like their numbers - recorded in the wild for `hub.peek` (`16` calls with a
 * string `steps` in 36 h of transcripts, review round 2 QA Q1b). A renderer
 * that demanded `typeof value === "number"` let those spellings fall through
 * to the bare scalar and relit D1/D5's ambiguity for every one of them. This
 * is the one coercion both renderers share; non-numeric strings (and anything
 * that is not a finite number) answer null, so the scalar axis keeps them
 * untouched rather than guessing a unit for them.
 */
function numberFrom(value: unknown): number | null {
	if (typeof value === "number") return Number.isFinite(value) ? value : null;
	if (typeof value === "string" && value !== "") {
		const parsed = Number(value);
		return Number.isFinite(parsed) ? parsed : null;
	}
	return null;
}

/** The minted prefix every MCP tool name carries. */
const MCP_PREFIX = "mcp__";

/**
 * Shrink a whole-token absolute path against the home directory.
 *
 * `compact_path` (tool_card.py:420-439) tries the cwd first and then `$HOME`.
 * The renderer has neither: a browser has no cwd, and the session's cwd lives
 * on frontend state that a pure function must not reach for. So only the home
 * rewrite ports, and it is driven by the paths themselves — every absolute path
 * under a macOS/Linux home shares the `/Users/<name>/` or `/home/<name>/`
 * shape, which is recoverable from the string without asking the host.
 *
 * Only whole tokens are rewritten, exactly as the TUI does: a sentence that
 * merely mentions a slash keeps its wording, because the rewrite is for paths
 * eating the summary budget, not for prose.
 */
const HOME_PATH = /^\/(?:Users|home)\/[^/]+\//;

/** Collapses whitespace in a model-supplied peer target. */
const WHITESPACE = /\s+/;

export function compactPath(text: string): string {
	if (!text.startsWith("/") || text.includes(" ")) return text;
	return text.replace(HOME_PATH, "~/");
}

/** One argument value flattened to a single compact line, or "" if unusable. */
function scalarText(value: unknown): string {
	if (typeof value === "string") {
		return compactPath(value.trim()).replace(/\n/g, " ").trim();
	}
	if (typeof value === "number" || typeof value === "boolean") {
		return String(value);
	}
	return "";
}

/**
 * The delivery promise of a `send` call in one word.
 *
 * Mirrors `tools.builtin.peer_send_mode_label`. `wake` is the default, so only
 * an explicit `wake: false` is quiet.
 */
function sendMode(args: Record<string, unknown>): string {
	if (args.now) return "now";
	return args.wake === false ? "quiet" : "wake";
}

/** The addressed peer, mirroring `peer_send_target_label`'s precedence. */
function sendTarget(args: Record<string, unknown>): string {
	const pid = args.pid;
	if (typeof pid === "number" && Number.isFinite(pid)) return `pid ${pid}`;
	const session = String(args.session ?? "").trim();
	if (session) return `session ${session}`;
	// `?` rather than blank: the call will fail, but the row is painted first,
	// and an empty slot reads as though the next field were the target.
	return (
		String(args.target ?? "")
			.split(WHITESPACE)
			.filter(Boolean)
			.join(" ") || "?"
	);
}

/**
 * `send`'s summary, with the delivery mode LEADING.
 *
 * `_send_summary` (tool_card.py:451-489). The mode leads because the row
 * truncates from the right: with the marker after the target, three calls to
 * the same peer with three different delivery promises rendered identically at
 * ordinary widths, and one of them woke a peer while another did not. The
 * discriminator goes ahead of the free-text identity.
 */
function sendSummary(args: Record<string, unknown>): string {
	const parts = [
		sendMode(args),
		scalarText(sendTarget(args)) || "?",
		scalarText(args.message),
	];
	return parts.filter(Boolean).join(" · ");
}

/**
 * How a `send` call's delivery ended, as the core states it in
 * `details.delivery.state`.
 *
 * FOUR states, because the sender can only learn two facts independently - did
 * the message land, and did the wake get answered - and collapsing the middle
 * two would force the row into a claim it cannot back:
 *
 * - `delivered`: landed, and the wake (if one was asked for) was answered.
 * - `mailbox`: landed (the recipient's transcript holds it) but the wake got no
 *   answer; it reads the message on its next turn. NOT a failure.
 * - `unconfirmed`: no answer and no evidence it landed. It may still arrive, so
 *   the row says neither "sent" nor "failed".
 * - `failed`: nothing landed. The only state the core flags `is_error`.
 *
 * Read from structured `details`, never from the result text: the text is prose
 * the core is free to reword, and sniffing it is how a renderer ends up
 * claiming a delivery it cannot verify. An ABSENT or UNKNOWN value is `null`,
 * which every caller treats as "no statement" and so falls back to exactly what
 * the row did before this field existed (old transcripts, old cores, and a
 * future core's new state all degrade to the plain tick/failure pathway).
 */
export type SendDeliveryState =
	| "delivered"
	| "mailbox"
	| "unconfirmed"
	| "failed";

const SEND_DELIVERY_STATES: ReadonlySet<string> = new Set([
	"delivered",
	"mailbox",
	"unconfirmed",
	"failed",
]);

/** The delivery state a result's `details` states, or `null` when it states none. */
export function deliveryStateFromDetails(
	details: unknown,
): SendDeliveryState | null {
	if (!details || typeof details !== "object") return null;
	const delivery = (details as Record<string, unknown>).delivery;
	if (!delivery || typeof delivery !== "object") return null;
	const state = (delivery as Record<string, unknown>).state;
	return typeof state === "string" && SEND_DELIVERY_STATES.has(state)
		? (state as SendDeliveryState)
		: null;
}

/**
 * The delivery state a row should hold after a frame, under `preferDiff`'s
 * "absent vs stated" rule: a frame with NO `details` object (the live-event
 * budget strips it above a quarter of the row's share) says nothing and keeps
 * `previous`, while a frame WITH one is the producer's statement and wins -
 * including a statement that names no state.
 */
export function preferDeliveryState(
	details: unknown,
	previous: SendDeliveryState | null | undefined,
): SendDeliveryState | null {
	if (!details || typeof details !== "object") return previous ?? null;
	return deliveryStateFromDetails(details);
}

/**
 * The canonical progress payload a frame carries, or `null` when its `details`
 * say nothing in that contract's vocabulary.
 *
 * The shape test is the contract's own discriminator (harness PR #2089,
 * `imagegen/rungs.progress_details`): every live `tool_execution_update`
 * carries `stage` - present even when `null`, which is a mid-walk failure -
 * and the terminal `ImageGenerationUnavailable` result carries `error_type`
 * without one. EITHER key marks the payload as the progress contract's rather
 * than another tool's detail object; `"stage" in details` alone would drop
 * the settled failure's pair, and a looser gate would hand the carrier any
 * tool's free-form `details` (the same reasoning the reducer's `artifactKind`
 * states one layer down: a stray key must not turn a payload into something
 * it is not).
 */
function progressDetailsFrom(details: unknown): Record<string, unknown> | null {
	if (!details || typeof details !== "object" || Array.isArray(details))
		return null;
	const record = details as Record<string, unknown>;
	if (!("stage" in record) && !("error_type" in record)) return null;
	return record;
}

/**
 * The contract keys, in the order the wire emits them - the ones every reader
 * of the payload consumes, and therefore the ones the equality read below
 * compares. The keys beside them (`provider`, `model`, `elapsed_s`,
 * `num_images`) evolve with the producer and reach no consumer yet; comparing
 * them would defeat the identity rule for changes nothing reads.
 */
const PROGRESS_DETAIL_KEYS = [
	"stage",
	"queue_position",
	"progress_fraction",
	"log_lines",
	"error",
	"error_type",
] as const;

/** Whether two `log_lines` values state the same messages at the same times. */
function sameLogLines(x: unknown, y: unknown): boolean {
	if (x === y) return true;
	if (!Array.isArray(x) || !Array.isArray(y) || x.length !== y.length)
		return false;
	for (let at = 0; at < x.length; at++) {
		const a = x[at];
		const b = y[at];
		const aIsObject = Boolean(a) && typeof a === "object";
		const bIsObject = Boolean(b) && typeof b === "object";
		if (!aIsObject || !bIsObject) {
			if (a !== b) return false;
			continue;
		}
		const left = a as Record<string, unknown>;
		const right = b as Record<string, unknown>;
		if (left.message !== right.message || left.timestamp !== right.timestamp)
			return false;
	}
	return true;
}

/** Whether two payloads state the same contract facts. */
function sameProgressDetails(
	a: Record<string, unknown>,
	b: Record<string, unknown>,
): boolean {
	for (const key of PROGRESS_DETAIL_KEYS) {
		const x = a[key];
		const y = b[key];
		if (key === "log_lines") {
			if (!sameLogLines(x, y)) return false;
			continue;
		}
		if (x !== y) return false;
	}
	return true;
}

/**
 * The record's progress-details carrier after a frame, under `preferDiff`'s
 * rules as `preferDeliveryState` states them: an absent (or unshaped, or
 * budget-stripped) `details` says nothing and keeps `previous`, while a shaped
 * payload is the producer's own statement and wins - except when the contract
 * keys read equal, where `previous` is returned BY REFERENCE so the equality
 * gate sees no change (`shallowEqual` compares by `!==`, and a fresh object of
 * identical facts would re-render the row on every reconnect replay).
 */
export function preferProgressDetails(
	details: unknown,
	previous: Record<string, unknown> | null | undefined,
): Record<string, unknown> | null {
	const shaped = progressDetailsFrom(details);
	if (!shaped) return previous ?? null;
	if (previous && sameProgressDetails(shaped, previous)) return previous;
	return shaped;
}

/**
 * The trailing word a send row prints for a state, in the slot a failure's word
 * takes. Only the three states that need saying have one: a delivered row is
 * silent like every other success. Each word is distinct from the others with
 * the colour off, and none is `failed` - "Sent ... failed" reads as a statement
 * about the message, while `not delivered` states the fact the reader acts on
 * (the same precedent as `never ran`).
 *
 * BOTH AMBER WORDS NAME THEIR SUBJECT (agent review round 1 / UX U2). The fourth
 * state drew the bare `unconfirmed` for one round, which is a VERDICT at the row's
 * trailing edge - `Sent ... unconfirmed` reads as "it did not go", the single
 * reading that leads to the resend this state exists to prevent - and it was
 * also the vaguer, shorter word for the state where a wrong guess costs a
 * duplicate delivery. `unconfirmed` is what the word is ABOUT, never the word:
 * either it stands where the row's name gives it a subject (`wake unconfirmed`)
 * or it carries its own (`delivery unconfirmed`).
 */
export const SEND_DELIVERY_WORD: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox: "wake unconfirmed",
	unconfirmed: "delivery unconfirmed",
	failed: "not delivered",
};

/**
 * The hover text on the word, for the two amber states whose word alone
 * under-tells them.
 *
 * WHICH OF THESE ARE QUOTED AND WHICH ARE OURS (agent review round 1). The
 * `mailbox` sentence is the frozen interface's, verbatim. The `unconfirmed` one
 * is THIS PR's OWN composition - the frozen interface fixes a hover for
 * `mailbox` alone - and the design round records it in its own note in round 2;
 * until then it is copy this change authored, and no test may cite it as a
 * requirement (see `scripts/tool-row.test.mjs`). `failed` needs none: its word
 * is the whole statement, and a hover would only repeat it.
 */
export const SEND_DELIVERY_TITLE: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox:
		"In their mailbox. The wake got no answer, so they will read it on their next turn.",
	unconfirmed:
		"No wake answer and not yet in their transcript — it may still arrive. Check before resending.",
};

/**
 * The wrapping, reader-facing sentence the EXPANSION prints for a state.
 *
 * Why it exists at all (UX round 1, U1/U4 - major). The result text is a
 * machine line: it is one `whitespace-pre` line inside an `overflow-x: auto`
 * box, so at ordinary widths the half that tells the reader what to DO sits off
 * the right edge behind a scrollbar macOS does not even draw - measured on the
 * round-1 frames as 811 px of the mailbox sentence and 1423 px of the
 * `unconfirmed` one. The reader who expanded the row precisely to find out what
 * to do got `… — the wake`.
 *
 * So the instruction gets its own line, and this is the UI's copy rather than
 * the core's: it WRAPS (so it cannot be clipped), it names the reader's own
 * actions, and it carries no agent API - `sessions(op="peek", …)` belongs to the
 * model-facing string, where the reader is a model. The raw result text is NOT
 * removed: it stays as the row's `Output` block, which is where the pid, the
 * message id and the attempt count live for anyone who wants them.
 *
 * `delivered` has no entry by design: a success says nothing, and the expansion
 * of a delivered send is the row it always was.
 */
export const SEND_DELIVERY_NOTE: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox:
		"Delivered to their mailbox. The wake got no answer, so they will read the message on their next turn. Do not send it again.",
	unconfirmed:
		"Not confirmed: there was no answer and the message is not in their transcript. It may still arrive, so check before resending.",
	failed:
		"Nothing was delivered. Fix the cause named below, or retry the send.",
};

/**
 * What assistive tech hears for each state (the word is drawn, this is spoken).
 *
 * The AMBER state's spoken sentence carries the hedge its hover carries (UX
 * round 1, U3): the drawn word is `aria-hidden` whenever the two differ, so the
 * label is the whole of what a reader with no screen sees - and `delivery
 * unconfirmed` on its own is "it did not go", the reading the hover exists to
 * correct. A hedge that only a mouse can reach is not a hedge.
 *
 * `failed` has no entry: its drawn word IS the announcement, so an entry here
 * would be a string nothing renders (agent review round 1, residue).
 */
export const SEND_DELIVERY_LABEL: Readonly<
	Partial<Record<SendDeliveryState, string>>
> = {
	mailbox: "delivered, wake unconfirmed",
	unconfirmed:
		"delivery unconfirmed — it may still arrive, so check before resending",
};

/**
 * Whether a state is the AMBER middle: settled without a failure claim, yet not
 * the plain success either.
 */
export function isPartialDelivery(
	state: SendDeliveryState | null | undefined,
): state is "mailbox" | "unconfirmed" {
	return state === "mailbox" || state === "unconfirmed";
}

/**
 * The row outcome a `send` delivery state earns, or `null` when it earns none.
 *
 * `null` is the answer for `delivered` (a success draws nothing, so the row keeps
 * the outcome it already had), for an absent or unknown state, and for every
 * non-`send` row - which is what keeps an old transcript on exactly the path it
 * had before this field existed.
 *
 * `failed` maps to `null` too, and NOT to `error`: the failed row's outcome is
 * the one it already had (`isError`), and the word it prints comes from
 * `SEND_DELIVERY_WORD` inside the status cluster. An `"error"` return existed
 * for one round with no production caller (agent review round 1, residue), and a
 * branch that describes a caller that does not exist is a future edit that
 * silently does nothing.
 */
export function deliveryRowOutcome(
	state: SendDeliveryState | null | undefined,
): "partial" | null {
	return isPartialDelivery(state) ? "partial" : null;
}

/**
 * The settled VERB a `send` row prints when its delivery did not happen, or
 * `null` when the tool's own verb stands.
 *
 * `Attempted` for `failed` alone, and the reason is the row's own sentence (UX
 * round 1, U8): the ledger's settled verb is `Sent`, so the one state that says
 * `not delivered` read `Sent … not delivered` - the row contradicting itself in
 * six words, on the state whose whole job is to be unambiguous. The settled verb
 * is there to name the ATTEMPT (the design note's own convention, which is why
 * the amber rows keep `Sent`), and an attempt that provably delivered nothing is
 * exactly that: an attempt.
 *
 * Deliberately not the amber states: `Sent … wake unconfirmed` claims only that
 * the attempt was made, which is true there - the message is in the mailbox.
 */
export function deliverySettledVerb(
	state: SendDeliveryState | null | undefined,
): string | null {
	return state === "failed" ? "Attempted" : null;
}

/**
 * Whether a settled result is a FAILURE for the counts that mean it: the fold's
 * `N failed`, the turn foot's `· N failed`, and the row the failed-row jump
 * targets.
 *
 * `isError` alone is the whole answer for every tool this row model knows, and
 * it stays the answer here - the core leaves `is_error` false for `mailbox` and
 * `unconfirmed`. The predicate exists so the exception is STATED at the sites
 * that count rather than ASSUMED of the producer: a partial `send` settled
 * without failing, and a count that read one as a failure would jump the reader
 * to a message that is sitting in the peer's inbox, which is the claim the whole
 * state model was added to stop making.
 *
 * The sibling rule (`turn-collapse-model.ts`'s `isFailedCall`) carries the other
 * exclusions - never-sent, stopped, interrupted. Both read the same two facts,
 * so a partial result is excluded by both.
 */
export function isFailedResult(
	isError: boolean | null | undefined,
	delivery: SendDeliveryState | null | undefined,
): boolean {
	if (isError !== true) return false;
	return !isPartialDelivery(delivery);
}

/**
 * The one thing an addressed `sessions` call acts on, in the resolver's order.
 *
 * `pid`, then the exact session id, then the name/cwd substring - the same
 * precedence the tool's own resolver uses (`docs/design/sessions-tool.md` §3.2
 * in `damianvtran/local-operator`, and the TUI's `_sessions_address`), so the
 * row cannot disagree with the call about WHICH session it names. `?` rather
 * than blank when an addressed op names no address: the row is painted before
 * the call settles, and a blank slot reads as though the next field were the
 * target (the send row's rule).
 *
 * The `session ` prefix the send row spells is dropped here because the VERB
 * already carries the noun (`Stopped session session 5d3f2a9c` stutters); `pid`
 * keeps its marker, which the number alone would not say.
 *
 * `pid` reads through `numberFrom` for the reason `steps`/`head` do: the
 * schema's lax int executes `"48213"` and `"48213.0"` as pid 48213, so a row
 * painting `?` for a call that executed is the one disagreement this function
 * exists to prevent - while a non-integer float, which the schema REFUSES,
 * must not paint a `pid` at all and falls through to the address ladder
 * (review round 1, R-3).
 */
function sessionsAddress(args: Record<string, unknown>): string {
	const pid = numberFrom(args.pid);
	if (pid !== null && Number.isInteger(pid)) return `pid ${pid}`;
	return scalarText(args.session) || scalarText(args.target) || "?";
}

/**
 * The peek row's window, in the op's own words (`last 12` / `first 20`).
 *
 * Mirrors `_sessions_peek_window` (`harness/rows.py`, sibling PR
 * `damianvtran/local-operator` #1825) and the tool's own validation: `query` is
 * tested FIRST because it is the discriminator that survives beside `steps` -
 * the tool keeps `steps` as the SIZE of the match window (`query` + `steps=6`
 * reads six steps around the match, not the tail), so asking for `steps` first
 * would paint `last 6`, a read the call never makes, and drop the search term.
 * Numbers arrive as numeric strings in the wild too (the tools' lax ints), so
 * `numberFrom` feeds the renderers either spelling. Empty when the call names
 * no window: the tool's default applies, and the row must not claim a value
 * nobody read (the `hub` peek count's rule, one tool over).
 */
function sessionsPeekWindow(args: Record<string, unknown>): string {
	const query = scalarText(args.query);
	if (query) {
		const steps = numberFrom(args.steps);
		return steps !== null && Number.isInteger(steps) && steps >= 0
			? `search ${query} · ${steps} around`
			: `search ${query}`;
	}
	const steps = numberFrom(args.steps);
	if (steps !== null && Number.isInteger(steps) && steps >= 0)
		return `last ${steps}`;
	const head = numberFrom(args.head);
	if (head !== null && Number.isInteger(head) && head >= 0)
		return `first ${head}`;
	if (args.digest === true) return "digest";
	const before = scalarText(args.before_id);
	if (before) return `before ${before}`;
	const around = scalarText(args.around_id);
	return around ? `around ${around}` : "";
}

/**
 * `sessions`' summary: the discriminator leads, and the verb carries the op.
 *
 * The TUI and the phone draw ONE shared sentence for this tool
 * (`sessions_row_summary`, `harness/rows.py`; sibling PR
 * `damianvtran/local-operator` #1825) whose own doc says why the op leads: both
 * rows shed from the right, and `stop` and `peek` on one session painted
 * byte-identical rows without it. THIS row's grammar is verb + object, so the
 * op lives in the verb (`Spawned session`) and the object carries everything
 * else: `spawn` its visibility FIRST - both values, the default spelled -
 * because the invisible disposition is the incident the tool exists to
 * prevent, and an omitted flag must not be the one thing a narrow row drops
 * (the `send` row's discriminator rule, one layer down); the addressed ops
 * their target; `peek` its window; `list` its `stored`/`query` markers.
 *
 * Null for an operation this build does not know, so the call falls through to
 * the generic scan (`Called sessions <scalars>`, the `agent` precedent, which
 * never guesses a neighbouring claim). Empty string when a known op names
 * nothing (a bare `list`): the caller reads it as the tool's own name, and a
 * bare name keeps an empty object rather than echoing itself.
 */
function sessionsSummary(args: Record<string, unknown>): string | null {
	const op = toolOp(args);
	if (op === "spawn") {
		const visibility = scalarText(args.visibility) || "workstream";
		const name = scalarText(args.name) || scalarText(args.prompt);
		return [visibility, name].filter(Boolean).join(" · ");
	}
	if (op === "stop" || op === "resume" || op === "info")
		return sessionsAddress(args);
	if (op === "peek") {
		return [sessionsAddress(args), sessionsPeekWindow(args)]
			.filter(Boolean)
			.join(" · ");
	}
	if (op === "list") {
		const parts: string[] = [];
		if (args.include_stored === true) parts.push("stored");
		const query = scalarText(args.query);
		if (query) parts.push(query);
		return parts.join(" · ");
	}
	return null;
}

/**
 * One-line summary of WHAT the call is acting on.
 *
 * `_summary_from_args` (tool_card.py:492-515): identity arguments first, in
 * argument order, falling back to every scalar for an unknown or MCP tool that
 * has no recognisable identity argument; first two joined with a space; the
 * tool's own name when nothing survives.
 */
export function summaryFromArgs(
	toolName: string,
	args: Record<string, unknown> | null,
): string {
	const name = toolName.trim();
	if (!args) return name;
	if (name === "send") return sendSummary(args) || name;
	// Case-folded like every other lookup in this module: the name is
	// model-controlled, and `Sessions` must not lose its discriminator to the
	// generic scan.
	if (name.toLowerCase() === "sessions") {
		const summary = sessionsSummary(args);
		if (summary !== null) return summary || name;
	}
	/*
	 * The operation selector is not an object, once a verb table reads it.
	 *
	 * `agent({op:"list"})` carries ONE scalar and it is the word the VERB is
	 * about to say; before the verb was op-aware it was the only thing the row
	 * had, and passing it through is how the row came to read `Delegated list`
	 * (operator report, 2026-09-27). For the tools whose verb table is keyed by
	 * an operation (`TOOL_OP_VERBS`) the selector key is dropped from BOTH
	 * scans, so the object is the call's subject or nothing - never an echo of
	 * the verb beside it. `network` spells it `action` and `console` `method`,
	 * which is why three keys are dropped rather than one; a tool with no op
	 * table keeps every scalar it sent, MCP tools included, because for those
	 * the fallback's first two scalars are still the only identity the row has.
	 */
	const entries = isOpSelectable(name)
		? Object.entries(args).filter(([key]) => !OP_ARG_KEYS.has(key))
		: Object.entries(args);
	let parts = entries
		.filter(([key]) => IDENTITY_ARGS.has(key))
		.map(([, value]) => scalarText(value))
		.filter(Boolean);
	if (parts.length === 0) {
		const renderings = ARG_RENDERINGS[name.toLowerCase()];
		parts = entries
			.map(([key, value]) => renderings?.[key]?.(value) || scalarText(value))
			.filter(Boolean);
	}
	return parts.slice(0, 2).join(" ") || name;
}

/**
 * What the row's NAME column says.
 *
 * `glyphs.display_name` (glyphs.py:267+). Builtins are already their own best
 * name. An MCP tool is not: `create_mcp_tool_name` mints
 * `mcp__<server>_<tool>`, and in a narrow column that constant `mcp__` eats
 * five characters before a single informative one — three tools from one server
 * all read `mcp__lin`, which is the scan-by-shape premise failing for the tool
 * class a user is most likely to have a dozen of. The plug glyph already says
 * "this came from a server", so the name column drops the prefix and the server
 * segment and keeps the CALL.
 *
 * A server whose own name contains an underscore cannot be split back out, so
 * only the FIRST segment is treated as the server — the remainder is still the
 * call's identifier rather than the constant. Never returns empty: a name that
 * is nothing but the prefix keeps whatever it had.
 */
export function displayName(toolName: string): string {
	const name = toolName.trim();
	if (!name.toLowerCase().startsWith(MCP_PREFIX)) return name;
	const rest = name.slice(MCP_PREFIX.length);
	const split = rest.indexOf("_");
	if (split <= 0) return rest || name;
	return rest.slice(split + 1) || rest;
}

/**
 * Whether a summary carries nothing the name column does not already say.
 *
 * `summaryFromArgs` falls back to the tool's own WIRE name when no argument is
 * summarisable. In the TUI that fallback is nearly invisible — the name column
 * is 8 cells, so `list_variables` truncates to `list_var` and the summary is
 * the only place the full name appears. This app's column GROWS to the longest
 * visible name, which turns the same fallback into `list_variables
 * list_variables`: the exact stutter the fallback exists to avoid.
 *
 * Both spellings count. The row displays `displayName(toolName)` while the
 * fallback is the wire name, and for an MCP tool those differ — the column
 * shows `list_issues` while the summary would read `mcp__linear_list_issues`.
 * Comparing against the displayed name alone let the stutter through on the
 * tool class most likely to produce a dozen argument-less rows in a row, and
 * printed the very prefix `displayName` had just stripped.
 *
 * Exported because two surfaces need the SAME answer: the row decides whether
 * to drop the summary, and the transcript decides whether to offer a stand-in
 * fact in its place. If those two disagreed, a row would either show a
 * fallback it did not need or go blank with one available.
 */
export function isBareToolName(summary: string, toolName: string): boolean {
	return summary === toolName || summary === displayName(toolName);
}

/**
 * The wiring each `bash` result opens with, which the row must not quote.
 *
 * `exit code: N` is the harness's own OUTCOME line, and `--- stdout ---` /
 * `--- stderr ---` are its section markers — so as the object column's stand-in
 * they say the least of anything in the result. The TUI never had to worry
 * about this because it has a dedicated outcome column and never reads the
 * result for an object; a port with no such column inherited the wiring as
 * prose. On a machine where every second row is a `bash` call that is how a
 * transcript came to read forty times `exit code: 0`.
 *
 * Matched after trimming, and the code is optional: a killed call reports
 * `exit code: -9`, and one observed in a real transcript reports a bare
 * `exit code` on its second line. Either way the number is not news — the
 * row's own glyph carries the outcome — so it is never worth the column.
 *
 * `(empty)` is the third spelling of the same nothing: the producer writes it
 * as the SECTION's body when a call printed on that stream at all
 * (`tools/builtin.py:1694-1695`, joined with the outcome line at `:2379`; same
 * shape in `tools/eval.py:992-993`), so the real result of a silent call is
 * `exit code: 0\n--- stdout ---\n(empty)\n--- stderr ---\n(empty)`. Skipping the
 * markers but not this left the worst case reading `(empty)` in the object
 * column — the same class of wiring-as-prose the whole rule exists to stop.
 *
 * Nothing else is filtered: `TIMEOUT after 120.0s (process killed)`, which
 * opens those same results, IS the fact worth standing in.
 */
const OUTPUT_WIRING_LINE =
	/^(?:exit code:?\s*-?\d*|\(empty\)|--- (?:stdout|stderr) ---)$/;

/**
 * The mark that says the object column is a STAND-IN, not the call's own object.
 *
 * Call for it from the design round on this change (D1): the recovered rows of
 * `joined-mid-turn` put a call's own command beside a bare line of its result,
 * in the same column, font and ink, at the same left edge — so a column that is
 * always a command reads as one for the result line too. A leading ellipsis is
 * the cheapest honest mark: it is the character truncation already uses, it
 * cannot be confused with content that a call's own arguments could contain,
 * and it survives the column's own right-side truncation because it sits at the
 * left. It is part of the STRING rather than a span so that every surface that
 * renders the fallback — the row, a story, a test — carries it.
 */
const STAND_IN_MARK = "… ";

/**
 * What the row shows in the object column when the arguments taught it nothing.
 *
 * The first line of the result that actually says something, marked as a
 * stand-in (see `STAND_IN_MARK`) and bounded because the object column is one
 * line: a multi-line result is truncated by CSS anyway, and choosing the line
 * explicitly means the row shows a whole thought rather than a fragment cut
 * mid-word by the layout. The cap matches what fits at the widest sensible
 * column, so a 4 KB result cannot push a long string through the truncation
 * machinery on every render.
 *
 * `null` means the result had nothing to offer and the row should stay empty:
 * "no stand-in exists" is a different claim from "the stand-in is a blank",
 * and the caller renders the two differently (an empty slot against a mark).
 *
 * `labelPending` is the row's first label read still being in flight (see
 * `CanonicalSessionView.labelPending`): the arguments are a `/history` read
 * away, so the result is held back and the column stays empty while that first
 * request is outstanding — never longer than `LABEL_HOLD_MAX_MS`. On the first
 * frame of a mid-turn join nearly every seeded row is in this state, and a
 * column of result lines (`… {"text": 200, "solo_cpu": 0.08…`) reads as the
 * commands that ran. Once the read settles the caller passes `false` and the
 * stand-in returns for the calls that really have no arguments to find.
 */
export function outputFallbackLine(
	output: string | null,
	labelPending = false,
): string | null {
	if (!output || labelPending) return null;
	for (const line of output.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed) continue;
		if (OUTPUT_WIRING_LINE.test(trimmed)) continue;
		return `${STAND_IN_MARK}${trimmed.slice(0, 160)}`;
	}
	return null;
}

/**
 * Integer-seconds duration, bounded at six characters over its whole domain.
 *
 * `format_duration` (tool_card.py:338-387). Used for a RUNNING row and for any
 * settled row past a minute. Widest strings: `59m59s`, `23h59m`, `99d23h`.
 */
export function formatDuration(seconds: number): string {
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
}

/**
 * A SETTLED row's duration, which is deliberately not the running format.
 *
 * `_outcome_runs` (tool_card.py:2376-2396): a tenth of a second below ten
 * seconds, whole seconds below a minute, then the integer format above. The
 * tenth matters only where it is the difference between a call that was
 * instant and one that was not; past ten seconds it is noise in a column.
 *
 * `null` is a replayed row whose duration the transcript did not keep — the
 * slot stays empty rather than claiming zero.
 */
export function formatSettledDuration(seconds: number | null): string {
	if (seconds === null) return "";
	const elapsed = Math.max(0, seconds);
	// `<0.1s`, never `0.0s` (`tool_card.py:2615-2623`). Printing `0.0s` for a
	// call that genuinely returned at once reprints the exact string the old
	// fabricated-duration bug produced, so a reader cannot tell a real sub-50 ms
	// call from a row whose duration was lost. The TUI's own reasoning for the
	// spelling: "reads as too fast to measure".
	if (elapsed < 0.05) return "<0.1s";
	if (elapsed < 10) return `${elapsed.toFixed(1)}s`;
	if (elapsed < 60) return `${Math.round(elapsed)}s`;
	return formatDuration(elapsed);
}

/**
 * One decimal, rounded the way the TUI's `f"{value:.1f}"` rounds: HALF TO EVEN.
 *
 * `Number#toFixed` rounds halves away from zero, so a naked port prints
 * `1.3 KB` for the 1280-byte dictation the TUI prints as `1.2 KB` (and `3.2`
 * for 3328) — measured against `python3 -c 'print(f"{1280/1024:.1f}")'`. The
 * values here are counts over 1024, so an exact tie is arithmetic rather than
 * a tolerance: `x * 10` is exactly `n + 0.5` and the choice is decidable.
 * A tenth either way is invisible until someone compares the two surfaces,
 * which is exactly what this port is for.
 */
function fixed1(value: number): string {
	const scaled = value * 10;
	const floor = Math.floor(scaled);
	const rest = scaled - floor;
	// The tie goes to the EVEN neighbour, which is what Python does.
	const rounded =
		rest > 0.5
			? floor + 1
			: rest < 0.5
				? floor
				: floor % 2 === 0
					? floor
					: floor + 1;
	return (rounded / 10).toFixed(1);
}

/**
 * A byte count at a glance: `812 B`, `12.4 KB`, `1.2 MB`.
 *
 * `_format_bytes` (tool_card.py:360-371), ported because the composing row's
 * number is meant to MOVE: a counter that ticks is what says the model is still
 * dictating, and the app's own spelling — `KiB`, with no step above a kilobyte
 * — spelled a multi-megabyte dictation as `2048.0 KiB`: a number nobody reads
 * at a glance, which is the whole point of the field.
 */
export function formatBytes(count: number): string {
	if (count < 1024) return `${count} B`;
	if (count < 1024 * 1024) return `${fixed1(count / 1024)} KB`;
	return `${fixed1(count / (1024 * 1024))} MB`;
}

/**
 * Diff counters, or zero for anything that is not a positive count.
 *
 * `_diff_counts` (tool_card.py:567-583) accepts a value only when it is an
 * integer and not a boolean and greater than zero; missing, malformed, negative
 * and `true` all become zero. A zero is never rendered — `+0` states that
 * nothing was added, which is a different claim from "the count is unknown",
 * and the rows that carry no counts are the second kind.
 */
export function diffCount(value: unknown): number {
	if (typeof value !== "number") return 0;
	if (!Number.isInteger(value) || value <= 0) return 0;
	return value;
}

/** The ledger categories a settled row's identity ink is chosen from. */
export type ToolCategory = "read" | "mutate" | "exec" | "meta" | "plain";

/**
 * `_TOOL_CATEGORY` (tool_card.py:218-238) — which category a tool name belongs
 * to. The axis is what the call DID to the machine, which is the question a
 * ledger is scanned for: reading is safe, mutating is not, and executing is the
 * one you re-read before trusting.
 *
 * PARITY IS NOT THE RULE HERE, and review round 1 (R1-5) is why this says so:
 * the table's base is the TUI's own, and the entries the trace-label change
 * added beyond it — `web_read`, `lsp`, `console`, `team`, `wait`, `jobs`,
 * `secret`, `network`, `team_delete` — are UI-side decisions for names the
 * TUI's table does not carry at all (checked against the installed 0.63.8 /
 * 0.63.9 and local-operator `origin/main`), each a category someone chose on
 * purpose. `project`/`project_delete` mirror the sibling TUI branch
 * `feat/tui-project-line-15c4` (`4ce339597`), as the glyphs do. The GLYPH
 * table keeps the stricter contract — no icon where the TUI has no mark — so a
 * shape can be scanned across surfaces; the two axes apply different rules
 * deliberately, and a future reader should not "restore parity" on one of them
 * by copying the other.
 *
 * Looked up case-insensitively because `toolName` is MODEL-controlled: a
 * provider that echoes `Bash` back has to land in `exec` beside `bash`, exactly
 * as `toolIcon` already reasons about its own table.
 *
 * Anything unlisted — an `mcp__*` call, or a builtin this table has not
 * classified — is `plain`, the neutral the name column has always used. A tool
 * nobody has filed is QUIET, never guessed into a category it does not belong
 * to: add an entry here when the category is a decision someone has made, and
 * otherwise leave it plain.
 */
const CATEGORIES: Record<string, ToolCategory> = {
	read: "read",
	glob: "read",
	grep: "read",
	web_fetch: "read",
	web_read: "read",
	web_search: "read",
	browser: "read",
	lsp: "read",
	list_variables: "read",
	read_variable: "read",
	write: "mutate",
	edit: "mutate",
	bash: "exec",
	eval: "exec",
	console: "exec",
	task: "meta",
	agent: "meta",
	team: "meta",
	hub: "meta",
	todo: "meta",
	send: "meta",
	wake: "meta",
	ask: "meta",
	wait: "meta",
	jobs: "meta",
	secret: "meta",
	network: "meta",
	project: "meta",
	team_delete: "meta",
	project_delete: "meta",
	sessions: "meta",
};

/**
 * The category `toolName` belongs to, or `plain` when nothing has filed it.
 *
 * An OWN-property lookup, and NOT a bare `CATEGORIES[key] ?? "plain"`. An object
 * literal inherits from `Object.prototype`, so a subscript reads the prototype
 * CHAIN: `toolCategory("constructor")` answered `Object`, and `"toString"`,
 * `"hasOwnProperty"` and `"__proto__"` answer functions the same way. A tool name
 * is MODEL-controlled, so a provider naming a tool `constructor` is reachable — and
 * that row then rendered with NO ink class at all, which is the opposite of the
 * documented neutral this fallback exists to give it.
 *
 * `Object.prototype.hasOwnProperty.call` rather than `Object.hasOwn`, which reads
 * better but needs an ES2022 lib this tsconfig does not target — the constraint and
 * the idiom `toast-manager.ts` records for its own `RAW_TRANSPORT_ERRORS` table. The
 * TUI's lookup is `dict.get`, which has no chain to read.
 */
export function toolCategory(toolName: string): ToolCategory {
	const key = toolName.trim().toLowerCase();
	return Object.prototype.hasOwnProperty.call(CATEGORIES, key)
		? CATEGORIES[key]
		: "plain";
}

/**
 * The VERB a ledger row opens with, in the user's terms (chat redesign §E1;
 * design round 1, D5).
 *
 * The row used to print the tool's WIRE NAME in its first column - `read`,
 * `web_search`, `bash` - in a fixed-width column shared by every row, so a
 * snake_case identifier sat in the sans face looking like code in the wrong
 * font, and a short name left a hole before the object. §E1's row is a
 * sentence: `Ran pnpm vitest run`, `Read src/chat.tsx`, `Searched the web
 * sidebar sections` - the verb in sans, the object in mono right after it.
 *
 * `settled` is the past tense a finished row prints (failed rows too: "Ran",
 * with `failed` on the trailing edge, reads as what happened); `running` is the
 * present participle a live row prints. The glyph beside the verb still carries
 * the tool's identity (`tool-glyphs.ts`), so the verb can be plain English.
 *
 * `named` is false for a tool this table does not know - an MCP call, or a
 * builtin added after this table - where a generic verb (`Called`) says
 * nothing about WHICH call it was, so the row keeps the tool's display name as
 * the head of its object (`Called create_issue title=...`) rather than losing
 * the identity the old column carried.
 */
export type ToolVerb = { settled: string; running: string; named: boolean };

/**
 * The operation a call SELECTED, when its arguments name one.
 *
 * A meta tool with an `op` (or `action`, or `method`) is one tool that does
 * many jobs, and its name alone cannot say which: `agent` reads a profile just
 * as readily as it authors one. The row said `Delegated` for all of them,
 * which is the operator's report of 2026-09-27 - `Delegated list` for a profile
 * LISTING, and the same three reads counted as three delegated tasks in the
 * action group's summary - and it is wrong in both directions: nothing was
 * delegated, and the reader cannot tell an install from a search.
 *
 * The token is a NORMALISED lookup key, never copy: the verb tables below
 * decide what each one says, and an op this build does not know keeps the
 * tool's generic verb rather than being guessed into a neighbouring claim.
 * Lowercased and trimmed because the arguments are model-written.
 */
export function toolOp(
	args: Record<string, unknown> | null | undefined,
): string {
	if (!args) return "";
	for (const key of OP_ARG_KEYS) {
		const value = args[key];
		if (typeof value === "string" && value.trim()) {
			const token = value.trim().toLowerCase();
			/*
			 * `project`'s milestone op removes the named milestone when its `remove`
			 * flag is set (`project_tool.py`, ``milestone: remove the named
			 * milestone``), and `Updated milestone` would be a false claim for a
			 * removal - the same species as `Delegated list`. The flag composes the
			 * token, so the verb table can say which way the call went; the flag is
			 * the tool's own vocabulary, not a guess.
			 *
			 * The spellings are the FULL set the tool itself accepts, not only the
			 * bare boolean: pydantic 2.13.5 coerces `true`, `1`, and - any case -
			 * `"true"`, `"yes"`, `"y"`, `"t"`, `"on"`, `"1"` to True before the op
			 * runs (measured against the generation's own interpreter; the flag
			 * half of review round 2 QA Q1 - `"yes"` REMOVES in the wild), so each
			 * of those spellings must compose the removal token. `false`, `0` and
			 * every falsy string stay updates, as they run.
			 *
			 * There is deliberately no trim: pydantic REJECTS `" true "` (and
			 * `"true "`, `" true"`) while accepting the untrimmed spellings, so a
			 * padded value never removed anything and must not claim one. It falls
			 * to the update token like any other spelling outside the set - a
			 * rejected call's row is a display guess neither branch can settle
			 * (QA noted it; nothing composes a removal on a guess).
			 */
			const remove = args.remove;
			const removes =
				remove === true ||
				remove === 1 ||
				(typeof remove === "string" &&
					TRUTHY_FLAG_SPELLINGS.has(remove.toLowerCase()));
			if (token === "milestone" && removes) {
				return "milestone-remove";
			}
			return token;
		}
	}
	return "";
}

/**
 * The three spellings the harness uses for "which operation".
 *
 * `op` is what the meta tools' own schemas call it (`agent`, `team`, `hub`,
 * `secret`, `project`, `todo`, `wake`, `jobs`), the network tool spells it
 * `action` (its CLI's own word), and the console tool `method`. One list rather
 * than three parameters, because the extraction is the same question however
 * the schema spells the key.
 */
const OP_ARG_KEYS: ReadonlySet<string> = new Set(["op", "action", "method"]);

/**
 * Whether the operation token is the SELECTOR for this tool - i.e. the row's
 * verb is about to say it, so `summaryFromArgs` must not also echo it
 * (`agent({op:"list"})` reads `Listed list` otherwise).
 */
const isOpSelectable = (toolName: string): boolean =>
	Object.prototype.hasOwnProperty.call(
		TOOL_OP_VERBS,
		toolName.trim().toLowerCase(),
	);

const TOOL_VERBS: Record<string, Omit<ToolVerb, "named">> = {
	bash: { settled: "Ran", running: "Running" },
	eval: { settled: "Ran Python", running: "Running Python" },
	read: { settled: "Read", running: "Reading" },
	write: { settled: "Wrote", running: "Writing" },
	edit: { settled: "Edited", running: "Editing" },
	glob: { settled: "Listed", running: "Listing" },
	grep: { settled: "Searched", running: "Searching" },
	web_search: { settled: "Searched the web", running: "Searching the web" },
	web_fetch: { settled: "Fetched", running: "Fetching" },
	web_read: { settled: "Read", running: "Reading" },
	browser: { settled: "Browsed", running: "Browsing" },
	list_variables: { settled: "Listed variables", running: "Listing variables" },
	read_variable: { settled: "Read variable", running: "Reading variable" },
	ask: { settled: "Asked", running: "Asking" },
	send: { settled: "Sent", running: "Sending" },
	wait: { settled: "Waited for jobs", running: "Waiting for jobs" },
	team_delete: { settled: "Deleted team", running: "Deleting team" },
	project_delete: { settled: "Deleted project", running: "Deleting project" },
	peer: { settled: "Received", running: "Receiving" },
	/*
	 * `task` keeps `Delegated` and it is the only entry that earns it: `task`
	 * launches a subagent, which IS delegation. `agent`/`team`/`hub` used to sit
	 * beside it and every one of their calls was counted as a task handed off -
	 * the operator's report of 2026-09-27, where three agent-profile READS
	 * painted `Delegated` and folded into `delegated 3 tasks`. They live in
	 * `TOOL_OP_VERBS` below now, where the operation picks the word.
	 */
	task: { settled: "Delegated", running: "Delegating" },
};

/**
 * The verbs a tool uses when its ARGUMENTS name the operation, keyed by tool
 * and then by `toolOp`'s normalised token.
 *
 * A meta tool is one tool that does many jobs - `agent` reads a profile, finds
 * one by meaning, authors one, resets one - and the name alone cannot say
 * which. The static table above said `Delegated` for all eight ops, which is
 * wrong in both directions: it claims a hand-off that never happened and it
 * hides what the call actually was. These tables say it per op, in the same
 * short past/present style as the static ones.
 *
 * ONLY operations whose claims differ materially appear. A tool that is honest
 * with one word for every op stays in `TOOL_VERBS` - and a tool NOT in this
 * table keeps its `action`/`method` argument in the object column, so adding a
 * name here is also the switch that stops `summaryFromArgs` echoing the
 * selector.
 *
 * The vocabulary is read from the HARNESS, not invented: the keys are the
 * `Literal[...]` sets of the running build's own tool schemas (`agent_tool`,
 * `team_tool`, `secret_tool`, `project_tool`, and `hub`/`jobs`/`wake`/`network`/
 * `console`/`lsp` in the builtin tool module), so a row can only say an
 * operation the tool itself accepts.
 */
const TOOL_OP_VERBS: Record<string, Record<string, Omit<ToolVerb, "named">>> = {
	agent: {
		list: { settled: "Listed agents", running: "Listing agents" },
		show: { settled: "Viewed agent", running: "Viewing agent" },
		search: { settled: "Searched agents", running: "Searching agents" },
		install: { settled: "Installed agent", running: "Installing agent" },
		reset: { settled: "Reset agent", running: "Resetting agent" },
		create: { settled: "Created agent", running: "Creating agent" },
		update: { settled: "Updated agent", running: "Updating agent" },
		sync: { settled: "Synced agents", running: "Syncing agents" },
	},
	team: {
		list: { settled: "Listed teams", running: "Listing teams" },
		show: { settled: "Viewed team", running: "Viewing team" },
		create: { settled: "Created team", running: "Creating team" },
		update: { settled: "Updated team", running: "Updating team" },
	},
	hub: {
		list: { settled: "Listed subagents", running: "Listing subagents" },
		peek: { settled: "Peeked at", running: "Peeking at" },
		send: { settled: "Messaged", running: "Messaging" },
		ask: { settled: "Asked", running: "Asking" },
		steer: { settled: "Steered", running: "Steering" },
		pause: { settled: "Paused", running: "Pausing" },
		cancel: { settled: "Cancelled", running: "Cancelling" },
		resume: { settled: "Resumed", running: "Resuming" },
	},
	secret: {
		store: { settled: "Stored secret", running: "Storing secret" },
		retrieve: { settled: "Retrieved secret", running: "Retrieving secret" },
		list: { settled: "Listed secrets", running: "Listing secrets" },
		describe: { settled: "Described secret", running: "Describing secret" },
		update: { settled: "Updated secret", running: "Updating secret" },
		delete: { settled: "Deleted secret", running: "Deleting secret" },
	},
	project: {
		list: { settled: "Listed projects", running: "Listing projects" },
		show: { settled: "Viewed project", running: "Viewing project" },
		create: { settled: "Created project", running: "Creating project" },
		update: { settled: "Updated project", running: "Updating project" },
		// `link`/`unlink` act on the session named in the object, so the verb
		// carries the direction - `Linked session to myproject` reads as the
		// sentence it is, where a bare `Linked myproject` would not.
		link: { settled: "Linked session to", running: "Linking session to" },
		unlink: {
			settled: "Unlinked session from",
			running: "Unlinking session from",
		},
		milestone: { settled: "Updated milestone", running: "Updating milestone" },
		// The remove flag's own verb, composed by `toolOp`: the milestone op
		// UPDATES when the flag is off and REMOVES when it is on, and the row
		// says which (operator report follow-up, 2026-09-27: a removal must not
		// read as an update any more than a read may read as a delegation).
		"milestone-remove": {
			settled: "Removed milestone",
			running: "Removing milestone",
		},
	},
	todo: {
		// `view` is a read; every other op changes the list, which is the claim
		// the five share.
		view: { settled: "Read todos", running: "Reading todos" },
		init: { settled: "Updated todos", running: "Updating todos" },
		add: { settled: "Updated todos", running: "Updating todos" },
		done: { settled: "Updated todos", running: "Updating todos" },
		block: { settled: "Updated todos", running: "Updating todos" },
		drop: { settled: "Updated todos", running: "Updating todos" },
	},
	wake: {
		create: { settled: "Scheduled", running: "Scheduling" },
		list: { settled: "Listed wakes", running: "Listing wakes" },
		cancel: { settled: "Cancelled wake", running: "Cancelling wake" },
	},
	jobs: {
		list: { settled: "Listed jobs", running: "Listing jobs" },
		peek: { settled: "Peeked at", running: "Peeking at" },
		cancel: { settled: "Cancelled job", running: "Cancelling job" },
	},
	network: {
		// The reads first, each naming its own subject because the object column
		// is empty for a call that addresses the whole device or network.
		status: {
			settled: "Checked network status",
			running: "Checking network status",
		},
		ls: { settled: "Listed networks", running: "Listing networks" },
		show: { settled: "Viewed network", running: "Viewing network" },
		peers: {
			settled: "Listed network peers",
			running: "Listing network peers",
		},
		log: { settled: "Read network log", running: "Reading network log" },
		doctor: { settled: "Diagnosed network", running: "Diagnosing network" },
		// Then the trust-changing six, in the CLI's own vocabulary: `init`
		// creates, `invite` mints a token, `member_rm` removes a device,
		// `disconnect` leaves, `panic` rotates every member's secret.
		init: { settled: "Created network", running: "Creating network" },
		invite: { settled: "Invited device", running: "Inviting device" },
		join: { settled: "Joined network", running: "Joining network" },
		member_rm: { settled: "Removed device", running: "Removing device" },
		disconnect: { settled: "Left network", running: "Leaving network" },
		panic: { settled: "Raised panic", running: "Raising panic" },
	},
	console: {
		// `console` is the pane's own noun (its aria labels read "Close
		// console", "New console"), so the rows use it too.
		list: { settled: "Listed consoles", running: "Listing consoles" },
		create: { settled: "Opened console", running: "Opening console" },
		status: { settled: "Checked console", running: "Checking console" },
		read: { settled: "Read console", running: "Reading console" },
		screenshot: { settled: "Captured console", running: "Capturing console" },
		input: { settled: "Typed in console", running: "Typing in console" },
		keys: { settled: "Sent keys", running: "Sending keys" },
		resize: { settled: "Resized console", running: "Resizing console" },
		// The switch toggles both ways; `secured` would be a one-way claim, and
		// `input` is the pane's own word for it ("Secure input").
		secure: {
			settled: "Updated secure input",
			running: "Updating secure input",
		},
		close: { settled: "Closed console", running: "Closing console" },
	},
	lsp: {
		// Every lsp action is read-only (`tools/lsp.py`: `rename_preview`
		// computes the edits a rename WOULD make), so all four are reads.
		definitions: { settled: "Found definition", running: "Finding definition" },
		references: { settled: "Found references", running: "Finding references" },
		symbols: { settled: "Listed symbols", running: "Listing symbols" },
		rename_preview: {
			settled: "Previewed rename",
			running: "Previewing rename",
		},
	},
	sessions: {
		// The `sessions` tool's six ops (`tools/builtin.py`, the design note
		// `docs/design/sessions-tool.md` §3.1): a lifecycle ladder whose rungs
		// differ materially - reading a listing, inspecting, spawning,
		// resuming, stopping, peeking - which is why the verb is keyed by op
		// rather than the name alone (the operator's 2026-09-27 report's rule).
		// Every verb carries the noun the way `agent`'s rows do, because the
		// object column then never has to say `session` twice; `peek` keeps the
		// family's act-word (`hub`/`jobs` say `Peeked at`) with the noun beside
		// it so the row reads as the read it is.
		list: { settled: "Listed sessions", running: "Listing sessions" },
		info: { settled: "Viewed session", running: "Viewing session" },
		spawn: { settled: "Spawned session", running: "Spawning session" },
		resume: { settled: "Resumed session", running: "Resuming session" },
		stop: { settled: "Stopped session", running: "Stopping session" },
		peek: { settled: "Peeked at session", running: "Peeking at session" },
	},
};

/**
 * The verb for a tool name, and for its operation when the tool has an op
 * tier. Case-insensitive for the reason `toolIcon` is: the name is
 * model-controlled, and a provider that echoes `Bash` must not fall to the
 * generic verb.
 *
 * An op-aware tool with NO known operation - a composing call, a row whose
 * arguments the transcript did not keep, or an op newer than this table - takes
 * the GENERIC verb and keeps its name at the head of the object, exactly like a
 * tool the table has never heard of. That is the honest direction: `Called
 * agent foo` claims only that the call happened, while any op-specific verb
 * would be a guess about what it did.
 */
export function toolVerb(toolName: string, op?: string | null): ToolVerb {
	const name = toolName.trim().toLowerCase();
	const token = (op ?? "").trim().toLowerCase();
	const byOp = token ? TOOL_OP_VERBS[name]?.[token] : undefined;
	if (byOp) return { ...byOp, named: true };
	const known = TOOL_VERBS[name];
	if (known) return { ...known, named: true };
	return { settled: "Called", running: "Calling", named: false };
}

export type ToolRowLabel = {
	/** The verb column: `Ran` settled, `Running` live. */
	verb: string;
	/** The object column, with the bare-name stutter dropped. */
	object: string;
};

/**
 * The row's two label columns, from the row's own inputs.
 *
 * ONE composition serves two surfaces: `ToolRow` paints it, and the trace
 * fold's condensed header names the call it is running with it, so a collapsed
 * group says `Running pnpm vitest run` in exactly the words the expanded row
 * shows — the fold is not allowed to approximate a label the row already owns
 * (`trace-fold-model.ts`'s `foldLive`).
 *
 * `summary` is the caller's resolved summary text (`summaryFromArgs`, the
 * composing/queued words); `summaryFallback` is the stand-in the transcript
 * offers when the summary is only the tool's bare name (the output's first
 * line). The fold passes NO fallback: it names a call that has not finished, so
 * the output stand-in cannot exist yet and an empty object is the honest one.
 */
export function toolRowLabel(
	toolName: string,
	summary: string,
	summaryFallback: string | null,
	running: boolean,
	op = "",
	/**
	 * The settled verb a result STATES, over the tool's own (see
	 * `deliverySettledVerb`). `null` for every row but a `send` that provably
	 * delivered nothing, which is the one case the tool's own verb would
	 * contradict the trailing word beside it.
	 */
	settledVerb: string | null = null,
): ToolRowLabel {
	const verb = toolVerb(toolName, op);
	const bare = isBareToolName(summary, toolName)
		? (summaryFallback ?? "")
		: summary;
	return {
		verb: running ? verb.running : (settledVerb ?? verb.settled),
		object: verb.named
			? bare
			: [displayName(toolName), bare].filter(Boolean).join(" "),
	};
}

/* ----------------------------------------------------------- diff body */

/**
 * The tools whose expansion IS the diff.
 *
 * Only the two this backend has. `_TOOL_CATEGORY` (tool_card.py:178-198) lists
 * exactly `write` and `edit` as mutating tools, and `_diff_details`
 * (tools/builtin.py:4863-4888) is called from `execute_write` and
 * `execute_edit` alone. The mobile port's set also names `apply_patch` and
 * `patch` (mobile/web/src/components/tool-row.tsx:75); this backend exposes no
 * such tool, so listing them here would claim support for a name that can only
 * arrive from an MCP server shadowing it — and an MCP row's `details` are not
 * this payload.
 */
export const DIFF_BODY_TOOLS = new Set(["write", "edit"]);

/** Whether a row's expansion is the diff body rather than its arguments. */
export function isDiffBodyTool(toolName: string): boolean {
	return DIFF_BODY_TOOLS.has(toolName.trim().toLowerCase());
}

/**
 * Whether a settled row expands to its DIFF rather than to its arguments.
 *
 * Three conditions, and the third is the terminal's own: `_build_content`
 * selects the diff-alone body on `self._state == "success" and self._diff`
 * (tool_card.py:1928-1939), and that success gate is not decorative. A case it
 * rejects is a write that FAILED: the args are the only account of what was
 * attempted and the error only makes sense beside them, so a row that shipped
 * both a diff and an error must paint the arguments and the error, not a diff
 * alone. The producer agrees today — every error exit goes through `_error`
 * (tools/builtin.py:1041) or `_invalid_arguments` (`:1051`, which does set
 * `details`, but only its `FAULT_KEY` fault marker at `:1066`; it is
 * `details.diff` that no error path sets), and all 9,501 real rows carrying
 * `details.diff` measured on 2026-09-12 are successful
 * `write`/`edit` results — so the guard has no live case; it is here because the
 * reference keeps it and "no producer does this yet" is not a rule a renderer
 * can rely on. `scripts/tool-row.test.mjs` pins it.
 *
 * It lives here rather than inline in `canonical-transcript.tsx` so the rule has
 * one home a test can exercise: there is no React test host in this repo, and an
 * expression buried in a JSX ternary is only assertable by reading the source.
 */
export function isDiffBodyRow<
	T extends {
		toolName: string;
		diff: readonly string[] | null;
		isError: boolean;
	},
>(row: T): row is T & { diff: readonly string[] } {
	return isDiffBodyTool(row.toolName) && row.diff !== null && !row.isError;
}

/**
 * The unified diff a `write`/`edit` RESULT carries, as view-ready lines.
 *
 * Source of truth: `_diff_details` (tools/builtin.py:4863-4888) puts a
 * `difflib.unified_diff(..., n=2, lineterm="")` line list on `details.diff`,
 * capped at `_DIFF_DETAILS_CAP_LINES = 200` with a literal `…` appended as the
 * LAST element when it truncated. Nothing on this side recomputes a diff — the
 * payload is the producer's own bytes, which is what keeps the row's `+N/-N`
 * counters and the body beside them describing one change.
 *
 * A string payload is tolerated, and it is DEFENSIVE TOLERANCE rather than a
 * shape any producer emits. Measured over every transcript on this machine:
 * 9,501 `details.diff` values across the 1,166 stored transcripts it held on
 * 2026-09-12 are lists of strings
 * — no strings, no non-string members, no empty lists, none on an `is_error` row
 * (a dated snapshot of a live store, not a fixed property) — and the fold this file
 * used to blame for the string shape does not produce one either:
 * `mobile/projection.py:284-288` copies each key through untouched, so a list
 * stays a list. (The phone's `diff?: string | string[]` type is its own
 * normaliser's tolerance, not evidence about the wire.) The belt costs one
 * `typeof` at a boundary that is `unknown` by construction; `Array.isArray`
 * alone would drop a row's body while the counters beside it still said `+42`.
 * The reason to keep it is untyped boundaries, not provenance.
 *
 * Non-string members are DROPPED rather than stringified: `String({})` is
 * `"[object Object]"`, a line no producer ever wrote, and a diff is a record of
 * what happened. Absent, empty and all-malformed payloads are `null` — "this
 * call reported no diff" — and a row with no diff keeps its arguments, which is
 * the honest shape for a call that reported nothing.
 */
export function diffFromDetails(details: unknown): string[] | null {
	if (!details || typeof details !== "object") return null;
	const raw = (details as Record<string, unknown>).diff;
	if (typeof raw === "string") {
		// Tolerance for an untyped boundary, not a producer's shape: every real
		// payload measured is a list (see the doc above). An empty string is "no
		// diff", not one blank line.
		return raw ? raw.split("\n") : null;
	}
	if (!Array.isArray(raw)) return null;
	const lines = raw.filter((line): line is string => typeof line === "string");
	return lines.length ? lines : null;
}

/** Element-wise equality, for the identity gate below. */
export function sameDiff(
	a: readonly string[] | null,
	b: readonly string[] | null,
): boolean {
	if (a === b) return true;
	if (!a || !b || a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
	return true;
}

/**
 * Never let a replay erase a diff a row already showed.
 *
 * "This event carried no diff" and "this call reported no change" are different
 * claims, and only the second may clear a row — the same argument
 * `preferExisting` makes for images. The live-event budget strips `details` from
 * a later frame (`_bound_live_result_in_place`, session/frontend_state.py,
 * drops `details` when the row exceeds its share of the frame), so a replayed
 * `tool_execution_end` legitimately arrives with nothing where a diff already
 * sat, and letting that win would blank the body of the row the user is
 * reading.
 *
 * Returns the previous array BY REFERENCE whenever the two are equal, which is
 * what keeps the record's identity stable: `shallowEqual` compares by `!==`, so
 * a freshly built array of identical lines would report every polled delta as a
 * change and re-render the row (and its 200-line body) on a surface that
 * repaints per token.
 */
export function preferDiff(
	next: string[] | null,
	previous: string[] | null,
): string[] | null {
	if (next === null) return previous;
	if (sameDiff(next, previous)) return previous;
	return next;
}

/**
 * The `+N` / `-M` counters a result reports, under `preferDiff`'s rule.
 *
 * The counters and the diff body come from one `details` object, and a frame the
 * live-event budget stripped carries NEITHER. Only the body used to be guarded,
 * so a conversation opened mid-turn showed an `edit` row with no counts whose
 * expansion still held the diff: the snapshot applies its durable page first
 * (the row gets `details = {added: 91, removed: 19, diff}`), then `applyLiveSeed`
 * re-applies the seed's `tool_execution_end` for the same call with
 * `details: null` — `_bound_live_result_in_place` (session/frontend_state.py)
 * drops `details` once it costs more than a quarter of the row's share, and with
 * 100 retained ends the share is 560 characters, so the limit is 140 and nearly
 * every edit in a busy turn loses it. Reading counts out of `null` wrote 0/0 over
 * the durable counts while `preferDiff` kept the body beside them.
 *
 * So: a frame with NO `details` object says nothing about the counts and keeps
 * `previous`; a frame WITH one is the producer's statement and wins, including a
 * statement of zero (the same "absent vs stated" split `preferDiff` makes). Kept
 * here beside `preferDiff` so the two guards on one `details` object are one
 * rule in one file and cannot drift apart again.
 *
 * Counts follow `diffCount` (the TUI's `_diff_counts`): only a positive integer
 * counts, anything else is zero.
 */
export function preferDiffCounts(
	details: unknown,
	previous: { added: number; removed: number } | null,
): { added: number; removed: number } {
	if (!details || typeof details !== "object") {
		return {
			added: previous?.added ?? 0,
			removed: previous?.removed ?? 0,
		};
	}
	const source = details as Record<string, unknown>;
	return {
		added: diffCount(source.added),
		removed: diffCount(source.removed),
	};
}

/**
 * Drop the nameless `---`/`+++` file-header pair, POSITIONALLY.
 *
 * `_append_diff_body` (tool_card.py:2178-2225). The tool diffs one file's
 * before/after in memory, so `difflib` emits the headers with EMPTY filenames
 * (`"--- "` / `"+++ "`, trailing space from the empty name and no line
 * terminator) and the path already heads the summary row. Two blank-label rows
 * above every diff were pure chrome.
 *
 * Only lines 0 and 1 are examined, and only when they are exactly that pair
 * after trailing-whitespace removal. A PATTERN filter over the body would be a
 * data-loss bug rather than a cosmetic one: a removed content line can itself
 * begin `--` (a SQL/Lua comment, say) and renders as `--- …` inside the body,
 * so a pattern filter would silently delete the very record this body now
 * solely carries.
 */
export function stripDiffHeader(diff: readonly string[]): string[] {
	if (
		diff.length >= 2 &&
		rstrip(diff[0]) === "---" &&
		rstrip(diff[1]) === "+++"
	) {
		return diff.slice(2);
	}
	return diff.slice();
}

/** Trailing whitespace on a diff line, for the terminal's `rstrip()`. */
const TRAILING_WHITESPACE = /\s+$/;

/** Trailing-whitespace removal, matching the terminal's `rstrip()` per line. */
function rstrip(line: string): string {
	return line.replace(TRAILING_WHITESPACE, "");
}

/** Where a diff line's ink comes from, by its LEADING character only. */
export type DiffLineKind = "hunk" | "added" | "removed" | "context";

/**
 * The line's kind, from its leading character alone.
 *
 * `_append_diff_body` (tool_card.py:2208-2218): `@` is a hunk header, `+` an
 * addition, `-` a removal, and everything else is context. Only the FIRST
 * character is consulted, so a context line whose text happens to start with
 * `-` after its own marker is still context.
 *
 * The KIND decides the ink for the WHOLE line (diff-block.tsx), which is what
 * the same loop does at `:2220`.
 */
export function diffLineKind(line: string): DiffLineKind {
	const marker = line.slice(0, 1);
	if (marker === "@") return "hunk";
	if (marker === "+") return "added";
	if (marker === "-") return "removed";
	return "context";
}

/**
 * Lines the expanded body shows, `EXPAND_MAX_LINES` in the terminal.
 *
 * `EXPAND_MAX_LINES = 40` (tool_card.py:276) is the shared cap for every
 * expanded body, so a diff and an output block shed at the same depth.
 */
export const DIFF_EXPAND_MAX_LINES = 40;

/** One rendered diff line: the ink marker, the rest, and the kind they came from. */
export type DiffBodyLine = {
	/** The line as painted, trailing whitespace removed. */
	text: string;
	/** The leading character the marker ink is chosen by; `""` on a blank line. */
	marker: string;
	kind: DiffLineKind;
};

export type DiffBody = {
	lines: DiffBodyLine[];
	/** Lines the cap hid, for the overflow marker. */
	hidden: number;
};

/**
 * The body the expanded row paints: header-stripped, rstripped, classified and
 * capped, so the component below stays presentational.
 *
 * The cap counts lines AFTER the header strip, as the terminal does, and the
 * overflow count is the number of remaining lines — including the producer's
 * own trailing `…` on a diff truncated at 200, which is ordinary content line
 * 201 rather than this marker. That is why the two are separate ideas here: the
 * producer's `…` is a dim line inside the body, this one is the dim line below
 * it that says how much is not shown.
 */
export function diffBody(diff: readonly string[]): DiffBody {
	const stripped = stripDiffHeader(diff);
	const shown = stripped.slice(0, DIFF_EXPAND_MAX_LINES);
	return {
		lines: shown.map((raw) => {
			const text = rstrip(raw);
			return { text, marker: text.slice(0, 1), kind: diffLineKind(text) };
		}),
		hidden: stripped.length - shown.length,
	};
}

/**
 * The overflow marker, spelled exactly as the terminal spells it.
 *
 * `f"… {hidden} more diff line{'s' if hidden != 1 else ''}"`
 * (tool_card.py:2222-2223) — including the singular case, because "… 1 more
 * diff lines" is the kind of copy a reader notices instead of the number.
 */
export function diffOverflowLabel(hidden: number): string {
	return `… ${hidden} more diff line${hidden === 1 ? "" : "s"}`;
}
