import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { cn } from "@shared/lib/utils";
import { QueryClientContext } from "@tanstack/react-query";
import {
	type FC,
	type ReactNode,
	createContext,
	useCallback,
	useContext,
	useMemo,
} from "react";
import { teamBridgeKeys } from "./team-bridge-keys";
import {
	type TypingEntry,
	typingLineForm,
	typingNamesForScope,
} from "./team-bridge-typing-model";
import {
	type TypingReaderApi,
	useTeamBridgeTyping,
} from "./use-team-bridge-typing";

/**
 * The typing indicator line (design §6, "Rendering"), modelled on Slack's
 * thread composer: one small muted line under the bar, "**Sana** is typing".
 *
 * STATIC TEXT, NO DOTS. No animation means no reduced-motion special case and
 * nothing moving in the reader's peripheral vision while they read.
 *
 * NO LAYOUT SHIFT. The line is a fixed `h-4` box that is ALWAYS mounted while
 * the typing capability is on, and swaps its content's opacity - the composer
 * hint's technique (`team-bridge-composer.tsx`, the chord hint). A line that
 * mounted on the first typer would push the composer up 16 px every time
 * someone started and stopped, which is worse than no indicator.
 *
 * ANNOUNCED ONCE PER CHANGE. `<output>` (implicit `role=status`) + `aria-live=polite` +
 * `aria-atomic`, and the text node only changes when the SET of shown names
 * changes - a poll that answers the same typers re-renders identical text,
 * which assistive tech does not re-announce.
 */

/*
 * Bold names inside a translated sentence. The catalogue has no rich-text
 * tags, so each name is passed to `t()` as a private-use sentinel and the
 * formatted sentence is split on them: the word order (and, in Urdu, the bidi
 * isolates `t()` wraps around arguments) stays the translator's, and only the
 * names become `<strong>`. U+E000/U+E001 cannot occur in ICU output otherwise.
 */
const SENTINEL_OPEN = "\uE000";
const SENTINEL_CLOSE = "\uE001";
const sentinel = (index: number) => `${SENTINEL_OPEN}${index}${SENTINEL_CLOSE}`;
const SENTINEL_PATTERN = new RegExp(`${SENTINEL_OPEN}(\\d)${SENTINEL_CLOSE}`);

/** The translated sentence for a set of names, with each name marked for bolding. */
function typingSentence(names: readonly string[]): string | null {
	const line = typingLineForm(names);
	switch (line.form) {
		case "none":
			return null;
		case "one":
			return t("ui.teamBridge.typing.one", { first: sentinel(0) });
		case "two":
			return t("ui.teamBridge.typing.two", {
				first: sentinel(0),
				second: sentinel(1),
			});
		case "three":
			return t("ui.teamBridge.typing.three", {
				first: sentinel(0),
				second: sentinel(1),
				third: sentinel(2),
			});
		case "several":
			return t("ui.teamBridge.typing.several");
	}
}

function renderSentence(sentence: string, names: readonly string[]) {
	const parts: ReactNode[] = [];
	let rest = sentence;
	let key = 0;
	for (;;) {
		const match = SENTINEL_PATTERN.exec(rest);
		if (!match) break;
		if (match.index > 0) parts.push(rest.slice(0, match.index));
		parts.push(
			<strong key={key++} className="font-semibold text-ink-muted">
				{names[Number(match[1])] ?? ""}
			</strong>,
		);
		rest = rest.slice(match.index + match[0].length);
	}
	if (rest) parts.push(rest);
	return parts;
}

export type TeamBridgeTypingLineViewProps = {
	/** Display names in the hub's order; four or more collapse to "Several people". */
	names: readonly string[];
	/** Which composer this line sits under; a data attribute for rigs, nothing visual. */
	scope: "main" | "thread";
	className?: string;
};

/** The presentational line: stories and tests mount this directly. */
export const TeamBridgeTypingLineView: FC<TeamBridgeTypingLineViewProps> = ({
	names,
	scope,
	className,
}) => {
	useI18nLocale();
	const sentence = typingSentence(names);
	return (
		<output
			aria-live="polite"
			aria-atomic="true"
			data-team-bridge-typing={scope}
			data-typing-count={names.length}
			className={cn(
				/* `h-4` + `leading-4` pin the box to one 16 px line whether or not
				   anyone is typing; `truncate` keeps a long name from wrapping into
				   a second line that would move the composer. */
				"block h-4 truncate ps-3 text-meta-sm leading-4 text-ink-dim",
				className,
			)}
		>
			{sentence ? renderSentence(sentence, names) : null}
		</output>
	);
};

type TypingContextValue = {
	entries: readonly TypingEntry[];
	now: number;
	selfAccountId: string | null;
	labelFor: (accountId: string) => string | null;
};

const TeamBridgeTypingContext = createContext<TypingContextValue | null>(null);

export type TeamBridgeTypingProviderProps = {
	conversationId: string | null;
	tenantId: string | null;
	selfAccountId: string | null;
	/** The conversation is open, visible in this pane and not a preview. */
	open: boolean;
	/** The open thread's root, so a `message_seq` advance refreshes its replies too. */
	threadRootId?: string | null;
	labelFor: (accountId: string) => string | null;
	api?: TypingReaderApi;
	windowActive?: boolean;
	children: ReactNode;
};

/**
 * ONE reader per open conversation, shared by the main composer's line and the
 * thread pane's line: the hub answers every scope in one GET, so a user with a
 * thread open still polls once. Mount it only when `team_bridge_typing` is
 * enabled; without it the lines render nothing and reserve no space.
 */
export const TeamBridgeTypingProvider: FC<TeamBridgeTypingProviderProps> = ({
	conversationId,
	tenantId,
	selfAccountId,
	open,
	threadRootId,
	labelFor,
	api,
	windowActive,
	children,
}) => {
	// Optional on purpose: a story or a test without a QueryClient still renders,
	// it just has no history to refresh.
	const queryClient = useContext(QueryClientContext);
	const onMessageSeqAdvance = useCallback(() => {
		if (!queryClient || !conversationId || !tenantId) return;
		// Prefixes, so every account-suffixed entry for this room refreshes; only
		// mounted (active) queries refetch, which is the open timeline and thread.
		void queryClient.invalidateQueries({
			queryKey: [...teamBridgeKeys.all, "messages", tenantId, conversationId],
		});
		if (threadRootId)
			// A predicate, not a prefix: the thread pane keys its reply window as
			// [root, "replies", account, tenant, conversation, rootId], a different
			// order from `teamBridgeKeys.replies`, and both must refresh.
			void queryClient.invalidateQueries({
				predicate: ({ queryKey }) =>
					queryKey[0] === teamBridgeKeys.all[0] &&
					queryKey[1] === "replies" &&
					queryKey.includes(conversationId) &&
					queryKey.includes(threadRootId),
			});
	}, [queryClient, conversationId, tenantId, threadRootId]);
	const { entries, now } = useTeamBridgeTyping({
		conversationId,
		tenantId,
		enabled: open,
		onMessageSeqAdvance,
		api,
		windowActive,
	});
	const value = useMemo(
		() => ({ entries, now, selfAccountId, labelFor }),
		[entries, now, selfAccountId, labelFor],
	);
	return (
		<TeamBridgeTypingContext.Provider value={value}>
			{children}
		</TeamBridgeTypingContext.Provider>
	);
};

/**
 * The line under one composer, scoped: `rootId` null for the main pane, the
 * thread's root id for the thread pane. Outside a provider (capability off) it
 * renders nothing at all, so the composers keep their pre-feature geometry.
 */
export const TeamBridgeTypingLine: FC<{
	rootId: string | null;
	className?: string;
}> = ({ rootId, className }) => {
	const context = useContext(TeamBridgeTypingContext);
	const names = useMemo(
		() =>
			context
				? typingNamesForScope(context.entries, {
						scope: rootId,
						now: context.now,
						selfAccountId: context.selfAccountId,
						labelFor: context.labelFor,
					})
				: [],
		[context, rootId],
	);
	// Same names, same array identity downstream: the text node is untouched and
	// the polite region is not re-announced on an unchanged poll.
	const stableKey = names.join("\u0000");
	// biome-ignore lint/correctness/useExhaustiveDependencies: `stableKey` is the identity of `names`.
	const stableNames = useMemo(() => names, [stableKey]);
	if (!context) return null;
	return (
		<TeamBridgeTypingLineView
			names={stableNames}
			scope={rootId === null ? "main" : "thread"}
			className={className}
		/>
	);
};
