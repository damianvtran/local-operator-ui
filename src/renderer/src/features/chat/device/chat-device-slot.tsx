/**
 * The device control, wired to the app's own facts.
 *
 * WHAT THIS FILE OWNS, AND WHAT IT REFUSES TO OWN. "Where does this conversation
 * run" has three sources, and each is read from the surface that already holds it
 * rather than re-derived here:
 *
 * - a NEW CHAT's destination is the draft row's own field (`ChatDraft.peer`) - the
 *   same field `sessions.create` sends on the first send. It is app state rather
 *   than backend state, which is why the chip can answer before any runtime exists;
 * - a LIVE conversation's placement is what this pane knows: `local`, or wherever a
 *   move this pane issued landed, taken from the receipt because a receipt is the
 *   only thing that may move a chip (`mesh-types.transferReceipt`);
 * - the PICKER's rows are the mesh's own reads (`peers.list`, `networks.list`).
 *
 * NO NEW FEDERATED READ ON THE CHAT SURFACE, and the ONE federated read the app
 * does make is neither this control's nor the sidebar's: `sessions.list?include_peers`
 * dials every peer's relay under a 12 s budget and the sidebar's poll must never
 * carry it, so it is asked by ONE ambient observer
 * (`features/mesh/peers-catalogue.tsx`) on its own 30 s cadence, whose remote rows
 * land in the canonical store for every surface to read. This control asks only
 * for the two cheap mesh reads (`poll: false`: one read per window, riding
 * whatever the rail or the tab already fetched), with `Check again` as the one
 * explicit re-read. That is the whole cost of having a device control on every
 * conversation.
 *
 * GATING FOLLOWS THE APP'S OWN RULE. `features.peers` is what makes the control
 * exist at all: a control rendered for a capability the backend cannot serve
 * advertises something that cannot work, which is how `app.tsx` gates `session_pins`
 * and `projects`. `features.session_transfer` gates the MOVE and only it, so a
 * daemon that can host a network but cannot move a conversation keeps the placement
 * fact and loses the offer.
 */

import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { type FC, useCallback, useMemo } from "react";
import {
	useMeshNetworks,
	useMeshPeers,
	useMeshTransfer,
} from "../../mesh/mesh-store";
import type { NetworkSummary, PeerRow } from "../../mesh/mesh-types";
import {
	type DevicePickerModel,
	type DeviceRow,
	deviceName,
	devicePickerModel,
	movePair,
	panePlacement,
} from "./chat-device-model";
import { useChatDeviceStore } from "./chat-device-store";
import { ChatHeaderDevice } from "./chat-header-device";

/** The rows the picker is currently offering, flattened: one list, one lookup. */
function findRow(model: DevicePickerModel, deviceId: string): DeviceRow | null {
	if (model.self.deviceId === deviceId) return model.self;
	for (const section of model.sections) {
		const row = section.rows.find(
			(candidate) => candidate.deviceId === deviceId,
		);
		if (row) return row;
	}
	return null;
}

/** This device's own name, as its membership headings it; `""` when nobody says. */
function selfName(networks: NetworkSummary[], selfDeviceId: string): string {
	if (!selfDeviceId) return "";
	for (const network of networks) {
		const member = network.members.find(
			(row) => row.device_id === selfDeviceId,
		);
		if (member) return member.name;
	}
	return "";
}

/**
 * A device's display name from the rows the picker is built on.
 *
 * THE DRAFT ROW STORES AN ID AND NOT A NAME, deliberately: a name copied into the
 * draft is a second copy of a membership fact, and it would survive the device
 * being renamed or removed. The id IS the durable half, so the label is resolved at
 * render time and falls back to the id's own tail (`deviceName`) when the mesh has
 * no row for it - a device this window has not read about yet, not an error.
 */
function deviceNameFor(input: {
	deviceId: string;
	networks: NetworkSummary[];
	peers: PeerRow[];
}): string {
	const { deviceId, networks, peers } = input;
	for (const network of networks) {
		const member = network.members.find((row) => row.device_id === deviceId);
		if (member) return member.name;
	}
	const peer = peers.find((row) => row.device_id === deviceId);
	if (peer) return peer.name;
	return deviceName("", deviceId);
}

export const ChatDeviceSlot: FC<{ sessionId?: string; draftKey?: string }> = ({
	sessionId,
	draftKey,
}) => {
	const capabilities = useDesktopCapabilities();
	const peersEnabled =
		desktopFeatureState(capabilities.data, "peers") === "enabled";
	const canTransfer =
		desktopFeatureState(capabilities.data, "session_transfer") === "enabled";
	/*
	 * ONE READ PER WINDOW. The keys are the mesh store's own, so an open Mesh tab
	 * shares these entries instead of doubling them; `poll: false` is what keeps a
	 * device control from becoming a background poller on every conversation - the
	 * defect the rail's own always-mounted observer caused (review round 2, R2-1).
	 */
	const peers = useMeshPeers(peersEnabled, { poll: false });
	const networks = useMeshNetworks(peersEnabled, { poll: false });
	const transfer = useMeshTransfer();
	const draft = useCanonicalSessionsStore((state) =>
		draftKey ? state.drafts[draftKey] : undefined,
	);
	/*
	 * THIS DEVICE'S OWN CONVERSATIONS, with the federated rows excluded: the self
	 * row says how many conversations THIS device holds, and since the ambient
	 * federated read lands remote rows in this same store (the shared convention),
	 * counting `sessions.length` would credit this device with another one's
	 * conversations. A remote row is the one shape that carries `locality:
	 * "remote"`; a plain page's rows carry no locality at all, which is why the
	 * test is "not remote" rather than "local".
	 */
	const localCount = useCanonicalSessionsStore((state) =>
		state.sessions.reduce(
			(count, candidate) =>
				candidate.locality === "remote" ? count : count + 1,
			0,
		),
	);
	const move = useChatDeviceStore((state) =>
		sessionId ? state.moves[sessionId] : undefined,
	);
	/*
	 * THE LIVE CONVERSATION'S OWN ROW, for the one fact the pane cannot carry
	 * itself: where it was created. The row is where `createSession` landed the
	 * peer's placement (see that action), and the row outlives both the draft and
	 * the send that made it - which is what the chip needs and the draft could
	 * not give it (the revert-to-local defect).
	 */
	const row = useCanonicalSessionsStore((state) =>
		sessionId
			? state.sessions.find((candidate) => candidate.session_id === sessionId)
			: undefined,
	);
	const beginMove = useChatDeviceStore((state) => state.beginMove);
	const settleMove = useChatDeviceStore((state) => state.settleMove);
	const refuseMove = useChatDeviceStore((state) => state.refuseMove);
	const setDraftPeer = useCanonicalSessionsStore((state) => state.setDraftPeer);
	const settlePlacement = useCanonicalSessionsStore(
		(state) => state.settlePlacement,
	);

	const networkList = networks.data?.networks ?? [];
	const peerList: PeerRow[] = peers.data?.peers ?? [];
	/*
	 * WHAT THE TWO READS ANSWERED, as three states. `networks.data ?? []` reads the
	 * same for "nothing there" and "nothing answered", and the picker turned the
	 * second into an authoritative membership claim with a `lop network init`
	 * instruction attached (QA Q-4). `pending` matters for the same reason on the
	 * first frames of every window.
	 */
	const readFailed = peers.isError || networks.isError;
	const meshRead: "pending" | "ok" | "failed" = readFailed
		? "failed"
		: peers.isPending || networks.isPending
			? "pending"
			: "ok";
	const selfDeviceId =
		networks.data?.self_device_id ?? peers.data?.self_device_id ?? "";
	const destination = draft?.peer ?? null;
	const destinationName = destination
		? deviceNameFor({
				deviceId: destination,
				networks: networkList,
				peers: peerList,
			})
		: "";

	/*
	 * WHERE THE ROW SAYS THE CONVERSATION LIVES. Only `locality: "remote"` is a
	 * claim - it is the wire's single "where" field, and a local row or a row
	 * that stated nothing must keep today's fallback - and the device id is what
	 * a transfer addresses, so the NAME is resolved from the mesh reads by the
	 * same helper the draft's own destination uses (`deviceNameFor`), with the
	 * row's name used first when it carries one.
	 */
	const host = useMemo(() => {
		if (!row || row.locality !== "remote") return null;
		const deviceId =
			typeof row.owner_device === "string" ? row.owner_device : "";
		if (!deviceId) return null;
		const named =
			typeof row.owner_device_name === "string" ? row.owner_device_name : "";
		return {
			deviceId,
			name:
				named.trim() ||
				deviceNameFor({ deviceId, networks: networkList, peers: peerList }),
		};
	}, [row, networkList, peerList]);

	const placement = useMemo(
		() =>
			panePlacement({
				draft: sessionId
					? null
					: destination
						? { deviceId: destination, name: destinationName }
						: { deviceId: null, name: "" },
				host,
				move,
				reachableFor: (deviceId) => {
					const peer = peerList.find((row) => row.device_id === deviceId);
					if (peer) return peer.reachable;
					for (const network of networkList) {
						const member = network.members.find(
							(row) => row.device_id === deviceId,
						);
						if (member) return member.reachable;
					}
					return null;
				},
			}),
		[
			destination,
			destinationName,
			sessionId,
			move,
			host,
			peerList,
			networkList,
		],
	);

	const model = useMemo(
		() =>
			devicePickerModel({
				placement,
				selfDeviceId,
				selfName: selfName(networkList, selfDeviceId),
				selfConversations: localCount,
				networks: networkList,
				peers: peerList,
				canTransfer,
				meshRead,
				busy: move?.kind === "moving",
			}),
		[
			placement,
			selfDeviceId,
			networkList,
			peerList,
			localCount,
			canTransfer,
			meshRead,
			move,
		],
	);

	const onPick = useCallback(
		(deviceId: string | null, keep: boolean) => {
			const row = deviceId ? findRow(model, deviceId) : null;
			const name = row ? row.name : "this device";
			/*
			 * A DRAFT'S PICK IS A SETTING, EXERCISED ON THE FIRST SEND: it rides the
			 * draft row (and from there the create route's own `peer`) rather than
			 * creating anything here.
			 */
			if (!sessionId) {
				if (!draftKey) return;
				/*
				 * THE DESTINATION HAS ITS OWN ACTION (agent review R2-2). This used to be a bare
				 * `updateDraft(draftKey, { peer })`, which changed the create body without
				 * touching the at-most-once key the body is claimed under: after a
				 * `peer_unreachable` the daemon KEEPS the claim, so changing the destination and
				 * sending again answered `ReceiptConflict` for the life of the pane. `setDraftPeer`
				 * re-mints on a change, exactly as `setDraftModel` does for the same reason.
				 */
				setDraftPeer(draftKey, row ? row.deviceId : null);
				return;
			}
			/*
			 * A PICK ON THE ROW THAT ALREADY HOLDS THE CONVERSATION IS NOT A MOVE. The
			 * picker marks that row `current` (this device here, the holder in the `gone`
			 * state) and pressing it used to issue a transfer to the device the
			 * conversation is already on - a second recall in the recall's own case,
			 * which the receipt then reported as a success (agent review R1-1's second
			 * half, UX U3). The draft is excluded above because there the self row is a
			 * reset, not a move.
			 */
			if (row?.state === "current") return;
			const key = sessionId;
			const to = deviceId ?? "local";
			/*
			 * WHERE IT WAS, for the arrival sentence: a recall's destination is this
			 * device, and "the copy here was deleted" is then the opposite of what
			 * happened. Taken from the placement the pane was showing at the moment of the
			 * pick, which is the only thing that knows the source's name (UX U2).
			 */
			const from =
				placement.kind === "remote" || placement.kind === "gone"
					? placement.name
					: null;
			/*
			 * THE PAIR THE CONFIRMATION OFFERED, rebuilt from the same inputs it was built
			 * from in the dialog: `keep` says which half the user chose, and the refusal
			 * records that half so `Wait for the turn to finish` re-issues the move they
			 * actually asked for rather than a different one.
			 */
			const pair = movePair({
				sessionId,
				recall: to === "local",
				/* The id the pair addresses, the name its verbs say (QA Q2-1). */
				destination: { deviceId: to, name },
				source: from,
			});
			const plan = keep ? (pair.alternatives[0] ?? pair.plan) : pair.plan;
			beginMove(key, { deviceId: to, name, from });
			transfer.mutate(
				/*
				 * `keep` IS THE USER'S ANSWER, from the confirmation this pick went through
				 * (`movePair`, `MoveConfirmDialog`): the destructive default deletes the copy,
				 * and the copy arm is what makes the alternative real (SPEC §3.4).
				 */
				{ sessionId, to, keep },
				{
					onSuccess: (outcome) => {
						if (outcome.kind === "moved") {
							/*
							 * THE ROW IS SETTLED WITH THE CHIP (agent review F1): the receipt is
							 * what the conversation's own row is corrected from, so the placement
							 * survives this pane's move record being dismissed. See
							 * `settlePlacement` for the chain it closes.
							 */
							settlePlacement(sessionId, outcome.receipt);
							settleMove(key, {
								kind: "moved",
								deviceId: to,
								name,
								from,
								receipt: outcome.receipt,
								/*
								 * `engaged: null` IS THE HONEST VALUE TODAY, and this is the one line that
								 * changes when the wire publishes the fact: the receipt the desktop route
								 * returns (`TransferReceipt`) carries phases, locality, owner_device,
								 * source_retired, session_id, new_session_id, mode and replayed - and no
								 * field that says whether the destination STARTED the conversation. So
								 * every arrival renders the cold sentence, which is what every peer that
								 * predates `engage_on_arrival` actually does - and neither the client
								 * nor this comment invents a guess from the peer's build (per-peer
								 * feature version is not on the wire).
								 */
								engaged: null,
							});
							return;
						}
						refuseMove(key, {
							refusal: outcome.refusal,
							name,
							/*
							 * `canWait` IS THE MOVE'S PRESENCE, not the code's name: this pane still
							 * holds the ask, so the button's handler has something to re-issue.
							 */
							canWait: true,
							plan,
							to,
							from,
							keep,
						});
					},
				},
			);
		},
		[
			beginMove,
			draftKey,
			model,
			placement,
			refuseMove,
			sessionId,
			setDraftPeer,
			settleMove,
			settlePlacement,
			transfer,
		],
	);

	if (!peersEnabled) return null;
	return (
		<ChatHeaderDevice
			placement={placement}
			model={model}
			sessionId={sessionId}
			busy={move?.kind === "moving"}
			onPick={onPick}
			onCheckAgain={() => {
				void peers.refetch();
				void networks.refetch();
			}}
		/>
	);
};
