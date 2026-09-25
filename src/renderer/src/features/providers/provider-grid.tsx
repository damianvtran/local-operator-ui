/**
 * Settings > Model providers, and the connect list onboarding and the connect
 * dialog show: the registry census as two blocks rather than 18 cards.
 *
 * ## Why a list and not a grid
 *
 * The grid gave every provider the same card and the same "Needs sign-in"
 * chip, kept a connected provider in registry position (Radient "Signed in"
 * was card 15 of 18, below the fold), and mixed local runtimes into the cloud
 * accounts (design D3, UX U4). The page now answers the question a reader
 * comes with first -- what is connected, and which is the default -- in a
 * "Connected" block, and groups the rest by WHERE model access comes from:
 * a subscription, an API key, or this computer (design § 2, after Zed's
 * grouping). Every row has exactly one action, named for what it does.
 *
 * Selecting a row expands its sign-in panel INLINE beneath it (design § 2,
 * P1), one at a time, so the reader never loses the list or their place in it.
 *
 * ## What stays from the grid
 *
 * The recommendation rule (`recommendedProvider`, `visibleProviders`,
 * `showsRecommendedCue`) and its tests are unchanged: the recommended row still
 * leads while nothing is connected and drops its cue once it is. The search
 * field stays with the list, always rendered (see the rationale that used to
 * head this file: a short registry hiding the one control a scanning reader
 * wants is the worse failure).
 */

import { ConfigApi } from "@shared/api/local-operator/config-api";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
/*
 * The verdict is read through the composer callout's own module rather than a
 * query of this feature's: the chip and the callout share one cache entry for
 * `GET /v1/auth/status`, so they cannot disagree about one verdict at one
 * instant (see `useRadientAuthStatus`).
 */
import { useRadientLoginVerdict } from "@shared/hooks/use-radient-session-issue";
/*
 * The MODULE, not the `@shared/hooks` barrel: the barrel carries
 * `use-connectivity-status`, which reads the renderer's config at import time and
 * therefore throws in any Node bundle that does not define `import.meta.env` --
 * `scripts/backend-error-surfaces.test.mjs` bundles this grid and says so in its own
 * docblock. Importing the leaf keeps this feature out of that graph.
 */
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { MoreHorizontal, Search, X } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	FEATURED_PROVIDER_IDS,
	GROUP_HEADINGS,
	type ProviderGroup,
	RECOMMENDED_PROVIDER_ID,
	addRowMeta,
	addRowsByGroup,
	brandOf,
	connectedRowMeta,
	connectedRows,
	modelDisplayName,
	monogramOf,
	providerGroup,
	rowActionLabel,
} from "./provider-catalog";
import { ProviderDetail, type ProviderDetailContext } from "./provider-detail";
import {
	loginClaim,
	providerLoadErrorMessage,
	providerReadiness,
} from "./provider-labels";
import { CONFIG_QUERY_KEY, useDefaultModel } from "./use-provider-status";

/**
 * The provider the first-run flow points a new user at.
 *
 * WHY A PIN IN THE VIEW AND NOT AN ORDER CHANGE IN THE REGISTRY. The registry's
 * order is the TUI picker's and the CLI's too — this app is one of three readers
 * of it — and "the easiest way to get started" is a claim about this screen
 * rather than about the registry. So the promotion lives here, keyed by ID
 * rather than by display name, which is not a key.
 *
 * WHY `radient` AND NOT `radient-key`, the registry's other Radient entry: the
 * census FOLDS the two into one row. `radient-key` declares
 * `store_credentials_as="radient"`, so `providers.list` reports a single Radient
 * row whose methods are the browser sign-in and then the Radient Pass key — one
 * card, no second candidate to choose between, and the promoted row's own
 * primary method is the sign-in this recommendation is about.
 */

/**
 * The line under the promoted card, and what it is allowed to claim.
 *
 * One sign-in with nothing to paste is the whole argument for a reader who has
 * not chosen a provider yet, and it has to stay true of the row it is printed
 * on: that row offers the browser sign-in AND a key, so the sentence claims the
 * sign-in path rather than that no key exists anywhere.
 */
const RECOMMENDED_REASON = "One browser sign-in. Nothing to paste.";

/**
 * The recommended row, when the recommendation still applies. Null when the
 * census does not carry it (an older runtime, a registry that drops the row) or
 * when it is ALREADY SIGNED IN.
 *
 * The credential test is the whole reason this is a function rather than an id
 * comparison, and it is `providerReadiness`'s own answer rather than a second
 * reading of its three flags: the cue stops where the CENSUS says a credential is
 * held. That matters on both surfaces this grid renders on -- "Recommended" over
 * a credential the reader already holds, above a sentence promising a sign-in
 * they have already done, argues for a decision they have made (UX round 1, U3;
 * code round 1, R1-6). The promoted row is neither local nor credential-free, so
 * for it the two groups that matter here are "Ready to use" and "Needs sign-in".
 *
 * WHY A REFUSED OR UNCONFIRMED SIGN-IN DOES NOT MOVE THE PIN (design round 2,
 * D8), since the badge on that same card now says "Needs re-authentication" and
 * this comment used to promise the cue "stops exactly where the badge changes its
 * mind". The recommendation is an ARGUMENT FOR A CHOICE NOT YET MADE: position,
 * the `Recommended` cue and the reason line ("One browser sign-in. Nothing to
 * paste.") are all addressed to a reader who has not picked a provider. A row
 * whose sign-in Radient refuses -- or whose verdict the app cannot confirm -- is a
 * choice the reader HAS made and which is now broken, and what such a reader
 * needs is the remedy, which the composer callout names in words and this card's
 * own badge already shouts. Promoting it would instead move a broken row above
 * the working providers they are now scanning for, and re-print the sign-in
 * argument for the sign-in that just failed. So the pin deliberately reads the
 * census alone, and the badge is where the verdict speaks: two questions, two
 * answers, and the docblock now says which is which rather than promising the
 * cue tracks the badge.
 *
 * The census is also the honest input for the OTHER states here. A refused row
 * keeps `has_credential: true` and a never-signed-in row has none, so the two are
 * already different inputs -- the pin needs no verdict to tell them apart, and a
 * grid that moved the refused row would move it for a reading (`login_required`)
 * that says nothing about whether the reader wants a different provider.
 */
export function recommendedProvider(
	rows: DesktopProvider[],
): DesktopProvider | null {
	const row = rows.find((provider) => provider.id === RECOMMENDED_PROVIDER_ID);
	if (row === undefined) return null;
	return providerReadiness(row).group === "Needs sign-in" ? row : null;
}

/**
 * Whether a card carries the recommendation cue.
 *
 * Separate from `recommendedProvider` because the two answer different
 * questions and only one of them is about position: that one says WHICH row the
 * app suggests (and stops saying so once the reader is signed in); this one says
 * whether a row in the list IS that row -- under a query included, which is the
 * whole point of the split (UX round 1, U2). Its inputs are the row's id and the
 * recommended id, neither of which is the query.
 */
export function showsRecommendedCue(
	providerId: string,
	recommendedId: string | null,
): boolean {
	return recommendedId !== null && providerId === recommendedId;
}

/**
 * The rows the grid paints, in the order it paints them -- the ONE place the
 * filter and the pin are decided, so the two cannot disagree about a list.
 *
 * WHAT EACH OF THE TWO RULES IS, and why they are not the same rule:
 *
 * - The PIN is unfiltered-only. A query is the reader telling this screen what
 *   they are looking for, and reordering matches under that instruction would
 *   both fight the instruction and make the order depend on a promotion nobody
 *   asked for -- so a filtered list is registry order.
 * - The CUE (decided by the caller, from `recommendedId`) travels with the
 *   provider into a filtered list, because being the app's suggestion is a fact
 *   about the provider rather than about its position. The first round measured
 *   what gating both together costs: `rad` narrowed the list to the one row the
 *   whole promotion is about and the cue was gone, so the recommendation was
 *   invisible to the reader hunting for it (UX round 1, U2).
 *
 * The reorder is applied to the DATA rather than with a CSS `order:`, because a
 * card painted somewhere other than where it sits in the DOM puts the tab order
 * and the visual order in disagreement -- and being the first card a keyboard
 * user reaches here is much of what promoting it is FOR.
 *
 * Exported so `scripts/provider-grid-pin.test.mjs` can assert both rules
 * directly: this is a static-render harness with no DOM, so a state a user
 * reaches by typing cannot be rendered into existence, and a rule with no test
 * is a rule the next author restates instead of reading.
 */
export function visibleProviders(
	rows: DesktopProvider[],
	query: string,
	recommendedId: string | null,
): DesktopProvider[] {
	const needle = query.trim().toLowerCase();
	if (needle) {
		return rows.filter((provider) =>
			[provider.name, provider.id, ...provider.search_aliases]
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}
	// Nothing to promote when it is already first, when the census does not carry
	// it, or when it is already signed in (`recommendedId` is null then).
	if (recommendedId === null) return rows;
	const index = rows.findIndex((provider) => provider.id === recommendedId);
	if (index <= 0) return rows;
	return [rows[index], ...rows.slice(0, index), ...rows.slice(index + 1)];
}

/** The 32px tile: two letters on the elevated step (design § 2, P1 monograms). */
const Monogram: FC<{ provider: DesktopProvider }> = ({ provider }) => (
	<span
		aria-hidden="true"
		className="flex size-8 shrink-0 items-center justify-center rounded-md bg-elevated font-medium text-body-sm text-ink"
	>
		{monogramOf(brandOf(provider))}
	</span>
);

/** A list container: the surface step, rows split by hairlines, no border. */
const RowList: FC<{ children: ReactNode; label?: string }> = ({
	children,
	label,
}) => (
	<ul
		aria-label={label}
		className="flex flex-col divide-y divide-hairline overflow-hidden rounded-[14px] bg-surface"
	>
		{children}
	</ul>
);

type ProviderGridProps = {
	/** Called once any provider reports a stored credential. */
	onConnected?: () => void;
	/**
	 * Provider to open on mount. `/login <provider>` and the sign-in picker
	 * deep-link here, so a provider's methods live in exactly one place.
	 */
	initialProviderId?: string | null;
	/** Where the list is shown; decides only the success action's words. */
	context?: ProviderDetailContext;
	/**
	 * Onboarding's shape: the featured rows first and everything else behind a
	 * "More providers" disclosure, so the dialog does not scroll an 18-row list
	 * inside itself (design D6).
	 */
	featuredOnly?: boolean;
	/** Open the "More providers" disclosure on this group, e.g. `local`. */
	focusGroup?: ProviderGroup | null;
	/** Called from a success state's action ("Continue" / "Done"). */
	onDone?: () => void;
	/** Opens the model picker from a receipt's "Change". */
	onChangeModel?: () => void;
};

export const ProviderGrid: FC<ProviderGridProps> = ({
	onConnected,
	initialProviderId = null,
	context = "settings",
	featuredOnly = false,
	focusGroup = null,
	onDone,
	onChangeModel,
}) => {
	const providers = useDesktopProviders(true);
	const { hosting, model } = useDefaultModel();
	const queryClient = useQueryClient();
	/*
	 * The verdict on this machine's Radient sign-in, which is the one input that
	 * can tell a credential ROW from a working sign-in (see `loginState`). Read
	 * HERE rather than passed down, because the row's own facts cannot answer it:
	 * the row is the surface that claims a sign-in, so it is the surface that has
	 * to ask.
	 */
	const login = useRadientLoginVerdict();
	/*
	 * The app's own answer about whether any Radient sign-in is stored, and
	 * whether it could be asked at all. It is the second input `loginState` reads,
	 * and the reason it exists is design round 1's D3: on a runtime whose route
	 * predates `radient_login` there is no verdict at all, so without this the row
	 * falls back to the credential ROW and the contradiction this change removes
	 * comes back. See `loginState` for why only a `signed-out` answer from an
	 * enabled read narrows it.
	 */
	const { accountRead, unavailable } = useRadientUserQuery();
	const [selectedId, setSelectedId] = useState<string | null>(
		initialProviderId,
	);
	/*
	 * One press, one navigation. The defer this used to carry (two animation frames)
	 * was shorter than Radix's focus restore on a quick press, which is why "Change
	 * model…" worked at 100 ms and did nothing at 0-40 ms: traced live, the
	 * navigation happened at 36 ms, Radix put focus back on the menu's own trigger at
	 * 38 ms, and the scroller snapped back at 47 ms (QA round 3 Q3-1, UX round 2
	 * U2'). The restore is now refused at the menu (see its `onCloseAutoFocus`), so
	 * the handler can run at once and land the user where they asked to go.
	 */
	const openModelSettings = useCallback(() => {
		onChangeModel?.();
		/*
		 * And focus follows the view: the trigger is off-screen once the settings
		 * scroll lands, so leaving focus on it is what made the keyboard path feel
		 * broken too.
		 */
		requestAnimationFrame(() => {
			const target = document.getElementById("model-settings");
			target?.focus?.({ preventScroll: true });
		});
	}, [onChangeModel]);

	// A later deep link to a different provider re-selects; the same id is a
	// no-op so the reader's own collapse is not undone by a re-render.
	useEffect(() => {
		if (initialProviderId) setSelectedId(initialProviderId);
	}, [initialProviderId]);
	const [query, setQuery] = useState("");
	const [confirmSignOut, setConfirmSignOut] = useState<string | null>(null);
	const searchRef = useRef<HTMLInputElement>(null);
	const rowButtons = useRef(new Map<string, HTMLButtonElement | null>());

	const rows = useMemo(() => providers.data ?? [], [providers.data]);
	const connected = useMemo(
		() => connectedRows(rows, hosting),
		[rows, hosting],
	);
	const groups = useMemo(
		() => addRowsByGroup(rows, hosting, query),
		[rows, hosting, query],
	);
	const recommendedId = recommendedProvider(rows)?.id ?? null;

	/*
	 * Focus returns to the row's own button when its panel collapses, so a
	 * keyboard reader lands where they left (the grid's UX round 1, U1, which
	 * this list inherits).
	 */
	const [focusRow, setFocusRow] = useState<string | null>(null);
	useEffect(() => {
		if (focusRow === null) return;
		const target = rowButtons.current.get(focusRow) ?? searchRef.current;
		setFocusRow(null);
		target?.focus();
	}, [focusRow]);

	/*
	 * The row the user acted on MOVES into "Connected" when its credential lands,
	 * and in a scrolled dialog or settings page that move carried the receipt off
	 * screen: the success moment this PR designs happened out of view, and the
	 * dialog looked as though nothing had happened (UX round 1 U3). The view
	 * follows the row rather than the row staying put, which keeps "Connected" one
	 * block. `nearest` is deliberate: a row already on screen does not move.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `connected.length` is the trigger, not a value the body reads - the selected row changes list (and position) when its credential lands while `selectedId` stays the same, so without it the effect never re-runs for the move this scroll exists to follow.
	useEffect(() => {
		if (selectedId === null) return;
		rowButtons.current.get(selectedId)?.closest("li")?.scrollIntoView({
			block: "nearest",
		});
	}, [selectedId, connected.length]);

	const toggle = (id: string) => {
		if (selectedId === id) {
			setSelectedId(null);
			setFocusRow(id);
		} else {
			setSelectedId(id);
		}
	};
	const collapse = () => {
		const id = selectedId;
		setSelectedId(null);
		if (id) setFocusRow(id);
		onDone?.();
	};

	const refresh = () => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
		void queryClient.invalidateQueries({ queryKey: CONFIG_QUERY_KEY });
	};

	const makeDefault = async (provider: DesktopProvider) => {
		const suggestion = provider.suggested_model;
		try {
			await ConfigApi.updateConfig("", {
				hosting: provider.id,
				// The provider's own suggestion when the backend states one; an
				// empty model otherwise, which the backend resolves to that
				// provider's default rather than keeping another provider's id.
				model_name: suggestion?.id ?? "",
			});
			refresh();
		} catch (error) {
			showErrorToast(
				error instanceof Error ? error.message : "The default was not changed.",
			);
		}
	};

	const signOut = async (provider: DesktopProvider) => {
		setConfirmSignOut(null);
		try {
			await desktopResult({ op: "auth.logout", provider: provider.id });
			refresh();
			onConnected?.();
		} catch (error) {
			showErrorToast(
				error instanceof Error ? error.message : "Sign-out did not complete.",
			);
		}
	};

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
					<span>{providerLoadErrorMessage(providers.error)}</span>
					{/* A load error is transient; Retry re-asks the server.

					    `isFetching`, not `isLoading`: a refetch of an already-errored
					    query keeps `status: "error"`, so this branch (evaluated after
					    `isLoading`) keeps winning and the frame would not change for
					    the transport's whole deadline. A recovery affordance that does
					    not acknowledge the click is the one users press four times and
					    then relaunch. */}
					<Button
						variant="secondary"
						size="sm"
						className="shrink-0"
						onClick={() => void providers.refetch()}
						disabled={providers.isFetching}
					>
						{providers.isFetching ? "Retrying" : "Retry"}
					</Button>
				</div>
			</Alert>
		);
	}

	const panelFor = (provider: DesktopProvider) =>
		selectedId === provider.id ? (
			<div className="border-hairline border-t bg-surface px-4 py-4">
				<ProviderDetail
					provider={provider}
					onConnected={onConnected}
					onDone={collapse}
					onChangeModel={onChangeModel}
					context={context}
				/>
			</div>
		) : null;

	const addRow = (provider: DesktopProvider) => {
		const isRecommended = showsRecommendedCue(provider.id, recommendedId);
		const suggestion = provider.suggested_model?.name;
		const open = selectedId === provider.id;
		return (
			<li key={provider.id} data-provider-id={provider.id}>
				<div className="flex min-h-14 items-center gap-3 px-4 py-2">
					<Monogram provider={provider} />
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="flex flex-wrap items-baseline gap-x-2 text-body text-ink">
							{brandOf(provider)}
							{isRecommended ? (
								<span className="font-medium text-ink text-meta">
									Recommended
								</span>
							) : null}
						</span>
						<span className="text-ink-muted text-meta">
							{isRecommended ? RECOMMENDED_REASON : addRowMeta(provider)}
							{suggestion ? (
								<span className="text-ink-dim"> · Suggests {suggestion}</span>
							) : null}
						</span>
					</div>
					<Button
						ref={(element) => {
							rowButtons.current.set(provider.id, element);
						}}
						/*
						 * The accent is spent once in this block, on the recommendation --
						 * but only while the recommendation is genuinely the next action.
						 * Once another row's panel is open, or a provider is already
						 * connected, the real next action is in that panel and the promoted
						 * row competed with it: two accent-filled primaries in one small
						 * dialog (design round 1 D2). The "Recommended" label stays.
						 */
						variant={
							isRecommended &&
							!open &&
							selectedId === null &&
							connected.length === 0
								? "primary"
								: "secondary"
						}
						size="sm"
						aria-expanded={open}
						aria-label={`${open ? "Close" : rowActionLabel(provider)}: ${brandOf(provider)}`}
						onClick={() => toggle(provider.id)}
					>
						{open ? "Close" : rowActionLabel(provider)}
					</Button>
				</div>
				{panelFor(provider)}
			</li>
		);
	};

	const connectedRow = (provider: DesktopProvider) => {
		const isDefault = provider.id === hosting;
		const modelName = isDefault
			? modelDisplayName(provider, model)
			: (provider.suggested_model?.name ?? null);
		const open = selectedId === provider.id;
		/*
		 * THE ROW'S CLAIM GOES THROUGH THE VERDICT, NOT THE CREDENTIAL ROW (#426;
		 * UX U1 on the chat session-issue PR). `isConnectedRow` puts a provider here
		 * from `has_credential || configured`, and a grant Radient has stopped
		 * accepting keeps both, so a row that read its own census would say
		 * "Signed in" for a sign-in that is dead -- which is exactly what the chip
		 * on the card grid used to do, one screen from a composer saying the sign-in
		 * needed re-authentication.
		 *
		 * `loginClaim` answers `null` until a read that can support a claim has
		 * answered, and the label is `providerReadiness`' own words, so this row, the
		 * provider panel and the composer callout cannot spell one verdict two ways.
		 *
		 * THE CLAIM WAITS; THE LIST DOES NOT (design round 4, D12 and D14, whose
		 * rationale moves here with the claim it is about). Design round 1's D6 -- a
		 * green "Signed in" painted for 72-193 ms on a refused machine and then
		 * corrected -- used to be closed by holding the whole card list until the
		 * verdict's first answer. That held the wrong surface: a verdict route that
		 * never answers kept 18 cards behind "Loading providers" for the transport's
		 * 20 s deadline (D14), and a route that FAILED released the hold onto a claim
		 * the account read had not yet supported (D12: green for 2,493 ms, then
		 * corrected). The only thing either read decides is the Radient row's claim,
		 * so the claim is the only thing that waits.
		 */
		const claim = loginClaim(provider.id, login, { accountRead, unavailable });
		const readiness =
			claim === null ? null : providerReadiness(provider, claim);
		const meta = connectedRowMeta(
			provider,
			modelName,
			readiness?.label ?? null,
		);
		return (
			<li key={provider.id} data-provider-id={provider.id}>
				<div className="flex min-h-14 items-center gap-3 px-4 py-2">
					<Monogram provider={provider} />
					<div className="flex min-w-0 flex-1 flex-col">
						<span className="text-body text-ink">{brandOf(provider)}</span>
						{/*
						 * The claim is this line's first word, and it carries the three
						 * things the chip carried before it (design round 1, D2): the long form
						 * on `title`, so a refusal's own sentence is still reachable where the
						 * short label had to be; the withheld state as `data-claim`, so a rig
						 * can tell a claim that has not arrived from a row that is not there;
						 * and the LINE itself, kept when there is no claim to make.
						 *
						 * WHY THE LINE IS KEPT RATHER THAN DROPPED: the claim lands in it
						 * moments later, and a row whose name moves when it does reads as the
						 * correction D6 removed. The non-breaking space states nothing and
						 * paints nothing, and the row is `min-h-14`, so the geometry is the
						 * same in every window.
						 */}
						<span
							className="truncate text-ink-muted text-meta"
							title={readiness?.detail}
							data-claim={claim === null ? "withheld" : undefined}
						>
							{meta ?? "\u00a0"}
						</span>
					</div>
					{/*
					 * A plain label, not a bordered one: `border-control` is the boundary
					 * of things you can press, and the bordered chip measured the same
					 * height and radius as the row's own secondary button, so on the
					 * Connected row it read as a clickable "Default" control next to the
					 * overflow (design round 1 D3, UX N5).
					 */}
					{isDefault ? (
						<span className="text-ink-muted text-meta">Default</span>
					) : null}
					{confirmSignOut === provider.id ? (
						<div className="flex items-center gap-2">
							<span className="text-body-sm text-ink">
								Sign out of {brandOf(provider)}?
							</span>
							<Button
								variant="danger"
								size="sm"
								onClick={() => void signOut(provider)}
							>
								Sign out
							</Button>
							<Button
								variant="ghost"
								size="sm"
								onClick={() => setConfirmSignOut(null)}
							>
								Keep
							</Button>
						</div>
					) : (
						<DropdownMenu>
							<DropdownMenuTrigger asChild>
								<Button
									ref={(element) => {
										rowButtons.current.set(provider.id, element);
									}}
									variant="ghost"
									size="icon-sm"
									aria-label={`Manage ${brandOf(provider)}`}
								>
									<MoreHorizontal aria-hidden="true" />
								</Button>
							</DropdownMenuTrigger>
							<DropdownMenuContent
								align="end"
								/*
								 * Radix restores focus to the trigger as the menu closes, and a
								 * focus() call scrolls its target into view -- cancelling the
								 * scroll the item below starts, on exactly the quick presses a
								 * trackpad makes. The restore is skipped; the item's handler
								 * moves focus where the user is being sent instead.
								 */
								onCloseAutoFocus={(event) => event.preventDefault()}
							>
								{!isDefault ? (
									<DropdownMenuItem onSelect={() => void makeDefault(provider)}>
										Make default
									</DropdownMenuItem>
								) : null}
								{isDefault && onChangeModel ? (
									<DropdownMenuItem
										/*
										 * BOTH events, one press. Radix fires `onSelect` from its own
										 * key and pointer paths; a quick trackpad tap -- measured at
										 * under 60 ms, which is what tap-to-click is -- reached
										 * neither, so "Change model…" did nothing in five of six
										 * tries while a 100 ms press worked six of six (UX round 2
										 * U2'). The handler is deferred by two frames either way,
										 * because Radix restores focus to the menu's trigger as the
										 * menu closes and a focus() call scrolls its target into
										 * view, cancelling the smooth scroll this press starts (UX
										 * round 1 U2). A ref keeps the pair from navigating twice.
										 */
										onClick={() => openModelSettings()}
										onSelect={() => openModelSettings()}
									>
										Change model…
									</DropdownMenuItem>
								) : null}
								{!provider.local ? (
									<DropdownMenuItem onSelect={() => setSelectedId(provider.id)}>
										{providerGroup(provider) === "key"
											? "Replace key…"
											: "Sign in again…"}
									</DropdownMenuItem>
								) : (
									<DropdownMenuItem onSelect={() => setSelectedId(provider.id)}>
										Check connection
									</DropdownMenuItem>
								)}
								{!provider.local && provider.stored_credentials > 0 ? (
									<>
										<DropdownMenuSeparator />
										<DropdownMenuItem
											destructive
											onSelect={() => setConfirmSignOut(provider.id)}
										>
											Sign out…
										</DropdownMenuItem>
									</>
								) : null}
							</DropdownMenuContent>
						</DropdownMenu>
					)}
				</div>
				{open ? panelFor(provider) : null}
			</li>
		);
	};

	const groupOrder: ProviderGroup[] = ["subscription", "key", "local"];
	const nothingMatches = groupOrder.every(
		(group) => groups[group].length === 0,
	);

	const searchField = (
		<div className="relative w-full sm:w-64">
			<Search
				size={16}
				className="pointer-events-none absolute top-1/2 left-3 -translate-y-1/2 text-ink-dim"
				aria-hidden="true"
			/>
			<Input
				ref={searchRef}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				placeholder="Search providers"
				aria-label="Search providers"
				className="pl-9"
			/>
		</div>
	);

	const groupedBlocks = nothingMatches ? (
		<div className="flex flex-col items-center gap-2 py-6 text-center">
			<p className="text-body-sm text-ink-muted">
				No providers match this search.
			</p>
			{/* Clear search restores the list and hands the field back: a reader
			    who cleared a query is about to type another (UX round 1, U4). */}
			<Button
				variant="secondary"
				size="sm"
				onClick={() => {
					setQuery("");
					searchRef.current?.focus();
				}}
			>
				<X aria-hidden="true" />
				Clear search
			</Button>
		</div>
	) : (
		groupOrder.map((group) =>
			groups[group].length > 0 ? (
				<div key={group} className="flex flex-col gap-2">
					<h4 className="text-ink-dim text-meta">{GROUP_HEADINGS[group]}</h4>
					<RowList label={GROUP_HEADINGS[group]}>
						{groups[group].map(addRow)}
					</RowList>
				</div>
			) : null,
		)
	);

	if (featuredOnly) {
		const featured = FEATURED_PROVIDER_IDS.map((id) =>
			rows.find((provider) => provider.id === id),
		).filter(
			(provider): provider is DesktopProvider =>
				provider !== undefined &&
				!connected.some((row) => row.id === provider.id),
		);
		return (
			<div className="flex flex-col gap-4" data-provider-grid="">
				{connected.length > 0 ? (
					<RowList label="Connected">{connected.map(connectedRow)}</RowList>
				) : null}
				{featured.length > 0 ? (
					<RowList label="Suggested providers">{featured.map(addRow)}</RowList>
				) : null}
				<Disclosure
					summary="More providers"
					defaultOpen={focusGroup !== null || initialProviderId !== null}
					chevron="trailing"
				>
					<div className="flex flex-col gap-4 pt-3">
						{searchField}
						{groupedBlocks}
					</div>
				</Disclosure>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-6" data-provider-grid="">
			{connected.length > 0 ? (
				<section
					className="flex flex-col gap-2"
					aria-labelledby="providers-connected"
				>
					<h3 id="providers-connected" className="text-heading text-ink">
						Connected
					</h3>
					<RowList>{connected.map(connectedRow)}</RowList>
				</section>
			) : null}
			<section className="flex flex-col gap-3" aria-labelledby="providers-add">
				<div className="flex flex-wrap items-center justify-between gap-3">
					<h3 id="providers-add" className="text-heading text-ink">
						{connected.length > 0 ? "Add a provider" : "Connect a provider"}
					</h3>
					{searchField}
				</div>
				{groupedBlocks}
			</section>
		</div>
	);
};
