/**
 * The run panel's monitor write: cancelling one standing watch, and the policy
 * around it.
 *
 * A PROP-BUILT control, taken in `chat-page.tsx` and threaded to the section as
 * `mcpRemedy` is (the MCP remedies' own arrangement, `use-mcp-remedy.ts`): the
 * page owns the session identity and the section stays presentational, which is
 * also what lets the story set inject a recorder instead of pressing a real
 * route.
 *
 * ## Why the outcome is RETURNED rather than reported through a read
 *
 * The MCP remedies are fire-and-forget because the read they poll reports their
 * outcome. A cancel has no such read on this surface, and a refusal must land in
 * the dialog that asked - the rule `delete-conversation-dialog.tsx` records: a
 * refusal shown over a dialog that has already closed reads as "it happened and
 * something else went wrong". So `cancel` resolves the outcome and the section's
 * one dialog decides: stay open with the sentence, or close and let the
 * canonical re-read drop the row.
 */
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	type DesktopMonitorWriteReceipt,
	MonitorsApi,
} from "@shared/api/local-operator/monitors-api";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import { useMutation } from "@tanstack/react-query";
import { useCallback } from "react";
import {
	type MonitorCancelOutcome,
	type MonitorControls,
	retryMonitorWrite,
} from "./monitor-controls-model";

/**
 * Re-exported so a consumer of this module reads one import for one control:
 * the shapes' single home is `monitor-controls-model.ts` (where the test can
 * reach them without React), and this is the path the section and the stories
 * already speak.
 */
export type {
	MonitorCancelOutcome,
	MonitorControls,
} from "./monitor-controls-model";

export const useMonitorControls = ({
	sessionId,
}: {
	sessionId?: string | null;
}): MonitorControls => {
	const cancel = useMutation<DesktopMonitorWriteReceipt, Error, string>({
		mutationFn: (monitorId) => {
			/*
			 * The section renders only off a session's own canonical field, so a
			 * press without a session is unreachable through the app; the guard
			 * is here so the impossible case resolves a truthful sentence instead
			 * of sending a request against an empty id.
			 */
			if (!sessionId)
				return Promise.reject(
					new Error("There is no conversation to cancel a monitor on."),
				);
			return MonitorsApi.cancel(sessionId, monitorId);
		},
		retry: retryMonitorWrite,
	});
	const { mutateAsync } = cancel;
	return {
		cancel: useCallback(
			async (monitorId: string): Promise<MonitorCancelOutcome> => {
				try {
					await mutateAsync(monitorId);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						detail: userFacingMessage(error, "Could not cancel the monitor."),
					};
				} finally {
					/*
					 * Converge the list EITHER WAY, not only on a success, and the
					 * difference is a real wire state rather than belt-and-braces: a
					 * refusal can be the face of a write that LANDED - a retried cancel
					 * whose first attempt was answered and whose response was lost gets
					 * the honest `no monitor with id` about a watch that is already gone -
					 * while an owner-present 503 changes nothing anywhere. Re-reading the
					 * conversation's canonical snapshot is what makes the list agree with
					 * the store in both cases; without it, a lost response would leave the
					 * pane showing a row the store no longer holds until some later
					 * canonical push happened to arrive.
					 */
					if (sessionId) resyncCanonicalSession(sessionId);
				}
			},
			[mutateAsync, sessionId],
		),
	};
};
