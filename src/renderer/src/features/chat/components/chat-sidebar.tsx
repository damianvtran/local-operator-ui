import { InstallBuiltinAgents } from "@features/agents/components/install-builtin-agents";
import { compatibilityBannerShown } from "@shared/api/local-operator/backend-error";
import { userFacingMessage } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import {
	type ChatTarget,
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { useChatSearch } from "@shared/api/local-operator/session-search";
import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import { Label } from "@shared/components/ui/label";
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
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
	List,
	LoaderCircle,
	MessageSquarePlus,
	MoreHorizontal,
	Pin,
	Plus,
	Users,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	type ReactNode,
	type Ref,
	useEffect,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { SESSION_SEARCH_MAX_CHARS } from "../../../../../shared/desktop-contract";
import {
	type ArchivePressRecord,
	archivePressExpired,
	archivePressOutcome,
} from "../chat-archive-press";
import { archiveControlLabel, visibleRows } from "../chat-archived";
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
import { clearSearch } from "../clear-search";
import {
	markAllReadCopy,
	markAllReadReceipt,
	unreadMarkKind,
} from "../mark-all-read";
import { newChatShortcutCap } from "../new-chat-shortcut";
import { catalogueGate } from "../sidebar-catalogue-gate";

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
 * retired role existed to fix. The wash is not broken everywhere — the app rail
 * paints it on `sunken`, where it measures 9.6 — which is why this is a call-site
 * ground and NOT a wash: strengthening `accentWash` for the panels that draw it
 * on `surface` would make every hover tint in the app louder. (The SETTINGS rail
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
 * reader of that file cannot get in one piece. `relative` is IN here rather than
 * at each call site because the bar is `absolute`: the element that carries the
 * role is the bar's containing block, and a consumer that forgot `relative` would
 * let the bar escape its row.
 */
export const rowCurrent =
	"relative bg-row-selected font-medium text-ink hover:bg-row-selected before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent";

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
	const ready = desktopFeatureEnabled(
		capabilities.data,
		"session_catalogue",
		2,
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
		ready,
		failed: Boolean(capabilities.error),
		answered: Boolean(capabilities.data),
		wasReady: wasReady.current,
		// Read here rather than inside the module: the gate is a decision, and the
		// store is a subscription.
		rows: sessions.length,
		storeFailed: Boolean(error),
		// The banner's own condition, read through the same predicate it uses, so
		// the two cannot drift into stating one condition twice (design round 1, D3).
		coveredByCompatibilityBanner: compatibilityBannerShown(capabilities.data),
	});
	/*
	 * The platform, read once for the New chat row's caps, and read SYNCHRONOUSLY
	 * on purpose: it is the same `navigator.platform` read `chat-header.tsx` and
	 * `sidebar-navigation.tsx` make, and the boolean it produces is what the cap
	 * helper takes (`newChatShortcutCap`, aligned with the palette's
	 * `paletteShortcutCaps` rather than taking the platform string itself).
	 */
	const isMac = navigator.platform.toUpperCase().indexOf("MAC") >= 0;
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
	const markAllRead = useCanonicalSessionsStore((s) => s.markAllRead);
	const [query, setQuery] = useState("");
	const [all, setAll] = useState(false);
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: this runs after every render and clears itself; the guard IS the state it waits on
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
			 * `preventScroll`, which is the whole reason the correction above survives: a
			 * plain `focus()` scrolls the element into view itself - measured as the region
			 * snapping to 0 and the row landing 202 px above the line it was pressed on.
			 * The correction is this effect's; focus only says where the caret is.
			 */
			row
				.querySelector<HTMLElement>("[data-session-pin]")
				?.focus({ preventScroll: true });
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
	const activeHeadingRef = useRef<HTMLButtonElement | null>(null);
	const controlWasShown = useRef(markAllReadShown);
	useEffect(() => {
		if (controlWasShown.current && !markAllReadShown) {
			const active = document.activeElement;
			if (active === null || active === document.body) {
				activeHeadingRef.current?.focus();
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
	// biome-ignore lint/correctness/useExhaustiveDependencies: catalogueRevision is a trigger, not a read
	useEffect(() => {
		if (!ready) return;
		void fetchSessions();
		if (!feed.available) {
			/*
			 * No feed: an older backend, or a browser-dev renderer with no relay.
			 * Keep the poll this change replaces, gated exactly as it was — the
			 * behaviour of an old renderer against the new code, which must be
			 * identical rather than merely similar.
			 */
			const timer = window.setInterval(() => {
				if (document.visibilityState === "visible") void fetchSessions();
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
		 *   would reintroduce the same hole for a smaller gain.
		 * - a refetch on window focus, which is the one moment a stale catalogue is
		 *   about to be looked at.
		 */
		const timer = window.setInterval(() => {
			void fetchSessions();
		}, CATALOGUE_SAFETY_POLL_MS);
		const onFocus = () => void fetchSessions();
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
	}, [ready, fetchSessions, feed.available, feed.catalogueRevision]);
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
	 * carries a marker and `visibleRows` returns the page untouched - so the panel's
	 * DOM and class set are byte-identical to the one that never knew about
	 * archiving. A permanently reserved empty slot would cost every row width to
	 * advertise a feature the user cannot get, which is the rule the pin slot is
	 * written under.
	 */
	const archiveEnabled = desktopFeatureEnabled(
		capabilities.data,
		"session_archive",
	);
	/*
	 * The `Include archived` control, scoped to ONE search.
	 *
	 * Local state rather than the store, for the reason the query itself is local:
	 * it is a property of the box, not of the data, and it is deliberately not
	 * persisted - a user who reopens the app must not silently be searching a set
	 * they chose to include once, days ago.
	 */
	const [includeArchived, setIncludeArchived] = useState(false);
	/*
	 * Cleared with the query, because the control is only on screen while a query
	 * exists: leaving it set would arm the NEXT search with a filter the user can no
	 * longer see, which is a hidden state rather than a remembered one.
	 */
	useEffect(() => {
		if (!query.trim()) setIncludeArchived(false);
	}, [query]);
	const archiveFacts = useCanonicalSessionsStore((s) => s.archiveFacts);
	const archiveFailure = useCanonicalSessionsStore((s) => s.archiveFailure);
	const setSessionArchived = useCanonicalSessionsStore(
		(s) => s.setSessionArchived,
	);
	/*
	 * The pure search module takes plain booleans: the stamp that orders a fact
	 * against an answer is the store's business (`applySearchAnswer`), and a row
	 * only needs what to draw.
	 */
	const archiveFactValues = useMemo(() => {
		const values: Record<string, boolean> = {};
		for (const [id, fact] of Object.entries(archiveFacts))
			values[id] = fact.archived;
		return values;
	}, [archiveFacts]);
	const archiveView = useMemo<ArchiveView>(
		() => ({ include: includeArchived, facts: archiveFactValues }),
		[includeArchived, archiveFactValues],
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
	const search = useChatSearch(
		query,
		ready && searchSupported,
		includeArchived,
	);
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
	const listed = useMemo(
		() => visibleRows(sessions, archiveEnabled && !includeArchived),
		[sessions, archiveEnabled, includeArchived],
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
			),
		[listed, heldRows, query, hits, pinFactValues, archiveView],
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
	const children = (kind: ChatTarget["kind"], name: string) =>
		matching.filter((row) =>
			kind === "team"
				? row.binding?.team === name
				: !row.binding?.team && row.binding?.agent === name,
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
	const draft = activeDraftKey ? drafts[activeDraftKey] : undefined;
	const bindingName = (row: CanonicalSessionRow) =>
		row.binding?.team || row.binding?.agent || "";
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
		);
	}, [answered, search.data, listed, heldRows, pinFactValues, archiveView, query]);
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
	 *    it is null for a foreign request and nothing in the sidebar reports one now (QA
	 *    round 1 rendered exactly that against a foreign `request_access`);
	 *  - it was the only thing that NORMALISED the pane's lens on the way in. The pane's
	 *    scope is one sticky preference (`ui-preferences-store.ts:452`, read at
	 *    `browser-pane.tsx:89`) which the deleted handler reset to the conversation, and
	 *    the header's Globe is unmounted while the pane is open (`chat-header.tsx:161`) so
	 *    it cannot be pressed to re-scope: with the pane last left on `All tabs`, that is
	 *    where the header's Globe reopens it and the in-pane switch is the only way back.
	 *    The toggle and its `aria-expanded` cue went the same way.
	 *
	 * One surface outside this component still reports another conversation's approvals:
	 * `src/main/browser/consent-notifier.ts` raises a native "Site approval needed" banner
	 * naming the count and the oldest origin, focus-gated and naming no conversation. It is
	 * unobservable in this repo's headless rigs (native banners are suppressed there), so
	 * that is a record of what the code does rather than a measurement. A one-line fix
	 * exists if the lens is wanted back - keep the header's Globe mounted so it toggles and
	 * normalises the scope - and it is deliberately NOT taken here: the control's
	 * focus-return and spacing rules are pinned by tests and are not this change's to
	 * alter.
	 */
	const sessionRow = (row: CanonicalSessionRow, nested = false) => {
		const trailing = rowTrailingStatement({
			marked: conversationMatches.has(row.session_id),
			unstarted: unstarted.has(row.session_id),
			nested,
			binding: bindingName(row),
		});
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
		 * THE ROW IS A WRAPPER PLUS A BUTTON, and it keeps that shape now that the per-row
		 * browser mark is gone (operator ask, 2026-09-18; the reasoning is at
		 * `sessionRow`'s own note above). The wrapper paints the CURRENT-STATE ground and the
		 * button paints it again because `rowStyle`'s own `hover:` step is the only
		 * thing that beats the step it inherits — ONE state spread over two elements by the
		 * DOM, the shape `rowStyle`'s docstring already describes for the entity row, and
		 * `scripts/chat-sidebar-selection.test.mjs` resolves both expressions through the
		 * shipped `cn` rather than looking for a class name.
		 *
		 * THE WRAPPER, THE SLOT AND THE `group` HOOK, stated together because this is the
		 * seam the fold welded: the slot the next paragraph describes as reserved is now
		 * FILLED, by this branch's 24px pin control (mounted only when the backend
		 * advertises `session_pins`, revealed on hover or focus inside the row, and
		 * reserving its box at rest so the reveal cannot reflow the row), and the
		 * `group` class the wrapper carried is back for exactly the reason its removal
		 * gave — something inside READS it now (`group-hover`/`group-focus-within` on
		 * that control), and a hook an element reads is the only kind worth carrying.
		 * The wrapper keeps its other job unchanged, and carries
		 * `data-session-row`, the hook the pins harness and this file's CURRENT table
		 * address the row by. The `w-full` -> `min-w-0 grow` note on the button below is
		 * main's and still holds: a full-width button sharing a flex row with a sibling
		 * is a row that overflows.
		 *
		 * THE ARCHIVE'S SECOND SLOT, added beside the pin's by this branch: the same
		 * box (`size-6 shrink-0`), the same reveal (`opacity` and `pointer-events` only,
		 * so the reveal cannot reflow the row), the same `group` hook, mounted only when
		 * the backend advertises `session_archive`. While both capabilities are present
		 * the two controls hold two slots RESERVED SIDE BY SIDE rather than sharing one
		 * 24px box: two controls in one box occlude each other's reveal, so only the top
		 * one could ever be pressed, and an overlapping reveal hides the title of the
		 * row the pointer is on. Below the panel's default width the pair sheds to a
		 * single shared control (`ROW_ACTIONS_SHED`), the band where two slots leave the
		 * title about twenty characters wide.
		 *
		 * WHAT THE BUTTON KEEPS: `data-chat-row` on exactly one element per row, and with it
		 * `title` and `aria-current` — three committed harnesses select on those and the
		 * arrow-key traversal walks the attribute. The pin control deliberately does NOT
		 * carry it: Tab reaches that control and the arrow-key traversal does not.
		 *
		 * WHY THE FOLD KEPT BOTH HALVES: main's row body is the shipped one (its unread
		 * tail reads `unreadMarkKind`, the predicate the glyph, the accessible name and
		 * the bulk count all read) and this branch's contribution is the trailing pin and
		 * the press guard on the row's own `onClick` — both sides' intents, neither
		 * restated from the other.
		 */
		const pinned = row.pinned === true;
		const label = row.title || "Untitled chat";
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
				/* The tooltip carries the row's binding and its own state — the facts the
				   row may not be drawing — and deliberately NOT the search mark's words,
				   which the row announces itself through the `sr-only` span beside it:
				   both channels saying "matched in conversation" would be one fact
				   announced twice (review round 4, R23). Stated as the rule the
				   expression below implements: the tooltip completes the set minus the
				   MARK'S words, which is the only statement it withholds. The binding
				   and ", not sent yet" are appended in every case, so on a row that
				   draws one of those the tooltip repeats it rather than omitting it
				   (review round 6, R33). The ", unread" tail is read from the SAME
				   predicate the glyph, the accessible name and the bulk count read
				   (`unreadMarkKind`). It used to be keyed on bare `unseen`, which made a
				   busy or gated row's tooltip claim a mark its own spinner and gate were
				   nowhere drawing — the reported defect, in the channel a reader reaches
				   by hovering, and the row that most needs the tooltip to be true. */
				title={`${row.title || "Untitled chat"}${bindingName(row) ? ` (${bindingName(row)})` : ""}: ${row.status?.label ?? (synthesized.has(row.session_id) ? "found by search, beyond the chats listed here" : "Recent")}${unstarted.has(row.session_id) ? ", not sent yet" : ""}${unreadMarkKind(row) !== null ? ", unread" : ""}${archived ? ", archived" : ""}`}
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
			    truncate — the title, and the binding slot inside its own 45% cap,
			    which is that cap doing the work a floor used to. The two literal
			    statements below cannot truncate anything: they are fixed strings
			    with no width to run out of. */}
				<span className="min-w-0 flex-1 truncate">
					{row.title || "Untitled chat"}
				</span>
				{/* In a flat list nothing else names the profile answering, so two
			    untitled chats on different agents were indistinguishable. Nested
			    rows already inherit the identity from their parent, and a row that
			    has something more important to say (the paragraph above) says that
			    instead. The row's `title` carries the binding in every case, so the
			    accessible description is never narrower than the pixels. */}
				{trailing === "binding" && (
					/* Bounded, unlike the two literals below. `bindingName` is a
					   user-authored agent or team name and the agent-name field
					   accepts 64 characters, so `shrink-0` with no `truncate` left an
					   UNBOUNDED slot: the title (floor of zero) absorbed all of it,
					   which restored round 4's D18 at roughly 35 characters and
					   overflowed the row at roughly 45 — reachable from the product's
					   own input limit, with no dragging involved (review round 4,
					   R21). The cap is a share of the row rather than a fixed width so
					   it scales with the panel, and `truncate` clips inside it. The
					   other two are literals and stay `shrink-0`: they cannot grow,
					   so they cannot starve anything. */
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
		 * advertised: with the pins present and only the archive withdrawn the row is the
		 * pin's own box, class list included, which is what makes this branch's withdrawn
		 * pair byte-identical to main's panel. "Byte-identical to the pre-change panel" is still the
		 * claim this branch makes; what moved is which panel is the pre-change one.
		 */
		if (!pinsEnabled && !archiveEnabled) {
			return (
				<div
					key={row.session_id}
					className={cn(rowBoxStyle, current && rowCurrent)}
				>
					{rowButton}
				</div>
			);
		}
		return (
			<div
				key={row.session_id}
				/* The row's own box, and the hook the current-row ground is asserted
				   through (`chat-sidebar-selection.test.mjs`'s CURRENT table). */
				data-session-row={row.session_id}
				className={cn(
					// Carried while EITHER per-row control is mounted, because both reveal
					// themselves through `group-hover`/`group-focus-within` on it, and absent
					// when neither is - which is what keeps the fully withdrawn panel's class
					// list the one it had before either feature existed.
					(pinsEnabled || archiveEnabled) && "group",
					rowBoxStyle,
					current && rowCurrent,
				)}
			>
				{rowButton}
				{/*
				 * The pin, revealed by the pointer or by focus inside the row and RESERVED
				 * AT REST whenever the capability is present, so the reveal cannot reflow
				 * the row: a row that reflows under the pointer is worse than no affordance
				 * (the rule the entity row's own reveal is written under). Only `opacity`
				 * moves here - nothing lifts, scales or translates on hover - and the whole
				 * control is absent, not disabled, when the backend advertises no pin store
				 * (`pinsEnabled`).
				 *
				 * 24px and `shrink-0`, matching the entity row's manage control beside it,
				 * which is this panel's established shape for a row's secondary action: Tab
				 * reaches it and the arrow-key traversal does not, because `data-chat-row`
				 * is deliberately absent from it.
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
						}}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md",
							"transition-opacity duration-base ease-out-quart",
							// The duration governs the transition INTO the current state, so
							// the unpinned value is the fade-OUT and the revealed value the
							// fade-IN: quick to appear, gentler to leave. The reveal is
							// `opacity` alone - the box, the glyph's size and the row's
							// height are the same in both states, which is what makes the
							// reserved slot unable to reflow the row.
							pinned
								? // Visible, because a pinned glyph is the STATE and hiding it would
									// be worse than the hazard. Its repeat-press hazard is handled by
									// the press guard, not by taking the control away.
									"text-ink"
								: cn(
										"text-ink-dim opacity-0",
										/*
										 * HIDDEN IS ALSO INERT: an affordance the reader cannot see must
										 * not be the thing a press lands on (QA round 1, U3). The row
										 * behind it is the hover target - `group-hover` reveals the
										 * control, and the same two states make it operable - so the
										 * transition from inert to operable is the reveal itself.
										 */
										"pointer-events-none",
										"group-hover:opacity-100 group-hover:pointer-events-auto group-hover:text-ink-muted group-hover:duration-fast group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:duration-fast",
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
				 * RESERVED AT REST, REVEALED BY OPACITY ONLY. It is `size-6 shrink-0` and
				 * present in the layout whenever the capability is, so the reveal cannot
				 * reflow the row under the pointer; only `opacity`, `pointer-events` and
				 * colour move, which keeps this inside the design contract's rule that
				 * nothing lifts, scales or translates on hover. `group-focus-within` is what
				 * makes it reachable by keyboard: pressing Tab into the row's button reveals
				 * it, and the next Tab lands on it.
				 *
				 * HIDDEN IS ALSO INERT: `pointer-events-none` while invisible, because an
				 * affordance the reader cannot see must not be the thing a press lands on.
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
							void setSessionArchived(
								row.session_id,
								!archived,
								row.title ?? undefined,
							);
						}}
						className={cn(
							"flex size-6 shrink-0 items-center justify-center rounded-md",
							"text-ink-dim opacity-0 pointer-events-none",
							// The duration governs the transition INTO the current state, so the
							// resting value is the fade-out and the revealed one the fade-in:
							// quick to appear, gentler to leave.
							"transition-opacity duration-base ease-out-quart",
							"group-hover:opacity-100 group-hover:pointer-events-auto group-hover:text-ink-muted group-hover:duration-fast",
							"group-focus-within:opacity-100 group-focus-within:pointer-events-auto group-focus-within:text-ink-muted",
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
			</div>
		);
	};
	const entity = (kind: ChatTarget["kind"], name: string) => {
		const rows = children(kind, name);
		const key = `${kind}:${name}`;
		const open = Boolean(query) || isOpen(key);
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
						<span className="min-w-4 shrink-0 text-right text-meta tabular-nums text-ink-dim">
							{rows.length || ""}
						</span>
					</button>
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
						{!rows.length && (
							<p className="py-1 pl-7 text-meta text-ink-dim">No chats yet</p>
						)}
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
				className="flex h-7 min-w-0 flex-1 items-center gap-1 rounded-md px-1 text-body-sm font-medium text-ink-muted hover:bg-row-hover"
				aria-expanded={query ? true : isOpen(key, initial)}
				onClick={() => toggle(key, initial)}
			>
				{query || isOpen(key, initial) ? (
					<ChevronDown className="size-3.5" />
				) : (
					<ChevronRight className="size-3.5" />
				)}
				<span className="min-w-0 flex-1 truncate text-left">{label}</span>
				{/* A zero badge next to a group that already says it is empty is the
			    same fact twice; only a non-zero count carries information. */}
				{count !== undefined && count !== 0 && countBadge(count)}
			</button>
			{action}
		</div>
	);
	const keyDown = (event: KeyboardEvent<HTMLElement>) => {
		const target = event.target as HTMLElement;
		if (target.tagName === "INPUT") {
			if (event.key === "Escape") {
				setQuery("");
				target.blur();
			}
			return;
		}
		// Arrow navigation was a one-way trip: nothing returned focus to the
		// search field, so a keyboard user who entered the list was stranded there.
		if (event.key === "Escape") {
			event.preventDefault();
			searchRef.current?.focus();
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
			rows[next]?.focus();
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
	 */
	const entityPanelRef = useRef<HTMLDivElement | null>(null);
	const entitySlotRef = useRef<FocusedSlot>({
		node: null,
		index: -1,
		visibility: "outside",
	});
	const listSlotRef = useRef<FocusedSlot>({
		node: null,
		index: -1,
		visibility: "outside",
	});
	useLayoutEffect(() => {
		holdFocusedRow(entityPanelRef.current, entitySlotRef);
		holdFocusedRow(listPanelRef.current, listSlotRef);
	});
	return (
		<nav
			aria-label="Chats"
			className="flex h-full min-h-0 flex-col bg-surface p-2 text-ink"
			onKeyDown={keyDown}
		>
			{/* The header once carried a 16px `Plus` for the same action the "New
		    chat" row below now names in words. Two controls firing one action at
		    two sizes in one panel reads as an accident, and the small one was the
		    reported defect — it was the only entry point and users did not find
		    it. The named row replaces it rather than joining it. */}
			<div className="flex h-8 items-center px-1">
				<h2 className="text-body-sm font-medium">Chats</h2>
			</div>
			{/* The field carries its own clear control rather than relying on
		    Escape, which also blurs: a pointer user who wants to widen the filter
		    back out had to select the text and delete it, and there was nothing on
		    screen saying the field could be emptied at all. `pr-9` keeps the query
		    clear of the control — the same reserved-column idiom the settings
		    search uses on the left for its leading glyph. */}
			<div className="relative my-2">
				<input
					ref={searchRef}
					aria-label="Search chats and agents"
					placeholder="Search chats and agents"
					className="h-8 w-full rounded-md border border-control bg-surface pr-9 pl-2 text-body-sm"
					value={query}
					onChange={(event) => setQuery(event.target.value)}
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
						onCheckedChange={(checked) => setIncludeArchived(checked === true)}
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
				lostRowsToStaleAnswer(previous?.rows.length ?? 0, matching.length) && (
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
			{/* The entity region, and the SECOND container that needs the rule below.
		    An entity is a disclosure row whose CHILDREN are session rows drawn from
		    the same catalogue array the list draws (`children()`), so a nested row's
		    slot is the same backend order key: a completion re-files it on the same
		    event, inside a container that scrolls. The region was "deliberately not
		    touched" in the first pass on the premise that nothing in it re-files,
		    and that premise was false (round 1, R1) - the measurement is in
		    `scripts/sidebar-resort-geometry.mjs`, which walks this container from a
		    NESTED row rather than from the list's.

		    The trade is not the list's, and it is stated rather than implied: this is
		    the one region where content genuinely GROWS above the reader - a
		    catalogue arriving, or a query expanding every entity at once - and
		    `overflow-anchor: none` gives up Chrome's compensation for that case to
		    buy the re-file case. The growth is user-initiated or at load (the search
		    box re-renders the region it filters), while the re-file is involuntary
		    and arrives on every completion, which is the exchange this side of the
		    declaration takes. */}
			<div
				ref={entityPanelRef}
				onScroll={() =>
					refreshFocusedInside(entityPanelRef.current, entitySlotRef)
				}
				className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1 [overflow-anchor:none]"
			>
				{capabilities.isLoading && (
					<p aria-live="polite" className="text-meta text-ink-dim">
						Connecting to chats…
					</p>
				)}
				{capabilities.error && (
					<div role="alert" className="space-y-1 text-body-sm text-danger">
						<p>
							{capabilities.error.message}
							{stale ? " Showing the last chats loaded." : ""}
						</p>
						<button
							type="button"
							className="underline"
							onClick={() => void capabilities.refetch()}
						>
							Retry
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
				 */}
				{notice && (
					<div role="alert" className="space-y-1 text-body-sm text-warning">
						<p>{notice}</p>
						<button
							type="button"
							className="underline"
							onClick={() => void capabilities.refetch()}
						>
							Retry
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
							{heading("agents", "Agents", true)}
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
												ownAgents.map((profile) =>
													entity("agent", profile.name),
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
							{heading("teams", "Teams", true)}
							{(query || isOpen("teams", true)) && (
								<>
									{teams.isLoading && (
										<p aria-live="polite" className="text-meta text-ink-dim">
											Loading teams…
										</p>
									)}
									{teams.data?.map((team) => entity("team", team.name))}
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
			{/* The global partition is NAVIGATION, not a peer of the entity lists.
									    Sharing one scroll flow pushed Previous below the fold at 16+ sessions
									    and its disclosure became easy to miss, so it is pinned below the
									    scrolling entity region and owns its own scroll area.

									    `overflow-anchor: none` IS LOAD-BEARING ON THIS CONTAINER, and it is a
									    property of the ROWS this panel draws rather than a style choice. A
									    session's slot is the backend's order key, so a completion re-files the
									    row - within the same section when it was already Active - and the feed
									    now invalidates the client's list read on that change rather than on a
									    section move, so the re-file happens on every completion instead of on
									    the next poll.

									    Chrome's scroll anchoring (`overflow-anchor: auto`, the initial value)
									    picks the element that moved as the anchor and pays for its move by
									    moving THIS container's `scrollTop` by exactly the row's travel -
									    measured on the overflowing story at -96 px for a 3-row travel
									    (`scripts/sidebar-resort-geometry.mjs`; before/after frames on the pull
									    request). The reader is not following the row: they are somewhere else in
									    the list, and the whole viewport slides under them by the travel, which is
									    the jitter this change is about. Refusing to anchor holds `scrollTop`
									    through the re-file and leaves the one-row shift the re-file itself
									    produces - the rows redrawn in their new order - which is the row moving
									    rather than the reader being moved.

									    The sibling rule is the transcript's, and the two are opposite on
									    purpose: `canonical-transcript.tsx` sets `overflow-anchor: auto` because
									    ITS content grows under a reader pinned to the end, where following the
									    content is the feature.

									    THIS CONTAINER IS THE RE-ORDER CASE, AND IT IS NOT THE ONLY ONE - the
									    entity region above carries the same declaration for the same reason,
									    and the two are a pair. What it gives up is stated rather than denied:
									    a row inserted ABOVE a reader who is scrolled down, or a list read that
									    adds rows above the viewport, is no longer compensated for, so the
									    reader's content shifts by the insertion - the trade this declaration
									    accepts for holding the position through a re-file, which arrives on
									    every completion rather than on an edit the reader made. (The claim in
									    the first pass ran the other way - "nothing here grows; the list only
									    re-orders" - and it was both false for the entity region and false
									    here: round 1, N2.)

									    One cost is not paid by the reader who is nowhere near the row: the
									    keyboard cursor is an ELEMENT, so a focused row that re-files out of the
									    panel would leave the cursor off screen. `holdFocusedRow`
									    (`sidebar-focus-hold.ts`) is the other half of this rule - the container
									    follows the row the CURSOR is on, by the minimum, which is the case the
									    transcript's rule is about. It follows it only when the RE-FILE is what
									    took it out of the panel - a reader who scrolled their cursor away keeps
									    the position they chose, and so does the reader whose cursor row was not
									    on screen at all when the change landed. */}
			{/* The pin failure, in the panel's own register rather than a toast.
		    One sentence and one action, the shape the withdrawn-gate notice
		    above already uses - and NO `role="alert"`, so it cannot compete with
		    the catalogue alert below about a different failure. What announces
		    it is `aria-pressed` flipping back on the control the user just
		    pressed; this sentence is the durable half. `warning` and not `danger`:
		    the list is intact and only this row's pin did not move. */}
			{pinFailure && (
				<p className="pb-2 text-meta text-warning">
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
			)}
			{/*
			 * THE ARCHIVE REFUSAL, in the panel's own register beside the list rather
			 * than in a toast. One sentence and one action, the shape the withdrawn-gate
			 * notice already uses - and no `role="alert"`, so it cannot compete with
			 * the catalogue alert below about a different failure: what announces the
			 * refusal is the row coming back with its control in the state the user left
			 * it, and this sentence is the durable half. `warning` and not `danger`:
			 * the list is intact and only this row's archive state did not move.
			 */}
			{archiveFailure && (
				<p className="pb-2 text-meta text-warning">
					Could not {archiveFailure.archived ? "archive" : "unarchive"} “
					{archiveFailure.title}”.
					{archiveFailure.detail ? ` ${archiveFailure.detail}` : ""}{" "}
					<button
						type="button"
						className="underline"
						onClick={() =>
							void setSessionArchived(
								archiveFailure.sessionId,
								archiveFailure.archived,
								archiveFailure.title,
							)
						}
					>
						Retry
					</button>
				</p>
			)}
			{showList && (
				<div
					ref={listPanelRef}
					onScroll={() =>
						refreshFocusedInside(listPanelRef.current, listSlotRef)
					}
					/*
					 * The pointer's path, which is the half a coordinate test cannot see: a
					 * reader who moves away from the point they pressed and comes back has made
					 * a NEW gesture, so the record expires on that movement. Leaving the list
					 * expires it too - the reflex this protects never leaves the region between
					 * its two clicks (UX round 3, U9; QA round 3, Qr3-1).
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
						 * AND THE ARCHIVE'S OWN RECORD, on the same movement: both guards expire
						 * on the same path because both exist for the same reflex - a press that
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
					className="mt-2 max-h-[45%] shrink-0 space-y-4 overflow-y-auto border-t border-hairline pt-2 [overflow-anchor:none]"
				>
					<section>
						<button
							type="button"
							data-chat-row
							/* The driver's way into the list (see `chat-session-row`): the
							   sections above it are entity lists, and this is the control that
							   widens the list to every conversation. */
							data-tour-tag="chat-all-chats"
							className={cn(rowStyle, "w-full", all && rowCurrent)}
							aria-pressed={all}
							onClick={() => setAll((value) => !value)}
						>
							<List className="size-4" />
							<span className="flex-1 text-left">All chats</span>
							{/* The three global counts read as one set, so this must honour
						    the active filter exactly as Active/Previous do. A zero badge
						    beside the "No chats yet" sentence just repeats it. */}
							{matching.length > 0 && countBadge(matching.length)}
						</button>
						{/* Sits inside the All chats section so it holds the same place
					    — under the toggle, above whatever the toggle reveals — in
					    both the flat list and the Active/Previous split. Deliberately
					    a plain `rowStyle` row and not a `heading()`: a chevron would
					    promise something to expand. Disabled tracks `ready` because
					    staging a draft needs the session catalogue that gate covers.

					    THE ROW CARRIES NO BOUNDARY, and that is a decision rather than
					    an omission. It used to wear `border-control` as this system's
					    "outline control" idiom, which reads as a control at rest — but
					    that edge was also the one thing that stepped the row out of
					    line with the All chats row directly above it. The app is
					    `box-sizing: border-box`, so a 1px border sits INSIDE the row's
					    own `h-8` box and pushes the icon and the label in by 1px on
					    each side, and no other row in this block has a boundary at all.
					    The operator asked for the two rows to line up and for the BORDER
					    to go - "the pill" is this file's description of what the border
					    produced, not the operator's words. Removing the edge is what does
					    both, and the measurement is in docs/evidence/new-chat-row (the
					    icon's left inset goes from 5px, the border plus `rowStyle`'s
					    `px-1`, to 4px).

					    What still marks the row as the ACTION here is everything the
					    rows around it do NOT have: the `MessageSquarePlus` glyph
					    rather than `Plus`, which means "open a creation form" twice
					    over in this panel (Create agent, Create team) while this
					    stages a chat, and which matches the glyph the entity rows
					    reveal for the same outcome; the `mb-1` margin that separates
					    it from the Active/Previous split below; `rowStyle`'s
					    `hover:bg-row-hover` colour step; and the `rowCurrent`
					    ground (recessed from the panel, and hover-proof) while
					    an untargeted draft is staged.

					    `border-control` is therefore RETIRED on this row by the
					    operator's own instruction, not merely unused: re-adding it puts
					    the row back 1px out of alignment with the row above, so it is
					    not a free tidy-up for a later reader. */}
						<button
							type="button"
							// REACHABLE now, and this is the state that makes it live: a gate that
							// withdraws without an error leaves `showList` true (the last-known
							// rows stay mounted) while `ready` is false, so this row renders
							// disabled and refuses to stage a draft against an absent catalogue.
							// Before the withdrawn case was handled, the only way here was a
							// capability error, and react-query keeps the last good `data`
							// across a failed refetch (`retry: false`, no reset) - so `ready`
							// stayed true there and this was defensive rather than reachable.
							//
							// Kept and now load-bearing, because the pairing is what makes
							// decoupling `showList` from `ready` safe: staging a draft needs the
							// session catalogue, so a not-ready render must disable rather than
							// stage against nothing. Only a focusable row is a stop in the arrow
							// ring - `keyDown` moves by calling `.focus()` on the next
							// `[data-chat-row]` and a disabled button silently refuses it - so the
							// attribute has to drop out in exactly the states the button is
							// disabled, or a keyboard user strands here.
							data-chat-row={ready || undefined}
							className={cn(
								rowStyle,
								"mb-1 w-full disabled:text-ink-disabled disabled:hover:bg-transparent",
								// Marked current on the same terms as an entity row: an
								// untargeted draft is the one THIS row stages. A draft
								// carrying a target belongs to its entity row, which is
								// already highlighting itself, and two rows claiming the
								// same draft would misreport where the user is.
								Boolean(activeDraftKey) && !draft?.target && rowCurrent,
							)}
							aria-current={
								activeDraftKey && !draft?.target ? "page" : undefined
							}
							disabled={!ready}
							onClick={() => onStageDraft(undefined, true)}
						>
							<MessageSquarePlus className="size-4" />
							<span className="flex-1 text-left">New chat</span>
							{/*
							 * The chord this row is the visible half of, as caps — the same
							 * `KeyboardShortcut` the inline editor's footer prints, so the two
							 * spellings of "a shortcut" in this app cannot diverge.
							 *
							 * It is the TRAILING element, where the All chats row above carries
							 * its count: both rows end in the column that says what the row will
							 * give you, and the label's own `flex-1` is what holds it there.
							 *
							 * NOTHING IS PASSED WHILE THE ROW IS CURRENT, and that is the point
							 * rather than an omission: a cap has no fill and no edge of its own
							 * (`keyboard-shortcut.tsx` carries the measurement that retired the
							 * `bg-sunken` fill), so the marks it used to need on this one row —
							 * the `capEdge` outline, which existed because the cap and the row
							 * were both `sunken` — have nothing left to separate. The row's own
							 * `rowCurrent` ground carries the state on the ROW's box, not on the
							 * caps, and the chord is drawn the same way
							 * on every ground it lands on, which is what makes it one idiom rather
							 * than one idiom plus an exception.
							 *
							 * Platform: `isMac` above, derived from `navigator.platform` the way
							 * `chat-header.tsx` and `sidebar-navigation.tsx` derive it, and passed to
							 * `newChatShortcutCap` as a boolean - the shape the palette's own caps
							 * use. The read is synchronous (the capability hook's answer is async,
							 * and a row that painted `⌘N` before it arrived would flash the wrong cap
							 * on Windows), and the cap is asserted in
							 * `scripts/new-chat-shortcut.test.mjs` for both spellings.
							 *
							 * No `aria-keyshortcuts`: the caps ARE the accessible name's tail
							 * (`KeyboardShortcut` renders `kbd` for exactly that reason), so the
							 * attribute would announce the same chord twice.
							 */}
							<KeyboardShortcut shortcut={newChatShortcutCap(isMac)} />
						</button>
					</section>
					{/*
					 * The `All chats` and `New chat` rows first, then Pinned chats.
					 *
					 * THIS PLACEMENT IS THE DESIGN ROUND'S (D1, arbitrated), and the reason is
					 * that those two rows are NAVIGATION rather than chats: navigation names
					 * the list, so it precedes the sections that fill it. Above them, the
					 * section sat over the control that names the list it belongs to.
					 *
					 * It sits directly above the `Active chats` heading in the split view and
					 * directly above the flat list in `All chats` mode - the same place on
					 * both, which is what keeps pins from vanishing for anyone using the flat
					 * list (there is no `Active chats` anchor there to sit above at all).
					 *
					 * ZERO PINS RENDERS NOTHING - no heading, no empty section - which is the
					 * TUI's own rule (an empty section contributes no header).
					 */}
					{pinned.length > 0 && (
						<section>
							{heading("pinned", "Pinned chats", true, pinned.length)}
							{(query || isOpen("pinned", true)) &&
								pinned.map((row) => sessionRow(row))}
						</section>
					)}
					{all ? (
						<section>{rest.map((row) => sessionRow(row))}</section>
					) : (
						<>
							<section>
								{heading(
									"active",
									"Active chats",
									true,
									/*
									 * The count is the section's own rows: `rest` is `matching` minus the pinned
									 * ones, and a pinned chat that is running is drawn in the section ABOVE
									 * this one, so counting `matching` here would put a number beside a group
									 * that does not hold that many rows. With no pin store `rest` IS
									 * `matching`, so this is main's own count in the state main ships.
									 */
									rest.filter((row) => row.active).length,
									/*
									 * The bulk read receipt sits with the group the operator
									 * pointed at — the one whose rows carry the completion
									 * checkmarks — while the set it clears is the STORE's, so
									 * the visible column of marks and the count its label names
									 * are the same fact. It is deliberately not duplicated
									 * beside "Previous chats": one gesture, one control. The
									 * flat "All chats" view has none — recorded on the pull
									 * request as deferred rather than papered over, because a
									 * second control site is a second design decision.
									 */
									markAllReadControl,
									/*
									 * The disclosure the reader is handed when clearing the last
									 * mark unmounts the control under their cursor.
									 */
									activeHeadingRef,
								)}
								{(query || isOpen("active", true)) &&
									/*
									 * The empty sentence reads the WHOLE filtered set, not `rest`:
									 * a running chat that is pinned is drawn in the section above,
									 * and "Nothing running right now."` beside it would be a claim
									 * the panel itself contradicts. The rows are `rest`'s, so the
									 * section still holds none of the pinned ones.
									 */
									(matching.some((row) => row.active) ? (
										rest
											.filter((row) => row.active)
											.map((row) => sessionRow(row))
									) : (
										<p className="px-2 text-meta text-ink-dim">
											{livenessUnread
												? "The daemon could not read which chats are running, so this list may be incomplete."
												: "Nothing running right now."}
										</p>
									))}
							</section>
							<section>
								{heading(
									"previous",
									"Previous chats",
									false,
									rest.filter((row) => !row.active).length,
								)}
								{(query || isOpen("previous")) &&
									rest
										.filter((row) => !row.active)
										.map((row) => sessionRow(row))}
							</section>
						</>
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
						!query.trim() && (
							<p className="text-meta text-ink-muted">
								No chats yet. Choose an agent, team or New chat.
							</p>
						)}
					{truncated && (
						<p className="text-meta text-ink-muted">
							Showing up to 500 chats. Older chats remain available in the
							terminal.
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
				    under a `role="alert" text-danger` block about the same thing. */}
					{feed.available && !feed.connected && !error && (
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
			)}
			{(error || profiles.error || teams.error) && (
				<div role="alert" className="pt-2 text-meta text-danger">
					<p>{error || profiles.error?.message || teams.error?.message}</p>
					<button
						type="button"
						className="mt-1 underline"
						onClick={() => {
							void fetchSessions();
							void profiles.refetch();
							void teams.refetch();
						}}
					>
						Retry refresh
					</button>
				</div>
			)}
		</nav>
	);
}
