/**
 * Evidence harness: the shipped `/usage` dialog against a real provider report.
 *
 * See `usage-real-evidence.html` for why this exists. The payload arrives on
 * `window.__USAGE_FIXTURE__`, injected by the capture script from a live
 * `GET /v1/desktop/usage` on the local backend — so the component under the
 * camera is the shipped one and the data under it is the backend's own.
 *
 * The identities in a real report are account emails and key fragments, so the
 * capture script redacts them before injection. Nothing else is touched: the
 * numbers, windows, tiers, units and staleness are exactly what the backend
 * sent, because those are what the frame is evidence about.
 */

import { UsageDialog } from "@features/chat/pickers/usage-view";
import type { UsagePayload } from "@features/chat/pickers/usage-view-model";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./usage-real-evidence.css";

declare global {
	interface Window {
		__USAGE_FIXTURE__?: { payload: UsagePayload; now: number };
	}
}

/*
 * Surface a mount failure to the capture script, which otherwise sees only an
 * empty body and can report nothing more useful than "did not render".
 */
window.addEventListener("error", (event) => {
	(window as unknown as { __HARNESS_ERROR__?: string }).__HARNESS_ERROR__ =
		String(event.error?.stack ?? event.message);
});

const injected = window.__USAGE_FIXTURE__;
if (!injected) {
	throw new Error(
		"No usage payload injected. This harness is driven by the capture script; see docs/evidence/chat-usage/README.md.",
	);
}

/*
 * `UsageDialog` takes its clock as a prop precisely so a capture can pin it.
 * The ages and countdowns in this frame are therefore measured from the
 * response's own server stamp rather than from whenever the shutter fired.
 */
createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<UsageDialog
			payload={injected.payload}
			now={injected.now}
			onClose={() => undefined}
			onFetchLive={() => undefined}
		/>
	</StrictMode>,
);
