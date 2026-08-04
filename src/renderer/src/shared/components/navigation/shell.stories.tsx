import "../../../styles/index.css";
import { AgentsPage } from "@features/agents/components/agents-page";
import { SettingsPage } from "@features/settings/components/settings-page";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { cn } from "@shared/lib/utils";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { applyThemeToDocument } from "@shared/themes";
import type { Meta, StoryObj } from "@storybook/react";
import { type FC, type ReactNode, useLayoutEffect } from "react";

/**
 * The app shell: the rail, the settings surface and the agents surface, in one
 * place so they can be judged against each other rather than one at a time.
 *
 * ## Why it stubs `fetch`
 *
 * Both routes are driven entirely by the Local Operator server, which is not
 * running in Storybook. Without fixtures every story renders a spinner or an
 * error, which is a picture of the loading state and nothing else. The stub is
 * a plain `fetch` wrapper installed for the story's lifetime: it answers the
 * handful of endpoints these two screens read and forwards everything it does
 * not recognise, so a Radient call still fails the way it would offline and the
 * signed-out branches render honestly.
 *
 * ## Why it sets the theme through the store
 *
 * `data-theme` on the document element only moves the Tailwind half of the
 * bridge. The MUI half reads the theme object out of the preferences store, so
 * a story that sets the attribute alone renders half the screen in one palette
 * and half in another. Setting the store and letting `applyThemeToDocument`
 * follow is what the app itself does.
 */

const NOW = "2025-11-04T09:12:00Z";
const EARLIER = "2025-10-02T14:40:00Z";

const AGENTS = [
	{
		id: "a1f4c2e0-1d3b-4a77-9c21-5e8d0b6f2a11",
		name: "Invoice reconciler",
		description:
			"Matches supplier invoices against the ledger and flags the ones that do not add up.",
		created_date: EARLIER,
		version: "0.4.2",
		security_prompt: "",
		hosting: "openrouter",
		model: "anthropic/claude-sonnet-4",
		tags: ["finance", "csv"],
		categories: ["productivity"],
		temperature: 0.2,
		top_p: 0.9,
		top_k: null,
		max_tokens: 4096,
		stop: null,
		frequency_penalty: null,
		presence_penalty: null,
		seed: null,
	},
	{
		id: "b2e5d3f1-2e4c-4b88-8d32-6f9e1c7a3b22",
		name: "Weekly research digest",
		description:
			"Reads the sources you saved this week and writes a short brief on what changed.",
		created_date: NOW,
		version: "0.4.2",
		security_prompt: "",
		hosting: "openrouter",
		model: "openai/gpt-4o-mini",
		tags: ["research"],
		categories: ["research"],
		temperature: null,
		top_p: null,
		top_k: null,
		max_tokens: null,
		stop: null,
		frequency_penalty: null,
		presence_penalty: null,
		seed: null,
	},
	{
		id: "c3f6e4a2-3f5d-4c99-9e43-7a0f2d8b4c33",
		name: "Photo library tidier",
		description: "No description",
		created_date: EARLIER,
		version: "0.4.1",
		security_prompt: "",
		hosting: "",
		model: "",
		tags: [],
		categories: [],
		temperature: null,
		top_p: null,
		top_k: null,
		max_tokens: null,
		stop: null,
		frequency_penalty: null,
		presence_penalty: null,
		seed: null,
	},
];

const CONFIG = {
	version: "0.12.8",
	metadata: {
		created_at: "2025-06-18T11:02:00Z",
		last_modified: NOW,
		description: "Default configuration",
	},
	values: {
		conversation_length: 100,
		detail_length: 15,
		max_learnings_history: 50,
		hosting: "openrouter",
		model_name: "anthropic/claude-sonnet-4",
		auto_save_conversation: true,
	},
};

const ok = (result: unknown) =>
	new Response(JSON.stringify({ status: 200, message: "ok", result }), {
		status: 200,
		headers: { "Content-Type": "application/json" },
	});

const AGENT_BY_ID = /^\/v1\/agents\/([^/]+)$/;

const route = (path: string): Response | null => {
	if (path === "/health") {
		return new Response(JSON.stringify({ status: 200, message: "ok" }), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	}
	if (path === "/v1/config") return ok(CONFIG);
	if (path === "/v1/config/system-prompt") {
		return ok({
			content:
				"You are working on Damian's machine. Prefer plain language, name the files you touch, and ask before anything destructive.",
			last_modified: NOW,
		});
	}
	if (path === "/v1/credentials") {
		return ok({ keys: ["OPENROUTER_API_KEY", "TAVILY_API_KEY"] });
	}
	if (path === "/v1/models/providers") return ok({ providers: [] });
	if (path === "/v1/models") return ok({ models: [] });
	if (path === "/v1/agents") {
		return ok({ total: AGENTS.length, page: 1, per_page: 50, agents: AGENTS });
	}
	const agentMatch = AGENT_BY_ID.exec(path);
	if (agentMatch) {
		const found = AGENTS.find((a) => a.id === agentMatch[1]);
		return found ? ok(found) : null;
	}
	return null;
};

/**
 * The updater half of the preload bridge, which the settings page reaches for
 * on mount. Storybook's own `window.api` mock stops at `ipcRenderer`, so
 * without this the whole page renders as a Storybook error rather than as a
 * screen. Every listener returns its own unsubscribe, because the components
 * call the return value on unmount.
 */
const noopUnsubscribe = () => () => {};

const UPDATER_STUB = {
	checkForUpdates: async () => ({ updateInfo: {}, cancellationToken: null }),
	checkForBackendUpdates: async () => null,
	checkForAllUpdates: async () => {},
	updateBackend: async () => false,
	downloadUpdate: async () => [],
	quitAndInstall: () => {},
	onUpdateAvailable: noopUnsubscribe,
	onUpdateNotAvailable: noopUnsubscribe,
	onUpdateDevMode: noopUnsubscribe,
	onUpdateNpxAvailable: noopUnsubscribe,
	onBackendUpdateAvailable: noopUnsubscribe,
	onBackendUpdateDevMode: noopUnsubscribe,
	onBackendUpdateNotAvailable: noopUnsubscribe,
	onBackendUpdateCompleted: noopUnsubscribe,
	onUpdateDownloaded: noopUnsubscribe,
	onUpdateProgress: noopUnsubscribe,
	onUpdateError: noopUnsubscribe,
	onBeforeQuitForUpdate: noopUnsubscribe,
};

/**
 * Installs the fixture responses for as long as the story is mounted.
 *
 * `useLayoutEffect` rather than a module-level assignment: react-query fires
 * its first request during the initial render pass, and a stub installed in a
 * passive effect would land after it.
 */
const useFixtureFetch = () => {
	useLayoutEffect(() => {
		/*
		 * The preload bridge is injected by Electron and typed as fully present,
		 * so filling in the parts Storybook's mock omits means writing to it
		 * through a looser view of `window` rather than through that type.
		 */
		const bridge = window as unknown as {
			api?: Record<string, unknown>;
		};
		if (!bridge.api) {
			bridge.api = {};
		}
		const api = bridge.api;
		if (!api.updater) {
			api.updater = UPDATER_STUB;
		}
		if (!api.systemInfo) {
			api.systemInfo = {
				getAppVersion: async () => "0.12.8",
				getPlatformInfo: async () => ({
					platform: "darwin",
					arch: "arm64",
					nodeVersion: "22.14.0",
					electronVersion: "33.2.1",
					chromeVersion: "130.0.6723.152",
				}),
			};
		}

		const original = window.fetch;
		window.fetch = async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			if (url.startsWith("http://127.0.0.1:1111")) {
				const response = route(new URL(url).pathname);
				if (response) return response;
			}
			return original(input, init);
		};
		return () => {
			window.fetch = original;
		};
	}, []);
};

/*
 * The theme is whatever the preferences store holds, and the store is
 * persisted, so a screenshot run picks a palette by writing
 * `ui-preferences-storage` before the page loads — the same key the app writes.
 * Deliberately not a Storybook arg: an arg would let the control and the
 * persisted value disagree, and the one that lost would still be driving MUI.
 *
 * No `MemoryRouter` here. The preview already wraps every story in one, and
 * react-router throws outright on a nested `Router` — which renders as a
 * Storybook configuration error rather than as a screen, so it is worth naming.
 * The two pages this frames read the route through hooks that fall back to
 * their own stores, which is what `AgentsSelection` below sets.
 */
const ShellFrame: FC<{ children: ReactNode }> = ({ children }) => {
	const themeName = useUiPreferencesStore((state) => state.themeName);
	useFixtureFetch();

	useLayoutEffect(() => {
		applyThemeToDocument(themeName);
	}, [themeName]);

	return (
		<div className={cn("flex h-screen overflow-hidden bg-canvas")}>
			<SidebarNavigation />
			<main className="flex min-w-0 grow flex-col overflow-hidden">
				{children}
			</main>
		</div>
	);
};

/** Seeds the agent the page falls back to when the route carries no id. */
const useSelectedAgent = (agentId: string | null) => {
	const setLastAgentsPageAgentId = useAgentSelectionStore(
		(state) => state.setLastAgentsPageAgentId,
	);
	useLayoutEffect(() => {
		setLastAgentsPageAgentId(agentId);
	}, [agentId, setLastAgentsPageAgentId]);
};

const meta: Meta = {
	title: "Shell/App shell",
	parameters: {
		layout: "fullscreen",
	},
};

export default meta;

type Story = StoryObj;

/** The settings surface: rail, measured content column, every section. */
export const Settings: Story = {
	render: () => (
		<ShellFrame>
			<SettingsPage />
		</ShellFrame>
	),
};

const AgentsShell: FC<{ agentId: string | null; collapsed?: boolean }> = ({
	agentId,
	collapsed = false,
}) => {
	const setCollapsed = useUiPreferencesStore(
		(state) => state.setSidebarCollapsed,
	);
	useSelectedAgent(agentId);

	useLayoutEffect(() => {
		setCollapsed(collapsed);
		return () => setCollapsed(false);
	}, [collapsed, setCollapsed]);

	return (
		<ShellFrame>
			<AgentsPage />
		</ShellFrame>
	);
};

/** The agents surface: agent list, selected agent, the four settings panes. */
export const Agents: Story = {
	render: () => <AgentsShell agentId={AGENTS[0].id} />,
};

/** The agents surface with nothing selected — the empty state on canvas. */
export const AgentsEmpty: Story = {
	render: () => <AgentsShell agentId={null} />,
};

/**
 * The rail collapsed, beside the agents list. This is the pairing that used to
 * merge into one slab: two `surface` panels with no boundary between them.
 */
export const RailCollapsed: Story = {
	render: () => <AgentsShell agentId={AGENTS[0].id} collapsed />,
};
