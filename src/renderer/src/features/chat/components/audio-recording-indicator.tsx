import { Box, Typography, alpha } from '@mui/material';
import { styled, keyframes, useTheme } from '@mui/material/styles';
import { useEffect, useRef } from 'react';

/**
 * Props for the AudioRecordingIndicator component
 */
type AudioRecordingIndicatorProps = {
  isRecording: boolean;
};

const BUFFER_SIZE = 120; // Number of bars in the waveform
const MIN_BAR_HEIGHT = 2; // Minimum height of a bar in pixels
const MAX_BAR_HEIGHT = 24; // Maximum height of a bar in pixels
const FRAMES_TO_SKIP = 4; // Throttle visual updates

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
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  minHeight: '50px',
  padding: theme.spacing(1, 2),
  borderRadius: theme.shape.borderRadius * 2,
  backgroundColor: alpha(theme.palette.error.light, 0.08),
  border: `1px solid ${alpha(theme.palette.error.main, 0.2)}`,
  color: theme.palette.error.dark,
  gap: theme.spacing(2),
}));

const RecordingText = styled(Typography)(({ theme }) => ({
  fontSize: '0.9rem',
  fontWeight: 500,
  color: theme.palette.error.dark,
}));

const RecordingDot = styled(Box)(({ theme }) => ({
  width: 8,
  height: 8,
  backgroundColor: theme.palette.error.main,
  borderRadius: '50%',
  animation: `${pulseAnimation} 1.5s infinite ease-in-out`,
  flexShrink: 0,
}));

const WaveformCanvas = styled('canvas')(() => ({
  display: 'block',
  width: '100%',
  height: `${MAX_BAR_HEIGHT}px`,
  flex: 1,
}));

/**
 * AudioRecordingIndicator component
 * Displays a visual indicator with animated waveform when audio is being recorded.
 */
export const AudioRecordingIndicator = ({
  isRecording,
}: AudioRecordingIndicatorProps): JSX.Element | null => {
  const theme = useTheme();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number>();
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const dataArrayRef = useRef<Uint8Array | null>(null);
  const heightsRef = useRef<number[]>(Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT));
  const frameCountRef = useRef(0);

  useEffect(() => {
    if (!isRecording) {
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return;
    }

    // Resize canvas to match its container
    const resizeCanvas = () => {
      const { width, height } = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      canvas.width = width * dpr;
      canvas.height = height * dpr;
      ctx.scale(dpr, dpr);
    };
    resizeCanvas();
    window.addEventListener('resize', resizeCanvas);

    // Initialize buffer
    heightsRef.current = Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT);
    frameCountRef.current = 0;

    // Draw waveform based on heightsRef
    const drawWaveform = () => {
      const { width, height } = canvas.getBoundingClientRect();
      ctx.clearRect(0, 0, width, height);
      const barWidth = width / BUFFER_SIZE;
      const barSpacing = barWidth * 0.2;
      const actualBarWidth = barWidth * 0.8;
      const radius = actualBarWidth / 2;
      
      ctx.fillStyle = theme.palette.error.main;
      
      heightsRef.current.forEach((h, i) => {
        const x = i * barWidth + barSpacing / 2;
        const centerY = height / 2;
        const barHeight = h;
        const y = centerY - barHeight / 2;
        
        // Draw rounded rectangle (pill shape)
        ctx.beginPath();
        ctx.roundRect(x, y, actualBarWidth, barHeight, radius);
        ctx.fill();
      });
    };

    // Update loop: fetch audio data, update heights, and draw
    const updateLoop = () => {
      if (analyserRef.current && dataArrayRef.current) {
        analyserRef.current.getByteFrequencyData(dataArrayRef.current);
        let sum = 0;
        const data = dataArrayRef.current;
        for (let i = 0; i < data.length; i++) {
          sum += data[i];
        }
        const avg = data.length ? sum / data.length : 0;
        const newHeight = Math.max(
          MIN_BAR_HEIGHT,
          (avg / 255) * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) + MIN_BAR_HEIGHT,
        );
        frameCountRef.current += 1;
        if (frameCountRef.current > FRAMES_TO_SKIP) {
          heightsRef.current.shift();
          heightsRef.current.push(newHeight);
          frameCountRef.current = 0;
          drawWaveform();
        }
      }
      animationFrameRef.current = requestAnimationFrame(updateLoop);
    };

    // Setup audio analysis
    (async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaStreamRef.current = stream;
        const AudioContextClass =
          window.AudioContext ||
          (window as unknown as { webkitAudioContext: typeof AudioContext })
            .webkitAudioContext;
        const audioCtx = new AudioContextClass();
        audioContextRef.current = audioCtx;
        const analyser = audioCtx.createAnalyser();
        analyser.fftSize = 64;
        analyser.smoothingTimeConstant = 0.6;
        analyserRef.current = analyser;
        const source = audioCtx.createMediaStreamSource(stream);
        source.connect(analyser);
        dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
        updateLoop();
      } catch (error) {
        console.warn(
          'Could not access microphone for waveform visualization:',
          error,
        );
        // Fallback to random animation
        const randomLoop = () => {
          const randH = Math.max(
            MIN_BAR_HEIGHT,
            Math.random() * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT) + MIN_BAR_HEIGHT,
          );
          frameCountRef.current += 1;
          if (frameCountRef.current > FRAMES_TO_SKIP) {
            heightsRef.current.shift();
            heightsRef.current.push(randH);
            frameCountRef.current = 0;
            drawWaveform();
          }
          animationFrameRef.current = requestAnimationFrame(randomLoop);
        };
        randomLoop();
      }
    })();

    return () => {
      window.removeEventListener('resize', resizeCanvas);
      if (animationFrameRef.current) {
        cancelAnimationFrame(animationFrameRef.current);
      }
      if (mediaStreamRef.current) {
        for (const track of mediaStreamRef.current.getTracks()) {
          track.stop();
        }
        mediaStreamRef.current = null;
      }
      if (
        audioContextRef.current &&
        audioContextRef.current.state !== 'closed'
      ) {
        audioContextRef.current.close().catch(console.error);
        audioContextRef.current = null;
      }
    };
  }, [isRecording, theme.palette.error.main]);

  if (!isRecording) {
    return null;
  }

  return (
    <RecordingIndicatorContainer>
      <RecordingDot />
      <RecordingText variant="body2">Recording</RecordingText>
      <WaveformCanvas ref={canvasRef} />
    </RecordingIndicatorContainer>
  );
};

AudioRecordingIndicator.displayName = 'AudioRecordingIndicator';
