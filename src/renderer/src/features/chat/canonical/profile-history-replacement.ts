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

/**
 * Core's append-only profile apply replaces an existing message via a prune entry,
 * not another ordinary tool message (Q9-B). Fold only that bounded replacement at
 * the original message's position. The notice is bookkeeping, never a new row or
 * authority. Missing targets on partial pages stay silent until the target is held;
 * native call, receipt, approval and request identities must all agree first.
 */
export function profileHistoryReplacements(
	entries: DesktopHistoryEntry[],
	records: readonly TranscriptRecord[],
): DesktopHistoryEntry[] {
	const originals = new Map(
		entries.filter((e) => e.type === "message").map((e) => [e.id, e]),
	);
	const replacements = new Map<string, DesktopHistoryEntry>();
	const partial = new Map<string, DesktopHistoryEntry>();
	for (const entry of entries) {
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
			!action ||
			action.receipt_id !== after.receipt_id ||
			action.profile_kind !== after.profile_kind ||
			action.profile_name !== after.profile_name
		)
			continue;
		const original = originals.get(target);
		const previous = !original
			? records.find((r) => r.kind === "tool" && r.sourceEntryId === target)
			: undefined;
		if (!original && (!previous || previous.kind !== "tool")) continue;
		const beforePayload = original?.payload;
		const beforeDetails =
			beforePayload && object(beforePayload.provider_payload)
				? beforePayload.provider_payload.details
				: previous?.kind === "tool"
					? previous.details
					: null;
		const before = profileQueuedReceipt(beforeDetails);
		if (after.profile_kind !== toolName) continue;
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
	return entries.map(
		(entry) => replacements.get(entry.id) ?? partial.get(entry.id) ?? entry,
	);
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
