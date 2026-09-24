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
import { useUpdateConfig } from "@shared/hooks/use-update-config";
import type { FC } from "react";
import { useEffect, useState } from "react";

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
};

export const DefaultModelStep: FC<DefaultModelStepProps> = ({
	onBeforeContinue,
}) => {
	const providers = useDesktopProviders(true);
	const config = useDefaultModel();
	const updateConfig = useUpdateConfig();
	const [editing, setEditing] = useState(false);

	const choice =
		providers.isLoading || config.isLoading
			? null
			: chooseDefaultModel(providers.data ?? [], config);
	const proposal = choice?.kind === "proposed" && !editing ? choice : null;
	const proposedProvider = proposal?.provider.id ?? null;
	const proposedModel = proposal?.model.id ?? null;
	// Registered from an effect, never during render: the parent holds it in a
	// ref and runs it when Continue is pressed.
	useEffect(() => {
		onBeforeContinue?.(
			proposedProvider && proposedModel
				? async () => {
						await updateConfig.mutateAsync({
							hosting: proposedProvider,
							model_name: proposedModel,
						});
					}
				: null,
		);
		return () => onBeforeContinue?.(null);
	}, [
		onBeforeContinue,
		proposedProvider,
		proposedModel,
		updateConfig.mutateAsync,
	]);

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
				value={
					config.hosting ??
					(choice.kind === "choose" || choice.kind === "proposed"
						? choice.provider.id
						: "")
				}
				onSave={async (value) => {
					await updateConfig.mutateAsync({ hosting: value });
				}}
				filterByCredentials={true}
				allowCustom={false}
				allowDefault={false}
				emptyHelperText="No providers are connected yet. Go back a step to connect one."
			/>
			<ModelSelect
				value={config.model ?? ""}
				hostingId={config.hosting ?? ""}
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
