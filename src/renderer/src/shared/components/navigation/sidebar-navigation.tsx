import { aidaControlFailureCopy } from "@features/aida/aida-control";
import { useAidaMissedMessages } from "@features/aida/use-aida-missed-messages";
import { useAidaOpener, useAidaTarget } from "@features/aida/use-aida-target";
import { useAidaWorking } from "@features/aida/use-aida-working";
import { useAppWideApprovals } from "@features/browser/hooks/use-app-wide-approvals";
/*
 * THE MIDPOINT RULE IS IMPORTED, not re-derived (design § 5): the pinned chat
 * reorder's `pinDragSlot` is the shipped answer to "which slot is the pointer
 * over", and a second copy here would be a second rule the two gestures could
 * drift apart on.
 */
import { pinDragSlot } from "@features/chat/chat-pin-order";
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
import {
	rowDragging,
	rowDraggingMark,
} from "@features/chat/components/chat-sidebar";
import { newChatShortcutCap } from "@features/chat/new-chat-shortcut";
import { openConversation } from "@features/chat/open-conversation";
import {
	paletteDoorCaps,
	paletteDoorLabel,
} from "@features/command-palette/palette-shortcut";
import {
	useMeshApprovals,
	waitingApprovalCount,
} from "@features/mesh/mesh-approvals";
import { useMeshMembership } from "@features/mesh/mesh-store";
import { useNotificationsCount } from "@features/notifications/notifications-api";
import { badgeCountOf } from "@features/notifications/notifications-model";
import { useTeamBridgeNavItem } from "@features/team-bridge/team-bridge-nav";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import type { ChatTarget } from "@shared/api/local-operator/profile-hooks";
import { useSidebarLayout } from "@shared/api/local-operator/sidebar-layout";
import { useSidebarFrame } from "@shared/components/common/chat-layout";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { UpdateFootIcon } from "@shared/components/common/update-foot-icon";
import { CollapsibleAppLogo } from "@shared/components/navigation/collapsible-app-logo";
import {
	DEFAULT_SIDEBAR_LAYOUT,
	type SidebarDestinationId,
	type SidebarLayout,
	type SidebarRegion,
	layoutEquals,
	moreAttentionCount,
	moveToRegion,
	moveWithinRegion,
	placeInRegion,
	regionOf,
	renderedRegion,
} from "@shared/components/navigation/sidebar-destinations";
import { UserProfileSidebar } from "@shared/components/navigation/user-profile-sidebar";
import {
	AttentionBadge,
	BrowserSafeTooltip,
	Button,
} from "@shared/components/ui";
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@shared/components/ui/dropdown-menu";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { useCurrentView } from "@shared/hooks/use-route-params";
import { useTextDirection } from "@shared/i18n/use-document-direction";
import { useI18nLocale } from "@shared/i18n/use-locale";
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
	Bell,
	Bot,
	CalendarDays,
	ChevronDown,
	ChevronLeft,
	ChevronRight,
	ChevronsUp,
	Ellipsis,
	FolderKanban,
	Globe,
	LibraryBig,
	LoaderCircle,
	MessageSquarePlus,
	Network,
	Search,
	Settings,
	Store,
} from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { FC, ReactNode, PointerEvent as ReactPointerEvent } from "react";
import { useNavigate } from "react-router-dom";
import { t } from "../../../../../i18n/messages";

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
	 * rule at `renderDestinationRowForWidth`): the row's own sentence for its count, because
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
};

/**
 * WHERE A LIVE DRAG WOULD LAND (design § 5).
 *
 * The three spellings are the three targets the design names, and they are
 * deliberately not one "index": the fold is a boundary the list does not have
 * a row for, so "append to More" and "append to the other region" cannot be
 * written as a slot without inventing a row that is not drawn.
 *
 *   * `slot` - between two destination rows, `beforeId` naming the rendered row
 *     the dropped row would precede (`null` = the end of `region`);
 *   * `more` - the More row itself: append to More (design § 5);
 *   * `band` - the trailing band: append to the OTHER region's end.
 */
type SidebarDropTarget =
	| {
			kind: "slot";
			region: SidebarRegion;
			beforeId: SidebarDestinationId | null;
			slot: number;
	  }
	| { kind: "more" }
	| { kind: "band" };

/** A row menu's action, so the menu and the chord share one writer. */
type SidebarRowAction =
	| { kind: "move"; delta: -1 | 1 }
	| { kind: "region"; region: SidebarRegion }
	| { kind: "reset" };

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
	/*
	 * The activity-head flag, published HERE as well as in `chat-sidebar.tsx`
	 * (this strip is another surface that resolves the same capability answer and
	 * refreshes the same catalogue): the flag is one store value, and either
	 * publisher writing it is idempotent. Without it a window opened straight
	 * onto a STUFF route would take the legacy rank read until a `/chat` visit -
	 * the same route-dependence `cataloguePageDefault` documents for the page
	 * size.
	 */
	const setCatalogueActivityHead = useCanonicalSessionsStore(
		(store) => store.setCatalogueActivityHead,
	);
	const fetchSessions = useCanonicalSessionsStore(
		(store) => store.fetchSessions,
	);
	const pageable = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue_page",
	);
	const activityHead = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue_sort",
	);
	useEffect(() => {
		setCataloguePageable(pageable);
	}, [pageable, setCataloguePageable]);
	useEffect(() => {
		setCatalogueActivityHead(activityHead);
	}, [activityHead, setCatalogueActivityHead]);
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
	useI18nLocale();
	/*
	 * The collapse/expand chevrons point at the INLINE edge the docked column
	 * will move toward: left in LTR, right in RTL. A chevron is a picture of a
	 * direction, not a flex child, so `dir` cannot flip it for us.
	 */
	const rtl = useTextDirection() === "rtl";
	const navigate = useNavigate();
	const currentView = useCurrentView();
	const { expanded, onCollapse } = useSidebarFrame();
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
	 * THE TEAM BRIDGE ROW. The hook owns the capability gate and the one
	 * account-wide unread read; this list only spreads the descriptor. It is
	 * called unconditionally because hooks cannot be conditional - the gate is
	 * inside and returns null when the backend does not publish the surface.
	 */
	const teamBridgeNav = useTeamBridgeNavItem(
		desktopFeatureEnabled(capabilities.data, "team_bridge_conversations"),
	);
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
	const meshWaiting = waitingApprovalCount(meshApprovals.data ?? []);
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
	 * The Library destination, gated on its own capability. A backend that
	 * predates the catalog must render the column that never heard of it: the
	 * routes 404, and a row landing on an error page is the dead control the
	 * fail-closed rule omits. The route repeats this gate for a hand-typed URL.
	 */
	const libraryEnabled = desktopFeatureEnabled(capabilities.data, "library", 1);
	/*
	 * The Notifications destination and its badge number, on its own capability
	 * (see the row below). The count read is the cheap `/count` route the feed's
	 * `notifications` frame refreshes; disabled below the capability.
	 */
	const notificationsEnabled = desktopFeatureEnabled(
		capabilities.data,
		"notifications",
		1,
	);
	const notificationsCount = useNotificationsCount(notificationsEnabled);
	const notificationsBadge = notificationsEnabled
		? badgeCountOf(notificationsCount.data)
		: 0;
	/*
	 * THE OVERFLOW GROUP'S STATE, persisted beside the collapsed width: a
	 * low-frequency destination's visibility is a preference about the column,
	 * not about the route in front of it.
	 */
	const overflowExpanded = useUiPreferencesStore(
		(state) => state.sidebarOverflowExpanded,
	);
	const setOverflowExpanded = useUiPreferencesStore(
		(state) => state.setSidebarOverflowExpanded,
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

	/*
	 * THE DESTINATION TABLE, keyed by the ids the stored layout names.
	 *
	 * WHY A MAP AND ONE TABLE: the customisation is a list of IDS (design § 2),
	 * and an id has to outlive the gate that hides its row - a capability can come
	 * and go between launches while the saved order stays, and the merge back to
	 * the full order is `sanitizeSidebarLayout`'s, not this file's. This table is
	 * the one place a row's icon, press, badge and tour tag are defined, so both
	 * widths and both regions draw the same row from the same facts.
	 *
	 * WHAT IS DELIBERATELY NOT HERE: `New chat` and `Search` above are ACTIONS,
	 * not destinations (design § 1). They never join the layout, never drag and
	 * have no stored id.
	 */
	const destinationItems = new Map<SidebarDestinationId, NavItem>();
	if (aidaVisible) {
		/*
		 * AIDA SITS ABOVE AGENTS: she is the operator's chief of staff, and the
		 * row is the first destination in the column when the backend offers her.
		 * The row is the ordinary destination row - 30px, one line, the same
		 * renderer every neighbour uses - with one difference: its press resolves
		 * rather than navigates (`onSelect`), because her id is not known until the
		 * desktop route answers.
		 */
		destinationItems.set("aida", {
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
			 * Her count (operator ask, 2026-09-28): the missed-messages badge, the
			 * same primitive as the Browser row's approvals pill - zero draws
			 * nothing. `use-aida-missed-messages.ts` says what one receipt counts;
			 * `rowName` the name/badge rules these three fields inherit.
			 */
			attention: aidaMissed,
			attentionTag: "nav-aida-badge",
			attentionName: (count: number) =>
				t("ui.shell.sidebar_navigation.aida_missed", {
					name: aidaName,
					count,
				}),
			/*
			 * Her working mark: the same two facts the badge carries, for the state
			 * that is true while she is mid-turn (see `use-aida-working.ts`), with
			 * the row's own sentence for the name.
			 */
			working: aidaWorking,
			workingName: t("ui.shell.sidebar_navigation.aida_working", {
				name: aidaName,
			}),
		});
	}
	/*
	 * NOTIFICATIONS SITS UNDER AIDA (design.md § 1; decisions D10): she is the
	 * chief of staff and the reel is what she and every other session flag, so
	 * the two sit together. Its stored position comes from the layout model's
	 * default rank, not from this insertion order.
	 *
	 * GATED ON `features.notifications`, the Library rule: an older core has no
	 * routes, and the layout save strips the id there (`stripUnadvertisedIds`).
	 *
	 * ITS BADGE COUNTS unread updates plus UNREAD waiting asks, `unread_count +
	 * waiting_unread_count` (decisions D16; the core field changed when asks grew
	 * their own read state). Its filled accent pill was this row's alone under
	 * decision D5 (2026-10-25); the operator reversed that on 2026-10-28, and every
	 * row's attention count now wears the same shared `AttentionBadge`.
	 */
	if (notificationsEnabled) {
		destinationItems.set("notifications", {
			icon: Bell,
			label: t("ui.notifications.nav.label"),
			path: "/notifications",
			isActive: currentView === "notifications",
			tourTag: "nav-item-notifications",
			attention: notificationsBadge,
			attentionTag: "nav-notifications-badge",
			attentionName: (count: number) =>
				t("ui.notifications.nav.unread", {
					count,
					countText: String(count),
				}),
		});
	}
	/*
	 * The Library sits directly under Aida: it is the cross-conversation catalog
	 * the operator reaches for after a conversation, and the operator's IA put it
	 * above the things they own. Gated on `features.library`.
	 */
	if (libraryEnabled) {
		destinationItems.set("library", {
			icon: LibraryBig,
			label: t("ui.library.page.title"),
			path: "/library",
			isActive: currentView === "library",
			tourTag: "nav-item-library",
		});
	}
	/*
	 * Projects sits beside Agents - the two are the "things I own" pair - but
	 * only on a backend that carries the surface; see `projectsEnabled` above.
	 */
	if (projectsEnabled) {
		destinationItems.set("projects", {
			icon: FolderKanban,
			label: t("ui.shell.sidebar_navigation.projects"),
			path: "/projects",
			isActive: currentView === "projects",
			tourTag: "nav-item-projects",
		});
	}
	destinationItems.set("agents", {
		icon: Bot,
		label: t("ui.shell.sidebar_navigation.agents"),
		path: "/agents",
		isActive: currentView === "agents",
		tourTag: "nav-item-agents",
	});
	destinationItems.set("schedules", {
		icon: CalendarDays,
		label: t("ui.shell.sidebar_navigation.schedules"),
		path: "/schedules",
		isActive: currentView === "schedules",
		tourTag: "nav-item-schedules",
	});
	destinationItems.set("browser", {
		// Named "Browser" rather than "Web" or "Pages": the feature is a browser
		// the user can use and an agent can drive, and the design's own word for
		// it is the tab it opens (design 11.9).
		icon: Globe,
		label: t("ui.shell.sidebar_navigation.browser"),
		path: "/browser",
		isActive: currentView === "browser",
		tourTag: "nav-item-browser",
		attention: browserApprovals,
		/*
		 * This row's badge words and handle, beside the count they serve (see
		 * `rowName` for why the name carries the number).
		 */
		attentionTag: "nav-browser-badge",
		attentionName: (count: number) =>
			t("ui.shell.sidebar_navigation.browser_waiting", {
				count,
				countText: String(count),
			}),
	});
	/*
	 * The low-frequency destinations keep their rows, badges and gates; the
	 * DEFAULT layout folds them behind More, and the reader decides from there.
	 *
	 * THE INBOX LEADS THE FOLD by default (see `DEFAULT_SIDEBAR_LAYOUT`): it is
	 * the most frequent reason to open the group.
	 */
	if (teamBridgeNav) {
		destinationItems.set("team-bridge", {
			...teamBridgeNav,
			isActive: currentView === "team-bridge",
		});
	}
	destinationItems.set("agent-hub", {
		icon: Store,
		label: t("ui.shell.sidebar_navigation.agent_hub"),
		path: "/agent-hub",
		isActive: currentView === "agent-hub",
		tourTag: "nav-item-agent-hub",
	});
	/*
	 * The Mesh tab, ONLY for a device that is in a mesh: a rail item for a mesh the
	 * user is not in would be a dead end on the one piece of chrome that is on screen
	 * everywhere (R1-1).
	 *
	 * ITS BADGE IS THE WAITING COUNT (`features.approvals`), the same shape the
	 * Browser row uses for its own approvals: one number, only while something
	 * WAITS ON THE OPERATOR, and a name that states it in both widths. The count
	 * is exactly the records the tray's live panel draws (`waitingApprovalCount`),
	 * so the badge and the panel it opens can never disagree (operator round,
	 * 2026-10-03: a spent approval is a record, not a prompt). Zero draws nothing,
	 * so a mesh at rest renders the row exactly as it shipped.
	 */
	if (meshMembership === "member") {
		destinationItems.set("mesh", {
			icon: Network,
			label: t("ui.shell.sidebar_navigation.mesh"),
			path: "/mesh",
			isActive: currentView === "mesh",
			tourTag: "nav-item-mesh",
			attention: meshWaiting,
			attentionTag: "nav-mesh-badge",
			attentionName: (count: number) =>
				t("ui.shell.sidebar_navigation.mesh_waiting", {
					count,
					countText: String(count),
				}),
		});
	}
	/*
	 * The gate the model's pure functions take. It is the rows this launch can
	 * actually draw - NOT the stored order - so a hidden destination neither
	 * renders nor takes a slot in a move; its saved position is the merge's
	 * business when it comes back (design § 2).
	 */
	const available: ReadonlySet<SidebarDestinationId> = new Set(
		destinationItems.keys(),
	);

	/*
	 * THE STORED ORDER (design § 2, § 7), read once per mount by the hook.
	 *
	 * `canCustomise` IS THE HOOK'S ANSWER, NOT THE CAPABILITY'S: true only when
	 * the backend advertises `sidebar_layout` v1 AND the read succeeded. Fail-closed
	 * means the fixed default order with no drag and no menu (design § 4) - the
	 * column never offers a gesture it cannot store.
	 */
	const layoutCapable = desktopFeatureEnabled(
		capabilities.data,
		"sidebar_layout",
		1,
	);
	const {
		layout,
		canCustomise,
		save: saveSidebarLayout,
		reset: resetSidebarLayout,
	} = useSidebarLayout(layoutCapable, (feature) =>
		desktopFeatureEnabled(
			capabilities.data,
			feature as Parameters<typeof desktopFeatureEnabled>[1],
			1,
		),
	);
	/*
	 * Every render below reads `effectiveLayout`, not `layout`: the fallback is
	 * the SHIPPED arrangement, not a second opinion about the order. It is also
	 * what keeps the column's order stable while the read is in flight.
	 */
	const effectiveLayout: SidebarLayout = canCustomise
		? layout
		: DEFAULT_SIDEBAR_LAYOUT;
	/*
	 * THE TWO REGIONS AS DRAWN. `renderedRegion` applies the availability gate and
	 * the stored order in one pass, so a destination hidden by a capability keeps
	 * its slot in the stored layout without this file reconstructing the merge.
	 */
	const visibleRows = renderedRegion(effectiveLayout, "visible", available);
	const moreRows = renderedRegion(effectiveLayout, "more", available);

	/*
	 * THE FOLD'S STATE IS STILL THE DISCLOSURE PREFERENCE, with one TRANSIENT
	 * addition for the drag (design § 3, § 5). The dwell that opens More while a
	 * visible row hovers it is a REVEAL, like the direct-route rule below, so it
	 * must not write what the reader saved; it lasts only as long as the gesture.
	 * A committed drop into More DOES write it - the landing has to stay visible -
	 * and so does the More press.
	 */
	const [dragFoldOpen, setDragFoldOpen] = useState(false);
	/*
	 * A DIRECT ROUTE TO A HIDDEN DESTINATION REVEALS ITS GROUP for that visit,
	 * without overwriting the saved preference: a reader who lands on Agent Hub
	 * through the palette must be able to see where they are. The preference is
	 * written only by the More press itself, or by a drop that landed there.
	 */
	const overflowRevealed =
		overflowExpanded ||
		dragFoldOpen ||
		moreRows.some((id) => destinationItems.get(id)?.isActive);

	/*
	 * THE COLUMN'S ONE LIVE REGION (design § 6). Every move made through the menu
	 * or the chord is announced here; the drag's arming and its landing share the
	 * region so a pointer gesture that ends nowhere can END the sentence rather
	 * than leave "Moving …" standing as the last thing a screen reader heard.
	 */
	const [announcement, setAnnouncement] = useState("");
	/*
	 * THE ROW MENU (design § 6). One controlled menu, keyed by the row it belongs
	 * to, so a right-click, Shift+F10 and the ellipsis all open the SAME panel;
	 * an uncontrolled menu per row would let two rows' menus exist at once.
	 */
	const [menuRow, setMenuRow] = useState<SidebarDestinationId | null>(null);
	/*
	 * The row buttons, by id, for the ONE focus rule this feature adds: after a
	 * move the row is focusable where it landed, so a keyboard reader is not sent
	 * back to the top of the column by their own reorder. The map is a ref rather
	 * than state because it is written by refs and never read during render.
	 */
	const rowButtonsRef = useRef(
		new Map<SidebarDestinationId, HTMLButtonElement>(),
	);
	const focusDestinationRow = (id: SidebarDestinationId) => {
		requestAnimationFrame(() => rowButtonsRef.current.get(id)?.focus());
	};

	/*
	 * DRAG STATE (design § 5). `dragId` is the RENDERED fact - the armed row, the
	 * indicator and the band all follow it - while `dragRef` is the GESTURE's own
	 * record. The split matters for the same reason it does on the pinned-chat
	 * reorder: a rAF loop and a window listener must read the live gesture without
	 * being re-bound on every render, and the drop must land where the indicator
	 * was drawn rather than at a hit test taken in the release's own tick.
	 */
	const [dragId, setDragId] = useState<SidebarDestinationId | null>(null);
	const [indicatorTop, setIndicatorTop] = useState<number | null>(null);
	const destinationsRef = useRef<HTMLDivElement | null>(null);
	const dragRef = useRef<{
		pointerId: number;
		id: SidebarDestinationId;
		armed: boolean;
		startX: number;
		startY: number;
	} | null>(null);
	const dropTargetRef = useRef<SidebarDropTarget | null>(null);
	const dragXRef = useRef(0);
	const dragYRef = useRef(0);
	const autoScrollRef = useRef<number | null>(null);
	const dwellRef = useRef<number | null>(null);
	/*
	 * A CLICK THAT FOLLOWS A DRAG IS NOT A PRESS. The flag is armed at the
	 * threshold and cleared on the next TASK, not at the release: the browser
	 * dispatches `click` in the same turn as `pointerup`, so clearing it
	 * synchronously would let the navigation through. It is a ref because
	 * `onClick` reads it, and a state write would arrive one render too late.
	 */
	const suppressClickRef = useRef(false);

	/**
	 * The destination rows as drawn, in document order, minus the dragged row -
	 * the list `pinDragSlot` counts against. Document order IS the single order
	 * the fold cuts (design § 2): visible rows, then More's own rows while open.
	 */
	const destinationBoxes = (exclude?: SidebarDestinationId | null) => {
		const root = destinationsRef.current;
		if (root === null) return [];
		return Array.from(root.querySelectorAll<HTMLElement>("[data-sidebar-row]"))
			.filter((node) => node.dataset.sidebarRow !== exclude)
			.map((node) => {
				const rect = node.getBoundingClientRect();
				return {
					id: (node.dataset.sidebarRow ?? "") as SidebarDestinationId,
					top: rect.top,
					bottom: rect.bottom,
				};
			});
	};

	/**
	 * Where the 2px insertion line is drawn for a live target, in the
	 * destinations wrapper's own scrolled coordinates (design § 5).
	 *
	 * WHY THE TARGET ROW'S TOP RATHER THAN THE PREVIOUS ROW'S BOTTOM: the two are
	 * the same line between contiguous rows, but the fold is a row the list does
	 * not count (`pinDragSlot` never sees it). A drop into the START of More draws
	 * under the More control, at the first More row's top - using the previous
	 * visible row's bottom would draw the line ABOVE the More control, one row
	 * away from the landing it describes.
	 */
	const placeDropIndicator = (
		target: SidebarDropTarget,
		draggedId: SidebarDestinationId,
	) => {
		const root = destinationsRef.current;
		if (root === null) return null;
		const rect = root.getBoundingClientRect();
		const boxes = destinationBoxes(draggedId);
		const regionBoxes = (region: SidebarRegion) =>
			boxes.filter((box) => regionOf(effectiveLayout, box.id) === region);
		let edge: number | null = null;
		if (target.kind === "more") {
			const last = regionBoxes("more").at(-1);
			if (last) edge = last.bottom;
			else {
				const moreRow = root.querySelector<HTMLElement>("[data-sidebar-more]");
				edge = moreRow ? moreRow.getBoundingClientRect().bottom : rect.top + 2;
			}
		} else if (target.kind === "band") {
			const from = regionOf(effectiveLayout, draggedId);
			const to: SidebarRegion = from === "more" ? "visible" : "more";
			const last = regionBoxes(to).at(-1);
			if (last) edge = last.bottom;
			else if (from === "more") {
				/*
				 * EVERYTHING IS IN MORE, so the end of the visible region is the TOP OF
				 * THE MORE CONTROL - the place a visible row would be drawn if one
				 * existed. `boxes[0]` would be the first row INSIDE the fold, below the
				 * control, so the line would sit one row too low and describe a landing
				 * the drop does not make (the drop appends to `visible`, which is drawn
				 * above the fold line).
				 */
				const moreRow = root.querySelector<HTMLElement>("[data-sidebar-more]");
				edge = moreRow ? moreRow.getBoundingClientRect().top : rect.top + 2;
			}
			/* Moving visible -> More while the fold is closed draws NO line: the
			   landing is inside a fold that has no rows on screen. The band's own
			   label is the affordance there (design § 5). */
		} else {
			const next = boxes[target.slot];
			if (next) edge = next.top;
			else edge = boxes.at(-1)?.bottom ?? rect.top + 2;
		}
		return edge === null ? null : Math.round(edge - rect.top + root.scrollTop);
	};

	const clearDwell = () => {
		if (dwellRef.current !== null) {
			window.clearTimeout(dwellRef.current);
			dwellRef.current = null;
		}
	};

	/**
	 * The live hit test: the pointer's position decides ONE target, and the
	 * indicator is a consequence of it (design § 5).
	 *
	 * THE MORE ROW IS FOUND BY `elementFromPoint`, not by its rect, because the
	 * row is a BUTTON: the `<li>` around it grows to contain the open fold, so a
	 * rect test would keep answering "over More" for every row inside it.
	 */
	const updateDropTarget = (x: number, y: number) => {
		const live = dragRef.current;
		if (live === null || !live.armed) return;
		const hovered = document.elementFromPoint(x, y) as HTMLElement | null;
		const overMore = Boolean(hovered?.closest("[data-sidebar-more]"));
		const overBand = Boolean(hovered?.closest("[data-sidebar-drop-band]"));
		let target: SidebarDropTarget;
		if (overMore) {
			target = { kind: "more" };
			/*
			 * THE DWELL (design § 5): ~400ms over More opens the fold so an
			 * insertion point INSIDE it can be chosen. Only a VISIBLE row needs
			 * it - one already in More has nothing to reveal - and only while the
			 * fold is closed. The reveal is transient; see `dragFoldOpen`.
			 */
			if (
				regionOf(effectiveLayout, live.id) === "visible" &&
				!overflowRevealed &&
				dwellRef.current === null
			) {
				dwellRef.current = window.setTimeout(() => {
					dwellRef.current = null;
					setDragFoldOpen(true);
					/* Re-derive once against the rows the reveal just added. */
					requestAnimationFrame(() =>
						updateDropTargetRef.current(dragXRef.current, dragYRef.current),
					);
				}, 400);
			}
		} else {
			clearDwell();
			if (overBand) {
				target = { kind: "band" };
			} else {
				const boxes = destinationBoxes(live.id);
				const slot = pinDragSlot(boxes, live.id, y);
				const before = boxes[slot];
				let region: SidebarRegion = "visible";
				if (before) {
					region = regionOf(effectiveLayout, before.id);
				} else {
					const last = boxes.at(-1);
					region = last ? regionOf(effectiveLayout, last.id) : "visible";
				}
				target = { kind: "slot", slot, beforeId: before?.id ?? null, region };
			}
		}
		dropTargetRef.current = target;
		setIndicatorTop(placeDropIndicator(target, live.id));
	};
	const updateDropTargetRef = useRef(updateDropTarget);
	updateDropTargetRef.current = updateDropTarget;

	const stopAutoScroll = () => {
		if (autoScrollRef.current !== null) {
			cancelAnimationFrame(autoScrollRef.current);
			autoScrollRef.current = null;
		}
	};

	/*
	 * AUTO-SCROLL (design § 5): one 8px step per FRAME while the pointer is inside
	 * the 24px edge zone. The frame, not a timer, because the frame is what
	 * redraws the boxes the drop is measured against - a timer fast enough to feel
	 * right would outrun the layout and re-apply the step to stale rows.
	 */
	const runAutoScroll = () => {
		autoScrollRef.current = null;
		const live = dragRef.current;
		const scroller = destinationsRef.current;
		if (live === null || !live.armed || scroller === null) return;
		const rect = scroller.getBoundingClientRect();
		const y = dragYRef.current;
		const maxScroll = scroller.scrollHeight - scroller.clientHeight;
		let direction = 0;
		if (y - rect.top < 24 && scroller.scrollTop > 0) direction = -1;
		else if (rect.bottom - y < 24 && scroller.scrollTop < maxScroll)
			direction = 1;
		if (direction !== 0) {
			scroller.scrollTop += direction * 8;
			updateDropTargetRef.current(dragXRef.current, y);
		}
		autoScrollRef.current = requestAnimationFrame(runAutoScroll);
	};

	/**
	 * The press: the ONLY place a gesture begins.
	 *
	 * NO `preventDefault`, unlike the pinned-chat grip: this row's press is a
	 * NAVIGATION when it never arms, and suppressing the default press would also
	 * suppress focus and the click the row exists for. Capture is guarded for the
	 * same reason it is there: a synthetic pointer owns no active pointer and
	 * `setPointerCapture` throws for one.
	 */
	const startRowDrag = (
		id: SidebarDestinationId,
		event: ReactPointerEvent<HTMLButtonElement>,
	) => {
		if (!canCustomise) return;
		if (event.button !== 0) return;
		if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey)
			return;
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/* synthetic pointer: the dispatched moves still arrive here */
		}
		dragRef.current = {
			pointerId: event.pointerId,
			id,
			armed: false,
			startX: event.clientX,
			startY: event.clientY,
		};
		dragXRef.current = event.clientX;
		dragYRef.current = event.clientY;
	};

	const moveRowDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const live = dragRef.current;
		if (live === null || live.pointerId !== event.pointerId) return;
		dragXRef.current = event.clientX;
		dragYRef.current = event.clientY;
		if (!live.armed) {
			/*
			 * 5px of movement ARMS the gesture (design § 5). A press that never
			 * moves stays a click; a drag that passes the threshold can no longer
			 * become a navigation, which is what `suppressClickRef` states.
			 */
			if (
				Math.hypot(event.clientX - live.startX, event.clientY - live.startY) < 5
			)
				return;
			live.armed = true;
			suppressClickRef.current = true;
			setDragId(live.id);
			const item = destinationItems.get(live.id);
			if (item)
				setAnnouncement(
					t("ui.shell.sidebar_navigation.drag_armed", { name: item.label }),
				);
			if (autoScrollRef.current === null)
				autoScrollRef.current = requestAnimationFrame(runAutoScroll);
		}
		updateDropTarget(event.clientX, event.clientY);
	};

	/** The order after a drop, or the layout unchanged. */
	const layoutAfterDrop = (
		id: SidebarDestinationId,
		target: SidebarDropTarget,
	): SidebarLayout | null => {
		if (target.kind === "slot") {
			return placeInRegion(
				effectiveLayout,
				id,
				target.region,
				target.beforeId,
				available,
			);
		}
		const from = regionOf(effectiveLayout, id);
		const to: SidebarRegion =
			target.kind === "more" ? "more" : from === "more" ? "visible" : "more";
		return moveToRegion(effectiveLayout, id, to);
	};

	/**
	 * One completed gesture, one write (design § 5, § 7).
	 *
	 * A DROP THAT LANDS WHERE THE ROW ALREADY IS WRITES NOTHING - and says
	 * nothing, because nothing happened. Writing the on-screen order for a move
	 * nobody made would rewrite the preference for nothing.
	 */
	const applyDrop = (id: SidebarDestinationId, target: SidebarDropTarget) => {
		const item = destinationItems.get(id);
		if (item === undefined) return;
		const next = layoutAfterDrop(id, target);
		if (next === null || layoutEquals(next, effectiveLayout)) return;
		const to = regionOf(next, id);
		if (to === "more") setOverflowExpanded(true);
		saveSidebarLayout(next);
		if (target.kind === "slot") {
			announceMove(next, id);
			return;
		}
		setAnnouncement(
			to === "more"
				? t("ui.shell.sidebar_navigation.move_to_more_note", {
						name: item.label,
					})
				: t("ui.shell.sidebar_navigation.show_in_sidebar_note", {
						name: item.label,
					}),
		);
	};

	/** What the live region says after a move landed, inside a region. */
	const announceMove = (next: SidebarLayout, id: SidebarDestinationId) => {
		const item = destinationItems.get(id);
		const region = regionOf(next, id);
		const rows = renderedRegion(next, region, available);
		setAnnouncement(
			t("ui.shell.sidebar_navigation.move_note", {
				name: item?.label ?? "",
				position: String(rows.indexOf(id) + 1),
				total: String(rows.length),
			}),
		);
	};

	const settleDrag = (commit: boolean, abandoned = false) => {
		const live = dragRef.current;
		if (live === null) return;
		dragRef.current = null;
		stopAutoScroll();
		clearDwell();
		const target = dropTargetRef.current;
		dropTargetRef.current = null;
		setDragId(null);
		setIndicatorTop(null);
		setDragFoldOpen(false);
		if (!live.armed) return;
		if (!commit) {
			if (abandoned) {
				/*
				 * AN ABANDONED GESTURE HAS NO CLICK COMING (agent review round 3,
				 * R3-1). `pointercancel` settles DURING its own dispatch, so a
				 * `pointercancel` door installed here can never hear it - the old shape
				 * left the flag armed and ate the reader's next row click. A blur is
				 * the same fact: the browser has taken the gesture away. Clear now;
				 * there is no release to wait for.
				 */
				suppressClickRef.current = false;
				setAnnouncement("");
				return;
			}
			/*
			 * A CANCELLED GESTURE'S RELEASE IS STILL A PRESS THE BROWSER DELIVERS
			 * (agent review round 1, R1-2; QA round 1, Q2, reproduced in the built
			 * app). Escape settles while the pointer is DOWN and still captured, so
			 * the eventual release is retargeted to the row's button and a `click`
			 * follows. A next-task timer cannot cover that gap - it fires in the
			 * ESCAPE's task, long before the release - so suppression stays armed and
			 * is consumed by that click (`onClick`), the one place that can tell a
			 * cancelled release from the reader's next real press.
			 *
			 * These listeners are the doors where no click will come: a
			 * `pointercancel`, a window blur (the gesture is abandoned, not released),
			 * or a release the button never receives. The clear is scheduled on the
			 * release's own task so the click, dispatched in that same task, still
			 * runs first.
			 */
			const clearNow = () => {
				suppressClickRef.current = false;
			};
			const clearOnNextTask = () => {
				window.setTimeout(clearNow, 0);
			};
			const removeReleaseDoors = () => {
				window.removeEventListener("pointerup", onPointerUp, true);
				window.removeEventListener("pointercancel", onAbandon, true);
				window.removeEventListener("blur", onAbandon, true);
			};
			/*
			 * ONLY A RELEASE HAS A CLICK TO WAIT FOR (agent review round 2, R2-1).
			 * `pointerup` is followed, in the same task, by the click this flag exists
			 * to swallow - so its clear is deferred. `pointercancel` and `blur` have
			 * no click: by the time they fire the browser has already abandoned the
			 * gesture, and a deferred clear would leave the flag armed into the
			 * reader's NEXT press, whose click would then be eaten. They clear
			 * synchronously.
			 */
			const onPointerUp = () => {
				removeReleaseDoors();
				clearOnNextTask();
			};
			const onAbandon = () => {
				removeReleaseDoors();
				clearNow();
			};
			window.addEventListener("pointerup", onPointerUp, true);
			window.addEventListener("pointercancel", onAbandon, true);
			window.addEventListener("blur", onAbandon, true);
			/* Esc, or the pointer taken away: the gesture's sentence ends rather
			   than leaving "Moving …" standing (design § 5). */
			setAnnouncement("");
			return;
		}
		/*
		 * A DROP's click is dispatched in the release's own task, so the flag can be
		 * cleared on the next task as before; `onClick` consumes it first.
		 */
		window.setTimeout(() => {
			suppressClickRef.current = false;
		}, 0);
		if (target === null) return;
		applyDrop(live.id, target);
	};
	const settleDragRef = useRef(settleDrag);
	settleDragRef.current = settleDrag;

	/*
	 * THE GESTURE'S DOORS, bound ONCE on the first armed render (the pinned-chat
	 * rule): the window listener is what keeps a gesture from being left armed
	 * when the browser takes the pointer away - a `pointercancel` anywhere settles
	 * it with no write. `settleDrag` nulls `dragRef` first, so the row's own
	 * `onPointerUp` and this listener cannot double-write.
	 */
	useEffect(() => {
		if (dragId === null) return;
		const onKeyDown = (event: WindowEventMap["keydown"]) => {
			if (event.key !== "Escape") return;
			/*
			 * THE CLAIM IS STATED (the pinned-chat rule): Escape during a drag must
			 * cancel the drag and NOT also interrupt a running turn - the press was
			 * addressed to the gesture. `preventDefault` after the settle, because
			 * the interrupt hook reads `defaultPrevented` in a microtask.
			 */
			settleDragRef.current(false);
			event.preventDefault();
		};
		const onPointerUp = (event: PointerEvent) => {
			if (dragRef.current?.pointerId !== event.pointerId) return;
			settleDragRef.current(true);
		};
		const onCancel = () => settleDragRef.current(false, true);
		window.addEventListener("keydown", onKeyDown);
		window.addEventListener("pointerup", onPointerUp);
		window.addEventListener("pointercancel", onCancel);
		window.addEventListener("blur", onCancel);
		return () => {
			window.removeEventListener("keydown", onKeyDown);
			window.removeEventListener("pointerup", onPointerUp);
			window.removeEventListener("pointercancel", onCancel);
			window.removeEventListener("blur", onCancel);
		};
	}, [dragId]);

	/* The frame and the dwell outlive no gesture, and no unmount (the board's rule). */
	useEffect(
		() => () => {
			if (autoScrollRef.current !== null)
				cancelAnimationFrame(autoScrollRef.current);
			if (dwellRef.current !== null) window.clearTimeout(dwellRef.current);
		},
		[],
	);

	/**
	 * ONE WRITER for the menu and the chord (design § 6): the two paths must not
	 * be able to disagree about what a move costs or where it lands.
	 */
	const runRowAction = (id: SidebarDestinationId, action: SidebarRowAction) => {
		if (!canCustomise) return;
		const item = destinationItems.get(id);
		if (item === undefined) return;
		if (action.kind === "reset") {
			resetSidebarLayout();
			setAnnouncement(t("ui.shell.sidebar_navigation.reset_note"));
			focusDestinationRow(id);
			return;
		}
		if (action.kind === "move") {
			const next = moveWithinRegion(
				effectiveLayout,
				id,
				action.delta,
				available,
			);
			/* A boundary is a disabled item and a silent chord: the row is already
			   where the reader asked it to go (the pinned-chat rule 5 one axis over). */
			if (next === null) return;
			saveSidebarLayout(next);
			announceMove(next, id);
			focusDestinationRow(id);
			return;
		}
		const next = moveToRegion(effectiveLayout, id, action.region);
		if (layoutEquals(next, effectiveLayout)) return;
		if (action.region === "more") setOverflowExpanded(true);
		saveSidebarLayout(next);
		setAnnouncement(
			action.region === "more"
				? t("ui.shell.sidebar_navigation.move_to_more_note", {
						name: item.label,
					})
				: t("ui.shell.sidebar_navigation.show_in_sidebar_note", {
						name: item.label,
					}),
		);
		focusDestinationRow(id);
	};

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

	/**
	 * ONE ROW, BOTH WIDTHS, AND THE `<li>` IS THIS FUNCTION'S (agent review round
	 * 1, R1-3; design round 1, D1/D2/D5).
	 *
	 * THE CONTENT IS A FRAGMENT INSIDE ONE ITEM: the main button and the menu's
	 * root are children of the row's `<li>`; the collapsed tooltip wraps the
	 * BUTTON only. The strip used to wrap the whole `<li>` in a tooltip inside
	 * another `<li>`, which the repo's own mount harness reports as
	 * `validateDOMNesting: <li> cannot appear as a descendant of <li>`.
	 *
	 * WHY THE MARKS SIT AFTER THE ELLIPSIS (D1). The ellipsis lane is reserved at
	 * the trailing edge, and the badge/working glyph used to be inside the main
	 * button, so they sat 26px in - two trailing columns, with an attention mark
	 * no longer aligned with More's chevron or the actions' keycaps. The marks now
	 * follow the lane and take the SAME 8px inset the chevron takes, so a 16px
	 * mark occupies the chevron's column; the button's own name still states the
	 * count (`markLabel`), which is what assistive tech reads. They are outside
	 * the button by construction - a row must not nest controls - so a pointer
	 * landing on a mark is a status glyph, not a press.
	 *
	 * WHY THE HELD ROW WEARS THE PINNED CHAT'S MARK (D2): Chromium keeps `:hover`
	 * on the capture target, so during a drag the held row was filled with the
	 * same `row-hover` the OTHER rows wear, and the only filled row on screen was
	 * not the target. `rowDragging` says "this row is held" and `rowDraggingMark`
	 * adds the outline the pinned reorder uses; the ellipsis stands down for the
	 * gesture so the mark is the only trailing thing drawn.
	 */
	const renderDestinationRowForWidth = (id: SidebarDestinationId) => {
		const item = destinationItems.get(id);
		if (item === undefined) return null;
		const region: SidebarRegion = regionOf(effectiveLayout, id);
		const regionRows = region === "more" ? moreRows : visibleRows;
		const index = regionRows.indexOf(id);
		/*
		 * A BOUNDARY IS A DISABLED ITEM, not a failed press (design § 6, the
		 * pinned-chat rule 5 one axis over): the menu draws the item inapplicable at
		 * the region's own ends instead of letting a press do nothing. The chord
		 * shares the same model (`moveWithinRegion` returns null there), so the two
		 * paths agree about where the edge is.
		 */
		const atTop = index <= 0;
		const atBottom = index === -1 || index >= regionRows.length - 1;
		const attention = item.attention ?? 0;
		const markLabel = rowName(item);
		const held = dragId === id;
		/*
		 * THE MENU OPENS AWAY FROM THE COLUMN'S INLINE-END EDGE (D5). `right` is a
		 * physical side: in an RTL column the rail sits at the window's right edge,
		 * so a right-opening menu would depend on Radix's collision flip rather than
		 * on placement, and the strip's anchor would be on the wrong side.
		 */
		const menuSide = rtl ? "left" : "right";
		const rowState = item.isActive
			? rowCurrent
			: "text-ink-muted hover:bg-row-hover hover:text-ink";
		const glyph = (
			<item.icon
				size={16}
				aria-hidden="true"
				className={cn("shrink-0", item.isActive && "text-accent")}
			/>
		);
		const button = (
			<button
				type="button"
				/*
				 * THE ROW'S FOCUS HANDLE (agent review round 1, R1-1). Nothing wrote
				 * `rowButtonsRef`, so every restore was a no-op - and the menu's
				 * `onCloseAutoFocus` first suppressed Radix's own return, which is how a
				 * keyboard reorder dropped focus to `<body>`. The callback is keyed by id so
				 * a row that MOVED is focused where it landed.
				 */
				ref={(node) => {
					if (node) rowButtonsRef.current.set(id, node);
					else rowButtonsRef.current.delete(id);
				}}
				onClick={() => {
					/*
					 * A DRAG IS NEVER A NAVIGATION (design § 5), and a CANCELLED drag's
					 * release is still a press the browser dispatches (agent review round 1,
					 * R1-2): the flag stays armed until that click arrives, so the click is
					 * consumed here and the flag cleared - the one place that can tell the
					 * cancelled release from the reader's next real press.
					 */
					if (suppressClickRef.current) {
						suppressClickRef.current = false;
						return;
					}
					if (item.onSelect) item.onSelect();
					else navigate(item.path);
				}}
				onPointerDown={
					canCustomise ? (event) => startRowDrag(id, event) : undefined
				}
				onPointerMove={canCustomise ? moveRowDrag : undefined}
				onPointerUp={
					canCustomise
						? (event) => {
								if (dragRef.current?.pointerId !== event.pointerId) return;
								settleDrag(true);
							}
						: undefined
				}
				onPointerCancel={
					canCustomise ? () => settleDrag(false, true) : undefined
				}
				onKeyDown={
					canCustomise
						? (event) => {
								/*
								 * THE KEYBOARD'S OWN MENU KEY (design § 6): `Shift+F10` is the
								 * Windows convention, `ContextMenu` the dedicated key. Both open
								 * the panel the ellipsis opens, anchored to the row.
								 */
								if (
									event.key === "ContextMenu" ||
									(event.shiftKey && event.key === "F10")
								) {
									event.preventDefault();
									setMenuRow(id);
									return;
								}
								/* Alt+Arrow reorders within the row's own region, the chord
								   twin of the menu's two Move items. */
								if (!event.altKey) return;
								if (event.key !== "ArrowUp" && event.key !== "ArrowDown")
									return;
								event.preventDefault();
								runRowAction(id, {
									kind: "move",
									delta: event.key === "ArrowUp" ? -1 : 1,
								});
							}
						: undefined
				}
				data-tour-tag={item.tourTag}
				/*
				 * A ROW THAT NAVIGATES IS A DESTINATION (design review round 1, D3):
				 * `New chat` and `Search` above already set this attribute on their
				 * buttons, and this one needs it for a different reason - the tour that
				 * clicks it is not the only thing that looks; the screenshot rig opens a
				 * destination by this tag. `aria-current` stays as it was: a destination
				 * row is a link in a rail, and "current" is the word for the route in
				 * front of the user, said only while open.
				 */
				aria-current={item.isActive ? "page" : undefined}
				/*
				 * THE DISCLOSURE CUE (agent review round 1, N5): Radix puts
				 * `aria-haspopup` on the ellipsis trigger, and in the strip that trigger
				 * is an `aria-hidden` zero-width anchor - so an AT user at that width had
				 * no cue that Shift+F10 opens a menu on the row. The row button states it
				 * at both widths, where the key is handled.
				 */
				aria-haspopup={canCustomise ? "menu" : undefined}
				/*
				 * EQUAL LABEL AND ARIA-LABEL OMIT THE ATTRIBUTE (design round 1, D2):
				 * the visible text is the name whenever it is complete on its own, and a
				 * redundant `aria-label` only risks disagreeing with it. A badge's
				 * counting form is NOT equal to the label, so it is stated in both
				 * widths - while a row is working, the sentence names the state.
				 */
				aria-label={
					expanded && markLabel === item.label ? undefined : markLabel
				}
				className={cn(
					"flex h-full min-w-0 flex-1 items-center gap-2 rounded-md",
					expanded ? "px-2" : "justify-center px-0",
				)}
			>
				{expanded ? (
					glyph
				) : (
					/*
					 * THE STRIP'S COUNT IS A CORNER MARK (#1083). The in-flow slot the
					 * expanded row's marks take does not exist here: collapsed there is no
					 * label and no trailing edge, so a mark in flow followed the glyph
					 * after the row's 8px gap and `justify-center` centred the PAIR - the
					 * icon sat 12px left of the strip's centre line with the count beside
					 * it. Here the glyph sits in a 28px box (the strip's hit target, inside
					 * the 30px row) and the mark is the panel rail's corner mark
					 * (`panel-rail.tsx`, the browser item's block states the geometry):
					 * 14px, pinned at -4px up / -6px out of the box (design follow-up to
					 * #1465, D1: at -2px/-2px a `99+` mark lay across the top 6px of the
					 * whole 16px glyph; pushed out, and capped at `9+` by the badge, it
					 * covers only the icon's corner), so the glyph is the button's
					 * only in-flow content and stays centred. The register is the shared
					 * `AttentionBadge`; only the size and the place are the rail's. The busy mark
					 * keeps its in-flow slot: where a spinner goes in the strip is a
					 * design call #1083 does not make.
					 */
					<span className="relative flex size-7 shrink-0 items-center justify-center">
						{glyph}
						{attention > 0 && (
							<span className="pointer-events-none absolute -top-1 -end-1.5 flex">
								<AttentionBadge
									count={attention}
									placement="corner"
									data-tour-tag={item.attentionTag}
								/>
							</span>
						)}
					</span>
				)}
				{/*
				 * THE STRIP'S BUSY MARK, in flow after the glyph (design #1083's own note:
				 * where a spinner goes in the strip is a design call that was not made, so
				 * it keeps the in-flow slot the expanded row used before D1 moved the
				 * marks out of the button). The name above still states the state.
				 */}
				{!expanded && item.working && (
					<span className="inline-flex">
						<LoaderCircle
							size={16}
							aria-hidden="true"
							className="text-accent motion-safe:animate-spin"
						/>
					</span>
				)}
				{expanded && <span className="truncate">{item.label}</span>}
			</button>
		);
		const menu = canCustomise ? (
			/*
			 * THE MENU'S TRIGGER (design § 6). Expanded, the trailing ellipsis IS
			 * the trigger - the discoverability path for a reader who never guesses
			 * that rows drag. Collapsed there is no room for a second control, so
			 * the trigger is an invisible zero-width anchor at the row's INLINE-END
			 * edge, and the menu is opened from `contextmenu` / `Shift+F10` on the
			 * row. The anchor is at `end-0` rather than `start-1` (design round 1,
			 * D3): anchored at the leading edge the panel opened 24px inside the
			 * 56px strip and covered the row it acts on.
			 *
			 * THE OFFSET IS MEASURED FROM THE ROW, NOT THE STRIP (design round 2,
			 * D10; QA round 2, Q2-1). The 32px row ends at x=44 in the 56px column,
			 * so an 8px offset still put the panel's leading edge at x=52 - 4px inside
			 * the strip. 16px puts it at x=60, clear of the column; expanded keeps the
			 * 6px gap because its anchor is already at the row's edge outside it.
			 */
			<DropdownMenu
				open={menuRow === id}
				onOpenChange={(open) => setMenuRow(open ? id : null)}
			>
				<DropdownMenuTrigger asChild>
					{expanded ? (
						<button
							type="button"
							data-sidebar-row-menu=""
							aria-label={t("ui.shell.sidebar_navigation.row_actions", {
								name: item.label,
							})}
							className={cn(
								"me-0.5 flex size-6 shrink-0 items-center justify-center rounded-sm",
								"text-ink-muted opacity-0 transition-opacity duration-fast ease-out-quart",
								"hover:bg-row-hover hover:text-ink",
								"group-hover/row:opacity-100 group-focus-within/row:opacity-100",
								"focus-visible:opacity-100 data-[state=open]:opacity-100",
								/* The held row draws the mark alone (D2): hover must not
								   re-reveal the control on the row being moved. */
								dragId !== null && "pointer-events-none opacity-0!",
							)}
						>
							<Ellipsis size={16} aria-hidden="true" />
						</button>
					) : (
						<span
							aria-hidden="true"
							className="pointer-events-none absolute inset-y-1 end-0 w-0"
						/>
					)}
				</DropdownMenuTrigger>
				<DropdownMenuContent
					align="start"
					side={menuSide}
					sideOffset={expanded ? 6 : 16}
					className="min-w-44"
					/*
					 * FOCUS GOES BACK TO THE ROW, not to the trigger (design § 6):
					 * after a move the row has changed place, and the reader's next
					 * key must land on the row they moved rather than on a strip
					 * button or a zero-width anchor.
					 */
					onCloseAutoFocus={(event) => {
						event.preventDefault();
						focusDestinationRow(id);
					}}
				>
					<DropdownMenuItem
						disabled={atTop}
						onSelect={() => runRowAction(id, { kind: "move", delta: -1 })}
					>
						{t("ui.shell.sidebar_navigation.move_up")}
					</DropdownMenuItem>
					<DropdownMenuItem
						disabled={atBottom}
						onSelect={() => runRowAction(id, { kind: "move", delta: 1 })}
					>
						{t("ui.shell.sidebar_navigation.move_down")}
					</DropdownMenuItem>
					<DropdownMenuSeparator />
					{region === "more" ? (
						<DropdownMenuItem
							onSelect={() =>
								runRowAction(id, { kind: "region", region: "visible" })
							}
						>
							{t("ui.shell.sidebar_navigation.show_in_sidebar")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							onSelect={() =>
								runRowAction(id, { kind: "region", region: "more" })
							}
						>
							{t("ui.shell.sidebar_navigation.move_to_more")}
						</DropdownMenuItem>
					)}
					{!layoutEquals(effectiveLayout, DEFAULT_SIDEBAR_LAYOUT) && (
						<>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onSelect={() => runRowAction(id, { kind: "reset" })}
							>
								{t("ui.shell.sidebar_navigation.reset_layout")}
							</DropdownMenuItem>
						</>
					)}
				</DropdownMenuContent>
			</DropdownMenu>
		) : null;
		return (
			/*
			 * THE TAG STAYS ON THE BUTTON (design review round 1, F2 / the tour's own
			 * rule): `data-tour-tag` on a wrapper would leave the tour dispensing a
			 * click at a div and silently doing nothing. The `<li>` carries the drag's
			 * own addresses - `data-sidebar-row` and the region it is drawn in - so a
			 * rig reads geometry from the row while the tour still reads the control.
			 */
			<li
				key={item.tourTag}
				data-sidebar-row={id}
				data-sidebar-region={region}
				onContextMenu={
					canCustomise
						? (event) => {
								/*
								 * THE SAME MENU WITHOUT THE ELLIPSIS (design § 6): right-click
								 * anywhere on the row opens it, which is also the only path to it
								 * in the 56px strip, where no ellipsis is drawn.
								 */
								event.preventDefault();
								setMenuRow(id);
							}
						: undefined
				}
				className={cn(
					"group/row relative flex h-[30px] w-full items-center rounded-md",
					"transition-colors duration-fast ease-out-quart",
					rowState,
					held && rowDragging,
					held && rowDraggingMark,
				)}
			>
				{/*
				 * THE TOOLTIP CARRIES THE SENTENCE, NOT THE BARE LABEL (UX round 1,
				 * U3; design round 1, D2). Collapsed, this is the only text the row
				 * ever shows, so a tooltip carrying the bare label would leave a
				 * badge's number scope-less. Suppressed - not `disabled` - while a drag
				 * is live: `disabled` renders the child bare and would remount the row
				 * out from under the pointer capture, while `suppressed` keeps the tree
				 * and closes the panel. It wraps the BUTTON, inside the row's own item
				 * (R1-3), never a second `<li>`.
				 */}
				{expanded ? (
					button
				) : (
					<BrowserSafeTooltip
						content={rowName(item)}
						side={menuSide}
						suppressed={dragId !== null}
					>
						{button}
					</BrowserSafeTooltip>
				)}
				{menu}
				{/*
				 * THE TRAILING MARKS (design round 1, D1): after the ellipsis lane and
				 * at the chevron's own 8px inset, so the badge and the spinner are the
				 * row's outermost marks and sit in ONE trailing column with More's
				 * chevron. `pointer-events-none`: the count is a status glyph, and the
				 * row's button (which names it) is the control.
				 */}
				{expanded && (attention > 0 || item.working) && (
					<span
						aria-hidden="true"
						className="pointer-events-none inline-flex shrink-0 items-center gap-1 pe-2"
					>
						{attention > 0 && (
							/*
							 * THE SHARED ACCENT COUNT (operator, 2026-10-28): every row's
							 * attention count is the one `AttentionBadge`, the filled accent
							 * pill Notifications introduced. This reverses the 2026-09-30
							 * quiet register and notifications decision D5 (Notifications
							 * alone loud); see `attention-badge.tsx` for the why.
							 */
							<AttentionBadge
								count={attention}
								data-tour-tag={item.attentionTag}
							/>
						)}
						{item.working && (
							/*
							 * THE BUSY MARK, at rail scale: the sidebar row's own working
							 * glyph - `LoaderCircle`, the accent ink, and
							 * `motion-safe:animate-spin`, so a reduced-motion user keeps the
							 * STATIC glyph this app already renders for the state rather
							 * than a second animation.
							 */
							<LoaderCircle
								size={16}
								aria-hidden="true"
								className="text-accent motion-safe:animate-spin"
							/>
						)}
					</span>
				)}
			</li>
		);
	};

	/*
	 * THE LIVE INDICATOR AND THE TRAILING BAND (design § 5), drawn from the same
	 * state in both widths so neither is a second implementation.
	 */
	const dropIndicator =
		indicatorTop === null ? null : (
			<span
				aria-hidden="true"
				data-sidebar-drop-indicator=""
				className="pointer-events-none absolute inset-x-1 z-10 h-0.5 -translate-y-px rounded-full bg-accent"
				style={{ top: indicatorTop }}
			/>
		);
	const draggingRegion =
		dragId === null ? null : regionOf(effectiveLayout, dragId);
	const bandLabel =
		draggingRegion === "more"
			? t("ui.shell.sidebar_navigation.show_in_sidebar")
			: t("ui.shell.sidebar_navigation.move_to_more");
	const dropBand =
		dragId === null ? null : expanded ? (
			/*
			 * THE OUTSIDE ZONE (design § 5): a thin band under the list, labelled by
			 * the direction of the move it makes. It exists so pulling a row out of
			 * the fold never depends on hitting a 30px row, and it is a visible
			 * affordance rather than a hidden gesture.
			 *
			 * AN OVERLAY, NOT A ROW (design round 1, D8): in flow, arming a drag grew
			 * the column by the band's height and moved the chat list under the
			 * pointer's neighbourhood (measured: the toolbar glyph 905→985 device px,
			 * back on drop). `absolute top-full` draws it over the list below and moves
			 * nothing. `border-control` rather than `hairline` (D4): the band is the
			 * drop zone's only visible bound, and the branding floor is ≥3:1 for a line
			 * whose removal loses information.
			 */
			<div
				data-sidebar-drop-band=""
				className="absolute inset-x-0 top-full z-20 mt-1 flex h-7 items-center justify-center rounded-md border border-dashed border-control bg-surface text-meta text-ink-dim"
			>
				{bandLabel}
			</div>
		) : (
			/* The strip has no room for a sentence; its language is the tooltip. Its
			   side follows the column (design round 1, D5): in RTL the strip is on the
			   window's right edge and a right-opening panel would cover it. */
			<BrowserSafeTooltip content={bandLabel} side={rtl ? "left" : "right"}>
				<div
					data-sidebar-drop-band=""
					className="absolute inset-x-0 top-full z-20 mx-auto mt-1 flex h-6 w-8 items-center justify-center rounded-sm border border-dashed border-control bg-surface"
				>
					<span
						aria-hidden="true"
						className="h-0.5 w-4 rounded-full bg-ink-dim"
					/>
				</div>
			</BrowserSafeTooltip>
		);
	/*
	 * THE LIVE REGION (design § 6, § 5): polite, so a move is never urgent - and
	 * `aria-atomic` because every note REPLACES the sentence rather than appending
	 * to it; a reader that only announces the changed text node could otherwise
	 * drop the row's name when two consecutive notes share their ending.
	 */
	const announcementRegion = (
		<span className="sr-only" aria-live="polite" aria-atomic="true">
			{announcement}
		</span>
	);

	/*
	 * THE ONE TOGGLE. Docked, it collapses to the strip (`‹`); in the strip it
	 * expands the dock (`›`). Both directions write the same persisted preference
	 * at every window width, so the glyph never depends on a viewport threshold.
	 */
	const toggleLabel = expanded
		? t("ui.shell.sidebar_navigation.collapse_sidebar")
		: t("ui.shell.sidebar_navigation.expand_sidebar");
	const ToggleGlyph = expanded
		? rtl
			? ChevronRight
			: ChevronLeft
		: rtl
			? ChevronLeft
			: ChevronRight;
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
	 * round 1, D1): `New chat ⌘N`, then `Search ⌘P`.
	 *
	 * New chat moved HERE from the list's own header, where it sat under a second
	 * search field, a disclosure and an `All chats` row - the placement the design
	 * round named as the biggest reason the shell read as two panels welded
	 * together. Search stays the command palette's door: the one visible search in
	 * the column. The list's own filter is type-to-filter now (`chat-sidebar.tsx`),
	 * so there is no second search control at rest.
	 *
	 * THE CHORD IS WRITTEN ON THE ROW, as caps with no separator between them
	 * (N1: `⌘P`, not `⌘ + P`) - the app's `KeyboardShortcut` spells a chord as
	 * `+`-joined caps and prints the `+`, so the rows pass the caps as one string
	 * and split nothing. The accessible name carries the chord in words.
	 *
	 * DISABLED ON THE CATALOGUE GATE, the same bit `app.tsx`'s ⌘N reads: staging a
	 * draft needs the session catalogue, and a row that staged one against an
	 * absent catalogue would be the shortcut claiming a capability the app has
	 * just said it does not have.
	 */
	const newChatLabel = t("ui.shell.sidebar_navigation.new_chat_shortcut", {
		shortcut: newChatShortcutCap(isMac).replace("+", ""),
	});
	/*
	 * BOTH DOORS IN THE NAME (design/UX round 2, U3; re-pointed by issue #850):
	 * this row is where the app teaches the search chords, and there are two of
	 * them — `Cmd/Ctrl+P` for the everything palette and `Cmd/Ctrl+K` for the
	 * conversation switcher. THE TWO SWAPPED in #850 (K used to be the everything
	 * door), so a name that still paired K with "everything" would be the stale
	 * copy that change exists to remove. The visible cap follows the CLICK — this
	 * row opens the everything door, so it prints that door's cap — while the
	 * second door rides in the accessible name and (for the strip, which draws its
	 * name as a tooltip) in the tooltip, so a reader who never met the tour can
	 * still find it. The third door (`Cmd/Ctrl+Shift+P`, commands) is not on this
	 * row: one cap is the row's budget, and two chords in the name is already the
	 * most a rail row can carry.
	 */
	const searchLabel = t("ui.shell.sidebar_navigation.search_accessible", {
		everything: paletteDoorLabel("everything", isMac),
		chats: paletteDoorLabel("chats", isMac),
	});
	const searchTitle = t("ui.shell.sidebar_navigation.search_tooltip", {
		everything: paletteDoorLabel("everything", isMac),
		chats: paletteDoorLabel("chats", isMac),
	});
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
				<span aria-hidden="true" className="ms-auto">
					<KeyboardShortcut shortcut={caps} joined />
				</span>
			</button>
		);
	};
	const newChatRow = primaryRow(
		MessageSquarePlus,
		t("ui.shell.sidebar_navigation.new_chat"),
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
		t("ui.shell.sidebar_navigation.search"),
		paletteDoorCaps("everything", isMac),
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
			/* A count the group carries while it is closed: the corner mark the
			   destination rows use, so a collapsed More can say something waits.
			   The caller passes 0 while the group is open (design D2). */
			attention?: number;
			attentionTag?: string;
			/*
			 * A group with a hidden row WORKING says so on the collapsed More row
			 * (design § 3): the 56px strip has no trailing lane, so the spinner is the
			 * second corner mark rather than an in-flow glyph. It sits at the opposite
			 * corner from the count, because the two can both be true at once - one
			 * hidden destination waiting while another works - and neither may hide
			 * the other.
			 */
			working?: boolean;
		},
	) => {
		const Icon = icon;
		return (
			<BrowserSafeTooltip content={label} side={rtl ? "left" : "right"}>
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
					<span className="relative flex size-7 items-center justify-center">
						<Icon size={16} aria-hidden="true" />
						{(props.attention ?? 0) > 0 && (
							<span className="pointer-events-none absolute -top-1 -end-1.5 flex">
								<AttentionBadge
									count={props.attention ?? 0}
									placement="corner"
									data-tour-tag={props.attentionTag}
								/>
							</span>
						)}
						{props.working && (
							<span className="pointer-events-none absolute -bottom-0.5 -end-0.5 flex">
								<LoaderCircle
									size={12}
									aria-hidden="true"
									className="text-accent motion-safe:animate-spin"
								/>
							</span>
						)}
					</span>
				</button>
			</BrowserSafeTooltip>
		);
	};

	/*
	 * The collapse control in the brand row, revealed when the column is pointed
	 * at or contains focus - Linear, Notion and Slack all put it in the header
	 * and reveal it on hover.
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
				"pointer-events-none opacity-0 transition-opacity duration-fast ease-out-quart",
				"group-hover/sidebar:pointer-events-auto group-hover/sidebar:opacity-100",
				"group-focus-within/sidebar:pointer-events-auto group-focus-within/sidebar:opacity-100",
			)}
		>
			<BrowserSafeTooltip content={toggleLabel} side={rtl ? "left" : "right"}>
				<Button
					variant="ghost"
					size="icon-sm"
					onClick={onCollapse}
					aria-label={toggleLabel}
					aria-expanded={expanded}
					aria-keyshortcuts={sidebarToggleCap(isMac)}
				>
					<ToggleGlyph aria-hidden="true" />
				</Button>
			</BrowserSafeTooltip>
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
	/*
	 * THE "MORE" ROW AND ITS INLINE GROUP.
	 *
	 * One disclosure, drawn in both widths: expanded it is a destination row
	 * with an ellipsis and a chevron; collapsed it is the strip's icon button.
	 * `aria-expanded` states the state and `aria-controls` names the list, which
	 * is why the group is a nested list rather than a sibling whose relation a
	 * reader would have to infer. The rows inside keep their own tooltips,
	 * badges and keyboard order - expanding reveals them in place, so Tab order
	 * follows document order in both states.
	 */
	const renderOverflowGroup = () => {
		if (moreRows.length === 0) return null;
		const hiddenItems = moreRows
			.map((id) => destinationItems.get(id))
			.filter((item): item is NavItem => item !== undefined);
		/*
		 * THE AGGREGATE (design § 3): every hidden destination's attention is SUMMED
		 * (`moreAttentionCount` states why a sum rather than a dot) into this row's
		 * badge - the same shared `AttentionBadge` the rows wear, so a count folded
		 * into More is exactly as loud as it was on its own row - and any hidden row
		 * working draws the spinner. It is
		 * the requirement that an unread chief of staff can never be hidden by
		 * customisation - Aida folded into More still says, on the row that hides her,
		 * that something is waiting.
		 *
		 * THE ATTENTION COUNT WINS THE NAME when both exist: the number is what the
		 * reader acts on, and only one sentence can be the control's name. The
		 * spinner is still drawn beside it, so the state is not lost to sight.
		 */
		const moreAttention = moreAttentionCount(hiddenItems);
		/*
		 * THE AGGREGATE IS A SUMMARY OF WHAT IS HIDDEN, SO IT IS DRAWN ONLY WHILE
		 * THE GROUP IS CLOSED (design follow-up to #1465, D2). Open, the hidden rows
		 * are on screen and carry their own pills; More's `4` beside Team Bridge's
		 * `3` and Mesh's `1` drew the same attention twice - the usual disclosure
		 * pattern is that a closed group summarises and an open group lets its rows
		 * speak. The accessible name keeps the sum in both states: it describes the
		 * control, and a reader tabbing past an open More still learns how much
		 * waits inside it.
		 */
		const moreMark = overflowRevealed ? 0 : moreAttention;
		const moreWorking = hiddenItems.some((item) => item.working === true);
		const moreName =
			moreAttention > 0
				? t("ui.shell.sidebar_navigation.more_waiting", {
						count: moreAttention,
						countText: String(moreAttention),
					})
				: moreWorking
					? t("ui.shell.sidebar_navigation.more_working")
					: t("ui.library.page.more_destinations");
		return (
			<li
				key="nav-overflow"
				className={cn(
					"flex flex-col",
					expanded ? "gap-0.5" : "items-center gap-1",
				)}
			>
				{expanded ? (
					<button
						type="button"
						data-tour-tag="nav-item-more"
						data-sidebar-more=""
						aria-expanded={overflowRevealed}
						aria-controls="sidebar-more-destinations"
						aria-label={moreName}
						onClick={() => setOverflowExpanded(!overflowRevealed)}
						className={cn(
							DESTINATION_ROW,
							"text-ink-muted hover:bg-row-hover hover:text-ink",
						)}
					>
						<Ellipsis size={16} aria-hidden="true" className="shrink-0" />
						<span className="min-w-0 flex-1 truncate text-start">
							{t("ui.library.page.more")}
						</span>
						{(moreMark > 0 || moreWorking) && (
							<span className="inline-flex shrink-0 items-center gap-1">
								{moreMark > 0 && (
									<AttentionBadge
										count={moreMark}
										data-tour-tag="nav-more-badge"
									/>
								)}
								{moreWorking && (
									<LoaderCircle
										size={16}
										aria-hidden="true"
										className="text-accent motion-safe:animate-spin"
									/>
								)}
							</span>
						)}
						<ChevronDown
							size={14}
							aria-hidden="true"
							className={cn(
								"shrink-0 transition-transform duration-fast",
								overflowRevealed && "rotate-180",
							)}
						/>
					</button>
				) : (
					stripButton(Ellipsis, moreName, {
						onClick: () => setOverflowExpanded(!overflowRevealed),
						attention: moreMark,
						attentionTag: "nav-more-badge",
						working: moreWorking,
						attrs: {
							"aria-expanded": overflowRevealed,
							"aria-controls": "sidebar-more-destinations",
							"data-tour-tag": "nav-item-more",
							"data-sidebar-more": "",
						},
					})
				)}
				{overflowRevealed && (
					<ul
						id="sidebar-more-destinations"
						className={cn(
							"flex flex-col gap-0.5",
							!expanded && "items-center gap-1",
						)}
					>
						{moreRows.map(renderDestinationRowForWidth)}
					</ul>
				)}
			</li>
		);
	};

	const settingsGear = (
		<BrowserSafeTooltip
			content={t("ui.shell.sidebar_navigation.settings")}
			side="top"
		>
			<button
				type="button"
				data-tour-tag="nav-item-settings"
				onClick={() => navigate("/settings")}
				aria-current={currentView === "settings" ? "page" : undefined}
				aria-label={t("ui.shell.sidebar_navigation.settings")}
				className={cn(
					"flex size-8 shrink-0 items-center justify-center rounded-sm text-ink-muted",
					"transition-colors duration-fast ease-out-quart",
					"hover:bg-row-hover hover:text-ink",
					currentView === "settings" && "text-ink",
				)}
			>
				<Settings size={16} aria-hidden="true" />
			</button>
		</BrowserSafeTooltip>
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
				data-glass-region="sidebar"
				/*
				 * The sidebar is a full-height panel: `surface` from y0 and its first
				 * row below the strip, through the one panel utility. It used to be
				 * conditional on the shell route opting into `flushTop`, which is the
				 * opt-in the panel contract removed.
				 */
				className="panel-top-pad group/sidebar flex h-full min-h-0 flex-col items-center bg-surface"
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
				{/*
				 * THE DESTINATION RAIL, and it is the SAME list as the expanded column's:
				 * `visibleRows` in the stored order, then the More group (design § 3). The
				 * strip has no ellipsis (there is no room for a second control in 56px), but
				 * right-click and Shift+F10 still open the row menu, and a drag here is the
				 * same gesture with the same 5px threshold - which is why the wrapper, the
				 * indicator and the band are the same elements in both widths.
				 */}
				<div
					ref={destinationsRef}
					data-sidebar-destinations-area=""
					data-sidebar-dragging={dragId !== null ? "" : undefined}
					className="relative mt-4 flex flex-col items-center gap-1 select-none"
				>
					<ul
						data-sidebar-destinations=""
						className="flex flex-col items-center gap-1"
					>
						{visibleRows.map(renderDestinationRowForWidth)}
						{renderOverflowGroup()}
					</ul>
					{dropIndicator}
					{dropBand}
				</div>
				{announcementRegion}
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
			data-glass-region="sidebar"
			className="panel-top-pad group/sidebar flex h-full min-h-0 flex-col overflow-hidden bg-surface"
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
			<div className="flex h-10 shrink-0 items-center gap-1 pe-2 ps-4">
				<CollapsibleAppLogo expanded />
				<span className="ms-auto">{collapseToggle}</span>
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
				 * THE DESTINATIONS GROUP. One ordered list cut by the fold (design § 2):
				 * the visible region, then the More row, then More's own rows while it is
				 * open. `renderedRegion` has already applied the stored order and the
				 * availability gate, so this block is order-only.
				 *
				 * THE SCROLL REGION IS THE DRAG'S OWN: `min-h-0` lets it give way before the
				 * conversation list does, and the height cap means the rail can never take
				 * more than half the window - below that the list it sits over would be
				 * squeezed to nothing. Nine rows is 286px, so the cap only bites in a short
				 * window with an unusually long visible region: exactly the state the drag
				 * auto-scroll exists for (design § 5).
				 */}
				<div className="relative">
					<div
						ref={destinationsRef}
						data-sidebar-destinations-area=""
						data-sidebar-dragging={dragId !== null ? "" : undefined}
						className="relative min-h-0 max-h-[50dvh] overflow-y-auto select-none"
					>
						<ul data-sidebar-destinations="" className="flex flex-col gap-0.5">
							{visibleRows.map(renderDestinationRowForWidth)}
							{renderOverflowGroup()}
						</ul>
						{dropIndicator}
					</div>
					{dropBand}
				</div>
				{announcementRegion}
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
