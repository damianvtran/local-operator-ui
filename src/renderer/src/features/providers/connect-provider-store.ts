/**
 * @file connect-provider-store.ts
 * @description
 * The one door to "connect a model provider" from anywhere in the app.
 *
 * ## Why a store rather than a route
 *
 * The empty-chat card, the composer's status line, the backend's "No model
 * provider is configured yet" notice and the command palette all need to open
 * the same provider list -- and none of them should navigate away from the
 * chat the user is standing in (design audit § 6: "the user never leaves the
 * chat"). A route would unmount the conversation; a store lets any of those
 * four ask, and `ConnectProviderDialog` (mounted once, in the app shell)
 * answer. Zustand is what every other cross-surface request in this renderer
 * uses (`panel-presentation-store.ts`).
 */

import { create } from "zustand";
import type { ProviderGroup } from "./provider-catalog";

type ConnectProviderState = {
	open: boolean;
	/** The group the dialog should open expanded on, e.g. `local`. */
	focusGroup: ProviderGroup | null;
	/** A provider to open directly, e.g. from a notice that names one. */
	providerId: string | null;
	openConnect: (options?: {
		group?: ProviderGroup;
		providerId?: string;
	}) => void;
	closeConnect: () => void;
};

export const useConnectProviderStore = create<ConnectProviderState>()(
	(set) => ({
		open: false,
		focusGroup: null,
		providerId: null,
		openConnect: (options) =>
			set({
				open: true,
				focusGroup: options?.group ?? null,
				providerId: options?.providerId ?? null,
			}),
		closeConnect: () =>
			set({ open: false, focusGroup: null, providerId: null }),
	}),
);

/**
 * The backend's "nothing is configured" notice, as `session/runtime/launch.py`
 * words it. Matched on its stable opening so the transcript can put the
 * connect action on exactly that notice (design § 6, P1).
 */
export const NO_PROVIDER_NOTICE = /No model provider is configured yet/;
