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
							{/*
							 * One whole message per status (select), not `label + " · " +
							 * suffix`: a language may put the state before the name. The name
							 * is user data passed as an argument, so the runtime isolates it
							 * in an RTL answer (src/i18n/bidi.ts); no wrapper of ours.
							 */}
							{item.status === "completed"
								? item.label
								: t("ui.chat.canonical.sound.batch.item_status", {
										status: item.status,
										label: item.label,
									})}
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
							{item.costCaption ?? t("ui.chat.canonical.sound.cost.unknown")}
						</p>
					</li>
				))}
			</ul>
		</div>
	);
}
