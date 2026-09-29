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
import { Monitor, Network } from "lucide-react";
import type { FC } from "react";
import { DRAG_THRESHOLD_PX } from "./mesh-drag";
import type { DeviceState, MeshDevice, MeshNetwork } from "./mesh-graph";
import {
	deviceNodeStatLine,
	deviceStatLine,
	deviceStateWords,
} from "./mesh-graph";
import { DEVICE_HEIGHT, NETWORK_HEIGHT, NODE_WIDTH } from "./mesh-positions";
import { sessionStripeKey } from "./mesh-sessions";
import type { ChipStripeKey, DeviceSessions } from "./mesh-sessions";
import type { MeshSessionRow } from "./mesh-types";

/**
 * The node's state stripe, its state ink, and the ring that says WHICH NODE IS YOU -
 * three channels, and WHY ONE OF THE FOUR STATES IS NEUTRAL, which is measured rather
 * than assumed (kept from PR #498, whose design round measured it).
 *
 * The obvious mapping - self=accent, reachable=success, unreachable=warning,
 * suspect=danger - spends TWO GREENS on one channel: the two roles measure ΔE00 5.07
 * apart on `localOperatorDark` (`accent` `#38c96a` against `success` `#57c785`) and
 * 2.22 on `localOperatorLight` (`#137742` against `#19764a`, the same green to the
 * eye), so a graph whose "this device" node and whose healthy nodes are those two has
 * no status channel left. The RESTING state is therefore the quiet one, which is the
 * rule the rest of this app already applies: reachable is the ordinary case - most
 * nodes, most of the time - so it takes the neutral role, and the three states that
 * mean something take a hue each.
 *
 * SELF IS A RING, NOT A HUE (design round 1, D6). The identity channel and the status
 * channel are separate on purpose: `self` takes the same neutral stripe a resting node
 * takes, and the accent lives in a ring around the node's box, which no status state
 * can spend. Before this, "this device" was an accent STRIPE - the same channel the
 * three anomalies use - so in a misconfigured graph the reader saw one green bar among
 * red and amber ones, where green conventionally reads "healthy".
 */
const STATE_STRIPE: Record<DeviceState, string> = {
	self: "border-l-hairline",
	// The resting state is the QUIET one: `border-control` is already the node's edge,
	// so its stripe takes the decorative hairline rather than a second, louder line.
	reachable: "border-l-hairline",
	unreachable: "border-l-warning",
	suspect: "border-l-danger",
};

/**
 * The identity ring, and it is `null` for every state that is not this device.
 *
 * `ring-2 ring-accent` rather than an `outline`: the ring is drawn OUTSIDE the border
 * box, so it does not eat into the 200x48 world box the layout pins, and it survives
 * the world layer's `transform: scale()` the same way the border does.
 */
const STATE_RING: Record<DeviceState, string | null> = {
	self: "ring-2 ring-accent",
	reachable: null,
	unreachable: null,
	suspect: null,
};

const STATE_TEXT: Record<DeviceState, string> = {
	self: "text-accent",
	reachable: "text-ink-muted",
	unreachable: "text-warning",
	suspect: "text-danger",
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

/** The accessible name of a device node: its label, its state in words, its stat. */
export function deviceNodeName(device: MeshDevice, nowSeconds: number): string {
	const state = deviceStateWords(device);
	return [device.label, state || null, deviceStatLine(device, nowSeconds)]
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
	ownerReachable: boolean,
): string {
	if (!ownerReachable) {
		return `unreachable${session.unreachable_reason ? ` (${session.unreachable_reason})` : ""}`;
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
	const stat = deviceStatLine(device, nowSeconds);
	/*
	 * WHAT THE NODE PAINTS IS THE NARROWER FORM (design review round 2, D12): the
	 * sentence above is what this node's accessible name and its tooltip carry, and the
	 * line below is the same facts in the words that fit 147 px. They are two renderings
	 * of one builder (`mesh-graph.ts`), so a fact cannot appear in one and not the other.
	 */
	const statAtNodeWidth = deviceNodeStatLine(device, nowSeconds);
	const name = deviceNodeName(device, nowSeconds);
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
				STATE_STRIPE[device.state],
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
				aria-label={name}
				onClick={() => onOpen(device.id)}
				className={cn(
					"flex w-full items-center gap-2 rounded-t-[5px] px-3 pt-2 pb-1 text-left",
					// A CONTROL'S CURSOR (UX review round 1, U6): this is the click-to-inspect target
					// and Tailwind's preflight leaves buttons at `cursor: default`, so the title
					// read like a label. `cursor-pointer` is the app's own spelling.
					"cursor-pointer",
					"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-[-2px]",
				)}
			>
				<Monitor
					aria-hidden="true"
					className="size-4 shrink-0 text-ink-muted"
				/>
				<span className="min-w-0 flex-1">
					<span className="block truncate text-body-sm text-ink">
						{device.label}
					</span>
					<span
						/*
						 * The stat line truncates at the node's 200 px (an unreachable device's reason
						 * is the backend's own sentence and can be any length), so the whole sentence
						 * stays reachable as the element's `title` - the same treatment the network
						 * node gives `epoch`, and one reason the list view ships beside this one.
						 */
						title={stat}
						className={cn("block truncate text-meta", STATE_TEXT[device.state])}
					>
						{statAtNodeWidth}
						{device.memberships.length > 1
							? ` · ${device.memberships.length} networks`
							: ""}
					</span>
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
					"m-0 flex list-none items-center gap-1 overflow-hidden px-3 pb-2",
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
								"rounded-sm px-1.5 py-0.5 text-meta text-ink-dim",
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
				{sessions.rows.length === 0 && emptyChipWords(device) !== null && (
					<li className="text-meta text-ink-dim">{emptyChipWords(device)}</li>
				)}
			</ul>
		</li>
	);
};

/**
 * What an empty chip row says, or `null` when it should say nothing.
 *
 * AN EMPTY OWN ROW IS A FACT, not a gap: this device is where the reader is, so
 * "no conversations here" is answerable and worth saying. A PEER'S EMPTINESS IS ONLY
 * SAID WHEN THE RELAY COUNTED IT - `session_count === 0` - because a peer that
 * answered with no rows and a peer that did not answer at all look identical from
 * here, and `null` is this feature's word for "not told". Nobody else's silence is
 * rendered as "no conversations".
 */
function emptyChipWords(device: MeshDevice): string | null {
	if (device.state === "self") return "no conversations here";
	if (device.sessionCount === 0) return "no conversations";
	return null;
}

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
	ownerReachable,
	moving,
	dragging,
	onPointerDown,
	onClick,
}) => {
	const fact = chipFact(session, ownerLabel, ownerReachable);
	if (moving) {
		return (
			// biome-ignore lint/a11y/useSemanticElements: `role="status"` has no semantic element of its own; `<output>` is for a form's result, and this is a live region inside a list item.
			<li role="status" data-mesh-session={session.id} data-mesh-moving="true">
				<span className="rounded-sm bg-sunken px-1.5 py-0.5 text-meta text-ink-muted">
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
					"w-full max-w-32 truncate rounded-sm border border-hairline bg-surface px-1.5 py-0.5 text-left text-meta text-ink-muted",
					/*
					 * LEFT-TRUNCATION: `direction: rtl` with `text-align: left` is what moves the
					 * overflow - and the ellipsis - to the START, which is where it has to be, because a
					 * device's conversations are named in series (`Sweep 011`, `Sweep 012`) and the part
					 * that tells two of them apart is the END. End-truncation is what round 2 measured at
					 * the cap: two conversations rendered as `Swe…` and `Res…`.
					 *
					 * NOT `unicode-bidi: plaintext`, which is the tempting companion and the wrong one: it
					 * makes the PARAGRAPH direction follow the first strong character, so the box goes back
					 * to truncating at the end - photographed on this branch's own `cap-at-four` frame, where
					 * the chips read `Sweep …` with the ellipsis on the right. An LTR title inside an RTL
					 * box still renders its words in order (the run is LTR; only the line's overflow side
					 * follows the box), and the full title is in the tooltip and the accessible name either
					 * way, so a title in another script is a rendering this can be judged on rather than a
					 * claim made here.
					 */
					"[direction:rtl]",
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
				 * THE TAIL IS THE READABLE END, so the truncation happens at the OTHER one.
				 *
				 * `direction: rtl` with `text-align: left` is what asks the browser for left-truncation: the
				 * box's direction decides which side the overflow - and the ellipsis - falls on, while an
				 * LTR title inside it still renders its words in order (the run is LTR; only the line's
				 * overflow side follows the box). That is where the overflow has to be, because a device's
				 * conversations are named in series (`bench-device-1 chat 0`, `bench-device-1 chat 1`) and
				 * the part that tells two of them apart is the END. End-truncation is what round 2 measured
				 * at the cap: two conversations rendered as `Swe…` and `Res…`.
				 *
				 * NOT `unicode-bidi: plaintext`, which the button's own comment above rules out: it makes the
				 * PARAGRAPH direction follow the text's first strong character, which sends the ellipsis back
				 * to the end. This comment claimed `plaintext` for a round after the class was removed
				 * (design review round 3, D15) - the code and the frames were right, the prose was stale.
				 *
				 * WHY NOT A CHARACTER BUDGET, which is what this started as: the chip's text area at
				 * the cap is **53 px** (a 67.9 px chip less its 12 px of padding and its borders),
				 * which is about eight average characters - but the width of eight characters ranges
				 * from 49 px to 62 px over the titles these stories use, so any character count is a
				 * guess that clips the tail on exactly the widest titles. The browser measures; the
				 * classes only say WHICH END loses characters.
				 */}
				{chipLabel(session)}
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
