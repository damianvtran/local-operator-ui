/**
 * @file settings-search.tsx
 * @description
 * The Settings page's own search: a field in the page header, and a panel under
 * it listing the settings that match — each saying WHY it matched and which
 * section it lands in.
 *
 * ## Two questions, one box
 *
 * The Backend section has its own FILTER, which narrows that list in place. This
 * search does something different: it JUMPS. Typing here never changes what any
 * section renders — it offers destinations, and Enter takes you to one. That is
 * why the two mechanisms are not merged: a filter that also reorders the page
 * would be a third thing, and a search that only filtered one section could not
 * find the profile fields or the theme picker at all.
 *
 * ## Typing must not re-render the settings tree
 *
 * The index is built ONCE by the page (`useSettingsSearchIndex`, memoised on the
 * payload's identity and the locale) and handed in as a prop. Every keystroke
 * changes state in THIS component only, so the eleven sections below never
 * re-render for a query — which is the difference between a search box that
 * feels instant on a 1746-line page and one that does not. The rendered rows
 * are read from the DOM on the first keystroke and cached for the life of the
 * mount: they cannot change while the reader is typing, and re-reading them per
 * keystroke would be work with no possible answer.
 *
 * ## The panel is a listbox, even when it holds a sentence
 *
 * The combobox pattern (`aria-expanded`, `aria-controls`, `aria-activedescendant`)
 * needs one popup, and the empty and no-result states are states of that same
 * popup. They render as non-option content inside it — the shape every combobox
 * with an empty state ships — while the option ids exist only for real results,
 * so a stale `aria-activedescendant` can never point at a sentence.
 */

import { Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import type { MessageKey } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { Search } from "lucide-react";
import {
	forwardRef,
	useCallback,
	useId,
	useImperativeHandle,
	useMemo,
	useRef,
	useState,
} from "react";
import type { BackendSettings } from "../../../../../shared/desktop-contract";
import { rendererPlatform } from "../../../mini-view/renderer-platform";
import type {
	SettingSearchEntry,
	SettingSearchField,
} from "../search/settings-search-index";
import { buildSettingsIndex } from "../search/settings-search-index";
import type { SearchJumpOutcome } from "../search/settings-search-jump";
import {
	SETTINGS_SEARCH_CAP,
	groupSettingResults,
	isBlankQuery,
	searchSettings,
} from "../search/settings-search-match";

/** Why a row is in the list, as the catalogue key that says it. */
const REASON_KEY = {
	label: "ui.settings.search.reason.label",
	synonym: "ui.settings.search.reason.synonym",
	key: "ui.settings.search.reason.key",
	choice: "ui.settings.search.reason.choice",
	section: "ui.settings.search.reason.section",
	description: "ui.settings.search.reason.description",
} as const satisfies Record<SettingSearchField, MessageKey>;

/**
 * The page's index, built once per payload identity and locale.
 *
 * `build` is a seam for `scripts/settings-search.test.mjs`: it counts the
 * builder across ten keystrokes, which is the only way to prove the memo holds
 * (`useMemo` with an unstable dependency object would rebuild silently).
 */
export function useSettingsSearchIndex(parts: {
	registry: Pick<BackendSettings, "sections" | "settings"> | undefined;
	sections: readonly { id: string; label: string }[];
	build?: typeof buildSettingsIndex;
}): SettingSearchEntry[] {
	const { registry, sections, build = buildSettingsIndex } = parts;
	// The locale is a dependency even though the payload is the backend's copy:
	// the sidebar's section labels are TRANSLATED, and a locale switch must not
	// leave the panel offering last language's section names.
	const locale = useI18nLocale();
	/*
	 * `registry` is the query payload object: react-query replaces it only when
	 * the answer changes, so this is an identity check rather than a deep one.
	 */
	/* biome-ignore lint/correctness/useExhaustiveDependencies: `locale` is a deliberate rebuild trigger — the builder resolves translated section labels through `t()`, and the parameter list cannot name the language, so the dependency list is the only place it can appear. */
	const built = useMemo(
		() => build({ registry, sections }),
		[build, registry, sections, locale],
	);
	return built;
}

/** What the page needs to drive the field from a document-level shortcut. */
export type SettingsSearchHandle = {
	focus: () => void;
};

type SettingsSearchProps = {
	/** The page's merged index (registry + sections). */
	index: readonly SettingSearchEntry[];
	/**
	 * The page's rendered rows, read from the DOM. Called ONCE on the first
	 * keystroke and cached; a page whose rows cannot be read simply indexes what
	 * the registry serves.
	 */
	readRendered?: () => SettingSearchEntry[];
	/**
	 * Take the reader to an entry. Owned by the page, which knows each path.
	 *
	 * It may answer `"missing"` — the panel's own row exists but the page could
	 * not put the reader on it (a section with no rendered root, a registry key
	 * the payload no longer serves). The panel then SPEAKS it rather than
	 * closing as if something happened; a jump that lands on nothing is a
	 * sentence, not a silent no-op (review round 1, B1/m5).
	 */
	onJump: (
		entry: SettingSearchEntry,
	) => SearchJumpOutcome | undefined | Promise<SearchJumpOutcome | undefined>;
	className?: string;
};

/** The modifier glyph the shortcut line names, per platform. */
function shortcutLabel(): string {
	return rendererPlatform() === "mac" ? "⌘F" : "Ctrl+F";
}

export const SettingsSearch = forwardRef<
	SettingsSearchHandle,
	SettingsSearchProps
>(function SettingsSearch({ index, readRendered, onJump, className }, ref) {
	useI18nLocale();
	const inputRef = useRef<HTMLInputElement | null>(null);
	const renderedRef = useRef<SettingSearchEntry[] | null>(null);
	const [query, setQuery] = useState("");
	const [open, setOpen] = useState(false);
	const [activeIndex, setActiveIndex] = useState(0);
	/*
	 * A jump that could not land leaves a sentence behind. Held here rather than
	 * in the page because this component owns the live region that speaks it.
	 */
	const [notice, setNotice] = useState("");
	const listId = useId();

	useImperativeHandle(ref, () => ({
		focus: () => {
			inputRef.current?.focus();
			setOpen(true);
		},
	}));

	/*
	 * The rendered half is read in the EVENT that first needs it (focus or the
	 * first keystroke), never during render: a render-phase ref write runs twice
	 * under StrictMode and is the kind of "it works" that stops working when
	 * React changes. The read is cached for the mount because the page's rows
	 * cannot change while the reader is typing a query at them.
	 */
	const primeRendered = useCallback(() => {
		if (renderedRef.current === null) {
			renderedRef.current = readRendered?.() ?? [];
		}
	}, [readRendered]);

	const entries = useCallback((): readonly SettingSearchEntry[] => {
		const rendered = renderedRef.current;
		return rendered && rendered.length > 0 ? [...index, ...rendered] : index;
	}, [index]);

	const blank = isBlankQuery(query);
	const { results, total } = useMemo(
		() => searchSettings(entries(), query),
		// `entries` is memoised on the index's identity, which is the page's
		// memo: this recomputes for a query, never for a section's render.
		[entries, query],
	);
	const groups = useMemo(() => groupSettingResults(results), [results]);
	/*
	 * The position every read uses — ARIA, the visual mark and Enter. The list
	 * can shrink under a live query (a locale switch or a `settings.list`
	 * refetch rebuilds the index), and the mark compared the RAW index while
	 * `aria-activedescendant` compared a clamped one, so the two could name
	 * different rows (review round 1, m3).
	 */
	const activePosition =
		results.length === 0 ? 0 : Math.min(activeIndex, results.length - 1);
	const active = results[activePosition];
	const positions = useMemo(
		() => new Map(results.map((result, index) => [result.entry.id, index])),
		[results],
	);

	const close = useCallback((nextQuery?: string) => {
		if (nextQuery !== undefined) setQuery(nextQuery);
		setOpen(false);
		setActiveIndex(0);
	}, []);

	const jump = useCallback(
		async (entry: SettingSearchEntry) => {
			const outcome = await onJump(entry);
			if (outcome === "missing") {
				setNotice(t("ui.settings.search.jump.missing"));
				// The panel stays open: the reader is still choosing, and the field
				// still holds focus, so the next arrow or Escape works as before.
				return;
			}
			setNotice("");
			setOpen(false);
			setActiveIndex(0);
		},
		[onJump],
	);

	const optionId = (position: number) => `${listId}-option-${position}`;

	const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
		switch (event.key) {
			case "ArrowDown":
				event.preventDefault();
				setOpen(true);
				setActiveIndex((current) =>
					results.length === 0 ? 0 : (current + 1) % results.length,
				);
				return;
			case "ArrowUp":
				event.preventDefault();
				setOpen(true);
				setActiveIndex((current) =>
					results.length === 0
						? 0
						: (current - 1 + results.length) % results.length,
				);
				return;
			case "Home":
				if (!open) return;
				event.preventDefault();
				setActiveIndex(0);
				return;
			case "End":
				if (!open) return;
				event.preventDefault();
				setActiveIndex(Math.max(0, results.length - 1));
				return;
			case "Enter":
				event.preventDefault();
				if (!open) {
					setOpen(true);
					return;
				}
				if (active) jump(active.entry);
				return;
			case "Escape":
				event.preventDefault();
				if (query !== "") {
					// Clear first, close second: Escape on a query is "undo that",
					// and the reader stays in the field to type the next one.
					close("");
					return;
				}
				close();
				return;
			default:
				return;
		}
	};

	/*
	 * The live region's text is DERIVED, not stored: the same result count
	 * produces the same string, so the node's text changes only when the answer
	 * does and a polite region speaks once per change instead of on every
	 * render. Storing it in state would need an effect and would announce a
	 * second time for the identical sentence.
	 */
	const announcement = blank
		? ""
		: t("ui.settings.search.results.count", { count: total });

	return (
		<div className={cn("relative w-full @2xl:w-80", className)}>
			<div className="relative">
				<Search
					size={14}
					aria-hidden="true"
					className="pointer-events-none absolute top-1/2 left-2.5 -translate-y-1/2 text-ink-dim"
				/>
				<Input
					ref={inputRef}
					role="combobox"
					aria-expanded={open}
					aria-controls={open ? listId : undefined}
					aria-activedescendant={
						open && active ? optionId(activePosition) : undefined
					}
					aria-autocomplete="list"
					aria-label={t("ui.settings.search.field.label")}
					placeholder={t("ui.settings.search.field.placeholder")}
					value={query}
					type="text"
					className="pl-8"
					onFocus={() => {
						primeRendered();
						setOpen(true);
					}}
					/*
					 * BLUR CLOSES, and only blur. A pointerdown on an option runs before
					 * the blur, so the click path is preserved by the option's own
					 * `onMouseDown` prevention below rather than by keeping the panel open
					 * through a focus change.
					 */
					onBlur={() => setOpen(false)}
					onChange={(event) => {
						primeRendered();
						setQuery(event.currentTarget.value);
						setActiveIndex(0);
						setNotice("");
						setOpen(true);
					}}
					onKeyDown={onKeyDown}
				/>
			</div>
			{open && (
				/* biome-ignore lint/a11y/useFocusableInteractive: the list is never DOM-focused — the field keeps focus and points at the active option through `aria-activedescendant`, which is the ARIA combobox contract. */
				<div
					id={listId}
					/* biome-ignore lint/a11y/useSemanticElements: this is the combobox's own popup; a native `<select>` cannot express `aria-activedescendant`, and the list holds headed groups plus a capped "+N more" line. */
					role="listbox"
					aria-label={t("ui.settings.search.panel.label")}
					/* Leaves the flow, so it is the one thing allowed a shadow. */
					className="absolute top-full right-0 z-40 mt-2 flex max-h-[min(24rem,60vh)] w-full min-w-80 flex-col overflow-y-auto rounded-md border border-hairline bg-elevated p-1 shadow-overlay"
				>
					{blank ? (
						<div className="flex flex-col gap-1 px-2 py-2">
							<p className="text-body-sm text-ink">
								{t("ui.settings.search.empty.summary")}
							</p>
							<p className="text-meta text-ink-dim">
								{t("ui.settings.search.empty.shortcut", {
									shortcut: shortcutLabel(),
								})}
							</p>
						</div>
					) : results.length === 0 ? (
						<div className="flex flex-col gap-2 px-2 py-2">
							<p className="text-body-sm text-ink">
								{t("ui.settings.search.no_results.title", { query })}
							</p>
							<p className="text-meta text-ink-dim">
								{t("ui.settings.search.no_results.hint")}
							</p>
							<button
								type="button"
								className="min-h-6 w-fit rounded-sm px-1.5 py-1 text-body-sm text-accent underline-offset-2 hover:underline focus-visible:outline-2"
								onMouseDown={(event) => event.preventDefault()}
								onClick={() => {
									close("");
									inputRef.current?.focus();
								}}
							>
								{t("ui.settings.search.no_results.clear")}
							</button>
						</div>
					) : (
						<>
							{groups.map((group) => (
								<div
									key={group.sectionId || "no-section"}
									/*
									 * `role="group"` rather than `presentation`: a listbox may
									 * contain groups, and a group is the standard way to hang a
									 * heading on a run of options (`aria-label` names it). A
									 * `presentation` wrapper stripped the heading out and left
									 * bare text nodes as listbox children (review round 1, m2).
									 */
									role={group.sectionLabel ? "group" : undefined}
									aria-label={group.sectionLabel || undefined}
								>
									{group.sectionLabel && (
										<p className="px-2 pt-2 pb-1 font-medium text-ink-muted text-meta">
											{group.sectionLabel}
										</p>
									)}
									{group.results.map((result) => {
										const position = positions.get(result.entry.id) ?? 0;
										const isActive = position === activePosition;
										return (
											/* biome-ignore lint/a11y/useFocusableInteractive lint/a11y/useKeyWithClickEvents: options are never DOM-focused (the field keeps focus and names this id), and every key path is the FIELD's handler — so an option's `onClick` is pointer-only and has no keyboard twin to add. */
											<div
												key={result.entry.id}
												id={optionId(position)}
												/* biome-ignore lint/a11y/useSemanticElements: `<option>` cannot hold a two-line row (label + section + reason). */
												role="option"
												aria-selected={isActive}
												data-search-result-id={result.entry.id}
												/*
												 * The active row wears the mark this app already ships
												 * for a list's cursor (`searchable-select.tsx`): an
												 * accent wash plus an INSET control ring. Inset because
												 * the panel scrolls — an outset ring would be clipped on
												 * the first and last row. `bg-action-hover` was a token
												 * that does not exist in any palette, so the row Enter
												 * would take was invisible in both themes (design D1).
												 */
												className={cn(
													"flex cursor-pointer flex-col gap-0.5 rounded-sm px-2 py-1.5",
													isActive
														? "bg-accent-wash outline-solid outline-1 -outline-offset-1 outline-control"
														: "hover:bg-row-hover",
												)}
												onMouseDown={(event) => event.preventDefault()}
												onMouseEnter={() => setActiveIndex(position)}
												onClick={() => jump(result.entry)}
											>
												<span className="text-body-sm text-ink">
													{result.entry.label}
												</span>
												<span className="text-meta text-ink-dim">
													{result.entry.sectionLabel &&
														t("ui.settings.search.row.section_hint", {
															section: result.entry.sectionLabel,
														})}
													{result.entry.sectionLabel && " · "}
													{t(REASON_KEY[result.reason])}
													{/*
													 * The registry's own sub-section, SECONDARY to the
													 * destination above: it is where the row is filed
													 * inside Backend settings, not where the jump lands
													 * (review round 1, M2). Omitted when it would repeat
													 * the destination.
													 */}
													{result.entry.detail &&
														result.entry.detail !==
															result.entry.sectionLabel && (
															<> · {result.entry.detail}</>
														)}
												</span>
											</div>
										);
									})}
								</div>
							))}
							{total > results.length && (
								<p
									data-search-more=""
									className="px-2 pt-1 pb-2 text-meta text-ink-dim"
								>
									{t("ui.settings.search.results.more", {
										count: total - results.length,
									})}
								</p>
							)}
						</>
					)}
				</div>
			)}
			{/*
			 * `<output>` is the semantic live region for a computed result, and its
			 * `aria-live` default is already polite; naming it explicitly keeps the
			 * announcement even in browsers that treat `<output>` as a plain inline.
			 */}
			<output aria-live="polite" className="sr-only">
				{notice || announcement}
			</output>
		</div>
	);
});

/** The panel's row budget, exported so the page's copy can stay silent about it. */
export { SETTINGS_SEARCH_CAP };
