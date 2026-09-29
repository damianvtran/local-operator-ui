import { KeyboardShortcut } from "@shared/components/common/keyboard-shortcut";
import { Button } from "@shared/components/ui";
import { cn } from "@shared/lib/utils";
import { Search, X } from "lucide-react";
import {
	type FC,
	type KeyboardEvent as ReactKeyboardEvent,
	type RefObject,
	useCallback,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { ThreadFindHit } from "../../../../../shared/desktop-contract";
import { THREAD_FIND_MAX_CHARS } from "../../../../../shared/desktop-contract";
import { chatRegionOf } from "../chat-regions";
import { pressLandsOnOverlay } from "../keyboard-scopes";
import {
	THREAD_SEARCH_BUILDING_COPY,
	THREAD_SEARCH_BUILDING_HINT,
	THREAD_SEARCH_CLOSE_LABEL,
	THREAD_SEARCH_EMPTY_COPY,
	THREAD_SEARCH_ERROR_COPY,
	THREAD_SEARCH_LIST_LABEL,
	THREAD_SEARCH_PARTIAL_COPY,
	THREAD_SEARCH_PLACEHOLDER,
	THREAD_SEARCH_RECHECK_LABEL,
	THREAD_SEARCH_RETRY_LABEL,
	THREAD_SEARCH_ROLE_LABELS,
	THREAD_SEARCH_TIER_HINT,
	THREAD_SEARCH_UNSUPPORTED_COPY,
	type ThreadSearchState,
	isThreadSearchPress,
	splitThreadSearchRanges,
	threadSearchCap,
	threadSearchCountLabel,
	threadSearchTruncatedLabel,
} from "./thread-search-model";
import {
	clearThreadSearchLanding,
	revealThreadSearchHit,
} from "./thread-search-reveal";
import { useThreadSearch } from "./use-thread-search";

/**
 * The in-thread search overlay: `⌘F` / `Ctrl+F` over a conversation.
 *
 * ## What this is
 *
 * A floating panel above the transcript's top-right corner. The box asks the
 * backend's `sessions.find` (through `use-thread-search`) for the messages of
 * THIS conversation that match, ranked best first; the list renders a snippet
 * per hit with the query's own occurrences marked; Enter or a click lands the
 * reader on the message in the transcript (`thread-search-reveal.ts`).
 *
 * ## Who owns the chord
 *
 * The panel is the chat surface's find gesture, and the app bound nothing to
 * `⌘F` before this: no `findInPage` call site exists and the main process's
 * input ladder covers zoom, `⌘P` and `⌘⇧S` only. The one EXISTING `⌘F` in the
 * chat slice is the aside panel's adopt chord, which the composer handles
 * itself and marks with `preventDefault` — so this listener runs after it and
 * skips a press somebody else already claimed (`defaultPrevented`), and the
 * aside keeps its chord exactly when it is live. When the aside is open but
 * its adopt chord is not ready the composer deliberately lets the press fall
 * through ("the chord does nothing rather than being consumed"), and what it
 * falls through to is now this panel — strictly more useful than nothing, and
 * the composer's own semantics are unchanged.
 *
 * Two scoping rules decide the rest, both reused rather than re-invented:
 * a foreign overlay's press stays that overlay's (`pressLandsOnOverlay`), and
 * the chat surface must be the one in focus (`chatRegionOf` — all four regions
 * answer it: the conversation is what a reader means by "this" from any of
 * them). A press INSIDE this panel re-answers the chord by selecting the box's
 * text, the way a browser's find bar does.
 *
 * ## Focus
 *
 * Opening focuses the box and closing returns focus to wherever it was, so the
 * chord never strands the keyboard. The list is announced through
 * `aria-activedescendant` on the input, so DOM focus stays in the box
 * throughout — the contract the composer's popups already keep — which is what
 * keeps Escape and the arrow keys owned by one element.
 */

export type ThreadSearchPanelProps = {
	query: string;
	onQueryChange: (next: string) => void;
	state: ThreadSearchState;
	hits: ThreadFindHit[];
	cursor: number;
	truncated: boolean;
	partial: boolean;
	/** Move the keyboard cursor; wrapping is the model's rule. */
	onMoveCursor: (delta: -1 | 1) => void;
	/** Land on a hit (Enter, or a click). */
	onNavigate: (hit: ThreadFindHit) => void;
	/** Re-ask now: Enter while there is nothing to open, or a control. */
	onRetry: () => void;
	onClose: () => void;
	isMac: boolean;
};

/**
 * The panel's own bar: the active row carries a fill AND a 2px accent bar.
 *
 * The bar is not decoration. `accent-wash` alone collapses onto the panel's
 * `elevated` ground in several themes (obsidian ΔE00 0.77 — the D12 family of
 * defects), and this row is the one Enter opens, in a transient panel where
 * the keyboard has no other mark. The string is the slash popup's and the
 * at-picker's, so the three chat popups cannot drift apart.
 */
const ACTIVE_ROW_CLASS = cn(
	"bg-accent-wash",
	"before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent",
);

/**
 * The matched runs inside a snippet.
 *
 * `bg-accent-wash text-ink` is the app's find-match idiom (the WYSIWYG
 * editor's own `FIND_MATCH_CLASS`), and the ink role is what keeps it legal on
 * all eight grounds the contrast contract measures. THE WASH IS NOT THE WHOLE
 * MARK, and the frames are why: on the panel's `elevated` ground it measures
 * ΔE00 0.77 in obsidian — the collapse the active-row pin documents — so a
 * mark built from the fill alone is invisible in the one theme a reader can
 * choose, which is exactly the defect family this app keeps re-finding. The
 * second, non-luminance signal is an ACCENT UNDERLINE: `accent` is asserted
 * at the 3:1 structural floor on every ground, it cannot collapse into a
 * tint, and it reads differently from a link (links are accent INK with an
 * underline; here the ink stays `ink`). `font-medium` is the third half for
 * the states where the wash merges with a row's own fill — the hovered and
 * active rows are the same wash — and all three halves are pinned by
 * `contrast-contract.mjs` so an edit cannot quietly drop one.
 */
const MATCH_MARK_CLASS =
	"bg-accent-wash font-medium text-ink underline decoration-accent decoration-2 underline-offset-2";

const threadSearchIsMac = (): boolean =>
	navigator.platform.toUpperCase().indexOf("MAC") >= 0;

/** One result row. */
const ResultRow: FC<{
	hit: ThreadFindHit;
	active: boolean;
	optionId: string;
	onNavigate: (hit: ThreadFindHit) => void;
}> = ({ hit, active, optionId, onNavigate }) => {
	const segments = splitThreadSearchRanges(hit.snippet, hit.ranges);
	return (
		/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search box; the active option is announced through aria-activedescendant. */
		/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the input, not on the option; the click below is the pointer's own gesture. */
		<li
			id={optionId}
			// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search box; the active option is announced through aria-activedescendant.
			// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a listbox option cannot be a native <option> here.
			// biome-ignore lint/a11y/useSemanticElements: a find result cannot be a native <option>.
			role="option"
			aria-selected={active}
			/*
			 * Pointer focus must not leave the box: the caret and the layer's
			 * Escape handling both live there, and a focus change on mousedown is
			 * how a popup loses the key contract it documents.
			 */
			onMouseDown={(event) => event.preventDefault()}
			onClick={() => onNavigate(hit)}
			className={cn(
				"relative flex cursor-pointer flex-col gap-0.5 px-3 py-2",
				active ? ACTIVE_ROW_CLASS : "hover:bg-accent-wash",
			)}
		>
			<span className="flex items-center gap-1.5 text-ink-muted text-meta">
				<span>{THREAD_SEARCH_ROLE_LABELS[hit.role]}</span>
				{hit.tier === "soft" && (
					<>
						<span aria-hidden="true">&middot;</span>
						<span className="text-ink-dim">{THREAD_SEARCH_TIER_HINT}</span>
					</>
				)}
			</span>
			<span className="line-clamp-2 text-body-sm text-ink">
				{segments.map((segment, segmentIndex) =>
					segment.matched ? (
						// biome-ignore lint/suspicious/noArrayIndexKey: the segment's position in its own snippet is its identity; segments are derived per render and never reordered in place.
						<mark key={segmentIndex} className={MATCH_MARK_CLASS}>
							{segment.text}
						</mark>
					) : (
						// biome-ignore lint/suspicious/noArrayIndexKey: see above.
						<span key={segmentIndex}>{segment.text}</span>
					),
				)}
			</span>
		</li>
	);
};

export const ThreadSearchPanel: FC<ThreadSearchPanelProps> = ({
	query,
	onQueryChange,
	state,
	hits,
	cursor,
	truncated,
	partial,
	onMoveCursor,
	onNavigate,
	onRetry,
	onClose,
	isMac,
}) => {
	const baseId = useId();
	const listId = `${baseId}-list`;
	const optionId = useCallback(
		(index: number) => `${baseId}-opt-${index}`,
		[baseId],
	);
	const inputRef = useRef<HTMLInputElement | null>(null);
	const activeHit = cursor >= 0 && cursor < hits.length ? hits[cursor] : null;
	const showList = hits.length > 0;
	const retryable = state === "error" || state === "building";

	/*
	 * The pane's own row geometry: the box holds focus for the panel's whole
	 * life, so the panel does the focusing when it mounts rather than leaving it
	 * to whoever opened it.
	 */
	useEffect(() => {
		inputRef.current?.focus();
		inputRef.current?.select();
	}, []);

	/*
	 * Keep the cursor's row inside the list's own scroller. `nearest` so a row
	 * already visible moves nothing, and the row's own element rather than an
	 * index so a list that changed under the cursor cannot scroll to a
	 * neighbour.
	 */
	useEffect(() => {
		if (cursor < 0) return;
		document.getElementById(optionId(cursor))?.scrollIntoView({
			block: "nearest",
		});
	}, [cursor, optionId]);

	const onInputKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
		if (event.key === "ArrowDown") {
			event.preventDefault();
			onMoveCursor(1);
			return;
		}
		if (event.key === "ArrowUp") {
			event.preventDefault();
			onMoveCursor(-1);
			return;
		}
		if (event.key === "Enter") {
			event.preventDefault();
			if (activeHit !== null) onNavigate(activeHit);
			else if (retryable) onRetry();
			return;
		}
	};

	return (
		<div
			data-lo-thread-search=""
			role="presentation"
			onKeyDown={(event) => {
				if (event.defaultPrevented) return;
				if (event.key === "Escape") {
					event.preventDefault();
					onClose();
				}
			}}
			className="pointer-events-auto w-[26rem] max-w-full rounded-md border border-hairline bg-elevated text-body-sm text-ink shadow-overlay"
		>
			<div className="p-2">
				<div
					className={cn(
						"flex items-center gap-2 rounded-sm border border-control bg-surface px-2",
						"transition-colors duration-fast ease-out-quart",
						// The group draws the ring for its own field, the shape the
						// agent-hub search field established: the input's outline is
						// suppressed so the field's edge — not the bare text run — is what
						// shows focus.
						"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
						"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
					)}
				>
					<Search
						aria-hidden="true"
						className="size-3.5 shrink-0 text-ink-dim"
					/>
					<input
						ref={inputRef}
						type="text"
						value={query}
						onChange={(event) => onQueryChange(event.target.value)}
						onKeyDown={onInputKeyDown}
						maxLength={THREAD_FIND_MAX_CHARS}
						placeholder={THREAD_SEARCH_PLACEHOLDER}
						aria-label={THREAD_SEARCH_PLACEHOLDER}
						role="combobox"
						aria-expanded={showList}
						aria-controls={showList ? listId : undefined}
						aria-activedescendant={
							activeHit !== null ? optionId(cursor) : undefined
						}
						aria-autocomplete="list"
						autoComplete="off"
						spellCheck={false}
						className="h-8 min-w-0 flex-1 border-0 bg-transparent text-body-sm text-ink outline-none placeholder:text-ink-dim"
					/>
					<Button
						type="button"
						variant="ghost"
						size="icon-sm"
						aria-label={THREAD_SEARCH_CLOSE_LABEL}
						onClick={onClose}
					>
						<X aria-hidden="true" />
					</Button>
				</div>
			</div>

			<div className="flex items-start gap-2 px-3 pb-2">
				<p className="min-w-0 flex-1 text-ink-muted text-meta">
					{state === "loading" &&
						(showList ? threadSearchCountLabel(hits.length) : "Searching…")}
					{state === "ready" &&
						(hits.length > 0
							? threadSearchCountLabel(hits.length)
							: THREAD_SEARCH_EMPTY_COPY)}
					{state === "building" &&
						(partial
							? THREAD_SEARCH_PARTIAL_COPY
							: THREAD_SEARCH_BUILDING_COPY)}
					{state === "unsupported" && THREAD_SEARCH_UNSUPPORTED_COPY}
					{state === "error" && THREAD_SEARCH_ERROR_COPY}
					{state === "ready" && truncated && showList && (
						<span className="text-ink-dim">
							{" "}
							{threadSearchTruncatedLabel(hits.length)}
						</span>
					)}
					{state === "building" && !partial && (
						<span className="text-ink-dim"> {THREAD_SEARCH_BUILDING_HINT}</span>
					)}
				</p>
				{retryable && (
					<Button
						type="button"
						variant="ghost"
						size="sm"
						onClick={onRetry}
						className="shrink-0"
					>
						{state === "building"
							? THREAD_SEARCH_RECHECK_LABEL
							: THREAD_SEARCH_RETRY_LABEL}
					</Button>
				)}
			</div>

			{showList && (
				// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search box; the active option is announced through aria-activedescendant, so the list is not in the tab order.
				<ul
					id={listId}
					// biome-ignore lint/a11y/useFocusableInteractive: see above.
					// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a find-results list is a listbox rather than a native control.
					// biome-ignore lint/a11y/useSemanticElements: a find-results list is a listbox, not a native select.
					role="listbox"
					aria-label={THREAD_SEARCH_LIST_LABEL}
					className="max-h-80 overflow-y-auto border-t border-hairline py-1"
				>
					{hits.map((hit, index) => (
						<ResultRow
							key={hit.id}
							hit={hit}
							active={index === cursor}
							optionId={optionId(index)}
							onNavigate={onNavigate}
						/>
					))}
				</ul>
			)}

			<div className="flex items-center gap-3 border-t border-hairline px-3 py-1.5">
				<span className="flex items-center gap-1 text-ink-dim text-meta">
					<KeyboardShortcut shortcut="↑" />
					<KeyboardShortcut shortcut="↓" />
					<span>browse</span>
				</span>
				<span className="flex items-center gap-1 text-ink-dim text-meta">
					<KeyboardShortcut shortcut="↵" />
					<span>jump</span>
				</span>
				<span className="flex items-center gap-1 text-ink-dim text-meta">
					<KeyboardShortcut shortcut="esc" />
					<span>close</span>
				</span>
				<span className="ml-auto text-ink-dim text-meta">
					{threadSearchCap(isMac)}
				</span>
			</div>
		</div>
	);
};

export type ThreadSearchOverlayProps = {
	/** The conversation this panel searches; the transcript only mounts it with one. */
	sessionId: string;
	/**
	 * The transcript's scroll container — the root the reveal works inside.
	 * Handed in rather than looked up, so a run panel's child reader (a second
	 * transcript on the same screen) can never be the one a hit navigates.
	 */
	containerRef: RefObject<HTMLDivElement | null>;
};

export const ThreadSearchOverlay: FC<ThreadSearchOverlayProps> = ({
	sessionId,
	containerRef,
}) => {
	const [open, setOpen] = useState(false);
	const panelRef = useRef<HTMLDivElement | null>(null);
	const restoreFocus = useRef<HTMLElement | null>(null);
	const search = useThreadSearch({ sessionId, enabled: open });

	const openPanel = useCallback(() => {
		const active = document.activeElement;
		restoreFocus.current = active instanceof HTMLElement ? active : null;
		setOpen(true);
	}, []);

	const closePanel = useCallback(() => {
		setOpen(false);
		clearThreadSearchLanding();
		const previous = restoreFocus.current;
		restoreFocus.current = null;
		if (previous?.isConnected) previous.focus();
	}, []);

	/*
	 * The chord. Installed on `document` rather than on a subtree for the reason
	 * the shell's own chords are: the press has to be answered from a row, the
	 * scroller and the composer alike, and a listener on one subtree cannot hear
	 * all three. The three gates — somebody else claimed it, it landed on a
	 * foreign overlay, the chat surface is not in focus — are in the order that
	 * makes each the cheapest.
	 */
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (event.defaultPrevented) return;
			if (!isThreadSearchPress(event)) return;
			const target = event.target as Node | null;
			const insidePanel = Boolean(
				panelRef.current !== null &&
					target !== null &&
					panelRef.current.contains(target),
			);
			if (!insidePanel) {
				if (pressLandsOnOverlay(event.target)) return;
				if (chatRegionOf(event.target) === null) return;
			}
			event.preventDefault();
			if (open) {
				// Re-pressing the chord re-answers it, the way a browser's find bar
				// does: the box's text is selected rather than the panel toggling.
				const input = panelRef.current?.querySelector("input");
				input?.focus();
				input?.select();
				return;
			}
			openPanel();
		};
		document.addEventListener("keydown", onKeyDown);
		return () => document.removeEventListener("keydown", onKeyDown);
	}, [open, openPanel]);

	// A mark belongs to the panel that made it.
	useEffect(() => () => clearThreadSearchLanding(), []);

	const navigate = useCallback(
		(hit: ThreadFindHit) => {
			void revealThreadSearchHit(containerRef.current, hit.id);
		},
		[containerRef],
	);

	if (!open) return null;
	return (
		/*
		 * The wrapper is the positioned slot inside the transcript's own column;
		 * the panel inside it floats over the scroller's top-right corner the way
		 * a browser's find bar sits over its page. `pointer-events-none` on the
		 * wrapper so the slot itself never eats a press outside the panel.
		 */
		<div
			ref={panelRef}
			className="pointer-events-none absolute top-3 right-3 z-20 max-w-[calc(100%-1.5rem)]"
		>
			<ThreadSearchPanel
				query={search.query}
				onQueryChange={search.setQuery}
				state={search.state}
				hits={search.hits}
				cursor={search.cursor}
				truncated={search.truncated}
				partial={search.partial}
				onMoveCursor={search.moveCursor}
				onNavigate={navigate}
				onRetry={search.refresh}
				onClose={closePanel}
				isMac={threadSearchIsMac()}
			/>
		</div>
	);
};
