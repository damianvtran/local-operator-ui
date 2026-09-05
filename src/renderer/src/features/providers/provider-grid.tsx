/**
 * "Connect a provider" grid backed by the backend provider registry.
 *
 * Replaces the Radient-vs-BYOK two-gate: Radient is one named card among the
 * registry rows, and every card states only the sign-in methods its registry
 * row actually supports. Order is the backend's registry order — stable
 * across renders so the card under the pointer never moves. A search field
 * appears only when the list is long enough for scanning to cost more than
 * typing.
 */

import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Search, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { ProviderDetail } from "./provider-detail";
import { providerMethodLabel } from "./provider-labels";

const SEARCH_THRESHOLD = 6;

type ProviderGridProps = {
	/** Called once any provider reports a stored credential. */
	onConnected?: () => void;
	/**
	 * Provider to open in detail on mount. `/login <provider>` and the
	 * sign-in picker deep-link here; the grid is otherwise the same surface
	 * onboarding shows, so a provider's methods live in exactly one place.
	 */
	initialProviderId?: string | null;
};

export const ProviderGrid: FC<ProviderGridProps> = ({
	onConnected,
	initialProviderId = null,
}) => {
	const providers = useDesktopProviders(true);
	const [selectedId, setSelectedId] = useState<string | null>(
		initialProviderId,
	);
	// A later deep link to a different provider re-selects; the same id is
	// a no-op so the user's "Back to providers" is not undone by a re-render.
	useEffect(() => {
		if (initialProviderId) setSelectedId(initialProviderId);
	}, [initialProviderId]);
	const [query, setQuery] = useState("");

	const rows = useMemo(() => providers.data ?? [], [providers.data]);
	const filtered = useMemo(() => {
		const needle = query.trim().toLowerCase();
		if (!needle) return rows;
		return rows.filter((provider) =>
			[provider.name, provider.id, ...provider.search_aliases]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [rows, query]);

	if (providers.isLoading) {
		return (
			<div className="flex h-40 items-center justify-center">
				<Spinner size="lg" label="Loading providers" />
			</div>
		);
	}

	if (providers.isError) {
		return (
			<Alert variant="warning">
				<div className="flex items-center justify-between gap-3">
					<span>
						Providers could not be loaded. The backend may need an update.
					</span>
					{/* A load error is transient; Retry re-asks the backend. */}
					<Button
						variant="secondary"
						size="sm"
						onClick={() => void providers.refetch()}
					>
						Retry
					</Button>
				</div>
			</Alert>
		);
	}

	const selected = rows.find((provider) => provider.id === selectedId) ?? null;

	if (selected) {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>
						Back to providers
					</Button>
					<h3 className="text-heading text-ink">{selected.name}</h3>
				</div>
				<ProviderDetail provider={selected} onConnected={onConnected} />
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{rows.length > SEARCH_THRESHOLD && (
				<div className="relative">
					<Search
						size={16}
						className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
						aria-hidden="true"
					/>
					<Input
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						placeholder="Search providers"
						aria-label="Search providers"
						className="pl-9"
					/>
				</div>
			)}

			{filtered.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-6 text-center">
					<p className="text-body-sm text-ink-muted">
						No providers match this search.
					</p>
					{/* An empty result is a dead end of the user's own making; Clear
					    search restores the list rather than re-asking the backend. */}
					<Button variant="secondary" size="sm" onClick={() => setQuery("")}>
						<X aria-hidden="true" />
						Clear search
					</Button>
				</div>
			) : (
				<ul className="grid grid-cols-1 gap-3 sm:grid-cols-2">
					{filtered.map((provider) => (
						<li key={provider.id}>
							<button
								type="button"
								onClick={() => setSelectedId(provider.id)}
								className={cn(
									"flex w-full flex-col gap-2 rounded-md border border-control bg-surface p-4 text-left",
									"transition-colors duration-base ease-out-quart hover:bg-elevated",
								)}
							>
								<span className="flex items-center justify-between gap-2">
									<span className="text-body text-ink">{provider.name}</span>
									{provider.configured && (
										<Badge variant="success">Connected</Badge>
									)}
								</span>
								<span className="text-meta text-ink-dim">
									{providerMethodLabel(provider.auth_methods, provider.local)}
								</span>
							</button>
						</li>
					))}
				</ul>
			)}
		</div>
	);
};
