import { createContext } from "react";

/** Page-lifetime inert data, scoped by account/tenant/conversation/root. No retry
 * closures survive an identity change, but losing authority must not destroy text
 * or mint a second idempotency key when its original owner explicitly retries. */
export type ThreadDraft = {
	body: string;
	pending: { body: string; clientRef: string } | null;
};
export const TeamBridgeThreadDrafts = createContext<Map<
	string,
	ThreadDraft
> | null>(null);
