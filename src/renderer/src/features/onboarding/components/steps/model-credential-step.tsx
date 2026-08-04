/**
 * Model Credential Step Component
 *
 * Third step in the onboarding process: pick a model provider and paste its API
 * key. The key is saved on blur, so the step has no save button of its own —
 * the confirmation is the only thing that appears afterwards.
 */

import {
	CREDENTIAL_MANIFEST,
	CredentialType,
} from "@features/settings/components/credential-manifest";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	Input,
	Label,
	Select,
	SelectContent,
	SelectItem,
	SelectTrigger,
	SelectValue,
} from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useModels } from "@shared/hooks/use-models";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { cn } from "@shared/lib/utils";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";

const PROVIDER_SELECT_ID = "onboarding-model-provider";
const PROVIDER_HELP_ID = "onboarding-model-provider-help";
const KEY_INPUT_ID = "onboarding-model-key";
const KEY_HELP_ID = "onboarding-model-key-help";

/**
 * Model credential step in the onboarding process
 */
export const ModelCredentialStep: FC = () => {
	// Get the list of model provider credentials
	const modelProviderCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => cred.type === CredentialType.Hosting,
	);

	/*
	 * Default to the first provider that is not Radient Pass.
	 *
	 * Radient is first in the manifest, and this step is only reached from the
	 * "use your own keys" branch — so the pre-selected option was the one the
	 * user had just declined one screen earlier, with help text telling them to
	 * sign in above, on a screen with nothing above. Radient stays in the list;
	 * it is simply not the default here.
	 */
	const [selectedCredential, setSelectedCredential] = useState(
		(
			modelProviderCredentials.find((cred) => cred.key !== "RADIENT_API_KEY") ??
			modelProviderCredentials[0]
		)?.key || "",
	);
	const [credentialValue, setCredentialValue] = useState("");
	const [error, setError] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Get existing credentials and update mutation
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();
	const { refreshModels } = useModels();

	// Handle credential value change
	const handleCredentialValueChange = (
		event: React.ChangeEvent<HTMLInputElement>,
	) => {
		setCredentialValue(event.target.value);
		if (!event.target.value.trim()) {
			setError("API key is required");
		} else {
			setError("");
		}
		setSaveSuccess(false);
	};

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

	// Save the credential when the input field loses focus (blur event)
	const handleSaveCredential = async () => {
		if (
			selectedCredential &&
			credentialValue.trim() &&
			!credentialsData?.keys.includes(selectedCredential) &&
			!isSaving
		) {
			try {
				setIsSaving(true);
				setSaveSuccess(false);
				await updateCredentialMutation.mutateAsync({
					key: selectedCredential,
					value: credentialValue.trim(),
				});
				setSaveSuccess(true);

				// Refresh models when a credential is successfully saved
				refreshModels();

				// Replace any pending hide, so the message lives 3s from this save
				clearTimeout(successTimeoutRef.current);

				// Set a timeout to hide the success message after 3 seconds
				successTimeoutRef.current = setTimeout(() => {
					setSaveSuccess(false);
				}, 3000);
			} catch (err) {
				console.error("Failed to save credential:", err);
				setSaveSuccess(false);
			} finally {
				setIsSaving(false);
			}
		}
	};

	// Clean up the timeout when the component unmounts
	useEffect(() => {
		return () => clearTimeout(successTimeoutRef.current);
	}, []);

	// Get the selected credential info
	const selectedCredentialInfo = CREDENTIAL_MANIFEST.find(
		(cred) => cred.key === selectedCredential,
	);

	return (
		<div className="flex flex-col gap-6">
			<p className="text-body text-ink-muted">
				Pick a provider and paste its key. Keys are stored on this computer and
				never sent anywhere else.
			</p>

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<Label htmlFor={PROVIDER_SELECT_ID}>Model provider</Label>
					<Select
						value={selectedCredential}
						onValueChange={(value) => {
							setSelectedCredential(value);
							setCredentialValue("");
							setError("");
							setSaveSuccess(false);
						}}
					>
						<SelectTrigger
							id={PROVIDER_SELECT_ID}
							selectSize="lg"
							aria-describedby={
								selectedCredentialInfo ? PROVIDER_HELP_ID : undefined
							}
						>
							<SelectValue placeholder="Select a provider" />
						</SelectTrigger>
						<SelectContent>
							{modelProviderCredentials.map((cred) => (
								<SelectItem key={cred.key} value={cred.key}>
									{cred.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

					{/*
					 * The provider blurb and its sign-up link are help text for the
					 * select above them, so they read as help text. This used to be a
					 * filled, bordered well inside an already bordered dialog.
					 */}
					{selectedCredentialInfo && (
						<div
							id={PROVIDER_HELP_ID}
							className="flex flex-col items-start gap-1"
						>
							<p className="text-ink-dim text-meta">
								{selectedCredentialInfo.description}
							</p>
							<a
								href={selectedCredentialInfo.url}
								target="_blank"
								rel="noopener noreferrer"
								className="inline-flex items-center gap-1 text-accent text-meta underline-offset-4 hover:text-accent-hover hover:underline"
							>
								Get a {selectedCredentialInfo.name} key
								<ExternalLink size={12} aria-hidden="true" />
							</a>
						</div>
					)}
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor={KEY_INPUT_ID}>API key</Label>
					{/* The spinner sits beside the field rather than inside it: an
					    adornment inside a password input competes with the reveal
					    control the platform draws there. */}
					<div className="flex items-center gap-2">
						<Input
							id={KEY_INPUT_ID}
							inputSize="lg"
							type="password"
							value={credentialValue}
							onChange={handleCredentialValueChange}
							onBlur={handleSaveCredential}
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									selectedCredential &&
									credentialValue.trim() &&
									!error &&
									!isSaving
								) {
									handleSaveCredential();
								}
							}}
							placeholder="Paste your API key"
							required
							disabled={isSaving}
							aria-invalid={error ? true : undefined}
							aria-describedby={KEY_HELP_ID}
						/>
						{isSaving && <Spinner size="sm" label="Saving credential" />}
					</div>
					<p
						id={KEY_HELP_ID}
						className={cn("text-meta", error ? "text-danger" : "text-ink-dim")}
					>
						{error || "Saved on your device as soon as you leave the field"}
					</p>
				</div>

				{saveSuccess && <Alert variant="success">Credential saved</Alert>}
			</div>
		</div>
	);
};
