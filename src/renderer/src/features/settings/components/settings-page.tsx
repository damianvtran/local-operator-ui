import radientIcon from "@assets/radient-icon-1024x1024.png";
import {
	faAdjust,
	faChartLine,
	faCreditCard,
	faDatabase,
	faEnvelope,
	faExternalLinkAlt,
	faGear,
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
	Card,
	CardContent,
	CircularProgress,
	Container,
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
import { SliderSetting } from "@shared/components/common/slider-setting";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { useConfig } from "@shared/hooks/use-config";
import { useCreditBalance } from "@shared/hooks/use-credit-balance";
import { useRadientAuth } from "@shared/hooks/use-radient-auth";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { useUsageRollup } from "@shared/hooks/use-usage-rollup";
import { useUserStore } from "@shared/store/user-store";
import { format, formatRFC3339, parseISO, subDays } from "date-fns";
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
import { RadientAccountSection } from "./radient-account-section";
import { DEFAULT_SETTINGS_SECTIONS, SettingsSidebar } from "./settings-sidebar";
import { SystemPrompt } from "./system-prompt";
import { ThemeSelector } from "./theme-selector";

// --- Billing Info Component ---
const BillingInfo: FC = () => {
	const {
		data: creditData,
		isLoading,
		error,
	} = useCreditBalance({ enabled: true }); // Enable the query

	return (
		<Box mb={3}>
			<Typography
				variant="h6"
				display="flex"
				alignItems="center"
				gap={1}
				mb={1.5}
			>
				<FontAwesomeIcon icon={faCreditCard} />
				Radient Pass
			</Typography>
			{isLoading && <Skeleton variant="text" width={150} height={24} />}
			{error && (
				<Alert severity="warning" sx={{ mb: 1 }}>
					Could not load credit balance: {error.message}
				</Alert>
			)}
			{creditData && !isLoading && !error && (
				<Stack direction="row" spacing={2} alignItems="center">
					<Typography variant="body1">
						Available Credits:{" "}
						<Typography component="span" fontWeight="bold">
							{creditData.balance.toFixed(2)}
						</Typography>
					</Typography>
					<Button
						variant="outlined"
						size="small"
						href="https://console.radienthq.com/dashboard/billing"
						target="_blank"
						rel="noopener noreferrer"
						startIcon={<FontAwesomeIcon icon={faPlusCircle} size="sm" />}
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
	const [dataType, setDataType] = useState<"credits" | "tokens">("credits"); // State for toggle

	// Calculate date range for the last 30 days
	const usageParams = useMemo(() => {
		const endDate = new Date();
		const startDate = subDays(endDate, 30);
		return {
			start_date: formatRFC3339(startDate),
			end_date: formatRFC3339(endDate),
			rollup: "daily" as const, // Fetch daily usage for the last 30 days
		};
	}, []);

	const {
		data: usageData,
		isLoading,
		error,
	} = useUsageRollup(usageParams, { enabled: true }); // Enable the query

	// Prepare data for the chart
	const chartData = useMemo(() => {
		// Use data_points based on the updated type definition
		if (!usageData?.data_points) return [];
		// Sort records by timestamp
		const sortedDataPoints = [...usageData.data_points].sort(
			(a, b) =>
				parseISO(a.timestamp).getTime() - parseISO(b.timestamp).getTime(),
		);
		return sortedDataPoints.map((point) => ({
			date: format(parseISO(point.timestamp), "MMM dd"), // Use timestamp for date
			// Round total_cost to 2 decimal places for credits display
			credits: Number.parseFloat(point.total_cost.toFixed(2)),
			tokens: point.total_tokens, // Use total_tokens for tokens
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
	const lineColor = theme.palette.primary.main; // Use theme color

	return (
		<Box>
			<Stack
				direction="row"
				justifyContent="space-between"
				alignItems="center"
				mb={2} // Add margin below title/toggle row
			>
				<Typography variant="h6" display="flex" alignItems="center" gap={1}>
					<FontAwesomeIcon icon={faChartLine} />
					Usage (Last 30 Days)
				</Typography>
				<ToggleButtonGroup
					value={dataType}
					exclusive
					onChange={handleDataTypeChange}
					aria-label="Usage data type"
					size="small"
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
				// Show skeleton for the chart area
				<Skeleton variant="rectangular" width="100%" height={250} />
			)}
			{error && (
				<Alert severity="warning" sx={{ mb: 1 }}>
					Could not load usage data: {error.message}
				</Alert>
			)}
			{!isLoading && !error && usageData && chartData.length > 0 && (
				<Box sx={{ width: "100%", height: 250 }}>
					{" "}
					{/* Container for chart size */}
					<ResponsiveContainer width="100%" height="100%">
						<LineChart
							data={chartData}
							margin={{
								top: 5,
								right: 20, // Add some right margin for labels
								left: 10, // Add some left margin
								bottom: 5,
							}}
						>
							<CartesianGrid
								strokeDasharray="3 3"
								stroke={theme.palette.divider}
							/>
							<XAxis
								dataKey="date"
								stroke={theme.palette.text.secondary}
								fontSize={12}
							/>
							<YAxis
								stroke={theme.palette.text.secondary}
								fontSize={12}
								label={{
									// Add Y-axis label
									value: yAxisLabel,
									angle: -90,
									position: "insideLeft",
									offset: -5, // Adjust offset as needed
									style: {
										textAnchor: "middle",
										fill: theme.palette.text.secondary,
										fontSize: 12,
									},
								}}
							/>
							<Tooltip
								contentStyle={{
									backgroundColor: theme.palette.background.paper,
									borderColor: theme.palette.divider,
									borderRadius: theme.shape.borderRadius,
								}}
								itemStyle={{ color: theme.palette.text.primary }}
								labelStyle={{ color: theme.palette.text.secondary }}
							/>
							{/* <Legend /> */}
							<Line
								type="monotone"
								dataKey={lineDataKey}
								stroke={lineColor}
								strokeWidth={2}
								dot={false} // Hide dots for cleaner look
								activeDot={{ r: 6 }} // Style for active dot on hover
								name={yAxisLabel} // Name for tooltip
							/>
						</LineChart>
					</ResponsiveContainer>
				</Box>
			)}
			{!isLoading && !error && (!usageData || chartData.length === 0) && (
				// Handle case with no usage data
				<Typography variant="body2" color="text.secondary">
					No usage data available for the selected period.
				</Typography>
			)}
		</Box>
	);
};

// --- Main Settings Page Component ---

const StyledPaper = styled(Paper)(({ theme }) => ({
	height: "100%",
	width: "100%",
	display: "flex",
	[theme.breakpoints.down("md")]: {
		flexDirection: "column",
	},
}));

const ContentContainer = styled(Box)(({ theme }) => ({
	flexGrow: 1,
	overflow: "auto",
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
	[theme.breakpoints.up("md")]: {
		padding: 32,
	},
	"&::-webkit-scrollbar": {
		width: "8px",
	},
	"&::-webkit-scrollbar-thumb": {
		backgroundColor:
			theme.palette.mode === "dark"
				? "rgba(255, 255, 255, 0.1)" // Light scrollbar in dark mode
				: "rgba(0, 0, 0, 0.1)", // Dark scrollbar in light mode
		borderRadius: "4px",
	},
}));

const SidebarContainer = styled(Box)(({ theme }) => ({
	width: 280,
	flexShrink: 0,
	padding: 0,
	[theme.breakpoints.down("md")]: {
		width: "100%",
		padding: 0,
	},
}));

const LoadingContainer = styled(Box)(() => ({
	display: "flex",
	justifyContent: "center",
	alignItems: "center",
	height: "100%",
}));

const ErrorContainer = styled(Box)(() => ({
	padding: 24,
}));

const StyledContainer = styled(Container)(() => ({
	marginTop: 16,
}));

const StyledCard = styled(Card)(() => ({
	marginBottom: 32,
	backgroundColor: "background.paper",
	borderRadius: 8,
	boxShadow: "0 4px 20px rgba(0,0,0,0.06)",
}));

const CardTitle = styled(Typography)(() => ({
	marginBottom: 16,
	display: "flex",
	alignItems: "center",
	gap: 8,
}));

const CardDescription = styled(Typography)(() => ({
	marginBottom: 24,
	color: "text.secondary",
}));

const FieldsContainer = styled(Box)(() => ({
	display: "flex",
	flexDirection: "column",
	gap: 4,
}));

const InfoBox = styled(Box)(() => ({
	padding: 16,
	borderRadius: 8,
	backgroundColor: "background.default",
	height: "100%",
}));

const InfoLabel = styled(Typography)(() => ({
	color: "text.secondary",
	marginBottom: 8,
}));

const InfoValue = styled(Typography)(() => ({
	fontWeight: 500,
}));

const StyledCardContent = styled(CardContent)(({ theme }) => ({
	[theme.breakpoints.down("sm")]: {
		padding: 16,
	},
	[theme.breakpoints.up("sm")]: {
		padding: 24,
	},
}));

const IconImage = styled("img")(() => ({
	width: 40,
	height: 40,
	marginLeft: -4,
	objectFit: "contain",
}));

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
	const { isAuthenticated, isLoading: isAuthLoading } = useRadientAuth(); // Get auth status
	const [activeSection, setActiveSection] = useState<string>("general");
	const [isScrolling, setIsScrolling] = useState(false);

	// Refs for scrolling to sections
	const generalSectionRef = useRef<HTMLDivElement>(null);
	const radientSectionRef = useRef<HTMLDivElement>(null);
	const appearanceSectionRef = useRef<HTMLDivElement>(null);
	const credentialsSectionRef = useRef<HTMLDivElement>(null);
	const updatesSectionRef = useRef<HTMLDivElement>(null);

	// Map of section IDs to their refs - memoized to avoid recreation on each render
	const sectionRefs = useRef<Record<string, RefObject<HTMLDivElement>>>({
		general: generalSectionRef,
		radient: radientSectionRef,
		appearance: appearanceSectionRef,
		credentials: credentialsSectionRef,
		updates: updatesSectionRef,
	}).current;

	// Handle section selection
	const handleSelectSection = (sectionId: string) => {
		// Set active section immediately
		setActiveSection(sectionId);

		// Disable scroll event handling during programmatic scrolling
		setIsScrolling(true);

		const ref = sectionRefs[sectionId];
		if (ref?.current) {
			// Get the scrollable container
			const contentContainer = document.querySelector(
				"[data-settings-content]",
			);
			if (contentContainer) {
				// Calculate the scroll position
				const containerRect = contentContainer.getBoundingClientRect();
				const elementRect = ref.current.getBoundingClientRect();
				const scrollTop =
					elementRect.top - containerRect.top + contentContainer.scrollTop;

				// Scroll to the element
				contentContainer.scrollTo({
					top: scrollTop - 80, // Offset for header
					behavior: "smooth",
				});

				// Re-enable scroll event handling after animation completes
				// Typical smooth scroll animation takes about 500ms
				setTimeout(() => {
					setIsScrolling(false);
				}, 600);
			} else {
				// Fallback to default scrollIntoView if container not found
				ref.current.scrollIntoView({ behavior: "smooth" });

				// Re-enable scroll event handling after animation completes
				setTimeout(() => {
					setIsScrolling(false);
				}, 600);
			}
		}
	};

	// Update active section based on scroll position
	useEffect(() => {
		const handleScroll = (e: Event) => {
			// Skip scroll handling if we're programmatically scrolling
			if (isScrolling) return;

			// Get the scrollable container
			const container = e.target as HTMLElement;
			const scrollPosition = container.scrollTop + 100; // Add offset for header

			// Find the section that is currently in view
			for (const [sectionId, ref] of Object.entries(sectionRefs)) {
				if (ref.current) {
					const { offsetTop, offsetHeight } = ref.current;
					if (
						scrollPosition >= offsetTop &&
						scrollPosition < offsetTop + offsetHeight
					) {
						setActiveSection(sectionId);
						break;
					}
				}
			}
		};

		// Get the scrollable container
		const contentContainer = document.querySelector("[data-settings-content]");
		if (contentContainer) {
			contentContainer.addEventListener("scroll", handleScroll);
			return () => contentContainer.removeEventListener("scroll", handleScroll);
		}
		return undefined;
	}, [sectionRefs, isScrolling]);

	// Handle updating a specific field
	const handleUpdateField = async (
		field: keyof ConfigUpdate,
		value: string | number | boolean,
	) => {
		setSavingField(field);
		try {
			const update: ConfigUpdate = {
				[field]: value,
			};

			await updateConfigMutation.mutateAsync(update);
			// Explicitly refetch to update the UI
			await refetch();
		} catch (error) {
			// Error is already handled in the mutation
			console.error(`Error updating ${field}:`, error);
		} finally {
			setSavingField(null);
		}
	};

	// Combine loading states
	const isLoading = isConfigLoading || isAuthLoading;

	if (isLoading) {
		return (
			<LoadingContainer>
				<CircularProgress />
			</LoadingContainer>
		);
	}

	// Handle config loading error specifically
	if (configError || !config) {
		return (
			<ErrorContainer>
				<Alert severity="error">
					Failed to load configuration. Please try again later.{" "}
					{configError?.message}
				</Alert>
			</ErrorContainer>
		);
	}

	return (
		<StyledPaper elevation={0}>
			{/* Settings Sidebar - Fixed on the left */}
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
					icon={faGear}
					subtitle="Configure your application preferences and settings"
				/>

				<StyledContainer maxWidth="lg" disableGutters>
					{/* General Settings Section */}
					<Box ref={generalSectionRef}>
						<Grid container spacing={4}>
							{/* Left Column */}
							<Grid item xs={12} md={6}>
								{/* User Profile Settings */}
								<StyledCard>
									<StyledCardContent>
										<CardTitle variant="h6">
											<FontAwesomeIcon icon={faUser} />
											User Profile
										</CardTitle>

										<CardDescription variant="body2">
											Update your user profile information displayed in the
											application.
										</CardDescription>

										<FieldsContainer>
											<EditableField
												value={userStore.profile.name}
												label="Display Name"
												placeholder="Enter your name..."
												icon={<FontAwesomeIcon icon={faUser} />}
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
												icon={<FontAwesomeIcon icon={faEnvelope} />}
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
									</StyledCardContent>
								</StyledCard>
								{/* Model Settings */}
								<StyledCard>
									<StyledCardContent>
										<CardTitle variant="h6">
											<FontAwesomeIcon icon={faRobot} />
											Model Settings
										</CardTitle>

										<CardDescription variant="body2">
											Configure the AI model and hosting provider used for
											generating responses.
										</CardDescription>

										<FieldsContainer>
											<HostingSelect
												value={config.values.hosting}
												isSaving={savingField === "hosting"}
												onSave={async (value) => {
													await handleUpdateField("hosting", value);
												}}
												filterByCredentials={true}
												allowCustom={true}
											/>

											<ModelSelect
												value={config.values.model_name}
												hostingId={config.values.hosting}
												isSaving={savingField === "model_name"}
												onSave={async (value) => {
													await handleUpdateField("model_name", value);
												}}
												allowCustom={true}
											/>
										</FieldsContainer>
									</StyledCardContent>
								</StyledCard>

								{/* System Prompt Settings */}
								<SystemPrompt />
							</Grid>

							{/* Right Column */}
							<Grid item xs={12} md={6}>
								{/* History Settings */}
								<StyledCard>
									<StyledCardContent>
										<CardTitle variant="h6">
											<FontAwesomeIcon icon={faHistory} />
											History Settings
										</CardTitle>

										<CardDescription variant="body2">
											Configure how much conversation history is retained and
											displayed.
										</CardDescription>

										<SliderSetting
											value={config.values.conversation_length}
											label="Maximum Conversation History"
											description="Number of messages to keep in conversation history for context.  More messages will make the agents have longer memory but more expensive to run."
											min={10}
											max={200}
											step={10}
											unit="msgs"
											icon={faHistory}
											isSaving={savingField === "conversation_length"}
											onChange={async (value) => {
												await handleUpdateField("conversation_length", value);
											}}
										/>

										<SliderSetting
											value={config.values.detail_length}
											label="Detail View Length"
											description="Maximum number of messages to show in the detailed conversation view.  Messages beyond this limit will be summarized.  Shortening this will decrease costs but some important details could get lost from earlier messages."
											min={10}
											max={100}
											step={5}
											unit="msgs"
											icon={faListAlt}
											isSaving={savingField === "detail_length"}
											onChange={async (value) => {
												await handleUpdateField("detail_length", value);
											}}
										/>

										<SliderSetting
											value={config.values.max_learnings_history}
											label="Maximum Learnings History"
											description="Number of learning items to retain for context and personalization.  More items will make the agents acquire a longer history of knowledge from your conversations but more expensive to run."
											min={10}
											max={100}
											step={10}
											unit="items"
											icon={faDatabase}
											isSaving={savingField === "max_learnings_history"}
											onChange={async (value) => {
												await handleUpdateField("max_learnings_history", value);
											}}
										/>
									</StyledCardContent>
								</StyledCard>

								{/* Configuration Metadata */}
								<StyledCard>
									<StyledCardContent>
										<CardTitle variant="h6">
											<FontAwesomeIcon icon={faInfoCircle} />
											Configuration Information
										</CardTitle>

										<CardDescription variant="body2">
											System information about the current configuration.
										</CardDescription>

										<Grid container spacing={2}>
											<Grid item xs={12} sm={6}>
												<InfoBox>
													<InfoLabel variant="subtitle2">Version</InfoLabel>
													<InfoValue variant="body1">
														{config.version}
													</InfoValue>
												</InfoBox>
											</Grid>

											<Grid item xs={12} sm={6}>
												<InfoBox>
													<InfoLabel variant="subtitle2">Created At</InfoLabel>
													<InfoValue variant="body1">
														{new Date(
															config.metadata.created_at,
														).toLocaleString()}
													</InfoValue>
												</InfoBox>
											</Grid>

											<Grid item xs={12} sm={6}>
												<InfoBox>
													<InfoLabel variant="subtitle2">
														Last Modified
													</InfoLabel>
													<InfoValue variant="body1">
														{new Date(
															config.metadata.last_modified,
														).toLocaleString()}
													</InfoValue>
												</InfoBox>
											</Grid>

											<Grid item xs={12} sm={6}>
												<InfoBox>
													<InfoLabel variant="subtitle2">Description</InfoLabel>
													<InfoValue variant="body1">
														{config.metadata.description ||
															"No description available"}
													</InfoValue>
												</InfoBox>
											</Grid>
										</Grid>
									</StyledCardContent>
								</StyledCard>

								{/* Application Updates - Moved to its own section */}
							</Grid>
						</Grid>
					</Box>

					{/* Radient Account Section */}
					<StyledCard ref={radientSectionRef}>
						<StyledCardContent>
							<Stack
								direction={{ xs: "column", sm: "row" }}
								spacing={2}
								justifyContent="space-between"
								alignItems={{ xs: "flex-start", sm: "center" }}
								mb={3}
							>
								<Box>
									<Typography
										variant="h5"
										fontWeight="500"
										display="flex"
										alignItems="center"
										gap={2}
										mb={1} // Added margin bottom
									>
										<IconImage src={radientIcon} alt="Radient Icon" />
										Radient Account
									</Typography>
									<Typography variant="body1" color="text.secondary">
										Manage your Radient account, Radient Pass details, and
										credits.
									</Typography>
								</Box>
								<Button
									variant="contained"
									color="primary"
									href="https://console.radienthq.com"
									target="_blank"
									rel="noopener noreferrer"
									endIcon={
										<FontAwesomeIcon icon={faExternalLinkAlt} size="sm" />
									} // Slightly smaller icon
									sx={(theme) => ({
										// Shadcn-inspired base styles
										backgroundColor: "primary.main",
										color: "primary.contrastText",
										padding: theme.spacing(0.75, 2.5), // Adjusted padding
										fontSize: "0.875rem", // Slightly smaller font
										fontWeight: 500,
										borderRadius: theme.shape.borderRadius * 0.75, // Slightly reduced border radius
										textTransform: "none", // No uppercase text
										boxShadow: "none", // No default elevation
										transition: theme.transitions.create("opacity", {
											// Smooth transition for opacity
											duration: theme.transitions.duration.short,
										}),

										// Hover effect: Dim slightly, no background change
										"&:hover": {
											backgroundColor: "primary.main", // Keep background the same
											opacity: 0.9, // Dim the button
											boxShadow: "none", // Ensure no shadow on hover
										},

										// Existing responsive styles
										mt: { xs: 2, sm: 0 },
										alignSelf: { xs: "flex-start", sm: "center" },
									})}
								>
									Go to Radient Console
								</Button>
							</Stack>
							{/* Render RadientAccountSection always, but conditionally add billing/usage */}
							<RadientAccountSection />

							{/* Conditionally render Billing and Usage if authenticated */}
							{isAuthenticated && (
								<>
									<Divider sx={{ my: 3 }} />
									<BillingInfo />
									<Divider sx={{ my: 3 }} />
									<UsageInfo />
								</>
							)}
						</StyledCardContent>
					</StyledCard>

					{/* Appearance Section */}
					<StyledCard ref={appearanceSectionRef}>
						<StyledCardContent>
							<Typography
								variant="h5"
								fontWeight="500"
								display="flex"
								alignItems="center"
								gap={2}
								mb={1} // Added margin bottom
							>
								<FontAwesomeIcon icon={faAdjust} />
								Appearance
							</Typography>
							<Typography variant="body1" color="text.secondary" mb={3}>
								Customize the look and feel of Local Operator
							</Typography>
							<ThemeSelector />
						</StyledCardContent>
					</StyledCard>

					{/* API Credentials Section */}
					<StyledCard ref={credentialsSectionRef}>
						<StyledCardContent>
							<Typography
								variant="h5"
								fontWeight="500"
								display="flex"
								alignItems="center"
								gap={2}
								mb={1} // Added margin bottom
							>
								<FontAwesomeIcon icon={faKey} />
								API Credentials
							</Typography>
							<Typography variant="body1" color="text.secondary" mb={3}>
								Manage your API keys for various services and integrations
							</Typography>
							<Credentials />
						</StyledCardContent>
					</StyledCard>

					{/* App Updates Section */}
					<Box ref={updatesSectionRef}>
						<Typography
							variant="h5"
							fontWeight="500"
							display="flex"
							alignItems="center"
							gap={2}
						>
							<FontAwesomeIcon icon={faAdjust} />
							Appearance
						</Typography>
						<Typography variant="body1" color="text.secondary" mt={1} mb={3}>
							Customize the look and feel of Local Operator
						</Typography>
						<ThemeSelector />
					</Box>

					{/* API Credentials Section */}
					<Box mt={6} mb={4} ref={credentialsSectionRef}>
						<Typography
							variant="h5"
							fontWeight="500"
							display="flex"
							alignItems="center"
							gap={2}
						>
							<FontAwesomeIcon icon={faKey} />
							API Credentials
						</Typography>
						<Typography variant="body1" color="text.secondary" mt={1} mb={3}>
							Manage your API keys for various services and integrations
						</Typography>
						<Credentials />
					</Box>

					{/* App Updates Section */}
					<Box ref={updatesSectionRef}>
						<AppUpdatesSection />
					</Box>
				</StyledContainer>
			</ContentContainer>
		</StyledPaper>
	);
};
