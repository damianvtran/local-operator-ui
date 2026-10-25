import { TAG_REGISTRY_LIMIT } from "@features/chat/chat-tag-picker";
import {
	type RegistryEditResult,
	registryNameIssue,
	useChatTagRegistry,
} from "@features/chat/use-chat-tag-registry";
import {
	Button,
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
	Input,
	Popover,
	PopoverAnchor,
	PopoverContent,
} from "@shared/components/ui";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { useSessionTagsStore } from "@shared/store/session-tags-store";
import {
	ArrowDown,
	ArrowUp,
	ChevronRight,
	MoreHorizontal,
	Pencil,
	Plus,
	Trash2,
} from "lucide-react";
import {
	type KeyboardEvent as ReactKeyboardEvent,
	useEffect,
	useId,
	useRef,
	useState,
} from "react";
import type { TagCategory } from "../../../../../shared/desktop-contract";

/**
 * The attribute a group header's `⋯` control carries. It is a stop in the
 * sidebar's arrow ring BESIDE `[data-chat-row]` rather than reusing that
 * attribute: the ring's type-to-filter branch and the row-act chords test for
 * `data-chat-row`, and a header answering them would open the filter or try to
 * pin a tag (spec D2's flagged risk).
 */
export const TAG_HEADER_STOP_ATTR = "data-chat-tag-header";

/** The keyboard chords a focused header answers (spec D2/D8). */
export function tagHeaderChord(event: {
	key: string;
	altKey: boolean;
	shiftKey: boolean;
	metaKey: boolean;
	ctrlKey: boolean;
}): "rename" | "up" | "down" | "menu" | null {
	if (event.metaKey || event.ctrlKey) return null;
	if (event.key === "F2" && !event.altKey && !event.shiftKey) return "rename";
	if (event.altKey && !event.shiftKey && event.key === "ArrowUp") return "up";
	if (event.altKey && !event.shiftKey && event.key === "ArrowDown")
		return "down";
	if (event.key === "ContextMenu" || (event.shiftKey && event.key === "F10"))
		return "menu";
	return null;
}

/** Commit-on-Enter field shared by inline rename and `+ New tag`. IME-safe. */
function TagNameField({
	initial,
	label,
	placeholder,
	error,
	errorId,
	busy,
	keepOpen,
	renameId,
	onCommit,
	onCancel,
}: {
	initial: string;
	label: string;
	placeholder?: string;
	error: string | null;
	errorId: string;
	busy: boolean;
	/** `+ New tag` stays open and empty after a create; rename closes. */
	keepOpen?: boolean;
	/** Exclude this registry ID when validating rename-on-blur duplicates. */
	renameId?: string;
	onCommit: (value: string, restoreFocus?: boolean) => Promise<boolean>;
	onCancel: (restoreFocus?: boolean) => void;
}) {
	const [value, setValue] = useState(initial);
	const field = useRef<HTMLInputElement>(null);
	const settled = useRef(false);
	useEffect(() => {
		field.current?.focus();
		field.current?.select();
	}, []);
	const commit = async () => {
		if (busy) return;
		const ok = await onCommit(value);
		if (ok && keepOpen) {
			setValue("");
			field.current?.focus();
		}
	};
	return (
		<Input
			ref={field}
			inputSize="sm"
			aria-label={label}
			placeholder={placeholder}
			aria-invalid={error !== null}
			aria-describedby={error ? errorId : undefined}
			aria-busy={busy}
			readOnly={busy}
			value={value}
			className={cn("min-w-0 flex-1", busy && "text-ink-dim")}
			onChange={(event) => setValue(event.target.value)}
			onKeyDown={(event) => {
				// The sidebar's own keyDown must not see typing in this field (it
				// would read printable keys as type-to-filter on the list).
				event.stopPropagation();
				if (event.nativeEvent.isComposing || event.keyCode === 229) return;
				if (event.key === "Enter") {
					event.preventDefault();
					void commit();
				} else if (event.key === "Escape") {
					event.preventDefault();
					settled.current = true;
					onCancel(true);
				}
			}}
			onBlur={() => {
				if (settled.current || busy) return;
				// New-tag creation is Enter-only (D3): blur closes without writing.
				if (keepOpen) {
					onCancel(false);
					return;
				}
				// Blur commits a valid change and otherwise reverts (spec D2): an
				// empty or unchanged field is simply closed.
				if (!value.trim() || value.trim() === initial.trim()) onCancel();
				else if (registryNameIssue(value, renameId)) onCancel();
				else
					void onCommit(value, false).then((ok) => {
						// Blur is a SAVE, not cancellation. A transport refusal must
						// retain the typed draft and the alert/retry set by the owner,
						// just like Enter failure, and return focus for correction.
						if (!ok) field.current?.focus({ preventScroll: true });
					});
			}}
		/>
	);
}

/** The one-line refusal under a header or footer field. */
function FieldAlert({
	id,
	message,
	onRetry,
}: {
	id: string;
	message: string;
	onRetry?: () => void;
}) {
	return (
		<div
			id={id}
			role="alert"
			className="flex min-h-6 items-center gap-2 px-2 text-meta text-danger"
		>
			<span className="min-w-0 flex-1">{message}</span>
			{onRetry && (
				<Button
					variant="ghost"
					className="h-6 px-1 text-meta"
					onClick={onRetry}
				>
					{t("ui.chat.tags.retry")}
				</Button>
			)}
		</div>
	);
}

/**
 * A tag group subheader, now also the tag's management surface (spec D2, the
 * Slack sidebar-section model): `⋯` / right-click / Shift+F10 open a menu with
 * Rename, Move up/down and Delete; double-click or F2 renames in place; Alt+↑/↓
 * moves. The header stays 28px and remains the whole-header drop target the
 * drag reads (`data-tag-drop-target`).
 *
 * `above`/`below` are the neighbouring headers VISIBLE in this section, never
 * registry neighbours: a move repositions past what the user can see
 * (`moveTagPast`). Untagged has no management at all.
 */
export function ChatTagHeader({
	id,
	name,
	count,
	above,
	below,
	announce,
	unused = false,
}: {
	id: string;
	name: string;
	count: number;
	above: string | null;
	below: string | null;
	announce: (sentence: string) => void;
	/** A footer row for a tag with no conversations: delete needs no confirm. */
	unused?: boolean;
}) {
	useI18nLocale();
	const registry = useChatTagRegistry();
	const [renaming, setRenaming] = useState(false);
	const [menuOpen, setMenuOpen] = useState(false);
	const [confirming, setConfirming] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [retry, setRetry] = useState<(() => void) | null>(null);
	const errorId = useId();
	const stop = useRef<HTMLButtonElement>(null);
	const cancelDelete = useRef<HTMLButtonElement>(null);
	const box = useRef<HTMLDivElement>(null);
	const managed = id !== "untagged";
	const label = id === "untagged" ? t("ui.chat.tags.untagged") : name;
	const focusFrame = useRef<number | null>(null);
	useEffect(
		() => () => {
			if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		},
		[],
	);
	const focusStop = () => {
		if (focusFrame.current !== null) cancelAnimationFrame(focusFrame.current);
		focusFrame.current = requestAnimationFrame(() => {
			// Prefer THIS section's control: one tag may have several headers.
			// After deletion it no longer exists, so hand focus to a real survivor
			// (or the footer's New tag row), never a detached node or the body.
			const target = stop.current?.isConnected
				? stop.current
				: document.querySelector<HTMLElement>(
						`[${TAG_HEADER_STOP_ATTR}="${CSS.escape(below ?? above ?? id)}"], [data-tag-new]`,
					);
			focusFrame.current = null;
			target?.focus({ preventScroll: true });
		});
	};
	const settle = (
		result: RegistryEditResult,
		sentence: string,
		again: () => void,
	) => {
		if (result.ok) {
			setError(null);
			setRetry(null);
			announce(sentence);
			return true;
		}
		setError(result.error);
		// Only a refused WRITE is retryable; a validation refusal is fixed by typing.
		// The hook reports that as a stable flag, never as catalogue copy.
		setRetry(() => (result.retryable ? again : null));
		return false;
	};
	const move = async (direction: "up" | "down") => {
		const neighbour = direction === "up" ? above : below;
		if (!neighbour || registry.pending) {
			announce(
				t(
					direction === "up"
						? "ui.chat.tags.header_first"
						: "ui.chat.tags.header_last",
					{ name: label },
				),
			);
			return;
		}
		const result = await registry.move(id, neighbour, direction);
		if (
			settle(
				result,
				t("ui.chat.tags.moved_tag", { name: label }),
				() => void move(direction),
			)
		)
			focusStop();
	};
	const remove = async () => {
		const result = await registry.remove(id);
		setConfirming(false);
		if (
			settle(
				result,
				t("ui.chat.tag_dialogs.deleted_name", { name: label }),
				() => void remove(),
			)
		)
			focusStop();
	};
	const beginDelete = () => {
		// The store's count, not this render's: a tag that gained a conversation
		// elsewhere must ask before its assignments are removed.
		const current = useSessionTagsStore
			.getState()
			.categories.find((tag) => tag.id === id);
		if (!current) {
			setError(t("ui.chat.tags.registry_changed"));
			return;
		}
		if (current.conversations === 0) void remove();
		else setConfirming(true);
	};
	const rename = async (
		value: string,
		restoreFocus = true,
	): Promise<boolean> => {
		const result = await registry.rename(id, value);
		const ok = settle(
			result,
			t("ui.chat.tags.renamed_name", { name: value.trim() }),
			() => void rename(value),
		);
		if (ok) {
			setRenaming(false);
			if (restoreFocus) focusStop();
		}
		return ok;
	};
	const onKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
		if (!managed) return;
		const chord = tagHeaderChord(event);
		if (chord === null) {
			// Radix's menu trigger normally uses ArrowDown to OPEN its menu. Here
			// bare arrows belong to the sidebar's row/header ring: suppress that
			// primitive default, but keep bubbling so the sidebar takes the step.
			if (["ArrowUp", "ArrowDown", "Home", "End"].includes(event.key))
				event.preventDefault();
			return;
		}
		event.preventDefault();
		event.stopPropagation();
		if (chord === "rename") setRenaming(true);
		else if (chord === "menu") setMenuOpen(true);
		else void move(chord);
	};
	const conversations =
		useSessionTagsStore(
			(state) => state.categories.find((tag) => tag.id === id)?.conversations,
		) ?? count;
	return (
		<div ref={box} aria-busy={registry.pending}>
			<div
				data-tag-drop-target={id}
				{...(unused ? { "data-tag-unused-slot": "" } : {})}
				className="group/header relative flex h-7 items-center gap-2 px-2 text-meta text-ink-dim hover:bg-row-hover"
				onContextMenu={(event) => {
					if (!managed) return;
					event.preventDefault();
					setMenuOpen(true);
				}}
			>
				{renaming ? (
					<TagNameField
						initial={name}
						renameId={id}
						label={t("ui.chat.tags.rename_label", { name })}
						error={error}
						errorId={errorId}
						busy={registry.pending}
						onCommit={rename}
						onCancel={(restoreFocus) => {
							setRenaming(false);
							setError(null);
							if (restoreFocus) focusStop();
						}}
					/>
				) : (
					<span
						className="min-w-0 flex-1 truncate"
						title={label}
						onDoubleClick={() => managed && setRenaming(true)}
					>
						{label}
					</span>
				)}
				<span className="shrink-0">{count}</span>
				{managed && !renaming && (
					<DropdownMenu open={menuOpen} onOpenChange={setMenuOpen}>
						<Popover open={confirming} onOpenChange={setConfirming}>
							<PopoverAnchor asChild>
								<DropdownMenuTrigger asChild>
									<button
										ref={stop}
										type="button"
										tabIndex={-1}
										{...{ [TAG_HEADER_STOP_ATTR]: id }}
										aria-label={t("ui.chat.tags.header_actions", {
											name: label,
										})}
										title={t("ui.chat.tags.header_actions", { name: label })}
										onKeyDown={onKeyDown}
										/*
										 * Absent from layout at rest so the name keeps its width
										 * (spec D2: ≈155px at a 220px sidebar), revealed by the
										 * row acts' rule: hover, keyboard focus, or its menu open.
										 */
										className={cn(
											"absolute end-2 flex size-6 shrink-0 items-center justify-center rounded-sm text-ink-dim opacity-0 hover:bg-row-hover hover:text-ink",
											"group-hover/header:static group-hover/header:opacity-100 group-focus-within/header:static group-focus-within/header:opacity-100 focus-visible:outline-2 focus-visible:outline-accent",
											(menuOpen || confirming) && "static opacity-100",
										)}
									>
										<MoreHorizontal aria-hidden="true" className="size-4" />
									</button>
								</DropdownMenuTrigger>
							</PopoverAnchor>
							<DropdownMenuContent
								align="end"
								className="min-w-44"
								onCloseAutoFocus={(event) => {
									// Rename and the delete confirm take focus themselves.
									if (renaming || confirming) event.preventDefault();
								}}
							>
								<DropdownMenuItem onSelect={() => setRenaming(true)}>
									<Pencil aria-hidden="true" />
									{t("ui.chat.tags.rename")}
								</DropdownMenuItem>
								{
									<>
										<DropdownMenuItem
											aria-disabled={!above}
											className="aria-disabled:text-ink-muted!"
											onSelect={() => void move("up")}
										>
											<ArrowUp aria-hidden="true" />
											<span className="min-w-0 truncate">
												{t("ui.chat.tags.move_up", { name: label })}
											</span>
										</DropdownMenuItem>
										<DropdownMenuItem
											aria-disabled={!below}
											className="aria-disabled:text-ink-muted!"
											onSelect={() => void move("down")}
										>
											<ArrowDown aria-hidden="true" />
											<span className="min-w-0 truncate">
												{t("ui.chat.tags.move_down", { name: label })}
											</span>
										</DropdownMenuItem>
									</>
								}
								<DropdownMenuSeparator />
								<DropdownMenuItem destructive onSelect={beginDelete}>
									<Trash2 aria-hidden="true" />
									{t("ui.chat.tags.delete")}
								</DropdownMenuItem>
							</DropdownMenuContent>
							<PopoverContent
								role="alertdialog"
								align="end"
								className="w-64 space-y-2 p-3"
								aria-labelledby={`${errorId}-title`}
								aria-describedby={`${errorId}-description`}
								onOpenAutoFocus={(event) => {
									// Cancel is focused: the safe answer is the default one.
									event.preventDefault();
									cancelDelete.current?.focus();
								}}
								onCloseAutoFocus={(event) => {
									event.preventDefault();
									focusStop();
								}}
								onKeyDown={(event) => {
									if (event.key === "Escape") event.stopPropagation();
								}}
							>
								<p id={`${errorId}-title`} className="text-body-sm text-ink">
									{t("ui.chat.tags.delete_title", { name: label })}
								</p>
								<p
									id={`${errorId}-description`}
									className="text-meta text-ink-dim"
								>
									{t("ui.chat.tags.delete_description", {
										count: conversations,
									})}
								</p>
								<div className="flex justify-end gap-2">
									<Button
										data-tag-delete-cancel
										ref={cancelDelete}
										variant="ghost"
										className="h-7 px-2 text-meta"
										onClick={() => setConfirming(false)}
									>
										{t("ui.chat.tags.cancel")}
									</Button>
									<Button
										variant="ghost"
										className="h-7 px-2 text-meta text-danger hover:bg-danger-wash"
										disabled={registry.pending}
										onClick={() => void remove()}
									>
										{t("ui.chat.tags.delete_tag")}
									</Button>
								</div>
							</PopoverContent>
						</Popover>
					</DropdownMenu>
				)}
			</div>
			{error && (
				<FieldAlert id={errorId} message={error} onRetry={retry ?? undefined} />
			)}
		</div>
	);
}

/**
 * The tag footer (spec D3), once, after the last row of the chats region while
 * grouping is on: `+ New tag` in place, and `Unused tags (n)` - the tags no
 * conversation carries, which have no header and were otherwise reachable only
 * through a dialog. Unused rows are drop targets; while a row drag is armed the
 * list auto-expands. It sits BELOW every row, so expanding it cannot move a row
 * under the pointer - the v2 rule that kept empty headers out of the drag.
 *
 * With an empty registry it is the first-use empty state instead (spec D6).
 */
export function ChatTagFooter({
	unused,
	total,
	dragArmed,
	announce,
	chord,
}: {
	unused: TagCategory[];
	total: number;
	dragArmed: boolean;
	announce: (sentence: string) => void;
	/** The `Tags…` chord as printed text (`⌘⇧L`), for the first-use line. */
	chord: string;
}) {
	useI18nLocale();
	const registry = useChatTagRegistry();
	const [adding, setAdding] = useState(false);
	const [expanded, setExpanded] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const errorId = useId();
	const open = expanded || dragArmed;
	const listId = useId();
	const create = async (value: string) => {
		const result = await registry.create(value);
		if (!result.ok) {
			setError(result.error);
			return false;
		}
		setError(null);
		// A new tag has no conversations, so it lands in Unused: open it so the
		// tag the user just made is visibly there.
		setExpanded(true);
		announce(t("ui.chat.tags.created_name", { name: value.trim() }));
		return true;
	};
	const addRow =
		total >= TAG_REGISTRY_LIMIT ? (
			<p className="flex h-7 items-center px-2 text-meta text-ink-dim">
				{t("ui.chat.tags.registry_limit")}
			</p>
		) : adding ? (
			<div className="flex h-7 items-center gap-2 px-1">
				<TagNameField
					initial=""
					label={t("ui.chat.tags.new_name")}
					placeholder={t("ui.chat.tags.name_placeholder")}
					error={error}
					errorId={errorId}
					busy={registry.pending}
					keepOpen
					onCommit={create}
					onCancel={(restoreFocus) => {
						setAdding(false);
						setError(null);
						if (restoreFocus)
							requestAnimationFrame(() =>
								document.querySelector<HTMLElement>("[data-tag-new]")?.focus(),
							);
					}}
				/>
			</div>
		) : (
			<button
				type="button"
				data-tag-new
				className="flex h-7 w-full items-center gap-2 rounded-md px-2 text-start text-meta text-ink-dim hover:bg-row-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
				onClick={() => setAdding(true)}
			>
				<Plus aria-hidden="true" className="size-3.5" />
				{t("ui.chat.tags.new_tag")}
			</button>
		);
	return (
		<div data-chat-tag-footer className="mt-2 border-hairline border-t pt-1">
			{total === 0 && (
				<div data-chat-tag-empty className="px-2 py-1 text-meta">
					<p className="text-ink">{t("ui.chat.tags.empty_title")}</p>
					<p className="text-ink-dim">
						{t("ui.chat.tags.empty_hint", { chord })}
					</p>
				</div>
			)}
			{addRow}
			{error && <FieldAlert id={errorId} message={error} />}
			{unused.length > 0 && (
				<>
					<button
						type="button"
						aria-expanded={open}
						aria-controls={listId}
						className="flex h-7 w-full items-center gap-1 rounded-md px-2 text-start text-meta text-ink-dim hover:bg-row-hover hover:text-ink focus-visible:outline-2 focus-visible:outline-accent"
						onClick={() => setExpanded((value) => !value)}
					>
						<ChevronRight
							aria-hidden="true"
							className={cn("size-3.5 shrink-0", open && "rotate-90")}
						/>
						{t("ui.chat.tags.unused", { count: String(unused.length) })}
					</button>
					<div id={listId} hidden={!open} data-chat-tag-unused>
						{unused.map((tag) => (
							<div key={tag.id} data-chat-tag-group={tag.id}>
								<ChatTagHeader
									id={tag.id}
									name={tag.name}
									count={0}
									above={unused[unused.indexOf(tag) - 1]?.id ?? null}
									below={unused[unused.indexOf(tag) + 1]?.id ?? null}
									announce={announce}
									unused
								/>
							</div>
						))}
					</div>
				</>
			)}
		</div>
	);
}
