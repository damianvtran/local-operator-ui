/**
 * The Schedules page's monitor read and its one write (#1898).
 *
 * The page's Monitors section lists every standing watch on this machine
 * (`monitors.list`, the route the TUI band and the phone's Schedules view read)
 * and offers the run pane's own cancel on each. Read-and-cancel only: arming a
 * monitor stays the agent's `monitor` tool, and no arm form exists here.
 *
 * ## Why the cancel controls are the page's own, and how small they are
 *
 * The pane's `useMonitorControls` is bound to ONE session at hook level - its
 * mutation takes a monitor id - because the pane shows one conversation. This
 * page shows many, so its controls take the page-wide row key
 * (`monitorRowKey`: `<session>/<monitor>`) and split it. Everything else is the
 * pane's: the same retry policy (`retryMonitorWrite`), the same failure
 * sentence, the same converge-either-way re-read, and the same
 * `MonitorCancelOutcome` the pane's cancel interaction (`useMonitorCancel`)
 * consumes - which is what lets the page reuse that interaction, its dialog and
 * its row records unchanged.
 */
import {
	type MonitorCancelOutcome,
	type MonitorControls,
	retryMonitorWrite,
} from "@features/chat/components/run-details/monitor-controls-model";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	type DesktopMonitorWriteReceipt,
	type DesktopMonitorsListResponse,
	MONITORS_LIST_KEY,
	MonitorsApi,
} from "@shared/api/local-operator/monitors-api";
import { apiConfig } from "@shared/config/api-config";
import { resyncCanonicalSession } from "@shared/hooks/use-canonical-session";
import { t } from "@shared/i18n";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";
import { splitMonitorRowKey } from "../scheduled-task-model";
import { WAKES_POLL_MS } from "./use-wakes-queries";

export { MONITORS_LIST_KEY };

/**
 * The machine-wide monitor listing.
 *
 * Polled on the wake listing's interval and for its reason: nothing pushes the
 * monitor index to a window that has none of those sessions open (the only
 * event stream is per session), so a machine-wide read can only poll. One
 * interval for both sections keeps the page from showing two freshnesses side by
 * side; a cancel from either surface invalidates the key directly.
 */
export const useMonitorsListing = () => {
	const { baseUrl } = apiConfig;
	return useQuery<DesktopMonitorsListResponse, Error>({
		queryKey: MONITORS_LIST_KEY,
		queryFn: () => MonitorsApi.list(),
		enabled: !!baseUrl,
		refetchInterval: WAKES_POLL_MS,
		refetchOnWindowFocus: true,
	});
};

/**
 * Cancel controls keyed by the page-wide row key, in the pane's
 * `MonitorControls` shape so `useMonitorCancel` can drive them.
 */
export const useMonitorListingControls = (): MonitorControls => {
	const queryClient = useQueryClient();
	const cancel = useMutation<DesktopMonitorWriteReceipt, Error, string>({
		mutationFn: (key) => {
			const target = splitMonitorRowKey(key);
			/*
			 * Every key on the page is minted by `monitorRowKey`, so this is
			 * unreachable through the app; it resolves a truthful sentence rather
			 * than sending a DELETE against a malformed path.
			 */
			if (!target)
				return Promise.reject(
					new Error(t("ui.chat.run_controls.monitor.no_conversation")),
				);
			return MonitorsApi.cancel(target.sessionId, target.monitorId);
		},
		retry: retryMonitorWrite,
	});
	const { mutateAsync } = cancel;
	return {
		cancel: useCallback(
			async (key: string): Promise<MonitorCancelOutcome> => {
				try {
					await mutateAsync(key);
					return { ok: true };
				} catch (error) {
					return {
						ok: false,
						detail: userFacingMessage(
							error,
							t("ui.chat.run_controls.monitor.cancel_failed"),
						),
					};
				} finally {
					/*
					 * Converge EITHER WAY, the pane's rule (`use-monitor-controls.ts`):
					 * a refusal can be the face of a cancel that landed (a retried
					 * DELETE answered `no monitor with id` after its first attempt's
					 * response was lost). The listing is this page's read; the
					 * session's canonical snapshot is what an open pane and the
					 * composer's chip publish.
					 */
					void queryClient.invalidateQueries({ queryKey: MONITORS_LIST_KEY });
					const target = splitMonitorRowKey(key);
					if (target) resyncCanonicalSession(target.sessionId);
				}
			},
			[mutateAsync, queryClient],
		),
	};
};
