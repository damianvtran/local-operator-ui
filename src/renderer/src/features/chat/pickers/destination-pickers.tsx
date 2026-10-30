/**
 * Destination adapters: one component per `native_action` destination.
 *
 * Each adapter is the thin layer between the backend's presentation request
 * (fields, sources, submit metadata) and the shared `PickerHost`. Its job is
 * to load real options from the named catalogue, collect the decision, call
 * the REAL backend operation the request named, and show the actual reply.
 * None of them synthesise success; a closed picker with no result strip is a
 * cancel, and a result strip always quotes the backend.
 *
 * Destinations that already have a settings surface (settings, providers,
 * accounts, appearance, MCP, updates, web-search) navigate to it rather than
 * duplicating an editor here. Everything else renders in the host.
 */

import {
	agentDescriptionText,
	withAgentDescriptionText,
} from "@features/agents/utils/agent-description";
import { autoTagSupported, forkAutoTag } from "@features/chat/chat-auto-tag";
import { parseSidebarView } from "@features/chat/chat-sidebar-view";
import { useConnectProviderStore } from "@features/providers/connect-provider-store";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	desktopKeys,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import {
	useProfiles,
	useTeams,
} from "@shared/api/local-operator/profile-hooks";
import { teamDisplayName } from "@shared/api/local-operator/team-display";
import { SNAPSHOT_READ_OPTIONS } from "@shared/api/query-client";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { useOptionalQueryClient } from "@shared/hooks/use-optional-query-client";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";

/**
 * The model this session is RUNNING, for a dialog whose job is not to offer the
 * model it already runs.
 *
 * `frontend ?? heldFrontend`, THE SAME VALUE THE READINGS STRIP PAINTS. During a
 * reconnect the authoritative `frontend` is NULL by design -- the hook drops it
 * so the replacement stream's frames are treated as replay -- and the readings
 * the pane keeps are the held copy. Reading `canonical.frontend` alone here made
 * a HELD pick open with no current row marked and its cursor on catalogue row 0,
 * so Enter POSTed whichever model sorted first: a model this session had never
 * run, painted as pending by the strip (UX round 1, U1, a blocker). The same
 * press in the live phase marks the running row and re-picks the model already
 * in use, so the two phases disagreed about what a press means.
 *
 * Stated once rather than at each call site: two dialogs ask this question and a
 * second copy is how they would come to disagree about what "current" is.
 */
const runningFrontend = (canonical: CanonicalSessionHandle) =>
	canonical.frontend ?? canonical.heldFrontend;
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, themes } from "@shared/themes";
import {
	showErrorToast,
	showInfoToast,
	showSuccessToast,
	showWarningToast,
} from "@shared/utils/toast-manager";
import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import {
	type FC,
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
} from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type { DesktopModelSelection } from "../../../../../shared/desktop-contract";
import type {
	DesktopLoopState,
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import {
	type CanonicalFrontendSync,
	type CanonicalModel,
	type DesktopHistoryPage,
	type SessionCatalogueStatus,
	goalCapability,
	goalPresent,
} from "../../../../../shared/desktop-session-contract";
import { messageText } from "../canonical/transcript-reducer";
import { credentialNamesFrom } from "../components/credential-capture";
import { formatPricePair } from "../components/slash-argument-rows";
import type { SlashCommandMeta } from "../components/slash-commands";
import type { SlashCommandInvocation } from "../components/slash-submit";
import {
	type DraftSelectionTarget,
	type EffortCarry,
	NO_DRAFT_TARGET,
	draftPreviewQuery,
	effortCarry,
	fastModelPickNotice,
	fastPickFailure,
	pickResultText,
	selectionFromModel,
	selectionSelector,
} from "../draft-selection";
import {
	bandReadings,
	effortChosenRung,
	effortDisplay,
	effortLadder,
	effortLevel,
	fastModeState,
	modelSelector,
	specUnresolved,
} from "../session-status/session-model";
import { forkBudgetRefusal } from "../utils/message-budget";
import { fastPickerOptions } from "./fast-picker-options";
import {
	type CatalogueScope,
	type RowAuth,
	catalogueListing,
	drawnCatalogue,
	rowAuthOf,
	scopeCatalogue,
	catalogueSelectorOf as selectorOf,
} from "./model-catalogue-listing";
import {
	activeModelForDefault,
	effortCommandSucceeded,
	writeModelDefaultSettings,
} from "./model-default-settings";
import { matchModelPickerOptions } from "./model-picker-match";
import {
	PickerCheck,
	PickerField,
	PickerHost,
	PickerKeyValue,
	type PickerOption,
	type PickerResult,
	PickerSegment,
} from "./picker-host";
import {
	GOAL_CLEAR_ARGS,
	GOAL_COMMAND,
	GOAL_DONE_ARGS,
	LOOP_COMMAND,
	LOOP_STOP_ARGS,
	goalStateWord,
	loopIsRunning,
} from "./session-commands";
import {
	errorText,
	isNativeAction,
	useOperation,
	useSessionCommand,
} from "./use-picker-backend";

/** What the dispatcher hands every adapter. */
export type PickerContext = {
	action: NativeDesktopAction;
	spec: SlashCommandMeta;
	sessionId: string;
	canonical: CanonicalSessionHandle;
	commands: SlashCommandMeta[];
	onClose: () => void;
	/** Post a system line into the transcript area (view-only). */
	note: (text: string, error?: boolean) => void;
	/**
	 * Re-dispatch a slash command the user picked (help -> pick a command).
	 *
	 * An `SlashCommandInvocation`, not a line: the dispatcher does not parse
	 * text at all — see `slash-dispatch.ts` for why a second parser used to
	 * overrule the composer's planner on a multi-line draft.
	 */
	dispatch: (invocation: SlashCommandInvocation) => void;
	/** Switch the agent's bound canonical session (resume/fork/new). */
	rebind: (sessionId: string) => void;
	/**
	 * The DRAFT pane this picker was opened for, when it was opened from one.
	 *
	 * A new-conversation pane has no session for `/model`, `/effort` or `/fast` to
	 * address, so the three pickers read and write a pane's own selection instead:
	 * it resolves through `sessions.preview` and rides `sessions.create`, never
	 * `settings.edit` (the machine's default is not this control's to change) and
	 * never `sessions.command` (there is no owner to command yet).
	 *
	 * `sessionId` is an empty string in that case, and the draft branch of each
	 * picker never reads it: the two modes are exclusive, and the shape says so by
	 * carrying the pane's own target rather than a session id it does not have.
	 */
	draft?: DraftPickerSession;
};

/**
 * A DRAFT pane's selection, as the pickers see it.
 *
 * `target` is the pane's own `{cwd, target, model}` — the same value the pane's
 * `sessions.preview` query is keyed on, which is what lets the picker's re-read
 * and the pane's reading be ONE cache entry rather than two answers. `select` is
 * called only after the backend has resolved the candidate, so the pane never
 * repaints on a choice the backend refused.
 */
export type DraftPickerSession = {
	target: DraftSelectionTarget;
	select: (selection: DesktopModelSelection | null) => void;
};

type Entities<T = Record<string, unknown>> = {
	command: string;
	entities: T[];
	current: unknown;
};

/**
 * The entity list for a command, shared by the picker dialogs and the
 * composer's inline argument list.
 *
 * Exported because the composer must read the SAME query the dialog reads —
 * same key, same path mapper — or the two surfaces could offer different rungs
 * for one command (the rule the session-status strip's effort chip already
 * follows for `/effort`). A second copy of this query is how they would drift.
 */
export function useEntities<T = Record<string, unknown>>(
	sessionId: string,
	command: string,
	name?: string,
	enabled = true,
) {
	const { client, provided } = useOptionalQueryClient();
	return useQuery(
		{
			queryKey: ["desktop", "entities", sessionId, command, name ?? ""],
			queryFn: () =>
				desktopResult<Entities<T>>({
					op: "commands.entities",
					sessionId,
					command,
					name: name || undefined,
				}),
			/*
			 * `provided &&`: the shared composer reaches this query through
			 * `useSlashCompletion`'s argument rows, and it must be callable in
			 * documents that mount no `QueryClientProvider` (the mini view). The
			 * fallback client must not fetch there (see
			 * `useOptionalQueryClient`), and an unanswered entity list is already a
			 * supported state - the rows simply offer nothing. In the app
			 * `provided` is always true, so this is a no-op.
			 */
			enabled: enabled && provided,
			staleTime: 15_000,
		},
		client,
	);
}

// ------------------------------------------------------------------ model

type CatalogueRow = DesktopModelCatalogue["models"][number] & {
	value?: string;
	routed?: boolean;
};

/** The row's price pair in the one spelling both surfaces print. */
function pricePair(row: CatalogueRow): string {
	return formatPricePair(
		row.input_price,
		row.output_price,
		row.routed === true,
	);
}

/**
 * The catalogue's rows as the picker's options — the one place a row becomes a
 * searchable option.
 *
 * EXTRACTED from the component's `useMemo` so its haystack is executable from a
 * test rather than only reachable through a mounted dialog. The haystack is
 * where the operator's report lived: it carried `[provider, model_id]` and never
 * the provider's own HUMAN name, so a query in the words the listing publishes
 * (`SpaceXAI: Grok 4.7` -> `spacexai`) matched nothing while the row sat in the
 * catalogue. `listing_name` is a match input now, and the rule that reads it is
 * `matchModelPickerOptions` (see `model-picker-match.ts`), which normalises both
 * sides of the test.
 *
 * Which half does the work, measured rather than assumed: the NORMALISATION is
 * what resolves `grok 4.7` and `gpt 6 luna` (their words are already in the id,
 * glued with hyphens and a slash), and the name is what resolves a query holding
 * a word that appears in no id at all (`spacexai`). Both are needed; neither
 * alone answers the report.
 *
 * Pure and `shownSelector`-parameterised: `current` is the only field that reads
 * a value outside the rows, and passing it in is what lets a test build the same
 * options the component builds.
 */
export function modelPickerOptions(
	rows: CatalogueRow[],
	options: { credentialsKnown: boolean; shownSelector?: string | null },
): PickerOption[] {
	const known = options.credentialsKnown;
	return rows.map((row) => ({
		value: selectorOf(row),
		label: row.label || row.model_id,
		/*
		 * The price pair travels with the provider line so the dialog and the
		 * composer's inline list describe one model the same way: a user who
		 * reaches for the thorough surface must not have to re-derive what the
		 * fast one already told them. Same formatter, so `free` and
		 * `usage-based` are words in both and an absent price is blank in both.
		 *
		 * THE CAVEAT IS THE SHARED VOCABULARY (design review round 1, D5; UX round
		 * 1, U3): the row says `needs sign-in`, the group heading says `Needs
		 * sign-in` and the control says `N need sign-in`, so one state reads as
		 * one thing on this surface. The pre-fix two-word register was the one
		 * outside that family, and the inline list's copy is aligned with it in
		 * `slash-argument-rows.ts` (the phrase itself is kept out of this comment
		 * on purpose: the suite pins that the old one cannot come back to this
		 * file, and a comment quoting it exactly would re-arm that pin).
		 */
		description: `${row.provider}${row.aggregated ? t("ui.chat.pickers.destination_pickers.aggregated") : ""}${
			rowAuthOf(row, known) === "needs-sign-in"
				? t("ui.chat.pickers.destination_pickers.needs_sign_in")
				: ""
		}${pricePair(row) ? ` · ${pricePair(row)}` : ""}`,
		meta: row.context_window
			? t("ui.chat.pickers.destination_pickers.k", {
					value: Math.round(row.context_window / 1000),
				})
			: undefined,
		current: options.shownSelector === (row.selector ?? row.value),
		group: !known
			? t("ui.chat.pickers.destination_pickers.sign_in_state_unknown")
			: row.connected
				? t("ui.chat.pickers.destination_pickers.signed_in")
				: t("ui.chat.pickers.destination_pickers.needs_sign_in660cb8"),
		/*
		 * WHAT A PICK ON THIS ROW DOES, when picking it is not the ordinary
		 * switch (design review round 1, D2; QA round 1, Q-1). A needs-sign-in
		 * row's pick opens the Connect flow for its provider instead of starting
		 * the operation the host's picked-row mark and spinner describe, so the
		 * host needs that fact BEFORE the pick runs: with it, the mark is never
		 * set (no stuck "Switching the model" on a row no operation answers
		 * about) and the footer can name the different verb ("Enter connects
		 * zai" rather than a switch it will not make). Read off `rowAuthOf`'s
		 * one answer, so the description, the group and the pick cannot
		 * disagree.
		 */
		action:
			rowAuthOf(row, known) === "needs-sign-in"
				? { kind: "connect" as const, provider: row.provider }
				: undefined,
		keywords: [
			/*
			 * The provider's own HUMAN name (`Grok 4.7` for
			 * `openrouter/x-ai/grok-4.7`), which is what a user actually types: the
			 * row id glues the same words with hyphens and a slash, so a query in the
			 * listing's words reaches the matcher through this term. The filter
			 * normalises both sides (see `model-picker-match.ts`).
			 */
			row.listing_name,
			row.provider,
			row.model_id,
		] /*
		 * A blank term is dropped. Not because an `undefined` would match every
		 * query — it cannot: the backend ships `listing_name: ""` for a nameless
		 * row (`CatalogueEntry.listing_name` is `kw_only` with `default=""`), and
		 * either way the matcher normalises the joined haystack before reading it,
		 * so an empty term is invisible. The reason is that a term that says
		 * nothing is not a search term: keeping it puts a value in the haystack
		 * that is true of every row and useful to none, and the next person to
		 * change this list should not have to work out whether it is load-bearing.
		 */
			.filter(
				(term): term is string =>
					typeof term === "string" && term.trim() !== "",
			),
	}));
}

/**
 * The selector a resolution answered with, or the fallback its caller holds.
 *
 * The resolution is the authority - it may have resolved a fallback route rather
 * than the row asked for - but it need not name one, and a sentence that prints
 * an empty selector names nothing at all. `fallback` is the catalogue row's own
 * label for a pick, and the recorded selection for the draft hook, which is the
 * one spelling both the pane and the wire agree on.
 */
function selectorOfResolution(
	resolved: CanonicalFrontendSync,
	fallback: string,
): string {
	return (
		modelSelector(
			resolved.snapshot.selected_model ?? resolved.snapshot.effective_model,
		) || fallback
	);
}

/**
 * The default write's failure prefix, in one place.
 *
 * `useOperation` composes its strip from it and the picker writes the same
 * sentence into the transcript when the dialog is gone (reviewer round 1, minor
 * 4) — two spellings of one fact would drift, so there is one constant.
 */
const DEFAULT_SAVE_FAILURE = () =>
	t("ui.chat.pickers.destination_pickers.the_default_was_not_saved");

/**
 * A default checkbox's label, at the height of its TALLEST wording.
 *
 * Ticking rewrites the label ("Also make this…" → "Picks here also set…" →
 * "Default for new sessions: X. Picks here update it too."), and a label that
 * grew a line pushed the rows down while the dialog, centred on the viewport,
 * moved up to match: the click after a tick landed one row off (UX round 2,
 * U9 - measured 44 px on the model dialog). The two wordings a tick can show
 * are laid into the same grid cell as invisible generated content, so the cell
 * is already as tall as either before the box is ticked and nothing moves.
 *
 * Generated content rather than hidden spans: the wording lives in data
 * attributes, so it is not in the label's text or a query for the visible
 * sentence - a hidden copy in the DOM would answer every one of those as if it
 * were on screen. It stays out of the ACCESSIBLE NAME only because the
 * pseudo-elements are `visibility: hidden` (`before:invisible`/
 * `after:invisible`): generated content counts toward an accessible name, so
 * dropping `invisible` would read both reserved wordings into the checkbox's
 * name (review round 3, n1).
 *
 * `capped` is for a label whose third wording carries a NAME of unbounded
 * length - the model dialog's. Reserving the name in force did not hold: a
 * ticked pick that saved a longer name grew the label by a line and moved the
 * rows after all (design round 3 D3, review n2), and reserving the longest name
 * the catalogue lists would hold every dialog five lines tall for a row few
 * users pick. So a capped label is a FIXED height instead: at least three
 * lines (the tallest of the default dialog's wordings), the two name-free
 * wordings reserved, and the named wording cut at three lines with an
 * ellipsis. The cut is visual only; the accessible name keeps the whole
 * sentence.
 */
const ReservedLabelText: FC<{
	text: string;
	/**
	 * Every wording the label can show. Uncapped, the two not on screen are
	 * reserved; capped, the first two are, and the third is the one cut.
	 */
	wordings: readonly [string, string, string];
	capped?: boolean;
}> = ({ text, wordings, capped = false }) => {
	const [reserveA = "", reserveB = ""] = capped
		? wordings
		: wordings.filter((wording) => wording !== text);
	const cut = capped && text === wordings[2];
	return (
		<span
			data-reserve-a={reserveA}
			data-reserve-b={reserveB}
			className={cn(
				"grid",
				capped && "min-h-[3lh]",
				"before:invisible before:col-start-1 before:row-start-1 before:content-[attr(data-reserve-a)]",
				"after:invisible after:col-start-1 after:row-start-1 after:content-[attr(data-reserve-b)]",
			)}
		>
			<span className={cn("col-start-1 row-start-1", cut && "line-clamp-3")}>
				{text}
			</span>
		</span>
	);
};

/**
 * Resolve a DRAFT pane's pick through the backend, THEN record it. One
 * implementation for both readings the pane can pick.
 *
 * Both halves of that order are load-bearing, and they are the reason this is
 * not a copy of the session's `useSessionCommand`:
 *
 * Resolving first means the pane only ever shows a choice the backend accepted.
 * The window, the price pair and the effort ladder the strip prints are the ones
 * `sessions.preview` returned for the CHOSEN selection, never values read off the
 * row that was clicked — the picker's own row carries no window and no ladder at
 * all. It is also what lets a refusal be reported honestly here rather than at
 * the first send: the preview runs the resolution `sessions.create` will run.
 *
 * Recording second means a refusal leaves the draft exactly as it was. The cache
 * is written under the candidate's own key either way, so nothing is left
 * half-applied: an unselected candidate is a cache entry nothing reads.
 *
 * The conversation is already given by the caller: a model pick replaces the
 * selection outright (a new model has its own ladder, so the previous model's
 * rung does not carry), an effort pick keeps it and changes only the rung.
 */
function useDraftPick(
	draft: DraftPickerSession | undefined,
	note: (text: string, error?: boolean) => void,
) {
	const queryClient = useQueryClient();
	/*
	 * Whether this backend can carry `DraftModel.fast_mode` (round 2's F1
	 * follow-up). Read here rather than by each picker, because every preview this
	 * hook asks - the pane's and the pickers' - has to be filtered the same way or
	 * a persisted dial 422s the whole body on the one request that happens to keep
	 * it. `draftPreviewQuery` owns the filtering; this is the answer it is given.
	 */
	const capabilities = useDesktopCapabilities();
	const carriesFast = desktopFeatureEnabled(capabilities.data, "draft_fast");
	const [busy, setBusy] = useState(false);
	const [result, setResult] = useState<PickerResult | null>(null);
	/*
	 * The selection in force, seeded from the pane and advanced by every pick the
	 * backend confirmed.
	 *
	 * `draft.target` is a snapshot taken when this dialog OPENED — `PickerOutlet`
	 * is handed the context that spawned it — so it does not move when the pane's
	 * own value does: the store write a pick performs re-renders the pane and
	 * leaves this dialog reading the value it was opened on. Without a local
	 * memory the dialog therefore contradicts itself the instant a pick succeeds,
	 * the strip and the result strip naming the new model while the header
	 * sentence and the checkmark still name the old one (review round 1, R2). It
	 * is the same defect the session's picker fixed for its own lagging owner
	 * frame in QA Q2, which is why it is a remembered receipt and not a re-read.
	 *
	 * It is also what keeps the dialog's other half honest: the ladder an effort
	 * pick offers is read from THIS selection's `sessions.preview` resolution, so
	 * an effort dialog opened after a model pick offers the new model's rungs
	 * rather than the previous model's.
	 *
	 * The pane stays the authority for a dialog that has not picked (the seed is
	 * the prop) and for a re-open (a fresh mount re-seeds from the pane).
	 */
	const [picked, setPicked] = useState<DesktopModelSelection | null>(
		draft?.target.model ?? null,
	);
	const selection = picked ?? draft?.target.model ?? null;
	/**
	 * What this dialog's preview is resolved for: the pane's target with the
	 * selection in force substituted for the one it opened on. Undefined `model`
	 * is the wire's "the configured default", which is what an unpicked pane
	 * asks for.
	 */
	const target = useMemo(
		() =>
			draft
				? ({
						...draft.target,
						model: selection ?? undefined,
					} as DraftSelectionTarget)
				: undefined,
		[draft, selection],
	);
	/*
	 * One refusal, said twice: the strip for a reader still looking at the dialog,
	 * the composer's note for one who closed it during the wait — the rule UX U2
	 * set for the session's picker, which has the same wait for the opposite
	 * reason (a cold runtime bind there, a resolution here).
	 */
	const refuse = useCallback(
		(text: string) => {
			note(text, true);
			setResult({ tone: "error", text });
		},
		[note],
	);
	const pick = useCallback(
		async (
			/**
			 * Null when the reading this pick belongs to cannot name a model to change
			 * — an effort rung with no model behind it. Refused out loud rather than
			 * silently ignored, so the dialog says why the click did nothing.
			 */
			next: DesktopModelSelection | null,
			reading: {
				/** What the strip says once the backend has resolved the pick. */
				describe: (resolved: CanonicalFrontendSync) => string;
				/**
				 * What a refusal names, and it names the READING rather than "the model":
				 * an effort pick that failed has not changed the model, and saying so
				 * tells the user to re-check the one thing that is still correct.
				 *
				 * OPTIONAL because the fast dial's picks always bring their own words
				 * (`failure` for a refused request, `applied` for a resolution that did
				 * not take the dial), and the one path that would use this prefix is
				 * unreachable for them: the draft route only opens once the pane's
				 * preview has named a model. A sentence nothing can print is a claim
				 * nobody checks (round 2, nit).
				 */
				refused?: string;
				/**
				 * The effort level the pane's own pick holds, when this pick changes the
				 * MODEL and that level must not be discarded in silence (UX U1; design
				 * D7/D11).
				 *
				 * It is checked HERE rather than by the caller, and that placement is the
				 * fix rather than a tidy-up, for two reasons the round-4 review named:
				 *
				 *   - `setBusy(true)` is the only guard this dialog has (`picker-host`
				 *     refuses a second row while it is set) and it is set below, so a probe
				 *     that ran BEFORE the call left the whole first half of a carry pick
				 *     unguarded AND unwitnessed: two clicks inside that window both
				 *     committed, and the pane and the strip could end up naming different
				 *     models (F2), while a click that answers nothing is the exact failure
				 *     this feature exists to remove (design D13).
				 *   - What the check CANNOT establish has to refuse the pick rather than
				 *     fall through to a rung-less one. A caller-side `catch` left the
				 *     decision at its pre-probe value, which records
				 *     `reasoning_effort: null` under a sentence naming no level - U1's own
				 *     silence on a narrower path (F1). Inside `pick`, an unreadable ladder
				 *     is `checked: false` and the pick is refused out loud.
				 */
				carry?: string;
				/**
				 * A check that the backend's OWN resolution shows the pick applied,
				 * before it is recorded on the draft.
				 *
				 * Every other reading this hook records is checked by the resolution
				 * itself: a model pick is confirmed by the spec naming that model, and an
				 * effort pick by the ladder's own level. The FAST dial is the exception
				 * the check exists for (issue #1265): a backend older than the birth
				 * field ACCEPTS the body shape it does not know only by refusing it
				 * (a 422, which the catch below reports), but a backend that parses the
				 * key and does not apply it answers a perfectly healthy snapshot with the
				 * dial unchanged. Recording that would put "on" on the draft row and
				 * send it on the create - a pane claiming a dial the first turn never
				 * gets, which is the silent-drop this route must not introduce.
				 *
				 * When `applied` hands back a sentence the pick is refused with THAT
				 * sentence and NOTHING is recorded: the pane keeps the selection it had,
				 * and the words come from the same reading that made the decision.
				 */
				applied?: {
					/**
					 * The refusal sentence, when the resolution does NOT show the pick applied;
					 * `null` when it does. A sentence rather than a boolean so the check and
					 * the words both come from the one reading of the resolution — the
					 * caller cannot refuse with a sentence about a different snapshot.
					 */
					refusal: (resolved: CanonicalFrontendSync) => string | null;
				};

				/**
				 * A clause that is true of the pick WHATEVER the outcome said, composed
				 * onto the result sentence AFTER the branch that chose it (design review
				 * round 2, D6).
				 *
				 * The model pick's fast-dial notice used to live inside `describe`, and
				 * `describe` does not run when an effort rung is carried - so the one path
				 * that changes a model with a rung in force dropped the dial in silence. A
				 * notice stated here cannot be skipped by the branch, which is why the
				 * composition lives in `pickResultText` rather than at the call site.
				 */
				notice?: (resolved: CanonicalFrontendSync) => string | null;
				/**
				 * What a FAILED request says, when the caller has better words than the
				 * transport's.
				 *
				 * Without it the catch below prints `${refused} ${errorText(error)}`, which
				 * is the right shape for a model or effort pick (the backend's reason is
				 * the useful half) and the wrong one for the fast dial: the only failure
				 * this route meets in the field is a core too old to carry
				 * `DraftModel.fast_mode`, whose whole-body 422 says `The request has invalid
				 * fields.` - implementer language naming nothing the reader can act on
				 * (design review round 1, D4). Owned by the caller because only it knows
				 * what ITS pick meant, and pure so the mapping is asserted rather than
				 * read.
				 */
				failure?: (error: unknown) => string;
			},
		) => {
			if (!draft) return;
			if (!next) {
				refuse(
					t(
						"ui.chat.pickers.destination_pickers.this_pane_has_not_resolved_a_model_to_change",
						{ refused: reading.refused ?? "" },
					).trimStart(),
				);
				return;
			}
			setBusy(true);
			setResult(null);
			try {
				/*
				 * The carry check, when this pick changes the model on a pane that has a
				 * level in force: one resolution of the NEW model with no rung, which is
				 * also the KEY the pick itself reads when the level is not carried - so
				 * clearing costs no extra call and carrying costs one.
				 */
				let carry: EffortCarry | null = null;
				// A blank level is no question: there is nothing to check, so no probe runs.
				if (reading.carry) {
					const probe = await queryClient.fetchQuery(
						draftPreviewQuery({ ...draft.target, model: next }, carriesFast),
					);
					const offered = bandReadings(probe.snapshot, null).effort;
					const decision = effortCarry(reading.carry, {
						ladder: effortLadder(offered),
						/*
						 * Both halves of "the ladder was READ".
						 *
						 * `Array.isArray` separates an absent key from an empty ladder; it
						 * cannot separate "nobody has read this ladder" from "this model
						 * has no rungs". The cold snapshot is exactly the shape that slips
						 * through it - every metadata field present-and-empty, which is what
						 * `specUnresolved` exists for - and there the decision used to be
						 * `checked: true` and the sentence below asserted that the level the
						 * user chose "is not one of that model's levels" about a ladder
						 * nobody had read, in the chip's `unknown` category word (review
						 * round 4, F4, reproduced at the component boundary in round 5).
						 */
						ladderKnown:
							Array.isArray(offered?.reasoning_efforts) &&
							!specUnresolved(offered),
						/*
						 * The level the CLEARING sentence may name, which is narrower than
						 * the chip's label: `auto`, `reasoning` and `unknown` are states of a
						 * reading, not levels, and one of them in a level slot is the
						 * category noun this strip's copy already refuses elsewhere (F4's
						 * residual slot, review round 5).
						 */
						level: effortLevel(offered),
					});
					if (!decision.checked) {
						refuse(decision.refusal);
						return;
					}
					carry = decision;
				}
				const chosen: DesktopModelSelection = carry?.rung
					? { ...next, reasoning_effort: carry.rung }
					: next;
				const resolved = await queryClient.fetchQuery(
					draftPreviewQuery({ ...draft.target, model: chosen }, carriesFast),
				);
				/*
				 * Before the record, never after: see `applied`'s own note. A reading the
				 * backend did not apply is refused exactly like a failed resolution, and
				 * the pane keeps what it had.
				 */
				if (reading.applied) {
					const refusal = reading.applied.refusal(resolved);
					if (refusal !== null) {
						refuse(refusal);
						return;
					}
				}
				draft.select(chosen);
				setPicked(chosen);
				setResult({
					tone: "success",
					/*
					 * ONE COMPOSITION FOR BOTH BRANCHES (design review round 2, D6): the
					 * carry's confirmation or the pick's own sentence is the base, and the
					 * caller's notice is appended after either of them. The branch used to
					 * choose the whole sentence, so a notice living inside `describe`
					 * vanished exactly when an effort rung was carried.
					 */
					text: pickResultText({
						carried: carry,
						selector: selectorOfResolution(
							resolved,
							selectionSelector(chosen) ?? "",
						),
						described: reading.describe(resolved),
						notice: reading.notice?.(resolved) ?? null,
					}),
				});
			} catch (error) {
				/*
				 * Said twice on purpose, and it is the same sentence both times: the
				 * strip for a reader still looking at the dialog, the composer's note for
				 * one who closed it during the wait — the rule UX U2 set for the session's
				 * picker, which has the same wait for the opposite reason (a cold runtime
				 * bind there, a resolution here).
				 *
				 * `failure` is the caller's own words for a pick it can describe better
				 * than the transport can; see its note. Omitted, the reason is appended,
				 * which is what the model and effort picks want.
				 */
				refuse(
					reading.failure
						? reading.failure(error)
						: reading.refused
							? `${reading.refused} ${errorText(error)}`
							: errorText(error),
				);
			} finally {
				setBusy(false);
			}
		},
		[draft, queryClient, refuse, carriesFast],
	);
	return {
		pick,
		busy,
		result,
		selection,
		target,
		refuse,
		carriesFast,
	};
}

/**
 * The effort rung a draft's model pick must not discard - the level the
 * DIALOG's own selection holds, or `""` when it holds none.
 *
 * Its own function rather than an expression at the call site because the
 * question and its answer have to be the same fact, and the defect this exists
 * for is precisely a call site reading a different one: `draft.target` is the
 * snapshot the dialog opened on, `useDraftPick.selection` is the live receipt.
 * Read from the snapshot, a second model pick in the SAME open dialog asked to
 * carry a rung the first pick had already dropped and reinstated it silently
 * (review round 5, M1). Kept beside the hook so the two read the same value,
 * and pure so the carry question is executable in a test rather than asserted
 * as source text.
 */
function carriedRung(
	selection: DesktopModelSelection | null | undefined,
): string {
	return typeof selection?.reasoning_effort === "string"
		? selection.reasoning_effort
		: "";
}

/**
 * How often the picker re-asks its providers, WHILE THE DIALOG IS OPEN.
 *
 * The number is the backend's own (`local_operator/providers/controller.py`'s
 * `PICKER_TTL_S` = `15 * 60`), and it is deliberately the same number rather
 * than a shorter one: that constant is the hard TTL the live read is answered
 * at, so an interval below it would only re-READ a listing document the backend
 * is still holding, which is precisely the defect the companion change in
 * `damianvtran/local-operator` fixes on the route's side. Read from this side it
 * is the operator-visible half of "the cache must be periodically invalidated":
 * a model released during a long session appears on the next tick rather than on
 * the next open.
 *
 * The MOUNT is what bounds it. This query only exists inside the dialog, so
 * closing the picker is what stops the cadence; nothing polls behind a closed
 * dialog. Each tick costs one local IPC call and, on the backend, one listing at
 * the picker's own TTL - not a fresh per-provider probe.
 */
export const PICKER_CADENCE_MS = 15 * 60_000;

export const ModelPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	note,
	draft,
}) => {
	const locale = useI18nLocale();
	/*
	 * `false` is the shipped registry's own document; the live listing is a
	 * SEPARATE key (see the promotion beside the query, and why it is the second
	 * read rather than the first).
	 */
	const [live, setLive] = useState(false);
	const [pickedCurrent, setPickedCurrent] = useState<string | null>(null);
	/*
	 * WHICH VIEW OF THE CATALOGUE THIS DIALOG SHOWS.
	 *
	 * The default is `usable` — the rows this machine can run, plus the one the
	 * session is on — because the operator's report is a picker listing every
	 * Radient model for a user with no Radient sign-in. `showAll` is the user's
	 * own widening of that view: it is not a preference, it resets every time
	 * the dialog mounts, and it exists so the hidden rows are discoverable
	 * rather than gone (see `scopeCatalogue` for the rule and the two backends
	 * it spans).
	 */
	const [showAll, setShowAll] = useState(false);
	const scope: CatalogueScope = showAll ? "all" : "usable";
	const catalogue = useQuery({
		/*
		 * The key is the SHARED prefix plus the flag and the SCOPE, so a credential
		 * change can drop every document with ONE invalidation against
		 * `desktopKeys.catalogue` (`provider-detail.tsx` on a successful sign-in,
		 * `LogoutPicker` on a removal) rather than the picker having to remember to
		 * ask again.
		 *
		 * THE SCOPE IS PART OF THE KEY because the two documents are different
		 * ANSWERS rather than a filter over one: a `usable` document holds fewer
		 * rows and carries `hidden`, an `all` document holds everything the
		 * providers list. Caching them under one key would let a reopen serve the
		 * wider answer to a reader that asked for the narrower one. The settings
		 * combobox's `[…, false]` key is deliberately NOT shared any more: it wants
		 * the unfiltered registry and the picker's default does not.
		 */
		queryKey: [...desktopKeys.catalogue, live, scope],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live,
				scope,
			}),
		staleTime: live ? 0 : 60_000,
		/*
		 * FOCUS IS NOT AN ASK, and on this key it is the sharpest form of that rule.
		 * `staleTime: 0` above means the live document is stale the moment it lands,
		 * so under the inherited `refetchOnWindowFocus: true` a DELIVERED focus
		 * re-lists every provider the user has signed in to: a real round trip per
		 * provider, against that provider's own rate limit, which is how a user
		 * amplifies their own rate limiting by alt-tabbing out and back — the reported
		 * complaint. The asks are the refresh control (which calls `refetch` and so
		 * still reads immediately) and the cadence below; a window that came back is
		 * neither. The option is stated HERE rather than inherited precisely because
		 * this key is the one that is always stale — see `SNAPSHOT_READ_OPTIONS`, the
		 * app's single statement of the focus half.
		 *
		 * DELIVERY IS NOT PART OF THE CLAIM, and saying so is QA round 1's Q1 rather
		 * than a hedge: the channel this opts out of is query-core's focus manager,
		 * which `QueryClientProvider` wires to the window's `visibilitychange` on
		 * mount, and that a real macOS app switch delivers that transition to THIS
		 * renderer is not measured anywhere in this repository. Both rigs here that
		 * need the transition drive it synthetically (`scripts/hub-round-trips.mjs`
		 * patches `document.visibilityState`; `scripts/attach-frame-evidence.mjs`
		 * dispatches the event), and the measurement that settles it would need a
		 * windowed app boot with a real app switch — a window on the operator's screen,
		 * which is why no round has taken it. If a real switch never delivers it, this
		 * line is INERT rather than wrong: the change can only remove reads.
		 *
		 * `refetchOnReconnect` is already silent app-wide and is named beside it
		 * rather than left to the global, so a change to that default cannot re-arm a
		 * provider re-list on this key by accident — the same reason `/usage` names
		 * its own `retry: 0` instead of inheriting it.
		 */
		...SNAPSHOT_READ_OPTIONS,
		refetchOnReconnect: false,
		/*
		 * A live re-list costs a measured 2.33 s, and `live` is a new query key —
		 * so without this the list is blanked to the loading spinner for the whole
		 * fetch, which reads as "the catalogue disappeared" right after the user
		 * asked for it to be refreshed (latency U4). `keepPreviousData` keeps the
		 * rows the picker already has painted under the new `isFetching` state, and
		 * it is load-bearing a second time now that the live fetch starts by itself:
		 * the rows the dialog opens on are the ones it keeps on screen.
		 */
		placeholderData: keepPreviousData,
		/*
		 * The "periodically refetch" half of the operator's report, and the half this
		 * app owns. WHILE THE WINDOW IS FOCUSED the live listing is re-asked on the
		 * picker cadence - `PICKER_CADENCE_MS` - so a model published during a
		 * working session appears without the dialog being closed and reopened.
		 *
		 * "While the window is focused" is load-bearing rather than padding (review
		 * round 1, R1-2): `refetchIntervalInBackground` is unset, so query-core skips a
		 * tick that comes due while the window is hidden and the NEXT one resumes the
		 * cadence - up to `PICKER_CADENCE_MS` AFTER the user comes back, never at the
		 * moment they do. Before this change the focus refetch covered exactly that
		 * gap; now nothing does, and re-covering it with
		 * `refetchIntervalInBackground: true` would re-list every provider while the
		 * user is away, which is the unasked provider traffic the focus option exists
		 * to remove. What a returning user has instead is stated above: the refresh
		 * control, one click, on a key whose `staleTime: 0` makes it read immediately.
		 *
		 * The BACKEND half of the same behaviour (answering that read at the picker's
		 * TTL rather than from a document that can be 24 hours old) is a separate
		 * change in `damianvtran/local-operator`. This half works without it - each
		 * tick is a real read and the backend's stale-while-revalidate still re-lists
		 * in the background - but the two together are what makes a tick mean "the
		 * listing is at most 15 minutes old" rather than "we asked again".
		 *
		 * Only the live key polls. The registry answer cannot change while the dialog
		 * is open, so re-asking it would be cost with no reading behind it.
		 */
		refetchInterval: live ? PICKER_CADENCE_MS : false,
	});
	/*
	 * STALE-THEN-UPDATE, which is the desktop half of what the TUI picker already
	 * does (`local_operator/tui/app.py`: `_populate_model_picker` paints the
	 * registry, then `_refresh_catalogue` re-lists the providers off the loop).
	 *
	 * WHY THE PROMOTION IS AUTOMATIC RATHER THAN A BUTTON PRESS. The initial read
	 * answers from the SHIPPED REGISTRY - what lop last shipped - so a model the
	 * provider has released since then is simply not in it, and the operator's
	 * report is the measured case: Anthropic's own `/v1/models` lists `Opus 5.5`
	 * while the shipped registry stops at `claude-opus-5`, and the picker could not
	 * reach it without the user first pressing "Refresh from providers" on the
	 * chance that it would help. Asking for `/model` IS the ask. The button stays,
	 * as the manual re-ask (and as the control that says a listing is running).
	 *
	 * WHY THE LIVE READ IS THE SECOND ONE RATHER THAN THE FIRST. A live re-list is
	 * a measured 2.33 s, and opening straight into it would put a centred spinner
	 * where the rows belong - slower AND less useful, because the model the user is
	 * most likely to want is usually one the registry already knows.
	 *
	 * WHY IT WAITS FOR `isFetched`, and this is measured rather than argued. The
	 * first version promoted on MOUNT, and it threw the paint away: the key changed
	 * before the registry read had settled, and `keepPreviousData` can only carry
	 * data that EXISTS - so the live key came up with no placeholder, `isLoading`
	 * went true, and the frames photographed a spinner reading `Loading` with
	 * `Refreshing…` beside it and NO rows. That is the exact state
	 * stale-then-update exists to avoid, and it is why the gate is the read having
	 * SETTLED rather than the component having mounted.
	 *
	 * `isFetched` rather than `isSuccess`: a registry read the backend REFUSED is
	 * also a settled answer, and refusing to promote on one would leave a picker
	 * whose only rows came from a failed read with no live attempt made.
	 *
	 * The promotion is monotonic - there is no path back to `live: false` - which
	 * is what stops the two documents trading places while the user types.
	 */
	const catalogueSettled = catalogue.isFetched;
	useEffect(() => {
		if (catalogueSettled) setLive(true);
	}, [catalogueSettled]);
	/*
	 * The REGISTRY document, subscribed rather than read once, because it is a
	 * FALLBACK as well as the first paint (review round 1, R1-1).
	 *
	 * WHY THE LIVE READ NEEDS ONE AT ALL. `keepPreviousData` carries the previous
	 * key's rows only while the new key is PENDING; the moment a query settles as
	 * `error` it has no data, so a live listing that failed left the picker with
	 * nothing — and `catalogueListing`'s `isError` branch then drew one line of
	 * error text where the painted registry rows had been. That is design D4's
	 * defect (1450 rows replaced by a wall of text) re-entered on a path no click
	 * gates any more: the read the user never asked for destroyed the list they
	 * already had. The registry document is still in the cache under its own key.
	 *
	 * `enabled: false` because this observer never issues a read: the query above
	 * owns the registry fetch, and a second fetch of the same key would be a
	 * duplicate on the one path where a request is visible. It shares that key's
	 * cache entry, so `registry.data` is the same document the first paint used,
	 * and it keeps the same `staleTime` so the two observers cannot disagree about
	 * whether their shared entry is fresh.
	 */
	const registry = useQuery({
		queryKey: [...desktopKeys.catalogue, false, scope],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live: false,
				scope,
			}),
		enabled: false,
		staleTime: 60_000,
	});
	/*
	 * THE USABLE DOCUMENT, KEPT ACTIVE WHILE THE WIDER LIST IS SHOWN — one
	 * observer serving the two readings that could otherwise go stale together
	 * (agent review round 1, R1-2 and R1-3), re-pointed at the LIVE entry by
	 * agent review round 2 (M1/M4).
	 *
	 * R1-2, THE FALLBACK: a failed `Show all` read had nothing behind it. The
	 * reveal is a KEY CHANGE ([…, "usable"] -> […, "all"]), `keepPreviousData`
	 * carries nothing once a query settles as `error`, and the automatic
	 * promotion makes the first `all` read a LIVE one — so no `[false, "all"]`
	 * entry was ever written and `catalogueListing`'s `isError` branch put the
	 * error text where the rows had been, over a dialog that had rows a moment
	 * earlier (its own docstring's rule: a failed read is only a wall of text
	 * when there is nothing to draw).
	 *
	 * M1, WHICH entry: the answer the user was LOOKING AT is the LIVE one once
	 * the automatic promotion has run — the first version held the `[false,
	 * "usable"]` registry entry, so after live promotion a failed reveal drew
	 * the shipped models under a note calling them "the last listing that
	 * answered". Keying this observer on `live` matches the entry to the
	 * document the default view was drawing, including the pre-promotion
	 * window, where `live` is still false and the two are the same document.
	 *
	 * M4, THE COUNT: the control prints `hidden` from a `usable` answer, and
	 * while the wider list is shown the ACTIVE catalogue query is the `all` one —
	 * so a credential-change invalidation refetched everything except the
	 * document the number comes from, and the kept label could outlive the state
	 * it describes ("2 need sign-in" over a row that just connected). This
	 * observer IS the live entry the default view's number came from, so the
	 * refreshed number below cannot flip sources; `enabled: showAll` and the
	 * registry observer's `staleTime`, so the readers of this entry cannot
	 * disagree about freshness. It never fetches while the default view is
	 * shown — the catalogue query above owns that entry there.
	 */
	const usableDocument = useQuery({
		queryKey: [...desktopKeys.catalogue, live, "usable"],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live,
				scope: "usable",
			}),
		enabled: showAll,
		staleTime: 60_000,
	});
	/*
	 * THE REGISTRY READING OF THE SAME ENTRY, as the fallback's fallback: the
	 * state where the live answer never landed (a failed provider listing — the
	 * `live-listing-failed` frame, where the registry rows stand alone) leaves
	 * `[true, "usable"]` empty, so a failed reveal there still needs SOMETHING
	 * to draw. Enabled only while that hole exists and the wider list is shown,
	 * so in the ordinary flow it never fetches and stays what the pre-promotion
	 * paint already wrote; when enabled, react-query serves its cache entry or
	 * refetches it on the usual freshness rules.
	 */
	const usableRegistryDocument = useQuery({
		queryKey: [...desktopKeys.catalogue, false, "usable"],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live: false,
				scope: "usable",
			}),
		enabled: showAll && usableDocument.data === undefined,
		staleTime: 60_000,
	});
	/*
	 * What the picker DRAWS, and whether that is a registry read — the selection
	 * and the provenance from ONE place (`drawnCatalogue`), because the note's
	 * sentence has to describe the document that actually stands in (round 2
	 * code review R2-1 for the same-key case, M1 for the held registry one).
	 */
	const drawn = drawnCatalogue({
		catalogue: catalogue.data,
		registry: registry.data,
		usable: usableDocument.data,
		registryUsable: usableRegistryDocument.data,
		showAll,
	});
	const catalogueDocument = drawn.document;
	/*
	 * Only a LIVE fetch says the listing is running: it is the one that re-lists the
	 * providers, whichever started it - the automatic promotion above or the
	 * button. The initial (registry) load is also `isFetching`, and labelling that
	 * as a listing in flight would describe a read the user never asked for
	 * (design D8).
	 *
	 * The LABEL then distinguishes the two starters (review round 1, design D2 and
	 * UX U4): the automatic pass reads `Checking…` and the user's own click reads
	 * `Refreshing…`, because `Refreshing…` is a word the user's click produces and,
	 * with the pass now automatic, the same word on a control nobody pressed made
	 * the two states indistinguishable from the surface. It is the TUI's own
	 * vocabulary for the same distinction (`tui/app.py`'s picker footer reads
	 * `checking providers…` while its automatic fetch runs), shortened to the
	 * reserved width below: the reserve is the IDLE label's width, so a busy label
	 * that outgrew it would put the row's reflow back - measured, 12px on the link
	 * beside it - which is the defect the reserve exists to remove (design D1).
	 */
	const refreshing = live && catalogue.isFetching;
	const [asked, setAsked] = useState(false);
	useEffect(() => {
		if (!catalogue.isFetching) setAsked(false);
	}, [catalogue.isFetching]);
	const refreshingLabel = asked
		? t("ui.chat.pickers.destination_pickers.refreshing")
		: t("ui.chat.pickers.destination_pickers.checking");
	const command = useSessionCommand(sessionId);
	/*
	 * A DRAFT pane's own reading, from the ONE query the pane itself reads.
	 *
	 * Same key, same fetch: React Query serves the composer's strip and this
	 * dialog from a single cache entry, so the list's ✓, the header sentence and
	 * the readings behind the dialog cannot describe three different models. It
	 * is mounted (disabled) in session mode because hooks cannot be conditional.
	 */
	const draftPick = useDraftPick(draft, note);
	/*
	 * Keyed on the hook's target rather than on the pane's own prop: the prop is the
	 * snapshot this dialog opened on, so a pick would otherwise leave this dialog's
	 * reading — the window, the price pair, the ladder and the row it marks —
	 * resolved for the model BEFORE the pick (review round 1, R2).
	 */
	const draftPreview = useQuery({
		...draftPreviewQuery(
			draftPick.target ?? NO_DRAFT_TARGET,
			draftPick.carriesFast,
		),
		enabled: Boolean(draft),
	});
	const persist = useOperation();
	const [persistDefault, setPersistDefault] = useState(false);
	/*
	 * The checkbox's value as the pick's continuation reads it, and whether a
	 * switch is still in flight. A ref rather than the state above because the
	 * pick awaits the owner for 1.1-4.2 s: a tick made during that wait must reach
	 * the continuation that is already running, and a closure holds the value it
	 * was created with. `switching` tells the tick handler that the continuation
	 * will do the write, so the default is saved once, for the model just picked.
	 */
	const persistDefaultRef = useRef(false);
	const switching = useRef(false);
	/*
	 * The model this dialog last saved as the default (state for the label, a
	 * ref for a pick's continuation), and the queue default writes run through.
	 * The effort dialog keeps the same three; its comments carry the reasons.
	 */
	const [savedModel, setSavedModel] = useState<string | null>(null);
	const savedModelRef = useRef<string | null>(null);
	const defaultWrites = useRef<Promise<void>>(Promise.resolve());
	/*
	 * A saved default, named the way its row is: `Claude Sonnet 5`, not
	 * `anthropic/claude-sonnet-5`. The selector in a sentence wrapped at its
	 * hyphens, mid-id, in the default 576 px dialog (UX round 2, U10). A model
	 * the drawn catalogue does not list keeps its selector, which is still true.
	 */
	const modelName = useCallback(
		(selector: string) => {
			const row = (
				catalogueDocument?.models as CatalogueRow[] | undefined
			)?.find((candidate) => selectorOf(candidate) === selector);
			return row?.label || selector;
		},
		[catalogueDocument],
	);
	const selected =
		runningFrontend(canonical)?.effective_model ??
		runningFrontend(canonical)?.selected_model;
	/*
	 * Both halves must be non-empty to name a model, and the guard is the shared
	 * selector rather than a local expression: a session frame can carry a spec
	 * whose provider or model_id is an empty string, and interpolating that
	 * produced the description "This session runs /." (design D9). The hook's
	 * pending-model reconciliation uses the same function, so "the same model"
	 * means one string in both places.
	 */
	const currentSelector = modelSelector(selected);
	/*
	 * The one answer this dialog gives to "which model is this session on?"
	 * (UX U7).
	 *
	 * The ✓ and the header sentence read DIFFERENT fields until this line existed:
	 * the ✓ followed the receipt (`pickedCurrent`, the QA Q2 fix) while the
	 * sentence interpolated `selected_model` alone, which is the field Q2's own
	 * comment documents as arriving several seconds later. So for the whole window
	 * in which the owner's frame lagged a successful switch, the dialog
	 * contradicted itself — the strip, the band and the row mark all named the new
	 * model while its own header still claimed the old one. UX measured it over 100
	 * samples and 15.4 s and it never resolved.
	 *
	 * One binding, read by both call sites, is what makes that impossible rather
	 * than merely unlikely: the optimistic pick until the owner's own frame agrees
	 * with it, the owner's selector otherwise. The band still reads
	 * `effective_model` first (`bandReadings`), because it is describing what the
	 * session RUNS rather than which row the picker marks.
	 *
	 * A DRAFT pane has no owner frame to reconcile against, so it reads the
	 * backend's own answer to `sessions.preview` — the resolution the first turn
	 * will get — and nothing else. That is what makes the ✓ on a draft name a model
	 * the backend has already confirmed rather than the row that was clicked.
	 */
	const draftFrontend = draft ? draftPreview.data?.snapshot : undefined;
	/*
	 * The draft's answer comes from `bandReadings` — the SAME function the strip
	 * prints through — rather than from a second reading of the same two fields in
	 * the opposite order (review round 1, R4). One precedence, one place: the chip
	 * the user is looking at and the header line they are about to act on can no
	 * longer name different models, and a change to which field wins reaches both.
	 * The session branch keeps its own selector, which is a different fact: it says
	 * which row this picker MARKS, not what the session runs.
	 */
	const shownSelector = draft
		? modelSelector(bandReadings(draftFrontend, null).identity)
		: (pickedCurrent ?? currentSelector);

	/*
	 * The catalogue row's own auth state, by selector.
	 *
	 * One map, read by the row builder below (`group`), by the scope union and
	 * by the pick itself, so the label the user reads, the rows the filter keeps
	 * and the outcome a pick produces cannot disagree.
	 *
	 * BUILT FROM THE DOCUMENT, NOT THE SCOPED VIEW, and that is what makes a
	 * needs-sign-in pick answerable at all: under the default `usable` scope
	 * those rows are filtered out, and the moment the user reveals them the map
	 * has to know what they are.
	 */
	const rowAuth = useMemo(() => {
		const known = catalogueDocument?.credentials_known !== false;
		const map = new Map<string, RowAuth>();
		for (const row of (catalogueDocument?.models ?? []) as CatalogueRow[]) {
			map.set(selectorOf(row), rowAuthOf(row, known));
		}
		return map;
	}, [catalogueDocument]);

	/*
	 * The rows this dialog may list, and the signals the scope control reads
	 * (see `scopeCatalogue`, the one place the rule lives: a new backend filters
	 * server-side and reports what it did, an old one answers with everything
	 * and THIS client filters instead, without a count).
	 */
	const scoped = useMemo(
		() => scopeCatalogue(catalogueDocument, scope, shownSelector),
		[catalogueDocument, scope, shownSelector],
	);

	const selectedDetails = scoped.rows.find(
		(row) => selectorOf(row) === shownSelector,
	);
	const options = useMemo<PickerOption[]>(() => {
		// t() reads at call time; locale is therefore a real invalidation input.
		void locale;
		// `connected` is also true when the credential store could not be read,
		// which is why every model once sat under "Connected" on a fixture with
		// no credentials at all (D5). With that unknown, the picker still lists
		// everything -- an empty model list would be a worse lie -- but it stops
		// claiming an auth state it does not have.
		const known = catalogueDocument?.credentials_known !== false;
		return modelPickerOptions(scoped.rows as CatalogueRow[], {
			credentialsKnown: known,
			shownSelector,
		});
	}, [catalogueDocument, scoped, shownSelector, locale]);

	/*
	 * The listing call takes the provenance `drawnCatalogue` decided above — one
	 * place pairs the document with its sentence, so the note cannot keep its
	 * text while describing a different document (round 1 R1-2's fallback,
	 * round 2 code review R2-1, agent review round 2 M1).
	 */
	const listing = catalogueListing(
		catalogueDocument,
		catalogue,
		errorText,
		drawn.drawnFromRegistry,
	);

	/*
	 * The scope control's two signals, and the control itself.
	 *
	 * SHOWN only when there is something to reveal — `hidden > 0` from the wire,
	 * or rows THIS client dropped — plus whenever it is already checked, so the
	 * user can always put the list back. A checkbox that toggles between two
	 * identical lists is the do-nothing-control class design D13 filed: a
	 * control that looks enabled has to DO something.
	 *
	 * THE COUNT IS PRINTED ONLY OFF THE WIRE (see `scopeCatalogue` on why the
	 * client's own filter does not manufacture one), and while the wider answer
	 * is loading the previous document's number is still what the control says —
	 * it was true when it was fetched, and the rows on screen still match it.
	 */
	const hiddenOnWire = scoped.hidden;
	/*
	 * THE NUMBER KEPT WHILE THE WIDER LIST IS SHOWN.
	 *
	 * The `all` document has no count of its own (the backend reports `hidden`
	 * on a `usable` answer), so a label read off the current document alone
	 * would drop the number the moment the user pressed the control — and the
	 * number is still TRUE of the list below ("2 of these need sign-in"). The
	 * last wire count is therefore kept for as long as the dialog lives, and
	 * serves the label whenever the document in hand cannot.
	 */
	const [lastHidden, setLastHidden] = useState<number | null>(null);
	useEffect(() => {
		if (hiddenOnWire !== null) setLastHidden(hiddenOnWire);
	}, [hiddenOnWire]);
	/*
	 * R1-3's refresh half (M4: from the SAME source the number came from): the
	 * observer above is the live `usable` entry while the wider list is shown —
	 * exactly what the default view's number was read off — so a
	 * credential-change invalidation refetches the document the count comes from,
	 * and the refreshed `hidden` lands here without the user having to untick the
	 * control. A `usable` answer's number describes the rows exactly when it is
	 * fetched — after a sign-in it drops, and the label that says "2 need
	 * sign-in" stops being true of a list where one of them just connected.
	 */
	useEffect(() => {
		const hidden = usableDocument.data?.hidden;
		if (typeof hidden === "number") setLastHidden(hidden);
	}, [usableDocument.data]);
	const scopeCount = hiddenOnWire ?? lastHidden;
	const scopeControl =
		showAll || scoped.removed > 0 || (scopeCount !== null && scopeCount > 0) ? (
			<PickerCheck checked={showAll} onCheckedChange={setShowAll} tone="muted">
				{scopeCount !== null && scopeCount > 0
					? t(
							"ui.chat.pickers.destination_pickers.show_all_supported_models_sign_in",
							{ scopecount: scopeCount },
						)
					: t("ui.chat.pickers.destination_pickers.show_all_supported_models")}
			</PickerCheck>
		) : null;

	/*
	 * What the dialog says, and offers, when the scoped list is EMPTY.
	 *
	 * The state the operator's report is about reads as a list here — nothing
	 * that can run is signed in — and a list of nothing with no way out is the
	 * dead end the empty-state requirement names. So the body states the fact
	 * and offers `Connect a provider`: the SAME connect dialog every other
	 * connect surface opens (`useConnectProviderStore`), never a second flow.
	 *
	 * A PARTIAL LISTING FAILURE IS NOT THIS STATE: when providers did not
	 * answer, the note above the body says so, and a connect button would send
	 * the user to fix a sign-in that is not the problem — `listing.notice` is
	 * exactly that half, so its presence withholds the offer.
	 */
	const emptyOffersConnect = options.length === 0 && listing.notice === null;

	/*
	 * ONE write of the machine default, for every route that asks for it: a tick
	 * after (or without) a pick, and a pick made with the box already ticked. The
	 * strip line and the composer note are this function's, so the routes cannot
	 * report the same write two ways.
	 */
	const saveModelDefault = useCallback(
		(model: { provider: string; model_id: string }) => {
			/*
			 * Chained, as the effort dialog's are: the last write asked for is the
			 * last write config.yml sees, whatever order the answers come back in
			 * (UX round 1, U2).
			 */
			const write = defaultWrites.current.then(async () => {
				const saved = await persist.perform(
					async () => {
						try {
							await writeModelDefaultSettings(model, (key, settingValue) =>
								desktopResult({
									op: "settings.edit",
									key,
									value: settingValue,
								}),
							);
							return `${model.provider}/${model.model_id}`;
						} catch (error) {
							/*
							 * The default write is a DIFFERENT operation from the switch, and it
							 * has its own result: on the one path where the switch succeeded
							 * and the default failed, the failure lived only in the dialog's
							 * strip, so closing the dialog — the only way out of it — dropped
							 * it (reviewer round 1, minor 4). Written here, at the moment it is
							 * known, in the same words the strip uses, and it does NOT claim the
							 * model was unchanged when only the default was not saved.
							 */
							note(`${DEFAULT_SAVE_FAILURE()}: ${errorText(error)}`, true);
							throw error;
						}
					},
					// Named as the label names it (QA round 3, Q4; UX U10).
					(selector) => ({
						tone: "success",
						text: t(
							"ui.chat.pickers.destination_pickers.default_for_new_sessions",
							{ modelname: modelName(selector) },
						),
					}),
					DEFAULT_SAVE_FAILURE(),
				);
				if (saved === null) {
					// Untick so ticking again is the retry (UX round 1, U3).
					persistDefaultRef.current = false;
					setPersistDefault(false);
					return;
				}
				savedModelRef.current = saved;
				setSavedModel(saved);
			});
			defaultWrites.current = write.catch(() => undefined);
			return write;
		},
		[persist.perform, note, modelName],
	);

	const onPick = useCallback(
		async (value: string, option: PickerOption) => {
			const [provider, ...rest] = value.split("/");
			const modelId = rest.join("/");
			/*
			 * A ROW THAT NEEDS SIGN-IN IS NOT SWITCHED TO — it starts the sign-in
			 * that makes it runnable.
			 *
			 * The old behaviour switched the session onto the model and then warned
			 * it could not answer (QA Q1's after-the-fact caveat), which left the
			 * session pinned to a model that refuses every turn — exactly the
			 * stranded state this change exists to remove. The rule mirrors the TUI,
			 * where Enter on such a row already runs `/login`: the pick becomes the
			 * Connect gesture, the model is untouched, and the dialog opened here is
			 * the SAME connect flow every other connect surface opens
			 * (`useConnectProviderStore`), pre-focused on this row's provider. The
			 * credential landing invalidates the catalogue
			 * (`provider-detail.tsx`), so the rows refresh under the dialog and the
			 * row the user wanted becomes a switchable one.
			 *
			 * Only a KNOWN store can say `needs-sign-in`: with the store unreadable
			 * the state is `unknown`, which keeps the switch-the-row behaviour rather
			 * than inventing a sign-in the evidence cannot support.
			 */
			if (rowAuth.get(value) === "needs-sign-in") {
				useConnectProviderStore
					.getState()
					.openConnect({ providerId: provider });
				return;
			}
			if (draft) {
				/*
				 * A DRAFT pane's pick is not a command and has no owner to switch.
				 *
				 * The rung cannot ride the request as "keep whatever was there":
				 * `reasoning_effort` is a level on THIS selection and `null` is "no rung
				 * chosen", which resolves to the new model's own default. So a user who
				 * chose `high` and then changed model used to get a first turn at a
				 * different level AND a different cost from the one they configured,
				 * while every on-screen signal - the confirmation, the chip, the tooltip
				 * - told them the pick had simply succeeded (UX U1, design D7: the same
				 * defect read from the copy side).
				 *
				 * The check itself lives in `pick`, deliberately: it has to be inside the
				 * dialog's busy window and it has to be able to REFUSE the pick, neither
				 * of which a caller can arrange (see `reading.carry`). What this call
				 * states is the question - the level the pane's own pick holds - and what
				 * a check that cannot be made says.
				 */
				/*
				 * The question is the level THIS DIALOG's selection holds, not the one
				 * the pane opened on (review round 5, M1).
				 *
				 * `draft.target` is the snapshot the dialog mounted with and does not
				 * move when the pane does - the hook says so itself, and remembers every
				 * pick precisely because of it. Read from the snapshot, a second pick in
				 * the SAME open dialog asked to carry a rung the first pick had already
				 * dropped - the ladder does not offer it, so the pane holds none - and
				 * the back end resolved the second model at a level the pane was no
				 * longer showing. `draftPick.selection` is the live receipt
				 * (`picked ?? draft.target.model`), advanced by every pick.
				 */
				const carried = carriedRung(draftPick.selection);
				/*
				 * AND THE DIAL THE PANE HOLDS, for the same reason (agent review round
				 * 1, F2; design review round 1, D1). The pick below is a fresh
				 * selection - a new model has its own ladder and its own fast tier -
				 * so it carries no `fast_mode`, and before this the user who had just
				 * set `/fast` On learned about the reset only from a chip badge that
				 * disappeared. Read from the LIVE selection, like the rung: this
				 * dialog's own receipt, not the snapshot it opened on.
				 */
				const carriedFast = draftPick.selection?.fast_mode ?? null;
				await draftPick.pick(
					{ provider, model_id: modelId, reasoning_effort: null },
					{
						describe: (resolved) =>
							t(
								"ui.chat.pickers.destination_pickers.this_conversation_will_run",
								{
									selectorofresolution: selectorOfResolution(
										resolved,
										option.label,
									),
								},
							),
						/*
						 * The dial's clause is a NOTICE rather than part of `describe`
						 * (design review round 2, D6). `pick` appends it after whichever
						 * base sentence wins, so the carry branch - which never runs
						 * `describe` - states it too. The dial is still read off the
						 * RESOLUTION (the model the first turn will actually run), so a
						 * model with no fast tier says that instead of claiming an `off`
						 * dial it does not have; see `fastModelPickNotice`.
						 */
						notice: (resolved) =>
							fastModelPickNotice(
								carriedFast,
								fastModeState(bandReadings(resolved.snapshot, null).identity),
							),
						carry: carried,
						refused: t(
							"ui.chat.pickers.destination_pickers.the_model_was_not_changed",
						),
					},
				);
				return;
			}
			/*
			 * U1: paint the chosen model in the session status band BEFORE awaiting
			 * the owner. A switch that pays a cold runtime bind measures 1.1-4.2 s, and
			 * the authoritative `frontend.update` frame lands 3-6 ms before the HTTP
			 * receipt when the owner is warm — but a delayed or lost frame must not
			 * leave the user with no acknowledgement at all. The paint is a PENDING
			 * value, not a claimed one: the hook drops it the moment an authoritative
			 * frame names this model, and the picker drops it on a refusal below.
			 *
			 * The model is assembled from the selector the row carried, so the paint
			 * cannot name a model the catalogue did not offer.
			 */
			const model: CanonicalModel = {
				provider,
				model_id: modelId,
				display_name: option.label,
			};
			canonical.paintPendingModel(model);
			switching.current = true;
			let run: Awaited<ReturnType<typeof command.run>>;
			try {
				run = await command.run("model", value);
			} finally {
				switching.current = false;
			}
			const { outcome, result: failure } = run;
			if (!outcome || isNativeAction(outcome) || outcome.kind === "error") {
				// The owner refused (or the call itself failed): the band goes back to
				// the authoritative model rather than keeping a paint that never landed.
				canonical.clearPendingModel();
				/*
				 * And the failure is reported WHEREVER it lands (UX U2).
				 *
				 * It used to be written only on the dialog's close edge, which reads
				 * `command.result` at that instant — so closing during the wait (the
				 * natural response to a 1.1-4.2 s bind, and exactly when the dialog is
				 * most likely to be dismissed) left nothing behind when the refusal
				 * arrived: only a silent band revert. The composer's note path is not
				 * the dialog's, so it is still there to write to; the sentence is the
				 * strip's own, from the same call's result, so the two never disagree.
				 */
				note(
					t(
						"ui.chat.pickers.destination_pickers.the_model_was_not_changed6dd4bb",
						{ text: failure.text },
					),
					true,
				);
				/*
				 * A ticked box under a failed switch says what the default is now,
				 * rather than nothing (review round 1, m2).
				 */
				if (persistDefaultRef.current) {
					const saved = savedModelRef.current;
					persist.setResult({
						tone: failure.tone,
						// Named as the ticked label names it, so the two agree (UX U10).
						text: saved
							? t(
									"ui.chat.pickers.destination_pickers.model_not_changed_default_for_new_sessions_stays",
									{ modelname: modelName(saved) },
								)
							: `${DEFAULT_SAVE_FAILURE()}.`,
					});
				}
				return;
			}
			// The switch landed: mark the picked row in force at once rather than
			// waiting out the owner's next frame (QA Q2).
			setPickedCurrent(value);
			if (persistDefaultRef.current) {
				// Explicit default scope: the session change above is the owner's;
				// the default is the typed settings key, written only on request.
				await saveModelDefault({ provider, model_id: modelId });
			}
		},
		[
			canonical,
			command,
			note,
			rowAuth,
			draft,
			draftPick.pick,
			/*
			 * The carry QUESTION is read from the live selection (review round 5, M1),
			 * so the memo has to see it move - the whole defect was a question answered
			 * from a value that does not.
			 */
			draftPick.selection,
			saveModelDefault,
			persist.setResult,
			modelName,
		],
	);

	/*
	 * The tick is a request about the model IN FORCE, whenever it is made. It used
	 * to be read only at the moment of a pick, so the order the operator actually
	 * used - switch first, then tick - and a tick on a dialog opened only to make
	 * the current model the default both wrote nothing, while the label said "This
	 * pick also sets the default". A tick now saves the row marked current (the
	 * receipt-confirmed pick, else the session's own model) unless a switch is in
	 * flight, whose continuation reads the ref and saves the model it lands on.
	 * Unticking writes nothing: a saved default stays saved, as it would from
	 * Settings.
	 */
	/*
	 * The model in force, as the row marked current names it. The tick AND "Set
	 * current model as default" save this one value, so the two controls cannot
	 * save different models right after a pick (review round 1, n1; UX U8).
	 */
	const [shownProvider, ...shownRest] = (shownSelector ?? "").split("/");
	const modelInForce = activeModelForDefault({
		provider: shownProvider,
		model_id: shownRest.join("/"),
	});
	/*
	 * The ticked label's wordings, all three, so the label is laid out at the
	 * tallest from the first paint (UX round 2, U9). The saved wording names the
	 * model a tick would save until one is saved.
	 */
	const persistWordings = [
		t(
			"ui.chat.pickers.destination_pickers.also_make_this_the_default_for_new_sessions",
		),
		t(
			"ui.chat.pickers.destination_pickers.picks_here_also_set_the_default_for_new_sessions",
		),
		t(
			"ui.chat.pickers.destination_pickers.default_for_new_sessions_picks_here_update_it_too",
			{
				modelname: modelName(
					savedModel ??
						(modelInForce
							? `${modelInForce.provider}/${modelInForce.model_id}`
							: ""),
				),
			},
		),
	] as const;
	const onPersistDefaultChange = (checked: boolean) => {
		persistDefaultRef.current = checked;
		setPersistDefault(checked);
		if (!checked) {
			// An untick writes nothing; the last save's line goes with it (UX U4).
			persist.setResult(null);
			return;
		}
		if (switching.current) return;
		if (modelInForce) void saveModelDefault(modelInForce);
	};

	/*
	 * A saved default is the TICKED LABEL's to state, and the strip printed the
	 * same sentence under it (UX round 2, U11). It also grew the dialog by a line
	 * on a tick, which moved the rows under the pointer (U9). The strip keeps
	 * what the label cannot say: a failed save, a refusal, and the button's save
	 * while the box is unticked.
	 */
	const persistLine =
		persist.result?.tone === "success" && persistDefault
			? null
			: persist.result;
	const pickResult: PickerResult | null = persistLine
		? {
				...persistLine,
				text: [command.result?.text, persistLine.text]
					.filter(Boolean)
					.join("\n"),
			}
		: command.result;

	/*
	 * Closing is not cancelling, and it is no longer the moment a failure is
	 * written: the outcome carries its own note the moment it lands, so that it
	 * surfaces whether or not this dialog is still open (UX U2). The comment that
	 * used to sit here described the close-edge write that caused the gap.
	 */

	/*
	 * The check mark follows the switch, not the next owner frame (QA Q2).
	 *
	 * The receipt is evidence the switch landed; the frame that moves
	 * `selected_model` can arrive several seconds later, and until it does the ✓
	 * sat on the model the user just left while the band and the strip named the
	 * new one — and, before UX U7, the header sentence with them.
	 *
	 * It is dropped on AGREEMENT, and deliberately not on any disagreement: a frame
	 * that still names the model we left IS the lag this state exists for, so
	 * clearing on difference would put the ✓ back on the old row until the frame
	 * arrived, which is the defect QA Q2 filed. The price is narrow and stated
	 * rather than implied: an owner frame naming a THIRD model while the dialog is
	 * open — the same session driven from another window — leaves the receipt's
	 * mark preferred until the dialog is re-opened (a fresh mount reads the owner's
	 * answer). Telling that frame from the lag needs the pre-pick selector kept
	 * beside the pick, i.e. a change to the arbitration this head's QA round
	 * verified, so it is deferred in the PR rather than folded in here (reviewer
	 * round 2, nit 2; UX U7's shared binding does not reach it).
	 */
	useEffect(() => {
		if (pickedCurrent && currentSelector === pickedCurrent) {
			setPickedCurrent(null);
		}
	}, [currentSelector, pickedCurrent]);

	return (
		<PickerHost
			open
			onClose={onClose}
			/*
			 * The scope this pick applies to, and it has to be visible: the checkbox
			 * changes what the pick DOES, and a label identical in both states only
			 * told the user that after the fact (design D7). Ticked, the label states
			 * the consequence for THIS pick rather than describing a general option.
			 */
			title={t("ui.chat.pickers.models.title")}
			description={
				draft
					? shownSelector
						? t(
								"ui.chat.pickers.destination_pickers.this_conversation_starts_on_and_keeps_running_on_it_choosing_another_cha",
								{ shownselector: shownSelector },
							)
						: /*
							 * No claim about what the model in force is NOT (design D18).
							 *
							 * "It is not your default" was false in the state this sentence
							 * renders - nothing is picked, so the model that will run IS the
							 * machine's default - and false again for any pick equal to it,
							 * which is the likeliest pick in a list whose first row is the
							 * default. The reassurance the clause exists for is the half that
							 * is true in every state, and it is the half the resolved branch
							 * above already writes.
							 */
							t(
								"ui.chat.pickers.destination_pickers.choose_the_model_this_conversation_starts_on_and_keeps_running_on_your_d",
							)
					: shownSelector
						? t(
								"ui.chat.pickers.destination_pickers.this_session_runs_choosing_another_applies_to_this_session_only_unless_y",
								{ shownselector: shownSelector },
							)
						: t(
								"ui.chat.pickers.destination_pickers.choose_the_model_for_this_session",
							)
			}
			options={options}
			/*
			 * The model picker's own search rule: the catalogue's ids are not strings
			 * the user wrote, so the shared contiguous test is too narrow for them and
			 * widening it for everyone is what broke **Search commands** (R1-3). The
			 * rule and its reasoning live in `model-picker-match.ts`.
			 */
			matcher={matchModelPickerOptions}
			loading={catalogue.isLoading && !catalogueDocument}
			loadError={listing.loadError}
			notice={listing.notice}
			noticeDetail={listing.noticeDetail}
			emptyText={
				emptyOffersConnect
					? t("ui.chat.pickers.destination_pickers.no_models_are_signed_in_yet")
					: undefined
			}
			emptyAction={
				emptyOffersConnect ? (
					<Button
						variant="secondary"
						size="sm"
						type="button"
						onClick={() => useConnectProviderStore.getState().openConnect()}
					>
						{t("ui.chat.pickers.models.connect_provider")}
					</Button>
				) : undefined
			}
			searchPlaceholder={t("ui.chat.pickers.destination_pickers.search_models")}
			// Detail stays on the selected model, not every list row. These are
			// provider-stated facts, not a claim of entitlement or future billing.
			form={
				selectedDetails?.provider === "meta-muse" ? (
					<div className="grid gap-1 text-body-sm" data-model-native-details>
						{/* Name the model these facts belong to: unlabelled, the block
						 * floated under "Nothing matches." or beside an unrelated last
						 * row while describing the in-force selection (design round 1
						 * D1 / UX round 1 U2). Same label the row shows, so the two
						 * cannot disagree. */}
						<p className="text-ink-muted text-meta">
							{t("ui.chat.pickers.models.native_details", {
								name: selectedDetails.label || selectedDetails.model_id,
							})}
						</p>
						<PickerKeyValue
							label={t("ui.chat.pickers.destination_pickers.context")}
							value={
								selectedDetails.context_window > 0
									? selectedDetails.context_window.toLocaleString()
									: t("ui.chat.pickers.destination_pickers.unknown")
							}
						/>
						<PickerKeyValue
							label={t("ui.chat.pickers.destination_pickers.output_limit")}
							value={
								selectedDetails.max_output_tokens &&
								selectedDetails.max_output_tokens > 0
									? selectedDetails.max_output_tokens.toLocaleString()
									: t("ui.chat.pickers.destination_pickers.unknown")
							}
						/>
						{selectedDetails.family && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.family")}
								value={selectedDetails.family}
								mono={false}
							/>
						)}
						{selectedDetails.release_date && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.released")}
								value={selectedDetails.release_date}
								mono={false}
							/>
						)}
						{typeof selectedDetails.supports_tools === "boolean" && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.tools")}
								value={
									selectedDetails.supports_tools
										? t("ui.chat.pickers.destination_pickers.supported")
										: t("ui.chat.pickers.destination_pickers.not_supported")
								}
								mono={false}
							/>
						)}
						{typeof selectedDetails.reasoning === "boolean" && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.reasoning")}
								value={
									selectedDetails.reasoning
										? selectedDetails.reasoning_efforts?.join(", ") ||
											t("ui.chat.pickers.destination_pickers.supported")
										: t("ui.chat.pickers.destination_pickers.not_supported")
								}
								mono={false}
							/>
						)}
						{selectedDetails.reasoning_default_effort && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.default_effort")}
								value={selectedDetails.reasoning_default_effort}
								mono={false}
							/>
						)}
						{selectedDetails.modalities?.input?.length ? (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.native_inputs")}
								value={selectedDetails.modalities.input.join(", ")}
								mono={false}
							/>
						) : null}
						{selectedDetails.modalities?.output?.length ? (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.native_outputs")}
								value={selectedDetails.modalities.output.join(", ")}
								mono={false}
							/>
						) : null}
					</div>
				) : undefined
			}
			onPick={onPick}
			busy={draft ? draftPick.busy : command.busy || persist.busy}
			/*
			 * The in-flight copy names the change, not the machinery: the user asked
			 * whether their pick registered, and "the backend" is the
			 * implementation's noun for their session (design D14, UX nit).
			 *
			 * On a draft the engine is a RESOLUTION rather than a switch, because
			 * nothing is running yet: the sentence may not promise a switch that has
			 * not happened.
			 */
			/*
			 * A default save is not a switch, so its wait says what it is doing
			 * (UX round 1, U3).
			 */
			busyText={
				draft
					? t("ui.chat.pickers.destination_pickers.resolving_the_model")
					: command.busy
						? t("ui.chat.pickers.destination_pickers.switching_the_model")
						: t("ui.chat.pickers.destination_pickers.saving_the_default")
			}
			busyLabel={
				draft
					? t("ui.chat.pickers.destination_pickers.resolving_the_model24577b")
					: command.busy
						? t("ui.chat.pickers.destination_pickers.switching_the_model8e7138")
						: t("ui.chat.pickers.destination_pickers.saving_the_default9573f2")
			}
			result={draft ? draftPick.result : pickResult}
			toolbar={
				/*
				 * A draft's toolbar has no default checkbox, and that is the whole of
				 * requirement 3 rather than a copy decision: `settings.edit` writes the
				 * MACHINE's hosting and model_name, and a new-conversation pane's pick is
				 * this conversation's first turn. Offering the write here would put a
				 * global change behind a per-conversation control. The session's picker
				 * keeps it, where "this session vs the default" is the actual question.
				 */
				<div
					className={cn(
						"flex gap-3",
						/*
						 * `items-start` only once the scope control is there.
						 *
						 * The control puts a second line under the default checkbox, and a
						 * row of buttons centred against a two-line block reads as float
						 * rather than as alignment. WITHOUT the control the row is the one
						 * line per side it has always been, and it renders exactly as it did
						 * before this change — the frames, state by state, are the check: an
						 * alignment nudge in a state this change does not enter is a delta
						 * nobody asked for.
						 */
						/*
						 * The control also always takes the left end, in every mode: a draft
						 * pane has no persist checkbox, so the base layout right-aligned its
						 * buttons there; with a control beside them the row is a two-sided
						 * one again.
						 */
						draft && !scopeControl ? "justify-end" : "justify-between",
						scopeControl ? "items-start" : "items-center",
					)}
				>
					{/*
					 * The list controls on the LEFT: the default-scope checkbox (session
					 * mode only) and the scope control, which every mode carries because
					 * the LIST is what it changes. Wrapping keeps the narrow dialog's
					 * toolbar readable rather than letting one long label push the
					 * refresh control off the row.
					 */}
					<div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
						{!draft && (
							<PickerCheck
								checked={persistDefault}
								onCheckedChange={onPersistDefaultChange}
								tone="muted"
							>
								{/*
								 * Ticked, the label states what is saved rather than promising
								 * a pick that may never happen (UX round 1, U5).
								 */}
								<ReservedLabelText
									capped
									wordings={persistWordings}
									text={
										!persistDefault
											? persistWordings[0]
											: savedModel
												? persistWordings[2]
												: persistWordings[1]
									}
								/>
							</PickerCheck>
						)}
						{scopeControl}
					</div>
					<div className="flex items-center gap-2">
						{!draft && (
							<Button
								variant="ghost"
								size="sm"
								type="button"
								disabled={!modelInForce || command.busy || persist.busy}
								onClick={() => {
									if (modelInForce) void saveModelDefault(modelInForce);
								}}
							>
								{t("ui.chat.pickers.models.set_as_default")}
							</Button>
						)}
						<Button
							variant="ghost"
							size="sm"
							type="button"
							/*
							 * A control that looks enabled has to DO something (design D13).
							 *
							 * Settled, this used to read `Live list` and its click set `live` to a
							 * value it already had — a second click changed nothing and said
							 * nothing, while the button kept the idle control's ink and weight, so it
							 * was indistinguishable from one that works. It keeps its verb instead
							 * and re-lists when pressed; the row count under it is what says the
							 * listing came from the providers.
							 *
							 * The picker now promotes itself to the live listing once the registry
							 * read SETTLES, so the settled state is the common one and
							 * `setLive(true)` is the pre-promotion window alone (a click landed
							 * inside the first paint's tick). Both paths stay: the button has to
							 * re-list whether or not the automatic listing has already run.
							 */
							onClick={() => {
								// The label distinguishes this from the automatic pass (design D2,
								// UX U4): the click is the ask, the promotion is not.
								setAsked(true);
								if (live) void catalogue.refetch();
								else setLive(true);
							}}
							disabled={catalogue.isFetching}
							/*
							 * A RESERVED WIDTH for the slot the label changes inside (design D1).
							 *
							 * The label swap is not a text change in place: with the row laid out
							 * `justify-between`, the narrower busy label let every control to its
							 * left slide. Measured on this change's own frames: `Set current model as
							 * default` sat at x 389-551 settled and x 427-589 in flight - a 38px
							 * shift under a pointer that is not moving, twice per open, and again on
							 * every cadence tick.
							 *
							 * 149px IS THE IDLE LABEL'S OWN BOX, read off the DOM rather than off a
							 * frame: in the served story the control is 149 wide settled, 132 in
							 * flight and 132 while the user's click is out - i.e. `Refreshing…` and
							 * `Checking…` are both NARROWER than the reserve, so the slot's edges do
							 * not move and the click target stays where the user aimed it. (132 was
							 * the first attempt, taken from the text's ink in the frames rather than
							 * from the box: it left a 17px shift, because the idle label's box is
							 * wider than its glyphs.)
							 *
							 * `min-w` rather than a fixed `w`: a theme with wider type is free to
							 * grow the control rather than truncate it.
							 */
							className="min-w-[149px]"
						>
							{refreshing ? (
								<span className="flex items-center gap-2">
									<Spinner size="xs" />
									{refreshingLabel}
								</span>
							) : (
								t("ui.chat.pickers.destination_pickers.refresh_from_providers")
							)}
						</Button>
					</div>
				</div>
			}
		/>
	);
};

// ----------------------------------------------------------------- effort

export const EffortPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	draft,
	note,
}) => {
	useI18nLocale();
	/*
	 * A session's rungs come from the owner (`command-entities?command=effort`),
	 * which is the list `/effort <rung>` itself validates against. A DRAFT pane has
	 * no owner to ask, so its rungs come from the ONE resolution the pane is already
	 * showing — `sessions.preview` for its selection — which is the same spec its
	 * chip reads. One source per state, both the backend's: nothing here computes a
	 * ladder, and there is no second list to disagree with the chip.
	 */
	const entities = useEntities<{ value: string }>(
		sessionId,
		"effort",
		undefined,
		!draft,
	);
	const command = useSessionCommand(sessionId);
	const draftPick = useDraftPick(draft, note);
	const defaultSetting = useOperation();
	const [saveAsDefault, setSaveAsDefault] = useState(false);
	/*
	 * The same two refs the model dialog keeps, for the same reason: the pick's
	 * continuation runs after the owner answers, so it must read the checkbox as it
	 * is THEN, and a tick made while a switch is in flight leaves the write to that
	 * continuation rather than saving the rung the switch is about to replace.
	 */
	const saveAsDefaultRef = useRef(false);
	const switching = useRef(false);
	/*
	 * The rung the owner ACCEPTED in this dialog. The entity list's `current` is a
	 * cached read (15 s stale time) that a pick does not refetch, so after a switch
	 * it still names the rung the session just left - and that is the rung a tick
	 * would otherwise save.
	 */
	const [acceptedRung, setAcceptedRung] = useState<string | null>(null);
	/*
	 * The rung this dialog last SAVED as the default, in state for the ticked
	 * label and in a ref for a pick's continuation, which outlives the render it
	 * was created in. It is what a refused pick reports as still saved: after a
	 * tick saved High, "The effort default was not saved" was false - config.yml
	 * held the High the tick had just written (review round 1, m1).
	 */
	const [savedRung, setSavedRung] = useState<string | null>(null);
	const savedRungRef = useRef<string | null>(null);
	/*
	 * Default writes run one after another, in the order they were asked for, so
	 * the last one asked for is the last one config.yml sees. The host already
	 * refuses a pick while a save is pending (`busy`), which is what keeps a tick's
	 * save and a pick's save from overlapping today; the chain keeps the order
	 * true without relying on that gate (UX round 1, U2).
	 */
	const defaultWrites = useRef<Promise<void>>(Promise.resolve());
	const saveEffortDefault = useCallback(
		(value: string) => {
			const write = defaultWrites.current.then(async () => {
				const saved = await defaultSetting.perform(
					() =>
						desktopResult({
							op: "settings.edit",
							key: "model_effort",
							value,
						}),
					() => ({
						tone: "success",
						text: t(
							"ui.chat.pickers.destination_pickers.default_effort_for_new_sessions",
							{ effortdisplay: effortDisplay(value) },
						),
					}),
					t(
						"ui.chat.pickers.destination_pickers.the_effort_default_was_not_saved6143e6",
					),
				);
				if (!saved) {
					// Untick on failure so ticking again IS the retry; a box left ticked
					// under "not saved" needed an untick first (UX round 1, U3).
					saveAsDefaultRef.current = false;
					setSaveAsDefault(false);
					return;
				}
				savedRungRef.current = value;
				setSavedRung(value);
				await entities.refetch();
			});
			defaultWrites.current = write.catch(() => undefined);
			return write;
		},
		[defaultSetting.perform, entities.refetch],
	);
	/* Same key as the model dialog's: the selection in force, not the snapshot the
	   dialog opened on, so the rungs offered are the current model's (R2). */
	const draftPreview = useQuery({
		...draftPreviewQuery(
			draftPick.target ?? NO_DRAFT_TARGET,
			draftPick.carriesFast,
		),
		enabled: Boolean(draft),
	});
	const draftModel = draft
		? bandReadings(draftPreview.data?.snapshot, null).effort
		: null;
	const model = draft
		? draftModel
		: (runningFrontend(canonical)?.effective_model ??
			runningFrontend(canonical)?.selected_model);
	const rungs = draft
		? effortLadder(draftModel)
		: (entities.data?.entities ?? []).map((row) => row.value);
	/*
	 * A session's rung in force is read off the LIVE frame first - the field the
	 * status chip prints - and the entity list only when the frame names none.
	 * The list's `current` is a 15 s cached read that nothing refetches after a
	 * switch, so a dialog reopened within that window named the rung the session
	 * had just LEFT, and a tick saved it while the chip showed the new one
	 * (review round 1 M1, UX U1, QA Q1).
	 */
	const liveRung =
		typeof model?.reasoning_effort === "string" && model.reasoning_effort.trim()
			? model.reasoning_effort.trim()
			: null;
	const currentRung = draft
		? (draftModel?.reasoning_effort ?? null)
		: // A published displacement names the conversation's CHOICE, which is the
			// rung this dialog changes; the live reading is then the level a
			// fallback serves at (`effortChosenRung` says why it outranks it).
			(effortChosenRung(runningFrontend(canonical)) ??
			liveRung ??
			entities.data?.current ??
			null);
	/*
	 * The accepted rung bridges the gap until the owner's frame names it, then
	 * the frame is the authority again - the same hand-over the model dialog's
	 * `pickedCurrent` makes.
	 */
	useEffect(() => {
		if (acceptedRung && liveRung === acceptedRung) setAcceptedRung(null);
	}, [acceptedRung, liveRung]);
	/*
	 * ONE answer to "which rung is in force", read by the ✓ and by the tick, so
	 * the row marked current is the rung a tick saves.
	 */
	const rungInForce = acceptedRung ?? currentRung;

	const options = useMemo<PickerOption[]>(
		() =>
			rungs.map((value) => ({
				value,
				// `value` stays the raw lowercase rung -- it is what `/effort <rung>`
				// is sent and what `currentRung === value` compares. Only the LABEL
				// is the title-cased human form, matching the chip and the model name.
				label: effortDisplay(value),
				current: rungInForce === value,
			})),
		[rungs, rungInForce],
	);
	const label = model
		? `${model.provider}/${model.model_id}`
		: t("ui.chat.pickers.destination_pickers.the_current_model");
	/*
	 * An empty rung list has TWO causes and they are different facts, only one
	 * of which is about the model.
	 *
	 * `command-entities?command=effort` reads `remote.model.reasoning_efforts`
	 * (`desktop_catalogues.py:270-273`) - a pure read of the owner's live spec.
	 * On a cold owner that spec is not resolved yet, so the endpoint answers
	 * `[]` for a model that in fact has a full ladder, and only `/effort <rung>`
	 * resolves it. Reading `[]` as "this model has no adjustable effort" turns
	 * an unresolved read into a capability claim, and then advises the user to
	 * "pick a reasoning model" about a four-rung reasoning model (UX round 3,
	 * U12). It is the same inference `reconcileEffort` had to drop one file
	 * over, which is why both now ask the SAME predicate rather than each
	 * deciding for itself.
	 */
	const unresolved = specUnresolved(model);
	/*
	 * What "nothing to show" means, which differs by state rather than by pane:
	 * a draft's list is the backend's own resolution, so an empty one is the model
	 * having no rungs; a session's is a read of a live spec, which can be empty
	 * because the owner has not resolved it yet.
	 */
	const loading = draft ? draftPreview.isLoading : entities.isLoading;
	const noOptions = options.length === 0 && !loading;
	/*
	 * The tick is a request about the rung IN FORCE, whenever it is made: the one
	 * the owner accepted in this dialog, else the session's current rung. It used
	 * to be read only at the moment of a pick, so changing the level first and then
	 * ticking - the order the operator used - and ticking on a dialog opened only to
	 * make the current level the default both wrote nothing, while the label said
	 * "This pick also sets the default effort". A switch still in flight keeps the
	 * write for its own continuation. Unticking writes nothing: a saved default
	 * stays saved.
	 */
	/*
	 * The model dialog's two rules, for the same reasons: the label is laid out
	 * at its tallest wording from the first paint (UX round 2, U9), and a saved
	 * default is the ticked label's to state, not the strip's too (U11).
	 */
	const saveAsDefaultWordings = [
		t(
			"ui.chat.pickers.destination_pickers.also_make_this_the_default_effort_for_new_sessions",
		),
		t(
			"ui.chat.pickers.destination_pickers.picks_here_also_set_the_default_effort_for_new_sessions",
		),
		t(
			"ui.chat.pickers.destination_pickers.default_effort_for_new_sessions_picks_here_update_it_too",
			{
				effortdisplay: effortDisplay(
					savedRung ?? (typeof rungInForce === "string" ? rungInForce : ""),
				),
			},
		),
	] as const;
	const defaultLine =
		defaultSetting.result?.tone === "success" && saveAsDefault
			? null
			: defaultSetting.result;
	const onSaveAsDefaultChange = (checked: boolean) => {
		saveAsDefaultRef.current = checked;
		setSaveAsDefault(checked);
		if (!checked) {
			// An untick writes nothing, so the line about the last save goes with
			// it rather than reading as the untick's own result (UX round 1, U4).
			defaultSetting.setResult(null);
			return;
		}
		if (switching.current) return;
		// `current` comes off the entities wire untyped; only a rung name is saved.
		if (typeof rungInForce === "string" && rungInForce)
			void saveEffortDefault(rungInForce);
	};
	const loadError = draft
		? draftPreview.isError
			? errorText(draftPreview.error)
			: null
		: entities.isError
			? errorText(entities.error)
			: null;
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.effort.title")}
			toolbar={
				!draft ? (
					<PickerCheck
						checked={saveAsDefault}
						onCheckedChange={onSaveAsDefaultChange}
						tone="muted"
					>
						{/*
						 * Ticked, the label states what is saved, not a pick: after a
						 * tick-only save "This pick also sets..." named a pick that
						 * never happened (UX round 1, U5).
						 */}
						<ReservedLabelText
							wordings={saveAsDefaultWordings}
							text={
								!saveAsDefault
									? saveAsDefaultWordings[0]
									: savedRung
										? saveAsDefaultWordings[2]
										: saveAsDefaultWordings[1]
							}
						/>
					</PickerCheck>
				) : undefined
			}
			description={
				noOptions
					? unresolved
						? // Naming the rung matters: opening this picker is a read and
							// cannot resolve the spec, so the only route out is the one
							// act that does.
							draft
							? /*
								 * The route out, named (design D24). A draft has no `/effort`
								 * command to run - it has no owner - but the model chip is one
								 * click away and picking a model whose own resolution reports
								 * a ladder is what makes levels offerable here, so the sentence
								 * names the act instead of leaving the reader waiting.
								 */
								t(
									"ui.chat.pickers.destination_pickers.has_not_reported_its_effort_levels_yet_they_appear_after_the_first_turn",
									{ label: label },
								)
							: t(
									"ui.chat.pickers.destination_pickers.has_not_reported_its_effort_levels_yet_they_appear_after_the_next_turn_o",
									{ label: label },
								)
						: draft
							? t(
									"ui.chat.pickers.destination_pickers.has_no_adjustable_effort_pick_another_model",
									{ label: label },
								)
							: t(
									"ui.chat.pickers.destination_pickers.has_no_adjustable_effort_pick_a_reasoning_model_with_model_first",
									{ label: label },
								)
					: draft
						? t(
								"ui.chat.pickers.destination_pickers.effort_levels_supports_this_sets_the_level_this_conversation_starts_on_a",
								{ label: label },
							)
						: t(
								"ui.chat.pickers.destination_pickers.effort_levels_supports_applies_to_this_session_unless_you_also_make_it_t",
								{ label: label },
							)
			}
			options={options}
			loading={loading}
			loadError={loadError}
			emptyText={
				unresolved
					? t("ui.chat.pickers.destination_pickers.not_known_yet")
					: t(
							"ui.chat.pickers.destination_pickers.effort_is_not_adjustable_on_this_model",
						)
			}
			onPick={(value) => {
				if (!draft) {
					switching.current = true;
					void command
						.run("effort", value)
						.then(async ({ outcome, result: refusal }) => {
							switching.current = false;
							const accepted = effortCommandSucceeded(outcome);
							if (accepted) setAcceptedRung(value);
							if (!saveAsDefaultRef.current) return;
							if (accepted) {
								await saveEffortDefault(value);
								return;
							}
							/*
							 * EVERY failed switch with the box ticked says what the default
							 * is now. A transport failure used to say nothing (review round
							 * 1, m2), and after a tick had saved one the refusal claimed no
							 * default was saved (m1).
							 */
							const saved = savedRungRef.current;
							defaultSetting.setResult({
								tone: refusal.tone,
								text: saved
									? t(
											"ui.chat.pickers.destination_pickers.effort_not_changed_default_for_new_sessions_stays",
											{ effortdisplay: effortDisplay(saved) },
										)
									: t(
											"ui.chat.pickers.destination_pickers.the_effort_default_was_not_saved",
										),
							});
						});
					return;
				}
				/*
				 * A confirmed pick outranks the dialog's opened-on snapshot. Before ANY
				 * pick, however, a null draft selection means "use the resolved default",
				 * not "no model exists" (R7). Seed an effort-first candidate from the same
				 * effective-first spec that supplies the strip and this dialog's rungs;
				 * only a genuinely unnamed model reaches the hook's explicit refusal.
				 * Keep that fallback local to the candidate: merely opening the picker
				 * must not turn an unpicked draft into an explicit model selection.
				 */
				const selection = draftPick.selection ?? selectionFromModel(draftModel);
				void draftPick.pick(
					selection ? { ...selection, reasoning_effort: value } : null,
					{
						describe: () =>
							t(
								"ui.chat.pickers.destination_pickers.effort_for_this_conversation",
								{ value: value },
							),
						refused: t(
							"ui.chat.pickers.destination_pickers.the_effort_was_not_changed",
						),
					},
				);
			}}
			/* Keep both receipts visible: the effort command and machine-default write
			 * are separate outcomes, as they are for the model picker. */
			busy={draft ? draftPick.busy : command.busy || defaultSetting.busy}
			result={
				draft
					? draftPick.result
					: defaultLine
						? {
								...defaultLine,
								text: [command.result?.text, defaultLine.text]
									.filter(Boolean)
									.join("\n"),
							}
						: command.result
			}
			/*
			 * The wait names its work (design D23). A draft's effort pick resolves
			 * through `sessions.preview` before it records anything, exactly as the
			 * model dialog beside it does, and it fell back to the host's generic
			 * "Applying the change…" - which says that something is happening
			 * without saying what, for a wait the sibling adapter already names.
			 * A session's effort pick is a command and keeps the default.
			 */
			/*
			 * A tick's save is not a switch, so its wait says what it is doing
			 * (UX round 1, U3).
			 */
			busyText={
				draft
					? t("ui.chat.pickers.destination_pickers.resolving_the_effort")
					: command.busy
						? t("ui.chat.pickers.destination_pickers.switching_the_effort")
						: t("ui.chat.pickers.destination_pickers.saving_the_default")
			}
			busyLabel={
				draft
					? t("ui.chat.pickers.destination_pickers.resolving_the_effortd0fa08")
					: command.busy
						? t(
								"ui.chat.pickers.destination_pickers.switching_the_effort87b64b",
							)
						: t("ui.chat.pickers.destination_pickers.saving_the_default9573f2")
			}
		/>
	);
};

// ------------------------------------------------------------------ theme

export const ThemePicker: FC<PickerContext> = ({ onClose, action }) => {
	const locale = useI18nLocale();
	const themeName = useUiPreferencesStore((state) => state.themeName);
	const setTheme = useUiPreferencesStore((state) => state.setTheme);
	const [result, setResult] = useState<PickerResult | null>(null);
	/*
	 * The theme a fully-qualified argument NAMES, resolved at render so the FIRST
	 * paint can already be the confirmation (issue #676).
	 *
	 * A `/theme <id>` that resolves had the double-selection defect the report
	 * names: the inline list already WAS the selection gesture, and this dialog
	 * then painted the whole table again under the applied receipt, as if nothing
	 * had been chosen. The fix is deliberately NOT to make the inline pick run —
	 * a modal opened by an inline pick is the pattern `picker-registry.tsx`'s
	 * `runs: false` rejects on purpose — but to make THIS dialog a confirmation
	 * when the argument already names the choice: `options` is omitted (the
	 * host's no-list shape) and the existing result line says what was applied.
	 * A bare `/theme` keeps the full picker; so does an argument that does NOT
	 * resolve, because choosing from the table is then exactly what the user
	 * needs (beside the warning that says so).
	 */
	const requested = useMemo(() => {
		const wanted = action.args.trim();
		if (!wanted) return null;
		return (
			Object.values(themes).find(
				(theme) =>
					theme.id.toLowerCase() === wanted.toLowerCase() ||
					theme.name.toLowerCase() === wanted.toLowerCase(),
			) ?? null
		);
	}, [action.args]);
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return Object.values(themes).map((theme) => ({
			value: theme.id,
			label: theme.name,
			description: theme.description,
			current: theme.id === themeName,
			group: theme.id.startsWith("localOperator")
				? "Local Operator"
				: t("ui.chat.pickers.destination_pickers.ports"),
		}));
	}, [themeName, locale]);
	// A typed argument (`/theme dracula`) is a direct pick when it names a theme.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted) return;
		if (requested) {
			setTheme(requested.id as ThemeName);
			setResult({
				tone: "success",
				text: t("ui.chat.pickers.destination_pickers.theme", {
					name: requested.name,
				}),
			});
		} else {
			setResult({
				tone: "warning",
				text: t("ui.chat.pickers.destination_pickers.no_desktop_theme_named", {
					wanted: wanted,
				}),
			});
		}
	}, [action.args, requested, setTheme]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.theme.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.desktop_theme_the_terminal_keeps_its_own_tui_theme_setting",
			)}
			/*
			 * THE CONFIRMATION SHAPE (issue #676): no `options` at all while the
			 * argument names the theme, so the host draws its no-list body and the
			 * result line is the whole of the dialog's content. Omitting the array
			 * rather than emptying it is the distinction the host itself draws
			 * (`hasList = options !== undefined`): an empty list would still draw a
			 * search field, a listbox and an empty-state sentence.
			 */
			options={requested ? undefined : options}
			onPick={(value, option) => {
				setTheme(value as ThemeName);
				setResult({
					tone: "success",
					text: t("ui.chat.pickers.destination_pickers.theme_058ec5", {
						label: option.label,
					}),
				});
			}}
			result={result}
		/>
	);
};

// ------------------------------------------------------------- team/agent

type ProfileRow = {
	value: string;
	name?: string;
	kind?: string;
	description?: string;
	/**
	 * Registry provenance (`builtin` | `installed` | `custom`). Present on the
	 * agent arm of the session's `commands.entities` route, whose rows are the
	 * registry's `profile_detail` projection (core `desktop_catalogues.py`); a
	 * team row has none. Read only to decide whether `description` is shipped
	 * copy (`agentDescriptionText`), never to address anything.
	 */
	source?: string;
	/** A team's free-text display name, when the row carries one. */
	label?: string;
	/** Extra TUI-safe keys a team resolves under. Typed for the wire shape;
	 * addressing in this app stays on `value`. */
	aliases?: string[];
	profile?: Record<string, unknown> | null;
	instructions?: string | null;
};

/**
 * The words a profile row is READ by: a team's label when it carries one, the
 * slug otherwise (`teamDisplayName`), and `fallback` when the row itself is
 * absent - the still-loading detail, or a value the list no longer holds.
 *
 * DISPLAY ONLY, the same rule the option list, the detail card and the
 * placeholder all read. `value` - what `onPick` selects, what `submit` sends
 * and what the detail query asks for - never routes through this.
 */
/**
 * Agent rows resolve their description through the shared resolver
 * (`withAgentDescriptionText`); a team's description is always the operator's.
 */
const withLocalizedAgentDescription = (
	row: ProfileRow,
	which: "team" | "agent",
): ProfileRow => (which === "agent" ? withAgentDescriptionText(row) : row);

const readableProfileName = (row: ProfileRow | undefined, fallback: string) =>
	teamDisplayName({ name: row?.name ?? fallback, label: row?.label });

export const ProfilePicker: FC<PickerContext & { which: "team" | "agent" }> = ({
	sessionId,
	which,
	spec,
	onClose,
	canonical,
	action,
}) => {
	/*
	 * Bound to the frame rather than called for its effect: the roster below keys
	 * shipped seed copy at memo time, so the locale belongs in that memo's deps -
	 * `void locale` inside is the dependency the earlier arms of this file already
	 * take for the same reason.
	 */
	const locale = useI18nLocale();
	const [selected, setSelected] = useState<string | null>(null);
	/*
	 * THE DRAFT BRANCH (issue #780): mounted with no session — the dispatcher's
	 * draft route for `/team` / `/agent` on a New-chat pane — the picker reads
	 * the SESSIONLESS roster (the same `teams.list` / `profiles.list` documents
	 * the sidebar shows) rather than the session-bound entity route, and its
	 * pick STAGES the draft's identity instead of running the attach command:
	 * there is no session to address, and the create the first send performs
	 * carries the target (`stageDraft`), which is the sidebar's "New chat with
	 * <team>" path. The entities route keeps its session gate so a sessionless
	 * mount cannot ask it with `""`.
	 */
	const draftMode = !sessionId;
	const draftTeams = useTeams(draftMode && which === "team");
	const draftProfiles = useProfiles(draftMode && which === "agent");
	const list = useEntities<ProfileRow>(sessionId, which, undefined, !draftMode);
	const detail = useEntities<ProfileRow>(
		sessionId,
		which,
		selected ?? undefined,
		!draftMode && !!selected,
	);
	const command = useSessionCommand(sessionId);
	const [request, setRequest] = useState("");
	const active =
		which === "team"
			? canonical.frontend?.active_team
			: canonical.frontend?.active_agent;
	const chartMode = (action.data as { mode?: string }).mode === "chart";

	const listRows = useMemo<ProfileRow[]>(() => {
		void locale;
		if (!draftMode) {
			return (list.data?.entities ?? []).map((row) =>
				withLocalizedAgentDescription(row, which),
			);
		}
		return which === "team"
			? (draftTeams.data ?? []).map((team) => ({
					value: team.name,
					name: team.name,
					label: team.label,
					description: team.description,
				}))
			: (draftProfiles.data ?? []).map((profile) => ({
					value: profile.name,
					name: profile.name,
					/*
					 * THE SHIPPED SENTENCE, NOT THE FIELD (agent review round 1, R1-2).
					 * These rows ARE the profiles registry's, so they carry the provenance
					 * the resolution needs - and an installed seed serves its routing text
					 * in this field, which stays English unless it resolves to a key. The
					 * non-draft arm above takes the same resolver: the session's entity
					 * route returns the registry's `profile_detail` rows, which carry
					 * `source` too (agent review round 2, R2-1).
					 */
					description: agentDescriptionText(profile),
					kind: profile.kind,
				}));
	}, [
		draftMode,
		which,
		list.data,
		draftTeams.data,
		draftProfiles.data,
		locale,
	]);
	const listLoading = draftMode
		? which === "team"
			? draftTeams.isLoading
			: draftProfiles.isLoading
		: list.isLoading;
	const listError = draftMode
		? which === "team"
			? draftTeams.isError
			: draftProfiles.isError
		: list.isError;
	const listErrorDetail = draftMode
		? which === "team"
			? draftTeams.error
			: draftProfiles.error
		: list.error;

	const options = useMemo<PickerOption[]>(
		() =>
			listRows.map((row) => ({
				value: row.value,
				label: readableProfileName(row, row.value),
				description: row.description,
				meta: row.kind,
				current: active === row.value,
			})),
		[listRows, active],
	);
	/*
	 * THE CARD'S ROW, from the read its mode actually makes (design round 1,
	 * D1). A draft disables the detail read (its `enabled` is
	 * `!draftMode && !!selected`), so the entities below are empty there and
	 * the card fell back to the raw slug — `lopdev` under a row the user had
	 * just clicked reading "Local Operator Dev". The draft arm resolves from
	 * `listRows` (the same switch `activeRow` takes below), the only read a
	 * draft makes and the one carrying the label and the description; the
	 * session arm keeps the detail read, whose entity also carries
	 * `instructions`.
	 */
	const selectedRow = (
		draftMode
			? listRows
			: (detail.data?.entities ?? []).map((row) =>
					withLocalizedAgentDescription(row, which),
				)
	).find((row) => row.value === selected);
	const chart = detail.data?.current as
		| Record<string, unknown>
		| null
		| undefined;

	const submit = useCallback(async () => {
		if (!selected) return;
		if (draftMode) {
			/*
			 * The pick stages the identity on the pane's own draft — the same act
			 * as the sidebar's "New chat with <team>", with the box's text
			 * carried across the key flip by `restageDraft` (issue #780) — and
			 * closes. Nothing is posted: there is no session to address, and the
			 * create the first send performs carries the target.
			 */
			useCanonicalSessionsStore
				.getState()
				.restageDraft({ kind: which, name: selected });
			onClose();
			return;
		}
		// The owner admits `data.request` ONCE on attachment; the renderer must
		// not re-send it. The receipt's admission field records that fact.
		const { outcome } = await command.run(
			which,
			request ? `${selected} ${request}` : selected,
		);
		if (!outcome || isNativeAction(outcome)) return;
	}, [command, which, selected, request, draftMode, onClose]);

	const admission =
		command.outcome && !isNativeAction(command.outcome)
			? (
					command.outcome as {
						admission?: { detail?: string; duplicate?: boolean } | null;
					}
				).admission
			: null;
	const result: PickerResult | null = command.result
		? admission
			? {
					...command.result,
					text: t("ui.chat.pickers.destination_pickers.request_admitted_once", {
						text: command.result.text,
						duplicate: admission.duplicate ? "true" : "false",
					}),
				}
			: command.result
		: null;
	/*
	 * The ACTIVE team's readable name, resolved from the same list the options
	 * read (a labelled team reads as its label here too); a row the list does
	 * not hold - the read still landing - keeps the slug.
	 */
	const activeRow = active
		? listRows.find((row) => row.value === active)
		: undefined;
	const activeLabel = active ? readableProfileName(activeRow, active) : "";

	return (
		<PickerHost
			open
			onClose={onClose}
			title={
				chartMode
					? t("ui.chat.pickers.destination_pickers.team_chart")
					: which === "team"
						? t("ui.chat.pickers.destination_pickers.team")
						: t("ui.chat.pickers.destination_pickers.agent_profile")
			}
			description={
				chartMode
					? t(
							"ui.chat.pickers.destination_pickers.pick_a_team_to_see_how_it_resolves",
						)
					: `${spec.description}. ${activeLabel ? t("ui.chat.pickers.destination_pickers.active", { activelabel: activeLabel }) : ""}`
			}
			options={options}
			loading={listLoading}
			loadError={listError ? errorText(listErrorDetail) : null}
			emptyText={
				which === "team"
					? t("ui.chat.pickers.destination_pickers.no_teams_are_registered")
					: t("ui.chat.pickers.destination_pickers.no_profiles_found")
			}
			onPick={(value) => setSelected(value)}
			busy={command.busy}
			result={result}
			form={
				selected ? (
					<div className="flex flex-col gap-3">
						<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
							<p className="text-body-sm text-ink">
								{readableProfileName(selectedRow, selected)}
							</p>
							{selectedRow?.description && (
								<p className="text-ink-muted text-meta">
									{selectedRow.description}
								</p>
							)}
							{detail.isLoading && (
								<p className="text-ink-dim text-meta">
									{t("ui.chat.pickers.profile.loading_detail")}
								</p>
							)}
							{selectedRow?.instructions && (
								<pre className="mt-2 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm">
									{selectedRow.instructions}
								</pre>
							)}
							{chart && (
								<pre className="mt-2 max-h-48 overflow-auto font-mono text-ink-muted text-mono-sm">
									{JSON.stringify(chart, null, 2)}
								</pre>
							)}
						</div>
						{/*
						 * The request is a SESSION's first turn; a draft's first message is
						 * typed in the composer once the identity is set (design may weigh a
						 * carried request later — issue #780) — and hiding the field must not
						 * take its "what happens next" cue with it, so the draft arm states
						 * the beat the field's hint carried (design round 1, D5).
						 */}
						{chartMode ? null : draftMode ? (
							<p className="text-ink-muted text-meta">
								{which === "team"
									? t(
											"ui.chat.pickers.destination_pickers.your_first_message_starts_the_chat_with_this_team",
										)
									: t(
											"ui.chat.pickers.destination_pickers.your_first_message_starts_the_chat_with_this_profile",
										)}
							</p>
						) : (
							<PickerField
								label={t(
									"ui.chat.pickers.destination_pickers.request_optional",
								)}
								hint={t(
									"ui.chat.pickers.destination_pickers.sent_once_with_the_attachment_it_becomes_the_first_turn",
								)}
							>
								<Textarea
									value={request}
									onChange={(event) => setRequest(event.target.value)}
									placeholder={t(
										"ui.chat.pickers.destination_pickers.what_should_do",
										{
											readableprofilename: readableProfileName(
												selectedRow,
												selected,
											),
										},
									)}
									rows={3}
								/>
							</PickerField>
						)}
					</div>
				) : undefined
			}
			onSubmit={!chartMode && selected ? submit : undefined}
			submitLabel={
				draftMode
					? which === "team"
						? t("ui.chat.pickers.destination_pickers.use_team")
						: t("ui.chat.pickers.destination_pickers.use_profile")
					: which === "team"
						? t("ui.chat.pickers.destination_pickers.attach_team")
						: t("ui.chat.pickers.destination_pickers.use_profile")
			}
			submitDisabled={!selected}
		/>
	);
};

// ------------------------------------------------------------------ skills

type SkillRow = {
	name: string;
	description?: string;
	source?: string;
	path?: string;
	[key: string]: unknown;
};
type SkillsResult = {
	data: {
		skills: SkillRow[];
		scope: string;
		detail: { name?: string; body?: string; text?: string } | null;
		warning_count: number;
	};
};

export const SkillsPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
	useI18nLocale();
	const [selected, setSelected] = useState<string | null>(null);
	const list = useQuery({
		queryKey: ["desktop", "skills", sessionId],
		queryFn: () =>
			desktopResult<SkillsResult>({ op: "skills.list", sessionId }),
		staleTime: 30_000,
	});
	const detail = useQuery({
		queryKey: ["desktop", "skills", sessionId, selected],
		queryFn: () =>
			desktopResult<SkillsResult>({
				op: "skills.list",
				sessionId,
				name: selected ?? undefined,
			}),
		enabled: !!selected,
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.data.skills ?? []).map((row) => ({
				value: row.name,
				label: row.name,
				description: row.description,
				meta: row.source,
				current: row.name === selected,
			})),
		[list.data, selected],
	);
	const body = detail.data?.data.detail;
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.skills.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.skills_discoverable_from_this_session_s_working_directory_scope_listed_i",
				{
					value:
						list.data?.data.scope ??
						t("ui.chat.pickers.destination_pickers.discoverable"),
				},
			)}
			options={options}
			loading={list.isLoading}
			loadError={list.isError ? errorText(list.error) : null}
			emptyText={t(
				"ui.chat.pickers.destination_pickers.no_skills_are_discoverable_from_this_session_s_directory",
			)}
			onPick={(value) => setSelected(value)}
			form={
				selected ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<p className="font-mono text-ink text-mono-sm">
							{/* i18n: ignore protocol scheme shown to the user, not prose */}
							{t("ui.chat.pickers.destination_pickers.skill")}
							{selected}
						</p>
						{detail.isLoading ? (
							<p className="text-ink-dim text-meta">
								{t("ui.chat.pickers.skills.loading")}
							</p>
						) : (
							<pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm">
								{body?.body ??
									body?.text ??
									t("ui.chat.pickers.destination_pickers.no_detail_returned")}
							</pre>
						)}
					</div>
				) : undefined
			}
		/>
	);
};

// -------------------------------------------------------------------- fork

/**
 * The entry id a `session.fork` request was raised with, or `null`.
 *
 * Read defensively rather than cast. `action.data` is the action contract's open
 * payload (the projects picker reads its own `mode` out of the same slot), so
 * anything could be in it - and a non-string or blank value has to mean "no cut
 * point", the whole-conversation form this picker has always shipped, rather
 * than a body the route refuses with a 422 the reader cannot act on.
 */
function readForkEntryId(data: Record<string, unknown>): string | null {
	const value = data.entryId;
	return typeof value === "string" && value.trim() ? value : null;
}

/**
 * The requester's own label for that entry, when it sent one.
 *
 * Same defensive read, same rule: absent or blank means "no label", and the
 * picker's copy falls back to naming the cut point without it rather than
 * printing an empty quotation.
 */
function readForkEntryExcerpt(data: Record<string, unknown>): string | null {
	const value = data.entryExcerpt;
	return typeof value === "string" && value.trim() ? value : null;
}

/**
 * What the cut arm adds to a refused fork, WITHOUT speaking for the cause.
 *
 * WHY IT IS APPENDED AND NOT SUBSTITUTED (agent review round 2, MAJOR-1). The
 * first shape of this copy replaced the failure text whenever a cut was in play,
 * and that was wrong twice over:
 *
 *   - `perform` returns null for EVERY throw, so the replacement covered a
 *     transport failure, a timeout and the schema refusal this file documents
 *     (“Invalid desktop operation.”) as well as the route's refusals. A sentence
 *     about the message is a lie for a backend that never answered.
 *   - the route classifies a cut refusal in PROSE, not one sentence: compaction
 *     in flight (“retry /fork when compaction finishes”), an unknown or foreign
 *     id (“that message is not part of this conversation”), a point before the
 *     newest summary's anchor (“fork from a message after the summary”) and a
 *     boundary inside an unfinished tool batch (“retry after the original
 *     finishes that batch”). Three of the four already name the reader's own
 *     fix, so dropping them lost information.
 *
 * What is left for this side to say is the one thing the core cannot know and
 * the reader can: for a row that is still an uncommitted echo (an in-flight
 * send, or an undelivered one that stays on screen) the refusal reads as “that
 * message is not part of this conversation” about a message that plainly is.
 * The note names that window without asserting it - “may”, conditional on the
 * reader having just sent it - and it advises NOTHING, because every action it
 * could name can itself be refused: while a compaction pass is in flight the
 * route refuses *every* cut, including the whole-conversation one, so the
 * earlier “or fork the whole conversation instead” was advice that could not
 * work. The core's own sentence carries the fix; this note explains the one
 * gap. The typed-code mapping that would replace this note lands with the core
 * slice (in flight in `damianvtran/local-operator`) and is declared on the PR.
 */
export const FORK_CUT_NOTE = (): string =>
	t(
		"ui.chat.pickers.destination_pickers.if_that_message_was_sent_just_now_it_may_not_be_in_the_conversation_s_hi",
	);

/**
 * Fork the conversation - all of it, or the prefix that ends at one message.
 *
 * TWO FORMS, ONE PICKER, and they are not two pickers because the form is the
 * same form: a typed `/fork` names no entry (the next safe boundary), and a
 * Fork raised from a message row names one (`at_entry` + the entry id, handed
 * to this adapter on `action.data`). Two components would be two places the
 * message field, the budget refusal and the rebind-on-success have to agree.
 *
 * THE CUT ARM NAMES THE MESSAGE IT WORKS ON (UX round 1, U1). It can, because
 * the request carries the row's own words (`entryExcerpt`), and it must: the
 * control lives on a hover-revealed row and this panel covers the transcript, so
 * "the message you chose" is otherwise a phrase with no referent on screen at the
 * one moment the reader could still check it. Both success sentences also name
 * NO SESSION ID (U5) - the flow takes the reader to the child (`rebind`), and a
 * raw token was the only thing the old copy said about where it went.
 */
export const ForkPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
	action,
}) => {
	useI18nLocale();
	/*
	 * The cut point this picker was opened FOR, or null for the whole-conversation
	 * form. It is read off the REQUEST rather than re-derived here: the row that
	 * raised the request is the only layer that knows which message the reader
	 * pointed at, and it travels with the request (the same rule the conversation
	 * itself follows - see `PanelRequest.entryId`).
	 */
	const cutEntryId = readForkEntryId(action.data);
	const cutExcerpt = readForkEntryExcerpt(action.data);
	const [message, setMessage] = useState(action.args ?? "");
	/*
	 * THE FORK-TIME INTENT, read from the persisted view rather than from a prop:
	 * every door that raises this picker (typed `/fork`, a row's menu, the
	 * palette) already shares the sidebar's `SidebarView`, and passing the pair
	 * through `action.data` would be three places to keep in step with the View
	 * options row. `getState()` inside the submit is deliberate - the value is
	 * captured when the request is SENT, which is the moment the design calls
	 * fork time; changing the setting later never reaches an existing fork
	 * because the backend records the sidecar then.
	 */
	const capabilities = useDesktopCapabilities();
	const op = useOperation();
	const submit = useCallback(async () => {
		// Weighed before the request for the same reason a message is: `message` is
		// declared at 200,000 characters, and without this the schema parse inside
		// `requestDesktop` refused a long paste as "Invalid desktop operation.",
		// which this picker then showed as "The fork was not created: Invalid
		// desktop operation." - naming neither the cause nor anything to do about
		// it (round 2, N2). The text stays in the field either way, so shortening
		// it is the one action the sentence asks for.
		const refusal = forkBudgetRefusal(message.trim());
		if (refusal) {
			op.setResult({ tone: "error", text: refusal });
			return;
		}
		/*
		 * The field travels only when the backend advertises the version that
		 * reads it; on an older core this is `undefined`, `JSON.stringify` drops
		 * the key, and the body is the released one key for key.
		 */
		const autoTag = forkAutoTag(
			parseSidebarView(useUiPreferencesStore.getState().chatSidebarView),
			autoTagSupported(capabilities.data),
		);
		const value = await op.perform(
			() =>
				desktopResult<{
					data: {
						session_id: string;
						parent_id: string;
						boundary: string;
						/*
						 * WHERE THE COPY ACTUALLY STOPPED, present only on a cut. Equal to the
						 * id this picker sent unless the safe cut landed at-or-before an
						 * unfinished tool batch - the one case the child's first request cannot
						 * start at the row the reader pointed at, which this picker says out
						 * loud rather than letting the copy land somewhere unnoticed.
						 */
						cut_entry_id?: string;
						admission?: { detail: string; duplicate: boolean };
					};
				}>({
					op: "sessions.fork",
					sessionId,
					requestId: uuidv4(),
					message: message.trim() || undefined,
					/*
					 * The pair the route validates together: `at_entry` WITHOUT an entry id is
					 * refused, and an entry id WITH `next_safe` is refused. This branch is the
					 * only place the UI can get it wrong, so it writes both or neither - and
					 * the neither case is the exact call that shipped before cuts existed.
					 */
					...(cutEntryId
						? { boundary: "at_entry" as const, entryId: cutEntryId }
						: { boundary: "next_safe" as const }),
					/*
					 * ABSENT, not `undefined`: on a backend without the capability the
					 * request object itself keeps the released shape, which is the property
					 * the call-site test reads (the transport would drop it either way).
					 */
					...(autoTag === undefined ? {} : { autoTag }),
				}),
			/*
			 * THE SUCCESS SENTENCE NAMES NO SESSION ID (UX round 1, U5). The child's id
			 * was the only thing the old sentence said about where the new conversation
			 * is, and an opaque token answers nothing for a reader - the flow already
			 * takes them there (`rebind` is `openConversation`), which is why the
			 * receipt states the outcome instead of an address.
			 */
			(result) => ({
				tone: "success",
				text: `${
					cutEntryId
						? t(
								"ui.chat.pickers.destination_pickers.forked_from_this_message_everything_after_it_stays_in_the_original_which",
							)
						: t(
								"ui.chat.pickers.destination_pickers.forked_at_the_next_safe_boundary_into_a_new_conversation_the_original_co",
							)
				}${
					cutEntryId &&
					result.data.cut_entry_id &&
					result.data.cut_entry_id !== cutEntryId
						? t(
								"ui.chat.pickers.destination_pickers.the_fork_starts_before_the_message_you_chose_a_cut_cannot_separate_a_too",
							)
						: ""
				}${
					result.data.admission
						? t(
								"ui.chat.pickers.destination_pickers.your_message_was_admitted_once",
								{ detail: result.data.admission.detail },
							)
						: ""
				}`,
			}),
			t("ui.chat.pickers.destination_pickers.the_fork_was_not_created"),
			/*
			 * Appended to the owner's own detail rather than replacing it; see
			 * `FORK_CUT_NOTE` for the two reasons and for what the note deliberately
			 * does NOT say.
			 */
			cutEntryId ? FORK_CUT_NOTE() : undefined,
		);
		if (value) rebind(value.data.session_id);
	}, [op, sessionId, message, rebind, cutEntryId, capabilities.data]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={
				cutEntryId
					? t("ui.chat.pickers.destination_pickers.fork_from_this_message")
					: t("ui.chat.pickers.destination_pickers.fork_this_conversation")
			}
			description={
				cutEntryId
					? t(
							"ui.chat.pickers.destination_pickers.copies_this_conversation_up_to_and_including_everything_after_it_is_left",
							{
								value: cutExcerpt
									? t("ui.chat.pickers.destination_pickers.this_message", {
											cutexcerpt: cutExcerpt,
										})
									: t(
											"ui.chat.pickers.destination_pickers.the_message_you_chose",
										),
							},
						)
					: t(
							"ui.chat.pickers.destination_pickers.copies_the_complete_history_into_a_new_conversation_at_the_next_safe_bou",
						)
			}
			form={
				<PickerField
					label={t(
						"ui.chat.pickers.destination_pickers.first_message_in_the_fork_optional",
					)}
					hint={t(
						"ui.chat.pickers.destination_pickers.delivered_exactly_once_to_the_new_conversation",
					)}
				>
					<Textarea
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						rows={3}
						placeholder={t("ui.chat.pickers.fork.search_placeholder")}
					/>
				</PickerField>
			}
			onSubmit={submit}
			submitLabel={t("ui.chat.pickers.destination_pickers.fork")}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// -------------------------------------------------------------------- stop

/**
 * One conversation `sessions.list` returns, as BOTH pickers read it.
 *
 * Exported, with the read below, because two features ask this one question over
 * one cache entry: this file's stop picker and the Schedules dialog's destination
 * picker. They used to declare the same key, the same op, the same `limit: 200`
 * and the same mapping twice, with two structural row types that differed by a
 * `pending?` - two answers to one question over one entry, which is round 2's M3.
 *
 * `mtime` is epoch **SECONDS** on this wire, where the wake listing beside it is
 * milliseconds: the pickers convert at the call site rather than here, and the
 * Schedules dialog is the caller that learned why.
 */
export type SessionRow = {
	id: string;
	name: string;
	mtime: number;
	live_state?: string;
	pending?: unknown;
	/**
	 * The backend's own SENTENCE for this row's state, straight off
	 * `sessions.list`.
	 *
	 * Declared here although this type is hand-written around the wire's row
	 * (`SessionCatalogueRow` in `desktop-session-contract.ts`, which carries
	 * `status` as a required field): the catalogue read that fills this cache entry
	 * is the same `sessions.list` the sidebar's store reads, and the backend ships
	 * `status` on every row of it. Optional rather than required because this
	 * client cannot make an older backend publish one.
	 */
	status?: SessionCatalogueStatus;
};

/**
 * The shared read behind both pickers.
 *
 * The options are exactly what the two callers differ on, rather than a second
 * copy of the query: the Schedules dialog must ask what exists NOW when it opens
 * (it is mounted for the page's whole life, so a query with no `enabled` gate
 * answered once per page load and a conversation created since was missing from
 * the list), while the stop picker is happy with the default. `staleTime` is one
 * of those differences and not a knob for its own sake - see
 * `SCHEDULES_CONVERSATION_READ`.
 */
export function useSessionRows(
	options: {
		enabled?: boolean;
		refetchOnWindowFocus?: boolean;
		staleTime?: number;
	} = {},
) {
	return useQuery({
		queryKey: SESSION_ROWS_KEY,
		queryFn: () =>
			desktopResult<{ sessions: SessionRow[] }>({
				op: "sessions.list",
				limit: 200,
			}).then((result) => result.sessions ?? []),
		enabled: options.enabled ?? true,
		staleTime: options.staleTime ?? 5_000,
		refetchOnWindowFocus: options.refetchOnWindowFocus,
	});
}

/** The one cache entry this question has, named once. */
const SESSION_ROWS_KEY = ["desktop", "sessions", "rows"] as const;

function sessionLabel(row: SessionRow) {
	return (
		row.name?.trim() ||
		t("ui.chat.pickers.destination_pickers.untitled", { id: row.id })
	);
}

/**
 * WHAT A SESSION ROW SAYS UNDER ITS NAME.
 *
 * One function for both pickers because they ask one question over one cache
 * entry — the same reason `useSessionRows` above is shared (round 2's M3) — and
 * because the answer is a RULE rather than a string: the row's own sentence.
 *
 * THE TOKEN WAS THE DEFECT. `live: wedged` is the machine's spelling, and the
 * Stop picker is where a not-answering row SENDS a person — so the one surface
 * that acts on the state was the one naming it in a word no other surface uses
 * (every other one says "not answering"). The row already carries the backend's
 * sentence (`status.label`, the same value the sidebar's tooltip and its
 * accessible name carry), and the contract is explicit that a client must not
 * re-derive status, so the label is READ and never rebuilt here.
 *
 * AN ABSENT LABEL RENDERS NO LINE, deliberately. The alternative — falling back
 * to the raw `live_state` — is the defect, and inventing words for a state this
 * client cannot name is re-deriving status, which the contract forbids. It is
 * also not a state a working backend can reach: `sessions.list` ships `status`
 * on every row, and the sidebar's own store reads the same field — a backend
 * without it is already misdrawing every row in the list.
 *
 * The two `cold` sentences are NOT the same case and are left to the caller
 * verbatim: they are prose this client owns about an absence, where a cold row's
 * own label ("Recent") would say less than they do.
 */
const sessionActivity = (row: SessionRow, cold: string): string | undefined =>
	row.live_state ? row.status?.label : cold;

export const StopPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const locale = useI18nLocale();
	const rows = useSessionRows();
	const [targets, setTargets] = useState<Set<string>>(
		() => new Set(action.args.trim() === "all" ? [] : [sessionId]),
	);
	const [all, setAll] = useState(action.args.trim() === "all");
	const [confirmed, setConfirmed] = useState(false);
	const op = useOperation();
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return (rows.data ?? []).map((row) => ({
			value: row.id,
			label: sessionLabel(row),
			description: sessionActivity(
				row,
				t("ui.chat.pickers.destination_pickers.cold_no_owner_running"),
			),
			meta: row.id,
			current: targets.has(row.id) || all,
		}));
	}, [rows.data, targets, all, locale]);
	const chosen = all ? (rows.data ?? []).map((row) => row.id) : [...targets];
	const submit = useCallback(async () => {
		if (chosen.length === 0 || !confirmed) return;
		await op.perform(
			() =>
				desktopResult<{
					data: {
						results: { session_id: string; status: string; detail?: string }[];
					};
				}>({
					op: "sessions.stop",
					requestId: uuidv4(),
					targets: chosen.slice(0, 100),
					confirmed: true,
				}),
			(result) => ({
				tone: "success",
				text: result.data.results
					.map(
						(row) =>
							`${row.session_id}: ${
								row.status === "already_stopped"
									? t("ui.chat.pickers.destination_pickers.nothing_was_running")
									: t(
											"ui.chat.pickers.destination_pickers.stop_requested_acknowledged_not_a_completed_exit",
										)
							}`,
					)
					.join("\n"),
			}),
			t("ui.chat.pickers.destination_pickers.stop_was_not_accepted"),
		);
	}, [op, chosen, confirmed]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.stop.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.ends_the_chosen_sessions_current_work_through_the_runtime_s_own_stop_pro",
			)}
			options={options}
			loading={rows.isLoading}
			loadError={rows.isError ? errorText(rows.error) : null}
			onPick={(value) => {
				setAll(false);
				setTargets((current) => {
					const next = new Set(current);
					if (next.has(value)) next.delete(value);
					else next.add(value);
					return next;
				});
			}}
			toolbar={
				<PickerCheck checked={all} onCheckedChange={setAll} tone="muted">
					{t("ui.chat.pickers.stop.all_sessions", {
						count: rows.data?.length ?? 0,
					})}
				</PickerCheck>
			}
			form={
				<PickerCheck
					checked={confirmed}
					onCheckedChange={setConfirmed}
					tone="ink"
				>
					{t("ui.chat.pickers.stop.confirm", { count: chosen.length })}
				</PickerCheck>
			}
			onSubmit={submit}
			submitLabel={t("ui.chat.pickers.destination_pickers.stop")}
			submitDisabled={!confirmed || chosen.length === 0}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// -------------------------------------------------------------------- copy

export const CopyPicker: FC<PickerContext> = ({ canonical, onClose }) => {
	const locale = useI18nLocale();
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(() => {
		// t() reads at call time; locale is therefore a real invalidation input.
		void locale;
		const rows: PickerOption[] = [];
		const records = canonical.transcript.records;
		for (let i = records.length - 1; i >= 0 && rows.length < 60; i--) {
			const record = records[i];
			if (record.kind === "assistant" && record.text) {
				rows.push({
					value: `message:${record.id}`,
					label: record.text.replace(/\s+/g, " ").slice(0, 80),
					group: t("ui.chat.pickers.destination_pickers.messages"),
					meta: t("ui.chat.pickers.destination_pickers.message"),
				});
				const fences = record.text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
				fences.forEach((fence, index) => {
					const code = fence.replace(/^```[\w-]*\n/, "").replace(/```$/, "");
					rows.push({
						value: `code:${record.id}:${index}`,
						label:
							code.split("\n")[0].slice(0, 80) ||
							t("ui.chat.pickers.destination_pickers.code"),
						group: t("ui.chat.pickers.destination_pickers.code_blocks"),
						meta: t("ui.chat.pickers.destination_pickers.lines", {
							length: code.split("\n").length,
						}),
					});
				});
				rows.push({
					value: `quote:${record.id}`,
					label: `> ${record.text.replace(/\s+/g, " ").slice(0, 70)}`,
					group: t("ui.chat.pickers.destination_pickers.as_quote"),
					meta: t("ui.chat.pickers.destination_pickers.quote"),
				});
			}
			if (record.kind === "tool" && record.output) {
				rows.push({
					value: `output:${record.id}`,
					label: t("ui.chat.pickers.destination_pickers.output", {
						toolname: record.toolName,
					}),
					group: t("ui.chat.pickers.destination_pickers.tool_output"),
					meta: t("ui.chat.pickers.destination_pickers.chars", {
						length: record.output.length,
					}),
				});
			}
		}
		return rows;
	}, [canonical.transcript.records, locale]);

	const onPick = useCallback(
		async (value: string) => {
			const [kind, id, index] = value.split(":");
			const record = canonical.transcript.records.find((row) => row.id === id);
			let text = "";
			if (record?.kind === "assistant") {
				if (kind === "message") text = record.text;
				else if (kind === "quote")
					text = record.text
						.split("\n")
						.map((line) => `> ${line}`)
						.join("\n");
				else if (kind === "code") {
					const fences = record.text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
					text = (fences[Number(index)] ?? "")
						.replace(/^```[\w-]*\n/, "")
						.replace(/```$/, "");
				}
			} else if (record?.kind === "tool" && kind === "output") {
				text = record.output ?? "";
			}
			try {
				await navigator.clipboard.writeText(text);
				setResult({
					tone: "success",
					text: t("ui.chat.pickers.destination_pickers.copied_characters", {
						length: text.length,
					}),
				});
			} catch (error) {
				setResult({
					tone: "error",
					text: t("ui.chat.pickers.destination_pickers.clipboard_refused", {
						errortext: errorText(error),
					}),
				});
			}
		},
		[canonical.transcript.records],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.copy.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.pick_a_message_a_code_block_or_a_quoted_excerpt_it_goes_to_the_clipboard",
			)}
			options={options}
			emptyText={t("ui.chat.pickers.destination_pickers.nothing_to_copy_yet")}
			onPick={onPick}
			result={result}
		/>
	);
};

// ------------------------------------------------------------- resume/new

export const ResumePicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
	action,
}) => {
	const locale = useI18nLocale();
	const rows = useSessionRows();
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return (rows.data ?? [])
			.slice()
			.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
			.map((row) => ({
				value: row.id,
				label: sessionLabel(row),
				description: sessionActivity(
					row,
					t(
						"ui.chat.pickers.destination_pickers.cold_reopens_on_the_next_message",
					),
				),
				meta: new Date((row.mtime ?? 0) * 1000).toLocaleString(),
				current: row.id === sessionId,
				keywords: [row.id],
			}));
	}, [rows.data, sessionId, locale]);
	// `/resume <id>` with a known id is a direct pick.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted || !rows.data) return;
		const hit = rows.data.find(
			(row) => row.id === wanted || sessionLabel(row) === wanted,
		);
		if (hit) {
			rebind(hit.id);
			setResult({
				tone: "success",
				text: t("ui.chat.pickers.destination_pickers.resumed", {
					sessionlabel: sessionLabel(hit),
				}),
			});
		}
	}, [action.args, rows.data, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.resume.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.every_canonical_session_live_or_cold_picking_one_attaches_this_window_to",
			)}
			options={options}
			loading={rows.isLoading}
			loadError={rows.isError ? errorText(rows.error) : null}
			searchPlaceholder={t(
				"ui.chat.pickers.destination_pickers.search_by_title_or_id",
			)}
			onPick={(value, option) => {
				rebind(value);
				setResult({
					tone: "success",
					text: t("ui.chat.pickers.destination_pickers.resumed_2d9cda", {
						label: option.label,
					}),
				});
			}}
			result={result}
		/>
	);
};

export const NewSessionPicker: FC<PickerContext> = ({
	canonical,
	onClose,
	rebind,
}) => {
	useI18nLocale();
	const [cwd, setCwd] = useState(canonical.frontend?.cwd ?? "");
	const op = useOperation();
	const createSession = useCanonicalSessionsStore(
		(state) => state.createSession,
	);
	const submit = useCallback(async () => {
		const value = await op.perform(
			async () => {
				const id = await createSession(
					cwd.trim() || (canonical.frontend?.cwd ?? "~"),
				);
				if (!id) throw new Error("the backend did not return a session id");
				return id;
			},
			(id) => ({
				tone: "success",
				text: t(
					"ui.chat.pickers.destination_pickers.new_conversation_the_previous_one_keeps_running",
					{ id: id },
				),
			}),
			t("ui.chat.pickers.destination_pickers.the_conversation_was_not_created"),
		);
		if (value) rebind(value);
	}, [op, createSession, cwd, canonical.frontend?.cwd, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.new_session.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.starts_a_fresh_canonical_session_work_in_the_current_one_continues",
			)}
			form={
				<PickerField
					label={t("ui.chat.pickers.destination_pickers.working_directory")}
					hint={t(
						"ui.chat.pickers.destination_pickers.must_exist_on_this_machine",
					)}
				>
					<Input value={cwd} onChange={(event) => setCwd(event.target.value)} />
				</PickerField>
			}
			onSubmit={submit}
			submitLabel={t("ui.chat.pickers.destination_pickers.create")}
			submitDisabled={!cwd.trim()}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// --------------------------------------------------------------- forms

export const GoalPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	useI18nLocale();
	const frontend = canonical.frontend;
	const current = frontend?.goal ?? "";
	const [goal, setGoal] = useState(current);
	const command = useSessionCommand(sessionId);
	/*
	 * `Mark done` owns its own press (agent review round 2, MINOR 2's rule): a command
	 * in flight on the danger button must not disable the safe one beside it.
	 */
	const doneCommand = useSessionCommand(sessionId);
	/*
	 * THE SAME TWO GATES THE CHIP USES, for the same two reasons. `done` decides which
	 * actions exist (a settled goal cannot be marked done twice) and `capable` decides
	 * whether the new argument may be sent at all: on a backend without the new wire
	 * fields, `Mark done` is not rendered, so `/goal done` can never reach a build that
	 * would store the literal word as the user's goal.
	 */
	const done = frontend?.goal_status === "done";
	const capable = goalCapability(frontend);
	const judge = frontend?.goal_judge ?? null;
	/*
	 * WHETHER THERE IS A GOAL FOR A JUDGE TO BE READING (design review round 1, D5).
	 *
	 * `capable` is `typeof goal_status === "string"`, so it is true on any new backend
	 * — INCLUDING one whose goal is the empty string — and `judgeWord` then falls back
	 * to `idle`. `/goal` opened on a session with no goal therefore printed
	 * `Judge: idle`: a readout about a judge with nothing to judge, in the picker whose
	 * whole job at that moment is to take the first goal. The row's own rule for the
	 * same state is to paint the judge's resting state NOWHERE (`goalStateWord` returns
	 * `""` and the chip says nothing at all), and this row follows it —
	 * including the TRIM, because the row treats a whitespace-only goal as no goal and
	 * the picker's field is the one place such a value can be typed.
	 */
	const hasGoal = goalPresent(frontend);
	/*
	 * The judge's state, in the chip's own vocabulary (`goalStateWord`) so the dialog
	 * and the row cannot describe one state with two words. A goal at rest gets the
	 * word instead of the chip's deliberate silence, because a readout with room for it
	 * has to say something — and `stalled` carries the clause the user needs to act on.
	 */
	const judgeWord =
		goalStateWord(frontend?.goal_status, judge?.state) ||
		(judge?.state === "waiting" ? "waiting" : "idle");
	const judgeLine =
		judgeWord === "stalled"
			? t(
					"ui.chat.pickers.destination_pickers.stalled_send_a_message_to_continue",
				)
			: judgeWord;
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.goal.title")}
			/*
			 * NEUTRAL ON PURPOSE (design review round 1, D3). `done` has TWO authors — the
			 * judge's ACHIEVED and the user's own `Done` press / `/goal --done` — and on the
			 * user's path the history entry's `reason` is `""`, which the wire's own docblock
			 * calls "an act of judgement by a person, not a model verdict". The shipped
			 * sentence attributed that act to the judge and then contradicted the `Judge` row
			 * directly beneath it, which reads `waiting`/`idle` in exactly that case. This
			 * sentence names the RECORD rather than the decider, so it is true of both
			 * authors and of a goal settled by either route.
			 */
			description={
				done
					? /*
						 * THE SETTLED SENTENCE, AND IT NOW POINTS AT THE RECORD (UX round 1, U5). The
						 * sentence names the history and this dialog is the one surface that names it
						 * in words — but it named it without offering a way there, and the two routes
						 * that exist are a 24px icon-only segment and a typed `/goal --history`. The
						 * clause added here names the segment's own word (`Goals view`, its accessible
						 * name) so the pointer is followable: a user told to look for a `Goals view`
						 * can find the one control that answers to it. ONE route and not two: the
						 * canvas view is the discoverable one, and the typed command keeps its place
						 * in the `/goal` receipt rather than being repeated in a description.
						 */
						t(
							"ui.chat.pickers.destination_pickers.this_goal_is_settled_it_stays_in_the_goal_history_dismiss_it_to_clear_th",
						)
					: current
						? t(
								"ui.chat.pickers.destination_pickers.the_standing_goal_is_prepended_to_every_turn_clear_it_to_remove_it",
							)
						: t(
								"ui.chat.pickers.destination_pickers.a_standing_goal_the_agent_keeps_in_view_on_every_turn",
							)
			}
			form={
				<>
					{/*
					 * THE STRUCK VALUE, while the goal is done — the same settled paint the
					 * chip and the pane use (`line-through text-ink-dim` on the value, the
					 * app's role for a record rather than an instruction). It carries NO new
					 * copy: the word is the wire's `done`, already in the description above and
					 * in the Judge row below, and this element is the VALUE.
					 *
					 * The field beneath is still a live textarea, and that is deliberate: a
					 * struck textarea is not a thing, and the picker is where a user types the
					 * goal that supersedes this one. So the settled state is stated here and the
					 * editable value stays editable, rather than the one being sacrificed to the
					 * other.
					 */}
					{done && (
						<p className={cn("text-body-sm text-ink-dim line-through")}>
							{current}
						</p>
					)}
					<PickerField label={t("ui.chat.pickers.destination_pickers.goal")}>
						<Textarea
							value={goal}
							onChange={(event) => setGoal(event.target.value)}
							rows={3}
							placeholder={t("ui.chat.pickers.goal.placeholder")}
						/>
					</PickerField>
					{/*
					 * THE JUDGE ROW EXISTS ONLY WHERE THERE IS A JUDGE TO READ, which is why the
					 * backend publishes `goal_judge` — the same capability signal the actions are
					 * gated on — AND a goal for it to be reading (design review round 1, D5: the
					 * capability alone is true on a session with no goal, and `/goal` then printed
					 * `Judge: idle` about a goal that does not exist). Showing it on a backend that
					 * has no judge would invent a state out of the absent field; showing it with no
					 * goal would invent a judge.
					 */}
					{capable && hasGoal && (
						<PickerField label={t("ui.chat.pickers.destination_pickers.judge")}>
							<span className="text-ink-muted text-body-sm">{judgeLine}</span>
						</PickerField>
					)}
				</>
			}
			onSubmit={() => void command.run(GOAL_COMMAND, goal.trim())}
			submitLabel={t("ui.chat.pickers.destination_pickers.set_goal")}
			submitDisabled={!goal.trim()}
			actions={
				current ? (
					<>
						{capable && !done && (
							<Button
								variant="secondary"
								size="sm"
								type="button"
								onClick={() =>
									void doneCommand.run(GOAL_COMMAND, GOAL_DONE_ARGS)
								}
								disabled={doneCommand.busy}
							>
								{t("ui.chat.pickers.goal.mark_done")}
							</Button>
						)}
						<Button
							variant="danger"
							size="sm"
							type="button"
							onClick={() => void command.run(GOAL_COMMAND, GOAL_CLEAR_ARGS)}
							disabled={command.busy}
						>
							{t("ui.chat.pickers.goal.clear")}
						</Button>
					</>
				) : undefined
			}
			busy={command.busy}
			result={command.result}
		/>
	);
};

const APPROVAL_DESCRIPTIONS: Record<string, string> = {
	get ask() {
		return t(
			"ui.chat.pickers.destination_pickers.write_and_command_tools_prompt_before_running",
		);
	},
	get auto() {
		return t("ui.chat.pickers.destination_pickers.tools_run_without_asking");
	},
};

export const ApprovalsPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	useI18nLocale();
	const defaultScope = (action.data as { scope?: string }).scope === "default";
	const [scope, setScope] = useState<"session" | "default">(
		defaultScope ? "default" : "session",
	);
	const entities = useEntities<{ value: string }>(sessionId, "approvals");
	const command = useSessionCommand(sessionId);
	const settingsOp = useOperation();
	const defaults = useQuery({
		queryKey: ["desktop", "settings", "tool_approval_mode"],
		queryFn: () =>
			desktopResult<{ settings: { key: string; value: unknown }[] }>({
				op: "settings.list",
			}).then((result) =>
				result.settings.find((row) => row.key === "tool_approval_mode"),
			),
		staleTime: 10_000,
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(entities.data?.entities ?? [{ value: "ask" }, { value: "auto" }]).map(
				(row) => ({
					value: row.value,
					label: row.value,
					description: APPROVAL_DESCRIPTIONS[row.value],
					current:
						scope === "default"
							? defaults.data?.value === row.value
							: entities.data?.current === row.value,
				}),
			),
		[entities.data, defaults.data, scope],
	);
	const onPick = useCallback(
		async (value: string) => {
			if (scope === "session") {
				await command.run("approvals", value);
				return;
			}
			// Default scope writes the typed settings key. The saved default applies
			// to live conversations that follow it; a conversation with its own
			// explicit choice keeps it — the result sentence says both, rather than
			// asserting this session was left unchanged.
			await settingsOp.perform(
				() =>
					desktopResult<{ key: string; value: unknown }>({
						op: "settings.edit",
						key: "tool_approval_mode",
						value,
					}),
				(row) => ({
					tone: "success",
					text: t(
						"ui.chat.pickers.destination_pickers.default_approvals_for_all_sessions_that_follow_it_this_session_follows_i",
						{ string: String(row?.value ?? value) },
					),
				}),
				t("ui.chat.pickers.destination_pickers.the_default_was_not_saved"),
			);
			await defaults.refetch();
		},
		[scope, command, settingsOp, defaults],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.approvals.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.whether_write_and_command_tools_ask_before_running",
			)}
			options={options}
			loading={entities.isLoading}
			onPick={onPick}
			toolbar={
				<PickerSegment
					label={t("ui.chat.pickers.destination_pickers.scope")}
					value={scope}
					onChange={setScope}
					options={[
						{
							value: "session",
							label: t("ui.chat.pickers.destination_pickers.this_session"),
						},
						{
							value: "default",
							label: t(
								"ui.chat.pickers.destination_pickers.default_for_all_sessions_that_follow_it",
							),
						},
					]}
				/>
			}
			busy={command.busy || settingsOp.busy}
			result={settingsOp.result ?? command.result}
		/>
	);
};

/**
 * The selection a DRAFT's fast pick rides, or `null` when nothing names a model.
 *
 * A DIAL IS A PROPERTY OF THE MODEL, so a pick has to name one even when the
 * pane never picked a model itself: `sessions.create` takes the pair, and a
 * `fast_mode` with no model beside it would be a dial with nothing to dial. The
 * pair is read off the resolution the pane is already showing (`sessions.preview`
 * through `bandReadings`, the same spec the model chip names), so the
 * conversation is born on the model the pane advertised rather than on a second
 * guess at it.
 *
 * THE RUNG IS NOT SEEDED FROM THAT RESOLUTION, and `selectionFromModel` is not
 * used here for exactly that reason: its `reasoning_effort` is the level the
 * first turn will RUN at, and recording it would turn the resolver's reading
 * into a choice nobody made (the marker's `null` means "this model, no level").
 * A pane that already holds a selection keeps it whole — the `picked` branch —
 * so a rung chosen before the dial is neither dropped nor invented here.
 */
function dialSelection(
	picked: DesktopModelSelection | null,
	identity: CanonicalModel | null,
): DesktopModelSelection | null {
	if (picked) return picked;
	if (!identity?.provider || !identity.model_id) return null;
	return {
		provider: identity.provider,
		model_id: identity.model_id,
		reasoning_effort: null,
	};
}

/**
 * What the backend's own resolution of a DRAFT's fast pick says about it.
 *
 * ONE reading for two decisions (`useDraftPick`'s `applied` check and the result
 * sentence), because the pick must not be recorded unless this answers applied —
 * and the sentence must be the one the check just agreed with. It names the
 * RESOLVED dial rather than the requested value, which is the only honest way to
 * say what the first turn will run when a backend parses the field and drops it.
 *
 * `null` is the model reporting no fast tier (`fastModeState`'s third state):
 * there is no dial on the model, so the two directions are not symmetrical. `on`
 * cannot be honoured — the birth contract refuses it with a 422, and a backend
 * that ignored the field lands here — while `off` is what the model already is,
 * so the pick is applied and nothing moves. The sentence says that instead of
 * claiming a dial the model does not have.
 *
 * EXPORTED FOR THE SUITE: these are the sentences the pick shows, and the
 * DIRECTION of a failed pick is exactly the kind of claim that can be wrong with
 * no other on-screen signal (design review round 1, D4).
 */
export function draftFastReading(
	resolved: CanonicalFrontendSync,
	requested: "on" | "off",
): { applied: boolean; sentence: string } {
	const dial = fastModeState(bandReadings(resolved.snapshot, null).identity);
	if (dial === null) {
		return {
			applied: requested === "off",
			sentence: "This model does not support fast mode, so it stays off.",
		};
	}
	if (dial === requested) {
		return {
			applied: true,
			sentence:
				dial === "on"
					? "Fast mode is on for the first message."
					: "Fast mode is off for the first message.",
		};
	}
	return {
		applied: false,
		/*
		 * The direction is read from BOTH dials, because this branch is reachable in
		 * both: a resolution that did not apply `on` names the off it got, and one
		 * that did not apply `off` must not be told it "was not turned on".
		 */
		sentence: `Fast mode is ${dial} for this model, so it was not turned ${
			requested === "on" ? "on" : "off"
		}.`,
	};
}

export const FastPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
	draft,
	note,
}) => {
	useI18nLocale();
	const command = useSessionCommand(sessionId);
	const draftPick = useDraftPick(draft, note);
	/*
	 * A DRAFT pane's dial, read off the ONE query the pane itself reads.
	 *
	 * Same key, same fetch as the composer's strip and the model dialog, so the
	 * option this picker marks is the dial the pane's model chip badges — one
	 * reading for two surfaces, the rule the session half already keeps. Mounted
	 * (disabled) outside draft mode because hooks cannot be conditional.
	 */
	const draftPreview = useQuery({
		...draftPreviewQuery(
			draftPick.target ?? NO_DRAFT_TARGET,
			draftPick.carriesFast,
		),
		enabled: Boolean(draft),
	});
	/*
	 * The identity the pane is showing: the model the first turn will run, and
	 * therefore the model a dial pick has to name (`dialSelection`). Read off the
	 * same entry the chip prints, so the conversation is born on the model the
	 * pane advertised rather than on a second guess.
	 */
	const draftIdentity = draft
		? bandReadings(draftPreview.data?.snapshot, null).identity
		: null;
	const [acknowledged, setAcknowledged] = useState(false);
	const premium = Boolean(
		(action.data as { premium_pricing?: boolean }).premium_pricing,
	);
	/*
	 * The dial comes off the same `effective_model ?? selected_model` spec the
	 * `/fast` row's slot states, through this file's held-aware
	 * `runningFrontend` so a held pane answers with the copy the strip paints —
	 * the option the picker marks is the dial the row just advertised, one read
	 * for two surfaces (UX round 1, U2).
	 *
	 * A DRAFT has no owner frame to read: its dial is the one `sessions.preview`
	 * resolved for the selection in force, through `bandReadings` — the SAME
	 * function the strip prints through, so the mark and the model chip's badge
	 * cannot name different dials (issue #1265).
	 */
	const dial = fastModeState(
		draft
			? draftIdentity
			: (runningFrontend(canonical)?.effective_model ??
					runningFrontend(canonical)?.selected_model),
	);
	/*
	 * The premium gate stays here rather than in the builder: it is the
	 * picker's own acknowledgement state, not a property of the dial.
	 */
	const options: PickerOption[] = fastPickerOptions(dial).map((option) =>
		option.value === "on" && premium && !acknowledged
			? { ...option, disabled: true }
			: option,
	);
	/*
	 * A draft's pick: resolved by the backend for the selection in force, then
	 * recorded on the pane — never a session command, which would address a
	 * conversation this pane does not have. `null` is the honest input when the
	 * preview has not named a model yet; the hook refuses it out loud rather than
	 * recording a dial that names no model to apply it to.
	 */
	const draftFast = (value: string) => {
		const requested = value === "on" ? "on" : "off";
		const selection = dialSelection(draftPick.selection, draftIdentity);
		void draftPick.pick(
			selection ? { ...selection, fast_mode: requested === "on" } : null,
			{
				describe: (resolved) => draftFastReading(resolved, requested).sentence,
				failure: fastPickFailure,
				applied: {
					refusal: (resolved) => {
						const reading = draftFastReading(resolved, requested);
						return reading.applied ? null : reading.sentence;
					},
				},
			},
		);
	};
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.fast.title")}
			/*
			 * A DRAFT speaks "conversation", because that is what its first message
			 * starts; "this session" is the noun of a pane that has one, and the
			 * result strip in this same dialog already says "for the first message"
			 * (design review round 1, D3). The draft sentence rides as the literal
			 * main shipped: the canvas translations were audited before it existed,
			 * and a new English key here would fail coverage for all seven locales.
			 */
			description={
				draft
					? "Applies to the conversation this chat starts."
					: t(
							"ui.chat.pickers.destination_pickers.applies_to_this_session_only",
						)
			}
			options={options}
			onPick={(value) =>
				draft ? draftFast(value) : void command.run("fast", value)
			}
			toolbar={
				premium ? (
					<PickerCheck
						checked={acknowledged}
						onCheckedChange={setAcknowledged}
						tone="ink"
					>
						{t("ui.chat.pickers.fast.premium_acknowledgement")}
					</PickerCheck>
				) : undefined
			}
			busy={draft ? draftPick.busy : command.busy}
			result={draft ? draftPick.result : command.result}
		/>
	);
};

/**
 * The requester's own name for the conversation a request addressed, when it
 * sent one (#920).
 *
 * The defensive read the fork entry's pair established (`readForkEntryId`):
 * `action.data` is `Record<string, unknown>` on a value the app received, and a
 * non-string or blank value has to mean "no name" - the pane-fed seed every
 * door but the row menu's has always had - rather than a field the dialog opens
 * on.
 */
function readSubjectName(data: Record<string, unknown>): string | null {
	const value = data.subjectName;
	return typeof value === "string" && value.trim() ? value : null;
}

/**
 * What a rename submit should write, or `null` when it must write nothing.
 *
 * THE UNCHANGED SUBMIT IS A NO-OP, the guarantee the header's inline editor
 * keeps (`next === agentName` closes without a command, `chat-header.tsx`): an
 * unedited Enter changes nothing the user can SEE, while WRITING it can make a
 * placeholder real - an untitled row seeds this dialog with the sidebar's
 * display fallback (`Untitled chat`), and a write would store that string as
 * the conversation's explicit, user-set name, retiring the naming errand
 * (`chat-title.ts`'s constraint). Blank is the same no-op: the submit control
 * is disabled for it, and an Enter that races the re-render is still not a
 * rename to nothing.
 *
 * `openedWith` is the field's mount-time seed, passed rather than re-read from
 * the props so the comparison is against what the user was shown (see the
 * state beside it in `RenamePicker`).
 */
export function renameSubmission(input: {
	name: string;
	openedWith: string;
}): string | null {
	const next = input.name.trim();
	if (!next || next === input.openedWith.trim()) return null;
	return next;
}

export const RenamePicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
}) => {
	useI18nLocale();
	/*
	 * THE SEED, in precedence order. `action.args` is a rename that came with its
	 * name in hand; `readSubjectName` is the ROW's own displayed name, carried by
	 * a request raised outside the pane (#920) - the requester right-clicked a
	 * row it never opened, so `canonical.frontend` (the PANE's reading) is
	 * generally NOT that conversation's name, and seeding from it would offer
	 * the wrong name to a user renaming a row they have not opened; and the
	 * canonical title stays the pane path's own seed, unchanged.
	 */
	const [name, setName] = useState(
		action.args ||
			readSubjectName(action.data) ||
			canonical.frontend?.conversation_title ||
			"",
	);
	/*
	 * WHAT THE FIELD OPENED WITH, held beside `name` because the submit guard is
	 * about the value the user was SHOWN: re-reading the props at submit time
	 * could compare an edit against a reading the user never saw (the pane's
	 * title moves on its own stream frames). `useState`'s initial value is the
	 * first render's, which is exactly the mount-time seed.
	 */
	const [openedWith] = useState(name);
	/*
	 * WHETHER THIS DIALOG IS STILL THE ONE ON SCREEN. The submit below reports
	 * its outcome to an owner that renders ONE picker at a time (`closePicker` is
	 * `setPicker(null)`, `slash-dispatch.ts`), so a reader can dismiss this dialog
	 * while the rename is in flight and open another in the same slot; a success
	 * that then called `onClose()` would dismiss the picker they had just opened.
	 * `closed` is set at unmount, the only moment the dialog is definitively gone -
	 * the same latch `ReloadPicker` keeps for a failure that lands after its
	 * dialog is gone (review U6).
	 *
	 * ARMED AT SETUP, not only disarmed at unmount: StrictMode's development
	 * mount/unmount/mount runs this cleanup and then mounts the SAME instance in
	 * the same slot, so a latch that only ever closed would keep a dev build's
	 * dialog from ever closing on success.
	 */
	const closed = useRef(false);
	useEffect(() => {
		closed.current = false;
		return () => {
			closed.current = true;
		};
	}, []);
	const command = useSessionCommand(sessionId);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.rename.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.an_explicit_name_takes_precedence_over_the_generated_title",
			)}
			form={
				<PickerField label={t("ui.chat.pickers.destination_pickers.name")}>
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						autoFocus
					/>
				</PickerField>
			}
			onSubmit={async () => {
				const next = renameSubmission({ name, openedWith });
				/*
				 * A no-op submit CLOSES without a command - the header editor's exit
				 * for the same input (see `renameSubmission` above).
				 */
				if (next === null) {
					onClose();
					return;
				}
				const { result } = await command.run("rename", next);
				/*
				 * SUCCESS ENDS THE DIALOG, and the receipt becomes a toast: closing is
				 * otherwise the end of the one confirmation a rename ever prints.
				 * Failure, warning and a "needs more input" answer keep the dialog and
				 * its inline reason; an unchanged submit closed above without a write.
				 *
				 * THE CLOSE BELONGS TO THE DIALOG THAT IS STILL THERE. The receipt is
				 * unconditional - it has to survive the dialog - but `onClose` names the
				 * pane's single slot, so a reader who dismissed this dialog mid-flight
				 * and opened another picker must not have that one closed by this rename
				 * (see `closed`).
				 *
				 * AND A NON-SUCCESS HAS TO LAND SOMEWHERE TOO (agent review round 1,
				 * R1-1). The strip that carries a refusal lives inside the dialog, and
				 * the footer's busy-state Close does not cancel the command - so a refusal
				 * that lands after the reader dismissed this dialog would otherwise be
				 * reported NOWHERE, and the signature of a rename that did not happen is
				 * silence.
				 *
				 * THE CARRIER FOLLOWS THE TONE because a warning's colour and a warning's
				 * de-dupe behaviour are not an error's: `showErrorToast` drops a repeat of
				 * the same sentence for five seconds, so a warning that rode it could lose
				 * exactly the retry this branch exists to announce. `info` is a
				 * `native_action`/`block` receipt - no `_rename_slash` branch returns one
				 * today, but this branch should not speak for a tone it does not have.
				 * `ReloadPicker`'s late failure (review U6) is the same carrier decision on
				 * an error-only path. While the dialog is up the strip carries it, so this
				 * branch is the only one that speaks.
				 */
				if (result.tone === "success") {
					showSuccessToast(result.text);
					if (!closed.current) onClose();
				} else if (closed.current) {
					if (result.tone === "warning") showWarningToast(result.text);
					else if (result.tone === "error") showErrorToast(result.text);
					else showInfoToast(result.text);
				}
			}}
			submitLabel={t("ui.chat.pickers.destination_pickers.rename")}
			submitDisabled={!name.trim()}
			busy={command.busy}
			result={command.result}
		/>
	);
};

export const LoopPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
}) => {
	useI18nLocale();
	const command = useSessionCommand(sessionId);
	const cancel = useSessionCommand(sessionId);
	const [mode, setMode] = useState<"count" | "goal">("count");
	const [count, setCount] = useState("3");
	const [goal, setGoal] = useState(action.args || "");
	const loop = (canonical.frontend?.loop ?? null) as DesktopLoopState | null;
	/*
	 * The moving-loop predicate, imported rather than restated: the composer's status
	 * row gates the same two states with the same function, and a second copy of the
	 * truth table is a second answer to "can this loop be stopped" (agent review
	 * round 1, MINOR 1).
	 */
	const running = loop !== null && loopIsRunning(loop.status);
	const standingGoal = canonical.frontend?.goal ?? "";
	const submit = useCallback(async () => {
		const args = mode === "count" ? count.trim() : goal.trim();
		if (!args) return;
		await command.run(LOOP_COMMAND, args);
	}, [command, mode, count, goal]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.loop.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.repeats_turns_toward_a_goal_approval_and_question_gates_still_stop_and_w",
			)}
			body={
				loop && loop.status !== "idle" ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<PickerKeyValue
							label={t("ui.chat.pickers.destination_pickers.status")}
							value={loop.status}
						/>
						<PickerKeyValue
							label={t("ui.chat.pickers.destination_pickers.completed")}
							value={
								loop.iterations
									? t("ui.chat.pickers.destination_pickers.completed_of", {
											completed: loop.completed,
											iterations: loop.iterations,
										})
									: t("ui.chat.pickers.destination_pickers.completed_only", {
											completed: loop.completed,
										})
							}
						/>
						{loop.goal && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.goal")}
								value={loop.goal}
								mono={false}
							/>
						)}
						{loop.reason && (
							<PickerKeyValue
								label={t("ui.chat.pickers.destination_pickers.reason")}
								value={loop.reason}
								mono={false}
							/>
						)}
					</div>
				) : undefined
			}
			form={
				running ? undefined : (
					<div className="flex flex-col gap-3">
						<PickerSegment
							label={t("ui.chat.pickers.destination_pickers.loop_mode")}
							value={mode}
							onChange={setMode}
							options={[
								{
									value: "count",
									label: t(
										"ui.chat.pickers.destination_pickers.fixed_number_of_turns",
									),
								},
								{
									value: "goal",
									label: t(
										"ui.chat.pickers.destination_pickers.until_a_goal_is_met",
									),
								},
							]}
						/>
						{mode === "count" ? (
							<PickerField
								label={t("ui.chat.pickers.destination_pickers.turns_1_to_25")}
								hint={
									standingGoal
										? t(
												"ui.chat.pickers.destination_pickers.uses_the_standing_goal",
												{ standinggoal: standingGoal },
											)
										: t(
												"ui.chat.pickers.destination_pickers.set_a_standing_goal_with_goal_first_or_switch_to_a_goal_loop",
											)
								}
							>
								<Input
									type="number"
									min={1}
									max={25}
									value={count}
									onChange={(event) => setCount(event.target.value)}
								/>
							</PickerField>
						) : (
							<PickerField
								label={t("ui.chat.pickers.destination_pickers.goal")}
								hint={t(
									"ui.chat.pickers.destination_pickers.a_judge_decides_when_it_is_met",
								)}
							>
								<Textarea
									value={goal}
									onChange={(event) => setGoal(event.target.value)}
									rows={3}
								/>
							</PickerField>
						)}
					</div>
				)
			}
			onSubmit={running ? undefined : submit}
			submitLabel={t("ui.chat.pickers.destination_pickers.start_loop")}
			submitDisabled={
				mode === "count" ? !count.trim() || !standingGoal : !goal.trim()
			}
			actions={
				running ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={() => void cancel.run(LOOP_COMMAND, LOOP_STOP_ARGS)}
						disabled={cancel.busy}
					>
						{t("ui.chat.pickers.loop.cancel")}
					</Button>
				) : undefined
			}
			busy={command.busy || cancel.busy}
			result={cancel.result ?? command.result}
		/>
	);
};

export const CredentialPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
	const locale = useI18nLocale();
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [confirmForget, setConfirmForget] = useState(false);
	const op = useOperation();
	const list = useQuery({
		queryKey: desktopKeys.credentials(sessionId),
		queryFn: () =>
			desktopResult<unknown>({
				op: "sessions.credential",
				sessionId,
				action: "list",
			}),
	});
	/*
	 * THE ANSWER IS OBJECTS, NOT STRINGS: `{"credentials": [{"key": …, "source":
	 * …}]}` (`local_operator/session/credential_ops.py:59-64`). Read as
	 * `string[]`, every row reached React as an object and this panel crashed the
	 * renderer on its FIRST successful list — error #31, "Something went wrong",
	 * on the door §1 keeps open for the store, the list and the forget verbs (QA
	 * round 1, Q3). The reading lives in `credential-capture.ts` beside the mint
	 * guard that needs the same names, so the two cannot drift apart again.
	 */
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return credentialNamesFrom(list.data).map((name) => ({
			value: name,
			label: name,
			meta: t("ui.chat.pickers.destination_pickers.stored"),
			current: name === key,
		}));
	}, [list.data, key, locale]);
	const store = useCallback(async () => {
		if (!key.trim() || !value) return;
		await op.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.credential",
					sessionId,
					action: "store",
					key: key.trim(),
					value,
				}),
			() => ({
				tone: "success",
				text: t(
					"ui.chat.pickers.destination_pickers.stored_the_value_was_not_echoed",
					{ value: key.trim() },
				),
			}),
			t("ui.chat.pickers.destination_pickers.the_credential_was_not_stored"),
		);
		// The secret leaves renderer memory as soon as the backend has it.
		setValue("");
		await list.refetch();
	}, [op, sessionId, key, value, list]);
	const forget = useCallback(async () => {
		if (!key.trim() || !confirmForget) return;
		await op.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.credential",
					sessionId,
					action: "forget",
					key: key.trim(),
					confirmed: true,
				}),
			() => ({
				tone: "success",
				text: t("ui.chat.pickers.destination_pickers.forgot", {
					value: key.trim(),
				}),
			}),
			t("ui.chat.pickers.destination_pickers.the_credential_was_not_removed"),
		);
		setConfirmForget(false);
		await list.refetch();
	}, [op, sessionId, key, confirmForget, list]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.credential.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.stores_a_secret_for_this_session_s_tools_by_name_the_value_never_appears",
			)}
			options={options}
			loading={list.isLoading}
			emptyText={t(
				"ui.chat.pickers.destination_pickers.no_credentials_stored_yet",
			)}
			onPick={(picked) => setKey(picked)}
			form={
				<div className="flex flex-col gap-3">
					<PickerField label={t("ui.chat.pickers.destination_pickers.name")}>
						<Input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							placeholder={t("ui.chat.pickers.destination_pickers.my_api_key")}
							// i18n: ignore sample environment variable name, not prose
							autoComplete="off"
						/>
					</PickerField>
					<PickerField
						label={t("ui.chat.pickers.destination_pickers.value")}
						hint={t(
							"ui.chat.pickers.destination_pickers.masked_cleared_after_storing",
						)}
					>
						<Input
							type="password"
							value={value}
							onChange={(event) => setValue(event.target.value)}
							autoComplete="new-password"
						/>
					</PickerField>
					{options.some((option) => option.value === key.trim()) && (
						<PickerCheck
							checked={confirmForget}
							onCheckedChange={setConfirmForget}
							tone="ink"
						>
							{t("ui.chat.pickers.credential.forget_confirmation", {
								name: key.trim(),
							})}
						</PickerCheck>
					)}
				</div>
			}
			onSubmit={store}
			submitLabel={t("ui.chat.pickers.destination_pickers.store")}
			submitDisabled={!key.trim() || !value}
			actions={
				confirmForget ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={forget}
						disabled={op.busy}
					>
						{t("ui.chat.pickers.credential.forget")}
					</Button>
				) : undefined
			}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// ------------------------------------------------------------ auth flows

export const LoginPicker: FC<PickerContext> = ({ onClose, action }) => {
	const locale = useI18nLocale();
	const navigate = useNavigate();
	const providers = useDesktopProviders(true);
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return (providers.data ?? []).map((provider: DesktopProvider) => ({
			value: provider.id,
			label: provider.name,
			description: provider.auth_methods
				.map((method) => method.label)
				.join(", "),
			meta: provider.configured
				? t("ui.chat.pickers.destination_pickers.stored54112c", {
						stored_credentials: provider.stored_credentials,
					})
				: undefined,
			current: provider.configured,
			keywords: provider.search_aliases,
			group: provider.configured
				? t("ui.chat.pickers.destination_pickers.signed_in")
				: t("ui.chat.pickers.destination_pickers.available"),
		}));
	}, [providers.data, locale]);
	// `/login <provider>` opens that provider directly.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted || !providers.data) return;
		const hit = providers.data.find(
			(provider) =>
				provider.id === wanted || provider.search_aliases.includes(wanted),
		);
		if (hit) {
			navigate(
				`/settings?section=providers&provider=${encodeURIComponent(hit.id)}`,
			);
			onClose();
		}
	}, [action.args, providers.data, navigate, onClose]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.login.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.opens_the_provider_s_sign_in_methods_in_settings_browser_and_device_flow",
			)}
			options={options}
			loading={providers.isLoading}
			loadError={providers.isError ? errorText(providers.error) : null}
			onPick={(value) => {
				navigate(
					`/settings?section=providers&provider=${encodeURIComponent(value)}`,
				);
				onClose();
			}}
		/>
	);
};

/*
 * `/v1/auth/status`'s row shape. Exported because the composer's `/logout`
 * argument list reads the same route under the same query key
 * (`slash-commands.tsx`), and a second spelling of this wire shape is how the
 * two readers drift.
 */
export type StoredAccount = {
	id: number;
	provider: string;
	type: string;
	identity_label: string;
	source: string;
	state: string;
};

export const LogoutPicker: FC<PickerContext> = ({ onClose, action }) => {
	useI18nLocale();
	const queryClient = useQueryClient();
	const accounts = useQuery({
		queryKey: desktopKeys.accounts,
		queryFn: () =>
			desktopResult<{ accounts: StoredAccount[] }>({
				op: "accounts.list",
			}).then((result) => result.accounts ?? []),
	});
	const [selected, setSelected] = useState<number | null>(null);
	const [confirmed, setConfirmed] = useState(false);
	const op = useOperation();
	const wanted = action.args.trim();
	const options = useMemo<PickerOption[]>(
		() =>
			(accounts.data ?? [])
				.filter((account) => !wanted || account.provider === wanted)
				.map((account) => ({
					value: String(account.id),
					label: `${account.provider}: ${account.identity_label}`,
					description: `${account.type}, ${account.source}`,
					meta: account.state,
					current: account.id === selected,
				})),
		[accounts.data, selected, wanted],
	);
	const submit = useCallback(async () => {
		if (selected === null || !confirmed) return;
		await op.perform(
			() =>
				desktopResult({
					op: "accounts.remove",
					accountId: selected,
					confirmed: true,
				}),
			() => ({
				tone: "success",
				text: t(
					"ui.chat.pickers.destination_pickers.signed_out_environment_variables_and_other_accounts_are_untouched",
				),
			}),
			t("ui.chat.pickers.destination_pickers.sign_out_failed"),
		);
		setConfirmed(false);
		setSelected(null);
		await queryClient.invalidateQueries({ queryKey: desktopKeys.accounts });
		await queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
		/*
		 * The catalogue goes with them: the listing is per-CREDENTIAL as well as
		 * per-model, so a removed account changes which rows a provider contributes
		 * (and whether it contributes any at all). The backend drops its cached
		 * listing documents on the same event (`providers/controller`, the same path
		 * a sign-in takes); what this drops is the renderer's copy, which no read
		 * would otherwise revisit until its 24h document expired.
		 */
		await queryClient.invalidateQueries({ queryKey: desktopKeys.catalogue });
	}, [op, selected, confirmed, queryClient]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.logout.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.removes_one_stored_account_credentials_supplied_through_environment_vari",
			)}
			options={options}
			loading={accounts.isLoading}
			loadError={accounts.isError ? errorText(accounts.error) : null}
			emptyText={
				wanted
					? t("ui.chat.pickers.destination_pickers.no_stored_account_for", {
							wanted: wanted,
						})
					: t("ui.chat.pickers.destination_pickers.no_stored_accounts")
			}
			onPick={(value) => setSelected(Number(value))}
			form={
				selected !== null ? (
					<PickerCheck
						checked={confirmed}
						onCheckedChange={setConfirmed}
						tone="ink"
					>
						{t("ui.chat.pickers.logout.confirm")}
					</PickerCheck>
				) : undefined
			}
			onSubmit={selected !== null ? submit : undefined}
			submitLabel={t("ui.chat.pickers.destination_pickers.sign_out")}
			submitDisabled={!confirmed}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// ------------------------------------------------------------- data views
/*
 * The five read-only diagnostic panels live in `panels/`, each split into a
 * presentational component and a `*-model.ts` that owns the decisions — the
 * `usage-view.tsx` / `usage-view-model.ts` shape, so a story renders the
 * production component over fixtures with no backend behind it.
 *
 * `pickers/panels/` is also where the panel primitives live (the region frame,
 * the four states, the stat card, the share meter, the bounded table and the
 * ONE chart wrapper), because a primitive that only one panel uses still has
 * to be named once: every chart in the app resolves its colours in one place,
 * or the theme promise has to be re-checked in every one of them.
 *
 * Re-exported here so `picker-registry.tsx` keeps importing every adapter from
 * one module.
 */
export { AnalyticsView } from "./panels/analytics-panel";
export { ContextView } from "./panels/context-panel";
export { FailoversView } from "./panels/failovers-panel";
export { InfoView } from "./panels/info-panel";
export { SessionView } from "./panels/session-panel";
export { UsageView } from "./usage-view";

// -------------------------------------------------------------------- help

export const HelpPalette: FC<PickerContext> = ({
	commands,
	onClose,
	dispatch,
}) => {
	const locale = useI18nLocale();
	const options = useMemo<PickerOption[]>(() => {
		void locale;
		return commands.map((command) => ({
			value: command.name,
			label: `/${command.name}${command.aliases.length ? `  (${command.aliases.map((a) => `/${a}`).join(", ")})` : ""}`,
			description: command.description,
			// The right-hand column used to print the routing id
			// (`transcript.clear`, `radient.mobile`) as the most prominent
			// thing on every row. That is internal vocabulary, not something a
			// user can act on, so the meta now says only what the command
			// TAKES. Destinations remain searchable below.
			meta:
				command.arguments === "none"
					? ""
					: command.arguments === "required"
						? t("ui.chat.pickers.destination_pickers.needs_an_argument")
						: t("ui.chat.pickers.destination_pickers.takes_an_argument"),
			keywords: [...command.aliases, command.destination, command.execution],
			group:
				command.execution === "owner"
					? t("ui.chat.pickers.destination_pickers.session_runs_on_the_owner")
					: t("ui.chat.pickers.destination_pickers.desktop"),
		}));
	}, [commands, locale]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.commands.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.commands_pick_one_to_run_it_commands_that_take_an_argument_open_their_pi",
				{ length: commands.length },
			)}
			options={options}
			searchPlaceholder={t(
				"ui.chat.pickers.destination_pickers.search_commands",
			)}
			onPick={(value) => {
				onClose();
				dispatch({ name: value, args: "" });
			}}
		/>
	);
};

// ---------------------------------------------------------------- reload

/**
 * The sentence's own head, in one place: the inline strip and the toast that
 * carries the same failure once the dialog is gone must not disagree (review U6).
 */
const RELOAD_FAILURE_PREFIX = () =>
	t(
		"ui.chat.pickers.destination_pickers.the_conversation_could_not_be_reopened",
	);

/**
 * The sentence a successful reload leaves behind.
 *
 * Its own function because it now has TWO readers (issue #679): the result strip
 * the dialog used to keep on screen after closing nothing, and the toast that
 * carries it once the dialog is gone. Two spellings of one receipt is how the
 * strip and the toast would come to disagree about what just happened.
 *
 * `subject` is the conversation's TITLE when the pane knows one (review U8): the
 * toast is the only confirmation this action prints, and a raw session id is an
 * opaque string the reader never typed and cannot match to anything on screen.
 * The caller falls back to the id when there is no title to be had.
 *
 * AND IT SPEAKS THE READER'S LANGUAGE RATHER THAN THE BACKEND'S (reviews D8,
 * U8). "live owner attached"/"cold (no owner running)" named an owner process -
 * vocabulary from the daemon's own bookkeeping, and it read worse once the
 * sentence became a six-second toast instead of a strip that stayed put. The row
 * count is pluralised, because "1 recent rows" is how a receipt comes to look
 * machine-written.
 */
export const reloadReceipt = (
	subject: string,
	cold: boolean,
	recentRows: number,
): string =>
	t("ui.chat.pickers.destination_pickers.reopened_recent", {
		subject: subject,
		value: cold
			? t(
					"ui.chat.pickers.destination_pickers.no_session_was_running_so_it_was_reopened_from_history",
				)
			: t(
					"ui.chat.pickers.destination_pickers.reattached_to_the_running_session",
				),
		recentrows: recentRows,
	});

export const ReloadPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	rebind,
}) => {
	useI18nLocale();
	/*
	 * The title the receipt prefers, taken from the pane's own reading of the
	 * session this picker is about (`frontend`, with the held copy across a
	 * reconnect - the same pair every other reading in this file uses). Undefined on
	 * a snapshot that never carried one, which is the fallback to the id.
	 */
	const subject = runningFrontend(canonical)?.conversation_title ?? sessionId;
	const op = useOperation();
	/*
	 * THE READER MAY HAVE GONE (review U6). Escape dismisses this dialog, and the
	 * request it started keeps running: the owner stops rendering the picker, so
	 * nothing can report the outcome on a screen that no longer exists. A success
	 * was toasted anyway (it has to be - the dialog that carried it is gone), which
	 * made the two outcomes asymmetric in the one direction a reader cannot diagnose:
	 * a reload that quietly did nothing. `closed` is set at unmount, which is the
	 * only moment the dialog is definitively no longer there.
	 */
	const closed = useRef(false);
	useEffect(
		() => () => {
			closed.current = true;
		},
		[],
	);
	/** The reason the last attempt threw, recorded where it is thrown. */
	const failureText = useRef<string | null>(null);
	const submit = useCallback(async () => {
		failureText.current = null;
		// Reopen the SAME identity: a fresh snapshot from the backend. Nothing
		// is resubmitted; the stream re-subscribes and replays from scratch.
		const snapshot = await op.perform(
			async () => {
				/*
				 * The thunk RECORDS THE REASON AND RETHROWS IT. `useOperation` owns the
				 * strip's sentence - one spelling for every picker in this file - and catches
				 * the error itself, so a caller that has to say something about a failure the
				 * dialog is no longer there to show has to observe the error on the way past.
				 */
				try {
					return await desktopResult<{
						payload: { cold: boolean; history: DesktopHistoryPage };
					}>({
						op: "sessions.get",
						sessionId,
					});
				} catch (error) {
					failureText.current = errorText(error);
					throw error;
				}
			},
			(value) => ({
				tone: "success",
				text: reloadReceipt(
					subject,
					value.payload.cold,
					value.payload.history.entries.length,
				),
			}),
			RELOAD_FAILURE_PREFIX(),
		);
		/*
		 * FAILURE KEEPS THE DIALOG (issue #679). `op.perform` answers `null` when the
		 * call threw, and its own inline error line is the only carrier of the reason
		 * a reload failed - elsewhere in this file that is the whole pattern. So the
		 * failure path is deliberately nothing at all: the strip stays readable, the
		 * person can press Reload again, and nothing was rebound.
		 *
		 * UNLESS THE DIALOG IS GONE (review U6), which is the same failure with nowhere
		 * to land: the reader pressed Reload, dismissed the dialog while it ran, and
		 * the reload failed. The inline strip cannot be read on a screen that has been
		 * replaced by the transcript, so the SAME sentence goes out as an error toast -
		 * one spelling, because the two carriers must not disagree about what happened
		 * any more than the strip and the success receipt may.
		 */
		if (snapshot === null) {
			if (closed.current && failureText.current !== null) {
				showErrorToast(`${RELOAD_FAILURE_PREFIX()}: ${failureText.current}`);
			}
			return;
		}
		/*
		 * SUCCESS ENDS THE PICKER (issue #679). The reload has already replaced the
		 * transcript the dialog was sitting over, and every neighbouring picker in
		 * this file closes on pick, so leaving it up cost a mandatory extra press
		 * (Done or Esc) and re-offered an action that had just run.
		 *
		 * THE REBIND IS SUCCESS-ONLY, and that is a decision rather than a tidy-up.
		 * It used to run unconditionally, including when the snapshot could not be
		 * read - and a rebind is the EFFECT of a reload: it tears the stream down and
		 * re-attaches it to replay from scratch. Running it after a failed read
		 * therefore re-subscribed a stream for a reload that did not happen, and the
		 * one thing it bought the reader - the inline error saying the conversation
		 * could not be reopened - was printed over a transcript that had just been
		 * torn down and rebuilt for no reason. A failure changes nothing now.
		 *
		 * The receipt survives the dialog as a toast, because closing it would
		 * otherwise be the end of the one confirmation this action ever prints.
		 */
		rebind(sessionId);
		showSuccessToast(
			reloadReceipt(
				subject,
				snapshot.payload.cold,
				snapshot.payload.history.entries.length,
			),
		);
		onClose();
	}, [onClose, op, rebind, sessionId, subject]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title={t("ui.chat.pickers.reload.title")}
			description={t(
				"ui.chat.pickers.destination_pickers.re_reads_the_canonical_session_from_the_backend_and_re_attaches_the_stre",
			)}
			onSubmit={submit}
			submitLabel={t("ui.chat.pickers.destination_pickers.reload")}
			busy={op.busy}
			result={op.result}
		/>
	);
};

/** Assistant text of the newest painted assistant row; used by tests/stories. */
export function latestAssistantText(page: DesktopHistoryPage) {
	for (let i = page.entries.length - 1; i >= 0; i--) {
		const entry = page.entries[i];
		if (entry.payload?.role === "assistant") return messageText(entry.payload);
	}
	return "";
}
