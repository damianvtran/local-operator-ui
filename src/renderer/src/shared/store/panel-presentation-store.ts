/**
 * A one-shot request to present a panel, and the arbitration between the two
 * hosts that can answer it.
 *
 * ## Why a request in a store rather than a function call
 *
 * `/session`, `/model` and the rest of the session-scoped destinations are
 * DESTINATIONS, not routes: `slash-dispatch.ts` owns the chat pane's
 * presentation slot, and every adapter needs the live pane's rest of the world
 * (the canonical session handle, the command catalogue, the rebind path, the
 * composer's note line). That is why the dispatcher holds the picker state
 * rather than a store — and why the palette, which is mounted at the root and
 * may be the only thing on screen, cannot simply open one.
 *
 * So the palette ASKS. It writes the destination here, routes to the chat pane
 * when the destination actually needs a pane, and a presenter consumes the
 * request the way the dispatcher consumes a typed command. One implementation
 * of "what a destination means", and the palette gaining nothing but a way to
 * name one.
 *
 * ## Two hosts, so the store also decides who presents
 *
 * There are now two presenters for a request: the chat pane (which owns every
 * destination) and the shell's `PanelOutlet`, which presents the MACHINE panels
 * — `/info`, `/usage`, `/analytics` — when no pane is mounted. The machine
 * panels read nothing that belongs to a conversation, which is why a user on
 * `/settings` can open one without being thrown back to chat.
 *
 * The arbitration is a CLAIM rather than a route check, and the difference is
 * load-bearing: the chat route also paints its connecting and error states,
 * where no presenter exists at all — so `location.pathname.startsWith("/chat")`
 * would strand a request that nothing could consume until it expired. The
 * honest question is "is a presenter mounted", so it is asked of the presenters:
 * whichever host owns the chat pane's slot claims here on mount and releases on
 * unmount, and the shell host presents only while no claim is outstanding.
 *
 * ## Why the request expires
 *
 * A request is consumable only while something is mounted to consume it, and
 * that window is now bounded by a claim rather than by a route: the shell host
 * is always mounted, so it presents the machine panels immediately, but a
 * pane-only destination asked for from another route still travels through the
 * navigation that mounts its pane. A request nobody consumes would otherwise
 * live in the document indefinitely, and the next chat the user opened would
 * pop a panel they asked for in another context, minutes earlier, with nothing
 * on screen to explain it. `PANEL_REQUEST_TTL_MS` bounds that to "immediately",
 * and a consumer clears an expired request rather than acting on it.
 */

import { create } from "zustand";

export type PanelRequest = {
	/** A key of the picker registry's `DESTINATIONS` table. */
	destination: string;
	/**
	 * Identity of THIS request. Consumption is matched on it, so a slow consumer
	 * finishing an old request cannot clear a newer one that arrived meanwhile.
	 */
	nonce: number;
	requestedAt: number;
	/**
	 * The control that was focused when the request was raised, or null.
	 *
	 * IT TRAVELS WITH THE REQUEST because the requester is the only one who can
	 * still see it: the palette holds focus in its own search field while it is
	 * open, and that field is unmounted in the same commit the panel mounts — so a
	 * host that read `document.activeElement` when the request ARRIVED recorded
	 * the palette's field, which the `isConnected` guard then skipped, and closing
	 * the panel dropped the keyboard on `document.body` (UX round 1, U1). The
	 * palette already captures the pre-open focus for its own Escape
	 * (`command-palette.tsx`), and that is exactly the node both gestures should
	 * return to, so it is passed rather than rediscovered.
	 *
	 * Read by the SHELL host. The pane's own close path keeps its rule (null here,
	 * composer on close, `slash-dispatch.ts`) because the pane has a composer to
	 * fall back to and is where the user's hand already is.
	 */
	invoker: HTMLElement | null;
};

/**
 * How long a request stays actionable.
 *
 * Generously longer than a route change (measured in milliseconds) and far
 * shorter than anything a user would still be waiting on, which is the only
 * property that matters: past it, the request is not late, it is stale.
 */
export const PANEL_REQUEST_TTL_MS = 10_000;

type PanelPresentationState = {
	request: PanelRequest | null;
	/**
	 * Ask a presenter to present a destination.
	 *
	 * `invoker` is the control to hand focus back to when the panel closes
	 * (see `PanelRequest.invoker`); omitted only where the caller has none to name.
	 */
	requestPanel: (destination: string, invoker?: HTMLElement | null) => void;
	/** Retire a request, by nonce. */
	consumePanel: (nonce: number) => void;
	/**
	 * Whether a mounted host currently owns the chat pane's presentation slot.
	 *
	 * The shell host reads this to decide whether to answer a request itself;
	 * `false` is the normal state on every route but `/chat`, and on `/chat` too
	 * while the pane is still connecting.
	 */
	presenterClaimed: boolean;
	/**
	 * Claim the pane's slot. Returns the release, for the claimant's own cleanup.
	 */
	claimPresenter: () => () => void;
};

/**
 * What the SHELL host does with the request in the store, decided in one place.
 *
 * WHY THIS IS A FUNCTION AND NOT FOUR `if`s IN THE EFFECT. The shell's host is
 * the second presenter, and the states it has to get right are exactly the ones
 * no render can be driven into from a test: a request it cannot present arriving
 * while it already shows a panel (which is what let two modals stack — code
 * review round 1, M1), a request arriving while a pane owns the slot, and a
 * request past its TTL. Extracted, the sequence the reviewer reproduced is an
 * assertion rather than a code reading (`scripts/palette-panel-request.test.mjs`).
 *
 * `presentable` is passed in rather than resolved here because it is asked of the
 * destination TABLE (`machinePanelFor`), which this module deliberately does not
 * import: it is a store of requests, not a registry of destinations.
 *
 * `null` means "do nothing": there is no request, and a host with no request has
 * no state to change.
 */
export type ShellHostAction = "present" | "yield" | "hold" | "retire";

export function shellHostAction(input: {
	request: PanelRequest | null;
	/** The registry has a machine panel for this request's destination. */
	presentable: boolean;
	/** A mounted host currently owns the chat pane's presentation slot. */
	claimed: boolean;
	now: number;
}): ShellHostAction | null {
	const { request } = input;
	if (!request) return null;
	if (input.now - request.requestedAt > PANEL_REQUEST_TTL_MS) return "retire";
	/*
	 * BEFORE the claim check, and that order is the fix for M1 rather than a
	 * preference. A request this host cannot present belongs to the pane, and the
	 * pane is about to open it: the destination is pane-only BECAUSE the palette
	 * routed to `/chat` for it, so a pane is mounting in the same commit. Asking
	 * the claim first made the outcome depend on which host's effect React ran
	 * first — the pane claims in that commit too, and if the claim were visible by
	 * then this host returned early and its own panel stayed up under the pane's.
	 * Yielding on the destination alone is a fact about the request, not a race.
	 *
	 * What it deliberately is NOT: a reaction to `presenterClaimed` itself. A
	 * route move that mounts a pane must not close a panel the user opened over
	 * another page (§ 8) — that state has no new request, so it never reaches here.
	 */
	if (!input.presentable) return "yield";
	if (input.claimed) return "hold";
	return "present";
}

let nextNonce = 0;

/**
 * Outstanding claims, counted rather than remembered as one boolean.
 *
 * Two edges overlap in real use and a boolean cannot express either: React's
 * development build invokes an effect twice (claim, release, claim), and a pane
 * swap mounts the incoming pane before unmounting the outgoing one. With a
 * single flag the outgoing pane's release would clear the incoming pane's
 * claim, and the shell host would then present a session-scoped request the
 * pane was about to answer. `presenterClaimed` is still published as the
 * boolean its readers want; the count only decides when it flips.
 */
let claims = 0;

export const usePanelPresentationStore = create<PanelPresentationState>(
	(set) => ({
		request: null,
		requestPanel: (destination, invoker) => {
			nextNonce += 1;
			set({
				request: {
					destination,
					nonce: nextNonce,
					requestedAt: Date.now(),
					invoker: invoker ?? null,
				},
			});
		},
		consumePanel: (nonce) =>
			set((state) =>
				state.request?.nonce === nonce ? { request: null } : state,
			),
		presenterClaimed: false,
		claimPresenter: () => {
			claims += 1;
			set({ presenterClaimed: true });
			/*
			 * Idempotent per claim, because a release called twice (a cleanup run
			 * again, a future caller holding the function past its effect) would
			 * otherwise decrement another presenter's claim out from under it.
			 */
			let released = false;
			return () => {
				if (released) return;
				released = true;
				claims = Math.max(0, claims - 1);
				if (claims === 0) set({ presenterClaimed: false });
			};
		},
	}),
);
