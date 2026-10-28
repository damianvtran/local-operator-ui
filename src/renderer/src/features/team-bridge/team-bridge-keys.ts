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
	/*
	 * The ARCHIVED half of the list. It sits under the conversations prefix on
	 * purpose: every write that refreshes the live list (and the archive/unarchive
	 * writes themselves) then refreshes this too with no second invalidation to
	 * forget, and the account tail keeps it inside the notify/archive mutations'
	 * owner predicate.
	 */
	archivedConversations: (scope: TeamBridgeScope, accountId?: string) =>
		[
			...ROOT,
			"conversations",
			scope,
			"archived",
			...readOwner(accountId),
		] as const,
	conversationsPrefix: [...ROOT, "conversations"] as const,
	// Notification dispatch must distinguish optimistic display policy from a
	// settled write, without mixing pending mutations from another auth epoch.
	notifyMutation: (accountId: string | undefined, epoch: number) =>
		[...ROOT, "notify-policy", accountId ?? "unresolved-owner", epoch] as const,
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
	/*
	 * Thread pages contain private bodies just like timeline pages, and they were
	 * the path the threads hold existed for (#1304's cache/retry defects: the
	 * pane cached under tenant/conversation/root alone, so a thread read for A
	 * could be served from cache - or settle into it - after B signed in).
	 *
	 * The key therefore names the WHOLE owner: the signed-in account AND the
	 * credential epoch that commissioned the read (`radient-account-authority`).
	 * The epoch matters as much as the account: A -> B -> A returns to the same
	 * account id with a newer epoch, and a page A's FIRST session cached (or a
	 * retry it left running) must not revive under A's second one. The owner is
	 * REQUIRED, so no caller can build an unowned thread key, and the whole
	 * prefix is cleared at every auth transition
	 * (`team-bridge-thread-cache.ts`).
	 */
	replies: (
		tenantId: string,
		conversationId: string,
		rootId: string,
		owner: { accountId: string; epoch: number },
	) =>
		[
			...ROOT,
			"replies",
			tenantId,
			conversationId,
			rootId,
			"account",
			owner.accountId,
			"epoch",
			owner.epoch,
		] as const,
	/** Invalidation/clear only: every thread page of every owner. */
	repliesPrefix: [...ROOT, "replies"] as const,
	// Prefix is invalidation-only. Identity/status answers also belong to an
	// account; an unresolved auth epoch must not read the legacy unowned entry.
	status: [...ROOT, "status"] as const,
	statusFor: (accountId?: string) =>
		[...ROOT, "status", "account", accountId ?? "unresolved-owner"] as const,
};
