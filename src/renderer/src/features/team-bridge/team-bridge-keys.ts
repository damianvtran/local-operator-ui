import type { TeamBridgeScope } from "./team-bridge-model";

const ROOT = ["team-bridge"] as const;

// Admission belongs to an account as well as a tenant. Append the owner so
// existing invalidation prefixes still work, without exposing another account's
// cached private rows while its own request is pending or refused.
const readOwner = (accountId?: string) =>
	accountId ? ["account", accountId] : [];

export const teamBridgeKeys = {
	all: ROOT,
	conversations: (scope: TeamBridgeScope, accountId?: string) =>
		[...ROOT, "conversations", scope, ...readOwner(accountId)] as const,
	conversationsPrefix: [...ROOT, "conversations"] as const,
	messages: (conversationId: string, tenantId?: string, accountId?: string) =>
		[
			...ROOT,
			"messages",
			tenantId ?? "unknown-tenant",
			conversationId,
			...readOwner(accountId),
		] as const,
	unread: (scope: TeamBridgeScope, accountId?: string) =>
		[...ROOT, "unread", scope, ...readOwner(accountId)] as const,
	unreadPrefix: [...ROOT, "unread"] as const,
	/*
	 * The People section's two reads. The directory is keyed by TENANT (the
	 * section only exists for one organization), so switching scope refetches
	 * into a different key and a previous organization's roster is never shown
	 * under the new title. The status read is one key: the platform state does
	 * not vary by scope.
	 */
	directory: (tenantId: string, accountId?: string) =>
		[...ROOT, "directory", tenantId, ...readOwner(accountId)] as const,
	/** Thread pages contain private bodies just like timeline pages. */
	replies: (
		tenantId: string,
		conversationId: string,
		rootId: string,
		accountId?: string,
	) =>
		[
			...ROOT,
			"replies",
			tenantId,
			conversationId,
			rootId,
			...readOwner(accountId),
		] as const,
	// Prefix is invalidation-only. Identity/status answers also belong to an
	// account; an unresolved auth epoch must not read the legacy unowned entry.
	status: [...ROOT, "status"] as const,
	statusFor: (accountId?: string) =>
		[...ROOT, "status", "account", accountId ?? "unresolved-owner"] as const,
};
