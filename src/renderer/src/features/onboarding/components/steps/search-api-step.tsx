/**
 * Search API Step Component
 *
 * Fourth step in the onboarding process, and an optional one: a search key lets
 * agents read the live web instead of only what the model remembers.
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
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { useEffect, useRef, useState } from "react";

const RECOMMENDED_CREDENTIAL = "TAVILY_API_KEY";

const PROVIDER_SELECT_ID = "onboarding-search-provider";
const PROVIDER_HELP_ID = "onboarding-search-provider-help";
const KEY_INPUT_ID = "onboarding-search-key";
const KEY_HELP_ID = "onboarding-search-key-help";

/**
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC = () => {
	// Get the list of search API credentials and sort Tavily first
	const searchApiCredentials = CREDENTIAL_MANIFEST.filter(
		(cred) => cred.type === CredentialType.Search,
	).sort((a, b) => {
		if (a.key === RECOMMENDED_CREDENTIAL) return -1;
		if (b.key === RECOMMENDED_CREDENTIAL) return 1;
		return 0;
	});

	// State for the selected credential and its value
	const [selectedCredential, setSelectedCredential] = useState(
		searchApiCredentials[0]?.key || "",
	);
	const [credentialValue, setCredentialValue] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	const [saveSuccess, setSaveSuccess] = useState(false);

	// Reference to store the timeout ID for clearing
	const successTimeoutRef = useRef<NodeJS.Timeout | undefined>(undefined);

	// Get existing credentials and update mutation
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential();

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
				With a search key, agents can look things up while they work — today's
				prices, this week's news — instead of relying on what the model already
				knows. Skip it and add one later if you prefer.
			</p>

			<div className="flex flex-col gap-5">
				<div className="flex flex-col gap-2">
					<Label htmlFor={PROVIDER_SELECT_ID}>Search provider</Label>
					<Select
						value={selectedCredential}
						onValueChange={(value) => {
							setSelectedCredential(value);
							setCredentialValue("");
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
							{searchApiCredentials.map((cred) => (
								<SelectItem key={cred.key} value={cred.key}>
									{cred.key === RECOMMENDED_CREDENTIAL
										? `${cred.name} (recommended)`
										: cred.name}
								</SelectItem>
							))}
						</SelectContent>
					</Select>

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
								{/* "Get your {name}": the catalogue names already end in
								    "API key", so this rendered "Get a Tavily API key key". */}
								Get your {selectedCredentialInfo.name}
								<ExternalLink size={12} aria-hidden="true" />
							</a>
						</div>
					)}
				</div>

				<div className="flex flex-col gap-2">
					<Label htmlFor={KEY_INPUT_ID}>API key (optional)</Label>
					<div className="flex items-center gap-2">
						<Input
							id={KEY_INPUT_ID}
							inputSize="lg"
							type="password"
							value={credentialValue}
							onChange={(event) => {
								setCredentialValue(event.target.value);
								setSaveSuccess(false);
							}}
							onBlur={handleSaveCredential}
							onKeyDown={(e) => {
								if (
									e.key === "Enter" &&
									selectedCredential &&
									credentialValue.trim() &&
									!isSaving
								) {
									handleSaveCredential();
								}
							}}
							placeholder="Paste your API key"
							disabled={isSaving}
							aria-describedby={KEY_HELP_ID}
						/>
						{isSaving && <Spinner size="sm" label="Saving credential" />}
					</div>
					<p id={KEY_HELP_ID} className="text-ink-dim text-meta">
						Saved on your device as soon as you leave the field
					</p>
				</div>

				{saveSuccess && <Alert variant="success">Search key saved</Alert>}
			</div>
		</div>
	);
};
