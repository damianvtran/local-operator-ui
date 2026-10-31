/**
 * The address and the shape of one agent's stored picture - pure, no side
 * effects and no app imports beyond a type.
 *
 * SPLIT OUT OF `agent-avatar.ts` SO A NODE TEST CAN READ IT. The seam imports
 * the query client, the media relay and the sessions store to do its work, and
 * none of those load outside the app; the two rules a reviewer most needs to
 * see - the URL a picture is addressed by, and which records are usable at all -
 * need none of it. `agent-avatar.ts` re-exports both, so every surface still has
 * one import.
 */

import type { AgentAvatarMeta } from "@shared/api/local-operator/types";

/** A content address: the 64-hex SHA-256 core publishes. */
export const SHA256 = /^[0-9a-f]{64}$/;

/** agent id -> its picture record, for every agent that has one. */
export type AgentAvatarMap = Record<string, AgentAvatarMeta>;

/**
 * The contract's address for one picture: `/v1/agents/{id}/avatar?v=<sha>`.
 *
 * The `v` is the content address, so a changed picture is a different URL to
 * every cache in the chain, and the same digest is the cache key the renderer
 * files the fetched bytes under.
 */
export function agentAvatarPath(agentId: string, sha256: string): string {
	return `/v1/agents/${encodeURIComponent(agentId)}/avatar?v=${sha256}`;
}

/**
 * The record from one agent row, or null for anything that is not a usable one.
 * Read as untrusted: an older backend sends no field, and a malformed digest
 * would otherwise become a relay request main refuses on every render.
 */
export function avatarMetaOf(value: unknown): AgentAvatarMeta | null {
	if (value === null || typeof value !== "object") return null;
	const meta = value as Partial<AgentAvatarMeta>;
	if (typeof meta.sha256 !== "string" || !SHA256.test(meta.sha256)) return null;
	return {
		sha256: meta.sha256,
		mime: typeof meta.mime === "string" ? meta.mime : "image/png",
		bytes: typeof meta.bytes === "number" ? meta.bytes : 0,
		updated_at: typeof meta.updated_at === "string" ? meta.updated_at : "",
	};
}
