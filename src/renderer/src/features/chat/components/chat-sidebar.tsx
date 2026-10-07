import {
	builtinOfferDismissed,
	builtinOfferSignature,
} from "@features/agents/builtin-offer";
import { InstallBuiltinAgents } from "@features/agents/components/install-builtin-agents";
/*
 * THE NETWORKS READ, for the remote rows' hover sentence: ONE observer, `poll:
 * false`, riding whatever the rail or the Mesh tab already fetched (one read per
 * window, shared by query key) - the same cheap read the device control takes,
 * gated by the same capability. It names the NETWORK half of the sentence; the
 * device half rides the row itself (`chat-remote.ts`).
 */
import { useMeshNetworks } from "@features/mesh/mesh-store";
import { compatibilityBannerShown } from "@shared/api/local-operator/backend-error";
import {
	isRemoteReceiptDeferral,
	userFacingMessage,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	useHubActions,
	useHubUpdates,
} from "@shared/api/local-operator/hub-hooks";
import {
	type HubItemKind,
	type HubMark,
	hubAvailableCount,
	hubItemIndex,
	hubItemKey,
	hubMarkFor,
	hubSignInLine,
} from "@shared/api/local-operator/hub-updates";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { useChatSearch } from "@shared/api/local-operator/session-search";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	ContextMenu,
	ContextMenuContent,
	ContextMenuItem,
	ContextMenuTrigger,
} from "@shared/components/ui/context-menu";
import { Label } from "@shared/components/ui/label";
import {
	Popover,
	PopoverContent,
	PopoverTrigger,
} from "@shared/components/ui/popover";
import { Tooltip, TooltipProvider } from "@shared/components/ui/tooltip";
import { useServerHealth } from "@shared/hooks/use-connectivity-status";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { cn } from "@shared/lib/utils";
import {
	CATALOGUE_HEAD_PAGE,
	type CanonicalSessionRow,
	LEGACY_CATALOGUE_PAGE,
	catalogueScopeKey,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import { useConversationInputStore } from "@shared/store/conversation-input-store";
import { usePanelPresentationStore } from "@shared/store/panel-presentation-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	dismissToast,
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import {
	Archive,
	ArchiveRestore,
	AtSign,
	Bot,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	ChevronUp,
	FileText,
	FolderPlus,
	GitFork,
	GripVertical,
	Hourglass,
	LoaderCircle,
	type LucideIcon,
	MessageSquarePlus,
	MoreHorizontal,
	Pin,
	PinOff,
	Plus,
	Search,
	SlidersHorizontal,
	Trash2,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import {
	type Dispatch,
	type FC,
	type KeyboardEvent,
	type MutableRefObject,
	type FocusEvent as ReactFocusEvent,
	type ReactNode,
	type PointerEvent as ReactPointerEvent,
	type Ref,
	type SetStateAction,
	createElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { SESSION_SEARCH_MAX_CHARS } from "../../../../../shared/desktop-contract";
import { AGENT_ROSTER_SEED } from "../../command-palette/palette-search";
import { focusRowAfterRemoval } from "../archive-confirm";
import { ARCHIVE_FAILURE_TOAST_MS } from "../archive-undo";
import {
	type ArchivePressRecord,
	archivePressExpired,
	archivePressOutcome,
} from "../chat-archive-press";
import {
	answeredArchiveRows,
	archiveControlLabel,
	archivedSearchWidened,
	visibleRows,
} from "../chat-archived";
import {
	CHAT_LIST_SECTION_LABEL,
	type ChatListSection,
	isRunningRow,
	relativeTime,
	relativeTimeSentence,
	sectionRows,
} from "../chat-list-sections";
import {
	type PinMoveStep,
	canMovePinnedRow,
	chatPinMoveCapJoined,
	chatPinMoveChord,
	chatPinMoveRowId,
	forgetPinnedOrder,
	movePinnedOrder,
	movePinnedOrderTo,
	orderPinnedRows,
	pinDragSlot,
	pinMoveBoundaryNote,
	pinMoveNote,
	pinMoveUntargetedNote,
	pinnedOrder,
} from "../chat-pin-order";
import {
	CHAT_REGION_ENTRY_ATTR,
	CHAT_ROW_ACT_ATTR,
	type ChatRowAct,
	chatRowAct,
	chatRowActCapJoined,
	chatRowActControl,
} from "../chat-regions";
/*
 * THE REMOTE ROW'S OWN FACTS (the shared convention; the header of
 * `canonical-sessions-store.ts` names the sentence all surfaces keep): the
 * device label, the network lookup, the one sentence both channels read, and
 * the order remote rows are drawn in.
 */
import {
	deviceNetworkNames,
	mergeRemoteRowsByActivity,
	remoteClause,
	remoteUnreachableClause,
} from "../chat-remote";
import {
	type ArchiveView,
	chatCountAnnouncement,
	hitsAnswerQuery,
	lostRowsToStaleAnswer,
	rowTrailingStatement,
	searchAnswerIsClipped,
	searchChats,
} from "../chat-search";
import { pinnedRows, unpinnedRows } from "../chat-sections";
import { subagentClause, subagentMarks } from "../chat-session-subagents";
import {
	agentRecencyMs,
	filterAgentRows,
	orderAgentRows,
	togglePinnedAgent,
} from "../chat-sidebar-agents";
import {
	DEFAULT_SIDEBAR_VIEW,
	SECTION_GROWN_HINT,
	SIDEBAR_SECTION_ROWS,
	type SidebarSectionKey,
	entityMore,
	entityQueryAdmits,
	entityRows,
	entitySectionGap,
	groupRows,
	isEntitySection,
	isSectionShown,
	pageLimit,
	pageMoreLabel,
	pageOrder,
	pageRows,
	parseSidebarView,
	raiseSectionCap,
	rosterFieldShown,
	sectionGrownHintId,
	sectionIsGrown,
	sectionMoreLabel,
	sectionMoreName,
	shownSections,
	toggleSectionDisclosure,
} from "../chat-sidebar-view";
import { useStripSpeaksConnection } from "../chat-status-presence";
import { clearSearch } from "../clear-search";
import {
	discardDraftLabel,
	discardSuccessorIndex,
	untargetedDraftRows,
} from "../draft-rows";
import { fleetAsksBySession, useFleetAsks } from "../fleet-asks";
import {
	markAllReadCopy,
	markAllReadReceipt,
	unreadMarkKind,
} from "../mark-all-read";
import { readAckCopy, readAckNoticeSentence } from "../read-ack-notice";
import { catalogueGate } from "../sidebar-catalogue-gate";
import {
	catalogueTailView,
	catalogueTotalSentence,
	groupBadgeCount,
	groupBadgeLabel,
	groupChatsView,
	scopeCensusTotal,
	tailArrivalAnnouncement,
	tailExtendDue,
} from "../sidebar-scope-paging";
import { ChatRemoteMark } from "./chat-remote-mark";
import { ChatRowHoverIntent } from "./chat-row-hover-intent";
import { ChatRowTitle } from "./chat-row-title";
import { ChatSidebarViewMenu } from "./chat-sidebar-view-menu";
import {
	HubHeadingControls,
	HubRowNote,
	HubSectionLines,
	HubUpdateMark,
} from "./hub-update-mark";
import { TeamAvatarBubble } from "./team-avatar-bubble";

/*
 * The ids the boundary's controls point at with `aria-controls`.
 *
 * Named constants because two controls reference each one and a literal written
 * twice is how a control ends up pointing at nothing: the cluster's buttons only
 * render while their region does, so the reference is never dangling, and the
 * restore row names its region in words instead of pointing at a node that does
 * not exist yet.
 */
const ENTITY_REGION_ID = "chat-sidebar-entities";
const CHAT_REGION_ID = "chat-sidebar-chats";

/**
 * One row-drag gesture, held in a ref rather than in state (issue #697).
 *
 * WHY IT IS NOT THE STATE: the gesture is written by pointer events and read by
 * the same handlers on the very next event, so a `useState` would make every move
 * wait for a render to be visible to its own reader - and `setPointerCapture`
 * means the reads and writes are strictly ordered already. Only the two facts a
 * RENDER depends on are state: which row is being dragged, and the slot the
 * indicator sits in (`pinDrag` below).
 *
 * `armed` is the board's distinction: the gesture exists from `pointerdown`, but a
 * press that never moves has not started a drag, and it must announce and write
 * nothing. `label` is captured at the press so a cancel can name the row it is
 * cancelling without re-reading a list that may since have re-ordered.
 */
type PinDragGesture = {
	pointerId: number;
	id: string;
	label: string;
	armed: boolean;
	slot: number;
};

type Props = {
	selectedConversation?: string;
	onSelectConversation: (id: string) => void;
	onStageDraft: (target?: ChatTarget, fresh?: boolean) => void;
};
const rowStyle =
	"flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-body-sm leading-5 hover:bg-row-hover focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

/*
 * The conversation row's BOX - the element main's `ce5fd9578` put around the button,
 * and the box both of this row's paths render.
 *
 * It is a named constant because the two paths must render THE SAME BOX and not merely
 * similar ones: the button inside it is `min-w-0 grow`, so a path that rendered the
 * button alone would leave it without a flex parent, shrink-to-fitting its words. That
 * is exactly what design round 8 (D1) measured on the capability-withdrawn path -
 * 138.3 / 210.7 / 179.0 / 165.6px against main's 264px - and a literal written twice is
 * how the two paths drifted when main's row changed shape under this branch's fold.
 */
const rowBoxStyle = "flex h-8 items-center gap-1 rounded-md";

/*
 * Where the bulk read receipt's label stops fitting, in the width of the header
 * row itself — the row is the container queried rather than the panel, because
 * the row is what has to fit.
 *
 * 253px is the TWO-DIGIT break, and the two-digit case is the binding one: with a
 * one-digit section badge the group's own name needs a 235px row, with a
 * two-digit one — the operator's own "Active chats 38" — it needs 253px, and the
 * action is unshrinkable so the name absorbs whatever is left. Design round 2
 * swept 240 through 360 on the shipped component and found the band the round-1
 * break left open: at 267/268/269px panels (250/251/252px rows) the name was
 * ellipsised while the action's label was still fully spelled, which is the
 * trade design D1 rejected. Shedding at the width the name actually needs closes
 * it, so the shed and the truncation can never both be reachable.
 *
 * The header row is 17px narrower than the panel, so 253px of row is a 270px
 * panel: the shed fires below the DEFAULT (280) but not at it, and the 240px
 * clamp minimum gets the glyph. Above the break the full label fits and nothing
 * truncates.
 *
 * `sr-only`, NEVER `hidden`. `hidden` is `display: none`, which takes the span out
 * of the accessibility tree, and the label's words are the only half of the
 * control's name that identifies it: what would be left is the `sr-only` scope
 * suffix, so an AT user at the clamp width would hear ", including 4 in Previous
 * chats" and nothing about the action (review R2-1 / UX U2-1 — the same defect,
 * one word wide). The `sr-only` yield is this codebase's idiom for exactly this
 * give (`directory-indicator.tsx:280-289` sheds its chip text the same way and
 * says why), and the pixels are identical.
 *
 * The shape is `older-history-slot.tsx`'s, which switches two spellings on its
 * own container for the same reason: the row's height is fixed, so a wrapped
 * line is not an option and the sentence is what has to change length.
 */
const MARK_ALL_READ_LABEL_SHED = "@max-[253px]/chatheading:sr-only";

/**
 * The receipt announcement's own toast id, and it is STABLE ON PURPOSE.
 *
 * A toast is a claim about the state it was raised in, and this one is the only
 * sentence in the panel the app itself can falsify: the reader presses the row it
 * names, the receipt lands on the next tick, the mark clears - and the sentence kept
 * telling them to press for the rest of its life (UX round 2, U4). The archive's own id
 * above already made that rule AND the shape that keeps it true across a remount: ONE
 * id any instance can dismiss. A per-instance handle cannot keep it - the id lived in
 * a ref, so a route change off `/chat` and back re-mounted the panel with a fresh ref
 * while the sentence stood in the app-level container, and nothing left in the app
 * could retire it (agent review round 3, MINOR 1; UX round 3, U7). With one id the
 * dismissing branch needs no handle at all, and a new budget's sentence REPLACES the
 * standing one instead of stacking a second copy of the same fact.
 */
const READ_ACK_TOAST_ID = "read-ack";
/**
 * The sentence a withheld discard carries - ONE copy, read by both channels: the
 * `title` (pointer) and the `sr-only` element the control points at while it is
 * inapplicable (design round 2's D7, UX round 2's U6: a title on a `disabled`
 * control was the pointer-only channel engines are least reliable about, and it
 * reached no keyboard reader at all).
 */
const SENDING_DISCARD_WHY =
	"Sending - this draft can be discarded when the send settles";
/** The sr-only why's id, keyed so each row's control points at its own. */
const draftWhyId = (key: string) => `draft-discard-why-${key}`;
/** The disabled Clear all's own why, same two-channel rule. */
const CLEAR_ALL_WHY =
	"Drafts are sending - they can be cleared when the sends settle";
const CLEAR_ALL_WHY_ID = "drafts-clear-all-why";

/*
 * WHERE THE ROW'S PER-ROW CONTROLS SHED: NOWHERE, AND THE RULE THAT REPLACED IT.
 *
 * This file used to carry two container-query constants here -
 * `ROW_CONTROLS_PAIR_SHED` and `ROW_CONTROLS_SHARED_SHOWN` - which swapped the
 * pin/archive pair for one 24px shared menu below a 279px panel, plus the
 * `@container/chatsidebar` declaration on the panel root that existed only to be
 * measured by them (design D9, in `docs/design/sidebar-row-space.md`).
 *
 * The shed's own reason was entirely a REST cost - "56px off every title, on every
 * row, at rest, whether or not the pointer is anywhere near it" - and that cost is
 * now zero, because the acts are absent from the layout until the pointer or the
 * keyboard is in the row. What the shed still bought at 240 was a smaller HOVER
 * cost (one 24px trigger instead of the pair), and that is real - but it was paid
 * for with two clicks on every act at the width where the acts are hardest to hit,
 * it would still have needed the pinned mark hoisted out of the shed wrapper to fix
 * the 240 defect the designer measured (a pinned row at the clamp minimum drew NO
 * pin at all: the mark lived inside the wrapper the query hid), and it left two
 * behaviours to verify instead of one. So the rule is one rule at every width.
 *
 * THE REVERSAL IS ONE CLASS, and it is worth naming rather than rediscovering: the
 * pair wrapper below states its whole class list in one place, so re-shedding is a
 * `@max-[263px]/chatsidebar:hidden` appended there plus the shared control it would
 * stand in for - and the frames of that behaviour are already committed
 * (`docs/evidence/session-archive/row-controls-shared*`). It is a change to make on
 * evidence that the 240 hover is too busy, not in advance.
 *
 * ONE WIDTH QUERY DID COME BACK FOR A WHILE, and it is gone again: round 1 shed the
 * GRIP alone below a 279px panel (`@max-[263px]/chatsidebar:hidden!`, with the
 * `@container/chatsidebar` declaration back on the panel root for it), on the
 * reading that the grip is the one member of the cluster that is an ACCELERATOR
 * rather than a path - the pair being WCAG 2.5.7's single-pointer alternative to the
 * gesture. This change deletes the arrow pair for the same reason one step further
 * on: with five controls revealed the clamp's title had 40px of the row's 208, and
 * with the pair gone the same width has 124px, so the grip is drawn at every width
 * and the declaration went with the query that read it. The reasoning above still
 * decides the question: a shed is a change to make on evidence that a width is too
 * busy, and the width is not.
 */

/**
 * The ground of the row this panel is currently ON — the selected conversation,
 * the All chats filter, the New chat row staging an untargeted draft, and the
 * agent or team an untargeted-vs-targeted draft names.
 *
 * WHY THE STEP IS `rowSelected`, AND WHAT THE STEP IS MADE OF. This panel is
 * `bg-surface` (the `nav aria-label="Chats"` root), and a selection needs a step
 * off it that is SEEN. The role is one of the two the row-state pass authored —
 * `rowHover` for the row under the POINTER, `rowSelected` for the row the reader
 * is ON — and both are tints of the palette's own `accent` hue at two strengths
 * rather than of the panel's own cast. The role they replaced (`highlight`) was a
 * lightness step toward the panel's hue, and lightness is the one axis the band
 * had already spent: 32 of the 41 dark palettes share one 230-306 degree family,
 * so a foot on that ladder is not a mark a reader can find. `rowSelected` is
 * asserted at ΔE00 **4.0** off `surface` AND **2.0** off `rowHover`, with a
 * 1.5-5.0 `L*` step in the direction the mode runs and a chroma ceiling; its doc
 * in `palette-contract.ts` states the rule in full and
 * `scripts/contrast-contract.mjs` asserts it per palette.
 *
 * WHY THE BAR, WHICH IS THE SECOND SIGNAL AND NOT DECORATION. Both fills are ONE
 * hue at two strengths, so their last increment of "which one am I on" is carried
 * by something that is not a colour distance at all: a 2px `accent` bar on the
 * row's leading edge, drawn with a `before:` pseudo-element so it costs no layout
 * and cannot shift the label, beside the `font-medium` the row already carried.
 * `accent` measures 4.23-11.48:1 against its own selected ground across all 59
 * palettes (the fleet's tightest is `tokyoNight`, its strongest `obsidian`), so
 * the 3:1 non-text floor holds everywhere, and the idiom is not new:
 * `at-picker.tsx` and `slash-commands.tsx` mark the row Enter will apply with the
 * same bar for the same reason — their popup's active row was carried by hue
 * alone. The sidebar was the only selection in the app without one.
 *
 * WHY NOT THE ACCENT WASH. `accentWash` is ΔE00 **1.05** from `surface` in
 * tokyoNight (#262B3F on #24283B) — the operator's own report, "you can't tell
 * from the sidebar which one is selected", measured. The wash is also the
 * TRANSIENT idiom (pointer hover, and a keyboard-focused option in a list that is
 * open), so a persistent "you are here" painted in it says the reader is passing
 * through. Measured over the set, the wash sits under the ΔE00 **2.0** field
 * floor against `surface` in **seven** of the fifty-nine palettes (worst
 * `catppuccinMacchiato` 0.80, then tokyoNight 1.05), and on **6 of 41** dark
 * themes it is a WEAKER mark than the hover beside it — `obsidian` 2.02 against
 * 3.42, `tokyoNight` 2.04 against 3.41 — which is the exact arrangement the
 * retired role existed to fix. The wash is not broken everywhere — on the rail's
 * old `sunken` ground it measured 9.6 — which is why this is a call-site ground
 * and NOT a wash: strengthening `accentWash` for the panels that draw it on
 * `surface` would make every hover tint in the app louder. (The rail no longer
 * paints a ground of its own at all: it is `surface` with a `border-r
 * border-hairline` rule, so nothing on it is drawn on the rung that used to make
 * the wash work there. The SETTINGS rail
 * was the other `surface` panel and takes this same role — it imports
 * `rowCurrent` from this file rather than restating it, see the note at the
 * declaration below.)
 *
 * WHY NOT `sunken`, WHICH IS WHAT THIS USED TO BE. `sunken` is the RECESSED
 * role: a well, a track, a code ground — a hole in the panel rather than a mark
 * on it — and at 3.75-14.94 from `surface` it read as the dark box the operator
 * reported. It is also 97 `*-sunken` utility occurrences across 66 files under
 * `src/renderer` — 85 live class usages and 12 inside prose, the palettes and the
 * generated stylesheet excluded — so the row could not be quietened by moving
 * the role; the row needed one of its own.
 *
 * THE HOVER'S OWN WEAKEST CASE, NAMED RATHER THAN LEFT TO PASS. On `obsidian`
 * the palette's accent is the off-white at C* 0, so neither role can spend chroma
 * and both are neutral steps at the ink cap: the hover measures ΔE00 4.05 off
 * `surface` and the selection 4.22, 3.56 apart, and the SELECTION's near-white bar
 * (11.48:1)
 * is what carries the state. The hover therefore has the fill alone — there is no
 * second signal a component can give a hover here without giving every hover in
 * the fleet the selection's own bar, which would make the two states unrankable,
 * and an edge on a row is the ring this panel retired. It is recorded in
 * `ROW_STATE_NEUTRAL_ACCENT` in `scripts/contrast-contract.mjs` - the CLASS it
 * belongs to, not a ledger row - with its measured ceiling;
 * it is a value-level debt for the palette half, not something this layer can pay.
 *
 * WHY NOT `elevated`, AND WHY THE HOVER BESIDE THE SELECTION IS A ROLE OF ITS
 * OWN. `elevated` is a GROUND — dialogs, sheets, popovers, menus, tooltips and
 * the ladder's own rung read it — so it cannot be a row's state, and it used to
 * be one anyway: it was the hover step on every row in this panel. The hover now
 * takes its own role, `rowHover`, so the two row states are two strengths of one
 * hue rather than a ground doubling as a state; `contrast-contract.mjs` asserts
 * both roles against `surface`, `elevated`, `sunken` and the wash, which is where
 * the old pair failed: it was ΔE00 0.77 apart in `obsidian` when the selection
 * was the wash and 1.80 apart on `neon` when it was `highlight` — two marks the
 * reader could see without being able to rank.
 *
 * AND WHY THIS MARK HAS NO SECOND, BOUNDARY-SHAPED HALF. An earlier round of
 * this branch added a 1px `outline-control` ring beside the ground. It is
 * retired here rather than kept, on three measurements (design round 1, D3):
 *
 *   1. It borrowed the wrong object. The search field directly above the list
 *      is `h-8 w-full rounded-md border border-control`; the ring was that same
 *      role at the same 1px and the same radius one line below it, and both
 *      lines measured the same ink in one frame (`#7c809f` against `#7c80a1`)
 *      — so the current row read as a filled search field. Worst on `iceberg`.
 *   2. `border-control` is `docs/branding.md` § 2's *sole visual boundary of an
 *      input, select, checkbox or outlined button*. A nav row is none of those,
 *      and no other role in the system carries a 3:1 structural floor, so a
 *      selection boundary has no role to be drawn in.
 *   3. The operator had already had that same boundary removed from the New
 *      chat row for the read it produces ("which reads as a control at rest",
 *      in that row's own comment), and the app rail marks its active item with
 *      no boundary at all, so a row edge would be this app's third spelling of
 *      "you are here".
 *
 *   4. The second signal is the BAR above, and it is not boundary-shaped: a fill
 *      on the leading edge rather than a box drawn around the row. So the retired
 *      ring is not replaced by a quieter edge — the mark stays a ground, a weight
 *      and a bar.
 *
 * THE ORDERING THE THIRD SIGNAL USED TO CARRY IS NOW A FLOOR. The ink floors
 * still cap the fill — `ink-dim` is drawn INSIDE a current row (the `· lopdev`
 * binding and the key caps) and holds it at 5.0:1 — and that cap used to be the
 * reason the ordering rested on `font-medium`: the hover a neighbouring row
 * carried was a BIGGER step off `surface` than the selection could afford
 * (radient 6.25 and synth 5.44 against marks of 4.01-4.15). The row-state pass
 * retired the pair rather than the cap: `rowHover` is asserted above the old
 * `elevated` step (ΔE00 4.0, against the median 2.45 that had made the operator
 * report it twice as a whisper) and `rowSelected` is asserted 4.0 off `surface`
 * AND 2.0 off `rowHover`, so the order of the two marks is a contract rather than
 * a coincidence of two values that happened to land the right way round. The bar
 * and `font-medium` remain the non-colour half.
 * `scripts/chat-sidebar-selection.test.mjs` resolves each expression through the
 * shipped `cn` for that reason rather than looking for a name.
 *
 * WHY THE HOVER OVERRIDE IS IN THIS STRING. `rowStyle` carries
 * `hover:bg-row-hover`, and a hover variant outranks a bare background in the
 * cascade, so without it every row here replaces its selection ground with the
 * hover ground under the pointer: a state the user is IN would be repainted as
 * the state the pointer is in, and the two row roles are both STEPS OFF `surface`
 * rather than opposites — in the dark palettes both sit above it, and on the
 * light family both sit below it — so the two would be read as one ramp with the
 * pointer at the top. Stating the ground again at
 * `hover:` is what stops that, and `cn` is what makes it hold: tailwind-merge
 * resolves the two `hover:bg-*` in favour of the later one, so the inherited
 * step is dropped rather than landing second.
 * `scripts/chat-sidebar-selection.test.mjs` asserts that resolution through the
 * shipped `cn`, and `contrast-contract.mjs` pins this string — a bare
 * `bg-accent-wash` here is invisible in tokyoNight and no palette assertion can
 * see a class.
 *
 * WHY THIS IS EXPORTED, AND WHY THE SINGLE SPELLING LIVES HERE (round 5: design
 * D22, agent A-7). The role has two consumers — this panel and the settings rail
 * — and each of them used to spell the four terms by hand. Two of those copies
 * then drifted a term each (design rounds 3 and 4, D17 and D19), and the frames
 * they produced are the only committed pictures of a row the app does not draw.
 * A text guard over the replicas could only ever watch the copies it knew about:
 * both drifts happened at an ELEMENT (the wrapper painting the retired ground,
 * the button painting half the role) while the copied string above it stayed
 * verbatim. So the copy is gone rather than pinned: the role is declared once,
 * here, and imported by `features/settings/components/settings-sidebar.tsx`, and
 * `scripts/chat-sidebar-selection.test.mjs` asserts that no class literal in the
 * shipped tree spells these terms a second time and resolves the rail's call
 * site through the shipped `cn`, the way it already resolves this panel's.
 *
 * THE THIRD CONSUMER IS GONE (this change, 2026-09-18): the browser mark's story
 * specimen imported this string and was the only surface photographing the role
 * on a row that carries a sibling control. Its evidence set was deleted with the
 * mark, so the two drifts this paragraph exists for can no longer be produced
 * there — a file that is no longer in the tree cannot drift — and the guard the
 * sentence above names now covers the two consumers that remain.
 */
/*
 * One literal, deliberately: this role is the one thing a guard reads out of the
 * tree (`scripts/chat-sidebar-selection.test.mjs` resolves it and every call site
 * through the shipped `cn`), and a literal assembled from parts would be a role a
 * reader of that file cannot get in one piece.
 *
 * THE 2px `accent` BAR IS GONE (row-state refinement, 2026-09-18), and `relative`
 * with it. The bar was the row's non-colour second signal because both fills used
 * to be one hue at two strengths; the refined roles rank the pair on `L*` and on
 * cast, so the fill carries the ranking and `font-medium` is the non-colour half.
 * The bar also squared the row's leading edge (its square overlay painted over
 * `rowStyle`'s `rounded-md`), so removing it is what restores the left rounding
 * the operator asked for - the radius itself never moved. The two POPUP bars
 * (`slash-commands.tsx`, `at-picker.tsx`) stay: their row is the one Enter
 * applies, in a transient popup, and the keyboard has no other mark there.
 *
 * `relative` existed ONLY to be the bar's containing block, so it goes with the
 * bar rather than staying as a stray positioning context on every current row.
 */
export const rowCurrent =
	"bg-row-selected font-medium text-ink hover:bg-row-selected";

/**
 * The DRAGGED row's ground step (issue #697, item 5).
 *
 * WHY A COLOUR AND NOT AN OPACITY OR A LIFT. `project-board.tsx` marks its own
 * dragged column `opacity-85`, and that idiom cannot come here: the branding
 * contract's state marks are ground steps (`rowHover`, `rowSelected`) and a row
 * at 85% opacity paints a translucent copy of its own text over whatever is
 * behind it - a legibility answer chosen by accident rather than a state a theme
 * can tune. Nothing lifts, scales or translates on a gesture either, so the row
 * that is being moved reads as the SAME row, held.
 *
 * `rowSelected` is the rung rather than `rowHover` - the two roles are the two
 * steps the panel's ladder owns, and this one says "this is the row the reader is
 * acting on". `rowHover` would say "the pointer is over this row", which stops
 * being true the moment the pointer moves to the gap the row is heading for,
 * while the drag it belongs to is still running.
 *
 * THE GROUND IS RESTATED AT `hover:` AND THE CONSTANT IS MERGED LAST (design D1 + UX U1,
 * round 1; both halves measured). A bare `bg-row-selected` LOSES to the box's own
 * `hover:bg-row-hover`, and the pointer that armed the drag stays inside the captured row
 * for the whole gesture - Chromium keeps `:hover` on the capture target's ancestors while
 * the button is held - so the dragged row painted exactly the fill a merely hovered row
 * paints (measured `#302D29` dark / `#EDECE7` light, i.e. `--lo-row-hover`, against the
 * intended `#372F24` / `#EBE7D8`). The restatement is `rowCurrent`'s own idiom, and like
 * `rowCurrent` it only works because the box merges it LAST: `cn` is tailwind-merge, so
 * the last class of a group wins, and the box states its plain `hover:bg-row-hover` after
 * the controls - the drag's ground has to come after THAT. The rig now MEASURES the
 * computed colour rather than trusting the frame (`pinned-reorder`'s `ground` readings).
 */
export const rowDragging =
	"bg-row-selected text-ink hover:bg-row-selected hover:text-ink";

/**
 * The HELD row's own mark, and it is deliberately NOT a fill (design round 2, D7 + UX
 * round 2, U6).
 *
 * WHY A FILL COULD NOT CARRY THIS STATE. The first attempt at it gave a held row that is
 * ALSO the current one the `rowHover` ground, and that is exactly the fill the row under
 * the pointer wears: the two are on screen together for the whole gesture (the row boxes
 * are contiguous, so a drag pointer is always over some row), and the held row also LOST
 * the selected fill that says "this is the conversation you are in". Measured in both
 * palettes, same run: held current `rgb(48,45,41)` light `rgb(237,236,231)` - the hover
 * role - against the drop target's own hover ground, one reading for two rows.
 *
 * WHY A MARK AND NOT A THIRD ROW ROLE. The panel's ladder has two row steps and
 * `rowSelected` is spoken for by the current row, so a third step would have to be
 * authored against the palette's own floors (`docs/branding.md` sec. 3) for a state that is
 * transient by definition. The mark carries ONLY the fact that this row is held: it does
 * not restate what the row's role already says, and it reads the `ink-dim` role, so each
 * palette resolves it from its own value.
 *
 * WHY AN OUTLINE AND NOT AN INSET RING (design round 3, D10, measured on the frames). The
 * mark began as `ring-1 ring-inset ring-ink-dim`, a box-shadow on the row's box, and it
 * does not render there: the CURRENT row's own button carries `rowCurrent`'s opaque
 * `bg-row-selected` and is a CHILD of that box, so the child's fill paints over the
 * parent's inset shadow everywhere the button reaches. The coverage is measured as the ink
 * within ±6 per channel of the mark's colour inside the outermost 3 device px of the held
 * row's box, and there is ONE set of these numbers (design round 4, D13): **60.2%** of that
 * band on a held row that is not current (a complete outline), **5.3%** on the held current
 * row before this change - a fragment along the right edge, i.e. the one state round 2's D7
 * was filed about rendered the mark it was fixed with almost nowhere - and **32.1%** after
 * it, in both palettes, which is three of the row's four edges (the top one carries the drop
 * indicator). An OUTLINE is painted after the element's descendants, so it is not covered by
 * the button's fill; `-1px` of `outline-offset` keeps it INSIDE the row's `rounded-md` box,
 * so there is no layout shift and it is not ink that hangs outside the box (the clipping
 * constraint `docs/branding.md` states).
 *
 * The ground underneath is the row's own role and does not change: `rowDragging` while
 * the row is not the current one, `rowCurrent` while it is.
 */
export const rowDraggingMark =
	"outline outline-1 outline-offset-[-1px] outline-ink-dim";

import {
	type FocusedSlot,
	holdFocusedRow,
	refreshFocusedInside,
} from "../sidebar-focus-hold";

import {
	ChatAsksOutstanding,
	ChatSessionStatus,
	SubagentRunningMark,
} from "./chat-session-status";

/**
 * How often the catalogue polls when the machine-wide feed is NOT available.
 *
 * Unchanged from what shipped, and it has to stay that way: this is the branch
 * an older backend takes, and the whole point of the capability gate is that a
 * backend without `desktop_feed` behaves exactly as it did before this app
 * learned about one.
 */
const LEGACY_CATALOGUE_POLL_MS = 5_000;

/**
 * Drift insurance for the event-driven path, not a poll.
 *
 * The `catalogue` frame is the mechanism; this is what bounds the damage if one
 * is ever missed. 30 s is chosen against the thing it replaces: it is six times
 * cheaper than the 5 s scan of every transcript tail, and slow enough that the
 * event is unambiguously doing the work when the two disagree.
 */
const CATALOGUE_SAFETY_POLL_MS = 30_000;

/**
 * The DOM id joining the `Include archived` checkbox to its label.
 *
 * A constant rather than an inline string because the two elements carry it in
 * two places, and a label whose `for` names an id no input has is an accessible
 * name that silently disappears - the control would then be a bare box beside
 * the word "Include archived" rather than a checkbox called that.
 */
const INCLUDE_ARCHIVED_ID = "chat-search-include-archived";
/**
 * THE REMEDY FOR A ROW THAT IS NOT ANSWERING, appended to its own sentence.
 *
 * A wedged row asks something different of a reader than a failed or a working
 * one — a session whose owner has stopped reporting is one to STOP, not one to
 * reopen, and the operator's report said so in one breath with the mark — and
 * the row is where their attention already is, so the hint belongs here rather
 * than only in `/info` two steps away.
 *
 * THE REMEDY IS CLIENT-OWNED AND THE STATE'S WORDS ARE NOT, which is the whole
 * division: `row.status.label` comes off the wire and is read, never re-written
 * (the contract forbids a client deriving status — `SessionCatalogueRow.status`
 * in `desktop-session-contract.ts`), while `/stop` is an affordance only this
 * client has. That is not drift: drift would be two spellings of the STATE.
 *
 * ONLY ON `wedged`, deliberately: an `error` row is one to reopen and a busy row
 * one to wait for, so a remedy printed on each of them would be advice about the
 * wrong state.
 *
 * TWO CHANNELS, AND THE HOVER ONE IS NOT ENOUGH ON ITS OWN (UX round 1, U2, with
 * review round 1's MINOR 1). This used to justify the pointer-only placement
 * with "a clause a reader hears on every arrow-key stop through the list" — which
 * is false as written, because the clause is appended on `wedged` rows alone: a
 * reader walking the list hears it once, on the one row it is about. What
 * replaced the claim is a measurement — over the whole document `title` was the
 * ONLY carrier of the clause, no accessible name held it, no row pointed at it
 * with `aria-describedby`, and Chromium does not present `title` on focus — so
 * for the modality this file already renders an `sr-only` name for, the remedy
 * did not exist at all. It now rides BOTH channels: the tooltip for a pointer,
 * and `aria-describedby` (the row's, below) for a reader who reaches the row by
 * keyboard, which announces the clause on focus WITHOUT putting it in the name —
 * the name still carries the state's sentence and nothing else, which is design
 * D2's call and still holds.
 *
 * ONE HOME FOR THE WORDS. The constant is the clause alone and the tooltip's own
 * expression adds the separator, rather than a second copy of the sentence in a
 * form only a tooltip can use: a description is announced straight after the
 * name, where a leading " · " would be read as a separator that is already
 * implied.
 */
const SILENT_REMEDY = "/stop if it stays silent.";

/**
 * The id of a row's remedy sentence, WHEN that row renders one.
 *
 * Derived from the session id rather than from a `useId()` call because the rows
 * are built by a plain render function (`sessionRow`), where a hook would run a
 * different number of times per render. Rows are keyed by this id, so it is
 * unique in the document by construction.
 */
const silentRemedyId = (sessionId: string) => `chat-row-remedy-${sessionId}`;

/**
 * The id of a row's receipt clause, WHEN that row renders one.
 *
 * A SECOND id rather than one shared with the remedy above, because the two are
 * about two different facts and a row can carry either, both, or neither: the
 * remedy is the session's state and the clause is the app's own attempt to
 * receipt it. `aria-describedby` takes a list, so a row that has both has both
 * announced, in the order it states them.
 *
 * Derived from the session id for `silentRemedyId`'s reason: the rows are built
 * by a plain render function, where a hook cannot run.
 */
const readAckClauseId = (sessionId: string) => `chat-row-read-ack-${sessionId}`;

/**
 * WHICH CHORD SPELLING A MENU PRINTS, as `chatRowActCapJoined`'s `isMac`.
 *
 * A function rather than a module constant, the shape `thread-search-overlay.tsx`
 * established for the same read: this module is bundled by node in several
 * harnesses, and a top-level `navigator` access runs in whatever global those
 * processes happen to have (or none). The read only happens when a row renders.
 */
const menuIsMac = (): boolean =>
	navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/**
 * Clears the sidebar's open-menu id when the row INSTANCE that could hold it
 * leaves the tree (UX round 1, U1).
 *
 * WHY AN INSTANCE, NOT THE MENU'S DOM. Radix's context-menu root does nothing
 * on unmount (`@radix-ui/react-context-menu@2.3.7`, `dist/index.mjs:20-53`),
 * so the user-facing close paths - Escape, outside press, item select - were
 * the only writers of `null`: a row that left the tree with its menu open
 * (re-filed between containers on the same order key, dropped by a page or
 * doorbell update, archived in another window) left the id naming a row that
 * no longer renders - and the list's keydown stood down for the rest of the
 * session, arrow-walk and Home/End and the two chords and type-to-filter all
 * dead until some row's menu was opened and closed again.
 *
 * The clear is attached to the row's own life, so it happens in the commit
 * that removes the row - and it can be EXACT, because "the id names me" is a
 * fact about this instance. A sidebar-level check of the panel's DOM was
 * measured wrong in both directions before this shipped (scratch CDP probe,
 * round 1): Radix's `Presence` mounts the panel a render AFTER the open
 * commit, so the id is briefly set with no panel in the document - a false
 * "the menu is gone" a DOM check reads as death - and a sidebar `useEffect`
 * only runs when the SIDEBAR re-renders, so whether it ever sees the panel
 * while it is up (the fact that tells "still opening" apart from "gone") is a
 * property of what else happens to re-render.
 *
 * `openMenuRowIdRef` is the sidebar's latest value: a cleanup runs with what
 * its own closure saw last, and the row that is leaving does not re-render
 * first. The keyboard flag is cleared on the same path, so a menu that is
 * later opened by the POINTER cannot inherit this one's keyboard focus rules.
 */
const RowMenuOwner: FC<{
	id: string;
	openMenuRowIdRef: MutableRefObject<string | null>;
	setOpenMenuRowId: Dispatch<SetStateAction<string | null>>;
	openedByKeyboard: MutableRefObject<boolean>;
}> = ({ id, openMenuRowIdRef, setOpenMenuRowId, openedByKeyboard }) => {
	useEffect(
		() => () => {
			if (openMenuRowIdRef.current !== id) return;
			setOpenMenuRowId(null);
			openedByKeyboard.current = false;
		},
		[id, openMenuRowIdRef, setOpenMenuRowId, openedByKeyboard],
	);
	return null;
};

/**
 * THE MENU'S OWN SENTENCE (U-D5): the row's box is a context-menu trigger and
 * carries no `aria-haspopup` - the primitive writes only `data-state` and
 * `data-disabled` on it - so without a clause a screen reader walking the list
 * hears a title, a status and possibly a remedy, and nothing about the menu
 * that is the whole point of the change. It rides the channel this row already
 * uses for its remedies: an `sr-only` span beside the row's button, pointed at
 * by that button's `aria-describedby` (the box is not focusable; the button is
 * the row's only focusable element, so the association lives there).
 *
 * It names the menu and how to open it, and deliberately NOT the chords: those
 * are printed inside the menu and stay in each item's accessible name, where
 * the acts are; repeating them in the row's description would be a second
 * telling of the same fact.
 *
 * AND THE SPELLING IS THE PLATFORM'S (UX round 1, U2), AS A PARENTHETICAL
 * (UX round 2, U9). The clause is announced on every row, and on a
 * macOS-first app that announcement cannot hand every reader `Shift+F10`
 * unqualified: an Apple keyboard has no Menu key and sends F10 as a media key
 * unless `Fn` is held - but "press `Fn+Shift+F10`" is itself exact only in
 * the DEFAULT media-key mode: with "Use F1, F2, etc. keys as standard
 * function keys" ON, `Fn` sends the special key instead and the advised
 * chord would do nothing. The parenthetical holds in both modes and names
 * the same device `chat-regions.ts` uses for the region walk's second
 * spelling ("on macOS `F6` is a media key on most keyboards unless the user
 * has turned that off"). `menuIsMac()` is read when a row renders, which is
 * why this is a function over that read rather than a module constant.
 */
const rowMenuClause = (isMac: boolean): string =>
	isMac
		? "Right-click or press Shift+F10 (with Fn on most Mac keyboards) for its actions."
		: "Right-click or press Shift+F10 for its actions.";
const rowMenuClauseId = (sessionId: string) => `chat-row-menu-${sessionId}`;

/**
 * Press the row's own control for an act, from the row's context menu.
 *
 * THE MENU DOES NOT REIMPLEMENT THE WRITE. Both controls carry guards that
 * make a repeated press safe - the pin's `dropRepeatPress` and the archive's
 * `archivePressOutcome`, which read `event.detail === 0` as "this came from
 * the keyboard and always acts on the row it was invoked on" - and a menu item
 * must take the same path a press makes on the control itself, guards
 * included. `.click()` is that path (the chord in `keyDown` presses the
 * control the same way), so the guards, the move correction and the
 * `aria-pressed` state all arrive unchanged. The row is found by id because the
 * menu is portalled: its items are not DOM descendants of the row they act on.
 */
const pressRowAct = (sessionId: string, act: ChatRowAct) => {
	document
		.querySelector<HTMLElement>(`[data-session-row="${CSS.escape(sessionId)}"]`)
		?.querySelector<HTMLElement>(`[${CHAT_ROW_ACT_ATTR[act]}]`)
		?.click();
};

/*
 * The words this sentence uses for a count of at most six; digits beyond that,
 * because "Eleven built-in agents" is a figure the eye has to translate back.
 */
const BUILTIN_COUNT_WORDS = [
	"No",
	"One",
	"Two",
	"Three",
	"Four",
	"Five",
	"Six",
];

/**
 * The sentence that offers the built-ins, built from the names actually offered.
 *
 * It replaced copy that named activities rather than roles — "roles for coding,
 * review, design, research and coordination" — with no count at all: "research"
 * is not among the packaged profiles, architecture and testing went unnamed, and
 * the number only appeared once the batch had started ("Installing 1 of 6"), so
 * the sentence that sets the expectation for the whole flow was wrong about
 * both what is on offer and how much of it there is (UX round 1, U6). Derived
 * from the rows the backend sent rather than written by hand, because the
 * catalogue is the authority on what can be installed and a second list here
 * can disagree with it.
 */
const builtinOfferSentence = (
	builtins: readonly { name: string }[],
): string => {
	const names = builtins.map((builtin) => builtin.name);
	const count = BUILTIN_COUNT_WORDS[names.length] ?? String(names.length);
	const plural = names.length === 1 ? "agent" : "agents";
	const verb = names.length === 1 ? "is" : "are";
	const list =
		names.length === 1
			? names[0]
			: `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
	return `${count} built-in ${plural} ${verb} ready to install — ${list}. You can edit ${
		names.length === 1 ? "it" : "them"
	} once installed.`;
};

/**
 * How far the row's flyout is kept from the window's edges, in px.
 *
 * Named rather than inlined because the number is a measured one: at the list's last
 * row the flyout's un-padded box was 806..868.2 against an 868px viewport, i.e. flush
 * with the window's bottom edge and painting over the composer's attachment control
 * (design round 1, D4). Radix's `collisionPadding` is the clamp; 8px is the design
 * contract's own step, and it leaves the flyout wholly inside the window.
 */
const FLYOUT_COLLISION_PADDING = 8;

export function ChatSidebar({
	selectedConversation,
	onSelectConversation,
	onStageDraft,
}: Props) {
	const navigate = useNavigate();
	const location = useLocation();
	const requestPanel = usePanelPresentationStore((state) => state.requestPanel);
	const capabilities = useDesktopCapabilities();
	const feed = useDesktopFeed();
	/*
	 * THE PER-CONVERSATION ASK COUNTS (operator ask, 2026-10-04).
	 *
	 * THE READ IS THE FLEET AGGREGATE, not each row's own `asks_open`, and that is
	 * a correction rather than a preference: `SessionCatalogueRow.asks_open` is
	 * declared in the contract but the desktop catalogue route never fills it (the
	 * backend's own row model has no such field) - so a row mark sourced from the
	 * row draws NOTHING on every desktop install. That is exactly the operator's
	 * report: the session's sidebar row showed nothing while the composer chip
	 * beside it read "1 question waiting", and he only knew because a notification
	 * fired. The aggregate is uncapped and covers every conversation, so it is the
	 * one source that can mark a row the user is not looking at.
	 *
	 * ONE READ, TWO LENSES: this is the same `FLEET_ASKS_QUERY_KEY` entry the header's
	 * fleet-scope asks trigger already reads, so a row and the top-level count cannot
	 * disagree about how many asks are outstanding, and this adds no second poll.
	 * `rows === null` is "the route has not answered" rather than "no asks", which
	 * is why the map is null rather than empty there - a row keeps whatever its own
	 * field says in that state, and on a backend that predates the aggregate route
	 * that is nothing at all, which is the honest answer.
	 */
	const fleetAsks = useFleetAsks();
	const asksBySession = useMemo(
		() => (fleetAsks.rows === null ? null : fleetAsksBySession(fleetAsks.rows)),
		[fleetAsks.rows],
	);
	/*
	 * The two store fields the gate reads are subscribed BEFORE it, which is the only
	 * reason this sits above hooks it is unrelated to: `lastKnownRows` is a statement
	 * about what is on screen and `storeFailed` is a statement about the store's own
	 * read, so the gate cannot decide either without the store. Nothing here is
	 * conditional, so the order is a readability choice rather than a hooks rule.
	 */
	const sessions = useCanonicalSessionsStore((s) => s.sessions);
	const error = useCanonicalSessionsStore((s) => s.error);
	/*
	 * The TRI-STATE, because the gate owes two different sentences and can only pick
	 * between them if it is told which half closed: an unavailable plane is a pairing
	 * condition this app can act on, while a backend that does not advertise
	 * `session_catalogue` is a version gap (design § 4).
	 */
	const catalogueState = desktopFeatureState(
		capabilities.data,
		"session_catalogue",
		2,
	);
	const ready = catalogueState === "enabled";
	/*
	 * THE REMOTE ROW'S TWO READING AIDS, gated and fetched exactly as the rail's
	 * are: `meshPaired` is the capability (`features.peers`), and the networks
	 * read is the cheap one (`poll: false`, one read per window, shared with the
	 * rail and the device control by query key). The map is built once per answer
	 * rather than per row - the list is a hot path and the lookup is not.
	 */
	const meshPaired =
		desktopFeatureState(capabilities.data, "peers") === "enabled";
	const meshNetworks = useMeshNetworks(meshPaired, { poll: false });
	const remoteNetworkNames = useMemo(
		() => deviceNetworkNames(meshNetworks.data),
		[meshNetworks.data],
	);
	/*
	 * Main's pairing cause, read for the same reason the pane reads it: the sentence
	 * for an unavailable plane comes from the one shared table, selected by the cause
	 * main published (design § 5.2, § 11.1).
	 */
	const { data: serverHealth } = useServerHealth();
	/*
	 * WHETHER THE STRIP OWNS THE CONNECTION VOICE RIGHT NOW (agent review round 2,
	 * R11), and why this needs two terms. The strip lives in the conversation pane,
	 * so it is mounted on the chat routes only, while this sidebar is mounted on
	 * every route - a stand-down keyed to the copy condition alone
	 * (`serverHealth?.online === false`) therefore made every NON-chat route go
	 * silent about a dead server with no second voice to take over. `stripPresent`
	 * is the strip's own publication (`chat-status-presence.ts`), so the gate is
	 * "the strip is on screen AND unreachability is the reason", which can only be
	 * true where a voice remains; where the strip is not mounted this stays false
	 * and the sidebar keeps speaking. The three sites below read THIS const, so
	 * the paragraphs and the foot line cannot drift about when to stand down.
	 */
	const stripSpeaksConnection = useStripSpeaksConnection(
		serverHealth?.online === false,
	);
	const pairingCause =
		serverHealth?.snapshot && !serverHealth.snapshot.pairing.available
			? (serverHealth.snapshot.pairing.cause ?? "unpaired")
			: null;
	/*
	 * THE BANNER'S OWN CONDITION, read once through the banner's own predicate
	 * (design round 1's D3; QA round 1's Q-1): the gate's withdrawn notice has
	 * carried it since D3, and the capability-error paragraph below stands down to
	 * it too - QA's successor walk, where the strip is deliberately silent for the
	 * cause and the pane's own refusal sentence had no other stand-down left, so
	 * one incident was stated twice within a screen.
	 */
	const coveredByCompatibilityBanner = compatibilityBannerShown(
		capabilities.data,
		pairingCause,
	);
	/*
	 * Losing the backend mid-session must not look like an empty catalogue, and
	 * neither must losing the GATE. Once the sidebar has been ready we keep its
	 * structure and last-known rows mounted through a capability error or a
	 * capability answer that withdraws the catalogue, marked stale, instead of
	 * replacing the whole list with a bare paragraph the user cannot act on. The
	 * decision itself lives in `sidebar-catalogue-gate.ts` so that it is driven by
	 * tests rather than by this file's source text; that module's docstring carries
	 * the report it answers and why the withdrawn case is not the error case.
	 */
	const searchRef = useRef<HTMLInputElement>(null);
	/*
	 * Whether this backend can hold pins at all, read from the same capability
	 * answer the catalogue gate above uses rather than from a second negotiation.
	 *
	 * FAIL-CLOSED MEANS NO AFFORDANCE, not a disabled one: absent `session_pins`
	 * this is false, `pinnedRows` returns nothing, the section renders no heading
	 * and the row mounts no pin slot - so the panel's DOM and class set are
	 * byte-identical to the one that never knew about pins. A disabled pin would
	 * be worse than an absent one, because the row's other 24px control slot is
	 * right there and the user would read pinning as a feature they have not
	 * unlocked, while a permanently reserved empty slot costs every row width to
	 * advertise nothing.
	 */
	const pinsEnabled = desktopFeatureEnabled(capabilities.data, "session_pins");
	/*
	 * Whether this backend can SCOPE, PAGE and COUNT the catalogue
	 * (`session_catalogue_page` - the request's `scope_kind`/`scope_name`/`cursor`/
	 * `with_counts`, the answer's `next_cursor`/`counts`).
	 *
	 * FALSE IS TODAY, EXACTLY, AND THAT IS THE POINT OF A SEPARATE KEY. Every group
	 * below expands client-side over the rows the panel holds, the badge counts
	 * those rows, and the panel makes the one unscoped `limit=500` read it has
	 * always made - so an older daemon renders byte-identically to the app that
	 * never heard of paging, and the withdrawn pair is comparable rather than merely
	 * similar. Gate the PAGE SIZE and every paging call on this one boolean at the
	 * call site rather than reading it inside each decision, so "is this backend
	 * pageable" has one answer in this component.
	 */
	const pageable = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue_page",
	);
	/*
	 * PUBLISHED, so an UNNAMED catalogue read sizes itself the same way this panel does
	 * (round 3, QA's Q-1): `chat-page.tsx` refreshes the catalogue when the open
	 * conversation's marker moves and names no size, and the store's default was the
	 * legacy `limit=500` read on every daemon. The store holds the flag rather than reading
	 * the capability itself, because it is the module every desktop suite bundles - see
	 * `cataloguePageDefault`.
	 */
	const setCataloguePageable = useCanonicalSessionsStore(
		(store) => store.setCataloguePageable,
	);
	useEffect(() => {
		setCataloguePageable(pageable);
	}, [pageable, setCataloguePageable]);
	/*
	 * The paged catalogue's own state, subscribed HERE rather than in the group
	 * renderer because a subscription is a hook and the group is a plain function
	 * called from the render body - the same reason `sessions` above is a hook.
	 */
	const catalogueScopes = useCanonicalSessionsStore((s) => s.scopes);
	const catalogueHead = useCanonicalSessionsStore((s) => s.head);
	const catalogueCounts = useCanonicalSessionsStore((s) => s.counts);
	const fetchScopePage = useCanonicalSessionsStore((s) => s.fetchScopePage);
	const clearCatalogueScope = useCanonicalSessionsStore((s) => s.clearScope);
	const fetchCatalogueTail = useCanonicalSessionsStore(
		(s) => s.fetchCatalogueTail,
	);
	/*
	 * THE FLAT LIST'S REFUSED RETRY, and where focus goes after a press (round 4, U14).
	 *
	 * Its Retry is the one control in this panel whose press can fail IDENTICALLY: the
	 * request goes out again, the same refusal comes back, and the elements the reader was
	 * on are repainted from scratch - `<body>` was where focus ended up, with no new
	 * announcement, which is the same defect family as U2 on the group's Show more.
	 *
	 * The ref is a PENDING PRESS rather than a target, because the button that was pressed
	 * is unmounted while the answer is in flight: the effect below resolves the NEW button
	 * by the class this file gives it, once the state has settled back to a refusal, and
	 * focuses that. The re-announcement comes free from the live region the refusal already
	 * lives in: the text walks sentence -> "Loading more chats…" -> sentence, and a change
	 * is what a polite region announces.
	 */
	const tailRefusalRetryRef = useRef<HTMLButtonElement | null>(null);
	const tailRetryPendingRef = useRef<{
		deadline: number;
		cursor: string | null;
	} | null>(null);
	const pinFailure = useCanonicalSessionsStore((s) => s.pinFailure);
	/*
	 * The client's own pin state for conversations this panel's page does not carry
	 * (the store's `pinFacts`). A row synthesized from a search hit is rebuilt from
	 * the cached answer on every render, so without this the row reports the state
	 * the search last saw and its control cannot invert its own press (Qr2-1).
	 */
	const pinFacts = useCanonicalSessionsStore((s) => s.pinFacts);
	/*
	 * The pure search module takes plain booleans: the stamp that orders a fact against
	 * an answer is the store's business, and a row only needs what to draw.
	 */
	const pinFactValues = useMemo(() => {
		const values: Record<string, boolean> = {};
		for (const [id, fact] of Object.entries(pinFacts)) values[id] = fact.pinned;
		return values;
	}, [pinFacts]);
	const setSessionPin = useCanonicalSessionsStore((s) => s.setSessionPin);
	const wasReady = useRef(false);
	if (ready) wasReady.current = true;
	const { stale, showList, notice } = catalogueGate({
		state: catalogueState,
		cause: pairingCause,
		failed: Boolean(capabilities.error),
		answered: Boolean(capabilities.data),
		wasReady: wasReady.current,
		// Read here rather than inside the module: the gate is a decision, and the
		// store is a subscription.
		rows: sessions.length,
		storeFailed: Boolean(error),
		// The banner's own condition, read through the same predicate it uses, so
		// the two cannot drift into stating one condition twice (design round 1, D3).
		coveredByCompatibilityBanner,
	});
	const profiles = useProfiles(
		ready && desktopFeatureEnabled(capabilities.data, "profile_catalogue"),
	);
	/*
	 * The catalogue lists packaged profiles beside the user's own, which is why
	 * this section used to read as "agents you have" while showing six the user
	 * had never installed. Two lists, one question each: what the user holds, and
	 * what is still available to install.
	 */
	const ownAgents = (profiles.data ?? []).filter(
		(profile) => profile.source !== "builtin",
	);
	const availableBuiltins = (profiles.data ?? []).filter(
		(profile) => profile.source === "builtin",
	);
	/*
	 * Which of the agents section's two states is on screen. Named once because
	 * the section below reads it in more than one place and they have to agree:
	 * the empty state is also what makes the batch's control a primary button
	 * rather than the quiet row. See the section itself for why one reading
	 * matters (QA round 1, Q1).
	 */
	const agentsEmpty = !profiles.isLoading && ownAgents.length === 0;
	/*
	 * THE BUILT-INS OFFER'S OWN STATE, one screen up from the section that draws
	 * it, because two of these facts are also what the batch below reports into.
	 *
	 * The dismissal is keyed on the offer's SIGNATURE rather than stored as a
	 * boolean (`features/agents/builtin-offer.ts` derives it and holds the
	 * read-side guard): dismissing is a statement about the CURRENT state — the
	 * precedent `chat-status.ts` states for the connection strip's pill — so a
	 * catalogue that gains a built-in re-arms the offer, while the same
	 * catalogue stays dismissed across restarts. Read through the module rather
	 * than trusted from the store, because `localStorage` is not the setter's
	 * path out (`parseSidebarView`'s rule, one field over).
	 */
	const dismissedBuiltinOffer = useUiPreferencesStore(
		(state) => state.dismissedBuiltinOfferSignature,
	);
	const dismissBuiltinOffer = useUiPreferencesStore(
		(state) => state.dismissBuiltinOffer,
	);
	const offerSignature = builtinOfferSignature(availableBuiltins);
	const offerDismissed = builtinOfferDismissed(
		dismissedBuiltinOffer,
		offerSignature,
	);
	/*
	 * The two readings the section's JSX takes from the facts above:
	 *
	 *  - `builtinOfferOnScreen` — the empty state, something to offer, and not
	 *    already dismissed: the condition the dismiss control rides, with the
	 *    batch's busy flag on top of it.
	 *  - `emptyBlockDismissed` — the same offer, dismissed: the whole empty-state
	 *    block leaves the section, which is what the reader's press asked for.
	 */
	const builtinOfferOnScreen =
		agentsEmpty && availableBuiltins.length > 0 && !offerDismissed;
	const emptyBlockDismissed =
		agentsEmpty && availableBuiltins.length > 0 && offerDismissed;
	/*
	 * Whether the batch below is mid-flight or still holding its summary up.
	 * Reported by `InstallBuiltinAgents` rather than derived here, because THAT
	 * component owns the two states — and the dismiss control must not exist
	 * while this is true, so a press can never take the progress or the summary
	 * off screen (the protection QA round 1's Q1 and UX round 2's U11 are about).
	 */
	const [agentsOfferBusy, setAgentsOfferBusy] = useState(false);
	/*
	 * WHERE THE CARET GOES WHEN THE READER DISMISSES THE OFFER: the create row,
	 * because it is the control that SURVIVES the dismissal — a focused element
	 * that unmounts drops focus to `<body>` and the next Tab would restart at
	 * the top of the window (U10's rule, one surface over: `install-builtin-agents.tsx`
	 * hands focus back to the action that survives `Done`). The flag is set at
	 * the PRESS rather than inferred from the block leaving, because the block
	 * can also leave for reasons nobody pressed, and the move is only owed to
	 * the reader who asked for it.
	 */
	const offerDismissedByPressRef = useRef(false);
	const createAgentRowRef = useRef<HTMLButtonElement>(null);
	/*
	 * Read AFTER the re-render that hides the block — the commit that unmounts
	 * the pressed control — which is the shape and the reason U10's focus move
	 * has: the reader sees one commit leave, and the caret is already where the
	 * next Tab or type should start.
	 */
	useEffect(() => {
		if (!offerDismissedByPressRef.current || builtinOfferOnScreen) return;
		offerDismissedByPressRef.current = false;
		createAgentRowRef.current?.focus();
	}, [builtinOfferOnScreen]);
	const teams = useTeams(
		ready && desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
	/*
	 * THE TEAM LABEL LOOKUP, built from the catalogue this component already
	 * fetches and read by every surface that carries only a binding's SLUG: the
	 * session rows' `· <team>` slot, the row flyout's binding clause, and the
	 * Teams section's own entity rows. A slug the catalogue cannot resolve - the
	 * gate is off, the list is still landing, the team was deleted - reads as
	 * the slug itself, which is exactly the pixels those surfaces drew before
	 * labels existed, so nothing here can blank a name.
	 *
	 * Both halves of this file's label work live here rather than beside their
	 * consumers: the sidebar owns the catalogue read, so the map it builds is the
	 * ONE resolution every surface in the tree reads - which is what keeps a
	 * session row, the header and the Projects surfaces from disagreeing about
	 * the same team (the fold that merged #721's hub marks kept both blocks:
	 * they are additive, each with its own `useMemo`/hook, and neither depends
	 * on the other's order).
	 */
	const teamLabels = useMemo(
		() =>
			new Map(
				(teams.data ?? []).map((row) => [row.name, teamDisplayName(row)]),
			),
		[teams.data],
	);
	/** A team slug as a person reads it: its label, or the slug itself. */
	const teamLabelFor = useMemo(
		() => (name: string) => teamLabels.get(name) ?? name,
		[teamLabels],
	);
	/*
	 * THE HUB'S UPDATE MARKS (design B6). One store read, polled at 60 s, gated on
	 * its own capability so a backend that predates it is never asked. The marks
	 * are drawn by `entity` below and the per-section strip by `hubStrip`; both
	 * read this one snapshot, so a row and its section can never disagree.
	 */
	const hubUpdates = useHubUpdates(
		ready && desktopFeatureEnabled(capabilities.data, "hub_updates"),
	);
	const hubItems = hubItemIndex(hubUpdates.data);
	const hub = useHubActions();
	// Whether the backend tracks any hub-linked item at all: the check control is
	// drawn only for a user the hub concerns, so everyone else pays nothing.
	const hubTracked =
		(hubUpdates.data?.items.length ?? 0) > 0 ||
		Object.values(hubUpdates.data?.counts ?? {}).some((count) => count > 0);
	const fetchSessions = useCanonicalSessionsStore((s) => s.fetchSessions);
	const loading = useCanonicalSessionsStore((s) => s.loading);
	const truncated = useCanonicalSessionsStore((s) => s.truncated);
	// The daemon's own marker for reads it could not answer. Empty for any daemon
	// that predates it, which is what keeps this additive.
	const statusUnavailable = useCanonicalSessionsStore(
		(s) => s.statusUnavailable,
	);
	const livenessUnread = statusUnavailable.includes("liveness");
	const activeDraftKey = useCanonicalSessionsStore((s) => s.activeDraftKey);
	const drafts = useCanonicalSessionsStore((s) => s.drafts);
	const openDraft = useCanonicalSessionsStore((s) => s.openDraft);
	const discardDraft = useCanonicalSessionsStore((s) => s.discardDraft);
	const discardDrafts = useCanonicalSessionsStore((s) => s.discardDrafts);
	/**
	 * The other half of a draft's identity: the composer's own words.
	 *
	 * A draft ROW carries who the conversation is addressed to and which request ids
	 * its send will use; the text the user typed lives in `conversation-input-store`,
	 * keyed by the same pane identity. The `Draft:` rows read both, because a row that
	 * listed a draft without its first line would name nothing the reader could
	 * recognise (UX round 2, U8).
	 */
	const inputByConversation = useConversationInputStore(
		(s) => s.inputByConversation,
	);
	const markAllRead = useCanonicalSessionsStore((s) => s.markAllRead);
	/*
	 * THE PER-ROW RECEIPT'S OWN STATE, and the announcement it owes the reader.
	 *
	 * The loop that writes it lives in the transcript (`useCompletionView`) because
	 * that is where the rendered result is; THIS is the surface that can draw it,
	 * because the mark the operator is waiting on is on a row. One record names one
	 * conversation - a receipt waits on one at a time - and the rows ask it whether
	 * it is theirs (`readAckCopy`, in `../read-ack-notice.ts` with the words).
	 */
	const readAckNotice = useCanonicalSessionsStore((s) => s.readAckNotice);
	/**
	 * The last notice this window has announced.
	 *
	 * SEEDED WITH WHATEVER IS ALREADY PUBLISHED, so a remount does not re-announce a
	 * receipt the reader has been told about: the panel is remounted by the region
	 * controls, and a toast reappearing for an old refusal is worse than the
	 * silence this change exists to remove. Keyed on the notice's own revision
	 * rather than on its kind, because a SECOND budget for the same conversation is
	 * a new event (`ReadAckNotice.revision` states why it moves).
	 */
	const announcedReadAck = useRef(
		readAckNotice
			? `${readAckNotice.sessionId}:${readAckNotice.revision}`
			: null,
	);
	useEffect(() => {
		const key = readAckNotice
			? `${readAckNotice.sessionId}:${readAckNotice.revision}`
			: null;
		const changed = announcedReadAck.current !== key;
		announcedReadAck.current = key;
		/*
		 * ONE ARM ANNOUNCES ITSELF AND THE OTHERS DO NOT. `unsettled` is the state
		 * the reader is owed a sentence about - the app has stopped retrying promptly
		 * and the mark is still there - and it is the arm the bulk path already says
		 * in this register. `pending` is an in-flight cue, `offscreen` is a remedy
		 * whose move is to look at the row's own clause, and `remote` is the pairing's
		 * own deferral - quiet BY CONSTRUCTION, because nothing is in trouble and
		 * there is no move: it clears when the owning device updates (operator report,
		 * 2026-10-05). A toast for any of the three would be noise where the reader
		 * has the fact already, and the register holds the bulk receipt and the
		 * archive offers too.
		 */
		if (readAckNotice?.kind !== "unsettled") {
			// The fact the sentence stated has gone (the receipt landed, the loop was
			// torn down, another kind replaced it), so the sentence goes with it. By the
			// STABLE id rather than a handle: this instance may not be the one that
			// raised it, and dismissing an id nothing is using is a no-op either way.
			dismissToast(READ_ACK_TOAST_ID);
			return;
		}
		// The same statement seen again is not a second event; a NEW one replaces the
		// sentence on screen rather than stacking a second copy of the same fact.
		if (!changed) return;
		/*
		 * A LONGER LIFE THAN SONNER'S DEFAULT, and it is the refusal's own number
		 * (design round 1, D3). This arm is a sentence plus a remedy the reader has to
		 * read before acting - the same shape as the archive failure's, which is why it
		 * takes that message's number (`ARCHIVE_FAILURE_TOAST_MS`, whose one home is
		 * `archive-undo.ts`): at the default, a two-line sentence was being read in four
		 * seconds, and the reader who pressed the row it names spent that time
		 * watching a fact that had just stopped being true.
		 */
		showWarningToast(readAckNoticeSentence(readAckNotice), {
			id: READ_ACK_TOAST_ID,
			duration: ARCHIVE_FAILURE_TOAST_MS,
		});
	}, [readAckNotice]);
	const [query, setQuery] = useState("");
	/*
	 * THE LIST FILTER IS NOT A SECOND SEARCH AT REST (design round 1, D1). The
	 * sidebar's one visible search is the `Search ⌘P` row above (the palette), and
	 * a bordered `Search chats and agents` field under it was the second search the
	 * round photographed. The filter is KEPT - it is the only surface that can
	 * widen to archived conversations (`Include archived`), so removing it would
	 * strand every archived chat outside the app - but it is drawn only while it
	 * is in use: typing while the list has focus opens it with that character, and
	 * Escape on an empty field closes it again. Type-to-filter is the idiom a
	 * Finder column and a VS Code tree already teach.
	 */
	const [filterOpen, setFilterOpen] = useState(false);
	const filterShown = filterOpen || query.length > 0;
	/*
	 * THE ROSTER'S OWN FILTER (issue #663), state of the AGENTS SECTION and never
	 * of the list: `query` above narrows the whole column through the backend
	 * search, so reusing it here would make filtering agents empty the chats
	 * list beside them - the exact confusion the operator's report is about. Its
	 * field is drawn while the section is expanded and (the roster is cap-bound
	 * OR a filter is applied - `rosterFilterShown` below carries the lifecycle
	 * rule and the bug it closes), cleared by its own control or Escape, and the
	 * rules it feeds live in `chat-sidebar-agents.ts`.
	 */
	const rosterFilterRef = useRef<HTMLInputElement>(null);
	const [rosterFilter, setRosterFilter] = useState("");
	/*
	 * The clock the relative times are read against, ticking once a minute: the
	 * column's finest unit is a minute (`4m`), so a faster tick repaints nothing,
	 * and a slower one lets `now` sit on a row for two minutes.
	 */
	const [listNow, setListNow] = useState(() => Date.now());
	useEffect(() => {
		const timer = window.setInterval(() => setListNow(Date.now()), 60_000);
		return () => window.clearInterval(timer);
	}, []);
	/*
	 * THE COLUMN'S VIEW, from the preferences store (`chat-sidebar-view.ts`
	 * carries the model and the rules). Read through `parseSidebarView` HERE
	 * rather than trusted from the store: `localStorage` is not the setter's
	 * path out, so the module is the one place a tampered value is rejected
	 * and the one place a future field arrives with an answer.
	 */
	const chatSidebarView = useUiPreferencesStore(
		(state) => state.chatSidebarView,
	);
	const setChatSidebarView = useUiPreferencesStore(
		(state) => state.setChatSidebarView,
	);
	/*
	 * THE PALETTE'S TWO WRITES, for the band's `Open agent…` control (issue
	 * #663). Read as separate selectors for the reason every selector in this
	 * component is: the store is wide, and a control that needs two writes
	 * should not subscribe the panel to the rest.
	 */
	const openCommandPalette = useUiPreferencesStore(
		(state) => state.openCommandPalette,
	);
	const setCommandPaletteQuery = useUiPreferencesStore(
		(state) => state.setCommandPaletteQuery,
	);
	const [viewOpen, setViewOpen] = useState(false);
	const [createOpen, setCreateOpen] = useState(false);
	const [expanded, setExpanded] = useState<Record<string, boolean>>(() => {
		try {
			return JSON.parse(
				localStorage.getItem("chat-sidebar-disclosures") ?? "{}",
			);
		} catch {
			return {};
		}
	});
	/*
	 * THE ROW A PIN JUST MOVED, AND WHERE THE READER LEFT IT (QA round 1, U1/U2/U3).
	 *
	 * Pinning moves a conversation out of `Active`/`Previous` and into `Pinned chats`,
	 * which is a change of DOM POSITION, and three things went wrong with it when the
	 * move was left to the browser: the region's scroll was re-anchored (275 -> 319,
	 * with the `Pinned chats` heading 309 px above the visible top), the pointer was
	 * left over a DIFFERENT conversation's row - a second click opens the wrong chat -
	 * and the control holding keyboard focus was unmounted with the row, so the next
	 * Tab started at the top of the panel.
	 *
	 * ONE CORRECTION PER KIND OF PRESS, because the two want opposite things and
	 * pretending otherwise is how the browser's own anchoring got it wrong:
	 *
	 *   - a POINTER press anchors the CONTENT: the row the pointer was next to keeps
	 *     the line it had, so the list does not move under the reader and the pointer
	 *     is left over the vacated slot - not over a neighbour, and not over a control
	 *     that would act on a conversation nobody chose. This is measurable and is
	 *     measured: the neighbour's viewport top is asserted unchanged in the scene.
	 *   - a KEYBOARD press follows the ROW: the caret went to the row's control, so the
	 *     row moving away from the caret is the disorienting part. The correction puts
	 *     it back on its line, or - when that is geometrically impossible, because the
	 *     section it moved into has less content above it than the reader had scrolled,
	 *     measured at scrollTop 334 needing a target of -187 - brings it to the
	 *     region's top edge and hands focus back to the same control on that row.
	 *
	 * `event.detail === 0` is what tells them apart: a click synthesised from Enter or
	 * Space carries no click count, and a real pointer press carries 1.
	 */
	const listPanelRef = useRef<HTMLDivElement | null>(null);
	const movedRef = useRef<{
		id: string;
		top: number;
		follow: boolean;
		anchorId: string | null;
		anchorTop: number;
		/** Where the pointer was at the press, for the wobble slop above. */
		pointer: { x: number; y: number } | null;
		/**
		 * Which control takes the caret back: the row's pin MARK after a pin/unpin (it
		 * keeps the cluster revealed and it is drawn where the row landed), or the row's
		 * own `[data-chat-row]` BUTTON after a MOVE - see the correction below for the
		 * two measurements that decide it (QA round 1, Q1).
		 */
		caret: "pin" | "row";
		/**
		 * Whether the post-commit correction may TOUCH THE SCROLL. False for an
		 * in-section REORDER, both axes of it: the rows swap places, so the anchor row
		 * moves too and correcting against it shifts a scrolled list by a whole row
		 * (agent review round 1, R3), and the moved row is the row the caret is on, so
		 * the row-follow delta would scroll the list for a move that never left the
		 * section.
		 */
		scroll: boolean;
	} | null>(null);
	const rememberMovedRow = (
		sessionId: string,
		follow: boolean,
		pointer: { x: number; y: number } | null,
		caret: "pin" | "row" = "pin",
		scroll = true,
	) => {
		const rows = Array.from(
			listPanelRef.current?.querySelectorAll<HTMLElement>(
				"[data-session-row]",
			) ?? [],
		);
		const index = rows.findIndex(
			(row) => row.getAttribute("data-session-row") === sessionId,
		);
		if (index < 0) {
			movedRef.current = null;
			return;
		}
		// The row the reader can watch: the one below the pressed row, or the one above
		// when it was last. Either is a row the pointer is NOT on, which is the point.
		const neighbour = rows[index + 1] ?? rows[index - 1] ?? null;
		movedRef.current = {
			id: sessionId,
			top: rows[index].getBoundingClientRect().top,
			follow,
			pointer,
			caret,
			scroll,
			anchorId: neighbour?.getAttribute("data-session-row") ?? null,
			anchorTop: neighbour ? neighbour.getBoundingClientRect().top : 0,
		};
	};
	/*
	 * This runs after every render and clears itself; the guard IS the state it waits on. (The
	 * `useExhaustiveDependencies` suppression that stood here became unused once the band's own height
	 * was derived for the yield - that whole calculation has since gone with the lane - and Biome
	 * reports an unused suppression as an error, so the reason stays and the directive goes.)
	 */
	useEffect(() => {
		const moved = movedRef.current;
		const list = listPanelRef.current;
		if (!moved || !list) return;
		const row = list.querySelector<HTMLElement>(
			`[data-session-row="${moved.id}"]`,
		);
		if (!row) {
			// The row is gone entirely (the read removed it): nothing to correct, and the
			// ref must not survive into the next press as a stale anchor.
			movedRef.current = null;
			return;
		}
		if (moved.follow) {
			/*
			 * THE ROW-FOLLOW DELTA IS SKIPPED FOR AN IN-SECTION REORDER (agent review round 1,
			 * R3): it exists for a press that moves the row to another SECTION, where the
			 * correction's job is to bring the reader back to the row they were watching. A
			 * reorder moves the row by one row height inside the section it was already in, so
			 * the same delta scrolls the list by that height for no reason; the ensure-visible
			 * pair below stays, because it is what keeps a row walked to the section's end on
			 * screen (measured on 14 successive chord presses).
			 */
			if (moved.scroll) {
				const delta = row.getBoundingClientRect().top - moved.top;
				if (delta !== 0) list.scrollTop += delta;
			}
			const listBox = list.getBoundingClientRect();
			const rowBox = row.getBoundingClientRect();
			if (rowBox.top < listBox.top) list.scrollTop -= listBox.top - rowBox.top;
			else if (rowBox.bottom > listBox.bottom)
				list.scrollTop += rowBox.bottom - listBox.bottom;
			/*
			 * AND WHICH CONTROL TAKES THE CARET BACK DEPENDS ON WHERE THE ROW WENT (UX report
			 * round 1, U2; measured 2026-09-21 by the `row-space` scene's keyboard walk, which is
			 * the check this line exists for).
			 *
			 * The mark is the right target after a PIN: the row lands in `Pinned chats`, its pin
			 * is drawn there, and focusing it keeps the cluster revealed. It is the WRONG target
			 * after an UNPIN - the mark's box has left the layout (`hidden` until the pointer or
			 * the keyboard is inside the row), and a `display: none` element cannot hold focus,
			 * so this call did nothing at all: the caret fell to `document.body`,
			 * `group-focus-within` went false and the acts the reader was reaching for vanished
			 * with it (the reading was `aria-pressed "false"`, `pairDisplay "none"`,
			 * `focusInsideRow false`, `activeTag "BODY"`). The row's own button is drawn in BOTH
			 * states, so that is where focus goes when the mark is not drawn.
			 *
			 * THE TEST IS THE MARK'S OWN BOX, not its presence: the pin element is in the DOM
			 * either way, and its computed `display` is its own value even inside a hidden
			 * ancestor - the same lesson the scene's geometry reader records for the same reason
			 * (only a box with pixels in it is drawn). The row also re-renders under a DIFFERENT
			 * section parent when it moves, so the hand-back cannot be done at the press on the
			 * old element: the row it belongs to is a new node by this point, which is why the
			 * correction is the mechanism and a `focus()` in the handler is not.
			 *
			 * `preventScroll`, which is the whole reason the correction above survives: a plain
			 * `focus()` scrolls the element into view itself - measured as the region snapping
			 * to 0 and the row landing 202 px above the line it was pressed on. The correction
			 * is this effect's; focus only says where the caret is.
			 */
			const pin = row.querySelector<HTMLElement>("[data-session-pin]");
			const rowButton = row.querySelector<HTMLElement>("[data-chat-row]");
			/*
			 * AND A MOVE HANDS THE CARET BACK TO THE ROW'S OWN BUTTON, NOT TO THE MARK (QA
			 * round 1, Q1, reproduced three times; UX round 1, NIT2). Both reasons were
			 * measured on the live flow, and both are properties of the two controls:
			 * the mark is NOT a ring stop - the arrow walk's stop list is `[data-chat-row]`,
			 * so the walk's current-stop lookup missed and the next bare `↓` restarted at the
			 * panel's FIRST stop, the `Agents` disclosure, taking a keyboard reader out of
			 * `Pinned chats` altogether; and the mark is a TOGGLE, so the most natural next
			 * key - Enter or Space, which opens a chat from a row button - unpinned the row
			 * instead. `moved.caret` is what tells the two corrections apart.
			 */
			const target =
				moved.caret === "row"
					? rowButton
					: pin !== null && pin.getBoundingClientRect().width > 0
						? pin
						: rowButton;
			target?.focus({ preventScroll: true });
		} else if (moved.anchorId !== null && moved.scroll) {
			const anchor = list.querySelector<HTMLElement>(
				`[data-session-row="${moved.anchorId}"]`,
			);
			if (anchor) {
				const delta = anchor.getBoundingClientRect().top - moved.anchorTop;
				if (delta !== 0) list.scrollTop += delta;
			}
		}
		movedRef.current = null;
	});
	/*
	 * A PRESS BELONGS TO THE CONTROL IT WAS MADE ON (QA round 1, U3; UX round 2, U3-unpin).
	 *
	 * A pin press re-orders the panel: the pressed row leaves the list, and the rows below
	 * slide up. The pointer has not moved, so it is now over a DIFFERENT conversation - and
	 * a repeat press there would pin or open a row the reader never pointed at. The first
	 * instrument for this was a disarm: after any press the reveal went inert until the
	 * pointer moved again. It was too blunt, and QA round 2 (Qr2-1) is where that showed:
	 * a reader who pins a row and then presses its glyph again to UNPIN it pressed the SAME
	 * control, at coordinates that had not changed, and the disarm swallowed a gesture that
	 * was exactly what the panel invites.
	 *
	 * So the guard is about identity rather than time or distance: a pointer press that
	 * repeats the previous one without the pointer having gone anywhere - inside the wobble
	 * slop - is dropped WHEN THE CONTROL UNDER THE POINTER IS A DIFFERENT CONVERSATION'S,
	 * and honoured when it is the same one. That is the hazard stated precisely (a row that
	 * merely slid into place is not the row the press meant) without taking the reader's own
	 * control away from them. The keyboard is never involved: Enter or Space carries no
	 * pointer position, so it always acts on the row that has focus.
	 *
	 * The slop is a hand's tremor, not a movement: a few px of wobble is still the same
	 * press. But the tremor test alone made the guard a DISC rather than a gesture (QA
	 * round 3, Qr3-1; UX round 3, U9): pressing the parked point after the pointer had left
	 * and come back was still "a repeat", and the disc outlived the gesture, so a deliberate
	 * later press on a control the reader could see was silently dropped. So the record is
	 * EXPIRED by the pointer's own path - a move further than the slop clears it, and so
	 * does leaving the list - which is what makes the drop describe "the pointer has not
	 * gone anywhere since" rather than "these coordinates were used a moment ago".
	 */
	const lastPinPress = useRef<{
		x: number;
		y: number;
		sessionId: string;
	} | null>(null);
	/*
	 * A hand's tremor, in CSS px. The scene's instrument uses 3 px and the code allows a
	 * little more, so the instrument sits inside the boundary rather than on it; QA round 3
	 * measured the recovery at 8 px, which is the first move that clears this record.
	 */
	const PIN_PRESS_SLOP_PX = 6;

	/**
	 * Whether a pointer press repeats the previous one on a DIFFERENT conversation.
	 *
	 * Called by the pin's own handler before it does anything, and it records the press it is
	 * asked about in the same place - one place, so the record and the decision cannot
	 * disagree about which press was last. `pointer === null` is the keyboard (a click
	 * synthesised from Enter or Space carries no count): it has no position, so it is never
	 * dropped and it records nothing.
	 */
	const dropRepeatPress = (
		pointer: { x: number; y: number } | null,
		sessionId: string,
	) => {
		const last = lastPinPress.current;
		/*
		 * A dropped press does NOT advance the record. The row under a parked pointer is not the
		 * row the gesture was aimed at, and the reader has still not moved: recording the
		 * dropped press would make the NEXT repeat look like the same control's own press and
		 * let the hazard through on the second attempt. Measured, before this line existed: a
		 * 3 px wobble after a press on another row unpinned the row that had slid into place,
		 * which is the exact gesture UX round 2 reported.
		 */
		if (pointer === null) {
			/*
			 * The keyboard carries no position: it always acts on the row that has focus, so it
			 * is never dropped. It also does NOT clear the record (review round 4, item 7): a
			 * keyboard press re-orders the panel exactly as a pointer press does, so the parked
			 * pointer is left over a different conversation by it too - and clearing the record
			 * here disarmed the guard for the next pointer press, which is the one press the
			 * guard exists for. `lastPinPress` describes the last POINTER press, which is the
			 * only kind that has a position, and the path expiry above is what keeps it fresh.
			 */
			return false;
		}
		if (last !== null) {
			const repeated =
				Math.hypot(pointer.x - last.x, pointer.y - last.y) <= PIN_PRESS_SLOP_PX;
			if (repeated && last.sessionId !== sessionId) return true;
		}
		lastPinPress.current = { ...pointer, sessionId };
		return false;
	};
	const isOpen = (key: string, initial = false) => expanded[key] ?? initial;
	/*
	 * Whether the ENTITY groups are drawn from their own scoped pages.
	 *
	 * FALSE WHILE A QUERY IS IN FORCE, for the same reason the command palette
	 * reads the whole catalogue: a search is a question about the STORE, and its
	 * answer (`sessions.search`) is already store-wide. A group drawn under a query
	 * therefore reads the search answer - which is what `children` filters - and
	 * there is nothing for a scope page to add to it. Letting a query through here
	 * would also make typing fetch every group the query forces open, which is the
	 * fetch storm this change exists to remove. The whole paging machinery below is
	 * gated on this one boolean rather than on `pageable` at each call site, so
	 * "searching" cannot be honoured in one place and forgotten in another.
	 */
	const groupPaging = pageable && query.trim().length === 0;
	/*
	 * THE PANEL'S OWN TOTAL, on the paged path (round 1, R2 - the fix U1 and D2 also
	 * name). `sessions.length` is what the client HOLDS - the head page plus whatever
	 * the reader has extended - and `counts.total` is what the daemon counted, so the
	 * sentence says how many of the catalogue are on screen rather than implying a
	 * cap. Null off the paged path, where the withdrawn sentence is the true one.
	 */
	/*
	 * WHAT A SEARCH HIT THE CLIENT DOES NOT HOLD IS BOUND TO, when a loaded group
	 * can say (round 1, Q2). The wire's search answer carries no binding, so a hit
	 * outside the client's rows used to draw without the caption a held row has -
	 * two different-looking rows for one conversation. A loaded scope's id list IS
	 * the client's own knowledge of a binding, so it is the source used here; a hit
	 * no loaded scope names stays captionless rather than guessing.
	 */
	const bindingOfHit = useCallback(
		(id: string): CanonicalSessionRow["binding"] => {
			for (const [key, scope] of Object.entries(catalogueScopes)) {
				if (!scope.ids.includes(id)) continue;
				const [kind, ...rest] = key.split(":");
				const scopeName = rest.join(":");
				return kind === "agent"
					? { agent: scopeName, team: null }
					: { agent: null, team: scopeName };
			}
			return undefined;
		},
		[catalogueScopes],
	);
	const toggle = (key: string, initial = false) => {
		/*
		 * BOTH MAPS MOVE THROUGH ONE TRANSITION (issue #765; agent review round 1's
		 * M1 and m1). `toggleSectionDisclosure` owns the rule and its reasons -
		 * including why a press on a section a LIST QUERY force-draws is NOT a
		 * release - so the transition is executable from
		 * `scripts/chat-sidebar-view.test.mjs` instead of being a condition this
		 * JSX states and no test can reach.
		 *
		 * THE READS ARE HOISTED TO RENDER SCOPE (round 1, n2), where the close edge
		 * used to read the latest disclosure inside a functional update: one pure
		 * call takes both maps, so the disclosure read shares this snapshot. Nothing
		 * calls `toggle` twice in a tick today, so the hoist is inert; the
		 * alternative - a functional update per map - would read the OTHER map at
		 * render scope anyway, which is the same freshness question left accidental
		 * rather than stated.
		 */
		const next = toggleSectionDisclosure(
			expanded,
			sectionCaps,
			key,
			initial,
			Boolean(query),
		);
		setExpanded(next.expanded);
		setSectionCaps(next.caps);
	};
	/*
	 * The bulk read receipt: one control, one gesture, no shortcut.
	 *
	 * An acknowledgement is IRREVERSIBLE — nothing in the store withdraws a
	 * receipt, so a mark this clears cannot be put back — which is why this is an
	 * explicit click and nothing else: no key binding, no blur hook, no "clear on
	 * close" path. The backend's own design records the same rule from the other
	 * end (only the explicit route, the TUI command and this control may call the
	 * batch write).
	 *
	 * Gated on the CAPABILITY, not on a 404: a backend without
	 * `completion_ack_bulk` gets no control at all, because a control that is
	 * clicked and answers "this backend does not support it" has already promised
	 * a mark was cleared. Hidden at zero, on this file's own precedent that a zero
	 * badge beside a group which already says it is empty is one fact told twice —
	 * here the marks themselves are the fact, so with none on screen the action has
	 * no subject.
	 *
	 * And hidden while a SEARCH is active. The set is the store's, deliberately (a
	 * filter must not be able to make the number on screen disagree with what the
	 * click clears), so under a query the reader can see one mark while the action
	 * would move forty — an irreversible write whose extent the reader cannot see
	 * is not offered at all (agent review round 1, R4).
	 *
	 * WHAT IT SAYS IS THE POINT (UX round 1, U1). The scope is catalogue-wide, so
	 * the number the request will carry is in the control's own visible words — not
	 * only in a tooltip — and the rows it reaches OUTSIDE this section are named in
	 * the tooltip and the accessible name. `markAllReadCopy` owns that copy, and it
	 * derives the number from the same predicate `markAllRead` enumerates with.
	 */
	const unreadCopy = markAllReadCopy(sessions);
	const raiseBulkReadDeferral = useCanonicalSessionsStore(
		(s) => s.raiseBulkReadDeferral,
	);
	const [clearingUnread, setClearingUnread] = useState(false);
	const markAllReadShown =
		unreadCopy.count > 0 &&
		!query.trim() &&
		desktopFeatureEnabled(capabilities.data, "completion_ack_bulk");
	const clearUnread = async () => {
		setClearingUnread(true);
		try {
			const { tone, message } = markAllReadReceipt(await markAllRead());
			if (tone === "success") showSuccessToast(message);
			else showWarningToast(message);
		} catch (failure) {
			/*
			 * BOTH facts, because the question an irreversible action raises is "did it
			 * happen?" and the transport's own translation answers a different one: a
			 * reader told only "the backend is unreachable" has to infer the marks'
			 * state from the rows (UX round 1, U5). Nothing moved — `markAllRead` writes
			 * local state only from the answer's `read` bucket, so a refused request (a
			 * background window refused by main's foreground gate, a busy store
			 * answering 503) leaves every mark exactly where it was — and the sentence
			 * says so rather than only reporting the transport failure.
			 *
			 * EXCEPT THE DEFERRAL, WHICH IS NOT A FAILURE (operator report, 2026-10-05):
			 * a whole call refused because the marks live on other devices gets the
			 * deferral sentence - the same words the receipt's own bucket split composes
			 * one level down (`markAllReadDeferredSentence`) - so the class never reads
			 * as the failure it is not. The count is the control's own set, which is the
			 * extent the label named and the batch would have carried.
			 */
			if (isRemoteReceiptDeferral(failure)) {
				/*
				 * THE RAISE MOVED OFF THIS PANEL (agent review round 2, B2 = QA
				 * round 2, Q3): a raiser here is a second, unmountable copy of a
				 * message class the app draws from its always-mounted surface -
				 * the archive guard's toast discipline bans the info raise in
				 * this file wholesale. The panel writes the store slot and
				 * `UndoToasts` raises the deferral's info from it - once, on the
				 * non-error register, exactly as the direct raise did (design
				 * round 1, D2).
				 */
				raiseBulkReadDeferral(unreadCopy.count);
			} else {
				showWarningToast(
					`${userFacingMessage(failure, "The backend did not answer.")} The unread marks were not cleared.`,
				);
			}
		} finally {
			setClearingUnread(false);
		}
	};
	/**
	 * Where focus goes when the control leaves the screen by succeeding.
	 *
	 * The control unmounts when the last mark is cleared, and a focused element
	 * that unmounts drops focus to `<body>` — so the next Tab restarted from the
	 * top of the panel, outside the list, which is the opposite of what a reader
	 * who just cleared the pile wants (UX round 1, U2). Focus is handed to the
	 * section's own disclosure instead, which is in the ring and adjacent to where
	 * the control was.
	 *
	 * Guarded on `document.activeElement` rather than taken unconditionally: the
	 * count can also reach zero while focus is somewhere else entirely (the reader
	 * clicked a row, the feed cleared the last mark in another window), and moving
	 * focus then would steal the cursor from wherever they actually are. `<body>`
	 * is the signature of the unmount-drop and of nothing else here.
	 */
	const controlWasShown = useRef(markAllReadShown);
	useEffect(() => {
		if (controlWasShown.current && !markAllReadShown) {
			const active = document.activeElement;
			if (active === null || active === document.body) {
				/*
				 * The list's first row, which is where the control sat in the ring: the
				 * section labels are not controls any more (§C1, U22), so the row the
				 * control preceded is the adjacent stop.
				 *
				 * SCOPED TO THE CHATS REGION, and the scope is load-bearing: the one-scroll
				 * change bound BOTH region refs to the merged scroller (`bindPanelRef`), so
				 * an unscoped query answered with the ENTITY region's first stop - the
				 * `Agents` disclosure, the first `[data-chat-row]` in the merged flow - and
				 * focus landed on a group header instead of the row the control preceded
				 * (`scripts/mark-all-read-control.test.mjs`, "clearing the last mark hands
				 * focus to the list"). The region marker is the same partition the R3 work
				 * put on this list for the rigs; the app reads it here for the same reason.
				 */
				listPanelRef.current
					?.querySelector<HTMLElement>(
						'[data-sidebar-region="chats"] [data-chat-row]',
					)
					?.focus();
			}
		}
		controlWasShown.current = markAllReadShown;
	}, [markAllReadShown]);
	/**
	 * The control, as the sibling of a section's toggle rather than inside it: a
	 * button nested in the toggle's own button would share its hit area, so the
	 * inner click and the outer one could not be told apart, and the arrow walk
	 * over `[data-chat-row]` would land on a control whose activation also
	 * collapsed the group.
	 *
	 * IT IS A STOP IN THAT WALK, and for the WHOLE exchange. `keyDown` moves by
	 * calling `.focus()` on the next `[data-chat-row]`, so the stamp is what makes
	 * this a row-scoped action a keyboard reader can reach — ArrowDown from the
	 * Active chats disclosure stops here before the first conversation — and it
	 * MUST NOT drop out while the request is open, because dropping it shortens the
	 * ring to less than the DOM being walked. The stop is kept by not using
	 * `disabled` at all (see below); the ring's order is pinned in
	 * `scripts/mark-all-read-control.test.mjs`.
	 */
	const markAllReadControl: ReactNode = markAllReadShown ? (
		<Button
			size="sm"
			variant="ghost"
			data-chat-row
			data-tour-tag="mark-all-read"
			/*
			 * `aria-disabled` and NOT `disabled`, which is the Older history slot's rule
			 * and the reason it states: Chrome blurs a button the moment `disabled`
			 * lands, so a keyboard reader who pressed Enter loses focus to `<body>` for
			 * the length of the request and the next Tab restarts from the top of the
			 * panel. The click is ignored while the promise is open instead, and focus —
			 * and this ring stop — stay exactly where the reader put them.
			 */
			aria-disabled={clearingUnread || undefined}
			title={unreadCopy.scope}
			onClick={() => {
				if (clearingUnread) return;
				void clearUnread();
			}}
			/*
			 * The primitive, with exactly two overrides (design D5). Its authored hover
			 * ground is `accent-wash`; this row's own step is `rowHover`, the state the
			 * row family takes, and two hover grounds in one row is the inconsistency
			 * branding § 5 asks us not to ship. The rest ink steps down to
			 * `ink-dim` so the action and the section's count are two REGISTERS rather
			 * than one phrase (design D3): the count is a fact at `ink-muted`/medium, the
			 * action is a control below it and takes `ink` on hover. `ink-dim` clears
			 * 4.5:1 on every ground in all 59 palettes.
			 *
			 * `shrink-0` because the action must not be squashed, and the label's
			 * `min-w-0 truncate` below is what keeps the group's own name from being the
			 * thing that gives way — the pair is safe only because the label ALSO sheds
			 * with `sr-only` below the two-digit row width where it stops fitting (design
			 * D1, D2-1).
			 */
			className="shrink-0 text-ink-dim hover:bg-row-hover"
		>
			{clearingUnread ? (
				/*
				 * Only the GLYPH steps down while the request is open: this control is
				 * WORKING, not unavailable, so the label holds its readable ink and the
				 * spinner is the thing that dims (design D4). `ink-disabled` is a colour
				 * step rather than an opacity, per § 6.
				 */
				<LoaderCircle
					className="text-ink-disabled motion-safe:animate-spin"
					aria-hidden="true"
				/>
			) : (
				<CheckCheck aria-hidden="true" />
			)}
			{/*
			 * The label NAMES THE NUMBER the request will carry (UX U1), and it sheds to
			 * `sr-only` below the two-digit row width so the group's own name never breaks
			 * to make room for it (design D1/D2-1) WITHOUT leaving the accessibility
			 * tree: below that width the glyph, the `sr-only` label and the `sr-only`
			 * scope suffix are the whole name, and the tooltip is the description rather
			 * than the name (review R2-1 / UX U2-1).
			 */}
			<span className={cn("truncate", MARK_ALL_READ_LABEL_SHED)}>
				{unreadCopy.label}
			</span>
			{/*
			 * The rows this control reaches outside its own section, in the accessible
			 * name as well as the tooltip. APPENDED rather than replacing the label, so
			 * the visible text stays a prefix of the name (WCAG 2.5.3 Label in Name) —
			 * the shape `ChatSessionStatus` uses for its own ", unread" suffix.
			 */}
			{unreadCopy.nameSuffix ? (
				<span className="sr-only">{unreadCopy.nameSuffix}</span>
			) : null}
		</Button>
	) : null;
	useEffect(() => {
		localStorage.setItem("chat-sidebar-disclosures", JSON.stringify(expanded));
	}, [expanded]);
	/*
	 * THE HEAD REFRESH, and the ONE place this panel's page size is decided.
	 *
	 * ONE PLACE, because the page size and the census flag are the same decision: a
	 * daemon that cannot page is asked for the whole catalogue in one unscoped
	 * `limit=500` read - the request this app has always made - and a daemon that
	 * can page is asked for 50 rows and the census. Two call sites deciding that
	 * separately is how one of them would keep asking for 500 against a paged
	 * backend, and the amplification this change exists to remove would survive in
	 * exactly one of the four triggers, which is the hardest kind to notice.
	 *
	 * A `useCallback` rather than a bare function so the effect below can depend on
	 * it without re-running on every render: `fetchSessions` is a store action and
	 * `pageable` is a capability answer, so this identity changes only when the
	 * answer does.
	 */
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
		if (!feed.available) {
			/*
			 * No feed: an older backend, or a browser-dev renderer with no relay.
			 * Keep the poll this change replaces, gated exactly as it was — the
			 * behaviour of an old renderer against the new code, which must be
			 * identical rather than merely similar.
			 */
			const timer = window.setInterval(() => {
				if (document.visibilityState === "visible") void refreshCatalogue();
			}, LEGACY_CATALOGUE_POLL_MS);
			return () => window.clearInterval(timer);
		}
		/*
		 * The feed replaces the timer, and the two fallbacks that remain are named
		 * rather than left to be inferred (M5):
		 *
		 * - the 30 s safety poll, UNGATED. The 5 s poll's gate on
		 *   `document.visibilityState` was itself a hole — a background window stops
		 *   polling and so stops noticing — and since the event is the mechanism
		 *   here, this only has to be drift insurance. Making it visibility-gated
		 *   would reintroduce the same hole for a smaller gain. It asks for the HEAD
		 *   PAGE ONLY and never for the rows the client already holds: a poll that
		 *   re-read every loaded page is the multi-second read this change removes,
		 *   and a loaded group is deliberately not re-fetched by it either.
		 * - a refetch on window focus, which is the one moment a stale catalogue is
		 *   about to be looked at.
		 */
		const timer = window.setInterval(() => {
			void refreshCatalogue();
		}, CATALOGUE_SAFETY_POLL_MS);
		const onFocus = () => void refreshCatalogue();
		window.addEventListener("focus", onFocus);
		return () => {
			window.clearInterval(timer);
			window.removeEventListener("focus", onFocus);
		};
		// `feed.catalogueRevision` and `feed.activityRevision` are DEPENDENCIES so each
		// invalidation re-runs this effect body once — exactly one refetch per
		// `catalogue` frame and per completion edge, with the safety timer restarted
		// from the event rather than from a clock. Neither is READ in the body: their
		// only job is to be the trigger, which is what the suppression on the hook
		// itself covers. The second trigger exists because a completion that moves no
		// order key publishes no `catalogue` frame while still advancing the clock
		// the bins read (see `activityRevision` in `use-desktop-feed.ts`).
	}, [
		ready,
		refreshCatalogue,
		feed.available,
		feed.catalogueRevision,
		feed.activityRevision,
	]);
	/*
	 * A GROUP'S OWN READ, on the expansion that asks for it.
	 *
	 * ONE FETCH PER OPEN GROUP, issued when its row is expanded and not before:
	 * "pinned and active first, a team's or an agent's chats fetched when its
	 * collapsed row is EXPANDED" is the whole point of the change, because a group
	 * is the only thing on this panel that can name 434 conversations the head page
	 * does not carry.
	 *
	 * THE TWO TRANSITIONS DO TWO THINGS. Opening fetches from the scope's first
	 * page when there is no page in hand. Closing DISCARDS what was loaded, so the
	 * next expansion is a fresh read from the scope's top - which is also the
	 * design's own remedy for the cursor's accepted imperfection (a row whose tier
	 * moved between two page reads can be skipped in that expansion, and
	 * re-expanding is what recovers it).
	 *
	 * IT READS `expanded` AND NOT `isOpen`, and the difference is load-bearing: a
	 * QUERY forces every group the search touches open (`open = query || isOpen`),
	 * so an effect keyed on the drawn state would issue one scope read per group a
	 * keystroke happens to match. `expanded` holds only the disclosures the reader
	 * opened by hand, which is the intent this fetches on.
	 */
	useEffect(() => {
		if (!ready || !groupPaging) return;
		for (const [key, open] of Object.entries(expanded)) {
			const kind = key.startsWith("team:")
				? "team"
				: key.startsWith("agent:")
					? "agent"
					: null;
			if (kind === null) continue;
			/*
			 * `slice`, never `split(":")`: a display name is whatever the operator
			 * called the team, and `team:op:dev` is a legal one - splitting would read
			 * the scope's name as `op` and fetch a team that does not exist.
			 */
			const name = key.slice(kind.length + 1);
			if (name.length === 0) continue;
			if (open) {
				if (catalogueScopes[key] === undefined)
					void fetchScopePage(kind, name, null);
				continue;
			}
			if (catalogueScopes[key] !== undefined) clearCatalogueScope(kind, name);
		}
	}, [
		expanded,
		ready,
		groupPaging,
		catalogueScopes,
		fetchScopePage,
		clearCatalogueScope,
	]);
	// Search is the backend's (`sessions.search`, negotiated as `session_search`),
	// not a filter over titles: a conversation is remembered by what was SAID in
	// it, and the sidebar only holds titles. The backend's answer is used only
	// when it is the answer to what is in the box RIGHT NOW (see
	// `hitsAnswerQuery`), and the local title/agent/team match is applied on top
	// either way — `searchChats` ORs them — so a query the backend cannot answer
	// (an older backend, a failed request) still finds chats by name and label
	// instead of finding nothing.
	const searchSupported = desktopFeatureEnabled(
		capabilities.data,
		"session_search",
	);
	/*
	 * Whether this backend can hold an archived conversation at all, read from the
	 * same capability answer the catalogue gate above uses rather than from a
	 * second negotiation.
	 *
	 * FAIL-CLOSED MEANS NO AFFORDANCE AND NO PARTITION, not a disabled one: absent
	 * `session_archive` this is false, the row mounts no second control, no row
	 * carries a marker and `visibleRows` returns the page untouched. A permanently
	 * reserved empty slot would cost every row width to advertise a feature the user
	 * cannot get, which is the rule the pin slot is written under.
	 *
	 * WHAT THAT IS AND IS NOT, because the earlier wording overclaimed it: the rows
	 * and the classes of a panel with the capability are the ones a panel without it
	 * draws, up to the capability's own additions - but the DOM is NOT identical
	 * when a conversation is archived, and the published measurement says so
	 * (`docs/evidence/session-archive/README.md`): nothing is hidden without the
	 * capability, so an archived conversation is LISTED here where an enabled panel
	 * hides it, and the at-rest frame gains that row. What is byte-identical is the
	 * 690x60 band around a live row, which is what the withdrawn pair is compared
	 * for.
	 */
	const archiveEnabled = desktopFeatureEnabled(
		capabilities.data,
		"session_archive",
	);
	/*
	 * The `Include archived` control, REMEMBERED for the session but in force only
	 * while a query is - `archivedSearchWidened` is the rule and its docstring
	 * carries the reasoning (UX round 1, U8: clearing the box used to disarm the
	 * widening silently, so a user who cleared and retyped lost the archived result
	 * they had just found, with nothing saying why).
	 *
	 * Local state rather than the store, for the reason the query itself is local:
	 * it is a property of the box, not of the data, and it is deliberately not
	 * persisted - a user who reopens the app must not silently be searching a set
	 * they chose to include once, days ago.
	 */
	const [includeArchived, setIncludeArchived] = useState(false);
	const widened = archivedSearchWidened(includeArchived, query, archiveEnabled);
	const archiveFacts = useCanonicalSessionsStore((s) => s.archiveFacts);
	const forgottenFacts = useCanonicalSessionsStore((s) => s.forgotten);
	/*
	 * THE TOASTS THEMSELVES LIVE OUTSIDE THIS PANEL NOW (operator request, 2026-09-27):
	 * the archive offer and refusal and the discard offer are raised by an always-mounted
	 * surface (`undo-toasts.tsx`, beside the global container in `main.tsx`), because the
	 * acts that produce them are reachable while this panel is not even mounted - the
	 * column collapses to a 56px strip without it, and the chat pane's header menu, a
	 * typed `/archive` and the composer's own Clear all stay reachable. What the panel
	 * still owns is the ONE piece of state those messages need from it: the key a discard
	 * staged in the pane's place (`stagedByDiscard`), written by the two discard handlers
	 * below and read by the offer's Undo press one surface over.
	 */
	const setStagedByDiscard = useCanonicalSessionsStore(
		(s) => s.setStagedByDiscard,
	);
	const setSessionArchived = useCanonicalSessionsStore(
		(s) => s.setSessionArchived,
	);
	/*
	 * THE ARCHIVE'S OWN CANDIDATE (2026-09-30), and the reason the row control can ask
	 * instead of write: this panel stages the conversation and the pane's one
	 * `ArchiveConversationDialog` does the asking, so the ROW's door and the header's,
	 * the typed `/archive`'s and the `⌘⇧A` chord's all end in the same question. The
	 * unarchive half never reaches it - the restore is one press.
	 */
	const requestArchiveConfirm = useCanonicalSessionsStore(
		(s) => s.requestArchiveConfirm,
	);
	/*
	 * The pure search module takes plain booleans: the stamp that orders a fact
	 * against an answer is the store's business (`applySearchAnswer`), and a row
	 * only needs what to draw.
	 *
	 * ANSWERED FACTS ONLY (design round 8, D27): this map is what the ROW draws and what the
	 * search join drops hits by, so both are decisions about what a LIST holds - and a list
	 * may not lose a conversation on a press, only on the daemon's sentence. A fact still in
	 * flight is the press's INTENT, and the row is told about it nowhere: what the press costs
	 * is exactly that the pressed row stays drawn for the round trip (the store's own note
	 * states the trade, and design D28 records the register that should pay it).
	 */
	const archiveFactValues = useMemo(() => {
		const values: Record<string, boolean> = {};
		for (const [id, fact] of Object.entries(archiveFacts))
			if (fact.answered) values[id] = fact.archived;
		return values;
	}, [archiveFacts]);
	const archiveView = useMemo<ArchiveView>(
		() => ({
			include: widened,
			facts: archiveFactValues,
			/*
			 * The delete tombstones, as a SET because that is all the join asks: a
			 * conversation this window has deleted must not be drawn from a row or rebuilt
			 * from a cached search hit (`chat-search.ts`).
			 */
			forgotten: new Set(Object.keys(forgottenFacts)),
		}),
		[widened, archiveFactValues, forgottenFacts],
	);
	/*
	 * The last archive press the POINTER made, and where (`chat-archive-press.ts`).
	 *
	 * A ref rather than state: it is read and written inside the press handler, it
	 * must survive between two clicks of one double-click, and nothing renders from
	 * it - so making it state would re-render the list on every pointer move.
	 */
	const lastArchivePress = useRef<ArchivePressRecord | null>(null);
	/*
	 * An over-long query never reaches the wire. The op's `q` is capped at
	 * `SESSION_SEARCH_MAX_CHARS`, and asking anyway buys a generic 422 that the
	 * panel then renders as a backend outage with a Retry that cannot succeed —
	 * the same characters are refused identically every time (QA round 1, Q1).
	 * So the surface refuses it first and says the true cause; importing the
	 * constant for that sentence is what makes it load-bearing here rather than
	 * decorative in the contract.
	 *
	 * The refusal is READ from the hook rather than re-derived from the box (review
	 * round 7, R37): the hook is the only thing that knows which string it would
	 * send, and a caller measuring the box gets a different answer for one debounce
	 * — which is how a 257-character `q` went out while the box read 256 and this
	 * notice stayed silent. So the flag is about the query IN FORCE, which is why
	 * the notice beside it and `awaiting` can both be trusted to describe the same
	 * search the list below is showing.
	 *
	 * The local name and label narrowing still runs — `searchChats` applies it
	 * whether or not there are hits — so what the notice describes is what the
	 * user is still getting, not a replacement for it.
	 */
	const search = useChatSearch(query, ready && searchSupported, widened);
	const overLong = search.refused;
	/*
	 * The rows the LISTS may draw, which is the page minus the archived ones unless
	 * the search control includes them.
	 *
	 * ONE FILTER, before anything reads the list: the flat list, the two sections,
	 * the agent and team groups and the local half of the search all read this
	 * array, so "archived conversations are not in the default lists" is a property
	 * of the base rather than a condition repeated at each of the five call sites -
	 * which is how one of them would eventually be missed. With the control ON the
	 * filter is off (that is what the control promises), and the archived rows
	 * rejoin every list for as long as the query lasts.
	 */
	const answeredForMembership = useMemo(
		() => answeredArchiveRows(sessions, archiveFacts),
		[sessions, archiveFacts],
	);
	const listed = useMemo(
		() =>
			mergeRemoteRowsByActivity(
				visibleRows(answeredForMembership, archiveEnabled && !widened),
			),
		[answeredForMembership, archiveEnabled, widened],
	);
	/*
	 * The hits the answer actually contributes, held once: `searchChats` consumes
	 * them and the counts below read their honesty off the same array, so the two
	 * cannot disagree about which answer is in hand.
	 */
	const hits = hitsAnswerQuery(search.data, query)
		? search.data.sessions
		: null;
	/*
	 * THE PIN THE PAGE CANNOT DRAW, drawn from the fact (design round 4, D17; UX round 4,
	 * U14). A press on a conversation the catalogue page does not carry is remembered by
	 * `pinFacts`, and the fact is now a record a row can be built from rather than a bare
	 * boolean - because the alternative is what D12 photographed: the backend and the
	 * terminal both holding a pin, and the app drawing no row, no heading and no count for
	 * a conversation that is genuinely in the pinned set. The design round weighed the
	 * alternatives and refused both (a count with no row under-reports the shared set; a
	 * "not in this list" badge exposes a paging bound the reader has no model for).
	 *
	 * The row is built only for a conversation the catalogue does NOT list: where it does,
	 * the catalogue's own row is the row, and this one would be a second copy on one axis -
	 * the same defect the partition exists to avoid.
	 */
	const heldRows = useMemo(() => {
		const listed = new Set(sessions.map((row) => row.session_id));
		const out: CanonicalSessionRow[] = [];
		for (const [id, fact] of Object.entries(pinFacts)) {
			if (!fact.pinned || listed.has(id)) continue;
			out.push({
				session_id: id,
				title: fact.title || "Untitled chat",
				updated_at: fact.updated_at,
				pinned: true,
			});
		}
		return out;
	}, [pinFacts, sessions]);
	const {
		rows: matching,
		conversationMatches,
		synthesized,
	} = useMemo(
		() =>
			searchChats(
				[...listed, ...heldRows],
				query,
				hits,
				pinFactValues,
				archiveView,
				bindingOfHit,
				/*
				 * The local label arm reads the same resolver the row slots render
				 * with (round 1, R1-3c): a conversation drawn under a team's label
				 * is found by that label's words, while the slug keeps matching
				 * through the binding itself.
				 */
				teamLabelFor,
			),
		[
			listed,
			heldRows,
			query,
			hits,
			pinFactValues,
			archiveView,
			bindingOfHit,
			teamLabelFor,
		],
	);
	/*
	 * Whether that answer is a full page rather than the whole answer. The answer
	 * carries no truncation flag (`limit`, `query`, `sessions` are all it holds,
	 * where the sibling list route returns one), so "exactly as many hits as we
	 * asked for" is the only evidence there is, and a number read off it is a
	 * FLOOR. Asserting the exact count from it is the false total QA round 1 (Q3)
	 * filed: 100 on screen against 115 in the store.
	 */
	const clipped =
		hits !== null && searchAnswerIsClipped(hits.length, search.data?.limit);
	/*
	 * THE PANEL'S OWN TOTAL, from the rows it DRAWS (round 2, R2-2 = D9 = F3; U10 for the
	 * search wording). `matching` is the same array the `All chats` badge counts, so the
	 * sentence and the badge can no longer disagree - which they did: the sentence counted
	 * rows HELD, including archived ones this panel fetches and does not draw, and printed
	 * `Showing 51 of 755` beside the panel's own `All chats 49`.
	 *
	 * AND IT IS TOLD WHEN THE COUNT IS A FLOOR (round 3, R3-1 = U13). While the search
	 * answer is clipped the badge already says `100+` and the row says "At least 100 chats
	 * match this search", so a bare `Showing 100 of 757 chats matching your search` beside
	 * them stated an exact number this file knows to be a floor.
	 */
	const totalSentence = catalogueTotalSentence({
		pageable,
		shown: matching.length,
		total: catalogueCounts?.total ?? null,
		searching: query.trim().length > 0,
		clipped,
	});
	const children = (kind: ChatTarget["kind"], name: string) =>
		matching.filter((row) =>
			kind === "team"
				? row.binding?.team === name
				: !row.binding?.team && row.binding?.agent === name,
		);
	/*
	 * The rows ONE GROUP draws, on the paged path.
	 *
	 * THE ORDER IS THE SCOPE'S, and it cannot be re-derived: the wire carries no
	 * rank, so a group ordered by filtering `matching` would be ordered by whatever
	 * order the head's page and the group's pages happen to have concatenated in -
	 * and the group's own first page is by definition NOT the head's rows for that
	 * binding. `scopes[key].ids` is the server's order for this scope, which is the
	 * only ordering authority there is (`chat-sections.ts` states the same rule for
	 * the sections).
	 *
	 * The rows are looked up in `matching` rather than in `sessions`, so the search
	 * narrowing, the archive partition and the tombstone rules all still apply to a
	 * group exactly as they do to a section: the id list decides ORDER and
	 * MEMBERSHIP, and the panel's one filtered list decides what may be DRAWN.
	 *
	 * `groupPaging === false` returns `children`, so an older daemon's group - and
	 * any group under a query - is the filter of the one list the panel holds:
	 * today's render, unchanged.
	 */
	const scopeRows = (kind: ChatTarget["kind"], name: string) => {
		if (!groupPaging) return children(kind, name);
		const ids = catalogueScopes[catalogueScopeKey(kind, name)]?.ids;
		if (ids === undefined) return [];
		const byId = new Map(matching.map((row) => [row.session_id, row]));
		const rows: CanonicalSessionRow[] = [];
		for (const id of ids) {
			const row = byId.get(id);
			if (row !== undefined) rows.push(row);
		}
		return rows;
	};
	/*
	 * WHETHER THE TAIL MAY EXTEND AT ALL, on this arrangement.
	 *
	 * #505 wrote this as `groupPaging && (all || isOpen("previous"))`, because on
	 * main's list the head's rows are partitioned into `Active chats` and
	 * `Previous chats` and `Previous chats` is a collapsed disclosure: a
	 * commit-time extension running with it closed would page the ENTIRE catalogue
	 * fifty rows at a time, since a short region is exactly what the extension
	 * reads as "at the bottom".
	 *
	 * NEITHER CLAUSE HAS AN ANALOGUE HERE, and the gate they carried has not been
	 * dropped: this redesign draws every section it has rows for (there is no
	 * collapse on the section list, only on the entity groups) and its own page
	 * ladder is what holds rows back. So the capability and the query are the whole
	 * of this predicate, and the "do not page unasked" rule moved to where the rows
	 * are actually withheld - `ladderHoldsRowsRef`, read by `extendCatalogueTail`.
	 */
	const tailVisible = groupPaging;
	/*
	 * THE EXTENSION ITSELF, measured from the region's own geometry.
	 *
	 * The measurement rather than an `IntersectionObserver`, because the file
	 * already measures geometry in this region's `onScroll` handler and a second
	 * mechanism would be a second source of truth for one question. `tailExtendDue`
	 * carries the decision and its reasons; this only supplies the numbers.
	 *
	 * A REGION THAT IS NOT MOUNTED IS NOT MEASURED, and is not treated as "at the
	 * bottom": the commit effect below asks again once it exists.
	 */
	/*
	 * THE CURSOR A TAIL READ REFUSED, and why the panel has to remember it (round 4, U14).
	 *
	 * `tailExtendDue` already says a failed page is never retried by a scroll - "the reader
	 * asked once" - but the HEAD's answers do not carry the tail's error: the 30 s poll
	 * (and every catalogue frame) replaces the head, the error clears with it, the commit
	 * effect re-measures, and the tail's cursor page was asked for AGAIN without the reader
	 * asking. With a backend that keeps refusing, that is a flapping refusal - and the
	 * control the reader pressed is unmounted under them each time it flaps, which is how
	 * the press ends on `<body>`.
	 *
	 * Remembering WHICH cursor failed is what makes the refusal sticky across head answers.
	 * Only the reader's own Retry clears it.
	 */
	const tailRefusedCursorRef = useRef<string | null>(null);
	/*
	 * WHETHER THE LADDER IS STILL HOLDING ROWS BACK, read by the extension effect.
	 *
	 * It is a REF rather than the value itself because of where the two have to
	 * live: the tail's block (this one) is four hundred lines above the page it
	 * would have to read, and moving either across the other is a larger edit to a
	 * seven-thousand-line component than the question is worth. The assignment sits
	 * where `page` is computed and this is only ever read from an effect, after the
	 * render that wrote it.
	 *
	 * WHY IT GATES THE EXTENSION. The head is fetched fifty rows at a time and the
	 * ladder draws ten of them; on a tall window a ten-row list does not fill its
	 * region, so `tailExtendDue` is true from the first commit and the scroll
	 * extension would page the whole catalogue under a reader who had asked for
	 * ten rows and has two rungs left to spend. #505's own note names this failure
	 * for a collapsed section; the ladder is the same failure in another dress.
	 */
	const ladderHoldsRowsRef = useRef(false);
	/*
	 * AND THE REFUSAL ITSELF IS HELD, not only the cursor (round 4, U14). A head answer
	 * replaces the tail's error with its own win: the 30 s poll lands, `catalogueHead.error`
	 * goes back to null, and the sentence and its Retry vanish from a panel whose reader was
	 * just told the page failed - the refusal has to survive the answers that are not about
	 * it. Held against the cursor it belongs to, so a successful page (whose cursor has
	 * moved on) clears it without anyone having to remember to.
	 */
	const [tailRefusal, setTailRefusal] = useState<{
		cursor: string;
		sentence: string;
	} | null>(null);
	const extendCatalogueTail = useCallback(() => {
		if (!tailVisible) return;
		/*
		 * THE LADDER OUTRANKS THE SCROLL. While the panel is drawing fewer rows than it
		 * holds - a rung unspent, or a section the reader has switched off - the reader
		 * has a way to ask for more that they have not used, and the region being short
		 * is the ladder's own doing rather than evidence that the list wants filling.
		 */
		if (ladderHoldsRowsRef.current) return;
		if (
			catalogueHead.tailCursor !== null &&
			catalogueHead.tailCursor === tailRefusedCursorRef.current
		)
			return;
		const box = listPanelRef.current;
		if (box === null) return;
		if (
			!tailExtendDue({
				pageable: tailVisible,
				nextCursor: catalogueHead.tailCursor,
				loading: catalogueHead.loading,
				error: catalogueHead.error,
				scrollTop: box.scrollTop,
				clientHeight: box.clientHeight,
				scrollHeight: box.scrollHeight,
			})
		)
			return;
		tailPendingRef.current = true;
		void fetchCatalogueTail();
	}, [tailVisible, catalogueHead, fetchCatalogueTail]);
	useEffect(() => {
		if (catalogueHead.error !== null && catalogueHead.tailCursor !== null) {
			tailRefusedCursorRef.current = catalogueHead.tailCursor;
			setTailRefusal({
				cursor: catalogueHead.tailCursor,
				sentence: catalogueHead.error,
			});
		}
	}, [catalogueHead.error, catalogueHead.tailCursor]);
	/*
	 * THE SAME QUESTION ON COMMIT, not only on a scroll.
	 *
	 * A region whose content is not taller than its box emits no scroll event at
	 * all, so the scroll handler alone would leave the rows past the head page
	 * unreachable on a tall window - the case `tailExtendDue`'s own comment names.
	 * Asked here, the tail fills until the list overflows and the reader's scrolling
	 * takes over. It converges for the same reason: one page at a time, and the end
	 * of the catalogue is a cursor of null.
	 *
	 * `sessions.length` is a dependency rather than `catalogueHead` alone, because
	 * an extension can add rows whose count the cursor's own answer does not
	 * change - a page whose last row is the catalogue's last row returns no cursor
	 * AND rows, and the region then has to be re-measured.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `sessions.length` is a trigger, not a read — the effect re-measures the region after rows render, which is what the tail fills against.
	useLayoutEffect(() => {
		extendCatalogueTail();
	}, [extendCatalogueTail, sessions.length]);
	/*
	 * THE FLAT LIST SAYS WHEN ITS TAIL LANDS (round 1, U7).
	 *
	 * The extension is driven by scroll position and draws nothing of its own in the
	 * steady state, so rows appear under a reader with nothing announced - and a
	 * screen reader's user, who cannot see the list grow, is told nothing at all.
	 * One polite line names the event; it is cleared after a moment because a live
	 * region that keeps its last value says nothing new the next time the same
	 * number of rows arrive.
	 *
	 * `tailPendingRef` is what makes this the EXTENSION's arrival rather than any
	 * growth: a head answer that carries more rows than the last one is not a tail
	 * arriving, and announcing it as one would be a second false sentence.
	 */
	const tailPendingRef = useRef(false);
	const [tailArrival, setTailArrival] = useState<string | null>(null);
	const previousRowCountRef = useRef(sessions.length);
	useEffect(() => {
		const before = previousRowCountRef.current;
		previousRowCountRef.current = sessions.length;
		if (!tailPendingRef.current || sessions.length <= before) return;
		tailPendingRef.current = false;
		setTailArrival(tailArrivalAnnouncement(sessions.length - before));
		const timer = window.setTimeout(() => setTailArrival(null), 4000);
		return () => window.clearTimeout(timer);
	}, [sessions.length]);
	/*
	 * THE PINNED ORDER'S OWN LIVE REGION (issue #693).
	 *
	 * WHY IT NEEDS ONE AT ALL: a move changes the ORDER of rows a screen reader has
	 * just been told about, and the two rows swap positions without a word - the same
	 * silence `project-board.tsx` answers for its columns ("Moved QA column to
	 * position 2 of 3."). Its sentences are `chat-pin-order.ts`'s, so the phrasing
	 * and the boundary cases are pinned by tests rather than chosen here.
	 *
	 * ITS DWELL IS THE TAIL'S OWN, AND FOR THE TAIL'S OWN REASON: a live region that
	 * KEEPS its last value says nothing new when the same sentence is the next
	 * answer, and "already the first pinned chat" is a sentence a reader can produce
	 * twice in a row by pressing the chord again. Clearing it is what makes the second
	 * press audible rather than swallowed.
	 */
	const [pinMoveAnnouncement, setPinMoveAnnouncement] = useState("");
	const pinMoveTimerRef = useRef<number | null>(null);
	/*
	 * THE SENTENCE THE REGION HOLDS NOW, AND WHY THE REPEAT NEEDS ITS OWN MOVE (agent
	 * review round 1, R6; QA round 1, Q3; UX round 1, U3 - all three measured the same
	 * silence). A live region is read from its MUTATIONS, so setting the region to the
	 * string it already holds is not a state change React, the DOM or the screen reader
	 * sees: a reader who presses the boundary chord twice inside the dwell heard
	 * "already the first pinned chat" once, however many times they pressed. Clearing and
	 * re-setting the SAME sentence is the fix - two mutations, so the platform announces
	 * it again - and it has to happen across a FRAME, because a clear and a set in one
	 * tick are one commit and therefore one mutation. The ref is what makes "is this a
	 * repeat" answerable at all: `pinMoveAnnouncement` is the value from this render,
	 * which is stale for the second press of the same gesture.
	 */
	const pinMoveHeldRef = useRef("");
	const pinMoveFrameRef = useRef<number | null>(null);
	const announcePinMove = (sentence: string) => {
		if (pinMoveFrameRef.current !== null) {
			window.cancelAnimationFrame(pinMoveFrameRef.current);
			pinMoveFrameRef.current = null;
		}
		const repeat = sentence !== "" && sentence === pinMoveHeldRef.current;
		if (repeat) {
			setPinMoveAnnouncement("");
			pinMoveFrameRef.current = window.requestAnimationFrame(() => {
				pinMoveFrameRef.current = null;
				setPinMoveAnnouncement(sentence);
			});
		} else {
			setPinMoveAnnouncement(sentence);
		}
		pinMoveHeldRef.current = sentence;
		if (pinMoveTimerRef.current !== null)
			window.clearTimeout(pinMoveTimerRef.current);
		pinMoveTimerRef.current = window.setTimeout(() => {
			pinMoveTimerRef.current = null;
			pinMoveHeldRef.current = "";
			setPinMoveAnnouncement("");
		}, 4000);
	};
	/*
	 * THE TAIL PRESS, AND WHAT IT OWES THE READER AFTERWARDS (round 1, U2 + D7).
	 *
	 * Two things the control cannot do by itself. THE EXACT LIMIT: the row says how
	 * many chats the press will add, so the fetch asks for that many rather than for
	 * a page and throwing the rest away - `min(page, remaining)`, which is the same
	 * number the label prints because both come from one decision. AND THE FOCUS:
	 * the control unmounts when the last page lands (its cursor is gone), which used
	 * to drop focus to `<body>` - a keyboard reader was returned to the top of the
	 * document by the press that was supposed to bring them more rows. The row the
	 * press added is where they were going, so that is where focus goes; the group's
	 * own name button is the fallback, and `<body>` never is.
	 */
	const tailFocusRef = useRef<{
		key: string;
		name: string;
		at: number;
	} | null>(null);
	const pressShowMore = useCallback(
		(
			kind: "team" | "agent",
			name: string,
			key: string,
			held: number,
			addCount: number,
		) => {
			tailFocusRef.current = { key, name, at: held };
			tailPendingRef.current = false;
			void fetchScopePage(
				kind,
				name,
				catalogueScopes[key]?.nextCursor ?? null,
				addCount,
			);
		},
		[catalogueScopes, fetchScopePage],
	);
	useEffect(() => {
		const pending = tailFocusRef.current;
		if (pending === null) return;
		const ids = catalogueScopes[pending.key]?.ids;
		if (ids === undefined || ids.length <= pending.at) return;
		tailFocusRef.current = null;
		const added = ids[pending.at];
		/*
		 * THE ROW IS LOOKED FOR IN BOTH REGIONS (round 2, U2 = F1). The group's rows are drawn
		 * in the ENTITY region and the flat list's in the chats region, so a lookup inside
		 * `listPanelRef` alone missed every group row: `target` was null, `target?.focus()`
		 * was a no-op, and the press dropped focus to `<body>` - exactly what the comment
		 * above promised not to do, measured on every press by both streams.
		 */
		const roots = [entityPanelRef.current, listPanelRef.current];
		const row =
			added === undefined
				? null
				: (roots
						.map(
							(root) =>
								root?.querySelector<HTMLElement>(
									`[data-session-row="${CSS.escape(added)}"]`,
								) ?? null,
						)
						.find((el) => el !== null) ?? null);
		/*
		 * AND THE GROUP IS FOUND BY ITS DISCLOSURE'S LABEL, not by the text of its name
		 * button (round 2, U2): that button's content is the name CONCATENATED with the badge
		 * (`minervadev49`), so a text match could never resolve - which is why the fallback the
		 * round-1 comment described did not exist in practice. The disclosure carries
		 * `Expand <name> chats` / `Collapse <name> chats`, the label the control's own
		 * consumers already use, so this matches the same element the press does.
		 */
		const entityRoot = entityPanelRef.current;
		const groupRow =
			entityRoot === null
				? null
				: ([...entityRoot.querySelectorAll<HTMLElement>("[data-entity]")].find(
						(group) =>
							group.querySelector(
								`[data-disclosure][aria-label="Expand ${pending.name} chats"], [data-disclosure][aria-label="Collapse ${pending.name} chats"]`,
							) !== null,
					) ?? null);
		/*
		 * THE FALLBACK IS THE GROUP'S DISCLOSURE, which exists whether or not the group has
		 * rows - so it resolves at exhaustion too, where the press unmounts the control it was
		 * made on. `<body>` is therefore unreachable from this effect: if neither the added row
		 * nor the group's own disclosure can be found, focus is left where it was rather than
		 * thrown at the document.
		 */
		const target =
			row?.querySelector<HTMLElement>("[data-chat-row]") ??
			row ??
			groupRow?.querySelector<HTMLElement>("[data-disclosure]") ??
			null;
		target?.focus();
	}, [catalogueScopes]);
	/*
	 * The tail's drawn state (`catalogueTailView` carries the rules): nothing while
	 * the extension is silently on its way, the wait register while a page is in
	 * flight, and one sentence plus a retry when a page did not arrive.
	 *
	 * THERE IS NO STEADY-STATE BUTTON, deliberately: the extension is driven by the
	 * region's own scroll position, and a control at the bottom of the list would be
	 * replaced mid-press by the rows its own press fetched. The exception is the
	 * FAILED page, where nothing would ask again on its own.
	 */
	const tailState = catalogueTailView({
		pageable: tailVisible,
		nextCursor: tailVisible ? catalogueHead.tailCursor : null,
		loading: catalogueHead.loading,
		/*
		 * THE STORE'S ERROR, OR THE ONE HELD FOR THIS CURSOR (U14): the second term is what
		 * keeps a refusal on screen across the head answers that are not about it. It cannot
		 * outlive the page it belongs to - a successful extension moves the cursor, and the
		 * held refusal stops applying the moment it does.
		 */
		error:
			catalogueHead.error ??
			(tailRefusal !== null && catalogueHead.tailCursor === tailRefusal.cursor
				? tailRefusal.sentence
				: null),
	});
	useEffect(() => {
		const press = tailRetryPendingRef.current;
		if (press === null) return;
		/*
		 * THE PRESS IS SETTLED BY AN OUTCOME, NOT BY A TICK (round 4, U14). The first version
		 * cleared the pending press on the first non-loading state, and the 30 s poll's own
		 * head answer is a non-loading state: it arrives, clears the tail's refusal, renders
		 * no control, and the effect read that as "it worked" - so when the press's refusal
		 * DID come back a moment later, there was no pending press left to put the reader
		 * back on. The press stays pending until the tail is REFUSED again or EXHAUSTED
		 * (which is the only state that means the rows arrived), with a deadline so a press
		 * that neither fails nor finishes cannot pin focus for ever.
		 */
		/*
		 * THE OUTCOME IS READ FROM THE STORE'S OWN BITS, not from the drawn state: the tail's
		 * steady state and its exhaustion both draw nothing (`kind === "none"`), so the first
		 * version of this effect treated "your page is on its way" as "done" and handed focus
		 * to a row a tick before the refusal arrived - which is why the reader still ended up
		 * away from the control they had pressed.
		 */
		if (tailState.kind === "error") {
			tailRetryPendingRef.current = null;
			tailRefusalRetryRef.current?.focus();
			return;
		}
		/*
		 * THE PRESS'S PAGE ARRIVED when the cursor it was asked against is no longer the
		 * cursor in hand - advanced (more to come) or null (the tail is complete). Focus goes
		 * to the list's last row, which is where a reader who asked for more rows wants to be.
		 */
		if (catalogueHead.tailCursor !== press.cursor) {
			tailRetryPendingRef.current = null;
			const region = listPanelRef.current;
			const rows = region?.querySelectorAll<HTMLElement>("[data-session-row]");
			const last =
				rows === undefined || rows.length === 0 ? null : rows[rows.length - 1];
			(last?.querySelector<HTMLElement>("[data-chat-row]") ?? last)?.focus();
			return;
		}
		// Still on its way, and the deadline is the only thing that ends the wait.
		if (Date.now() > press.deadline) tailRetryPendingRef.current = null;
	}, [tailState.kind, catalogueHead.tailCursor]);
	const catalogueTail =
		tailState.kind === "none" ? null : (
			/*
			 * THE FLAT LIST'S REFUSAL WEARS THE SAME TREATMENT AS THE GROUP'S (round 2,
			 * D10 = U9): this was the THIRD unchanged site, still one `<p>` with the Retry
			 * inline after the sentence and no clamp, so a long backend sentence moved the
			 * control the reader was aiming at. The sentence is clamped, the Retry is on its
			 * own line, and the loading register shares the same wrapper so the swap from
			 * "Loading more chats…" to a sentence is announced.
			 */
			<div className="py-1" aria-live="polite">
				<p className="line-clamp-2 text-meta text-ink-dim">
					{tailState.kind === "loading"
						? "Loading more chats…"
						: tailState.sentence}
				</p>
				{tailState.kind === "error" && (
					<p className="pt-1">
						<button
							ref={tailRefusalRetryRef}
							type="button"
							className="text-meta text-ink-dim underline hover:text-ink"
							onClick={() => {
								/*
								 * THE PRESS IS REMEMBERED BEFORE IT GOES (U14): the control this handler
								 * belongs to does not survive the re-read, so the only way to put the
								 * reader back on it is to say, in advance, that a press is outstanding.
								 * The deadline is generous - a page of this list measures in seconds on
								 * the store this change exists for - and its only job is to stop a press
								 * that neither fails nor finishes from owning focus for ever.
								 */
								tailRetryPendingRef.current = {
									deadline: Date.now() + 20_000,
									cursor: catalogueHead.tailCursor,
								};
								// The reader's own press is the one thing that clears a refusal.
								tailRefusedCursorRef.current = null;
								setTailRefusal(null);
								void fetchCatalogueTail();
							}}
						>
							Retry
						</button>
					</p>
				)}
			</div>
		);
	/*
	 * The pinned partition, applied to the FILTERED list and to nothing else: the
	 * Pinned section draws `matching ∩ pinned` (a pinned row the search excludes is
	 * simply absent), and the sections below it draw the rest, so one conversation
	 * is drawn once. Both calls take `pinsEnabled`, and `unpinnedRows` returning
	 * every row when it is false is what keeps a withdrawn capability from erasing
	 * a row that still carries a flag - see that function's own comment.
	 *
	 * `children` above reads `matching` rather than `rest` deliberately: sections
	 * and agent groups are two axes, and this panel already draws one chat in two
	 * places on two axes (in `Active chats` and under its agent when expanded).
	 * Lifting a pinned row out of its group would also move the group's own count
	 * badge, which is `children().length`.
	 */
	const pinned = pinnedRows(matching, pinsEnabled);
	const rest = unpinnedRows(matching, pinsEnabled);
	/*
	 * THE PAGE, and it is where the operator's three invariants live
	 * (`chat-sidebar-view.ts` carries the rules and the reasons):
	 *
	 *   - `pageOrder` lifts the ACTIVE rows - a live turn, a turn stopped on the
	 *     reader, a wedged one - above the rest by a stable partition, so the
	 *     recency below them is the catalogue's own and never inverted;
	 *   - `pageRows` cuts the page at the ladder's current rung and LIFTS the
	 *     viewed conversation in when it sits past the end, so "you are here"
	 *     is not something a page size can take away;
	 *   - a search bypasses the limit entirely, because the backend answers over
	 *     an index of every conversation and the page is not allowed to act as a
	 *     filter over that answer.
	 *
	 * The ORDER of the two calls is the contract: the page is cut from the
	 * ordered list, never the other way round, so the active rows occupy the
	 * page's head rather than being appended to it.
	 */
	const view = parseSidebarView(chatSidebarView);
	/*
	 * THE PINNED SECTION'S OWN ORDER (issue #693), and the lists it is taken from -
	 * each one because a different rule needs a different list.
	 *
	 *   - `pinned` above is the catalogue's order passed through, which is what rule 1
	 *     draws before the reader has moved anything;
	 *   - `orderedPinned` is that list PERMUTED by the view's stored order
	 *     (`chat-pin-order.ts` carries the rules), and it is the only list the section
	 *     renders and the only order a move is taken over - "up" has to mean the row
	 *     ABOVE the one on screen, so the list the reader is looking at is the list the
	 *     move counts in;
	 *   - `knownPinnedIds` is what the stored order is materialized against, read
	 *     lazily inside the move below rather than here, because it is a full pass over
	 *     the loaded page and only a move needs it.
	 *
	 * `pinnedIndex` is the drawn position of each row, which is where the row menu's
	 * two Move items' offered/inapplicable state and the announcement's "position N of
	 * M" come from - one map rather than an `indexOf` per row per render.
	 */
	const pinnedCatalogueIds = pinned.map((row) => row.session_id);
	/**
	 * The row's own name, for the three sentences that have to name it.
	 *
	 * ONE SPELLING, and it searches `matching` rather than the local pages: the chord's
	 * no-target answer (UX round 1, U4) names a row that is, by definition, NOT in `pinned` -
	 * it is the row the reader pressed the chord on and nothing happened - and a search answer
	 * can carry a PINNED row this client's page does not have (`chat-search.ts`'s synthesised
	 * hits, which `matching` carries and `[...listed, ...heldRows]` does not). Reading the two
	 * local arrays here named those rows "Untitled chat" while they were on screen by name
	 * (round 2, M2). The fallback is the row render's own ("Untitled chat").
	 */
	const rowLabel = (id: string): string =>
		matching.find((row) => row.session_id === id)?.title || "Untitled chat";
	const orderedPinned = orderPinnedRows(pinned, view.pins);
	const pinnedDrawnIds = orderedPinned.map((row) => row.session_id);
	const pinnedIndex = new Map(
		pinnedDrawnIds.map((id, index) => [id, index] as const),
	);
	/**
	 * The move a menu item or the chord performs (issue #693).
	 *
	 * ONE FUNCTION FOR EVERY PATH, and that is now also the only path: the two arrow
	 * controls this used to be reached through are deleted, so the chord calls this
	 * directly instead of `.click()`ing a control, and the row menu's two Move items
	 * call it beside the chord - one write, with the store, the boundary answer and
	 * the caret correction spelled once rather than at a second call site.
	 *
	 * `follow` IS `true` AT BOTH CALL SITES, and the reason is the same for both: every
	 * press that reaches this is an activation the caret already belongs to - a chord,
	 * or an item the reader picked out of a menu - rather than a pointer press on a
	 * control that stays under the pointer with the caret somewhere else. So the caret
	 * follows the row that moved. The parameter stays because it is the statement of
	 * that, at the call sites.
	 *
	 * A BOUNDARY IS AN ANSWER, NOT A SILENCE. The item at either end is drawn
	 * inapplicable (`aria-disabled`, the app's own idiom - a real `disabled` drops an
	 * item out of the flow a keyboard reader can reach and leaves its why
	 * unannounceable), and `aria-disabled` does not stop the activation, so this
	 * handler is what makes the press inert: it answers with `pinMoveBoundaryNote`.
	 * Silence there would read as a broken key, which is the failure
	 * `project-board.tsx` names for its own grip.
	 */
	const moveBoundarySentence = (sessionId: string) =>
		pinMoveBoundaryNote(
			rowLabel(sessionId),
			pinnedIndex.get(sessionId) ?? 0,
			pinnedDrawnIds.length,
		);
	const movePinnedRow = (
		sessionId: string,
		direction: PinMoveStep,
		follow: boolean,
	) => {
		const at = pinnedIndex.get(sessionId);
		if (at === undefined) return;
		const label = rowLabel(sessionId);
		if (!canMovePinnedRow(pinnedDrawnIds, sessionId, direction)) {
			announcePinMove(moveBoundarySentence(sessionId));
			return;
		}
		const next = movePinnedOrder(
			/*
			 * The full pinned set as this client knows it, which is the list the stored order
			 * has to remain a permutation of: a pinned chat the search or the page has
			 * filtered out of the SECTION is still pinned, and its slot must survive the
			 * move (rule 2). `heldRows` is part of it because a pin this client knows from a
			 * fact rather than from a catalogue row is still a pin it can address.
			 */
			pinnedRows([...listed, ...heldRows], pinsEnabled).map(
				(row) => row.session_id,
			),
			view.pins,
			pinnedDrawnIds,
			sessionId,
			direction,
		);
		if (next === null) return;
		/*
		 * ONE WRITE, through the setter the view popover uses, so the arrangement lands
		 * where every other view preference is stored and validated on read
		 * (`ui-preferences-storage`).
		 */
		setChatSidebarView({ ...view, pins: next });
		/*
		 * THE CARET AND THE LINE COME BACK THROUGH THE PANEL'S OWN CORRECTION, which is
		 * `unpin`'s mechanism and not a new one: the rows reorder in place, so the element
		 * this handler holds is still mounted but no longer where it was - the correction
		 * finds the row BY ID after the commit and puts the caret back inside it, so
		 * `group-has-[:focus-visible]` stays true and the row's reveal stays up for the
		 * next press.
		 *
		 * THE CARET GOES TO THE ROW'S OWN BUTTON here rather than to the mark, and the scroll
		 * correction is asked to stand down - a move is not a section change (Q1, R3).
		 */
		rememberMovedRow(sessionId, follow, null, "row", false);
		const drawn = pinnedOrder(pinnedCatalogueIds, next);
		announcePinMove(pinMoveNote(label, drawn.indexOf(sessionId), drawn.length));
	};
	/**
	 * Whether the move is offered for a row at all, as one predicate with two call
	 * sites: the row menu's two Move items (through the row's own `offersMove`) and
	 * the chord, which has no row closure to read and answers with an id.
	 *
	 * `nested` is the row's own term, passed by the one caller that knows it: a pinned
	 * row drawn inside an agent group is in `matching` but not the section, so it has no
	 * drawn position to move within. The chord never passes it, because the
	 * `view.groupBy === "section"` term is exactly the arrangement in which no row is
	 * nested - the grouped rendering is the only caller that draws one.
	 *
	 * THE OPENNESS OR CLOSEDNESS OF THE PIN STORE IS PART OF THE PREDICATE
	 * (`pinsEnabled`), because the section does not exist without it and a move would
	 * rearrange a list nobody is drawing.
	 */
	const offersPinnedMove = (sessionId: string, nested = false) =>
		pinsEnabled &&
		view.groupBy === "section" &&
		!nested &&
		pinnedIndex.has(sessionId);
	/*
	 * DRAG TO REORDER (issue #697, item 1), and it writes the SAME model the menu's
	 * two Move items and the chords write: a drop resolves to one array through
	 * `movePinnedOrderTo` and lands through `setChatSidebarView` once, so the three
	 * routes cannot disagree about what the order is or about what a drop costs the
	 * store.
	 *
	 * WHY POINTER EVENTS AND NOT HTML5 DRAG-AND-DROP, which is the whole of the
	 * mechanism below: `draggable` puts the gesture in the OS drag loop, where the
	 * browser draws its own drag image (a lifted, translucent copy of the row - a
	 * lift and an opacity step the branding contract forbids), the drop target is
	 * decided by a `dragover` allow-list rather than by geometry the rig can read,
	 * and no committed frame can show the indicator mid-gesture. `pointerdown` +
	 * `setPointerCapture` keeps every move aimed at the grip, keeps the drop a
	 * number this module computes (`pinDragSlot`), and photographs.
	 *
	 * WHY THE GRIP AND NOT THE ROW: the row's box is its open-act button, and a
	 * drag started anywhere inside it would have to guess whether the press meant
	 * "open this chat" or "move it". A 24px handle states the intent, which is what
	 * `project-board.tsx`'s grip does for its columns (the precedent this follows).
	 *
	 * THE POSITION IS THE ONLY STATE THE GESTURE CARRIES: no node is ever cloned,
	 * re-parented or translated - the rows stay exactly where React put them and the
	 * INDICATOR is what says where the row would land, so a drop that is cancelled
	 * (Escape, `pointercancel`) leaves nothing to undo but the line itself
	 * (`reapPinnedOrder`'s discipline, one gesture over).
	 */
	const pinnedSectionRef = useRef<HTMLElement | null>(null);
	const pinIndicatorRef = useRef<HTMLDivElement | null>(null);
	const pinDragRef = useRef<PinDragGesture | null>(null);
	const [pinDrag, setPinDrag] = useState<{ id: string; slot: number } | null>(
		null,
	);
	/*
	 * THE ROW WHOSE TEAM BUBBLE HOLDS THE POINTER, AND THE ROW WHOSE TEAM BUBBLE HOLDS
	 * THE KEYBOARD'S FOCUS - two states rather than one, held by the sidebar rather
	 * than by the row for the same reason `pinDrag` is: the surface they have to
	 * displace is outside the row's own tree.
	 *
	 * WHY THEY EXIST. The row's flyout and the bubble's own tooltip are two pointer
	 * surfaces opened by ONE hover - the flyout's trigger is the row's box and the
	 * bubble sits inside it, so a pointer moving over the mark opens the card as
	 * well as the mark's tooltip (measured on the `sidebar-team-bubble-hover` frame:
	 * both panels stand). That is the same defect the row's native `title` was
	 * deleted for (D7, "One pointer surface, not two"), and the resolution is the
	 * flyout's own `suppressed`, which keeps the trigger mounted and closes only the
	 * panel - NOT its `disabled`, which renders the box unwrapped and takes the mark
	 * (and the mark's tooltip) down with it (measured; see the call site).
	 *
	 * THEY ARE SEPARATE because the two channels do not end together. With one flag
	 * cleared by either channel's exit, the sequence "focus the mark, then move the
	 * pointer onto the row and off the mark" cleared it while the mark was still
	 * focused and its own tooltip still drawn, so the flyout un-suppressed and the
	 * next hover on the row re-created the two-panels state this exists to remove
	 * (agent review round 1, R1-M5). Two channels, each cleared by its own exit, and
	 * the flyout stands down while EITHER is on the row.
	 *
	 * KEYED BY SESSION ID rather than a boolean: only the row under the pointer
	 * loses its card, and a state that outlives its row (a list that re-renders
	 * under the pointer) can only ever leave a row that is not there suppressed.
	 */
	const [teamBubbleHovered, setTeamBubbleHovered] = useState<string | null>(
		null,
	);
	const [teamBubbleFocused, setTeamBubbleFocused] = useState<string | null>(
		null,
	);
	const pinDragAutoScrollRef = useRef<number | null>(null);
	const pinDragYRef = useRef(0);
	/**
	 * The PINNED section's own row boxes, in DRAWN order.
	 *
	 * Read from the DOM rather than from `orderedPinned`, because the drop has to
	 * land in the boxes the reader is looking at: the section virtualises nothing,
	 * but a row can be drawn with no height (a filtered-out id, a group member the
	 * section does not own), and a slot computed from an array would then count a
	 * row the pointer cannot cross.
	 */
	const pinDragRowBoxes = () => {
		const section = pinnedSectionRef.current;
		if (section === null) return [];
		return Array.from(
			section.querySelectorAll<HTMLElement>("[data-session-row]"),
		).map((node) => {
			const rect = node.getBoundingClientRect();
			return {
				id: node.getAttribute("data-session-row") ?? "",
				top: rect.top,
				bottom: rect.bottom,
			};
		});
	};
	/** The slot under a pointer y, and one state write only when it changes. */
	const applyPinDragOver = (y: number) => {
		const live = pinDragRef.current;
		if (live === null || !live.armed) return;
		const slot = pinDragSlot(pinDragRowBoxes(), live.id, y);
		if (live.slot === slot) return;
		live.slot = slot;
		setPinDrag({ id: live.id, slot });
	};
	/**
	 * The indicator's own placement, in the section's own coordinates.
	 *
	 * A plain function called from the layout effect below rather than an effect body,
	 * for the board's reason: the line is placed AFTER the render that moved the
	 * landing. WHAT IT IS NOT, corrected in agent review round 1 (R2): it is NOT called
	 * from every frame of the auto-scroll loop, and it does not need to be - the line is
	 * positioned RELATIVE TO THE SECTION, so it scrolls with the rows it sits between
	 * and stays right without re-measurement while the list scrolls under it.
	 */
	const placePinDragIndicator = (id: string, slot: number) => {
		const section = pinnedSectionRef.current;
		const line = pinIndicatorRef.current;
		if (section === null || line === null) return;
		const others = pinDragRowBoxes().filter((box) => box.id !== id);
		const sectionTop = section.getBoundingClientRect().top;
		const edge =
			slot <= 0
				? (others[0]?.top ?? sectionTop + section.offsetHeight)
				: (others[slot - 1]?.bottom ?? sectionTop);
		line.style.top = `${Math.round(edge - sectionTop)}px`;
	};
	/*
	 * AUTO-SCROLL (item 6): the many-pins state puts rows past the scroller's own
	 * bottom, and a drop has to be reachable for them.
	 *
	 * One step per FRAME while the pointer is inside the edge zone, rather than on a
	 * timer, because the frame is what redraws the row boxes the DROP is measured
	 * against - a repeating timer fast enough to feel right would outrun the layout and
	 * the same step would be re-applied to stale boxes. The board's own loop, one axis
	 * over.
	 *
	 * WHAT EACH FRAME ACTUALLY REDOES (agent review round 1, R2, which corrected three
	 * comments here): the SLOT is re-derived from the boxes as they now are, so the
	 * landing the release will read (the gesture's own `live.slot`) follows the scroll.
	 * The INDICATOR is not re-placed per frame and does not need to be - it is placed
	 * relative to the pinned section, so it scrolls with the content it sits between.
	 */
	const PIN_DRAG_AUTO_SCROLL_ZONE_PX = 32;
	const PIN_DRAG_AUTO_SCROLL_STEP_PX = 12;
	const runPinDragAutoScroll = () => {
		pinDragAutoScrollRef.current = null;
		const live = pinDragRef.current;
		const scroller = listPanelRef.current;
		if (live === null || !live.armed || scroller === null) return;
		const rect = scroller.getBoundingClientRect();
		const y = pinDragYRef.current;
		const maxScroll = scroller.scrollHeight - scroller.clientHeight;
		let direction = 0;
		if (y - rect.top < PIN_DRAG_AUTO_SCROLL_ZONE_PX && scroller.scrollTop > 0)
			direction = -1;
		else if (
			rect.bottom - y < PIN_DRAG_AUTO_SCROLL_ZONE_PX &&
			scroller.scrollTop < maxScroll
		)
			direction = 1;
		if (direction !== 0)
			scroller.scrollTop += direction * PIN_DRAG_AUTO_SCROLL_STEP_PX;
		/*
		 * The SLOT is re-derived against the boxes this frame produces; the line itself
		 * rides the section (R2), so this is the landing following the content rather
		 * than the indicator being re-measured.
		 */
		applyPinDragOver(y);
		pinDragAutoScrollRef.current = requestAnimationFrame(runPinDragAutoScroll);
	};
	const stopPinDragAutoScroll = () => {
		if (pinDragAutoScrollRef.current === null) return;
		cancelAnimationFrame(pinDragAutoScrollRef.current);
		pinDragAutoScrollRef.current = null;
	};
	/**
	 * The grip's press: the ONLY place a drag begins.
	 *
	 * `preventDefault` is what stops the press becoming a text selection and a
	 * focus change (the grip is `tabIndex={-1}` and is never focused), and
	 * `stopPropagation` keeps it away from the row's own hover/click plumbing - a
	 * drag must not open the conversation it is rearranging. Capture is guarded: a
	 * synthetic pointer (a story's `userEvent`, a rig's dispatched move) owns no
	 * active pointer and `setPointerCapture` throws for one, which is the mesh
	 * canvas's rule and the reason the guard exists rather than a bare call.
	 *
	 * NOT ARMED YET, and that is the board's distinction: a press that never moves
	 * is a click on a control that does nothing, and it announces nothing and writes
	 * nothing. Arming on the first MOVE is also what keeps a stray press from
	 * announcing a drag the reader did not make.
	 */
	const startPinDrag = (
		sessionId: string,
		label: string,
		event: ReactPointerEvent<HTMLButtonElement>,
	) => {
		if (event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		try {
			event.currentTarget.setPointerCapture(event.pointerId);
		} catch {
			/* synthetic pointer: the dispatched moves still arrive here */
		}
		pinDragRef.current = {
			pointerId: event.pointerId,
			id: sessionId,
			label,
			armed: false,
			slot: -1,
		};
		pinDragYRef.current = event.clientY;
	};
	const movePinDrag = (event: ReactPointerEvent<HTMLButtonElement>) => {
		const live = pinDragRef.current;
		if (live === null || event.pointerId !== live.pointerId) return;
		pinDragYRef.current = event.clientY;
		if (!live.armed) {
			live.armed = true;
			setPinDrag({ id: live.id, slot: live.slot });
			/* The same family the pair and the chords announce in: the reader is told
			   the gesture began, so a cancelled drop is a change rather than a silence. */
			announcePinMove(`Moving “${live.label}”.`);
			if (pinDragAutoScrollRef.current === null)
				pinDragAutoScrollRef.current =
					requestAnimationFrame(runPinDragAutoScroll);
		}
		applyPinDragOver(event.clientY);
	};
	/**
	 * The drop (item 5): one write, or none at all.
	 *
	 * A DROP THAT LANDS WHERE IT STARTED WRITES NOTHING and says nothing
	 * (`movePinnedOrderTo` returns null for it, exactly as the board skips the commit
	 * for a column dropped at its own index): writing the on-screen order for a move
	 * nobody made would rewrite the preference for nothing and silently re-rank the
	 * dormant stored ids the reader never touched.
	 */
	const dropPinnedRow = (sessionId: string, slot: number) => {
		const label = rowLabel(sessionId);
		const next = movePinnedOrderTo(
			pinnedRows([...listed, ...heldRows], pinsEnabled).map(
				(row) => row.session_id,
			),
			view.pins,
			pinnedDrawnIds,
			sessionId,
			slot,
		);
		if (next === null) {
			/*
			 * A DROP THAT LANDS WHERE IT STARTED CLOSES THE GESTURE'S SENTENCE (UX round 1, U2;
			 * QA round 1, Q2). The arming announced "Moving “X”.", the drop wrote nothing (the
			 * correct outcome - `movePinnedOrderTo` refused), and the region was then left holding
			 * the OPENING sentence for the rest of its dwell, so the last thing a screen reader
			 * had been told about the gesture was that the row was being moved. The board's rule
			 * for the same case is that the region ENDS EMPTY - what happened is nothing, and the
			 * reader is told nothing rather than something untrue - so the sentence is cleared
			 * here, not replaced with a second one.
			 */
			announcePinMove("");
			return;
		}
		setChatSidebarView({ ...view, pins: next });
		/*
		 * The post-commit correction, by ID, exactly as `unpin` and the pair use it: the
		 * rows reorder in place, so the node the pointer was on is no longer where it
		 * was. `follow` is FALSE here - a pointer reader has no caret to restore - and the
		 * SCROLL correction stands down for the same reason it does on the chord path: an
		 * in-section swap moves the anchor row too, so correcting against it would shift a
		 * scrolled list by a whole row after every downward drop (R3).
		 */
		rememberMovedRow(sessionId, false, null, "row", false);
		const drawn = pinnedOrder(pinnedCatalogueIds, next);
		announcePinMove(pinMoveNote(label, drawn.indexOf(sessionId), drawn.length));
	};
	const settlePinDrag = (commit: boolean) => {
		const live = pinDragRef.current;
		pinDragRef.current = null;
		stopPinDragAutoScroll();
		setPinDrag(null);
		if (live === null || !live.armed) return;
		if (!commit) {
			/* The board's sentence: a cancelled gesture says so rather than leaving
			   "Moving …" standing in the region as the last thing the reader heard. */
			announcePinMove("Move cancelled.");
			return;
		}
		/*
		 * THE SLOT THE READER SAW, AND IT IS READ FROM THE GESTURE (agent review round 1,
		 * R1). `live.slot` is written SYNCHRONOUSLY by `applyPinDragOver` - it is the number
		 * the last move published, and the number the line was drawn from - while `pinDrag`
		 * is React state whose render may not have flushed at the moment a door fires. The
		 * drop must land where the INDICATOR was drawn rather than at a fresh hit test taken
		 * in the release's own tick: measured on this scene's first runs, a re-measure at the
		 * release answered 0 for a drag the indicator had drawn at the second row's bottom
		 * edge, because the boxes it read at that instant were not the ones the line had been
		 * placed against.
		 *
		 * THE FALLBACK IS GONE WITH IT, and that is R1's own reading rather than a risk taken
		 * here: arming calls `applyPinDragOver` in the press's own event, so `live.slot` is
		 * already >= 0 by the time any door can settle a committed gesture - a gesture that
		 * never armed takes the early return above, and every armed one has published a slot.
		 */
		dropPinnedRow(live.id, live.slot);
	};
	/*
	 * THE LATEST SETTLE, for the doors that are bound ONCE (agent review round 1, R1).
	 *
	 * Both effects below are gated on `pinDrag !== null`, so their listeners are created on
	 * the first armed render and kept for the rest of the gesture; a listener bound directly
	 * to `settlePinDrag` would hold THAT render's closure - its `view`, its
	 * `pinnedDrawnIds`, and the state the slot checks read. A door the grip does not own (a
	 * `pointerup` that reaches the window because capture was never taken, or the grip
	 * unmounted under a refresh) then dropped at a stale slot and wrote `{ ...view }` from
	 * a stale view, which can revert a view preference changed during the gesture. The ref
	 * is re-pointed on every render, so whichever door arrives calls the current function.
	 */
	const settlePinDragRef = useRef(settlePinDrag);
	settlePinDragRef.current = settlePinDrag;
	/* Escape cancels, the one drag state with no pointer of its own (the board's rule). */
	// biome-ignore lint/correctness/useExhaustiveDependencies: gated on the drag state, not on the per-render closures it calls.
	useEffect(() => {
		if (pinDrag === null) return;
		const onKeyDown = (event: WindowEventMap["keydown"]) => {
			if (event.key !== "Escape") return;
			settlePinDragRef.current(false);
			/*
			 * AND THE CLAIM IS STATED RATHER THAN INHERITED (UX round 1, U5; design round 1, D4).
			 *
			 * The UX round measured Escape during a drag cancelling the drag and NOT also
			 * interrupting a running turn, and traced the claim to a layer that happened to be
			 * under the pointer: the row's Radix catalog card, which the dwell needed to reach
			 * the grip had opened, and which claims Escape like every dismissable layer. D4 now
			 * suppresses that card for the whole gesture, so the claim has to come from the
			 * handler that acts on the press. Without this line the same Escape would reach
			 * `use-interrupt-on-escape.ts` and stop a running turn the reader was not
			 * addressing - the press was addressed to the drag.
			 *
			 * `preventDefault` after the settle, and the deferral there is what makes it work:
			 * that hook reads `defaultPrevented` once in a MICROTASK after the whole dispatch,
			 * so a claim made by a listener bound later than its own is still seen (`dispatchInterruptOnEscape`).
			 */
			event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown);
		return () => window.removeEventListener("keydown", onKeyDown);
	}, [pinDrag !== null]);
	/*
	 * THE GESTURE'S OTHER END, listened for on the WINDOW as well as on the grip.
	 *
	 * WHY BOTH: the grip's own `onPointerUp` is the reader's release and the door this
	 * lands on in the app; the window listener is what keeps a gesture from being left
	 * ARMED when the browser takes the pointer away - a `pointercancel` delivered
	 * anywhere (a capture the compositor drops, a context menu raised over another
	 * surface) settles the drag with no write rather than leaving the dragged row's mark
	 * and the indicator drawn for the rest of the session. `settlePinDrag` clears
	 * `pinDragRef` FIRST, so the two doors cannot double-write: whichever arrives second
	 * finds the gesture already gone.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: gated on the drag state, not on the per-render closures it calls.
	useEffect(() => {
		if (pinDrag === null) return;
		const end = () => settlePinDragRef.current(true);
		const cancel = () => settlePinDragRef.current(false);
		window.addEventListener("pointerup", end);
		window.addEventListener("pointercancel", cancel);
		return () => {
			window.removeEventListener("pointerup", end);
			window.removeEventListener("pointercancel", cancel);
		};
	}, [pinDrag !== null]);
	/* The auto-scroll loop follows the gesture, not the render (the board's rule). */
	useEffect(
		() => () => {
			if (pinDragAutoScrollRef.current !== null)
				cancelAnimationFrame(pinDragAutoScrollRef.current);
		},
		[],
	);
	/*
	 * The line is placed AFTER the render that moved it, because the boxes it is
	 * placed against are the ones on screen (`project-board.tsx`'s own rule for its
	 * indicator). The dependency is the whole drag state, so a re-render for any
	 * other reason does not re-measure it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the dependency is the drag state itself; the placement function is a per-render closure over the section's refs.
	useLayoutEffect(() => {
		if (pinDrag === null) return;
		placePinDragIndicator(pinDrag.id, pinDrag.slot);
	}, [pinDrag]);
	/*
	 * THE DRAFTS THAT OUTLIVE THEIR PANE (§C1's `Draft: <first line>` row; UX round
	 * 2's U8). The rule and its three conditions live in `draft-rows.ts`, because it
	 * has to be true of the state a RELAUNCH restores as well as of the state a ⌘N
	 * leaves behind - and a rule written inline here is reachable by no suite this
	 * repository has.
	 *
	 * HIDDEN WHILE A QUERY IS ACTIVE, on the list's own rule rather than a new one:
	 * a search answers "which conversations match these words", a draft has no
	 * conversation to match, and a row that could never match would sit above every
	 * result at the exact moment the reader is looking for one. Esc clears the field,
	 * so the way back is the same key that put them there.
	 */
	const listedSessionIds = useMemo(
		() => new Set(matching.map((row) => row.session_id)),
		[matching],
	);
	const draftRows = useMemo(
		() => untargetedDraftRows(drafts, inputByConversation, listedSessionIds),
		[drafts, inputByConversation, listedSessionIds],
	);
	/*
	 * THE ROWS `Clear all` MAY ACT ON: the listed rows minus the ones whose send hop
	 * is live (UX round 1's U2 - the store refuses those keys too, and the two
	 * lists have to agree or the count in the offer would promise more than moved).
	 * A failed claim is not pending and is clearable.
	 */
	const clearableDraftRows = draftRows.filter((row) => !row.pending);
	const page = pageRows(pageOrder(rest, view.orderBy), {
		limit: pageLimit(view.loads),
		currentId: selectedConversation,
		searching: query.trim().length > 0,
	});
	const liftedRow = page.lifted ? page.rows[0] : null;
	const pagedRows = page.lifted ? page.rows.slice(1) : page.rows;
	/*
	 * The two facts the foot needs, and the ref the extension reads - all three
	 * measured from the page rather than from `matching`, because `pageRows` works
	 * over the UNPINNED rows (`rest`) and a rung is spent against what the ladder
	 * draws.
	 *
	 * `ladderStep` is the size of the page the NEXT press asks for. On the paged
	 * path with nothing held past the rung it is the label's only true number: the
	 * rows a press reveals are the rung's, whatever the daemon has behind its
	 * cursor.
	 */
	ladderHoldsRowsRef.current = page.remaining > 0 || view.hidden.length > 0;
	const ladderStep = pageLimit(view.loads + 1) - pageLimit(view.loads);
	const tailMore = groupPaging && catalogueHead.tailCursor !== null;
	/*
	 * THE FOOT'S PRESS: SPEND THE RUNG, AND FOLLOW THE CURSOR WHEN THE RUNG IS
	 * BEYOND WHAT IS HELD. The two are one gesture because the reader asked for one
	 * thing - more chats - and which of them happens is a fact about the daemon
	 * (five hundred rows asked for, fifty arrived) rather than a choice the reader
	 * should have to make. `rest` rather than `pagedRows`, because the rung counts
	 * the rows the page is taken over and a lifted row is drawn outside it.
	 */
	const pressPageMore = () => {
		const next = view.loads + 1;
		setChatSidebarView({ ...view, loads: next });
		if (!groupPaging) return;
		if (pageLimit(next) > rest.length) void fetchCatalogueTail();
	};
	/*
	 * WHETHER ANYTHING IS VIEWER-SET, which is what the band's middle button's
	 * fill means. It is a comparison against the DEFAULT rather than a flag
	 * written when the panel is used, because the flag can disagree with the
	 * view the moment a future field joins the model and is not reset with it.
	 *
	 * `view.pins` JOINS IT FOR THAT REASON AND NOT BECAUSE THE POPOVER CAN UNDO IT
	 * (issue #693): the pill means "the reader has arranged this column", and the
	 * pinned order is an arrangement exactly as the section order beside it is - a
	 * state no control in the popover produces, which is already true of `loads`, the
	 * ladder's own click counter. Leaving it out would light the pill for a moved
	 * SECTION while saying nothing about a moved ROW, which is the same two states in
	 * two registers. The column is un-arranged by moving the rows back and by
	 * unpinning, which is what `forgetPinnedOrder` prunes on.
	 *
	 * `view.pinnedAgents` joins on the same rule (issue #663): it is the ROSTER's
	 * own arrangement, one field over - a press on an agent row, produced by a
	 * control no popover owns exactly as the row order above is - so the pill lights
	 * for it for the reason the paragraph gives rather than for the reason a reader
	 * might go looking for a setting the popover does not draw.
	 */
	const viewIsCustom =
		view.groupBy !== DEFAULT_SIDEBAR_VIEW.groupBy ||
		view.basis !== DEFAULT_SIDEBAR_VIEW.basis ||
		view.orderBy !== DEFAULT_SIDEBAR_VIEW.orderBy ||
		view.hidden.length > 0 ||
		view.loads > 0 ||
		view.pins.length > 0 ||
		view.pinnedAgents.length > 0 ||
		view.order.some((key, index) => key !== DEFAULT_SIDEBAR_VIEW.order[index]);
	/*
	 * §C1's sections over the loaded page (`chat-list-sections.ts` carries the
	 * rules), the sections the popover has switched OFF removed, and the rest in
	 * the reader's own order - `shownSections` is that order, and it is the same
	 * one the region boundary's arrows write to. The basis is the view's, so the
	 * bins, the row labels and the popover's counts below all read one clock.
	 */
	const sectioned = sectionRows(pagedRows, listNow, view.basis);
	const drawnSections = shownSections(view).filter(
		(key): key is ChatListSection => key !== "pinned" && !isEntitySection(key),
	);
	const pinnedShown = isSectionShown(view, "pinned");
	/*
	 * §C1's sections over the unpinned rows (`chat-list-sections.ts` carries the
	 * rules), and the first one that has rows - the header the bulk read receipt
	 * sits on.
	 */
	const firstSection =
		drawnSections.find((key) => sectioned[key].length > 0) ?? null;
	/*
	 * The counts the view popover prints beside each section's switch, so the
	 * panel says what it is switching OFF. Zero draws nothing (the panel's own
	 * rule), and the `Pinned`/`Agents`/`Teams` counts come from the same sources
	 * their sections render from, rather than from a second read.
	 */
	const viewCounts: Partial<Record<SidebarSectionKey, number>> = {
		pinned: pinned.length,
		running: sectioned.running.length,
		today: sectioned.today.length,
		week: sectioned.week.length,
		older: sectioned.older.length,
		agents: ownAgents.length,
		teams: teams.data?.length ?? 0,
	};
	/*
	 * THE ROSTER'S ORDER AND ITS FILTER (issue #663), both from
	 * `chat-sidebar-agents.ts` - the rules and their reasons live in that
	 * module, and this memo only feeds them. Two deliberate reads:
	 *
	 *   - the rows carry `id: profile.name` because THAT is the profile wire's
	 *     stable key: the wire publishes no separate id, `profiles.update`
	 *     cannot rename (its `fields` carry no name), and the one id-like
	 *     field, `agent_id`, is null for builtins - the module's header
	 *     carries the finding in full, so a pin cannot be orphaned by an edit
	 *     and the day a real id ships, only this row build changes;
	 *   - recency reads `sessions`, the canonical store's own page: the
	 *     fullest set in hand and the only one nothing else narrows. `listed`
	 *     is what the lists DRAW (archived partitioned out) and `matching` is
	 *     that under the search box, so either would re-sort the roster under
	 *     a control that has nothing to do with it.
	 */
	const agentRows = useMemo(
		() =>
			orderAgentRows(
				ownAgents.map((profile) => ({ id: profile.name, name: profile.name })),
				{
					pinned: view.pinnedAgents,
					recency: (row) => agentRecencyMs(sessions, row.name),
				},
			),
		[ownAgents, view.pinnedAgents, sessions],
	);
	/*
	 * WHETHER THE ROSTER'S FIELD IS DRAWN - and with it whether the filter it
	 * carries may NARROW anything, because the two move together.
	 *
	 * THE LIFECYCLE BUG THIS CLOSES (design round 1's D2, agent review's B3, UX
	 * round 1's U3 are one defect): the first cut gated the field on the cap
	 * alone, so a filter could outlive its field - collapse Agents and type in
	 * the list search (which force-opens the rows without expanding the
	 * section), or let the roster shrink to the cap while a filter is applied -
	 * and the section then drew a narrowed subset, or the empty sentence, under
	 * a field that was not on screen, with no X and no Escape to clear it.
	 *
	 * THE GATE IS THE FIELD'S OWN QUESTION, so `rosterFilter` joins it: the
	 * field draws while the section is expanded AND (the roster is cap-bound
	 * OR a filter is applied). A filter that survives a shrink of the roster
	 * therefore keeps its field - the pair stays on screen together and the
	 * reader keeps the control that clears it - rather than the filter being
	 * silently dropped, which would be a second surprise. And the rows branch
	 * below reads THIS value rather than re-testing `rosterFilter`, so there is
	 * exactly one spelling of "the filter applies": whenever it is false the
	 * section draws its cap path and no stored filter can narrow anything
	 * invisibly.
	 *
	 * AND A LIST QUERY THAT KEEPS THE SECTION DRAWN KEEPS ITS FIELD (UX round 1's
	 * U2, design re-check round 3). The section BODY draws while
	 * `query || isOpen("agents", true)`; this gate read the disclosure alone, so the
	 * heading press that the panel documents as a deliberate no-op under a query - it
	 * must not release the raised cap - still REMOVED the field under the reader
	 * (measured: `Filter agents` present -> absent, section box 413px -> 369px, rows
	 * unchanged). A control that vanishes under a press that promises to change
	 * nothing on screen is the defect, and the body's own gate is what fixes it.
	 *
	 * THE RULE ITSELF LIVES IN `rosterFieldShown` (chat-sidebar-view), hoisted so the
	 * press can be MODELLED by `scripts/chat-sidebar-view.test.mjs` instead of matched
	 * as source text: the round-2 pin here was a source-string assertion and could not
	 * see that a narrower clause - one that ALSO required `rosterFilter` - was inert in
	 * U2's own state (a list query with no section filter). The first clause is the
	 * body's gate; the second is untouched, so a query alone still opens nothing over a
	 * short roster. This call site is the ONE place the component asks the question.
	 */
	const rosterFilterShown = rosterFieldShown(
		isOpen("agents", true),
		query,
		rosterFilter,
		ownAgents.length,
	);
	const filteredAgents = useMemo(
		() => filterAgentRows(agentRows, rosterFilter),
		[agentRows, rosterFilter],
	);
	/*
	 * THE MATCHES THAT ACTUALLY DRAW (UX round 1's U1), which is a different set
	 * from the matches: the LIST's query narrows the whole column, and an entity
	 * whose name carries neither the query nor any surviving row is dropped by
	 * `entity`'s own gate. The empty sentence must count what DRAWS, or it goes
	 * silent in the one state the two filters make together - roster filter on,
	 * list query excludes every admitted agent - and the section is a blank gap
	 * under a field that says nothing. `entityQueryAdmits` is the gate's own
	 * rule, called by both the row and this count so the two cannot drift.
	 */
	const drawnFilteredAgents =
		rosterFilterShown && rosterFilter.trim()
			? filteredAgents.filter((row) =>
					entityQueryAdmits(
						row.name,
						scopeRows("agent", row.name).length,
						query,
					),
				)
			: [];
	/*
	 * THE VIEW AS `entity` CAN SEE IT. The roster's pin control needs the PARSED
	 * view, and `entity`'s own body already names `view` for the group's chats
	 * view (`groupChatsView`'s result) - a shadow this alias steps around rather
	 * than renames, because that name is load-bearing across a dozen lines below
	 * it. The alias is also what keeps ONE read of the parsed view: both the
	 * pinned lookup and the toggle write go through it.
	 */
	const sidebarView = view;
	const draft = activeDraftKey ? drafts[activeDraftKey] : undefined;
	const bindingName = (row: CanonicalSessionRow) =>
		row.binding?.team || row.binding?.agent || "";
	/*
	 * The row's TEAM alone — `bindingName` falls through to the agent, and the
	 * agent-opened slot's decision turns on the difference (see the rule's own
	 * `team`): a workstream with no team draws nothing, so the string the rule
	 * reads and the string the row draws have to be THIS one and not the
	 * fall-through.
	 */
	const teamName = (row: CanonicalSessionRow) => row.binding?.team ?? "";
	/*
	 * THE BINDING AS A READER SAYS IT, for the two human channels the binding
	 * reaches (the row's `· <binding>` slot and the flyout's `(...)` clause): a
	 * TEAM binding resolves through the label lookup, an agent name passes
	 * through untouched. Deliberately a SIBLING of `bindingName` rather than a
	 * change to it - `bindingName` is also what `rowTrailingStatement` and the
	 * stutter rule read to DECIDE, and decisions stay on the slug; only what the
	 * pixels and the flyout SAY changes.
	 */
	const bindingDisplayName = (row: CanonicalSessionRow) => {
		const team = row.binding?.team;
		if (team) return teamLabelFor(team);
		return row.binding?.agent ?? "";
	};
	/*
	 * Who opened a conversation, when an AGENT did rather than the operator.
	 *
	 * Read from the PRESENCE of `opened_by`, never from the members inside it: the
	 * wire documents that a requesting side may be entirely unknown while the fact
	 * that an agent opened the row is certain (`SessionOpenedBy` in
	 * `desktop-session-contract.ts`), and the fact kept its own claims for exactly
	 * that reason — on 2026-09-18 an agent-opened session sat in this list
	 * indistinguishable from a chat the operator had opened himself.
	 *
	 * Three callers of one fact, and the SPLIT between them is the design round 1
	 * remediation (D1, D2), re-cut when the slot's claim became the TEAM (operator
	 * ask, 2026-09-25):
	 *
	 *   - `agentOpenedRow` is the presence test the rule takes, because presence is
	 *     the fact (`SessionOpenedBy` may hold three nulls).
	 *   - the ROW draws the TEAM the workstream serves (`· <team>`), or nothing
	 *     when it serves none — the decision and its why live in
	 *     `rowTrailingStatement`, which is also where the removal of the constant
	 *     marker is recorded. The drawn team is user-authored text, so it wears the
	 *     binding slot's bounded, truncating treatment rather than a literal's.
	 *   - `openedBySentence` names the agent, and feeds the two channels where a
	 *     name costs no pixels and the fact must survive: the row's flyout
	 *     (`rowTooltip`) and the row's screen-reader sentence.
	 *
	 * WHY THE SENTENCE IS WHERE THE FACT LIVES — and it is measured rather than
	 * preferred. At the panel's default 280px the row is 263px wide, and the NAMED
	 * form (`· opened by coder`) measured 117px, its whole 45% cap, which was the
	 * binding slot's and had been measured for a 45px string. That left the title
	 * 77px of its 228px: the marker drew wider than the label beside it and the
	 * conversation's own name, the thing the row exists to show, was a stub. The
	 * name is the only variable part, so the drawn form dropped it (design round
	 * 1, D1, for that round's form of the claim). The slot's claim has since
	 * changed and its string is now the team — bounded the same way the binding
	 * slot is, so it truncates inside its cap rather than starving the title —
	 * and the sentence keeps the half no bounded slot can hold: the requester's
	 * name, and the fact the row is not one of the operator's own.
	 *
	 * WHAT THAT TRADES AWAY, named rather than implied: the agent's name is not in
	 * the row's pixels (it is one dwell away in the row's flyout, it is in the
	 * accessible name, and in the panel's `Agents` section it is on the entity row
	 * the conversation is filed under), and on a team-less workstream the pixels
	 * carry no provenance at all — the flyout and the `sr-only` sentence are the
	 * channels there, the arrangement a marked or unstarted agent-opened row
	 * already used. What the pixels keep is the half a reader acts on: the team
	 * the workstream serves.
	 *
	 * The label is deliberately not drawn either: it is a conversation NAME
	 * ("Harden lop secret against agent credential leaks"), it is arbitrarily long,
	 * and the trailing slot is the one place on this row where a long string costs
	 * the title its width.
	 *
	 * `.trim()` wherever a member is read, because an empty agent name is a name the
	 * backend could not resolve rather than an identity: `opened by ` with nothing
	 * after it would be the claim with its answer missing. The wire's `session` is
	 * not rendered — an opaque id names nothing a reader of this row can act on —
	 * and stays typed for whichever surface can use it.
	 */
	const agentOpenedRow = (row: CanonicalSessionRow) => row.opened_by != null;
	const openedBySentence = (row: CanonicalSessionRow) => {
		const agent = row.opened_by?.agent?.trim();
		return `opened by ${agent || "an agent"}`;
	};
	const openedByNote = (row: CanonicalSessionRow) => {
		if (!row.opened_by) return "";
		const label = row.opened_by.label?.trim();
		return `, ${openedBySentence(row)}${label ? ` in “${label}”` : ""}`;
	};
	/*
	 * The binding clause, and the ONE case it is dropped: when the attribution in
	 * the same sentence names the same agent, `… (coder): Recent, opened by coder in
	 * “…”` reads as a stutter on exactly the row the marker was added for (review
	 * round 1's n3, and the design round's NIT). Nothing is lost by dropping it —
	 * the clause that follows still carries the name — so the flyout stays at least
	 * as wide as the pixels, which is the property the row's own comment claims.
	 */
	const bindingClause = (row: CanonicalSessionRow) => {
		const name = bindingName(row);
		if (!name) return "";
		if (row.opened_by?.agent?.trim() === name) return "";
		/*
		 * The drawn value is the READER's: a team binding reads as its label. The
		 * stutter test above stays on the raw slug, because it asks whether the
		 * attribution names the same profile - a decision, not a rendering.
		 */
		return ` (${bindingDisplayName(row)})`;
	};
	/*
	 * The two states the box can be in while it has no answer, and why they are
	 * states rather than silence.
	 *
	 * `answered` is the answer to the question IN THE BOX (exact, per
	 * `hitsAnswerQuery`). Anything else — a request in flight, a keystroke that
	 * invalidated the previous answer — means the list below holds name and label
	 * matches only, and that is a fact the panel has to say out loud: the list
	 * visibly drops the conversation matches it was just showing, which reads as a
	 * bug unless the state is named (review round 1, R2 — which the prefix rule
	 * tried to fix, and review round 2, R10, which showed the prefix rule put rows
	 * in the list that the box's own search would not return).
	 *
	 * It is also the gate for the no-match claim: `Nothing in your chats matches
	 * X` while the answer for X has not arrived asserts, then retracts a moment
	 * later (review round 2, R11 — `isFetching` is FALSE while the debounce is
	 * still empty, because the query is not enabled until the debounced value is
	 * non-empty, so the sentence fired on every keystroke of a word).
	 */
	const answered = hitsAnswerQuery(search.data, query);
	/*
	 * What the list was showing while the LAST answer was still in hand.
	 *
	 * The in-flight line exists to explain a visible COLLAPSE — round 1's R2: the
	 * box has moved on, the answer in hand is stale, and the list falls back to
	 * name and label matches, so the conversation matches it was showing
	 * disappear. The line therefore has to fire on the SHRINK, not on emptiness:
	 * gated on `!matching.length` it spoke in the one state where nothing had
	 * visibly changed, and stayed silent in the state it was written for (review
	 * round 3, R17 — reproduced there on a seeded store: two rows with one marked,
	 * then one row with none, and no explanation for the lost row or the lost
	 * mark).
	 *
	 * `search.data` still holds the previous query's answer (the cache is keyed
	 * per query string and `keepPreviousData` serves the last one), so the
	 * comparison is against a real answer rather than a remembered count:
	 * `searchChats` over the STALE query says what that answer would have shown,
	 * and the line appears when it would have shown more than the local fallback
	 * does now.
	 */
	const previous = useMemo(() => {
		if (answered || !search.data || !query.trim()) return null;
		return searchChats(
			[...listed, ...heldRows],
			search.data.query,
			search.data.sessions,
			pinFactValues,
			archiveView,
			bindingOfHit,
			/* The same label arm as the live join (round 1, R1-3c): the
			 * comparison has to price the stale answer against the local
			 * fallback under ONE matching rule, or the line can claim a
			 * difference that is only the two calls disagreeing. */
			teamLabelFor,
		);
	}, [
		answered,
		search.data,
		listed,
		heldRows,
		pinFactValues,
		archiveView,
		bindingOfHit,
		teamLabelFor,
		query,
	]);
	// `!search.isError`: a FAILED search never produces an answer, so without this
	// term `awaiting` stays true forever and `Searching conversations…` sits under
	// the failure notice that says the search is unavailable — the panel claiming
	// to be looking while telling the user it cannot look (design round 3, D16).
	// The notice is the whole truth in that state, and nothing else should speak.
	const awaiting =
		Boolean(query.trim()) &&
		ready &&
		searchSupported &&
		// An over-long query issues no request at all, so "searching…" would be a
		// claim about work that is not happening; the notice beside it says what
		// is.
		!overLong &&
		!search.isError &&
		!answered;
	/*
	 * The mark explaining a row is a trailing slot OUTSIDE the truncating title
	 * span, so the title truncates and the mark cannot be clipped away — with a
	 * long title the ellipsis used to eat it, on exactly the row whose mismatch is
	 * hardest to explain (design round 1, D1).
	 *
	 * It is rendered on the rows that carry it and NOT reserved list-wide. The
	 * reservation was the first attempt, and design round 2 (D9) measured what it
	 * cost: every title in a list containing one marked row lost ~39% (70px of
	 * 179px; ~46% on nested rows), including `Retention sweep notes` — a row that
	 * matched by its own NAME, whose query is visible inside its own title, and
	 * which therefore paid to explain a DIFFERENT row. The ragged right edge a
	 * per-row mark produces is the panel's existing condition: `· coder`,
	 * `· Not sent yet` and bare rows already end at three different x positions.
	 */
	// A first send that failed after allocation but before admission leaves a real
	// but empty session. It is NOT hidden — it exists on the backend and hiding it
	// would make the list lie — but a draft still holding its id means no send has
	// completed for it, so say so instead of showing it as an ordinary untitled
	// chat. ("No send has completed" rather than the stronger "it never carried a
	// message": `finishDraft` clears the draft on send COMPLETION, so a session
	// whose first send is still in flight is drawn as unstarted for that window —
	// the same caveat `forkable`'s own comment states.)
	const unstarted = useMemo(
		() =>
			new Set(
				Object.values(drafts)
					.filter((item) => item.sessionId)
					.map((item) => item.sessionId as string),
			),
		[drafts],
	);
	/*
	 * THERE IS NO PER-ROW BROWSER CONTROL ANY MORE (operator ask, 2026-09-18).
	 *
	 * The mark that used to sit here is deleted rather than hidden, and the reason is the
	 * operator's own: it was a corner affordance on EVERY conversation row (design R2,
	 * and review round 1's D2/A4 that made it unconditional), which cost every title its
	 * 28px for a control used rarely, and the slot is wanted for the hover-revealed pin
	 * he asked for in the same breath. The current conversation's browser is opened from
	 * the header's Globe trigger, which stays.
	 *
	 * WHAT THAT COSTS, STATED SO THE DELETION IS NOT READ AS FREE - the full inventory, not
	 * its first line, because four review streams found the shorter version under-listed it
	 * (code review R3, design D3, UX U1, QA Q17/Q18 on PR #345):
	 *
	 *  - a conversation that is NOT the current one can no longer have its browser opened
	 *    from this list without being selected first (the header's Globe follows the
	 *    selection, so `select, then press the Globe` is the path that survives);
	 *  - this list was the only place OUTSIDE the browser showing a conversation's tab
	 *    COUNT and its LOADING state, for any conversation, the current one included -
	 *    the header's badge carries approvals only;
	 *  - it was the only surface reporting ANOTHER conversation's pending browser approvals
	 *    without opening the browser: the header's badge counts this conversation only, so
	 *    it is null for a foreign request. That capability came back on 2026-09-23, on the
	 *    APP RAIL rather than per row (`sidebar-navigation.tsx`'s Browser item counts every
	 *    live request in the projection, unattributed ones included) - so what went with
	 *    the mark is the per-row statement, not the app-wide one;
	 *  - it was the only thing that NORMALISED the pane's lens on the way in. The pane's
	 *    scope is one sticky preference (`ui-preferences-store.ts:452`, read at
	 *    `browser-pane.tsx:89`) which the deleted handler reset to the conversation. With
	 *    the pane last left on `All tabs`, that is where it stays: the in-pane switch is
	 *    the way back. (The header's Globe USED to be unmounted while the pane was open,
	 *    which made that switch the only way back at all; since 2026-09-23 the trigger
	 *    stays mounted as a toggle with its `aria-expanded` cue, so the pane can be closed
	 *    from the bar again - but nothing normalises the LENS, and that half is still
	 *    open.)
	 *
	 * One surface outside this component still reports another conversation's approvals
	 * without the rail: `src/main/browser/consent-notifier.ts` raises a native "Site
	 * approval needed" banner naming the count and the oldest origin, focus-gated and
	 * naming no conversation. It is unobservable in this repo's headless rigs (native
	 * banners are suppressed there), so that is a record of what the code does rather than
	 * a measurement.
	 */
	const sessionRow = (row: CanonicalSessionRow, nested = false) => {
		const trailing = rowTrailingStatement({
			marked: conversationMatches.has(row.session_id),
			unstarted: unstarted.has(row.session_id),
			nested,
			binding: bindingName(row),
			team: teamName(row),
			agentOpened: agentOpenedRow(row),
		});
		const pinned = row.pinned === true;
		/*
		 * THE REMOTE HALF OF THE ROW (the shared convention): one predicate and the
		 * ONE FRAGMENT PER LINE, built here and read by both channels - the
		 * `sr-only` spans beside the title and the flyout's own lines below - so
		 * neither can drift: the location clause (`on <device> · <network>`) and,
		 * on a row whose owner did not answer, the unreachable line
		 * (`unreachable · <reason>`) as its OWN line rather than fused onto the
		 * device clause (design review round 1, D2). The network name is looked up
		 * by the owner's id; a device the networks read cannot name degrades to the
		 * device clause alone.
		 */
		const remote = row.locality === "remote";
		const remoteHost = remote
			? remoteClause(
					row,
					remoteNetworkNames.get(
						typeof row.owner_device === "string" ? row.owner_device : "",
					),
				)
			: "";
		const remoteUnreachable = remote ? remoteUnreachableClause(row) : "";
		/*
		 * THE SUBAGENT INDICATOR (the operator's report, 2026-09-29).
		 *
		 * One derivation, two independent glyphs, and it is here rather than in
		 * `ChatSessionStatus` for the reason the design spec gives: the mark sits
		 * AFTER the title so the title's leading edge never moves. A mark in the
		 * leading cluster would push the title 18-36px right and back every time a
		 * count crossed zero, and on an active fleet that is every few minutes -
		 * content motion in the row's primary reading line, which
		 * `docs/design/sidebar-row-space.md` §2 states as the invariant this row is
		 * not allowed to break ("The row's box, its height, and the title's leading
		 * edge never move; what moves is the title's clip").
		 *
		 * What that costs: on a long title the mark lands after the ellipsis, so a
		 * crowded sidebar draws it at one consistent column instead of a ragged one.
		 *
		 * Nothing here is interactive and nothing is focusable: the mark adds no
		 * press target, no hover affordance and no stop to the tab walk. The words
		 * ride the row's own accessible name and tooltip (below), which is what
		 * keeps the pointer and screen-reader channels no narrower than the pixels.
		 */
		const marks = subagentMarks(row);
		/**
		 * THE ROW'S OWN PRESS, shared by the row's button and by the team mark inside it.
		 *
		 * Extracted for the mark's sake: the mark is a focus stop (below), and a stop
		 * that does nothing when pressed is a dead one (UX round 1, U1 measured Enter on
		 * it leaving the row's click listener unrun). Sharing the row's own handler -
		 * rather than calling `onSelectConversation` from the mark - is what keeps the
		 * drop-repeat guard and any later term in this press applying to both routes.
		 *
		 * `point` is the press's screen position, or `null` when there is none: the
		 * row's button passes its event's coordinates, the keyboard passes `null`, which
		 * is the same value the button's own Enter/Space press hands the guard.
		 */
		const pressRow = (point: { x: number; y: number } | null) => {
			if (dropRepeatPress(point, row.session_id)) {
				return;
			}
			onSelectConversation(row.session_id);
		};
		/*
		 * THE TEAM MARK, AND THE ONE THING THE ROW HAS TO TELL THE SIDEBAR ABOUT IT.
		 *
		 * The bubble owns its own tooltip (the full team name on hover and on focus),
		 * and the row's box owns the flyout - so this wrapper is what reports which of
		 * the two surfaces the pointer or the keyboard is on (`teamBubbleHovered` /
		 * `teamBubbleFocused`), which is what lets the flyout stand down while the mark
		 * is speaking.
		 *
		 * `ml-1` sits on the wrapper rather than on the bubble so the gap is the same
		 * 4px step the trailing slots before it used, and `inline-flex` keeps the row's
		 * own flex line untouched. The four handlers are `onPointerEnter`/`Leave` and
		 * `onFocus`/`onBlur` (the latter two bubble from the mark inside, which is the
		 * element that takes focus), and they are deliberately not one pair: a pointer
		 * that leaves the mark while the keyboard still holds it must not re-arm the
		 * flyout (R1-M5).
		 *
		 * `onActivate` is the row's own press, so Enter or Space on the mark is the row's
		 * act rather than a dead stop (UX round 1, U1).
		 */
		const teamMark = (name: string, slug: string) => (
			<span
				className="ml-1 inline-flex shrink-0"
				onPointerEnter={() => setTeamBubbleHovered(row.session_id)}
				onPointerLeave={() => setTeamBubbleHovered(null)}
				onFocus={() => setTeamBubbleFocused(row.session_id)}
				onBlur={() => setTeamBubbleFocused(null)}
			>
				<TeamAvatarBubble
					name={name}
					slug={slug}
					onActivate={() => pressRow(null)}
				/>
			</span>
		);
		/*
		 * THE SENTENCE, computed once beside the marks because THREE call sites read
		 * it - the row's `sr-only` name, the question of whether that name needs a
		 * span at all, and the tooltip's own line - and this is a per-row derivation
		 * in a list that re-renders on every feed frame. One value, so the three
		 * cannot disagree about whether a row has anything to say.
		 */
		const subagentSentence = subagentClause(row);
		/** The row's own name, used by the archive control's accessible name and tooltip
		 * and by the marker's `sr-only` sentence: one string, so the two channels cannot
		 * name the same row differently. */
		const label = row.title || "Untitled chat";
		/*
		 * ARCHIVED, as THIS row knows it: the wire's value, or the client's own when it
		 * has written one that this row's answer predates (`archiveFacts` - the same
		 * precedence the search join applies, read here for the rows the page holds).
		 *
		 * The fact is what makes the press INVERT: the row is rebuilt from the store on
		 * every render, so a press that only wrote the backend would read back the state
		 * the catalogue last saw, and the control could never undo its own press.
		 */
		const archived = archiveFactValues[row.session_id] ?? row.archived === true;
		/** The row is the CURRENT one, read ONCE and shared by the wrapper and the button:
		 * two elements paint one state, so two copies of this expression would be two chances
		 * for them to disagree (review round 1, A7 — a predicate spelled more than once is
		 * what let the deleted browser mark paint its hover fill over the selected row). */
		const current = selectedConversation === row.session_id && !activeDraftKey;
		/*
		 * WHETHER THIS ROW CARRIES THE MENU AT ALL, read once beside `current` for
		 * the same reason: three consumers hang off it - the button's
		 * `aria-describedby` list, the clause that id names, and the trigger itself
		 * - and three copies of the predicate would be three chances to disagree.
		 * With neither capability the menu does not exist (the withdrawn path
		 * returns before it), and this is what keeps its clause off that row.
		 */
		const menuEnabled = pinsEnabled || archiveEnabled;
		/*
		 * WHETHER THE MENU OFFERS FORK ON THIS ROW - the one named predicate, read
		 * once, for the item below. A fork copies a conversation's TRANSCRIPT, and the
		 * backend refuses a session that has none ("has no transcript to fork",
		 * `fork.py::fork_session`). `unstarted` is this sidebar's own, existing
		 * statement of that state: a draft that holds this conversation's id (the row
		 * reads `, not sent yet`) - the real-but-empty session a first send that failed
		 * after allocation leaves behind. Offering Fork there would open a picker whose
		 * only possible answer is that refusal, so the item is WITHHELD (never
		 * disabled), by a statement the row already makes rather than a condition
		 * invented for the menu.
		 *
		 * WHAT THE PREDICATE ACTUALLY READS, stated exactly (round-1 agent review, NIT
		 * 6; QA round 1, Q1): a session with NO DRAFT ROW STILL HOLDING THIS ID. That
		 * is not the same sentence as "it never carried a message". `finishDraft`
		 * deletes the draft on SEND COMPLETION (`canonical-sessions-store.ts`), not
		 * when the transcript appears, so during an in-flight first send - and until a
		 * late delivery reconciles the draft - a session whose transcript already
		 * exists is still withheld from Fork. The window is narrow and self-healing,
		 * and the row says `, not sent yet` throughout it, so the trade is deliberate:
		 * the refusal it avoids is the picker's dead end, and the alternative is an
		 * item that opens onto an error.
		 *
		 * AND THE BOUNDARY, named rather than implied (QA round 1, Q1): a session with
		 * no transcript and NO draft row at all - one another client created, or one
		 * left after the drafts' own discard act, which deletes the draft and never
		 * touches the session - is NOT distinguishable renderer-side, because the draft
		 * store is the only local evidence of it. Fork is offered there and the
		 * picker's answer is the backend's refusal sentence, which is the same refusal
		 * any un-forkable session gets from `/fork` and the palette. A cheap true
		 * signal would be a transcript-presence field on the catalogue row; there is
		 * none today, and inventing a second local condition here would be a guess
		 * where the route already answers.
		 *
		 * What is NOT a gate, checked rather than assumed: `row.pending`. It is the
		 * live record's "waiting for a person" word (`approval`/`ask`, a parked gate:
		 * `session/runtime/types.py`, written by the runtime and surfaced by
		 * `sessions.list`'s row builder in `session/catalog.py`), which only a session
		 * that has already run a turn can carry - one with a transcript - and the
		 * route does not refuse it: a session that is mid-turn takes the fork at its
		 * next safe boundary (the picker's own copy says so), an idle or cold one is
		 * cloned at once, read-only against the parent. No other state of a catalogue
		 * row makes the route refuse, so this is the menu's only withheld condition.
		 */
		const forkable = !unstarted.has(row.session_id);
		/**
		 * WHICH CHORD SPELLING THIS PLATFORM PRINTS, read once for the row's two
		 * items. `chatRowActCapJoined` takes `isMac` rather than reading the
		 * platform so the strings stay testable; the read itself is the same one
		 * the transcript's link toolbar and the undo manager use.
		 */
		const isMac = menuIsMac();
		/*
		 * THE HELD STATE: whether THIS row's menu is open, from the sidebar's one
		 * piece of menu state. The hold's consequences are ordinary conditional
		 * classes below (`menuOpen && ...`): the box's ground, both glyphs and the
		 * pair wrapper. They cannot come from `:hover`, because while the menu is
		 * open its portal is modal and the pointer cannot hover the row at all.
		 */
		const menuOpen = openMenuRowId === row.session_id;
		/**
		 * Whether this row is the one being DRAGGED (issue #697), read once for the same
		 * reason `current` is: the box wears the mark twice - the `data-dragging`
		 * attribute the rigs and the stylesheet read, and the ground step it draws - and
		 * two copies of the predicate are two chances for the row to be marked and
		 * unmarked at once.
		 */
		const dragging = pinDrag?.id === row.session_id;
		/**
		 * WHETHER THIS ROW OFFERS THE REMEDY, read once for the same reason `current` is —
		 * it decides three things now (the tooltip's tail, the `aria-describedby` and the
		 * sentence that id names), and three copies of the predicate would be three
		 * chances for the row to point at a sentence it is not rendering.
		 */
		const silent = row.status?.code === "wedged";
		/**
		 * WHAT THE RECEIPT IS DOING FOR THIS ROW, if it has anything to say - read once
		 * for the reason `silent` is: it decides the flyout's tail, the
		 * `aria-describedby` below and the sentence that id names, and three copies of
		 * the question would be three chances for the row to point at a sentence it is
		 * not rendering. Both strings come back together (`readAckCopy`), in the two
		 * registers the two channels need. THE ROW'S OWN DEVICE NAME goes with them
		 * (the remote class alone speaks it, `readAckCopy`'s own note): it is the one
		 * place a device's name is data rather than prose, and a row that does not
		 * know one gets the unnamed clause.
		 */
		const readAck = readAckCopy(
			readAckNotice,
			row.session_id,
			typeof row.owner_device_name === "string" ? row.owner_device_name : null,
		);
		/*
		 * THE ROW IS A WRAPPER PLUS A BUTTON, and it keeps that shape now that the per-row
		 * browser mark is gone (operator ask, 2026-09-18; the reasoning is at
		 * `sessionRow`'s own note above). The wrapper paints the CURRENT-STATE ground and the
		 * button paints it again because `rowStyle`'s own `hover:` step is the only
		 * thing that beats the step it inherits — ONE state spread over two elements by the
		 * DOM, the shape `rowStyle`'s docstring already describes for the entity row, and
		 * `scripts/chat-sidebar-selection.test.mjs` resolves both expressions through the
		 * shipped `cn` rather than looking for a class name.
		 *
		 * THE WRAPPER AND THE `group` HOOK. The wrapper carries `data-session-row`, the
		 * hook the pins harness and this file's CURRENT table address the row by, and it
		 * carries `group` for exactly the reason it exists: something inside READS it now
		 * (`group-data-[session-hover-intent]`/`group-focus-within` on the two acts), and
		 * a hook an element reads is the only kind worth carrying. The `w-full` ->
		 * `min-w-0 grow` note on the button below is main's and still holds: a
		 * full-width button sharing a flex row with a sibling is a row that overflows.
		 *
		 * THE TWO ACTS: the pair costs the title 56px UNDER THE POINTER and NOTHING at
		 * rest, which is the change `docs/design/sidebar-row-space.md` specifies and the
		 * third paragraph below is the rule. The pin's mark is the exception and it is a
		 * STATE rather than an act, so it is drawn at rest on a pinned row at every width
		 * - including the 240 clamp minimum, where the shipped build drew no pin at all
		 * because the mark lived inside the wrapper the old container query hid (design
		 * D1/D4). The acts are shown and hidden with `display`, not with `opacity`:
		 * `display: none` cannot receive a press at all, so "a hidden control is inert"
		 * stops being a rule someone has to remember and becomes a fact about layout
		 * (D3).
		 *
		 * WHAT THE BUTTON KEEPS: `data-chat-row` on exactly one element per row, and with
		 * it `aria-current` - three committed harnesses select on those and the arrow-key
		 * traversal walks the attribute. (`title` was on that list; it is off it now,
		 * with the flyout above in its place - see D7.) The two acts deliberately do NOT
		 * carry `data-chat-row`: Tab reaches them and the arrow-key traversal does not.
		 *
		 * WHY THE FOLD KEPT BOTH HALVES: main's row body is the shipped one (its unread
		 * tail reads `unreadMarkKind`, the predicate the glyph, the accessible name and
		 * the bulk count all read) and this branch's contribution is the trailing pin and
		 * the press guard on the row's own `onClick` — both sides' intents, neither
		 * restated from the other.
		 */
		/*
		 * THE FLYOUT, which replaces the row's native `title` (design D7).
		 *
		 * WHY THE NATIVE ATTRIBUTE GOES: it is the same pointer channel as the tooltip
		 * below it and a SECOND one - a browser tooltip arriving a second after the app's
		 * own is the bug this avoids - and it cannot carry a wrapped title, a leading
		 * fact or the row's status at a legible width. One pointer surface, not two.
		 *
		 * WHAT IT CARRIES is everything the string carried, so nothing is lost with it:
		 * the full title on its own line (untruncated and free to wrap inside the
		 * primitive's `max-w-64`), the binding, then the row's status label and its tail
		 * flags - `, not sent yet`, `, unread`, `, archived` - and the silent remedy.
		 * An agent-opened row adds its attribution (`openedByNote`: `, opened by coder
		 * in "…"`) to the status line, and this is the channel that keeps it whole: the
		 * row's pixels name only the TEAM the workstream serves (`· <team>`; nothing on
		 * a team-less one — see `rowTrailingStatement`), so the requesting agent's NAME
		 * and the requesting conversation's name live here and in the `sr-only`
		 * sentence, on every agent-opened row, whatever the slot drew. The binding
		 * beside the title is dropped when the attribution names the same agent
		 * (`bindingClause`, the stutter review round 1's n3 found).
		 * The `sr-only` sentence the row already renders stays where it is: that is the
		 * keyboard and screen-reader channel (the `aria-describedby` on the button) and
		 * it does not move into a tooltip.
		 *
		 * IT IS NOT ONLY AN OVERFLOW AFFORDANCE. A row whose title fits gets it too: it
		 * is a replacement for the native tooltip, so the facts live on every row. And
		 * for a reader whose system asks for reduced motion it is the WHOLE of the
		 * channel - the pan is suppressed there, and the flyout is complete on its own.
		 */
		const rowTooltip = (
			<>
				<span className="block">
					{row.title || "Untitled chat"}
					{bindingClause(row)}
				</span>
				<span className="block">
					{row.status?.label ??
						(synthesized.has(row.session_id)
							? "found by search, beyond the chats listed here"
							: "Recent")}
					{silent ? ` · ${SILENT_REMEDY}` : ""}
					{openedByNote(row)}
					{unstarted.has(row.session_id) ? ", not sent yet" : ""}
					{unreadMarkKind(row) !== null ? ", unread" : ""}
					{archived ? ", archived" : ""}
					{/*
					 * THE SUBAGENT CLAUSE, from the SAME helper the row's `sr-only` sentence
					 * reads, and gated by it in exactly the same way: empty on a `delegating`
					 * row (whose label already spells the counts) and empty with no counts.
					 * The pointer channel may never be narrower than the name channel, and
					 * this is the line that keeps it that way - the mark itself is
					 * `aria-hidden` and carries no `title` (a nested `title` inside the row's
					 * button would shadow the row's own tooltip, which is review round 1's
					 * MINOR 1 on this exact slot).
					 */}
					{subagentSentence}
					{/*
					 * THE RECEIPT'S CLAUSE CLOSES THE LINE, after the flags rather than among
					 * them: the flags are what the row IS and this is what the app is DOING
					 * about the mark on it, so it reads as the actionable last word - the slot
					 * `SILENT_REMEDY` occupies one fact up.
					 */}
					{readAck ? ` · ${readAck.clause}` : ""}
				</span>
				{/* THE REMOTE ROW'S OTHER CHANNEL (the shared convention): the SAME
				    fragments the `sr-only` spans beside the title read, drawn as their
				    own lines under the status - the pointer's half of the same
				    sentence. The unreachable line is the split form (design review
				    round 1, D2), never fused onto the device clause. */}
				{remote && <span className="block">{remoteHost}</span>}
				{remoteUnreachable && (
					<span className="block">{remoteUnreachable}</span>
				)}
			</>
		);
		const rowButton = (
			<button
				type="button"
				data-chat-row
				/* Named for the driver, which has to OPEN a conversation before the chat
				   header - and so the right slot's three triggers - exists at all
				   (`renderer-driver.mjs`'s `browser-pane` scene). A tour tag rather than a
				   class: it is the same hook every other drivable control in this app
				   carries, and it is inert outside a driver run. */
				data-tour-tag="chat-session-row"
				data-child={nested || undefined}
				/*
				 * The row's archived state as an ATTRIBUTE, absent when the conversation is
				 * live.
				 *
				 * It is here rather than on the wrapper because this is the element a reader
				 * already means by "the row" (`data-chat-row` is what the arrow ring collects
				 * and what the driver's `measure` verb finds), and a second anchor for the
				 * same row would be a second place a scene has to know about. It carries no
				 * pixels: the visible mark is the glyph below, and this is what lets a scene
				 * assert that the archived conversation is ABSENT from the list before the
				 * search control is on and PRESENT after it, rather than comparing two stills
				 * and hoping the difference is the row.
				 */
				data-session-archived={archived ? "true" : undefined}
				className={cn(
					rowStyle,
					// `w-full` became `min-w-0 grow` when the wrapper arrived: the button shares
					// the row's box with whatever the wrapper carries beside it, and a full-width
					// button inside a flex wrapper with a sibling is a row that overflows.
					"min-w-0 grow text-left",
					nested && "pl-7",
					current && rowCurrent,
					// m4: the unread mark is NOT here. `font-semibold` on this
					// `flex-1 truncate` title rewrote the visible string when the
					// mark arrived, re-truncating text under the reader's cursor;
					// it lives in the reserved status slot instead (see `Status`).
				)}
				aria-current={current ? "page" : undefined}
				/*
				 * THE REMEDY'S OTHER CHANNEL (UX round 1, U2), and this is the KEYBOARD's:
				 * it is the one a person using the `sr-only` name beside the mark can
				 * actually reach. It points at the clause rather than carrying it in the
				 * NAME, which is the design's call: the name stays the state's sentence,
				 * and a description is announced after it, on focus, on the rows that
				 * carry one.
				 *
				 * THAT REQUIRES THE TARGET TO SIT OUTSIDE THIS BUTTON — the association
				 * alone does not keep a sentence out of the name, and the first version of
				 * this shipped it as a child of the button, where name-from-content
				 * collected it too (round 2's MAJOR 2). See the span below the `</button>`
				 * for the measurement; what this attribute needs to be true is that its
				 * target renders and renders outside the named element.
				 *
				 * `undefined` on every other code, and on a row with no status at all — an
				 * `aria-describedby` naming an element nobody rendered resolves to no
				 * description at all, which is a worse outcome than not pointing (the same
				 * rule `setting-control.tsx` states for its own help sentence).
				 *
				 * WHY THE KEY IS PASSED RATHER THAN SET TO `undefined` (agent review round 1, R2;
				 * attribution corrected in round 2, R2-5). The override this guards against was
				 * real once: the trigger USED to be this button, so Radix's `Slot.mergeProps`
				 * spread this element's props over the trigger's, and a key present with the value
				 * `undefined` clobbered the primitive's own `aria-describedby` on every
				 * non-silent row. The trigger is the row's WRAPPER now (`withFlyout` above), so the
				 * slot child is that div and nothing here can override anything - the ANCHOR MOVE is
				 * what closed R2, not this spelling. It is kept as defence: the two channels coexist
				 * by construction, this one whenever the row has a remedy and the primitive's
				 * whenever it does not, and moving the trigger back onto the button would
				 * reintroduce the clobber silently.
				 *
				 * THE FLYOUT ABOVE CARRIES THE SAME CLAUSE, deliberately, and the two do
				 * not duplicate each other's channel: the tooltip is the POINTER's, this is
				 * focus's, and neither is presented where the other is. What the flyout
				 * withholds is the search mark's words, which the row announces itself
				 * through the `sr-only` span beside it — both channels saying "matched in
				 * conversation" would be one fact announced twice (review round 4, R23).
				 * The ", unread" tail is read from the SAME predicate the glyph, the
				 * accessible name and the bulk count read (`unreadMarkKind`).
				 *
				 * AND THE MENU'S CLAUSE JOINS THE SAME LIST (U-D5): added whenever the row
				 * carries the menu at all (`menuEnabled`), and withheld with it - the
				 * withdrawn path renders no clause for this attribute to name.
				 */
				{...(silent || readAck || menuEnabled
					? {
							"aria-describedby": [
								silent ? silentRemedyId(row.session_id) : null,
								readAck ? readAckClauseId(row.session_id) : null,
								menuEnabled ? rowMenuClauseId(row.session_id) : null,
							]
								.filter(Boolean)
								.join(" "),
						}
					: {})}
				onClick={(event) => {
					/*
					 * The same guard as the pin's (see `dropRepeatPress`): a press that repeats the
					 * previous one without the pointer having gone anywhere belongs to the row the
					 * reader pressed, and this row may simply have slid into its place. Opening a
					 * conversation the reader never pointed at is the same hazard as pinning one,
					 * and it is worse to undo.
					 *
					 * The press itself is `pressRow`, because the team mark inside this button
					 * activates the row through the same handler.
					 */
					pressRow(
						event.detail === 0 ? null : { x: event.clientX, y: event.clientY },
					);
				}}
			>
				{/*
				 * THE LOCALITY CELL, DRAWN BY EVERY ROW (design review round 1, D5;
				 * the TUI's decision 2, "the locality cell is ALWAYS the mark"):
				 * remote rows fill it with the locality mark and local rows leave it
				 * empty, so every status glyph and every title starts on the same x
				 * and the merged list reads as one column instead of carrying a
				 * ragged ~18 px leading edge on the rows this change exists to make
				 * seamless. The cell is a fixed `size-3.5` box (the mark's own size),
				 * so a dropped link cannot reflow the row: the mark swaps WITHIN the
				 * cell, the cell never moves.
				 */}
				<span
					aria-hidden="true"
					className="flex size-3.5 shrink-0 items-center justify-center"
				>
					{row.locality === "remote" && (
						<ChatRemoteMark unreachable={row.reachable === false} />
					)}
				</span>
				<ChatSessionStatus row={row} />
				{/*
				 * THE OUTSTANDING-ASKS MARK, beside the status mark and BEFORE the title.
				 * A leading fact rather than a trailing one, for the reason the archived
				 * marker below states: the trailing slot admits exactly one statement, and
				 * this is not competing for it. It draws nothing at zero (see
				 * `ChatAsksOutstanding`), which is what keeps a backend that does not
				 * publish queued asks on exactly today's row.
				 */}
				<ChatAsksOutstanding
					row={row}
					open={asksBySession?.get(row.session_id)}
				/>
				{/*
				 * THE ARCHIVED MARKER, and where it sits is the decision this file owes an
				 * answer for: IN FRONT of the title rather than in the trailing slot.
				 *
				 * That slot is CONTESTED and deliberately admits exactly one statement
				 * (`rowTrailingStatement` in `features/chat/chat-search.ts` records the
				 * three layouts that failed when it admitted more), so a marker competing
				 * for it would either displace "· in conversation" - the reason a row with
				 * nothing visibly in common with the query is on screen - or be dropped
				 * from the one row that most needs both. A leading glyph is outside that
				 * rule rather than an extension of it, it cannot be truncated away (it is
				 * not inside the title's span), and it reads where the row's other
				 * leading fact already is: beside the status glyph.
				 *
				 * `aria-hidden` on the glyph with the word carried by the `sr-only` span
				 * after the title, so a screen reader hears "archived" once, in the
				 * sentence the tooltip also states - the arrangement the "· in
				 * conversation" mark already uses.
				 */}
				{archiveEnabled && archived && (
					<>
						<Archive
							aria-hidden="true"
							className="ml-1 size-3.5 shrink-0 text-ink-dim"
						/>
						<span className="sr-only">, archived</span>
					</>
				)}
				{/* ONE trailing statement per row, decided by `rowTrailingStatement`
			    in `features/chat/chat-search.ts` — which is also where the three
			    failed layouts that led to it are written down (an orphan `·` from
			    a single truncating span, a starved title from unbounded slots, and
			    a qualifier clipped to a bare `·` by a floor the row could not pay).
			    Read that docstring before changing anything here.
			    What matters at this call site: the number of statements is capped
			    rather than negotiated by the flex algorithm, no floor is needed
			    because at most one statement can ever be drawn, and TWO elements
			    truncate — the title, and the bounded slot (the team or the binding)
			    inside its own 45% cap, which is that cap doing the work a floor used
			    to. The TWO literal statements below (`· Not sent yet`, `· in
			    conversation`) cannot truncate anything: they are fixed strings with
			    no width to run out of. The team is a name the user wrote, and it
			    replaced the constant `· agent-opened` (operator ask, 2026-09-25):
			    it left the literal family and joined the bounded one. */}
				{/*
				 * THE TITLE, and both of its boxes live in `chat-row-title.tsx`: the clip box
				 * the row's flex layout sizes (`[data-session-title]`, the anchor the driver's
				 * row-space and session-archive scenes measure - the row's horizontal budget
				 * is a claim about TITLE width, and subtracting control widths from a row box
				 * is not a measurement of it), and the text box inside it that the pan
				 * translates and the mask is drawn against. The marquee, its dwell, the edge
				 * fade and the reduced-motion off switch are all that module's, with the
				 * reasoning for each.
				 */}
				<ChatRowTitle text={row.title || "Untitled chat"} />
				{/*
				 * THE SUBAGENT INDICATOR, immediately after the title and before the
				 * trailing statement - the placement `sidebar-row-space.md` §2 forces:
				 * every element here is `shrink-0`, so none of them can be truncated
				 * away, and the title's clip is the only thing that pays.
				 *
				 * TWO MARKS, INDEPENDENTLY DRAWN, because they are two facts: a child at
				 * work (the shared `SubagentRunningMark` - three equal beads in the accent, the
				 * app's own "a thing is at work" shape, and the same mark the `delegating`
				 * rung's primary slot wears) and a child waiting for capacity (`Hourglass`,
				 * muted). The delegating row is the one place they interact: its primary
				 * mark already IS the running mark, so `subagentMarks` suppresses the
				 * running half there and the queued glyph still draws - the trio carries
				 * "subagents are at work", not "none of them has started".
				 *
				 * THE SHAPE REPLACED `Share2` (issue #840), AND THE DISC IN TURN REPLACED
				 * ITSELF (2026-10-06): a share glyph beside the row's own act buttons read as
				 * an action, so the running mark moved out of the icon vocabulary into the
				 * app's round-mark one; the disc that landed then read as a generic "record"
				 * dot rather than as CHILDREN, so it is the operator-ACKed trio now.
				 * `SubagentRunningMark` carries the geometry, the fusion check and the sizing.
				 *
				 * 14px (`size-3.5`, the icon ramp's `sm` step beside `body-sm` text),
				 * STATIC, and `aria-hidden`: they are ink. The words arrive through the
				 * row's own `sr-only` sentence and its tooltip, both from
				 * `subagentClause`, which is the repo's "one predicate, several channels"
				 * rule.
				 *
				 * `data-subagent-mark` is the hook this change's own tests and the
				 * evidence rigs address the mark by, following the row's existing
				 * convention (`data-session-time`, `data-session-archived`).
				 *
				 * NOTE FOR THE REVIEWER: the row is `gap-1` (4px), so `ml-1` on top of
				 * it makes the gap before each glyph 8px and one mark cost 22px rather
				 * than the spec's 18px. `ml-1` is the spec's explicit class list and is
				 * kept; if the 240px frames show the title starved, dropping `ml-1` is
				 * the one-word fix that restores the spec's own arithmetic.
				 */}
				{marks.running && (
					<SubagentRunningMark
						mark="running"
						className="ml-1 size-3.5 text-accent"
					/>
				)}
				{marks.queued && (
					<Hourglass
						aria-hidden="true"
						data-subagent-mark="queued"
						className="ml-1 size-3.5 shrink-0 text-ink-muted"
					/>
				)}
				{/* In a flat list nothing else names the profile answering, so two
			    untitled chats on different agents were indistinguishable. Nested
			    rows already inherit the identity from their parent, and a row that
			    has something more important to say (the paragraph above) says that
			    instead. The row's flyout carries the binding in every case, so the
			    accessible description is never narrower than the pixels. */}
				{trailing === "team" &&
					/* THE TEAM THE WORKSTREAM SERVES, AS A BUBBLE (operator ask,
					   2026-10-01; `rowTrailingStatement` still records the policy behind
					   the slot itself). The drawn name it used to be cost the title
					   whatever the team's own name was long — a share of the row, up to
					   its 45% cap — so a reader on `Local Operator Development` had one
					   fewer word of their own title than a reader on `docs-pod` did. The
					   bubble's cost is the mark plus the row's 4px gap, and the NAME no
					   longer enters it: the mark's width follows its two initials (measured
					   at head: 22px for `LD`, 24-25px for `DQ`, against the 20px circle the
					   badge-family round replaced - a ~3px swing by initials, not by name),
					   and the name is not lost: it is the bubble's tooltip, its
					   `aria-label`, and still the flyout's binding clause.

					   NAMING THE TEAM IS STILL NOT `aria-hidden`, deliberately, and the
					   bubble is what keeps that true: the mark's `aria-label` is the
					   full display name, so it contributes the same words to the row's
					   accessible name the drawn label did — a reader who cannot see the
					   row hears the team with the rest of the row's sentence. The
					   attribution sentence still renders where it did (the `sr-only`
					   block at the end of this group), so a row it speaks for still
					   says ", opened by coder". */
					teamMark(teamLabelFor(teamName(row)), teamName(row))}
				{trailing === "binding" &&
					/* THE BINDING SLOT, SPLIT BY WHAT IT NAMES (operator ask, 2026-10-01).
					   A TEAM binding is the same fact the team slot above draws - a team
					   this row serves - so it takes the same bubble, and a reader gets
					   one treatment for "the team" wherever the row says it. An AGENT
					   binding keeps its drawn name: no bubble is defined for an agent,
					   the agent-name field accepts 64 characters, and the bounded,
					   truncating slot below is the treatment that measured right for it.

					   WHY THE AGENT SLOT STAYS BOUNDED and how it got that way (review
					   round 4, R21): `shrink-0` with no `truncate` left an UNBOUNDED
					   slot, so the title (floor of zero) absorbed all of it, which
					   restored round 4's D18 at roughly 35 characters and overflowed
					   the row at roughly 45 — reachable from the product's own input
					   limit, with no dragging involved. The cap is a share of the row
					   rather than a fixed width so it scales with the panel, and
					   `truncate` clips inside it. The two literals below are
					   `shrink-0`: they cannot grow, so they cannot starve anything. */
					(row.binding?.team ? (
						teamMark(teamLabelFor(row.binding.team), row.binding.team)
					) : (
						<span className="ml-1 max-w-[45%] shrink-0 truncate text-meta text-ink-muted">
							· {bindingDisplayName(row)}
						</span>
					))}
				{trailing === "not_sent" && (
					<span className="ml-1 shrink-0 text-meta text-ink-muted">
						· Not sent yet
					</span>
				)}
				{/* Says WHY a row is in a filtered list when its visible text does not
			    contain the query. Without it a row appears in a filtered list with
			    nothing in common with the query, which is worse than no filter: the
			    user cannot tell a real match from a bug. Rendered in the row's own
			    `· …` idiom and roles rather than as a glyph, outside the truncating
			    element so it can never be clipped, and on the rows that carry it.
			    The visible words are `aria-hidden` and the sentence is carried by
			    the `sr-only` span after them, so a screen reader hears it once. */}
				{trailing === "conversation" && (
					<>
						<span
							aria-hidden="true"
							className="ml-1 shrink-0 whitespace-nowrap text-meta text-ink-muted"
						>
							· in conversation
						</span>
						<span className="sr-only">, matched in conversation</span>
					</>
				)}
				{/* THE REMOTE ROW'S OWN SENTENCE, joined to the name here rather than
				    beside the mark so the row reads state, title, why-it-is-on-screen,
				    then WHERE IT RUNS - with the attribution rather than beside the
				    counts, because "which device" is an identity fact like "opened by".
				    The fragments are the same ones the flyout draws (`remoteHost`,
				    then the split `remoteUnreachable` line when the owner did not
				    answer). */}
				{remote && <span className="sr-only">, {remoteHost}</span>}
				{remoteUnreachable && (
					<span className="sr-only">, {remoteUnreachable}</span>
				)}
				{/* THE ATTRIBUTION'S `sr-only` SENTENCE, on the rows whose visible slot is the
				    agent-opened claim's: the team slot above, and the silent team-less
				    one. It is what keeps ", opened by coder" reachable from the row itself
				    now that the pixels draw the team or nothing, and it renders even when
				    nothing is drawn — the channel that still states an anonymous agent
				    opened the row. It is NOT rendered on the rows the two higher claims
				    draw (`· in conversation`, `· Not sent yet`): those rows render their own
				    sentences and never carried this one: what a marked row says is the
				    mark's own `sr-only` sentence, and a `not_sent` row says its plain
				    words — neither states an attribution today, and neither gains one
				    here, which is what keeps the accessible name byte-for-byte as it was
				    before this change on every row whose visible slot did not move
				    (review n1's arrangement). */}
				{agentOpenedRow(row) &&
					(trailing === "team" || trailing === "none") && (
						<span className="sr-only">, {openedBySentence(row)}</span>
					)}
				{/*
				 * THE SUBAGENT CLAUSE, and it belongs here rather than beside the glyphs
				 * for a reason worth stating: this is the row's SENTENCE, and its order is
				 * the order a reader hears the row in - state, title, why the row is on
				 * screen, the attribution, then this - with the time last. The glyphs are a
				 * second channel for the same fact, not a second fact.
				 *
				 * `subagentClause` returns "" on a `delegating` row, whose `status.label`
				 * already spells the counts (the backend folds them in, and the status
				 * `sr-only` renders that label verbatim) - so the presence is announced
				 * exactly once on every row, whichever channel owns it.
				 */}
				{subagentSentence !== "" && (
					<span className="sr-only">{subagentSentence}</span>
				)}
				{/*
				 * THE RELATIVE TIME (§C1): right-aligned `text-mono-sm` in `ink-dim`, the
				 * row's last element. It is NOT one of `rowTrailingStatement`'s
				 * statements - that slot is for why a row is on screen, and this is a
				 * fact every resting row carries - so it sits after it and never
				 * competes for it. A RUNNING row prints none (its time is "now", which
				 * the spinner already says), and it gives way to the per-row acts under
				 * the pointer (`group-data-[session-hover-intent]:hidden`) so revealing
				 * Pin/Archive costs the title nothing. IT GIVES WAY ON THE ACTS' OWN
				 * CLOCK, not on the bare hover: the two are one swap (the time leaves as
				 * the acts arrive), so gating one and not the other would blank the time
				 * for the dwell and leave a hole where it was. The keyboard's half of that
				 * clock answers to `:focus-visible` rather than to any focus at all, for the
				 * reason the gate's own note records (agent review round 1, Q-1).
				 *
				 * The visible `2h` is `aria-hidden` and the sentence (`2 hours ago`) is
				 * read after the title, so the row's name stays `state — title` with the
				 * time as its tail (U21).
				 */}
				{!isRunningRow(row) && relativeTime(row, listNow, view.basis) && (
					<>
						<span
							aria-hidden="true"
							data-session-time
							className="ml-auto shrink-0 pl-2 font-mono text-ink-dim text-mono-sm tabular-nums group-has-[:focus-visible]:hidden group-data-[session-hover-intent]:hidden"
						>
							{relativeTime(row, listNow, view.basis)}
						</span>
						<span className="sr-only">
							, {relativeTimeSentence(row, listNow, view.basis)}
						</span>
					</>
				)}
			</button>
		);
		/*
		 * FAIL-CLOSED MEANS MAIN'S OWN ROW, and this paragraph moved with the code beside it.
		 * The withdrawn path used to return a bare button, because a bare button IS what this
		 * branch's base rendered - and the frames the withdrawn pair compares against are that
		 * tree's. main's `ce5fd9578` then made the row a flex wrapper whose button is
		 * `min-w-0 grow`, so a path that still returned the button alone left it with no flex
		 * parent to grow in: design round 8 measured the withdrawn row's button at 138.3 /
		 * 210.7 / 179.0 / 165.6px against main's 264px, with the row's own click strip and the
		 * selected row's ground shrinking to match (141.2px against 264px), and the frame
		 * difference is 15,832px dark / 15,898px light.
		 *
		 * So the withdrawn path renders MAIN'S BOX: `rowBoxStyle`, the conversation button
		 * inside it, and nothing else. No slot, no `group` - an absent control is the only
		 * thing that reads one - and no `data-session-row`, which is this branch's hook for a
		 * state only a per-row control can produce. It is entered when NEITHER capability is
		 * advertised. With the pins present and only the archive withdrawn the row is NOT
		 * this branch: it is the pin branch's own row, class list included, because `controls`
		 * holds the pin alone and the pair wrapper - whose only job is to hold two - is not
		 * drawn. That is what the withdrawn frames are of, and the byte-identity this branch
		 * claims is against IT, not against a panel without pins: the earlier "identical to
		 * the pre-change panel" sentence named a tree main has since moved past.
		 */
		/*
		 * THE SENTENCE `aria-describedby` NAMES, AND IT IS OUT HERE ON PURPOSE (review round 2's
		 * MAJOR 2, design D5, QA Q-4 and UX U6 - all four roles measured the same thing).
		 *
		 * It shipped INSIDE the button, and a button takes its accessible name from its contents
		 * (AccName 1.2 § 4.3.1 step 2F, "name from each child"): the clause was collected into
		 * the NAME as well as into the description, so a reader heard the advice twice per pass
		 * over the row while the name stopped being the state's sentence. Measured in Chromium's
		 * own tree, the shipped row read `name: "Not answering · process alive (last heartbeat
		 * 15m ago) /stop if it stays silent Quiet owner (stale beat)"`.
		 *
		 * ONE LEVEL OUT, and both channels are what they claim: `aria-describedby` resolves by id
		 * anywhere in the document, so the description survives, and the name is the state's
		 * sentence again. It is rendered BESIDE the button rather than collapsed into it - the
		 * placement `directory-indicator.tsx` uses for the same job - and at BOTH row shapes
		 * below, because the remedy is about the session's state and not about the pin
		 * capability: a row that offers no pin still offers the stop.
		 *
		 * `sr-only` rather than `hidden`: a `display: none` element is out of the accessibility
		 * tree altogether, which is exactly the failure the association exists to avoid.
		 */
		const silentRemedy = silent ? (
			<span id={silentRemedyId(row.session_id)} className="sr-only">
				{SILENT_REMEDY}
			</span>
		) : null;
		/*
		 * THE RECEIPT'S OWN SENTENCE, and it is HERE rather than in the flyout alone
		 * for the reason the remedy above states at length: the flyout is the
		 * pointer's channel, a reader who reaches the row by keyboard hears nothing
		 * from it, and `title` is not presented on focus. It is the SAME string the
		 * flyout carries (one home, `../read-ack-notice.ts`), and it is the one arm of
		 * the receipt that a screen reader can be told about at all: the toast's lane
		 * is `aria-live` and this is the per-row association, so a reader who is
		 * walking the list hears which row is waiting rather than only that something
		 * happened somewhere.
		 *
		 * OUTSIDE the button, like the remedy, because a button takes its accessible
		 * name from its contents (round 2's MAJOR 2: the clause was collected into the
		 * name as well as into the description).
		 */
		const readAckRemedy = readAck ? (
			<span id={readAckClauseId(row.session_id)} className="sr-only">
				{readAck.description}
			</span>
		) : null;
		/*
		 * THE MENU'S OWN SENTENCE (U-D5), rendered only while the menu does: it is
		 * the target the button's `aria-describedby` points at on a row that carries
		 * the menu, and it has to render whenever the attribute names it - a
		 * dangling id resolves to no description at all (the rule the attribute's
		 * own comment states). `rowMenuClause` carries why the sentence exists,
		 * why it is not in the flyout's words, and why its spelling is the
		 * platform's.
		 */
		const menuRemedy = menuEnabled ? (
			<span id={rowMenuClauseId(row.session_id)} className="sr-only">
				{rowMenuClause(isMac)}
			</span>
		) : null;

		/*
		 * THE FLYOUT'S TRIGGER IS THE ROW'S OWN BOX, and the blur guard is the other half of
		 * the same decision.
		 *
		 * Radix measures `side="right"` from the TRIGGER, and the row's `<button>` is not the
		 * row: it shrinks by exactly 56px when the acts are revealed, so a flyout anchored to
		 * it began at 428 + 6 = 434 at the default width - 50px INSIDE the row, over its own
		 * pin (432..456) and its own archive control (460..484), at every width measured
		 * (240/278/279/280/360) and for as long as the pointer rested on the control it was
		 * covering (design round 1, D1; UX U1; QA Q-1 - three independent rounds found it).
		 * Anchored to the box that does NOT shrink, the flyout's left edge is the row's right
		 * edge plus the primitive's own 6px `sideOffset`: 490 at the 280 panel, against a row
		 * that ends at 484 and a panel whose outer edge is x 500. It clears the acts by 6px,
		 * it is the arithmetic the old comment always claimed, and it no longer depends on
		 * which state the row is in.
		 *
		 * ONE ROW AT A TIME, THE ROW UNDER THE POINTER, ON THE APP'S OWN DWELL.
		 * `delayDuration` is `TOOLTIP_DELAY_MS` (400ms, the constant the title's pan waits out
		 * too, imported rather than restated): a pointer sweeping the list opens nothing. A
		 * flyout that is open describes exactly the row the pointer is inside - it opens for
		 * the row's whole box INCLUDING the acts, it CLOSES when the pointer leaves the row,
		 * and it closes when focus leaves the row (the `onBlur` below keeps it open while
		 * focus moves between the row's own controls). Radix closes any other open tooltip
		 * when one opens, so two rows are never described at once.
		 *
		 * `disableHoverableContent` IS THE CLOSE RULE, and it is load-bearing rather than
		 * tidy: by default Radix does NOT close on `pointerleave` - it clears the open timer
		 * and waits to see whether the pointer enters the CONTENT - so a panel that cannot
		 * take the pointer (every panel here is `pointer-events: none`) stayed painted after
		 * the pointer had gone, still describing a row it was no longer over (design round 1,
		 * D2: measured still drawn 2.5s after the pointer left, and one committed frame
		 * carried another row's flyout).
		 *
		 * THE BLUR GUARD, why the handler is shared: Radix's trigger closes on any blur that
		 * reaches it and React's `onBlur` bubbles, so moving focus from the row's button to
		 * its pin would take the flyout down and bring it back after a fresh dwell.
		 * `preventDefault` is the documented way to stop a composed Radix handler from
		 * running: the child's handler runs first and the primitive checks the flag before
		 * closing.
		 *
		 * EVERY ROW GETS ONE, INCLUDING A ROW WHOSE TITLE FITS: it is the replacement for the
		 * native `title` (see `rowTooltip`), and under reduced motion it is the whole of the
		 * channel.
		 *
		 * `collisionPadding` KEEPS IT INSIDE THE WINDOW (design round 1, D4): at the list's
		 * last row the un-padded box measured 806..868.2 against an 868px viewport - flush
		 * with the window's bottom edge - and 8px is the primitive's own clamp, so it stays
		 * wholly on screen there. Where a clamped flyout still reaches over the composer's
		 * left edge, the trade is stated in spec §6: it cannot take a press, and the
		 * alternative is covering the list and the acts.
		 *
		 * ONE HELPER, BOTH ROW SHAPES: the withdrawn path (neither per-row capability
		 * advertised) renders main's own box rather than this branch's, and the placement and
		 * close arguments above are about the ROW, not about the controls - a row with no
		 * per-row acts still has a clipped title to explain and a status to name
		 * (`chat-sidebar.tsx`'s own note on the withdrawn shape says it draws "the
		 * conversation button inside it, and nothing else", which is a claim about the acts).
		 */
		/*
		 * ONE HELPER, BOTH ROW SHAPES. The withdrawn path (neither per-row capability
		 * advertised) renders main's own box rather than this branch's, and the placement
		 * and close arguments above are about the ROW, not about the controls: a row with
		 * no per-row acts still has a clipped title to explain and a status to name.
		 */
		const keepFlyoutWhileFocusStaysInRow = (
			event: ReactFocusEvent<HTMLElement>,
		) => {
			const next = event.relatedTarget as Node | null;
			if (next && event.currentTarget.contains(next)) {
				event.preventDefault();
			}
		};
		const withFlyout = (box: ReactNode, key: string) => (
			<Tooltip
				key={key}
				content={rowTooltip}
				side="right"
				align="start"
				disableHoverableContent
				collisionPadding={FLYOUT_COLLISION_PADDING}
				/*
				 * NO FLYOUT WHILE A DRAG IS ARMED (design round 1, D4; measured on `drag-mid`).
				 *
				 * The card names the row the POINTER is on, and during a drag the pointer is not
				 * choosing a row - it is choosing a SLOT. Measured, the card for the row the drag
				 * started on (its title, its status line) stayed standing at the row's right edge
				 * while the insertion line was drawn under a different row, so one frame carried
				 * two accounts of where things were, and the stale one competed with the marker
				 * that matters. `disabled` is the wrapper's own suppression (it renders the child
				 * unwrapped), which is what the pointer needs: Radix keeps a tooltip open while the
				 * pointer stays inside its trigger, and the grip's pointer never leaves the row for
				 * the whole gesture. It comes back by itself when the gesture settles.
				 *
				 * AND NO FLYOUT WHILE THE TEAM MARK OWNS THE POINTER (operator ask,
				 * 2026-10-01): the mark is inside this trigger and carries a tooltip of its own,
				 * so without this term one hover opens two panels — the row's card and the mark's
				 * name — which is the doubling D7 deleted the native `title` for. Measured
				 * before the term existed: hovering the mark left both `[role="tooltip"]` panels
				 * standing, the card (`data-side="right"`) beside the name (`data-side="top"`).
				 *
				 * IT IS `suppressed`, NOT `disabled`, and the difference was measured rather
				 * than reasoned about. `disabled` renders this subtree BARE, so the mark - which
				 * lives INSIDE the box - is remounted along with everything else, and its own
				 * tooltip dies on the very hover that opened it: the run reported the card gone
				 * (the suppression working) and `[role="tooltip"][data-side="top"]` missing (the
				 * mark's name lost), which is worse than the doubling it fixed. `suppressed`
				 * keeps the trigger mounted and closes only the panel.
				 *
				 * The row that stands down is the one under the reader (`teamBubbleHovered` or
				 * `teamBubbleFocused` - two channels, because a pointer leaving the mark while
				 * the keyboard still holds it must not re-arm this card, R1-M5); every other row
				 * keeps its card, and the card returns the moment the pointer AND the focus
				 * have both left the mark.
				 */
				disabled={pinDrag !== null}
				suppressed={
					teamBubbleHovered === row.session_id ||
					teamBubbleFocused === row.session_id
				}
			>
				{box}
			</Tooltip>
		);
		if (!pinsEnabled && !archiveEnabled) {
			return withFlyout(
				<div
					onBlur={keepFlyoutWhileFocusStaysInRow}
					className={cn(rowBoxStyle, current && rowCurrent)}
				>
					{rowButton}
					{silentRemedy}
					{readAckRemedy}
				</div>,
				row.session_id,
			);
		}
		/*
		 * WHETHER THE ROW CARRIES THE PAIR AT ALL. Both capabilities present is the
		 * only case with two controls to hold; with one, `controls` is that one control
		 * and the pair wrapper would be a flex box around a single child - the same
		 * class list, one more element, nothing measured.
		 */
		const bothControls = pinsEnabled && archiveEnabled;
		/*
		 * THE MOVE'S OWN FACTS, read once so the grip's condition and the menu's two
		 * items all read the same ones (issue #693).
		 *
		 * WHETHER THIS ROW IS OFFERED A MOVE AT ALL is `offersMove`, and its terms are
		 * the panel's: the row has to be in the section the order belongs to (a pinned
		 * row drawn inside an agent group, or one a grouped arrangement drew, is in
		 * `matching` but not the section - it has no drawn position and so no move), and
		 * that section has to be the arrangement on screen.
		 *
		 * `up` / `down` are `canMovePinnedRow` over the DRAWN order, which is the same
		 * predicate `movePinnedRow` takes the move under: an item drawn inapplicable and
		 * a press that answers with the boundary sentence are one fact, not two that have
		 * to agree.
		 */
		const up = canMovePinnedRow(pinnedDrawnIds, row.session_id, -1);
		const down = canMovePinnedRow(pinnedDrawnIds, row.session_id, 1);
		const offersMove = offersPinnedMove(row.session_id, nested);
		const controls = (
			<>
				{/*
				 * THE ROW'S OWN ACTS AND ITS OWN ARRANGEMENT, and every one of them is offered
				 * only where the order it speaks about is on screen: the archive behind its
				 * capability gate, the pin behind the row's own pin state, and the DRAG HANDLE
				 * behind `offersMove`.
				 *
				 * WHO OFFERS A MOVE, and every term is a decision - it is `offersMove` above
				 * rather than a second spelling here, and the menu's two Move items read the
				 * same boolean. `pinsEnabled` because the section does not exist without the
				 * pin store; `row.pinned === true` because "move this row up" means nothing
				 * about a row that is not in the section; `!nested` and `view.groupBy ===
				 * "section"` because the pinned rows are ALSO drawn inside agent groups and
				 * inside the grouped arrangements, where the drawn neighbours are some other
				 * axis's - a move there would rearrange the Pinned section from a row the
				 * reader found in a group.
				 *
				 * WHERE THE DRAG HANDLE SITS, AND WHY IT CARRIES NO `order`. It is drawn FIRST
				 * in `controls`, and the flow does the rest: the archive beside it is `order-first`
				 * (design round 2, D12 - the revealed act takes the inner position, the mark
				 * keeps the row's right edge), so the revealed cluster reads
				 * [archive][grip][mark] from the title outwards, with the mark still last and the
				 * title paying for both. IT TAKES NO ORDER CLASS, and that is a constraint rather
				 * than an omission: `bothControls` is `pinsEnabled && archiveEnabled`, so a
				 * backend advertising pins WITHOUT the archive renders `controls` as direct
				 * children of the row's own box - where an `order` would sort the grip against
				 * the row's button and put it to the LEFT of the title. Flow order is the only
				 * spelling correct in both shapes.
				 *
				 * It is reveal-only - a drag is not a state - so it follows the archive's rule
				 * rather than the mark's: `hidden` at rest, `flex` under the pointer.
				 *
				 * NO `data-chat-row` AND `tabIndex={-1}`, on the rule the mark and the archive
				 * are written under: the arrow ring collects that attribute and focuses what it
				 * finds, so wearing it would put another stop in the ring on every pinned row -
				 * the regression §C4's chord exists to avoid - and the row keeps its
				 * one-stop-plus-chords model.
				 */}
				{offersMove && (
					<>
						{/*
						 * THE GRIP: the pinned row's DRAG handle (issue #697, items 1 and 4), and the last
						 * control the MOVE keeps on the row: the arrow pair that used to sit beside it is
						 * deleted, and its two acts are the `Move conversation` items in the row's menu now
						 * (WCAG 2.5.7's single-pointer path moved there with them).
						 *
						 * IT RIDES THE MOVE'S OWN PREDICATE (`offersMove`) rather than restating it, because
						 * the handle and the menu's two items rearrange the same order from the same rows:
						 * one predicate is what keeps them from appearing on different rows.
						 *
						 * WHY A HANDLE AT ALL, when the menu already moves the row: a drag is how a reader
						 * reorders a list in every other app on this machine, and the pointer path to a
						 * four-place move must not be four trips through a menu. The menu items stay: they
						 * are the keyboard path's own affordance, they say which way a move goes, and the
						 * chords reach the same write.
						 *
						 * `tabIndex={-1}` and no `data-chat-row`, on the pair's own rule: the arrow
						 * ring collects that attribute and focuses what it finds, and the row keeps
						 * its one-stop-plus-chords model. There is no chord for the grip because
						 * the chords ARE the keyboard's way to reorder - a chord that started a
						 * pointer drag would be a gesture no keyboard reader can finish.
						 *
						 * `cursor-grab` is the only pointer-shaped affordance in the cluster and it
						 * is a CURSOR, not a transform: nothing lifts, scales or translates on
						 * hover (`docs/branding.md`), and the dragged row's own state is the
						 * `data-dragging` colour step below rather than an opacity change.
						 *
						 * `aria-hidden` AND NO `aria-label` (agent review round 1, R5, measured): the
						 * grip has no click handler and no key path, so a screen reader walking the
						 * row found a NAMED BUTTON whose activation did nothing - while the row's own
						 * copy says the chords are the keyboard path. It is a pointer-only affordance,
						 * so it is hidden from the accessibility tree and its `title` serves the
						 * sighted pointer alone.
						 *
						 * WHICH IS WHY IT REVEALS ON HOVER ONLY (agent review round 2, N1), AND WHY THE
						 * HOVER IT REVEALS ON IS THE DWELL (issue #840). The grip used to
						 * come out under `group-focus-within` too, so a sighted keyboard reader walking the
						 * row watched a handle appear that they can neither focus nor operate - the two
						 * decisions pointed opposite ways, and the reveal yields rather than the AT-hiding,
						 * because the alternative is putting a control back into a row whose whole
						 * model is one stop plus chords. The menu's two Move items are that keyboard
						 * path now, and the chord reaches the same write they do.
						 *
						 * TWO TERMS IT DOES NOT CARRY, both from round 1 (design D2 and D3), and the
						 * first of them is gone with this change.
						 * (a) THE SHED WAS DELETED (this change, D5): the grip is drawn at EVERY panel
						 * width now. Round 1 shed it at or below a 278px panel because the
						 * FIVE-control cluster left the title 40px of the row's 208 at the 240 clamp;
						 * with the arrow pair deleted the same width leaves 124px, and the 263 break -
						 * with the `@container/chatsidebar` declaration whose only reader it was -
						 * went with the crowding it existed to answer. Making a reader widen the
						 * panel to reach a drag is the very crowding this change removes.
						 * (b) THE COUNT: the grip is drawn only when at least two pinned rows are
						 * SHOWN, because with one there is no second slot for a drop to land on -
						 * measured, a one-row drag can be started and always lands on slot 0,
						 * writing nothing - while the menu's two items are NOT gated with it: they
						 * still report the boundary, which is a sentence the reader wants. A search
						 * filter that leaves one pinned row takes the same rule.
						 */}
						{/*
						 * THE GRIP'S OWN TERM (design D3), and it is the GRIP's alone: with one pinned
						 * row shown there is no second slot for a drop to land on, so the handle would
						 * offer a gesture that can only write nothing - measured, a one-row drag always
						 * lands on slot 0 and writes nothing. The menu's two items are not gated with
						 * it: they still report the boundary, which is a sentence a reader wants, and
						 * they are WCAG 2.5.7's single-pointer path.
						 */}
						{pinnedDrawnIds.length >= 2 && (
							<button
								type="button"
								data-session-pin-grip
								tabIndex={-1}
								aria-hidden="true"
								title="Drag to reorder · Esc cancels"
								onPointerDown={(event) =>
									startPinDrag(row.session_id, label, event)
								}
								onPointerMove={movePinDrag}
								onPointerUp={() => settlePinDrag(true)}
								onPointerCancel={() => settlePinDrag(false)}
								className={cn(
									"hidden size-6 shrink-0 cursor-grab items-center justify-center rounded-md active:cursor-grabbing",
									"text-ink-dim",
									"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted",
									/*
									 * The hold (see the pin's note): while this row is the one
									 * whose menu is open the reveal is state rather than
									 * pointer state.
									 */
									menuOpen && "flex text-ink-muted",
									/*
									 * NO `group-focus-within` TERM ON THIS CONTROL (agent review round 2, N1): the
									 * grip is `aria-hidden` and unfocusable, so revealing it for the keyboard would
									 * offer a sighted keyboard reader a handle they cannot operate. The menu's two
									 * Move items are that keyboard reach now, and the chord presses the same write.
									 *
									 * AND NO WIDTH BREAK EITHER, which is this change's other half (D5): the grip was
									 * shed at or below a 278px panel by `@max-[263px]/chatsidebar:hidden!`, whose
									 * `@container/chatsidebar` declaration existed only to be that query's reader.
									 * The break was measured when the FIVE-control cluster took the title to 40px at
									 * the 240 clamp; with the arrow pair gone the same width leaves 124px, and making
									 * the reader widen the panel to reach a drag is the crowding this change removes.
									 */
									"hover:text-ink!",
									!current && "hover:bg-row-hover",
								)}
							>
								<GripVertical aria-hidden="true" className="size-4" />
							</button>
						)}
					</>
				)}
				{/*
				 * The pin, drawn at rest ONLY on a pinned row and revealed on any other row by
				 * the pointer or by focus inside it. Its box is `size-6` and it takes no space
				 * at all until it is drawn: `display: none` at rest on an unpinned row, so the
				 * title has the whole row (`docs/design/sidebar-row-space.md`, D3), while a
				 * pinned row is `flex` at every width because the mark is the STATE. That is
				 * also the fix for the 240 defect the designer measured: the mark used to live
				 * inside a `@container` query's wrapper and read `0x0` at the clamp minimum, so
				 * a pinned row there drew no pin at all (D1). Nothing lifts, scales or
				 * translates on hover, and the whole control is absent, not disabled, when the
				 * backend advertises no pin store (`pinsEnabled`).
				 *
				 * `shrink-0`, matching the entity row's manage control beside it, which is this
				 * panel's established shape for a row's secondary action: Tab reaches it and the
				 * arrow-key traversal does not, because `data-chat-row` is deliberately absent
				 * from it.
				 *
				 * THE STATE MUST READ WITHOUT HOVERING, or the user cannot find what is
				 * pinned: a pinned row's glyph is `text-ink` and FILLED (the `fill` idiom
				 * `agent-details-page.tsx` uses for its own filled/outline state), while an
				 * unpinned one is an outline in `ink-dim` that exists once revealed.
				 *
				 * The hover GROUND is dropped while this row is the current one, exactly as
				 * the entity row's two controls drop theirs: a child's background paints
				 * over the row's own ground, so keeping it would let the pointer's
				 * transient mark replace the mark that says where the reader is.
				 *
				 * `aria-pressed` carries the state. It is also the FAILURE channel: the
				 * store reverts a refused press, and the flip back on the focused control
				 * is what a screen reader announces - which is why the sentence beside the
				 * list carries no `role="alert"` and does not compete with the catalogue
				 * alert at the foot of this panel.
				 */}
				{/*
				 * WITHHELD WHEN THE ROW'S PIN STATE IS UNKNOWN, which is a different fact
				 * from the capability. `pinned` is always present on a catalogue row from a
				 * pins-capable backend, but a row synthesized from a SEARCH HIT whose
				 * backend does not describe the pin state has no `pinned` at all - and a
				 * control there could not repair it: the row is rebuilt from the wire hit on
				 * every render, so a press would be a no-op the user reads as a failure
				 * (QA round 1, Q1; review round 1, m1). An affordance that cannot act on the
				 * row it is drawn on is withheld rather than offered broken.
				 */}
				{row.pinned !== undefined && (
					<button
						type="button"
						data-session-pin
						/*
						 * OUT OF THE TAB RING, AND STILL OPERABLE (§C4, U2). The reveal above is
						 * `group-has-[:focus-visible]`, which is what made this control a Tab stop AND the
						 * only way a keyboard reader could reach it; capping the row at one stop
						 * would therefore trade a stop-count for an accessibility regression. The
						 * chord is the replacement (`⌘⇧P` / `Ctrl+Shift+P`, `chat-regions.ts`), and
						 * it presses THIS control rather than reimplementing its write - so the
						 * repeat-press guard, the move correction and the `aria-pressed` state all
						 * arrive unchanged.
						 */
						tabIndex={-1}
						aria-pressed={pinned}
						/* The action, never the state: `Pin "X"` is what pressing does, and
					   the pressed state is `aria-pressed`'s to report. */
						aria-label={`${pinned ? "Unpin" : "Pin"} “${label}”`}
						/* The same string as the accessible name, matching the entity row's
					   manage control: it is the affordance a pointer user gets, and it
					   duplicates the name without being announced twice. */
						title={`${pinned ? "Unpin" : "Pin"} “${label}”`}
						onClick={(event) => {
							/*
							 * THE GUARD RUNS FIRST (review round 3, MINOR 2). A dropped press must
							 * change nothing at all, and `rememberMovedRow` arms an anchor
							 * correction that the next render - a doorbell, a keystroke - would
							 * then apply, computing a correction for a press that never wrote
							 * anything. Dropped means dropped, so nothing is recorded.
							 */
							if (
								dropRepeatPress(
									event.detail === 0
										? null
										: { x: event.clientX, y: event.clientY },
									row.session_id,
								)
							) {
								return;
							}
							// Where the row is NOW, and WHICH PRESS it was: the two get opposite
							// corrections (see `rememberMovedRow`), and `detail === 0` is the
							// keyboard (a click synthesised from Enter or Space carries no count).
							rememberMovedRow(row.session_id, event.detail === 0, {
								x: event.clientX,
								y: event.clientY,
							});
							/*
							 * The seed is what lets the store HOLD a conversation it does not
							 * list: without it the write reaches the backend and the row keeps
							 * drawing the cached wire hit, so the press can never be undone
							 * from this control (QA round 2, Qr2-1).
							 */
							void setSessionPin(row.session_id, !pinned, {
								// A row's title/`updated_at` are nullable on the canonical shape; the
								// store's seed is not, and a row with neither is still the right row.
								title: row.title ?? undefined,
								updated_at: row.updated_at ?? undefined,
							});
							/*
							 * AN UNPIN FORGETS ITS SLOT (issue #693 rule 4, `chat-pin-order.ts`): the id
							 * leaves the stored manual order with it, so re-pinning is a NEW pin at the
							 * top rather than the resurrection of a position the reader unwound - and the
							 * stored list cannot grow entries for conversations that are no longer in
							 * the section it orders. Guarded on membership, so the common unpin (of a
							 * row nobody has moved) writes no preference at all.
							 */
							if (pinned && view.pins.includes(row.session_id)) {
								setChatSidebarView({
									...view,
									pins: forgetPinnedOrder(view.pins, row.session_id),
								});
							}
							/*
							 * THE KEYBOARD'S CARET COMES BACK THROUGH THE CORRECTION ABOVE, not from
							 * here (UX report round 1, U2). Unpinning takes this control's box out of
							 * the layout and re-renders the row under a different section parent, so
							 * the element this handler holds is gone by the time the row has moved -
							 * a `focus()` on it cannot survive, and one on the NEW element cannot run
							 * until the render that creates it. `rememberMovedRow(..., true, ...)`
							 * already arms exactly that: the follow correction runs after the commit,
							 * finds the row by id, and puts the caret on the mark when the mark is
							 * drawn and on the row's own button when it is not. The pointer path
							 * deliberately does not take focus (`follow` is false for it), because a
							 * row revealed by the pointer has no keyboard place to keep.
							 */
						}}
						className={cn(
							"size-6 shrink-0 items-center justify-center rounded-md",
							/*
							 * THE TWO STATE'S DISPLAY VALUES, and the base is `hidden` rather than `flex`
							 * on purpose: `hidden` and `flex` are two display utilities of equal
							 * specificity, so a class list carrying both would be decided by the
							 * stylesheet's own order. Base `hidden` with the variant ADDING `flex` is the
							 * shape the retired shared control was written in (and the one
							 * `chat-sidebar-archive.test.mjs` pinned after the cascade bug that shipped
							 * the first time it was got wrong): the variant only ever raises the control
							 * into the layout, never competes with the rest state.
							 */
							pinned
								? // Visible, because a pinned glyph is the STATE and hiding it would be
									// worse than the hazard. Its repeat-press hazard is handled by the
									// press guard, not by taking the control away.
									"flex text-ink"
								: cn(
										"hidden text-ink-dim",
										/*
										 * HIDDEN IS ALSO INERT, and here that is a property rather than a rule: an
										 * element that is not displayed cannot receive a press at all, so the
										 * `pointer-events-none` pairing that used to carry this comes off (QA round
										 * 1, U3 - the property it was written for is now stronger). The row behind
										 * it is the hover target: `group-data-[session-hover-intent]`/
										 * `group-has-[:focus-visible]` reveal the control, and the same two states are
										 * what make it operable. The pointer term now waits for the row's dwell
										 * (issue #840); the focus term is immediate and KEYBOARD-ONLY (see the gate's
										 * note below).
										 */
										"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted group-has-[:focus-visible]:flex group-has-[:focus-visible]:text-ink-muted",
										/*
										 * THE HOLD (spec §4), and it is not optional: while THIS row's
										 * menu is open the reveal is state, not pointer state - the
										 * menu's portal is modal, so it takes `pointer-events` off the
										 * page and the row cannot be `:hover`ed however the pointer is
										 * parked. `flex` and the revealed ink come from `openMenuRowId`
										 * and stay until the menu closes. EVERY site that authors the
										 * reveal carries the clause - this glyph, the archive's own,
										 * the pair wrapper, and #697's grip on the pinned strip (the
										 * move pair that once sat beside it is deleted; its acts are
										 * the row menu's items) - because a hold on
										 * the wrapper alone renders a `flex` box with nothing in it,
										 * and one on a glyph alone is a revealed control inside a
										 * `hidden` parent.
										 */
										menuOpen && "flex text-ink-muted",
										"hover:text-ink!",
									),
							// Colour step only, and only while this row is NOT the current
							// one - see the block comment above. The step is the ROW's own
							// (`rowHover`), which is what every other control inside a
							// conversation row takes: `elevated` is a GROUND (menus,
							// popovers, tooltips, dialogs) and this control sits INSIDE a
							// row, so a ground here would be the conflation the two `row*`
							// roles exist to draw - and `chat-sidebar-selection.test.mjs`
							// counts every `hover:bg-*` in this panel against its declared
							// map, so a second spelling is a failing test rather than a
							// quiet divergence.
							!current && "hover:bg-row-hover",
						)}
					>
						<Pin
							aria-hidden="true"
							className="size-4"
							fill={pinned ? "currentColor" : "none"}
						/>
					</button>
				)}
				{/*
				 * THE ARCHIVE CONTROL: a SIBLING of the row's button, never a child.
				 *
				 * A nested button is invalid HTML, unfocusable, and a press inside it fires
				 * the row's own `onClick` as well - opening the conversation the user was
				 * trying to archive. As a sibling it is a control in its own right: Tab
				 * reaches it (it is in the tab order wherever the row is), and the arrow-key
				 * traversal in `keyDown` skips it, because that traversal collects
				 * `[data-chat-row]` and this button deliberately does not carry the
				 * attribute - the rule the entity row's own two controls are written under.
				 *
				 * ABSENT FROM THE LAYOUT AT REST, REVEALED BY `display` (design D3). The control
				 * is `hidden` until the pointer or the keyboard is inside the row, and the two
				 * group states ADD `flex` - so the reveal does reflow the row by exactly this
				 * control's width, which is the whole point: a reserved box cost every title
				 * 56px at rest, on every row, whether or not the pointer was near it. What does
				 * NOT move is the row's own box, and the title is what pays (the pan exists to
				 * give it back - see `chat-row-title.tsx`). `display` is not one of the
				 * properties `docs/branding.md` § 5 lets animate, and nothing lifts, scales or
				 * translates here. `group-has-[:focus-visible]` is what makes it reachable by
				 * keyboard: pressing Tab into the row's button reveals it, and the chords above
				 * are the keyboard's own press (the acts themselves stay out of the Tab ring,
				 * §C4).
				 *
				 * HIDDEN IS ALSO INERT, and here that is a property rather than a rule: an
				 * element that is not displayed cannot receive a press at all, which is why the
				 * `pointer-events-none` pairing the reserved version carried is gone rather than
				 * restated (`chat-sidebar-archive.test.mjs` asserts its absence).
				 *
				 * THE STATE MUST READ WITHOUT HOVERING, or a reader cannot tell an archived
				 * row from a live one: an archived row carries the leading marker AND this
				 * control's icon is the RESTORE glyph (see `archiveControlLabel`), so the
				 * action it offers is legible the moment it is revealed.
				 */}
				{archiveEnabled && (
					<button
						type="button"
						data-session-archive
						/* Out of the Tab ring for the pin's reason: one stop per row, and the
						   row's acts on `⌘⇧A` / `Ctrl+Shift+A` (`chat-regions.ts`). */
						tabIndex={-1}
						aria-label={archiveControlLabel(label, archived)}
						/*
						 * The action, never the state: "Archive \u201cX\u201d" is what pressing
						 * does, and the state is carried by the marker beside the title and by
						 * this button's glyph. `aria-pressed` is deliberately NOT used here,
						 * unlike the pin's control: a boolean `aria-pressed` on a button whose
						 * action is "archive" reads as "archive: pressed", which is a claim
						 * about a toggle rather than about a conversation's state.
						 */
						title={archiveControlLabel(label, archived)}
						onClick={(event) => {
							/*
							 * THE REPEAT-PRESS GUARD RUNS FIRST, before anything is written or
							 * remembered (`chat-archive-press.ts` carries the rule and the
							 * gesture it protects): archiving removes this row from the list, so
							 * the second click of a double-click lands on whatever row slid up
							 * into the gap - with the pointer already inside that row's reveal.
							 * A dropped press changes nothing at all, which now includes not
							 * OPENING A DIALOG: a dropped press must not leave a question on
							 * screen that the reader's own hand did not ask.
							 *
							 * `event.detail === 0` is the keyboard (a click synthesised from
							 * Enter or Space carries no click count), which always acts on the
							 * focused row and is therefore never dropped.
							 */
							const press = archivePressOutcome(
								lastArchivePress.current,
								event.detail === 0
									? null
									: { x: event.clientX, y: event.clientY },
								row.session_id,
							);
							lastArchivePress.current = press.record;
							if (press.drop) return;
							/*
							 * ARCHIVE ASKS FIRST; UNARCHIVE NEVER DOES (2026-09-30). The two
							 * halves of this control have different rules now, which is why the
							 * branch is here rather than inside the write:
							 *
							 *  - the ARCHIVE stages a candidate in the store and returns. Nothing
							 *    is written, nothing is remembered, and the row stays where it is
							 *    until the dialog is answered - so the successor-focus snapshot
							 *    cannot be taken here either (there is no removal yet): it moves to
							 *    the confirmation, where the row really does leave
							 *    (`archive-confirm.ts`).
							 *  - the RESTORE is the reversible half and it stays ONE PRESS on every
							 *    surface that offers it - this control, the header's pill and
							 *    `/unarchive` - because asking before a restore would put a question
							 *    in front of the act that puts a conversation BACK.
							 */
							if (!archived) {
								requestArchiveConfirm({
									sessionId: row.session_id,
									fromRow: true,
								});
								return;
							}
							/*
							 * Snapshot the successor BEFORE the press, because the press removes the
							 * row: `event.currentTarget` is not readable after an await, and the
							 * document order at press time is the order the user sees.
							 */
							const restoreFocus = focusRowAfterRemoval(event.currentTarget);
							void setSessionArchived(
								row.session_id,
								false,
								row.title ?? undefined,
							).then((accepted) => {
								/*
								 * A REFUSED PRESS MOVES NOTHING, focus included: the row is still
								 * there and the reader is still on the control they pressed, with
								 * the store's refusal sentence as an ordinary toast in the app's one
								 * container (design D11's supersession entry of 2026-09-27: the
								 * sidebar lane that replaced the root register was itself retired,
								 * and the register is not kept beside it).
								 *
								 * AND AN ACCEPTED ONE NEEDS NOTHING FROM THIS HANDLER EITHER: the Undo
								 * offer this press stands is written by the STORE, in the same update
								 * that settles the write (design round 8, D27's second clause). It used
								 * to be raised here, a microtask later, which put the accepted departure
								 * and the band that answers it in two commits - and the commit between
								 * them is the one whose extent dips below the reader's position. ONE ACT,
								 * ONE REGISTER (UX round 1, U2) survives the move rather than being
								 * traded for it: every surface's accepted archive raises the same offer,
								 * from the one place that knows the write was accepted.
								 */
								if (!accepted) return;
								restoreFocus();
							});
						}}
						className={cn(
							/*
							 * THE ARCHIVE CONTROL IS ABSENT FROM THE LAYOUT AT REST, not transparent in
							 * it (design D3): base `hidden`, revealed by `flex` under the pointer or under
							 * a KEYBOARD focus inside the row (`group-has-[:focus-visible]`, the browser's
							 * own definition of it - see the gate's note below). `display: none` replaces
							 * the old `opacity-0` +
							 * `pointer-events-none` pairing, and on the property that pairing was written
							 * for it is strictly stronger - an element that is not displayed cannot
							 * receive a press at all, so "a hidden control is inert" stops being a rule
							 * someone has to remember. The base is `hidden` rather than `flex` because
							 * both are display utilities of equal specificity: a base `flex` beside the
							 * variant's own would be decided by the stylesheet's order rather than by
							 * the pointer.
							 *
							 * WHAT IS KEPT FROM THE OLD REVEAL, because losing it would be a regression
							 * rather than a simplification: the pointer's own control reads at full ink,
							 * and there is nothing to transition - `display` is not one of the properties
							 * `docs/branding.md` § 5 lets animate, and the app's motion vocabulary has no
							 * entrance to spend here.
							 */
							/*
							 * NO SLOT IS RESERVED, ON ANY ROW (manager, pass 8 - the operator's own
							 * constraint: "the pinned rows can show up taking up the space only for the
							 * pin, not adding additional empty space for the archive button"). Reserving
							 * the archive's slot on a pinned row bought the mark's stationarity and paid
							 * for it with the space the row exists to save - measured `56/56 at every
							 * width`, i.e. a pinned row costing exactly what an unpinned one does, which
							 * is the thing this whole change set out to stop.
							 *
							 * THE STATIONARITY COMES FROM THE ORDER INSTEAD. The archive's box is drawn
							 * FIRST in the pair and the mark LAST, so the mark owns the row's right-hand
							 * edge in flow: revealing the archive takes its 28px out of the TITLE, to the
							 * mark's left, and the mark does not move - while at rest the pair is `hidden`
							 * and the row costs the pin alone. Measured after the change: mark identical
							 * before and under the pointer, `elementFromPoint` at its centre still the
							 * mark itself, and the resting pair `display: none`.
							 */
							cn(
								"hidden size-6 shrink-0 items-center justify-center rounded-md",
								/* ORDER FIRST: the mark owns the row's right edge (see the comment below). */
								"order-first",
								"text-ink-dim",
								"group-data-[session-hover-intent]:flex group-data-[session-hover-intent]:text-ink-muted",
								"group-has-[:focus-visible]:flex group-has-[:focus-visible]:text-ink-muted",
								/* The hold, as the pin glyph's comment records: the reveal is authored in every revealing control, so the clause rides each. */
								menuOpen && "flex text-ink-muted",
							),
							/*
							 * AND THE POINTER'S OWN CONTROL READS AT FULL INK (design round 4,
							 * D22). The row box and both controls now declare the same
							 * `hover:bg-row-hover`, so the ground is uniform across a hovered
							 * row and says nothing about WHICH control the pointer is on - the
							 * nested step D18's fix removed, one level down. A distinct control
							 * token would be a new role across every palette for one 24px box;
							 * the ink step is the vocabulary this file already has (a pinned
							 * row's glyph takes `text-ink`), so the control under the pointer
							 * darkens to full ink while its sibling stays at the revealed
							 * `ink-muted`. The `!` is load-bearing: `group-data-[session-hover-intent]:text-ink-muted`
							 * and `hover:text-ink` are two equally specific rules that both
							 * match, so the winner would be the stylesheet's own order.
							 */
							"hover:text-ink!",
							// The hover GROUND is dropped while this row is the current one, the
							// rule the entity row's two controls follow: a child's background
							// paints over the row's own, so keeping it would let the pointer's
							// transient mark replace the mark that says where the reader is.
							//
							// And it is the ROW STATE (`rowHover`), never a ground: this control
							// lives inside a row, so `elevated` - which is every menu, popover,
							// tooltip and dialog in the app - would answer the pointer with a
							// role that means something else entirely. The panel's own guard
							// (`chat-sidebar-selection.test.mjs`) is what holds that boundary.
							!current && "hover:bg-row-hover",
						)}
					>
						{archived ? (
							<ArchiveRestore aria-hidden="true" className="size-4" />
						) : (
							<Archive aria-hidden="true" className="size-4" />
						)}
					</button>
				)}
			</>
		);

		/*
		 * THE BOX IS THE MENU'S TRIGGER. `asChild`, inside the `Tooltip`, so the
		 * flyout keeps anchoring to the box that does not shrink (spec §3): the
		 * button shrinks by 56px when the acts reveal, so a menu anchored to it
		 * would move under its own row. A consequence that is intended rather than
		 * tolerated: whatever is inside the box - the title, the timestamp, either of
		 * the pair's controls - is a right-click target, and a right-click is not a
		 * press, so the control under the pointer does not act.
		 *
		 * THE MENU'S STATE IS THE SIDEBAR'S, not the trigger's: the box carries the
		 * Tooltip's `data-state` too (two Radix triggers, one attribute), so the hold
		 * classes read `openMenuRowId`, and `onOpenChange` below is what keeps it
		 * true for exactly the row whose menu is up. The panel renders through the
		 * primitive's portal and anchors from the point the opener wrote.
		 *
		 * THE WITHDRAWN PATH ABOVE CARRIES NONE OF THIS: no trigger, no
		 * `data-session-menu-trigger`, no keydown handler - which is what keeps that
		 * panel the one it had before this feature existed.
		 */
		const rowBox = (
			<div
				/* The row's own box, and the hook the current-row ground is asserted
				   through (`chat-sidebar-selection.test.mjs`'s CURRENT table). */
				data-session-row={row.session_id}
				/*
				 * THE DRIVER'S HOOK: the element a scene finds when it needs this row's
				 * menu open (dispatch a `contextmenu` at it, or focus its button and
				 * press `Shift+F10`). It is also the fact "this row's acts are
				 * reachable outside the hover chord".
				 *
				 * AND THE DRAGGED ROW'S OWN MARK (issue #697, item 5) lives on the same
				 * box: it is on the BOX and not on the grip, because the claim is about
				 * the whole row the reader is moving; the ground step it draws is
				 * `rowDragging`'s and the outline is `rowDraggingMark`'s (both carry
				 * their own notes, including why the held state is not a fill).
				 */
				data-session-menu-trigger
				onKeyDown={openRowMenuAtKeyboard}
				onPointerDownCapture={rememberFocusBeforePress}
				data-dragging={dragging ? "" : undefined}
				onBlur={keepFlyoutWhileFocusStaysInRow}
				className={cn(
					// Carried while EITHER per-row control is mounted, because both reveal
					// themselves through the row's own `group-data-[session-hover-intent]` /
					// `group-has-[:focus-visible]` on it, and absent when neither is - which is what
					// keeps the fully withdrawn panel's class list the one it had before
					// either feature existed. The `data-session-hover-intent` attribute the
					// pointer half reads is written by `ChatRowHoverIntent` below - it is the
					// dwell gate (issue #840), and the row box is the element it marks.
					(pinsEnabled || archiveEnabled) && "group",
					/*
					 * AND THE HOVER GROUND BELONGS TO THE ROW, NOT TO ITS BUTTON (design
					 * round 2, D13). `rowStyle` carries `hover:bg-row-hover`, which fires
					 * only while the pointer is over the BUTTON - so moving onto either
					 * sibling control (they are inside the row's box and outside its
					 * button) dropped the ground the pointer was standing on: a pop under
					 * the pointer, on the row the pointer never left. The ground is stated
					 * once more on the box, so the row reads as one hovered thing across
					 * its whole width.
					 *
					 * A PLAIN `hover:` AND NOT `group-hover:` (design round 3, D18), and
					 * this is the whole reason the first attempt at it was INERT: the box
					 * is the element that CARRIES `group`, and Tailwind compiles
					 * `group-hover:` to a DESCENDANT rule
					 * (`.group-hover\:bg-row-hover:is(:where(.group):hover *)`), which can
					 * never match its own carrier. Measured on the frames: the ground
					 * still stopped 56px short of the box at 280 and was absent entirely
					 * with the pointer on a control. `hover:` fires on the element the
					 * pointer is actually inside, children included, which is what "the
					 * row is one hovered thing" means.
					 *
					 * Dropped while this row is the CURRENT one, exactly as the two
					 * controls drop their own hover ground: the selected ground and the
					 * hover ground are two steps off `surface` in the same direction, and
					 * repainting the state the reader is IN as the state the pointer is in
					 * is the substitution `rowCurrent`'s own override exists to stop.
					 */
					(pinsEnabled || archiveEnabled) && !current && "hover:bg-row-hover",
					/*
					 * THE HELD GROUND: while this row's menu is open the pointer cannot hold
					 * `:hover` (the menu's portal is modal), so the ground the reader opened
					 * the menu on comes from `openMenuRowId` - the state-driven half of the
					 * hold, the same rule the class above spells for the pointer. `!current`
					 * for the reason that class's comment records: the selected ground must
					 * not be repainted as the pointer's.
					 */
					menuOpen && !current && "bg-row-hover",
					rowBoxStyle,
					current && rowCurrent,
					/*
					 * THE DRAG'S GROUND IS MERGED LAST, after `rowCurrent`, and that placement is
					 * the mechanism rather than a style choice (round 1, D1): `cn` is
					 * tailwind-merge, so the last class of a group wins, and `rowBoxStyle` states
					 * `hover:bg-row-hover` earlier in this same list - a drag ground written
					 * before it loses the fill to it exactly as the bare `bg-row-selected` did.
					 * `rowCurrent` is merged last for the same reason, and the drag ground has to
					 * outrank that too, because a current row's resting fill IS the selected step.
					 *
					 * A row the pointer has left mid-drag is still the row being dragged, and the
					 * variant restates its ground at `hover:` so the hover rule cannot take it back
					 * while the captured pointer sits inside the row. The SAME ground for a current
					 * held row is the point rather than an omission: it is that row's own resting
					 * fill, so "you are here" survives the gesture, and the held state is carried by
					 * `rowDraggingMark`'s outline instead of by a second fill (round 2, D7 + U6).
					 */
					dragging && rowDragging,
					/*
					 * The non-fill half of the held state, and it is what keeps a held row distinct
					 * from the row merely under the pointer - the two can be adjacent on screen.
					 * Merged after the ground so a later rule cannot drop it. The mark is an
					 * OUTLINE rather than an inset ring because the current row's own button paints
					 * an opaque fill over its parent's box-shadow (round 3, D10).
					 */
					dragging && rowDraggingMark,
				)}
			>
				{/*
				 * THE POINTER-INTENT GATE (issue #840). The acts below reveal on the row's own
				 * `data-session-hover-intent`, and this is the only writer of it: a pointer
				 * that DWELLS on the row for the app's hover-intent constant earns the reveal,
				 * and a pointer sweeping through on its way to a row that is merely being
				 * SELECTED never meets a control that just arrived under it.
				 *
				 * THE KEYBOARD'S DOOR IS `:focus-visible`, AND THAT IS A CORRECTION RATHER
				 * THAN A REFINEMENT (agent review round 1's Q-1, which is UX's U1). This term
				 * used to be the bare `group-focus-within`, which the browser raises for a
				 * MOUSE-driven focus as well - so a press landing in the row's trailing band
				 * focused the row's own button, the acts arrived INSIDE the gesture, the button
				 * narrowed 248 -> 196 under the press, the mouseup landed outside it and
				 * Chromium retargeted the `click` to the row's wrapper, which has no handler.
				 * The press therefore neither pressed a control NOR selected the row, which is
				 * the premise issue #840 is written on. `:focus-visible` is the platform's own
				 * answer to "did this focus arrive from the keyboard" - the same constant and
				 * the same reasoning `shared/lib/scrollbar-activity.ts` carries - so a Tab into
				 * the row still reveals the acts immediately while a press never re-lays the
				 * row out mid-gesture. The repo's precedent for the variant itself is
				 * `thread-search-overlay.tsx` and the agent surfaces' focus ring.
				 *
				 * WHY NOT A PRESS GUARD INSTEAD. Holding the reveal off only while a press is
				 * in flight would keep the row still for that gesture too, but it leaves the
				 * door keyed to the mouse's focus, so the row's layout still moves the instant
				 * the press lands - the same reflow, one gesture later, and a fresh class of
				 * timing state to keep. Keying the door to HOW the focus arrived removes the
				 * reflow rather than hiding it, and it costs nothing the keyboard ever had:
				 * the acts are out of the Tab ring by design (§C4), so the row's button is the
				 * keyboard's only stop and `:focus-visible` is exactly the event that stop
				 * fires.
				 *
				 * It renders a `hidden` anchor and resolves this box from it; see
				 * `chat-row-hover-intent.tsx` for why it is a component rather than a hook here.
				 */}
				{(pinsEnabled || archiveEnabled) && <ChatRowHoverIntent />}
				{rowButton}
				{silentRemedy}
				{readAckRemedy}
				{menuRemedy}
				{/*
				 * THE PAIR. Both acts are siblings of the row's button, never children, and both
				 * are absent from the layout until the pointer has DWELT on the row or the
				 * keyboard is inside it (`display`, not `opacity`): at rest a row's title has the
				 * whole row, and the two acts take 56px of it under the pointer, which is what
				 * the title's pan exists to answer (`docs/design/sidebar-row-space.md`, D2 and
				 * D3). The pointer's term is the row's own `data-session-hover-intent` (the
				 * gate mounted above); the keyboard's term is `group-has-[:focus-visible]` and
				 * is immediate - keyboard-only by the browser's own definition of it, which is
				 * what the gate's note above explains.
				 *
				 * THE WRAPPER IS ALWAYS A FLEX BOX, AND WHAT SHUTS IT IS THE ROW'S OWN STATE:
				 * `hidden` while the row is unpinned, because then NEITHER control is drawn at
				 * rest; `flex` on a pinned row, because the mark inside it is a STATE and must
				 * read without hovering. That is what fixes the 240 defect the designer measured
				 * (a pinned row at the clamp minimum drew no pin at all, because the mark lived
				 * inside the wrapper the old container query hid). The switch is on the WRAPPER
				 * as well as on each control so the 4px row gap is not paid by a box that draws
				 * nothing: a reserved-but-empty wrapper would still cost the title its gap.
				 *
				 * THE REVERSAL, if the 240 hover turns out to be too busy for a pair, is one
				 * class here plus the shared control it would stand in for - see the note where
				 * the two shed constants used to live at the top of this file.
				 */}
				{bothControls ? (
					<div
						data-session-control-pair
						className={cn(
							"items-center gap-1",
							/*
							 * `menuOpen` holds the wrapper revealed for the same reason each glyph
							 * holds its own (see the pin's comment): the wrapper alone would be a
							 * `flex` box with nothing in it, and the glyphs alone would be
							 * revealed controls inside a `hidden` parent.
							 */
							pinned || menuOpen
								? "flex"
								: "hidden group-data-[session-hover-intent]:flex group-has-[:focus-visible]:flex",
						)}
					>
						{controls}
					</div>
				) : (
					controls
				)}
			</div>
		);

		return (
			<ContextMenu
				key={row.session_id}
				open={menuOpen}
				onOpenChange={(open) => {
					/*
					 * THE POINTER CLOSE'S RETURN TARGET WHEN NO PRESS RAN (U8; the
					 * restore lives in `onCloseAutoFocus`). The press records it
					 * earlier, on `pointerdown`'s capture phase (QA round 3, Q-1 -
					 * `rememberFocusBeforePress`), so this runs only when nothing has
					 * been recorded yet - a dispatched `contextmenu` - and can never
					 * overwrite the press-time value.
					 */
					if (open && menuFocusReturnRef.current === null)
						menuFocusReturnRef.current =
							document.activeElement instanceof HTMLElement
								? document.activeElement
								: null;
					setOpenMenuRowId((current) =>
						open ? row.session_id : current === row.session_id ? null : current,
					);
				}}
			>
				<RowMenuOwner
					id={row.session_id}
					openMenuRowIdRef={openMenuRowIdRef}
					setOpenMenuRowId={setOpenMenuRowId}
					openedByKeyboard={menuOpenedByKeyboard}
				/>
				{withFlyout(
					<ContextMenuTrigger asChild>{rowBox}</ContextMenuTrigger>,
					row.session_id,
				)}
				{/*
				 * THE ITEMS, and the ORDER rule that places them: the mirrored pair first, in the
				 * strip's own measured order (the archive glyph is `order-first`, so the menu reads
				 * Archive then Pin and the two surfaces cannot present the same acts backwards);
				 * then Fork, the UNCONDITIONAL singleton; then the CONDITIONAL block, which is the
				 * Move pair. Rows 1-2 are the pair, and the third slot therefore keeps one identity
				 * in every state - Fork on an ordinary row and Fork on a pinned one - instead of
				 * changing which act a reader finds there (round-1 design review, D2; this replaces
				 * the fold's append, under which the third slot was Fork only where no Move was
				 * offered). Everything the two Move items need to stay adjacent to each other is
				 * unaffected: the block trails as a unit.
				 *
				 * Drawn from THE SAME PREDICATES the row's own controls read (`archiveEnabled`,
				 * `row.pinned !== undefined`, `offersMove`), so the two cannot disagree about
				 * what a row offers. WITHDRAWN, NEVER DISABLED: an act the row cannot take is an
				 * absent row, not a greyed one, the rule the row's controls already follow - and
				 * the two Move items are the one deliberate exception (WCAG 2.5.7's replacement
				 * for the deleted arrow pair, below): a move the row cannot make in ONE DIRECTION
				 * is a boundary, and a boundary is a sentence rather than a silence.
				 *
				 * Each item presses the row's own control through `pressRowAct`, so the write,
				 * its guards and its focus correction arrive unchanged; the two Move items reach
				 * the SAME write by calling `movePinnedRow` directly, because there is no control
				 * on the row left to press - and each prints its chord through the `+`-joined
				 * sibling of its handler's spelling (`chatPinMoveCapJoined`, the shape
				 * `chatRowActCapJoined` already gives the pair above): `KeyboardShortcut` splits
				 * its prop on `+`, so the handler's `⌘⇧↑` fed straight to it renders as ONE cap
				 * three glyphs wide instead of three caps (round-1 design review, D1). The cap
				 * stays in the item's accessible name either way - the discovery this menu exists
				 * to spend.
				 *
				 * FORK IS THE THIRD ROW (#739, re-ordered by the round-1 design review, D2), and
				 * it differs from the four around it in mechanism: there is no row control to
				 * press, so it opens the register's own `session.fork` picker for THIS row's
				 * conversation through the panel-presentation store (see its `onSelect`). It
				 * carries NO chord, because fork has none - `/fork` and the palette are its other
				 * doors - so it has no `KeyboardShortcut` and no accessible-name suffix; a printed
				 * chord would be a hint for a gesture that does nothing. It is drawn from the
				 * sidebar's own `unstarted` statement (`forkable`, above).
				 *
				 * THE MENU'S CAP IS FIVE ROWS, and the rule - not a number - is what the design
				 * record now concludes with: a row earns its place by being an act on THIS row
				 * that has NO OTHER DOOR THE USER CAN FIND. Archive and Pin qualify (the strip's
				 * pair is `tabIndex={-1}` and reachable only through chords the row prints
				 * nowhere); the Move pair qualifies as WCAG 2.5.7's single-pointer path, which the
				 * deleted arrow buttons used to carry; Fork qualifies because it is the only door
				 * that names the ROW's conversation - neither `/fork` nor the palette can, as both
				 * act on the pane's. A sixth act is admitted only by passing that test; otherwise
				 * it replaces a row or finds another surface. The cap costs **296 × 184** in its
				 * widest state (a pinned row, where the Move rows draw their full chords) at a
				 * 280px sidebar, and around eight rows or ~280px tall is where the answer changes
				 * from "grow" to "submenu or another surface". `scripts/chat-sidebar-row-menu.test.mjs`
				 * counts the items and pins their order, so a sixth is a failing assertion rather
				 * than a quiet addition.
				 */}
				<ContextMenuContent
					onFocus={(event) => {
						/*
						 * THE KEYBOARD PATH LANDS IN THE FIRST ITEM (U-D4's minimum; the
						 * pointer path keeps the primitive's default - focus on the menu
						 * itself, no item highlighted - because a row revealed by the
						 * pointer has no keyboard place to keep).
						 *
						 * WHY THIS RIDES THE CONTAINER'S OWN FOCUS EVENT rather than
						 * Radix's `onOpenAutoFocus`: that hook is real at runtime but the
						 * primitive keeps it OUT of its public prop TYPES (the same
						 * `MenuContentImplPrivateProps` interface `MenuSubContent` consumes
						 * with different semantics), and this directory's wrappers take no
						 * untyped escapes. The mount already focuses the content on this
						 * path, so its first focus event is the public place to redirect
						 * from - the spec's own second acceptable mechanism, "focusing the
						 * first `[role=menuitem]` after the open effect".
						 */
						if (!menuOpenedByKeyboard.current) return;
						if (event.target !== event.currentTarget) return;
						event.currentTarget
							.querySelector<HTMLElement>('[role="menuitem"]')
							?.focus();
					}}
					onCloseAutoFocus={(event) => {
						/*
						 * BOTH PATHS PREVENT THE DEFAULT; what each focuses differs. The
						 * keyboard path returns the caret to the row's own button - where
						 * the press came from, the shape the pin control's caret correction
						 * already uses. The pointer path focuses the element the open
						 * captured (U8): the primitive moves focus into the panel on open
						 * even under the pointer, and the element it sits on is unmounting
						 * here, so returning without focusing dropped the caret to `<body>`
						 * and the next keystroke a reader typed reached nothing (QA round 2:
						 * composer focused -> right-click -> Escape -> `<body>`). When the
						 * remembered node is gone, the row's own button is the deliberate
						 * fallback - the keyboard path's own destination; with neither,
						 * focus is left alone rather than aimed at a guess. The primitive's
						 * own guard (focus back to the trigger) never runs: its listener is
						 * composed after this one and checks `defaultPrevented`.
						 */
						event.preventDefault();
						const remembered = menuFocusReturnRef.current;
						menuFocusReturnRef.current = null;
						if (!menuOpenedByKeyboard.current) {
							if (remembered?.isConnected) remembered.focus();
							else
								document
									.querySelector<HTMLElement>(
										`[data-session-row="${CSS.escape(row.session_id)}"] [data-chat-row]`,
									)
									?.focus();
							return;
						}
						menuOpenedByKeyboard.current = false;
						document
							.querySelector<HTMLElement>(
								`[data-session-row="${CSS.escape(row.session_id)}"] [data-chat-row]`,
							)
							?.focus();
					}}
				>
					{archiveEnabled && (
						<ContextMenuItem
							onSelect={() => pressRowAct(row.session_id, "archive")}
						>
							{archived ? (
								<ArchiveRestore aria-hidden="true" />
							) : (
								<Archive aria-hidden="true" />
							)}
							<span>
								{archived ? "Unarchive conversation" : "Archive conversation"}
							</span>
							<span className="ml-auto pl-6">
								<KeyboardShortcut
									shortcut={chatRowActCapJoined("archive", isMac)}
									joined
								/>
							</span>
						</ContextMenuItem>
					)}
					{row.pinned !== undefined && (
						<ContextMenuItem
							onSelect={() => pressRowAct(row.session_id, "pin")}
						>
							{pinned ? (
								<PinOff aria-hidden="true" />
							) : (
								<Pin aria-hidden="true" />
							)}
							<span>{pinned ? "Unpin conversation" : "Pin conversation"}</span>
							<span className="ml-auto pl-6">
								<KeyboardShortcut
									shortcut={chatRowActCapJoined("pin", isMac)}
									joined
								/>
							</span>
						</ContextMenuItem>
					)}
					{forkable && (
						/*
						 * HOW IT OPENS: the picker is mounted by the chat PANE (`PickerOutlet`,
						 * fed by `useSlashDispatch`), and the sidebar owns no presenter - so the
						 * item ASKS, the way the command palette does (`command-palette.tsx`'s
						 * `panel` case): it writes a request that NAMES THIS ROW's conversation,
						 * because the pane's own session is generally not the row's and the
						 * presenter must not substitute it, then routes to `/chat` only when no
						 * pane is mounted to consume it. Completing the fork NAVIGATES to the
						 * new fork (the pane's `rebind` is `openConversation` - the shipped
						 * `/fork` semantics, reused deliberately; see `slash-dispatch.ts`).
						 *
						 * THE INVOKER IS THE ROW'S OWN BUTTON, not the item: the item unmounts
						 * with the menu, and the row's button is the node the menu's own close
						 * returns to, so Escape from the picker lands where Escape from the menu
						 * would have.
						 */
						<ContextMenuItem
							onSelect={() => {
								requestPanel(
									"session.fork",
									document.querySelector<HTMLElement>(
										`[data-session-row="${CSS.escape(row.session_id)}"] [data-chat-row]`,
									),
									row.session_id,
								);
								// The palette's own guard, minus its first clause: it asks
								// `destinationNeedsSession(destination) &&
								// !location.pathname.startsWith("/chat")`, and `session.fork`
								// is a pane-only destination, so the first clause is already
								// true here. The other two parts are as load-bearing as they
								// are there: the request is written FIRST (one written after the
								// navigation would race the pane's mount), and the route moves
								// only when no pane is there to present it.
								if (!location.pathname.startsWith("/chat")) navigate("/chat");
							}}
						>
							<GitFork aria-hidden="true" />
							<span>Fork conversation</span>
						</ContextMenuItem>
					)}
					{offersMove && (
						<>
							{/*
							 * WCAG 2.5.7's SINGLE-POINTER PATH, and the reason it is HERE rather than
							 * on the row: the pair of arrow buttons that used to carry it was the
							 * crowded part of the strip, and the row menu is the surface the other two
							 * acts already live on - one door, three acts, and no resting cost on the
							 * row.
							 *
							 * A BOUNDARY IS A SENTENCE, NOT A DEAD ITEM. `aria-disabled` rather than
							 * `disabled`: a real `disabled` drops the item out of the flow a keyboard
							 * reader walks AND stops the activation, so the why would be unannounceable
							 * - the trade the drafts' discard act refuses. `aria-disabled` leaves the
							 * activation intact, so `movePinnedRow` still runs and answers with
							 * `pinMoveBoundaryNote` through the live region. The class list is what
							 * makes the two states LOOK different, since Radix only paints
							 * `data-[disabled]` for the prop this does not pass.
							 *
							 * THE SENTENCE IS ALSO VISIBLE (UX round 1, U6): the live region is the
							 * ONLY other channel, and it is `sr-only`, so a sighted reader who pressed
							 * a greyed item watched the menu close with nothing said. The deleted pair
							 * carried this same sentence as its `title`, so the item takes it the same
							 * way - a pointer reader gets the tooltip BEFORE pressing, which is the
							 * better half of the answer. It is set only at a boundary: an applicable
							 * item has nothing to explain and the app's idiom is no tooltip on a menu
							 * item that does what it says.
							 */}
							<ContextMenuItem
								aria-disabled={!up}
								title={!up ? moveBoundarySentence(row.session_id) : undefined}
								onSelect={() => movePinnedRow(row.session_id, -1, true)}
								className={cn(
									"aria-disabled:cursor-default aria-disabled:text-ink-disabled!",
									"aria-disabled:hover:bg-transparent! aria-disabled:hover:text-ink-disabled!",
									/*
									 * THE CHORD FOLLOWS ITS ITEM (round-1 design review, D3). A cap
									 * carries its own ink role (`KeyboardShortcut`'s `ink-dim`, the
									 * one role legal on all four of its grounds), so `text-ink-disabled`
									 * on the item recoloured the WORD and left the ACCESSORY at full
									 * strength - measured as a 2.07x (light) / 2.64x (dark) inversion on
									 * a boundary row, where the annotation outranked the label it
									 * annotates and the item still read as live at a glance.
									 *
									 * HERE rather than in the shared component: `KeyboardShortcut`
									 * deliberately takes no appearance prop (its own docstring retires
									 * `className` for that reason), and this is not a re-skin - it is
									 * the ITEM's state reaching its own descendants, which is the same
									 * thing the two `aria-disabled:` rules above do. The `!` is required
									 * because the cap's utility is on the `<kbd>` itself.
									 */
									"aria-disabled:[&_kbd]:text-ink-disabled!",
								)}
							>
								<ChevronUp aria-hidden="true" />
								<span>Move conversation up</span>
								<span className="ml-auto pl-6">
									<KeyboardShortcut
										shortcut={chatPinMoveCapJoined(-1, isMac)}
										joined
									/>
								</span>
							</ContextMenuItem>
							<ContextMenuItem
								aria-disabled={!down}
								title={!down ? moveBoundarySentence(row.session_id) : undefined}
								onSelect={() => movePinnedRow(row.session_id, 1, true)}
								className={cn(
									"aria-disabled:cursor-default aria-disabled:text-ink-disabled!",
									"aria-disabled:hover:bg-transparent! aria-disabled:hover:text-ink-disabled!",
									// The chord follows its item's disabled step - see the note on the row above.
									"aria-disabled:[&_kbd]:text-ink-disabled!",
								)}
							>
								<ChevronDown aria-hidden="true" />
								<span>Move conversation down</span>
								<span className="ml-auto pl-6">
									<KeyboardShortcut
										shortcut={chatPinMoveCapJoined(1, isMac)}
										joined
									/>
								</span>
							</ContextMenuItem>
						</>
					)}
				</ContextMenuContent>
			</ContextMenu>
		);
	};
	/*
	 * WHAT PRESSING A MARK DOES, by the mark's kind. `available` updates the item;
	 * `failed` retries it (the server clears the backoff and re-runs) unless a retry
	 * cannot change the answer (`hub-item-missing`, `prompt-too-long`), where the
	 * detail pane's sentence is the useful thing; `review` is a decision only the
	 * person can make, so it OPENS the detail pane, where the choice and a preview
	 * live, and applies NOTHING (UX round 1, U3). An `available` press whose answer
	 * is `needs-review` goes there too - the merge ran and refused, and pressing
	 * again would only refuse again.
	 */
	const openHubDetail = (kind: HubItemKind, name: string) =>
		navigate(`/agents?kind=${kind}&name=${encodeURIComponent(name)}`);
	const pressHubMark = async (
		kind: HubItemKind,
		name: string,
		mark: HubMark,
	) => {
		if (mark.kind === "review") return openHubDetail(kind, name);
		if (mark.kind === "failed" && !mark.retryable)
			return openHubDetail(kind, name);
		const reports =
			mark.kind === "failed"
				? await hub.retryItem(kind, name)
				: await hub.applyItem(kind, name);
		if (reports?.some((report) => report.outcome === "needs-review"))
			openHubDetail(kind, name);
	};
	/*
	 * FOCUS AFTER "UPDATE ALL". The control that was pressed leaves the heading the
	 * moment fewer than two items wait, and Chrome then puts focus on `body`, which
	 * drops a keyboard reader out of the list (UX round 1, U5). The section's own
	 * heading is the stable place to hand it to; the roll-up under it names what
	 * still needs the person.
	 */
	const updateAllHub = async (kind: HubItemKind) => {
		await hub.applyAll(kind);
		requestAnimationFrame(() => {
			const active = document.activeElement;
			if (active && active !== document.body) return;
			document
				.querySelector<HTMLElement>(
					`[data-chat-section="${kind === "agent" ? "agents" : "teams"}"]`,
				)
				?.focus();
		});
	};
	/*
	 * The section's controls (in the heading row, so they move nothing) and its
	 * lines (sign-in, the check answer, the roll-up, a refusal). The sign-in line is
	 * hosted by ONE section, Agents: it is one fact about the account, and drawing it
	 * per section read as the same sentence twice (design D5).
	 */
	const hubControls = (kind: HubItemKind) => (
		<HubHeadingControls
			kind={kind}
			available={hubAvailableCount(hubUpdates.data, kind)}
			busy={hub.pending.has(`all:${kind}`)}
			onUpdateAll={() => void updateAllHub(kind)}
			onCheck={
				kind === "agent" && hubTracked ? () => void hub.checkNow() : undefined
			}
			checking={hub.pending.has("check")}
		/>
	);
	const hubLines = (kind: HubItemKind) => (
		<HubSectionLines
			kind={kind}
			/*
			 * HOLD THE CAPTION LINE OPEN where the hub is a live concern for this
			 * person (design round 2, D13). The sign-in sentence arrives on a POLL -
			 * the backend started reporting `no-credential` for a linked item - so
			 * without the reservation that poll pushes every row below the heading
			 * down one line with no user action behind it. Reserved when the hub
			 * already tracks something, or when the account cannot reach it at all
			 * (the sign-in line's own precondition, so it lands in held space). A user
			 * with neither pays nothing.
			 */
			reserve={
				kind === "agent" &&
				(hubTracked || hubUpdates.data?.credential === "none")
			}
			signIn={kind === "agent" ? hubSignInLine(hubUpdates.data) : null}
			signInHref="/settings?section=radient"
			rollup={hub.rollups[kind]}
			note={
				hub.notes[`all:${kind}`] ??
				(kind === "agent" ? hub.notes.check : undefined)
			}
			onDismissRollup={() => hub.clearRollup(kind)}
		/>
	);
	const entity = (kind: ChatTarget["kind"], name: string, pinKey = name) => {
		const rows = scopeRows(kind, name);
		const key = catalogueScopeKey(kind, name);
		/*
		 * THE NAME A PERSON READS, beside the slug every lookup in this function
		 * addresses. Teams resolve through the catalogue's label lookup; agents
		 * render unchanged (labels are a team field). The staging press, the
		 * agents-route URL and every scope key below keep reading `name`.
		 */
		const displayName = kind === "team" ? teamLabelFor(name) : name;
		/*
		 * The tooltip the name span carries (design round 1, D2/D4): `Label (slug)`
		 * when the two differ - the row truncates long labels, the slug is the
		 * string every other surface addresses the team by, and hovering is how a
		 * clipped name is read whole or recovered - and the plain name otherwise,
		 * so even a truncated slug stays readable. The button's own title keeps
		 * naming the ACTION it runs.
		 */
		const nameTitle =
			displayName !== name ? `${displayName} (${name})` : displayName;
		const open = Boolean(query) || isOpen(key);
		/*
		 * THE BOUND ON THIS GROUP'S OWN ROWS, and all three of its rules - the
		 * catalogue's order untouched, running rows exempt, a search never bounded -
		 * live in `chat-sidebar-view.ts` beside the ladder they share with the chats
		 * list (see `entityRows`).
		 *
		 * IT IS TAKEN OVER THE ROWS THE GROUP DRAWS, which are already narrowed by the
		 * query and partitioned by the archive rules - so the bound can never act as a
		 * filter over a search answer, and a hit the reader is looking for cannot hide
		 * behind a press.
		 */
		const page = entityRows(rows, {
			loads: entityLoads[key] ?? 0,
			currentId: selectedConversation,
			searching: Boolean(query.trim()),
		});
		const shown = page.rows;
		/*
		 * THE GROUP'S BADGE AND ITS SENTENCES, both from the module rather than from a
		 * condition here (`sidebar-scope-paging.ts` carries the rules and their
		 * reasons). The badge reads the CENSUS when the daemon sent one, so a group
		 * holding 434 conversations stops advertising the 283 a page happened to
		 * carry; the view is what makes "No chats yet" unreachable while the census
		 * says otherwise, which is the operator's own screenshot.
		 */
		const badge = groupBadgeCount({
			pageable: groupPaging,
			total: groupPaging ? scopeCensusTotal(catalogueCounts, kind, name) : null,
			held: rows.length,
			searching: Boolean(query.trim()),
		});
		const view = groupChatsView({
			pageable: groupPaging,
			scope: catalogueScopes[key],
			/*
			 * THE SCOPE'S OWN LIST, not the rows drawn (round 2, R2-3): the press's arithmetic
			 * and its focus index both count the rows this group HOLDS, and a row the search
			 * filtered out or that the panel does not draw is still one of them. Falling back
			 * to the drawn rows is the withdrawn path, where there is no scope at all.
			 */
			held: catalogueScopes[key]?.ids.length ?? rows.length,
			total: groupPaging ? scopeCensusTotal(catalogueCounts, kind, name) : null,
		});
		/*
		 * THE GROUP'S OWN FOOT (`chat-sidebar-view.ts` words it and gives the reasons).
		 *
		 * IT READS `view` BESIDE IT, and that is why it lives here rather than beside the
		 * bound: `view` is THIS GROUP's `groupChatsView` - the name shadows the sidebar's
		 * own view inside `entity` - and both facts the foot needs from it (whether the
		 * daemon still holds a cursor, and the size of the page behind it) only exist once
		 * it has been computed.
		 *
		 * `total` is the same number the BADGE states rather than the rows held, which is
		 * the whole point of the position: a reader comparing `10 of 41` with the badge
		 * `41` is comparing one claim with itself. On the paged path the badge is the
		 * census, so the position is taken against the census; on the withdrawn path both
		 * are the rows the group holds.
		 */
		const groupTotal = groupPaging
			? (scopeCensusTotal(catalogueCounts, kind, name) ?? rows.length)
			: rows.length;
		/*
		 * HOW MANY ROWS THE PRESS WILL ADD, and the two sources are one expression
		 * because the reader asked for one thing. When the bound is what withheld them
		 * the number is the ladder's next step bounded by what is left in hand; when
		 * everything in hand is already drawn and the daemon is still holding a cursor,
		 * it is the page the fetch will bring (`view.addCount`, the store's own
		 * `min(page, remaining)`), so the label stays honest about a number only the
		 * daemon has - the chats list's foot states the same rule for the same reason.
		 */
		const ladderRung = entityLoads[key] ?? 0;
		const ladderStep = pageLimit(ladderRung + 1) - pageLimit(ladderRung);
		const foot = entityMore({
			add:
				page.hidden > 0
					? Math.min(ladderStep, page.hidden)
					: groupPaging && view.more
						? view.addCount
						: 0,
			drawn: shown.length,
			total: groupTotal,
		});
		/*
		 * THE FOOT'S PRESS: SPEND THE RUNG, AND FOLLOW THE CURSOR WHEN THE RUNG IS AT
		 * OR BEYOND THE ROWS IN HAND. One gesture, because the reader asked for one
		 * thing - more chats - and which of the two happens is a fact about the daemon
		 * (whether it can page) rather than a choice to put in front of them. This is
		 * `pressPageMore`'s own shape one level down, and it replaces the bare cursor
		 * press this control used to carry: with a bound in front of the rows, a press
		 * that only fetched would bring rows the bound then hid.
		 */
		const pressEntityMore = () => {
			const next = ladderRung + 1;
			setEntityLoads((current) => ({ ...current, [key]: next }));
			if (!groupPaging) return;
			const held = catalogueScopes[key]?.ids.length ?? 0;
			if (
				catalogueScopes[key]?.nextCursor !== null &&
				pageLimit(next) >= held
			) {
				pressShowMore(kind, name, key, held, view.addCount);
			}
		};
		/*
		 * THE QUERY'S GATE OVER ENTITY ROWS, in the module rather than here (issue
		 * #663, UX round 1's U1): the roster filter's empty sentence has to count
		 * what actually draws, so the row and the count share ONE spelling of the
		 * rule - `entityQueryAdmits` carries it and its reasons.
		 *
		 * `displayName` rides in as the gate's optional label arm: a team drawn as
		 * `Release Engineering` stays findable by the words on screen as well as by
		 * the `release-crew` slug a power user types (the team-labels change).
		 */
		if (!entityQueryAdmits(name, rows.length, query, displayName)) return null;
		const Icon = kind === "team" ? Users : Bot;
		/*
		 * Whether THIS entity is the row a staged draft belongs to.
		 *
		 * Named because three elements need it, and the reason is the defect round 1
		 * found here: the ground used to be on the wrapper `div` alone while the name
		 * button inside it carries `rowStyle` — whose `hover:` step a CHILD
		 * paints over its parent's background, so the pointer replaced the mark across
		 * the whole row. The ground therefore goes on the wrapper (it fills the gaps
		 * and the rounded corners the 24px controls do not cover) AND on the name
		 * button, where `rowCurrent`'s `hover:` half is what beats the inherited hover
		 * step; and the two 24px controls drop the hover step while they sit on it.
		 */
		const staged = draft?.target?.kind === kind && draft.target.name === name;
		/*
		 * THE ROW'S PIN STATE (issue #663), true only where the control is drawn:
		 * teams carry no pins, and the lookup is by the row's stable key rather
		 * than its display name (the call site passes `profile.name`, and the
		 * module's header carries why that IS the stable key on today's wire).
		 */
		const pinnedAgent =
			kind === "agent" && sidebarView.pinnedAgents.includes(pinKey);
		const hubKey = hubItemKey(kind, name);
		const hubItem = hubItems.get(hubKey);
		const hubMark = hubMarkFor(hubItem);
		return (
			<div key={key} data-entity>
				<div
					className={cn(
						"group flex h-8 items-center gap-1 rounded-md",
						staged && rowCurrent,
					)}
				>
					<button
						type="button"
						data-disclosure
						aria-label={`${open ? "Collapse" : "Expand"} ${displayName} chats`}
						aria-expanded={open}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md",
							!staged && "hover:bg-row-hover",
						)}
						onClick={() => {
							/*
							 * CLOSING THE GROUP SPENDS ITS LADDER RUNG, and that is a decision
							 * rather than tidiness. Closing already discards the group's loaded page
							 * (`clearScope`, whose own note calls the next expansion "a fresh
							 * question"), and a rung that outlived the disclosure would make a 41-chat
							 * team draw 25 rows at a reader who had just asked to see the top of it -
							 * the bound undone by a round trip through the control that exists to
							 * apply it.
							 */
							if (open) {
								setEntityLoads((current) => {
									if (current[key] === undefined) return current;
									const next = { ...current };
									delete next[key];
									return next;
								});
							}
							toggle(key);
						}}
					>
						{open ? (
							<ChevronDown className="size-3.5" />
						) : (
							<ChevronRight className="size-3.5" />
						)}
					</button>
					{/* Clicking the name has always staged a draft, but nothing on the
				    row said so, so the primary action of the whole sidebar was
				    invisible and went unused. The glyph is the label for that
				    existing action, NOT a second control: putting it inside the same
				    button keeps one click target for one outcome, adds no tab stop,
				    and leaves the arrow-key traversal in `keyDown` untouched. Its
				    slot is reserved at rest rather than inserted on hover, because a
				    row that reflows under the pointer is worse than no affordance —
				    only `opacity` changes, which is also what keeps this inside
				    § Motion's rule that nothing lifts, scales or translates on hover.
				    `group-focus-within` is what makes it reachable without a mouse. */}
					<button
						type="button"
						data-chat-row
						data-entity-name
						className={cn(rowStyle, "flex-1 text-left", staged && rowCurrent)}
						onClick={() => onStageDraft({ kind, name })}
						// The visible label is the bare name, which says who but not what
						// pressing it does. The accessible name states the action and still
						// contains the visible label, so voice control keeps working.
						//
						// `title` carries the same string deliberately: it is the only
						// affordance a SIGHTED pointer user gets for a name the row
						// truncates, and it is what names the action for someone who is
						// not using AT. It duplicates the accessible name for screen
						// reader users, which is redundant but not announced twice —
						// `aria-label` wins and `title` is ignored as a naming source.
						aria-label={`New chat with ${displayName}`}
						title={`New chat with ${displayName}`}
					>
						<Icon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate" title={nameTitle}>
							{displayName}
						</span>
						<MessageSquarePlus
							className={cn(
								// `ink`, not `ink-muted`: this glyph names what the row
								// DOES, and it sits 2px from the always-visible `...`. At
								// equal weight the secondary control was the louder mark of
								// the two, so the eye landed on "manage" first.
								"size-4 shrink-0 text-ink opacity-0",
								// The duration governs the transition INTO the current
								// state, so the resting value is the fade-OUT and the
								// hovered value is the fade-in: quick to appear, gentler to
								// leave, which is what stops it reading as a pop.
								"transition-opacity duration-base ease-out-quart",
								"group-hover:opacity-100 group-hover:duration-fast",
								"group-focus-within:opacity-100 group-focus-within:duration-fast",
							)}
							aria-hidden="true"
						/>
						{/* A reserved column, not just `tabular-nums`. Digit width alone
					    still lets an absent or two-digit count shift everything left
					    of it, which moved the glyph across 14px between rows and made
					    the reveal jitter as the pointer ran down the list. */}
						<span
							/*
							 * THE BADGE SAYS WHAT IT COUNTS (round 1, D1 + D5). The panel draws two
							 * kinds of number in one 12px column - a SECTION heading's count of the rows
							 * it is drawing, and a group's badge, which is this scope's census - and they
							 * look alike. `title` is what a pointer user gets; the `sr-only` span below is
							 * what a screen reader gets, because this digit sits inside buttons whose own
							 * `aria-label`s replace their children and it was otherwise announced nowhere
							 * at all.
							 */
							title={badge > 0 ? groupBadgeLabel(badge) : undefined}
							className="min-w-4 shrink-0 text-right text-meta tabular-nums text-ink-dim"
						>
							{badge || ""}
						</span>
					</button>
					{/*
					 * THE CENSUS, ANNOUNCED (round 1, D5), and INSIDE THE ROW rather than after
					 * it: a sibling element between this row and the group's body is a sibling the
					 * disclosure's own consumers walk past - the evidence rig reads the body as the
					 * row's next element, and an `sr-only` span (absolutely positioned, out of flow)
					 * is text in the row rather than a new thing between the row and its children.
					 */}
					{badge > 0 && (
						<span className="sr-only">{groupBadgeLabel(badge)}</span>
					)}
					{/*
					 * THE ROSTER'S PIN (issue #663), a SIBLING of the name button rather
					 * than a glyph inside it, because it is a control: pressing it writes
					 * the view (`togglePinnedAgent`), where the name's reveal glyph is
					 * the label for the name's own press. Agent rows only - a team is
					 * not a roster entry a reader holds order over here.
					 *
					 * IT FOLLOWS THE ROW'S REVEAL IDIOM, which is what keeps the row
					 * from reflowing: the slot is RESERVED at rest and only `opacity`
					 * changes - revealed by `group-hover`/`group-focus-within` like
					 * the `MessageSquarePlus` glyph three elements up - while a PINNED
					 * row draws its mark AT REST (`opacity-100`, `ink`, and the same
					 * `fill` idiom the conversation row's pin uses) so the pinned set
					 * reads without the pointer.
					 *
					 * THE LABEL NAMES THE SUBJECT; THE STATE IS `aria-pressed` (agent review
					 * round 1's B2, UX round 1's U7). The label used to swap Pin/Unpin AND
					 * carry `aria-pressed`, which a screen reader reads as "Unpin agent,
					 * pressed" - an action and a state arguing - and it never said WHICH
					 * agent, while every sibling control on the row does (`Expand ${name}
					 * chats`, `Manage ${name}`). It is now the constant `Pin “name”` with
					 * `aria-pressed` reporting the state - the toggle pattern a screen
					 * reader expects - and the ACTION lives in the tooltip, where the
					 * pointer user who asks for it can read it.
					 *
					 * IT CARRIES THE APP'S OWN TOOLTIP (design round 1's D7, UX's U8), not a
					 * native `title`: the four band controls directly above use `Tooltip`,
					 * and two tooltip systems one inch apart in the same column was the
					 * note both lanes landed. The wrapper is `asChild`, so the button
					 * keeps its exact place in the row - no wrapper element, and the row
					 * structure the selection suite walks is unchanged.
					 *
					 * THE MOVED ROW AND THE POINTER (UX round 1's U4). The button is keyed
					 * by the row's own stable key, so when pinning lifts the row React
					 * moves the SAME element and keyboard focus travels with it: the next
					 * Space unpins the agent the reader pinned, not a neighbour. The
					 * pointer is not promised the same - the row leaves from under the
					 * cursor and whatever lands there belongs to another agent, so a
					 * second press must be re-aimed. A settle delay was considered and
					 * refused: a press the reader makes is a press the reader means, and
					 * time-locking a control is a worse lie than a row that moves. The
					 * lifted row goes to the TOP of the section, so it cannot leave the
					 * scroll it was pressed in.
					 *
					 * The ground is the row state (`hover:bg-row-hover`, guarded
					 * `!staged` exactly like the two 24px controls beside it), never a
					 * menu ground: `chat-sidebar-selection.test.mjs` counts every
					 * `hover:bg-*` in the panel and this control is one of them.
					 */}
					{kind === "agent" && (
						<Tooltip
							content={pinnedAgent ? `Unpin “${name}”` : `Pin “${name}”`}
						>
							<button
								type="button"
								data-agent-pin={pinKey}
								className={cn(
									"flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim hover:text-ink-muted",
									!staged && "hover:bg-row-hover",
									pinnedAgent ? "opacity-100" : "opacity-0",
									// The duration governs the transition INTO the current state,
									// so the reveal is quick and the leave is gentler - the
									// `MessageSquarePlus` rule, restated by use rather than by
									// a second explanation.
									"transition-opacity duration-base ease-out-quart",
									"group-hover:opacity-100 group-hover:duration-fast",
									"group-focus-within:opacity-100 group-focus-within:duration-fast",
								)}
								aria-pressed={pinnedAgent}
								aria-label={`Pin “${name}”`}
								onClick={() =>
									setChatSidebarView(togglePinnedAgent(sidebarView, pinKey))
								}
							>
								<Pin
									aria-hidden="true"
									className={cn("size-4", pinnedAgent && "text-ink")}
									fill={pinnedAgent ? "currentColor" : "none"}
								/>
							</button>
						</Tooltip>
					)}
					{hubMark && hubItem && (
						<HubUpdateMark
							item={hubItem}
							mark={hubMark}
							busy={hub.pending.has(hubKey)}
							staged={staged}
							onPress={() => pressHubMark(kind, name, hubMark)}
						/>
					)}
					<button
						type="button"
						// Stepped down from `ink` so the row's own action outranks it.
						// This is the secondary control on the row and it is visible at
						// rest, which was enough to make it dominate the reveal.
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim hover:text-ink-muted",
							!staged && "hover:bg-row-hover",
						)}
						aria-label={`Manage ${displayName}`}
						onClick={() =>
							navigate(`/agents?kind=${kind}&name=${encodeURIComponent(name)}`)
						}
					>
						<MoreHorizontal className="size-4" />
					</button>
				</div>
				{hub.notes[hubKey] && <HubRowNote note={hub.notes[hubKey]} />}
				{open && (
					<div>
						{/*
						 * THE VIEWED CONVERSATION, FIRST WHEN THE BOUND WITHHELD IT, AND
						 * LABELLED.
						 *
						 * It is drawn out of the catalogue's order on purpose, and the alternative
						 * is refused rather than unconsidered: admitting it in place would mean
						 * raising this group's bound until the row fits, which in a 41-chat team
						 * draws 40 rows at a reader who asked for the top of it. One row is lifted
						 * instead.
						 *
						 * WHY THE LABEL, when the row already wears the panel's `rowCurrent`
						 * ground: a lifted row reads as a row the sort got wrong - `Team
						 * conversation 35 · 1d` above `Team conversation 1 · 1h` is a broken list
						 * unless something says why. The highlight says WHICH row it is; the label
						 * says WHY it is at the top, which is the difference between an explained
						 * exception and a corrupted order. It is the SAME wording the chats list
						 * uses for its own lifted row (`sectionLabel` is that function, not a
						 * second one), so the panel explains one situation one way - and it is
						 * drawn only while the lift is, so a group the bound did not withhold
						 * this row from pays nothing for it.
						 */}
						{page.lifted && sectionLabel("Current chat")}
						{shown.map((row) => sessionRow(row, true))} {/*
						 * THE GROUP'S OWN SENTENCE.
						 *
						 * It is drawn from `view.sentence` and never chosen here, because the
						 * sentence and the condition that selects it are ONE claim: the whole
						 * defect this closes was a group with 434 chats drawing "No chats yet"
						 * because the only question asked was whether the page it happened to
						 * hold was empty. See `sidebar-scope-paging.ts` for the precedence and
						 * for the invariant that can never render that sentence.
						 *
						 * `aria-live="polite"` on the loading register only: the panel already
						 * announces `Loading agents…` that way, and a reader who expanded a group
						 * is owed the fact that something is on its way. The other sentences are
						 * answers rather than transitions, and an answer that appears as the
						 * reader arrives is already where they are looking.
						 */}
						{/*
						 * THE SENTENCE'S OWN REGION, MOUNTED IN EVERY STATE (round 2, R2-5), and
						 * the ONE treatment all three refusal sites wear (round 2, D10 = U9):
						 * clamped to two lines so a long backend sentence cannot move the control,
						 * the transport's own detail in `title`, and the Retry on its OWN line so its
						 * position does not depend on the message's length.
						 *
						 * WHY THE REGION CANNOT ARRIVE WITH ITS TEXT: the swap from "Loading chats…"
						 * to the settled sentence happens in ONE commit, so a region that mounts with
						 * the new text has no change to announce - the outcome of a press was silent.
						 * `sr-only` while there is nothing to say keeps it in the tree and out of the
						 * layout.
						 */}
						<div
							aria-live="polite"
							className={
								view.state !== "rows" && view.sentence !== null
									? "py-1 pl-7"
									: "sr-only"
							}
						>
							{view.state !== "rows" && view.sentence !== null && (
								<p
									className="line-clamp-2 text-meta text-ink-dim"
									title={view.sentence}
								>
									{view.sentence}
								</p>
							)}
							{/*
							 * AND THE REGION'S RETRY ONLY WHEN THIS IS THE FAILED FIRST PAGE
							 * (round 3, R3-2). In the rows-plus-failed-extension state the panel
							 * draws its own Retry below - the one that re-reads from the CURSOR -
							 * and this second copy sat inside the `sr-only` region, one Tab away
							 * and performing a different action (a first-page re-read). A control
							 * a reader can reach without seeing it, doing something else, is worse
							 * than no control: the region carries the sentence's announcement and
							 * the rows state draws the control.
							 */}
							{view.state !== "rows" && view.retry && (
								<p className="pt-1">
									<button
										type="button"
										className="text-meta text-ink-dim underline hover:text-ink"
										onClick={() => void fetchScopePage(kind, name, null)}
									>
										Retry
									</button>
								</p>
							)}
						</div>
						{/*
						 * THE GROUP'S TAIL, and why it is an EXPLICIT row rather than a
						 * sentinel (ruling 2 / design §5.4). The entity region is shared by every
						 * expanded group, so a sentinel near the fold would fire for whichever
						 * groups happen to sit there - the load would become a function of scroll
						 * position rather than of intent, and several groups would extend at once,
						 * which is the amplification this change exists to remove, reintroduced
						 * inside one container. An explicit row is deterministic and is the
						 * operator's own stated fallback ("load them a page at a time").
						 *
						 * Its three states are the extension's whole life: the press, the wait,
						 * and the refusal. The refusal KEEPS the rows above it - they are not a
						 * claim the failure retracts - and offers the press again, which is the
						 * only remedy for a page that did not arrive.
						 */}
						{view.state === "rows" &&
							(catalogueScopes[key]?.loading ? (
								<p
									className="py-1 pl-7 text-meta text-ink-dim"
									aria-live="polite"
								>
									Loading more…
								</p>
							) : view.retry ? (
								/*
								 * THE REFUSAL'S SHAPE IS FIXED RATHER THAN MEASURED (round 1, D4). The
								 * sentence is clamped to two lines so a long daemon string cannot push the
								 * control down the panel - the position the reader is aiming at must not
								 * depend on how long the message turned out to be - and the transport's
								 * own text rides in `title`, where a reader who wants the detail can get
								 * it without the panel shouting it. The store's sentence is what is drawn.
								 */
								<>
									<p
										className="line-clamp-2 py-1 pl-7 text-meta text-ink-dim"
										aria-live="polite"
									>
										{view.sentence}
									</p>
									<p className="py-1 pl-7">
										<button
											type="button"
											className="text-meta text-ink-dim underline hover:text-ink"
											onClick={() =>
												pressShowMore(
													kind,
													name,
													key,
													catalogueScopes[key]?.ids.length ?? rows.length,
													view.addCount,
												)
											}
										>
											Retry
										</button>
									</p>
								</>
							) : foot ? (
								<button
									type="button"
									/*
									 * A DRIVER ANCHOR, on the convention `data-chat-section` and
									 * `data-session-delete` already follow: the label is a copy string, so a
									 * scene that reached this control by its text would be asserting a copy
									 * edit, and the tail's own press is what the evidence frame has to make.
									 *
									 * `data-scope-more` is kept AND `data-entity-more` is added, rather than
									 * one replacing the other: the first is what the paged path's own scenes
									 * already select on, and re-pointing them at a new anchor in the same
									 * change that moved the label would leave a broken scene looking like a
									 * broken feature. The second names this control precisely for the frames
									 * the bound is evidenced by, which no selector before it could do.
									 *
									 * `data-chat-row` IS THE KEYBOARD PATH (round 1, U2). The control sits at
									 * the end of the group's own rows, so reaching it by Tab means passing
									 * every one of them - but the region's arrow-key traversal walks
									 * `[data-chat-row]` elements and focuses them, so joining that set puts the
									 * press one ArrowDown from the group's last row.
									 */
									data-scope-more={key}
									data-chat-row
									/*
									 * The bound's own anchor, BESIDE `data-scope-more` rather than replacing
									 * it: the paged path's scenes already select on that one, and re-pointing
									 * them in the same change that moved the label would leave a broken scene
									 * looking like a broken feature. This one is what the frames the bound is
									 * evidenced by read.
									 */
									data-entity-more={key}
									aria-label={`${foot.aria} in ${displayName}`}
									title={`${foot.aria} in ${displayName}`}
									className="block w-full py-1 pl-7 text-left text-meta text-ink-dim underline hover:text-ink"
									onClick={pressEntityMore}
								>
									{/*
									 * WHAT THE PRESS WILL ADD, not the page size (round 1, D7): with 45
									 * still to come beside a 70 badge, `Show 25 more` was a page size
									 * dressed as a remainder. And the position beside it is the brief's
									 * own rule (2026-09-27): "the count and the disclosure must agree",
									 * so a reader who sees ten rows under a `41` badge can tell whether
									 * they are looking at ten of forty-one or all of them.
									 */}
									{foot.label}
								</button>
							) : null)}
					</div>
				)}
			</div>
		);
	};
	/*
	 * The one place a search count is worded, for both call sites: the group
	 * headings and the All chats row. They held two copies of one expression,
	 * which is how the same false total had to be found twice; a count stated in
	 * two places is a count that can be stated two ways.
	 *
	 * While the answer is clipped the number is a floor, so it says so — a
	 * trailing `+` on the badge and "or more" for a screen reader, and "At least"
	 * in the tooltip that names the whole claim. The `+` is not decoration: the
	 * badge is the only part of the sentence a sighted user reads at a glance.
	 */
	const countBadge = (count: number) => (
		<span
			className="text-meta tabular-nums"
			title={
				query
					? `${clipped ? "At least " : ""}${count} ${count === 1 ? "chat matches" : "chats match"} this search${clipped ? "; the list stops there" : ""}`
					: undefined
			}
		>
			{/*
			 * The glyphs and the sentence are ONE claim, so only one of them is spoken.
			 * A clipped badge renders `100+` and the `sr-only` span adds ` or more
			 * matching`, which gave the group the accessible name `All chats 100+ or
			 * more matching` — "or more" twice, once as the `+` and once in words
			 * (design round 6, D23). `aria-hidden` on the glyphs is the same shape the
			 * row's own mark uses: what a sighted reader sees, and a sentence carrying
			 * it for everyone else, rather than a sum of the two.
			 */}
			<span aria-hidden="true">
				{count}
				{clipped ? "+" : ""}
			</span>
			{/*
			 * A query turns these numbers from "what you have" into "what matched",
			 * with identical styling, so the count needs to say which claim it is
			 * making (design round 1, D5); a clipped answer adds the third claim, and
			 * the sentence is rendered in BOTH states rather than only under a query
			 * (design round 7, D25). What each state announces, and why it is pure and
			 * tested, is `chatCountAnnouncement` in `features/chat/chat-search.ts`.
			 */}
			<span className="sr-only">
				{chatCountAnnouncement(count, Boolean(query), clipped)}
			</span>
		</span>
	);
	/*
	 * A section's header, as a ROW of controls rather than one button.
	 *
	 * The toggle is the whole header — clicking anywhere on it collapses the group
	 * — so a second control nested inside it would be a button within a button:
	 * one hit area for two actions, where an inner click also toggles the group
	 * and neither control can be activated independently. They are SIBLINGS here,
	 * which is what lets the action sit in the header at all; the toggle keeps
	 * every property it had (the row's `data-chat-row` stamp, so the arrow walk
	 * still visits it, and its `aria-expanded`).
	 *
	 * `action` is undefined for every group but the one that can carry one, so the
	 * row renders as it always did for the rest — including the two properties
	 * that follow from carrying one:
	 *
	 * - the row is a NAMED CONTAINER (`@container/chatheading`), which is the width
	 *   the action's own label sheds against;
	 * - and it STICKS to the top of the list's scroll box, so the control travels
	 *   with the pile it clears instead of sitting 632px above it once the operator
	 *   has scrolled into his own 38 rows (design D2). Sticky only here: the other
	 *   three headings would be a layout change nothing asked for, and this row is
	 *   bounded by its own section, so it un-sticks on its own when the group ends.
	 *   The ground is `bg-surface` (the panel's own) because rows scroll under it.
	 *
	 * The label carries `min-w-0 flex-1 truncate` — this file's own idiom for the
	 * one flexed label that renders a string it can run out of, since a fixed
	 * literal cannot truncate anything and a 28px row cannot hold a wrapped line.
	 */
	const heading = (
		key: string,
		label: string,
		initial: boolean,
		count?: number,
		glyph?: LucideIcon,
		action?: ReactNode,
		toggleRef?: Ref<HTMLButtonElement>,
		// Ordinary (non-sticky) controls after the toggle: unlike `action`, which
		// pins the whole row, these cost no height and no pinned chrome.
		trailing?: ReactNode,
	) => {
		/*
		 * A GROWN SECTION SAYS SO, AND NAMES THE WAY BACK (UX round 1's U1 and U5,
		 * design round 1's D1 and D2). Both streams MEASURED this heading as silent:
		 * the band is `AE` 0 between the resting and grown states (eight rows and
		 * twelve draw the same heading), `title: null` and `aria-describedby: null` on
		 * the toggle, and in the grown state the foot is GONE (`foot: null`) - so the
		 * reader who raised a cap can neither tell this section from a shipped one nor
		 * find the press that puts it back.
		 *
		 * THE HINT IS ON THE TOGGLE, not on a second control: the press that already
		 * exists IS the reset (collapse, then reopen, returns the shipped list), and
		 * the operator's decided shape is copy on an existing affordance. It is read
		 * from the same map `cappedRows` slices rows with, so the heading cannot claim
		 * a raise the draw does not show.
		 *
		 * TWO CHANNELS, ONE SENTENCE: `title` is the pointer's channel (the heading is
		 * the only thing on screen in the grown state, so the hover is where a reader
		 * who is looking will find it), and the `sr-only` element the toggle points its
		 * `aria-describedby` at is the channel for every other reader - `title` alone
		 * reaches no keyboard reader, and engines are least reliable about it. The
		 * element is rendered only while the hint applies, so the id is never dangling.
		 *
		 * NO VISUAL MARK, DELIBERATELY: a badge or tint on this band is a pixel change on
		 * a surface whose frames this round cannot re-shoot, and it is the design
		 * re-check's call rather than this pass's - what must not be missing is a state
		 * a screen reader can already hear and a pointer can already read.
		 */
		const grownHint = sectionIsGrown(sectionCaps[key])
			? SECTION_GROWN_HINT
			: null;
		return (
			<div
				className={cn(
					"@container/chatheading flex h-7 items-center gap-1",
					/*
					 * `-top-2` because the scroll box carries `pt-2`: pinning at `top: 0` pins to
					 * the CONTENT edge, 9px below the box's own edge (8px of padding plus the
					 * 1px `border-t`), and padding is not a clip — the row sliding up keeps its
					 * tail visible in that band, cut mid-glyph at the hairline. The negative
					 * offset starts the pinned row's own box at the box's edge, so rows go UNDER
					 * it rather than past it (design D2-2), and the resting layout is unchanged.
					 */
					action && "sticky -top-2 z-10 bg-surface",
				)}
			>
				<button
					ref={toggleRef}
					type="button"
					data-chat-row
					/*
					 * The section a driver scene expands (`data-chat-section={key}`): a collapsed
					 * section draws no rows, and its own label is a copy string, so a scene that
					 * reached it by text would be asserting a copy edit - the convention
					 * `data-chat-row` and `data-session-delete` already follow.
					 */
					data-chat-section={key}
					className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-body-sm font-medium text-ink-muted hover:bg-row-hover"
					aria-expanded={query ? true : isOpen(key, initial)}
					/* `title` is the pointer's copy; both it and the description below come
					 * from ONE sentence (`SECTION_GROWN_HINT`), so they cannot drift. */
					title={grownHint ?? undefined}
					aria-describedby={grownHint ? sectionGrownHintId(key) : undefined}
					onClick={() => toggle(key, initial)}
				>
					{query || isOpen(key, initial) ? (
						<ChevronDown className="size-3.5" />
					) : (
						<ChevronRight className="size-3.5" />
					)}
					{/*
					 * THE SECTION'S OWN GLYPH (operator, 2026-09-25: "improve the design of
					 * the team/agent collapsibles to be more modern"). A muted leading mark
					 * is how the reference's group headers read - `BOT Agents` rather than a
					 * bare word - and it earns its pixel by being the only thing that
					 * distinguishes two sections whose labels are otherwise the same shape.
					 * `aria-hidden`, because the label beside it already names the section.
					 */}
					{glyph
						? createElement(glyph, {
								"aria-hidden": true,
								className: "size-3.5 shrink-0 text-ink-dim",
							})
						: null}
					<span className="min-w-0 flex-1 truncate text-left">{label}</span>
					{/* A zero badge next to a group that already says it is empty is the
			    same fact twice; only a non-zero count carries information. */}
					{count !== undefined && count !== 0 && countBadge(count)}
				</button>
				{/* The hint the toggle points at, and ONLY while it applies: a rendered
			    but unreferenced element is a reading cost with no reader. */}
				{grownHint && (
					<span id={sectionGrownHintId(key)} className="sr-only">
						{grownHint}
					</span>
				)}
				{action}
				{trailing}
			</div>
		);
	};
	/*
	 * A SECTION LABEL of the one list (§C1): `RUNNING`, `TODAY`, `THIS WEEK`,
	 * `OLDER`, and `PINNED` when the capability is on.
	 *
	 * TEXT, NOT A CONTROL, and that is the U22 fix rather than a simplification:
	 * the old headings were disclosure buttons, so a click meant for a row a few
	 * pixels lower collapsed the section under it. A label is `text-meta` at 500 in
	 * `ink-dim`, set in capitals by CSS (the source keeps sentence case, so a screen
	 * reader says "This week" rather than spelling it), and it is not in the arrow
	 * ring. `action` is the one header control the list carries - `Mark all N read`
	 * - as a sibling, never nested.
	 *
	 * 24px tall with 8px above it: §B6's "8px between a section's rows and its next
	 * label (24px label block)". The FIRST label drops the 8px (`first:mt-0` on the
	 * section), so the list's top edge is the destinations' 16px step and nothing
	 * more.
	 */
	/*
	 * HOW FAR A COLLAPSIBLE SECTION MAY EXPAND (operator, 2026-09-25: "we can just
	 * limit how far a collapsible section can expand").
	 *
	 * The cap is a ROW COUNT and never a height, which is the whole point: a
	 * height cap needs a scrollbar to reach what it clipped (the two nested
	 * scrollers this replaces), while a count cap costs a click and clips nothing.
	 * `Show N more` raises THAT section's own cap by one step, so a reader who
	 * wants the eleventh agent does not also open the eleventh team.
	 *
	 * The state is per window and not persisted: it is a question about the moment
	 * ("which of my agents are in this list, again?") rather than a preference,
	 * and a remembered cap would leave a reader who expanded it once in June with
	 * a permanently longer column every launch afterwards.
	 */
	const [sectionCaps, setSectionCaps] = useState<Record<string, number>>({});
	/*
	 * HOW FAR ONE EXPANDED ENTITY'S OWN SESSIONS HAVE BEEN LOADED, per group.
	 *
	 * THE SAME LADDER AS THE CHATS LIST, not the eight-row cap beside it: the
	 * operator's contract for this list is "starts with 10, then 25, then 50, and
	 * then user can click to load more", and a group of chats is that list one
	 * level down rather than the entity roster `cappedRows` bounds (which is a
	 * list of AGENTS or TEAMS and keeps its own eight-row step).
	 *
	 * KEYED BY THE GROUP, so a reader who opens a second team does not also spend
	 * the first team's rung - the same reason `sectionCaps` is keyed.
	 *
	 * RESET WHEN THE GROUP CLOSES, and this is a decision rather than tidiness:
	 * closing a group already discards its loaded page (`clearScope`, whose own
	 * note calls the next expansion "a fresh question"), and a rung that outlived
	 * the disclosure would make reopening a 41-chat team draw 25 rows at a reader
	 * who had asked to see the top of it. It is window state and never persisted,
	 * for `sectionCaps`' reason: the question is about the moment.
	 */
	const [entityLoads, setEntityLoads] = useState<Record<string, number>>({});
	/*
	 * THE SECTION FOOT'S FOCUS CONTRACT (UX round 1's U3, design round 1's D3),
	 * mirroring `tailFocusRef` two levels of list up.
	 *
	 * THE DEFECT, MEASURED BY BOTH STREAMS: after a focused activation of
	 * `Show 4 more` the foot UNMOUNTS (the raised cap stops bounding the rows) and
	 * nothing claims the focus, so `document.activeElement` is `BODY` - a keyboard
	 * reader is returned to the top of the document by the press that was supposed to
	 * bring them more rows. The panel already owns this contract: `pressShowMore` and
	 * its tail-focus effect send focus to the first row the press added, with the
	 * group's own disclosure as the fallback and `<body>` never reachable.
	 *
	 * WHAT THIS RECORD CARRIES: the section's key and the count of rows DRAWN before
	 * the press (`at`), which is exactly the index of the first row the press adds -
	 * `cappedRows` slices `rows.slice(0, cap)`, so the raise draws `rows[at]`
	 * onwards. The effect below reads it after the commit, the same shape the tail
	 * press uses (a ref rather than state, because it must not re-render the section
	 * it describes).
	 */
	const sectionFootFocusRef = useRef<{
		key: string;
		at: number;
	} | null>(null);
	const cappedRows = (key: string, rows: ReactNode[]) => {
		const cap = sectionCaps[key] ?? SIDEBAR_SECTION_ROWS;
		const hidden = rows.length - cap;
		/*
		 * THE FOOT'S OWN TWO FACTS (UX round 1's U1 and N1, design round 1's D1):
		 *
		 * A NAME THAT CARRIES ITS SECTION. The visible label names the remainder and
		 * not the section, and two sections can each carry a foot, so a screen reader
		 * heard a bare `Show 4 more` twice over (both streams measured `aria-label:
		 * null`). The unit is the section's own key - the string
		 * `data-sidebar-section-more` already carries.
		 *
		 * AND THE RESET'S SENTENCE WHILE THE CAP IS RAISED. In the grown state the foot
		 * is usually GONE (which is why the heading carries the same sentence too); when
		 * a raise did not cover the rows the foot is still here, and this is the one
		 * place a pointer hovering the remainder can learn that a collapse is the way
		 * back. `title` carries BOTH facts because the name is a tooltip's ordinary job
		 * and the reset sentence is this control's news; the accessible name stays the
		 * name alone (a description is not a name).
		 */
		const footName = sectionMoreName(hidden, key);
		return (
			<>
				{rows.slice(0, cap)}
				{hidden > 0 && (
					<button
						type="button"
						data-sidebar-section-more={key}
						/*
						 * THE SECTION FOOT JOINS THE ARROW WALK (UX round 1's U4). The walk's
						 * stop list is `navRef`'s `[data-chat-row]` elements and the GROUP foot
						 * one level down has carried this stamp precisely so it sits one
						 * ArrowDown from the group's last row; the section's own foot was the
						 * one control in the entity region a keyboard reader could reach only by
						 * Tab-walking every row's controls (measured: 26 presses). The stamp
						 * puts it in the same roving ring `applyRowStop` maintains, so it is
						 * reachable by the arrow walk and keeps the ring's tabIndex contract.
						 *
						 * IT TRADES Tab FOR THE ARROW WALK, which is the trade the group foot one
						 * level down already made. `applyRowStop` keeps the ring ROVING: a
						 * `[data-chat-row]` control is `tabIndex` -1 unless it is the stop, so the
						 * measured 26-press Tab walk stops short of this foot from here on - those
						 * presses counted the filter field and the rows' own Expand/Pin/Manage
						 * controls, none of which carry the stamp, and the foot was the 26th
						 * precisely BECAUSE it was outside the ring. The arrow walk (and `F6` into
						 * the region) is now the path to it, exactly as it is to a row's own name
						 * button. Parity rather than a new loss: the entity region's contract is
						 * that `[data-chat-row]` IS the walk's stop list, and this was the one
						 * control in the region standing outside it.
						 */
						data-chat-row
						aria-label={footName}
						title={
							sectionIsGrown(cap)
								? `${footName} - ${SECTION_GROWN_HINT}`
								: footName
						}
						onClick={() => {
							/* Recorded BEFORE the raise, so `at` is the pre-press draw count. */
							sectionFootFocusRef.current = { key, at: cap };
							setSectionCaps((previous) => raiseSectionCap(previous, key));
						}}
						className="flex h-7 w-full items-center rounded-md px-2 text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
					>
						{sectionMoreLabel(hidden)}
					</button>
				)}
			</>
		);
	};
	const sectionLabel = (label: string, action?: ReactNode) => (
		<div className="flex h-6 items-center gap-1 px-2">
			<h3 className="min-w-0 flex-1 truncate font-medium text-ink-dim text-meta uppercase tracking-wide">
				{label}
			</h3>
			{action}
		</div>
	);
	/*
	 * THE LIST'S ONE TAB STOP (§C4 and UX-BASELINE U6; the U2 walk's 70 presses).
	 *
	 * WHAT WAS WRONG. Every row's button was an ordinary tab stop AND both of the
	 * row's acts beside it were too — they are revealed by `group-has-[:focus-visible]`, and
	 * a reveal that only a pointer could reach would not have been keyboard
	 * access at all. Twenty conversations therefore charged the reader sixty
	 * presses to walk from the list's top to the header, and the arrow traversal
	 * that already existed was a hundred more to reach the other end.
	 *
	 * WHAT THIS IS. One stop for the whole panel, and it belongs to the row the
	 * reader is ON. The browser is not told where the stop is by React — the rows
	 * carry no `tabIndex` prop — because the stop is a property of the WALK rather
	 * than of any row: it moves on every arrow press, it moves when focus lands on
	 * a row for any other reason (a click, a `/` search result, the move
	 * correction after a pin), and it has to survive rows mounting, unmounting and
	 * re-filing under a different section parent. So one function owns it
	 * (`applyRowStop`), three things call it, and a layout effect re-asserts it
	 * after every commit — a row that just mounted is `tabIndex` 0 by default, and
	 * the assertion is what stops the set from ever containing two members.
	 *
	 * The rows are collected by `[data-chat-row]`, the same query the arrow walk
	 * below uses, so the walk and the ring cannot disagree about what a row is.
	 */
	const rowStopRef = useRef<HTMLElement | null>(null);
	const applyRowStop = (stop: HTMLElement | null) => {
		const nav = navRef.current;
		if (nav === null) return;
		/*
		 * AND THE RING EXCLUDES WHAT THE CARET CANNOT REACH (agent review round 2's
		 * R7): the same rule the arrow walk applies below, so a `disabled` row can
		 * neither hold the stop nor keep `tabIndex` 0 - `focus()` on it is a no-op,
		 * and a stop nobody can focus is the dead stop that finding measured.
		 */
		const allRows = [...nav.querySelectorAll<HTMLElement>("[data-chat-row]")];
		const rows = allRows.filter(
			(row) => !(row as { disabled?: boolean }).disabled,
		);
		if (rows.length === 0) return;
		/*
		 * A departed stop hands the ring to the first row rather than leaving it
		 * empty: the pin's own move correction focuses a row that is a NEW node (the
		 * row re-files under a different section), and the node the reader was on is
		 * gone by then. Falling to the first row and then following focus would flicker
		 * the stop; following focus without the fallback would leave the ring empty for
		 * the commit in which the row moved. The fallback is what the layout effect
		 * applies, and focus then corrects it — the same order the pin's correction runs
		 * in.
		 */
		const target = stop !== null && rows.includes(stop) ? stop : rows[0];
		rowStopRef.current = target;
		for (const row of allRows) {
			row.tabIndex = rows.includes(row) && row === target ? 0 : -1;
			/*
			 * AND IT IS THE REGION'S DOOR TOO. `F6` into the sidebar should land on the
			 * row the reader was on, not on the panel's box: the stop is exactly "the row
			 * this reader is on", so saying it twice in two attributes is how the walk and
			 * the ring start disagreeing. `[data-region-entry]` is what `enterChatRegion`
			 * reads, and the roving stop is the only thing that writes it here.
			 */
			row.toggleAttribute(
				CHAT_REGION_ENTRY_ATTR,
				rows.includes(row) && row === target,
			);
		}
	};
	useLayoutEffect(() => {
		applyRowStop(rowStopRef.current);
	});
	/*
	 * FOCUS IS WHAT MOVES THE STOP. `onFocus` on the panel rather than `onFocus` on
	 * each row, because the rows are rendered by four different call sites (the
	 * list's sections, the entity disclosure's children, the agents region and the
	 * mark-all-read control) and a prop threaded through all of them is four places
	 * to forget. It is a React `onFocus` rather than a native capture listener for
	 * the reason `onBlur` on the row's own box is: React's synthetic focus event
	 * bubbles from the focused element, which is where the answer is.
	 */
	const onRowFocus = (event: ReactFocusEvent<HTMLElement>) => {
		const row = (event.target as HTMLElement).closest?.("[data-chat-row]");
		/*
		 * Only a row inside THIS panel moves the stop. Focus arriving on a control
		 * that is not a row - the search field, the foot's menu, a section's `Show
		 * more` - leaves it where it was, so Tab back into the list returns to the row
		 * the reader left rather than to the top.
		 */
		if (row !== null && row !== undefined && navRef.current?.contains(row))
			applyRowStop(row as HTMLElement);
	};
	/*
	 * THE ROW WHOSE CONTEXT MENU IS OPEN, as the sidebar's own state, because the
	 * menu's consequences cannot be trigger attributes: the box is ALREADY a Radix
	 * trigger (the shared Tooltip's) and carries the tooltip's `data-state` while
	 * the flyout is drawn - the very state a right-click happens in - so two
	 * triggers write one attribute and a rule authored against it would hold or
	 * drop depending on which component re-rendered last. The row's own
	 * consequences (the held reveal and ground) are ordinary conditional classes
	 * computed from this id instead, and `scripts/chat-sidebar-row-menu.test.mjs`
	 * pins the forbidden spelling rather than this comment. One id rather than a
	 * boolean per row: only one menu can be open, and a boolean would need a set
	 * of them.
	 */
	const [openMenuRowId, setOpenMenuRowId] = useState<string | null>(null);
	/*
	 * WHICH PATH OPENED THE OPEN MENU, because the two differ at both focus edges:
	 * the keyboard path lands in the first item on open (U-D4's minimum) and
	 * returns the caret to the row's button on close; the pointer path takes no
	 * focus OF ITS OWN but gives back what the primitive's open took (U8 below).
	 * A ref rather than state: it is read only inside the menu's own focus
	 * callbacks, and it must not re-render the row it describes.
	 */
	const menuOpenedByKeyboard = useRef(false);
	/*
	 * WHAT HELD FOCUS BEFORE A ROW'S MENU WAS ASKED FOR, for the pointer path's
	 * close (UX round 2, U8; re-read at the press by QA round 3's Q-1). The
	 * pointer path takes no focus of its own, but the primitive still moves
	 * focus into the panel on open - the shipped `pointer-hover` frame reads
	 * `focus: menuitem` - and on close the element holding it unmounts, so
	 * without a memory the caret fell to `<body>` and a reader who was typing
	 * had to click before the next keystroke landed (QA round 2's reading:
	 * composer focused -> right-click -> Escape -> `<body>`).
	 *
	 * READ AT `pointerdown`, IN THE CAPTURE PHASE, because the press itself is
	 * what moves focus: a real right-press's `mousedown` default focuses the
	 * row's button BEFORE the menu opens, so a capture inside `onOpenChange`
	 * remembered the button - Escape returned it and the next keystroke started
	 * the row's type-to-filter (QA round 3's Q-1, measured live). The capture
	 * phase runs before that default, where the control the reader was in is
	 * still the active element; `onOpenChange` keeps a capture for opens with
	 * no press (a dispatched `contextmenu`), guarded so it cannot overwrite the
	 * press-time value. One ref for the whole sidebar rather than one per row,
	 * for the same reason `openMenuRowId` is one id: only one menu can be open.
	 * Read in `onCloseAutoFocus`, never rendered - so a ref, not state.
	 */
	const menuFocusReturnRef = useRef<HTMLElement | null>(null);
	/*
	 * THE ID'S LATEST VALUE, read by the row instances' unmount cleanup
	 * (`RowMenuOwner`): a cleanup runs with what its own closure saw last, and
	 * the row that is LEAVING does not re-render first - so the value is kept
	 * here rather than expected through a prop. Synced after every id change,
	 * which every unmount that matters is a later commit of.
	 */
	const openMenuRowIdRef = useRef<string | null>(null);
	useEffect(() => {
		openMenuRowIdRef.current = openMenuRowId;
	}, [openMenuRowId]);
	/*
	 * THE KEYBOARD OPENER (`ContextMenu`, and `Shift+F10` with it): the keyboard's
	 * own way to ask "what can I do with this", the shape `use-link-subject.ts`
	 * already trusts over the platform.
	 *
	 * THE POINT IS SYNTHESISED, never read from the ambient event: a
	 * keyboard-originated `contextmenu` carries coordinates that are not specified
	 * (and may be `0,0`), which would anchor the panel to the viewport's corner
	 * and trip the primitive's own "position is indeterminate" path. The box's own
	 * edge is the anchor - `rect.left`, `rect.bottom - 1` - and dispatching the
	 * trigger's own `contextmenu` also sets the primitive's `hasInteractedRef`
	 * before `open`, so that path is unreachable by construction.
	 *
	 * WIRED ON THE BOX rather than on the button, because the box IS the trigger
	 * and the pointer path already works this way - a right-click anywhere inside
	 * the box opens the row's menu - so a `Shift+F10` pressed while focus is on
	 * one of the row's own controls opens it too: the row is the unit the menu
	 * acts on. `menuOpenedByKeyboard` is what the menu's focus callbacks read to
	 * keep the two paths' focus behaviour apart.
	 */
	const openRowMenuAtKeyboard = (event: KeyboardEvent<HTMLElement>) => {
		if (
			event.key !== "ContextMenu" &&
			!(event.shiftKey && event.key === "F10")
		) {
			return;
		}
		const box = event.currentTarget;
		event.preventDefault();
		menuOpenedByKeyboard.current = true;
		const rect = box.getBoundingClientRect();
		box.dispatchEvent(
			new MouseEvent("contextmenu", {
				bubbles: true,
				cancelable: true,
				clientX: rect.left,
				clientY: rect.bottom - 1,
			}),
		);
	};
	/*
	 * THE PRE-PRESS FOCUS (QA round 3, Q-1). Wired as the box's
	 * `onPointerDownCapture`, so it runs in the CAPTURE phase - before the
	 * press's own `mousedown` default moves focus to the row's button - and the
	 * control the reader was in (the composer) is what gets remembered, which
	 * is what the pointer close must give back: read at open time instead, the
	 * remembered button came back and a following keystroke began the row's
	 * type-to-filter. Every button, not only the right one: `Control`+click is
	 * a context-menu press on this platform and its left-button default moves
	 * focus the same way. Skipped while a menu is already open, so a press on
	 * another row cannot overwrite the value the closing menu is about to
	 * restore.
	 */
	const rememberFocusBeforePress = () => {
		if (openMenuRowIdRef.current !== null) return;
		menuFocusReturnRef.current =
			document.activeElement instanceof HTMLElement
				? document.activeElement
				: null;
	};
	const keyDown = (event: KeyboardEvent<HTMLElement>) => {
		/*
		 * AND WHILE A ROW'S MENU IS OPEN THE LIST STANDS DOWN (spec §6).
		 *
		 * Focus is inside the menu's portal, so the keys arriving through this
		 * handler are the menu's - its roving focus, its typeahead, Escape - and none
		 * of them is about the list. Without this guard the walk below would still
		 * answer: it reads a target that is not a row as index -1, and `ArrowDown`
		 * then steps to `rows[0]`, so an arrow pressed inside the open menu would
		 * move focus OUT of it to the list's first conversation; the type-to-filter
		 * branch is safe only by accident of its attribute check. `openMenuRowId` is
		 * exactly the claim this guard reads - and it cannot outlive the row that
		 * set it: `RowMenuOwner`, rendered with every menu-carrying row, clears it
		 * on that row's unmount (UX round 1, U1).
		 */
		if (openMenuRowId !== null) return;
		const target = event.target as HTMLElement;
		/*
		 * THE ROW ACTS' CHORD (§C4, U2). Both controls left the Tab ring below, and
		 * this is what keeps them operable without a pointer. `chatRowActControl`
		 * finds the control from the row's own box, which is where the acts live (a
		 * nested button is invalid HTML and unfocusable, so they are siblings of the
		 * row's button and never children of it).
		 *
		 * A `.click()` rather than the handler's own body: both controls carry the
		 * guards that make a repeat press safe - the pin's `dropRepeatPress` and the
		 * archive's `archivePressOutcome`, which read `event.detail === 0` as "this
		 * came from the keyboard and always acts on the focused row" - and a press the
		 * keyboard makes must take the same path as a press Enter makes on the control
		 * itself, guards included. Calling the handlers directly is how the two paths
		 * drift.
		 */
		const act = chatRowAct(event);
		if (act !== null) {
			const control = chatRowActControl(target, act);
			if (control !== null) {
				event.preventDefault();
				control.click();
			}
			return;
		}
		/*
		 * THE MOVE'S CHORD (issue #693), the block above's shape exactly: the same
		 * `movePinnedRow` the row menu's two Move items call, rather than a second spelling
		 * of the move here - so the keyboard takes one write path, with the store, the
		 * boundary answer and the caret correction on it, and the two surfaces cannot
		 * drift. `⌘⇧↑` / `⌘⇧↓` (`Ctrl+Shift+↑` / `Ctrl+Shift+↓`) are free across the app
		 * and are refused by nothing else here: the walk below reads a BARE arrow, and the
		 * region walk's arrows carry `alt` (`chat-pin-order.ts` names the chords it
		 * checked).
		 *
		 * A row that offers no move answers so, by the menu items' own predicate
		 * (`offersPinnedMove`) rather than by a search for a control - there is no control
		 * left on the row to find, because the two arrow buttons are deleted and this calls
		 * the write itself. THE PRESS IS CONSUMED ON EVERY ROW, and the comment here used to
		 * claim the opposite ("the press is then left alone rather than swallowed") while the
		 * `return` below skipped the bare-arrow walk and the search field's own branch:
		 * agent review round 1 (R4) measured the mismatch, and the consumption is the
		 * intended half - a modified arrow is this panel's chord namespace, and letting
		 * `⌘⇧↑` fall through to the walk would move the caret for a press the reader
		 * addressed to the pinned order.
		 *
		 * WHAT WAS WRONG WAS THE SILENCE, NOT THE CONSUMPTION (UX round 1, U4, measured): the
		 * region kept whatever it held, so a chord on an unpinned row read out a sentence
		 * about a DIFFERENT row from an earlier press - stale and untrue of the row under the
		 * caret. A row that is not pinned is now ANSWERED in the move's own voice, with the
		 * row's name (`pinMoveUntargetedNote`). A row that IS pinned and simply drawn without
		 * a move - the grouped arrangement - stays silent, which is the state QA round 1
		 * recorded for that arrangement and did not file.
		 */
		const move = chatPinMoveChord(event);
		if (move !== null) {
			const rowId = chatPinMoveRowId(target);
			if (rowId === null) return;
			if (offersPinnedMove(rowId)) {
				event.preventDefault();
				movePinnedRow(rowId, move, true);
			} else if (!pinnedCatalogueIds.includes(rowId)) {
				announcePinMove(pinMoveUntargetedNote(rowLabel(rowId)));
			}
			return;
		}
		/*
		 * SCOPED TO THE SEARCH FIELD BY REFERENCE, not by tag name (issue #663): the
		 * roster's own filter in the entity region is a SECOND input in this panel,
		 * and every rule under this branch - the ↓ that enters the chats list, the
		 * Escape that clears the LIST's query, the focus move to the first row -
		 * was written for the one field this handler knew. A tag-name test reads the
		 * roster field's keys as this field's, so Escape in the roster would clear a
		 * query it never wrote and its ↓ would jump the reader into the
		 * conversations. The roster field handles its own Escape and arrows and stops
		 * them at itself (see its `onKeyDown`).
		 */
		if (target === searchRef.current) {
			/*
			 * THE FIELD'S OWN ENTRY INTO THE LIST IS SCOPED TO THE CHATS REGION (UX round 2, U2), and the
			 * two presses below are the ones the finding names. `event.currentTarget` is the PANEL, so an
			 * unscoped query answers with the ENTITY region's first `[data-chat-row]` - measured, the
			 * `Agents` disclosure - and a reader who pressed ↓ to enter the list walked the group rows
			 * (Agents, then Teams, then Mark all N read) before reaching the first conversation. The list
			 * this field's own notice calls "the results" is the conversations, so the query asks for the
			 * region they are in: the same partition the archive's hand-off and the pile-clearing hand-off
			 * are written under, and the arrow walk's own ring stays the panel's document order, which is
			 * what makes the region the caret starts in decide the whole path.
			 */
			const firstRowInList = () =>
				event.currentTarget.querySelector<HTMLElement>(
					'[data-sidebar-region="chats"] [data-chat-row]',
				);
			/*
			 * ↓ ENTERS THE RESULTS, which is the command palette's own model applied
			 * to the one other list in this column (U15). Without it the field was a
			 * trap for a keyboard user: the list below it was reachable only by Tab,
			 * and the field's own notice said nothing about how to get there.
			 */
			if (event.key === "ArrowDown") {
				const first = firstRowInList();
				if (first) {
					event.preventDefault();
					first.focus();
					applyRowStop(first);
				}
				return;
			}
			if (event.key === "Escape") {
				setQuery("");
				setFilterOpen(false);
				/*
				 * THE CLEARED FIELD HANDS FOCUS TO THE LIST rather than blurring. Blurring
				 * parked `document.activeElement` on `<body>`, so the key that emptied the
				 * field also dropped the user's place - the next Tab started from the top of
				 * the document and the arrow walk below was unreachable without a pointer
				 * (U5's "focus lost to `body`", read on this control).
				 */
				const first = firstRowInList();
				if (first) {
					first.focus();
					applyRowStop(first);
				} else target.blur();
			}
			return;
		}
		/*
		 * TYPE-TO-FILTER. A printable key pressed while a row has focus opens the
		 * list's filter with that character in it - the field is not drawn at rest
		 * (design round 1, D1: it was the second search control), so typing is how
		 * a keyboard reader reaches it. A modified key is somebody's chord, not a
		 * character, and passes through untouched.
		 */
		if (
			event.key.length === 1 &&
			event.key !== " " &&
			!event.metaKey &&
			!event.ctrlKey &&
			!event.altKey &&
			target.hasAttribute("data-chat-row")
		) {
			event.preventDefault();
			setFilterOpen(true);
			setQuery((current) => current + event.key);
			window.requestAnimationFrame(() => searchRef.current?.focus());
			return;
		}
		// Arrow navigation was a one-way trip: nothing returned focus to the
		// search field, so a keyboard user who entered the list was stranded there.
		if (event.key === "Escape") {
			event.preventDefault();
			if (filterShown) searchRef.current?.focus();
			return;
		}
		/*
		 * THE PAIR'S UPWARD HALF (UX round 1's U9). The roster field's ArrowDown
		 * enters the first agent row; the way back was not symmetric: the field is
		 * not one of the walk's `[data-chat-row]` stops, so ArrowUp from that first
		 * row moved to the section's OWN heading - a stop the reader reaches FROM
		 * the field, not the other way round. When the FIRST entity row of a
		 * section carrying a roster field has focus, the arrow goes to that field;
		 * a section without a drawn field (the whole column below the cap) keeps
		 * the walk exactly as it was.
		 */
		if (event.key === "ArrowUp" && target.hasAttribute("data-entity-name")) {
			const entity = target.closest("[data-entity]");
			const section = entity?.closest("section");
			if (
				entity &&
				section &&
				section.querySelector("[data-entity]") === entity
			) {
				const field = section.querySelector<HTMLElement>(
					"[data-roster-filter]",
				);
				if (field) {
					event.preventDefault();
					field.focus();
					return;
				}
			}
		}
		/*
		 * AND THE WALK SKIPS WHAT CANNOT TAKE THE CARET (agent review round 2's R7,
		 * remediation). A `disabled` control cannot: `focus()` on it is a no-op, so the
		 * step landed on nothing and the walk dead-stopped at the boundary, and
		 * `applyRowStop` recorded a stop the reader could not see. The app measured
		 * exactly this once already (`integration-focus.ts`'s `canTakeFocus`: "`focus()`
		 * did nothing"), and the predicate is the whole of the rule - a candidate the
		 * caret cannot reach is not a stop. The two draft acts no longer render
		 * `disabled` at all (they carry `aria-disabled` + a refused press, below), so
		 * this filter protects the class rather than only today's controls.
		 */
		const rows = [
			...event.currentTarget.querySelectorAll<HTMLElement>("[data-chat-row]"),
		].filter((row) => !(row as { disabled?: boolean }).disabled);
		const index = rows.indexOf(target);
		const next =
			event.key === "ArrowDown"
				? Math.min(rows.length - 1, index + 1)
				: event.key === "ArrowUp"
					? Math.max(0, index - 1)
					: event.key === "Home"
						? 0
						: event.key === "End"
							? rows.length - 1
							: -1;
		if (next >= 0) {
			event.preventDefault();
			const moved = rows[next];
			moved?.focus();
			/*
			 * The stop moves WITH the walk rather than on the next commit. Focus can
			 * already sit on a `tabIndex` -1 element and stay there, but the reader's next
			 * `Shift+Tab` asks the browser for the preceding stop — and if the walk left the
			 * ring where it started, that press returns to the row they left instead of the
			 * one they are on.
			 */
			if (moved !== undefined) applyRowStop(moved);
			return;
		}
		const group = target.closest("[data-entity]");
		const disclosure =
			group?.querySelector<HTMLButtonElement>("[data-disclosure]");
		if (event.key === "ArrowRight" && disclosure) {
			event.preventDefault();
			if (disclosure.getAttribute("aria-expanded") === "false")
				disclosure.click();
			else group?.querySelector<HTMLElement>("[data-child]")?.focus();
		}
		if (event.key === "ArrowLeft" && disclosure) {
			event.preventDefault();
			if (target.hasAttribute("data-child"))
				group?.querySelector<HTMLElement>("[data-entity-name]")?.focus();
			else if (disclosure.getAttribute("aria-expanded") === "true")
				disclosure.click();
		}
	};
	/*
	 * The two scrollers this panel owns keep the focused row in view across a
	 * re-file - `holdFocusedRow` carries the argument and the two rejected shapes.
	 *
	 * BOTH containers, because both draw rows that re-file on the same order-key
	 * event: the entity region's entities are disclosure rows whose CHILDREN are
	 * session rows (`children()` over the catalogue's own array), so a nested row
	 * changes slot on a completion exactly as a list row does (round 1, R1).
	 *
	 * A plain `useLayoutEffect` with no dependency list, because the signal is a
	 * SLOT CHANGE rather than any one value, and the order the rows are in is not
	 * something this component re-renders on: React re-uses each keyed node, so the
	 * DOM's own order is the only place the move is visible. Running after every
	 * commit is what makes the correction land in the same frame as the re-file -
	 * the same reason `use-scroll-paging.ts` corrects its anchor in a layout effect
	 * rather than a passive one, where a correction arriving one frame late is
	 * still a jump.
	 *
	 * The record this hands over is also the gate: each run states whether the
	 * focused row is inside its panel, and the correction only fires for a row that
	 * was inside and left as this commit landed. A commit is not the only thing that
	 * can take the row out of the panel, so the containers refresh the record on
	 * their own scroll as well - without that the gate would read a wheel-scrolled
	 * row as still inside and follow it (U5). The record is three-valued rather
	 * than a boolean so a row that was PARTLY on screen when the change landed is
	 * still followed; `sidebar-focus-hold.ts` carries both arguments.
	 *
	 * AND IT CARRIES THE BOX THE ROW WAS MEASURED IN (QA round 4's Q-9, design round
	 * 7's D24), which is the one input this effect could not supply on its own: the
	 * band's arrival takes its height off the list's own box while every row keeps
	 * its offset (the yield below), so a cursor row near the clip's lower edge reads
	 * as having left the panel when nothing moved it - and the correction would
	 * write `scrollTop` to fetch it back, moving a reader who is mid-list. The
	 * record is REFRESHED instead when the container's clip box is not the one it
	 * was measured against, which is done inside `holdFocusedRow` before any write
	 * rather than by a second effect here: a later effect runs AFTER this one, so
	 * its refresh would have nothing left to prevent (the order design round 7's
	 * D24 names).
	 */
	const entityPanelRef = useRef<HTMLDivElement | null>(null);
	const entitySlotRef = useRef<FocusedSlot>({
		node: null,
		index: -1,
		visibility: "outside",
		clipHeight: 0,
	});
	const listSlotRef = useRef<FocusedSlot>({
		node: null,
		index: -1,
		visibility: "outside",
		clipHeight: 0,
	});
	/*
	 * One node, two refs: the merged scroller answers to BOTH names the split
	 * left behind (see the assembly's comment). Stable identity so React does
	 * not detach and reattach it every render.
	 */
	const bindPanelRef = useCallback((node: HTMLDivElement | null) => {
		entityPanelRef.current = node;
		listPanelRef.current = node;
	}, []);

	useLayoutEffect(() => {
		holdFocusedRow(entityPanelRef.current, entitySlotRef);
		holdFocusedRow(listPanelRef.current, listSlotRef);
	});

	/*
	 * THE SECTION FOOT'S FOCUS, DELIVERED AFTER THE PRESS'S COMMIT (UX round 1's
	 * U3, design round 1's D3). The record `cappedRows` writes names the section and
	 * the pre-press draw count; this reads the FIRST ROW THE RAISE ADDED and focuses
	 * its own control, with the section's heading as the fallback. `<body>` is never
	 * a target: when neither can be found the focus is left where it was, which is
	 * the rule the group's own tail press states one level up.
	 *
	 * WHY `[data-entity]` AND NOT THE DRAW INDEX INTO `[data-chat-row]`: an expanded
	 * entity DRAWS ITS OWN SESSION ROWS between the agent rows, and those controls
	 * carry `data-chat-row` too - so a stop-index into that list would count them and
	 * land on a session inside the agent above rather than on the first agent the
	 * press added. `[data-entity]` is exactly the list `cappedRows` slices (each
	 * entity row is the wrapper `entity(...)` renders), so `drawn[at]` is that row by
	 * construction, and `closest("section")` is the walk the roster's own keyboard
	 * code already uses to find the section a row belongs to.
	 *
	 * A PLAIN `useEffect`, matching the group's tail press rather than the layout
	 * effects above: the rows are already in the DOM by then, and the press's own
	 * `setSectionCaps` is what schedules this, so there is no frame in which the
	 * reader could act on a stale focus.
	 */
	useEffect(() => {
		const pending = sectionFootFocusRef.current;
		if (pending === null) return;
		sectionFootFocusRef.current = null;
		const panel = entityPanelRef.current;
		if (panel === null) return;
		const heading = panel.querySelector<HTMLElement>(
			`[data-chat-section="${CSS.escape(pending.key)}"]`,
		);
		const section = heading?.closest("section") ?? null;
		const drawn =
			section === null
				? []
				: [...section.querySelectorAll<HTMLElement>("[data-entity]")];
		/*
		 * THE RAISE MUST HAVE MOVED THE DRAW for a row to be "newly revealed": the foot
		 * only exists while the cap bounds the rows, so a press always adds one - but a
		 * cap that did not move (a reset racing this press) would make `drawn[at]` a row
		 * the press did not reveal, which is a wrong target rather than a missing one.
		 * Reading the live cap here is also what makes this effect's dependency real
		 * rather than a timer.
		 */
		const raised = sectionCaps[pending.key] ?? SIDEBAR_SECTION_ROWS;
		const revealed = raised > pending.at ? (drawn[pending.at] ?? null) : null;
		const target =
			revealed?.querySelector<HTMLElement>("[data-chat-row]") ??
			revealed ??
			heading ??
			null;
		target?.focus();
	}, [sectionCaps]);

	/*
	 * ONE SCROLLER (operator report, 2026-09-26): the two-region split - its
	 * persisted height, the drag, the collapse and the region swap - is removed.
	 * This component no longer resolves or measures a split; the assembly below
	 * renders one flow, and `showList` (the catalogue gate's answer) is the one
	 * flag that survives, gating the chats LIST's content exactly as before.
	 */
	const navRef = useRef<HTMLElement | null>(null);
	const pinRef = useRef<HTMLParagraphElement | null>(null);
	/*
	 * `showList` is the catalogue gate's own answer, and the chats list's
	 * content is still gated on it: a withdrawn gate keeps the last-known
	 * ENTITY rows mounted and renders no list content at all.
	 */
	const listShown = showList;

	const entityRegion = (
		/*
		 * The entity region, and the SECOND container that needs the rule below.
		 * An entity is a disclosure row whose CHILDREN are session rows drawn from
		 * the same catalogue array the list draws (`children()`), so a nested row's
		 * slot is the same backend order key: a completion re-files it on the same
		 * event, inside a container that scrolls. The region was "deliberately not
		 * touched" in the first pass on the premise that nothing in it re-files,
		 * and that premise was false (round 1, R1) - the measurement is in
		 * `scripts/sidebar-resort-geometry.mjs`, which walks this container from a
		 * NESTED row rather than from the list's.
		 *
		 * The trade is not the list's, and it is stated rather than implied: this is
		 * the one region where content genuinely GROWS above the reader - a
		 * catalogue arriving, or a query expanding every entity at once - and
		 * `overflow-anchor: none` gives up Chrome's compensation for that case to
		 * buy the re-file case. The growth is user-initiated or at load (the search
		 * box re-renders the region it filters), while the re-file is involuntary
		 * and arrives on every completion, which is the exchange this side of the
		 * declaration takes.
		 */
		<div
			/*
			 * KEYED, both regions, so the swap MOVES these nodes rather than
			 * re-filling them. Unkeyed, React reconciles the two positions in place:
			 * the element that was the entity region becomes the chats region and
			 * inherits its content, so the scroller the user had scrolled loses its
			 * position (measured: 30 -> 0 and 40 -> 0 on the two runs, UX round 1,
			 * U2). A key makes the node travel with its region, and its scrollTop
			 * travels with it.
			 */
			key="entities"
			id={ENTITY_REGION_ID}
			data-sidebar-region="entities"
			/*
			 * The outer scroller in the assembly carries the containing block
			 * (`relative`) and the clip for every row in BOTH regions now: with a
			 * pane `static`, a long chats list made the nav report its own
			 * overflow once (measured 890/576), and the merged scroller is the
			 * one pane that can contain it.
			 */
			className={cn("relative space-y-4")}
		>
			{capabilities.isLoading && (
				<p aria-live="polite" className="text-meta text-ink-dim">
					Connecting to chats…
				</p>
			)}
			{/*
			 * THE LIST-PANE PARAGRAPH STANDS DOWN WHILE THE SERVER IS UNREACHABLE (§F2).
			 *
			 * A lost server used to be stated twice on one screen, the way it was on the
			 * foot line below before that fix: the pane's status strip ("Can't reach the
			 * Local Operator server. Sending will wait." + Retry) and this list-pane
			 * paragraph with a Retry of its own - one fact, two root causes, two Retries,
			 * which is the contradiction §F2 exists to end. §F2 asks for the sidebar's
			 * list-pane paragraph to be deleted; what is KEPT for the other case is a
			 * caption rather than a second voice, because a REACHABLE server that failed
			 * or withdrew this list's own read is a fact about the LIST, which the strip
			 * does not state, and the refetch is its only remedy. The gate is the SAME
			 * `stripSpeaksConnection` the other two sites and the foot line read,
			 * deliberately, so the three cannot drift about when the strip owns the
			 * screen - and, since R11, it carries the strip's own PRESENCE beside the
			 * copy condition, so a route the strip is not mounted on keeps this voice.
			 *
			 * AND THE BANNER'S OWN CONDITION BESIDE IT (QA round 1's Q-1): the strip is
			 * silent for the four causes the banner carries, and in those states this
			 * paragraph was the second statement of one incident - measured in the
			 * successor walk, where a replacement that refuses this app's credential
			 * rendered this sentence under the banner's successor sentence.
			 *
			 * NO `role="alert"` HERE EITHER: the strip owns the one live region for
			 * connection state (branding § 9's one register for the status slot), and a
			 * second live region about one fact is the defect this exists to remove. The
			 * word is the foot's own "Retry refresh" - the strip's one "Retry" is
			 * re-negotiation, and a screen cannot offer two verbs for one re-read.
			 */}
			{capabilities.error &&
				!stripSpeaksConnection &&
				!coveredByCompatibilityBanner && (
					<div className="space-y-1 text-meta text-ink-muted">
						<p>
							{capabilities.error.message}
							{stale ? " Showing the last chats loaded." : ""}
						</p>
						<button
							type="button"
							className="underline"
							onClick={() => void capabilities.refetch()}
						>
							Retry refresh
						</button>
					</div>
				)}
			{/*
			    The sentence is the gate's, not this file's (see the module): which half of
			    the gate closed, whether the store's own read has already failed (the D9 rule
			    this file applies to the feed line below - two statements about one backend is
			    one too many), and whether there are last-known rows to speak for are three
			    inputs a test can drive, and a JSX condition is not. Retry is re-negotiation
			    rather than recovery: the poll in `useDesktopCapabilities` re-asks on its own
			    cadence, and this is the same control the error branch above offers.

			    THE SAME STAND-DOWN as the paragraph above, and for the same reason: a
			    withdrawn gate is read off the SAME stale answer a just-killed server
			    leaves behind, so without this gate the block would speak over the strip
			    that has taken the screen's one connection voice. `stripSpeaksConnection`
			    carries R11's presence term too, so the stand-down holds only where that
			    strip is genuinely on screen.
			 */}
			{notice && !stripSpeaksConnection && (
				<div className="space-y-1 text-meta text-ink-muted">
					<p>{notice}</p>
					<button
						type="button"
						className="underline"
						onClick={() => void capabilities.refetch()}
					>
						Retry refresh
					</button>
				</div>
			)}
			{/*
			    The state is carried by the sentence, never by a treatment on the rows
			    (branding § 6 and § 9: disabled changes colour, and opacity is not a state
			    signal at all - it composites `ink` down to ~6:1 on this palette and below the 4.5:1 floor on four of the twelve palettes it was
			    measured on, which `check-themes` cannot see
			    because it does not evaluate alpha). These rows are also the only way to
			    reach a conversation, so dimming them says "unavailable" about the one
			    thing that still works. Design round 1, D1. */}
			{/*
			 * NO `space-y-4` ON THE WRAPPER ANY MORE, and it is not a tidy-up: the
			 * rhythm between two entity sections is CONDITIONAL on whether the one above
			 * it draws rows (`entitySectionGap` carries the measurement and the reason),
			 * and a parent `space-y-*` would set a `margin-top` on the
			 * same element the child's class does - two declarations of one property,
			 * settled by stylesheet order rather than by the decision.
			 */}
			{showList && (
				<div className="pb-2">
					{/*
					 * THE ENTITY ROWS ARE THE POPOVER'S SWITCHES TOO.
					 *
					 * `isSectionShown` is the ONE spelling of "this section is drawn",
					 * and it is the same call the chat sections' own gate makes a few
					 * hundred lines below (`drawnSections`). Before this the two entity
					 * rows were drawn unconditionally, so unchecking `Agents` in the view
					 * popover wrote `view.hidden` - the panel's tick went out and its own
					 * "1 section hidden" sentence appeared - while the region below kept
					 * drawing the row: the operator's 2026-09-27 report, and the strongest
					 * form of it, because both halves of one frame disagreed.
					 *
					 * IT IS NOT EXTENDED TO THE DISCLOSURE. The row's own chevron stays
					 * (`expanded`, `localStorage['chat-sidebar-disclosures']`) and keeps
					 * governing the row's CHILDREN: "the section is drawn" and "the
					 * section's children are drawn" are two axes, and the popover's switch
					 * speaks only to the first. Reading the disclosure here instead would
					 * leave the panel's tick, its "hidden" sentence and the region's
					 * presence governed by a per-window record the store cannot see.
					 */}
					{isSectionShown(view, "agents") && (
						<section>
							{heading(
								"agents",
								"Agents",
								true,
								undefined,
								Bot,
								undefined,
								undefined,
								hubControls("agent"),
							)}
							{(query || isOpen("agents", true)) && (
								<>
									{profiles.isLoading && (
										<p aria-live="polite" className="text-meta text-ink-dim">
											Loading agents…
										</p>
									)}
									{hubLines("agent")}
									{rosterFilterShown && (
										/*
										 * THE ROSTER'S OWN FILTER (issue #663), and the gate is the whole
										 * argument for it existing: at `SIDEBAR_SECTION_ROWS` agents or
										 * fewer the entire roster is on screen and a second field next
										 * to the list's would be furniture; past the cap the section's
										 * own `Show N more` stops being a way to FIND one agent, which
										 * is the friction this field removes. So the chrome appears
										 * exactly when the section is cap-bound OR a filter is applied
										 * (`rosterFilterShown` carries the lifecycle rule and the bug it
										 * closes): a filter always keeps its field, so the pair cannot
										 * come apart.
										 *
										 * AND THE FIELD ALSO RIDES A LIST QUERY (UX round 1's U2,
										 * design re-check round 3). A list query force-opens the rows
										 * (`query || isOpen`) and this field is that body's own control,
										 * so it draws while the body does - reading the disclosure ALONE
										 * was U2: the heading press under a query is the panel's
										 * documented no-op on the rows and the chevron, yet it took
										 * `Filter agents` off the screen and stepped everything below it
										 * up by the field's own height. The query still narrows agents by
										 * name through the backend search; this field narrows the ROSTER
										 * in place on top of it, so the reader keeps the control that
										 * clears their own filter. THE SECOND CLAUSE IS UNTOUCHED: the
										 * field still needs a cap-bound roster or an applied filter, so a
										 * query alone draws nothing over a short roster.
										 *
										 * IT IS NOT THE LIST'S FIELD one level up, and that separation
										 * is the point: the list's query goes through the backend and
										 * narrows the whole column (agents and chats together), while
										 * this narrows the ROSTER in place - typing an agent's name
										 * here must not empty the conversations beside it. So it is
										 * local state, its own field, drawn the list field's way (same
										 * box, same step, the clear control returning the caret through
										 * `clearSearch`).
										 *
										 * THE FIELD KEEPS ITS OWN KEYS. The panel's key handler treats
										 * an Escape in any input as the search field's - clearing the
										 * LIST's query and walking the caret to the first chats row -
										 * and walks Home/End/arrows to the list's ends, so every key
										 * this field means something by is stopped HERE: Escape clears
										 * the filter and keeps the caret, ArrowDown enters the
										 * matching rows, and ArrowUp/Home/End keep their default
										 * (the panel's walk would otherwise land the caret on the
										 * list's first or last row).
										 *
										 * `mt-1` ABOVE IT is design round 1's D5: the field sat
										 * flush against the heading's own bottom edge, reading
										 * closer to `Agents` than to the rows it filters.
										 */
										<div className="relative mt-1 mb-2">
											<input
												ref={rosterFilterRef}
												data-roster-filter
												aria-label="Filter agents"
												placeholder="Filter agents"
												className="h-8 w-full rounded-md bg-row-hover pr-9 pl-2 text-body-sm"
												value={rosterFilter}
												onChange={(event) =>
													setRosterFilter(event.target.value)
												}
												onKeyDown={(event) => {
													if (event.key === "Escape") {
														event.preventDefault();
														event.stopPropagation();
														if (rosterFilter)
															clearSearch(
																rosterFilterRef.current,
																setRosterFilter,
															);
														return;
													}
													if (event.key === "ArrowDown") {
														event.preventDefault();
														event.stopPropagation();
														// The first DRAWN agent row - the pin hook is what
														// identifies an agent's row in the entity region.
														navRef.current
															?.querySelector("[data-agent-pin]")
															?.closest("[data-entity]")
															?.querySelector<HTMLElement>("[data-entity-name]")
															?.focus();
														return;
													}
													if (
														event.key === "ArrowUp" ||
														event.key === "Home" ||
														event.key === "End"
													) {
														// The caret keeps its default; only the panel's walk
														// is stopped (see the block comment above).
														event.stopPropagation();
													}
												}}
											/>
											{rosterFilter && (
												<Button
													variant="ghost"
													size="icon-sm"
													className="absolute top-1/2 right-1 -translate-y-1/2 focus-visible:outline-offset-[-2px]!"
													onClick={() =>
														clearSearch(
															rosterFilterRef.current,
															setRosterFilter,
														)
													}
													aria-label="Clear agent filter"
												>
													<X aria-hidden="true" />
												</Button>
											)}
										</div>
									)}
									{/*
									    A user with no agents of their own gets the shortcut as the
									    next step rather than as a quiet line: on a fresh install this
									    section previously showed six rows the user had not installed
									    and no way to tell them from their own. `profiles.data` being
									    empty is the degenerate case of the same state — nothing to
									    list, and nothing to install either, so only the create row
									    remains.
									*/}
									{/*
									 * ONE element across both states, and the batch's own control is the
									 * same child at the same index in each, because the two states differ
									 * in a way the batch itself causes.
									 *
									 * The completion summary is owned by `InstallBuiltinAgents`, and the
									 * batch's last act is to invalidate `profiles`: the six installs land
									 * as the user's own agents, `ownAgents` stops being empty, and this
									 * block used to swap a `div` for a fragment in place. React unmounts
									 * a subtree whose element type changes, so the summary was destroyed
									 * ~89ms after it was painted: on the built app against the real
									 * backend the section went straight from the shortcut to the six-row
									 * list, and `"6 installed. Done"` was caught in the DOM once by a
									 * MutationObserver and never seen again. The collision arm's "5
									 * installed, 1 skipped. Skipped 1: you already have an agent called
									 * `coder`." is the sentence a user actually needs, and it was
									 * unreadable by construction (QA round 1, Q1).
									 *
									 * So the state lives somewhere that does not move: the outer element
									 * is the empty state's padded box in one case and `display: contents`
									 * in the other, which contributes no box at all, so the rows and the
									 * batch's control lay out exactly as they did as bare children; the
									 * variable content sits in its own `contents` child so the batch is
									 * at index 1 either way. Same treatment as the live region in
									 * `install-builtin-agents.tsx`, for the same reason (U11): what the
									 * user has to be able to read cannot be the thing that gets
									 * replaced. DO NOT split this back into one call site per branch.
									 *
									 * AND A DISMISSED OFFER RENDERS NO BOX AT ALL. The reader's own
									 * statement that they do not want this offer takes the whole empty
									 * block with it, and the section is down to its heading and the
									 * create row below. That state cannot collide with the batch this
									 * element exists to keep alive: the dismiss control is absent
									 * whenever the batch owns the section (its `onBusyChange` report),
									 * so by the time a dismissal can be pressed there is no progress
									 * and no summary on screen for it to destroy — and the swap this
									 * comment is about is never raced by a dismissal.
									 */}
									{!emptyBlockDismissed && (
										<div
											className={cn(
												agentsEmpty
													? "flex flex-col gap-2 px-3 py-2"
													: "contents",
											)}
											data-testid={
												agentsEmpty ? "agents-sidebar-empty" : undefined
											}
										>
											<div className="contents">
												{agentsEmpty ? (
													<>
														{/*
														 * The dismiss control rides the "No agents yet" line's row, at its
														 * end: that line is what the offer is FOR — the empty section — and
														 * the row is the block's first line wherever the block starts.
														 * `items-center` sits the glyph's centre on the paragraph's own
														 * centre rather than a line-height below it.
														 *
														 * IT EXISTS ONLY WHILE THERE IS AN OFFER TO DISMISS AND THE BATCH IS
														 * SHOWING NOTHING: `builtinOfferOnScreen` requires the empty state
														 * and a non-empty, undismissed catalogue, and `agentsOfferBusy` is
														 * the batch's own report — while it is true the control does not
														 * exist, so a press can never take the progress or the summary off
														 * screen (QA round 1's Q1 and UX round 2's U11 are the work this
														 * protects). The control takes the sidebar's own icon-sm ghost step
														 * (28px square, 14px glyph, the accessible name carrying the
														 * sentence a bare glyph cannot), the same step the chats search's
														 * clear control below takes.
														 */}
														<div className="flex items-center justify-between gap-2">
															<p className="text-body-sm text-ink">
																No agents yet
															</p>
															{builtinOfferOnScreen && !agentsOfferBusy && (
																<Button
																	variant="ghost"
																	size="icon-sm"
																	data-testid="agents-offer-dismiss"
																	aria-label="Dismiss built-in agents suggestion"
																	onClick={() => {
																		offerDismissedByPressRef.current = true;
																		dismissBuiltinOffer(offerSignature);
																	}}
																>
																	<X aria-hidden="true" />
																</Button>
															)}
														</div>
														{/*
														 * The offer is CONDITIONAL on there being something to offer, and it
														 * names what that is.
														 *
														 * It used to render unconditionally: on a backend with no packaged
														 * profiles the section still said "Built-in agents are ready to
														 * install" while offering nothing that installs one — the same
														 * paragraph, pixel-identical, in a state whose whole point is that
														 * there is nothing to install (design round 1, D3). And what it
														 * promised was a list of activities rather than the roles on offer,
														 * including a "research" role that is not among the packaged
														 * profiles, with no count at all until the batch had started (UX
														 * round 1, U6). Derived from the rows the backend sent, because
														 * the catalogue is the authority on what can be installed and a
														 * hand-written list can disagree with it.
														 */}
														{availableBuiltins.length > 0 && (
															<p className="text-meta text-ink-muted">
																{builtinOfferSentence(availableBuiltins)}
															</p>
														)}
													</>
												) : rosterFilterShown && rosterFilter.trim() ? (
													/*
													 * WHILE THE ROSTER FILTER IS APPLIED THE CAP IS BYPASSED, the
													 * promise the list's own search makes one level up
													 * (`pageRows` under `searching`): a filter that returned
													 * eight of eleven matches would make the reader page the
													 * column to find the one they typed. The `Show N more`
													 * foot goes WITH the cap, so nothing here can offer a page
													 * the section is not on. An empty answer says so rather
													 * than falling back to the full roster, which would read
													 * as "the filter did nothing".
													 *
													 * THE BRANCH READS `rosterFilterShown` (the field's own gate),
													 * not `rosterFilter` alone: it is the one spelling of "the
													 * filter applies", so a stored filter can never narrow a
													 * section whose field is not on screen (design D2 / B3 / U3).
													 *
													 * AND THE SENTENCE COUNTS `drawnFilteredAgents` (UX round 1's
													 * U1), not the matches: a LIST query can drop every admitted
													 * agent's row (name misses, no rows survive), and testing the
													 * matches alone left the section a blank gap under a field
													 * that said nothing. The two sets this file carries are the
													 * matches (`filteredAgents`) and the rows that draw
													 * (`drawnFilteredAgents`); the sentence is about the
													 * second, which is what the reader sees.
													 */
													drawnFilteredAgents.length > 0 ? (
														drawnFilteredAgents.map((row) =>
															entity("agent", row.name, row.id),
														)
													) : (
														<p className="text-meta text-ink-muted">
															No agents match
														</p>
													)
												) : (
													cappedRows(
														"agents",
														agentRows.map((row) =>
															entity("agent", row.name, row.id),
														),
													)
												)}
											</div>
											{/* Renders nothing once every built-in is installed. */}
											<InstallBuiltinAgents
												builtins={availableBuiltins}
												presentation={agentsEmpty ? "primary" : "row"}
												onBusyChange={setAgentsOfferBusy}
											/>
										</div>
									)}
									<button
										ref={createAgentRowRef}
										type="button"
										className={cn(rowStyle, "w-full text-ink-muted")}
										onClick={() => navigate("/agents?create=agent")}
									>
										<Plus className="size-4" />
										Create agent
									</button>
								</>
							)}
						</section>
					)}
					{/*
					 * THE GAP BETWEEN THE TWO SECTIONS IS CONDITIONAL, and it is not a smaller
					 * constant. Measured at 360px: the 16px between these sections is SHARED
					 * - an open `Agents` above needs a section rhythm's 16px between the two,
					 * and a shorter constant would tighten that case unasked - while a
					 * collapsed section hands the heading below it the list's own 8px step,
					 * because a section that draws no rows has nothing for a section rhythm to
					 * separate. Operator report, 2026-09-27, asked twice: "shrink the gap
					 * between agents and teams headers when agents is collapsed, there's an
					 * extra gap wasting space there."
					 *
					 * `mt-4` and `mt-2` are the design's own two steps - the 16px section tier
					 * and the 8px a label takes when the section above draws no rows to
					 * separate - and they live in `entitySectionGap`: this is the only site
					 * that takes the conditional, and a query force-opens the section, which
					 * is the same condition the rows' own gate reads.
					 *
					 * AND THE CONDITION'S OTHER HALF IS THE VIEW GATE ITSELF (design round
					 * 1, D1): `Agents` switched off in the popover leaves NO section above
					 * Teams, and without `isSectionShown(view, "agents")` this margin still
					 * took the 16px tier for a section that is not drawn - a hidden first
					 * block keeping the between-sections lead (first ink y=72 against the
					 * first block's y=57, the same gap in all twelve themes). A hidden first
					 * section hands its slot over here the way a hidden chats section does in
					 * the list below: nothing drawn above, nothing to separate.
					 */}
					{isSectionShown(view, "teams") && (
						<section
							className={entitySectionGap(
								isSectionShown(view, "agents") &&
									(Boolean(query) || isOpen("agents", true)),
							)}
						>
							{heading(
								"teams",
								"Teams",
								true,
								undefined,
								Users,
								undefined,
								undefined,
								hubControls("team"),
							)}
							{(query || isOpen("teams", true)) && (
								<>
									{teams.isLoading && (
										<p aria-live="polite" className="text-meta text-ink-dim">
											Loading teams…
										</p>
									)}
									{hubLines("team")}
									{teams.data &&
										cappedRows(
											"teams",
											teams.data.map((team) => entity("team", team.name)),
										)}
									<button
										type="button"
										className={cn(rowStyle, "w-full text-ink-muted")}
										onClick={() => navigate("/agents?create=team")}
									>
										<Plus className="size-4" />
										Create team
									</button>
								</>
							)}
						</section>
					)}
				</div>
			)}
		</div>
	);

	/*
	 * The pin failure, in the panel's own register rather than a toast.
	 * One sentence and one action, the shape the withdrawn-gate notice above
	 * already uses - and NO `role="alert"`, so it cannot compete with the
	 * catalogue alert below about a different failure. What announces it is
	 * `aria-pressed` flipping back on the control the user just pressed; this
	 * sentence is the durable half. `warning` and not `danger`: the list is
	 * intact and only this row's pin did not move.
	 */

	const pinFailureLine = pinFailure ? (
		/*
		 * The pin failure, and the reason it carries a ref: it is a flex child of the
		 * split container like the boundary, so its height comes out of the space the
		 * two regions share and has to be measured rather than assumed (review round
		 * 1, m-1).
		 */
		<p ref={pinRef} className="pb-2 text-meta text-warning">
			Could not {pinFailure.pinned ? "pin" : "unpin"} “{pinFailure.title}”.
			{pinFailure.detail ? ` ${pinFailure.detail}` : ""}{" "}
			<button
				type="button"
				className="underline"
				onClick={() =>
					void setSessionPin(pinFailure.sessionId, pinFailure.pinned)
				}
			>
				Retry
			</button>
		</p>
	) : null;

	const listRegion = (
		/*
		 * THE LIST'S OWN REGION MARKER LIVES HERE (round 1, R3). It used to be on the
		 * merged scroller, which made every rig scoping `[data-sidebar-region="chats"]`
		 * read the whole sidebar body - the entity sections included - rather than the
		 * list. The scroller carries `scroller` now and this node carries `chats`, so a
		 * rig's scope names the list and only the list; the scroller answers for the
		 * scroll, the clip and the gutter.
		 *
		 *  The global partition is NAVIGATION, not a peer of the entity lists.
		 * Sharing one scroll flow pushed Previous below the fold at 16+ sessions
		 * and its disclosure became easy to miss, so it is pinned below the
		 * scrolling entity region and owns its own scroll area.
		 *
		 * `overflow-anchor: none` IS LOAD-BEARING ON THIS CONTAINER, and it is a
		 * property of the ROWS this panel draws rather than a style choice. A
		 * session's slot is the backend's order key, so a completion re-files the
		 * row - within the same section when it was already Active - and the feed
		 * now invalidates the client's list read on that change rather than on a
		 * section move, so the re-file happens on every completion instead of on
		 * the next poll.
		 *
		 * Chrome's scroll anchoring (`overflow-anchor: auto`, the initial value)
		 * picks the element that moved as the anchor and pays for its move by
		 * moving THIS container's `scrollTop` by exactly the row's travel -
		 * measured on the overflowing story at -96 px for a 3-row travel
		 * (`scripts/sidebar-resort-geometry.mjs`; before/after frames on the pull
		 * request). The reader is not following the row: they are somewhere else in
		 * the list, and the whole viewport slides under them by the travel, which is
		 * the jitter this change is about. Refusing to anchor holds `scrollTop`
		 * through the re-file and leaves the one-row shift the re-file itself
		 * produces - the rows redrawn in their new order - which is the row moving
		 * rather than the reader being moved.
		 *
		 * The sibling rule is the transcript's, and the two are opposite on
		 * purpose: `canonical-transcript.tsx` sets `overflow-anchor: auto` because
		 * ITS content grows under a reader pinned to the end, where following the
		 * content is the feature.
		 *
		 * THIS CONTAINER IS THE RE-ORDER CASE, AND IT IS NOT THE ONLY ONE - the
		 * entity region above carries the same declaration for the same reason,
		 * and the two are a pair. What it gives up is stated rather than denied:
		 * a row inserted ABOVE a reader who is scrolled down, or a list read that
		 * adds rows above the viewport, is no longer compensated for, so the
		 * reader's content shifts by the insertion - the trade this declaration
		 * accepts for holding the position through a re-file, which arrives on
		 * every completion rather than on an edit the reader made. (The claim in
		 * the first pass ran the other way - "nothing here grows; the list only
		 * re-orders" - and it was both false for the entity region and false
		 * here: round 1, N2.)
		 *
		 * One cost is not paid by the reader who is nowhere near the row: the
		 * keyboard cursor is an ELEMENT, so a focused row that re-files out of the
		 * panel would leave the cursor off screen. `holdFocusedRow`
		 * (`sidebar-focus-hold.ts`) is the other half of this rule - the container
		 * follows the row the CURSOR is on, by the minimum, which is the case the
		 * transcript's rule is about. It follows it only when the RE-FILE is what
		 * took it out of the panel - a reader who scrolled their cursor away keeps
		 * the position they chose, and so does the reader whose cursor row was not
		 * on screen at all when the change landed.
		 */
		<div
			key="chats"
			data-sidebar-region="chats"
			/*
			 * The pointer's path, which is the half a coordinate test cannot see: a
			 * reader who moves away from the point they pressed and comes back has made
			 * a NEW gesture, so the record expires on that movement. Leaving the list
			 * expires it too - the reflex this protects never leaves the region between
			 * its two clicks (UX round 3, U9; QA round 3, Qr3-1).
			 *
			 * BOTH RECORDS' EXPIRY IS REGION-SCOPED, and that is a known gap rather
			 * than an oversight (agent review round 4, R4-5). `sessionRow` renders the
			 * list's rows AND the entity region's nested rows, so a press on a NESTED
			 * row is armed in the entities region and expired only here, in the chats
			 * region. #408 split the regions and main's own `lastPinPress` has exactly
			 * this shape, so this file inherits it rather than introducing it; the
			 * gesture is bounded anyway (the record expires on a real move and on the
			 * next press), and the fix belongs with the pin's record, in one change,
			 * rather than as a second rule here.
			 */
			onPointerMove={(event) => {
				const from = lastPinPress.current;
				if (
					from !== null &&
					Math.hypot(event.clientX - from.x, event.clientY - from.y) >
						PIN_PRESS_SLOP_PX
				) {
					lastPinPress.current = null;
				}
				/*
				 * AND THE ARCHIVE'S OWN RECORD, on the same movement: both guards expire on
				 * the same path because both exist for the same reflex - a press that
				 * re-lands on a DIFFERENT row after the list moved under it must not act
				 * (`chat-archive-press.ts` carries the gesture it protects).
				 */
				if (
					archivePressExpired(lastArchivePress.current, {
						x: event.clientX,
						y: event.clientY,
					})
				) {
					lastArchivePress.current = null;
				}
			}}
			onPointerLeave={() => {
				lastPinPress.current = null;
				lastArchivePress.current = null;
			}}
			className={cn("relative space-y-4")}
		>
			{/*
			 * ONE LIST, SECTIONED BY WHAT A READER ASKS OF IT (§C1; design round 1, D1).
			 *
			 * It was four list concepts: an `All chats` toggle that flattened the list, a
			 * `New chat` row wedged under it, then `Active chats` and `Previous chats` -
			 * the catalogue's own `active` partition, which in the AFTER frames held ten
			 * rows with completion ticks and drew the one chat that was actually RUNNING
			 * as its last row. Now: `Pinned` (when the capability is on), then RUNNING,
			 * TODAY, THIS WEEK and OLDER. The partition and the times are
			 * `chat-list-sections.ts`'s, where a test can reach them; the order inside
			 * each section is still the catalogue's (bucketing is `filter`, never `sort`).
			 *
			 * THE LABELS ARE NOT CONTROLS (U22: "clicking a header collapses the list by
			 * accident"). A label is 12px `ink-dim` text at 500 and nothing happens when
			 * it is pressed; the one action a header carries is `Mark all N read`, on
			 * the first section that has rows.
			 */}
			{/*
			 * INVARIANT 1, DRAWN: the conversation the reader is IN, when the page
			 * put it past its own end. It is drawn as its own one-row section at the
			 * head of the list rather than silently appended to the page - the label
			 * says WHY a row appears above the sections that should contain it, and
			 * the reader can see where they are without paging to position 300.
			 */}
			{liftedRow && (
				<section data-chat-section="current">
					{sectionLabel("Current chat")}
					{sessionRow(liftedRow)}
				</section>
			)}
			{/*
			 * THE DRAFT ROWS, at the head of the list and with NO section heading of
			 * their own.
			 *
			 * The row's own words are §C1's `Draft: <first line>`, which says what the
			 * row is; a `DRAFTS` label above a stack of `Draft: …` rows would be the
			 * list's one stutter, and this list's section labels exist to say WHY a
			 * group of conversations is grouped (RUNNING, TODAY), not to repeat a word
			 * every row already carries.
			 *
			 * ABOVE `Current chat`, deliberately: a draft is the only thing in this panel
			 * whose whole content would otherwise be unreachable, because a session row
			 * can always be found again from the catalogue and a session-less draft
			 * cannot (U8).
			 *
			 * `data-chat-row` puts the row in the panel's one roving walk, so ↑/↓ reaches
			 * it exactly as it reaches a conversation (§C4, U2).
			 */}
			{draftRows.length > 0 && !query.trim() && (
				/*
				 * ONE SECTION, not bare children: the scroller's `space-y-4` is
				 * the SECTION rhythm (16px between groups), and a draft row rendered
				 * as a direct child inherited it - two drafts sat 16px apart while
				 * adjacent chat rows inside a section sit flush, which is the
				 * operator's 2026-09-26 report ("too much space between drafts ... not
				 * consistent with the spacing between other chats"). A `<section>`
				 * gives the drafts their own group: flush between themselves, one
				 * section step from the groups around them, exactly like the chats
				 * list's own sections.
				 */
				<section data-chat-section="drafts">
					{draftRows.map((row) => {
						/*
						 * ONE STATE, READ ONCE, for the reason the session rows spell out
						 * (review round 1, A7): the wrapper and the button both paint the
						 * current ground, and two copies of the predicate are two chances
						 * for them to disagree.
						 */
						const current = row.key === activeDraftKey;
						return (
							/*
							 * A WRAPPER PLUS A BUTTON, the shape the session rows settled on
							 * for a reason that applies word for word: a nested button is invalid
							 * HTML and unfocusable, so the discard act is the row button's
							 * SIBLING - and the box is what carries `group`, the state the
							 * act's reveal reads.
							 */
							<div
								key={row.key}
								className={cn(
									rowBoxStyle,
									"group",
									/*
									 * THE HOVER GROUND BELONGS TO THE ROW, NOT TO ITS BUTTON
									 * (design round 2, D13, measured on the session rows):
									 * `rowStyle`'s own `hover:bg-row-hover` fires only while the
									 * pointer is over the BUTTON, so moving onto the act beside it
									 * dropped the ground under a pointer that never left the row.
									 * A PLAIN `hover:`, never `group-hover:` - the box carries
									 * `group`, and `group-hover:` compiles to a DESCENDANT rule
									 * that can never match its own carrier.
									 */
									!current && "hover:bg-row-hover",
									current && rowCurrent,
								)}
							>
								<button
									type="button"
									data-chat-row
									data-draft-row={row.key}
									aria-label={`Open ${row.label}`}
									title={row.label}
									onClick={() => {
										openDraft(row.key);
										navigate("/chat");
									}}
									className={cn(
										rowStyle,
										"min-w-0 flex-1 text-left",
										current && rowCurrent,
									)}
								>
									<FileText
										className="size-4 shrink-0 text-ink-dim"
										aria-hidden="true"
									/>
									<span className="min-w-0 flex-1 truncate">{row.label}</span>
								</button>
								{/*
								 * THE WHY, WHERE BOTH CHANNELS CAN READ IT (design round 2's D7, UX
								 * round 2's U6). A `title` on a `disabled` control is the pointer-only
								 * channel engines are least reliable about, and it reaches no keyboard
								 * reader at all - so the sentence also exists as an `sr-only` element the
								 * control points at with `aria-describedby` while it is inapplicable.
								 * It lives OUTSIDE the button because `aria-label` owns the button's
								 * name; nothing reads this span as the act's label.
								 */}
								{/*
								 * RENDERED ONLY WHILE IT APPLIES (QA round 2, Q2-3). The span is not
								 * `aria-hidden`, so an `sr-only` sentence standing beside a live control is IN
								 * the accessibility tree: the row kept announcing "Sending - this draft can be
								 * discarded when the send settles" after the send had already been refused, while
								 * its own Discard was enabled and its `title` said the discard was available -
								 * two surfaces, one send, opposite claims, and the reader who cannot see the
								 * button is the one who cannot check. The gate is the SAME `row.pending` the
								 * press and the description read (this file's own "one state, read once" rule),
								 * so the three cannot disagree.
								 */}
								{row.pending && (
									<span id={draftWhyId(row.key)} className="sr-only">
										{SENDING_DISCARD_WHY}
									</span>
								)}
								{/*
								 * THE DISCARD ACT (operator, 2026-09-26: "Each one should have a
								 * deletion on hover"). Revealed by the row's hover or focus, the
								 * session acts' own pair - and IN the Tab ring, unlike those two:
								 * their chord (⌘⇧P / ⌘⇧A) is what let them leave it, and a draft
								 * has no chord. At rest the act is `hidden`, so it costs the ring
								 * nothing until its row has focus; from there the next Tab lands
								 * on it, which is the flow the session acts' own block describes.
								 */}
								<button
									type="button"
									data-draft-discard={row.key}
									/*
									 * INAPPLICABLE WHILE THE ROW'S SEND HOP IS LIVE (UX round 1's U2): a
									 * press here used to remove the row while the request went on to land
									 * in an unread chat - a discard followed by a silent send. The
									 * store's own semantics are unchanged (a deliberate discard still
									 * outranks the abandoned request - its record pins that), so the
									 * withholding is the ACT's, here and in the batch below.
									 *
									 * AND IT STAYS FOCUSABLE (agent review round 2's R7, design round 2's
									 * D7): a real `disabled` attribute drops the control out of the Tab
									 * ring and out of the arrow walk - `focus()` on it is a no-op, so a
									 * walk step onto it dead-stopped - and it leaves the why
									 * unannounceable. `aria-disabled` + a refused press is the app's own
									 * idiom for exactly this (`older-history-slot.tsx`: a disabled button
									 * cannot hold focus, and the keyboard reader is the one most likely
									 * to be on the control; `session-status-strip.tsx` the same).
									 */
									aria-disabled={row.pending}
									aria-describedby={
										row.pending ? draftWhyId(row.key) : undefined
									}
									aria-label={discardDraftLabel(row.label)}
									title={
										row.pending
											? SENDING_DISCARD_WHY
											: discardDraftLabel(row.label)
									}
									onClick={(event) => {
										/*
										 * THE REFUSED PRESS, before anything else (R7/D7): `aria-disabled`
										 * does not stop the click, so the handler is what makes it inert -
										 * no write, no caret move, no offer.
										 */
										if (row.pending) {
											event.preventDefault();
											return;
										}
										/*
										 * THEN THE REPEAT-PRESS GUARD, the panel's own record
										 * (`dropRepeatPress`): the row unmounts under the second click
										 * of a double-click, and the row that slides up can carry its
										 * act into the same spot. A dropped press writes nothing and
										 * moves no caret.
										 */
										if (
											dropRepeatPress(
												event.detail === 0
													? null
													: { x: event.clientX, y: event.clientY },
												row.key,
											)
										)
											return;
										/*
										 * AND THE CARET LANDS SOMEWHERE, the archive's own
										 * no-dead-cursor rule: the node the reader was on is about to
										 * unmount. The successor is read BY KEY before the write
										 * (`discardSuccessorIndex` carries the measured why: the old
										 * version indexed the discard BUTTON among `[data-draft-row]`
										 * elements, so it always landed on the first row), and the
										 * frame callback hands focus to the row occupying that
										 * position - the row that slid up into the gap, or the first
										 * row of the panel when this was last.
										 */
										const keys = [
											...(navRef.current?.querySelectorAll(
												"[data-draft-row]",
											) ?? []),
										].map((el) => el.getAttribute("data-draft-row") ?? "");
										const at = discardSuccessorIndex(keys, row.key);
										discardDraft(row.key);
										/*
										 * A PANE THAT WAS SHOWING THIS DRAFT IS GIVEN A FRESH ONE
										 * (UX round 1's U1, remediation): `discardDraft` clears
										 * `activeDraftKey`, and the chat page's residue arm has no
										 * composer - discarding the open draft used to leave a bare
										 * `New chat` surface. `onStageDraft(undefined, true)` is
										 * exactly the two steps the New chat row performs (stage a
										 * fresh draft, stay on `/chat`), and it runs only when the
										 * pane really was on this key.
										 */
										if (activeDraftKey === row.key) {
											onStageDraft(undefined, true);
											/*
											 * THE FRESH KEY IS REMEMBERED FOR THE OFFER'S OWN PRESS (UX
											 * round 2's U7): the snapshot restores THIS key's draft on an
											 * Undo, and the offer's handler re-opens it only when the pane
											 * still shows the freshly staged draft - the stored key is what
											 * makes "the pane sits on the staged key" a fact rather than a
											 * guess. Every discard writes it (null when the pane was not
											 * taken), so an offer never re-opens a pane the reader has
											 * since moved.
											 */
											setStagedByDiscard(
												useCanonicalSessionsStore.getState().activeDraftKey,
											);
										} else {
											setStagedByDiscard(null);
										}
										requestAnimationFrame(() => {
											const rows = [
												...(navRef.current?.querySelectorAll<HTMLElement>(
													"[data-draft-row]",
												) ?? []),
											];
											const next =
												rows[Math.min(Math.max(at, 0), rows.length - 1)] ??
												navRef.current?.querySelector<HTMLElement>(
													"[data-chat-row]",
												);
											next?.focus();
										});
									}}
									className={cn(
										"size-6 shrink-0 items-center justify-center rounded-md",
										"hidden text-ink-dim group-hover:flex group-hover:text-ink-muted",
										"group-focus-within:flex group-focus-within:text-ink-muted hover:text-ink!",
										/*
										 * COLOUR, NEVER OPACITY (design round 2's D5; branding.md §6): an
										 * opacity-faded control fades its own background too, so the same
										 * button lands on a different colour over each ground - measured at
										 * 1.89:1 / 2.13:1, BELOW the disabled role the palette ships for
										 * exactly this. The hover step is stilled explicitly, because the
										 * measured disabled read darkened under the pointer.
										 */
										"aria-disabled:cursor-default aria-disabled:text-ink-disabled!",
										"aria-disabled:hover:text-ink-disabled!",
									)}
								>
									<Trash2 className="size-4" aria-hidden="true" />
								</button>
							</div>
						);
					})}
					{/*
					 * THE CLEAR-ALL (operator, same message: "also a subtle clear all
					 * UX"). It clears EXACTLY the rows this section lists - the keys
					 * `untargetedDraftRows` produced, never a targeted/agent draft that is
					 * not on screen here - through ONE store write (`discardDrafts`), and
					 * it is a `data-chat-row` of its own so the arrow walk reaches it from
					 * the rows above; clearing must not strand the caret, so focus moves
					 * to the row that takes its place. Hidden with the section, which is
					 * the only state that has nothing to clear.
					 */}
					<div className="flex justify-end pt-1">
						<button
							type="button"
							data-chat-row
							data-drafts-clear-all
							/*
							 * NOTHING CLEARABLE IS THE ONE INAPPLICABLE STATE (UX round 1's U2;
							 * `aria-disabled` rather than `disabled` since agent review round 2's
							 * R7): every listed row is mid-hop, so the press would move nothing.
							 * With at least one settled row the batch clears exactly those (the
							 * store keeps its own semantics for the keys it is given) and the
							 * offer prints the count that moved. It stays FOCUSABLE while
							 * inapplicable - an arrow-walk step must land on something, and the
							 * why below must be reachable - and the press is what refuses (the
							 * app's own idiom, `older-history-slot.tsx`).
							 */
							aria-disabled={clearableDraftRows.length === 0}
							aria-describedby={
								clearableDraftRows.length === 0 ? CLEAR_ALL_WHY_ID : undefined
							}
							aria-label="Clear all drafts"
							title={
								clearableDraftRows.length === 0
									? CLEAR_ALL_WHY
									: "Clear all drafts"
							}
							onClick={(event) => {
								/*
								 * THE REFUSED PRESS (R7/D7): nothing to clear means the press is
								 * inert - no write, no caret move, no offer.
								 */
								if (clearableDraftRows.length === 0) {
									event.preventDefault();
									return;
								}
								const button = event.currentTarget;
								if (
									dropRepeatPress(
										event.detail === 0
											? null
											: { x: event.clientX, y: event.clientY },
										// Its own identity in the panel's one press record: the
										// hazard is the same one the rows guard against - the
										// control unmounts under the second click of a
										// double-click and a chat row takes its place.
										"drafts:clear-all",
									)
								)
									return;
								const at = [
									...(navRef.current?.querySelectorAll("[data-chat-row]") ??
										[]),
								].indexOf(button);
								const clearing = clearableDraftRows.map((row) => row.key);
								discardDrafts(clearing);
								/*
								 * THE SAME NO-DEAD-PANE RULE THE PER-ROW ACT CARRIES (UX
								 * round 1's U1): when the batch took the pane's own draft, a
								 * fresh one is staged so the composer never disappears - and
								 * the fresh key is remembered for the offer's own press (U7),
								 * exactly as the per-row act remembers it.
								 */
								if (
									activeDraftKey !== null &&
									clearing.includes(activeDraftKey)
								) {
									onStageDraft(undefined, true);
									setStagedByDiscard(
										useCanonicalSessionsStore.getState().activeDraftKey,
									);
								} else {
									setStagedByDiscard(null);
								}
								requestAnimationFrame(() => {
									const rows = [
										...(navRef.current?.querySelectorAll<HTMLElement>(
											"[data-chat-row]",
										) ?? []),
									];
									rows[Math.min(Math.max(at, 0), rows.length - 1)]?.focus();
								});
							}}
							className={cn(
								"flex h-7 items-center rounded-md px-2 text-body-sm",
								"text-ink-dim transition-colors duration-fast ease-out-quart",
								"hover:bg-row-hover hover:text-ink",
								"focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2",
								/* Colour, never opacity - the trash's own D5 note is the full one. */
								"aria-disabled:cursor-default aria-disabled:text-ink-disabled!",
								"aria-disabled:hover:bg-transparent! aria-disabled:hover:text-ink-disabled!",
							)}
						>
							Clear all
						</button>
						{/*
						 * The why the control points at while inapplicable (D7/U6): the trash's
						 * sibling, above - and gated on the SAME predicate for the same reason
						 * (QA round 2, Q2-3: the sentence stood in the panel's accessibility tree
						 * beside an enabled `Clear all`, telling a reader the sends had not
						 * settled when every one of them had).
						 */}
						{clearableDraftRows.length === 0 && (
							<span id={CLEAR_ALL_WHY_ID} className="sr-only">
								{CLEAR_ALL_WHY}
							</span>
						)}
					</div>
				</section>
			)}
			{/*
			 * THE GROUPING ALTERNATIVES (the view popover's `Group by`). `section` is
			 * the arrangement below; `agent` and `flat` replace it, and they draw
			 * over the SAME page, so switching the grouping cannot change which rows
			 * are loaded - only how they are arranged.
			 */}
			{/*
			 * THE PINNED ROWS RIDE IN THE GROUPED LIST, and this is `groupBy`'s half of
			 * the same rule the section arrangement keeps: a grouping changes the
			 * ARRANGEMENT, never which conversations are drawn. The `Pinned` section is
			 * only drawn under `section` (the block below), so grouping by agent or
			 * flattening and handing `pagedRows` alone to `groupRows` silently dropped
			 * every pinned chat - a layout preference acting as a filter, which is the
			 * failure `groupRows`'s own "an ungrouped chat is a real group" note rejects
			 * one axis over. `pinned` leads because a pin is the reader's own "keep this
			 * at the top", and `unpinnedRows` has already removed these rows from the
			 * page, so no conversation is drawn twice (operator's view-settings audit,
			 * 2026-09-27: "Group by ... each must actually regroup the list").
			 */}
			{view.groupBy !== "section" &&
				(groupRows([...pinned, ...pagedRows], view.groupBy) ?? []).map(
					(entry) => (
						<section key={entry.key} data-chat-section={entry.key}>
							{entry.label ? sectionLabel(entry.label) : null}
							{entry.rows.map((row) => sessionRow(row))}
						</section>
					),
				)}
			{/*
			 * THE PINNED ORDER'S LIVE REGION, mounted with the capability and OUTSIDE the
			 * section below rather than inside it: the section is drawn only while the panel
			 * has pinned rows AND is arranging by section, while a move's answer is owed
			 * wherever a move could be made. The region itself never animates or moves - only
			 * its text changes, which is what a polite region announces (`tailArrival` above
			 * is the same shape, for the same reason).
			 *
			 * INSIDE `pinsEnabled`, because a backend without the pin store must render the
			 * panel it always did: the gate's whole claim is that no affordance, no section
			 * and no region for either exists where there are no pins.
			 */}
			{pinsEnabled && (
				<span
					className="sr-only"
					aria-live="polite"
					data-sidebar-pin-order-announcement
				>
					{pinMoveAnnouncement}
				</span>
			)}
			{pinnedShown && view.groupBy === "section" && pinned.length > 0 && (
				<section
					ref={pinnedSectionRef}
					data-chat-section="pinned"
					/*
					 * `relative` is the drop indicator's containing block (issue #697, item 5):
					 * the line is positioned in the SECTION's coordinates, so it scrolls with the
					 * rows it sits between - an indicator on the scroller would stay put while the
					 * gap it names scrolled away. `data-chat-section` is the marker this panel's
					 * other sections already carry, and the one the evidence rigs scope by.
					 */
					className="relative"
				>
					{sectionLabel("Pinned")}
					{orderedPinned.map((row) => sessionRow(row))}
					{/*
					 * THE INSERTION INDICATOR, and it exists ONLY while a drag does: a 2px line in
					 * the gap the row would land in, `bg-accent`'s colour step and nothing else -
					 * no lift, no shadow, no scale (the branding contract; `project-board.tsx`'s
					 * own `placeIndicator` is the precedent, one axis over).
					 *
					 * `aria-hidden` because the line is the POINTER's reading of a state the live
					 * region speaks in words: an assistive reader is told where the row moved to,
					 * and a decorative element with no text would be one more thing to skip.
					 */}
					{pinDrag !== null && (
						<div
							ref={pinIndicatorRef}
							aria-hidden="true"
							data-session-pin-indicator=""
							className="pointer-events-none absolute right-1 left-1 h-0.5 rounded-full bg-accent"
						/>
					)}
				</section>
			)}
			{view.groupBy === "section" &&
				drawnSections.map((key) => {
					const rows = sectioned[key];
					if (key === "running" && rows.length === 0 && livenessUnread) {
						/*
						 * The one empty section that still says something: the daemon could not
						 * read which chats are running, so an absent RUNNING section would be a
						 * claim that nothing is - the D2 rule `canonical-chat.test.mjs` pins.
						 */
						return (
							<section key={key}>
								{sectionLabel(CHAT_LIST_SECTION_LABEL[key])}
								<p className="px-2 text-meta text-ink-dim">
									{livenessUnread
										? "The daemon could not read which chats are running, so this list may be incomplete."
										: "Nothing running right now."}
								</p>
							</section>
						);
					}
					// An empty section contributes no label: the TUI's own rule, and the one
					// `Pinned` already follows.
					if (rows.length === 0) return null;
					return (
						<section key={key} data-chat-section={key}>
							{sectionLabel(
								CHAT_LIST_SECTION_LABEL[key],
								/*
								 * The bulk read receipt sits on the FIRST section that has rows - the
								 * one the eye lands on - while the set it clears is the STORE's, so
								 * the count its label names is the same fact wherever it is drawn.
								 * One gesture, one control, never on a row.
								 */
								key === firstSection ? markAllReadControl : undefined,
							)}
							{rows.map((row) => sessionRow(row))}
						</section>
					);
				})}
			{/*
			 * THE PAGE'S FOOT (`data-sidebar-page-more`), and it is the operator's
			 * contract: "show the latest 10 ... and then have a 'Load 10 more', starts
			 * with 10, then 25, then 50, and then user can click to load more". The
			 * label names the NEXT rung rather than the ladder, and it is bounded by
			 * what is actually left, so it cannot offer fifteen rows when four are
			 * unloaded.
			 *
			 * IT IS NOT DRAWN WHILE SEARCHING, because the page is not: a query lifts
			 * the limit entirely (`pageRows`), so there is nothing left to load and a
			 * control that said otherwise would be a button with no effect.
			 *
			 * ON THE PAGED PATH IT IS THE TAIL'S OWN PRESS (#505 reconciliation). The
			 * rung above the rows held is reached by following the HEAD'S CURSOR
			 * (`fetchCatalogueTail`), never by re-slicing rows the client already has:
			 * the head is a fifty-row page, so a ladder that only sliced would stop at
			 * fifty while the daemon held four hundred more. `tailMore` is the daemon's
			 * own answer that more exist; `ladderStep` is the size of the page the press
			 * asks for, which is what keeps the label honest when the count of what is
			 * left is a number only the daemon has.
			 *
			 * A MUTED ROW rather than a primary button - the operator's reference
			 * prints `Show N more sessions` as quiet text at the group's foot, and the
			 * column's ink budget is spent on the rows themselves.
			 */}
			{!query.trim() && (page.remaining > 0 || tailMore) && (
				<button
					type="button"
					data-sidebar-page-more
					onClick={pressPageMore}
					className="flex h-7 w-full items-center rounded-md px-2 text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
				>
					{pageMoreLabel(
						view.loads,
						page.remaining > 0 ? page.remaining : ladderStep,
					)}
				</button>
			)}
			{/*
			 * THE TAIL, AT THE FOOT OF THE LIST IT EXTENDS (#505).
			 *
			 * `catalogueTail` is the extension's own register: the wait sentence while a
			 * page is on its way, and the refusal with the one Retry this foot may carry.
			 * It draws NOTHING in the steady state (`catalogueTailView` says why), so it is
			 * never a second control beside the ladder below - the ladder is the press, and
			 * this is what the press has to say when it does not succeed.
			 *
			 * THE ANNOUNCEMENT IS OUTSIDE THE SWAP (round 2, R2-5): the region stays mounted
			 * while the tail goes from loading to settled, because a live region that is
			 * replaced by an empty one announces nothing - and the rows arriving are the
			 * whole of what this control does.
			 */}
			{catalogueTail}
			{tailArrival !== null && (
				<span className="sr-only" aria-live="polite">
					{tailArrival}
				</span>
			)}
			{/* A COLD-START sentence, not an empty-list one: it says the store
		    holds no chats at all, so it must not appear beside rows. The
		    catalogue being empty while `matching` is not is reachable now
		    that a search hit for a session beyond this client's page is
		    rendered as a row of its own (review round 2, R13 — this gate
		    asked only about `sessions`, and a query was the other half of
		    the claim). */}
			{!sessions.length &&
				!matching.length &&
				!loading &&
				!query.trim() &&
				// AND THE CENSUS, where one arrived (design §5.5): a cold-start
				// sentence must not appear beside a store the daemon has just counted.
				// A head page that stopped short of the rows leaves `sessions` empty
				// while `counts.total` is 757, and the sentence would then tell the
				// reader their store holds no chats at all - the same false statement
				// as the group's, one register wider.
				(catalogueCounts === null || catalogueCounts.total === 0) && (
					<p className="text-meta text-ink-muted">
						No chats yet. Choose an agent, team or New chat.
					</p>
				)}
			{/*
			 * THE TRUNCATION SENTENCE IS THE WITHDRAWN PATH'S, and the gate is the
			 * CAPABILITY rather than the query (round 1, U4 + Q1). It used to read
			 * `truncated && !groupPaging`, and `groupPaging` is false whenever a search is
			 * in force - so on a PAGING backend with a query active the panel told the
			 * reader about a 500-row cap that is not why their list stops, while the
			 * client's own request asked for a fifty-row head page. Both of the
			 * sentence's clauses are true exactly when the daemon cannot page.
			 *
			 * THE PAGED PATH DRAWS ITS OWN TOTAL INSTEAD: `<Showing N of M chats>` from
			 * the census (`catalogueTotalSentence`), which is the statement that is true
			 * here - the panel holds the head page plus whatever the reader has extended,
			 * of a catalogue somebody has counted. The group's badge says what a GROUP
			 * holds; this says how many are ON SCREEN, which is the pair the operator's
			 * original confusion turned on.
			 */}
			{totalSentence !== null && (
				<p className="text-meta text-ink-muted">{totalSentence}</p>
			)}
			{truncated && !pageable && (
				<p className="text-meta text-ink-muted">
					Showing up to 500 chats. Older chats remain available in the terminal.
				</p>
			)}
			{/*
			 * The feed's own state, in the sidebar's register (M3).
			 *
			 * `ink-dim` rather than `warning`, because a disconnected feed is not a
			 * failure in front of the user: banners and marks stop arriving, and
			 * everything already on screen is still true. `warning` ink is spent
			 * only when the app is otherwise IDLE, where this line is the whole
			 * reason nothing is updating. Never `danger`: nothing the user did
			 * failed, and the retry is main's watchdog's, not theirs.
			 *
			 * Rendered only when the feed is expected to exist — an older backend
			 * or a browser-dev renderer has no feed to be disconnected from, and
			 * the legacy poll is running instead.
			 */}
			{/* Suppressed when the alert below already carries the condition
		    (design review round 1, D9): the catalogue fetch fails exactly
		    when the backend is down, so the two statements about one
		    backend would otherwise stack — a quiet `ink-dim` line directly
		    under a `role="alert" text-danger` block about the same thing.

			    `feed.reported` is what keeps it off the FIRST paint (round 1, Q3):
			    `connected` is false until the transport says otherwise, so a line
			    gated on it alone claimed a disconnection during the few
			    milliseconds before the app had heard anything at all — and the
			    next frame contradicted it.

			   AND IT IS THE FOURTH SITE TO STAND DOWN TO THE STRIP (design round
			   3, D30): the caption's connection half restated the strip's own
			   sentence one row apart, so it reads `stripSpeaksConnection` like the
			   two paragraphs above it and the foot line — the list half's fact is
			   still stated by the rows themselves, and off /chat, where the strip
			   is not mounted, this caption is the voice again. */}
			{/*
			 * The pinned spelling below is the same expression round 1 settled on
			 * (`feed.available && feed.reported && !feed.connected`): the transport
			 * must have SPOKEN, so the caption cannot flash on the first frame, and
			 * it must not be CONNECTED. The two clauses that follow are the D9 alert
			 * suppression and D30's stand-down to the strip.
			 */}
			{feed.available &&
				feed.reported &&
				!feed.connected &&
				!error &&
				!stripSpeaksConnection && (
					<p
						className={cn(
							"text-meta",
							sessions.some((row) => row.active)
								? "text-ink-dim"
								: "text-warning",
						)}
					>
						Not connected to the backend — showing the last known state.
					</p>
				)}
		</div>
	);

	/*
	 * THE SPLIT'S AFFORDANCES ARE GONE (operator report, 2026-09-26): the
	 * draggable boundary, the collapse cluster and the region swap are not drawn
	 * anywhere any more, because there is one region to draw them on. Each
	 * behaviour is recorded here rather than silently dropped: a drag has
	 * nothing to size with one region; collapsing one of two regions is not a
	 * state; the swap's memory is moot with the order fixed. Arrangement still
	 * lives where the operator put it - on the SECTIONS themselves (their
	 * disclosures and their row-count caps). `features/chat/sidebar-split.ts`,
	 * its tests and `docs/design/sidebar-sections.md` remain the record of the
	 * removed feature; nothing in this file reads the split any more.
	 */

	return (
		<nav
			ref={navRef}
			aria-label="Chats"
			/*
			 * THE SIDEBAR IS THE FIRST REGION OF THE KEYBOARD WALK (§C4). `tabIndex={-1}`
			 * is what makes it a DOOR rather than a stop: the panel is entered by `F6`
			 * when it has no row to land on (a filtered list with no match, an empty
			 * catalogue), and it is deliberately not in the Tab ring, where a stop on a
			 * container whose children are all stops is one press that does nothing.
			 *
			 * `onFocus` rather than a capture listener on the panel element: React's
			 * synthetic focus event bubbles, so this one attribute reaches every row the
			 * four render sites draw, and the roving stop follows focus wherever it lands.
			 */
			data-chat-region="sidebar"
			tabIndex={-1}
			onFocus={onRowFocus}
			/*
			 * `relative` IS THE PANEL'S OWN ANCHOR for anything absolutely positioned inside it.
			 * The archive lane that used to hang off it - a band at the column's foot, sized by the
			 * card it held - is gone with the operator's own request (2026-09-27: the messages are
			 * ordinary sonner toasts again, raised by `undo-toasts.tsx` into the global container),
			 * and the lane, its measurements and its supersession are recorded in
			 * `docs/design/sidebar-row-space.md` §10. The container declaration the old per-row shed
			 * measured against is gone with the shed: this panel no longer changes what it draws by
			 * width.
			 *
			 * ONE WIDTH QUERY DID COME BACK FOR A WHILE, AND IT IS GONE AGAIN (issue #697, then the
			 * 2026-09-30 archive-confirm lane). The grip was shed at or below 278px of panel because,
			 * with the move pair beside it, the revealed cluster left the title 40px of the row's 208
			 * at the clamp. The pair is deleted - its two acts are the `Move conversation` items in
			 * the row's menu - so the cluster is `[archive][grip][pin]` (80px) and the grip is drawn
			 * at EVERY width: the shed, and the container declaration it measured against, went
			 * with it. This panel does not change what it draws by width.
			 */
			className="relative flex h-full min-h-0 flex-col bg-surface p-2 text-ink"
			onKeyDown={keyDown}
		>
			{/*
			 * ONE PROVIDER FOR THE WHOLE PANEL, and it is load-bearing rather than tidy:
			 * every row's flyout is a Radix `Tooltip.Root`, and the primitive's wrapper
			 * self-provides when nothing above it did - which would give each row its own
			 * provider, and with it its own 400ms delay and no shared
			 * `skipDelayDuration`, so sweeping from one row to the next would re-wait on
			 * every one. Sharing it is what makes the panel's hover read as one surface.
			 */}
			<TooltipProvider>
				{/*
				 * THE BAND: the segment that divides the destinations above from the
				 * agents/teams/chats below, and the column's one control surface for the
				 * list's arrangement.
				 *
				 * THE OPERATOR'S DIRECTION (2026-09-25), quoted because it is the reason
				 * this row exists: "It might also be worthwhile to have a segment diving
				 * the nav from the agents/teams/chats that has view options and buttons to
				 * create teams/agents similar to creating workspaces in dsh" ... "Make sure
				 * the buttons are subtle and probably icon-only with tooltips on hover and
				 * clicking pops out comprehensive options for customizing the view."
				 *
				 * NO TEXT LABEL, and that is the one place this deliberately differs from
				 * the reference. dsh's row prints `Workspaces`; a label here would be the
				 * `Chats` heading this panel removed on design round 1's D1 - 32px of
				 * chrome naming the same thing the first section label below it names,
				 * over a column that holds TWO kinds of section (agents and teams as well
				 * as chats, which no single noun covers). What is left is what the operator
				 * actually asked for: the three buttons, at the trailing edge, over a row
				 * that divides one block of the column from the next.
				 *
				 * ICON-ONLY WITH TOOLTIPS, so each control carries an `aria-label` of its
				 * own rather than relying on the tooltip: Radix's tooltip adds
				 * `aria-describedby` and only while open, which is not a name.
				 */}
				{/*
				 * THE BAND IS THE LIST'S CONTROL SURFACE, SO IT TAKES THE LIST'S OWN
				 * GATE. `showList` is the catalogue's answer, the same value that decides
				 * whether the two regions are drawn at all - and a band drawn without them
				 * is three controls over nothing: `Search` would open a field whose list is
				 * not mounted and `View options` would switch sections nothing is drawing.
				 * The rule is the one the withdrawn gate already states for the boundary
				 * ("no catalogue means no regions to split"), applied to the row above
				 * them. Observed in the no-backend `states` frame, 2026-09-25.
				 */}
				{showList && (
					<div
						data-sidebar-band
						className="mb-2 flex h-7 shrink-0 items-center justify-end gap-0.5"
					>
						<Tooltip content="Search chats and agents">
							<Button
								variant="ghost"
								size="icon-sm"
								data-sidebar-search
								aria-label="Search chats and agents"
								onClick={() => {
									/*
									 * The field is drawn only while filtering (`filterOpen`), so this
									 * control is what OPENS it - the same state the list's own typing
									 * and Escape's ladder already move, rather than a second search
									 * surface. The focus lands on the next frame because the input
									 * is `hidden` until this state commits.
									 */
									setFilterOpen(true);
									window.requestAnimationFrame(() =>
										searchRef.current?.focus(),
									);
								}}
							>
								<Search aria-hidden="true" />
							</Button>
						</Tooltip>
						<Popover open={viewOpen} onOpenChange={setViewOpen}>
							<Tooltip content="View options">
								<PopoverTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										data-sidebar-view-options
										aria-label="View options"
										aria-expanded={viewOpen}
										/*
										 * THE FILLED PILL THE REFERENCE DRAWS (dsh's middle button fills
										 * when a view option is active), and the condition is the view's
										 * own difference from the default rather than the panel being
										 * open: a button that lit up merely because it was clicked would
										 * say "configured" about a panel the reader then closed
										 * unchanged.
										 */
										className={cn(
											viewIsCustom &&
												"bg-row-selected text-ink hover:bg-row-selected",
										)}
									>
										<SlidersHorizontal aria-hidden="true" />
									</Button>
								</PopoverTrigger>
							</Tooltip>
							<PopoverContent
								align="end"
								/*
								 * THE PANEL SCROLLS INSIDE THE WINDOW, WITH A VISIBLE BOTTOM EDGE (design
								 * direction D2, 2026-09-28; the inset is D1 of round 1). The Time basis
								 * group pushed this panel past an 800x600 window: measured in the
								 * `popover-open-short` capture, the panel ran off the bottom edge and the
								 * Teams row, and the hidden-sections sentence below it, were unreachable.
								 * `--radix-popover-content-available-height` is Radix's own measurement
								 * of the space it has before the viewport edge, so the cap follows the
								 * window rather than a guessed `max-h`; `overflow-y: auto` then keeps
								 * every group reachable by scrolling the panel itself.
								 *
								 * THE INSET RESERVES HALF A ROW BELOW THE PANEL. A capped box that ends
								 * flush with the window edge hides that it is capped at all - macOS's
								 * overlay scrollbars are invisible at rest, and a row cut by the window
								 * edge reads as the end of the list - which is round 1's D1. Sixteen
								 * pixels keeps the panel's own bottom edge (and rounded corner) in
								 * view, so the fold reads as the panel's edge rather than the window's.
								 *
								 * WHAT RENDERS ABOVE THE FOLD IS THE NEXT SECTION'S TOP PADDING, not a
								 * sliver of its content: round 2 (D4) measured zero content pixels above
								 * the fold in six themes, and the cut would have to land 8-12px lower to
								 * cross the glyphs. The content-sliver cue is consciously not taken -
								 * what this inset buys is the panel's own visible edge, and a frame
								 * that shows it without a scrollbar has no other cue to give.
								 *
								 * AND THE CAP BINDS AT THE APP'S DEFAULT SIZE TOO, not only at the floor
								 * (round 1's Q-1: at 1380x900 the view trigger sits under the nav rail, so
								 * the available height is 518 against 598 of content). The panel scrolls
								 * there exactly as it does at 600 - only a window tall enough that the
								 * available space clears the content never scrolls.
								 */
								className="max-h-[calc(var(--radix-popover-content-available-height)_-_16px)] w-60 overflow-y-auto p-2"
								data-sidebar-view-panel
							>
								<ChatSidebarViewMenu
									view={view}
									counts={viewCounts}
									onView={setChatSidebarView}
								/>
							</PopoverContent>
						</Popover>
						<Popover open={createOpen} onOpenChange={setCreateOpen}>
							<Tooltip content="New agent or team">
								<PopoverTrigger asChild>
									<Button
										variant="ghost"
										size="icon-sm"
										data-sidebar-create
										aria-label="New agent or team"
										aria-expanded={createOpen}
									>
										<FolderPlus aria-hidden="true" />
									</Button>
								</PopoverTrigger>
							</Tooltip>
							<PopoverContent
								align="end"
								className="w-44 p-1"
								data-sidebar-create-panel
							>
								{/*
								 * THE TWO EXISTING FLOWS, and they are navigations rather than
								 * dialogs because the authoring surfaces ARE pages: `
								 * /agents?create=agent` is what the Agents row's own `Create agent`
								 * control and the command palette both open. A second, modal
								 * authoring form here would be a second way to create a profile, and
								 * the one thing the authoring routes guarantee is that it is the
								 * same form, the same validation and the same save.
								 */}
								<button
									type="button"
									data-sidebar-create-agent
									onClick={() => {
										setCreateOpen(false);
										navigate("/agents?create=agent");
									}}
									className="flex h-7 w-full items-center gap-2 rounded-md px-1 text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
								>
									<UserPlus aria-hidden="true" className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">New agent</span>
								</button>
								<button
									type="button"
									data-sidebar-create-team
									onClick={() => {
										setCreateOpen(false);
										navigate("/agents?create=team");
									}}
									className="flex h-7 w-full items-center gap-2 rounded-md px-1 text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
								>
									<Users aria-hidden="true" className="size-3.5 shrink-0" />
									<span className="min-w-0 flex-1 truncate">New team</span>
								</button>
							</PopoverContent>
						</Popover>
						<Tooltip content="Open agent…">
							{/*
							 * THE FOURTH BAND CONTROL (issue #663): the roster's jump. The
							 * section filter above survives a cap-bound roster, but a reader
							 * who has not expanded the section still has no path to a
							 * standalone agent that does not begin with "scan a long
							 * disclosure list" - this control is that path: one press, and
							 * the palette is open on its agents scope with the field ready
							 * for a name, whatever the roster's length.
							 *
							 * OPEN, THEN SEED, and the order is the store's own shape:
							 * `openCommandPalette` only raises `isCommandPaletteOpen` - it
							 * does not touch the query (`ui-preferences-store.ts`, verified
							 * rather than assumed) - and `closeCommandPalette` clears the
							 * query on every close. The seed goes in AFTER the open so both
							 * writes land in one commit, which is what the palette's open-time
							 * sync reads; a palette already open moves to the agents view
							 * rather than toggling shut - the promise #659's Cmd+P door makes
							 * for its own seed.
							 *
							 * ONE CLOSE PATH KEEPS THE QUERY, AND THAT IS THE STORE'S OWN CALL
							 * (agent review round 1, B1). Cmd+K closes through
							 * `toggleCommandPalette`, which RETAINS the query on close by design
							 * ("Retain when closing"), so a seeded `@` can outlive a
							 * toggle-close and reappear at the next unseeded door - the rail's
							 * own Search row, for one. That reach path belongs to ANY query this
							 * store has ever held, not to this control, and narrowing it means
							 * changing the toggle's retain - a store-level decision this control
							 * records rather than makes. What the comment above may NOT claim is
							 * that no seed can leak, and its first version did.
							 *
							 * NO NEW CHORD rides with it: the two keyboard doors stay the
							 * palette's own, and a gesture nobody can discover from the
							 * column is not what a reader asking "where is my agent" needs.
							 */}
							<Button
								variant="ghost"
								size="icon-sm"
								data-sidebar-open-agent
								aria-label="Open agent…"
								onClick={() => {
									openCommandPalette();
									setCommandPaletteQuery(AGENT_ROSTER_SEED);
								}}
							>
								<AtSign aria-hidden="true" />
							</Button>
						</Tooltip>
					</div>
				)}
				{/* The field carries its own clear control rather than relying on
		    Escape, which also blurs: a pointer user who wants to widen the filter
		    back out had to select the text and delete it, and there was nothing on
		    screen saying the field could be emptied at all. `pr-9` keeps the query
		    clear of the control — the same reserved-column idiom the settings
		    search uses on the left for its leading glyph. */}
				{/*
				 * DRAWN ONLY WHILE FILTERING (see `filterOpen`): the column's one search at
				 * rest is the palette's `Search ⌘P` row, and this field is the list's own
				 * narrowing, opened by typing into the list. On the column's ground, not in
				 * an outlined box (§B3: the sidebar is separated by ground alone) - the
				 * field reads as a field by its caret and its placeholder, and its focus
				 * ring is the one boundary it draws.
				 */}
				<div className={cn("relative mb-2", !filterShown && "hidden")}>
					<input
						ref={searchRef}
						aria-label="Search chats and agents"
						placeholder="Filter chats and agents"
						className="h-8 w-full rounded-md bg-row-hover pr-9 pl-2 text-body-sm"
						value={query}
						onChange={(event) => setQuery(event.target.value)}
						onBlur={() => {
							if (!query) setFilterOpen(false);
						}}
					/>
					{/* Rendered only while a filter is applied: a clear control beside an
			    empty field is a control that does nothing.

			    The ring is pulled INSIDE the control's own box, against the shared
			    `icon-sm` step. That step draws a 2px outline at a 1px offset, which
			    needs 3px of clearance around the control; this one is 28px inside a
			    32px field, so 2px is all there is, and at the step's own offset the
			    ring's top and bottom arcs crossed the field's `border-control` line
			    and read as a control bulging out of the field it sits in (design
			    round 1, D1). Inset, the ring hugs the control's own radius, stays
			    clear of the 14px glyph, and cannot leave the field in any palette.
			    `!` because the size step's offset is itself important and this is
			    an override of it rather than a second convention. */}
					{query && (
						<Button
							variant="ghost"
							size="icon-sm"
							className="absolute top-1/2 right-1 -translate-y-1/2 focus-visible:outline-offset-[-2px]!"
							onClick={() => clearSearch(searchRef.current, setQuery)}
							aria-label="Clear search"
						>
							<X aria-hidden="true" />
						</Button>
					)}
				</div>
				{/*
				 * INCLUDE ARCHIVED, and its own render rule is the same one the clear
				 * control above follows: it is drawn only while a query exists.
				 *
				 * Not decoration - the rule is what keeps the panel free of new chrome at
				 * rest, which is the constraint this half of the feature is under. The
				 * brief rules out an `Archived chats` section, and a permanently visible
				 * toggle would be that section's control sitting in a block that is
				 * otherwise about the query: with an empty box there is nothing to scope
				 * the widened search to, so the control would be a switch for a search that
				 * is not happening.
				 *
				 * A CHECKBOX with a label rather than a pressed button: the question is
				 * binary and it widens the CURRENT SEARCH rather than selecting a thing, so
				 * it reads as "what this search looks at" - which is also why the label is
				 * the whole control and there is no icon.
				 *
				 * FAIL-CLOSED: absent `session_archive` this is not rendered at all, and
				 * with it rendered off the panel is the panel it always was (`visibleRows`
				 * keeps the archived rows out of every list either way, so the control can
				 * only ever reveal them inside one query).
				 */}
				{archiveEnabled && query.trim() && (
					<div className="flex items-center gap-2 pb-2">
						<Checkbox
							id={INCLUDE_ARCHIVED_ID}
							checked={includeArchived}
							onCheckedChange={(checked) =>
								setIncludeArchived(checked === true)
							}
						/>
						<Label
							htmlFor={INCLUDE_ARCHIVED_ID}
							className="text-meta text-ink-muted"
						>
							Include archived
						</Label>
					</div>
				)}
				{/* Says what the search actually LOOKED AT, and only while a query is
		    active, because that is the moment the claim is true and relevant.
		    Both cases are degradations the user cannot see otherwise: the list
		    still narrows, it just narrows by less than the box promises, and a
		    search that quietly stops looking inside conversations is
		    indistinguishable from one that found nothing there. */}
				{/* A box past the op's own bound is refused before the request is made, so
		    it must not be rendered as a backend problem with a Retry: retrying
		    re-sends the same characters and is refused identically (QA round 1,
		    Q1). It takes precedence over the names-only notice below, which
		    describes the same narrowing for a different cause and offers a remedy
		    (update the app) that cannot help THIS box — shorten the query and that
		    notice returns for the reason it was written for. */}
				{overLong && ready && (
					<p className="pb-2 text-meta text-ink-muted">
						Search terms are limited to {SESSION_SEARCH_MAX_CHARS} characters.
						This one is longer, so only chat names are being searched.
					</p>
				)}
				{query && ready && !searchSupported && !overLong && (
					<p className="pb-2 text-meta text-ink-muted">
						Searching chat names only. Update Local Operator to search inside
						conversations.
					</p>
				)}
				{query && searchSupported && search.isError && (
					<p className="pb-2 text-meta text-ink-muted">
						Conversation search is unavailable, so these are name matches.{" "}
						<Button
							variant="link"
							size="sm"
							type="button"
							onClick={() => void search.refetch()}
						>
							Retry
						</Button>
					</p>
				)}
				{/* The two states of "there is no answer for what you typed yet", and the
		    empty result once there is. All three sit here, beside the notices,
		    rather than inside the scrolling list: they are statements about the
		    SEARCH, and every other line that says something about the search
		    holds this column — inside the container they sat ~6px off it, which
		    showed as a stagger whenever a notice and the sentence appeared
		    together (design round 2, D13).

		    The no-match sentence is rendered only when the conversation search
		    actually RAN and answered this exact query. `Nothing in your chats
		    matches X` is otherwise unverifiable, and on a names-only or failed
		    backend it is simply false: the app would say it cannot see inside
		    conversations and then assert that nothing in any conversation
		    matches (design round 2, D11 — `classifer` matches a conversation on
		    the capable backend, in the same fixture). When the search could not
		    run, the notice above is the whole truth and this says nothing.

		    `Searching conversations…` covers the other window: the debounce plus
		    the round trip, during which the list legitimately holds name and
		    label matches only. The list visibly loses the conversation matches it
		    was showing, and without this line that reads as a bug (review round
		    1, R2) — naming the state is the honest answer, not filling it with
		    the previous question's hits (review round 2, R10). */}
				{query.trim() && showList && !matching.length && answered && (
					<p className="pb-2 text-meta text-ink-muted">
						Nothing in your chats matches “{query.trim()}”.
					</p>
				)}
				{awaiting &&
					lostRowsToStaleAnswer(
						previous?.rows.length ?? 0,
						matching.length,
					) && (
						<p className="pb-2 text-meta text-ink-muted">
							Searching conversations…
						</p>
					)}
				{/* Mounted at all times and filled later: a live region added to the
		    tree WITH its text already inside is frequently not announced at
		    all, because the region has to exist before the change for the
		    change to be the event (design round 2, D15). `sr-only`, so the
		    announcement mirrors the visible sentence without a second visible
		    copy of it. */}
				<p aria-live="polite" className="sr-only">
					{awaiting &&
					lostRowsToStaleAnswer(previous?.rows.length ?? 0, matching.length)
						? "Searching conversations."
						: query.trim() && showList && !matching.length && answered
							? `Nothing in your chats matches ${query.trim()}.`
							: ""}
				</p>
				{/* ONE SCROLLER, ONE FLOW (operator report, 2026-09-26): the entity
				    sections and the chats list are children of this one box, in that
				    order; nothing scrolls inside it or around it, and a section that
				    grows is still bounded by its own row-count cap (`Show N more`)
				    rather than by a scroller. The twin ref lets every consumer that
				    used to name one of the two regions (the two focus slots, the
				    walk's roots, the scroll handlers) keep working against this node.
				    `docs/design/sidebar-sections.md` and `sidebar-split.ts` remain
				    the record of the removed split.

				    THE MARKER IS `scroller`, NOT `chats` (round 1, R3): while this
				    node carried the `chats` name, every rig that scoped
				    `[data-sidebar-region="chats"]` to mean "the chats list" read the
				    whole sidebar body, entity sections included - and the cap rule a
				    rig wrote for the list capped the entities too. The list's own
				    node carries `chats` (see the list region below); this node
				    answers for the scroll, the clip and the gutter. */}
				<div
					ref={bindPanelRef}
					id={CHAT_REGION_ID}
					tabIndex={-1}
					data-sidebar-region="scroller"
					/* The edge cues (issue #845): `index.css` masks on this hook. */
					data-lo-sidebar-edge-cues
					onScroll={() => {
						refreshFocusedInside(entityPanelRef.current, entitySlotRef);
						refreshFocusedInside(listPanelRef.current, listSlotRef);
						extendCatalogueTail();
					}}
					className="relative min-h-0 flex-1 space-y-4 overflow-y-auto p-1 [overflow-anchor:none] [scrollbar-gutter:stable]"
				>
					{entityRegion}
					{pinFailureLine}
					{listShown && listRegion}
				</div>
				{/*
				 * THE FOOT LINE STANDS DOWN WHILE THE SERVER IS UNREACHABLE (§F2).
				 *
				 * A lost server used to be stated twice on one screen: the pane's status
				 * strip ("Can't reach the Local Operator server" + Retry) and this foot's
				 * red alert ("did not answer this request" + Retry refresh) - two root
				 * causes, two Retries, one fact, which is the contradiction §F2 exists to
				 * end. The strip is the one voice for connection state, so while the
				 * health probe says the server is not reachable this line says nothing.
				 *
				 * It is KEPT for the other case, and demoted: a reachable server that
				 * refused or failed this list's own read is a fact about the LIST, which
				 * the strip does not state, and the refresh is its only remedy. It is a
				 * caption now - `ink-muted`, no `role="alert"` - per branding § 9's one
				 * register for the status slot; the strip owns the one live alert.
				 *
				 * AND THE STAND-DOWN REQUIRES THE STRIP TO BE ON SCREEN (R11): this
				 * sidebar renders on every route while the strip renders only in the
				 * conversation pane, so a lost server on /settings and its siblings has
				 * no strip to hand the voice to and this line keeps it.
				 *
				 * AND IT YIELDS TO THE COMPATIBILITY BANNER (QA round 2, Q-3). In the
				 * states the strip is silent for - the four pairing causes the banner
				 * carries - this line was the second statement of one incident: measured
				 * in the successor walk, where the banner's sentence stood alone in the
				 * pane and this foot line still said "did not answer this request" with
				 * its own `Retry refresh` beneath it (44 of 51 samples, including the
				 * last). The banner is the one voice for those causes everywhere the
				 * sidebar is drawn, and `coveredByCompatibilityBanner` is the same
				 * predicate the capability paragraph above reads.
				 */}
				{(error || profiles.error || teams.error) &&
					!stripSpeaksConnection &&
					!coveredByCompatibilityBanner && (
						<div className="pt-2 text-meta text-ink-muted">
							<p>{error || profiles.error?.message || teams.error?.message}</p>
							<button
								type="button"
								className="mt-1 underline"
								onClick={() => {
									void refreshCatalogue();
									void profiles.refetch();
									void teams.refetch();
								}}
							>
								Retry refresh
							</button>
						</div>
					)}
			</TooltipProvider>
		</nav>
	);
}
