import {
	beginRadientAuthorityTransition,
	radientUserKeys,
} from "@shared/hooks/radient-account-authority";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, fireEvent, userEvent, waitFor, within } from "@storybook/test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
	type CSSProperties,
	type ComponentProps,
	useEffect,
	useLayoutEffect,
	useState,
} from "react";
import type {
	DesktopMediaRequest,
	DesktopMediaResponse,
	DesktopRequest,
	DesktopResponse,
} from "../../../../shared/desktop-contract";
import type {
	TeamBridgeConversation,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import type { OwnerAuditConversation } from "../../../../shared/team-bridge-owner-audit-contract";
/*
 * WHY THIS SIDE-EFFECT IMPORT IS HERE, ABOVE THE COMPONENTS. Since the page
 * mounts the shared `MessageInput`, the composer reaches
 * `window.electron.ipcRenderer` from a passive effect on mount (the platform it
 * renders the send chord for, and the native dialog behind attach). Storybook's
 * preview mocks `window.api` and not `window.electron`, so without this stand-in
 * every story in this file dies in `commitHookEffectListMount` with "Cannot read
 * properties of undefined (reading 'ipcRenderer')" - measured here after the
 * composer adoption, and the same failure `story-electron-shim.ts` already
 * documents for the chat composer's stories. It is imported for its side effect,
 * so the install has to happen before anything in this module renders.
 */
import "../chat/components/story-electron-shim";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { teamBridgeComposerKey } from "@shared/store/team-bridge-composer-rows";
import profileImage from "../../assets/radient-icon-1024x1024.png";
import { ChatLayout } from "../../shared/components/common/chat-layout";
import { draftStorageKey, draftTargetKey } from "./team-bridge-drafts";
import {
	TEAM_BRIDGE_ALL_SCOPE,
	type TeamBridgeOrganization,
	type TeamBridgeTarget,
	asTeamBridgeTenantId,
	draftCreateInput,
	organizationOptions,
} from "./team-bridge-model";
import {
	OwnerAuditRailView,
	OwnerAuditSectionHeader,
	type OwnerAuditSlot,
} from "./team-bridge-owner-audit";
import { TeamBridgePageView } from "./team-bridge-page";
import { RailGroupHeader } from "./team-bridge-rail";
import { scheduledLocalInput } from "./team-bridge-scheduling";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";
import { threadTargetFromSearch } from "./team-bridge-thread-read";

/**
 * Presentation states for the Team Bridge page.
 *
 * The view is pure, so each state here is one props change rather than a live
 * daemon: loading and error are real branches of the page, empty is a real
 * account state, and the populated boards are the two shapes that matter for
 * review — a human↔agent DM (agent badge, right-aligned own messages) and a
 * channel with unread and an invited member (the row badge and the invited
 * marker). Fixtures are hand-written rather than captured so a reviewer can see
 * exactly what the state contains; no real account ids or message bodies are
 * used.
 */

const self = "acct_self";

/**
 * Storybook has no native window chrome, so the lane's CSS gates stay off.
 * Set the same document attributes `main.tsx` writes before render; without
 * them the comparison story is not the pre-fix shape (the lane is `display:
 * none`, so nothing is reserved above the page).
 */
const useMacChromeSimulation = () => {
	useLayoutEffect(() => {
		const root = document.documentElement;
		const previous = {
			mode: root.getAttribute("data-chrome-mode"),
			platform: root.getAttribute("data-chrome-platform"),
			leading: root.getAttribute("data-chrome-leading"),
		};
		root.setAttribute("data-chrome-mode", "integrated");
		root.setAttribute("data-chrome-platform", "mac");
		root.setAttribute("data-chrome-leading", "false");
		return () => {
			for (const [key, value] of Object.entries(previous)) {
				const name = `data-chrome-${key}`;
				if (value === null) root.removeAttribute(name);
				else root.setAttribute(name, value);
			}
		};
	}, []);
};

const dm: TeamBridgeConversation = {
	id: "bcv_dm_1",
	tenant_id: "tnt_1",
	kind: "dm",
	name: "",
	visibility: "private",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: new Date().toISOString(),
	latest_seq: 4,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
			role: "member",
			state: "active",
			joined_seq: 2,
		},
	],
	last_read_seq: 2,
	unread_count: 2,
	muted: false,
};

const channel: TeamBridgeConversation = {
	id: "bcv_ch_1",
	tenant_id: "tnt_1",
	kind: "channel",
	name: "launch",
	topic: "Launch coordination",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: "acct_self",
	last_message_at: new Date(Date.now() - 4 * 60_000).toISOString(),
	latest_seq: 12,
	members: [
		{
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_bea",
			kind: "human",
			display_label: "Bea",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_cy",
			kind: "human",
			display_label: "Cy",
			role: "member",
			state: "invited",
		},
	],
	last_read_seq: 9,
	unread_count: 3,
	muted: false,
	// What agent-server sends on every row: active + invited (Damian, Bea, Cy).
	// The header must read 2 active members with 1 invited beneath, not 3
	// members: populated rows are authoritative over this aggregate field.
	member_count: 3,
};

const group: TeamBridgeConversation = {
	...channel,
	id: "bcv_grp_1",
	kind: "group",
	name: "Design review",
	visibility: "private",
	latest_seq: 3,
	last_read_seq: 3,
	unread_count: 0,
	last_message_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
};

const messages: TeamBridgeMessage[] = [
	{
		id: "bcmsg_1",
		conversation_id: dm.id,
		seq: 1,
		sender: {
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
		},
		body: "Can you take the launch checklist today?",
		origin: "human",
		created_at: new Date(Date.now() - 12 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_2",
		conversation_id: dm.id,
		seq: 2,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		body: "Yes — I am working through the two open items now.",
		body_hash: "hash-2",
		origin: "agent",
		created_at: new Date(Date.now() - 10 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_3",
		conversation_id: dm.id,
		seq: 3,
		sender: {
			account_id: "acct_self",
			kind: "human",
			display_label: "Damian",
		},
		body: "Great. Ping me if the second one needs a decision.",
		origin: "human",
		created_at: new Date(Date.now() - 8 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_4",
		conversation_id: dm.id,
		seq: 4,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		body: "It does — I have posted the question in the channel.",
		body_hash: "hash-4",
		origin: "agent",
		created_at: new Date(Date.now() - 6 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_5",
		conversation_id: dm.id,
		seq: 5,
		sender: {
			account_id: "acct_agent",
			kind: "agent",
			display_label: "Ada's agent",
		},
		// A held message: the agent's own history carries `null` until admitted.
		body: null,
		body_hash: "hash-5",
		origin: "agent",
		created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
	},
];

const minervaOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_1"),
	name: "Minerva",
	role: "owner",
	unread: 5,
};

const northwindOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_2"),
	name: "Northwind Collective",
	role: "member",
	unread: 4,
};

/** A row from the second organization, so the merged board has two chips. */
const northwindChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_2",
	tenant_id: northwindOrganization.tenantId,
	name: "field-notes",
	latest_seq: 6,
	last_read_seq: 2,
	unread_count: 4,
	last_message_at: new Date(Date.now() - 2 * 60 * 60_000).toISOString(),
};

/**
 * A discoverable channel the caller has not joined.
 *
 * `members` is EMPTY on purpose: the preview's whole point is that membership
 * is the fact withheld, so the header's count has to come from `member_count`
 * and the rail has no participant rows to draw. The messages beside it in the
 * story are a trap for the component test — they must never be rendered.
 */
const previewChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_preview",
	name: "product-design",
	topic: "Design critiques and reviews",
	visibility: "tenant",
	discoverable: true,
	member: false,
	member_count: 24,
	members: [],
	latest_seq: 41,
	last_read_seq: 0,
	unread_count: 0,
	muted: false,
	last_message_at: new Date(Date.now() - 30 * 60_000).toISOString(),
};

/** A joined channel whose notification register is the middle-low `mute`. */
const mutedChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_ch_muted",
	name: "alerts",
	discoverable: true,
	member: true,
	notify: "mute",
	muted: true,
	latest_seq: 12,
	last_read_seq: 10,
	unread_count: 2,
	last_message_at: new Date(Date.now() - 8 * 60_000).toISOString(),
};

/**
 * The rail's roster, one row per state the directory can answer with.
 *
 * The fixtures are deliberately ordered like the server orders them (no
 * client sort): the signed-in owner first, then a reachable member, a paused
 * admin, and two people whose bridge is off in each of its two spellings. The
 * screen capture therefore shows the quiet states beside the live ones, which
 * is the comparison this section exists to make.
 */
const directoryPeople = [
	{
		account_id: self,
		display_label: "Damian",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_bea",
		display_label: "Bea",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_ada",
		display_label: "Ada",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "paused" as const,
	},
	{
		account_id: "acct_cy",
		display_label: "Cy",
		role: "member",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
	{
		account_id: "acct_dee",
		display_label: "Dee",
		role: "member",
		bridge_enabled: false,
		bridge_state: "disabled" as const,
	},
];

/**
 * The SECOND organization's roster, for the union view's frames.
 *
 * Different names on purpose: the union's whole claim is that two organizations
 * read apart under their own headers, and the reader's real switcher lists
 * sibling organizations whose members share first names. This roster therefore
 * carries its own chief (Juno's owner, Ben) rather than reusing the first
 * organization's, and the reader is a member here too - so "you" appears under
 * both headers, which is correct and must not read as a duplicated row.
 */
const northwindPeople = [
	{
		account_id: self,
		display_label: "Damian",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_ines",
		display_label: "Ines Rocha",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
	{
		account_id: "acct_tomas",
		display_label: "Tomas Vidal",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active" as const,
		/* A chief of staff in THIS organization: the union's Chiefs section has
		   one row per organization, not one for the account. */
		agent: { endpoint_id: "bep_otto", name: "Otto", state: "active" },
	},
];

/**
 * A SECOND organization whose name is long enough to truncate in the 288px rail
 * (design round 1, D3): "Northwind Collective" fits, so no earlier frame could
 * show what a truncated header looks like, and a truncated name is not
 * recoverable by sight without the header's `title`.
 */
const longNameOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_2"),
	name: "Northwind Collective - Field Operations, Europe & Middle East",
	role: "member",
	unread: 4,
};

/**
 * THE EVIDENCE STORIES HOLD ONE CONVERSATION, so the sections under test - the
 * organization groups, and the audit rail after them - are ON SCREEN at the
 * 1280x720 the frames are taken at. Nothing is hidden by a scroll: the harness
 * browser's scroll action moves the window, and this page is `overflow: hidden`
 * with the rail as its own scroll container, so a below-the-fold group could not
 * be captured at all. The row set is the only thing these stories narrow; the
 * organization fixtures, rosters and read states are the general ones.
 */
const compactConversations: TeamBridgeConversation[] = [];

/** The roster minus the two bridge-off rows, so three organization groups fit. */
const compactRoster = directoryPeople.slice(0, 3);

/*
 * THE AUDIT FRAMES PUT THE ROSTERS AWAY. The audit section is the last one on the
 * rail, so at 720px every row above it is space it does not have; the audit
 * stories therefore answer both rosters empty (never unread - that would be
 * D4's spinner) and spend the height on the section under review. The roster
 * states have their own frames.
 */

/** ONE row in a third organization, so the grouped rail's height is exercised. */
const acmePeople = [
	{
		account_id: "acct_wren",
		display_label: "Wren Achebe",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active" as const,
	},
];

/** A third organization, named and sized like a real customer's sibling tenant. */
const acmeOrganization: TeamBridgeOrganization = {
	tenantId: asTeamBridgeTenantId("tnt_3"),
	name: "Field Operations (EMEA)",
	role: "admin",
	unread: 0,
};

/** A DM with one of the roster's people, so that row's DM already exists. */
const beaDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_bea",
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Damian",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_bea",
			kind: "human",
			display_label: "Bea",
			role: "member",
			state: "active",
		},
	],
};

/**
 * An invited member wears the quiet "Invited" pill (members dialog polish,
 * 2026-10-30); the old "Member · Invited; not active yet" line is gone.
 * Top-level so the regex is not rebuilt on every call.
 */
const INVITED_NOT_ACTIVE = /^Invited$/;

const meta = {
	title: "Team Bridge/Page",
	component: TeamBridgePageView,
	parameters: { layout: "fullscreen" },
	// Storybook's root has no height of its own; the app's shell gives the page
	// `flex-1 min-h-0`. The board supplies the same constraint so the capture
	// shows the real composition rather than a page collapsed to its content -
	// WHICH IS WHY THIS IS A FLEX COLUMN AND NOT A BARE `h-dvh`. `flex-1` on the
	// page is inert in a block parent, so every frame taken from here showed the
	// page at its content height (measured 2026-10-30: 565px in a 720px frame,
	// a 155px band of empty canvas under the composer): the board claimed the
	// shell's constraint in the comment above and did not deliver it.
	decorators: [
		(Story) => (
			<div className="flex h-dvh flex-col">
				<Story />
			</div>
		),
	],
	args: {
		selfAccountId: self,
		conversations: [dm, channel, group],
		/*
		 * THE HUB TAKES IMAGES, which is what offers the bar's attach control at
		 * all (`canAttach`): without it the composer draws a field and a send arrow
		 * and every frame here would photograph a control set the shipping app does
		 * not have.
		 */
		attachmentCapability: {
			enabled: true,
			max_count: 10,
			max_bytes: 10 * 1024 * 1024,
			mime_types: ["image/png", "image/jpeg", "image/webp"],
		},
		target: { type: "conversation", id: dm.id },
		messages,
		organizations: [minervaOrganization, northwindOrganization],
		scope: minervaOrganization.tenantId,
		totalUnread: minervaOrganization.unread + northwindOrganization.unread,
		listState: "ready",
		messageState: "ready",
		onTarget: () => {},
		onSend: () => {},
		onNewChannel: () => {},
		onRetry: () => {},
		onScopeChange: () => {},
		onJoin: () => {},
		onNotifyChange: () => {},
		onRetryPeople: () => {},
	},
} satisfies Meta<typeof TeamBridgePageView>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PopulatedDirectMessage: Story = {};

/*
 * A STAGED CHIP, WHICH IS A HEIGHT THE BAR CANNOT REFUSE.
 *
 * The chip row sits ABOVE the bar and is content, so a composer holding one is
 * taller than an empty one and that is correct (the operator's criterion 7,
 * 2026-10-30). The frame exists because the attach control opens an OS file
 * dialog that no capture can drive, and a review should not have to take the
 * chip's geometry on trust: the row is seeded into the very store row the box
 * reads its draft from, so what renders is the shipping attachment card, not a
 * mock of it.
 */
export const ComposerWithAttachment: Story = {
	decorators: [
		(Story) => {
			useEffect(() => {
				/*
				 * THE CHIP IS SET, NOT ADDED. The input store outlives a reload, so a
				 * fixture that only appends grows a chip on every mount - measured,
				 * six of them in one frame. Removing what the row already holds and
				 * adding one is the whole public API this needs.
				 */
				const store = useConversationInputStore.getState();
				const key = teamBridgeComposerKey(
					self,
					minervaOrganization.tenantId,
					draftTargetKey({ type: "conversation", id: dm.id }),
				);
				for (const chip of store.inputByConversation[key]?.attachments ?? [])
					store.removeAttachment(key, chip.id);
				store.addAttachment(key, {
					/*
					 * A DATA URL, WITH THE NAME THE CARD PRINTS. A filesystem path is what
					 * a real chip holds, but a frame cannot read one: the renderer has no
					 * bytes behind a path it was only told about, so the card would paint
					 * a broken thumbnail. `;name=` is where `AttachmentsPreview` reads a
					 * chip's label from, so the frame shows the real card - thumbnail,
					 * name, remove control - and the geometry it exists to show.
					 */
					id: "frame-staged-chip",
					path: "data:image/png;name=launch-checklist.png;base64,iVBORw0KGgoAAAANSUhEUgAAADAAAAAwCAIAAADYYG7QAAAAQklEQVR4nO3OQQ0AIAwAsclBBP6DLFxwPJpUQOfs9ZXJB0JCQkL1QEhISKgeCAkJCdUDISEhoXogJCQkVA+EhIQeu0KTjJdXODqoAAAAAElFTkSuQmCC",
				});
			}, []);
			return <Story />;
		},
	],
};

/*
 * The rail's Invitations entry (D5) beside the unread counts: the reader's own
 * agent is invited to the channel, so the entry shows its quiet count in the
 * SAME badge column as the conversation rows (design round 1, D3).
 */
export const InvitationWaiting: Story = {
	args: {
		conversations: [
			dm,
			{
				...channel,
				members: [
					...channel.members,
					{
						account_id: self,
						kind: "agent",
						display_label: "Robo Damian",
						role: "member",
						state: "invited",
					},
				],
			},
			group,
		],
	},
};

/**
 * The row's real hover FILL, beside the borderless human and agent plates.
 * Synthetic mouse events cannot set the browser's trusted :hover state, so this
 * capture-only rule mirrors the exact production hover declaration; the frame
 * and geometry read the resulting computed background, not just a class.
 */
export const HoveredMessageRow: Story = {
	decorators: [
		(Story) => (
			<>
				<style>
					{"[data-capture-hover] { background-color: var(--color-row-hover); }"}
				</style>
				<Story />
			</>
		),
	],
	play: async ({ canvasElement }) => {
		const row = canvasElement.querySelector("[data-message-id]");
		if (!(row instanceof HTMLElement)) throw new Error("message row missing");
		row.dataset.captureHover = "true";
	},
};

/** A manual trigger holds the live arrival open for start/mid/settled captures. */
const LiveArrivalStory = () => {
	const [live, setLive] = useState(false);
	const [frame, setFrame] = useState<"start" | "mid" | "running" | "reduced">(
		"start",
	);
	return (
		<div className="relative h-full" data-motion-frame={frame}>
			{/* Capture holds only: the production 240ms keyframes and timing function
			    are unchanged. The browser round-trip is slower than the motion, so
			    pausing at 0/100ms is the only way to photograph those actual phases. */}
			{/*
			 * Capture-only mirror of the shipped arrival class, for the same reason the
			 * hovered-row frames mirror `hover:bg-row-hover`: the browser round-trip is
			 * slower than the motion, AND the list now releases the class on a bounded
			 * timer as well as `animationend` (review round 1, A1) - so a PAUSED
			 * animation would lose its class after 600ms and photograph a settled row.
			 * The keyframes, duration and easing below are the shipped ones
			 * (`lo-team-bridge-arrival`, `--duration-slow`, `--ease-out-quart`); only
			 * who attaches the class differs, and no product code reads this.
			 */}
			<style>{`
				[data-motion-frame="start"] .lo-team-bridge-arrival { animation-play-state: paused; }
				[data-motion-frame="mid"] .lo-team-bridge-arrival { animation-delay: -100ms; animation-play-state: paused; }
				[data-motion-frame="reduced"] .lo-team-bridge-arrival { animation: none; }
				[data-motion-frame="start"] [data-message-id="bcmsg_live_arrival"] {
					animation: lo-team-bridge-arrival var(--duration-slow) var(--ease-out-quart) both;
					animation-play-state: paused;
				}
				[data-motion-frame="mid"] [data-message-id="bcmsg_live_arrival"] {
					animation: lo-team-bridge-arrival var(--duration-slow) var(--ease-out-quart) both;
					animation-delay: -100ms;
					animation-play-state: paused;
				}
				[data-motion-frame="reduced"] [data-message-id="bcmsg_live_arrival"] { animation: none; }
			`}</style>
			<TeamBridgePageView
				{...meta.args}
				messages={
					live
						? [
								...messages,
								{
									...messages[0],
									id: "bcmsg_live_arrival",
									seq: 99,
									sender: {
										account_id: "acct_live_agent",
										kind: "agent",
										display_label: "Live agent",
									},
									body: "A live arrival enters without moving the row's layout box.",
									created_at: new Date().toISOString(),
								},
							]
						: messages
				}
			/>
			<div className="absolute right-3 bottom-3 z-10 flex gap-2">
				{!live ? (
					<button
						type="button"
						data-live-arrival-trigger
						className="rounded-md bg-elevated px-3 py-2 text-ink"
						onClick={() => setLive(true)}
					>
						Trigger live arrival
					</button>
				) : (
					<>
						<button
							type="button"
							data-motion-mid
							className="rounded-md bg-elevated px-3 py-2 text-ink"
							onClick={() => setFrame("mid")}
						>
							Mid frame
						</button>
						<button
							type="button"
							data-motion-settle
							className="rounded-md bg-elevated px-3 py-2 text-ink"
							onClick={() => setFrame("running")}
						>
							Settle
						</button>
						<button
							type="button"
							data-motion-reduced
							className="rounded-md bg-elevated px-3 py-2 text-ink"
							onClick={() => setFrame("reduced")}
						>
							Reduced motion
						</button>
					</>
				)}
			</div>
		</div>
	);
};
export const LiveArrival: Story = { render: () => <LiveArrivalStory /> };

export const ChannelSelected: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: messages.map((message) => ({
			...message,
			conversation_id: channel.id,
		})),
	},
};

/**
 * The preview state: header metadata and the join banner, never a body.
 *
 * The messages are deliberately attached to the preview conversation in this
 * story. A regression that renders cached history under a non-member banner
 * would be visible here (and is asserted in the component test).
 */
export const PreviewChannel: Story = {
	args: {
		target: { type: "conversation", id: previewChannel.id },
		conversations: [dm, previewChannel, group],
		messages: messages.map((message) => ({
			...message,
			conversation_id: previewChannel.id,
		})),
	},
};

/** A muted member channel: the rail draws its quiet bell beside the unread count. */
export const MutedChannel: Story = {
	args: {
		target: { type: "conversation", id: mutedChannel.id },
		conversations: [dm, mutedChannel, group],
		messages: messages.map((message) => ({
			...message,
			conversation_id: mutedChannel.id,
		})),
	},
};

/** The header menu open on its three-level preference section. */
export const NotificationMenu: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		defaultMenuOpen: true,
	},
};

export const EmptyAccount: Story = {
	args: {
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

export const Loading: Story = {
	args: {
		listState: "loading",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

export const SendFailed: Story = {
	args: {
		sendFailed: true,
		initialDraft: "Ping me when the checklist is done.",
	},
};

export const ErrorState: Story = {
	args: {
		listState: "error",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/**
 * THE D1 PAIR (design round 1). A failed list read over rows the watcher's cache
 * already painted: the rail keeps the rows and says the refresh is what failed.
 * This is reachable in production - `list.isError` after any good read lands
 * here - and the sentence used to claim the conversations could not be loaded
 * while they sat visible underneath it.
 */
export const ErrorWithCachedRows: Story = {
	args: { listState: "error" },
};

/**
 * The list behind painted rows is being re-read. The dot names the read in
 * `data-rail-refreshing`; it wears `ink-dim`, never the attention hue green
 * (D2) - that hue is the unread count on the rows below it.
 */
export const RefreshingRows: Story = {
	args: { refreshingRows: true },
};

/** The unread read is in flight behind painted rows - same ink, different read. */
export const RefreshingUnread: Story = {
	args: { refreshingUnread: true },
};

export const ThreadError: Story = {
	args: { messageState: "error" },
};

export const SendingDisabledComposer: Story = {
	args: { sending: true },
};

/**
 * The container's real first paint for a single-membership account: scope
 * defaults to the only organization (not All), no row carries a chip, and
 * create is available.
 */
export const SingleOrganization: Story = {
	args: {
		organizations: [minervaOrganization],
		totalUnread: minervaOrganization.unread,
	},
};

/**
 * ONE organization with a full roster: the shipped single-organization rail, with
 * no subheaders and no captions. The union predicate in `team-bridge-org-rosters`
 * is `mergedView && organizations.length > 1`, so this frame must look exactly
 * like `People` above.
 */
export const SingleOrganizationRoster: Story = {
	args: {
		organizations: [minervaOrganization],
		conversations: [dm, beaDm, channel, group],
		target: { type: "conversation", id: dm.id },
		people: directoryPeople,
	},
};

/** Several organizations, one selected: the menu holds the others. */
export const MultipleOrganizations: Story = {};

/**
 * THE UNION VIEW WITH ROSTERS - the operator's own shape, and the frame the
 * design review renders.
 *
 * Channels, Groups and Direct messages stay flat and carry the organization on
 * each row; People and Chiefs of staff group under one organization subheader
 * each, because a person's row has nowhere else to say which organization it
 * would act in. `dm` belongs to Minerva, so Minerva's own People row paints it
 * and it must not appear again under Direct messages.
 */
export const AllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, beaDm, channel, group, northwindChannel],
		target: { type: "conversation", id: dm.id },
		messageState: "ready",
		directories: { tnt_1: directoryPeople, tnt_2: northwindPeople },
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
	},
};

/**
 * ONE organization's roster answered empty: its own header and an honest empty
 * line, while the other organization's rows are untouched. An organization that
 * draws an empty line is an organization that was CHECKED.
 */
export const AllOrganizationsEmptyRoster: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: compactConversations,
		target: null,
		directories: { tnt_1: compactRoster, tnt_2: [] },
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
	},
};

/**
 * ONE organization's roster read failed: an inline failure and its retry under
 * that organization's header, and the failing organization never blanks the
 * other's rows.
 */
export const AllOrganizationsRosterFailed: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: compactConversations,
		target: null,
		directories: { tnt_1: compactRoster },
		directoryStates: { tnt_1: "ready", tnt_2: "error" },
		directoryErrors: {
			tnt_2: { status: 503, message: "The directory is unavailable." },
		},
	},
};

/** Both rosters still in flight: each header carries its own read's spinner. */
export const AllOrganizationsRostersLoading: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, beaDm, channel, group, northwindChannel],
		target: { type: "conversation", id: dm.id },
		directories: {},
		directoryStates: { tnt_1: "loading", tnt_2: "loading" },
	},
};

/**
 * A LONG ORGANIZATION NAME (design round 1, D3): the subheader truncates in the
 * 288px rail instead of wrapping, and `title` recovers the full name on hover.
 * Flat rows keep their 11px caption, so both name treatments are in one frame.
 */
export const AllOrganizationsLongOrgName: Story = {
	args: {
		organizations: [minervaOrganization, longNameOrganization],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		// ONE flat row and ONE roster row per organization: the long header and a
		// flat row's 11px caption have to be in the same frame (design D3).
		conversations: [northwindChannel],
		target: null,
		directories: { tnt_1: compactRoster, tnt_2: northwindPeople },
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
	},
};

/**
 * Three organizations, one of them holding a single row: the rail scrolls and
 * the subheaders stay reachable rather than the groups running out of height.
 */
export const ThreeOrganizations: Story = {
	args: {
		organizations: [
			minervaOrganization,
			northwindOrganization,
			acmeOrganization,
		],
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, beaDm, channel, group, northwindChannel],
		target: { type: "conversation", id: dm.id },
		directories: {
			tnt_1: directoryPeople,
			tnt_2: northwindPeople,
			tnt_3: acmePeople,
		},
		directoryStates: { tnt_1: "ready", tnt_2: "ready", tnt_3: "ready" },
	},
};

/**
 * The hub lists both tenants, the memberships read has returned nothing (F6 on
 * #1314). The organizations are built through `organizationOptions` exactly as
 * the page builds them, so this frame shows the fix itself: before it, the
 * merged rail was empty here; now every row carries the hub's org name.
 */
export const AllOrganizationsHubOnly: Story = {
	args: {
		organizations: organizationOptions(
			[],
			[
				{ tenant_id: minervaOrganization.tenantId, unread: 5 },
				{ tenant_id: northwindOrganization.tenantId, unread: 4 },
			],
			[
				{ tenant_id: minervaOrganization.tenantId, tenant_name: "Minerva" },
				{
					tenant_id: northwindOrganization.tenantId,
					tenant_name: "Northwind Collective",
				},
			],
		),
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, channel, group, northwindChannel],
		// #1296 selects by `target` (the view resolves the conversation itself).
		target: { type: "conversation", id: dm.id },
		messageState: "ready",
	},
};

/** An organization that has no conversations: the switcher still names it. */
export const EmptyOrganization: Story = {
	args: {
		organizations: [minervaOrganization, northwindOrganization],
		scope: northwindOrganization.tenantId,
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/** The memberships read failed: rows cannot be labelled, so the rail says so. */
export const OrganizationsUnavailable: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		organizations: [],
		organizationsFailed: true,
		listState: "error",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/** Account-wide scope while the merged list loads: the reason stays on screen. */
export const LoadingAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		listState: "loading",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		/*
		 * THE ROSTERS ARE PENDING TOO (design round 1, D4). Without these the
		 * groups fell back to "ready" with zero members and claimed "No one else
		 * has joined this organization yet." for a read that had never answered;
		 * the code now reports `loading` for that case as well, so this story
		 * states what production states.
		 */
		directoryStates: { tnt_1: "loading", tnt_2: "loading" },
	},
};

/** Account-wide scope with nothing in it: the disabled create states its remedy. */
export const EmptyAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		// AN ANSWERED EMPTY, not an unread roster: the two now render differently
		// (design D4), and this story is about the create hint.
		directories: { tnt_1: [], tnt_2: [] },
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
	},
};

/**
 * The page in the real shell, with the chrome lane as an overlay.
 *
 * This is the shape the operator's screenshot is about: the panels start at
 * y0 and the 32px traffic-light clearance is padding INSIDE them, not a band
 * above them. `--chrome-strip-h` is set on the frame because Storybook has no
 * native window chrome; the production value comes from the same property.
 */
export const FlushToTheWindowTop: Story = {
	render: () => {
		useMacChromeSimulation();
		return (
			<div
				className="relative flex h-screen flex-col overflow-hidden"
				style={{ "--chrome-strip-h": "32px" } as CSSProperties}
			>
				<ChatLayout
					sidebar={<div className="panel-top-pad h-full bg-surface" />}
					content={
						<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView
								listState="ready"
								messageState="ready"
								conversations={[channel, group, dm]}
								target={{ type: "conversation", id: channel.id }}
								messages={messages}
								organizations={[minervaOrganization, northwindOrganization]}
								scope={asTeamBridgeTenantId("tnt_1")}
								totalUnread={3}
								selfAccountId={self}
								onTarget={() => {}}
								onSend={() => undefined}
								onNewChannel={() => {}}
								onScopeChange={() => {}}
							/>
						</main>
					}
				/>
			</div>
		);
	},
};

/**
 * The People section, fully populated: self, an openable DM, a paused person
 * and the two "bridge off" spellings. Bea's DM already exists, so her row
 * opens it; the others resolve through the seeded compose flow.
 */
export const People: Story = {
	args: {
		conversations: [dm, beaDm, channel, group],
		target: { type: "conversation", id: dm.id },
		people: directoryPeople,
	},
};

/** The directory read in flight: one quiet 30px row under the conversation list. */
export const PeopleLoading: Story = {
	args: {
		people: [],
		peopleState: "loading",
	},
};

/** A refused directory: stated in the rail, with the conversations untouched. */
export const PeopleError: Story = {
	args: {
		people: [],
		peopleState: "error",
	},
};

/** Everyone but the reader has their bridge off: the roster is visible, inert. */
export const PeopleDisabled: Story = {
	args: {
		people: directoryPeople.filter(
			(member) =>
				member.account_id === self || member.bridge_state === "disabled",
		),
	},
};

/**
 * The union view's People section with every roster answered: one organization
 * subheader per group, the reader's own row under each - correct, they are a
 * member of both - and no organization caption inside a group.
 */
export const PeopleAllOrganizations: Story = {
	args: {
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [dm, beaDm, channel, group, northwindChannel],
		directories: { tnt_1: directoryPeople, tnt_2: northwindPeople },
		directoryStates: { tnt_1: "ready", tnt_2: "ready" },
	},
};

/*
 * THE CHIEF-OF-STAFF AUDIT IN BOTH VIEWS.
 *
 * WHY A STATIC SLOT. The page takes the audit as an `OwnerAuditSlot`, which the
 * container builds with `useOwnerAuditSurface` - a hook that reads the audit
 * routes through the query cache and the desktop transport. Neither exists
 * here, so these stories hand the page a slot built from the SAME exported
 * pieces the hook composes (`OwnerAuditSectionHeader` + one `OwnerAuditRailView`
 * per organization) with each organization's read state fixed. What that buys:
 * the frames show where the audit sits in the union rail - after Chiefs of
 * staff, grouped per organization - and how its loading line reads beside the
 * rosters. What it does NOT buy: any claim that the routes answer, or that the
 * selection moves (the panel is never opened here); the hook's behaviour is
 * pinned by `scripts/team-bridge-owner-audit-render.test.mjs`.
 *
 * The organization subheader is the shared `RailGroupHeader` with the `bare`
 * inset, because the audit section carries no `RailSection` padding of its own;
 * with several organizations that is the union rail's one subheader treatment,
 * and with ONE organization there is no subheader at all, exactly as the hook
 * omits it when `organizations.length === 1`. The hook file belongs to the audit
 * lane (#1513), so this mirrors its structure rather than changing it.
 */
const auditConversation = (
	organization: TeamBridgeOrganization,
	overrides: Pick<OwnerAuditConversation, "id" | "kind" | "name"> &
		Partial<OwnerAuditConversation>,
): OwnerAuditConversation => ({
	tenant_id: organization.tenantId,
	visibility: "private",
	status: "active",
	last_message_at: "2026-10-29T15:20:00Z",
	latest_seq: 12,
	members: [],
	member_count: 2,
	viewers: [],
	agent: {
		account_id: "acct_aida",
		display_label: "Aida",
		state: "active",
		joined_seq: 1,
	},
	...overrides,
});

const auditRows: Record<string, OwnerAuditConversation[]> = {
	[minervaOrganization.tenantId]: [
		auditConversation(minervaOrganization, {
			id: "bconv_audit_ben",
			kind: "dm",
			name: null,
			members: [
				{
					account_id: "acct_ben",
					kind: "human",
					display_label: "Ben Okafor",
					role: "member",
					state: "active",
				},
				{
					account_id: "acct_aida",
					kind: "agent",
					display_label: "Aida",
					role: "member",
					state: "active",
				},
			],
		}),
		auditConversation(minervaOrganization, {
			id: "bconv_audit_deploys",
			kind: "channel",
			name: "deployments",
		}),
	],
	[northwindOrganization.tenantId]: [
		auditConversation(northwindOrganization, {
			id: "bconv_audit_launch",
			kind: "channel",
			name: "launch-room",
		}),
	],
};

function staticOwnerAudit(
	organizations: TeamBridgeOrganization[],
	state: "loading" | "ready",
): OwnerAuditSlot {
	return {
		active: false,
		clear: () => {},
		panel: null,
		rail: () => (
			<section className="mt-4" aria-label={t("ui.ownerAudit.title")}>
				<OwnerAuditSectionHeader />
				{organizations.map((organization, index) => (
					<div key={organization.tenantId}>
						{/* Mirrors `useOwnerAuditSurface` exactly, D2's first-group rule
						    included - a story that drifts from production cannot evidence
						    production's pixels. */}
						{organizations.length > 1 && (
							<RailGroupHeader
								id={`owner-audit-${organization.tenantId}`}
								name={organization.name}
								inset="bare"
								first={index === 0}
							/>
						)}
						<OwnerAuditRailView
							conversations={auditRows[organization.tenantId] ?? []}
							state={state}
							onSelect={() => {}}
							retry={() => {}}
						/>
					</div>
				))}
			</section>
		),
	};
}

/** The union rail while every organization's audit list is still being read. */
export const AllOrganizationsAuditLoading: Story = {
	args: {
		...AllOrganizations.args,
		// The audit rail must be on screen with its headers (see above).
		conversations: compactConversations,
		// Inherited from AllOrganizations.args; that conversation is not in this
		// story's list, and a pane saying "not open to you" is not what is under
		// review here.
		target: null,
		directories: { tnt_1: [], tnt_2: [] },
		ownerAudit: staticOwnerAudit(
			[minervaOrganization, northwindOrganization],
			"loading",
		),
	},
};

/** The union rail with each organization's audited conversations listed. */
export const AllOrganizationsAuditPopulated: Story = {
	args: {
		...AllOrganizations.args,
		// The audit rail must be on screen with its headers (see above).
		conversations: compactConversations,
		// Inherited from AllOrganizations.args; that conversation is not in this
		// story's list, and a pane saying "not open to you" is not what is under
		// review here.
		target: null,
		directories: { tnt_1: [], tnt_2: [] },
		ownerAudit: staticOwnerAudit(
			[minervaOrganization, northwindOrganization],
			"ready",
		),
	},
};

/** One organization, audit still loading: no organization subheader anywhere. */
export const SingleOrganizationAuditLoading: Story = {
	args: {
		...SingleOrganizationRoster.args,
		ownerAudit: staticOwnerAudit([minervaOrganization], "loading"),
	},
};

/** One organization, audit listed: the shipped single-organization rail. */
export const SingleOrganizationAuditPopulated: Story = {
	args: {
		...SingleOrganizationRoster.args,
		ownerAudit: staticOwnerAudit([minervaOrganization], "ready"),
	},
};

/** The plan gate: signed in and current, but the organization has no Team Bridge. */
export const PlanRequired: Story = {
	args: {
		eligibility: "plan_required",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/** Signed out: the panel says so; there is no fake sign-in control to press. */
export const SignedOut: Story = {
	args: {
		eligibility: "signed_out",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/** An outdated app is named as such; another panel state on the same surface. */
export const UpdateRequired: Story = {
	args: {
		eligibility: "update_required",
		conversations: [],
		target: null,
		messages: [],
		messageState: "idle",
		people: [],
	},
};

/*
 * ---------------------------------------------------------------------------
 * The Slack-shaped rail (operator review 2026-10-21): built-in channels,
 * section headers that survive empty, a person's row as their DM, chiefs of
 * staff named "{agent} ({person})" from the live directory, the addressed
 * draft that creates nothing until the first send, and the To: compose bar.
 * ---------------------------------------------------------------------------
 */

const at = (minutesAgo: number) =>
	new Date(Date.now() - minutesAgo * 60_000).toISOString();

const humansChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_builtin_humans",
	name: "humans",
	builtin: "humans",
	unread_count: 2,
	last_message_at: at(3),
};
const agentsChannel: TeamBridgeConversation = {
	...channel,
	id: "bcv_builtin_agents",
	name: "agents",
	builtin: "agents",
	unread_count: 0,
	notify: "mention",
	last_message_at: at(40),
};

/** The roster with each member's chief of staff, as the directory publishes it. */
const rosterWithChiefs = [
	{
		account_id: self,
		display_label: "Damian Tran",
		role: "owner",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_self", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_ben", name: "Aida", state: "active" },
	},
	{
		account_id: "acct_sherman",
		display_label: "Sherman Tsui",
		role: "admin",
		bridge_enabled: true,
		bridge_state: "active" as const,
		agent: { endpoint_id: "bep_sherman", name: "Juno", state: "active" },
	},
	{
		account_id: "acct_sana",
		display_label: "Sana Ketabchi",
		role: "admin",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
	{
		account_id: "acct_ola",
		display_label: "Ola Fagbemi",
		role: "admin",
		bridge_enabled: false,
		bridge_state: "none" as const,
	},
];

/** A DM with Ben whose creator label the hub stored as "Member". */
const benDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_ben",
	unread_count: 1,
	last_message_at: at(2),
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Member",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
			role: "member",
			state: "active",
		},
	],
};

const benThread: TeamBridgeMessage[] = [
	{
		id: "bcmsg_y1",
		conversation_id: benDm.id,
		seq: 1,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: "Hi, will miss the standup this morning. Deploying the remote cloud to the new AWS infra.",
		origin: "human",
		created_at: new Date(Date.now() - 26 * 60 * 60_000).toISOString(),
	},
	{
		id: "bcmsg_t1",
		conversation_id: benDm.id,
		seq: 2,
		sender: { account_id: self, kind: "human", display_label: "Member" },
		body: "Also FYI, user-dashboard is fully ported to shadcn/tailwind components.",
		origin: "human",
		created_at: at(9),
	},
	{
		id: "bcmsg_t2",
		conversation_id: benDm.id,
		seq: 3,
		sender: { account_id: self, kind: "human", display_label: "Member" },
		body: "New features there should look better out of the box, without the **MUI** jank.",
		origin: "human",
		created_at: at(8),
	},
	{
		id: "bcmsg_t3",
		conversation_id: benDm.id,
		seq: 4,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: "**What happened**\n\n- A pre-push hook pushed its own seed commit to `main`\n- `main` was restored 9 minutes later by `aa72763`\n\nI'll write up the fix.",
		origin: "human",
		created_at: at(2),
	},
];

const slackRail = {
	conversations: [humansChannel, agentsChannel, channel, benDm],
	people: rosterWithChiefs,
	organizations: [minervaOrganization],
	scope: minervaOrganization.tenantId,
};

/**
 * The operator's report, reproduced: a group they OWN, where the header shows
 * no way to bring their own chief of staff in. Membership is explicit here so
 * the frame is the reported case rather than a lucky fixture.
 */
const ownedGroup: TeamBridgeConversation = {
	...group,
	kind: "group",
	agent_capable: true,
	can_administer: true,
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Damian Tran",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_sherman",
			kind: "agent",
			display_label: "Juno",
			role: "member",
			state: "invited",
			joined_seq: 0,
		},
	],
};

const ownedGroupArgs = {
	...slackRail,
	conversations: [ownedGroup, ...slackRail.conversations],
	// `as const` keeps the target's discriminant a literal: an args bundle built
	// outside `args` widens `type` to `string` and stops matching TeamBridgeTarget.
	target: { type: "conversation" as const, id: ownedGroup.id },
	onAddMembers: () => Promise.resolve(),
	onRemoveMember: () => Promise.resolve(),
};

/** The header's person-plus control, beside the ellipsis menu. */
export const AddMembersHeaderControl: Story = {
	args: ownedGroupArgs,
};

/** The same action in the ellipsis menu, where the operator looked for it. */
export const AddMembersMenuEntry: Story = {
	args: { ...ownedGroupArgs, defaultMenuOpen: true },
};

/** The picker: current members with roles, plus the org roster and its agents. */
export const AddMembersDialog: Story = {
	args: { ...ownedGroupArgs, initialMembersOpen: true },
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		// The reader's OWN chief of staff is offered, under its current name.
		await expect(body.getByText("Aida (Damian Tran)")).toBeInTheDocument();
		// An invited agent is never painted as active.
		await expect(body.getByText(INVITED_NOT_ACTIVE)).toBeInTheDocument();
		await expect(
			body.getByRole("button", { name: "Remove Ben Tran from conversation" }),
		).toBeInTheDocument();
	},
};

/** A plain member may still invite (the hub permits it), but never remove. */
export const AddMembersPlainMember: Story = {
	args: {
		...ownedGroupArgs,
		conversations: [
			{
				...ownedGroup,
				members: ownedGroup.members.map((member) =>
					member.account_id === self && member.kind === "human"
						? { ...member, role: "member" as const }
						: member,
				),
			},
			...slackRail.conversations,
		],
		initialMembersOpen: true,
	},
	play: async ({ canvasElement }) => {
		const body = within(canvasElement.ownerDocument.body);
		await expect(
			body.queryByRole("button", { name: "Remove Ben Tran from conversation" }),
		).not.toBeInTheDocument();
	},
};

/** Ben's row is selected and IS the DM: no "@ Ben" row exists above People. */
export const PersonRowIsTheDm: Story = {
	args: {
		...slackRail,
		target: { type: "person", accountId: "acct_ben" },
		messages: benThread,
	},
};

/** Built-in #humans first, with its topic in the header. */
export const BuiltinHumansChannel: Story = {
	args: {
		...slackRail,
		target: { type: "conversation", id: humansChannel.id },
		messages: [],
	},
};

/** Built-in #agents, with its topic in the header (agents see every message). */
export const BuiltinAgentsChannel: Story = {
	args: {
		...slackRail,
		target: { type: "conversation", id: agentsChannel.id },
		messages: [],
	},
};

/** A person with no DM: an addressed draft; nothing has been created. */
export const PersonDraft: Story = {
	args: {
		...slackRail,
		conversations: [humansChannel, agentsChannel],
		target: { type: "person", accountId: "acct_sherman" },
		messages: [],
		messageState: "idle",
	},
};

/** A chief of staff selected: "Aida (Ben)", the DM created on first send. */
export const ChiefOfStaffDraft: Story = {
	args: {
		...slackRail,
		target: { type: "chief", accountId: "acct_ben" },
		messages: [],
		messageState: "idle",
	},
};

/** "Start a group conversation": the To: bar seeded with one recipient. */
export const ComposeGroup: Story = {
	args: {
		...slackRail,
		target: {
			type: "compose",
			recipients: [{ kind: "human", accountId: "acct_ben", label: "Ben Tran" }],
		},
		messages: [],
		messageState: "idle",
	},
};

/** A new organization: every header stays, each empty line is the create action. */
export const EmptySections: Story = {
	args: {
		conversations: [],
		people: [rosterWithChiefs[0]],
		organizations: [minervaOrganization],
		scope: minervaOrganization.tenantId,
		target: null,
		messages: [],
		messageState: "idle",
	},
};

/** Interactive per-target draft probe; only this fixture account is touched.
 * Navigate among channel/group/DM, type independently, then reload the story. */
function DurableDraftStory() {
	const [target, setTarget] = useState<
		import("./team-bridge-model").TeamBridgeTarget
	>({ type: "conversation", id: channel.id });
	return (
		<TeamBridgePageView
			{...meta.args}
			selfAccountId="acct_story_drafts"
			target={target}
			onTarget={(next) => {
				if (next) setTarget(next);
			}}
			initialDraft="The handoff notes are ready for review."
			onSend={async () => {
				throw new Error("fixture send refused");
			}}
			onSchedule={async () => {
				throw new Error("fixture schedule refused");
			}}
		/>
	);
}
export const DurablePerTargetDrafts: Story = {
	render: () => <DurableDraftStory />,
};

/** Seed only this disposable story account, never any operator draft. The
 * persisted attempt is the real reload/recovery path, not a visual stand-in. */
function SchedulingPageStory({
	held = false,
	narrow = false,
}: { held?: boolean; narrow?: boolean }) {
	const [account] = useState(() => {
		const accountId = held
			? "acct_story_held_attempt"
			: "acct_story_pending_schedule";
		const target = { type: "conversation" as const, id: dm.id };
		localStorage.setItem(
			draftStorageKey(accountId, dm.tenant_id),
			JSON.stringify({
				[`conversation:${dm.id}`]: {
					target,
					body: "The release handoff is ready for review.",
					clientRef: "story-schedule-reference",
					...(held
						? { sendAt: new Date(Date.now() + 3_600_000).toISOString() }
						: {}),
				},
			}),
		);
		return accountId;
	});
	return (
		<div className={narrow ? "h-full w-[640px] max-w-full" : "h-full"}>
			<TeamBridgePageView
				{...meta.args}
				selfAccountId={account}
				onSchedule={() =>
					held
						? Promise.reject(new Error("fixture response lost"))
						: new Promise(() => {})
				}
			/>
		</div>
	);
}
export const HeldAttempt: Story = {
	render: () => <SchedulingPageStory held />,
};
export const HeldAttemptNarrow: Story = {
	render: () => <SchedulingPageStory held narrow />,
};
export const HeldAttemptMinimumWidth: Story = {
	render: () => (
		<div className="h-full w-[800px] max-w-full">
			<SchedulingPageStory held />
		</div>
	),
};
export const ScheduleComposer: Story = {
	render: () => <SchedulingPageStory />,
};
export const SchedulingInFlight: Story = {
	render: () => <SchedulingPageStory />,
	play: async ({ canvasElement }) => {
		await userEvent.click(
			within(canvasElement).getByRole("button", {
				name: t("ui.teamBridge.schedule.title"),
			}),
		);
		const dialog = within(document.body).getByRole("dialog");
		fireEvent.change(
			within(dialog).getByLabelText(t("ui.teamBridge.schedule.when")),
			{
				target: {
					value: scheduledLocalInput(
						new Date(Date.now() + 3_600_000).toISOString(),
					),
				},
			},
		);
		await userEvent.click(
			within(dialog).getByRole("button", {
				name: t("ui.teamBridge.schedule.review"),
			}),
		);
		await userEvent.click(
			within(dialog).getByRole("button", {
				name: t("ui.teamBridge.schedule.confirm_action"),
			}),
		);
	},
};

/** The production Scheduled view inside the page, using the desktop transport
 * seam. A 409 transitions one row to sending; another organization refuses its
 * list. The error and successful rows must remain visible together. */
function ScheduledRecoveryPageStory() {
	const [client] = useState(
		() =>
			new QueryClient({
				defaultOptions: { queries: { retry: false, gcTime: 0 } },
			}),
	);
	useLayoutEffect(() => {
		const previous = window.api;
		let raced = false;
		const request = async (input: DesktopRequest): Promise<DesktopResponse> => {
			if (input.op === "team_bridge.scheduled.list") {
				if (input.tenant_id === northwindOrganization.tenantId)
					return {
						status: 403,
						body: {
							detail: {
								code: "not_a_member",
								message: "Fixture organization refusal",
							},
						},
					};
				const base = {
					tenant_id: minervaOrganization.tenantId,
					conversation_id: dm.id,
					send_at: new Date(Date.now() + 3_600_000).toISOString(),
					created_at: new Date().toISOString(),
				};
				return {
					status: 200,
					body: {
						result: {
							scheduled: [
								{
									...base,
									id: "bsch_story_race",
									body: "A cancellation races with delivery.",
									status: raced ? "sending" : "scheduled",
								},
								{
									...base,
									id: "bsch_story_sending",
									body: "This message is already being sent.",
									status: "sending",
								},
							],
						},
					},
				};
			}
			if (input.op === "team_bridge.scheduled.cancel") {
				raced = true;
				return {
					status: 409,
					body: {
						detail: {
							code: "invalid_transition",
							message: "Fixture delivery already started",
						},
					},
				};
			}
			return previous?.desktop?.request
				? previous.desktop.request(input)
				: { status: 501, body: { detail: "Unsupported fixture request" } };
		};
		window.api = {
			...previous,
			desktop: { ...previous?.desktop, request },
		} as typeof window.api;
		return () => {
			window.api = previous;
			client.clear();
		};
	}, [client]);
	return (
		<QueryClientProvider client={client}>
			<TeamBridgePageView
				{...meta.args}
				selfAccountId="acct_story_scheduled_page"
				scope={TEAM_BRIDGE_ALL_SCOPE}
			/>
		</QueryClientProvider>
	);
}
export const ScheduledPageRecovery: Story = {
	render: () => <ScheduledRecoveryPageStory />,
	play: async ({ canvasElement }) => {
		const canvas = within(canvasElement);
		await userEvent.click(
			canvas.getByRole("button", { name: t("ui.teamBridge.schedule.list") }),
		);
		await userEvent.click(
			await canvas.findByRole("button", {
				name: t("ui.teamBridge.schedule.cancel"),
			}),
		);
	},
};

// These boards use the real page and ChatLayout, not a width-only pane mock.
// The presentation seam prevents Storybook from contacting the operator's hub.
const threadRoot: TeamBridgeMessage = {
	...messages[0],
	conversation_id: channel.id,
	reply_count: 2,
	reply_participants: ["Bea", "Ada"],
	last_reply_at: new Date().toISOString(),
};
const threadReply: TeamBridgeMessage = {
	...messages[1],
	conversation_id: channel.id,
	thread_root_id: threadRoot.id,
};
const threadTarget = {
	tenantId: channel.tenant_id,
	conversationId: channel.id,
	rootId: threadRoot.id,
};

export const ThreadSummaryRow: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
	},
};
export const ThreadAtMinimumWindow: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
		threadLink: threadTarget,
		renderThreadPane: (_target, close) => (
			<TeamBridgeThreadPaneView
				root={threadRoot}
				replies={[threadReply]}
				state="ready"
				labelFor={(sender) => sender.display_label}
				onClose={close}
				onRetry={() => {}}
				onSend={async () => {}}
			/>
		),
	},
	render: (args) => (
		<div className="h-[700px] w-[800px] max-w-full">
			<TeamBridgePageView {...args} />
		</div>
	),
};

/**
 * A deep link opens the thread on the route's first paint. The simulated `<main>`
 * carries the shell's own `panel-top-pad` (app.tsx spells it unconditionally now
 * that the per-route `flushTop` opt-in is gone); the route root's `panel-flush`
 * cancels it, so the panels still paint from y0 and pad their own first row.
 */
export const ThreadDeepLinkFromSearch: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [],
		// The old root is deliberately NOT present in the timeline page.
		threadLink: threadTargetFromSearch(
			new URLSearchParams({
				tenant: channel.tenant_id,
				conversation: channel.id,
				thread: threadRoot.id,
			}),
		),
		renderThreadPane: (_target, close) => (
			<TeamBridgeThreadPaneView
				root={threadRoot}
				replies={[threadReply]}
				state="ready"
				labelFor={(sender) => sender.display_label}
				onClose={close}
				onRetry={() => {}}
				onSend={async () => {}}
			/>
		),
	},
	render: (args) => {
		useMacChromeSimulation();
		return (
			<div
				className="relative flex h-screen flex-col overflow-hidden"
				style={{ "--chrome-strip-h": "32px" } as CSSProperties}
			>
				<ChatLayout
					sidebar={<div className="panel-top-pad h-full bg-surface" />}
					content={
						<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden bg-canvas">
							<TeamBridgePageView {...args} />
						</main>
					}
				/>
			</div>
		);
	},
};

/** The real visibility observer drives this board's local badge, without a hub
 * request. In a background/unfocused document it intentionally remains unread;
 * once the replies intersect an active pane the same onRead seam clears it.
 */
export const ThreadReadAcknowledgement: Story = {
	args: {
		target: { type: "conversation", id: channel.id },
		messages: [threadRoot],
		threadLink: threadTarget,
	},
	render: (args) => {
		const [unread, setUnread] = useState(1);
		return (
			<TeamBridgePageView
				{...args}
				totalUnread={unread}
				conversations={[{ ...channel, unread_count: unread }]}
				renderThreadPane={(_target, close) => (
					<TeamBridgeThreadPaneView
						root={threadRoot}
						replies={[threadReply]}
						state="ready"
						labelFor={(sender) => sender.display_label}
						onClose={close}
						onRetry={() => {}}
						onSend={async () => {}}
						onRead={async () => {
							setUnread(0);
						}}
					/>
				)}
			/>
		);
	},
};

/*
 * F9 frames: enough history to overflow, so the designer can confirm the
 * timeline OPENS at the newest message (not scrollTop 0) and that a send keeps
 * it in view. The newest body names itself so the frame is self-checking.
 */
const longHistory: TeamBridgeMessage[] = Array.from(
	{ length: 24 },
	(_, index) => ({
		...messages[index % messages.length],
		id: `bcmsg_long_${index + 1}`,
		seq: index + 1,
		body:
			index === 23
				? "Newest message — this should be in view when the conversation opens."
				: `Earlier message ${index + 1} in a long conversation.`,
		created_at: new Date(Date.now() - (24 - index) * 5 * 60_000).toISOString(),
	}),
);
export const LongHistoryOpensAtNewest: Story = {
	args: { messages: longHistory },
};

/*
 * D14 (timeline): growth that is NOT a new message. Two seconds after open,
 * the newest message gains a thread rollup (a reply count), which grows the
 * timeline's inner column without changing the message list's key - the case
 * the inner-column ResizeObserver exists for (r8 m1). A pinned reader stays
 * at the bottom with the rollup in view. Scroll up first and it does not move.
 */
const RollupGrowth = (args: Story["args"]) => {
	const [rolled, setRolled] = useState(false);
	useEffect(() => {
		const timer = setTimeout(() => setRolled(true), 2000);
		return () => clearTimeout(timer);
	}, []);
	const shown: TeamBridgeMessage[] = longHistory.map((message, index) =>
		rolled && index === longHistory.length - 1
			? {
					...message,
					reply_count: 3,
					reply_participants: [message.sender.display_label],
					last_reply_at: new Date().toISOString(),
				}
			: message,
	);
	return (
		<TeamBridgePageView
			{...(args as Parameters<typeof TeamBridgePageView>[0])}
			messages={shown}
		/>
	);
};
export const LongHistoryRollupGrowsWhilePinned: Story = {
	render: (args) => <RollupGrowth {...args} />,
};

/*
 * D14 (timeline): a message ARRIVES while the reader is scrolled up. Every
 * 3 s a new message is appended. Scroll to the top first: the reader is not
 * moved. Scroll back to the bottom and later messages are followed again.
 */
const ArrivingMessages = (args: Story["args"]) => {
	const [shown, setShown] = useState(longHistory);
	useEffect(() => {
		const timer = setInterval(() => {
			setShown((current) =>
				current.length >= longHistory.length + 8
					? current
					: [
							...current,
							{
								...longHistory[longHistory.length - 1],
								id: `bcmsg_arrived_${current.length + 1}`,
								seq: current.length + 1,
								body: `Arrived message ${current.length + 1}.`,
								created_at: new Date().toISOString(),
							},
						],
			);
		}, 3000);
		return () => clearInterval(timer);
	}, []);
	return (
		<TeamBridgePageView
			{...(args as Parameters<typeof TeamBridgePageView>[0])}
			messages={shown}
		/>
	);
};
export const MessageArrivesWhileScrolledUp: Story = {
	render: (args) => <ArrivingMessages {...args} />,
};

/*
 * THE LEGACY "Member" LABEL (operator report, 2026-10-22). Production rows
 * written before agent-server #166 carry the hub's placeholder "Member" as the
 * stored label for creators and self-joins. These boards hold every sender at
 * that label: the reader (resolved from the signed-in identity, since this
 * roster leaves them out), Ben (resolved from the directory) and a member who
 * left (in no directory: rendered as an unknown person with a neutral glyph).
 */
const legacyGroup: TeamBridgeConversation = {
	...dm,
	id: "bcv_grp_legacy",
	kind: "group",
	name: "release-ops",
	unread_count: 0,
	last_read_seq: 3,
	latest_seq: 3,
	last_message_at: at(4),
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Member",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "human",
			display_label: "Member",
			role: "member",
			state: "active",
		},
		{
			account_id: "acct_departed",
			kind: "human",
			display_label: "Member",
			role: "member",
			state: "removed",
		},
	],
};

const legacyThread: TeamBridgeMessage[] = [
	["acct_ben", "Cutting the 0.42 release branch now.", 30],
	[self, "Thanks. I'll take the changelog.", 20],
	["acct_departed", "Handing my open tickets over before I go.", 12],
	[self, "Got them, thank you.", 4],
].map(([accountId, body, minutesAgo], index) => ({
	id: `bcmsg_legacy_${index + 1}`,
	conversation_id: legacyGroup.id,
	seq: index + 1,
	sender: {
		account_id: accountId as string,
		kind: "human" as const,
		display_label: "Member",
	},
	body: body as string,
	origin: "human" as const,
	created_at: at(minutesAgo as number),
}));

/** Every stored label is "Member": names come from directory and identity. */
export const LegacyMemberLabels: Story = {
	args: {
		conversations: [humansChannel, legacyGroup],
		// The roster leaves the reader out, as a self-excluding directory does.
		people: rosterWithChiefs.slice(1),
		organizations: [minervaOrganization],
		scope: minervaOrganization.tenantId,
		selfName: "Damian Tran",
		target: { type: "conversation", id: legacyGroup.id },
		messages: legacyThread,
	},
};

/** The same thread in the merged view, named from its organization's roster. */
export const LegacyMemberLabelsAllOrganizations: Story = {
	args: {
		...LegacyMemberLabels.args,
		scope: TEAM_BRIDGE_ALL_SCOPE,
		people: [],
		directories: { [minervaOrganization.tenantId]: rosterWithChiefs.slice(1) },
	},
};

/** Public directory fixtures, not a profile endpoint: one roster feeds the rail,
 * timeline and card. The media seam alone varies to exercise stable fallbacks. */
function ProfileDirectoryStory({
	avatarState,
	longFields = false,
	...args
}: ComponentProps<typeof TeamBridgePageView> & {
	avatarState: "ready" | "loading" | "error" | "decode-error" | "empty";
	longFields?: boolean;
}) {
	const [client] = useState(() => {
		const value = new QueryClient({
			defaultOptions: { queries: { retry: false } },
		});
		value.setQueryData(radientUserKeys.user(), { account: { id: self } });
		return value;
	});
	const [target, setTarget] = useState(args.target);
	const [scope, setScope] = useState(args.scope);
	useLayoutEffect(() => {
		const previous = window.api;
		const media = async (
			input: DesktopMediaRequest,
		): Promise<DesktopMediaResponse> => {
			if (input.op !== "team_bridge.avatar")
				return {
					status: 404,
					kind: "error",
					detail: "Fixture media not found",
				};
			if (avatarState === "loading") return new Promise(() => {});
			if (avatarState === "error")
				return {
					status: 404,
					kind: "error",
					detail: "Fixture avatar unavailable",
				};
			if (avatarState === "decode-error")
				return {
					status: 200,
					kind: "bytes",
					mimeType: "image/png",
					data: new Uint8Array([1, 2, 3]),
				};
			const bytes = await (await fetch(profileImage)).arrayBuffer();
			return {
				status: 200,
				kind: "bytes",
				mimeType: "image/png",
				data: new Uint8Array(bytes),
			};
		};
		window.api = {
			...previous,
			desktop: { ...previous?.desktop, media },
		} as typeof window.api;
		return () => {
			window.api = previous;
			beginRadientAuthorityTransition(client);
			client.clear();
		};
	}, [avatarState, client]);
	const people = directoryPeople.map((member) =>
		member.account_id !== "acct_bea" || avatarState === "empty"
			? {
					...member,
					account_id:
						member.account_id === "acct_bea" ? "acc_bea" : member.account_id,
				}
			: {
					...member,
					account_id: "acc_bea",
					agent: {
						name: "Aida",
						endpoint_id: "ep_bea",
						state: "active" as const,
					},
					profile: {
						display_name: "Bea",
						title: "Product designer",
						description: longFields
							? "Designing useful, accessible tools for the team across organizations and time zones. ".repeat(
									5,
								)
							: "Designing useful, accessible tools for the team.",
						pronouns: "she/her",
						timezone: "Europe/Paris",
						avatar: {
							source: "uploaded" as const,
							hash: "0123456789abcdef",
							updated_at: "2026-10-26T10:00:00Z",
						},
					},
					avatar_url: "/v1/accounts/acc_bea/avatar?v=0123456789abcdef",
				},
	);
	return (
		<QueryClientProvider client={client}>
			<div
				className="h-full"
				data-profile-target={JSON.stringify(target)}
				data-profile-scope={scope}
				data-profile-tenant={
					target?.type === "conversation"
						? args.conversations.find((row) => row.id === target.id)?.tenant_id
						: scope
				}
			>
				<TeamBridgePageView
					{...args}
					people={people}
					directories={
						args.directories ?? {
							[minervaOrganization.tenantId]: people,
							[northwindOrganization.tenantId]: people.map((member) =>
								member.account_id === "acc_bea"
									? {
											...member,
											display_label: "Bea Northwind",
											profile: {
												...("profile" in member ? member.profile : {}),
												display_name: "Bea Northwind",
												title: "Northwind designer",
												description: "Northwind directory profile",
												pronouns: "she/her",
												timezone: "Europe/Paris",
											},
										}
									: member,
							),
						}
					}
					target={target}
					scope={scope}
					onTarget={setTarget}
					onScopeChange={setScope}
				/>
			</div>
		</QueryClientProvider>
	);
}
const profileArgs = {
	conversations: [
		{
			...beaDm,
			members: beaDm.members.map((member) =>
				member.account_id === "acct_bea"
					? { ...member, account_id: "acc_bea" }
					: member,
			),
		},
		channel,
	],
	target: { type: "conversation" as const, id: beaDm.id },
	messages: [
		{
			...messages[0],
			id: "profile-message",
			conversation_id: beaDm.id,
			sender: {
				account_id: "acc_bea",
				kind: "human" as const,
				display_label: "Old stored name",
			},
			body: "Here is the latest design review.",
		},
	],
};
export const ProfileFull: Story = {
	args: { ...profileArgs, target: { type: "conversation", id: channel.id } },
	render: (args) => <ProfileDirectoryStory {...args} avatarState="ready" />,
	// Storybook drives DOM events here; these are not trusted native keyboard or
	// pointer inputs. Browser review still inspects the real rendered result.
	play: async ({ canvasElement }) => {
		const trigger = canvasElement.querySelector<HTMLButtonElement>(
			'[data-team-bridge-person="acc_bea"]',
		);
		if (!trigger) throw new Error("Profile fixture trigger missing");
		trigger.focus();
		const body = within(canvasElement.ownerDocument.body);
		await body.findByRole("dialog");
		await userEvent.keyboard("{Escape}");
		await waitFor(() =>
			expect(body.queryByRole("dialog")).not.toBeInTheDocument(),
		);
		trigger.blur();
		await userEvent.hover(trigger);
		const card = await body.findByRole("dialog");
		await userEvent.click(
			within(card).getByRole("button", {
				name: t("ui.teamBridge.profile.message"),
			}),
		);
		await waitFor(() =>
			expect(
				canvasElement.querySelector("[data-profile-target]"),
			).toHaveAttribute(
				"data-profile-target",
				JSON.stringify({ type: "person", accountId: "acc_bea" }),
			),
		);
		await expect(trigger).toHaveAttribute("aria-current", "page");
		await expect(
			canvasElement.querySelector("[data-profile-tenant]"),
		).toHaveAttribute("data-profile-tenant", minervaOrganization.tenantId);
		await expect(
			canvasElement.querySelector("[data-profile-scope]"),
		).toHaveAttribute("data-profile-scope", minervaOrganization.tenantId);
		trigger.blur();
		trigger.focus();
		await body.findByRole("dialog");
	},
};
export const ProfileEmpty: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="empty" />,
};
export const ProfileAvatarLoading: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="loading" />,
};
export const ProfileAvatarError: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="error" />,
};
export const ProfileReadOnlyHistory: Story = {
	args: { ...profileArgs, readOnly: true },
	render: (args) => <ProfileDirectoryStory {...args} avatarState="empty" />,
};

const openProfile =
	(name: string, noMessage = false) =>
	async ({ canvasElement }: { canvasElement: HTMLElement }) => {
		const trigger = within(canvasElement).getAllByRole("button", {
			name: t("ui.teamBridge.profile.open_profile", { name }),
		})[0];
		trigger.focus();
		const dialog = await within(canvasElement.ownerDocument.body).findByRole(
			"dialog",
		);
		if (noMessage)
			await expect(
				within(dialog).queryByRole("button", {
					name: t("ui.teamBridge.profile.message"),
				}),
			).not.toBeInTheDocument();
	};
export const ProfileSelf: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="empty" />,
	play: openProfile("Damian", true),
};
export const ProfileUnavailable: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="empty" />,
	play: openProfile("Cy", true),
};
export const ProfileChief: Story = {
	args: profileArgs,
	render: (args) => <ProfileDirectoryStory {...args} avatarState="ready" />,
	play: async ({ canvasElement }) => {
		const trigger = canvasElement.querySelector<HTMLButtonElement>(
			'[data-team-bridge-chief="acc_bea"]',
		);
		if (!trigger) throw new Error("Chief fixture trigger missing");
		trigger.focus();
		await within(canvasElement.ownerDocument.body).findByRole("dialog");
	},
};
export const ProfileLongNarrow: Story = {
	args: profileArgs,
	parameters: { viewport: { defaultViewport: "mobile1" } },
	render: (args) => (
		<ProfileDirectoryStory {...args} avatarState="ready" longFields />
	),
	play: openProfile("Bea"),
};

/** Scroll the production card, rather than a surrogate, so the final frame
 * proves its action remains reachable below a long profile on a narrow viewport. */
export const ProfileLongNarrowScrolled: Story = {
	...ProfileLongNarrow,
	play: async ({ canvasElement }) => {
		await openProfile("Bea")({ canvasElement });
		const card = await within(canvasElement.ownerDocument.body).findByRole(
			"dialog",
		);
		const viewport = canvasElement.ownerDocument.defaultView;
		const scroll = card.querySelector<HTMLElement>("[data-profile-scroll]");
		if (!viewport || !scroll)
			throw new Error("Profile scroll viewport missing");
		await waitFor(() => {
			const rect = card.getBoundingClientRect();
			expect(rect.width).toBeGreaterThan(0);
			expect(rect.height).toBeGreaterThan(0);
			expect(rect.top).toBeGreaterThanOrEqual(0);
			expect(rect.left).toBeGreaterThanOrEqual(0);
			expect(rect.bottom).toBeLessThanOrEqual(viewport.innerHeight);
			expect(rect.right).toBeLessThanOrEqual(viewport.innerWidth);
		});
		// A no-overflow fixture cannot prove that the bottom action is reachable.
		await expect(scroll.scrollHeight).toBeGreaterThan(scroll.clientHeight);
		scroll.scrollTop = scroll.scrollHeight;
		await new Promise<void>((resolve) =>
			viewport.requestAnimationFrame(() => resolve()),
		);
		const message = within(card).getByRole("button", {
			name: t("ui.teamBridge.profile.message"),
		});
		await waitFor(() => {
			const action = message.getBoundingClientRect();
			const bounds = card.getBoundingClientRect();
			const visible = scroll.getBoundingClientRect();
			expect(scroll.scrollTop).toBeGreaterThan(0);
			expect(action.height).toBeGreaterThan(0);
			expect(action.top).toBeGreaterThanOrEqual(
				Math.max(bounds.top, visible.top),
			);
			expect(action.bottom).toBeLessThanOrEqual(
				Math.min(bounds.bottom, visible.bottom),
			);
			expect(action.left).toBeGreaterThanOrEqual(
				Math.max(bounds.left, visible.left),
			);
			expect(action.right).toBeLessThanOrEqual(
				Math.min(bounds.right, visible.right),
			);
		});
	},
};

export const ProfileAvatarDecodeError: Story = {
	args: profileArgs,
	render: (args) => (
		<ProfileDirectoryStory {...args} avatarState="decode-error" />
	),
	play: openProfile("Bea"),
};

const northwindProfileDm: TeamBridgeConversation = {
	...profileArgs.conversations[0],
	id: "bcv_profile_northwind",
	tenant_id: northwindOrganization.tenantId,
	last_message_at: "2026-10-25T10:00:00Z",
};
export const ProfileMergedTenantMessage: Story = {
	args: {
		...profileArgs,
		scope: TEAM_BRIDGE_ALL_SCOPE,
		conversations: [
			...profileArgs.conversations,
			northwindChannel,
			northwindProfileDm,
		],
		target: { type: "conversation", id: northwindChannel.id },
		messages: profileArgs.messages.map((message) => ({
			...message,
			conversation_id: northwindChannel.id,
		})),
	},
	render: (args) => <ProfileDirectoryStory {...args} avatarState="ready" />,
	play: async ({ canvasElement }) => {
		const state = canvasElement.querySelector("[data-profile-target]");
		await expect(state).toHaveAttribute(
			"data-profile-target",
			JSON.stringify({ type: "conversation", id: northwindChannel.id }),
		);
		const trigger = within(canvasElement).getAllByRole("button", {
			name: t("ui.teamBridge.profile.open_profile", { name: "Bea Northwind" }),
		})[0];
		trigger.focus();
		const card = await within(canvasElement.ownerDocument.body).findByRole(
			"dialog",
		);
		await userEvent.click(
			within(card).getByRole("button", {
				name: t("ui.teamBridge.profile.message"),
			}),
		);
		await waitFor(() =>
			expect(state).toHaveAttribute(
				"data-profile-target",
				JSON.stringify({ type: "conversation", id: northwindProfileDm.id }),
			),
		);
		await expect(state).toHaveAttribute(
			"data-profile-tenant",
			northwindOrganization.tenantId,
		);
		await expect(state).toHaveAttribute(
			"data-profile-scope",
			TEAM_BRIDGE_ALL_SCOPE,
		);
	},
};

/** Production-shaped regression: one active human owner, three invited agents.
 * The header reads "1 active member" over "3 invited", derived from the
 * participant rows; no `member_count` is needed.
 */
export const FourMembersThreeInvited: Story = {
	args: {
		organizations: [minervaOrganization],
		scope: asTeamBridgeTenantId("tnt_1"),
		conversations: [
			{
				...channel,
				id: "bcv_qa_coordination",
				name: "qa-coordination",
				member_count: undefined,
				members: [
					{
						account_id: self,
						kind: "human",
						display_label: "Damian Tran",
						role: "owner",
						state: "active",
					},
					...["Ben Tran", "Sana Ketabchi", "Sherman Tsui"].map(
						(name, index) => ({
							account_id: `acct_invited_${index}`,
							kind: "agent" as const,
							display_label: name,
							role: "member" as const,
							state: "invited" as const,
						}),
					),
				],
			},
		],
		target: { type: "conversation", id: "bcv_qa_coordination" },
		people: rosterWithChiefs,
		messages: [],
	},
};

/**
 * The reader HAS an enrolled agent ("Aida"), and neither the picker nor the
 * Chiefs of staff section offers it (review R1-2 on #1441): a bridge DM with
 * your own agent stays `invited` and muted on the hub, so its messages would
 * post and never be delivered. See `chiefsOfStaff`.
 */
export const OwnChiefWithheld: Story = {
	// The real picker, controlled, so browser QA can open it and confirm the
	// reader's own agent is not among the options.
	render: function OwnChiefPicker(args) {
		const [target, setTarget] = useState<TeamBridgeTarget | null>(args.target);
		return (
			<TeamBridgePageView {...args} target={target} onTarget={setTarget} />
		);
	},
	args: {
		...PersonDraft.args,
		people: rosterWithChiefs,
		target: { type: "compose", recipients: [] },
	},
};

/**
 * Chiefs of staff: the directory defaults Ben's agent name to his own name.
 * `composeChiefLabel` therefore renders "Ben Tran’s chief of staff" rather than
 * "Ben Tran (Ben Tran)"; a named agent such as Aida renders "Aida (Ben Tran)".
 * The legacy DM/message rows below deliberately store the doubled label. Read
 * normalization suppresses it: no doubled label is a usable stored agent name.
 */
const echoedRoster = rosterWithChiefs.map((row) =>
	row.account_id === "acct_ben"
		? {
				...row,
				agent: { endpoint_id: "bep_ben", name: "Ben Tran", state: "active" },
			}
		: row,
);
const chiefDm: TeamBridgeConversation = {
	...dm,
	id: "bcv_dm_chief",
	agent_capable: true,
	members: [
		{
			account_id: self,
			kind: "human",
			display_label: "Damian Tran",
			role: "owner",
			state: "active",
		},
		{
			account_id: "acct_ben",
			kind: "agent",
			display_label: "Ben Tran (Ben Tran)",
			role: "member",
			state: "active",
		},
	],
};
export const ChiefLabelUnnamedAgent: Story = {
	args: {
		...slackRail,
		people: echoedRoster,
		conversations: [humansChannel, agentsChannel, chiefDm],
		target: { type: "chief", accountId: "acct_ben" },
		messages: [
			{
				id: "bcmsg_c1",
				conversation_id: chiefDm.id,
				seq: 1,
				sender: {
					account_id: "acct_ben",
					kind: "agent",
					display_label: "Ben Tran (Ben Tran)",
				},
				body: "Hi, this is Ben's chief of staff. How can I help?",
				origin: "agent",
				created_at: at(5),
			},
		],
	},
};

/** The same, with the agent's own name published: "Aida (Ben Tran)". */
export const ChiefLabelNamedAgent: Story = {
	args: {
		...ChiefLabelUnnamedAgent.args,
		people: rosterWithChiefs,
	},
};

/**
 * A first send to a teammate's chief, through the real create serializer
 * (`draftCreateInput`), read back by the real view. The payload is printed so
 * a reviewer can see the sent `display_label` is a bare name ("Aida", or the
 * owner's name when unnamed), never the composed label.
 *
 * The fixture stores what the HUB stores, not what was sent (review R1-1 on
 * #1441): agent-server rewrites a label equal to the owner's name to
 * "{person}'s chief of staff" (`agentMemberLabel`), and the read path must
 * still render that once, not "Ben Tran's chief of staff (Ben Tran)".
 * In-memory fixture: it claims nothing about the container glue or a live
 * backend.
 */
export const ChiefCreateReadRoundTrip: Story = {
	args: {
		...PersonDraft.args,
		people: echoedRoster,
		target: { type: "compose", recipients: [] },
	},
	render: function ChiefRoundTrip(args) {
		const [target, setTarget] = useState<TeamBridgeTarget | null>(args.target);
		const [created, setCreated] = useState<TeamBridgeConversation | null>(null);
		const [confirmed, setConfirmed] = useState<TeamBridgeMessage[]>([]);
		const [wire, setWire] = useState<ReturnType<typeof draftCreateInput>>(null);
		// The hub's write-path rewrite (agent-server `agentMemberLabel`, ASCII
		// apostrophe): a label equal to the owner's own name is degenerate.
		const hubStored = (accountId: string, label: string) => {
			const owner = (args.people ?? []).find(
				(row) => row.account_id === accountId,
			)?.display_label;
			return owner && label.trim() === owner
				? `${owner}'s chief of staff`
				: label;
		};
		return (
			<div className="flex h-full flex-col">
				<output
					className="shrink-0 px-3 py-1 text-meta-sm"
					aria-label="Fixture create payload"
				>
					{wire ? JSON.stringify(wire) : "Fixture only: no create yet"}
				</output>
				<TeamBridgePageView
					{...args}
					target={target}
					onTarget={setTarget}
					conversations={created ? [created] : []}
					messages={confirmed}
					messageState={created ? "ready" : "idle"}
					onSend={async (body) => {
						if (target?.type !== "compose") return;
						const input = draftCreateInput(target.recipients);
						if (!input) return;
						setWire(input);
						const conversation: TeamBridgeConversation = {
							...dm,
							id: "bcv_chief_roundtrip",
							tenant_id: "tnt_1",
							kind: input.kind,
							name: "",
							agent_capable: input.agentCapable,
							// The reader just started this thread: nothing is unread
							// (design review D3 on #1441).
							unread_count: 0,
							last_read_seq: 1,
							latest_seq: 1,
							members: [
								{
									account_id: self,
									kind: "human",
									display_label: "Damian Tran",
									role: "owner",
									state: "active",
								},
								...input.members.map((member) => ({
									account_id: member.account_id,
									kind: member.kind,
									display_label:
										member.kind === "agent"
											? hubStored(member.account_id, member.display_label ?? "")
											: (member.display_label ?? ""),
									role: "member" as const,
									state: "invited" as const,
								})),
							],
						};
						setCreated(conversation);
						setConfirmed([
							{
								id: "bcmsg_chief_roundtrip",
								conversation_id: conversation.id,
								seq: 1,
								sender: {
									account_id: self,
									kind: "human",
									display_label: "Damian Tran",
								},
								origin: "human",
								body,
								created_at: new Date().toISOString(),
							},
						]);
						setTarget({ type: "conversation", id: conversation.id });
					}}
				/>
			</div>
		);
	},
};

/** The same, with the teammate's agent name published: "Aida (Ben Tran)". */
export const ChiefNamedCreateReadRoundTrip: Story = {
	render: ChiefCreateReadRoundTrip.render,
	args: { ...ChiefCreateReadRoundTrip.args, people: rosterWithChiefs },
};

/*
 * ---------------------------------------------------------------------------
 * LAYOUT REGRESSION BOARDS (operator report 2026-10-27). Two defects reached
 * the operator because no story measured them: the empty DM centred its
 * avatar over left-aligned text, and a hovered row's ground ran past the
 * visible column. Each board's play function asserts the geometry, so the
 * Interactions panel goes red on a regression rather than a reviewer having
 * to notice a few pixels in a frame.
 * ---------------------------------------------------------------------------
 */

/** Half a CSS pixel: subpixel layout rounds, a regression is whole pixels. */
const EDGE_TOLERANCE = 0.5;

/** The empty DM: the 56px mark starts on the same left edge as the name and
 * the intro line, Slack-style, never centred in the pane. */
export const PersonDraftAvatarAlignment: Story = {
	args: PersonDraft.args,
	play: async ({ canvasElement }) => {
		const avatar = await waitFor(() => {
			const node = canvasElement.querySelector("[data-draft-avatar]");
			if (!(node instanceof HTMLElement)) throw new Error("avatar missing");
			return node;
		});
		const name = canvasElement.querySelector("[data-draft-name]");
		if (!(name instanceof HTMLElement)) throw new Error("name missing");
		const a = avatar.getBoundingClientRect();
		const n = name.getBoundingClientRect();
		await expect(Math.abs(a.left - n.left)).toBeLessThanOrEqual(EDGE_TOLERANCE);
		// The trigger hugs the mark: a stretched button is how it was centred.
		await expect(a.width).toBeLessThanOrEqual(60);
	},
};

/** The content that tried to widen a row: a long unbroken token, a long URL,
 * a code line and a wide table. Each must wrap or scroll INSIDE the row. */
const longContentThread: TeamBridgeMessage[] = [
	...benThread,
	{
		id: "bcmsg_long1",
		conversation_id: benDm.id,
		seq: 5,
		sender: {
			account_id: "acct_ben",
			kind: "human",
			display_label: "Ben Tran",
		},
		body: `${"a".repeat(240)}\n\nhttps://example.com/${"path-segment-".repeat(18)}end\n\n\`\`\`\n${"const unbroken = 'x';".repeat(14)}\n\`\`\`\n\n| ${Array.from({ length: 12 }, (_, i) => `column_heading_${i}`).join(" | ")} |\n|${" --- |".repeat(12)}\n| ${Array.from({ length: 12 }, (_, i) => `value_${i}`).join(" | ")} |`,
		origin: "human",
		created_at: at(1),
	},
];

/**
 * Every row - and the hover ground and action row it carries - lies inside
 * the timeline viewport's VISIBLE width, and the viewport has no horizontal
 * overflow. The row's box IS the hover band (`hover:bg-row-hover` paints the
 * `li`), so its rect is the band's rect; the toolbar is measured when this
 * build ships one (both holds in `shared/team-bridge-notify.ts` close it
 * today, and then there is no toolbar to measure).
 */
export const LongContentRowsStayInColumn: Story = {
	args: {
		...slackRail,
		target: { type: "person", accountId: "acct_ben" },
		messages: longContentThread,
	},
	play: async ({ canvasElement }) => {
		const rows = await waitFor(() => {
			const found = canvasElement.querySelectorAll<HTMLElement>(
				"li[data-message-id]",
			);
			if (found.length < longContentThread.length)
				throw new Error("rows missing");
			return [...found];
		});
		const viewport = rows[0].closest("[data-radix-scroll-area-viewport]");
		if (!(viewport instanceof HTMLElement)) throw new Error("no viewport");
		const v = viewport.getBoundingClientRect();
		// clientWidth excludes any scrollbar: the row must fit what is SEEN.
		const visibleRight = v.left + viewport.clientWidth;
		await expect(viewport.scrollWidth).toBeLessThanOrEqual(
			viewport.clientWidth,
		);
		for (const row of rows) {
			const r = row.getBoundingClientRect();
			await expect(r.left).toBeGreaterThanOrEqual(v.left - EDGE_TOLERANCE);
			await expect(r.right).toBeLessThanOrEqual(visibleRight + EDGE_TOLERANCE);
			const toolbar = row.querySelector("[data-message-toolbar]");
			if (toolbar) {
				const tb = toolbar.getBoundingClientRect();
				await expect(tb.right).toBeLessThanOrEqual(r.right + EDGE_TOLERANCE);
			}
		}
	},
};
