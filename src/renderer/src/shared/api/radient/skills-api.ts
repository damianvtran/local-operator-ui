import { publicHubCatalogueUrl, readPublicHub } from "./agents-api";
import { radientProxyEnvelope } from "./proxy";
import type { RadientApiResponse } from "./types";

export type HubSkillManifest = {
	document_version: 1;
	name: string;
	description: string;
	files: { path: string; content: string }[];
};
export type HubSkillContract = { revision_cas: number; skills: number };
export type HubSkillRow = {
	id: string;
	name: string;
	description: string;
	document_version: 1;
	visibility: "public" | "org";
	tenant_id?: string;
	/**
	 * Who publishes/maintains this skill, when the hub states it.
	 *
	 * The public skill row carries no publisher today, unlike an agent row's
	 * `account_metadata.name`. Optional and never synthesized: the card falls back
	 * to the honest source line (organization, or the public-hub label) rather
	 * than inventing a maintainer, and a hub that starts sending the field needs
	 * no renderer change.
	 */
	publisher?: string | null;
	content_revision: number;
	/** Opaque INCLUDING quotes; never synthesize/decode into a semantic version. */
	revision: string;
	sync_contract: HubSkillContract;
};
export type HubSkillDetail = HubSkillRow & { files: HubSkillManifest["files"] };
export type PublicSkillList = {
	page: number;
	per_page: number;
	total_pages: number;
	total_records: number;
	records: HubSkillRow[];
	sync_contract: HubSkillContract;
};
export type OrgSkillList = {
	skills: HubSkillRow[];
	sync_contract: HubSkillContract;
};

/**
 * The hub source the DESKTOP writes into a skill link's identity.
 *
 * Core approves exactly the base its own config normalises to, and
 * `normalize_radient_api_base_url` completes that with `/v1`
 * (`local_operator/env.py`); the anonymous catalogue reads beside this module
 * build `.../v1/<collection>` from the same configured origin. Sending the bare
 * origin is refused `origin-conflict` ("hub source is not configured or
 * approved"), which is what QA found between the UI and core in PR #1269 (F1) —
 * nothing in either suite had asserted the two halves agree. One function, used
 * by every skill write AND by the local-link join, so the identity the renderer
 * sends and the identity the links inventory reports cannot drift.
 */
export function hubSourceAddress(origin: string): string {
	return `${origin.replace(/\/+$/, "")}/v1`;
}

/** Capability is on RESULT even when the catalogue is empty; absence is not v1. */
export const hubSkillsSupported = (
	contract: HubSkillContract | undefined,
): boolean => contract?.skills === 1 && contract.revision_cas === 1;

export function listPublicSkills(
	origin: string,
	page = 1,
	perPage = 20,
): Promise<RadientApiResponse<PublicSkillList>> {
	const url = new URL(publicHubCatalogueUrl(origin, "skills"));
	url.searchParams.set("page", String(page));
	url.searchParams.set("per_page", String(perPage));
	return readPublicHub<PublicSkillList>(url.toString());
}
export function getPublicSkill(
	origin: string,
	remoteId: string,
): Promise<RadientApiResponse<HubSkillDetail>> {
	return readPublicHub<HubSkillDetail>(
		publicHubCatalogueUrl(origin, "skills", remoteId),
	);
}

/**
 * Org reads use the existing server-side credential proxy, not browser tokens.
 * The tenant is required and the response wrapper differs from public paging.
 * A failed private read can NEVER retry as an anonymous public catalogue read.
 */
export function listOrgSkills(
	tenantId: string,
): Promise<RadientApiResponse<OrgSkillList>> {
	return radientProxyEnvelope<OrgSkillList>({
		operation: "org_skills.list",
		tenantId,
	});
}
export function getOrgSkill(
	tenantId: string,
	remoteId: string,
): Promise<RadientApiResponse<HubSkillDetail>> {
	return radientProxyEnvelope<HubSkillDetail>({
		operation: "org_skill.get",
		tenantId,
		skillId: remoteId,
	});
}
