/**
 * Every state provider sign-in, the Providers page, first-run onboarding and
 * the empty chat pass through, each reachable by a story id.
 *
 * ## What is real here, and what is scripted
 *
 * The components are the production ones on their production data path: the
 * list reads `providers.list`, the panel starts `auth.start` and polls
 * `auth.status` through the real `sign-in-flow.ts` and `pollAuthOperation`. The
 * DESKTOP BRIDGE (`window.api.desktop`) is the stub, exactly as
 * `provider-setup.stories.tsx` stubs it, and it replays the backend's measured
 * sequences:
 *
 * - `legacy`: the RELEASED backend -- the start answers `starting` with no URL
 *   and the URL arrives on the first poll (0.13-1.18 s later, measured in the
 *   UX walk). This is the sequence that used to need a second click.
 * - `current`: the suggested-defaults backend -- the start answers with the
 *   URL, and success carries `defaults_applied`.
 *
 * `openAuthorization` RECORDS the operation id into `window.__openedAuth` and
 * the console; nothing opens a browser. The story's readout strip prints that
 * record, so a frame of the waiting state also shows whether the page opened
 * on the first click.
 *
 * The census is the registry-derived first-run fixture the design audit used
 * (18 rows, Radient 15th), with the backend's suggestions added.
 */

import { OnboardingModal } from "@features/onboarding/components/onboarding-modal";
import { DefaultModelSummary } from "@features/onboarding/components/steps/default-model-step";
import { ConnectProviderCard } from "@features/providers/connect-provider-card";
import { ConnectProviderDialog } from "@features/providers/connect-provider-dialog";
import { useConnectProviderStore } from "@features/providers/connect-provider-store";
import { SettingsSection } from "@features/settings/components/settings-section";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { Plug } from "lucide-react";
import type { ReactNode } from "react";
import { useEffect, useLayoutEffect, useState } from "react";
import FIRST_RUN from "../../../../../scripts/fixtures/auth-providers-first-run.json";
import type {
	AuthOperation,
	DesktopProvider,
	DesktopResponse,
} from "../../../../shared/desktop-contract";
import { ProviderGrid } from "./provider-grid";

const SUGGESTIONS: Record<string, { id: string; name: string }> = {
	anthropic: { id: "claude-opus-5-5", name: "Claude Opus 5.5" },
	openai: { id: "gpt-6-astra", name: "GPT-6 Astra" },
	deepseek: { id: "deepseek-v4.1-flash", name: "DeepSeek V4.1 Flash" },
	zai: { id: "glm-5.3", name: "GLM-5.3" },
	xai: { id: "grok-4.7", name: "Grok 4.7" },
	google: { id: "gemini-3.8-flash", name: "Gemini 3.8 Flash" },
	radient: { id: "auto", name: "Auto" },
};

const CENSUS: DesktopProvider[] = (
	FIRST_RUN.providers as unknown as DesktopProvider[]
).map((row) => ({ ...row, suggested_model: SUGGESTIONS[row.id] ?? null }));

const signedIn = (ids: string[]): DesktopProvider[] =>
	CENSUS.map((row) =>
		ids.includes(row.id)
			? {
					...row,
					has_credential: true,
					configured: true,
					stored_credentials: 1,
				}
			: row,
	);

/* ------------------------------------------------------------- the bridge */

type Script =
	/** Released backend: URL on the first poll; waits in the browser forever. */
	| "legacy-waiting"
	/** Current backend: URL on the start reply; waits in the browser. */
	| "current-waiting"
	/** Anthropic's optional paste on the current backend. */
	| "optional-paste"
	/** A flow whose paste IS the flow. */
	| "paste-required"
	/** A device flow on the released backend: the code only in `instructions`. */
	| "device-legacy"
	/** Succeeds on the second poll with a defaults receipt. */
	| "succeed"
	/** The link runs out. */
	| "expire"
	/** Fails with the backend's sentence. */
	| "fail"
	/** The backend no longer holds the operation (404). */
	| "gone";

type BridgeOptions = {
	providers?: DesktopProvider[];
	hosting?: string;
	model?: string;
	script?: Script;
	/** How `auth.key` answers: saved, saved-unchecked, or rejected (422). */
	key?: "valid" | "unchecked" | "rejected";
};

declare global {
	interface Window {
		__openedAuth?: string[];
	}
}

const OP_ID = "0f1e2d3c-4b5a-6978-8796-a5b4c3d2e1f0";
const AUTH_URL = "https://claude.ai/oauth/authorize?client_id=story&state=s";
const DEFAULTS = {
	hosting: "anthropic",
	model: "claude-opus-5-5",
	model_name: "Claude Opus 5.5",
	receipt: "New chats will use Claude Opus 5.5.",
};

const snapshot = (
	state: AuthOperation["state"],
	extra: Partial<AuthOperation> = {},
): AuthOperation => ({
	id: OP_ID,
	provider: "anthropic",
	state,
	message:
		state === "starting"
			? "Starting sign-in."
			: "Complete sign-in in your browser.",
	auth_url: null,
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 540,
	...extra,
});

const installBridge = (options: BridgeOptions) => {
	let polls = 0;
	window.__openedAuth = [];
	const script = options.script ?? "legacy-waiting";
	const ok = (result: unknown): DesktopResponse => ({
		status: 200,
		body: { result },
	});
	const statusFor = (): DesktopResponse => {
		polls += 1;
		const waiting = snapshot("waiting", { auth_url: AUTH_URL });
		switch (script) {
			case "optional-paste":
				return ok(
					snapshot("input_required", {
						auth_url: AUTH_URL,
						input_required: true,
						input_optional: true,
						prompt_id: "p1",
					}),
				);
			case "paste-required":
				return ok(
					snapshot("input_required", {
						auth_url: "https://auth.example.com/authorize",
						input_required: true,
						input_optional: false,
						prompt_id: "p1",
					}),
				);
			case "device-legacy":
				return ok(
					snapshot("waiting", {
						provider: "openai",
						auth_url: "https://auth.openai.com/codex/device",
						instructions: "Enter code: K7QX-M2PD",
					}),
				);
			case "succeed":
				return polls < 2
					? ok(waiting)
					: ok(
							snapshot("succeeded", {
								message: "Sign-in complete.",
								defaults_applied: DEFAULTS,
							}),
						);
			case "expire":
				return polls < 2
					? ok(waiting)
					: ok(
							snapshot("expired", {
								message: "Sign-in expired. Start again when you are ready.",
								expires_in: 0,
							}),
						);
			case "fail":
				return polls < 2
					? ok(waiting)
					: ok(
							snapshot("failed", {
								message: "Sign-in failed. Check the provider and try again.",
							}),
						);
			case "gone":
				return polls < 2
					? ok(waiting)
					: {
							status: 404,
							body: {
								detail: "This sign-in is no longer available. Start again.",
							},
						};
			default:
				return ok(waiting);
		}
	};
	const page = window as unknown as { api?: Record<string, unknown> };
	const api = (page.api ?? {}) as Record<string, unknown>;
	page.api = api;
	const previous = api.desktop;
	api.desktop = {
		request: async (request: {
			op: string;
			value?: unknown;
		}): Promise<DesktopResponse> => {
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						features: { auth: 1 },
					});
				case "providers.list":
					return ok({ providers: options.providers ?? CENSUS });
				case "config.get":
					return ok({
						version: "story",
						metadata: {},
						values: {
							hosting: options.hosting ?? "",
							model_name: options.model ?? "",
						},
					});
				case "auth.start":
					return ok(
						script.startsWith("current") || script === "optional-paste"
							? snapshot("waiting", { auth_url: AUTH_URL })
							: snapshot("starting"),
					);
				case "auth.status":
					return statusFor();
				case "auth.cancel":
					return ok(snapshot("cancelled", { message: "Sign-in cancelled." }));
				case "auth.key":
					if (options.key === "rejected")
						return {
							status: 422,
							body: {
								detail:
									"DeepSeek rejected this API key. Check it and try again.",
							},
						};
					return ok({
						valid: options.key === "unchecked" ? null : true,
						reason:
							options.key === "unchecked"
								? "DeepSeek could not be reached to check it."
								: null,
						defaults_applied: {
							hosting: "deepseek",
							model: "deepseek-v4.1-flash",
							model_name: "DeepSeek V4.1 Flash",
							receipt: "New chats will use DeepSeek V4.1 Flash.",
						},
					});
				case "auth.probe":
					return ok({
						reachable: false,
						detail: "Nothing answered at http://localhost:11434.",
					});
				default:
					throw new Error(`unexpected desktop op in this story: ${request.op}`);
			}
		},
		openAuthorization: async (id: string, reopen?: boolean) => {
			window.__openedAuth?.push(`${id} reopen=${Boolean(reopen)}`);
			console.log(`STORY openAuthorization ${id} reopen=${Boolean(reopen)}`);
		},
	};
	return () => {
		api.desktop = previous;
	};
};

/** The bridge, installed before the first query, and a readout of opens. */
const Bridge = ({
	options,
	children,
}: {
	options: BridgeOptions;
	children: ReactNode;
}) => {
	const [ready, setReady] = useState(false);
	useLayoutEffect(() => {
		const restore = installBridge(options);
		setReady(true);
		return restore;
	}, [options]);
	const [opens, setOpens] = useState<string[]>([]);
	useEffect(() => {
		const timer = setInterval(
			() => setOpens([...(window.__openedAuth ?? [])]),
			250,
		);
		return () => clearInterval(timer);
	}, []);
	return ready ? (
		<>
			{children}
			<output className="fixed right-2 bottom-2 rounded-sm bg-sunken px-2 py-1 font-mono text-ink-dim text-mono-sm">
				opens: {opens.length === 0 ? "none" : opens.join(", ")}
			</output>
		</>
	) : null;
};

const SettingsFrame = ({ children }: { children: ReactNode }) => (
	<div className="flex min-h-screen justify-center bg-canvas p-8">
		<div style={{ width: 896 }}>
			<SettingsSection
				title="Model providers"
				icon={Plug}
				description="Sign in to the services your agents think with. New chats use your default model."
			>
				{children}
			</SettingsSection>
		</div>
	</div>
);

const meta: Meta = {
	title: "Providers/Sign-in states",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const openRow = async (name: RegExp) => {
	await userEvent.click(await screen.findByRole("button", { name }));
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/* ----------------------------------------------------------- settings page */

const OPTS_FIRST_RUN: BridgeOptions = {};
/** Settings > Model providers on a first run: nothing connected. */
export const ProvidersFirstRun: Story = {
	render: () => (
		<Bridge options={OPTS_FIRST_RUN}>
			<SettingsFrame>
				<ProviderGrid />
			</SettingsFrame>
		</Bridge>
	),
};

const OPTS_CONNECTED: BridgeOptions = {
	providers: signedIn(["anthropic", "deepseek"]),
	hosting: "anthropic",
	model: "claude-opus-5-5",
};
/** Two providers connected; the default leads the Connected block. */
export const ProvidersConnected: Story = {
	render: () => (
		<Bridge options={OPTS_CONNECTED}>
			<SettingsFrame>
				<ProviderGrid onChangeModel={() => undefined} />
			</SettingsFrame>
		</Bridge>
	),
};

/** The connected row's overflow menu, opened. */
export const ProvidersConnectedMenu: Story = {
	render: ProvidersConnected.render,
	play: async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: "Manage DeepSeek" }),
		);
	},
};

/* ------------------------------------------------------ sign-in panel states */

/**
 * A panel state, framed on ONE provider row.
 *
 * WHY THE CENSUS IS NARROWED HERE. The panel opens INLINE beneath its row, and
 * the full census makes the frame 18 rows tall -- so a viewport-sized still of
 * "the waiting state" showed rows 15-18 and not the panel at all. These frames
 * are about the panel; the list's own frames (`ProvidersFirstRun`,
 * `ProvidersConnected`) carry the full census.
 */
const panelStory = (
	options: BridgeOptions,
	row: RegExp,
	after?: () => Promise<void>,
	only?: string,
): Story => ({
	render: () => (
		<Bridge
			options={
				only
					? {
							...options,
							providers: (options.providers ?? CENSUS).filter(
								(provider) => provider.id === only,
							),
						}
					: options
			}
		>
			<SettingsFrame>
				<ProviderGrid onChangeModel={() => undefined} />
			</SettingsFrame>
		</Bridge>
	),
	play: async () => {
		await openRow(row);
		await after?.();
	},
});

/*
 * The accessible names these plays look for, hoisted so each pattern is
 * compiled once (`lint/performance/useTopLevelRegex`).
 */
const CONTINUE_IN_BROWSER = /Continue in browser/;
const PASTE_DISCLOSURE = /Browser showed a code/;

const clickContinue = async () => {
	await userEvent.click(
		await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
	);
	await wait(2200);
};

/** Idle: the Anthropic panel before anything is pressed. */
export const PanelIdle = panelStory(
	{},
	/Sign in: Anthropic/,
	undefined,
	"anthropic",
);

const OPTS_LEGACY: BridgeOptions = { script: "legacy-waiting" };
/**
 * Waiting, on the RELEASED backend: one click, the URL arrives on the first
 * poll, and the readout shows the page opened with `reopen=false`.
 */
export const PanelWaitingLegacyBackend = panelStory(
	OPTS_LEGACY,
	/Sign in: Anthropic/,
	clickContinue,
	"anthropic",
);

const OPTS_CURRENT: BridgeOptions = { script: "current-waiting" };
/** Waiting, on the current backend (URL on the start reply). */
export const PanelWaitingCurrentBackend = panelStory(
	OPTS_CURRENT,
	/Sign in: Anthropic/,
	clickContinue,
	"anthropic",
);

const OPTS_OPTIONAL: BridgeOptions = { script: "optional-paste" };
/** Anthropic's optional paste: browser first, paste behind the disclosure. */
export const PanelOptionalPaste = panelStory(
	OPTS_OPTIONAL,
	/Sign in: Anthropic/,
	clickContinue,
	"anthropic",
);

/** The same, with the "Browser showed a code?" disclosure opened. */
export const PanelOptionalPasteOpen = panelStory(
	OPTS_OPTIONAL,
	/Sign in: Anthropic/,
	async () => {
		await clickContinue();
		await userEvent.click(
			await screen.findByRole("button", { name: PASTE_DISCLOSURE }),
		);
	},
	"anthropic",
);

const OPTS_PASTE: BridgeOptions = { script: "paste-required" };
/** A flow whose paste IS the flow: the field is open and is the headline. */
export const PanelPasteRequired = panelStory(
	OPTS_PASTE,
	/Sign in: Anthropic/,
	clickContinue,
	"anthropic",
);

const OPTS_DEVICE: BridgeOptions = { script: "device-legacy" };
/** Device code on the released backend: the code parsed out of "Enter code:". */
export const PanelDeviceCode = panelStory(
	OPTS_DEVICE,
	/Sign in: OpenAI/,
	async () => {
		await userEvent.click(
			await screen.findByRole("tab", { name: "ChatGPT, with a code" }),
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Get a sign-in code" }),
		);
		await wait(2200);
	},
	"openai",
);

const OPTS_SUCCEED: BridgeOptions = { script: "succeed" };
/** Signed in, with the backend's defaults receipt and "Change". */
export const PanelSucceededWithDefault = panelStory(
	OPTS_SUCCEED,
	/Sign in: Anthropic/,
	async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
		);
		await wait(3800);
	},
	"anthropic",
);

const OPTS_EXPIRE: BridgeOptions = { script: "expire" };
/** The link expired; Try again, and the API-key route is offered. */
export const PanelExpired = panelStory(
	OPTS_EXPIRE,
	/Sign in: Anthropic/,
	async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
		);
		await wait(3800);
	},
	"anthropic",
);

const OPTS_GONE: BridgeOptions = { script: "gone" };
/** The backend lost the operation (404): polling stopped, settled as expired. */
export const PanelGone404 = panelStory(
	OPTS_GONE,
	/Sign in: Anthropic/,
	async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
		);
		await wait(3800);
	},
	"anthropic",
);

const OPTS_FAIL: BridgeOptions = { script: "fail" };
/** Failed with the backend's own sentence. */
export const PanelFailed = panelStory(
	OPTS_FAIL,
	/Sign in: Anthropic/,
	async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
		);
		await wait(3800);
	},
	"anthropic",
);

/** The API key panel, idle. */
export const PanelApiKey = panelStory(
	{},
	/Add key: DeepSeek/,
	undefined,
	"deepseek",
);

const OPTS_KEY_REJECTED: BridgeOptions = { key: "rejected" };
/** A key the provider rejected: the backend's 422 sentence, inline. */
export const PanelInvalidKey = panelStory(
	OPTS_KEY_REJECTED,
	/Add key: DeepSeek/,
	async () => {
		await userEvent.type(
			await screen.findByLabelText("DeepSeek API key"),
			"sk-not-a-real-key",
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Save key" }),
		);
		await wait(600);
	},
	"deepseek",
);

const OPTS_KEY_OK: BridgeOptions = { key: "valid" };
/** A key accepted, with the defaults receipt. */
export const PanelKeySaved = panelStory(
	OPTS_KEY_OK,
	/Add key: DeepSeek/,
	async () => {
		await userEvent.type(
			await screen.findByLabelText("DeepSeek API key"),
			"sk-story",
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Save key" }),
		);
		await wait(600);
	},
	"deepseek",
);

const OPTS_KEY_UNCHECKED: BridgeOptions = { key: "unchecked" };
/** A key saved but not checked (`valid: null`), with the reason. */
export const PanelKeySavedUnchecked = panelStory(
	OPTS_KEY_UNCHECKED,
	/Add key: DeepSeek/,
	async () => {
		await userEvent.type(
			await screen.findByLabelText("DeepSeek API key"),
			"sk-story",
		);
		await userEvent.click(
			await screen.findByRole("button", { name: "Save key" }),
		);
		await wait(600);
	},
	"deepseek",
);

/** A local runtime: the probe runs on open. */
export const PanelLocal = panelStory(
	{},
	/Set up: Ollama/,
	async () => {
		await wait(600);
	},
	"ollama",
);

/* --------------------------------------------------------------- onboarding */

const OnboardingAt = ({ step }: { step: OnboardingStep }) => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(step);
	}, [step]);
	return <OnboardingModal open={true} />;
};

/** Step 1 of 3 on a first run: featured rows, no Continue, "Skip for now". */
export const OnboardingStep1: Story = {
	render: () => (
		<Bridge options={OPTS_FIRST_RUN}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.CONNECT_PROVIDER} />
			</div>
		</Bridge>
	),
};

const OPTS_ONE_CONNECTED: BridgeOptions = {
	providers: signedIn(["anthropic"]),
	hosting: "anthropic",
	model: "claude-opus-5-5",
};
/** Step 1 after a sign-in: the row moved to Connected, Continue appears. */
export const OnboardingStep1Connected: Story = {
	render: () => (
		<Bridge options={OPTS_ONE_CONNECTED}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.CONNECT_PROVIDER} />
			</div>
		</Bridge>
	),
};

/** Step 2 of 3 when the backend applied the default on sign-in. */
export const OnboardingStep2Applied: Story = {
	render: () => (
		<Bridge options={OPTS_ONE_CONNECTED}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.DEFAULT_MODEL} />
			</div>
		</Bridge>
	),
};

const OPTS_PROPOSED: BridgeOptions = { providers: signedIn(["anthropic"]) };
/** Step 2 on an older backend: nothing applied, the suggestion preselected. */
export const OnboardingStep2Proposed: Story = {
	render: () => (
		<Bridge options={OPTS_PROPOSED}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.DEFAULT_MODEL} />
			</div>
		</Bridge>
	),
};

/** Step 3 of 3: name and web search, both optional. */
export const OnboardingStep3: Story = {
	render: () => (
		<Bridge options={OPTS_ONE_CONNECTED}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.EXTRAS} />
			</div>
		</Bridge>
	),
};

/** The step-2 summary in its "choose" answer (no suggestion from the backend). */
export const OnboardingStep2Summaries: Story = {
	render: () => (
		<div
			className="flex min-h-screen flex-col gap-6 bg-elevated p-8"
			style={{ width: 560 }}
		>
			<DefaultModelSummary
				choice={{
					kind: "proposed",
					provider: CENSUS[1],
					model: SUGGESTIONS.anthropic,
				}}
				onChange={() => undefined}
			/>
			<DefaultModelSummary
				choice={{ kind: "none" }}
				onChange={() => undefined}
			/>
		</div>
	),
};

/* ----------------------------------------------------------- discoverability */

/** The empty-chat card, alone at the chat measure. */
export const EmptyChatCard: Story = {
	render: () => (
		<div className="flex min-h-screen items-center justify-center bg-canvas p-8">
			<div style={{ width: 720 }}>
				<ConnectProviderCard />
			</div>
		</div>
	),
};

const DialogOpener = () => {
	useLayoutEffect(() => {
		useConnectProviderStore.getState().openConnect();
		return () => useConnectProviderStore.getState().closeConnect();
	}, []);
	return <ConnectProviderDialog />;
};
/** The card's action: the connect dialog over the chat. */
export const ConnectDialog: Story = {
	render: () => (
		<Bridge options={OPTS_FIRST_RUN}>
			<div className="h-screen bg-canvas">
				<DialogOpener />
			</div>
		</Bridge>
	),
};
