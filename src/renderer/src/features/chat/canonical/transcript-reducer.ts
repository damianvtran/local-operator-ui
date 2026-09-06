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

/** The § 7 tier a record renders at, decided once here rather than per view. */
export type TranscriptRecord =
	| {
			kind: "user";
			id: string;
			ts: number;
			text: string;
			images: number;
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
};

export const EMPTY_TRANSCRIPT: TranscriptState = {
	records: [],
	index: new Map(),
	generation: 0,
	oldestId: null,
	hasMore: false,
};

type ContentBlock = { type?: string; text?: string; data?: string };

/** Text of a canonical message: concatenated text blocks. */
export function messageText(message: Record<string, unknown> | undefined) {
	const content = message?.content;
	if (!Array.isArray(content)) return "";
	return (content as ContentBlock[])
		.filter((block) => block && (block.type ?? "text") === "text")
		.map((block) => block.text ?? "")
		.join("");
}

function imageCount(message: Record<string, unknown> | undefined) {
	const content = message?.content;
	if (!Array.isArray(content)) return 0;
	return (content as ContentBlock[]).filter((block) => block?.type === "image")
		.length;
}

function withIndex(records: TranscriptRecord[]): TranscriptState["index"] {
	const index = new Map<string, number>();
	records.forEach((record, position) => index.set(record.id, position));
	return index;
}

function shallowEqual(a: TranscriptRecord, b: TranscriptRecord) {
	const keysA = Object.keys(a) as (keyof TranscriptRecord)[];
	if (keysA.length !== Object.keys(b).length) return false;
	for (const key of keysA) {
		if (a[key] !== b[key]) return false;
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
			images: imageCount(payload),
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
		const record = durableRecord(entry);
		if (record) incoming.push(record);
	}
	// Tool call args live on the assistant row's tool_calls; carry the intent
	// and args onto the tool record when both are in the same page.
	const argsByCall = new Map<string, Record<string, unknown>>();
	for (const entry of page.entries) {
		const calls = entry.payload?.tool_calls;
		if (!Array.isArray(calls)) continue;
		for (const call of calls as Record<string, unknown>[]) {
			if (call && typeof call.id === "string") argsByCall.set(call.id, call);
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

	const base = options.replace ? EMPTY_TRANSCRIPT : state;
	const byId = new Map(base.records.map((record) => [record.id, record]));
	let changed = options.replace || false;
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
					next = upsert(next, { ...record, phase: "done" });
				}
			}
			return next;
		}
		case "message_start": {
			if (!message || typeof message.id !== "string") return state;
			if (message.role === "user") {
				return upsert(state, {
					kind: "user",
					id: message.id,
					ts: now,
					text: messageText(message),
					images: imageCount(message),
				});
			}
			if (message.role !== "assistant") return state;
			const current = state.records[state.index.get(message.id) ?? -1];
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
			});
		}
		case "tool_execution_start": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			if (current && current.kind === "tool" && current.phase === "done")
				return state;
			const args = (event.args ?? null) as Record<string, unknown> | null;
			return upsert(state, {
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
			});
		}
		case "tool_execution_end": {
			const callId = String(event.tool_call_id ?? "");
			if (!callId) return state;
			const id = `tool:${callId}`;
			const current = state.records[state.index.get(id) ?? -1];
			const result = (event.result ?? {}) as Record<string, unknown>;
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
						};
			return upsert(state, {
				...base,
				phase: "done",
				output: messageText(result) || null,
				isError: Boolean(event.is_error ?? result.is_error),
				durationS:
					typeof event.duration_s === "number" ? event.duration_s : null,
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

/** View-only clear: the painted rows go, the backend history is untouched. */
export function clearTranscript(state: TranscriptState): TranscriptState {
	if (state.records.length === 0) return state;
	return { ...EMPTY_TRANSCRIPT, generation: state.generation };
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
