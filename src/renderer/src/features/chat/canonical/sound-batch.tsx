import { cn } from "@shared/lib/utils";
import { CanonicalAudio } from "./canonical-audio";
import type { SoundBatchItem } from "./sound-batch-model";
import type { AttachmentScope } from "./use-attachment-url";

/**
 * Rows keep the approved player's full scrubber width at narrow transcript
 * sizes. A failed request has no player; it must not take the successes' seat
 * or replace the whole result with a failure card.
 */
export function SoundBatch({
	items,
	scope,
}: {
	items: readonly SoundBatchItem[];
	scope: AttachmentScope | null;
}) {
	return (
		<div
			data-sound-batch=""
			className={cn("flex w-full min-w-0 max-w-[560px] flex-col gap-4")}
		>
			<p
				className={cn(
					"text-meta text-ink-muted break-words [overflow-wrap:anywhere]",
				)}
			>
				{items.filter((item) => item.status === "completed").length} completed ·{" "}
				{items.filter((item) => item.status === "failed").length} failed
				{items.some((item) => item.status === "cancelled")
					? ` · ${items.filter((item) => item.status === "cancelled").length} cancelled/stopped`
					: ""}{" "}
				— {items.map((item) => item.label).join(", ")}
			</p>
			{items.map((item) => (
				<div key={item.id} data-sound-batch-item="" className={cn("min-w-0")}>
					<p
						className={cn(
							"text-body text-ink break-words [overflow-wrap:anywhere]",
						)}
					>
						{item.label}
					</p>
					{item.error ? (
						<p
							className={cn(
								"text-meta text-ink-muted break-words [overflow-wrap:anywhere]",
							)}
						>
							{item.error}
						</p>
					) : item.audio ? (
						<CanonicalAudio
							audio={item.audio}
							scope={scope}
							label={item.label}
						/>
					) : (
						<p className={cn("text-meta text-ink-muted")}>
							Audio attachment unavailable.
						</p>
					)}
					<p className={cn("text-meta text-ink-muted")}>
						{item.costCaption ?? "Cost not yet known."}
					</p>
				</div>
			))}
		</div>
	);
}
