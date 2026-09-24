/**
 * Provider detail panel: how one provider is connected, in every state a
 * sign-in passes through (design audit § 3).
 *
 * Sign-in flows run as backend auth operations: the backend owns PKCE, state
 * and callback ports, and this panel renders the state `sign-in-flow.ts` emits.
 * The flow module owns the rules that used to be buried here and got one wrong
 * -- the browser opening only on a second click (design D1, UX U1) -- so this
 * file is presentation: which sentence, which button, which fallback.
 *
 * Three rules the layout keeps:
 *
 * - One primary action per state. The method tabs never repeat the provider
 *   name, so a tab and the button beneath it can never share an accessible name
 *   (design D4).
 * - A paste box is a FALLBACK unless the flow is the paste. A flow the backend
 *   marks `input_optional` (Anthropic's redirect, which completes on its own)
 *   leads with "Finish signing in in your browser" and keeps the paste behind a
 *   disclosure; only a flow that needs the paste shows the field open (D2).
 * - A device code is display content to copy, shown as the code alone, never
 *   the sentence around it (UX U4).
 *
 * Keys are saved only by an explicit "Save key"; blur never persists a
 * credential. A rejected key is the backend's 422 sentence, inline under the
 * field, and nothing was stored (UX U3).
 */

import { pollAuthOperation } from "@shared/api/local-operator/auth-operation";
import {
	DesktopControlError,
	desktopResult,
	openAuthorization,
} from "@shared/api/local-operator/desktop-api";
import type {
	AuthOperation,
	DesktopProvider,
	ProviderMethod,
} from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import {
	Alert,
	AlertDescription,
	AlertTitle,
	Button,
	Input,
	Label,
	Tabs,
	TabsList,
	TabsTrigger,
} from "@shared/components/ui";
import { Disclosure } from "@shared/components/ui/disclosure";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import {
	Check,
	CircleCheck,
	Copy,
	ExternalLink,
	Eye,
	EyeOff,
	RotateCcw,
} from "lucide-react";
import type { FC, ReactNode } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import type {
	DefaultsApplied,
	SaveKeyResult,
} from "../../../../shared/desktop-contract";
import {
	brandOf,
	deviceCodeOf,
	hostOf,
	methodBlurb,
	methodName,
	minutesLeft,
	unfinishedMessage,
} from "./provider-catalog";
import { primaryMethod } from "./provider-labels";
import { useSignInSession } from "./sign-in-sessions";

/**
 * Reachability for a local provider.
 *
 * The probe runs when the panel OPENS (design D11): opening a panel is already
 * an explicit user action, and "Not tested yet" was a state that asked the
 * user to press a button whose result the app could have fetched itself. The
 * "no probe on render" rule is about the provider LIST, which still never
 * probes.
 */
const LocalProviderReachability: FC<{ provider: DesktopProvider }> = ({
	provider,
}) => {
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<{
		reachable: boolean;
		detail: string;
	} | null>(null);

	const test = useCallback(async () => {
		setTesting(true);
		try {
			setResult(
				await desktopResult<{ reachable: boolean; detail: string }>({
					op: "auth.probe",
					provider: provider.id,
				}),
			);
		} catch (error) {
			setResult({
				reachable: false,
				detail:
					error instanceof Error
						? error.message
						: "The connection could not be tested.",
			});
		} finally {
			setTesting(false);
		}
	}, [provider.id]);

	// A different provider row reuses this component, so the verdict is reset
	// and re-asked per provider rather than left beside the new name.
	useEffect(() => {
		setResult(null);
		void test();
	}, [test]);

	const brand = brandOf(provider);
	return (
		<div className="flex flex-col items-start gap-2">
			{result === null ? (
				<p className="flex items-center gap-2 text-body-sm text-ink-muted">
					<Spinner size="sm" />
					Checking whether {brand} is running
				</p>
			) : result.reachable ? (
				<p className="text-body-sm text-success">{brand} is running</p>
			) : (
				<p className="text-body-sm text-ink-muted">
					{brand} isn't answering
					{provider.base_url ? (
						<>
							{" at "}
							<span className="font-mono">{provider.base_url}</span>
						</>
					) : null}
				</p>
			)}
			{/*
			 * The reason only when it says something the line above does not: the
			 * backend's own failure sentence repeats the address it could not reach,
			 * which printed the same address twice in two faces (design round 1 D9).
			 */}
			{result &&
			!result.reachable &&
			!(provider.base_url && result.detail.includes(provider.base_url)) ? (
				<p className="text-ink-dim text-meta">{result.detail}</p>
			) : null}
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void test()}
				disabled={testing}
			>
				{testing ? "Checking" : "Check again"}
			</Button>
		</div>
	);
};

/**
 * Where the panel is shown, which decides only the success action's words: in
 * Settings the flow ends with "Done"; in onboarding and the connect dialog the
 * next step is the point, so it reads "Continue".
 */
export type ProviderDetailContext = "settings" | "dialog";

type ProviderDetailProps = {
	provider: DesktopProvider;
	/** Called once an auth method has stored a credential. */
	onConnected?: () => void;
	/**
	 * Called when the user presses the success state's action. Settings uses it
	 * to collapse the panel; the dialogs to move on.
	 */
	onDone?: () => void;
	/** Opens the model picker from the receipt's "Change". */
	onChangeModel?: () => void;
	context?: ProviderDetailContext;
};

const SecretInput: FC<{
	id: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
	invalid?: boolean;
	describedBy?: string;
}> = ({ id, value, onChange, label, invalid, describedBy }) => {
	const [visible, setVisible] = useState(false);
	return (
		<div className="relative">
			<Input
				id={id}
				type={visible ? "text" : "password"}
				value={value}
				onChange={(event) => onChange(event.target.value)}
				autoComplete="off"
				spellCheck={false}
				aria-label={label}
				aria-invalid={invalid || undefined}
				aria-describedby={describedBy}
				className="pr-10 font-mono"
			/>
			<Button
				type="button"
				variant="ghost"
				size="icon-sm"
				className="absolute top-1/2 right-1 -translate-y-1/2"
				onClick={() => setVisible((current) => !current)}
				aria-label={visible ? "Hide key" : "Show key"}
			>
				{visible ? <EyeOff aria-hidden="true" /> : <Eye aria-hidden="true" />}
			</Button>
		</div>
	);
};

/** A copy button that says "Copied" for two seconds, then goes back. */
const CopyButton: FC<{
	value: string;
	label: string;
	variant?: "ghost" | "secondary" | "primary";
	onCopied?: () => void;
}> = ({ value, label, variant = "ghost", onCopied }) => {
	const [copied, setCopied] = useState(false);
	useEffect(() => {
		if (!copied) return undefined;
		const timer = setTimeout(() => setCopied(false), 2000);
		return () => clearTimeout(timer);
	}, [copied]);
	return (
		<Button
			variant={variant}
			size="sm"
			onClick={async () => {
				try {
					await navigator.clipboard.writeText(value);
					setCopied(true);
					onCopied?.();
				} catch {
					showErrorToast("Could not copy. Select and copy it manually.");
				}
			}}
		>
			{copied ? <Check aria-hidden="true" /> : <Copy aria-hidden="true" />}
			{copied ? "Copied" : label}
		</Button>
	);
};

/**
 * The success receipt: the backend's own sentence, never re-derived here,
 * because the backend is what decided and wrote the default (`DefaultsApplied`).
 * An older backend sends no receipt; the panel then says only that the sign-in
 * worked, rather than implying a default it cannot see.
 */
const SignedIn: FC<{
	brand: string;
	verb: "Signed in to" | "Connected";
	defaults: DefaultsApplied | null | undefined;
	unverified?: string | null;
	onChangeModel?: () => void;
	actionLabel: string;
	onAction: () => void;
	primaryAction: boolean;
	/** Overrides the headline, for the states that are not a plain success. */
	headline?: string;
	/**
	 * `unchecked` is a save whose key the backend did not verify. The success
	 * colour and the word "connected" are spent only on a verified success
	 * (branding contract, design round 1 D4), so this tone moves the check to
	 * `text-ink-muted` and promotes the caveat from the dimmest line on the panel
	 * to a body-sized muted one.
	 */
	tone?: "success" | "unchecked";
}> = ({
	brand,
	verb,
	defaults,
	unverified,
	onChangeModel,
	actionLabel,
	onAction,
	primaryAction,
	headline,
	tone = "success",
}) => (
	<div className="flex flex-col gap-3" data-sign-in-state="succeeded">
		<div className="flex items-center gap-2">
			<CircleCheck
				size={20}
				className={tone === "unchecked" ? "text-ink-muted" : "text-success"}
				aria-hidden="true"
			/>
			<output className="text-heading text-ink">
				{headline ??
					(verb === "Connected" ? `${brand} connected` : `Signed in to ${brand}`)}
			</output>
		</div>
		{defaults?.receipt ? (
			<p className="text-body-sm text-ink-muted">
				{defaults.receipt}
				{onChangeModel ? (
					<>
						{" "}
						<Button variant="link" size="sm" onClick={onChangeModel}>
							Change
						</Button>
					</>
				) : null}
			</p>
		) : null}
		{/*
		 * A receipt with no hosting is a change that did NOT happen: on an older
		 * backend the sign-in writes a credential and leaves the default alone, so
		 * saying so is the difference between "nothing happened" and "your model
		 * is unchanged" (code round 1, m5).
		 */}
		{defaults && !defaults.hosting && defaults.receipt ? (
			<p className="text-body-sm text-ink-muted">
				Your default model is unchanged.
			</p>
		) : null}
		{unverified ? (
			<p
				className={
					tone === "unchecked"
						? "text-body-sm text-ink-muted"
						: "text-ink-dim text-meta"
				}
			>
				Saved, but not checked yet: {unverified}
			</p>
		) : null}
		<div>
			<Button
				variant={primaryAction ? "primary" : "secondary"}
				size="sm"
				onClick={onAction}
			>
				{actionLabel}
			</Button>
		</div>
	</div>
);

export const ProviderDetail: FC<ProviderDetailProps> = ({
	provider,
	onConnected,
	onDone,
	onChangeModel,
	context = "settings",
}) => {
	const queryClient = useQueryClient();
	const [methodId, setMethodId] = useState<string | null>(null);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [keyError, setKeyError] = useState<string | null>(null);
	const [keySaved, setKeySaved] = useState<SaveKeyResult | null>(null);
	const [promptValue, setPromptValue] = useState("");
	const [promptError, setPromptError] = useState<string | null>(null);
	const brand = brandOf(provider);

	// Resolved by METHOD identity, not provider id: a provider can offer several
	// methods that all act on the same provider (D2 of the earlier round).
	const method: ProviderMethod | null =
		provider.auth_methods.find(
			(candidate) => candidate.method_id === methodId,
		) ?? primaryMethod(provider.auth_methods);

	const refreshProviders = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
		/*
		 * The CATALOGUE is dropped at the same moment, and that is the point of this
		 * line rather than a tidy-up: the models a provider offers are a function of
		 * the credential, so a listing fetched before a sign-in is exactly the one
		 * that cannot hold whatever the account just unlocked — the operator's report
		 * is a model released since lop's last build being absent from the picker
		 * after a successful sign-in.
		 *
		 * The backend already drops its cached listing documents when a credential
		 * changes (`providers/controller._invalidate_cached_listing`), so nothing has
		 * to be re-listed here; what is missing without this line is the RENDERER
		 * forgetting its own copy. `desktopKeys.catalogue` is the prefix both of the
		 * picker's keys sit under, so one call drops the registry document and the
		 * live one together — the next open re-reads both.
		 *
		 * This runs on every credential write this panel performs (the polling loop's
		 * success and the API-key save), which is deliberate: each of them is the
		 * same event as far as the catalogue is concerned.
		 */
		void queryClient.invalidateQueries({ queryKey: desktopKeys.catalogue });

		/*
		 * AND THE CONFIG, which this branch adds to the same handler: a sign-in can
		 * write the default model, and the composer, the model settings and the
		 * empty-chat card all read it from there. The two invalidations answer two
		 * different questions about one event -- what this account can offer, and
		 * what the app now uses -- so neither replaces the other.
		 */
		// A sign-in can write the default model, which the composer, the model
		// settings and the empty-chat card all read from the config.
		void queryClient.invalidateQueries({ queryKey: ["config"] });
		onConnected?.();
	}, [queryClient, onConnected]);

	const onConnectedRef = useRef(refreshProviders);
	onConnectedRef.current = refreshProviders;

	/*
	 * The flow lives in a per-provider session rather than in this component
	 * (sign-in-sessions.ts): the row this panel is rendered on MOVES into
	 * "Connected" the moment a credential lands, which remounts this panel -- and
	 * a flow owned by the panel went back to idle with it, so a user who had just
	 * signed in was invited to do it again and never saw the receipt (QA round 1
	 * Q1, UX U3). Attaching instead also resumes an operation that is still
	 * running when the panel comes back (UX U4).
	 */
	const { flow: flowHandle, state: flow } = useSignInSession(provider.id, () => ({
		start: (id: string) =>
			desktopResult<AuthOperation>({ op: "auth.start", provider: id }),
		read: (id: string) =>
			desktopResult<AuthOperation>({ op: "auth.status", id }),
		cancel: (id: string) => desktopResult({ op: "auth.cancel", id }),
		// Main opens the operation's CURRENT url and never takes one from the
		// renderer, so a compromised render path cannot turn this into a general
		// link opener; it also dedups the same operation and url.
		open: (id: string, reopen: boolean) => openAuthorization(id, reopen),
		poll: pollAuthOperation,
		onSucceeded: () => onConnectedRef.current(),
	}));

	// A panel reused for another provider starts clean.
	// biome-ignore lint/correctness/useExhaustiveDependencies: provider.id is the reset trigger
	useEffect(() => {
		flowHandle.reset();
		setMethodId(null);
		setKeyValue("");
		setKeyError(null);
		setKeySaved(null);
	}, [provider.id]);

	const chooseMethod = (next: string) => {
		setMethodId(next);
		setKeyError(null);
		setKeySaved(null);
		flowHandle.reset();
	};

	const submitPrompt = useCallback(async () => {
		const operation = flow.operation;
		if (!operation?.prompt_id || !promptValue) return;
		setPromptError(null);
		try {
			await desktopResult({
				op: "auth.input",
				id: operation.id,
				promptId: operation.prompt_id,
				value: promptValue,
			});
			// Ephemeral by contract: the pasted code clears here and never enters
			// state that could land in a transcript, log or persisted store.
			setPromptValue("");
		} catch (error) {
			setPromptError(
				error instanceof Error ? error.message : "The code was not accepted.",
			);
		}
	}, [flow.operation, promptValue]);

	const saveKey = useCallback(async () => {
		if (!method || !keyValue.trim()) return;
		setKeySaving(true);
		setKeyError(null);
		try {
			const result =
				(await desktopResult<SaveKeyResult | null>({
					op: "auth.key",
					provider: method.id,
					value: keyValue.trim(),
				})) ?? {};
			setKeyValue("");
			setKeySaved(result);
			refreshProviders();
		} catch (error) {
			// A 422 is the backend refusing THIS key (validation, or a provider
			// with no key route), and its sentence belongs under the field.
			// Anything else is also shown there: the field is what the user
			// acts on next either way.
			setKeyError(
				error instanceof DesktopControlError || error instanceof Error
					? error.message
					: "The key could not be saved.",
			);
		} finally {
			setKeySaving(false);
		}
	}, [method, keyValue, refreshProviders]);

	const doneLabel = context === "dialog" ? "Continue" : "Done";
	const finish = () => {
		setKeySaved(null);
		flowHandle.reset();
		onDone?.();
	};

	if (provider.local) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-body-sm text-ink-muted">
					Runs on this computer and needs no account or key. Start {brand}, then
					check the connection.
				</p>
				<LocalProviderReachability provider={provider} />
			</div>
		);
	}

	if (!method) {
		return (
			<Alert variant="warning">
				This provider has no supported sign-in method on this server.
			</Alert>
		);
	}

	const apiKeyMethod = provider.auth_methods.find(
		(candidate) => candidate.kind === "api_key",
	);
	const operation = flow.operation;
	const keyHelpId = `key-help-${provider.id}`;

	/*
	 * Hidden once the flow is settled. A finished sign-in with "Claude
	 * subscription | API key" still above it invites a method switch on a result
	 * the user is done with, and in the unfinished states the tabs duplicate the
	 * "Use an API key instead" action right below them (design round 1, D4).
	 */
	const methodTabs =
		provider.auth_methods.length > 1 && flow.phase !== "settled" ? (
			<Tabs value={method.method_id} onValueChange={chooseMethod}>
				<TabsList aria-label="How to connect">
					{provider.auth_methods.map((candidate) => (
						<TabsTrigger key={candidate.method_id} value={candidate.method_id}>
							{methodName(candidate)}
						</TabsTrigger>
					))}
				</TabsList>
			</Tabs>
		) : null;

	/* ------------------------------------------------------------ API key */
	if (method.kind === "api_key") {
		if (keySaved) {
			return (
				<div className="flex flex-col gap-4">
					{methodTabs}
					<SignedIn
						brand={brand}
						verb="Connected"
						defaults={keySaved.defaults_applied}
						/*
						 * `valid: true` is the only verified answer. `null` is the backend
						 * saying it could not check, and ABSENT is a released backend that
						 * checks nothing at all and answers `{}` -- treating that as success
						 * printed "Radient connected" for a fabricated key (code round 1
						 * Q6, UX U1).
						 */
						unverified={
							keySaved.valid === true
								? null
								: (keySaved.reason ??
									"this Local Operator does not check keys, so it will be tested on your first message.")
						}
						tone={keySaved.valid === true ? "success" : "unchecked"}
						headline={
							keySaved.valid === true ? undefined : `${brand} key saved`
						}
						onChangeModel={onChangeModel}
						actionLabel={doneLabel}
						onAction={finish}
						primaryAction={context === "dialog"}
					/>
				</div>
			);
		}
		return (
			<div className="flex flex-col gap-4">
				{methodTabs}
				<div className="flex flex-col gap-2" data-sign-in-state="api-key">
					<Label htmlFor={`key-${provider.id}`}>API key</Label>
					<SecretInput
						id={`key-${provider.id}`}
						value={keyValue}
						onChange={(next) => {
							setKeyValue(next);
							setKeyError(null);
						}}
						label={`${brand} API key`}
						invalid={keyError !== null}
						describedBy={keyHelpId}
					/>
					<p
						id={keyHelpId}
						className={
							keyError ? "text-danger text-meta" : "text-ink-dim text-meta"
						}
						role={keyError ? "alert" : undefined}
					>
						{keyError ??
							(provider.has_credential
								? "A key is saved. Paste a new one to replace it. Stored encrypted on this computer."
								: "Stored encrypted on this computer.")}
					</p>
					<div>
						<Button
							variant="primary"
							size="sm"
							disabled={!keyValue.trim() || keySaving}
							onClick={() => void saveKey()}
						>
							{keySaving ? <Spinner size="sm" /> : null}
							{keySaving ? "Checking key" : "Save key"}
						</Button>
					</div>
				</div>
			</div>
		);
	}

	/* ----------------------------------------------- browser / device flows */
	const start = () => void flowHandle.start(method.id);
	/*
	 * `auth_url` ONLY. `launch_url` is the loopback `/launch` alias the backend
	 * reports for EVERY callback flow (measured on #1507: `localhost:54549`), so
	 * preferring it named a port as the provider in the waiting sentence and in
	 * the paste label (code round 1 M1, UX N2).
	 */
	const host = hostOf(operation?.auth_url);
	const deviceCode = operation ? deviceCodeOf(operation) : null;
	const minutes = operation ? minutesLeft(operation.expires_in) : null;
	/*
	 * Is the paste box the flow itself, or a fallback? A newer backend says so
	 * (`input_optional`); on an older one a method whose registry entry offers a
	 * paste FALLBACK (`paste_fallback`, Anthropic) is optional, and one that
	 * requires the paste is not.
	 */
	const pasteIsFallback =
		operation?.input_optional ??
		(method.paste_fallback && !method.requires_secret_input);

	let body: ReactNode;
	if (flow.phase === "idle") {
		body = (
			<div
				className="flex flex-col items-start gap-3"
				data-sign-in-state="idle"
			>
				<p className="text-body-sm text-ink-muted">
					{methodBlurb(method, provider)}{" "}
					{method.kind === "device"
						? "You'll get a code to enter on the provider's page."
						: "It opens in your browser."}
				</p>
				<Button variant="primary" size="sm" onClick={start}>
					{method.kind === "device"
						? "Get a sign-in code"
						: "Continue in browser"}
					{method.kind === "device" ? null : (
						<ExternalLink aria-hidden="true" />
					)}
				</Button>
			</div>
		);
	} else if (
		flow.phase === "starting" ||
		(flow.phase === "active" &&
			operation &&
			!operation.auth_url &&
			!deviceCode &&
			/*
			 * A flow that NEEDS a paste can ask for it before it has any URL at
			 * all: QwenCloud's Token Plan wants the key first. Without this
			 * clause the panel sat on "Getting a code" with no field to type in
			 * and no way to finish the sign-in (QA round 1 Q2).
			 */
			!(operation.input_required && !pasteIsFallback))
	) {
		body = (
			<div className="flex items-center gap-3" data-sign-in-state="starting">
				<Spinner size="sm" />
				<output className="text-body-sm text-ink-muted">
					{method.kind === "device" ? "Getting a code" : "Opening your browser"}
				</output>
				<Button
					variant="ghost"
					size="sm"
					onClick={() => void flowHandle.cancel()}
				>
					Cancel
				</Button>
			</div>
		);
	} else if (flow.phase === "active" && operation && deviceCode) {
		const page = operation.auth_url;
		body = (
			<div
				className="flex flex-col items-start gap-3"
				data-sign-in-state="device-code"
			>
				<p className="text-body-sm text-ink-muted">
					Enter this code {host ? `at ${host}` : "on the sign-in page"}. This
					page updates on its own once you approve.
				</p>
				<div className="flex items-center gap-3 rounded-md bg-sunken p-3">
					<code className="font-mono text-ink text-title tracking-wider">
						{deviceCode}
					</code>
				</div>
				<div className="flex flex-wrap items-center gap-2">
					<CopyButton
						value={deviceCode}
						label={page ? "Copy code and open page" : "Copy code"}
						variant="primary"
						onCopied={() => {
							if (page) void flowHandle.reopen();
						}}
					/>
					<Button
						variant="ghost"
						size="sm"
						onClick={() => void flowHandle.cancel()}
					>
						Cancel
					</Button>
				</div>
				{minutes ? (
					<p className="text-ink-dim text-meta">
						Code expires in {minutes} min
					</p>
				) : null}
			</div>
		);
	} else if (flow.phase === "active" && operation) {
		/*
	 * Built once, placed by whichever state owns it: the paste-required panel
	 * makes its Continue the PRIMARY action (the field is the only way forward
	 * there, design round 1 D10) while the waiting panel's disclosure keeps it
	 * secondary, because the browser is still the flow in that state.
	 */
	const pasteField = (primary: boolean) =>
		operation.input_required ? (
			<div className="flex flex-col gap-2">
				<Label htmlFor={`prompt-${operation.id}`}>
					{host ? `Code from ${host}` : "Code from the sign-in page"}
				</Label>
				<div className="flex items-start gap-2">
					<div className="flex-1">
						<SecretInput
							id={`prompt-${operation.id}`}
							value={promptValue}
							onChange={(next) => {
								setPromptValue(next);
								setPromptError(null);
							}}
							label="Sign-in code"
							invalid={promptError !== null}
						/>
					</div>
					<Button
						variant={primary ? "primary" : "secondary"}
						size="md"
						disabled={!promptValue}
						onClick={() => void submitPrompt()}
					>
						Continue
					</Button>
				</div>
				{promptError ? (
					<p className="text-danger text-meta" role="alert">
						{promptError}
					</p>
				) : null}
			</div>
		) : null;

		if (operation.input_required && !pasteIsFallback) {
			// The paste IS the flow: the field is the headline, open.
			body = (
				<div
					className="flex flex-col items-start gap-3"
					data-sign-in-state="paste-required"
				>
					<p className="text-body text-ink">
						Paste the code {host ?? "the provider"} shows after you approve
					</p>
					<div className="w-full">{pasteField(true)}</div>
					<div className="flex flex-wrap items-center gap-2">
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void flowHandle.reopen()}
						>
							<ExternalLink aria-hidden="true" />
							{flow.opened ? "Open browser again" : "Open sign-in page"}
						</Button>
						{operation.auth_url ? (
							<CopyButton value={operation.auth_url} label="Copy link" />
						) : null}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void flowHandle.cancel()}
						>
							Cancel
						</Button>
					</div>
				</div>
			);
		} else {
			body = (
				<div
					className="flex flex-col items-start gap-3"
					data-sign-in-state="waiting"
				>
					<div className="flex items-center gap-2">
						<Spinner size="sm" />
						<output className="text-body text-ink">
							Finish signing in in your browser
						</output>
					</div>
					<p className="text-body-sm text-ink-muted">
						{flow.opened
							? `We opened ${host ?? "the sign-in page"}. Approve access there and this page updates on its own.`
							: flow.openFailed
								? "Your browser didn't open. Open the sign-in page yourself, or copy the link."
								: `Opening ${host ?? "the sign-in page"}. Approve access there and this page updates on its own.`}
					</p>
					<div className="flex flex-wrap items-center gap-2">
						{/* "Open again" only once something opened: a Reopen for a page
						    that never opened is the lie design D2 photographed. */}
						<Button
							variant="secondary"
							size="sm"
							onClick={() => void flowHandle.reopen()}
						>
							<ExternalLink aria-hidden="true" />
							{flow.opened ? "Open browser again" : "Open sign-in page"}
						</Button>
						{operation.auth_url ? (
							<CopyButton value={operation.auth_url} label="Copy link" />
						) : null}
						<Button
							variant="ghost"
							size="sm"
							onClick={() => void flowHandle.cancel()}
						>
							Cancel
						</Button>
					</div>
					{minutes ? (
						<p className="text-ink-dim text-meta">
							Link expires in {minutes} min
						</p>
					) : null}
					{pasteField ? (
						<Disclosure
							summary="Browser showed a code? Paste it here"
							className="w-full"
						>
							<div className="pt-2">{pasteField(false)}</div>
						</Disclosure>
					) : null}
				</div>
			);
		}
	} else if (flow.phase === "settled" && operation?.state === "succeeded") {
		body = (
			<SignedIn
				brand={brand}
				verb="Signed in to"
				defaults={operation.defaults_applied}
				onChangeModel={onChangeModel}
				actionLabel={doneLabel}
				onAction={finish}
				primaryAction={context === "dialog"}
			/>
		);
	} else {
		// Failed, expired, cancelled by another window, or a refused start.
		const message = operation
			? unfinishedMessage(operation, brand)
			: (flow.error ?? `${brand} didn't confirm the sign-in.`);
		body = (
			<div className="flex flex-col gap-3" data-sign-in-state="unfinished">
				<Alert
					variant={operation?.state === "cancelled" ? "neutral" : "warning"}
				>
					<AlertTitle>Sign-in didn't finish</AlertTitle>
					<AlertDescription>{message}</AlertDescription>
				</Alert>
				<div className="flex flex-wrap items-center gap-2">
					<Button variant="secondary" size="sm" onClick={start}>
						<RotateCcw aria-hidden="true" />
						Try again
					</Button>
					{apiKeyMethod ? (
						<Button
							variant="ghost"
							size="sm"
							onClick={() => chooseMethod(apiKeyMethod.method_id)}
						>
							Use an API key instead
						</Button>
					) : null}
				</div>
			</div>
		);
	}

	return (
		<div className="flex flex-col gap-4">
			{methodTabs}
			{body}
		</div>
	);
};
