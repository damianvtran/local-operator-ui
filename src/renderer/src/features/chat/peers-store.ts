/**
 * The mesh's peer catalogue (`GET /v1/desktop/peers`), as the sidebar and `/new`
 * read it.
 *
 * DELIBERATELY NOT FOLDED INTO `canonical-sessions-store` (`mesh-ui.md` §2.2):
 * sessions and peers have different fetch cadences and different failure modes,
 * and one store would make a peer-catalogue error blank the chats list - the
 * surface that still works when the mesh does not. A failed read here leaves the
 * last known peers in place and says so through `error`; it never touches a row.
 *
 * A React Query hook rather than a zustand store, although the plan names a store:
 * this app's other catalogue reads (`profiles.list`, `teams.list`, `capabilities`)
 * are all `useQuery`, and a second caching idiom beside the established one is a
 * defect. The file keeps the plan's name so the reader who looks for it finds it.
 *
 * The renderer never dials a peer. Everything here arrives through the one backend
 * the app already talks to; the relay behind it does the dialling.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useQuery } from "@tanstack/react-query";
import type { PeerRow } from "../../../../shared/desktop-session-contract";
import {
	networkTopology,
	peerList,
	text,
} from "../../../../shared/mesh-shapes";

export const peerKeys = {
	peers: ["desktop", "mesh", "peers"] as const,
	networks: ["desktop", "mesh", "networks"] as const,
};

/**
 * How often the peer list is re-read while mounted.
 *
 * Reachability is a LIVE probe on the backend (`relay.peer_status`, bounded by
 * `LISTING_PROBE_BUDGET_S`), so the list is not free; 30 s is the catalogue's own
 * safety poll (`CATALOGUE_SAFETY_POLL_MS`), which keeps a peer going unreachable
 * and the rows filed under it on one cadence rather than two.
 */
export const PEER_POLL_MS = 30_000;

/**
 * `enabled` is `features.peers`: absent, nothing is asked and nothing mounts.
 *
 * THE ANSWER IS NORMALISED, NOT CAST (round-1 agent review, M3; addendum 2, D):
 * `peerList` dedupes by device id (the relay's `peer_status` answers one entry per
 * network membership, so a device in two networks arrives twice) and gives every
 * field the empty answer for its type, so no renderer can throw on a sparse row.
 */
export function usePeers(enabled: boolean) {
	return useQuery({
		queryKey: peerKeys.peers,
		enabled,
		queryFn: async () =>
			peerList(await desktopResult<unknown>({ op: "peers.list" })),
		staleTime: 10_000,
		refetchInterval: enabled ? PEER_POLL_MS : false,
		retry: false,
	});
}

/** The Networks tab's read: one entry per network, members per network. */
export function useNetworks(enabled: boolean) {
	return useQuery({
		queryKey: peerKeys.networks,
		enabled,
		// Normalised for the same reason `usePeers` is: `layoutTopology` reads every
		// member's `name` and `reason`, and a sparse one used to throw inside the
		// graph's render, i.e. blank the window (M3).
		queryFn: async () =>
			networkTopology(await desktopResult<unknown>({ op: "networks.list" })),
		staleTime: 10_000,
		refetchInterval: enabled ? PEER_POLL_MS : false,
		retry: false,
	});
}

/**
 * A device's display label: its name, else the id's tail.
 *
 * The tail rather than the whole id because a 34-character hash does not fit a
 * 179 px title budget and says nothing a person can recognise; the tail is still
 * unique enough to tell two unnamed devices apart. ONE function for every surface
 * (sidebar heading, `/new` choice, graph node, hover card), so one device is never
 * spelled two ways on one screen.
 */
export function deviceLabel(device: { device_id: string; name: string }) {
	/*
	 * `text` rather than `device.name.trim()`: the label is computed during
	 * `ChatSidebar`'s render, and a row that reached this function without a name
	 * used to take the whole window down with it (the reviewer's reproduction, M3).
	 * One spelling of "absent" for the app, defined in `mesh-shapes.ts`.
	 */
	const name = text(device.name);
	if (name) return name;
	return `device …${text(device.device_id).slice(-6)}`;
}

export type { PeerRow };
