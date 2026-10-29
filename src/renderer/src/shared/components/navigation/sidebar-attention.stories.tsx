import "../../../styles/index.css";
import "@features/chat/components/story-electron-shim";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useQueryClient } from "@tanstack/react-query";
import { type FC, useLayoutEffect, useState } from "react";
import statusFixture from "../../../../../../scripts/fixtures/agent-messages-status.json";
import type {
	DesktopRequest,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";

/**
 * EVERY SIDEBAR ATTENTION COUNT AT ONCE (operator, 2026-10-28).
 *
 * The evidence frame for the shared `AttentionBadge`: the REAL rail
 * (`SidebarNavigation` inside `ChatLayout`, the composition `app.tsx` draws),
 * fed through each row's REAL data path rather than through props, so a frame
 * shows what the rows actually render:
 *
 *   - Aida: an unseen completion receipt on her catalogue row (the store);
 *   - Notifications: `notifications.count` (`unread + waiting_unread`);
 *   - Browser: one live consent request on the browser projection;
 *   - Mesh: waiting `approvals.list` rows, gated on a `networks.list` membership;
 *   - Team Bridge: the account-wide `team_bridge.unread` total, gated on a
 *     signed-in Radient account and a ready Team Bridge status.
 *
 * Team Bridge and Mesh live in More by default, so More shows their SUM
 * (`moreAttentionCount`). The `count` arg scales every number so the `99+` cap
 * and two-digit widths can be shot from the same story. The payloads are
 * invented; their shapes are the wire's (the same shapes the notifications,
 * mesh-page and default-on-container fixtures use).
 *
 * What a frame here does NOT prove: that a live backend answers these reads,
 * or the live poll cadence. Projects and Agents carry no count source today
 * (see the PR's inventory), so they draw no badge here either.
 */

const AIDA_ID = "f37a9d713040";
const ACCOUNT = "acct_story";

type Counts = {
	aida: number;
	notifications: number;
	browser: number;
	mesh: number;
	teamBridge: number;
};

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

const route =
	(counts: Counts) =>
	async (request: DesktopRequest): Promise<DesktopResponse> => {
		const op = (request as { op: string }).op;
		switch (op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						aida: 1,
						notifications: 1,
						library: 1,
						projects: 1,
						peers: 1,
						approvals: 1,
						radient: 1,
						team_bridge: 1,
						team_bridge_conversations: 1,
						team_bridge_conversation_owner_guard: 1,
					},
				});
			case "aida.status":
				return ok({
					enabled: true,
					session_id: AIDA_ID,
					paused: false,
					greeted: true,
				});
			case "notifications.count":
				return ok({
					unread_count: counts.notifications,
					waiting_count: 0,
					waiting_unread_count: 0,
					high_water: 1,
				});
			case "networks.list":
				return ok({
					self_device_id: "dev_self",
					networks: [
						{
							network_id: "net_story",
							name: "story-mesh",
							epoch: 3,
							trust: "active",
							members: [],
						},
					],
				});
			case "approvals.list":
				return ok({
					approvals: Array.from({ length: counts.mesh }, (_, index) => ({
						approval_id: `apr_${index}`,
						state: "requested",
					})),
				});
			case "radient.request":
				return ok({
					data: {
						msg: "ok",
						result: {
							account: { id: ACCOUNT, name: "Story", email: "s@x.invalid" },
							identity: {},
						},
					},
				});
			case "team_bridge.status":
			case "agent_messages.status":
				return ok({
					...statusFixture,
					account_id: ACCOUNT,
					state: "ready",
					read_only: false,
					local: { ...statusFixture.local, enabled: true },
				});
			case "team_bridge.unread":
				return ok({
					total: counts.teamBridge,
					organizations: [
						{
							tenant_id: "tnt_story",
							tenant_name: "Story org",
							unread: counts.teamBridge,
							eligible: true,
						},
					],
				});
			case "sidebar_layout.get":
				return ok({ layout: null });
			default:
				return { status: 404, body: { detail: `story bridge: ${op}` } };
		}
	};

/** Her catalogue row with an unseen completion receipt per missed message. */
const aidaRows = (count: number) =>
	count > 0
		? [
				{
					session_id: AIDA_ID,
					title: "Aida",
					name: "Aida",
					preview: "",
					mtime: 1790603304,
					updated_at: 1790603304,
					pinned: true,
					archived: false,
					active: false,
					live_state: "",
					pending: null,
					binding: { agent: "aida", team: null },
					opened_by: null,
					status: { code: "complete", label: "Unseen completion" },
					attention: {
						conversation_id: `session/${AIDA_ID}`,
						completion_token: "tok_story",
						anchor_id: "anchor_story",
						kind: "complete",
						unseen: true,
						revision: [1, 0],
					},
				},
			]
		: [];

const browserState = (count: number) => ({
	tabs: [],
	activeTabId: null,
	url: "",
	title: "",
	loading: false,
	canGoBack: false,
	canGoForward: false,
	pendingConsent: Array.from({ length: count }, (_, index) => ({
		entryId: `consent_${index}`,
		origin: "https://example.com",
		authority: "example.com",
		broad: null,
		// Far future: the badge counts only LIVE requests.
		expiresAt: Date.now() + 24 * 60 * 60 * 1000,
		requesterSessionId: null,
	})),
	approvals: [],
	navFailure: null,
});

const Scene: FC<{
	counts: Counts;
	collapsed: boolean;
	moreOpen: boolean;
}> = ({ counts, collapsed, moreOpen }) => {
	const client = useQueryClient();
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		/* Installed before the rail mounts, so its first reads find the bridge;
		   SPREAD over the preview's mock so later stories keep their api. */
		const host = window as unknown as { api: Record<string, unknown> };
		const state = browserState(counts.browser);
		host.api = {
			...host.api,
			desktop: { request: route(counts) },
			browser: new Proxy(
				{ state: async () => state } as Record<string, unknown>,
				{
					get: (target, key: string) =>
						key in target
							? target[key]
							: key.startsWith("on")
								? () => () => {}
								: () => Promise.resolve({}),
				},
			),
		};
		client.clear();
		useCanonicalSessionsStore.setState({
			sessions: aidaRows(counts.aida) as never,
		});
		useUiPreferencesStore.getState().setSidebarCollapsed(collapsed);
		useUiPreferencesStore.getState().setSidebarOverflowExpanded(moreOpen);
		setReady(true);
		return () => {
			useCanonicalSessionsStore.setState({ sessions: [] });
			useUiPreferencesStore.getState().setSidebarCollapsed(false);
			useUiPreferencesStore.getState().setSidebarOverflowExpanded(false);
		};
	}, [client, counts, collapsed, moreOpen]);
	if (!ready) return null;
	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			<ChatLayout
				sidebar={<SidebarNavigation />}
				content={
					<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden" />
				}
			/>
		</div>
	);
};

const meta: Meta = {
	title: "Shell/Sidebar attention badges",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const SMALL: Counts = {
	aida: 1,
	notifications: 6,
	browser: 2,
	mesh: 1,
	teamBridge: 3,
};

/** Every attention row at once; Mesh and Team Bridge folded into More (sum 4). */
export const Counts: Story = {
	render: () => <Scene counts={SMALL} collapsed={false} moreOpen={false} />,
};

/** More opened: the hidden rows draw their own counts beneath it, and More
    itself draws none - its sum summarises what is HIDDEN (design D2). */
export const MoreOpen: Story = {
	render: () => <Scene counts={SMALL} collapsed={false} moreOpen />,
};

/** The cap: two- and three-digit counts read `99+`, never clipped. */
export const Overflow: Story = {
	render: () => (
		<Scene
			counts={{
				aida: 1,
				notifications: 128,
				browser: 12,
				mesh: 40,
				teamBridge: 75,
			}}
			collapsed={false}
			moreOpen
		/>
	),
};

/** The collapsed strip: the same badge as a corner mark on each icon. */
export const Collapsed: Story = {
	render: () => <Scene counts={SMALL} collapsed moreOpen={false} />,
};

/** The collapsed strip at the cap. */
export const CollapsedOverflow: Story = {
	render: () => (
		<Scene
			counts={{
				aida: 1,
				notifications: 128,
				browser: 12,
				mesh: 40,
				teamBridge: 75,
			}}
			collapsed
			moreOpen={false}
		/>
	),
};

/*
 * THE CORNER CAP, ONE STORY PER WIDTH (design follow-up to #1465, D1): one, two
 * and three digits on every corner-marked row at once, so the frames show the
 * mark at `5`, at the `9+` cap from a two-digit count, and at the same `9+` from
 * a three-digit one - the case that used to draw a `99+` lid over the Bell. Team
 * Bridge stays at zero so More's corner shows Mesh's count alone (the same N),
 * not a doubled sum.
 */
const scaled = (n: number): Counts => ({
	aida: 1,
	notifications: n,
	browser: n,
	mesh: n,
	teamBridge: 0,
});

/** The collapsed strip with single-digit counts: drawn exactly. */
export const Collapsed5: Story = {
	render: () => <Scene counts={scaled(5)} collapsed moreOpen={false} />,
};

/** Two digits in the strip: the corner caps at `9+`; the name keeps `12`. */
export const Collapsed12: Story = {
	render: () => <Scene counts={scaled(12)} collapsed moreOpen={false} />,
};

/** Three digits in the strip: still `9+`, never the `99+` lid. */
export const Collapsed125: Story = {
	render: () => <Scene counts={scaled(125)} collapsed moreOpen={false} />,
};
