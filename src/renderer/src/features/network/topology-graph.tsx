import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { cn } from "@shared/lib/utils";
import { Monitor, Network } from "lucide-react";
import { type ReactNode, useRef, useState } from "react";
import type { NetworkTopology } from "../../../../shared/desktop-session-contract";
import { shortAge } from "../chat/chat-peers";
import {
	type DeviceNode,
	type DeviceState,
	NODE_HEIGHT,
	NODE_WIDTH,
	edgePath,
	layoutTopology,
} from "./topology-layout";

/**
 * The Networks tab's node graph: networks on the left, devices on the right, one
 * edge per membership (`mesh-ui.md` §2.8). A device in two networks is ONE node
 * with TWO edges - see `topology-layout.ts`, which owns that decision.
 *
 * HAND-ROLLED, no graph library: the repo has none (`recharts` draws charts, not
 * graphs) and the layout is two stable columns, which is a few dozen lines of SVG.
 * The EDGES are SVG paths; the NODES are real buttons positioned over the canvas,
 * because a node has to take keyboard focus, carry an accessible name and open the
 * detail card, and an SVG `<g>` does none of that without re-implementing it.
 *
 * STATUS COLOUR IS A THEME ROLE, never a hex (branding § 2): this device `accent`,
 * reachable `success`, unreachable `warning`, suspect `danger`. The node also says
 * its state IN WORDS on its second line, so colour is never the only channel.
 *
 * THE DETAIL CARD is the app's `Popover` (Radix) - the existing primitive for
 * content that holds controls. A `Tooltip` cannot: its content is not
 * interactive, and the card carries "Remove from network…" and "Add to
 * network…". It opens on pointer hover and on keyboard focus, and stays open
 * while the pointer is over the card so the actions can be reached.
 */

const STATE_WORDS: Record<DeviceState, string> = {
	self: "this device",
	reachable: "reachable",
	unreachable: "unreachable",
	suspect: "identity suspect",
};

/*
 * The node's state stripe and state ink, by role - and WHY ONE OF THE FOUR IS
 * NEUTRAL, which was measured rather than assumed.
 *
 * The obvious mapping (self=accent, reachable=success, unreachable=warning,
 * suspect=danger) spends TWO GREENS on one channel: the brand palette's `accent`
 * is `#38c96a` and its `success` is `#57c785` in `localOperatorDark` (and the
 * palette keeps both on purpose - its own comment explains that `info` was once
 * the accent's triple and that was the thing to fix, not the accent). A graph
 * whose "this device" node and whose healthy nodes are two neighbouring greens
 * has no status channel left: measured on the first capture of
 * `device-in-two-networks`, the self stripe and the reachable stripes were
 * `rgb(56,201,106)` and `rgb(87,199,133)`.
 *
 * So the RESTING state is the quiet one, which is the rule the rest of this app
 * already applies (`chat-session-status.tsx`: notable states take a hue, a
 * resting session takes `ink-dim`). Reachable is the ordinary case - most nodes,
 * most of the time - so it takes the neutral role, and the three states that mean
 * something take a hue each. Reachability is still named IN WORDS on every node,
 * so nothing here is carried by colour alone.
 */
const STATE_INK: Record<DeviceState, string> = {
	self: "border-l-accent",
	reachable: "border-l-hairline",
	unreachable: "border-l-warning",
	suspect: "border-l-danger",
};

const STATE_TEXT: Record<DeviceState, string> = {
	self: "text-accent",
	reachable: "text-ink-muted",
	unreachable: "text-warning",
	suspect: "text-danger",
};

/** How long the card waits after the pointer leaves before closing. */
const CARD_CLOSE_MS = 150;

export type DeviceActions = {
	onRemove?: (device: DeviceNode, networkId: string) => void;
	onInvite?: (device: DeviceNode) => void;
};

export function TopologyGraph({
	topology,
	nowSeconds,
	actions,
	openDeviceId,
}: {
	topology: NetworkTopology;
	/** Injected so a story's "last seen" sentence is stable across captures. */
	nowSeconds: number;
	actions: DeviceActions;
	/**
	 * A device whose card is open at mount - for the stories, which cannot hover.
	 * The keyboard path (focus a node) opens the same card in the app.
	 */
	openDeviceId?: string;
}) {
	const layout = layoutTopology(topology);
	const [open, setOpen] = useState<string | null>(openDeviceId ?? null);
	/**
	 * WHAT OPENED THE CARD, which decides where focus goes (M5). A story's
	 * `openDeviceId` counts as keyboard: a card open at mount should be readable
	 * from the keyboard, and no pointer gesture preceded it.
	 */
	const openedBy = useRef<"pointer" | "keyboard">("keyboard");
	const closeTimer = useRef<number | null>(null);
	const hold = (id: string) => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		closeTimer.current = null;
		setOpen(id);
	};
	const release = () => {
		if (closeTimer.current !== null) window.clearTimeout(closeTimer.current);
		closeTimer.current = window.setTimeout(() => setOpen(null), CARD_CLOSE_MS);
	};
	const networkById = new Map(layout.networks.map((node) => [node.id, node]));
	const deviceById = new Map(layout.devices.map((node) => [node.id, node]));
	/*
	 * Where the device has left to be invited TO, computed here rather than in
	 * `DeviceCard`, which sees one device and cannot know what the other networks
	 * hold (design round 1, D7).
	 *
	 * ANY MEMBERSHIP ROW BLOCKS, REVOKED INCLUDED (QA round 1, Q5). `active` used to
	 * be the test, so a device that had been REMOVED from a network counted as "not
	 * a member" and the card offered `Add to network…` there - an invite that can
	 * never be redeemed: a burned device id is never admitted again, however the
	 * invite is minted ("a burned id is never admitted again", measured as
	 * `device_id_conflict` on the redeeming device). Offering a control that ends in
	 * that sentence is the dead end D7 removed from the other side.
	 */
	const inviteState = (device: DeviceNode): InviteState => {
		const open = layout.networks.some(
			(network) =>
				!device.memberships.some(
					(membership) => membership.networkId === network.id,
				),
		);
		if (open) return "open";
		return device.memberships.some((membership) => !membership.active)
			? "removed"
			: "members";
	};

	return (
		<div
			data-topology-graph
			className="relative shrink-0"
			style={{ width: layout.width, height: layout.height }}
		>
			<svg
				aria-hidden="true"
				className="absolute inset-0"
				width={layout.width}
				height={layout.height}
			>
				{layout.edges.map((edge) => {
					const from = networkById.get(edge.networkId);
					const to = deviceById.get(edge.deviceId);
					if (!from || !to) return null;
					const lit = open === edge.deviceId;
					return (
						<path
							key={edge.key}
							data-edge={edge.key}
							d={edgePath(from, to)}
							fill="none"
							strokeWidth={lit ? 2 : 1.5}
							strokeDasharray={edge.active ? undefined : "4 4"}
							/* A LIGHTNESS step for the hovered device's own edges, not the
							   accent: the accent is spent on "this device" alone, and two
							   meanings for one hue is the defect the node stripes above
							   record. */
							className={lit ? "stroke-ink" : "stroke-ink-dim"}
						/>
					);
				})}
			</svg>
			{/* Networks: a heading-like list the screen reader walks first. */}
			<ul aria-label="Networks">
				{layout.networks.map((node) => (
					<li
						key={node.id}
						data-network-node={node.id}
						className="absolute flex items-center gap-2 rounded-md border border-hairline bg-elevated px-3"
						style={{
							left: node.x,
							top: node.y,
							width: NODE_WIDTH,
							height: NODE_HEIGHT,
						}}
					>
						<Network
							aria-hidden="true"
							className="size-4 shrink-0 text-ink-muted"
						/>
						<span className="min-w-0 flex-1">
							<span className="block truncate text-body-sm text-ink">
								{node.label}
							</span>
							<span
								/* `epoch 7` is protocol vocabulary and a user cannot act on it, so it
								   leaves the node's face for its `title` - the fact stays reachable
								   without spending a line of the graph's standing labels (design
								   round 1, D10). §2.8 puts it in the network node's hover card; a
								   native tooltip is the same fact at no new widget's cost. */
								title={`epoch ${node.epoch}`}
								className="block truncate text-meta text-ink-dim"
							>
								{node.memberCount}{" "}
								{node.memberCount === 1 ? "device" : "devices"}
							</span>
						</span>
					</li>
				))}
			</ul>
			<ul aria-label="Devices">
				{layout.devices.map((node) => (
					<li
						key={node.id}
						className="absolute"
						style={{ left: node.x, top: node.y }}
					>
						<Popover
							open={open === node.id}
							onOpenChange={(next) => setOpen(next ? node.id : null)}
						>
							{/*
							 * A REAL TRIGGER, NOT AN ANCHOR (round-1 agent review, M5). The
							 * node used to be a `PopoverAnchor` that opened the card on
							 * focus, and the card suppressed focus on open - so the two
							 * actions it carries (`Remove from network…`, `Add to
							 * network…`) could only be reached with a pointer: Tab went to
							 * the next node, whose focus swapped the card, and never into
							 * it. Radix's trigger gives the node `aria-haspopup`/
							 * `aria-expanded` and opens on Enter, Space and click.
							 *
							 * FOCUS NO LONGER OPENS IT. It could not be made reachable
							 * that way: a card that opens on focus must either take focus
							 * (which turns tabbing across the graph into a trap - every
							 * node drags the cursor into its own card) or refuse it (which
							 * is the pointer-only state this fixes). Opening on the key the
							 * user presses is the disclosure pattern the actions need, and
							 * Escape returns focus to the node, which Radix already does.
							 */}
							<PopoverTrigger asChild>
								<button
									type="button"
									data-device-node={node.id}
									data-device-state={node.state}
									onPointerEnter={() => {
										openedBy.current = "pointer";
										hold(node.id);
									}}
									onPointerLeave={release}
									onKeyDown={() => {
										openedBy.current = "keyboard";
									}}
									className={cn(
										"flex items-center gap-2 rounded-md border border-l-4 border-hairline bg-elevated px-3 text-left",
										"hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
										STATE_INK[node.state],
									)}
									style={{ width: NODE_WIDTH, height: NODE_HEIGHT }}
								>
									<Monitor
										aria-hidden="true"
										className="size-4 shrink-0 text-ink-muted"
									/>
									<span className="min-w-0 flex-1">
										<span className="block truncate text-body-sm text-ink">
											{node.label}
										</span>
										<span
											className={cn(
												"block truncate text-meta",
												STATE_TEXT[node.state],
											)}
										>
											{STATE_WORDS[node.state]}
											{node.memberships.length > 1
												? ` · ${node.memberships.length} networks`
												: ""}
										</span>
									</span>
								</button>
							</PopoverTrigger>
							<PopoverContent
								side="right"
								align="start"
								className="w-80"
								onPointerEnter={() => hold(node.id)}
								onPointerLeave={release}
								/*
								 * FOCUS GOES INTO THE CARD ONLY WHEN THE USER ASKED FOR IT.
								 * Opened by Enter/Space/click the card takes focus, so the
								 * two actions are the next Tab stops (M5). Opened by the
								 * POINTER on hover it must not: the mouse user is looking at
								 * a node, and moving their keyboard focus out from under them
								 * is how a hover card becomes a hostile one.
								 */
								onOpenAutoFocus={(event) => {
									if (openedBy.current === "pointer") event.preventDefault();
								}}
							>
								<DeviceCard
									device={node}
									nowSeconds={nowSeconds}
									actions={actions}
									inviteState={inviteState(node)}
								/>
							</PopoverContent>
						</Popover>
					</li>
				))}
			</ul>
		</div>
	);
}

const Fact = ({ label, children }: { label: string; children: ReactNode }) => (
	<div className="flex items-baseline justify-between gap-4 py-0.5">
		<dt className="shrink-0 text-meta text-ink-muted">{label}</dt>
		<dd className="min-w-0 text-right text-meta text-ink">{children}</dd>
	</div>
);

/**
 * The hover card's facts (`mesh-ui.md` §2.8's table), and ONLY the facts the
 * backend publishes: `rtt_ms` and a per-device session count are deliberately
 * absent, because the transport does not report them (§2.8, "what the hover card
 * CANNOT show today") and a card that invented them would be lying.
 *
 * The reason is the backend's words verbatim - it glosses the relay's protocol
 * tokens, and this app keeps no vocabulary of its own.
 */
/**
 * What a device's invite affordance may offer.
 *
 * `members` and `removed` are both "nothing to invite" but they are not the same
 * fact, and the card says which (QA round 1, Q5): a device that holds a REVOKED
 * membership anywhere may not be re-invited, because a burned id is never
 * admitted again however the invite is minted.
 */
type InviteState = "open" | "members" | "removed";

export function DeviceCard({
	device,
	nowSeconds,
	actions,
	inviteState,
}: {
	device: DeviceNode;
	nowSeconds: number;
	actions: DeviceActions;
	/** What this device can still be invited to. Computed by `TopologyGraph` from
	 * the topology, because the card sees one device and cannot know what the
	 * others hold - and because "removed" and "member everywhere" need different
	 * words (QA round 1, Q5). */
	inviteState: InviteState;
}) {
	return (
		<div data-device-card={device.id} className="space-y-3">
			<div>
				<p className="truncate text-body text-ink">{device.label}</p>
				<p className={cn("text-meta", STATE_TEXT[device.state])}>
					{STATE_WORDS[device.state]}
					{!device.reachable && device.reason ? ` — ${device.reason}` : ""}
				</p>
			</div>
			<dl>
				{/* Machine voice for the id, and SHORT: the tail tells two devices
				    apart, and the full 34-char hash does not fit the card. */}
				<Fact label="ID">
					<span className="font-mono">…{device.id.slice(-12)}</span>
				</Fact>
				<Fact label="Last seen">
					{device.state === "self"
						? "now"
						: device.lastSeenAt === null
							? "never"
							: shortAge(nowSeconds - device.lastSeenAt)}
				</Fact>
				<Fact label="Endpoints">
					{device.endpoints.length ? (
						<span className="font-mono">{device.endpoints.join(", ")}</span>
					) : (
						"none published"
					)}
				</Fact>
			</dl>
			{/* One block per membership: the role and capabilities are PER NETWORK,
			    and a device in two networks may hold different grants in each. */}
			<ul className="space-y-2">
				{device.memberships.map((membership) => (
					<li
						key={membership.networkId}
						className="rounded-sm border border-hairline px-2 py-1.5"
					>
						<div className="flex items-baseline justify-between gap-2">
							<span className="truncate text-meta text-ink">
								{membership.networkName}
							</span>
							<span className="shrink-0 text-meta text-ink-muted">
								{membership.role}
								{membership.active ? "" : " · revoked"}
							</span>
						</div>
						<p className="text-meta text-ink-dim">
							{membership.capabilities.length
								? membership.capabilities.join(", ")
								: "no capabilities"}
						</p>
						{actions.onRemove &&
							device.state !== "self" &&
							membership.active && (
								<button
									type="button"
									className="mt-1 text-meta text-danger underline"
									onClick={() =>
										actions.onRemove?.(device, membership.networkId)
									}
								>
									Remove from network…
								</button>
							)}
					</li>
				))}
			</ul>
			{actions.onInvite &&
				device.state !== "self" &&
				/* D7: the link was offered even when there was no network left to add the
				   device to, and the dialog could only answer "is already in every network
				   this device belongs to" - offered-but-broken, which §2.7 itself calls
				   the worst option. With no candidate the card states the fact instead of
				   promising an action it cannot take. */
				(inviteState === "open" ? (
					<button
						type="button"
						className="text-meta text-ink underline"
						onClick={() => actions.onInvite?.(device)}
					>
						Add to network…
					</button>
				) : (
					<p className="text-meta text-ink-dim">
						{inviteState === "removed"
							? "A device removed from its networks needs a new identity before it can be invited again"
							: "In every network this device belongs to"}
					</p>
				))}
		</div>
	);
}
