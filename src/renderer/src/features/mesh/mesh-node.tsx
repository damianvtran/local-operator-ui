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
 *
 * ## Slice 2: the node became a CONTAINER, and the chips are why
 *
 * A device holds conversations, and the conversation is what a drag carries - so
 * the node now contains controls of its own. That is the one structural change this
 * slice makes to slice 1's node, and it is forced by HTML rather than by taste:
 * `<button>` may not contain a button, so the node is a `<li>` whose TITLE is the
 * button (the thing that opens the panel) and whose chips are siblings. The node's
 * box, its position and its pinned slot are unchanged; what changed is which
 * element inside it owns the click.
 *
 * THE CHIP BAND IS RESERVED WHETHER OR NOT IT IS FULL, which is the plan's
 * "a node must not breathe on a poll" applied to the second axis: if the node grew
 * when its first conversation appeared, every node below it in the column would
 * move at that moment - the reshuffle `mesh-positions.ts` exists to prevent - and a
 * device that gained a session would push its neighbours out from under the
 * pointer. `NODE_HEIGHT` therefore includes the band, always.
 */

import { cn } from "@shared/lib/utils";
import { Monitor, Network, ShieldAlert } from "lucide-react";
import type { FC } from "react";
import { DRAG_THRESHOLD_PX } from "./mesh-drag";
import type { DeviceState, MeshDevice, MeshNetwork } from "./mesh-graph";
import { conversationUnit, deviceStatLine } from "./mesh-graph";
import {
	DEVICE_HEIGHT,
	NETWORK_HEIGHT,
	NODE_BODY_HEIGHT,
	NODE_WIDTH,
} from "./mesh-positions";
import {
	type DeviceReach,
	REACH_DOT,
	REACH_INK,
	deviceActivity,
	deviceReach,
	reachSentence,
	reachWords,
} from "./mesh-reach";
import { sessionStripeKey } from "./mesh-sessions";
import type { ChipStripeKey, DeviceSessions } from "./mesh-sessions";
import type { MeshSessionRow } from "./mesh-types";

/**
 * The node's stripe: keyed on REACH, with the suspect overlay on top.
 *
 * WHY NOT `state` ANY MORE, and this is the design round's D2. The shipped stripe was
 * `Record<DeviceState, string>`, so a device this app never dialled - `reachable:
 * false` because the listing budget ran out, which the relay reports exactly as it
 * reports a silence - wore `border-l-warning`, the amber of `unreachable`. Two
 * channels, two different things, and the louder one was wrong: the state line said
 * `not asked` while the stripe said a machine had failed. The stripe now answers
 * "can this device be talked to", which is the question its colour is read as.
 *
 * SUSPECT OUTRANKS EVERY PROBE RESULT and keeps its hue, because it is a fact about
 * the member RECORD rather than about this app's dialect. It is applied here rather
 * than inside `mesh-reach.ts` so no surface can answer "how was it reached" with a
 * security verdict.
 *
 * TWO OF THE FOUR HUE-BEARING STATES ARE NEUTRAL, and that is the measurement the
 * shipped comments already carry: the obvious mapping (self=accent, reachable=success,
 * unreachable=warning, suspect=danger) spends TWO GREENS on one channel - `accent`
 * `#38c96a` against `success` `#57c785` measure ΔE00 5.07 apart on `localOperatorDark`
 * and 2.22 on `localOperatorLight`, the same green to the eye - so a graph whose own
 * device and whose healthy nodes are those two has no status channel left. `reached`
 * is therefore the quiet case, `not-attempted` and `unknown` take no hue at all (an
 * app's own limit and an absent read are neither of them the device's failure), and
 * `unanswered` is the one probe result that earns `warning`.
 */
const REACH_STRIPE: Record<DeviceReach, string> = {
	self: "border-l-hairline",
	// `border-control` is already the node's edge, so the resting stripe takes the
	// decorative hairline rather than a second, louder line.
	reached: "border-l-hairline",
	unanswered: "border-l-warning",
	"not-attempted": "border-l-hairline",
	unknown: "border-l-hairline",
};

/** The stripe a node actually wears: the suspect override, then the reach. */
function nodeStripe(device: MeshDevice): string {
	return device.suspect ? "border-l-danger" : REACH_STRIPE[deviceReach(device)];
}

/**
 * The identity ring, and it is `null` for every state that is not this device.
 *
 * `ring-2 ring-accent` rather than an `outline`: the ring is drawn OUTSIDE the border
 * box, so it does not eat into the 200x96 world box the layout pins, and it survives
 * the world layer's `transform: scale()` the same way the border does.
 *
 * SELF IS A RING, NOT A HUE (design round 1, D6). The identity channel and the status
 * channel are separate on purpose: `self` takes the same neutral stripe a resting node
 * takes, and the accent lives in a ring around the node's box, which no status state
 * can spend. Before this, "this device" was an accent STRIPE - the same channel the
 * anomalies use - so in a misconfigured graph the reader saw one green bar among red
 * and amber ones, where green conventionally reads "healthy".
 */
const STATE_RING: Record<DeviceState, string | null> = {
	self: "ring-2 ring-accent",
	reachable: null,
	unreachable: null,
	suspect: null,
};

/**
 * WHAT A DROP IS DOING TO THIS NODE, as one word carried on the node.
 *
 * A colour step and never a lift, a scale or a shadow: `branding.md` § 5's rule
 * holds during a drag as much as at rest, and a node that animated under a moving
 * pointer would move the target the user is aiming at - the misclick failure mode
 * this canvas's pinned layout exists to avoid. The three states are:
 *
 *   - `null` - no drag is over this node. The node's own border.
 *   - `"accept"` - the drop would do what the indicator says. The border takes the
 *     ACCENT, and the node's fill takes the accent WASH with it, because accent is
 *     already spent on "this is the device you are on" and the two states CAN be on
 *     screen at once: the identity RING is drawn for the whole gesture (a drag frame
 *     shows it on the self node while the target wears the accept border - measured,
 *     design round 1, D2, which falsified this comment's earlier claim that the two
 *     could not coexist). The ring is a 2 px outline OUTSIDE the border box and the
 *     wash is the node's own surface, so the states are told apart by a channel that
 *     neither spends twice: the ring never fills, the accept state does. SLICE 3: the
 *     rule is that accent means "where it goes" and the identity ring means "where you
 *     are", and a third state that wants accent has to bring its own second channel
 *     the way this one brought the wash.
 *   - `"refuse"` - the plan says no, and the node says so BEFORE the release: a
 *     target that accepts a drop and then refuses it is the behaviour the plan's
 *     refusal rules exist to remove. Warning, never accent: a refusal is not a
 *     destination, which is the same rule the lane's own comment states at `:190`.
 */
export type NodeDropState = "accept" | "refuse" | null;

const DROP_BORDER: Record<"accept" | "refuse", string> = {
	accept: "border-accent bg-accent-wash",
	refuse: "border-warning",
};

/**
 * The accessible name of a device node: its label, its stat, and what is running on it.
 *
 * THE STAT IS THE REACH-AWARE ONE (`deviceStatLine`), so the name cannot say
 * `unreachable` about a device nobody asked: the list view, the panel and this name all
 * read the same builder. The REASON travels in the node's own `title`
 * (`reachSentence`), which is where there is room for the relay's sentence - the node
 * draws neither, and the panel is the place that labels them.
 */
export function deviceNodeName(
	device: MeshDevice,
	nowSeconds: number,
	activity: string | null,
): string {
	return [device.label, deviceStatLine(device, nowSeconds), activity]
		.filter(Boolean)
		.join(", ");
}

/** A session's chip label: its title, else the id's tail, as every surface does. */
export function chipLabel(session: MeshSessionRow): string {
	const name = session.name.trim();
	return name || session.id.slice(-6);
}

/**
 * ONE fact about a session, for the hover - the plan's "hover = name + one fact".
 *
 * THE FACT IS THE ONE THAT DECIDES WHETHER THE CHIP CAN MOVE, because that is what
 * a reader is asking when they reach for a chip: where it lives, then whether it is
 * safe to take. An unreachable device's sentence wins over everything (it is why the
 * chip cannot move), then the liveness word, then the owner. Nothing here invents a
 * claim: an unknown `live_state` prints the owner rather than a word the backend
 * never said.
 *
 * IT READS THE OWNER DEVICE'S REACHABILITY, NOT THE ROW'S (agent review round 3, U13).
 * This is U9 one layer up: the stripe and `resolveDrop` were reconciled onto the device's
 * own fact, while the sentence a reader HEARS and READS - the chip's `title` and its
 * `aria-label` - still asked the row's copy. Where the two disagree, a screen reader
 * announces "on this device" beside a stripe that says the drop will be refused, and the
 * name is the version that is read aloud.
 */
export function chipFact(
	session: MeshSessionRow,
	ownerLabel: string,
	ownerReach: DeviceReach,
): string {
	if (ownerReach !== "reached" && ownerReach !== "self") {
		/*
		 * THE WORD IS THE REACH MODEL'S (agent review round 1, Q1). This sentence said
		 * `unreachable`, which is the word this redesign deleted from every drawn surface -
		 * and the chip is the surface that is READ ALOUD, so a not-attempted device was
		 * still announced as a failure here after every visible copy had stopped saying it.
		 */
		const words = reachWords(ownerReach);
		return session.unreachable_reason
			? `${words} (${session.unreachable_reason})`
			: words;
	}
	if (session.live_state.trim()) return session.live_state.trim();
	return session.locality === "local" ? "on this device" : `on ${ownerLabel}`;
}

/*
 * `ChipStripeKey` AND `sessionStripeKey` LIVE IN `mesh-sessions` rather than here: the
 * stripe is a DECISION about a row (the same predicate `resolveDrop` refuses on), while
 * this file is the class names it is drawn with - and keeping the decision in a module
 * with no React in it is what lets the row's own suite call it (UX review round 2, U9).
 */

/** The chip's stripe: the node's own channel, at the chip's own weight. */
const CHIP_STRIPE: Record<ChipStripeKey, string> = {
	// A resting chip takes the hairline the resting node takes: present, decorative, and
	// never a second status hue on a surface that already carries one.
	resting: "border-l-2 border-l-hairline",
	attention: "border-l-2 border-l-warning",
};

type NetworkNodeProps = {
	network: MeshNetwork;
	x: number;
	y: number;
	/** True while a dragged chip hovers this lane, where the drop will be refused. */
	refused: boolean;
};

/**
 * A network lane: a heading-like row, not a control.
 *
 * It is a `<li>` rather than a button because nothing acts on it directly - the
 * invite it offers is reached from a DEVICE, not from this lane - while the DEVICE
 * nodes beside it are the controls. Slice 2 gives it one new state and no new
 * behaviour: `refused` is set while a dragged CHIP hovers it, so the lane can say
 * what a drop there would do.
 *
 * AND WHAT A DROP THERE DOES IS REFUSE, which is worth stating because the gesture a
 * user will try is the one the protocol forbids. A conversation lives on a device, so
 * a chip dropped on a lane is refused with a sentence that names the affordance that
 * DOES add a member ("Invite to network…", on the device). A DEVICE dragged into a
 * network is the gesture `mesh-drop.ts` refuses to model as a drag at all: admission
 * is two-sided - the joining device proves the SAS - so there is no drag that adds a
 * member, and offering one would promise an act the protocol declines.
 */
export const MeshNetworkNode: FC<NetworkNodeProps> = ({
	network,
	x,
	y,
	refused,
}) => (
	<li
		data-mesh-network={network.id}
		data-mesh-network-refused={refused ? "true" : undefined}
		className={cn(
			"absolute flex items-center gap-2 rounded-md border bg-elevated px-3",
			// A refusal is the WARNING role and never the accent: the accent is spent on
			// "this device", and a lane that lit up in it would read as "drop here".
			refused ? "border-warning" : "border-hairline",
		)}
		style={{ left: x, top: y, width: NODE_WIDTH, height: NETWORK_HEIGHT }}
	>
		<Network aria-hidden="true" className="size-4 shrink-0 text-ink-muted" />
		<span className="min-w-0 flex-1">
			<span className="block truncate text-body-sm text-ink">
				{network.label}
			</span>
			<span
				/*
				 * The member count, and `epoch` as the element's `title` rather than as a
				 * second line: a lane has one line of room, and the epoch is the fact a
				 * reader consults once (when something was revoked) rather than the one
				 * they scan. Keeping it in the title spends no vertical space and keeps
				 * the number on screen - the plan § 5's node contract, and #498's design
				 * round 1, D10.
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
	/** What this device holds, and what the cap is not showing. */
	sessions: DeviceSessions;
	/** The total the peer catalogue claims, which may exceed the rows in hand. */
	sessionTotal: number;
	dropState: NodeDropState;
	/** The session this device is being asked to take, while a move is in flight. */
	movingSessionId: string | null;
	/** The chip the pointer has lifted, if any. */
	draggedSessionId: string | null;
	/** Open this device's detail panel. The node's one action. */
	onOpen: (deviceId: string) => void;
	/** Press a chip: the canvas decides whether it becomes a drag. */
	onChipPointerDown: (
		event: React.PointerEvent<HTMLButtonElement>,
		session: MeshSessionRow,
	) => void;
	/** The chip's own click: opens the device's panel, where the move menu lives. */
	onChipClick: (session: MeshSessionRow) => void;
	/** The "+N more" affordance: the rest of the list, in the panel. */
	onShowAllSessions: (deviceId: string) => void;
};
export const MeshDeviceNode: FC<DeviceNodeProps> = ({
	device,
	x,
	y,
	nowSeconds,
	selected,
	sessions,
	sessionTotal,
	dropState,
	movingSessionId,
	draggedSessionId,
	onOpen,
	onChipPointerDown,
	onChipClick,
	onShowAllSessions,
}) => {
	/*
	 * WHAT THE NODE SAYS, and what it deliberately does not.
	 *
	 * The node paints three rows and no sentence (D4/D6): `deviceStatLine` survives for the
	 * ACCESSIBLE NAME and the tooltip, where a full sentence still has a reader, but a
	 * sentence whose most-consulted clause was a rotation stamp labelled as a heartbeat is
	 * not worth three lines of a 200 px box when the same space carries a count at a fixed
	 * x and the reach word under it.
	 *
	 * `working` IS DERIVED AND SAYS SO (see `mesh-reach.ts`): the session read is paged, so
	 * a busy conversation nobody read draws as silence - which is why the activity is
	 * rendered from the rows in hand and never as a claim about the device's whole state.
	 *
	 * ONE `reach`, THREE CHANNELS: the stripe, the state line and the node's own
	 * `data-mesh-reach` hook read the same value, because two of those disagreeing on one
	 * node is the defect class this redesign exists to close.
	 */
	const { activity } = deviceActivity(device, sessions.rows);
	const working = activity === "working";
	const name = deviceNodeName(device, nowSeconds, working ? "working" : null);
	const reach = deviceReach(device);
	return (
		<li
			data-mesh-device={device.id}
			data-mesh-state={device.state}
			data-mesh-drop={dropState ?? undefined}
			aria-current={selected ? "true" : undefined}
			className={cn(
				/*
				 * A CONTROL'S EDGE, per the system's own rule (`branding.md` § 2): the node is a
				 * control, its boundary is the only thing that says where it ends, so it takes
				 * `border-control` - **3.92:1** against its own `elevated` fill on
				 * `localOperatorLight` and **3.30:1** on `localOperatorDark`, above the CONTROLS
				 * floor - beside the fill's own step off the canvas well, ΔE00 6.85 / 7.71.
				 *
				 * THE RATIONALE HERE WAS CORRECTED IN REVIEW ROUND 1 (D1), because the comment
				 * this replaced shipped a number that does not reproduce: it claimed `hairline`
				 * on `elevated` measured ΔE00 1.44 / 1.23, "a border nobody can see".
				 * Re-measured on the same head with the repo's own `deltaE`, that pair is
				 * **9.19 / 4.80** - the hairline is VISIBLE, and the frame agrees (the stripe
				 * renders as a band of `#dad5cb` against the `#fefdfa` fill in light, `#403b2c`
				 * against `#322D22` in dark). The edge is chosen for the ratio above, not for the
				 * hairline's invisibility, and the resting stripe is a deliberate quiet bar
				 * rather than nothing.
				 *
				 * THE EDGE IS ON THE `<li>` RATHER THAN ON THE TITLE BUTTON (slice 2): the node
				 * now holds the conversation chips as siblings (a `<button>` may not contain a
				 * button), so the control whose boundary this describes is the node itself.
				 */
				"absolute flex flex-col rounded-md border border-l-4 border-control bg-elevated",
				/*
				 * Hover is a colour step and nothing else: nothing lifts, scales or translates
				 * (`branding.md` § 5), and the focus ring is an OUTLINE rather than a box-shadow
				 * because this element sits inside an `overflow-hidden` viewport that would clip
				 * a shadow.
				 */
				"hover:bg-row-hover",
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
				nodeStripe(device),
				STATE_RING[device.state],
				/*
				 * THE DROP STATE WINS OVER THE STRIPE AND THE SELECTION, and it has to: while
				 * a chip is in the air the only question is whether this node will take it,
				 * and a border that answered a different question would be the node disagreeing
				 * with the indicator. It is restored the moment the drag ends - the state is a
				 * prop, so there is no local flag to leak.
				 */
				dropState && DROP_BORDER[dropState],
			)}
			style={{ left: x, top: y, width: NODE_WIDTH, height: DEVICE_HEIGHT }}
		>
			{/*
			 * THE TITLE IS THE BUTTON, and the chips below it are siblings rather than
			 * children: a `<button>` may not contain a button, and the chips have to be real
			 * buttons (they carry the drag, the menu and the keyboard path to every move
			 * outcome). The whole top band is the button, so the node's click area is what it
			 * always was.
			 */}
			<button
				type="button"
				data-mesh-device-open={device.id}
				data-mesh-reach={reach}
				aria-label={name}
				/*
				 * THE TITLE CARRIES THE REASON. The node no longer draws a sentence, so the relay's
				 * own words for a silence live one hover away (`reachSentence`: the reach word plus
				 * the backend's sentence, never re-worded), and the accessible name carries the
				 * reach word itself. Nothing on this surface says `unreachable` any more: see
				 * `REACH_STRIPE` for why that word was the defect rather than the description.
				 */
				title={reachSentence(device)}
				onClick={() => onOpen(device.id)}
				className={cn(
					/*
					 * THE BODY IS THE THREE ROWS: identity, the metric rail, the state line. The height
					 * is a constant rather than a padding sum because the node's box is pinned in world
					 * coordinates (`DEVICE_HEIGHT`), and `justify-between` absorbs the fractions of a
					 * line so those three rows cannot add up to 96.4 px and push the next node down.
					 */
					"flex w-full flex-col justify-between rounded-t-[5px] px-3 pt-2 pb-2 text-left",
					// A CONTROL'S CURSOR (UX review round 1, U6): this is the click-to-inspect target
					// and Tailwind's preflight leaves buttons at `cursor: default`, so the title
					// read like a label. `cursor-pointer` is the app's own spelling.
					"cursor-pointer",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]",
				)}
				style={{ height: NODE_BODY_HEIGHT }}
			>
				{/*
				 * ROW 1 - IDENTITY. The `ShieldAlert` is here rather than on the state line because
				 * THAT is where the design first put it and the frame refused it: the phrase
				 * `identity suspect` truncated to `identity suspe…` in a 147 px row, and a fact cut
				 * mid-word is a fact a reader mis-reads. The icon is the mark; the words stay in the
				 * panel and in the accessible name, so the colour is never the only channel.
				 */}
				<span className="flex w-full min-w-0 items-center gap-2">
					<Monitor
						aria-hidden="true"
						className="size-4 shrink-0 text-ink-muted"
					/>
					<span className="min-w-0 flex-1 truncate text-body-sm text-ink">
						{device.label}
					</span>
					{device.suspect && (
						<ShieldAlert
							aria-hidden="true"
							className="size-3.5 shrink-0 text-danger"
						/>
					)}
				</span>
				{/*
				 * ROW 2 - THE METRIC RAIL, which is ask 3's answer and the whole reason the node is
				 * taller. The count is MONOSPACE AT A FIXED X (`w-3`, 12 px, the width the frame
				 * measured between the digits at 795.8 and the unit at 808.3) so that comparing two
				 * devices is comparing digits in the same column rather than remembering a sentence.
				 *
				 * AN EN DASH, NOT A ZERO, when the count is `null`: the node's own page has carried
				 * "`null` is not `0`" since the join was written, and this is that rule made visible.
				 * The unit is dimmed there too, because "not reported" is not a measurement.
				 */}
				<span className="flex w-full min-w-0 items-baseline gap-1">
					<span className="w-3 shrink-0 font-mono text-body-sm text-ink tabular-nums">
						{device.sessionCount ?? "–"}
					</span>
					<span
						className={cn(
							"min-w-0 truncate text-meta",
							/*
							 * A STATED FLOOR, NOT A DISABLED-LOOKING WORD (UX review round 1, U6):
							 * `ink-disabled` measured 1.99:1 on this fill in dark and 2.96:1 in light,
							 * which hides the very null-vs-zero distinction this row exists to carry.
							 * `ink-dim` reads 5.25:1 on the same ground and is still clearly quieter
							 * than the count it labels.
							 */
							device.sessionCount === null ? "text-ink-dim" : "text-ink-muted",
						)}
					>
						{conversationUnit(device.sessionCount)}
					</span>
				</span>
				{/*
				 * ROW 3 - THE STATE LINE. A dot glyph, the reach word, the derived activity and the
				 * network count - in that order, and only the reach word is always there.
				 *
				 * THE DOT IS `aria-hidden` AND THE WORD IS NOT: glyph-plus-word is one fact, and a
				 * reader on a screen reader gets the word rather than a shape they cannot see.
				 */}
				<span
					data-mesh-state-line=""
					className="flex w-full min-w-0 items-baseline gap-1.5 text-meta"
				>
					<span aria-hidden="true" className="shrink-0 text-ink-dim">
						{REACH_DOT[reach]}
					</span>
					<span className={cn("shrink-0", REACH_INK[reach])}>
						{reachWords(reach)}
					</span>
					{working && (
						<span data-mesh-working="" className="shrink-0 text-info">
							working
						</span>
					)}
					{device.memberships.length > 1 && (
						<span className="min-w-0 truncate text-ink-dim">
							· {device.memberships.length} networks
						</span>
					)}
				</span>
			</button>

			{/*
			 * THE CHIP ROW IS A LIST, always present and always the same height: it is the
			 * accessible answer to "what does this device hold", and a reader walking the tab
			 * by keyboard meets the conversations inside their device rather than after it.
			 * The cap is stated rather than implied - "+N more" opens the panel, which is the
			 * only place the whole list is offered.
			 */}
			<ul
				aria-label={`Conversations on ${device.label}`}
				className={cn(
					/*
					 * THE BAND IS A FIXED 24 px, EMPTY OR NOT (`NODE_CHIP_BAND`): it is awarded by
					 * `DEVICE_HEIGHT` and this is the element that occupies it, so a node with no chips
					 * is the same height as one with two. The empty sentence that used to sit here is
					 * gone (design round's D6): `no conversations here` spent a whole text row of a 147 px
					 * box saying "nothing" beside a count that already said it, and the fact survives in
					 * the rail above and in the node's accessible name.
					 */
					/*
					 * NO VERTICAL PADDING: the band is 24 px and the chips are now a 24 px target
					 * each (UX review round 1, U7), so `pb-1.5` - which used to bias the shorter
					 * chips upward - would centre a 24 px chip in an 18 px content box and clip it
					 * against the band's own top edge. The row centres its children either way.
					 */
					"m-0 flex h-6 list-none items-center gap-1 overflow-hidden px-3",
					/*
					 * THE ROW UNDER THE GHOST DIMS (design review round 1, D4): the ghost is drawn at
					 * the pointer, so over an accepting target it lands on the row it is aimed at and
					 * split a chip's own label around it (the frame read `Rewrite the imp` · ghost ·
					 * `y`). Dimming is the minimum that finding asked for, and it is not decoration:
					 * the label under the pointer stops competing with the one word the reader has to
					 * read before committing - which the indicator now carries beside the ghost.
					 */
					dropState === "accept" && "opacity-40",
				)}
			>
				{sessions.shown.map((session) => (
					<SessionChip
						key={session.id}
						session={session}
						ownerLabel={device.label}
						ownerReach={reach}
						ownerReachable={device.reachable}
						moving={movingSessionId === session.id}
						dragging={draggedSessionId === session.id}
						onPointerDown={onChipPointerDown}
						onClick={() => onChipClick(session)}
					/>
				))}
				{sessions.hidden > 0 && (
					<li className="shrink-0">
						<button
							type="button"
							data-mesh-more={device.id}
							onClick={() => onShowAllSessions(device.id)}
							className={cn(
								/*
								 * THE SAME 24 px FLOOR AS THE CHIPS (UX review round 1, U7): this control
								 * sits in the same row, opens the same panel, and a row that fixed only
								 * the chips would leave the audit reading the control beside them.
								 */
								"flex min-h-6 items-center rounded-sm px-1.5 text-meta text-ink-dim",
								"hover:bg-row-hover hover:text-ink",
								"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
							)}
							// The second number is the CATALOGUE's when it named one, because
							// "4 of 37" over a page of 8 rows is a wrong total rather than a
							// rounded one (`deviceSessionTotal`).
							title={`Showing ${sessions.shown.length} of ${sessionTotal} conversations`}
							/*
							 * THE WORD "MORE" IS IN THE NAME, NOT ON THE CONTROL (design review round 2,
							 * D8). Measured in the shipped renderer at the pinned 200 px: the full `+4 more`
							 * label (47.4 px of text plus its 12 px of padding) took 59.4 px of the row's
							 * 171 px content box, which left each of the two chips a 51.8 px box - 37 px of
							 * text, about five characters of a title, and two truncations that read `Swe…`
							 * and `Res…`. `+4` costs 27.3 px, so each chip gets 67.9 px and 53 px of text:
							 * **+43%** more characters per chip for a word that was costing both of them.
							 * The affordance is not the word: the button's own name and its tooltip both
							 * still say what it opens, and the panel it opens is the whole list.
							 */
							aria-label={`Show all ${sessionTotal} conversations`}
						>
							+{sessions.hidden}
						</button>
					</li>
				)}
			</ul>
		</li>
	);
};

type SessionChipProps = {
	session: MeshSessionRow;
	ownerLabel: string;
	/**
	 * THE OWNER DEVICE'S OWN REACHABILITY, from the node that draws it.
	 *
	 * Passed rather than read off the row so the chip's stripe and the resolver's refusal
	 * are the same answer to the same question (UX review round 2, U9) - see
	 * `ChipStripeKey`.
	 */
	ownerReachable: boolean;
	/**
	 * The same device's REACH, for the sentence the chip SPEAKS (agent review round 1,
	 * Q1): the stripe answers "will this refuse me" from the boolean, while the words
	 * take the reach model's own vocabulary - a chip on a device nobody dialled said
	 * `unreachable` in its `title` and `aria-label`, which is the word every drawn
	 * surface had just stopped saying.
	 */
	ownerReach: DeviceReach;
	moving: boolean;
	dragging: boolean;
	onPointerDown: (
		event: React.PointerEvent<HTMLButtonElement>,
		session: MeshSessionRow,
	) => void;
	onClick: (session: MeshSessionRow) => void;
};

/**
 * One conversation, as a chip.
 *
 * A REAL BUTTON WITH A REAL DRAG ON IT, and both halves matter. The button is how
 * the chip reaches a keyboard: pressing it opens the DEVICE's panel, which is where
 * the conversations and their move menu live. That is deliberately not a menu of the
 * chip's own: a menu opens on pointerdown, which would swallow the drag before it
 * began, so the two cannot share the same press - and one menu in the feature is
 * better than a second one spelled differently on the canvas. The pointer handlers
 * are what make it grabbable, and they are on the BUTTON rather than on a wrapper so
 * the browser's own hit-testing decides what was grabbed.
 *
 * A MOVING CHIP IS NOT A BUTTON. While a move is in flight the row is about to be
 * re-read and re-filed, so the chip stops being interactive and becomes a status:
 * `role="status"` on the list item announces "moving… to <device>" politely, which
 * is the one thing a screen-reader user needs at that moment and the one thing a
 * disabled button would not say.
 */
const SessionChip: FC<SessionChipProps> = ({
	session,
	ownerLabel,
	ownerReach,
	ownerReachable,
	moving,
	dragging,
	onPointerDown,
	onClick,
}) => {
	const fact = chipFact(session, ownerLabel, ownerReach);
	if (moving) {
		return (
			// biome-ignore lint/a11y/useSemanticElements: `role="status"` has no semantic element of its own; `<output>` is for a form's result, and this is a live region inside a list item.
			<li role="status" data-mesh-session={session.id} data-mesh-moving="true">
				<span className="flex min-h-6 items-center rounded-sm bg-sunken px-1.5 text-meta text-ink-muted">
					moving…
				</span>
			</li>
		);
	}
	return (
		<li
			className="min-w-0 flex-1"
			data-mesh-session-item={session.id}
			data-mesh-dragging={dragging ? "true" : undefined}
		>
			<button
				type="button"
				data-mesh-session={session.id}
				// The drag is a POINTER gesture on top of a control, so the browser must not
				// also start a text selection or a native scroll while it is happening.
				style={{ touchAction: "none" }}
				title={`${chipLabel(session)} · ${fact}`}
				aria-label={`${chipLabel(session)}, ${fact}. Opens ${ownerLabel}.`}
				onPointerDown={(event) => onPointerDown(event, session)}
				onClick={() => onClick(session)}
				className={cn(
					/*
					 * A 24 px TARGET (UX review round 1, U7): the chip measured 115.6 x 21.1, and its
					 * miss-cost is a whole gesture - a drag start or the panel - not a no-op, while
					 * WCAG 2.5.8's own spacing exception does not hold here: the 24 px circle centred
					 * on a 21.1 px chip intersects the node body's button directly above it. The
					 * height comes from `min-h-6`, which is exactly the row's reserved band
					 * (`NODE_CHIP_BAND`), so the chip cannot grow the node.
					 *
					 * THE TEXT MOVED INTO ITS OWN SPAN with that change: a flex container cannot
					 * ellipsise its own text, so the truncation lives on the one span that still can.
					 */
					"flex min-h-6 w-full max-w-32 items-center rounded-sm border border-hairline bg-surface px-1.5 text-left text-meta text-ink-muted",
					// THE CURSOR SAYS IT CAN BE GRABBED (UX review round 1, U6): the chips are
					// the draggable things and the only cue was a `title` tooltip the reader had
					// to wait for. `cursor-pointer` is the app's own spelling for a control.
					"cursor-grab active:cursor-grabbing",
					"hover:text-ink",
					/*
					 * THE CHIP'S OWN STATE STRIPE (UX review round 1, U7): on the canvas a `busy`
					 * conversation and an idle one looked identical, and `busy` is exactly the
					 * state that refuses the move the reader is about to attempt. The stripe is
					 * the SAME channel the node uses and is NOT the only one: the exact word is in
					 * the tooltip, in the accessible name ("…, busy. Opens …") and in the panel's
					 * own column, so the stripe answers "will this one refuse me" and the words
					 * stay where there is room for them.
					 */
					CHIP_STRIPE[sessionStripeKey(session, ownerReachable)],
					/*
					 * THE DRAGGED CHIP DIMS RATHER THAN DETACHING. The real element keeps its
					 * place in the list (so nothing reflows mid-drag and the drop's own layout is
					 * the one the reader was looking at), while the ghost under the pointer is
					 * what moves.
					 */
					dragging && "opacity-60",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
				)}
			>
				{/*
				 * THE HEAD IS THE READABLE END, so the truncation happens at the OTHER
				 * one (operator report, 2026-10-04).
				 *
				 * The report's catalogue is what settled it: its chips read `…BE-OK`
				 * and `…2E pull` - the tails of `ONBOARD-PROBE-OK` and `Hub E2E pull` -
				 * and the finding is that they "identify nothing". A conversation's
				 * name is a human title whose identity is front-loaded, and every other
				 * surface that truncates one - this node's own label, the panel's rows,
				 * the list's rows - shows the head. The chip was the one place that did
				 * not.
				 *
				 * WHAT THIS TRADES AWAY, stated rather than implied: a series whose
				 * members differ only past the visible head (`Sweep 011` / `Sweep 012`
				 * at the cap) now renders as one shared prefix on both chips. The full
				 * name stays one hover away (`title`), is in the accessible name, and
				 * the PANEL is where a series is told apart. The left-truncation this
				 * replaces chose the tail for exactly that series case (design review
				 * round 2, D8/U10); measured against the operator's own titles, the
				 * tail is the end that identifies nothing.
				 *
				 * WHY NOT A CHARACTER BUDGET, which is what this started as: the chip's
				 * text area at the cap is **53 px** (a 67.9 px chip less its 12 px of
				 * padding and its borders), which is about eight average characters -
				 * but the width of eight characters ranges from 49 px to 62 px over the
				 * titles these stories use, so any character count is a guess that clips
				 * the wrong characters on the widest titles. The browser measures; the
				 * classes only say WHICH END loses characters. (Superseding round 3's
				 * D15 note: the `unicode-bidi: plaintext` hazard it records was about the
				 * left-truncation spelling, which is gone.)
				 */}
				<span className="min-w-0 flex-1 truncate">{chipLabel(session)}</span>
			</button>
		</li>
	);
};

/**
 * Where a press becomes a drag, published for the canvas and its tests.
 *
 * Re-exported rather than re-declared here so a node and the canvas cannot disagree
 * about the threshold - and the name is the one `mesh-drag.ts` documents.
 */
export { DRAG_THRESHOLD_PX };
