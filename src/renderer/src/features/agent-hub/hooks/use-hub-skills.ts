import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
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
	listOrgSkills,
	listPublicSkills,
} from "@shared/api/radient/skills-api";
import { apiConfig } from "@shared/config";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { retryPublicHubQuery } from "./use-public-teams-query";

export type HubSkillScope =
	| { visibility: "public"; tenantId: null; organization: null }
	| { visibility: "org"; tenantId: string; organization: string | null };

/** Scope and API origin are part of each key. A private refusal never goes public. */
export function useRemoteSkills(
	scope: HubSkillScope,
	page: number,
	enabled: boolean,
) {
	return useQuery({
		queryKey: [
			"hub-skills",
			apiConfig.radientBaseUrl,
			scope.visibility,
			scope.tenantId,
			page,
		],
		enabled,
		queryFn: async () => {
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
	return useQuery({
		queryKey: [
			"hub-skill",
			apiConfig.radientBaseUrl,
			scope.visibility,
			scope.tenantId,
			remoteId,
		],
		enabled: enabled && remoteId !== null,
		queryFn: async () =>
			(scope.visibility === "org"
				? await getOrgSkill(scope.tenantId, remoteId as string)
				: await getPublicSkill(apiConfig.radientBaseUrl, remoteId as string)
			).result,
		staleTime: 30_000,
		retry: scope.visibility === "org" ? retryDesktopQuery : retryPublicHubQuery,
		retryOnMount: false,
	});
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
		}) =>
			desktopResult<{
				reports: HubDirectionalReport[];
				link: HubLink;
				links: HubLinks;
			}>({
				op: "hub.skillPull",
				requestId: input.requestId,
				hubId: input.remoteId,
				hubSource: apiConfig.radientBaseUrl,
				visibility: input.scope.visibility,
				tenantId: input.scope.tenantId,
				localAlias: input.alias,
				subscribe: input.subscribe,
				autoPush: input.autoPush,
				confirmPublicEgress: input.consent,
			}),
		onSuccess: (result) => {
			client.setQueryData(hubLinksKey, result.links);
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: hubLinksKey });
			void client.invalidateQueries({ queryKey: ["desktop", "skills"] });
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
		}) =>
			desktopResult<SkillPublicationResult>({
				op: "hub.skillPublish",
				requestId: input.requestId,
				...input.draft,
				dryRun: input.previewReceipt === undefined,
				...(input.previewReceipt
					? { previewReceipt: input.previewReceipt, confirmPublish: true }
					: {}),
			}),
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
