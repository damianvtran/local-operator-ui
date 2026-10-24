import { t } from "../../../../../i18n/messages";
import { soundCostCaption } from "./sound-cost-caption";
import type { TranscriptImage } from "./transcript-reducer";

export type SoundBatchItem = {
	id: string;
	name: string;
	label: string;
	audio: TranscriptImage | null;
	costCaption: string | null;
	error: string | null;
	status: "completed" | "failed" | "cancelled" | "unknown";
};

/**
 * Batch receipts decorate the session's existing attachments, never create a
 * second media index. Match by digest rather than array position: failed
 * requests have a receipt but no attachment, and providers can finish out of order.
 * A one-item batch is still a named batch. Legacy single-form receipts have
 * artifacts too, so only batch-exclusive counters/settlement fields select it.
 */
export function soundBatchItems(
	details: unknown,
	attachments: readonly TranscriptImage[],
): SoundBatchItem[] | null {
	if (!details || typeof details !== "object") return null;
	const result = details as Record<string, unknown>;
	const artifacts = result.artifacts;
	if (
		!isSoundBatchDetails(result) ||
		!Array.isArray(artifacts) ||
		artifacts.length === 0
	)
		return null;
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
		let label =
			occurrence === 1
				? name
				: t("ui.chat.canonical.sound_batch_model.name_suffix", {
						name,
						suffix,
					});
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
			costCaption: batchItemCostCaption(artifact, true),
			status:
				artifact.status === "cancelled"
					? "cancelled"
					: artifact.status === "failed" || artifact.error
						? "failed"
						: artifact.status === "completed"
							? "completed"
							: "unknown",
			error: typeof artifact.error === "string" ? artifact.error : null,
		};
	});
}

/** Batch provenance is nested in `cost`; single-form receipts stay untouched. */
function batchItemCostCaption(
	result: Record<string, unknown>,
	item = false,
): string | null {
	const cost =
		result.cost && typeof result.cost === "object"
			? (result.cost as Record<string, unknown>)
			: null;
	if (
		item &&
		(result.status === "failed" || result.error) &&
		result.cost_usd === 0
	) {
		if (cost?.basis === "billed")
			return t("ui.chat.canonical.sound_batch_model.no_charge");
		if (cost?.basis === "estimated")
			return t(
				"ui.chat.canonical.sound_batch_model.estimated_cost_0_final_charge_not_confirmed",
			);
	}
	return soundCostCaption({
		...result,
		billing_basis: cost?.basis ?? result.billing_basis,
	});
}

/** Never relabel a known subtotal as a final charge or sum money in the UI. */
export function soundBatchCostCaption(details: unknown): string {
	const result = details as Record<string, unknown>;
	const caption = batchItemCostCaption(result);
	if (!caption)
		return t("ui.chat.canonical.sound_batch_model.total_cost_not_yet_known");
	const complete = result.cost_complete === true;
	return `${complete ? t("ui.chat.canonical.sound_batch_model.total_cost") : t("ui.chat.canonical.sound_batch_model.known_total_cost")} ${caption.slice(5)}${complete ? "" : t("ui.chat.canonical.sound_batch_model.unknown_or_late_charges_are_not_included")}`;
}

/** Legacy single results carry artifacts, but none of these batch-only facts. */
export function isSoundBatchDetails(details: Record<string, unknown>): boolean {
	return (
		"cost_complete" in details ||
		["completed", "failed", "cancelled"].some((key) => key in details)
	);
}

/** Server counters outrank attachment availability; an unknown status is not success. */
export function soundBatchSummary(
	details: unknown,
	items: readonly SoundBatchItem[],
): string {
	const result = details as Record<string, unknown>;
	const count = (key: "completed" | "failed" | "cancelled") => {
		const value = result[key];
		return typeof value === "number" && Number.isInteger(value) && value >= 0
			? value
			: items.filter((item) => item.status === key).length;
	};
	const cancelled = count("cancelled");
	const unknown = items.filter((item) => item.status === "unknown").length;
	const attention = items.filter((item) => item.status !== "completed");
	return t("ui.chat.canonical.sound_batch_model.summary", {
		completed: count("completed"),
		failed: count("failed"),
		cancelled,
		unknown,
		hasAttention: attention.length ? "true" : "false",
		attention: attention.map((item) => item.label).join("; "),
	});
}

/** The aggregate cause belongs beside item errors, not hidden by them. */
export function soundBatchNote(
	details: unknown,
	output?: string | null,
): string | null {
	const result = details as Record<string, unknown>;
	if (typeof result.error === "string" && result.error) return result.error;
	const header = output?.split("\n")[0];
	if (!header) return null;
	// The producer's first line holds the time-budget/stop cause; following
	// lines are the item index already rendered below. Keep its wording intact.
	const reasonAt = header.indexOf("Batch ");
	return reasonAt >= 0 ? header.slice(reasonAt) : null;
}

/** Live updates identify the latest item, not the number of completed items. */
export function soundBatchProgress(
	args: unknown,
	details: unknown,
): { total: number; note: string | null } | null {
	const result =
		details && typeof details === "object"
			? (details as Record<string, unknown>)
			: {};
	const sounds =
		args && typeof args === "object"
			? (args as Record<string, unknown>).sounds
			: null;
	const total =
		typeof result.total === "number" &&
		Number.isInteger(result.total) &&
		result.total > 0
			? result.total
			: Array.isArray(sounds) && sounds.length
				? sounds.length
				: null;
	if (total === null) return null;
	const item = result.item;
	const note =
		typeof item === "number" &&
		Number.isInteger(item) &&
		item >= 1 &&
		item <= total &&
		typeof result.name === "string"
			? t(
					"ui.chat.canonical.sound_batch_model.latest_update_name_item_item_of_total",
					{ name: result.name, item: item, total: total },
				)
			: null;
	return { total, note };
}
