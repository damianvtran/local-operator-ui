import { useEffect, useRef } from "react";

import {
	type AudioLevelState,
	INITIAL_AUDIO_LEVEL_STATE,
	advanceAudioLevel,
} from "./audio-recording-levels";

/**
 * Props for the AudioRecordingIndicator component
 */
type AudioRecordingIndicatorProps = {
	isRecording: boolean;
};

const BUFFER_SIZE = 120; // Number of bars in the waveform
const MIN_BAR_HEIGHT = 2; // Minimum height of a bar in pixels
const MAX_BAR_HEIGHT = 34; // Maximum height of a bar in pixels
const FRAMES_TO_SKIP = 4; // Throttle the visual updates to ~15/s
const QUIET_BAR_MARGIN = 0.5; // Heights within this of MIN read as no signal

/*
 * THE WAVEFORM'S LANE, spanning the composer's content width (see the render).
 * Full width on purpose, and it is the operator's feedback this direction
 * answers (via Aida, 2026-09-29 - the report read the old bounded strip, `w-28`,
 * as a partial line that ends mid-row): the lane IS the recording state's own
 * surface now, and the composer grows to hold it for as long as the take lasts.
 * `h-9` is `MAX_BAR_HEIGHT` plus the 1px breathing room a full-scale bar keeps
 * from each edge, so the loudest frame cannot be clipped by the canvas it is
 * drawn into.
 */
const WAVEFORM_CLASS = "block h-9 w-full text-accent";

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
	/*
	 * `getFloatTimeDomainData` takes a view over a plain `ArrayBuffer`
	 * (`Float32Array<ArrayBuffer>`), not a `Float32Array` over
	 * `ArrayBufferLike`: a SharedArrayBuffer-backed view is not a writable
	 * destination the analyser will fill. This buffer is only ever created by
	 * the `new Float32Array(fftSize)` call below, so stating that in the ref's
	 * type is the whole requirement -- nothing here can produce a
	 * shared-buffer view.
	 *
	 * A float view, where the treatment this replaced took bytes: the level is
	 * the window's RMS, and 8-bit samples quantize quiet speech into the same
	 * few levels the old display failed to show.
	 */
	const dataArrayRef = useRef<Float32Array<ArrayBuffer> | null>(null);
	const heightsRef = useRef<number[]>(Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT));
	const levelStateRef = useRef<AudioLevelState>(INITIAL_AUDIO_LEVEL_STATE);
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

		// Initialize buffer and level memory
		heightsRef.current = Array(BUFFER_SIZE).fill(MIN_BAR_HEIGHT);
		levelStateRef.current = INITIAL_AUDIO_LEVEL_STATE;
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

				// The muted tint marks bars with no signal: the level pipeline's
				// zero (and the release's vanishing tail) rather than a height a
				// quiet-but-live bar could reach.
				const isMinimalData = h <= MIN_BAR_HEIGHT + QUIET_BAR_MARGIN;
				ctx.fillStyle = isMinimalData
					? `color-mix(in srgb, ${accent} 30%, transparent)`
					: accent;

				// Draw rounded rectangle (pill shape)
				ctx.beginPath();
				ctx.roundRect(x, y, actualBarWidth, barHeight, radius);
				ctx.fill();
			});
		};

		/*
		 * Update loop: read the analyser's time-domain window, run it through the
		 * level pipeline, and draw. The window's RMS is the loudness the bars
		 * show - not the frequency average the old display used, whose value for
		 * speech stayed near the floor whatever was said.
		 */
		const updateLoop = () => {
			if (analyserRef.current && dataArrayRef.current) {
				analyserRef.current.getFloatTimeDomainData(dataArrayRef.current);
				let sum = 0;
				const data = dataArrayRef.current;
				for (let i = 0; i < data.length; i++) {
					sum += data[i] * data[i];
				}
				const rms = data.length ? Math.sqrt(sum / data.length) : 0;
				frameCountRef.current += 1;
				// The pipeline advances one bar per PUSH, not per frame: its decay
				// and release are per-tick rates, and a per-frame advance would
				// make them drift with the display's refresh rate.
				if (frameCountRef.current > FRAMES_TO_SKIP) {
					const step = advanceAudioLevel(levelStateRef.current, rms);
					levelStateRef.current = step.state;
					const newHeight =
						MIN_BAR_HEIGHT + step.level * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
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
				/*
				 * The time-domain window, `fftSize` samples (~23 ms at 44.1 kHz): long
				 * enough that a frame's RMS reads as speech loudness rather than as
				 * one cycle of the waveform's phase. `smoothingTimeConstant` is not
				 * set: it shapes the FREQUENCY data's smoothing, and this pipeline
				 * reads raw samples - the smoothing lives in the level reducer's
				 * release now, where it is testable.
				 */
				analyser.fftSize = 1024;
				analyserRef.current = analyser;
				const source = audioCtx.createMediaStreamSource(stream);
				source.connect(analyser);
				dataArrayRef.current = new Float32Array(analyser.fftSize);
				updateLoop();
			} catch (error) {
				console.warn(
					"Could not access microphone for waveform visualization:",
					error,
				);
				// Fallback to a random animation. Deliberately NOT through the level
				// pipeline: it is fed a made-up band rather than an amplitude, and
				// normalizing a random walk would just pin it to the lane's top.
				const randomLoop = () => {
					const randLevel = 0.15 + Math.random() * 0.75;
					const randH =
						MIN_BAR_HEIGHT + randLevel * (MAX_BAR_HEIGHT - MIN_BAR_HEIGHT);
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
		/*
		 * RECORDING IS A STATE OF THE COMPOSER, NOT A SCREEN THE COMPOSER
		 * BECOMES. The old treatment replaced the field with a bordered,
		 * full-width `bg-accent-wash` panel (this component took `flex-1` inside
		 * the box), so the draft the user was mid-thought in VANISHED at the
		 * press - the operator's report, and the thing the composer's field now
		 * stays mounted to prevent.
		 *
		 * Since the redesign (operator feedback via Aida, 2026-09-29) the state
		 * reads as a LANE ACROSS THE COMPOSER rather than a strip anchored to its
		 * leading edge: the waveform takes the content width the draft above it
		 * is read against, the label row sits over it, and the whole block stays
		 * borderless composer chrome - no wash, no border, the same step of
		 * ground the box itself uses. The draft still stays where it was; the
		 * lane grows the box for as long as the take lasts.
		 *
		 * The label row carries the affordance the field's placeholder can only
		 * speak while the field is EMPTY: with a draft in it - the common case -
		 * nothing else on screen would say which keys end the take. The controls
		 * keep their own row below (`Confirm recording`/`Cancel recording`),
		 * where the interrupt-slot geometry already reserves their boxes; this
		 * block is a status and carries no control.
		 *
		 * The dot keeps its pulsing ring (its own comment above records what each
		 * half is for under `prefers-reduced-motion`), and the word is still the
		 * affordance's name: a state a screen reader user gets through the
		 * field's `aria-describedby` is a state that must read the same here.
		 */
		<div
			data-recording-indicator=""
			className="mt-2 flex w-full min-w-0 flex-col gap-2 text-accent"
		>
			<style>{PULSE_KEYFRAMES}</style>
			<div className="flex min-w-0 items-center gap-2">
				<span className="relative block size-2 shrink-0" aria-hidden="true">
					<span className="absolute inset-0 rounded-full border border-accent opacity-0 animate-[recording-ping_1.6s_ease-out_infinite]" />
					<span className="block size-2 rounded-full bg-accent" />
				</span>
				<span className="shrink-0 font-medium text-body-sm text-accent">
					Recording
				</span>
				<span className="ml-auto min-w-0 truncate text-body-sm text-ink-dim">
					Enter confirms · Esc cancels
				</span>
			</div>
			<canvas ref={canvasRef} className={WAVEFORM_CLASS} />
		</div>
	);
};

AudioRecordingIndicator.displayName = "AudioRecordingIndicator";
