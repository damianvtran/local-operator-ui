import { Box, Typography, alpha } from "@mui/material";
import { styled, keyframes } from "@mui/material/styles";
import { useEffect, useState, useRef } from "react";

/**
 * Props for the AudioRecordingIndicator component
 */
type AudioRecordingIndicatorProps = {
	isRecording: boolean;
};

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

const waveAnimation = keyframes`
  0%, 100% {
    transform: scaleY(0.3);
  }
  50% {
    transform: scaleY(1);
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
	alignItems: "center",
	justifyContent: "center",
	gap: "2px",
	height: "24px",
	flex: 1,
	maxWidth: "200px",
}));

const WaveBar = styled(Box)<{ delay: number; height: number }>(({ theme, delay, height }) => ({
	width: "3px",
	backgroundColor: theme.palette.error.main,
	borderRadius: "2px",
	transformOrigin: "center",
	animation: `${waveAnimation} ${0.8 + Math.random() * 0.4}s infinite ease-in-out`,
	animationDelay: `${delay}s`,
	height: `${height}px`,
	minHeight: "4px",
	opacity: 0.7 + Math.random() * 0.3,
}));

/**
 * AudioRecordingIndicator component
 * Displays a visual indicator with animated waveform when audio is being recorded.
 */
export const AudioRecordingIndicator = ({
	isRecording,
}: AudioRecordingIndicatorProps): JSX.Element | null => {
	const [audioLevels, setAudioLevels] = useState<number[]>([]);
	const animationFrameRef = useRef<number>();
	const mediaStreamRef = useRef<MediaStream | null>(null);
	const audioContextRef = useRef<AudioContext | null>(null);
	const analyserRef = useRef<AnalyserNode | null>(null);
	const dataArrayRef = useRef<Uint8Array | null>(null);

	// Generate initial random wave pattern
	useEffect(() => {
		if (isRecording) {
			// Initialize with random pattern
			const initialLevels = Array.from({ length: 20 }, () => Math.random() * 20 + 4);
			setAudioLevels(initialLevels);

			// Try to get real audio data
			const setupAudioAnalysis = async () => {
				try {
					const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
					mediaStreamRef.current = stream;

					// Simplified AudioContext creation
					const AudioContextClass = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
					const audioContext = new AudioContextClass();
					audioContextRef.current = audioContext;

					const analyser = audioContext.createAnalyser();
					analyserRef.current = analyser;
					analyser.fftSize = 64;
					analyser.smoothingTimeConstant = 0.8;

					const source = audioContext.createMediaStreamSource(stream);
					source.connect(analyser);

					const bufferLength = analyser.frequencyBinCount;
					const dataArray = new Uint8Array(bufferLength);
					dataArrayRef.current = dataArray;

					const updateWaveform = () => {
						if (!isRecording || !analyserRef.current || !dataArrayRef.current) return;

						analyserRef.current.getByteFrequencyData(dataArrayRef.current);
						
						// Convert frequency data to visual levels
						const levels: number[] = [];
						const step = Math.floor(dataArrayRef.current.length / 20);
						
						for (let i = 0; i < 20; i++) {
							const index = i * step;
							const value = dataArrayRef.current[index] || 0;
							// Scale the value to a reasonable height (4-24px)
							const height = Math.max(4, (value / 255) * 20 + 4);
							levels.push(height);
						}

						setAudioLevels(levels);
						animationFrameRef.current = requestAnimationFrame(updateWaveform);
					};

					updateWaveform();
				} catch (error) {
					console.warn("Could not access microphone for waveform visualization:", error);
					// Fall back to animated random pattern
					const animateRandomPattern = () => {
						if (!isRecording) return;
						
						const levels = Array.from({ length: 20 }, () => {
							return Math.max(4, Math.random() * 20 + 4);
						});
						setAudioLevels(levels);
						
						setTimeout(animateRandomPattern, 100);
					};
					animateRandomPattern();
				}
			};

			setupAudioAnalysis();
		} else {
			// Cleanup
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (mediaStreamRef.current) {
				for (const track of mediaStreamRef.current.getTracks()) {
					track.stop();
				}
				mediaStreamRef.current = null;
			}
			if (audioContextRef.current) {
				audioContextRef.current.close();
				audioContextRef.current = null;
			}
			setAudioLevels([]);
		}

		return () => {
			if (animationFrameRef.current) {
				cancelAnimationFrame(animationFrameRef.current);
			}
			if (mediaStreamRef.current) {
				for (const track of mediaStreamRef.current.getTracks()) {
					track.stop();
				}
			}
			if (audioContextRef.current) {
				audioContextRef.current.close();
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
						key={`wave-bar-${index}-${height}`}
						delay={index * 0.05}
						height={height}
					/>
				))}
			</WaveformContainer>
		</RecordingIndicatorContainer>
	);
};

AudioRecordingIndicator.displayName = "AudioRecordingIndicator";
