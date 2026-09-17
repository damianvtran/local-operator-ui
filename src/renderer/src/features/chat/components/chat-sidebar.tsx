import { compatibilityBannerShown } from "@shared/api/local-operator/backend-error";
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
import { useDesktopFeed } from "@shared/hooks/use-desktop-feed";
import { cn } from "@shared/lib/utils";
import {
	type CanonicalSessionRow,
	useCanonicalSessionsStore,
} from "@shared/store/canonical-sessions-store";
import {
	Bot,
	ChevronDown,
	ChevronRight,
	List,
	MessageSquarePlus,
	MoreHorizontal,
	Plus,
	Users,
	X,
} from "lucide-react";
import {
	type KeyboardEvent,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { SESSION_SEARCH_MAX_CHARS } from "../../../../../shared/desktop-contract";
import {
	chatCountAnnouncement,
	hitsAnswerQuery,
	lostRowsToStaleAnswer,
	rowTrailingStatement,
	searchAnswerIsClipped,
	searchChats,
} from "../chat-search";
import { clearSearch } from "../clear-search";
import { newChatShortcutCap } from "../new-chat-shortcut";
import { catalogueGate } from "../sidebar-catalogue-gate";

type Props = {
	selectedConversation?: string;
	onSelectConversation: (id: string) => void;
	onStageDraft: (target?: ChatTarget, fresh?: boolean) => void;
};
const rowStyle =
	"flex h-8 min-w-0 items-center gap-1 rounded-md px-1 text-body-sm leading-5 hover:bg-elevated focus-visible:outline focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2";

/**
 * The ground of the row this panel is currently ON — the selected conversation,
 * the All chats filter, the New chat row staging an untargeted draft, and the
 * agent or team an untargeted-vs-targeted draft names.
 *
 * WHY THE STEP IS `highlight`. This panel is `bg-surface` (the
 * `nav aria-label="Chats"` root), and a selection needs a step off it that is
 * SEEN and no more than that. `highlight` is the palette role authored for this
 * ground — a shallow step off `surface` in the direction the mode runs, at ΔE00
 * 2.18-2.28 across the twelve palettes the port started from, which is above the
 * perceptual threshold `docs/branding.md` § 3 cites and well under the `sunken`
 * well it replaced (3.75-14.94 from `surface`, the operator's "very dark colour"
 * measured).
 *
 * WHY NOT THE ACCENT WASH. `accentWash` is ΔE00 **1.05** from `surface` in
 * tokyoNight (#262B3F on #24283B) — the operator's own report, "you can't tell
 * from the sidebar which one is selected", measured. Hover is louder than
 * selection in that theme (the `elevated` step those rows already carry, ΔE00
 * 4.58), so the pointer read as the current row while the current row did not.
 * That is not one palette's accident: measured over the set, the wash sits under
 * the ΔE00 **2.0** field floor against `surface` in **seven** of the fifty-nine
 * palettes (worst `catppuccinMacchiato` 0.80, then tokyoNight 1.05), where the
 * twelve the port started from had only the one (the next lowest there, dracula,
 * at 3.28).
 * The wash is not broken everywhere — the app rail paints it on `sunken`, where
 * it measures 9.6 — which is why this is a call-site ground and NOT a wash:
 * strengthening `accentWash` for the panels that draw it on `surface` would make
 * every hover tint in the app louder. (The SETTINGS rail was the other `surface`
 * panel and takes this same role: `features/settings/components/settings-sidebar.tsx`.)
 *
 * WHY NOT `sunken`, WHICH IS WHAT THIS USED TO BE. `sunken` is the RECESSED
 * role: a well, a track, a code ground — a hole in the panel rather than a mark
 * on it — and at 3.75-14.94 from `surface` it read as the dark box the operator
 * reported. It is also 97 `*-sunken` utility occurrences across 66 files under
 * `src/renderer` — 85 live class usages and 12 inside prose, the palettes and the
 * generated stylesheet excluded — so the row could not be quietened by moving
 * the role; the row needed one of its own.
 *
 * WHY NOT `elevated`. It is the same rows' hover step, so selection and hover
 * would land on the same ground and the current row would be indistinguishable
 * from the one under the pointer — the pair measured ΔE00 0.77 in obsidian when
 * the selection ground was the wash. The contract now asserts `highlight`
 * against `surface`, `elevated` AND `sunken` at the field floor for exactly that
 * reason, with `elevated` the binding pair (worst case 2.52, obsidian).
 *
 * AND WHY THE GROUND IS NOT THE ONLY SIGNAL — THE SECOND STEP.
 * The operator asked for a SUBTLE selection, so the step up is bounded: at ΔE00
 * 2.18-2.28 `highlight` is deliberately quieter than the `sunken` box it replaced,
 * and that quietening is what exposed the hazard underneath it. The rows around a
 * current one carry `hover:bg-elevated`, and `elevated` is a LOUDER step off
 * `surface` than `highlight` on the dark palettes — measured in the shipped
 * frames, a hovered neighbour sits ΔE00 2.20-4.58 from the panel while the
 * current row sits 2.18-2.35, so the pointer's transient mark outranked the
 * persistent one (selection over hover: 0.93 / 0.97 / 1.89 before this change,
 * 0.48 / 0.52 / 0.49 after). Raising `highlight` would undo what was asked for,
 * so the current row carries a SECOND, non-colour step instead: `font-medium`,
 * exactly as `features/settings/components/settings-sidebar.tsx` already marks
 * its current destination ("bg-highlight font-medium text-ink
 * hover:bg-highlight"). That makes the two rails agree rather than inventing an
 * idiom, and it gives the persistent state a signal the transient one does not
 * have. The weight is the only thing this adds: the row's box, height, padding
 * and alignment are unchanged, and the measurement that says so is in
 * `docs/evidence/chat-sidebar-current-row/README.md`.
 *
 * AND WHY IT IS ON TWO ELEMENTS OF THE ENTITY ROW. The mark cannot be carried by
 * one class there: the name button inside the row carries `rowStyle`, so its
 * `hover:bg-elevated` paints over the wrapper's ground and the pointer replaced
 * the mark across the whole row (round 1, the MAJOR this file's entity row was
 * changed for). The wrapper paints the ground — it fills the gaps and the rounded
 * corners the 24px controls leave — the name button paints it too, because its
 * own `hover:` half is the only thing that beats the step it inherits, and the
 * two 24px controls drop their hover step while the row is current. That is one
 * state spread over three elements by the DOM, not three decisions;
 * `scripts/chat-sidebar-selection.test.mjs` resolves each expression through the
 * shipped `cn` for that reason rather than looking for a name.
 *
 * WHY THE HOVER OVERRIDE IS IN THIS STRING. `rowStyle` carries
 * `hover:bg-elevated`, and a hover variant outranks a bare background in the
 * cascade, so without it every row here replaces its selection ground with the
 * hover ground under the pointer: a state the user is IN would be repainted as
 * the state the pointer is in, and `highlight` and `elevated` are both STEPS OFF
 * `surface` rather than opposites — in the dark palettes both sit above it, and
 * in the light ones `elevated` is the only one above it, so the two would be read
 * as one ramp with the pointer at the top. Stating the ground again at
 * `hover:` is what stops that, and `cn` is what makes it hold: tailwind-merge
 * resolves the two `hover:bg-*` in favour of the later one, so the inherited
 * step is dropped rather than landing second.
 * `scripts/chat-sidebar-selection.test.mjs` asserts that resolution through the
 * shipped `cn`, and `contrast-contract.mjs` pins this string — a bare
 * `bg-accent-wash` here is invisible in tokyoNight and no palette assertion can
 * see a class.
 */
const rowCurrent = "bg-highlight font-medium text-ink hover:bg-highlight";

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
	const isOpen = (key: string, initial = false) => expanded[key] ?? initial;
	const toggle = (key: string, initial = false) =>
		setExpanded((current) => ({
			...current,
			[key]: !(current[key] ?? initial),
		}));
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
	const search = useChatSearch(query, ready && searchSupported);
	const overLong = search.refused;
	/*
	 * The hits the answer actually contributes, held once: `searchChats` consumes
	 * them and the counts below read their honesty off the same array, so the two
	 * cannot disagree about which answer is in hand.
	 */
	const hits = hitsAnswerQuery(search.data, query)
		? search.data.sessions
		: null;
	const {
		rows: matching,
		conversationMatches,
		synthesized,
	} = useMemo(
		() => searchChats(sessions, query, hits),
		[sessions, query, hits],
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
		return searchChats(sessions, search.data.query, search.data.sessions);
	}, [answered, search.data, sessions, query]);
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
	const sessionRow = (row: CanonicalSessionRow, nested = false) => {
		const trailing = rowTrailingStatement({
			marked: conversationMatches.has(row.session_id),
			unstarted: unstarted.has(row.session_id),
			nested,
			binding: bindingName(row),
		});
		return (
			<button
				key={row.session_id}
				type="button"
				data-chat-row
				/* Named for the driver, which has to OPEN a conversation before the chat
				   header - and so the right slot's three triggers - exists at all
				   (`renderer-driver.mjs`'s `browser-pane` scene). A tour tag rather than a
				   class: it is the same hook every other drivable control in this app
				   carries, and it is inert outside a driver run. */
				data-tour-tag="chat-session-row"
				data-child={nested || undefined}
				className={cn(
					rowStyle,
					"w-full text-left",
					nested && "pl-7",
					selectedConversation === row.session_id &&
						!activeDraftKey &&
						rowCurrent,
					// m4: the unread mark is NOT here. `font-semibold` on this
					// `flex-1 truncate` title rewrote the visible string when the
					// mark arrived, re-truncating text under the reader's cursor;
					// it lives in the reserved status slot instead (see `Status`).
				)}
				aria-current={
					selectedConversation === row.session_id && !activeDraftKey
						? "page"
						: undefined
				}
				/* The tooltip carries the row's binding and its own state — the facts the
			   row may not be drawing — and deliberately NOT the search mark's words,
			   which the row announces itself through the `sr-only` span beside it:
			   both channels saying "matched in conversation" would be one fact
			   announced twice (review round 4, R23). Stated as the rule the
			   expression below implements: the tooltip completes the set minus the
			   MARK'S words, which is the only statement it withholds. The binding
			   and ", not sent yet" are appended in every case, so on a row that
			   draws one of those the tooltip repeats it rather than omitting it
			   (review round 6, R33). */
				title={`${row.title || "Untitled chat"}${bindingName(row) ? ` (${bindingName(row)})` : ""}: ${row.status?.label ?? (synthesized.has(row.session_id) ? "found by search, beyond the chats listed here" : "Recent")}${unstarted.has(row.session_id) ? ", not sent yet" : ""}${row.attention?.unseen ? ", unread" : ""}`}
				onClick={() => onSelectConversation(row.session_id)}
			>
				<ChatSessionStatus row={row} />
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
		 * button inside it carries `rowStyle` — whose `hover:bg-elevated` a CHILD
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
							!staged && "hover:bg-elevated",
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
							!staged && "hover:bg-elevated",
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
	const heading = (
		key: string,
		label: string,
		initial: boolean,
		count?: number,
	) => (
		<button
			type="button"
			data-chat-row
			className="flex h-7 w-full items-center gap-1 rounded-md px-1 text-body-sm font-medium text-ink-muted hover:bg-elevated"
			aria-expanded={query ? true : isOpen(key, initial)}
			onClick={() => toggle(key, initial)}
		>
			{query || isOpen(key, initial) ? (
				<ChevronDown className="size-3.5" />
			) : (
				<ChevronRight className="size-3.5" />
			)}
			<span className="flex-1 text-left">{label}</span>
			{/* A zero badge next to a group that already says it is empty is the
			    same fact twice; only a non-zero count carries information. */}
			{count !== undefined && count !== 0 && countBadge(count)}
		</button>
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
			<div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-1">
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
									{profiles.data?.map((profile) =>
										entity("agent", profile.name),
									)}
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
			    scrolling entity region and owns its own scroll area. */}
			{showList && (
				<div className="mt-2 max-h-[45%] shrink-0 space-y-4 overflow-y-auto border-t border-hairline pt-2">
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
						    `hover:bg-elevated` colour step; and the `rowCurrent`
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
							 * `rowCurrent` ground carries the state, and the chord is drawn the
							 * same way on every ground it lands on, which is what makes it one
							 * idiom rather than one idiom plus an exception.
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
					{all ? (
						<section>{matching.map((row) => sessionRow(row))}</section>
					) : (
						<>
							<section>
								{heading(
									"active",
									"Active chats",
									true,
									matching.filter((row) => row.active).length,
								)}
								{(query || isOpen("active", true)) &&
									(matching.some((row) => row.active) ? (
										matching
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
									matching.filter((row) => !row.active).length,
								)}
								{(query || isOpen("previous")) &&
									matching
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
