import {
	draftPreviewKey,
	draftPreviewQuery,
} from "@features/chat/draft-selection";
import {
	bandReadings,
	effortDisplay,
	effortLadder,
	effortLevel,
	specUnresolved,
} from "@features/chat/session-status/session-model";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type { BackendSettings } from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
} from "@shared/api/local-operator/desktop-hooks";
import { SearchableSelect } from "@shared/components/ui";
import { useHomeDirectory } from "@shared/hooks";
import { t } from "@shared/i18n";
import { useI18nLocale } from "@shared/i18n/use-locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Gauge } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	type DefaultEffortOption,
	defaultEffortClampWrite,
	defaultEffortState,
} from "../default-effort-options";
import { MODEL_EFFORT_SETTING_KEY } from "../promoted-setting-sections";
import { backendSettingsKeys } from "./backend-settings-section";

/**
 * Settings → Model settings → Default effort.
 *
 * WHAT IT STORES. The settings-registry key `model_effort` (its empty string is
 * "no opinion"), read under the page's own `settings.list` cache entry
 * (`backendSettingsKeys.all`) and written with `settings.edit`. Deliberately not
 * the legacy `config.update` path: `model_effort` is not a `ConfigValues` field,
 * so a write through that door would be rejected by the backend.
 *
 * WHERE THE OPTIONS COME FROM. The composer's per-model ladder, not a local
 * table: a draft pane asks `POST /v1/desktop/sessions/preview`
 * (`draftPreviewQuery`) and the picker prints `reasoning_efforts` off the model
 * the backend resolved. Settings has no session, so a preview with the selected
 * hosting/model and no chosen rung is exactly the composer's own source. The
 * model CATALOGUE does not expose `reasoning_efforts`, so there is nothing else
 * to read and nothing here re-derives it.
 *
 * WHY THE PREVIEW REQUEST CARRIES `reasoning_effort: null`. That is the same
 * question the composer asks when nothing is chosen, and its answer is the
 * backend's own clamp (`resolve_effort_in`, `local_operator/model/effort.py`)
 * for this model. The clamp decision in `default-effort-options.ts` writes that
 * answer when a model switch leaves a stored level off the new ladder — see the
 * module docstring for the rationale, the gates on the write, and the accepted
 * consequence (returning to the old model does not restore the old level).
 *
 * WHY A SINGLE-RUNG MODEL IS DISABLED. Offering "Model default" beside the one
 * level a model accepts would be one outcome with two names; the control says
 * the model offers one level instead.
 *
 * WHY THE OPTIONS ARE FILTERED BY THE STORED KEY'S OWN CHOICES. A model's ladder
 * is not the set `model_effort` accepts: Radient lists `auto` (the registry's
 * LABEL for `""`), and a write of that spelling is rejected. The storable set
 * comes from this page's `settings.list` row (`choices[].value`), so the row
 * offers only rungs the registry can hold and the clamp never writes a
 * sentinel.
 *
 * WHY THE STORED VALUE IS PART OF THE PREVIEW KEY. `reasoning_effort: null` is
 * resolved by the backend against the STORED default, so the answer is a
 * function of `model_effort` as well as the model. Without it in the key, the
 * row's own write leaves the cached answer describing the previous stored
 * value: clearing the row would still print "Runs at Max", and a model switch
 * would clamp to the old value's resolution. `null` in the key means "settings
 * not read yet", which is distinct from the storable `""`.
 *
 * WHY A WRITE IS ANNOUNCED. A clamp silently replaces the level the user chose,
 * and the control's own spinner says only that something is being saved. The
 * row therefore states the substitution after it succeeds, and shows the TARGET
 * level while the write is in flight rather than falling back through "Model
 * default" for the duration.
 *
 * WHY `focus` EXISTS. A `/settings?setting=model_effort` deep link resolves to
 * General because this control was promoted out of the backend registry (see
 * `promoted-setting-sections.ts`), and the page suppresses the backend section's
 * own `focusKey` for promoted keys. Landing the section alone would leave the
 * reader at General's top with nothing naming the row they asked for, so the
 * page hands this component the same boolean the General language row receives
 * and the row focuses its own combobox once the control can take focus. The
 * wait for an ENABLED control is the part this row adds: its input is disabled
 * while the settings registry or the model's ladder is still out, and a disabled
 * input cannot be focused.
 */
type DefaultEffortSelectProps = {
	/** The configured hosting, from the page's config read. */
	hosting: string;
	/** The configured model id, from the page's config read. */
	modelName: string;
	/** Whether a deep link named this row and it should be revealed and focused. */
	focus?: boolean;
	/** A second reveal of the same row, from a second search jump (see `general`). */
	focusNonce?: number;
};

export const DefaultEffortSelect: FC<DefaultEffortSelectProps> = ({
	hosting,
	modelName,
	focus = false,
	focusNonce,
}) => {
	/* Copy-bearing projections recompute after a locale change, as every
	 * surface's do: `t()` reads the active locale at call time, and this hook is
	 * what repaints the row when the interface language moves. */
	useI18nLocale();
	const capabilities = useDesktopCapabilities();
	/*
	 * The gate, not a fallback: `sessions.preview` is the only source of a
	 * model's ladder outside a live session, so a backend that does not
	 * advertise `draft_preview` gets no row rather than a list invented here.
	 */
	const supported = desktopFeatureEnabled(capabilities.data, "draft_preview");
	const homeDirectory = useHomeDirectory();
	const hasModel = hosting !== "" && modelName !== "";

	/*
	 * The page's OWN settings query key, so this row reuses the cache entry
	 * `BackendSettingsSection` already fills instead of issuing a second read
	 * of the same registry.
	 */
	const settingsQuery = useQuery({
		queryKey: backendSettingsKeys.all,
		queryFn: () => desktopResult<BackendSettings>({ op: "settings.list" }),
		enabled: supported,
		staleTime: 10_000,
	});

	/*
	 * The storable vocabulary, off the same registry row: `choices[].value` is
	 * `""` plus the rungs the backend's validator accepts (`settings_io.py`).
	 * Reading it here is what keeps a ladder sentinel (`auto`) out of the list
	 * and out of a clamp write.
	 */
	const storedRow = settingsQuery.data?.settings.find(
		(row) => row.key === MODEL_EFFORT_SETTING_KEY,
	);
	const stored = typeof storedRow?.value === "string" ? storedRow.value : "";
	const storable = (storedRow?.choices ?? [])
		.map((choice) => choice.value)
		.filter((value): value is string => typeof value === "string");

	/*
	 * The preview target, built ONCE so its key and its request describe the
	 * same selection.
	 */
	const previewTarget = {
		// The preview needs a working directory; the home folder is the one
		// the composer's draft pane uses and the only one Settings has. The
		// request is NOT issued until the hook answers, so an empty string
		// never reaches the wire.
		cwd: homeDirectory ?? "",
		model: hasModel
			? {
					provider: hosting,
					model_id: modelName,
					reasoning_effort: null,
				}
			: null,
	};
	/*
	 * `stored` is part of the KEY because the answer depends on it: the backend
	 * resolves `reasoning_effort: null` against the stored `model_effort`. The
	 * request itself stays null (the same question the composer asks), and a
	 * settings write changes this key, so the cached answer cannot outlive the
	 * stored value it described. `null` here is "settings not read yet", which
	 * is a different input from the storable empty string.
	 */
	const storedForQuery = settingsQuery.isSuccess ? stored : null;
	const preview = useQuery({
		...draftPreviewQuery(
			previewTarget,
			desktopFeatureEnabled(capabilities.data, "draft_fast"),
		),
		queryKey: [
			...draftPreviewKey(previewTarget),
			"model_effort",
			storedForQuery,
		],
		enabled: supported && Boolean(homeDirectory) && hasModel,
	});

	/*
	 * `keepPreviousData` on the preview means the previous model's snapshot can
	 * be on screen while the new one loads. Reading it then would clamp against
	 * the wrong ladder, so placeholder data is treated as "still loading"
	 * everywhere below.
	 */
	const fresh = preview.isSuccess && !preview.isPlaceholderData;
	const effectiveModel = fresh
		? bandReadings(preview.data?.snapshot, null).effort
		: null;
	const ladder =
		fresh && Array.isArray(effectiveModel?.reasoning_efforts)
			? effortLadder(effectiveModel)
			: null;
	const resolvedLevel = fresh ? effortLevel(effectiveModel) : null;
	const specResolved =
		effectiveModel !== null && !specUnresolved(effectiveModel);

	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	/*
	 * The value an in-flight write is moving to. Shown as the chosen row while
	 * the write settles (see `selectedOption`), so the clamp reads as one
	 * substitution instead of passing through "Model default" a frame later.
	 */
	const [pendingValue, setPendingValue] = useState<string | null>(null);
	/*
	 * The clamp announcement carries the model it describes, so switching the
	 * Model row HIDES it without an effect: a sentence about the previous model's
	 * ladder must not sit under the new model's row.
	 */
	const [clampNotice, setClampNotice] = useState<{
		text: string;
		model: string;
	} | null>(null);
	const modelIdentity = `${hosting}\u0000${modelName}`;
	const queryClient = useQueryClient();
	/* The row's own subtree, so the deep link can find the combobox it focuses. */
	const container = useRef<HTMLDivElement>(null);
	/* Focus once per link, not on every repaint: refocusing a settled row would
	 * steal the caret from a reader already typing in it. */
	const focused = useRef(false);
	const focusNonceRef = useRef(focusNonce);
	useEffect(() => {
		if (focusNonce === focusNonceRef.current) return;
		focusNonceRef.current = focusNonce;
		focused.current = false;
	}, [focusNonce]);

	/*
	 * The one write path. On success the registry is invalidated so this row
	 * and the registry's own `model_effort` row read the same new value; on
	 * failure the control is NOT reset — it keeps showing the stored value and
	 * the helper says the new one was not saved, which is the difference
	 * between a refusal and a silent revert.
	 *
	 * `notice` is the sentence to announce when a CLAMP succeeds. A user pick
	 * passes null and clears whatever the last clamp said.
	 */
	const save = useCallback(
		async (value: string, notice: { text: string; model: string } | null) => {
			setSaving(true);
			setPendingValue(value);
			setSaveFailed(false);
			if (notice === null) setClampNotice(null);
			try {
				await desktopResult({
					op: "settings.edit",
					key: MODEL_EFFORT_SETTING_KEY,
					value,
				});
				await queryClient.invalidateQueries({
					queryKey: backendSettingsKeys.all,
				});
				if (notice !== null) setClampNotice(notice);
			} catch {
				setSaveFailed(true);
			} finally {
				setSaving(false);
				setPendingValue(null);
			}
		},
		[queryClient],
	);

	/*
	 * The model's own display name when the preview reported one; its id
	 * otherwise. Read only by the clamp sentence, which is composed when the
	 * preview for the new model HAS answered.
	 */
	const modelLabel =
		(typeof effectiveModel?.display_name === "string" &&
			effectiveModel.display_name.trim()) ||
		modelName;

	const state = defaultEffortState({
		supported,
		hasHome: Boolean(homeDirectory),
		hasModel,
		settings: settingsQuery.isError
			? "error"
			: settingsQuery.isSuccess
				? "ready"
				: "loading",
		preview: preview.isError ? "error" : fresh ? "ready" : "loading",
		ladder,
		specResolved,
		stored,
		resolvedLevel,
		storable,
	});

	/*
	 * The model-switch clamp. `defaultEffortClampWrite` decides; this effect
	 * only performs the decision and remembers the last (provider, model,
	 * stored, target) it performed, so a failed write that leaves the stored
	 * value unchanged is not retried in a loop while a DIFFERENT model still
	 * re-decides the same pair.
	 */
	const clampWrite = defaultEffortClampWrite({
		stored,
		ladder,
		resolvedLevel,
		resolved: fresh && specResolved && settingsQuery.isSuccess,
		storable,
	});
	const performedClamp = useRef<string | null>(null);
	useEffect(() => {
		if (clampWrite === null || saving) return;
		const pair = `${hosting}\u0000${modelName}\u0000${stored}\u0000${clampWrite}`;
		if (performedClamp.current === pair) return;
		performedClamp.current = pair;
		/*
		 * Composed BEFORE the write and announced only on success: a failed
		 * clamp must not claim a substitution that did not land.
		 */
		const text =
			clampWrite === ""
				? t("ui.settings.model.default_effort.clamped_unset", {
						level: effortDisplay(stored),
						model: modelLabel,
					})
				: t("ui.settings.model.default_effort.clamped", {
						level: effortDisplay(stored),
						model: modelLabel,
						resolved: effortDisplay(clampWrite),
					});
		void save(clampWrite, { text, model: modelIdentity });
	}, [
		clampWrite,
		stored,
		saving,
		save,
		hosting,
		modelName,
		modelLabel,
		modelIdentity,
	]);

	const options = useMemo(
		() => state.options.map(toSearchableOption),
		[state.options],
	);
	/*
	 * The deep link's reveal (see the `focus` prop). Mirrors the General language
	 * row's mechanism; the addition is waiting for `state.disabled === false`,
	 * because this input is disabled while either read is out and `focus()` on a
	 * disabled input is a no-op. Native `focus()` also scrolls the row into view,
	 * which is what "revealed" means for a link that lands the section.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: `focusNonce` is a re-run trigger, not a value this body reads — the reset effect above clears the idempotence ref when it changes, and this effect must re-run in the same commit to take the caret.
	useEffect(() => {
		if (!focus) {
			focused.current = false;
			return;
		}
		if (state.disabled || focused.current) return;
		container.current?.querySelector<HTMLElement>("[role=combobox]")?.focus();
		focused.current = true;
	}, [focus, focusNonce, state.disabled]);
	const shownSelectedId = pendingValue ?? state.selectedId;
	const selectedOption =
		options.find((option) => option.id === shownSelectedId) ??
		/*
		 * The target of an in-flight write is not in the list while the preview
		 * refetches for the NEW stored value (its options collapse to the unset
		 * row for that frame). Show the target itself until the fresh ladder
		 * lands, so a clamp reads Max -> High rather than Max -> Model default ->
		 * High.
		 */
		(pendingValue !== null
			? { id: pendingValue, name: effortDisplay(pendingValue) }
			: null);
	/*
	 * The announcement surface is this ALWAYS-PRESENT `<output>`: a live region
	 * that arrives already populated is not reliably announced. It carries the
	 * spec's implicit ARIA role `status` (nothing sets the attribute, and none
	 * is needed), plus `aria-live="polite"` for clients that do not map the
	 * element to the role. It stays empty unless a clamp landed.
	 */
	const helper = (
		<span className="flex flex-col gap-0.5">
			<span>{state.helper}</span>
			{saveFailed && (
				<span className="text-danger">
					{t("ui.settings.model.default_effort.save_failed")}
				</span>
			)}
			<output aria-live="polite">
				{clampNotice?.model === modelIdentity ? clampNotice.text : ""}
			</output>
		</span>
	);

	/* Unsupported is the one state that is not a row: see the gate above. */
	if (state.kind === "unsupported") return null;

	return (
		<div ref={container} data-setting-key={MODEL_EFFORT_SETTING_KEY}>
			<SearchableSelect
				label={t("ui.settings.model.default_effort.label")}
				icon={<Gauge size={16} aria-hidden="true" />}
				placeholder={t("ui.settings.model.default_effort.placeholder")}
				options={options}
				selected={selectedOption}
				onSelect={(option) => {
					void save(option.id, null);
				}}
				helperText={helper}
				busy={saving}
				busyLabel={t("ui.settings.model.default_effort.busy")}
				disabled={state.disabled || saving}
			/>
		</div>
	);
};

/**
 * The pure module's row shape into the control's, without a second mapping
 * table: `id`/`name` mean the same thing on both sides, and only `description`
 * needs renaming to the control's spelling.
 */
function toSearchableOption(option: DefaultEffortOption) {
	return {
		id: option.id,
		name: option.name,
		description: option.description,
	};
}
