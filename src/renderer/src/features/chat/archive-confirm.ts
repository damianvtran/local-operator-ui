import { ARCHIVE_UNDO_TOAST_MS } from "./archive-undo";

/**
 * What a CONFIRMED archive says, and what it does to the reader's place.
 *
 * WHY A MODULE, for the reason `chat-pin-order.ts` beside it gives: this
 * repository's `node:test` suite cannot render the sidebar or the dialog (they read
 * the router, the canonical-sessions store and the desktop capability hooks), so a
 * sentence or a rule written inline in a component is one no test can reach - and
 * both of these are claims the change is answerable for.
 *
 * WHY THE SENTENCE IS HERE AND NOT IN THE DIALOG. The body is the promise the act
 * can keep, and every clause of it is a fact about the shipped build: the archived
 * conversation leaves the lists and the search, the store raises an Undo in the
 * update that settles the write (`ARCHIVE_UNDO_TOAST_MS`), and the search block's
 * remembered `Include archived` control is the whole of the second path back to it.
 * Keeping it out of the component is what lets it be asserted without a browser, so
 * it cannot quietly become false when one of those three moves.
 *
 * WHY THE FOCUS RULE IS HERE TOO. It moved OFF the press. Archiving asks first now,
 * so at the moment of the press the row is still on screen and the caret belongs to
 * the DIALOG (Radix moves it in) - which means the successor has to be resolved at
 * CONFIRM time, from a subtree that is not the row's. The rule itself is unchanged,
 * and the measurements that shaped it travel with it below.
 */

/**
 * The archive confirmation's body, and the only place it is written.
 *
 * SHAPE: the CONSEQUENCE first, then the way back (design round 1, D1; UX round 1,
 * U3 and its NIT). The first draft led with a clause that contradicted its own
 * third ("leaves your lists and search" ... "search finds it again"), buried the
 * act's one fact - it leaves your lists - behind recovery copy, and said "a few
 * seconds" for a number the build can state. Sentence case, one statement, no second
 * question: `docs/branding.md`'s modal copy asks the question once in the title.
 *
 * THE DURATION IS INTERPOLATED from `ARCHIVE_UNDO_TOAST_MS`, so the copy and the
 * timer that makes it true cannot drift: a claim a reader can time with a watch has
 * to be the number the toast actually runs on (`docs/branding.md` §8, "every claim
 * checkable").
 *
 * BOTH WAYS BACK ARE NAMED because they are different doors - Undo is the immediate
 * one and it EXPIRES, the search block's `Include archived` is the one that still
 * works tomorrow - and the second names what to DO, not where a thing "is found":
 * the control exists only inside a search (drawn once a query is typed), so the
 * sentence says to search first.
 *
 * WHERE, IN THE PRODUCT'S OWN WORDS (design round 2, D10; UX round 2, U7): "the
 * sidebar's search" had two homes - the `Search` palette row at the top, which
 * deliberately does not widen to archived rows and has no such control, and the
 * field labelled `Search chats and agents` in the list band, which does. "Search
 * above your chats" points at the second and not the first. The sentence ENDS on
 * the restore control by name (U8): an archived hit's row control reads
 * `Unarchive`, so the reader is told the verb that finishes the job instead of a
 * bare "restore it". Two rendered lines is the target (design round 2, D11), which
 * is why it is a list of three short acts rather than a clause that explains them.
 *
 * `\u201cInclude archived\u201d` in curly quotes is the control's own label, spelled
 * exactly as the search block draws it, so the sentence sends the reader to a thing
 * they can find by the name they were given.
 */
export const ARCHIVE_CONFIRM_MESSAGE = `It leaves your lists. You can undo for ${ARCHIVE_UNDO_TOAST_MS / 1000} seconds; after that, search above your chats, turn on \u201cInclude archived\u201d, then Unarchive it.`;

/**
 * What the question names when nobody can say which conversation it is: the store
 * holds no row for it and the asking surface carried no title. A question that put
 * nothing inside curly quotes would read as a bug, and this reads as the act.
 */
export const ARCHIVE_CONFIRM_UNNAMED = "this conversation";

/**
 * The verb the question opens with. The NAME is the caller's and it ellipsises;
 * this half and the question mark never give, because "Archive…" is not a question
 * and "…?" is not an act (`archiveOfferedName`'s R2-3 rule, applied to the title).
 */
export const ARCHIVE_CONFIRM_VERB = "Archive";

/**
 * The row box a confirmed archive should hand the caret on from, or null.
 *
 * Null is a real case and not a defensive one: a typed `/archive` can name a
 * conversation the list is not drawing (it is off this client's catalogue page, or
 * a filter has hidden it), and the typed door does not ask for the successor rule
 * at all. It is answered rather than thrown so a caller can ask unconditionally.
 */
export function archiveRowBox(sessionId: string): HTMLElement | null {
	return document.querySelector<HTMLElement>(
		`[data-session-row="${CSS.escape(sessionId)}"]`,
	);
}

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
 * WHAT CHANGED WITH THE CONFIRMATION, and why the caller passes a row BOX now: the
 * old call site passed the pressed CONTROL and ran at press time. Archiving asks
 * first, so the press no longer removes anything - the dialog does, one confirm
 * later - and the snapshot has to be taken by whoever knows the confirmation was
 * accepted. `archiveRowBox` is how that caller finds the row without a press event
 * to read. The rule below is untouched, including the reason it reads the DOM.
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
export function focusRowAfterRemoval(pressed: HTMLElement): () => void {
	const listRows = Array.from(
		document.querySelectorAll<HTMLElement>(
			'[data-sidebar-region="chats"] [data-chat-row]',
		),
	);
	/*
	 * WHICH ROW WAS PRESSED, read from the row the control sits in rather than from the control's own
	 * parent: the archive control and the row's button are SIBLINGS inside a pair wrapper, so
	 * `pressed.parentElement?.querySelector("[data-chat-row]")` answered nothing and the successor
	 * rule below fell through to `live[0]` - the LIST'S FIRST conversation, on every route, where the
	 * row that took the pressed row's place was a different element (MEASURED by UX round 2:
	 * `indexTheHandOffComputes: -1` against `trueIndexFromClosest: 1`, across four routes - mouse and
	 * `⌘⇧A`, at the list's head and from a scrolled position - every one landing on the first row).
	 * The scope below was already right; without this line the rule it feeds never ran.
	 *
	 * `closest` on the row BOX returns the box itself, which is what the confirm-time caller passes -
	 * the same lookup, one door further on.
	 */
	const rowButton =
		pressed
			.closest<HTMLElement>("[data-session-row]")
			?.querySelector<HTMLElement>("[data-chat-row]") ?? null;
	/*
	 * WHICH ORDER THE SUCCESSOR IS READ FROM, because the region alone is not enough: inside the list
	 * it is the list's own region - that is the order the reader sees, and the region the caret
	 * belongs in (UX round 2, U1). A press whose row is NOT one of the list's rows keeps the PANEL's
	 * order, so that press still hands the caret to its neighbour instead of sending it down to the
	 * list's first row, which is what a region-only query with an unresolved index does. The entity
	 * region's nested rows carry the same archive control, which is why this case is written rather
	 * than assumed away.
	 */
	const rows =
		rowButton !== null && listRows.includes(rowButton)
			? listRows
			: Array.from(document.querySelectorAll<HTMLElement>("[data-chat-row]"));
	const index = rowButton === null ? -1 : rows.indexOf(rowButton);
	return () => {
		const live = rows
			.map((element, position) => ({ element, position }))
			.filter(({ element }) => element.isConnected);
		const successor =
			live.find(({ position }) => position > index)?.element ??
			live.filter(({ position }) => position < index).at(-1)?.element;
		/*
		 * `preventScroll`, because the hold above is the only thing that may move the reader and this
		 * callback is not the hold: a plain `focus()` scrolls its element into view itself, and the
		 * successor is chosen from DOCUMENT order - so it can be a node of the ENTITY region, which in
		 * the one-scroll panel shares the reader's own scroller. MEASURED on the merged panel (QA
		 * round 2, Q2's clauses): an ACCEPTED archive moved the reader's `scrollTop` `20 -> 4`, took a
		 * surviving row's top with it by 16px, and left the arrival's own yield clause red for a
		 * scroll the app had no business writing. `focus()` says where the caret is; where the reader
		 * is standing is the reader's - the division `holdFocusedRow` states for its own correction.
		 *
		 * WHICH node takes the caret is SCOPED TO THE CHATS REGION AND RESOLVED FROM THE PRESSED ROW
		 * (UX round 2, U1 and U2). The scope is load-bearing for the same reason it is at the
		 * pile-clearing hand-off below: the one-scroll change put both regions in ONE document order, so
		 * the document's first `[data-chat-row]` is the ENTITY region's `Agents` disclosure - and that is
		 * where the caret landed, MEASURED (`region=entities`, `aria-expanded=true`, roughly 500px above
		 * the row that was pressed), identically from the first row and through the `⌘⇧A` chord; the next
		 * `↓` then walked the panel from its top instead of the list from where the reader was. The index
		 * is what makes the successor RULE run: with it resolved, the caret goes to the row that took the
		 * pressed row's place (the next live row, or the last one before it when the pressed row was the
		 * list's last), and the clause that records this leg's closure asserts that row by id - so the
		 * claim and the reading are the same statement rather than a region that both satisfy.
		 */
		successor?.focus({ preventScroll: true });
	};
}
