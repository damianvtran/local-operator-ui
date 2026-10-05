/**
 * The sidebar's half of the federated read: ONE ambient observer over the
 * peers-inclusive catalogue, and the write that lands its remote rows in the
 * canonical sessions store.
 *
 * WHY AN AMBIENT MOUNT AND NOT A SIDEBAR EFFECT. The sidebar's own catalogue
 * poll must never carry `include_peers` (it runs on a seconds-long timer and the
 * federated listing dials every peer's relay under a 12 s budget - the
 * constraint `chat-device-slot.tsx` states), so the remote rows need a read of
 * their own, and a read of their own needs ONE home that runs whether or not
 * any particular surface is mounted. This component is that home: it renders
 * null, it is mounted once in the app's shell (`app.tsx`), and it is the only
 * observer of `useMeshSessions` that asks for an interval - the Mesh tab and the
 * device control read the same cache entry with `poll: false` and ride this one,
 * so the app issues ONE federated read per 30 s window rather than one per
 * surface.
 *
 * THE GATES, both of them, because either alone is wrong. `enabled` is the
 * caller's capability answer (`features.peers`): a daemon that cannot serve the
 * federated list issues nothing at all. MEMBERSHIP is the second fact - the key
 * is advertised on every install, "including a machine in no network" - so the
 * read runs only while `useMeshMembership` says `member`, and a device in no
 * network short-circuits to no call. Membership is the rail's one-shot read of
 * the networks catalogue (one per window, `poll: false`, deliberately: that
 * listing dials peers too); a network joined WHILE the window is up is noticed
 * when any mesh surface refetches that entry - the tab's mount, the device
 * control's `Check again` - and this sync then starts on its own.
 *
 * WHAT IT WRITES, precisely: `settlePeerCatalogue`, the store action whose own
 * docstring carries the merge, settlement and pruning rules. This component
 * owns only the seam - when an answer lands, it is handed to the store - and the
 * effect runs once per answer because React Query's structural sharing keeps a
 * deep-equal refetch's payload reference, so a poll that changed nothing costs
 * one abortive comparison rather than a second write.
 */
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type FC, useEffect } from "react";
import { useMeshMembership, useMeshSessions } from "./mesh-store";
import { toCatalogueRow } from "./mesh-types";

export const PeersCatalogueSync: FC<{ enabled: boolean }> = ({ enabled }) => {
	const membership = useMeshMembership(enabled);
	const read = useMeshSessions(enabled && membership === "member", {
		poll: true,
	});
	const settle = useCanonicalSessionsStore(
		(state) => state.settlePeerCatalogue,
	);
	useEffect(() => {
		if (!read.data) return;
		settle(read.data.rows.map(toCatalogueRow), read.data.requestedAt);
	}, [read.data, settle]);
	return null;
};
