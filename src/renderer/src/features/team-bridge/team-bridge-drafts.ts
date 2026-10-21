import { TEAM_BRIDGE_DRAFT_PREFIX as PREFIX } from "../../shared/store/team-bridge-draft-account";
export {
	draftStorageKey,
	eraseAccountDrafts,
	reconcileDraftAccount,
} from "../../shared/store/team-bridge-draft-account";
import { z } from "zod";
import type { TeamBridgeTarget } from "./team-bridge-model";

export type TeamBridgeDraft = {
	target: TeamBridgeTarget;
	body: string;
	clientRef: string;
	conversationId?: string;
	sendAt?: string;
	createUncertain?: boolean;
};
export type TeamBridgeDrafts = Record<string, TeamBridgeDraft>;
const recipientSchema = z.discriminatedUnion("kind", [
	z.object({
		kind: z.literal("human"),
		accountId: z.string().min(1),
		label: z.string(),
	}),
	z.object({
		kind: z.literal("agent"),
		accountId: z.string().min(1),
		endpointId: z.string().min(1),
		label: z.string(),
	}),
]);
const draftSchema = z.object({
	target: z.discriminatedUnion("type", [
		z.object({ type: z.literal("conversation"), id: z.string().min(1) }),
		z.object({ type: z.literal("person"), accountId: z.string().min(1) }),
		z.object({ type: z.literal("chief"), accountId: z.string().min(1) }),
		z.object({
			type: z.literal("compose"),
			recipients: z.array(recipientSchema),
		}),
	]),
	body: z.string(),
	clientRef: z.string().min(1),
	conversationId: z.string().min(1).optional(),
	sendAt: z.string().datetime({ offset: true }).optional(),
	createUncertain: z.boolean().optional(),
});

/** Explicitly authored drafts are NOT the inbound message-body cache. They are
 * app-owned, account/organization scoped user work, never telemetry. Preserve
 * them across navigation/reload, but erase the previous account on sign-out or
 * account replacement; the runtime's no-body-cache invariant remains intact.
 */

export function draftTargetKey(target: TeamBridgeTarget): string {
	switch (target.type) {
		case "conversation":
			return `conversation:${target.id}`;
		case "person":
			return `person:${target.accountId}`;
		case "chief":
			return `chief:${target.accountId}`;
		// The To: bar is one editable draft, not a fresh draft on each chip change.
		case "compose":
			return "compose";
	}
}

export function readDrafts(
	storage: Pick<Storage, "getItem">,
	key: string,
): TeamBridgeDrafts {
	try {
		const value: unknown = JSON.parse(storage.getItem(key) ?? "{}");
		if (!value || typeof value !== "object" || Array.isArray(value)) return {};
		const valid: TeamBridgeDrafts = {};
		for (const [id, entry] of Object.entries(value)) {
			const parsed = draftSchema.safeParse(entry);
			if (parsed.success && draftTargetKey(parsed.data.target) === id)
				valid[id] = parsed.data;
		}
		return valid;
	} catch {
		return {};
	}
}

export function accountDraftScopes(
	storage: Storage,
	accountId: string,
): Map<string, TeamBridgeDrafts> {
	const scopes = new Map<string, TeamBridgeDrafts>();
	const prefix = `${PREFIX}${encodeURIComponent(accountId)}:`;
	try {
		for (const key of Object.keys(storage))
			if (key.startsWith(prefix)) scopes.set(key, readDrafts(storage, key));
	} catch {
		/* The editor retains its in-memory snapshot if storage is unavailable. */
	}
	return scopes;
}
export function draftTenantFromStorageKey(key: string): string {
	return decodeURIComponent(key.slice(key.lastIndexOf(":") + 1));
}

const LOCAL_TIME = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

/** The server accepts an inclusive one-minute..120-day window. Local datetime
 * input is interpreted in the displayed machine timezone, then sent as UTC.
 */
export function scheduledSendAt(
	value: string,
	now = Date.now(),
): string | null {
	const date = new Date(value);
	const at = date.getTime();
	// datetime-local permits impossible days/DST gaps in programmatic values.
	// Reject normalization instead of silently confirming a different local time.
	const match = LOCAL_TIME.exec(value);
	if (
		!match ||
		date.getFullYear() !== Number(match[1]) ||
		date.getMonth() + 1 !== Number(match[2]) ||
		date.getDate() !== Number(match[3]) ||
		date.getHours() !== Number(match[4]) ||
		date.getMinutes() !== Number(match[5])
	)
		return null;
	return Number.isFinite(at) &&
		at >= now + 60_000 &&
		at <= now + 120 * 86_400_000
		? new Date(at).toISOString()
		: null;
}
