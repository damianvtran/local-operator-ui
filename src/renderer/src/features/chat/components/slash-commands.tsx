/**
 * Slash command completion for the composer, Codex-style.
 *
 * The command list comes from the backend's shared registry over the desktop
 * control plane (`commands.list`) — never a second React-side vocabulary. The
 * popup floats ABOVE the composer in a bounded list with its own scroll, so
 * opening it never shifts the layout under the user's hands. The textarea
 * keeps DOM focus throughout; arrows move an `aria-activedescendant` marker,
 * Enter/Tab complete the token (never send), the next Enter submits, and
 * Escape closes the popup leaving the draft untouched. Tab keeps its normal
 * focus behaviour whenever the popup is not open, and an IME composition in
 * flight is never interrupted.
 */

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { cn } from "@shared/lib/utils";
import { useQuery } from "@tanstack/react-query";
import type { FC, KeyboardEvent, RefObject } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";

export type SlashCommandMeta = {
	name: string;
	description: string;
	aliases: string[];
	arguments: "none" | "optional" | "required";
	echo: boolean;
	consumes_prompt: boolean;
	destination: string;
	execution: "owner" | "native";
};

const MAX_VISIBLE_ROWS = 6;

const SLASH_TOKEN_PATTERN = /^\/([A-Za-z]*)(?=\s|$)/;
const LEADING_SPACE = /^\s/;

/** Parse the leading `/word` token and its caret position. The token only
 * counts at the start of the buffer: a slash mid-sentence is prose, not a
 * command. */
export function parseSlashToken(
	value: string,
	selectionStart: number,
): { token: string; end: number } | null {
	if (!value.startsWith("/")) return null;
	if (value.startsWith("//")) return null;
	const match = SLASH_TOKEN_PATTERN.exec(value);
	if (!match) return null;
	const end = match[0].length;
	if (selectionStart > end) return null;
	return { token: match[1], end };
}

type SlashSuggestionState = {
	open: boolean;
	active: number;
	matches: SlashCommandMeta[];
	tokenEnd: number;
};

export function useSlashCommands(inputValue: string, selectionStart: number) {
	const capabilities = useDesktopCapabilities();
	const enabled = desktopFeatureEnabled(capabilities.data, "commands");
	const listId = useId();
	const query = useQuery({
		queryKey: desktopKeys.commands,
		queryFn: () =>
			desktopResult<{ commands: SlashCommandMeta[] }>({
				op: "commands.list",
			}).then((result) => result.commands),
		enabled,
		staleTime: 300_000,
	});

	const [state, setState] = useState<SlashSuggestionState>({
		open: false,
		active: 0,
		matches: [],
		tokenEnd: 1,
	});

	const matches = useMemo(() => {
		const parsed = parseSlashToken(inputValue, selectionStart);
		if (!parsed || !query.data) return { parsed: null, list: [] };
		const needle = parsed.token.toLowerCase();
		const list = query.data.filter(
			(command) =>
				command.name.startsWith(needle) ||
				command.aliases.some((alias) => alias.startsWith(needle)),
		);
		return { parsed, list };
	}, [inputValue, selectionStart, query.data]);

	useEffect(() => {
		const { parsed, list } = matches;
		if (!parsed || list.length === 0) {
			setState((current) =>
				current.open ? { ...current, open: false } : current,
			);
			return;
		}
		setState((current) => ({
			open: true,
			// Clamp rather than reset: typing another letter should not jump the
			// marker back to the top of a shorter list.
			active: Math.min(current.active, list.length - 1),
			matches: list,
			tokenEnd: parsed.end,
		}));
	}, [matches]);

	const close = useCallback(
		() => setState((current) => ({ ...current, open: false })),
		[],
	);

	return {
		...state,
		close,
		listId,
		setActive: (index: number) =>
			setState((current) => ({ ...current, active: index })),
		isLoading: enabled && query.isLoading,
		available: enabled,
		commands: query.data ?? [],
	};
}

/** Replace the leading `/word` token with the completed command, preserving
 * the typed arguments and any multiline body after it. */
export function completeSlashToken(
	value: string,
	tokenEnd: number,
	command: string,
	argumentsMode: SlashCommandMeta["arguments"],
): string {
	const rest = value.slice(tokenEnd);
	// A space follows the command only when the command takes an argument;
	// /clear<space> would make the next keystroke look like an argument.
	const insertion = argumentsMode === "none" ? `/${command}` : `/${command} `;
	return (
		insertion + rest.replace(LEADING_SPACE, rest.startsWith("\n") ? "" : "")
	);
}

type SlashSuggestionsPopupProps = {
	state: ReturnType<typeof useSlashCommands>;
	onPick: (command: SlashCommandMeta) => void;
	anchorRef: RefObject<HTMLTextAreaElement | null>;
};

export const SlashSuggestionsPopup: FC<SlashSuggestionsPopupProps> = ({
	state,
	onPick,
}) => {
	const listId = state.listId;
	const activeRef = useRef<HTMLLIElement | null>(null);

	// Keep the active row in view without scrolling the page or transcript.
	// state.active is a trigger (the ref is read, not the state), so the
	// exhaustive-deps rule's complaint is suppressed the way the composer
	// textarea's re-measure effect already does.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not a read
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [state.active]);

	if (!state.open) return null;

	return (
		/* biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order. */
		<div
			id={listId}
			// biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant, so it is not in the tab order.
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
			role="listbox"
			aria-label="Slash commands"
			className={cn(
				"absolute bottom-full left-0 right-0 z-20 mb-1",
				"overflow-y-auto rounded-md border border-control bg-elevated",
				"shadow-lg",
			)}
			style={{ maxHeight: `${MAX_VISIBLE_ROWS * 56}px` }}
		>
			<ul>
				{state.matches.map((command, index) => (
					/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant. */
					<li
						key={command.name}
						id={`${listId}-${command.name}`}
						ref={index === state.active ? activeRef : null}
						// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant.
						// biome-ignore lint/a11y/useKeyWithClickEvents: arrows, Enter and Escape are handled on the textarea, not on the option.
						// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox option cannot be a native <option> here.
						// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
						role="option"
						aria-selected={index === state.active}
						className={cn(
							"flex cursor-default items-baseline gap-3 px-3 py-2",
							index === state.active ? "bg-accent-wash" : "bg-transparent",
						)}
						onMouseDown={(event) => {
							// mousedown, not click: a click would blur the textarea before
							// the pick handler ran and drop the draft's caret position.
							event.preventDefault();
							onPick(command);
						}}
						onMouseEnter={() => state.setActive(index)}
					>
						<span className="shrink-0 font-mono text-body-sm text-ink">
							/{command.name}
						</span>
						{command.aliases.length > 0 && (
							<span className="shrink-0 text-meta text-ink-dim">
								{command.aliases.map((alias) => `/${alias}`).join(" ")}
							</span>
						)}
						<span className="min-w-0 flex-1 truncate text-body-sm text-ink-muted">
							{command.description}
						</span>
						{command.arguments !== "none" && (
							<span className="shrink-0 text-meta text-ink-dim">
								{command.arguments === "required" ? "needs a value" : "value?"}
							</span>
						)}
					</li>
				))}
			</ul>
		</div>
	);
};

/**
 * Keyboard handler for the composer textarea while the popup is open.
 * Returns true when the event was consumed. IME composition (isComposing)
 * always passes through: stealing Enter mid-composition breaks CJK input.
 */
export function handleSlashKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	state: ReturnType<typeof useSlashCommands>,
	onPick: (command: SlashCommandMeta) => void,
): boolean {
	if (!state.open) return false;
	if (event.nativeEvent.isComposing) return false;

	switch (event.key) {
		case "ArrowDown":
			state.setActive(Math.min(state.active + 1, state.matches.length - 1));
			return true;
		case "ArrowUp":
			state.setActive(Math.max(state.active - 1, 0));
			return true;
		case "Enter":
		case "Tab": {
			const command = state.matches[state.active];
			if (!command) return false;
			// Complete ONLY. Sending here would submit a half-typed command.
			onPick(command);
			return true;
		}
		case "Escape":
			// Closes the popup; the draft is untouched.
			state.close();
			return true;
		default:
			return false;
	}
}
