import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Button } from "@shared/components/ui/button";
import { cn } from "@shared/lib/utils";
import { type AsideStream, useAsideStore } from "@shared/store/aside-store";
import { X } from "lucide-react";
import { type FC, useId } from "react";
import {
	adoptAside,
	asideAdoptBlockedReason,
	asideAdoptCap,
	asideAdoptReady,
	closeAside,
} from "../aside";
import { CHAT_MEASURE } from "../chat-measure";
/**
 * The aside panel: an off-the-record exchange, attached to the composer.
 *
 * WHAT THIS REPLACES, AND WHY THE OLD SURFACE COULD NOT STAY. `/btw` used to
 * mount a Radix MODAL dialog (`AsidePicker`, through `PickerHost`). A modal traps
 * focus and marks everything outside itself `aria-hidden` with `pointer-events:
 * none`, so while it was up the composer — the surface the answer is meant to be
 * discussed in — took no keystrokes and no clicks: the operator's report, "the
 * composer does not register typing at all". The panel below is deliberately NOT
 * a dialog, a drawer or a popover, and that is the load-bearing property rather
 * than a style choice: it is an in-flow sibling of the composer box, inside the
 * same band, so nothing is trapped, the box keeps its focus and the user can keep
 * typing while an answer streams. A surface that helps the user COMPOSE cannot be
 * the surface that takes composing away.
 *
 * It carries `role="region"` and a real accessible name, and it deliberately does
 * NOT carry any of the roles in `keyboard-scopes.ts`'s `PRESS_OWNER_SELECTOR`
 * (`dialog`, `alertdialog`, `menu`, `listbox`): that selector decides whether
 * app-level shortcuts are handed to the overlay the press landed in, and a panel
 * that took the app's keys would be half-way back to the modal this replaces.
 *
 * WHERE THE TEXT COMES FROM. Deltas arrive on the session's own SSE stream and go
 * to `aside-store` from `use-canonical-session`'s flush; the POST's returned text
 * settles the turn and is authoritative (see `AsideStream`). This component reads
 * that store and nothing else — it does not own a socket, a timer or a copy of
 * the answer — which is also what lets the composer and the command dispatcher
 * agree with it about which aside is open.
 */
import { MarkdownRenderer } from "../components/markdown-renderer";

export type AsidePanelProps = {
	/** The session whose aside this is; the store is keyed by session. */
	sessionId: string;
	/**
	 * Whether that session is mid-turn — the second term of the adopt gate
	 * (`asideAdoptReady`, mirroring the TUI's `_aside_can_fork`). Passed in rather
	 * than read here: the page that owns the canonical stream owns this answer,
	 * and a second reading of it is a second thing that can be wrong.
	 */
	sessionStreaming: boolean;
	isSmallView?: boolean;
};

/**
 * The answer's own type step, in ONE place, because the exchange's cap is derived
 * from it (see `asideExchangeCap`).
 *
 * `lineHeight: 1.6` is the transcript's own leading, and `var(--text-body)` its
 * own size at the wide step — the aside reads as the agent's answer, not as a
 * second kind of prose, and a surface that picked its own step would be the
 * second typography this panel exists to avoid.
 */
const ASIDE_ANSWER_LINE_HEIGHT = 1.6;

/** The whole number of the answer's line boxes the exchange shows before it scrolls. */
const ASIDE_EXCHANGE_LINES = 10;

/** The answer's size and leading, from the step it is painted at. */
const asideAnswerType = (
	isSmallView: boolean,
): { fontSize: string; lineHeight: number } => ({
	fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
	lineHeight: ASIDE_ANSWER_LINE_HEIGHT,
});

/**
 * The exchange's cap, DERIVED from the answer's line box rather than chosen.
 *
 * WHY IT IS DERIVED (design round 1, D1). A cap in round pixels lands wherever
 * it lands inside a line, and the one this replaces did exactly that: 240px
 * against this answer's 22.4px line box (14px at `1.6`) cuts at 10.71 lines, so
 * the last visible row was a row of letter TOPS under a complete line — read as
 * a rendering accident rather than as "there is more", which is the precise
 * symptom `chat-measure.ts`'s `CAPPED_BLOCK` was introduced to remove for the
 * composer's other capped blocks. The cap is therefore a WHOLE NUMBER OF THE
 * ANSWER'S OWN LINE BOXES, and the size and leading in the expression are the
 * ones the answer is painted at (both read from `asideAnswerType`), so moving
 * the type step moves the cap with it instead of silently re-introducing the
 * partial line.
 *
 * The cap is on the exchange REGION and the panel carries no `max-height` and no
 * `overflow` of its own: the composer band must carry neither (the slash popup
 * is an unportaled child of it), so each growable part of the band caps itself —
 * the shape the composer's attachment strip and textarea already use.
 */
const asideExchangeCap = (isSmallView: boolean): string =>
	`calc(${asideAnswerType(isSmallView).fontSize} * ${ASIDE_ANSWER_LINE_HEIGHT} * ${ASIDE_EXCHANGE_LINES})`;

/**
 * One turn's answer, in the state it is in.
 *
 * `text` is painted through `MarkdownRenderer` at the transcript's own steps, so
 * an aside reads as the agent's answer rather than as a second kind of prose
 * (§ 7's tier 2: the answer is the document). A streaming answer is NOT linkified,
 * for the reason the transcript's streaming row gives — the text is a prefix the
 * next chunk falsifies, so a half-written path would become a link to a target
 * that does not exist.
 */
const AsideAnswer: FC<{
	stream: AsideStream | undefined;
	isSmallView: boolean;
}> = ({ stream, isSmallView }) => {
	if (!stream) return null;
	return (
		<div className="flex flex-col gap-1">
			{stream.text.length > 0 && (
				<MarkdownRenderer
					content={stream.text}
					styleProps={asideAnswerType(isSmallView)}
					linkify={stream.settled}
				/>
			)}
			{/*
			 * The thinking state, and the ONLY liveness element this panel paints:
			 * § 7's one element per turn. It borrows the working line's own verb so
			 * the panel and the transcript's line say the same word for the same
			 * state, and it is withheld the moment text arrives — the line's own
			 * state carries the wait, and a spinner beside a growing answer would be
			 * the second liveness element the rule forbids.
			 */}
			{stream.streaming &&
				stream.text.length === 0 &&
				stream.error === null && (
					<p className="text-body-sm text-ink-muted">thinking…</p>
				)}
			{/*
			 * `role="alert"`: the ask failed and the user is waiting on it, so it is
			 * the assertive case — the same role the composer's own send failure
			 * carries. The sentence is the backend's or the transport's, chosen by
			 * `userFacingMessage` rather than composed here.
			 */}
			{stream.error !== null && (
				<p role="alert" className="text-body-sm text-danger">
					{stream.error}
				</p>
			)}
		</div>
	);
};

export const AsidePanel: FC<AsidePanelProps> = ({
	sessionId,
	sessionStreaming,
	isSmallView = false,
}) => {
	const attachment = useAsideStore(
		(state) => state.attached[sessionId] ?? null,
	);
	const streams = useAsideStore((state) => state.streams);
	const titleId = useId();
	// Absent rather than conditional-in-the-parent at this level too: the panel's
	// own store subscription is what makes it appear, and a caller that removed it
	// must remove the attachment (or the panel would paint over the composer).
	if (!attachment) return null;

	const lastTurn = attachment.turns.at(-1);
	const stream = lastTurn ? streams[lastTurn.asideId] : undefined;
	const ready = asideAdoptReady(stream, sessionStreaming);
	const blocked = asideAdoptBlockedReason(stream, sessionStreaming);
	/*
	 * WHAT A SCREEN READER IS TOLD, AND WHY IT IS A PHASE SENTENCE RATHER THAN
	 * THE ANSWER (review round 1, F4).
	 *
	 * The panel is the app's only streaming surface outside the transcript's own
	 * live regions, and it announced nothing: the question was taken, the answer
	 * was arriving and the exchange had settled all in silence. The house pattern
	 * for a transition a reader did not initiate is one `<output aria-live="polite">`
	 * carrying the PHASE (`older-history-slot.tsx`, the working line) — and the
	 * phase is the whole point here. Mirroring the answer into a live region would
	 * announce once per chunk, which is worse than announcing nothing: the text
	 * arrives many times per answer, a `polite` region is not interruptible, and
	 * the reader would be hearing the answer's tail long after it finished.
	 *
	 * SO THE ANNOUNCEMENT IS A FUNCTION OF THE TWO FLAGS AND NEVER OF THE TEXT,
	 * which is also what keeps it from re-announcing: React re-renders the panel on
	 * every chunk, and the region's CONTENT does not change until the phase does.
	 * `streaming` covers the thinking state and the streaming one together, because
	 * they are one phase to a listener: nothing had arrived, and text is arriving.
	 *
	 * The empty panel is deliberately silent. Its text is one sentence, it is the
	 * surface the user has just summoned with their own keypress, and there is
	 * nothing yet to wait for — whereas the states below are the ones a reader
	 * cannot see arrive.
	 */
	const announcement =
		stream === undefined
			? null
			: stream.error !== null
				? "The aside was not answered"
				: stream.streaming
					? "Asking the aside"
					: "The aside answered";
	// `navigator.platform`, derived at the call site exactly as `chat-sidebar.tsx`
	// and `chat-header.tsx` do it: the cap is a promise about a key, and an
	// awaited platform would flash the wrong one.
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;

	return (
		<section
			/*
			 * A `<section>` WITH AN ACCESSIBLE NAME, and no explicit `role="region"`:
			 * that combination IS the region role (ARIA's own mapping, which is also why
			 * biome's `noRedundantRoles` refuses the attribute), and the name is what
			 * makes it a region rather than an anonymous generic. Annotating it by hand
			 * would be stating the same fact twice, in the one place where the two can
			 * disagree.
			 *
			 * WHAT IT IS NOT is the load-bearing half: it carries none of
			 * `keyboard-scopes.ts`'s `PRESS_OWNER_SELECTOR` roles (`dialog`,
			 * `alertdialog`, `menu`, `listbox`), so a press inside the panel still belongs
			 * to the page — the app-level shortcuts keep working while an aside is open,
			 * which is the property the modal it replaces took away.
			 */
			aria-labelledby={titleId}
			/*
			 * ESCAPE, FROM INSIDE THE PANEL, and it announces itself the same way the
			 * composer's own handler does. The composer's textarea claims Escape while it
			 * has focus (that is where a user typing is), but a user who just pressed the
			 * panel's own control has focus ON THAT CONTROL, and a closing gesture that
			 * depends on which of the panel's two controls was last clicked is a trap.
			 * `preventDefault` is what stops the app-level interrupt ladder from ALSO
			 * acting on the press: that listener runs on `window`, sees
			 * `defaultPrevented`, and stands down — the rung the slash popup's Escape
			 * already occupies (`use-interrupt-on-escape.ts`).
			 */
			onKeyDown={(event) => {
				if (event.key !== "Escape") return;
				event.preventDefault();
				closeAside(sessionId);
			}}
			className={cn(
				CHAT_MEASURE,
				// The composer box's own steps (`rounded-md`/`rounded-frame`, `p-2`/`p-4`),
				// so the two surfaces share one left edge, one right edge and one internal
				// inset. A panel on its own steps would read as unrelated chrome.
				isSmallView
					? "mb-2 gap-2 rounded-md p-2"
					: "mb-3 gap-3 rounded-frame p-4",
				"flex flex-col border border-hairline bg-sunken",
				// `hairline`, not `border-control`: the panel is not a control and this
				// rule is not any control's sole boundary. The composer box below keeps
				// `border-control` because it IS one, and conflating the two is how this
				// app once shipped inputs bounded at 1.25:1 (branding § 2).
			)}
			data-lo-aside-panel
		>
			<div className="flex items-start justify-between gap-2">
				<div className="flex flex-col">
					<h2 id={titleId} className="text-body-sm text-ink">
						Aside
					</h2>
					{/*
					 * The feature's own contract sentence, borrowed verbatim from the TUI
					 * card that states it (`aside_panel.py`): "nothing HERE" is the clause
					 * that makes the adopt control an act rather than a surprise, and a
					 * second wording for it here would be a second promise.
					 */}
					<p className="text-meta text-ink-muted">
						off the record — nothing here joins the conversation
					</p>
				</div>
				<Button
					variant="ghost"
					size="icon-sm"
					type="button"
					aria-label="Close the aside"
					onClick={() => closeAside(sessionId)}
				>
					<X aria-hidden="true" />
				</Button>
			</div>

			{/*
			 * THE ONE LIVE REGION THIS PANEL OWNS, and it is the phase, not the text:
			 * see `announcement` above for why a per-chunk announcement would be worse
			 * than none. `sr-only` rather than painted, so the visual surface keeps § 7's
			 * one-element-per-turn rule (the thinking line).
			 */}
			<output className="sr-only" aria-live="polite">
				{announcement}
			</output>

			{/*
			 * The exchange, bounded HERE rather than by an ancestor: the composer band
			 * must carry no `max-height` and no `overflow` (the slash popup is an
			 * unportaled `absolute bottom-full` child of it), so the rule is that each
			 * growable part of the band caps itself — the shape the composer's own
			 * attachment strip and textarea already use. The value is `asideExchangeCap`,
			 * a whole number of the answer's own line boxes rather than a round height.
			 */}
			<div
				className="flex flex-col gap-3 overflow-y-auto"
				style={{ maxHeight: asideExchangeCap(isSmallView) }}
			>
				{attachment.turns.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						Type a question in the composer below — the answer lands here.
					</p>
				) : (
					attachment.turns.map((turn) => (
						<div key={turn.asideId} className="flex flex-col gap-1">
							{/*
							 * The question is quieter than the answer on purpose, and the
							 * label is `sr-only` because the ink step already says it to a
							 * sighted reader: § 7 keeps the hierarchy in the type, not in
							 * extra chrome.
							 */}
							<p className="text-body-sm text-ink-muted">
								<span className="sr-only">Question: </span>
								{turn.question}
							</p>
							<AsideAnswer
								stream={streams[turn.asideId]}
								isSmallView={isSmallView}
							/>
						</div>
					))
				)}
			</div>

			<div className="flex flex-col gap-1">
				<div className="flex items-center gap-2">
					{/*
					 * `secondary`, matching the composer's own secondary controls: the
					 * adopt is a deliberate, occasional act beside a surface the user is
					 * typing in, not this panel's primary action.
					 */}
					<Button
						variant="secondary"
						size="sm"
						type="button"
						disabled={!ready}
						onClick={() => {
							void adoptAside(sessionId).catch(() => {
								// The refusal is already on the panel (`adoptAside` writes it
								// through `setAsideNotice`), and this call site has nothing to add
								// to it — a second catch that reported anything would be the toast
								// this design deliberately does not use.
							});
						}}
					>
						Add to conversation
					</Button>
					{/*
					 * The chord, advertised rather than hidden: a keyboard-only user must
					 * be able to find it, and the cap is the same `KeyboardShortcut` idiom
					 * the inline editor's footer and the sidebar's New chat row use.
					 */}
					<KeyboardShortcut shortcut={asideAdoptCap(isMac)} />
				</div>
				{/*
				 * The refusals, on the panel rather than in a toast: the TUI's own rule
				 * for this gesture is that the surface that refuses says so. The blocked
				 * reason explains a disabled control (this app's `cwdReadOnlyReason`
				 * shape), and the notice is what a failed adopt or close reported.
				 */}
				{blocked !== null && (
					<p className="text-body-sm text-ink-muted">{blocked}</p>
				)}
				{attachment.notice !== null && (
					<p role="alert" className="text-body-sm text-warning">
						{attachment.notice}
					</p>
				)}
			</div>
		</section>
	);
};
