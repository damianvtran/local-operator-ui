import { HostingSelect } from "@components/hosting/hosting-select";
import { ModelSelect } from "@components/hosting/model-select";
import {
	faAdjust,
	faCloudUploadAlt,
	faDatabase,
	faEnvelope,
	faGear,
	faHistory,
	faInfoCircle,
	faKey,
	faListAlt,
	faRobot,
	faSave,
	faUser,
} from "@fortawesome/free-solid-svg-icons";
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import {
	Alert,
	Box,
	Card,
	CardContent,
	CircularProgress,
	Container,
	Grid,
	Paper,
	Typography,
} from "@mui/material";
import { styled } from "@mui/material/styles";
import type { ConfigUpdate } from "@renderer/api/local-operator/types";
import { useConfig } from "@renderer/hooks/use-config";
import { useUpdateConfig } from "@renderer/hooks/use-update-config";
import { useUserStore } from "@renderer/store/user-store";
import { EditableField } from "@shared/components/common/editable-field";
import { PageHeader } from "@shared/components/common/page-header";
import { SliderSetting } from "@shared/components/common/slider-setting";
import { ToggleSetting } from "@shared/components/common/toggle-setting";
import { useEffect, useRef, useState } from "react";
import type { FC, RefObject } from "react";
import { AppUpdatesSection } from "./app-updates-section";
import { Credentials } from "./credentials";
import { RadientAccountSection } from "./radient-account-section";
import { DEFAULT_SETTINGS_SECTIONS, SettingsSidebar } from "./settings-sidebar";
import { SystemPrompt } from "./system-prompt";
import { ThemeSelector } from "./theme-selector";

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

export const SettingsPage: FC = () => {
	const { data: config, isLoading, error, refetch } = useConfig();
	const updateConfigMutation = useUpdateConfig();
	const [savingField, setSavingField] = useState<string | null>(null);
	const userStore = useUserStore();
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

	if (isLoading) {
		return (
			<LoadingContainer>
				<CircularProgress />
			</LoadingContainer>
		);
	}

	if (error || !config) {
		return (
			<ErrorContainer>
				<Alert severity="error">
					Failed to load configuration. Please try again later.
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

								{/* Auto-Save Settings */}
								<StyledCard>
									<StyledCardContent>
										<CardTitle variant="h6">
											<FontAwesomeIcon icon={faSave} />
											Auto-Save Settings
										</CardTitle>

										<CardDescription variant="body2">
											Control whether conversations are automatically saved for
											future reference.
										</CardDescription>

										<ToggleSetting
											value={config.values.auto_save_conversation}
											label="Auto-Save Conversations"
											description="When enabled, all conversations will be automatically saved to your history"
											icon={faCloudUploadAlt}
											isSaving={savingField === "auto_save_conversation"}
											onChange={async (value) => {
												await handleUpdateField(
													"auto_save_conversation",
													value,
												);
											}}
										/>
									</StyledCardContent>
								</StyledCard>
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
					<Box mt={6} mb={4} ref={radientSectionRef}>
						<Typography
							variant="h5"
							fontWeight="500"
							display="flex"
							alignItems="center"
							gap={2}
						>
							<FontAwesomeIcon icon={faUser} />
							Radient Account
						</Typography>
						<Typography variant="body1" color="text.secondary" mt={1} mb={3}>
							Manage your Radient account for accessing additional features
						</Typography>
						<RadientAccountSection />
					</Box>

					{/* Appearance Section */}
					<Box mt={6} mb={4} ref={appearanceSectionRef}>
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
