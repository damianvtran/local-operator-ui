/** Mount the production modal, isolating transport and step bodies; no layout claim. */
import assert from "node:assert/strict";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost",
});
for (const key of [
	"window",
	"document",
	"Element",
	"HTMLElement",
	"Node",
	"MutationObserver",
	"CustomEvent",
	"Event",
	"MouseEvent",
])
	globalThis[key] = dom.window[key];
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const PORTS =
	/use-aida-target$|open-conversation$|desktop-hooks$|first-time-user$|react-router-dom$|onboarding-store$|steps\/(connect-provider-step|default-model-step|search-api-step|meet-aida-step)$|onboarding-dialog$/;
const ALL = /.*/;
const built = await build({
	stdin: {
		contents: `
        export { OnboardingModal } from './src/renderer/src/features/onboarding/components/onboarding-modal';
        export { t, setLocale, registerCatalogue } from './src/i18n';
        export * as React from 'react';
        export { createRoot } from 'react-dom/client';
    `,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "browser",
	write: false,
	jsx: "automatic",
	define: { "import.meta.env": "{}" },
	alias: {
		"@shared": `${process.cwd()}/src/renderer/src/shared`,
		"@features": `${process.cwd()}/src/renderer/src/features`,
	},
	loader: {
		".css": "empty",
		".svg": "empty",
		".png": "empty",
		".webp": "empty",
	},
	plugins: [
		{
			name: "onboarding-ports",
			setup(builder) {
				builder.onResolve({ filter: PORTS }, ({ path, importer }) =>
					importer.endsWith("onboarding-modal.tsx")
						? { path, namespace: "port" }
						: null,
				);
				builder.onLoad({ filter: ALL, namespace: "port" }, ({ path }) => {
					let contents;
					if (path.endsWith("use-aida-target"))
						contents =
							"export const useAidaTarget = () => ({}); export const useAidaControl = () => ({});";
					else if (path.endsWith("open-conversation"))
						contents = "export const openConversation = () => {};";
					else if (path.endsWith("desktop-hooks"))
						contents =
							"export const useDesktopCapabilities = () => ({data: {}}); export const desktopFeatureEnabled = () => false; export const useDesktopProviders = () => ({data: []});";
					else if (path.endsWith("first-time-user"))
						contents = "export const hasConnectedProvider = () => false;";
					else if (path === "react-router-dom")
						contents = "export const useNavigate = () => () => {};";
					else if (path.endsWith("onboarding-store"))
						/* The real enum's VALUES: `onboarding-sequence.ts` imports the real store, so
						   the port and the sequence must agree on what a step is called. */
						contents = `export const OnboardingStep = {CONNECT_PROVIDER: 'connect_provider', DEFAULT_MODEL: 'default_model', SEARCH: 'search', MEET: 'meet'}; const state = {currentStep: OnboardingStep.CONNECT_PROVIDER, setCurrentStep() {}, completeModalOnboarding() {}}; export const useOnboardingStore = () => state;`;
					else if (path.endsWith("onboarding-dialog"))
						contents = `import React from 'react'; export const OnboardingStage = ({title, stepIndicators, children}) => <section><h1>{title}</h1>{stepIndicators}{children}</section>;`;
					else
						contents =
							"export const ConnectProviderStep = () => null; export const DefaultModelStep = () => null; export const SearchApiStep = () => null; export const connectedSubscriptionBrands = () => []; export const stageConnected = () => false; export const meetAidaCopy = (name) => ({ title: name, subtitle: '' });";
					return { contents, loader: "tsx", resolveDir: process.cwd() };
				});
			},
		},
	],
});
const { React, createRoot, OnboardingModal, t, setLocale, registerCatalogue } =
	await import(
		`data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
	);
after(() => {
	dom.window.close();
	for (const handle of process._getActiveHandles?.() ?? [])
		if (handle?.constructor?.name === "MessagePort") handle.close();
});
test("onboarding title, track names and progress follow a locale switch without changing step", async () => {
	setLocale("en");
	registerCatalogue("fr", {
		"ui.onboarding.modal.title.connect_provider": "TITLE-FR",
		// The stage's heading on step 1 is the sign-in title; the track keeps the
		// step's own name. Both must follow the switch.
		"ui.onboarding.signin.title": "SIGNIN-FR",
		"ui.onboarding.modal.step_of": "STEP-FR {current}/{total}",
	});
	const host = document.createElement("div");
	document.body.append(host);
	const root = createRoot(host);
	try {
		await React.act(async () =>
			root.render(React.createElement(OnboardingModal, { open: true })),
		);
		assert.equal(
			host.querySelector("h1").textContent,
			t("ui.onboarding.signin.title"),
		);
		assert.ok(
			host.textContent.includes(
				t("ui.onboarding.modal.step_of", { current: 1, total: 3 }),
			),
		);
		await React.act(async () => setLocale("fr"));
		assert.equal(
			host.querySelector("h1").textContent,
			"SIGNIN-FR",
			"cached title must invalidate",
		);
		assert.ok(
			host.textContent.includes("STEP-FR 1/3"),
			"cached progress must invalidate",
		);
		assert.ok(
			[...host.querySelectorAll("button[aria-label]")].some((button) =>
				button.getAttribute("aria-label").includes("TITLE-FR"),
			),
			"progress accessible name must follow the same title",
		);
	} finally {
		await React.act(async () => root.unmount());
		host.remove();
		setLocale("en");
	}
});
