/**
 * The `$skill` popup: state, keyboard routing and rendering.
 *
 * The third list in the composer's popup family (`/` commands,
 * `@` mentions, `$` skills), built on the same patterns as the other two: a
 * pure token/rank/contract trio underneath (`skill-token.ts`, `skill-rank.ts`,
 * `skill-contract.ts`), this component holding the React state, and a key
 * adapter over the pure `skillKeyIntent` because the browser harness cannot
 * dispatch key events (`slash-contract.ts` and `at-contract.ts` made the same
 * move for the same reason).
 *
 * WHAT THIS LIST IS FOR. `$name` is the harness's manual skill invocation — the
 * user naming the skill instead of semantic routing guessing it — and the
 * desktop could browse skills (`skills.list`) but not invoke one. The list's
 * rows are the SAME vocabulary that op answers (no hard-coded names, hidden
 * skills included), the accept gesture reassembles the draft exactly as the
 * TUI's picker does, and the SUBMISSION half is `skill-invocation.ts`.
 *
 * THE VOCABULARY IS SESSIONLESS (the `skill_catalogue` contract): the read
 * travels with the composer's own FOLDER — the staged cwd on a draft, the
 * session's cwd once attached — so one cache entry per folder serves both
 * panes, and a first message can invoke a skill before any session exists.
 * Where the answer cannot be had, the list SAYS SO rather than opening
 * nothing: `skill-contract.ts` owns the four no-rows states and their copy.
 *
 * WHERE IT STANDS DOWN, stated in one place: the `$` token is suppressed while
 * a SLASH context is live at the caret (a recognised command owns the rest of
 * its line; see `skill-token.ts` for why the desktop keeps that claim total),
 * and the whole list is disabled while a masked capture is open, because the
 * box then belongs to the operator's keystrokes (`draftHeld`'s rule).
 */

import { retryDesktopQuery } from "@shared/api/local-operator/backend-error";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureState,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { usePairingCause } from "@shared/hooks/use-pairing-cause";
import { cn } from "@shared/lib/utils";
import { type QueryClient, useQuery } from "@tanstack/react-query";
import type { KeyboardEvent } from "react";
import {
	useCallback,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react";
import {
	SKILL_PHASE_LABEL,
	type SkillNotice,
	skillClickFooter,
	skillEnterFooter,
	skillKeyIntent,
	skillNotice,
	skillRowId,
} from "./skill-contract";
import { skillSuggestions } from "./skill-rank";
import {
	type SkillToken,
	skillToken,
	skillTokenIsLeading,
} from "./skill-token";
import { slashArgumentContext, slashContext } from "./slash-token";

/** One row of the listbox: the DISCOVERY name and the description it carries. */
export type SkillCatalogRow = { name: string; description?: string };

/*
 * The row region's height budget, the sibling popup's own rule and values
 * (`slash-commands.tsx`: 6 x 36): the max-height is a whole number of the row
 * pitch, so the list never RESTS on a half-row slice - a sliced glyph at the
 * region's edge reads as a clipping bug rather than as a scroller (design
 * round 1, D2).
 */
const MAX_VISIBLE_ROWS = 6;
const ROW_PITCH = 36;

export type SkillCompletionState = {
	/** The `$` token at the caret, or null. Null also drives `open` false. */
	token: SkillToken | null;
	/** Whether the token LEADS the draft (the accept gesture branches on it). */
	leading: boolean;
	rows: SkillCatalogRow[];
	/** The full discovered vocabulary (unfiltered), for the submit-side parse. */
	vocabulary: SkillCatalogRow[];
	/**
	 * Whether the vocabulary answer may be believed: the query has answered and
	 * is not in error. The `$` ink reads this (`skill-highlight.ts`) so a loading
	 * or errored read paints no claims and no dim flash — one predicate, beside
	 * the vocabulary itself, so the ink and the list cannot disagree about
	 * whether the answer has arrived (`spec-reconciliation.md` §2).
	 */
	settled: boolean;
	/**
	 * What the list says when no row can be offered, or null. It drives the
	 * `open` predicate's third arm, so a bare `$` over an unreachable or empty
	 * vocabulary opens the shell and states the fact rather than nothing
	 * (`skill-contract.ts` owns the state machine and its copy).
	 */
	notice: SkillNotice | null;
	open: boolean;
	active: number;
	listId: string;
	activeDescendantId: string | null;
	close(): void;
	setActive(index: number): void;
	setActiveHover(index: number): void;
};

type SkillListArgs = {
	text: string;
	caret: number;
	/**
	 * The folder the vocabulary is discovered from — the pane's OWN cwd, which on
	 * a draft is the staged directory `sessions.create` will receive, so the
	 * draft and the session it becomes read the same vocabulary. Empty (a folder
	 * mid-edit) means no query and a quiet list; the route resolves the literal
	 * `~` the staged default carries.
	 */
	cwd?: string;
	/**
	 * Whether this pane can address a SESSION — the page's own `paneHasSession`,
	 * which is exactly the gate `/skills` is refused behind (`slash-dispatch.ts`).
	 * It decides the EMPTY notice's wording only: the pointer clause is dropped
	 * where it cannot be followed (UX v2 §1).
	 */
	attached: boolean;
	/** The recognised slash vocabulary, for the claim that suppresses `$`. */
	commandNames: ReadonlySet<string>;
	argumentWords: readonly string[];
	/** False while the composer refuses input or a capture owns the box. */
	enabled: boolean;
};

export function useSkillCompletion({
	text,
	caret,
	cwd,
	attached,
	commandNames,
	argumentWords,
	enabled,
}: SkillListArgs): SkillCompletionState {
	const capabilities = useDesktopCapabilities();
	/*
	 * THE PROVIDER-OPTIONAL CLIENT (QA round 1, Q-1). The shared composer mounts
	 * in documents that carry no `QueryClientProvider` (the mini view), where
	 * `useQuery` cannot be called at all - it throws "No QueryClient set" from
	 * `useQueryClient()` before any option is read, whatever `enabled` says. The
	 * vocabulary read below therefore hands `useQuery` this hook's client
	 * explicitly (the lift's own pattern: `useDesktopCapabilities` and the slash
	 * hook both take it this way) and folds `provided` into its gate, so a
	 * provider-less document gets no list rather than a crash - the fail-closed
	 * direction the composer's host contract requires.
	 */
	const { client, provided } = useOptionalQueryClient();
	/*
	 * `catalogues`, the capability the route that serves `skills.list` declares
	 * (`local_operator/server/routes/capabilities.py`). Read here for the same
	 * reason the slash hook reads `commands`: a backend that predates the op is
	 * a list that does not open rather than a 422 per keystroke.
	 */
	const skillCwd = cwd ?? "";
	/*
	 * `skill_catalogue`, the capability the SESSIONLESS read declares
	 * (`local_operator/server/routes/capabilities.py`, beside `catalogues`). The
	 * tri-state is read rather than the boolean projection because the states are
	 * different sentences: `below-version` is the durable update-the-backend
	 * notice and fires NO query at all; `unpaired` is the transient one (a
	 * credential fact, and one a retry can change); `unknown` is quiet, because
	 * no capability answer has arrived to assert either. A released backend that
	 * predates the key would 422 a sessionless call, which is why the question
	 * is asked before the call rather than discovered as an error
	 * (`desktop-hooks.ts` carries the union's own reasoning).
	 */
	const feature = desktopFeatureState(capabilities.data, "skill_catalogue");
	/*
	 * THE PAIRING GATE (QA round 1, Q-2; hardened by round 2's Q-3). Main knows
	 * the pairing cause BEFORE any read is fired — its probe saw the daemon
	 * refuse this app's credential (`usePairingCause()`, one shared bridge read)
	 * — while the PUBLIC capability route answers a refused pairing just as
	 * cheerfully as a paired one, so `feature === "enabled"` is not evidence the
	 * read can succeed. Gating the vocabulary on the cause is what turns "five
	 * refused calls, then the sentence" into "the sentence": the transient arm
	 * below renders with nothing on the wire, and the token still derives from
	 * `enabled` alone, so the line attaches where it is owed. The read resumes
	 * on its own when the cause clears — main pushes the status change, the hook
	 * re-reads, `active` re-opens.
	 *
	 * FAIL CLOSED WHILE UNKNOWN (Q-3). The hook answers in three states: no
	 * answer yet (`undefined`), paired and serving (`null`), refused (a cause).
	 * A fresh mount starts in the first, and the read runs only on the second —
	 * gating on `!pairingRefused` alone fired one refused `skills.list` per
	 * mount (measured: six a run, four at boot and two in a forced-remount
	 * window), because "not refused yet" is not "good to ask". Unknown is also
	 * no refusal for the LINE: it asserts neither cause, so the notice stays
	 * silent until the hook answers — the rule the capability's own `unknown`
	 * state already follows.
	 */
	const pairingCause = usePairingCause();
	const pairingRefused = pairingCause !== undefined && pairingCause !== null;
	const active = enabled && feature === "enabled" && pairingCause === null;
	/*
	 * The token is derived from `enabled` alone, NOT from `active`: the durable
	 * notice has to attach to a `$` on a backend that will never answer a query,
	 * and the token is local parsing — no network, no vocabulary — so the one
	 * gate it keeps is the capture's (its keys must not surface a list over a
	 * mask).
	 */
	const token = useMemo(
		() => (enabled ? skillToken(text, caret) : null),
		[enabled, text, caret],
	);
	const leading = useMemo(
		() => (token ? skillTokenIsLeading(text, token) : false),
		[text, token],
	);
	/*
	 * A SLASH CONTEXT AT THE CARET SUPPRESSES THE TOKEN. A recognised command
	 * that has been space-terminated owns the rest of its line; a `$` inside
	 * that argument is argument text, not a skill token competing for the same
	 * picker. The workspace command word and its argument phase are the two
	 * shapes a slash context takes, and both are asked here — this is the one
	 * place the two sigils' vocabularies arbitrate, and it fails toward "no
	 * skill list" (the user's prose is never rewritten on a claim).
	 */
	const claimed = useMemo(
		() =>
			slashContext(text, caret, commandNames) !== null ||
			slashArgumentContext(text, argumentWords, caret, commandNames) !== null,
		[text, caret, commandNames, argumentWords],
	);
	/*
	 * The vocabulary, from the sessionless catalogue read: one op, one cache key
	 * per FOLDER — shared by drafts and sessions, so the rows a draft shows are
	 * the rows the session it becomes will read (risk 2's `~`-vs-absolute
	 * refetch is the one transition this cannot share). The query is
	 * provider-gated (`provided`, see the client note above), needs an actual
	 * folder to discover from (mid-edit is empty), and fires only when the
	 * capability says this backend can answer it at all.
	 */
	const skillsQuery = useQuery(
		{
			queryKey: ["desktop", "skills", "catalogue", skillCwd],
			queryFn: () =>
				desktopResult<{
					data: { skills: SkillCatalogRow[]; version?: string };
				}>({ op: "skills.list", cwd: skillCwd }),
			enabled: active && provided && skillCwd.length > 0,
			staleTime: 30_000,
			/*
			 * THE HOUSE RETRY POLICY (QA round 1, Q-2's tail). Without this the read
			 * ran on react-query's default, which is what turned one refused call
			 * into five. `retryDesktopQuery` is the sibling reads' own decision —
			 * one retry for a failure that carried an answer, none for one that
			 * spent the whole deadline — so this read joins the family rather than
			 * inventing a second policy.
			 */
			retry: retryDesktopQuery,
		},
		client,
	);
	const choices = useMemo<SkillCatalogRow[]>(
		() => skillsQuery.data?.data.skills ?? [],
		[skillsQuery.data],
	);
	const rows = useMemo(() => {
		if (!token || claimed) return [];
		return skillSuggestions(token.query, choices, leading).map(
			(pair) => pair.choice,
		);
	}, [token, claimed, leading, choices]);

	const listId = useId();
	const tokenKey =
		token === null || claimed ? null : `${token.start}:${token.query}`;
	/*
	 * Esc latches PER TOKEN, by its start and its text — the slash and `@`
	 * popups' own rule (`_sync_picker_if_phase_changed`): without it the list
	 * reopens on the very next keystroke, because the state is re-derived on
	 * every render.
	 */
	const dismissed = useRef<string | null>(null);
	const lastTokenKey = useRef<string | null>(null);
	const [state, setState] = useState({ open: false, active: 0 });

	useEffect(() => {
		if (tokenKey !== dismissed.current) dismissed.current = null;
		const changed = lastTokenKey.current !== tokenKey;
		lastTokenKey.current = tokenKey;
		setState((current) => {
			if (tokenKey === null || dismissed.current === tokenKey) {
				return current.open ? { ...current, open: false } : current;
			}
			// A new token opens on the top row with no choice made.
			if (changed) return { open: true, active: 0 };
			// A closed list stays closed; rows arriving later do not re-open it.
			if (!current.open) return current;
			return {
				open: true,
				active: Math.min(current.active, Math.max(rows.length - 1, 0)),
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
	// No ambiguity gate lives here to answer, so the hover marker and the
	// keyboard's are the same state — kept a named alias because the row
	// handlers are the slash popup's pair and a single setter would hide the
	// distinction the moment one is added (`at-picker.tsx`'s identical note).
	const setActiveHover = setActive;

	const activeIndex = Math.min(state.active, Math.max(rows.length - 1, 0));
	/*
	 * THE NO-ROWS STATES, and the one predicate they feed (spec-reconciliation
	 * §2). `$` used to open nothing at all in three states the operator named: a
	 * draft pane, an older build, an empty or unreachable vocabulary — no list,
	 * no sentence, no path from "nothing happened" to "why". Now a leading
	 * token always opens SOMETHING: rows, or one non-selectable line in the same
	 * shell (`skill-contract.ts` owns the state machine and its copy; the order
	 * is durable > transient > empty > miss). The miss arm keeps #690's
	 * behaviour — a typed query over a settled vocabulary — and what is gone is
	 * opening on a raw `hasQuery`: a listbox saying "No skills match." against a
	 * vocabulary that never arrived is the dishonesty these states replace,
	 * and an inline `$` keeps the money guard's silence.
	 *
	 * `active &&`: the query only runs while the capability and the caller's own
	 * enablement allow it, so "the answer arrived" is only meaningful under the
	 * same gate the list reads. `isSuccess` and not `!isLoading`: a refetch keeps
	 * `status: "success"` with the previous data in hand, and blanking a
	 * settled vocabulary mid-refetch would flicker the ink the flag exists to
	 * steady.
	 */
	const hasQuery = token !== null && token.query.trim() !== "";
	const settled = active && skillsQuery.isSuccess;
	const notice = useMemo(
		() =>
			token === null || claimed
				? null
				: skillNotice({
						feature,
						hasCwd: skillCwd.length > 0,
						attached,
						leading,
						hasQuery,
						rowsCount: rows.length,
						vocabularyNonEmpty: choices.length > 0,
						pairingRefused,
						query: skillsQuery.isError
							? "error"
							: skillsQuery.isSuccess
								? "success"
								: active && skillsQuery.isLoading
									? "loading"
									: "pending",
					}),
		[
			token,
			claimed,
			feature,
			skillCwd,
			attached,
			leading,
			hasQuery,
			rows.length,
			choices.length,
			pairingRefused,
			active,
			skillsQuery.isError,
			skillsQuery.isSuccess,
			skillsQuery.isLoading,
		],
	);
	const open =
		state.open && tokenKey !== null && (rows.length > 0 || notice !== null);
	return {
		token,
		leading,
		rows,
		vocabulary: choices,
		settled,
		notice,
		open,
		active: activeIndex,
		listId,
		activeDescendantId:
			open && rows[activeIndex]
				? `${listId}-${skillRowId(rows[activeIndex].name)}`
				: null,
		close,
		setActive,
		setActiveHover,
	};
}

/**
 * The body a `$name` invocation injects, read through the SESSIONLESS
 * catalogue op — the same one the list's vocabulary comes from.
 *
 * `skills.list` with `cwd` and `name` answers the resolved SKILL.md — the
 * runtime's own `skill://` resolver output, reference listing included — which
 * is the exact string `invoke.py:render_invocation` wraps. Reading it against
 * the composer's own folder is what makes a FIRST-MESSAGE invocation possible:
 * the old read addressed a session, so a draft's `$name` could never expand.
 * A body that cannot be read answers `null`: the CALLER then sends the user's
 * text as written rather than swallowing the request (the harness's own trade
 * for an unreadable body).
 *
 * The detail field is read in both shapes it has been seen in — the resolver's
 * plain string, and the `{ body }`/`{ text }` object its route wrapper has
 * declared — so a change of envelope on the route cannot silently turn every
 * invocation into "skill not found".
 */
export async function readSkillBody(
	queryClient: QueryClient,
	cwd: string,
	name: string,
): Promise<string | null> {
	try {
		const result = await queryClient.fetchQuery({
			queryKey: ["desktop", "skills", "catalogue", cwd, name],
			queryFn: () =>
				desktopResult<{ data: { detail: unknown } }>({
					op: "skills.list",
					cwd,
					name,
				}),
			staleTime: 30_000,
		});
		const detail = result?.data?.detail;
		if (typeof detail === "string") return detail;
		if (detail && typeof detail === "object") {
			const record = detail as { body?: unknown; text?: unknown };
			if (typeof record.body === "string") return record.body;
			if (typeof record.text === "string") return record.text;
		}
		return null;
	} catch {
		return null;
	}
}

export type SkillSuggestionsPopupProps = {
	state: SkillCompletionState;
	onPick: (row: SkillCatalogRow) => void;
};

/**
 * The listbox, painted in the composer popup's own chrome (same width, same
 * anchor, same row pitch family as `/` and `@`), because the three lists appear
 * in one place and a user does not need to tell which one they are in — only
 * what the keys do, which is what the header and footer say.
 */
export function SkillSuggestionsPopup({
	state,
	onPick,
}: SkillSuggestionsPopupProps) {
	const activeRef = useRef<HTMLLIElement | null>(null);
	// Keep the active row in view without scrolling the page or transcript,
	// on the same trigger pattern as the slash popup's.
	// biome-ignore lint/correctness/useExhaustiveDependencies: trigger, not a read
	useEffect(() => {
		activeRef.current?.scrollIntoView({ block: "nearest" });
	}, [state.active]);

	if (!state.open) return null;
	const activeRow = state.rows[state.active];
	return (
		/* biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus; the listbox is reached through aria-activedescendant. */
		<div
			id={state.listId}
			// biome-ignore lint/a11y/useFocusableInteractive: the textarea keeps focus.
			// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox cannot be a native <select>.
			role="listbox"
			aria-label="Skills"
			className={cn(
				"absolute bottom-full left-0 right-0 z-20 mb-1",
				"overflow-hidden rounded-md border border-control bg-elevated",
				"shadow-lg",
			)}
		>
			<div className="border-b border-hairline px-3 py-1 text-meta text-ink-dim">
				{SKILL_PHASE_LABEL}
			</div>
			<div
				className="overflow-y-auto"
				style={{ maxHeight: `${MAX_VISIBLE_ROWS * ROW_PITCH}px` }}
			>
				{state.rows.length === 0 ? (
					/*
					 * THE NO-ROWS LINE, from the shared state machine
					 * (`skill-contract.ts`): the miss, the empty state's two wordings, or
					 * the durable/transient sentences — never a silent empty shell. It is
					 * non-selectable by construction: it holds no `role`, the arrow keys
					 * clamp against an empty row list, and the footer renders only with an
					 * active row, so the notice cannot advertise a gesture there is
					 * nothing to complete (UX v2 §2).
					 */
					state.notice && (
						<div className="px-3 py-2 text-body-sm text-ink-muted">
							{state.notice.text}
						</div>
					)
				) : (
					<ul>
						{state.rows.map((row, index) => (
							/* biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea; the active option is announced through aria-activedescendant. */
							/* biome-ignore lint/a11y/useKeyWithClickEvents: the keyboard is handled on the textarea, not on the option. */
							<li
								key={skillRowId(row.name)}
								id={`${state.listId}-${skillRowId(row.name)}`}
								ref={index === state.active ? activeRef : null}
								// biome-ignore lint/a11y/useFocusableInteractive: focus stays in the composer textarea.
								// biome-ignore lint/a11y/noNoninteractiveElementToInteractiveRole: a combobox option cannot be a native <option> here.
								// biome-ignore lint/a11y/useSemanticElements: a type-to-filter combobox option cannot be a native <option>.
								role="option"
								aria-selected={index === state.active}
								className={cn(
									"relative flex items-baseline gap-3 px-3 py-2",
									index === state.active
										? "bg-accent-wash before:absolute before:inset-y-0 before:left-0 before:w-0.5 before:bg-accent"
										: "bg-transparent",
								)}
								onMouseDown={(event) => {
									// Focus, not the pick: prevents the default so the
									// textarea keeps its caret and draft position.
									event.preventDefault();
								}}
								onClick={() => onPick(row)}
								onMouseEnter={() => state.setActiveHover(index)}
							>
								{/* `shrink`, never `shrink-0`: the latter sizes the span to
							    max-content, which makes `truncate` inert and hard-clips
							    the name while the description collapses (design round 1,
							    D1). The sibling's class is the same. */}
								<span className="min-w-0 shrink truncate font-mono text-body-sm text-ink">
									${row.name}
								</span>
								{row.description && (
									/* `min-w-16` (64px) is a FLOOR on the disambiguator, and it is
									   the D1 re-measure's own finding: with the sibling's classes
									   the name's shrink absorbs the whole deficit, so an extreme
									   name starves the description back to clientW 0 (measured at
									   620px). The floor keeps it readable there (64px, measured)
									   and is inert everywhere the name leaves room. */
									<span className="min-w-16 flex-1 truncate text-body-sm text-ink-muted">
										{row.description}
									</span>
								)}
							</li>
						))}
					</ul>
				)}
			</div>
			{activeRow && (
				<div className="space-y-0.5 border-t border-hairline px-3 py-1 text-meta text-ink-dim">
					<p>{skillEnterFooter(activeRow.name)}</p>
					<p>{skillClickFooter(activeRow.name)}</p>
				</div>
			)}
		</div>
	);
}

/**
 * The key router, as an adapter over the pure decision.
 *
 * `skillKeyIntent` is bundled and executed by `scripts/skill-list.test.mjs` —
 * the browser harness cannot dispatch key events, so the routing has to be
 * exercised as the code that ships or it is not exercised at all.
 */
export function handleSkillKeyDown(
	event: KeyboardEvent<HTMLTextAreaElement>,
	state: SkillCompletionState,
	onPick: (row: SkillCatalogRow) => void,
): boolean {
	const intent = skillKeyIntent({
		key: event.key,
		composing: event.nativeEvent.isComposing,
		open: state.open,
		active: state.active,
		count: state.rows.length,
	});
	switch (intent.kind) {
		case "move":
			// Moving without latching, exactly as the two sibling popups do: a key
			// that asked to move and could not is not a choice.
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
