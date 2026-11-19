import { useMembershipsQuery } from "@features/agent-hub/hooks/use-memberships-query";
import type { HubLink } from "@shared/api/local-operator/hub-links";
import { useObservedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { t } from "@shared/i18n";

/**
 * The destination as a noun phrase a SENTENCE can carry ("Acme private hub",
 * "Public hub"), or `null` when it cannot be named.
 *
 * WHY a second resolver beside `hubLinkSourceName`: that one is a list label
 * ("Acme · Private") and falls back to the literal "Source unavailable", which
 * the sidebar policy popover then spliced into every sentence ("Receive updates
 * from Source unavailable"). Here an unknown source is `null`, so a caller
 * picks a sentence written WITHOUT a source instead of interpolating a
 * placeholder.
 *
 * Persisted tenant_name is never membership authority. Only a currently
 * authorized active membership can name this private destination; use that
 * membership's current name rather than leaking an old account's cached label.
 */
export function hubLinkSourceLabel(
	link: Pick<HubLink, "visibility" | "tenant_id" | "tenant_name">,
	memberships: readonly {
		tenant_id: string;
		tenant_name: string;
		status: string;
	}[] = [],
): string | null {
	if (link.visibility === "public")
		return t("ui.hub.links.source_label_public");
	const organization = memberships.find(
		(row) => row.tenant_id === link.tenant_id && row.status === "active",
	)?.tenant_name;
	return organization
		? t("ui.hub.links.source_label_org", { organization })
		: null;
}

/** Private display metadata must follow the same authority epoch as its read. */
export function useHubLinkSource(link: HubLink, enabled = true) {
	const { isAuthenticated } = useRadientAuth();
	const { accountId } = useObservedRadientAuthority();
	const mayReadMemberships = isAuthenticated && Boolean(accountId);
	const memberships = useMembershipsQuery({
		enabled: enabled && link.visibility === "org" && mayReadMemberships,
	});
	// Disabled queries may retain data, and account transitions precede the
	// user query committing its replacement. Check BOTH admission and query state.
	const authorized =
		mayReadMemberships &&
		memberships.isSuccess &&
		!memberships.isFetching &&
		!memberships.isPlaceholderData
			? memberships.memberships
			: [];
	const organization = authorized.find(
		(row) => row.tenant_id === link.tenant_id && row.status === "active",
	)?.tenant_name;
	return {
		source: hubLinkSourceLabel(link, authorized),
		organization,
		memberships,
		mayReadMemberships,
	};
}
