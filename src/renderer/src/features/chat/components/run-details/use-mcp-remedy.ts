/**
 * Starting an MCP remedy from the run panel (`docs/run-sidebar.md` § 7.2, as
 * amended by this change).
 *
 * Three operations, all of them the BACKEND's: a browser sign-in
 * (`mcp.control {action: "reauth", confirmed: true}`), a reconnect
 * (`{action: "connect"}`), and a cancel for a grant already running
 * (`{action: "cancel", operation_id}`). The panel starts them, watches them in
 * the read it already polls, and cancels one — it never writes configuration.
 * `add`, `remove`, `reload`, `scope` and credential entry stay on the surface
 * that owns the configuration (`settings/components/mcp-management-section.tsx`).
 *
 * ## Why the list poll is the RENDERING source, and the POST response is not
 *
 * `mcp.list` already returns `operations` (`MCPDesktop.snapshot()`, which the row
 * derivation folds into `McpServerRow.grant`), and the panel already polls that
 * read at 5 s while it is open. So the row's grant state comes from one read that
 * cannot disagree with itself, and no second timer is added. A POST's own
 * response is used for instant feedback only — for `reauth` it is the operation
 * the backend has just created, and rendering THAT as the state would be this
 * surface claiming a sign-in finished when the backend has only started it. For
 * `connect` the response IS the new snapshot (the control is awaited inline and
 * runs no operation, `mcp/desktop.py:203-205`), so it is written into the same
 * cache entry — the same DOCUMENT `mcp-list.ts` owns — and the row settles
 * without waiting for the next tick.
 *
 * ## Why a refusal is probed rather than printed
 *
 * The wire reduces every refusal to one sentence: `serving.py:2931-2940` collapses
 * each `ValueError` to the code `mcp_control_refused` and the route replaces even
 * that with one fixed string (`routes/desktop_lifecycle.py:148-155`). A renderer
 * therefore holds a 409 and a sentence that fits none of the three causes, and
 * printing it is the unhelpful-copy class `branding.md` § 8 refuses. So a refused
 * press runs ONE `probe` (`mcp/desktop.py:196-200`, which answers
 * `transport_oauth_supported` for that server) and remembers the answer for that
 * row: a server that cannot do OAuth gets the pointer to where its credentials
 * live, and one that can gets told the sign-in was refused. The happy path pays
 * nothing for this — the probe runs on the failure path only — and the probe is
 * skipped entirely while any operation is running, because then the refusal has a
 * known cause (one grant per session, `mcp/desktop.py:158-160`) rather than an
 * unknown one.
 */

import {
	DesktopControlError,
	desktopResult,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import { mcpKeys } from "@shared/api/local-operator/mcp-list";
import { credentialsQueryKey } from "@shared/hooks/use-credentials";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { DesktopMcpState } from "../../../../../../shared/desktop-control-contract";
import { type McpServerRow, mcpGrantInFlight } from "./run-detail-model";

/**
 * Why a sign-in was refused, as far as this surface can tell.
 *
 * `not-oauth` is a fact the backend confirmed (the probe answered false), and
 * `refused` is the honest reading of everything else. Both are about one ROW and
 * remembered by server name, so the next press goes straight to the right
 * wording instead of probing again.
 */
export type McpRefusal = "not-oauth" | "refused";

/** What the section needs to render and start a remedy. */
export type McpRemedyControls = {
	/** Start the row's remedy. The GRANT is confirmed by the caller first. */
	press: (row: McpServerRow) => void;
	/**
	 * Write the row's credentials and reconnect it (the key remedy).
	 *
	 * Resolves `true` only when every credential was stored AND the reconnect was
	 * accepted, so the caller keeps its dialog open on a press that did not take
	 * rather than closing on the appearance of one.
	 */
	pressKey: (
		row: McpServerRow,
		values: Record<string, string>,
	) => Promise<boolean>;
	/** Cancel a running grant by operation id. */
	cancel: (operationId: string) => void;
	/** The row whose press is in flight, or `null`. */
	pendingName: string | null;
	/**
	 * The remembered refusal for a row, or `null`.
	 *
	 * Takes the ROW rather than its name because the answer belongs to a
	 * CONFIGURATION, not to a name: a refusal memoised for a transport that has
	 * since been edited from another window is copy about a server that no longer
	 * exists (code review round 1, finding 2). The key below is the signature of
	 * everything the answer depended on.
	 */
	refusalFor: (row: McpServerRow) => McpRefusal | null;
	/**
	 * The sentence for a failed credential write on ONE server, or `null`.
	 *
	 * Per server rather than one slot: a sentence authored by A's refusal must not
	 * appear in B's form (code review round 1, finding 3).
	 */
	keyErrorFor: (name: string) => string | null;
};

/**
 * What a refusal answer depends on.
 *
 * `transport` and `oauthSupported` decide whether OAuth is even possible, and
 * `keyNames` decide whether the fallback is a credential form — so a change to any
 * of them invalidates the answer, and a re-read that changes none of them keeps it.
 */
const refusalKey = (row: McpServerRow): string =>
	[
		row.name,
		row.transport ?? "",
		String(row.oauthSupported),
		row.keyNames.join(","),
	].join("\u0000");

/** The `probe` answer, narrowed to the one field this surface reads. */
type ProbeResult = { transport_oauth_supported?: boolean | null };

export function useMcpRemedy({
	sessionId,
}: {
	sessionId: string | null | undefined;
}): McpRemedyControls {
	const queryClient = useQueryClient();
	const [pendingName, setPendingName] = useState<string | null>(null);
	const [refusals, setRefusals] = useState<
		Readonly<Record<string, McpRefusal>>
	>({});
	const [keyErrors, setKeyErrors] = useState<Readonly<Record<string, string>>>(
		{},
	);

	const explain = useCallback(
		async (row: McpServerRow, refused: DesktopControlError) => {
			const key = mcpKeys.list(sessionId ?? "");
			const cached = queryClient.getQueryData<DesktopMcpState>(key);
			// One known cause, and no reason to spend a request on it.
			if (refused.status !== 409 || mcpGrantInFlight(cached?.operations))
				return;
			try {
				const probe = await desktopResult<ProbeResult>({
					op: "mcp.control",
					sessionId: sessionId as string,
					control: { action: "probe", name: row.name },
				});
				setRefusals((previous) => ({
					...previous,
					[refusalKey(row)]:
						probe.transport_oauth_supported === false ? "not-oauth" : "refused",
				}));
			} catch {
				/*
				 * A probe that does not ANSWER authors nothing, and that is the point: the
				 * same backend lock refuses it (`mcp/desktop.py`'s `if self.running: raise`),
				 * so the catch-all this replaces turned a second press inside the panel's own
				 * 5 s staleness window into the confident false sentence "this server refused
				 * the sign-in" — a more specific claim than the opaque 409 it was supposed to
				 * explain (code review round 1, finding 2). The row keeps its control and its
				 * state word; the lock reaches the next read and disables it there.
				 */
			}
		},
		[queryClient, sessionId],
	);

	const press = useCallback(
		(row: McpServerRow) => {
			if (!sessionId || !row.remedy) return;
			// `key` is the dialog's path (`pressKey`), and `words` is not an action: this
			// function starts the two ONE-OP remedies and nothing else.
			if (row.remedy.kind !== "grant" && row.remedy.kind !== "reconnect")
				return;
			const key = mcpKeys.list(sessionId);
			setPendingName(row.name);
			// A press clears what the last one learned: the next refusal may have a
			// different cause, and a remembered `not-oauth` would then be stale copy.
			setRefusals((previous) => {
				const { [refusalKey(row)]: _cleared, ...rest } = previous;
				return rest;
			});
			void (async () => {
				try {
					if (row.remedy?.kind === "reconnect") {
						const envelope = await desktopResult<{ data: DesktopMcpState }>({
							op: "mcp.control",
							sessionId,
							control: { action: "connect", name: row.name },
						});
						// `connect` returns the snapshot, so the row settles from this
						// response rather than from the next 5 s tick. It is the DOCUMENT
						// that is written (not the envelope), which is the one shape
						// `mcp-list.ts` owns — and a response that carried no document
						// leaves the row to the poll rather than to a row that never
						// moved (code review round 1, nit 6).
						if (envelope?.data) {
							queryClient.setQueryData(key, envelope.data);
						} else {
							void queryClient.invalidateQueries({ queryKey: key });
						}
						return;
					}
					await desktopResult({
						op: "mcp.control",
						sessionId,
						control: { action: "reauth", name: row.name, confirmed: true },
					});
					// Instant feedback only: the backend's own operation state arrives
					// through the poll, so this surface never renders a grant it has
					// started as anything the backend has not said.
					void queryClient.invalidateQueries({ queryKey: key });
				} catch (cause) {
					if (cause instanceof DesktopControlError) {
						await explain(row, cause);
					}
				} finally {
					setPendingName(null);
				}
			})();
		},
		[explain, queryClient, sessionId],
	);

	const cancel = useCallback(
		(operationId: string) => {
			if (!sessionId) return;
			void (async () => {
				try {
					await desktopResult({
						op: "mcp.control",
						sessionId,
						control: { action: "cancel", operation_id: operationId },
					});
					void queryClient.invalidateQueries({
						queryKey: mcpKeys.list(sessionId),
					});
				} catch {
					// Nothing to report here that the read will not report better: the
					// operation is either still running (and still shown) or gone, and the
					// row's own line is the surface for both.
				}
			})();
		},
		[queryClient, sessionId],
	);

	/**
	 * Write the row's credentials, then reconnect.
	 *
	 * Two operations, in this order, and the order is the point: the credential has
	 * to exist before the reconnect builds a transport from it. The credential path
	 * is the owner store's own (`credentials.update`, the op Settings → API
	 * credentials writes through), because the server's config holds a `${NAME}`
	 * reference rather than a value — see `mcp-key-dialog.tsx` for what that means
	 * against a backend that cannot resolve one yet.
	 *
	 * The reconnect is the `connect` control, whose response is the new snapshot —
	 * and the SUCCESS of this call is read off that snapshot's own row rather than
	 * off the request's status. `manager.reconnect_server` swallows every failure and
	 * returns `None` (`mcp/manager.py:1671-1679`), so a 2xx `connect` says only that
	 * the request was accepted; a stored key that the runtime cannot use comes back
	 * with the row still `auth-required`, and that is what the dialog has to say
	 * (code review round 1, finding 3).
	 *
	 * The write is per field and it names the field that failed: the loop stops at
	 * the first refusal, and the sentence says which value was not saved, because
	 * "the key could not be saved" over a two-field form is a sentence the reader
	 * cannot act on (finding 6).
	 */
	const pressKey = useCallback(
		async (
			row: McpServerRow,
			values: Record<string, string>,
		): Promise<boolean> => {
			if (!sessionId) return false;
			setPendingName(row.name);
			setKeyErrors((previous) => {
				const { [row.name]: _cleared, ...rest } = previous;
				return rest;
			});
			const key = mcpKeys.list(sessionId);
			const fields = Object.entries(values);
			for (const [index, [field, value]] of fields.entries()) {
				try {
					await desktopResult({ op: "credentials.update", key: field, value });
				} catch (cause) {
					// Authored copy only: a runtime exception's message is a stack-trace
					// fragment, and this line is read by someone who just typed a secret in.
					const why = userFacingMessage(cause, "It could not be saved.");
					// The fields before it DID land, and not saying so would send the reader
					// to re-enter a secret that is already stored.
					const earlier = index > 0 ? " The ones above it were saved." : "";
					setKeyErrors((previous) => ({
						...previous,
						[row.name]: `${field}: ${why}${earlier}`,
					}));
					setPendingName(null);
					return false;
				}
			}
			try {
				// The credentials surface reads its own key, so a key entered here must not
				// leave that list one edit behind.
				void queryClient.invalidateQueries({ queryKey: credentialsQueryKey });
				const envelope = await desktopResult<{ data: DesktopMcpState }>({
					op: "mcp.control",
					sessionId,
					control: { action: "connect", name: row.name },
				});
				if (envelope?.data) {
					queryClient.setQueryData(key, envelope.data);
					const updated = envelope.data.servers?.find(
						(server) => server.name === row.name,
					);
					if (updated && updated.status === "auth-required") {
						// True under BOTH backends, which is the point: the credential is
						// stored, and this read says the server still wants a sign-in. A
						// runtime that resolves the reference lands `connected` here and the
						// dialog closes.
						setKeyErrors((previous) => ({
							...previous,
							[row.name]:
								"The key was saved, but the server still needs sign-in.",
						}));
						return false;
					}
				} else {
					// No document to judge: the credential is stored and the row's own next
					// read is the statement, so this does not claim an outcome either way.
					void queryClient.invalidateQueries({ queryKey: key });
				}
				return true;
			} catch (cause) {
				setKeyErrors((previous) => ({
					...previous,
					[row.name]: userFacingMessage(
						cause,
						"The server could not be reconnected.",
					),
				}));
				return false;
			} finally {
				setPendingName(null);
			}
		},
		[queryClient, sessionId],
	);

	const refusalFor = useCallback(
		(row: McpServerRow) => refusals[refusalKey(row)] ?? null,
		[refusals],
	);

	const keyErrorFor = useCallback(
		(name: string) => keyErrors[name] ?? null,
		[keyErrors],
	);

	return {
		press,
		pressKey,
		cancel,
		pendingName,
		keyErrorFor,
		refusalFor,
	};
}
