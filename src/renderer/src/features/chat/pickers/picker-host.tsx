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
import { cn } from "@shared/lib/utils";
import { Check, Search } from "lucide-react";
import {
	type FC,
	type FormEvent,
	type KeyboardEvent,
	type ReactNode,
	useCallback,
	useEffect,
	useId,
	useMemo,
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
	/** Widen for data views (usage, analytics). */
	wide?: boolean;
	/** Rendered above the list, below the search (a scope toggle, a filter). */
	toolbar?: ReactNode;
	/** Rendered instead of the list when set (data views). */
	body?: ReactNode;
};

const TONE_CLASS: Record<PickerResult["tone"], string> = {
	info: "border-hairline bg-sunken text-ink-muted",
	success: "border-success-border bg-success-wash text-ink",
	warning: "border-warning-border bg-warning-wash text-ink",
	error: "border-danger-border bg-danger-wash text-ink",
};

export const PickerHost: FC<PickerHostProps> = ({
	open,
	onClose,
	title,
	description,
	options,
	loading = false,
	loadError = null,
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
	wide = false,
	toolbar,
	body,
}) => {
	const listId = useId();
	const [query, setQuery] = useState("");
	const [active, setActive] = useState(0);
	const inputRef = useRef<HTMLInputElement>(null);
	const listRef = useRef<HTMLDivElement>(null);

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

	// Reset per open so a re-opened picker never carries a stale filter.
	useEffect(() => {
		if (!open) return;
		setQuery("");
		setActive(0);
	}, [open]);
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
	useEffect(() => {
		const row = listRef.current?.querySelector<HTMLElement>(
			`[id="${listId}-${active}"]`,
		);
		row?.scrollIntoView?.({ block: "nearest" });
	}, [active, listId]);

	const pick = useCallback(
		async (option: PickerOption | undefined) => {
			if (!option || option.disabled || busy) return;
			await onPick?.(option.value, option);
		},
		[onPick, busy],
	);

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
	// Flat index across groups, so arrow keys walk the visible order.
	let flatIndex = -1;

	return (
		<Dialog open={open} onOpenChange={(next) => !next && onClose()}>
			<DialogContent
				className={cn(
					"gap-0 p-0",
					wide ? "max-w-3xl" : "max-w-xl",
					// The dialog is a frame: 14px radius, content clipped to it.
					"overflow-hidden rounded-lg",
				)}
				onOpenAutoFocus={(event) => {
					event.preventDefault();
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
						{loading ? (
							<div className="flex h-24 items-center justify-center">
								<Spinner size="md" label="Loading" />
							</div>
						) : loadError ? (
							<p className="px-2 py-3 text-body-sm text-danger">{loadError}</p>
						) : filtered.length === 0 ? (
							<p className="px-2 py-3 text-body-sm text-ink-dim">{emptyText}</p>
						) : (
							/* biome-ignore lint/a11y/useFocusableInteractive: the search input keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order. */
							<div
								ref={listRef}
								id={listId}
								// biome-ignore lint/a11y/useFocusableInteractive: the search input keeps focus; the listbox is reached through aria-activedescendant.
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
								role="listbox"
								aria-label={title}
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
											const isActive = index === active;
											return (
												/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search input; the active option is announced through aria-activedescendant. */
												<div
													key={option.value}
													id={`${listId}-${index}`}
													// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the search input; the active option is announced through aria-activedescendant.
													// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
													role="option"
													aria-selected={isActive}
													aria-disabled={option.disabled || undefined}
													data-current={option.current || undefined}
													onMouseMove={() => setActive(index)}
													onMouseDown={(event) => {
														// mousedown, not click: keeps focus in the search
														// input, the same reason the composer popup does it.
														event.preventDefault();
														void pick(option);
													}}
													className={cn(
														"flex cursor-default items-start gap-3 rounded-sm px-2 py-1.5",
														isActive && "bg-elevated",
														option.disabled && "text-ink-disabled",
													)}
												>
													<span className="flex min-w-0 flex-1 flex-col">
														<span className="flex items-center gap-2">
															<span
																className={cn(
																	"truncate text-body-sm",
																	option.disabled
																		? "text-ink-disabled"
																		: "text-ink",
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
													{option.meta && (
														<span className="shrink-0 font-mono text-ink-dim text-mono-sm">
															{option.meta}
														</span>
													)}
												</div>
											);
										})}
									</div>
								))}
							</div>
						)}
					</div>
				)}

				{body && (
					<div className="max-h-[min(60vh,520px)] overflow-y-auto px-5 pt-3">
						{body}
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
					<span className="text-ink-dim text-meta">
						{busy ? (
							<span className="flex items-center gap-2">
								<Spinner size="sm" />
								Working
							</span>
						) : hasList ? (
							"Arrows move, Enter picks, Esc closes"
						) : (
							"Esc closes"
						)}
					</span>
					<div className="flex items-center gap-2">
						{actions}
						<Button variant="ghost" size="sm" type="button" onClick={onClose}>
							{result && result.tone !== "error" ? "Done" : "Cancel"}
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
