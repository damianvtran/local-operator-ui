import { FLEET_ASKS_QUERY_KEY } from "@features/chat/fleet-asks";
import { t } from "@shared/i18n";
import type { Meta, StoryObj } from "@storybook/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { type FC, useLayoutEffect, useRef, useState } from "react";
import type {
	TeamBridgeAlertMeta,
	TeamBridgeMessage,
} from "../../../../shared/team-bridge-contract";
import { TeamBridgeAlertActionsContext } from "./team-bridge-alert-card";
import { TeamBridgeConversationMenu } from "./team-bridge-conversation-menu";
import {
	menuConversation,
	menuSectionsFor,
} from "./team-bridge-conversation-menu.fixtures";
import {
	TeamBridgeMessageList,
	TeamBridgeMessageSkeleton,
} from "./team-bridge-message-list";
import { TeamBridgeResponderDialog } from "./team-bridge-responder-dialog";

/*
 * TEAM INTEGRATIONS ALERT CARDS (RFC §10 items 3-4; D1/D2/D5; U1; copy C2
 * deferred from agent-server #463). An app (Datadog, Grafana) posts an alert
 * root into #alerts-prod; the card reads the server-owned `alert_meta`.
 *
 * WHAT IS MOCKED: the hub's message page and this device's fleet-ask index.
 * `alert_meta` is transcribed from agent-server `models.BridgeAlertMeta`
 * (origin/main 2026-11-21). `claim_summary` follows the RFC §6.1 shape: the
 * hub does NOT serve it yet, which is exactly the `SingleFiring` state (no
 * claim block -> "Responder not known yet"). Switch the toolbar theme for
 * light/dark.
 */

const at = (minute: number) =>
	new Date(Date.UTC(2026, 10, 21, 19, minute)).toISOString();
const DATADOG = "iap_5f0c2b9e4d7a41c3a1e2b3c4d5e6f708";

const baseMeta: TeamBridgeAlertMeta = {
	incident_key: "7a3c9f12b84e5d06a1c4e1",
	app_id: DATADOG,
	app_name: "Datadog",
	source: "datadog",
	severity: "sev1",
	status: "firing",
	fire_count: 3,
	first_fired_at: at(2),
	last_fired_at: at(12),
	/* The hub clamps this to >= 1 on every root: 1 is a single alert (R1). */
	grouped_count: 1,
	labels: [
		{ key: "service", value: "scraper-api" },
		{ key: "env", value: "prod" },
		{ key: "region", value: "ca-central-1" },
		{ key: "team", value: "data" },
	],
	links: [
		{
			host: "app.datadoghq.com",
			url: "https://app.datadoghq.com/monitors/81234",
		},
		{
			label: "Runbook",
			host: "github.com",
			url: "https://github.com/radient-ml/radient-infra/blob/main/docs/runbook.md",
		},
	],
};
const alert = (
	meta: Partial<TeamBridgeAlertMeta>,
	extra: Partial<TeamBridgeMessage> = {},
): TeamBridgeMessage => ({
	id: "bcmsg_alert_root",
	conversation_id: "bcv_alerts_prod",
	seq: 1,
	sender: {
		account_id: DATADOG,
		kind: "integration",
		display_label: "Datadog",
	},
	body: "**scraper-api p99 latency above 2s**\n\nError rate on /v1/ingest rose from 0.2% to 4.1% after the 18:55 deploy.",
	origin: "integration",
	created_at: at(2),
	reply_count: 4,
	last_reply_at: at(9),
	reply_participants: ["Aida", "Ada"],
	alert_meta: { ...baseMeta, ...meta },
	...extra,
});
const claimed = {
	state: "claimed",
	holder_kind: "agent",
	holder_name: "Aida",
	owner_name: "Ada Okafor",
	autonomy_tier: "T0",
	latest_status_line: "Likely cause: connection pool exhaustion",
	updated_at: at(11),
};

/* This device's fleet index holds the responder's pending ask: the owner's
   view, so the "Review in Local Operator" CTA draws. */
const ownerClient = () => {
	const client = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	client.setQueryData(FLEET_ASKS_QUERY_KEY, [
		{ ask_id: "ask_aida_1", session_id: "sess_alert_1", status: "open" },
	]);
	return client;
};

const ListFrame: FC<{
	messages: TeamBridgeMessage[];
	owner?: boolean;
	width?: number;
	/** False: a reader whose own agent is not in the channel (no entry). */
	responders?: boolean;
}> = ({ messages, owner = false, width = 760, responders = true }) => {
	const [client] = useState(() => (owner ? ownerClient() : new QueryClient()));
	return (
		<QueryClientProvider client={client}>
			<TeamBridgeAlertActionsContext.Provider
				value={{
					onResponders: responders ? () => {} : undefined,
					onReviewAsk: () => {},
				}}
			>
				{/* `bg-canvas`: the channel timeline's real ground. */}
				<div
					className="flex flex-col bg-canvas py-3 text-ink"
					style={{ width }}
				>
					<TeamBridgeMessageList
						messages={messages}
						labelFor={(sender) => sender.display_label}
						onReply={() => {}}
						tenantId="tnt_story"
						arrivalsEnabled={false}
					/>
				</div>
			</TeamBridgeAlertActionsContext.Provider>
		</QueryClientProvider>
	);
};

const meta = {
	title: "Team Bridge/Alert cards",
	component: ListFrame,
	parameters: { layout: "centered" },
} satisfies Meta<typeof ListFrame>;
export default meta;
type Story = StoryObj<typeof meta>;

/* Today's hub: a firing sev1 with no claim block. */
export const SingleFiring: Story = { args: { messages: [alert({})] } };

export const Claimed: Story = {
	args: { messages: [alert({ claim_summary: claimed })] },
};

/* Synthetic future claim metadata, NOT proof of a live alert-to-ask
   correlation. The production container deliberately draws no Review CTA until
   a supported local correlation exists; an unrelated fleet ask is not one. */
export const WaitingForOwnerApproval: Story = {
	args: {
		owner: true,
		messages: [
			alert({
				claim_summary: {
					...claimed,
					autonomy_tier: "T1",
					latest_status_line: "Revert PR opened, waiting for approval",
					waiting_approval_for: {
						ask_id: "ask_aida_1",
						session_id: "sess_alert_1",
					},
				},
			}),
		],
	},
};

export const Escalated: Story = {
	args: {
		messages: [alert({ claim_summary: { ...claimed, escalated: true } })],
	},
};

export const Resolved: Story = {
	args: {
		messages: [
			alert({
				status: "resolved",
				resolved_at: at(24),
				claim_summary: {
					...claimed,
					latest_status_line: "Pool size raised; error rate back to 0.2%",
				},
			}),
		],
	},
};

/* A burst grouped under one card: worst severity raised to sev1, "N alerts,
   M resolved" (C2 on agent-server #463). */
export const GroupCardEscalated: Story = {
	args: {
		messages: [
			alert(
				{
					storm: true,
					grouped_count: 6,
					group_resolved_count: 2,
					severity: "sev1",
					fire_count: 1,
					labels: [],
					links: [],
					incident_key: "",
					claim_summary: { ...claimed, latest_status_line: undefined },
				},
				{
					body: "[STORM] Alert burst in this channel. New alerts from Datadog are grouped in this thread until none arrive for 5 minutes, all of them resolve, or 1 hour passes.",
				},
			),
		],
	},
};

/* Error state: a malformed `alert_meta` costs the card, not the message: the
   row falls back to the app's plain post. (The schema catches it in the real
   path; the story passes the already-caught shape.) */
export const MalformedMetaFallsBack: Story = {
	args: { messages: [alert({}, { alert_meta: undefined })] },
};

/* Empty state: the channel before any alert arrives. */
export const EmptyChannel: Story = {
	args: { messages: [] },
	render: () => (
		<div className="flex w-[760px] flex-col bg-canvas text-ink">
			<p className="mt-auto px-5 py-6 text-[13px] text-ink-muted">
				{t("ui.teamBridge.thread.empty")}
			</p>
		</div>
	),
};

/* Loading state: the timeline skeleton every conversation shows first. */
export const Loading: Story = {
	args: { messages: [] },
	render: () => (
		<div className="flex w-[760px] flex-col bg-canvas p-5 text-ink">
			<TeamBridgeMessageSkeleton label={t("ui.teamBridge.list.loading")} />
		</div>
	),
};

/* Narrow threads (D2): lines A, D and F wrap rather than clip, so every
   chip, the fingerprint, the links and the clock stay legible. 320px is the
   narrowest thread the RFC names. */
export const Narrow: Story = {
	args: { width: 360, messages: [alert({ claim_summary: claimed })] },
};
export const Narrow320: Story = {
	args: { width: 320, messages: [alert({ claim_summary: claimed })] },
};
export const Narrow320Resolved: Story = {
	args: {
		width: 320,
		messages: [
			alert({
				status: "resolved",
				resolved_at: at(24),
				claim_summary: claimed,
			}),
		],
	},
};

/* A reader whose own agent is not in #alerts-prod, on a card with no links:
   line F has nothing to hold, so it is not drawn (D3). */
export const NoActions: Story = {
	args: {
		responders: false,
		messages: [alert({ links: [] })],
	},
};

/*
 * 0px REFLOW (D1): the same card in every claim state, side by side, with the
 * measured card height printed under each. The heights must be equal; the
 * numbers come from `getBoundingClientRect` after layout, in this frame.
 */
const claimStates: [string, TeamBridgeAlertMeta["claim_summary"]][] = [
	["unreported", undefined],
	["unclaimed", { state: "unclaimed" }],
	["claimed", claimed],
	[
		"waiting",
		{
			...claimed,
			waiting_approval_for: { ask_id: "ask_aida_1", session_id: "s" },
		},
	],
	["escalated", { ...claimed, escalated: true }],
];
const ReflowFrame: FC = () => {
	const ref = useRef<HTMLDivElement>(null);
	const [heights, setHeights] = useState<string[]>([]);
	useLayoutEffect(() => {
		const cards = ref.current?.querySelectorAll("[data-alert-card]") ?? [];
		setHeights(
			Array.from(cards).map(
				(card) => `${card.getBoundingClientRect().height.toFixed(2)}px`,
			),
		);
	}, []);
	return (
		<div ref={ref} className="flex flex-col gap-1">
			<ListFrame
				owner
				width={620}
				messages={claimStates.map(([name, summary], index) =>
					alert(
						{ claim_summary: summary },
						{
							id: `bcmsg_${name}`,
							seq: index + 1,
							created_at: at(2 + index * 10),
						},
					),
				)}
			/>
			<output
				data-reflow-heights={heights.join(",")}
				className="font-mono text-meta text-ink-muted"
			>
				{claimStates
					.map(([name], i) => `${name}=${heights[i] ?? "?"}`)
					.join("  ")}
			</output>
		</div>
	);
};
export const ClaimStatesShareOneHeight: Story = {
	args: { messages: [] },
	render: () => <ReflowFrame />,
};

export const ResponderDialog: Story = {
	args: { messages: [] },
	render: () => (
		<TeamBridgeResponderDialog
			open
			channelName="alerts-prod"
			agentName="Aida"
			onClose={() => {}}
		/>
	),
};

/*
 * The conversation menu on #alerts-prod with both Team Integrations entries:
 * "Manage apps…" (the reader may manage integrations) and "Alert responder…"
 * (the reader's own agent is an active member). Sections come from the real
 * model through the menu fixtures.
 */
export const ChannelMenuWithIntegrations: Story = {
	args: { messages: [] },
	render: () => {
		const conversation = menuConversation({
			name: "alerts-prod",
			can_manage_integrations: true,
		});
		const base = menuSectionsFor(conversation, { integrations: true });
		return (
			<div className="flex h-[620px] w-[420px] justify-end bg-surface p-4 text-ink">
				<TeamBridgeConversationMenu
					sections={base}
					conversation={{ notify: "all", muted: false }}
					agentNotify="all"
					handlers={{
						onNotifyChange: () => {},
						onAgentNotifyChange: () => {},
						onViewMembers: () => {},
						onAddMembers: () => {},
						onJoin: () => {},
						onOwnAgent: () => {},
						onLeave: () => {},
						onArchive: () => {},
						onManageApps: () => {},
						onResponder: () => {},
					}}
					defaultOpen
				/>
			</div>
		);
	},
};
