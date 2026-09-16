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
import { Alert } from "@shared/components/ui";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
	type McpFailure,
	type McpFailureAction,
	mcpConfigActions,
	mcpFailure,
	mcpFailureActions,
	mcpServerSettingsRoute,
} from "./mcp-failure";
import { McpKeyDialog } from "./mcp-key-dialog";
import { type McpServerRow, mcpGrantInFlight } from "./run-detail-model";
import type { McpRemedyControls } from "./use-mcp-remedy";

/**
 * One state per outcome, and every failure state carries the sentence it shows
 * AND the remedies it offers.
 *
 * The pair travels together rather than being recomputed at render time, because
 * the two are decided from the same facts — the phase that failed and the cause
 * classified from it — and a render-time recomputation from `state` alone could
 * not know either.
 */
type Transition =
	| { kind: "probing" }
	| { kind: "grant" }
	| { kind: "running" }
	| {
			kind: "notice";
			failure: McpFailure;
			actions: McpFailureAction[];
			/**
			 * The callout the state wears, and the distinction is the one the app
			 * already draws: a request that FAILED is `danger` (the run panel renders
			 * `auth-required` in the same semantic), while a probe that ANSWERED with
			 * "this server cannot sign in" is `warning` — nothing is broken, the flow
			 * simply cannot continue from here (design review round 3, D1: the refusal
			 * was chromatically identical to an informational dialog).
			 */
			severity: "danger" | "warning";
	  }
	| { kind: "key"; row: McpServerRow };

/** One transition owner for slash, sidebar and Settings. A false probe cannot
 * redispatch the original row's stale OAuth remedy. The backend owns consent,
 * callbacks and operation status; this component only asks and presents facts.
 *
 * ## The failure states route to the remedy, they do not only report it
 *
 * This dialog is where the operator's complaint landed: a refused control
 * answered with the backend's own sentence about "server ownership, transport
 * and current operation state", a retry of the identical request was the only
 * control, and the fixes for that row — `Sign in`, `Reload`, `Remove`, the key
 * its config declares — were two screens away (UX review round 2, U1). So every
 * failure below is rendered as `mcp-failure.ts` classifies it (plain language,
 * the wire's own words only where they are a reason rather than a category), and
 * carries the row's own remedies plus the one route that reaches the rest of
 * them (`Open this server in Settings`). What is offered is decided from the
 * phase, the cause and the row's own payload, never from what would be nice to
 * press: a remedy that cannot change the outcome is not offered at all.
 */
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
	const navigate = useNavigate();
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
		// A fresh probe invalidates the sentence the last press authored: the record
		// lives on the page, so without this the next open would render a stale
		// failure under a fresh check.
		remedy.clearFailure(row.name);
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
				/*
				 * A probe that ANSWERED is a finding, not a failure: the state is known
				 * and the sentence states it. The remedies are the config's own, because
				 * the two the sentence can name — a `${NAME}` reference to add, a backend
				 * too old to take a key — are both fixed where the config lives, and
				 * `Reload` is what picks an edited config up without leaving the dialog.
				 */
				setState({
					kind: "notice",
					severity: "warning",
					failure: {
						cause: "unknown",
						phase: "probe",
						detail: null,
						message: !secure
							? "Update the backend for secure MCP key entry. OAuth and the server list remain available."
							: probe.transport_oauth_supported === false
								? "This server does not use OAuth and declares no secret references. Add explicit ${NAME} references to its MCP environment or headers, then retry."
								: "Could not determine this server's sign-in method. Check its connection and MCP setup, then retry.",
					},
					actions: mcpConfigActions(),
				});
			})
			.catch((cause) => {
				if (!active) return;
				// The failure path that produced the finding: one classification, which
				// replaces the backend's sentence with ours and decides which of the
				// row's remedies are honest to offer from here.
				//
				// `grantRunning` comes from the same read this dialog already renders
				// (`status.data`), because a hardcoded `false` made the ONE cause this
				// surface can name with certainty unreachable: `mcp/desktop.py` refuses
				// every action except list/status/cancel while a grant runs, so reopening
				// this dialog during a sign-in is a refused probe whose cause is already
				// published in the operations list, and the reader got "refused it without
				// giving a reason" for a reason the app was holding (review R3).
				const failure = mcpFailure(
					"probe",
					cause,
					mcpGrantInFlight(status.data?.operations),
				);
				setState({
					kind: "notice",
					severity: "danger",
					failure,
					actions: mcpFailureActions({
						row,
						phase: "probe",
						cause: failure.cause,
						keyEntryAvailable: secure,
					}),
				});
			});
		return () => {
			active = false;
		};
		// biome-ignore lint/correctness/useExhaustiveDependencies: `remedy` is a fresh object each render and must not re-arm the probe; `attempt` is the explicit retry
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
				failure={remedy.failureFor(row.name)}
				onCancel={onClose}
				onOpenSettings={() => navigate(mcpServerSettingsRoute(state.row.name))}
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
	/*
	 * Whether the latest statement about this row is a sign-in that FINISHED, as
	 * opposed to one that is still going or ended badly.
	 *
	 * Read off the wire's own word rather than off the absence of `running`: an
	 * operation whose status this build cannot read (a word from a newer backend)
	 * is not a success, and folding the two together would drop the retry for a
	 * state nothing here can vouch for — see the footer's remark.
	 */
	const completed = operation?.status === "complete";
	const failure = remedy.failureFor(row.name);
	const statusFailure = status.error
		? mcpFailure("status", status.error, false)
		: null;
	/*
	 * What a press of one offered remedy does. Each case is the SAME call the row
	 * behind this dialog makes — the panel and the dialog share one transition
	 * owner (`use-mcp-remedy.ts`), so a remedy started here cannot take a path the
	 * row would not have taken.
	 */
	const run = (remedyAction: McpFailureAction) => {
		if (remedyAction.kind === "settings") {
			onClose();
			navigate(mcpServerSettingsRoute(row.name));
			return;
		}
		if (remedyAction.kind === "key") {
			setState({ kind: "key", row: { ...row, remedy: { kind: "key" } } });
			return;
		}
		if (remedyAction.kind === "reload") {
			// `reload` re-reads the config, so the probe has to run again afterwards:
			// the answer it is asked for (which sign-in this server takes) is exactly
			// what the edit reloaded was for. Only an ACCEPTED reload re-arms it — the
			// hook resolves `true` on acceptance alone for this caller — because a
			// reload that was itself refused must keep ITS sentence: re-probing here
			// clears it in the same commit and lands the reader back on the sentence
			// they just failed on, with `Reload` offered again (QA round 1, Q2).
			void remedy.reload(row).then((accepted) => {
				if (accepted) setAttempt((value) => value + 1);
			});
			return;
		}
		if (remedyAction.kind === "reconnect") {
			remedy.press({ ...row, remedy: { kind: "reconnect" } });
			return;
		}
		remedy.press({ ...row, remedy: { kind: "grant" } }, action);
		setState({ kind: "running" });
	};
	/*
	 * The probe's own state, and it stands down the moment a PRESS has authored a
	 * failure: the recorded failure is the more recent and more specific fact, and
	 * rendering both put a status line for a sign-in the callout below had just
	 * said could not be started (QA round 1, Q4), and left the reader reading the
	 * sentence they had already acted on.
	 */
	const notice = state.kind === "notice" && !failure ? state : null;
	const offered = notice?.actions ?? [];
	const failureActions = failure
		? mcpFailureActions({
				row,
				phase: failure.phase,
				cause: failure.cause,
				keyEntryAvailable: secure,
			})
		: [];
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
					failure ||
					(state.kind === "running" && !running && !completed) ? (
						/*
						 * The retry is a SECONDARY here, and that is D1's second half: the
						 * remedy carries the accent, so when one is on screen it takes it. It
						 * keeps the word `Try again` because it is still the honest move for a
						 * failure that was transient: it re-runs the PROBE for this row, and a
						 * probe that answers puts the dialog back on its own primary — which is
						 * how the request that just failed is offered again, one press away,
						 * rather than as a second control under this callout. Dropping it would
						 * leave the states with no remedy of their own a dialog with no action
						 * but Close.
						 *
						 * A COMPLETED sign-in (`completed` above) is the one settled state it
						 * stands down for, because here the retry is not one press away from
						 * another attempt at the same thing — it is one press away from
						 * re-offering the grant that just succeeded. The press re-runs the probe,
						 * the probe answers "this server takes OAuth", and the dialog returns to
						 * its own primary `Continue in browser`, a control whose whole meaning is
						 * "grant this now" sitting beside the sentence `Sign-in complete.` The
						 * presence of a retry under a success reads as though the sign-in had
						 * failed (operator report, 2026-09-16), and a success has nothing to
						 * retry, so the footer offers `Close` alone. The states above and below
						 * it are unchanged: `failed`, `cancelled`, and an operation whose status
						 * this build cannot read all keep the retry, as does the probe's own
						 * `notice` and a recorded press failure.
						 */
						<SecondaryButton onClick={() => setAttempt((value) => value + 1)}>
							Try again
						</SecondaryButton>
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
				{/*
				 * The recorded press failure IS the state while it is on screen (see
				 * `notice` above), so the probe's callout renders only when no press has
				 * answered since it was authored.
				 */}
				{notice ? (
					<>
						{/*
						 * The state wears the app's own callout for its severity, because the
						 * design round measured the refusal as chromatically identical to the
						 * informational dialog: the same near-white title, the same muted
						 * paragraph, the same right-aligned pair of controls, with the app's
						 * danger triple unspent (design review round 3, D1). The callout is the
						 * contract's shape for that meaning — `dangerWash` ground,
						 * `dangerBorder` edge, the semantic icon — and the sentence inside it
						 * stays `ink`, which `alert.tsx` measures at 8.62:1 on this wash
						 * against 4.62:1 for the semantic ink itself.
						 */}
						<Alert variant={notice.severity}>
							<div className="flex flex-col gap-1">
								<p role="alert">{notice.failure.message}</p>
								{/* The server's own words, verbatim, where they are a reason this
								    build cannot restate — the same treatment the run panel gives a
								    diagnosis, and machine voice for the same reason. */}
								{notice.failure.detail ? (
									<p
										className="font-mono text-ink-dim text-mono-sm"
										title={notice.failure.detail}
									>
										{notice.failure.detail}
									</p>
								) : null}
							</div>
						</Alert>
						{/*
						 * The remedies, and the FIRST one carries the accent. That ordering is
						 * the second half of D1: the accent may be spent three times per screen
						 * (`branding.md` § 2) and the dialog already spends it on its footer's
						 * primary, so the footer's primary is demoted to a secondary whenever a
						 * failure is on screen (below) and the remedy takes it. The list is
						 * ordered by `mcpFailureActions`: the row's own operation first, the row
						 * in Settings last, and nothing at all for the states where no control
						 * here can work.
						 */}
						{offered.length > 0 ? (
							<div className="flex flex-wrap items-center gap-2">
								{offered.map((offeredAction, index) =>
									index === 0 ? (
										<PrimaryButton
											key={offeredAction.kind}
											disabled={remedy.pendingName === row.name}
											data-mcp-failure-action={offeredAction.kind}
											onClick={() => run(offeredAction)}
										>
											{offeredAction.label}
										</PrimaryButton>
									) : (
										<SecondaryButton
											key={offeredAction.kind}
											disabled={remedy.pendingName === row.name}
											data-mcp-failure-action={offeredAction.kind}
											onClick={() => run(offeredAction)}
										>
											{offeredAction.label}
										</SecondaryButton>
									),
								)}
							</div>
						) : null}
					</>
				) : null}
				{state.kind === "grant" ? (
					<p>
						Your browser opens to approve access.
						{action === "reauth"
							? " This replaces the existing grant for this server."
							: ""}
					</p>
				) : null}
				{state.kind === "running" && !failure ? (
					<p>
						{operation?.message ||
							(running
								? "Waiting for backend sign-in status…"
								: `Sign-in ${operation?.status ?? "status unavailable"}.`)}
					</p>
				) : null}
				{statusFailure ? (
					<>
						<Alert variant="danger">
							<p role="alert">{statusFailure.message}</p>
						</Alert>
						{/* A failed status read is about the SERVER's side of this
						    conversation, so its remedies are the config's own: nothing the
						    dialog offers can restart a sign-in it cannot see. */}
						<div className="flex flex-wrap items-center gap-2">
							{mcpConfigActions().map((configAction, index) =>
								index === 0 ? (
									<PrimaryButton
										key={configAction.kind}
										data-mcp-failure-action={configAction.kind}
										onClick={() => run(configAction)}
									>
										{configAction.label}
									</PrimaryButton>
								) : (
									<SecondaryButton
										key={configAction.kind}
										data-mcp-failure-action={configAction.kind}
										onClick={() => run(configAction)}
									>
										{configAction.label}
									</SecondaryButton>
								),
							)}
						</div>
					</>
				) : null}
				{failure ? (
					<>
						<Alert variant="danger">
							<div className="flex flex-col gap-1">
								<p role="alert">{failure.message}</p>
								{failure.detail ? (
									<p
										className="font-mono text-ink-dim text-mono-sm"
										title={failure.detail}
									>
										{failure.detail}
									</p>
								) : null}
							</div>
						</Alert>
						{/* The remedies are recomputed here from the failure's own phase,
						    because the press that failed may have been any of the row's
						    operations and the one that failed is not offered again. */}
						{failureActions.length > 0 ? (
							<div className="flex flex-wrap items-center gap-2">
								{failureActions.map((failureAction, index) =>
									index === 0 ? (
										<PrimaryButton
											key={failureAction.kind}
											disabled={remedy.pendingName === row.name}
											data-mcp-failure-action={failureAction.kind}
											onClick={() => run(failureAction)}
										>
											{failureAction.label}
										</PrimaryButton>
									) : (
										<SecondaryButton
											key={failureAction.kind}
											disabled={remedy.pendingName === row.name}
											data-mcp-failure-action={failureAction.kind}
											onClick={() => run(failureAction)}
										>
											{failureAction.label}
										</SecondaryButton>
									),
								)}
							</div>
						) : null}
					</>
				) : null}
			</div>
		</BaseDialog>
	);
}
