import { library } from "@fortawesome/fontawesome-svg-core";
import { fab } from "@fortawesome/free-brands-svg-icons";
import { fas } from "@fortawesome/free-solid-svg-icons";
import { Box, CssBaseline } from "@mui/material";
import { styled } from "@mui/material/styles";
import React from "react";
import type { FC } from "react";
import { Navigate, Route, Routes } from "react-router-dom";

import { ChatPage } from "@components/chat/chat-page";
import { AgentsPage } from "@renderer/components/agents/agents-page";
import { ConnectivityBanner } from "@renderer/components/common/connectivity-banner";
import { ModelsInitializer } from "@renderer/components/common/models-initializer";
import { UpdateNotification } from "@renderer/components/common/update-notification";
import { SidebarNavigation } from "@renderer/components/navigation/sidebar-navigation";
import { OnboardingModal } from "@renderer/components/onboarding";
import { SettingsPage } from "@renderer/components/settings/settings-page";
import { useCheckFirstTimeUser } from "@renderer/hooks/use-check-first-time-user";

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

					{/* Fallback route - redirect to chat */}
					<Route path="*" element={<Navigate to="/chat" replace />} />
				</Routes>
			</MainContent>
		</AppContainer>
	);
};

export default App;
