import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import {
	type DesktopCapabilities,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { HubDirectionalReport } from "@shared/api/local-operator/hub-link-actions";
import { hubLinksKey } from "@shared/api/local-operator/hub-link-hooks";
import type { HubLink, HubLinks } from "@shared/api/local-operator/hub-links";
import type {
	SkillPublicationDraft,
	SkillPublicationResult,
} from "@shared/api/local-operator/hub-publication";
import {
	getOrgSkill,
	getPublicSkill,
	hubSourceAddress,
	listOrgSkills,
	listPublicSkills,
} from "@shared/api/radient/skills-api";
import { apiConfig } from "@shared/config";
import {
	type QueryClient,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { retryPublicHubQuery } from "./use-public-teams-query";

export type HubSkillScope =
	| { visibility: "public"; tenantId: null; organization: null }
	| { visibility: "org"; tenantId: string; organization: string | null };

/** Recheck at dispatch, not only render time: a retained query/mutation callback
 * can outlive the mount or capability snapshot that originally enabled it. */
function requireSkillsAdapter(client: QueryClient) {
	if (
		client.getQueryState(desktopKeys.capabilities)?.status !== "success" ||
		!desktopFeatureEnabled(
			client.getQueryData<DesktopCapabilities>(desktopKeys.capabilities),
			"hub_skills",
		)
	) {
		throw new Error(
			"This backend does not support the complete Hub Skills adapter.",
		);
	}
}

/** Scope and API origin are part of each key. A private refusal never goes public. */
export function useRemoteSkills(
	scope: HubSkillScope,
	page: number,
	enabled: boolean,
) {
	const client = useQueryClient();
	const capabilities = useDesktopCapabilities();
	return useQuery({
		queryKey: [
			"hub-skills",
			apiConfig.radientBaseUrl,
			scope.visibility,
			scope.tenantId,
			page,
		],
		enabled:
			enabled &&
			!capabilities.isError &&
			desktopFeatureEnabled(capabilities.data, "hub_skills"),
		queryFn: async () => {
			requireSkillsAdapter(client);
			if (scope.visibility === "org") {
				const result = (await listOrgSkills(scope.tenantId)).result;
				return {
					rows: result.skills,
					pages: 1,
					contract: result.sync_contract,
				};
			}
			const result = (
				await listPublicSkills(apiConfig.radientBaseUrl, page, 20)
			).result;
			return {
				rows: result.records,
				pages: result.total_pages,
				contract: result.sync_contract,
			};
		},
		staleTime: 30_000,
		retry: scope.visibility === "org" ? retryDesktopQuery : retryPublicHubQuery,
		retryOnMount: false,
		refetchOnWindowFocus: false,
	});
}
export function useRemoteSkill(
	scope: HubSkillScope,
	remoteId: string | null,
	enabled: boolean,
) {
	const client = useQueryClient();
	const capabilities = useDesktopCapabilities();
	return useQuery({
		queryKey: [
			"hub-skill",
			apiConfig.radientBaseUrl,
			scope.visibility,
			scope.tenantId,
			remoteId,
		],
		enabled:
			enabled &&
			remoteId !== null &&
			!capabilities.isError &&
			desktopFeatureEnabled(capabilities.data, "hub_skills"),
		queryFn: async () => {
			requireSkillsAdapter(client);
			return (
				scope.visibility === "org"
					? await getOrgSkill(scope.tenantId, remoteId as string)
					: await getPublicSkill(apiConfig.radientBaseUrl, remoteId as string)
			).result;
		},
		staleTime: 30_000,
		retry: scope.visibility === "org" ? retryDesktopQuery : retryPublicHubQuery,
		retryOnMount: false,
	});
}
/**
 * One cache-seeding rule for every skill write that answers `{link, links}`.
 *
 * The seeded inventory is the ANSWER's own list, so a write that landed between
 * the fetch and the answer cannot be overwritten by a stale read; the settled
 * invalidation then re-reads the service for anything the answer does not cover.
 * The installed-skills list is invalidated too: unpull removes a directory, and
 * a settings panel that still lists it would be describing files that are gone.
 */
function seedSkillLinkWrite(client: QueryClient, result: { links: HubLinks }) {
	client.setQueryData(hubLinksKey, result.links);
}
function settleSkillLinkWrite(client: QueryClient) {
	void client.invalidateQueries({ queryKey: hubLinksKey });
	void client.invalidateQueries({ queryKey: ["desktop", "skills"] });
}

export function usePullHubSkill() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			requestId: string;
			remoteId: string;
			scope: HubSkillScope;
			alias: string;
			subscribe: boolean;
			autoPush: boolean;
			consent: boolean;
		}) => {
			requireSkillsAdapter(client);
			return desktopResult<{
				reports: HubDirectionalReport[];
				link: HubLink;
				links: HubLinks;
			}>({
				op: "hub.skillPull",
				requestId: input.requestId,
				hubId: input.remoteId,
				hubSource: hubSourceAddress(apiConfig.radientBaseUrl),
				visibility: input.scope.visibility,
				tenantId: input.scope.tenantId,
				localAlias: input.alias,
				subscribe: input.subscribe,
				autoPush: input.autoPush,
				confirmPublicEgress: input.consent,
			});
		},
		onSuccess: (result) => {
			seedSkillLinkWrite(client, result);
		},
		onSettled: () => {
			settleSkillLinkWrite(client);
		},
	});
}
/**
 * Subscribe without pulling: link the remote skill and receive future revisions,
 * writing NO local copy (core's `POST /v1/desktop/hub/skills/subscribe`).
 *
 * A separate mutation from the pull on purpose: the two are different acts, and
 * one hook carrying `subscribe: boolean` would make "download once" and "subscribe
 * from now on" look like one action with a flag, which is exactly the confusion
 * the surface exists to remove.
 */
export function useSubscribeHubSkill() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			requestId: string;
			remoteId: string;
			scope: HubSkillScope;
			alias: string;
		}) => {
			requireSkillsAdapter(client);
			return desktopResult<{ link: HubLink; links: HubLinks }>({
				op: "hub.skillSubscribe",
				requestId: input.requestId,
				hubId: input.remoteId,
				hubSource: hubSourceAddress(apiConfig.radientBaseUrl),
				visibility: input.scope.visibility,
				tenantId: input.scope.tenantId,
				localAlias: input.alias,
			});
		},
		onSuccess: (result) => {
			seedSkillLinkWrite(client, result);
		},
		onSettled: () => {
			settleSkillLinkWrite(client);
		},
	});
}
/**
 * Remove one skill link's managed copy while KEEPING the link, alias, policy and
 * subscription (core's `POST /v1/desktop/hub/skills/unpull`).
 *
 * Addressed by link id, never by remote identity: the copy belongs to one local
 * link, and re-resolving the remote could name a different link after an alias
 * or policy edit. Repeating the call is a success, so a lost answer stays
 * retryable rather than becoming a 404 the operator cannot clear.
 */
export function useUnpullHubSkill() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: { requestId: string; linkId: string }) => {
			requireSkillsAdapter(client);
			return desktopResult<{ link: HubLink; links: HubLinks }>({
				op: "hub.skillUnpull",
				requestId: input.requestId,
				linkId: input.linkId,
			});
		},
		onSuccess: (result) => {
			seedSkillLinkWrite(client, result);
		},
		onSettled: () => {
			settleSkillLinkWrite(client);
		},
	});
}
export function useInitialSkillPublication() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: (input: {
			requestId: string;
			draft: SkillPublicationDraft;
			previewReceipt?: string;
		}) => {
			requireSkillsAdapter(client);
			return desktopResult<SkillPublicationResult>({
				op: "hub.skillPublish",
				requestId: input.requestId,
				...input.draft,
				dryRun: input.previewReceipt === undefined,
				...(input.previewReceipt
					? { previewReceipt: input.previewReceipt, confirmPublish: true }
					: {}),
			});
		},
		onSuccess: (result) => {
			// Publication and local link outcome are distinct. Do not seed optimistic
			// preferences from remote success or a pending reconciliation receipt.
			if (result.local_link_receipt?.state === "complete") {
				void client.invalidateQueries({ queryKey: hubLinksKey });
				void client.invalidateQueries({ queryKey: ["desktop", "skills"] });
				void client.invalidateQueries({ queryKey: ["hub-skills"] });
			}
		},
	});
}
