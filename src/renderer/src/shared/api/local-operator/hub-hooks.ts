import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import { retryDesktopQuery } from "./backend-error";
import { desktopResult, userFacingMessage } from "./desktop-api";
import {
	type HubItemKind,
	type HubMergeReport,
	type HubMutationResponse,
	type HubUpdates,
	hubItemKey,
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
	return useQuery({
		queryKey: hubUpdatesKey,
		enabled,
		queryFn: () => desktopResult<HubUpdates>({ op: "hub.updates" }),
		staleTime: 30_000,
		retry: retryDesktopQuery,
		refetchInterval: 60_000,
		refetchIntervalInBackground: false,
	});
}

/**
 * The four writes, plus the bookkeeping a list of rows needs around them.
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
 * one cheap refetch of a list that did change.
 *
 * WHY `pending` AND `failures` LIVE HERE AND NOT ON THE MUTATION OBJECTS. A
 * `useMutation` tracks only its LATEST call, and this surface has many rows that
 * can each be pressed while another is still merging (a merge is an LLM call and
 * takes seconds). One mutation object per verb would drop the first row's
 * spinner the moment the second was pressed; a keyed set keeps every in-flight
 * row marked. `failures` is keyed the same way so the owning surface can render
 * the sentence beside the control that failed - the hub's one error language
 * (no toast) - and it is cleared by the next press on that item.
 *
 * A fresh request id per CLICK, generated inside `mutationFn`: it is what the
 * server's receipts key a replay on, so one press the transport retries is
 * answered once, while a second deliberate press is a second request.
 */
export function useHubActions() {
	const queryClient = useQueryClient();
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
	const applyMutation = useMutation({
		mutationFn: (variables: {
			kind: HubItemKind;
			name: string;
			prefer?: "local" | "remote";
		}) =>
			desktopResult<HubMutationResponse>({
				op: "hub.apply",
				requestId: crypto.randomUUID(),
				...variables,
			}),
		onSuccess: settle,
	});
	const applyAllMutation = useMutation({
		mutationFn: (variables: { kind?: HubItemKind }) =>
			desktopResult<HubMutationResponse>({
				op: "hub.applyAll",
				requestId: crypto.randomUUID(),
				...variables,
			}),
		onSuccess: settle,
	});
	const retryMutation = useMutation({
		mutationFn: (variables: { kind: HubItemKind; name: string }) =>
			desktopResult<HubMutationResponse>({
				op: "hub.retry",
				requestId: crypto.randomUUID(),
				...variables,
			}),
		onSuccess: settle,
	});
	const checkMutation = useMutation({
		mutationFn: (variables: { kind?: HubItemKind; name?: string }) =>
			desktopResult<HubMutationResponse>({
				op: "hub.check",
				requestId: crypto.randomUUID(),
				...variables,
			}),
		onSuccess: settle,
	});

	const [pending, setPending] = useState<ReadonlySet<string>>(new Set());
	const [failures, setFailures] = useState<Readonly<Record<string, string>>>(
		{},
	);
	const [rollups, setRollups] = useState<
		Readonly<Partial<Record<HubItemKind, string>>>
	>({});
	const mounted = useRef(true);
	useEffect(() => {
		mounted.current = true;
		return () => {
			mounted.current = false;
		};
	}, []);

	/*
	 * `null` key = the whole section ("update all"), tracked as `all:<kind>` so a
	 * section-level press and a row-level press never share a slot.
	 */
	const track = useCallback(
		async <T extends HubMutationResponse>(
			key: string,
			run: () => Promise<T>,
			fallback: string,
		): Promise<T | null> => {
			setPending((previous) => new Set(previous).add(key));
			setFailures((previous) => {
				if (!(key in previous)) return previous;
				const { [key]: _cleared, ...rest } = previous;
				return rest;
			});
			try {
				return await run();
			} catch (error) {
				if (mounted.current)
					setFailures((previous) => ({
						...previous,
						[key]: userFacingMessage(error, fallback),
					}));
				return null;
			} finally {
				if (mounted.current)
					setPending((previous) => {
						const next = new Set(previous);
						next.delete(key);
						return next;
					});
			}
		},
		[],
	);

	return {
		pending,
		failures,
		rollups,
		/** Update one item. Resolves the reports so the caller can route a `needs-review`. */
		applyItem: (
			kind: HubItemKind,
			name: string,
			prefer?: "local" | "remote",
		): Promise<HubMergeReport[] | null> =>
			track(
				hubItemKey(kind, name),
				() => applyMutation.mutateAsync({ kind, name, prefer }),
				`Couldn't update ${name} from the hub. Try again.`,
			).then((response) => response?.reports ?? null),
		retryItem: (kind: HubItemKind, name: string) =>
			track(
				hubItemKey(kind, name),
				() => retryMutation.mutateAsync({ kind, name }),
				`Couldn't retry ${name}. Try again.`,
			).then((response) => response?.reports ?? null),
		checkItem: (kind: HubItemKind, name: string) =>
			track(
				hubItemKey(kind, name),
				() => checkMutation.mutateAsync({ kind, name }),
				`Couldn't check ${name} against the hub. Try again.`,
			),
		applyAll: async (kind: HubItemKind) => {
			const response = await track(
				`all:${kind}`,
				() => applyAllMutation.mutateAsync({ kind }),
				"Couldn't update from the hub. Try again.",
			);
			if (response && mounted.current)
				setRollups((previous) => ({
					...previous,
					[kind]: hubRollup(response.reports ?? []),
				}));
		},
		clearRollup: (kind: HubItemKind) =>
			setRollups((previous) => {
				if (!(kind in previous)) return previous;
				const { [kind]: _cleared, ...rest } = previous;
				return rest;
			}),
	};
}
