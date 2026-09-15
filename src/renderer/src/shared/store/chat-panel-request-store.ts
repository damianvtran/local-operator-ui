/**
 * A one-shot request to present a panel that only the chat pane can open.
 *
 * ## Why a request in a store rather than a function call
 *
 * `/info`, `/usage`, `/analytics` and `/session` are DESTINATIONS, not routes:
 * `slash-dispatch.ts` owns the one presentation slot, and every adapter needs
 * the live pane's rest of the world (the canonical session handle, the command
 * catalogue, the rebind path, the composer's note line). That is why the
 * dispatcher holds the picker state rather than a store — and why the palette,
 * which is mounted at the root and may be the only thing on screen, cannot
 * simply open one.
 *
 * So the palette ASKS. It writes the destination here, routes to the chat pane
 * if it is not already there, and the dispatcher consumes the request the way
 * it consumes a typed command. One presentation slot, one implementation of
 * "what a destination means", and the palette gaining nothing but a way to
 * name one.
 *
 * ## Why the request expires
 *
 * A request is consumable only while something is mounted to consume it. The
 * palette navigates to the chat route in the same tick, so the normal life of a
 * request is one frame — but a pane that cannot mount (the backend refused the
 * session, the route bounced) would otherwise leave it in the document
 * indefinitely, and the next chat the user opened would pop a panel they asked
 * for in another context, minutes earlier, with nothing on screen to explain
 * it. `PANEL_REQUEST_TTL_MS` bounds that to "immediately", and the consumer
 * clears an expired request rather than acting on it.
 */

import { create } from "zustand";

export type ChatPanelRequest = {
	/** A key of the picker registry's `DESTINATIONS` table. */
	destination: string;
	/**
	 * Identity of THIS request. Consumption is matched on it, so a slow consumer
	 * finishing an old request cannot clear a newer one that arrived meanwhile.
	 */
	nonce: number;
	requestedAt: number;
};

/**
 * How long a request stays actionable.
 *
 * Generously longer than a route change (measured in milliseconds) and far
 * shorter than anything a user would still be waiting on, which is the only
 * property that matters: past it, the request is not late, it is stale.
 */
export const PANEL_REQUEST_TTL_MS = 10_000;

type ChatPanelRequestState = {
	request: ChatPanelRequest | null;
	/** Ask the chat pane to present a destination. */
	requestPanel: (destination: string) => void;
	/** Retire a request, by nonce. */
	consumePanel: (nonce: number) => void;
};

let nextNonce = 0;

export const useChatPanelRequestStore = create<ChatPanelRequestState>(
	(set) => ({
		request: null,
		requestPanel: (destination) => {
			nextNonce += 1;
			set({
				request: { destination, nonce: nextNonce, requestedAt: Date.now() },
			});
		},
		consumePanel: (nonce) =>
			set((state) =>
				state.request?.nonce === nonce ? { request: null } : state,
			),
	}),
);
