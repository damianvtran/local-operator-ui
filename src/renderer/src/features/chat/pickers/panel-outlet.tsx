/**
 * The shell's presenter for MACHINE panels — the second host for the one
 * presentation slot.
 *
 * ## Why a second host exists at all
 *
 * A machine panel (`/info`, `/usage`, `/analytics`) describes the MACHINE: the
 * install and its runtimes, the provider ledger, the analytics ledger. None of
 * the three reads a conversation, so none of them may be refused for want of one
 * — and none of them needs to move the user to chat to be read. That is the
 * whole of this component's reason to exist: the palette used to write a request
 * and then ROUTE to `/chat` so the pane could answer it, which threw a user
 * reading Settings out of Settings to show them a page that describes the
 * machine they are already on.
 *
 * ## Why it presents `kind === "machine-panel"` and nothing else
 *
 * The session-scoped destinations (`/model`, `/goal`, `/session`, …) need the
 * chat pane's own handles — its canonical stream, its command catalogue, its
 * rebind path, its `note` — and none of those is a thing a route-independent
 * store can hold: a store that did would be holding a handle the route can tear
 * down under a modal. So this host ignores them; the pane remains their only
 * presenter, and `command-palette.tsx` still routes to chat for them.
 *
 * ## Arbitration
 *
 * Two hosts are mounted at once on every chat route, and exactly one acts. The
 * question is "is a presenter already here", asked of the presenters rather than
 * of the route: `useSlashDispatch` claims the slot on mount and releases it on
 * unmount, and this host presents only while no claim is outstanding. A route
 * check would have been the tempting predicate and the wrong one — the chat
 * route also paints its connecting and error states, where nothing can present
 * anything, so a route check would strand a request until it expired.
 *
 * That comparison is read with `getState()` inside the effect rather than as a
 * subscribed value, because it is a fact about the moment the request ARRIVES:
 * subscribing would re-run this effect when a claim flips, which is a different
 * question (and would consume a request that has already been answered).
 *
 * ## The one race, and why there is not one
 *
 * A request written in the same React commit that mounts a pane would be decided
 * before the pane's claim ran, because effects fire child-first in tree order
 * and this host is mounted before `<main>`. It cannot happen: the only writer of
 * a request is the command palette (`command-palette.tsx`), and for a
 * `machine-panel` destination it deliberately does NOT navigate — so a machine
 * panel request never arrives in a commit that mounts a pane. A pane that is
 * already up claimed long ago, which is the case the guard above is for.
 */

import {
	PANEL_REQUEST_TTL_MS,
	usePanelPresentationStore,
} from "@shared/store/panel-presentation-store";
import { type FC, useCallback, useEffect, useRef, useState } from "react";
import type { NativeDesktopAction } from "../../../../../shared/desktop-control-contract";
import { machinePanelFor } from "./picker-registry";

/** What this host holds between the request and the panel's own close. */
type PresentedMachinePanel = {
	destination: string;
	action: NativeDesktopAction;
};

export const PanelOutlet: FC = () => {
	const request = usePanelPresentationStore((state) => state.request);
	const consumePanel = usePanelPresentationStore((state) => state.consumePanel);
	const [panel, setPanel] = useState<PresentedMachinePanel | null>(null);
	/*
	 * The control that was focused when the request arrived, so Escape lands
	 * somewhere the user recognises. Recorded rather than assumed: the palette
	 * row that asked for this closed with the palette, and restoring focus to a
	 * node the palette removed is what the pane's own rule exists to avoid.
	 */
	const invoker = useRef<HTMLElement | null>(null);

	const closePanel = useCallback(() => {
		setPanel(null);
		const origin = invoker.current;
		invoker.current = null;
		if (!origin) return;
		/*
		 * After Radix has unmounted the dialog and done its own restoration, so
		 * this is the last word rather than a race with it — the same ordering the
		 * pane's `closePicker` uses. A node that is no longer in the document is
		 * skipped rather than focused: focusing one is the silent no-op that
		 * produces the "focus went nowhere" bug, and this host has no composer to
		 * fall back to.
		 */
		requestAnimationFrame(() => {
			if (origin.isConnected) origin.focus();
		});
	}, []);

	useEffect(() => {
		if (!request) return;
		if (usePanelPresentationStore.getState().presenterClaimed) return;
		/*
		 * Past the TTL nothing is waiting for this request, so it is retired
		 * rather than acted on. Any host may do it — the pane's consumer makes the
		 * same decision — and doing it here is what keeps the store from holding a
		 * stale destination for the life of the window on the routes no pane ever
		 * mounts on.
		 */
		if (Date.now() - request.requestedAt > PANEL_REQUEST_TTL_MS) {
			consumePanel(request.nonce);
			return;
		}
		/*
		 * A destination this host cannot present is LEFT in the store: the pane is
		 * its presenter, and the palette's navigation is what mounts one. Consuming
		 * it here would turn a pane-only row into a control that closes the palette
		 * and opens nothing.
		 */
		if (!machinePanelFor(request.destination)) return;
		invoker.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
		consumePanel(request.nonce);
		setPanel({
			destination: request.destination,
			action: {
				kind: "native_action",
				destination: request.destination,
				/* No conversation to address: `""` is the panel's own way of saying
				 * "there is none in front of the user", and it is what drops the
				 * conversation section and the session scope control. */
				session_id: "",
				args: "",
				fields: [],
				data: {},
			},
		});
	}, [request, consumePanel]);

	const Component = panel ? machinePanelFor(panel.destination) : undefined;
	if (!panel || !Component) return null;
	/*
	 * `frontend: null` for the same reason as `session_id: ""`: the conversation
	 * facts live on the pane's canonical handle, which is not mounted. The panel
	 * renders its machine half and omits the conversation half by construction.
	 */
	return (
		<Component
			key={panel.destination}
			action={panel.action}
			sessionId=""
			frontend={null}
			onClose={closePanel}
		/>
	);
};
