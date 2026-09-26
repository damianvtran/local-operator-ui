import { InstallBuiltinAgents } from "@features/agents/components/install-builtin-agents";
import { compatibilityBannerShown } from "@shared/api/local-operator/backend-error";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { useChatSearch } from "@shared/api/local-operator/session-search";
import { ThemedToastContainer } from "@shared/components/common/themed-toast-container";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
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
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import {
	dismissToast,
	showInfoToast,
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import {
	Archive,
	ArchiveRestore,
	Bot,
	CheckCheck,
	ChevronDown,
	ChevronRight,
	FileText,
	FolderPlus,
	LoaderCircle,
	type LucideIcon,
	MessageSquarePlus,
	MoreHorizontal,
	Pin,
	Plus,
	Search,
	SlidersHorizontal,
	UserPlus,
	Users,
	X,
} from "lucide-react";
import {
	type CSSProperties,
	type KeyboardEvent,
	type FocusEvent as ReactFocusEvent,
	type ReactNode,
	type Ref,
	createElement,
	useCallback,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { SESSION_SEARCH_MAX_CHARS } from "../../../../../shared/desktop-contract";
import {
	ARCHIVE_OFFERED_VERB,
	archiveOfferedName,
	useArchiveUndoRetirement,
} from "../archive-undo";
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
	CHAT_REGION_ENTRY_ATTR,
	chatRowAct,
	chatRowActControl,
} from "../chat-regions";
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
import {
	DEFAULT_SIDEBAR_VIEW,
	SIDEBAR_SECTION_ROWS,
	type SidebarSectionKey,
	groupRows,
	isEntitySection,
	isSectionShown,
	pageLimit,
	pageMoreLabel,
	pageOrder,
	pageRows,
	parseSidebarView,
	shownSections,
} from "../chat-sidebar-view";
import { useStripSpeaksConnection } from "../chat-status-presence";
import { clearSearch } from "../clear-search";
import { untargetedDraftRows } from "../draft-rows";
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
import { ChatRowTitle } from "./chat-row-title";
import { ChatSidebarViewMenu } from "./chat-sidebar-view-menu";

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

/*
 * THE ARCHIVE OFFER'S TOAST CADENCE AND ITS LANE.
 *
 * `archive-undo.ts` owns the sentence the offer makes and the rule that retires it;
 * these four are the sidebar's, because the sidebar is the surface the archive was
 * performed from and the lane is its own box (design D11).
 *
 * ONE ID FOR THE TWO MESSAGES THE PANEL PUTS IN ITS OWN LANE, so the newest REPLACES
 * the one before it rather than stacking under it.
 *
 * The design's rule is the spec's ("stable toast ids so a second archive replaces the
 * first", `docs/design/sidebar-row-space.md` §10), and it is read here at the width the
 * lane actually has rather than as one-id-per-kind: the lane is the panel's own box
 * (216px of toast inside a 280px column), and sonner stacks a second toast by offsetting
 * it against the first's height - measured, 2026-09-21, in the dark palette: a refusal
 * raised while the offer was still up landed at y 844..1014 in an 868px viewport, i.e.
 * `hitTest:false` and `inViewport:false`, and the frame of it was not a still. The lane
 * is a lane, not a stack: a refusal replaces the offer it belongs to, and an offer
 * replaces a refusal - which is also the honest reading of the store's single-value
 * model, because only one of those two facts is ever the panel's latest word.
 */
const ARCHIVE_TOAST_ID = "archive";
/**
 * The receipt announcement's own lane id, and it is STABLE ON PURPOSE.
 *
 * A toast is a claim about the state it was raised in, and this one is the only
 * sentence in the panel the app itself can falsify: the reader presses the row it
 * names, the receipt lands on the next tick, the mark clears - and the sentence kept
 * telling them to press for the rest of its life (UX round 2, U4). The archive lane
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
 * THE LANE'S OWN `position`, and it is NOT what keeps this message out of the other
 * container - the comment here used to claim the opposite, and R-4 of agent review
 * round 1 refuted it against the installed sonner 2.0.3. What the library does with
 * a positioned toast is draw it in EVERY mounted container (the reading and the
 * mechanism are written out in `styles/index.css` beside the two rules that narrow it),
 * so the confinement is the app's own: the marker class below, scoped to this panel.
 * The constraint survives in the other direction - nothing else in the app publishes a
 * toast with this `position`, because the panel's rules key on the class rather than on
 * the position and a second use of the spelling would only invite the assumption back.
 *
 * A SECOND, HARDER PROPERTY LIVES IN THIS ID: `chat-sidebar.tsx`'s lane draws both of
 * its messages under it, so a message that follows a dismissal of the id can be lost to
 * the dismissal if it lands inside sonner's unmount window. The app avoids that by
 * REPLACING rather than dismissing (see the two lane effects and the store's press), and
 * the measured mechanism is recorded there.
 */
const ARCHIVE_TOAST_LANE = "bottom-left";
/**
 * Long enough to read the sentence and reach for it - sonner's 4000ms default is
 * short for an Undo - and the refusal is longer because it carries a Retry the
 * reader has to read before pressing.
 *
 * THE PANEL ARMS THESE, NOT SONNER (agent review round 2 - the re-assertion).
 * sonner's life belongs to the ENTRY: `remainingTime` is a ref inside its toast
 * component whose only reset is a CHANGED `duration`
 * (`node_modules/sonner/dist/index.mjs`), so a message RE-ASSERTED by an answer - the
 * refusal a refused Retry puts back - inherited the clock of the message it replaced
 * and disappeared seconds later, with nothing left to redraw it, because the store's
 * refusal had not changed. Measured in the `session-archive` scene before the fix: dark
 * 5068ms / light 5096ms after the press, `painted false` while the store still held the
 * refusal. The life belongs to the MESSAGE, so the panel runs the clock (the lane's
 * second effect) and sonner is told never to expire an entry.
 */
const ARCHIVE_UNDO_TOAST_MS = 8_000;
const ARCHIVE_FAILURE_TOAST_MS = 10_000;
/**
 * What the lane tells sonner, so it never ends a message on its own: the entry stays
 * mounted until the panel's clock fires or a state change dismisses it.
 *
 * Stated cost, because it is a real one: sonner's hover-pause no longer applies - a
 * reader hovering the message cannot hold it past its life - since sonner is no longer
 * what ends it. That is the trade for a life that re-arms on every re-assertion, which
 * is the property the lane needs and the library cannot express on a mounted entry.
 */
const ARCHIVE_TOAST_PERSISTENT = Number.POSITIVE_INFINITY;
/**
 * The class BOTH archive toasts carry, and the one hook the panel's lane rules read
 * (`styles/index.css`). It exists because sonner draws every mounted container's copy
 * of every toast: the marker is what tells the stylesheet which toast belongs in the
 * panel's lane and which are the global container's duplicates.
 */
const ARCHIVE_TOAST_CLASS = "lo-archive-toast";
/**
 * The gap the band keeps under its card, in px: one unit of the panel's own rhythm, and the
 * slack that keeps a card flush against nothing.
 */
const ARCHIVE_TOAST_BAND_GAP = 8;
/**
 * THE OFFER'S BAND, DECLARED (design round 9, D30's second clause) - and it is declared because it
 * has to be KNOWN in the commit that raises the offer.
 *
 * The band's measured height is panel state written by the observer below, and the observer can only
 * see the card once sonner has mounted it - a render of its own, after the commit that raises the
 * offer. So on an ACCEPTED archive the commit that takes the pressed row's height out of the list is
 * also the commit in which the measured band is still 0: the extent falls by the row while the box is
 * still the band-0 one, `scrollHeight - clientHeight` falls under the reader's position, and the
 * browser's clamp takes it. MEASURED at 1380x900 on a list capped to 200px with a reader on 20: the
 * extent `241 -> 209` against a `199` box, and `scrollTop` `20 -> 10.5` in the first frame the sampler
 * saw - with the write trap EMPTY, so it is the clamp and not the focus-hold.
 *
 * The offer is ONE LINE AT EVERY WIDTH (its name truncates), which is what makes a constant honest
 * here - and it is not a second source of truth: the measurement replaces it the moment the card lands
 * (`58` again, the card's 50 plus the gap). The REFUSAL is deliberately NOT covered, because its
 * height is the daemon's own sentence and only the card knows it.
 */
const ARCHIVE_OFFER_BAND_HEIGHT = 58;

/**
 * THE BAND'S OWN BOX (design round 4, D14) - the lane is no longer an overlay.
 *
 * It was `position: absolute` on sonner's container, which drew the card OVER the list and was
 * the whole subject of three independent findings (Q-1 through four streams on one selector,
 * Q-2 from QA's press loop, D11 from the design round): a dead zone over the three or four rows
 * the card covered, and - measured, not inferred - the offer's own Undo button sitting exactly
 * over the archive control of the row beneath it, so a real press there wrote NOTHING at all.
 * The designer's ruling settled the shape with measurements rather than taste: the acts column
 * is the row's last 52px and the card is 8px wider than the row, so there is no offset that
 * clears it - a control under a card cannot be aimed at, whatever the card does with presses.
 *
 * SO THE CARD TAKES ITS OWN HEIGHT OUT OF THE COLUMN INSTEAD. The container is the panel flex
 * column's LAST CHILD - it already was, which is why this is a change of one declaration plus a
 * height - so as a band it gives the list back nothing at rest (`height: 0`) and exactly
 * `card + 8` while a message stands, and the ROWS DO NOT MOVE: the list is `flex-1`, so what
 * yields is its bottom (an empty tail in a short list, formerly-hidden bottom rows when it
 * overflows) with `scrollTop` untouched. That is the trade the ruling records and accepts:
 * 58px of list viewport for the offer's eight seconds, or the refusal's height plus eight for
 * its ten, spent when the list is already rearranging - against a wrong write or a dead control
 * on every archive made while a message stood.
 *
 * `position: relative` IS THE CARD'S CONTAINING BLOCK, not decoration: sonner draws its toast
 * `position: absolute` with `left: 0; right: 0`, so the band has to be the positioned ancestor
 * for the card to be the band's width rather than the panel's - which is what keeps D10's
 * reading true (``--width: min(248px, 100%)`` resolves against this box, and it measured 248 of
 * a 248 lane at 280 and 208 of a 208 lane at 240). `overflow: hidden` is what makes `height: 0`
 * mean INVISIBLE rather than merely out of flow, and it is also what clips the card against
 * `max-height` - the ceiling the ruling names, so a pathological message cannot push the list
 * out of the panel entirely.
 *
 * NO TRANSITION, and that is the ruling's own word: the band's height snaps with the message
 * that causes it, because a band that animated would move rows under the reader's pointer for
 * the length of the animation - the very class of defect this change removes.
 */
const ARCHIVE_TOAST_BAND_STYLE: CSSProperties = {
	position: "relative",
	width: "100%",
	flexShrink: 0,
	overflow: "hidden",
	maxHeight: "calc(100% - 56px)",
	"--width": "min(248px, 100%)",
} as CSSProperties;

/**
 * The container statement, which is now only about the CARD: the band is the positioned
 * ancestor (`ARCHIVE_TOAST_BAND_STYLE`), so sonner's own `position: fixed` has to be beaten
 * here or every card would be laid out against the viewport again.
 */
const ARCHIVE_TOAST_CONTAINER_STYLE: CSSProperties = {
	position: "static",
	width: "100%",
} as CSSProperties;

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

import {
	type FocusedSlot,
	holdFocusedRow,
	refreshFocusedInside,
} from "../sidebar-focus-hold";

import { ChatSessionStatus } from "./chat-session-status";

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
 * Focus the row that takes the place of a row that is about to leave the list.
 *
 * WHY THIS EXISTS: activating a row's archive control unmounts the control AND its
 * row, so the browser's own focus handling drops the reader on `<body>` - the next
 * Tab restarts at the top of the document, twelve stops from where they were (UX
 * round 1, U5, and the same class of defect as U9 in the dialog). The app's
 * discipline elsewhere is to hand focus to whatever took the place of the focused
 * control; in a list, that is the row that slides up into the gap.
 *
 * Read from the DOM rather than from the list model on purpose: a row's position
 * in the model is a section, a search result set or a group, which this handler
 * cannot index, while the document order of `[data-chat-row]` IS the order the
 * reader sees. The snapshot is taken at the press and filtered to what is still
 * connected when the callback runs, so it is correct whether or not React has
 * committed the removal yet: before the commit the pressed row is still connected
 * and the successor is the element after it; after it the pressed row is gone and
 * the first survivor past its index is that same element.
 *
 * Returns a callback rather than moving focus itself, because the caller only
 * wants it moved when the write was ACCEPTED - a refused press leaves the row (and
 * the reader) exactly where they were.
 */
function focusRowAfterRemoval(pressed: HTMLElement): () => void {
	const rows = Array.from(
		document.querySelectorAll<HTMLElement>("[data-chat-row]"),
	);
	const rowButton =
		pressed.parentElement?.querySelector<HTMLElement>("[data-chat-row]") ??
		null;
	const index = rowButton ? rows.indexOf(rowButton) : -1;
	return () => {
		const live = rows
			.map((element, position) => ({ element, position }))
			.filter(({ element }) => element.isConnected);
		const successor =
			live.find(({ position }) => position > index)?.element ??
			live.filter(({ position }) => position < index).at(-1)?.element;
		successor?.focus();
	};
}

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
	const capabilities = useDesktopCapabilities();
	const feed = useDesktopFeed();
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
		coveredByCompatibilityBanner: compatibilityBannerShown(
			capabilities.data,
			pairingCause,
		),
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
	 * the section below reads it three times and they have to agree: the empty
	 * state is also what makes the batch's control a primary button rather than
	 * the quiet row. See the section itself for why one reading matters (QA round
	 * 1, Q1).
	 */
	const agentsEmpty = !profiles.isLoading && ownAgents.length === 0;
	const teams = useTeams(
		ready && desktopFeatureEnabled(capabilities.data, "team_catalogue"),
	);
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
		 * ONE ARM ANNOUNCES ITSELF AND THE OTHER TWO DO NOT. `unsettled` is the state
		 * the reader is owed a sentence about - the app has stopped retrying promptly
		 * and the mark is still there - and it is the arm the bulk path already says
		 * in this lane. `pending` is an in-flight cue, and `offscreen` is a remedy
		 * whose move is to look at the row's own clause: a toast for either would be
		 * noise where the reader has the fact already, and the lane is shared with the
		 * bulk receipt and the archive offers.
		 */
		if (readAckNotice?.kind !== "unsettled") {
			// The fact the sentence stated has gone (the receipt landed, the loop was
			// torn down, another kind replaced it), so the sentence goes with it. By the
			// LANE'S id rather than a handle: this instance may not be the one that
			// raised it, and dismissing an id nothing is using is a no-op either way.
			dismissToast(READ_ACK_TOAST_ID);
			return;
		}
		// The same statement seen again is not a second event; a NEW one replaces the
		// sentence on screen rather than stacking a second copy of the same fact.
		if (!changed) return;
		/*
		 * THE LANE'S OWN LIFETIME, not sonner's four-second default (design round 1,
		 * D3). This arm is a sentence plus a remedy the reader has to read before
		 * acting - the same shape as the archive failure's, which is why it takes that
		 * lane's number: at the default, a two-line sentence was being read in four
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
	 * sidebar's one visible search is the `Search ⌘K` row above (the palette), and
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
	 * rather than trusted from the store, for the reason
	 * `chatSidebarListHeight` is passed as it was read: `localStorage` is not the
	 * setter's path out, so the module is the one place a tampered value is
	 * rejected and the one place a future field arrives with an answer.
	 */
	const chatSidebarView = useUiPreferencesStore(
		(state) => state.chatSidebarView,
	);
	const setChatSidebarView = useUiPreferencesStore(
		(state) => state.setChatSidebarView,
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
	} | null>(null);
	const rememberMovedRow = (
		sessionId: string,
		follow: boolean,
		pointer: { x: number; y: number } | null,
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
			anchorId: neighbour?.getAttribute("data-session-row") ?? null,
			anchorTop: neighbour ? neighbour.getBoundingClientRect().top : 0,
		};
	};
	/*
	 * This runs after every render and clears itself; the guard IS the state it waits on. (The
	 * `useExhaustiveDependencies` suppression that stood here became unused once the band's own height
	 * was derived for the yield - `bandHeightNow` - and Biome reports an unused suppression as an error,
	 * so the reason stays and the directive goes.)
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
			const delta = row.getBoundingClientRect().top - moved.top;
			if (delta !== 0) list.scrollTop += delta;
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
			const target =
				pin !== null && pin.getBoundingClientRect().width > 0
					? pin
					: row.querySelector<HTMLElement>("[data-chat-row]");
			target?.focus({ preventScroll: true });
		} else if (moved.anchorId !== null) {
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
	const toggle = (key: string, initial = false) =>
		setExpanded((current) => ({
			...current,
			[key]: !(current[key] ?? initial),
		}));
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
			 */
			showWarningToast(
				`${userFacingMessage(failure, "The backend did not answer.")} The unread marks were not cleared.`,
			);
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
				 */
				listPanelRef.current
					?.querySelector<HTMLElement>("[data-chat-row]")
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
		// `feed.catalogueRevision` is a DEPENDENCY so each invalidation re-runs this
		// effect body once — exactly one refetch per `catalogue` frame, with the
		// safety timer restarted from the event rather than from a clock. It is
		// deliberately not READ in the body: the revision's only job is to be the
		// trigger, which is what the suppression on the hook itself covers.
	}, [ready, refreshCatalogue, feed.available, feed.catalogueRevision]);
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
	const archiveFailure = useCanonicalSessionsStore((s) => s.archiveFailure);
	const archiveUndo = useCanonicalSessionsStore((s) => s.archiveUndo);
	/*
	 * THE OFFER'S OWN RETIREMENT WATCH (design round 8, D27). The offer is RAISED by the store
	 * now - in the update that settles the write, so the accepted departure and the band that
	 * answers it are one commit - and what stays with the offer's module is WHEN it stops being
	 * true. One call, keyed on the offer's identity, so a second archive in a row re-arms it.
	 */
	useArchiveUndoRetirement();
	/*
	 * BOTH LANE MESSAGES' OWN WRITES, because the panel is what decides which message the lane
	 * shows and therefore when a message's turn is over - and a value that outlives its message
	 * is U10 (the two uses are beside the drawing effect's currency rule and in its clock).
	 * `setArchiveUndo` is normally the offer's own module's (`archive-undo.ts` owns WHEN the
	 * offer is retired by the conversation's state); the clock needs it for the other end of the
	 * same life - a message that expired unread.
	 */
	const clearArchiveFailure = useCanonicalSessionsStore(
		(s) => s.clearArchiveFailure,
	);
	const setArchiveUndo = useCanonicalSessionsStore((s) => s.setArchiveUndo);
	/*
	 * WHAT THE LANE LAST DREW, and its stamp: the clearing rule below needs BOTH - which message
	 * the reader was last looking at, and whether the one that replaces it outranks it - because
	 * clearing on the ordering alone removed a refusal while its own card was still up.
	 */
	const laneDrawnRef = useRef<{ kind: "offer" | "failure"; at: number } | null>(
		null,
	);
	const setSessionArchived = useCanonicalSessionsStore(
		(s) => s.setSessionArchived,
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
		() => visibleRows(answeredForMembership, archiveEnabled && !widened),
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
			),
		[listed, heldRows, query, hits, pinFactValues, archiveView, bindingOfHit],
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
	const draftRows = useMemo(
		() => untargetedDraftRows(drafts, inputByConversation),
		[drafts, inputByConversation],
	);
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
	 */
	const viewIsCustom =
		view.groupBy !== DEFAULT_SIDEBAR_VIEW.groupBy ||
		view.orderBy !== DEFAULT_SIDEBAR_VIEW.orderBy ||
		view.hidden.length > 0 ||
		view.loads > 0 ||
		view.order.some((key, index) => key !== DEFAULT_SIDEBAR_VIEW.order[index]);
	/*
	 * §C1's sections over the loaded page (`chat-list-sections.ts` carries the
	 * rules), the sections the popover has switched OFF removed, and the rest in
	 * the reader's own order - `shownSections` is that order, and it is the same
	 * one the region boundary's arrows write to.
	 */
	const sectioned = sectionRows(pagedRows, listNow);
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
		return ` (${name})`;
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
		);
	}, [
		answered,
		search.data,
		listed,
		heldRows,
		pinFactValues,
		archiveView,
		bindingOfHit,
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
	// would make the list lie — but an unfinished draft still holding its id is
	// proof it never carried a message, so say so instead of showing it as an
	// ordinary untitled chat.
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
		 * registers the two channels need.
		 */
		const readAck = readAckCopy(readAckNotice, row.session_id);
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
		 * (`group-hover`/`group-focus-within` on the two acts), and a hook an element
		 * reads is the only kind worth carrying. The `w-full` -> `min-w-0 grow` note on
		 * the button below is main's and still holds: a full-width button sharing a flex
		 * row with a sibling is a row that overflows.
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
					 * THE RECEIPT'S CLAUSE CLOSES THE LINE, after the flags rather than among
					 * them: the flags are what the row IS and this is what the app is DOING
					 * about the mark on it, so it reads as the actionable last word - the slot
					 * `SILENT_REMEDY` occupies one fact up.
					 */}
					{readAck ? ` · ${readAck.clause}` : ""}
				</span>
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
				 */
				{...(silent || readAck
					? {
							"aria-describedby": [
								silent ? silentRemedyId(row.session_id) : null,
								readAck ? readAckClauseId(row.session_id) : null,
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
					onSelectConversation(row.session_id);
				}}
			>
				<ChatSessionStatus row={row} />
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
				{/* In a flat list nothing else names the profile answering, so two
			    untitled chats on different agents were indistinguishable. Nested
			    rows already inherit the identity from their parent, and a row that
			    has something more important to say (the paragraph above) says that
			    instead. The row's flyout carries the binding in every case, so the
			    accessible description is never narrower than the pixels. */}
				{trailing === "team" && (
					/* THE TEAM THE WORKSTREAM SERVES — what replaced the constant
					   `· agent-opened` (operator ask, 2026-09-25; `rowTrailingStatement`
					   records the policy and its why). Drawn with the SAME bounded,
					   truncating treatment as the binding slot below: the team is
					   user-authored text whose field accepts 64 characters, so it needs
					   the cap and the clip that slot measured (review round 4, R21), not
					   the fixed-literal treatment the marker had.

					   NOT `aria-hidden`, deliberately: the marker could hide its constant
					   words behind the `sr-only` sentence, but the team is a drawn name and
					   the accessible name must never be narrower than the pixels — a reader
					   who cannot see the row hears the team with the rest of the row's
					   sentence. The attribution sentence still renders where the marker's
					   did (the `sr-only` block at the end of this group), so a row the
					   marker used to speak for still says ", opened by coder" — and a
					   marked or unstarted one reads exactly as before. */
					<span className="ml-1 max-w-[45%] shrink-0 truncate text-meta text-ink-muted">
						· {teamName(row)}
					</span>
				)}
				{trailing === "binding" && (
					/* Bounded, like the team slot above and unlike the two literals
					   below. `bindingName` is a user-authored agent or team name and the
					   agent-name field
					   accepts 64 characters, so `shrink-0` with no `truncate` left an
					   UNBOUNDED slot: the title (floor of zero) absorbed all of it,
					   which restored round 4's D18 at roughly 35 characters and
					   overflowed the row at roughly 45 — reachable from the product's
					   own input limit, with no dragging involved (review round 4,
					   R21). The cap is a share of the row rather than a fixed width so
					   it scales with the panel, and `truncate` clips inside it. The
					   two literals are `shrink-0`: they cannot grow, so they cannot
					   starve anything. */
					<span className="ml-1 max-w-[45%] shrink-0 truncate text-meta text-ink-muted">
						· {bindingName(row)}
					</span>
				)}
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
				 * THE RELATIVE TIME (§C1): right-aligned `text-mono-sm` in `ink-dim`, the
				 * row's last element. It is NOT one of `rowTrailingStatement`'s
				 * statements - that slot is for why a row is on screen, and this is a
				 * fact every resting row carries - so it sits after it and never
				 * competes for it. A RUNNING row prints none (its time is "now", which
				 * the spinner already says), and it gives way to the per-row acts under
				 * the pointer (`group-hover:hidden`) so revealing Pin/Archive costs the
				 * title nothing.
				 *
				 * The visible `2h` is `aria-hidden` and the sentence (`2 hours ago`) is
				 * read after the title, so the row's name stays `state — title` with the
				 * time as its tail (U21).
				 */}
				{!isRunningRow(row) && relativeTime(row, listNow) && (
					<>
						<span
							aria-hidden="true"
							data-session-time
							className="ml-auto shrink-0 pl-2 font-mono text-ink-dim text-mono-sm tabular-nums group-focus-within:hidden group-hover:hidden"
						>
							{relativeTime(row, listNow)}
						</span>
						<span className="sr-only">
							, {relativeTimeSentence(row, listNow)}
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
		const controls = (
			<>
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
						 * `group-focus-within`, which is what made this control a Tab stop AND the
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
										 * it is the hover target: `group-hover`/`group-focus-within` reveal the
										 * control, and the same two states are what make it operable.
										 */
										"group-hover:flex group-hover:text-ink-muted group-focus-within:flex group-focus-within:text-ink-muted",
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
				 * translates here. `group-focus-within` is what makes it reachable by keyboard:
				 * pressing Tab into the row's button reveals it, and the next Tab lands on it.
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
							 * A dropped press changes nothing at all.
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
							 * Snapshot the successor BEFORE the press, because the press removes the
							 * row: `event.currentTarget` is not readable after an await, and the
							 * document order at press time is the order the user sees.
							 */
							const restoreFocus = focusRowAfterRemoval(event.currentTarget);
							void setSessionArchived(
								row.session_id,
								!archived,
								row.title ?? undefined,
							).then((accepted) => {
								/*
								 * A REFUSED PRESS MOVES NOTHING, focus included: the row is still
								 * there and the reader is still on the control they pressed, with
								 * the store's refusal sentence in the panel's own toast lane (design
								 * D11 - it was a register at the panel's root before that, and the
								 * register is deleted rather than kept beside it).
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
							 * focus inside the row. `display: none` replaces the old `opacity-0` +
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
								"group-hover:flex group-hover:text-ink-muted",
								"group-focus-within:flex group-focus-within:text-ink-muted",
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
							 * `ink-muted`. The `!` is load-bearing: `group-hover:text-ink-muted`
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

		return withFlyout(
			<div
				/* The row's own box, and the hook the current-row ground is asserted
				   through (`chat-sidebar-selection.test.mjs`'s CURRENT table). */
				data-session-row={row.session_id}
				onBlur={keepFlyoutWhileFocusStaysInRow}
				className={cn(
					// Carried while EITHER per-row control is mounted, because both reveal
					// themselves through `group-hover`/`group-focus-within` on it, and absent
					// when neither is - which is what keeps the fully withdrawn panel's class
					// list the one it had before either feature existed.
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
					rowBoxStyle,
					current && rowCurrent,
				)}
			>
				{rowButton}
				{silentRemedy}
				{readAckRemedy}
				{/*
				 * THE PAIR. Both acts are siblings of the row's button, never children, and both
				 * are absent from the layout until the pointer or the keyboard is inside the row
				 * (`display`, not `opacity`): at rest a row's title has the whole row, and the two
				 * acts take 56px of it under the pointer, which is what the title's pan exists to
				 * answer (`docs/design/sidebar-row-space.md`, D2 and D3).
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
							pinned
								? "flex"
								: "hidden group-hover:flex group-focus-within:flex",
						)}
					>
						{controls}
					</div>
				) : (
					controls
				)}
			</div>,
			row.session_id,
		);
	};
	const entity = (kind: ChatTarget["kind"], name: string) => {
		const rows = scopeRows(kind, name);
		const key = catalogueScopeKey(kind, name);
		const open = Boolean(query) || isOpen(key);
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
		if (
			query &&
			!name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) &&
			!rows.length
		)
			return null;
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
						aria-label={`${open ? "Collapse" : "Expand"} ${name} chats`}
						aria-expanded={open}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md",
							!staged && "hover:bg-row-hover",
						)}
						onClick={() => toggle(key)}
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
						aria-label={`New chat with ${name}`}
						title={`New chat with ${name}`}
					>
						<Icon className="size-4 shrink-0" />
						<span className="min-w-0 flex-1 truncate">{name}</span>
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
					<button
						type="button"
						// Stepped down from `ink` so the row's own action outranks it.
						// This is the secondary control on the row and it is visible at
						// rest, which was enough to make it dominate the reveal.
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md text-ink-dim hover:text-ink-muted",
							!staged && "hover:bg-row-hover",
						)}
						aria-label={`Manage ${name}`}
						onClick={() =>
							navigate(`/agents?kind=${kind}&name=${encodeURIComponent(name)}`)
						}
					>
						<MoreHorizontal className="size-4" />
					</button>
				</div>
				{open && (
					<div>
						{rows.map((row) => sessionRow(row, true))}
						{/*
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
							) : view.more ? (
								<button
									type="button"
									/*
									 * A DRIVER ANCHOR, on the convention `data-chat-section` and
									 * `data-session-delete` already follow: the label is a copy string, so a
									 * scene that reached this control by its text would be asserting a copy
									 * edit, and the tail's own press is what the evidence frame has to make.
									 *
									 * `data-chat-row` IS THE KEYBOARD PATH (round 1, U2). The control sits at
									 * the end of the group's own rows, so reaching it by Tab means passing
									 * every one of them - but the region's arrow-key traversal walks
									 * `[data-chat-row]` elements and focuses them, so joining that set puts the
									 * press one ArrowDown from the group's last row.
									 */
									data-scope-more={key}
									data-chat-row
									aria-label={`Show ${view.addCount} more chats in ${name}`}
									title={`Show ${view.addCount} more chats in ${name}`}
									className="block w-full py-1 pl-7 text-left text-meta text-ink-dim underline hover:text-ink"
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
									{/*
									 * WHAT THE PRESS WILL ADD, not the page size (round 1, D7): with 45
									 * still to come beside a 70 badge, `Show 25 more` was a page size
									 * dressed as a remainder.
									 */}
									{`Show ${view.addCount} more`}
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
	) => (
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
			{action}
		</div>
	);
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
	const cappedRows = (key: string, rows: ReactNode[]) => {
		const cap = sectionCaps[key] ?? SIDEBAR_SECTION_ROWS;
		const hidden = rows.length - cap;
		return (
			<>
				{rows.slice(0, cap)}
				{hidden > 0 && (
					<button
						type="button"
						data-sidebar-section-more={key}
						onClick={() =>
							setSectionCaps((previous) => ({
								...previous,
								[key]:
									(previous[key] ?? SIDEBAR_SECTION_ROWS) +
									SIDEBAR_SECTION_ROWS,
							}))
						}
						className="flex h-7 w-full items-center rounded-md px-2 text-left text-body-sm text-ink-muted transition-colors duration-fast ease-out-quart hover:bg-row-hover hover:text-ink"
					>
						{hidden === 1 ? "Show 1 more" : `Show ${hidden} more`}
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
	 * row's acts beside it were too — they are revealed by `group-focus-within`, and
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
		const rows = [...nav.querySelectorAll<HTMLElement>("[data-chat-row]")];
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
		for (const row of rows) {
			row.tabIndex = row === target ? 0 : -1;
			/*
			 * AND IT IS THE REGION'S DOOR TOO. `F6` into the sidebar should land on the
			 * row the reader was on, not on the panel's box: the stop is exactly "the row
			 * this reader is on", so saying it twice in two attributes is how the walk and
			 * the ring start disagreeing. `[data-region-entry]` is what `enterChatRegion`
			 * reads, and the roving stop is the only thing that writes it here.
			 */
			row.toggleAttribute(CHAT_REGION_ENTRY_ATTR, row === target);
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
	const keyDown = (event: KeyboardEvent<HTMLElement>) => {
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
		if (target.tagName === "INPUT") {
			/*
			 * ↓ ENTERS THE RESULTS, which is the command palette's own model applied
			 * to the one other list in this column (U15). Without it the field was a
			 * trap for a keyboard user: the list below it was reachable only by Tab,
			 * and the field's own notice said nothing about how to get there.
			 */
			if (event.key === "ArrowDown") {
				const first =
					event.currentTarget.querySelector<HTMLElement>("[data-chat-row]");
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
				const first =
					event.currentTarget.querySelector<HTMLElement>("[data-chat-row]");
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
		const rows = [
			...event.currentTarget.querySelectorAll<HTMLElement>("[data-chat-row]"),
		];
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
			 * NO `role="alert"` HERE EITHER: the strip owns the one live region for
			 * connection state (branding § 9's one register for the status slot), and a
			 * second live region about one fact is the defect this exists to remove. The
			 * word is the foot's own "Retry refresh" - the strip's one "Retry" is
			 * re-negotiation, and a screen cannot offer two verbs for one re-read.
			 */}
			{capabilities.error && !stripSpeaksConnection && (
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
			{showList && (
				<div className="space-y-4 pb-2">
					<section>
						{heading("agents", "Agents", true, undefined, Bot)}
						{(query || isOpen("agents", true)) && (
							<>
								{profiles.isLoading && (
									<p aria-live="polite" className="text-meta text-ink-dim">
										Loading agents…
									</p>
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
								 */}
								<div
									className={cn(
										agentsEmpty ? "flex flex-col gap-2 px-3 py-2" : "contents",
									)}
									data-testid={agentsEmpty ? "agents-sidebar-empty" : undefined}
								>
									<div className="contents">
										{agentsEmpty ? (
											<>
												<p className="text-body-sm text-ink">No agents yet</p>
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
										) : (
											cappedRows(
												"agents",
												ownAgents.map((profile) =>
													entity("agent", profile.name),
												),
											)
										)}
									</div>
									{/* Renders nothing once every built-in is installed. */}
									<InstallBuiltinAgents
										builtins={availableBuiltins}
										presentation={agentsEmpty ? "primary" : "row"}
									/>
								</div>
								<button
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
					<section>
						{heading("teams", "Teams", true, undefined, Users)}
						{(query || isOpen("teams", true)) && (
							<>
								{teams.isLoading && (
									<p aria-live="polite" className="text-meta text-ink-dim">
										Loading teams…
									</p>
								)}
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
	/*
	 * THE ARCHIVE OFFER MOVES TO THE SIDEBAR'S OWN TOAST LANE (design D11, in
	 * `docs/design/sidebar-row-space.md`), and the register this replaces is
	 * DELETED rather than kept beside it.
	 *
	 * WHY THE REGISTER WENT, measured rather than argued: the offer was a 264x25.4px
	 * line whose top sat at y 493.6 - 8px above the split line and 117px above the
	 * first row of the list it is about - because it was positioned by the flex
	 * column between the two regions rather than by the list. That is the operator's
	 * "weird awkward spot in the sidebar with a gap below it", and the placement rule
	 * is the reason: it moved with the split and with the region above it.
	 *
	 * WHY THE LANE IS THE SIDEBAR'S AND NOT THE VIEWPORT'S CORNER, which is the half
	 * design round 2's D12 found the hard way: a toast in the bottom-right corner
	 * spanned x 1001..1360.5, y 789..842.5 in both palettes and landed exactly on the
	 * Send control at x 1307..1339, y 803..835 - an offer to take an action back that
	 * could send a message. Both of D12's constraints are now met STRUCTURALLY:
	 *
	 *  - it cannot reach the composer's controls, because the two are siblings in one
	 *    flex row and the chat column begins where the sidebar ends (the sidebar's
	 *    outer box is x 220..500 at the default panel width and the composer's form
	 *    starts at x 524 - the chat column's own padding is the whole gap). The lane
	 *    is the panel's own box, capped to its content width, so it is confined to a
	 *    column the composer is never in, at any panel width and any composer height.
	 *    `renderer-driver.mjs`'s `row-space` scene asserts the measured boxes rather
	 *    than this sentence: the offer's box is inside the panel's, and disjoint from
	 *    the composer's form.
	 *  - and it sits on the surface that performed the action, because the archive is
	 *    performed from the sidebar and the offer appears in the sidebar. That was the
	 *    half a corner toast could not have.
	 *
	 * THE RETIREMENT RULE IS UNCHANGED, only re-spelled, and it now waits for the ANSWER
	 * it is a rule about: the offer stands while the conversation still holds the state the
	 * offer was taken from (`undoOfferStands`, in `chat-archived.ts`), the store clears
	 * `archiveUndo` when it knows it does not, and the effect below takes the toast down
	 * through `dismissToast`. A press whose own fact is still unanswered decides nothing
	 * (`ArchiveFact.answered` in `canonical-sessions-store.ts`), because that fact is
	 * written optimistically and the ANSWER is what the lane is about - without the gate a
	 * refusal replaces a message the press had already dismissed, which is R2-1.
	 *
	 * ONE ID FOR BOTH KINDS, `ARCHIVE_TOAST_ID`, so a second message REPLACES the first
	 * rather than stacking - which matches the store's single-value model
	 * (`archiveUndo`/`archiveFailure`). Spec §10 said one id per kind and the
	 * implementation deliberately did not: the id is the whole mechanism of "one
	 * message at a time" here, because the second message arrives as an update of the
	 * mounted toast. The spec now says what ships (agent review round 1, R-5).
	 * The consequence is stated rather than hidden: only the most recent offer is
	 * pressable, and an older restore is still reachable where it always was - the
	 * row's own Unarchive control, the header's Archived pill, and `/unarchive`.
	 *
	 * AND REPLACEMENT IS NOT ONLY TIDIER THAN DISMISS-THEN-SHOW, IT IS REQUIRED: a
	 * message created on this id inside sonner's own unmount window (a dismissal's
	 * `requestAnimationFrame` plus its 200ms delay) is destroyed with the entry being
	 * removed, which is how the retry's refusal used to vanish (UX report round 1, U3;
	 * the measurement is beside the Retry action below and in the store's press).
	 * Nothing in the lane dismisses a message it is about to replace.
	 *
	 * The refusals keep their `warning` register and their Retry, at the durations
	 * `ARCHIVE_*_TOAST_MS` names, and neither toast carries `role="alert"`: what
	 * announces a refusal is the row coming back with its control in the state the
	 * user left it.
	 *
	 * NOTHING IS DISMISSED ON MOUNT, and that is a fact about the toast library rather
	 * than a nicety. Sonner's `dismiss` reaches a bare `requestAnimationFrame`, so a
	 * dismiss on every mount of this panel is a call with no toast behind it - and in
	 * a DOM without `requestAnimationFrame` at all, which is the jsdom the sidebar's
	 * own tests mount in, it is a `ReferenceError` thrown from a passive effect that
	 * takes the whole panel down with it. The ref below is what makes that possible: a toast is
	 * retired when the lane's own message GOES, not when the panel mounts without one.
	 */
	const laneMessageRef = useRef<"offer" | "failure" | null>(null);
	/*
	 * ONE EFFECT SETTLES THE LANE, and that is a guarantee rather than a tidier arrangement
	 * of two (agent review round 2, R2-4). Both messages share one id, so what the lane must
	 * show is the store's NEWEST word about the conversation; with one effect per message,
	 * which of the two wins a commit in which both moved is decided by the order they happen
	 * to be declared in - and the reversed order dismisses the id and then creates into
	 * sonner's unmount window, which is U3 restored with nothing failing. One decision per
	 * commit removes the question instead of documenting it.
	 *
	 * WHAT THE LANE SHOWS is therefore a function of the store's two values and nothing
	 * else: a refusal (which only an ANSWER ever sets) is the newest word when it is set,
	 * and an offer stands while the rule in `archive-undo.ts` keeps it. BOTH ACTIONS BELOW
	 * SEND THEIR WRITE AND NOTHING ELSE - neither takes its own message down first - so
	 * "nothing in the lane dismisses a message it is about to replace" is exact: the
	 * replacement is the next draw, on the same id, an update OF the mounted toast. A
	 * dismissal would instead destroy a create that landed inside sonner's own unmount
	 * window (its `requestAnimationFrame` plus the 200ms delay), which is the mechanism U3
	 * was (agent review round 1) and the reason the id is shared at all.
	 *
	 * THE ONE DISMISSAL IS THE LANE GOING EMPTY, and `laneMessageRef` is what makes that
	 * answerable: the effect asks whether it DREW a message, never what the store happens to
	 * hold, because a store value can outlive its own message (agent review round 1, R-1:
	 * gating the offer's retirement on `archiveFailure` let one refused archive disable
	 * retirement for the rest of a session, leaving a still-pressable Undo over a
	 * conversation the reader had restored).
	 */
	useEffect(() => {
		if (!archiveFailure && !archiveUndo) {
			if (laneMessageRef.current === null) return;
			laneMessageRef.current = null;
			dismissToast(ARCHIVE_TOAST_ID);
			return;
		}
		/*
		 * WHICH MESSAGE WINS IS DECIDED BY CURRENCY, NOT BY KIND (agent review round 3, R3-1 =
		 * UX round 3, U7). This effect used to take the failure branch unconditionally and reach
		 * the offer only when the store held NO refusal - and `archiveFailure` is cleared in just
		 * two places, both scoped to its own conversation (`store` and `archive-undo.ts`), while
		 * the panel's clock clears the DRAWING and not the value. So after ONE refused archive,
		 * every later successful archive's offer was never painted: the lane re-printed the old
		 * conversation's refusal, re-armed it for a fresh 10s, and the new offer expired unread -
		 * measured 4x in both palettes. Both messages now carry the stamp of the write that
		 * raised them and the NEWER one is drawn; the lane still holds one message at a time and
		 * still replaces in place under the one stable id.
		 */
		const newest =
			archiveFailure && archiveUndo
				? archiveUndo.at > archiveFailure.at
					? "offer"
					: "failure"
				: archiveFailure
					? "failure"
					: "offer";
		/*
		 * THE MESSAGE THE NEWER ONE SUPERSEDED IS CLEARED, WHICH IS U10 ITSELF (UX round 3). The
		 * currency rule above decides which of the two is the lane's newest word - and until this
		 * clause the LOSING one stayed in the store: archive a second conversation while a refusal
		 * stands and the offer takes the lane, press that offer's own Undo, and the lane went EMPTY
		 * and then re-printed the OLD refusal with a fresh ten-second clock (measured: empty at
		 * +450ms, the refusal back at +1.75s in the dark palette and +450ms in the light one).
		 * Clearing the superseded value here is what makes "the lane shows the newest word" true
		 * over TIME rather than only at the moment the newer word arrives.
		 *
		 * AND IT CLEARS ONLY ON A STRICT RANKING, WHICH IS THE OTHER HALF OF THIS FIX (the walk's own
		 * finishing check caught the tie). Both messages are stamped from the SAME counter - the
		 * refusal takes `state.answerSeq` and the offer takes it too - so an undo whose refusal lands
		 * in the answer that re-raises the offer puts them at the SAME stamp. Under the old `>=` the
		 * offer won that tie and this clause then DELETED the refusal: the lane drew the offer for its
		 * eight seconds (measured: `lane cleared in 8169ms`, the offer's ceiling, not the refusal's
		 * ten) and the refusal's own Retry had no card left to be - so the walk's last request never
		 * reached the wire (`stub … /archive -> 409` is the log's final archive-family line) and the
		 * row stayed archived. A refusal is a fact about a press that was ANSWERED while an offer is a
		 * fact about a write (`canonical-sessions-store.ts` says so where it builds it), so on a tie
		 * the refusal is the message that stands - and the clause below therefore deletes only what
		 * the rule ranked STRICTLY older.
		 */
		/*
		 * AND THE MESSAGE A NEWER ONE SUPERSEDED IS CLEARED ONLY WHEN THAT NEWER ONE WAS ACTUALLY
		 * DRAWN OVER IT, AND IS STRICTLY NEWER. The two clauses this replaces cleared on the
		 * ORDERING alone, and the walk's finishing sequence proved what that costs: the refusal
		 * for a press the reader had just made was removed from the store while its OWN CARD was
		 * still on screen (measured: the store reads `"archiveFailure":null` with the row's press
		 * counted at `archiveAttempts:36`, while the step before it passes asserting the lane holds
		 * that refusal with a hit-testable Retry), so the clock re-armed from what the store did
		 * hold - an offer, hence an eight-second ceiling rather than the refusal's ten - the card
		 * was dismissed, and the Retry had nothing left to be: the walk's last request never
		 * reached the wire and the row stayed archived.
		 *
		 * A sonner entry persists until it is dismissed, so a value and its card CAN disagree; the
		 * rule that keeps them together is the one the drawn message itself defines. `drawnRef`
		 * records what was last drawn and its stamp, and the superseded value is cleared only when
		 * a message of the OTHER kind is drawn with a strictly higher stamp - i.e. only when the
		 * older message's turn in the lane is genuinely over. U10's defect is exactly that case (a
		 * refusal for A drawn, then B's offer drawn strictly later: the refusal goes, and it is not
		 * re-printed when the offer retires), while a refusal that arrives AFTER an offer - the
		 * reader's own press, answered - is never the loser of a comparison it wins.
		 */
		const drawnAt =
			newest === "offer" ? (archiveUndo?.at ?? 0) : (archiveFailure?.at ?? 0);
		const drawnBefore = laneDrawnRef.current;
		laneDrawnRef.current = { kind: newest, at: drawnAt };
		if (
			drawnBefore !== null &&
			drawnBefore.kind !== newest &&
			drawnAt > drawnBefore.at
		) {
			if (newest === "offer") clearArchiveFailure();
			else setArchiveUndo(null);
		}
		if (newest === "failure" && archiveFailure) {
			laneMessageRef.current = "failure";
			showWarningToast(
				`Could not ${archiveFailure.archived ? "archive" : "unarchive"} “${archiveFailure.title}”.${archiveFailure.detail ? ` ${archiveFailure.detail}` : ""}`,
				{
					id: ARCHIVE_TOAST_ID,
					className: ARCHIVE_TOAST_CLASS,
					duration: ARCHIVE_TOAST_PERSISTENT,
					position: ARCHIVE_TOAST_LANE,
					action: {
						label: "Retry",
						/*
						 * SONNER DISMISSES THE TOAST AFTER AN ACTION UNLESS THE HANDLER PREVENTS IT.
						 * 2.0.3's action button is `onClick(event); if (event.defaultPrevented) return;
						 * deleteToast();` - so an unprevented press put this entry into its 200ms
						 * removal window, the answer's re-assert 2-4ms later was merged into the entry
						 * being removed and destroyed with it, and the lane ended EMPTY while the
						 * store still held the refusal. Measured 2026-09-21 with the transition
						 * sampler: 15ms after the press `removed: 1` and `nodes: 2` (the dying entry
						 * drawn over the new one, which is also why `hitTest` read false on the Retry
						 * the reader had just pressed), the lane empty ~5s later. This is the other
						 * half of the round-2 fix below: that removed the APP's dismissal, not the
						 * library's.
						 */
						onClick: (event) => {
							event.preventDefault();
							/*
							 * THE RETRY DOES NOT TAKE ITS OWN MESSAGE DOWN FIRST (UX report round 1, U3:
							 * "Retry on a refused archive leaves no message at all").
							 *
							 * A `dismissToast(id)` here reached sonner's dismiss path, whose removal
							 * runs through a `requestAnimationFrame` and a 200ms unmount delay; the
							 * answer to this very press arrives in 2-4ms against a daemon that is on
							 * this machine, and a create landing inside that window is merged into the
							 * entry being removed and destroyed with it. Measured three ways on
							 * 2026-09-21: in the running app (the dismiss and the re-create 2-4ms
							 * apart, `showWarningToast` called and no toast element ever mounted -
							 * MutationObserver, no addition, lane empty at +2.5s), against the installed
							 * sonner 2.0.3 in jsdom (created on a dismissed id: painted at +50ms, gone
							 * by +600ms; the same create 600ms later mounts), and in the store (the
							 * write does set `archiveFailure`, so the effect did run).
							 *
							 * WHAT REACHES THE SCREEN INSTEAD: the refusal stays UP while the retry is
							 * in flight - the last answer to a press on this conversation is still the
							 * honest thing to show - and the answer replaces it in place, through the
							 * same id, with no dismissal anywhere in the path.
							 */
							void setSessionArchived(
								archiveFailure.sessionId,
								archiveFailure.archived,
								archiveFailure.title,
							);
							/*
							 * ONE ACT, ONE REGISTER (UX round 1, U2), KEPT WITHOUT A HANDLER HERE: an
							 * accepted retry is the same act as the row's own press, and the store raises
							 * the same offer for it in the update that settles the write (design round 8,
							 * D27) - so the refusal is retired by the offer landing rather than by a
							 * second `offerArchiveUndo` in this `.then`, which is also what keeps the
							 * departure and its band in one commit on this path too.
							 */
						},
					},
				},
			);
			return;
		}
		if (archiveUndo) {
			laneMessageRef.current = "offer";
			showInfoToast(
				/*
				 * THE NAME FLEXES; THE VERB DOES NOT (agent review round 2, R2-3). The sentence is
				 * two elements because a single string that overflows loses its TAIL - which for
				 * `“<title>” archived.` is the verb, i.e. the half that says what happened, cut
				 * off by the operator's own long titles. The name ellipsises inside its own box
				 * (`truncate`) and the verb is a fixed tail that always fits; the full name is
				 * one dwell away in the row's own flyout, so the truncation costs nothing a
				 * reader cannot recover.
				 */
				<span className="flex min-w-0 items-baseline gap-1">
					<span className="min-w-0 truncate">
						{archiveOfferedName(archiveUndo.title)}
					</span>
					<span className="shrink-0">{ARCHIVE_OFFERED_VERB}</span>
				</span>,
				{
					id: ARCHIVE_TOAST_ID,
					className: ARCHIVE_TOAST_CLASS,
					duration: ARCHIVE_TOAST_PERSISTENT,
					position: ARCHIVE_TOAST_LANE,
					action: {
						label: "Undo",
						/*
						 * AND THE SAME PREVENTION FOR THE OFFER'S OWN PRESS, for the same reason and
						 * with the same measurement behind it (the round-2 remediation re-asserted
						 * the offer in place on an accepted/unrefused answer, and sonner would delete
						 * the entry under it exactly as it did for the Retry).
						 */
						onClick: (event) => {
							event.preventDefault();
							/*
							 * THE UNDO SENDS ITS WRITE AND NOTHING ELSE (agent review round 2, R2-1), and
							 * this is U3's twin on the control beside the Retry: it used to take its own
							 * message down before the answer, and the optimistic fact retired the offer at
							 * the same press, so a refused unarchive raised its refusal on the id that was
							 * just dismissed - the destroy-inside-the-unmount-window pattern, on a
							 * refusal that is an ordinary outcome (the conversation is live, or the
							 * transport failed).
							 *
							 * NOTHING HERE OR IN THE STORE RETIRES THE OFFER AT THE PRESS: the retirement
							 * subscription skips a press whose fact is still unanswered, so the offer is
							 * held while its own write is out, and the ANSWER settles the lane - an
							 * accepted undo clears `archiveUndo` (the lane goes empty, which is the one
							 * dismissal with nothing to replace it) and a refused one replaces the offer
							 * in place with the refusal the store raises for this conversation.
							 */
							void setSessionArchived(
								archiveUndo.sessionId,
								!archiveUndo.archived,
								archiveUndo.title,
							);
						},
					},
				},
			);
		}
	}, [
		archiveFailure,
		archiveUndo,
		setSessionArchived,
		clearArchiveFailure,
		setArchiveUndo,
	]);

	/*
	 * THE CLOCK THE DRAW ABOVE DOES NOT RUN (agent review round 2 - the re-assertion):
	 * the lane's life, armed per MESSAGE rather than per sonner entry.
	 *
	 * It derives the current message from the same two values the drawing effect reads,
	 * so it needs no ref, no declaration order and no record of what was drawn: a
	 * re-assertion is a NEW object from the store, this effect re-runs, and the full life
	 * starts again - which is the whole point (see `ARCHIVE_TOAST_PERSISTENT` for what the
	 * library could not do). `laneMessageRef` is cleared with the dismissal, because the
	 * drawing effect reads it as "was there a message": an expired message that left the
	 * ref standing would make the next empty-lane commit skip the dismissal it owes.
	 */
	useEffect(() => {
		const message = archiveFailure ? "failure" : archiveUndo ? "offer" : null;
		if (message === null) return;
		const timer = setTimeout(
			() => {
				laneMessageRef.current = null;
				dismissToast(ARCHIVE_TOAST_ID);
				/*
				 * AND THE VALUE GOES WITH ITS MESSAGE (the same U10 clause, at the other end of the
				 * life): an expired message that left its value standing was drawn again by the next
				 * commit that re-ran the effect, with a FRESH clock - the reader's own dismissal undone
				 * by a re-render they did not cause, and the clock the design says belongs to the
				 * message because sonner's is no longer what ends one. What does not depend on the lane
				 * is untouched: a live offer is still reachable from the row's own Unarchive control,
				 * the header's Archived pill and `/unarchive`.
				 */
				if (message === "failure") clearArchiveFailure();
				else setArchiveUndo(null);
			},
			message === "failure" ? ARCHIVE_FAILURE_TOAST_MS : ARCHIVE_UNDO_TOAST_MS,
		);
		return () => clearTimeout(timer);
	}, [archiveFailure, archiveUndo, clearArchiveFailure, setArchiveUndo]);

	/*
	 * THE BAND'S HEIGHT IS THE CARD'S OWN, PLUS THE GAP (design round 4, D14), and it is
	 * measured rather than declared because only one of the two messages has a fixed height:
	 * the offer is one line at every width (its name truncates), while the refusal carries the
	 * daemon's sentence about why the write was refused and wrapped to eight lines - 170px -
	 * at the 280 panel. A declaration would have to pick one of them and be wrong about the
	 * other, and wrong in the direction that either clips a refusal or spends 120px of list on
	 * a one-line offer.
	 *
	 * TWO OBSERVERS, BECAUSE THE CARD ARRIVES AFTER THE COMMIT: sonner mounts the toast in its
	 * own render, so the first measurement of a fresh message finds nothing and the childList
	 * watcher is what notices it land; the ResizeObserver re-reads the card when its own height
	 * changes (a wrap at a narrower panel, a longer daemon detail), and it re-targets when the
	 * card is replaced - the same stable sonner entry, a new element, which is exactly what a
	 * supersession looks like from here. `setBandHeight` with an unchanged value is a no-op in
	 * React, so the two can run on the same commit without a loop.
	 */
	const [bandHeight, setBandHeight] = useState(0);
	/*
	 * THE HEIGHT THE LAYOUT RESERVES FOR THE LANE, which is the MEASURED band when a card has landed
	 * and the offer's declared band in the commit that raises it - the one commit in which the pressed
	 * row's height is already gone while no card has been measured yet (`ARCHIVE_OFFER_BAND_HEIGHT` has
	 * the measurement and the arithmetic). Everything the band's height is asked for - the list's own
	 * yield, the base-read guard and the tent itself - reads this rather than the raw state, so the box
	 * and the row cannot move in different commits.
	 */
	const bandHeightNow =
		bandHeight > 0
			? bandHeight
			: archiveUndo !== null
				? ARCHIVE_OFFER_BAND_HEIGHT
				: 0;
	const laneBandRef = useRef<HTMLDivElement | null>(null);
	useEffect(() => {
		const band = laneBandRef.current;
		if (band === null) return;
		const settled = new ResizeObserver(() => measure());
		let watched: HTMLElement | null = null;
		const measure = () => {
			const card = band.querySelector<HTMLElement>(`.${ARCHIVE_TOAST_CLASS}`);
			if (card !== watched) {
				if (watched !== null) settled.unobserve(watched);
				watched = card;
				if (card !== null) settled.observe(card);
			}
			/*
			 * THE SETTLED CARD, NOT THE ANIMATED ONE (QA round 3, Q-4). Sonner animates the toast's own
			 * `height` over 400ms (`transition: ... height 400ms`, 2.0.3), so its
			 * `getBoundingClientRect().height` grows through the entrance - and this effect read THAT, so
			 * the band rode the entrance with it and the rows rode the band (measured: the band ~40px
			 * ahead of the card at low frame rates, which is the motion `transition: none` on the band
			 * exists to prevent).
			 *
			 * WHERE THE SETTLED HEIGHT IS READ FROM, AND WHY NOT SONNER'S OWN NUMBER: the first cut of
			 * this read `--initial-height`, which is the library's own statement of the height the card
			 * settles at - measured once, AT MOUNT. That is exactly wrong for this lane, because both
			 * messages share ONE sonner entry (`ARCHIVE_TOAST_ID`): the offer mounts it at one line (34),
			 * the refusal replaces the message in the same entry (142 settled), and the variable is never
			 * re-measured - measured in the walk, `band 42 / card 42` where the pair should read
			 * `150 / 142`, i.e. the band sized from the offer's height while a refusal stood.
			 *
			 * So the settled height is taken from the card's own LAYOUT: `scrollHeight` is the content's
			 * own height (independent of the animated box) and the two border widths turn it into the
			 * border-box height the rect reports at rest, which is the number the band's ruling is
			 * written in. It re-reads correctly on a replacement, because the content is what changed.
			 */
			const animated = card === null ? 0 : card.getBoundingClientRect().height;
			const cardStyle = card === null ? null : getComputedStyle(card);
			const borders =
				cardStyle === null
					? 0
					: (Number.parseFloat(cardStyle.borderTopWidth) || 0) +
						(Number.parseFloat(cardStyle.borderBottomWidth) || 0);
			const cardHeight =
				card === null
					? 0
					: card.scrollHeight > 0
						? card.scrollHeight + borders
						: animated;
			setBandHeight(
				card === null ? 0 : Math.round(cardHeight) + ARCHIVE_TOAST_BAND_GAP,
			);
		};
		const arrived = new MutationObserver(measure);
		arrived.observe(band, { childList: true, subtree: true });
		measure();
		return () => {
			arrived.disconnect();
			settled.disconnect();
		};
	}, []);

	/*
	 * THE BAND IS SPENT BY THE COLUMN'S BOTTOM-MOST REGION (design round 6's Q-3 ruling, shape (b)),
	 * and in the measured `entities-first` assembly that region is the chats list. The rule: that
	 * region is forced to a DEFINITE box of `max(0, base - band)`, `base` being the height it had with
	 * no message standing - so its top edge does not move, the `flex-1` entity region above keeps its
	 * box to the pixel, the rows in BOTH regions keep their offsets, and neither `scrollTop` is
	 * written. What the band spends is then the list's own bottom, where `overflow-y` clips: the
	 * rows it hides are the overflow, which is what D14 promised and what QA round 3 measured it not
	 * doing (the entity region above paid 94 of the band's 142 and every row rode up with it).
	 *
	 * `base` IS READ ONLY WHILE NO BAND STANDS, and that is a CONSTRAINT rather than a detail: the
	 * forced box IS what a re-read returns, so re-reading while a message is up subtracts the band
	 * from the already-subtracted height - 289 -> 147 -> 5 -> 0, one message at a time (the designer
	 * named the trap). The observer is attached in the band-0 state and this effect's own cleanup
	 * tears it down the moment a message appears.
	 *
	 * IN `chats-first` THE LIST IS NOT THE BOTTOM REGION: the entity region is, and it is the
	 * `flex-1` one, so it yields by itself and this rule leaves the list exactly as it was. That is
	 * the shape's other half, not an omission.
	 */
	// ONE REGION, AND IT IS THE BOTTOM ONE: the merged scroller takes the
	// band's yield directly (there is no flex-1 region above it to move).
	const listIsBottomRegion = true;
	const [listBase, setListBase] = useState<number | null>(null);
	/*
	 * THE BASE IS READ IN THE COMMIT ITSELF, AND THAT IS THE FIX FOR AN INTERMITTENT FAILURE RATHER
	 * THAN A TIDY-UP (measured 2026-09-22, the yield's own check: the LIGHT pass reading
	 * `yieldExact: true` against the DARK pass's `{"rowsHeld":false,"entityBoxHeld":false,
	 * "scrollHeld":true,"yieldExact":false}` on identical code, with the list's box unchanged at 289
	 * and the entity region paying the band - the pre-fix behaviour exactly, once in five runs).
	 *
	 * The first cut read the base from a PASSIVE effect that attached a `ResizeObserver` and returned
	 * early whenever a band stood. Two ways to lose that race, and a run that loses either leaves the
	 * base `null` for the band's whole life: the passive effect may never run in a band-0 commit if
	 * the region was not rendered yet (the ref is null, the effect returns, and its dependencies - the
	 * band's height, the assembly's flags - do not change again before the message arrives), and an
	 * observer's first callback is delivered in a rendering update that a headless window does not
	 * produce on its own. A LAYOUT effect with NO dependency list runs in every commit, synchronously,
	 * before paint, so the commit that first renders the region is the commit that measures it - and
	 * no message can exist before that, because a message needs a press.
	 *
	 * The observer is gone with it: the read happens on every commit while no band stands, which is
	 * the same coverage without a callback that can be late. `setListBase` bails on an unchanged
	 * value, so the extra call is free and cannot loop.
	 *
	 * The FREEZE itself is the designer's constraint, and it is kept: while a band stands this returns
	 * immediately, so the forced box (`max(0, base - band)`) is never re-read as a new base - the
	 * The merged scroller IS the bottom region, so the yield applies to it directly:
	 * there is no flex-1 region above it for the band to move.
	 */
	useLayoutEffect(() => {
		if (bandHeightNow > 0) return;
		const list = listPanelRef.current;
		if (list === null) return;
		const measured = Math.round(list.getBoundingClientRect().height);
		setListBase((previous) => (previous === measured ? previous : measured));
	});
	const listYield: number | undefined =
		listIsBottomRegion && bandHeightNow > 0 && listBase !== null
			? Math.max(0, listBase - bandHeightNow)
			: undefined;

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
					{draftRows.map((row) => (
						<button
							key={row.key}
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
								"w-full text-left",
								row.key === activeDraftKey && rowCurrent,
							)}
						>
							<FileText
								className="size-4 shrink-0 text-ink-dim"
								aria-hidden="true"
							/>
							<span className="min-w-0 flex-1 truncate">{row.label}</span>
						</button>
					))}
				</section>
			)}
			{/*
			 * THE GROUPING ALTERNATIVES (the view popover's `Group by`). `section` is
			 * the arrangement below; `agent` and `flat` replace it, and they draw
			 * over the SAME page, so switching the grouping cannot change which rows
			 * are loaded - only how they are arranged.
			 */}
			{view.groupBy !== "section" &&
				(groupRows(pagedRows, view.groupBy) ?? []).map((entry) => (
					<section key={entry.key} data-chat-section={entry.key}>
						{entry.label ? sectionLabel(entry.label) : null}
						{entry.rows.map((row) => sessionRow(row))}
					</section>
				))}
			{pinnedShown && view.groupBy === "section" && pinned.length > 0 && (
				<section>
					{sectionLabel("Pinned")}
					{pinned.map((row) => sessionRow(row))}
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
			 * `relative` IS THE PANEL'S OWN ANCHOR for anything absolutely positioned inside it, and the
			 * archive band's card is no longer one of those: the band carries `position: relative`
			 * itself (`ARCHIVE_TOAST_BAND_STYLE`, design round 4, D14), because a card contained by
			 * the panel is a card drawn over the list. The container declaration the old per-row shed
			 * measured against is gone with the shed: this panel no longer changes what it draws by
			 * width.
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
								className="w-60 p-2"
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
				 * rest is the palette's `Search ⌘K` row, and this field is the list's own
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
				    the record of the removed split. */}
				<div
					ref={bindPanelRef}
					id={CHAT_REGION_ID}
					tabIndex={-1}
					data-sidebar-region="chats"
					onScroll={() => {
						refreshFocusedInside(entityPanelRef.current, entitySlotRef);
						refreshFocusedInside(listPanelRef.current, listSlotRef);
						extendCatalogueTail();
					}}
					style={listYield === undefined ? undefined : { height: listYield }}
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
				 */}
				{(error || profiles.error || teams.error) && !stripSpeaksConnection && (
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
			{/*
			 * THE SIDEBAR'S OWN TOAST LANE, and `position: absolute` inline is the whole
			 * mechanism: sonner's stylesheet pins the container `fixed`, and an inline value
			 * is the only thing that can beat it (the reason `themed-toast-container.tsx`
			 * states its own colours inline). Anchored by the nav's `relative`, so the lane
			 * is the panel's box rather than the viewport's corner; the global container in
			 * `main.tsx` keeps every other toast exactly where it is. WHAT SONNER 2.0.3
			 * ACTUALLY DOES IS NOT ROUTING, and this comment used to assert that it was:
			 * every mounted container keeps a copy of every toast and draws one `<ol>` per
			 * position ANY of them carries, so a positioned toast is drawn in BOTH containers
			 * and the `position` argument cannot confine it. What confines it is the app's own
			 * rule in `styles/index.css` - the marker class these two messages carry, scoped
			 * to this panel - and the reading behind that rule is recorded there.
			 * a toast by `position`.
			 */}
			{/*
			 * THE BAND, THEN THE CONTAINER INSIDE IT (design round 4, D14). The wrapper is what the app
			 * can size and clip; sonner's own root keeps every rule its stylesheet gives it except the
			 * positioning, which the container style overrides - see `ARCHIVE_TOAST_BAND_STYLE` for why
			 * the card is the band's and no longer the panel's.
			 *
			 * THE BRACES ARE THE COMMENT, AND WITHOUT THEM THIS SENTENCE IS UI (measured 2026-09-22). A
			 * block comment written without them in a children position is not a comment to JSX: it is a
			 * TEXT NODE, so this block was DRAWN in the panel's own bottom - `pnpm lint`'s
			 * `lint/suspicious/noCommentText` caught it, and every frame of the panel taken on the heads
			 * between it landing and this fix photographs the sentence. A block comment among JSX children
			 * needs the braces, which is why the block above it carries them - and why the delimiters are
			 * not spelled out here: the closing one would end this comment early.
			 */}
			<div
				ref={laneBandRef}
				data-archive-toast-band
				style={{ ...ARCHIVE_TOAST_BAND_STYLE, height: bandHeightNow }}
				/*
				 * A WHEEL AT THE PANEL'S BOTTOM IS A GESTURE ABOUT THE LIST (QA round 3, Q-5). The band put
				 * the card BESIDE the list instead of over it (D14), so the gesture has nowhere to land on
				 * its own: the card is `pointer-events: none`, this wrapper is not a scroller, and the rule
				 * in `styles/index.css` that claimed a wheel here "reaches the list behind it" measured
				 * 0 -> 0 while the same wheel over a row scrolled 0 -> 40.5. The reader's gesture at the
				 * panel's bottom is scrolling the list, so it is forwarded there - and to the CARD first
				 * when the card has somewhere to go, because a message taller than the band's ceiling is
				 * read by scrolling it (the short-panel refusal, `max-height: 100%; overflow-y: auto`),
				 * which a `pointer-events: none` card cannot be driven to by a wheel on its own.
				 */
				onWheel={(event) => {
					const card = laneBandRef.current?.querySelector<HTMLElement>(
						`.${ARCHIVE_TOAST_CLASS}`,
					);
					const scroller =
						card !== null &&
						card !== undefined &&
						card.scrollHeight > card.clientHeight
							? card
							: listPanelRef.current;
					if (scroller === null || scroller === undefined) return;
					scroller.scrollTop += event.deltaY;
				}}
			>
				<ThemedToastContainer
					position={ARCHIVE_TOAST_LANE}
					style={ARCHIVE_TOAST_CONTAINER_STYLE}
				/>
			</div>
		</nav>
	);
}
