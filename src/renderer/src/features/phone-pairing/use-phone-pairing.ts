/**
 * The reads and writes behind the pairing popup and Settings → Paired phones
 * (`features.phone_pairing`, local-operator #3949; `features.operator_setup`,
 * #3950). Every hook here is capability-gated by its caller: with the key absent
 * nothing is read, so an older backend sees exactly today's traffic.
 *
 * WHY THE POPUP READS THE APPROVALS LIST AND NOT ITS OWN ROUTE: core has no
 * pairing-only read. The card lives on the ordinary `GET /v1/desktop/approvals`
 * row (`pairing` block), and the feed only says WHICH approval is the live pairing
 * (`approvals.pair_request`, and `open.approvals_pair_request` for a window that
 * connects mid-request). So the feed is the trigger and the list is the content:
 * a frame naming a new id (or null) refetches, and the list decides what shows.
 *
 * THE POPUP'S QUERY KEY IS ITS OWN, not the Mesh tray's: the tray's entry is
 * gated on mesh membership and polls on its own cadence, while a pairing request
 * must surface on ANY route for a computer that is in no mesh at all.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	type UseQueryResult,
	useMutation,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { useEffect, useState } from "react";
import type { DesktopFeedFrame } from "../../../../shared/desktop-session-contract";
import {
	type PairedPhone,
	type PairingCard,
	pairedPhones,
	pairingCards,
} from "./pairing-model";

export const phonePairingKeys = {
	approvals: ["desktop", "phone-pairing", "approvals"] as const,
	devices: ["desktop", "phone-pairing", "devices"] as const,
	operatorSetup: ["desktop", "phone-pairing", "operator-setup"] as const,
};

/*
 * While the person's own decision is in flight (Touch ID, then the admin prompt
 * that admits the phone), the card re-reads the list on this cadence so it can
 * say "Your computer is asking for its password" when core records the admit
 * step. A UI cadence only, active only during that wait; the feed and window
 * focus drive every other refresh.
 */
const DECISION_IN_FLIGHT_REFRESH_MS = 2_000;

/**
 * The live pairing id the feed last named. `undefined` until a frame says
 * anything (an older feed never does), `null` when it says "none".
 */
export function useFeedPairRequest(
	enabled: boolean,
): string | null | undefined {
	const client = useQueryClient();
	const [pairRequest, setPairRequest] = useState<string | null | undefined>(
		undefined,
	);
	useEffect(() => {
		const feed = globalThis.window?.api?.desktop?.feed;
		if (!enabled || !feed) return;
		return feed.subscribe((frame: DesktopFeedFrame) => {
			let named: string | null | undefined;
			if (frame.type === "open") named = frame.payload.approvals_pair_request;
			else if (frame.type === "approvals") named = frame.payload.pair_request;
			// An older core's frames omit the key: nothing to learn, nothing to refetch.
			if (named === undefined) return;
			setPairRequest(named);
			void client.invalidateQueries({ queryKey: phonePairingKeys.approvals });
		});
	}, [enabled, client]);
	return pairRequest;
}

/** The pairing cards on this computer, refetched on focus and on feed frames. */
export function usePairingCards(
	enabled: boolean,
	decisionInFlight: boolean,
): UseQueryResult<PairingCard[]> {
	return useQuery({
		queryKey: phonePairingKeys.approvals,
		enabled,
		queryFn: async () =>
			pairingCards(await desktopResult<unknown>({ op: "approvals.list" })),
		retry: false,
		staleTime: 5_000,
		// Spec §4.2: re-shown after a restart or a missed frame on window focus.
		refetchOnWindowFocus: true,
		refetchInterval:
			enabled && decisionInFlight ? DECISION_IN_FLIGHT_REFRESH_MS : false,
	});
}

/**
 * The person's decision, in core's two steps: `pair-ack` (the typed code, or the
 * confirm-mode "Codes match" press with no code), then `approve-operation` with
 * `operation: "pair_phone"`, which signs and admits. Splitting them is core's
 * design: a wrong code is a strike, never a spent Touch ID gesture.
 *
 * NEVER RETRIED AUTOMATICALLY: a replayed pair-ack with a wrong code is a second
 * strike, and a replayed approve is a second OS prompt.
 */
export function usePairingApprove() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async ({
			card,
			code,
			retryApply = false,
		}: {
			card: PairingCard;
			code?: string;
			/**
			 * `failed_retryable`: the signature landed but the admit prompt was
			 * cancelled. The retry is `apply-operation`, which never signs again.
			 */
			retryApply?: boolean;
		}) => {
			const digests = {
				approvalId: card.approvalId,
				requestDigest: card.requestDigest,
				disclosureDigest: card.disclosureDigest,
			};
			if (!retryApply) {
				await desktopResult<unknown>({
					op: "approvals.pairAck",
					...digests,
					...(code !== undefined ? { code } : {}),
				});
			}
			return desktopResult<unknown>({
				op: retryApply
					? "approvals.applyOperation"
					: "approvals.approveOperation",
				operation: "pair_phone",
				...digests,
			});
		},
		onSettled: () =>
			client.invalidateQueries({ queryKey: phonePairingKeys.approvals }),
	});
}

export function usePairingDeny() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: (approvalId: string) =>
			desktopResult<unknown>({ op: "approvals.deny", approvalId }),
		onSettled: () =>
			client.invalidateQueries({ queryKey: phonePairingKeys.approvals }),
	});
}

export function usePairedPhones(
	enabled: boolean,
): UseQueryResult<PairedPhone[]> {
	return useQuery({
		queryKey: phonePairingKeys.devices,
		enabled,
		queryFn: async () =>
			pairedPhones(await desktopResult<unknown>({ op: "devices.list" })),
		retry: false,
		refetchOnWindowFocus: true,
	});
}

/** Core's `revoke` answer, narrowed to what the row needs to say. */
export type RemovePhoneResult = { state: string };

export function useRemovePhone() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async (deviceId: string): Promise<RemovePhoneResult> => {
			const result = await desktopResult<{ state?: unknown }>({
				op: "devices.remove",
				deviceId,
			});
			return {
				state: typeof result?.state === "string" ? result.state : "",
			};
		},
		onSettled: () =>
			client.invalidateQueries({ queryKey: phonePairingKeys.devices }),
	});
}

/** `GET /v1/desktop/operator/setup`, narrowed (`authority_setup.describe_state`). */
export type OperatorSetupState = {
	state: "on" | "off" | "finish_setup";
	canPrompt: boolean;
	inProgress: boolean;
	/** Core's own sentence for why it cannot prompt here, when it cannot. */
	message: string | null;
	/** Core's file-only notice (U18), when this host's approvals are not presence-gated. */
	fileOnlyNotice: string | null;
};

function envelopeText(value: unknown): string | null {
	if (value && typeof value === "object" && "text" in value) {
		const text = (value as { text?: unknown }).text;
		return typeof text === "string" && text ? text : null;
	}
	return null;
}

export function operatorSetupState(result: unknown): OperatorSetupState | null {
	if (!result || typeof result !== "object") return null;
	const row = result as Record<string, unknown>;
	const state = row.state;
	if (state !== "on" && state !== "off" && state !== "finish_setup")
		return null;
	return {
		state,
		canPrompt: row.can_prompt === true,
		inProgress: row.in_progress === true,
		message: row.blocked ? envelopeText(row.message) : null,
		fileOnlyNotice: envelopeText(row.file_only_notice),
	};
}

export function useOperatorSetup(enabled: boolean) {
	return useQuery({
		queryKey: phonePairingKeys.operatorSetup,
		enabled,
		queryFn: async () =>
			operatorSetupState(
				await desktopResult<unknown>({ op: "operator.setup.read" }),
			),
		retry: false,
		refetchOnWindowFocus: true,
	});
}

export function useOperatorSetupRun() {
	const client = useQueryClient();
	return useMutation({
		retry: false,
		mutationFn: async () => {
			const result = await desktopResult<unknown>({ op: "operator.setup.run" });
			// The outcome's sentence is core's, already in the person's language
			// (the `wire.operator_setup` namespace is rendered server-side).
			return envelopeText(
				result && typeof result === "object"
					? (result as { message?: unknown }).message
					: null,
			);
		},
		onSettled: () => {
			void client.invalidateQueries({
				queryKey: phonePairingKeys.operatorSetup,
			});
			void client.invalidateQueries({ queryKey: phonePairingKeys.approvals });
		},
	});
}
