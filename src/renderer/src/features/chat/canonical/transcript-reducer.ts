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
			/** Human-readable body when the custom row carries one. */
			text: string;
			attribution: "user" | "agent" | "system";
	  }
	| {
			kind: "compaction";
			id: string;
			ts: number;
			text: string;
	  };

export type TranscriptState = {
	/** Ordered oldest -> newest. */
	records: TranscriptRecord[];
	/** id -> index for O(1) coalescing; rebuilt on every structural change. */
	index: Map<string, number>;
	/** Backend generation of the turn currently in flight, if any. */
	generation: number;
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
	 */
	argsByCall: Map<string, Record<string, unknown>>;
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
	records: [],
	index: new Map(),
	generation: 0,
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
	"compaction_refused",
	"hub_communication",
	"wake_schedule",
	"prune",
]);

function durableRecord(
	entry: DesktopHistoryPage["entries"][number],
	/**
	 * The record already painted for this id, if any. Passed only so an
	 * unchanged `images` array keeps its REFERENCE across a re-read of the same
	 * history page — `shallowEqual` compares by `!==`, so a freshly built array
	 * would report every replayed row as changed and re-render it.
	 */
	previous?: TranscriptRecord,
): TranscriptRecord | null {
	const payload = entry.payload ?? {};
	const ts = Math.round((entry.ts ?? 0) * 1000);
	if (entry.type === "compaction") {
		return { kind: "compaction", id: entry.id, ts, text: "Context compacted" };
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
		const text = String(details.text ?? details.detail ?? "");
		if (!text) return null;
		return {
			kind: "custom",
			id: entry.id,
			ts,
			customType,
			text,
			attribution:
				(payload.attribution as "user" | "agent" | "system") ?? "system",
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
	options: { replace?: boolean } = {},
): TranscriptState {
	const incoming: TranscriptRecord[] = [];
	for (const entry of page.entries) {
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
			argsByCall.set(call.id, call);
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
	if (!changed && state.hasMore === page.has_more) return state;

	// Stable order: by timestamp, ties broken by prior position so a page
	// that lands out of order cannot reshuffle rows the user is reading.
	const priorPosition = new Map(
		base.records.map((record, position) => [record.id, position]),
	);
	const incomingPosition = new Map(
		incoming.map((record, position) => [record.id, position]),
	);
	const records = [...byId.values()].sort((a, b) => {
		if (a.ts !== b.ts) return a.ts - b.ts;
		const pa = priorPosition.get(a.id) ?? incomingPosition.get(a.id) ?? 0;
		const pb = priorPosition.get(b.id) ?? incomingPosition.get(b.id) ?? 0;
		return pa - pb;
	});
	// The paging cursor is the first entry of the OLDEST page received: a
	// newer page (the snapshot's tail after a history_delta) must not move it
	// forward, or the next "load older" request would skip rows.
	const first = page.entries[0];
	let oldestId = base.oldestId;
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
			return { ...state, generation };
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
					ts: now / 1000,
					type: "message",
					payload: { kind: row.custom_type ? "custom" : "message", ...row },
				})),
				has_more: state.hasMore,
				cursor_missing: false,
			};
			return applyHistoryPage(state, page);
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
					? new Map(state.argsByCall).set(callId, { arguments: args })
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
					? new Map(state.argsByCall).set(callId, { arguments: args })
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
			const before = Number(event.tokens_before ?? 0);
			const after = Number(event.tokens_after ?? 0);
			const ok = Boolean(event.success);
			const text = ok
				? before && after
					? `Context compacted, ${formatTokens(before)} to ${formatTokens(after)} tokens`
					: "Context compacted"
				: `Compaction did not run${event.detail ? `: ${String(event.detail)}` : ""}`;
			const id = `compaction:${state.generation}:${before}:${after}`;
			if (state.index.has(id)) return state;
			return upsert(state, { kind: "compaction", id, ts: now, text });
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

function formatTokens(count: number) {
	return count >= 1000 ? `${(count / 1000).toFixed(1)}k` : String(count);
}

/**
 * Seed the in-flight turn from a snapshot's `live_events`. Called after the
 * snapshot's history page has been applied so durable rows win.
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
	for (const data of frontend.live_events ?? []) {
		next = applyEvent(next, data as LiveEvent, now);
	}
	return next;
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
export function clearTranscript(state: TranscriptState): TranscriptState {
	if (state.records.length === 0) return state;
	// `argsByCall` survives for the same reason it survives a `replace`: the
	// history this clears is still on the backend, and repainting it must not
	// lose the arguments the durable rows do not carry themselves.
	return {
		...EMPTY_TRANSCRIPT,
		generation: state.generation,
		argsByCall: state.argsByCall,
	};
}

/** Remove live-only records (no durable id) — used when a gap invalidates paint. */
export function dropLiveRecords(state: TranscriptState): TranscriptState {
	return removeMatching(
		state,
		(record) =>
			(record.kind === "assistant" && record.streaming) ||
			(record.kind === "tool" && record.phase !== "done"),
	);
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
