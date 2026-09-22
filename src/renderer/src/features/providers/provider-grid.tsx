/**
 * "Connect a provider" grid backed by the backend provider registry.
 *
 * Replaces the Radient-vs-BYOK two-gate: Radient is one named card among the
 * registry rows, and every card states only the sign-in methods its registry
 * row actually supports. Order is the backend's registry order — stable across
 * renders so the card under the pointer never moves — with one exception: the
 * recommended row is promoted to the front of the UNFILTERED list and only
 * there, while its CUE travels with it into a filtered list (see
 * `RECOMMENDED_PROVIDER_ID`).
 *
 * The search field is rendered with the list, always. It used to be gated behind
 * `rows.length > 6`, on the theory that a field over a three-row list is chrome
 * nobody asked for; the census is 18 rows and only grows, so that condition is
 * unreachable in the shipped app while its failure mode — a short registry
 * hiding the one control a reader scanning it wants — is not. Of the two, the
 * hidden field is the worse failure, and the surface this grid was modelled on
 * (`mcp-management-section.tsx`) renders its field with the list as well.
 */

import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Search, X } from "lucide-react";
import type { FC } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { ProviderDetail } from "./provider-detail";
import {
	providerLoadErrorMessage,
	providerMethodLabel,
	providerReadiness,
} from "./provider-labels";

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
const RECOMMENDED_PROVIDER_ID = "radient";

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
 * reading of its three flags: the cue stops exactly where the badge changes its
 * mind. That matters on both surfaces this grid renders on -- "Recommended" over
 * a credential the reader already holds, above a sentence promising a sign-in
 * they have already done, argues for a decision they have made (UX round 1, U3;
 * code round 1, R1-6). The promoted row is neither local nor credential-free, so
 * for it the two groups that matter here are "Ready to use" and "Needs sign-in".
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
	const searchRef = useRef<HTMLInputElement>(null);
	const cardRefs = useRef(new Map<string, HTMLButtonElement | null>());

	const rows = useMemo(() => providers.data ?? [], [providers.data]);
	/*
	 * The promotion, decided once and used twice: `recommended` is the row the
	 * suggestion is about (null once it is signed in, or when the census does not
	 * carry it), the CUE is that row's identity wherever it appears in the list,
	 * and the PIN is `visibleProviders` acting on it for an unfiltered list.
	 */
	const recommended = useMemo(() => recommendedProvider(rows), [rows]);
	const recommendedId = recommended?.id ?? null;
	const ordered = useMemo(
		() => visibleProviders(rows, query, recommendedId),
		[rows, query, recommendedId],
	);

	/*
	 * Where focus goes when the control that held it unmounts.
	 *
	 * Radix's focus scope parks focus on the dialog container when the focused
	 * element disappears, so a keyboard user who opens a provider and comes back
	 * is returned to the TOP of the dialog: measured, 7-8 Tab presses to get back
	 * to the field or the card they came from (UX round 1, U1), with `Clear
	 * search` failing the same way (U4). The grid knows which row the reader was
	 * on -- `selectedId` is in its own state -- so it hands focus back itself
	 * rather than leaving it to the focus scope. The fallback is the search field,
	 * which is the other control the reader could have been using and the one the
	 * list is filtered by.
	 */
	const [focusRow, setFocusRow] = useState<string | null>(null);
	useEffect(() => {
		if (selectedId !== null || focusRow === null) return;
		const target = cardRefs.current.get(focusRow) ?? searchRef.current;
		setFocusRow(null);
		target?.focus();
	}, [selectedId, focusRow]);

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

	const selected = rows.find((provider) => provider.id === selectedId) ?? null;

	if (selected) {
		return (
			<div className="flex flex-col gap-4">
				<div className="flex items-center gap-3">
					<Button
						variant="ghost"
						size="sm"
						onClick={() => {
							/*
							 * Name the row on the way out: the card that opened this view is the
							 * one the reader comes back to, and the effect above hands focus to it
							 * once the list is mounted again.
							 */
							setFocusRow(selectedId);
							setSelectedId(null);
						}}
					>
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
			{/*
			 * Rendered with the list, never gated on its length (see this file's
			 * header). `sr-only`-style hiding is deliberately not used as a middle
			 * way: a field a reader cannot see is a field they cannot use, and the
			 * keyboard path to it would still be a tab stop that looks like nothing.
			 *
			 * Nothing here binds a key of its own. The dialog that hosts this step
			 * focuses its own body on open so the arrow keys scroll it
			 * (`onboarding-dialog.tsx`), and a global shortcut on this field -- `/`,
			 * which the composer already spends on slash commands -- would both
			 * fight that protocol and give one character two meanings in one app.
			 * The field is the first tab stop in the grid instead.
			 */}
			<div className="relative">
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

			{ordered.length === 0 ? (
				<div className="flex flex-col items-center gap-2 py-6 text-center">
					<p className="text-body-sm text-ink-muted">
						No providers match this search.
					</p>
					{/* An empty result is a dead end of the user's own making; Clear
					    search restores the list rather than re-asking the backend -- and
					    hands the field back, because a reader who cleared a query is a
					    reader about to type another one. Without that, Radix's focus
					    scope takes the unmounted button's focus to the dialog container and
					    the field is 7 Tab presses away (UX round 1, U4). */}
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
				<ul
					/*
					 * A hook for a HARNESS rather than for the app, in the same family as
					 * `[data-onboarding-modal]` in `onboarding-dialog.tsx`. The provider-setup
					 * stories measure this element -- its container width, the column count the
					 * browser resolved, and any scroll it carries -- and print the numbers
					 * beside the frame. Nothing styles or sizes it.
					 */
					data-provider-grid=""
					/*
					 * COLUMNS FROM THE CONTAINER, not from the window.
					 *
					 * This grid ships in two boxes of different widths -- the Settings
					 * column (896px, `max-w-4xl`) and the onboarding dialog's own body --
					 * and the old `grid-cols-1 sm:grid-cols-2` asked the WINDOW how wide
					 * they were, so both surfaces got two columns at every window size and
					 * the wider dialog would have gained nothing. `auto-fill` with a
					 * 17.5rem floor is the same rule `agent-hub-page.tsx` uses for its own
					 * card grid, and it resolves to three columns at 896px, two below
					 * ~572px and one when the box is narrower than a card.
					 *
					 * `min(17.5rem, 100%)` rather than a bare floor is what keeps the
					 * narrowest case from overflowing: a track can never be asked for more
					 * room than its own container has, so a 250px box renders one 250px
					 * card rather than a 280px card and a horizontal scrollbar.
					 */
					className="grid grid-cols-[repeat(auto-fill,minmax(min(17.5rem,100%),1fr))] gap-3"
				>
					{ordered.map((provider) => {
						const readiness = providerReadiness(provider);
						const isRecommended = showsRecommendedCue(
							provider.id,
							recommendedId,
						);
						return (
							/*
							 * The row's own id, so a rig can point at ONE card: the promoted
							 * card's hover and focus states are evidence a selector has to name,
							 * not a position it has to count to.
							 */
							<li key={provider.id} data-provider-id={provider.id}>
								<button
									type="button"
									ref={(element) => {
										/*
										 * Kept so the list can hand focus back to the card the reader came
										 * from; see `focusRow` above. A row that leaves the filtered list
										 * unmounts and clears its own entry, which is what makes the
										 * fallback real rather than defensive.
										 */
										cardRefs.current.set(provider.id, element);
									}}
									onClick={() => setSelectedId(provider.id)}
									className={cn(
										/*
										 * A card is a FRAME, so it takes the frame radius. The radius it
										 * used to carry was `rounded-md`, which is 10px on this tree (the
										 * step `styles/index.css` gives the tabs track), not the 6px a
										 * control takes -- so this is a fix rather than a preference:
										 * `rounded-lg` is 14px, the step branding § 5 assigns to cards.
										 * The boundary stays `border-control` and not `hairline`: it is
										 * the card's only edge and the entire card is the control.
										 *
										 * `h-full` because the cards in a row are one set: a row is as tall
										 * as its tallest card -- the promoted one, which carries a reason
										 * line -- and without it the neighbours would end their own boxes
										 * early and the row would read as three cards of three heights.
										 * The grid supplies the equal height; this is what lets the
										 * button inside it accept it.
										 *
										 * THE COST OF THAT, NAMED RATHER THAN LEFT AS A SIDE EFFECT
										 * (design round 1, D2): the promoted row measures 134px against
										 * 105-107px for every other row, and the two plain cards beside it
										 * carry the difference as ~40px of empty space under their method
										 * line instead of the 14px a row-2 card has. One taller card and
										 * two generously-spaced neighbours is the deliberate trade: the
										 * alternatives are a ragged first row (worse, and it is the defect
										 * the four-line composition exists to avoid) or folding the reason
										 * into the method line, which wraps at 290px and costs the same
										 * height anyway.
										 */
										"flex h-full w-full flex-col gap-2 rounded-lg border border-control bg-surface p-4 text-left",
										"transition-colors duration-base ease-out-quart hover:bg-row-hover",
									)}
								>
									{/*
									 * Name above badge, always, with the promotion cue
									 * joining the NAME's row -- and the history here is
									 * why it may.
									 *
									 * The name and the badge used to share one row with
									 * `justify-between`; the badge is `shrink-0
									 * whitespace-nowrap` by contract and the name had no
									 * `min-w-0`, so on a ~230px card (two columns in
									 * the 560px dialog) the two fought for the line -- the
									 * name ran under the badge and the badge clipped at
									 * the card edge. Wrapping only when needed left a grid
									 * where neighbouring cards differed in layout, so every
									 * card stacks the same way and the columns stay
									 * aligned. 4px between the rows is the
									 * within-component tier; the 8px card gap separates
									 * the method line.
									 *
									 * The cue is not that badge. It is a word on the name's
									 * own baseline, wrapping under the name if it ever has
									 * to, so the collision the note above describes cannot
									 * come back: the two elements that fought were a
									 * wrapping NAME and a nowrap BADGE in one line, and
									 * this is two wrapping pieces of text in a `flex-wrap`
									 * row sized to the promoted card alone.
									 */}
									<span className="flex flex-col items-start gap-1">
										<span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
											<span className="min-w-0 text-body text-ink">
												{provider.name}
											</span>
											{isRecommended && (
												<>
													{/*
													 * The cue, in the register this app already uses
													 * for "this option is the one we suggest": WORDS at
													 * `ink` and `font-medium`, not a coloured chip.
													 * `ask-options.tsx` is the precedent, and the reasoning
													 * there holds here: the accent is already spent on this
													 * screen's primary action and on its own progress track,
													 * and § 2's budget is three spends per screen.
													 */}
													{/*
													 * The `·` is what keeps the row from reading as one
													 * string: the name and the cue share a baseline and an
													 * ink, so without a separator the line is read as
													 * "Radient Recommended" (design round 1, D5). It is
													 * the app's own separator, from the transcript's
													 * `never sent · N composed`; `aria-hidden` because a
													 * screen reader announcing a punctuation mark would
													 * read it as content.
													 */}
													<span
														aria-hidden="true"
														className="shrink-0 text-ink-dim text-meta"
													>
														·
													</span>
													<span className="shrink-0 font-medium text-ink text-meta">
														Recommended
													</span>
												</>
											)}
										</span>
										{/* States the credential fact, which this census actually
									    knows. It used to render `configured` as "Connected",
									    asserting a reachability nothing had checked. */}
										<Badge variant={readiness.tone} title={readiness.detail}>
											{readiness.label}
										</Badge>
										{/*
										 * The reason the promoted card is promoted: the line
										 * after the credential fact, before the method.
										 *
										 * It used to sit last at `ink-muted`, which made it the
										 * card's second-loudest stop -- above the two facts the
										 * card exists to state -- and put the justification below
										 * the method line it was arguing for (design round 1, D3;
										 * UX round 1, U7). It is `ink-dim` now, the method
										 * line's own register, and above it: state, then why,
										 * then how.
										 */}
										{isRecommended && (
											<span className="text-ink-dim text-meta">
												{RECOMMENDED_REASON}
											</span>
										)}
									</span>
									<span className="text-meta text-ink-dim">
										{providerMethodLabel(provider.auth_methods, provider.local)}
									</span>
								</button>
							</li>
						);
					})}
				</ul>
			)}
		</div>
	);
};
