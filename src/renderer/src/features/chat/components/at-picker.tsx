/**
 * The `@` picker: the composer's second popup, over the same field, with the
 * same shell and the same anchor as the slash list.
 *
 * WHAT IT IS, in one line: typing `@` opens a list of the working directory's
 * entries — drilling in on `/`, ranked fuzzily, with recents and a common-file
 * pool folded into one ordering — and accepting a row writes a literal
 * `@src/app.py` token into the draft. The token is the whole of the feature's
 * contract with the harness: expansion happens on the backend
 * (`damianvtran/local-operator#1220`), and this file's only job is to produce
 * exactly the text that expansion reads (`at-token.ts`).
 *
 * WHY IT REUSES THE SLASH POPUP RATHER THAN GROWING A SECOND KIND OF LIST. The
 * two are both "a list over this field", and they anchor to the same 4px gap
 * (`message-input.tsx` mounts both inside one `relative` wrapper), so a second
 * shell would be a second way of doing one thing. Copied deliberately and
 * exactly, from `slash-commands.tsx`: the anchor, the shell's
 * `overflow-hidden rounded-md border border-control bg-elevated shadow-lg`, the
 * scroller split, the 36px row pitch, the `border-hairline` strips, the row inks,
 * the `bg-accent-wash` + 2px accent bar for the active row, the
 * `role="listbox"`/`role="option"` + `aria-activedescendant` contract with the
 * textarea keeping focus, `onMouseDown` `preventDefault` with the pick on
 * `onClick`, and the same `block: "nearest"` scroll-into-view.
 *
 * WHAT IT MUST NOT INHERIT, because the two grammars differ: there is no phase
 * strip (a `@` token has ONE list, so the strip does the job this picker actually
 * has — naming the directory being listed); no ambiguity gate and no
 * extend-to-common-prefix (writing a path has no blast radius, so Enter and Tab
 * both apply the row unconditionally — see `at-contract.ts`); no argument phase.
 * And it must not become `PickerHost`, the app's other list: that is a dialog
 * with a search input which TAKES focus, and this picker must never take focus
 * from the field the user is typing in.
 */

import { cn } from "@shared/lib/utils";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import type { FC, KeyboardEvent } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useLayoutEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	AT_ROWS_MIN,
	AT_ROW_PITCH,
	AT_UNAVAILABLE_REASON,
	type AtKeyInput,
	type AtKeyIntent,
	atCount,
	atEmptyCopy,
	atFooter,
	atKeyIntent,
	atRowBudget,
	atRowId,
} from "./at-contract";
import {
	type AtRow,
	atDescendTargets,
	descendRows,
	interleaveDescend,
	rankAtRows,
	rowsFromListing,
} from "./at-rank";
import { type AtToken, atPickerToken, splitToken } from "./at-token";

/** The listing IPC, as this file uses it. Absent outside Electron. */
type ListingBridge = {
	listDirectory: (
		dir: string,
		cwd?: string,
	) => Promise<{
		dir: string;
		entries: { name: string; directory: boolean }[];
		truncated: boolean;
		error?: string;
	}>;
};

const bridge = (): ListingBridge | null => {
	const api = (window as unknown as { api?: Partial<ListingBridge> }).api;
	return typeof api?.listDirectory === "function"
		? (api as ListingBridge)
		: null;
};

/**
 * How long the keystroke path waits before asking the main process to stat or
 * list anything.
 *
 * The composer re-renders on every character, and a request per character would
 * be a round trip per character for an answer that is superseded before it
 * arrives. Short enough that a typed path does not visibly lag (the listing is
 * one `readdir`, and the empty-query case — a bare `@` — is what the user is
 * waiting on), and long enough that a burst of typing is one request.
 */
export const AT_QUERY_DEBOUNCE_MS = 60;

/**
 * Where a listing's raw failure detail goes, and why it is not the notice row.
 *
 * The row says what happened and what to do in the user's terms (`unreadableCopy`);
 * the errno, the syscall and the absolute path are what a developer needs when the
 * user reports it, so they are written here instead. One channel, one line per
 * failure, and a cancelled render never reaches it.
 */
const reportListingError = (dir: string, detail: string) => {
	if (typeof console !== "undefined")
		console.warn(`[mentions] could not list ${dir || "."}: ${detail}`);
};

export type AtCompletionState = {
	/**
	 * Whether this surface exists at all: no listing bridge, no picker — and no
	 * harness that expands a mention either (see `UseAtPickerArgs.enabled`).
	 */
	available: boolean;
	open: boolean;
	active: number;
	rows: AtRow[];
	/** The token the caret is in, or null. The picker is opened by this alone. */
	token: AtToken | null;
	listId: string;
	activeDescendantId: string | null;
	/** The directory being listed, relative to the working directory. */
	header: string;
	/** That directory's resolved path, for the header's `title`. */
	headerTitle: string;
	footer: string;
	/** How many entries the listing holds, for the footer's own count. */
	entries: number;
	notice: string;
	loading: boolean;
	/** True once the user has arrowed onto a row in THIS list. */
	close(): void;
	/**
	 * WHY THIS COMPOSER HAS NOTHING TO OFFER, when the reason is the harness itself.
	 *
	 * The one state the gate used to leave completely silent (UX round 2, U12): a
	 * backend that does not advertise `references` gets no list, no chip, no tip and
	 * no sentence, so a user who typed `@` is left believing the app has no such
	 * gesture. This is the sentence, and `null` in every other state — including the
	 * mid-turn one, where the harness CAN carry a reference and the reason is the
	 * turn (`at-mention-overlay.tsx` and `chat-page.tsx` fold both into `enabled`,
	 * which is why the reason cannot be derived from it).
	 */
	unavailable: string | null;
	setActive(index: number): void;
	setActiveHover(index: number): void;
	/** Record an accepted reference, so it ranks first next time. */
	remember(path: string): void;
};

export type UseAtPickerArgs = {
	/** The draft. */
	text: string;
	/** The caret, as the composer tracks it. */
	caret: number;
	/** The session's working directory, or undefined on a draft pane. */
	cwd?: string;
	/**
	 * Whether the `@` affordance may be offered at all.
	 *
	 * FALSE MEANS THE PICKER DOES NOT EXIST, and it is an input rather than a
	 * derivation here because both of the states it folds in are the composer's own
	 * to know and neither is a property of the listing: the connected harness must
	 * advertise that it expands a mention (`desktop-hooks.ts`'s `references` key),
	 * and the send this draft would make must be a PROMPT rather than a mid-turn
	 * STEER — the harness's steer path bypasses `Session.prompt`, so an `@path` in
	 * one is left as inert prose.
	 *
	 * FAIL CLOSED, and the asymmetry is deliberate: an offer that does nothing costs
	 * the user a pick, a chip claiming a reference the model never receives, and no
	 * way to tell. The plain-text path it falls back to is the harness's own
	 * behaviour for exactly this draft.
	 */
	enabled?: boolean;
	/**
	 * Whether the harness itself cannot carry a reference, as a fact of its own.
	 *
	 * SEPARATE FROM `enabled` because the two false states of that flag are not the
	 * same fact (UX round 2, U12): a turn in flight withholds the affordance from a
	 * harness that CAN expand a mention, and saying "this backend cannot carry file
	 * references" there would be false. Only the caller can tell them apart — it owns
	 * the capability answer — so it hands the harness half down and the turn half
	 * stays in `enabled`.
	 */
	unsupported?: boolean;
};

/**
 * One listing's cache entry, keyed by the directory AS TYPED.
 *
 * Keyed by the typed dir part rather than the resolved path so a `./src/` and a
 * `src/` are two entries rather than one — the resolution happens in the main
 * process, and the renderer deliberately does no path arithmetic to unify them
 * (`directory-listing.ts` owns the one path rule).
 */
type ListingState = {
	dir: string;
	entries: { name: string; directory: boolean }[];
	truncated: boolean;
	error?: string;
};

export function useAtPicker({
	text,
	caret,
	cwd,
	enabled = false,
	unsupported = false,
}: UseAtPickerArgs): AtCompletionState {
	const listId = useId();
	const available = enabled && bridge() !== null;

	/*
	 * The recents ring, per workspace, from the UI preferences store — the
	 * design's open item 6, answered: the store persists (`zustand/persist` into
	 * `ui-preferences-storage`), so an accepted mention survives a restart, which
	 * is the whole value of the pool. The ring is bounded at 20 by the store's own
	 * writer, and it is keyed to the workspace it was built in, so moving the cwd
	 * starts a fresh list rather than offering paths from somewhere else.
	 */
	const recentsFor = useUiPreferencesStore((s) => s.mentionRecents);
	const rememberMention = useUiPreferencesStore((s) => s.rememberMention);
	const recents = useMemo(() => {
		if (!recentsFor || recentsFor.cwd !== (cwd ?? "")) return new Set<string>();
		return new Set(recentsFor.paths);
	}, [recentsFor, cwd]);

	/*
	 * `atPickerToken` rather than `atToken`: the picker writes the token the chip
	 * layer draws, so it must skip the two cases the resolver will not expand (a
	 * pasted block, and a `typed=` token a block already names) or it would offer a
	 * list over a span the harness sends as prose. See the function.
	 */
	const token = useMemo(() => atPickerToken(text, caret), [text, caret]);
	const [dirPart, nameQuery] = useMemo(
		() => (token ? splitToken(token.query) : ["", ""]),
		[token],
	);

	const [listing, setListing] = useState<ListingState | null>(null);
	const [loading, setLoading] = useState(false);
	const [children, setChildren] = useState<ReadonlyMap<string, AtRow[]>>(
		new Map(),
	);

	/*
	 * The listing fetch: one request per (directory, workspace) the token names,
	 * debounced, with the PREVIOUS listing left in place while a new one is in
	 * flight. Leaving it in place is what keeps the region's height steady — the
	 * same rule the design applies to the no-match state, and the reason the
	 * loading sentence only appears when there is nothing to show yet.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `token` is read for its presence only; the request is keyed by the directory and the workspace, which is what must not change per keystroke.
	useEffect(() => {
		const api = bridge();
		if (!available || !api || !token) {
			setListing(null);
			setChildren(new Map());
			return;
		}
		let cancelled = false;
		setLoading(true);
		const timer = setTimeout(() => {
			api
				.listDirectory(dirPart, cwd)
				.then((answer) => {
					if (cancelled) return;
					if (answer.error) reportListingError(answer.dir, answer.error);
					setListing(answer);
					setLoading(false);
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					// A transport failure is reported in the listing's own sentence
					// rather than swallowed: `Could not read this folder.` with no next step
					// is the unfinished error the contract refuses (§ 8). The raw detail is
					// logged rather than quoted at the user (design round 1's D4 / UX round
					// 1's U5 measured the sentence that used to carry an errno, the syscall
					// and an absolute path).
					const detail = error instanceof Error ? error.message : String(error);
					reportListingError(dirPart, detail);
					setListing({
						dir: dirPart,
						entries: [],
						truncated: false,
						error: detail,
					});
					setLoading(false);
				});
		}, AT_QUERY_DEBOUNCE_MS);
		return () => {
			cancelled = true;
			clearTimeout(timer);
		};
	}, [available, dirPart, cwd, token === null]);

	const listingRows = useMemo(
		() => (listing ? rowsFromListing(listing.entries, dirPart) : []),
		[listing, dirPart],
	);
	const ranked = useMemo(
		() => rankAtRows(listingRows, nameQuery, recents),
		[listingRows, nameQuery, recents],
	);
	const descendTargets = useMemo(
		() => atDescendTargets(ranked, nameQuery),
		[ranked, nameQuery],
	);

	/*
	 * The descend: the children of the top two matching DIRECTORIES, one level
	 * each, listed after the primary listing has resolved.
	 *
	 * It reads the same bridge and is bounded to two calls because it runs on the
	 * keystroke path; an unbounded version is a tree walk, which is the cost the
	 * harness's own picker spends a docstring refusing. Keyed by the directory
	 * paths it descends into, so a re-render that produces the same targets does
	 * not re-request them.
	 */
	const descendKey = descendTargets.map((row) => row.path).join("\n");
	// biome-ignore lint/correctness/useExhaustiveDependencies: the request is keyed by `descendKey`; `descendTargets` is read only through it, so listing the array would re-run on every new identity.
	useEffect(() => {
		const api = bridge();
		if (!available || !api || descendTargets.length === 0) {
			setChildren(new Map());
			return;
		}
		let cancelled = false;
		void Promise.all(
			descendTargets.map((row) =>
				api
					.listDirectory(row.path, cwd)
					.then(
						(answer) =>
							[row.path, descendRows(answer.entries, row.path)] as const,
					)
					.catch(() => [row.path, [] as AtRow[]] as const),
			),
		).then((pairs) => {
			if (cancelled) return;
			setChildren(new Map(pairs));
		});
		return () => {
			cancelled = true;
		};
	}, [available, descendKey, cwd]);

	const rows = useMemo(
		() => interleaveDescend(ranked, children),
		[ranked, children],
	);

	/*
	 * Esc latches PER TOKEN, by the token's own text and start — the slash popup's
	 * rule (`slash-commands.tsx`, from the TUI's `_sync_picker_if_phase_changed`).
	 * Without it the list reopens on the very next keystroke, because the state is
	 * re-derived on every render.
	 */
	const dismissed = useRef<string | null>(null);
	const tokenKey = token === null ? null : `${token.start}:${token.query}`;
	/*
	 * THE MARKER FOLLOWS A ROW, NOT A SLOT (UX round 1, U9).
	 *
	 * The rows are re-derived asynchronously: accepting a directory re-writes the
	 * token and the descend listing lands after the base listing, so the row SET
	 * changes under a marker that used to be clamped by INDEX. The same two
	 * keystrokes then inserted two different files — measured live, one run with the
	 * marker on `schema.ts` (a row the user never moved to) and the footer naming
	 * it, the repeat with the marker correctly on the first row.
	 *
	 * So the marker's identity is the marked row's `path`, and a re-derived list
	 * re-anchors the marker onto that path. `marked: null` is the no-choice state a
	 * freshly opened list is in: the marker sits on the top row and Enter takes it
	 * (the footer names it, so the key is not a surprise), but nothing has BEEN
	 * chosen, so a reorder cannot be said to have moved a choice. A marked row that
	 * is no longer in the list clears the marker rather than leaving the index where
	 * it was, because a reflex second Enter must never land on a row the user has
	 * not read.
	 */
	const [state, setState] = useState<{
		open: boolean;
		active: number;
		marked: string | null;
	}>({ open: false, active: 0, marked: null });
	const lastTokenKey = useRef<string | null>(null);

	useEffect(() => {
		if (tokenKey !== dismissed.current) dismissed.current = null;
		const changed = lastTokenKey.current !== tokenKey;
		lastTokenKey.current = tokenKey;
		setState((current) => {
			if (tokenKey === null || dismissed.current === tokenKey) {
				return current.open ? { ...current, open: false } : current;
			}
			// A new token opens on the top row with no choice made.
			if (changed) return { open: true, active: 0, marked: null };
			if (current.marked === null)
				return { open: true, active: 0, marked: null };
			const index = rows.findIndex((row) => row.path === current.marked);
			if (index === -1) return { open: true, active: 0, marked: null };
			return index === current.active
				? current
				: { open: true, active: index, marked: current.marked };
		});
	}, [tokenKey, rows]);

	const close = useCallback(() => {
		dismissed.current = tokenKey;
		setState((current) => ({ ...current, open: false }));
	}, [tokenKey]);

	const setActive = useCallback(
		(index: number) => {
			setState((current) => ({
				...current,
				active: index,
				marked: rows[index]?.path ?? null,
			}));
		},
		[rows],
	);

	/*
	 * A hover moves the marker without counting as a choice. There is no ambiguity
	 * gate here for it to answer, so the two setters do the same thing — kept
	 * separate because the ROW's own handlers are the slash popup's pair and a
	 * single setter would hide the distinction the moment one is added.
	 */
	const setActiveHover = setActive;

	/*
	 * The recents write, bound to the workspace it was read from: a path is only
	 * meaningful relative to the directory it was accepted in, so the store's own
	 * write takes the cwd that names the ring rather than trusting the list's.
	 */
	const remember = useCallback(
		(path: string) => rememberMention(cwd ?? "", path),
		[rememberMention, cwd],
	);

	const activeRow = rows[state.active];
	const entries = listing?.entries.length ?? 0;

	return {
		available,
		open: state.open && tokenKey !== null && available,
		/*
		 * The caret has to be in a mention-shaped token for the sentence to be worth
		 * saying, and that is the whole of its condition: it answers the user's own
		 * gesture ("I typed `@`, and nothing happened") rather than decorating a
		 * composer that is idle, so an ordinary draft never carries it.
		 */
		unavailable:
			tokenKey !== null && unsupported ? AT_UNAVAILABLE_REASON : null,
		active: state.active,
		rows,
		token,
		listId,
		activeDescendantId:
			state.open && rows[state.active]
				? `${listId}-${atRowId(rows[state.active])}`
				: null,
		// `./` rather than an empty string for the working directory itself: the
		// header says which directory is being listed, and a blank strip reads as a
		// rendering fault rather than as "here".
		header: dirPart === "" ? "./" : dirPart,
		headerTitle: listing?.dir ?? "",
		footer: atFooter(activeRow),
		/*
		 * The footer's count is assembled by the POPUP, not here, because its first
		 * number is the rows the REGION draws — and the region's height is the popup's
		 * own measured budget (design round 1, D3). Handing `rows.length` from here was
		 * the defect: the column described the query rather than the window, so it
		 * vanished exactly when the region truncated.
		 */
		entries,
		notice: atEmptyCopy({
			error: listing?.error ?? null,
			// Rows on screen mean the wait is not the state the user is looking at:
			// the previous listing stays up while the next one is in flight.
			loading: loading && rows.length === 0,
			entries,
			matched: rows.length,
			query: nameQuery,
			scope: dirPart === "" ? "./" : dirPart,
		}),
		loading,
		close,
		setActive,
		setActiveHover,
		remember,
	};
}

/**
 * The key router, as an adapter over the pure decision.
 *
 * `atKeyIntent` is bundled and executed by `scripts/at-mentions.test.mjs` — the
 * browser harness cannot dispatch key events, so the routing has to be exercised
 * as the code that ships or it is not exercised at all (`slash-contract.ts` made
 * the same move for the same reason). This adapter only turns the intent into
 * callbacks.
 */
export function handleAtKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	state: AtCompletionState,
	onPick: (row: AtRow) => void,
): boolean {
	const input: AtKeyInput = {
		key: event.key,
		composing: event.nativeEvent.isComposing,
		open: state.open,
		active: state.active,
		count: state.rows.length,
	};
	const intent: AtKeyIntent = atKeyIntent(input);
	switch (intent.kind) {
		case "move":
			// Moving without latching, exactly as the slash popup does: a key that
			// asked to move and could not is not a choice.
			if (intent.moved) state.setActive(intent.index);
			else state.setActiveHover(intent.index);
			return true;
		case "apply": {
			const row = state.rows[intent.index];
			if (!row) return false;
			onPick(row);
			return true;
		}
		case "close":
			state.close();
			return true;
		case "hold":
			// The list is open and holds no row, so Enter must not reach the composer's
			// submit path: the user pressed the key to TAKE A ROW and there is none to
			// take. Claiming the key with nothing written is the whole of this case —
			// `state.close()` would be a different claim ("dismiss the list"), and
			// Escape is already on screen as the way to do that (UX round 1, U3).
			return true;
		default:
			return false;
	}
}

/**
 * The tallest ancestor's top edge that would clip this popup, in viewport px.
 *
 * Found by walking up from the anchor and taking the first ancestor whose
 * `overflow-y` is not `visible`: the popup is unportaled and `absolute
 * bottom-full`, so any such ancestor above it clips its top rows — and the row
 * budget is spent out of the space that is actually left rather than out of the
 * window. The viewport's own top (0) is the answer when nothing clips, which is
 * the honest reading of "unbounded above".
 */
function clipTopOf(anchor: HTMLElement): number {
	let node: HTMLElement | null = anchor;
	while (node) {
		const style = window.getComputedStyle(node);
		if (style.overflowY !== "visible" && style.overflowY !== "") {
			return node.getBoundingClientRect().top;
		}
		node = node.parentElement;
	}
	return 0;
}

type AtSuggestionsPopupProps = {
	state: AtCompletionState;
	onPick: (row: AtRow) => void;
};

export const AtSuggestionsPopup: FC<AtSuggestionsPopupProps> = ({
	state,
	onPick,
}) => {
	/*
	 * `HTMLDivElement & HTMLOutputElement`: the shell is a `div` when it holds the list
	 * and an `<output>` when it says why the harness cannot carry a mention — the
	 * element that IS the status role rather than a `div` wearing it (UX round 2,
	 * U12) — and the measurement below reads only geometry, so one ref serves both.
	 */
	const shellRef = useRef<(HTMLDivElement & HTMLOutputElement) | null>(null);
	const activeRef = useRef<HTMLLIElement | null>(null);
	const [budget, setBudget] = useState(AT_ROWS_MIN);

	/*
	 * The measured row budget (design § 3.2). It is measured rather than stated
	 * for the reason `suggestion-stack.ts` gives: a cap in px cannot be aligned to
	 * a row by construction, and a cap that lands mid-row cuts a row of glyphs.
	 * Re-measured on a resize and whenever the list changes size, because both
	 * move the anchor or the space above it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: the measurement must re-run when the popup's own contents change height, which is what `state.rows.length` and `state.notice` stand for; the body reads only refs and layout.
	useLayoutEffect(() => {
		const shell = shellRef.current;
		const anchor = shell?.parentElement;
		if (!shell || !anchor) return;
		const measure = () => {
			const budgetRows = atRowBudget(
				anchor.getBoundingClientRect().top,
				clipTopOf(anchor),
			);
			setBudget((current) => (current === budgetRows ? current : budgetRows));
		};
		measure();
		window.addEventListener("resize", measure);
		return () => window.removeEventListener("resize", measure);
	}, [state.rows.length, state.notice, state.open]);

	// Keep the active row in view without scrolling the page or transcript.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not a read - the ref is what is read, the same shape the slash popup's own effect uses.
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [state.active]);

	/*
	 * THE ONE STATE WHERE THE COMPOSER SAYS WHY IT HAS NOTHING TO OFFER (UX round 2,
	 * U12), in the same one-row notice register the empty states use.
	 *
	 * NOT a `listbox`, and deliberately not the same element: there are no options
	 * here and no key acts on anything, so claiming a listbox would be a second lie
	 * on top of the silence this replaces (the field's `aria-expanded` stays false,
	 * which is what "there is no list" means). `role="status"` is what makes the
	 * sentence arrive for a screen-reader user the moment the token under the caret
	 * brings it on screen — the same polite-announcement role the composer's own
	 * notices use.
	 *
	 * ONE ROW, NO HEADER AND NO FOOTER, because neither has anything to say: the
	 * header names a directory that is not being listed, and the footer names keys
	 * that would do nothing. It costs the composer NOTHING — the shell is
	 * `absolute bottom-full` like the list it stands in for — which is why the
	 * sentence can be said at all in a band whose whole design is about not moving.
	 *
	 * `<output>` IS THE STATUS REGION, not a `div` with `role="status"` on it: the
	 * element IS the role, and it is the one the composer's other notice already
	 * uses (`message-input.tsx`'s credential sentence), so the two read as one
	 * mechanism rather than two spellings of one thing.
	 */
	if (state.unavailable !== null) {
		return (
			<output
				ref={shellRef}
				className={cn(
					"@container/at absolute bottom-full left-0 right-0 z-20 mb-1",
					"overflow-hidden rounded-md border border-control bg-elevated",
					"shadow-lg",
				)}
			>
				<span
					data-mention-notice
					className="block px-3 py-2 text-body-sm text-ink-muted"
				>
					{state.unavailable}
				</span>
			</output>
		);
	}

	if (!state.open) return null;

	/*
	 * The footer's right column: the rows the REGION draws against the entries the
	 * listing holds, so the pair answers "am I looking at everything?" rather
	 * than "how many rows did the query admit". Assembled here rather than in the
	 * hook because the first number is `budget`, this component's own measurement
	 * (design round 1, D3).
	 */
	const count = atCount(Math.min(state.rows.length, budget), state.entries);

	return (
		/* biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order. */
		<div
			id={state.listId}
			ref={shellRef}
			// biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order.
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
			role="listbox"
			aria-label="Files"
			className={cn(
				"@container/at absolute bottom-full left-0 right-0 z-20 mb-1",
				// `overflow-hidden`, not `overflow-y-auto`: the SCROLL belongs to the row
				// region below, so the header and footer stay put and the region's height
				// can be a whole multiple of the row pitch.
				"overflow-hidden rounded-md border border-control bg-elevated",
				"shadow-lg",
			)}
		>
			{/*
			 * The strip names the DIRECTORY BEING LISTED rather than the list, which
			 * is the one job the slash popup's phase label leaves free: a `@` token has
			 * a single list, so nothing needs naming, and drilling is disorienting
			 * without a statement of where you are. `font-mono` because a path is
			 * machine voice, and the full path is the `title` because the strip
			 * truncates.
			 */}
			<div
				className="truncate border-b border-hairline px-3 py-1 font-mono text-meta text-ink-dim"
				title={state.headerTitle}
			>
				{state.header}
			</div>
			{/*
			 * The row region owns the scroller, and its max-height is a whole number of
			 * ROW_PITCH rows: a list that rests on a half-row slice reads as a clipped
			 * glyph rather than as "there is more", which the 2px thumb already says.
			 *
			 * AND IT NEVER SCROLLS SIDEWAYS (QA round 2, Q-5). A horizontal bar is not
			 * free here: it takes **8px** off the region's own CLIENT box, so the cap
			 * above — the whole-row arithmetic this region exists to honour — painted
			 * four rows and 28px of a fifth while the footer counted five (measured at
			 * 800x600 against the row below, which was 789px wide inside a 242px
			 * region). The row is bounded at its source; this is the belt, because the
			 * cap and the count must never disagree again whatever a future row holds.
			 */}
			<div
				className="overflow-y-auto overflow-x-hidden"
				style={{ maxHeight: `${budget * AT_ROW_PITCH}px` }}
			>
				{state.rows.length === 0 ? (
					/*
					 * THE PICKER STAYS OPEN with a one-row notice, and it is the notice's
					 * row that is the fix rather than a nicety: the harness's own picker
					 * closes here, and its composer was measured moving +17px across the
					 * keystroke that stopped matching (PR #1220). A notice row holds the
					 * picker up and distinguishes the four empty facts from each other,
					 * which a closed list cannot do at all.
					 *
					 * `data-mention-notice` is the hook the stories assert this row by: the
					 * notice is the one thing a frame can be about in the empty states, and a
					 * selector that went through the listbox's role could not reach the
					 * harness-cannot-expand sentence, which has no listbox by design.
					 */
					<div
						data-mention-notice
						className="px-3 py-2 text-body-sm text-ink-muted"
					>
						{state.notice}
					</div>
				) : (
					<ul>
						{state.rows.map((row, index) => (
							/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant. */
							/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the textarea, not on the option. */
							<li
								key={row.path}
								id={`${state.listId}-${atRowId(row)}`}
								ref={index === state.active ? activeRef : null}
								// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant.
								// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox option cannot be a native <option> here.
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
								role="option"
								aria-selected={index === state.active}
								className={cn(
									"relative flex cursor-default items-baseline gap-3 px-3 py-2",
									index === state.active
										? cn(
												"bg-accent-wash",
												// The row Enter will apply was carried by hue alone in the
												// slash popup — the wash measures 1.000:1 against its own
												// ground in `dune` — so the 2px accent bar on the leading
												// edge is the second, non-luminance signal, and it costs
												// no layout.
												"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
											)
										: "bg-transparent",
								)}
								onMouseDown={(event) => {
									// Focus, not the pick: preventing the default keeps the
									// textarea's caret and draft position, which a focus change to
									// the row would drop before the handler could read them.
									event.preventDefault();
								}}
								onClick={() => onPick(row)}
								onMouseEnter={() => state.setActiveHover(index)}
							>
								{/*
								 * THE NAME YIELDS, and the design's `shrink-0` is the reason this
								 * comment is longer than the class it explains. A name wider than the
								 * region made the whole ROW wider than the region, which summoned a
								 * horizontal scrollbar and cost the cap above a row's worth of its
								 * whole-row arithmetic (QA round 2, Q-5: a 200-character name
								 * measured `scrollWidth` 789 against a 242px `clientWidth`).
								 *
								 * The shape is the design's own PRIORITY ORDER rather than its literal
								 * `shrink-0`: the name is the thing being scanned, so it is the last
								 * column to give — the parent column beside it is `flex-1 min-w-0`
								 * `truncate` and already yields, and with `nowrap` and a zero minimum
								 * width this one keeps every pixel until the row cannot fit at all and
								 * only then ellipsises. A row that fits is byte-identical to the
								 * frames taken before it, which is every committed frame at every
								 * width: only a name too long for the region changes.
								 */}
								<span className="min-w-0 shrink truncate font-mono text-body-sm text-ink">
									{row.name}
								</span>
								{/*
								 * The parent column, relative to the listing — `./` for the entry in
								 * the directory being listed, `src/components/` for one reached by
								 * descending. `ink-muted` rather than `ink-dim`: this is a NEW long
								 * string and `ink-dim` on `elevated` clears its floor by 0.01
								 * (`dracula`), which is a margin no new string has any business
								 * starting from.
								 *
								 * SUPPRESSED WHERE IT EQUALS THE HEADER, and suppressed rather than
								 * removed, so the three-column row geometry is identical in every
								 * state (design round 1, D6): a plain listing printed `./` on all
								 * seven rows under a header that already said `./`, and
								 * `caret-inside-token` printed `src/components/` three times on one
								 * screen. The column EARNS its place in the descend state, where it
								 * is what separates `src/` rows from `src/components/` rows, which
								 * is why the fix is a suppression and not a deletion.
								 */}
								<span className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink-muted">
									{row.parent === state.header ? null : row.parent}
								</span>
								{/*
								 * The type tag. `Directory` rather than the terminal's `Dir`: this
								 * app's own composer already says "Working directory", and the tag
								 * answers the one question a path cannot.
								 */}
								<span className="shrink-0 text-meta text-ink-dim">
									{row.directory ? "Directory" : "File"}
								</span>
							</li>
						))}
					</ul>
				)}
			</div>
			{/*
			 * One bordered strip, the Enter line read off the active row and the count
			 * on the right. The count is the one fact a scrolled list cannot show, and
			 * it is absent when there is nothing to add.
			 */}
			<div className="flex items-baseline justify-between gap-3 border-t border-hairline px-3 py-1 text-meta text-ink-dim">
				<p>{state.footer}</p>
				{count ? <p>{count}</p> : null}
			</div>
		</div>
	);
};
