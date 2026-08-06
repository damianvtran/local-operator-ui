import { useOnboardingTour } from "@features/onboarding/hooks/use-onboarding-tour";
import type { ConfigUpdate } from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { PageHeader } from "@shared/components/common/page-header";
import { RadientMark } from "@shared/components/common/radient-mark";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { Spinner } from "@shared/components/common/spinner";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { Alert, Button, Skeleton } from "@shared/components/ui";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useCreditBalance } from "@shared/hooks/use-credit-balance";
import { useModels } from "@shared/hooks/use-models";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { useUsageRollup } from "@shared/hooks/use-usage-rollup";
import { cn } from "@shared/lib/utils";
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
	Database,
	ExternalLink,
	History,
	Info,
	Key,
	List,
	MessagesSquare,
	Settings,
	SlidersHorizontal,
	User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import { useLocation } from "react-router-dom";
import {
	CartesianGrid,
	Line,
	LineChart,
	Tooltip as RechartsTooltip,
	ResponsiveContainer,
	XAxis,
	YAxis,
} from "recharts";
import { AppUpdatesSection } from "./app-updates-section";
import { Credentials } from "./credentials";
import { GoogleIntegrationsSection } from "./integrations-section";
import { RadientAccountSection } from "./radient-account-section";
import { InfoGrid, InfoItem, SettingsSection } from "./settings-section";
import { DEFAULT_SETTINGS_SECTIONS, SettingsSidebar } from "./settings-sidebar";
import { SystemPrompt } from "./system-prompt";
import { ThemeSelector } from "./theme-selector";

const BillingInfo: FC = () => {
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
				Radient Pass
			</h3>
			{isLoading && <Skeleton className="h-6 w-36" />}
			{error && (
				<Alert variant="warning">
					Could not load your credit balance. {error.message}
				</Alert>
			)}
			{creditData && !isLoading && !error && (
				<div className="flex flex-col gap-3 sm:flex-row sm:items-center">
					<p className="flex-1 text-body-sm text-ink-muted">
						Available credits{" "}
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
							Add credits
						</a>
					</Button>
				</div>
			)}
		</div>
	);
};

type UsageMetric = "credits" | "tokens";

const USAGE_METRICS: { id: UsageMetric; label: string }[] = [
	{ id: "credits", label: "Credits" },
	{ id: "tokens", label: "Tokens" },
];

/**
 * The usage chart's own tooltip.
 *
 * Recharts' default panel is configured with `contentStyle` / `itemStyle` /
 * `labelStyle` objects, which take literal colours and cannot read a role. A
 * custom renderer is the only way to theme it, and it also lets the panel use
 * the same anatomy as every other overlay in the app: `elevated` ground,
 * `shadow-overlay`, and monospace for the number because a number is machine
 * voice.
 */
const UsageTooltip: FC<{
	active?: boolean;
	label?: string;
	payload?: { value?: number | string; name?: string }[];
	unit: string;
}> = ({ active, label, payload, unit }) => {
	if (!active || !payload?.length) return null;

	return (
		<div className="rounded-md border border-hairline bg-elevated px-3 py-2 shadow-overlay">
			<p className="text-meta text-ink-dim">{label}</p>
			<p className="text-mono text-ink">
				{payload[0]?.value} {unit}
			</p>
		</div>
	);
};

const UsageInfo: FC = () => {
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
		return sortedDataPoints.map((point) => ({
			date: format(parseISO(point.timestamp), "MMM dd"),
			credits: Number.parseFloat(point.total_cost.toFixed(2)),
			tokens: point.total_tokens,
		}));
	}, [usageData]);

	return (
		<div>
			<div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
				<h3 className="flex items-center gap-2 text-heading text-ink">
					<ChartLine size={16} className="shrink-0 text-ink-dim" />
					Usage (last 30 days)
				</h3>
				{/*
				 * A segmented pair rather than `Tabs`: the two options change which
				 * series the one chart plots, they do not swap panels, and Radix's
				 * `TabsTrigger` would point `aria-controls` at a `TabsContent` that
				 * does not exist. `aria-pressed` describes what these actually are.
				 */}
				<fieldset className="m-0 w-fit border-0 p-0">
					<legend className="sr-only">Usage metric</legend>
					<div className="flex gap-0.5 rounded-md bg-sunken p-0.5">
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
					Could not load your usage data. {error.message}
				</Alert>
			)}
			{!isLoading && !error && usageData && chartData.length > 0 && (
				/*
				 * Recharts is styled from here, by descendant selector, rather than
				 * through its colour props. Those props land as SVG presentation
				 * attributes, which cannot take a `var()`, so a themed chart would
				 * otherwise have to read palette hexes through `useTheme` — the one
				 * thing this port is removing. A CSS rule beats a presentation
				 * attribute, so these win, and the class names are recharts' own
				 * documented ones.
				 */
				<div
					className={cn(
						"h-62 w-full",
						"[&_.recharts-cartesian-grid_line]:stroke-hairline",
						"[&_.recharts-cartesian-axis-tick-value]:fill-ink-dim [&_.recharts-cartesian-axis-tick-value]:text-meta",
						"[&_.recharts-line-curve]:stroke-accent",
						"[&_.recharts-active-dot_circle]:fill-accent",
						"[&_.recharts-tooltip-cursor]:stroke-hairline",
					)}
				>
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={chartData}
							margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis dataKey="date" tickLine={false} axisLine={false} />
							<YAxis tickLine={false} axisLine={false} width={48} />
							<RechartsTooltip
								content={
									<UsageTooltip
										unit={dataType === "credits" ? "credits" : "tokens"}
									/>
								}
							/>
							<Line
								type="monotone"
								dataKey={dataType}
								strokeWidth={2}
								dot={false}
								activeDot={{ r: 4, strokeWidth: 0 }}
								name={
									dataType === "credits" ? "Credits consumed" : "Tokens used"
								}
							/>
						</LineChart>
					</ResponsiveContainer>
				</div>
			)}
			{!isLoading && !error && (!usageData || chartData.length === 0) && (
				<p className="text-body-sm text-ink-muted">
					No usage recorded in the last 30 days.
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
const RadientSectionTitle: FC = () => (
	<div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
		<h2 className="flex items-center gap-2 text-heading text-ink">
			<RadientMark size={16} className="shrink-0 text-ink-dim" />
			Radient account
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
				Go to Radient console
				<ExternalLink />
			</a>
		</Button>
	</div>
);

export const SettingsPage: FC = () => {
	const {
		data: config,
		isLoading: isConfigLoading,
		error: configError,
		refetch,
	} = useConfig();
	const updateConfigMutation = useUpdateConfig();
	const [savingField, setSavingField] = useState<string | null>(null);
	const userStore = useUserStore();
	const { isAuthenticated, isLoading: isAuthLoading } = useRadientAuth();
	const [activeSection, setActiveSection] = useState<string>("general");
	const [isScrolling, setIsScrolling] = useState(false);
	const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null);
	const contentContainerRef = useRef<HTMLDivElement>(null);
	const { startTour: startOnboardingTour } = useOnboardingTour();
	const location = useLocation();

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
		credentials: useRef<HTMLDivElement>(null),
		updates: useRef<HTMLDivElement>(null),
	}).current;

	// Handle section selection from sidebar
	const handleSelectSection = useCallback(
		(sectionId: string) => {
			setActiveSection(sectionId); // Update state immediately for visual feedback
			setIsScrolling(true); // Prevent scroll listener from interfering

			const ref = sectionRefs[sectionId];
			const contentContainer = contentContainerRef.current;

			if (ref?.current && contentContainer) {
				// Get the element's position relative to the container's scroll area
				const elementOffsetTop = ref.current.offsetTop;

				// Scroll with offset for better positioning (accounting for header/padding)
				const targetScrollTop = Math.max(0, elementOffsetTop - 80);

				contentContainer.scrollTo({
					top: targetScrollTop,
					behavior: "smooth",
				});

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

		if (sectionFromQuery && sectionRefs[sectionFromQuery]) {
			// Check if the section exists in our refs
			// A short delay can help ensure the layout is stable before scrolling
			const timer = setTimeout(() => {
				handleSelectSection(sectionFromQuery);
			}, 100); // 100ms delay, adjust if needed

			return () => clearTimeout(timer); // Cleanup timer
		}

		return undefined;
	}, [location.search, sectionRefs, handleSelectSection]); // Rerun when URL search params change or refs are updated

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

	// Combine loading states
	const isLoading = isConfigLoading || isAuthLoading;

	if (isLoading) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-canvas">
				<Spinner size="lg" label="Loading settings" />
			</div>
		);
	}

	if (configError || !config) {
		return (
			<div className="flex h-full w-full items-center justify-center bg-canvas p-6">
				<Alert variant="danger" className="w-full max-w-xl">
					Could not load your settings. The Local Operator server may not be
					running. {configError?.message}
				</Alert>
			</div>
		);
	}

	return (
		<div className="flex h-full w-full overflow-hidden bg-canvas max-md:flex-col">
			{/*
			 * The rail's edge lives here rather than on the nav, because only the
			 * container knows which way the layout is running: the same hairline has
			 * to be a right edge beside the content and a bottom edge above it.
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
			<div className="w-12 shrink-0 overflow-y-auto border-r border-hairline min-[1040px]:w-55 max-md:max-h-[40vh] max-md:w-full max-md:border-r-0 max-md:border-b">
				<SettingsSidebar
					activeSection={activeSection}
					onSelectSection={handleSelectSection}
					sections={DEFAULT_SETTINGS_SECTIONS}
				/>
			</div>

			<div
				ref={contentContainerRef}
				data-settings-content
				data-tour-tag="settings-general-section"
				className="flex-1 overflow-y-auto overflow-x-hidden p-4 sm:p-6 md:p-8"
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
					<PageHeader title="Settings" icon={Settings} />

					{/* Section tier: 32px between groupings, and no boundary between
					    them. */}
					<div className="flex flex-col gap-8">
						<div ref={sectionRefs.general} className="flex flex-col gap-8">
							<SettingsSection
								title="User profile"
								icon={User}
								description={`Your user profile information displayed in the application. This information is not provided to the agents. ${isAuthenticated ? "These details are provided through your Radient account." : ""}`}
							>
								{/*
								 * Neither field carries a glyph. The section heading is
								 * already a person, and a second person glyph 60px under it
								 * on "Display name" was the same picture twice for two
								 * different things. `Mail` goes with it rather than being
								 * kept alone: one indented label beside one flush label is a
								 * ragged column, and "Display name" and "Email address" are
								 * not words that need a picture to be told apart.
								 */}
								<div className="flex flex-col gap-4">
									<EditableField
										value={userStore.profile.name}
										label="Display name"
										placeholder="Enter your name..."
										isSaving={savingField === "user_name"}
										onSave={async (value) => {
											setSavingField("user_name");
											try {
												userStore.updateName(value);
											} finally {
												setSavingField(null);
											}
										}}
										readOnly={isAuthenticated}
									/>
									<EditableField
										value={userStore.profile.email}
										label="Email address"
										placeholder="Enter your email..."
										isSaving={savingField === "user_email"}
										onSave={async (value) => {
											setSavingField("user_email");
											try {
												userStore.updateEmail(value);
											} finally {
												setSavingField(null);
											}
										}}
										readOnly={isAuthenticated}
									/>
								</div>
							</SettingsSection>

							<SettingsSection
								title="Application tour"
								description="Missed the application onboarding tour or want a refresher? Start it again here."
							>
								<Button
									variant="secondary"
									onClick={() => {
										startOnboardingTour({ forceModalCompleted: true });
									}}
								>
									<CirclePlay />
									Take the tour
								</Button>
							</SettingsSection>

							{/* `SlidersHorizontal`, not `Cpu`: this section sets defaults for
							    two things, and `Cpu` is the Model select's own glyph a few
							    rows below it. One picture, one meaning. */}
							<SettingsSection
								title="Model settings"
								icon={SlidersHorizontal}
								description="Configure the default AI model and hosting providers used for generating responses. This will be used for all agents that don't have a specific model or hosting provider configured. You can override these settings for individual agents in the agent settings."
							>
								<div className="flex flex-col gap-4">
									<HostingSelect
										value={config.values.hosting}
										isSaving={savingField === "hosting"}
										onSave={(value) => handleUpdateField("hosting", value)}
										filterByCredentials={true}
										allowCustom={true}
										allowDefault={false}
										/* This IS Settings, so the default copy would send the
										   reader to the page they are already on. */
										emptyHelperText="No hosting providers available. Add one in API credentials, in the list on the left."
									/>
									<ModelSelect
										value={config.values.model_name}
										hostingId={config.values.hosting}
										isSaving={savingField === "model_name"}
										onSave={(value) => handleUpdateField("model_name", value)}
										allowCustom={true}
										allowDefault={false}
									/>
									<Alert
										variant="neutral"
										icon={<Info className="size-4" aria-hidden="true" />}
									>
										You need a Radient account or your own API keys to reach
										cloud providers. If you don't see more hosting providers and
										models here, add credentials or sign in to Radient.
									</Alert>
								</div>
							</SettingsSection>

							<SystemPrompt />

							<SettingsSection
								title="History settings"
								icon={History}
								description="Configure how much conversation history is retained and displayed. These are tools to help balance cost and performance by controlling the amount of data used by the agents."
							>
								<div className="flex flex-col gap-4">
									<SliderSetting
										value={config.values.conversation_length}
										label="Maximum conversation history"
										description="Number of messages to keep in conversation history for context. More messages will make the agents have longer memory but more expensive to run. Recommended: 100"
										min={10}
										max={500}
										step={10}
										unit="msgs"
										// `MessagesSquare`, not `History`: the section heading is
										// the history, this slider is a count of messages. Its two
										// siblings keep `List` and `Database`, so the label column
										// stays even.
										icon={MessagesSquare}
										isSaving={savingField === "conversation_length"}
										onChange={(value) =>
											handleUpdateField("conversation_length", value)
										}
									/>
									<SliderSetting
										value={config.values.detail_length}
										label="Detail view length"
										description="Maximum number of messages to show in the detailed conversation view. Messages beyond this limit will be summarized. Shortening this will decrease costs but some important details could get lost from earlier messages. Recommended: 15"
										min={10}
										max={500}
										step={5}
										unit="msgs"
										icon={List}
										isSaving={savingField === "detail_length"}
										onChange={(value) =>
											handleUpdateField("detail_length", value)
										}
									/>
									<SliderSetting
										value={config.values.max_learnings_history}
										label="Maximum learnings history"
										description="Agents note down specific insights and key learnings in memory which persist beyond the maximum conversation history and summarization. This setting controls the maximum number of learning items to retain. More items will make the agents acquire a longer history of knowledge from your conversations but more expensive to run. Recommended: 50"
										min={10}
										max={200}
										step={10}
										unit="notes"
										icon={Database}
										isSaving={savingField === "max_learnings_history"}
										onChange={(value) =>
											handleUpdateField("max_learnings_history", value)
										}
									/>
								</div>
							</SettingsSection>

							<SettingsSection
								title="Configuration information"
								icon={Info}
								description="System information about the current configuration."
							>
								<InfoGrid>
									<InfoItem
										label="Version"
										value={
											<span className="text-mono-sm">{config.version}</span>
										}
									/>
									<InfoItem
										label="Created"
										value={formatCalendarDate(config.metadata.created_at)}
									/>
									<InfoItem
										label="Last modified"
										value={formatCalendarDateTime(
											config.metadata.last_modified,
										)}
									/>
									<InfoItem
										label="Description"
										value={
											config.metadata.description || "No description available"
										}
									/>
								</InfoGrid>
							</SettingsSection>
						</div>

						<SettingsSection
							title="Appearance"
							icon={Contrast}
							description="Customize the look and feel of Local Operator"
							sectionRef={sectionRefs.appearance}
							dataTourTag="settings-appearance-section"
						>
							<ThemeSelector />
						</SettingsSection>

						<SettingsSection
							title="Radient account"
							titleComponent={<RadientSectionTitle />}
							description="Manage your Radient account, Radient Pass details, and credits."
							sectionRef={sectionRefs.radient}
							dataTourTag="settings-radient-account-section"
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

						{/*
						 * Rendered unconditionally: the section handles its own auth state
						 * for the connect buttons.
						 */}
						<div ref={sectionRefs.integrations}>
							<GoogleIntegrationsSection />
						</div>

						<SettingsSection
							title="API credentials"
							icon={Key}
							description="Manage your API keys for various services and integrations"
							sectionRef={sectionRefs.credentials}
							dataTourTag="settings-api-credentials-section"
						>
							<Credentials />
						</SettingsSection>

						<div ref={sectionRefs.updates}>
							<AppUpdatesSection />
						</div>
					</div>
				</div>
			</div>
		</div>
	);
};
