import { Popover, PopoverAnchor, PopoverContent } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, CircleAlert, CircleDot, CircleSlash } from "lucide-react";
import type { FC } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type {
	Checkpoint,
	CheckpointOutcome,
} from "../../../../../shared/desktop-contract";
import {
	CHECKPOINT_GENERATING_NAME,
	CHECKPOINT_OUTCOME_LABELS,
	checkpointAriaLabel,
	checkpointNamingPending,
	checkpointSummary,
	checkpointTickPlacement,
	checkpointTitle,
	checkpointTurnCount,
} from "./checkpoint-model";

/**
 * The transcript's checkpoint rail: the right-edge overlay whose ticks are the
 * conversation's material checkpoints, with a hover card naming each one and a
 * press that jumps to it (design D5, slice UI-A).
 *
 * ## What this component owns, and what it does not
 *
 * The rail is a pure function of the manifest it is handed — ticks render from
 * `checkpoints`, never from the rows currently loaded, so a tick exists for a
 * turn whose text has not been paged in yet. It does not fetch (the hook does),
 * it does not scroll (the parent's `onJump` does), and it does not decide what
 * a checkpoint IS (the backend's derivation does).
 *
 * ## Placement
 *
 * The root is `absolute inset-y-0 right-0`, so it must be mounted inside a
 * POSITIONED box that spans the scroller's height — §D5's "sibling of the
 * scroller inside the chat column", over the gutter
 * `scrollbar-gutter: stable both-edges` already reserves. It is
 * `pointer-events-none`; only the ticks accept the pointer, so the rail adds
 * no dead zone beyond its own 24px strip and never reflows the transcript.
 *
 * ## States (§D5)
 *
 * - loading: nothing rendered — skeleton ticks are deliberately SUPPRESSED, so
 *   the rail never paints placeholder marks that are not checkpoints;
 * - building: ticks plus one subtle pulsing mark at the top (`building`);
 * - empty: nothing rendered;
 * - error: nothing rendered, and the hook logs once — the rail itself has no
 *   error surface to show because there is nothing here to repair.
 *
 * ## The hover card
 *
 * One Radix popover, re-anchored to whichever tick is active: hover intent
 * (~120ms open / ~80ms close) or focus opens it, side-left, and moving the
 * pointer INTO the card keeps it open so the user text can be scrolled. This
 * is deliberately one popover rather than one per tick — 267 moused-over Radix
 * roots is a lot of context for a surface that shows exactly one card.
 *
 * The card is supplementary: every fact a keyboard reader needs is already in
 * the tick's accessible name (`checkpointAriaLabel`), which is why the card
 * needs no tab stop of its own. The user card's text is bounded with an
 * internal scroll (~8 lines of body-sm), so a long message previews rather
 * than swallowing the transcript.
 */

/** Hover intent (D5): ~120 ms to open, ~80 ms to close. Exported for tests. */
export const CHECKPOINT_CARD_OPEN_DELAY_MS = 120;
export const CHECKPOINT_CARD_CLOSE_DELAY_MS = 80;

/** The tick's glyph per outcome (D5: ✓ / ! / ⊘ / dot). */
const OUTCOME_ICONS: Record<CheckpointOutcome, typeof Check> = {
	complete: Check,
	error: CircleAlert,
	interrupted: CircleSlash,
	open: CircleDot,
};

/**
 * The outcome's ink. The glyph SHAPE carries the state and the word beside it
 * carries it again, so the colour is the third channel rather than the first —
 * the roles are the semantics' own (`success`/`danger`/`warning`) instead of a
 * single quiet register, because an interrupted turn is exactly the thing this
 * card exists to make findable.
 */
const OUTCOME_INK: Record<CheckpointOutcome, string> = {
	complete: "text-success",
	error: "text-danger",
	interrupted: "text-warning",
	open: "text-ink-dim",
};

export type CheckpointRailProps = {
	/** The conversation this rail belongs to. Changing it drops any open card. */
	sessionId: string;
	checkpoints: Checkpoint[];
	/**
	 * Activate a checkpoint's jump. The parent owns the jump itself (§D7's one
	 * primitive: ensure-loaded, reveal, scroll-to-centre, highlight).
	 *
	 * TODO(ui-A-phase2): the parent wires this to `useTranscriptJump`'s near
	 * path when the rail is mounted in `canonical-transcript.tsx`; Phase 1
	 * ships with the callback as the parent's to supply.
	 */
	onJump: (id: string) => void;
	/**
	 * Which checkpoint is being inspected, or `null`.
	 *
	 * Mirrors the CARD rather than the raw pointer: a hover only counts once
	 * the intent delay has passed, or the rail would spend a naming call on
	 * every fly-over. Keyboard focus raises the same signal, because it opens
	 * the same card (§D5: "focus also opens the card").
	 */
	onHover: (id: string | null) => void;
	/**
	 * §D5's building state: the backend is refreshing a stale index. The rail
	 * keeps painting the checkpoints the previous answer carried and adds one
	 * subtle pulsing mark at the top. Additive to §D10's four props because
	 * the state is the rail's to draw and the hook is its only source;
	 * loading, empty and error need no prop — all three render nothing.
	 */
	building?: boolean;
};

const CompletionCard: FC<{ checkpoint: Checkpoint; turnCount: number }> = ({
	checkpoint,
	turnCount,
}) => {
	const outcome = checkpoint.outcome;
	const OutcomeIcon = outcome ? OUTCOME_ICONS[outcome] : null;
	const summary = checkpointSummary(checkpoint);
	return (
		<>
			<p className={cn("text-body-sm font-medium text-ink")}>
				{checkpointTitle(checkpoint)}
			</p>
			{checkpointNamingPending(checkpoint) && (
				<p className={cn("text-ink-dim text-meta")}>
					{CHECKPOINT_GENERATING_NAME}
				</p>
			)}
			{summary && (
				<p className={cn("break-words text-body-sm text-ink-muted")}>
					{summary}
				</p>
			)}
			<div className={cn("flex items-center gap-1.5 text-ink-dim text-meta")}>
				{outcome && OutcomeIcon && (
					<span className={cn("flex items-center gap-1", OUTCOME_INK[outcome])}>
						<OutcomeIcon
							aria-hidden="true"
							className={cn("size-3.5 shrink-0")}
						/>
						{CHECKPOINT_OUTCOME_LABELS[outcome]}
					</span>
				)}
				{outcome && <span aria-hidden="true">&middot;</span>}
				<span>{`Turn ${checkpoint.turn} of ${turnCount}`}</span>
			</div>
		</>
	);
};

export const CheckpointRail: FC<CheckpointRailProps> = ({
	sessionId,
	checkpoints,
	onJump,
	onHover,
	building = false,
}) => {
	const cardId = useId();
	const [activeId, setActiveId] = useState<string | null>(null);
	const tickElements = useRef(new Map<string, HTMLButtonElement>());
	const openTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
	const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

	const clearTimers = useCallback(() => {
		if (openTimer.current !== null) {
			clearTimeout(openTimer.current);
			openTimer.current = null;
		}
		if (closeTimer.current !== null) {
			clearTimeout(closeTimer.current);
			closeTimer.current = null;
		}
	}, []);

	const openCard = useCallback(
		(id: string, delayMs: number) => {
			clearTimers();
			if (delayMs <= 0) {
				setActiveId(id);
				return;
			}
			openTimer.current = setTimeout(() => {
				openTimer.current = null;
				setActiveId(id);
			}, delayMs);
		},
		[clearTimers],
	);

	const closeCard = useCallback(
		(delayMs: number) => {
			clearTimers();
			if (delayMs <= 0) {
				setActiveId(null);
				return;
			}
			closeTimer.current = setTimeout(() => {
				closeTimer.current = null;
				setActiveId(null);
			}, delayMs);
		},
		[clearTimers],
	);

	/*
	 * A session switch invalidates every id an open card could be naming, and
	 * nothing else would close it: the rail itself is not remounted by the
	 * parent. Dropping the card on the switch is the same guard `loadOlder`
	 * documents for a page that resolves into a transcript no longer on screen.
	 * The ref records which session the open state belongs to, so the reset runs
	 * on the SWITCH only — a fresh mount has nothing to drop — and the effect
	 * reads the id rather than merely keying on it.
	 */
	const cardSessionRef = useRef(sessionId);
	useEffect(() => {
		if (cardSessionRef.current === sessionId) return;
		cardSessionRef.current = sessionId;
		clearTimers();
		setActiveId(null);
	}, [sessionId, clearTimers]);

	// Timers outliving the component would setState into nothing. One cleanup.
	useEffect(() => () => clearTimers(), [clearTimers]);

	/*
	 * The hover notification, tied to the card's identity rather than to the
	 * pointer's: see the prop's own docstring. Held in a ref because call sites
	 * legitimately pass an inline lambda, and an effect keyed on the callback's
	 * identity would re-fire on every parent render.
	 */
	const onHoverRef = useRef(onHover);
	useEffect(() => {
		onHoverRef.current = onHover;
	});
	const placements = useMemo(
		() => checkpointTickPlacement(checkpoints),
		[checkpoints],
	);
	const labels = useMemo(
		() =>
			new Map(
				checkpoints.map((entry) => [entry.id, checkpointAriaLabel(entry)]),
			),
		[checkpoints],
	);
	const turnCount = useMemo(
		() => checkpointTurnCount(checkpoints),
		[checkpoints],
	);

	const activeCheckpoint =
		(activeId && checkpoints.find((entry) => entry.id === activeId)) || null;
	const anchorEl = (activeId && tickElements.current.get(activeId)) || null;
	const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
	const cardOpen = activeCheckpoint !== null && anchorEl !== null;
	useEffect(() => {
		onHoverRef.current(cardOpen && activeId ? activeId : null);
	}, [cardOpen, activeId]);

	const registerTick = useCallback(
		(id: string, element: HTMLButtonElement | null) => {
			if (element) tickElements.current.set(id, element);
			else tickElements.current.delete(id);
		},
		[],
	);

	if (checkpoints.length === 0 && !building) return null;

	return (
		<div
			data-lo-checkpoint-rail=""
			className={cn(
				"pointer-events-none absolute inset-y-0 right-0 w-6 select-none",
			)}
		>
			{building && (
				/*
				 * The building state's one liveness mark: an opacity pulse, which
				 * the motion contract allows to run indefinitely and whose end
				 * keyframe is visible, so a reduced-motion user lands on a static
				 * mark rather than an invisible one (`index.css`'s cap).
				 */
				<span
					aria-hidden="true"
					data-rail-building=""
					className={cn(
						"absolute top-0 right-1 h-0.5 w-3 rounded-sm bg-ink-dim",
						"animate-pulse-visible",
					)}
				/>
			)}
			{/*
			 * The track insets the extremes by 12px so a tick at fraction 0 or 1
			 * is never clipped by the rail's own bounds: the last of the 12px
			 * hit-target's half-height sits inside the root.
			 */}
			<div className={cn("absolute inset-y-3 right-0 w-6")}>
				{checkpoints.map((checkpoint, index) => {
					const fraction = placements[index]?.fraction ?? 0;
					const active = checkpoint.id === activeId;
					return (
						<button
							key={checkpoint.id}
							ref={(element) => registerTick(checkpoint.id, element)}
							type="button"
							data-checkpoint-id={checkpoint.id}
							aria-label={labels.get(checkpoint.id)}
							aria-haspopup="dialog"
							aria-expanded={active}
							aria-controls={active ? cardId : undefined}
							/*
							 * A 24 x 12 hit target around a 3px mark: the visual tick is
							 * the narrow vertical bar, the button is the invisible box
							 * the pointer and the keyboard actually reach. Centred on
							 * the track position, so overlapping ticks (267 is a real
							 * manifest size) share a band without moving each other —
							 * v1 lets them overlap rather than clustering (D5).
							 */
							className={cn(
								"group pointer-events-auto absolute right-0 h-3 w-6",
							)}
							style={{
								top: `calc(${(fraction * 100).toFixed(4)}% - 6px)`,
							}}
							onPointerEnter={() =>
								openCard(checkpoint.id, CHECKPOINT_CARD_OPEN_DELAY_MS)
							}
							onPointerLeave={() => closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS)}
							onFocus={() => openCard(checkpoint.id, 0)}
							onBlur={() => closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS)}
							onClick={() => {
								// The press performs the jump; the card has said what it
								// had to say by then, and leaving it over the transcript
								// the reader just landed in is noise.
								closeCard(0);
								onJump(checkpoint.id);
							}}
							onKeyDown={(event) => {
								// Radix closes the card on Escape at the document, but the
								// tick's own focus means the focus is not inside the card;
								// this is the same dismissal for the keyboard reader who
								// opened it without the pointer.
								if (event.key === "Escape") closeCard(0);
							}}
						>
							<span
								aria-hidden="true"
								className={cn(
									"mx-auto block h-3 w-[3px] rounded-sm",
									"transition-colors duration-fast ease-out-quart",
									active
										? "bg-ink"
										: "bg-ink-dim group-hover:bg-ink group-focus-visible:bg-ink",
								)}
							/>
						</button>
					);
				})}
			</div>
			<Popover
				open={cardOpen}
				onOpenChange={(next) => {
					if (!next) closeCard(0);
				}}
			>
				<PopoverAnchor virtualRef={anchorRef} />
				{activeCheckpoint && (
					<PopoverContent
						id={cardId}
						side="left"
						align="center"
						sideOffset={8}
						collisionPadding={8}
						// Radix's focus-scope defaults assume a press-opened popover.
						// This one opens from a hover/focus gesture on a tick whose own
						// label already says everything, so neither opening nor closing
						// may move the reader's focus — a returned focus would also
						// re-open the NEXT tick's card on the way back.
						onOpenAutoFocus={(event) => event.preventDefault()}
						onCloseAutoFocus={(event) => event.preventDefault()}
						// Moving the pointer into the card keeps it open so the user
						// text can be scrolled; leaving or blurring schedules the same
						// close the tick's own leave would.
						onPointerEnter={clearTimers}
						onPointerLeave={() => closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS)}
						onFocus={clearTimers}
						onBlur={() => closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS)}
						aria-label={
							activeCheckpoint.kind === "user"
								? "Your message"
								: checkpointTitle(activeCheckpoint)
						}
						className={cn("flex flex-col gap-2")}
					>
						{activeCheckpoint.kind === "user" ? (
							<div
								className={cn(
									// ~8 lines of body-sm, then the preview scrolls.
									"max-h-40 overflow-y-auto break-words whitespace-pre-wrap",
									"text-body-sm text-ink",
								)}
							>
								{activeCheckpoint.text}
							</div>
						) : (
							<CompletionCard
								checkpoint={activeCheckpoint}
								turnCount={turnCount}
							/>
						)}
					</PopoverContent>
				)}
			</Popover>
		</div>
	);
};
