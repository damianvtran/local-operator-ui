/**
 * Onboarding step 1, "Connect a provider", and the Settings section that
 * renders the same grid.
 *
 * ## Why this file exists
 *
 * No story rendered `ProviderGrid` before it, and the two surfaces that own this
 * screen had no picture of it: the committed `onboarding-onboardingmodal/default`
 * frames date from the Tailwind v4 landing (#77) and paint the "Choose your
 * setup" two-gate screen that bb57a4080 replaced with the registry grid. A frame
 * of a screen that no longer exists cannot be used to judge the one that does.
 *
 * ## What is real here, and what is a fixture
 *
 * The component is the production one, driven through its production data path.
 * `ProviderGrid` reads the census through `useDesktopProviders`, which issues the
 * `providers.list` desktop op through `desktopRequest`, which prefers
 * `window.api.desktop.request` -- the preload bridge. That is what this file
 * stubs, exactly as `mcp-management-section.stories.tsx` stubs it, so the real
 * query, the real hook, the real search and the real card composition all run.
 * Storybook has no backend, so without the stub every frame would photograph a
 * transport error instead of the grid.
 *
 * The ROWS are a fixture shaped like the wire, and they are a FIRST-RUN machine's
 * census: no credential is stored and no environment key is set, which is the
 * machine this step exists for. They are a transcription rather than an
 * invention -- the census rule in `local_operator/server/routes/auth.py::providers`
 * replayed over `local_operator/providers/registry.py`, so the ORDER is the
 * registry's own (Radient is 15th of 18) and the method labels are the registry's
 * own names. A registry entry `p` becomes one census row when
 * `credential_provider_id(p.id) == p.id` and `p.wire != "mock"`, and its
 * `auth_methods` are every entry that stores under the same id -- which is why
 * `radient-key` is a METHOD of the `radient` row rather than a row of its own: it
 * declares `store_credentials_as="radient"`. Re-derive with:
 *
 *     cd ~/local-operator && .venv/bin/python -c "
 *     from local_operator.providers.registry import (
 *         PROVIDER_REGISTRY, credential_provider_id)
 *     for p in PROVIDER_REGISTRY:
 *         if credential_provider_id(p.id) != p.id or p.wire == 'mock':
 *             continue
 *         print(p.id, p.name, [m.id for m in PROVIDER_REGISTRY
 *               if credential_provider_id(m.id) == p.id and m.login])"
 *
 * What these frames do NOT establish: that the shipped backend serves this
 * census, and whether a real sign-in completes. Both are QA's job against a real
 * app, not a frame's.
 *
 * ## The readout strip
 *
 * Every story prints the geometry it is evidence FOR -- container width, the
 * resolved column count, a card's measured width, and any scroll a container
 * carries -- because a still shows the symptom and the numbers show the cause.
 * The strip is the story's, not the product's: it is `fixed` and reads the DOM on
 * an interval, like the readouts in `chat-sidebar-status-feed.stories.tsx`.
 */

import { ProviderGrid } from "@features/providers/provider-grid";
import { SettingsSection } from "@features/settings/components/settings-section";
import { cn } from "@shared/lib/utils";
import {
	OnboardingStep,
	useOnboardingStore,
} from "@shared/store/onboarding-store";
import type { Meta, StoryObj } from "@storybook/react";
import { screen, userEvent } from "@storybook/test";
import { Plug } from "lucide-react";
import { useEffect, useLayoutEffect, useState } from "react";
import type { ReactNode } from "react";
import type {
	DesktopProvider,
	DesktopResponse,
} from "../../../../../shared/desktop-contract";
import { OnboardingModal } from "./onboarding-modal";

/**
 * The search field's accessible name, spelled once.
 *
 * The stories below type into the field by this label, so a story that renamed
 * it would fail loudly rather than type into nothing.
 */
const SEARCH_LABEL = "Search providers";

/* --------------------------------------------------------------- bridge */

type BridgeRequest = { op: string };

/**
 * The desktop transport, stubbed for the render that is on screen.
 *
 * Installed in a layout effect and restored on unmount, rather than at module
 * scope. `mcp-management-section.stories.tsx` installs its own dispatcher when
 * its module loads, and every story module in a Storybook bundle is loaded once,
 * so a second module-scope install would overwrite whichever ran first and break
 * the other file's stories. Installing per render keeps the two independent
 * while the canvas holds one story at a time.
 */
const installBridge = (providers: DesktopProvider[]) => {
	const bridge = async (request: BridgeRequest): Promise<DesktopResponse> => {
		const ok = (result: unknown): DesktopResponse => ({
			status: 200,
			body: { result },
		});
		switch (request.op) {
			case "capabilities":
				return ok({
					desktop_contract: 1,
					desktop_available: true,
					desktop_auth: "bearer",
					features: { auth: 1 },
				});
			case "providers.list":
				return ok({ providers });
			default:
				// Naming the op that was not answered turns a story that starts
				// issuing a new read into a loud failure instead of a frame that
				// quietly photographs a spinner.
				throw new Error(`unexpected desktop op in this story: ${request.op}`);
		}
	};
	const page = window as unknown as {
		api?: {
			desktop?:
				| { request: (r: BridgeRequest) => Promise<DesktopResponse> }
				| undefined;
		};
	};
	const api = page.api ?? {};
	page.api = api;
	const previous = api.desktop;
	api.desktop = { request: bridge };
	return () => {
		/*
		 * Assigned rather than deleted: this tree lints `delete` as a performance
		 * hazard, and an undefined entry is what `desktopRequest`'s own
		 * `if (window.api?.desktop)` test reads anyway.
		 */
		api.desktop = previous;
	};
};

/** The census served for as long as the story that asks for it is up. */
const Census = ({
	providers = CENSUS,
	children,
}: {
	providers?: DesktopProvider[];
	children: ReactNode;
}): ReactNode => {
	useLayoutEffect(() => installBridge(providers), [providers]);
	return children;
};

/* ----------------------------------------------------------------- census */

/**
 * A first-run machine's census, in the wire's own field names
 * (`credential_optional`, `stored_credentials`), because the grid reads the
 * wire's words -- a fixture that renamed them would photograph a state the real
 * backend cannot produce. See this file's header for how it was derived.
 */
const CENSUS: DesktopProvider[] = [
	{
		id: "openai",
		name: "OpenAI (ChatGPT Plus/Pro)",
		storage_id: "openai",
		search_aliases: ["gpt", "chatgpt", "codex"],
		auth_methods: [
			{
				id: "openai",
				method_id: "openai",
				label: "OpenAI (ChatGPT Plus/Pro)",
				kind: "browser",
				requires_secret_input: false,
				paste_fallback: false,
			},
			{
				id: "openai-device",
				method_id: "openai-device",
				label: "OpenAI (ChatGPT device code)",
				kind: "device",
				requires_secret_input: false,
				paste_fallback: false,
			},
			{
				id: "openai",
				method_id: "openai:api-key",
				label: "API key",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.openai.com/v1",
	},
	{
		id: "anthropic",
		name: "Anthropic (Claude Pro/Max)",
		storage_id: "anthropic",
		search_aliases: ["claude", "sonnet", "opus", "haiku"],
		auth_methods: [
			{
				id: "anthropic",
				method_id: "anthropic",
				label: "Anthropic (Claude Pro/Max)",
				kind: "browser",
				requires_secret_input: false,
				paste_fallback: true,
			},
			{
				id: "anthropic",
				method_id: "anthropic:api-key",
				label: "API key",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.anthropic.com",
	},
	{
		id: "kimi",
		name: "Kimi (Moonshot)",
		storage_id: "kimi",
		search_aliases: ["moonshot", "k2", "k3"],
		auth_methods: [
			{
				id: "kimi",
				method_id: "kimi",
				label: "Kimi (Moonshot)",
				kind: "device",
				requires_secret_input: false,
				paste_fallback: false,
			},
			{
				id: "kimi",
				method_id: "kimi:api-key",
				label: "API key",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.moonshot.cn/v1",
	},
	{
		id: "xai",
		name: "xAI (Grok API key)",
		storage_id: "xai",
		search_aliases: ["grok"],
		auth_methods: [
			{
				id: "xai",
				method_id: "xai",
				label: "xAI (Grok API key)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
			{
				id: "xai-oauth",
				method_id: "xai-oauth",
				label: "xAI (Grok OAuth)",
				kind: "device",
				requires_secret_input: false,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.x.ai/v1",
	},
	{
		id: "deepseek",
		name: "DeepSeek",
		storage_id: "deepseek",
		search_aliases: ["ds"],
		auth_methods: [
			{
				id: "deepseek",
				method_id: "deepseek",
				label: "DeepSeek",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.deepseek.com/v1",
	},
	{
		id: "zai",
		name: "Z.AI (GLM API key)",
		storage_id: "zai",
		search_aliases: ["glm", "zhipu", "bigmodel", "z-ai"],
		auth_methods: [
			{
				id: "zai",
				method_id: "zai",
				label: "Z.AI (GLM API key)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
			{
				id: "zai-oauth",
				method_id: "zai-oauth",
				label: "Z.AI (GLM browser sign-in)",
				kind: "browser",
				requires_secret_input: false,
				paste_fallback: true,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.z.ai/api/coding/paas/v4",
	},
	{
		id: "google",
		name: "Google (Gemini)",
		storage_id: "google",
		search_aliases: ["gemini", "vertex", "aistudio"],
		auth_methods: [
			{
				id: "google",
				method_id: "google",
				label: "Google (Gemini)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://generativelanguage.googleapis.com",
	},
	{
		id: "mistral",
		name: "Mistral AI",
		storage_id: "mistral",
		search_aliases: ["codestral", "magistral"],
		auth_methods: [
			{
				id: "mistral",
				method_id: "mistral",
				label: "Mistral AI",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.mistral.ai/v1",
	},
	{
		id: "lmstudio",
		name: "LM Studio",
		storage_id: "lmstudio",
		search_aliases: ["local", "self-hosted"],
		auth_methods: [],
		local: true,
		configured: true,
		credential_optional: true,
		has_credential: false,
		stored_credentials: 0,
		base_url: "http://localhost:1234/v1",
	},
	{
		id: "ollama",
		name: "Ollama",
		storage_id: "ollama",
		search_aliases: ["local", "self-hosted"],
		auth_methods: [],
		local: true,
		configured: true,
		credential_optional: true,
		has_credential: false,
		stored_credentials: 0,
		base_url: "http://localhost:11434/v1",
	},
	{
		id: "vllm",
		name: "vLLM",
		storage_id: "vllm",
		search_aliases: ["local", "self-hosted"],
		auth_methods: [],
		local: true,
		configured: true,
		credential_optional: true,
		has_credential: false,
		stored_credentials: 0,
		base_url: "http://localhost:8000/v1",
	},
	{
		id: "llamacpp",
		name: "llama.cpp",
		storage_id: "llamacpp",
		search_aliases: ["local", "self-hosted"],
		auth_methods: [],
		local: true,
		configured: true,
		credential_optional: true,
		has_credential: false,
		stored_credentials: 0,
		base_url: "http://localhost:8080/v1",
	},
	{
		id: "openai-compatible",
		name: "OpenAI-compatible",
		storage_id: "openai-compatible",
		search_aliases: ["local", "self-hosted"],
		auth_methods: [],
		local: true,
		configured: true,
		credential_optional: true,
		has_credential: false,
		stored_credentials: 0,
		base_url: "",
	},
	{
		id: "openrouter",
		name: "OpenRouter",
		storage_id: "openrouter",
		search_aliases: ["or", "router"],
		auth_methods: [
			{
				id: "openrouter",
				method_id: "openrouter",
				label: "OpenRouter",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://openrouter.ai/api/v1",
	},
	{
		id: "radient",
		name: "Radient",
		storage_id: "radient",
		search_aliases: ["radient-oauth"],
		auth_methods: [
			{
				id: "radient",
				method_id: "radient",
				label: "Radient",
				kind: "browser",
				requires_secret_input: false,
				paste_fallback: false,
			},
			{
				id: "radient-key",
				method_id: "radient-key",
				label: "Radient (API key)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.radienthq.com/v1",
	},
	{
		id: "alibaba",
		name: "Alibaba Cloud (Qwen)",
		storage_id: "alibaba",
		search_aliases: ["qwen", "dashscope", "tongyi"],
		auth_methods: [
			{
				id: "alibaba",
				method_id: "alibaba",
				label: "Alibaba Cloud (Qwen)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://dashscope-intl.aliyuncs.com/compatible-mode/v1",
	},
	{
		id: "alibaba-token-plan",
		name: "QwenCloud Token Plan",
		storage_id: "alibaba-token-plan",
		search_aliases: ["token-plan", "tokenplan", "qwencloud"],
		auth_methods: [
			{
				id: "alibaba-token-plan",
				method_id: "alibaba-token-plan",
				label: "QwenCloud Token Plan",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
			{
				id: "alibaba-token-plan-oauth",
				method_id: "alibaba-token-plan-oauth",
				label: "QwenCloud Token Plan (usage OAuth)",
				kind: "device",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url:
			"https://token-plan.ap-southeast-1.maas.aliyuncs.com/compatible-mode/v1",
	},
	{
		id: "typesafe",
		name: "TypeSafe (Jev)",
		storage_id: "typesafe",
		search_aliases: ["jev", "typesafe-jev"],
		auth_methods: [
			{
				id: "typesafe",
				method_id: "typesafe",
				label: "TypeSafe (Jev)",
				kind: "api_key",
				requires_secret_input: true,
				paste_fallback: false,
			},
		],
		local: false,
		configured: false,
		credential_optional: false,
		has_credential: false,
		stored_credentials: 0,
		base_url: "https://api.typesafe.ai/v1",
	},
];

/* --------------------------------------------------------------- readout */

/** One measured thing: what to call it, and what to ask the DOM for. */
type Probe = { label: string; selector: string };

const round1 = (value: number) => Math.round(value * 10) / 10;

/**
 * What one selector resolves to right now, as the compact facts a reviewer
 * needs to explain the still: the box, any scroll the container carries, and --
 * for a grid -- the columns the browser resolved and a card's measured width.
 *
 * An overflow is printed only when there IS one, so a container that shows
 * nothing is reported as a bare box: the caption has to fit the narrowest frame
 * in the set (800px) without being clipped, and a pair of zeroes on every probe
 * is the expensive way to say "nothing to report".  Measurements are in px.
 */
const describe = ({ label, selector }: Probe): string => {
	const element = document.querySelector(selector);
	if (!element) return `${label} absent`;
	const rect = element.getBoundingClientRect();
	const style = getComputedStyle(element);
	const horizontal = element.scrollWidth - element.clientWidth;
	const vertical = element.scrollHeight - element.clientHeight;
	const box = [`${label} ${round1(rect.width)}x${round1(rect.height)}`];
	const over = [
		horizontal > 1 ? `h${round1(horizontal)}` : "",
		vertical > 1 ? `v${round1(vertical)}` : "",
	].filter(Boolean);
	if (over.length > 0) box.push(`(${over.join(" ")})`);
	if (style.display === "grid") {
		const columns = style.gridTemplateColumns.split(" ").filter(Boolean).length;
		const card = element.querySelector("li > button");
		box.push(
			`${columns === 1 ? "1 col" : `${columns} cols`}${
				card ? `, card ${round1(card.getBoundingClientRect().width)}` : ""
			}`,
		);
	}
	return box.join(" | ");
};

/**
 * The strip, pinned to the frame's foot and re-read on the DOCUMENT's
 * mutations.
 *
 * Mutations rather than an interval, and the difference was measured rather than
 * preferred: the grid arrives a frame after the query resolves, so a poll can
 * photograph the caption the page had before it did -- which happened, and the
 * frame that should have carried `grid 912x...` carried `grid: absent` over a
 * picture of the grid itself. The arrival of the cards IS a mutation, so watching
 * for one is the instrument that cannot miss it; the guard in `measure` (a state
 * write only when the sentence CHANGED) is what stops the readout's own text from
 * driving it round again.
 */
const Readout = ({ probes }: { probes: Probe[] }): ReactNode => {
	const [text, setText] = useState("measuring");
	useEffect(() => {
		const measure = () => {
			const next = probes.map(describe).join("   |   ");
			setText((current) => (current === next ? current : next));
		};
		measure();
		const observer = new MutationObserver(measure);
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			attributes: true,
		});
		return () => observer.disconnect();
	}, [probes]);
	return (
		<div
			className={cn(
				"fixed inset-x-0 bottom-0 z-[60] truncate border-hairline border-t",
				"bg-canvas px-3 py-1 font-mono text-ink-muted text-meta",
			)}
		>
			{text}
		</div>
	);
};

/* ------------------------------------------------------------------ frame */

const GRID_PROBES: Probe[] = [
	{ label: "grid", selector: "[data-provider-grid]" },
];

/**
 * The dialog is `max-h-[calc(100vh-4rem)]`, so both of its probes matter: the
 * panel's own width is the change this set exists for, and the body's scroll is
 * where a wider grid could start overflowing instead of wrapping.
 */
const DIALOG_PROBES: Probe[] = [
	{ label: "dialog", selector: "[role=dialog]" },
	/*
	 * The dialog's scrolling body, which is the box the grid is actually handed:
	 * the panel's width minus its own padding, minus whatever a scrollbar takes.
	 * `nth-of-type(2)` is the body between the header and the actions, and it is
	 * what `onboarding-dialog.tsx` renders there.
	 */
	{ label: "body", selector: "[role=dialog] > div:nth-of-type(2)" },
	{ label: "grid", selector: "[data-provider-grid]" },
];

/**
 * A column of the given width on the canvas ground: how the Settings column is
 * reproduced without the surrounding app.
 */
const Column = ({
	width,
	children,
}: {
	width: number;
	children: ReactNode;
}): ReactNode => (
	<div className="flex min-h-screen justify-center bg-canvas p-8">
		<div className="min-w-0" style={{ width }}>
			{children}
		</div>
	</div>
);

/* ---------------------------------------------------------------- stories */

/*
 * The width is an ARG rather than a hardcoded frame because the two surfaces
 * that render this grid measure differently, and the difference is the subject
 * of the change: Settings caps its column at 896px (`max-w-4xl`), while
 * onboarding step 1 now gets a dialog measure of its own.
 */
type StoryArgs = { width: number };

const meta: Meta<StoryArgs> = {
	title: "Onboarding/ProviderSetup",
	parameters: { layout: "fullscreen" },
	args: { width: 896 },
};

export default meta;
type Story = StoryObj<StoryArgs>;

/**
 * The grid in the Settings column: `max-w-4xl` (896px) inside the settings
 * content area's own `p-8` at a default-size window, wrapped in the same
 * `SettingsSection` the page renders, so the frame carries the container the
 * section actually hands it.
 */
export const SettingsColumn: Story = {
	render: ({ width }) => (
		<Census>
			<Column width={width}>
				<SettingsSection
					title="Providers"
					icon={Plug}
					description="Model providers, how you sign in to each, and which are connected."
				>
					<ProviderGrid />
				</SettingsSection>
			</Column>
			<Readout probes={GRID_PROBES} />
		</Census>
	),
};

/** A query with matches: every row that names the term. */
export const SearchActive: Story = {
	render: ({ width }) => (
		<Census>
			<Column width={width}>
				<ProviderGrid />
			</Column>
			<Readout probes={GRID_PROBES} />
		</Census>
	),
	play: async () => {
		const field = await screen.findByLabelText(SEARCH_LABEL);
		await userEvent.type(field, "cloud");
		await screen.findByText("QwenCloud Token Plan");
	},
};

/** A query with no matches: the empty state and its own way back. */
export const SearchNoResults: Story = {
	render: ({ width }) => (
		<Census>
			<Column width={width}>
				<ProviderGrid />
			</Column>
			<Readout probes={GRID_PROBES} />
		</Census>
	),
	play: async () => {
		const field = await screen.findByLabelText(SEARCH_LABEL);
		await userEvent.type(field, "zzz");
		await screen.findByText("No providers match this search.");
	},
};

/**
 * The thinnest container the layout has to hold: one column, nothing clipped.
 *
 * 512 is below every width the app can produce -- its window floor is 800x600,
 * where this grid resolves to two columns -- and it is here because a layout
 * whose narrowest state has never been looked at is a layout nobody has seen
 * fail.
 */
export const NarrowColumn: Story = {
	render: () => (
		<Census>
			<Column width={512}>
				<ProviderGrid />
			</Column>
			<Readout probes={GRID_PROBES} />
		</Census>
	),
};

/**
 * A census SHORTER than the threshold the search field used to be gated on.
 *
 * The five rows are the registry's own first five, so only the LENGTH here is
 * synthetic -- and it has to be, because the gate's condition is unreachable at
 * the 18 rows the shipped census serves: a frame of the state it guarded
 * against is a frame no backend can produce today. That is also the argument for
 * dropping the gate rather than keeping it (see the note in `provider-grid.tsx`),
 * and this story is the picture of the difference it makes.
 */
export const ShortRegistry: Story = {
	render: ({ width }) => (
		<Census providers={CENSUS.slice(0, 5)}>
			<Column width={width}>
				<ProviderGrid />
			</Column>
			<Readout probes={GRID_PROBES} />
		</Census>
	),
};

/**
 * Step 1 in the flow's own dialog, on a default-size window (captured at
 * 1280x900) and on the narrowest window the app runs at (800x600).
 *
 * The dialog is `w-full`, so at 800 the grid's container is 752px and the layout
 * has to give up its third column -- the state this change must degrade into
 * rather than overflow.
 */
export const InDialog: Story = {
	render: () => (
		<Census>
			<OnboardingDialogFrame />
			<Readout probes={DIALOG_PROBES} />
		</Census>
	),
	play: async () => {
		await screen.findByLabelText(SEARCH_LABEL);
	},
};

/**
 * The dialog at step 1, with the store parked on that step.
 *
 * `resetOnboarding` then `setCurrentStep`, the same pair
 * `onboarding-modal.stories.tsx` uses: the flow persists its step, so a story
 * that only set the step could be photographed on whichever step the last story
 * left behind.
 */
const OnboardingDialogFrame = (): ReactNode => {
	useLayoutEffect(() => {
		const state = useOnboardingStore.getState();
		state.resetOnboarding();
		state.setCurrentStep(OnboardingStep.CONNECT_PROVIDER);
	}, []);
	return <OnboardingModal open={true} />;
};
