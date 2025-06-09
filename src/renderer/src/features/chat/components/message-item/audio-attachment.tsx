import {
	Box,
	CircularProgress,
	IconButton,
	Menu,
	MenuItem,
	Slider,
	Typography,
	styled,
	alpha,
} from "@mui/material";
import {
	PauseCircle,
	PlayCircle,
	Volume1,
	Volume2,
	VolumeX,
} from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";

const AudioPlayerContainer = styled(Box)(({ theme }) => ({
	display: "flex",
	alignItems: "center",
	gap: theme.spacing(1.5),
	background: theme.palette.background.paper,
	borderRadius: theme.shape.borderRadius,
	padding: theme.spacing(1, 2),
	width: "100%",
	maxWidth: "600px",
	border: `1px solid ${theme.palette.sidebar.border}`,
}));

const TimeDisplay = styled(Typography)(({ theme }) => ({
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
	minWidth: "40px",
	textAlign: "center",
}));

const CustomSlider = styled(Slider)(({ theme }) => ({
	color: theme.palette.primary.main,
	height: 4,
	"& .MuiSlider-thumb": {
		width: 12,
		height: 12,
		backgroundColor: theme.palette.primary.main,
		border: `2px solid ${theme.palette.background.paper}`,
		"&:hover, &.Mui-focusVisible": {
			boxShadow: `0 0 0 8px ${alpha(theme.palette.primary.main, 0.16)}`,
		},
		"&.Mui-active": {
			width: 16,
			height: 16,
		},
	},
	"& .MuiSlider-rail": {
		opacity: 0.3,
		backgroundColor: theme.palette.text.secondary,
	},
	"& .MuiSlider-track": {
		border: "none",
	},
}));

const VolumeControlContainer = styled(Box)({
	display: "flex",
	alignItems: "center",
	gap: "8px",
});

const PlaybackRateButton = styled(Typography)(({ theme }) => ({
	fontWeight: "bold",
	fontSize: "0.75rem",
	color: theme.palette.text.secondary,
	cursor: "pointer",
	padding: theme.spacing(0.5, 1),
	borderRadius: theme.shape.borderRadius,
	"&:hover": {
		backgroundColor: theme.palette.action.hover,
	},
}));

type AudioAttachmentProps = {
	content: string;
};

export const AudioAttachment: FC<AudioAttachmentProps> = ({ content }) => {
	const audioRef = useRef<HTMLAudioElement | null>(null);
	const [isPlaying, setIsPlaying] = useState(false);
	const [duration, setDuration] = useState(0);
	const [currentTime, setCurrentTime] = useState(0);
	const [volume, setVolume] = useState(1);
	const [playbackRate, setPlaybackRate] = useState(1);
	const [isLoading, setIsLoading] = useState(true);
	const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);

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

		audioElement.addEventListener("loadedmetadata", handleLoadedMetadata);
		audioElement.addEventListener("timeupdate", handleTimeUpdate);
		audioElement.addEventListener("ended", handleEnded);

		return () => {
			audioElement.removeEventListener("loadedmetadata", handleLoadedMetadata);
			audioElement.removeEventListener("timeupdate", handleTimeUpdate);
			audioElement.removeEventListener("ended", handleEnded);
		};
	}, [content]);

	const handlePlayPause = () => {
		if (audioRef.current) {
			if (isPlaying) {
				audioRef.current.pause();
			} else {
				audioRef.current.play().catch(console.error);
			}
			setIsPlaying(!isPlaying);
		}
	};

	const handleSeek = (_: Event, newValue: number | number[]) => {
		if (audioRef.current) {
			audioRef.current.currentTime = newValue as number;
			setCurrentTime(newValue as number);
		}
	};

	const handleVolumeChange = (_: Event, newValue: number | number[]) => {
		if (audioRef.current) {
			const newVolume = newValue as number;
			audioRef.current.volume = newVolume;
			setVolume(newVolume);
		}
	};

	const handlePlaybackRateChange = (rate: number) => {
		if (audioRef.current) {
			audioRef.current.playbackRate = rate;
			setPlaybackRate(rate);
		}
		setAnchorEl(null);
	};

	const formatTime = (time: number) => {
		if (Number.isNaN(time) || time === 0) return "0:00";
		const minutes = Math.floor(time / 60);
		const seconds = Math.floor(time % 60);
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	};

	const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

	return (
		<AudioPlayerContainer>
			<IconButton onClick={handlePlayPause} disabled={isLoading} size="small">
				{isLoading ? (
					<CircularProgress size={20} />
				) : isPlaying ? (
					<PauseCircle size={20} />
				) : (
					<PlayCircle size={20} />
				)}
			</IconButton>
			<TimeDisplay>{formatTime(currentTime)}</TimeDisplay>
			<CustomSlider
				aria-label="time-indicator"
				size="small"
				value={currentTime}
				min={0}
				step={1}
				max={duration}
				onChange={handleSeek}
				disabled={isLoading}
			/>
			<TimeDisplay>{formatTime(duration)}</TimeDisplay>
			<VolumeControlContainer>
				<IconButton
					onClick={() =>
						handleVolumeChange(new Event("click"), volume > 0 ? 0 : 1)
					}
					size="small"
				>
					<VolumeIcon size={16} />
				</IconButton>
				<CustomSlider
					aria-label="volume-control"
					size="small"
					value={volume}
					min={0}
					step={0.1}
					max={1}
					onChange={handleVolumeChange}
					sx={{ width: 70 }}
				/>
			</VolumeControlContainer>
			<IconButton
				onClick={(event) => setAnchorEl(event.currentTarget)}
				size="small"
			>
				<PlaybackRateButton>{playbackRate}x</PlaybackRateButton>
			</IconButton>
			<Menu
				anchorEl={anchorEl}
				open={Boolean(anchorEl)}
				onClose={() => setAnchorEl(null)}
				MenuListProps={{
					sx: {
						// @ts-ignore
						backgroundColor: (theme) => theme.palette.background.paper,
					},
				}}
			>
				{[0.5, 1, 1.5, 2].map((rate) => (
					<MenuItem
						key={rate}
						onClick={() => handlePlaybackRateChange(rate)}
						selected={playbackRate === rate}
					>
						{rate}x
					</MenuItem>
				))}
			</Menu>
		</AudioPlayerContainer>
	);
};
