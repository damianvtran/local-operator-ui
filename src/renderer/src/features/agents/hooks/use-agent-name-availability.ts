/**
 * @file use-agent-name-availability.ts
 * @description The live "is this name publishable?" check behind the publish dialog.
 *
 * A courtesy, not a gate (contract §6.3): the hub is authoritative and answers the
 * publication itself, and a name this check reported available can be taken by
 * the time the publication lands. Two consequences follow, and both are
 * implemented here rather than left to the caller.
 *
 * 1. **A failure is "no answer", not "unavailable".** The check needs the local
 *    backend, and it needs the hub to answer: when either does not, the dialog
 *    must not tell the author their name is taken, and must not block them. So an
 *    error maps to `unknown`, which renders nothing at all — the publication will
 *    give the real answer, with a code, in the dialog.
 * 2. **The check is asked as the user types, and it must be cheap.** The name is
 *    debounced, it is not asked at all below two characters, and it is not asked
 *    for a name this app already knows is not publishable — the hub answers that
 *    with a 422 about the name's own rules, which is a request spent to be told
 *    something the dialog already shows beside the field.
 */

import type { NameAvailability } from "@shared/api/local-operator/agents-api";
import { AgentsApi } from "@shared/api/local-operator/agents-api";
import { apiConfig } from "@shared/config";
import { useDebouncedValue } from "@shared/hooks/use-debounced-value";
import { useQuery } from "@tanstack/react-query";
import { isPublishableName } from "../../../../../shared/desktop-contract";

/** The debounce the contract asks for, in milliseconds. */
const AVAILABILITY_DEBOUNCE_MS = 400;

/** The shortest name worth asking about. */
const MIN_QUERY_CHARS = 2;

/**
 * What the dialog can say about a name, from the hub.
 *
 * `checking` is a state the dialog draws as a quiet line rather than as a
 * blocker: the submit button stays enabled throughout, because a pre-check slower
 * than the publish it guards is worse than no pre-check.
 */
export type NameAvailabilityState =
	| "idle"
	| "checking"
	| "available"
	| "taken"
	| "reserved"
	| "unknown";

export type NameAvailabilityResult = {
	state: NameAvailabilityState;
	/** The built-in whose name is reserved, when the hub named one. */
	builtinName: string | null;
};

/** Map the hub's answer onto the dialog's states. */
function availabilityState(
	answer: NameAvailability | undefined,
): NameAvailabilityResult {
	if (!answer) return { state: "unknown", builtinName: null };
	if (answer.available) return { state: "available", builtinName: null };
	const builtin = answer.details?.builtin_name ?? null;
	if (answer.code === "name_taken")
		return { state: "taken", builtinName: null };
	if (answer.code === "name_reserved_builtin")
		return { state: "reserved", builtinName: builtin };
	// A refusal this build does not know: say nothing rather than guess which of
	// the two it was, because the two have different recoveries.
	return { state: "unknown", builtinName: null };
}

export const useAgentNameAvailability = (
	name: string,
	enabled: boolean,
): NameAvailabilityResult => {
	// The name trimmed, because that is what the hub stores and folds; asking about
	// " coder " and checking "coder" are the same question.
	const trimmed = name.trim();
	const debounced = useDebouncedValue(trimmed, AVAILABILITY_DEBOUNCE_MS);
	const askable =
		enabled &&
		debounced === trimmed &&
		debounced.length >= MIN_QUERY_CHARS &&
		isPublishableName(debounced);

	const query = useQuery({
		queryKey: ["agent-name-availability", debounced],
		enabled: askable,
		queryFn: async () => {
			const response = await AgentsApi.getAgentNameAvailability(
				apiConfig.baseUrl,
				debounced,
			);
			return response.result;
		},
		// A courtesy check must not retry into an unreachable hub: the answer it
		// would eventually give is one the dialog already treats as "unknown".
		retry: false,
		staleTime: 15_000,
		refetchOnWindowFocus: false,
	});

	if (!askable || query.isPending)
		return { state: askable ? "checking" : "idle", builtinName: null };
	if (query.isError) return { state: "unknown", builtinName: null };
	return availabilityState(query.data);
};
