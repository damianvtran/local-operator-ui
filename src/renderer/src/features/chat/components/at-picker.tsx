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
import { type AtToken, atToken, splitToken } from "./at-token";

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

export type AtCompletionState = {
	/** Whether this surface exists at all: no listing bridge, no picker. */
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
	count: string | undefined;
	notice: string;
	loading: boolean;
	/** True once the user has arrowed onto a row in THIS list. */
	close(): void;
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
}: UseAtPickerArgs): AtCompletionState {
	const listId = useId();
	const available = bridge() !== null;

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

	const token = useMemo(() => atToken(text, caret), [text, caret]);
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
					setListing(answer);
					setLoading(false);
				})
				.catch((error: unknown) => {
					if (cancelled) return;
					// A transport failure is reported in the listing's own sentence
					// rather than swallowed: "could not read this folder" with no reason
					// is the unfinished error the contract refuses (§ 8).
					setListing({
						dir: dirPart,
						entries: [],
						truncated: false,
						error: error instanceof Error ? error.message : String(error),
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
	const [state, setState] = useState({ open: false, active: 0 });
	const lastTokenKey = useRef<string | null>(null);

	useEffect(() => {
		if (tokenKey !== dismissed.current) dismissed.current = null;
		const changed = lastTokenKey.current !== tokenKey;
		lastTokenKey.current = tokenKey;
		setState((current) => {
			if (tokenKey === null || dismissed.current === tokenKey) {
				return current.open ? { ...current, open: false } : current;
			}
			return {
				open: true,
				// A new token moves the marker back to the top; typing inside one token
				// CLAMPS it, so the marker does not jump off the row being read.
				active: changed
					? 0
					: Math.min(current.active, Math.max(rows.length - 1, 0)),
			};
		});
	}, [tokenKey, rows.length]);

	const close = useCallback(() => {
		dismissed.current = tokenKey;
		setState((current) => ({ ...current, open: false }));
	}, [tokenKey]);

	const setActive = useCallback((index: number) => {
		setState((current) => ({ ...current, active: index }));
	}, []);

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
		count: atCount(rows.length, entries),
		notice: atEmptyCopy({
			error: listing?.error ?? null,
			// Rows on screen mean the wait is not the state the user is looking at:
			// the previous listing stays up while the next one is in flight.
			loading: loading && rows.length === 0,
			entries,
			matched: rows.length,
			query: nameQuery,
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
	const shellRef = useRef<HTMLDivElement | null>(null);
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

	if (!state.open) return null;

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
			 */}
			<div
				className="overflow-y-auto"
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
					 */
					<div className="px-3 py-2 text-body-sm text-ink-muted">
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
								<span className="shrink-0 font-mono text-body-sm text-ink">
									{row.name}
								</span>
								{/*
								 * The parent column, relative to the listing — `./` for the entry in
								 * the directory being listed, `src/components/` for one reached by
								 * descending. `ink-muted` rather than `ink-dim`: this is a NEW long
								 * string and `ink-dim` on `elevated` clears its floor by 0.01
								 * (`dracula`), which is a margin no new string has any business
								 * starting from.
								 */}
								<span className="min-w-0 flex-1 truncate font-mono text-body-sm text-ink-muted">
									{row.parent}
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
				{state.count ? <p>{state.count}</p> : null}
			</div>
		</div>
	);
};
