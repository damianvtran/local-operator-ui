import type { FC } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

// ChatPage is the boot route (/ redirects to /chat), so it stays statically
// imported: lazy-loading it would put a Suspense fallback on first paint.
import { ChatPage } from "@features/chat/components/chat-page";
import { CommandPalette } from "@features/command-palette/components/command-palette";
import { OnboardingModal } from "@features/onboarding";
import { OnboardingProvider } from "@features/onboarding/components/onboarding-provider";

import { ConnectivityBanner } from "@shared/components/common/connectivity-banner";
import { CreateAgentDialog } from "@shared/components/common/create-agent-dialog";
import { LowCreditsDialog } from "@shared/components/common/low-credits-dialog";
import { ModelsInitializer } from "@shared/components/common/models-initializer";
import { Spinner } from "@shared/components/common/spinner";
import { UpdateNotification } from "@shared/components/common/update-notification";
import { SidebarNavigation } from "@shared/components/navigation/sidebar-navigation";
import { useCheckFirstTimeUser } from "@shared/hooks/use-check-first-time-user";
import { useLowCreditsDialog } from "@shared/hooks/use-low-credits-dialog";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
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

	// A notification click names a canonical conversation; opening it is the
	// whole effect. Any pending gate stays pending until an explicit in-app
	// answer, so a stray click can never approve anything.
	const setActiveSession = useCanonicalSessionsStore(
		(state) => state.setActiveSession,
	);
	useEffect(() => {
		const unsubscribe = window.api?.desktop?.onOpenConversation?.(
			(sessionId) => {
				setActiveSession(sessionId);
				navigate("/chat");
			},
		);
		return () => unsubscribe?.();
	}, [navigate, setActiveSession]);

	return (
		<OnboardingProvider>
			<div className="flex h-screen overflow-hidden">
				{isCommandPaletteOpen && <CommandPalette />}

				<ModelsInitializer />

				<OnboardingModal open={isOnboardingActive} />

				<ConnectivityBanner />

				<UpdateNotification />

				<LowCreditsDialog
					open={isLowCreditsDialogOpen}
					onClose={onLowCreditsDialogClose}
					onGoToConsole={openRadientConsole}
				/>

				<CreateAgentDialog
					open={isCreateAgentDialogOpen}
					onClose={closeCreateAgentDialog}
					onAgentCreated={handleAgentCreated}
				/>

				<SidebarNavigation />

				<main className="flex grow flex-col overflow-hidden">
					<Suspense
						fallback={
							<div className="flex grow items-center justify-center">
								<Spinner size="lg" label="Loading page" />
							</div>
						}
					>
						<Routes>
							<Route path="/" element={<Navigate to="/chat" replace />} />
							<Route path="/chat" element={<ChatPage />} />
							<Route path="/chat/:agentId" element={<ChatPage />} />
							<Route path="/agents" element={<AgentsPage />} />
							<Route path="/agents/:agentId" element={<AgentsPage />} />
							<Route path="/settings" element={<SettingsPage />} />
							<Route path="/agent-hub" element={<AgentHubPage />} />
							<Route
								path="/agent-hub/:agentId"
								element={<AgentDetailsPage />}
							/>
							<Route path="/schedules" element={<SchedulesPage />} />
							<Route path="*" element={<Navigate to="/chat" replace />} />
						</Routes>
					</Suspense>
				</main>
			</div>
		</OnboardingProvider>
	);
};

export default App;
