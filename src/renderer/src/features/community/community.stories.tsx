/**
 * Every state of the desktop community surface (RFC v2.4 §5.1-§5.5), frames
 * D1-D5, D7 and D20, rendered from the props-only views so no transport is
 * needed. The no-plan entry renders inside the real Team Bridge page (its
 * `noOrgPanel` slot) so a frame shows the composition the reader sees.
 *
 * Fixtures are fictional people and copy from the frames; the guidelines text
 * stands in for the server-versioned text the bootstrap read returns.
 */
import type {
	CommunityBootstrap,
	CommunityChannel,
	CommunityMessage,
} from "@shared/api/local-operator/community-api";
import { chordCaption } from "@shared/keymap/keymap-chord";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, type ReactElement, useState } from "react";
import { subscribeUrlFor } from "../team-bridge-trial/team-bridge-trial-model";
import { asTeamBridgeCommunityId } from "../team-bridge/team-bridge-model";
import { TeamBridgeOrgSwitcher } from "../team-bridge/team-bridge-org-switcher";
import {
	TeamBridgeEligibilityPanel,
	type TeamBridgePageView,
} from "../team-bridge/team-bridge-page";
import pageMeta from "../team-bridge/team-bridge-page.stories";
import { CommunityBrowseView } from "./community-browse";
import {
	CommunityComposerView,
	type CommunityDraft,
	EMPTY_DRAFT,
} from "./community-composer";
import {
	CommunityChannelHeader,
	CommunityHomeView,
	CommunityRailView,
	CommunityRequestsPane,
} from "./community-home";
import {
	CommunityJoinDialogView,
	type CommunityJoinError,
} from "./community-join-dialog";
import {
	type CommunityMessageHandlers,
	CommunityMessageListView,
	type CommunityPaneState,
	CommunityThreadPane,
} from "./community-messages";
import {
	COMMUNITY_BROWSE_CHORD,
	type ComposerPhase,
	type CommunityNoPlanView as NoPlanState,
	composerAudience,
	postingFor,
	postingState,
	threadReplies,
	timelineMessages,
} from "./community-model";
import { CommunityNoPlanView } from "./community-no-plan";

/* ================================================================ fixtures */

const COMMUNITY_ID = asTeamBridgeCommunityId("local-operator");

const channel = (
	id: string,
	name: string,
	purpose: string,
	extra: Partial<CommunityChannel> = {},
): CommunityChannel => ({
	id,
	name,
	purpose,
	visibility: "public",
	member: true,
	unread: 0,
	...extra,
});

const CHANNELS: CommunityChannel[] = [
	channel(
		"ch_welcome",
		"welcome-and-rules",
		"Start here: how the community works.",
		{
			locked: true,
			member_count: 1284,
		},
	),
	channel("ch_general", "general", "Say hi, share what you're building.", {
		unread: 3,
		member_count: 1197,
	}),
	channel("ch_help", "help", "Questions about setup, models and tools.", {
		member_count: 842,
	}),
	channel(
		"ch_feedback",
		"feedback",
		"Tell the Local Operator team what to build next.",
		{
			unread: 1,
			member_count: 615,
		},
	),
	channel(
		"ch_show",
		"show-and-tell",
		"Demos and screenshots of the things you built.",
		{
			member_count: 402,
		},
	),
	channel("ch_beta", "beta-testers", "Early builds for invited testers.", {
		visibility: "private",
		member_count: 6,
	}),
	channel("ch_mcp", "mcp-servers", "Building and sharing MCP servers.", {
		member: false,
		member_count: 254,
	}),
	channel("ch_tui", "tui-themes", "Share and tweak TUI themes.", {
		member: false,
		member_count: 96,
	}),
];

let seq = 0;
const message = (
	id: string,
	name: string,
	text: string,
	time: string,
	extra: Partial<CommunityMessage> = {},
): CommunityMessage => {
	seq += 1;
	return {
		id,
		conversation_id: "ch",
		seq,
		author: { kind: "human", display_name: name, public_id: `p_${id}` },
		created_at: `2026-11-18T${time}:00`,
		text,
		...extra,
	};
};

const MESSAGES: Record<string, CommunityMessage[]> = {
	ch_welcome: [
		message(
			"m_w1",
			"Alex Kim",
			"**Welcome to the Local Operator Community.** This is a public space run by Radient for people who use Local Operator. Ask questions in #help, tell us what to build in #feedback, and say hi in #general.\n\nEvery message, image and agent post is checked before anyone sees it. Please read the Community Guidelines. Moderators and Radient staff are marked with a badge.",
			"08:00",
			{ author: { kind: "human", display_name: "Alex Kim", role: "staff" } },
		),
		message(
			"m_w2",
			"Jordan Ellis",
			"Reminder: agents can post here only when their owner approves. Agent posts are labeled with whose behalf they're on.",
			"09:12",
			{
				author: {
					kind: "human",
					display_name: "Jordan Ellis",
					role: "moderator",
				},
			},
		),
		message(
			"m_w3",
			"Mei Takahashi",
			"Hi all — joined from the mobile app. Is there a channel for TUI themes?",
			"10:04",
		),
		message(
			"m_w4",
			"Priya Raman",
			"Yes — #tui-themes. Open Browse to see everything.",
			"10:06",
		),
	],
	ch_general: [
		message(
			"m_g1",
			"Sam Lee",
			"Shipped my first MCP server today. It reads my homelab's power usage.",
			"09:40",
			{
				reactions: [
					{ emoji: "\u{1F389}", count: 4, mine: true },
					{ emoji: "\u{1F44D}", count: 2 },
				],
			},
		),
		message(
			"m_g2",
			"Juno",
			"Logs show the tunnel restarts on wake. Try `lop tunnel doctor` and paste its summary.",
			"09:44",
			{
				author: { kind: "agent", display_name: "Juno", agent_handle: "juno" },
			},
		),
		message("m_g3", "You", "Thanks, same here on 0.42.2.", "09:50", {
			mine: true,
			edited: true,
		}),
	],
	ch_help: [
		message(
			"m_h1",
			"Luis Ortega",
			"Has anyone got the Ollama provider working with tool calls on Windows?",
			"14:04",
			{
				reply_count: 2,
			},
		),
		message(
			"m_h2",
			"Priya Raman",
			"Try updating to 0.42 — the provider list was fixed there.",
			"14:10",
		),
		message(
			"m_h3",
			"Sam Lee",
			"Same on 0.41 for me; updating fixed it.",
			"14:12",
			{ thread_root_id: "m_h1" },
		),
		message("m_h4", "Luis Ortega", "Confirmed, thanks!", "14:20", {
			thread_root_id: "m_h1",
		}),
	],
	ch_show: [],
};

const GUIDELINES = [
	"**The rules**",
	"",
	"- **Be kind and stay on topic.** Help each other. Disagree with ideas, not people.",
	"- **No spam or undisclosed promotion.** Share your own work in context and say it's yours.",
	"- **Keep private information private.** Don't post anyone's personal details, keys or tokens.",
	"",
	"**Not allowed anywhere in the community**",
	"",
	"- Sexual content or pornography",
	"- Child sexual abuse or exploitation",
	"- Illegal sales, including drugs and weapons",
	"- Threats, harassment or hate",
].join("\n");

const BOOTSTRAP: CommunityBootstrap = {
	community_id: "local-operator",
	community: {
		id: "local-operator",
		slug: "local-operator",
		name: "Local Operator Community",
		state: "active",
	},
	guidelines: { version: "2026-11", text: GUIDELINES },
	membership: null,
};

/** A 1x1 PNG, so an attached-image chip renders without a real file. */
const PIXEL = {
	content_type: "image/png" as const,
	data_base64:
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=",
};

/* ================================================================ harnesses */

const handlers = (readOnly = false): CommunityMessageHandlers => ({
	accountId: "acct_story",
	isOwn: (row) => row.mine === true,
	onReact: () => {},
	onEdit: async () => ({ kind: "idle" }),
	onDelete: () => {},
	onOpenThread: () => {},
	readOnly,
});

const switcher = (
	<TeamBridgeOrgSwitcher
		organizations={[]}
		scope="all"
		onScopeChange={() => {}}
		totalUnread={0}
		communities={[
			{
				kind: "community",
				communityId: COMMUNITY_ID,
				name: "Local Operator Community",
				unread: 4,
			},
		]}
		communitiesEnabled
		selectedCommunityId={COMMUNITY_ID}
		onCommunityChange={() => {}}
		onBrowseCommunities={() => {}}
	/>
);

/** The home, composed from the views exactly as `CommunityHome` composes them. */
const Home: FC<{
	channelId: string;
	pane?: CommunityPaneState;
	railState?: "loading" | "error" | "ready";
	offline?: boolean;
	phase?: ComposerPhase;
	draft?: CommunityDraft;
	threadId?: string;
	requests?: boolean;
	browse?: "channels" | "people";
	/** The guidelines changed since the reader accepted them (M2/D2). */
	guidelinesStale?: boolean;
	/** Open the re-accept join dialog (what "Review and accept" opens). */
	reviewOpen?: boolean;
}> = ({
	channelId,
	pane = "ready",
	railState = "ready",
	offline = false,
	phase = { kind: "idle" },
	draft: initialDraft = EMPTY_DRAFT,
	threadId,
	requests = false,
	browse,
	guidelinesStale = false,
	reviewOpen: initialReviewOpen = false,
}) => {
	const [draft, setDraft] = useState(initialDraft);
	const [reviewOpen, setReviewOpen] = useState(initialReviewOpen);
	const current = CHANNELS.find((row) => row.id === channelId) ?? null;
	const rows = MESSAGES[channelId] ?? [];
	const channelPosting = postingState(current, "active");
	const posting = postingFor(channelPosting, guidelinesStale, { kind: "idle" });
	const root = threadId ? rows.find((row) => row.id === threadId) : undefined;
	const composer = (variant: "channel" | "thread") => (
		<CommunityComposerView
			channelName={current?.name ?? ""}
			posting={postingFor(
				channelPosting,
				guidelinesStale,
				variant === "channel" ? phase : { kind: "idle" },
			)}
			onReviewGuidelines={() => setReviewOpen(true)}
			audience={composerAudience(current)}
			phase={variant === "channel" ? phase : { kind: "idle" }}
			draft={variant === "channel" ? draft : EMPTY_DRAFT}
			offline={offline}
			variant={variant}
			allowImages={variant === "channel"}
			onDraftChange={setDraft}
			onSend={() => {}}
			onCancel={() => {}}
			onRetry={() => {}}
			onDismiss={() => {}}
			onGoGeneral={() => {}}
		/>
	);
	return (
		<div className="flex h-[800px] w-full">
			<CommunityHomeView
				rail={
					<CommunityRailView
						switcher={switcher}
						channels={railState === "ready" ? CHANNELS : []}
						state={railState}
						onRetry={() => {}}
						selectedChannelId={channelId}
						requestsSelected={requests}
						requests={{ available: false }}
						onSelectChannel={() => {}}
						onSelectRequests={() => {}}
						onBrowse={() => {}}
						browseShortcut={chordCaption(COMMUNITY_BROWSE_CHORD, "linux").glyph}
						browseShortcutAria={
							chordCaption(COMMUNITY_BROWSE_CHORD, "linux").aria
						}
					/>
				}
				header={
					requests ? null : (
						<CommunityChannelHeader
							communityName="Local Operator Community"
							channel={current}
						/>
					)
				}
				main={
					requests ? (
						<CommunityRequestsPane />
					) : (
						<CommunityMessageListView
							channelName={current?.name ?? ""}
							channelPurpose={current?.purpose}
							state={pane}
							offline={offline}
							messages={timelineMessages(rows)}
							hasOlder={rows.length > 3}
							loadingOlder={false}
							onLoadOlder={() => {}}
							onRetry={() => {}}
							{...handlers(posting !== "open" || offline)}
						/>
					)
				}
				composer={requests ? undefined : composer("channel")}
				thread={
					root ? (
						<CommunityThreadPane
							root={root}
							replies={threadReplies(rows, root.id)}
							onClose={() => {}}
							composer={composer("thread")}
							{...handlers()}
						/>
					) : undefined
				}
				overlay={
					reviewOpen ? (
						<CommunityJoinDialogView
							open
							onClose={() => setReviewOpen(false)}
							bootstrap={BOOTSTRAP}
							onRetryLoad={() => {}}
							selfName="Damian Tran"
							joining={false}
							error={null}
							onJoin={() => setReviewOpen(false)}
						/>
					) : browse ? (
						<CommunityBrowseView
							open
							onClose={() => {}}
							communityName="Local Operator Community"
							channels={CHANNELS}
							state="ready"
							onRetry={() => {}}
							onOpenChannel={() => {}}
							defaultTab={browse}
						/>
					) : undefined
				}
			/>
		</div>
	);
};

const NoPlan: FC<{ view: NoPlanState }> = ({ view }) => (
	<CommunityNoPlanView
		view={view}
		selfName="Damian Tran"
		onJoin={() => {}}
		onOpen={() => {}}
		onRetry={() => {}}
		onRetryCommunity={() => {}}
		planPanel={
			<TeamBridgeEligibilityPanel
				reason="plan_required"
				trialStartEnabled={false}
			/>
		}
	/>
);

const Join: FC<{
	step?: 1 | 2;
	accepted?: boolean;
	joining?: boolean;
	error?: CommunityJoinError | null;
	bootstrap?: CommunityBootstrap | null;
}> = ({
	step = 1,
	accepted = false,
	joining = false,
	error = null,
	bootstrap = BOOTSTRAP,
}) => (
	<CommunityJoinDialogView
		open
		onClose={() => {}}
		bootstrap={bootstrap}
		onRetryLoad={() => {}}
		selfName="Damian Tran"
		joining={joining}
		error={error}
		onJoin={() => {}}
		defaultStep={step}
		defaultAccepted={accepted}
	/>
);

/* ================================================================== stories */

const meta = {
	...pageMeta,
	title: "Community/Desktop",
	parameters: { layout: "fullscreen" },
} satisfies Meta<typeof TeamBridgePageView>;
export default meta;
type Story = StoryObj<typeof meta>;

const noOrg = {
	eligibility: "plan_required" as const,
	conversations: [],
	target: null,
	messages: [],
	messageState: "idle" as const,
	people: [],
	organizations: [],
};

const offer = (
	trial: Extract<NoPlanState, { kind: "offer" }>["trial"],
	community: "joinable" | "joined" | "unavailable" = "joinable",
): NoPlanState => ({ kind: "offer", trial, community });

/* D1 */

export const NoPlanCreateOrg: Story = {
	name: "D1 · no Radient organization",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan
				view={offer({
					kind: "create_org",
					url: "https://console.radienthq.com/dashboard/organizations/new",
				})}
			/>
		),
	},
};

export const NoPlanEligible: Story = {
	name: "D1 · owner, eligible: Console checkout for the selected org",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan
				view={offer({
					kind: "start",
					url: subscribeUrlFor("tnt_robotics"),
					tenantId: "tnt_robotics",
					orgName: "Tran Robotics",
				})}
			/>
		),
	},
};

export const NoPlanAskOwner: Story = {
	name: "D1 · member, not owner or admin",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan view={offer({ kind: "ask_owner", orgName: "Tran Robotics" })} />
		),
	},
};

export const NoPlanResume: Story = {
	name: "D1 · checkout open elsewhere",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan
				view={offer({
					kind: "resume",
					url: subscribeUrlFor("tnt_robotics"),
					tenantId: "tnt_robotics",
				})}
			/>
		),
	},
};

export const NoPlanReconciling: Story = {
	name: "D1 · finishing trial setup",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={offer({ kind: "reconciling" })} />,
	},
};

export const NoPlanCheckFailed: Story = {
	name: "D1 · plan check failed",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan view={{ kind: "plan_check_failed", community: "joinable" }} />
		),
	},
};

export const NoPlanCommunityOnly: Story = {
	name: "D1 · ineligible: community join only",
	args: { ...noOrg, noOrgPanel: <NoPlan view={offer(null)} /> },
};

export const NoPlanJoined: Story = {
	name: "D1 · already joined: open the community",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan
				view={offer(
					{
						kind: "start",
						url: subscribeUrlFor("tnt_robotics"),
						tenantId: "tnt_robotics",
						orgName: "Tran Robotics",
					},
					"joined",
				)}
			/>
		),
	},
};

export const NoPlanCommunityUnavailable: Story = {
	name: "D1 · community unavailable",
	args: {
		...noOrg,
		noOrgPanel: (
			<NoPlan
				view={offer(
					{
						kind: "create_org",
						url: "https://console.radienthq.com/dashboard/organizations/new",
					},
					"unavailable",
				)}
			/>
		),
	},
};

/*
 * THE SHIPPING D1 (review round 1, m5 + M3). While `TEAM_TRIAL_START_ENABLED`
 * holds the trial, and whenever memberships already show a Team plan, the slot
 * is the shipped plan-required panel with the community card beside it. The
 * trial-card stories above render the arms that appear once the hold lifts.
 */
export const NoPlanTrialHeld: Story = {
	name: "D1 · trial held: shipped panel + community join",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={{ kind: "plan_panel", community: "joinable" }} />,
	},
};

export const NoPlanTrialHeldJoined: Story = {
	name: "D1 · trial held: shipped panel + open community",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={{ kind: "plan_panel", community: "joined" }} />,
	},
};

export const NoPlanCommunityChecking: Story = {
	name: "D1 · community card loading",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={{ kind: "plan_panel", community: "checking" }} />,
	},
};

export const NoPlanCommunityFailed: Story = {
	name: "D1 · community read failed, Retry",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={{ kind: "plan_panel", community: "failed" }} />,
	},
};

export const NoPlanChecking: Story = {
	name: "D1 · checking",
	args: {
		...noOrg,
		noOrgPanel: <NoPlan view={{ kind: "checking", community: "joinable" }} />,
	},
};

/* D2/D3 */

export const JoinGuidelines: Story = {
	name: "D2 · join step 1, guidelines",
	args: {
		...noOrg,
		noOrgPanel: (
			<>
				<NoPlan view={offer(null)} />
				<Join />
			</>
		),
	},
};

export const JoinGuidelinesLoading: Story = {
	name: "D2 · join step 1, loading",
	args: { ...noOrg, noOrgPanel: <Join bootstrap={undefined} /> },
};

export const JoinGuidelinesLoadError: Story = {
	name: "D2 · join step 1, load error",
	args: { ...noOrg, noOrgPanel: <Join bootstrap={null} /> },
};

export const JoinProfile: Story = {
	name: "D3 · join step 2, profile preview (box clear)",
	args: { ...noOrg, noOrgPanel: <Join step={2} /> },
};

export const JoinProfileAccepted: Story = {
	name: "D3 · join step 2, accepted",
	args: { ...noOrg, noOrgPanel: <Join step={2} accepted /> },
};

export const JoinJoining: Story = {
	name: "D3 · joining",
	args: { ...noOrg, noOrgPanel: <Join step={2} accepted joining /> },
};

export const JoinRateLimited: Story = {
	name: "D3 · join refused, rate limited",
	args: {
		...noOrg,
		noOrgPanel: (
			<Join step={2} accepted error={{ kind: "rate_limited", seconds: 40 }} />
		),
	},
};

export const JoinGuidelinesChanged: Story = {
	name: "D2 · guidelines changed while joining",
	args: {
		...noOrg,
		noOrgPanel: <Join error={{ kind: "guidelines_changed" }} />,
	},
};

/* D4 / D20 / D7 / D5: the home itself (not the page view) */

const homeStory = (render: () => ReactElement): Story => ({
	args: { ...noOrg },
	render,
});

export const HomeWelcomeReadOnly: Story = {
	name: "D4 · #welcome-and-rules, read-only composer",
	...homeStory(() => <Home channelId="ch_welcome" />),
};

export const HomePopulated: Story = {
	name: "D4 · #general, populated",
	...homeStory(() => <Home channelId="ch_general" />),
};

export const HomeThread: Story = {
	name: "D4 · thread open",
	...homeStory(() => <Home channelId="ch_help" threadId="m_h1" />),
};

export const HomeRequests: Story = {
	name: "D4 · Requests placeholder",
	...homeStory(() => <Home channelId="ch_general" requests />),
};

export const HomeLoading: Story = {
	name: "D20 · loading",
	...homeStory(() => <Home channelId="ch_help" pane="loading" />),
};

export const HomeEmpty: Story = {
	name: "D20 · empty channel",
	...homeStory(() => <Home channelId="ch_show" />),
};

export const HomeOffline: Story = {
	name: "D20 · offline",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			offline
			draft={{
				text: "Same problem here on Windows 11 — did 0.42 fix it for you?",
				images: [],
			}}
		/>
	)),
};

export const HomeError: Story = {
	name: "D20 · channel error",
	...homeStory(() => <Home channelId="ch_help" pane="error" />),
};

export const HomeRailLoading: Story = {
	name: "D20 · rail loading",
	...homeStory(() => (
		<Home channelId="ch_help" railState="loading" pane="loading" />
	)),
};

const CHECKING: ComposerPhase = {
	kind: "checking",
	key: "k".repeat(20),
	cancelling: false,
};
const DRAFT = {
	text: "Has anyone got the Ollama provider working with tool calls on Windows?",
	images: [],
};
const PROMO = {
	text: "Check out my new MCP server bundle — 50% off this week only, DM me for a promo code!",
	images: [],
};

export const ComposerChecking: Story = {
	name: "D7 · checking with Cancel",
	...homeStory(() => (
		<Home channelId="ch_help" phase={CHECKING} draft={DRAFT} />
	)),
};

export const ComposerCancelling: Story = {
	name: "D7 · cancelling",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			phase={{ ...CHECKING, cancelling: true }}
			draft={DRAFT}
		/>
	)),
};

export const ComposerRefused: Story = {
	name: "D7 · refused, category and reference",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			phase={{
				kind: "refused",
				category: "spam_or_promotion",
				reference: "MOD-7Q2M-91XD",
			}}
			draft={PROMO}
		/>
	)),
};

export const ComposerPostingLimit: Story = {
	name: "D7 · posting limit with countdown",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			phase={{
				kind: "rate_limited",
				until: Date.now() + 40_000,
				scope: "account_burst",
			}}
			draft={DRAFT}
		/>
	)),
};

export const ComposerModerationUnavailable: Story = {
	name: "D7 · moderation unavailable with Retry",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			phase={{ kind: "moderation_unavailable" }}
			draft={DRAFT}
		/>
	)),
};

export const ComposerImagesUnavailable: Story = {
	name: "D7 · images unavailable",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			phase={{ kind: "images_unavailable" }}
			draft={{ ...DRAFT, images: [PIXEL] }}
		/>
	)),
};

export const ComposerGuidelinesChanged: Story = {
	name: "D7 · guidelines changed, Review and accept",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			guidelinesStale
			phase={{ kind: "guidelines_changed", version: "2026-12" }}
			draft={DRAFT}
		/>
	)),
};

export const ComposerGuidelinesReadOnly: Story = {
	name: "D7 · guidelines changed, other channel read-only",
	...homeStory(() => <Home channelId="ch_general" guidelinesStale />),
};

export const ComposerGuidelinesReview: Story = {
	name: "D7 · Review and accept opens join step 1",
	...homeStory(() => (
		<Home
			channelId="ch_help"
			guidelinesStale
			phase={{ kind: "guidelines_changed", version: "2026-12" }}
			draft={DRAFT}
			reviewOpen
		/>
	)),
};

export const ComposerError: Story = {
	name: "D7 · error, draft kept",
	...homeStory(() => (
		<Home channelId="ch_help" phase={{ kind: "error" }} draft={DRAFT} />
	)),
};

export const BrowseChannels: Story = {
	name: "D5 · Browse, channels",
	...homeStory(() => <Home channelId="ch_welcome" browse="channels" />),
};

export const BrowsePeople: Story = {
	name: "D5 · Browse, people (coming soon)",
	...homeStory(() => <Home channelId="ch_welcome" browse="people" />),
};
