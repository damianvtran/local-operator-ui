/**
 * The detail surface: what a device is, what it holds, and what may be done to it.
 *
 * SLICE 1'S NODE CLICK WENT TO THE LIST; IT OPENS THIS PANEL NOW, and the reason is
 * the container model. PR #498 made hover and click the same popover because a node
 * had one thing to say. A device node now has actions (move a conversation, invite,
 * remove a membership), the conversations it holds, and the membership facts that
 * belong to no single node - so the two split: **hover states one fact, click opens
 * the panel**, and the panel is where the actions live. "Show in list" is kept as a
 * panel action, so slice 1's landing point is still one click away rather than gone.
 *
 * THE PANEL IS A COLUMN, NOT A DRAWER. A `Sheet` would cover the canvas, and the
 * question the panel answers ("what is this node, and what can it do") is asked
 * WHILE looking at the graph: covering the picture would make the reader re-find
 * their place on every click. It is also the accessibility half of the drag - every
 * outcome a drop can produce is reachable here, by keyboard, without a pointer.
 *
 * THE LIST OF CONVERSATIONS IS BOUNDED AND SAYS SO. `mesh-sessions.ts` caps a
 * node's chips at four; the panel is where the rest live, up to the page the read
 * asked for, and the total the peer catalogue counted is printed beside them so
 * "showing 6 of 37" can never be read as a census.
 */

import { Button, Separator, Tooltip } from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuLabel,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	MoreHorizontal,
	Network,
	ShieldAlert,
	TriangleAlert,
} from "lucide-react";
import type { FC } from "react";
import { resolveDrop } from "./mesh-drop";
import type { MeshDevice, MeshGraph } from "./mesh-graph";
import { deviceStatLine, deviceStateWords } from "./mesh-graph";
import { chipFact, chipLabel } from "./mesh-node";
import type { DeviceSessions } from "./mesh-sessions";
import type { MeshSessionRow } from "./mesh-types";

/**
 * The destinations a conversation can go to, from wherever it is now.
 *
 * THE HOST DEVICE IS NOT A DESTINATION, and neither is the session's own: an entry
 * that asks a device to take what it already holds is a move the route refuses as
 * `already_local`, and offering it would be offering a refusal. That leaves this
 * device (a RECALL, when the conversation is elsewhere) and every other drawn
 * device (an offload). The label for this device is supplied by the caller rather
 * than read here, because "this device" is a fact about the reader.
 */
export type MoveDestination = {
	deviceId: string;
	label: string;
	/** The verb the drop indicator would use, so menu and drag say one thing. */
	verb: string;
	keepVerb: string;
	/**
	 * THE ROUTE'S OWN SENTENCE when this destination can only refuse, or `null` when the
	 * move is offerable (UX review round 1, U3). Resolved by the caller through
	 * `resolveDrop` - the same function the drag uses - so the menu cannot disagree with
	 * the pointer about what a destination would do. A refused destination is rendered
	 * DISABLED with this sentence as its reason rather than offered and then denied.
	 */
	refused?: string | null;
};

export function moveDestinations(
	devices: readonly MeshDevice[],
	selfDeviceId: string | null,
	session: MeshSessionRow,
	selfLabel: string,
): MoveDestination[] {
	const owner =
		session.locality === "local" ? selfDeviceId : session.owner_device;
	const destinations: MoveDestination[] = [];
	for (const device of devices) {
		if (device.id === owner) continue;
		if (device.id === selfDeviceId) {
			destinations.push({
				deviceId: device.id,
				label: selfLabel,
				verb: "Recall to this device",
				keepVerb: "Copy here, leave it there",
			});
			continue;
		}
		destinations.push({
			deviceId: device.id,
			label: device.label,
			verb: `Move to ${device.label}`,
			keepVerb: `Copy to ${device.label}`,
		});
	}
	return destinations;
}

/**
 * The destinations one conversation may go to, from THIS canvas's own nodes.
 *
 * A WRAPPER WITH ONE JOB: the menu must not offer a device the canvas did not draw,
 * because an entry whose drop resolves to no node is a dead end. `moveDestinations`
 * does the arithmetic; this is the seam that guarantees the GRAPH is what feeds it,
 * and it is where a reader looking for "why can't I move this to X" finds the answer.
 */
export function destinationsOnCanvas(
	graph: { devices: readonly MeshDevice[]; selfDeviceId: string | null },
	session: MeshSessionRow,
	selfLabel: string,
): MoveDestination[] {
	return moveDestinations(
		graph.devices,
		graph.selfDeviceId,
		session,
		selfLabel,
	);
}

/**
 * The same destinations, each carrying the verdict the DROP would give it.
 *
 * THE MENU IS THE ACCESSIBLE PATH TO EVERY DRAG OUTCOME, so it may not offer one the
 * drag refuses (UX review round 1, U3). Measured: a peer's conversation menu listed
 * `Move to bench-device-2/3/4` - moves between two devices that are neither end of it -
 * and every one answered `third_device` the moment it was chosen, while the DRAG refuses
 * that case while the button is still down (`resolveDrop`'s own `third_device` branch).
 * One decision, one function: each destination is pre-resolved through `resolveDrop`, and
 * a verdict that refuses annotates the entry so the menu renders it DISABLED with the
 * route's own sentence as its reason instead of letting the reader commit and be told no.
 *
 * IT LIVES HERE, beside the destinations themselves, because both surfaces that offer the
 * menu - the device panel and the list - reach it with the graph in hand; a version in
 * either caller would be a second spelling of one rule.
 */
export function destinationsWithVerdicts(
	graph: MeshGraph,
	session: MeshSessionRow,
	selfLabel: string,
): MoveDestination[] {
	const destinations = destinationsOnCanvas(graph, session, selfLabel);
	const context = {
		selfDeviceId: graph.selfDeviceId,
		devices: new Map(graph.devices.map((device) => [device.id, device])),
		networks: new Map(graph.networks.map((network) => [network.id, network])),
	};
	const ownerDeviceId =
		session.locality === "local"
			? (graph.selfDeviceId ?? "")
			: session.owner_device;
	const owner = context.devices.get(ownerDeviceId);
	return destinations.map((destination) => {
		const verdict = resolveDrop(
			{
				session,
				ownerDeviceId,
				ownerLabel: owner?.label ?? session.owner_device_name,
			},
			{ kind: "device", deviceId: destination.deviceId },
			context,
		);
		return {
			...destination,
			/*
			 * `busy` IS NOT A REASON TO HIDE A DESTINATION (agent review round 1, U3 and the
			 * round's own F2, which are the same fact seen twice): the refusal is about the
			 * SESSION'S OWN TURN, not about where it is going, and the notice's remedy - wait
			 * for the turn to finish - is only reachable by asking. Disabling it here would take
			 * that remedy off the accessible path on every destination at once, which is the
			 * opposite of what the menu is for. A destination that can only refuse FOR ITS OWN
			 * REASON (`third_device`, `unreachable`, `suspect_device`, `revoked_membership`) is
			 * annotated, and the menu renders it disabled with the route's sentence.
			 */
			refused:
				verdict.kind === "refused" && verdict.code !== "busy"
					? verdict.sentence
					: null,
		};
	});
}

/**
 * The keyboard path to every outcome a drag can produce.
 *
 * TWO SECTIONS, NOT A MODE TOGGLE: the move is what the gesture means, and the copy
 * is the reversible alternative that a move's confirmation offers. Both are here so
 * a user who never drags anything has the whole feature, which is the plan's rule
 * that "drag is never the only path" - and it is a requirement rather than a
 * courtesy, because a pointer-only affordance is unusable by keyboard.
 */
export const SessionMoveMenu: FC<{
	session: MeshSessionRow;
	destinations: readonly MoveDestination[];
	disabled: boolean;
	onChoose: (destination: MoveDestination, keep: boolean) => void;
	onOpenChange?: (open: boolean) => void;
	/** The trigger's own content, so a chip and a row can look like themselves. */
	trigger: React.ReactNode;
	triggerLabel: string;
}> = ({
	session,
	destinations,
	disabled,
	onChoose,
	onOpenChange,
	trigger,
	triggerLabel,
}) => (
	<DropdownMenu onOpenChange={onOpenChange}>
		<DropdownMenuTrigger asChild>
			<button
				type="button"
				aria-label={triggerLabel}
				data-mesh-session-menu={session.id}
				disabled={disabled || destinations.length === 0}
				className="rounded-sm focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2 disabled:text-ink-disabled"
			>
				{trigger}
			</button>
		</DropdownMenuTrigger>
		<DropdownMenuContent align="start" className="min-w-56">
			<DropdownMenuLabel>{chipLabel(session)}</DropdownMenuLabel>
			<DropdownMenuSeparator />
			{destinations.map((destination) => (
				<DropdownMenuItem
					key={destination.deviceId}
					data-mesh-move-to={destination.deviceId}
					/*
					 * A DESTINATION THAT CAN ONLY REFUSE IS NOT OFFERED (UX review round 1, U3):
					 * the item is disabled and carries the route's own sentence, so the reader
					 * learns why from the menu instead of from a refusal after committing. The
					 * reason is in `title` because the menu has no room for a paragraph, and the
					 * same sentence is what the drag states prospectively.
					 */
					disabled={Boolean(destination.refused)}
					title={destination.refused ?? undefined}
					onSelect={() => onChoose(destination, false)}
				>
					{destination.verb}
				</DropdownMenuItem>
			))}
			<DropdownMenuSeparator />
			{destinations.map((destination) => (
				<DropdownMenuItem
					key={`keep-${destination.deviceId}`}
					data-mesh-copy-to={destination.deviceId}
					disabled={Boolean(destination.refused)}
					title={destination.refused ?? undefined}
					onSelect={() => onChoose(destination, true)}
				>
					{destination.keepVerb}
				</DropdownMenuItem>
			))}
		</DropdownMenuContent>
	</DropdownMenu>
);

/**
 * One device, in full: its state, its memberships, its conversations and its actions.
 *
 * THE ACTIONS AND THEIR ORDER are what a *panel* is for, so each one is placed by
 * what it does rather than by how it looks: a read-only navigation ("Show in list")
 * first, then the mesh's own membership acts, and the destructive one last and
 * separated. "Invite to network…" appears even for a device already in a network,
 * because the invite is how a SECOND network admits it and the protocol has no
 * unilateral add (`mesh-ui.md` §2.8 Decision 4).
 */
export const DevicePanel: FC<{
	device: MeshDevice;
	sessions: DeviceSessions;
	/** The catalogue's own count, which may exceed the rows in hand. */
	sessionTotal: number;
	nowSeconds: number;
	destinationsFor: (session: MeshSessionRow) => MoveDestination[];
	movingSessionId: string | null;
	canMove: boolean;
	canInvite: boolean;
	/** Dismiss the panel: the column answers a click, and it can be let go. */
	onClose: () => void;
	onMove: (
		session: MeshSessionRow,
		destination: MoveDestination,
		keep: boolean,
	) => void;
	onShowInList: (deviceId: string) => void;
	onInvite: (device: MeshDevice) => void;
	onRemoveMember: (device: MeshDevice, networkId: string) => void;
}> = ({
	device,
	sessions,
	sessionTotal,
	nowSeconds,
	destinationsFor,
	movingSessionId,
	canMove,
	canInvite,
	onClose,
	onMove,
	onShowInList,
	onInvite,
	onRemoveMember,
}) => {
	const words = deviceStateWords(device);
	const shownOf =
		sessionTotal > sessions.rows.length
			? `${sessions.rows.length} of ${sessionTotal}`
			: `${sessions.rows.length}`;
	return (
		<aside
			aria-label={`${device.label} details`}
			data-mesh-panel={device.id}
			className="flex w-80 shrink-0 flex-col gap-3 overflow-y-auto rounded-md border border-hairline bg-surface p-4"
		>
			<header className="flex flex-col gap-1">
				<Button
					size="sm"
					variant="ghost"
					className="w-fit self-end"
					data-mesh-panel-close=""
					onClick={onClose}
				>
					Close
				</Button>
				<h2 className="text-body-sm text-ink">{device.label}</h2>
				{/*
				 * THE STATE IS WORDS FIRST and the hue second (WCAG 1.4.1): the same rule the
				 * node's stripe follows, stated here because a panel has room to name it.
				 */}
				<p className="flex items-center gap-1.5 text-meta text-ink-muted">
					{device.state === "suspect" && (
						<ShieldAlert aria-hidden="true" className="size-3.5 text-danger" />
					)}
					{device.state === "unreachable" && (
						<TriangleAlert
							aria-hidden="true"
							className="size-3.5 text-warning"
						/>
					)}
					{/*
					 * THE STAT LINE IS THE NODE'S OWN LINE, rendered here from the same function: the
					 * panel does not get a second opinion about how a device is described, and the
					 * reason an unreachable device carries is the backend's sentence verbatim.
					 */}
					{words || deviceStatLine(device, nowSeconds)}
				</p>
				{/* The reason is the backend's own sentence and is never re-worded here. */}
				{device.reason && (
					<p className="text-meta text-warning">{device.reason}</p>
				)}
			</header>

			<Separator />

			<section className="flex flex-col gap-2">
				<h3 className="text-meta text-ink-dim">Memberships</h3>
				<ul className="m-0 flex list-none flex-col gap-2 p-0">
					{device.memberships.map((membership) => (
						<li key={membership.networkId} className="flex flex-col gap-1">
							<span className="flex items-center gap-2 text-body-sm text-ink">
								<Network
									aria-hidden="true"
									className="size-3.5 text-ink-muted"
								/>
								{membership.networkName}
							</span>
							<span className="text-meta text-ink-dim">
								{membership.role || "member"}
								{membership.capabilities.length > 0
									? ` · ${membership.capabilities.join(", ")}`
									: ""}
								{membership.active ? "" : " · revoked"}
							</span>
							{canInvite && membership.active && (
								<Button
									size="sm"
									variant="ghost"
									className="w-fit"
									data-mesh-remove-member={`${membership.networkId}:${device.id}`}
									onClick={() => onRemoveMember(device, membership.networkId)}
								>
									Remove from {membership.networkName}…
								</Button>
							)}
						</li>
					))}
				</ul>
				{canInvite && (
					<Button
						size="sm"
						variant="secondary"
						className="w-fit"
						data-mesh-invite={device.id}
						onClick={() => onInvite(device)}
					>
						Invite to a network…
					</Button>
				)}
			</section>

			<Separator />

			<section className="flex min-h-0 flex-col gap-2">
				<h3 className="text-meta text-ink-dim">
					Conversations <span className="text-ink-disabled">({shownOf})</span>
				</h3>
				{sessions.rows.length === 0 ? (
					<p className="text-meta text-ink-dim">
						{device.sessionCount === null
							? "This device did not report its conversations."
							: "No conversations here."}
					</p>
				) : (
					<ul className="m-0 flex list-none flex-col gap-1 p-0">
						{sessions.rows.map((session) => (
							<li
								key={session.id}
								data-mesh-panel-session={session.id}
								className={cn(
									"flex items-center gap-2 rounded-sm px-2 py-1",
									"border border-hairline bg-elevated",
									movingSessionId === session.id && "border-control",
								)}
							>
								<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
									{chipLabel(session)}
								</span>
								<span className="shrink-0 text-meta text-ink-dim">
									{chipFact(session, device.label, device.reachable)}
								</span>
								{movingSessionId === session.id ? (
									<span className="shrink-0 text-meta text-ink-muted">
										moving…
									</span>
								) : (
									<SessionMoveMenu
										session={session}
										destinations={destinationsFor(session)}
										disabled={!canMove}
										onChoose={(destination, keep) =>
											onMove(session, destination, keep)
										}
										trigger={
											<MoreHorizontal aria-hidden="true" className="size-4" />
										}
										triggerLabel={`Move ${chipLabel(session)}`}
									/>
								)}
							</li>
						))}
					</ul>
				)}
				{device.endpoints.length > 0 && (
					<Tooltip content={device.endpoints.join("\n")}>
						<span className="w-fit text-meta text-ink-dim">
							{device.endpoints.length}{" "}
							{device.endpoints.length === 1 ? "address" : "addresses"}
						</span>
					</Tooltip>
				)}
			</section>

			<Separator />

			<Button
				size="sm"
				variant="ghost"
				className="w-fit"
				data-mesh-show-in-list={device.id}
				onClick={() => onShowInList(device.id)}
			>
				Show in list
			</Button>
		</aside>
	);
};
