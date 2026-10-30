import { Spinner } from "@shared/components/common/spinner";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useAudioEngineStore } from "@shared/store/audio-engine-store";
import {
	CirclePause,
	CirclePlay,
	Volume1,
	Volume2,
	VolumeX,
} from "lucide-react";
import { type ChangeEvent, type FC, memo, useCallback, useState } from "react";
import { formatClock } from "../../canonical/waveform-model";
import { InvalidAttachment } from "./invalid-attachment";

const PATH_SEPARATOR_REGEX = /[/\\]/;

const getFileNameFromPath = (path: string) => {
	try {
		const url = new URL(path);
		// For URLs like http://localhost:5173/audio?path=%2FUsers%2Fdamiantran%2F...
		if (url.searchParams.has("path")) {
			const filePath = url.searchParams.get("path") ?? "";
			return filePath.split(PATH_SEPARATOR_REGEX).pop() ?? "";
		}
		// For direct file URLs
		return url.pathname.split(PATH_SEPARATOR_REGEX).pop() ?? "";
	} catch {
		// Fallback for local file paths or other non-URL strings
		return path.split(PATH_SEPARATOR_REGEX).pop() ?? "";
	}
};

type AudioAttachmentProps = {
	content: string;
	isUser: boolean;
};

/*
 * Disabled is a colour change, never `opacity`. A faded control fades its own
 * ground too, so the same disabled transport button would land on one colour
 * inside a `surface` bubble and another inside a `sunken` one, and neither
 * was designed. See docs/branding.md § 6.
 */
const ICON_BUTTON_CLASS =
	"flex shrink-0 items-center justify-center text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled";

/*
 * The two sliders are native `input[type=range]`, so the only role colour the
 * browser will take from us is `accent-color` — it paints the thumb and the
 * filled part of the track. Stepping it to `ink-disabled` is the same colour
 * move the buttons make, applied to the one property a range exposes.
 */
const RANGE_CLASS =
	"h-1 cursor-pointer accent-accent disabled:pointer-events-none disabled:accent-ink-disabled";

/**
 * The legacy message strip's audio player — now a client of the shared engine.
 *
 * WHY IT MOVED OFF ITS OWN ELEMENT. This component used to build an
 * `HTMLAudioElement` per mount. Two consequences followed: a TTS press and this
 * row's playback could run at once (two elements, no arbiter), and the element
 * lived in the component, so a re-render that remounted the row took playback
 * with it. Both are the shared engine's problem now (`audio-engine-store.ts`),
 * and this file keeps only what is THIS strip's: the legacy chrome (volume,
 * rate, the filename receipt) and the engine notifications it turns into local
 * state.
 *
 * WHAT THE ENGINE DOES NOT GIVE BACK, STATED PLAINLY: a resting row no longer
 * knows its sound's length until something plays it. A metadata probe per row
 * would rebuild the per-mount element this refactor removes, so the duration
 * shown at rest is the engine's own recollection when THIS url is the one the
 * engine holds (`engineUrl === content`), and `0:00` before that. The strip is
 * the legacy surface — the app mounts it from stories — and a probe budget
 * spent on it is the leak the digest-fed player exists to avoid.
 */
export const AudioAttachment: FC<AudioAttachmentProps> = memo(
	({ content }: AudioAttachmentProps) => {
		useI18nLocale();
		/*
		 * The engine identity for this row: the CONTENT is the only name a legacy
		 * attachment has (there is no digest on this wire), and two rows of one
		 * file should share a playback slot the same way two digest rows do.
		 */
		const ownerId = `legacy:${content}`;
		const isActive = useAudioEngineStore((state) => state.ownerId === ownerId);
		const status = useAudioEngineStore((state) =>
			state.ownerId === ownerId ? state.status : "idle",
		);
		const currentTime = useAudioEngineStore((state) =>
			state.ownerId === ownerId ? state.currentTime : 0,
		);
		/*
		 * The duration question above: the engine's figure is trustworthy when
		 * this row owns the element OR when the element is still loaded with
		 * this row's URL (a paused row keeps its metadata; another sound's
		 * activation replaced both).
		 */
		const duration = useAudioEngineStore((state) =>
			state.ownerId === ownerId || state.url === content ? state.duration : 0,
		);
		const volume = useAudioEngineStore((state) => state.volume);
		const playbackRate = useAudioEngineStore((state) => state.playbackRate);
		const [failedOnce, setFailedOnce] = useState(false);

		const playing = isActive && status === "playing";
		const loading = isActive && status === "loading";
		const hasError = isActive && status === "error";

		const handlePlayPause = useCallback(() => {
			setFailedOnce(false);
			void useAudioEngineStore
				.getState()
				.toggle(ownerId, content, { onError: () => setFailedOnce(true) });
		}, [ownerId, content]);

		/** Start at a position when the row is at rest — see the header. */
		const startAt = useCallback(
			(seconds: number) => {
				setFailedOnce(false);
				void useAudioEngineStore
					.getState()
					.play(ownerId, content, { onError: () => setFailedOnce(true) })
					.then((owned) => {
						if (owned === false) return;
						useAudioEngineStore.getState().seek(ownerId, seconds);
					});
			},
			[ownerId, content],
		);

		const handleSeek = useCallback(
			(event: ChangeEvent<HTMLInputElement>) => {
				const seconds = Number(event.target.value);
				if (isActive) useAudioEngineStore.getState().seek(ownerId, seconds);
				else startAt(seconds);
			},
			[isActive, ownerId, startAt],
		);

		const handleVolumeChange = useCallback(
			(event: ChangeEvent<HTMLInputElement>) => {
				useAudioEngineStore.getState().setVolume(Number(event.target.value));
			},
			[],
		);

		const toggleMute = useCallback(() => {
			useAudioEngineStore.getState().setVolume(volume > 0 ? 0 : 1);
		}, [volume]);

		const handlePlaybackRateChange = useCallback((rate: number) => {
			useAudioEngineStore.getState().setPlaybackRate(rate);
		}, []);

		const VolumeIcon =
			volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

		if (hasError || failedOnce) {
			const fileName = getFileNameFromPath(content);
			return <InvalidAttachment file={fileName} />;
		}

		return (
			<div className="flex w-full max-w-[600px] items-center gap-3 rounded-sm border border-hairline bg-surface px-4 py-2">
				<button
					type="button"
					className={ICON_BUTTON_CLASS}
					onClick={handlePlayPause}
					disabled={loading || hasError}
					aria-label={playing ? "Pause" : "Play"}
				>
					{loading ? (
						<Spinner size="sm" />
					) : playing ? (
						<CirclePause size={20} />
					) : (
						<CirclePlay size={20} />
					)}
				</button>
				<span className="min-w-10 text-center text-meta text-ink-muted">
					{formatClock(currentTime)}
				</span>
				<input
					type="range"
					aria-label={t("ui.chat.attachments.playback_position")}
					className={cn(RANGE_CLASS, "min-w-0 flex-1")}
					value={Math.min(currentTime, duration)}
					min={0}
					step={1}
					max={Math.max(duration, 0)}
					onChange={handleSeek}
					disabled={loading || hasError}
				/>
				<span className="min-w-10 text-center text-meta text-ink-muted">
					{formatClock(duration)}
				</span>
				<div className="flex items-center gap-2">
					<button
						type="button"
						className={ICON_BUTTON_CLASS}
						onClick={toggleMute}
						disabled={hasError}
						aria-label={volume === 0 ? "Unmute" : "Mute"}
					>
						<VolumeIcon size={20} />
					</button>
					<input
						type="range"
						aria-label={t("ui.chat.attachments.volume")}
						className={cn(RANGE_CLASS, "w-[70px]")}
						value={volume}
						min={0}
						step={0.1}
						max={1}
						onChange={handleVolumeChange}
						disabled={hasError}
					/>
				</div>
				<select
					aria-label={t("ui.chat.attachments.playback_rate")}
					className="shrink-0 cursor-pointer rounded-sm border border-control bg-surface px-2 py-0.5 text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink disabled:pointer-events-none disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled"
					value={playbackRate}
					onChange={(event) =>
						handlePlaybackRateChange(Number(event.target.value))
					}
					disabled={hasError}
				>
					{[0.5, 1, 1.5, 2].map((rate) => (
						<option key={rate} value={rate}>
							{t("ui.chat.attachments.playback_rate_option", {
								rate: String(rate),
							})}
						</option>
					))}
				</select>
			</div>
		);
	},
);
