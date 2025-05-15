import { library } from "@fortawesome/fontawesome-svg-core";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { Box, CssBaseline } from "@mui/material";
import { styled } from "@mui/material/styles";
import type { FC } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { AgentDetailsPage } from "@features/agent-hub/agent-details-page"; // Import Agent Details Page
import { AgentHubPage } from "@features/agent-hub/agent-hub-page"; // Import Agent Hub Page
import { AgentsPage } from "@features/agents/components/agents-page";
import { ChatPage } from "@features/chat/components/chat-page";
import { OnboardingModal } from "@features/onboarding";
import { SchedulesPage } from "@features/schedules/components/schedules-page"; // Import Schedules Page
import { SettingsPage } from "@features/settings/components/settings-page";
import { ConnectivityBanner } from "@shared/components/common/connectivity-banner";
import { ModelsInitializer } from "@shared/components/common/models-initializer";
import { UpdateNotification } from "@shared/components/common/update-notification";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useCheckFirstTimeUser } from "@shared/hooks/use-check-first-time-user";

library.add(fas, fab);

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

/**
 * Main application component
 *
 * Handles routing and layout for the entire application
 */
const App: FC = () => {
	// Check if this is a first-time user
	const { isOnboardingActive } = useCheckFirstTimeUser();

	return (
		<AppContainer>
			<CssBaseline />

			{/* Initialize models store */}
			<ModelsInitializer />

			{/* First-time setup onboarding */}
			<OnboardingModal open={isOnboardingActive} />

			{/* Connectivity status banner */}
			<ConnectivityBanner />

			{/* Auto-update notification */}
			<UpdateNotification />

			{/* Sidebar Navigation */}
			<SidebarNavigation />

			{/* Main Content Area */}
			<MainContent>
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
					<Route path="/agent-hub/:agentId" element={<AgentDetailsPage />} />

					{/* Schedules route */}
					<Route path="/schedules" element={<SchedulesPage />} />

					{/* Fallback route - redirect to chat */}
					<Route path="*" element={<Navigate to="/chat" replace />} />
				</Routes>
			</MainContent>
		</AppContainer>
	);
};

export default App;
