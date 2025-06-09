import {
	Box,
	CircularProgress,
	IconButton,
	Menu,
	MenuItem,
	Slider,
	Stack,
	Typography,
} from "@mui/material";
import {
	PauseCircle,
	PlayCircle,
	Volume1,
	Volume2,
	VolumeX,
} from "lucide-react";
import { type FC, useEffect, useRef, useState } from "react";

type AudioAttachmentProps = {
	content: string;
	isUser: boolean;
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
		const minutes = Math.floor(time / 60);
		const seconds = Math.floor(time % 60);
		return `${minutes}:${seconds.toString().padStart(2, "0")}`;
	};

	const VolumeIcon = volume === 0 ? VolumeX : volume < 0.5 ? Volume1 : Volume2;

	return (
		<Box sx={{ width: "100%", p: 2 }}>
			<Stack
				direction="row"
				spacing={2}
				alignItems="center"
				sx={{ width: "100%" }}
			>
				<IconButton onClick={handlePlayPause} disabled={isLoading}>
					{isLoading ? (
						<CircularProgress size={24} />
					) : isPlaying ? (
						<PauseCircle size={24} />
					) : (
						<PlayCircle size={24} />
					)}
				</IconButton>
				<Slider
					aria-label="time-indicator"
					size="small"
					value={currentTime}
					min={0}
					step={1}
					max={duration}
					onChange={handleSeek}
					sx={{
						height: 4,
						"& .MuiSlider-thumb": {
							width: 8,
							height: 8,
							transition: "0.3s cubic-bezier(.47,1.64,.41,.8)",
							"&:before": {
								boxShadow: "0 2px 12px 0 rgba(0,0,0,0.4)",
							},
							"&:hover, &.Mui-focusVisible": {
								boxShadow: "0px 0px 0px 8px rgb(0 0 0 / 16%)",
							},
							"&.Mui-active": {
								width: 20,
								height: 20,
							},
						},
						"& .MuiSlider-rail": {
							opacity: 0.28,
						},
					}}
				/>
				<Typography>{formatTime(currentTime)}</Typography>
				<Typography>/</Typography>
				<Typography>{formatTime(duration)}</Typography>
				<IconButton
					onClick={() =>
						handleVolumeChange(new Event("click"), volume > 0 ? 0 : 1)
					}
				>
					<VolumeIcon />
				</IconButton>
				<Slider
					aria-label="volume-control"
					size="small"
					value={volume}
					min={0}
					step={0.1}
					max={1}
					onChange={handleVolumeChange}
					sx={{ width: 100 }}
				/>
				<IconButton onClick={(event) => setAnchorEl(event.currentTarget)}>
					<Typography sx={{ fontWeight: "bold" }}>{playbackRate}x</Typography>
				</IconButton>
				<Menu
					anchorEl={anchorEl}
					open={Boolean(anchorEl)}
					onClose={() => setAnchorEl(null)}
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
			</Stack>
		</Box>
	);
};
