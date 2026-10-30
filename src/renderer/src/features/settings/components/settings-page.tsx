import { openConversation } from "@features/chat/open-conversation";
import { formatDayBucket } from "@features/chat/pickers/panels/formatters";
import { parseTranscriptDisplayMode } from "@features/chat/transcript-display-mode";
import { useOnboardingTour } from "@features/onboarding/hooks/use-onboarding-tour";
import { ProviderGrid } from "@features/providers/provider-grid";
import { useProviderStatus } from "@features/providers/use-provider-status";
import { pairingCardCopy } from "@shared/api/local-operator/backend-error";
import type { ConfigUpdate } from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { PageHeader } from "@shared/components/common/page-header";
import { RadientMark } from "@shared/components/common/radient-mark";
import { Spinner } from "@shared/components/common/spinner";
import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Skeleton,
} from "@shared/components/ui";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useCreditBalance } from "@shared/hooks/use-credit-balance";
import { useElapsedSince } from "@shared/hooks/use-elapsed-since";
import { useModels } from "@shared/hooks/use-models";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import {
	isRadientAccountFailure,
	useRadientUserQuery,
} from "@shared/hooks/use-radient-user-query";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { useUsageRollup } from "@shared/hooks/use-usage-rollup";
import { useWindowGlass } from "@shared/hooks/use-window-glass";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { useUserStore } from "@shared/store/user-store";
import {
	formatCalendarDate,
	formatCalendarDateTime,
} from "@shared/utils/date-utils";
import { format, formatRFC3339, parseISO, subDays } from "date-fns";
import {
	ChartLine,
	CirclePlay,
	CirclePlus,
	Contrast,
	CreditCard,
	ExternalLink,
	Info,
	MessageSquare,
	Plug,
	Settings,
	SlidersHorizontal,
	User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { WindowGlassSetting } from "./window-glass-setting";

import {
	AgentMessagesSettings,
	useAgentMessagesSettingsAvailability,
} from "@features/agent-messages/agent-messages-settings";
import {
	agentMessagesSectionMounted,
	settingsRefusalSentence,
} from "@features/agent-messages/agent-messages-settings-model";
import { useAgentMessages } from "@features/agent-messages/use-agent-messages";
import { pressLandsOnOverlay } from "@features/chat/keyboard-scopes";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { LANGUAGE_SETTING_KEY } from "@shared/i18n";
import { useQuery } from "@tanstack/react-query";
import type { AgentMessagesStatus } from "../../../../../shared/agent-messages-contract";
import type { BackendSettings } from "../../../../../shared/desktop-contract";
import {
	MODEL_EFFORT_SETTING_KEY,
	TEAM_BRIDGE_ENABLED_SETTING_KEY,
	sectionForSettingKey,
} from "../promoted-setting-sections";
import {
	type SettingSearchEntry,
	buildRenderedEntries,
} from "../search/settings-search-index";
import {
	type SearchJumpOutcome,
	jumpToSearchRow,
	jumpToSearchSection,
} from "../search/settings-search-jump";
import { AppUpdatesSection } from "./app-updates-section";
import {
	BackendSettingsSection,
	backendSettingsKeys,
} from "./backend-settings-section";
import { DefaultEffortSelect } from "./default-effort-select";
import { ImportSettingsSection } from "./import-settings-section";
import { GeneralLanguageSetting } from "./language-dialog";

import { KeyboardShortcutsSection } from "./keyboard-shortcuts-section";
import { McpManagementSection } from "./mcp-management-section";
import { RadientAccountSection } from "./radient-account-section";
import {
	SettingsSearch,
	type SettingsSearchHandle,
	useSettingsSearchIndex,
} from "./settings-search";
import { InfoGrid, InfoItem, SettingsSection } from "./settings-section";
import { DEFAULT_SETTINGS_SECTIONS, SettingsSidebar } from "./settings-sidebar";
import { SettingsUsageChart } from "./settings-usage-chart";
import { SpeechSection } from "./speech-section";
import { SystemPrompt } from "./system-prompt";
import { ThemeSelector } from "./theme-selector";
import { TranscriptDisplayModeSetting } from "./transcript-display-mode-setting";

const BillingInfo: FC = () => {
	useI18nLocale();
	const {
		data: creditData,
		isLoading,
		error,
	} = useCreditBalance({ enabled: true });

	return (
		<div>
			{/*
			 * `h3`, not the shared `SectionTitle`: billing and usage are subsections
			 * of the Radient section's own `h2`, and `SectionTitle` renders an `h2`
			 * with no way to pick a level. A heading that lies about its depth is
			 * worse than four lines of markup.
			 */}
			<h3 className="mb-3 flex items-center gap-2 text-heading text-ink">
				<CreditCard size={16} className="shrink-0 text-ink-dim" />
				{t("ui.settings.account.settings_page.radient_pass")}
			</h3>
			{isLoading && <Skeleton className="h-6 w-36" />}
			{error && (
				<Alert variant="warning">
					{t("ui.settings.account.settings_page.credit_balance_load_failed", {
						reason: error.message,
					})}
				</Alert>
			)}
			{creditData && !isLoading && !error && (
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<p className="flex-1 text-body-sm text-ink-muted">
						{t("ui.settings.account.settings_page.available_credits")}{" "}
						<span className="font-medium text-ink">
							{creditData.balance.toFixed(2)}
						</span>
					</p>
					<Button variant="secondary" size="sm" asChild>
						<a
							href="https://console.radienthq.com/dashboard/billing"
							target="_blank"
							rel="noopener noreferrer"
						>
							<CirclePlus />
							{t("ui.settings.account.settings_page.add_credits")}
						</a>
					</Button>
				</div>
			)}
		</div>
	);
};

type UsageMetric = "credits" | "tokens";

const USAGE_METRICS: { id: UsageMetric; label: string }[] = [
	{
		id: "credits",
		get label() {
			return t("ui.settings.account.settings_page.credits");
		},
	},
	{
		id: "tokens",
		get label() {
			return t("ui.settings.account.settings_page.tokens");
		},
	},
];

/**
 * The usage chart's own tooltip used to live here, styling recharts' default
 * panel through literal-colour style objects. It moved to the chart frame's one
 * custom renderer, so the app has a single chart idiom rather than two — see
 * the note at the render site.
 */

const UsageInfo: FC = () => {
	useI18nLocale();
	const [dataType, setDataType] = useState<UsageMetric>("credits");

	const usageParams = useMemo(() => {
		const endDate = new Date();
		const startDate = subDays(endDate, 30);
		return {
			start_date: formatRFC3339(startDate),
			end_date: formatRFC3339(endDate),
			rollup: "daily" as const,
		};
	}, []);

	const {
		data: usageData,
		isLoading,
		error,
	} = useUsageRollup(usageParams, { enabled: true });

	const chartData = useMemo(() => {
		if (!usageData?.data_points) return [];
		const sortedDataPoints = [...usageData.data_points].sort(
			(a, b) =>
				parseISO(a.timestamp).getTime() - parseISO(b.timestamp).getTime(),
		);
		/*
		 * The frame plots one series of `{ bucket, value }`, so the METRIC picks the
		 * value here rather than a `dataKey` at the mark: one metric control, one
		 * series, and the axis and the tooltip cannot describe two different
		 * quantities.
		 */
		return sortedDataPoints.map((point) => ({
			/*
			 * The SHARED formatter rather than `date-fns`' own `MMM dd`: an axis day is
			 * the same quantity as a panel's day bucket, and one quantity gets one
			 * spelling ("Sep 7", never "Sep 07" — review round 1, N2). The formatter
			 * takes the ledger's `YYYY-MM-DD` bucket, so the wire's timestamp is
			 * reduced to its date first.
			 */
			bucket: formatDayBucket(format(parseISO(point.timestamp), "yyyy-MM-dd")),
			value:
				dataType === "credits"
					? Number.parseFloat(point.total_cost.toFixed(2))
					: point.total_tokens,
		}));
	}, [usageData, dataType]);

	return (
		<div>
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="flex items-center gap-2 text-heading text-ink">
					<ChartLine size={16} className="shrink-0 text-ink-dim" />
					{t("ui.settings.account.settings_page.usage_last_30_days")}
				</h3>
				{/*
				 * A segmented pair rather than `Tabs`: the two options change which
				 * series the one chart plots, they do not swap panels, and Radix's
				 * `TabsTrigger` would point `aria-controls` at a `TabsContent` that
				 * does not exist. `aria-pressed` describes what these actually are.
				 */}
				<fieldset className="m-0 w-fit border-0 p-0">
					<legend className="sr-only">
						{t("ui.settings.account.settings_page.usage_metric")}
					</legend>
					<div
						data-glass-well=""
						className="flex gap-0.5 rounded-md bg-sunken p-0.5"
					>
						{USAGE_METRICS.map(({ id, label }) => (
							<Button
								key={id}
								variant="ghost"
								size="sm"
								aria-pressed={dataType === id}
								onClick={() => setDataType(id)}
								className={cn(
									dataType === id && "bg-surface text-ink hover:bg-surface",
								)}
							>
								{label}
							</Button>
						))}
					</div>
				</fieldset>
			</div>

			{isLoading && <Skeleton className="h-62 w-full" />}
			{error && (
				<Alert variant="warning">
					{t("ui.settings.account.settings_page.usage_load_failed", {
						reason: error.message,
					})}
				</Alert>
			)}
			{!isLoading && !error && usageData && chartData.length > 0 && (
				/*
				 * The chart's one idiom lives in `ChartFrame` (the panel primitives),
				 * which owns the descendant-selector theming, the axes, the grid and the
				 * custom tooltip. Styling recharts here instead — through colour props that
				 * land as SVG presentation attributes and cannot take a `var()`, or through
				 * a second copy of these selectors — is the two-wrappers defect that
				 * migration exists to remove: with twelve themes, two copies are kept in
				 * step by hand.
				 *
				 * `title=""` because this section already has a heading row, and that row
				 * carries the metric toggle the frame has no slot for.
				 */
				<SettingsUsageChart metric={dataType} data={chartData} />
			)}
			{!isLoading && !error && (!usageData || chartData.length === 0) && (
				<p className="text-body-sm text-ink-muted">
					{t(
						"ui.settings.account.settings_page.no_usage_recorded_in_the_last_30_days",
					)}
				</p>
			)}
		</div>
	);
};

/**
 * The Radient section's heading, which carries the console link beside the
 * title. Supplied through `titleComponent` because the link belongs to the
 * heading row, not to the section body.
 *
 * It matches `SettingsSection`'s own heading exactly — `text-heading`, a 16px
 * mark, `gap-2`. It used to be `text-title` with a 32px logo, so one section on
 * the page shouted a step louder than its five siblings and the eye read the
 * page as having two levels of grouping where it has one. A brand mark is not
 * a reason to leave the type scale.
 */
const RadientSectionTitle: FC = () => {
	useI18nLocale();
	return (
		<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
			<h2 className="flex items-center gap-2 text-heading text-ink">
				<RadientMark size={16} className="shrink-0 text-ink-dim" />
				{t("ui.settings.account.settings_page.radient_account")}
			</h2>
			<Button
				variant="secondary"
				size="sm"
				className="self-start sm:self-center"
				asChild
			>
				<a
					href="https://console.radienthq.com"
					target="_blank"
					rel="noopener noreferrer"
				>
					{t("ui.settings.account.settings_page.go_to_radient_console")}
					<ExternalLink />
				</a>
			</Button>
		</div>
	);
};

export const SettingsPage: FC = () => {
	/*
	 * SUBSCRIBE to the i18n locale, or a language switch would not repaint this
	 * page. `t()` is a plain function read at call time - it does not subscribe -
	 * so a component that calls it must also read the store through
	 * `useI18nLocale()` for React to re-render it when the locale changes (the
	 * pattern every other t() consumer here uses). Without this line the header
	 * and section copy would keep the OLD language until an unrelated repaint,
	 * which is half the bug this PR fixes. The value is unused on purpose: the
	 * subscription is the point, and the t() calls below read the store directly.
	 */
	useI18nLocale();
	const glass = useWindowGlass();
	const showAgentReasoning = useUiPreferencesStore(
		(state) => state.showAgentReasoning,
	);
	const setShowAgentReasoning = useUiPreferencesStore(
		(state) => state.setShowAgentReasoning,
	);
	/*
	 * The transcript display mode (issue #756): read raw and parsed on the way to
	 * the control, so a token this build does not know renders as the default mode
	 * rather than as no selection (the read-side rule `parseSidebarView` sets).
	 */
	const transcriptDisplayMode = useUiPreferencesStore(
		(state) => state.transcriptDisplayMode,
	);
	const setTranscriptDisplayMode = useUiPreferencesStore(
		(state) => state.setTranscriptDisplayMode,
	);
	const {
		data: config,
		isLoading: isConfigLoading,
		isFetching: isConfigFetching,
		error: configError,
		refetch,
	} = useConfig();
	/*
	 * Whether the contract below is worth showing at all. `needsProvider` is true
	 * only when the answer is KNOWN - the provider census answered, no cloud
	 * provider has a credential, and no default is configured - so the callout
	 * never nags over a read this app could not complete. It reads the CENSUS and
	 * the configured default, never keys in config: a provider signed in through
	 * its own login is connected without any key of the user's.
	 */
	const { needsProvider } = useProviderStatus();

	/*
	 * THE CAUSE BEFORE THE SENTENCE, and at a top-level hook site rather than inside
	 * the error branch: a hook called inside `if (configError)` changes the hook count
	 * between renders, which is the crash review round 4 found on this card's sibling.
	 * The words and the control both come from `pairingCardCopy`, the one authority the
	 * Backend section's card also calls (Q-6 / UX U2): over a governed or pre-handshake
	 * daemon the server IS answering, and this card used to call it silent while two
	 * bands on the same screen named who holds the plane.
	 */
	const pairingCause = usePairingCause();
	const { sentence: loadErrorSentence, remedy: loadErrorRemedy } =
		pairingCardCopy(
			/* `?? null`: no answer yet keeps the fallback branch, as no cause does (the hook's three states). */
			pairingCause ?? null,
			t(
				"ui.settings.navigation.settings_page.your_settings_could_not_be_loaded",
			),
			configError,
		);
	const updateConfigMutation = useUpdateConfig();
	const [savingField, setSavingField] = useState<string | null>(null);
	const userStore = useUserStore();
	// The Radient account read, and deliberately only three things from it.
	//
	// `isAuthenticated` is the fact this page needs: the profile fields go
	// read-only when the backend resolves a Radient account, and the billing and
	// usage blocks render under it. The query hook is the backend-proxy source
	// of that fact; the wrapper hook additionally syncs the user store, which
	// this page does not need.
	//
	// `accountRead` and `refreshUser` are here because the FAILURE of this read is
	// a state the page has to say out loud: the profile fields render the user
	// store's own copy, whose default is the literal name "User", so a refused
	// read is otherwise indistinguishable from a person who has not set a name --
	// and an UNANSWERED read renders the same placeholder, which is the state the
	// report came from.
	//
	// The hook's own `isLoading` is deliberately NOT read as a gate: it is what
	// held this whole surface (see the gate below). The classification it feeds is
	// read instead, which keeps "not answered yet" separate from "answered with
	// nothing" -- the two this page's fields used to render identically.
	const {
		isAuthenticated,
		accountRead,
		isFetching: isAccountFetching,
		isRefreshing: isAccountRefreshing,
		refreshUser,
	} = useRadientUserQuery();
	const activeSessionId = useCanonicalSessionsStore(
		(state) => state.activeSessionId,
	);
	// The CoS designation's options are the REAL canonical store, never a
	// synthetic list; the section renders this same array.
	const canonicalSessions = useCanonicalSessionsStore(
		(state) => state.sessions,
	);
	/*
	 * Agent messages is the one settings section whose existence is a server
	 * decision (RFC §5.6). The hook subscribes to the shared status model and
	 * latches the last observable answer; `status` is held across a forced
	 * refresh so an action's re-read does not unmount the section mid-write.
	 */
	const agentMessagesAvailability = useAgentMessagesSettingsAvailability();
	const {
		accountId: agentMessagesAccountId,
		snapshot: agentMessagesSnapshot,
		model: agentMessagesModel,
	} = useAgentMessages();
	/*
	 * The held status is scoped to the account it belongs to. A sign-in switch
	 * must not leave the previous account's state rendering under the new
	 * account's writes (round-1 R2), and a failed read must not resurrect it:
	 * the page's error branch is the retry surface.
	 */
	const heldAgentMessagesStatus = useRef<{
		accountId: string | null;
		status: AgentMessagesStatus;
	} | null>(null);
	if (agentMessagesSnapshot.status) {
		heldAgentMessagesStatus.current = {
			accountId: agentMessagesAccountId,
			status: agentMessagesSnapshot.status,
		};
	} else if (!agentMessagesSnapshot.checking) {
		heldAgentMessagesStatus.current = null;
	}
	const agentMessagesStatus =
		agentMessagesSnapshot.status ??
		(heldAgentMessagesStatus.current?.accountId === agentMessagesAccountId
			? heldAgentMessagesStatus.current.status
			: null);
	const agentMessagesSectionVisible = agentMessagesSectionMounted(
		agentMessagesAvailability,
		agentMessagesStatus,
	);
	const settingsSections = useMemo(
		() =>
			DEFAULT_SETTINGS_SECTIONS.filter(
				(section) =>
					section.id !== "agent-messages" ||
					agentMessagesAvailability !== "absent",
			),
		[agentMessagesAvailability],
	);
	const refreshAgentMessages = useCallback(
		() => agentMessagesModel.check("surface_open", true),
		[agentMessagesModel],
	);
	const [activeSection, setActiveSection] = useState<string>("general");
	const [isScrolling, setIsScrolling] = useState(false);
	const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const contentContainerRef = useRef<HTMLDivElement>(null);

	const { startTour: startOnboardingTour } = useOnboardingTour();
	const location = useLocation();
	const navigate = useNavigate();

	const { data: credentialsData, refetch: refetchCredentials } =
		useCredentials();
	const { refreshModels } = useModels();

	// Memoize the credential keys to avoid unnecessary effect triggers
	const credentialKeys = useMemo(
		() => (credentialsData?.keys ? [...credentialsData.keys].sort() : []),
		[credentialsData?.keys],
	);

	// Only refresh models if credential keys or hosting have actually changed
	const lastRefreshRef = useRef<{ keys: string; hosting: string | undefined }>({
		keys: "",
		hosting: undefined,
	});
	useEffect(() => {
		const keysString = credentialKeys.join(",");
		const hosting = config?.values?.hosting;
		if (
			lastRefreshRef.current.keys !== keysString ||
			lastRefreshRef.current.hosting !== hosting
		) {
			lastRefreshRef.current = { keys: keysString, hosting };
			refreshModels().catch((err) => {
				console.error(
					"Failed to refresh models after credentials or hosting change:",
					err,
				);
			});
		}
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [credentialKeys, config?.values?.hosting, refreshModels]);

	// Refs for scrolling to sections
	const sectionRefs = useRef<Record<string, RefObject<HTMLDivElement>>>({
		general: useRef<HTMLDivElement>(null),
		radient: useRef<HTMLDivElement>(null),
		integrations: useRef<HTMLDivElement>(null),
		appearance: useRef<HTMLDivElement>(null),
		speech: useRef<HTMLDivElement>(null),
		keyboard: useRef<HTMLDivElement>(null),
		providers: useRef<HTMLDivElement>(null),
		"agent-messages": useRef<HTMLDivElement>(null),
		backend: useRef<HTMLDivElement>(null),
		imports: useRef<HTMLDivElement>(null),
		updates: useRef<HTMLDivElement>(null),
	}).current;

	// A /settings deep link carries either ?section= for one of the sidebar
	// sections or ?setting=<key> to reveal and focus one registry row inside
	// the searchable backend settings section.
	//
	// A ?setting= link normally lives inside the backend settings section, but a
	// key whose control the page has PROMOTED out of that section has to resolve
	// to where its control actually is — see `promoted-setting-sections.ts`, the
	// one place that decision lives (the palette's per-key hint reads the same
	// map, so the two cannot disagree).
	const settingFocusKey = useMemo(() => {
		const params = new URLSearchParams(location.search);
		return params.get("setting");
	}, [location.search]);
	const settingsSearchFilter = useMemo(() => {
		const params = new URLSearchParams(location.search);
		return params.get("filter") ?? "";
	}, [location.search]);
	// `/mcp <argument>` deep-links to one configured server. The picker has always
	// emitted this; nothing read it until now.
	//
	// The ARGUMENT is passed through verbatim — `/mcp reauth hubspot` arrives as
	// `"reauth hubspot"` — because resolving it needs the configured server list,
	// which the section that reads it already has. Resolving here would mean a
	// second reader of the same list, and the renderer holds no copy of the
	// backend's subcommand vocabulary by design.
	const mcpTarget = useMemo(() => {
		const params = new URLSearchParams(location.search);
		return params.get("mcp") ?? undefined;
	}, [location.search]);
	// `/login <provider>` deep-links straight into that provider's methods.
	const providerFromQuery = useMemo(() => {
		const params = new URLSearchParams(location.search);
		return params.get("provider");
	}, [location.search]);

	// Handle section selection from sidebar
	const handleSelectSection = useCallback(
		(sectionId: string) => {
			setActiveSection(sectionId); // Update state immediately for visual feedback
			setIsScrolling(true); // Prevent scroll listener from interfering

			const ref = sectionRefs[sectionId];
			const contentContainer = contentContainerRef.current;

			if (ref?.current && contentContainer) {
				// Two separate defects lived in the old
				// `contentContainer.scrollTo(ref.current.offsetTop - 80)`:
				//
				// 1. `offsetTop` is relative to the nearest POSITIONED ancestor,
				//    not to the scroll container, so it reported a section's offset
				//    inside the centred content wrapper -- a number tens of pixels
				//    from zero for sections that sit screens down the page.
				// 2. It assumed this container is the scroller. Which element
				//    actually scrolls depends on how the shell is sized, and when
				//    it is the window instead, scrolling the div is a silent no-op.
				//
				// Together they are why every deep link, and even a plain sidebar
				// click, stopped on User profile (UX U3).
				//
				// Whichever element is actually the scroller gets scrolled.
				//
				// The content div carries `overflow-y-auto` and is the scroller in
				// the packaged app, where the shell's `h-screen` gives it a bounded
				// height. That is not guaranteed: if the height chain is not
				// bounded the div grows to fit its content and the DOCUMENT scrolls
				// instead, and a scroll aimed at the div is then a silent no-op.
				//
				// So: measure the distance once, and move whichever box can move.
				// This also replaces the original `offsetTop` read, which was
				// relative to the centred content wrapper rather than to the
				// scroller and so under-reported every section's position -- the
				// two together are why deep links stopped on User profile (UX U3).
				const HEADER_ROOM = 80;
				const delta =
					ref.current.getBoundingClientRect().top -
					contentContainer.getBoundingClientRect().top;
				const containerScrolls =
					contentContainer.scrollHeight > contentContainer.clientHeight;

				if (containerScrolls) {
					contentContainer.scrollTo({
						top: Math.max(0, contentContainer.scrollTop + delta - HEADER_ROOM),
						behavior: "smooth",
					});
				} else {
					window.scrollTo({
						top: Math.max(
							0,
							ref.current.getBoundingClientRect().top +
								window.scrollY -
								HEADER_ROOM,
						),
						behavior: "smooth",
					});
				}

				// No guard: clearing is a no-op on a missing handle. `?? undefined`
				// only because the Node timer types accept `undefined` and not `null`.
				clearTimeout(scrollTimeoutRef.current ?? undefined);

				// Set a timeout to re-enable scroll listening after the smooth scroll finishes
				scrollTimeoutRef.current = setTimeout(() => {
					setIsScrolling(false);
					scrollTimeoutRef.current = null;
				}, 800); // Slightly longer timeout to ensure smooth scroll completes
			} else {
				// Fallback if container or ref not found
				setIsScrolling(false);
			}
		},
		[sectionRefs],
	);

	/*
	 * SETTINGS SEARCH (issue #1492): the page's OWN field, in the header's
	 * action slot.
	 *
	 * It shares the Backend section's `settings.list` cache entry — same query
	 * key, same op — so the registry half of the index costs no request. The
	 * index itself is memoised on that payload's identity and the locale; a
	 * keystroke changes state inside `SettingsSearch` only, which is what keeps
	 * a query from re-rendering the eleven sections below.
	 */
	const searchRef = useRef<SettingsSearchHandle>(null);
	/*
	 * WHAT THE READER WAS LOOKING AT, before ⌘F moved them.
	 *
	 * Focusing the header's field scrolls the content container to bring it into
	 * view, so a press from 2000px down threw the page to the top and nothing put
	 * it back (UX round 1, U5). The position is remembered when the shortcut
	 * fires and restored when the panel closes WITHOUT a jump; a jump clears it,
	 * because a landing is the scroll the reader asked for.
	 */
	const savedSearchScrollRef = useRef<number | null>(null);
	const capabilities = useDesktopCapabilities();
	const settingsFeatureEnabled = desktopFeatureEnabled(
		capabilities.data,
		"settings",
	);
	const settingsRegistryQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: settingsFeatureEnabled,
		staleTime: 10_000,
	});
	const searchIndex = useSettingsSearchIndex({
		registry: settingsRegistryQuery.data,
		sections: settingsSections,
	});
	const readRenderedSearchRows = useCallback(
		() =>
			contentContainerRef.current
				? buildRenderedEntries(contentContainerRef.current)
				: [],
		[],
	);
	/*
	 * A search jump names a key the URL does not: the panel jumps at runtime,
	 * and the deep-link path above owns the URL. `seq` is a MONOTONIC NONCE —
	 * the Backend section's reveal is idempotent per key (`revealedFocusKey`),
	 * so a second Enter on the same result would otherwise be a silent no-op
	 * rather than a second landing and a second flash.
	 */
	const [searchJump, setSearchJump] = useState<{
		key: string;
		nonce: number;
	} | null>(null);
	/*
	 * Every path ANSWERS. `"missing"` is a sentence the panel speaks
	 * (`ui.settings.search.jump.missing`) rather than an outcome this function
	 * drops on the floor — a result the reader pressed Enter on that moves
	 * nothing and says nothing is the dead end review round 1 named (B1/m5).
	 */
	const jumpToSearchEntry = useCallback(
		async (entry: SettingSearchEntry): Promise<SearchJumpOutcome> => {
			// A jump moves the reader on purpose; nothing is restored afterwards.
			savedSearchScrollRef.current = null;
			const root = contentContainerRef.current ?? document;
			if (entry.source === "page") {
				// `page:<row id>` -> the DOM contract's own id.
				return jumpToSearchRow(root, entry.id.slice(5));
			}
			if (entry.source === "section") {
				return jumpToSearchSection(root, entry.sectionId);
			}
			const key = entry.settingKey;
			if (!key) return "missing";
			const section = sectionForSettingKey(key, "backend");
			/*
			 * A registry key the payload no longer serves has no row to land on;
			 * say so instead of scrolling the Backend section and stopping.
			 */
			if (
				settingsRegistryQuery.data &&
				!settingsRegistryQuery.data.settings.some((row) => row.key === key)
			) {
				return "missing";
			}
			handleSelectSection(section);
			setSearchJump({ key, nonce: Date.now() });
			return root.querySelector(`[data-search-section="${section}"]`)
				? "landed"
				: "missing";
		},
		[handleSelectSection, settingsRegistryQuery.data],
	);
	/*
	 * A URL deep link outranks a search jump that is still on the books: the
	 * reader navigated somewhere with a keyed link, and the section must follow
	 * THAT key rather than the last result they pressed Enter on.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `location.search` is the trigger; the setter is stable.
	useEffect(() => {
		setSearchJump(null);
	}, [location.search]);
	/*
	 * Cmd/Ctrl+F is this page's, not the command palette's (that chord is
	 * Cmd/Ctrl+K and is owned globally). A press that landed on an overlay —
	 * a dialog, a menu — belongs to it, which is the rule the canvas binder
	 * documents in `keyboard-scopes.ts`.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
			if (event.key.toLowerCase() !== "f") return;
			if (pressLandsOnOverlay(event.target)) return;
			event.preventDefault();
			savedSearchScrollRef.current =
				contentContainerRef.current?.scrollTop ?? null;
			searchRef.current?.focus();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, []);
	// Update active section based on scroll position
	useEffect(() => {
		// Use a small delay to ensure DOM is ready
		const timer = setTimeout(() => {
			const contentContainer = contentContainerRef.current;

			if (!contentContainer) {
				return;
			}

			const handleScroll = () => {
				// If programmatic scrolling is active, ignore scroll events
				if (isScrolling) {
					return;
				}

				const containerRect = contentContainer.getBoundingClientRect();
				const viewportHeight = containerRect.height;

				// Find the section that is most visible in the viewport
				let bestSection = "";
				let bestVisibility = 0;

				for (const [sectionId, ref] of Object.entries(sectionRefs)) {
					if (ref.current) {
						const elementRect = ref.current.getBoundingClientRect();
						const containerTop = containerRect.top;

						// Calculate the element's position relative to the container
						const elementTop = elementRect.top - containerTop;
						const elementBottom = elementRect.bottom - containerTop;
						const elementHeight = elementRect.height;

						// Calculate how much of the element is visible in the viewport
						const visibleTop = Math.max(0, elementTop);
						const visibleBottom = Math.min(viewportHeight, elementBottom);
						const visibleHeight = Math.max(0, visibleBottom - visibleTop);
						const visibilityRatio = visibleHeight / elementHeight;

						// Prefer sections that are more visible, with a bias towards sections near the top
						const score =
							visibilityRatio + (elementTop < viewportHeight * 0.3 ? 0.1 : 0);

						if (score > bestVisibility && visibilityRatio > 0.1) {
							bestVisibility = score;
							bestSection = sectionId;
						}
					}
				}

				// Update state only if the active section has changed
				if (bestSection && bestSection !== activeSection) {
					setActiveSection(bestSection);
				}
			};

			// Initial call to set the correct section on mount
			handleScroll();

			contentContainer.addEventListener("scroll", handleScroll, {
				passive: true,
			});

			return () => {
				contentContainer.removeEventListener("scroll", handleScroll);
				clearTimeout(scrollTimeoutRef.current ?? undefined);
			};
		}, 100);

		return () => clearTimeout(timer);
	}, [sectionRefs, activeSection, isScrolling]);

	// Effect to handle initial section scrolling from URL query parameter
	useEffect(() => {
		const queryParams = new URLSearchParams(location.search);
		const sectionFromQuery = queryParams.get("section");
		// A ?setting= deep link lives inside the backend settings section — unless
		// the key's control has been promoted elsewhere, in which case the link
		// follows the control (see `PROMOTED_SETTING_SECTIONS`).
		const settingKey = queryParams.get("setting");
		const targetSection = settingKey
			? sectionForSettingKey(settingKey, "backend")
			: sectionFromQuery;
		// A link to a section this build does not show has nowhere to land; the
		// rail has no row for it either.
		if (targetSection === "agent-messages" && !agentMessagesSectionVisible)
			return undefined;

		const ref = targetSection ? sectionRefs[targetSection] : undefined;
		if (!targetSection || !ref) return undefined;

		// Deep links used to fire behind a fixed 100ms timer, reading
		// `offsetTop` before this very long page had laid out. The section was
		// still near the top of an unfinished layout, so EVERY deep link landed
		// on User profile while the sidebar highlighted the section the user
		// asked for (UX U3).
		//
		// Layout-aware instead of longer: a ResizeObserver on the scroll content
		// fires whenever the page's height changes, so we re-scroll as sections
		// mount and settle rather than guessing when they have. It stops at the
		// first frame whose target offset repeats -- that is what "laid out"
		// means here -- and a deadline bounds the case where something animates
		// forever.
		let settled = false;
		let lastOffset = Number.NaN;
		let frame = 0;
		// A page that never stops resizing must still take the user where they
		// asked, so the deadline scrolls rather than merely giving up.
		const deadline = window.setTimeout(() => {
			if (settled) return;
			settled = true;
			observer.disconnect();
			handleSelectSection(targetSection);
		}, 2000);

		const attempt = () => {
			if (settled) return;
			const element = ref.current;
			// Not mounted YET is the normal first frame on a lazily-loaded page,
			// not a reason to give up: keep waiting, bounded by the deadline
			// below. Returning without rescheduling here killed the loop before
			// the section existed, which is the whole mechanism.
			if (!element) {
				frame = requestAnimationFrame(attempt);
				return;
			}
			// The section's distance from the top of the document: stable once the
			// page above it has finished laying out, and independent of which
			// element ends up being the scroller.
			const offset = Math.round(
				element.getBoundingClientRect().top + window.scrollY,
			);
			// Scroll ONCE, when the target has stopped moving -- never on every
			// frame. A smooth scroll re-issued each frame is cancelled and
			// restarted before it can advance, so the view never actually
			// travels: the fix for a race must not become a busy loop that
			// defeats the animation it is waiting for.
			if (offset === lastOffset && offset > 0) {
				settled = true;
				observer.disconnect();
				window.clearTimeout(deadline);
				handleSelectSection(targetSection);
				return;
			}
			lastOffset = offset;
			frame = requestAnimationFrame(attempt);
		};

		const observer = new ResizeObserver(() => {
			if (settled) return;
			cancelAnimationFrame(frame);
			frame = requestAnimationFrame(attempt);
		});
		if (contentContainerRef.current) {
			observer.observe(contentContainerRef.current);
		}
		frame = requestAnimationFrame(attempt);

		return () => {
			settled = true;
			cancelAnimationFrame(frame);
			observer.disconnect();
			window.clearTimeout(deadline);
		};
	}, [
		location.search,
		sectionRefs,
		handleSelectSection,
		agentMessagesSectionVisible,
	]); // Rerun when URL search params change or refs are updated

	// Handle updating a specific config field
	const handleUpdateField = async (
		field: keyof ConfigUpdate,
		value: string | number | boolean,
	) => {
		setSavingField(field);
		try {
			await updateConfigMutation.mutateAsync({ [field]: value });
			await refetch(); // Refetch config after successful update
		} catch (error) {
			console.error(`Error updating ${field}:`, error);
			// Consider adding user feedback here (e.g., toast notification)
		} finally {
			setSavingField(null);
		}
	};

	/*
	 * What holds this surface while it loads: the config it RENDERS, and nothing
	 * else.
	 *
	 * WHY THE RADIENT ACCOUNT READ IS NOT IN THIS EXPRESSION, measured in the
	 * built app on 2026-09-19: with the account read refused upstream (401) and
	 * `['config']` already `success`, the page sat on `Spinner label="Loading
	 * settings"` for the whole 30s window it was sampled over, because
	 * `isAuthLoading` was true the entire time - the account read does not settle,
	 * so the query stays `pending`/`fetching` for as long as it is asked.
	 *
	 * WHAT THAT READ ACTUALLY DOES, because round 1 read it off a 33-read sample
	 * as a one-per-second re-issue ("33 reads in 33.4s", now retired): it is a
	 * FINITE retry chain, three attempts, and its two cadences are the client's own
	 * backoff and a deadline rather than a poll. THE NUMBERS ARE ANCHOR-DEPENDENT,
	 * so here is the anchor with each (qa round 3, Q3). MEASURED AT THE BACKEND, a
	 * refused read is 3 attempts in ~3.0s and a read that never answers is 3
	 * attempts ~21000ms and ~22000ms apart and then silence - those gaps being the
	 * TRANSPORT's per-op deadline (`DESKTOP_CONTROL_DEADLINE_MS`, 20s) plus React
	 * Query's 1s/2s backoff. MEASURED AT THE RENDERER, the bound is 5s longer
	 * (`DESKTOP_DEADLINE_MARGIN_MS`, so `desktopRequestTimeoutMs` is 25s for a
	 * control op, measured at 25.06s), and that one fires only when main itself
	 * never replies - this app's own IPC case, which a backend-side instrument
	 * cannot hold open. Offsets like "+1.0s/+22.0s/+44.0s" describe the same chain
	 * only when it is anchored at the mount, which is why the gaps are quoted
	 * above instead. The attempt count comes from the retry policy in
	 * `use-radient-user-query.ts`; none of these is an observer-subscribe rate,
	 * which is a mechanism nothing samples here.
	 *
	 * A read that can fail forever must not decide whether a page can render, and
	 * this page reads exactly ONE thing from it: `isAuthenticated`, for two
	 * read-only fields and two Radient-only blocks. `isConfigLoading` is the read
	 * the surface cannot be rendered without, and the error branch above is what
	 * makes its failure actionable.
	 *
	 * The account read still gates the surfaces that genuinely depend on it -
	 * `RadientAccountSection` renders its own waiting state and its own failure
	 * copy - and it still decides the two profile fields' read-only bit below.
	 */
	const isLoading = isConfigLoading;
	/*
	 * The account read's own state, from ONE classification (`accountRead` in
	 * `use-radient-user-query`). The two facts this page renders from are: is the
	 * read still out (`checking`, which must not present the user store's
	 * placeholder as the reader's own), and did it come back without an answer
	 * (any failure class, which must say so beside the fields it affects).
	 *
	 * The distinction from `isAuthenticated`, which is false in both of those and
	 * in the ordinary signed-out state: only two of the three are things to tell
	 * the reader about. The classes themselves are read from the backend's own
	 * `code`, never from a status or a sentence, because the same 401 on this
	 * route is either Radient refusing the account's credential (sign in again)
	 * or the desktop plane refusing this app's bearer (restart or re-pair), and
	 * the copy below has to know which.
	 */
	const accountReadChecking = accountRead === "checking";
	const accountReadFailed = isRadientAccountFailure(accountRead);
	/*
	 * Whether the two profile fields are locked, decided by the ONE reading above
	 * and stated once for both of them. See the comment at the fields themselves
	 * for why it is these two classes and not "anything but signed out" (design
	 * round 2, ruling on B2), and why a read that is still IN FLIGHT locks them
	 * whatever the recorded class says (qa round 3, Q4: the never-settling read
	 * records a class while the chain is still asking, so an edit made then can be
	 * replaced by the SAME chain's next attempt).
	 */
	const profileFieldsAreReadOnly =
		accountRead === "ready" || accountRead === "checking" || isAccountFetching;
	// Well inside the transport's deadline for these reads (the op's own derived
	// budget), so the explanation appears while
	// the user is still deciding whether the app is stuck rather than after they
	// have concluded it is.
	const isSlowLoad = useElapsedSince(isLoading, 4000);

	// The error branch below is only reachable if the config query actually
	// settles. The renderer transport now bounds every desktop control, so a
	// stalled request rejects instead of pending forever -- but the spinner is
	// still the LAST state a user sees when something upstream of it stalls, and
	// an unrecoverable spinner leaves them with nothing to do but relaunch. So
	// the error state is preferred over the spinner once the config query has
	// failed, rather than being gated behind it: `isAuthLoading` alone must not
	// hold the page on a spinner when the settings it is loading can no longer
	// arrive. That ordering is what makes the recovery affordance reachable.
	if (configError) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-canvas p-6">
				{/* `warning`, matching the providers grid: one fault must not render
				    at two severities depending on which screen reports it, and a
				    failure with a Retry beside it has cost the user nothing. The rule
				    is stated beside the shared copy in `backend-error.ts`. */}
				<Alert variant="warning" className="w-full max-w-xl">
					<div className="flex items-center justify-between gap-3">
						{/* Classified from the SAME error the banner above reads, so this
						    page can no longer say the server "may not be running" while
						    the banner says it is offline -- or tell a 401 user to wait for
						    a server that is already running and refusing this app's
						    bearer. The raw exception ("Get config request failed: 503")
						    used to render here; it names a function, a transport verb and
						    an integer, none of which change what the user does next, so it
						    stays on `error.message` for logs and support and out of the
						    sentence. */}
						<span>{loadErrorSentence}</span>
						{/* Same recovery the providers grid offers: re-ask the server in
						    place, so a transient stall does not cost a relaunch.

						    `isFetching`, not `isLoading`: refetching an ERRORED query
						    leaves `status: "error"`, so `isLoading` stays false and this
						    branch keeps rendering for the transport's whole deadline for this
						    op.
						    Without a pending state the frame is pixel-identical after the
						    click -- issue 89's own "I cannot tell whether this is working
						    or hung", one click downstream of its fix. */}
						{loadErrorRemedy && (
							<Button
								variant="secondary"
								size="sm"
								className="shrink-0"
								onClick={() => void refetch()}
								disabled={isConfigFetching}
							>
								{isConfigFetching
									? t("ui.settings.navigation.settings_page.retrying")
									: t("ui.settings.navigation.settings_page.retry")}
							</Button>
						)}
					</div>
				</Alert>
			</div>
		);
	}

	if (isLoading) {
		return (
			/*
			 * One live region around the whole waiting stack, so the caption IS the
			 * announcement when it appears.
			 *
			 * The caption previously sat outside the spinner's own `role="status"`,
			 * so a screen-reader user heard "Loading settings" once at mount and
			 * then nothing for the whole budget -- while a sighted user got a visible
			 * state
			 * change at 4s telling them the app was alive. Under
			 * `prefers-reduced-motion` the global cap freezes the ring, so that user
			 * had no liveness signal at all. The text whose entire purpose is "you
			 * cannot tell waiting from hung" was reaching only the users who could
			 * already tell.
			 *
			 * `label` drops off the `Spinner` once the caption paints, per the
			 * component's own contract: standalone spinner -> pass `label`; spinner
			 * beside its own caption -> omit it, or the same fact is announced
			 * twice.
			 */
			// biome-ignore lint/a11y/useSemanticElements: there is no semantic element for a polite live region; role=status on the container is the pattern.
			<div
				role="status"
				className="flex h-full w-full flex-col items-center justify-center gap-3 bg-canvas"
			>
				<Spinner
					size="lg"
					label={
						isSlowLoad
							? undefined
							: t("ui.settings.navigation.settings_page.loading_settings")
					}
				/>
				{/* A bounded wait is still a silent one. Until the deadline expires
				    this spinner is pixel-identical to the unrecoverable spinner of
				    issue 89, so a user cannot tell "waiting" from "hung" and gives
				    up before the error state they were promised can render. Only
				    after the threshold: on a healthy load this never paints.

				    The copy states an event in the user's terms and what they get,
				    rather than narrating the app's control flow ("This will stop and
				    offer a retry"), which made the machinery the subject. */}
				{isSlowLoad && (
					<p className="max-w-sm text-center text-body-sm text-ink-muted">
						{t(
							"ui.settings.navigation.settings_page.the_local_operator_server_is_taking_longer_than_usual_to_answer_i",
						)}
					</p>
				)}
			</div>
		);
	}

	if (!config) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-canvas p-6">
				{/* Settled with no error and no config: nothing classified it, so
				    there is no status to advise on and no remedy to assert. Same
				    discipline as the classifier's `unknown` -- state the failure and
				    stop rather than guessing an action that may not fix it. */}
				<Alert variant="warning" className="w-full max-w-xl">
					{t(
						"ui.settings.navigation.settings_page.your_settings_could_not_be_loaded",
					)}
				</Alert>
			</div>
		);
	}

	/* No `max-md:` set on the container or the rail below.

	   Not because the width is unreachable - the window's minWidth of 800 is in
	   device pixels and page zoom divides the CSS viewport, so one Zoom In press
	   at the floor lands at 727px, inside the range those five utilities
	   described. The reason is that the page renders correctly there without
	   them: measured at exactly 727px, the icon rail stays a 48px column beside
	   a 459px content column, all six nav items present, no horizontal
	   overflow. A second layout that only a zoomed-in user ever sees is a
	   second layout nobody tests; if the stacked rail is wanted it is its own
	   change, with its own frame. Deleting these also leaves the renderer with
	   no `max-*` breakpoint utilities at all, which is how the rest of the app
	   is written. */
	return (
		<div
			data-glass-region="canvas"
			data-glass-split=""
			/* A full-height panel: `canvas` from y0, columns pad themselves. */
			className="panel-flush flex min-h-0 flex-1 overflow-hidden bg-canvas"
		>
			{/*
			 * No edge on this wrapper any more. The rail is `surface` (see
			 * `settings-sidebar`'s ground note), so the boundary beside the content
			 * is the tone step it makes against `canvas` — and a drawn line over a
			 * tone step is the redundant second mark the operator reported as
			 * stopping partway up the window: "either make it extend all the way up
			 * or remove the right border". It is removed rather than extended,
			 * because extending would have the shell's lane paint a fence for a
			 * boundary that already reads (the pass that took the dock's own
			 * leading rule, #564, removed exactly this kind of mark). The lateral
			 * boundary on the rail's other side is no boundary at all — the rail
			 * and the app sidebar are both `surface`, the flat join the agents
			 * roster makes beside it.
			 *
			 * Two widths, and the `min-[1040px]:` step is paired with the
			 * `(min-width: 1040px)` query inside `SettingsSidebar`, which is what
			 * swaps the rows between labels and icons-with-tooltips. Changing one
			 * without the other leaves labels clipped in a 48px column or a 220px
			 * column of bare marks. 1040 is where this rail and the 220px app rail
			 * beside it still leave 600px of content.
			 *
			 * There is no intermediate width because there is no useful one:
			 * "Application updates" measures 121px of text and needs a 186px rail
			 * to render whole, so anything between 48 and 220 buys a few pixels of
			 * content in exchange for an ellipsis on a destination's name.
			 */}
			<div
				/*
				 * The rail's own `surface` reaches y0 now: `SettingsSidebar` pads its
				 * first row below the strip instead of the shell reserving a row above
				 * it. The width stays the single two-width decision below (48px under
				 * 1040, 220 at and above it).
				 */
				className="w-12 shrink-0 overflow-y-auto min-[1040px]:w-55"
			>
				<SettingsSidebar
					activeSection={activeSection}
					onSelectSection={handleSelectSection}
					sections={settingsSections}
				/>
			</div>

			<div
				ref={contentContainerRef}
				data-settings-content
				data-glass-region="canvas-content"
				data-tour-tag="settings-general-section"
				/*
				 * `panel-scroll`: the pad sits OUTSIDE the scroller (as a margin),
				 * so the scroll region's clip is the panel's content edge. A
				 * `padding-top` on the scroller itself clips at its padding box and
				 * would let scrolled text paint through the strip.
				 */
				className="panel-scroll flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8"
			>
				{/*
				 * One measured column, centred, rather than two.
				 *
				 * The two-column grid this replaces made the eye zig-zag to find a
				 * setting, left the right-hand column ending in a void wherever the
				 * two ran to different heights, and broke the rail's meaning: the
				 * scroll-spy highlights whichever section is most visible, which is
				 * not a question with one answer when two sections are side by side.
				 *
				 * 896px is the widest the content actually wants — three theme
				 * previews, or a four-column info grid — and it is narrow enough that
				 * a section description is not a 1300px line. Every settings surface
				 * worth copying does this: Linear, Notion, GitHub and macOS System
				 * Settings all cap the detail pane and none of them column it.
				 */}
				<div className="mx-auto flex w-full max-w-4xl flex-col gap-8 pb-8">
					{/*
					 * TITLE AND SEARCH ARE ONE BLOCK, gap-4 inside and the column's
					 * gap-8 outside (design round 3, D22). At gap-8 either side the
					 * field sat exactly as far from the title as from the first section
					 * below it, so nothing said whether it belonged to the header or was
					 * the first control of "Interface language".
					 */}
					<div className="flex flex-col gap-4">
						<PageHeader title={t("ui.settings.page.title")} icon={Settings} />
						{/*
						 * THE SEARCH ROW, NOT A HEADER WIDGET. It sits under the title and
						 * spans the content column, so it shares BOTH edges with every
						 * control beneath it. In the header's action slot it floated at an
						 * arbitrary x - the column is centred in the window, so at a wide
						 * size the field landed right of the middle with nothing to align
						 * to, which is the "centred everything" tell rather than a grid
						 * decision. Column-wide is also what makes it read as the page's
						 * first control rather than a badge beside the title.
						 *
						 * It is still the page's search and not a section filter: this one
						 * JUMPS, the Backend section's own box filters its list in place.
						 */}
						<SettingsSearch
							onDismiss={() => {
								const saved = savedSearchScrollRef.current;
								savedSearchScrollRef.current = null;
								if (saved === null) return;
								contentContainerRef.current?.scrollTo({ top: saved });
							}}
							ref={searchRef}
							index={searchIndex}
							readRendered={readRenderedSearchRows}
							onJump={jumpToSearchEntry}
						/>
					</div>
					<div className="flex flex-col gap-8">
						<div
							ref={sectionRefs.general}
							/*
							 * The sidebar destination this group belongs to, with its
							 * rail label: the `h2`s inside name sub-groups ("User
							 * profile"), while a jump lands in General settings.
							 */
							data-search-section="general"
							data-search-section-label={t(
								"ui.settings.navigation.settings_sidebar.general_settings",
							)}
							className="flex flex-col gap-8"
						>
							<GeneralLanguageSetting
								focus={
									settingFocusKey === LANGUAGE_SETTING_KEY ||
									searchJump?.key === LANGUAGE_SETTING_KEY
								}
								focusNonce={
									searchJump?.key === LANGUAGE_SETTING_KEY
										? searchJump.nonce
										: undefined
								}
							/>
							<SettingsSection
								title={t("ui.settings.profile.title")}
								icon={User}
								description={t(
									isAuthenticated
										? "ui.settings.profile.description_authenticated"
										: "ui.settings.profile.description_anonymous",
								)}
							>
								{/*
								 * The status slot above the fields, in the app's one register for "this
								 * is not authoritative yet": `text-meta text-ink-dim`, sentence
								 * case, no spinner, no icon, no border (`branding.md` section 8).
								 *
								 * WHY THE FIELDS CANNOT JUST SIT THERE WHILE THE READ IS OUT. They
								 * render the user store's own profile, whose default is the literal
								 * name "User" and `user@example.com`, in the same styling as a real
								 * one -- so an unanswered read presented placeholder data as the
								 * reader's own, and (measured 2026-09-19) the in-flight frame was
								 * byte-identical to the ordinary signed-out frame. "Checking" costs
								 * the reader one line and removes the claim.
								 *
								 * Present from the first painted frame, not on a deadline: unlike
								 * the config gate below, the ambiguity here is not "is it hung" but
								 * "whose data is this", and that question is unanswered from the
								 * first frame the fields are on screen.
								 */}
								{accountReadChecking && (
									<p className="text-meta text-ink-dim">
										{t("ui.settings.profile.account_checking")}
									</p>
								)}
								{/*
								 * A failed account read, said out loud. Without this the two fields
								 * below render the user store's default - the literal name "User"
								 * and `user@example.com` - in the same styling as a real profile,
								 * so a person whose Radient credential was rejected sees
								 * placeholder data and no reason for it (measured 2026-09-19: the
								 * sidebar read "User" beside a backend that held a Radient
								 * credential).
								 *
								 * ONE ALERT FOR THIS FAULT, and it is this one: the lie is visible
								 * here, so the explanation and its Retry live here. The Radient
								 * account section says what the read's failure means for ITS own
								 * state in one sentence rather than rendering a second warning
								 * 3173px below (design round 1, D1: two warnings for one fault, with
								 * two opposite sentences 16px apart, is what the reader was shown).
								 *
								 * AND IT IS UNREACHABLE WHILE AN ACCOUNT IS RESOLVED (review round
								 * 2, B3): the hook's rule puts a resolved account ahead of a failed
								 * refetch, because these fields are then the account's own name and
								 * email and calling them placeholders was the lie this alert
								 * exists to prevent.
								 *
								 * `warning` and a Retry, matching the config branch above and the
								 * providers grid: one fault renders at one severity, and a failure
								 * with a retry beside it has cost the user nothing. The raw
								 * exception stays out of the sentence for the reason
								 * `backend-error.ts` records - the sentence has to name something
								 * the reader can do.
								 *
								 * NO CAUSE IS NAMED UNLESS THE BACKEND NAMED IT. "Radient refused
								 * the sign-in" is a statement about the ACCOUNT's credential and
								 * is only made for the class that carries
								 * `radient_credential_refused`; every other failure - including a
								 * bare 401/403, which also means this app's own bearer was
								 * refused - keeps to what was observed and the retry.
								 */}
								{accountReadFailed && (
									<Alert variant="warning">
										<div className="flex items-center justify-between gap-3">
											<span>
												{t(
													accountRead === "refused"
														? "ui.settings.profile.account_read_failed_refused"
														: "ui.settings.profile.account_read_failed_retry",
												)}
											</span>
											{/*
											 * WHAT THIS REPORTS IS THE READER'S OWN PRESS (qa round 3, Q1).
											 * `isAccountRefreshing` is the mutation's pending state, and that mutation
											 * awaits its refetch - so the control says t("ui.settings.navigation.settings_page.retrying") exactly while the
											 * re-read this press began is running, and an ordinary fetch (the client's
											 * own retries included) leaves it saying "Retry", enabled. The first version
											 * read `isFetching`, which is true for those retries too: for a read that
											 * never answers the control read t("ui.settings.navigation.settings_page.retrying"), disabled, with nobody having
											 * pressed anything, beside copy that says "Retry."
											 *
											 * The alert STAYS MOUNTED while that re-read is out (the hook keeps the
											 * failure across the fetch), and this control reports that the press did
											 * something: without it the frame after a press is pixel-identical to the
											 * frame before it - issue 89's own "I cannot tell whether this is working or
											 * hung", one click downstream of its fix.
											 */}
											<Button
												variant="secondary"
												size="sm"
												className="shrink-0"
												onClick={() => refreshUser()}
												disabled={isAccountRefreshing}
											>
												{isAccountRefreshing
													? t("ui.settings.profile.retrying")
													: t("ui.settings.profile.retry")}
											</Button>
										</div>
									</Alert>
								)}
								{/*
								 * Neither field carries a glyph. The section heading is
								 * already a person, and a second person glyph 60px under it
								 * on "Display name" was the same picture twice for two
								 * different things. `Mail` goes with it rather than being
								 * kept alone: one indented label beside one flush label is a
								 * ragged column, and "Display name" and "Email address" are
								 * not words that need a picture to be told apart.
								 */}
								{/*
								 * LOCKED ONLY WHERE AN OVERWRITE IS ACTUALLY POSSIBLE (design round 2,
								 * ruling on B2). The old predicate asked "is this read unresolved?"
								 * when the governing question is "could what I type be replaced
								 * without my knowing?", and it answered yes in two states where
								 * nothing can replace it:
								 *
								 *  - `ready`: the account owns these fields - the store-sync effect in
								 *    `use-radient-auth.ts` writes the account's name and email over
								 *    the store's - so an edit here is one the app would undo. LOCKED.
								 *  - `checking`: a resolution may still land WITH an account, and the
								 *    caption above says the app is asking. LOCKED, and bounded by the
								 *    read's own deadline rather than indefinite.
								 *  - the failure classes (`refused`, `unavailable`, `unknown`) and
								 *    signed out: UNLOCKED. The read has ANSWERED without an account
								 *    and the sync effect only fires on a resolution WITH one, so
								 *    nothing in the app's own model can overwrite an edit made here;
								 *    the old predicate instead stranded a reader who has no Radient
								 *    account and a failing read on two permanently dead controls whose
								 *    only release never arrives. The alert above explains the read.
								 *
								 * THE RESIDUAL, named rather than hidden: a later successful read (a
								 * retry resuming, a remount, a focus refetch) can still replace a
								 * profile typed here. Closing that properly is a dirty flag on the
								 * store-sync effect - the edit wins until the reader clears it -
								 * which is a follow-up, not a reason to keep an indefinite lock.
								 */}
								<div className="flex flex-col gap-4">
									<EditableField
										searchRow="general.profile.name"
										value={userStore.profile.name}
										label={t("ui.settings.profile.display_name.label")}
										placeholder={t(
											"ui.settings.profile.display_name.placeholder",
										)}
										isSaving={savingField === "user_name"}
										onSave={async (value) => {
											setSavingField("user_name");
											try {
												userStore.updateName(value);
											} finally {
												setSavingField(null);
											}
										}}
										readOnly={profileFieldsAreReadOnly}
									/>
									<EditableField
										searchRow="general.profile.email"
										value={userStore.profile.email}
										label={t("ui.settings.profile.email.label")}
										placeholder={t("ui.settings.profile.email.placeholder")}
										isSaving={savingField === "user_email"}
										onSave={async (value) => {
											setSavingField("user_email");
											try {
												userStore.updateEmail(value);
											} finally {
												setSavingField(null);
											}
										}}
										readOnly={profileFieldsAreReadOnly}
									/>
								</div>
							</SettingsSection>

							<SettingsSection
								title={t("ui.settings.tour.title")}
								description={t("ui.settings.tour.description")}
							>
								<Button
									variant="secondary"
									data-search-row="general.tour"
									data-search-control
									onClick={() => {
										startOnboardingTour({ forceModalCompleted: true });
									}}
								>
									<CirclePlay />
									{t("ui.settings.tour.action")}
								</Button>
							</SettingsSection>

							{/* `SlidersHorizontal`, not `Cpu`: this section sets defaults for
							    two things, and `Cpu` is the Model select's own glyph a few
							    rows below it. One picture, one meaning. */}
							<SettingsSection
								id="model-settings"
								title={t("ui.settings.model.settings_page.model_settings")}
								icon={SlidersHorizontal}
								description={t(
									"ui.settings.model.settings_page.configure_the_default_ai_model_and_hosting_providers_used_for_gen",
								)}
							>
								<div
									/* The hosting/model/effort trio is ONE row: they are
									   three controls choosing one thing (which model runs
									   new conversations), and a reader searching "model"
									   should land on the group, not on three near-identical
									   results. */
									data-search-row="general.model"
									data-search-control
									/*
									 * This row is THREE controls and no title of its own: the
									 * section's h2 is the only name it prints, so a reader
									 * typing "model" was competing against twelve registry rows
									 * whose labels are exactly that word while this row's label
									 * was the concatenated text of its three selects (QA round
									 * 2b, Q6b). The label is the heading's own string, so the
									 * word on screen is the word that finds it; the row's text
									 * (hosting provider, the model's name) stays searchable as
									 * its description.
									 */
									data-search-label={t(
										"ui.settings.model.settings_page.model_settings",
									)}
									/*
									 * The words the three controls PRINT, as terms: making the
									 * label the heading's string moved the trio's own captions
									 * out of the label tier, so "hosting provider" — which a
									 * reader reads off the `Hosting provider` caption and used to
									 * find this row first — would fall to the description tier and
									 * be outranked by registry names. Terms keep the reader's
									 * vocabulary at the tier the captions had.
									 */
									data-search-terms={[
										t("ui.common.models.hosting_select.hosting_provider"),
										t("ui.common.models.model_select.model"),
										t("ui.settings.model.default_effort.label"),
									].join(" ")}
									className="flex flex-col gap-4"
								>
									<HostingSelect
										value={config.values.hosting}
										isSaving={savingField === "hosting"}
										onSave={(value) => handleUpdateField("hosting", value)}
										filterByCredentials={true}
										allowCustom={true}
										allowDefault={false}
										/* This IS Settings, so the default ("…in Settings, under Providers")
										   would send the reader to the page they are already on. Settings'
										   own model section says "below" instead: same door, same words,
										   no second sentence. */
										emptyHelperText={t(
											"ui.settings.model.settings_page.no_hosting_options",
										)}
									/>
									<ModelSelect
										value={config.values.model_name}
										hostingId={config.values.hosting}
										isSaving={savingField === "model_name"}
										onSave={(value) => handleUpdateField("model_name", value)}
										allowCustom={true}
										allowDefault={false}
									/>
									{/*
									 * Beside the two rows it depends on, in the same chrome: the
									 * effort ladder is the SELECTED model's, read from the
									 * preview the composer's own effort picker uses.
									 */}
									<DefaultEffortSelect
										hosting={config.values.hosting}
										modelName={config.values.model_name}
										/*
										 * The same reveal the language row gets: this key is promoted
										 * out of the backend registry, so the section's `focusKey` is
										 * suppressed for it and the row has to focus itself.
										 */
										focus={
											settingFocusKey === MODEL_EFFORT_SETTING_KEY ||
											searchJump?.key === MODEL_EFFORT_SETTING_KEY
										}
										focusNonce={
											searchJump?.key === MODEL_EFFORT_SETTING_KEY
												? searchJump.nonce
												: undefined
										}
									/>
									{/*
									 * ONLY WHEN NO PROVIDER IS CONNECTED. Leading with "sign in"
									 * rather than API keys, because a subscription login is the
									 * path most readers have: the sentence names it, and the inline
									 * link jumps to the Providers section on this page (a real
									 * button, not a hash href - this is a hash router, where a
									 * hash link would read as a route change).
									 */}
									{needsProvider && (
										<Alert
											variant="neutral"
											icon={<Info className="size-4" aria-hidden="true" />}
										>
											<span>
												{t("ui.settings.model.provider_callout.sentence")}
												<button
													type="button"
													className="text-accent underline underline-offset-2"
													onClick={() => {
														handleSelectSection("providers");
														/*
														 * Keep the landing and make the jump keyboard-complete: the
														 * container is focusable (`tabIndex={-1}` via its `id`), so
														 * `preventScroll` keeps the smooth scroll's destination while
														 * the next Tab continues INSIDE the section. Scoped to this
														 * jump only; the sidebar keeps its pointer-first behaviour.
														 */
														sectionRefs.providers.current?.focus({
															preventScroll: true,
														});
													}}
												>
													{t(
														"ui.settings.model.provider_callout.providers_link",
													)}
												</button>
												.
											</span>
										</Alert>
									)}
								</div>
							</SettingsSection>

							<SystemPrompt />

							<SettingsSection
								title={t(
									"ui.settings.configuration.settings_page.configuration_information",
								)}
								icon={Info}
								description={t(
									"ui.settings.configuration.settings_page.system_information_about_the_current_configuration",
								)}
							>
								<InfoGrid>
									<InfoItem
										label={t("ui.settings.configuration.settings_page.version")}
										value={
											<span className="text-mono-sm">{config.version}</span>
										}
									/>
									<InfoItem
										label={t("ui.settings.configuration.settings_page.created")}
										value={formatCalendarDate(config.metadata.created_at)}
									/>
									<InfoItem
										label={t(
											"ui.settings.configuration.settings_page.last_modified",
										)}
										value={formatCalendarDateTime(
											config.metadata.last_modified,
										)}
									/>
									<InfoItem
										label={t(
											"ui.settings.configuration.settings_page.description",
										)}
										value={
											config.metadata.description ||
											t(
												"ui.settings.configuration.settings_page.no_description_available",
											)
										}
									/>
								</InfoGrid>
							</SettingsSection>
						</div>

						<SettingsSection
							title={t("ui.settings.appearance.settings_page.appearance")}
							icon={Contrast}
							description={t(
								"ui.settings.appearance.settings_page.customize_the_look_and_feel_of_local_operator",
							)}
							sectionRef={sectionRefs.appearance}
							dataTourTag="settings-appearance-section"
							searchSection="appearance"
							searchSectionLabel={t(
								"ui.settings.navigation.settings_sidebar.appearance",
							)}
						>
							<div className="flex flex-col gap-4">
								<ThemeSelector />
								{/*
								 * The reasoning preference's only control.
								 *
								 * The preference, the grouping rule that honours it and the
								 * panel that renders it all shipped in this refactor without
								 * anything that could turn it on, so a complete feature was
								 * unreachable and its default was the whole of its
								 * behaviour. Appearance rather than a chat menu, because it
								 * changes what every conversation shows rather than acting
								 * on the one in front of you.
								 *
								 * `ToggleSetting` rather than a hand-rolled row. This was
								 * a `Label htmlFor` over a `Switch id` first, which cannot
								 * work: the switch renders as a `button`, `htmlFor` only
								 * associates with labelable elements, and the helper
								 * sentence was announced to nobody. That component solves
								 * exactly this and had no callers, which is the only reason
								 * the row got written twice.
								 */}
								<ToggleSetting
									searchRow="appearance.reasoning"
									value={showAgentReasoning}
									label={t(
										"ui.settings.appearance.settings_page.show_agent_reasoning",
									)}
									description={t(
										"ui.settings.appearance.settings_page.adds_the_agent_s_reasoning_and_thinking_rows_to_conversations_the",
									)}
									onChange={async (next) => setShowAgentReasoning(next)}
								/>
								{/*
								 * The transcript display mode, the second control of a pair: this row
								 * changes how RESPONSES are drawn, the switch above changes whether
								 * REASONING is drawn at all. They compose — neither rewrites the other's
								 * rows — which is what the issue's "compose instead of competing" asks
								 * for. The mode is ALSO reachable from the conversation itself (see the
								 * header's `Transcript display` submenu), because a reader looking for
								 * it is looking at the transcript rather than at this page.
								 */}
								<TranscriptDisplayModeSetting
									searchRow="appearance.transcript"
									value={parseTranscriptDisplayMode(transcriptDisplayMode)}
									onChange={(next) => setTranscriptDisplayMode(next)}
								/>
								{/*
								 * OPTIONAL WINDOW TRANSLUCENCY, default off. Owned by the main process
								 * (it must know before the window exists), so this row reads and
								 * writes through `useWindowGlass` rather than the preferences store.
								 * Absent outside the desktop app; replaced by its reason where the
								 * platform cannot do it. See `window-glass-setting.tsx`.
								 */}
								<WindowGlassSetting
									searchRow="appearance.glass"
									state={glass.state}
									onChange={glass.set}
								/>
							</div>
						</SettingsSection>

						{/*
						 * Speech voicing sits beside Appearance and not under Backend settings,
						 * because it is the same kind of question: a preference about how the app
						 * behaves for the reader in front of it, not a registry key they had to
						 * know by name. Its seven rows are the daemon's own (selected by key), and
						 * the group adds what the registry cannot say — which provider would serve
						 * this machine, and what to do when none can. See its module docstring for
						 * why it carries no credential field.
						 */}
						<SpeechSection sectionRef={sectionRefs.speech} />
						<KeyboardShortcutsSection sectionRef={sectionRefs.keyboard} />

						{/*
						 * The provider grid is the same component onboarding uses: one
						 * place for a provider's sign-in methods, states and stored
						 * credentials. `/provider`, `/login` and `/logout` land here.
						 */}
						<SettingsSection
							title={t("ui.settings.model.settings_page.model_providers")}
							icon={Plug}
							description={t(
								"ui.settings.navigation.settings_page.sign_in_to_the_services_your_agents_think_with_new_chats_use_your",
							)}
							sectionRef={sectionRefs.providers}
							searchSection="providers"
							searchSectionLabel={t(
								"ui.settings.navigation.settings_sidebar.model_providers",
							)}
							/*
							 * An anchor for the callout's jump: `id` makes the container a
							 * `tabIndex={-1}` focus target, so activation can move focus INTO
							 * the section (skip-link pattern) and the next Tab continues through
							 * its controls instead of pulling the view back to where the link
							 * sits in DOM order.
							 */
							id="model-providers"
							/*
							 * The landing target draws NO ring. `tabIndex={-1}` makes it a
							 * programmatic rest-stop, not a control, and Chromium counts a
							 * scripted `.focus()` after keyboard input as `:focus-visible` - so
							 * the app's 2px accent ring would outline the whole section,
							 * heading through provider grid, with nothing actionable in it.
							 * `index.css` allows `outline-none` exactly when "focus is moved
							 * there programmatically and a ring would be noise"; the `!` is
							 * required because the ring is an unlayered `html :focus-visible`
							 * rule that outranks utilities (same escape the browser pane's
							 * U9 rest-stop uses). Every focusable CHILD keeps its own ring,
							 * and the landing is already unmistakable: the scroll puts the
							 * heading at the header room and the rail moves to this section.
							 */
							className="focus-visible:outline-none!"
						>
							<ProviderGrid
								initialProviderId={providerFromQuery}
								onChangeModel={() => handleSelectSection("general")}
							/>
						</SettingsSection>

						{/*
						 * MCP management replaced the Google OIDC cards: the section
						 * negotiates the `mcp` capability itself and reads the active
						 * canonical session, so it renders unconditionally here.
						 */}
						<McpManagementSection
							sessionId={activeSessionId ?? undefined}
							sectionRef={sectionRefs.integrations}
							highlightServer={mcpTarget}
						/>

						<SettingsSection
							title={t("ui.settings.account.settings_page.radient_account")}
							titleComponent={<RadientSectionTitle />}
							description={t(
								"ui.settings.account.settings_page.your_radient_account_radient_pass_details_and_credits_to_use_radi",
							)}
							sectionRef={sectionRefs.radient}
							dataTourTag="settings-radient-account-section"
							searchSection="radient"
							searchSectionLabel={t(
								"ui.settings.navigation.settings_sidebar.radient_account",
							)}
							searchIgnore="account, billing and usage are read-only or remote"
						>
							{/*
							 * Account, billing and usage were separated by `Divider`s. They are
							 * three groups inside one grouping, so the section tier gap says
							 * the same thing without drawing two more lines on a page that
							 * already has enough.
							 */}
							<div className="flex flex-col gap-8">
								<RadientAccountSection
									onAfterCredentialUpdate={() => {
										refreshModels();
										refetchCredentials();
									}}
								/>

								{isAuthenticated && (
									<>
										<BillingInfo />
										<UsageInfo />
									</>
								)}
							</div>
						</SettingsSection>

						{agentMessagesSectionVisible && (
							<SettingsSection
								title={t("ui.agentMessages.settings.section")}
								icon={MessageSquare}
								description={t("ui.agentMessages.settings.description")}
								sectionRef={sectionRefs["agent-messages"]}
								id="agent-messages"
								searchSection="agent-messages"
								searchSectionLabel={t("ui.agentMessages.settings.section")}
								/* The controls inside are a consent state machine's, not
								   a list of rows; the two registry-backed preferences it
								   owns are searchable through the registry index and land
								   here through `sectionForSettingKey`. */
								searchIgnore="agent messages is a consent state machine; its registry rows are searchable"
								/* A peer section, not a subsection of Backend settings
								   (design round 1, D1): one decorative rule plus the
								   page's section gap, no card. */
								className="border-b border-hairline pb-8"
							>
								{agentMessagesStatus ? (
									<AgentMessagesSettings
										availability={agentMessagesAvailability}
										status={agentMessagesStatus}
										accountId={agentMessagesAccountId}
										refusal={agentMessagesSnapshot.refusal}
										onRefreshStatus={refreshAgentMessages}
										sessions={canonicalSessions}
										focus={
											settingFocusKey === TEAM_BRIDGE_ENABLED_SETTING_KEY ||
											searchJump?.key === TEAM_BRIDGE_ENABLED_SETTING_KEY
										}
										focusNonce={
											searchJump?.key === TEAM_BRIDGE_ENABLED_SETTING_KEY
												? searchJump.nonce
												: undefined
										}
										/* The chief-of-staff hold's button goes through the
										   one shared switch rule, so the URL moves with the
										   store commit like every other entrance; the chat
										   pane's composer takes focus on mount by itself.
										   The status cache is dropped first so Settings'
										   mount boundary on the way back reads the hold
										   fresh and the notice clears once the owner has
										   sent that message. */
										onOpenSession={(sessionId) => {
											agentMessagesModel.invalidateStatus();
											void openConversation(navigate, sessionId);
										}}
									/>
								) : agentMessagesSnapshot.refusal ? (
									/*
									 * The model keeps the refusal while a forced retry is
									 * in flight, so this Alert — and its Retry — stays on
									 * screen instead of the section blanking (R2-2).
									 */
									<Alert variant="warning">
										<AlertTitle>
											{t("ui.agentMessages.settings.error.title")}
										</AlertTitle>
										<AlertDescription>
											{agentMessagesSnapshot.refusal.code !==
												"client_unavailable" && (
												<span className="block">
													{settingsRefusalSentence(
														agentMessagesSnapshot.refusal,
													)}
												</span>
											)}
											<span className="block">
												{t("ui.agentMessages.settings.error.no_changes")}
											</span>
											<Button
												className="mt-3"
												variant="secondary"
												onClick={() => void refreshAgentMessages()}
											>
												{t("ui.agentMessages.settings.error.retry")}
											</Button>
										</AlertDescription>
									</Alert>
								) : (
									<div aria-busy="true" className="flex flex-col gap-3">
										<Skeleton className="h-5 w-40" />
										<Skeleton className="h-4 w-full max-w-xl" />
									</div>
								)}
							</SettingsSection>
						)}

						<SettingsSection
							title={t("ui.settings.navigation.settings_page.backend_settings")}
							icon={Settings}
							description={t(
								"ui.settings.navigation.settings_page.every_setting_the_backend_registry_owns_searchable_with_typed_edi",
							)}
							sectionRef={sectionRefs.backend}
							searchSection="backend"
							searchSectionLabel={t(
								"ui.settings.navigation.settings_sidebar.backend_settings",
							)}
							/* Registry rows are the Backend section's own surface: its
							   filter searches them in place, and this page's search reads
							   the same payload directly (`settings.list`), so its rendered
							   rows are not rows of THIS mechanism. */
							searchIgnore="registry rows are searched by the Backend section's own filter"
						>
							<BackendSettingsSection
								hideInterfaceLanguage
								hideModelEffort
								hideAgentMessages
								hideSpeechShortcuts
								focusKey={
									/*
									 * A search jump outranks a URL deep link: it is the most recent
									 * intent, and both resolve to the same keyed row. The nonce is
									 * what makes a SECOND Enter on the same result land again.
									 */
									searchJump
										? searchJump.key
										: settingFocusKey &&
												sectionForSettingKey(settingFocusKey, "backend") ===
													"backend"
											? settingFocusKey
											: null
								}
								focusNonce={searchJump?.nonce}
								initialFilter={settingsSearchFilter}
							/>
						</SettingsSection>

						<div
							ref={sectionRefs.imports}
							/* A DESTINATION, even though its controls are ignored: the
							   sidebar indexes this section, and a section result that
							   cannot land is a dead result (review round 1, B1). */
							data-search-section="imports"
							data-search-section-label={t("ui.settings.imports.title")}
							data-search-ignore="imports are a one-off task list, not a setting"
						>
							<ImportSettingsSection />
						</div>

						<div
							ref={sectionRefs.updates}
							data-search-section="updates"
							data-search-section-label={t(
								"ui.settings.navigation.settings_sidebar.application_updates",
							)}
							data-search-ignore="application updates are an action surface, not a setting"
						>
							<AppUpdatesSection />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
