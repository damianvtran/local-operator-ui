import logo from "@assets/icon.png";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { CircleAlert } from "lucide-react";
import type React from "react";
import { useEffect, useRef } from "react";
import {
	INSTALL_PHASES,
	INSTALL_PHASE_DETAILS,
	INSTALL_PHASE_LABELS,
	type InstallFailure,
	type InstallPhase,
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
 * mark, the name, and one sentence. `InstallPhase` is the main process's own
 * vocabulary, so the rail cannot drift from the work.
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
 * expected shape rather than a stall. No byte count and no time estimate cross
 * that boundary at all. So the only determinate thing on this screen is how many
 * stages are behind us, and the rail is drawn to say exactly that and no more: a
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
	onCancel: () => void;
	onRetry: () => void;
};

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
 * THE MARKER GRAMMAR IS SHAPE, AND EVERY SHAPE IS STATIC: a hollow ring for a
 * step that has not started, a filled accent dot for one that is finished, an
 * accent ring for the one running, and the failure glyph where it failed. The
 * panel's motion is therefore a decoration on a state that is already legible
 * without it - which is the property the previous round's frames were missing
 * when declining the animation left an empty bar on screen (design D4).
 *
 * WHY THERE IS NO CHECK, AND WHY THAT IS A DELIBERATE REMOVAL. A finished step
 * used to carry a `success` Check beside a bar filled in `accent`: two colours,
 * two objects, one fact. The rail states completion once, in `accent`, as a
 * filled dot and a filled connector - the same colour the app already spends on
 * the one thing on this screen that states progress - and the shapes carry the
 * rest. "Finished" is also the only state that needs no glyph: it is the one the
 * user is not being asked to look at.
 *
 * WHY THE RUNNING MARKER BREATHES RATHER THAN SPINS. A spinner is a promise of
 * rotation, and on a five-minute step it is the thing that fights a user who is
 * waiting. This is the app's existing indeterminate cadence
 * (`--animate-pulse-visible`: a 2s opacity breath with a 0.7 floor, keyed `1 ->
 * 0.7 -> 1`) reused, which also means its reduced-motion story is already
 * solved: the global duration cap lands the animation on its final frame at
 * full opacity, so a user who asked for less motion gets a still accent ring
 * that says the same thing.
 */
const PhaseMarker: React.FC<{ state: PhaseState }> = ({ state }) => {
	if (state === "failed")
		return <CircleAlert size={16} className="text-danger" aria-hidden="true" />;
	return (
		<span
			aria-hidden="true"
			className={cn(
				"size-2 rounded-full",
				/*
				 * `border-control` and not `hairline`, for the reason the previous
				 * round recorded: an 8px disc bounded by the faintest line weight is a
				 * dot nobody can see on the light themes. `border-2` on the running one
				 * is what tells it apart from a waiting one in a still frame.
				 */
				state === "done" && "bg-accent",
				state === "active" && "animate-pulse-visible border-2 border-accent",
				state === "waiting" && "border border-control",
			)}
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
 * state in which it stops inside a step. The colour change is transitioned at
 * `duration-slow` (240ms) so a step completing reads as the path advancing
 * rather than as a repaint.
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
					 * THE PATH DRAWS ITSELF, and this is the only motion on the screen
					 * that reports a completion. The connector is always an accent rule
					 * and the step's own state only decides whether it is drawn: `scale-y`
					 * from 0 to 1 at the entrance duration, over `origin-top`, so a step
					 * finishing reads as the line reaching the next marker rather than as
					 * a repaint. It cannot be misread as a fraction either, in a still or
					 * mid-transition: the rule is either absent or whole, and it is
					 * whole exactly when the step above it is finished.
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
					 * width: the only ink-step in the column that is not muted, the only accent
					 * ring, the only breathing element on the screen, the fill behind it, and
					 * the sentence under the rail that is about it.
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
 * The four steps, the path between them, and the mark for a run that has not
 * named a step yet.
 *
 * THE HEAD MARK IS THE PANEL'S SECOND AND LAST PIECE OF MOTION, and it exists
 * because of the one window where the panel knows work is happening but not
 * WHERE. `phase === null` is that window: the setup window is created before the
 * managed runtime is prepared (`backend-installer.ts` says why), so its first
 * painted frames have no marker to name - and the previous round measured what
 * they looked like when the only progress object was a bar with nothing in it
 * (design D4, UX U9/U12).
 *
 * WHY A MARK BEFORE THE FIRST STEP RATHER THAN A SEGMENT TRAVELLING THE RAIL.
 * A travelling segment was written here first, and its own reduced-motion
 * parking exposes why it is the wrong object: parked anywhere on a 128px rail it
 * spans a marker on each side of itself, and an accent rule that joins two steps
 * is the DETERMINATE claim this whole redesign exists to remove - measured in
 * the frame, where it reads as "these two are done" in the one state where
 * nothing at all is known. A stub arriving at the rail's head claims exactly
 * what is true - the run has started and has reached no step - it is legible
 * with the animation declined (the app's existing `pulse-visible` cadence, whose
 * 0.7-floor breath lands on full opacity under the duration cap), and it is the
 * same gesture as the running step's own marker: the app's accent mark breathes
 * where the work is, and when it cannot be placed yet it breathes at the rail's
 * head.
 *
 * `w-fit mx-auto` rather than a full-width list with centred rows: the rows are
 * left-aligned inside a block that is itself centred, which is how a stepper
 * reads as one column of steps.
 */
const StageRail: React.FC<{
	phase: InstallPhase | null;
	installed: boolean;
	failedAt: InstallPhase | null;
}> = ({ phase, installed, failedAt }) => {
	const unannounced = !installed && failedAt === null && phase === null;
	return (
		<ol className="relative mx-auto mt-8 flex w-fit flex-col gap-4">
			{unannounced && (
				/*
				 * A SHORT STUB ABOVE THE RAIL, not a mark on the first step. At `top-0`
				 * a mark that is small enough to read as "not a step" also touches the
				 * first marker's ring, and a bead resting on a ring is a rendering
				 * artefact to the eye (measured in the frame). Twelve pixels up it sits
				 * in the rail's own top margin as the path ARRIVING at the rail, which is
				 * exactly what a run with no marker yet has done: it has started and
				 * reached no step. The rail's `mt-8` is the room for it.
				 */
				<span
					aria-hidden="true"
					className="animate-pulse-visible absolute -top-3 left-2 h-3 w-0.5 -translate-x-1/2 rounded-xs bg-accent"
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
	);
};

export const InstallPanel: React.FC<InstallPanelProps> = ({
	phase,
	installed,
	failure,
	onCancel,
	onRetry,
}) => {
	const failedAt = failure?.phase ?? null;
	const reasonRef = useRef<HTMLParagraphElement | null>(null);

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
			 */}
			{!failure && !installed && (
				<p className="mt-2 text-body text-ink-muted">
					This takes a few minutes the first time, on this computer.
				</p>
			)}

			<StageRail phase={phase} installed={installed} failedAt={failedAt} />

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
