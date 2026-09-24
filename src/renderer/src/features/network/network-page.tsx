import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { PageHeader } from "@shared/components/common/page-header";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Button,
	Dialog,
	DialogContent,
	DialogDescription,
	DialogFooter,
	DialogHeader,
	DialogTitle,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useQueryClient } from "@tanstack/react-query";
import { Network } from "lucide-react";
import { type FC, useState } from "react";
import type {
	NetworkInviteReceipt,
	NetworkTopology,
} from "../../../../shared/desktop-session-contract";
import { peerKeys, useNetworks } from "../chat/peers-store";
import { type DeviceActions, TopologyGraph } from "./topology-graph";
import type { DeviceNode } from "./topology-layout";

/**
 * The Networks tab (`/network`): the networks this device belongs to, the devices
 * in them, and the two acts the operator asked for - remove a device from a
 * network, and bring a device into one (`mesh-ui.md` §2.8).
 *
 * A TAB, not a sidebar section (decision 1): the question it answers - "what is
 * the shape of my mesh" - needs a canvas the 240-360 px chat rail does not have,
 * and its natural gesture is a pointer hover over a node.
 *
 * Mounted ONLY when the backend advertises `features.peers` (the route and the
 * rail item are both gated in `app.tsx`/`sidebar-navigation.tsx`); a user without
 * a network never sees it.
 *
 * WHAT IS DELIBERATELY NOT HERE (`mesh-ui.md` §2.7): panic and disconnect. Both
 * are one-click irreversible acts that rotate the network secret; they stay on
 * the TUI and CLI where the operation is typed and audited.
 */

type RemoveTarget = { device: DeviceNode; networkId: string };

/** The page's states, separated from its data so every one is a story. */
export type NetworkViewProps = {
	state:
		| { kind: "loading" }
		| { kind: "error"; message: string }
		| { kind: "ready"; topology: NetworkTopology };
	nowSeconds: number;
	onRetry: () => void;
	onRemove: (target: RemoveTarget, confirm: string) => Promise<void>;
	onInvite: (
		networkId: string,
		role: "read" | "drive" | "admin",
		device: string,
	) => Promise<NetworkInviteReceipt>;
	/** Stories only: a device whose card is open at mount. */
	openDeviceId?: string;
};

export const NetworkView: FC<NetworkViewProps> = ({
	state,
	nowSeconds,
	onRetry,
	onRemove,
	onInvite,
	openDeviceId,
}) => {
	const [removing, setRemoving] = useState<RemoveTarget | null>(null);
	const [inviting, setInviting] = useState<DeviceNode | null>(null);
	const topology = state.kind === "ready" ? state.topology : null;
	const actions: DeviceActions = {
		onRemove: (device, networkId) => setRemoving({ device, networkId }),
		onInvite: (device) => setInviting(device),
	};
	return (
		<div className="flex h-full flex-col gap-8 p-6">
			<PageHeader
				title="Network"
				icon={Network}
				subtitle="The networks this device belongs to and the devices in them. Hover a device for its details."
			/>
			<div className="min-h-0 flex-1 overflow-auto rounded-lg border border-hairline bg-surface p-4">
				{state.kind === "loading" && (
					<div className="flex h-full items-center justify-center">
						<Spinner label="Loading networks" />
					</div>
				)}
				{state.kind === "error" && (
					<div className="space-y-3">
						{/* `role="alert"` IS passed here, and only here: the failure arrives in
						    response to the user opening the tab (or pressing Retry), which is
						    the callout the primitive's own comment says must announce itself -
						    the loading and empty states were on the page already and stay
						    silent. The same choice the chat sidebar's catalogue error makes. */}
						<Alert variant="danger" role="alert">
							Could not read this device's networks. {state.message}
						</Alert>
						<Button variant="secondary" size="sm" onClick={onRetry}>
							Retry
						</Button>
					</div>
				)}
				{topology && topology.networks.length === 0 && (
					/* The empty state names the CLI verbs, because the desktop has no
					   create/join flow (joining needs the two-device code check the TUI
					   runs) - so the honest remedy is the command, not a dead button. */
					<div data-network-empty className="space-y-1 text-body-sm">
						<p className="text-ink">This device is not in a network yet.</p>
						<p className="text-ink-muted">
							Run <span className="font-mono">lop network init</span> to create
							one, or <span className="font-mono">lop network join</span> on
							this device to accept an invite from another.
						</p>
					</div>
				)}
				{topology && topology.networks.length > 0 && (
					<TopologyGraph
						topology={topology}
						nowSeconds={nowSeconds}
						actions={actions}
						openDeviceId={openDeviceId}
					/>
				)}
			</div>
			{removing && topology && (
				<RemoveDialog
					target={removing}
					networkName={
						topology.networks.find(
							(network) => network.network_id === removing.networkId,
						)?.name ?? removing.networkId
					}
					onClose={() => setRemoving(null)}
					onConfirm={async (confirm) => {
						await onRemove(removing, confirm);
						setRemoving(null);
					}}
				/>
			)}
			{inviting && topology && (
				<InviteDialog
					device={inviting}
					networks={topology.networks
						// A network the device is already an ACTIVE member of is not an
						// invite target: re-inviting a member mints a token nobody can
						// redeem.
						.filter(
							(network) =>
								!network.members.some(
									(member) => member.device_id === inviting.id && member.active,
								),
						)
						.map((network) => ({
							id: network.network_id,
							name: network.name || network.network_id,
						}))}
					onClose={() => setInviting(null)}
					onInvite={onInvite}
				/>
			)}
		</div>
	);
};

/**
 * Removal is `lop network member rm`: it revokes the member, tombstones it and
 * ROTATES THE NETWORK SECRET, bumping the epoch for every other device. It is the
 * one act on this tab that changes other devices' state, so it takes a TYPED
 * confirmation of the network's name (§1.5's rule for incident controls), never a
 * one-click button. The typed value rides to the route (`confirm`), which refuses
 * a mismatch itself - the dialog is not the only gate.
 */
const RemoveDialog: FC<{
	target: RemoveTarget;
	networkName: string;
	onClose: () => void;
	onConfirm: (confirm: string) => Promise<void>;
}> = ({ target, networkName, onClose, onConfirm }) => {
	const [typed, setTyped] = useState("");
	const [busy, setBusy] = useState(false);
	const [failure, setFailure] = useState<string | null>(null);
	const matches = typed === networkName;
	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent data-network-remove-dialog>
				<DialogHeader>
					<DialogTitle>
						Remove {target.device.label} from {networkName}?
					</DialogTitle>
					<DialogDescription>
						The device loses access to this network at once, and the network's
						secret is rotated, so every other device re-keys. To bring it back
						it must be invited again. Type the network's name to confirm.
					</DialogDescription>
				</DialogHeader>
				<div className="space-y-1">
					<Label htmlFor="network-remove-confirm">Network name</Label>
					<Input
						id="network-remove-confirm"
						value={typed}
						autoComplete="off"
						spellCheck={false}
						placeholder={networkName}
						onChange={(event) => setTyped(event.target.value)}
					/>
				</div>
				{failure && <Alert variant="danger">{failure}</Alert>}
				<DialogFooter>
					<Button variant="secondary" onClick={onClose} disabled={busy}>
						Cancel
					</Button>
					<Button
						variant="danger"
						disabled={!matches || busy}
						onClick={async () => {
							setBusy(true);
							setFailure(null);
							try {
								await onConfirm(typed);
							} catch (error) {
								setFailure(
									error instanceof Error
										? error.message
										: "The device was not removed.",
								);
							} finally {
								setBusy(false);
							}
						}}
					>
						Remove device
					</Button>
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/**
 * "Add to network" is an INVITE (§2.8, decision 4): the protocol has no
 * unilateral add, because admission is two-sided and the joining device proves
 * the code itself. So this mints a single-use token bound to the device, the
 * backend writes it to a FILE (it never crosses this IPC), and the dialog says
 * plainly that the other device has to redeem it.
 */
const InviteDialog: FC<{
	device: DeviceNode;
	networks: { id: string; name: string }[];
	onClose: () => void;
	onInvite: NetworkViewProps["onInvite"];
}> = ({ device, networks, onClose, onInvite }) => {
	const [networkId, setNetworkId] = useState(networks[0]?.id ?? "");
	const [role, setRole] = useState<"read" | "drive" | "admin">("drive");
	const [busy, setBusy] = useState(false);
	const [receipt, setReceipt] = useState<NetworkInviteReceipt | null>(null);
	const [failure, setFailure] = useState<string | null>(null);
	const networkName = networks.find((n) => n.id === networkId)?.name ?? "";
	return (
		<Dialog open onOpenChange={(open) => !open && !busy && onClose()}>
			<DialogContent data-network-invite-dialog>
				<DialogHeader>
					<DialogTitle>Add {device.label} to a network</DialogTitle>
					<DialogDescription>
						This creates a single-use invite for this device only. Nothing
						changes until {device.label} redeems it.
					</DialogDescription>
				</DialogHeader>
				{networks.length === 0 ? (
					<p className="text-body-sm text-ink-muted">
						{device.label} is already in every network this device belongs to.
					</p>
				) : receipt ? (
					<div data-invite-receipt className="space-y-2 text-body-sm">
						<p className="text-ink">The invite was written to:</p>
						<p className="break-all rounded-sm bg-sunken px-2 py-1 font-mono text-meta text-ink">
							{receipt.token_path}
						</p>
						<p className="text-ink-muted">
							Copy that file to {device.label} and run{" "}
							<span className="font-mono">lop network join @&lt;file&gt;</span>{" "}
							there. {device.label} must redeem it itself - it joins{" "}
							{networkName} only after it confirms the code on both devices.
						</p>
					</div>
				) : (
					<div className="space-y-3">
						<div className="space-y-1">
							<Label htmlFor="network-invite-network">Network</Label>
							<Select value={networkId} onValueChange={setNetworkId}>
								<SelectTrigger id="network-invite-network">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									{networks.map((network) => (
										<SelectItem key={network.id} value={network.id}>
											{network.name}
										</SelectItem>
									))}
								</SelectContent>
							</Select>
						</div>
						<div className="space-y-1">
							<Label htmlFor="network-invite-role">Role</Label>
							<Select
								value={role}
								onValueChange={(value) => setRole(value as typeof role)}
							>
								<SelectTrigger id="network-invite-role">
									<SelectValue />
								</SelectTrigger>
								<SelectContent>
									<SelectItem value="read">Read - see its chats</SelectItem>
									<SelectItem value="drive">
										Drive - see, prompt and stop chats
									</SelectItem>
									<SelectItem value="admin">Admin - everything</SelectItem>
								</SelectContent>
							</Select>
						</div>
					</div>
				)}
				{failure && <Alert variant="danger">{failure}</Alert>}
				<DialogFooter>
					<Button variant="secondary" onClick={onClose} disabled={busy}>
						{receipt ? "Done" : "Cancel"}
					</Button>
					{!receipt && networks.length > 0 && (
						<Button
							variant="primary"
							disabled={!networkId || busy}
							onClick={async () => {
								setBusy(true);
								setFailure(null);
								try {
									setReceipt(await onInvite(networkId, role, device.id));
								} catch (error) {
									setFailure(
										error instanceof Error
											? error.message
											: "The invite was not created.",
									);
								} finally {
									setBusy(false);
								}
							}}
						>
							Create invite
						</Button>
					)}
				</DialogFooter>
			</DialogContent>
		</Dialog>
	);
};

/** The routed page: the data half of `NetworkView`. */
export const NetworkPage: FC = () => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "peers");
	const networks = useNetworks(enabled);
	const queryClient = useQueryClient();
	const refresh = () =>
		Promise.all([
			queryClient.invalidateQueries({ queryKey: peerKeys.networks }),
			queryClient.invalidateQueries({ queryKey: peerKeys.peers }),
		]);
	const state: NetworkViewProps["state"] = networks.data
		? { kind: "ready", topology: networks.data }
		: networks.isError
			? {
					kind: "error",
					message:
						networks.error instanceof Error ? networks.error.message : "",
				}
			: { kind: "loading" };
	return (
		<NetworkView
			state={state}
			nowSeconds={Date.now() / 1000}
			onRetry={() => void networks.refetch()}
			onRemove={async ({ device, networkId }, confirm) => {
				await desktopResult({
					op: "networks.member.remove",
					networkId,
					deviceId: device.id,
					confirm,
				});
				await refresh();
			}}
			onInvite={async (networkId, role, device) => {
				const receipt = await desktopResult<NetworkInviteReceipt>({
					op: "networks.invite",
					networkId,
					role,
					device,
				});
				await refresh();
				return receipt;
			}}
		/>
	);
};
