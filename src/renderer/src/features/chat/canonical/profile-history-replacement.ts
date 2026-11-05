import type { DesktopHistoryEntry } from "../../../../../shared/desktop-session-contract";
import {
	profileQueuedReceipt,
	profileRevertDescriptor,
} from "../../../../../shared/profile-consent";
import { profileWriteDetails } from "../components/trace/tool-result-details";
import type { TranscriptRecord } from "./transcript-reducer";

function object(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** Per-transcript, never process-global: a different conversation gets a new state. */
export type PendingProfileHistoryReplacement = {
	entry: DesktopHistoryEntry;
	conflict?: boolean;
};
export const MAX_PENDING_PROFILE_REPLACEMENTS = 32;
const MAX_PROFILE_REPLACEMENT_BYTES = 32 * 1024;
const MAX_PENDING_PROFILE_BYTES = 256 * 1024;

/**
 * Core's append-only profile apply replaces an existing message via a prune entry,
 * not another ordinary tool message (Q9-B). Fold only that bounded replacement at
 * the original message's position. The notice is bookkeeping, never a new row or
 * authority. Missing targets on partial pages stay silent until the target is held;
 * native call, receipt, approval and request identities must all agree first.
 *
 * A newest-first page can contain the prune before its older target (C9-1).
 * Retain only validated, non-rendered candidates in the owning transcript, bounded
 * to 32 entries / 256 KiB total / 32 KiB per entry. Overflow is refused, not
 * promoted to completion. A scope/view/source reset drops this temporary state;
 * pagination alone does not. Conflicts remain non-authoritative tombstones.
 */
export function profileHistoryReplacements(
	entries: DesktopHistoryEntry[],
	records: readonly TranscriptRecord[],
	pending: readonly PendingProfileHistoryReplacement[] = [],
): {
	entries: DesktopHistoryEntry[];
	pending: readonly PendingProfileHistoryReplacement[];
} {
	const originals = new Map(
		entries.filter((e) => e.type === "message").map((e) => [e.id, e]),
	);
	const replacements = new Map<string, DesktopHistoryEntry>();
	const partial = new Map<string, DesktopHistoryEntry>();
	const grouped = new Map<string, PendingProfileHistoryReplacement>();
	const conflicts = new Set(
		pending.filter((p) => p.conflict).map((p) => p.entry.payload.target),
	);
	for (const entry of [...pending.map((p) => p.entry), ...entries]) {
		if (entry.type !== "prune" || !object(entry.payload)) continue;
		const { target, replacement } = entry.payload;
		if (
			typeof target !== "string" ||
			!Number.isFinite(entry.ts) ||
			!object(replacement) ||
			replacement.kind !== "message" ||
			replacement.role !== "tool" ||
			!Array.isArray(replacement.content) ||
			!object(replacement.provider_payload)
		)
			continue;
		// No general replay engine: accept only the producer's native tool-message
		// replacement shape. Unrelated prune families keep their existing semantics.
		if (
			Object.keys(replacement).some(
				(k) =>
					![
						"kind",
						"role",
						"content",
						"tool_call_id",
						"tool_name",
						"provider_payload",
					].includes(k),
			)
		)
			continue;
		if (
			replacement.content.length === 0 ||
			replacement.content.some(
				(block) =>
					!object(block) ||
					typeof block.text !== "string" ||
					block.text.length > 100_000 ||
					(block.type !== undefined && block.type !== "text"),
			)
		)
			continue;
		const toolName = replacement.tool_name;
		if (
			typeof toolName !== "string" ||
			typeof replacement.tool_call_id !== "string" ||
			replacement.tool_call_id.length === 0
		)
			continue;
		const details = profileWriteDetails(
			toolName,
			replacement.provider_payload.details,
		);
		const after = profileQueuedReceipt(details);
		const action = profileRevertDescriptor(after?.profile_action);
		if (
			!after ||
			after.status !== "applied" ||
			after.profile_kind !== toolName ||
			!action ||
			action.receipt_id !== after.receipt_id ||
			action.profile_kind !== after.profile_kind ||
			action.profile_name !== after.profile_name
		)
			continue;
		// A conflicting publication for one target is not a last-writer-wins
		// instruction. Keep a bounded tombstone until its target is encountered.
		const held = grouped.get(target);
		const conflict =
			conflicts.has(target) ||
			Boolean(
				held &&
					JSON.stringify(held.entry.payload.replacement) !==
						JSON.stringify(replacement),
			);
		grouped.set(target, {
			entry: held?.entry ?? entry,
			...(conflict || held?.conflict ? { conflict: true } : {}),
		});
	}
	const deferred: PendingProfileHistoryReplacement[] = [];
	let deferredBytes = 2;
	const defer = (candidate: PendingProfileHistoryReplacement) => {
		// This is a retention budget, not a new admission limit (C10-1).
		// An already-resolvable receipt stays governed by the existing strict
		// schema/carrier bounds; only missing-target candidates spend this budget.
		if (
			new TextEncoder().encode(JSON.stringify(candidate.entry)).length >
			MAX_PROFILE_REPLACEMENT_BYTES
		)
			return;
		const bytes =
			new TextEncoder().encode(JSON.stringify(candidate)).length +
			(deferred.length ? 1 : 0);
		if (
			deferred.length < MAX_PENDING_PROFILE_REPLACEMENTS &&
			deferredBytes + bytes <= MAX_PENDING_PROFILE_BYTES
		) {
			deferred.push(candidate);
			deferredBytes += bytes;
		}
	};
	for (const candidate of grouped.values()) {
		const { entry } = candidate;
		const { target, replacement } = entry.payload as {
			target: string;
			replacement: Record<string, unknown>;
		};
		const toolName = replacement.tool_name as string;
		const after = profileQueuedReceipt(
			(replacement.provider_payload as Record<string, unknown>).details,
		);
		if (!after) continue;
		const original = originals.get(target);
		const previous = !original
			? records.find((r) => r.kind === "tool" && r.sourceEntryId === target)
			: undefined;
		if (
			candidate.conflict ||
			(!original && (!previous || previous.kind !== "tool"))
		) {
			defer(candidate);
			continue;
		}
		// Consume exactly once when the target arrives, even on a bad binding.
		// A conflict tombstone remains until reset so replay cannot pick a winner.

		const beforePayload = original?.payload;
		const beforeDetails =
			beforePayload && object(beforePayload.provider_payload)
				? beforePayload.provider_payload.details
				: previous?.kind === "tool"
					? previous.details
					: null;
		const before = profileQueuedReceipt(beforeDetails);
		const callId =
			beforePayload?.tool_call_id ??
			(previous?.kind === "tool" ? previous.toolCallId : null);
		const beforeTool =
			beforePayload?.tool_name ??
			(previous?.kind === "tool" ? previous.toolName : null);
		const originalTs = original?.ts ?? (previous ? previous.ts / 1000 : 0);
		if (
			original &&
			(beforePayload?.role !== "tool" || original.type !== "message")
		)
			continue;
		if (
			!before ||
			beforeTool !== toolName ||
			callId !== replacement.tool_call_id ||
			entry.ts < originalTs ||
			!before.receipt_id ||
			!before.approval_id ||
			!before.request_digest ||
			before.receipt_id !== after.receipt_id ||
			before.approval_id !== after.approval_id ||
			before.request_digest !== after.request_digest ||
			before.profile_kind !== after.profile_kind ||
			before.profile_name !== after.profile_name ||
			before.scope !== after.scope
		)
			continue;
		const effective: DesktopHistoryEntry = original
			? { ...original, payload: replacement }
			: {
					id: target,
					type: "message",
					ts: originalTs,
					payload: replacement,
					...(previous?.journalSeq !== undefined
						? { journal_seq: previous.journalSeq }
						: {}),
				};
		if (original) replacements.set(target, effective);
		else partial.set(entry.id, effective);
	}
	const normalized = entries.map(
		(entry) => replacements.get(entry.id) ?? partial.get(entry.id) ?? entry,
	);
	// A deferred prune can bind a target already held by this view even if neither
	// appears on the new page. Keep its original native message identity, not a row
	// for the prune's notice. Current-page prunes were already mapped above.
	for (const [pruneId, effective] of partial) {
		if (!entries.some((entry) => entry.id === pruneId))
			normalized.push(effective);
	}
	const samePending =
		pending.length === deferred.length &&
		deferred.every(
			(p, i) =>
				p.entry === pending[i].entry && p.conflict === pending[i].conflict,
		);
	return { entries: normalized, pending: samePending ? pending : deferred };
}

/** An original-only older page cannot undo its already admitted append-only prune. */
export function retainAppliedProfileReplacement(
	entry: DesktopHistoryEntry,
	previous: TranscriptRecord | undefined,
): boolean {
	if (
		!previous ||
		previous.kind !== "tool" ||
		previous.sourceEntryId !== entry.id ||
		entry.type !== "message" ||
		entry.payload.role !== "tool" ||
		entry.payload.tool_call_id !== previous.toolCallId ||
		entry.payload.tool_name !== previous.toolName ||
		!object(entry.payload.provider_payload)
	)
		return false;
	const queued = profileQueuedReceipt(entry.payload.provider_payload.details);
	const applied = profileQueuedReceipt(previous.details);
	return Boolean(
		queued?.status === "queued" &&
			applied?.status === "applied" &&
			queued.receipt_id &&
			queued.receipt_id === applied.receipt_id &&
			queued.approval_id &&
			queued.approval_id === applied.approval_id &&
			queued.request_digest &&
			queued.request_digest === applied.request_digest &&
			queued.profile_kind === applied.profile_kind &&
			queued.profile_name === applied.profile_name &&
			queued.scope === applied.scope,
	);
}
