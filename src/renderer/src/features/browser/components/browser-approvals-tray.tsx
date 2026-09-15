import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { ChevronDown, ChevronUp } from "lucide-react";
import type { FC } from "react";
import type { ApprovalRow, ResolvedRow } from "../model/approval-queue-model";
import {
	BrowserConsentRequest,
	type ConsentDecision,
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

	return (
		<div className="flex flex-col gap-2" data-tour-tag="browser-approvals-tray">
			{rows.length > 1 && (
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
										aria-current={current}
										aria-label={`Request ${row.ordinal}: ${row.request.authority}`}
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
			{selected && (
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
