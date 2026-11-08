import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
	WifiOff,
} from "lucide-react";
import {
	peerLinkDownLabel,
	peerUncertainLabel,
} from "../../mesh/peer-presence";
import { asksOutstandingLabel } from "../ask-queue";
import { hasBackgroundWork } from "../chat-session-subagents";

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
	useI18nLocale();
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
			aria-label={t("ui.chat.asks.outstanding_aria", {
				label: asksOutstandingLabel(count),
			})}
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
 * The RUNNING LANE: "this session still has work running" (a subagent, a
 * background job or a wait), drawn UNDER the status cell rather than in it.
 *
 * WHY (operator report, 2026-11-07): a session whose turn had ended with a
 * subagent and a job still at work read as idle. The lane is ADDED under every
 * status glyph and never replaces it: the code says what the TURN did (a check,
 * an approval bubble, a spinner), the lane says children are still busy - two
 * facts, two channels. It retires the three-bead trio, which only one code
 * could draw (#840/#1503) and which the operator ruled out as a bead cluster.
 *
 * DESIGN CONSTRAINTS (designer spec "running lane", candidate A):
 *  - 10x2 CSS px, 1px radius, centred under the 16px cell, `absolute` inside it,
 *    so the cell box, the row height and the title edge never move when work
 *    starts or ends (sidebar-row-space s2);
 *  - `currentColor` in `text-accent` (the liveness role `busy` uses), drawn as
 *    an SVG rect because a `background-color` span vanishes in forced-colors;
 *  - static: `busy` owns motion in this column, and a fade would be a frame
 *    where the row has re-filed but its lane has not.
 *  - `aria-hidden`: the row's sentence carries the clause once
 *    (`backgroundWorkClause`).
 * `data-background-work` is the rig/story hook that counts it.
 */
export function BackgroundWorkLane({ className }: { className?: string }) {
	return (
		<svg
			aria-hidden="true"
			data-background-work=""
			viewBox="0 0 10 2"
			width="10"
			height="2"
			className={cn(
				"pointer-events-none absolute start-[3px] top-[calc(100%+3px)] text-accent",
				className,
			)}
		>
			<rect width="10" height="2" rx="1" fill="currentColor" />
		</svg>
	);
}

/**
 * The status label both the sidebar's tooltip/accessible name and the Stop
 * picker read, with the one translated exception.
 *
 * `status.label` is a WIRE label, not copy: the backend's resting code
 * `recent` carries the English word "Recent" (core `session/catalog.py`).
 * The sidebar already owns the translated equivalent for that one state, so
 * substitute it by the stable transport code rather than by spelling. Every
 * other code keeps the backend's own label: those carry counts, causes and
 * state-specific detail this client does not reconstruct, and copying them
 * here would make a second source of truth.
 */
export function statusLabelText(
	row: Pick<CanonicalSessionRow, "status">,
): string | undefined {
	if (row.status?.code === "recent") return t("ui.chat.sidebar.row.recent");
	return row.status?.label;
}

/**
 * The sentence the status contributes to the row's accessible name.
 *
 * ONE SPELLING, because the row now has two arms (the glyph, or a badge on a
 * picture) and a reader must hear the same words in both. `unread` is a LEVEL
 * the ink carries visually, so the name has to say it - and only where a mark
 * is actually drawn (`unreadMark`), never on a quiet row.
 *
 * THE SUFFIX HAS ONE OWNER, AND IT IS THIS FUNCTION (agent review round 1,
 * R1-B1/R1-B2). It used to be appended here AND again in the `sr-only` span, so
 * a complete unread row's name read "Complete, unread, unread" - which is what
 * four cases in `scripts/chat-session-status.test.mjs` and the added-strings
 * guard (the second literal) both failed on. Anything that renders this
 * sentence therefore renders it WHOLE; no call site may add the level itself.
 *
 * Gated on `unreadMark`, not on `row.attention?.unseen`, and the gating is the
 * contract rather than a preference: this module's own test asserts that an
 * ACKNOWLEDGED row renders IDENTICALLY to an unacknowledged one for every code
 * that draws NO mark, so an unconditional suffix changes what an acknowledged
 * busy, wedged or gated row says - and a busy row claiming ", unread" is the
 * reported defect in the one place the ink cannot show it.
 *
 * The marks are the predicate's three: `complete`, and the `error` and
 * `interrupted` codes the runtime labels "Unseen error" / "Unseen interruption"
 * and ranks as outstanding completions. The suffix is the translated `ui.chat.sidebar.row.unread_suffix`, not an English literal, so this sentence and the visible tooltip name the same level in the same language.
 *
 * THE TWO FAILURE CODES THEREFORE SAY "UNSEEN" TWICE - "Unseen error, unread" -
 * and that redundancy is ACCEPTED rather than trimmed (design D4 and QA Q-2 both
 * raised it). Gating the suffix on `unreadMark === "complete"` would be a
 * SECOND rule about which codes carry the suffix, which is the two-derivations
 * class this whole change removes: the suffix would become the check's property
 * rather than the mark's, and a counted row's name would say nothing about the
 * mark it draws. It is also the CLIENT's own statement of the level, where the
 * "Unseen" in the label is the backend's word for it - which is what keeps the
 * name true if that label is ever reworded for a code whose ink does not step
 * between read and unseen.
 */
export function statusSpokenText(
	row: CanonicalSessionRow,
	nowSeconds: number,
	mark: ReturnType<typeof sessionStatusMark>,
): string {
	const label = mark.linkDown
		? peerLinkDownLabel(row, nowSeconds)
		: (mark.uncertainLabel ??
			statusLabelText(row) ??
			t("ui.chat.sidebar.row.recent"));
	return `${label}${mark.unreadMark !== null ? t("ui.chat.sidebar.row.unread_suffix") : ""}`;
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
	/*
	 * Whether the lane is drawn under this row's glyph. Stale remote counts
	 * (link down, reach unknown) answer false inside the predicate itself.
	 */
	const backgroundWork = hasBackgroundWork(row);
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
												: // `delegating` rests on the ring: the running lane under the
													// cell now says children are at work (the trio is retired).
													code === "delegating" ||
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
									: // `delegating` rests in `ink-dim` like every resting ring: the
										// accent liveness is carried by the running lane under the cell.
										"text-ink-dim";
	return {
		code,
		linkDown,
		reconnecting,
		uncertainLabel,
		backgroundWork,
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
	 * ONE GLYPH PER CODE, PLUS THE LANE (2026-11-07). The cell is `size-4` on
	 * every row whether or not work is running, so a count that arrives late
	 * changes what is drawn and never how much of the title is cut (the
	 * first-paint fix of 2026-10-30). Every code keeps its own glyph (#1503 D1);
	 * background work adds `BackgroundWorkLane` under it, absolutely positioned
	 * so the cell's box does not grow. The facts come from `sessionStatusMark`,
	 * which the 10px badge reads too, so the two cannot drift.
	 */
	const mark = sessionStatusMark(row);
	const { Icon, ink, backgroundWork } = mark;

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
		<span className="relative flex size-4 shrink-0">
			{/*
			 * EVERY CODE KEEPS ITS OWN GLYPH (#1503 D1), and background work ADDS the
			 * lane beneath it rather than taking the cell: an approval, an error or an
			 * unread completion is the louder fact, and the lane is the quieter one
			 * that must not hide it.
			 */}
			<Icon className={cn("size-4", ink)} aria-hidden="true" />
			{backgroundWork && <BackgroundWorkLane />}
			<span className="sr-only">{statusSpokenText(row, nowSeconds, mark)}</span>
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
	const { Icon, ink } = sessionStatusMark(row);
	return (
		<span
			aria-hidden="true"
			data-session-status=""
			className={cn(
				"pointer-events-none absolute -end-0.5 -bottom-0.5 flex size-2.5 items-center justify-center rounded-full bg-sunken",
				className,
			)}
		>
			{/* The lane for a picture row sits under the avatar (chat-sidebar), not on this 10px plate. */}
			<Icon className={cn("size-2", ink)} />
		</span>
	);
}
