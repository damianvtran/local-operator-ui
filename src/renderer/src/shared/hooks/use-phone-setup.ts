/**
 * @file use-phone-setup.ts
 * @description
 * Phone access setup, read from and driven through the backend's explicit setup
 * route (`features.tunnel_setup`; local-operator `docs/DESKTOP_API.md`, "Explicit
 * phone setup"). The renderer owns NO setup logic: it reads state, asks for a
 * fresh read-only plan, and - only on an explicit press - sends a run.
 *
 * ## Where each fact comes from
 *
 * - `tunnel.setup.read` (GET, local only) paints first and is the ONLY source of
 *   "a setup is running": `in_progress` / `progress` / `active_credential_id`.
 *   It can never say `verified` or carry a quote, by the backend's contract.
 * - `tunnel.setup.plan` (POST, fresh, changes nothing) is the question "what is
 *   the state right now, and what does activation cost". It runs once on open
 *   and again on an explicit "Check again", never on a timer.
 * - `tunnel.setup.run` (POST) is the one write, and it is only reachable from a
 *   button the user pressed, with the owner and exact fresh price in hand.
 *
 * ## No local-only "applying" flag
 *
 * A window can close mid-install and reopen to the same backend. "Applying" is
 * therefore read off the backend (`in_progress`), not off a React state that dies
 * with the window. The only local fact is `run.isPending`, which merely covers the
 * gap before the first read after a press lands; once the backend reports the
 * run, that is what the view follows. A 409 `setup_in_progress` (another window or
 * the terminal owns the run) is the same state, not an error.
 *
 * ## Two mounts, one answer
 *
 * The block is mounted in the Radient provider panel and in Settings -> Radient
 * account. Both read through the query cache, so there is one plan request and
 * one answer, not two POSTs that could disagree.
 *
 * ## What this hook will not do
 *
 * Parse a sentence to choose an action (it switches on `blocked_on` and
 * `remedy.kind`), execute `remedy.command` (a report for a human or agent, never
 * an instruction to this app), pick an account for the user, or treat anything but
 * `verified: true` as success.
 */

import {
	DesktopControlError,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	PHONE_SETUP_REFUSAL_CODES,
	type PhoneSetupResult,
	phoneSetupResultSchema,
} from "../../../../shared/desktop-contract";

/** How often the local read is repeated while a run is in progress. */
export const PHONE_SETUP_POLL_MS = 3000;

export const phoneSetupKeys = {
	all: ["desktop", "tunnel", "setup"] as const,
	local: (credentialId: number | null) =>
		["desktop", "tunnel", "setup", "local", credentialId] as const,
	fresh: (credentialId: number | null) =>
		["desktop", "tunnel", "setup", "fresh", credentialId] as const,
};

/**
 * What a failure shows. `backend` carries a sentence the backend declared for a
 * refusal code the block knows (verbatim); `generic` means "use the block's own
 * keyed sentence" - a 5xx, a body that was not JSON, an unreadable answer, or the
 * saved-intent refusal whose backend sentence names an internal file.
 */
export type PhoneSetupFailure =
	| { kind: "backend"; message: string; code: string }
	| { kind: "generic"; during: "check" | "run" };

export type PhoneSetupView =
	| { kind: "hidden" }
	| { kind: "checking" }
	| { kind: "applying"; progress: string[] }
	| { kind: "result"; result: PhoneSetupResult }
	| { kind: "failure"; failure: PhoneSetupFailure };

/**
 * Classify one thrown error.
 *
 * `setup_in_progress` is NOT a failure: it returns `"in-progress"` so the caller
 * re-reads the backend and the view becomes Applying from what it says.
 */
export function classifyPhoneSetupError(
	error: unknown,
	during: "check" | "run",
): PhoneSetupFailure | "in-progress" {
	if (error instanceof DesktopControlError) {
		const code = error.code;
		if (code === "setup_in_progress") return "in-progress";
		// The saved-intent refusal's own sentence names an internal file; the
		// block says it generically instead.
		if (
			code !== undefined &&
			code !== "setup_intent_corrupt" &&
			PHONE_SETUP_REFUSAL_CODES.has(code)
		) {
			return { kind: "backend", message: error.message, code };
		}
	}
	return { kind: "generic", during };
}

type DeriveInput = {
	enabled: boolean;
	local: PhoneSetupResult | undefined;
	fresh: PhoneSetupResult | undefined;
	failure: PhoneSetupFailure | null;
	runPending: boolean;
};

/**
 * The view, as a pure function of what the cache and the last press say.
 *
 * Order matters: a backend-reported run beats everything (including a stale fresh
 * answer from before the run began), and a failure beats a stale answer because
 * showing the last good plan under a failed check would claim a state nobody
 * confirmed.
 */
export function derivePhoneSetupView(input: DeriveInput): PhoneSetupView {
	if (!input.enabled) return { kind: "hidden" };
	if (input.runPending || input.local?.in_progress) {
		return { kind: "applying", progress: input.local?.progress ?? [] };
	}
	if (input.failure) return { kind: "failure", failure: input.failure };
	if (input.fresh) return { kind: "result", result: input.fresh };
	return { kind: "checking" };
}

export type UsePhoneSetup = {
	view: PhoneSetupView;
	/** The account the user chose among several, or null (the backend's pin). */
	selectedId: number | null;
	choose: (credentialId: number) => void;
	/** A fresh read-only check. Never mutates. */
	check: () => void;
	/**
	 * The one write. `price` is the exact fresh amount shown beside the button, or
	 * undefined when no activation is required.
	 */
	run: (credentialId: number, price?: string) => void;
};

const parse = (raw: unknown): PhoneSetupResult =>
	phoneSetupResultSchema.parse(raw);

export function usePhoneSetup(): UsePhoneSetup {
	const queryClient = useQueryClient();
	const capabilities = useDesktopCapabilities();
	// Absent key means no block AND no request: every query below is disabled.
	const enabled = desktopFeatureEnabled(capabilities.data, "tunnel_setup");
	const [selectedId, setSelectedId] = useState<number | null>(null);
	const [failure, setFailure] = useState<PhoneSetupFailure | null>(null);

	const local = useQuery({
		queryKey: phoneSetupKeys.local(selectedId),
		queryFn: async () =>
			parse(
				await desktopResult<unknown>({
					op: "tunnel.setup.read",
					credentialId: selectedId ?? undefined,
				}),
			),
		enabled,
		retry: false,
		staleTime: 0,
		refetchOnWindowFocus: false,
		// Poll only while the backend says a run is live; otherwise the read is
		// one-shot, so a closed pane costs nothing.
		refetchInterval: (query) =>
			query.state.data?.in_progress ? PHONE_SETUP_POLL_MS : false,
	});

	const runBusy = useRef(false);
	const run = useMutation({
		mutationFn: async (args: { credentialId: number; price?: string }) =>
			parse(
				await desktopResult<unknown>({
					op: "tunnel.setup.run",
					credentialId: args.credentialId,
					acceptMonthlyPrice: args.price,
				}),
			),
		onSuccess: (result) => {
			setFailure(null);
			queryClient.setQueryData(phoneSetupKeys.fresh(selectedId), result);
		},
		onError: (error) => {
			const classified = classifyPhoneSetupError(error, "run");
			if (classified !== "in-progress") setFailure(classified);
		},
		onSettled: () => {
			runBusy.current = false;
			void queryClient.invalidateQueries({
				queryKey: phoneSetupKeys.local(selectedId),
			});
		},
	});

	const localData = local.data;
	const inProgress = localData?.in_progress === true || run.isPending;

	// The fresh, read-only plan: once on open (after the local read has settled and
	// said no run is live), and on an explicit refetch. A key per selected account
	// so choosing one asks about THAT account.
	const fresh = useQuery({
		queryKey: phoneSetupKeys.fresh(selectedId),
		queryFn: async () => {
			try {
				return parse(
					await desktopResult<unknown>({
						op: "tunnel.setup.plan",
						credentialId: selectedId ?? undefined,
					}),
				);
			} catch (error) {
				const classified = classifyPhoneSetupError(error, "check");
				if (classified === "in-progress") {
					void queryClient.invalidateQueries({
						queryKey: phoneSetupKeys.local(selectedId),
					});
				}
				throw error;
			}
		},
		enabled: enabled && local.isSuccess && !inProgress,
		retry: false,
		staleTime: Number.POSITIVE_INFINITY,
		gcTime: 5 * 60_000,
		refetchOnWindowFocus: false,
		refetchOnMount: false,
	});

	// A run the BACKEND reported live that no longer is (another window finished
	// it, or the terminal did): ask again, because the answer on screen predates
	// it. Keyed on `in_progress` from the backend and NOT on this window's own
	// pending press: our own run already returned its result (with receipts) into
	// the cache, and re-planning here would replace that with a plan that has none.
	const backendRunning = localData?.in_progress === true;
	const wasRunning = useRef(false);
	useEffect(() => {
		if (wasRunning.current && !backendRunning) {
			void fresh.refetch();
		}
		wasRunning.current = backendRunning;
	}, [backendRunning, fresh.refetch]);

	// Surface check failures (the local read's and the plan's) through one place.
	useEffect(() => {
		const error = local.error ?? fresh.error;
		if (!error) return;
		const classified = classifyPhoneSetupError(error, "check");
		if (classified !== "in-progress") setFailure(classified);
	}, [local.error, fresh.error]);

	const view = derivePhoneSetupView({
		enabled,
		local: localData,
		fresh: fresh.data,
		failure,
		runPending: run.isPending,
	});

	const choose = useCallback((credentialId: number) => {
		setFailure(null);
		setSelectedId(credentialId);
	}, []);

	const check = useCallback(() => {
		setFailure(null);
		void local.refetch();
		void fresh.refetch();
	}, [local.refetch, fresh.refetch]);

	const start = useCallback(
		(credentialId: number, price?: string) => {
			// One press, one POST: the backend single-flights too, but a double
			// click must not even ask.
			if (runBusy.current) return;
			runBusy.current = true;
			setFailure(null);
			run.mutate({ credentialId, price });
		},
		[run.mutate],
	);

	return { view, selectedId, choose, check, run: start };
}
