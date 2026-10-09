/**
 * The sidebar's VIEW: which sections it draws, in what order, grouped and
 * ordered how, WHICH CLOCK the time sections read, and how much of the list is
 * loaded.
 *
 * WHY A MODULE, and it is the reason `chat-list-sections.ts` and
 * `sidebar-split.ts` beside it give: this repository's `node:test` suite cannot
 * render the sidebar (it reads the router, the canonical-sessions store and the
 * desktop capability hooks), so a decision written inline in the component is a
 * decision no test can reach. `scripts/chat-sidebar-view.test.mjs` drives THIS
 * file, and the three invariants the operator asked for are asserted there
 * rather than described in a comment:
 *
 *   1. the conversation being VIEWED is on screen even when it falls outside
 *      the loaded page (`pageRows`), AND a RUNNING row is never withheld by the
 *      page at all: the page is the first N rows of the arrangement plus every
 *      running row beyond it, in both orderings (agent review round 1, A1);
 *   2. a search looks at EVERY conversation, not at the loaded page, and
 *      reveals a match the page would not have reached (`pageRows` under
 *      `searching`);
 *   3. the rows READ in the order their time labels imply (`pageOrder` - the
 *      ONE arrangement, applied before the page is cut: the running rows lifted,
 *      then every other row newest-first by the chosen basis's clock). INVARIANT
 *      3 REPLACED A STABLE PARTITION on 2026-10-08 at the operator's instruction;
 *      `pageOrder` carries the reversal and it keeps the old contract in its own
 *      comment rather than erasing it, because the difference between the two is
 *      the whole of what this change reverses.
 *
 * WHAT THIS REPLACES, and why the operator asked for it (2026-09-25): the
 * column had one control surface, the boundary between its two regions, and no
 * way to see or change how the list itself was arranged. The reference is dsh's
 * sidebar - a header row of three icon-only buttons whose middle one opens a
 * popover of labelled groups - and the pagination is the operator's own
 * contract: 10 rows, then 25, then 50, then a further click each time.
 *
 * WHERE THE OPTIONS STOP. `groupBy` and `orderBy` change how rows are ARRANGED
 * on screen; neither re-orders the catalogue, which owns the order the backend
 * sends (`desktop-session-contract.ts`). A "manual" ordering of the WHOLE list -
 * drag a row out of its section and into another - is deliberately absent: the
 * wire carries no rank for a conversation, and a cross-section drag would have to
 * invent one for rows the catalogue sorts by recency. (The ARRANGEMENT does sort
 * the DRAWN list - that is invariant 3, and `pageOrder` states exactly which
 * clocks it reads - so what is refused here is a rank the row would carry, never
 * a view-side sort of the rows as they arrived.)
 *
 * WHAT CHANGED (issue #693, 2026-09-30). `pins` is a manual order, and the
 * sentence above used to refuse one outright on the grounds that it "would
 * survive neither a relaunch nor the terminal". The relaunch half was the weaker
 * half: it is a fact about where the order is STORED, and this is the store the
 * reader's own view already lives in (`ui-preferences-storage`, validated on
 * read by `parseSidebarView`), so the order survives a relaunch exactly as the
 * section order does. The terminal half is true and is now the SCOPE rather than
 * the objection: the order is a permutation of the pinned ids this app knows,
 * applied by `chat-pin-order.ts` to the Pinned section's rows only - the TUI
 * keeps its own catalogue order, `sessions.pin` stays a boolean with no rank
 * beside it, and nothing in this file re-orders what the backend sent. ("Nothing
 * in this file" stopped being true of the LIST on 2026-10-08 - `pageOrder`
 * arranges the drawn rows - and is still true of the Pinned section and of the
 * pins contract this paragraph is about.) A desktop-local arrangement of one
 * section is a preference; a rank the two surfaces disagree about would be a
 * claim, which is why there is no wire field.
 */

import type { CanonicalSessionRow } from "@shared/store/canonical-sessions-store";
import {
	SIDEBAR_BASES,
	type SidebarBasis,
	isRunningRow,
	isStoppedOnReader,
	rowTimeMs,
	runningOrderMs,
} from "./chat-list-sections";

/** Every section the sidebar can draw, in the order a fresh column draws them. */
export type SidebarSectionKey =
	| "pinned"
	| "running"
	| "today"
	| "week"
	| "older"
	| "agents"
	| "teams";

/**
 * The canonical order, and the reason it is a list rather than a union alone:
 * the popover's reorder control is a permutation of THIS, so a key added here
 * arrives in the popover without a second edit - and a key removed here cannot
 * leave a stale entry behind, because the parser below normalises against it.
 *
 * `pinned` is the one conditional member: it is drawn only when the backend
 * advertises `session_pins`, and its absence from a backend without the
 * capability is `chat-sections.ts`'s decision, not this file's.
 */
export const SIDEBAR_SECTIONS: readonly SidebarSectionKey[] = [
	"pinned",
	"running",
	"today",
	"week",
	"older",
	"agents",
	"teams",
];

/** The label each section prints. Sentence case; CSS sets the capitals. */
export const SIDEBAR_SECTION_LABEL: Record<SidebarSectionKey, string> = {
	pinned: "Pinned",
	running: "Running",
	today: "Today",
	week: "This week",
	older: "Older",
	agents: "Agents",
	teams: "Teams",
};

/**
 * The two sections that live in the AGENTS/TEAMS region rather than in the
 * chats list.
 *
 * THEY GET NO SECOND RULE. `view.hidden` decides whether a section is drawn,
 * for these two exactly as for the five chat sections: `isSectionShown` is the
 * one test, the popover's switch is the one writer, and the region applies the
 * same call the chats list's `drawnSections` applies to its own.
 *
 * WHAT THIS COMMENT USED TO CLAIM, and why it was wrong (operator's
 * view-settings audit, 2026-09-27): "switching an entity section off is the
 * disclosure it already owns (the `Agents` row's chevron and its remembered
 * `expanded` record)". Nothing wired the two. The popover's switch called
 * `toggleSection` and wrote `hidden` on every press, entity key or not, so the
 * panel's tick went out and its "1 section hidden" sentence appeared while the
 * region kept drawing `Agents` in the same frame - the popover and the sidebar
 * disagreeing about one state, which is the strongest form of the bug and the
 * one the report led with.
 *
 * THE DISCLOSURE IS STILL A REAL AXIS, and it is a different one: `expanded`
 * (`localStorage['chat-sidebar-disclosures']`) says whether a drawn entity row's
 * CHILDREN are on screen, and the popover has no control for it. Drawn-collapsed
 * and not-drawn-at-all are two states; reading the disclosure as the spelling of
 * this one would put the tick, the "hidden" sentence and the region's presence
 * behind a per-window record the store cannot see.
 */
export const ENTITY_SECTIONS: readonly SidebarSectionKey[] = [
	"agents",
	"teams",
];

export function isEntitySection(key: SidebarSectionKey): boolean {
	return key === "agents" || key === "teams";
}

/** How the chats list is arranged. */
/**
 * How many rows one collapsible section draws before its own `Show N more`.
 *
 * Eight rather than the chats list's ten, because a section here is a GROUP - an
 * agent's chats, the profiles list - and eight 30px rows is 240px of a 260px
 * column's height: the point of the cap is that two expanded groups plus the
 * chat list still fit in a window without the reader paging the column.
 */
export const SIDEBAR_SECTION_ROWS = 8;

/**
 * The two transitions of a section's raised cap (issue #765).
 *
 * WHY THEY ARE HERE AND NOT INLINE IN THE COMPONENT. The cap is a state machine
 * with two edges, and the sidebar cannot be rendered by this repository's
 * `node:test` suite (see this file's header), so an edge written inline in JSX
 * is an edge no test can reach. `scripts/chat-sidebar-view.test.mjs` drives the
 * cycle below.
 *
 * WHY `releaseSectionCap` DELETES THE ENTRY. The cap map stores only what the
 * reader RAISED; the shipped `SIDEBAR_SECTION_ROWS` is what an absent key means
 * (`cappedRows` reads `caps[key] ?? SIDEBAR_SECTION_ROWS`). Collapsing a section
 * is the reader asking for the compact form back, so the entry goes rather than
 * coming down by a step: a reader who climbed three rungs (8 to 32) and a reader
 * whose last press revealed fewer rows than a page (the ladder's top rung, where
 * the control drew only the rows that existed) both land exactly on the shipped
 * cap, which a subtract-a-page would leave short of or short by - the invariant
 * is "a collapsed section is compact", not "a collapsed section is one page
 * shorter". Removing the key also re-derives the cap for free on the next expand
 * through the same `??`, so there is one spelling of "the shipped cap".
 *
 * WHY IT RETURNS THE SAME MAP WHEN NOTHING IS RAISED. React re-renders on an
 * identity change, and a close of a section nobody widened is not a state
 * change. The disclosure map CANNOT be given the same property (agent review
 * round 1, n1): a toggle always flips its key's value, so every press of that map
 * is a real change, while the cap map has a press - the close of a section nobody
 * widened - that leaves the state alone.
 *
 * THE RAISED ROWS ARE NOT DISCARDED, only the cap that drew them: the sections'
 * rows come from the catalogue the reader already loaded, so a re-expand after a
 * reset costs no fetch (`entityLoads`, the per-group paging ladder, is a
 * different map and is deliberately untouched here).
 */
export function releaseSectionCap(
	caps: Record<string, number>,
	key: string,
): Record<string, number> {
	if (!(key in caps)) return caps;
	const next = { ...caps };
	delete next[key];
	return next;
}

/**
 * The `Show N more` press: raise ONE section's cap by one rung.
 *
 * Keyed, never global - the operator's own note on `sectionCaps` states the
 * reason: a reader who wants the eleventh agent must not also open the eleventh
 * team. The step is `SIDEBAR_SECTION_ROWS` from whatever the section is at, so a
 * section still on the shipped cap (no entry) steps from that cap rather than
 * from zero.
 */
export function raiseSectionCap(
	caps: Record<string, number>,
	key: string,
): Record<string, number> {
	return {
		...caps,
		[key]: (caps[key] ?? SIDEBAR_SECTION_ROWS) + SIDEBAR_SECTION_ROWS,
	};
}

/**
 * A PRESS ON A SECTION HEADING: the disclosure and the raised cap move TOGETHER.
 *
 * WHY THE TWO MAPS ARE ONE TRANSITION. The cap's release edge belongs to the
 * disclosure's close (issue #765), so a press that wrote the disclosure alone -
 * or released the cap alone - would be half of one state change. Written inline
 * in the component, the two halves are reachable by neither test nor reader
 * (this file's header says why), which is how the missing edge shipped; the
 * round-1 review (m1) asked for the transition itself to be executable, and
 * `scripts/chat-sidebar-view.test.mjs` drives both edges through this function.
 *
 * WHY THE RELEASE IS ALSO GATED ON `forcedOpen` (agent review round 1, M1; QA
 * round 1, QA-F1). The sections are force-DRAWN while a LIST QUERY is in force
 * (`query || isOpen(...)` in the component), so a heading press under a query
 * records a close while the section stays on screen. The round-1 shape released
 * the raised cap on that press, dropping the drawn rows back to
 * `SIDEBAR_SECTION_ROWS` - narrowing a section under a reader who never saw it
 * go away, on the one edge the release exists to make safe. The release is
 * therefore tied to the section ACTUALLY closing: the disclosure records a close
 * AND nothing else keeps the section drawn.
 *
 * THE DISCLOSURE IS STILL WRITTEN under a query, which keeps the press's own
 * meaning once the query is cleared - that write is pre-existing behaviour and
 * deliberately out of this fix's scope (round 1 scoped it so).
 */
export function toggleSectionDisclosure(
	expanded: Record<string, boolean>,
	caps: Record<string, number>,
	key: string,
	initial: boolean,
	forcedOpen: boolean,
): { expanded: Record<string, boolean>; caps: Record<string, number> } {
	const next = !(expanded[key] ?? initial);
	return {
		expanded: { ...expanded, [key]: next },
		/* `!next` is the close edge; `!forcedOpen` is the section still being on
		 * screen for a reason the press did not ask about. */
		caps: !next && !forcedOpen ? releaseSectionCap(caps, key) : caps,
	};
}

/**
 * WHETHER THE ROSTER'S FIELD IS DRAWN - and with it whether the filter it carries may
 * NARROW anything, because the two move together (design round 1's D2, agent review's
 * B3, UX round 1's U2 and U3 are one defect seen four ways).
 *
 * WHY IT LIVES HERE, NOT INLINE IN THE COMPONENT. The question is asked by the field's
 * render gate AND by the rows branch below it, and a rule written in JSX is a rule no
 * test reaches (this file's header says why) - which is how U2 survived a pin that only
 * matched the gate's SOURCE TEXT: a source-string assertion proves the line changed, not
 * that the reader keeps their control. Hoisted for the same reason `entityQueryAdmits`
 * and `toggleSectionDisclosure` were, so the press can be MODELLED by
 * `scripts/chat-sidebar-view.test.mjs` - state in, answer out - rather than read.
 *
 * THE FIRST CLAUSE IS THE SECTION BODY'S OWN GATE. The body draws while
 * `query || isOpen(...)`, and the field is that body's control, so the field draws while
 * the body does. Reading the disclosure ALONE was U2: the heading press under a LIST
 * QUERY is a documented no-op on the rows and the chevron - it must not release the
 * raised cap - yet it still took `Filter agents` off the screen and stepped everything
 * below up by the field's own height (measured: present -> absent, section box 413px ->
 * 369px, rows unchanged). A control that vanishes under a press promising to change
 * nothing on screen is the defect; this clause is the remedy.
 *
 * A NARROWER FORM THAT ALSO REQUIRED `rosterFilter` WAS SHIPPED AND REFUSED (round 3). It
 * held the field only when the reader had typed their OWN filter, but U2's repro is a
 * list query with NO section filter - the ordinary "search the sidebar, then press the
 * section" - so the very state the finding measured still lost the control. The state
 * that form added (query + filter + collapsed) is one where the reader's own filter
 * should stay visible beside the query's matches, not a surface nobody owns.
 *
 * THE SECOND CLAUSE IS WHY A QUERY ALONE OPENS NOTHING: the field still needs a
 * cap-bound roster or an applied filter, so a query over a SHORT roster draws no field at
 * all. The rows branch reads THIS value rather than re-testing `rosterFilter`, so there
 * is exactly one spelling of "the filter applies".
 */
export function rosterFieldShown(
	isOpen: boolean,
	query: string,
	rosterFilter: string,
	rosterLength: number,
): boolean {
	return (
		(isOpen || query !== "") &&
		(rosterLength > SIDEBAR_SECTION_ROWS || rosterFilter.trim() !== "")
	);
}

/**
 * A GROWN SECTION'S OWN NAME FOR ITS RESET (issue #765; UX round 1's U1, design
 * round 1's D1).
 *
 * WHY THE RESET NEEDS NAMING AT ALL. Growing a section is one press of
 * `Show N more`; the way back is the section heading pressed TWICE - the first
 * press closes the section (twelve rows to none, 488px to 28px) and the second
 * reopens it on the shipped cap. Both review streams measured that nothing on the
 * surface connects the two: in the grown state the foot is GONE (`foot: null`) and
 * the heading carried `title: null` and `aria-describedby: null`. So the reader
 * who never read the diff cannot find the shrink path, and the press they would
 * find by accident reads as "you closed it" rather than "you are shrinking it".
 *
 * IT NAMES THE TWO-GESTURE SEQUENCE, because the reset IS two presses and each
 * alone surprises with no notice: the collapse alone draws ZERO rows (measured 12
 * -> 0, 488px -> 28px), and it is the REOPEN that draws the compact eight - the
 * raised rows are not kept across the collapse (the invariant
 * `releaseSectionCap` implements: "a collapsed section is compact"). The first
 * wording named collapse and reopen as separate clauses ("Collapse to restore the
 * compact list; reopening draws the compact list again"), which agent review round
 * 3 (R3-3) read as if the first clause alone got the list back, sending a reader
 * who followed it into an empty section. Spelling the ORDER is what makes the copy
 * match the measured journey. Sentence case and no imperative beyond the gestures
 * that exist, so it reads as a description of the control rather than as a second
 * control's label.
 *
 * ONE COPY, TWO CHANNELS: this string is the heading's `title` (the pointer's
 * channel) AND the `sr-only` element the heading points its `aria-describedby` at
 * (every other reader) - the two-channel rule `SENDING_DISCARD_WHY` states in the
 * component, because `title` alone reaches no keyboard reader and is the channel
 * engines are least reliable about.
 */
export const SECTION_GROWN_HINT =
	"Collapse, then reopen, to restore the compact list";

/**
 * IS THIS SECTION DRAWN PAST THE SHIPPED CAP? The one spelling of the question,
 * read by the heading's hint and by `scripts/chat-sidebar-view.test.mjs`;
 * `cappedRows` asks the same thing of the same map (`caps[key] ??
 * SIDEBAR_SECTION_ROWS`) when it slices the rows, so the hint cannot claim a
 * section is grown while the draw says it is not.
 *
 * THE ABSENT KEY IS THE SHIPPED CAP, exactly as in `cappedRows`: a section nobody
 * raised is not grown, and neither is one whose entry sits at the shipped count (a
 * raise always steps FROM the shipped cap by a whole page, so an entry at or below
 * it is the shipped list).
 */
export function sectionIsGrown(cap: number | undefined): boolean {
	return (cap ?? SIDEBAR_SECTION_ROWS) > SIDEBAR_SECTION_ROWS;
}

/**
 * The heading's description element id, KEYED like the panel's other
 * `aria-describedby` targets (`draftWhyId`, `rowMenuClauseId`), so two sections
 * cannot describe themselves with each other's sentence.
 *
 * IT IS RENDERED ONLY WHILE THE HINT APPLIES and the attribute points at it only
 * while it is: a dangling id resolves to no description at all, which is the rule
 * the attribute's own comment in the component states.
 */
export const sectionGrownHintId = (key: string) => `section-grown-hint-${key}`;

/**
 * THE SECTION FOOT'S VISIBLE LABEL, in one spelling (the singular was inline in
 * the component and the plural was its template). `Show 1 more` is its own
 * sentence rather than a pluralised one because that is what the panel's other
 * remainders say.
 */
export const sectionMoreLabel = (hidden: number) =>
	hidden === 1 ? "Show 1 more" : `Show ${hidden} more`;

/**
 * THE SECTION FOOT'S ACCESSIBLE NAME (UX round 1's N1): the visible label names
 * the REMAINDER but not the section, and two sections can each carry a foot, so a
 * screen reader heard a bare `Show 4 more` twice over on one panel (both streams
 * measured `aria-label: null` and `title: null` on it).
 *
 * THE GROUP FOOT ONE LEVEL DOWN ALREADY FIXED THIS, in its own words
 * (`"<foot.aria> in <name>"`); this control's shape is not that one because a
 * section is not a container the reader owns - it IS the list - so the name reads
 * as the remainder plus what the remainder is made of.
 *
 * `unit` comes from the section's own key at the call site (`agents`, `teams`),
 * which is the string `data-sidebar-section-more` already carries: one word for the
 * section, not a second vocabulary beside it.
 */
export function sectionMoreName(hidden: number, unit: string): string {
	return `${sectionMoreLabel(hidden)} ${unit}`;
}

export type SidebarGroupBy = "section" | "agent" | "flat";

/**
 * How the chats list is ordered - the two meanings, restated on 2026-10-08
 * because the operator's instruction reversed what they were.
 *
 * `active-first` is the operator's own word ("sorting active to the top"): a
 * conversation with a turn in flight, or one stopped on the reader, is lifted
 * above the rest, and EVERY row then runs newest-first by the basis's clock.
 * `recent` ("Most recent") is ONE order over the whole list with no lift.
 *
 * WHAT THE TWO SHARE: a RUNNING row is never keyed by its activity clock, so a
 * response landing in a running chat re-sorts nothing (`pageOrder` carries why
 * and whose words). What separates them is only the lift.
 */
export type SidebarOrderBy = "active-first" | "recent";

/** The whole view preference, as it is persisted. */
export type SidebarView = {
	/** Sections the popover switched off. Draws no label and no rows. */
	hidden: SidebarSectionKey[];
	/** The user's order: a permutation of `SIDEBAR_SECTIONS`. */
	order: SidebarSectionKey[];
	/**
	 * The Pinned section's manual row order: a permutation of the pinned
	 * conversation ids the client has ranked (issue #693).
	 *
	 * EMPTY IS THE DEFAULT AND IS NOT AN ARRANGEMENT: an empty array means nobody
	 * has moved a pinned row yet, and the section then draws the catalogue's own
	 * order passed through (`chat-pin-order.ts` rule 1). It holds SESSION IDS rather
	 * than rows, so a stored entry outlives the row it names - the materialization
	 * drops an id the client no longer has rather than rendering it, which is why
	 * this field is allowed to go stale and why the parser can do no more than
	 * demand strings.
	 */
	pins: string[];
	groupBy: SidebarGroupBy;
	/**
	 * Which clock the time sections and the row labels read.
	 *
	 * Declared beside `groupBy`/`orderBy` because it is a third, independent axis
	 * of the same panel: it changes NEITHER the grouping nor the order - it changes
	 * what the numbers measure (`chat-list-sections.ts` carries the semantics).
	 */
	basis: SidebarBasis;
	orderBy: SidebarOrderBy;
	/** How many times "Load more" has been pressed. 0 is the first page. */
	loads: number;
	/**
	 * The agents the reader pinned, held at the top of the roster.
	 *
	 * Keys are the roster ROW's stable id, not a display name - and
	 * `chat-sidebar-agents.ts` carries the verified finding that on today's
	 * profile wire the two are one string - because a pin has to outlive a
	 * rename. Read and written as a SET: the array's own order is not
	 * load-bearing (the band orders by recency), a key naming no row the roster
	 * holds is inert rather than invalid, and `PINNED_AGENTS_MAX` bounds it.
	 */
	pinnedAgents: string[];
};

export const DEFAULT_SIDEBAR_VIEW: SidebarView = {
	hidden: [],
	order: [...SIDEBAR_SECTIONS],
	pins: [],
	groupBy: "section",
	basis: "active",
	orderBy: "active-first",
	loads: 0,
	pinnedAgents: [],
};

/**
 * The page ladder: 10, then 25, then 50, then 50 more per press.
 *
 * The operator's contract, verbatim: "starts with 10, then 25, then 50, and
 * then user can click to load more". The increments past 50 are 50 rather than
 * a doubling, because the click is a user's decision to read the next slice and
 * a doubling would load a thousand rows on the fifth press - which is a
 * scrolling surface the column does not have and a read nobody asked for.
 */
export const CHAT_PAGE_START = 10;
export const CHAT_PAGE_STEPS = [25, 50] as const;
export const CHAT_PAGE_STEP = 50;

/**
 * The ceiling `loads` is clamped to on read (review round 3, R13).
 *
 * The ladder's arithmetic overflows long before a stored value stops being
 * finite: `pageLimit` computes `50 + (steps - 2) * 50`, so any `loads` past
 * ~3.6e306 returns Infinity and the foot's label takes `Infinity - Infinity` into
 * `Show NaN more chats`. Nothing in the app writes a value like that - this is
 * the tampered-storage edge of `parseSidebarView`, which already floors,
 * type-checks and degrades everything else it reads - so the clamp is the
 * read-side piece of the same rule: the largest read this list can ask for is the
 * 500-row page the store's own cap names, and no stored number may exceed it.
 */
export const CHAT_PAGE_MAX = 500;

/**
 * The ceiling on `pinnedAgents`, enforced on read AND on press.
 *
 * The same discipline `CHAT_PAGE_MAX` above states for the page counter, one
 * field over: nothing in the app writes more pins than the roster has agents,
 * and the parser is the tampered-storage edge of a blob a user can edit by
 * hand, so the count is clamped rather than trusted. It is a COUNT and not a
 * validation - the roster the pins name is not loaded at parse time - so a pin
 * naming an agent the reader no longer holds degrades by being inert, never by
 * taking the view down. `chat-sidebar-agents.ts`'s `togglePinnedAgent` clamps
 * its own press to this same bound.
 */
export const PINNED_AGENTS_MAX = 64;

/** How many rows a list that has been "load more"-ed `loads` times draws. */
export function pageLimit(loads: number): number {
	const steps = Math.max(0, Math.floor(loads));
	if (steps === 0) return CHAT_PAGE_START;
	if (steps <= CHAT_PAGE_STEPS.length) return CHAT_PAGE_STEPS[steps - 1];
	return (
		CHAT_PAGE_STEPS[CHAT_PAGE_STEPS.length - 1] +
		(steps - CHAT_PAGE_STEPS.length) * CHAT_PAGE_STEP
	);
}

/**
 * The label on the foot control, which names the size of the NEXT page.
 *
 * The step is bounded by what is actually left (`remaining`), so the control
 * cannot offer ten rows when four are unloaded - the operator's own reference
 * prints `Show 4 more sessions`, not the ladder's next rung. And `remaining`
 * now comes from `pageReveal` where the list can compute it (follow-up a,
 * 2026-10-08), because a live row inside the next slice is already drawn: the
 * sentence names the rows the press ADDS, never the rows that merely exist.
 */
export function pageMoreLabel(loads: number, remaining: number): string {
	const step = pageLimit(loads + 1) - pageLimit(loads);
	const add = Math.max(0, Math.min(step, remaining));
	return add === 1 ? "Show 1 more chat" : `Show ${add} more chats`;
}

/**
 * The rows a press of the foot will ACTUALLY add, over the rows already held.
 *
 * WHY THIS IS NOT `remaining`. The page is a window of the arrangement PLUS
 * every live row beyond it (agent review round 1, A1), so a RUNNING row inside
 * the next slice is already DRAWN - it was drawn as a stray the moment it fell
 * outside the window. Counting it as something a press `reveals` overstates: the
 * review's own measurement (round 2, follow-up a) observed `Show 15 more chats`
 * revealing 14, because one of the fifteen positions in the next slice was a
 * live row already on screen.
 *
 * ZERO IS A RUNG-ONLY PRESS, and it is why there is a fallback rather than a
 * clamp: when every row in the slice is live (each already drawn), the press
 * still moves the ladder's rung and the daemon's own tail may answer with rows -
 * so the sentence states the bounded step as before rather than offering
 * `Show 0 more chats`. Reachable only with step-many live rows below the cut,
 * which is why the fallback is a sentence and not a second control.
 */
export function pageReveal(
	ordered: readonly CanonicalSessionRow[],
	loads: number,
	remaining: number,
): number {
	const step = pageLimit(loads + 1) - pageLimit(loads);
	const from = pageLimit(loads);
	const to = Math.min(from + step, ordered.length);
	let live = 0;
	for (let index = from; index < to; index += 1) {
		if (isActiveRow(ordered[index] as CanonicalSessionRow)) live += 1;
	}
	const add = Math.max(0, to - from - live);
	if (add > 0) return add;
	return Math.max(0, Math.min(step, remaining));
}

/**
 * The rows that count as ACTIVE for the lift.
 *
 * IT IS THE RUNNING SECTION'S OWN PREDICATE, imported rather than restated:
 * a second copy of the status codes here is how the section and the lift come
 * to disagree, and the failure that produces is a row lifted out of a section
 * it is not in - or, worse, a row filed under RUNNING that the page can push
 * below the fold the lift exists to keep it out of.
 */
export function isActiveRow(row: CanonicalSessionRow): boolean {
	return isRunningRow(row);
}

/**
 * The lane a row occupies under `active-first`, in draw order: the turns
 * stopped on the reader, then the other running rows, then everything else.
 *
 * `recent` puts every row in lane 0 (`pageOrder` states why the two orderings
 * differ by exactly this).
 */
function liftLane(row: CanonicalSessionRow): number {
	if (isStoppedOnReader(row)) return 0;
	if (isRunningRow(row)) return 1;
	return 2;
}

/**
 * The clock the arrangement reads for one row: a running row's own key (the
 * last USER message, else its birth) or the chosen basis's clock for every
 * other row.
 */
function orderKeyMs(
	row: CanonicalSessionRow,
	basis: SidebarBasis,
): number | null {
	return isRunningRow(row) ? runningOrderMs(row) : rowTimeMs(row, basis);
}

/**
 * Newest first, and "no clock" after every row WITH one - the same rule
 * `chat-remote.ts` wrote for the merge this arrangement replaces: "no clock" is
 * not "now", and a row that prints no label (`rowTimeMs` is the one door for
 * both facts) belongs below the rows that print one.
 */
function byNewest(a: number | null, b: number | null): number {
	if (a === null && b === null) return 0;
	if (a === null) return 1;
	if (b === null) return -1;
	return b - a;
}

/**
 * The arrangement - invariant 3's whole implementation, and the ONE place the
 * drawn order of a chat row is decided. It is applied BEFORE the page is cut
 * (`pageRows` takes the head of this list), so pressing `Show more` reveals rows
 * rather than re-arranging the ones on screen.
 *
 * THE RULE (the operator's, 2026-10-08), in three clauses:
 *
 *   - a RUNNING row is never ordered by its activity. A response lands in a
 *     running chat's transcript on every turn, and a section that re-sorted on
 *     each write flickers under the reader's cursor; so a running row's key is
 *     the time of its last USER message (`runningOrderMs`), which is the one
 *     event that SHOULD move it to the front of the running band - and until
 *     core publishes that field, its birth (`created_at`), which does not move
 *     at all;
 *   - under `active-first` the running rows are LIFTED above the rest - the
 *     ones stopped on the reader (`approval`, `answer`: a turn that cannot
 *     proceed without them) above the other running rows - each band
 *     newest-first; every other row then runs newest-first by the BASIS clock,
 *     which is the same clock its label prints (`rowTimeMs`);
 *   - under `recent` there is NO lift: one order over every row, running rows
 *     keyed by `runningOrderMs` and the rest by the basis clock.
 *
 * THE KEY IS TOTAL, and every term is deliberate. Rows whose keys tie keep the
 * order they arrived in (the catalogue's own), never an id or a title: those
 * are stable facts about a row and say nothing about when it moved. The total
 * key is also what makes this function IDEMPOTENT - `pageOrder(pageOrder(x))`
 * equals `pageOrder(x)`, because a tie is broken by the row's POSITION, and an
 * arranged array already holds its ties in the order they were placed in.
 *
 * WHY `Array.prototype.sort` IS FINE HERE, when this function used to refuse
 * it: the old contract was a stable PARTITION ("the active rows sit above the
 * rest WITHOUT inverting recency below them"), and its comment warned that a
 * comparator "is also free to reorder the rows it did not intend to touch".
 * That warning was about a comparator with a hidden second key; this one states
 * every key it reads - lane, clock, arrival - so there is nothing left for the
 * engine's stability to decide, and the order no longer depends on V8's sort
 * being stable today. THE OLD BEHAVIOUR IS WORTH STATING because it was the
 * shipped rule for ten days: it lifted running rows and left everything else in
 * the catalogue's arrival order - which is CREATION order (`session/catalog.py`
 * ranks `(tier, wake band, -created_at, id)`), so the list drew `15h` under
 * `6d` and the operator's report is exactly that pair disagreeing.
 *
 * WHAT IT DELIBERATELY DOES NOT ARRANGE: the Pinned section (the reader's own
 * manual order, `chat-pin-order.ts`'s to apply) and a QUERY's rows. A search
 * answer is ranked by relevance (`chat-search.ts`), and a clock order over it
 * would be a second ranking authority over the one the reader searched with; so
 * the component does not call this function while a query is on, and the three
 * invariants above still hold for the list it draws.
 */
export function pageOrder(
	rows: readonly CanonicalSessionRow[],
	orderBy: SidebarOrderBy,
	basis: SidebarBasis,
): CanonicalSessionRow[] {
	const keyed = rows.map((row, index) => ({
		row,
		index,
		lane: orderBy === "active-first" ? liftLane(row) : 0,
		at: orderKeyMs(row, basis),
	}));
	keyed.sort(
		(a, b) => a.lane - b.lane || byNewest(a.at, b.at) || a.index - b.index,
	);
	return keyed.map((entry) => entry.row);
}

export type PageResult = {
	/** The rows to draw, in order. */
	rows: CanonicalSessionRow[];
	/**
	 * Whether the viewed conversation was LIFTED into the page - drawn although
	 * it sits past the loaded page. The component draws it as its own row at the
	 * head of the list, above the sections, so the reader can see where they are
	 * without loading 400 rows to get there.
	 */
	lifted: boolean;
	/**
	 * Rows past the page, i.e. how many `Show more` would reveal. A running row
	 * beyond the window is drawn, not counted here (the cut never withholds a
	 * live row - A1): what is left to reveal is the arranged rows past the
	 * window that are not live.
	 */
	remaining: number;
};

/**
 * The page - invariants 1 and 2.
 *
 * `searching` bypasses the limit entirely, and that is invariant 2 rather than a
 * convenience: the backend's search answers over an index of every conversation,
 * including ones this client has never loaded (`chat-search.ts`'s synthesised
 * hits), so a page applied to the ANSWER would hide the very row the search was
 * run to find. The limit is a browsing affordance; it is not a filter, and it
 * must not act as one.
 *
 * The lift is for the same reason from the other side: a reader who opens a
 * conversation from a notification, a link or the terminal has a viewed row the
 * catalogue put at position 300, and "you are here" is not something a page
 * size may take away.
 */
export function pageRows(
	ordered: readonly CanonicalSessionRow[],
	options: {
		limit: number;
		currentId?: string | null;
		searching?: boolean;
	},
): PageResult {
	const { limit, currentId, searching = false } = options;
	if (searching) {
		return { rows: [...ordered], lifted: false, remaining: 0 };
	}
	/*
	 * THE PAGE IS A WINDOW OF THE ARRANGEMENT, PLUS EVERY LIVE ROW BEYOND IT.
	 *
	 * The first `limit` rows of the arranged list are drawn in order, and a
	 * RUNNING row the window did not reach is drawn as well, in place. The cut is
	 * a DISCLOSURE, and a disclosure must not be a way to hide live work: agent
	 * review round 1 (A1) measured `Most recent` at rung 10 drawing ZERO of 2 live
	 * turns against 40 completed ones, because under `recent` a running row keyed
	 * by its (old) birth sorts below the cut - while `origin/main` had drawn it,
	 * by the accident of the catalogue's tier order.
	 *
	 * WHY THE WINDOW AND NOT "RUNNING ROWS COST NO QUOTA", which is
	 * `entityRows`' rule one level down. Both keep the guarantee; the difference
	 * is the page's SIZE, and the size was measured. Under the no-quota shape the
	 * page holds N non-running rows PLUS every running row, so the size is a
	 * function of the LIVE SET: each completion moves its row from the free set
	 * into the quota (evicting the tail row the quota held) and each new turn
	 * does the reverse. The geometry rig (`sidebar-resort-geometry.mjs --assert`)
	 * turned three cells red on exactly that: with the reader parked at the
	 * scroll extreme, the one-row shrink clamped `scrollTop` 152 -> 120 and the
	 * viewport "moved -32 px while a row re-filed". A page whose height churns
	 * with every completion is the flicker this change exists to remove, so the
	 * list's page is the window: size N, stable across completions that land
	 * inside it, with live rows drawn in place instead of lifted (the lift is
	 * `active-first`'s own rule, and `recent` exists for a reader who asked for
	 * one clock). `entityRows` keeps its own shape - its bound is a per-group
	 * disclosure with its own pinned contract - and both surfaces share only the
	 * guarantee: a live row is never behind the cut.
	 *
	 * `remaining` counts every row not drawn, so the foot's number and the drawn
	 * set agree by construction.
	 */
	const head: CanonicalSessionRow[] = [];
	let quota = Math.max(0, limit);
	for (const row of ordered) {
		if (quota > 0) {
			head.push(row);
			quota -= 1;
			continue;
		}
		if (isActiveRow(row)) head.push(row);
	}
	const remaining = Math.max(0, ordered.length - head.length);
	if (!currentId) return { rows: head, lifted: false, remaining };
	/*
	 * The drawn set is no longer a prefix, so "is it already drawn" is a
	 * membership test and not an index comparison - `head.includes` asks the
	 * question the old `index < head.length` used to stand for.
	 */
	const viewed = ordered.find((row) => row.session_id === currentId) ?? null;
	if (viewed === null || head.includes(viewed)) {
		return { rows: head, lifted: false, remaining };
	}
	return { rows: [viewed, ...head], lifted: true, remaining };
}

/** What one expanded entity's session list draws, and what it withholds. */
export type EntityRows = {
	/**
	 * The rows to draw, in the order they were GIVEN (the arrangement's) - with
	 * the viewed conversation at the head when the bound withheld it (see
	 * `lifted`).
	 */
	rows: CanonicalSessionRow[];
	/**
	 * Whether `rows[0]` is the viewed conversation, lifted: it is drawn OUT OF the
	 * order it was given because the bound withheld it from where it belongs.
	 * `false` when it is drawn in place, or is not this group's row at all.
	 */
	lifted: boolean;
	/** Rows this group holds and the bound did not draw, the lifted one excepted. */
	hidden: number;
	/** How many rows this group holds in total, drawn or not. */
	held: number;
};

/**
 * One EXPANDED ENTITY's own sessions, bounded by the operator's ladder.
 *
 * WHY THIS EXISTS (operator, 2026-09-27: "there's far too many team/agent
 * messages shown on screen at once when expanded, can you have max 10 at first
 * sorted by most recent/active then click to load more"). The chats list has
 * been bounded since the ladder shipped (`pageRows` above); the rows INSIDE an
 * expanded team or agent were not, so a team with 41 conversations drew all 41
 * into a column that also holds the chats list and every other expanded group.
 *
 * THE ORDER IS THE ARRANGEMENT'S, AND THIS FUNCTION ONLY TAKES A PREFIX OF
 * WHAT IT IS HANDED. "Sorted by most recent/active" is now true of the rows as
 * they are GIVEN, because the component arranges a group's rows through the
 * same `pageOrder` call the chats list uses before this bound applies (2026-
 * 10-08: the nested lists carried the same creation-ranked defect the list did,
 * and the operator's instruction - "across surfaces" - is why one arrangement
 * serves both). So the bound never re-orders: it slices the arranged list, and a
 * group cannot disagree with the list above it about which clock puts a
 * conversation where. (The old text here argued the opposite - that applying
 * `pageOrder` would be a "SECOND ordering authority" beside the wire's tier
 * order - and the premise is the same false one the arrangement's own comment
 * records: the wire's key ranks by `-birth`, not by activity.)
 *
 * RUNNING ROWS ARE EXEMPT FROM THE BOUND, and this is the one rule the brief did
 * not state. The bound is a DISCLOSURE, and a disclosure must not be a way to
 * hide live work: a conversation with a turn in flight, or one stopped on the
 * reader for an approval, is the thing they most need to see, and at position 40
 * of 41 the bound would put it behind a press. `isActiveRow` is the RUNNING
 * section's own predicate, imported rather than restated so the exemption and
 * the section cannot disagree about what "running" means. (The shape is dsh's -
 * rows that must never be hidden leave the quota before it applies - but the
 * ladder's numbers are the operator's, not dsh's.) Under the arrangement a
 * running row usually leads the group rather than sitting in place at 40; the
 * exemption still matters for the rows the lift did not reach (a group whose
 * running row is OLDER than its first ten by the arrangement's key), which is
 * exactly the case this story's frame photographs.
 *
 * A SEARCH IS NEVER BOUNDED, which is `pageRows`' invariant 2 one level down:
 * the reader's query already narrowed these rows, so a bound applied on top of
 * it could only hide a HIT - and a search that returns nothing for a session
 * that exists is worse than a long list. The rows handed here are the group's
 * already-queried rows, so `searching` bypasses the cut entirely.
 *
 * THE VIEWED CONVERSATION IS LIFTED, NOT ADMITTED. Raising the limit until the
 * reader's own row fits was the alternative and is refused: in a 41-row group
 * whose viewed row sits at 40, admitting it in place draws 40 rows - exactly the
 * complaint this change exists to answer. One row is drawn at the head instead,
 * wearing the panel's own `rowCurrent` ground, and the rest keep the arranged
 * order exactly.
 */
export function entityRows(
	rows: readonly CanonicalSessionRow[],
	options: {
		/** How many times this group's own `Show more` has been pressed. */
		loads: number;
		/** The conversation the transcript pane is drawing, if any. */
		currentId?: string | null;
		/** A query is active: the bound does not apply. */
		searching?: boolean;
	},
): EntityRows {
	if (options.searching) {
		return { rows: [...rows], lifted: false, hidden: 0, held: rows.length };
	}
	const limit = pageLimit(options.loads);
	const drawing: CanonicalSessionRow[] = [];
	let quota = limit;
	for (const row of rows) {
		/*
		 * Running rows cost no quota - see the exemption above. They are pushed in
		 * place, so the order the reader sees is still the catalogue's.
		 */
		if (isActiveRow(row)) {
			drawing.push(row);
			continue;
		}
		if (quota > 0) {
			drawing.push(row);
			quota -= 1;
		}
	}
	const currentId = options.currentId;
	const viewed =
		currentId == null
			? null
			: (rows.find((row) => row.session_id === currentId) ?? null);
	const lifted = viewed !== null && !drawing.includes(viewed);
	return {
		/*
		 * THE VIEWED ROW LEADS, the same shape and the same reason as `pageRows`: the
		 * one way to guarantee the reader can see where they are is to draw it, and
		 * the one way to keep that from being silent is to make it be first rather
		 * than to move a row the rest of the list is ordered around.
		 */
		rows: lifted && viewed !== null ? [viewed, ...drawing] : drawing,
		lifted,
		hidden: rows.length - drawing.length - (lifted ? 1 : 0),
		held: rows.length,
	};
}

/**
 * The foot control on ONE expanded entity, or `null` when there is nothing to
 * disclose.
 *
 * WHY THE LABEL AND THE POSITION ARE ONE RETURNED FACT (the brief's fourth rule:
 * "the count and the disclosure must agree"). The group's badge states the
 * conversations the group HOLDS - the census, on a paging daemon - and it says
 * nothing about how many of them are drawn, so `41` beside ten rows is a reader
 * unable to tell ten-of-41 from all-of-41. The position rides in the control
 * that already exists rather than in a second line, because this change is about
 * vertical space: a disclosure line added to every bounded group would cost the
 * height the bound was introduced to save.
 *
 * `drawn of total`, not `hidden of total`: the badge already states the total, so
 * the number the reader cannot get anywhere else is how many they are looking at.
 */
export function entityMore(args: {
	/**
	 * Rows this group's press will ADD, already bounded by whatever can give them
	 * (the ladder's next step, or the daemon's own page behind the cursor).
	 */
	add: number;
	/** Rows this group is drawing right now, the lifted one included. */
	drawn: number;
	/** What this group's own badge states, so the two numbers agree. */
	total: number;
}): { label: string; aria: string } | null {
	if (args.add <= 0) return null;
	const label =
		args.add === 1 ? "Show 1 more chat" : `Show ${args.add} more chats`;
	/*
	 * The position appears exactly while the badge states more than the reader is
	 * looking at, and not otherwise - so it can never contradict the badge, and a
	 * group that is fully drawn keeps the bare label it has today.
	 */
	if (args.drawn >= args.total) return { label, aria: label };
	const position = `${args.drawn} of ${args.total}`;
	return {
		label: `${label} · ${position}`,
		/*
		 * WCAG 2.5.3 (round 1, U4): the accessible name must contain the visible
		 * label, so the name reuses the label's own ` · ` joining rather than a
		 * comma - the visible string is then a prefix of the name, and
		 * `chat-sidebar.tsx` appends only the group's name (`… shown in minervadev`).
		 */
		aria: `${label} · ${position} shown`,
	};
}

/**
 * The vertical gap that separates two ENTITY SECTIONS in the one scroller.
 *
 * WHY THERE ARE TWO VALUES AND NOT ONE SMALLER CONSTANT (operator, 2026-09-27:
 * "Also shrink the gap between agents and teams headers when agents is
 * collapsed, there's an extra gap wasting space there"). Measured on the panel
 * at 360px: the gap between the `Agents` and `Teams` headings is **16.0px**
 * whether the first section is collapsed or expanded - it is `space-y-4` on the
 * wrapper that holds both sections, and it does not know whether there are rows
 * for it to separate. So the value is genuinely SHARED between the two cases,
 * and lowering the constant would silently tighten the expanded case as well,
 * where the 16px is doing real work (it is what tells the reader that the twelve
 * agent rows above belong to `Agents` and the rows below to `Teams`).
 *
 * Hence a CONDITIONAL value, keyed on the one thing that changes the reading: a
 * section that draws no rows has nothing for a section rhythm to separate, so
 * the heading below it sits at the list's own 8px step instead. The condition is
 * "does the preceding section draw rows", not "how many rows" - so a collapsed
 * section with nothing in it and a collapsed section holding forty chats space
 * identically, which is the case that a per-count rule would get wrong.
 */
export const ENTITY_SECTION_GAP = "mt-4";
/** The same gap when the section above it is collapsed and draws no rows. */
export const ENTITY_SECTION_GAP_COLLAPSED = "mt-2";

export function entitySectionGap(previousDrawsRows: boolean): string {
	return previousDrawsRows ? ENTITY_SECTION_GAP : ENTITY_SECTION_GAP_COLLAPSED;
}

/**
 * Whether an ENTITY row survives the list's query (issue #663, UX round 1's U1).
 *
 * The rule has been the entity region's since the redesign: a query narrows the
 * whole column, and an entity whose NAME does not carry the query is dropped
 * unless it still has rows to draw (`!name.includes(query) && !rowCount`), so a
 * query for a conversation inside a group keeps the group, and a query for an
 * agent's name keeps the agent.
 *
 * WHY IT IS A FUNCTION NOW. The roster filter's empty sentence said "No agents
 * match" off `filteredAgents` alone, so it went quiet in the one state the two
 * filters make together: the roster filter admits an agent, the LIST query drops
 * every admitted agent's row (name misses, no rows survive the query), and the
 * section drew a blank gap under a field that said nothing - the reviewer's
 * `refresh f10` frame. The sentence is honest only when it counts what actually
 * DRAWS, and that is this predicate rather than a second, drifting copy of it:
 * the row itself (`entity`) and the sentence's count both call it.
 *
 * SEMANTICS ARE THE GATE'S OWN, deliberately untidied: the query is NOT trimmed
 * here (the caller's is), and the comparison is `toLocaleLowerCase` on both
 * sides, which is the same case rule `chat-search.ts` states for the list.
 *
 * AND A ROW IS ALSO FOUND BY THE WORDS A READER SEES (the team-labels change,
 * 2026-09-30). A team carries a slug `name` and an optional display `label`, and
 * the sidebar draws the label - so after this change a query for `release-crew`
 * would drop a team drawn as `Release Engineering` unless the gate read the
 * visible word too, which is the defect the label work exists to remove one
 * surface over. The arm is OPTIONAL because only teams have a label: an agent
 * row passes nothing and keeps exactly the gate it had. Both spellings are
 * matched rather than the label replacing the slug, because the slug is still
 * the word a power user types and `/team <slug>` is still how the team is
 * addressed.
 */
export function entityQueryAdmits(
	name: string,
	rowCount: number,
	query: string,
	label?: string,
): boolean {
	if (!query) return true;
	return (
		name.toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
		(label ?? "").toLocaleLowerCase().includes(query.toLocaleLowerCase()) ||
		rowCount > 0
	);
}

/** One group of the agent-grouped list. */
export type SidebarRowGroup = {
	key: string;
	label: string;
	rows: CanonicalSessionRow[];
};

/**
 * The arranged list under a given `groupBy`.
 *
 * THE ORDER IS THE ARRANGEMENT'S, and this function does not touch it: the rows
 * arrive arranged (`pageOrder`), and this groups them while preserving that
 * order inside every group - a partition by binding, never a second ordering
 * authority. `section` returns null and leaves the arrangement to
 * `chat-list-sections.ts`'s own partition, which is where the RUNNING/TODAY/
 * WEEK/OLDER rules live and the only place they should: a second implementation
 * of "which section is this row in" is how the labels and the lift disagree.
 * `agent` groups by the row's binding - its team, else its agent - and `flat`
 * is one unlabelled group.
 *
 * UNGROUPED IS A REAL GROUP rather than a leftover, and it is drawn rather than
 * dropped: an untargeted chat, a chat whose agent was deleted, and a chat opened
 * from the terminal all land here, and a group-by that made them invisible would
 * be a filter wearing a layout's name.
 */
export function groupRows(
	rows: readonly CanonicalSessionRow[],
	groupBy: SidebarGroupBy,
): SidebarRowGroup[] | null {
	if (groupBy === "section") return null;
	if (groupBy === "flat") return [{ key: "all", label: "", rows: [...rows] }];
	const groups = new Map<string, SidebarRowGroup>();
	for (const row of rows) {
		const name = row.binding?.team || row.binding?.agent || "";
		const key = name || "ungrouped";
		const group = groups.get(key) ?? {
			key,
			label: name || "Ungrouped",
			rows: [],
		};
		group.rows.push(row);
		groups.set(key, group);
	}
	// Ungrouped last, however early it appeared: it is the residual, and a
	// residual drawn first pushes every named group below the fold's midpoint.
	const out = [...groups.values()];
	const residual = out.findIndex((group) => group.key === "ungrouped");
	if (residual > 0) out.push(...out.splice(residual, 1));
	return out;
}

/** Whether a section draws, under this view. */
export function isSectionShown(
	view: SidebarView,
	key: SidebarSectionKey,
): boolean {
	return !view.hidden.includes(key);
}

/** The sections to draw, in the view's own order, hidden ones removed. */
export function shownSections(view: SidebarView): SidebarSectionKey[] {
	return view.order.filter((key) => isSectionShown(view, key));
}

/**
 * Switching a section off, or back on.
 *
 * NO SECTION IS UNDROPPABLE, including `running`: the popover that switched one
 * off is the same control that switches it back, and a section that could not be
 * hidden would be a preference the popover lies about. The rejected alternative
 * is the one `hideRegion` above rejects for the same reason - a state the user
 * cannot leave - and the difference is that this state is reachable only from
 * the popover that undoes it, while a panel with both regions hidden has no
 * boundary left to hold the control that restores one.
 */
export function toggleSection(
	view: SidebarView,
	key: SidebarSectionKey,
): SidebarView {
	const hidden = view.hidden.includes(key)
		? view.hidden.filter((entry) => entry !== key)
		: [...view.hidden, key];
	return { ...view, hidden };
}

/**
 * Moving a section up or down one place - the popover's move pair, which is the
 * ONLY route to a reordered section list at this head: no drag-and-drop reorder
 * ships (`docs/design/sidebar-sections.md` records the decision), so this is not
 * an alternate to anything.
 *
 * AND IT WRITES A DIFFERENT AXIS THAN THE DIVIDER'S ARROW. That control swaps
 * which REGION draws first (`chat-sidebar.tsx`'s region order), while this one
 * writes `view.order` - which SECTION draws first. The two cannot disagree
 * because they never write the same field, not because they share one order, so
 * a future editor must not try to keep a single order in sync between them. (An
 * earlier revision of this comment claimed both; neither held - review round 3,
 * R14.)
 *
 * The move is over the SHOWN sections, and it stays that way when a hidden one
 * sits between: the reader is looking at what is drawn, so "up" has to mean the
 * section above the one they can see. The result is still a permutation of the
 * full list, because the splice swaps two entries of `view.order` and never
 * rebuilds it from the visible subset.
 */
export function moveSection(
	view: SidebarView,
	key: SidebarSectionKey,
	direction: -1 | 1,
): SidebarView {
	const shown = shownSections(view);
	const at = shown.indexOf(key);
	const target = shown[at + direction];
	if (at < 0 || target === undefined) return view;
	const from = view.order.indexOf(key);
	const to = view.order.indexOf(target);
	const order = [...view.order];
	order[from] = target;
	order[to] = key;
	return { ...view, order };
}

/**
 * The four sections the CHATS region draws, in the order a fresh column draws
 * them.
 *
 * Pinned is not one of them, and neither are the two entity sections: Pinned
 * renders as its own partition above the chats list and always first, and the
 * entity region draws Agents and Teams in fixed source order. See
 * `canMoveSection` for what that costs a reorder press.
 */
export const CHAT_SECTION_KEYS: readonly SidebarSectionKey[] = [
	"running",
	"today",
	"week",
	"older",
];

export function isChatSection(key: SidebarSectionKey): boolean {
	return CHAT_SECTION_KEYS.includes(key);
}

/**
 * Whether a section's move arrow can do what its label says (2026-09-28, D1;
 * tightened the same day for the empty-section case).
 *
 * THE DEFECT IT ANSWERS, measured on the operator's own panel by pressing the
 * arrows: the pair used to be offered on every non-entity row and enabled by
 * "is there a shown section above/below", so a press could (a) sit on Pinned,
 * whose row the column always draws first - the press rewrote the popover's own
 * list and moved nothing on screen - or (b) swap a chat section with an entity
 * key, which the column cannot honour either, because the entity region draws
 * below the chats list in fixed order. In both cases the popover then disagreed
 * with the column it was describing.
 *
 * THE RULE: a chat section's arrow is enabled only when the move would change
 * what the reader is looking at - the section being moved AND the adjacent
 * SHOWN section in that direction must both be sections the column DRAWS.
 * Pinned and the entity rows draw no pair at all (the menu's own rule); a
 * hidden section cannot move - it is not drawn, so "up" has no meaning for it;
 * and an EMPTY chat section draws nothing either (`chat-sidebar.tsx`: "An empty
 * section contributes no label"), so a swap with one rewrites the stored order
 * while the column stands still - round 1's m1/U1, whose repro was Today's
 * down-arrow enabled against an empty `week`, and whose mirror is an empty
 * `running` as the source of an equally invisible down-press.
 *
 * WHAT DRAWABILITY IS NOT THIS MODULE'S TO KNOW: it is a fact about the loaded
 * rows, which the renderer holds and this pure model does not. So the caller
 * passes the predicate it can answer - the sidebar's own per-section counts,
 * the same numbers the section headers draw - and an absent predicate keeps
 * the geometric rule only, which is what a caller with no rows to point at
 * can honestly answer.
 */
export function canMoveSection(
	view: SidebarView,
	key: SidebarSectionKey,
	direction: -1 | 1,
	draws?: (key: SidebarSectionKey) => boolean,
): boolean {
	if (!isChatSection(key)) return false;
	if (draws && !draws(key)) return false;
	const shown = shownSections(view);
	const at = shown.indexOf(key);
	if (at < 0) return false;
	const target = shown[at + direction];
	if (target === undefined || !isChatSection(target)) return false;
	return draws ? draws(target) : true;
}

const GROUP_BY: readonly SidebarGroupBy[] = ["section", "agent", "flat"];
const ORDER_BY: readonly SidebarOrderBy[] = ["active-first", "recent"];

/**
 * A stored view, or the default.
 *
 * ONE UNION AND NO PARTIAL STATE, which is the same rule `parseSidebarRegions`
 * states and for the same reason: a sidebar that cannot read its own preference
 * must look like a sidebar nobody has configured. So an unknown `groupBy`
 * (or `orderBy`, or `basis`) contributes the default rather than dropping the
 * whole view, `order` is NORMALISED against `SIDEBAR_SECTIONS` - unknown keys
 * dropped, missing ones appended in canonical order, duplicates removed - and a
 * `hidden` entry that is not a section is discarded. The alternative, trusting
 * the blob, is a column that draws six of seven sections and has no control
 * that could name the missing one.
 *
 * `loads` is clamped rather than rejected: it is a click counter, and a
 * tampered `1e9` would ask the list for a page larger than the catalogue it is
 * paging (the store already caps a list read at 500 rows, which is the honest
 * bound and is stated in the sidebar's own note when it is hit).
 *
 * `pins` IS CHECKED FOR SHAPE AND FOR NOTHING ELSE, and that is the honest bound
 * rather than a gap: its entries are conversation ids, which are the BACKEND's to
 * issue, so this module cannot enumerate the set the way it enumerates
 * `SIDEBAR_SECTIONS`. So an entry that is not a non-empty string is dropped, a
 * duplicate is dropped, and an id that names a conversation this client no longer
 * has is KEPT - only the panel knows which rows exist (`chat-pin-order.ts`
 * materializes against the ids it is drawing and drops the rest there). Dropping
 * unknown ids here would be this parser guessing at a fact it does not hold, and
 * the guess would be wrong in the one direction that loses an arrangement: a
 * pinned chat outside the loaded page is still pinned.
 *
 * `pinnedAgents` gets the same treatment `pins` states, plus the one thing a
 * roster-keyed list CAN bound and a conversation-keyed one cannot: a count.
 * Only non-empty STRINGS survive, the list is deduped (first occurrence
 * winning), and `PINNED_AGENTS_MAX` clamps it. Its keys are as opaque to this
 * module as `pins`' ids are - the roster they name is not loaded here - so an
 * entry naming no row the roster holds is kept and inert rather than treated
 * as invalid, which is the difference between a preference that has outlived
 * an agent and a tampered blob.
 */
export function parseSidebarView(value: unknown): SidebarView {
	if (typeof value !== "object" || value === null) return DEFAULT_SIDEBAR_VIEW;
	const raw = value as Partial<Record<keyof SidebarView, unknown>>;
	const known = new Set<string>(SIDEBAR_SECTIONS);
	const order: SidebarSectionKey[] = [];
	if (Array.isArray(raw.order)) {
		for (const entry of raw.order) {
			if (typeof entry !== "string") continue;
			if (!known.has(entry)) continue;
			if (order.includes(entry as SidebarSectionKey)) continue;
			order.push(entry as SidebarSectionKey);
		}
	}
	for (const key of SIDEBAR_SECTIONS) if (!order.includes(key)) order.push(key);
	const hidden: SidebarSectionKey[] = [];
	if (Array.isArray(raw.hidden)) {
		for (const entry of raw.hidden) {
			if (typeof entry !== "string") continue;
			if (!known.has(entry)) continue;
			if (hidden.includes(entry as SidebarSectionKey)) continue;
			hidden.push(entry as SidebarSectionKey);
		}
	}
	const groupBy = GROUP_BY.includes(raw.groupBy as SidebarGroupBy)
		? (raw.groupBy as SidebarGroupBy)
		: DEFAULT_SIDEBAR_VIEW.groupBy;
	const basis = SIDEBAR_BASES.includes(raw.basis as SidebarBasis)
		? (raw.basis as SidebarBasis)
		: DEFAULT_SIDEBAR_VIEW.basis;
	const orderBy = ORDER_BY.includes(raw.orderBy as SidebarOrderBy)
		? (raw.orderBy as SidebarOrderBy)
		: DEFAULT_SIDEBAR_VIEW.orderBy;
	const loads =
		typeof raw.loads === "number" && Number.isFinite(raw.loads) && raw.loads > 0
			? Math.min(CHAT_PAGE_MAX, Math.floor(raw.loads))
			: 0;
	const pinnedAgents: string[] = [];
	if (Array.isArray(raw.pinnedAgents)) {
		for (const entry of raw.pinnedAgents) {
			if (typeof entry !== "string") continue;
			// An empty key can never name a row and does not count against the cap.
			if (entry === "") continue;
			if (pinnedAgents.includes(entry)) continue;
			if (pinnedAgents.length >= PINNED_AGENTS_MAX) break;
			pinnedAgents.push(entry);
		}
	}
	const pins: string[] = [];
	/*
	 * THE DEDUPE IS A SET because this array is unbounded and the loop is reached on
	 * every render of every mounted reader of the view (agent review round 1, R7):
	 * `pins.includes` per entry makes the parse quadratic in a persisted list nothing
	 * here caps. The array is still what is returned - the ORDER of the stored
	 * entries is the arrangement - so only the membership test moves.
	 */
	const ranked = new Set<string>();
	if (Array.isArray(raw.pins)) {
		for (const entry of raw.pins) {
			if (typeof entry !== "string") continue;
			if (entry.length === 0) continue;
			if (ranked.has(entry)) continue;
			ranked.add(entry);
			pins.push(entry);
		}
	}
	return { hidden, order, groupBy, basis, orderBy, loads, pins, pinnedAgents };
}
