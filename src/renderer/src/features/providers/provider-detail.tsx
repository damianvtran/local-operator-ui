/**
 * Provider detail panel: the actual supported auth method for one registry
 * row, with one primary CTA per method.
 *
 * Sign-in flows run as backend auth operations: the backend owns PKCE/state/
 * callback ports, the UI polls the operation status and renders its pending,
 * input, retry and expiry states. Device instructions (a code to COPY) are
 * display content; an `input_required` prompt is a control to PASTE into —
 * the two are never rendered as the same thing. Keys are saved only by an
 * explicit "Save key" action; blur never persists a credential silently.
 */

import {
	isTerminalAuthState,
	pollAuthOperation,
} from "@shared/api/local-operator/auth-operation";
import { desktopResult } from "@shared/api/local-operator/desktop-api";
import type {
	AuthOperation,
	DesktopProvider,
	ProviderMethod,
} from "@shared/api/local-operator/desktop-api";
import { openAuthorization } from "@shared/api/local-operator/desktop-api";
import { desktopKeys } from "@shared/api/local-operator/desktop-hooks";
import { Spinner } from "@shared/components/common/spinner";
import { Alert, Badge, Button, Input, Label } from "@shared/components/ui";
/*
 * The verdict is read through the composer callout's own module rather than a
 * query of this feature's: the chip and the callout share one cache entry for
 * `GET /v1/auth/status`, so they cannot disagree about one verdict at one
 * instant (see `useRadientAuthStatus`).
 */
import {
	radientSessionIssueKey,
	useRadientLoginVerdict,
} from "@shared/hooks/use-radient-session-issue";
/*
 * The MODULE, not the `@shared/hooks` barrel: the barrel carries
 * `use-connectivity-status`, which reads the renderer's config at import time and
 * therefore throws in any Node bundle that does not define `import.meta.env` --
 * `scripts/backend-error-surfaces.test.mjs` bundles this grid and says so in its own
 * docblock. Importing the leaf keeps this feature out of that graph.
 */
import { useRadientUserQuery } from "@shared/hooks/use-radient-user-query";
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, RotateCcw } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import {
	loginClaim,
	primaryMethod,
	providerReadiness,
} from "./provider-labels";

/**
 * Reachability for a local provider, stated only after it has been checked.
 *
 * Deliberately NOT run on mount: a probe is a real network round trip, and the
 * UX round's binding constraint is that nothing behind first paint makes one.
 * Before the user asks, the panel says what it knows (no key needed) and what
 * it does not (whether the server is running).
 */
const LocalProviderReachability: FC<{ provider: DesktopProvider }> = ({
	provider,
}) => {
	const [testing, setTesting] = useState(false);
	const [result, setResult] = useState<{
		reachable: boolean;
		detail: string;
	} | null>(null);

	// A different provider row reuses this component; a verdict about the
	// previous one must not linger beside the new name.
	// biome-ignore lint/correctness/useExhaustiveDependencies: provider.id is the reset trigger, not a value read here
	useEffect(() => {
		setResult(null);
	}, [provider.id]);

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

	return (
		<div className="flex flex-col items-start gap-2">
			<Badge variant={result?.reachable ? "success" : "neutral"}>
				{result === null
					? "Not tested yet"
					: result.reachable
						? "Server responded"
						: "No server responded"}
			</Badge>
			{result && <p className="text-ink-muted text-meta">{result.detail}</p>}
			<Button
				variant="secondary"
				size="sm"
				onClick={() => void test()}
				disabled={testing}
			>
				{testing ? "Testing" : "Test connection"}
			</Button>
		</div>
	);
};

type ProviderDetailProps = {
	provider: DesktopProvider;
	/** Called once an auth method has stored a credential. */
	onConnected?: () => void;
};

const SecretInput: FC<{
	id: string;
	value: string;
	onChange: (value: string) => void;
	label: string;
}> = ({ id, value, onChange, label }) => {
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

export const ProviderDetail: FC<ProviderDetailProps> = ({
	provider,
	onConnected,
}) => {
	const queryClient = useQueryClient();
	/*
	 * The verdict on this machine's Radient sign-in. This panel rendered its
	 * "Signed in" badge from `provider.configured` alone, which is a fact about
	 * the credential store: a revoked grant kept the row, kept that flag, and
	 * left the panel telling the user they were signed in while the sentence
	 * directly above it said they were not (UX U1). Called before the panel's
	 * early returns, so the hook order is the same for every provider.
	 *
	 * `retryOnMount: false` for the reason the account read below carries it, on
	 * the other key (QA round 3, Q-8): this panel REPORTS the verdict its host
	 * (the grid, or the account section's sign-in block) already reads, and with
	 * the default a panel mounting on a FAILED, data-less verdict re-commissioned
	 * it. Every card press on a failing `GET /v1/auth/status` became a loop -
	 * measured at 1,579 requests in 20 s and a grid stuck on "Loading providers" -
	 * because the grid's hold unmounted this panel for each re-read and its
	 * remount started the next. See `RadientLoginVerdictOptions` for the
	 * mechanism, and `useRadientAuthStatus`'s `settling` for the gate's half.
	 */
	const login = useRadientLoginVerdict({ retryOnMount: false });
	/**
	 * The app's own answer about whether a Radient sign-in is stored, and whether
	 * it could be asked at all (see `loginState`; design round 1's D3 is why the
	 * chip may not fall back to the credential row when the verdict is absent).
	 *
	 * `retryOnMount: false` IS THE FIX FOR THE ONE REGRESSION THIS PR CAUSED, and
	 * it is here rather than in the hook because it is a property of THIS caller:
	 * the panel REPORTS this read, it does not own it. Round 2 measured what an
	 * owning observer costs when it lives inside a subtree the read's own loading
	 * state unmounts (design D7, QA Q-5, one defect from two rigs):
	 *
	 *   the account section early-returns its spinner for `isLoading`, which is
	 *   true again the moment any observer starts a read; the sign-in block it
	 *   hides contains this panel, so this panel is unmounted by the very read it
	 *   is watching. React Query re-runs a FAILED, data-less query when a new
	 *   observer mounts on it (`@tanstack/query-core@5.73.3`
	 *   `shouldLoadOnMount`, `retryOnMount` default true), so the sequence is:
	 *   read fails / the section renders its content / this panel mounts / the
	 *   mount re-commissions the read / the section spins again / this panel is
	 *   unmounted / repeat. Measured on the real composition (settings section +
	 *   its sign-in block) in this repo's jsdom harness: 14 account reads in 14 s,
	 *   the section never leaving the spinner, `status: pending`,
	 *   `fetchStatus: fetching`, `failureCount: 2` -- the same shape QA read off
	 *   the live app (54 reads a boot, ~1/s) and design read off its own rig
	 *   (39 in 30 s on this head against 4 on `origin/main`). With this option the
	 *   same composition settles in one read and renders the sentence, the chip
	 *   and the sign-in control.
	 *
	 * WHAT WAS RULED OUT, because the leading hypothesis was the other one: the
	 * hook's options are written inline (`queryKey: radientUserKeys.user()`, an
	 * inline `retry`), and a fresh options object per render was the suspect. It is
	 * not the cause. Ten forced re-renders of an errored observer whose `queryKey`
	 * array and `retry` function are rebuilt every render start ZERO further reads
	 * (React Query hashes the key by value and only compares options), and hoisting
	 * `retry` to module scope AND pinning the key to one module-level array leaves
	 * the loop at exactly 14 reads in 14 s. Only the mount is load-bearing, which
	 * is why the fix is one option on this call and not a rewrite of the hook.
	 */
	const { accountRead, unavailable } = useRadientUserQuery({
		retryOnMount: false,
	});
	/**
	 * The badge's own words, from the same predicate the grid's cards use, so one
	 * credential cannot be called two things on one screen -- including the
	 * WITHHELD answer (`null`, design round 4's D12): while no read that can
	 * support a claim has answered, the grid's card shows none and neither does
	 * this badge.
	 */
	const claim = loginClaim(provider.id, login, { accountRead, unavailable });
	const readiness = claim === null ? null : providerReadiness(provider, claim);
	const [methodId, setMethodId] = useState<string | null>(null);
	const [operation, setOperation] = useState<AuthOperation | null>(null);
	const [starting, setStarting] = useState(false);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [flowError, setFlowError] = useState<string | null>(null);
	const [promptValue, setPromptValue] = useState("");
	const [copied, setCopied] = useState(false);
	const stopPollRef = useRef<(() => void) | null>(null);

	// Resolved by METHOD identity, not provider id: a provider can offer several
	// methods that all act on the same provider, so matching on `id` returned the
	// first one every time and the other panels could not be reached (D2).
	const method: ProviderMethod | null =
		provider.auth_methods.find(
			(candidate) => candidate.method_id === methodId,
		) ?? primaryMethod(provider.auth_methods);

	useEffect(
		() => () => {
			// Unmount stops polling only; the flow itself belongs to the backend.
			stopPollRef.current?.();
		},
		[],
	);

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
		 * And the VERDICT, whose query is what the chip actually reads (code round
		 * 2, M3). It sits AFTER the catalogue line rather than between the two
		 * above, because `scripts/picker-feedback.test.mjs` pins the providers and
		 * catalogue invalidations within a bounded distance of each other, and a
		 * comment this long between them breaks that pin. Without this a sign-in that just succeeded from this panel left
		 * the grid and this panel saying "Needs re-authentication" until the 60 s
		 * poll or a window focus -- the user who fixed the fault was told it was
		 * still broken, on the surface that had just fixed it. Reproduced with this
		 * PR's harness: refused / press the card / `auth.status` answers `succeeded`
		 * (verdict `ok`) / back to providers, and the grid still read "Needs
		 * re-authentication" with the verdict request count unchanged at 1 and
		 * `{credential_id: 7, state: "login_required"}` still in the cache.
		 */
		void queryClient.invalidateQueries({ queryKey: radientSessionIssueKey });
		onConnected?.();
	}, [queryClient, onConnected]);

	const beginFlow = useCallback(
		async (selected: ProviderMethod) => {
			setStarting(true);
			setFlowError(null);
			setCopied(false);
			try {
				const started = await desktopResult<AuthOperation>({
					op: "auth.start",
					provider: selected.id,
				});
				setOperation(started);
				stopPollRef.current?.();
				stopPollRef.current = pollAuthOperation(started.id, (update) => {
					setOperation(update);
					if (update.state === "succeeded") refreshProviders();
				});
				if (started.auth_url) {
					// Main opens the operation's current URL once; the renderer never
					// supplies it, so a compromised render path cannot turn this into
					// a general link opener.
					await openAuthorization(started.id);
				}
			} catch (error) {
				setFlowError(
					error instanceof Error ? error.message : "Sign-in could not start.",
				);
			} finally {
				setStarting(false);
			}
		},
		[refreshProviders],
	);

	const cancelFlow = useCallback(async () => {
		if (!operation) return;
		stopPollRef.current?.();
		stopPollRef.current = null;
		try {
			await desktopResult({ op: "auth.cancel", id: operation.id });
		} catch {
			// The flow may already be terminal; the local panel closes either way.
		}
		setOperation(null);
	}, [operation]);

	const retryFlow = useCallback(() => {
		if (!method) return;
		stopPollRef.current?.();
		stopPollRef.current = null;
		setOperation(null);
		void beginFlow(method);
	}, [method, beginFlow]);

	const submitPrompt = useCallback(async () => {
		if (!operation?.prompt_id || !promptValue) return;
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
			setFlowError(
				error instanceof Error ? error.message : "The code was not accepted.",
			);
		}
	}, [operation, promptValue]);

	const saveKey = useCallback(async () => {
		if (!method || !keyValue.trim()) return;
		setKeySaving(true);
		setFlowError(null);
		try {
			await desktopResult({
				op: "auth.key",
				provider: method.id,
				value: keyValue.trim(),
			});
			setKeyValue("");
			refreshProviders();
		} catch (error) {
			setFlowError(
				error instanceof Error ? error.message : "The key could not be saved.",
			);
		} finally {
			setKeySaving(false);
		}
	}, [method, keyValue, refreshProviders]);

	const copyInstructions = useCallback(async () => {
		if (!operation?.instructions) return;
		try {
			await navigator.clipboard.writeText(operation.instructions);
			setCopied(true);
		} catch {
			showErrorToast("Could not copy the code. Select and copy it manually.");
		}
	}, [operation?.instructions]);

	if (provider.local) {
		return (
			<div className="flex flex-col gap-3">
				<p className="text-body-sm text-ink-muted">
					{provider.name} runs on this computer and needs no account or key. It
					has to be running before this app can use it.
				</p>
				{/* Was a green "Ready" derived from `configured`, which for a local
				    provider means only "needs no credential" -- nothing has
				    contacted the server. Test connection is the only thing here
				    that may claim reachability, because it is the only thing that
				    checks. */}
				<LocalProviderReachability provider={provider} />
			</div>
		);
	}

	if (!method) {
		return (
			<Alert variant="warning">
				This provider has no supported sign-in method on this backend.
			</Alert>
		);
	}

	const waiting = operation && !isTerminalAuthState(operation.state);
	const failed =
		operation &&
		(operation.state === "failed" ||
			operation.state === "expired" ||
			operation.state === "cancelled");

	return (
		<div className="flex flex-col gap-4">
			{provider.auth_methods.length > 1 && (
				<fieldset className="flex flex-wrap gap-2">
					<legend className="sr-only">Sign-in method</legend>
					{provider.auth_methods.map((candidate) => (
						<Button
							key={candidate.method_id}
							variant={
								candidate.method_id === method.method_id ? "secondary" : "ghost"
							}
							size="sm"
							onClick={() => {
								setMethodId(candidate.method_id);
								setOperation(null);
								setFlowError(null);
								stopPollRef.current?.();
							}}
						>
							{candidate.kind === "api_key" ? "API key" : candidate.label}
						</Button>
					))}
				</fieldset>
			)}

			{flowError && <Alert variant="danger">{flowError}</Alert>}

			{method.kind === "api_key" ? (
				<div className="flex flex-col gap-2">
					<Label htmlFor={`key-${provider.id}`}>API key</Label>
					<SecretInput
						id={`key-${provider.id}`}
						value={keyValue}
						onChange={setKeyValue}
						label={`${provider.name} API key`}
					/>
					<div className="flex items-center gap-2">
						<Button
							variant="primary"
							size="sm"
							disabled={!keyValue.trim() || keySaving}
							onClick={() => void saveKey()}
						>
							{keySaving ? <Spinner size="sm" /> : null}
							Save key
						</Button>
						{provider.configured && (
							<Badge variant="success">A credential is saved</Badge>
						)}
					</div>
				</div>
			) : (
				<div className="flex flex-col gap-3">
					{!operation && (
						<div className="flex items-center gap-2">
							<Button
								variant="primary"
								size="sm"
								disabled={starting}
								onClick={() => void beginFlow(method)}
							>
								{starting ? <Spinner size="sm" /> : null}
								{method.label}
							</Button>
							{/* The row's own badge, keyed on the login verdict rather than on
							    the credential row -- and NOT painted until a read that can
							    support it has answered (`loginClaim`), because a claim it is
							    about to correct is what design round 1's D6 and round 4's D12
							    measured. No slot is reserved here, unlike the grid card: the
							    badge sits at the END of the button's row, so its arrival moves
							    nothing else. The prose rides the same `title` the grid's chip
							    carries, so the long form is reachable on both surfaces. */}
							{provider.configured && readiness && (
								<Badge variant={readiness.tone} title={readiness.detail}>
									{readiness.label}
								</Badge>
							)}
						</div>
					)}

					{waiting && (
						<div className="flex flex-col gap-3">
							<p className="text-body-sm text-ink-muted">
								{operation.message || "Finish signing in to continue."}
							</p>
							{/* Device flow: the code is something to COPY and carry to the
							    provider page — display content with a copy action. */}
							{operation.instructions && (
								<div className="flex items-center gap-2 rounded-sm border border-control bg-sunken p-3">
									<code className="flex-1 font-mono text-body-sm text-ink">
										{operation.instructions}
									</code>
									<Button
										variant="secondary"
										size="sm"
										onClick={() => void copyInstructions()}
									>
										{copied ? (
											<Check aria-hidden="true" />
										) : (
											<Copy aria-hidden="true" />
										)}
										{copied ? "Copied" : "Copy code"}
									</Button>
								</div>
							)}
							{operation.auth_url && (
								<Button
									variant="secondary"
									size="sm"
									onClick={() =>
										void openAuthorization(operation.id, true).catch(
											(error: unknown) =>
												showErrorToast(
													error instanceof Error
														? error.message
														: "The sign-in page could not be opened.",
												),
										)
									}
								>
									Reopen sign-in page
								</Button>
							)}
							{/* Auth flow: an input prompt is somewhere to PASTE a code the
							    provider showed — a control, not display content. */}
							{operation.input_required && (
								<div className="flex items-end gap-2">
									<div className="flex-1">
										<Label htmlFor={`prompt-${operation.id}`}>
											Paste the code from the provider
										</Label>
										<SecretInput
											id={`prompt-${operation.id}`}
											value={promptValue}
											onChange={setPromptValue}
											label="Provider code"
										/>
									</div>
									<Button
										variant="primary"
										size="sm"
										disabled={!promptValue}
										onClick={() => void submitPrompt()}
									>
										Submit code
									</Button>
								</div>
							)}
							<div className="flex items-center gap-2">
								<Spinner size="sm" />
								<span className="text-meta text-ink-dim">
									{operation.state === "input_required"
										? "Waiting for the code"
										: `Waiting${operation.expires_in > 0 ? ` (${Math.ceil(operation.expires_in / 60)} min left)` : ""}`}
								</span>
								<Button
									variant="ghost"
									size="sm"
									onClick={() => void cancelFlow()}
								>
									Cancel
								</Button>
							</div>
						</div>
					)}

					{failed && (
						<div className="flex flex-col gap-2">
							<Alert
								variant={
									operation.state === "cancelled" ? "neutral" : "warning"
								}
							>
								{operation.state === "expired"
									? "This sign-in expired before it finished."
									: operation.state === "cancelled"
										? "This sign-in was cancelled."
										: operation.message || "Sign-in did not complete."}
							</Alert>
							<div>
								<Button variant="secondary" size="sm" onClick={retryFlow}>
									<RotateCcw aria-hidden="true" />
									Try again
								</Button>
							</div>
						</div>
					)}
				</div>
			)}
		</div>
	);
};
