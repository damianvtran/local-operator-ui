import { useEffect, useRef } from "react";

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

/*
 * The recording pulse, kept in-component: `styles/**` is shared infrastructure
 * and this animation is composer chrome.
 *
 * It is an expanding ring, not a `box-shadow`. The system has exactly one
 * shadow and it belongs to objects that leave the flow — menu, dialog, drawer,
 * popover, tooltip, select (docs/branding.md § 2). A status dot sitting in the
 * composer is not one of those, and a shadow keyframe here is also the one
 * shape of ring that an ancestor's `overflow: hidden` can clip away.
 *
 * Two things about the split into a static dot and an animated ring are
 * load-bearing:
 *
 * - The dot is the state; the ring is only emphasis. Under
 *   `prefers-reduced-motion` the global rule in `styles/index.css` caps every
 *   animation at 0.01ms with a single iteration, so this one finishes at once
 *   and — `animation-fill-mode` being `none` — the animated element reverts to
 *   its unanimated style. The ring's unanimated style is `opacity: 0`, so it
 *   is simply absent rather than frozen half-drawn. Pulsing the dot's own
 *   opacity instead would have put the state itself on the animated element,
 *   and whatever resting opacity that dot declared is then what a
 *   reduced-motion user is left looking at. Here they get a solid accent dot
 *   beside the word "Recording", which is the whole message.
 * - The ring takes `border-accent`, so no theme has its colour guessed.
 *
 * The 1.6s period is deliberately outside the 80/120/180/240ms ramp. That ramp
 * governs entrances and state changes, where the duration is time the user is
 * made to wait; a continuous "still recording" signal is a heartbeat, and at
 * 240ms it would strobe. `Spinner`'s rotation is the same exception.
 */
const PULSE_KEYFRAMES = `
@keyframes recording-ping {
  from {
    transform: scale(1);
    opacity: 0.6;
  }
  to {
    transform: scale(2.4);
    opacity: 0;
  }
}`;

/**
 * AudioRecordingIndicator component
 * Displays a visual indicator with animated waveform when audio is being recorded.
 */
export const AudioRecordingIndicator = ({
	isRecording,
}: AudioRecordingIndicatorProps): JSX.Element | null => {
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
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}

		// A canvas 2D context cannot resolve `var()`, so the accent has to be read
		// back as a computed value. Reading `color` rather than the custom property
		// is what removes the need for a literal fallback: the element carries
		// `text-accent`, and `color` always computes to a real colour, whereas a
		// custom property read returns "" before the theme is applied.
		const accent = getComputedStyle(canvas).color;

		// Resize canvas to match its container
		const resizeCanvas = () => {
			const { width, height } = canvas.getBoundingClientRect();
			const dpr = window.devicePixelRatio || 1;
			canvas.width = width * dpr;
			canvas.height = height * dpr;
			ctx.scale(dpr, dpr);
		};
		resizeCanvas();
		window.addEventListener("resize", resizeCanvas);

		// Initialize buffer
		heightsRef.current = Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT);
		frameCountRef.current = 0;

		// Draw waveform based on heightsRef
		const drawWaveform = () => {
			const { width, height } = canvas.getBoundingClientRect();
			ctx.clearRect(0, 0, width, height);
			const barWidth = width / BUFFER_SIZE;
			const spacingRatio = 0.4;
			const barSpacing = barWidth * spacingRatio;
			const actualBarWidth = barWidth * (1 - spacingRatio);
			const radius = actualBarWidth / 2;

			heightsRef.current.forEach((h, i) => {
				const x = i * barWidth + barSpacing / 2;
				const centerY = height / 2;
				const barHeight = h;
				const y = centerY - barHeight / 2;

				// Use different color for bars with zero/minimal data
				const isMinimalData = h <= MIN_BAR_HEIGHT;
				ctx.fillStyle = isMinimalData
					? `color-mix(in srgb, ${accent} 30%, transparent)`
					: accent;

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
				const stream = await navigator.mediaDevices.getUserMedia({
					audio: true,
				});
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
					"Could not access microphone for waveform visualization:",
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
			window.removeEventListener("resize", resizeCanvas);
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
				audioContextRef.current.state !== "closed"
			) {
				audioContextRef.current.close().catch(console.error);
				audioContextRef.current = null;
			}
		};
	}, [isRecording]);

	if (!isRecording) {
		return null;
	}

	return (
		<div className="flex flex-1 items-center justify-center gap-4 rounded-md border border-accent/20 bg-accent-wash px-4 py-2 text-accent [min-height:50px]">
			<style>{PULSE_KEYFRAMES}</style>
			<span className="relative block size-2 shrink-0" aria-hidden="true">
				<span className="absolute inset-0 rounded-full border border-accent opacity-0 animate-[recording-ping_1.6s_ease-out_infinite]" />
				<span className="block size-2 rounded-full bg-accent" />
			</span>
			<span className="font-medium text-body-sm text-accent">Recording</span>
			<canvas ref={canvasRef} className="block h-6 flex-1 text-accent" />
		</div>
	);
};

AudioRecordingIndicator.displayName = "AudioRecordingIndicator";
