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
					styleProps={{
						fontSize: isSmallView ? "var(--text-body-sm)" : "var(--text-body)",
						lineHeight: 1.6,
					}}
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
			 * The exchange, bounded HERE rather than by an ancestor: the composer band
			 * must carry no `max-height` and no `overflow` (the slash popup is an
			 * unportaled `absolute bottom-full` child of it), so the rule is that each
			 * growable part of the band caps itself — the shape the composer's own
			 * attachment strip and textarea already use.
			 */}
			<div className="flex max-h-[240px] flex-col gap-3 overflow-y-auto">
				{attachment.turns.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						Ask a side question in the composer below — it is answered here.
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
