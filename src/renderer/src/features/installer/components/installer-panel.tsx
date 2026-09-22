import logo from "@assets/icon.png";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, CircleAlert } from "lucide-react";
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
 * The installer panel: one centred column, four named phases, one line of
 * detail, and the way out.
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
 * mark, the name, and one sentence. What is left is the thing the screen is for:
 * which of four phases is running, what it already did, and what it is doing
 * now. `InstallPhase` is the main process's own vocabulary, so the stepper
 * cannot drift from the work.
 *
 * ## The indeterminate state is real, not a loading placeholder
 *
 * The window shows every step BEFORE the announced one as complete, which is
 * what lets a window that mounts late reconstruct the truth from a single
 * message. Before a step has completed there is no fraction to show, and the bar
 * says so by moving rather than by filling - see `ProgressBar`.
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

/**
 * The 1px track and its fill.
 *
 * `sunken` is the one ground role recessed below `canvas`, which is what a track
 * is; the fill is `accent`, the app's single accent spent on the one thing on
 * this screen that states progress. `rounded-xs` is the 2px step the contract
 * reserves for "bars too small to carry 6" - the same role the scrollbar thumb
 * takes.
 *
 * THE FILL IS EARNED, NOT ASSUMED. Width used to be `indexOf(phase)/4`, which is
 * 0% for the whole of the first phase - and on a first run the first phase is
 * where the window spends its first minutes, so the measured first-run frame was
 * an EMPTY TRACK with no sweep for 2m37s (UX U9, design D4). Nothing has
 * COMPLETED there, so the honest state is the indeterminate one, whatever has
 * been announced: the bar becomes determinate once a phase is behind it.
 *
 * The indeterminate form is a moving segment rather than a static full bar,
 * because a full bar and a finished bar are the same picture. Its keyframes live
 * in `styles/index.css` next to the placeholder pulse; the STATIC half of that
 * state - the 35% segment a reduced-motion user gets - lives outside the
 * `no-preference` query there, because declining the motion must not decline the
 * state (design D4 again: declining it produced the empty bar this comment's
 * predecessor claimed it avoided).
 */
const ProgressBar: React.FC<{
	phase: InstallPhase | null;
	installed: boolean;
}> = ({ phase, installed }) => {
	const completed = installed
		? INSTALL_PHASES.length
		: Math.max(INSTALL_PHASES.indexOf(phase as InstallPhase), 0);
	const percent = (completed / INSTALL_PHASES.length) * 100;
	/*
	 * Indeterminate covers two states, and they are the same fact: nothing has
	 * finished yet - whether because no marker has arrived, or because the first
	 * one has and its phase is still running.
	 */
	const moving = !installed && completed === 0;
	return (
		<div
			className="h-0.5 w-full overflow-hidden rounded-xs bg-sunken"
			// Decorative: the status line below carries the same fact in words, and
			// the ordered list carries the position. A progressbar role here would
			// announce the same thing a third time.
			aria-hidden="true"
		>
			<div
				className={cn(
					"h-full rounded-xs bg-accent",
					// `duration-fast` and not `slow`: `width` is not on section 5's
					// transitionable list, and the step the contract reserves for
					// entrances (240ms) is the wrong one for a value that changes while
					// the user is already looking at it.
					"transition-[width] duration-fast ease-out-quart",
					moving && "lo-install-sweep",
				)}
				style={{ width: `${percent}%` }}
			/>
		</div>
	);
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

/** One phase row: its marker, its name, and its state for a screen reader. */
const PhaseRow: React.FC<{
	phase: InstallPhase;
	state: PhaseState;
}> = ({ phase, state }) => {
	/*
	 * The marker is the only element that changes shape between states, and every
	 * variant is the same 16px box: a step that grew when it became current would
	 * move the three rows under it, which is the one thing a stepper must not do
	 * while the user is reading it.
	 */
	const marker =
		state === "done" ? (
			<Check size={16} className="text-success" aria-hidden="true" />
		) : state === "failed" ? (
			<CircleAlert size={16} className="text-danger" aria-hidden="true" />
		) : state === "active" ? (
			/*
			 * Unlabelled on purpose: the row's own text is the live statement, and a
			 * labelled spinner beside it would announce the same fact twice.
			 *
			 * This is the spinner the app already owns, whose ring is `hairline` with
			 * one `accent` quadrant. Beside the bar it is the second accent, which is
			 * what the accent budget allows - and the bar keeps the fill.
			 */
			<Spinner size="sm" />
		) : (
			// `border-control`, not `hairline`: an 8px disc filled with the faintest
			// line weight is a dot nobody can see on the light themes.
			<span
				className="size-2 rounded-full border border-control"
				aria-hidden="true"
			/>
		);

	return (
		<li
			aria-current={state === "active" ? "step" : undefined}
			className="flex items-center gap-3"
		>
			<span className="flex size-4 shrink-0 items-center justify-center">
				{marker}
			</span>
			<span
				className={cn(
					/*
					 * The active row is one step up from its neighbours (`text-body`
					 * against `text-body-sm`). Design round 1 measured the live step as
					 * the third thing the eye found - after the name and the paragraph -
					 * on a screen whose entire content is that step (D7). The step is a
					 * type-size change on a row that already exists, not chrome, and it
					 * cannot move anything: the row's box is set by the 16px marker.
					 */
					state === "active" ? "text-body" : "text-body-sm",
					state === "active"
						? "font-medium text-ink"
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
	 * One live line for a flow that is otherwise silent.
	 *
	 * A screen reader used to hear the initial state once and then nothing for
	 * minutes - not the move to the next phase, not the failure - because every
	 * statement on this screen was either visible-but-unannounced or `sr-only`
	 * inside a list item nobody was prompted to re-read (UX U8). One polite region
	 * carrying the phase's own sentence is three or four announcements over a whole
	 * install, which is exactly the amount of interruption this flow has earned.
	 */
	const liveStatus = installed
		? // The sentence the whole screen was waiting for. Leaving the phase's own
			// "what happens next" here said "Starting the backend once to check it comes
			// up" over a check that had already passed.
			"Setup complete."
		: phase === null
			? "Getting started."
			: `${INSTALL_PHASE_LABELS[phase]}: ${INSTALL_PHASE_DETAILS[phase]}`;

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

			<div className="mt-8 w-full">
				<ProgressBar phase={phase} installed={installed} />
			</div>

			{/*
			 * The line that changes. `<output>` is the element with an implicit
			 * `role="status"` and `aria-live="polite"` - the whole of what a screen reader
			 * needs to follow this without being interrupted by it, and the reason
			 * `prompt()`-style prose is not used for it.
			 */}
			{!failure && (
				<output
					/*
					 * Two lines reserved, because the detail sentence wraps on the longer
					 * phases and this column is vertically centred: without the floor the whole
					 * panel would move when a phase's own sentence grew, which is the one kind
					 * of motion section 5's "an arrival must not move anything" forbids.
					 */
					className="mt-3 block min-h-10 text-body-sm text-ink-muted"
				>
					{liveStatus}
				</output>
			)}

			{/*
			 * `w-fit mx-auto` rather than a full-width list with centred rows: the rows
			 * are left-aligned inside a block that is itself centred, which is how a
			 * stepper reads as one column of steps.
			 */}
			<ol className="mx-auto mt-6 flex w-fit flex-col gap-2.5">
				{INSTALL_PHASES.map((entry) => (
					<PhaseRow
						key={entry}
						phase={entry}
						state={phaseState(entry, phase, failedAt, installed)}
					/>
				))}
			</ol>

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
