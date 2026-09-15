/**
 * Starting an MCP remedy from the run panel (`docs/run-sidebar.md` § 7.2, as
 * amended by this change).
 *
 * Four operations, all of them the BACKEND's: a browser sign-in
 * (`mcp.control {action: "reauth", confirmed: true}`), a reconnect
 * (`{action: "connect"}`), a cancel for a grant already running
 * (`{action: "cancel", operation_id}`), and a `reload` that re-reads one server's
 * configuration from disk. The panel starts them, watches them in the read it
 * already polls, and cancels one — it never writes configuration. `add`, `remove`,
 * `scope` and credential entry stay on the surface that owns the configuration
 * (`settings/components/mcp-management-section.tsx`); `reload` is a READ of that
 * configuration, and it is the one action that picks up a `${NAME}` reference the
 * failure copy asks for, so a failure state offers it where it can work.
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
} from "@shared/api/local-operator/desktop-api";
import { fetchMcpProbe, mcpKeys } from "@shared/api/local-operator/mcp-list";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { DesktopMcpState } from "../../../../../../shared/desktop-control-contract";
import {
	type McpFailure,
	type McpFailurePhase,
	mcpFailure,
} from "./mcp-failure";
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
	sessionId?: string | null;
	press: (row: McpServerRow, action?: "login" | "reauth") => void;
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
		confirmedReplace?: string[],
	) => Promise<boolean>;
	/** Cancel a running grant by operation id. */
	cancel: (operationId: string) => void;
	/**
	 * Re-read the named server's configuration from disk.
	 *
	 * A READ: it writes no config, which is why this surface can carry it at all
	 * (`§ 7.2`) — and it is the one action that picks up a `${NAME}` reference the
	 * failure copy may be asking for, which is why the sign-in dialog's failure
	 * state offers it (`mcp-failure.ts`).
	 *
	 * Resolves `true` only when the control was ACCEPTED, so a caller that re-asks
	 * the server a question about the reloaded config (the sign-in dialog re-probes
	 * after it) does not ask it of a config that never reloaded.
	 */
	reload: (row: McpServerRow) => Promise<boolean>;
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
	 * The last failure recorded for ONE server, or `null`.
	 *
	 * Already classified (`mcp-failure.ts`): the raw backend sentence is never what
	 * a surface renders, and the same record carries the server's own words when
	 * they are a reason rather than a category.
	 *
	 * Per server rather than one slot: a sentence authored by A's refusal must not
	 * appear in B's form (code review round 1, finding 3).
	 */
	failureFor: (name: string) => McpFailure | null;
	/**
	 * Drop the failure remembered for one server.
	 *
	 * Called when a surface makes a FRESH attempt at that row — the sign-in dialog
	 * clears it as it re-probes — because a sentence authored by the last press
	 * describes a request nobody is repeating. Without it the record outlives the
	 * dialog that authored it (the hook lives on the page, not in the dialog) and
	 * the next open renders a stale failure under a fresh probe.
	 */
	clearFailure: (name: string) => void;
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
	const [failures, setFailures] = useState<
		Readonly<Record<string, McpFailure>>
	>({});

	const explain = useCallback(
		async (row: McpServerRow, refused: DesktopControlError) => {
			const key = mcpKeys.list(sessionId ?? "");
			const cached = queryClient.getQueryData<DesktopMcpState>(key);
			// One known cause, and no reason to spend a request on it.
			if (refused.status !== 409 || mcpGrantInFlight(cached?.operations))
				return;
			try {
				const probe = await fetchMcpProbe(sessionId as string, row.name);
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

	/**
	 * Classify one failure and remember it against its server.
	 *
	 * The classification is a single call into `mcp-failure.ts`, so no surface
	 * renders the wire's own sentence by accident: `grantRunning` is read from the
	 * read's own operations, which is what makes "a sign-in is already running"
	 * sayable at all (the backend answers that case with the same opaque 409 it
	 * answers every other refusal with).
	 */
	const recordFailure = useCallback(
		(name: string, phase: McpFailurePhase, cause: unknown) => {
			const cached = queryClient.getQueryData<DesktopMcpState>(
				mcpKeys.list(sessionId ?? ""),
			);
			setFailures((previous) => ({
				...previous,
				[name]: mcpFailure(phase, cause, mcpGrantInFlight(cached?.operations)),
			}));
		},
		[queryClient, sessionId],
	);

	const press = useCallback(
		(row: McpServerRow, action: "login" | "reauth" = "reauth") => {
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
			// And its last failure, for the same reason: a press is new information,
			// so a sentence authored by the previous one must not outlive it.
			setFailures((previous) => {
				const { [row.name]: _cleared, ...rest } = previous;
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
						control: { action, name: row.name, confirmed: true },
					});
					// Instant feedback only: the backend's own operation state arrives
					// through the poll, so this surface never renders a grant it has
					// started as anything the backend has not said.
					void queryClient.invalidateQueries({ queryKey: key });
				} catch (cause) {
					// The phase is the request this press actually made, not the row's
					// remedy: `reconnect` and a refused sign-in need different copy.
					recordFailure(
						row.name,
						row.remedy?.kind === "reconnect" ? "reconnect" : "grant",
						cause,
					);
					if (cause instanceof DesktopControlError) {
						await explain(row, cause);
					}
				} finally {
					setPendingName(null);
				}
			})();
		},
		[explain, queryClient, recordFailure, sessionId],
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
				} catch (cause) {
					const state = queryClient.getQueryData<DesktopMcpState>(
						mcpKeys.list(sessionId),
					);
					const name = state?.operations?.find(
						(op) => op.id === operationId,
					)?.name;
					if (name) recordFailure(name, "cancel", cause);
				}
			})();
		},
		[queryClient, recordFailure, sessionId],
	);

	/**
	 * Write the row's declared credentials to the encrypted store, then reconnect.
	 *
	 * Two operations, in this order, and the order is the point: the credential has
	 * to exist before the reconnect builds a transport from it.
	 *
	 * The write is `mcp.credentials.store` — a DEDICATED transport, not
	 * `credentials.update`. There are three reasons it is its own op, and each one
	 * was a real defect (review R2-3): `credentials.update` writes the legacy
	 * plaintext `credentials.env` that the MCP resolver no longer consults, it is
	 * the PROVIDER credential surface (so an MCP key there is advertised to every
	 * provider list), and its route accepts any key name, which is how the form
	 * ended up writing a config field name — `Authorization` — as a store ID
	 * (R2-2). The owner validates every submitted ID against the server's own
	 * declared references BEFORE writing anything, so an unknown or undeclared ID
	 * is refused with a code rather than half-applied.
	 *
	 * The reconnect is the `connect` control, whose response is the new snapshot —
	 * and the SUCCESS of this call is read off that snapshot's own row rather than
	 * off the request's status. `manager.reconnect_server` swallows every failure and
	 * returns `None` (`mcp/manager.py:1671-1679`), so a 2xx `connect` says only that
	 * the request was accepted; a stored key that the runtime cannot use comes back
	 * with the row still `auth-required`, and that is what the dialog has to say
	 * (code review round 1, finding 3).
	 *
	 * **A save is never reported as a success on its own.** The caller closes the
	 * form only on a `connected` row, and every other outcome — a partial write, a
	 * refused write, an unconfirmed replacement, a live-but-unauthenticated
	 * reconnect — keeps the form MOUNTED with the values still in it and the
	 * backend's own sentence beside it, so a refusal never discards what the user
	 * typed and never claims a connection nobody verified (R2-5). The values are
	 * component state only: never cached, never in history, never in a URL.
	 */
	const pressKey = useCallback(
		async (
			row: McpServerRow,
			values: Record<string, string>,
			confirmedReplace: string[] = [],
		): Promise<boolean> => {
			if (!sessionId) return false;
			setPendingName(row.name);
			setFailures((previous) => {
				const { [row.name]: _cleared, ...rest } = previous;
				return rest;
			});
			const key = mcpKeys.list(sessionId);
			try {
				const stored = await desktopResult<{
					data: { code: string; saved_ids: string[]; failed_ids: string[] };
				}>({
					op: "mcp.credentials.store",
					sessionId,
					name: row.name,
					values,
					confirmedReplace,
				});
				if (stored.data?.code !== "saved") {
					const result = stored.data;
					const why =
						result?.code === "replace_confirmation_required"
							? "Confirm replacement of the existing shared keys before saving."
							: `Not saved: ${(result?.failed_ids ?? Object.keys(values)).join(", ")}. Unlock or repair the encrypted store, then retry.`;
					// An OUTCOME rather than an exception: the write answered, and the
					// answer is what the sentence reports. Its cause is `unknown` because
					// only the failed IDs are known — the store's reason is not on this
					// wire — so the remedies stay available rather than being guessed at.
					setFailures((previous) => ({
						...previous,
						[row.name]: {
							cause: "unknown",
							phase: "key",
							detail: null,
							message:
								why +
								(result?.saved_ids.length
									? ` Saved: ${result.saved_ids.join(", ")}.`
									: ""),
						},
					}));
					setPendingName(null);
					return false;
				}
			} catch (cause) {
				recordFailure(row.name, "key", cause);
				setPendingName(null);
				return false;
			}
			try {
				// The credentials surface reads its own key, so a key entered here must not
				// leave that list one edit behind.
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
					if (updated?.status === "connected") return true;
				} else {
					void queryClient.invalidateQueries({ queryKey: key });
				}
				setFailures((previous) => ({
					...previous,
					[row.name]: {
						cause: "unknown",
						phase: "reconnect",
						detail: null,
						message:
							"The keys were saved, but this server is not connected. Check the credentials and server setup, then retry.",
					},
				}));
				return false;
			} catch (cause) {
				recordFailure(row.name, "reconnect", cause);
				return false;
			} finally {
				setPendingName(null);
			}
		},
		[queryClient, recordFailure, sessionId],
	);

	/**
	 * Re-read one server's configuration from disk.
	 *
	 * Offered from a failure state (`mcp-failure.ts`) because it is the action that
	 * picks up a config the user has just edited — the `${NAME}` reference an
	 * earlier sentence may have asked for — and it writes nothing, so it belongs on
	 * the same surface as the other backend-owned operations. A failure here is
	 * recorded like any other, which is how the sentence for it reaches the dialog
	 * that offered the control.
	 */
	const reload = useCallback(
		async (row: McpServerRow): Promise<boolean> => {
			if (!sessionId) return false;
			setPendingName(row.name);
			setFailures((previous) => {
				const { [row.name]: _cleared, ...rest } = previous;
				return rest;
			});
			try {
				const envelope = await desktopResult<{ data: DesktopMcpState }>({
					op: "mcp.control",
					sessionId,
					control: { action: "reload", name: row.name },
				});
				const key = mcpKeys.list(sessionId);
				if (envelope?.data) queryClient.setQueryData(key, envelope.data);
				else void queryClient.invalidateQueries({ queryKey: key });
				return true;
			} catch (cause) {
				// Its own phase: a reload that failed is not a status read that failed,
				// and the sentence for it is the one about the server's configuration.
				recordFailure(row.name, "reload", cause);
				return false;
			} finally {
				setPendingName(null);
			}
		},
		[queryClient, recordFailure, sessionId],
	);

	const refusalFor = useCallback(
		(row: McpServerRow) => refusals[refusalKey(row)] ?? null,
		[refusals],
	);

	const failureFor = useCallback(
		(name: string) => failures[name] ?? null,
		[failures],
	);

	const clearFailure = useCallback((name: string) => {
		setFailures((previous) => {
			if (!(name in previous)) return previous;
			const { [name]: _cleared, ...rest } = previous;
			return rest;
		});
	}, []);

	return {
		sessionId,
		press,
		pressKey,
		cancel,
		reload,
		pendingName,
		failureFor,
		clearFailure,
		refusalFor,
	};
}
