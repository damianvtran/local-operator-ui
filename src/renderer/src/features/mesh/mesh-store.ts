/**
 * The Mesh tab's reads: two react-query hooks and the state machine that decides
 * what the tab paints.
 *
 * WHY REACT QUERY AND NOT A STORE, although the plan calls the file `mesh-store.ts`:
 * every other catalogue read in this app (`profiles.list`, `teams.list`,
 * `capabilities`) is a `useQuery`, and a second caching idiom beside the
 * established one is a defect. The file keeps the plan's name so the reader who
 * looks for it finds it.
 *
 * DELIBERATELY NOT FOLDED INTO `canonical-sessions-store` (the plan §3): sessions
 * and mesh facts have different fetch cadences, different failure modes and
 * different lifetimes, and folding them would make one backend error blank both
 * surfaces. A failed read here leaves the last known mesh painted and says so; it
 * never touches a session row.
 *
 * POLL, NOT STREAM, at 30 s WHILE THE TAB IS MOUNTED AND VISIBLE - and the cadence
 * is now stated per OBSERVER, because review round 2 (R2-1) caught this file
 * claiming something the code no longer did:
 *
 *   - a mesh listing DIALS every peer on the backend (`relay.peer_status` under
 *     `LISTING_PROBE_BUDGET_S = 12.0`), so it is not free, and the peer-session
 *     projection behind it is TTL-cached at 20 s (`session/peer_rows.py`), whose own
 *     docstring says a listing that dials peers "does not belong on a two-second
 *     timer";
 *   - 30 s is the app's own catalogue cadence (`CATALOGUE_SAFETY_POLL_MS`), so a
 *     peer going unreachable and the rows filed under it stay on ONE clock;
 *   - `refetchIntervalInBackground` is left at its default `false`, so a window in
 *     the background costs nothing - unlike the capabilities poll, which runs in
 *     background for a reason of its own;
 *   - and THE PAGE IS THE ONLY POLLER. The rail (`sidebar-navigation.tsx`) is mounted
 *     on every route and reads this same cache entry for its row, so its observer
 *     asks for NO interval: it makes ONE read when the window starts and then rides
 *     whatever the page's observer fetches while the tab is open. Before round 2 the
 *     rail inherited this 30 s interval, which turned an always-mounted component
 *     into a fan-out to every peer, every 30 seconds, on every screen - the cost the
 *     membership gate exists to avoid paying.
 *
 * ONE READ, NOT ZERO, and that is the honest floor rather than a choice: membership
 * cannot be known without asking (lop advertises `peers` on every install and the
 * catalogue's emptiness is the fact), so a mesh-capable daemon serves exactly one
 * `networks.list` per window for the rail. A daemon that does not advertise `peers`
 * issues nothing at all, because `enabled` is the capability.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	type DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { useQuery } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { type MeshGraph, meshGraph } from "./mesh-graph";
import { type MeshMembership, meshMembership } from "./mesh-membership";
import {
	EMPTY_SLOTS,
	type MeshSlots,
	type SlotCandidate,
	assignSlots,
} from "./mesh-positions";
import {
	type NetworkTopology,
	type PeerList,
	networkTopology,
	peerList,
} from "./mesh-types";

export const meshKeys = {
	peers: ["desktop", "mesh", "peers"] as const,
	networks: ["desktop", "mesh", "networks"] as const,
};

/** The catalogue's own safety cadence. See this file's header for the arithmetic. */
export const MESH_POLL_MS = 30_000;

/**
 * `GET /v1/desktop/peers`, normalised.
 *
 * `enabled` is `features.peers`: absent, nothing is asked and nothing mounts. The
 * ANSWER IS NORMALISED, NOT CAST, for the reason `mesh-types.ts` documents at
 * length - a sparse row used to take the whole window down through the app root's
 * error boundary.
 */
export function useMeshPeers(enabled: boolean) {
	return useQuery({
		queryKey: meshKeys.peers,
		enabled,
		queryFn: async () =>
			peerList(await desktopResult<unknown>({ op: "peers.list" })),
		retry: false,
		staleTime: 10_000,
		refetchInterval: enabled ? MESH_POLL_MS : false,
	});
}

/** `GET /v1/desktop/networks`, normalised: one entry per network, members per network.
 *
 * `poll: false` is for the RAIL, which is mounted on every route and needs the
 * membership fact rather than a live topology: an always-mounted observer with this
 * file's 30 s interval turns one read into a background fan-out to every peer on every
 * screen (review round 2, R2-1). Its observer asks for no interval, no window-focus
 * refetch and an infinite `staleTime`, so it reads once when the window starts and then
 * RIDES the page's observer through the shared cache entry - the same `queryKey`, so
 * one fetch serves both.
 */
export function useMeshNetworks(
	enabled: boolean,
	{ poll = true }: { poll?: boolean } = {},
) {
	return useQuery({
		queryKey: meshKeys.networks,
		enabled,
		queryFn: async () =>
			networkTopology(await desktopResult<unknown>({ op: "networks.list" })),
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? MESH_POLL_MS : false,
		refetchOnWindowFocus: poll,
	});
}

/* -------------------------------------------------------------- membership */

/**
 * The membership gate's hook: the pure rule is `mesh-membership.ts` (testable without a
 * query client), and this is where it is fed - the page reads the catalogue anyway, so
 * this shares its one cache entry rather than issuing a second read.
 */
export function useMeshMembership(enabled: boolean): MeshMembership {
	const networks = useMeshNetworks(enabled, { poll: false });
	return meshMembership({ enabled, networks: networks.data });
}

/* ------------------------------------------------------------------ states */

export type MeshViewState =
	/** No answer yet: the tab has nothing to paint but has not failed. */
	| { kind: "loading" }
	/** A read failed and there is nothing to paint behind it. */
	| { kind: "error"; message: string }
	/** Answered, and this device is in no network at all. */
	| { kind: "empty" }
	/** Answered, and there is a topology to draw. */
	| { kind: "ready" };

export type MeshReads = {
	peers: {
		data: PeerList | undefined;
		isPending: boolean;
		isFetching: boolean;
		isError: boolean;
		error: unknown;
	};
	networks: {
		data: NetworkTopology | undefined;
		isPending: boolean;
		isFetching: boolean;
		isError: boolean;
		error: unknown;
	};
};

/**
 * Which of the four states the tab is in, from the two reads.
 *
 * PURE, and it takes only the fields it reads, so the state machine is exercised
 * without a renderer - there is no jsdom in this tree (`scripts/ask-options.test.mjs`
 * records the same call for its own hook).
 *
 * THE RULES, in the order they are asked:
 *
 *   1. **A LAST GOOD ANSWER WINS OVER A FAILURE.** The canvas never blanks because a
 *      poll failed: the plan's rule is that the last good topology stays painted, and
 *      a read that failed must not turn facts into zeros - "unreachable" and
 *      "unknown" are different claims.
 *   2. **`empty` is the ANSWERED empty**, never the absence of an answer: with no load
 *      yet, an empty mesh and a slow read look identical, and a tab that shows its
 *      "no network here" copy before a read comes back tells the user their machine
 *      is in no mesh before anything said so.
 *   3. **The error's own sentence travels verbatim.** A mesh refusal carries the
 *      relay's or the transport's OWN words; composing a sentence over it would
 *      paraphrase a remedy the machine already named.
 */
export function meshReadState(
	reads: Pick<MeshReads, "peers" | "networks">,
): MeshViewState {
	const topology = reads.networks.data;
	const peers = reads.peers.data;
	if (!topology || !peers) {
		const failure = reads.networks.error ?? reads.peers.error;
		const settled =
			reads.networks.isError ||
			reads.peers.isError ||
			(!reads.networks.isPending && !reads.peers.isPending);
		if (failure && settled) {
			return { kind: "error", message: meshErrorMessage(failure) };
		}
		return { kind: "loading" };
	}
	return topology.networks.length === 0 ? { kind: "empty" } : { kind: "ready" };
}

/**
 * The sentence a failed mesh read shows.
 *
 * A desktop failure already carries an authored sentence - the route's own, or the
 * transport's - and `backendLoadErrorMessage` composes a diagnosis and a remedy from
 * the transport outcome. The authored sentence is preferred when there is one,
 * because the backend's refusals here are written for this surface ("the relay is
 * not running" is a different fact from "the peer said no"), and a paraphrase is how
 * two surfaces come to disagree about the remedy.
 */
export function meshErrorMessage(error: unknown): string {
	const authored = (error as Partial<DesktopControlError> | null)?.message;
	if (typeof authored === "string" && authored.trim()) return authored.trim();
	return backendLoadErrorMessage("The mesh could not be read.", error);
}

/* ------------------------------------------------------------------- model */

/**
 * The model, RE-DERIVED ONLY WHEN A READ'S PAYLOAD IDENTITY CHANGES.
 *
 * React Query's `structuralSharing` (on by default) substitutes the previous
 * payload for a deep-equal refetch, so a poll that changed nothing hands back the
 * SAME object reference and this `useMemo` does not recompute - which is the plan's
 * structural invariant ("a poll that changes nothing does not re-solve layout"),
 * asserted at the unit level in `scripts/mesh-tab.test.mjs` rather than timed here.
 */
export function useMeshGraph(reads: MeshReads): MeshGraph | null {
	const topology = reads.networks.data;
	const peers = reads.peers.data;
	return useMemo(
		() => (topology && peers ? meshGraph({ topology, peers }) : null),
		[topology, peers],
	);
}

/** The ids a column must place, in the order a fresh assignment uses. */
function candidates(
	nodes: readonly { id: string; label: string }[],
): SlotCandidate[] {
	return nodes.map((node) => ({ key: node.id, label: node.label }));
}

/**
 * The pinned slot assignment for this graph.
 *
 * THE ASSIGN-ONCE RULE, in one place: the memo is keyed on the columns' IDENTITY -
 * the sorted ids - so a poll with the same devices re-derives NOTHING (the returned
 * map is the same reference, the geometry memo below is stable, and no node moves or
 * re-renders). The map itself lives in a ref, which is what makes the assignment
 * "once and retained" rather than "per graph": a device that leaves frees its slot
 * for the next arrival, and every device that stayed keeps the row it had.
 *
 * A LABEL CHANGE DOES NOT RE-DERIVE, deliberately: labels only decide the order of a
 * column's FIRST assignment, and re-sorting a live column is exactly the reshuffle
 * the pins exist to prevent.
 */
export function useMeshSlots(graph: MeshGraph | null): MeshSlots {
	const identity = graph
		? [
				...graph.networks.map((network) => `n:${network.id}`),
				...graph.devices.map((device) => `d:${device.id}`),
			].sort()
		: [];
	const key = identity.join("|");
	const pinned = useRef<MeshSlots>(EMPTY_SLOTS);
	/*
	 * The memo is keyed on the columns' IDENTITY (`key`), not on `graph`: a poll whose
	 * payload is deep-equal hands back the same graph reference, so a `[graph]` key
	 * would re-run this on every poll - and a NEW slot map is a new geometry, which is
	 * a reassigned position and a node that moved under the pointer. `graph` is read
	 * for the labels a FIRST assignment sorts by, and those are only consulted when the
	 * identity changed.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: keyed on the columns' identity so a poll with the same devices re-derives nothing; `graph` supplies the labels a first assignment sorts by.
	return useMemo(() => {
		if (!graph) return EMPTY_SLOTS;
		const next: MeshSlots = {
			networks: assignSlots(
				pinned.current.networks,
				candidates(graph.networks),
			),
			devices: assignSlots(pinned.current.devices, candidates(graph.devices)),
		};
		pinned.current = next;
		return next;
	}, [key]);
}
