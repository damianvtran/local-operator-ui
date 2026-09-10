import type { FC } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

// ChatPage is the boot route (/ redirects to /chat), so it stays statically
// imported: lazy-loading it would put a Suspense fallback on first paint.
import { ChatPage } from "@features/chat/components/chat-page";
import { CommandPalette } from "@features/command-palette/components/command-palette";
import { OnboardingModal } from "@features/onboarding";
import { OnboardingProvider } from "@features/onboarding/components/onboarding-provider";

import { BackendCompatibilityBanner } from "@shared/components/common/backend-compatibility-banner";
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
			{/*
			 * `relative` is load-bearing, not decoration.
			 *
			 * This root already declared `h-screen overflow-hidden`, which reads as
			 * a promise that nothing can scroll the document. It was not one: an
			 * `overflow` clip only applies to a descendant whose CONTAINING BLOCK is
			 * that element, and every ancestor here was `position: static`, so the
			 * absolutely positioned `sr-only` labels the app scatters through its
			 * lists resolved against the initial containing block and escaped the
			 * clip entirely. Their offsets are real layout positions, so a long
			 * sidebar pushed them past the viewport and stretched <html> behind an
			 * app that looks bounded.
			 *
			 * Measured in the running app: `documentElement.scrollHeight -
			 * clientHeight` was 308px with 20 escaping labels; making this element a
			 * containing block takes it to 0, and reverting restores 308. Fixing it
			 * here rather than at each label keeps one rule instead of one per
			 * `sr-only` call site.
			 *
			 * The app's EIGHT `position: fixed` elements are unaffected, and the
			 * reason is the rule rather than the count: `position: relative`
			 * establishes a containing block for `absolute` descendants only.
			 * `fixed` resolves against the viewport unless an ancestor carries
			 * `transform`, `filter`, `perspective`, `backdrop-filter`, `contain`
			 * or `will-change` of one of those - none of which is added here - so
			 * the banners, the floating alert, the update notification, and the
			 * dialog and sheet overlays keep covering the window exactly as
			 * before. An earlier draft of this comment claimed there was one such
			 * element; there are eight, and the guarantee does not depend on how
			 * many.
			 *
			 * The `sr-only` utility itself is NOT at fault and must not be "fixed":
			 * its computed style matches the canonical definition exactly (absolute,
			 * 1x1, `overflow: hidden`, `clip-path: inset(50%)`, `margin: -1px`). It
			 * has no `top`/`left`, which is the point - the label stays at its static
			 * position so it reads in document order. That is only bounded if some
			 * ancestor is a containing block, which is the job this line does. The
			 * labels stay 1x1 and rendered afterwards, so screen readers still
			 * announce them; nothing is hidden, it is merely contained.
			 */}
			<div className="relative flex h-screen overflow-hidden">
				{isCommandPaletteOpen && <CommandPalette />}

				<ModelsInitializer />

				<OnboardingModal open={isOnboardingActive} />

				<ConnectivityBanner />

				<BackendCompatibilityBanner />

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
