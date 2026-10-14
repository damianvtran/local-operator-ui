import type { HubSkillManifest } from "../radient/skills-api";
import type { HubLink } from "./hub-links";

export type LocalLinkReceipt = {
	state: "complete" | "pending-reconciliation";
	operation_id: string;
	link_id: string | null;
	safe_message: string | null;
};
export type PublicationPolicy = {
	requestId: string;
	subscribe?: boolean;
	autoPush?: boolean;
	confirmPublicEgress?: boolean;
	expectedRemoteRevision?: string;
};
export type SkillPublicationDraft = {
	sourceSkill: string;
	localAlias: string;
	visibility: "public" | "org";
	tenantId: string | null;
	subscribe: boolean;
	autoPush: boolean;
	confirmPublicEgress: boolean;
};
export type InitialSkillPublicationPreview = {
	preview_receipt: string;
	kind: "skill";
	direction: "push";
	publication: "create";
	source_skill: string;
	local_alias: string;
	hub_source: string;
	visibility: "public" | "org";
	tenant_id: string | null;
	local_fingerprint: string;
	draft_fingerprint: string;
	proposal_fingerprint: string;
	expires_at: string;
	policy: {
		subscribe: boolean;
		auto_push: boolean;
		confirm_public_egress: boolean;
	};
	proposal: { kind: "skill"; fields: HubSkillManifest };
	warnings: string[];
	can_confirm: boolean;
	reason: string | null;
};
export type SkillPublicationResult = {
	preview: InitialSkillPublicationPreview | null;
	link: HubLink | null;
	local_link_receipt: LocalLinkReceipt | null;
	publication?: {
		skill: { id: string; name: string };
		accepted_document: HubSkillManifest;
		revision: string;
		content_revision: number;
		operation_id: string;
		sync_contract: { revision_cas: number; skills: number };
	} | null;
};

/** Draft identity is not a fake link_id. Core validates fresh ALL-file bytes too. */
export function initialSkillPreviewMatches(
	preview: InitialSkillPublicationPreview,
	draft: SkillPublicationDraft,
	now = Date.now(),
): boolean {
	return (
		preview.can_confirm === true &&
		preview.kind === "skill" &&
		preview.direction === "push" &&
		preview.publication === "create" &&
		preview.proposal?.kind === "skill" &&
		preview.proposal.fields?.document_version === 1 &&
		preview.preview_receipt.length > 0 &&
		preview.local_fingerprint.length > 0 &&
		preview.draft_fingerprint.length > 0 &&
		preview.proposal_fingerprint.length > 0 &&
		preview.source_skill === draft.sourceSkill &&
		preview.local_alias === draft.localAlias &&
		preview.visibility === draft.visibility &&
		preview.tenant_id === draft.tenantId &&
		preview.policy?.subscribe === draft.subscribe &&
		preview.policy?.auto_push === draft.autoPush &&
		preview.policy?.confirm_public_egress === draft.confirmPublicEgress &&
		Number.isFinite(Date.parse(preview.expires_at)) &&
		Date.parse(preview.expires_at) > now
	);
}

/** Remote success alone never acknowledges local policy; no optimistic ON. */
export function publicationPolicyAcknowledged(result: {
	link?: HubLink | null;
	local_link_receipt?: LocalLinkReceipt | null;
}): boolean {
	return (
		result.local_link_receipt?.state === "complete" &&
		!!result.link &&
		result.local_link_receipt.link_id === result.link.link_id &&
		typeof result.link.policy?.subscribe === "boolean" &&
		typeof result.link.policy.auto_push === "boolean" &&
		typeof result.link.policy.revision === "string" &&
		result.link.policy.revision.length > 0
	);
}
