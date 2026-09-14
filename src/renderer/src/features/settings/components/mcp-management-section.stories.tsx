/**
 * The Integrations section, in the states a `/mcp` deep link and a first visit
 * can put it in.
 *
 * Why this file exists: every state in it is one the operator's own report was
 * about, and none of them is reachable by hand in a frame — `/mcp reauth hubspot`
 * needs a composer type, `?mcp=nosuchserver` needs a URL, and "no conversation is
 * open" needs the roster to be empty at mount. A story drives the PRODUCTION
 * section (not a story-shaped imitation) with the one thing a browser cannot have:
 * `window.api.desktop.request`, the preload bridge `desktop-api.desktopRequest`
 * prefers. Everything else is real — the real section, its real query, its real
 * search box, its real empty states, and the store's real `fetchSessions`.
 *
 * What the frames are about, and their limit. They are evidence about the
 * RENDERER: the payloads are fixtures shaped like `GET
 * /v1/desktop/sessions/{id}/mcp` and `sessions.list`, so `status` words and
 * scopes are the wire's, but the servers are not the operator's own. The section
 * reads the session-scoped route; whether the real backend serves those payloads
 * is QA's job against a real app, not a frame's.
 *
 * The `?mcp=` states are passed through the component's own prop (`highlightServer`
 * is the RAW argument, exactly as `settings-page.tsx` hands it over from
 * `?mcp=`), so `DeepLinkHit` really does run the resolution rule — the story does
 * not pre-resolve the name it wants to see.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { useEffect } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type { DesktopMcpState } from "../../../../../shared/desktop-control-contract";
import { McpManagementSection } from "./mcp-management-section";

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string };

/** One roster row, in `sessions.list`'s own field names (`id`/`name`/`mtime`). */
type RosterRow = { id: string; name: string; mtime: number };

/**
 * The desktop transport, stubbed.
 *
 * `desktopRequest` prefers `window.api.desktop.request` and falls back to
 * `fetch("/__desktop")`, which Storybook's dev server does not serve — so without
 * this every frame would photograph a transport error instead of the section.
 * It answers the three operations this surface issues and refuses anything else
 * by name, so a story that starts issuing a fourth read fails loudly rather than
 * hanging on a promise nothing resolves.
 */
let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const installBridge = (handlers: {
	servers: DesktopMcpState["servers"];
	roster?: RosterRow[];
}) => {
	const { servers, roster = [] } = handlers;
	const ok = <T,>(result: T): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	bridge = async (request) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					// The value the shipped backend advertises
					// (`server/routes/capabilities.py:18`); this surface reads only
					// `desktop_available` and `features.mcp`.
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { mcp: 1 },
				});
			case "mcp.list":
				// Lifecycle routes wrap their result as `{data, replayed?}` — the
				// envelope `mcp-list.ts` is the only module allowed to unwrap.
				return ok({
					data: { servers, operations: [] } satisfies DesktopMcpState,
					replayed: false,
				});
			case "sessions.list":
				return ok({ sessions: roster, truncated: false });
			default:
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
};

if (typeof window !== "undefined") {
	const page = window as unknown as {
		api?: {
			desktop?: { request: (r: BridgeRequest) => Promise<DesktopResponse> };
		};
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = {
		request: (request: BridgeRequest) => {
			if (!bridge) {
				throw new Error("no bridge installed for this story");
			}
			return bridge(request);
		},
	};
}

/* --------------------------------------------------------------- fixtures */

/**
 * The payload's own field names (`owned_scope`, `transport`), because the section
 * reads the wire's words: a fixture that renamed them would photograph a state
 * the real backend cannot produce.
 *
 * `hubspot` is the deep link's target and `slack` is the server whose transport
 * cannot do OAuth — the two names this section's copy distinguishes.
 */
const SERVERS: DesktopMcpState["servers"] = [
	{
		name: "cloudflare",
		source: "~/.local-operator/mcp.json",
		owned_scope: "global",
		status: "connected",
		transport: "http",
		tool_count: 9,
	},
	{
		name: "gitlab",
		source: "~/.codex/config.toml",
		owned_scope: null,
		status: "connected",
		transport: "http",
		tool_count: 23,
	},
	{
		name: "hubspot",
		source: "~/.local-operator/mcp.json",
		owned_scope: "global",
		status: "auth-required",
		transport: "http",
	},
	{
		name: "notion",
		source: ".mcp.json",
		owned_scope: "project",
		status: "connected",
		transport: "http",
		tool_count: 24,
	},
	{
		name: "slack",
		source: "~/.local-operator/mcp.json",
		owned_scope: "global",
		status: "disconnected",
		transport: "http",
	},
];

const ROSTER: RosterRow[] = [
	{ id: "a1b2c3d4e5f6", name: "Invoice reconciliation", mtime: 1_760_000_000 },
	{ id: "0f0e0d0c0b0a", name: "RFP drafting", mtime: 1_759_000_000 },
];

/**
 * A stable empty roster, so the ground's effect does not re-run on a fresh array.
 *
 * Not a tidiness point: `setState` with a new array identity on every render would
 * re-render the section once per commit for as long as the story was mounted.
 */
const NO_ROSTER: RosterRow[] = [];

/* --------------------------------------------------------------- ground */

/**
 * The section, on the page ground it is drawn on.
 *
 * The store is set rather than mocked because the section's own borrow (`D5`)
 * reads it, and the mounted copy is what makes the "no conversation" frame a real
 * one: `activeSessionId` is null, the roster starts empty, and the section calls
 * the store's own `fetchSessions` exactly as it does in the app.
 */
const Ground = ({
	highlight,
	active = "a1b2c3d4e5f6",
	roster = NO_ROSTER,
}: {
	/** The RAW `?mcp=` argument, as `settings-page.tsx` passes it. */
	highlight?: string;
	active?: string | null;
	roster?: RosterRow[];
}) => {
	useEffect(() => {
		useCanonicalSessionsStore.setState({
			sessions: roster.map(({ id, name, mtime }) => ({
				session_id: id,
				title: name,
				updated_at: mtime,
			})),
			activeSessionId: active,
			loading: false,
			error: null,
		});
	}, [roster, active]);
	return (
		<div className="min-h-screen bg-canvas p-6">
			<div className="mx-auto w-full max-w-3xl">
				<McpManagementSection
					sessionId={active ?? undefined}
					highlightServer={highlight}
				/>
			</div>
		</div>
	);
};

/**
 * Install the bridge a story needs and mount the ground.
 *
 * Called from each story's `render`, which runs for the story being previewed and
 * not for its siblings: `servedRoster` is what `sessions.list` ANSWERS with, which
 * is a different fact from `roster`, the state the store starts in. The two differ
 * in exactly one frame — `NoSessionFallback` starts empty and is answered with a
 * roster, which is the borrow D5 exists for.
 */
const mount = ({
	servers = SERVERS,
	active = "a1b2c3d4e5f6",
	roster = NO_ROSTER,
	servedRoster = ROSTER,
	highlight,
}: {
	servers?: DesktopMcpState["servers"];
	active?: string | null;
	roster?: RosterRow[];
	servedRoster?: RosterRow[];
	highlight?: string;
} = {}) => {
	installBridge({ servers, roster: servedRoster });
	return <Ground highlight={highlight} active={active} roster={roster} />;
};

const meta: Meta = {
	title: "Settings/Integrations",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* Discovery: the deep link                                            */
/* ------------------------------------------------------------------ */

/** `/mcp hubspot` — the named server is revealed and identified. */
export const DeepLinkHit: Story = {
	render: () => mount({ highlight: "hubspot" }),
};

/**
 * `/mcp reauth hubspot` — the operator's own remedy line.
 *
 * The whole argument arrives as one string and the section resolves it against the
 * loaded list (the last whitespace token that is a configured server name), which
 * is why this frame and `DeepLinkHit` land on the same row. The renderer holds no
 * copy of the backend's subcommand vocabulary.
 */
export const DeepLinkVerbHit: Story = {
	render: () => mount({ highlight: "reauth hubspot" }),
};

/**
 * The residual the resolution rule cannot fix, stated rather than hidden.
 *
 * A server may be NAMED like a verb, and no verb list may exist in this renderer:
 * with a server called `login` configured, `/mcp login hubspo` (a typo) matches
 * `login` — the last token that IS configured wins — and would reveal an unrelated
 * row in silence (code review round 1, finding 4). So a match the last token does
 * not explain says which server it resolved to, and the frame carries that line
 * beside the revealed row.
 */
export const DeepLinkVerbShadowed: Story = {
	render: () =>
		mount({
			highlight: "login hubspo",
			servers: [
				...SERVERS,
				{
					name: "login",
					source: "~/.local-operator/mcp.json",
					owned_scope: "global",
					status: "connected",
					transport: "http",
					tool_count: 4,
				},
			],
		}),
};

/**
 * An argument that names nothing: stated, with the list intact below it.
 *
 * This is the state the old effect reached with a silent `return` — no scroll, no
 * colour step, no message — which is what the operator reported as "it brings me
 * over to the settings but there's no hubspot listed there".
 */
export const DeepLinkMiss: Story = {
	render: () => mount({ highlight: "reauth hubspotx" }),
};

/* ------------------------------------------------------------------ */
/* No active conversation (D5)                                          */
/* ------------------------------------------------------------------ */

/**
 * No conversation open: the section borrows the newest roster row and says which.
 *
 * The sentence names the conversation on purpose — the statuses below are that
 * conversation's runtime's and `disconnect` is per-session — while the CREDENTIAL
 * is not: `~/.local-operator/auth.db` is shared, so a grant in one conversation
 * heals every other one. The roster is fetched through the store's own
 * `fetchSessions`, which is why this frame waits for the borrow.
 */
export const NoSessionFallback: Story = {
	render: () => mount({ active: null, roster: NO_ROSTER }),
	play: async () => {
		await screen.findByText(/your most recent conversation/);
	},
};

/**
 * No conversation at all — the one case the old dead-end line is still true in.
 *
 * The bridge ANSWERS `sessions.list` with an empty roster here, so the section's
 * borrow finds nothing and the line stands. That is the difference from
 * `NoSessionFallback`, and it is a fact about the machine rather than about the
 * page's willingness to help.
 */
export const NoSessionsAtAll: Story = {
	render: () =>
		mount({ active: null, roster: NO_ROSTER, servedRoster: NO_ROSTER }),
};

/* ------------------------------------------------------------------ */
/* The section's own search (D4)                                        */
/* ------------------------------------------------------------------ */

/** The filter narrowed the list, with the type still in the box. */
export const Filtered: Story = {
	render: () => mount(),
	play: async () => {
		const input = await screen.findByLabelText("Search MCP servers");
		await userEvent.type(input, "not");
	},
};

/**
 * A filter that matches nothing: the provider grid's own empty-state pair.
 *
 * Deliberately a different line from `DeepLinkMiss`: this one is about a filter
 * the reader typed, that one is about a name a command asked for.
 */
export const FilteredEmpty: Story = {
	render: () => mount(),
	play: async () => {
		const input = await screen.findByLabelText("Search MCP servers");
		await userEvent.type(input, "zzz");
	},
};

/* ------------------------------------------------------------------ */
/* Nothing configured                                                   */
/* ------------------------------------------------------------------ */

/** No servers configured, which is absence rather than an error. */
export const NoServers: Story = {
	render: () => mount({ servers: [] }),
};
