import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { retryDesktopQuery } from "./backend-error";
import {
	desktopResult,
	isDeadlineExceeded,
	userFacingMessage,
} from "./desktop-api";
import { useHubActionStore } from "./hub-action-store";
import {
	type HubItemKind,
	type HubMergeReport,
	type HubMutationResponse,
	type HubUpdates,
	hubCheckSentence,
	hubItemKey,
	hubReportNote,
	hubRollup,
} from "./hub-updates";

/**
 * The hub auto-update reads and writes.
 *
 * ## The read is free, so it polls
 *
 * `GET /v1/desktop/hub/updates` is a read of the backend's own status file: no
 * network, O(items), and it lists only items that are NOT up to date. That is
 * what makes a 60 s poll acceptable on a surface the sidebar keeps mounted, and
 * it is the ONLY thing that polls - the mutations below are the only calls that
 * reach the hub. `refetchIntervalInBackground: false` is the repo's convention
 * for a poll that is a courtesy to a visible window (`use-mcp-servers.ts`,
 * `mesh-store.ts`): a hidden window has nobody to update.
 *
 * `enabled` is the caller's `ready && desktopFeatureEnabled(caps, "hub_updates")`.
 * The gate is the caller's rather than this hook's because the sidebar and the
 * agents page each already hold the capabilities answer, and a hook that read it
 * itself would be a second subscriber to a query both of them have.
 *
 * ## The failure belongs to the surface
 *
 * The mutations announce nothing. `mutation.error` is left for the surface that
 * owns the control to render beside it, which is the hub's one error language
 * (`use-team-pull-mutation.ts`): a toast for a refusal that is also on screen
 * says it twice.
 */
export const hubUpdatesKey = ["desktop", "hub-updates"] as const;

export function useHubUpdates(enabled: boolean) {
	const query = useQuery({
		queryKey: hubUpdatesKey,
		enabled,
		queryFn: () => desktopResult<HubUpdates>({ op: "hub.updates" }),
		staleTime: 30_000,
		retry: retryDesktopQuery,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});
	// An error sentence beside a control answers a press; once the backend no
	// longer lists the item, the sentence is about something that is gone (R7).
	const data = query.data;
	useEffect(() => {
		if (!data) return;
		useHubActionStore
			.getState()
			.pruneNotes(new Set(data.items.map((i) => hubItemKey(i.kind, i.name))));
	}, [data]);
	return query;
}

/**
 * The writes, plus the bookkeeping a list of rows needs around them.
 *
 * Each write answers `{reports, status}`, and `status` is the fresh snapshot, so
 * the cache is updated from the response itself rather than after a second round
 * trip; the key is ALSO invalidated so a poll that raced the write cannot leave
 * an older snapshot standing.
 *
 * WHEN A REPORT APPLIED, the definitions themselves changed on disk. The
 * `authoring` revision channel refreshes the lists on a backend that publishes
 * it (`useAuthoringRefresh`), but that channel is absent on an older transport
 * and in browser development, so the same four keys are invalidated here too -
 * one cheap refetch of a list that did change. The detail editors re-seed from
 * what that refetch returns (`agents-page.tsx`, keyed on the fetched content).
 *
 * `pending`, the answer sentences and the roll-ups live in `hub-action-store.ts`
 * and not in this hook, so the sidebar and the detail pane are one instance in
 * effect: a press in either marks the item busy in both (agent review round 1,
 * R6). They are keyed rather than held on a `useMutation` because that tracks
 * only its LATEST call, and many rows can be pressed while another is still
 * merging (a merge is an LLM call).
 *
 * EVERY PRESS ENDS IN A SENTENCE OR A VISIBLE CHANGE (UX round 1, U2): a report
 * that is not a plain success leaves one sentence beside the control
 * (`hubReportNote`), a thrown failure leaves its own, and a success clears
 * whatever an earlier failure left (R7).
 *
 * A fresh request id per CLICK, generated per call: it is what the server's
 * receipts key a replay on, so one press the transport retries is answered once,
 * while a second deliberate press is a second request.
 *
 * A GIVE-UP IS NOT A FAILURE HERE. These calls run on budgets above the
 * backend's (`HUB_WRITE_DEADLINE_MS`), so a deadline that still fires means the
 * daemon is still working; the mark is re-read rather than claiming the update
 * failed, and the sentence says it may still finish.
 */
export type HubApplyOptions = {
	prefer?: "local" | "remote";
	/** The person has confirmed that nothing records what they changed (A2.3). */
	acknowledgeUnknownBaseline?: boolean;
	/** Preview only: nothing is written, and no answer sentence is left behind. */
	dryRun?: boolean;
};

const STILL_WORKING =
	"This is taking longer than expected. It may still finish; the mark will update.";

export function useHubActions() {
	const queryClient = useQueryClient();
	const pending = useHubActionStore((state) => state.pending);
	const notes = useHubActionStore((state) => state.notes);
	const rollups = useHubActionStore((state) => state.rollups);
	const store = useHubActionStore;

	const settle = (response: HubMutationResponse) => {
		if (response.status)
			queryClient.setQueryData(hubUpdatesKey, response.status);
		void queryClient.invalidateQueries({ queryKey: hubUpdatesKey });
		if (response.reports?.some((report) => report.applied)) {
			for (const key of ["profiles", "profile", "teams", "team"]) {
				void queryClient.invalidateQueries({ queryKey: ["desktop", key] });
			}
		}
	};

	/*
	 * `key` is `<kind>:<name>` for an item, `all:<kind>` for a section's update-all
	 * and `check` for the check-now control, so a section-level press and a
	 * row-level press never share a slot.
	 */
	const track = async (
		key: string,
		run: () => Promise<HubMutationResponse>,
		fallback: string,
	): Promise<HubMutationResponse | null> => {
		store.getState().begin(key);
		try {
			const response = await run();
			settle(response);
			return response;
		} catch (error) {
			if (isDeadlineExceeded(error))
				void queryClient.invalidateQueries({ queryKey: hubUpdatesKey });
			store.getState().setNote(key, {
				message: isDeadlineExceeded(error)
					? STILL_WORKING
					: userFacingMessage(error, fallback),
				tone: "error",
			});
			return null;
		} finally {
			store.getState().end(key);
		}
	};

	/** One item's answer, as a sentence beside its control (or nothing, when the mark's change says it). */
	const noteFor = (
		key: string,
		reports: readonly HubMergeReport[] | undefined,
		match: (report: HubMergeReport) => boolean,
		prefer?: "local" | "remote",
	) => {
		const report = reports?.find(match);
		store
			.getState()
			.setNote(key, report ? hubReportNote(report, prefer) : null);
	};

	return {
		pending,
		/** The sentence a press left beside its control, keyed like `pending`. */
		notes,
		rollups,
		/** Update one item. Resolves the reports so the caller can route a `needs-review`. */
		applyItem: async (
			kind: HubItemKind,
			name: string,
			options: HubApplyOptions = {},
		): Promise<HubMergeReport[] | null> => {
			const key = hubItemKey(kind, name);
			const response = await track(
				key,
				() =>
					desktopResult<HubMutationResponse>({
						op: "hub.apply",
						requestId: crypto.randomUUID(),
						kind,
						name,
						...(options.prefer ? { prefer: options.prefer } : {}),
						...(options.acknowledgeUnknownBaseline
							? { acknowledgeUnknownBaseline: true }
							: {}),
						...(options.dryRun ? { dryRun: true } : {}),
					}),
				`Couldn't update ${name} from the hub. Try again.`,
			);
			// A preview is read by its caller; leaving a sentence for it would be
			// an answer to a press the person did not make.
			if (response && !options.dryRun)
				noteFor(
					key,
					response.reports,
					(report) => report.kind === kind && report.name === name,
					options.prefer,
				);
			return response?.reports ?? null;
		},
		retryItem: async (kind: HubItemKind, name: string) => {
			const key = hubItemKey(kind, name);
			const response = await track(
				key,
				() =>
					desktopResult<HubMutationResponse>({
						op: "hub.retry",
						requestId: crypto.randomUUID(),
						kind,
						name,
					}),
				`Couldn't retry ${name}. Try again.`,
			);
			if (response)
				noteFor(
					key,
					response.reports,
					(report) => report.kind === kind && report.name === name,
				);
			return response?.reports ?? null;
		},
		/** Ask the hub now (the daemon's own tick is hourly). Applies nothing. */
		checkNow: async () => {
			const response = await track(
				"check",
				() =>
					desktopResult<HubMutationResponse>({
						op: "hub.check",
						requestId: crypto.randomUUID(),
					}),
				"Couldn't check the hub. Try again.",
			);
			if (response)
				store.getState().setNote("check", {
					message: hubCheckSentence(response.status),
					tone: "info",
				});
		},
		applyAll: async (kind: HubItemKind) => {
			const key = `all:${kind}`;
			const response = await track(
				key,
				() =>
					desktopResult<HubMutationResponse>({
						op: "hub.applyAll",
						requestId: crypto.randomUUID(),
						kind,
					}),
				"Couldn't update from the hub. Try again.",
			);
			if (response)
				store.getState().setRollup(kind, hubRollup(response.reports ?? []));
			return response?.reports ?? null;
		},
		clearRollup: (kind: HubItemKind) => store.getState().setRollup(kind, null),
		clearNote: (key: string) => store.getState().setNote(key, null),
	};
}
