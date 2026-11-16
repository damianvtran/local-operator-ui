import {
	type BrowserAttentionRow,
	browserAttentionRows,
} from "@shared/browser-user-attention";
import { useEffect, useMemo } from "react";
import {
	type ApprovalRequestInput,
	liveApprovalCount,
	readApprovalClock,
	useApprovalClockValue,
} from "../model/approval-queue-model";
import { useBrowserProjection } from "./use-browser-chrome";

const NO_REQUESTS: readonly ApprovalRequestInput[] = [];

/**
 * Everything the browser is waiting on the USER for, app-wide: the sidebar's
 * notification rows, and their count for the Browser badge.
 *
 * WHY THE BADGE COUNTS MORE THAN APPROVALS NOW (operator report 2026-11-15, "the
 * browser is stealing the view"): a passkey custody hold and a held agent popup
 * used to pull the user into the browser; they are now notifications the user
 * opens when they choose, and a notification nobody can see is a wait nobody
 * answers. The badge is where the user learns one exists on every route, so it
 * counts every row (`browserAttentionRows`), approvals included —
 * `useAppWideApprovals` keeps its narrower meaning for anything that asks only
 * about approvals.
 *
 * Same projection and the same shared clock as `useAppWideApprovals`, for the
 * same reasons that hook records (one snapshot; liveness is derived, so the
 * clock re-reads when a projection lands).
 */
export function useBrowserAttention(): {
	rows: BrowserAttentionRow[];
	count: number;
} {
	const { state } = useBrowserProjection();
	const requests = state?.pendingConsent ?? NO_REQUESTS;
	const now = useApprovalClockValue((at) => liveApprovalCount(requests, at));
	useEffect(() => {
		if (requests.length > 0) readApprovalClock();
	}, [requests]);
	const rows = useMemo(() => browserAttentionRows(state, now), [state, now]);
	return { rows, count: rows.length };
}
