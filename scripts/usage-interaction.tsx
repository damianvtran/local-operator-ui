/**
 * Interaction harness for the shipped `/usage` container.
 *
 * See `usage-interaction.html` for why this exists. In short: the two majors
 * this view shipped with were behaviours over time — a key switch that blanked
 * the table, and an "ask again" that asked nothing — and a still cannot show
 * either. This mounts the real `UsageView` behind a fake desktop bridge with a
 * request log, so a driver can click the real button and read what actually
 * happened.
 *
 * The bridge is the ONLY thing faked. `desktopResult`, the query, the dialog,
 * the table and the picker chrome are all the shipped code, because a harness
 * that reimplemented any of them would be evidence about the harness.
 */

import { UsageView } from "@features/chat/pickers/usage-view";
import type { UsagePayload } from "@features/chat/pickers/usage-view-model";
import { defaultQueryOptions } from "@shared/api/query-client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "./usage-real-evidence.css";

/** How the next `usage.get` should behave. Set by the driver over CDP. */
type Mode = "answer" | "hang" | "fail";

declare global {
	interface Window {
		__USAGE_HARNESS__: {
			/** Every request the app actually sent, in order. */
			requests: { live?: boolean; refresh?: boolean; op: string }[];
			mode: Mode;
			/** Release a hung request with an answer. */
			release: () => void;
			/** Swap the payload the next answer carries. */
			payload: UsagePayload;
			/**
			 * How many times the dialog asked to close.
			 *
			 * Recorded rather than acted on: unmounting the dialog would end the run,
			 * and what needs checking is that Escape still REACHES `onClose` after the
			 * scroll body became a focusable region inside it.
			 */
			closes: number;
		};
	}
}

const NOW = Date.now();

/** One provider with one measurable window — enough to see a table or its loss. */
const makePayload = (source: string, usedFraction: number): UsagePayload => ({
	source,
	fetched_at: NOW,
	reports: [
		{
			provider: "anthropic",
			identity: "damian@example.com",
			fetched_at: NOW,
			notes: null,
			consecutive_failures: 0,
			usage_unavailable: false,
			next_probe_at_ms: null,
			credential_invalid: false,
			age_ms: 0,
			state: "available",
			limits: [
				{
					id: "five_hour",
					label: "5-hour",
					window: "five_hour",
					status: null,
					resets_at: null,
					resets_at_ms: NOW + 3_600_000,
					tier: "",
					shared: true,
					amount: {
						used: usedFraction * 100,
						limit: 100,
						remaining: (1 - usedFraction) * 100,
						used_fraction: usedFraction,
						unit: "percent",
					},
				},
			],
		},
	],
});

let releaseHung: (() => void) | null = null;

/*
 * The starting mode, from `?mode=`, because some states are only reachable
 * BEFORE mount.
 *
 * A driver that sets `mode` after the page loads can only fail an ask that
 * follows a successful cached read. The failed FIRST load is a different frame
 * — there is no payload to fall back on, so it is the one that decides whether
 * the empty-state copy ("No usage reports. Sign in to a provider…") is shown to
 * a user whose backend is merely down. That frame was unreachable here, which
 * is why the false copy survived a round (UX U8, consequence 4).
 */
const startMode = (new URLSearchParams(window.location.search).get("mode") ??
	"answer") as Mode;

const harness: Window["__USAGE_HARNESS__"] = {
	requests: [],
	mode: startMode,
	payload: makePayload("cached", 0.62),
	release: () => releaseHung?.(),
	closes: 0,
};
window.__USAGE_HARNESS__ = harness;

/*
 * The fake bridge. Shaped exactly like the preload API's `desktop.request`, so
 * the shipped `desktopRequest`/`desktopResult` run unmodified above it.
 */
(window as unknown as { api: unknown }).api = {
	desktop: {
		request: async (request: { op: string; live?: boolean }) => {
			harness.requests.push(request as never);
			if (harness.mode === "fail")
				return { status: 503, body: { detail: "Providers refused." } };
			if (harness.mode === "hang")
				return new Promise((resolve) => {
					releaseHung = () =>
						resolve({ status: 200, body: { result: harness.payload } });
				});
			return { status: 200, body: { result: harness.payload } };
		},
	},
};

/*
 * The SHIPPED policy, imported rather than restated.
 *
 * This harness previously built `retry: false`, and that single divergence is
 * why a blocker survived a whole review round: under `retry: false` a failure
 * settles in one tick, so the harness could never observe the window where one
 * attempt has been spent, `errorUpdatedAt` is still 0 and the query reports
 * neither loading nor settled — which is the window the user actually sees and
 * the window the receipt has to speak for. A harness that runs a policy the app
 * does not ship is evidence about the harness.
 *
 * `gcTime` is the one deliberate override: an unmounted query must not be
 * collected between steps of a driven run, or a later step would measure a
 * cold start rather than the state the previous step left behind.
 */
const client = new QueryClient({
	defaultOptions: {
		...defaultQueryOptions,
		queries: {
			...defaultQueryOptions.queries,
			gcTime: Number.POSITIVE_INFINITY,
		},
	},
});

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<QueryClientProvider client={client}>
			<UsageView
				onClose={() => {
					harness.closes += 1;
				}}
				action={{ args: "" } as never}
			/>
		</QueryClientProvider>
	</StrictMode>,
);
