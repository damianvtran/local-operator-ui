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
} from "@shared/api/local-operator/desktop-api";
import { mcpKeys } from "@shared/api/local-operator/mcp-list";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback, useState } from "react";
import type { DesktopMcpState } from "../../../../../../shared/desktop-control-contract";
import type { McpServerRow } from "./run-detail-model";

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
	/** Cancel a running grant by operation id. */
	cancel: (operationId: string) => void;
	/** The row whose press is in flight, or `null`. */
	pendingName: string | null;
	/** The remembered refusal for a server, or `null`. */
	refusalFor: (name: string) => McpRefusal | null;
};

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

	const explain = useCallback(
		async (name: string, refused: DesktopControlError) => {
			const key = mcpKeys.list(sessionId ?? "");
			const cached = queryClient.getQueryData<DesktopMcpState>(key);
			const running = (cached?.operations ?? []).some(
				(operation) => operation.status === "running",
			);
			// One known cause, and no reason to spend a request on it.
			if (refused.status !== 409 || running) return;
			try {
				const probe = await desktopResult<ProbeResult>({
					op: "mcp.control",
					sessionId: sessionId as string,
					control: { action: "probe", name },
				});
				setRefusals((previous) => ({
					...previous,
					[name]:
						probe.transport_oauth_supported === false ? "not-oauth" : "refused",
				}));
			} catch {
				// A probe that itself fails still explains the press: the row says the
				// sign-in was refused rather than claiming a cause it could not establish.
				setRefusals((previous) => ({ ...previous, [name]: "refused" }));
			}
		},
		[queryClient, sessionId],
	);

	const press = useCallback(
		(row: McpServerRow) => {
			if (!sessionId || !row.remedy || row.remedy.kind === "words") return;
			const key = mcpKeys.list(sessionId);
			setPendingName(row.name);
			// A press clears what the last one learned: the next refusal may have a
			// different cause, and a remembered `not-oauth` would then be stale copy.
			setRefusals((previous) => {
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
						// `mcp-list.ts` owns.
						if (envelope?.data) queryClient.setQueryData(key, envelope.data);
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
						await explain(row.name, cause);
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

	const refusalFor = useCallback(
		(name: string) => refusals[name] ?? null,
		[refusals],
	);

	return { press, cancel, pendingName, refusalFor };
}
