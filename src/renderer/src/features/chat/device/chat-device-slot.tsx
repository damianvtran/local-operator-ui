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
 * NO NEW FEDERATED READ ON THE CHAT SURFACE. `sessions.list?include_peers` is the
 * Mesh tab's read and only its own - it dials every peer's relay under a 12 s
 * budget and the sidebar's poll must never carry it - so this control asks for the
 * two cheap mesh reads (`poll: false`: one read per window, riding whatever the
 * rail or the tab already fetched), with `Check again` as the one explicit re-read.
 * That is the whole cost of having a device control on every conversation.
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
	const localCount = useCanonicalSessionsStore(
		(state) => state.sessions.length,
	);
	const move = useChatDeviceStore((state) =>
		sessionId ? state.moves[sessionId] : undefined,
	);
	const beginMove = useChatDeviceStore((state) => state.beginMove);
	const settleMove = useChatDeviceStore((state) => state.settleMove);
	const refuseMove = useChatDeviceStore((state) => state.refuseMove);
	const updateDraft = useCanonicalSessionsStore((state) => state.updateDraft);

	const networkList = networks.data?.networks ?? [];
	const peerList: PeerRow[] = peers.data?.peers ?? [];
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

	const placement = useMemo(
		() =>
			panePlacement({
				draft: sessionId
					? null
					: destination
						? { deviceId: destination, name: destinationName }
						: { deviceId: null, name: "" },
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
		[destination, destinationName, sessionId, move, peerList, networkList],
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
			}),
		[placement, selfDeviceId, networkList, peerList, localCount, canTransfer],
	);

	const onPick = useCallback(
		(deviceId: string | null) => {
			const row = deviceId ? findRow(model, deviceId) : null;
			const name = row ? row.name : "this device";
			/*
			 * A DRAFT'S PICK IS A SETTING, EXERCISED ON THE FIRST SEND: it rides the
			 * draft row (and from there the create route's own `peer`) rather than
			 * creating anything here.
			 */
			if (!sessionId) {
				if (!draftKey) return;
				updateDraft(draftKey, { peer: row ? row.deviceId : undefined });
				return;
			}
			const key = sessionId;
			const to = deviceId ?? "local";
			beginMove(key, { deviceId: to, name });
			transfer.mutate(
				/*
				 * `keep: false` IS THE MOVE, and the copy is the deliberate second
				 * action of the same decision - it belongs in the confirmation the Mesh
				 * tab already renders (`Move to X` / `Copy instead`), not as a second
				 * row in this list.
				 */
				{ sessionId, to, keep: false },
				{
					onSuccess: (outcome) => {
						if (outcome.kind === "moved") {
							settleMove(key, {
								kind: "moved",
								deviceId: to,
								name,
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
						refuseMove(key, { refusal: outcome.refusal, name, canWait: true });
					},
				},
			);
		},
		[
			beginMove,
			draftKey,
			model,
			refuseMove,
			sessionId,
			settleMove,
			transfer,
			updateDraft,
		],
	);

	if (!peersEnabled) return null;
	return (
		<ChatHeaderDevice
			placement={placement}
			model={model}
			busy={move?.kind === "moving"}
			onPick={onPick}
			onCheckAgain={() => {
				void peers.refetch();
				void networks.refetch();
			}}
		/>
	);
};
