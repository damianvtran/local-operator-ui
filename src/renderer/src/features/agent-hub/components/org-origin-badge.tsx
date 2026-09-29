import { Badge } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Users } from "lucide-react";
import type React from "react";

/**
 * The org origin badge: this row came from an organization, not the public hub
 * (design §8.4).
 *
 * It exists because the SCOPE is not enough on its own. The same card renders on
 * the public hub and inside an org's workspace, and the details page is reached
 * by URL — with no badge, a reader who followed a link has no way to tell a
 * colleague's org agent from the hub's public one, and the affordances the page
 * hides (`agent-details-page` hides like/favourite/comment for org rows) would
 * look like something was missing rather than something that does not apply.
 *
 * ## Why the org's NAME when we have it, and "Organization" when we do not
 *
 * The name comes from `memberships.list`, which the surfaces that render this
 * badge already hold — the hub page for its scope selector, the details page for
 * the same list. It is the more useful of the two readings (an agent that came
 * from "Minerva" says which organization, not merely that one exists), but it is
 * OPTIONAL because the memberships read can be unavailable or a viewer can hold
 * no membership while still being able to read a row they were given a link to.
 * A badge that vanished in that case would be worse than a badge that says less:
 * the row is still org-private, and that is the fact the badge carries.
 *
 * `variant="neutral"`: a badge is a static label, and the accent is spent on the
 * primary action, the active state and the focus ring (docs/branding.md § 2). A
 * third wash family here would compete with the semantic badges the same row can
 * carry.
 */
export const OrgOriginBadge: React.FC<{
	orgName?: string | null;
	className?: string;
}> = ({ orgName, className }) => (
	<Badge
		variant="neutral"
		className={cn("gap-1", className)}
		data-testid="agent-org-badge"
		/*
		 * A title rather than a Tooltip: this badge sits inside the card's own
		 * "open details" button, and a tooltip on a nested element inside a button
		 * is a second interactive affordance inside the first. The title carries the
		 * same sentence to a pointer reader, and the label itself carries it to
		 * everyone.
		 */
		title={
			orgName
				? `Shared with ${orgName}, not the public hub`
				: "Shared with an organization, not the public hub"
		}
	>
		<Users aria-hidden="true" />
		{orgName ?? "Organization"}
	</Badge>
);
