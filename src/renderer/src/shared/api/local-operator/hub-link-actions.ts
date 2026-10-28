import { t } from "@shared/i18n";
import { showSuccessToast } from "@shared/utils/toast-manager";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { desktopResult } from "./desktop-api";
import { useHubActionStore } from "./hub-action-store";
import { hubLinksKey } from "./hub-link-hooks";
import type {
	HubLink,
	HubLinkDirection,
	HubLinkKind,
	HubLinks,
	HubSourceResolution,
} from "./hub-links";
import { guardHubMutation, useHubMutationSafety } from "./hub-mutation-safety";
import type { HubMergeReport, HubUpdates } from "./hub-updates";

/** Core-owned wrapper binds the exact reviewed server projection, not raw pins. */
export type HubPushPreview = {
	preview_receipt: string;
	link_id: string;
	direction: "push";
	hub_source: string;
	visibility: "public" | "org";
	tenant_id: string | null;
	local_fingerprint: string;
	expected_policy_revision: string;
	expected_remote_revision: string;
	proposal_fingerprint: string;
	expires_at: string;
	proposal: { kind: HubLinkKind; fields: Record<string, unknown> };
	warnings: string[];
	can_confirm: boolean;
	reason: string | null;
};
export type HubPullPreview = Omit<
	HubPushPreview,
	"direction" | "expected_remote_revision"
> & {
	direction: "pull";
	expected_remote_revision: string | null;
	remote_fingerprint: string;
	choices: {
		prefer: "local" | "remote" | null;
		acknowledge_unknown_baseline: boolean;
		replace: "local" | "remote" | null;
		confirm_replace: boolean;
	};
};
export type HubDirectionalReport = Omit<HubMergeReport, "kind"> & {
	kind: HubLinkKind;
	link_id: string;
	direction: HubLinkDirection;
	operation_id: string | null;
	remote_revision: string | null;
	model_used: string | null;
};
export type HubLinkActionResponse = {
	/**
	 * Directional on `apply`/`push`/`retry`; a CHECK answers per-ITEM rows.
	 *
	 * Core's check route reports through `ItemMergeReport.to_json()`
	 * (`local_operator/hub_sync/report.py`), which carries `kind`/`local_id`/
	 * `name`/`hub_id` and no `link_id` or `direction` - only the directional
	 * routes enrich a report from the link identity. Reads that need the link
	 * address go through `isDirectionalReport`.
	 */
	reports: HubMergeReport[];
	status: HubUpdates;
	/**
	 * Absent from a check answer: core's `/updates/check` returns `reports` and
	 * `status` alone (the directional routes read the inventory themselves and
	 * echo it). Optional so the type states that absence instead of promising a
	 * member a check never sends - a reader that needs the inventory must go
	 * through `hubLinksKey`, not through this response.
	 */
	links?: HubLinks;
	preview?: HubPullPreview | HubPushPreview | null;
	/**
	 * Present only on an explicit source confirmation (the `resolve` action): the
	 * real link the service materialized plus the scope it recorded. Absent on
	 * every ordinary apply/check/retry, so a caller cannot read a resolution off a
	 * run that did not make one.
	 */
	link?: HubLink;
	resolved?: HubSourceResolution;
};
/** A report from the directional routes, addressed by the link that produced it. */
export const isDirectionalReport = (
	report: HubMergeReport,
): report is HubDirectionalReport => "link_id" in report;

/**
 * HOW ONE HUB ITEM IS ADDRESSED ON THE WIRE.
 *
 * `local_id` is the exact arm: core's routes narrow through
 * `check_items(only_ids=...)`, so an id reaches exactly one row of one kind.
 * It arrived with core's `hub_items_by_id` capability, and an OLDER core refuses
 * the field outright (`Input` is `extra="forbid"`, so a body carrying it is a
 * 422) - hence the capability gate at the call site and the name fallback here.
 *
 * `name` is the released arm and it is a DISPLAY name: for a skill that is the
 * local alias (unique, it is a directory), but for an agent or a team a display
 * name is NOT an identity - the registry refuses only an exact duplicate on
 * create and checks nothing on rename, so two linked agents can share one and
 * core would act on both. On an old core the name arm is therefore best-effort
 * for agents and teams; it is the only address those cores have.
 */
export type HubItemAddress = {
	kind: HubLinkKind;
	name?: string;
	localId?: string;
};

export function hubItemAddress(
	link: Pick<HubLink, "kind" | "local_id" | "name">,
	displayName: string | undefined,
	itemsById: boolean,
): HubItemAddress {
	if (itemsById) return { kind: link.kind, localId: link.local_id };
	return {
		kind: link.kind,
		name: displayName?.trim() ? displayName : link.name,
	};
}

export type HubLinkAction =
	| { action: "check"; linkId: string }
	| {
			action: "apply";
			linkId: string;
			preview?: boolean;
			prefer?: "local" | "remote";
			acknowledgeUnknownBaseline?: boolean;
	  }
	| { action: "retry"; linkId: string; direction: HubLinkDirection }
	| { action: "preview"; linkId: string }
	| { action: "confirm"; linkId: string; previewReceipt: string };

/**
 * Every intentional press gets a receipt ID; transport replay keeps that same
 * request. Only the PUSH confirmation carries a receipt: it sends the immutable
 * proposal receipt the user just viewed and acknowledged. Check, apply and retry
 * are item-addressed writes (`kind` + `name`/`local_id`) and core recomputes
 * their merge when the request lands - there is no pull receipt to send.
 */
export function useHubLinkActions(
	link: Pick<HubLink, "link_id" | "kind" | "local_id" | "name">,
	options: { displayName?: string; itemsById?: boolean } = {},
) {
	const client = useQueryClient();
	const address = hubItemAddress(
		link,
		options.displayName,
		options.itemsById === true,
	);
	const safety = useHubMutationSafety();
	const linkId = link.link_id;
	const key = `link:${linkId}`;
	const sharedPending = useHubActionStore((state) => state.pending.has(key));
	const mutation = useMutation({
		onMutate: (input: HubLinkAction) => {
			const store = useHubActionStore.getState();
			if (input.linkId !== linkId || store.pending.has(key))
				throw new Error("hub-action-busy");
			// Sidebar/detail are one pending operation, not two independently busy
			// hooks. This is UI serialization only; core still owns the writer lease.
			store.begin(key);
			return key;
		},
		mutationFn: (input: HubLinkAction) =>
			guardHubMutation(async () => {
				const requestId = crypto.randomUUID();
				switch (input.action) {
					case "check":
						/*
						 * ONE item, addressed by `kind` + (`local_id` | display name).
						 * The check route has no `link_id` member (core `HubCheck`,
						 * extra="forbid"), and it checks both directions of the item, so
						 * there is no direction to send either.
						 */
						return desktopResult<HubLinkActionResponse>({
							op: "hub.check",
							requestId,
							...address,
						});
					case "apply":
						return desktopResult<HubLinkActionResponse>({
							op: "hub.apply",
							requestId,
							...address,
							...(input.preview ? { dryRun: true } : {}),
							...(input.prefer ? { prefer: input.prefer } : {}),
							...(input.acknowledgeUnknownBaseline
								? { acknowledgeUnknownBaseline: true }
								: {}),
						});
					case "retry":
						return desktopResult<HubLinkActionResponse>({
							op: "hub.retry",
							requestId,
							...address,
						});
					case "preview":
						return desktopResult<HubLinkActionResponse>({
							op: "hub.push",
							requestId,
							linkId: input.linkId,
							direction: "push",
							dryRun: true,
						});
					case "confirm":
						return desktopResult<HubLinkActionResponse>({
							op: "hub.push",
							requestId,
							linkId: input.linkId,
							direction: "push",
							dryRun: false,
							previewReceipt: input.previewReceipt,
							confirmPublish: true,
						});
				}
			}, safety.snapshot),
		onSuccess: (response) => {
			// Only a directional answer carries the inventory it just re-read. A
			// check carries none, and `onSettled` refetches it, so there is nothing
			// to write (and nothing written is the type's promise, not a blank-panel
			// guard - TanStack treats `setQueryData(key, undefined)` as a no-op).
			if (response.links) client.setQueryData(hubLinksKey, response.links);
			client.setQueryData(["desktop", "hub-updates"], response.status);
			if (response.reports.some((report) => report.applied)) {
				for (const key of ["profiles", "teams", "skills"])
					void client.invalidateQueries({ queryKey: ["desktop", key] });
			}
		},
		onSettled: (_data, _error, _input, pendingKey) => {
			if (pendingKey) useHubActionStore.getState().end(pendingKey);
			void client.invalidateQueries({ queryKey: hubLinksKey });
		},
	});
	return {
		...mutation,
		...safety,
		isPending: mutation.isPending || sharedPending,
	};
}

/** The stated destination a source confirmation carries; never inferred. */
export type HubSourceResolutionInput = {
	/*
	 * The frozen resolve arm takes core's `Kind = Literal["agent", "team"]`
	 * (desktop_hub.py HubApply.kind): the source-confirmation act exists for a
	 * LEGACY unknown-origin link, and skills are new capability-gated rows that
	 * have no legacy identity-less predecessor. Typing this as the wider
	 * `HubLinkKind` let a `"skill"` flow into `hub.apply`, which the wire refuses.
	 */
	kind: "agent" | "team";
	localId: string;
	name: string;
	hubSource: string;
	visibility: "public" | "org";
	tenantId: string | null;
};

/**
 * Explicit source confirmation for a legacy unknown-origin row.
 *
 * SEPARATE from `useHubLinkActions`, and deliberately so: that hook is keyed by a
 * `link_id`, and the whole point of this act is that no link exists yet. The
 * destination is STATED by the caller (source + visibility + tenant) and never
 * inferred from the active organization or a display name; the service owns the
 * real identity computation and refuses a conflicting KNOWN scope with
 * `origin-conflict`, leaving the old state byte-unchanged. `kind`/`name` address
 * the LOCAL row by its immutable identity; `hubId` echoes the stored suggestion
 * so the caller cannot choose a different remote id.
 *
 * The mutation reuses the same shared pending store as the link actions, keyed by
 * the local row, so a sidebar/detail pair cannot fire two confirmations at once.
 */
export function useHubSourceResolution(onResolved?: () => void) {
	const client = useQueryClient();
	const safety = useHubMutationSafety();
	const mutation = useMutation({
		onMutate: (input: HubSourceResolutionInput) => {
			const key = `resolve:${input.kind}:${input.localId}`;
			const store = useHubActionStore.getState();
			if (store.pending.has(key)) throw new Error("hub-action-busy");
			store.begin(key);
			return key;
		},
		mutationFn: (input: HubSourceResolutionInput) =>
			guardHubMutation(
				() =>
					desktopResult<HubLinkActionResponse>({
						op: "hub.apply",
						requestId: crypto.randomUUID(),
						kind: input.kind,
						name: input.name,
						resolveSource: true,
						hubSource: input.hubSource,
						visibility: input.visibility,
						tenantId: input.tenantId,
						acknowledgeUnknownBaseline: true,
					}),
				safety.snapshot,
			),
		onSuccess: (response) => {
			// Hook-level mutation callbacks finish even when replacing the inventory
			// unmounts the diagnostic. A child effect cannot announce its own removal.
			showSuccessToast(t("ui.hub.links.resolve_action_done"));
			onResolved?.();
			// The resolve arm answers `{link, resolved}` and no inventory; the same
			// absent-member rule as the check arm above, so this cannot write a
			// member the route never sends.
			if (response.links) client.setQueryData(hubLinksKey, response.links);
			client.setQueryData(["desktop", "hub-updates"], response.status);
		},
		onSettled: (_data, _error, _input, pendingKey) => {
			if (pendingKey) useHubActionStore.getState().end(pendingKey);
			void client.invalidateQueries({ queryKey: hubLinksKey });
		},
	});
	return { ...mutation, ...safety };
}
