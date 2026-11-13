import { rowCurrent } from "@features/chat/components/chat-sidebar";
/**
 * "Proposed new": pending proposals to CREATE an agent or team, listed under the
 * roster, and the pane that reviews one when its name is opened.
 *
 * ## Why it exists
 *
 * Review round 1 (F4 / U-F4, MAJOR): a create proposal counted toward the Agents
 * nav badge, but the review panel only rendered inside an EXISTING record's
 * pane, so a proposal for a name that does not exist yet had nowhere to be seen
 * and could never be accepted or rejected. These rows give it a place in the
 * same list the badge leads to, and `ProposedNewPane` stands in for the missing
 * record with the very same `ProfileProposalPanel` (Accept / Edit & accept /
 * Reject, backup and audit all on core's side).
 *
 * ## Constraints
 *
 * - The route stays the ordinary record route (`?name=`, `?kind=team&name=`,
 *   optional `&proposal=`), so `proposalReviewPath` deep links and a reload
 *   land here too. Once Accept creates the record, the accept hook invalidates
 *   the profile/team list and detail reads, the detail read succeeds and the
 *   page swaps this pane for the real editor (whose own panel still shows the
 *   decided proposal by `?proposal=`).
 * - Capability-gated by the caller: without `profile_proposals` nothing renders
 *   and no proposal request is sent.
 */
import { useProfileProposals } from "@shared/api/local-operator/profile-proposal-hooks";
import { proposedNewProfiles } from "@shared/api/local-operator/profile-proposals";
import { cn } from "@shared/lib/utils";
import { t } from "../../../../../i18n/messages";
import { ProfileProposalPanel } from "./profile-proposal-panel";

export function ProposedNewGroup({
	kind,
	existing,
	selected,
	enabled,
	onOpen,
}: {
	kind: "agent" | "team";
	/** Names the roster lists; a proposal for one of them is not "new". */
	existing: readonly string[];
	selected: string | null;
	enabled: boolean;
	onOpen: (name: string) => void;
}) {
	const list = useProfileProposals(enabled);
	if (!enabled) return null;
	const proposals = proposedNewProfiles(list.data, kind, existing);
	if (!proposals.length) return null;
	return (
		<section
			data-testid="proposed-new-profiles"
			aria-labelledby={`proposed-new-${kind}`}
			className="mt-3 space-y-0.5"
		>
			<h2
				id={`proposed-new-${kind}`}
				className="px-2 pb-1 text-ink-muted text-meta"
			>
				{t("ui.agents.proposals.new_group")}
			</h2>
			<ul className="space-y-0.5">
				{proposals.map((proposal) => (
					<li key={proposal.name}>
						<button
							type="button"
							data-testid={`proposed-new-row-${proposal.name}`}
							aria-current={proposal.name === selected ? "true" : undefined}
							onClick={() => onOpen(proposal.name)}
							className={cn(
								"flex min-h-12 w-full flex-col items-start gap-0.5 rounded-md px-2 py-1.5 text-start hover:bg-row-hover",
								proposal.name === selected && rowCurrent,
							)}
						>
							<span className="flex w-full items-center gap-2">
								<span className="min-w-0 truncate text-body-sm text-ink">
									{proposal.name}
								</span>
								<span
									aria-hidden="true"
									className="ml-auto size-1.5 shrink-0 rounded-full bg-warning"
								/>
							</span>
							<span className="text-ink-muted text-meta">
								{t("ui.agents.proposals.new_row")}
							</span>
						</button>
					</li>
				))}
			</ul>
		</section>
	);
}

/** True when `name` is a pending create proposal the roster does not list. */
export function useIsProposedNew(
	kind: "agent" | "team",
	name: string | null,
	existing: readonly string[] | undefined,
	enabled: boolean,
): boolean {
	const list = useProfileProposals(enabled);
	if (!enabled || !name || !existing) return false;
	return proposedNewProfiles(list.data, kind, existing).some(
		(proposal) => proposal.name === name,
	);
}

export function ProposedNewPane({
	kind,
	name,
	proposalId,
}: {
	kind: "agent" | "team";
	name: string;
	proposalId: string | null;
}) {
	return (
		<div data-testid="proposed-new-pane" className="space-y-4">
			<h2 className="text-heading">{name}</h2>
			<ProfileProposalPanel
				key={`proposal:${kind}:${name}`}
				kind={kind}
				name={name}
				enabled
				proposalId={proposalId}
			/>
		</div>
	);
}
