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
 */

import { compactPath } from "@features/chat/components/trace/tool-row-model";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input, Label } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plug, PlugZap, RotateCw, Trash2 } from "lucide-react";
import type { FC, RefObject } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DesktopControlResult,
	DesktopMcpState,
} from "../../../../../shared/desktop-control-contract";
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
 * that `public_server_config` sends (`argument_count`, `url`, `endpoint_redacted`,
 * `environment_keys`, `header_keys`), and `desktopResult<T>` is an unchecked cast,
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

/** Lifecycle routes wrap their payload as `{data, replayed}`. */
type MCPListResult = DesktopControlResult<DesktopMcpState>;

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

export const mcpKeys = {
	list: (sessionId: string) => ["desktop", "mcp", sessionId] as const,
};

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
	/** Server to reveal, from `/mcp <name>`'s `&mcp=` deep link. */
	highlightServer?: string;
}> = ({ sessionId, sectionRef, highlightServer }) => {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "mcp");
	const queryClient = useQueryClient();
	const [confirmRemove, setConfirmRemove] = useState<string | null>(null);
	const [actionError, setActionError] = useState<string | null>(null);
	const [showAdd, setShowAdd] = useState(false);

	const listQuery = useQuery<MCPListResult["data"], Error>({
		queryKey: mcpKeys.list(sessionId ?? ""),
		queryFn: () => {
			if (!sessionId) throw new Error("No conversation selected.");
			return desktopResult<MCPListResult>({ op: "mcp.list", sessionId }).then(
				(result) => result.data,
			);
		},
		enabled: enabled && Boolean(sessionId),
		staleTime: 10_000,
	});

	const servers: MCPServerRow[] = listQuery.data?.servers ?? [];

	// `/mcp <name>` emits `&mcp=<name>` and nothing read it, so the argument was
	// silently dropped and the command landed on an undifferentiated list (UX
	// U3). Honoured rather than removed: naming a server is the whole point of
	// passing one.
	const highlightRef = useRef<HTMLLIElement>(null);
	const revealed = useRef<string | null>(null);
	useEffect(() => {
		if (!highlightServer || servers.length === 0) return;
		// Once per named server: re-scrolling on every list refetch would fight
		// the user for the scroll position.
		if (revealed.current === highlightServer) return;
		if (!servers.some((server) => server.name === highlightServer)) return;
		revealed.current = highlightServer;
		highlightRef.current?.scrollIntoView({
			block: "center",
			behavior: "smooth",
		});
	}, [highlightServer, servers]);

	const refresh = useCallback(() => {
		if (sessionId) {
			void queryClient.invalidateQueries({ queryKey: mcpKeys.list(sessionId) });
		}
	}, [queryClient, sessionId]);

	const control = useCallback(
		async (
			action: MCPAction,
			name: string,
			extra: { confirmed?: boolean; scope?: "global" | "project" } = {},
		) => {
			if (!sessionId) return;
			setActionError(null);
			try {
				await desktopResult({
					op: "mcp.control",
					sessionId,
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
		[sessionId, refresh],
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

	if (!sessionId) {
		return (
			<SettingsSection
				title="Integrations"
				description="MCP servers connect agents to your tools and accounts."
				sectionRef={sectionRef}
			>
				<p className="text-body-sm text-ink-muted">
					Open a conversation to manage its MCP servers.
				</p>
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
				{listQuery.isSuccess && servers.length === 0 && (
					<p className="text-body-sm text-ink-muted">
						No MCP servers configured yet. Add one below.
					</p>
				)}
				{servers.length > 0 && (
					<ul className="flex flex-col gap-2">
						{servers.map((server) => {
							const connected = server.status === "connected";
							const highlighted = server.name === highlightServer;
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
											{/* The scope chip leads and the transport chip follows. Scope is
											    the fact that decides whether this row has a Remove control;
											    `stdio`/`http` is a token the row's other copy already
											    implies, so it takes the quieter variant. The words are the
											    add form's own (`Global` / `This project`), so the two
											    places that name this axis agree. */}
											{ownedScope && (
												<Badge variant="outline">
													{ownedScope === "project" ? "This project" : "Global"}
												</Badge>
											)}
											{server.transport && (
												<Badge variant="neutral">{server.transport}</Badge>
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
									    row's health story. `auth-required` is a recoverable grant
									    problem rather than a dead process, which is why it takes the
									    warning variant above — and where the row renders no sign-in
									    control, this line is the only place its remedy can be named. */}
									{server.status === "auth-required" &&
										!canGrantAccountAccess && (
											<p className="text-meta text-ink-dim">
												Sign in again to use this server.
											</p>
										)}
									{/* The row that has no Remove control says WHY in words: the tool
									    that owns the file, then the file. The TUI's `/mcp remove`
									    refusal names both for the same reason (`mcp/verbs.py`'s
									    `_foreign_config_origin`). The path is machine voice, so it is
									    monospace and `~`-relative (`compactPath`); and the sentence
									    sits on its own line at every width, because trailing the
									    controls it broke to one below ~1000px anyway and a caveat
									    that changes role with the column reads as two things
									    (review D1-6). */}
									{!ownedScope && (
										<p className="text-meta text-ink-dim">
											{foreignOrigin ? (
												<>
													Imported from {foreignOrigin}. Remove it in{" "}
													<span className="font-mono text-mono-sm text-ink-dim">
														{compactPath(server.source ?? "")}
													</span>
													.
												</>
											) : (
												<>
													Imported from another tool's configuration. Remove it
													there.
												</>
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
						sessionId={sessionId}
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
