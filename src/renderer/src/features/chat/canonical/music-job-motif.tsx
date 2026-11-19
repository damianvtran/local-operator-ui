import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Music2 } from "lucide-react";

/** Processing identity, never measured waveform data or a completion estimate.
 * Four rhythmic phrase groups deliberately differ from the continuous SFX loader.
 * The motif lives on the detached Jobs row, so ending the submit call cannot
 * make minutes of paid provider work disappear. Actual playback uses stored peaks.
 */
export const MusicJobMotif = ({
	active,
	settled = false,
	completed,
	total,
	attribution,
}: {
	active: boolean;
	/**
	 * The job has finished (D1, design r17): the motif stays painted, static
	 * and dimmed, in the same 240x44 box. Removing it would shrink the in-chat
	 * card as the job settles; leaving it at full ink read as still working.
	 * Absent on the Jobs row, whose settled rows keep their own treatment.
	 */
	settled?: boolean;
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
			// The motif's own box, apart from the label's lucide icon: geometry and
			// reduced-motion probes measure this element, never the first svg found.
			data-music-motif=""
			width="240"
			height="44"
			viewBox="0 0 240 44"
			aria-hidden="true"
			className={cn(
				"max-w-full text-ink-dim",
				active && !settled && "motion-safe:animate-pulse",
				settled && "opacity-40",
			)}
		>
			{[0, 1, 2, 3].map((group) => (
				<g key={group} transform={`translate(${group * 64},0)`}>
					{[
						{ id: 0, height: 8 },
						{ id: 1, height: 20 },
						{ id: 2, height: 32 },
						{ id: 3, height: 20 },
						{ id: 4, height: 12 },
					].map(({ height, id }) => (
						<rect
							key={id}
							x={id * 6}
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
