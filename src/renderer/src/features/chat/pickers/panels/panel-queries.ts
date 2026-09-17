import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import {
	desktopResult,
	isDeadlineExceeded,
} from "@shared/api/local-operator/desktop-api";
import { SNAPSHOT_READ_OPTIONS } from "@shared/api/query-client";
import { keepPreviousData } from "@tanstack/react-query";
import type {
	DesktopAnalyticsData,
	DesktopInfoData,
	DesktopSessionReport,
} from "../../../../../../shared/desktop-contract";

/**
 * The four panel reads, as react-query options.
 *
 * Exported as options rather than inlined into each panel for the reason
 * `usageQueryOptions` is: the wiring is what a test can drive, and the two
 * things that go wrong here are both about time rather than about shape — a key
 * that blanks the content it is replacing, and a `staleTime` that re-reads a
 * snapshot the user asked to see once.
 *
 * Freshness is per panel and deliberate:
 *
 * | panel | staleTime | why |
 * |---|---|---|
 * | `/info` | 15 s | a second open shows the skeleton, not a stale install block — no `keepPreviousData` |
 * | `/session` | 0 | a diagnostics panel is re-read on every open |
 * | `/analytics` | 15 s | with `keepPreviousData`, so toggling the window does not blank the chart it is changing |
 * | `/failovers` | 15 s | |
 *
 * No polling anywhere. Every panel is a snapshot the user opened, refreshed by
 * reopening — the same contract `/usage` uses. `/context` has no entry: it is a
 * routed command, not a catalogue read, and holds the owner's answer in
 * component state.
 *
 * That sentence is not decoration; it is the reason for
 * {@link PANEL_READ_POLICY} below. A row here says what re-reads the panel, and
 * a focus refetch is not on any of them.
 */

export const PANEL_STALE_MS = 15_000;

/**
 * What every panel read shares beyond its own `staleTime`: how a failure is
 * answered, and what a focus change means.
 *
 * NOT a tidiness refactor — both entries are fixes for the same measured
 * behaviour, and both are about a read whose cost is the ledger rather than the
 * request (see `desktopRequestDeadlineMs`):
 *
 * - `retry` accepts one retry for an ordinary failure and none for a read that
 *   ran out of its own deadline, which is the shared `retryDesktopQuery`
 *   narrowed rather than a second policy: on top of its rule (a failure that
 *   produced no answer at all has already cost the whole budget and cannot
 *   learn more from a second identical wait) these reads refuse the retry that
 *   matters most here. The retry is not a second chance at a cheap call: the
 *   daemon is still executing the first scan, and the two scans contend for the
 *   same ledger — measured with three concurrent `analytics.get` reads against
 *   one isolated backend, each answered in 16-17.4 s where the same read alone
 *   answered in ~7 s. So a retry after a deadline makes the answer slower than
 *   waiting would have been, on top of reporting the wait as a failure.
 * - `refetchOnWindowFocus: false` from `SNAPSHOT_READ_OPTIONS`, whose own
 *   comment carries the argument. The table above is the contract this would
 *   break: every panel is a snapshot the user opened; none of the four rows
 *   promises a re-read on focus, and `refetchOnMount` — left on deliberately —
 *   is what reopening the panel does.
 */
const PANEL_READ_POLICY = {
	retry: (failureCount: number, error: Error) =>
		!isDeadlineExceeded(error) && retryDesktopQuery(failureCount, error),
	...SNAPSHOT_READ_OPTIONS,
} as const;

/** `info.get` — one answer per host, and never a stale one shown as fresh. */
export const infoQueryOptions = () => ({
	queryKey: ["desktop", "info"] as const,
	queryFn: () => desktopResult<{ data: DesktopInfoData }>({ op: "info.get" }),
	staleTime: PANEL_STALE_MS,
	...PANEL_READ_POLICY,
});

/**
 * `sessions.report` — one pinned read of the ledger for this session.
 *
 * `staleTime: 0` because the panel's whole claim is that every number on it
 * came from ONE transaction at the moment it opened; a cached answer from a
 * previous open would be a second snapshot wearing the first one's authority.
 */
export const sessionReportQueryOptions = (
	sessionId: string,
	recentLimit = 12,
) => ({
	queryKey: [
		"desktop",
		"session-report",
		sessionId,
		/*
		 * The limit is part of the request, so it is part of the identity: two
		 * callers asking for different tails of the same session are two answers,
		 * and a key without it would serve one to the other (review round 1, N4).
		 */
		recentLimit,
	] as const,
	queryFn: () =>
		desktopResult<{ data: DesktopSessionReport }>({
			op: "sessions.report",
			sessionId,
			recentLimit,
		}),
	staleTime: 0,
	...PANEL_READ_POLICY,
});

export type AnalyticsWindowArgs = {
	days: number;
	/** The scope session, or `undefined` for every session on this machine. */
	sessionId?: string;
	sinceMs: number;
	untilMs: number;
};

/**
 * `analytics.get` — the windowed aggregate and the day series.
 *
 * The window is part of the key because the panel derives it from one computed
 * local day, so two windows are two different answers rather than two views of
 * one. `keepPreviousData` keeps the chart on screen while the new window loads:
 * without it, toggling Today / 7 days / 30 days replaced a chart with a
 * skeleton and back, which reads as the data being refetched from nothing.
 */
export const analyticsQueryOptions = ({
	days,
	sessionId,
	sinceMs,
	untilMs,
}: AnalyticsWindowArgs) => ({
	queryKey: [
		"desktop",
		"analytics",
		days,
		sessionId ?? "",
		sinceMs,
		untilMs,
	] as const,
	queryFn: () =>
		desktopResult<{ data: DesktopAnalyticsData }>({
			op: "analytics.get",
			days,
			sinceMs,
			untilMs,
			sessionId,
		}),
	staleTime: PANEL_STALE_MS,
	placeholderData: keepPreviousData,
	...PANEL_READ_POLICY,
});

/** `sessions.failovers` — the selected/effective pair and the configured chains. */
export const failoversQueryOptions = (sessionId: string) => ({
	queryKey: ["desktop", "failovers", sessionId] as const,
	queryFn: () =>
		desktopResult<{
			data: {
				selected: { provider: string; model_id: string } | null;
				effective: { provider: string; model_id: string } | null;
				chains: Record<string, string[]>;
				scope: string;
				live_model_source: string;
			};
		}>({ op: "sessions.failovers", sessionId }),
	staleTime: PANEL_STALE_MS,
	...PANEL_READ_POLICY,
});
