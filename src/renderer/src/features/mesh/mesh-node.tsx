/**
 * The canvas's nodes: a network lane on the left, a device node on the right.
 *
 * DOM ELEMENTS RATHER THAN SVG, and it is the plan's §2 decision rather than a
 * preference: a device node has to take keyboard focus, carry an accessible name
 * and act on activation, and an SVG `<g>` does none of that without re-implementing
 * focus, hit-testing and the name computation. The node's own element being a real
 * `<button>` also means the browser's hit-testing IS the hit-testing, and it gives
 * the same answer to a pointer and to a keyboard.
 *
 * WHAT A NODE MAY SAY is the plan's §5 node contract: a title, ONE stat line, and -
 * for the states that mean something - the state in words. Colour is never the only
 * channel (WCAG 1.4.1): the three states that are not the ordinary case take a hue
 * AND a word, exactly as `chat-session-status.tsx` already does for sessions.
 */

import { cn } from "@shared/lib/utils";
import { Monitor, Network } from "lucide-react";
import type { FC } from "react";
import type { DeviceState, MeshDevice, MeshNetwork } from "./mesh-graph";
import { deviceStatLine, deviceStateWords } from "./mesh-graph";
import { NODE_HEIGHT, NODE_WIDTH } from "./mesh-positions";

/**
 * The node's state stripe and its state ink, by role - and WHY ONE OF THE FOUR IS
 * NEUTRAL, which is measured rather than assumed (kept from PR #498, whose design
 * round measured it).
 *
 * The obvious mapping - self=accent, reachable=success, unreachable=warning,
 * suspect=danger - spends TWO GREENS on one channel: `localOperatorDark`'s accent
 * and success are two neighbouring greens, so a graph whose "this device" node and
 * whose healthy nodes are those two has no status channel left. The RESTING state
 * is therefore the quiet one, which is the rule the rest of this app already
 * applies: reachable is the ordinary case - most nodes, most of the time - so it
 * takes the neutral role, and the three states that mean something take a hue each.
 */
const STATE_STRIPE: Record<DeviceState, string> = {
	self: "border-l-accent",
	// The resting state is the QUIET one: `border-control` is already the node's edge,
	// so its stripe takes the decorative hairline rather than a second, louder line.
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

/** The accessible name of a device node: its label, its state in words, its stat. */
export function deviceNodeName(device: MeshDevice, nowSeconds: number): string {
	const state = deviceStateWords(device);
	return [device.label, state || null, deviceStatLine(device, nowSeconds)]
		.filter(Boolean)
		.join(", ");
}

type NetworkNodeProps = {
	network: MeshNetwork;
	x: number;
	y: number;
};

/**
 * A network lane: a heading-like row, not a control.
 *
 * It is a `<li>` rather than a button because nothing acts on it in this slice - an
 * element that takes focus and does nothing is a promise the tab does not keep -
 * while the DEVICE nodes beside it are the buttons, because clicking one is how the
 * reader gets to that device's row in the list.
 */
export const MeshNetworkNode: FC<NetworkNodeProps> = ({ network, x, y }) => (
	<li
		data-mesh-network={network.id}
		className="absolute flex items-center gap-2 rounded-md border border-hairline bg-elevated px-3"
		style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
	>
		<Network aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
		<span className="min-w-0 flex-1">
			<span className="block truncate text-body-sm text-ink">
				{network.label}
			</span>
			<span
				/*
				 * `epoch 7` is protocol vocabulary and a user cannot act on it, so it lives
				 * in the node's `title` rather than on its face - the fact stays reachable
				 * without spending a line of the graph's standing labels (the plan § 5's
				 * node contract, and #498's design round 1, D10).
				 */
				title={`epoch ${network.epoch}`}
				className="block truncate text-meta text-ink-dim"
			>
				{network.memberCount} {network.memberCount === 1 ? "device" : "devices"}
				{network.revokedCount > 0 ? ` · ${network.revokedCount} revoked` : ""}
			</span>
		</span>
	</li>
);

type DeviceNodeProps = {
	device: MeshDevice;
	x: number;
	y: number;
	nowSeconds: number;
	selected: boolean;
	/** Open this device's row in the list. The one action a node carries here. */
	onOpen: (deviceId: string) => void;
};

export const MeshDeviceNode: FC<DeviceNodeProps> = ({
	device,
	x,
	y,
	nowSeconds,
	selected,
	onOpen,
}) => (
	<button
		type="button"
		data-mesh-device={device.id}
		data-mesh-state={device.state}
		aria-current={selected ? "true" : undefined}
		onClick={() => onOpen(device.id)}
		className={cn(
			/*
			 * A CONTROL'S EDGE, per the system's own rule (`branding.md` § 2): the node is a
			 * button, its boundary is the only thing that says where it ends, so it takes
			 * `border-control` (3:1 floor) rather than the `hairline` this shipped first.
			 * The measurement that decided it: `hairline` on the node's own `elevated` fill is
			 * ΔE00 1.44 (`localOperatorLight`) and 1.23 (`localOperatorDark`) - below the
			 * system's own ΔE00 2.0 field floor, i.e. a border nobody can see - while the
			 * fill's own step off the canvas measures ΔE00 6.85 / 7.71 and is what actually
			 * separates the node from the well.
			 */
			"absolute flex items-center gap-2 rounded-md border border-l-4 border-control bg-elevated px-3 text-left",
			/*
			 * Hover is a colour step and nothing else: nothing lifts, scales or translates
			 * (`branding.md` § 5), and the focus ring is an OUTLINE rather than a box-shadow
			 * because this element sits inside an `overflow-hidden` viewport that would clip
			 * a shadow.
			 */
			"hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
			/*
			 * SELECTED: the fill step PLUS an ink edge, and the edge is not decoration.
			 * `rowSelected` against this node's own `elevated` fill measures ΔE00 7.00 on
			 * `localOperatorLight` but only 2.19 on `localOperatorDark` - barely at the
			 * system's field floor - so the fill alone cannot be the selection on every
			 * palette, and the ink edge measures 11.8:1 against the same fill. The stripe
			 * (`border-l-*`) keeps its own colour: the state stays on the channel that
			 * carries it, and the words on the stat line say it too.
			 */
			selected && "border-y-ink border-r-ink bg-row-selected",
			STATE_STRIPE[device.state],
		)}
		style={{ left: x, top: y, width: NODE_WIDTH, height: NODE_HEIGHT }}
	>
		<Monitor aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
		<span className="min-w-0 flex-1">
			<span className="block truncate text-body-sm text-ink">
				{device.label}
			</span>
			<span
				/*
				 * The stat line truncates at the node's 200 px (an unreachable device's reason
				 * is the backend's own sentence and can be any length), so the whole sentence
				 * stays reachable as the element's `title` - the same treatment the network node
				 * gives `epoch`, and one reason the list view ships beside this one.
				 */
				title={deviceStatLine(device, nowSeconds)}
				className={cn("block truncate text-meta", STATE_TEXT[device.state])}
			>
				{deviceStatLine(device, nowSeconds)}
				{device.memberships.length > 1
					? ` · ${device.memberships.length} networks`
					: ""}
			</span>
		</span>
	</button>
);
