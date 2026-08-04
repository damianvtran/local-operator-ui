import { Box, CircularProgress, CssBaseline } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom"; // Import useNavigate

// ChatPage is the boot route (/ redirects to /chat), so it stays statically
// imported: lazy-loading it would put a Suspense fallback on first paint.
import { ChatPage } from "@features/chat/components/chat-page";
import { CommandPalette } from "@features/command-palette/components/command-palette";
import { OnboardingModal } from "@features/onboarding";
import { OnboardingProvider } from "@features/onboarding/components/onboarding-provider";
import { OnboardingTourGlobalStyles } from "@features/onboarding/components/onboarding-tour-global.styles";

import { ConnectivityBanner } from "@shared/components/common/connectivity-banner";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog"; // Import CreateAgentDialog
import { LowCreditsDialog } from "@shared/components/common/low-credits-dialog";
import { ModelsInitializer } from "@shared/components/common/models-initializer";
import { UpdateNotification } from "@shared/components/common/update-notification";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useCheckFirstTimeUser } from "@shared/hooks/use-check-first-time-user";
import { useLowCreditsDialog } from "@shared/hooks/use-low-credits-dialog";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";

// The other five routes are split out so a cold start neither downloads nor
// parses them. They export named components rather than defaults, so each
// import is remapped to the { default } shape React.lazy requires.
const AgentDetailsPage = lazy(() =>
	import("@features/agent-hub/agent-details-page").then((m) => ({
		default: m.AgentDetailsPage,
	})),
);
const AgentHubPage = lazy(() =>
	import("@features/agent-hub/agent-hub-page").then((m) => ({
		default: m.AgentHubPage,
	})),
);
const AgentsPage = lazy(() =>
	import("@features/agents/components/agents-page").then((m) => ({
		default: m.AgentsPage,
	})),
);
const SchedulesPage = lazy(() =>
	import("@features/schedules/components/schedules-page").then((m) => ({
		default: m.SchedulesPage,
	})),
);
const SettingsPage = lazy(() =>
	import("@features/settings/components/settings-page").then((m) => ({
		default: m.SettingsPage,
	})),
);

const AppContainer = styled(Box)(() => ({
	display: "flex",
	height: "100vh",
	overflow: "hidden",
}));

const MainContent = styled(Box)(() => ({
	flexGrow: 1,
	overflow: "hidden",
	display: "flex",
	flexDirection: "column",
}));

const RouteFallback = styled(Box)(() => ({
	flexGrow: 1,
	display: "flex",
	alignItems: "center",
	justifyContent: "center",
}));

/**
 * Main application component
 *
 * Handles routing and layout for the entire application
 */
const App: FC = () => {
	// Check if this is a first-time user
	const { isOnboardingActive } = useCheckFirstTimeUser();
	const {
		isLowCreditsDialogOpen,
		openRadientConsole,
		onLowCreditsDialogClose,
	} = useLowCreditsDialog();
	const {
		toggleCommandPalette,
		isCommandPaletteOpen,
		isCreateAgentDialogOpen, // Get dialog state from store
		closeCreateAgentDialog, // Get close action from store
	} = useUiPreferencesStore();
	const navigate = useNavigate(); // For onAgentCreated

	const handleAgentCreated = (agentId: string) => {
		navigate(`/chat/${agentId}`);
		closeCreateAgentDialog();
	};

	useEffect(() => {
		const handleToggleCommandPalette = () => {
			toggleCommandPalette();
		};

		// Listen for the IPC message from the main process
		const unsubscribe = window.electron.ipcRenderer.on(
			"toggle-command-palette",
			handleToggleCommandPalette,
		);

		// Clean up the listener when the component unmounts
		return () => {
			if (unsubscribe) {
				unsubscribe();
			}
		};
	}, [toggleCommandPalette]);

	return (
		<OnboardingProvider>
			<OnboardingTourGlobalStyles />
			<AppContainer>
				<CssBaseline />

				{/* Command Palette */}
				{isCommandPaletteOpen && <CommandPalette />}

				{/* Initialize models store */}
				<ModelsInitializer />

				{/* First-time setup onboarding (existing modal) */}
				{/* This might need to be coordinated with the new Shepherd tour */}
				<OnboardingModal open={isOnboardingActive} />

				{/* Connectivity status banner */}
				<ConnectivityBanner />

				{/* Auto-update notification */}
				<UpdateNotification />

				{/* Low Credits Dialog */}
				<LowCreditsDialog
					open={isLowCreditsDialogOpen}
					onClose={onLowCreditsDialogClose}
					onGoToConsole={openRadientConsole}
				/>

				{/* Create Agent Dialog (Global) */}
				<CreateAgentDialog
					open={isCreateAgentDialogOpen}
					onClose={closeCreateAgentDialog}
					onAgentCreated={handleAgentCreated}
				/>

				{/* Sidebar Navigation */}
				<SidebarNavigation />

				{/* Main Content Area */}
				<MainContent>
					<Suspense
						fallback={
							<RouteFallback>
								<CircularProgress size={40} thickness={4} />
							</RouteFallback>
						}
					>
						<Routes>
							{/* Redirect root to chat */}
							<Route path="/" element={<Navigate to="/chat" replace />} />

							{/* Chat routes */}
							<Route path="/chat" element={<ChatPage />} />
							<Route path="/chat/:agentId" element={<ChatPage />} />

							{/* Agents routes */}
							<Route path="/agents" element={<AgentsPage />} />
							<Route path="/agents/:agentId" element={<AgentsPage />} />

							{/* Settings route */}
							<Route path="/settings" element={<SettingsPage />} />

							{/* Agent Hub routes */}
							<Route path="/agent-hub" element={<AgentHubPage />} />
							<Route
								path="/agent-hub/:agentId"
								element={<AgentDetailsPage />}
							/>

							{/* Schedules route */}
							<Route path="/schedules" element={<SchedulesPage />} />

							{/* Fallback route - redirect to chat */}
							<Route path="*" element={<Navigate to="/chat" replace />} />
						</Routes>
					</Suspense>
				</MainContent>
			</AppContainer>
		</OnboardingProvider>
	);
};

export default App;
