/**
 * Settings > Integrations: the MCP servers agents can use, and what each one
 * needs from the user right now.
 *
 * ## What this page is for
 *
 * Seeing which integrations work, fixing the ones that do not, and adding or
 * removing them - on a fresh install as much as on a machine with fifty chats.
 * The rendering decisions live in `integrations/integration-model.ts` (pure,
 * unit-tested), the data in `integrations/use-integrations.ts`, and this file
 * only composes them. What changed from the version it replaces (design audit
 * § 4, UX walk U5/U6/U8):
 *
 * - It reads the SESSIONLESS catalog when the backend has one (`mcp_catalog`),
 *   so adding, testing and signing in need no chat, no runtime and no model.
 *   The session route stays as the fallback for older backends, rendered
 *   through the same rows.
 * - Rows are grouped (Needs attention, Connected, Ready), say their status in
 *   plain words with a dot beside them, and lead with ONE action the backend
 *   says this row can take. Everything else is in the overflow.
 * - No wire vocabulary in primary text: no `cold`, `auth-required`, `stdio`,
 *   `http` or "transport".
 * - The list re-reads only while something on it is moving, and a control's
 *   answer is written straight into the cache.
 *
 * Three things about how the operator ARRIVES here survive unchanged, because
 * they are one flow - find the server, see which is broken, fix it:
 *
 * - `?mcp=<argument>` is RESOLVED against the loaded list
 *   (`resolveMcpServerTarget`), so `/mcp reauth hubspot` lands on `hubspot`,
 *   and an argument that names nothing says so.
 * - The section has its own search box (from six rows up, where a list stops
 *   fitting on one glance).
 * - On the session-route fallback with no active conversation, the section
 *   still borrows the newest roster row and says which.
 */

import { openLocalTarget, openUrlTarget } from "@features/chat/utils/link-open";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Button, Input } from "@shared/components/ui";
import { showInfoToast } from "@shared/utils/toast-manager";
import { Plug, Plus, Search } from "lucide-react";
import type { FC, RefObject } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { McpFailurePhase } from "../../chat/components/run-details/mcp-failure";
import { parseMcpIntent } from "../../chat/pickers/mcp-command";
import {
	AddIntegrationForm,
	type AddIntegrationValues,
} from "./integrations/add-integration-form";
import { IntegrationKeyDialog } from "./integrations/integration-key-dialog";
import {
	type IntegrationRow as IntegrationRowData,
	type OverflowItem,
	type PrimaryAction,
	groupIntegrations,
	integrationCountLabel,
	integrationFailureMessage,
} from "./integrations/integration-model";
import {
	IntegrationRow,
	type RowConfirm,
} from "./integrations/integration-row";
import {
	IntegrationSignInDialog,
	type SignInPhase,
} from "./integrations/integration-sign-in-dialog";
import { useIntegrations } from "./integrations/use-integrations";
import { SettingsSection } from "./settings-section";

export { newestRosterRow } from "./integrations/use-integrations";

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
	const intent = parseMcpIntent(asked, names);
	return intent.kind === "auth"
		? { kind: "matched", name: intent.name, unresolved: null }
		: { kind: "miss", asked };
};

/** The dialog open over the list, if any. */
type Dialog =
	| { kind: "sign_in"; name: string; action: "login" | "reauth" }
	| { kind: "key"; name: string; keyNames: string[] }
	| null;

/** From this many rows up the list gets a search box. */
const SEARCH_THRESHOLD = 6;

const SECTION_TITLE = "Integrations";
const SECTION_DESCRIPTION =
	"Let agents use your tools and accounts, like Notion, Linear or GitHub.";

/** The phase a control is worded as when it fails. */
const PHASE: Record<string, McpFailurePhase> = {
	test: "test",
	connect: "reconnect",
	disconnect: "disconnect",
	reload: "reload",
	remove: "remove",
	sign_out: "disconnect",
	cancel: "cancel",
	login: "grant",
	reauth: "grant",
};

export const McpManagementSection: FC<{
	sessionId?: string;
	sectionRef?: RefObject<HTMLDivElement>;
	/**
	 * The argument of `/mcp <argument>`, from the deep link's `&mcp=`.
	 *
	 * An ARGUMENT rather than a server name: `/mcp reauth hubspot` passes
	 * `"reauth hubspot"`, and resolving that is this section's job (see
	 * `resolveMcpServerTarget`).
	 */
	highlightServer?: string;
}> = ({ sessionId, sectionRef, highlightServer }) => {
	const integrations = useIntegrations({ sessionId });
	const { document, control } = integrations;
	const servers = document?.servers ?? [];
	const operations = document?.operations ?? [];
	const projectScopeAvailable = document?.project_scope_available ?? false;

	const [showAdd, setShowAdd] = useState(false);
	const [filter, setFilter] = useState("");
	const [pending, setPending] = useState<string | null>(null);
	const [failures, setFailures] = useState<Record<string, string>>({});
	const [confirm, setConfirm] = useState<{
		name: string;
		kind: "remove" | "sign_out";
	} | null>(null);
	const [dialog, setDialog] = useState<Dialog>(null);
	const [signIn, setSignIn] = useState<SignInPhase>({ kind: "ready" });
	const [signInOperation, setSignInOperation] = useState<string | null>(null);
	const [keyFailure, setKeyFailure] = useState<string | null>(null);
	const [keySaving, setKeySaving] = useState(false);

	const target = useMemo(
		() =>
			resolveMcpServerTarget(
				highlightServer,
				servers.map((server) => server.name),
			),
		[highlightServer, servers],
	);
	const named = target?.kind === "matched" ? target.name : null;
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
	const groups = useMemo(
		() => groupIntegrations(visible, operations),
		[visible, operations],
	);

	/*
	 * A filter typed BEFORE the command ran must not hide the row the command
	 * exists to reveal, so the first arrival clears it - and only the first.
	 */
	useEffect(() => {
		if (!named || revealed.current === named || !filter) return;
		setFilter("");
	}, [named, filter]);

	useEffect(() => {
		if (!named || revealed.current === named) return;
		if (!visible.some((server) => server.name === named)) return;
		revealed.current = named;
		highlightRef.current?.scrollIntoView({
			block: "center",
			behavior: "smooth",
		});
	}, [named, visible]);

	/*
	 * The sign-in dialog follows its operation through the document the list
	 * already polls (it polls BECAUSE the operation is running), so the dialog
	 * needs no timer of its own.
	 */
	useEffect(() => {
		if (!signInOperation) return;
		const operation =
			operations.find((op) => op.id === signInOperation) ?? null;
		setSignIn({ kind: "running", operation });
	}, [operations, signInOperation]);

	const grantRunning = operations.some((op) => op.status === "running");

	const run = async (
		name: string,
		key: string,
		start: () => Promise<string | null>,
	): Promise<string | null> => {
		setPending(name);
		setFailures(({ [name]: _cleared, ...rest }) => rest);
		try {
			return await start();
		} catch (cause) {
			setFailures((previous) => ({
				...previous,
				[name]: integrationFailureMessage(
					PHASE[key] ?? "status",
					cause,
					grantRunning,
				),
			}));
			return null;
		} finally {
			setPending(null);
		}
	};

	const rowByName = (name: string) =>
		servers.find((server) => server.name === name);

	const openConfig = (row: IntegrationRowData) => {
		if (row.source.path) void openLocalTarget(row.source.path);
	};

	const startSignIn = async (name: string, action: "login" | "reauth") => {
		setSignIn({ kind: "starting" });
		setSignInOperation(null);
		try {
			const id = await control({ action, name });
			if (id) setSignInOperation(id);
			else setSignIn({ kind: "running", operation: null });
		} catch (cause) {
			setSignIn({
				kind: "refused",
				message: integrationFailureMessage("grant", cause, grantRunning),
			});
		}
	};

	const onPrimary = (row: IntegrationRowData, action: PrimaryAction) => {
		switch (action.kind) {
			case "sign_in":
			case "reauth":
				setSignIn({ kind: "ready" });
				setSignInOperation(null);
				setDialog({
					kind: "sign_in",
					name: row.name,
					action: action.kind === "reauth" ? "reauth" : "login",
				});
				return;
			case "set_key":
				setKeyFailure(null);
				setDialog({
					kind: "key",
					name: row.name,
					keyNames: row.auth.secret_refs.map((ref) => ref.id),
				});
				return;
			case "fix":
				openConfig(row);
				return;
			default: {
				// `test` or `connect`: the two primaries that are one request.
				const kind = action.kind;
				void run(row.name, kind, () =>
					control({ action: kind, name: row.name }),
				);
			}
		}
	};

	const onOverflow = (row: IntegrationRowData, item: OverflowItem) => {
		switch (item.kind) {
			case "remove":
			case "sign_out":
				setConfirm({ name: row.name, kind: item.kind });
				return;
			case "reauth":
			case "set_key":
				onPrimary(row, { kind: item.kind, label: item.label });
				return;
			case "open_config":
				openConfig(row);
				return;
			case "copy_setup":
				void navigator.clipboard
					.writeText(row.setup_prompt ?? "")
					.then(() =>
						showInfoToast("Setup steps copied. Paste them into a chat."),
					)
					.catch(() => undefined);
				return;
			case "cancel": {
				const running = operations.find(
					(op) => op.name === row.name && op.status === "running",
				);
				if (running)
					void run(row.name, "cancel", () =>
						control({ action: "cancel", operationId: running.id }),
					);
				return;
			}
			case "test":
			case "connect":
			case "disconnect":
			case "reload": {
				// Bound first: the closure below would lose the switch's narrowing.
				const action = item.kind;
				void run(row.name, action, () => control({ action, name: row.name }));
				return;
			}
			default:
				return;
		}
	};

	const onConfirmed = (
		row: IntegrationRowData,
		kind: "remove" | "sign_out",
	) => {
		setConfirm(null);
		if (kind === "remove") {
			const scope = row.source.owned_scope;
			if (!scope) return;
			void run(row.name, "remove", () =>
				control({ action: "remove", name: row.name, scope }),
			);
			return;
		}
		void run(row.name, "sign_out", () =>
			control({ action: "logout", name: row.name }),
		);
	};

	const onAdd = async (
		values: AddIntegrationValues,
	): Promise<string | null> => {
		try {
			await control({
				action: "add",
				name: values.name,
				scope: values.scope,
				...(values.mode === "command"
					? { command: values.command, args: values.args }
					: { url: values.url }),
			});
			setShowAdd(false);
			return null;
		} catch (cause) {
			return integrationFailureMessage("add", cause, false);
		}
	};

	const header = (
		<div className="flex items-start justify-between gap-4">
			<div className="min-w-0">
				<h2 className="text-heading text-ink">{SECTION_TITLE}</h2>
				<p className="mt-1 max-w-2xl text-body-sm text-ink-muted">
					{SECTION_DESCRIPTION}
				</p>
			</div>
			{integrations.enabled && servers.length > 0 && !showAdd ? (
				<Button
					variant="secondary"
					size="sm"
					onClick={() => setShowAdd(true)}
					data-tour-tag="mcp-add-server"
				>
					<Plus aria-hidden="true" />
					Add integration
				</Button>
			) : null}
		</div>
	);

	if (!integrations.enabled && !integrations.isLoading) {
		return (
			<SettingsSection
				title={SECTION_TITLE}
				titleComponent={header}
				sectionRef={sectionRef}
			>
				<Alert variant="warning">
					Integrations need a newer Local Operator backend. Update it and
					restart the app to manage them here.
				</Alert>
			</SettingsSection>
		);
	}

	const addForm = (
		<AddIntegrationForm
			existingNames={servers.map((server) => server.name)}
			projectScopeAvailable={projectScopeAvailable}
			projectLabel={document?.cwd ? compactHome(document.cwd) : null}
			onSubmit={onAdd}
			onCancel={() => setShowAdd(false)}
		/>
	);

	const dialogRow = dialog ? rowByName(dialog.name) : undefined;

	return (
		<SettingsSection
			title={SECTION_TITLE}
			titleComponent={header}
			sectionRef={sectionRef}
		>
			<div className="flex flex-col gap-4">
				{integrations.route === "session" && integrations.borrowed ? (
					<p className="text-body-sm text-ink-muted">
						Showing the integrations for{" "}
						{integrations.borrowed.title?.trim() ||
							integrations.borrowed.session_id.slice(0, 6)}
						, your most recent chat.
					</p>
				) : null}
				{integrations.noConversation ? (
					<p className="text-body-sm text-ink-muted">
						Start a chat to manage integrations here. Updating the backend
						removes this step.
					</p>
				) : null}
				{integrations.isLoading ? (
					<div className="flex h-24 items-center justify-center">
						<Spinner size="lg" label="Loading integrations" />
					</div>
				) : null}
				{integrations.isError ? (
					<Alert variant="warning">
						<div className="flex items-center justify-between gap-3">
							<span>Integrations couldn't be loaded.</span>
							<Button
								variant="secondary"
								size="sm"
								onClick={integrations.refetch}
							>
								Retry
							</Button>
						</div>
					</Alert>
				) : null}
				{showAdd && servers.length > 0 ? addForm : null}
				{servers.length >= SEARCH_THRESHOLD ? (
					<div className="relative">
						<Search
							aria-hidden="true"
							className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-dim"
						/>
						<Input
							value={filter}
							onChange={(event) => setFilter(event.target.value)}
							placeholder={`Search ${integrationCountLabel(servers.length)}`}
							aria-label="Search integrations"
							className="pl-9"
						/>
					</div>
				) : null}
				{target?.kind === "miss" && servers.length > 0 ? (
					<p className="text-body-sm text-ink-muted">
						{`No integration matches "${target.asked}".`}
					</p>
				) : null}
				{target?.kind === "matched" && target.unresolved ? (
					<p className="text-body-sm text-ink-muted">
						{`Showing "${target.name}" — "${target.unresolved}" is not one of your integrations.`}
					</p>
				) : null}
				{document && servers.length === 0 && !integrations.isLoading ? (
					showAdd ? (
						addForm
					) : (
						<div className="flex flex-col items-start gap-3 rounded-lg bg-surface p-6">
							<Plug aria-hidden="true" className="size-5 text-ink-muted" />
							<div className="flex flex-col gap-1">
								<h3 className="text-heading text-ink">No integrations yet</h3>
								<p className="max-w-xl text-body-sm text-ink-muted">
									Integrations let agents read and act in your other tools, like
									Notion or Linear. Add one with a command that runs on this
									computer, or a server's URL.
								</p>
							</div>
							<Button
								variant="primary"
								size="md"
								onClick={() => setShowAdd(true)}
								data-tour-tag="mcp-add-server"
							>
								<Plus aria-hidden="true" />
								Add integration
							</Button>
						</div>
					)
				) : null}
				{servers.length > 0 && visible.length === 0 ? (
					<div className="flex flex-col items-start gap-2">
						<p className="text-body-sm text-ink-muted">
							No integrations match this search.
						</p>
						<Button variant="secondary" size="sm" onClick={() => setFilter("")}>
							Clear search
						</Button>
					</div>
				) : null}
				{groups.map((group) => (
					<section
						key={group.id}
						aria-labelledby={`integrations-group-${group.id}`}
						className="flex flex-col gap-1.5"
					>
						<h3
							id={`integrations-group-${group.id}`}
							className="px-1 text-ink-dim text-meta"
						>
							{group.title} · {group.rows.length}
						</h3>
						<ul className="flex flex-col divide-y divide-hairline overflow-hidden rounded-lg bg-surface">
							{group.rows.map((row) => (
								<IntegrationRow
									key={row.id}
									row={row}
									operations={operations}
									projectScopeAvailable={projectScopeAvailable}
									highlighted={row.name === named}
									rowRef={row.name === named ? highlightRef : undefined}
									pending={pending === row.name}
									failure={failures[row.name] ?? null}
									confirm={
										confirm?.name === row.name
											? ({ kind: confirm.kind } satisfies RowConfirm)
											: null
									}
									onPrimary={(action) => onPrimary(row, action)}
									onOverflow={(item) => onOverflow(row, item)}
									onConfirm={() => confirm && onConfirmed(row, confirm.kind)}
									onCancelConfirm={() => setConfirm(null)}
								/>
							))}
						</ul>
					</section>
				))}
			</div>
			{dialog?.kind === "sign_in" ? (
				<IntegrationSignInDialog
					name={dialog.name}
					action={dialog.action}
					phase={signIn}
					onStart={() => void startSignIn(dialog.name, dialog.action)}
					onCancel={(operationId) =>
						void control({ action: "cancel", operationId }).catch(
							() => undefined,
						)
					}
					onOpenLink={(url) => void openUrlTarget(url)}
					onClose={() => {
						setDialog(null);
						setSignInOperation(null);
					}}
				/>
			) : null}
			{dialog?.kind === "key" ? (
				<IntegrationKeyDialog
					name={dialog.name}
					keyNames={
						dialog.keyNames.length
							? dialog.keyNames
							: (dialogRow?.auth.secret_refs.map((ref) => ref.id) ?? [])
					}
					saving={keySaving}
					failure={keyFailure}
					onClose={() => setDialog(null)}
					onSave={(values, confirmedReplace) => {
						setKeySaving(true);
						setKeyFailure(null);
						void integrations
							.storeKeys(dialog.name, values, confirmedReplace)
							.then((result) => {
								if (result.saved) setDialog(null);
								else setKeyFailure(result.message);
							})
							.catch((cause) =>
								setKeyFailure(integrationFailureMessage("key", cause, false)),
							)
							.finally(() => setKeySaving(false));
					}}
				/>
			) : null}
		</SettingsSection>
	);
};

/** `/Users/x/proj` as `~/proj`, for a label. Machine paths stay machine voice elsewhere. */
const HOME_PREFIX = /^\/(?:Users|home)\/[^/]+(?=\/|$)/;
const compactHome = (path: string): string => path.replace(HOME_PREFIX, "~");
