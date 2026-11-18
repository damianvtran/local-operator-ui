import type { Meta, StoryObj } from "@storybook/react";
import type { FC } from "react";
import type {
	TeamBridgeDirectoryMember,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeMessageList } from "./team-bridge-message-list";
import { TeamBridgeThreadPaneView } from "./team-bridge-thread-pane";

/*
 * INTEGRATION (APP) MESSAGES in a Team Bridge channel (Team Integrations RFC,
 * agent-server #401/#408). An admin-installed app - Grafana, Datadog,
 * Alertmanager, incident.io - posts an alert into a channel such as
 * #alerts-prod; members and their agents triage it in the alert's thread, and
 * the app may post follow-ups (resolved, escalated) into that same thread.
 *
 * What the frames must show: the app is named by its app name with a small
 * "App" badge on a neutral app plate - never a person's initial, photo, or
 * profile card - while people and agents beside it keep theirs. A row whose
 * origin this build does not know renders as a generic sender.
 *
 * WHAT IS MOCKED: the hub answers. The wire shapes are transcribed from
 * agent-server `internal/services/integration_post.go` (`origin:
 * "integration"`, `sender.kind: "integration"`, `account_id` = app id,
 * `display_label` = app name). Switch the toolbar theme for light/dark.
 */

const NOW = new Date(2026, 10, 17, 15, 0);
const at = (minute: number) =>
	new Date(
		NOW.getFullYear(),
		NOW.getMonth(),
		NOW.getDate(),
		14,
		minute,
	).toISOString();

/* An app id and a person id collide on purpose in `directory`: the app row
   must still never wear that person's identity. */
const GRAFANA = "iap_5f0c2b9e4d7a41c3a1e2b3c4d5e6f708";
const directory: Record<string, TeamBridgeDirectoryMember> = {
	acct_ada: {
		account_id: "acct_ada",
		display_label: "Ada Okafor",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
	},
	acct_ben: {
		account_id: "acct_ben",
		display_label: "Ben Tran",
		role: "member",
		bridge_enabled: true,
		bridge_state: "active",
		agent: { name: "Aida" },
	} as TeamBridgeDirectoryMember,
};
const profileFor = (sender: TeamBridgeMessage["sender"]) =>
	directory[sender.account_id];

const grafanaSender = {
	account_id: GRAFANA,
	kind: "integration" as const,
	display_label: "Grafana",
};

const alertRoot: TeamBridgeMessage = {
	id: "bcmsg_alert_root",
	conversation_id: "bcv_alerts_prod",
	seq: 1,
	sender: grafanaSender,
	body: "**[FIRING:1] HighErrorRate** `api-prod`\n\n5xx rate 7.2% over 5m (threshold 2%). Runbook: https://runbooks.example.com/high-error-rate",
	origin: "integration",
	created_at: at(2),
};
const agentReply: TeamBridgeMessage = {
	id: "bcmsg_alert_r1",
	conversation_id: "bcv_alerts_prod",
	seq: 2,
	sender: { account_id: "acct_ben", kind: "agent", display_label: "Aida" },
	body: "Taking this. The spike lines up with the 14:00 deploy of agent-server; checking the rollout now.",
	origin: "agent",
	created_at: at(4),
	thread_root_id: alertRoot.id,
};
const humanReply: TeamBridgeMessage = {
	id: "bcmsg_alert_r2",
	conversation_id: "bcv_alerts_prod",
	seq: 3,
	sender: { account_id: "acct_ada", kind: "human", display_label: "Ada" },
	body: "Rolled back to the previous tag. Watching it.",
	origin: "human",
	created_at: at(9),
	thread_root_id: alertRoot.id,
};
const appReply: TeamBridgeMessage = {
	id: "bcmsg_alert_r3",
	conversation_id: "bcv_alerts_prod",
	seq: 4,
	sender: grafanaSender,
	body: "**[RESOLVED] HighErrorRate** `api-prod` - 5xx rate 0.3%.",
	origin: "integration",
	created_at: at(14),
	thread_root_id: alertRoot.id,
};

const ListFrame: FC<{ messages: TeamBridgeMessage[] }> = ({ messages }) => (
	/* `bg-canvas`: the channel timeline's real ground (#1668). */
	<div className="flex w-[760px] flex-col bg-canvas text-ink">
		<TeamBridgeMessageList
			messages={messages}
			labelFor={(sender) => sender.display_label}
			profileFor={profileFor}
			onReply={() => {}}
			onMessagePerson={() => {}}
			tenantId="tnt_story"
		/>
	</div>
);

const meta = {
	title: "Team Bridge/Integration messages",
	component: ListFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ListFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/* One alert root from an app, with its thread rollup (an agent, a person and
   the app itself replied). */
export const IntegrationRoot: Story = {
	args: {
		messages: [
			{
				...alertRoot,
				reply_count: 3,
				last_reply_at: appReply.created_at,
				reply_participants: ["Aida", "Ada", "Grafana"],
				reply_participant_ids: [
					{ account_id: "acct_ben", kind: "agent" },
					{ account_id: "acct_ada", kind: "human" },
					{ account_id: GRAFANA, kind: "integration" },
				],
			},
		],
	},
};

/* The alert's thread: agent triage, a human fix, then the app's own
   "resolved" follow-up in the same thread. */
export const IntegrationThreadReply: Story = {
	args: { messages: [] },
	render: () => (
		<div className="flex h-[720px] w-[26rem] bg-surface text-ink">
			<TeamBridgeThreadPaneView
				root={{ ...alertRoot, reply_count: 3 }}
				replies={[agentReply, humanReply, appReply]}
				state="ready"
				labelFor={(sender) => sender.display_label}
				profileFor={profileFor}
				onClose={() => {}}
				onRetry={() => {}}
				onSend={async () => {}}
			/>
		</div>
	),
};

/* A channel timeline mixing a person, an agent and two app posts (a second
   app post right after the first collapses into one run, like any sender). */
export const MixedConversation: Story = {
	args: {
		messages: [
			{
				id: "bcmsg_mix_1",
				conversation_id: "bcv_alerts_prod",
				seq: 1,
				sender: {
					account_id: "acct_ada",
					kind: "human",
					display_label: "Ada",
				},
				body: "Heads up: deploying agent-server to prod at 14:00.",
				origin: "human",
				created_at: at(0),
			},
			{ ...alertRoot, id: "bcmsg_mix_2", seq: 2 },
			{
				...alertRoot,
				id: "bcmsg_mix_3",
				seq: 3,
				body: "**[FIRING:1] LatencyP99High** `api-prod` - p99 2.4s (threshold 1s).",
				created_at: at(3),
			},
			{
				id: "bcmsg_mix_4",
				conversation_id: "bcv_alerts_prod",
				seq: 4,
				sender: {
					account_id: "acct_ben",
					kind: "agent",
					display_label: "Aida",
				},
				body: "I have both alerts. Correlating with the deploy; updates in the threads.",
				origin: "agent",
				created_at: at(5),
			},
		],
	},
};

/* A future origin this build does not know: the schema degrades it to
   `unknown`, and the row claims no identity (neutral glyph, no badge). */
export const UnknownOrigin: Story = {
	args: {
		messages: [
			{
				id: "bcmsg_unknown",
				conversation_id: "bcv_alerts_prod",
				seq: 1,
				sender: {
					account_id: "acct_future",
					kind: "unknown",
					display_label: "Workflow runner",
				},
				body: "Nightly export finished.",
				origin: "unknown",
				created_at: at(1),
			},
		],
	},
};
