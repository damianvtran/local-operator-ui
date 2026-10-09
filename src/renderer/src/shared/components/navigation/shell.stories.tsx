import "../../../styles/index.css";
// The shim installs window.api for every story here.
import "@features/chat/components/story-electron-shim";
import { AgentsPage } from "@features/agents/components/agents-page";
import { BrowserPane } from "@features/browser/components/browser-pane";
import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import {
	EMPTY_TRANSCRIPT,
	type TranscriptRecord,
	type TranscriptState,
} from "@features/chat/canonical/transcript-reducer";
import {
	CHAT_PANE_MIN_PX,
	rightSlotDividerContract,
} from "@features/chat/chat-sidebar-layout";
import { AskDrawer } from "@features/chat/components/asks/ask-drawer";
import { Canvas } from "@features/chat/components/canvas";
import { RUN_PANEL_MAX_PX } from "@features/chat/components/chat-content";
import { ChatHeader } from "@features/chat/components/chat-header";
import {
	deriveMcpServers,
	deriveRunDetails,
	mcpGrantInFlight,
} from "@features/chat/components/run-details/run-detail-model";
import * as runFixtures from "@features/chat/components/run-details/run-details.fixtures";
import { RunPanel } from "@features/chat/components/run-details/run-panel";
import type { McpRemedyControls } from "@features/chat/components/run-details/use-mcp-remedy";
import type { MonitorControls } from "@features/chat/components/run-details/use-monitor-controls";
import type { CanvasDocument } from "@features/chat/types/canvas";
import { ConsolePane } from "@features/console/components/console-pane";
import { PROVIDER_ROWS } from "@features/settings/components/setting-combobox.fixtures";
import { SettingsPage } from "@features/settings/components/settings-page";
import type { ReusableProfile } from "@shared/api/local-operator/profile-hooks";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { PaneSlot } from "@shared/components/common/pane-slot";
import { ResizableDivider } from "@shared/components/common/resizable-divider";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { apiConfig } from "@shared/config/api-config";
import { useAgentSelectionStore } from "@shared/store/agent-selection-store";
import { useCanvasStore } from "@shared/store/canvas-store";
import {
	BROWSER_PANEL_MIN_PX,
	CONSOLE_PANEL_MIN_PX,
	RUN_PANEL_MIN_PX,
	resolveRightSlotOccupied,
	resolveRightSlotWidth,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import {
	type FC,
	type ReactNode,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	UP_TO_DATE_AFFIRMATION,
	type UpdateCheckVerdict,
} from "../../../../../main/update-check-verdict";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { PendingAsk } from "../../../../../shared/desktop-session-contract";
import type { SessionFailureNotice } from "../../../../../shared/desktop-stream-notice";
import { ShellStoryRail } from "./shell-story-rail";

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
 * ## Where the theme comes from
 *
 * The preview-level frame in `.storybook/preview.tsx`, which moves the MUI
 * theme object, `data-theme` and the preferences store together from one
 * `theme` arg. This file used to drive the store itself, which meant the
 * Storybook theme control did nothing here and an evidence run of the shell
 * produced one palette under twelve filenames.
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
const AGENT_SYSTEM_PROMPT = /^\/v1\/agents\/([^/]+)\/system-prompt$/;

/**
 * The origin the subject actually calls, read from the same config the app
 * reads rather than written out here. The two had drifted apart once already:
 * this matcher said `127.0.0.1` while the schema's default says `localhost`,
 * so with no `.env` present every fixture missed and the whole surface fell
 * through to the network.
 */
const BACKEND_ORIGIN = new URL(apiConfig.baseUrl).origin;

/*
 * The system prompt both channels answer with - one spelling, so the REST
 * route and the desktop read cannot come to describe different machines.
 */
const SYSTEM_PROMPT_CONTENT =
	"You are working on Damian's machine. Prefer plain language, name the files you touch, and ask before anything destructive.";

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
			content: SYSTEM_PROMPT_CONTENT,
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
	/*
	 * The selected agent's own prompt, which `AgentsPage` fetches as soon as a
	 * row is selected. It went unrouted, and while the stub still fell through
	 * to a dead port that failure was invisible; once the stub started owning
	 * the origin it became a rejected request and a toast, so forty-eight
	 * frames showed a populated agent list and form above "Could not reach the
	 * server" - a screen the product cannot produce. `agents-empty` selects no
	 * agent, makes no such call and carries no toast, which is what pinned it.
	 */
	const promptMatch = AGENT_SYSTEM_PROMPT.exec(path);
	if (promptMatch) {
		const found = AGENTS.find((a) => a.id === promptMatch[1]);
		return found
			? ok({ system_prompt: "Answer in plain language and show your work." })
			: null;
	}
	const agentMatch = AGENT_BY_ID.exec(path);
	if (agentMatch) {
		const found = AGENTS.find((a) => a.id === agentMatch[1]);
		return found ? ok(found) : null;
	}
	return null;
};

/*
 * The desktop control plane, answered from the same world the REST routes
 * above describe.
 *
 * WHY THIS EXISTS. Both surfaces read through the desktop transport - the
 * settings page's config and account reads, the agents page's capabilities and
 * profile catalogue - not through the REST paths alone, so until this fixture
 * owned that channel every one of those reads failed against the Storybook
 * server's 404: the settings story photographed the product's "Your settings
 * could not be loaded. The Local Operator server is older than this app
 * expects." card, and the agents stories sat under "The backend could not be
 * reached - Desktop controls need a compatible backend connection." A story is
 * a picture of the tree, so its fixtures own every channel its subject calls -
 * the same arrangement `docs-library.stories.tsx` states as "WHAT IS
 * STUBBED", on the same pages.
 *
 * WHAT IS ANSWERED, and why the account read is an ANSWER despite being a
 * refusal: the pages read the Radient account over the same transport, and the
 * no-credential answer (409 + `radient_no_credential`) is the class they
 * classify as the ordinary signed-out state - the reading a fresh machine
 * gives, never a fault card. An operation this world has no answer for is
 * refused BY NAME, so a story that starts issuing a new read fails loudly
 * rather than hanging on a promise nothing resolves.
 */
const DESKTOP_CAPABILITIES = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: {
		profile_catalogue: 1,
		team_catalogue: 1,
		aida: 1,
		settings: 1,
		agents_config: 1,
		session_interrupt: 1,
	},
};

/**
 * The transport's own envelope: `{status, body}`, where `body` is the
 * backend's CRUD payload - NOT the payload directly. Both wire paths are built
 * from it (`desktopResult` reads `.body.result` off the IPC answer;
 * `desktopControlResponse` rebuilds a `Response` from `.status`/`.body`), so a
 * stub that returned the bare payload would render an empty result rather than
 * an error, which is the quiet failure this shape avoids.
 */
const desktopOk = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { status: 200, message: "ok", result },
});

/** One call over the desktop bridge, as the wire carries it. */
type DesktopBridgeRequest = {
	op: string;
	control?: { operation?: string };
	[key: string]: unknown;
};

/**
 * The roster the agents page lists, shaped from this fixture's own `AGENTS` so
 * the surface shows real rows rather than an invented second world; the
 * "specialist" kind is how the roster's vocabulary names a durable task
 * agent. The list is derived rather than retyped, so a rename of a fixture
 * agent cannot leave two spellings of it behind.
 */
const DESKTOP_PROFILES: ReusableProfile[] = AGENTS.map((agent) => ({
	name: agent.name,
	kind: "specialist",
	source: "installed",
	agent_id: null,
	description: agent.description,
	tools: null,
	effort: null,
	delegate: false,
}));

const desktopRoute = async (
	request: DesktopBridgeRequest,
): Promise<DesktopResponse> => {
	switch (request.op) {
		case "capabilities":
			return desktopOk(DESKTOP_CAPABILITIES);
		case "config.get":
			return desktopOk(CONFIG);
		case "instructions.get":
			return desktopOk({
				content: SYSTEM_PROMPT_CONTENT,
				last_modified: NOW,
			});
		case "radient.request":
			if (request.control?.operation === "account") {
				return {
					status: 409,
					body: {
						detail: {
							code: "radient_no_credential",
							message: "Sign in to Radient to access your account",
						},
					},
				};
			}
			throw new Error(
				`unexpected Radient operation in this story: ${request.control?.operation}`,
			);
		case "profiles.list":
			return desktopOk({ profiles: DESKTOP_PROFILES });
		/*
		 * The shipped provider registry, read from the committed real projection
		 * (`setting-combobox.fixtures.ts` carries the same rows the backend's own
		 * census returns) rather than a hand-written one - the Model providers
		 * section hard-enables this read, and a bare `[]` would photograph an
		 * empty registry the product cannot have.
		 */
		case "providers.list":
			return desktopOk({ providers: PROVIDER_ROWS });
		/*
		 * No reusable teams in this world; the shell rows' subject is the rail and
		 * the pane split, and an empty Teams tab is a state the page has rather
		 * than an error it shows.
		 */
		case "teams.list":
			return desktopOk({ teams: [] });
		/*
		 * The backend settings registry. This world configures no `subagents.models`
		 * tiers, so the composer's effort picker has nothing to offer - the reading
		 * an unconfigured backend gives, not an error.
		 */
		case "settings.list":
			return desktopOk({ settings: [] });
		case "aida.status":
			return desktopOk({
				enabled: true,
				session_id: null,
				paused: false,
				greeted: true,
			});
		default:
			throw new Error(`unexpected desktop op in this story: ${request.op}`);
	}
};

/**
 * The updater half of the preload bridge, which the settings page reaches for
 * on mount. Storybook's own `window.api` mock stops at `ipcRenderer`, so
 * without this the whole page renders as a Storybook error rather than as a
 * screen. Every listener returns its own unsubscribe, because the components
 * call the return value on unmount.
 */
const noopUnsubscribe = () => () => {};

/**
 * The verdict a fake bridge hands the renderer, as GIVEN data.
 *
 * The sentence is READ from the shipped module rather than retyped here, and
 * for the same reason the shape is: `src/main/update-check-verdict.ts` owns that
 * copy, and a second spelling of it in a story is exactly the drift the module
 * exists to prevent. The type is imported so a change to the verdict's shape
 * fails this file's typecheck the moment it lands.
 */
const UP_TO_DATE_VERDICT: UpdateCheckVerdict = {
	app: "current",
	server: "current",
	affirmation: UP_TO_DATE_AFFIRMATION,
};

const UPDATER_STUB = {
	checkForUpdates: async () => ({ updateInfo: {}, cancellationToken: null }),
	checkForBackendUpdates: async () => null,
	checkForAllUpdates: async () => UP_TO_DATE_VERDICT,
	updateBackend: async () => false,
	downloadUpdate: async () => [],
	quitAndInstall: () => {},
	quitForUpdateInstall: async () => true,
	getLastInstallAttempt: async () => null,
	onUpdateAvailable: noopUnsubscribe,
	onUpdateNotAvailable: noopUnsubscribe,
	onUpdateDevMode: noopUnsubscribe,
	onUpdateNpxAvailable: noopUnsubscribe,
	onBackendUpdateAvailable: noopUnsubscribe,
	onBackendUpdateDevMode: noopUnsubscribe,
	onBackendUpdateNotAvailable: noopUnsubscribe,
	onBackendUpdateCompleted: noopUnsubscribe,
	onBackendUpdateProgress: noopUnsubscribe,
	onBackendUpdateError: noopUnsubscribe,
	onBackendUpdateManualRequired: noopUnsubscribe,
	onUpdateDownloaded: noopUnsubscribe,
	onUpdateProgress: noopUnsubscribe,
	onUpdateError: noopUnsubscribe,
	onUpdateInstallBlocked: noopUnsubscribe,
	onUpdateInstallFailed: noopUnsubscribe,
	onUpdateInstallInFlight: noopUnsubscribe,
	onBeforeQuitForUpdate: noopUnsubscribe,
	onUpdateInstallProgress: noopUnsubscribe,
	onUpdateInstallSucceeded: noopUnsubscribe,
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
		/*
		 * The desktop bridge, on the property `desktopRequest` prefers. It is
		 * installed in this effect rather than at module scope for the same reason
		 * the fetch stub below is: the reads a page fires on mount have to find it,
		 * and a layout effect lands before react-query's first request.
		 *
		 * It OVERWRITES rather than filling only when absent, deliberately: the
		 * window is shared by every story in a Storybook session, so a docs-library
		 * or backend-settings scene that ran earlier leaves ITS bridge behind, and
		 * a frame must stay a function of this tree.
		 */
		api.desktop = { request: desktopRoute };

		const original = window.fetch;
		window.fetch = async (input, init) => {
			const url =
				typeof input === "string"
					? input
					: input instanceof URL
						? input.toString()
						: input.url;
			/*
			 * The same bridge over the fetch fallback `desktopRequest` takes when
			 * `window.api.desktop` is absent - what the dev server implements as
			 * `POST /__desktop`. Answering it here keeps the two channels one world;
			 * the body is the transport's own envelope INSIDE a 200, never the bare
			 * payload (see `desktopOk`).
			 */
			const controlPath = url.split("?")[0];
			if (controlPath.endsWith("/__desktop")) {
				const request = JSON.parse(String(init?.body ?? "{}"));
				return new Response(JSON.stringify(await desktopRoute(request)), {
					status: 200,
					headers: { "Content-Type": "application/json" },
				});
			}
			if (url.startsWith(BACKEND_ORIGIN)) {
				const response = route(new URL(url).pathname);
				/*
				 * Unrouted backend paths fail here rather than reaching the
				 * network. Falling through looks harmless while nothing is
				 * listening on the port - the request is refused and the screen
				 * shows the offline state these frames are supposed to depict.
				 * Run the real server on that port, though, and the same code
				 * photographs its replies: a capture taken with a backend up
				 * rewrote all sixty of this surface's frames, swapping "Could
				 * not reach the server" for a 404 from one developer's machine,
				 * and nothing in the run said a word about it.
				 *
				 * It has to reject, not resolve. `Response.error()` arrives as a
				 * Response whose status is 0, and the app renders that as "request
				 * failed: 0" - a third state, matching neither a live server nor a
				 * dead one. A refused connection rejects with a TypeError, so that
				 * is what an absent backend has to look like here.
				 *
				 * A story is a picture of the tree, so its fixtures own every
				 * path its subject calls - including the ones nobody wrote a
				 * fixture for.
				 */
				if (response) return response;
				throw new TypeError("Load failed");
			}
			return original(input, init);
		};
		return () => {
			window.fetch = original;
		};
	}, []);
};

/*
 * No `MemoryRouter` here. The preview already wraps every story in one, and
 * react-router throws outright on a nested `Router` — which renders as a
 * Storybook configuration error rather than as a screen, so it is worth
 * naming. The two pages this frames read the route through hooks that fall
 * back to their own stores, which is what `useSelectedAgent` below sets.
 */
const ShellFrame: FC<{ children: ReactNode; windows?: boolean }> = ({
	children,
	windows = false,
}) => {
	useFixtureFetch();
	useWindowsChromeSimulation(windows);

	/*
	 * The rail is drawn in the composition `app.tsx` draws it in, because the
	 * rail reads its own frame from `ChatLayout` and THROWS outside it
	 * (`useSidebarFrame`: a silent fallback "would draw a docked column inside
	 * whatever else mounted it"). A frame that mounts the rail bare is a harness
	 * the product cannot produce - and it killed all five of this file's shell
	 * stories, which hand-rolled the row and kept doing so after the rail gained
	 * the requirement. Wrapper and pair are the app's own shell root and the
	 * same composition the dock stories below draw.
	 */
	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			<ChatLayout
				sidebar={<SidebarNavigation />}
				content={
					<main className="flex min-w-0 grow flex-col overflow-hidden">
						{children}
					</main>
				}
			/>
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

/**
 * Appearance, scrolled into view.
 *
 * `Settings` above is a 1280x800 clip of the top of a page about 3,600px
 * tall, so it stops inside Model settings. The reasoning toggle sits at
 * roughly y=3094 and the theme grid just above it, which meant the only
 * control for a user-visible preference - and the theme picker, the largest
 * piece of visual design on the page - were both absent from the record
 * while appearing to be covered by a captured surface.
 *
 * Scrolled rather than given a taller viewport: an 800px window is what the
 * app's own minimum produces, and a 3,600px frame would photograph a page no
 * screen ever shows.
 */
const APPEARANCE = '[data-tour-tag="settings-appearance-section"]';

const SettingsAtAppearance: FC = () => {
	/*
	 * Scrolled when the section arrives, not when this mounts.
	 *
	 * The page renders its sections behind a config query, so on mount there
	 * is nothing to scroll to: the first version of this scrolled immediately,
	 * found no element, and captured the top of the page - twelve frames that
	 * looked exactly like the `Settings` surface they were added to
	 * supplement. An observer fires on insertion instead, which is an event
	 * rather than a guess about how long a stub takes.
	 *
	 * Anchored on the switch rather than on the section. The theme grid makes
	 * Appearance about 4,400px tall, so centring the section put the heading
	 * 1,858px above the viewport and the toggle 2,613px below it, and its end
	 * put the row hard against the bottom edge with its description clipped.
	 * Centring the control leaves the grid above it and the section boundary
	 * below, which is the row in its context rather than the row in a corner.
	 *
	 * `data-capture-pending` holds the shutter until that has happened. The
	 * rig's readiness poll gates on the loader being gone and an element count
	 * being met, and this page's skeletons satisfy both before the config
	 * query resolves - so "ready" can arrive while the Appearance section does
	 * not yet exist and the observer has not fired. The frame would be the top
	 * of the page, which is what the first two attempts at this story
	 * produced, and which is indistinguishable from a correct frame unless
	 * someone opens it.
	 */
	useLayoutEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const scroll = () => {
			const section = document.querySelector(APPEARANCE);
			const control = section?.querySelector('button[role="switch"]');
			if (!control) return false;
			control.scrollIntoView({ block: "center" });
			document.documentElement.removeAttribute("data-capture-pending");
			return true;
		};
		if (scroll()) return;
		const observer = new MutationObserver(() => {
			if (scroll()) observer.disconnect();
		});
		observer.observe(document.body, { childList: true, subtree: true });
		return () => {
			observer.disconnect();
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return <SettingsPage />;
};

export const SettingsAppearance: Story = {
	render: () => (
		<ShellFrame>
			<SettingsAtAppearance />
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

/* ------------------------------------------------------------------ *
 * The dock, in the shell that decides its top edge
 * ------------------------------------------------------------------ */

/**
 * WHY THESE TWO STORIES EXIST, AND WHY THEY LIVE HERE.
 *
 * The operator's report was that the canvas "hard cuts off", that its icon row
 * sat on "a band whose background differs from the panel body beneath it", and
 * that it should be "a similar borderless background with contrast to the left
 * sidebar" and "go all the way up". The pane's own evidence set is
 * `SplitFrame` - the dock beside a mock conversation - so it can show neither the
 * rail it is compared against nor the 32px lane that decides where the dock's
 * ground starts (design review round 1, D2). This file already mounts the REAL
 * rail, so the dock's frames belong here beside it rather than in a second
 * harness beside the first: `app.tsx` composes exactly this - `ChatLayout` with
 * `SidebarNavigation` as its sidebar and `<main>` as its content - and these
 * stories are that composition with a conversation stand-in in place of the one
 * that needs a live session.
 *
 * REAL: the rail, `ChatLayout`'s lane and columns, `PaneSlot`, the `Canvas` and
 * the `RunPanel`. STAND-IN: the conversation column, painted `bg-canvas` and
 * carrying the paragraph the committed canvas frames already carry.
 *
 * NO RULE IS DRAWN AT EITHER BOUNDARY. The rail has none in the app either
 * (`sidebar-navigation.tsx` states why the tonal step carries it), and the dock's
 * leading `hairline` is what this change removed; frames captured through a
 * harness that drew one showed a boundary the product no longer had (D1).
 */

const DOCK_CONVERSATION_ID = "shell-dock-conversation";
const DOCK_MODIFIED_AT = 1_760_000_000_000;

const DOCK_DOCUMENTS: CanvasDocument[] = [
	{
		id: "/Users/dana/work/reports/march-invoice-review.md",
		title: "march-invoice-review.md",
		path: "/Users/dana/work/reports/march-invoice-review.md",
		content: "# Q1 invoice review\n",
		type: "markdown",
		readMtimeMs: DOCK_MODIFIED_AT,
	},
	{
		id: "/Users/dana/work/reports/summary.md",
		title: "summary.md",
		path: "/Users/dana/work/reports/summary.md",
		content: "The write-up is open in the canvas.\n",
		type: "markdown",
		readMtimeMs: DOCK_MODIFIED_AT,
	},
	{
		id: "/Users/dana/work/invoices/february.csv",
		title: "february.csv",
		path: "/Users/dana/work/invoices/february.csv",
		content: "id,total\n1,120.00\n",
		type: "spreadsheet",
		readMtimeMs: DOCK_MODIFIED_AT,
	},
];

/**
 * No-op MCP remedy controls. The run panel's MCP section is not this frame's
 * subject - the dock's ground and its top edge are - and the fixtures carry no
 * MCP servers, so every control here is the inert shape the panel requires
 * rather than a behaviour this story claims.
 */
const INERT_REMEDY: McpRemedyControls = {
	press: () => undefined,
	pressKey: async () => true,
	cancel: () => undefined,
	reload: async () => true,
	pendingName: null,
	refusalFor: () => null,
	failureFor: () => null,
	clearFailure: () => undefined,
};

/**
 * No-op monitor controls. The Monitors section is not this frame's subject and
 * the fixtures carry no monitors, so the control is the inert shape the panel
 * requires rather than a behaviour this story claims.
 */
const INERT_MONITOR_CONTROLS: MonitorControls = {
	cancel: async () => ({ ok: true }),
};

/**
 * The conversation column: the production `ChatHeader` over a transcript at the
 * app's own ground and inset.
 *
 * THE HEADER IS THE POINT OF PUTTING IT HERE. A lane-only composition was the
 * first version of this frame, and the reading taken from it - "the window has one
 * drag surface" - was wrong: with a conversation on screen the header is a second
 * one, and its rect is the one a press aimed at the pane beside it has to survive
 * (UX round 1, U1). A frame that does not contain the header cannot measure that,
 * so the header is in every dock frame.
 * THE COLUMN'S CLASSES ARE THE APP'S OWN (`w-0 min-w-[480px] flex-1`, `chat-content.tsx`),
 * and that is load-bearing rather than tidy: `grow` alone leaves the flex BASIS at auto,
 * so this column's basis was its CONTENT's width (a paragraph ~848px wide at this
 * viewport) and the dock beside it was squeezed to its 400px floor in every frame of
 * the set - a composition the app never draws, where the column's `w-0` basis makes the
 * 480px floor the whole story and the dock keeps the width the slot resolves for it.
 * The lane's stop above the dock is derived from the pane's real leading edge, so a
 * squeezed dock is also a lane stop 140px off the boundary it is meant to land on.
 */
const ConversationStandIn = ({
	details,
	railProps = {},
	asksCount = 0,
	body,
}: {
	/** Null on a draft: the app's draft has no run details, so no trigger. */
	details: ReturnType<typeof deriveRunDetails> | null;
	railProps?: {
		browserAttentionCount?: number;
		consoleUnseenCount?: number;
		fileCount?: number;
		/** Offer the asks item on the rail (#896); see `ShellStoryRail`. */
		askOffered?: boolean;
		askCount?: number;
	};
	/** The asks this shell simulates: above 0 the header's `...` menu gains its
	 * asks row (#896) and the rail draws the item with this count. */
	asksCount?: number;
	/**
	 * What the column holds under the header, in place of the one-paragraph
	 * stand-in. The #895 arms pass the REAL `CanonicalTranscript` here, because
	 * the question they photograph is what the column's edges are made of.
	 */
	body?: ReactNode;
}) => {
	/*
	 * The header's trailing reservation, derived from the store exactly as
	 * `chat-content` derives it: the spacer is drawn while no pane holds the slot.
	 */
	const occupied = useUiPreferencesStore(resolveRightSlotOccupied);
	/*
	 * PROPS THE RAIL TREE'S HEADER DOES NOT DECLARE, spread loosely on purpose (the
	 * same device #868's before half used for `rightSlotRoute`). On this tree the
	 * SEVEN rail props - `mcpServers`, `listOnScreen`, `readerChildId`, `fileCount`,
	 * `browserAttentionCount`, `consoleUnseenCount`, `consoleUnseenPulsing` - are
	 * inert: `ChatHeader` reads none of them, the four triggers having moved to the
	 * rail. `reserveTrailingChrome` below is NOT one of them and is NOT inert - it
	 * is LIVE on both arms: the head's header reads it for its trailing spacer
	 * (`chat-header.tsx`), and so does `origin/main`'s. The BEFORE half of this
	 * change's evidence swaps `origin/main`'s `chat-header.tsx` under these arms
	 * (see `docs/evidence/shell-app-shell/panel-rail-before/README.md`), and that
	 * header reads the seven to draw its four triggers and their marks. One scene
	 * under two readers is what makes the pair a comparison.
	 */
	const legacyHeaderProps: Record<string, unknown> = {
		mcpServers: deriveMcpServers([], {}, []),
		listOnScreen: false,
		readerChildId: null,
		fileCount: railProps.fileCount ?? 0,
		browserAttentionCount: railProps.browserAttentionCount ?? 0,
		consoleUnseenCount: railProps.consoleUnseenCount ?? 0,
		consoleUnseenPulsing: false,
		reserveTrailingChrome: !occupied,
	};
	return (
		<div
			data-tour-tag="chat-column"
			className="w-0 min-w-[480px] flex-1 flex h-full min-h-0 flex-col overflow-hidden"
		>
			<ChatHeader
				agentName="Core"
				description="Invoices workspace · on this machine"
				onOpenOptions={() => undefined}
				onToggleBrowser={() => undefined}
				onOpenConsole={details ? () => undefined : undefined}
				onToggleAsks={asksCount > 0 ? () => undefined : undefined}
				runDetails={details}
				{...legacyHeaderProps}
			/>
			{body ? (
				<div className="flex min-h-0 grow flex-col overflow-hidden bg-canvas">
					{body}
				</div>
			) : (
				<div className="flex min-h-0 grow flex-col gap-4 overflow-hidden bg-canvas p-6">
					<p className="text-body text-ink">
						Three customers are outstanding: Northwind, Contoso and Fabrikam,
						for $6,290 in total. The write-up is open in the canvas.
					</p>
				</div>
			)}
		</div>
	);
};

/**
 * The chrome state the app would have on the operator's own platform.
 *
 * The lane is `display: none` until `styles/index.css`'s `[data-chrome-mode=
 * "integrated"]` gate matches, and the attributes that gate it are set on the
 * document element by the MAIN process from `platform-info` - which Storybook has
 * no main process for, so without this the lane is absent and a frame cannot show
 * the edge it decides (design review round 1, D2). The values are the app's own,
 * measured on this machine and recorded in the lane's `app-facts.json`:
 * `integrated`, `mac`, leading traffic lights, no trailing controls, which is the
 * 32px strip the dock's ground has to be continuous with.
 */
const useMacChrome = (enabled = true) => {
	useLayoutEffect(() => {
		if (!enabled) return;
		const root = document.documentElement;
		root.dataset.chromeMode = "integrated";
		root.dataset.chromePlatform = "mac";
		root.dataset.chromeLeading = "true";
		root.dataset.chromeTrailing = "false";
		return () => {
			delete root.dataset.chromeMode;
			delete root.dataset.chromePlatform;
			delete root.dataset.chromeLeading;
			delete root.dataset.chromeTrailing;
		};
	}, [enabled]);
};

/*
 * The route facts, inline rather than the store's `EMPTY_RIGHT_SLOT_ROUTE`
 * constant, DELIBERATELY: the before half of this change's evidence pair swaps
 * IF `origin/main`'s store module under these stories (see
 * `docs/evidence/shell-app-shell/slot-release-before/README.md`), and an import the old module
 * does not export would fail that bundle. The extra `rightSlotRoute` key is
 * inert on the old store - its reader never looks at it - which is exactly what
 * makes the pair the same scene under two readers.
 */
const EMPTY_ROUTE = {
	mounted: false,
	runDetails: false,
	session: false,
} as const;

/*
 * A route every right-slot pane can draw on: the three facts the app's own
 * `chat-content` publishes on a conversation route (`mounted`, `runDetails`,
 * `session` all true). These arms mount the dock directly rather than through
 * `chat-content`, the app's only publisher, so they STATE the route they
 * simulate - without it the slot's derivation would answer 0 for a pane the
 * story is showing, and the lane above the dock would photograph a stop the
 * app does not draw.
 */
const DRAWABLE_ROUTE = {
	mounted: true,
	runDetails: true,
	session: true,
} as const;

/**
 * THE WINDOWS/LINUX CAPTION-BUTTON STATE, SIMULATED - NOT PHOTOGRAPHED (#872).
 *
 * The OS draws its caption buttons into the window's top-right corner only on
 * Windows and on a trailing Linux layout, and this host is macOS: no frame taken
 * here can show them. What a frame CAN show is the layout's answer to them, because
 * everything the app does about them is CSS reading three document facts - the
 * integrated/trailing attributes and the two insets `styles/index.css` derives from
 * `env(titlebar-area-*)` - which Storybook has no WCO rect to feed. So this sets the
 * attributes and OVERRIDES the two insets with the values a default Windows window
 * reports (a ~138px by 40px caption area, `src/shared/window-chrome.ts`). The frame
 * is the layout under that input; it is not the buttons, which are Electron's own
 * views and cannot be drawn by a story. Every frame that uses it is filed as a
 * simulation in the evidence README.
 */
const useWindowsChromeSimulation = (enabled: boolean) => {
	useLayoutEffect(() => {
		if (!enabled) return;
		const root = document.documentElement;
		root.dataset.chromeMode = "integrated";
		root.dataset.chromePlatform = "win";
		root.dataset.chromeLeading = "false";
		root.dataset.chromeTrailing = "true";
		root.style.setProperty("--chrome-inset-end", "138px");
		root.style.setProperty("--chrome-inset-end-h", "40px");
		/*
		 * A LABELLED BLOCK WHERE THE BUTTONS WOULD BE (design round 1, D6): the
		 * clearance is a claim about a region no frame can otherwise show, so the
		 * region is drawn - 138 x 40, top-right, translucent, named - and the 94px
		 * reservation and the rail's top strut read against it. It paints nothing the
		 * app draws (the OS owns those pixels) and it is `pointer-events: none`, so it
		 * cannot change a measurement; it exists only in a simulation frame.
		 */
		const block = document.createElement("div");
		block.setAttribute("data-simulated-caption-buttons", "");
		block.setAttribute("aria-hidden", "true");
		Object.assign(block.style, {
			position: "fixed",
			top: "0",
			right: "0",
			width: "138px",
			height: "40px",
			zIndex: "2147483647",
			pointerEvents: "none",
			background: "rgba(255, 0, 128, 0.18)",
			outline: "1px dashed rgba(255, 0, 128, 0.9)",
			outlineOffset: "-1px",
			font: "600 9px/40px system-ui, sans-serif",
			whiteSpace: "nowrap",
			overflow: "hidden",
			color: "rgba(255, 0, 128, 1)",
			textAlign: "center",
		});
		block.textContent = "SIMULATED 138x40";
		document.body.appendChild(block);
		return () => {
			block.remove();
			root.style.removeProperty("--chrome-inset-end");
			root.style.removeProperty("--chrome-inset-end-h");
			delete root.dataset.chromeMode;
			delete root.dataset.chromePlatform;
			delete root.dataset.chromeLeading;
			delete root.dataset.chromeTrailing;
		};
	}, [enabled]);
};

const ChatShellFrame: FC<{
	/**
	 * The dock, rendered at the width the app's own slot resolves for this frame's
	 * row. A render prop rather than a literal because the story mounts the REAL
	 * `ChatLayout`, so the lane above the dock is painted from
	 * `resolveRightSlotWidth` — and a pane drawn at any other width would photograph
	 * a boundary the app does not draw (the defect the pane-slot guard's own note
	 * records: a harness copy of a removed seam). The width the two arms used to
	 * pass (`560`, `420`) was a literal the app never draws at the capture's 1280px
	 * frame; the dock now draws at the app's number for the row it is in.
	 *
	 * The row's own width rides along because the pane's SEPARATOR is built from
	 * it: the browser and console arms render the pane's real divider through
	 * `rightSlotDividerContract` (the function `chat-content.tsx` itself passes
	 * the row's capacity to), so what those arms announce is what the app
	 * announces.
	 */
	pane?: (slotWidth: number, rowWidth: number) => ReactNode;
	/**
	 * The conversation's run details, or null for a DRAFT - which has none in the
	 * app, so `RunDetailsTrigger` renders nothing there. The draft arms pass null
	 * so a frame of the released slot does not show a pressed trigger for a pane
	 * that cannot open (design review round 1, D2).
	 */
	details: ReturnType<typeof deriveRunDetails> | null;
	/** The rail's attention marks, for the arms that photograph them. */
	railProps?: {
		browserAttentionCount?: number;
		consoleUnseenCount?: number;
		fileCount?: number;
		/** Offer the asks item on the rail (#896); see `ShellStoryRail`. */
		askOffered?: boolean;
		askCount?: number;
	};
	/** The asks this shell simulates: above 0 the header's `...` menu gains its
	 * asks row and, unless `railProps` says otherwise, the rail offers the item
	 * with this count (#896). */
	asksCount?: number;
	/** Render the Windows caption-button layout instead of macOS's (simulated). */
	windows?: boolean;
	/** The conversation column's content; see `ConversationStandIn`'s `body`. */
	body?: ReactNode;
}> = ({
	pane,
	details,
	railProps = {},
	asksCount = 0,
	windows = false,
	body,
}) => {
	useFixtureFetch();
	useMacChrome(!windows);
	useWindowsChromeSimulation(windows);

	/*
	 * The row the pane shares with the conversation, measured — the same quantity
	 * `chat-content.tsx` measures for its own resolver call, and 0 for the frame
	 * before this layout effect, which the resolver reads as "not measured yet".
	 */
	const rowRef = useRef<HTMLDivElement | null>(null);
	const [rowWidth, setRowWidth] = useState(0);
	useLayoutEffect(() => {
		const row = rowRef.current;
		if (!row) return;
		const measure = () => setRowWidth(row.getBoundingClientRect().width);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(row);
		return () => observer.disconnect();
	}, []);
	const slotWidth = useUiPreferencesStore((state) =>
		resolveRightSlotWidth(rowWidth, state),
	);

	/*
	 * The app's own shell root, and it is load-bearing rather than tidy:
	 * `app.tsx` wraps the layout in `relative flex h-screen flex-col
	 * overflow-hidden`, and `ChatLayout`'s root is `flex-1` - a flex property,
	 * which does nothing at all outside a flex parent. Without this wrapper the
	 * story's columns fall back to their CONTENT height, the rail's `bg-surface`
	 * stops mid-frame and the page's `canvas` shows underneath it, which is a
	 * ground pair the app never draws.
	 */
	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			<ChatLayout
				sidebar={<SidebarNavigation />}
				content={
					<main className="flex min-w-0 grow flex-col overflow-hidden">
						<div
							ref={rowRef}
							data-tour-tag="pane-row"
							className="flex h-full min-h-0 w-full overflow-hidden"
						>
							<ConversationStandIn
								details={details}
								railProps={railProps}
								asksCount={asksCount}
								body={body}
							/>
							{pane?.(slotWidth, rowWidth)}
						</div>
						<ShellStoryRail
							details={details}
							railProps={{
								...railProps,
								/* The simulated asks offered on the rail (#896): `asksCount` is the
								   coarse knob, and an arm with a drawer holding the slot says so
								   precisely through `railProps`. */
								askOffered: railProps.askOffered ?? asksCount > 0,
								askCount: railProps.askCount ?? asksCount,
							}}
						/>
					</main>
				}
			/>
		</div>
	);
};

/**
 * The dock in its Files view, at the slot's one default pane width.
 *
 * `rightSlotWidth` is a story ARG (default 0, the fresh-profile arm this story
 * has always shown) rather than a literal because the #677 evidence needs the
 * DRAGGED state photographed from head: `?args=rightSlotWidth:700` is the
 * shared-width arm, and at the capture geometry (row 1180) the canvas reads its
 * 560 cap there — a state the committed story could not produce while this
 * literal said 0.
 */
export const ChatDockFiles: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			useCanvasStore.setState((state) => ({
				conversations: {
					...state.conversations,
					[DOCK_CONVERSATION_ID]: {
						isOpen: true,
						files: DOCK_DOCUMENTS,
						mentionedFiles: DOCK_DOCUMENTS,
						openTabs: [],
						selectedTabId: null,
						viewMode: "files",
						spreadsheetData: {},
					},
				},
			}));
			/*
			 * The pane's OPEN STATE lives in the preferences store, and the lane above
			 * the dock reads it through the same resolver the pane does - so a story
			 * that mounted the dock without claiming the slot would photograph a lane
			 * painted for no pane (and a lane stop of 0). The width is the store's own
			 * default: the story states which pane is up, not a number the app decides.
			 */
			useUiPreferencesStore.setState({
				isCanvasOpen: true,
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isCanvasOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.settled())}
				pane={(slotWidth) => (
					<PaneSlot width={slotWidth} tourTag="canvas-dock">
						<Canvas
							activeDocumentId={undefined}
							initialDocuments={DOCK_DOCUMENTS}
							conversationId={DOCK_CONVERSATION_ID}
							agentId="shell-story-agent"
							fileCount={DOCK_DOCUMENTS.length}
							onChangeActiveDocument={() => undefined}
							onClose={() => undefined}
							onCloseDocument={() => undefined}
						/>
					</PaneSlot>
				)}
			/>
		);
	},
};

/**
 * WINDOWS CAPTION CLEARANCE, SIMULATED (#872): the rail with NO pane open, so the
 * chat header is the row that reaches the rail's left edge. The two things the
 * change protects are both in this frame: the rail's first item starts BELOW the
 * 40px caption area, and the header's action cluster stops 94px (138 - 44) short of
 * the window's edge rather than 138, because the rail already covers 44 of the
 * buttons' width. Since #896 the asks door is one of the rail's items (its second),
 * so the simulation offers it - `asksCount` below - and the header's own row is the
 * `...` menu alone. A simulation: the buttons themselves are Electron's views and
 * cannot be photographed on this host.
 */
export const WindowsCaptionNoPane: Story = {
	render: () => {
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({ rightSlotRoute: DRAWABLE_ROUTE });
			return () =>
				useUiPreferencesStore.setState({ rightSlotRoute: EMPTY_ROUTE });
		}, []);
		return (
			<ChatShellFrame
				windows
				asksCount={3}
				details={deriveRunDetails(runFixtures.settled())}
			/>
		);
	},
};

/**
 * The same simulation with the browser pane OPEN: the pane's own toolbar is the row
 * that reaches the rail, so its close control must stop 94px short of the window's
 * edge (the rail covers the rest), not 138 (the old reservation, which pushed the
 * close button 44px further in for nothing).
 */
export const WindowsCaptionPaneOpen: Story = {
	render: () => {
		useEmptyBridges();
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isBrowserPaneOpen: true,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isBrowserPaneOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, []);
		return (
			<ChatShellFrame
				windows
				details={deriveRunDetails(runFixtures.settled())}
				pane={(slotWidth) => (
					<PaneSlot width={slotWidth} tourTag="browser-pane-slot">
						<BrowserPane sessionId="a1b2c3d4e5f6" onClose={() => undefined} />
					</PaneSlot>
				)}
			/>
		);
	},
};

/**
 * WINDOWS CAPTION CLEARANCE ON A ROUTE WITH NO RAIL, SIMULATED (#872): the fleet
 * asks drawer on settings. The rail exists only where a chat surface is mounted, so
 * here nothing else stands at the window's edge and the drawer's toolbar is the row
 * the OS buttons sit over: it must keep the FULL 138px reservation, not the 94px the
 * rail's presence earns on a chat route. `chat-layout.tsx` publishes
 * `--chrome-inset-end-pane` as the inset less the rail's actual width (0 here), and
 * `scripts/titlebar-options.test.mjs` pins that arithmetic; this frame is the layout
 * under it. A simulation, for the reason `useWindowsChromeSimulation` gives.
 */
export const WindowsCaptionFleetAsksOnSettings: Story = {
	render: () => {
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				askDrawerScope: "fleet",
			});
			return () => {
				useUiPreferencesStore.setState({
					isAskDrawerOpen: false,
					askDrawerScope: "session",
				});
			};
		}, []);
		return (
			<ShellFrame windows>
				<SettingsPage />
			</ShellFrame>
		);
	},
};

/**
 * The dock in its run-details sub-view - the other shape the report named.
 *
 * The width is an ARG for the same reason `ChatDockFiles`' is: the #677
 * evidence photographs the shared-width arm (`?args=rightSlotWidth:700` — the
 * run pane reads the full 700 at row 1180) against this story's 0, where the
 * run pane reads the slot's one default (640). That pair is what shows switching
 * surfaces stops resizing.
 */
export const ChatDockRunPanel: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isRunPanelOpen: true,
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isRunPanelOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.bothInFlight())}
				pane={(slotWidth, rowWidth) => {
					/*
					 * THE PANE'S OWN SEPARATOR, through the app's shared contract. The run
					 * pane's divider exists whenever the pane is open (the app renders it
					 * unconditionally), and its range collapses where the row cannot host
					 * the pane's own 320px floor; the 320/640 are the range `chat-content.tsx`
					 * declares for this pane.
					 */
					const divider = rightSlotDividerContract({
						capacity: Math.max(0, rowWidth - CHAT_PANE_MIN_PX),
						min: 320,
						max: 640,
						drawn: slotWidth,
					});
					return (
						<>
							<ResizableDivider
								sidebarWidth={divider.value}
								onSidebarWidthChange={() => undefined}
								minWidth={divider.minWidth}
								maxWidth={divider.maxWidth}
								side="left"
								label="Resize run details. Double-click resets the shared pane width."
							/>
							<PaneSlot width={slotWidth} tourTag="run-panel-dock">
								<RunPanel
									details={deriveRunDetails(runFixtures.bothInFlight())}
									mcpServers={deriveMcpServers([], {}, [])}
									mcpGrantRunning={mcpGrantInFlight([])}
									mcpRemedy={INERT_REMEDY}
									monitorControls={INERT_MONITOR_CONTROLS}
									sessionId="a1b2c3d4e5f6"
									pulses={{}}
									childrenOpenable
									/* No session stream behind this board: the transport-up case. */
									olderTransportDown={false}
									paneWidth={slotWidth}
									readerChildId={null}
									previewPage={null}
									onReaderChildChange={() => undefined}
									onClose={() => undefined}
								/>
							</PaneSlot>
						</>
					);
				}}
			/>
		);
	},
};

/*
 * THE CONVERSATION COLUMN'S EDGES, IN THE SHELL (#895).
 *
 * WHY IT EXISTS. The question #895 asks is not about the transcript alone: it is
 * what sits at the column's edges when the column shares a row with the sidebar
 * divider and, with a panel open, the panel divider. The two arms mount the REAL
 * `CanonicalTranscript` inside the REAL `ChatLayout` (so the sidebar's divider is
 * the app's own) and, for the panel arm, the same `ResizableDivider` + `PaneSlot`
 * pair `chat-content.tsx` mounts for the run panel. The rows are the ordinary
 * mix (an answer, three tool rows), so the column is the width the measure
 * allows rather than the width of a short line.
 *
 * THE BEFORE HALF IS A COMMIT, NOT A FLAG. These arms were added by #895 before the
 * handles were removed, passing the chat page's own `measureHandle` so the
 * transcript mounted them as the app did; the BEFORE frames in
 * `docs/evidence/chat-measure-handles-removed/before/` were taken from that
 * commit's tree. The removal commit drops the prop (it no longer exists), so
 * these arms show the app as it is now. `scripts/chat-measure-handles-removed-
 * evidence.mjs` drives both trees unchanged, which is the pairing.
 */
const MEASURE_SEED_AT = 1_760_000_000_000;
const MEASURE_SAMPLE =
	"The constraint is a single number, so the first thing to settle is what it is for. A reading measure exists to stop a line of prose from running wider than the eye can carry, and the guidance most typographers quote for that is between forty-five and seventy-five characters. This surface is not a reading pane, though, and the difference is not a quibble: it is a ledger.";

const measureStoryTranscript = (): TranscriptState => {
	const tool = (
		id: string,
		toolName: string,
		args: Record<string, unknown>,
	): TranscriptRecord => ({
		kind: "tool",
		id,
		ts: MEASURE_SEED_AT,
		toolCallId: id,
		toolName,
		intent: null,
		args,
		phase: "done",
		argumentBytes: 0,
		output: "ok",
		isError: false,
		notRunReason: null,
		notRunKind: null,
		neverSent: false,
		durationS: 0.4,
		startedAt: null,
		endedAt: null,
		images: [],
		added: 0,
		removed: 0,
		diff: null,
		stopped: false,
	});
	const records: TranscriptRecord[] = [
		{
			kind: "assistant",
			id: "m1",
			ts: MEASURE_SEED_AT,
			text: MEASURE_SAMPLE,
			streaming: false,
			complete: true,
			stopReason: null,
			error: false,
		},
		tool("t1", "read", { path: "src/renderer/src/styles/index.css" }),
		tool("t2", "bash", { command: "pnpm check-types" }),
		tool("t3", "edit", {
			path: "src/renderer/src/features/chat/chat-measure.ts",
		}),
	];
	return {
		...EMPTY_TRANSCRIPT,
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
	};
};

const MeasureTranscriptBody: FC = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	const transcript = useMemo(measureStoryTranscript, []);
	return (
		<CanonicalTranscript
			transcript={transcript}
			gate={null}
			waiting={false}
			starting={false}
			startingAfterId={null}
			loadingOlder={false}
			onLoadOlder={async () => true}
			containerRef={containerRef}
			isSmallView={false}
			status={"live" as const}
			failure={null as SessionFailureNotice | null}
			awaitingHydration={false}
			onReconnect={() => undefined}
		/>
	);
};

/**
 * The conversation alone: the column's left strip sat beside the sidebar divider.
 *
 * It carries run details (a saved conversation, not a draft) so the panel rail
 * is on screen and takes its 44px from the row, as it does in the app - the
 * transcript container is then 876px wide at a 1180px window, the number the
 * issue's geometry is stated at.
 */
export const ChatMeasureEdges: Story = {
	render: () => {
		/*
		 * The rail is reserved only while a chat surface is mounted, and these arms
		 * mount the dock directly rather than through `chat-content` (the app's one
		 * publisher of that fact), so the story states it - with no pane open.
		 */
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({ rightSlotRoute: DRAWABLE_ROUTE });
			return () => {
				useUiPreferencesStore.setState({ rightSlotRoute: EMPTY_ROUTE });
			};
		}, []);
		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.bothInFlight())}
				body={<MeasureTranscriptBody />}
			/>
		);
	},
};

/**
 * The run panel open at its default width: the column's right strip sat beside the
 * panel's own divider, 8px from it.
 */
export const ChatMeasureEdgesRunPanel: Story = {
	render: () => {
		/* The write the arm's divider performs, through the app's own setter. */
		const setRightSlotWidth = useUiPreferencesStore(
			(state) => state.setRightSlotWidth,
		);
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isRunPanelOpen: true,
				rightSlotWidth: 0,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isRunPanelOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, []);
		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.bothInFlight())}
				body={<MeasureTranscriptBody />}
				pane={(slotWidth) => (
					<>
						{/*
						 * The pair chat-content.tsx mounts, with ITS bounds rather than a
						 * literal: `RUN_PANEL_MIN_PX` is the range's floor (420 is the pane's
						 * DEFAULT width, and restating it as a floor announced a contract the
						 * app does not have), `RUN_PANEL_MAX_PX` its ceiling, and both writes go
						 * through the store's own setter exactly as the app's
						 * `handleRunPanelWidthChange` / `handleRunPanelWidthReset` do - a reset
						 * being a drag to UNSET rather than to a stored number (design review
						 * round 1, D1; QA round 1, Q1).
						 *
						 * The slot carries no `minWidth` for the same reason the app's own mount
						 * does not pass one: `min-width: 420` pinned the pane to its DEFAULT width,
						 * so a drag to the floor the divider now announces rendered 420 anyway -
						 * a promise the range could not keep (`RUN_PANEL_MIN_PX`'s own note states
						 * the rule). The ceiling is stated raw here; the app narrows it by the
						 * row's capacity (`Math.min(RUN_PANEL_MAX_PX, runPanelCapacity)`), and at
						 * this frame's 1512px row the capacity is 728, so 640 is the value both
						 * mounts use.
						 */}
						<ResizableDivider
							sidebarWidth={slotWidth}
							onSidebarWidthChange={setRightSlotWidth}
							minWidth={RUN_PANEL_MIN_PX}
							maxWidth={RUN_PANEL_MAX_PX}
							side="left"
							onDoubleClick={() => setRightSlotWidth(0)}
							label="Resize run details. Double-click resets the shared pane width."
						/>
						<PaneSlot width={slotWidth} tourTag="run-panel-dock">
							<RunPanel
								details={deriveRunDetails(runFixtures.bothInFlight())}
								mcpServers={deriveMcpServers([], {}, [])}
								mcpGrantRunning={mcpGrantInFlight([])}
								mcpRemedy={INERT_REMEDY}
								monitorControls={INERT_MONITOR_CONTROLS}
								sessionId="a1b2c3d4e5f6"
								pulses={{}}
								childrenOpenable
								olderTransportDown={false}
								paneWidth={slotWidth}
								readerChildId={null}
								previewPage={null}
								onReaderChildChange={() => undefined}
								onClose={() => undefined}
							/>
						</PaneSlot>
					</>
				)}
			/>
		);
	},
};

/*
 * THE ASKS DRAWER IN THE SHELL (design round 1, D4): the `chat-dock-files` sibling.
 *
 * WHY IT EXISTS. The drawer's own evidence set photographs it at 560x640 in a bare
 * column, and the band frames photograph a bespoke composition of composer + drawer
 * - so the two facts its placement turns on were never shown where they happen: the
 * chrome bar as the row that reaches the WINDOW's top-right (the pane's own corner
 * reservation), and the drawer's card beside the conversation it is answering for.
 * The canvas family already has this frame (`ChatDockFiles`), and this is the same
 * mount for the same reason: the REAL `ChatLayout` and the REAL slot resolver, with
 * only the pane's own open state seeded, so the lane above the dock is painted from
 * `resolveRightSlotWidth` rather than from a literal.
 *
 * The fixtures are the drawer's own shape - a queued ask, one that timed out and is
 * still answerable, and a settled one - so the frame shows a card, a moved-on card
 * and the collapsed settled section in one picture.
 */
const ASK_TS = 1_760_000_000_000;
const ASK_MINUTE = 60_000;
/** The drawer's stories' own pinned clock, so the countdowns read the same. */
const ASK_NOW = ASK_TS + 12 * ASK_MINUTE;

const dockAsk = (
	over: Partial<PendingAsk> & { ask_id: string },
): PendingAsk => ({
	created_at: ASK_TS,
	expires_at: ASK_TS + 60 * ASK_MINUTE,
	timeout_s: 3600,
	urgent: false,
	status: "open",
	delivered: false,
	questions: [],
	...over,
});

const DOCK_ASKS: PendingAsk[] = [
	dockAsk({
		ask_id: "a-dock-1",
		questions: [
			{
				id: "target",
				question: "Which environment should I deploy this to?",
				/*
				 * THE WIRE'S REAL KEY SET: an option is exactly `{label, description}`
				 * (the core's `AskOption` forbids extras) and the recommendation is a
				 * QUESTION-level index into `options` as carried. The per-option
				 * `recommended: true` this fixture used to carry is residue of the defect
				 * `ask-recommended.tsx` records - a key no producer writes.
				 */
				options: [
					{ label: "staging", description: "The shared pre-prod cluster" },
					{ label: "production", description: "Live traffic" },
				],
				recommended: 0,
				multi: false,
			},
		],
	}),
	dockAsk({
		ask_id: "a-dock-2",
		status: "timed_out",
		expires_at: ASK_TS - ASK_MINUTE,
		questions: [
			{
				id: "files",
				question: "Which files should the cleanup script touch?",
				options: [{ label: "logs only" }, { label: "logs and caches" }],
			},
		],
	}),
	dockAsk({
		ask_id: "a-dock-3",
		status: "declined",
		questions: [
			{
				id: "target",
				question: "Should I also rotate the deploy token while I am here?",
				options: [{ label: "yes" }, { label: "no" }],
			},
		],
	}),
];

/** The shell with the asks drawer in the right slot, at the width the app resolves. */
export const ChatDockAsks: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			/*
			 * The DRAWER's own open state, claimed through the store rather than a prop:
			 * the lane above the dock reads the same flag (`resolveRightSlotWidth`), so a
			 * story that mounted the pane without claiming the slot would photograph a
			 * lane painted for no pane.
			 */
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isAskDrawerOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.settled())}
				pane={(slotWidth) => (
					<PaneSlot width={slotWidth} tourTag="ask-drawer-slot">
						<AskDrawer
							frontend={{
								asks: DOCK_ASKS,
								asks_open: 2,
								asks_truncated: false,
							}}
							scope="session"
							onClose={() => undefined}
							nowMs={ASK_NOW}
							onAnswer={() => undefined}
							onDecline={() => undefined}
						/>
					</PaneSlot>
				)}
			/>
		);
	},
};

/*
 * #872: THE PANEL RAIL BESIDE THE TWO PANES THAT HAD NO SHELL ARM, AND THE ASKS
 * DRAWER COVERING ONE OF THEM.
 *
 * The browser and the console are the slot's other two occupants and neither was
 * photographed in the shell, so the rail's lit item was only ever shown for the
 * canvas family and the run panel. Both arms mount the real pane at the width the
 * app's own resolver gives it for the frame's row, with the bridge the pane reads
 * stubbed to an EMPTY projection (no tabs, no surfaces): what these frames are a
 * claim about is the slot and the rail, not the pane's body.
 *
 * THE NARROW PAIR IS THE SAME ARM AT TWO WINDOWS, not two arms: at 1192 the row
 * is 1192 - 260 - 44 = 888 and the pane is `888 - 480` = 408; at 1180 it is 396.
 * (The issue says 408 at 1180; the arithmetic puts it at 1192.) The capture rows
 * carry the window sizes.
 */
const useEmptyBridges = () => {
	useLayoutEffect(() => {
		const bridge = window as unknown as { api?: Record<string, unknown> };
		bridge.api = bridge.api ?? {};
		const noop = () => Promise.resolve({});
		bridge.api.browser = {
			state: async () => ({
				tabs: [],
				activeTabId: null,
				url: "",
				title: "",
				loading: false,
				canGoBack: false,
				canGoForward: false,
				pendingConsent: [],
				approvals: [],
				navFailure: null,
			}),
			onStateChanged: () => () => {},
			onConsentChanged: () => () => {},
			onConsentAttention: () => () => {},
			setContentRect: noop,
			setViewVisible: noop,
		};
		bridge.api.console = {
			state: async () => ({
				available: true,
				total: 0,
				agent: 0,
				displayed_surface: null,
				surfaces: [],
			}),
			createSurface: noop,
			openPane: noop,
			closePane: noop,
			selectSurface: noop,
			input: noop,
			keys: noop,
			setContentRect: noop,
			setSecure: noop,
			subscribe: noop,
			unsubscribe: noop,
			onOutput: () => () => {},
			onExit: () => () => {},
			onReveal: () => () => {},
			onStateChanged: () => () => {},
		};
	}, []);
};

/** The shell with the browser pane in the right slot, a badge on its rail item. */
export const ChatDockBrowser: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useEmptyBridges();
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isBrowserPaneOpen: true,
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isBrowserPaneOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.settled())}
				railProps={{ browserAttentionCount: 2 }}
				pane={(slotWidth, rowWidth) => {
					/*
					 * THE PANE'S OWN SEPARATOR, through the app's shared contract and
					 * the app's own capacity subtraction (`chat-content.tsx` builds
					 * its browser contract from `paneRowWidth - CHAT_PANE_MIN_PX`,
					 * and this arm reads the same row the resolver above does). The
					 * 1200 is the pane's shipped drag ceiling - a fixture edge, like
					 * the frames' own.
					 */
					const divider = rightSlotDividerContract({
						capacity: Math.max(0, rowWidth - CHAT_PANE_MIN_PX),
						min: BROWSER_PANEL_MIN_PX,
						max: 1200,
						drawn: slotWidth,
					});
					return (
						<>
							<ResizableDivider
								sidebarWidth={divider.value}
								onSidebarWidthChange={() => undefined}
								minWidth={divider.minWidth}
								maxWidth={divider.maxWidth}
								side="left"
								label="Resize browser. Double-click resets the shared pane width."
							/>
							<PaneSlot width={slotWidth} tourTag="browser-pane-slot">
								<BrowserPane
									sessionId="a1b2c3d4e5f6"
									onClose={() => undefined}
								/>
							</PaneSlot>
						</>
					);
				}}
			/>
		);
	},
};

/** The shell with the console pane in the right slot, a blip on its rail item. */
export const ChatDockConsole: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useEmptyBridges();
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isConsolePaneOpen: true,
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isConsolePaneOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.settled())}
				railProps={{ consoleUnseenCount: 1 }}
				pane={(slotWidth, rowWidth) => {
					// The browser arm's own comment states the wiring; the console's
					// contract differs only in its floor and its selector.
					const divider = rightSlotDividerContract({
						capacity: Math.max(0, rowWidth - CHAT_PANE_MIN_PX),
						min: CONSOLE_PANEL_MIN_PX,
						max: 1200,
						drawn: slotWidth,
					});
					return (
						<>
							<ResizableDivider
								sidebarWidth={divider.value}
								onSidebarWidthChange={() => undefined}
								minWidth={divider.minWidth}
								maxWidth={divider.maxWidth}
								side="left"
								label="Resize console. Double-click resets the shared pane width."
							/>
							<PaneSlot width={slotWidth} tourTag="console-pane-slot">
								<ConsolePane
									sessionId="a1b2c3d4e5f6"
									onClose={() => undefined}
								/>
							</PaneSlot>
						</>
					);
				}}
			/>
		);
	},
};

/**
 * The asks drawer HOLDING the slot it borrowed from the browser pane: the rail
 * lights the ASKS item, and nothing else (#896 - the lit item IS the answer; before
 * the move this state lit nothing on the rail and the header carried the only sign
 * of what was open). The browser's flag is down and `askDrawerEvictedPane` records
 * the borrow, which is exactly the state in which lighting the covered pane would
 * say something false; pressing any other item is a swap, and pressing the lit ask
 * item closes its own drawer.
 */
export const ChatDockAsksCoveringBrowser: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				askDrawerScope: "session",
				isBrowserPaneOpen: false,
				askDrawerEvictedPane: "isBrowserPaneOpen",
				rightSlotWidth,
				rightSlotRoute: DRAWABLE_ROUTE,
			});
			return () => {
				useUiPreferencesStore.setState({
					isAskDrawerOpen: false,
					askDrawerEvictedPane: null,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return (
			<ChatShellFrame
				details={deriveRunDetails(runFixtures.settled())}
				/* The door the drawer is holding the slot for (#896): offered with the
				   count the fixture's `asks_open` states, so the lit item's badge agrees
				   with the drawer's own tally. */
				railProps={{ askOffered: true, askCount: 2 }}
				pane={(slotWidth) => (
					<PaneSlot width={slotWidth} tourTag="ask-drawer-slot">
						<AskDrawer
							frontend={{
								asks: DOCK_ASKS,
								asks_open: 2,
								asks_truncated: false,
							}}
							scope="session"
							onClose={() => undefined}
							nowMs={ASK_NOW}
							onAnswer={() => undefined}
							onDecline={() => undefined}
						/>
					</PaneSlot>
				)}
			/>
		);
	},
};

/*
 * #868: THE CLAIM THAT OUTLIVED ITS ROUTE.
 *
 * The pane flags persist across routes on purpose, so the state these two arms
 * photograph is the operator's own captured sequence: the asks drawer closes
 * and hands the run panel's flag back (or the drawer's own flag stays up), then
 * the user is on a draft - a route with no run details and no conversation, so
 * neither pane can mount. The slot's readers must answer from what the route
 * can DRAW: no elevated band over the empty column, no reserved corner, and the
 * lane's stop on the conversation's own right edge.
 *
 * The before half of each pair is the same story under `origin/main`'s store
 * module, which reads the bare flag - see
 * `docs/evidence/shell-app-shell/slot-release-before/README.md` for the recipe
 * and the numbers, and `scripts/capture-evidence.mjs`'s rows for the claims
 * asserted at shutter time.
 */
export const ChatDockRunPanelOnDraft: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			/*
			 * The run panel's flag, still up, on a route that cannot draw it - the
			 * drawer's close handed it back. No pane mounts (the draft's own
			 * `runDetails` is null in the app), which is the point.
			 */
			useUiPreferencesStore.setState({
				isRunPanelOpen: true,
				rightSlotWidth,
				rightSlotRoute: { mounted: true, runDetails: false, session: false },
			});
			return () => {
				useUiPreferencesStore.setState({
					isRunPanelOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		// A draft has no run details, so the header draws no trigger (D2).
		return <ChatShellFrame details={null} />;
	},
};

/** The same state for the drawer's own flag: open on a session scope, with no session to show it in. */
export const ChatDockAsksOnDraft: Story = {
	args: { rightSlotWidth: 0 },
	render: (args) => {
		const { rightSlotWidth = 0 } = args as { rightSlotWidth?: number };
		useLayoutEffect(() => {
			useUiPreferencesStore.setState({
				isAskDrawerOpen: true,
				askDrawerScope: "session",
				rightSlotWidth,
				rightSlotRoute: { mounted: true, runDetails: false, session: false },
			});
			return () => {
				useUiPreferencesStore.setState({
					isAskDrawerOpen: false,
					rightSlotRoute: EMPTY_ROUTE,
				});
			};
		}, [rightSlotWidth]);

		return <ChatShellFrame details={null} />;
	},
};
