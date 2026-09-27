/**
 * Search API Step Component
 *
 * The web-search half of onboarding's Extras step, reduced to one question:
 * let the built-in free rotation do the work, or bring your own keys.
 *
 * WHY "FREE" IS THE DEFAULT AND THE RECOMMENDATION. Search already works out of
 * the box: the runtime rotates free providers when no key is stored
 * (duckduckgo, Tavily's keyless tier, Exa and Parallel, under shared rate
 * limits). The step used to present only a single-key form with Tavily
 * labelled "(recommended)", which read as a key requirement rather than as the
 * opt-in upgrade it is. Free is now a visible, preselected choice, and adding
 * keys is the second branch.
 *
 * The free pool is described accurately and never oversold: Perplexity is
 * deliberately absent from the free copy (its endpoint is best-effort and
 * sometimes walled) and appears only in the key list, where the manifest's own
 * description says so.
 *
 * Keys are saved one per provider, on blur, through the same mutation the
 * settings credential surface uses; a stored key shows as a Saved badge rather
 * than as a sentence, because six rows each saying "saved" is a wall of text
 * that answers nothing.
 */

import {
	CREDENTIAL_MANIFEST,
	CredentialType,
} from "@features/settings/components/credential-manifest";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, Input, Label } from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { cn } from "@shared/lib/utils";
import { ExternalLink } from "lucide-react";
import type { FC } from "react";
import { useState } from "react";

/** The providers a key can be added for, in the catalogue's own order. */
const SEARCH_CREDENTIALS = CREDENTIAL_MANIFEST.filter(
	(cred) => cred.type === CredentialType.Search,
);

type SearchCredential = (typeof SEARCH_CREDENTIALS)[number];

/**
 * The two ways this step can set search up. `free` is the default; it writes
 * nothing, because the free rotation IS the runtime's resting state - choosing
 * it is choosing not to add anything.
 */
type SearchMode = "free" | "keys";

const MODE_RADIO_NAME = "onboarding-search-mode";
const FREE_RADIO_ID = "onboarding-search-mode-free";
const KEYS_RADIO_ID = "onboarding-search-mode-keys";
const MODE_GROUP_LABEL_ID = "onboarding-search-mode-label";

const keyInputId = (credentialKey: string) =>
	`onboarding-search-key-${credentialKey.toLowerCase()}`;

/**
 * One selectable mode row: a visually hidden native radio (so arrow keys,
 * space and screen readers behave like the radio group it is) whose mark and
 * row ground are drawn by the label.
 *
 * THE ROW DRAWS THE FOCUS RING for the hidden input, which is the one
 * sanctioned use of a wrapper ring in this tree (styles/index.css): an
 * `sr-only` input's own outline is clipped to nothing, so without this a
 * keyboard user would tab into an invisible control.
 */
const ModeOption: FC<{
	id: string;
	title: string;
	recommended?: boolean;
	checked: boolean;
	onSelect: () => void;
	children: string;
}> = ({ id, title, recommended = false, checked, onSelect, children }) => (
	<label
		htmlFor={id}
		className={cn(
			"flex cursor-pointer items-start gap-3 rounded-sm p-3",
			"transition-colors duration-fast ease-out-quart",
			"hover:bg-sunken",
			"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
			"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
			checked && "bg-sunken",
		)}
	>
		<input
			type="radio"
			id={id}
			name={MODE_RADIO_NAME}
			className="sr-only outline-none"
			checked={checked}
			onChange={onSelect}
		/>
		{/*
		 * The mark is the Checkbox's roles in a round shape: `border-control` is
		 * the whole control when unchecked, `accent` fills it when chosen, and the
		 * dot is `on-accent` ink - the same triple the contrast contract asserts
		 * for a filled control.
		 */}
		<span
			aria-hidden="true"
			className={cn(
				"mt-1 grid size-4 shrink-0 place-items-center rounded-full",
				"border border-control bg-surface",
				checked && "border-accent bg-accent",
			)}
		>
			<span className={cn("size-2 rounded-full", checked && "bg-on-accent")} />
		</span>
		<span className="flex min-w-0 flex-col gap-1">
			<span
				className={cn(
					"flex flex-wrap items-baseline gap-x-2 text-body text-ink",
					// A selection carries a non-colour mark beside the ground step
					// (branding § 3): the chosen row is weighted, not just tinted.
					checked && "font-medium",
				)}
			>
				{title}
				{recommended ? (
					<>
						{/* The separator keeps the line from reading as one string
						    ("Free Recommended"); same idiom as the provider grid's cue. */}
						<span
							aria-hidden="true"
							className="shrink-0 text-ink-dim text-meta"
						>
							·
						</span>
						<span className="shrink-0 font-medium text-ink text-meta">
							Recommended
						</span>
					</>
				) : null}
			</span>
			<span className="text-body-sm text-ink-muted">{children}</span>
		</span>
	</label>
);

/**
 * One provider's key field: saves on blur, shows a Saved badge once stored,
 * and keeps the input's own value so a stored key can be replaced the same way
 * it was added.
 */
const SearchKeyRow: FC<{
	credential: SearchCredential;
	showDescription: boolean;
	isStored: boolean;
	save: (key: string, value: string) => Promise<void>;
}> = ({ credential, showDescription, isStored, save }) => {
	const [value, setValue] = useState("");
	const [isSaving, setIsSaving] = useState(false);
	/*
	 * The credentials read is refetched after a successful save, and this flag
	 * keeps the badge on screen during that gap rather than letting it blink off
	 * and back on. It is also this row's receipt for the save, which is why it
	 * is state rather than a derived value.
	 */
	const [savedLocally, setSavedLocally] = useState(false);
	/*
	 * What this row last SENT successfully, so a blur that changes nothing does
	 * not write again (review round 1, R1). The old single-key form suppressed
	 * re-saves only by accident of its stored-keys check, and the replace flow
	 * deliberately keeps the input populated, so without this the same bytes are
	 * written on every focus/blur. It starts null rather than the stored key's
	 * value because the stored VALUE is not readable from here - only that a key
	 * exists - and a first save of the same bytes as an invisible stored value
	 * is still a write the user made.
	 */
	const [lastSaved, setLastSaved] = useState<string | null>(null);
	/*
	 * The row's own refusal register. With several rows on this step, the
	 * shared toast (suppressed here) is one message for five fields, and a
	 * repeat failure collapses into one toast - so the row states it instead
	 * (UX round 1, U2), the way the providers panel states a rejected key.
	 */
	const [saveError, setSaveError] = useState<string | null>(null);
	const inputId = keyInputId(credential.key);
	const showSaved = isStored || savedLocally;

	const handleSave = async () => {
		const trimmed = value.trim();
		if (!trimmed || isSaving || trimmed === lastSaved) return;
		try {
			setIsSaving(true);
			setSaveError(null);
			await save(credential.key, trimmed);
			setLastSaved(trimmed);
			setSavedLocally(true);
		} catch (error) {
			/*
			 * "Not saved" rather than "invalid": the row cannot tell a refusal from
			 * an unreachable backend, and both leave the value in place for the next
			 * blur to retry.
			 */
			const message =
				error instanceof Error && error.message
					? error.message
					: "The key could not be saved.";
			setSaveError(`Not saved — ${message}`);
		} finally {
			setIsSaving(false);
		}
	};

	return (
		<div className="flex flex-col gap-2" data-search-key={credential.key}>
			<div className="flex items-center justify-between gap-2">
				<Label htmlFor={inputId}>{credential.name}</Label>
				<span className="flex items-center gap-2">
					{isSaving ? (
						<Spinner size="sm" label={`Saving ${credential.name}`} />
					) : null}
					{showSaved ? <Badge variant="success">Saved</Badge> : null}
				</span>
			</div>
			<Input
				id={inputId}
				inputSize="lg"
				type="password"
				value={value}
				onChange={(event) => {
					setValue(event.target.value);
					setSavedLocally(false);
					setSaveError(null);
				}}
				onBlur={handleSave}
				onKeyDown={(event) => {
					if (event.key === "Enter" && value.trim() && !isSaving) {
						void handleSave();
					}
				}}
				placeholder="Paste your API key"
				disabled={isSaving}
			/>
			{saveError ? (
				<p className="text-danger text-meta" role="alert">
					{saveError}
				</p>
			) : showDescription ? (
				<p className="text-ink-dim text-meta">{credential.description}</p>
			) : null}
			<a
				href={credential.url}
				target="_blank"
				rel="noopener noreferrer"
				className="inline-flex w-fit items-center gap-1 text-accent text-meta underline-offset-4 hover:text-accent-hover hover:underline"
			>
				{/* The catalogue names already end in "API key", so this reads
				    "Get your Tavily API key" rather than "… API key key". */}
				Get your {credential.name}
				<ExternalLink size={12} aria-hidden="true" />
			</a>
		</div>
	);
};

type SearchApiStepProps = {
	/**
	 * Whether to print each catalogue description under its key field.
	 *
	 * The onboarding extras step already introduces web search in its own words,
	 * so the registry blurbs there are the same feature explained twice (design
	 * round 1 D11). It stays on for every other caller.
	 */
	showCredentialDescription?: boolean;
};

/**
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC<SearchApiStepProps> = ({
	showCredentialDescription = true,
}) => {
	const [mode, setMode] = useState<SearchMode>("free");
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential({ announce: false });
	const storedKeys = credentialsData?.keys ?? [];

	const saveKey = async (key: string, value: string) => {
		await updateCredentialMutation.mutateAsync({ key, value });
	};

	return (
		<div className="flex flex-col gap-5">
			<p className="text-body text-ink-muted">
				Agents can look things up while they work — today's prices, this week's
				news — instead of relying on what the model already knows.
			</p>

			<div className="flex flex-col gap-2">
				<span id={MODE_GROUP_LABEL_ID} className="sr-only">
					Search setup
				</span>
				<div
					role="radiogroup"
					aria-labelledby={MODE_GROUP_LABEL_ID}
					className="flex flex-col gap-2"
				>
					<ModeOption
						id={FREE_RADIO_ID}
						title="Free"
						recommended
						checked={mode === "free"}
						onSelect={() => setMode("free")}
					>
						Uses a rotating pool of free providers — DuckDuckGo, Tavily's free
						tier, Exa and Parallel. No key needed; the pool is shared, so
						searches can be slower at busy times.
					</ModeOption>
					<ModeOption
						id={KEYS_RADIO_ID}
						title="Add API keys"
						checked={mode === "keys"}
						onSelect={() => setMode("keys")}
					>
						Bring your own keys for the search providers you use.
					</ModeOption>
				</div>
			</div>

			{mode === "keys" ? (
				/*
				 * `pl-10` (40px) lands the block on the option rows' TEXT column: a
				 * row's lead-in is the mark's own box (p-3 12 + size-4 16 + gap-3 12 =
				 * 40), so the keys block reads as "under the copy above" rather than
				 * under the mark. The one-step `pl-7` used elsewhere in this repo sits
				 * under a 28px mark and lands a gap-unit short of the text here
				 * (design round 1, D1).
				 */
				<div className="flex flex-col gap-5 pl-10">
					<p className="text-ink-dim text-meta">
						Each key is saved on your device as soon as you leave its field.
					</p>
					{SEARCH_CREDENTIALS.map((credential) => (
						<SearchKeyRow
							key={credential.key}
							credential={credential}
							showDescription={showCredentialDescription}
							isStored={storedKeys.includes(credential.key)}
							save={saveKey}
						/>
					))}
				</div>
			) : null}
		</div>
	);
};
