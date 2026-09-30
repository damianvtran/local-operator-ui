/**
 * Where the unsolicited update notice lives while it is not a card.
 *
 * ## Why this is a store and not component state
 *
 * The notice is raised by `UpdateNotification` (mounted at the app root, where
 * the updater's IPC events arrive) but it is DRAWN somewhere else: the quiet
 * indicator is a band in the window's own chrome (`ChatLayout`), because a
 * `fixed` card in a corner is the interruption #672 is about. Two components on
 * either side of the tree, one fact - so the fact lives here.
 *
 * The card itself is not in this store: `UpdateNotification` keeps the release
 * notes, progress and remedies it always did, and this holds only what the OTHER
 * side needs - which surfaces have something waiting, whether the detail is open,
 * and what each surface is being read against.
 *
 * ## Preferences persist; notices do not
 *
 * The followed segment is a user preference and outlives the process (zustand
 * `persist`, the same pattern `deferred-updates-store` uses for its deferrals).
 * The notices are facts about THIS run: a version offered by a process that has
 * since exited is not an offer, so `partialize` keeps them out of storage. A
 * restored "there is an update" that nothing can install is worse than the
 * second of silence it saves.
 *
 * ## The gate is derived, not stamped in
 *
 * `noteQuietOffer` records the OFFER; whether it is spoken about is decided by
 * `segmentCrossed` at READ time, against the running version as it is known then.
 * Stamping the verdict in at note time would freeze it against whatever the
 * running version happened to be when the event landed - and on a cold launch
 * that is `"unknown"`, the renderer's own placeholder, which is unorderable and
 * would therefore silence a real update for the whole session. Derived, the
 * notice appears the moment the version read lands, with no re-raise needed.
 *
 * ## Why there is no `hydrated` flag
 *
 * There was one - written by `onRehydrateStorage`, read by nothing (review R5). A
 * gate on it would have nothing to gate: the storage factory below is
 * SYNCHRONOUS (`localStorage`), and zustand's `persist` rehydrates synchronously
 * against a synchronous storage, so the restored preference is in place before
 * the first render and there is no frame in which the shipped default could be
 * read as the user's own choice. If a storage that answers late is ever taken on
 * here, the flag has to come back WITH the gate that reads it, not before.
 */

import {
	DEFAULT_FOLLOWED_SEGMENT,
	type FollowedSegment,
	isFollowedSegment,
	segmentCrossed,
} from "@shared/utils/update-segment";
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { UpdateType } from "./deferred-updates-store";

/**
 * One surface's waiting release.
 *
 * The version only: the indicator prints it and nothing else, and the card's own
 * detail (notes, installer output, remedies) stays where it is produced.
 */
export type QuietOffer = { version: string };

/** The surfaces, in the order the indicator lists them. */
export const NOTICE_SURFACES: readonly UpdateType[] = [
	UpdateType.UI,
	UpdateType.BACKEND,
];

const perSurface = <T>(
	make: (type: UpdateType) => T,
): Record<UpdateType, T> => ({
	[UpdateType.UI]: make(UpdateType.UI),
	[UpdateType.BACKEND]: make(UpdateType.BACKEND),
});

type UpdateNoticeState = {
	/** Which part of a version change each surface announces on. Persisted. */
	followed: Record<UpdateType, FollowedSegment>;
	/**
	 * The version each surface is being read against, as it is known now.
	 *
	 * `null` until something has told us (the UI read is an IPC round trip). The
	 * distinction from the string `"unknown"` is deliberate: null means "no
	 * reading yet", and both are unorderable to `segmentCrossed`, so the gate is
	 * silent either way rather than guessing.
	 */
	running: Record<UpdateType, string | null>;
	/** The release each surface has waiting, from the updater's own events. */
	offers: Record<UpdateType, QuietOffer | null>;
	/** Whether the release detail is on screen for a surface (the card). */
	detailOpen: Record<UpdateType, boolean>;

	setFollowedSegment: (type: UpdateType, segment: FollowedSegment) => void;
	followedSegment: (type: UpdateType) => FollowedSegment;
	noteRunningVersion: (type: UpdateType, version: string | null) => void;
	noteQuietOffer: (type: UpdateType, offer: QuietOffer) => void;
	clearQuietOffer: (type: UpdateType) => void;
	/**
	 * Forget everything transient about a surface: its offer and its open detail.
	 *
	 * ONE action rather than two calls at every site, because the two must move
	 * together: an offer cleared while its detail stayed open would leave the card
	 * up for a release the app no longer has, and a detail left open after the
	 * offer is gone is the same state one render later.
	 */
	clearSurface: (type: UpdateType) => void;
	openDetail: (type: UpdateType) => void;
	closeDetail: (type: UpdateType) => void;
	/** Drop every transient fact (a fresh test, a story, a signed-out app). */
	resetNotices: () => void;
};

/**
 * Whether the indicator should speak about a surface, from this state alone.
 *
 * A free function rather than a store method so the indicator, the tests and the
 * card's own gate all ask one question with one spelling - and so it can be
 * called with a plain state object rather than only from inside the store.
 */
export const quietOfferShown = (
	state: Pick<
		UpdateNoticeState,
		"followed" | "running" | "offers" | "detailOpen"
	>,
	type: UpdateType,
): boolean => {
	const offer = state.offers[type];
	if (!offer) return false;
	// The detail IS the notice, one step louder: while it is up the indicator has
	// nothing left to say, which is what stops the two appearing at once.
	if (state.detailOpen[type]) return false;
	return segmentCrossed(
		state.followed[type],
		state.running[type],
		offer.version,
	);
};

export const useUpdateNoticeStore = create<UpdateNoticeState>()(
	persist(
		(set, get) => ({
			followed: perSurface(() => DEFAULT_FOLLOWED_SEGMENT),
			running: perSurface(() => null),
			offers: perSurface(() => null),
			detailOpen: perSurface(() => false),

			setFollowedSegment: (type, segment) =>
				set((state) => ({ followed: { ...state.followed, [type]: segment } })),

			followedSegment: (type) => get().followed[type],

			noteRunningVersion: (type, version) =>
				set((state) => ({ running: { ...state.running, [type]: version } })),

			noteQuietOffer: (type, offer) =>
				set((state) => ({ offers: { ...state.offers, [type]: offer } })),

			clearQuietOffer: (type) =>
				set((state) => ({ offers: { ...state.offers, [type]: null } })),

			clearSurface: (type) =>
				set((state) => ({
					offers: { ...state.offers, [type]: null },
					detailOpen: { ...state.detailOpen, [type]: false },
				})),

			openDetail: (type) =>
				set((state) => ({
					detailOpen: { ...state.detailOpen, [type]: true },
				})),

			closeDetail: (type) =>
				set((state) => ({
					detailOpen: { ...state.detailOpen, [type]: false },
				})),

			resetNotices: () =>
				set({
					offers: perSurface(() => null),
					detailOpen: perSurface(() => false),
				}),
		}),
		{
			name: "update-notice-storage",
			/*
			 * An EXPLICIT storage factory that REFUSES an absent store, rather than the
			 * middleware's default `() => localStorage`.
			 *
			 * Zustand's own degradation is keyed on `createJSONStorage` returning
			 * undefined, which it does only when the factory THROWS. Node's `localStorage`
			 * is a declared global that is `undefined` without `--localstorage-file`, so
			 * the default factory does not throw, `createJSONStorage` builds a wrapper
			 * around `undefined`, and the first write rejects asynchronously with
			 * "Cannot read properties of undefined (reading 'setItem')" - an
			 * unhandled rejection with no frame in it, which is what the DOM-less harnesses
			 * in this repo's desktop suite (a hand-rolled React, no jsdom) started seeing
			 * the moment this store was mounted by `UpdateNotification`.
			 *
			 * Throwing here hands the middleware the answer it has a branch for: warn once
			 * and keep the store in memory. A preference that cannot be persisted is a
			 * preference that lasts the session, and that is strictly better than a broken
			 * component in every environment without a DOM.
			 */
			storage: createJSONStorage(() => {
				if (typeof localStorage === "undefined" || localStorage === null) {
					throw new Error("no localStorage in this environment");
				}
				return localStorage;
			}),
			/*
			 * ONLY the preference. See the header: a restored notice would describe
			 * a release offered by a process that is gone.
			 */
			partialize: (state) => ({ followed: state.followed }),
			/*
			 * A stored value is user data and can be anything - an older build's
			 * spelling, a hand-edited file - so the restored half is validated
			 * rather than trusted, per surface. An unrecognised value falls back to
			 * the default instead of reaching `segmentCrossed`, which would compare
			 * it against `MAJOR`/`MINOR` and, matching neither, silently pick patch.
			 */
			merge: (persisted, current) => {
				const stored = (persisted ?? {}) as {
					followed?: Partial<Record<UpdateType, unknown>>;
				};
				const followed = perSurface((type) => {
					const value = stored.followed?.[type];
					return isFollowedSegment(value) ? value : DEFAULT_FOLLOWED_SEGMENT;
				});
				return { ...current, followed };
			},
		},
	),
);
