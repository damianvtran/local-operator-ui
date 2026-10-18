import { soundCostCaption } from "./sound-cost-caption";
import type { TranscriptImage } from "./transcript-reducer";

export type SoundBatchItem = {
	id: string;
	name: string;
	label: string;
	audio: TranscriptImage | null;
	costCaption: string | null;
	error: string | null;
	status: "completed" | "failed" | "cancelled";
};

/**
 * Batch receipts decorate the session's existing attachments, never create a
 * second media index. Match by digest rather than array position: failed
 * requests have a receipt but no attachment, and providers can finish out of order.
 * A one-item call deliberately stays on the approved single-player path.
 */
export function soundBatchItems(
	details: unknown,
	attachments: readonly TranscriptImage[],
): SoundBatchItem[] | null {
	if (!details || typeof details !== "object") return null;
	const artifacts = (details as Record<string, unknown>).artifacts;
	if (!Array.isArray(artifacts) || artifacts.length < 2) return null;
	// Durable rows may predate this contract. Reject malformed metadata as a
	// unit rather than losing a playable attachment to an incomplete receipt.
	if (
		artifacts.some(
			(item) =>
				!item || typeof item !== "object" || typeof item.name !== "string",
		)
	)
		return null;
	const occurrences = new Map<string, number>();
	const names = new Set(artifacts.map((item) => item.name));
	const labels = new Set<string>();
	return artifacts.map((raw) => {
		const artifact = raw as Record<string, unknown>;
		const name = typeof artifact.name === "string" ? artifact.name : "";
		const occurrence = (occurrences.get(name) ?? 0) + 1;
		occurrences.set(name, occurrence);
		let suffix = occurrence;
		let label = occurrence === 1 ? name : `${name} (${suffix})`;
		// Do not turn a duplicate into the identity of another literal backend
		// name, e.g. two “Rain” requests alongside one actually named “Rain (2)”.
		while (labels.has(label) || (label !== name && names.has(label))) {
			label = `${name} (${++suffix})`;
		}
		labels.add(label);
		const audio =
			attachments.find(
				(entry) =>
					entry.kind === "audio" &&
					typeof artifact.digest === "string" &&
					entry.attachment === artifact.digest,
			) ?? null;
		return {
			id: JSON.stringify([artifact.request_id ?? null, name, occurrence]),
			name,
			label,
			audio,
			costCaption: batchItemCostCaption(artifact),
			status:
				artifact.status === "cancelled"
					? "cancelled"
					: artifact.status === "failed" || artifact.error
						? "failed"
						: "completed",
			error: typeof artifact.error === "string" ? artifact.error : null,
		};
	});
}

/** Batch provenance is nested in `cost`; single-form receipts stay untouched. */
function batchItemCostCaption(result: Record<string, unknown>): string | null {
	const cost =
		result.cost && typeof result.cost === "object"
			? (result.cost as Record<string, unknown>)
			: null;
	return soundCostCaption({
		...result,
		billing_basis: cost?.basis ?? result.billing_basis,
	});
}

/** Never relabel a known subtotal as a final charge or sum money in the UI. */
export function soundBatchCostCaption(details: unknown): string {
	const result = details as Record<string, unknown>;
	const caption = batchItemCostCaption(result);
	if (!caption) return "Total cost not yet known.";
	const complete = result.cost_complete === true;
	return `${complete ? "Total cost" : "Known total cost"} ${caption.slice(5)}${complete ? "" : " Unknown or late charges are not included."}`;
}
