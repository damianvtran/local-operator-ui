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

import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import {
	desktopKeys,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Button } from "@shared/components/ui/button";
import { Input } from "@shared/components/ui/input";
import { Textarea } from "@shared/components/ui/textarea";
import type { CanonicalSessionHandle } from "@shared/hooks/use-canonical-session";
import { cn } from "@shared/lib/utils";
import { useCanonicalSessionsStore } from "@shared/store/canonical-sessions-store";
import { useUiPreferencesStore } from "@shared/store/ui-preferences-store";
import { type ThemeName, themes } from "@shared/themes";
import {
	keepPreviousData,
	useQuery,
	useQueryClient,
} from "@tanstack/react-query";
import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { v4 as uuidv4 } from "uuid";
import type { DesktopModelSelection } from "../../../../../shared/desktop-contract";
import type {
	DesktopLoopState,
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import type {
	CanonicalFrontendSync,
	CanonicalModel,
	DesktopHistoryPage,
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
	selectionFromModel,
	selectionSelector,
} from "../draft-selection";
import {
	bandReadings,
	effortLadder,
	effortLevel,
	modelSelector,
	specUnresolved,
} from "../session-status/session-model";
import { forkBudgetRefusal } from "../utils/message-budget";
import { catalogueListing } from "./model-catalogue-listing";
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
	LOOP_COMMAND,
	LOOP_STOP_ARGS,
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
	 * A new-conversation pane has no session for `/model` or `/effort` to address,
	 * so the two pickers read and write a pane's own selection instead: it resolves
	 * through `sessions.preview` and rides `sessions.create`, never `settings.edit`
	 * (the machine's default is not this control's to change) and never
	 * `sessions.command` (there is no owner to command yet).
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
	return useQuery({
		queryKey: ["desktop", "entities", sessionId, command, name ?? ""],
		queryFn: () =>
			desktopResult<Entities<T>>({
				op: "commands.entities",
				sessionId,
				command,
				name: name || undefined,
			}),
		enabled,
		staleTime: 15_000,
	});
}

// ------------------------------------------------------------------ model

type CatalogueRow = DesktopModelCatalogue["models"][number] & {
	value?: string;
	routed?: boolean;
};

/** The row's own selector, in the one spelling the wire and the rows share. */
function selectorOf(row: CatalogueRow): string {
	return row.selector ?? row.value ?? `${row.provider}/${row.model_id}`;
}

/** The row's price pair in the one spelling both surfaces print. */
function pricePair(row: CatalogueRow): string {
	return formatPricePair(
		row.input_price,
		row.output_price,
		row.routed === true,
	);
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
const DEFAULT_SAVE_FAILURE = "The default was not saved";

/**
 * What a switch to a row with no credential means for the session (QA Q1).
 *
 * The switch itself succeeded — the owner accepted the spec — so this is not a
 * failure; it is the fact that the model cannot answer yet, stated in the
 * user's terms with the one action that changes it.
 */
const SIGN_IN_CAVEAT =
	"This model has no credential yet, so it cannot answer until you sign in. Connect it in Settings > Providers.";

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
				 */
				refused: string;
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
			},
		) => {
			if (!draft) return;
			if (!next) {
				refuse(
					`${reading.refused} This pane has not resolved a model to change.`,
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
						draftPreviewQuery({ ...draft.target, model: next }),
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
					draftPreviewQuery({ ...draft.target, model: chosen }),
				);
				draft.select(chosen);
				setPicked(chosen);
				setResult({
					tone: "success",
					text: carry
						? carry.confirmation(
								selectorOfResolution(resolved, selectionSelector(chosen) ?? ""),
							)
						: reading.describe(resolved),
				});
			} catch (error) {
				/*
				 * Said twice on purpose, and it is the same sentence both times: the
				 * strip for a reader still looking at the dialog, the composer's note for
				 * one who closed it during the wait — the rule UX U2 set for the session's
				 * picker, which has the same wait for the opposite reason (a cold runtime
				 * bind there, a resolution here).
				 */
				refuse(`${reading.refused} ${errorText(error)}`);
			} finally {
				setBusy(false);
			}
		},
		[draft, queryClient, refuse],
	);
	return { pick, busy, result, selection, target, refuse };
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

export const ModelPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	note,
	draft,
}) => {
	const [live, setLive] = useState(false);
	/*
	 * The model the user last switched to, marked in force before the owner's own
	 * `frontend.update` frame moves `selected_model` (QA Q2).
	 *
	 * The receipt and the frame are two different clocks: QA measured the in-force
	 * check still on the OLD row 3.7 s after the receipt while the band and the
	 * result strip already read the new one — and, before UX U7, the header
	 * sentence with them. It is the same optimistic registration the band's paint
	 * uses, on the picker's own row and, through `shownSelector` below, in the
	 * header; it is dropped when the authoritative selector agrees with it (the
	 * narrower rule the reconciliation effect below states in full, and the reason
	 * it is not dropped on every disagreement), and a re-open (a fresh mount) reads
	 * the owner's answer.
	 */
	const [pickedCurrent, setPickedCurrent] = useState<string | null>(null);
	/*
	 * What the last successful switch did to the session's ability to RUN the
	 * model it now names (QA Q1).
	 *
	 * `switched and runnable` and `switched but needs sign-in` produced an
	 * identical success strip and an identical permanent band repaint, which is
	 * the one distinction this picker exists to make: a row the dialog itself
	 * labels `Needs sign-in … no credential` is a model the session cannot use
	 * until a credential exists.
	 */
	const [switchedNeedsSignIn, setSwitchedNeedsSignIn] = useState(false);
	const catalogue = useQuery({
		queryKey: ["desktop", "models", live],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({ op: "models.catalogue", live }),
		staleTime: live ? 0 : 60_000,
		/*
		 * A live re-list costs a measured 2.33 s, and `live` is a new query key —
		 * so without this the list is blanked to the loading spinner for the whole
		 * fetch, which reads as "the catalogue disappeared" right after the user
		 * asked for it to be refreshed (latency U4). `keepPreviousData` keeps the
		 * rows the picker already has painted under the new `isFetching` state.
		 */
		placeholderData: keepPreviousData,
	});
	// Only a PENDING live fetch says "Refreshing…": the initial (non-live) load is
	// also `isFetching`, and labelling that "Refreshing…" would describe a fetch
	// the user never asked for (design D8).
	const refreshing = live && catalogue.isFetching;
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
		...draftPreviewQuery(draftPick.target ?? NO_DRAFT_TARGET),
		enabled: Boolean(draft),
	});
	const persist = useOperation();
	const [persistDefault, setPersistDefault] = useState(false);
	const selected = canonical.frontend?.selected_model;
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
	 * One map, read by both the row builder below (`group`) and the pick itself,
	 * so the label the user reads and the outcome the strip reports cannot
	 * disagree.
	 */
	const rowAuth = useMemo(() => {
		const known = catalogue.data?.credentials_known !== false;
		const map = new Map<string, "runnable" | "needs-sign-in" | "unknown">();
		for (const row of (catalogue.data?.models ?? []) as CatalogueRow[]) {
			map.set(
				selectorOf(row),
				!known ? "unknown" : row.connected ? "runnable" : "needs-sign-in",
			);
		}
		return map;
	}, [catalogue.data]);

	const options = useMemo<PickerOption[]>(() => {
		const rows = (catalogue.data?.models ?? []) as CatalogueRow[];
		// `connected` is also true when the credential store could not be read,
		// which is why every model once sat under "Connected" on a fixture with
		// no credentials at all (D5). With that unknown, the picker still lists
		// everything -- an empty model list would be a worse lie -- but it stops
		// claiming an auth state it does not have.
		const known = catalogue.data?.credentials_known !== false;
		return rows.map((row) => ({
			value: selectorOf(row),
			label: row.label || row.model_id,
			/*
			 * The price pair travels with the provider line so the dialog and the
			 * composer's inline list describe one model the same way: a user who
			 * reaches for the thorough surface must not have to re-derive what the
			 * fast one already told them. Same formatter, so `free` and
			 * `usage-based` are words in both and an absent price is blank in both.
			 */
			description: `${row.provider}${row.aggregated ? ", aggregated" : ""}${
				known && !row.connected ? ", no credential" : ""
			}${pricePair(row) ? ` · ${pricePair(row)}` : ""}`,
			meta: row.context_window
				? `${Math.round(row.context_window / 1000)}k`
				: undefined,
			current: shownSelector === (row.selector ?? row.value),
			group: !known
				? "Sign-in state unknown"
				: row.connected
					? "Signed in"
					: "Needs sign-in",
			keywords: [row.provider, row.model_id],
		}));
	}, [catalogue.data, shownSelector]);

	const listing = catalogueListing(catalogue.data, catalogue, errorText);

	const onPick = useCallback(
		async (value: string, option: PickerOption) => {
			const [provider, ...rest] = value.split("/");
			const modelId = rest.join("/");
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
				await draftPick.pick(
					{ provider, model_id: modelId, reasoning_effort: null },
					{
						describe: (resolved) =>
							`This conversation will run ${selectorOfResolution(resolved, option.label)}.`,
						carry: carried,
						refused: "The model was not changed.",
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
			const { outcome, result: failure } = await command.run("model", value);
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
				note(`The model was not changed. ${failure.text}`, true);
				return;
			}
			// The switch landed: mark the picked row in force at once rather than
			// waiting out the owner's next frame (QA Q2), and say whether the model
			// it just switched to can actually run (QA Q1).
			setPickedCurrent(value);
			const needsSignIn = rowAuth.get(value) === "needs-sign-in";
			setSwitchedNeedsSignIn(needsSignIn);
			if (needsSignIn) {
				// The strip below carries this while the dialog is open; the note is
				// the same fact for the case where it is not (UX U2's rule, applied
				// to the one "success" that still needs the user to do something).
				note(`The model was changed. ${SIGN_IN_CAVEAT}`);
			}
			if (persistDefault) {
				// Explicit default scope: the session change above is the owner's;
				// the default is the typed settings key, written only on request.
				await persist.perform(
					async () => {
						try {
							await desktopResult({
								op: "settings.edit",
								key: "hosting",
								value: provider,
							});
							await desktopResult({
								op: "settings.edit",
								key: "model_name",
								value: modelId,
							});
							return value;
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
							note(`${DEFAULT_SAVE_FAILURE}: ${errorText(error)}`, true);
							throw error;
						}
					},
					(selector) => ({
						tone: "success",
						text: `Default for new sessions: ${selector}`,
					}),
					DEFAULT_SAVE_FAILURE,
				);
			}
		},
		[
			canonical,
			command,
			persistDefault,
			persist,
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
		],
	);

	const ownerOutcome: PickerResult | null = persist.result
		? {
				...persist.result,
				text: [command.result?.text, persist.result.text]
					.filter(Boolean)
					.join("\n"),
			}
		: command.result;
	/*
	 * "Switched and runnable" and "switched but cannot run yet" are different
	 * outcomes, and this picker's whole subject is that difference (QA Q1).
	 *
	 * The caveat is APPENDED to the owner's own text rather than replacing it —
	 * the strip quotes the receipt and this is the renderer's own sentence about
	 * the row it just switched to — and the tone steps to `warning`, because the
	 * switch did succeed and the model is not usable yet.
	 */
	const combined: PickerResult | null =
		ownerOutcome && switchedNeedsSignIn && ownerOutcome.tone !== "error"
			? { tone: "warning", text: `${ownerOutcome.text}\n${SIGN_IN_CAVEAT}` }
			: ownerOutcome;

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
			title="Model"
			description={
				draft
					? shownSelector
						? `This conversation starts on ${shownSelector} and keeps running on it. Choosing another changes that; your default is unchanged.`
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
							"Choose the model this conversation starts on and keeps running on. Your default is unchanged."
					: shownSelector
						? `This session runs ${shownSelector}. Choosing another applies to this session only unless you also set it as the default.`
						: "Choose the model for this session."
			}
			options={options}
			loading={catalogue.isLoading}
			loadError={listing.loadError}
			notice={listing.notice}
			noticeDetail={listing.noticeDetail}
			searchPlaceholder="Search models"
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
			busyText={draft ? "Resolving the model…" : "Switching the model…"}
			busyLabel={draft ? "Resolving the model" : "Switching the model"}
			result={draft ? draftPick.result : combined}
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
						"flex items-center gap-3",
						draft ? "justify-end" : "justify-between",
					)}
				>
					{!draft && (
						<PickerCheck
							checked={persistDefault}
							onCheckedChange={setPersistDefault}
							tone="muted"
						>
							{persistDefault
								? "This pick also sets the default for new sessions"
								: "Also make it the default for new sessions"}
						</PickerCheck>
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
						 */
						onClick={() => {
							if (live) void catalogue.refetch();
							else setLive(true);
						}}
						disabled={catalogue.isFetching}
					>
						{refreshing ? (
							<span className="flex items-center gap-2">
								<Spinner size="xs" />
								Refreshing…
							</span>
						) : (
							"Refresh from providers"
						)}
					</Button>
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
	/* Same key as the model dialog's: the selection in force, not the snapshot the
	   dialog opened on, so the rungs offered are the current model's (R2). */
	const draftPreview = useQuery({
		...draftPreviewQuery(draftPick.target ?? NO_DRAFT_TARGET),
		enabled: Boolean(draft),
	});
	const draftModel = draft
		? bandReadings(draftPreview.data?.snapshot, null).effort
		: null;
	const model = draft ? draftModel : canonical.frontend?.selected_model;
	const rungs = draft
		? effortLadder(draftModel)
		: (entities.data?.entities ?? []).map((row) => row.value);
	const currentRung = draft
		? (draftModel?.reasoning_effort ?? null)
		: (entities.data?.current ?? null);
	const options = useMemo<PickerOption[]>(
		() =>
			rungs.map((value) => ({
				value,
				label: value,
				current: currentRung === value,
			})),
		[rungs, currentRung],
	);
	const label = model
		? `${model.provider}/${model.model_id}`
		: "the current model";
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
			title="Reasoning effort"
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
								`${label} has not reported its effort levels yet. They appear after the first turn, or pick a model that reports them.`
							: `${label} has not reported its effort levels yet. They appear after the next turn, or run /effort <level> to set one now.`
						: draft
							? `${label} has no adjustable effort. Pick another model.`
							: `${label} has no adjustable effort. Pick a reasoning model with /model first.`
					: draft
						? `Effort levels ${label} supports. This sets the level this conversation starts on and keeps running on; your default is unchanged.`
						: `Effort levels ${label} supports. Applies to this session.`
			}
			options={options}
			loading={loading}
			loadError={loadError}
			emptyText={
				unresolved
					? "Not known yet."
					: "Effort is not adjustable on this model."
			}
			onPick={(value) => {
				if (!draft) {
					void command.run("effort", value);
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
						describe: () => `Effort for this conversation: ${value}.`,
						refused: "The effort was not changed.",
					},
				);
			}}
			busy={draft ? draftPick.busy : command.busy}
			result={draft ? draftPick.result : command.result}
			/*
			 * The wait names its work (design D23). A draft's effort pick resolves
			 * through `sessions.preview` before it records anything, exactly as the
			 * model dialog beside it does, and it fell back to the host's generic
			 * "Applying the change…" - which says that something is happening
			 * without saying what, for a wait the sibling adapter already names.
			 * A session's effort pick is a command and keeps the default.
			 */
			busyText={draft ? "Resolving the effort…" : undefined}
			busyLabel={draft ? "Resolving the effort" : undefined}
		/>
	);
};

// ------------------------------------------------------------------ theme

export const ThemePicker: FC<PickerContext> = ({ onClose, action }) => {
	const themeName = useUiPreferencesStore((state) => state.themeName);
	const setTheme = useUiPreferencesStore((state) => state.setTheme);
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(
		() =>
			Object.values(themes).map((theme) => ({
				value: theme.id,
				label: theme.name,
				description: theme.description,
				current: theme.id === themeName,
				group: theme.id.startsWith("localOperator")
					? "Local Operator"
					: "Ports",
			})),
		[themeName],
	);
	// A typed argument (`/theme dracula`) is a direct pick when it names a theme.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted) return;
		const match = Object.values(themes).find(
			(theme) =>
				theme.id.toLowerCase() === wanted.toLowerCase() ||
				theme.name.toLowerCase() === wanted.toLowerCase(),
		);
		if (match) {
			setTheme(match.id as ThemeName);
			setResult({ tone: "success", text: `Theme: ${match.name}` });
		} else {
			setResult({
				tone: "warning",
				text: `No desktop theme named "${wanted}".`,
			});
		}
	}, [action.args, setTheme]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Theme"
			description="Desktop theme. The terminal keeps its own tui.theme setting."
			options={options}
			onPick={(value, option) => {
				setTheme(value as ThemeName);
				setResult({ tone: "success", text: `Theme: ${option.label}` });
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
	profile?: Record<string, unknown> | null;
	instructions?: string | null;
};

export const ProfilePicker: FC<PickerContext & { which: "team" | "agent" }> = ({
	sessionId,
	which,
	spec,
	onClose,
	canonical,
	action,
}) => {
	const [selected, setSelected] = useState<string | null>(null);
	const list = useEntities<ProfileRow>(sessionId, which);
	const detail = useEntities<ProfileRow>(
		sessionId,
		which,
		selected ?? undefined,
		!!selected,
	);
	const command = useSessionCommand(sessionId);
	const [request, setRequest] = useState("");
	const active =
		which === "team"
			? canonical.frontend?.active_team
			: canonical.frontend?.active_agent;
	const chartMode = (action.data as { mode?: string }).mode === "chart";

	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.entities ?? []).map((row) => ({
				value: row.value,
				label: row.name ?? row.value,
				description: row.description,
				meta: row.kind,
				current: active === row.value,
			})),
		[list.data, active],
	);
	const selectedRow = (detail.data?.entities ?? []).find(
		(row) => row.value === selected,
	);
	const chart = detail.data?.current as
		| Record<string, unknown>
		| null
		| undefined;

	const submit = useCallback(async () => {
		if (!selected) return;
		// The owner admits `data.request` ONCE on attachment; the renderer must
		// not re-send it. The receipt's admission field records that fact.
		const { outcome } = await command.run(
			which,
			request ? `${selected} ${request}` : selected,
		);
		if (!outcome || isNativeAction(outcome)) return;
	}, [command, which, selected, request]);

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
					text: `${command.result.text}\nRequest admitted once${admission.duplicate ? " (already admitted)" : ""}.`,
				}
			: command.result
		: null;

	return (
		<PickerHost
			open
			onClose={onClose}
			title={
				chartMode ? "Team chart" : which === "team" ? "Team" : "Agent profile"
			}
			description={
				chartMode
					? "Pick a team to see how it resolves."
					: `${spec.description}. ${active ? `Active: ${active}.` : ""}`
			}
			options={options}
			loading={list.isLoading}
			loadError={list.isError ? errorText(list.error) : null}
			emptyText={
				which === "team" ? "No teams are registered." : "No profiles found."
			}
			onPick={(value) => setSelected(value)}
			busy={command.busy}
			result={result}
			form={
				selected ? (
					<div className="flex flex-col gap-3">
						<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
							<p className="text-body-sm text-ink">
								{selectedRow?.name ?? selected}
							</p>
							{selectedRow?.description && (
								<p className="text-ink-muted text-meta">
									{selectedRow.description}
								</p>
							)}
							{detail.isLoading && (
								<p className="text-ink-dim text-meta">Loading detail</p>
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
						{!chartMode && (
							<PickerField
								label="Request (optional)"
								hint="Sent once with the attachment; it becomes the first turn."
							>
								<Textarea
									value={request}
									onChange={(event) => setRequest(event.target.value)}
									placeholder={`What should ${selectedRow?.name ?? selected} do?`}
									rows={3}
								/>
							</PickerField>
						)}
					</div>
				) : undefined
			}
			onSubmit={!chartMode && selected ? submit : undefined}
			submitLabel={which === "team" ? "Attach team" : "Use profile"}
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
			title="Skills"
			description={`Skills discoverable from this session's working directory (${
				list.data?.data.scope ?? "discoverable"
			} scope). Listed is not the same as selected into the prompt.`}
			options={options}
			loading={list.isLoading}
			loadError={list.isError ? errorText(list.error) : null}
			emptyText="No skills are discoverable from this session's directory."
			onPick={(value) => setSelected(value)}
			form={
				selected ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<p className="font-mono text-ink text-mono-sm">
							skill://{selected}
						</p>
						{detail.isLoading ? (
							<p className="text-ink-dim text-meta">Loading</p>
						) : (
							<pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap font-mono text-ink-muted text-mono-sm">
								{body?.body ?? body?.text ?? "No detail returned."}
							</pre>
						)}
					</div>
				) : undefined
			}
		/>
	);
};

// -------------------------------------------------------------------- fork

export const ForkPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
	action,
}) => {
	const [message, setMessage] = useState(action.args ?? "");
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
		const value = await op.perform(
			() =>
				desktopResult<{
					data: {
						session_id: string;
						parent_id: string;
						boundary: string;
						admission?: { detail: string; duplicate: boolean };
					};
				}>({
					op: "sessions.fork",
					sessionId,
					requestId: uuidv4(),
					message: message.trim() || undefined,
					boundary: "next_safe",
				}),
			(result) => ({
				tone: "success",
				text: `Forked at the next safe boundary into ${result.data.session_id}. The original conversation is unchanged.${
					result.data.admission
						? `\nYour message was admitted once: ${result.data.admission.detail}.`
						: ""
				}`,
			}),
			"The fork was not created",
		);
		if (value) rebind(value.data.session_id);
	}, [op, sessionId, message, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Fork this conversation"
			description="Copies the complete history into a new conversation at the next safe boundary (after the current assistant step and its tool results). The original keeps running and is not modified."
			form={
				<PickerField
					label="First message in the fork (optional)"
					hint="Delivered exactly once to the new conversation."
				>
					<Textarea
						value={message}
						onChange={(event) => setMessage(event.target.value)}
						rows={3}
						placeholder="Try a different approach..."
					/>
				</PickerField>
			}
			onSubmit={submit}
			submitLabel="Fork"
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
	return row.name?.trim() || `Untitled ${row.id}`;
}

export const StopPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const rows = useSessionRows();
	const [targets, setTargets] = useState<Set<string>>(
		() => new Set(action.args.trim() === "all" ? [] : [sessionId]),
	);
	const [all, setAll] = useState(action.args.trim() === "all");
	const [confirmed, setConfirmed] = useState(false);
	const op = useOperation();
	const options = useMemo<PickerOption[]>(
		() =>
			(rows.data ?? []).map((row) => ({
				value: row.id,
				label: sessionLabel(row),
				description: row.live_state
					? `live: ${row.live_state}`
					: "cold (no owner running)",
				meta: row.id,
				current: targets.has(row.id) || all,
			})),
		[rows.data, targets, all],
	);
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
									? "nothing was running"
									: "stop requested (acknowledged, not a completed exit)"
							}`,
					)
					.join("\n"),
			}),
			"Stop was not accepted",
		);
	}, [op, chosen, confirmed]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Stop"
			description="Ends the chosen sessions' current work through the runtime's own stop protocol. /resume reopens a stopped conversation."
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
					All sessions ({rows.data?.length ?? 0})
				</PickerCheck>
			}
			form={
				<PickerCheck
					checked={confirmed}
					onCheckedChange={setConfirmed}
					tone="ink"
				>
					Stop{" "}
					{chosen.length === 1 ? "this session" : `${chosen.length} sessions`}{" "}
					now
				</PickerCheck>
			}
			onSubmit={submit}
			submitLabel="Stop"
			submitDisabled={!confirmed || chosen.length === 0}
			busy={op.busy}
			result={op.result}
		/>
	);
};

// -------------------------------------------------------------------- copy

export const CopyPicker: FC<PickerContext> = ({ canonical, onClose }) => {
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(() => {
		const rows: PickerOption[] = [];
		const records = canonical.transcript.records;
		for (let i = records.length - 1; i >= 0 && rows.length < 60; i--) {
			const record = records[i];
			if (record.kind === "assistant" && record.text) {
				rows.push({
					value: `message:${record.id}`,
					label: record.text.replace(/\s+/g, " ").slice(0, 80),
					group: "Messages",
					meta: "message",
				});
				const fences = record.text.match(/```[\w-]*\n[\s\S]*?```/g) ?? [];
				fences.forEach((fence, index) => {
					const code = fence.replace(/^```[\w-]*\n/, "").replace(/```$/, "");
					rows.push({
						value: `code:${record.id}:${index}`,
						label: code.split("\n")[0].slice(0, 80) || "(code)",
						group: "Code blocks",
						meta: `${code.split("\n").length} lines`,
					});
				});
				rows.push({
					value: `quote:${record.id}`,
					label: `> ${record.text.replace(/\s+/g, " ").slice(0, 70)}`,
					group: "As quote",
					meta: "quote",
				});
			}
			if (record.kind === "tool" && record.output) {
				rows.push({
					value: `output:${record.id}`,
					label: `${record.toolName} output`,
					group: "Tool output",
					meta: `${record.output.length} chars`,
				});
			}
		}
		return rows;
	}, [canonical.transcript.records]);

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
					text: `Copied ${text.length} characters.`,
				});
			} catch (error) {
				setResult({
					tone: "error",
					text: `Clipboard refused: ${errorText(error)}`,
				});
			}
		},
		[canonical.transcript.records],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Copy"
			description="Pick a message, a code block, or a quoted excerpt. It goes to the clipboard."
			options={options}
			emptyText="Nothing to copy yet."
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
	const rows = useSessionRows();
	const [result, setResult] = useState<PickerResult | null>(null);
	const options = useMemo<PickerOption[]>(
		() =>
			(rows.data ?? [])
				.slice()
				.sort((a, b) => (b.mtime ?? 0) - (a.mtime ?? 0))
				.map((row) => ({
					value: row.id,
					label: sessionLabel(row),
					description: row.live_state
						? `live: ${row.live_state}`
						: "cold, reopens on the next message",
					meta: new Date((row.mtime ?? 0) * 1000).toLocaleString(),
					current: row.id === sessionId,
					keywords: [row.id],
				})),
		[rows.data, sessionId],
	);
	// `/resume <id>` with a known id is a direct pick.
	useEffect(() => {
		const wanted = action.args.trim();
		if (!wanted || !rows.data) return;
		const hit = rows.data.find(
			(row) => row.id === wanted || sessionLabel(row) === wanted,
		);
		if (hit) {
			rebind(hit.id);
			setResult({ tone: "success", text: `Resumed ${sessionLabel(hit)}.` });
		}
	}, [action.args, rows.data, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Resume a conversation"
			description="Every canonical session, live or cold. Picking one attaches this window to it; nothing is restarted until you send a message."
			options={options}
			loading={rows.isLoading}
			loadError={rows.isError ? errorText(rows.error) : null}
			searchPlaceholder="Search by title or id"
			onPick={(value, option) => {
				rebind(value);
				setResult({ tone: "success", text: `Resumed ${option.label}.` });
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
				text: `New conversation ${id}. The previous one keeps running.`,
			}),
			"The conversation was not created",
		);
		if (value) rebind(value);
	}, [op, createSession, cwd, canonical.frontend?.cwd, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="New conversation"
			description="Starts a fresh canonical session. Work in the current one continues."
			form={
				<PickerField
					label="Working directory"
					hint="Must exist on this machine."
				>
					<Input value={cwd} onChange={(event) => setCwd(event.target.value)} />
				</PickerField>
			}
			onSubmit={submit}
			submitLabel="Create"
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
	const current = canonical.frontend?.goal ?? "";
	const [goal, setGoal] = useState(current);
	const command = useSessionCommand(sessionId);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Session goal"
			description={
				current
					? "The standing goal is prepended to every turn. Clear it to remove it."
					: "A standing goal the agent keeps in view on every turn."
			}
			form={
				<PickerField label="Goal">
					<Textarea
						value={goal}
						onChange={(event) => setGoal(event.target.value)}
						rows={3}
						placeholder="Ship the release with green gates"
					/>
				</PickerField>
			}
			onSubmit={() => void command.run(GOAL_COMMAND, goal.trim())}
			submitLabel="Set goal"
			submitDisabled={!goal.trim()}
			actions={
				current ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={() => void command.run(GOAL_COMMAND, GOAL_CLEAR_ARGS)}
						disabled={command.busy}
					>
						Clear goal
					</Button>
				) : undefined
			}
			busy={command.busy}
			result={command.result}
		/>
	);
};

const APPROVAL_DESCRIPTIONS: Record<string, string> = {
	ask: "write and command tools prompt before running",
	auto: "tools run without asking",
};

export const ApprovalsPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
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
			// Default scope writes the typed settings key and leaves the current
			// session's mode alone, exactly as `/approvals default` does.
			await settingsOp.perform(
				() =>
					desktopResult<{ key: string; value: unknown }>({
						op: "settings.edit",
						key: "tool_approval_mode",
						value,
					}),
				(row) => ({
					tone: "success",
					text: `Default approvals for new sessions: ${String(row?.value ?? value)}. This session is unchanged.`,
				}),
				"The default was not saved",
			);
			await defaults.refetch();
		},
		[scope, command, settingsOp, defaults],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Tool approvals"
			description="Whether write and command tools ask before running."
			options={options}
			loading={entities.isLoading}
			onPick={onPick}
			toolbar={
				<PickerSegment
					label="Scope"
					value={scope}
					onChange={setScope}
					options={[
						{ value: "session", label: "This session" },
						{ value: "default", label: "Default for new sessions" },
					]}
				/>
			}
			busy={command.busy || settingsOp.busy}
			result={settingsOp.result ?? command.result}
		/>
	);
};

export const FastPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const command = useSessionCommand(sessionId);
	const [acknowledged, setAcknowledged] = useState(false);
	const premium = Boolean(
		(action.data as { premium_pricing?: boolean }).premium_pricing,
	);
	const options: PickerOption[] = [
		{
			value: "on",
			label: "On",
			description:
				"Priority processing. Billed at premium rates where the provider offers it.",
			disabled: premium && !acknowledged,
		},
		{ value: "off", label: "Off", description: "Standard processing." },
	];
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Fast mode"
			description="Applies to this session only."
			options={options}
			onPick={(value) => void command.run("fast", value)}
			toolbar={
				premium ? (
					<PickerCheck
						checked={acknowledged}
						onCheckedChange={setAcknowledged}
						tone="ink"
					>
						I understand fast mode can cost more per token
					</PickerCheck>
				) : undefined
			}
			busy={command.busy}
			result={command.result}
		/>
	);
};

export const RenamePicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	action,
}) => {
	const [name, setName] = useState(
		action.args || canonical.frontend?.conversation_title || "",
	);
	const command = useSessionCommand(sessionId);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Rename conversation"
			description="An explicit name takes precedence over the generated title."
			form={
				<PickerField label="Name">
					<Input
						value={name}
						onChange={(event) => setName(event.target.value)}
						autoFocus
					/>
				</PickerField>
			}
			onSubmit={() => void command.run("rename", name.trim())}
			submitLabel="Rename"
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
			title="Loop"
			description="Repeats turns toward a goal. Approval and question gates still stop and wait for you; the loop never answers them."
			body={
				loop && loop.status !== "idle" ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<PickerKeyValue label="Status" value={loop.status} />
						<PickerKeyValue
							label="Completed"
							value={`${loop.completed}${loop.iterations ? ` of ${loop.iterations}` : ""}`}
						/>
						{loop.goal && (
							<PickerKeyValue label="Goal" value={loop.goal} mono={false} />
						)}
						{loop.reason && (
							<PickerKeyValue label="Reason" value={loop.reason} mono={false} />
						)}
					</div>
				) : undefined
			}
			form={
				running ? undefined : (
					<div className="flex flex-col gap-3">
						<PickerSegment
							label="Loop mode"
							value={mode}
							onChange={setMode}
							options={[
								{ value: "count", label: "Fixed number of turns" },
								{ value: "goal", label: "Until a goal is met" },
							]}
						/>
						{mode === "count" ? (
							<PickerField
								label="Turns (1 to 25)"
								hint={
									standingGoal
										? `Uses the standing goal: ${standingGoal}`
										: "Set a standing goal with /goal first, or switch to a goal loop."
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
							<PickerField label="Goal" hint="A judge decides when it is met.">
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
			submitLabel="Start loop"
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
						Cancel loop
					</Button>
				) : undefined
			}
			busy={command.busy || cancel.busy}
			result={cancel.result ?? command.result}
		/>
	);
};

export const AsidePicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	action,
}) => {
	const [text, setText] = useState(action.args || "");
	const [asideId, setAsideId] = useState<string | null>(null);
	const [answer, setAnswer] = useState<string | null>(null);
	const [adopted, setAdopted] = useState(false);
	const ask = useOperation();
	const adopt = useOperation();
	const submit = useCallback(async () => {
		if (!text.trim()) return;
		const value = await ask.perform(
			() =>
				desktopResult<{
					data: { aside_id: string; text: string; off_record: boolean };
				}>({
					op: "sessions.aside",
					sessionId,
					requestId: uuidv4(),
					text: text.trim(),
					asideId: asideId ?? undefined,
				}),
			() => ({
				tone: "info",
				text: "Answered off the record. Nothing entered the conversation.",
			}),
			"The aside was not answered",
		);
		if (value) {
			setAsideId(value.data.aside_id);
			setAnswer(value.data.text);
		}
	}, [ask, sessionId, text, asideId]);
	const doAdopt = useCallback(async () => {
		if (!asideId) return;
		const value = await adopt.perform(
			() =>
				desktopResult<{ data: Record<string, unknown> }>({
					op: "sessions.adopt",
					sessionId,
					requestId: uuidv4(),
					asideId,
					confirmed: true,
				}),
			() => ({
				tone: "success",
				text: "Adopted into the conversation as a real turn.",
			}),
			"The aside was not adopted",
		);
		if (value) setAdopted(true);
	}, [adopt, sessionId, asideId]);
	const close = useCallback(() => {
		// A settled, unadopted panel is closed on the backend so it does not
		// count against the bounded aside pool; the exchange is discarded.
		if (asideId && !adopted) {
			void desktopResult({
				op: "sessions.aside.close",
				sessionId,
				asideId,
			}).catch(() => {});
		}
		onClose();
	}, [asideId, adopted, sessionId, onClose]);
	return (
		<PickerHost
			open
			onClose={close}
			title="Aside (off the record)"
			description="A side question the model answers without it entering the conversation. Adopt it to make it a real turn."
			body={
				answer ? (
					<div className="rounded-md border border-hairline bg-sunken px-3 py-2">
						<p className="text-ink-dim text-meta">Q: {text}</p>
						<p className="mt-1 whitespace-pre-wrap text-body-sm text-ink">
							{answer}
						</p>
					</div>
				) : undefined
			}
			form={
				adopted ? undefined : (
					<PickerField label={answer ? "Follow up" : "Question"}>
						<Textarea
							value={answer ? "" : text}
							onChange={(event) => setText(event.target.value)}
							rows={3}
							placeholder="Quick question that should not become part of the history"
						/>
					</PickerField>
				)
			}
			onSubmit={adopted ? undefined : submit}
			submitLabel={answer ? "Ask again" : "Ask"}
			submitDisabled={!text.trim()}
			actions={
				answer && !adopted ? (
					<Button
						variant="secondary"
						size="sm"
						type="button"
						onClick={doAdopt}
						disabled={adopt.busy}
					>
						Adopt into conversation
					</Button>
				) : undefined
			}
			busy={ask.busy || adopt.busy}
			result={adopt.result ?? ask.result}
		/>
	);
};

export const CredentialPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
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
	const options = useMemo<PickerOption[]>(
		() =>
			credentialNamesFrom(list.data).map((name) => ({
				value: name,
				label: name,
				meta: "stored",
				current: name === key,
			})),
		[list.data, key],
	);
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
				text: `Stored ${key.trim()}. The value was not echoed.`,
			}),
			"The credential was not stored",
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
			() => ({ tone: "success", text: `Forgot ${key.trim()}.` }),
			"The credential was not removed",
		);
		setConfirmForget(false);
		await list.refetch();
	}, [op, sessionId, key, confirmForget, list]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Credential"
			description="Stores a secret for this session's tools by name. The value never appears in the composer, the transcript, or the command receipt."
			options={options}
			loading={list.isLoading}
			emptyText="No credentials stored yet."
			onPick={(picked) => setKey(picked)}
			form={
				<div className="flex flex-col gap-3">
					<PickerField label="Name">
						<Input
							value={key}
							onChange={(event) => setKey(event.target.value)}
							placeholder="MY_API_KEY"
							autoComplete="off"
						/>
					</PickerField>
					<PickerField label="Value" hint="Masked. Cleared after storing.">
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
							Forget {key.trim()} from this session
						</PickerCheck>
					)}
				</div>
			}
			onSubmit={store}
			submitLabel="Store"
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
						Forget
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
	const navigate = useNavigate();
	const providers = useDesktopProviders(true);
	const options = useMemo<PickerOption[]>(
		() =>
			(providers.data ?? []).map((provider: DesktopProvider) => ({
				value: provider.id,
				label: provider.name,
				description: provider.auth_methods
					.map((method) => method.label)
					.join(", "),
				meta: provider.configured
					? `${provider.stored_credentials} stored`
					: undefined,
				current: provider.configured,
				keywords: provider.search_aliases,
				group: provider.configured ? "Signed in" : "Available",
			})),
		[providers.data],
	);
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
			title="Sign in to a provider"
			description="Opens the provider's sign-in methods in Settings. Browser and device flows run through the backend; keys are entered in a masked field there."
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

type StoredAccount = {
	id: number;
	provider: string;
	type: string;
	identity_label: string;
	source: string;
	state: string;
};

export const LogoutPicker: FC<PickerContext> = ({ onClose, action }) => {
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
				text: "Signed out. Environment variables and other accounts are untouched.",
			}),
			"Sign-out failed",
		);
		setConfirmed(false);
		setSelected(null);
		await queryClient.invalidateQueries({ queryKey: desktopKeys.accounts });
		await queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
	}, [op, selected, confirmed, queryClient]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Sign out"
			description="Removes one stored account. Credentials supplied through environment variables cannot be removed here and keep working."
			options={options}
			loading={accounts.isLoading}
			loadError={accounts.isError ? errorText(accounts.error) : null}
			emptyText={
				wanted ? `No stored account for ${wanted}.` : "No stored accounts."
			}
			onPick={(value) => setSelected(Number(value))}
			form={
				selected !== null ? (
					<PickerCheck
						checked={confirmed}
						onCheckedChange={setConfirmed}
						tone="ink"
					>
						Remove this account's stored credential
					</PickerCheck>
				) : undefined
			}
			onSubmit={selected !== null ? submit : undefined}
			submitLabel="Sign out"
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
	const options = useMemo<PickerOption[]>(
		() =>
			commands.map((command) => ({
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
							? "Needs an argument"
							: "Takes an argument",
				keywords: [...command.aliases, command.destination, command.execution],
				group:
					command.execution === "owner"
						? "Session (runs on the owner)"
						: "Desktop",
			})),
		[commands],
	);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Commands"
			description={`${commands.length} commands. Pick one to run it; commands that take an argument open their picker.`}
			options={options}
			searchPlaceholder="Search commands"
			onPick={(value) => {
				onClose();
				dispatch({ name: value, args: "" });
			}}
		/>
	);
};

// ---------------------------------------------------------------- reload

export const ReloadPicker: FC<PickerContext> = ({
	sessionId,
	onClose,
	rebind,
}) => {
	const [result, setResult] = useState<PickerResult | null>(null);
	const op = useOperation();
	const submit = useCallback(async () => {
		// Reopen the SAME identity: a fresh snapshot from the backend. Nothing
		// is resubmitted; the stream re-subscribes and replays from scratch.
		await op.perform(
			() =>
				desktopResult<{
					payload: { cold: boolean; history: DesktopHistoryPage };
				}>({
					op: "sessions.get",
					sessionId,
				}),
			(snapshot) => ({
				tone: "success",
				text: `Reopened ${sessionId}: ${snapshot.payload.cold ? "cold (no owner running)" : "live owner attached"}, ${
					snapshot.payload.history.entries.length
				} recent rows.`,
			}),
			"The conversation could not be reopened",
		);
		rebind(sessionId);
		setResult(null);
	}, [op, sessionId, rebind]);
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Reload this conversation"
			description="Re-reads the canonical session from the backend and re-attaches the stream. No turn is resubmitted."
			onSubmit={submit}
			submitLabel="Reload"
			busy={op.busy}
			result={op.result ?? result}
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
