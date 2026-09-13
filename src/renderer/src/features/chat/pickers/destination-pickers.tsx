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
import type {
	DesktopLoopState,
	DesktopModelCatalogue,
	NativeDesktopAction,
} from "../../../../../shared/desktop-control-contract";
import type {
	CanonicalModel,
	DesktopHistoryPage,
} from "../../../../../shared/desktop-session-contract";
import { messageText } from "../canonical/transcript-reducer";
import type { SlashCommandMeta } from "../components/slash-commands";
import { modelSelector, specUnresolved } from "../session-status/session-model";
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
	/** Re-dispatch a slash line (help -> pick a command). */
	dispatch: (text: string) => void;
	/** Switch the agent's bound canonical session (resume/fork/new). */
	rebind: (sessionId: string) => void;
};

type Entities<T = Record<string, unknown>> = {
	command: string;
	entities: T[];
	current: unknown;
};

function useEntities<T = Record<string, unknown>>(
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

export const ModelPicker: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
	note,
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
	 */
	const shownSelector = pickedCurrent ?? currentSelector;

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
			description: `${row.provider}${row.aggregated ? ", aggregated" : ""}${
				known && !row.connected ? ", no credential" : ""
			}`,
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
			const [provider, ...rest] = value.split("/");
			const modelId = rest.join("/");
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
		[canonical, command, persistDefault, persist, note, rowAuth],
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
				shownSelector
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
			busy={command.busy || persist.busy}
			/*
			 * The in-flight copy names the change, not the machinery: the user asked
			 * whether their pick registered, and "the backend" is the
			 * implementation's noun for their session (design D14, UX nit).
			 */
			busyText="Switching the model…"
			busyLabel="Switching the model"
			result={combined}
			toolbar={
				<div className="flex items-center justify-between gap-3">
					<PickerCheck
						checked={persistDefault}
						onCheckedChange={setPersistDefault}
						tone="muted"
					>
						{persistDefault
							? "This pick also sets the default for new sessions"
							: "Also make it the default for new sessions"}
					</PickerCheck>
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
}) => {
	const entities = useEntities<{ value: string }>(sessionId, "effort");
	const command = useSessionCommand(sessionId);
	const model = canonical.frontend?.selected_model;
	const options = useMemo<PickerOption[]>(
		() =>
			(entities.data?.entities ?? []).map((row) => ({
				value: row.value,
				label: row.value,
				current: entities.data?.current === row.value,
			})),
		[entities.data],
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
	const noOptions = options.length === 0 && !entities.isLoading;
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
							`${label} has not reported its effort levels yet. They appear after the next turn, or run /effort <level> to set one now.`
						: `${label} has no adjustable effort. Pick a reasoning model with /model first.`
					: `Effort levels ${label} supports. Applies to this session.`
			}
			options={options}
			loading={entities.isLoading}
			loadError={entities.isError ? errorText(entities.error) : null}
			emptyText={
				unresolved
					? "Not known yet - run /effort <level> to set one."
					: "Effort is not adjustable on this model."
			}
			onPick={(value) => void command.run("effort", value)}
			busy={command.busy}
			result={command.result}
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

type SessionRow = {
	id: string;
	name: string;
	mtime: number;
	live_state?: string;
	pending?: unknown;
};

function useSessionRows() {
	return useQuery({
		queryKey: ["desktop", "sessions", "rows"],
		queryFn: () =>
			desktopResult<{ sessions: SessionRow[] }>({
				op: "sessions.list",
				limit: 200,
			}).then((result) => result.sessions ?? []),
		staleTime: 5_000,
	});
}

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
			onSubmit={() => void command.run("goal", goal.trim())}
			submitLabel="Set goal"
			submitDisabled={!goal.trim()}
			actions={
				current ? (
					<Button
						variant="danger"
						size="sm"
						type="button"
						onClick={() => void command.run("goal", "clear")}
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

export const ContextView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const command = useSessionCommand(sessionId);
	// biome-ignore lint/correctness/useExhaustiveDependencies: fetch once on open
	useEffect(() => {
		void command.run("context", "");
	}, []);
	const block =
		command.outcome &&
		!isNativeAction(command.outcome) &&
		command.outcome.kind === "block"
			? (command.outcome.data as { items?: [string, string][]; title?: string })
			: null;
	const frontend = canonical.frontend;
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Context"
			description={block?.title ?? "What the next request will carry."}
			body={
				<div className="flex flex-col">
					{block?.items?.map(([label, value]) => (
						<PickerKeyValue key={label} label={label} value={value} />
					))}
					{frontend && (
						<>
							<PickerKeyValue
								label="Measured"
								value={
									frontend.context_tokens === null
										? "unknown"
										: `${frontend.context_tokens}${frontend.context_is_estimate ? " (estimate)" : ""}`
								}
							/>
							<PickerKeyValue
								label="Window"
								value={
									frontend.context_window === null
										? "unknown"
										: String(frontend.context_window)
								}
							/>
							<PickerKeyValue
								label="Cost knowledge"
								value={frontend.cost_knowledge}
							/>
						</>
					)}
					{command.busy && (
						<p className="text-ink-dim text-meta">Asking the owner</p>
					)}
				</div>
			}
			result={command.result?.tone === "error" ? command.result : null}
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
	const running = loop?.status === "running" || loop?.status === "judging";
	const standingGoal = canonical.frontend?.goal ?? "";
	const submit = useCallback(async () => {
		const args = mode === "count" ? count.trim() : goal.trim();
		if (!args) return;
		await command.run("loop", args);
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
						onClick={() => void cancel.run("loop", "cancel")}
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

export const CompactView: FC<PickerContext> = ({
	sessionId,
	canonical,
	onClose,
}) => {
	const command = useSessionCommand(sessionId);
	const [startedAt] = useState(() => Date.now());
	// biome-ignore lint/correctness/useExhaustiveDependencies: fire once on open
	useEffect(() => {
		void command.run("compact", "");
	}, []);
	// Completion comes from the canonical stream, not from the command
	// receipt: the owner answers "compacting" immediately and the compaction
	// record lands in the transcript when the pass actually settles.
	const settled = canonical.transcript.records.find(
		(record): record is Extract<typeof record, { kind: "compaction" }> =>
			record.kind === "compaction" && record.ts >= startedAt,
	);
	const state =
		command.result?.tone === "error"
			? "error"
			: settled
				? "complete"
				: "pending";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Compact context"
			description="Summarises older history so the next request is smaller."
			busy={state === "pending" && !command.busy}
			result={
				state === "complete" && settled
					? { tone: "success", text: settled.text }
					: (command.result ?? null)
			}
			body={
				state === "pending" ? (
					<p className="text-body-sm text-ink-muted">
						{command.result?.text ?? "Asking the owner to compact"}
					</p>
				) : undefined
			}
		/>
	);
};

export const CredentialPicker: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [key, setKey] = useState("");
	const [value, setValue] = useState("");
	const [confirmForget, setConfirmForget] = useState(false);
	const op = useOperation();
	const list = useQuery({
		queryKey: ["desktop", "credentials", sessionId],
		queryFn: () =>
			desktopResult<{ data: { ok: boolean; credentials: string[] } }>({
				op: "sessions.credential",
				sessionId,
				action: "list",
			}),
	});
	const options = useMemo<PickerOption[]>(
		() =>
			(list.data?.data.credentials ?? []).map((name) => ({
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
 * `/usage` lives in `usage-view.tsx`: it is the one data view with ported
 * rules of its own (`usage-view-model.ts` mirrors the TUI's `usage_panel.py`)
 * and a presentational half that stories render without a backend. Re-exported
 * here so `picker-registry.tsx` keeps importing every adapter from one module.
 */
export { UsageView } from "./usage-view";

export const FailoversView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const data = useQuery({
		queryKey: ["desktop", "failovers", sessionId],
		queryFn: () =>
			desktopResult<{
				data: {
					selected: Record<string, unknown> | null;
					effective: Record<string, unknown> | null;
					chains: Record<string, string[]>;
					scope: string;
					live_model_source: string;
				};
			}>({ op: "sessions.failovers", sessionId }),
	});
	const d = data.data?.data;
	const label = (model: Record<string, unknown> | null | undefined) =>
		model ? `${String(model.provider)}/${String(model.model_id)}` : "none";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Failovers"
			description="The model this session selected, the one actually serving it, and the configured default fallback chains. Defaults are configuration, not live routing state."
			body={
				data.isLoading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : data.isError ? (
					<p className="text-body-sm text-danger">{errorText(data.error)}</p>
				) : (
					<div className="flex flex-col gap-2">
						<PickerKeyValue label="Selected" value={label(d?.selected)} />
						<PickerKeyValue
							label="Effective (serving)"
							value={label(d?.effective)}
						/>
						<p className="pt-2 text-ink-dim text-meta">
							Default chains ({d?.scope})
						</p>
						{Object.keys(d?.chains ?? {}).length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								No fallback chains configured.
							</p>
						) : (
							Object.entries(d?.chains ?? {}).map(([from, to]) => (
								<PickerKeyValue
									key={from}
									label={from}
									value={to.join(" -> ") || "(none)"}
								/>
							))
						)}
					</div>
				)
			}
		/>
	);
};

export const AnalyticsView: FC<PickerContext> = ({ sessionId, onClose }) => {
	const [days, setDays] = useState(7);
	const [thisSession, setThisSession] = useState(false);
	const data = useQuery({
		queryKey: ["desktop", "analytics", days, thisSession ? sessionId : ""],
		queryFn: () =>
			desktopResult<{
				data: {
					aggregate: Record<string, unknown> & {
						by_provider?: Record<string, unknown>;
					};
					daily: Record<string, unknown>[];
					daily_scope?: string;
				};
			}>({
				op: "analytics.get",
				days,
				sessionId: thisSession ? sessionId : undefined,
			}),
	});
	const agg = data.data?.data.aggregate;
	const cost =
		typeof agg?.cost_micro === "number"
			? `$${(agg.cost_micro / 1_000_000).toFixed(4)}`
			: "unknown";
	return (
		<PickerHost
			open
			onClose={onClose}
			title="Analytics"
			wide
			description="Backend analytics store: model calls, tokens and known cost. The daily series always covers all sessions."
			toolbar={
				<div className="flex items-center gap-3">
					<PickerSegment
						label="Window"
						value={String(days) as "1" | "7" | "30"}
						onChange={(value) => setDays(Number(value))}
						options={[
							{ value: "1", label: "Today" },
							{ value: "7", label: "7 days" },
							{ value: "30", label: "30 days" },
						]}
					/>
					<PickerCheck
						checked={thisSession}
						onCheckedChange={setThisSession}
						tone="muted"
					>
						This session only (aggregate)
					</PickerCheck>
				</div>
			}
			body={
				data.isLoading ? (
					<p className="text-ink-dim text-meta">Loading</p>
				) : data.isError ? (
					<p className="text-body-sm text-danger">{errorText(data.error)}</p>
				) : (
					<div className="flex flex-col">
						<PickerKeyValue label="Calls" value={String(agg?.calls ?? 0)} />
						<PickerKeyValue
							label="Input tokens"
							value={String(agg?.input_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Output tokens"
							value={String(agg?.output_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Cache read"
							value={String(agg?.cache_read_tokens ?? 0)}
						/>
						<PickerKeyValue
							label="Known cost"
							value={`${cost} (${String(agg?.cost_known_calls ?? 0)} of ${String(agg?.calls ?? 0)} calls priced)`}
						/>
						<p className="pt-2 text-ink-dim text-meta">By provider</p>
						{Object.keys(agg?.by_provider ?? {}).length === 0 ? (
							<p className="text-body-sm text-ink-muted">
								No calls in this window.
							</p>
						) : (
							<pre className="max-h-48 overflow-auto font-mono text-ink-muted text-mono-sm">
								{JSON.stringify(agg?.by_provider, null, 2)}
							</pre>
						)}
					</div>
				)
			}
		/>
	);
};

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
				dispatch(`/${value}`);
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
