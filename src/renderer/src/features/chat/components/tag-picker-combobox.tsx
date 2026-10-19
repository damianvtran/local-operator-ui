import {
	TAG_SELECTION_LIMIT,
	matchingTags,
	pickerActiveIndex,
} from "@features/chat/chat-tag-picker";
import { Button, Input } from "@shared/components/ui";
import { t } from "@shared/i18n";
import { Check, X } from "lucide-react";
import { type RefObject, useEffect, useId, useRef, useState } from "react";
import type { TagCategory } from "../../../../../shared/desktop-contract";

/** A multi-select extension, not a claim of single-select APG conformance.
 * Input editing keys remain native. The list has ONE roving Tab destination;
 * aria-activedescendant is exposed only while DOM focus remains in the input.
 * Create is deliberately outside the list: unmatched Enter can never mutate.
 */
export function TagPickerCombobox({
	categories,
	selected,
	primary,
	query,
	setQuery,
	listOpen,
	setListOpen,
	disabled,
	unready,
	input,
	toggle,
	create,
	createIssue,
}: {
	categories: TagCategory[];
	selected: string[];
	primary: string | null;
	query: string;
	setQuery: (query: string) => void;
	listOpen: boolean;
	setListOpen: (open: boolean) => void;
	disabled: boolean;
	unready: boolean;
	input: RefObject<HTMLInputElement>;
	toggle: (id: string) => void;
	create: () => void;
	createIssue: string | null;
}) {
	const listId = useId();
	const [active, setActive] = useState(-1);
	const [inputFocused, setInputFocused] = useState(false);
	const list = useRef<HTMLDivElement>(null);
	const matches = unready ? [] : matchingTags(categories, query);
	const safeActive = matches.length ? Math.min(active, matches.length - 1) : -1;
	const optionId = (index: number) => `${listId}-${index}`;
	useEffect(() => {
		setActive(query.trim() ? 0 : -1);
	}, [query]);
	useEffect(() => {
		if (listOpen && safeActive >= 0)
			list.current?.children[safeActive]?.scrollIntoView?.({
				block: "nearest",
			});
	}, [safeActive, listOpen]);
	const choose = (id: string) => {
		if (
			disabled ||
			unready ||
			(!selected.includes(id) && selected.length >= TAG_SELECTION_LIMIT)
		)
			return;
		toggle(id);
		setQuery("");
		setActive(-1);
		setListOpen(true);
		input.current?.focus({ preventScroll: true });
	};
	const move = (delta: number, focus: boolean) => {
		const next = pickerActiveIndex(safeActive, delta, matches.length);
		setActive(next);
		setListOpen(true);
		if (focus && next >= 0)
			(list.current?.children[next] as HTMLElement)?.focus();
	};
	return (
		<>
			<div className="sticky top-0 z-10 bg-elevated pb-2">
				<Input
					ref={input}
					role="combobox"
					aria-label={t("ui.chat.tags.search")}
					aria-autocomplete="list"
					aria-expanded={listOpen}
					aria-controls={listId}
					aria-activedescendant={
						inputFocused && listOpen && safeActive >= 0
							? optionId(safeActive)
							: undefined
					}
					placeholder={t("ui.chat.tags.search")}
					value={query}
					disabled={disabled}
					onFocus={() => {
						setInputFocused(true);
						setListOpen(true);
					}}
					onBlur={() => setInputFocused(false)}
					onChange={(event) => {
						setQuery(event.target.value);
						setListOpen(true);
					}}
					onKeyDown={(event) => {
						if (event.nativeEvent.isComposing) return;
						if (event.key === "ArrowDown" || event.key === "ArrowUp") {
							event.preventDefault();
							move(event.key === "ArrowDown" ? 1 : -1, false);
						} else if (event.key === "Enter") {
							event.preventDefault();
							if (listOpen && safeActive >= 0) choose(matches[safeActive].id);
						} else if (event.key === "Backspace" && !query && selected.length) {
							event.preventDefault();
							choose(selected[selected.length - 1]);
						}
					}}
				/>
			</div>
			<div
				className="flex min-w-0 flex-wrap gap-1"
				aria-label={t("ui.chat.tags.label")}
			>
				{selected.map((id) => {
					const tag = categories.find((tag) => tag.id === id);
					return (
						<span
							key={id}
							title={tag?.name}
							className="inline-flex max-w-full min-w-0 items-center gap-1 rounded-md border border-control bg-surface px-2 py-1 text-body-sm"
						>
							{primary === id && (
								<span aria-label={t("ui.chat.tags.primary")}>•</span>
							)}
							<bdi className="min-w-0 truncate">{tag?.name}</bdi>
							<Button
								variant="ghost"
								size="icon-sm"
								className="shrink-0"
								disabled={disabled}
								aria-label={t("ui.chat.tags.remove_named", {
									name: tag?.name ?? id,
								})}
								onClick={() => choose(id)}
								onKeyDown={(event) => {
									if (
										event.key === "Delete" &&
										!event.nativeEvent.isComposing
									) {
										event.preventDefault();
										choose(id);
									}
								}}
							>
								<X aria-hidden="true" />
							</Button>
						</span>
					);
				})}
			</div>
			<p className="text-meta text-ink-muted">
				{t("ui.chat.tags.selection_count", { count: String(selected.length) })}
			</p>
			{selected.length >= TAG_SELECTION_LIMIT && (
				<p className="text-meta text-ink-muted">
					{t("ui.chat.tags.selection_limit")}
				</p>
			)}
			<div
				ref={list}
				tabIndex={-1}
				id={listId}
				// biome-ignore lint/a11y/useSemanticElements: Adopted APG extension uses chips, active-descendant and inline Create; native select cannot implement it.
				role="listbox"
				aria-label={t("ui.chat.tags.label")}
				aria-multiselectable="true"
				hidden={!listOpen}
				className="rounded-md bg-surface p-1"
			>
				{matches.map((tag, index) => {
					const chosen = selected.includes(tag.id);
					const blocked =
						disabled || (!chosen && selected.length >= TAG_SELECTION_LIMIT);
					return (
						<div
							id={optionId(index)}
							key={tag.id}
							// biome-ignore lint/a11y/useSemanticElements: Adopted APG extension needs individually focused roving options; native option cannot provide that focus.
							role="option"
							aria-selected={chosen}
							aria-disabled={blocked}
							tabIndex={
								(safeActive >= 0 ? safeActive : 0) === index && !disabled
									? 0
									: -1
							}
							className={`flex min-h-9 cursor-default items-center gap-2 rounded-md px-2 py-2 text-body-sm outline-offset-2 focus-visible:outline-2 focus-visible:outline-accent ${chosen ? "bg-row-selected text-ink" : "text-ink hover:bg-row-hover"}`}
							onFocus={() => {
								setActive(index);
								setInputFocused(false);
							}}
							onClick={() => choose(tag.id)}
							onKeyDown={(event) => {
								if (event.nativeEvent.isComposing) return;
								if (
									["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)
								) {
									event.preventDefault();
									if (event.key === "Home" || event.key === "End") {
										const next = event.key === "Home" ? 0 : matches.length - 1;
										setActive(next);
										(list.current?.children[next] as HTMLElement)?.focus();
									} else move(event.key === "ArrowDown" ? 1 : -1, true);
								} else if (event.key === " " || event.key === "Enter") {
									event.preventDefault();
									choose(tag.id);
								}
							}}
						>
							<span className="flex size-4 shrink-0 items-center">
								{chosen && <Check aria-hidden="true" className="size-4" />}
							</span>
							<bdi className="min-w-0 break-words">{tag.name}</bdi>
						</div>
					);
				})}
			</div>
			{!unready && listOpen && !matches.length && (
				<p className="text-body-sm text-ink-muted">
					{query.trim()
						? t("ui.chat.tags.no_matches", { query })
						: t("ui.chat.tags.empty")}
				</p>
			)}
			{!unready &&
				query.trim() &&
				(createIssue ? (
					<p className="text-meta text-ink-muted">{createIssue}</p>
				) : (
					<Button
						variant="ghost"
						className="h-auto min-h-9 w-full flex-col items-start whitespace-normal text-left"
						disabled={disabled || unready}
						onClick={create}
					>
						<span className="break-words">
							{t("ui.chat.tags.create_name", { name: query.trim() })}
						</span>
						<span className="text-meta text-ink-muted">
							{t("ui.chat.tags.create_helper")}
						</span>
					</Button>
				))}
		</>
	);
}
