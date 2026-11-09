import { Music2 } from "lucide-react";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";

/** Processing identity, never measured waveform data or a completion estimate.
 * Four rhythmic phrase groups deliberately differ from the continuous SFX loader.
 * The motif lives on the detached Jobs row, so ending the submit call cannot
 * make minutes of paid provider work disappear. Actual playback uses stored peaks.
 */
export const MusicJobMotif = ({
	active,
	completed,
	total,
	attribution,
}: {
	active: boolean;
	completed?: number;
	total?: number;
	attribution?: string;
}) => (
	<div
		data-music-processing=""
		className={cn("flex min-w-0 flex-col gap-1 py-1")}
	>
		<div className={cn("flex items-center gap-2 text-ink-muted text-body-sm")}>
			<Music2 size={14} aria-hidden="true" />
			<span>{t("ui.music.label")}</span>
			{typeof total === "number" && total > 0 && (
				<span>
					{t("ui.music.progress", {
						completed: (completed ?? 0).toLocaleString(),
						total: total.toLocaleString(),
					})}
				</span>
			)}
		</div>
		<svg
			width="240"
			height="44"
			viewBox="0 0 240 44"
			aria-hidden="true"
			className={cn(
				"max-w-full text-ink-dim",
				active && "motion-safe:animate-pulse",
			)}
		>
			{[0, 1, 2, 3].map((group) => (
				<g key={group} transform={`translate(${group * 64},0)`}>
					{[8, 20, 32, 20, 12].map((height, index) => (
						<rect
							key={index}
							x={index * 6}
							y={(44 - height) / 2}
							width="4"
							height={height}
							rx="2"
							fill="currentColor"
						/>
					))}
				</g>
			))}
		</svg>
		{attribution && (
			<p className={cn("text-body-sm text-ink")}>{attribution}</p>
		)}
	</div>
);
