import { Popover, PopoverAnchor, PopoverContent } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Check, CircleAlert, CircleDot, CircleSlash } from "lucide-react";
import type {
	FC,
	KeyboardEvent as ReactKeyboardEvent,
	PointerEvent as ReactPointerEvent,
} from "react";
import {
	memo,
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
	CHECKPOINT_MARK_CLASS,
	CHECKPOINT_OUTCOME_LABELS,
	checkpointAriaLabel,
	checkpointMarkState,
	checkpointNamingPending,
	checkpointSummary,
	checkpointTitle,
	checkpointTurnCount,
} from "./checkpoint-model";

/**
 * The transcript's checkpoint rail: the right-edge overlay whose marks are the
 * conversation's material checkpoints, with a hover card naming each one and a
 * press that jumps to it (design D5, slice UI-A; reworked 2026-09-29 on the
 * operator's feedback, dsh study `dsh-rail-study.md`).
 *
 * ## Geometry (dsh)
 *
 * One mark per checkpoint, drawn as a SHORT HORIZONTAL DASH (20x2px) in a
 * fixed 10px pitch, right-aligned inside a 28px frame at `right: 12px`, the
 * frame vertically centred with `max-height: min(band - 64px, 420px)` and its
 * own scroll (24px mask fades, no chrome) when the conversation outgrows it.
 * The rail hides below a 900px chat column: the marks need the transcript's
 * gutter to sit in and a narrower column has none to give.
 *
 * The pitch is FIXED rather than seq-proportional (the pre-rework rule): a
 * proportional rail compresses a long conversation's early turns into marks
 * that overlap at the top and never resolve, and the dsh study's operator-
 * tested shape - even pitch, scroll for length - is the one a reader can aim
 * at. `seq` still orders the marks and is the wire's own ordinal.
 *
 * ## The hover lane (perf)
 *
 * ONE rail-level `previewId` scalar and per-mark `onPointerMove`; each mark is
 * `memo`ised and its state derives from that scalar, so a fly-over re-renders
 * exactly the two marks whose state flips (the dsh rule). The hover path never
 * measures, never scrolls the rail or the transcript, and never touches the
 * naming warm - the warm rides the card's own 120ms intent below, so a fly-
 * over still costs one gesture rather than one request per mark. The rail is
 * NOT virtualised in this cut: with marks as flat rows at a fixed pitch the
 * whole list is ~10px x N of static DOM, measured at N=267 (the density case
 * the old rail documented) before the decision - a virtualiser would add a
 * second scroll model for no frame time we could see in the trace.
 *
 * ## States (dsh ladder, our tokens)
 *
 * rest `scaleX(0.6)` in `ink-dim`; preview `scaleX(0.9)` in `ink-muted`;
 * active `scaleX(1)` in `ink` (the reading-position mark); unloaded
 * `scaleX(0.4)` at 60% - the turn is not in the resident window yet, so the
 * jump will have to load first. Transitions are the `duration-fast` token's
 * 120 ms (the rendered value, D3) on transform+colour and off under reduced
 * motion. The building state keeps its one pulsing mark at
 * the list's head (the index is refreshing), and the rail renders nothing for
 * loading/empty/error as before.
 *
 * ## The hover card
 *
 * One Radix popover re-anchored to the previewed mark, `side="left"`, at most
 * 300px wide and 100px tall, `role="tooltip"` and `pointer-events-none` (dsh):
 * it previews, it is not a surface to read in. The card is supplementary -
 * every fact a keyboard reader needs is in the mark's accessible name - and
 * the text is clamped rather than scrollable for the same reason.
 *
 * ## What this component owns, and what it does not
 *
 * It does not fetch (the hook does), it does not scroll the transcript (the
 * parent's `onJump` does), and it does not decide what a checkpoint IS (the
 * backend's derivation does). `loadedIds`/`activeId` are handed in by the
 * transcript once the shared history loader lands; absent, every mark reads
 * resident and no mark reads active, which is the pre-loader ladder.
 */

/** Hover intent (D5): ~120 ms to open, ~80 ms to close. Exported for tests. */
export const CHECKPOINT_CARD_OPEN_DELAY_MS = 120;
export const CHECKPOINT_CARD_CLOSE_DELAY_MS = 80;

/** The rail group's accessible name (UX round 1, U3 measured it absent). */
export const CHECKPOINT_RAIL_LABEL = "Turn checkpoints";

/** The tick's glyph per outcome (D5: ✓ / ! / ⊘ / dot). */
const OUTCOME_ICONS: Record<CheckpointOutcome, typeof Check> = {
	complete: Check,
	error: CircleAlert,
	interrupted: CircleSlash,
	open: CircleDot,
};

/**
 * The outcome's ink. The glyph SHAPE carries the state and the word beside it
 * says it; this is the third channel, not the only one.
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
	 * primitive, `reveal-record.ts` / the shared loader): ensure-loaded,
	 * reveal, land, highlight - the rail only reports the press.
	 */
	onJump: (id: string) => void;
	/**
	 * Which checkpoint is being inspected, or `null`. Fires on the CARD's own
	 * identity (intent-gated), not on the raw pointer, so the naming warm costs
	 * one call per gesture rather than one per mark crossed.
	 */
	onHover: (id: string | null) => void;
	/**
	 * §D5's building state: the backend is refreshing a stale index. The rail
	 * keeps painting the checkpoints the previous answer carried and adds one
	 * subtle pulsing mark at the list's head.
	 */
	building?: boolean;
	/**
	 * The resident-window answer, per checkpoint id: a mark whose id is absent
	 * paints the unloaded state (dsh: `scaleX(0.4)` at 60%). Handed in by the
	 * transcript's history loader; absent means "no window known", which reads
	 * every mark resident rather than guessing.
	 */
	loadedIds?: ReadonlySet<string>;
	/**
	 * The reading position's checkpoint (dsh: the active turn), painted at
	 * `scaleX(1)` in primary ink. The transcript derives it from its own
	 * viewport; absent means no mark is active.
	 */
	activeId?: string | null;
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
				<p
					className={cn("line-clamp-3 break-words text-body-sm text-ink-muted")}
				>
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

/**
 * One mark. `memo` is the whole point: the parent re-renders on every preview
 * flip, and only the marks whose `state`/`tabIndex` actually changed may
 * follow - every handler here is a stable `useCallback` from the rail, which
 * is what lets the shallow compare hold.
 */
const CheckpointMark = memo(function CheckpointMark({
	checkpoint,
	state,
	label,
	roving,
	registerTick,
	onPreview,
	onPreviewEnd,
	onFocusMark,
	onBlurMark,
	onActivate,
	onKeyMark,
	describedBy,
}: {
	checkpoint: Checkpoint;
	state: ReturnType<typeof checkpointMarkState>;
	label: string;
	roving: boolean;
	registerTick: (id: string, element: HTMLButtonElement | null) => void;
	onPreview: (id: string) => void;
	onPreviewEnd: () => void;
	onFocusMark: (id: string) => void;
	onBlurMark: () => void;
	onActivate: (id: string) => void;
	onKeyMark: (event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => void;
	/** The open card's element id, when this mark's card is the open one. */
	describedBy?: string;
}) {
	const enter = (event: ReactPointerEvent<HTMLButtonElement>) => {
		/*
		 * `pointermove`, not `pointerenter`: a move WITHIN one 10px row must
		 * cost nothing, and the id-equality guard here is what makes the
		 * setState a no-op rather than a re-render (the parent's state setter
		 * also bails, but the call is the same either way).
		 */
		if (event.pointerType === "touch") return;
		onPreview(checkpoint.id);
	};
	return (
		<button
			ref={(element) => registerTick(checkpoint.id, element)}
			type="button"
			data-checkpoint-id={checkpoint.id}
			data-mark-state={state}
			aria-label={label}
			aria-describedby={describedBy}
			tabIndex={roving ? 0 : -1}
			/*
			 * The dsh hit row: the full 28x10 pitch is the target, the visible
			 * dash is 20x2 inside it. One row per checkpoint at a fixed pitch,
			 * so a dense manifest cannot overlap two rows' targets.
			 */
			className={cn("group pointer-events-auto block h-2.5 w-7")}
			onPointerMove={enter}
			onPointerLeave={onPreviewEnd}
			onFocus={() => onFocusMark(checkpoint.id)}
			onBlur={onBlurMark}
			onClick={() => onActivate(checkpoint.id)}
			onKeyDown={(event) => onKeyMark(event, checkpoint.id)}
		>
			<span
				aria-hidden="true"
				className={cn(
					"ml-auto mr-1.5 block h-0.5 w-5 origin-right rounded-full",
					"transition-[transform,background-color] duration-fast ease-out-quart",
					"motion-reduce:transition-none",
					CHECKPOINT_MARK_CLASS[state],
				)}
			/>
		</button>
	);
});

export const CheckpointRail: FC<CheckpointRailProps> = ({
	sessionId,
	checkpoints,
	onJump,
	onHover,
	building = false,
	loadedIds,
	activeId = null,
}) => {
	const cardElementId = useId();
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [openCardId, setOpenCardId] = useState<string | null>(null);
	const tickElements = useRef(new Map<string, HTMLButtonElement>());
	const trackRef = useRef<HTMLDivElement | null>(null);
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
				setOpenCardId(id);
				return;
			}
			openTimer.current = setTimeout(() => {
				openTimer.current = null;
				setOpenCardId(id);
			}, delayMs);
		},
		[clearTimers],
	);

	const closeCard = useCallback(
		(delayMs: number) => {
			clearTimers();
			if (delayMs <= 0) {
				setOpenCardId(null);
				return;
			}
			closeTimer.current = setTimeout(() => {
				closeTimer.current = null;
				setOpenCardId(null);
			}, delayMs);
		},
		[clearTimers],
	);

	/*
	 * A session switch invalidates every id an open card could be naming. The
	 * ref records which session the open state belongs to, so the reset runs on
	 * the SWITCH only - a fresh mount has nothing to drop.
	 */
	const cardSessionRef = useRef(sessionId);
	useEffect(() => {
		if (cardSessionRef.current === sessionId) return;
		cardSessionRef.current = sessionId;
		clearTimers();
		previewRef.current = null;
		setPreviewId(null);
		setOpenCardId(null);
	}, [sessionId, clearTimers]);

	/*
	 * Reading-position follow (design round 1, D2/U1): with the active mark
	 * now arriving from the reader's own position, the track must keep it in
	 * its port - a 402-mark conversation scrolls the frame internally, and an
	 * active mark below the fold is a rung the reader cannot see. The scroll is
	 * written to the track's own `scrollTop` rather than `scrollIntoView`: the
	 * latter walks every scrollable ancestor, which would scroll the transcript
	 * out from under the reader. The 12px pad keeps the mark off the mask fades.
	 */
	useEffect(() => {
		if (activeId === null) return;
		const track = trackRef.current;
		const element = tickElements.current.get(activeId);
		if (track === null || element === undefined) return;
		const top = element.offsetTop - track.offsetTop;
		const bottom = top + element.offsetHeight;
		const pad = 12;
		if (top < track.scrollTop + pad) {
			track.scrollTop = Math.max(0, top - pad);
		} else if (bottom > track.scrollTop + track.clientHeight - pad) {
			track.scrollTop = bottom - track.clientHeight + pad;
		}
	}, [activeId]);

	// Timers outliving the component would setState into nothing. One cleanup.
	useEffect(() => () => clearTimers(), [clearTimers]);

	/*
	 * The hover notification, tied to the card's identity rather than to the
	 * pointer's. Held in a ref because call sites legitimately pass an inline
	 * lambda, and an effect keyed on the callback's identity would re-fire on
	 * every parent render.
	 */
	const onHoverRef = useRef(onHover);
	useEffect(() => {
		onHoverRef.current = onHover;
	});
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
		(openCardId && checkpoints.find((entry) => entry.id === openCardId)) ||
		null;
	const anchorEl = (openCardId && tickElements.current.get(openCardId)) || null;
	const anchorRef = useMemo(() => ({ current: anchorEl }), [anchorEl]);
	const cardOpen = activeCheckpoint !== null && anchorEl !== null;
	useEffect(() => {
		onHoverRef.current(cardOpen && openCardId ? openCardId : null);
	}, [cardOpen, openCardId]);

	const registerTick = useCallback(
		(id: string, element: HTMLButtonElement | null) => {
			if (element) tickElements.current.set(id, element);
			else tickElements.current.delete(id);
		},
		[],
	);

	/*
	 * ROVING TABINDEX (UX round 1, U1): the block is ONE tab stop - only the
	 * roving mark carries `tabIndex=0`, ArrowUp/Down walk the neighbours in DOM
	 * order, Home/End take the ends. Focus opens the card; Escape closes it
	 * without moving focus; `tickElements` is how focus moves, so the walk works
	 * for marks the pointer has never seen.
	 */
	const [rovingId, setRovingId] = useState<string | null>(null);
	const rovingTickId =
		rovingId && checkpoints.some((entry) => entry.id === rovingId)
			? rovingId
			: (checkpoints[0]?.id ?? null);
	const focusTickAt = useCallback(
		(index: number) => {
			const bounded = Math.max(0, Math.min(checkpoints.length - 1, index));
			const target = checkpoints[bounded];
			if (!target) return;
			setRovingId(target.id);
			tickElements.current.get(target.id)?.focus();
		},
		[checkpoints],
	);

	/*
	 * The preview lane. The ref is the STORM guard: a pointermove inside one
	 * row re-enters with the same id and returns before touching state or the
	 * card's timer, so a fly-over costs one transition and one timer arm.
	 */
	const previewRef = useRef<string | null>(null);
	const onPreview = useCallback(
		(id: string) => {
			if (previewRef.current === id) return;
			previewRef.current = id;
			setPreviewId(id);
			openCard(id, CHECKPOINT_CARD_OPEN_DELAY_MS);
		},
		[openCard],
	);
	const onPreviewEnd = useCallback(() => {
		previewRef.current = null;
		setPreviewId((current) => (current === null ? current : null));
		closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS);
	}, [closeCard]);

	const onFocusMark = useCallback(
		(id: string) => {
			previewRef.current = id;
			setRovingId(id);
			setPreviewId((current) => (current === id ? current : id));
			openCard(id, 0);
		},
		[openCard],
	);
	const onBlurMark = useCallback(() => {
		previewRef.current = null;
		setPreviewId((current) => (current === null ? current : null));
		closeCard(CHECKPOINT_CARD_CLOSE_DELAY_MS);
	}, [closeCard]);

	const onActivate = useCallback(
		(id: string) => {
			// The press performs the jump; the card has said what it had to say
			// by then, and leaving it over the transcript the reader just landed
			// in is noise.
			closeCard(0);
			previewRef.current = null;
			setPreviewId(null);
			onJump(id);
		},
		[closeCard, onJump],
	);

	const onKeyMark = useCallback(
		(event: ReactKeyboardEvent<HTMLButtonElement>, id: string) => {
			if (event.key === "Escape") {
				closeCard(0);
				return;
			}
			const index = checkpoints.findIndex((entry) => entry.id === id);
			if (index < 0) return;
			/*
			 * The roving walk (U1). The arrows are claimed here rather than left
			 * to bubble: the transcript's own scroller binds arrows for paging
			 * when IT has focus, and a focused mark must move focus, not the
			 * viewport.
			 */
			if (event.key === "ArrowDown") {
				event.preventDefault();
				event.stopPropagation();
				focusTickAt(index + 1);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				event.stopPropagation();
				focusTickAt(index - 1);
				return;
			}
			if (event.key === "Home") {
				event.preventDefault();
				event.stopPropagation();
				focusTickAt(0);
				return;
			}
			if (event.key === "End") {
				event.preventDefault();
				event.stopPropagation();
				focusTickAt(checkpoints.length - 1);
			}
		},
		[checkpoints, closeCard, focusTickAt],
	);

	if (checkpoints.length === 0 && !building) return null;

	return (
		/*
		 * `role="toolbar"` is the roving group's own semantics (U1): one tab
		 * stop, arrow keys inside. The frame is centred in the column and hidden
		 * below 900px of chat column (`@container/chatcol`, the shared measure).
		 */
		<div
			data-lo-checkpoint-rail=""
			role="toolbar"
			aria-orientation="vertical"
			aria-label={CHECKPOINT_RAIL_LABEL}
			className={cn(
				"pointer-events-none absolute inset-y-0 right-3 hidden w-7 select-none",
				"flex-col justify-center",
				"@[900px]/chatcol:flex",
			)}
		>
			{/*
			 * The frame: fixed pitch marks in a scroller that only appears when
			 * the conversation outgrows `min(column - 64px, 420px)`. The mask's
			 * 24px fades stand in for chrome - a mark dissolving at the edge
			 * says "more above/below" without an affordance to click.
			 */}
			<div
				data-rail-frame=""
				ref={trackRef}
				className={cn(
					"max-h-[min(calc(100%-4rem),420px)] w-7 overflow-y-auto overscroll-contain",
					/*
					 * THE FRAME'S OWN SCROLLBAR IS CHROME INSIDE THE BAND (design
					 * round 1, D1, measured): the app's 8px overlay thumb rendered
					 * inside this 28px frame - its strip crossing the dash ends and
					 * the mask dimming the last marks - so the frame keeps the
					 * scroll but reads as a bare track; the mask's 24px fades
					 * already say "more above/below".
					 */
					"[&::-webkit-scrollbar]:hidden",
					"[mask-image:linear-gradient(to_bottom,transparent_0,#000_24px,#000_calc(100%-24px),transparent_100%)]",
				)}
			>
				{building && (
					/*
					 * The building state's one liveness mark: an opacity pulse, which
					 * the motion contract allows to run indefinitely and whose end
					 * keyframe is visible, so a reduced-motion user lands on a static
					 * mark rather than an invisible one.
					 */
					<span
						aria-hidden="true"
						data-rail-building=""
						className={cn(
							"ml-auto mr-1.5 block h-0.5 w-5 animate-pulse-visible rounded-full bg-ink-dim",
						)}
					/>
				)}
				<div data-rail-track="">
					{checkpoints.map((checkpoint) => (
						<CheckpointMark
							key={checkpoint.id}
							checkpoint={checkpoint}
							state={checkpointMarkState({
								id: checkpoint.id,
								previewId,
								activeId,
								loaded: loadedIds ? loadedIds.has(checkpoint.id) : true,
							})}
							label={labels.get(checkpoint.id) ?? ""}
							roving={checkpoint.id === rovingTickId}
							registerTick={registerTick}
							onPreview={onPreview}
							onPreviewEnd={onPreviewEnd}
							onFocusMark={onFocusMark}
							onBlurMark={onBlurMark}
							onActivate={onActivate}
							onKeyMark={onKeyMark}
							describedBy={
								cardOpen && openCardId === checkpoint.id
									? cardElementId
									: undefined
							}
						/>
					))}
				</div>
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
						id={cardElementId}
						/*
						 * A stable handle for the driven scene: `role` is a
						 * semantic that may change with the design, and the
						 * scene should photograph the card, not a role name.
						 */
						data-checkpoint-card=""
						side="left"
						align="center"
						sideOffset={10}
						collisionPadding={8}
						/*
						 * dsh's card is a TOOLTIP: it previews, it is not a surface
						 * to read or click in. Its text is clamped rather than
						 * scrollable for the same reason, and the pointer must be
						 * able to travel to and past it without the card capturing
						 * anything.
						 */
						role="tooltip"
						aria-label={
							activeCheckpoint.kind === "user"
								? "Your message"
								: checkpointTitle(activeCheckpoint)
						}
						// Radix's focus-scope defaults assume a press-opened popover.
						// This one opens from a hover/focus gesture on a mark whose own
						// label already says everything, so neither opening nor closing
						// may move the reader's focus.
						onOpenAutoFocus={(event) => event.preventDefault()}
						onCloseAutoFocus={(event) => event.preventDefault()}
						/*
						 * Radix dismisses a non-modal popover when focus moves outside
						 * its layer - but the marks ARE this popover's trigger surface
						 * (there is no Radix trigger; the anchor is virtual), so tabbing
						 * from one mark to the next is not "leaving". Without this the
						 * dismissal fires AFTER the next mark's focus handler opened its
						 * card and closes it again.
						 */
						onFocusOutside={(event) => {
							const target = (
								event.detail as { originalEvent?: FocusEvent } | undefined
							)?.originalEvent?.target;
							if (
								target instanceof Element &&
								target.closest("[data-lo-checkpoint-rail]")
							) {
								event.preventDefault();
							}
						}}
						className={cn(
							"pointer-events-none max-h-[100px] w-[300px] max-w-[300px] overflow-hidden",
							"flex flex-col gap-2",
						)}
					>
						{activeCheckpoint.kind === "user" ? (
							<div
								/*
								 * `data-checkpoint-card-text` is the driven scene's measurement
								 * hook for the clamp itself: the long-message frame asserts the
								 * text is CLIPPED to its budget rather than trusting that
								 * `line-clamp-3` is doing what it says.
								 */
								data-checkpoint-card-text=""
								className={cn(
									"line-clamp-3 break-words whitespace-pre-wrap",
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
