import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { Meta, StoryObj } from "@storybook/react";
import { useEffect, useState } from "react";
import statusFixture from "../../../../../../scripts/fixtures/agent-messages-status.json";
import "../../../styles/index.css";
import { CommandPalette } from "./command-palette";

/**
 * The command palette answering Team Bridge queries (operator, 2026-11-04:
 * "make team bridge and the various channels, groups, DMs, etc available
 * through the command palette").
 *
 * THE TRANSPORT IS STUBBED, THE HOOKS ARE REAL. `window.api.desktop.request`
 * answers the capability, account, bridge status, conversation list, directory
 * and unread reads the rail itself makes, so the rows are produced by the same
 * hooks and cache keys as in the app (`use-palette-team-bridge.ts`). An op
 * nobody stubbed answers 404 rather than an empty success, so a palette that
 * grows a read photographs its absence instead of a fake empty state.
 *
 * The fixture is two organizations, because the organization caption is only
 * drawn for a reader in more than one; `SingleOrg` is the same world with one.
 */

const ACCOUNT = "acct_damian";
const MINERVA = "tnt_minerva";
const RADIENT = "tnt_radient";
const NOW = "2026-11-04T15:00:00Z";

const ok = (result: unknown) => ({ status: 200, body: { result } });

const participant = (
	account: string,
	label: string,
	kind: "human" | "agent" = "human",
) => ({
	account_id: account,
	kind,
	display_label: label,
	role: "member",
	state: "active",
});

const conversation = (
	id: string,
	tenant: string,
	kind: "channel" | "group" | "dm",
	fields: Record<string, unknown> = {},
) => ({
	id,
	tenant_id: tenant,
	kind,
	visibility: kind === "channel" ? "tenant" : "private",
	agent_capable: true,
	status: "open",
	created_by: ACCOUNT,
	last_message_at: NOW,
	latest_seq: 4,
	members: [participant(ACCOUNT, "Damian Tran")],
	last_read_seq: 4,
	unread_count: 0,
	muted: false,
	member: true,
	...fields,
});

const CONVERSATIONS = [
	conversation("ch_general_m", MINERVA, "channel", {
		name: "general",
		builtin: "general",
	}),
	conversation("ch_retention", MINERVA, "channel", {
		name: "retention-analysis",
		unread_count: 3,
		last_read_seq: 1,
	}),
	conversation("ch_launch", MINERVA, "channel", { name: "launch-review" }),
	conversation("grp_design", MINERVA, "group", { name: "Design crew" }),
	conversation("dm_ola", MINERVA, "dm", {
		name: undefined,
		unread_count: 1,
		last_read_seq: 3,
		members: [
			participant(ACCOUNT, "Damian Tran"),
			participant("acct_ola", "Ola Fagbemi"),
		],
	}),
	conversation("ch_general_r", RADIENT, "channel", {
		name: "general",
		builtin: "general",
	}),
	conversation("ch_releases", RADIENT, "channel", { name: "releases" }),
];

const person = (account: string, label: string, agent?: string) => ({
	account_id: account,
	display_label: label,
	role: "member",
	bridge_enabled: true,
	bridge_state: "active",
	...(agent
		? { agent: { endpoint_id: `ep_${account}`, name: agent, state: "active" } }
		: {}),
});

const DIRECTORIES: Record<string, unknown[]> = {
	[MINERVA]: [
		person(ACCOUNT, "Damian Tran"),
		person("acct_ola", "Ola Fagbemi", "Aida"),
		person("acct_ben", "Ben Okafor", "Aida"),
		person("acct_priya", "Priya Raman"),
	],
	[RADIENT]: [
		person(ACCOUNT, "Damian Tran"),
		person("acct_sam", "Sam Lee", "Atlas"),
	],
};

/*
 * The operator's own roster row (2026-11-04 screenshot): the `manager` role
 * agent, with the tags it really carries. Those tags are what the old palette
 * threaded "bridge" through as a loose subsequence (b in glob, r in grep, ...),
 * so the BEFORE frame reproduces the report and the AFTER frame shows it gone.
 */
const MANAGER_AGENT = {
	id: "agent-manager",
	name: "manager",
	description: "Coordinating and tracking multi-part work.",
	tags: [
		"role",
		"tools:read,glob,grep,list_variables,read_variable,bash,todo",
		"delegate:yes",
	],
	working_directory: "/tmp/manager",
	created_at: "2026-01-01T00:00:00Z",
	updated_at: "2026-01-01T00:00:00Z",
};

const installBridge = ({ orgs }: { orgs: string[] }) => {
	/*
	 * The roster's connectivity gate asks `/health` over plain fetch
	 * (`RosterFrame`, `command-palette.stories.tsx`); everything else falls
	 * through to the real fetch so an unexpected read fails loudly.
	 */
	const realFetch = window.fetch.bind(window);
	window.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
		const url = typeof input === "string" ? input : String(input);
		if (url.includes("/health"))
			return new Response(
				JSON.stringify({ result: { status: "ok", version: "0.0.0-story" } }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		return realFetch(input as RequestInfo, init);
	}) as typeof window.fetch;
	const tenants = [
		{
			tenant_id: MINERVA,
			tenant_name: "Minerva",
			eligible: true,
			endpoint: null,
		},
		{
			tenant_id: RADIENT,
			tenant_name: "Radient",
			eligible: true,
			endpoint: null,
		},
	].filter((row) => orgs.includes(row.tenant_id));
	const handler = async (request: {
		op: string;
		tenant_id?: string;
		scope?: string;
		control?: { operation?: string };
		q?: string;
	}) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: {
						profile_catalogue: 1,
						team_catalogue: 1,
						session_catalogue: 2,
						// Search answered (with no hits) so the frame carries no "update to
						// search inside conversations" notice that is not this change's.
						session_search: 1,
						radient: 1,
						team_bridge: 1,
						team_bridge_conversations: 1,
						team_bridge_conversation_owner_guard: 1,
						settings: 1,
					},
				});
			case "radient.request":
				if (request.control?.operation === "memberships.list")
					return ok({ data: { msg: "ok", result: { memberships: [] } } });
				return ok({
					data: {
						msg: "ok",
						result: {
							account: {
								id: ACCOUNT,
								name: "Damian Tran",
								email: "d@x.invalid",
							},
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
					status: { ...statusFixture.status, tenants },
				});
			case "team_bridge.conversations.list":
				return ok({
					conversations: CONVERSATIONS.filter((row) =>
						orgs.includes(row.tenant_id),
					),
				});
			case "team_bridge.directory":
				return ok({ members: DIRECTORIES[request.tenant_id ?? ""] ?? [] });
			case "team_bridge.unread":
				return ok({ total: 4, conversations: [], organizations: [] });
			case "settings.list":
				return ok({ settings: [] });
			case "sessions.list":
				return ok({ sessions: [], total: 0 });
			case "sessions.search":
				return ok({ sessions: [], query: request.q ?? "", limit: 50 });
			case "legacy.agents.list":
				return ok({
					agents: [MANAGER_AGENT],
					total: 1,
					page: 1,
					per_page: 100,
				});
			case "profiles.list":
				return ok({ profiles: [] });
			case "teams.list":
				return ok({ teams: [] });
			default:
				return {
					status: 404,
					body: { detail: `palette bridge story: ${request.op}` },
				};
		}
	};
	const page = window as unknown as {
		api?: { desktop?: { request: typeof handler } };
	};
	const api = page.api ?? {};
	page.api = api;
	api.desktop = { request: handler } as never;
};

/**
 * Install the bridge, then open the palette on the query. The close-then-open
 * and one-commit deferral are `RosterFrame`'s (`command-palette.stories.tsx`),
 * for the same two measured reasons: a persisted-open store would make the
 * toggle CLOSE the palette, and the palette must not mount before the stub.
 */
const BridgeFrame = ({
	query,
	orgs = [MINERVA, RADIENT],
}: {
	query: string;
	orgs?: string[];
}) => {
	const [ready, setReady] = useState(false);
	useEffect(() => {
		installBridge({ orgs });
		const store = useUiPreferencesStore.getState();
		store.closeCommandPalette();
		store.toggleCommandPalette(query);
		setReady(true);
		return () => useUiPreferencesStore.getState().closeCommandPalette();
	}, [query, orgs]);
	if (!ready) return null;
	return <CommandPalette />;
};

const meta: Meta<{ query: string }> = {
	title: "Command palette/Team Bridge results",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj<{ query: string }>;

/** The reported query: the destination leads, then the bridge's own rows. */
export const ProductName: Story = {
	render: () => <BridgeFrame query="team bridge" />,
};

/** A channel by name; two organizations share `general`, so captions differ. */
export const Channel: Story = {
	render: () => <BridgeFrame query="retention" />,
};

/** A person by name: their row (opening their DM) and their chief of staff. */
export const Person: Story = {
	render: () => <BridgeFrame query="ola" />,
};

/** An agent by name: both chiefs called Aida, told apart by their owners. */
export const Agent: Story = {
	render: () => <BridgeFrame query="aida" />,
};

/** The word scope: `tb` narrows to the Team Bridge group alone. */
export const Scoped: Story = {
	render: () => <BridgeFrame query="tb general" />,
};

/** One organization: no organization caption on any row. */
export const SingleOrg: Story = {
	render: () => <BridgeFrame query="general" orgs={[MINERVA]} />,
};
