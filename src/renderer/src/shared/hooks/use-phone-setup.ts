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
 *   the state right now, and what does activation cost". It runs once on every
 *   OPEN (the cache entry is dropped with its last observer, so a re-opened pane
 *   never shows a price or a Connected from an earlier open) and again on an
 *   explicit "Check again", never on a timer.
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
 * ## A run whose answer never arrives is UNCONFIRMED, not failed
 *
 * The run POST sends no bytes until the backend finishes, which can be minutes. The
 * main-process fetch has only an overall abort timer, and undici's default
 * response-header timeout (300 s, measured on Node 26 for the review of this
 * change; NOT measured on Electron's bundled Node) can end the request before the
 * client's own 930 s budget does. So a transport failure (`status: null`, 503
 * `transport.failed`) or the client's own `deadline_exceeded` on the run says
 * nothing about the install, which the backend keeps running and drains. The hook
 * therefore treats it as "unconfirmed": it never reports failure, never sends a
 * second run (the backend single-flights, and the press guard stays), and polls the
 * local read until the backend says no run is live, then asks for a fresh plan,
 * which is what tells the person whether it ended connected.
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
	DESKTOP_DEADLINE_EXCEEDED_CODE,
	DESKTOP_REFUSAL_CODE,
	PHONE_SETUP_REFUSAL_CODES,
	type PhoneSetupResult,
	phoneSetupResultSchema,
} from "../../../../shared/desktop-contract";

/** How often the local read is repeated while a run is in progress or unconfirmed. */
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
	/**
	 * `setup` is true when THIS window pressed the run (or the backend has already
	 * reported steps). The backend's `in_progress` is also true while another window
	 * only PLANS, and calling that "Setting up" would overclaim.
	 */
	| {
			kind: "applying";
			progress: string[];
			setup: boolean;
			account?: PhoneSetupResult;
	  }
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
): PhoneSetupFailure | "in-progress" | "unconfirmed" {
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
		// The request ended without the backend's answer: the OUTCOME is unknown, and
		// the backend may still be working (see the header). Only the run is affected;
		// a read-only check that did not answer is simply a failed check.
		if (
			during === "run" &&
			(error.status === null ||
				code === DESKTOP_REFUSAL_CODE.transportFailed ||
				code === DESKTOP_DEADLINE_EXCEEDED_CODE)
		) {
			return "unconfirmed";
		}
	}
	return { kind: "generic", during };
}

type DeriveInput = {
	enabled: boolean;
	local: PhoneSetupResult | undefined;
	fresh: PhoneSetupResult | undefined;
	failure: PhoneSetupFailure | null;
	/** This window's run is in flight or its outcome is still unconfirmed. */
	runPending: boolean;
	/**
	 * The plan answered 409 (another owner held the slot), no read says a run is
	 * live, and nothing else explains the empty view: without this the block would
	 * sit on "Checking" with no control.
	 */
	freshErrored?: boolean;
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
		const progress = input.local?.progress ?? [];
		// The first line is the fixed "checking" line a plan also writes; a run's
		// later steps are what distinguish it from a mere check by another window.
		return {
			kind: "applying",
			progress,
			setup: input.runPending || progress.length > 1,
			// Never show another window's cached choice as this run's owner.
			account:
				input.fresh &&
				(input.runPending ||
					input.local?.active_credential_id === input.fresh.credential_id)
					? input.fresh
					: undefined,
		};
	}
	if (input.failure) return { kind: "failure", failure: input.failure };
	if (input.fresh) return { kind: "result", result: input.fresh };
	if (input.freshErrored) {
		return { kind: "failure", failure: { kind: "generic", during: "check" } };
	}
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
	// A run whose answer never arrived (see the header). `since` is when we learned
	// that, so only a local read taken AFTER it can say the run has ended.
	const [unconfirmed, setUnconfirmed] = useState(false);
	const unconfirmedSince = useRef(0);

	const runBusy = useRef(false);
	// Whether the local read has seen a live run, and whether the run that just
	// ended was OURS (its answer, with receipts, is already in the cache; re-planning
	// would replace it with a plan that has none).
	const wasRunning = useRef(false);
	const ownRunEnded = useRef(false);
	// Declared before the local read because that read's poll cadence depends on
	// whether THIS window's run is in flight: the backend's progress lines are only
	// ever visible if we ask for them while the run is still pending.
	const run = useMutation({
		// Production mutations otherwise inherit retry:1. A lost billing/install
		// answer is ambiguous, NOT permission to replay the write: reconcile GET
		// state instead. runBusy guards gestures, not React Query's internal retries.
		retry: false,
		mutationFn: async (args: { credentialId: number; price?: string }) =>
			parse(
				await desktopResult<unknown>({
					op: "tunnel.setup.run",
					credentialId: args.credentialId,
					acceptMonthlyPrice: args.price,
				}),
			),
		onSuccess: (result) => {
			// Only meaningful if the poll saw the run live: then the coming
			// live -> idle transition is this run's own. If it never did, no
			// transition is coming and the flag must not outlive this answer.
			ownRunEnded.current = wasRunning.current;
			setFailure(null);
			queryClient.setQueryData(phoneSetupKeys.fresh(selectedId), result);
		},
		onError: (error) => {
			const classified = classifyPhoneSetupError(error, "run");
			if (classified === "unconfirmed") {
				// Never a failure and never a second run: the backend may still be
				// installing. The local read poll below decides when it is over.
				unconfirmedSince.current = Date.now();
				setUnconfirmed(true);
			} else if (classified !== "in-progress") {
				setFailure(classified);
			}
		},
		onSettled: (_data, error) => {
			// Stay busy while the outcome is unconfirmed, so a second press cannot
			// start an owner beside one the backend may still be running.
			runBusy.current =
				error !== null &&
				classifyPhoneSetupError(error, "run") === "unconfirmed";
			void queryClient.invalidateQueries({
				queryKey: phoneSetupKeys.local(selectedId),
			});
		},
	});
	const runActive = run.isPending || unconfirmed;

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
		// Poll while the backend says a run is live OR this window's run is pending
		// or unconfirmed (the first read after a press still says "idle", so keying
		// on the cached answer alone would never show progress for our own run);
		// otherwise the read is one-shot, so a closed pane costs nothing.
		refetchInterval: (query) =>
			runActive || query.state.data?.in_progress ? PHONE_SETUP_POLL_MS : false,
	});

	const localData = local.data;
	const inProgress = localData?.in_progress === true || runActive;

	// The fresh, read-only plan: once on every open (after the local read has
	// settled and said no run is live), and on an explicit refetch. A key per
	// selected account so choosing one asks about THAT account.
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
		// Dropped with its LAST observer, and ALSO re-asked on every mount below:
		// `gcTime: 0` alone removes the entry on a later macrotask, so a pane that
		// re-opens immediately (a panel switch) would re-attach to the stale entry.
		gcTime: 0,
		refetchOnWindowFocus: false,
		refetchOnMount: "always",
	});
	// What is SHOWN must be a plan fetched since THIS open, or the answer to our
	// own run: a price or a Connected from an earlier open is an observation nobody
	// made now. The backend rechecks the quote on run regardless, so this protects
	// the label, not the money. `dataUpdatedAt` is also set by our own run's
	// `setQueryData`, so the run's receipts still count.
	const openedAt = useRef(Date.now());
	const freshData =
		fresh.data && fresh.dataUpdatedAt >= openedAt.current
			? fresh.data
			: undefined;

	// A run the BACKEND reported live that no longer is (another window finished
	// it, or the terminal did): ask again, because the answer on screen predates
	// it. NOT for our own run: it already returned its result (with receipts) into
	// the cache, and re-planning would replace that with a plan that has none. The
	// poll that now runs during our own run makes this transition visible to us, so
	// `ownRunEnded` is what tells the two apart.
	const backendRunning = localData?.in_progress === true;
	useEffect(() => {
		if (wasRunning.current && !backendRunning) {
			// `runBusy` covers the interleaving where the poll sees the run END before
			// our own POST answer arrives (this window still owns it); `ownRunEnded`
			// covers the answer having arrived first. An unconfirmed run keeps
			// `runBusy` set and is reset by its own effect below.
			if (ownRunEnded.current) ownRunEnded.current = false;
			else if (!runBusy.current) void fresh.refetch();
		}
		wasRunning.current = backendRunning;
	}, [backendRunning, fresh.refetch]);

	// An unconfirmed run ends when a read taken after the failure says no run is
	// live. The plan on screen predates the run, so it is RESET (not merely
	// refetched, which would keep showing the old quote) and asked again: that
	// answer is what says whether setup ended connected.
	useEffect(() => {
		if (
			unconfirmed &&
			localData &&
			!localData.in_progress &&
			local.dataUpdatedAt > unconfirmedSince.current
		) {
			setUnconfirmed(false);
			runBusy.current = false;
			void queryClient.resetQueries({
				queryKey: phoneSetupKeys.fresh(selectedId),
			});
		}
	}, [unconfirmed, localData, local.dataUpdatedAt, queryClient, selectedId]);

	// Surface check failures (the local read's and the plan's) through one place.
	useEffect(() => {
		const error = local.error ?? fresh.error;
		if (!error) return;
		const classified = classifyPhoneSetupError(error, "check");
		if (classified !== "in-progress" && classified !== "unconfirmed") {
			setFailure(classified);
		}
	}, [local.error, fresh.error]);

	const view = derivePhoneSetupView({
		enabled,
		local: localData,
		fresh: freshData,
		failure,
		runPending: runActive,
		freshErrored: fresh.isError && !freshData,
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
			ownRunEnded.current = false;
			setFailure(null);
			run.mutate({ credentialId, price });
		},
		[run.mutate],
	);

	return { view, selectedId, choose, check, run: start };
}
