/**
 * MCP server management, replacing the legacy Gmail/Calendar/Drive cards.
 *
 * The old section ran an Electron Google OIDC flow that wrote GOOGLE_* keys
 * nothing reads. This surface instead drives the backend's MCP controls for
 * the selected session: the effective server list with its config scope,
 * add/remove (remove asks first), connect/disconnect/reload, and grant
 * login/status/cancel for HTTP servers whose transport can do OAuth. A stdio
 * server gets its server-supported setup action — offered as a prompt the
 * user may submit through the composer with ordinary gates — never a fake
 * browser login.
 *
 * "Transport connected" and "upstream account authorized" are different rows
 * of state: a healthy MCP connection does not prove the Google Workspace
 * account behind a server is authorized, and this panel never claims it does.
 * The wire carries no per-row authorization state to render — the backend
 * hard-codes `downstream_authorization: "unknown"` — so the fact is stated
 * once, in this section's description, rather than reprinted on every row.
 *
 * The row is read with the field names the backend actually sends
 * (`owned_scope`, `setup.text`, `status`); see `MCPServerRow`.
 *
 * Three things about how the operator ARRIVES here, all added together because
 * they are one flow — find the server, see which is broken, fix it:
 *
 * - `?mcp=<argument>` is RESOLVED against the loaded list rather than parsed as
 *   a grammar (`resolveMcpServerTarget`), so `/mcp reauth hubspot` lands on
 *   `hubspot`, and an argument that names nothing renders a line saying so. It
 *   used to be compared whole and silently dropped on a miss.
 * - The section has its own search box. It is not part of the settings search
 *   index, deliberately: that index is a typed-editor registry over backend
 *   settings keys, and these rows are a session-scoped live read.
 * - With no active conversation the section borrows the newest roster row and
 *   says which one, rather than dead-ending on a page whose whole job is to
 *   show the configured servers.
 */

import { compactPath } from "@features/chat/components/trace/tool-row-model";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	fetchMcpList,
	mcpKeys,
	mcpListServers,
} from "@shared/api/local-operator/mcp-list";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, PlugZap, RotateCw, Search, Trash2 } from "lucide-react";
import type { FC, RefObject } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DesktopMcpState } from "../../../../../shared/desktop-control-contract";
import { foreignMcpConfigOrigin } from "../../../../../shared/mcp-foreign-config-origin";
import { SettingsSection } from "./settings-section";

/**
 * One MCP server row, taken from the backend control DTO rather than restated
 * here.
 *
 * This file used to declare the row itself, with `scope`, `setup_prompt` and
 * `error`. None of the three has ever been on this wire, and nothing caught it:
 * every access was optional, so the scope badge never rendered, the "Copy setup
 * prompt" control was unreachable, an error line rendered a field that is never
 * sent, and removal asked for `scope: "global"` for every server — which is how
 * a project-owned server became unremovable, since the backend compares the
 * requested scope against the source file's real one.
 *
 * Deriving the row from `DesktopMcpState` makes divergence between THIS file and
 * the contract a compile error instead of a silent no-op — which is the half of
 * the problem a type can close. It does not close the other half, and the
 * contract does not pretend otherwise: `desktop-control-contract.ts` is
 * hand-written and already omits fields the live snapshot sends (`removable`) and
 * that `public_server_config` sends (`command`, `argument_count`, `url`,
 * `endpoint_redacted`, `environment_keys`, `header_keys`), and
 * `desktopResult<T>` is an unchecked cast,
 * so a backend rename would still arrive silently. Catching that needs a parity
 * assertion against a pinned payload from the backend, which this repository
 * cannot make on its own — see the note in `mcp-foreign-config-origin.ts`.
 *
 * The real names are worth knowing at the point of use: `owned_scope` is the
 * writable scope owning the server's SOURCE FILE (`owned_scope_for_source` in
 * `mcp/config.py`) and is `null` for the six foreign configs this app must not
 * write, `setup` is `{kind: "session_prompt", text}` and is absent from the
 * route's cold facade, and `status` is the vocabulary `connected | connecting |
 * auth-required | disconnected` (plus `cold` on that facade).
 */
type MCPServerRow = DesktopMcpState["servers"][number];

type MCPAction =
	| "list"
	| "add"
	| "remove"
	| "reload"
	| "connect"
	| "probe"
	| "disconnect"
	| "login"
	| "logout"
	| "reauth"
	| "status"
	| "cancel";

/** Both separators, at module level: a regex literal inside the function would
 * be rebuilt per call, which is the lint rule this satisfies (`useTopLevelRegex`). */
const WHITESPACE = /\s+/;

/**
 * The server a `/mcp <argument>` deep link names, or why nothing matched.
 *
 * Resolution is against the LOADED list rather than against a grammar of verbs,
 * and that is the whole design: the renderer holds no copy of the backend's
 * subcommand vocabulary (`MCP_SUBCOMMANDS`, `session/frontend_state.py:862`), and
 * `docs/desktop-controls.md` forbids authoring a second command list here. So
 * `/mcp reauth hubspot` resolves by taking the LAST whitespace token that is a
 * configured server name — the verb is simply a token that is not a server —
 * which covers `login notion` and any verb the backend adds later, without the
 * renderer knowing one verb from another.
 *
 * `null` is "no argument was passed" (nothing to say, no line to render).
 * `miss` is an argument that names nothing, and the section states it: the old
 * effect returned silently for exactly this case, which is why the operator's
 * own remedy line (`/mcp reauth hubspot`) did nothing at all rather than
 * something wrong.
 *
 * `unresolved` is the residual that rule cannot fix, stated rather than hidden
 * (code review round 1, finding 4): with a server named like a verb — `login` —
 * `/mcp login hubspo` (a typo) resolves to `login` and reveals it, because the
 * last token that IS configured wins and no verb list may exist here. The cost
 * of guessing wrong is a silent landing on the wrong server, so a match that
 * needed a token other than the LAST one carries that last token back and the
 * section says which server it resolved to. It is `null` for every resolution
 * the last token alone explains, including the operator's own `reauth hubspot`,
 * so the note never appears on the case this rule exists for.
 */
export type McpTarget =
	| { kind: "matched"; name: string; unresolved: string | null }
	| { kind: "miss"; asked: string }
	| null;

export const resolveMcpServerTarget = (
	raw: string | undefined,
	names: readonly string[],
): McpTarget => {
	const asked = raw?.trim();
	if (!asked) return null;
	const configured = new Set(names);
	if (configured.has(asked)) {
		return { kind: "matched", name: asked, unresolved: null };
	}
	const tokens = asked.split(WHITESPACE);
	const last = tokens[tokens.length - 1] ?? "";
	for (let index = tokens.length - 1; index >= 0; index -= 1) {
		const token = tokens[index];
		if (token && configured.has(token)) {
			return {
				kind: "matched",
				name: token,
				unresolved: token === last ? null : last || null,
			};
		}
	}
	return { kind: "miss", asked };
};

/**
 * The conversation the section borrows when none is active (`docs/run-sidebar.md`
 * § 7 via this change's D5).
 *
 * Both MCP ops are session-scoped and there is no sessionless read, so a visit
 * to Settings with no conversation open used to dead-end on "Open a conversation
 * to manage its MCP servers." on the one page whose job is to show them. The
 * newest roster row is the right conversation to borrow because the USER config
 * is part of every cwd-derived config set: the list a recent conversation sees is
 * the list, for the question "which of my servers exist".
 *
 * Ordered by `updated_at` descending, with the roster's own order as the
 * fallback (the backend lists newest first, and a row the catalogue gave no
 * timestamp is not a reason to borrow an older one).
 */
export const newestRosterRow = (
	rows: readonly CanonicalSessionRow[],
): CanonicalSessionRow | null =>
	rows.reduce<CanonicalSessionRow | null>((best, row) => {
		if (!best) return row;
		return (row.updated_at ?? 0) > (best.updated_at ?? 0) ? row : best;
	}, null);

const AddServerForm: FC<{
	sessionId: string;
	onAdded: () => void;
}> = ({ sessionId, onAdded }) => {
	const [name, setName] = useState("");
	const [mode, setMode] = useState<"command" | "url">("command");
	const [command, setCommand] = useState("");
	const [args, setArgs] = useState("");
	const [url, setUrl] = useState("");
	const [scope, setScope] = useState<"global" | "project">("global");
	const [error, setError] = useState<string | null>(null);
	const [saving, setSaving] = useState(false);

	const submit = async () => {
		setSaving(true);
		setError(null);
		try {
			await desktopResult({
				op: "mcp.control",
				sessionId,
				control: {
					action: "add",
					name,
					scope,
					...(mode === "command"
						? {
								command,
								// Arguments are a real array on the wire: one per line here,
								// never a shell string the backend would have to split.
								args: args
									.split("\n")
									.map((arg) => arg.trim())
									.filter(Boolean),
							}
						: { url }),
				},
			});
			setName("");
			setCommand("");
			setArgs("");
			setUrl("");
			onAdded();
		} catch (cause) {
			setError(
				cause instanceof Error
					? cause.message
					: "The server could not be added.",
			);
		} finally {
			setSaving(false);
		}
	};

	return (
		<form
			className="flex flex-col gap-3 rounded-md border border-control bg-surface p-4"
			onSubmit={(event) => {
				event.preventDefault();
				void submit();
			}}
		>
			<div className="flex flex-col gap-1">
				<Label htmlFor="mcp-add-name">Name</Label>
				<Input
					id="mcp-add-name"
					value={name}
					onChange={(event) => setName(event.target.value)}
					required
				/>
			</div>
			<fieldset className="flex gap-2">
				<legend className="sr-only">Server transport</legend>
				<Button
					type="button"
					variant={mode === "command" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => setMode("command")}
				>
					Local command
				</Button>
				<Button
					type="button"
					variant={mode === "url" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => setMode("url")}
				>
					Remote URL
				</Button>
			</fieldset>
			{mode === "command" ? (
				<>
					<div className="flex flex-col gap-1">
						<Label htmlFor="mcp-add-command">Command</Label>
						<Input
							id="mcp-add-command"
							value={command}
							onChange={(event) => setCommand(event.target.value)}
							className="font-mono"
							required
						/>
					</div>
					<div className="flex flex-col gap-1">
						<Label htmlFor="mcp-add-args">Arguments, one per line</Label>
						<textarea
							id="mcp-add-args"
							value={args}
							onChange={(event) => setArgs(event.target.value)}
							rows={2}
							className="rounded-sm border border-control bg-surface p-2 font-mono text-body-sm text-ink"
						/>
					</div>
				</>
			) : (
				<div className="flex flex-col gap-1">
					<Label htmlFor="mcp-add-url">URL</Label>
					<Input
						id="mcp-add-url"
						type="url"
						value={url}
						onChange={(event) => setUrl(event.target.value)}
						className="font-mono"
						required
					/>
					<p className="text-meta text-ink-dim">
						No inline credentials or query parameters; secrets are referenced
						from the credential manager.
					</p>
				</div>
			)}
			<fieldset className="flex gap-2">
				<legend className="sr-only">Configuration scope</legend>
				<Button
					type="button"
					variant={scope === "global" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => setScope("global")}
				>
					Global
				</Button>
				<Button
					type="button"
					variant={scope === "project" ? "secondary" : "ghost"}
					size="sm"
					onClick={() => setScope("project")}
				>
					This project
				</Button>
			</fieldset>
			{error && <Alert variant="danger">{error}</Alert>}
			<div>
				<Button
					type="submit"
					variant="primary"
					size="sm"
					disabled={saving || !name || !(mode === "command" ? command : url)}
				>
					{saving ? <Spinner size="sm" /> : null}
					Add server
				</Button>
			</div>
		</form>
	);
};

export const McpManagementSection: FC<{
	sessionId?: string;
	sectionRef?: RefObject<HTMLDivElement>;
	/**
	 * The argument of `/mcp <argument>`, from the deep link's `&mcp=`.
	 *
	 * An ARGUMENT rather than a server name: `/mcp reauth hubspot` passes
	 * `"reauth hubspot"`, and resolving that is this section's job (see
	 * `resolveMcpServerTarget`). Named `highlightServer` for its first caller's
	 * sake; the prop's contract is the raw string.
	 */
	highlightServer?: string;
}> = ({ sessionId, sectionRef, highlightServer }) => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "mcp");
	const queryClient = useQueryClient();
	/*
	 * The roster, for the borrow below: the chat sidebar's own read (`chat-sidebar`
	 * calls `fetchSessions` on mount), used here only when no session is active, so
	 * the common case costs nothing and adds no read.
	 */
	const roster = useCanonicalSessionsStore((state) => state.sessions);
	const fetchSessions = useCanonicalSessionsStore(
		(state) => state.fetchSessions,
	);
	const rosterLoading = useCanonicalSessionsStore((state) => state.loading);
	const borrowed = useMemo(
		() => (sessionId ? null : newestRosterRow(roster)),
		[sessionId, roster],
	);
	const readSessionId = sessionId ?? borrowed?.session_id;
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);
	const [filter, setFilter] = useState("");

	// Only when the roster has nothing to borrow: an empty roster on a page opened
	// straight from `/mcp` is the case D5 exists for, and a second read beside the
	// sidebar's own would be the duplicate this section avoids elsewhere.
	useEffect(() => {
		if (sessionId || !enabled || roster.length > 0) return;
		void fetchSessions();
	}, [sessionId, enabled, roster.length, fetchSessions]);

	const listQuery = useQuery<DesktopMcpState, Error>({
		queryKey: mcpKeys.list(readSessionId ?? ""),
		queryFn: () => {
			if (!readSessionId) throw new Error("No conversation selected.");
			return fetchMcpList(readSessionId);
		},
		enabled: enabled && Boolean(readSessionId),
		staleTime: 10_000,
	});

	const servers: MCPServerRow[] = mcpListServers(listQuery.data);

	// `/mcp <argument>` emits `&mcp=<argument>` and the surface used to compare
	// the whole string against a server name, so the operator's own remedy line
	// (`/mcp reauth hubspot`) matched nothing and the effect returned in silence.
	// Resolution is against the loaded list (see `resolveMcpServerTarget`), and a
	// miss is a STATE rather than a no-op.
	const target = useMemo(
		() =>
			resolveMcpServerTarget(
				highlightServer,
				servers.map((server) => server.name),
			),
		[highlightServer, servers],
	);
	const named = target?.kind === "matched" ? target.name : null;

	/** The revealed row, and the one reveal already performed for it. */
	const highlightRef = useRef<HTMLLIElement>(null);
	const revealed = useRef<string | null>(null);

	const search = filter.trim().toLowerCase();
	const visible = useMemo(
		() =>
			search
				? servers.filter((server) => server.name.toLowerCase().includes(search))
				: servers,
		[servers, search],
	);

	/*
	 * A filter typed BEFORE the command ran must not hide the row the command
	 * exists to reveal, so the first arrival clears it — and only the first: after
	 * the reveal, a filter the user types is theirs to keep, which is why the
	 * guard is the reveal ref rather than the presence of an argument.
	 */
	useEffect(() => {
		if (!named || revealed.current === named || !filter) return;
		setFilter("");
	}, [named, filter]);

	useEffect(() => {
		if (!named) return;
		// Once per named server: re-scrolling on every list refetch would fight
		// the user for the scroll position.
		if (revealed.current === named) return;
		// Nothing to scroll to yet: the read has not returned, or the row is still
		// filtered out and the effect above is about to clear the filter.
		if (!visible.some((server) => server.name === named)) return;
		revealed.current = named;
		highlightRef.current?.scrollIntoView({
			block: "center",
			behavior: "smooth",
		});
	}, [named, visible]);

	const refresh = useCallback(() => {
		if (readSessionId) {
			void queryClient.invalidateQueries({
				queryKey: mcpKeys.list(readSessionId),
			});
		}
	}, [queryClient, readSessionId]);

	const control = useCallback(
		async (
			action: MCPAction,
			name: string,
			extra: { confirmed?: boolean; scope?: "global" | "project" } = {},
		) => {
			if (!readSessionId) return;
			setActionError(null);
			try {
				await desktopResult({
					op: "mcp.control",
					sessionId: readSessionId,
					control: { action, name, ...extra },
				});
				refresh();
			} catch (cause) {
				setActionError(
					cause instanceof Error
						? cause.message
						: "The MCP change could not be completed.",
				);
			}
		},
		[readSessionId, refresh],
	);

	if (!enabled) {
		return (
			<SettingsSection
				title="Integrations"
				description="MCP servers connect agents to your tools and accounts."
				sectionRef={sectionRef}
			>
				<Alert variant="warning">
					Integration management needs a newer Local Operator backend. Update
					the backend and restart the app to manage MCP servers here.
				</Alert>
			</SettingsSection>
		);
	}

	/*
	 * No conversation AT ALL: the roster answered and it is empty, so there is
	 * nothing to borrow and no session for either op. This is the only case the
	 * old dead-end line survives in — and it is now a statement about the machine
	 * rather than about the page's willingness to help.
	 */
	if (!readSessionId) {
		return (
			<SettingsSection
				title="Integrations"
				description="MCP servers connect agents to your tools and accounts."
				sectionRef={sectionRef}
			>
				{rosterLoading ? (
					<div className="flex h-24 items-center justify-center">
						<Spinner size="lg" label="Loading MCP servers" />
					</div>
				) : (
					<p className="text-body-sm text-ink-muted">
						Open a conversation to manage its MCP servers.
					</p>
				)}
			</SettingsSection>
		);
	}

	return (
		<SettingsSection
			title="Integrations"
			description="MCP servers connect agents to your tools and accounts. A connected server is a working transport; the account behind it may still need its own sign-in."
			sectionRef={sectionRef}
		>
			<div className="flex flex-col gap-4">
				{actionError && <Alert variant="danger">{actionError}</Alert>}
				{/*
				 * Which conversation this list is. The sentence NAMES it, and that is a
				 * requirement rather than a nicety: the statuses below are that
				 * conversation's RUNTIME's, and `disconnect` is per-session — but the
				 * CREDENTIAL is not, `~/.local-operator/auth.db` is shared and a grant from
				 * any conversation revalidates the block in every other one
				 * (`mcp/manager.py:3050-3075`). So naming the conversation must not be read
				 * as claiming the sign-in belongs to it.
				 */}
				{borrowed && (
					<p className="text-body-sm text-ink-muted">
						Showing MCP servers for{" "}
						{borrowed.title?.trim() || borrowed.session_id.slice(0, 6)}, your
						most recent conversation. Open a conversation to see its own list.
					</p>
				)}
				{listQuery.isLoading && (
					<div className="flex h-24 items-center justify-center">
						<Spinner size="lg" label="Loading MCP servers" />
					</div>
				)}
				{listQuery.isError && (
					<Alert variant="warning">
						<div className="flex items-center justify-between gap-3">
							<span>MCP servers could not be loaded.</span>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => void listQuery.refetch()}
							>
								Retry
							</Button>
						</div>
					</Alert>
				)}
				{/*
				 * The list's own search (D4). Client-side, over the rows the read already
				 * returned, and present whenever there IS a list: "search for the name I
				 * know" is the gesture that failed, and it needs no threshold to be worth
				 * having. It is deliberately NOT wired into the settings search index —
				 * that index is a typed-editor registry over backend settings keys, and
				 * MCP rows are a session-scoped live read with a runtime status column,
				 * which is the second-answer problem this section was built to avoid.
				 */}
				{servers.length > 0 && (
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder="Search MCP servers"
							aria-label="Search MCP servers"
							className="pl-9"
						/>
					</div>
				)}
				{/*
				 * Exactly one of these two lines, by construction: the miss line needs a
				 * list to have been searched, and the configured line needs it to be empty
				 * — so an argument that named nothing on a machine with no servers gets the
				 * statement about the machine, which is the more complete answer.
				 *
				 * The miss line quotes the RAW argument, because that is what the reader
				 * typed and what a resolution rule has to be re-read against.
				 */}
				{target?.kind === "miss" && servers.length > 0 && (
					<p className="text-body-sm text-ink-muted">
						{`No MCP server matches "${target.asked}".`}
					</p>
				)}
				{/*
				 * The other half of the same rule, and the reason it is stated rather than
				 * hidden: a server can be NAMED like a verb, so `/mcp login hubspo` resolves
				 * to the server called `login` and reveals an unrelated row unless the
				 * resolution says so (code review round 1, finding 4). Only a match the last
				 * token does not explain carries an `unresolved` tail, so the operator's own
				 * `reauth hubspot` never sees this line.
				 */}
				{target?.kind === "matched" && target.unresolved && (
					<p className="text-body-sm text-ink-muted">
						{`Showing "${target.name}" — "${target.unresolved}" is not one of your servers.`}
					</p>
				)}
				{listQuery.isSuccess && servers.length === 0 && (
					<p className="text-body-sm text-ink-muted">
						No MCP servers configured yet. Add one below.
					</p>
				)}
				{/*
				 * The filter's own empty state, in the provider grid's shape (the same
				 * `No providers match this search.` + `Clear search` pair) because it is
				 * the same question about a different list — and it is a different line
				 * from the deep-link miss above, which is a statement about a NAME rather
				 * than about a filter.
				 */}
				{servers.length > 0 && visible.length === 0 && (
					<div className="flex flex-col items-start gap-2">
						<p className="text-body-sm text-ink-muted">
							No MCP servers match this search.
						</p>
						<Button variant="secondary" size="sm" onClick={() => setFilter("")}>
							Clear search
						</Button>
					</div>
				)}
				{visible.length > 0 && (
					<ul className="flex flex-col gap-2">
						{visible.map((server) => {
							const connected = server.status === "connected";
							const highlighted = server.name === named;
							// Aliased so the removal handler below keeps the non-null
							// narrowing: the scope of the write and the reason the Remove
							// control exists are the same question.
							const ownedScope = server.owned_scope;
							// Whether this row offers the sign-in control that fixes a
							// `auth-required` server; where it does not, the row has to say so
							// in words (see the hint below).
							const canGrantAccountAccess =
								server.transport === "http" &&
								server.transport_oauth_supported !== false;
							// The tool that owns a config this app must not write, or null when
							// the table does not know the file.
							const foreignOrigin = foreignMcpConfigOrigin(server.source);
							return (
								<li
									key={server.name}
									ref={highlighted ? highlightRef : undefined}
									className={cn(
										"flex flex-col gap-2 rounded-md border border-control bg-surface p-3",
										// A colour step, not a ring: this marks which row the
										// command was about, it does not take focus.
										highlighted && "border-accent bg-elevated",
									)}
								>
									<div className="flex items-center justify-between gap-3">
										<div className="flex min-w-0 items-center gap-2">
											<span className="truncate font-medium text-body text-ink">
												{server.name}
											</span>
											{/* The scope chip is the row's only left-rail pill, and that is
											    the point: it carries the fact that decides whether this row
											    has a Remove control, so it keeps the emphasised variant
											    (D1-4). Its words are the add form's own (`Global` /
											    `This project`), so the two places that name this axis
											    agree. */}
											{ownedScope && (
												<Badge variant="outline">
													{ownedScope === "project" ? "This project" : "Global"}
												</Badge>
											)}
											{/* Plain meta text, not a second pill: the transport token is a
											    machine word the row's other copy already implies, and as a
											    pill it wore the same three roles as the neutral status badge
											    at the far end of the row (D2-3). */}
											{server.transport && (
												<span className="text-meta text-ink-dim">
													{server.transport}
												</span>
											)}
										</div>
										<Badge
											variant={
												connected
													? "success"
													: server.status === "connecting"
														? "info"
														: server.status === "auth-required"
															? "warning"
															: "neutral"
											}
										>
											{server.status ?? "unknown"}
										</Badge>
									</div>
									{typeof server.tool_count === "number" && (
										<p className="text-meta text-ink-dim">
											{server.tool_count} tools available
										</p>
									)}
									{/* No error line: the wire never sends `error`, so `status` IS the
									    row's health story, and `auth-required` takes the warning variant
									    above because it is recoverable — unlike a dead process.

									    Where the row cannot offer a sign-in, the copy must not name one.
									    `!canGrantAccountAccess` means `server_rejects_oauth`
									    (`mcp/auth.py`), which is true for TWO shapes and never for a
									    server that could use a grant: a stdio server (no URL to carry
									    a bearer), and — the http row this branch is mostly about — a
									    config declaring some OTHER `auth` type, where starting an
									    OAuth flow would answer a question the user already answered,
									    so the login is a HARD REFUSAL. The backend's own display
									    authority for both, `McpManager.auth_recovery_hint`
									    (`mcp/manager.py`), says the config is the only place to fix
									    it ("check {name}'s credentials in its MCP config"), and
									    `_auth_challenge_text` for a 401 with no discoverable OAuth
									    endpoint says "set its API key or headers". So the sentence
									    names the credential need, and names the control that is
									    actually on the row when the backend sent one: the setup
									    prompt, which is how the user gets walked to that config. */}
									{server.status === "auth-required" &&
										!canGrantAccountAccess && (
											<p className="text-meta text-ink-dim">
												{server.setup?.text
													? "This server needs credentials local-operator cannot collect. Copy the setup prompt to have an agent walk you through it."
													: "This server needs credentials local-operator cannot collect."}
											</p>
										)}
									{/* The row that has no Remove control says WHY in words: the tool
									    that owns the file when this table knows it, then the file.
									    The TUI's `/mcp remove` refusal names both for the same reason
									    (`mcp/verbs.py`'s `_foreign_config_origin`). The path is
									    machine voice, so it is monospace and `~`-relative
									    (`compactPath`); and the sentence sits on its own line at
									    every width, because trailing the controls it broke to one
									    below ~1000px anyway and a caveat that changes role with the
									    column reads as two things (review D1-6).

									    A source this table does not know is NOT given a guessed
									    owner. The case that reaches it most is the project's own bare
									    `.mcp.json`, which the backend calls "a project .mcp.json
									    local-operator does not write" (`mcp/verbs.py`) — the
									    user's own file, not another tool's — so the unnamed branch
									    claims only what is true and keeps the path, which is the
									    actionable half (review D2-2/R2-2). */}
									{!ownedScope && (
										<p className="text-meta text-ink-dim">
											{foreignOrigin
												? `Imported from ${foreignOrigin}.`
												: "Imported from a configuration local-operator does not write."}{" "}
											{server.source ? (
												<>
													Remove it in{" "}
													<span className="font-mono text-mono-sm text-ink-dim">
														{compactPath(server.source)}
													</span>
													.
												</>
											) : (
												<>Remove it wherever it is defined.</>
											)}
										</p>
									)}
									<div className="flex flex-wrap items-center gap-2">
										{connected ? (
											<Button
												variant="secondary"
												size="sm"
												onClick={() => {
													setConfirmRemove(null);
													void control("disconnect", server.name, {
														confirmed: true,
													});
												}}
											>
												<Plug aria-hidden="true" />
												Disconnect
											</Button>
										) : (
											<Button
												variant="secondary"
												size="sm"
												onClick={() => void control("connect", server.name)}
											>
												<PlugZap aria-hidden="true" />
												Connect
											</Button>
										)}
										<Button
											variant="ghost"
											size="sm"
											onClick={() => void control("reload", server.name)}
										>
											<RotateCw aria-hidden="true" />
											Reload
										</Button>
										{/* OAuth grant login only where the transport can do it;
										    stdio servers get the setup-prompt offer instead of a
										    browser login that would fail against a local process. */}
										{canGrantAccountAccess ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => void control("login", server.name)}
											>
												Grant account access
											</Button>
										) : server.setup?.text ? (
											<Button
												variant="ghost"
												size="sm"
												onClick={() => {
													// The setup action is a prompt the user reviews and
													// submits normally; it is never auto-sent.
													void navigator.clipboard
														.writeText(server.setup?.text ?? "")
														.catch(() => undefined);
												}}
											>
												Copy setup prompt
											</Button>
										) : null}
										{/* Removal is a scoped write into the file that owns the server,
										    and only two of the eight config sources are this app's to
										    write. A server imported from another tool's config has a
										    null `owned_scope`, so a Remove button there could only
										    ever produce the backend's refusal; the source file is
										    shown instead, which is the call the TUI's `/mcp remove`
										    rows already make with their detail column. */}
										{ownedScope ? (
											confirmRemove === server.name ? (
												<>
													<span className="text-body-sm text-ink">
														Remove {server.name}?
													</span>
													<Button
														variant="danger"
														size="sm"
														onClick={() => {
															setConfirmRemove(null);
															void control("remove", server.name, {
																confirmed: true,
																// The scope of the write, not a guess: the backend
																// compares it against the server's source file and
																// refuses a mismatch, so a hard-coded "global"
																// made every project-owned server unremovable.
																scope: ownedScope,
															});
														}}
													>
														Confirm removal
													</Button>
													<Button
														variant="ghost"
														size="sm"
														onClick={() => setConfirmRemove(null)}
													>
														Keep
													</Button>
												</>
											) : (
												<Button
													variant="ghost"
													size="sm"
													className="text-danger"
													onClick={() => setConfirmRemove(server.name)}
												>
													<Trash2 aria-hidden="true" />
													Remove
												</Button>
											)
										) : null}
									</div>
								</li>
							);
						})}
					</ul>
				)}
				{showAdd ? (
					<AddServerForm
						sessionId={readSessionId}
						onAdded={() => {
							setShowAdd(false);
							refresh();
						}}
					/>
				) : (
					<div>
						<Button
							variant="secondary"
							size="sm"
							onClick={() => setShowAdd(true)}
							data-tour-tag="mcp-add-server"
						>
							Add server
						</Button>
					</div>
				)}
			</div>
		</SettingsSection>
	);
};
