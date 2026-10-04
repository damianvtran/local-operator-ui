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
	LoaderCircle,
	MessageCircleQuestion,
	MessageSquare,
	Pause,
	Share2,
} from "lucide-react";
import { asksOutstandingLabel } from "../ask-queue";

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

export function ChatSessionStatus({ row }: { row: CanonicalSessionRow }) {
	const code = row.status?.code;
	/*
	 * WHAT THIS ROW IS DRAWING, asked of the ONE predicate (`unreadMarkKind`) the
	 * accessible name below, the sidebar row's tooltip and the bulk control's
	 * count all ask. It reads `status.code`, which is the runtime's own
	 * `shows_completion_mark` precedence over the wire; `unseen` alone cannot
	 * answer it, because a session that finished a turn and then started another
	 * still carries `unseen` — a LEVEL, cleared only by an acknowledgement — while
	 * drawing a spinner, and that row must claim neither the check nor "unread".
	 */
	const unreadMark = unreadMarkKind(row);
	// Completion is still the outcome after reading it; only its attention
	// mark rests. Keep failures, work and pending gates independent of receipts.
	const unseenCompletion = unreadMark === "complete";
	const Icon =
		code === "busy"
			? LoaderCircle
			: code === "approval" || code === "answer" || code === "error"
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
					 * WHY NOT THE NEAR MISSES: `WifiOff` belongs to the app's
					 * daemon-connection vocabulary for a different fact with a different
					 * remedy (`shared/backend-status.ts`); `HelpCircle` already means "a code
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
									: // `delegating` is the arm for a session whose OWN turn is not
										// running but which still owns subagents: running ones, queued
										// ones, or both. It sits beside `attached` because the backend
										// inserts the code at that rung - below an attached session, a
										// gate, a stop, a live turn and an unseen receipt, and above an
										// armed wake - so the glyph cannot name a state the backend
										// outranks.
										//
										// `Share2` because it is the app's OWN "Delegated work" mark
										// (`trace-labels.ts`'s `DELEGATE` action), so the sidebar and
										// the transcript spend one glyph on one fact.
										//
										// The COUNT is not drawn here and needs no arm of its own: the
										// backend puts it inside `status.label` ("2 subagents running ·
										// 1 queued"), which this component renders into its `sr-only`
										// name below and the row's own button reads for the tooltip
										// over this mark. That is deliberate rather than lazy - the
										// count changes on the same clock as the code, so a count riding
										// a separate field would be read from a slower projection and
										// could contradict the glyph beside it.
										//
										// Deliberately NOT in `KNOWN_RESTING` below: this is a state of
										// its own with its own mark, and a build older than the code
										// renders it as the unknown `HelpCircle` rather than as a
										// resting ring, which is why this arm has to ship before or with
										// the runtime that emits it.
										code === "delegating"
										? Share2
										: // `idle`/`recent` are ordinary resting states and keep the plain
											// ring. Anything else is a code this build does not know, so it
											// must not be normalised into looking like "Recent" — a backend
											// newer than the UI would silently misreport state. An ABSENT
											// status is a different case: a locally created row carries none
											// until the next fetch, and the label already reads "Recent", so
											// treating it as unknown made the icon contradict the label.
											KNOWN_RESTING.has(code ?? "recent")
											? Circle
											: HelpCircle;
	const ink =
		code === "busy"
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
					: code === "approval" || code === "answer" || code === "interrupted"
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
			<Icon className={cn("size-4", ink)} aria-hidden="true" />
			<span className="sr-only">
				{row.status?.label ?? "Recent"}
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
				{unreadMark !== null ? ", unread" : ""}
			</span>
		</span>
	);
}
