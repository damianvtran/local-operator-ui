import type { FC } from "react";
import type { ApprovalRow, ResolvedRow } from "../model/approval-queue-model";
import { BrowserApprovalsTray } from "./browser-approvals-tray";
import type { ConsentDecision } from "./browser-consent-request";

/**
 * The consent band: the strip of chrome that appears without the user's action.
 * Design: docs/design/ui-browser-tab.md 9.2 (where it renders and why), 9.5 (the
 * honest default, and what must NOT be implied), 11.3 (never over the page area);
 * docs/design/browser-approval-ux.md 4.1 (the tray), 4.3 (the band is the
 * notification, the dock is the archive of it).
 *
 * WHY IT IS IN THE BAND AND NOT A MODAL. A modal over the page area would be
 * INVISIBLE, because a native view paints above all DOM; and a modal reproduces
 * exactly the failure the async approval flow was built to remove — the agent gets
 * no turn to tell the user, and prompts expire unseen. The band is outside the
 * view's rect, so it is the one place in this feature where a prompt is reliably
 * visible.
 *
 * WHAT THIS COMPONENT IS NOW, and what it still is. It used to own the request
 * card; the card moved to `browser-consent-request.tsx` so the dock's expanded row
 * and this band render the same question from one implementation (spec 4.3). What
 * is left here is the band's own framing — its ground, its edge, its accessible
 * name — plus the tray, which is the queue: the count, the numbered chips, and the
 * selected request's card. THERE IS NO STATE IN WHICH A REQUEST EXISTS AND THE
 * BAND IS SILENT: the band is the notification, and the dock is where the list is
 * read.
 *
 * THE GROUND IS `surface` RATHER THAN A WASH, and that is a measured choice kept
 * from the previous version: the band's content is `ink` and `ink-muted` on it, and
 * those pairs are asserted by the theme contract on every ground. A wash ground
 * would put two new pairs (`ink` on `warningWash`, `border-control` on
 * `warningWash`) into the UI that no palette assertion covers. The urgency is
 * carried by the icon and the words instead — a colour is not the only way to say
 * "act on this".
 */

export interface BrowserConsentBarProps {
	rows: ApprovalRow[];
	resolved: ResolvedRow[];
	selectedEntryId: string | null;
	onSelect: (entryId: string) => void;
	busy: boolean;
	onDecide: (entryId: string, decision: ConsentDecision) => void;
	dockOpen: boolean;
	onToggleDock: () => void;
	headerLabel: (count: number) => string;
}

export const BrowserConsentBar: FC<BrowserConsentBarProps> = (props) => {
	return (
		<section
			// A control boundary, so `border-control` and not `hairline` (design 11.2):
			// this band's edge is what separates "an agent is asking" from the page's
			// chrome below it, so it is structural and carries the 3:1 floor.
			className="flex flex-col gap-2 border-control border-b bg-surface px-3 py-2"
			aria-label="Site approval request"
			data-tour-tag="browser-consent-bar"
		>
			<BrowserApprovalsTray
				rows={props.rows}
				resolved={props.resolved}
				selectedEntryId={props.selectedEntryId}
				onSelect={props.onSelect}
				busy={props.busy}
				onDecide={props.onDecide}
				dockOpen={props.dockOpen}
				onToggleDock={props.onToggleDock}
				headerLabel={props.headerLabel}
			/>
		</section>
	);
};
