import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { CanonicalAudio } from "./canonical-audio";
import type { MusicReceipt } from "./music-receipt-model";
import { soundCostCaption } from "./sound-cost-caption";
import type { AttachmentScope } from "./use-attachment-url";

/** Every child keeps its title, authoritative receipt and playback slot. A
 * failed sibling never replaces purchased audio with a global error/spinner. */
export const MusicResult = ({
	receipt,
	scope,
}: { receipt: MusicReceipt; scope: AttachmentScope | null }) => (
	<div data-music-result="" className={cn("mt-2 flex min-w-0 flex-col gap-3")}>
		{receipt.attribution && (
			<p className={cn("text-body-sm text-ink")}>{receipt.attribution}</p>
		)}
		{receipt.tracks.length === 0 && (
			<p className={cn("text-body-sm text-ink-muted")}>{t("ui.music.empty")}</p>
		)}
		{receipt.tracks.map((track) => {
			const label =
				track.title || t("ui.music.track", { index: track.variantIndex + 1 });
			const cost = track.cost ? soundCostCaption({ cost: track.cost }) : null;
			return (
				<div
					key={track.id}
					data-music-track={track.id}
					className={cn("flex min-w-0 flex-col gap-1")}
				>
					<p className={cn("text-body-sm text-ink")}>{label}</p>
					{track.title && receipt.tracks.length > 1 && (
						<p className={cn("text-body-sm text-ink-muted")}>
							{t("ui.music.track", { index: track.variantIndex + 1 })}
						</p>
					)}
					{track.images.map((audio) => (
						<CanonicalAudio
							key={audio.id}
							audio={audio}
							scope={scope}
							label={audio.name || label}
						/>
					))}
					{track.error && (
						<p className={cn("text-body-sm text-danger")}>
							{t("ui.music.failed")}
						</p>
					)}
					{cost && <p className={cn("text-body-sm text-ink-muted")}>{cost}</p>}
				</div>
			);
		})}
	</div>
);
