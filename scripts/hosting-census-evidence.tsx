/**
 * Evidence harness: the hosting picker's three census states, beside the grid.
 *
 * See `hosting-census-evidence.html` for why this exists. The property being
 * captured is issue 93's: the picker must not offer every provider when the
 * census FAILED, and what it does instead has to agree with what the
 * onboarding grid says about the same fault. Rendering both shipped components
 * against ONE injected fault is what makes that agreement visible rather than
 * asserted -- neither component's copy is restated here, so a wrong sentence in
 * a captured frame is wrong in the product.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { useModelsStore } from "@shared/store/models-store";
import censusFixture from "./fixtures/auth-providers-0.50.0.json";
import "@renderer/styles/index.css";

/**
 * Which census state this page load captures, from `?state=`.
 *
 * ONE state per load, deliberately. The first version of this harness rendered
 * all three panels together against a single module-level "fail providers"
 * flag, and the panels' own mounts re-ran `providers.list` AFTER seeding -- so
 * whichever value the flag happened to hold last was the answer every panel
 * got, and the healthy panel captured a failure while captioned as ready. A
 * shared mutable fault is not a per-panel fault; binding the state to the page
 * load makes each frame a picture of exactly one condition.
 *
 * `capabilities` must always SUCCEED: the picker only consults the census when
 * the backend advertises the `auth` feature, so a harness that failed
 * capabilities too would capture the unmanaged-backend branch (the env-file key
 * list) and caption it as a census failure -- a frame of the wrong code path.
 */
const STATE = new URLSearchParams(location.search).get("state") ?? "ready";

const CAPABILITIES = {
	desktop_available: true,
	features: { auth: 1, settings: 1, commands: 1 },
};

// The bridge itself. `window.api.desktop` existing is what routes the renderer
// down the IPC branch that ships, so it is installed before any surface mounts.
(window as unknown as { api: unknown }).api = {
	desktop: {
		request: async (request: { op: string }) => {
			if (request.op === "capabilities")
				return { status: 200, body: { result: CAPABILITIES } };
			if (request.op === "providers.list") {
				// The loading frame needs a request that never settles, and it has
				// to hang HERE rather than in a seeded queryFn: the component's own
				// mount refetch would otherwise resolve against the bridge and
				// settle the state the frame is meant to show.
				if (STATE === "loading") return new Promise(() => {});
				if (STATE === "failed")
					return { status: 503, body: { detail: "server unavailable" } };
				return { status: 200, body: { result: { providers: CENSUS } } };
			}
			return { status: 503, body: { detail: "denied" } };
		},
	},
};

// React Query pauses refetching in a hidden tab, which silently defeats a
// capture run in a background window.
Object.defineProperty(document, "visibilityState", {
	configurable: true,
	get: () => "visible",
});
Object.defineProperty(document, "hidden", { configurable: true, get: () => false });

/**
 * The census the healthy panel renders.
 *
 * The VERBATIM `GET /v1/auth/providers` body already committed as a fixture and
 * already used by `scripts/provider-state.test.mjs`, rather than a shape
 * hand-written here. A hand-written one was wrong on first try -- it named the
 * methods array `methods` where the backend sends `auth_methods`, which threw
 * inside the grid and produced an empty frame. A fixture that the shipped
 * components can actually consume is the only kind that proves anything.
 */

const CENSUS = censusFixture.result.providers;

/**
 * The manifest the picker filters, seeded into the models store.
 *
 * `getHostingProviders()` reads `useModelsStore`, NOT the census, and returns
 * `[]` until that store is initialised. Without this seed the picker renders
 * empty in all three states -- which would have made the failed frame look
 * exactly like the healthy one and proved nothing at all. Seeding it is what
 * makes "the census removed these rows" an observable difference between the
 * frames rather than an invisible one.
 *
 * The rows are the census's own ids, so the two surfaces are talking about the
 * same providers and the picker has something to drop.
 *
 * Called AFTER an explicit rehydrate rather than at module top level: the store
 * is `persist`ed, and its rehydration from localStorage lands in a microtask
 * that overwrote a seed written before it -- silently, leaving the picker empty
 * in a frame captioned as healthy.
 */
function seedManifest() {
	useModelsStore.setState({
		providers: CENSUS.map((provider) => ({
			id: provider.id,
			name: provider.name,
			description: provider.base_url ?? "Model provider",
			url: provider.base_url ?? "",
			requiredCredentials: provider.credential_name
				? [provider.credential_name]
				: [],
		})),
		models: [],
		isInitialized: true,
		lastFetched: Date.now(),
	});
}

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

/**
 * Settle capabilities before mounting, so the surfaces do not paint a
 * capabilities spinner over the census state being captured. The census itself
 * is deliberately NOT seeded: the components issue it themselves against the
 * bridge above, which is the path that ships.
 */
async function seedCapabilities(client: QueryClient) {
	await client
		.fetchQuery({
			queryKey: desktopKeys.capabilities,
			queryFn: () => desktopResult({ op: "capabilities" }),
			retry: false,
		})
		.catch(() => undefined);
}

const Panel = ({
	title,
	note,
	client,
}: {
	title: string;
	note: string;
	client: QueryClient;
}) => (
	<QueryClientProvider client={client}>
		<section className="flex w-[520px] shrink-0 flex-col gap-3 rounded-md border border-hairline bg-surface p-4">
			<div className="flex flex-col gap-1">
				<h2 className="text-heading text-ink">{title}</h2>
				<p className="text-meta text-ink-muted">{note}</p>
			</div>
			{/* The defect is what the OPEN list contains, so the frame has to show
			    it open. `?open=1` clicks the combobox after mount rather than
			    reaching into the component, so the list is opened the way a user
			    opens it. */}
			<div className="rounded-md border border-hairline bg-sunken p-3">
				<p className="mb-2 text-meta text-ink-dim">Hosting picker (Settings)</p>
				<HostingSelect
					value=""
					onSave={async () => {}}
					filterByCredentials={true}
					allowCustom={true}
					allowDefault={false}
					emptyHelperText="No hosting providers available. Add one in API credentials, in the list on the left."
				/>
			</div>
			<div className="rounded-md border border-hairline bg-sunken p-3">
				<p className="mb-2 text-meta text-ink-dim">Onboarding providers grid</p>
				<ProviderGrid />
			</div>
		</section>
	</QueryClientProvider>
);

const NOTES: Record<string, { title: string; note: string }> = {
	loading: {
		title: "Census loading",
		note: "Filtering suppressed on purpose: the answer is moments away and blanking a populated control reads as it breaking.",
	},
	ready: {
		title: "Census ready",
		note: "Census owns the filter. Google and Mistral are absent (need sign-in); the local servers stay (no key needed).",
	},
	failed: {
		title: "Census failed (503)",
		note: "Issue 93: offered every provider before this fix. Now offers none, and says why in the grid's own words.",
	},
};

const client = newClient();
await seedCapabilities(client);
await useModelsStore.persist?.rehydrate();
seedManifest();

const { title, note } = NOTES[STATE] ?? NOTES.ready;

createRoot(document.getElementById("root") as HTMLElement).render(
	<StrictMode>
		<div className="flex min-h-screen justify-center bg-canvas p-6">
			<Panel title={title} note={note} client={client} />
		</div>
	</StrictMode>,
);

// Open the picker's list the way a user would, when asked. Done from outside
// the component so nothing about the captured list is stage-managed: whatever
// the combobox shows here is what it shows on a click in the app.
if (new URLSearchParams(location.search).get("open") === "1") {
	setTimeout(() => {
		document.querySelector<HTMLInputElement>('input[role="combobox"]')?.click();
	}, 400);
}
