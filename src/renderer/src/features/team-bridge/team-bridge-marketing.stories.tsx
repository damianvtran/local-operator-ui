/**
 * Reproducible marketing scenes for both sites. The earlier site PR #11 shipped
 * 2880x1800 renders but not the Northwind story that produced them. This file
 * restores that fictional cast using the CURRENT TeamBridgePageView rather than
 * recreating its old pixels (in particular, no persistent mention highlight).
 *
 * Only the page's presentation seams are supplied: directory, conversations,
 * messages and thread render. No tenant/account read reaches a live hub. A
 * capture claims the viewport actually supplied by its browser, not a nominal
 * dpr inherited from the historical assets.
 */
import "../chat/components/story-electron-shim";
import type { Meta, StoryObj } from "@storybook/react";
import { expect, userEvent, waitFor, within } from "@storybook/test";
import { useEffect, useLayoutEffect } from "react";
import type {
	TeamBridgeConversation,
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { ChatLayout } from "../../shared/components/common/chat-layout";
import { blurProgrammaticFocus } from "../../shared/components/navigation/docs-capture-hold";
import { marketingGlass } from "../../shared/components/navigation/docs-glass-backdrop";
import { useConversationInputStore } from "../../shared/store/conversation-input-store";
import { teamBridgeComposerKey } from "../../shared/store/team-bridge-composer-rows";
import { useUiPreferencesStore } from "../../shared/store/ui-preferences-store";
import { draftTargetKey } from "./team-bridge-drafts";
import { asTeamBridgeTenantId } from "./team-bridge-model";
import {
	TeamBridgePageView,
	type TeamBridgePageViewProps,
} from "./team-bridge-page";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";

const TENANT = asTeamBridgeTenantId("tnt_northwind_marketing");
const SELF = "acct_maya";
// Times are relative to one local scene day, so groups remain Today rather than
// changing to an old date. The capture path pins its browser's zone explicitly.
const today = (hour: number, minute: number) => {
	const date = new Date();
	date.setHours(hour, minute, 0, 0);
	return date.toISOString();
};
const person = (
	account_id: string,
	display_label: string,
	agentName: string,
	title: string,
): TeamBridgeDirectoryMember => ({
	account_id,
	display_label,
	role: account_id === SELF ? "owner" : "member",
	bridge_enabled: true,
	bridge_state: "active",
	agent: { endpoint_id: `bep_${account_id}`, name: agentName, state: "active" },
	profile: {
		display_name: display_label,
		title,
		description: "",
		pronouns: "",
		timezone: "America/New_York",
	},
});
const PEOPLE = [
	person(SELF, "Maya Chen", "Atlas", "CTO"),
	person("acct_jordan", "Jordan Alvarez", "Juniper", "Product lead"),
	person("acct_priya", "Priya Natarajan", "Quill", "QA Lead"),
	person("acct_sam", "Sam Okafor", "Nova", "Release engineer"),
];
const human = (index: number): TeamBridgeMessage["sender"] => ({
	account_id: PEOPLE[index].account_id,
	kind: "human",
	display_label: PEOPLE[index].display_label,
});
const agent = (index: number): TeamBridgeMessage["sender"] => ({
	account_id: `agent_${PEOPLE[index].account_id}`,
	kind: "agent",
	display_label: `${PEOPLE[index].agent?.name} (${PEOPLE[index].display_label})`,
});
const conversation = (
	id: string,
	name: string,
	over: Partial<TeamBridgeConversation> = {},
): TeamBridgeConversation => ({
	id,
	tenant_id: TENANT,
	name,
	kind: "channel",
	topic: "",
	visibility: "tenant",
	agent_capable: true,
	status: "open",
	created_by: SELF,
	last_message_at: today(15, 14),
	latest_seq: 8,
	last_read_seq: 8,
	unread_count: 0,
	muted: false,
	members: PEOPLE.map((p) => ({
		account_id: p.account_id,
		kind: "human",
		display_label: p.display_label,
		role: "member",
		state: "active",
	})),
	...over,
});
const QA = conversation("bcv_qa", "qa-coordination", {
	topic: "Release QA: people and their agents, one queue",
});
const LAUNCH = conversation("bcv_launch", "product-launch", {
	topic: "Spring launch: checklist, copy and go/no-go",
	latest_seq: 11,
	last_read_seq: 7,
	unread_count: 4,
});
const APPROVAL = conversation("bcv_signoff", "Launch date sign-off", {
	kind: "group",
	visibility: "private",
	latest_seq: 8,
	last_read_seq: 7,
	unread_count: 1,
	members: [
		{
			account_id: SELF,
			kind: "human",
			display_label: "Maya Chen",
			role: "owner",
			state: "active",
		},
		{
			// Sender ids (`agent()` above), so a member-keyed lookup resolves them.
			account_id: `agent_${SELF}`,
			kind: "agent",
			display_label: "Atlas (Maya Chen)",
			role: "member",
			state: "active",
		},
		{
			account_id: "agent_acct_jordan",
			kind: "agent",
			display_label: "Juniper (Jordan Alvarez)",
			role: "member",
			state: "active",
		},
	],
});
const CONVERSATIONS = [
	conversation("bcv_general", "general", { unread_count: 2 }),
	QA,
	LAUNCH,
	conversation("bcv_readiness", "Launch readiness", {
		kind: "group",
		visibility: "private",
	}),
	APPROVAL,
];
const message = (
	scene: string,
	seq: number,
	sender: TeamBridgeMessage["sender"],
	body: string,
	hour: number,
	minute: number,
	over: Partial<TeamBridgeMessage> = {},
): TeamBridgeMessage => ({
	id: `bcmsg_${scene}_${seq}`,
	conversation_id: scene,
	seq,
	sender,
	body,
	origin: sender.kind,
	created_at: today(hour, minute),
	...over,
});
const reaction = (emoji: string, count: number) => ({
	emoji,
	count,
	reacted_by_me: false,
	sample_labels: [],
});
const QA_STATUS = message(
	QA.id,
	4,
	agent(2),
	"**Release 4.2 QA status**\n\n- Checkout flow: **38/38 passing**\n- Billing webhooks replayed against staging\n- One flaky test in `export-csv`, rerun queued\n\nGo for the release window at 16:00 unless someone objects.",
	15,
	1,
	{
		reactions: [reaction("🚀", 3), reaction("👀", 1)],
		reply_count: 3,
		reply_participants: ["Nova", "Sam", "Priya"],
		last_reply_at: today(15, 12),
	},
);
const QA_MESSAGES = [
	message(
		QA.id,
		1,
		agent(2),
		"Regression plan for 4.2 is ready: 38 checkout cases, billing webhook replay, and the CSV export suite.",
		13,
		55,
		{ reactions: [reaction("🙌", 2)] },
	),
	message(
		QA.id,
		2,
		human(0),
		"@Quill (Priya Natarajan) can you run the release 4.2 regression pass before the 16:00 window? @Nova (Sam Okafor) please confirm the staging deploy is pinned.",
		14,
		49,
	),
	message(
		QA.id,
		3,
		agent(3),
		"Staging is pinned to `release-4.2` (build 1187). Smoke checks are green.",
		14,
		54,
		{ reactions: [reaction("👍", 2)] },
	),
	QA_STATUS,
	message(
		QA.id,
		5,
		human(2),
		"Thanks Quill, I'll eyeball the CSV export myself after lunch.",
		15,
		6,
	),
	message(
		QA.id,
		6,
		human(0),
		"Great work, everyone. @Atlas (Maya Chen) add the 16:00 go/no-go to my calendar.",
		15,
		13,
	),
	message(
		QA.id,
		7,
		agent(0),
		"Done. The go/no-go is on your calendar at 15:45 with the QA summary attached.",
		15,
		14,
	),
];
const REPLIES = [
	message(
		QA.id,
		8,
		agent(3),
		"Rerun of `export-csv` passed 3/3 on build 1187. Marking it as a known flake and filing the fix for 4.3.",
		15,
		7,
		{ thread_root_id: QA_STATUS.id },
	),
	message(
		QA.id,
		9,
		human(3),
		"Nice. I'll keep the flake ticket on my board.",
		15,
		9,
		{ thread_root_id: QA_STATUS.id },
	),
	message(
		QA.id,
		10,
		human(2),
		"Manual pass on the export done too. We're clear for 16:00.",
		15,
		12,
		{ thread_root_id: QA_STATUS.id },
	),
];
const APPROVAL_MESSAGES = [
	message(
		APPROVAL.id,
		1,
		agent(1),
		"Opening this group for the spring launch date decision. Jordan asked me to keep Maya and Atlas in the loop here.",
		14,
		5,
	),
	message(
		APPROVAL.id,
		2,
		agent(0),
		"Thanks, Juniper. Maya prefers decisions with the impact listed up front. I'll flag her when one needs her.",
		14,
		11,
	),
	message(
		APPROVAL.id,
		3,
		agent(1),
		"Noted. Jordan's calendar is clear for a launch review on Wednesday if one is needed.",
		14,
		14,
	),
	message(
		APPROVAL.id,
		4,
		human(0),
		"Works for me. Keep it short and tell me what changes for customers.",
		14,
		17,
	),
	message(
		APPROVAL.id,
		5,
		agent(1),
		"@Atlas (Maya Chen) I'm Jordan's chief of staff. **Approval request** for the spring launch:\n\n- Move the public launch from Tue to **Thu 10:00 PT**\n- Reason: pricing page copy is still in legal review\n- Impact: press embargo shifts 48h; no customer commitments affected\n\nJordan has signed off. Needs Maya's approval as CTO.",
		15,
		9,
	),
	message(
		APPROVAL.id,
		6,
		agent(0),
		"@Maya Chen this needs your decision. I checked: the date has no conflict with the infra freeze, and the status page and on-call rota can move with it. **Approve the move to Thu 10:00 PT?**",
		15,
		10,
	),
	message(
		APPROVAL.id,
		7,
		human(0),
		"Approved. Make sure the status page and the checklist in #product-launch reflect the new date.",
		15,
		12,
		{ reactions: [reaction("✅", 2)] },
	),
	message(
		APPROVAL.id,
		8,
		agent(1),
		"Recorded. Checklist updated and the new date is posted in #product-launch. Atlas, over to you for Maya's calendar.",
		15,
		13,
	),
];
const LAUNCH_MESSAGES = [
	message(
		LAUNCH.id,
		1,
		human(0),
		"Spring launch is a go for next week. Thanks for pulling this together, everyone.",
		11,
		55,
	),
	message(
		LAUNCH.id,
		2,
		agent(3),
		"Launch pages are deployed to staging behind the preview flag.",
		12,
		25,
	),
	message(
		LAUNCH.id,
		3,
		human(3),
		"Rollback plan is written up and linked from the checklist.",
		12,
		45,
	),
	message(
		LAUNCH.id,
		4,
		human(1),
		"Kicking off launch week. Owners are in the checklist; ping your row's agent for status.",
		13,
		15,
	),
	message(
		LAUNCH.id,
		5,
		agent(1),
		"Press kit is final and the embargo is set for launch day, 09:00 PT.",
		13,
		40,
	),
	message(
		LAUNCH.id,
		6,
		human(2),
		"QA sign-off for the launch pages is tracked in #qa-coordination.",
		14,
		5,
	),
	message(
		LAUNCH.id,
		7,
		human(0),
		"Launch checklist is pinned. Owners, please tick your rows by Wednesday.",
		14,
		35,
	),
	message(
		LAUNCH.id,
		8,
		agent(1),
		"Pricing page copy is with legal; I'll post as soon as it clears.",
		14,
		53,
	),
	message(
		LAUNCH.id,
		9,
		human(3),
		"CDN cache rules for the new pages are live on staging.",
		15,
		3,
	),
	message(
		LAUNCH.id,
		10,
		agent(3),
		"Load test at 5x expected launch traffic: p95 182 ms, no errors.",
		15,
		9,
	),
	message(
		LAUNCH.id,
		11,
		agent(1),
		"Launch moved to **Thu 10:00 PT**, approved by Maya. Checklist updated.",
		15,
		13,
	),
];

const BASE: TeamBridgePageViewProps = {
	selfAccountId: SELF,
	selfName: "Maya Chen",
	people: PEOPLE,
	peopleState: "ready",
	conversations: CONVERSATIONS,
	organizations: [
		{ tenantId: TENANT, name: "Northwind", role: "owner", unread: 7 },
	],
	scope: TENANT,
	totalUnread: 7,
	listState: "ready",
	messageState: "ready",
	target: { type: "conversation", id: QA.id },
	messages: QA_MESSAGES,
	threadsCapabilityState: "enabled",
	attachmentCapability: {
		enabled: true,
		max_count: 10,
		max_bytes: 10 * 1024 * 1024,
		mime_types: ["image/png", "image/jpeg", "image/webp"],
	},
	onTarget: () => {},
	onSend: () => {},
	onNewChannel: () => {},
	onRetry: () => {},
	onScopeChange: () => {},
	onJoin: () => {},
	onNotifyChange: () => {},
	onRetryPeople: () => {},
};

function MarketingShell({ children }: { children: React.ReactNode }) {
	useLayoutEffect(() => {
		/* THE COMPOSER DRAFT IS DURABLE, per account, scope and conversation, and
		   Mention's play types "@" into qa-coordination's. Without this a later
		   Channel or Thread load in the same browser showed that "@" (QA round 4
		   Q11). Every scene starts empty; Mention types after this runs. */
		useConversationInputStore
			.getState()
			.setComposerText(
				teamBridgeComposerKey(
					SELF,
					TENANT,
					draftTargetKey({ type: "conversation", id: QA.id }),
				),
				"",
			);
	}, []);
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.dataset.chromeMode = "integrated";
		root.dataset.chromePlatform = "mac";
		root.dataset.chromeLeading = "traffic-lights";
		root.dataset.chromeTrailing = "none";
		const before = useUiPreferencesStore.getState();
		useUiPreferencesStore.getState().setSidebarCollapsed(false);
		return () => {
			useUiPreferencesStore
				.getState()
				.setSidebarCollapsed(before.isSidebarCollapsed);
			for (const key of [
				"chromeMode",
				"chromePlatform",
				"chromeLeading",
				"chromeTrailing",
			])
				delete root.dataset[key];
		};
	}, []);
	return (
		<div
			className="relative flex flex-col overflow-hidden"
			/* Browser-host captures expose 1280x720 CSS px. A presentation-only
			   80% zoom gives the real page 1600x900 layout pixels, enough for its
			   shipped 1024px conversation split breakpoint AND the complete rail.
			   The PNG remains the browser's actual 2560x1440; no dpr/size claim
			   is inferred from the historical 1440x900@2 assets. */
			style={{ zoom: 0.8, width: "125vw", height: "125vh" }}
		>
			<ChatLayout
				sidebar={<nav aria-label="App navigation" />}
				routeSidebar={{}}
				content={
					/* `canvas-backing` as `app.tsx` marks its `<main>`: under glass it
					   paints canvas at the shipped alpha (the page's own grounds go
					   clear); with glass off no rule matches and `bg-canvas` holds. */
					<main
						data-glass-region="canvas-backing"
						className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden bg-canvas"
					>
						{children}
					</main>
				}
			/>
		</div>
	);
}

function MentionHold() {
	useEffect(() => {
		const root = document.documentElement;
		root.dataset.capturePending = "1";
		return () => {
			delete root.dataset.capturePending;
			delete root.dataset.captureFailed;
		};
	}, []);
	return null;
}
/* The shipped focus-on-open (`manageThreadFocus` puts focus on the pane's close
   button) is right for keyboard users but shows as a ring in the top-right of
   a still with nobody at the keyboard (design round 4 D9, QA Q13). Story-only:
   blurred here, before any capture reads the frame. */
function NoProgrammaticFocus() {
	useEffect(() => blurProgrammaticFocus(document), []);
	return null;
}
const meta: Meta = {
	title: "Docs/Team Bridge",
	/* Every scene shows the shipped glass over a stand-in desktop (D8). */
	...marketingGlass,
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

export const Channel: Story = {
	render: () => (
		<MarketingShell>
			<TeamBridgePageView {...BASE} />
		</MarketingShell>
	),
};
export const Thread: Story = {
	render: () => (
		<MarketingShell>
			<NoProgrammaticFocus />
			<TeamBridgePageView
				{...BASE}
				threadLink={{
					tenantId: TENANT,
					conversationId: QA.id,
					rootId: QA_STATUS.id,
				}}
				renderThreadPane={(_target, close) => (
					<TeamBridgeThreadPaneView
						root={QA_STATUS}
						replies={REPLIES}
						state="ready"
						labelFor={(sender) => sender.display_label}
						onClose={close}
						onRetry={() => {}}
						onSend={async () => {}}
					/>
				)}
			/>
		</MarketingShell>
	),
};
export const Approval: Story = {
	render: () => (
		<MarketingShell>
			<TeamBridgePageView
				{...BASE}
				target={{ type: "conversation", id: APPROVAL.id }}
				messages={APPROVAL_MESSAGES}
			/>
		</MarketingShell>
	),
};
export const Launch: Story = {
	render: () => (
		<MarketingShell>
			<TeamBridgePageView
				{...BASE}
				target={{ type: "conversation", id: LAUNCH.id }}
				messages={LAUNCH_MESSAGES}
			/>
		</MarketingShell>
	),
};
export const Mention: Story = {
	render: () => (
		<MarketingShell>
			<MentionHold />
			<TeamBridgePageView {...BASE} />
		</MarketingShell>
	),
	play: async ({ canvasElement }) => {
		try {
			const canvas = within(canvasElement);
			// The composer is a `combobox` (it owns the mention listbox), not a
			// `textbox`: the old role query never resolved, so nothing was typed
			// and the shutter hold was never released. A bare "@" opens the
			// unfiltered picker, whose heading the wait below pins.
			const input = await canvas.findByRole("combobox", {
				name: `Message ${QA.name}`,
			});
			await userEvent.click(input);
			// The draft is persisted per conversation: a second load would type
			// "@@" onto the first load's "@", which opens no picker.
			await userEvent.clear(input);
			await userEvent.type(input, "@", { delay: 30 });
			// The picker is portalled out of the story root, so the canvas scope
			// cannot see it: wait on the document for the picker's own section.
			const page = within(canvasElement.ownerDocument.body);
			await waitFor(() =>
				expect(
					page.getByRole("group", { name: "People in this conversation" }),
				).toBeVisible(),
			);
			delete document.documentElement.dataset.capturePending;
		} catch (error) {
			document.documentElement.dataset.captureFailed = `mention-picker-not-open: ${String(error)}`;
			delete document.documentElement.dataset.capturePending;
			throw error;
		}
	},
};
