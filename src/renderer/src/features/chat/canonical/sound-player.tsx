/**
 * The one sound player: a play control, a waveform, and a time label.
 *
 * WHY IT IS SHARED. Generated sound appears in four places — the transcript's
 * generation card, the Canvas Files "Sounds" band, the highlights row under a
 * final answer, and a legacy message's attachment — and the brief's rule is one
 * player with one behaviour, not four rows that drift. Everything that differs
 * between those seats is a prop (`variant`, `peaks`, `label`); everything the
 * seats must AGREE about — the transport states, the seek gestures, the
 * accessibility contract — lives here.
 *
 * TWO CANVASES, ONE rAF, NO PER-FRAME REACT. The base wave is painted once per
 * (peaks, width, dpr): bars at their own alphas, the design recipe's geometry
 * (`waveform-model.ts` owns the numbers). The played ink is a SECOND canvas
 * holding the same bars at the primary ink, revealed by `clip-path` — so a
 * playback frame is one style write and one text write, done from a rAF
 * against refs. A React state update per frame would re-render the row (and
 * through it a transcript window) sixty times a second to move a playhead,
 * which is exactly what the existing recorder rows avoided and this component
 * must not reintroduce. The frame handler also keeps `aria-valuenow` honest,
 * because a screen reader must hear the same instant the eye sees.
 *
 * THE STRANGE MIDDLE: `clip-path: inset(0 X% 0 0)` clips the ink canvas from
 * the RIGHT by X percent, which is the remaining fraction — the ink survives
 * exactly where playback has passed.
 *
 * SCRUBBING IS POINTER CAPTURE + rAF-THROTTLED `fastSeek`. The drag holds the
 * pointer (so a move that leaves the canvas keeps seeking), records the latest
 * x in a ref, and lets the rAF decide how many seeks to emit — Chromium's
 * `fastSeek` is cheap but not free, and a 120 Hz trackpad would otherwise issue
 * a seek per event. Release commits one exact `seek`. The visual playhead
 * follows the POINTER while dragging (a scrub must not lag behind the finger
 * waiting for the element to decode), which is why the rAF prefers the
 * recorded scrub position over the element's own clock.
 *
 * A CLICK SEEKS AND PLAYS (the brief; the ElevenLabs row's gesture). A press
 * that moved more than {@link CLICK_SLOP_PX} is a drag and only seeks — a
 * scrub must never start playback. A press that did not move is a click: seek
 * to the point, then play from it (already-playing widgets keep playing; the
 * seek is enough).
 *
 * THE TOUCH TARGET IS 44 px IN BOTH VARIANTS, per the brief. The compact
 * variant is about fewer labels, never about a smaller target: its control box
 * and its slider both carry `min-h-11`, and the extra height is spent as
 * breathing room rather than as a bigger icon.
 *
 * STATES. `idle` (nothing playing anywhere), `loading` (this sound is
 * starting), `playing`, `scrubbing`, `ended` and `error` are all reachable and
 * all render. The engine's status is read through this widget's identity, so a
 * you-are-not-active row shows its rest state and never a stale spinner — and
 * `error` (a decoded-URL failure the resolver could not know about) says so in
 * one quiet line instead of a dead control.
 */

import { Spinner } from "@shared/components/common/spinner";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import {
	audioEngineElement,
	useAudioEngineStore,
} from "@shared/store/audio-engine-store";
import { CirclePause, CirclePlay } from "lucide-react";
import {
	type KeyboardEvent,
	type PointerEvent,
	useCallback,
	useEffect,
	useRef,
	useState,
} from "react";
import {
	BAR_RADIUS,
	ariaValueText,
	formatClock,
	progressFraction,
	seekSecondsAt,
	waveformBars,
} from "./waveform-model";

export type SoundPlayerVariant = "full" | "compact";

export type SoundPlayerProps = {
	/**
	 * The sound's stable identity — `sound:<digest>` wherever a digest exists
	 * (the digest IS the identity, so two rows of one sound share one playback
	 * slot). Used by the engine to answer "is this widget the one playing?".
	 */
	ownerId: string;
	/** The resolved bytes' URL. The caller owns the URL's lifetime. */
	src: string;
	/** The sound's accessible name ("Generated voiceover", a file name). */
	label: string;
	/** Stored bars, or `null` for the honest flat scrubber. */
	peaks: readonly number[] | null;
	/** The record's stated duration, shown until metadata can speak instead. */
	durationHint?: number | null;
	variant?: SoundPlayerVariant;
	className?: string;
};

/** Pointer travel below this is a click, not a drag. */
const CLICK_SLOP_PX = 4;

/** Arrow-key seek step: these sounds are 0.5–30 s, where 1 s is perceptible. */
const NUDGE_SECONDS = 1;

const ICON_BUTTON_CLASS =
	"flex min-h-11 min-w-11 shrink-0 items-center justify-center text-ink-muted transition-colors duration-fast ease-out-quart hover:text-ink disabled:pointer-events-none disabled:text-ink-disabled";

export const SoundPlayer = ({
	ownerId,
	src,
	label,
	peaks,
	durationHint = null,
	variant = "full",
	className,
}: SoundPlayerProps) => {
	useI18nLocale();
	/*
	 * The engine's status, read through this widget's identity: another row's
	 * press (or the speech store's) must not paint this row's spinner.
	 */
	const isActive = useAudioEngineStore((state) => state.ownerId === ownerId);
	const engineStatus = useAudioEngineStore((state) =>
		state.ownerId === ownerId ? state.status : "idle",
	);
	const engineDuration = useAudioEngineStore((state) =>
		state.ownerId === ownerId ? state.duration : 0,
	);
	const [scrubbing, setScrubbing] = useState(false);
	const [failedOnce, setFailedOnce] = useState(false);

	/*
	 * The scrub can be retried: a byte range a flaky read dropped should not
	 * leave a row permanently saying "could not play" when a second press works.
	 * The flag therefore clears on every fresh activation (below), and the error
	 * state is `failedOnce` rather than a latch scraped from the store.
	 */
	useEffect(() => {
		if (engineStatus === "loading" || engineStatus === "playing")
			setFailedOnce(false);
	}, [engineStatus]);

	const duration = engineDuration > 0 ? engineDuration : (durationHint ?? 0);

	const playing = isActive && engineStatus === "playing";
	const loading = isActive && engineStatus === "loading";
	/*
	 * The error state is the engine's OR this widget's own failed start: a
	 * rejected `play()` (a source that will not decode) settles the engine's
	 * status, which the engine also reports through the activation's `onError`
	 * handler - the flag is what survives that activation being replaced, so the
	 * row keeps saying the thing that happened to ITS sound.
	 */
	const errored = failedOnce || (isActive && engineStatus === "error");

	/** The waveform box, measured once per resize for the dpr-aware canvas. */
	const boxRef = useRef<HTMLDivElement | null>(null);
	const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const inkCanvasRef = useRef<HTMLCanvasElement | null>(null);
	const sliderRef = useRef<HTMLDivElement | null>(null);
	const timeRef = useRef<HTMLSpanElement | null>(null);
	const [box, setBox] = useState({ width: 0, height: 0, dpr: 1 });

	useEffect(() => {
		const node = boxRef.current;
		if (!node) return;
		const measure = () => {
			const rect = node.getBoundingClientRect();
			setBox({
				width: rect.width,
				height: rect.height,
				dpr: window.devicePixelRatio || 1,
			});
		};
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);

	/**
	 * Paint one canvas with the bars. The ink colour is read from the element's
	 * own computed `color`, so the palette's role (not a hex) decides the ink —
	 * the canvas is a consumer of the theme like everything else.
	 */
	const paintBars = useCallback(
		(canvas: HTMLCanvasElement | null) => {
			if (!canvas || box.width <= 0) return;
			const ctx = canvas.getContext("2d");
			if (!ctx) return;
			canvas.width = Math.max(1, Math.round(box.width * box.dpr));
			canvas.height = Math.max(1, Math.round(box.height * box.dpr));
			ctx.setTransform(box.dpr, 0, 0, box.dpr, 0, 0);
			ctx.clearRect(0, 0, box.width, box.height);
			const ink = getComputedStyle(canvas).color;
			const bars = waveformBars(peaks, box.width, box.height);
			ctx.fillStyle = ink;
			for (const bar of bars) {
				ctx.globalAlpha = bar.alpha;
				ctx.beginPath();
				ctx.roundRect(
					bar.x,
					(box.height - bar.height) / 2,
					bar.width,
					bar.height,
					BAR_RADIUS,
				);
				ctx.fill();
			}
			ctx.globalAlpha = 1;
		},
		[box.width, box.height, box.dpr, peaks],
	);

	/*
	 * The base wave, once per (peaks, width, dpr) — the brief's memo rule. Both
	 * canvases carry the SAME bars and the same alphas: what separates them is
	 * the role colour they inherit (`text-ink-dim` under, `text-ink-muted`
	 * above) and the clip, so the played ink is one hue step rather than a
	 * different shape. Progress drawn as an alpha ramp would make "how far in"
	 * and "how loud" read as one gradient.
	 */
	useEffect(() => {
		paintBars(baseCanvasRef.current);
		paintBars(inkCanvasRef.current);
	}, [paintBars]);

	/** The scrubbed position in seconds, or null when not dragging. */
	const scrubSeconds = useRef<number | null>(null);

	/**
	 * One frame's worth of visual truth: the clip, the label, the aria value.
	 * Kept as a ref-stable function so the rAF effect below lists no deps it
	 * does not use.
	 */
	const paintProgress = useCallback(
		(seconds: number) => {
			const fraction = progressFraction(seconds, duration);
			const ink = inkCanvasRef.current;
			boxRef.current?.style.setProperty(
				"--sound-progress",
				`${fraction * 100}%`,
			);
			if (ink) ink.style.clipPath = `inset(0 ${(1 - fraction) * 100}% 0 0)`;
			const time = formatClock(seconds);
			if (timeRef.current && timeRef.current.textContent !== time)
				timeRef.current.textContent = time;
			const slider = sliderRef.current;
			if (slider) {
				slider.setAttribute("aria-valuenow", String(Math.floor(seconds)));
				slider.setAttribute("aria-valuetext", ariaValueText(seconds, duration));
			}
		},
		[duration],
	);

	/*
	 * The frames run only while THIS widget is the active one (playing or
	 * scrubbing) — the brief's "only the active widget runs a rAF". At rest the
	 * same painter runs once, so a paused or newly mounted row still paints its
	 * clip from the element's real position.
	 */
	useEffect(() => {
		const active = playing || scrubbing;
		/*
		 * At rest this paints the RESTING position: the element's own clock when
		 * this widget is the active one (a paused row keeps its playhead), and
		 * zero otherwise — the shared element's clock belongs to whoever is
		 * playing, and a resting row must not borrow it.
		 */
		const paintAtRest = () =>
			paintProgress(
				isActive
					? (audioEngineElement()?.currentTime ?? 0)
					: pendingSeconds.current,
			);
		if (!active) {
			paintAtRest();
			return;
		}
		let raf = 0;
		const tick = () => {
			const seconds =
				scrubSeconds.current ?? audioEngineElement()?.currentTime ?? 0;
			paintProgress(seconds);
			raf = requestAnimationFrame(tick);
		};
		raf = requestAnimationFrame(tick);
		return () => cancelAnimationFrame(raf);
	}, [playing, scrubbing, isActive, paintProgress]);

	/**
	 * Start (or restart) this sound on the shared engine. False when a newer press
	 * overtook this one, so a click that lost the race does not seek under it.
	 */
	const start = useCallback(async (): Promise<boolean> => {
		setFailedOnce(false);
		return useAudioEngineStore.getState().play(ownerId, src, {
			onError: () => setFailedOnce(true),
		});
	}, [ownerId, src]);

	/**
	 * A click (or a keyboard nudge) on a resting row starts playback AT that
	 * point; on a playing row it only moves the playhead. The start must land
	 * BEFORE the seek: activating an element assigns its `src`, and a position
	 * written before the new source's metadata exists is the position that gets
	 * lost.
	 */
	const seekAndPlay = useCallback(
		(seconds: number) => {
			const store = useAudioEngineStore.getState();
			if (playing) {
				store.seek(ownerId, seconds);
				paintProgress(seconds);
				return;
			}
			void start().then((owned) => {
				if (owned === false) return;
				useAudioEngineStore.getState().seek(ownerId, seconds);
				paintProgress(seconds);
			});
		},
		[ownerId, playing, start, paintProgress],
	);

	const toggle = useCallback(async () => {
		if (playing) {
			useAudioEngineStore.getState().pause(ownerId);
			return;
		}
		setFailedOnce(false);
		await useAudioEngineStore.getState().toggle(ownerId, src, {
			onError: () => setFailedOnce(true),
		});
	}, [ownerId, src, playing]);

	/* ------------------------------------------------------------ scrubbing */

	const pendingSeconds = useRef(0);
	const dragState = useRef<{
		pointerId: number;
		startX: number;
		moved: boolean;
		pendingX: number;
		raf: number;
	} | null>(null);

	const secondsAt = useCallback(
		(x: number) => {
			const box = boxRef.current;
			if (!box) return 0;
			const rect = box.getBoundingClientRect();
			return seekSecondsAt(x - rect.left, rect.width, duration);
		},
		[duration],
	);

	const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
		if (loading) return;
		const target = event.currentTarget;
		// Optional-called: pointer capture is what keeps a drag alive when it
		// leaves the canvas, but a host without it (an embedded view, a test's
		// JSDOM) still gets a working drag — the events keep arriving on the
		// slider for as long as the pointer stays inside it.
		target.setPointerCapture?.(event.pointerId);
		dragState.current = {
			pointerId: event.pointerId,
			startX: event.clientX,
			moved: false,
			pendingX: event.clientX,
			raf: 0,
		};
	};

	const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragState.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (Math.abs(event.clientX - drag.startX) > CLICK_SLOP_PX) {
			if (!drag.moved) setScrubbing(true);
			drag.moved = true;
		}
		drag.pendingX = event.clientX;
		if (!drag.moved) return;
		/*
		 * rAF-throttled `fastSeek`: the frame coalesces every pointermove that
		 * arrived before it, and the visual playhead is driven from the same
		 * recorded x rather than from the element (which is still decoding the
		 * target frame).
		 */
		if (drag.raf !== 0) return;
		drag.raf = requestAnimationFrame(() => {
			const current = dragState.current;
			if (!current) return;
			current.raf = 0;
			const seconds = secondsAt(current.pendingX);
			scrubSeconds.current = seconds;
			useAudioEngineStore.getState().scrub(ownerId, seconds);
			paintProgress(seconds);
		});
	};

	const endDrag = (event: PointerEvent<HTMLDivElement>) => {
		const drag = dragState.current;
		if (!drag || drag.pointerId !== event.pointerId) return;
		if (drag.raf !== 0) cancelAnimationFrame(drag.raf);
		dragState.current = null;
		scrubSeconds.current = null;
		event.currentTarget.releasePointerCapture?.(event.pointerId);
		const seconds = secondsAt(event.clientX);
		if (drag.moved) {
			pendingSeconds.current = seconds;
			setScrubbing(false);
			// The release COMMITS the position exactly once (see the header).
			useAudioEngineStore.getState().seek(ownerId, seconds);
			paintProgress(seconds);
			return;
		}
		// A click seeks and plays — the brief's gesture.
		seekAndPlay(seconds);
	};

	/* ------------------------------------------------------------ keyboard */

	const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
		const element = audioEngineElement();
		const current = isActive && element ? element.currentTime : 0;
		if (event.key === " " || event.key === "Enter") {
			event.preventDefault();
			void toggle();
			return;
		}
		let next: number | null = null;
		if (event.key === "ArrowLeft") next = current - NUDGE_SECONDS;
		else if (event.key === "ArrowRight") next = current + NUDGE_SECONDS;
		else if (event.key === "Home") next = 0;
		else if (event.key === "End") next = duration;
		if (next === null) return;
		event.preventDefault();
		const clamped = Math.max(0, Math.min(duration, next));
		seekAndPlay(clamped);
	};

	const compact = variant === "compact";
	const sliderLabel = `${label} position`;

	return (
		<div
			data-sound-player={variant}
			/*
			 * The observable form of the honest-flat rule: `flat` is the honest
			 * scrubber drawn for absent/malformed peaks, `stored` is a real
			 * envelope. Pixels cannot state which one a canvas holds (a JSDOM
			 * canvas has no context), so the marker is what a test and a story
			 * can assert without inventing a shape.
			 */
			data-sound-peaks={peaks ? "stored" : "flat"}
			data-sound-status={
				errored
					? "error"
					: scrubbing
						? "scrubbing"
						: isActive
							? engineStatus
							: "idle"
			}
			className={cn(
				"flex w-full min-w-0 items-center gap-2",
				compact ? "gap-1.5" : "gap-2",
				className,
			)}
		>
			<button
				type="button"
				className={ICON_BUTTON_CLASS}
				disabled={loading}
				onClick={() => void toggle()}
				aria-label={
					playing
						? t("ui.chat.audio.pause_label", { label })
						: t("ui.chat.audio.play_label", { label })
				}
			>
				{loading ? (
					<Spinner size="sm" />
				) : playing ? (
					<CirclePause size={22} aria-hidden="true" />
				) : (
					<CirclePlay size={22} aria-hidden="true" />
				)}
			</button>
			<div
				ref={sliderRef}
				role="slider"
				tabIndex={0}
				aria-label={sliderLabel}
				aria-valuemin={0}
				aria-valuemax={Math.max(0, Math.round(duration))}
				aria-valuenow={0}
				aria-valuetext={ariaValueText(0, duration)}
				data-sound-slider=""
				className={cn(
					"group relative min-h-11 min-w-0 flex-1 cursor-pointer touch-none select-none",
					"rounded-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent",
					errored && "cursor-default",
				)}
				onPointerDown={onPointerDown}
				onPointerMove={onPointerMove}
				onPointerUp={endDrag}
				onPointerCancel={endDrag}
				onKeyDown={onKeyDown}
			>
				<div ref={boxRef} className="absolute inset-0">
					{/*
					 * The canvases carry no accessible content (a canvas is exposed as an
					 * empty box), and the slider wrapper above is the control a screen
					 * reader addresses — so no `aria-hidden` is needed here at all; the
					 * paint is decorative by construction.
					 */}
					<canvas
						ref={baseCanvasRef}
						className="absolute inset-0 h-full w-full text-ink-dim"
					/>
					<canvas
						ref={inkCanvasRef}
						style={{ clipPath: "inset(0 100% 0 0)" }}
						className="absolute inset-0 h-full w-full text-ink-muted"
					/>
					<span
						data-sound-thumb=""
						className={cn(
							"pointer-events-none absolute top-1/2 size-2 -translate-x-1/2 -translate-y-1/2 rounded-full bg-ink-muted group-hover:bg-ink group-focus-visible:bg-accent",
							scrubbing && "bg-accent",
						)}
						style={{ left: "var(--sound-progress, 0%)" }}
					/>
				</div>
			</div>
			<span
				ref={timeRef}
				data-sound-time=""
				className={cn(
					"min-w-10 shrink-0 text-center text-meta text-ink-muted tabular-nums",
				)}
			>
				{formatClock(0)}
			</span>
			{
				<span
					className={cn(
						"min-w-10 shrink-0 text-center text-meta text-ink-dim tabular-nums",
					)}
				>
					{formatClock(duration)}
				</span>
			}
			{errored ? (
				<span
					data-sound-error=""
					className={cn("shrink-0 text-meta text-ink-muted")}
				>
					{t("ui.chat.canonical.sound.player_failed")}
				</span>
			) : null}
		</div>
	);
};
