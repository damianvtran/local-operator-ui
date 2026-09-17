import { Badge, Tooltip } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Globe, RotateCw } from "lucide-react";
import { type FC, memo } from "react";
import type { ConversationBrowserSummary } from "../model/tab-index-model";

export interface BrowserConversationMarkProps {
	/** The conversation this mark belongs to. It is the id the press passes on, and the
	 * one the projection keys these counts by. */
	sessionId: string;
	/** The conversation's own name, for the one label that has to say "which one". */
	name: string;
	summary: ConversationBrowserSummary;
	/** Whether the conversation's row is the CURRENT one. It decides whether the mark
	 * may paint its own hover step: a child's `hover:bg-elevated` covers a parent's
	 * ground, so on the selected row the mark would replace the selection ground with
	 * the hover step — the collision design R2 names for the row's pair (review round
	 * 1, A7: the sidebar comment claimed this behaviour and the code did not do it).
	 * Defaults to `false`, which is the resting case every story renders. */
	current?: boolean;
	/** Whether the browser pane is OPEN ON THIS CONVERSATION right now — i.e. whether a
	 * press on this mark will CLOSE it rather than open it (design review round 2, U8).
	 *
	 * WHY IT IS A PROP AND NOT SOMETHING THIS COMPONENT READS: the only thing that knows
	 * is the pane's own lens, which lives in the UI-preferences store, and the sidebar's
	 * rows deliberately do not subscribe to it (see `browserMarkFor`'s note on the shared
	 * projection). The caller reads it once and hands it down, so the mark stays a
	 * presentational control and a story can photograph either state.
	 *
	 * It is the SAME expression the press's own handler branches on
	 * (`chat-page.tsx`'s `openConversationBrowser`): open AND scoped to the conversation
	 * AND that conversation current. A pane left on `All tabs` is not "open here" in the
	 * sense either the press or this attribute means, so it is NOT expanded. */
	expanded?: boolean;
	onOpen: (sessionId: string) => void;
}

/**
 * A conversation's browser state, on its own row (design R2).
 *
 * WHY THIS EXISTS AT ALL: a tab belongs to a conversation, and until this mark the ONLY
 * place that fact was visible was inside the browser — the pane's scope list and the
 * strip's group labels. So a user could not answer "does this conversation have anything
 * open, and is it asking me something" without opening the browser on each one in turn,
 * which is exactly backwards: the sidebar is where the operator chooses between
 * conversations.
 *
 * WHAT IT IS NOT. It is not a tab list and not a second Approvals control. It carries
 * three facts, and the design's §6 rules name the surface each belongs to: the tab count
 * (`Globe` + n), liveness (`RotateCw`, spinning, only while a tab is loading), and the
 * approvals badge, which is the same `Badge variant="attention" shape="pill"` the header
 * carries. `failedCount` is deliberately NOT drawn: a failed load is a fact about a tab,
 * and its home is the tab (the strip's `Failed` chip, the failure panel, the dock) — a
 * red count on a sidebar row would say "something is wrong somewhere" and name neither
 * the tab nor the reason.
 *
 * IT IS DRAWN IN ITS NO-TABS STATE TOO (design R2's state table, row 1; review round 1,
 * D2/A4). The earlier rule — draw nothing for a conversation with no tabs and no waiting
 * request — put the entry point on the rows that least needed it: the operator's ask is a
 * corner control on EACH conversation, because the empty case is exactly when a user
 * wants to open a browser there (the pane then offers `New tab in this conversation`). So
 * this component always draws something; the shape of the quietest state is the dim
 * `Globe`, and the CALLER decides whether the browser exists at all (`browserSummaries`
 * absent = no bridge = no projection = no mark, ruling 5(a)).
 *
 * WHY THE BADGE IS A BADGE AND NOT `· 2 approvals` TEXT ON THE ROW. The row is the
 * densest list in the app and every addition costs a title its width. The one state that
 * needs the user's ATTENTION gets the one treatment this app reserves for attention, and
 * the count is bounded the same way the header's is (`9+`), because the badge is
 * right-anchored and three digits would walk back over the glyph.
 *
 * WHY IT IS `memo` AND WHY THE SUMMARY IDENTITY MATTERS: `summariseConversations` reuses
 * an unchanged conversation's entry object (see its own note), and this component is
 * memoized on that object, so an event that only touched one conversation's tabs does not
 * re-render the other thirty-nine marks. Without the memo the identity reuse would buy
 * nothing, which is why the two are one decision.
 *
 * NOT RENDERED OUTSIDE THE BROWSER'S HOST (ruling 5(a)): the mark is not drawn when the
 * browser is unavailable, and that falls out of the projection rather than out of a branch
 * here — no bridge means no projection means no summary, and the caller draws nothing. A
 * mark that could not open anything would be an affordance that lies.
 */
export const BrowserConversationMark: FC<BrowserConversationMarkProps> = memo(
	({ sessionId, name, summary, current = false, expanded = false, onOpen }) => {
		const approvals = summary.pendingApprovals;
		const tabs = summary.tabCount;
		/** ONE sentence per state, so the tooltip and the accessible name cannot drift, and
		 * so the words name the action the press will actually take. */
		const label = markLabel(name, summary, expanded);
		/** NOTHING TO SAY: the design's quietest state, and the one that has to exist for
		 * the mark to be an entry point on every row (D2/A4). */
		const quiet = tabs === 0 && approvals === 0;
		/** The badge's own grammar, the same cap the header's badge uses: the value is
		 * bounded so the mark cannot grow, and the exact number stays in the label and the
		 * tooltip, which are read rather than glanced at. */
		const badgeText = approvals > 9 ? "9+" : String(approvals);
		return (
			<Tooltip content={label} side="top">
				<button
					type="button"
					onClick={() => onOpen(sessionId)}
					aria-label={label}
					/*
					 * THE TOGGLE'S OWN STATE (design review round 2, U8): this control does two
					 * opposite things, and in the state where the press closes, the copy names the
					 * close and the state says so too. `aria-expanded` rather than `aria-pressed`
					 * because the thing it governs is a DISCLOSURE — a pane that is revealed or
					 * hidden — not a setting being toggled on and off.
					 */
					aria-expanded={expanded}
					/*
					 * NO `data-chat-row` HERE (and that is a hard rule, not a style choice):
					 * three committed harnesses select rows on `[data-chat-row]` —
					 * `scripts/session-switch.tsx`, `scripts/session-switch-latency.mjs` and
					 * `docs/evidence/chat-sidebar-selection/harness/drive.mjs` — and the
					 * arrow-key traversal walks the same attribute. A second element carrying
					 * it inside one row is a row counted twice.
					 *
					 * THE GROUND IS THE ROW'S, NOT THE MARK'S: it is a 24px control inside a
					 * row that already paints its own current-state ground, so the mark takes
					 * the hover step alone and never a fill of its own. A control that painted
					 * the selection would be the "ground plus text for one state" doubling
					 * `docs/branding.md` § 2 rules out.
					 */
					className={cn(
						"relative flex size-6 shrink-0 items-center justify-center gap-0.5 rounded-md",
						/*
						 * THE STATE'S OWN INK, THEN THE HOVER STEP — but not on the selected row.
						 * `hover:bg-elevated` beats the wrapper's `bg-highlight`, so on the current
						 * row hovering the mark repainted the row's selection ground and the
						 * sidebar comment claiming it "drops its hover fill while the row is
						 * current" was describing behaviour that did not exist (review round 1,
						 * A7). Now the two agree: the current row keeps its own ground, and
						 * `current` is read from the same expression that paints it.
						 */
						quiet ? "text-ink-dim" : "text-ink-muted",
						/*
						 * THE EXPANDED STEP IS INK, NOT A FILL (design review round 2, U8). A second
						 * press on this mark closes the pane, and before this it left the row — and the
						 * control in it — looking exactly as it had one press earlier, which is
						 * indistinguishable from a press that did not register. The step is the
						 * app's own vocabulary for a state on a control that has no ground of its
						 * own: it is the top of the same ink ramp the quiet state starts at
						 * (`ink-dim` -> `ink-muted` -> `ink`), never a fill (this is a 24px control
						 * inside a row that paints its own ground, and a fill here would be the
						 * "ground plus text for one state" doubling branding.md section 2 rules
						 * out), and never opacity.
						 */
						expanded && "text-ink",
						!current && "hover:bg-elevated hover:text-ink",
						"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
					)}
					data-tour-tag="chat-session-browser"
					data-browser-mark={sessionId}
				>
					{/*
					 * THE GLYPH SWAPS RATHER THAN ADDING A FOURTH MARK: a loading tab is the
					 * same fact as "there is something open here", in its live state, so it
					 * takes the same slot. `animate-spin` is the app's existing motion for a
					 * working control (`Spinner` uses it) and nothing here translates or
					 * scales, which § Motion rules out.
					 */}
					{summary.loadingCount > 0 ? (
						<RotateCw
							aria-hidden={true}
							className={cn("size-3.5 animate-spin")}
						/>
					) : (
						<Globe aria-hidden={true} className={cn("size-3.5")} />
					)}
					{/* The count is drawn as soon as there is anything to count. It is NOT
					    conditional on the mark being revealed: the label states it in every
					    state, so drawing it for sighted users too is the same fact through the
					    other channel rather than a second one. */}
					{tabs > 0 && <span className="text-meta tabular-nums">{tabs}</span>}
					{approvals > 0 && (
						<span className="pointer-events-none absolute -top-0.5 -right-0.5">
							<Badge
								variant="attention"
								shape="pill"
								className={cn(
									// THE RING IS WHAT MAKES IT A BADGE RATHER THAN A PILL (review
									// round 1, D4): the header's identical badge carries
									// `ring-2 ring-canvas` (`chat-header.tsx`), and the ring is there to
									// separate a badge that overlaps a control from that control's own
									// glyph. Without it the mark's badge walks over the Globe it is
									// anchored to, and at 24px `∘9+` reads as a pill with a number
									// rather than as a badge on a corner.
									"h-3.5 min-w-3.5 justify-center px-0.5 tabular-nums ring-2 ring-canvas",
								)}
								data-tour-tag="chat-session-browser-badge"
							>
								{badgeText}
							</Badge>
						</span>
					)}
				</button>
			</Tooltip>
		);
	},
);
BrowserConversationMark.displayName = "BrowserConversationMark";

/**
 * The mark's one sentence, in every state.
 *
 * ONE FUNCTION, so the tooltip and the accessible name cannot drift: the row's own
 * `title` deliberately says nothing about the browser, and two channels saying the same
 * fact twice is the mistake round 4 (R23) of the search mark's copy fixed. So the words
 * live here and are read by BOTH `aria-label` and the tooltip's content — which is the
 * reverse of the rule the row follows, and for the same reason: the mark has no visible
 * text of its own beyond a number, so it needs one channel that says everything.
 *
 * THE VERB FOLLOWS THE STATE (design review round 2, U8; the toggle itself is round 2's
 * U6, ruled). A press while the pane is already open ON THIS conversation closes it, so
 * "Open the browser for …" was the wrong tense on screen and in the accessibility tree
 * for exactly the press that closes. The detail half is unchanged in both states: the
 * counts are a fact about the conversation, not about the pane.
 */
function markLabel(
	name: string,
	summary: ConversationBrowserSummary,
	expanded = false,
): string {
	const parts: string[] = [];
	if (summary.tabCount > 0) {
		parts.push(
			`${summary.tabCount} ${summary.tabCount === 1 ? "tab" : "tabs"}`,
		);
		if (summary.loadingCount > 0) parts.push("loading");
	}
	if (summary.pendingApprovals > 0) {
		parts.push(
			`${summary.pendingApprovals} ${summary.pendingApprovals === 1 ? "approval" : "approvals"} waiting`,
		);
	}
	const detail = parts.length > 0 ? ` — ${parts.join(", ")}` : "";
	return `${expanded ? "Close" : "Open"} the browser for "${name}"${detail}`;
}
