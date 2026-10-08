/**
 * The screenshot library's scenes, rendered from the REAL desktop components.
 *
 * WHY THIS FILE EXISTS. The marketing site, the core repo README and the UI
 * repo README all need current-UI stills of the surfaces a user meets, and the
 * one hero scene beside it (`docs-hero.stories.tsx`) covers only the app shell.
 * This file stages the rest as stories so every frame comes from the same
 * pipeline: the real `SidebarNavigation`, the real canonical transcript, the
 * real run pane, the real pages (Projects, Schedules, Agent hub, Mesh, Agents
 * and teams, Appearance) over fixtures, never a redrawn copy of them.
 *
 * ONE FICTIONAL WORLD, as the docs hero established it: a March invoicing
 * workspace (Northwind Traders / Contoso / Fabrikam), teams `release-crew` and
 * `docs-pod`, agents `coder` / `reviewer` / `architect`. Every fixture here
 * reads as a working session in that world - no placeholder names, no lorem.
 *
 * WHAT IS STUBBED. `window.api.desktop.request` (the preload bridge every
 * page already reads) and, where a page still reaches REST, `window.fetch`.
 * An op a scene has not answered is refused BY NAME, so a story that starts
 * issuing a new call fails loudly instead of hanging on a promise nothing
 * resolves.
 *
 * CAPTURE. Headless Chrome over CDP through the session's own rig, at
 * 1280x900 with `deviceScaleFactor: 2` (a 2560x1800 png), once per theme via
 * `&args=theme:localOperatorLight|localOperatorDark`. The scenes that stage an
 * asynchronous state (an expanded receipt, the mermaid diagram, the hub's
 * scope switch) hold the shutter with `data-capture-pending` until the state
 * they claim is actually painted.
 */

import "../../../styles/index.css";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { DesktopProject } from "../../../../../shared/desktop-control-contract";
// The shim installs window.api for every story here.
import "@features/chat/components/story-electron-shim";
import { AgentHubPage } from "@features/agent-hub/agent-hub-page";
import { AgentsPage } from "@features/agents/components/agents-page";
import { CanonicalTranscript } from "@features/chat/canonical/canonical-transcript";
import type {
	TranscriptRecord,
	TranscriptState,
} from "@features/chat/canonical/transcript-reducer";
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
import type { Message } from "@features/chat/types/message";
import { MeshPage } from "@features/mesh/mesh-page";
import { ProjectsPage } from "@features/projects/components/projects-page";
import { SchedulesPage } from "@features/schedules/components/schedules-page";
import { SettingsSection } from "@features/settings/components/settings-section";
import { ThemeSelector } from "@features/settings/components/theme-selector";
import type { ReusableTeam } from "@shared/api/local-operator/profile-hooks";
import type {
	DesktopWakeEntry,
	DesktopWakeSupervisor,
} from "@shared/api/local-operator/wakes-api";
import { ChatLayout } from "@shared/components/common/chat-layout";
import { PaneSlot } from "@shared/components/common/pane-slot";
import { MessageInput } from "@shared/components/composer/message-input";
import { PanelRail } from "@shared/components/navigation/panel-rail";
import { InPanelRailHost } from "@shared/components/navigation/panel-rail-host";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { apiConfig } from "@shared/config/api-config";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import {
	DEFAULT_RUN_PANEL_WIDTH,
	resolveRightSlotWidth,
	useUiPreferencesStore,
} from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { Contrast } from "lucide-react";
import {
	type FC,
	type ReactNode,
	type RefObject,
	useEffect,
	useLayoutEffect,
	useRef,
	useState,
} from "react";
import { Route, Routes, useNavigate } from "react-router-dom";

/* ------------------------------------------------------------------ the world */

const CONVERSATION_ID = "session/3f9c1a2b4d5e";

/**
 * The world's own clock: one anchor instant, so relative labels read as a
 * session from today whatever day the capture runs.
 */
const NOW = Date.now();
const at = (minutesAgo: number) => NOW - minutesAgo * 60_000;

/** One conversation row in `sessions.list`'s own wire field names. */
type WireRow = {
	id: string;
	name: string;
	mtime: number;
	preview: string;
	live_state: string;
	pending: string | null;
	active: boolean;
	pinned?: boolean;
	binding: { agent: string | null; team: string | null };
	status: { code: string; label: string };
	status_revision: number;
	status_epoch: string;
};

const EPOCH = "3f2a1b4c5d6e7f8091a2b3c4d5e6f708";

const row = (
	id: string,
	name: string,
	mtime: number,
	over: Partial<WireRow> = {},
): WireRow => ({
	id,
	name,
	mtime,
	preview: "",
	live_state: "attached",
	pending: null,
	active: true,
	binding: { agent: null, team: null },
	status: { code: "idle", label: "Recent" },
	status_revision: 1,
	status_epoch: EPOCH,
	...over,
});

const roster = (): WireRow[] => [
	row(
		"3f9c1a2b4d5e",
		"Reconcile the March invoices",
		Math.floor(at(2) / 1000),
		{
			status: { code: "busy", label: "Working" },
			status_revision: 3,
		},
	),
	row("7c1f2e3d4a5b", "Quarterly revenue model", Math.floor(at(120) / 1000), {
		pinned: true,
	}),
	row("5a6b7c8d9e0f", "Vendor contract renewal", Math.floor(at(40) / 1000)),
	row("1a2b3c4d5e6f", "Supplier ledger clean-up", Math.floor(at(1800) / 1000)),
	row(
		"2b3c4d5e6f70",
		"Migrate the deploy script",
		Math.floor(at(3 * 1440) / 1000),
		{
			status: { code: "complete", label: "Complete" },
			status_revision: 4,
		},
	),
	row(
		"3c4d5e6f7081",
		"Draft the incident postmortem",
		Math.floor(at(9 * 1440) / 1000),
	),
];

/** The three reusable agents the sidebar and the Agents page both list. */
const PROFILES = [
	{
		name: "coder",
		kind: "role" as const,
		source: "installed" as const,
		description:
			"Implements one scoped slice, runs the project's gates, and reports what changed and how it was verified.",
		instructions:
			"Implement exactly one bounded slice and report what changed.\n\n- Read the surrounding code before writing; follow the conventions already in the files you touch.\n- Exercise the real path before claiming it works: run the command, load the page, read the actual output.\n- Do not expand the slice. Note adjacent problems in your report rather than fixing them.",
		tools: ["bash", "read", "write", "edit", "glob", "grep"],
		effort: "inherit",
		delegate: false,
	},
	{
		name: "reviewer",
		kind: "role" as const,
		source: "installed" as const,
		description:
			"Reviews a diff for correctness, contract drift and missing evidence; posts findings with line anchors.",
		instructions:
			"Review the diff, not the author's summary of it.\n\n- Every finding names the file and line it is about, or it is not a finding.\n- Check the claims a green test cannot carry: does the change do what the ticket asked, at the boundary it names?\n- Verification claims get read against the test matrix: a pass is not evidence the feature works.",
		tools: null,
		effort: "inherit",
		delegate: false,
	},
	{
		name: "architect",
		kind: "role" as const,
		source: "installed" as const,
		description:
			"Frames structural work: the options, the trade-offs, and the one the codebase's constraints pick.",
		instructions:
			"Decide by evidence, and name the constraint that decided it.\n\n- Read the code and the design notes before proposing a shape.\n- Present the two or three approaches that survive the constraints, with the reason each was rejected or picked.\n- Prefer the reversible option when the evidence does not separate them.",
		tools: ["read", "grep", "glob"],
		effort: "inherit",
		delegate: true,
	},
];

const profile = ({
	name,
	kind,
	source,
	description,
	instructions,
	tools,
	effort,
	delegate,
}: (typeof PROFILES)[number] & { instructions: string }) => ({
	name,
	kind,
	source,
	agent_id: `agent-${name}`,
	description,
	instructions,
	tools,
	effort,
	delegate,
	seed_origin: name,
	divergent_fields: [],
});

/** The two teams the sidebar lists; the detail the rosters render. */
const TEAMS: ReusableTeam[] = [
	{
		id: "team-release-crew",
		name: "release-crew",
		description:
			"Coordinates a change from implementation through review to release.",
		manager: "architect",
		members: [
			{ role: "coder", kind: "agent", count: 2 },
			{ role: "reviewer", kind: "agent", count: 1 },
		],
		instructions:
			"One slice at a time. Implementation hands to review before QA runs, and QA's matrix is attached to the release notes.",
		project:
			"Ship the 0.62 desktop release: the scheduler fixes, the hub's org scope, and the mesh tab's move flow.",
	},
	{
		id: "team-docs-pod",
		name: "docs-pod",
		description:
			"Keeps the docs site and both READMEs current with each release.",
		manager: "coder",
		members: [{ role: "reviewer", kind: "agent", count: 1 }],
		instructions:
			"Every screenshot in the docs must be re-taken against the current build before a release is announced.",
		project: "Refresh the docs site screenshots for the 0.62 release.",
	},
];

const profileWire = (p: (typeof PROFILES)[number]) =>
	profile(p as (typeof PROFILES)[number] & { instructions: string });

/* --------------------------------------------------------------- the bridge */

type BridgeRequest = {
	op: string;
	q?: string;
	name?: string;
	[key: string]: unknown;
};

const ok = (result: unknown): DesktopResponse => ({
	status: 200,
	body: { result },
});

/**
 * The world's own payloads: everything the sidebar reads plus the reads each
 * scene's page issues. One function, so the scenes share one world rather
 * than one bridge each that could disagree about it.
 */
const installWorldBridge = () => {
	const rows = roster();
	const handler = async (request: BridgeRequest): Promise<DesktopResponse> => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						session_catalogue: 2,
						profile_catalogue: 1,
						team_catalogue: 1,
						session_pins: 1,
						session_search: 1,
						aida: 1,
						projects: 1,
						peers: 1,
					},
				});
			case "sessions.list":
				return ok({ sessions: rows, truncated: false });
			case "sessions.search": {
				const q = (request.q ?? "").toLocaleLowerCase();
				return ok({
					query: request.q ?? "",
					limit: 100,
					sessions: rows.filter((entry) =>
						entry.name.toLocaleLowerCase().includes(q),
					),
				});
			}
			case "aida.status":
				return ok({
					enabled: true,
					session_id: null,
					paused: false,
					greeted: true,
				});
			case "networks.list":
				return ok({
					self_device_id: "library-device-01",
					networks: [
						{
							network_id: "mesh-library-01",
							name: "Home mesh",
							epoch: 1,
							trust: "member",
							members: [],
						},
					],
				});
			case "profiles.list":
				return ok({ profiles: PROFILES.map(profileWire) });
			case "profiles.get": {
				const hit = PROFILES.find((p) => p.name === request.name);
				if (!hit) throw new Error(`no profile ${request.name} in this world`);
				return ok(profileWire(hit));
			}
			case "teams.list":
				return ok({
					teams: TEAMS.map((team) => ({
						id: team.id,
						name: team.name,
						description: team.description,
						manager: team.manager,
						members: [],
					})),
				});
			case "teams.get": {
				const hit = TEAMS.find((team) => team.name === request.name);
				if (!hit) throw new Error(`no team ${request.name} in this world`);
				return ok(hit);
			}
			case "projects.list":
				return ok({ projects: PROJECTS });
			case "projects.get": {
				const hit = PROJECTS.find((project) => project.id === request.key);
				if (!hit) throw new Error(`no project ${request.key} in this world`);
				return ok({
					project: { ...hit, milestones: [], updates: [], linked_sessions: [] },
				});
			}
			case "wakes.list":
				return ok({
					entries: WAKES,
					generated_at: SCHEDULES_NOW_MS,
					total: WAKES.length,
					truncated: false,
					supervisor: SUPERVISOR,
					read_error: false,
				});
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler };
};

/**
 * The REST paths some pages still read (`/v1/schedules` and `/v1/agents` for
 * the legacy schedule rows), answered the way `schedules.stories.tsx` answers
 * them; anything yet unrouted fails here rather than reaching a developer's
 * live server.
 */
const installFetch = () => {
	const origin = new URL(apiConfig.baseUrl).origin;
	const json = (body: unknown) =>
		new Response(JSON.stringify(body), {
			status: 200,
			headers: { "Content-Type": "application/json" },
		});
	const original = window.fetch;
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : input.toString();
		if (url.includes("/__desktop")) {
			const request = JSON.parse(String(init?.body ?? "{}"));
			const response = await Promise.resolve(
				(async (): Promise<DesktopResponse> => {
					// The same world bridge, reached over the fetch fallback.
					const page = window as unknown as {
						api?: {
							desktop?: {
								request: (r: BridgeRequest) => Promise<DesktopResponse>;
							};
						};
					};
					if (!page.api?.desktop) throw new TypeError("Load failed");
					return page.api.desktop.request(request);
				})(),
			);
			return json(response);
		}
		if (url.includes("/v1/schedules")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					schedules: LEGACY_SCHEDULES,
					total: LEGACY_SCHEDULES.length,
					page: 1,
					per_page: 50,
				},
			});
		}
		if (url.includes("/v1/agents")) {
			return json({
				status: 200,
				message: "ok",
				result: {
					agents: LEGACY_AGENTS,
					total: LEGACY_AGENTS.length,
					page: 1,
					per_page: 50,
				},
			});
		}
		if (url.startsWith(origin)) {
			throw new TypeError("Load failed");
		}
		return original(input, init);
	}) as typeof window.fetch;
};

/* ------------------------------------------------------------- the transcript */

/**
 * The bar chart the agent "plotted" in the media scene - a small white-ground
 * chart png produced by `scripts/make-chart.mjs`, embedded the way a real
 * tool result carries its screenshot bytes.
 */
const GENERATED_CHART_DATA =
	"iVBORw0KGgoAAAANSUhEUgAAA5gAAAHgCAIAAABPRFVvAAAQAElEQVR4nOzdeXxU1f3/8QuELQskLCEkgGyCrFFQi+IKCGgRqyJadxB3i9a1rWsXta3auqFiVdxABaUilVWxCAoqoCg7BgqRJBAkJCEEEgi/93dOOb/bmWQyASJzyOv5xzzu3Lmz3bnL+37OuXdi9u3b5wEAAACuqe0BAAAADiLIAgAAwEkEWQAAADiJIAsAAAAnEWQBAADgJIIsAAAAnESQBQAAgJMIsgAAAHASQRYAAABOIsgCAADASQRZAAAAOIkgCwAAACcRZAEAAOAkgiwAAACcRJAFAACAkwiyAAAAcBJBFgAAAE4iyAIAAMBJBFkAAAA4iSALAAAAJxFkAQAA4CSCLAAAAJxEkAUAAICTCLIAAABwEkEWAAAATiLIAgAAwEkEWQAAADiJIOuS7du3T5w4ccWKFR4AAECNV2vfvn3eTyIvL2/Tpk2bN2+OjY1NSUlJS0urV6+ehwo88sgjCxcu1MCAAQNGjx6tgdLS0uOPP/7HH3/U8Pjx408//XSvhrnqqqu0FGngxhtvPPvss70jzr/+9a8XX3xRA8nJyS+99JJ3SG3dulUvvnz58mXLlunuPffcc+mll3pHkKysrBtuuMEMP/PMM0cddZQHADjSxXjVb9asWePGjZs3b55/ZFxc3FUBSrQeQqxZs2bJkiUaOProo82Y7777zqRY+eSTT2pgkFWyLyoq0kBubq53JMrOzjY/etOmTb1DSq88fPjw9evX2zHKtRVNvHr1ak1shlu1ajV16tTatctvuikuLu7fv7/5UbzAYtmkSRPvMNm5c6eZe2bYAwDUANXbtWDXrl133HHHyJEjg1KsaOf33HPP9evXb/78+d7B+etf/5oecPXVV3sH6uOPP07fT7tnL/r07NmzZcuWZnjgwIGeCw5grl5wwQVmei0eHg6R999/36ZYLUVXXnml5nBFE5eUlPy439KlS03LQLlmzpy5ceNGO7Ge6AEA8BOq3orsbbfdptZS/xjVF9UCaEs4Grjkkkv++c9/nnDCCd6BKigoMKXKgynUKWbZemdZWZkXfWJiYubOnfvpp5927ty5Xbt2ngsOYK7qRzRPKSws9HCIfP3112age/fu06dPr1WrVuTPfeedd04++eRyHxo/frwHAMDhU40V2SlTpvhT7KOPPvrVV1+p8XH58uWqDw0YMMA+dOutt0ZnETTaxMbGDh482JUUi+ihuqkZ6N+/f5VSrLz33nvbt28PHa8S74IFCzwAAA6faqzI/uUvf/EPX3bZZf99y5iY448//vnnnx86dOjKlSu9wF72gw8+uPjii80EDz/8sIqsGjjvvPP8paD//Oc/epYZvv/+++Pj4ydMmKCmz88//9yM/P777++55x4NnHTSSb/4xS/MyN27d0+ePPnbAL1st27dunbteu6559o4+MUXX2gCvbh9o/vuu69evXrJycl33HGHHZmTk/Puu++uWbPmu+++0121zOql9DopKSl2mtLS0gceeMCUHq+++uqEhAR9r88++0y7/GOOOea00067/PLL9fWDZtSKFSveeOMNzQo9vVOnTsOGDevbt68XQi977733mhe/4oorVFo74HdctmyZZt2qVat27tzZpUsXteafeuqp48aN0xg9euKJJ1544YVeWJXOjQjnqt/vf/97fZ4tW7aYux999NG2bds0oCWnZ8+eQROraqsjpfnz5+sza3FSRV/fIi4uLmgyzR81f+vAacOGDSr/t27duk+fPmoEsJ00KqWjL5Uk9evog6WlpWm26+lm5lvPPfecXl8DmuFnnnmmWhjmzZun5U1vd9xxx91www2JiYleyAx88803Fy9evHXr1g4dOuhZlc7zUFpxJk6cqE+YmZlZv379Nm3a9OvXT2uN/+1++9vfavGw/Qo+/vhj0ztWq1uvXr0ifCMtVFdeeWXQyEmTJlX6xBkzZmhJ0G+k+aM1TguJli7/Qaz3v3NPv6PeSy0Pmj9aTnTYZqbRz63FSc0RWqK0POuTa5EYNGiQf+0LooXzww8/1A+Rl5enFUq/+5AhQzwAwJGluq5aoKhkd0LaQz/11FOh02jnqvxkhk8//XTbTKlUZBqX//SnP/m7vWqHff7555vhRYsWaR920003abcX+sra6T7yyCMa+OGHH66//nqF3dBp9JFMdFCe+M1vfhM6gWKBjcjKTHfffbftEWE1bdpUH9vGGtWV7blZjz322N/+9rfs7Gz/9ErYb731lj9ZKlhcddVVQS+r6KNQriTnBQLHE088oYG9e/faE7HHjh3785///MDeUdli1KhRQe+oOamspnq5F0jJKp97FYtkbkQyV4N07tw59DXlhRdeMBHETvC73/1OGSXo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X16/fv0uXbrExcVVNFlGRkZmZmaDBg06dOjQvHlzD4jA7t279+3bV+5DWuS0HfAi8NRTT23evPn2228/sC3G+PHjp0+ffscddxx33HG6u2zZsgkTJmj4oosu8hy0JyDC7UC5E5eVlZWUlJQ7fbk/imb+999/r+1P2wAPOBQIsnDPRx999Mwzz2zatMmOSU5OvvHGG88991yvemhjrU2wNs16I89x9957r2agBq644opbb701zJTKDW8E5OXlmTH6+qNGjbrggguCplQwveuuu7SLsmMGDhz4wAMPKK36J9u2bdv999//xRdf2DH6DKNHj44whaAm69u3b0UPvfrqq927d/ciMHfu3I0bN1533XUHFmTHjh27c+fOf/3rXybIapswa9YsBTsXg6wSuVZGDdx2222XX375gU28YMGCirYhividOnWydxV5n3jiiXfeeceOOfnkk//4xz82btzYAw4OQRaO+eyzz37zm9+Y4d69e7do0WLp0qUKtb///e9XrVr161//OsIqY5WsWLFCAU6l3zfffNNz2ccff2xSrBfIqeEn1q5rxowZGjj++ONVPlFO/eabbx555JENGzZoPtvJVBq//vrrFXY7duyotPHjjz/OmTNHO3jt5rXj9/8cf/7zn02KHTx4cHZ2tn44pWS98nnnnecBEUhLS6tTp07QSB1hej8JHa1p2R42bJjnsh07dvz1r3+dNm2auRt+OxB+Yh2a6jYpKSkhISHoifXq1fPffffdd02K1UZb02sr9Pnnnyva/uEPf/CAg0OQhUuUpUwBQPuSm266qVGjRma8tpIKSdpQduvW7ZxzzvFQnvz8fMV9DZxyyinz588PP7GKrCbFPv/88yeccIIZqb343XffrQbWkSNH2lKKZrtSrLLpQw89ZGLrJZdcorKNcury5cvT09PNZIq2enpsbOx7771nehSoPKZWWlVlTjzxxJYtW3pAZV555ZWmTZt6h8m5AZ7LdLR/++23b9myRa0rqampOjQ9mIl11Krbe+65Z8CAAWFeRxsTpWENPPvss3369NGAjmMvvvhi5eN+/fqdccYZHnAQONkLLvnTn/6kWzUjKgDZFOsFcu3NN9+sgbfffjvoKXv27NHmWElX0a2goCDo0ZycHNUItZ3du3fv2rVr//nPf6rdUAP+ab788stly5ZpoLCw8IsAVSn8E+zatWvRokUTJ07Uhr6iHmN6CxUhNI2evn379nKnURz897//PXnyZOV1tcR5h9rf//53NYxqXqlRr9KJTen01FNPtSlWtNfp2rWrBvR97UjFU92qYm2Lrypdmx3bV199ZSd78skndavDD9sv9vTTTzefRHVZDzhoqhdq5Z05c6ZWNC2iOnKraEqtp2rb0TGYJgtdZzVSy7+2CcpwerW33nrLTKMVU+NNGbIiOnjTNNrm2DHaPnz33XdTpkx5//339aju+qe3myBtqfSoPvknn3xSVFRkHv3hhx+U9nTsp4c0gXfQ5s2bpy81cOBAffcuXbpoTJiOPZVObGZFpYcWr732mhdY302KFR24aouhgaefftoDDg4VWTijtLTUBEpV/urWrRv06EUXXbR+/XrtyRQH1XRlRmofoEqt0pudTMlMY2xb5KeffqpSwWWXXbZx40Ztte1kSnsqM2irrRdU9jIjN23aZOLyuHHjevTo4QV2nI899pj2Pf5Pcl2Avav91uOPP659mB2jquS99947aNAgO0bJ+LbbbvMXPDSNGvFVOvUOEWVKZXTNmVtuucU2FIZhTsUIjf4mHBx11FHmrnaud955p3+MYeq1drenn0B7RA0E9a9V4VYtjGvWrPGAg5Obm6vqvhYn/0iteqEFv4yMDDXs+DvZa308//zz7d0bbrhBtw8++KBpwZCf//znait//fXXte785S9/6d+/f7mfQau5Dra18o4ZM8aMUYS97777gjr0P/fcc/ZUJ7MJuvTSS7UW2ONDTTN27FgdIj7zzDP2iUqBaos/yH4UcXFx+l4R1pUrnXjr1q1eBEHWrOBXXHGFf+Tw4cOVYrXh3b1790/WOQRHJIIsnPGf//zHCyS8oMxkxMfHB3W30i7tgQce0ICqg8cff7xqGx9++KHSqjbNDz/8sL+nndrK9bJXXXWVioXaUa1YsUIVXLV3qwCpKKYX0VtrH6YUaIJsq1atzBO1s1GK1XPPPvvszp07K2d/8MEHL774YmJiojbTZhqlXu3ezOloCQkJCpQqb2jHqdJm69atvUBxSFlQKTYtLU3FD30GfXLVjxVtIz+LJTyFaVPM1j5VMyqSpxx77LH6vkuXLtVnUNxUtVWf8/nnn9cuuV27dh07djSTabw/kRuKraZMa6o4XqCw5AU6OAb1nDNzkiCLg6eVWitOmzZthgwZooXcrERas7QuB50gr3iq5KSlWs3lZjI9VyujthJBk2k518GkXi3otMVyTZ061aRYbRbMkl9cXKwthlaHn/3sZ6pHqkln9uzZKutee+21KvTWrv3/W0QnTJhgNi96IzUraS27/vrrdeynFK4PoNVHq+HChQu1tQmKg1WlxHwIJzZdC7RlUBY3zS9K2yeddJK/zUdH+9qieoHV3/9cfVNtFfUds7KytEnxgANFkIUzTIu/9hCRnOSupnlzTpjqqSNHjjQjL7zwQhVf1cQ/IMA//QsvvGAazS+55JI77rhj7ty5qpQoyGrM0KFDlTIVZFu0aPGLX/zC/3leeuklL9Bk37t3by9Qbuzbt69Kudqsn3nmmaYN3fQ0VXlV0VAD2jOlpKToBdetW2eCrGKuKjHajdn+fwrBKvQq7ypDT5482Tto+vDaNerraG8a4VOUUNXir+r1swHa06jg7QUuR2BKsGGo0KK6eHp6unZpZozqLl5I1VbMLNKeXoVezl9Gpb7++uug84q0CLVv315tGlpitVJr5TULlVaia665RkdiixcvDr3Sk9Y1s/ZpMi3kCruq5qr13z+NXk3BNMKTR9XcoeCrFPvyyy8fffTRZqQy6wknnKDtxu23325eR2+nLYPWDq1NHTp08L/CP/7xD/M5NYGyuBKebnXUbTZ3Wjueeuop1Xe9aKIquG51iG4vbKLv9dZbb/3617/WltaMMWFXQi/ep59AXzMzM5Mgi4NBH1k4wzTP2WpoeKphKB4pHV599dV2pLabJtSuXLnSP7FiqEmxhmnQ1+Y1/FuYF9HOxqRYQ22Oph/Y6tWrzZiGDRvqVlUfc/VWL9DEpiZCmylNf4nRo0f7W+hUjvUC+S+0cd9SnVW73s8++8wLS+VkFYk1UGkADaK9lP3MJsV6geqL3TOVS7sxxQIv0FxrDzlME2Tonqxu3bra93v794hAeDo6vfl/6SDNCzTIPP7444qk/isTm7YCu+hao0aNMinWMJfg0OYlqPO6aYjwIqBmnIceekhbm9dee82mWOnRo4fW9Lvvvtu+jlK4OTzesGGD/xW0NbBpWwe6qitr4JxzzrFrkDkMNgeEFdFaprXPfxW86mY+T8uWLfXFVTBWk5fplaFj+3//+9/2U3mBKxuEXm7C/Fim0xFwwKjIwhkmwgbtACpiWqt79uzpb78Ts5sx2dE65phj/HdNs+Du3bu9sEx7WefOnYPG69W0TV+1apUJxBdddNGjjz6qlkE1C6ocq9SrnVZiYqKdXkUj+8EsJTxla72F6r7+oOz3wQcfmHOBVbsNqu74qbjrBa4cVKWL4OrzjxgxQgNnn332z3/+czULaqelhKr905dffjl+/Hh/FLBU7dae2wtc60B1MjvevLXZpfkpFpsezEfABXrxEzj//PPNkaHVrVs3O6xWDq3aWvcVSVWjNRE29PJSQets/fr1tc5qgc/IyPCvaxFesX/BggWm07nKt6GVRXMKlw569WHU7KBP9e2334Z+qqD3Mj1w/Ee2Qd+6XNoazJkzR5Fx+vTp1XEVwiB79+5V0Vpb0+8YWQAACdBJREFUqt/+9rfmcFS1Zx0k6ABbmzttKEzvZJNWVbI1/6fgfwVz+KpnecBBIMjCGSbqaS+lfUClvQtycnK8/dtQP7NvCKq2HthGv6K3MGPMo16gP4PedNKkSV988cW0ADViXnrppbfeeqtKFPouptIcesKEsp2CbJhyhe3tavYi5VKy1Pt27NhRH8OrimeffdYLdJJTq6gZo+R60kknqa1Tu0m1n6oEFfQUxXfTnePhhx/2X+vAPNcrr8htvp0+v/8aFEBFVPAr99QihaoXXnhh3Lhx/pFmvQgNsqGvoCylIHtgzQK2VV1lSAU4f29aNafcd999/vPP9JHMkVulV3E+AKbThd4i6Oi9mmjzpRJ46HilW80H21KkuW2+9bZt24KOV3Xg4e3fOAAHjK4FcIYpWmiDGNpW6AUqHwptM2fONNfGMmcjhU5pzjrydyQ4YCZYm1PQ/EzN2F9hVWVizJgxKpY89dRTpm/uhAkTTPu7Ern5MKEhz2zlw/QeU61Ue+7JkyeHuQjr3LlzvUBfPTVonrafqeO++eabxx9/fGge9QKxQKnUCzRu+sdrB6nqrBe4JFnQU7777rtbbrnFC5xPFnr6l6mmK7IHXXvI/Bz2nDDgwCxatMikWB1KaY3Q0qsx5prToQe9oQ30pjn+wP40VeFMq5Ju9SIqyvoTqlZzc/6ZDu1mzJihtebTTz81W4Dq+De7e+65R9uZ119//acJsmpO0fob2sximpuU7+01BE3jTNAmrqioyBwDpKamesBBIMjCGaqbmqvrP/DAA6Ht/oqw2ocpKZqKiMmRatELupakObXW3xwZucLCQv9dE7/0gv5dl/K0eQvTfKlNuYK1SW8qOvbt21c1DHMBRXuN1Z49e+p28eLF/hdXQdfsbsP0GdC+sEePHqY7XUXi4uJiA8p9VONDL2TmBWot5hTjrKysoIdM/TgoOmsXbq7ncPfdd/vPh7PUMGpe0MR3S5Ub3fr/yhI4AObCVeedd96wYcO0Rpg2FtNpJ7T2GXQYpoXcLNUHFmR1NHjMMcf87W9/8wJndo4fP94+ZGqxWt91aNesWTPlS30Ys6ZXR0W2Xr16P/vZz36ykyYVTLWy//KXvwy6wK3puHXqqafaPG02hkGXizbX/NaBetCVTICqIsjCJffff7+ylxoBH330UX87oGqxf/nLXzRw1VVXmX2Y2rO0d1H5Vk+xFzzXZO+9954Gghq+K2WCoPZ2/mBnLiWr3dIrr7xidksqZCpJqwys6U04U7nCXEDHXiNW0da0p9uSrTk5bOzYsTba6mMrEXqB087KDZqRU7j/NMRdd93lBc5l0fC9995rptReX62B9oKXpm70+OOP+/8eQtOoAdcLnFhtR+opN954oz7zbbfdZi86FsqcUvPiiy/at5g1a5byh+bVlVde6QEHwfTn+frrr22oUgNIRddL1tGU/aNmLbemP4wiYCTX2KqItjZ//OMfvcAff5g/E/ECp215+/O0F1j3n332WdsVIQqpfUkbgaBzYSuiY2w1fOnrqAysTZ8ZqcNvsyk+8cQT7ZTmjNv58+fbM8A02fPPP+/tP6sVOBj0kYVLVDJR5eOGG274V4Aa5dUspc2uyUZqPVdJxk78xBNPmOvtnxygFn8z2e9+97uqXpxVLeOmm9fQoUOPPfZYtZ7rk2jf+dxzz910003aIqu6oCrvkiVLTAc4pVKTfdXgqESovaaqMtpTHnXUUd9++62CuB617e9Kq/pGCoiKgyomqdhpdoQa/in/iPy3v/2tErZ2QqZ0evHFF5s/KFLFRTtpfd/vA7zACdRDhgyxT/zVr35l9s2vBfhfU7s6E3y9QP+KwYMHq2Sl30jDKjmbfz9SjAjtZwxUiblwqeKRNgIaViDTsqol2f9PBJaWZy11erR169amC01SUlK5fWyq5Oyzz9a2aMKECTpQfOutt/T6WveVp3XwrHdRA47WffN3r1F7nr6KplOmTNG6H2FvH637t956q541d+5cVQc2b95s/vta2zT/X59om6Zt5p/+9Kc777xTG22t76bLkzYFaqTygINDRRaOUUPe3//+d9NzdMWKFcqI2ldpP6QSpkKYv6bSokUL1f8UufSo4qwm03O1PQ36cykvpL+auUyMv5+Zcuef//xn04iv2qrtY6CqgwowakRTkjNbcO1H9ab+3YA239dff71eQblw4sSJSm/a0Wo/52/HVMxVwTI9PV17Yk2mXZ028UrJ1XQKlPm+/i+4a9cus3O1Z23rM7z00ktKsRrQZ1YANclgxIgRyqb+qy7YHod5IYIu1KXdmLnomAozJsVee+21Qd1wgTAq6v2pQ83XX39dmwUdSWqboGVVK5251p7/KWbV1kZAWU0bBJNiFTefeeaZ0KOp0G6s5qXsCwbd9QIX0dMapM9wxx13qEg5cODABx98UNsfvZc+VWlp6WOPPWZKlUFfpNwus/6R1dHtNfRNMzIyvP1tRJVOLIqhr776qjaM2ggor2sbqA3dL37xi7/+9a9Bf9alDZqay7zARtukWM1200oDHKRa1dFTB6huWm5/+OEHVfW0fdfeK/QCpUETq1Sg7HUwTYeGdkXaP4W+jho0FQQVnUOvlWgp2CkvKheGmaYo4Ke/FtXatWuVWVUsMVflDJKfn69vp7JKhP8KFp5+uKysrLp16+qH8wdi4OAVFBTs2LFDa1CllyIpKSkx6+xB9t6JxNatW7XdUFb+aU7DOmCnnXaaUriOM6u6pmvjpoMHRXat1OG3gevWrSsrK9OBR5hTVIEqIcgC+L8OhSppq4ilEqkHoOZR+8mgQYOOPfZY84eFgCvoIwvgv90D/OdnAKhRzLXwzN+4AA4hyAL4vz836tOnz4FdlQzAEaC0tPT4448nyMI5dC0AAACAk7hqAQAAAJxEkAUAAICTCLIAAABwEkEWAAAATiLIAgAAwEkEWQAAADiJIAsAAAAnEWQBAADgJIIsAAAAnESQBQAAgJMIsgAAAHASQRYAAABOIsgCAADASQRZAAAAOIkgCwAAACcRZAEAAOAkgiwAAACcRJAFAACAkwiyAAAAcBJBFgAAAE4iyAIAAMBJBFkAAAA4iSALAAAAJxFkAQAA4CSCLAAAAJxEkAUAAICTCLIAAABwEkEWAAAATiLIAgAAwEkEWQAAADiJIAsAAAAnEWQBAADgJIIsAAAAnESQBQAAgJMIsgAAAHASQRYAAABOIsgCAADASQRZAAAAOIkgCwAAACcRZAEAAOAkgiwAAACcRJAFAACAkwiyAAAAcBJBFgAAAE4iyAIAAMBJBFkAAAA4iSALAAAAJxFkAQAA4CSCLAAAAJxEkAUAAICTCLIAAABw0v8DAAD//y0Y0CEAAAAGSURBVAMAh3APVpeNZbIAAAAASUVORK5CYII=";

/**
 * A 260x140 pasted chart screenshot as raw base64 - what the app stores when
 * a user pastes an image into the composer; the media scene carries it as its
 * pasted attachment, so the frame shows a real stored shape.
 */
const PASTED_IMAGE_DATA =
	"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";

const user = (
	id: string,
	text: string,
	minutesAgo: number,
): TranscriptRecord => ({
	kind: "user",
	id,
	ts: at(minutesAgo),
	text,
	images: [],
});

const userWithImage = (
	id: string,
	text: string,
	minutesAgo: number,
): TranscriptRecord => ({
	kind: "user",
	id,
	ts: at(minutesAgo),
	text,
	images: [
		{
			id: `${id}:0`,
			data: PASTED_IMAGE_DATA,
			attachment: null,
			mimeType: "image/png",
		},
	],
});

const assistant = (
	id: string,
	text: string,
	minutesAgo: number,
): TranscriptRecord => ({
	kind: "assistant",
	id,
	ts: at(minutesAgo),
	text,
	streaming: false,
	stopReason: null,
	error: false,
	complete: true,
});

type ToolRecord = Extract<TranscriptRecord, { kind: "tool" }>;

const tool = (over: Partial<ToolRecord> & { id: string }): ToolRecord => ({
	kind: "tool",
	ts: NOW,
	toolCallId: over.id,
	toolName: "bash",
	intent: null,
	args: null,
	phase: "done",
	argumentBytes: 0,
	output: "ok",
	isError: false,
	notRunReason: null,
	// Required beside its reason since main's `e9ae98fd54`; null says this row
	// is a call that really was sent.
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
	...over,
});

function transcriptOf(records: TranscriptRecord[]): TranscriptState {
	return {
		records,
		index: new Map(records.map((record, position) => [record.id, position])),
		generation: 1,
		compacting: false,
		compactingSince: 0,
		viewEpoch: 0,
		oldestId: null,
		oldestTs: 0,
		hasMore: false,
		argsByCall: new Map(),
	};
}

const NONEMPTY: Message[] = [
	{ id: "canonical", role: "system", timestamp: new Date(0) },
];

/* ---------------------------------------------------------------- the frames */

/** No-op MCP remedy controls: no MCP section is staged in this world. */
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

/** No-op monitor controls: no monitors are staged in this world. */
const INERT_MONITOR_CONTROLS: MonitorControls = {
	cancel: async () => ({ ok: true }),
};

/** The chrome state Storybook has no main process for; see `docs-hero`. */
const useMacChrome = () => {
	useLayoutEffect(() => {
		const root = document.documentElement;
		root.dataset.chromeMode = "integrated";
		root.dataset.chromePlatform = "mac";
		root.dataset.chromeLeading = "traffic-lights";
		root.dataset.chromeTrailing = "none";
		return () => {
			delete root.dataset.chromeMode;
			delete root.dataset.chromePlatform;
			delete root.dataset.chromeLeading;
			delete root.dataset.chromeTrailing;
		};
	}, []);
};

/** Stage a composer draft the way `docs-hero` stages one. */
const useStagedDraft = (conversationId: string, draft: string) => {
	useLayoutEffect(() => {
		useConversationInputStore.getState().setCurrentInput(conversationId, draft);
		return () => {
			useConversationInputStore.getState().setCurrentInput(conversationId, "");
		};
	}, [conversationId, draft]);
};

/** The chat column: header, transcript, composer. */
const ConversationColumn: FC<{
	records: TranscriptRecord[];
	containerRef: RefObject<HTMLDivElement>;
}> = ({ records, containerRef }) => {
	const details = deriveRunDetails(runFixtures.bothInFlight());
	return (
		<div className="flex h-full min-h-0 w-0 min-w-[480px] flex-1 flex-col overflow-hidden">
			<ChatHeader
				agentName="Core"
				description="Invoices workspace · on this machine"
				onOpenOptions={() => undefined}
				runDetails={details}
			/>
			<div className="flex min-h-0 grow flex-col px-6 pt-4">
				<CanonicalTranscript
					transcript={transcriptOf(records)}
					frontend={null}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					conversationId={CONVERSATION_ID}
					onReconnect={() => {}}
				/>
			</div>
			<div className="shrink-0 px-6 pb-6 pt-0">
				<MessageInput
					isLoading={false}
					messages={NONEMPTY}
					conversationId={CONVERSATION_ID}
					onSendMessage={async () => true}
				/>
			</div>
		</div>
	);
};

/**
 * A route every right-slot pane can draw on: the three facts the app's own
 * `chat-content` publishes on a conversation route. This shell mounts its pane
 * directly rather than through `chat-content`, the app's only publisher, so it
 * states the route it simulates - the same reason `shell.stories.tsx`'s frame
 * does, and without it the lane's stop would fall back to 0. Both objects are
 * inline rather than the store's constants because the before half of an
 * evidence pair swaps `origin/main`'s store module under these stories; an
 * import the old module lacks would fail that bundle (see
 * `docs/evidence/shell-app-shell/slot-release-before/README.md`).
 */
const DRAWABLE_ROUTE = {
	mounted: true,
	runDetails: true,
	session: true,
} as const;
const EMPTY_ROUTE = {
	mounted: false,
	runDetails: false,
	session: false,
} as const;

/**
 * The app shell with the REAL sidebar, wrapping a conversation column and an
 * optional right pane - the `docs-hero` frame, parameterized.
 */
const AppShell: FC<{
	records?: TranscriptRecord[];
	runPanelWidth?: number;
	rightPane?: "run" | null;
	/** A scene's own run-details state; the shared hero fixture when passed none. */
	details?: ReturnType<typeof deriveRunDetails>;
	children?: ReactNode;
}> = ({
	records,
	runPanelWidth = DEFAULT_RUN_PANEL_WIDTH,
	rightPane = null,
	details = deriveRunDetails(runFixtures.bothInFlight()),
	children,
}) => {
	const rowRef = useRef<HTMLDivElement | null>(null);
	const containerRef = useRef<HTMLDivElement>(null);
	const [rowWidth, setRowWidth] = useState(0);
	useLayoutEffect(() => {
		const node = rowRef.current;
		if (!node) return;
		const measure = () => setRowWidth(node.getBoundingClientRect().width);
		measure();
		const observer = new ResizeObserver(measure);
		observer.observe(node);
		return () => observer.disconnect();
	}, []);
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: rightPane === "run",
			rightSlotWidth: runPanelWidth,
			rightSlotRoute: DRAWABLE_ROUTE,
		});
		return () => {
			useUiPreferencesStore.setState({
				isRunPanelOpen: false,
				rightSlotRoute: EMPTY_ROUTE,
			});
		};
	}, [rightPane, runPanelWidth]);
	const slotWidth = useUiPreferencesStore((state) =>
		resolveRightSlotWidth(rowWidth, state),
	);
	return (
		<div className="relative flex h-screen flex-col overflow-hidden">
			<ChatLayout
				sidebar={<SidebarNavigation />}
				content={
					<main className="flex min-w-0 grow flex-col overflow-hidden">
						<div
							ref={rowRef}
							className="flex h-full min-h-0 w-full overflow-hidden"
						>
							{children ?? (
								<ConversationColumn
									records={records ?? []}
									containerRef={containerRef}
								/>
							)}
							{rightPane === "run" && (
								<PaneSlot
									width={slotWidth}
									minWidth={420}
									tourTag="run-panel-dock"
								>
									<RunPanel
										details={details}
										mcpServers={deriveMcpServers([], {}, [])}
										mcpGrantRunning={mcpGrantInFlight([])}
										mcpRemedy={INERT_REMEDY}
										monitorControls={INERT_MONITOR_CONTROLS}
										sessionId="3f9c1a2b4d5e"
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
							)}
						</div>
						{/* The rail through the SHELL'S host, exactly as the app mounts it. */}
						<InPanelRailHost>
							<PanelRail
								sessionId={CONVERSATION_ID}
								runDetails={details}
								mcpServers={deriveMcpServers([], {}, [])}
								listOnScreen={false}
								readerChildId={null}
								browserAttentionCount={0}
								consoleUnseenCount={0}
								consoleUnseenPulsing={false}
								fileCount={0}
							/>
						</InPanelRailHost>
					</main>
				}
			/>
		</div>
	);
};

/** A page-level scene: the ground and type come from the preview frame. */
const PageFrame: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="flex h-screen flex-col overflow-hidden bg-canvas">
		{children}
	</div>
);

/**
 * Navigate once, then render the route's element. The preview's own
 * `MemoryRouter` has no route table, so both pages declare the paths the app
 * declares, the `projects.stories.tsx` idiom.
 */
const RouteTo = ({ path, children }: { path: string; children: ReactNode }) => {
	const navigate = useNavigate();
	useEffect(() => {
		navigate(path, { replace: true });
	}, [navigate, path]);
	return (
		<Routes>
			<Route path="/projects" element={children} />
			<Route path="/projects/:projectId" element={children} />
			<Route path="/agents" element={children} />
			<Route path="/agents/:agentId" element={children} />
		</Routes>
	);
};

/**
 * Expand one tool receipt by name, the way a reader opens one (the row's own
 * disclosure is the only control; `CanonicalTranscript` takes no start-open
 * prop). Holds the shutter until the detail is actually painted.
 */
const ExpandReceipt = ({ marker }: { marker: string }) => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		let done = false;
		const timer = window.setInterval(() => {
			if (done) return;
			const triggers = Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					'[data-record-kind="tool"] button[aria-expanded="false"]',
				),
			);
			const target = triggers.find((trigger) =>
				(
					trigger.closest('[data-record-kind="tool"]')?.textContent ?? ""
				).includes(marker),
			);
			target?.click();
			const open = Array.from(
				document.querySelectorAll<HTMLButtonElement>(
					'[data-record-kind="tool"] button[aria-expanded="true"]',
				),
			).find((trigger) =>
				(
					trigger.closest('[data-record-kind="tool"]')?.textContent ?? ""
				).includes(marker),
			);
			if (open) {
				done = true;
				document.documentElement.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
			}
		}, 100);
		return () => {
			window.clearInterval(timer);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, [marker]);
	return null;
};

/**
 * Hold the shutter until the hub's scope switch (its `play`) has landed. An org
 * badge on screen is the proof: the Teams roster used to be rendered under the
 * grid and was the marker, but it is a tab now and only mounts when opened.
 *
 * THE SCENE STAYS ON THE AGENTS TAB ON PURPOSE (agent review round 1, m4). It is
 * the library's picture of the hub's org workspace - grid, badges, scope - and
 * the browse bar above it now shows the Teams tab with its count, which is the
 * one-glance version of what the roster under the grid used to be. Opening the
 * Teams tab would swap the grid the marketing shot exists for. The change is
 * disclosed on the PR because the shot is a public asset.
 *
 * A play that failed shows no error display, so the timeout leaves
 * `data-capture-failed` for the rig to refuse on.
 */
const HubHold = () => {
	useEffect(() => {
		document.documentElement.dataset.capturePending = "1";
		const started = Date.now();
		const timer = window.setInterval(() => {
			if (document.querySelector('[data-testid="agent-org-badge"]')) {
				document.documentElement.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
			} else if (Date.now() - started > 20_000) {
				document.documentElement.dataset.captureFailed =
					"hub-scope-not-switched";
				document.documentElement.removeAttribute("data-capture-pending");
				window.clearInterval(timer);
			}
		}, 100);
		return () => {
			window.clearInterval(timer);
			document.documentElement.removeAttribute("data-capture-pending");
		};
	}, []);
	return null;
};

/* ------------------------------------------------------------------- scenes */

const meta: Meta = {
	title: "Docs/Library",
	parameters: { layout: "fullscreen" },
};

export default meta;

type Story = StoryObj;

/* -- 1. Conversation with tool groups and an expanded receipt -------------- */

const TOOLS_CONVERSATION: TranscriptRecord[] = [
	user(
		"u1",
		"Reconcile the March invoices in `invoices/march.csv` — who still owes us, and write the summary to `reports/unpaid-march.md`.",
		14,
	),
	tool({
		id: "call-read",
		ts: at(13),
		toolName: "read",
		intent: "Reading the March invoice export",
		args: { path: "invoices/march.csv" },
		output:
			"date,customer,amount,status\n2026-03-02,Northwind Traders,1240.00,paid\n2026-03-05,Contoso,2310.00,unpaid\n2026-03-09,Fabrikam,1150.00,unpaid\n2026-03-11,Contoso,2510.00,pending\n",
		durationS: 0.04,
	}),
	tool({
		id: "call-sum",
		ts: at(13),
		toolName: "bash",
		intent: "Summing the unpaid rows by customer",
		args: { command: "python reconcile.py --group customer" },
		output:
			"customer\nContoso    4820.00\nFabrikam   1150.00\nNorthwind Traders       0.00\nName: amount, dtype: float64",
		durationS: 1.3,
	}),
	assistant(
		"a0",
		"The export is loaded and the unpaid rows are grouped. Two rows are marked `pending` rather than `unpaid` — I am treating those as invoiced but not yet due and will flag them in the report.",
		12,
	),
	tool({
		id: "call-write",
		ts: at(11),
		toolName: "write",
		intent: "Writing the summary report",
		args: { path: "reports/unpaid-march.md" },
		output: "Written 14 lines to reports/unpaid-march.md",
		durationS: 0.03,
	}),
	tool({
		id: "call-verify",
		ts: at(11),
		toolName: "read",
		intent: "Verifying the report",
		args: { path: "reports/unpaid-march.md" },
		output:
			"# Unpaid invoices, March 2026\n\n| Customer | Outstanding |\n|---|---|\n| Contoso | 4,820.00 |\n| Fabrikam | 1,150.00 |\n\nTotal: 5,970.00",
		durationS: 0.02,
	}),
	assistant(
		"a1",
		"Two customers are outstanding at the end of March: **Contoso** — 4,820.00, and **Fabrikam** — 1,150.00, for **5,970.00** in total. Two Contoso rows are marked `pending` rather than `unpaid` and I have left them out of the total until you say otherwise. The write-up is at `reports/unpaid-march.md`, and a reviewer is checking the arithmetic.",
		10,
	),
];

export const ConversationTools: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <ConversationToolsScene />;
	},
};

const ConversationToolsScene = () => {
	useMacChrome();
	useStagedDraft(
		CONVERSATION_ID,
		"Chase Contoso for the outstanding balance — draft the reminder email and show it to me before it sends.",
	);
	return (
		<>
			<ExpandReceipt marker="reconcile.py" />
			<AppShell records={TOOLS_CONVERSATION} />
		</>
	);
};

/* -- 2. Subagents: the run pane dominant ----------------------------------- */

const SUBAGENT_CONVERSATION: TranscriptRecord[] = [
	user(
		"u1",
		"Reconcile the March invoices in `invoices/march.csv` and have the work checked before you write the summary.",
		65,
	),
	tool({
		id: "call-read",
		ts: at(64),
		toolName: "read",
		intent: "Reading the March invoice export",
		args: { path: "invoices/march.csv" },
		output:
			"date,customer,amount,status\n2026-03-02,Northwind Traders,1240.00,paid\n2026-03-05,Contoso,2310.00,unpaid\n2026-03-09,Fabrikam,1150.00,unpaid\n",
		durationS: 0.04,
	}),
	tool({
		id: "call-sum",
		ts: at(64),
		toolName: "bash",
		intent: "Summing the unpaid rows by customer",
		args: { command: "python reconcile.py --group customer" },
		output: "customer\nContoso    4820.00\nFabrikam   1150.00",
		durationS: 1.3,
	}),
	assistant(
		"a0",
		"Two runs are under way: one auditing the figures against the ledger export, one drafting the summary. I will fold both results into the report when they settle.",
		63,
	),
];

/**
 * The subagents scene's own moment, distinct from the hero's panel on purpose
 * (design round 1, D1: the row must add information rather than rescale the
 * hero). Same workspace and request, later in it: the audit is deep into its
 * ledger check, the summary is already being written, and the child that will
 * publish it waits behind the capacity gate - where the row's omission rule
 * shows no clock, no context and no cost, the one state the hero's panel
 * cannot show.
 */
const SUBAGENT_RUN_STATE = (() => {
	const base = runFixtures.bothInFlight();
	const [audit, summarise] = base.jobs;
	const nowSeconds = runFixtures.FIXTURE_NOW_MS / 1000;
	return {
		...base,
		jobs: [
			{
				...audit,
				start_time: nowSeconds - 154,
				latest_details: { progress: "Checked 448 of 452 ledger rows" },
				usage: { context_tokens: 145_000 },
				direct_cost: 0.53,
			},
			{
				...summarise,
				start_time: nowSeconds - 61,
				latest_details: { progress: "Writing reports/unpaid-march.md" },
				usage: { context_tokens: 33_800 },
				direct_cost: 0.07,
			},
			{
				...summarise,
				id: "job-publish",
				label: "Publish the summary",
				agent_role: "task",
				queued: true,
				latest_details: null,
				usage: null,
				direct_cost: null,
				context_window: null,
				start_time: 0,
				settled_at: null,
			},
		],
	};
})();

const SUBAGENT_DETAILS = deriveRunDetails(SUBAGENT_RUN_STATE);

export const Subagents: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <SubagentsScene />;
	},
};

const SubagentsScene = () => {
	useMacChrome();
	useLayoutEffect(() => {
		useUiPreferencesStore.setState({
			isRunPanelOpen: true,
			rightSlotWidth: 480,
			rightSlotRoute: DRAWABLE_ROUTE,
		});
		return () => {
			useUiPreferencesStore.setState({
				isRunPanelOpen: false,
				rightSlotWidth: 0,
				rightSlotRoute: EMPTY_ROUTE,
			});
		};
	}, []);
	/*
	 * 480 rather than the 420 default: the run pane IS this row's subject, so it
	 * takes the wider width, the same one `media-in-conversation` passes.
	 */
	return (
		<AppShell
			records={SUBAGENT_CONVERSATION}
			rightPane="run"
			runPanelWidth={480}
			details={SUBAGENT_DETAILS}
		/>
	);
};

/* -- 3. Teams: the release-crew roster, sidebar Teams section visible ------ */

export const Teams: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <TeamsScene />;
	},
};

const TeamsScene = () => {
	useMacChrome();
	return (
		<AppShell>
			<RouteTo path="/agents?kind=team&name=release-crew">
				<AgentsPage />
			</RouteTo>
		</AppShell>
	);
};

/* -- 4. Agents: the coder's detail, sidebar Agents section visible --------- */

export const Agents: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <AgentsScene />;
	},
};

const AgentsScene = () => {
	useMacChrome();
	return (
		<AppShell>
			<RouteTo path="/agents?kind=agent&name=coder">
				<AgentsPage />
			</RouteTo>
		</AppShell>
	);
};

/* -- 5. Projects: the board, one active pinned ---------------------------- */

const PROJECTS_NOW_MS = Date.parse("2026-03-14T10:26:00Z");
const HOUR_S = 3600;
const DAY_S = 86_400;

const project = (
	id: string,
	name: string,
	extra: Partial<DesktopProject> = {},
): DesktopProject => ({
	id,
	name,
	description: "",
	owner: null,
	team: null,
	title: null,
	status: "active",
	tags: [],
	start_date: null,
	target_date: null,
	completed_at: null,
	estimate: null,
	estimate_unit: "points",
	milestones_completed: 0,
	milestones_total: 0,
	sessions: 0,
	live_sessions: 0,
	progress_stale: false,
	progress_updated_at: PROJECTS_NOW_MS / 1000 - 2 * HOUR_S,
	updated_at: PROJECTS_NOW_MS / 1000,
	...extra,
});

const PROJECTS: DesktopProject[] = [
	project("p1", "Quarterly revenue model", {
		description:
			"Model Q2 revenue from the March close and the current pipeline",
		tags: ["finance", "q2"],
		start_date: "2026-03-01",
		target_date: "2026-04-10",
		estimate: 8,
		milestones_completed: 2,
		milestones_total: 4,
		sessions: 3,
		live_sessions: 1,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 2 * HOUR_S,
	}),
	project("p2", "Reconcile the March invoices", {
		description: "Chase the outstanding balances and close the March books",
		tags: ["finance"],
		start_date: "2026-03-05",
		target_date: "2026-03-28",
		estimate: 5,
		milestones_completed: 1,
		milestones_total: 3,
		sessions: 2,
		live_sessions: 1,
		progress_stale: true,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 6 * DAY_S,
	}),
	project("p3", "Vendor contract renewal", {
		description: "Renew the Contoso and Fabrikam supplier agreements",
		status: "planning",
		tags: ["vendors"],
		start_date: "2026-02-20",
		target_date: "2026-05-01",
		estimate: 4,
		estimate_unit: "days",
		milestones_completed: 0,
		milestones_total: 2,
		sessions: 1,
		live_sessions: 0,
		progress_stale: true,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 4 * DAY_S,
	}),
	project("p4", "Close the February books", {
		description:
			"Finalise the February close and hand the pack to the accountant",
		status: "qa",
		tags: ["finance"],
		start_date: "2026-02-28",
		target_date: "2026-03-20",
		estimate: 3,
		milestones_completed: 3,
		milestones_total: 4,
		sessions: 2,
		live_sessions: 0,
		progress_stale: true,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 3 * DAY_S,
	}),
	project("p5", "Migrate the deploy script", {
		description:
			"Cut the release job over to the new pipeline and watch one release",
		status: "validation",
		tags: ["release"],
		start_date: "2026-03-02",
		target_date: "2026-03-18",
		estimate: 5,
		milestones_completed: 1,
		milestones_total: 2,
		sessions: 2,
		live_sessions: 1,
		progress_stale: false,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 40 * 60,
	}),
	project("p6", "Ledger clean-up", {
		description: "Archive the closed supplier accounts",
		status: "done",
		completed_at: "2026-03-10",
		tags: ["finance"],
		start_date: "2026-02-17",
		target_date: "2026-03-10",
		estimate: 2,
		milestones_completed: 2,
		milestones_total: 2,
		sessions: 1,
		live_sessions: 0,
		progress_stale: false,
		progress_updated_at: PROJECTS_NOW_MS / 1000 - 4 * DAY_S,
	}),
];

export const Projects: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		try {
			localStorage.setItem("projects-view", "board");
		} catch {
			/* storage is not what this story is about */
		}
		return (
			<PageFrame>
				<ProjectsPage nowMs={PROJECTS_NOW_MS} />
			</PageFrame>
		);
	},
};

/* -- 6. Schedules: a nightly job and a morning report ---------------------- */

const SCHEDULES_NOW_MS = new Date(2026, 2, 14, 14, 0, 0, 0).getTime();
const atMin = (minutes: number): number => SCHEDULES_NOW_MS + minutes * 60_000;
const HOUR_MS = 3_600_000;

const SUPERVISOR: DesktopWakeSupervisor = {
	supported: true,
	running: true,
	detail: "running",
};

const wake = (
	id: string,
	minutes: number,
	message: string,
	extra: Partial<DesktopWakeEntry["schedules"][number]> = {},
): DesktopWakeEntry["schedules"][number] => ({
	id,
	message,
	next_due_at: atMin(minutes),
	every_ms: null,
	until_at: null,
	limit: null,
	fired_count: 0,
	overdue_s: 0,
	stale: false,
	last_fired_at: null,
	last_attempt_at: null,
	...extra,
});

const wakeConversation = (
	sessionId: string,
	name: string,
	cwd: string,
	schedules: DesktopWakeEntry["schedules"],
): DesktopWakeEntry => {
	const due = schedules
		.map((schedule) => schedule.next_due_at)
		.filter((value): value is number => typeof value === "number");
	return {
		session_id: sessionId,
		name,
		cwd,
		origin: "",
		updated_at: SCHEDULES_NOW_MS - 30 * 60_000,
		dormant: false,
		ghost: false,
		next_due_at: due.length > 0 ? Math.min(...due) : null,
		schedules,
	};
};

const WAKES: DesktopWakeEntry[] = [
	wakeConversation("3f9c1a2b4d5e", "Invoices workspace", "~/invoices", [
		wake(
			"w1",
			720,
			"Run the nightly ledger sync, reconcile it against invoices/march.csv, and flag anything that does not match.",
			{ every_ms: 24 * HOUR_MS, limit: 60, fired_count: 12 },
		),
		wake(
			"w2",
			1_080,
			"Post the morning report — yesterday's collections, today's follow-ups, and anything still outstanding.",
			{ every_ms: 24 * HOUR_MS, fired_count: 9 },
		),
	]),
	wakeConversation("2b3c4d5e6f70", "Release crew ops", "~/local-operator", [
		wake(
			"w3",
			730,
			"Check the nightly CI queue and send me the failures with their diffs.",
			{ every_ms: 24 * HOUR_MS, fired_count: 5 },
		),
	]),
	wakeConversation("5a6b7c8d9e0f", "Standup notes", "~/workspace", [
		wake(
			"w4",
			1_140,
			"Collect yesterday's commits and open pull requests into a short standup note.",
			{ every_ms: 24 * HOUR_MS, fired_count: 7 },
		),
	]),
	wakeConversation("7c1f2e3d4a5b", "Weekly finance digest", "~/finance", [
		wake(
			"w5",
			2_820,
			"Pull last week's revenue and refunds and write a short digest with the three biggest movers.",
			{ every_ms: 7 * 24 * HOUR_MS, fired_count: 3 },
		),
	]),
];

const LEGACY_AGENTS = [
	{ id: "3f21c0aa-1d55-4a8b-9a1e-27a4f0d9b111", name: "Invoice auditor" },
	{ id: "8c04b7e2-93f1-4c0d-8d2a-11f4e6c7a222", name: "Weekly brief" },
];

const LEGACY_SCHEDULES = [
	{
		id: "9b2f4c11-63ea-4c7f-9d18-4f60a2c7d001",
		agent_id: LEGACY_AGENTS[0].id,
		prompt: "Tidy the scratch directory and tell me what was removed.",
		interval: 1,
		unit: "days",
		is_active: true,
		one_time: false,
		start_time_utc: new Date(2026, 2, 10, 9, 0, 0, 0).toISOString(),
		end_time_utc: null,
		created_at: new Date(2026, 2, 9, 9, 0, 0, 0).toISOString(),
	},
];

export const Schedules: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return (
			<PageFrame>
				<SchedulesPage nowMs={SCHEDULES_NOW_MS} />
			</PageFrame>
		);
	},
};

/* -- 7. Agent hub: org scope, shared agents and the team roster ------------ */

type HubBridgeRequest = {
	op: string;
	control?: {
		operation?: string;
		query?: Record<string, string | number>;
		tenant_id?: string;
	};
};

const HUB_ORGS = [
	{
		tenant_id: "tenant-aster",
		tenant_name: "Aster Labs",
		role: "owner",
		status: "active" as const,
		is_home: true,
		plan: { status: "active" as const, seats: 6 },
	},
];

const HUB_TEAMS = [
	{
		id: "team-hub-1",
		name: "release-crew",
		project: "Release engineering",
		version: "1.2.0",
		members: [
			{ role: "coder", kind: "role", count: 2 },
			{ role: "reviewer", kind: "role", count: 1 },
		],
	},
	{
		id: "team-hub-2",
		name: "docs-pod",
		project: "Documentation",
		version: "0.4.0",
		members: [{ role: "coder", kind: "role", count: 1 }],
	},
];

/**
 * The records the org scope lists, one description per agent so the cards read
 * as different products rather than one sentence in three colours.
 */
const HUB_AGENTS: {
	name: string;
	description: string;
	tags: string[];
	categories: string[];
}[] = [
	{
		name: "Invoice auditor",
		description:
			"Reads an invoice export, matches each row against the ledger, and writes one short note listing anything that does not reconcile.",
		tags: ["finance", "weekly"],
		categories: ["accounting"],
	},
	{
		name: "Ledger reconciler",
		description:
			"Reconciles a month's ledger against the bank export and flags every amount that has no matching entry.",
		tags: ["finance", "monthly"],
		categories: ["accounting"],
	},
	{
		name: "Release notes",
		description:
			"Reads the week's merged changes and drafts release notes with the user-facing changes first.",
		tags: ["software", "weekly"],
		categories: ["software"],
	},
	{
		name: "Contract reader",
		description:
			"Extracts renewal dates, notice periods and amounts from supplier contracts and files them as a one-page summary.",
		tags: ["research", "monthly"],
		categories: ["research"],
	},
];

const hubAgents = (count: number) =>
	Array.from({ length: count }, (_, index) => {
		const seed = HUB_AGENTS[index % HUB_AGENTS.length];
		return {
			id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
			account_id: "acct-1",
			tenant_id: "tenant-aster",
			account_metadata: {
				name: ["Dana Whitfield", "Priya Raman", "Sam Okonkwo"][index % 3],
				email: "author@example.com",
			},
			name: seed.name,
			description: seed.description,
			version: "1.4.0",
			created_at: new Date(Date.now() - (index + 3) * 86_400_000).toISOString(),
			updated_at: new Date(Date.now() - (index + 1) * 86_400_000).toISOString(),
			tags: seed.tags,
			categories: seed.categories,
			like_count: 12 + index * 7,
			favourite_count: 4 + index * 3,
			download_count: 120 + index * 143,
		};
	});

const installHubBridge = () => {
	const okEnvelope = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const proxy = <T,>(envelope: T): DesktopResponse =>
		okEnvelope({ data: envelope });
	const bridge = async (
		request: HubBridgeRequest,
	): Promise<DesktopResponse> => {
		const operation = request.control?.operation;
		if (request.op === "capabilities") {
			return okEnvelope({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: {
					radient: 1,
					profile_catalogue: 1,
					team_catalogue: 1,
					radient_org: 1,
				},
			});
		}
		if (request.op === "team.pull") {
			return okEnvelope({
				status: 200,
				message: "Team pulled from Radient successfully",
				result: { id: "local-team-1", name: "release-crew" },
			});
		}
		if (request.op === "sessions.list") {
			return okEnvelope({ sessions: [], truncated: false });
		}
		if (request.op === "profiles.list") {
			return okEnvelope({ profiles: [] });
		}
		if (request.op === "radient.request") {
			switch (operation) {
				case "memberships.list":
					return proxy({
						msg: "Memberships listed successfully",
						result: { memberships: HUB_ORGS },
					});
				case "org_agents.list": {
					const orgTenant = String(
						request.control?.tenant_id ?? "tenant-aster",
					);
					return proxy({
						msg: "Agents listed successfully",
						result: {
							page: 1,
							per_page: 12,
							total_pages: 1,
							total_records: 4,
							records: hubAgents(4).map((record) => ({
								...record,
								tenant_id: orgTenant,
								visibility: "org" as const,
							})),
						},
					});
				}
				case "org_teams.list":
					return proxy({
						msg: "Teams listed successfully",
						result: { teams: HUB_TEAMS },
					});
				case "account":
					return proxy({
						account: { id: "acct-1", name: "Dana", email: "d@example.com" },
					});
				case "agents.list":
					return proxy({
						msg: "Agents listed successfully",
						result: {
							page: 1,
							per_page: 12,
							total_pages: 1,
							total_records: 3,
							records: hubAgents(3),
						},
					});
				case "agents.statuses": {
					const ids = String(request.control?.query?.agent_ids ?? "")
						.split(",")
						.filter(Boolean);
					return proxy({
						msg: "Agent statuses read",
						result: {
							statuses: Object.fromEntries(
								ids.map((id) => [id, { liked: false, favourited: false }]),
							),
						},
					});
				}
				default:
					throw new Error(
						`unexpected Radient operation in this story: ${operation}`,
					);
			}
		}
		throw new Error(`unexpected desktop op in this story: ${request.op}`);
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: HubBridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

export const AgentHub: Story = {
	render: () => {
		installHubBridge();
		return <AgentHubScene />;
	},
	play: async () => {
		await screen.findByTestId("agent-hub-status");
		await userEvent.click(
			await screen.findByRole("button", { name: "Aster Labs" }),
		);
		await screen.findAllByTestId("agent-org-badge");
	},
};

const AgentHubScene = () => (
	<PageFrame>
		<HubHold />
		<AgentHubPage />
	</PageFrame>
);

/* -- 8. Mesh: paired devices ------------------------------------------------ */

const DEVICE_SELF = `d_${"a".repeat(32)}`;
const DEVICE_PEER = `d_${"b".repeat(32)}`;
const DEVICE_THIRD = `d_${"c".repeat(32)}`;
const DEVICE_FOURTH = `d_${"d".repeat(32)}`;
const NET_HOME = `n_${"1".repeat(24)}`;

const seenMinutesAgo = (minutes: number): number =>
	Math.floor(Date.now() / 1000) - minutes * 60;

const meshMember = (
	device_id: string,
	fields: Partial<{
		name: string;
		role: string;
		active: boolean;
		suspect: boolean;
		reachable: boolean;
		reason: string;
		last_seen_at: number | null;
		endpoints: string[];
	}> = {},
) => ({
	device_id,
	name: "",
	role: "drive",
	capabilities: ["sessions", "transfer"],
	active: true,
	suspect: false,
	endpoints: ["10.0.0.4:4097"],
	last_seen_at: null,
	reachable: true,
	reason: "",
	...fields,
});

const meshPeer = (
	device_id: string,
	fields: Partial<{
		name: string;
		reachable: boolean;
		unreachable_reason: string;
		last_seen_at: number | null;
		session_count: number;
	}> = {},
) => ({
	device_id,
	name: "",
	reachable: true,
	unreachable_reason: "",
	last_seen_at: null,
	session_count: 0,
	rtt_ms: null,
	...fields,
});

const installMeshBridge = () => {
	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		if (request.op === "capabilities") {
			return ok({
				desktop_contract: 1,
				desktop_available: true,
				desktop_auth: "bearer",
				features: { peers: 1, session_transfer: 1 },
			});
		}
		if (request.op === "sessions.list") {
			return ok({ sessions: [], degraded: [], truncated: false });
		}
		if (request.op === "networks.list") {
			return ok({
				self_device_id: DEVICE_SELF,
				networks: [
					{
						network_id: NET_HOME,
						name: "Home mesh",
						epoch: 3,
						trust: "active",
						members: [
							meshMember(DEVICE_SELF, {
								name: "damians-MacBook-Pro",
								role: "admin",
							}),
							meshMember(DEVICE_PEER, {
								name: "cloud-node-1",
								last_seen_at: seenMinutesAgo(4),
							}),
							meshMember(DEVICE_THIRD, {
								name: "workshop-mini",
								role: "read",
								last_seen_at: seenMinutesAgo(12),
							}),
							meshMember(DEVICE_FOURTH, {
								name: "render-box",
								last_seen_at: seenMinutesAgo(58),
							}),
						],
					},
				],
			});
		}
		if (request.op === "peers.list") {
			return ok({
				self_device_id: DEVICE_SELF,
				peers: [
					meshPeer(DEVICE_PEER, {
						name: "cloud-node-1",
						session_count: 4,
						last_seen_at: seenMinutesAgo(4),
					}),
					meshPeer(DEVICE_THIRD, {
						name: "workshop-mini",
						session_count: 1,
						last_seen_at: seenMinutesAgo(12),
					}),
					meshPeer(DEVICE_FOURTH, {
						name: "render-box",
						session_count: 9,
						last_seen_at: seenMinutesAgo(58),
					}),
				],
				degraded: [],
			});
		}
		throw new Error(`unexpected desktop op in this story: ${request.op}`);
	};
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: bridge };
};

export const Mesh: Story = {
	render: () => {
		installMeshBridge();
		return (
			<div className="flex h-screen flex-col bg-canvas p-6">
				<MeshPage />
			</div>
		);
	},
};

/* -- 9. Media in the conversation ------------------------------------------- */

const MEDIA_CONVERSATION: TranscriptRecord[] = [
	userWithImage("u1", "March invoices — who still owes us?", 6),
	assistant(
		"a0",
		"Two customers are outstanding — plotting the amounts now, and the write-up is at `reports/unpaid-march.md`.",
		5,
	),
	tool({
		id: "call-plot",
		ts: at(4),
		toolName: "bash",
		intent: "Plotting the outstanding amounts",
		args: { command: "python plot_outstanding.py --month 2026-03" },
		output: "Wrote outstanding-march.png",
		durationS: 1.9,
		images: [
			{
				id: "call-plot:0",
				data: GENERATED_CHART_DATA,
				attachment: null,
				mimeType: "image/png",
			},
		],
	}),
	assistant(
		"a1",
		"**Contoso** — 4,820.00, and **Fabrikam** — 1,150.00, for **5,970.00** in total. The two Contoso rows marked `pending` are left out of the total; the full breakdown is in `reports/unpaid-march.md`.",
		3,
	),
];

export const MediaInConversation: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <MediaScene />;
	},
};

const MediaScene = () => {
	useMacChrome();
	useStagedDraft(
		CONVERSATION_ID,
		"Draft the reminder email to Contoso and show it to me before it sends.",
	);
	return (
		<>
			<AppShell
				records={MEDIA_CONVERSATION}
				rightPane="run"
				runPanelWidth={480}
			/>
		</>
	);
};

/* -- 10. Appearance --------------------------------------------------------- */

export const Appearance: Story = {
	render: () => (
		<PageFrame>
			<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 p-6 pt-8">
				<SettingsSection
					title="Appearance"
					icon={Contrast}
					description="Customize the look and feel of Local Operator"
					dataTourTag="settings-appearance-section"
				>
					<div className="flex flex-col gap-4">
						<ThemeSelector />
					</div>
				</SettingsSection>
			</div>
		</PageFrame>
	),
};

/* -- 11. Chat trace: an expanded tool-trace detail -------------------------- */

const TRACE_CONVERSATION: TranscriptRecord[] = [
	user(
		"u1",
		"Reconcile the March invoices in `invoices/march.csv` — who still owes us, and write the summary to `reports/unpaid-march.md`.",
		9,
	),
	tool({
		id: "call-read",
		ts: at(8),
		toolName: "read",
		intent: "Reading the March invoice export",
		args: { path: "invoices/march.csv" },
		output:
			"date,customer,amount,status\n2026-03-02,Northwind Traders,1240.00,paid\n2026-03-05,Contoso,2310.00,unpaid\n2026-03-09,Fabrikam,1150.00,unpaid\n2026-03-11,Contoso,2510.00,pending\n",
		durationS: 0.04,
	}),
	tool({
		id: "call-sum",
		ts: at(8),
		toolName: "bash",
		intent: "Summing the unpaid rows by customer",
		args: { command: "python reconcile.py --group customer" },
		output:
			"customer\nContoso    4820.00\nFabrikam   1150.00\nName: amount, dtype: float64",
		durationS: 1.3,
	}),
	assistant(
		"a0",
		"The export is loaded and the unpaid rows are grouped. Writing the summary report now.",
		7,
	),
	tool({
		id: "call-write",
		ts: at(6),
		toolName: "write",
		intent: "Writing the summary report",
		args: { path: "reports/unpaid-march.md" },
		output: "Written 14 lines to reports/unpaid-march.md",
		durationS: 0.03,
	}),
	assistant(
		"a1",
		"Two customers are outstanding at the end of March: **Contoso** — 4,820.00, and **Fabrikam** — 1,150.00, for **5,970.00** in total. Two Contoso rows are marked `pending` rather than `unpaid` and I have left them out of the total until you say otherwise. The write-up is at `reports/unpaid-march.md`, and a reviewer is checking the arithmetic.",
		5,
	),
	user("u2", "Did Contoso pay overnight?", 2),
	tool({
		id: "call-reread",
		ts: at(1),
		toolName: "read",
		intent: "Re-reading the export",
		args: { path: "invoices/march.csv" },
		output:
			"date,customer,amount,status\n2026-03-05,Contoso,2310.00,unpaid\n2026-03-09,Fabrikam,1150.00,unpaid\n",
		durationS: 0.05,
	}),
	assistant(
		"a2",
		"Not yet — the Contoso row still reads `unpaid`. I will keep it in the follow-up list.",
		1,
	),
];

export const ChatTrace: Story = {
	render: () => {
		installWorldBridge();
		installFetch();
		return <ChatTraceScene />;
	},
};

const ChatTraceScene = () => {
	const containerRef = useRef<HTMLDivElement>(null);
	return (
		<PageFrame>
			<div
				ref={containerRef}
				className="mx-auto flex h-full w-full max-w-[900px] flex-col overflow-hidden px-8 py-6"
			>
				<CanonicalTranscript
					transcript={transcriptOf(TRACE_CONVERSATION)}
					frontend={null}
					gate={null}
					waiting={false}
					starting={false}
					loadingOlder={false}
					onLoadOlder={async () => true}
					containerRef={containerRef}
					isSmallView={false}
					status="live"
					failure={null}
					awaitingHydration={false}
					conversationId={`${CONVERSATION_ID}-trace`}
					onReconnect={() => {}}
				/>
			</div>
			<ExpandReceipt marker="reconcile.py" />
		</PageFrame>
	);
};
