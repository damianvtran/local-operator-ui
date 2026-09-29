/**
 * The list presentation of the same mesh the canvas draws: which device holds what,
 * sortable, one row per device per network.
 *
 * WHY THIS SHIPS IN THE SAME SLICE AS THE CANVAS, and not as a fallback added later:
 * a graph cannot be sorted, searched or multi-selected, and it fails outright when
 * there is nothing to connect - a one-device mesh has no edges and answers no
 * question. The canvas answers "what shape is my mesh, and where is the odd one
 * out"; this answers "which session is on which device", and the tab's own header
 * carries the pair as one control so neither is a hidden mode.
 *
 * THE ROWS ARE NOT CONTROLS. This slice has no mutation, so a row is not a button
 * and takes no focus: the only interactive thing in the group is the sort choice
 * above it. `aria-current` marks the device the CANVAS selection is on, so walking
 * from a node to its row has a visible landing point.
 */

import { Button, Separator } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { MoreHorizontal } from "lucide-react";
import { type FC, useMemo, useState } from "react";
import {
	type MoveDestination,
	SessionMoveMenu,
	destinationsWithVerdicts,
} from "./mesh-card";
import type { MeshDevice, MeshGraph } from "./mesh-graph";
import { deviceStatLine } from "./mesh-graph";
import type { DeviceSessions } from "./mesh-sessions";
import { deviceSessionTotal } from "./mesh-sessions";
import type { MeshSessionRow } from "./mesh-types";

/** The orders a reader can ask for, in the order the control offers them. */
export const MESH_SORTS = ["name", "chats", "state"] as const;
export type MeshSort = (typeof MESH_SORTS)[number];

const SORT_LABEL: Record<MeshSort, string> = {
	name: "Name",
	// THE ONE NOUN (design review round 1, D5): the row's own right column said "chats"
	// while the left said "conversations", and this feature states the protocol's own
	// vocabulary rather than a friendlier invention.
	chats: "Conversations",
	state: "State",
};

/**
 * The order a reader may choose, by device.
 *
 * `state` ranks by how much the state deserves attention rather than
 * alphabetically - a suspected identity, then an unreachable device, then this
 * device, then the ordinary case - because "which one is the odd one out" is the
 * question this sort exists to answer.
 */
const STATE_RANK: Record<MeshDevice["state"], number> = {
	suspect: 0,
	unreachable: 1,
	self: 2,
	reachable: 3,
};

export function sortDevices(
	devices: readonly MeshDevice[],
	sort: MeshSort,
): MeshDevice[] {
	const rows = [...devices];
	switch (sort) {
		case "chats":
			// A device whose count the relay did not report sorts LAST rather than as
			// zero: "we were not told" is not "it holds none".
			rows.sort(
				(a, b) =>
					(b.sessionCount ?? -1) - (a.sessionCount ?? -1) ||
					a.label.localeCompare(b.label),
			);
			return rows;
		case "state":
			rows.sort(
				(a, b) =>
					STATE_RANK[a.state] - STATE_RANK[b.state] ||
					a.label.localeCompare(b.label),
			);
			return rows;
		default:
			return rows.sort((a, b) => a.label.localeCompare(b.label));
	}
}

/** How many of a device's conversations a LIST row prints before it defers. */
export const LIST_SESSION_ROWS = 8;

/**
 * The one fact a list row prints beside a conversation's name.
 *
 * DELIBERATELY DIFFERENT FROM THE CHIP'S (`chipFact`): a row already sits under its
 * device, so repeating "on damians-MacBook-Pro" on every line of a device's own
 * section says nothing - while "on devon-laptop" says where the conversation actually
 * lives for a row filed under a network two devices share. `selfLabel` is what the
 * caller calls the reader's own device, because that name is a fact about the reader
 * rather than about the wire.
 */
function sessionFact(session: MeshSessionRow, selfLabel: string): string {
	if (session.locality === "local") return session.live_state || "here";
	const where = session.owner_device_name || selfLabel;
	const state = session.live_state ? ` \u00b7 ${session.live_state}` : "";
	return session.reachable
		? `on ${where}${state}`
		: `on ${where} (not answering)`;
}

type MeshListProps = {
	graph: MeshGraph;
	nowSeconds: number;
	selectedDeviceId: string | null;
	/** What each drawn device holds, joined and capped by `mesh-sessions.ts`. */
	sessions: ReadonlyMap<string, DeviceSessions>;
	/** What the reader's own device is called, for a recall's destination label. */
	selfLabel: string;
	/** Whether this backend can move a conversation (`features.session_transfer`). */
	canMove: boolean;
	/** Open a device: the row is the list's own route to the panel. */
	onSelect: (deviceId: string) => void;
	/** A `⋯` choice: resolved by the page, which then asks. */
	onMove: (
		session: MeshSessionRow,
		destination: MoveDestination,
		keep: boolean,
	) => void;
	/** Invite a device to a network: the ONE way a member is admitted. */
	onInvite: (ask: { deviceId: string; deviceLabel: string }) => void;
	/** Revoke a membership, from the network it belongs to. */
	onRemove: (ask: {
		networkId: string;
		networkLabel: string;
		deviceId: string;
		deviceLabel: string;
	}) => void;
};

export const MeshList: FC<MeshListProps> = ({
	graph,
	nowSeconds,
	selectedDeviceId,
	sessions,
	selfLabel,
	canMove,
	onSelect,
	onMove,
	onInvite,
	onRemove,
}) => {
	const [sort, setSort] = useState<MeshSort>("name");
	/*
	 * Devices grouped under the network that holds them, IN THE NETWORK'S OWN ORDER.
	 * A device in two networks appears under both, which is the wire's own shape
	 * (membership-per-network) and the one place the double appearance is the point
	 * rather than a duplicate.
	 */
	const groups = useMemo(
		() =>
			graph.networks.map((network) => ({
				network,
				members: sortDevices(
					graph.devices.filter((device) =>
						device.memberships.some((m) => m.networkId === network.id),
					),
					sort,
				),
			})),
		[graph, sort],
	);

	return (
		<div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto pr-1">
			{/*
			 * A segmented pair rather than Radix `Tabs`: these change the ORDER of one
			 * list, they do not swap panels, and a `TabsTrigger` would point
			 * `aria-controls` at a panel that does not exist - the same call
			 * `settings-page.tsx` records for its own usage pair.
			 */}
			<fieldset className="m-0 w-fit border-0 p-0">
				<legend className="sr-only">Sort devices by</legend>
				<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
					{MESH_SORTS.map((option) => (
						<button
							key={option}
							type="button"
							aria-pressed={sort === option}
							onClick={() => setSort(option)}
							className={cn(
								"h-6 rounded-sm px-3 text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart",
								"hover:text-ink",
								"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
								sort === option && "bg-surface text-ink",
							)}
						>
							{SORT_LABEL[option]}
						</button>
					))}
				</div>
			</fieldset>

			{groups.map(({ network, members }) => (
				<section
					key={network.id}
					data-mesh-network-group={network.id}
					className="flex flex-col gap-2"
				>
					<h2
						className="flex flex-wrap items-baseline gap-2 text-body-sm text-ink"
						/*
						 * `epoch` LIVES IN THE TITLE, not on the face (design round 1, D8), which is
						 * the rule `mesh-node.tsx` already states: a protocol number the reader
						 * cannot act on is reachable without being printed. The list was the second
						 * policy for the same field, and its own heading is where a reader looks
						 * first, so the disagreement showed.
						 */
						title={`epoch ${network.epoch}`}
					>
						{network.label}
						<span className="text-meta text-ink-dim">
							{network.trust} · {network.memberCount}{" "}
							{network.memberCount === 1 ? "device" : "devices"}
							{network.revokedCount > 0
								? ` · ${network.revokedCount} revoked`
								: ""}
						</span>
					</h2>
					<ul className="m-0 flex list-none flex-col gap-1 p-0">
						{members.map((device) => {
							const membership = device.memberships.find(
								(m) => m.networkId === network.id,
							);
							const selected = device.id === selectedDeviceId;
							const held = sessions.get(device.id);
							const rows = held?.rows ?? [];
							const total = held
								? deviceSessionTotal(held, device.sessionCount)
								: (device.sessionCount ?? 0);
							return (
								<li
									key={device.id}
									data-mesh-device-row={device.id}
									data-mesh-state={device.state}
									aria-current={selected ? "true" : undefined}
									className={cn(
										/*
										 * The row's ground is the panel's own state role rather than a
										 * new tint: `row-selected` is the fill of the row the reader is
										 * currently ON, which is exactly what the canvas selection is.
										 */
										"flex flex-col gap-1 rounded-md px-3 py-2",
										"border border-hairline bg-surface",
										selected && "border-ink bg-row-selected",
									)}
								>
									{/*
									 * THE NAME IS THE ROW'S CONTROL, and slice 2 is where it became one:
									 * a row that could be read but not pressed left the list unable to
									 * reach the panel, and the panel is where this feature's actions
									 * live. It is a button rather than a whole-row click because the row
									 * now CONTAINS controls of its own (the session menus), and a click
									 * target wrapped around a menu is how a menu press becomes a
									 * selection.
									 */}
									<div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
										<button
											type="button"
											data-mesh-device-open={device.id}
											onClick={() => onSelect(device.id)}
											className={cn(
												"min-w-0 flex-1 truncate text-left text-body-sm text-ink",
												"hover:text-ink-muted",
												"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
											)}
										>
											{device.label}
										</button>
										{/*
										 * The state IN WORDS on every row (the canvas's stripe and this
										 * row's badge are one claim): an unreachable device carries the
										 * backend's own reason, and the resting state carries its stat
										 * line rather than the word "reachable", which says nothing a
										 * reader needs on a healthy mesh.
										 */}
										<span
											className={cn(
												"shrink-0 text-meta",
												device.state === "unreachable" && "text-warning",
												device.state === "suspect" && "text-danger",
												device.state === "self" && "text-accent",
												device.state === "reachable" && "text-ink-muted",
											)}
										>
											{deviceStatLine(device, nowSeconds)}
										</span>
										<span className="shrink-0 text-meta text-ink-dim">
											{membership?.role ? `${membership.role} · ` : ""}
											{membership && !membership.active ? "revoked" : "member"}
										</span>
									</div>
									{rows.length > 0 ? (
										<>
											<Separator className="my-1" />
											<ul className="m-0 flex list-none flex-col gap-0.5 p-0">
												{rows.slice(0, LIST_SESSION_ROWS).map((session) => (
													<li
														key={session.id}
														data-mesh-row-session={session.id}
														className="flex items-center gap-2 py-0.5"
													>
														<span className="min-w-0 flex-1 truncate text-meta text-ink-muted">
															{session.name || session.id}
														</span>
														<span className="shrink-0 text-meta text-ink-dim">
															{sessionFact(session, selfLabel)}
														</span>
														<SessionMoveMenu
															session={session}
															/*
															 * THROUGH THE SAME RESOLVER THE DRAG USES (UX review round 1, U3): a destination
															 * the drop would refuse - a move between two devices that are neither end of it -
															 * is offered disabled with the route's own sentence, so the list does not let a
															 * reader commit to a move it already knows cannot succeed.
															 */
															destinations={destinationsWithVerdicts(
																graph,
																session,
																selfLabel,
															)}
															disabled={!canMove}
															onChoose={(destination, keep) =>
																onMove(session, destination, keep)
															}
															trigger={
																<MoreHorizontal
																	aria-hidden="true"
																	className="size-3.5"
																/>
															}
															triggerLabel={`Move ${session.name || session.id}`}
														/>
													</li>
												))}
											</ul>
											{total > rows.slice(0, LIST_SESSION_ROWS).length && (
												<button
													type="button"
													onClick={() => onSelect(device.id)}
													className="w-fit text-meta text-ink-dim hover:text-ink"
												>
													{`show all ${total} in the panel`}
												</button>
											)}
										</>
									) : (
										<span className="text-meta text-ink-dim">
											{total === 0
												? "no conversations"
												: total === 1
													? "1 conversation"
													: `${total} conversations`}
										</span>
									)}
									{(membership?.active || device.state !== "self") && (
										<div className="flex flex-wrap items-center gap-1">
											{/* ONE MENU PER ROW, and it is the same component the canvas
											 * chips open through the panel: a table cannot carry a drag, so
											 * this is where every move outcome lives for a reader who never
											 * touches a pointer. */}
											<Button
												size="sm"
												variant="ghost"
												data-mesh-invite={device.id}
												onClick={() =>
													onInvite({
														deviceId: device.id,
														deviceLabel: device.label,
													})
												}
											>
												Invite to a network…
											</Button>
											{membership?.active && (
												<Button
													size="sm"
													variant="ghost"
													data-mesh-remove-member={`${network.id}:${device.id}`}
													onClick={() =>
														onRemove({
															networkId: network.id,
															networkLabel: network.label,
															deviceId: device.id,
															deviceLabel: device.label,
														})
													}
												>
													Remove from {network.label}…
												</Button>
											)}
										</div>
									)}
								</li>
							);
						})}
					</ul>
				</section>
			))}
			{graph.unmatchedPeers.length > 0 && (
				/*
				 * HONESTY ABOUT A JOIN THAT DID NOT LAND. The peer catalogue is answered
				 * across every shared network while this list groups by network, so a peer
				 * the catalogue named and no membership holds is a fact the reads disagree
				 * about. It is stated rather than dropped: silently ignoring it would hide
				 * a device the relay says is there.
				 */
				<p className="text-meta text-warning">
					{graph.unmatchedPeers.length}{" "}
					{graph.unmatchedPeers.length === 1 ? "device" : "devices"} answered
					the peer read but is in no network this app can name.
				</p>
			)}
		</div>
	);
};
