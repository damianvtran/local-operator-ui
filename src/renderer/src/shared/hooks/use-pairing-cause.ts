import { useEffect, useState } from "react";
import type { DaemonPairingCause } from "../../../../shared/backend-status";

/**
 * Main's pairing cause, as the renderer sees it: one bridge read, shared.
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
export function usePairingCause(): DaemonPairingCause | null {
	const [cause, setCause] = useState<DaemonPairingCause | null>(null);
	useEffect(() => {
		const backend = window.api?.backend;
		if (!backend?.getStatus) return;
		let live = true;
		const read = async () => {
			try {
				const status = await backend.getStatus();
				if (!live) return;
				/*
				 * `pairing` on the snapshot, with the nested shape accepted too: the
				 * connectivity hook carries the snapshot inside its own object, and a
				 * reader that assumed the wrong one silently reported "no cause" while
				 * main was publishing one (the round-5 Q-6 reading).
				 */
				const pairing = status?.pairing;
				setCause(
					pairing && !pairing.available ? (pairing.cause ?? "unpaired") : null,
				);
			} catch {
				// A status read that fails says nothing about pairing, and a surface may
				// not invent a cause it was not given.
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
