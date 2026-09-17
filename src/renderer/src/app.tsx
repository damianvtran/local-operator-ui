import type { FC } from "react";
import { Suspense, lazy, useEffect } from "react";
import { Navigate, Route, Routes, useNavigate } from "react-router-dom";

// ChatPage is the boot route (/ redirects to /chat), so it stays statically
// imported: lazy-loading it would put a Suspense fallback on first paint.
import { ChatPage } from "@features/chat/components/chat-page";
import { shouldStartNewChat } from "@features/chat/new-chat-shortcut";
import { PanelOutlet } from "@features/chat/pickers/panel-outlet";
import { CommandPalette } from "@features/command-palette/components/command-palette";
import { useCommandPaletteShortcut } from "@features/command-palette/use-command-palette-shortcut";
import { OnboardingModal } from "@features/onboarding";
import { OnboardingProvider } from "@features/onboarding/components/onboarding-provider";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
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
		isCommandPaletteOpen,
		isCreateAgentDialogOpen,
		closeCreateAgentDialog,
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
	 * THE TWO FULL-BLEED BANDS ARE DELIBERATELY ABSENT, and the reason is geometry
	 * rather than taste: they are this shell's FIRST CHILDREN now, in flow above the
	 * route's own chrome, so they take their height out of the app's region instead
	 * of painting over it - and the page rectangle this renderer hands main
	 * (`use-browser-chrome`, whose `ResizeObserver` on the content element reports
	 * it) moves with the region. Hiding the page every time a connectivity banner
	 * appeared would take the page away for as long as the backend was down, which
	 * is worse than a banner. The content rect either side of that report is recorded
	 * on the `/browser` route with no band, with one and with both
	 * (`docs/evidence/band-occlusion/after/after-browser-*.png` and the rects in
	 * `after-geometry.json`), so this is a measured claim rather than a reasoned one.
	 *
	 * `ModelsInitializer` renders nothing, so it has nothing to register.
	 */
	useSuppressBrowserView(isCommandPaletteOpen, "command-palette");
	useSuppressBrowserView(isCreateAgentDialogOpen, "create-agent-dialog");
	useSuppressBrowserView(isOnboardingActive, "onboarding");
	useSuppressBrowserView(isLowCreditsDialogOpen, "low-credits");
	const navigate = useNavigate(); // For onAgentCreated

	/*
	 * Whether the session catalogue is usable, which is the gate the shortcut's
	 * own row keeps.
	 *
	 * `chat-sidebar.tsx` disables the New chat row on exactly this capability,
	 * with the reason beside it: "staging a draft needs the session catalogue".
	 * A chord that outranked that gate would stage a draft in a state where the
	 * visible control refuses — a backend older than `session_catalogue` v2, or
	 * none at all — and would be claiming a capability the app has just said it
	 * does not have. `capabilities.data` is `undefined` until the answer arrives,
	 * which is the same closed state the row reads.
	 */
	const capabilities = useDesktopCapabilities();
	const catalogueReady = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);

	const handleAgentCreated = (agentId: string) => {
		navigate(`/chat/${agentId}`);
		closeCreateAgentDialog();
	};

	/*
	 * The palette's keyboard doors (Cmd/Ctrl+K here, Cmd/Ctrl+P over IPC).
	 *
	 * Mounted here rather than inside `CommandPalette`, which returns null while
	 * it is closed: the listeners have to exist for the gesture that opens it.
	 * Both live in that hook so the two halves cannot drift — main's Cmd/Ctrl+P
	 * hook keeps sending whichever subscription the renderer has, so a dropped
	 * one is a chord that does nothing and says nothing.
	 */
	useCommandPaletteShortcut();

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

	/*
	 * `⌘N` / `Ctrl+N` starts a new chat, from wherever the user is — the other
	 * half of the promise the sidebar's New chat row prints as a key cap.
	 *
	 * ON THE DOCUMENT, and on the SHELL, for the reason the two halves have:
	 * `document` is where a press lands whatever has focus, including the
	 * composer, and the shell is the only component mounted on every route, so a
	 * cap that advertises "New chat" is not a claim about the chat page while
	 * the user is somewhere else. Which presses are NOT this shortcut's — the
	 * canvas's own `⌘N`, an open dialog or menu — is decided in
	 * `features/chat/new-chat-shortcut.ts`, so the rule is assertable without a
	 * DOM and the canvas's half of it shares one source with this one.
	 *
	 * `stageDraft(undefined, true)` and `navigate("/chat")`: exactly the two steps
	 * the sidebar row performs through the chat page's `stage`, and the same
	 * pair the agents page stages an entity chat with. Read through
	 * `getState()` rather than a selector so this listener is not re-registered
	 * by a re-render it has no use for.
	 *
	 * IT TAKES THE ROW'S OWN GATE, which is what makes "the two steps the row
	 * performs" true rather than nearly true: `catalogueReady` above is the same
	 * capability bit the row is disabled on. Without it the chord would stage a
	 * draft in the one state where the visible control refuses — no backend, or a
	 * backend older than `session_catalogue` v2 — and the shortcut would be
	 * claiming a capability the app has just said it does not have.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			/*
			 * The first-run wizard owns the window until it is answered, and it is a
			 * modal whose focus lands on its first control one frame after it opens.
			 * A press in that frame has `<body>` for a target, so the rule's own
			 * modal check cannot see it — and a draft staged behind a wizard the
			 * user has not finished would be waiting when they closed it.
			 */
			if (isOnboardingActive) return;
			if (!catalogueReady) return;
			if (!shouldStartNewChat(event)) return;
			event.preventDefault();
			useCanonicalSessionsStore.getState().stageDraft(undefined, true);
			navigate("/chat");
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [catalogueReady, isOnboardingActive, navigate]);

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
			 * There is one more thing this element now does: the two full-bleed bands are
			 * its first children, in flow (D9), so it is a flex COLUMN whose first
			 * children may or may not be there and whose region keeps the rest of the
			 * window. The `relative` above is still exactly the job it was.
			 *
			 * The app's `position: fixed` elements are otherwise unaffected, and the
			 * reason is the rule rather than a count: `position: relative` establishes a
			 * containing block for `absolute` descendants only. `fixed` resolves against
			 * the viewport unless an ancestor carries `transform`, `filter`,
			 * `perspective`, `backdrop-filter`, `contain` or `will-change` of one of
			 * those - none of which is added here - so the floating alert, the update
			 * notification, the dialogs, the sheets and the command palette keep
			 * covering the window exactly as before. The two bands have LEFT that set: each
			 * one's own root `div` is a child of this column now rather than a `fixed`
			 * strip, which is the whole point of the change. Measured on the chat route in
			 * the
			 * running app (`docs/evidence/band-occlusion/`): two `fixed` elements with
			 * no band up, four with both bands up before this change - and the two bands
			 * are the difference. An earlier draft of this comment claimed there was one
			 * such element; there were eight, and the guarantee does not depend on how
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
			<div className="relative flex h-screen flex-col overflow-hidden">
				{/*
				 * THE TWO FULL-BLEED BANDS ARE THE SHELL'S FIRST CHILDREN, and this
				 * container is a COLUMN for exactly that reason (D9).
				 *
				 * They used to be `fixed inset-x-0 top-0`, rendered in here like every
				 * other child and painted OVER the layout. A fixed band does not displace
				 * the rows it covers - it makes them ABSENT - and the rows it covered were
				 * not decoration: measured on `main` with the compatibility band up, the
				 * pane's own first row (device y 29-68 for a 1380x868 viewport, dpr 2) and
				 * the sidebar search control's top rows (device y 96-106 of its 96-160)
				 * were band paint, and with the daemon-absent copy up the band covered
				 * device y 0-136 of the same window.
				 *
				 * A RESERVING INSET WAS THE OTHER CANDIDATE and lost on measurement rather
				 * than taste: the band's height follows its COPY (53 CSS px with one line
				 * against 68 with two, in the same window), so an inset would have to be
				 * measured from the band rather than chosen, and TWO bands can be up at
				 * once - both at the top of the window, both `fixed`, so the inset would
				 * have to sum 68 + 53 = 121 CSS px for the case
				 * `docs/evidence/band-occlusion/before/before-two-bands.png` photographs.
				 * In flow, a band takes its height out of this container instead: nothing
				 * can be covered at any band height, by construction, and the region below
				 * keeps the rest of the window.
				 *
				 * The trade-off, accepted knowingly: an in-flow band shifts the app down at
				 * the moment it appears, which is the moment the app is already announcing a
				 * state change. What that buys is that the band can never be the reason a
				 * row is missing.
				 *
				 * The frames and the rects behind every number above are in
				 * `docs/evidence/band-occlusion/`; the rig that takes them is
				 * `scripts/band-occlusion-evidence.mjs`.
				 */}
				<ConnectivityBanner />

				<BackendCompatibilityBanner />

				{/*
				 * The app itself, in the space the bands leave. `flex-1 min-h-0` rather
				 * than `h-screen`: this element's height is the window MINUS whatever the
				 * bands above it took, and `min-h-0` is what lets it be smaller than its
				 * own content instead of pushing the shell past the window.
				 */}
				<div className="flex min-h-0 flex-1 overflow-hidden">
					{isCommandPaletteOpen && <CommandPalette />}

					{/*
					 * The shell's presenter for the machine panels, so `/info`, `/usage` and
					 * `/analytics` are readable from any page: the chat pane presents them
					 * whenever it is mounted (it is the claimant), and this is the host for
					 * every route the pane does not own. Mounted here rather than inside the
					 * chat route because that is the whole point — a panel that needs no
					 * conversation must not need a pane either.
					 *
					 * It lives in the REGION rather than in the column above it, because the
					 * thing it presents is app content and not a band: it renders `null`
					 * with no panel up, and with one up it renders a Radix `Dialog`, which
					 * portals to `document.body` — so the region's `overflow-hidden` cannot
					 * clip it. What the placement does have to preserve is that this host
					 * mounts BEFORE `<main>`: effects fire child-first in tree order, and
					 * the ordering is what keeps a panel request from being decided before
					 * the pane's own claim runs (see `panel-outlet.tsx`).
					 */}
					<PanelOutlet />

					<ModelsInitializer />

					<OnboardingModal open={isOnboardingActive} />

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
			</div>
		</OnboardingProvider>
	);
};

export default App;
