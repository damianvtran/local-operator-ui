import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	fetchMcpList,
	fetchMcpProbe,
	mcpKeys,
} from "@shared/api/local-operator/mcp-list";
import {
	BaseDialog,
	PrimaryButton,
	SecondaryButton,
} from "@shared/components/common/base-dialog";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { McpKeyDialog } from "./mcp-key-dialog";
import type { McpServerRow } from "./run-detail-model";
import type { McpRemedyControls } from "./use-mcp-remedy";

type Transition =
	| { kind: "probing" }
	| { kind: "notice"; message: string }
	| { kind: "key"; row: McpServerRow }
	| { kind: "grant" | "running" };

/** One transition owner for slash, sidebar and Settings. A false probe cannot
 * redispatch the original row's stale OAuth remedy. The backend owns consent,
 * callbacks and operation status; this component only asks and presents facts. */
export function McpAuthDialog({
	row: initialRow,
	action = "login",
	remedy,
	onClose,
}: {
	row: McpServerRow;
	action?: "login" | "reauth";
	remedy: McpRemedyControls;
	onClose: () => void;
}) {
	// The dialog is keyed by session/name. Polling must not reset a masked form.
	const [row] = useState(initialRow);
	const capabilities = useDesktopCapabilities();
	const secure = desktopFeatureEnabled(capabilities.data, "mcp_auth");
	const [state, setState] = useState<Transition>({ kind: "probing" });
	const [attempt, setAttempt] = useState(0);
	const sessionId = remedy.sessionId;
	const status = useQuery({
		queryKey: mcpKeys.list(sessionId ?? ""),
		queryFn: () => fetchMcpList(sessionId ?? ""),
		enabled: Boolean(sessionId) && state.kind === "running",
		refetchInterval: state.kind === "running" ? 1000 : false,
	});
	// biome-ignore lint/correctness/useExhaustiveDependencies: attempt explicitly retries the same named probe
	useEffect(() => {
		if (!sessionId || capabilities.isLoading) return;
		let active = true;
		setState({ kind: "probing" });
		void fetchMcpProbe(sessionId, row.name)
			.then((probe) => {
				if (!active) return;
				if (probe.transport_oauth_supported === true) {
					setState({ kind: "grant" });
					return;
				}
				const keyNames = [
					...new Set((probe.secret_refs ?? []).map((ref) => ref.id)),
				];
				if (
					keyNames.length &&
					secure &&
					probe.key_submission_supported === true
				) {
					setState({
						kind: "key",
						row: { ...row, keyNames, remedy: { kind: "key" } },
					});
					return;
				}
				setState({
					kind: "notice",
					message: !secure
						? "Update the backend for secure MCP key entry. OAuth and the server list remain available."
						: probe.transport_oauth_supported === false
							? "This server does not use OAuth and declares no secret references. Add explicit ${NAME} references to its MCP environment or headers, then retry."
							: "Could not determine this server's sign-in method. Check its connection and MCP setup, then retry.",
				});
			})
			.catch((cause) => {
				if (active)
					setState({
						kind: "notice",
						message: userFacingMessage(
							cause,
							"Could not check this MCP server. Retry.",
						),
					});
			});
		return () => {
			active = false;
		};
	}, [sessionId, row, capabilities.isLoading, secure, attempt]);
	// Placed AFTER every hook, so the guard cannot reorder them between renders.
	/*
	 * No conversation, no operation. Both scoped ops address a SESSION, so a
	 * dialog with no session id could only spin forever on "Checking…" — a state
	 * that says nothing and cannot be acted on. It is reached only by a caller
	 * that mounted the flow without a session, which the three real entry points
	 * do not do (Settings refuses earlier with its own sentence), so this is a
	 * floor rather than a path.
	 */
	if (!sessionId) {
		return (
			<BaseDialog
				open
				onClose={onClose}
				maxWidth="sm"
				title="Sign in to an MCP server"
				actions={<SecondaryButton onClick={onClose}>Close</SecondaryButton>}
			>
				<p className="p-1.5 text-body text-ink-muted" role="alert">
					Open a conversation to sign in to this server.
				</p>
			</BaseDialog>
		);
	}
	if (state.kind === "key")
		return (
			<McpKeyDialog
				open
				target={state.row}
				saving={remedy.pendingName === row.name}
				error={remedy.keyErrorFor(row.name)}
				onCancel={onClose}
				onSave={(values, confirmedReplace) => {
					void remedy
						.pressKey(state.row, values, confirmedReplace)
						.then((connected) => {
							if (connected) onClose();
						});
				}}
			/>
		);
	const operations =
		status.data?.operations?.filter((op) => op.name === row.name) ?? [];
	const operation = [...operations].sort(
		(a, b) => b.created_at - a.created_at,
	)[0];
	const running =
		state.kind === "running" && (!operation || operation.status === "running");
	const error = remedy.keyErrorFor(row.name);
	return (
		<BaseDialog
			open
			onClose={onClose}
			maxWidth="sm"
			title={`Sign in to ${row.name}`}
			actions={
				<>
					<SecondaryButton onClick={onClose}>Close</SecondaryButton>
					{state.kind === "grant" ? (
						<PrimaryButton
							onClick={() => {
								remedy.press({ ...row, remedy: { kind: "grant" } }, action);
								setState({ kind: "running" });
							}}
						>
							{action === "reauth"
								? "Replace grant and sign in"
								: "Continue in browser"}
						</PrimaryButton>
					) : null}
					{state.kind === "notice" ||
					error ||
					(state.kind === "running" && !running) ? (
						<PrimaryButton onClick={() => setAttempt((value) => value + 1)}>
							Try again
						</PrimaryButton>
					) : null}
					{operation?.status === "running" ? (
						<SecondaryButton onClick={() => remedy.cancel(operation.id)}>
							Cancel sign-in
						</SecondaryButton>
					) : null}
				</>
			}
		>
			<div className="flex flex-col gap-3 p-1.5 text-body text-ink-muted">
				{state.kind === "probing" ? (
					<p>Checking this server's sign-in method…</p>
				) : null}
				{state.kind === "notice" ? <p role="alert">{state.message}</p> : null}
				{state.kind === "grant" ? (
					<p>
						Your browser opens to approve access.
						{action === "reauth"
							? " This replaces the existing grant for this server."
							: ""}
					</p>
				) : null}
				{state.kind === "running" ? (
					<p>
						{operation?.message ||
							(running
								? "Waiting for backend sign-in status…"
								: `Sign-in ${operation?.status ?? "status unavailable"}.`)}
					</p>
				) : null}
				{status.error ? (
					<p role="alert">
						Could not refresh sign-in status. Close and check the server list
						before retrying.
					</p>
				) : null}
				{error ? (
					<p role="alert" className="text-danger">
						{error}
					</p>
				) : null}
			</div>
		</BaseDialog>
	);
}
