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
 * surfaces. A failed read here leaves the last known mesh painted and says so.
 *
 * WHAT THIS READ DOES DO WITH SESSION ROWS, since the sidebar's merge arrived: its
 * REMOTE rows land in that store through `settlePeerCatalogue`, applied by this
 * read's ambient consumer (`features/mesh/peers-catalogue.tsx`) - that is the one
 * write, it is the sidebar's half of this read, and it lives in the store's own
 * rules rather than here. Everything else about the read stays here.
 *
 * POLL, NOT STREAM, at 30 s WHILE THE APP IS UP AND IN A NETWORK - and the
 * cadence is now stated per OBSERVER, a rule that has survived three reviews in
 * this file:
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
 *   - and THE AMBIENT MOUNT IS THE ONLY POLLER (`features/mesh/peers-catalogue.tsx`,
 *     the one observer that carries this 30 s interval). The sidebar's poll must
 *     never carry `include_peers` (its timer is seconds long; this read dials every
 *     peer), so the REMOTE ROWS reach the sidebar through this read's own ambient
 *     consumer, which lands them in the canonical store
 *     (`settlePeerCatalogue`). The Mesh tab's observer and the device control ask
 *     for NO interval and ride the ambient entry - the inverse of what this file
 *     said while the page was the only poller, and the same fix for the same cost:
 *     before round 2 the rail inherited the interval and every screen fanned out to
 *     every peer every 30 seconds.
 *
 * ONE READ, NOT ZERO, and that is the honest floor rather than a choice: membership
 * cannot be known without asking (lop advertises `peers` on every install and the
 * catalogue's emptiness is the fact), so a mesh-capable daemon serves exactly one
 * `networks.list` per window for the rail. A daemon that does not advertise `peers`
 * issues nothing at all, because `enabled` is the capability. The ambient mount
 * holds THIS read to the devices that ARE in a network: a member costs one
 * federated read per 30 s window, and a device in no network short-circuits to no
 * call at all, so an unpaired install renders exactly the sidebar it always had.
 */

import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	type DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useRef } from "react";
import { type MeshGraph, meshGraph } from "./mesh-graph";
import { type MeshMembership, meshMembership } from "./mesh-membership";
import {
	EMPTY_SLOTS,
	type MeshSlots,
	type SlotCandidate,
	assignSlots,
} from "./mesh-positions";
import { type MeshedSessions, sessionsByDevice } from "./mesh-sessions";
import {
	type MeshRefusal,
	type MeshSessionRow,
	type NetworkTopology,
	type PeerList,
	type TransferReceipt,
	meshRefusal,
	networkTopology,
	peerList,
	sessionRows,
	transferReceipt,
} from "./mesh-types";

export const meshKeys = {
	peers: ["desktop", "mesh", "peers"] as const,
	networks: ["desktop", "mesh", "networks"] as const,
	sessions: ["desktop", "mesh", "sessions"] as const,
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
 *
 * `poll: false` IS THE SAME OFFER `useMeshNetworks` MAKES, for the same reason and
 * a second caller. A read of this catalogue reaches a peer through the relay, and an
 * always-mounted observer on a surface that is not ABOUT the mesh - the chat
 * header's device chip, which is on screen for every conversation - would turn one
 * header into a fan-out on every screen (the defect the rail's observer caused,
 * review round 2, R2-1). A `poll: false` observer reads once when the window starts
 * and then rides the shared cache entry, because the `queryKey` is the same one the
 * Mesh tab uses: one fetch serves both.
 */
export function useMeshPeers(
	enabled: boolean,
	{ poll = true }: { poll?: boolean } = {},
) {
	return useQuery({
		queryKey: meshKeys.peers,
		enabled,
		queryFn: async () =>
			peerList(await desktopResult<unknown>({ op: "peers.list" })),
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? MESH_POLL_MS : false,
		refetchOnWindowFocus: poll,
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

/**
 * How many rows the tab asks the catalogue for.
 *
 * THE PAGE IS THE BOUND, and the number is a cost decision rather than a display
 * one: `sessions.list` reads a transcript-tail preview PER ROW (the sidebar's own
 * note on why its poll is not cheap), and the peer half of this read dials every
 * peer's relay under a 12 s fan-out budget. 200 rows is enough to fill every chip
 * row on a realistic mesh and to show a device with forty conversations as "+36
 * more" rather than as four - while staying inside the catalogue's own 500-row
 * ceiling with room for a second device's page to arrive in the same answer.
 *
 * THE TAB SAYS WHAT IT IS NOT SHOWING. A device whose `session_count` (the peer
 * catalogue's count) exceeds the rows in hand renders "showing 4 of 37"; a count is
 * a fact and a truncation nobody mentions is a wrong one.
 */
export const MESH_SESSION_PAGE = 200;

/**
 * The ambient read's payload: the federated rows, and the sequence the request
 * took when it started (the store's own currency - `beginAnswer`).
 */
export type PeersCatalogueAnswer = {
	rows: MeshSessionRow[];
	requestedAt: number;
};

/**
 * `GET /v1/desktop/sessions?include_peers=true`, normalised.
 *
 * THE ONE PLACE IN THIS APP THAT ASKS FOR THE FEDERATED LIST. It is asked by ONE
 * ambient observer (`features/mesh/peers-catalogue.tsx`, mounted in the app's
 * shell) on the 30 s cadence above, while this device is in a network; the Mesh
 * tab reads the same cache entry with `poll: false`, riding that observer -
 * the one federated read serves every surface rather than each adding its own
 * poll. The SIDEBAR'S OWN POLL MUST NEVER CARRY `include_peers` (it would dial
 * every peer's relay on the sidebar's timer) - the remote rows reach the
 * sidebar only through this read's ambient consumer, which lands them in the
 * canonical store (`settlePeerCatalogue`).
 *
 * THE ANSWER CARRIES THE REQUEST'S OWN SEQUENCE BESIDE ITS ROWS: the store's
 * settlement currency orders an answer against writes made while it was in
 * flight, and only the query function knows when the request started
 * (`beginAnswer`'s own docstring carries the rule). The sequence is the
 * CALLER's to supply (`stamp`) rather than read here, and that seam is
 * deliberate: this module is bundled by `scripts/mesh-tab.test.mjs` (through
 * `mesh-approvals`), whose esbuild carries only the `@shared` alias, so a
 * module-level import of the canonical store would drag `@features/*`
 * specifiers into a bundle that cannot resolve them. Both fetching call sites -
 * the ambient observer below and the Mesh tab's own recheck - pass the
 * canonical store's `beginAnswer`, captured inside the query function.
 *
 * `retry: false` and a 30 s cadence, matching the other two reads here: a failed
 * listing leaves the last good rows painted, and a refused one is the backend's own
 * sentence rather than a second attempt nobody asked for.
 */
export function useMeshSessions(
	enabled: boolean,
	{
		stamp,
		poll = true,
	}: {
		/** The canonical store's answer sequence, called at request start. */
		stamp: () => number;
		/** Ask for NO interval and ride whatever observer owns the fetch. */
		poll?: boolean;
	},
) {
	return useQuery({
		queryKey: meshKeys.sessions,
		enabled,
		queryFn: async (): Promise<PeersCatalogueAnswer> => {
			const requestedAt = stamp();
			const rows = sessionRows(
				await desktopResult<unknown>({
					op: "sessions.list",
					limit: MESH_SESSION_PAGE,
					include_peers: true,
				}),
			);
			return { rows, requestedAt };
		},
		retry: false,
		staleTime: poll ? 10_000 : Number.POSITIVE_INFINITY,
		refetchInterval: enabled && poll ? MESH_POLL_MS : false,
		refetchOnWindowFocus: poll,
	});
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

/* ------------------------------------------------------------------ writes */

/**
 * What one move answered.
 *
 * A REFUSAL IS AN ANSWER, NOT AN ERROR, and the difference is what the surface
 * does next: a rejected promise would land in react-query's error path, which
 * retries, reports and forgets - while a refusal has to stay on screen beside the
 * chip it belongs to (with the code, the route's own sentence and the action that
 * fixes it). So this resolves for every outcome and the caller branches once.
 *
 * `kind: "unconfirmed"` IS ITS OWN ARM rather than a flag on `refused`, because the
 * instruction is the opposite one: a 503 (or the app's own deadline, which carries
 * `deadline_exceeded`) means the request WAS sent and this device never learned the
 * outcome, so the row is re-read and the move is NEVER repeated - while a refusal
 * means nothing changed and the id is still usable.
 */
export type MoveOutcome =
	| { kind: "moved"; receipt: TransferReceipt }
	| { kind: "refused"; refusal: MeshRefusal }
	| { kind: "unconfirmed"; refusal: MeshRefusal };

/** One move's request, as a caller states it. */
export type MoveAsk = {
	sessionId: string;
	/** The device asked to take it, or `"local"` for a recall to this device. */
	to: string;
	/** `true` forks at the destination and leaves the source running. */
	keep: boolean;
	/**
	 * How long the source may take to go idle before it refuses as `busy`.
	 *
	 * ZERO UNLESS THE USER ASKED TO WAIT, and that is the route's own default: a
	 * drop that looked instant must not hold a request for minutes without saying so
	 * (`wait_s` is a ceiling on waiting INSIDE the request). The `busy` refusal's own
	 * remedy re-issues the same move with this raised.
	 */
	waitS?: number;
};

/**
 * Ask for a move.
 *
 * `request_id` IS MINTED PER REQUEST AND SENT ALWAYS. The route journals an
 * UNCONFIRMED move under `transfer:{session_id}:{request_id}`, so a retry of the
 * same id replays the recorded outcome instead of starting a second move; a request
 * that carries no id is a different request on purpose, which is why this is not a
 * field the caller may set. React Query does not retry a mutation by default, so
 * this id is not a retry key here - it is what makes the ROUTE's own at-most-once
 * promise reachable if a future caller ever does retry.
 *
 * THE READS ARE INVALIDATED ON EVERY SETTLED OUTCOME, including a refusal: a
 * refusal is still information about the world (a peer that is not answering, a
 * session that is busy), and the next read is what makes the surface's claim
 * current. Nothing is written optimistically - optimism belongs to the gesture, not
 * to the ownership (`mesh-types.transferReceipt`).
 */
export function useMeshTransfer() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (ask: MoveAsk): Promise<MoveOutcome> => {
			try {
				const raw = await desktopResult<unknown>({
					op: "sessions.transfer",
					sessionId: ask.sessionId,
					to: ask.to,
					keep: ask.keep,
					waitS: ask.waitS ?? 0,
					requestId: crypto.randomUUID(),
				});
				const receipt = transferReceipt(raw);
				if (receipt) return { kind: "moved", receipt };
				/*
				 * AN ANSWER NOBODY CAN ACT ON. A receipt without a session id would
				 * move the wrong chip and one without `new_session_id` would open
				 * nothing, and `transferReceipt` refuses both - so the honest reading
				 * of a 2xx this shape is "this device does not know what happened",
				 * which is exactly the unconfirmed arm rather than a success.
				 */
				return {
					kind: "unconfirmed",
					refusal: {
						code: "unconfirmed",
						sentence:
							"The move answered, and this app could not read which session it moved. Read the list again before asking for another.",
						status: 200,
						unconfirmed: true,
					},
				};
			} catch (error) {
				const refusal = meshRefusal(error);
				return refusal.unconfirmed
					? { kind: "unconfirmed", refusal }
					: { kind: "refused", refusal };
			}
		},
		onSettled: () => {
			// Both reads the answer can contradict: the catalogue (where the row now
			// lives) and the peer counts (which device holds how many).
			void client.invalidateQueries({ queryKey: meshKeys.sessions });
			void client.invalidateQueries({ queryKey: meshKeys.peers });
		},
	});
}

/** The three roles an invite can grant, as the route's own `Literal` spells them. */
export const INVITE_ROLES = ["read", "drive", "admin"] as const;
export type InviteRole = (typeof INVITE_ROLES)[number];

/** What a minted invite answered: the path the token was written to, never the token. */
export type InviteReceipt = { token_path: string; expires_at: number | null };

/**
 * Mint an invite for a network.
 *
 * THE TOKEN NEVER CROSSES THIS API: the route writes it to a file only the machine
 * that will redeem it can read and answers with the PATH, so what a user is told is
 * "the token is at <path>, give it to that device" rather than a string this app
 * ever holds. `device` BINDS the token to one device id when the caller names one,
 * which is why the invite from a DEVICE node sends it: an invite minted for the
 * device on screen should not be redeemable by a third one.
 *
 * NO MEMBERSHIP IS CREATED HERE, and the answer says so: admission is two-sided
 * (the joining device proves the SAS), so the receipt is an invitation and the
 * member appears once the other device redeems it.
 */
export function useNetworkInvite() {
	return useMutation({
		mutationFn: async (ask: {
			networkId: string;
			role: InviteRole;
			deviceId?: string;
		}): Promise<InviteReceipt> => {
			const raw = await desktopResult<{
				token_path?: unknown;
				expires_at?: unknown;
			}>({
				op: "networks.invite",
				networkId: ask.networkId,
				role: ask.role,
				deviceId: ask.deviceId,
			});
			return {
				token_path: typeof raw?.token_path === "string" ? raw.token_path : "",
				expires_at: typeof raw?.expires_at === "number" ? raw.expires_at : null,
			};
		},
	});
}

/**
 * Revoke a membership: the tombstone, the rotation and the epoch bump.
 *
 * `confirm` IS THE NETWORK'S NAME, typed by the user and compared exactly by the
 * route. This is the one mesh act that changes OTHER devices' state - every peer is
 * rekeyed and the removed device is locked out on its next handshake - so the
 * dialog that produces this string is not a courtesy; it is the request's
 * precondition. The caller passes the typed name through unchanged rather than
 * trimming or case-folding it: a near miss is a refusal the user can read, and
 * "helpfully" repairing it here would defeat the check the route performs.
 */
export function useNetworkMemberRemove() {
	const client = useQueryClient();
	return useMutation({
		mutationFn: async (ask: {
			networkId: string;
			deviceId: string;
			confirm: string;
		}): Promise<{ removed: string; epoch: number }> => {
			const raw = await desktopResult<{ removed?: unknown; epoch?: unknown }>({
				op: "networks.member.remove",
				networkId: ask.networkId,
				deviceId: ask.deviceId,
				confirm: ask.confirm,
			});
			return {
				removed: typeof raw?.removed === "string" ? raw.removed : ask.deviceId,
				epoch: typeof raw?.epoch === "number" ? raw.epoch : 0,
			};
		},
		onSettled: () => {
			void client.invalidateQueries({ queryKey: meshKeys.networks });
			void client.invalidateQueries({ queryKey: meshKeys.peers });
		},
	});
}

/**
 * The rows per device, joined and capped, for the canvas and the panel.
 *
 * A THIN WRAPPER OVER `mesh-sessions.ts`'s PURE JOIN, and it takes the graph rather
 * than the reads so the drawn device set is the same one the layout used: a device
 * the reads know and the canvas did not draw cannot have a chip row, and asking the
 * graph is what keeps the two from disagreeing. `orphans` is passed through for the
 * page to state - a remote row whose owner is not drawn is a real number the tab
 * can see and cannot place.
 */
export function useMeshSessionsByDevice(
	graph: MeshGraph | null,
	rows: readonly MeshSessionRow[],
	selfDeviceId: string | null,
): MeshedSessions {
	const deviceIds = useMemo(
		() => (graph ? graph.devices.map((device) => device.id) : []),
		[graph],
	);
	return useMemo(
		() => sessionsByDevice(rows, selfDeviceId, deviceIds),
		[rows, selfDeviceId, deviceIds],
	);
}
