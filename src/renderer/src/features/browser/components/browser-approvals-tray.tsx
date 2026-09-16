import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FC } from "react";
import type { ApprovalRow, ResolvedRow } from "../model/approval-queue-model";
import {
	BrowserConsentRequest,
	type ConsentDecision,
	requesterLabel,
} from "./browser-consent-request";

/**
 * The approvals tray: the whole live queue, in the band.
 * Design: docs/design/browser-approval-ux.md 4.1 (the tray), 4.3 (what it
 * replaces), 5.2 (the ordinal), 3.4 (the two resolved states).
 *
 * THE BAND IS THE INTERACTIVE SURFACE; THE CONTENT AREA BELONGS TO THE PAGE. The
 * band renders outside the native view's rectangle, so a prompt, a count and a
 * tab's actions are never occluded — and the list the user reads beside the page
 * is a dock that NARROWS the content rectangle instead of covering it (§2). That
 * is why the count and the numbered chips live here and not in a popover: a
 * popover anchored to the badge would paint over the content area, and a native
 * view occludes DOM, so it would be invisible or would hide the page.
 *
 * WHY A HEADER ROW THAT SOMETIMES IS NOT THERE. One pending request is the
 * common case, and it has nothing to disambiguate: the tray then renders the card
 * alone, which is the band the user already knows. The header appears when there
 * are two or more — the moment "which one am I answering" becomes a real question
 * — and carries the count, one numbered chip per live request, and the way into
 * the dock. The chips SELECT; they never navigate the page.
 *
 * WHY THE ORDINAL IS A POSITION AND NOT AN IDENTITY (§3.3). `index + 1` over the
 * live FIFO list, computed once in `approval-queue-model.ts` so the tray, the
 * dock, the tab chip and any story agree by construction. Answering request 1
 * renumbers the rest, exactly as a numbered list does; a stable id shown to the
 * user would be monotonic for the life of the process, so a single outstanding
 * request would read "request 47".
 */

export interface BrowserApprovalsTrayProps {
	/** The live requests, already scoped by the host that mounted the tray. */
	rows: ApprovalRow[];
	/** Requests the user was watching that are gone (expired / withdrawn, §3.4). */
	resolved: ResolvedRow[];
	/** Which entry's card is expanded. The surface owns this selection, defaulting
	 * to the attention entry and then to the oldest — there is deliberately no
	 * second queue state in this component (§4.1). */
	selectedEntryId: string | null;
	onSelect: (entryId: string) => void;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
	/** Whether the dock is open, so the toggle says what its click will do. */
	dockOpen: boolean;
	onToggleDock: () => void;
	/**
	 * The header's wording, as a PROP, because the wording is a fact about the
	 * host's scope: the route counts every request, and PR 2's conversation pane
	 * counts only the requests that conversation's agent raised and has to say so
	 * ("2 approvals for this conversation"). A component that computed the sentence
	 * itself could only ever say the route's version.
	 */
	headerLabel: (count: number) => string;
}

/** What a request that left the queue reads as. Non-interactive, because there
 * is nothing left to decide — and no durable record, because an expired request
 * is neither a grant nor a denial (§3.4). */
const RESOLVED_COPY: Record<ResolvedRow["kind"], string> = {
	expired: "Expired — the agent has to ask again",
	withdrawn: "Withdrawn by the agent",
};

/** The header's wording for the ALL-TABS scope, which is the route's own: the
 * count is every live request. Exported so the pane in PR 2 has a stated default
 * to differ from, and so the copy is asserted by a test rather than only by a
 * frame (spec §5.2's "one number in three places" is a copy contract too). */
export const defaultApprovalHeaderLabel = (count: number): string =>
	count === 1 ? "1 approval waiting" : `${count} approvals waiting`;

/**
 * The header's wording for a CONVERSATION's scope, which the pane passes when it
 * is scoped to one session (spec 7.2).
 *
 * The pane's tray carries a second fact the route's does not have to state, and it
 * is why the sentence is not just a smaller number: the scope switch chooses which
 * TABS are listed and never which demands are, so this count is this
 * conversation's requests even while the strip is showing All tabs — and a bare
 * "2 approvals waiting" beside a strip full of other conversations' tabs would
 * read as a count of everything on screen.
 *
 * It is exported beside the default so the two sentences are written in one place
 * and can be asserted together: a reviewer reading only the pane would have no way
 * to tell that the route's copy is deliberately the shorter one.
 */
export const paneApprovalHeaderLabel = (count: number): string =>
	count === 1
		? "1 approval for this conversation"
		: `${count} approvals for this conversation`;

export const BrowserApprovalsTray: FC<BrowserApprovalsTrayProps> = ({
	rows,
	resolved,
	selectedEntryId,
	onSelect,
	busy,
	onDecide,
	dockOpen,
	onToggleDock,
	headerLabel,
}) => {
	const selected =
		rows.find((row) => row.request.entryId === selectedEntryId) ?? rows[0];
	/** The session list, so a chip can name the asking conversation and not just the
	 * site (UX round 1, U2): two requests for one site are ordinary, and the ordinal
	 * alone made the two chips and the two dock rows byte-identical. */
	const sessions = useCanonicalSessionsStore((state) => state.sessions);
	/**
	 * THE HEADER ROW'S VISIBILITY, and the two cases it answers.
	 *
	 * It renders when there IS a queue to disambiguate (`rows.length > 1`), and it
	 * keeps rendering while the dock it opens is open — a control that vanished the
	 * moment the user answered one request took away the way back to the thing they
	 * were looking at (UX round 1, U6). One pending request with the dock closed is
	 * still the band the user already knows: no count, no chips.
	 */
	const showHeaderRow = rows.length > 1 || dockOpen;

	return (
		<div className="flex flex-col gap-2" data-tour-tag="browser-approvals-tray">
			{showHeaderRow && (
				<div className="flex flex-wrap items-center gap-2">
					<p
						className="text-body-sm text-ink"
						data-tour-tag="browser-approvals-tray-count"
					>
						{headerLabel(rows.length)}
					</p>
					<ol
						className="flex items-center gap-1"
						aria-label="Waiting requests"
						data-tour-tag="browser-approvals-tray-chips"
					>
						{rows.map((row) => {
							const current = row.request.entryId === selected?.request.entryId;
							return (
								<li key={row.request.entryId}>
									{/* A chip is a control, so it carries its own edge: the same
									    `border-control` the badge uses, with the waiting wash for the
									    selected one. Sentence case is not at stake in a numeral, and
									    `tabular-nums` keeps the row from twitching as numbers change. */}
									<button
										type="button"
										onClick={() => onSelect(row.request.entryId)}
										aria-current={current ? "true" : undefined}
										aria-label={`Request ${row.ordinal} from ${requesterLabel(row.request.requesterSessionId, sessions)}: ${row.request.authority}`}
										data-tour-tag="browser-approvals-tray-chip"
										className={cn(
											"flex h-5 min-w-5 items-center justify-center rounded-full border border-control px-1 text-meta tabular-nums",
											current
												? "bg-warning-wash text-ink"
												: "bg-transparent text-ink-muted hover:bg-elevated hover:text-ink",
										)}
									>
										{row.ordinal}
									</button>
								</li>
							);
						})}
					</ol>
					<div className="grow" />
					<Button
						variant="ghost"
						size="sm"
						onClick={onToggleDock}
						aria-expanded={dockOpen}
						data-tour-tag="browser-approvals-toggle"
					>
						{dockOpen ? "Close approvals" : "Open approvals"}
						{dockOpen ? (
							<ChevronUp aria-hidden className="size-3.5" />
						) : (
							<ChevronDown aria-hidden className="size-3.5" />
						)}
					</Button>
				</div>
			)}
			{selected && !dockOpen && (
				// ONE CARD AT A TIME (design round 2, D9; UX round 1, U8). With the dock
				// open, both surfaces rendered the SAME request in full — same sentence,
				// same five scopes, two copies of `Allow once … Don't allow` on screen at
				// once and the same five controls twice in one tab order. The dock is the
				// surface with the room for it, so the band keeps the count and the chips
				// that select it.
				<BrowserConsentRequest
					request={selected.request}
					remaining={selected.remaining}
					busy={busy}
					onDecide={onDecide}
				/>
			)}
			{resolved.length > 0 && (
				// The answer to "why did the count change", from the renderer's own
				// memory of the last projection rather than a new main-side field (§3.4).
				<ul
					className="flex flex-col gap-0.5 text-meta text-ink-dim"
					data-tour-tag="browser-approvals-resolved"
				>
					{resolved.map((row) => (
						<li key={row.key}>
							{row.authority} — {RESOLVED_COPY[row.kind]}
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
