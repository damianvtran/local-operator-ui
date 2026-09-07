/**
 * Evidence harness: the shipped backend-error surfaces, behind a real bridge.
 *
 * See `backend-error-evidence.html` for why this exists. The short version: the
 * frames these surfaces render at 401/503/404 cannot be captured from the
 * browser-dev HTTP branch, because that branch is not the code that ships and
 * classifies its failures differently. Installing `window.api.desktop` puts the
 * renderer on the Electron IPC path, and injecting the fault AT that bridge
 * makes the shipped transport build the error and attach its status.
 *
 * Every panel below renders a real component against a real QueryClient. None
 * of the copy is restated here -- if a sentence in a captured frame is wrong,
 * it is wrong in the product.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import {
	BackendSettingsSection,
	backendSettingsKeys,
} from "@features/settings/components/backend-settings-section";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@renderer/styles/index.css";

/** The status the injected bridge answers with; per-panel, set before seeding. */
let bridgeStatus = 503;
/**
 * Ops the bridge must never answer, for capturing an in-flight Retry.
 *
 * Keyed by op rather than a single flag because the panels seed concurrently
 * from their own effects: a global "hang everything" switch would swallow
 * another panel's seeding request, and releasing it on a timer would let the
 * in-flight panel settle back to its idle button -- the exact state that panel
 * exists to contrast against.
 */
const hangingOps = new Set<string>();

// The bridge itself. `window.api.desktop` existing is what routes the renderer
// down the IPC branch, so this must be installed before any surface mounts.
(window as unknown as { api: unknown }).api = {
	desktop: {
		request: async (request: { op: string }) => {
			if (hangingOps.has(request.op)) return new Promise(() => {});
			return { status: bridgeStatus, body: { detail: "denied" } };
		},
	},
};

// React Query pauses refetching in a hidden tab, which silently defeats a
// capture run in a background window. Reporting the document visible keeps the
// frames the ones a focused user would see.
Object.defineProperty(document, "visibilityState", {
	configurable: true,
	get: () => "visible",
});
Object.defineProperty(document, "hidden", {
	configurable: true,
	get: () => false,
});

const newClient = () =>
	new QueryClient({
		defaultOptions: {
			queries: {
				retry: false,
				gcTime: Number.POSITIVE_INFINITY,
				// A surface mounting against an errored query would otherwise re-run
				// it and paint its loading state instead of the state being captured.
				retryOnMount: false,
				refetchOnWindowFocus: false,
			},
		},
	});

/** Seed a client with the failure the shipped transport produces at `status`. */
async function seedCapabilities(client: QueryClient, status: number) {
	bridgeStatus = status;
	await client
		.fetchQuery({
			queryKey: desktopKeys.capabilities,
			queryFn: () => desktopResult({ op: "capabilities" }),
			retry: false,
		})
		.catch(() => undefined);
}

/** Seed a provider list that loaded once and then failed, which is the state
 *  in which Retry's in-flight label is reachable (a refetch holding data keeps
 *  `status: "error"` rather than resetting to pending). */
async function seedProviders(client: QueryClient, status: number) {
	client.setQueryData(desktopKeys.providers, [
		{
			id: "openai",
			name: "OpenAI",
			search_aliases: [],
			methods: [{ kind: "api_key" }],
			local: false,
			credential_optional: false,
			has_credential: false,
			configured: false,
		},
	]);
	bridgeStatus = status;
	await client
		.fetchQuery({
			queryKey: desktopKeys.providers,
			queryFn: () => desktopResult({ op: "providers.list" }),
			retry: false,
		})
		.catch(() => undefined);
}

type PanelProps = {
	title: string;
	note: string;
	client: QueryClient;
	children: React.ReactNode;
};

const Panel = ({ title, note, client, children }: PanelProps) => (
	<section className="flex flex-col gap-2 border-hairline border-b pb-6">
		<h2 className="text-body-sm text-ink">{title}</h2>
		<p className="text-meta text-ink-dim">{note}</p>
		<div className="rounded-md bg-surface p-4">
			<QueryClientProvider client={client}>{children}</QueryClientProvider>
		</div>
	</section>
);

/*
 * Seeding runs to completion BEFORE the first render, and sequentially.
 *
 * The panels share one injected bridge, so a panel seeded from its own effect
 * would race the others: the "Retry mid-flight" panel has to leave a
 * `providers.list` request permanently unanswered, and a concurrently-seeding
 * panel issuing the same op would hang on it too. Ordering the seeds here makes
 * every captured frame deterministic.
 */
const settings401 = newClient();
const settings503 = newClient();
const settings404 = newClient();
const providersIdle = newClient();
const providersRetrying = newClient();
const settingsRetryLabel = newClient();
const settingsRetrySpinner = newClient();

await seedCapabilities(settings401, 401);
await seedCapabilities(settings503, 503);
await seedCapabilities(settings404, 404);
await seedProviders(providersIdle, 503);
await seedProviders(providersRetrying, 503);

/*
 * D1 takes TWO shapes on the settings section, and both are captured because
 * only a rendered pair settles whether each one is visibly distinct from the
 * frame the user just clicked out of.
 *
 * (a) The settings list loaded once, so its refetch keeps `status: "error"`
 *     and the error branch keeps winning. Nothing but the button can change,
 *     which is exactly why the button has to.
 * (b) Capabilities never succeeded, so re-asking them resets that query to
 *     pending and the section returns to its spinner. A different branch
 *     renders entirely.
 */
settingsRetryLabel.setQueryData(desktopKeys.capabilities, {
	desktop_available: true,
	features: { settings: 1 },
});
// Seed a successful list, THEN fail its refetch: holding data is what keeps
// `status: "error"` across the retry, and so what makes the label reachable.
settingsRetryLabel.setQueryData(backendSettingsKeys.all, {
	sections: [{ name: "General" }],
	settings: [
		{
			key: "web_search.enabled",
			label: "Web search",
			help: "Allow agents to search the web.",
			section: "General",
			value: "true",
			type: "boolean",
			scope: "live",
		},
	],
});
bridgeStatus = 503;
await settingsRetryLabel
	.fetchQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult({ op: "settings.list" }),
		retry: false,
	})
	.catch(() => undefined);
hangingOps.add("settings.list");
void settingsRetryLabel.refetchQueries({ queryKey: backendSettingsKeys.all });

await seedCapabilities(settingsRetrySpinner, 401);
hangingOps.add("capabilities");
void settingsRetrySpinner.refetchQueries({
	queryKey: desktopKeys.capabilities,
});
await new Promise((resolve) => setTimeout(resolve, 60));

// Left in flight: this panel IS the frame a user sees after clicking Retry.
// Releasing the hang early would let the query settle and repaint the idle
// button, which is the state this panel exists to contrast against.
//
// It is not indefinite, and it should not be: the renderer transport's own 30s
// deadline eventually rejects the request, which is the bound issue 89 was
// filed for. So capture this panel WITHIN 30s of load -- after that the button
// correctly returns to "Retry", and a screenshot taken late shows the settled
// frame rather than the in-flight one.
hangingOps.add("providers.list");
void providersRetrying.refetchQueries({ queryKey: desktopKeys.providers });
await new Promise((resolve) => setTimeout(resolve, 60));

/** The 4s waiting state, lifted out of the settings page so it can be captured
 *  without waiting on a real stalled load. The markup mirrors the page's own
 *  branch; the copy is the point of the capture. */
const SlowLoad = () => (
	// biome-ignore lint/a11y/useSemanticElements: role=status on the container is the live-region pattern.
	<div
		role="status"
		className="flex h-40 w-full flex-col items-center justify-center gap-3 bg-canvas"
	>
		<Spinner size="lg" />
		<p className="max-w-sm text-center text-body-sm text-ink-muted">
			The Local Operator server is taking longer than usual to answer. If it
			does not respond, you will be able to retry from here.
		</p>
	</div>
);

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<main className="flex flex-col gap-6 bg-canvas p-6 text-ink">
			<Panel
				title="Settings at 401 — a running server that refused this app's bearer"
				note="Was: 'Settings could not be loaded. The backend may need an update.'"
				client={settings401}
			>
				<BackendSettingsSection />
			</Panel>
			<Panel
				title="Settings at 503 — the server is not answering"
				note="Must not reach the update remedy either."
				client={settings503}
			>
				<BackendSettingsSection />
			</Panel>
			<Panel
				title="Settings at 404 — the one status an update repairs"
				note="The update remedy is now selected rather than asserted for everything."
				client={settings404}
			>
				<BackendSettingsSection />
			</Panel>
			<Panel
				title="Providers at 503 — error state, Retry idle"
				note="No raw exception in the sentence."
				client={providersIdle}
			>
				<ProviderGrid />
			</Panel>
			<Panel
				title="Providers — Retry mid-flight"
				note="The frame after the click: disabled, and labelled 'Retrying'."
				client={providersRetrying}
			>
				<ProviderGrid />
			</Panel>
			<Panel
				title="Settings Retry mid-flight (a) — the list had loaded, so only the button can change"
				note="Refetch keeps status='error', so the error branch keeps winning: disabled, labelled 'Retrying'."
				client={settingsRetryLabel}
			>
				<BackendSettingsSection />
			</Panel>
			<Panel
				title="Settings Retry mid-flight (b) — capabilities never loaded, so the whole branch changes"
				note="Re-asking resets the gating query to pending: the section returns to its spinner, a different frame from the alert just clicked."
				client={settingsRetrySpinner}
			>
				<BackendSettingsSection />
			</Panel>
			<section className="flex flex-col gap-2">
				<h2 className="text-body-sm text-ink">
					Settings, 4s into a slow load — the explanation, inside a live region
				</h2>
				<p className="text-meta text-ink-dim">
					Was: 'This will stop and offer a retry if it does not respond.'
				</p>
				<div className="rounded-md bg-surface p-4">
					<SlowLoad />
				</div>
			</section>
		</main>
	</StrictMode>,
);
