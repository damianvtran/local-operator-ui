import { Spinner } from "@shared/components/common/spinner";
import { cn } from "@shared/lib/utils";
import {
	PauseCircle,
	PlayCircle,
	Volume1,
	Volume2,
	VolumeX,
} from "lucide-react";
import {
	type ChangeEvent,
	type FC,
	memo,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
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

export const AudioAttachment: FC<AudioAttachmentProps> = memo(({ content }) => {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [volume, setVolume] = useState(1);
	const [playbackRate, setPlaybackRate] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const [hasError, setHasError] = useState(false);

	useEffect(() => {
		const audioElement = new Audio(content);
		audioRef.current = audioElement;
		setIsLoading(true);

		const handleLoadedMetadata = () => {
			if (audioRef.current) {
				setDuration(audioRef.current.duration);
				setIsLoading(false);
			}
		};

		const handleTimeUpdate = () => {
			if (audioRef.current) {
				setCurrentTime(audioRef.current.currentTime);
			}
		};

		const handleEnded = () => {
			setIsPlaying(false);
			setCurrentTime(0);
		};

		const handleError = () => {
			setHasError(true);
			setIsLoading(false);
		};

		audioElement.addEventListener("loadedmetadata", handleLoadedMetadata);
		audioElement.addEventListener("timeupdate", handleTimeUpdate);
		audioElement.addEventListener("ended", handleEnded);
		audioElement.addEventListener("error", handleError);

		return () => {
			audioElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
			audioElement.removeEventListener("timeupdate", handleTimeUpdate);
			audioElement.removeEventListener("ended", handleEnded);
			audioElement.removeEventListener("error", handleError);
		};
	}, [content]);

	const handlePlayPause = useCallback(() => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause();
			} else {
				audioRef.current.play().catch(console.error);
			}
			setIsPlaying(!isPlaying);
		}
	}, [isPlaying]);

	const handleSeek = useCallback((event: ChangeEvent<HTMLInputElement>) => {
		const newValue = Number(event.target.value);
		if (audioRef.current) {
			audioRef.current.currentTime = newValue;
			setCurrentTime(newValue);
		}
	}, []);

	const handleVolumeChange = useCallback(
		(event: ChangeEvent<HTMLInputElement>) => {
			const newVolume = Number(event.target.value);
			if (audioRef.current) {
				audioRef.current.volume = newVolume;
				setVolume(newVolume);
			}
		},
		[],
	);

	const toggleMute = useCallback(() => {
		if (audioRef.current) {
			const newVolume = volume > 0 ? 0 : 1;
			audioRef.current.volume = newVolume;
			setVolume(newVolume);
		}
	}, [volume]);

	const handlePlaybackRateChange = useCallback((rate: number) => {
		if (audioRef.current) {
			audioRef.current.playbackRate = rate;
			setPlaybackRate(rate);
		}
	}, []);

	const formatTime = (time: number) => {
		if (Number.isNaN(time) || time === 0) return "0:00";
		const minutes = Math.floor(time / 60);
		const seconds = Math.floor(time % 60);
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	};

	const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

	if (hasError) {
		const fileName = getFileNameFromPath(content);
		return <InvalidAttachment file={fileName} />;
	}

	return (
		<div className="flex w-full max-w-[600px] items-center gap-3 rounded-sm border border-hairline bg-surface px-4 py-2">
			<button
				type="button"
				className={ICON_BUTTON_CLASS}
				onClick={handlePlayPause}
				disabled={isLoading || hasError}
				aria-label={isPlaying ? "Pause" : "Play"}
			>
				{isLoading ? (
					<Spinner size="sm" />
				) : isPlaying ? (
					<PauseCircle size={20} />
				) : (
					<PlayCircle size={20} />
				)}
			</button>
			<span className="min-w-10 text-center text-meta text-ink-muted">
				{formatTime(currentTime)}
			</span>
			<input
				type="range"
				aria-label="time-indicator"
				className={cn(RANGE_CLASS, "min-w-0 flex-1")}
				value={currentTime}
				min={0}
				step={1}
				max={duration}
				onChange={handleSeek}
				disabled={isLoading || hasError}
			/>
			<span className="min-w-10 text-center text-meta text-ink-muted">
				{formatTime(duration)}
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
					aria-label="volume-control"
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
				aria-label="Playback rate"
				className="shrink-0 cursor-pointer rounded-sm border border-control bg-surface px-2 py-0.5 text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink disabled:pointer-events-none disabled:border-hairline disabled:bg-sunken disabled:text-ink-disabled"
				value={playbackRate}
				onChange={(event) =>
					handlePlaybackRateChange(Number(event.target.value))
				}
				disabled={hasError}
			>
				{[0.5, 1, 1.5, 2].map((rate) => (
					<option key={rate} value={rate}>
						{rate}x
					</option>
				))}
			</select>
		</div>
	);
});

AudioAttachment.displayName = "AudioAttachment";
