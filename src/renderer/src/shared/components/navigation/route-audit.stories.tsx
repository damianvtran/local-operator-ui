/**
 * The route audit: every route root measured inside the real shell.
 *
 * WHY THIS FILE EXISTS. The panel contract's acceptance is per-route: where a
 * route's content top comes from (the shell's single pad or its own panel pad)
 * and what its first interactive row measures at the macOS strip. The shell
 * stories cover chat, settings and agents; the Library and Team Bridge stories
 * carry their own frames. The remaining routes (browser, projects, schedules,
 * agent hub, mesh) had no shell-mounted scene, and a page story alone cannot
 * answer a question about the shell's pad.
 *
 * WHAT IS REAL HERE: `ChatLayout`, `SidebarNavigation`, the route component and
 * the padded `<main>` `app.tsx` renders. WHAT IS NOT: the backend. An unaudited
 * route renders its honest loading/error state rather than a populated one,
 * which is enough for the top-edge question - a populated first row is lower,
 * never higher, than the state drawn here.
 */
import "../../../styles/index.css";
import "@features/chat/components/story-electron-shim";
import { AgentHubPage } from "@features/agent-hub/agent-hub-page";
import { BrowserPage } from "@features/browser/components/browser-page";
import type { BrowserChromeState } from "@features/browser/hooks/use-browser-chrome";
import { MeshPage } from "@features/mesh/mesh-page";
import { ProjectsPage } from "@features/projects/components/projects-page";
import { SchedulesPage } from "@features/schedules/components/schedules-page";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, type ReactNode, useEffect } from "react";
import { useNavigate } from "react-router-dom";

const RouteTo: FC<{ path: string; children: ReactNode }> = ({
	path,
	children,
}) => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate(path, { replace: true });
	}, [navigate, path]);
	return <>{children}</>;
};

const AuditFrame: FC<{ path: string; children: ReactNode }> = ({
	path,
	children,
}) => (
	<div className="relative flex h-screen flex-col overflow-hidden">
		<ChatLayout
			sidebar={<SidebarNavigation />}
			content={
				/* The app's own `<main>` carries this pad; the audit frame is that
				   composition, not a lookalike without it. */
				<main className="panel-top-pad flex min-w-0 grow flex-col overflow-hidden">
					<RouteTo path={path}>{children}</RouteTo>
				</main>
			}
		/>
	</div>
);

const meta: Meta = {
	title: "Audit/Routes",
	parameters: { layout: "fullscreen" },
	args: { theme: "localOperatorDark" },
};
export default meta;
type Story = StoryObj;

export const Browser: Story = {
	render: () => (
		<AuditFrame path="/browser">
			<BrowserPage />
		</AuditFrame>
	),
};

/*
 * THE BROWSER ROUTE WITH A BRIDGE. Without `window.api.browser` the route
 * renders its "desktop app only" notice, which sits under the shell's ordinary
 * pad and so says nothing about the surface's own panel pad - the gap behind
 * agent review round 1's F1 (the tab strip and the #1305 address popout drawn
 * at y0, under the drag lane, while the audit claimed an "own panel pad"). This
 * scene installs a projection with two tabs so the real strip renders inside the
 * real shell; raise the popout from the strip's address trigger to see where it
 * anchors. Every other bridge call resolves to an empty object.
 */
const BRIDGED_STATE: BrowserChromeState = {
	tabs: [
		{
			tabId: 1,
			title: "Reports",
			url: "https://reports.example.com/q3",
			owner: "agent",
			active: true,
			restored: false,
			handedOver: false,
			failed: false,
			loading: false,
			audible: false,
			muted: false,
			sessionId: null,
		},
		{
			tabId: 2,
			title: "Handbook",
			url: "https://handbook.example.com/",
			owner: "user",
			active: false,
			restored: false,
			handedOver: false,
			failed: false,
			loading: false,
			audible: false,
			muted: false,
			sessionId: null,
		},
	],
	activeTabId: 1,
	url: "https://reports.example.com/q3",
	title: "Reports",
	loading: false,
	canGoBack: false,
	canGoForward: false,
	pendingConsent: [],
	approvals: [],
	navFailure: null,
};

const BridgedBrowser: FC = () => {
	const resolved = () => Promise.resolve({});
	/*
	 * SPREAD the preview's mock rather than replacing it (agent review round 2,
	 * F2): Storybook keeps one preview iframe across stories, so a bare
	 * `{ browser }` erased `session`, `systemInfo`, `ipcRenderer` and the rest
	 * for every story opened after this one - `Audit/Routes → Browser` then drew
	 * the bridged strip instead of its desktop-only notice, and stories reading
	 * `window.api.systemInfo` threw until a reload.
	 */
	const host = window as unknown as { api: Record<string, unknown> };
	host.api = {
		...host.api,
		browser: new Proxy(
			{
				state: async () => BRIDGED_STATE,
				addressHistory: async () => ({ entries: [] }),
			} as Record<string, unknown>,
			{
				get: (target, key: string) =>
					key in target
						? target[key]
						: key.startsWith("on")
							? () => () => {}
							: resolved,
			},
		),
	};
	return <BrowserPage />;
};

export const BrowserBridged: Story = {
	render: () => (
		<AuditFrame path="/browser">
			<BridgedBrowser />
		</AuditFrame>
	),
};

export const Projects: Story = {
	render: () => (
		<AuditFrame path="/projects">
			<ProjectsPage nowMs={new Date(2026, 9, 18, 12, 0, 0).getTime()} />
		</AuditFrame>
	),
};

export const Schedules: Story = {
	render: () => (
		<AuditFrame path="/schedules">
			<SchedulesPage nowMs={new Date(2026, 9, 18, 12, 0, 0).getTime()} />
		</AuditFrame>
	),
};

export const AgentHub: Story = {
	render: () => (
		<AuditFrame path="/agent-hub">
			<AgentHubPage />
		</AuditFrame>
	),
};

export const Mesh: Story = {
	render: () => (
		<AuditFrame path="/mesh">
			<MeshPage />
		</AuditFrame>
	),
};
