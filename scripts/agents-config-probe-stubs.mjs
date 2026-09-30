/*
 * The four boundaries `agents-config-probe-cadence.test.mjs` replaces, in one
 * file so the test adds two files to `scripts/` rather than six.
 *
 * WHAT IS FAKED, AND WHY EACH ONE IS A BOUNDARY RATHER THAN PART OF THE SUBJECT:
 * the transcript source (the delta schedule IS the test's input), the capability
 * read (a fixed answer), the query client (one stable object — a fresh one per
 * render would move `settleRun`'s identity and re-arm the probe for a reason
 * that is not the code under test), and the watch lease / toast / interrupt
 * (side surfaces with no part in the probe's cadence).
 */
import { useEffect, useState } from "react";

let stream = {
	transcript: { records: [] },
	failure: null,
	frontend: { streaming: true },
	turnsCompleted: 0,
	subscriptionId: "sub-1",
};
const listeners = new Set();

export function useCanonicalSessionStream() {
	const [, force] = useState(0);
	useEffect(() => {
		const listener = () => force((n) => n + 1);
		listeners.add(listener);
		return () => listeners.delete(listener);
	}, []);
	return stream;
}

/** One transcript delta, as a flush would deliver it. */
export function pushTranscriptDelta(text) {
	stream = {
		...stream,
		transcript: {
			records: [
				...stream.transcript.records,
				{ kind: "assistant", phase: "end", ts: Date.now(), text },
			],
		},
	};
	for (const listener of listeners) listener();
}

export function desktopFeatureEnabled() {
	return true;
}

export function useDesktopCapabilities() {
	return {
		data: {
			features: [
				"agents_config",
				"profile_catalogue",
				"team_catalogue",
				"session_interrupt",
			],
		},
		isLoading: false,
		error: null,
	};
}

export function invalidateAuthoring() {}

export function useDesktopWatchLease() {}

export function showSuccessToast() {}

export function showErrorToast() {}

export async function interruptTurn() {}

const queryClient = {
	getQueryData: () => undefined,
	invalidateQueries: () => undefined,
	setQueryData: () => undefined,
};

export function useQueryClient() {
	return queryClient;
}
