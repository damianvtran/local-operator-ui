import { draftPreviewQuery } from "@features/chat/draft-selection";
import {
	bandReadings,
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
 */
type DefaultEffortSelectProps = {
	/** The configured hosting, from the page's config read. */
	hosting: string;
	/** The configured model id, from the page's config read. */
	modelName: string;
};

export const DefaultEffortSelect: FC<DefaultEffortSelectProps> = ({
	hosting,
	modelName,
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

	const preview = useQuery({
		...draftPreviewQuery({
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
		}),
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

	const storedRow = settingsQuery.data?.settings.find(
		(row) => row.key === "model_effort",
	);
	const stored = typeof storedRow?.value === "string" ? storedRow.value : "";

	const [saving, setSaving] = useState(false);
	const [saveFailed, setSaveFailed] = useState(false);
	const queryClient = useQueryClient();

	/*
	 * The one write path. On success the registry is invalidated so this row
	 * and the registry's own `model_effort` row read the same new value; on
	 * failure the control is NOT reset — it keeps showing the stored value and
	 * the helper says the new one was not saved, which is the difference
	 * between a refusal and a silent revert.
	 */
	const save = useCallback(
		async (value: string) => {
			setSaving(true);
			setSaveFailed(false);
			try {
				await desktopResult({
					op: "settings.edit",
					key: "model_effort",
					value,
				});
				await queryClient.invalidateQueries({
					queryKey: backendSettingsKeys.all,
				});
			} catch {
				setSaveFailed(true);
			} finally {
				setSaving(false);
			}
		},
		[queryClient],
	);

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
	});

	/*
	 * The model-switch clamp. `defaultEffortClampWrite` decides; this effect
	 * only performs the decision and remembers the last pair it performed, so a
	 * failed write that leaves the stored value unchanged is not retried in a
	 * loop (the next attempt needs either a different stored value or a
	 * different model's resolution).
	 */
	const clampWrite = defaultEffortClampWrite({
		stored,
		ladder,
		resolvedLevel,
		resolved: fresh && specResolved && settingsQuery.isSuccess,
	});
	const performedClamp = useRef<string | null>(null);
	useEffect(() => {
		if (clampWrite === null || saving) return;
		const pair = `${stored}\u0000${clampWrite}`;
		if (performedClamp.current === pair) return;
		performedClamp.current = pair;
		void save(clampWrite);
	}, [clampWrite, stored, saving, save]);

	const options = useMemo(
		() => state.options.map(toSearchableOption),
		[state.options],
	);
	const selectedOption =
		options.find((option) => option.id === state.selectedId) ?? null;
	const helper = saveFailed ? (
		<span className="flex flex-col gap-0.5">
			<span>{state.helper}</span>
			<span className="text-danger">
				{t("ui.settings.model.default_effort.save_failed")}
			</span>
		</span>
	) : (
		state.helper
	);

	/* Unsupported is the one state that is not a row: see the gate above. */
	if (state.kind === "unsupported") return null;

	return (
		<SearchableSelect
			label={t("ui.settings.model.default_effort.label")}
			icon={<Gauge size={16} aria-hidden="true" />}
			placeholder={t("ui.settings.model.default_effort.placeholder")}
			options={options}
			selected={selectedOption}
			onSelect={(option) => {
				void save(option.id);
			}}
			helperText={helper}
			busy={saving}
			busyLabel={t("ui.settings.model.default_effort.busy")}
			disabled={state.disabled}
		/>
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
