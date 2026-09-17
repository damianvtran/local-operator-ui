/**
 * Canonical transcript reducer.
 *
 * Turns the backend's three sources of conversation truth into ONE ordered
 * list of typed records the transcript view can paint:
 *
 *   1. durable history rows (`GET /history`, and the snapshot's history page),
 *   2. the snapshot's `live_events` seed (the bounded in-flight turn a
 *      frontend that joins mid-turn would otherwise miss), and
 *   3. live `event` frames after the snapshot.
 *
 * The invariant this module exists for is the same one the TUI and the phone
 * enforce: **durable before live, and a record id is painted once.** A turn
 * that becomes durable between the snapshot and a history page must replace
 * its live counterpart, never sit beside it. That is why every record here is
 * keyed by the backend's own message id (user rows carry the request UUID, so
 * an optimistic echo and the owner's `message_start` coalesce for free).
 *
 * The reducer is deliberately pure and synchronous. Frame coalescing (one
 * animation frame per batch) happens in the stream hook; this module only
 * guarantees that applying the same frame twice is idempotent and that an
 * older replayed event can never regress a newer painted record — which is
 * the property the reconnect path depends on when it replays from a cursor.
 *
 * Records are immutable values: a delta that changes nothing returns the
 * SAME record object, and `applyEvent` returns the same state object when
 * nothing changed. The view's memoisation is only as good as that gate.
 */

import type {
	CanonicalFrontendState,
	DesktopHistoryPage,
} from "../../../../../shared/desktop-session-contract";
import {
	type PeerSender,
	peerFields,
	sameSender,
	wakeIsCatchup,
} from "../components/trace/receipt-row-model";
import {
	diffFromDetails,
	preferDiff,
} from "../components/trace/tool-row-model";

/**
 * One image on a transcript row.
 *
 * Two sources, one shape. A LIVE event carries the bytes inline, because the
 * owner dumps events without `exclude_defaults` — so `type` and `data` are both
 * present. A DURABLE row carries only a content-addressed digest, because the
 * transcript externalises every image over 1 KiB of base64 into
 * `<config>/attachments/<digest>.bin` and strips `data` from the row. The view
 * must handle both without knowing which it came from, so exactly one of `data`
 * and `attachment` is populated and the resolver decides how to turn it into a
 * URL.
 */
export type TranscriptImage = {
	/** Stable key: `${recordId}:${index}`, indexed among IMAGE blocks only. */
	id: string;
	/** Base64 payload when the event carried it inline. Live path. */
	data: string | null;
	/** Attachment-store digest when the row referenced it. Durable path. */
	attachment: string | null;
	mimeType: string;
};

/** The § 7 tier a record renders at, decided once here rather than per view. */
export type TranscriptRecord =
	| {
			kind: "user";
			id: string;
			ts: number;
			text: string;
			images: TranscriptImage[];
	  }
	| {
			kind: "assistant";
			/** Only a full durable history read certifies the actual ending. */
			complete?: boolean;
			id: string;
			ts: number;
			text: string;
			/** Still receiving deltas; the view shows the text without a cursor. */
			streaming: boolean;
			/** Provider stop reason when settled: refusal/error/aborted change ink. */
			stopReason: string | null;
			error: boolean;
	  }
	| {
			kind: "tool";
			id: string;
			ts: number;
			toolCallId: string;
			toolName: string;
			/** The model's own `i` narration, when it wrote one. */
			intent: string | null;
			args: Record<string, unknown> | null;
			/** compose -> running -> done. Compose means arguments still arriving. */
			phase: "composing" | "running" | "done";
			argumentBytes: number;
			output: string | null;
			isError: boolean;
			durationS: number | null;
			/**
			 * Wall-clock ms when the call began EXECUTING, for the running row's
			 * live clock. `null` on any settled row, which reports the duration the
			 * backend measured instead.
			 *
			 * The row needs this because `durationS` is `null` for the whole life of
			 * a running call — it only arrives on `tool_execution_end` — so a row
			 * without it renders `0s` from start to finish and a two-minute call
			 * looks identical to a two-second one. The spec makes the ticking number
			 * load-bearing (`CLOCK_INTERVAL_S = 1.0`): an empty status column says
			 * "still running", and the clock is what says for how long.
			 *
			 * It is the EXECUTION start, not the compose start, so it measures the
			 * same span the settled `durationS` reports and the number does not jump
			 * when the row settles.
			 */
			startedAt: number | null;
			/**
			 * Screenshots the call returned. This is what makes a browser-tool
			 * capture visible: the bytes are already on the wire in
			 * `tool_execution_end`, and until now the reducer dropped them.
			 */
			images: TranscriptImage[];
			/** Lines added, from the call's own `details`. Zero means unknown. */
			added: number;
			/** Lines removed, from the call's own `details`. Zero means unknown. */
			removed: number;
			/**
			 * The unified diff the call reported, one element per line, or `null`
			 * when it reported none.
			 *
			 * `write`/`edit` results carry `details = {path, added, removed, diff}`
			 * (`_diff_details`, tools/builtin.py:4863-4888) and the expanded row
			 * paints THIS rather than the arguments, because a `write`'s arguments
			 * are the whole new file content — the same change stated a second way,
			 * at full payload length. The backend omits `diff` entirely when nothing
			 * changed (`_diff_details` returns counts alone), so `null` here is a
			 * real statement: this call reported no change, and the row falls back
			 * to its arguments.
			 *
			 * Normalised by `diffFromDetails` rather than read inline: the extraction is
			 * the ported arithmetic's rule, not the reducer's, and it tolerates a
			 * malformed or unexpected payload (and a pre-joined string, which is
			 * defensive tolerance at an untyped boundary rather than a shape any
			 * producer sends — see `tool-row-model.ts`) without taking the row down.
			 */
			diff: string[] | null;
			/**
			 * The call was still running when the turn was aborted, so it never
			 * reported an outcome of its own.
			 *
			 * Distinct from `isError` on purpose, and the TUI draws it with a third
			 * glyph for the same reason: a call the USER stopped did not fail, and
			 * reporting a deliberate interrupt as a failure blames the agent for the
			 * user's own decision.
			 */
			stopped: boolean;
	  }
	| {
			kind: "notice";
			/** A durable completion marker, not an arbitrary renderer notice. */
			complete?: boolean;
			id: string;
			ts: number;
			text: string;
			level: "info" | "warning" | "error";
	  }
	| {
			kind: "custom";
			id: string;
			ts: number;
			customType: string;
			/** The row's rendered body, as persisted. */
			text: string;
			/**
			 * The § 7 tier this row paints at, decided here rather than in the view.
			 *
			 * A `session_incident` is the reason a turn DIED, so it is an error:
			 * the danger glyph and the danger label ink. Every other custom row is
			 * the harness telling the reader that something changed (a model switch,
			 * a recovered MCP server, a stored credential) or relaying a message,
			 * which is informational.
			 */
			level: "info" | "error";
			/**
			 * What the row paints where a tool row paints its action, and it is the
			 * MESSAGE rather than the row's type name: an incident's own error text,
			 * a statement's sentence, or a bulky relayed payload's first substantive
			 * line. See `customRow` for which type says what, and why.
			 */
			headline: string;
			/**
			 * Supporting text behind the row's disclosure, or `null` when the row has
			 * said everything it has to say — an incident's suggested action and tail
			 * sentence, or a relayed payload's whole body. `null` is also what makes
			 * the row a static line rather than a trigger revealing nothing.
			 */
			detail: string | null;
			/**
			 * An incident's classification (`mcp`, `rate-limit`, `cut-off`, …), which
			 * is its label: a scanning reader gets what KIND of failure next to the
			 * failure's own words. `null` on every other custom row.
			 */
			category: string | null;
			/**
			 * The `provider/model` the incident names in its head
			 * (`[session incident (anthropic/claude-opus-5)] rate-limit: …`), which the
			 * row paints in the ledger's machine-voice `object` column.
			 *
			 * It is carried because the harness's own advice for a rate limit is "tell
			 * the user which provider hit the limit", and for an operator running
			 * several providers that is the decision-relevant half of the row.
			 * `null` when the incident names none (every no-provider `cut-off`, and
			 * every non-incident custom row).
			 */
			provider: string | null;
			attribution: "user" | "agent" | "system";
	  }
	| {
			/**
			 * An inbound cross-session message (`lop send` between live sessions).
			 *
			 * Its own kind rather than a `custom` row, because what a `custom` row
			 * paints is `details.text` and a peer delivery's `details.text` is the
			 * MODEL-FACING provenance envelope. `peerFields` is what keeps it out of
			 * the record.
			 */
			kind: "peer";
			id: string;
			ts: number;
			/** The message as the peer wrote it. Never the envelope. */
			body: string;
			/** Advisory identity of the sender; any field may be empty. */
			sender: PeerSender;
	  }
	| {
			/**
			 * A scheduled-wake delivery receipt.
			 *
			 * A RECEIPT, not a call: a wake fires with no user keystroke, and before
			 * this kind the transcript showed the agent simply starting to work with
			 * nothing recording which wake caused it (the TUI's `WakeBlock`).
			 */
			kind: "wake";
			id: string;
			ts: number;
			/**
			 * The delivery verbatim: `<envelope>\n\n<prompt>`. The headline and the
			 * prompt are DERIVED from it at paint time (`receipt-row-model`), so the
			 * state holds what arrived rather than one rendering of it.
			 */
			text: string;
	  }
	| {
			kind: "compaction";
			id: string;
			ts: number;
			text: string;
			/**
			 * The pass's FINGERPRINT: the `tokens_before` the pass reported, which
			 * both projections of one pass carry — the live id spells it
			 * (`compaction:<generation>:<before>:<after>`) and the durable entry has
			 * it in `payload.tokens_before`.
			 *
			 * WHY A FINGERPRINT RATHER THAN A CLOCK. The two projections are written
			 * by different clocks in a fixed order: the backend awaits
			 * `append_compaction` (ts = `time.time()`) and only then emits the settle
			 * event, and the renderer stamps the live line with `Date.now()` when it
			 * processes that frame — so the durable row is ALWAYS the older of the
			 * two, whichever arrives first (agent review round 4, R4-1: a
			 * time-ordered relation painted one pass as two rows in production). The
			 * fingerprint is the identity the pair actually shares, and it is the only
			 * key that cannot be confused by a second pass nearby.
			 *
			 * `undefined` when the pass reported no figure — an older transcript, or a
			 * row written before `tokens_before` existed. That is what the window
			 * fallback in `collapseSettledCompactions` is for.
			 */
			before?: number;
	  };

export type TranscriptState = {
	/** Ordered oldest -> newest. */
	records: TranscriptRecord[];
	/** id -> index for O(1) coalescing; rebuilt on every structural change. */
	index: Map<string, number>;
	/** Backend generation of the turn currently in flight, if any. */
	generation: number;
	/**
	 * A compaction pass is in flight, from `compaction_start` to `compaction_end`.
	 *
	 * A BOOLEAN ON THE TRANSCRIPT rather than a latch in app state, because the
	 * two facts that end it are transcript facts: the settling frame, and the
	 * replacement of the transcript the claim was made against. It is what the
	 * working line's `compacting context` rung reads; see `COMPACTING_ACTIVITY`
	 * in `working-line-model.ts` for what outranks it and why a dead transport
	 * SUPPRESSES the rung instead of clearing the flag.
	 *
	 * EVERY WAY IT IS CLEARED, enumerated because a claim that outlives its pass
	 * is a claim nobody can vouch for (review round 1, R3 asked for this list to
	 * be true rather than asserted): `compaction_end` — success, or the same
	 * frame with `success: false` — applied BEFORE that case's idempotence guard,
	 * so a replay still retires a claim it has already painted for; the pass's own
	 * DURABLE row, refused or otherwise, which is projected by `durableRecord`;
	 * `agent_start`, because a turn cannot begin under a live pass; a replaced
	 * transcript (`replaceTranscript`/`clearView` keeps it, a rebuild does not);
	 * `dropLiveRecords`, whose receipt gap is the runtime saying its live window
	 * is gone; and `applyLiveSeed`, whose clear is the "a reconnect must not
	 * resurrect a claim" half.
	 *
	 * THE ONE SEQUENCE WITH NO EVENT TO KEY ON, stated rather than papered over:
	 * a pass whose `compaction_end` frame is lost with no observed receipt gap,
	 * over an idle session that never reconnects, never reads history and sends
	 * nothing, leaves the rung standing until one of those happens. There is no
	 * frame to key a retirement on — the backend emits the end once — so the
	 * honest repair is a timeout this pure reducer cannot own, or a backend
	 * replay. Neither is in this change; QA round 1 could not reproduce the
	 * sequence (the mock's pass cannot lose a single frame) and the reviewer's
	 * mutation runs cover every transition above.
	 */
	compacting: boolean;
	/**
	 * When the standing claim began, on this reader's clock, or 0 when there is
	 * none.
	 *
	 * WHY IT IS STAMPED RATHER THAN INFERRED. A durable outcome row retires the
	 * claim, and "has this reader painted the row" is a fact about the INDEX
	 * rather than about the pass: an older page merged by `load older` carries a
	 * compaction outcome the reader has never painted, and retired a pass that
	 * was still running — killing both the rung and the composer's hint mid-pass
	 * (review round 2, NEW-1). The stamp is the pass's own start, so an outcome
	 * OLDER than it is somebody else's pass and retires nothing. Both clocks are
	 * this machine's: the runtime is local, and its `ts` is the same wall clock
	 * the frame arrived on.
	 */
	compactingSince: number;
	/**
	 * Bumped by every wholesale view reset — the `/clear` contract, which paints
	 * an empty view over a session that is still on the backend.
	 *
	 * WHY A COUNTER RATHER THAN A FLAG. A scheduled read cannot ask "was the view
	 * cleared since I was scheduled" of `records.length === 0`: an empty view is
	 * also a session that has not loaded yet, and a session that was never
	 * non-empty. Comparing the epoch it captured with the epoch on the view is the
	 * only honest answer, and `/clear` inside the read's window otherwise put the
	 * cleared rows back on a screen the user had just emptied (review round 3,
	 * U11/Q7/R3-7).
	 */
	viewEpoch: number;
	/**
	 * Wall-clock ms of the last `/clear`, or `undefined` if the view has never
	 * been cleared.
	 *
	 * WHY THIS EXISTS, and it is a MEASUREMENT rather than a theory. A cleared view
	 * must admit the outcome row of the pass the read exists for and no earlier
	 * pass's. The first attempt scoped that to the READ's own instant (the command
	 * receipt), on the reasoning that a pass's row cannot be written before the
	 * receipt that started it. Measured on a real runtime, that is false for the
	 * fast path: refusing an empty conversation takes no model call, so
	 * `_record_compaction_refusal` wrote the row 24 ms BEFORE the client even held
	 * the HTTP response — and the renderer takes its `since` after receiving it, so
	 * every such refusal fell outside the scope and the pane stayed silent (QA
	 * round 7's Q15, reproduced here on a real serve rather than a mock).
	 *
	 * The clear instant is the boundary the rule actually needs: a pass whose
	 * receipt was sent after the clear writes its row after the clear, whatever the
	 * write-to-receipt gap is, and a pre-clear pass's row is before it by
	 * construction. It is deliberately NOT a tolerance window — that would be a
	 * clock guess standing in for a fact the state can hold.
	 */
	clearedAt?: number;
	/** Oldest durable id painted; the cursor for `sessions.history` paging. */
	oldestId: string | null;
	hasMore: boolean;
	/**
	 * Call id -> the arguments that call was made with, accumulated across every
	 * page and live event seen so far.
	 *
	 * WHY THIS OUTLIVES A PAGE. A durable tool row carries the RESULT and not the
	 * arguments: the arguments live on the paired assistant row's `tool_calls`.
	 * Those two entries are usually adjacent, so a map built per page finds them
	 * — but not always, and when it misses, the row settles with `args: null`,
	 * `summaryFromArgs` falls back to the tool name, and the row loses the object
	 * column that is its whole identity (the TUI reference: the command runs
	 * nearly the full width because it is the fact the row exists to carry).
	 *
	 * Two ways they separate, both real. A page BOUNDARY can fall between the
	 * assistant row and its results. And on reconnect the backend evicts
	 * `tool_execution_start` for any call whose `_end` survived the live-event cap
	 * (`frontend_state.py`, `LIVE_EVENT_END_ROWS_MAX`), so the seed keeps the end
	 * — which has no args — and drops the start, which is the only live carrier of
	 * them. That is what produced the run of nine identical unlabelled `bash`
	 * rows in this PR's own evidence.
	 *
	 * The data is not the limitation: `arguments` is present on 100% of
	 * `tool_calls` across 26,973 real tool rows. Only the lookup window was too
	 * narrow, so it is widened to the session rather than the page, and a later
	 * page can backfill a row an earlier one painted blank.
	 *
	 * The value is what the session knows about the call: `arguments` as above,
	 * plus `anchoredAt` — epoch ms of the frame or durable row that STATED the
	 * call, i.e. roughly when it was composed. `anchoredAt` is a POSITION, not a
	 * label: the seed can be handed a settling frame for a call made hours
	 * earlier (`tool_execution_end` carries no clock at all, and the start that
	 * did is deleted from the seed by the same fold that appends the end), and
	 * the durable row that named the call is then the only statement of WHEN it
	 * happened. See `seededClock`.
	 */
	argsByCall: Map<string, Record<string, unknown>>;
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
	records: [],
	index: new Map(),
	generation: 0,
	compacting: false,
	compactingSince: 0,
	viewEpoch: 0,
	oldestId: null,
	hasMore: false,
	argsByCall: new Map(),
};

/**
 * One frame's `args`, when it has any, as a plain object.
 *
 * The wire is untyped at this boundary, so anything that is not a non-array
 * object (absent, `null`, a string a provider sent in place of the object) is
 * treated as "this frame says nothing" rather than reaching `summaryFromArgs`
 * as a value whose `Object.entries` would enumerate something meaningless.
 */
function frameArgs(value: unknown): Record<string, unknown> | null {
	if (!value || typeof value !== "object" || Array.isArray(value)) return null;
	return value as Record<string, unknown>;
}

/**
 * The arguments a call was made with, from whichever source still carries them.
 *
 * Three producers know them and not one of them is reliable alone:
 *
 *   1. `tool_execution_start` — the only LIVE frame that carries `args`.
 *   2. the durable assistant row's `tool_calls` — accumulated into
 *      `TranscriptState.argsByCall`, which is the only source that survives a
 *      page boundary or an evicted start.
 *   3. the settling frame itself, which carries none today but may in future
 *      (a runtime that echoes `args` on `tool_execution_end`).
 *
 * WHY A SETTLING ROW NEEDS THIS AT ALL. `tool_execution_end` is
 * `{tool_call_id, tool_name, result, duration_s, is_error}` — no `args` — and
 * it is the frame a viewer joining a turn ALREADY IN FLIGHT is handed for every
 * call that finished before it arrived: `frontend_state._fold_live_event` keeps
 * the end and drops the start it replaces (`live = [item for item in live if
 * item.get("tool_call_id") != call_id]`), and the same file caps the seed at
 * `LIVE_EVENT_END_ROWS_MAX = 100` ends. So the seed is a list of argument-less
 * ends, and a row painted from one had no object column at all: it fell through
 * to the output's first line, which for `bash` is the literal string
 * `exit code: 0`. A whole turn of rows then said nothing about what ran.
 *
 * Precedence is frame, then row, then session map. The frame wins because it is
 * the newest statement about THIS call; the map loses because it is the oldest
 * and can be stale about a re-issued id.
 */
function knownArgs(
	state: TranscriptState,
	callId: string,
	event: Record<string, unknown>,
	current: TranscriptRecord | undefined,
): Record<string, unknown> | null {
	return (
		frameArgs(event.args) ??
		(current?.kind === "tool" ? current.args : null) ??
		frameArgs(state.argsByCall.get(callId)?.arguments)
	);
}

type ContentBlock = {
	/** Absent on durable rows: the encoder drops pydantic defaults. */
	type?: string;
	text?: string;
	/** Inline base64. Live events always; durable rows only under 1 KiB. */
	data?: string;
	/** Attachment-store digest. Durable rows over 1 KiB. */
	attachment?: string;
	mime_type?: string;
};

/**
 * Whether a content block is an image, on EITHER wire shape.
 *
 * `type` cannot be the discriminant. The transcript encoder dumps with
 * `exclude_defaults=True` and `type` IS the pydantic default on both content
 * models, so it is absent from every durable row — the encoder's own comment
 * (`session/transcript.py:215-218`) says to identify an image by `data`, never
 * by `type`. A durable image block is therefore one of exactly
 * `{attachment, mime_type}` (the normal case, over the 1 KiB externalisation
 * floor) or `{data}` (under it), while a durable TEXT block is `{text}`.
 *
 * The old predicate tested `type === "image"` alone, which is true only of a
 * LIVE event — the owner dumps events without `exclude_defaults`. So
 * "N images attached" appeared while a turn was in flight and never once after
 * a reload. Verified against real transcripts on this machine: 6398 tool-role
 * and 192 user-role blocks whose keys are exactly `(attachment, mime_type)`,
 * with no `type` on any of them.
 */
function isImageBlock(block: ContentBlock | undefined): boolean {
	if (!block) return false;
	if (block.type === "image") return true;
	if (typeof block.attachment === "string" && block.attachment) return true;
	// A `data` key with no `type` is the sub-floor durable image. A text block
	// never carries `data`, so this cannot swallow one.
	return typeof block.data === "string" && block.data.length > 0;
}

/** Text of a canonical message: concatenated text blocks. */
export function messageText(message: Record<string, unknown> | undefined) {
	const content = message?.content;
	if (!Array.isArray(content)) return "";
	return (
		(content as ContentBlock[])
			// Excluded explicitly rather than by the `type` default. A typeless
			// durable image used to pass this filter and contribute `""`, which was
			// harmless only by accident; now that `isImageBlock` exists, relying on
			// that accident is a defect waiting for the first image block that also
			// carries a text key.
			.filter((block) => block && !isImageBlock(block))
			.filter((block) => (block.type ?? "text") === "text")
			.map((block) => block.text ?? "")
			.join("")
	);
}

/**
 * The image blocks of one message, as view-ready records.
 *
 * Identity is the point of the second argument. This surface repaints per
 * token and `shallowEqual` compares by reference, so a freshly built array
 * would fail the equality gate on every frame and re-render every image row of
 * the transcript per delta. `previous` is the array the record already holds:
 * when the extracted contents are identical, THAT array is returned, so the
 * record's `images` field keeps its reference and the gate holds.
 */
function extractImages(
	message: Record<string, unknown> | undefined,
	recordId: string,
	previous?: TranscriptImage[],
): TranscriptImage[] {
	const content = message?.content;
	if (!Array.isArray(content))
		return previous?.length ? previous : EMPTY_IMAGES;
	const images: TranscriptImage[] = [];
	for (const block of content as ContentBlock[]) {
		if (!isImageBlock(block)) continue;
		images.push({
			// Position among IMAGE blocks only, so a text block appearing between
			// two images cannot renumber them and remount both.
			id: `${recordId}:${images.length}`,
			data: typeof block.data === "string" && block.data ? block.data : null,
			attachment:
				typeof block.attachment === "string" && block.attachment
					? block.attachment
					: null,
			mimeType:
				typeof block.mime_type === "string" && block.mime_type
					? block.mime_type
					: "image/png",
		});
	}
	if (images.length === 0) return EMPTY_IMAGES;
	if (previous && sameImages(previous, images)) return previous;
	return images;
}

/** One shared empty array, so "no images" is always the same reference. */
const EMPTY_IMAGES: TranscriptImage[] = [];

/**
 * Never let an empty extraction replace images a record already holds.
 *
 * "This event carried no image blocks" and "this call produced no images" are
 * different claims, and only the second should be able to clear a row. The
 * reconnect seed makes the difference load-bearing: the backend strips image
 * bytes out of `live_events`, so a replayed `tool_execution_end` legitimately
 * arrives with nothing where a resolvable digest already sits.
 *
 * Returns the previous array by REFERENCE when it wins, so the identity gate in
 * `shallowEqual` still reports the record as unchanged.
 */
function preferExisting(
	next: TranscriptImage[],
	previous: TranscriptImage[],
): TranscriptImage[] {
	return next.length === 0 && previous.length > 0 ? previous : next;
}

/**
 * The `+N` / `-M` counters a write reported, from its own `details`.
 *
 * Mirrors the TUI's `_diff_counts` (tool_card.py:567-583): a value counts only
 * when it is a positive integer, and anything else — missing, malformed,
 * negative, a boolean — is zero. Zero is not rendered, because `+0` claims that
 * nothing was added while a missing count claims nothing at all, and these are
 * the second kind.
 */
function diffCounts(details: unknown): { added: number; removed: number } {
	const source = (details ?? {}) as Record<string, unknown>;
	const count = (value: unknown) =>
		typeof value === "number" && Number.isInteger(value) && value > 0
			? value
			: 0;
	return { added: count(source.added), removed: count(source.removed) };
}

function sameImages(a: TranscriptImage[], b: TranscriptImage[]) {
	if (a.length !== b.length) return false;
	for (let i = 0; i < a.length; i++) {
		if (
			a[i].id !== b[i].id ||
			a[i].data !== b[i].data ||
			a[i].attachment !== b[i].attachment ||
			a[i].mimeType !== b[i].mimeType
		)
			return false;
	}
	return true;
}

function withIndex(records: TranscriptRecord[]): TranscriptState["index"] {
	const index = new Map<string, number>();
	records.forEach((record, position) => index.set(record.id, position));
	return index;
}

/**
 * The same records in TIME order, ties broken by the position each already had.
 *
 * The rule the durable page is ordered by, shared so the live seed places a row
 * by the SAME rule rather than a second one: a row the seed dates from a real
 * clock belongs where that time belongs, and `upsert` appends an unknown id —
 * right for a row arriving now, wrong for one the seed itself dated to hours
 * ago.
 *
 * WHERE THE PAGE ALREADY USED THIS RULE, and what changed when it became shared:
 * the sort this replaced read a position from `base.records` and fell back to
 * one from the INCOMING page, so for an exact-millisecond tie between a painted
 * row and an arriving page row it compared two different index spaces (`base`
 * position against page position) and could sort the arriving row ABOVE the row
 * already on screen — the opposite of what that sort's own comment promised.
 * Reading every position from the list being sorted is what makes "an existing
 * row cannot be displaced by an arriving page row" true, so sharing the rule is
 * a deliberate, one-case behaviour change in the page merge rather than the pure
 * refactor this originally read as. A probe against the reducer at main shows
 * `a1,a2,b1,a3` where this produces `a1,a2,a3,b1`, and
 * `scripts/transcript-reducer.test.mjs` pins the order this produces.
 *
 * Ties keep the order they already had, so this can never reshuffle two rows
 * that state the same instant while the reader is looking at them. No lookup and
 * no fallback: every record's position is the one it arrives with, which is what
 * makes an unknown id unrepresentable here rather than something to default.
 */
function withTimeOrder(records: TranscriptRecord[]): TranscriptRecord[] {
	return records
		.map((record, position) => ({ record, position }))
		.sort((a, b) =>
			a.record.ts !== b.record.ts
				? a.record.ts - b.record.ts
				: a.position - b.position,
		)
		.map((entry) => entry.record);
}

function shallowEqual(a: TranscriptRecord, b: TranscriptRecord) {
	// `Record<string, unknown>` rather than the union's own key type: the union
	// narrows `keyof` to the fields COMMON to every variant, so indexing it
	// cannot see `images` at all and the comparison below would be typed as
	// unreachable. The runtime shape is what is being compared here.
	const left = a as unknown as Record<string, unknown>;
	const right = b as unknown as Record<string, unknown>;
	const keysA = Object.keys(left);
	if (keysA.length !== Object.keys(right).length) return false;
	for (const key of keysA) {
		if (left[key] === right[key]) continue;
		// `images` is the one field that is an ARRAY, so reference equality is
		// too strict for it: two extractions of the same unchanged content are
		// equal in every way a view cares about. `extractImages` already returns
		// the previous array when it can, and this covers the paths where it
		// cannot see one — without it, a live event that rebuilt a record for an
		// unrelated reason would report the row as changed and re-render every
		// image on it, on a surface that repaints per token.
		if (key === "images") {
			const before = left[key] as TranscriptImage[] | undefined;
			const after = right[key] as TranscriptImage[] | undefined;
			if (
				Array.isArray(before) &&
				Array.isArray(after) &&
				sameImages(before, after)
			)
				continue;
		}
		return false;
	}
	return true;
}

/**
 * Upsert one record. Returns the same state when the record is unchanged
 * (by shallow field equality), so the caller's identity gate holds.
 */
function upsert(state: TranscriptState, record: TranscriptRecord) {
	const position = state.index.get(record.id);
	if (position !== undefined) {
		const current = state.records[position];
		if (shallowEqual(current, record)) return state;
		const records = state.records.slice();
		records[position] = record;
		return { ...state, records };
	}
	const records = [...state.records, record];
	const index = new Map(state.index);
	index.set(record.id, records.length - 1);
	return { ...state, records, index };
}

function removeMatching(
	state: TranscriptState,
	predicate: (record: TranscriptRecord) => boolean,
) {
	if (!state.records.some(predicate)) return state;
	const records = state.records.filter((record) => !predicate(record));
	return { ...state, records, index: withIndex(records) };
}

// ---------------------------------------------------------------- durable

/** Custom transcript rows that are bookkeeping, never conversation. */
const SILENT_CUSTOM_TYPES = new Set([
	"frontend_state_checkpoint_v1",
	"session_state",
	"hub_communication",
	"wake_schedule",
	"prune",
]);

/**
 * A compaction that did NOT run: its sentence and the ink it deserves.
 *
 * The rule is the BACKEND's, not one invented here —
 * `local_operator/harness/rows.py::compaction_refused_notice` derives the tier
 * for every surface (`warning` for a DECLINE, because the context the user
 * asked to reclaim is still there; `error` for a FAILURE, because "not worth
 * it" and "I could not" are different things to the person deciding what to do
 * next), and the phone and the terminal host both render through it. A
 * renderer that picked its own ink would make one event read two ways.
 *
 * WHY THIS EXISTS AT ALL. A refusal emits NO `compaction_start` — the runtime
 * answers the routed command optimistically and the pass declines before the
 * start event (`session/runtime/serving.py::_record_compaction_refusal`, whose
 * docstring says the row "corrects the optimistic receipt") — so the pass has
 * no rung and no settling frame to paint. The durable row is the only record,
 * and listing it as bookkeeping left a manual `/compact` on a conversation with
 * nothing to compact painting NOTHING at all (UX round 1, U1; QA Q2). With the
 * dialog gone that is the surface the dialog used to occupy.
 */
function compactionOutcome(detail: string): {
	text: string;
	level: "info" | "warning" | "error";
} {
	const sentence = detail.trim() || "compaction did not run";
	/*
	 * The separator yields to the backend's own punctuation: its common detail
	 * already carries a colon ("nothing to compact: the whole conversation is ~8
	 * tokens …"), and the app opening with one too read as two nested claims
	 * (design round 2, N1). An em dash is the join, because the sentence after it
	 * is the runtime's and not this renderer's to rewrite.
	 */
	return {
		text: `Compaction did not run${sentence.includes(":") ? " — " : ": "}${sentence}`,
		level: sentence.startsWith("compaction failed") ? "error" : "warning",
	};
}

/**
 * The settled line for a pass whose OWN figures this reader still has: the live
 * `compaction_end` sentence, before and after included.
 *
 * WHY THE LIVE SENTENCE IS THE ONE THAT SURVIVES THE PAIRING. A pass is projected
 * twice — the live event, which knows `tokens_before` and `tokens_after`, and the
 * DURABLE `compaction` transcript row, which knows only `tokens_before`
 * (`Transcript.append_compaction`'s payload has no after-figure; read from the
 * backend, not inferred). The live sentence is strictly the more informative of
 * the two, so it is the one the pair keeps: the row a reader watched settle is
 * the row they keep reading, figures and all, until something reloads the view
 * without it.
 *
 * WHICH IS A LIVE-ONLY FACT, and that is parity rather than a defect. The base
 * app painted this sentence from the event, and the terminal host's own receipt
 * (`tui/session_presentation.py`) carries the figures too while only its REPLAY
 * is the bare marker sentence. A cold reload — a fresh reader with no live row to
 * pair — shows `COMPACTED_LINE`, exactly as the replay does.
 *
 * The two figures are printed as the pair when they differ and as one number when
 * they match, because a pass whose reduction rounds to the same step printing
 * `52.7k to 52.7k` reads as "compacted and changed nothing" (UX round 1, U4).
 *
 * PERSISTING the pair is a one-field backend change — `append_compaction`
 * carrying the after-figure, or the settled sentence — recorded under "not
 * addressed" in the round-3/4 remediation rather than papered over here.
 */
export function compactionSettledLine(before: number, after: number): string {
	const from = formatTokens(before);
	const to = formatTokens(after);
	return from === to
		? `Context compacted to ${to} tokens`
		: `Context compacted, ${from} to ${to} tokens`;
}

/**
 * What a pass's row says when this reader has no live sentence for it: the
 * durable row's own sentence, and the sentence a COLD reload shows.
 *
 * It is deliberately not a second opinion about the pass — a reader that never
 * saw the live line learns that the context was compacted and nothing more,
 * which is what the transcript can honestly say.
 */
export const COMPACTED_LINE = "Context compacted";

/**
 * One pass, one row: the live settled line and the durable row are two
 * projections of ONE event, so exactly one of them may be painted.
 *
 * WHY THIS SHAPE, and it replaces two rules that were both wrong. The first
 * matched each incoming durable row against the FIRST painted `compaction:` row
 * within two minutes (stateful and unordered: one live row could be spent twice).
 * The second ordered the pair by clock on the stated reasoning that "a durable row
 * is written when a pass ENDS" — which is backwards, and review round 4 measured
 * it: the backend awaits `append_compaction` (whose ts is `time.time()` at the
 * write, `session/transcript.py:809-812`) and only THEN emits the settle event
 * (`session.py:9851`), while the renderer stamps the live line with `Date.now()`
 * when it processes that frame, so the durable row is the OLDER of the two in
 * either arrival order. One pass painted two rows — bare and figured, side by
 * side, stable for a minute.
 *
 * So the pair is matched by IDENTITY first, because both projections already carry
 * one: the live id spells the pass's `tokens_before` and the durable entry has it
 * in its payload (the field the bare fallback reads for its sentence). A live line
 * takes the durable row whose `before` equals its own — one-to-one, oldest live
 * line first. A SECOND PAIRING INSIDE THE WINDOW remains for the row that carries
 * no fingerprint (an older transcript): nearest by `|Δts|` in EITHER direction,
 * claimed once. Distance is a tie-break, never the primary key.
 *
 * Still a PURE, TOTAL, IDEMPOTENT function of the record list: computed from the
 * whole list rather than patched as pages arrive, so applying the same page twice,
 * re-seeding it with `replace`, or loading it cold all produce the SAME rows, and
 * the chosen sentence is carried INTO the record so a later read cannot strip it.
 * Refusals need no rule here: the runtime writes the durable row and emits no
 * event at all (see `refreshTail`'s note), so there is no live line to collapse.
 */
/**
 * How far apart two projections of one pass may sit when the durable row carries
 * no fingerprint to match on. Wide enough for a slow disk write plus the frame's
 * round trip, narrow enough that an unrelated pass minutes later cannot be
 * claimed by it — and it is only ever a FALLBACK: the fingerprint is the key.
 */
const SETTLED_PAIRING_WINDOW_MS = 120_000;

export function collapseSettledCompactions(
	records: TranscriptRecord[],
): TranscriptRecord[] {
	type Settled = Extract<TranscriptRecord, { kind: "compaction" }>;
	const live: Settled[] = [];
	const durable: Settled[] = [];
	for (const record of records) {
		if (record.kind !== "compaction") continue;
		// Synthetic ids are the live projections (`compaction:<generation>:…`);
		// a durable row carries the transcript entry's own id.
		if (record.id.startsWith("compaction:")) live.push(record);
		else durable.push(record);
	}
	if (live.length === 0 || durable.length === 0) return records;
	const claimed = new Set<string>();
	const dropped = new Set<string>();
	/** The sentence each paired durable row keeps, keyed by its id. */
	const kept = new Map<string, string>();
	const pair = (row: Settled, candidate: Settled) => {
		claimed.add(candidate.id);
		dropped.add(row.id);
		kept.set(candidate.id, row.text);
	};
	const ordered = [...live].sort((a, b) => a.ts - b.ts);
	// Identity first: the pass's own figure, which only its durable row carries.
	for (const row of ordered) {
		if (row.before === undefined) continue;
		const match = durable.find(
			(candidate) =>
				!claimed.has(candidate.id) && candidate.before === row.before,
		);
		if (match) pair(row, match);
	}
	/*
	 * Then the window, and ONLY for a durable row that carries no figure at all.
	 *
	 * WHY THE EXCLUSION IS THE FIX, not a refinement (UX round 5, U19 = R5-3). The
	 * fallback as first written considered every unclaimed row and took the
	 * nearest, so a live line whose own durable row had not arrived yet could claim
	 * the PREVIOUS pass's row — 30 s inside the window, and the nearest candidate
	 * there was. Measured live: durable figures 25 / 3781 / 5301, and the pane read
	 * `to 3.8k` on pass 1's slot, `to 5.3k` on pass 2's, pass 3 bare — each row
	 * carrying the NEXT pass's figures, stable and wrong. A row that HAS a
	 * fingerprint says which pass it belongs to; a live line whose figure differs is
	 * a different pass, so the row is not a candidate — not a worse one.
	 *
	 * What remains is the case this existed for: an older transcript whose rows
	 * predate the field. There the pair is chosen by DISTANCE — every live/durable
	 * combination ranked globally, nearest first, each side claimed once — rather
	 * than oldest-live-first, because oldness was the old rule's reasoning and it
	 * contradicts the sentence this function states.
	 */
	const pairs: { live: Settled; durable: Settled; distance: number }[] = [];
	for (const row of ordered) {
		if (dropped.has(row.id)) continue;
		for (const candidate of durable) {
			if (candidate.before !== undefined) continue;
			const distance = Math.abs(candidate.ts - row.ts);
			if (distance > SETTLED_PAIRING_WINDOW_MS) continue;
			pairs.push({ live: row, durable: candidate, distance });
		}
	}
	pairs.sort((a, b) => a.distance - b.distance);
	for (const { live: row, durable: candidate } of pairs) {
		if (dropped.has(row.id) || claimed.has(candidate.id)) continue;
		pair(row, candidate);
	}
	if (dropped.size === 0) return records;
	return records
		.filter((record) => !dropped.has(record.id))
		.map((record) => {
			const text = kept.get(record.id);
			if (text === undefined) return record;
			if (record.kind !== "compaction" && record.kind !== "notice")
				return record;
			return text === record.text ? record : { ...record, text };
		});
}

/**
 * The same collapse, applied to a STATE — so the live path and the page path run
 * one rule over one list instead of two callers each doing the arithmetic.
 *
 * Identity is preserved when nothing is dropped, which is what keeps the row
 * memo (and therefore the frames) stable through a read that changed nothing.
 */
function collapseRecords(state: TranscriptState): TranscriptState {
	const records = collapseSettledCompactions(state.records);
	if (records === state.records) return state;
	return { ...state, records, index: withIndex(records) };
}

/**
 * The two custom types that are receipts rather than conversation.
 *
 * Both arrive as `custom` rows whose `details.text` is model-facing markup, and
 * both have a human-facing field beside it — which is why they are projected
 * rather than painted (see `receipt-row-model`). They are matched by the wire
 * names the harness writes (`session/peer.py`, `harness/wake.py`).
 */
const PEER_MESSAGE_CUSTOM_TYPE = "peer_message";
const WAKE_PROMPT_CUSTOM_TYPE = "wake_prompt";
/**
 * Custom rows whose TEXT is the message, not a payload to disclose.
 *
 * The three types here are the harness telling the reader that something changed
 * mid-session (a model switch, a recovered MCP server, a stored credential).
 * Each is a short statement a reader has to be able to read, and the TUI paints
 * it as a wrapping line for the same reason
 * (`tui/widgets/transcript.py::NoticeBlock`).
 *
 * `session_incident` is deliberately NOT in this set even though it is painted
 * the same way: it takes its own path through `incidentRow`, which is reached
 * before this set is read, so listing it here would be configuration that can
 * never fire.
 *
 * Any other custom type that reaches this branch is a RELAYED payload — a
 * `hub_message`, a job result — whose body belongs behind the disclosure:
 * measured over the operator's own store those run to 18,259 characters, and a
 * transcript that painted them inline would be unusable. They are not reduced to
 * their type name either; the row states its first substantive line and keeps
 * the body one click away.
 *
 * `peer_message` and `wake_prompt` are custom types too, but they never reach
 * this branch or this set: `durableRecord` projects each to its own kind first
 * (see the receipts branch there), because upstream's `receipt-row-model` owns
 * both rows and derives their headline and prompt at paint time. Correcting this
 * paragraph rather than the code is the point — it used to name four types, two
 * of which can no longer arrive here, which is how the next reader ends up
 * "fixing" machinery that cannot run (round 7's R33).
 */
const INLINE_CUSTOM_TYPES = new Set([
	"session_mcp_recovery",
	"session_model_switch",
	"session_credential",
]);

/**
 * The head of a rendered incident: `[session incident (provider/model)] mcp: `.
 *
 * The category is bounded because this is a label, not a paragraph, and a
 * payload that happens to start with a bracket is not an incident.
 *
 * NO BACKTICKS IN THIS FILE'S COMMENTS: the module is handed to esbuild as a
 * bundle input and one stray delimiter in a docblock has already cost this
 * repository a build.
 */
const INCIDENT_HEAD =
	/^\[session incident(?:\s*\(([^)]*)\))?\]\s*([^:\n]{1,40}):\s*/;

/**
 * An envelope tag line: `<parent-message>`, `<peer-session-message …>`, and the
 * CLOSING form `</parent-message>`.
 *
 * Both relays put the actual message on the NEXT line, so quoting the tag alone
 * tells a reader nothing — which is what a first-line headline did for every
 * `hub_message` in the store. Closing tags matter for the same reason rather
 * than for symmetry: a relay whose body is empty is persisted as
 * `<subagent-message label=… job=…>` / blank / `</subagent-message>` (34 rows in
 * the store), and without this the row painted the closing tag as its message.
 */
const ENVELOPE_TAG = /^<\/?[a-z][a-z0-9-]*(\s[^>]*)?>$/i;

/**
 * The three lines `harness/comms.py::TO_CHILD_INSTRUCTIONS` prepends to a
 * relayed `hub_message`, normalised to one lowercase line.
 *
 * They are the channel's manners, not the message: measured over the store,
 * 411 hub rows open with the `note` line verbatim, so quoting it inline made
 * every one of those rows read the same and pushed the parent's actual words
 * behind the chevron. The instruction stays in the body — it is the first thing
 * a reader meets once they open the row, and the kind is on the label.
 */
const RELAY_INSTRUCTIONS = new Set([
	"this changes your instructions. apply it from now on, and drop work it makes pointless.",
	"answer it now with the `hub` tool — a short, direct reply — then carry on with what you were doing. do not restructure your work around the question.",
	"this is a note, not a question. no reply is needed unless it changes what you should do.",
]);

/** The bracket the harness prefixes its statement texts with (`[model switch]`). */
const STATEMENT_TAG = /^\[[^\]]{1,32}\]\s*/;

/*
 * The sentence scan's two conditions (round 2's R7). Module constants rather than
 * literals in the loop: they would be re-created per character otherwise, which
 * is the same reason this repository lints for it.
 */
/** A leading list marker: `1.`, `2.` — a bullet, not a sentence end. */
const LEADING_ORDINAL = /^\d+\.$/;
/** A capital, which is what an abbreviation's follower is not. */
const CAPITAL = /[A-Z]/;

/*
 * Hoisted for the reason the linter names but mostly because it is evaluated PER
 * CHARACTER: `firstSentenceEnd` walks a headline's characters, so a literal
 * inside it builds a regex object on every character of every row's text.
 */
/** Any whitespace, which is what a sentence end must be followed by. */
const WHITESPACE = /\s/;

/**
 * A headline is a summary of the row, not the row's payload — `detail` is the
 * payload. Bounded so a single-paragraph relay cannot push the ledger out of
 * its column, and cut on a word boundary so the truncation reads as one.
 */
const HEADLINE_MAX = 160;

/**
 * What a custom row paints, decided once here rather than per view.
 *
 * The defect this replaces: the view pinned every custom row to the info tier
 * and hid any row longer than 400 characters or one line behind its chevron, so
 * 946 persisted incidents rendered as the literal string `session incident` and
 * the user had to click to learn why their turn died. Level, message and
 * disclosure are properties of the RECORD, so they are set where the record is
 * built — the same reason this module already decides the § 7 tier for every
 * other kind.
 */
function customRow(
	customType: string,
	text: string,
	details: Record<string, unknown>,
): Pick<
	Extract<TranscriptRecord, { kind: "custom" }>,
	"level" | "headline" | "detail" | "category" | "provider"
> {
	if (customType !== "session_incident") {
		// The statement's own bracket tag repeats the row's label
		// ("session model switch: [model switch] …"), so the headline starts at
		// the sentence — and the harness's instruction to the MODEL, which follows
		// that sentence, is not a headline at all. A RELAYED payload keeps its
		// whole body as the detail, because what makes it bulky is the payload
		// itself rather than an instruction appended to a fact.
		return {
			level: "info",
			category: null,
			provider: null,
			...(INLINE_CUSTOM_TYPES.has(customType)
				? splitStatement(text.trim().replace(STATEMENT_TAG, ""))
				: relayRow(text)),
		};
	}
	return { level: "error", ...incidentRow(text, details) };
}

/**
 * Split a harness statement into the fact and the instruction that follows it.
 *
 * A statement is two things in one string: what changed (`You are now running as
 * X (was Y).`) and what the MODEL is to do about it (`This applies from now on.
 * Capabilities, context window, and tone may differ from the previous model; act
 * as the model you now are.`). Measured over the store, all 231 model-switch rows
 * carry that tail, and painting it inline put a 3-4 line agent-directed block in
 * a one-line ledger, on a row with nothing to disclose. The rule is the same one
 * `incidentRow` applies to an incident's head: the fact is the row, the
 * instruction is what the disclosure is for.
 */
function splitStatement(
	text: string,
): Pick<Extract<TranscriptRecord, { kind: "custom" }>, "headline" | "detail"> {
	const trimmed = text.trim();
	const at = firstSentenceEnd(trimmed);
	if (at < 0) return { headline: trimmed, detail: null };
	const detail = trimmed.slice(at).trim();
	return { headline: trimmed.slice(0, at).trim(), detail: detail || null };
}

/**
 * The index just past the first sentence's terminator, or -1 when there is none.
 *
 * Two conditions beyond "a terminator followed by whitespace", both of which
 * exist because the bare rule split real text in half (round 2's R7):
 *
 * 1. the first non-space character AFTER the terminator must be a capital, so a
 *    mid-sentence abbreviation — `e.g. the fast tier`, `(approx. 200k ctx)` — is
 *    not read as a sentence end;
 * 2. a terminator that is preceded only by digits AND opens the text is a list
 *    marker (`1. You are now running as …`), not a sentence end.
 *
 * This is deliberately not a list of abbreviations, which would be a table to
 * keep in step with English forever. When nothing qualifies there is no split at
 * all: the row paints the whole text and discloses nothing, which is the safe
 * direction — nothing is hidden from the reader.
 *
 * The whitespace requirement is what keeps versions and filenames intact
 * (`deepseek-v4.1-flash`, `march.csv`), and it is why this is a scan rather than
 * a split on the character.
 */
function firstSentenceEnd(text: string): number {
	for (let i = 0; i < text.length - 1; i++) {
		if (!".!?…".includes(text[i])) continue;
		if (!WHITESPACE.test(text[i + 1])) continue;
		if (LEADING_ORDINAL.test(text.slice(0, i + 1))) continue;
		if (!CAPITAL.test(text.slice(i + 1).trimStart()[0] ?? "")) continue;
		return i + 1;
	}
	return -1;
}

/**
 * The three facts a `session_incident` row paints.
 *
 * The MESSAGE is `details.raw` rather than the head line's remainder, and the
 * two are deliberately not interchangeable: the producer truncates the head at
 * 500 characters (`incidents.Incident.render`) and keeps the untruncated
 * original in `raw` (bounded at 1000), so the head is a rendering of the error
 * and `raw` is the error. The head's remainder is the fallback for a row
 * persisted without one, which is why the head is parsed at all.
 *
 * The DISCLOSURE is everything after the head line: the harness's suggested
 * action and its "this is why the previous turn ended" tail. Both are addressed
 * to the model — they are the reason the incident exists — so the reader's
 * message is the vendor's own words and the harness's advice is one click away.
 * A `session_incident` with no tail (there is none today, but the classifier's
 * hint is optional) discloses nothing and paints as a static line.
 */
function incidentRow(
	text: string,
	details: Record<string, unknown>,
): Pick<
	Extract<TranscriptRecord, { kind: "custom" }>,
	"headline" | "detail" | "category" | "provider"
> {
	const lines = text.split("\n");
	const head = lines[0].match(INCIDENT_HEAD);
	const raw = typeof details.raw === "string" ? details.raw.trim() : "";
	const message =
		raw ||
		(head ? lines[0].slice(head[0].length) : lines[0]).trim() ||
		text.trim();
	const tail = lines.slice(1).join("\n").trim();
	return {
		// The head's parenthetical is the `provider/model` that died, and the
		// harness's own advice for a rate limit is "tell the user which provider
		// hit the limit" — so it is a fact the row has to carry. It rides the
		// `object` column rather than the message, which is the ledger's slot for
		// a machine-voice identifier (a path, a URL, a command) and keeps the
		// vendor's own error string intact as the sentence.
		provider: (head?.[1] ?? "").trim() || null,
		category: (head?.[2] ?? "").trim() || null,
		headline: message,
		detail: tail || null,
	};
}

/**
 * A relayed payload as a row: its headline, and the body behind the disclosure.
 *
 * `detail` is `null` when the headline IS the whole payload, because a disclosure
 * that repeats what the row already says promises material it does not add — the
 * same rule the notice register needed (round 2's U14), and the one 4 of the
 * store's job results at the 2026-09-14 scan — 39 then, 42 the next day — hit
 * once the colon join consumed their two-line body
 * (U16). The comparison is on the flattened text, so it holds whether the join
 * stitched lines together or the payload was one line to begin with.
 */
function relayRow(
	text: string,
): Pick<Extract<TranscriptRecord, { kind: "custom" }>, "headline" | "detail"> {
	const headline = headlineOf(text);
	const flat = text
		.split("\n")
		.map((line) => line.trim())
		.filter(Boolean)
		.join(" ");
	return { headline, detail: flat === headline ? null : text };
}

/**
 * The line of a relayed payload that says something, bounded to a headline.
 *
 * Two kinds of line are not the message and are stepped over:
 *
 * 1. the envelope's own tags, opening or closing — `<parent-message>`, and the
 *    `</subagent-message>` an empty relay would otherwise paint;
 * 2. the channel's fixed instruction line (see `RELAY_INSTRUCTIONS`), which is
 *    byte-identical on 411 hub rows.
 *
 * The wake-arming clause was the third kind until round 7's R33. The strip was
 * scoped to a wake row, and what changed is the row rather than the rule: a
 * `wake_prompt` record is projected to its own `wake` kind before this path can
 * be reached (see the receipts branch in `durableRecord`), so nothing this
 * function edits is a wake's own words. Instrumented at both arms they took zero
 * hits across the suite and from real wake and peer payloads, and deleting them
 * left it green — which is why they are deleted rather than left looking live.
 *
 * When nothing survives, the ENVELOPE itself is the honest headline: a relay
 * with an empty body still names its label and job id
 * (`<subagent-message label='rollover-template-fix' job='5fb25794e06c'>`), which
 * is strictly better than a stray closing token.
 *
 * One further shape left the row stating a LABEL rather than the message it
 * exists to state (round 2's U10, measured): a chosen line that ENDS in a colon
 * is a heading with its outcome on the next line — `background job 'design849'
 * failed:` / `[Errno 28] No space left on device` — so the two are joined, which
 * was 37 of the store's 39 job results at the 2026-09-14 scan (the population
 * grows as the operator works; it was 42 the next day).
 *
 * The two wake shapes that sat beside it (round 2's U10, then D8/U15) are
 * DELETED rather than disabled, and the suite is the proof: instrumented at both
 * sites they took 0 hits over 110 tests and 0 from five real wake shapes fed
 * through both the durable and the live path, while the relay control hit. A
 * `wake_prompt` payload is claimed by the receipts branch in `durableRecord`
 * before `customRow` — this function's only caller — is reached, so a wake row
 * has no custom-row headline at all and rules about one could never fire. Upstream
 * owns the row a wake now paints (`receipt-row-model`, pinned by
 * `scripts/tool-row.test.mjs`).
 *
 * `customType` went with them: every arm that read it was wake-only, so the
 * parameter would be configuration nothing consults. Adding the parameter back
 * is the signal that a caller has a per-type rule again.
 */
function headlineOf(text: string): string {
	const lines = text
		.split("\n")
		.map((candidate) => candidate.trim())
		.filter(Boolean);
	/** Whether a line is the payload's own words rather than the channel's. */
	const speaks = (line: string) =>
		!ENVELOPE_TAG.test(line) && !isRelayInstruction(line);
	const substantive = lines.find(speaks);
	const opening = lines.find(
		(line) => ENVELOPE_TAG.test(line) && !line.startsWith("</"),
	);
	let chosen = substantive ?? opening ?? text.trim();

	const at = lines.indexOf(chosen);
	if (at >= 0 && chosen.endsWith(":")) {
		const outcome = lines.slice(at + 1).find(speaks);
		if (outcome) chosen = `${chosen} ${outcome}`;
	}

	return bounded(chosen);
}

/** Whether a line is one of the channel's fixed instruction lines. */
function isRelayInstruction(line: string): boolean {
	return RELAY_INSTRUCTIONS.has(line.replace(/\s+/g, " ").trim().toLowerCase());
}

/** Cut a headline to its bound, on a word boundary so it reads as one. */
function bounded(headline: string): string {
	const trimmed = headline.trim();
	if (trimmed.length <= HEADLINE_MAX) return trimmed;
	const cut = trimmed.slice(0, HEADLINE_MAX);
	const lastSpace = cut.lastIndexOf(" ");
	return `${(lastSpace > 0 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`;
}

function durableRecord(
	entry: DesktopHistoryPage["entries"][number],
	/**
	 * The record already painted for this id, if any. It carries TWO facts, and
	 * neither is optional:
	 *
	 * - an unchanged `images` array keeps its REFERENCE across a re-read of the
	 *   same history page — `shallowEqual` compares by `!==`, so a freshly built
	 *   array would report every replayed row as changed and re-render it;
	 * - a compaction row keeps the SENTENCE it already carries, which is the live
	 *   line the pairing moved onto it. The durable entry has no sentence of its
	 *   own to replace it with, and recomputing one would strip the figures on the
	 *   very next read — that is what makes `collapseSettledCompactions`
	 *   idempotent.
	 */
	previous?: TranscriptRecord,
): TranscriptRecord | null {
	const payload = entry.payload ?? {};
	const ts = Math.round((entry.ts ?? 0) * 1000);
	if (entry.type === "compaction") {
		/*
		 * The sentence a row already carries is KEPT. The entry has no sentence of
		 * its own — only counts — so there is nothing here for it to disagree with,
		 * and recomputing one would strip the figures the pairing put there on the
		 * very next read (review round 3, R3-1: the second application of a page was
		 * enough). This is the fact that makes `collapseSettledCompactions`
		 * idempotent, and it is stated where the recomputation would otherwise live.
		 */
		const kept =
			previous?.kind === "compaction" ? previous.text : COMPACTED_LINE;
		// The entry's own figure, which is the pass's fingerprint: `append_compaction`
		// writes `tokens_before` and no after-figure, and that one number is what lets
		// this row be paired with its live line by identity rather than by clock.
		const before = payload.tokens_before;
		return {
			kind: "compaction",
			id: entry.id,
			ts,
			text: kept,
			...(typeof before === "number" ? { before } : {}),
		};
	}
	/*
	 * The refusal's own durable row, painted rather than dropped: see
	 * `compactionOutcome` for why it is the only surface this pass has.
	 */
	if (
		entry.type === "message" &&
		payload.custom_type === "compaction_refused"
	) {
		const details = (payload.details ?? {}) as Record<string, unknown>;
		const outcome = compactionOutcome(String(details.detail ?? ""));
		return {
			kind: "notice",
			id: entry.id,
			ts,
			text: outcome.text,
			level: outcome.level,
		};
	}
	if (
		entry.type === "custom" &&
		payload.custom_type === "completion_attention"
	) {
		const details = (payload.details ?? {}) as Record<string, unknown>;
		if (
			typeof details.anchor === "string" &&
			(details.kind === "error" || details.kind === "interrupted")
		) {
			// Preserve the marker's durable position. Appending an old failure at
			// the current retry tail would misrepresent which outcome was viewed.
			return {
				kind: "notice",
				id: details.anchor,
				ts,
				complete: true,
				text:
					details.kind === "error" ? "Stopped with an error" : "Interrupted",
				level: details.kind === "error" ? "error" : "warning",
			};
		}
	}
	if (entry.type !== "message") return null;
	const kind = String(payload.kind ?? "message");
	if (kind === "custom") {
		const customType = String(payload.custom_type ?? "");
		if (SILENT_CUSTOM_TYPES.has(customType)) return null;
		const details = (payload.details ?? {}) as Record<string, unknown>;
		// The receipts come before the generic branch, which would paint
		// `details.text` — the model-facing envelope for both of them.
		//
		// A peer row is projected from `details.body` + `details.sender`, the two
		// fields the UIs are supposed to render (the phone's fold does exactly
		// that). The envelope is parsed rather than required, because a row from an
		// older producer may carry only it; either way no envelope reaches the
		// view.
		if (customType === PEER_MESSAGE_CUSTOM_TYPE) {
			const { body, sender } = peerFields(details);
			return {
				kind: "peer",
				id: entry.id,
				ts,
				body,
				// Reused by reference when a replayed page teaches nothing new, or
				// `shallowEqual` reports this row as changed on every re-read (the same
				// bargain `extractImages` strikes for `images`).
				sender:
					previous?.kind === "peer" && sameSender(previous.sender, sender)
						? previous.sender
						: sender,
			};
		}
		// A wake receipt is the delivery verbatim; the headline and the prompt are
		// derived at paint time. The CATCH-UP is not a receipt — see
		// `wakeIsCatchup` for the two surfaces that skip it and why.
		if (customType === WAKE_PROMPT_CUSTOM_TYPE) {
			if (wakeIsCatchup(details)) return null;
			const text = String(details.text ?? "");
			if (!text.trim()) return null;
			return { kind: "wake", id: entry.id, ts, text };
		}
		const text = String(details.text ?? details.detail ?? "");
		// A row with nothing to say paints nothing. `trim()` rather than a falsy
		// test, because a whitespace-only body would otherwise reach `headlineOf`
		// and produce an empty headline — which is the shape the operator reported
		// (a row that states nothing but its type name). No producer emits one
		// today; the gate is here so none can.
		if (!text.trim()) return null;
		return {
			kind: "custom",
			id: entry.id,
			ts,
			customType,
			text,
			attribution:
				(payload.attribution as "user" | "agent" | "system") ?? "system",
			...customRow(customType, text, details),
		};
	}
	const role = String(payload.role ?? "");
	if (role === "user") {
		const text = messageText(payload);
		// Harness-authored user rows (recovery notices, wake prompts) are
		// machine voice: they render as notices rather than as the person.
		if (text.startsWith("Harness recovery notice:")) {
			return { kind: "notice", id: entry.id, ts, text, level: "warning" };
		}
		return {
			kind: "user",
			id: entry.id,
			ts,
			text,
			images: extractImages(
				payload,
				entry.id,
				previous?.kind === "user" ? previous.images : undefined,
			),
		};
	}
	if (role === "assistant") {
		const toolCalls = Array.isArray(payload.tool_calls)
			? (payload.tool_calls as Record<string, unknown>[])
			: [];
		const text = messageText(payload);
		// An assistant row that only carried tool calls has no prose to show;
		// its tool rows are painted from the paired `tool` results. It still
		// occupies its id so a live echo of it coalesces instead of duplicating.
		if (!text && toolCalls.length > 0) {
			return {
				kind: "assistant",
				id: entry.id,
				ts,
				text: "",
				streaming: false,
				stopReason: String(payload.stop_reason ?? "toolUse"),
				error: false,
			};
		}
		return {
			kind: "assistant",
			id: entry.id,
			ts,
			text,
			complete: true,
			streaming: false,
			stopReason: (payload.stop_reason as string | null) ?? null,
			error: Boolean(payload.is_error),
		};
	}
	if (role === "tool") {
		const toolCallId = String(payload.tool_call_id ?? entry.id);
		const providerPayload = (payload.provider_payload ?? {}) as Record<
			string,
			unknown
		>;
		return {
			kind: "tool",
			// Tool records key by call id: the live start/end events for the same
			// call carry no transcript entry id, and the durable row must replace
			// the live one rather than stand beside it.
			id: `tool:${toolCallId}`,
			ts,
			toolCallId,
			toolName: String(payload.tool_name ?? ""),
			intent: null,
			args: null,
			phase: "done",
			argumentBytes: 0,
			output: messageText(payload) || null,
			isError: Boolean(payload.is_error),
			durationS:
				typeof providerPayload.duration_s === "number"
					? providerPayload.duration_s
					: null,
			// A durable row is settled by definition: it reports the duration the
			// backend measured, never a clock of its own.
			startedAt: null,
			// Durable tool rows carry image blocks in `content` exactly as user rows
			// do — confirmed against real transcripts: 6398 tool-role blocks with
			// keys `(attachment, mime_type)`. This is the reload half of a browser
			// screenshot; the live half arrives on `tool_execution_end`.
			images: extractImages(
				payload,
				`tool:${toolCallId}`,
				previous?.kind === "tool" ? previous.images : undefined,
			),
			...diffCounts(providerPayload.details),
			// The durable half of the diff body, and the same identity rule the
			// images beside it follow: a replayed page that carries no `details`
			// must not blank a row the live event already filled in (the live
			// event budget drops `details` from the frame when the row exceeds its
			// share — `_bound_live_result_in_place` in frontend_state.py).
			diff: preferDiff(
				diffFromDetails(providerPayload.details),
				previous?.kind === "tool" ? previous.diff : null,
			),
			// A durable row is the authoritative record of how the call ended, and
			// it ended normally: an interrupt is a live-only fact the transcript
			// does not encode separately from `is_error`.
			stopped: false,
		};
	}
	return null;
}

/**
 * Merge a durable history page. Durable rows win over any live record with
 * the same id; the page's own order is preserved and it is placed by
 * timestamp relative to what is already painted (older pages prepend).
 */
export function applyHistoryPage(
	state: TranscriptState,
	page: DesktopHistoryPage,
	options: { replace?: boolean; keepPaging?: boolean } = {},
): TranscriptState {
	/*
	 * A view the user has CLEARED is answered with THE PASS THE READ EXISTS FOR,
	 * and with nothing else. Three facts make that test exact, and each was a defect
	 * on its own:
	 *
	 * - `/clear` is view-only by contract, so a page read afterwards repaints every
	 *   row it removed (`/compact`, `/clear`, `/compact` put the conversation back —
	 *   UX round 4's U17);
	 * - the test is the EPOCH, not "is the view empty": the first read painting the
	 *   pass's own row made the view non-empty, so the second scheduled read landed
	 *   whole (round 5's R5-2/U20, bracketed in the backend's request log);
	 * - and the row set is scoped by the read's OWN instant, because "outcome rows"
	 *   includes the pre-clear passes' rows, which is what put a bare
	 *   `Context compacted` per old pass back under the new one (round 6's Q14).
	 *
	 * `keepPaging` is set by exactly one caller (the tail read), the epoch and the
	 * clear instant are written by exactly one function (`clearTranscript`), and the
	 * instant is the boundary the rule needs rather than the read's own receipt
	 * (which a fast refusal can precede — see `clearedAt`). A read that is not the
	 * tail read still repaints, which is parity with `origin/main` and deliberately
	 * unchanged.
	 */
	const clearedView = options.keepPaging === true && state.viewEpoch > 0;
	const incoming: TranscriptRecord[] = [];
	for (const entry of page.entries) {
		if (clearedView && !isCompactionOutcome(entry, state.clearedAt)) continue;
		// A tool row keys by call id, not entry id, so the prior record is looked
		// up under both. Handing it to `durableRecord` is what lets an unchanged
		// `images` array keep its reference through a replayed page.
		const previous =
			state.records[state.index.get(entry.id) ?? -1] ??
			state.records[
				state.index.get(`tool:${String(entry.payload?.tool_call_id ?? "")}`) ??
					-1
			];
		const record = durableRecord(entry, previous);
		if (record) incoming.push(record);
	}
	// Tool call args live on the assistant row's `tool_calls`; carry the intent
	// and args onto the tool record. The map spans the SESSION, not this page —
	// see `TranscriptState.argsByCall` for the two ways a call and its arguments
	// end up on different pages.
	let argsByCall = state.argsByCall;
	let argsChanged = false;
	for (const entry of page.entries) {
		const calls = entry.payload?.tool_calls;
		if (!Array.isArray(calls)) continue;
		// The assistant row's own instant. The call it names was composed in THAT
		// message, so this is the durable anchor a replayed settling frame for the
		// call is placed at (`seededClock`) — read here because this loop is the
		// only place the row and its calls are both in hand.
		const anchoredAt = Math.round((entry.ts ?? 0) * 1000);
		for (const call of calls as Record<string, unknown>[]) {
			if (!call || typeof call.id !== "string") continue;
			if (argsByCall.has(call.id)) continue;
			// Copy-on-write: the common replayed page teaches nothing new, and
			// rebuilding the map anyway would hand the identity gate a fresh object
			// on every poll.
			if (!argsChanged) {
				argsByCall = new Map(argsByCall);
				argsChanged = true;
			}
			argsByCall.set(call.id, { ...call, anchoredAt });
		}
	}
	for (let i = 0; i < incoming.length; i++) {
		const record = incoming[i];
		if (record.kind !== "tool") continue;
		const call = argsByCall.get(record.toolCallId);
		if (!call) continue;
		const args = (call.arguments ?? null) as Record<string, unknown> | null;
		incoming[i] = {
			...record,
			args,
			intent: typeof args?.i === "string" ? args.i : null,
		};
	}
	// A page that taught us new arguments can complete rows painted EARLIER —
	// the reconnect case, where the row settled before its arguments arrived.
	// Only rows still missing args are touched, so an unchanged row keeps its
	// object identity and the row memo holds.
	const backfilled: TranscriptRecord[] = argsChanged
		? state.records.map((record) => {
				if (record.kind !== "tool" || record.args) return record;
				const call = argsByCall.get(record.toolCallId);
				const args = (call?.arguments ?? null) as Record<
					string,
					unknown
				> | null;
				if (!args) return record;
				return {
					...record,
					args,
					intent: record.intent ?? (typeof args.i === "string" ? args.i : null),
				};
			})
		: state.records;

	const base = options.replace
		? EMPTY_TRANSCRIPT
		: { ...state, records: backfilled };
	const byId = new Map(base.records.map((record) => [record.id, record]));
	let changed =
		options.replace || (!options.replace && backfilled !== state.records);
	for (const record of incoming) {
		const current = byId.get(record.id);
		if (!current) {
			changed = true;
			byId.set(record.id, record);
			continue;
		}
		// Durable rows are authoritative over live projections of the same
		// message, but a durable tool row lacks the args the live start
		// carried, so keep those.
		if (current.kind === "tool" && record.kind === "tool") {
			const merged: TranscriptRecord = {
				...record,
				args: record.args ?? current.args,
				intent: record.intent ?? current.intent,
				// A durable row has DIGESTS, a live row has BYTES, and the bytes are
				// already decoded in this renderer. Preferring the live array spares
				// the row the user is looking at a needless round trip to the
				// attachment endpoint at the exact moment the turn settles.
				images: current.images.length ? current.images : record.images,
			};
			if (!shallowEqual(current, merged)) {
				changed = true;
				byId.set(record.id, merged);
			}
			continue;
		}
		if (!shallowEqual(current, record)) {
			changed = true;
			byId.set(record.id, record);
		}
	}
	/*
	 * Whether this page carries the pass's OWN outcome — the row that says how
	 * THIS pass ended. Three conjuncts, and the middle one is the round-2 fix:
	 *
	 * - the entry is a compaction outcome at all (the pass's durable row, or the
	 *   refusal that corrects an optimistic receipt);
	 * - it is NOT OLDER than the standing claim (`compactingSince`), which is what
	 *   separates the pass being watched from a previous pass's row arriving on a
	 *   page this reader had never loaded. "Not yet painted" alone retired a live
	 *   pass from any `load older` merge, from the mentioned-files scanner's
	 *   paging, and from a first history read that landed after a live start
	 *   (NEW-1) — and the cost was both surfaces of the change going quiet
	 *   mid-pass;
	 * - it is not already painted, so a refresh replaying the same outcome is not
	 *   a second event.
	 */
	const retiresPass =
		state.compacting &&
		page.entries.some((entry) => {
			if (state.index.has(entry.id)) return false;
			if (Math.round((entry.ts ?? 0) * 1000) < state.compactingSince)
				return false;
			return (
				entry.type === "compaction" ||
				(entry.type === "message" &&
					entry.payload?.custom_type === "compaction_refused")
			);
		});
	if (!changed && state.hasMore === page.has_more && !retiresPass) return state;

	// Durable rows first, then this page's new rows, in TIME order with ties
	// broken by the position each already had — so a page that lands out of order
	// cannot reshuffle rows the user is reading, and an arriving page row can no
	// longer tie itself ABOVE a painted one (the change `withTimeOrder` documents,
	// pinned in `transcript-reducer.test.mjs`). It is built from the merged list
	// and the index is derived from the sorted records, once, here.
	/*
	 * The collapse is applied to the MERGED list, after ordering: it is a pure
	 * function of that list, so a page applied twice, a `replace` re-seed and a
	 * cold load all end at the same rows (`collapseSettledCompactions`).
	 */
	const records = collapseSettledCompactions(withTimeOrder([...byId.values()]));
	// The paging cursor is the first entry of the OLDEST page received: a
	// newer page (the snapshot's tail after a history_delta) must not move it
	// forward, or the next "load older" request would skip rows.
	const first = page.entries[0];
	let oldestId = base.oldestId;
	if (options.keepPaging) {
		/*
		 * A TAIL read answers "what did I miss", never "is there more behind me":
		 * the page carries no cursor, so its `has_more` describes the session
		 * rather than this reader's position, and letting it through put the "load
		 * earlier" affordance back on a transcript that already held everything —
		 * and resumed the mentioned-files scan's paging (review round 3, R3-5).
		 */
		return { ...state, records, index: withIndex(records), argsByCall };
	}
	if (first) {
		const firstTs = Math.round((first.ts ?? 0) * 1000);
		const currentOldest = oldestId
			? base.records[base.index.get(oldestId) ?? -1]
			: undefined;
		if (!currentOldest || firstTs <= currentOldest.ts) oldestId = first.id;
	}
	return {
		...state,
		records,
		index: withIndex(records),
		oldestId,
		hasMore: page.has_more,
		// Retained even on `replace`: a reseed repaints the rows but does not
		// unlearn which arguments a call was made with, and the reseed is exactly
		// the path whose own events no longer carry them.
		argsByCall,
		/*
		 * A durable compaction outcome retires the claim its live frames would
		 * have. A REFUSAL emits no events at all (`serving.py::
		 * _record_compaction_refusal` writes this row precisely because the
		 * optimistic receipt has nothing else to correct it), so without this the
		 * claim the receipt implied would stand beside the row that contradicts
		 * it.
		 */
		compacting: retiresPass ? false : state.compacting,
		compactingSince: retiresPass ? 0 : state.compactingSince,
	};
}

// ------------------------------------------------------------------- live

type LiveEvent = { type: string; [key: string]: unknown };

/**
 * Apply one canonical AgentEvent. Idempotent: replaying an event whose
 * effect is already painted returns the same state.
 */
export function applyEvent(
	state: TranscriptState,
	event: LiveEvent,
	now = Date.now(),
): TranscriptState {
	const message = event.message as Record<string, unknown> | undefined;
	switch (event.type) {
		case "agent_start": {
			const generation = Number(event.generation ?? state.generation + 1);
			if (generation === state.generation) return state;
			/*
			 * A NEW TURN is one of the ways a compaction claim stops. It cannot
			 * overlap a pass — a session running a compaction is not starting a turn
			 * — so a turn starting means any claim still standing was never retired,
			 * and retiring it here is what keeps a lost `compaction_end` from
			 * outliving the pass it described.
			 */
			return { ...state, generation, compacting: false, compactingSince: 0 };
		}
		case "compaction_start": {
			// The FIRST start of a pass owns the stamp; a replay of it is the same pass
			// and must not move the boundary forward under a row that is already old.
			if (state.compacting) return state;
			return { ...state, compacting: true, compactingSince: now };
		}
		case "agent_end": {
			const generation = Number(event.generation ?? state.generation);
			// A superseded end (older generation) must not touch the live turn.
			if (generation < state.generation) return state;
			// Anything still marked streaming at turn end is settled: the owner
			// sends message_end first, so this only catches an aborted stream.
			let next = state;
			for (const record of state.records) {
				if (record.kind === "assistant" && record.streaming) {
					next = upsert(next, {
						...record,
						streaming: false,
						stopReason: event.aborted ? "aborted" : record.stopReason,
					});
				}
				if (record.kind === "tool" && record.phase !== "done") {
					// A call still running when the turn ends never reported an
					// outcome. On an ABORT that is an interrupt, which is its own
					// state; on a clean end it is a call whose end event was lost, and
					// claiming success for it would be worse than claiming nothing.
					next = upsert(next, {
						...record,
						phase: "done",
						// Settled, however it got here: the clock stops even though no
						// `_end` ever arrived to report a duration.
						startedAt: null,
						stopped: Boolean(event.aborted),
					});
				}
			}
			return next;
		}
		case "message_start": {
			if (!message || typeof message.id !== "string") return state;
			const current = state.records[state.index.get(message.id) ?? -1];
			if (message.role === "user") {
				return upsert(state, {
					kind: "user",
					id: message.id,
					ts: now,
					text: messageText(message),
					images: extractImages(
						message,
						message.id,
						current?.kind === "user" ? current.images : undefined,
					),
				});
			}
			if (message.role !== "assistant") return state;
			// A durable row already painted for this id outranks a replayed start.
			if (current) return state;
			return upsert(state, {
				kind: "assistant",
				id: message.id,
				ts: now,
				text: "",
				streaming: true,
				stopReason: null,
				error: false,
			});
		}
		case "message_update": {
			if (!message || typeof message.id !== "string") return state;
			const position = state.index.get(message.id);
			const delta = String(event.delta ?? "");
			if (position === undefined) {
				// Joined mid-stream (the snapshot seed carries the latest update,
				// not the start): the accumulated message text plus this delta.
				return upsert(state, {
					kind: "assistant",
					id: message.id,
					ts: now,
					text: messageText(message) + delta,
					streaming: true,
					stopReason: null,
					error: false,
				});
			}
			const current = state.records[position];
			if (current.kind !== "assistant" || !current.streaming) return state;
			// Append-only contract: each update carries its own delta and the
			// loop only assembles `message.content` at the END of the stream, so
			// mid-stream the body is empty and the delta is all there is. When a
			// producer does send an accumulated body, `body + delta` is the
			// authoritative text and anything not longer than what is painted is
			// an older replay that must not regress the newer paint.
			// No content-based dedupe: "the the" is legitimate text and a
			// repeated single token is the common case in a token stream. The
			// ordering guarantees make it unnecessary: replay before the snapshot
			// folds into scratch state the durable page overrides, and the live
			// seed is applied once, at the snapshot, before any post-snapshot
			// event, so the same delta cannot reach a painted record twice.
			const body = messageText(message);
			let next: string;
			if (body) {
				next = body + delta;
				if (next.length <= current.text.length) return state;
			} else {
				if (!delta) return state;
				next = current.text + delta;
			}
			return upsert(state, { ...current, text: next });
		}
		case "message_end": {
			if (!message || typeof message.id !== "string") return state;
			if (message.role !== "assistant") return state;
			const position = state.index.get(message.id);
			const text = messageText(message);
			const settled: TranscriptRecord = {
				kind: "assistant",
				id: message.id,
				ts: position === undefined ? now : state.records[position].ts,
				text,
				streaming: false,
				stopReason: (message.stop_reason as string | null) ?? null,
				error: Boolean(message.is_error),
			};
			return upsert(state, settled);
		}
		case "history_delta": {
			// Settled rows that were never streamed here: same projection as a
			// durable page, keyed by message id.
			const rows = Array.isArray(event.messages)
				? (event.messages as Record<string, unknown>[])
				: [];
			const page: DesktopHistoryPage = {
				entries: rows.map((row) => ({
					id: String(row.id ?? ""),
					// The frame carries no entry time, so the reader's arrival second is
					// the only stamp it can be given here. Dating these rows needs the
					// entry `ts` on the wire — the PR's "not addressed" section names
					// this producer and the two others beside it in the runtime.
					ts: now / 1000,
					type: "message",
					payload: { kind: row.custom_type ? "custom" : "message", ...row },
				})),
				has_more: state.hasMore,
				cursor_missing: false,
			};
			// `reset` is the producer stating that this replay REPLACES the viewport
			// rather than extending it (`HistoryDeltaEvent.reset`, "a replay-changing
			// generation cannot be appended to the old viewport"), and two of the
			// three producers send the WHOLE history that way: the legacy-owner and
			// reset paths in `session/attached.py`. Merging those rows as a page
			// would paint the full transcript at the reader's arrival SECOND — after
			// every row already on screen — which is the ordering defect this module
			// exists to prevent, arriving through a different door. Honouring the
			// flag is the honest reading of the frame and costs one clause; the third
			// producer (the genuine reconnect gap) leaves `reset` false and keeps
			// merging, where the arrival stamp is the gap's own time rather than
			// hours of history mistaken for it.
			return applyHistoryPage(state, page, {
				replace: event.reset === true,
			});
		}
		case "tool_call_compose": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			if (current && current.kind === "tool" && current.phase !== "composing")
				return state;
			return upsert(state, {
				kind: "tool",
				id,
				ts: current?.ts ?? now,
				toolCallId: callId,
				toolName: String(event.tool_name ?? ""),
				intent: (event.intent as string | null) ?? null,
				args: null,
				phase: "composing",
				argumentBytes: Number(event.argument_bytes ?? 0),
				output: null,
				isError: false,
				durationS: null,
				// Composing is the model still dictating arguments, which is not part
				// of the call's execution time. The clock starts at `_start`.
				startedAt: null,
				images: EMPTY_IMAGES,
				added: 0,
				removed: 0,
				// Composing is the model dictating arguments: there is no RESULT
				// yet, so there is no diff. The guard above returns early for any
				// row that already settled, so this cannot blank one.
				diff: null,
				stopped: false,
			});
		}
		case "tool_execution_start": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			if (current && current.kind === "tool" && current.phase === "done")
				return state;
			const args = knownArgs(state, callId, event, current);
			// Remember them for the DURABLE row that will replace this one. The
			// history entry carries the result without the arguments, so without
			// this the row loses its object column the moment it settles onto a
			// page whose assistant row is not in the same page.
			const learned =
				args && !state.argsByCall.has(callId)
					? new Map(state.argsByCall).set(callId, {
							arguments: args,
							// The frame's own start when it states one, so a later replay of
							// this call's settling frame lands where the call really ran rather
							// than where that viewer happened to be looking.
							anchoredAt: epochMs(event) ?? now,
						})
					: state.argsByCall;
			const seeded =
				learned === state.argsByCall
					? state
					: { ...state, argsByCall: learned };
			return upsert(seeded, {
				kind: "tool",
				id,
				ts: current?.ts ?? now,
				toolCallId: callId,
				toolName: String(event.tool_name ?? ""),
				intent:
					(event.intent as string | null) ??
					(typeof args?.i === "string" ? args.i : null),
				args,
				phase: "running",
				argumentBytes: 0,
				output: null,
				isError: false,
				durationS: null,
				// Where the running row's clock counts from. Reuses the existing value
				// when there is one so a replayed `_start` (the reconnect cursor sends
				// them again) cannot restart a clock that is already running — and so
				// the record stays identical under the gate.
				startedAt:
					current?.kind === "tool" && current.startedAt !== null
						? current.startedAt
						: now,
				// A running row has no outcome to report yet. It keeps whatever the
				// composing row held so a rebuild here cannot drop an array the gate
				// is comparing — and the same for a diff, which a replayed `_start`
				// must not be able to erase either.
				images: current?.kind === "tool" ? current.images : EMPTY_IMAGES,
				added: 0,
				removed: 0,
				diff: current?.kind === "tool" ? current.diff : null,
				stopped: false,
			});
		}
		case "tool_execution_end": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			const result = (event.result ?? {}) as Record<string, unknown>;
			// See `knownArgs`: the settling frame carries no arguments, and for a
			// viewer that joined a turn in flight it is the ONLY frame it has for
			// every call that finished before it arrived — so the arguments are
			// recovered from whatever does still hold them (the painted row, or the
			// session-wide map the durable assistant rows fill) rather than settling
			// the row with an empty object column.
			const args = knownArgs(state, callId, event, current);
			const base =
				current && current.kind === "tool"
					? current
					: {
							kind: "tool" as const,
							id,
							ts: now,
							toolCallId: callId,
							toolName: String(event.tool_name ?? ""),
							intent: null,
							args: null,
							phase: "done" as const,
							argumentBytes: 0,
							output: null,
							isError: false,
							durationS: null,
							startedAt: null,
							images: EMPTY_IMAGES,
							added: 0,
							removed: 0,
							diff: null,
							stopped: false,
						};
			// The row is settled, so this is also the last chance to LEARN the call's
			// arguments: a durable row for the same call id replaces this one when its
			// page arrives, and `applyHistoryPage` backfills that replacement from
			// this map. Guarded exactly like `tool_execution_start`, so a frame that
			// teaches nothing new leaves the map — and therefore the state —
			// identical, which is what the view's memoisation depends on.
			const learned =
				args && !state.argsByCall.has(callId)
					? new Map(state.argsByCall).set(callId, {
							arguments: args,
							// A settling frame is the LAST moment this call is dated: it carries
							// no start, so the arrival instant is all the session will ever know
							// — and it is already in hand here, which is the case this anchor
							// exists for.
							anchoredAt: epochMs(event) ?? now,
						})
					: state.argsByCall;
			const seeded =
				learned === state.argsByCall
					? state
					: { ...state, argsByCall: learned };
			return upsert(seeded, {
				...base,
				args,
				phase: "done",
				output: messageText(result) || null,
				isError: Boolean(event.is_error ?? result.is_error),
				durationS:
					typeof event.duration_s === "number" ? event.duration_s : null,
				// The call ended, so the row stops counting and reports the measured
				// duration instead. Clearing this is what makes the ticking stop.
				startedAt: null,
				// THE live screenshot path. A live event is dumped without
				// `exclude_defaults`, so `result.content` carries `{type: "image",
				// data, mime_type}` with the full base64 — a browser-tool capture is
				// renderable here with no backend round trip at all.
				//
				// An EMPTY extraction never replaces images the record already has,
				// which is the reconnect case rather than a hypothetical. A ~1.4 MB
				// base64 screenshot always blows the per-result budget in
				// `_bound_live_result_in_place` (`frontend_state.py`), and an image
				// block over its share is not emptied but REPLACED by a text
				// placeholder — so the seed for a call whose durable row already
				// resolved its digest carries no image blocks at all. Letting that
				// win would discard a resolvable digest in favour of the one frame
				// that was stripped precisely because it could not carry the bytes,
				// and the screenshot would vanish from a row that had it a moment
				// earlier. `applyHistoryPage`'s coalesce guards the same way at
				// `images: current.images.length ? current.images : record.images`.
				images: preferExisting(
					extractImages(result, id, base.images),
					base.images,
				),
				...diffCounts(result.details),
				// THE live diff path: `tool_execution_end` carries the tool RESULT, so
				// `result.details.diff` is the producer's own line list. Guarded the
				// way the images above are, and for the same measured reason — a
				// reconnect seed whose `details` were stripped by the live-event
				// budget must not blank a body the row already showed.
				diff: preferDiff(diffFromDetails(result.details), base.diff),
				// It reported an end, so whatever happened it was not interrupted.
				stopped: false,
			});
		}
		case "notice": {
			const text = String(event.text ?? "");
			if (!text) return state;
			// Notices carry no id; key by text + generation so a replay of the
			// same notice within the same turn does not duplicate it.
			const id = `notice:${state.generation}:${text}`;
			if (state.index.has(id)) return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: now,
				text,
				level: (event.kind as "info" | "warning" | "error") ?? "info",
			});
		}
		case "compaction_end": {
			/*
			 * A FIGURE IS PRESENT WHEN THE EVENT CARRIES ONE, including a zero: the
			 * runtime reports both figures as 0 for a pass that failed, and the durable
			 * row it wrote for that pass carries the same 0 — so the live line must
			 * carry it too, or the two projections of one pass disagree about whether
			 * they HAVE a fingerprint and one pass paints two rows (`typeof` rather
			 * than truthiness, matching `durableRecord`; review round 6, R6-1).
			 */
			const before = Number(event.tokens_before ?? 0);
			const after = Number(event.tokens_after ?? 0);
			const ok = Boolean(event.success);
			const failure = ok ? null : compactionOutcome(String(event.detail ?? ""));
			// The event's own figures, which is the sentence the pairing carries onto
			// the durable row — see `compactionSettledLine` for why this one wins and
			// `COMPACTED_LINE` for what a cold reader gets instead.
			const text = failure
				? failure.text
				: before && after
					? compactionSettledLine(before, after)
					: COMPACTED_LINE;
			// Still keyed by the pass, because it is the id a replayed end matches
			// and the id the collapse below recognises as the live projection.
			const id = `compaction:${state.generation}:${before}:${after}`;
			// The pass is over either way — success, refusal or failure — so this is
			// the clear, applied BEFORE the idempotence guard: a replayed end must
			// still retire a claim it has already painted a record for.
			const settled = state.compacting
				? { ...state, compacting: false, compactingSince: 0 }
				: state;
			if (settled.index.has(id)) return settled;
			/*
			 * A FAILURE is painted as a notice rather than as the settled line, so
			 * it can carry the tier the backend derives for it
			 * (`compactionOutcome`): the compaction record has no ink of its own, so
			 * a failed pass read in the same tone as a successful one — the one
			 * state of this feature the design round could not judge and the tone
			 * the deleted dialog did carry (design round 1, D2).
			 */
			if (failure)
				return upsert(settled, {
					kind: "notice",
					id,
					ts: now,
					text,
					level: failure.level,
				});
			/*
			 * The collapse runs BEFORE the state is returned, because the durable
			 * row may already be painted: a page read while the pass was still
			 * running carries no settled row, and the row that lands afterwards is
			 * the same event this line is projecting — so one of the two has to go,
			 * and it is the live one that goes (`collapseSettledCompactions` states
			 * the rule; it is idempotent, so running it here and in
			 * `applyHistoryPage` is the same answer twice).
			 */
			return collapseRecords(
				upsert(settled, {
					kind: "compaction",
					id,
					ts: now,
					text,
					before,
				}),
			);
		}
		case "retry_start": {
			const text = `Retrying after an error (attempt ${String(event.attempt ?? "?")})${
				event.fallback_model
					? `, falling back to ${String(event.fallback_model)}`
					: ""
			}`;
			const id = `retry:${state.generation}:${String(event.attempt ?? "")}`;
			if (state.index.has(id)) return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: now,
				text,
				level: "warning",
			});
		}
		case "subagent_end": {
			const id = `subagent:${String(event.job_id ?? "")}`;
			const status = String(event.status ?? "");
			const text = `${String(event.label ?? "Subagent")} ${status || "finished"}`;
			const current = state.records[state.index.get(id) ?? -1];
			if (current && current.kind === "notice" && current.text === text)
				return state;
			return upsert(state, {
				kind: "notice",
				id,
				ts: current?.ts ?? now,
				text,
				level: status === "failed" ? "error" : "info",
			});
		}
		default:
			return state;
	}
}

/**
 * `started_at_epoch` in epoch ms when the frame states one, else `null`.
 *
 * The producer stamps it where a call actually began (`harness/loop.py`), which
 * is the only wall clock any tool frame carries: `tool_execution_end` has none.
 * `null` rather than a defaulted instant on purpose — the tempting default is
 * the reader's own arrival dressed as the call's start, which is the fabricated
 * zero the whole `started_at_epoch` path exists to refuse.
 */
function epochMs(event: LiveEvent): number | null {
	const epoch = Number(event.started_at_epoch);
	return Number.isFinite(epoch) && epoch > 0 ? Math.round(epoch * 1000) : null;
}

/** The call id a seeded tool frame names, or `null` for any other frame. */
function seededCallId(event: LiveEvent): string | null {
	if (!event.type.startsWith("tool_")) return null;
	const callId = String(event.tool_call_id ?? "");
	return callId ? callId : null;
}

/**
 * The record id a seeded frame would paint, or `null` when it cannot be
 * attributed without folding it.
 *
 * Mirrors the two id rules `applyEvent` applies — a tool row keys by call id, a
 * message row by the message's own id — because the placement rule below has to
 * ask "would this CREATE a row" BEFORE the frame is folded.
 */
function seededRecordId(event: LiveEvent): string | null {
	const callId = seededCallId(event);
	if (callId) return `tool:${callId}`;
	const message = event.message as { id?: unknown } | undefined;
	return typeof message?.id === "string" && message.id ? message.id : null;
}

/**
 * The epoch ms a seeded row may be placed at, or `null` when the seed makes no
 * statement about WHEN the row happened.
 *
 * Two producers state a time and the backend owns both:
 *
 *   - a `tool_execution_start` carries `started_at_epoch`, so a call still
 *     running is placed at the instant it really began;
 *   - a call the transcript already holds a DURABLE statement about —
 *     `argsByCall`'s `anchoredAt`, the assistant row whose `tool_calls` named
 *     it — dates the settling frame that follows. `tool_execution_end` itself
 *     has no clock field at all, and the start that used to carry one is
 *     DELETED from the seed by the same fold that appends the end
 *     (`frontend_state._fold_live_event`), so when a result is replayed the
 *     durable row that named the call is the only honest anchor left.
 *
 * `null` is a real answer, not a missing value to be defaulted: it says the
 * seed can only claim the row arrived at the viewer now.
 */
function seededClock(event: LiveEvent, state: TranscriptState): number | null {
	const stated = epochMs(event);
	if (stated !== null) return stated;
	const callId = seededCallId(event);
	if (!callId) return null;
	const anchoredAt = state.argsByCall.get(callId)?.anchoredAt;
	// `> 0`, for the reason `epochMs` refuses a non-positive epoch rather than
	// returning one: `applyHistoryPage` anchors a call at its entry's instant, so
	// an entry whose `ts` is missing or zero would anchor every call it names at
	// EPOCH 0 — and a settling frame dated 1970 is not a weak position, it is a
	// fabricated one, sorted to the HEAD of the conversation by `withTimeOrder`
	// the moment it paints. An unusable anchor is no anchor: the frame falls back
	// to the rule a call nothing states gets (refused when the turn is over).
	return typeof anchoredAt === "number" &&
		Number.isFinite(anchoredAt) &&
		anchoredAt > 0
		? anchoredAt
		: null;
}

/**
 * Seed the in-flight turn from a snapshot's `live_events`. Called after the
 * snapshot's history page has been applied so durable rows win.
 *
 * A SEEDED ROW MAY ONLY CLAIM A POSITION IT CAN JUSTIFY. The seed is defined by
 * the runtime as the bounded in-flight turn "a frontend that joins mid-turn
 * would otherwise miss", and this function is where that list becomes painted
 * rows — so this is where the claim gets checked:
 *
 *   - the list is capped at 100 SETTLED CALLS per turn
 *     (`frontend_state.LIVE_EVENT_END_ROWS_MAX`) while a single turn can run for
 *     hours (this harness's own sessions spend hours inside `wait`, and one such
 *     turn's 100 ends reached back past the 100-row page the snapshot carried);
 *     so the seed can name rows OLDER than the conversation's last row;
 *   - `frontend.streaming` is the wire's own statement that a turn is in
 *     flight, and a seed arriving with no turn in flight is not the in-flight
 *     turn it is defined as. The runtime serves exactly that: the desktop bridge
 *     hands over the follower's `frontend_state`, whose `live_events` is emptied
 *     only by a folded `agent_end`, while `refresh_from_session` republishes
 *     `streaming` from the live session and leaves the seed alone — so a viewer
 *     that attaches after a turn ended is handed that turn's seed.
 *
 * Placement therefore follows the frame's own clock where one exists, and a
 * frame that would CREATE a row and states no time is refused outright when no
 * turn is in flight: its only remaining time is the viewer's arrival, and
 * appending it paints `wait`/`hub`/`task` rows from hours earlier under a
 * conversation whose last message is the one the reader expects to be last. A
 * frame whose record is ALREADY painted is folded onto it whatever the clock,
 * because that settles a card the reader can see without moving any row — so a
 * viewer that PAINTED the seed live (the mid-turn join this seed exists for)
 * and then lost the transport keeps those rows where they were painted; the
 * guarantee here is about a frame that would create a row, not about one that
 * finds its row on screen.
 *
 * Refusing loses nothing, but it does not return everything at once: every row
 * such a seed names is durable on the backend and the client fires a read sized
 * for exactly these unlabelled calls (`reconcileLimit`), and that read is ONE
 * tail read — bounded, so a very long turn reaches deeper than it does. Measured
 * on the session this rule was written for (`f91fbda61750`, `reconcileLimit(67)
 * = 234` entries): the read spans journal lines 1244-1477 and therefore brings
 * back the naming rows of 43 of the 67 refused calls (QA, counting only the 62
 * it could locate, measured 41 of 62), while the older ones — an 8-hour turn's
 * earliest work — come back only through the reader's own `load older`. They are
 * not lost (the page stays `has_more`), but this does not promise them at once.
 */
export function applyLiveSeed(
	state: TranscriptState,
	frontend: CanonicalFrontendState,
	now = Date.now(),
): TranscriptState {
	let next = state;
	if (frontend.streaming && frontend.generation > next.generation) {
		next = { ...next, generation: frontend.generation };
	}
	/*
	 * A compaction claim is not CARRIED across a seed, and this is the "a
	 * reconnect must not resurrect a claim" half of its reconciliation.
	 *
	 * The seed is the authoritative statement of which live facts are still true
	 * for this viewer, and the claim is a live-only fact like any other, so the
	 * seed retires it and the loop below re-asserts it only from an event the seed
	 * actually carries. REVIEW ROUND 1 (R4) asked which that is, and the answer
	 * is NONE TODAY, checked rather than assumed:
	 * `frontend_state.py::_fold_live_event` folds exactly the agent/message/tool
	 * kinds into `live_events` — every other kind leaves the list untouched — so a
	 * `compaction_start` is not in the seed, and a reconnect during a pass drops
	 * the rung while the pass keeps running. That is the SAFE direction, and it is
	 * worth stating rather than implying a replay that does not exist: the rung
	 * names work nobody can vouch for otherwise, and the pass's own end still
	 * paints its line when it arrives. Nothing here depends on the replay; the
	 * loop keeps it so a seed that ever does carry the event lands correctly.
	 */
	if (next.compacting)
		next = { ...next, compacting: false, compactingSince: 0 };
	const inFlight = frontend.streaming === true;
	/* A row was placed at a time the seed itself stated, so order by time. */
	let placed = false;
	for (const data of frontend.live_events ?? []) {
		const event = data as LiveEvent;
		let clock = now;
		const id = seededRecordId(event);
		if (id !== null && !next.index.has(id)) {
			const stated = seededClock(event, next);
			if (stated !== null) {
				clock = stated;
				placed = true;
			} else if (!inFlight) {
				continue;
			}
		}
		next = applyEvent(next, event, clock);
	}
	if (!placed) return next;
	const records = withTimeOrder(next.records);
	return { ...next, records, index: withIndex(records) };
}

/**
 * Seed-settled calls whose painted row cannot say what ran.
 *
 * WHAT IT TAKES TO LABEL ONE: the arguments live on the paired assistant row's
 * `tool_calls`, in the durable transcript. `knownArgs` recovers them from
 * whatever the transcript already holds; this names the calls it cannot, which
 * is the set a caller can still close by reading further back into history —
 * and the set it should pay a page for, since an unlabelled row renders nothing
 * but its output.
 *
 * `labelled` is every call id the transcript IN HAND can already answer for:
 * the session-wide `argsByCall` map (filled by live starts and by every durable
 * assistant row seen so far) plus whatever page is arriving with the seed. It
 * is passed in rather than read off a `TranscriptState` because the caller
 * decides the page and the seed together, and the state it must measure against
 * is the one BEFORE that page is applied — not one this module can see.
 *
 * WHY THE CALLER SIZES ITS PAGE FROM THIS rather than using a constant: the
 * seed retains at most `LIVE_EVENT_END_ROWS_MAX` (100) settled calls, each of
 * which costs about two durable entries (its assistant row and its result), so
 * `reconcileLimit` below turns this list into the smallest tail that reaches
 * every one of them — paying for the ACTUAL gap beats both a fixed deeper page
 * on every join and leaving the rows labelled with nothing but their output.
 *
 * Oldest first, deduplicated, and only ids the seed actually settled: a call
 * still running has its start, which carries its own arguments.
 */
export function seedCallsMissingLabels(
	liveEvents: readonly Record<string, unknown>[] | null | undefined,
	labelled: ReadonlySet<string>,
): string[] {
	const missing: string[] = [];
	for (const event of liveEvents ?? []) {
		if (!event || event.type !== "tool_execution_end") continue;
		const callId = String(event.tool_call_id ?? "");
		if (!callId || missing.includes(callId) || labelled.has(callId)) continue;
		missing.push(callId);
	}
	return missing;
}

/**
 * Which calls are still worth a read-back, and the rule that bounds them.
 *
 * ONE rule for both callers, because they answer the same question about
 * different candidate sets: the snapshot's seed names its unlabelled calls once
 * (`seedCallsMissingLabels`), and a round end re-asks about the ones that read
 * could not answer. Half of a seed is labelled by that first read; the rest
 * belong to the round still running, which only becomes durable at its own turn
 * end — so the retry is driven by those rounds and capped, or it becomes an
 * unbounded poll of the history endpoint.
 *
 * Capped PER CALL rather than per session: `maxAttempts` reads is what ONE
 * unlabelable call may cost, and the budget is spent across snapshots. Past it
 * the call has no arguments anywhere to find — a plan the harness rejected emits
 * no start and leaves no assistant row — and re-admitting it through a later
 * snapshot's seed would spend a history page per turn for the rest of the
 * conversation to learn nothing. That is why the caller keeps exhausted ids in
 * `outstanding` instead of forgetting them.
 */
export function labelGapCandidates(
	outstanding: ReadonlyMap<string, number>,
	candidateIds: Iterable<string>,
	labelled: ReadonlySet<string>,
	maxAttempts: number,
): string[] {
	const retries: string[] = [];
	const seen = new Set<string>();
	for (const callId of candidateIds) {
		if (seen.has(callId)) continue;
		seen.add(callId);
		if (labelled.has(callId)) continue;
		if ((outstanding.get(callId) ?? 0) >= maxAttempts) continue;
		retries.push(callId);
	}
	return retries;
}

/**
 * Durable entries one settled call occupies: its assistant row and its result.
 *
 * The ratio is the seed's own shape, not an estimate: `_fold_live_event` keeps
 * one end per call and the durable transcript writes the assistant row holding
 * that call's `tool_calls` plus the tool row holding its result.
 */
export const RECONCILE_ENTRIES_PER_CALL = 2;

/** The tail every reconcile asks for, and the app's ordinary history page. */
export const RECONCILE_TAIL_ENTRIES = 100;

/**
 * The backend's own ceiling for this page.
 *
 * `Query(default=100, ge=1, le=500)` on
 * `/v1/desktop/sessions/{id}/history`. Asking for more is a 422, not a bigger
 * page, so the arithmetic is clamped here rather than relying on the caller.
 */
export const RECONCILE_TAIL_MAX_ENTRIES = 500;

/**
 * The tail to read for a seed that named `missingCalls` unlabelled calls.
 *
 * Zero to fix means the ordinary tail, so the no-op case costs exactly what it
 * cost before this existed.
 */
export function reconcileLimit(missingCalls: number): number {
	if (missingCalls <= 0) return RECONCILE_TAIL_ENTRIES;
	return Math.min(
		RECONCILE_TAIL_MAX_ENTRIES,
		RECONCILE_TAIL_ENTRIES + RECONCILE_ENTRIES_PER_CALL * missingCalls,
	);
}

/** View-only clear: the painted rows go, the backend history is untouched. */
export function clearTranscript(
	state: TranscriptState,
	at: number = Date.now(),
): TranscriptState {
	if (state.records.length === 0) return state;
	// `argsByCall` survives for the same reason it survives a `replace`: the
	// history this clears is still on the backend, and repainting it must not
	// lose the arguments the durable rows do not carry themselves.
	return {
		...EMPTY_TRANSCRIPT,
		generation: state.generation,
		// The in-flight pass is a BACKEND fact, not a painted one: clearing the view
		// does not stop a compaction, so the claim is carried rather than dropped —
		// which is also what the empty-transcript early return above already does.
		compacting: state.compacting,
		compactingSince: state.compactingSince,
		// The reset this counter exists for: a read scheduled against the previous
		// epoch must discard its page rather than repaint what `/clear` removed.
		viewEpoch: state.viewEpoch + 1,
		// The instant a cleared view is scoped by (see the field's own note).
		clearedAt: at,
		argsByCall: state.argsByCall,
	};
}

/**
 * Whether a durable entry is a compaction pass's own outcome row, optionally
 * scoped to the pass a read was scheduled for.
 *
 * `since` is a pass scope rather than a filter the caller re-derives: it is the
 * same instant `tailCarriesOutcome` compares against, so the row a cleared view
 * paints and the row the stop predicate is waiting for are the same pass by
 * construction. Without it, every pass's outcome row qualifies — which is how a
 * cleared view re-admitted the pre-clear ones (QA round 6, Q14).
 */
function isCompactionOutcome(
	entry: DesktopHistoryPage["entries"][number],
	clearedAt?: number,
): boolean {
	const outcome =
		entry.type === "compaction" ||
		(entry.type === "message" &&
			entry.payload?.custom_type === "compaction_refused");
	if (!outcome) return false;
	if (clearedAt === undefined) return true;
	return Math.round((entry.ts ?? 0) * 1000) >= clearedAt;
}

/** A token count as the settled line prints it: `41.0k`, `864`. */
function formatTokens(count: number): string {
	if (count < 1_000) return String(count);
	if (count < 1_000_000) return `${(count / 1_000).toFixed(1)}k`;
	return `${(count / 1_000_000).toFixed(1)}M`;
}

/** Remove live-only records (no durable id) — used when a gap invalidates paint. */
export function dropLiveRecords(state: TranscriptState): TranscriptState {
	/*
	 * The in-flight pass claim is LIVE-ONLY for the same reason those records are:
	 * a receipt gap means the app cannot see whether the pass is still running,
	 * and a reconnect must not inherit a claim from before the gap. Withheld
	 * rather than guessed — and NOT restored by the seed, which carries no
	 * `compaction_start` at all (review round 1, R4: `frontend_state.py::
	 * _fold_live_event` folds agent/message/tool kinds only), so a gap during a
	 * pass drops the rung while the pass runs on.
	 */
	const base = state.compacting
		? { ...state, compacting: false, compactingSince: 0 }
		: state;
	return removeMatching(
		base,
		(record) =>
			(record.kind === "assistant" && record.streaming) ||
			(record.kind === "tool" && record.phase !== "done"),
	);
}

/**
 * Paint the user's own message the instant it is admitted, before the owner
 * echoes it back.
 *
 * Keyed by the ADMISSION REQUEST UUID, which is the id the owner will give the
 * durable row: the request id becomes `command_id`, then `message_id`, then
 * `Message.user(..., id=message_id)`, then the durable `TranscriptEntry` id.
 * That is what makes this an ECHO rather than a duplicate — `upsert` replaces
 * it in place the moment the real row lands, which is the property this
 * module's own header describes ("user rows carry the request UUID, so an
 * optimistic echo and the owner's `message_start` coalesce for free"). Any
 * other key — a local uuid, a timestamp, an index — paints the message twice,
 * permanently.
 *
 * The record is an ordinary `user` record with no pending flag: a distinct
 * variant would break `shallowEqual`'s key-count comparison, so the durable
 * row arriving would always count as changed and re-render.
 */
export function appendPendingUser(
	state: TranscriptState,
	id: string,
	text: string,
	images: TranscriptImage[],
	now = Date.now(),
): TranscriptState {
	// The owner's row wins over a later echo for the same id: re-echoing would
	// otherwise overwrite reconciled content with the composer's original text.
	if (state.index.has(id)) return state;
	return upsert(state, { kind: "user", id, ts: now, text, images });
}

/**
 * Drop one record by id. Used to retract an echo whose send was refused
 * BEFORE admission — the only case where the message provably does not exist
 * on the owner (see `admitChatDraft`'s `refusedBeforeAdmission`).
 */
export function removeRecord(
	state: TranscriptState,
	id: string,
): TranscriptState {
	return removeMatching(state, (record) => record.id === id);
}

let localNoteCounter = 0;

/** Append a renderer-local notice row (never durable, never replayed). */
export function appendLocalNote(
	state: TranscriptState,
	text: string,
	level: "info" | "warning" | "error",
	now = Date.now(),
): TranscriptState {
	localNoteCounter += 1;
	return upsert(state, {
		kind: "notice",
		id: `local:${now}:${localNoteCounter}`,
		ts: now,
		text,
		level,
	});
}

/**
 * Give a crash-recovered outcome a row, so it can be read at all.
 *
 * The normal settle path writes a `completion_attention` transcript entry and
 * `durableRecord` renders it. Crash recovery does not: `bootstrap_transcript`
 * republishes an `interrupted` completion from the `attention_started` journal
 * with anchor `completion-<token>`, and that entry never exists because the
 * turn that would have written it is exactly the one that died.
 *
 * Without a row carrying the anchor, the view finds nothing to hit-test and the
 * conversation stays unread forever while the user is looking straight at it —
 * self-healing only if some later turn completes, which for a finished
 * conversation may be never. The TUI already synthesizes this notice
 * (`tui/app.py::_poll_completion_attention`); this is the same guard for the
 * surface that decides what is renderable on desktop.
 *
 * `unseen` gates CREATION only. The row is itself ackable, so it acknowledges
 * itself within about half a second — and because the receipt writes only to the
 * store and never adds a transcript entry, nothing durable replaces it. Deriving
 * its continued existence from `unseen` therefore made "Interrupted" appear and
 * then vanish under the user, permanently: reopening the conversation the next
 * day showed no trace that the run was ever interrupted. It also disagreed with
 * the TUI, whose `_append_block(NoticeBlock)` survives the receipt, so the two
 * surfaces rendered different transcripts for the same conversation — the exact
 * divergence this feature exists to remove. `remembered` carries the anchors
 * already synthesized for the mounted conversation so the row's LIFETIME matches
 * the TUI's: reading an outcome marks it read, it does not delete it.
 */
export function withRecoveredOutcome(
	state: TranscriptState,
	attention:
		| {
				anchor_id?: string | null;
				kind?: string | null;
				unseen?: boolean;
				conversation_id?: string;
		  }
		| null
		| undefined,
	streaming: boolean,
	remembered?: Set<string>,
): TranscriptState {
	const anchor = attention?.anchor_id;
	const kind = attention?.kind;
	if (
		!anchor ||
		(kind !== "error" && kind !== "interrupted") ||
		// Mirrors the TUI's retry guard: a historical failure must not be
		// inserted at the tail of a retry that is already running.
		streaming ||
		state.index.has(anchor) ||
		// Already read AND never shown here: the outcome was acknowledged on
		// another surface, so this conversation has no row to keep alive.
		(!attention?.unseen && !remembered?.has(anchor))
	)
		return state;
	remembered?.add(anchor);
	return upsert(state, {
		kind: "notice",
		id: anchor,
		// The recovered outcome has no timestamp of its own, so it sorts at the
		// tail where the durable rows it follows already are.
		ts: state.records.at(-1)?.ts ?? Date.now(),
		complete: true,
		text: kind === "error" ? "Stopped with an error" : "Interrupted",
		level: kind === "error" ? "error" : "warning",
	});
}
