import type { FC } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

// ChatPage is the boot route (/ redirects to /chat), so it stays statically
// imported: lazy-loading it would put a Suspense fallback on first paint.
import { ChatPage } from "@features/chat/components/chat-page";
import { CommandPalette } from "@features/command-palette/components/command-palette";
import { OnboardingModal } from "@features/onboarding";
import { OnboardingProvider } from "@features/onboarding/components/onboarding-provider";
import { noteConsentAttention } from "@shared/browser-consent-attention";
import { useSuppressBrowserView } from "@shared/browser-view-policy";

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
const BrowserPage = lazy(() =>
	import("@features/browser/components/browser-page").then((m) => ({
		default: m.BrowserPage,
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

	/*
	 * The browser view's overlay policy (design 11.3), registered where the
	 * overlays actually live.
	 *
	 * A native `WebContentsView` paints above ALL DOM, so every one of these is
	 * invisible over the browser surface unless the view itself is hidden. The
	 * policy is one boolean, and this is where the app-level half of it is
	 * declared: the store flags below already decide whether each overlay is up.
	 *
	 * THE TWO FIXED BANNERS ARE DELIBERATELY ABSENT, and the reason is geometry
	 * rather than taste: they are a single-line strip pinned to the window's top
	 * edge, which the browser route's own tab strip and URL bar already occupy, so
	 * they do not reach the page rectangle. Hiding the page every time a
	 * connectivity banner appeared would take the page away for as long as the
	 * backend was down, which is worse than the banner being partially covered.
	 * The rect and the banner's own box are both in the PR's evidence frames, so
	 * this is a measured claim rather than a reasoned one.
	 *
	 * `ModelsInitializer` renders nothing, so it has nothing to register.
	 */
	useSuppressBrowserView(isCommandPaletteOpen, "command-palette");
	useSuppressBrowserView(isCreateAgentDialogOpen, "create-agent-dialog");
	useSuppressBrowserView(isOnboardingActive, "onboarding");
	useSuppressBrowserView(isLowCreditsDialogOpen, "low-credits");
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
	//
	// `setActiveSession` and nothing else: deliberately NO validating
	// `sessions.get` round trip here. `openSession` does that for a sidebar row,
	// where ~1.5 s against a click the user already committed to is the right
	// trade; on the notification path it is latency in front of the only thing
	// the user asked for, and the panel's own paint cache plus the stream's
	// snapshot answer the same questions. A conversation that turns out not to
	// exist lands on the transcript's named state instead (M6).
	const setActiveSession = useCanonicalSessionsStore(
		(state) => state.setActiveSession,
	);
	useEffect(() => {
		const unsubscribe = window.api?.desktop?.onOpenConversation?.(
			(sessionId) => {
				/*
				 * The START of the latency trace the design asks to report rather than
				 * to describe: the sibling mark is at the first painted transcript row
				 * (`canonical-transcript.tsx`), and the measure between them is the
				 * click-to-visible number. Marked HERE rather than in the transcript
				 * because this is the process's first knowledge of the click, which is
				 * the only honest beginning: everything after it is ours to lose.
				 *
				 * Only a click that NAMES a conversation starts a trace: a burst
				 * digest's click opens the catalogue (R1-2), which has no
				 * conversation row to paint, and a mark for it would sit there until
				 * some later open measured a row against it.
				 */
				if (sessionId !== null) performance.mark("lop:open:requested");
				// `null` is the catalogue: the store models "no active session" as
				// exactly this, so a digest click lands where all the burst's
				// conversations are listed rather than on one arbitrary member.
				setActiveSession(sessionId);
				navigate("/chat");
			},
		);
		return () => unsubscribe?.();
	}, [navigate, setActiveSession]);

	// A consent banner's click, handled where the ROUTES are.
	//
	// A native banner is raised for a request the user cannot see (design 9.2), so its
	// click has to reach them wherever they are — and the browser surface's own
	// subscriber is unmounted on every other route, which is precisely the case the
	// banner exists for (review round 1, R8). The shell therefore owns the two halves
	// that only the shell can do: remember which request was named, and bring the
	// browser route forward.
	//
	// IT MUST NOT RAISE THE WINDOW. Navigating a route is renderer work; no window is
	// shown, focused or activated here, and `src/main/window-raise.ts` stays the only
	// module that decides whether a window comes forward (design 11.4).
	useEffect(() => {
		const unsubscribe = window.api?.browser?.onConsentAttention?.((payload) => {
			noteConsentAttention(payload.entryId);
			navigate("/browser");
		});
		return () => unsubscribe?.();
	}, [navigate]);

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
							<Route path="/browser" element={<BrowserPage />} />
							<Route path="*" element={<Navigate to="/chat" replace />} />
						</Routes>
					</Suspense>
				</main>
			</div>
		</OnboardingProvider>
	);
};

export default App;
