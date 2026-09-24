/**
 * Default Model Step Component
 *
 * Step 2 of 3: the model new chats use. It CONFIRMS rather than asks (design
 * audit § 5): a sign-in on a current backend has already written the default
 * (`defaults_applied`), so the step shows that choice with a "Change". On an
 * older backend, or when several providers are connected, it preselects the
 * connected provider's backend suggestion and Continue writes it.
 *
 * The data source is the census plus the config (`chooseDefaultModel`), never
 * the legacy `/v1/credentials` key list: OAuth sign-ins are not in that list,
 * which is how this step came to say "No providers with credentials yet" to a
 * user who had just signed in (design D5, UX U2).
 */

import {
	type DefaultModelChoice,
	chooseDefaultModel,
} from "@features/providers/default-model-choice";
import {
	brandOf,
	modelDisplayName,
} from "@features/providers/provider-catalog";
import { useDefaultModel } from "@features/providers/use-provider-status";
import { useDesktopProviders } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { HostingSelect } from "@shared/components/hosting/hosting-select";
import { ModelSelect } from "@shared/components/hosting/model-select";
import { Alert, Button } from "@shared/components/ui";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import { useModelsStore } from "@shared/store/models-store";
import type { FC } from "react";
import { useEffect, useMemo, useState } from "react";
import { planDefaultModelWrite } from "./default-model-plan";

/**
 * The step's content, as a pure function of the choice, so a story (and a
 * test) can render every answer without a backend.
 */
export const DefaultModelSummary: FC<{
	choice: DefaultModelChoice;
	onChange: () => void;
}> = ({ choice, onChange }) => {
	if (choice.kind === "none") {
		return (
			<Alert variant="neutral">
				No provider is connected yet. Go back to connect one, or skip setup and
				connect one later from the chat.
			</Alert>
		);
	}
	if (choice.kind === "choose") {
		return (
			<p className="text-body-sm text-ink-muted">
				{brandOf(choice.provider)} is connected. Pick the model new chats should
				use.
			</p>
		);
	}
	const name =
		choice.kind === "applied"
			? (modelDisplayName(choice.provider, choice.model) ??
				`${choice.provider ? brandOf(choice.provider) : choice.hosting}'s default model`)
			: choice.model.name;
	const brand =
		choice.kind === "applied"
			? choice.provider
				? brandOf(choice.provider)
				: choice.hosting
			: brandOf(choice.provider);
	return (
		<div className="flex flex-col gap-1" data-default-model={choice.kind}>
			<p className="text-heading text-ink">{name}</p>
			<p className="text-ink-dim text-meta">
				{brand} ·{" "}
				{choice.kind === "applied"
					? "your default"
					: "suggested for your account"}
			</p>
			<div className="pt-2">
				<Button variant="secondary" size="sm" onClick={onChange}>
					Change
				</Button>
			</div>
		</div>
	);
};

type DefaultModelStepProps = {
	/**
	 * Registers the action Continue must run first, so a PROPOSED default is
	 * written when the user accepts it rather than the moment the step renders
	 * (a render that writes config is a surprise a Back press cannot undo).
	 */
	onBeforeContinue?: (run: (() => Promise<void>) | null) => void;
	/**
	 * Reports what the step still needs before Continue can mean anything, so the
	 * footer can say it and disable the button. Null when the step is ready: a
	 * step the user can walk past with nothing chosen lands them in a chat that
	 * cannot run (QA round 1 Q3, UX U1).
	 */
	onBlockReason?: (reason: string | null) => void;
};

export const DefaultModelStep: FC<DefaultModelStepProps> = ({
	onBeforeContinue,
	onBlockReason,
}) => {
	const providers = useDesktopProviders(true);
	const config = useDefaultModel();
	const updateConfig = useUpdateConfig();
	const [editing, setEditing] = useState(false);

	const choice =
		providers.isLoading || config.isLoading
			? null
			: chooseDefaultModel(providers.data ?? [], config);
	/*
	 * The catalogue this Local Operator can offer for a provider, from the same
	 * store the picker below reads: a released backend publishes one for most
	 * providers, and where it does not the step says so instead of waiting for a
	 * pick that cannot happen.
	 */
	/*
	 * The step fetches the catalogue ITSELF. Nothing else does on this path:
	 * `ModelsInitializer` runs with `autoFetch: false`, and the list is loaded when a
	 * picker MOUNTS -- so a first visit said the backend could not list models it was
	 * serving, and a connect that ran before any picker mounted wrote a `hosting` with
	 * no model beside it (QA round 3 Q3-3, UX round 3 U9).
	 */
	const { refreshModels } = useModels();
	/*
	 * ONCE, on mount. `refreshModels` is a useCallback whose own identity moves with
	 * the state its dependencies read, so depending on it re-runs this effect after
	 * the fetch it just made and loops ("Maximum update depth exceeded", measured by
	 * rendering this step). One fetch per visit is what this needs: the store keeps
	 * the result, and the step re-renders from it.
	 */
	// biome-ignore lint/correctness/useExhaustiveDependencies: a fetch on mount; see above
	useEffect(() => {
		void refreshModels();
	}, []);
	const modelsReady = useModelsStore((state) => state.isInitialized);
	const storeModels = useModelsStore((state) => state.models);
	const catalogueProviders = useMemo(() => {
		const ids = new Set<string>();
		for (const model of storeModels) ids.add(model.provider);
		return [...ids];
	}, [storeModels]);

	/*
	 * One decision, in `default-model-plan.ts`: the provider this step SHOWS, what
	 * Continue WRITES, and whether it may be pressed. It is a pure function so the
	 * three mutants a review round tried against this exact rule -- never write the
	 * shown provider, never report the block, finish anyway -- have a test that
	 * fails (review round 2 R2-M3). A backend that applies no defaults on sign-in
	 * (every released one) is why the shown provider must be the written one: setup
	 * finishing with an empty `hosting` is a chat that cannot run (QA Q3, UX U1).
	 */
	const plan = useMemo(
		() =>
			planDefaultModelWrite({
				choice,
				hosting: config.hosting,
				model: config.model,
				catalogue: { ready: modelsReady, providers: catalogueProviders },
			}),
		[choice, config.hosting, config.model, modelsReady, catalogueProviders],
	);
	const { shownProvider, write, block, noCatalogue, modelToWrite } = plan;
	const shownRow =
		(providers.data ?? []).find((row) => row.id === shownProvider) ?? null;

	// Registered from an effect, never during render: the parent holds it in a
	// ref and runs it when Continue is pressed, so what the step SHOWS is what
	// Continue WRITES.
	useEffect(() => {
		onBeforeContinue?.(
			write
				? async () => {
						await updateConfig.mutateAsync(write);
					}
				: null,
		);
		return () => onBeforeContinue?.(null);
	}, [onBeforeContinue, write, updateConfig.mutateAsync]);

	useEffect(() => {
		if (!onBlockReason) return undefined;
		onBlockReason(block);
		return () => onBlockReason(null);
	}, [onBlockReason, block]);

	if (choice === null) {
		return (
			<div className="flex items-center justify-center gap-3 py-8">
				<Spinner size="sm" />
				<p className="text-body-sm text-ink-muted">Loading your models</p>
			</div>
		);
	}

	const editor = (
		<div className="flex flex-col gap-4">
			<HostingSelect
				value={shownProvider}
				onSave={async (value) => {
					await updateConfig.mutateAsync({ hosting: value });
				}}
				filterByCredentials={true}
				allowCustom={false}
				allowDefault={false}
				emptyHelperText="No providers are connected yet. Go back a step to connect one."
			/>
			<ModelSelect
				value={modelToWrite}
				/*
				 * The provider being SHOWN, not the one that happens to be saved:
				 * on a released backend nothing is saved yet, and an empty id is
				 * what made the picker say "Select a hosting provider first"
				 * directly under a filled provider field (code round 1 M2).
				 */
				hostingId={shownProvider}
				onSave={async (value) => {
					await updateConfig.mutateAsync({ model_name: value });
				}}
				allowCustom={true}
				allowDefault={false}
			/>
		</div>
	);

	return (
		<div className="flex flex-col gap-5">
			<p className="text-body text-ink-muted">
				New chats use this model. Every agent can pick a different one later.
			</p>
			{noCatalogue ? (
				<p className="text-ink-dim text-meta">
					Your Local Operator can't list{" "}
					{shownRow ? brandOf(shownRow) : "this provider's"} models yet. Finish
					setup and pick one in Settings once it can.
				</p>
			) : null}
			{editing || choice.kind === "choose" ? (
				editor
			) : (
				<DefaultModelSummary
					choice={choice}
					onChange={() => setEditing(true)}
				/>
			)}
		</div>
	);
};
