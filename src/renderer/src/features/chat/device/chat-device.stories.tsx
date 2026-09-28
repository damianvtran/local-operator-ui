/**
 * The chat header's device control, in the states it has to answer for.
 *
 * THE COMPONENTS ARE THE SHIPPED ONES: `ChatHeader` is the real header, the chip
 * and the picker are `features/chat/device/` unmodified, and the facts they read
 * come from the app's own stores (`useCanonicalSessionsStore` for a draft's
 * destination, `useChatDeviceStore` for a move this pane issued) plus the mesh's
 * two reads over the story bridge (`peers.list`, `networks.list`). Nothing about
 * the control is faked for the frames; what is invented is the DEVICE DATA, whose
 * field names are the wire's (`mesh-types.ts`) and whose values are not.
 *
 * THE PAIR THAT MATTERS MOST is `draft-against-live`: `New on this device` and
 * `On this device` differ by one word, and that word is the whole design - a user
 * who reads a draft as a live session waits for output that is not coming. It sits
 * early in this list on purpose.
 */

import { cn } from "@shared/lib/utils";
import type { Meta, StoryObj } from "@storybook/react";
import { type ReactNode, useLayoutEffect } from "react";
import "../../../styles/index.css";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { ChatHeader } from "../../chat/components/chat-header";
import { deriveRunDetails } from "../../chat/components/run-details/run-detail-model";
import * as fixtures from "../../chat/components/run-details/run-details.fixtures";
import type { TransferReceipt } from "../../mesh/mesh-types";
import { ChatDeviceNotice } from "./chat-device-notice";
import { ChatDeviceSlot } from "./chat-device-slot";
import { type DeviceMove, useChatDeviceStore } from "./chat-device-store";

const meta = {
	title: "Chat/Device",
	parameters: { layout: "fullscreen" },
} satisfies Meta;
export default meta;

type Story = StoryObj;

const SESSION = "9f3ac1e0b7d2";
const DRAFT = "draft-4f2c";
const SELF = "d_9f3ac1e0b7d2aa41";

/* ---------------------------------------------------------------- the bridge */

/**
 * The two mesh reads the control makes, plus the four the header makes on its own.
 *
 * The capability answer is the gate: `peers` and `session_transfer` enabled is the
 * state a paired device is in, and a story that omitted them would photograph a
 * control that never renders.
 */
const installBridge = () => {
	const ok = <T,>(result: T) => ({ status: 200, body: { result } });
	const bridge = async (request: { op: string }) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_available: true,
					features: { peers: 1, session_transfer: 1 },
				});
			case "peers.list":
				return ok({
					self_device_id: SELF,
					peers: [
						{
							device_id: PEER_BUILD,
							name: "build-box",
							reachable: true,
							session_count: 3,
						},
						{
							device_id: PEER_PIXEL,
							name: "pixel-8",
							reachable: true,
							session_count: 1,
						},
						{
							device_id: PEER_GRADIENT,
							name: "gradient-m-4h",
							reachable: false,
							unreachable_reason: "no answer from this device on the last read",
							session_count: 2,
						},
					],
				});
			case "networks.list":
				return ok({
					self_device_id: SELF,
					networks: [HOME_NETWORK, LAN_NETWORK],
				});
			case "teams.list":
				return ok({
					teams: [{ name: "lopdev", manager: "manager", description: "" }],
				});
			case "commands.entities":
				return ok({ command: "", entities: [], current: null });
			case "sessions.list":
			case "sessions.command":
				return ok({ sessions: [] });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: {
				request: (r: { op: string }) => Promise<{
					status: number;
					body: unknown;
				}>;
			};
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

const PEER_BUILD = "d_4b2a91c4e0b87f3a";
const PEER_PIXEL = "d_1c77e0aa4f2b9d13";
const PEER_GRADIENT = "d_77b1c9e3d5a0f28c";

const member = (
	over: Record<string, unknown> & { device_id: string; name: string },
) => ({
	role: "drive",
	capabilities: ["list", "view", "prompt", "steer", "stop", "slash", "move"],
	active: true,
	suspect: false,
	endpoints: [],
	last_seen_at: 1789400000,
	reachable: true,
	reason: "",
	...over,
});

const HOME_NETWORK = {
	network_id: "n_4a1c",
	name: "home",
	epoch: 7,
	trust: "operator",
	members: [
		member({ device_id: SELF, name: "damian-mbp", role: "admin" }),
		member({ device_id: PEER_BUILD, name: "build-box" }),
		/* Capability-less: this is the row the move states must refuse with a reason
		 * rather than hide - it is why the picker has an ineligible arm at all. */
		member({
			device_id: PEER_PIXEL,
			name: "pixel-8",
			role: "read",
			capabilities: ["list", "view"],
			endpoints: ["10.88.0.4:4097"],
		}),
	],
};

const LAN_NETWORK = {
	network_id: "n_91be",
	name: "studio-lan",
	epoch: 2,
	trust: "operator",
	members: [
		member({ device_id: SELF, name: "damian-mbp", role: "admin" }),
		member({
			device_id: PEER_GRADIENT,
			name: "gradient-m-4h",
			endpoints: ["192.168.1.24:4097"],
			reachable: false,
			reason: "no answer from this device on the last read",
		}),
	],
};

/* ------------------------------------------------------------- the seeding */

/**
 * The two stores the control reads, seeded to the state under test.
 *
 * THE STORES *ARE* THE STATE, so seeding them is not a fixture of the component;
 * it is the same `updateDraft`/`beginMove` write the app makes, minus the user's
 * gesture. Both are cleared before each mount so one story cannot leak into the
 * next frame.
 */
const seed = (input: {
	draftPeer?: string;
	move?: DeviceMove;
	sessionId?: string | null;
}) => {
	useCanonicalSessionsStore.setState({
		drafts: input.draftPeer
			? {
					[DRAFT]: {
						key: DRAFT,
						/*
						 * The two ids a draft row carries from the moment it exists, in the
						 * shape the store itself writes them: `admissionRequestId` is the
						 * at-most-once key the send is admitted under, and `createRequestId`
						 * is the create's. Neither is read by the control; they are here so
						 * the row under test is a ROW and not a partial object.
						 */
						admissionRequestId: "story-admission",
						createRequestId: "story-create",
						peer: input.draftPeer,
					},
				}
			: {},
	});
	useChatDeviceStore.setState({
		moves:
			input.move && input.sessionId ? { [input.sessionId]: input.move } : {},
	});
};

/** A completed move, in the wire's own receipt shape (`TransferReceipt`). */
const receipt = (over: Partial<TransferReceipt> = {}): TransferReceipt => ({
	locality: "remote",
	owner_device: PEER_BUILD,
	source_retired: true,
	session_id: SESSION,
	new_session_id: SESSION,
	mode: "move",
	phases: [
		{ phase: "prepared", peer: PEER_BUILD, progress: 0.25 },
		{ phase: "copied", peer: PEER_BUILD, progress: 0.75 },
		{ phase: "done", peer: PEER_BUILD, progress: 1 },
	],
	...over,
});

/* ---------------------------------------------------------------- the mount */

const Band = ({
	width = 1000,
	children,
}: { width?: number; children: ReactNode }) => (
	<div
		data-header-band=""
		className={cn("flex shrink-0 flex-col bg-canvas")}
		style={{ width }}
	>
		{children}
	</div>
);

type MountProps = {
	title?: string;
	bandWidth?: number;
	sessionId?: string | null;
	draftPeer?: string;
	move?: DeviceMove;
	notice?: boolean;
	chipOnly?: boolean;
	/**
	 * THE CHANGE ABSENT, which is what a `before` half has to be: `deviceSlot` is
	 * omitted, so the header renders exactly as it does on `origin/main` for this
	 * state. Distinct from `chipOnly` (a DRAFT pane, which still has the control) -
	 * conflating the two is how a "before" frame ends up showing the feature.
	 */
	withoutDevice?: boolean;
};

const Mount = ({
	title = "local-operator-docs Next.js repo",
	bandWidth = 1000,
	sessionId = SESSION,
	draftPeer,
	move,
	notice = false,
	chipOnly = false,
	withoutDevice = false,
}: MountProps) => {
	useLayoutEffect(() => {
		installBridge();
		seed({ draftPeer, move, sessionId: move ? sessionId : null });
	}, [draftPeer, move, sessionId]);
	const live = chipOnly ? undefined : (sessionId ?? undefined);
	return (
		<div className={cn("flex flex-col bg-canvas")}>
			<Band width={bandWidth}>
				<ChatHeader
					agentName={title}
					identity={{
						sessionId: live ?? SESSION,
						activeAgent: "lopdev",
						activeTeam: "manager",
						boundAgent: null,
						boundTeam: null,
					}}
					onOpenOptions={() => undefined}
					onToggleBrowser={() => undefined}
					onOpenConsole={() => undefined}
					runDetails={deriveRunDetails(fixtures.idle())}
					deviceSlot={
						withoutDevice ? undefined : live ? (
							<ChatDeviceSlot sessionId={live} />
						) : (
							<ChatDeviceSlot draftKey={DRAFT} />
						)
					}
				/>
			</Band>
			{notice ? <ChatDeviceNotice sessionId={SESSION} /> : null}
		</div>
	);
};

/**
 * The fold, at the app's own band widths.
 *
 * IT MOUNTS THROUGH THE SAME BRIDGE AND THE SAME SEEDS AS `Mount`, and that is the
 * point rather than tidiness: the control renders only when the backend advertises
 * `features.peers`, so a band strip drawn without the bridge photographs three
 * headers with NO chip and calls it the fold - the defect this story's first version
 * shipped (caught by reading the frame it produced, which is what frames are for).
 */
const NarrowBands = () => {
	useLayoutEffect(() => {
		installBridge();
		seed({ sessionId: SESSION });
	}, []);
	return (
		<div className="flex flex-col gap-4 bg-canvas">
			{[800, 620, 560].map((width) => (
				<div key={width}>
					<div className="px-4 text-meta text-ink-dim">{`band ${width}px`}</div>
					<Band width={width}>
						<ChatHeader
							agentName="Nightly sweep review"
							identity={{
								sessionId: SESSION,
								activeAgent: "lopdev",
								activeTeam: "manager",
								boundAgent: null,
								boundTeam: null,
							}}
							onOpenOptions={() => undefined}
							onToggleBrowser={() => undefined}
							runDetails={deriveRunDetails(fixtures.idle())}
							deviceSlot={<ChatDeviceSlot sessionId={SESSION} />}
						/>
					</Band>
				</div>
			))}
		</div>
	);
};

/* ----------------------------------------------------------------- stories */

/** TODAY: the title line's identity chips, the device control absent. */
export const BeforeNewChat: Story = {
	render: () => <Mount withoutDevice={true} title="New chat with lopdev" />,
};

/** TODAY, on a live conversation: the second before half, so the chip's arrival in
 * the title block can be read against the row it joins. */
export const BeforeLiveLocal: Story = {
	render: () => <Mount withoutDevice={true} />,
};

/**
 * THE PAIR. A draft's destination and a live conversation's placement differ by
 * ONE word, and it is the word that decides whether a user waits for output.
 */
export const DraftAgainstLive: Story = {
	render: () => (
		<div className="flex flex-col gap-3 bg-canvas pb-3">
			<div>
				<div className="px-4 text-meta text-ink-dim">
					new chat, destination this device
				</div>
				<Mount title="New chat with lopdev" chipOnly={true} />
			</div>
			<div>
				<div className="px-4 text-meta text-ink-dim">live, on this device</div>
				<Mount />
			</div>
		</div>
	),
};

/** (a) A new chat, destination this device: nothing exists yet. */
export const NewChatLocal: Story = {
	render: () => <Mount title="New chat with lopdev" chipOnly={true} />,
};

/** (a) The same pane after the destination was set to a peer. */
export const NewChatPeer: Story = {
	render: () => (
		<Mount
			title="New chat with lopdev"
			chipOnly={true}
			draftPeer={PEER_BUILD}
		/>
	),
};

/** (b) A live conversation on this device. */
export const LiveLocal: Story = {
	render: () => <Mount />,
};

/** (c) A live conversation another device holds: the quiet dot. */
export const LiveRemoteMoved: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{
				kind: "moved",
				deviceId: PEER_BUILD,
				name: "build-box",
				receipt: receipt(),
				engaged: null,
			}}
		/>
	),
};

/** (c) That device stopped answering: the same control, one fact louder - the
 * reachability fact comes from the `peers.list` answer, not from the receipt. */
export const LiveRemoteUnreachable: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{
				kind: "moved",
				deviceId: PEER_GRADIENT,
				name: "gradient-m-4h",
				receipt: receipt({ owner_device: PEER_GRADIENT }),
				engaged: null,
			}}
		/>
	),
};

/** The in-between: a spinner in the dot's slot, the 20px box unmoved, and the
 * notice below carrying the plan's own verb. */
export const Moving: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{ kind: "moving", deviceId: PEER_BUILD, name: "build-box" }}
			notice={true}
		/>
	),
};

/** Arrived, and nothing is running there: the default, and the state whose second
 * line is mandatory. */
export const ArrivedCold: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{
				kind: "moved",
				deviceId: PEER_BUILD,
				name: "build-box",
				receipt: receipt(),
				engaged: null,
			}}
			notice={true}
		/>
	),
};

/** Arrived AND engaged: the sentence `engage_on_arrival` buys, rendered only when
 * the wire says so. */
export const ArrivedLive: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{
				kind: "moved",
				deviceId: PEER_BUILD,
				name: "build-box",
				receipt: receipt(),
				engaged: true,
			}}
			notice={true}
		/>
	),
};

/** A busy refusal, on the app's own notice: the route's sentence verbatim, its
 * code in mono, and the one remedy the refusal supports. */
export const RefusedBusy: Story = {
	render: () => (
		<Mount
			title="Nightly sweep review"
			move={{
				kind: "refused",
				name: "build-box",
				canWait: true,
				refusal: {
					code: "busy",
					sentence:
						"this session is working right now, so nothing was moved; try again when the turn finishes, or pass --wait <seconds> to re-check",
					status: 409,
					unconfirmed: false,
				},
			}}
			notice={true}
		/>
	),
};

/** The fold: the app's own band widths, where the chip is the first thing the
 * clipped second line takes. */
export const NarrowBand: Story = {
	render: () => <NarrowBands />,
};
