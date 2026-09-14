/**
 * The one picker host for every `native_action` destination.
 *
 * A slash command with no argument returns a presentation request from the
 * backend, never a completed action. This component is the palette that
 * turns that request into a decision: a searchable, keyboard-first list of
 * options (ARIA combobox over a listbox), an optional form beneath it, and a
 * result strip that shows the backend's ACTUAL reply after the adapter calls
 * the real operation. There is no fake success anywhere in here; an adapter
 * that cannot reach the backend surfaces the error in the strip.
 *
 * Keyboard contract: type to filter, arrows move the active row, Enter picks
 * it (or submits the form when the list is empty), Escape closes with no
 * side effect. Focus stays on the search input; the active row is announced
 * through `aria-activedescendant`, the same shape the composer's slash popup
 * uses so the two feel like one mechanism.
 *
 * Visually it is a dialog on `elevated` with the single system shadow (it
 * has left the flow), radius 14 for a frame, controls at 6. Rows are colour
 * steps on hover/active, never motion. Sentence case throughout.
 */

import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { Checkbox } from "@shared/components/ui/checkbox";
import {
	Dialog,
	DialogContent,
	DialogDescription,
	DialogTitle,
} from "@shared/components/ui/dialog";
import { Input } from "@shared/components/ui/input";
import { Label } from "@shared/components/ui/label";
import { Tooltip } from "@shared/components/ui/tooltip";
import { cn } from "@shared/lib/utils";
import { Check, Search } from "lucide-react";
import {
	type FC,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	memo,
	useCallback,
	useEffect,
	useId,
	useMemo,
	useReducer,
	useRef,
	useState,
} from "react";

export type PickerOption = {
	/** Stable key and the value handed to `onPick`. */
	value: string;
	label: string;
	/** Secondary line, prose. */
	description?: string;
	/** Machine-voice trailing detail (a selector, a count, a state). */
	meta?: string;
	/** Row is the current selection. */
	current?: boolean;
	/** Row cannot be chosen; still listed so the reason is visible. */
	disabled?: boolean;
	/** Extra search terms (aliases). */
	keywords?: string[];
	/** Rows group under this heading when set. */
	group?: string;
};

export type PickerResult = {
	tone: "info" | "success" | "warning" | "error";
	text: string;
	/** Optional structured detail, monospace, behind the text. */
	detail?: ReactNode;
};

export type PickerHostProps = {
	open: boolean;
	onClose: () => void;
	title: string;
	/** One sentence on what choosing does, and its scope. */
	description?: string;
	options?: PickerOption[];
	/** Options are loading from the backend. */
	loading?: boolean;
	/** Options failed to load; shown in place of the list. */
	loadError?: string | null;
	/**
	 * A PARTIAL failure: the list is usable, and this note sits above it.
	 *
	 * Distinct from `loadError` because the two answer different questions. A
	 * `models.catalogue` answer can carry per-provider listing errors while still
	 * holding rows, and putting that note in `loadError` replaced the whole list
	 * with 21 provider names — 1450 usable rows gone (design D4). The list is the
	 * answer the user came for; a note about what is missing belongs beside it,
	 * not instead of it.
	 */
	notice?: string | null;
	/**
	 * The detail behind `notice`, shown on hover.
	 *
	 * One line on screen and the full list on demand, so a note about a wall of
	 * names (the operator's own catalogue: 21 of them) reads as copy rather than
	 * as a log (design D16, UX nit). The ids are names nobody can act on, which is
	 * why they are not the sentence.
	 */
	noticeDetail?: string | null;

	/** Text shown when the (filtered) list is empty. */
	emptyText?: string;
	searchPlaceholder?: string;
	/** Called with the picked option's value. */
	onPick?: (value: string, option: PickerOption) => void | Promise<void>;
	/** Form rendered under the list (or alone, when there is no list). */
	form?: ReactNode;
	/** Enter with no active row, or the primary button, submits the form. */
	onSubmit?: () => void | Promise<void>;
	submitLabel?: string;
	submitDisabled?: boolean;
	/** Secondary footer actions (Cancel is always present). */
	actions?: ReactNode;
	/** Result of the last real backend operation. */
	result?: PickerResult | null;
	/** An operation is in flight; the footer shows it and disables submit. */
	busy?: boolean;
	/**
	 * What the in-flight footer says, in the user's terms.
	 *
	 * The default names the CHANGE rather than the machinery: "Waiting for the
	 * backend…" is honest but answers a question the user did not ask — what they
	 * asked is whether their pick registered (design D14, UX nit). An adapter
	 * that knows the change it is making says it (`/model` passes "Switching the
	 * model…"), and the generic default stays true for every other destination.
	 */
	busyText?: string;
	/**
	 * The picked row's spinner name, for the accessibility tree.
	 *
	 * Its own prop rather than `busyText` so the announcement is a statement
	 * ("Switching the model") rather than a sentence fragment with an ellipsis.
	 * Omitted, the spinner is hidden from the tree — no row can be named as
	 * "applying" when the host has not been told what is applying.
	 */
	busyLabel?: string;
	/** Widen for data views (usage, analytics). */
	wide?: boolean;
	/**
	 * The dialog's size class. `dialog` is today's geometry, byte for byte:
	 * `max-w-xl` body, `max-h-[min(60vh,520px)]` scroll box.
	 *
	 * `panel` is the data-view geometry: `max-w-5xl` and a taller scroll box, so a
	 * chart plus its table fit above the fold at 1024px and the panel is not a
	 * peephole onto its own content. It supersedes `wide`; pass one or the other,
	 * never both, and panels pass only this.
	 */
	shell?: "dialog" | "panel";
	/** Rendered above the list, below the search (a scope toggle, a filter). */
	toolbar?: ReactNode;
	/** Rendered instead of the list when set (data views). */
	body?: ReactNode;
	/**
	 * The body is a long list that MAY overflow, so reserve its scrollbar
	 * column.
	 *
	 * Opt-in rather than always-on: `scrollbar-gutter: stable` is paid by every
	 * state of the body, and a short form that never scrolls has nothing to pay
	 * for it. Set it for the dense data views.
	 *
	 * Note that this gates ONLY the gutter. The end-of-list treatment - the
	 * closing rule and the fade - is not behind this prop at all: whether the
	 * edge is drawn is measured per render from the scroll container itself,
	 * because overflow is a property of the STATE, not of the PICKER: `/usage`
	 * sets this once, but its empty, error, fetching, percent-only,
	 * remaining-balance and narrow states all end well above the fold, and an
	 * unconditional rule drew a boundary under nothing in every one of them
	 * (design D4).
	 */
	bodyScrolls?: boolean;
};

const TONE_CLASS: Record<PickerResult["tone"], string> = {
	info: "border-hairline bg-sunken text-ink-muted",
	success: "border-success-border bg-success-wash text-ink",
	warning: "border-warning-border bg-warning-wash text-ink",
	error: "border-danger-border bg-danger-wash text-ink",
};

/**
 * What a panel's scroll region is called in the accessibility tree.
 *
 * Deliberately NOT the dialog's title: named for the screen it sits on, a
 * screen reader announces "Analytics region" inside the "Analytics dialog" and
 * the tab stop says nothing about where focus landed. Panels put all of their
 * content in this one region, so the name describes the region rather than one
 * of the things in it (`/usage` names its inner list "Report list" for the
 * same reason).
 */
const PANEL_BODY_LABEL = "Panel content";

type PickerRowProps = {
	id: string;
	option: PickerOption;
	index: number;
	/** This is the row Enter picks, and the row `aria-activedescendant` names. */
	isActive: boolean;
	/** The pointer is over this row. Independent of `isActive` on purpose. */
	isHovered: boolean;
	/** This row's value is the one an in-flight operation is answering about. */
	isPicked: boolean;
	onHover: (index: number | null) => void;
	/**
	 * The row was chosen, and which row it is.
	 *
	 * The index is part of the contract, not a convenience: the click also MOVES
	 * the keyboard's row to what it clicked (UX U1 — a pick used to leave the
	 * highlight on a row the user never chose, so the one row still marked as
	 * "selected" was not the row in force), and the host needs the index to do
	 * that.
	 */
	onPick: (option: PickerOption, index: number) => void;
	/** See `PickerHostProps.busyLabel`: the picked row's spinner name. */
	busyLabel?: string;
};

/*
 * The list's pointer state and the decisions the footer makes, as pure exports.
 *
 * `scripts/picker-feedback.test.mjs` drives these directly, which is the same
 * discipline `usage-view-model.ts` and `session-model.ts` follow: the behaviour
 * a frame can only show today is asserted on the functions the component
 * actually runs, so a later edit cannot keep the frame and lose the rule. The
 * transitions are real — `hover` marks the pointer's row, `leave` clears it and
 * KEEPS the picked mark, `settle` clears the mark and keeps the pointer —
 * because the two lifetimes are the design (D2/D3).
 */
export type PickerListState = {
	/** The row the pointer is over, or null. */
	hovered: number | null;
	/** The value of the row an in-flight operation is answering about. */
	picked: string | null;
};

export const PICKER_LIST_INITIAL: PickerListState = {
	hovered: null,
	picked: null,
};

export type PickerListAction =
	| { type: "hover"; index: number }
	| { type: "leave" }
	| { type: "pick"; value: string }
	| { type: "settle" }
	| { type: "reset" };

export function pickerListReducer(
	state: PickerListState,
	action: PickerListAction,
): PickerListState {
	switch (action.type) {
		case "hover":
			return state.hovered === action.index
				? state
				: { ...state, hovered: action.index };
		case "leave":
			return state.hovered === null ? state : { ...state, hovered: null };
		case "pick":
			return { ...state, picked: action.value };
		case "settle":
			return state.picked === null ? state : { ...state, picked: null };
		case "reset":
			return PICKER_LIST_INITIAL;
	}
}

/**
 * What the body shows, given the load state and how many rows survived it.
 *
 * A separate `notice` never reaches this decision: the note is drawn ABOVE the
 * body, and a partial listing failure that still holds rows must show those
 * rows (design D4 — the whole defect was 1450 usable rows replaced by 21
 * provider names).
 */
export type PickerBodyKind = "loading" | "error" | "empty" | "list";

export function pickerBodyKind(state: {
	loading: boolean;
	loadError: string | null;
	rowCount: number;
}): PickerBodyKind {
	if (state.loading) return "loading";
	if (state.loadError) return "error";
	return state.rowCount === 0 ? "empty" : "list";
}

/**
 * The footer's left slot.
 *
 * The arrow/Enter hint is advertised only when there IS something to move
 * through and nothing else is happening: with no rows it described controls
 * that do nothing (design D6), and while busy the useful fact is what is being
 * done to the user's session (design D3, latency U2, D14).
 *
 * It NAMES the row Enter would pick. That is UX U1's second half: the keyboard's
 * row can be scrolled out of view (the reader scrolled 1800px, the pointer was
 * on row 39, Enter picked row 0 — 1492px above the fold). Hover deliberately
 * does not steer the selection (design D2), so the two marks can sit on
 * different rows and a word is what tells the user which one the key acts on
 * without moving the pointer or fighting their scroll.
 */
export function pickerFooterHint(state: {
	busy: boolean;
	hasList: boolean;
	rowCount: number;
	/** The label of the row Enter picks, when the host can name one. */
	activeLabel?: string | null;
	/** What an in-flight operation is doing, in the user's terms. */
	busyText?: string;
}): string {
	if (state.busy) return state.busyText ?? "Applying the change…";
	if (state.hasList && state.rowCount > 0) {
		return state.activeLabel
			? `Arrows move · Enter picks ${state.activeLabel} · Esc closes`
			: "Arrows move, Enter picks, Esc closes";
	}
	return "Esc closes";
}

/**
 * The footer's right-hand control.
 *
 * `Close` while busy rather than `Cancel`: closing the dialog does not cancel
 * the operation the owner is already performing (design D3). `Done` once a
 * non-refused result is on screen, and `Close` for every state where nothing
 * has landed — the same word the Esc hint above uses, because one action with
 * two names in one row is what design D15 filed (the footer read "Esc closes"
 * beside a button labelled `Cancel`).
 */
export function pickerPrimaryLabel(state: {
	busy: boolean;
	result: PickerResult | null;
}): string {
	if (state.busy) return "Close";
	return state.result && state.result.tone !== "error" ? "Done" : "Close";
}

/**
 * One option row, memoized.
 *
 * WHY IT IS ITS OWN COMPONENT. The host re-renders on every pointer move and
 * every keystroke, and with the rows inline each of those repainted the whole
 * catalogue — measured at 2-4 ms for 600 rows and 24.6 ms p50 under a 6x CPU
 * throttle, against a real listing that held 1450. The row's props are
 * primitives plus the option object (whose identity is stable: adapters derive
 * the list once per catalogue answer) and two callbacks the host keeps stable,
 * so a hover now re-renders the row being left and the row being entered, and
 * nothing else. Virtualizing the list was the alternative and was rejected on
 * the profiler's own numbers — the full mount measures ~19 ms — and on the a11y
 * risk, since windowing has to preserve `aria-activedescendant`, the arrow walk
 * and the current-row start.
 *
 * WHY TWO GROUNDS, AND WHICH GROUND EACH ONE TAKES.
 *
 * `isActive` is the keyboard's selection — what Enter picks. It takes
 * `bg-sunken`, because that is the only ground role that steps perceptibly away
 * from the dialog's own `bg-elevated` in ALL twelve themes (measured ΔE00
 * 5.85-16.70). The sibling composer popup's `bg-accent-wash` tint was the first
 * choice and is a real step in the brand pair, but `accent-wash` collapses onto
 * `elevated` in obsidian (ΔE00 0.77, ratio 1.01) and is under ΔE00 4 in
 * tokyoNight (3.74) and dracula (3.99), with dune's 4.88 the next-worst and the
 * first to clear it — i.e. it would reproduce the original defect for whichever
 * theme the user happens to run. The wash keeps the pointer's role instead.
 *
 * `isHovered` is the pointer's own position and nothing else. It takes
 * `bg-accent-wash` — the tint the composer popup uses for pointer feedback —
 * and it is cleared by `onMouseLeave` on the listbox, so a highlight left
 * behind by the pointer can never be mistaken for the keyboard's. Note what
 * this semantics means: the pointer no longer steers `active`. Hovering a row
 * and pressing Enter picks the keyboard's row, not the hovered one; the
 * pointer's own action is the click (`onMouseDown` below, which picks the row
 * under it), and Enter belongs to the keyboard. The alternative — hover sets
 * `active` too, as the popup does — is why the two states were byte-identical
 * before (design D2).
 *
 * WHY THE POINTER ALSO CARRIES A STRUCTURAL EDGE.
 *
 * `accent-wash` is not perceptible on `elevated` in every theme, and the design
 * audit measured it: obsidian ΔE00 0.77 (1.014:1), tokyoNight 3.74, dracula
 * 3.99, dune 4.88. In obsidian the pointer's mark was therefore invisible — the
 * operator's original report surviving intact in a user-selectable theme — and
 * the in-flight row lost its mark with it. So the mark is not wash-only any
 * more: a 1px `outline-control` edge clears the 3:1 structural floor against
 * the dialog's ground in ALL twelve palettes BY CONSTRUCTION, which is why the
 * contrast contract asserts the ROLE on this ground (`picker row pointer mark`)
 * rather than only the class string — the string stayed green while the role
 * collapsed. The wash is kept where it does read, as the tint the sibling popup
 * uses for the same gesture.
 *
 * `isPicked` keeps that edge for as long as the operation is in flight, so the
 * row being switched to is marked even after the pointer leaves it; the spinner
 * in its meta slot is what says what is happening (D3).
 */
export const PickerRow: FC<PickerRowProps> = memo(
	({
		id,
		option,
		index,
		isActive,
		isHovered,
		isPicked,
		onHover,
		onPick,
		busyLabel = "Applying the change",
	}) => (
		/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search input; the active option is announced through aria-activedescendant. */
		<div
			id={id}
			// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search input; the active option is announced through aria-activedescendant.
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
			role="option"
			aria-selected={isActive}
			aria-disabled={option.disabled || undefined}
			// `data-current` is a HOOK, not a style: it marks the row the owner
			// reports as the model in force, for the a11y tree and for the harness's
			// assertions. It is deliberately unstyled — the visible mark is the
			// accent check beside the label, which does not depend on the attribute
			// existing (design D11).
			data-current={option.current || undefined}
			data-hovered={isHovered || undefined}
			data-picked={isPicked || undefined}
			onMouseEnter={() => onHover(index)}
			onMouseDown={(event) => {
				// mousedown, not click: keeps focus in the search input, the same
				// reason the composer popup does it.
				event.preventDefault();
				onPick(option, index);
			}}
			className={cn(
				"flex cursor-default items-start gap-3 rounded-sm px-2 py-1.5",
				isActive && "bg-sunken",
				isHovered && !isActive && "bg-accent-wash",
				// The structural half of both marks; see the block comment above for
				// why the wash alone is not enough in all twelve themes.
				(isPicked || (isHovered && !isActive)) &&
					"outline-solid outline-1 -outline-offset-1 outline-control",
				option.disabled && "text-ink-disabled",
			)}
		>
			<span className="flex min-w-0 flex-1 flex-col">
				<span className="flex items-center gap-2">
					<span
						className={cn(
							"truncate text-body-sm",
							option.disabled ? "text-ink-disabled" : "text-ink",
						)}
					>
						{option.label}
					</span>
					{option.current && (
						<Check
							className="size-3.5 shrink-0 text-accent"
							aria-label="Current"
						/>
					)}
				</span>
				{option.description && (
					<span className="truncate text-ink-muted text-meta">
						{option.description}
					</span>
				)}
			</span>
			{isPicked ? (
				/* The picked row's mark, held until the operation settles (design D3).
				   It replaces the meta slot rather than adding a second element, so the
				   row does not change height while the answer is pending. */
				<span className="shrink-0">
					<Spinner size="sm" label={busyLabel} />
				</span>
			) : option.meta ? (
				<span className="shrink-0 font-mono text-ink-dim text-mono-sm">
					{option.meta}
				</span>
			) : null}
		</div>
	),
);
PickerRow.displayName = "PickerRow";

export const PickerHost: FC<PickerHostProps> = ({
	open,
	onClose,
	title,
	description,
	options,
	loading = false,
	loadError = null,
	notice = null,
	noticeDetail = null,
	emptyText = "Nothing matches.",
	searchPlaceholder = "Search",
	onPick,
	form,
	onSubmit,
	submitLabel = "Apply",
	submitDisabled = false,
	actions,
	result = null,
	busy = false,
	busyText,
	busyLabel = "Applying the change",
	wide = false,
	shell = "dialog",
	toolbar,
	body,
	bodyScrolls = false,
}) => {
	const listId = useId();
	const [query, setQuery] = useState("");
	// The keyboard's selection: the row Enter picks, and the row
	// `aria-activedescendant` names. Moved by the arrow keys only — see
	// `hovered` for why the pointer does not steer it.
	const [active, setActive] = useState(0);
	// The pointer's position and the picked row's mark, one reducer (see
	// `pickerListReducer`): both are the LIST's interaction state, they expire on
	// different edges, and keeping them together is what makes "the pointer left"
	// and "the operation settled" two separate transitions rather than two
	// effects racing over the same state.
	const [list, dispatch] = useReducer(pickerListReducer, PICKER_LIST_INITIAL);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

	/*
	 * Whether the body overflows, and whether there is content below the current
	 * scroll position. Two booleans because the two treatments differ in when
	 * they apply: the rule marks where the body ends and stays for as long as the
	 * body is scrollable at all, while the fade is a promise that the list
	 * CONTINUES and so must retract at the bottom — drawn on overflow alone it
	 * ghosts the final row, the bug `canvas-tabs.tsx` hit with this same
	 * treatment on its horizontal strip.
	 */
	const [bodyOverflows, setBodyOverflows] = useState(false);
	const [bodyHasMoreBelow, setBodyHasMoreBelow] = useState(false);

	/*
	 * Measurement is attached by a REF CALLBACK rather than by an effect over a
	 * ref object, and that is load-bearing here.
	 *
	 * The body renders inside Radix's dialog portal, so on the first commit the
	 * ref object is still null when an effect would run: the element does not
	 * exist yet. An effect keyed on `[bodyScrolls, body]` therefore measured
	 * nothing and never re-ran, leaving a genuinely overflowing table with no
	 * fold treatment at all — measured at 414px of content in a 252px box with
	 * neither class applied. A ref callback fires when the node actually
	 * attaches, which is the moment there is something to measure.
	 *
	 * The observers then track reality: the box resizes when the dialog does, and
	 * the CONTENT resizes when a query settles under it — a `/usage` ask that
	 * returns eleven reports replaces a three-block skeleton, and only the
	 * child's box changes. Watching the scroll container alone misses exactly the
	 * transition that creates the overflow.
	 */
	const cleanupBodyBox = useRef<(() => void) | null>(null);
	const bodyRegionRef = useRef<HTMLDivElement | null>(null);
	// biome-ignore lint/correctness/useExhaustiveDependencies: `body` is deliberately a dependency though the callback never reads it. Changing the body replaces the observed child nodes, and a stable callback identity would leave React holding the original attachment with a `ResizeObserver` still watching detached nodes — so the growth that creates the overflow is never seen. The new identity IS the re-subscription.
	const bodyBoxRef = useCallback(
		(box: HTMLDivElement | null) => {
			cleanupBodyBox.current?.();
			cleanupBodyBox.current = null;
			if (!box) {
				setBodyOverflows(false);
				setBodyHasMoreBelow(false);
				return;
			}
			/* 1px: `scrollHeight` and `clientHeight` round independently, so a body
			   that does not overflow can measure a fraction over and a fully
			   scrolled one a fraction under. Below anything a user can scroll to and
			   above the rounding noise — the same threshold, and the same reason, as
			   `canvas-tabs.tsx`. */
			const measure = () => {
				const hidden = box.scrollHeight - box.clientHeight;
				setBodyOverflows(hidden > 1);
				setBodyHasMoreBelow(hidden - box.scrollTop > 1);
			};
			measure();
			box.addEventListener("scroll", measure, { passive: true });
			let observer: ResizeObserver | undefined;
			if (typeof ResizeObserver !== "undefined") {
				observer = new ResizeObserver(measure);
				observer.observe(box);
				for (const child of box.children) observer.observe(child);
			}
			cleanupBodyBox.current = () => {
				box.removeEventListener("scroll", measure);
				observer?.disconnect();
			};
		},
		// `body` is not read, but swapping it replaces the observed children, and
		// a new callback identity is what makes React re-attach and re-measure
		// against the new content.
		[body],
	);

	/*
	 * The body box, kept reachable for the panel shell's initial focus.
	 *
	 * A second callback rather than a second ref on the element: React calls one
	 * ref per node, and the measurement above MUST stay on the node itself. The
	 * wrapper still re-subscribes whenever `bodyBoxRef` changes identity, which
	 * is the property the comment above depends on.
	 */
	const attachBodyBox = useCallback(
		(box: HTMLDivElement | null) => {
			bodyRegionRef.current = box;
			bodyBoxRef(box);
		},
		[bodyBoxRef],
	);

	/* The footer's Close button: the fallback focus target when no body is mounted. */
	const closeButtonRef = useRef<HTMLButtonElement>(null);

	const hasList = options !== undefined;
	const filtered = useMemo(() => {
		if (!options) return [];
		const needle = query.trim().toLowerCase();
		if (!needle) return options;
		return options.filter((option) =>
			[option.label, option.value, option.description ?? "", option.meta ?? ""]
				.concat(option.keywords ?? [])
				.join(" ")
				.toLowerCase()
				.includes(needle),
		);
	}, [options, query]);

	/**
	 * The row Enter would pick, by name.
	 *
	 * The footer states it (UX U1): the keyboard's row can be scrolled out of view,
	 * and the pointer does not steer it (design D2), so a WORD is what tells the
	 * user which model the key is about to switch them to without moving the
	 * pointer or fighting their scroll.
	 */
	const activeLabel = filtered[active]?.label ?? null;

	// Reset per open so a re-opened picker never carries a stale filter.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(0);
		dispatch({ type: "reset" });
	}, [open]);
	// The picked row's mark is held until the operation SETTLES, not until the
	// next render: the point of it is to say which row the backend is answering
	// about, so it must survive every frame the answer is pending.
	useEffect(() => {
		if (!busy) dispatch({ type: "settle" });
	}, [busy]);
	// Start on the current row so Enter alone confirms "no change"; clamp
	// rather than reset when the filter shortens the list.
	useEffect(() => {
		setActive((current) => {
			if (filtered.length === 0) return 0;
			if (query) return Math.min(current, filtered.length - 1);
			const currentIndex = filtered.findIndex((option) => option.current);
			return currentIndex >= 0
				? currentIndex
				: Math.min(current, filtered.length - 1);
		});
	}, [filtered, query]);
	/*
	 * A query change scrolls the list back to its top (UX U6).
	 *
	 * Typing with the list scrolled to `scrollTop: 2200` left the offset where it
	 * was: the rows narrowed 1450 -> 271 and the best match sat ABOVE the fold, so
	 * the user asked for a narrower set and was shown its middle. The active-row
	 * effect below only runs when `active` MOVES, and a filter that keeps index 0
	 * active moves nothing — which is also why a scroll alone never brings the
	 * keyboard's row back.
	 *
	 * The suppression is the honest form of this effect: `query` is the TRIGGER
	 * rather than an input — the body reads nothing and the reset is what the
	 * change causes — and biome's rule cannot tell the two apart.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: a query change is the trigger; the effect deliberately reads nothing.
	useEffect(() => {
		listRef.current?.scrollTo({ top: 0 });
	}, [query]);
	useEffect(() => {
		const row = listRef.current?.querySelector<HTMLElement>(
			`[id="${listId}-${active}"]`,
		);
		row?.scrollIntoView?.({ block: "nearest" });
	}, [active, listId]);

	const pick = useCallback(
		async (option: PickerOption | undefined) => {
			if (!option || option.disabled || busy) return;
			dispatch({ type: "pick", value: option.value });
			await onPick?.(option.value, option);
		},
		[onPick, busy],
	);
	/*
	 * Handler identities the memoized rows depend on.
	 *
	 * `pick` moves when `busy` or the adapter's callback moves, and a new
	 * identity for it would invalidate every row's props and re-render the whole
	 * list on each pick — the cost memoization exists to remove. The ref keeps
	 * the identity stable while still calling the current closure; row callbacks
	 * are the only readers.
	 */
	const pickRef = useRef(pick);
	useEffect(() => {
		pickRef.current = pick;
	}, [pick]);
	const pickRow = useCallback((option: PickerOption, index: number) => {
		/*
		 * The click moves the keyboard's row to what it clicked (UX U1).
		 *
		 * Without it, a click left the highlight on the row the arrows had last
		 * reached — measured at 1492px away, off screen — so the one row still
		 * marked as "selected" was one the user never chose, for the whole wait.
		 * The picker's own footers, the row marks and the picked row's `aria-
		 * selected` all read `active`, so this is what makes the mark and the
		 * action agree after a pointer pick.
		 *
		 * Hover still does NOT steer it (design D2): only an action moves the
		 * selection, and the pointer's own action is the click.
		 */
		setActive(index);
		void pickRef.current(option);
	}, []);
	const setHoveredIndex = useCallback(
		(index: number | null) =>
			dispatch(index === null ? { type: "leave" } : { type: "hover", index }),
		[],
	);
	const clearHovered = useCallback(() => dispatch({ type: "leave" }), []);

	const onKeyDown = useCallback(
		(event: KeyboardEvent<HTMLInputElement>) => {
			if (event.nativeEvent.isComposing) return;
			if (event.key === "ArrowDown" && filtered.length > 0) {
				event.preventDefault();
				setActive((current) => (current + 1) % filtered.length);
			} else if (event.key === "ArrowUp" && filtered.length > 0) {
				event.preventDefault();
				setActive(
					(current) => (current - 1 + filtered.length) % filtered.length,
				);
			} else if (event.key === "Enter") {
				event.preventDefault();
				if (hasList && filtered.length > 0 && onPick) {
					void pick(filtered[active]);
				} else if (onSubmit && !submitDisabled && !busy) {
					void onSubmit();
				}
			}
		},
		[filtered, active, hasList, onPick, onSubmit, submitDisabled, busy, pick],
	);

	const handleFormSubmit = useCallback(
		(event: FormEvent) => {
			event.preventDefault();
			if (onSubmit && !submitDisabled && !busy) void onSubmit();
		},
		[onSubmit, submitDisabled, busy],
	);

	const grouped = useMemo(() => {
		const groups = new Map<string, PickerOption[]>();
		for (const option of filtered) {
			const key = option.group ?? "";
			const bucket = groups.get(key);
			if (bucket) bucket.push(option);
			else groups.set(key, [option]);
		}
		return [...groups.entries()];
	}, [filtered]);

	// Which of the four body states this render is in. The decision is a pure
	// export so its order (loading before error before empty) is asserted rather
	// than re-derived from the JSX each time this component is touched.
	const bodyKind = pickerBodyKind({
		loading,
		loadError,
		rowCount: filtered.length,
	});
	// Flat index across groups, so arrow keys walk the visible order.
	let flatIndex = -1;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				className={cn(
					"gap-0 p-0",
					shell === "panel" ? "max-w-5xl" : wide ? "max-w-3xl" : "max-w-xl",
					// The dialog is a frame: 14px radius, content clipped to it.
					"overflow-hidden rounded-lg",
				)}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
					/*
					 * A panel has no list to focus, and the search input is not rendered at
					 * all, so Radix's prevented default would leave focus on the trigger
					 * behind the dialog. The body scroll region is the panel's own tab stop
					 * (it is `tabIndex={0}` below), so focus lands where a keyboard user can
					 * immediately PageDown through the content; with no body mounted, the
					 * footer's Close button is the only control there is.
					 */
					if (shell === "panel") {
						bodyRegionRef.current?.focus();
						if (!bodyRegionRef.current) closeButtonRef.current?.focus();
						return;
					}
					inputRef.current?.focus();
				}}
			>
				<div className="flex flex-col gap-1 px-5 pt-5 pr-12">
					<DialogTitle className="text-heading text-ink">{title}</DialogTitle>
					{description ? (
						<DialogDescription className="text-body-sm text-ink-muted">
							{description}
						</DialogDescription>
					) : (
						<DialogDescription className="sr-only">{title}</DialogDescription>
					)}
				</div>

				{hasList && (
					<div className="px-5 pt-4">
						<div className="relative">
							<Search
								className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-4 text-ink-dim"
								aria-hidden="true"
							/>
							<Input
								ref={inputRef}
								role="combobox"
								aria-expanded={true}
								aria-controls={listId}
								aria-activedescendant={
									filtered[active] ? `${listId}-${active}` : undefined
								}
								aria-autocomplete="list"
								value={query}
								onChange={(event) => setQuery(event.target.value)}
								onKeyDown={onKeyDown}
								placeholder={searchPlaceholder}
								className="pl-8"
								autoComplete="off"
								spellCheck={false}
							/>
						</div>
					</div>
				)}
				{!hasList && !body && (
					// A form-only picker still needs one focus target for Enter/Esc.
					<input
						ref={inputRef}
						className="sr-only"
						aria-hidden="true"
						tabIndex={-1}
						onKeyDown={onKeyDown}
						readOnly
					/>
				)}

				{toolbar && <div className="px-5 pt-3">{toolbar}</div>}

				{hasList && (
					<div className="px-3 pt-3">
						{/* The partial-listing note, ABOVE the body rather than instead of
						    it: `catalogue.data` still holds the rows the other providers
						    answered with (design D4). */}
						{notice && (
							<Tooltip content={noticeDetail}>
								<p className="px-2 pb-2 text-body-sm text-warning">{notice}</p>
							</Tooltip>
						)}
						{bodyKind === "loading" ? (
							<div className="flex h-24 items-center justify-center">
								<Spinner size="md" label="Loading" />
							</div>
						) : bodyKind === "error" ? (
							<p className="px-2 py-3 text-body-sm text-danger">{loadError}</p>
						) : bodyKind === "empty" ? (
							<p className="px-2 py-3 text-body-sm text-ink-dim">{emptyText}</p>
						) : (
							<div
								ref={listRef}
								id={listId}
								/* biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>. */
								role="listbox"
								aria-label={title}
								/*
								 * OUT of the tab order, explicitly (UX U5).
								 *
								 * Chrome makes a scrollable region focusable, so this reached by Tab drew
								 * a focus ring that reads as "this region is now in play" while the arrow
								 * keys scrolled the list instead of moving the selection and Enter picked
								 * nothing — the one place in the picker where the arrows stop working.
								 * `-1` keeps it programmatically focusable (and keeps `listRef` and the
								 * ref callback working) while removing it from the tab sequence, which is
								 * what the comment above always claimed.
								 */
								tabIndex={-1}
								// The pointer's highlight is cleared when it leaves the list, so a
								// hover left over from somewhere else can never read as the
								// keyboard's selection (design D2).
								onMouseLeave={clearHovered}
								className="max-h-[min(50vh,420px)] overflow-y-auto"
							>
								{grouped.map(([group, rows]) => (
									<div key={group || "ungrouped"}>
										{group && (
											<p className="px-2 pt-2 pb-1 text-ink-dim text-meta">
												{group}
											</p>
										)}
										{rows.map((option) => {
											flatIndex += 1;
											const index = flatIndex;
											return (
												<PickerRow
													key={option.value}
													id={`${listId}-${index}`}
													option={option}
													index={index}
													isActive={index === active}
													isHovered={index === list.hovered}
													isPicked={list.picked === option.value}
													onHover={setHoveredIndex}
													onPick={pickRow}
													busyLabel={busyLabel}
												/>
											);
										})}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{body && (
					/*
					 * A scrolling body announces its own overflow — and only then.
					 *
					 * Without an edge at the fold, content clipped mid-glyph read as a
					 * rendering defect rather than as "there is more below": in the
					 * densest usage frame the cut ran horizontally through a `41%` and
					 * through the card's border mid-stroke, with nothing separating the
					 * body from the footer.
					 *
					 * Two things the first attempt at this got wrong, both measured on
					 * rendered frames (design D4):
					 *
					 * - It was `hairline`, measuring 1.08:1 dark and 1.03:1 light against
					 *   the body above and 1.01:1 against the footer below. This rule is
					 *   the ENTIRE answer to "is there more below", so by branding § 2's
					 *   own test — would removing it lose information? — it is structural
					 *   and sits on the 3:1 floor, which only `border-control` carries.
					 * - It drew from the flag alone, so six `/usage` states whose content
					 *   ends well above the fold got a boundary under nothing.
					 *
					 * `scrollbar-gutter: stable` stays tied to the FLAG rather than to
					 * measured overflow: it reserves the scrollbar column in every state,
					 * the same call the TUI makes (`SCROLLBAR_GUTTER_CELLS`) and for the
					 * same reason — reserving it only when the bar appears slides every
					 * right-aligned number sideways the moment content overflows. Making
					 * THAT conditional would reintroduce the jump it prevents.
					 *
					 * The rule sits on the WRAPPER rather than on the scrolling box
					 * because the box carries the fade mask, and a mask applies to an
					 * element's border as much as to its content — both on one element
					 * fades out the very rule that has to hold the 3:1 floor.
					 */
					<div className={cn(bodyOverflows && "border-control border-b")}>
						<div
							ref={attachBodyBox}
							/* biome-ignore lint/a11y/noNoninteractiveTabindex: the tab stop IS the fix; a panel's content sits below the fold and a keyboard user has to be able to reach it. */
							role={shell === "panel" ? "region" : undefined}
							aria-label={shell === "panel" ? PANEL_BODY_LABEL : undefined}
							tabIndex={shell === "panel" ? 0 : undefined}
							className={cn(
								"overflow-y-auto px-5 pt-3",
								shell === "panel"
									? "max-h-[min(76vh,760px)] pb-4"
									: "max-h-[min(60vh,520px)]",
								// Unconditional for a panel, for the reason the flag exists:
								// reserving the scrollbar column only when the bar appears slides
								// every right-aligned number sideways the moment content overflows,
								// and a panel is the surface with columns of numbers.
								(bodyScrolls || shell === "panel") &&
									"[scrollbar-gutter:stable]",
								// The last 20px of a CONTINUING list fade out, so a row cut
								// through its glyphs reads as "there is more" rather than as a
								// rendering defect. Clipping to a row boundary instead is not
								// available here: the body holds cards of several heights, so
								// there is no single row pitch to snap to.
								bodyHasMoreBelow &&
									"[mask-image:linear-gradient(to_bottom,black_calc(100%-20px),transparent)]",
							)}
						>
							{body}
						</div>
					</div>
				)}

				{form && (
					<form
						onSubmit={handleFormSubmit}
						className={cn(
							"flex flex-col gap-3 px-5",
							hasList ? "pt-3" : "pt-4",
						)}
					>
						{form}
						{/* Enter inside a text field submits the form; the hidden button is
						 * what makes the browser honour that without a visible duplicate. */}
						<button
							type="submit"
							className="sr-only"
							tabIndex={-1}
							aria-hidden="true"
						/>
					</form>
				)}

				{result && (
					<div className="px-5 pt-3">
						<output
							className={cn(
								"block rounded-md border px-3 py-2 text-body-sm",
								TONE_CLASS[result.tone],
							)}
						>
							<p className="whitespace-pre-wrap">{result.text}</p>
							{result.detail && (
								<div className="mt-2 font-mono text-mono-sm">
									{result.detail}
								</div>
							)}
						</output>
					</div>
				)}

				<div className="flex items-center justify-between gap-3 px-5 py-4">
					{/*
					 * The hint names the row Enter would pick (UX U1) and truncates rather
					 * than wrapping, because a long model name here is the only text in the
					 * dialog that is not already bounded by a column.
					 */}
					<span className="min-w-0 truncate text-ink-dim text-meta">
						{busy ? (
							/*
							 * `Working` was the whole of the feedback while a pick was in flight,
							 * and a cold backend bind measures 1.1-4.2 s — long enough that the
							 * word alone reads as a hang (design D3, latency U2). The adapter
							 * names the change it is making (`busyText`); the picked row's
							 * spinner says which row the answer is about.
							 */
							<span className="flex items-center gap-2 text-ink-muted">
								<Spinner size="sm" />
								{pickerFooterHint({
									busy,
									hasList,
									rowCount: filtered.length,
									activeLabel,
									busyText,
								})}
							</span>
						) : (
							pickerFooterHint({
								busy,
								hasList,
								rowCount: filtered.length,
								activeLabel,
								busyText,
							})
						)}
					</span>
					<div className="flex items-center gap-2">
						{actions}
						{/*
						 * `Cancel` named an action the control does not take: closing the dialog
						 * does not cancel the switch the owner is already performing — it only
						 * stops the user watching it (design D3). `Close` also ends the two-words-
						 * for-one-action row D15 filed, where the hint beside it read "Esc
						 * closes".
						 */}
						<Button
							ref={closeButtonRef}
							variant="ghost"
							size="sm"
							type="button"
							onClick={onClose}
						>
							{pickerPrimaryLabel({ busy, result })}
						</Button>
						{onSubmit && (
							<Button
								variant="primary"
								size="sm"
								type="button"
								onClick={() => void onSubmit()}
								disabled={submitDisabled || busy}
							>
								{submitLabel}
							</Button>
						)}
					</div>
				</div>
			</DialogContent>
		</Dialog>
	);
};

/** Small labelled field row used by the destination forms. */
export const PickerField: FC<{
	label: string;
	hint?: string;
	children: ReactNode;
	htmlFor?: string;
}> = ({ label, hint, children, htmlFor }) => (
	<label className="flex flex-col gap-1" htmlFor={htmlFor}>
		<span className="text-ink-muted text-meta">{label}</span>
		{children}
		{hint && <span className="text-ink-dim text-meta">{hint}</span>}
	</label>
);

/** Two-line key/value used by data views; monospace for machine values. */
export const PickerKeyValue: FC<{
	label: string;
	value: ReactNode;
	mono?: boolean;
}> = ({ label, value, mono = true }) => (
	<div className="flex items-baseline justify-between gap-4 py-1">
		<span className="text-body-sm text-ink-muted">{label}</span>
		<span
			className={cn(
				"text-right text-ink",
				mono ? "font-mono text-mono-sm" : "text-body-sm",
			)}
		>
			{value}
		</span>
	</div>
);

/** Checkbox with an id-associated label; the shape every consent row uses. */
export const PickerCheck: FC<{
	checked: boolean;
	onCheckedChange: (checked: boolean) => void;
	children: ReactNode;
	tone?: "muted" | "ink";
}> = ({ checked, onCheckedChange, children, tone = "muted" }) => {
	const id = useId();
	return (
		<div className="flex items-center gap-2">
			<Checkbox
				id={id}
				checked={checked}
				onCheckedChange={(next) => onCheckedChange(next === true)}
			/>
			<Label
				htmlFor={id}
				className={cn(
					"font-normal text-body-sm",
					tone === "ink" ? "text-ink" : "text-ink-muted",
				)}
			>
				{children}
			</Label>
		</div>
	);
};

/**
 * Segmented control over native radio inputs. The track is 10px with 4px
 * padding, so the pills are 6px (concentric radii, § 5); the checked pill is
 * a lightness step, not a shadow.
 */
export function PickerSegment<T extends string>({
	value,
	onChange,
	options,
	label,
}: {
	value: T;
	onChange: (value: T) => void;
	options: { value: T; label: string }[];
	label: string;
}) {
	const name = useId();
	return (
		<fieldset className="flex items-center gap-1 rounded-md bg-sunken p-1">
			<legend className="sr-only">{label}</legend>
			{options.map((option) => {
				const id = `${name}-${option.value}`;
				return (
					<span key={option.value}>
						<input
							type="radio"
							id={id}
							name={name}
							value={option.value}
							checked={value === option.value}
							onChange={() => onChange(option.value)}
							className="sr-only"
						/>
						<label
							htmlFor={id}
							className={cn(
								"block cursor-default rounded-sm px-3 py-1 text-body-sm",
								value === option.value
									? "bg-surface text-ink"
									: "text-ink-muted hover:text-ink",
							)}
						>
							{option.label}
						</label>
					</span>
				);
			})}
		</fieldset>
	);
}
