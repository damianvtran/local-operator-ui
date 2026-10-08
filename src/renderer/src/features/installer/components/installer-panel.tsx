import logo from "@assets/icon.png";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, CircleAlert } from "lucide-react";
import type React from "react";
import { useEffect, useRef, useState } from "react";
import {
	INSTALL_EXPECTATION,
	INSTALL_PHASES,
	INSTALL_PHASE_DETAILS,
	INSTALL_PHASE_LABELS,
	type InstallFailure,
	type InstallPhase,
	type InstallTiming,
	formatElapsed,
	installEta,
	installSubProgressLine,
} from "../../../../../shared/install-progress";

/**
 * The installer panel: one centred column, the four steps as a single rail, one
 * line of detail, and the way out.
 *
 * ## What this replaced, and why
 *
 * The window was a 1380x800 two-pane split - product identity and a five-second
 * rotating feature carousel on the left, a spinner and a Cancel on the right -
 * with the copy "This takes a few minutes" carrying the whole of what the user
 * was told. It is the first screen anyone ever sees, and it was also the
 * heaviest: six feature panes, dot pagination, and a rotation timer, none of
 * which says anything about the install actually running behind it.
 *
 * So the carousel is gone rather than restyled, and the identity block is the
 * mark, the name, and one sentence.
 *
 * WHAT THE PHASES DO NOT SAY, AND WHY THIS PANEL RECONSTRUCTS. `InstallPhase`
 * is the main process's own vocabulary, so no row can name a step that does not
 * exist - but "behind the announced phase" is not the same as "ran": the
 * scripts do not announce every phase on every run. `python` is never announced
 * on win32/linux at all (the managed-Python search is macOS-only), and both it
 * and `environment` are guarded by their own "the venv/toolchain already exists"
 * test on all three platforms, so a rerun that reuses one announces neither.
 * `phaseState` can only compare indices, so such a run paints one or two rows
 * `done` for steps that never ran. The error is in the idle direction - a row
 * that looks finished, never a liveness mark on a run that stopped - and it is
 * not a regression (the bar this replaced reconstructed by index the same way).
 * Closing it needs one more field on the wire (the set the run announced) and a
 * third marker state, so it is recorded on the PR rather than guessed at here:
 * the renderer cannot know what was not announced. See `phaseState` below.
 *
 * ## One rail, not a bar and a list
 *
 * The screen used to state the same fact twice: a 1px horizontal bar whose fill
 * was `indexOf(phase)/4`, and directly under it a four-row list of the same four
 * phases. Two objects, one fact - and the bar was the worse of the two, because
 * a continuous fill claims a FRACTION: it sat at exactly 50% for the whole of
 * `components`, which is the longest step in the run, so the one thing the
 * screen said during the minutes a user is most likely to conclude the app has
 * hung was a number that was not moving.
 *
 * WHAT THIS PANEL KNOWS, AND WHAT IT THEREFORE SHOWS. The install reports stage
 * BOUNDARIES and nothing else: the scripts print one marker per phase
 * (`shared/install-progress.ts`), and the gap between two of them is the
 * expected shape rather than a stall. No byte count crosses that boundary, so
 * the only determinate PROGRESS on this screen is how many stages are behind us
 * (the time estimate in the status line is a measured prior, said as "about",
 * and the sub-progress is counts - see `installStatusLine`), and the rail is
 * drawn to say exactly that and no more: a
 * connector is `accent` only when the step above it is COMPLETE, so the fill can
 * only ever end at a stage boundary - there is no state in which it stops
 * part-way through one. Within a stage the panel is indeterminate by
 * construction, and it says so with motion at the running step rather than with
 * a fraction it does not have.
 *
 * ## Structure
 *
 * `InstallationProgress` owns the IPC subscription; this component is a pure
 * function of the view, which is what makes the states reachable from a story
 * and therefore photographable.
 */
export type InstallPanelProps = {
	/** The step in progress, or null when nothing has been announced yet. */
	phase: InstallPhase | null;
	installed: boolean;
	failure: InstallFailure | null;
	/**
	 * The run's clock and sub-progress, when the main process sent them. Null is
	 * an older main process (or the instant before the first payload), and the
	 * panel then shows the step counter alone rather than a clock it cannot
	 * stand behind.
	 */
	timing?: InstallTiming | null;
	/**
	 * The instant the panel reads as "now". Defaults to a ticking `Date.now()`;
	 * a story or a test pins it so the frame is reproducible.
	 */
	now?: number;
	onCancel: () => void;
	onRetry: () => void;
};

/**
 * The status line over the rail: `Step 2 of 4 · 0:07 · about 10 s left`.
 *
 * WHY IT EXISTS (first-run onboarding, U8/Q5/D10). The rail says WHERE the run
 * is and nothing about how long, and the line that used to answer that said
 * "a few minutes" for an install that now measures 15-25 s - so a user walked
 * away from a screen that finished before they came back, or watched one that
 * gave no sign of moving. The step count is the rail's own fact, in words; the
 * clock is the main process's (see `InstallTiming`); the estimate is the
 * measured per-OS baselines and turns into "taking longer than usual" rather
 * than counting past zero.
 *
 * Tabular figures so the ticking clock does not move the line sideways.
 */
export function installStatusLine(
	phase: InstallPhase | null,
	timing: InstallTiming | null | undefined,
	now: number,
): string | null {
	if (phase === null) return null;
	const step = `Step ${INSTALL_PHASES.indexOf(phase) + 1} of ${INSTALL_PHASES.length}`;
	if (!timing) return step;
	const elapsed = formatElapsed(now - timing.startedAt);
	const eta = installEta(timing.platform, phase, now - timing.phaseStartedAt);
	return `${step} \u00b7 ${elapsed} elapsed \u00b7 ${eta}`;
}

/** One tick a second while the run is live, so the clock moves. */
function useTick(live: boolean, pinned: number | undefined): number {
	const [now, setNow] = useState(() => pinned ?? Date.now());
	useEffect(() => {
		if (pinned !== undefined || !live) return;
		setNow(Date.now());
		const id = window.setInterval(() => setNow(Date.now()), 1000);
		return () => window.clearInterval(id);
	}, [live, pinned]);
	return pinned ?? now;
}

/** How one phase row reads: its marker and its ink both follow from this. */
type PhaseState = "done" | "active" | "waiting" | "failed";

/**
 * Which of the four states a phase row is in.
 *
 * Order matters, and it is the order the facts arrive in: a failure names its
 * own phase; a finished install completes all four; a phase behind the current
 * one is done; the current one is active; the rest have not started. `phase ===
 * null` leaves every row waiting, which is the state the panel paints before
 * anything has been announced.
 *
 * `installed` is named first among the phase comparisons because the terminal
 * message sets the phase to `verify` as well - and a panel that showed the last
 * step as still running after the install finished would be the exact lie this
 * channel exists to remove.
 */
function phaseState(
	entry: InstallPhase,
	phase: InstallPhase | null,
	failedAt: InstallPhase | null,
	installed: boolean,
): PhaseState {
	if (failedAt !== null && entry === failedAt) return "failed";
	if (installed) return "done";
	if (phase === null) return "waiting";
	if (entry === phase) return "active";
	return INSTALL_PHASES.indexOf(entry) < INSTALL_PHASES.indexOf(phase)
		? "done"
		: "waiting";
}

/**
 * The rail's own two facts, and the reason it is the only progress object here.
 *
 * THE MARKER GRAMMAR IS FOUR SHAPES IN ONE 16px BOX, so no row moves when the
 * running step does: a hollow ring for a step that has not started, a filled
 * accent dot for one that is finished, a ring that turns for the one running,
 * and the failure glyph where it failed. Every state is legible with the motion
 * declined, which is what the global duration cap guarantees it will be for some
 * users.
 *
 * STROKE WEIGHT IS A CORRECTNESS PROPERTY HERE, NOT A TASTE ONE. The waiting ring
 * used to be a 1px stroke on an 8px disc, and it measured 2.76:1 at its darkest
 * pixel in the light themes: a token that computes 3.51:1 rendered almost
 * entirely as antialiased edge, on what is now the only progress object on the
 * screen (review 2, design D4). It is drawn at 2px, in `control` - the same
 * weight AND the same stroke the running ring carries on its three quiet sides
 * - because the two are told apart by colour and by motion and by nothing else:
 * under `hairline` the running ring measured 1.22:1 against this ring's
 * 3.13-3.42:1 on the committed frames, so the mark that says "working" was the
 * faintest object in the column while the mark that says "not yet" was the
 * loudest (design round 2, D7) - and at 12px, so the token's contrast survives
 * to the eye. The
 * finished dot is a 10px fill for the reason the earlier round found: a small
 * disc bounded by the faintest line weight is a dot nobody can see.
 *
 * WHY THE RUNNING MARKER TURNS RATHER THAN BREATHES. The previous round reused
 * `--animate-pulse-visible`, the app's SKELETON cadence - a breath with no
 * direction, whose 0.7 floor took the running ring to 2.88:1 in the light
 * themes, under the 3.51:1 of the waiting rings it has to be told apart from,
 * for part of every cycle (design D3). It also replaced two directional
 * gestures (the old spinner arc, the old travelling segment) with one
 * non-directional one, on the one mark whose whole job is to say "working".
 *
 * So this is the app's own indeterminate grammar - `Spinner`'s ring with a
 * single `accent` quadrant, where the gap is what makes a rotation legible - at
 * a slower cadence, because this mark turns for minutes rather than for a
 * request, and in `control` rather than `Spinner`'s `hairline`: this ring is the
 * only progress object on its screen, where `Spinner` annotates a busy one
 * (design round 2, D7). Rotation spends no contrast at all: the accent quadrant
 * is at full strength in every phase of the turn, and the ring's other three
 * sides are the same `control` the waiting rings carry, so the running mark is
 * never dimmer than the waiting ones.
 *
 * WHY THERE IS STILL NO CHECK ON A FINISHED STEP. A finished step used to carry
 * a `success` Check beside a bar filled in `accent`: two colours, two objects,
 * one fact. The rail states a finished STEP once, in `accent`, as a filled dot
 * and a whole connector - the same colour the app already spends on progress -
 * and the shapes carry the rest. The one check on this screen is at the rail's
 * foot, once, where the path closes, and it is the one `success` mark in the
 * column (see `StageRail`): a glyph per row said "step 4" rather than "the run is
 * over", which is the fact a terminal shape has to state.
 *
 * Nothing here is spin-in-place decoration: it is the state a waiting user reads
 * as "working", on the one screen where the alternative is deciding the app has
 * hung. Under `prefers-reduced-motion` the duration cap freezes the turn and the
 * ring rests at its first frame - `control` ring, accent quadrant at the top, at
 * full opacity - the same resting-state discipline `Spinner` documents.
 */
const PhaseMarker: React.FC<{ state: PhaseState }> = ({ state }) => {
	if (state === "failed")
		return <CircleAlert size={16} className="text-danger" aria-hidden="true" />;
	if (state === "active")
		return (
			<span
				aria-hidden="true"
				className="size-3 animate-install-turn rounded-full border-2 border-control border-t-accent"
			/>
		);
	if (state === "done")
		return (
			<span aria-hidden="true" className="size-2.5 rounded-full bg-accent" />
		);
	return (
		<span
			aria-hidden="true"
			className="size-3 rounded-full border-2 border-control"
		/>
	);
};

/**
 * One step: its marker, the connector to the step below it, and its name.
 *
 * THE ROW IS A FIXED 20px (`h-5`) AND THE LABEL IS CENTRED IN IT, because the
 * rail is now a continuous line and its geometry has to be arithmetic rather
 * than emergent. The two label steps are 21.7px and 19.5px tall
 * (`--text-body`/1.55 against `--text-body-sm`/1.5), so a row sized by its own
 * text would be 2.2px taller when the running step arrived on it - and a
 * connector drawn between rows of two heights is 2px short of the next marker
 * on half the rows. Pinning the row makes the connector length exact
 * (20px row + 16px gap - 16px marker = the connector's `h-5`) and means nothing
 * in this column moves when the running step moves.
 *
 * THE CONNECTOR SAYS ONE THING: the step above it finished. It is `accent` only
 * for a `done` step, so the fill cannot be read as a fraction - there is no
 * state in which it stops inside a step. It is drawn by `transform`, over
 * `origin-top`, at `duration-slow` (240ms): a step completing reads as the path
 * advancing rather than as a repaint. For those 240ms the rule IS partial, which
 * is honest - a completion that starts at a real boundary (the step below) and
 * ends at a real one (the marker above) - and is a different object from the
 * fraction this design removed, which stopped at no boundary at all.
 */
const PhaseRow: React.FC<{
	phase: InstallPhase;
	state: PhaseState;
	last: boolean;
}> = ({ phase, state, last }) => {
	return (
		<li
			aria-current={state === "active" ? "step" : undefined}
			className="flex h-5 items-center gap-3"
		>
			<span className="relative flex size-4 shrink-0 items-center justify-center">
				<PhaseMarker state={state} />
				{!last && (
					/*
					 * FROM 0 TO 1 AT THE ENTRANCE DURATION, over `origin-top`, so a step finishing
					 * reads as the line reaching the next marker rather than as a repaint,
					 * and this is the only motion on the screen that reports a completion
					 * (the other two are the rail's two working marks, which report that the
					 * run is alive). For the length of that transition the rule is genuinely
					 * partial - see the note above on why that is not a fraction - and when
					 * the animation is declined the cap lands it on `scale-y-100`, i.e. on
					 * the state the frame is actually in, rather than on a half-drawn line.
					 *
					 * Nothing is drawn AHEAD of the run - there is deliberately no
					 * `sunken` groove here. A track would be a second, quieter statement
					 * of the same four stops the markers already are, and the previous
					 * round measured what a recessed track looks like on this ground when
					 * it is the only progress object on the screen (#1d1b19 on #22201c,
					 * 1.06:1 - design D4). The markers carry the stops; the line carries
					 * what has been walked.
					 */
					<span
						aria-hidden="true"
						className={cn(
							"absolute top-full left-1/2 h-5 w-0.5 origin-top -translate-x-1/2 rounded-xs bg-accent",
							"transition-transform duration-slow ease-out-quart",
							state === "done" ? "scale-y-100" : "scale-y-0",
						)}
					/>
				)}
			</span>
			<span
				className={cn(
					/*
					 * EVERY ROW IS THE SAME TYPE STEP, AND THAT IS LOAD-BEARING. The live
					 * step used to be lifted to `text-body font-medium` (design D7, which
					 * measured it as the third thing the eye found on a screen whose whole
					 * content is that step). The rail's rows are now `w-fit`, so a row that
					 * changes SIZE or WEIGHT changes the width of the block - and the block is
					 * centred, so the whole column would jiggle sideways every time the live
					 * step moved, twice per install. What lifts the live step instead costs no
					 * width: the only ink-step in the column that is not muted, the only turning
					 * ring on the screen, and the sentence under the rail that is about it.
					 */
					"text-body-sm",
					state === "active"
						? "text-ink"
						: state === "failed"
							? "text-danger"
							: state === "done"
								? "text-ink-muted"
								: "text-ink-dim",
				)}
			>
				{INSTALL_PHASE_LABELS[phase]}
			</span>
			<span className="sr-only">
				{state === "done"
					? " - finished"
					: state === "active"
						? " - in progress"
						: state === "failed"
							? " - failed"
							: " - waiting"}
			</span>
		</li>
	);
};

/**
 * The four steps, the path between them, the mark for a run that has not named a
 * step yet, and - once the run is over - the glyph the path ends in.
 *
 * THE HEAD MARK IS THE PANEL'S SECOND PIECE OF MOTION, and it exists because of
 * the one window where the panel knows work is happening but not WHERE.
 * `phase === null` is that window: the setup window is created before the managed
 * runtime is prepared (`backend-installer.ts` says why), so its first painted
 * frames have no marker to name - and the previous round measured what they
 * looked like when the only progress object was a bar with nothing in it (design
 * D4, UX U9/U12).
 *
 * THE HEAD MARK AND THE RUNNING MARKER ARE THE SAME OBJECT: the app's own
 * indeterminate ring, at the rail's head when no step is known and on the running
 * step's row once one is. The previous round drew the head as a 2px x 12px accent
 * rule - geometrically the connector, and in this rail a rule has exactly one
 * meaning, "the step above it finished" (design D2). There is no step above the
 * head, so the head is a MARK, not a rule, and the rail's grammar stays three
 * things: a rule means walked, a ring means here, a dot means done.
 *
 * WHY A MARK BEFORE THE FIRST STEP RATHER THAN A SEGMENT TRAVELLING THE RAIL.
 * A travelling segment was written here first, and its own reduced-motion parking
 * exposes why it is the wrong object: parked anywhere on a 128px rail it spans a
 * marker on each side of itself, and an accent rule that joins two steps is the
 * DETERMINATE claim this whole redesign exists to remove - measured in the frame,
 * where it reads as "these two are done" in the one state where nothing at all is
 * known. A mark arriving at the rail's head claims exactly what is true - the run
 * has started and has reached no step - and it stays legible with the animation
 * declined, because rotation rests at full opacity on its first frame.
 *
 * THE TERMINUS IS THE ONLY CHECK ON THE SCREEN, AND ONLY AT THE END. The rail used
 * to end in nothing: `verifying` -> `installed` was +2.3% accent ink, the same
 * three connectors and one 8px marker changing ring to dot, while the sentence
 * that said so sat under the rail and the only button was disabled at 2.72:1 - so
 * the moment the whole screen exists for had no shape of its own (design D1,
 * which measured the pre-redesign panel spending 797px of accent on the same
 * moment). A check the user has been trained by every other installer to read is
 * drawn once, below the last step, in the app's `success` role - the one place in
 * this column where the colour says the run ended well rather than that it is
 * still moving - so no ROW claims a fifth state; the rule that reaches it is
 * whole in the same frame, since the glyph is only rendered once the install
 * finished.
 *
 * `w-fit` rather than a full-width list with centred rows: the rows are
 * left-aligned inside a block that is itself centred, which is how a stepper
 * reads as one column of steps. NO OUTER MARGIN HERE - `docs/branding.md` § 5
 * puts the gap on the container, and the panel below owns it (review N3).
 */
const StageRail: React.FC<{
	phase: InstallPhase | null;
	installed: boolean;
	failure: InstallFailure | null;
}> = ({ phase, installed, failure }) => {
	const failedAt = failure?.phase ?? null;
	/*
	 * A FAILURE IS NOT AN UNANNOUNCED RUN. Both look like `phase === null` from
	 * here, so this gate has to consult the failure itself: a thrown failure before
	 * the first milestone carries `phase: null` (`reportInstallFailure` sends
	 * `lastPhase`, which starts null), and the previous round's gate on `failedAt`
	 * alone could not see it - it painted a turning "work is happening" ring above
	 * four hollow rings and a block that said setup stopped (review P1).
	 */
	const unannounced = !installed && failure === null && phase === null;
	return (
		<div className="relative flex w-fit flex-col">
			<ol className="flex w-fit flex-col gap-4">
				{unannounced && (
					/*
					 * TWO PIXELS ABOVE THE FIRST MARKER'S RING, on the marker axis. At
					 * `top-0` a mark small enough to read as "not a step" touches the first
					 * ring, and a bead resting on a ring is a rendering artefact to the eye;
					 * five pixels up (the previous geometry) it read as a tick floating above
					 * the list rather than the path arriving at it (review 9). The gap is
					 * measured from the ring, not from the 16px marker box: `-top-2.5` puts
					 * this ring's bottom edge 2px above the marker's own top edge.
					 */
					<span
						aria-hidden="true"
						className="animate-install-turn absolute -top-2.5 left-0.5 size-3 rounded-full border-2 border-control border-t-accent"
					/>
				)}
				{INSTALL_PHASES.map((entry, index) => (
					<PhaseRow
						key={entry}
						phase={entry}
						state={phaseState(entry, phase, failedAt, installed)}
						last={index === INSTALL_PHASES.length - 1}
					/>
				))}
			</ol>
			{installed && (
				<span className="relative mt-4 flex size-4 shrink-0 items-center justify-center">
					{/*
					 * The rule that reaches the terminus is drawn HERE rather than by the
					 * fourth row (`last`), so the two cannot disagree: the glyph and the rule
					 * that arrives at it are the same state, in the same frame.
					 *
					 * THE COLUMN'S ONE `success`, and the two roles are deliberate (design
					 * round 2, D8): everything that says WHERE the run is - the walked
					 * connectors, the finished dots, the turning quadrant - is `accent`, and
					 * the single glyph that says the run ENDED WELL is the app's outcome
					 * role. On the two brand palettes the roles sit ~14 units apart; on the
					 * others they diverge, and that divergence is the grammar rather than a
					 * defect: progress is not an outcome.
					 */}
					<span
						aria-hidden="true"
						className="absolute -top-4 left-1/2 h-4 w-0.5 -translate-x-1/2 rounded-xs bg-accent"
					/>
					<Check size={16} className="text-success" aria-hidden="true" />
				</span>
			)}
		</div>
	);
};

export const InstallPanel: React.FC<InstallPanelProps> = ({
	phase,
	installed,
	failure,
	timing,
	now: pinnedNow,
	onCancel,
	onRetry,
}) => {
	const reasonRef = useRef<HTMLParagraphElement | null>(null);
	const running = !installed && failure === null;
	const now = useTick(running && Boolean(timing), pinnedNow);
	const statusLine = running ? installStatusLine(phase, timing, now) : null;
	/* Only the long step has sub-progress, and only once the child said something. */
	const subLine =
		running && phase === "components"
			? installSubProgressLine(timing?.sub)
			: null;

	/*
	 * Move the reader to the reason when the install fails.
	 *
	 * The window is the whole app and the failure replaces most of its content;
	 * without this, nothing is announced and the keyboard user's next Tab lands
	 * wherever focus happened to be, on a screen that has changed underneath them
	 * (UX U8, U13). Focus moves to the sentence rather than to the button, because
	 * the sentence is what the decision needs.
	 */
	useEffect(() => {
		if (failure) reasonRef.current?.focus();
	}, [failure]);

	/*
	 * One line for a flow that is otherwise silent. See the `<output>` below for
	 * why there is exactly one, and why the label is only in it for a screen
	 * reader.
	 */
	const liveDetail = installed
		? // The sentence the whole screen was waiting for. Leaving the phase's own
			// "what happens next" here said "Starting the backend once to check it comes
			// up" over a check that had already passed.
			"Setup complete."
		: phase === null
			? "Getting started."
			: INSTALL_PHASE_DETAILS[phase];
	/*
	 * The stage's name, for the live region alone.
	 *
	 * It is not rendered visibly any more: the rail's running row names the stage
	 * one line above this sentence, and printing it twice was the same habit the
	 * bar and the list had. A screen reader still gets it, because a live region is
	 * heard OUT OF CONTEXT - "The packages it runs on, and the longest step." alone
	 * is a fragment with no subject.
	 */
	const liveLabel =
		installed || phase === null ? null : INSTALL_PHASE_LABELS[phase];

	return (
		/*
		 * No outer margin: the window owns the gap (branding section 5 - a
		 * component that ships `mb-4` cannot be composed).
		 *
		 * The staged fade-and-rise on mount lives here, as an animation whose `to`
		 * state is the resting one, so a document that never paints the first frame
		 * shows the panel fully rather than at `opacity: 0`. See
		 * `styles/index.css`; this is the same hazard the overlays document, and it
		 * is why nothing on this screen animates FROM invisible-in-place.
		 *
		 * `animate-install-enter` and not `lo-install-enter`: the latter was written
		 * here and defined nowhere, so the panel appeared in a single frame while
		 * both this comment and the PR described a fade (design D5, review R1-8).
		 * The utility comes from `--animate-install-enter` in the theme block.
		 */
		<div className="animate-install-enter flex w-full max-w-95 flex-col items-center text-center">
			{/* Decorative: the heading below is the accessible name, and a first-run
			    screen announcing the product twice is noise. */}
			<img
				src={logo}
				alt=""
				aria-hidden="true"
				className="size-10 rounded-lg object-contain"
			/>
			<h1 className="mt-3 text-title text-ink">Local Operator</h1>
			{/*
			 * The expectation, in the one sentence the screen has for it. It names
			 * the WAIT, which the screen this replaced did in "This takes a few
			 * minutes" and the redesign dropped, and it says whose machine - and it
			 * no longer assumes the reader has met an assistant yet, which on the
			 * first screen of the product nobody has (UX U10).
			 *
			 * NOT IN THE FAILURE STATE, and not in the finished one either: it promises a
			 * wait that has stopped in both. In the failure state the block below needs
			 * the room - measured on this panel, keeping it pushed the two buttons past
			 * the bottom of a 480px window, which is a non-resizable window with no
			 * scrollbar - and in the finished state it is a duration promise sitting
			 * under a full bar (design D17).
			 *
			 * ON THE FINISHED STATE THE LINE STAYS IN THE FLOW, `invisible`, so its height
			 * is kept. Removing it outright moved the panel's own column: measured on the
			 * frames, the logo went 25 -> 61 and the first marker 170 -> 176 between the
			 * running states and `installed`, because this column is vertically centred
			 * and the shortest state sets the offset (review 8). A settle at the one moment
			 * the screen should be still is motion nobody asked for, and an invisible
			 * element is a shape the reader cannot see rather than a sentence they are told
			 * and should not act on - `visibility: hidden` also keeps it out of the
			 * accessibility tree, so nothing is announced that is not on the screen.
			 *
			 * The failure state is the exception, and it is a measured one: that
			 * composition is the tallest the panel has, and reserving this line's height
			 * there pushed the buttons past the bottom of the window (the measurement the
			 * paragraph above records). A failure re-forms the whole block under the rail
			 * anyway, so there is no still composition there to hold.
			 */}
			{!failure && (
				<p
					className={cn(
						"mt-2 text-body text-ink-muted",
						installed && "invisible",
					)}
				>
					{INSTALL_EXPECTATION}
				</p>
			)}
			{/*
			 * THE STEP, THE CLOCK AND THE ESTIMATE (see `installStatusLine`). One meta
			 * line, always in the flow while the panel is not failed, so the column
			 * does not move when the first phase arrives or when the run finishes - the
			 * same reserved-height discipline the expectation line above keeps.
			 * `aria-hidden`: it changes every second, and the live region below
			 * already announces each step; a ticking clock read aloud is noise.
			 */}
			{!failure && (
				<p
					aria-hidden="true"
					data-install-status=""
					className={cn(
						"mt-1 min-h-5 text-ink-dim text-meta tabular-nums",
						!statusLine && "invisible",
					)}
				>
					{statusLine ?? "\u00a0"}
				</p>
			)}

			{/*
			 * The rail's own gap, owned here rather than by the rail: branding section 5
			 * - a component does not own its outer margin, its container does (review
			 * N3, which is why the rail no longer ships `mt-8`).
			 */}
			<div className="mt-8">
				<StageRail phase={phase} installed={installed} failure={failure} />
			</div>

			{/*
			 * The line that changes. `<output>` is the element with an implicit
			 * `role="status"` and `aria-live="polite"` - the whole of what a screen reader
			 * needs to follow this without being interrupted by it, and the reason
			 * `prompt()`-style prose is not used for it. A screen reader used to hear the
			 * initial state once and then nothing for minutes - not the move to the next
			 * phase, not the failure - because every statement on this screen was either
			 * visible-but-unannounced or `sr-only` inside a list item nobody was prompted
			 * to re-read (UX U8). One polite region carrying the phase's own sentence is
			 * three or four announcements over a whole install, which is exactly the
			 * amount of interruption this flow has earned.
			 */}
			{!failure && (
				<output
					/*
					 * Two lines reserved, because the detail sentence wraps on the longer
					 * phases and this column is vertically centred: without the floor the whole
					 * panel would move when a phase's own sentence grew, which is the one kind
					 * of motion section 5's "an arrival must not move anything" forbids.
					 */
					className="mt-4 block min-h-10 text-body-sm text-ink-muted"
				>
					{liveLabel && <span className="sr-only">{liveLabel}: </span>}
					{liveDetail}
					{/*
					 * The sub-progress, on its own line inside the reserved two: uv's own
					 * counts (`3 of 6 large downloads done`), never a fraction it does not
					 * have (D9). Hidden from the live region's announcement for the same
					 * reason as the clock - it moves several times a second.
					 */}
					{subLine && (
						<span aria-hidden="true" className="block tabular-nums">
							{subLine}
						</span>
					)}
				</output>
			)}

			{failure ? (
				/*
				 * 16px, not 20: the failure state is the tallest composition this panel
				 * has, and at 640x480 the extra four pixels came straight out of its
				 * margins - measured in the frames, the content box ran 4..475 of 480 with
				 * the two-line machine line in place. 20px was off the space ramp anyway
				 * (branding section 5's tiers are 4/8/12/16/24/32/48/64), so this is the
				 * same change as dropping to the next tier down below the mark.
				 */
				<div className="mt-4 flex w-full flex-col items-center">
					{/*
					 * THE SENTENCE FIRST, AT READING WEIGHT. The failure used to render
					 * the last line the install captured, verbatim -
					 * `ERROR: Could not find a version that satisfies the requirement
					 * local-operator` - which `docs/branding.md` section 8 calls an
					 * unfinished error: no what-happened, no what-it-means, no what-to-do,
					 * in the user's terms (design D3), and it was the DEFAULT path rather
					 * than a corner. The sentence now comes from the main process already
					 * derived, and the captured line follows it as EVIDENCE - machine
					 * voice, dim, one line - instead of as the message (D3, UX N3: at the
					 * moment of failure the thing to act on was the faintest text on the
					 * screen).
					 */}
					<p
						ref={reasonRef}
						tabIndex={-1}
						role="alert"
						className="max-w-90 text-body text-ink outline-none"
					>
						{failure.reason}
					</p>
					{/*
					 * Two lines, not one (design D12). This is the only line on the screen
					 * that carries the SPECIFIC failure whenever the cause table does not
					 * recognise it - the composition the code calls the common case - and pip
					 * puts the specific part at the END of the line: the requirement, the
					 * URL, `(from versions: none)`. A clamp of one showed the head and cut
					 * the tail, so the one diagnostic the user could act on was the part
					 * hidden. Measured in the frames: the second line costs 18px and the
					 * failure state still has ground under its buttons at 480px.
					 */}
					{failure.detail && (
						<p className="mt-2 line-clamp-2 max-w-90 break-words font-mono text-meta text-ink-dim">
							{failure.detail}
						</p>
					)}
					{/*
					 * What survived, because "did this destroy my work" is the first
					 * question a failed setup raises and nothing on this screen answered
					 * it. Setup writes only inside its own support folder, which is what
					 * makes the sentence safe on every platform (design D13): Windows is
					 * the one that persists User-scope PYENV/PYENV_HOME and prepends the
					 * user's PATH, so "nothing on this computer changed" was already false
					 * there by the time this screen could appear.
					 */}
					<p className="mt-2 max-w-90 text-body-sm text-ink-muted">
						Setup keeps everything it installs in its own folder; nothing of
						yours was touched.
					</p>
					<div className="mt-3 flex items-center gap-3">
						<Button variant="secondary" onClick={onRetry}>
							Try again
						</Button>
						{/*
						 * "Quit" and not "Close": this window is the whole app, so the
						 * button that ends the process is not dismissing anything (UX U11).
						 */}
						<Button variant="ghost" onClick={onCancel}>
							Quit
						</Button>
					</div>
				</div>
			) : (
				<div className="mt-8 flex flex-col items-center gap-2">
					<Button
						variant="secondary"
						onClick={onCancel}
						/*
						 * Disabled rather than hidden once the install has finished: the
						 * window is about to close, and a control that vanishes under the
						 * cursor reads as a misclick.
						 */
						disabled={installed}
					>
						Cancel setup
					</Button>
					{/*
					 * What leaving this window does, on a wait of one to five minutes.
					 *
					 * Nothing said it before: the window is not resizable, closing it
					 * aborts the install, and the copy that once mentioned minimising left
					 * with the carousel - so a user who needed the machine for five minutes
					 * had no sanctioned way out and no way to know they had one (design
					 * D8). Both halves of this sentence are true of the shipped window: it
					 * is minimisable, and closing it stops the run. HIDDEN once the install
					 * is finished, where "closing it stops setup" is no longer true of a
					 * window that is about to close itself.
					 */}
					{!installed && (
						<p className="text-meta text-ink-dim">
							You can minimize this window and keep working. Closing it stops
							setup.
						</p>
					)}
				</div>
			)}
		</div>
	);
};
