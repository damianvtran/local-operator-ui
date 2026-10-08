/**
 * The chat header's identity menu: the panel one of the two chip controls opens.
 *
 * WHAT THIS IS, AND WHAT IT REPLACED (operator, 2026-09-26). The controls shipped
 * as two Radix MENUS holding one flat list of every profile the catalogue
 * answered with. That list had no ceiling, no filter and no shape: measured on
 * the operator's own machine, the agent menu ran past the bottom of the window
 * with the roster scrolling off the screen behind it, twenty-odd rows in
 * alphabetical order and no way to reach a named one except by reading.
 *
 * WHY THE PANEL IS NOT A MENU ANY MORE. A Radix menu IS the wrong instrument for
 * a filterable list, and not by taste: `MenuContentImpl`'s keydown handler runs
 * on EVERY character key typed inside its content and answers it with typeahead,
 * which moves focus off the field onto whatever row matched
 * (`setTimeout(() => newItem.focus())` in `@radix-ui/react-menu@2.1.24`). A
 * search field inside a menu is a field the menu keeps taking the cursor out of.
 * `role="menu"` with a text box in it is also not a thing ARIA describes. So the
 * panel is a POPOVER holding the app's own combobox - the same shape the settings
 * and hosting fields use (`searchable-select.tsx`), the modal pickers use
 * (`picker-host.tsx`) and the command palette uses: a field that keeps focus, a
 * listbox the arrow keys walk through `aria-activedescendant`, and Enter on the
 * row the field is pointing at.
 *
 * THE KEYBOARD CONTRACT, in full, because a picker driven from the keyboard is
 * where "add a search field" gets dangerous:
 *
 * - The chip is a BUTTON, not a field. Typing while a closed picker has focus
 *   does nothing and opens nothing - there is no path by which a stray keystroke
 *   lands in a menu the user did not ask for. Enter, Space and a pointer press
 *   open it; that is the whole open vocabulary.
 * - On open the SEARCH FIELD takes focus and keeps it for the panel's whole life.
 *   ArrowUp/ArrowDown move the active row (wrapping, exactly as the modal pickers
 *   do) and never move focus, so filtering and steering happen in one breath:
 *   type `rev`, ArrowDown, Enter.
 * - Enter commits the ACTIVE row - with a fresh filter, the first SETTABLE row
 *   that matched, because the highlight is seeded onto the current or first
 *   settable row (issue #861's constraint makes refused rows a permanent class
 *   rather than a transient one; review round 1, D2/U1). With a filter that
 *   matches nothing, Enter does NOTHING: a profile must exist to be switched
 *   to, there is no free-text path here, and the panel says so in words rather
 *   than accepting a name the owner would reject. On a refused row, Enter
 *   ANSWERS instead of staying silent - the footer's live region says which row
 *   cannot take the seat, so the key is never a no-op a user cannot read.
 * - Escape closes and Radix returns focus to the chip. Tab leaves the panel and
 *   dismisses it too (the field claims the key before Radix's focus scope can
 *   loop it back - see `onClose`). Neither leaves focus inside a closed
 *   surface.
 * - The pointer's own action is the click (`PickerRow` picks on `mousedown`), so
 *   hovering a row and pressing Enter still picks the ACTIVE row - the keyboard's,
 *   not the pointer's. That is `picker-host`'s rule, kept here so the two surfaces
 *   cannot disagree about what Enter means.
 *
 * WHERE FOCUS GOES WHEN THE MOUSE IS USED. Both paths keep focus in the field:
 * the panel's own `onMouseDown` is prevented (the reason
 * `searchable-select.tsx` states for its list), and `PickerRow` prevents the
 * default on the row's own mousedown. So a click picks a row without ever moving
 * focus out of the combobox, which is what keeps `onFocusOutside` meaning "the
 * user left the control" rather than "the user clicked something".
 *
 * THE BOUND, AND WHY IT IS TWO NUMBERS. `IDENTITY_MENU_MAX_HEIGHT` is the design
 * ceiling; `--radix-popover-content-available-height` is the room Radix found
 * where the panel actually opened, and the class takes the smaller. A chip near
 * the top of a tall window gets the ceiling and scrolls inside it; the same chip
 * near the bottom of a short one gets a shorter panel that still fits, because
 * Radix flips it to the side with room and reports what that side has. Either way
 * the panel NEVER escapes the window, and either way the rows it does not show
 * are still reachable: the list scrolls, and the field filters. Nothing here
 * truncates the roster - see `chat-header-identity-menu-model.ts`, which states
 * the bound/search/recents composition and is where the rules are pinned.
 */

import { Input } from "@shared/components/ui/input";
import { PopoverContent } from "@shared/components/ui/popover";
import { cn } from "@shared/lib/utils";
import { Search } from "lucide-react";
import {
	type FC,
	Fragment,
	type KeyboardEvent,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import type { ProfileRecencyKind } from "../../../shared/store/ui-preferences-store";
import {
	type PickerOption,
	PickerRow,
	filterPickerOptions,
} from "../pickers/picker-host";
import {
	IDENTITY_MENU_MAX_HEIGHT_CLASS,
	identityMenuBands,
	identityMenuFooter,
	identityMenuRefusalAnnouncement,
	identityMenuSeedActive,
	identityMenuShowsList,
} from "./chat-header-identity-menu-model";

export type IdentityMenuProps = {
	/** Which of the two controls this panel belongs to. */
	kind: ProfileRecencyKind;
	/**
	 * Whether the panel is up. The component is MOUNTED for as long as the header
	 * is (Radix's presence removes the DOM, not this component), so this is what
	 * tells it that a new open has begun - and the reset and the focus below are
	 * the two things a new open owes.
	 */
	open: boolean;
	/** The listbox's id: what the field's `aria-controls` names. */
	listId: string;
	/**
	 * The catalogue's rows, already carrying the `current` marking - the row the
	 * CHIP's label reports, which is the team's manager on a team-bound session
	 * with no `/agent` (see `menuValue` in the control).
	 */
	options: PickerOption[];
	/** Names this app has switched to before, most recent first. */
	recents: readonly string[];
	/** The roster is still on its way. */
	loading: boolean;
	/** The registry's refusal, in its own words; `null` when there is none. */
	loadError: string | null;
	/** What the roster says when it answered with nothing at all. */
	emptyText: string;
	/**
	 * The bound team's acceptance rule for the agent slot (issue #861), in the
	 * register this panel's sentences use, or `null` when there is none. It is
	 * the SAME rule the rows were marked by (`disabled` + the reason in the
	 * row's description): stated once here rather than on every row, so the
	 * caption explains the list and the row explains itself. The three non-list
	 * states render no caption - there is no list for a rule to be about.
	 */
	caption: string | null;
	/**
	 * The runtime's strict rule has CLOSED this seat (a team owns the session):
	 * the sentence that says so and names the way out, or `null` while the seat
	 * is open. When set the panel is not a list at all - no field, no rows, no
	 * roster fetch - because a list with every row disabled would read as a
	 * choice that is merely unavailable, where the truth is that the runtime
	 * refuses every name. The panel exists so the reason is VISIBLE on press
	 * (keyboard and touch have no hover, which is all a tooltip would give).
	 */
	closedReason?: string | null;
	/** The note's id, which the trigger's `aria-controls` names while it is up. */
	closedNoteId?: string;
	onPick: (value: string) => void;
	/**
	 * The TAB path (UX round 1, U1): the field claims Tab and asks the control
	 * to dismiss, because Radix's non-modal `PopoverContent` still passes
	 * `loop: true` to its `FocusScope` and this panel's only tabbable is the
	 * field - so the scope would swallow Tab/Shift+Tab and Escape would be the
	 * only exit, against this component's contract. The control dismisses AND
	 * hands focus to its chip, and suppresses Radix's own close-autofocus for
	 * that closure, so the browser's default advance continues from the chip.
	 */
	onClose: () => void;
	/**
	 * Radix's close-autofocus, forwarded from the pair's swap guard - the panel
	 * does not own that decision, `ChatHeaderIdentity` does (see its note).
	 */
	onCloseAutoFocus: (event: Event) => void;
};

/** The register both non-row states are rendered in. */
const MENU_STATE_ROW = cn("px-2 py-3 text-body-sm");

export const IdentityMenu: FC<IdentityMenuProps> = ({
	kind,
	open,
	listId,
	options,
	recents,
	loading,
	loadError,
	emptyText,
	caption,
	closedReason = null,
	closedNoteId,
	onPick,
	onClose,
	onCloseAutoFocus,
}) => {
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const [hovered, setHovered] = useState<number | null>(null);
	const [overflowing, setOverflowing] = useState(false);
	/*
	 * WHAT ENTER ON A REFUSED ROW SAID, if anything (review round 1, D2/U1):
	 * the confirm key must not be silent on the one row it cannot act on, so the
	 * footer - already a polite live region - carries this sentence instead of
	 * its count until the next keystroke or open. `null` is the normal state.
	 */
	const [announcement, setAnnouncement] = useState<string | null>(null);
	const inputRef = useRef<HTMLInputElement>(null);
	/*
	 * THE SCROLLER IS STATE, NOT A REF (review round 1, Q-1). The measure
	 * effect below is its only reader, and what that effect needs is the NODE:
	 * Radix mounts the portal content a commit after `open` flips, so a
	 * `useRef` read inside a `[view]`-keyed effect can see null on the one run
	 * that matters - measured on the 150-name roster, the effect ran with
	 * `box: null` on the open commit and never again, because `view` stops
	 * changing once the rows are in, and the footer silently never rendered
	 * (scrollHeight 7334 against clientHeight 261). Mirroring the node into
	 * state makes the effect run when the NODE appears, which is the event this
	 * effect actually needs; the setter itself is the callback, so it is stable
	 * and no detach/attach cycle is introduced.
	 */
	const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

	const showsList = identityMenuShowsList({
		loading,
		loadError,
		rowCount: options.length,
	});

	/*
	 * The filter is the APP'S one rule (`filterPickerOptions`), not a second one
	 * written here: the modal `/agent` picker and this menu must answer "does
	 * `rev` find `reviewer`" identically, and the only way to guarantee that is
	 * for both to call the same function.
	 */
	const matches = useMemo(
		() => filterPickerOptions(options, query),
		[options, query],
	);
	const view = useMemo(
		() => identityMenuBands({ rows: options, matches, recents, kind, query }),
		[options, matches, recents, kind, query],
	);
	/*
	 * One index space over the RENDERED rows, bands included - `picker-host`'s
	 * `ordered`, for its reason plus one more: a remembered row is rendered TWICE
	 * here, once per band, so an index into the option list would name two rows
	 * and `aria-activedescendant` would point at whichever came first in the DOM.
	 * The row ids are built from this running index for the same reason.
	 */
	const flat = useMemo(() => view.bands.flatMap((band) => band.rows), [view]);

	/*
	 * A filter re-places the cursor at the top of what is left, and drops the
	 * pointer's highlight with it. An effect rather than a line in `onChange`,
	 * because the clamp must also cover a query that SHRANK the list under a row
	 * the arrows had already walked to; the modal pickers place their highlight
	 * from a rule for the same class of reason.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `query` is the trigger, the re-place is the effect - seeded off the CURRENT rows (review round 1, D2/U1), so a filter lands on a settable row when one survives it
	useEffect(() => {
		setActive(identityMenuSeedActive(flat));
		setHovered(null);
		setAnnouncement(null);
	}, [query]);

	/*
	 * ROWS ARRIVING RE-PLACE THE HIGHLIGHT (review round 1, D2/U1): a cold open
	 * seeds over an EMPTY list - the entity query starts on the open itself - so
	 * without this the highlight would sit on row zero, the row the rule
	 * routinely refuses, exactly as it did before the fix. Keyed to the row
	 * COUNT rather than to the list, because the list's identity changes on
	 * every render and re-seeding then would fight the arrow walk.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the count is the trigger; the seed reads the current rows on purpose
	useEffect(() => {
		setActive(identityMenuSeedActive(flat));
	}, [flat.length]);

	/*
	 * THE ANNOUNCEMENT FOLLOWS THE HIGHLIGHT (review round 2, D7/U7): it names a
	 * specific row, so it may live only while that row is active. Arrowing away
	 * used to leave the footer - and the polite live region - asserting a name
	 * that was no longer highlighted, which stops being merely stale and turns
	 * wrong on the incompatible pair: "coder cannot take the seat." while the
	 * SETTABLE manager is the row under the cursor. Keyed to `active` rather
	 * than cleared inside `move()`, because the pointer path moves the highlight
	 * too (`PickerRow`'s click calls `setActive`) and must clear it the same
	 * way; Enter itself never changes `active`, so the answer it sets survives
	 * until the user actually moves.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `active` is the trigger - the effect's subject is the move, not the value it lands on
	useEffect(() => {
		setAnnouncement(null);
	}, [active]);

	/*
	 * Keep the active row inside the bound as the arrows walk past the fold.
	 *
	 * `block: "nearest"` and not `"start"`, so a row that is already visible does
	 * not move the list at all - otherwise every arrow press would jerk it. The
	 * lookup is by ID through `getElementById`, not a CSS selector built from it:
	 * these ids come from `useId()`, and React 18 spells them `:r1:`, which is not
	 * a valid selector (`picker-host` reads its own rows the same way).
	 */
	useEffect(() => {
		document
			.getElementById(`${listId}-${active}`)
			?.scrollIntoView({ block: "nearest" });
	}, [active, listId]);

	/*
	 * Whether the list is taller than the box it scrolls in - the fact the footer
	 * reports, and a MEASURED one rather than inferred from a row count: whether
	 * five rows fit depends on whether they carry a description, which is a
	 * property of the data. The palette measures its own fold for the same reason
	 * (content height against the scroller's box, so nothing in the panel can feed
	 * back into the answer). It observes the scroller AND its children, like the
	 * picker host: the box itself does not resize when a filter removes rows
	 * inside it, so a box-only observer would leave the footer saying the wrong
	 * thing about a list that just got shorter.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `view` is the trigger, not an input - the effect measures the DOM rather than reading the value, and a different set of rows (a filter, a wider roster) is a different height; `scroller` is the NODE arriving (or leaving), the other half of there being something to measure (review round 1, Q-1)
	useEffect(() => {
		const box = scroller;
		if (!box) {
			setOverflowing(false);
			return;
		}
		const measure = () =>
			setOverflowing(box.scrollHeight > box.clientHeight + 1);
		measure();
		let observer: ResizeObserver | undefined;
		if (typeof ResizeObserver !== "undefined") {
			observer = new ResizeObserver(measure);
			observer.observe(box);
			for (const child of box.children) observer.observe(child);
		}
		return () => observer?.disconnect();
	}, [view, scroller]);

	/*
	 * THE FIELD TAKES FOCUS, and it is this panel that gives it - not Radix alone,
	 * which is the subtler half of the same rule.
	 *
	 * Radix's focus scope autofocuses the first focusable element inside the panel
	 * when the panel MOUNTS, and passes no `onOpenAutoFocus`, so on a WARM open
	 * (the catalogue already answered) that is exactly this field. On a COLD one it
	 * is not: the entity query starts on the open itself, so at mount the panel
	 * holds the single `Loading teams...` line, the scope finds nothing focusable
	 * and lands on the panel's own box (measured, focus trace: BUTTON at t, then
	 * `DIV[role=presentation]` at t+11ms, and there it stayed). The consequence was
	 * not cosmetic - the arrows and Enter are handled BY THE FIELD, so with focus
	 * on the box they did nothing, Enter toggled the panel shut instead of picking
	 * a row, and a switch made keyboard-first never ran at all (the busy frame's
	 * own claim caught it).
	 *
	 * So the field takes focus when it EXISTS, which is one render later on a cold
	 * open and the same frame on a warm one. Nothing is stolen: while the panel is
	 * open, focus is either here, on the chip that opened it, or on the panel's box
	 * - and the two latter cases are what this repairs. And a press on a row cannot
	 * move it (`PickerRow` prevents the default on `mousedown`, and so does the
	 * panel itself), so "the user left the field" is still expressed by the
	 * pointer's own dismissal rather than by a stray blur.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the trigger is the FIELD APPEARING (`showsList`), not a value the effect reads.
	useEffect(() => {
		if (!open) return;
		const field = inputRef.current;
		if (!field || document.activeElement === field) return;
		field.focus();
	}, [open, showsList]);

	/*
	 * A FRESH OPEN IS A FRESH LIST, and that is this component's own half rather
	 * than Radix's: the field stays mounted across opens, so a query typed into the
	 * previous one would still be filtering the next - a narrowed list nobody asked
	 * for, the shape the modal pickers reset per open for the same reason.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `open` is the trigger; the seed reads the current rows on purpose
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(identityMenuSeedActive(flat));
		setHovered(null);
		setAnnouncement(null);
	}, [open]);

	const move = useCallback(
		(delta: number) => {
			if (flat.length === 0) return;
			/* Wrapping, which is `picker-host`'s rule for both arrows: on a list
			 * this short the ends are reached often enough that stopping at one
			 * reads as a dead key. */
			setActive((index) => (index + delta + flat.length) % flat.length);
		},
		[flat.length],
	);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			/* The sibling `picker-host`'s first line, and its reason: an IME's Enter
			 * that commits a candidate is still the composition's key, and without
			 * this guard it calls `onPick` on the active row - switching the profile
			 * with a fresh filter (UX round 1, U3, reproduced on Chromium; an arrow
			 * walking candidates moves rows the same way). */
			if (event.nativeEvent.isComposing) return;
			if (event.key === "Tab") {
				/* See `onClose`: Tab must leave the panel, where Radix's focus scope
				 * would loop it back into the field. `stopPropagation` keeps the
				 * scope's own handler from running for this key, and the default is
				 * NOT prevented - the advance is the browser's own, taken from the
				 * chip the control put focus on. */
				event.stopPropagation();
				onClose();
				return;
			}
			if (event.key === "ArrowDown") {
				event.preventDefault();
				move(1);
				return;
			}
			if (event.key === "ArrowUp") {
				event.preventDefault();
				move(-1);
				return;
			}
			if (event.key === "Home" && flat.length > 0) {
				event.preventDefault();
				setActive(0);
				return;
			}
			if (event.key === "End" && flat.length > 0) {
				event.preventDefault();
				setActive(flat.length - 1);
				return;
			}
			if (event.key === "Enter") {
				event.preventDefault();
				const row = flat[active];
				/* A ROW and not the text in the field: see the docblock. Enter on a
				 * filter that matched nothing is deliberately inert; Enter on a row
				 * the TEAM'S RULE refuses is answered (review round 1, D2/U1) - a key
				 * that does nothing at all reads as a broken panel - and the answer
				 * is sourced from `blocked`, never from `disabled`: a row that is
				 * merely busy (a switch in flight, reachable by re-opening the chip
				 * before it settles) cannot take the seat a moment later, so the
				 * refusal register must not describe it (review round 2, MINOR-2).
				 * Busy is silent: the switch it is already running is its answer. */
				if (row && !row.disabled) onPick(row.value);
				else if (row?.blocked)
					setAnnouncement(identityMenuRefusalAnnouncement(row.label));
				return;
			}
			/* Escape is Radix's: it closes the panel and returns focus to the chip. */
		},
		[active, flat, move, onClose, onPick],
	);

	const noun = kind === "team" ? "teams" : "agents";
	const activeId = flat.length > 0 ? `${listId}-${active}` : undefined;
	/*
	 * Whether any VISIBLE row can take the seat, and the footer sentence that
	 * follows (review round 1, D1): a filtered view whose every match is refused
	 * swaps the count for a resolution naming the exits that exist. Computed
	 * over `flat` - the rows actually rendered - and NOT over `options`: the
	 * roster always carries settable profiles, so a roster-level check kept
	 * printing the count over a filtered view nothing could be picked from,
	 * which the `search-results` frame's own claim caught. And computed over
	 * `blocked`, not `disabled` (review round 2, MINOR-2): a roster that is
	 * merely BUSY - a re-opened panel during an in-flight switch - is not a
	 * roster whose seats cannot be taken, so the resolution's claim must not
	 * describe it while it settles. `view.matches > 0` keeps the no-match state
	 * on its own sentence (`data-header-identity-no-matches`).
	 */
	const hasSettable = flat.some((row) => !row.blocked);
	const resolution = view.matches > 0 && !hasSettable;
	const footer = identityMenuFooter({
		view,
		kind,
		query,
		overflowing,
		hasSettable,
	});
	const captionId = useId();
	/* The running index the row ids and `aria-activedescendant` share. A counter
	 * across the bands, so the remembered rows' copies are distinct rows to the
	 * DOM even though they are the same profile. */
	let rowIndex = -1;

	const field = (
		<div className="relative px-1 pt-1 pb-1">
			<Search
				className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-ink-dim"
				aria-hidden="true"
			/>
			<Input
				ref={inputRef}
				role="combobox"
				aria-expanded={true}
				/* The reference names the listbox only while it exists: the non-list
				 * branch below renders no list, and a dangling `aria-controls` points
				 * a screen reader at nothing (UX round 1, U4). */
				aria-controls={showsList ? listId : undefined}
				aria-activedescendant={activeId}
				aria-autocomplete="list"
				aria-label={`Search ${noun}`}
				value={query}
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={onKeyDown}
				placeholder={`Search ${noun}`}
				className="pl-8"
				autoComplete="off"
				spellCheck={false}
			/>
		</div>
	);

	if (closedReason !== null) {
		return (
			<PopoverContent
				align="start"
				sideOffset={6}
				collisionPadding={8}
				className={cn("flex w-80 flex-col p-1")}
				data-header-identity-menu={kind}
				data-header-identity-closed=""
				/*
				 * Focus stays on the chip: the note holds nothing to operate, and
				 * moving focus into it would strand a keyboard user inside a panel
				 * whose only content is a sentence. Escape and an outside press
				 * close it through Radix, as on the list panel.
				 */
				onOpenAutoFocus={(event) => event.preventDefault()}
				onCloseAutoFocus={onCloseAutoFocus}
			>
				<p
					id={closedNoteId}
					data-header-identity-constraint=""
					className="px-2 py-1.5 text-ink-dim text-meta"
				>
					{closedReason}
				</p>
			</PopoverContent>
		);
	}

	return (
		<PopoverContent
			align="start"
			sideOffset={6}
			/* Eight pixels of clearance: a panel pinned flush to the window's edge
			 * reads as cut off rather than as placed, and collision padding is also
			 * what tells Radix how much room it must find before flipping. */
			collisionPadding={8}
			className={cn(
				"flex w-80 flex-col p-1",
				/*
				 * `overflow-hidden` IS the bound, not decoration: the ceiling class sets
				 * the panel's max HEIGHT, and without a clip the panel's own box honours
				 * it while its children keep painting past it - measured immediately
				 * after the scroll viewport gained its fold-cue wrapper, the panel stood
				 * 352px tall with the whole 150-row roster rendered visibly below it to
				 * the bottom of the window. The scroll viewport is what must absorb the
				 * difference (`min-h-0 flex-1` + `overflow-y-auto`), and the panel has to
				 * refuse to paint outside its own box for that to mean anything.
				 */
				IDENTITY_MENU_MAX_HEIGHT_CLASS,
				"overflow-hidden",
			)}
			data-header-identity-menu={kind}
			/*
			 * The popup is a CONTAINER, and Radix's own `role="dialog"` would be a lie
			 * about it: what the chip opens is a combobox over a listbox (both inside
			 * this element, both with their own roles and ids), not a dialog. The chip
			 * declares `aria-haspopup="listbox"` and points its `aria-controls` at the
			 * listbox, so nothing is announced by this element's role either way.
			 */
			role="presentation"
			/*
			 * The panel's own mousedown is prevented, so a press anywhere inside it
			 * leaves focus in the field: the same rule, and the same reason, as
			 * `searchable-select.tsx`'s list - a row click must not read as the user
			 * leaving the control.
			 */
			onMouseDown={(event) => event.preventDefault()}
			onCloseAutoFocus={onCloseAutoFocus}
		>
			{showsList ? (
				<>
					{field}
					{/*
					 * The bound team's rule, before the reading starts (issue #861).
					 * The rows below carry the consequence (a `disabled` row states its
					 * own reason), and this line states the rule they share - so the
					 * constraint is self-explaining rather than a list that happens to
					 * be grey. `null` unless a team leads and its manager is known; the
					 * `data-` hook is the capture rig's claim anchor, so a frame filed
					 * as constrained fails the run if the caption is missing.
					 */}
					{caption !== null && (
						<p
							id={captionId}
							data-header-identity-constraint=""
							/* The full sentence on hover at any width: the panel can be as
							 * narrow as the popover's own minimum while an 80-character
							 * team label can wrap the caption past three lines (review
							 * round 1, D3 - accepted at the shipped 600px window floor,
							 * where the caption costs no row; the title covers the stress
							 * widths). */
							title={caption}
							className="px-2 pt-0.5 pb-1 text-ink-dim text-meta"
						>
							{caption}
						</p>
					)}
					{/*
					 * The scroll viewport, with the fold's own cue when the roster does not
					 * fit it (operator, 2026-09-26: "the height is unbounded ... make sure
					 * there's a reasonable height bound"). A bound that cuts a row in half
					 * without saying so reads as a rendering fault rather than as a list that
					 * continues; the fade is this app's own answer to that (`command-palette`
					 * draws it over its fold, and as an OVERLAY rather than a sticky element
					 * for the reason recorded there - a sticky cue occupies layout, so a list
					 * that fits would come out taller than its content).
					 *
					 * The footer below is the other half and the stronger one: it names the
					 * roster's full size, so "there is more" is a sentence rather than a
					 * gradient. Neither is a truncation - the list scrolls, and the field
					 * filters - and both exist so nobody has to infer either.
					 */}
					<div className="relative flex min-h-0 flex-1 flex-col">
						{overflowing && (
							<div
								aria-hidden="true"
								className="pointer-events-none absolute inset-x-0 bottom-0 z-10 h-6 bg-gradient-to-t from-elevated to-transparent"
							/>
						)}
						<div
							ref={setScroller}
							id={listId}
							// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
							// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: the listbox role is the WAI-ARIA combobox pattern for a popup driven from a text input.
							role="listbox"
							aria-label={kind === "team" ? "Teams" : "Agents"}
							/*
							 * The rule the list enforces, programmatically associated (review
							 * round 1, U4): a screen reader entering the listbox now hears the
							 * caption's sentence as part of the control rather than only as a
							 * paragraph to be found by leaving the form. Only while the caption
							 * is rendered - there is no rule to describe otherwise.
							 */
							aria-describedby={caption !== null ? captionId : undefined}
							/*
							 * Out of the tab order explicitly: Chrome makes a scrollable
							 * region focusable, and reaching this by Tab would draw a focus
							 * ring on a box the arrows scroll instead of one whose rows the
							 * arrows walk (`picker-host` records the measured half of this).
							 */
							tabIndex={-1}
							/* The pointer's highlight is cleared when it leaves the list, so a
							 * hover left over from elsewhere can never read as the keyboard's
							 * row. */
							onMouseLeave={() => setHovered(null)}
							className="min-h-0 flex-1 overflow-y-auto"
						>
							{view.noMatches ? (
								/*
								 * The filtered-to-nothing state, in the register the modal
								 * pickers use for theirs (`pickerBodyKind`): it names the query
								 * it is about, so the sentence cannot be read as "this roster is
								 * empty" - that state has its own text, below.
								 */
								<p
									className={cn(MENU_STATE_ROW, "text-ink-dim")}
									/* The sweep's claim hook, like the refusal row's: an entry can
									 * ASSERT that the frame is the no-match state rather than
									 * photograph an empty list and hope. */
									data-header-identity-no-matches=""
								>
									Nothing matches “{query.trim()}”.
								</p>
							) : (
								view.bands.map((band) => (
									<Fragment key={band.heading ?? "all"}>
										{band.heading && (
											/*
											 * A band heading with the rule running out of it: the
											 * divider idiom this app already draws between
											 * conversations (`conversation-divider.tsx`), so a new
											 * section is announced by the label on a hairline rather
											 * than by a second block of chrome. Rendered only when a
											 * band actually starts here, which is what keeps a lone
											 * list from growing a heading it has nothing to
											 * separate.
											 */
											<div
												role="presentation"
												/* The sweep's band hook (review round 1, U6): a frame can
												 * assert WHICH bands are up - the recents band drops
												 * refused rows and collapses when nothing settable remains,
												 * and that is a claim `expectGone` can hold the run to. */
												data-header-identity-band={band.heading ?? undefined}
												className="flex items-center gap-3 px-2 pt-2 pb-1"
											>
												<span className="shrink-0 text-ink-dim text-meta">
													{band.heading}
												</span>
												<div className="h-px flex-1 bg-hairline" />
											</div>
										)}
										{band.rows.map((row) => {
											rowIndex += 1;
											const index = rowIndex;
											return (
												<PickerRow
													key={`${row.value}-${index}`}
													id={`${listId}-${index}`}
													option={row}
													index={index}
													isActive={index === active}
													isHovered={index === hovered}
													isPicked={false}
													onHover={(next) => setHovered(next)}
													onPick={(option, picked) => {
														/* The click moves the keyboard's row to what it
														 * picked as well as running the switch, which is
														 * `picker-host`'s own click contract - and it
														 * moves it even when the row is `disabled`, so
														 * the highlight and the refusal agree (the pick
														 * itself is what the mark blocks). */
														setActive(picked);
														if (!option.disabled) onPick(option.value);
													}}
												/>
											);
										})}
									</Fragment>
								))
							)}
						</div>
					</div>
					{(footer !== null || announcement !== null) && (
						/*
						 * The bound's own sentence. Rendered when the list does not fit, and
						 * when a filter is on (where the count IS the answer to what was
						 * typed); it names the roster's full size, so "there is more below"
						 * is a stated fact rather than a scrollbar's hint.
						 */
						<div
							/* The count line is the only place a filter's effect is stated, and it
							 * was sighted-only: a polite live region announces the sentence as it
							 * changes on each keystroke (UX round 1, U5; the register
							 * `settings-filter-bar`'s count line carries) - and now also the
							 * refused-row answer and the no-exit resolution (review round 1,
							 * D1/D2). The `data-` hooks are the capture rig's claim anchors:
							 * `resolution` marks the exits line's own presence, so a run can
							 * hold the shutter to it STAYING up under an announcement (review
							 * round 2, D7(a)). */
							aria-live="polite"
							data-header-identity-footer=""
							data-header-identity-resolution={resolution ? "" : undefined}
							className="border-hairline border-t px-2 py-1.5 text-ink-dim text-meta"
						>
							{/*
							 * THE ANSWER IS AN ADDITION, NOT A REPLACEMENT (review round 2,
							 * D7): Enter's refusal sentence used to swap out whatever the
							 * footer was saying - and in the all-refused state that is exactly
							 * the exits line D1 exists for, so the one key a user presses
							 * hoping to pick deleted the way out. The announcement renders
							 * ABOVE the base line (the count or the resolution), which keeps
							 * the way out on screen; both are spans so the region's text
							 * reads as two sentences rather than one run-on.
							 */}
							{announcement !== null && (
								<span className="block">{announcement}</span>
							)}
							{footer !== null && <span className="block">{footer}</span>}
						</div>
					)}
				</>
			) : (
				<>
					{field}
					{/*
					 * The three non-list states, as the panel's own single line - the
					 * register the menu already used for them, kept so a reviewer comparing
					 * frames sees the same copy in a new chassis. Two of them carry claim
					 * hooks that the sweep's shutters assert rather than measuring a state
					 * by eye: the refusal keeps `data-header-identity-error` (design D1),
					 * and the loading line keeps `data-header-identity-loading` - the
					 * agent side's frames need it (issue #861: the loading state is where
					 * the constraint must stay unstated and the cue unlit).
					 */}
					<div className={cn(MENU_STATE_ROW, "text-ink-dim")}>
						{loading ? (
							<span data-header-identity-loading="">Loading {noun}…</span>
						) : loadError ? (
							<span className="text-danger" data-header-identity-error="">
								{loadError}
							</span>
						) : (
							<span>{emptyText}</span>
						)}
					</div>
				</>
			)}
		</PopoverContent>
	);
};
