import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { CanonicalAudio, soundOwnerId } from "./canonical-audio";
import type { SoundBatchItem } from "./sound-batch-model";
import type { AttachmentScope } from "./use-attachment-url";

/**
 * Rows keep the approved player's full scrubber width at narrow transcript
 * sizes. A failed request has no player; it must not take the successes' seat
 * or replace the whole result with a failure card.
 */
export function SoundBatch({
	items,
	summary,
	scope,
}: {
	items: readonly SoundBatchItem[];
	summary: string;
	scope: AttachmentScope | null;
}) {
	useI18nLocale();
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
				{summary}
			</p>
			<ul className="flex min-w-0 flex-col gap-4">
				{items.map((item) => (
					<li key={item.id} data-sound-batch-item="" className={cn("min-w-0")}>
						<p
							className={cn(
								"text-body text-ink break-words [overflow-wrap:anywhere]",
							)}
						>
							{item.label}
							{item.status !== "completed"
								? ` · ${item.status === "unknown" ? "Status unknown" : item.status === "cancelled" ? "Stopped" : "Failed"}`
								: ""}
						</p>
						{item.error ? (
							<p
								className={cn(
									"text-body-sm text-ink break-words [overflow-wrap:anywhere]",
								)}
							>
								{item.error}
							</p>
						) : item.audio ? (
							<CanonicalAudio
								audio={item.audio}
								ownerId={`${soundOwnerId(item.audio)}:batch:${item.audio.id}:${item.id}`}
								scope={scope}
								label={item.label}
							/>
						) : (
							<p className={cn("text-meta text-ink-muted")}>
								{t("ui.chat.canonical.sound.batch_attachment_unavailable")}
							</p>
						)}
						<p className={cn("text-meta text-ink-dim")}>
							{item.costCaption ?? "Cost not yet known."}
						</p>
					</li>
				))}
			</ul>
		</div>
	);
}
