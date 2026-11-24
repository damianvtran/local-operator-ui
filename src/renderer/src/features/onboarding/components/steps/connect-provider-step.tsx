/**
 * Connect Provider Step - "Sign in to get started" (stage refresh, spec § 5.1)
 *
 * ## Why it is shaped like this
 *
 * The operator's three complaints about the old step, each answered here:
 *
 * 1. "It's not immediately clear which they should pick." Four identical card
 *    rows made every option look equal. Now there is ONE luminous primary
 *    (Continue with Radient) in a glass panel that says why, a quieter pair for
 *    the subscriptions people already pay for, and everything else folded away.
 * 2. "It still says use your own API keys for signing in with other providers,
 *    but those are not API keys, they are signing in with subscriptions." The
 *    ChatGPT / Claude buttons say "Log in with ...", the divider says "or log in
 *    with your subscription", and API keys live only behind "Other ways to
 *    connect", under their own "Paste an API key" heading.
 * 3. "Sign in to multiple or continue, with a recommendation to still sign up
 *    with Radient in addition." Every source can be connected in turn; each
 *    becomes a connected row in its own slot, and while only subscriptions are
 *    connected the Radient panel stays first with a nudge saying what it adds.
 *
 * ## How a sign-in runs
 *
 * Pressing a button opens the existing `ProviderDetail` for that provider in a
 * well directly under it, with `autoStart`, so the one press starts the browser
 * sign-in and the well carries the waiting copy, "Open again", the link and
 * Cancel. One sign-in at a time: starting another closes the first well (the
 * backend supersedes the operation, `SUPERSEDED_MESSAGE`). Nothing here owns a
 * flow; the per-provider sessions in `sign-in-sessions.ts` do.
 *
 * The step never lets a user continue into nothing: the modal's footer shows
 * Continue only once the census reports a connected provider.
 */

import {
	RECOMMENDED_PROVIDER_ID,
	accountNameOf,
	isConnectedRow,
	monogramOf,
} from "@features/providers/provider-catalog";
import { ProviderDetail } from "@features/providers/provider-detail";
import { ProviderGrid } from "@features/providers/provider-grid";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Brain, CircleCheck, LifeBuoy, Search, Sparkles } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

/** The two subscriptions the stage offers as buttons, in display order. */
export const SUBSCRIPTION_PROVIDER_IDS = ["openai", "anthropic"] as const;

/**
 * Everything the stage draws itself; the "Other ways" grid excludes these, so
 * no row appears twice and Google lands in the API-key group (spec § 5.1).
 */
export const STAGE_PROVIDER_IDS = [
	RECOMMENDED_PROVIDER_ID,
	...SUBSCRIPTION_PROVIDER_IDS,
] as const;

/** Whether a census row counts as connected on this step. */
export const stageConnected = (provider: DesktopProvider | undefined) =>
	provider !== undefined && isConnectedRow(provider, null);

/**
 * The connected subscription brands, for the nudge and the subtitle. A list so
 * the caller can `Intl.ListFormat` it ("ChatGPT and Claude").
 */
export function connectedSubscriptionBrands(
	providers: readonly DesktopProvider[],
): string[] {
	return SUBSCRIPTION_PROVIDER_IDS.flatMap((id) => {
		const row = providers.find((provider) => provider.id === id);
		return row && stageConnected(row) ? [accountNameOf(row)] : [];
	});
}

type ConnectProviderStepProps = {
	/** The census (`useDesktopProviders`), owned by the modal. */
	providers: readonly DesktopProvider[] | undefined;
	isLoading: boolean;
	isError: boolean;
	onRetry: () => void;
	/** A panel's own success action ("Continue") moves straight to step 2. */
	onContinue?: () => void;
	/** The locale's list joiner, for "ChatGPT and Claude". */
	listFormat: (items: string[]) => string;
};

/** A source that is connected: same slot and height as the button it replaces. */
const ConnectedRow: FC<{ brand: string; animate: boolean }> = ({
	brand,
	animate,
}) => (
	<div
		className={cn(
			"flex h-10 items-center gap-2 rounded-sm px-3 text-body text-ink",
			animate && "onboarding-connected",
		)}
		data-stage-connected={brand}
	>
		<CircleCheck
			size={18}
			className="onboarding-check shrink-0 text-accent"
			aria-hidden="true"
		/>
		<span className="min-w-0 flex-1 truncate">{brand}</span>
		<span className="text-ink-dim text-meta">
			{t("ui.onboarding.signin.connected")}
		</span>
	</div>
);

/** The well a sign-in panel opens in: sunken, no border (spec § 5.1). */
const Well: FC<{ children: ReactNode }> = ({ children }) => (
	<div className="mt-2 rounded-[10px] bg-sunken p-4">{children}</div>
);

/** The 18px provider chip on a subscription button (the grid's monogram). */
const Chip: FC<{ brand: string }> = ({ brand }) => (
	<span
		aria-hidden="true"
		className="grid size-[18px] shrink-0 place-items-center rounded-[4px] bg-elevated font-medium text-[9px] text-ink leading-none"
	>
		{monogramOf(brand)}
	</span>
);

const BENEFITS = [
	{ key: "ui.onboarding.signin.radient.benefit.skills", icon: Sparkles },
	{ key: "ui.onboarding.signin.radient.benefit.search", icon: Search },
	{ key: "ui.onboarding.signin.radient.benefit.fallbacks", icon: LifeBuoy },
	{ key: "ui.onboarding.signin.radient.benefit.routing", icon: Brain },
] as const;

export const ConnectProviderStep: FC<ConnectProviderStepProps> = ({
	providers,
	isLoading,
	isError,
	onRetry,
	onContinue,
	listFormat,
}) => {
	const rows = providers ?? [];
	const byId = (id: string) => rows.find((provider) => provider.id === id);
	const radient = byId(RECOMMENDED_PROVIDER_ID);
	const radientOn = stageConnected(radient);
	const brands = connectedSubscriptionBrands(rows);
	/** The provider whose sign-in well is open; one at a time. */
	const [active, setActive] = useState<string | null>(null);
	/** Whether that sign-in is waiting on the browser (from the panel's flow). */
	const [waiting, setWaiting] = useState(false);
	/** A polite sentence for the live region when a source connects. */
	const [announcement, setAnnouncement] = useState("");
	/** Ids that connected WHILE this step was showing: those rows animate in. */
	const [justConnected, setJustConnected] = useState<Set<string>>(new Set());
	const seen = useRef<Set<string> | null>(null);

	const connectedIds = rows
		.filter((provider) => stageConnected(provider))
		.map((provider) => provider.id)
		.join(",");
	// `connectedIds` is the census's connected set as a stable string; `rows` is
	// read for the brand only, and a new array every render would re-run this.
	// biome-ignore lint/correctness/useExhaustiveDependencies: see above.
	useEffect(() => {
		const now = new Set(connectedIds ? connectedIds.split(",") : []);
		if (seen.current === null) {
			// The first census is the starting state, not news.
			if (!isLoading) seen.current = now;
			return;
		}
		const fresh = [...now].filter((id) => !seen.current?.has(id));
		seen.current = now;
		if (fresh.length === 0) return;
		const row = rows.find((provider) => provider.id === fresh[0]);
		if (row) {
			setAnnouncement(
				t("ui.onboarding.signin.announce_connected", {
					brand: accountNameOf(row),
				}),
			);
		}
		setJustConnected((prev) => new Set([...prev, ...fresh]));
		// The sign-in that connected is done: its well closes onto the row.
		setActive((current) =>
			current && fresh.includes(current) ? null : current,
		);
	}, [connectedIds, isLoading]);

	const start = (id: string) => {
		setWaiting(false);
		setActive((current) => (current === id ? null : id));
	};

	if (isError) {
		return (
			<div className="flex flex-col items-center gap-3 text-center">
				<p className="text-body text-ink">
					{t("ui.onboarding.signin.error.title")}
				</p>
				<p className="text-body-sm text-ink-muted">
					{t("ui.onboarding.signin.error.detail")}
				</p>
				<Button variant="secondary" size="md" onClick={onRetry}>
					{t("ui.onboarding.signin.error.retry")}
				</Button>
			</div>
		);
	}

	const panelFor = (provider: DesktopProvider) => (
		<Well>
			<ProviderDetail
				provider={provider}
				context="dialog"
				autoStart
				onDone={onContinue}
				onChangeModel={onContinue}
				onFlowPhase={(phase) => {
					setWaiting(phase === "starting" || phase === "active");
					// Cancel inside the panel returns the flow to idle: close the well.
					if (phase === "idle") setActive(null);
				}}
			/>
		</Well>
	);

	const radientEyebrow = radientOn
		? t("ui.onboarding.signin.radient.eyebrow_signed_in")
		: brands.length > 0
			? t("ui.onboarding.signin.radient.eyebrow_in_addition")
			: t("ui.onboarding.signin.radient.eyebrow");

	const radientWaiting = active === RECOMMENDED_PROVIDER_ID && waiting;

	return (
		<div className="flex flex-col">
			<p className="sr-only" aria-live="polite">
				{announcement}
			</p>
			{radient ? (
				<section
					className="onboarding-glass flex flex-col p-5"
					aria-labelledby="onboarding-radient-eyebrow"
					data-stage-radient=""
				>
					<p
						id="onboarding-radient-eyebrow"
						className="font-medium text-accent text-meta"
					>
						{radientEyebrow}
					</p>
					<div className="mt-2">
						{radientOn ? (
							<ConnectedRow
								brand={accountNameOf(radient)}
								animate={justConnected.has(radient.id)}
							/>
						) : (
							<Button
								/*
								 * The page's one luminous primary - until a subscription is
								 * connected, when the footer's Continue becomes the primary and
								 * this steps down to `tonal` "Add Radient" (spec § 5.1).
								 */
								variant={brands.length > 0 ? "tonal" : "primary"}
								size="lg"
								className={cn(
									"w-full",
									brands.length === 0 && "onboarding-luminous",
								)}
								disabled={isLoading}
								aria-busy={isLoading || radientWaiting || undefined}
								aria-expanded={active === RECOMMENDED_PROVIDER_ID}
								onClick={() => start(RECOMMENDED_PROVIDER_ID)}
							>
								{radientWaiting ? <Spinner size="sm" /> : null}
								{radientWaiting
									? t("ui.onboarding.signin.waiting")
									: brands.length > 0
										? t("ui.onboarding.signin.radient.action_add")
										: t("ui.onboarding.signin.radient.action")}
							</Button>
						)}
						{active === RECOMMENDED_PROVIDER_ID && !radientOn
							? panelFor(radient)
							: null}
					</div>
					<ul className="mt-4 grid grid-cols-[repeat(auto-fit,minmax(12rem,1fr))] gap-x-6 gap-y-2.5">
						{BENEFITS.map(({ key, icon: Icon }) => (
							<li
								key={key}
								className="flex items-center gap-2 text-body-sm text-ink-muted"
							>
								<Icon
									size={14}
									className="shrink-0 text-accent-alt"
									aria-hidden="true"
								/>
								{t(key)}
							</li>
						))}
					</ul>
					{!radientOn && brands.length > 0 ? (
						<p className="mt-3 text-body-sm text-ink-muted">
							{t("ui.onboarding.signin.radient.nudge", {
								brands: listFormat(brands),
							})}
						</p>
					) : null}
					{!radientOn ? (
						<p className="mt-2 text-ink-dim text-meta">
							{t("ui.onboarding.signin.radient.credit")}
						</p>
					) : null}
				</section>
			) : null}

			<div
				className="mt-6 flex items-center gap-3 text-ink-dim text-meta"
				aria-hidden="true"
			>
				<span className="h-px flex-1 bg-hairline" />
				{t("ui.onboarding.signin.divider")}
				<span className="h-px flex-1 bg-hairline" />
			</div>

			<div className="mt-3 grid grid-cols-[repeat(auto-fit,minmax(13rem,1fr))] gap-2">
				{SUBSCRIPTION_PROVIDER_IDS.map((id) => {
					const row = byId(id);
					if (!row) return null;
					const brand = accountNameOf(row);
					if (stageConnected(row)) {
						return (
							<ConnectedRow
								key={id}
								brand={brand}
								animate={justConnected.has(id)}
							/>
						);
					}
					const rowWaiting = active === id && waiting;
					return (
						<Button
							key={id}
							variant="secondary"
							size="lg"
							className="onboarding-secondary h-10 w-full justify-start"
							disabled={isLoading}
							aria-busy={isLoading || rowWaiting || undefined}
							aria-expanded={active === id}
							onClick={() => start(id)}
						>
							{rowWaiting ? <Spinner size="sm" /> : <Chip brand={brand} />}
							{rowWaiting
								? t("ui.onboarding.signin.waiting")
								: id === "openai"
									? t("ui.onboarding.signin.chatgpt.action")
									: t("ui.onboarding.signin.claude.action")}
						</Button>
					);
				})}
			</div>
			{SUBSCRIPTION_PROVIDER_IDS.map((id) => {
				const row = byId(id);
				return row && active === id && !stageConnected(row) ? (
					<div key={id}>{panelFor(row)}</div>
				) : null;
			})}
			<p className="mt-2 text-center text-ink-dim text-meta">
				{t("ui.onboarding.signin.subscriptions_note")}
			</p>

			<div className="mt-6 flex flex-col items-center">
				<Disclosure
					summary={
						<span className="text-body-sm text-ink-muted">
							{t("ui.onboarding.signin.more")}
							<span className="text-ink-dim">
								{" · "}
								{t("ui.onboarding.signin.more_detail")}
							</span>
						</span>
					}
					chevron="trailing"
					className="w-full"
					summaryAlign="center"
				>
					<div className="pt-3 text-start">
						<ProviderGrid
							context="dialog"
							featuredOnly
							restOnly
							exclude={STAGE_PROVIDER_IDS}
							onDone={onContinue}
							onChangeModel={onContinue}
						/>
					</div>
				</Disclosure>
			</div>
		</div>
	);
};
