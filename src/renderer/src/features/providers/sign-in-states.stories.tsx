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
import { screen, userEvent, waitFor } from "@storybook/test";
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
	| "gone"
	/**
	 * A flow that needs a paste BEFORE it has any URL at all: QwenCloud's Token
	 * Plan asks for the key first (QA round 1 Q2).
	 */
	| "paste-before-url"
	/** Waiting, on the newer backend, where `launch_url` is the loopback alias. */
	| "launch-url-waiting"
	/** Another window started a sign-in: this one ends cancelled, not failed. */
	| "superseded";

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

/** The scripts whose state is settled from the start reply. */
const TERMINAL_SCRIPTS = new Set<Script>([
	"succeed",
	"expire",
	"fail",
	"gone",
	"superseded",
]);

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
			case "paste-before-url":
				/*
				 * No `auth_url` at all: the panel has to show the field, because the
				 * field IS how this flow proceeds (QA round 1 Q2).
				 */
				return ok(
					snapshot("input_required", {
						auth_url: null,
						input_required: true,
						input_optional: false,
						prompt_id: "token-plan",
					}),
				);
			case "launch-url-waiting":
				/*
				 * What every callback flow on the newer backend reports: `auth_url` is
				 * the provider's page and `launch_url` is the loopback alias of it. A
				 * panel that prefers `launch_url` for the host names `localhost:54549`
				 * as the provider (code round 1 M1).
				 */
				return ok(
					snapshot("waiting", {
						auth_url: AUTH_URL,
						launch_url: "http://localhost:54549/launch",
					}),
				);
			case "superseded":
				/*
				 * The supersede the backend reports when another window starts a
				 * sign-in: cancelled, in its own words, which is a NEUTRAL state and
				 * not a failure (the panel renders it as such).
				 */
				return ok(
					snapshot("cancelled", {
						message: "Replaced by a new sign-in.",
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
				return {
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
					/*
					 * The TERMINAL states start already settled. They used to arrive on
					 * a later poll, which made every capture of them a race with the
					 * shutter: the frames that shipped were the waiting panel under
					 * four names (M3/D1/Q8). What each terminal state LOOKS like is
					 * this story's subject; how it arrives is the unit tests'.
					 */
					if (TERMINAL_SCRIPTS.has(script)) return statusFor();
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
	/*
	 * The title is also the EVIDENCE DIRECTORY: `capture-evidence.mjs` writes a
	 * set's frames to `docs/evidence/<title kebab>/<state>/<theme>.webp`, so this
	 * title is what puts them under `docs/evidence/provider-sign-in-onboarding/`
	 * (hyphenated `sign-in`, nothing else kebabifies to this directory). Renaming
	 * the title moves the frames, which is the one thing to know before touching
	 * this line.
	 */
	title: "Provider sign-in onboarding",
	parameters: { layout: "fullscreen" },
};
export default meta;
type Story = StoryObj;

const openRow = async (name: RegExp) => {
	await userEvent.click(await screen.findByRole("button", { name }));
};
const wait = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Wait for the panel to REACH a state, rather than for the clock to pass.
 *
 * The terminal stories' plays used a fixed 3800ms sleep and the rig shoots when
 * the play resolves, so four terminal frames were committed 900ms into a state
 * that arrives about 1.5s later: succeeded / expired / gone-404 / failed shipped
 * as four copies of the waiting panel (code round 1 M3, design round 1 D1).
 * Waiting on the attribute is what makes the frame a photograph of the state it
 * names, and `expectPresent` in `scripts/capture-evidence.mjs` is the rig's own
 * half of the same claim.
 */
/**
 * Press the flow's start button only when the panel is IDLE, then wait for the
 * state the frame claims.
 *
 * WHY THE GUARD: Storybook re-runs a story's play when the frame around it
 * changes -- and the capture rig changes the theme between the two frames it
 * takes of every state. A play that pressed unconditionally therefore started a
 * SECOND sign-in on the theme switch, so the shot showed "Opening your browser"
 * while the state the story is named for had already been reached and thrown
 * away: four terminal rows shipped as copies of the waiting panel for exactly
 * this reason, on top of the too-short sleep (code round 1 M3, design round 1
 * D1, QA round 1 Q8). Pressing from idle makes the play idempotent, so the
 * second pass leaves the settled frame alone.
 */
const startIfIdle = async (state: string) => {
	if (document.querySelector('[data-sign-in-state="idle"]') !== null) {
		await userEvent.click(
			await screen.findByRole("button", { name: CONTINUE_IN_BROWSER }),
		);
	}
	await waitForState(state);
};

const waitForState = async (state: string, timeout = 15000) => {
	await waitFor(
		() => {
			if (document.querySelector(`[data-sign-in-state="${state}"]`) === null) {
				throw new Error(`the panel never reached ${state}`);
			}
		},
		{ timeout },
	);
};

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

/*
 * The Token Plan's DEVICE method on its own: it is the one that asks for a paste
 * before it has any URL, and leaving the key method off the row removes a tab
 * click from the play (a step that raced the tab list in one theme).
 */
const OPTS_PASTE_BEFORE_URL: BridgeOptions = {
	script: "paste-before-url",
	providers: CENSUS.filter((row) => row.id === "alibaba-token-plan").map(
		(row) => ({
			...row,
			auth_methods: row.auth_methods.filter((m) => m.kind === "device"),
		}),
	),
};
/**
 * The paste IS the flow and there is no URL yet: the field renders instead of a
 * spinner, which is what a released backend's Token Plan sign-in needs (Q2).
 */
export const PanelPasteRequiredNoUrl = panelStory(
	OPTS_PASTE_BEFORE_URL,
	/Sign in: QwenCloud/,
	async () => {
		await userEvent.click(
			await screen.findByRole("button", { name: /Get a sign-in code/ }),
		);
		await wait(2200);
	},
	"alibaba-token-plan",
);

const OPTS_LAUNCH_URL: BridgeOptions = { script: "launch-url-waiting" };
/**
 * Waiting with `launch_url` set: the sentence names the PROVIDER, never the
 * loopback alias the backend uses for its own callback (code round 1 M1, UX N2).
 */
export const PanelWaitingLaunchUrl = panelStory(
	OPTS_LAUNCH_URL,
	/Sign in: Anthropic/,
	clickContinue,
	"anthropic",
);

const OPTS_SUPERSEDED: BridgeOptions = { script: "superseded" };
/** Superseded by another sign-in: cancelled, with the backend's own sentence. */
export const PanelCancelledSuperseded = panelStory(
	OPTS_SUPERSEDED,
	/Sign in: Anthropic/,
	async () => {
		await startIfIdle("unfinished");
	},
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
		await startIfIdle("succeeded");
	},
	"anthropic",
);

const OPTS_EXPIRE: BridgeOptions = { script: "expire" };
/** The link expired; Try again, and the API-key route is offered. */
export const PanelExpired = panelStory(
	OPTS_EXPIRE,
	/Sign in: Anthropic/,
	async () => {
		await startIfIdle("unfinished");
	},
	"anthropic",
);

const OPTS_GONE: BridgeOptions = { script: "gone" };
/** The backend lost the operation (404): polling stopped, settled as expired. */
export const PanelGone404 = panelStory(
	OPTS_GONE,
	/Sign in: Anthropic/,
	async () => {
		await startIfIdle("unfinished");
	},
	"anthropic",
);

const OPTS_FAIL: BridgeOptions = { script: "fail" };
/** Failed with the backend's own sentence. */
export const PanelFailed = panelStory(
	OPTS_FAIL,
	/Sign in: Anthropic/,
	async () => {
		await startIfIdle("unfinished");
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
/*
 * The CURRENT-user path, not the new-backend one: a released backend sends no
 * `suggested_model` and applies no defaults on sign-in, so the step has nothing
 * to confirm and must ASK -- and the provider it displays is the one Continue has
 * to write (code round 1 M2, QA round 1 Q3, UX round 1 U1).
 */
const OPTS_CHOOSE: BridgeOptions = {
	providers: signedIn(["openrouter"]).map((row) => ({
		...row,
		suggested_model: null,
	})),
};
/** Step 2 on a released backend: nothing applied, nothing suggested, pick it. */
export const OnboardingStep2Choose: Story = {
	render: () => (
		<Bridge options={OPTS_CHOOSE}>
			<div className="h-screen bg-canvas">
				<OnboardingAt step={OnboardingStep.DEFAULT_MODEL} />
			</div>
		</Bridge>
	),
};
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
