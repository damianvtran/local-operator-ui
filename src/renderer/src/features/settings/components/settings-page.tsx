import radientIcon from "@assets/radient-icon-1024x1024.png";
import {
	faAdjust,
	faChartLine,
	faCreditCard,
	faDatabase,
	faEnvelope,
	faExternalLinkAlt,
	faHistory,
	faInfoCircle,
	faKey,
	faListAlt,
	faPlusCircle,
	faRobot,
	faUser,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Button,
	CircularProgress,
	Divider,
	Grid,
	Paper,
	Skeleton,
	Stack,
	ToggleButton,
	ToggleButtonGroup,
	Typography,
	useTheme,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ConfigUpdate } from "@shared/api/local-operator/types";
import { EditableField } from "@shared/components/common/editable-field";
import { PageHeader } from "@shared/components/common/page-header";
import { SectionTitle } from "@shared/components/common/section-title";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { useConfig } from "@shared/hooks/use-config";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useCreditBalance } from "@shared/hooks/use-credit-balance";
import { useModels } from "@shared/hooks/use-models";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { useUsageRollup } from "@shared/hooks/use-usage-rollup";
import { useUserStore } from "@shared/store/user-store";
import { format, formatRFC3339, parseISO, subDays } from "date-fns";
import { Settings, PlayCircle } from "lucide-react"; // Added PlayCircle for tour button
import { useEffect, useMemo, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import {
	CartesianGrid,
	Line,
	LineChart,
	ResponsiveContainer,
	Tooltip,
	XAxis,
	YAxis,
} from "recharts";
import { AppUpdatesSection } from "./app-updates-section";
import { Credentials } from "./credentials";
import { GoogleIntegrationsSection } from "./integrations-section";
import { RadientAccountSection } from "./radient-account-section";
import {
	FieldsContainer,
	InfoBox,
	InfoGrid,
	InfoLabel,
	InfoValue,
	SettingsSectionCard,
} from "./settings-section-card";
import { DEFAULT_SETTINGS_SECTIONS, SettingsSidebar } from "./settings-sidebar";
import { SystemPrompt } from "./system-prompt";
import { ThemeSelector } from "./theme-selector";
import { useOnboardingTour } from "@features/onboarding/hooks/use-onboarding-tour";
import { useOnboardingStore } from "@shared/store/onboarding-store"; // Re-add this import

// --- Billing Info Component ---
const BillingInfo: FC = () => {
	const theme = useTheme(); // Get theme for styling
	const {
		data: creditData,
		isLoading,
		error,
	} = useCreditBalance({ enabled: true });

	return (
		<Box>
			<SectionTitle
				title="Radient Pass"
				icon={faCreditCard}
				variant="h6" // Use h6 for subsection title
				gutterBottom
			/>
			{isLoading && <Skeleton variant="text" width={150} height={24} />}
			{error && (
				<Alert severity="warning" sx={{ mb: 2 }}>
					Could not load credit balance: {error.message}
				</Alert>
			)}
			{creditData && !isLoading && !error && (
				<Stack
					direction={{ xs: "column", sm: "row" }} // Stack vertically on small screens
					spacing={1.5} // Consistent spacing
					alignItems={{ xs: "flex-start", sm: "center" }} // Align items
				>
					<Typography variant="body2" sx={{ flexGrow: 1 }}>
						{" "}
						{/* Use body2 for consistency */}
						Available Credits:{" "}
						<Typography component="span" fontWeight="medium">
							{creditData.balance.toFixed(2)}
						</Typography>
					</Typography>
					<Button
						variant="outlined"
						size="small" // Keep size small
						href="https://console.radienthq.com/dashboard/billing"
						target="_blank"
						rel="noopener noreferrer"
						startIcon={<FontAwesomeIcon icon={faPlusCircle} size="xs" />} // Smaller icon
						sx={{
							// Shadcn-like subtle outline button
							borderColor: theme.palette.divider,
							color: theme.palette.text.secondary,
							textTransform: "none",
							fontSize: "0.8125rem", // ~13px
							padding: theme.spacing(0.5, 1.5),
							borderRadius: theme.shape.borderRadius * 0.75,
							"&:hover": {
								backgroundColor: theme.palette.action.hover,
								borderColor: theme.palette.divider,
							},
						}}
					>
						Add Credits
					</Button>
				</Stack>
			)}
		</Box>
	);
};

// --- Usage Info Component ---
const UsageInfo: FC = () => {
	const theme = useTheme();
	const [dataType, setDataType] = useState<"credits" | "tokens">("credits");

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

	const handleDataTypeChange = (
		_: React.MouseEvent<HTMLElement>,
		newDataType: "credits" | "tokens" | null,
	) => {
		if (newDataType !== null) {
			setDataType(newDataType);
		}
	};

	const yAxisLabel =
		dataType === "credits" ? "Credits Consumed" : "Tokens Used";
	const lineDataKey = dataType === "credits" ? "credits" : "tokens";
	const lineColor = theme.palette.primary.main;

	return (
		<Box>
			<Stack
				direction={{ xs: "column", sm: "row" }} // Responsive direction
				justifyContent="space-between"
				alignItems={{ xs: "flex-start", sm: "center" }} // Responsive alignment
				mb={2.5} // Consistent margin
				gap={1.5} // Add gap for spacing on small screens
			>
				<SectionTitle
					title="Usage (Last 30 Days)"
					icon={faChartLine}
					variant="h6" // Use h6 for subsection title
					// Remove margin bottom as Stack handles spacing
				/>
				<ToggleButtonGroup
					value={dataType}
					exclusive
					onChange={handleDataTypeChange}
					aria-label="Usage data type"
					size="small"
					sx={{
						"& .MuiToggleButtonGroup-grouped": {
							margin: theme.spacing(0.5),
							border: 0,
							"&.Mui-selected": {
								backgroundColor: theme.palette.action.selected,
								color: theme.palette.text.primary,
								"&:hover": {
									backgroundColor: theme.palette.action.selected,
								},
							},
							"&:not(.Mui-selected)": {
								color: theme.palette.text.secondary,
							},
							"&:hover": {
								backgroundColor: theme.palette.action.hover,
							},
							borderRadius: `${theme.shape.borderRadius * 0.75}px !important`,
							padding: theme.spacing(0.5, 1.5),
							textTransform: "none",
							fontSize: "0.8125rem",
						},
						border: `1px solid ${theme.palette.divider}`,
						borderRadius: theme.shape.borderRadius * 0.5,
						padding: theme.spacing(0.25),
						backgroundColor: theme.palette.background.default,
					}}
				>
					<ToggleButton value="credits" aria-label="Show credits">
						Credits
					</ToggleButton>
					<ToggleButton value="tokens" aria-label="Show tokens">
						Tokens
					</ToggleButton>
				</ToggleButtonGroup>
			</Stack>

			{isLoading && (
				<Skeleton variant="rectangular" width="100%" height={250} />
			)}
			{error && (
				<Alert severity="warning" sx={{ mb: 2 }}>
					Could not load usage data: {error.message}
				</Alert>
			)}
			{!isLoading && !error && usageData && chartData.length > 0 && (
				<Box sx={{ width: "100%", height: 250 }}>
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={chartData}
							margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
						>
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={theme.palette.divider}
							/>
							<XAxis
								dataKey="date"
								stroke={theme.palette.text.secondary}
								fontSize={12}
								tickLine={false} // Cleaner look
								axisLine={false} // Cleaner look
							/>
							<YAxis
								stroke={theme.palette.text.secondary}
								fontSize={12}
								tickLine={false}
								axisLine={false}
								label={{
									value: yAxisLabel,
									angle: -90,
									position: "insideLeft",
									offset: -5,
									style: {
										textAnchor: "middle",
										fill: theme.palette.text.secondary,
										fontSize: 12,
									},
								}}
							/>
							<Tooltip
								cursor={{ fill: theme.palette.action.hover }} // Subtle hover effect
								contentStyle={{
									backgroundColor: theme.palette.background.paper,
									borderColor: theme.palette.divider,
									borderRadius: theme.shape.borderRadius * 0.75, // Consistent radius
									padding: theme.spacing(1, 1.5), // Adjust padding
									boxShadow: theme.shadows[2], // Subtle shadow
								}}
								itemStyle={{
									color: theme.palette.text.primary,
									fontSize: "0.8125rem",
								}}
								labelStyle={{
									color: theme.palette.text.secondary,
									fontSize: "0.75rem",
									marginBottom: theme.spacing(0.5),
								}}
							/>
							<Line
								type="monotone"
								dataKey={lineDataKey}
								stroke={lineColor}
								strokeWidth={2}
								dot={false}
								activeDot={{ r: 6, strokeWidth: 0, fill: lineColor }} // Style active dot
								name={yAxisLabel}
							/>
						</LineChart>
					</ResponsiveContainer>
				</Box>
			)}
			{!isLoading && !error && (!usageData || chartData.length === 0) && (
				<Typography variant="body2" color="text.secondary" sx={{ mt: 2 }}>
					No usage data available for the selected period.
				</Typography>
			)}
		</Box>
	);
};

// --- Main Settings Page Component ---

const StyledPaper = styled(Paper)(({ theme }) => ({
	height: "100%", // Occupy full viewport height
	width: "100%", // Occupy full viewport width
	display: "flex",
	overflow: "hidden", // Prevent layout issues with fixed sidebar/scrollable content
	backgroundColor: theme.palette.background.default, // Use default background
	[theme.breakpoints.down("md")]: {
		flexDirection: "column",
	},
}));

const ContentContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	overflowY: "auto", // Only vertical scroll
	overflowX: "hidden", // Hide horizontal scroll
	padding: theme.spacing(4), // Consistent padding (32px)
	[theme.breakpoints.down("md")]: {
		padding: theme.spacing(3), // Reduce padding on medium screens (24px)
	},
	[theme.breakpoints.down("sm")]: {
		padding: theme.spacing(2), // Reduce padding on small screens (16px)
	},
	// Shadcn-like scrollbar styling
	"&::-webkit-scrollbar": {
		width: "8px",
		height: "8px", // Also style horizontal scrollbar if it appears
	},
	"&::-webkit-scrollbar-track": {
		backgroundColor: "transparent", // Make track invisible
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor: theme.palette.divider, // Use divider color for thumb
		borderRadius: "4px",
		border: `2px solid ${theme.palette.background.default}`, // Create padding around thumb
		"&:hover": {
			backgroundColor: theme.palette.text.disabled, // Slightly darker on hover
		},
	},
}));

const SidebarContainer = styled(Box)(({ theme }) => ({
	width: 260, // Slightly narrower sidebar
	flexShrink: 0,
	borderRight: `1px solid ${theme.palette.divider}`, // Add border like shadcn examples
	backgroundColor: theme.palette.background.paper, // Sidebar background
	overflowY: "auto", // Allow sidebar scrolling if needed
	[theme.breakpoints.down("md")]: {
		width: "100%",
		borderRight: "none", // Remove border on mobile
		borderBottom: `1px solid ${theme.palette.divider}`, // Add bottom border instead
		maxHeight: "40vh", // Limit height on mobile
	},
}));

const LoadingContainer = styled(Box)({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	height: "100%", // Take full height of parent
});

const ErrorContainer = styled(Box)(({ theme }) => ({
	padding: theme.spacing(3), // Consistent padding
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	height: "100%",
}));

// Main content area wrapper within ContentContainer
const MainContentWrapper = styled(Box)(({ theme }) => ({
	paddingTop: theme.spacing(1),
}));

// Specific styling for the Radient icon image
const IconImage = styled("img")({
	width: 32, // Slightly smaller icon
	height: 32,
	objectFit: "contain",
});

// Custom Title Component for Radient Section
const RadientSectionTitle: FC = () => (
	<Stack
		direction={{ xs: "column", sm: "row" }}
		spacing={{ xs: 1.5, sm: 2 }} // Responsive spacing
		justifyContent="space-between"
		alignItems={{ xs: "flex-start", sm: "center" }}
		mb={3} // Margin below the entire title block
	>
		<Box>
			<Typography
				variant="h5" // Keep h5 for major section title
				fontWeight="500"
				display="flex"
				alignItems="center"
				gap={1.5} // Consistent gap
				mb={0.5} // Reduced margin bottom
			>
				<IconImage src={radientIcon} alt="Radient Icon" />
				Radient Account
			</Typography>
			{/* Description moved to SettingsSectionCard prop */}
		</Box>
		<Button
			variant="outlined" // Use outlined for secondary action
			color="primary"
			href="https://console.radienthq.com"
			target="_blank"
			rel="noopener noreferrer"
			endIcon={<FontAwesomeIcon icon={faExternalLinkAlt} size="xs" />} // xs icon
			sx={(theme) => ({
				// Shadcn-inspired subtle outline button
				borderColor: theme.palette.divider,
				color: theme.palette.text.secondary,
				textTransform: "none",
				fontSize: "0.8125rem", // ~13px
				padding: theme.spacing(0.5, 1.5),
				borderRadius: theme.shape.borderRadius * 0.75,
				"&:hover": {
					backgroundColor: theme.palette.action.hover,
					borderColor: theme.palette.divider,
				},
				// Responsive alignment
				mt: { xs: 1, sm: 0 },
				alignSelf: { xs: "flex-start", sm: "center" },
			})}
		>
			Go to Radient Console
		</Button>
	</Stack>
);

export const SettingsPage: FC = () => {
	const {
		data: config,
		isLoading: isConfigLoading,
		error: configError,
		refetch, // Keep refetch
	} = useConfig();
	const updateConfigMutation = useUpdateConfig();
	const [savingField, setSavingField] = useState<string | null>(null);
	const userStore = useUserStore();
	const { isAuthenticated, isLoading: isAuthLoading } = useRadientAuth();
	const [activeSection, setActiveSection] = useState<string>("general");
	const [isScrolling, setIsScrolling] = useState(false);
	const scrollTimeoutRef = useRef<NodeJS.Timeout | null>(null); // Ref for scroll timeout
	const { startTour: startOnboardingTour } = useOnboardingTour();
	const { isModalComplete, isTourComplete } = useOnboardingStore(); // Ensure this is present

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
	const handleSelectSection = (sectionId: string) => {
		setActiveSection(sectionId); // Update state immediately for visual feedback
		setIsScrolling(true); // Prevent scroll listener from interfering

		const ref = sectionRefs[sectionId];
		const contentContainer = document.querySelector("[data-settings-content]");

		if (ref?.current && contentContainer) {
			const containerRect = contentContainer.getBoundingClientRect();
			const elementRect = ref.current.getBoundingClientRect();
			// Calculate scroll position relative to the container, adding container's current scroll position
			const scrollTop =
				elementRect.top - containerRect.top + contentContainer.scrollTop;

			// Scroll with offset for the sticky header/padding
			contentContainer.scrollTo({
				top: scrollTop - 80, // Adjust offset as needed (e.g., header height + padding)
				behavior: "smooth",
			});

			// Clear any existing timeout
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}

			// Set a timeout to re-enable scroll listening after the smooth scroll likely finishes
			scrollTimeoutRef.current = setTimeout(() => {
				setIsScrolling(false);
				scrollTimeoutRef.current = null; // Clear the ref after timeout
			}, 600); // Adjust duration if needed
		} else {
			// Fallback or if container not found
			setIsScrolling(false); // Re-enable immediately if scroll fails
		}
	};

	// Update active section based on scroll position
	useEffect(() => {
		const contentContainer = document.querySelector("[data-settings-content]");
		if (!contentContainer) return undefined; // Exit if container not found

		const handleScroll = () => {
			// If programmatic scrolling is active, or timeout is running, ignore scroll events
			if (isScrolling || scrollTimeoutRef.current) return;

			const scrollPosition = contentContainer.scrollTop + 100; // Offset for activation point

			// Find the section currently in view
			let currentSection = "";
			for (const [sectionId, ref] of Object.entries(sectionRefs)) {
				if (ref.current) {
					const { offsetTop, offsetHeight } = ref.current;
					// Check if the top of the section is within the activation zone
					if (
						scrollPosition >= offsetTop &&
						scrollPosition < offsetTop + offsetHeight
					) {
						currentSection = sectionId;
						break; // Found the active section
					}
				}
			}

			// Update state only if the active section has changed
			if (currentSection && currentSection !== activeSection) {
				setActiveSection(currentSection);
			}
		};

		contentContainer.addEventListener("scroll", handleScroll, {
			passive: true,
		}); // Use passive listener

		// Cleanup function
		return () => {
			contentContainer.removeEventListener("scroll", handleScroll);
			// Clear timeout on unmount
			if (scrollTimeoutRef.current) {
				clearTimeout(scrollTimeoutRef.current);
			}
		};
	}, [sectionRefs, activeSection, isScrolling]); // Rerun effect if refs, activeSection, or scrolling state changes

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
			<StyledPaper elevation={0}>
				<LoadingContainer>
					<CircularProgress />
				</LoadingContainer>
			</StyledPaper>
		);
	}

	if (configError || !config) {
		return (
			<StyledPaper elevation={0}>
				<ErrorContainer>
					<Alert severity="error" sx={{ width: "100%", maxWidth: 600 }}>
						Failed to load configuration. Please try again later.{" "}
						{configError?.message}
					</Alert>
				</ErrorContainer>
			</StyledPaper>
		);
	}

	return (
		<StyledPaper elevation={0}>
			{/* Settings Sidebar */}
			<SidebarContainer>
				<SettingsSidebar
					activeSection={activeSection}
					onSelectSection={handleSelectSection}
					sections={DEFAULT_SETTINGS_SECTIONS}
				/>
			</SidebarContainer>

			{/* Scrollable Content Area */}
			<ContentContainer data-settings-content>
				<PageHeader
					title="Settings"
					icon={Settings}
					subtitle="Configure your application preferences and settings"
				/>

				{/* Main Content Wrapper */}
				<MainContentWrapper>
					{/* General Settings Section (using Grid for layout) */}
					{/* Assign ref directly to the outer Box for scrolling */}
					<Box ref={sectionRefs.general}>
						<Grid container spacing={3}>
							{/* Left Column */}
							<Grid item xs={12} md={6}>
								{/* User Profile Settings */}
								<SettingsSectionCard
									title="User Profile"
									icon={faUser}
									description="Update your user profile information displayed in the application."
								>
									<FieldsContainer>
										<EditableField
											value={userStore.profile.name}
											label="Display Name"
											placeholder="Enter your name..."
											icon={<FontAwesomeIcon icon={faUser} fixedWidth />}
											isSaving={savingField === "user_name"}
											onSave={async (value) => {
												setSavingField("user_name");
												try {
													userStore.updateName(value);
												} finally {
													setSavingField(null);
												}
											}}
										/>
										<EditableField
											value={userStore.profile.email}
											label="Email Address"
											placeholder="Enter your email..."
											icon={<FontAwesomeIcon icon={faEnvelope} fixedWidth />}
											isSaving={savingField === "user_email"}
											onSave={async (value) => {
												setSavingField("user_email");
												try {
													userStore.updateEmail(value);
												} finally {
													setSavingField(null);
												}
											}}
										/>
									</FieldsContainer>
								</SettingsSectionCard>

								{/* Onboarding Tour Button */}
								{isModalComplete && !isTourComplete && (
									<SettingsSectionCard
										title="Application Tour"
										// icon={PlayCircle} // Removed icon to resolve TS error, can be re-added with proper type handling
										description="Missed the tour or want a refresher? Start it again here."
									>
										<FieldsContainer>
											<Button
												variant="outlined"
												onClick={() => startOnboardingTour({ forceModalCompleted: true })}
												startIcon={<PlayCircle size={18} />} // Lucide icon used directly in startIcon
											>
												Resume Onboarding Tour
											</Button>
										</FieldsContainer>
									</SettingsSectionCard>
								)}

								{/* Model Settings */}
								<SettingsSectionCard
									title="Model Settings"
									icon={faRobot}
									description="Configure the AI model and hosting provider used for generating responses."
								>
									<FieldsContainer>
										<HostingSelect
											value={config.values.hosting}
											isSaving={savingField === "hosting"}
											onSave={(value) => handleUpdateField("hosting", value)}
											filterByCredentials={true}
											allowCustom={true}
										/>
										<ModelSelect
											value={config.values.model_name}
											hostingId={config.values.hosting}
											isSaving={savingField === "model_name"}
											onSave={(value) => handleUpdateField("model_name", value)}
											allowCustom={true}
										/>
									</FieldsContainer>
								</SettingsSectionCard>

								{/* System Prompt Settings - Assuming SystemPrompt is already a card-like structure or self-contained */}
								<SystemPrompt />
							</Grid>

							{/* Right Column */}
							<Grid item xs={12} md={6}>
								{/* History Settings */}
								<SettingsSectionCard
									title="History Settings"
									icon={faHistory}
									description="Configure how much conversation history is retained and displayed."
								>
									{/* Assuming SliderSetting is styled appropriately */}
									<FieldsContainer>
										<SliderSetting
											value={config.values.conversation_length}
											label="Maximum Conversation History"
											description="Number of messages to keep in conversation history for context. More messages will make the agents have longer memory but more expensive to run.  Recommended: 100"
											min={10}
											max={200}
											step={10}
											unit="msgs"
											icon={faHistory}
											isSaving={savingField === "conversation_length"}
											onChange={(value) =>
												handleUpdateField("conversation_length", value)
											}
										/>
										<SliderSetting
											value={config.values.detail_length}
											label="Detail View Length"
											description="Maximum number of messages to show in the detailed conversation view. Messages beyond this limit will be summarized. Shortening this will decrease costs but some important details could get lost from earlier messages.  Recommended: 20"
											min={10}
											max={100}
											step={5}
											unit="msgs"
											icon={faListAlt}
											isSaving={savingField === "detail_length"}
											onChange={(value) =>
												handleUpdateField("detail_length", value)
											}
										/>
										<SliderSetting
											value={config.values.max_learnings_history}
											label="Maximum Learnings History"
											description="Number of learning items to retain for context and personalization. More items will make the agents acquire a longer history of knowledge from your conversations but more expensive to run.  Recommended: 50"
											min={10}
											max={100}
											step={10}
											unit="items"
											icon={faDatabase}
											isSaving={savingField === "max_learnings_history"}
											onChange={(value) =>
												handleUpdateField("max_learnings_history", value)
											}
										/>
									</FieldsContainer>
								</SettingsSectionCard>

								{/* Configuration Metadata */}
								<SettingsSectionCard
									title="Configuration Information"
									icon={faInfoCircle}
									description="System information about the current configuration."
								>
									<InfoGrid>
										<InfoBox>
											<InfoLabel>Version</InfoLabel>
											<InfoValue>{config.version}</InfoValue>
										</InfoBox>
										<InfoBox>
											<InfoLabel>Created At</InfoLabel>
											<InfoValue>
												{new Date(config.metadata.created_at).toLocaleString()}
											</InfoValue>
										</InfoBox>
										<InfoBox>
											<InfoLabel>Last Modified</InfoLabel>
											<InfoValue>
												{new Date(
													config.metadata.last_modified,
												).toLocaleString()}
											</InfoValue>
										</InfoBox>
										<InfoBox>
											<InfoLabel>Description</InfoLabel>
											<InfoValue>
												{config.metadata.description ||
													"No description available"}
											</InfoValue>
										</InfoBox>
									</InfoGrid>
								</SettingsSectionCard>
							</Grid>
						</Grid>
					</Box>

					{/* Radient Account Section */}
					<SettingsSectionCard
						title="Radient Account" // Title is handled by titleComponent
						titleComponent={<RadientSectionTitle />}
						description="Manage your Radient account, Radient Pass details, and credits." // Description passed here
						cardRef={sectionRefs.radient} // Assign ref
					>
						{/* Render RadientAccountSection always */}
						<RadientAccountSection
							onAfterCredentialUpdate={() => {
								refreshModels();
								refetchCredentials();
							}}
						/>

						{/* Conditionally render Billing and Usage if authenticated */}
						{isAuthenticated && (
							<>
								<Divider sx={{ my: 3 }} />
								<BillingInfo />
								<Divider sx={{ my: 3 }} />
								<UsageInfo />
							</>
						)}
					</SettingsSectionCard>

					{/* Google Integrations Section - Rendered Unconditionally */}
					{/* The component itself will handle auth state for its connect buttons */}
					<Box ref={sectionRefs.integrations}>
						<GoogleIntegrationsSection />
					</Box>

					{/* Appearance Section */}
					<SettingsSectionCard
						title="Appearance"
						icon={faAdjust}
						description="Customize the look and feel of Local Operator"
						cardRef={sectionRefs.appearance} // Assign ref
					>
						<ThemeSelector />
					</SettingsSectionCard>

					{/* API Credentials Section */}
					<SettingsSectionCard
						title="API Credentials"
						icon={faKey}
						description="Manage your API keys for various services and integrations"
						cardRef={sectionRefs.credentials} // Assign ref
					>
						<Credentials />
					</SettingsSectionCard>

					{/* App Updates Section - Assuming AppUpdatesSection is self-contained */}
					{/* Assign ref directly to the component if it renders a suitable root element, or wrap */}
					<Box ref={sectionRefs.updates}>
						<AppUpdatesSection />
					</Box>
				</MainContentWrapper>
			</ContentContainer>
		</StyledPaper>
	);
};
