/**
 * The settings row's provider and model field: a searchable combobox whose
 * options come from the desktop control plane.
 *
 * ## Why this is settings-local
 *
 * It encodes the registry's key→source semantics rather than a general control,
 * and the settings rows are its only consumer. The general control it renders
 * is `shared/components/ui/searchable-select.tsx`, which this file does not
 * reimplement: one searchable single-select serves the settings page, the
 * hosting pickers and the canvas dialog, with one filter and one keyboard
 * model.
 *
 * ## What it deliberately does not do
 *
 * - **It does not save.** Picking reports a draft upward like every other
 *   `SettingControl` arm, and the row's own Save writes it. The host pickers
 *   save on pick; that is a different control for a different surface, and
 *   mixing both save models in one form is the thing `backend-settings-drafts`
 *   records as rejected.
 * - **It does not constrain.** Free text is committed verbatim, so a provider
 *   or a custom endpoint no catalogue has ever heard of is still typeable,
 *   still visible and still fixable. The suggestions assist; they do not
 *   decide. A field that could only store what a catalogue knows would make an
 *   offline or unlisted provider un-configurable.
 * - **It does not filter the provider list by credential.** See
 *   `providerOptions` — the whole login registry is offered, and the credential
 *   state is shown instead.
 */

import { catalogueListing } from "@features/chat/pickers/model-catalogue-listing";
import { backendLoadErrorMessage } from "@shared/api/local-operator/backend-error";
import {
	type BackendSetting,
	desktopResult,
} from "@shared/api/local-operator/desktop-api";
import {
	desktopFeatureEnabled,
	useDesktopCapabilities,
	useDesktopProviders,
} from "@shared/api/local-operator/desktop-hooks";
import { SearchableSelect } from "@shared/components/ui/searchable-select";
import { useQuery } from "@tanstack/react-query";
import type { FC } from "react";
import { useMemo, useState } from "react";
import type { DesktopModelCatalogue } from "../../../../../shared/desktop-control-contract";
import { COMBO_PLACEHOLDER, type ComboKind } from "../backend-setting-combos";
import {
	modelOptions,
	providerOptions,
	selectedOption,
} from "../model-setting-options";

/**
 * The id the row gives its help sentence, so the field can describe itself by
 * it.
 *
 * The accessible name is the row's label and the help is the sentence a reader
 * needs to interpret the value; without the association, a screen-reader user
 * hears "Default model, combobox" and nothing about the fact that an empty
 * value means the provider's own default.
 */
export const settingHelpId = (key: string) => `setting-help-${key}`;

export type SettingComboboxProps = {
	setting: BackendSetting;
	/** Which source this key's rows come from — the caller owns the lookup. */
	kind: ComboKind;
	/** The serialized draft. */
	value: string;
	disabled?: boolean;
	onValueChange: (value: string) => void;
	/**
	 * The `hosting` this row will actually boot on: the hosting row's DRAFT
	 * while it is unsaved, the server's value otherwise.
	 *
	 * It matters because the two settings are read independently at boot: a
	 * model id chosen against the stored hosting, then saved beside an edited
	 * hosting, would name a model the new provider does not own. An empty string
	 * means "unknown", which the builders widen to the whole catalogue rather
	 * than narrowing to nothing.
	 */
	effectiveHosting: string;
	/**
	 * The row's help sentence, when the row is rendering one. An advanced row
	 * keeps its help behind a disclosure, so the attribute is only passed when
	 * the sentence is genuinely on the page.
	 */
	helpId?: string;
};

export const SettingCombobox: FC<SettingComboboxProps> = ({
	setting,
	kind,
	value,
	disabled = false,
	onValueChange,
	effectiveHosting,
	helpId,
}) => {
	const capabilities = useDesktopCapabilities();

	/*
	 * The provider registry is fetched on MOUNT, because the `hosting` row is on
	 * screen at arrival and page open IS the intent there: one local IPC call
	 * for a list of tens of rows.
	 */
	const providersEnabled =
		kind === "provider" && desktopFeatureEnabled(capabilities.data, "auth");
	const providers = useDesktopProviders(providersEnabled);

	/*
	 * The model catalogue is fetched on FIRST OPEN instead, and the difference is
	 * the payload: the non-live answer for the operator's own catalogue is
	 * roughly 460 KB of JSON, and most visits to a settings page never ask a
	 * model question. A lazy query does not stall anything — the row paints
	 * immediately as a field with its placeholder, and the list arrives inside
	 * the gesture that asked for it.
	 *
	 * The key is the CHAT PICKER'S OWN (`["desktop", "models", false]`), so a
	 * session that has already opened the picker and the settings page share one
	 * cache entry instead of fetching the catalogue twice. `live: false` always:
	 * a live re-list is a measured 2.33 s, and this field is a boot preference
	 * rather than a listing. The key is spelled here rather than added to
	 * `desktopKeys`, because a second spelling of one key is the defect class
	 * this repository has already paid for.
	 */
	const modelsEnabled =
		kind !== "provider" &&
		desktopFeatureEnabled(capabilities.data, "catalogues");
	const [opened, setOpened] = useState(false);
	const catalogue = useQuery({
		queryKey: ["desktop", "models", false],
		queryFn: () =>
			desktopResult<DesktopModelCatalogue>({
				op: "models.catalogue",
				live: false,
			}),
		enabled: modelsEnabled && opened,
		staleTime: 60_000,
	});

	const options = useMemo(() => {
		if (kind === "provider")
			return providers.data ? providerOptions(providers.data) : [];
		return modelOptions(catalogue.data, {
			kind,
			hosting: kind === "model" ? effectiveHosting : "",
			current: value,
		});
	}, [kind, providers.data, catalogue.data, effectiveHosting, value]);

	const listing = catalogueListing(catalogue.data, catalogue, (error) =>
		backendLoadErrorMessage("Could not list models.", error),
	);

	/*
	 * What the field says under itself, and why the two cases are drawn
	 * differently. A PARTIAL failure is a note — providers that did not answer,
	 * with the rows that did still below them — and it is dim, like the row's own
	 * help. A query that THREW is an error state, and it is the one thing that
	 * leaves the field with nothing to offer, so it is stated in danger ink
	 * rather than buried in the same grey sentence.
	 */
	const helper = listing.loadError ? (
		<span className="text-danger">{listing.loadError}</span>
	) : (
		listing.notice
	);
	const helperProps = listing.noticeDetail
		? { title: listing.noticeDetail }
		: {};

	const selected = selectedOption(options, value);

	return (
		<SearchableSelect
			/* The registry row renders its own label, warning and help, so this
			   instance is chrome-less and takes its accessible name from the row's
			   label — which is what the plain text input it replaces already did. */
			showLabel={false}
			ariaLabel={setting.label}
			ariaDescribedBy={helpId}
			label={setting.label}
			placeholder={COMBO_PLACEHOLDER[kind]}
			options={options}
			selected={selected}
			disabled={disabled}
			busy={kind === "provider" ? providers.isFetching : catalogue.isFetching}
			busyLabel={kind === "provider" ? "Loading providers" : "Loading models"}
			onOpenChange={(open) => {
				if (open) setOpened(true);
			}}
			onSelect={(option) => onValueChange(option.id)}
			/* The free-text escape hatch, and the whole of "suggestions assist,
			   they do not constrain": what is committed is exactly what was
			   typed, whether or not any catalogue has heard of it. */
			onCustomSubmit={(text) => onValueChange(text)}
			/* Clearing is an explicit gesture rather than an empty buffer, so that
			   "unset" (which `empty_unsets` writes as null) stays distinct from
			   "typed something that matched nothing" (which is a value). */
			onClear={() => onValueChange("")}
			emptyText={
				kind === "provider" ? "No providers" : "Nothing matches that model"
			}
			helperText={helper ? <span {...helperProps}>{helper}</span> : undefined}
		/>
	);
};
