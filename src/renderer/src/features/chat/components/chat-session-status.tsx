import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	unreadMarkKind,
} from "@shared/store/canonical-sessions-store";
import {
	Check,
	Circle,
	CircleAlert,
	Clock,
	EqualApproximately,
	HelpCircle,
	Hourglass,
	LoaderCircle,
	MessageCircleQuestion,
	MessageSquare,
	Pause,
	Timer,
	WifiOff,
} from "lucide-react";
import {
	peerLinkDownLabel,
	peerUncertainLabel,
} from "../../mesh/peer-presence";
import { asksOutstandingLabel } from "../ask-queue";
import { hasWork, subagentMarks } from "../chat-session-subagents";

/** Resting codes that legitimately render as a plain ring. */
const KNOWN_RESTING = new Set(["idle", "recent"]);

/**
 * The OUTSTANDING-ASKS mark for a conversation row (design §5.0).
 *
 * ## Why it is a second mark rather than a status code
 *
 * The rail already has a state for a session that needs the user - `pending`,
 * the approval queue - and this deliberately is NOT it. An approval is
 * BLOCKING: the runtime is parked and nothing moves until it is answered. A
 * queued ask is not: the agent returned a receipt and carried on, and the
 * session may be busy, idle or done while its asks sit unanswered. Folding asks
 * into `pending` would make the rail say "waiting for you" about a session that
 * is working, which is the one claim §5's header forbids a surface from making.
 *
 * ## Absent at zero, never a zero badge
 *
 * It returns `null` - not a dimmed `0` - for no asks, for an absent field, and
 * for a value the wire could not be read as a number. A zero badge is a claim
 * that something is happening, and the honest state of "nothing outstanding" is
 * no mark at all.
 *
 * ## The glyph, and why it is the same one as the dock's
 *
 * `MessageCircleQuestion` is the glyph the question dock already spends on "the
 * agent is asking". One fact, one glyph across surfaces: a reader who has seen
 * the dock knows what this mark means without the tooltip. The COUNT rides
 * `tabular-nums` beside it, and the accessible name is the sentence rather than
 * the digits, so a screen reader hears "2 asks, the agent is not waiting on
 * you" instead of "two".
 *
 * ## The ink: the accent glyph, the row's own count ink
 *
 * It was `ink-muted` throughout, which is the role for a hint, and the whole mark
 * read as one: a queued question is the one thing on the row that is ACTIONABLE
 * by the reader, and in the quiet ink it stated nothing he could act on at a
 * glance. `accent` is the ink this app already spends on the same fact everywhere
 * else - the composer's ask item (`composer-status-row.tsx`: "`1 question
 * waiting` with an accent mark") and the phone's ask chip - so the row, the chip
 * and the phone name one state with one colour, and the mark stays DISTINCT from
 * the approval arm beside it (`warning`): an approval is BLOCKING, a queued ask
 * is not, which is the distinction §5.0's header rule exists for.
 *
 * THE ACCENT CARRIES THE GLYPH AND ONLY THE GLYPH (design round 1, D1). This row
 * can be `row-selected` or `row-hover`, and against those two grounds `accent`
 * measures 4.24:1 (tokyoNight) and 4.49:1 (tokyoNightStorm) at worst over the
 * fifty-nine palettes - under SC 1.4.3's 4.5:1 for the 12px COUNT DIGITS. The
 * 14px glyph is a GRAPHIC and clears its 3:1 floor there, so the colour the mark
 * is for stays where it is legal; the numeral - which is READ text, not a
 * graphic - takes `ink-muted`, whose worst pair over every ground this row can
 * sit on is 5.53:1 (kanagawaLotus on `sunken`; 5.63:1 on `row-selected`). Both
 * halves are asserted in `scripts/contrast-contract.mjs` ("session row ask
 * mark").
 *
 * WHAT THIS COSTS, since the accent is a budget rather than a free role: a row
 * can now draw two accent spends at once - the busy spinner and this glyph - on
 * a session that is working with questions outstanding. That is the state the
 * mark exists for (the two facts are separate, §5.0), the two are different
 * glyphs, and § 2's budget is about spends PER SCREEN rather than per row, so
 * this is accepted rather than overlooked.
 *
 * ## Where the count comes from
 *
 * `open` when the caller resolved it, else the row's own `asks_open`. The
 * caller must resolve it on this app: the desktop catalogue route never fills
 * `asks_open` (see `fleet-asks.ts`'s `fleetAsksBySession`), so a mark reading
 * the row alone draws nothing - which is why the sidebar passes the aggregate's
 * per-conversation count. The row's own field stays as the fallback for a
 * caller that holds a canonical row rather than the aggregate, and for a
 * backend that starts publishing it.
 */
export function ChatAsksOutstanding({
	row,
	open,
}: {
	row: CanonicalSessionRow;
	/** The conversation's OUTSTANDING ask count, when the caller read it from a
	 * source the row does not carry. `undefined` falls back to `row.asks_open`,
	 * and `null` is the same absence - neither is a claim of zero. */
	open?: number | null;
}) {
	const count = typeof open === "number" ? open : row.asks_open;
	if (typeof count !== "number" || !Number.isFinite(count) || count <= 0)
		return null;
	return (
		/*
		 * ONE NAME, ONE PLACE (agent review round 1, NIT-2). This node used to carry
		 * the same sentence twice - a `title` AND an `sr-only` span - and a screen
		 * reader reads the tooltip as a description, so the user heard it twice. The
		 * `aria-label` states it once and, because a label REPLACES a node's content,
		 * the visible count is not read a second time either. The name a reviewer
		 * measured (`2 asks outstanding. The agent is not blocked on you.`) is
		 * unchanged.
		 */
		<span
			role="img"
			aria-label={`${asksOutstandingLabel(count)} outstanding. The agent is not blocked on you.`}
			className={cn("inline-flex shrink-0 items-center gap-0.5")}
		>
			{/*
			 * THE ACCENT IS ON THE GLYPH, NOT ON THE MARK (design round 1, D1): a
			 * 14px glyph is a graphic and clears its 3:1 floor on every ground this
			 * row can sit on, while the count digits beside it are 12px READ text
			 * that `accent` cannot carry at 4.5:1 there (4.24:1 on `row-selected` in
			 * tokyoNight, the tightest of the fifty-nine).
			 */}
			<MessageCircleQuestion
				aria-hidden="true"
				size={14}
				className={cn("text-accent")}
			/>
			{/*
			 * The numeral takes the count ink the app's other quiet count lines wear,
			 * which clears 4.5:1 on every one of those grounds (5.53:1 worst). The
			 * accessible name above is what states the fact; these digits are its
			 * visible half.
			 */}
			<span className={cn("tabular-nums text-ink-muted text-xs")}>{count}</span>
		</span>
	);
}

/**
 * THE RUNNING-SUBAGENT MARK: three equal beads in the liveness ink - the
 * "trio" (issue #840; the trio itself operator-ACKed 2026-10-06).
 *
 * WHY IT MOVED OFF THE GLYPH. It used to be `Share2` in `text-accent`, at BOTH
 * this component's `delegating` rung and the sidebar row's own running mark, so
 * one glyph meant "delegated work" on two surfaces. The operator's report is
 * that it does not read as a state where it is drawn: a share glyph in the row
 * beside the row's OWN act buttons reads as AN ACTION, and a reader can click a
 * control they think exists and get nothing. The fix is to leave the icon
 * vocabulary entirely - the mark is a SHAPE now, not a glyph, so there is no
 * control for it to be mistaken for.
 *
 * WHY IT IS A TRIO AND NOT A DOT. The shape shipped as a single filled disc
 * (`size-2 rounded-full bg-current`) and the operator's report on THAT is the
 * change this docstring now records: one disc at 8px states "something is here"
 * and not "CHILDREN are here", and it sits in a family the app already spends
 * on unrelated facts (unread, device presence, recording). Three equal beads
 * state plurality - the mark is about the row's subagents - without inventing a
 * parent figure: the ROW is the parent, so a centred larger apex over a pair
 * (the head-and-shoulders read) would draw a parent that is already on screen as
 * the row itself. `Users`, the collision the design round named, is exactly that
 * figure, and three equal beads share no silhouette with it.
 *
 * THE GEOMETRY, AND THE LESSON THAT FIXED IT. Three equal filled circles on the
 * 24-unit grid - `c(12,6.8) r3.9`, `c(7,17.4) r3.9`, `c(17,17.4) r3.9` - in the
 * ink they inherit (`currentColor`), inside an `svg viewBox="0 0 24 24"` that
 * fills the caller's box. THE SPACING IS THE DESIGN, NOT A DETAIL: the round-1
 * candidate was the same beads with a larger apex and 4.43px between the lower
 * centres against radii summing to 4.32px, so the children OVERLAPPED by 0.12px
 * at 14px - they fused into one mass whose component count flipped between 1 and
 * 2 with the box's sub-pixel phase, which is not a property a shipped indicator
 * can carry. These three measure n=3 at every one of the 25 phases and at every
 * real x the app can place the box (measured on captured frames: x159 at the
 * 240px floor, x177, x199 and x36 in the leading slot). Count stability across
 * phases is the acceptance property; closing the gap to buy mass breaks it.
 *
 * THE INK IS `currentColor`, the way the disc took `bg-current`: the caller
 * states `text-accent` (the liveness ink `busy` uses), so the ink chain above
 * stays the single place a code's colour is decided, and the mark wears whatever
 * the family of codes paints there. THE SILHOUETTE IS WHAT SEPARATES IT FROM THE
 * UNREAD MARK, not the colour: `accent` and `success` are ΔE00 0.00 in three
 * palettes (`monokai`, `everforest`, `everforestLight` - re-derived over all
 * fifty-nine), so on those grounds a three-bead cluster and the `Check` beside
 * it are told apart by shape alone, which they are.
 *
 * THE BOX IS THE CALLER'S; THE MARK FILLS IT. `size-full` on the svg against the
 * caller's box gives ink of about 10x10px in the sidebar row's `size-3.5` (the
 * icon ramp's `sm` step the mark already occupied, so the row's footprint and
 * the mark's NOTICEABILITY - the 2026-09-29 fix that made running subagents
 * visible at all - are both unchanged), and about 12x12px in the `delegating`
 * rung's `size-4`, which fills the status slot every other code's glyph occupies
 * (agent review round 1, N2: this note used to claim the `size-3.5` box
 * unconditionally, which is true of one call site and not the other). Coverage
 * mass is 91-94% of the discarded dot's on the same ground, so noticeability is
 * held rather than traded.
 *
 * THE TWO SLOTS, AND WHY THEY DIFFER (design round 1's D7). The same mark is the
 * `delegating` rung's PRIMARY mark, drawn in the LEADING status slot where every
 * status code's glyph goes, and the sidebar row's running mark, drawn in the
 * TRAILING slot after the title. That is deliberate and the frames show it
 * working: in the rung it says what the PARENT's own turn is doing (delegated
 * work, none of it the row's), and in the row it says what the row's CHILDREN
 * are doing beside the row's own act buttons. One vocabulary, two meanings that
 * a reader never has to tell apart, because a row is in one state or the other.
 * The position is the only thing separating them, so the local text is the
 * caller's `sr-only` name (`delegating`, or the count sentence) - recorded here
 * so the next reader does not re-litigate the slot.
 *
 * IT IS STATIC, and that is a rule rather than an omission: `busy` owns the
 * spinner in the leading slot, and two animated marks in one column would make
 * two different states read as one motion. A running child is a fact, not a
 * progress bar.
 *
 * THE COLLISION CHECK, against the status family this slot draws (SC 1.4.11 - the
 * mark's ink is `accent` inside the sidebar row's 14px box, on
 * `surface`/`row-hover`/`row-selected`, which is the pair the contract's
 * GRAPHICS row is derived from; worst case 4.24:1, `tokyoNight` on
 * `row-selected`, clearing the 3:1 graphic floor):
 *
 *  - `Circle` (the resting ring) and `LoaderCircle` (`busy`) are RINGS - outlined,
 *    1.5px of `ink-dim`/`accent` with an interior the ground shows through. Three
 *    SOLID beads share no silhouette with either, at 14px or at 16px.
 *  - `Check`, `Clock`, `MessageSquare`, `Hourglass`, `Pause` and
 *    `EqualApproximately` are all angular or stroke-built; none is a cluster of
 *    discs.
 *  - `Users` is stroked, muted and a two-figure glyph, and the trio is three
 *    equal solid beads with no apex - the figure read the design round refused.
 *  - the amber class (`CircleAlert`, `Clock`) is where the module's own
 *    `wedged` note already forbids a second RING; the trio is not one.
 *
 * THE ONE RESIDUAL PUT ON THE RECORD, not argued away: three accent beads is also
 * the arrangement of a decorative cluster (a sparkle, a "∴"). It does not appear
 * at 1x in the two frames where the read is actually made (the list, and the
 * status matrix), and no motif in this family escapes it; it is accepted given
 * the brief's "subtle".
 *
 * IT IS DIGIT-FREE. The count lives in `status.label` (the backend's
 * "2 subagents running - 1 queued"), which this component renders into its
 * `sr-only` name and the row's button reads for its tooltip; a numeral beside
 * the mark would be read text on a 12px step that `accent` cannot carry on every
 * ground the row can sit on, and it would reflow the row as children start and
 * finish (see `ChatAsksOutstanding`'s D1 note). The count's home is the tooltip
 * and the `sr-only` sentence, where the exact numbers already are.
 *
 * KEEPING IT STRUCTURED. Both call sites render THIS component, so the design
 * round can iterate one place and the two surfaces cannot drift apart again.
 */
export function SubagentRunningMark({
	className,
	mark,
}: {
	/**
	 * REQUIRED, because the box is load-bearing rather than decorative (agent review round 1, NIT 1). The
	 * mark is an `size-full` svg now, so `width/height: 100%` needs a definite box to resolve against -
	 * the disc it replaced was `size-2` and sized itself. Both call sites pass one (the sidebar row's
	 * `size-3.5`, the `delegating` rung's `size-4`), and `cn` keeps the caller's class authoritative; the
	 * type says so rather than leaving the next call site to discover an invisible mark at runtime.
	 */
	className: string;
	/** The rig/test hook (`data-subagent-mark`): "this mark stands for the ROW's own running children". The one call site that draws the mark - the row's status cell - passes it, which is what its readers (`scripts/session-switch.tsx`, the sidebar rigs) count. */
	mark?: string;
}) {
	return (
		<span
			aria-hidden="true"
			data-subagent-mark={mark}
			className={cn("flex shrink-0 items-center justify-center", className)}
		>
			{/*
			 * `currentColor`, not a `bg-*`/`fill-*` role: the beads wear the INK their
			 * caller states (`text-accent` - the liveness ink, the one `busy` uses), so
			 * the ink chain above stays the single place a code's colour is decided.
			 * `size-full` hands the box's size straight to the viewBox, so the caller's
			 * class alone decides how big the mark is drawn (see the docstring).
			 */}
			<svg aria-hidden="true" viewBox="0 0 24 24" className="size-full">
				{/*
				 * THE THREE BEADS, AND THE SPACING IS THE DESIGN: equal radii, 24-grid
				 * units, centre distances kept above the radii sum so the children never
				 * fuse (the round-1 defect - see the docstring). Do not close the gap to
				 * make the mark heavier, and do not give the apex a larger radius: the
				 * equal triad IS the statement that these are the children.
				 */}
				<circle cx="12" cy="6.8" r="3.9" fill="currentColor" />
				<circle cx="7" cy="17.4" r="3.9" fill="currentColor" />
				<circle cx="17" cy="17.4" r="3.9" fill="currentColor" />
			</svg>
		</span>
	);
}

/**
 * The sentence the status contributes to the row's accessible name.
 *
 * ONE SPELLING, because the row now has two arms (the glyph, or a badge on a
 * picture) and a reader must hear the same words in both. `unread` is a LEVEL
 * the ink carries visually, so the name has to say it - and only where a mark
 * is actually drawn (`unreadMark`), never on a quiet row.
 */
export function statusSpokenText(
	row: CanonicalSessionRow,
	nowSeconds: number,
	mark: ReturnType<typeof sessionStatusMark>,
): string {
	const label = mark.linkDown
		? peerLinkDownLabel(row, nowSeconds)
		: (mark.uncertainLabel ?? row.status?.label ?? "Recent");
	return `${label}${mark.unreadMark !== null ? ", unread" : ""}`;
}

/**
 * What one row's status cell draws, as data.
 *
 * EXTRACTED SO TWO SURFACES CANNOT DISAGREE (agent profile pictures, 2026-10-30).
 * The chat sidebar now has two arms for the same row - the status glyph alone
 * when the agent has no picture, and a status badge on the corner of its
 * picture when it has one - and a second copy of these chains would let the
 * same conversation read "waiting" in one arm and "running" in the other. Every
 * rule the chains state (the unread level, the louder-fact precedence, the
 * `delegating` rung, the ink ladder) is unchanged and lives here once;
 * `ChatSessionStatus` below renders it and `ChatSessionStatusBadge` shrinks it.
 */
export function sessionStatusMark(row: CanonicalSessionRow) {
	const code = row.status?.code;
	const linkDown = row.locality === "remote" && row.link_down === true;
	const reconnecting = linkDown && row.link_reconnecting === true;
	const uncertainLabel = peerUncertainLabel(row);
	const delegating = !uncertainLabel && !linkDown && code === "delegating";
	const subagents = subagentMarks(row);
	const queuedOnly = subagents.queued && !hasWork(row.subagents_running);
	const unreadMark = unreadMarkKind(row);
	// Completion is still the outcome after reading it; only its attention
	// mark rests. Keep failures, work and pending gates independent of receipts.
	const unseenCompletion = unreadMark === "complete";
	const Icon = uncertainLabel
		? HelpCircle
		: linkDown
			? WifiOff
			: code === "waiting"
				? Hourglass
				: code === "busy"
					? LoaderCircle
					: code === "approval" || code === "answer"
						? /* Needs input must not share failure's alert ring: warning and danger can converge for colour-blind readers, so the question silhouette carries the distinction. */
							MessageCircleQuestion
						: code === "error"
							? CircleAlert
							: /*
								 * `wedged` WEARS A MARK OF ITS OWN, and that is the fix rather than a
								 * flourish. It used to share `CircleAlert` with `error`, so an owner that
								 * had merely stopped reporting and a turn that had actually broken drew
								 * byte-identical output — and the two ask opposite things of a reader
								 * (reopen the failed one; do not expect a message to land in the silent
								 * one). Colour cannot carry the difference either: this app and the TUI
								 * share one brand ramp, and the measurement recorded for the same
								 * `warning`/`danger` pair collapses the two inks under deuteranopia
								 * (`session_picker.py:563-569`). SHAPE IS THE SIGNAL, so the state gets
								 * a silhouette that shares no stroke with the alert ring — two
								 * horizontal waves, which is this app's `EqualApproximately` and the
								 * TUI's `≈` for the same state.
								 *
								 * WHY NOT THE NEAR MISSES: `WifiOff` is reserved for a lost link
								 * (to the daemon or a remote owner), not a wedged session on a
								 * reachable device; `HelpCircle` already means "a code
								 * this build does not know" two branches below; and
								 * `CircleDashed`/`CircleDotDashed` would put a second RING in the amber
								 * class beside `approval`/`answer`, which is the grouping failure the
								 * TUI's marker register warns about.
								 *
								 * IT STAYS STATIC while `busy` spins. Nothing about this state is
								 * turning: the runtime's beat stopped landing, and an animation here
								 * would both borrow the busy reading and assert an activity the stale
								 * heartbeat cannot support.
								 */
								code === "wedged"
								? EqualApproximately
								: code === "interrupted" || code === "dormant"
									? Pause
									: code === "complete"
										? unseenCompletion
											? Check
											: Circle
										: code === "scheduled"
											? Clock
											: code === "attached"
												? MessageSquare
												: // A `delegating` row never reads this chain: its glyph slot draws
													// the RUNNING MARK instead (`SubagentRunningMark` below), because the
													// share glyph read as an action on a row whose mark is a state
													// (issue #840).
													KNOWN_RESTING.has(code ?? "recent")
													? Circle
													: HelpCircle;
	const ink = uncertainLabel
		? "text-ink-dim"
		: linkDown
			? reconnecting
				? "text-ink-dim"
				: "text-warning"
			: code === "waiting"
				? "text-accent"
				: code === "busy"
					? // LIVENESS IS `accent` (or motion). It was `info` here and the accent
						// in the transcript, so one fact wore two hues depending on which
						// surface carried it — and `info` means "here is a fact" on the six
						// sites that own it. Motion still carries the state on its own; the
						// accent is the second channel, not the only one.
						"text-accent motion-safe:animate-spin"
					: code === "wedged"
						? /*
							 * `warning`, not `danger`, and the product already agreed with itself
							 * about this everywhere except here: `warning` is the role reserved
							 * for "read this, nothing has broken" — the same reading that moved
							 * `interrupted` off danger — and it is what the `/info` badge
							 * (`pickers/panels/info-panel.tsx`) and the connectivity banner
							 * already render for this state. The row was the outlier.
							 *
							 * NO NEW TOKEN, so no palette edit, no `gen-themes` run and no row in
							 * `scripts/contrast-contract.mjs`: `warning` is an existing semantic
							 * with a measured 4.5:1 text floor (docs/branding.md § 3), and this is
							 * an ink on an icon rather than a component fill/border triple.
							 *
							 * NOT `text-ink-dim`: the state changes what the user can expect of
							 * the row — their next message may silently not land — so it stays
							 * louder than a resting row, which is also why it must not be quieter
							 * than `busy`.
							 */
							"text-warning"
						: code === "error"
							? "text-danger"
							: code === "approval" ||
									code === "answer" ||
									code === "interrupted"
								? "text-warning"
								: unseenCompletion
									? "text-success"
									: // The accent role, and STATIC on purpose: `busy` owns the spinner in
										// this slot, and a second animated mark would make two different
										// states read as one. Delegating is a state of the session, not
										// activity within it, so it holds still.
										code === "delegating"
										? "text-accent"
										: "text-ink-dim";
	return {
		code,
		linkDown,
		reconnecting,
		uncertainLabel,
		delegating,
		queuedOnly,
		unreadMark,
		Icon,
		ink,
	};
}

export function ChatSessionStatus({
	row,
	nowSeconds = Date.now() / 1000,
}: { row: CanonicalSessionRow; nowSeconds?: number }) {
	/*
	 * THE ROW'S OWN CHILDREN, DRAWN IN THIS CELL RATHER THAN BESIDE THE TITLE
	 * (first-paint completeness, 2026-10-30).
	 *
	 * WHY THEY MOVED HERE AT ALL. Both counts are optional on the wire and absent
	 * means UNKNOWN, not zero, so a row can paint without them and gain them on the
	 * next read. The trailing glyphs were `shrink-0` and the title is the row's only
	 * `flex-1`, so a mark arriving late took its width out of the title and re-cut
	 * the ellipsis under the reader: measured at a 264px panel, the title's clip went
	 * 152 -> 130px and its cut column 24 -> 21 characters 1.6 s after the first
	 * contentful frame. This box is `size-4` and drawn on every row whether or not it
	 * holds a glyph, so a fact that arrives later changes what is IN the row and
	 * never how much of the title is cut. Two alternatives were measured and refused:
	 * a trailing lane reserved on every row cost 36px of every title (two titles that
	 * had rendered whole went into ellipsis at 264), and a lane reserved only while
	 * the counts were unknown merely turned the shrink into a regrow.
	 *
	 * WHICH GLYPH, AND WHY ONLY ONE CODE QUALIFIES (design round 1, D1 - BLOCKER).
	 * The runtime already orders the facts a row can carry, and it puts child
	 * activity near the BOTTOM: `catalog.py` ranks wedged, a parked gate, a busy or
	 * silent runtime and an unread outcome all above `delegating`, in its own words
	 * "the rungs above it are all LOUDER facts about the row rather than about its
	 * children". `resume.SessionRow.delegating` is non-None whenever any child runs or
	 * queues, so a live count only ever coexists with a LOUDER code - and a first cut
	 * of this change asked the counts first, which meant it never ADDED a mark, it
	 * only HID the louder one: an approval row lost its parked-gate bubble, an error
	 * row lost its alert, an unread completion lost its check (while the bulk control
	 * still counted it as unread), and the one animated busy row stopped animating.
	 *
	 * So the cell asks the CODE, not the counts: `delegating` is the one rung where
	 * child activity IS the row's top fact, and it is the rung that already drew this
	 * mark before the change. Every louder code keeps its own glyph, and the counts it
	 * carries stay in the name channel (below). Under that rule the trio also stops
	 * being ambiguous between `delegating` and "children running under another code"
	 * (D3): only `delegating` can draw it.
	 *
	 * THE QUEUED STATE HAS ITS OWN SILHOUETTE (D2). It used to be an `Hourglass`,
	 * which is the glyph of `waiting` in this same cell and was told apart by ink
	 * alone - two states, one picture. It is a `Timer` now: still "not started yet",
	 * and a silhouette nothing else in this cell wears.
	 */
	/*
	 * THE CELL'S FACTS COME FROM THE ONE PREDICATE (see `sessionStatusMark`).
	 * The long reasons for what each rung draws - the child counts' box, the
	 * `delegating`-only trio, the queued silhouette, the unread level - live
	 * there, beside the chains themselves, so this component cannot drift from
	 * the badge that draws the same state at 10px.
	 */
	const mark = sessionStatusMark(row);
	const { Icon, ink, delegating, queuedOnly } = mark;

	return (
		/*
		 * NO `title` ON THIS SPAN (review round 1, MINOR 1). It used to carry
		 * `row.status?.label`, and because this span sits INSIDE the row's button it won
		 * the nested-`title` rule: hovering the 16px mark showed the state's sentence
		 * WITHOUT the remedy clause the row composes, so the one piece of advice this
		 * change adds was unreachable exactly over the mark it is about — and the row's
		 * own tooltip, which carries the clause, was shadowed over that square of pixels.
		 * The sentence is not lost by dropping it: the row's button owns the tooltip for
		 * the whole row (including the mark), and the `sr-only` span below carries the
		 * same words to the accessibility tree.
		 */
		<span className="flex size-4 shrink-0">
			{delegating ? (
				queuedOnly ? (
					/*
					 * A QUEUE WITH NOTHING RUNNING is the one child fact the trio cannot
					 * carry, so it takes the cell - and it takes it by the same rule as the
					 * trio: only on the rung whose top fact is what its children are doing.
					 */
					<Timer
						aria-hidden="true"
						data-subagent-mark="queued"
						className="size-4 text-ink-muted"
					/>
				) : (
					<SubagentRunningMark
						className={cn("size-4", ink)}
						/*
						 * THE HOOK IS PASSED HERE (agent review round 1, R1-1). Its own rule used to
						 * withhold it on this rung, because the rung shared the component with the
						 * row's trailing indicator and the hook had to mean "the ROW's own running
						 * children" rather than "this row's status rung". The fusion leaves ONE place
						 * the mark can be drawn, and there it always means exactly that, so the
						 * attribute belongs on it - `scripts/session-switch.tsx` counts the cue by
						 * it, and a hook the product never renders is a reader that reports zero.
						 */
						mark="running"
					/>
				)
			) : (
				/*
				 * EVERY OTHER CODE KEEPS ITS OWN GLYPH (D1). A row can carry a live child
				 * count under an approval, an error, an unread completion or a spinner, and
				 * in every one of those the child count is the quieter fact: the runtime
				 * ranks it below them, the row's own sentence still carries it, and hiding
				 * the louder glyph to show it turns "waiting for you" into "work in
				 * progress".
				 */
				<Icon className={cn("size-4", ink)} aria-hidden="true" />
			)}
			<span className="sr-only">
				{statusSpokenText(row, nowSeconds, mark)}
				{/*
				 * THE UNREAD SEMANTIC IS AN INK STEP, so on its own it tells a screen
				 * reader nothing — the arrival is visible only to someone looking at
				 * the glyph — and the name carries it in the cases the ink moves to a
				 * state of its own (review round 3, R3-3).
				 *
				 * Gated on `unreadMark`, not on `row.attention?.unseen`, and the gating
				 * is the contract rather than a preference: this module's own test
				 * asserts that an ACKNOWLEDGED row renders IDENTICALLY to an
				 * unacknowledged one for every code that draws NO mark, so an
				 * unconditional suffix changes what an acknowledged busy, wedged or
				 * gated row says — and a busy row claiming ", unread" is the reported
				 * defect in the one place the ink cannot show it.
				 *
				 * The marks are the predicate's three: `complete`, and the `error` and
				 * `interrupted` codes the runtime labels "Unseen error" / "Unseen
				 * interruption" and ranks as outstanding completions.
				 *
				 * THE TWO FAILURE CODES THEREFORE SAY "UNSEEN" TWICE — "Unseen error,
				 * unread" — and that redundancy is ACCEPTED rather than trimmed (design
				 * D4 and QA Q-2 both raised it). Gating the suffix on `unreadMark ===
				 * "complete"` would be a SECOND rule about which codes carry the
				 * suffix, which is the two-derivations class this whole change removes:
				 * the suffix would become the check's property rather than the mark's,
				 * and a counted row's name would say nothing about the mark it draws.
				 * It is also the CLIENT's own statement of the level, where the
				 * "Unseen" in the label is the backend's word for it — which is what
				 * keeps the name true if that label is ever reworded for a code whose
				 * ink does not step between read and unseen.
				 */}
				{sessionStatusMark(row).unreadMark !== null ? ", unread" : ""}
			</span>
		</span>
	);
}

/**
 * The same status, shrunk to sit on the corner of a session's picture.
 *
 * WHY A CORNER BADGE (operator's ask: "the running/done/waiting/attention
 * states must stay legible, so never hide status behind the avatar"). A row
 * with a picture would otherwise spend the leading slot on the picture and lose
 * the one mark that says what the conversation is doing. The badge keeps BOTH:
 * the avatar takes the slot the status glyph had, and the glyph rides its
 * bottom-trailing corner at 10px on a `sunken` plate with the ring the row's
 * ground provides, so the shape and the ink are the ones `sessionStatusMark`
 * decided for the full-size cell.
 *
 * THE PLATE IS NOT DECORATION. A 10px glyph directly on a photo is illegible on
 * a busy image; the fill separates it from the pixels behind it, and the ink
 * still carries the state (`text-accent` for running, `text-success` for a done
 * turn, `text-warning` for waiting, `text-danger` for a failure) exactly as the
 * full cell does.
 *
 * `data-session-status` survives on the badge: the rigs and the stylesheet read
 * that hook, and a row that swapped its glyph for a picture must not disappear
 * from their measurements.
 */
export function ChatSessionStatusBadge({
	row,
	className,
}: {
	row: CanonicalSessionRow;
	className?: string;
}) {
	const { Icon, ink, delegating, queuedOnly } = sessionStatusMark(row);
	return (
		<span
			aria-hidden="true"
			data-session-status=""
			className={cn(
				"pointer-events-none absolute -end-0.5 -bottom-0.5 flex size-2.5 items-center justify-center rounded-full bg-sunken",
				className,
			)}
		>
			{delegating && !queuedOnly ? (
				<SubagentRunningMark className="size-2" />
			) : (
				<Icon className={cn("size-2", ink)} />
			)}
		</span>
	);
}
