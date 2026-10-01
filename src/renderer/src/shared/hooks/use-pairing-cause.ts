import { useEffect, useState } from "react";
import type { DaemonPairingCause } from "../../../../shared/backend-status";

/**
 * Main's pairing cause, as the renderer sees it: one bridge read, shared.
 *
 * THREE ANSWERS, NOT TWO (`DaemonPairingCause | null | undefined`), because a
 * consumer's decisions differ on all three: a cause = "refused, do not ask";
 * `null` = "paired and serving, the read may run"; `undefined` = "no answer
 * YET". The third state is what QA round 2's Q-3 needed: the old two-state
 * shape made "not answered yet" and "known good" the same value, so a fresh
 * mount fired a refused `skills.list` before the probe had answered (measured:
 * six a run, four at boot and two in a forced-remount window). Consumers that
 * own a sentence for the cause normalize with `?? null` — "no answer" and "no
 * cause" read the same on THEIR surfaces — while a consumer that fires work
 * on the strength of the answer (the skill picker's vocabulary read) fails
 * CLOSED on `undefined`. A host with no `getStatus` bridge at all answers
 * `null`: the question does not exist there, which is the same fact.
 *
 * WHY THIS EXISTS AND WHY IT IS NOT `useServerHealth()` (measured, review rounds 3-5):
 * every surface that had to word a pairing cause either reached for the connectivity
 * hook - whose module chain imports `shared/config/app-config.ts`, which reads
 * `import.meta.env` at module scope, undefined under esbuild, so a harness bundling
 * the app's modules dies at MODULE LOAD before a single render - or grew its own
 * copy of the predicate. One read, one place, no config dependency.
 *
 * The push (`onStatusChange`) is subscribed as well as the pull (`getStatus`): the
 * cause changes when the daemon under the app is replaced, which is exactly when a
 * single pull would leave a card stale.
 */
export function usePairingCause(): DaemonPairingCause | null | undefined {
	const [cause, setCause] = useState<DaemonPairingCause | null | undefined>(
		undefined,
	);
	useEffect(() => {
		const backend = window.api?.backend;
		if (!backend?.getStatus) {
			/*
			 * No pairing system to consult (a host predating the bridge): the
			 * question does not exist, which is the same fact a resolved `null`
			 * states — WITHOUT this the surface would wait forever for an answer
			 * nobody can give.
			 */
			setCause(null);
			return;
		}
		let live = true;
		const read = async () => {
			try {
				const status = await backend.getStatus();
				if (!live) return;
				/*
				 * `pairing` is a field of the snapshot itself: `getStatus()` is typed
				 * `Promise<DaemonStatusSnapshot>`, and it is the CONNECTIVITY hook that
				 * wraps the snapshot inside an object of its own - which is why a reader
				 * looking for a nested shape finds nothing (review round 5, R5-4: this
				 * comment used to claim both shapes were accepted while the code read
				 * one).
				 */
				const pairing = status?.pairing;
				setCause(
					pairing && !pairing.available ? (pairing.cause ?? "unpaired") : null,
				);
			} catch {
				/*
				 * A status read that fails says nothing about pairing, and a surface may
				 * not invent a cause it was not given. It also leaves the cause UNKNOWN
				 * (`undefined` — the state is only ever replaced by a real answer),
				 * because consumers now fail closed there: firing work against a daemon
				 * whose state is unknown is the Q-3 bug. The push channel re-reads, so a
				 * later answer resolves it.
				 */
			}
		};
		void read();
		const off = backend.onStatusChange?.(() => void read());
		return () => {
			live = false;
			off?.();
		};
	}, []);
	return cause;
}
