/**
 * Search API Step Component
 *
 * Onboarding's web search step: three answers, in the order the operator set
 * (2026-11-24) - Free (recommended, preselected), a Radient account (higher-
 * volume search plus the account's other benefits, signed in right here), or
 * your own search API keys.
 *
 * The step only appears when Radient is NOT connected (`onboarding-sequence.ts`):
 * a Radient account already is the search backend. If the user connects Radient
 * from the middle option, the step stays (it never disappears from under them)
 * and shows its satisfied state instead.
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

import { ProviderDetail } from "@features/providers/provider-detail";
import {
	CREDENTIAL_MANIFEST,
	CredentialType,
} from "@features/settings/components/credential-manifest";
import type { DesktopProvider } from "@shared/api/local-operator/desktop-api";
import { Spinner } from "@shared/components/common/spinner";
import { Badge, Button, Input, Label } from "@shared/components/ui";
import { useCredentials } from "@shared/hooks/use-credentials";
import { useUpdateCredential } from "@shared/hooks/use-update-credential";
import { t } from "@shared/i18n";
import { cn } from "@shared/lib/utils";
import { CircleCheck, ExternalLink } from "lucide-react";
import type { FC, ReactNode } from "react";
import { useEffect, useState } from "react";
import type { SearchChoice } from "../onboarding-analytics";

/** The providers a key can be added for, in the catalogue's own order. */
const SEARCH_CREDENTIALS = CREDENTIAL_MANIFEST.filter(
	(cred) => cred.type === CredentialType.Search,
);

type SearchCredential = (typeof SEARCH_CREDENTIALS)[number];

/**
 * The three ways this step can set search up. `free` is the default; it writes
 * nothing, because the free rotation IS the runtime's resting state - choosing
 * it is choosing not to add anything. `radient` writes nothing either: the
 * account, once signed in, is the search backend.
 */
type SearchMode = SearchChoice;

const MODE_RADIO_NAME = "onboarding-search-mode";
const FREE_RADIO_ID = "onboarding-search-mode-free";
const RADIENT_RADIO_ID = "onboarding-search-mode-radient";
const KEYS_RADIO_ID = "onboarding-search-mode-keys";
const MODE_GROUP_LABEL_ID = "onboarding-search-mode-label";

const keyInputId = (credentialKey: string) =>
	`onboarding-search-key-${credentialKey.toLowerCase()}`;

/**
 * One selectable mode row: a visually hidden native radio (so arrow keys,
 * space and screen readers behave like the radio group it is) whose mark is
 * drawn by the label. Selection is the mark alone - the old filled row ground
 * read as one more card (design spec § 5.3).
 *
 * THE LABEL DRAWS THE FOCUS RING for the hidden input, which is the one
 * sanctioned use of a wrapper ring in this tree (styles/index.css): an
 * `sr-only` input's own outline is clipped to nothing, so without this a
 * keyboard user would tab into an invisible control.
 *
 * `extra` renders BELOW the label, not inside it: a button inside a `<label>`
 * would toggle the radio on every press of its own.
 */
const ModeOption: FC<{
	id: string;
	title: string;
	recommended?: boolean;
	checked: boolean;
	disabled?: boolean;
	onSelect: () => void;
	detail: ReactNode;
	extra?: ReactNode;
}> = ({
	id,
	title,
	recommended = false,
	checked,
	disabled = false,
	onSelect,
	detail,
	extra,
}) => (
	<div className="flex flex-col gap-3 py-4" data-search-mode={id}>
		<label
			htmlFor={id}
			className={cn(
				"-mx-2 flex items-start gap-3 rounded-sm px-2",
				disabled ? "cursor-default" : "cursor-pointer",
				"has-[:focus-visible]:outline-solid has-[:focus-visible]:outline-2",
				"has-[:focus-visible]:outline-accent has-[:focus-visible]:outline-offset-2",
			)}
		>
			<input
				type="radio"
				id={id}
				name={MODE_RADIO_NAME}
				className="sr-only outline-none"
				checked={checked}
				disabled={disabled}
				onChange={onSelect}
			/>
			{/*
			 * The mark is the Checkbox's roles in a round shape: `border-control` is
			 * the whole control when unchecked, `accent` fills it when chosen, and the
			 * dot is `on-accent` ink - the same triple the contrast contract asserts
			 * for a filled control (`contract-tables.mjs`, the search mode mark).
			 */}
			<span
				aria-hidden="true"
				className={cn(
					"mt-1 grid size-4 shrink-0 place-items-center rounded-full",
					"border border-control bg-surface",
					checked && "border-accent bg-accent",
				)}
			>
				<span
					className={cn("size-2 rounded-full", checked && "bg-on-accent")}
				/>
			</span>
			<span className="flex min-w-0 flex-col gap-1">
				<span
					className={cn(
						"flex flex-wrap items-baseline gap-x-2 text-body",
						// Disabled is a colour step, not opacity (spec § 5.3).
						disabled ? "text-ink-dim" : "text-ink",
						// A selection carries a non-colour mark beside the mark itself
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
							<span className="shrink-0 font-medium text-accent text-meta">
								{t("ui.onboarding.search.recommended")}
							</span>
						</>
					) : null}
				</span>
				<span
					className={cn(
						"text-body-sm",
						disabled ? "text-ink-dim" : "text-ink-muted",
					)}
				>
					{detail}
				</span>
			</span>
		</label>
		{extra ? <div className="pl-7">{extra}</div> : null}
	</div>
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
					: t("ui.onboarding.search.row.save_failed");
			setSaveError(t("ui.onboarding.search.row.not_saved", { message }));
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
						<Spinner
							size="sm"
							label={t("ui.onboarding.search.row.saving", {
								name: credential.name,
							})}
						/>
					) : null}
					{showSaved ? (
						<Badge variant="success">
							{t("ui.onboarding.search.row.saved")}
						</Badge>
					) : null}
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
				placeholder={t("ui.onboarding.search.row.placeholder")}
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
				{t("ui.onboarding.search.row.get_your", { name: credential.name })}
				<ExternalLink size={12} aria-hidden="true" />
			</a>
		</div>
	);
};

type SearchApiStepProps = {
	/**
	 * Whether to print each catalogue description under its key field.
	 *
	 * The onboarding step already introduces web search in its own words, so the
	 * registry blurbs there are the same feature explained twice (design round 1
	 * D11). It stays on for every other caller.
	 */
	showCredentialDescription?: boolean;
	/**
	 * The census's Radient row, when it has one: the middle option signs in
	 * through it. Without it (a backend with no Radient) the step offers the two
	 * options it always had.
	 */
	radient?: DesktopProvider | null;
	/** Whether Radient is connected - the middle option's satisfied state. */
	radientConnected?: boolean;
	/**
	 * The answer the step currently stands for, reported for the wizard's
	 * analytics. A Radient sign-in still in flight counts as `free`: that is what
	 * is actually configured if the user continues now (spec § 5.3, Waiting).
	 */
	onChoiceChange?: (choice: SearchChoice) => void;
	/**
	 * What the step needs before Finish can mean what the radio says (UX round
	 * 1, U2): the Radient option chosen but not signed in reports a sentence and
	 * the footer disables its primary; `null` otherwise. Without it, Finish
	 * silently applied Free under a radio that read Radient.
	 */
	onBlockReason?: (reason: string | null) => void;
};

/**
 * Search API step in the onboarding process
 */
export const SearchApiStep: FC<SearchApiStepProps> = ({
	showCredentialDescription = true,
	radient = null,
	radientConnected = false,
	onChoiceChange,
	onBlockReason,
}) => {
	const [mode, setMode] = useState<SearchMode>(
		radientConnected ? "radient" : "free",
	);
	/** Whether the Radient sign-in panel is open under its row. */
	const [signingIn, setSigningIn] = useState(false);
	const { data: credentialsData } = useCredentials();
	const updateCredentialMutation = useUpdateCredential({
		successToasts: false,
	});
	const storedKeys = credentialsData?.keys ?? [];

	/*
	 * Radient connecting HERE moves the radio to it and closes the panel: the
	 * row's satisfied state is the receipt, and the other two rows step back.
	 */
	useEffect(() => {
		if (!radientConnected) return;
		setMode("radient");
		setSigningIn(false);
	}, [radientConnected]);

	const effective: SearchChoice =
		mode === "radient" && !radientConnected ? "free" : mode;
	useEffect(() => {
		onChoiceChange?.(effective);
	}, [effective, onChoiceChange]);

	const block =
		mode === "radient" && !radientConnected
			? t("ui.onboarding.search.block.radient")
			: null;
	useEffect(() => {
		if (!onBlockReason) return undefined;
		onBlockReason(block);
		return () => onBlockReason(null);
	}, [onBlockReason, block]);

	const saveKey = async (key: string, value: string) => {
		await updateCredentialMutation.mutateAsync({ key, value });
	};

	const notNeeded = radientConnected
		? t("ui.onboarding.search.mode.not_needed")
		: null;

	return (
		<div className="flex flex-col gap-2">
			<span id={MODE_GROUP_LABEL_ID} className="sr-only">
				{t("ui.onboarding.search.mode.label")}
			</span>
			<div
				role="radiogroup"
				aria-labelledby={MODE_GROUP_LABEL_ID}
				className="onboarding-glass flex flex-col divide-y divide-hairline px-5"
			>
				<ModeOption
					id={FREE_RADIO_ID}
					title={t("ui.onboarding.search.mode.free")}
					recommended={!radientConnected}
					checked={mode === "free"}
					disabled={radientConnected}
					onSelect={() => setMode("free")}
					detail={notNeeded ?? t("ui.onboarding.search.mode.free_detail")}
				/>
				{radient ? (
					<ModeOption
						id={RADIENT_RADIO_ID}
						title={
							radientConnected
								? t("ui.onboarding.search.mode.radient_done")
								: t("ui.onboarding.search.mode.radient")
						}
						checked={mode === "radient"}
						onSelect={() => setMode("radient")}
						detail={
							radientConnected
								? t("ui.onboarding.search.mode.radient_done_detail")
								: t("ui.onboarding.search.mode.radient_detail")
						}
						extra={
							radientConnected ? (
								<span className="onboarding-connected inline-flex items-center gap-2 rounded-sm text-accent text-body-sm">
									<CircleCheck
										size={16}
										className="onboarding-check"
										aria-hidden="true"
									/>
									{t("ui.onboarding.signin.connected")}
								</span>
							) : (
								<div className="flex flex-col gap-2">
									<Button
										variant="tonal"
										size="md"
										className="w-fit"
										aria-busy={signingIn || undefined}
										onClick={() => {
											setMode("radient");
											setSigningIn(true);
										}}
									>
										{signingIn ? <Spinner size="sm" /> : null}
										{signingIn
											? t("ui.onboarding.signin.waiting")
											: t("ui.onboarding.search.mode.radient_action")}
									</Button>
									{signingIn ? (
										<div className="rounded-[10px] bg-sunken p-4">
											<ProviderDetail
												provider={radient}
												context="dialog"
												autoStart
												onDone={() => setSigningIn(false)}
												onFlowPhase={(phase) => {
													// Only a CANCEL reaches idle (the panel reports
													// changes, never its mount): the sign-in was
													// abandoned, so the choice falls back to Free rather
													// than leaving a Radient radio that is not true
													// (UX round 1, U2).
													if (phase === "idle") {
														setSigningIn(false);
														setMode("free");
													}
												}}
											/>
										</div>
									) : null}
								</div>
							)
						}
					/>
				) : null}
				<ModeOption
					id={KEYS_RADIO_ID}
					title={t("ui.onboarding.search.mode.keys")}
					checked={mode === "keys"}
					disabled={radientConnected}
					onSelect={() => setMode("keys")}
					detail={notNeeded ?? t("ui.onboarding.search.mode.keys_detail")}
					extra={
						mode === "keys" && !radientConnected ? (
							<div className="flex flex-col gap-5 pb-1">
								<p className="text-ink-dim text-meta">
									{t("ui.onboarding.search.each_key_saved")}
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
						) : null
					}
				/>
			</div>
		</div>
	);
};
