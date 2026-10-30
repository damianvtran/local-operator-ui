/**
 * Names a Team Bridge conversation id (`bcv_…`) from the data the app already
 * holds, for the transcript's `bridge` tool rows.
 *
 * WHY. A `bridge` call addresses its conversation by id (`channel_id`), and the
 * core's receipts name a destination only for a DM or a channel it just
 * created. A post into `#release` would otherwise read `Posted in a
 * conversation` while the Team Bridge page, one click away, already knows the
 * name. So when the conversations list is in the React Query cache, the row
 * borrows its title - through the page's own `conversationTitle`, so the two
 * surfaces cannot name one conversation two ways.
 *
 * CONSTRAINTS.
 * - READ-ONLY, never a fetch: a transcript must not start Team Bridge reads
 *   (they are owner-gated and polled by the page that owns them). An unpopulated
 *   cache answers `null` and the row falls back to its kind word.
 * - OWNER-SCOPED: the list keys end in `["account", <id>]`, and only lists for
 *   the account currently signed in are read. Another account's cached rows -
 *   retained across a sign-out - must never name a row for this one (the same
 *   fence `team-bridge-keys.ts` documents).
 * - NO PROVIDER, NO NAMES: the context is read directly rather than through
 *   `useQueryClient`, which throws outside a provider; hosts that render the
 *   transcript bare (fixtures, some stories) just get `null`.
 * - Re-renders when the cache's conversation lists change, so a row painted
 *   before the page loaded picks the name up once it lands.
 */
import { observedRadientAuthority } from "@shared/hooks/radient-account-authority";
import { type QueryClient, QueryClientContext } from "@tanstack/react-query";
import { useCallback, useContext, useMemo, useSyncExternalStore } from "react";
import type { TeamBridgeConversationList } from "../../../../../shared/team-bridge-contract";
import { teamBridgeKeys } from "../../team-bridge/team-bridge-keys";
import { conversationTitle } from "../../team-bridge/team-bridge-model";
import type { BridgeLabelResolver } from "../components/trace/bridge-row-model";

/** The conversations-list prefix, as the key's own array. */
const PREFIX = teamBridgeKeys.conversationsPrefix;

const isListKey = (key: readonly unknown[]) =>
	PREFIX.every((part, index) => key[index] === part);

/**
 * A pure resolver over one client's cache. Exported for the node suite, which
 * drives it with a real `QueryClient` and no React.
 */
export function bridgeConversationResolver(
	client: QueryClient | undefined,
): BridgeLabelResolver | null {
	if (!client) return null;
	return (conversationId) => {
		// Read per lookup, not per resolver: an account switch must take effect
		// on the next paint even if no conversation list changed in between.
		const accountId = observedRadientAuthority(client).accountId;
		if (!accountId) return null;
		for (const [key, data] of client.getQueriesData<TeamBridgeConversationList>(
			{ queryKey: PREFIX },
		)) {
			const owner = key.slice(-2);
			if (owner[0] !== "account" || owner[1] !== accountId) continue;
			const match = data?.conversations?.find(
				(conversation) => conversation.id === conversationId,
			);
			if (match) return conversationTitle(match, accountId);
		}
		return null;
	};
}

/**
 * The resolver for the current render, or `null` when there is nothing to
 * read. Subscribes to conversation-list changes only, so unrelated cache
 * traffic does not repaint the transcript.
 */
export function useBridgeConversationNames(): BridgeLabelResolver | null {
	const client = useContext(QueryClientContext);
	const subscribe = useCallback(
		(notify: () => void) =>
			client
				? client.getQueryCache().subscribe((event) => {
						if (isListKey(event.query.queryKey)) notify();
					})
				: () => {},
		[client],
	);
	/*
	 * The change signal: the newest list write, as a stable primitive (a
	 * snapshot must be one). The resolver itself reads the cache lazily, so this
	 * only decides WHEN a new resolver - and so a row repaint - is due.
	 */
	const updated = useSyncExternalStore(subscribe, () =>
		client
			? client
					.getQueryCache()
					.findAll({ queryKey: PREFIX })
					.reduce(
						(latest, query) => Math.max(latest, query.state.dataUpdatedAt),
						0,
					)
			: 0,
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `updated` IS the cache-change signal the resolver reads through
	return useMemo(() => bridgeConversationResolver(client), [client, updated]);
}
