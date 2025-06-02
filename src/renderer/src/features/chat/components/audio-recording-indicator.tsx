import { Box, Typography, alpha } from "@mui/material";
import { styled, keyframes } from "@mui/material/styles";
import { useEffect, useState, useRef } from "react";

/**
 * Props for the AudioRecordingIndicator component
 */
type AudioRecordingIndicatorProps = {
	isRecording: boolean;
};

const BUFFER_SIZE = 100; // Number of bars in the waveform, increased for better width coverage
const MIN_BAR_HEIGHT = 2; // Minimum height of a bar in pixels
const MAX_BAR_HEIGHT = 24; // Maximum height of a bar in pixels
const FRAMES_TO_SKIP = 4; // Update visuals every (FRAMES_TO_SKIP + 1) animation frames. 0 = every frame.

const pulseAnimation = keyframes`
  0% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(255, 82, 82, 0.7);
  }
  70% {
    transform: scale(1);
    box-shadow: 0 0 0 10px rgba(255, 82, 82, 0);
  }
  100% {
    transform: scale(0.95);
    box-shadow: 0 0 0 0 rgba(255, 82, 82, 0);
  }
`;

const RecordingIndicatorContainer = styled(Box)(({ theme }) => ({
	flex: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
	minHeight: "50px",
	padding: theme.spacing(1.5, 2),
	borderRadius: theme.shape.borderRadius * 2,
	backgroundColor: alpha(theme.palette.error.light, 0.08),
	border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
	color: theme.palette.error.dark,
	gap: theme.spacing(2),
}));

const RecordingText = styled(Typography)(({ theme }) => ({
	fontSize: "0.9rem",
	fontWeight: 500,
	color: theme.palette.error.dark,
}));

const RecordingDot = styled(Box)(({ theme }) => ({
	width: 8,
	height: 8,
	backgroundColor: theme.palette.error.main,
	borderRadius: "50%",
	animation: `${pulseAnimation} 1.5s infinite ease-in-out`,
	flexShrink: 0,
}));

const WaveformContainer = styled(Box)(() => ({
	display: "flex",
	alignItems: "center", // Ensures bars are vertically centered
	justifyContent: "space-between", // Distribute bars to fill the width
	height: `${MAX_BAR_HEIGHT}px`, // Use constant for max height
	maxHeight: `${MAX_BAR_HEIGHT}px`,
	flex: 1, // Allow it to take available space
	overflow: "hidden", // Hide bars that might overflow during resizing or if BUFFER_SIZE is too large
}));

const WaveBar = styled(Box)<{ height: number }>(({ theme, height }) => ({
	width: "2px", // Thinner bars
	backgroundColor: theme.palette.error.main,
	borderRadius: "1px", // Smaller radius for thinner bars
	height: `${height}px`,
	minHeight: `${MIN_BAR_HEIGHT}px`, // Use constant for min height
}));

/**
 * AudioRecordingIndicator component
 * Displays a visual indicator with animated waveform when audio is being recorded.
 */
export const AudioRecordingIndicator = ({
	isRecording,
}: AudioRecordingIndicatorProps): JSX.Element | null => {
	const [audioLevels, setAudioLevels] = useState<number[]>(() =>
		Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT),
	);
	const animationFrameRef = useRef<number>();
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const dataArrayRef = useRef<Uint8Array | null>(null);
	const frameCountRef = useRef(0); // For performance throttling

	useEffect(() => {
		if (isRecording) {
			setAudioLevels(Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT)); // Reset to empty buffer on start
			frameCountRef.current = 0; // Reset frame counter

			const setupAudioAnalysis = async () => {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					mediaStreamRef.current = stream;

					const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
					const audioContext = new AudioContextClass();
					audioContextRef.current = audioContext;

					const analyser = audioContext.createAnalyser();
					analyserRef.current = analyser;
					analyser.fftSize = 64; // Provides 32 frequency bins
					analyser.smoothingTimeConstant = 0.6; // Adjust for responsiveness

					const source = audioContext.createMediaStreamSource(stream);
					source.connect(analyser);

					const bufferLength = analyser.frequencyBinCount; // 32
					const dataArray = new Uint8Array(bufferLength);
					dataArrayRef.current = dataArray;

					const updateWaveform = () => {
						if (!isRecording || !analyserRef.current || !dataArrayRef.current) {
							return;
						}

						analyserRef.current.getByteFrequencyData(dataArrayRef.current);

						let sum = 0;
						for (let j = 0; j < dataArrayRef.current.length; j++) {
							sum += dataArrayRef.current[j];
						}
						const average = dataArrayRef.current.length > 0 ? sum / dataArrayRef.current.length : 0;

						const newHeight = Math.max(
							MIN_BAR_HEIGHT,
							(average / 255) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) + MIN_BAR_HEIGHT,
						);

						frameCountRef.current += 1;
						if (frameCountRef.current > FRAMES_TO_SKIP) {
							setAudioLevels(prevLevels => {
								const updatedLevels = [...prevLevels.slice(1), newHeight];
								return updatedLevels;
							});
							frameCountRef.current = 0;
						} else {
							// Still need to update the buffer internally even if not setting state
							// This ensures the visual doesn't "lose" data points, just updates less frequently
							// For this simple shifting buffer, we can update a temporary array and then
							// only call setAudioLevels when throttled.
							// However, the current approach of updating state less frequently is simpler.
							// If intermediate data needs to be preserved for smoother visual on update,
							// a more complex state management or direct DOM manipulation might be needed.
							// For now, this simple throttling is a starting point.
						}

						animationFrameRef.current = requestAnimationFrame(updateWaveform);
					};

					updateWaveform();
				} catch (error) {
					console.warn("Could not access microphone for waveform visualization:", error);
					// Fall back to animated random pattern using the same buffer logic and throttling
					const animateRandomPattern = () => {
						if (!isRecording) return;

						const randomHeight = Math.max(
							MIN_BAR_HEIGHT,
							Math.random() * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) + MIN_BAR_HEIGHT,
						);

						frameCountRef.current += 1;
						if (frameCountRef.current > FRAMES_TO_SKIP) {
							setAudioLevels(prevLevels => {
								const updatedLevels = [...prevLevels.slice(1), randomHeight];
								return updatedLevels;
							});
							frameCountRef.current = 0;
						}
						animationFrameRef.current = requestAnimationFrame(animateRandomPattern);
					};
					animateRandomPattern();
				}
			};

			setupAudioAnalysis();
		} else {
			// Cleanup when recording stops
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = undefined;
			}
			if (mediaStreamRef.current) {
				for (const track of mediaStreamRef.current.getTracks()) {
					track.stop();
				}
				mediaStreamRef.current = null;
			}
			if (audioContextRef.current) {
				audioContextRef.current.close().catch(console.error);
				audioContextRef.current = null;
			}
			// Reset to empty buffer when not recording, so it's ready if recording starts again
			setAudioLevels(Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT));
		}

		return () => {
			// Cleanup on component unmount or if isRecording changes again before else block runs
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
				animationFrameRef.current = undefined;
			}
			if (mediaStreamRef.current) {
				for (const track of mediaStreamRef.current.getTracks()) {
					track.stop();
				}
				mediaStreamRef.current = null;
			}
			if (audioContextRef.current && audioContextRef.current.state !== "closed") {
				audioContextRef.current.close().catch(console.error);
				audioContextRef.current = null;
			}
		};
	}, [isRecording]);

	if (!isRecording) {
		return null;
	}

	return (
		<RecordingIndicatorContainer>
			<RecordingDot />
			<RecordingText variant="body2">Recording</RecordingText>
			<WaveformContainer>
				{audioLevels.map((height, index) => (
          <WaveBar
					  // biome-ignore lint/suspicious/noArrayIndexKey: Index is suitable for this dynamic, shifting buffer where items don't have stable IDs
						key={`wave-bar-${index}`}
						height={height}
					/>
				))}
			</WaveformContainer>
		</RecordingIndicatorContainer>
	);
};

AudioRecordingIndicator.displayName = "AudioRecordingIndicator";
