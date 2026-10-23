import {
	TAG_REGISTRY_LIMIT,
	TAG_SELECTION_LIMIT,
	matchingTags,
	pickerActiveIndex,
} from "@features/chat/chat-tag-picker";
import { Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { Check, Plus } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { TagCategory } from "../../../../../shared/desktop-contract";

/**
 * The body of the row's Tags popover (sidebar tags v3, D1): a filter input over
 * a checkable list, with `Create “x”` as the list's last option.
 *
 * WHY ACTIVE-DESCENDANT ONLY, AND NO ROVING OPTION FOCUS. The popover is a
 * transient surface that Tab dismisses (the header-identity popover's rule), so
 * the input is the one focus home and every option is reached by ↑/↓/Home/End
 * through `aria-activedescendant`. A pointer press on an option keeps focus in
 * the input (`onMouseDown` default prevented) so the next keystroke still
 * filters.
 *
 * ENTER IS ONLY EVER THE ACTIVE OPTION. Typing resets the active option to the
 * first one, which is a tag when anything matches and `Create` when nothing
 * does. So Enter on a new word creates and assigns in one press (the v3 fix for
 * "a new tag needs a mouse"), while a query with any partial match can only
 * toggle that match: an ambiguous Enter still cannot write the shared registry,
 * and Create is one ↓/End away.
 *
 * `⇧Enter` on a tag option adds it if absent and makes it the group the chat is
 * shown under: the keyboard twin of a drag-and-drop, and the single-pointer
 * alternative WCAG 2.5.7 asks for beside the drag (with the `Show under` text on
 * a checked option).
 */
export function TagPickerCombobox({
	categories,
	selected,
	primary,
	query,
	setQuery,
	disabled,
	unready,
	input,
	toggle,
	showUnder,
	create,
	createIssue,
}: {
	categories: TagCategory[];
	selected: string[];
	primary: string | null;
	query: string;
	setQuery: (query: string) => void;
	disabled: boolean;
	unready: boolean;
	input: RefObject<HTMLInputElement>;
	toggle: (id: string) => void;
	/** Add if absent, then make primary. */
	showUnder: (id: string) => void;
	create: () => void;
	/** Why Create is refused for this query, or null when it is offered. */
	createIssue: string | null;
}) {
	const listId = useId();
	const [active, setActive] = useState(-1);
	const list = useRef<HTMLDivElement>(null);
	const trimmed = query.trim();
	const matches = unready ? [] : matchingTags(categories, query);
	// An exact (case-insensitive) match is shown as the ordinary option, so a
	// duplicate is selected rather than created; `createIssue` names it otherwise.
	const exact = matches.some(
		(tag) => tag.name.trim().toLowerCase() === trimmed.toLowerCase(),
	);
	const registryFull = categories.length >= TAG_REGISTRY_LIMIT;
	const offersCreate = !unready && trimmed !== "" && !exact && !registryFull;
	const count = matches.length + (offersCreate ? 1 : 0);
	const safeActive = count ? Math.min(active, count - 1) : -1;
	const optionId = (index: number) => `${listId}-${index}`;
	const atLimit = selected.length >= TAG_SELECTION_LIMIT;
	const showPrimaryHint = selected.length >= 2;
	useEffect(() => {
		setActive(query.trim() ? 0 : -1);
	}, [query]);
	useEffect(() => {
		if (safeActive >= 0)
			list.current?.children[safeActive]?.scrollIntoView?.({
				block: "nearest",
			});
	}, [safeActive]);

	const blocked = (id: string) =>
		disabled || unready || (!selected.includes(id) && atLimit);
	const choose = (id: string) => {
		if (blocked(id)) return;
		toggle(id);
		setQuery("");
		setActive(-1);
		input.current?.focus({ preventScroll: true });
	};
	const promote = (id: string) => {
		if (blocked(id)) return;
		showUnder(id);
		setQuery("");
		setActive(-1);
		input.current?.focus({ preventScroll: true });
	};
	const pressCreate = () => {
		if (disabled || unready || createIssue) return;
		create();
	};
	const activate = (index: number, shift: boolean) => {
		if (index < matches.length) {
			const id = matches[index].id;
			if (shift) promote(id);
			else choose(id);
		} else if (offersCreate) pressCreate();
	};
	return (
		<>
			<Input
				ref={input}
				role="combobox"
				aria-label={t("ui.chat.tags.search")}
				aria-autocomplete="list"
				aria-expanded={!unready}
				aria-controls={listId}
				aria-activedescendant={
					safeActive >= 0 ? optionId(safeActive) : undefined
				}
				placeholder={t("ui.chat.tags.search")}
				value={query}
				// Disabled-but-focused would drop the caret; the write guard is in
				// `choose`/`pressCreate`, so a typed filter is never lost mid-save.
				readOnly={disabled || unready}
				className="h-8"
				onChange={(event) => setQuery(event.target.value)}
				onKeyDown={(event) => {
					if (
						event.nativeEvent.isComposing ||
						event.nativeEvent.keyCode === 229
					)
						return;
					if (event.key === "ArrowDown" || event.key === "ArrowUp") {
						event.preventDefault();
						setActive(
							pickerActiveIndex(
								safeActive,
								event.key === "ArrowDown" ? 1 : -1,
								count,
							),
						);
					} else if (event.key === "Home" || event.key === "End") {
						// The list's keys, not the caret's (spec §6): End is how Create is
						// reached past partial matches, and a tag name is short enough that
						// the caret is one ←/→ away.
						event.preventDefault();
						setActive(count ? (event.key === "Home" ? 0 : count - 1) : -1);
					} else if (event.key === "Enter") {
						event.preventDefault();
						if (safeActive >= 0) activate(safeActive, event.shiftKey);
					}
				}}
			/>
			{!unready && trimmed && !matches.length && (
				<p className="px-2 py-1 text-meta text-ink-dim">
					{t("ui.chat.tags.no_matches", { query: trimmed })}
				</p>
			)}
			<div
				ref={list}
				id={listId}
				// biome-ignore lint/a11y/useSemanticElements: an APG multi-select listbox with active-descendant and an inline Create option; native select cannot implement it.
				role="listbox"
				// Not a Tab stop: the input is the focus home and drives this list.
				tabIndex={-1}
				aria-label={t("ui.chat.tags.label")}
				aria-multiselectable="true"
				hidden={unready || count === 0}
				className="mt-1 min-h-0 max-h-56 overflow-y-auto"
			>
				{matches.map((tag, index) => {
					const chosen = selected.includes(tag.id);
					const pointed = safeActive === index;
					const refused = blocked(tag.id);
					const promotable =
						showPrimaryHint && chosen && tag.id !== primary && !disabled;
					return (
						// biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard path is the combobox input's Enter/⇧Enter on the active-descendant option.
						<div
							id={optionId(index)}
							key={tag.id}
							// biome-ignore lint/a11y/useSemanticElements: see the listbox above; options are reached by active-descendant.
							role="option"
							aria-selected={chosen}
							aria-disabled={refused}
							tabIndex={-1}
							title={tag.name}
							className={cn(
								"group/option flex h-8 cursor-default items-center gap-2 rounded-sm px-2 text-body-sm",
								// At the 8 cap the reason must stay readable: ink-muted, not
								// ink-disabled (1.99:1, spec §8).
								refused ? "text-ink-muted" : "text-ink",
								!refused && "hover:bg-row-hover",
								pointed && "bg-accent-wash",
							)}
							onMouseDown={(event) => event.preventDefault()}
							onMouseEnter={() => setActive(index)}
							onClick={() => choose(tag.id)}
						>
							<span className="flex size-4 shrink-0 items-center">
								{chosen && <Check aria-hidden="true" className="size-4" />}
							</span>
							<bdi className="min-w-0 flex-1 truncate">{tag.name}</bdi>
							{promotable && (
								// A pointer affordance for an act whose keyboard twin is ⇧Enter on
								// this option; it is not a second focus stop inside an option.
								// biome-ignore lint/a11y/useKeyWithClickEvents: keyboard path is ⇧Enter on the option (see the header comment).
								<span
									data-tag-show-under
									className={cn(
										"shrink-0 rounded-sm px-1 text-meta text-ink-dim hover:text-ink",
										pointed ? "inline" : "hidden group-hover/option:inline",
									)}
									onClick={(event) => {
										event.stopPropagation();
										promote(tag.id);
									}}
								>
									{t("ui.chat.tags.show_under")}
								</span>
							)}
						</div>
					);
				})}
				{offersCreate && (
					// biome-ignore lint/a11y/useKeyWithClickEvents: Enter in the combobox input activates Create when it is the active option.
					<div
						id={optionId(matches.length)}
						// biome-ignore lint/a11y/useSemanticElements: see the listbox above.
						role="option"
						aria-selected={false}
						aria-disabled={disabled || createIssue !== null}
						tabIndex={-1}
						data-tag-create
						className={cn(
							"flex min-h-8 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-body-sm",
							createIssue ? "text-ink-muted" : "text-ink hover:bg-row-hover",
							safeActive === matches.length && "bg-accent-wash",
						)}
						onMouseDown={(event) => event.preventDefault()}
						onMouseEnter={() => setActive(matches.length)}
						onClick={pressCreate}
					>
						<Plus aria-hidden="true" className="size-4 shrink-0" />
						<span className="flex min-w-0 flex-col">
							<bdi className="truncate">
								{t("ui.chat.tags.create_name", { name: trimmed })}
							</bdi>
							<span className="text-meta text-ink-dim">
								{createIssue ?? t("ui.chat.tags.create_helper")}
							</span>
						</span>
					</div>
				)}
			</div>
			{!unready && trimmed && !exact && registryFull && (
				<p className="px-2 py-1 text-meta text-ink-muted">
					{t("ui.chat.tags.registry_limit")}
				</p>
			)}
			{!unready && !trimmed && count === 0 && (
				<p className="px-2 py-2 text-body-sm text-ink-muted">
					{trimmed
						? t("ui.chat.tags.no_matches", { query: trimmed })
						: t("ui.chat.tags.empty")}
				</p>
			)}
		</>
	);
}
