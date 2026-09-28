/**
 * One sweep of the held sends at launch — `draft-resolution.ts` carries what the
 * sweep does and why the app owns it rather than the panes.
 *
 * WHY ONCE PER PROCESS, at mount: the claims it exists for are the ones the
 * reader has moved on from, and the moment the app can settle them without
 * racing the pane that owns a fresh send is the launch itself. A `useRef` alone
 * would run twice under StrictMode's double-mount, so the latch is
 * module-level; the sweep itself also coalesces, and the store's resolution is
 * idempotent, so even a hot reload that re-runs it is harmless.
 */
import { useEffect } from "react";

import { resolveHeldSendsFromServer } from "../draft-resolution";

let swept = false;

export function useHeldDraftResolution(): void {
	useEffect(() => {
		if (swept) return;
		swept = true;
		void resolveHeldSendsFromServer();
	}, []);
}
