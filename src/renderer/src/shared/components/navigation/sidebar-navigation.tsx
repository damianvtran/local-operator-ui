import { aidaControlFailureCopy } from "@features/aida/aida-control";
import { useAidaMissedMessages } from "@features/aida/use-aida-missed-messages";
import { useAidaOpener, useAidaTarget } from "@features/aida/use-aida-target";
import { useAidaWorking } from "@features/aida/use-aida-working";
import { useAppWideApprovals } from "@features/browser/hooks/use-app-wide-approvals";
import { sidebarToggleCap } from "@features/chat/chat-sidebar-layout";
import { ChatSidebar } from "@features/chat/components/chat-sidebar";
/*
 * One decision, one spelling: the row the reader is ON is painted by the
 * sidebar's own role string rather than by a second copy of it here. A copy is
 * what drifted twice (design rounds 3 and 4, D17/D19) and both drifts landed at
 * an ELEMENT while the copied string above it stayed verbatim - so this column
 * imports the role exactly as the settings rail does, on its own import line,
 * which is the shape `chat-sidebar-selection.test.mjs` reads for.
 */
import { rowCurrent } from "@features/chat/components/chat-sidebar";
import { useFleetAsks } from "@features/chat/fleet-asks";
import { newChatShortcutCap } from "@features/chat/new-chat-shortcut";
import { openConversation } from "@features/chat/open-conversation";
import {
	paletteShortcutCaps,
	paletteShortcutLabel,
	switcherShortcutLabel,
} from "@features/command-palette/palette-shortcut";
import {
	pendingApprovalCount,
	useMeshApprovals,
} from "@features/mesh/mesh-approvals";
import { useMeshMembership } from "@features/mesh/mesh-store";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { useSidebarFrame } from "@shared/components/common/chat-layout";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { UpdateFootIcon } from "@shared/components/common/update-foot-icon";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import { Badge, Button, Tooltip } from "@shared/components/ui";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { cn } from "@shared/lib/utils";
import {
	CATALOGUE_HEAD_PAGE,
	LEGACY_CATALOGUE_PAGE,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { showErrorToast } from "@shared/utils/toast-manager";
import type { LucideIcon } from "lucide-react";
import {
	Bot,
	CalendarDays,
	ChevronLeft,
	ChevronRight,
	ChevronsUp,
	FolderKanban,
	Globe,
	LoaderCircle,
	MessageCircleQuestion,
	MessageSquarePlus,
	Network,
	PanelRight,
	Search,
	Settings,
	Store,
	X,
} from "lucide-react";
import { useCallback, useEffect } from "react";
import type { FC, ReactNode } from "react";
import { useNavigate } from "react-router-dom";

/*
 * THE ONE SIDEBAR.
 *
 * What this was: a 220px icon rail of destinations, drawn on EVERY route by
 * `app.tsx`, with the chat route drawing a second 280px list pane beside it.
 * That is 500px of chrome at 1380 and at 1024 alike, with the rail mostly empty
 * and the list pane's own top half carrying an agents/teams tree - so the chats
 * started below the fold's midpoint and the pane had two scrollbars (the
 * baseline's `geometry.json` records `nav 220, list 280, chat 880/524`).
 *
 * What this is: ONE column of 260px, mounted once in `app.tsx` inside
 * `chat-layout.tsx`, holding - top to bottom - the brand row, the primary
 * action, the destinations, the chat list as its body, and the account at the
 * foot. The body is `chat-sidebar.tsx`'s two SECTIONS - Agents + Teams above,
 * the chats list below - with the draggable, persisted boundary between them
 * (`sidebar-split.ts`), both drawn by default: the operator's call on the
 * preview was that both sections stay visible and relatively sizable, with the
 * navigation links in this same column. A 56px icon strip is what the column
 * collapses to.
 *
 * WHY THE DESTINATIONS STAY IN THIS FILE while the list moved in beside them:
 * the list's own component (`chat-sidebar.tsx`) reads the router, the
 * canonical-sessions store and the desktop capability hooks and is already
 * self-sufficient - it is rendered here rather than re-implemented - and the
 * destinations are the same table this file has always owned, on the same
 * routes and in the same order, so a tour step or a bookmark that names one
 * still lands where it always did.
 *
 * ## Why the ground is `surface`
 *
 * HISTORY, because the first half of this was a real fix and its finding still
 * holds. The rail was `surface` - a step *above* the `canvas` page - and on the
 * agents and settings routes it sat directly against another `surface` list
 * panel with no boundary between them, so the two merged into one 480px slab.
 * It was moved to `sunken` for that reason. THE ROW-STATE REFINEMENT PUT IT
 * BACK, because `sunken` broke something this column owns: the rows in it are
 * ROW STATES (`rowCurrent` for the destination you are on, `row-hover` for the
 * row under the pointer), and both roles are authored as a step of the palette's
 * own `surface` (`docs/design/row-states-refinement.md` § 4), so a column whose
 * ground is a rung *below* `surface` paints those states into that rung rather
 * than out of the panel they were measured against. MEASURED on the fleet: the
 * current row's fill landed ΔE00 0.44 off the column on `alucard` - 7 of the 59
 * palettes under the file's own 2.0 field floor. So the rule is the invariant:
 * **a surface that paints the row states wears `surface`.**
 *
 * THE BOUNDARY IS NOW THE PANE'S, and it is drawn there rather than here: this
 * column is `surface` and the chat pane beside it is `canvas`, a step apart with
 * no line needed, and the right pane keeps its leading `hairline`. The rule the
 * old rail needed - a drawn line between two `surface` panels - no longer has
 * two panels to separate on this screen.
 *
 * ## Density
 *
 * 260px docked (user-resizable 220-320), 56px collapsed, and the thresholds live
 * in `chat-sidebar-layout.ts` where they can be asserted. Every row here is
 * 30px: 16px glyph, 13px label, 8px of padding.
 */

type SidebarNavigationProps = Record<string, never>;

type NavItem = {
	icon: LucideIcon;
	label: string;
	path: string;
	isActive: boolean;
	tourTag: string;
	/**
	 * How many things are waiting on the user and are not this column's to count,
	 * one field for the two rows that carry one: browser approvals across every
	 * conversation (operator ask, 2026-09-23) and her unread completion receipts
	 * (operator ask, 2026-09-28). Zero draws nothing at all - a badge reading `0`
	 * would be a mark that says nothing is being asked, which is the honest
	 * rendering of an item with no badge.
	 */
	attention?: number;
	/**
	 * The badge's own handle, one per ROW that draws one: the approvals badge and
	 * the missed-messages badge are different controls made of one primitive, so
	 * the tag cannot be spelled beside the primitive - both would answer to one
	 * address (`nav-browser-badge` / `nav-aida-badge`).
	 */
	attentionTag?: string;
	/**
	 * WHAT THE NUMBER IS, in the control's name (see the name-carries-the-number
	 * rule at `renderNavItem`): the row's own sentence for its count, because
	 * "waiting" is what an approval does and a completion receipt is a missed
	 * message. Set beside `attention` on every row that draws a badge; a row
	 * without one would draw a badge its name could not state.
	 */
	attentionName?: (count: number) => string;
	/**
	 * Whether the row's thing is working RIGHT NOW - a turn in flight, the user's
	 * or a proactive wake's. It draws the app's busy mark (the sidebar's spinning
	 * `LoaderCircle`, the same accent ink and `motion-safe:animate-spin`) in the
	 * same trailing slot as a badge, and the two cannot coexist on one row: a busy
	 * row draws no unread mark (the store's one predicate), so the slot shows one
	 * fact at a time (operator ask, 2026-09-28).
	 */
	working?: boolean;
	/**
	 * WHAT THE WORKING MARK IS, in the control's name, the same
	 * name-carries-the-mark rule `attentionName` follows: the row's own sentence
	 * for its state, because a spinner is a visual convenience over "a turn is in
	 * flight" and the name has to state it (`Aida, working`).
	 */
	workingName?: string;
	/**
	 * What a press does, when it is not "navigate to `path`".
	 *
	 * Aida's row is the one that needs it: her conversation is RESOLVED — through
	 * the desktop route, ensuring her session on first use — rather than known as
	 * a route, so there is no `path` that could name it up front
	 * (`use-aida-target.ts` owns the resolution, and both this row and the
	 * composer's `/aida` read it from there). The row still carries `path:
	 * "/chat"`: it is the route the view lands on once the id resolves, and the
	 * row's own key in the list.
	 */
	onSelect?: () => void;
	/**
	 * Whether this row's press opens a PANE over the current page rather than
	 * navigating to `path`.
	 *
	 * The distinction is real and the row must not lie about it (design review
	 * round 1, D3): a row that navigates somewhere is a DESTINATION and says so with
	 * `aria-current="page"`; a row that toggles a right-slot pane is a DISCLOSURE - it
	 * leaves the page where it is and the pane docks over it - so it reports
	 * `aria-expanded` and carries the pane family's glyph. Without the flag the Asks
	 * row was drawn exactly like `Agents` and `Schedules` while its press navigated
	 * nowhere, which reads as "where did my page go".
	 */
	paneDoor?: boolean;
};

/**
 * THE STRIP KEEPS THE FEED ALIVE (the collapsed-rail requirement).
 *
 * `useDesktopFeed` is not only a status reporter: its subscription is what
 * MERGES `attention` and `session_status` frames into the sessions store, and
 * its consumer for the CATALOGUE was `ChatSidebar` - which the strip does not
 * render ("THE LIST IS NOT DRAWN HERE"). (Authoring lists mount the hook
 * wherever they render - the chat header, the agents page - so this is not the
 * app's only feed listener; those merges are revision-guarded and idempotent.
 * What IS exclusive is keeper-versus-list: an either/or in this column.) So
 * with the rail collapsed nothing kept the CATALOGUE current: her marks, both
 * sourced from the store, went stale until the rail expanded again, while the
 * browser row's approvals badge (fed by the browser bridge's own projection)
 * stayed live at every width. Measured on the marks rig: the expanded run
 * painted a receipt within seconds, and the strip run never did - 30 s of
 * polling at 50 ms - with no other catalogue-side consumer in the tree.
 *
 * FIVE THINGS HERE, each one a thing the list did that the strip otherwise
 * lost with it (review round 1, F1/F2):
 *
 * - the subscription itself (mounting the hook);
 * - the PAGEABILITY PUBLISH: the store sizes every UNNAMED catalogue read from
 *   this flag (`cataloguePageDefault`), and its only publisher was the list -
 *   so a launch (or a sub-1024px window) that STARTS collapsed read the legacy
 *   500-row page the paging work exists to remove;
 * - the mount read, gated on the catalogue capability (`ready`) exactly as the
 *   list gates it, because a frame can only merge into a row that exists;
 * - the INVALIDATION trigger: `feed.catalogueRevision` advances when the
 *   backend says the catalogue changed (a row added, renamed or archived
 *   elsewhere, or a frame missed), and re-running the read is how the strip
 *   reconciles that without waiting for an expand;
 * - nothing else. The list's feed-less safety poll is deliberately NOT
 *   mirrored: without a feed the marks do not move either - they arrive on
 *   this same subscription - so the poll would re-read a catalogue whose
 *   changes the strip cannot paint anyway. The reduced case belongs to the
 *   docked list, not to a second poll in a 56px column.
 */
const StripFeedKeeper: FC = () => {
	const feed = useDesktopFeed();
	const capabilities = useDesktopCapabilities();
	const setCataloguePageable = useCanonicalSessionsStore(
		(store) => store.setCataloguePageable,
	);
	const fetchSessions = useCanonicalSessionsStore(
		(store) => store.fetchSessions,
	);
	const pageable = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue_page",
	);
	useEffect(() => {
		setCataloguePageable(pageable);
	}, [pageable, setCataloguePageable]);
	/*
	 * The gate, spelled as the list spells it: the desktop plane available AND
	 * the backend advertising `session_catalogue` v2. Below it no read is sent -
	 * the same answer the list gives, not a second opinion.
	 */
	const ready =
		desktopFeatureState(capabilities.data, "session_catalogue", 2) ===
		"enabled";
	const refreshCatalogue = useCallback(
		() =>
			fetchSessions(
				pageable ? CATALOGUE_HEAD_PAGE : LEGACY_CATALOGUE_PAGE,
				pageable,
			),
		[fetchSessions, pageable],
	);
	// biome-ignore lint/correctness/useExhaustiveDependencies: catalogueRevision is a trigger, not a read
	useEffect(() => {
		if (!ready) return;
		void refreshCatalogue();
	}, [ready, refreshCatalogue, feed.catalogueRevision]);
	return null;
};

/** A destination row: 30px, one line, 13px, and never a second line. */
const DESTINATION_ROW =
	"flex h-[30px] w-full items-center gap-2 rounded-md px-2 text-body-sm transition-colors duration-fast ease-out-quart";

export const SidebarNavigation: FC<SidebarNavigationProps> = () => {
	const navigate = useNavigate();
	const currentView = useCurrentView();
	const { expanded, mode, onCollapse } = useSidebarFrame();
	const openCommandPalette = useUiPreferencesStore(
		(state) => state.openCommandPalette,
	);
	/*
	 * The catalogue capability, the gate the New chat row is disabled on - the
	 * same bit `app.tsx`'s ⌘N binding reads, so the row and the chord refuse in
	 * exactly the same states.
	 */
	const capabilities = useDesktopCapabilities();
	/*
	 * The open conversation, SUBSCRIBED rather than read once: the list marks the
	 * row the user is in, and a `getState()` read during render would freeze that
	 * mark at whatever was open when this component last re-rendered.
	 */
	const activeSessionId = useCanonicalSessionsStore(
		(state) => state.activeSessionId,
	);
	/*
	 * The column is on EVERY route, so its Browser item answers the question no
	 * per-conversation badge can: is an agent anywhere in this app blocked on me?
	 * The count is the projection's own live set, unattributed requests included -
	 * see `useAppWideApprovals` for why that one deliberately disagrees with the
	 * chat header's count.
	 */
	const browserApprovals = useAppWideApprovals();
	/*
	 * THE FLEET ASKS COUNT, the second app-wide badge in this column (operator ask,
	 * 2026-10-04). It is the answer to a question no per-session surface can ask:
	 * `chat-session-status.tsx` marks each ROW with its own conversation's
	 * outstanding asks, and the composer's chip counts the one conversation on
	 * screen — but a queued ask in a conversation the user is not looking at had no
	 * chrome at all, which is the same gap `useAppWideApprovals` was restored for on
	 * the Browser row.
	 *
	 * IT IS A SEPARATE READ FROM THE ROWS' OWN MARKS (the aggregate route, see
	 * `useFleetAsks`), because the rows' `asks_open` is a per-row projection and the
	 * TOTAL is what the top-level badge states — summing fifty row marks would be a
	 * second derivation of a number the backend already answers in one call.
	 */
	const fleetAsks = useFleetAsks();
	/*
	 * AND THE COLUMN OWNS THE FLEET DRAWER'S OWN STATE, because it owns the door: the
	 * press below both navigates nowhere (the pane is the SHELL's, see
	 * `chat-layout.tsx`, so it docks over whatever route is up) and opens the drawer
	 * `fleet`-scoped. The scope is written with the flag so the surface can never
	 * paint one queue's rows under the other's title.
	 */
	const askDrawerOpen = useUiPreferencesStore((s) => s.isAskDrawerOpen);
	const askDrawerScope = useUiPreferencesStore((s) => s.askDrawerScope);
	const setAskDrawerOpen = useUiPreferencesStore((s) => s.setAskDrawerOpen);
	const fleetAsksOpen = askDrawerOpen && askDrawerScope === "fleet";
	const openFleetAsks = () => setAskDrawerOpen(true, "fleet");
	/*
	 * Whether this device is in a mesh AT ALL, and it takes TWO facts rather than one
	 * (review round 1, R1-1). `features.peers` is a CAPABILITY: lop advertises it on
	 * every install, "including on a machine in no network", because it answers "what can
	 * this backend do" - so on the key alone every mesh-capable install would get a rail
	 * item, including a device that is in no mesh, and this is the one piece of chrome
	 * that is on screen everywhere. Membership is the catalogue's own emptiness; see
	 * `useMeshMembership` for why that read is safe on a machine that has never joined a
	 * network, and for why an UNKNOWN answer mounts nothing.
	 *
	 * The route itself stays on the capability, deliberately: see the note at the route
	 * in `app.tsx` for why leaving your last network must not eject you from the tab.
	 */
	const meshPaired =
		desktopFeatureState(capabilities.data, "peers") === "enabled";
	const meshMembership = useMeshMembership(meshPaired);
	/*
	 * THE MESH ROW'S BADGE NUMBER — the mesh's counterpart of the Browser row's
	 * approvals count, and the ONE mesh-family read this column POLLS.
	 *
	 * The interval is deliberate here where `networks.list` is forbidden one
	 * (mesh-store.ts, review round 2 R2-1): that read dials every peer, this one
	 * dials NOTHING — the approval records are device-local files, so a tick is
	 * one cold scan of a small directory and no socket at all. And it is the ONE
	 * fact of the family whose whole point is to reach the user while they are
	 * somewhere else: a badge that only moved when the tab was open would not be
	 * a notification. `mesh-approvals.ts` owns the cadence and the argument.
	 *
	 * Gated on membership as well as the key, and that is the row's own gate
	 * rather than the read's: a device in no network renders no Mesh row, so a
	 * badge on it would be a count nothing could show. (The `/mesh` route still
	 * reads once on mount for a non-member, which is what lets a
	 * `local_authority` record be answered there.)
	 */
	const meshApprovalsEnabled =
		desktopFeatureState(capabilities.data, "approvals") === "enabled";
	const meshApprovals = useMeshApprovals(
		meshMembership === "member" && meshApprovalsEnabled,
		{ poll: true },
	);
	const meshWaiting = pendingApprovalCount(meshApprovals.data ?? []);
	/*
	 * Whether this backend serves the Projects surface at all.
	 *
	 * FAIL-CLOSED MEANS NO ROW, the pins gate's rule: below the `projects`
	 * version (or on a plane this app holds no credential for) the column renders
	 * byte-for-byte the one that never heard of Projects — no row, no disabled
	 * row, nothing to click into a 404. The route itself repeats the gate for a
	 * URL typed by hand; see `projects-page.tsx`.
	 */
	const projectsEnabled = desktopFeatureEnabled(
		capabilities.data,
		"projects",
		1,
	);
	/*
	 * AIDA'S ROW, and its TWO gates, which are two different facts.
	 *
	 * `features.aida` is the CAPABILITY: below it the backend predates the
	 * surface and the UI must not call her route at all (`design.md` § 3.4) —
	 * fail-closed, like Projects above.
	 *
	 * `enabled` is the INSTALL's own switch (R17/R18: `aida.enabled` /
	 * `LOCAL_OPERATOR_NO_AIDA`). A harness-only install carries the endpoint and
	 * answers `enabled: false` — a row there would open a conversation nothing
	 * ever creates and whose every press answers `409 aida_disabled`, exactly the
	 * dead control fail-closed means to omit. So the row waits for the read's own
	 * `enabled === true`: absent, not-yet-answered and switched-off all render the
	 * column that never heard of her, and the read is why the row can POP IN a
	 * moment late on a normal install — the price of never showing it where it
	 * must not be.
	 */
	const aidaEnabled = desktopFeatureEnabled(capabilities.data, "aida", 1);
	const aida = useAidaTarget(aidaEnabled);
	const aidaVisible = aidaEnabled && aida.data?.enabled === true;
	/*
	 * HER DISPLAY NAME (rename slice, in flight): the desktop read's `name`,
	 * falling back to the shipped default for every backend that predates the
	 * field - absent, null and an older payload all render "Aida" rather than an
	 * empty row. The COMMAND KEY is not affected: `/aida` stays stable whatever
	 * she is called (`use-aida-target.ts` owns the pair).
	 */
	const aidaName = aida.data?.name ?? "Aida";
	const openAida = useAidaOpener();
	/*
	 * HER BADGE'S NUMBER (operator ask, 2026-09-28): unread completion receipts
	 * for HER conversation - "missed messages" in the operator's words, and the
	 * browser row's approvals badge was the model. `use-aida-missed-messages.ts`
	 * owns the count's two narrowings and the store subscription that keeps it
	 * live: the feed raises it when she completes a turn, and viewing her
	 * conversation receipts it away.
	 */
	const aidaMissed = useAidaMissedMessages(aida.data?.session_id);
	/*
	 * HER WORKING MARK (operator ask, 2026-09-28): the state the chat sidebar
	 * draws for her row - a turn in flight, the user's or a proactive wake's -
	 * read from her catalogue row's status so it is true while her conversation is
	 * CLOSED, which is exactly when a wake runs. `use-aida-working.ts` owns the
	 * one code that counts as working and the subscription that keeps it live.
	 */
	const aidaWorking = useAidaWorking(aida.data?.session_id);
	/*
	 * Her press: resolve her conversation (ensuring it on first use, through the
	 * one module the composer's `/aida` also reads) and move the view onto it. The
	 * failure sentence is the module's own — a 409 for a mid-session disable, or
	 * the transport's words — and it lands on the toast lane because this row owns
	 * no other surface to say it on.
	 */
	const selectAida = () => {
		void openAida(navigate, aida.data).catch((error) =>
			showErrorToast(aidaControlFailureCopy(error)),
		);
	};

	const navItems: NavItem[] = [
		/*
		 * AIDA SITS ABOVE AGENTS (R3): she is the operator's chief of staff, and the
		 * row is the first destination in the column when the backend offers her.
		 * The row itself is the ordinary destination row — 30px, one line, the
		 * same `renderNavItem` every neighbour uses — with one difference: its
		 * press resolves rather than navigates (`onSelect`), because her id is not
		 * known until the desktop route answers. Collapsed, it is the same
		 * icon-only row with its tooltip (`renderNavRow`), which is why nothing here
		 * has a second rendering.
		 */
		...(aidaVisible
			? [
					{
						icon: ChevronsUp,
						label: aidaName,
						path: "/chat",
						isActive:
							currentView === "chat" &&
							Boolean(aida.data?.session_id) &&
							activeSessionId === aida.data?.session_id,
						tourTag: "nav-item-aida",
						onSelect: selectAida,
						/*
						 * Her count (operator ask, 2026-09-28): the missed-messages badge,
						 * the same primitive as the Browser row's approvals pill - zero
						 * draws nothing. `use-aida-missed-messages.ts` says what one receipt
						 * counts; `renderNavItem` the name/badge rules these three fields
						 * inherit.
						 */
						attention: aidaMissed,
						attentionTag: "nav-aida-badge",
						attentionName: (count: number) =>
							`${aidaName}, ${count} missed message${count === 1 ? "" : "s"}`,
						/*
						 * Her working mark: the same two facts the badge carries, for the state
						 * that is true while she is mid-turn (see `use-aida-working.ts`), with
						 * the row's own sentence for the name.
						 */
						working: aidaWorking,
						workingName: `${aidaName}, working`,
					},
				]
			: []),
		/*
		 * THE FLEET ASKS ROW — the top-level entry point, beside the sessions list and
		 * the destinations (operator ask, 2026-10-04; design note §4.4's second
		 * context).
		 *
		 * WHY IT OPENS A PANE AND NOT A ROUTE. The surface it opens is the right
		 * slot's pane (`chat-layout.tsx`), which is the canvas family's container — a
		 * route would be a second idiom for one surface, and it would take the user off
		 * the conversation or the page they were reading to show them a list that is
		 * about OTHER conversations. So the press opens the pane over whatever route is
		 * up, `path` stays the route its neighbouring rows are shaped by (the shell
		 * resolves it as Aida's row does - a row whose press does not navigate still
		 * needs a shape), and the row is KEYED by its own `tourTag` rather than by that
		 * shared `path` (see `renderNavItem`). `paneDoor` is what tells the renderer
		 * this row is a disclosure rather than a destination, which is what stops it
		 * reporting `aria-current="page"` and gives it the pane family's glyph (design
		 * review round 1, D3).
		 *
		 * IT MARKS WHICH SCOPE THE COUNT IS. The row's own label carries the scope
		 * ("All asks"), its sentence says "across all conversations" whenever a badge is
		 * drawn, and the panel's chrome bar repeats it ("All conversations · N") — a
		 * count of 3 beside a session's chip and 11 here describe different things and
		 * both are correct, so the surface has to say which one it is before the reader
		 * has to work it out (design review round 1, D2; UX round 1, U3).
		 *
		 * GATED ON THE READ HAVING ANSWERED, not on a capability bit: a backend that
		 * predates the aggregate route answers 404, `useFleetAsks` answers
		 * `answered: false`, and the row is absent — the fail-closed rule
		 * `ask-queue.ts` states for the session item ("a backend that does not do queued
		 * asks must not grow an affordance that can never be satisfied"), applied to the
		 * one control that would otherwise open a panel whose every read 404s. The price
		 * is the same one Aida's row already pays: it can pop in a moment late on a
		 * normal install.
		 */
		...(fleetAsks.answered
			? [
					{
						icon: MessageCircleQuestion,
						/*
						 * THE LABEL CARRIES THE SCOPE (design review round 1, D2; UX round 1, U3).
						 * "Asks" alone left the badge's `11` unqualified on screen - the word "all
						 * conversations" lived only in the accessible name, and a reader comparing
						 * the rail's 11 with the composer chip's "2 questions waiting" had nothing
						 * telling them the two numbers describe different sets. "All asks" is the
						 * two-word form of the pane's own subject (`askScopeSubject`'s "All
						 * conversations"), and it is already the surface's accessible name
						 * (`ask-drawer.tsx`'s `aria-label="All asks"`), so the row reads in the
						 * register the pane it opens uses.
						 */
						label: "All asks",
						path: "/chat",
						isActive: fleetAsksOpen,
						tourTag: "nav-item-asks",
						onSelect: openFleetAsks,
						paneDoor: true,
						attention: fleetAsks.outstanding,
						attentionTag: "nav-asks-badge",
						/*
						 * THE NUMBER IS THE TOTAL, AND THE NAME SAYS SO (design review round 1,
						 * D4). The badge counts the backend's whole outstanding set - `open` AND
						 * `timed_out`, `fleetAsksOutstanding`'s fold - while the pane's chrome bar
						 * spells the same population as "10 waiting, 1 moved on". Two numbers for
						 * one payload with the sum unstated read as a contradiction, so the row
						 * states its own total in the pane's own vocabulary.
						 */
						attentionName: (count: number) =>
							`All asks, ${count} across all conversations, waiting or moved on`,
					},
				]
			: []),
		{
			icon: Bot,
			label: "Agents",
			path: "/agents",
			isActive: currentView === "agents",
			tourTag: "nav-item-agents",
		},
		/*
		 * Projects sits beside Agents — the two are the "things I own" pair — but
		 * only on a backend that carries the surface; see `projectsEnabled` above.
		 */
		...(projectsEnabled
			? [
					{
						icon: FolderKanban,
						label: "Projects",
						path: "/projects",
						isActive: currentView === "projects",
						tourTag: "nav-item-projects",
					},
				]
			: []),
		{
			icon: CalendarDays,
			label: "Schedules",
			path: "/schedules",
			isActive: currentView === "schedules",
			tourTag: "nav-item-schedules",
		},
		{
			// Named "Browser" rather than "Web" or "Pages": the feature is a browser
			// the user can use and an agent can drive, and the design's own word for
			// it is the tab it opens (design 11.9).
			icon: Globe,
			label: "Browser",
			path: "/browser",
			isActive: currentView === "browser",
			tourTag: "nav-item-browser",
			attention: browserApprovals,
			/*
			 * This row's badge words and handle, beside the count they serve (see
			 * `NavItem.attentionTag` / `attentionName`): the name states the count
			 * whenever the badge is drawn, in BOTH widths.
			 */
			attentionTag: "nav-browser-badge",
			attentionName: (count) => `Browser, ${count} waiting`,
		},
		{
			icon: Store,
			label: "Agent hub",
			path: "/agent-hub",
			isActive: currentView === "agent-hub",
			tourTag: "nav-item-agent-hub",
		},
		/*
		 * The Mesh tab, ONLY for a device that is in a mesh: a rail item for a mesh the
		 * user is not in would be a dead end on the one piece of chrome that is on screen
		 * everywhere (R1-1). Placed after Agent hub and before the Settings row - it is a
		 * view of THIS machine's infrastructure, which is nearer to Settings than to any
		 * chat surface.
		 *
		 * ITS BADGE IS THE ONBOARDING COUNT (`features.approvals`), the same
		 * shape the Browser row uses for its own approvals: one number, only while
		 * something waits, and a name that states it in both widths. Zero draws
		 * nothing, so a mesh at rest renders the row exactly as it shipped.
		 */
		...(meshMembership === "member"
			? [
					{
						icon: Network,
						label: "Mesh",
						path: "/mesh",
						isActive: currentView === "mesh",
						tourTag: "nav-item-mesh",
						attention: meshWaiting,
						attentionTag: "nav-mesh-badge",
						attentionName: (count: number) => `Mesh, ${count} waiting`,
					},
				]
			: []),
	];

	/*
	 * THE BODY. The list brings its own actions - its `New chat` row stages an
	 * untargeted draft, its rows open conversations - and it is handed the two
	 * callbacks its existing API asks for rather than reading the store itself.
	 * `openConversation` is the same function the route's own switcher uses, so a
	 * click here and a click inside the pane are one code path with one set of
	 * rules about the URL.
	 *
	 * The route's own `setRouteError(null)` half of that path stays with the
	 * route: `chat-page.tsx` clears its sentence when the draft key or the route
	 * identity moves, and a switch from this column moves both.
	 */
	const listBody: ReactNode = (
		<ChatSidebar
			selectedConversation={activeSessionId ?? undefined}
			onSelectConversation={(id: string) => void openConversation(navigate, id)}
			onStageDraft={(target?: ChatTarget, fresh?: boolean) => {
				useCanonicalSessionsStore.getState().stageDraft(target, fresh);
				navigate("/chat");
			}}
		/>
	);

	/*
	 * THE ROW'S OWN SENTENCE (operator ask, 2026-09-23): a badge is a visual
	 * convenience over a fact the control has to STATE, and a screen reader that
	 * found only the word "Browser" would be told there was nothing to answer
	 * while an agent sat blocked on a prompt. Set in BOTH widths so the name does
	 * not change with the column's width - and only when a mark is drawn, so a
	 * quiet column keeps the plain label it has always had. The words are the
	 * ROW's own (`attentionName` / `workingName`): an approval waits, a completion
	 * receipt is a missed message, a turn in flight is working - one fact, one
	 * sentence, per row. The working mark wins the name where both might obtain;
	 * on her row they cannot, because a busy code draws no unread mark.
	 *
	 * ONE DERIVATION SERVES BOTH WIDTHS, which is the half UX round 1, U3 / design
	 * round 1, D2 asked for: the collapsed rail prints this sentence in its TOOLTIP,
	 * not the bare `label`, so the scope word a badge's number needs is on screen in
	 * the width where the row has no text at all. Two spellings would let the hover
	 * text and the announced name disagree about one count.
	 */
	const rowName = (item: NavItem): string => {
		const count = item.attention ?? 0;
		const attentionLabel =
			count > 0 && item.attentionName ? item.attentionName(count) : item.label;
		return item.working && item.workingName ? item.workingName : attentionLabel;
	};

	const renderNavItem = (item: NavItem) => {
		/*
		 * The tour clicks these by `[data-tour-tag="nav-item-agents"]` and its
		 * siblings, so the tag has to stay on the button itself. Putting it on a
		 * wrapper would leave the tour dispatching a click at a div and silently
		 * doing nothing.
		 */
		const attention = item.attention ?? 0;
		const markLabel = rowName(item);
		const rowState = item.isActive
			? rowCurrent
			: "text-ink-muted hover:bg-row-hover hover:text-ink";
		return (
			<li
				/*
				 * KEYED BY THE TAG, not by `path` (design review round 1, F2). `path` is the
				 * ROUTE a destination row goes to, and two rows deliberately share one: Aida's
				 * resolves her conversation and lands on `/chat`, and All asks toggles a pane
				 * over whatever route is up. Both can be on screen at once and both resolve
				 * asynchronously, so React saw two siblings keyed `/chat` inserted at
				 * different times - a duplicate-key warning and ambiguous reconciliation. The
				 * tag is the row's own name and is already unique per row.
				 */
				key={item.tourTag}
				className={cn(
					"flex h-[30px] w-full items-center rounded-md",
					"transition-colors duration-fast ease-out-quart",
					rowState,
				)}
			>
				<button
					type="button"
					onClick={() =>
						item.onSelect ? item.onSelect() : navigate(item.path)
					}
					data-tour-tag={item.tourTag}
					/*
					 * A PANE DOOR IS A DISCLOSURE, NOT A PAGE (design review round 1, D3).
					 * `aria-current="page"` says "you are here", which is false for a row
					 * whose press leaves the route alone and docks a pane over it; the honest
					 * state for an open pane is `aria-expanded`.
					 */
					aria-current={
						item.paneDoor ? undefined : item.isActive ? "page" : undefined
					}
					aria-expanded={item.paneDoor ? item.isActive : undefined}
					/* Collapsed there is no text in the row, and the tooltip cannot
					   supply the name: Radix's `Trigger` adds `aria-describedby`, and
					   only while open. */
					aria-label={
						expanded && markLabel === item.label ? undefined : markLabel
					}
					className={cn(
						"flex h-full min-w-0 flex-1 items-center gap-2 rounded-md",
						expanded ? "px-2" : "justify-center px-0",
					)}
				>
					<item.icon
						size={16}
						aria-hidden="true"
						className={cn("shrink-0", item.isActive && "text-accent")}
					/>
					{expanded && <span className="truncate">{item.label}</span>}
					{/*
					 * THE PANE CUE (design review round 1, D3): the family's own `PanelRight`,
					 * at the disclosure's size, so the one row that opens a pane says so before
					 * it is pressed rather than after. `aria-hidden` because `aria-expanded`
					 * already carries the state and the name carries the count - this is the
					 * sighted reader's copy of the same fact.
					 */}
					{expanded && item.paneDoor && (
						<PanelRight
							size={13}
							aria-hidden="true"
							className="shrink-0 text-ink-dim"
						/>
					)}
					{attention > 0 && (
						/*
						 * THE SAME BADGE THE HEADER'S GLOBE CARRIES (design 5.1). In flow at
						 * the row's trailing edge rather than absolutely positioned: the row is
						 * 30px with a 13px label, so the trailing edge IS its top-right at any
						 * size a badge would use, and a 16px badge inside a 30px row moves
						 * neither the label's start nor the row's height.
						 */
						<span className={cn(expanded && "ml-auto", "inline-flex")}>
							{/*
							 * THE QUIET COUNT (operator ask, 2026-09-30): the rail's badge is
							 * the `attentionQuiet` register rather than the bordered `attention`
							 * mark - borderless, an `elevated` whisper instead of the warning
							 * wash, and the count family's own `ink-dim` / `text-meta-sm`
							 * numeral, so it reads with the sidebar's team-count lines. The
							 * header's globe keeps the bordered mark: it sits in a glyph
							 * cluster, where the ring is what separates it from neighbouring
							 * icons and the wash is the feature's "an agent is blocked on
							 * you" meaning.
							 */}
							<Badge
								variant="attentionQuiet"
								shape="pill"
								size="count"
								data-tour-tag={item.attentionTag}
							>
								{attention}
							</Badge>
						</span>
					)}
					{item.working && (
						/*
						 * THE BUSY MARK, at rail scale: the sidebar row's own working glyph -
						 * `LoaderCircle`, the accent ink, and `motion-safe:animate-spin`, so a
						 * reduced-motion user keeps the STATIC glyph this app already renders
						 * for the state rather than a second animation. Same trailing slot as
						 * the badge, in flow for the same reason (a 16px mark inside a 30px
						 * row moves neither the label's start nor the row's height); the two
						 * cannot coexist, because a busy row draws no unread mark.
						 */
						<span className={cn(expanded && "ml-auto", "inline-flex")}>
							<LoaderCircle
								size={16}
								aria-hidden="true"
								className="text-accent motion-safe:animate-spin"
							/>
						</span>
					)}
				</button>
			</li>
		);
	};

	/*
	 * Collapsed, the tooltip is the only name a row shows on screen; the
	 * accessible name is the button's own `aria-label`. Wrapping the `<li>` keeps
	 * one DOM shape in both widths, so the rows MOVED between the two renders
	 * rather than being rebuilt in a second layout.
	 */
	const renderNavRow = (item: NavItem) =>
		expanded ? (
			renderNavItem(item)
		) : (
			/*
			 * THE TOOLTIP CARRIES THE SENTENCE, NOT THE BARE LABEL (UX round 1, U3;
			 * design round 1, D2). Collapsed, this is the only text the row ever shows,
			 * so a tooltip reading "Asks" left the badge's number scope-less in the one
			 * width where the row has no other words. It prints `rowName`, the same
			 * string the expanded row's accessible name uses, so the hover text and the
			 * name cannot disagree about one count.
			 */
			<li key={item.tourTag}>
				<Tooltip content={rowName(item)} side="right">
					{renderNavItem(item)}
				</Tooltip>
			</li>
		);

	/*
	 * THE ONE TOGGLE, and its glyph follows WHERE the sidebar is drawn (design
	 * round 1, D3). Docked, it collapses to the strip: `‹`. In the sheet it
	 * closes the sheet: `×`, because the sheet is a layer that goes away rather
	 * than a column that narrows. In the strip it expands: `›` (the dock at
	 * >=1024, the sheet below - the shell decides which, `chat-layout.tsx`). The
	 * sheet used to draw the docked `‹` beside the dialog primitive's own `×`,
	 * one over the other in a single focus-ringed box.
	 */
	const toggleLabel =
		mode === "overlay"
			? "Close sidebar"
			: expanded
				? "Collapse sidebar"
				: "Expand sidebar";
	const ToggleGlyph =
		mode === "overlay" ? X : expanded ? ChevronLeft : ChevronRight;
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
	const catalogueReady = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const activeDraftKey = useCanonicalSessionsStore(
		(state) => state.activeDraftKey,
	);
	const drafts = useCanonicalSessionsStore((state) => state.drafts);
	/*
	 * An untargeted draft is the one THIS row stages, so it is the row marked
	 * current while one is up - the same terms the list's old `New chat` row
	 * used. A draft with a target belongs to its agent's row.
	 */
	const untargetedDraft =
		Boolean(activeDraftKey) &&
		!(activeDraftKey ? drafts[activeDraftKey] : undefined)?.target;
	const stageNewChat = () => {
		useCanonicalSessionsStore.getState().stageDraft(undefined, true);
		navigate("/chat");
	};

	/*
	 * THE PRIMARY ACTIONS, two 30px rows at the top of the column (§C1.2; design
	 * round 1, D1): `New chat ⌘N`, then `Search ⌘K`.
	 *
	 * New chat moved HERE from the list's own header, where it sat under a second
	 * search field, a disclosure and an `All chats` row - the placement the design
	 * round named as the biggest reason the shell read as two panels welded
	 * together. Search stays the command palette's door: the one visible search in
	 * the column. The list's own filter is type-to-filter now (`chat-sidebar.tsx`),
	 * so there is no second search control at rest.
	 *
	 * THE CHORD IS WRITTEN ON THE ROW, as caps with no separator between them
	 * (N1: `⌘K`, not `⌘ + K`) - the app's `KeyboardShortcut` spells a chord as
	 * `+`-joined caps and prints the `+`, so the rows pass the caps as one string
	 * and split nothing. The accessible name carries the chord in words.
	 *
	 * DISABLED ON THE CATALOGUE GATE, the same bit `app.tsx`'s ⌘N reads: staging a
	 * draft needs the session catalogue, and a row that staged one against an
	 * absent catalogue would be the shortcut claiming a capability the app has
	 * just said it does not have.
	 */
	const newChatLabel = `New chat (${newChatShortcutCap(isMac).replace("+", "")})`;
	/*
	 * BOTH DOORS IN THE NAME (design/UX round 2, U3): this row is where the app
	 * teaches the search chord, and since #659 there are two of them —
	 * `Cmd/Ctrl+K` for the everything palette and `Cmd/Ctrl+P` for the
	 * conversation switcher. The visible cap stays K: one cap is the row's
	 * budget, and two caps beside "Search" would read as a combined chord. The
	 * second door rides in the accessible name and (for the strip, which draws
	 * its name as a tooltip) in the tooltip, so a reader who never met the tour
	 * can still find it.
	 */
	const searchLabel = `Search (${paletteShortcutLabel(isMac)}) — chats (${switcherShortcutLabel(isMac)})`;
	const searchTitle = `Search everything (${paletteShortcutLabel(isMac)}) · your chats (${switcherShortcutLabel(isMac)})`;
	const primaryRow = (
		icon: LucideIcon,
		label: string,
		caps: string,
		props: {
			onClick: () => void;
			ariaLabel: string;
			current?: boolean;
			disabled?: boolean;
			attrs?: Record<string, string>;
		},
	) => {
		const Icon = icon;
		return (
			<button
				type="button"
				{...props.attrs}
				onClick={props.onClick}
				disabled={props.disabled}
				aria-label={props.ariaLabel}
				aria-current={props.current ? "page" : undefined}
				className={cn(
					DESTINATION_ROW,
					props.current
						? rowCurrent
						: "text-ink-muted hover:bg-row-hover hover:text-ink",
					"disabled:text-ink-disabled disabled:hover:bg-transparent",
				)}
			>
				<Icon size={16} aria-hidden="true" className="shrink-0" />
				<span className="truncate">{label}</span>
				{/*
				 * Decorative: the accessible name above already carries the chord, so the
				 * caps are hidden from a screen reader rather than announced beside it.
				 */}
				<span aria-hidden="true" className="ml-auto">
					<KeyboardShortcut shortcut={caps} joined />
				</span>
			</button>
		);
	};
	const newChatRow = primaryRow(
		MessageSquarePlus,
		"New chat",
		newChatShortcutCap(isMac),
		{
			onClick: stageNewChat,
			ariaLabel: newChatLabel,
			current: untargetedDraft,
			disabled: !catalogueReady,
			/*
			 * THE TOUR'S CHAT ANCHOR: the one sidebar's body IS the chat list, so the
			 * onboarding step that clicks its way back to a conversation needs a control
			 * that lands on `/chat`, and this row is the one that does.
			 */
			attrs: { "data-tour-tag": "nav-item-chat", "data-new-chat-row": "" },
		},
	);
	const searchRowExpanded = primaryRow(
		Search,
		"Search",
		paletteShortcutCaps(isMac),
		{
			onClick: openCommandPalette,
			ariaLabel: searchLabel,
			/* The title is what teaches the second door to a mouse reader; the cap
			 * above can only carry one chord. */
			attrs: { "data-command-palette-trigger": "", title: searchTitle },
		},
	);

	/*
	 * A strip control: 32px, one glyph, the name in a tooltip and in
	 * `aria-label`. The strip's first group is expand + New chat + Search (§J2/§C3,
	 * design round 1, D11): with only the destinations in it, New chat was
	 * reachable from a narrow window by ⌘N alone.
	 */
	const stripButton = (
		icon: LucideIcon,
		label: string,
		props: {
			onClick: () => void;
			disabled?: boolean;
			attrs?: Record<string, string | boolean>;
		},
	) => {
		const Icon = icon;
		return (
			<Tooltip content={label} side="right">
				<button
					type="button"
					{...props.attrs}
					onClick={props.onClick}
					disabled={props.disabled}
					aria-label={label}
					className={cn(
						"flex size-8 items-center justify-center rounded-sm text-ink-muted",
						"transition-colors duration-fast ease-out-quart",
						"hover:bg-row-hover hover:text-ink",
						"disabled:text-ink-disabled disabled:hover:bg-transparent",
					)}
				>
					<Icon size={16} aria-hidden="true" />
				</button>
			</Tooltip>
		);
	};

	/*
	 * The collapse/close control in the brand row, revealed when the column is
	 * pointed at or contains focus - Linear, Notion and Slack all put it in the
	 * header and reveal it on hover. In the SHEET it is always drawn: it is the
	 * sheet's one visible close, and a close that appears only on hover in a layer
	 * the user just opened is a close they have to hunt for.
	 *
	 * `pointer-events-none` gates the mouse only; focus is unaffected, so the
	 * button keeps its place in the tab order and reveals itself with
	 * `group-focus-within/sidebar` when a keyboard reaches it.
	 *
	 * `aria-keyshortcuts` names the chord the shell answers (`chat-layout.tsx`):
	 * this control and that handler are the two halves of one gesture.
	 */
	const collapseToggle = (
		<div
			className={cn(
				mode !== "overlay" &&
					cn(
						"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
						"group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100",
						"group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:opacity-100",
					),
			)}
		>
			<Tooltip content={toggleLabel} side="right">
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onCollapse}
					aria-label={toggleLabel}
					aria-expanded={mode === "overlay" ? undefined : expanded}
					aria-keyshortcuts={sidebarToggleCap(isMac)}
				>
					<ToggleGlyph aria-hidden="true" />
				</Button>
			</Tooltip>
		</div>
	);

	/*
	 * The two affordances Settings keeps, and the reason it left the destination
	 * group: it is a route the user visits once and then returns from, so a
	 * permanent row spent a destination's width on it while the account row in
	 * the same foot already opens onto the same place. The gear is the one press;
	 * the account menu is the one that also carries Sign out. The tour's
	 * `navigate-settings` step attaches to this button, which is why it carries
	 * the tag rather than the menu item.
	 */
	const settingsGear = (
		<Tooltip content="Settings" side="top">
			<button
				type="button"
				data-tour-tag="nav-item-settings"
				onClick={() => navigate("/settings")}
				aria-current={currentView === "settings" ? "page" : undefined}
				aria-label="Settings"
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
					currentView === "settings" && "text-ink",
				)}
			>
				<Settings size={16} aria-hidden="true" />
			</button>
		</Tooltip>
	);

	if (!expanded) {
		/*
		 * The 56px strip. 48 would be the VS Code activity bar's width and what the
		 * old rail collapsed to; 56 is 48 plus 8, so a 16px glyph keeps an 8px step
		 * on each side and a 28px hit target fits.
		 *
		 * THE LIST IS NOT DRAWN HERE. A 56px column cannot show a conversation
		 * title. The strip is: the brand, then the first group - expand, New chat,
		 * Search (§J2; design round 1, D11: it used to hold no New chat and no
		 * visible expand, so a narrow window reached New chat by ⌘N alone) - then
		 * the destinations, then the foot.
		 */
		return (
			<div
				data-sidebar-strip=""
				className="group/sidebar flex h-full min-h-0 flex-col items-center bg-surface"
			>
				<StripFeedKeeper />
				<div className="flex h-10 shrink-0 items-center justify-center">
					<CollapsibleAppLogo expanded={false} />
				</div>
				<ul className="flex flex-col items-center gap-1">
					<li>
						{stripButton(ChevronRight, toggleLabel, {
							onClick: onCollapse,
							attrs: {
								"aria-expanded": false,
								"aria-keyshortcuts": sidebarToggleCap(isMac),
							},
						})}
					</li>
					<li>
						{stripButton(MessageSquarePlus, newChatLabel, {
							onClick: stageNewChat,
							disabled: !catalogueReady,
							attrs: { "data-tour-tag": "nav-item-chat" },
						})}
					</li>
					<li>
						{stripButton(Search, searchLabel, {
							onClick: openCommandPalette,
							attrs: { "data-command-palette-trigger": "" },
						})}
					</li>
				</ul>
				<ul className="mt-4 flex flex-col items-center gap-1">
					{navItems.map(renderNavRow)}
				</ul>
				<div className="mt-auto flex flex-col items-center gap-1 pb-2">
					{/*
					 * THE STANDING UPDATE NOTICE SITS IN THIS COLUMN ABOVE THE GEAR
					 * (design consult §3.1): the icon, the gear, the avatar - the strip's
					 * own `gap-1` column. Hidden draws nothing at all, so a row without
					 * anything waiting renders exactly as it did before the icon existed.
					 */}
					<UpdateFootIcon />
					{settingsGear}
					<UserProfileSidebar expanded={false} />
				</div>
			</div>
		);
	}

	/*
	 * `group/sidebar`, NAMED, and that is a fix rather than a style. Tailwind's
	 * bare `group-hover:` matches ANY hovered ancestor `.group`, and since the
	 * merge this column is an ancestor of every conversation row, whose own
	 * `group` reveals its Pin and Archive acts - so an unnamed group here revealed
	 * the acts on EVERY row whenever the pointer was anywhere in the sidebar.
	 */
	return (
		/*
		 * `overflow-hidden`, NOT `overflow-x-hidden`, and the difference is a
		 * scrollbar the operator caught in a screenshot: setting ONE axis of
		 * `overflow` turns the other axis from `visible` into `auto` (CSS 2.1
		 * §11.1.1), so `overflow-x-hidden` alone made THIS div a vertical scroller -
		 * a third scrollbar on the column, wrapping the two the sections below the
		 * boundary carry, with a wheel event having no unambiguous target and the
		 * brand row, `New chat` and the destinations able to be scrolled away from
		 * under the pointer. The column never scrolls: the two panes below the
		 * boundary each scroll themselves, and anything that would not fit here is
		 * clipped rather than scrolled.
		 *
		 * `data-sidebar-shell` is the handle the driver's `sidebar-sections` scene
		 * measures this contract on (`scrollHeight === clientHeight`, and a wheel
		 * over either pane leaving the chrome where it was).
		 */
		<div
			data-sidebar-shell=""
			className="group/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-surface"
		>
			{/*
			 * The brand row, 40px, square with the top row beside it.
			 *
			 * 40 is the app's existing toolbar step (the chat header, every pane
			 * toolbar, this row) and it is what puts the brand and the conversation
			 * title on ONE line once the chrome lane is shell-level. `pl-4`: the
			 * column's 8px inset plus a row's 8px padding puts every row's mark 16px
			 * from this column's edge, and the logo starts on that same line.
			 */}
			<div className="flex h-10 shrink-0 items-center gap-1 pr-2 pl-4">
				<CollapsibleAppLogo expanded />
				<span className="ml-auto">{collapseToggle}</span>
			</div>

			{/*
			 * §C1.2 then §C1.3: the two primary rows 8px apart, then the destinations
			 * group. `pb-2` is the group's bottom step; the body below adds the rest of
			 * §B6's 16px between the destinations and the list's first label.
			 */}
			<div className="flex shrink-0 flex-col gap-2 px-2 pb-2">
				<div className="flex flex-col gap-0.5">
					{newChatRow}
					{searchRowExpanded}
				</div>
				{/*
				 * THE DESTINATIONS GROUP, four 30px rows: the same routes in the same
				 * order the old rail carried, minus Chat (which is the list itself) and
				 * minus Settings (which the foot owns).
				 */}
				<ul className="flex flex-col gap-0.5">{navItems.map(renderNavRow)}</ul>
			</div>

			{/*
			 * THE BODY: the one chat list, one scroll region.
			 *
			 * WHAT THE SPACE UNDER THE DESTINATIONS IS, measured rather than assumed
			 * (operator report, 2026-09-27: "there's a bunch of extra space" between the
			 * bottom-most nav row and the band). Three 8px steps were stacking on this
			 * boundary - the group's own `pb-2`, the `mt-2` that used to sit here, and
			 * the panel's top inset - and the rendered gap was 24px where the tier the
			 * design names between the destinations and the list below them is 16px
			 * (§B6). This column owns one of the three steps and the panel owns another,
			 * so the `mt-2` is the one that goes: the tier now reads the group's 8px
			 * bottom step against the panel's own 8px inset, and the band sits 16px
			 * under the last destination.
			 *
			 * DO NOT PUT IT BACK without taking 8px out of the panel too: this boundary
			 * is ONE tier, and three declarations of it were two more than the design
			 * ever asked for.
			 */}
			<div className="flex min-h-0 flex-1 flex-col">{listBody}</div>

			{/*
			 * THE FOOT: the account row, whose own menu carries Settings and Sign
			 * out, and the gear that goes straight to Settings.
			 *
			 * `pb-2` is the column's own bottom pad, and it is the same step the
			 * strip's foot carries - the operator's report of 2026-09-26 was that
			 * this row sat flush against the window's bottom edge with "no
			 * padding against the bottom of the screen". `min-h-10` keeps the
			 * foot at its 40px row height and lets the padding extend the box to
			 * 48, so the row is not squeezed (a fixed `h-10` with `pb-2` would
			 * leave a 32px content box and a 40px row overflowing it).
			 */}
			<div className="flex min-h-10 shrink-0 items-center justify-between gap-1 px-2 pb-2">
				<UserProfileSidebar expanded />
				{/*
				 * THE CLUSTER, AND WHY IT IS ONE CHILD (design consult §3.1): three
				 * children under `justify-between` would spread the row - the icon
				 * would float to the middle - so the icon and the gear are wrapped in
				 * one `flex items-center gap-1` div and the row keeps its two-child
				 * shape. The icon sits immediately left of the gear at the row's own
				 * 4px step (the measured slot), and the gear stays the row's last stop.
				 */}
				<div className="flex items-center gap-1">
					<UpdateFootIcon />
					{settingsGear}
				</div>
			</div>
		</div>
	);
};

export type { SidebarNavigationProps };
