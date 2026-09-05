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
import { showErrorToast } from "@shared/utils/toast-manager";
import { useQueryClient } from "@tanstack/react-query";
import { Check, Copy, Eye, EyeOff, RotateCcw } from "lucide-react";
import type { FC } from "react";
import { useCallback, useEffect, useRef, useState } from "react";
import { isTerminalAuthState, primaryMethod } from "./provider-labels";

type ProviderDetailProps = {
	provider: DesktopProvider;
	/** Called once an auth method has stored a credential. */
	onConnected?: () => void;
};

const POLL_MS = 1500;

/**
 * Poll a backend auth operation until it settles. Returns a stop function;
 * a closed poll is NOT a cancellation — only the explicit Cancel button
 * deletes the operation, because closing a status view must not tear down
 * a flow the user may still be completing in their browser.
 */
function pollOperation(
	id: string,
	onUpdate: (operation: AuthOperation) => void,
): () => void {
	let stopped = false;
	let timer: ReturnType<typeof setTimeout> | null = null;
	const tick = async () => {
		if (stopped) return;
		try {
			const operation = await desktopResult<AuthOperation>({
				op: "auth.status",
				id,
			});
			onUpdate(operation);
			if (!isTerminalAuthState(operation.state)) {
				timer = setTimeout(tick, POLL_MS);
			}
		} catch {
			// A lost poll is a lost status read, not a failed login; keep polling
			// so a transient network blip does not strand a waiting browser flow.
			timer = setTimeout(tick, POLL_MS * 2);
		}
	};
	void tick();
	return () => {
		stopped = true;
		if (timer) clearTimeout(timer);
	};
}

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
	const [methodId, setMethodId] = useState<string | null>(null);
	const [operation, setOperation] = useState<AuthOperation | null>(null);
	const [starting, setStarting] = useState(false);
	const [keyValue, setKeyValue] = useState("");
	const [keySaving, setKeySaving] = useState(false);
	const [flowError, setFlowError] = useState<string | null>(null);
	const [promptValue, setPromptValue] = useState("");
	const [copied, setCopied] = useState(false);
	const stopPollRef = useRef<(() => void) | null>(null);

	const method: ProviderMethod | null =
		provider.auth_methods.find((candidate) => candidate.id === methodId) ??
		primaryMethod(provider.auth_methods);

	useEffect(
		() => () => {
			// Unmount stops polling only; the flow itself belongs to the backend.
			stopPollRef.current?.();
		},
		[],
	);

	const refreshProviders = useCallback(() => {
		void queryClient.invalidateQueries({ queryKey: desktopKeys.providers });
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
				stopPollRef.current = pollOperation(started.id, (update) => {
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
					{provider.name} runs on this computer and needs no account or key.
				</p>
				<Badge variant={provider.configured ? "success" : "neutral"}>
					{provider.configured ? "Ready" : "Not detected"}
				</Badge>
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
							key={candidate.id}
							variant={candidate.id === method.id ? "secondary" : "ghost"}
							size="sm"
							onClick={() => {
								setMethodId(candidate.id);
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
							{provider.configured && (
								<Badge variant="success">Signed in</Badge>
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
