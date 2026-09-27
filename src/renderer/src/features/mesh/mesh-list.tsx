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

import { cn } from "@shared/lib/utils";
import { type FC, useMemo, useState } from "react";
import type { MeshDevice, MeshGraph } from "./mesh-graph";
import { deviceStatLine } from "./mesh-graph";

/** The orders a reader can ask for, in the order the control offers them. */
export const MESH_SORTS = ["name", "chats", "state"] as const;
export type MeshSort = (typeof MESH_SORTS)[number];

const SORT_LABEL: Record<MeshSort, string> = {
	name: "Name",
	chats: "Chats",
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

type MeshListProps = {
	graph: MeshGraph;
	nowSeconds: number;
	selectedDeviceId: string | null;
};

export const MeshList: FC<MeshListProps> = ({
	graph,
	nowSeconds,
	selectedDeviceId,
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
										"flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-md px-3 py-2",
										"border border-hairline bg-surface",
										selected && "border-ink bg-row-selected",
									)}
								>
									<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
										{device.label}
									</span>
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
