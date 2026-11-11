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
/**
 * The `bundle` sub-object a BUNDLE skill serves instead of `files` (core's
 * `SkillBundleRef`): archive identity plus its declared inventory. Only
 * `file_count` is read here; the archive itself is never fetched by the
 * renderer (a pull downloads and verifies it on the backend).
 */
export type HubSkillBundleRef = {
	format: string;
	hash: string;
	size: number;
	uncompressed_size: number;
	file_count: number;
	entrypoint: string;
	tree_hash: string;
};
/**
 * What the detail dialog consumes: TOTAL, whatever form the hub served.
 *
 * The hub serves two skill forms from the same `GET …/skills/{id}`: a DOCUMENT
 * (`files[]`, path/content pairs) and a BUNDLE (`bundle{}` and NO `files` key
 * at all, because the content is a zip the backend pulls). The old type claimed
 * `files` always existed, so a bundle detail (a real private-org skill,
 * `minerva-design`) threw `Cannot read properties of undefined (reading
 * 'length')` in render and took the whole window down (v0.53.2). Every detail
 * now passes through `normalizeHubSkillDetail`, so `files` is always an array
 * (empty for a bundle) and `file_count` is the honest inventory size for both
 * forms.
 */
export type HubSkillDetail = HubSkillRow & {
	files: HubSkillManifest["files"];
	bundle: HubSkillBundleRef | null;
	file_count: number;
};
/** The wire answer before normalization: either form, fields not trusted. */
type HubSkillDetailWire = HubSkillRow & {
	files?: unknown;
	bundle?: unknown;
};

/**
 * Make a served detail total. Junk file rows (non-objects, a missing path) are
 * dropped rather than rendered, and a missing `content` reads as empty: the
 * dialog keys and labels rows by `path` and must never throw on one bad row.
 */
export function normalizeHubSkillDetail(
	wire: HubSkillDetailWire,
): HubSkillDetail {
	const files = Array.isArray(wire.files)
		? (wire.files as unknown[]).flatMap((value) => {
				const row = value as { path?: unknown; content?: unknown } | null;
				return row && typeof row === "object" && typeof row.path === "string"
					? [
							{
								path: row.path,
								content: typeof row.content === "string" ? row.content : "",
							},
						]
					: [];
			})
		: [];
	const bundle =
		wire.bundle && typeof wire.bundle === "object"
			? (wire.bundle as HubSkillBundleRef)
			: null;
	const declared = bundle?.file_count;
	return {
		...wire,
		files,
		bundle,
		file_count:
			typeof declared === "number" && Number.isFinite(declared) && declared >= 0
				? declared
				: files.length,
	};
}

const normalizedDetail = (
	response: RadientApiResponse<HubSkillDetailWire>,
): RadientApiResponse<HubSkillDetail> => ({
	...response,
	// A missing body stays missing (the hook reports it as a failed read); only
	// a present detail is normalized.
	result: response.result
		? normalizeHubSkillDetail(response.result)
		: (response.result as unknown as HubSkillDetail),
});
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

export { hubSourceAddress } from "./hub-source";

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
	return readPublicHub<HubSkillDetailWire>(
		publicHubCatalogueUrl(origin, "skills", remoteId),
	).then(normalizedDetail);
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
	return radientProxyEnvelope<HubSkillDetailWire>({
		operation: "org_skill.get",
		tenantId,
		skillId: remoteId,
	}).then(normalizedDetail);
}
