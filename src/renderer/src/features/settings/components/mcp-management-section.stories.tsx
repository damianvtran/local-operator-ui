/**
 * Settings > Integrations, in every state the redesign has to get right.
 *
 * Every story drives the PRODUCTION section - its real hook, query, grouping,
 * rows, overflow, dialogs and add form - with the one thing a browser cannot
 * have: `window.api.desktop.request`, the preload bridge `desktopRequest`
 * prefers. The bridge answers the ops the section issues and refuses anything
 * else by name, so a story that starts issuing a new op fails loudly.
 *
 * Two families:
 *
 * - CATALOG stories serve `features.mcp_catalog: 1` and a catalog document in
 *   the backend contract's own field names (architect doc § 5, as amended by the
 *   backend coder's deltas). Nothing in them has a conversation: that is the
 *   point of the sessionless route.
 * - The `DeepLink*`, `Filtered*`, `NoSessionFallback` and `NoSessionsAtAll`
 *   stories keep their ids (`scripts/capture-evidence.mjs` names them); the
 *   last two serve ONLY `features.mcp` so they photograph the fallback route an
 *   older backend still gets.
 *
 * What the frames are about, and their limit: they are evidence about the
 * RENDERER. Whether the real backend serves these documents is QA's job against
 * a real app.
 */

import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { useEffect } from "react";
import type { DesktopResponse } from "../../../../../shared/desktop-contract";
import type {
	DesktopMcpState,
	McpCatalog,
	McpCatalogOperation,
	McpCatalogRow,
} from "../../../../../shared/desktop-control-contract";
import { IntegrationKeyDialog } from "./integrations/integration-key-dialog";
import { McpManagementSection } from "./mcp-management-section";

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string; control?: { action?: string } };
type RosterRow = { id: string; name: string; mtime: number };

let bridge: ((request: BridgeRequest) => Promise<DesktopResponse>) | null =
	null;

const ok = <T,>(result: T): DesktopResponse => ({
	status: 200,
	body: { result },
});

/**
 * A request that never answers, for the loading-and-in-flight frames: a
 * promise nothing resolves keeps the section in exactly the state a slow
 * backend would.
 */
const never = () => new Promise<DesktopResponse>(() => undefined);

const installBridge = (handlers: {
	catalog?: McpCatalog;
	/** What a catalog POST answers with; defaults to the same document. */
	onControl?: (request: BridgeRequest) => Promise<DesktopResponse>;
	/** Serve the older session route instead of the catalog. */
	session?: DesktopMcpState;
	roster?: RosterRow[];
	/** What a conversation's own snapshot answers, for the cwd resolution (Q1). */
	snapshotCwd?: string;
	loading?: boolean;
}) => {
	const { session, roster = [] } = handlers;
	/*
	 * STATEFUL, like the backend: a POST's answer becomes what the next GET
	 * returns. The section polls while an operation runs, so a bridge that kept
	 * answering the original document would overwrite the POST's answer two
	 * seconds later and photograph a state no backend produces.
	 */
	let current = handlers.catalog;
	const catalog = handlers.catalog;
	const remember = (response: DesktopResponse): DesktopResponse => {
		const data = (response.body as { result?: { data?: McpCatalog } } | null)
			?.result?.data;
		if (response.status === 200 && data && Array.isArray(data.servers)) {
			const { operation: _started, ...document } = data;
			current = document;
		}
		return response;
	};
	bridge = async (request) => {
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: catalog ? { mcp: 1, mcp_catalog: 1 } : { mcp: 1 },
				});
			case "mcp.catalog":
				if (handlers.loading) return never();
				return ok({ data: current, replayed: false });
			case "mcp.catalog.control":
				if (handlers.onControl)
					return remember(await handlers.onControl(request));
				return ok({ data: { ...current, operation: null }, replayed: false });
			case "mcp.list":
				return ok({ data: session, replayed: false });
			case "sessions.list":
				return ok({ sessions: roster, truncated: false });
			case "sessions.get":
				/*
				 * The roster row carries no cwd, so a chat this renderer did not
				 * create has its folder resolved from here (Q1). A story that sets
				 * neither this nor a roster row's cwd is the honest unknown-folder
				 * case, and the page asks for the home catalog.
				 */
				return ok({
					payload: {
						frontend: {
							snapshot: handlers.snapshotCwd
								? { cwd: handlers.snapshotCwd }
								: {},
						},
						history: { entries: [] },
						cold: true,
					},
				});
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
			if (!bridge) throw new Error("no bridge installed for this story");
			return bridge(request);
		},
	};
}

/* --------------------------------------------------------------- fixtures */

const HOME = "/Users/alex";
const GLOBAL_FILE = `${HOME}/.local-operator/mcp.json`;

/** One catalog row with sensible defaults, overridden per state. */
const row = (
	name: string,
	overrides: Partial<McpCatalogRow> = {},
): McpCatalogRow => ({
	id: name,
	name,
	scope: "global",
	project_cwd: null,
	source: {
		kind: "local-operator",
		path: GLOBAL_FILE,
		editable: true,
		owned_scope: "global",
	},
	transport: "remote_url",
	endpoint: {
		command: null,
		url: `https://${name}.example.com/mcp`,
		endpoint_redacted: false,
	},
	status: "not_started",
	status_reason: null,
	status_observed_at: null,
	status_basis: "stored",
	auth: { kind: "none", signed_in: null, secret_refs: [] },
	tool_count: null,
	tool_count_basis: null,
	actions: ["test", "remove"],
	...overrides,
});

const CONNECTED_NOTION = row("notion", {
	status: "connected",
	status_basis: "probe",
	status_observed_at: 1_760_000_000,
	auth: { kind: "oauth", signed_in: true, secret_refs: [] },
	tool_count: 12,
	tool_count_basis: "probe",
	actions: ["test", "reauth", "sign_out", "remove"],
});

const NEEDS_SIGN_IN_LINEAR = row("linear", {
	status: "needs_sign_in",
	auth: { kind: "oauth", signed_in: false, secret_refs: [] },
	actions: ["test", "sign_in", "remove"],
});

const NEEDS_KEY_BRAVE = row("brave-search", {
	transport: "local_command",
	endpoint: { command: "npx", url: null, endpoint_redacted: false },
	status: "needs_sign_in",
	auth: {
		kind: "api_key",
		signed_in: false,
		secret_refs: [{ id: "BRAVE_API_KEY", state: "missing" }],
	},
	actions: ["test", "set_key", "remove"],
});

const ERROR_FILESYSTEM = row("filesystem", {
	transport: "local_command",
	endpoint: { command: "npx", url: null, endpoint_redacted: false },
	status: "error",
	status_basis: "probe",
	status_observed_at: 1_760_000_000,
	status_reason:
		"The command exited before it started: npx: command not found.",
	actions: ["test", "remove"],
});

const READY_ECHO = row("echo", {
	transport: "local_command",
	endpoint: { command: "python3", url: null, endpoint_redacted: false },
	tool_count: 1,
	tool_count_basis: "last_seen",
	actions: ["test", "remove"],
});

const IMPORTED_GITLAB = row("gitlab", {
	source: {
		kind: "codex",
		path: `${HOME}/.codex/config.toml`,
		editable: false,
		owned_scope: null,
	},
	actions: ["test"],
});

const PROJECT_POSTGRES = row("postgres", {
	scope: "project",
	project_cwd: `${HOME}/code/billing`,
	transport: "local_command",
	endpoint: { command: "uvx", url: null, endpoint_redacted: false },
	source: {
		kind: "local-operator",
		path: `${HOME}/code/billing/.local-operator/mcp.json`,
		editable: true,
		owned_scope: "project",
	},
});

/**
 * A remote server that needs a key. The backend's own shape for this row
 * (#1511 `aa927158a`): `add_key` REPLACES `sign_in` for a server it owns that
 * declares no reference, so a page that still offered sign-in here would be
 * offering a button that cannot work.
 */
const NEEDS_A_KEY_ACME = row("acme-api", {
	status: "needs_sign_in",
	auth: { kind: "api_key", signed_in: false, secret_refs: [] },
	actions: ["test", "add_key", "remove"],
});

/**
 * A live runtime's row: a chat has this server configured and is not connected.
 * `not_started` with a LIVE basis is not "Ready" (F3).
 */
const LIVE_NOT_CONNECTED = row("notion", {
	status: "not_started",
	status_basis: "live",
	auth: { kind: "oauth", signed_in: true, secret_refs: [] },
	actions: ["test", "connect", "sign_out", "remove"],
});

const catalog = (
	servers: McpCatalogRow[],
	overrides: Partial<McpCatalog> = {},
): McpCatalog => ({
	cwd: HOME,
	project_scope_available: false,
	global_path: GLOBAL_FILE,
	project_path: null,
	status_source: "config",
	session_id: null,
	servers,
	operations: [],
	...overrides,
});

const MIXED = catalog([
	CONNECTED_NOTION,
	READY_ECHO,
	NEEDS_SIGN_IN_LINEAR,
	IMPORTED_GITLAB,
	ERROR_FILESYSTEM,
]);

const op = (
	name: string,
	overrides: Partial<McpCatalogOperation> = {},
): McpCatalogOperation => ({
	id: "a".repeat(32),
	name,
	action: "login",
	status: "running",
	created_at: 1_760_000_100,
	credential_removed: false,
	browser_opened: null,
	authorization_url: null,
	message: null,
	...overrides,
});

/* --------------------------------------------------------------- ground */

/**
 * The key dialog as the keyless case mounts it, held open for a still.
 *
 * Rendered directly because the state is reached by a press that a story cannot
 * make (the page only opens it after a refused sign-in), and the dialog's own
 * behaviour is what this frame is about.
 */
const KeylessKeyDialog = () => (
	<div className="min-h-screen bg-canvas p-6">
		<div className="mx-auto w-full max-w-3xl">
			<IntegrationKeyDialog
				name="acme-api"
				keyNames={[]}
				keyless
				saving={false}
				failure={null}
				onSave={() => undefined}
				onClose={() => undefined}
			/>
		</div>
	</div>
);

const Ground = ({
	highlight,
	active = null,
	roster = NO_ROSTER,
}: {
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

const NO_ROSTER: RosterRow[] = [];
const ROSTER: RosterRow[] = [
	{ id: "a1b2c3d4e5f6", name: "Invoice reconciliation", mtime: 1_760_000_000 },
	{ id: "0f0e0d0c0b0a", name: "RFP drafting", mtime: 1_759_000_000 },
];

const meta: Meta = {
	title: "Settings/Integrations",
	parameters: { layout: "fullscreen" },
};
export default meta;

type Story = StoryObj;

/* ------------------------------------------------------------------ */
/* The catalog route: no conversation needed                           */
/* ------------------------------------------------------------------ */

/** Nothing configured: the empty state, with its one call to action. */
export const Empty: Story = {
	render: () => {
		installBridge({ catalog: catalog([]) });
		return <Ground />;
	},
};

/** The list still loading: the section's own spinner, no rows guessed at. */
export const Loading: Story = {
	render: () => {
		installBridge({ catalog: catalog([]), loading: true });
		return <Ground />;
	},
};

/**
 * Every group at once: needs attention (sign-in, error with its reason),
 * connected (with a proper "12 tools"), ready (with "1 tool last time"), and a
 * row imported from Codex CLI.
 */
export const MixedStates: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
};

/** A remote server that needs a browser sign-in, and a local one that needs a key. */
export const NeedsSignIn: Story = {
	render: () => {
		installBridge({
			catalog: catalog([
				NEEDS_SIGN_IN_LINEAR,
				NEEDS_KEY_BRAVE,
				CONNECTED_NOTION,
			]),
		});
		return <Ground />;
	},
};

/** A server that could not start, with the backend's own reason under it. */
export const ErrorWithReason: Story = {
	render: () => {
		installBridge({
			catalog: catalog([
				ERROR_FILESYSTEM,
				row("sentry", {
					status: "error",
					status_basis: "probe",
					status_reason: null,
					actions: ["test", "remove"],
				}),
				READY_ECHO,
			]),
		});
		return <Ground />;
	},
};

/**
 * A status this build does not recognise. The backend's `status` vocabulary is
 * the backend's to extend, and falling through to "Ready" would be this app
 * claiming a row is fine on the strength of not knowing the word - so the row
 * says the status could not be read, offers the one control that can answer it,
 * and is NOT filed under Needs attention.
 */
export const UnknownStatus: Story = {
	render: () => {
		installBridge({
			catalog: catalog([
				{ ...READY_ECHO, status: "signed_out" as McpCatalogRow["status"] },
				CONNECTED_NOTION,
			]),
		});
		return <Ground />;
	},
};

/** A test running: spinner in place of the dot, "Connecting…", no action to press twice. */
export const Connecting: Story = {
	render: () => {
		installBridge({
			catalog: catalog(
				[
					{ ...READY_ECHO, status: "connecting", status_basis: "probe" },
					CONNECTED_NOTION,
				],
				{ operations: [op("echo", { action: "test" })] },
			),
		});
		return <Ground />;
	},
};

/** The overflow menu open on a connected row: the secondary actions, Remove last. */
export const OverflowOpen: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
	play: async () => {
		const trigger = await screen.findByLabelText("More actions for notion");
		await userEvent.click(trigger);
		await screen.findByRole("menuitem", { name: "Remove" });
	},
};

/** An imported row's overflow: Remove is present but disabled, and says where. */
export const OverflowImported: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
	play: async () => {
		const trigger = await screen.findByLabelText("More actions for gitlab");
		await userEvent.click(trigger);
		await screen.findByText("Remove in Codex CLI");
	},
};

/** Remove asks inline before it writes anything. */
export const RemoveConfirm: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByLabelText("More actions for echo"),
		);
		await userEvent.click(
			await screen.findByRole("menuitem", { name: "Remove" }),
		);
		await screen.findByText("Remove echo?");
	},
};

/** A project cwd: scope becomes worth saying, and project rows say so. */
export const ProjectScope: Story = {
	render: () => {
		installBridge({
			catalog: catalog([PROJECT_POSTGRES, CONNECTED_NOTION, READY_ECHO], {
				cwd: `${HOME}/code/billing`,
				project_scope_available: true,
				project_path: `${HOME}/code/billing/.local-operator/mcp.json`,
			}),
		});
		return <Ground />;
	},
};

/** The add form, empty. */
export const AddForm: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Add integration" }),
		);
		await screen.findByLabelText("Name");
	},
};

/**
 * The add form after a submit with a bad name and two URLs pasted together -
 * the shape the backend accepted on the walk (N3).
 */
export const AddFormValidation: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Add integration" }),
		);
		await userEvent.type(await screen.findByLabelText("Name"), "my server");
		await userEvent.click(screen.getByRole("button", { name: "Remote URL" }));
		await userEvent.type(
			screen.getByLabelText("URL"),
			"https://a.example.com/mcphttps://b.example.com/mcp",
		);
		const submits = screen.getAllByRole("button", { name: "Add integration" });
		await userEvent.click(submits[submits.length - 1]);
		await screen.findByText(/two URLs pasted together/);
	},
};

/** The add form refused by the backend with a bounded code, worded. */
export const AddFormRefused: Story = {
	render: () => {
		installBridge({
			catalog: MIXED,
			onControl: async () => ({
				status: 409,
				body: { detail: { code: "write_failed", message: "write failed" } },
			}),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Add integration" }),
		);
		await userEvent.type(await screen.findByLabelText("Name"), "weather");
		await userEvent.type(screen.getByLabelText("Command"), "uvx");
		const submits = screen.getAllByRole("button", { name: "Add integration" });
		await userEvent.click(submits[submits.length - 1]);
		await screen.findByText(/couldn't be written/);
	},
};

/** The sign-in dialog before the press: what WILL happen, nothing claimed yet. */
export const SignInReady: Story = {
	render: () => {
		installBridge({
			catalog: catalog([NEEDS_SIGN_IN_LINEAR, CONNECTED_NOTION]),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Sign in/ }),
		);
		await screen.findByText(/opens your browser/);
	},
};

/**
 * Signing in, with the backend reporting the browser opened: the row says
 * "Signing in…" and the dialog says the browser opened - only because the
 * operation says so.
 */
export const SigningIn: Story = {
	render: () => {
		const running = op("linear", { browser_opened: true });
		installBridge({
			catalog: catalog([NEEDS_SIGN_IN_LINEAR, CONNECTED_NOTION]),
			onControl: async () =>
				ok({
					data: {
						...catalog([NEEDS_SIGN_IN_LINEAR, CONNECTED_NOTION], {
							operations: [running],
						}),
						operation: running,
					},
					replayed: false,
				}),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Sign in/ }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Continue in browser" }),
		);
		await screen.findByText(/Your browser opened/);
	},
};

/** The launcher could not open a browser: the link, to open by hand. */
export const SignInNoBrowser: Story = {
	render: () => {
		const running = op("linear", {
			browser_opened: false,
			authorization_url:
				"https://linear.example.com/oauth/authorize?client_id=local-operator",
		});
		installBridge({
			catalog: catalog([NEEDS_SIGN_IN_LINEAR]),
			onControl: async () =>
				ok({
					data: {
						...catalog([NEEDS_SIGN_IN_LINEAR], { operations: [running] }),
						operation: running,
					},
					replayed: false,
				}),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Sign in/ }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Continue in browser" }),
		);
		await screen.findByText(/didn't open/);
	},
};

/** A sign-in that failed, with the backend's sanitized reason. */
export const SignInFailed: Story = {
	render: () => {
		const failed = op("linear", {
			status: "failed",
			message: "The server rejected the redirect address.",
		});
		installBridge({
			catalog: catalog([NEEDS_SIGN_IN_LINEAR]),
			onControl: async () =>
				ok({
					data: {
						...catalog([NEEDS_SIGN_IN_LINEAR], { operations: [failed] }),
						operation: failed,
					},
					replayed: false,
				}),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Sign in/ }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Continue in browser" }),
		);
		await screen.findByText(/Sign-in didn't finish/);
	},
};

/*
 * The phase a COMPLETED sign-in lands in, which had no rendered state at all
 * (D17, round 2). D3's focus rule sends this phase's lead to `Done`, and the
 * mapping was pinned through the pure `signInFocusTarget` - so a regression in
 * what the frame DRAWS would have reached a user unseen. It also renders the
 * U12 case the walk found: closing it leaves a row with no primary action.
 *
 * The row is the catalog's own document with the operation settled, which is
 * what the page polls while a sign-in runs; the row itself still reads
 * `Needs sign-in` until that read comes back.
 */
export const SignInDone: Story = {
	render: () => {
		const complete = op("linear", { status: "complete" });
		installBridge({
			catalog: catalog([NEEDS_SIGN_IN_LINEAR, CONNECTED_NOTION]),
			onControl: async () =>
				ok({
					data: {
						...catalog([NEEDS_SIGN_IN_LINEAR, CONNECTED_NOTION], {
							operations: [complete],
						}),
						operation: complete,
					},
					replayed: false,
				}),
		});
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Sign in/ }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Continue in browser" }),
		);
		await screen.findByText(/Signed in to linear/);
		await screen.findByRole("button", { name: "Done" });
	},
};

/** The key dialog for a server whose config references a secret. */
export const AddKey: Story = {
	render: () => {
		installBridge({ catalog: catalog([NEEDS_KEY_BRAVE, CONNECTED_NOTION]) });
		return <Ground />;
	},
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /^Add key/ }),
		);
		await screen.findByLabelText("BRAVE_API_KEY");
	},
};

/* ------------------------------------------------------------------ */
/* Discovery: the deep link                                            */
/* ------------------------------------------------------------------ */

/** `/mcp linear` - the named row is revealed with the row-selected ground. */
export const DeepLinkHit: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground highlight="linear" />;
	},
};

/** `/mcp reauth linear` resolves to the same row: the verb is not a server. */
export const DeepLinkVerbHit: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground highlight="reauth linear" />;
	},
};

/** A server named like a verb: the resolution says which row it landed on. */
export const DeepLinkVerbShadowed: Story = {
	render: () => {
		installBridge({
			catalog: catalog([
				...MIXED.servers,
				row("login", {
					status: "connected",
					tool_count: 4,
					tool_count_basis: "probe",
				}),
			]),
		});
		return <Ground highlight="login linea" />;
	},
};

/** An argument that names nothing: stated, with the list intact below it. */
export const DeepLinkMiss: Story = {
	render: () => {
		installBridge({ catalog: MIXED });
		return <Ground highlight="reauth linearx" />;
	},
};

/* ------------------------------------------------------------------ */
/* Search, from six rows up                                             */
/* ------------------------------------------------------------------ */

const SEVEN = catalog([...MIXED.servers, NEEDS_KEY_BRAVE, row("sentry")]);

export const Filtered: Story = {
	render: () => {
		installBridge({ catalog: SEVEN });
		return <Ground />;
	},
	play: async () => {
		await userEvent.type(
			await screen.findByLabelText("Search integrations"),
			"n",
		);
	},
};

export const FilteredEmpty: Story = {
	render: () => {
		installBridge({ catalog: SEVEN });
		return <Ground />;
	},
	play: async () => {
		await userEvent.type(
			await screen.findByLabelText("Search integrations"),
			"zzz",
		);
	},
};

/** The catalog's empty state, under the id the evidence table already names. */
export const NoServers: Story = Empty;

/** A sign-out in flight: the row says what it is doing, not "Connecting…" (U2). */
export const SigningOut: Story = {
	render: () => {
		installBridge({
			catalog: catalog([CONNECTED_NOTION], {
				operations: [
					op("notion", {
						action: "logout",
						status: "running",
						browser_opened: null,
					}),
				],
			}),
		});
		return <Ground />;
	},
};

/**
 * Signed out: the credential is gone, so the row says so and leads with Sign in
 * rather than decaying into the idle word (U2).
 */
export const SignedOut: Story = {
	render: () => {
		installBridge({
			catalog: catalog(
				[
					row("notion", {
						status: "not_started",
						status_basis: "stored",
						auth: { kind: "oauth", signed_in: false, secret_refs: [] },
						actions: ["test", "sign_in", "remove"],
					}),
				],
				{
					operations: [
						op("notion", {
							action: "logout",
							status: "complete",
							credential_removed: true,
						}),
					],
				},
			),
		});
		return <Ground />;
	},
};

/**
 * A server with no OAuth discovery: the sign-in came back saying so, and the row
 * offers the key that can actually work (U3).
 */
export const NeedsAKey: Story = {
	render: () => {
		installBridge({
			catalog: catalog([NEEDS_A_KEY_ACME], {
				operations: [
					op("acme-api", {
						status: "failed",
						message:
							"No OAuth authorization server was discovered for this server; check its URL and your network, or add its key instead.",
					}),
				],
			}),
		});
		return <Ground />;
	},
};

/** A live chat's idle row: "Not connected", with Connect as its one action (F3). */
export const NotConnected: Story = {
	render: () => {
		installBridge({ catalog: catalog([LIVE_NOT_CONNECTED]) });
		return <Ground />;
	},
};

/**
 * The key dialog for a server whose config declares no reference (U3): it asks
 * for the key's NAME as well, and offers no "replace" checkbox because there is
 * nothing saved to replace (D10).
 */
export const AddKeyWithoutAReference: Story = {
	render: () => {
		installBridge({ catalog: catalog([NEEDS_A_KEY_ACME]) });
		return <KeylessKeyDialog />;
	},
};

/* ------------------------------------------------------------------ */
/* An older backend: the session route, rendered through the same rows  */
/* ------------------------------------------------------------------ */

const LEGACY: DesktopMcpState = {
	servers: [
		{
			name: "cloudflare",
			source: GLOBAL_FILE,
			owned_scope: "global",
			status: "connected",
			transport: "http",
			tool_count: 9,
		},
		{
			name: "hubspot",
			source: GLOBAL_FILE,
			owned_scope: "global",
			status: "auth-required",
			transport: "http",
		},
		{
			name: "echo",
			source: GLOBAL_FILE,
			owned_scope: "global",
			status: "cold",
			transport: "stdio",
			transport_oauth_supported: false,
		},
		{
			name: "gitlab",
			source: `${HOME}/.codex/config.toml`,
			owned_scope: null,
			status: "cold",
			transport: "http",
		},
	],
	operations: [],
	cold: true,
};

/** No catalog capability and no chat open: the newest chat is borrowed, and said. */
export const NoSessionFallback: Story = {
	render: () => {
		installBridge({ session: LEGACY, roster: ROSTER });
		return <Ground />;
	},
	play: async () => {
		await screen.findByText(/your most recent chat/);
	},
};

/** No catalog capability and no chat at all: the one step an update removes. */
export const NoSessionsAtAll: Story = {
	render: () => {
		installBridge({ session: LEGACY, roster: NO_ROSTER });
		return <Ground />;
	},
};
