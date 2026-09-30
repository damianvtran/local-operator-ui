import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * THE PANEL THAT COMES BACK AFTER A SUCCESS, RENDERED — because that is the only
 * thing that could have caught this.
 *
 * `sign-in-sessions.ts` keeps a settled state outside the panel precisely so the
 * row's move into "Connected" cannot destroy it. The panel then threw it away
 * anyway: `useEffect(() => { flowHandle.reset(); … }, [provider.id])` runs on
 * every MOUNT, and the row's move remounts it, so the receipt rendered for 39-270
 * ms and vanished (QA round 2 R2-Q1, UX round 2 U3, both reproduced by deleting
 * only the `reset()` line). Every test this file's siblings held passed, because
 * they assert the SESSION's rules and never render the component that consults
 * them — the gap the whole file exists to close.
 *
 * What it pins:
 *   1. after a completed sign-in the panel shows the success state, and
 *   2. it STILL shows it after a remount with the same provider (the row move),
 *   3. while a mount with a DIFFERENT provider still starts clean — the reset the
 *      effect was written for is kept, not deleted.
 *
 * What it cannot claim: jsdom has no layout engine, so "the receipt is on screen"
 * is the component's own contract (`data-sign-in-state="succeeded"`), not geometry.
 * Pixels live in the committed Storybook frames.
 */

// React DOM feature-detects input events at import time, so give it a document
// before loading it, and promote the window's own constructors: jsdom's window is
// the DOM, but it is not the global environment the bundled component runs in.
/*
 * The `url` is what gives this document a localStorage: jsdom withholds the whole
 * Storage API from an about:blank one, and the models store persists through it, so
 * a seeded catalogue threw on its first write before any assertion ran.
 */
const bootstrapDOM = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
});
for (const key of Object.getOwnPropertyNames(bootstrapDOM.window)) {
	if (key === "window" || key === "self" || key === "globalThis") continue;
	if (key in globalThis) continue;
	try {
		globalThis[key] = bootstrapDOM.window[key];
	} catch {
		// Accessors that refuse to be read out of context; the constructors the
		// components need are plain ones and do not.
	}
}
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
/*
 * Node 22 declares a `localStorage` global that is UNDEFINED without
 * --experimental-webstorage, so the copy loop above skips it -- the key exists in
 * globalThis -- and zustand's persist middleware then reads an undefined storage.
 * The document's own is the one the components expect.
 */
globalThis.localStorage = bootstrapDOM.window.localStorage;
globalThis.sessionStorage = bootstrapDOM.window.sessionStorage;
const { createRoot } = await import("react-dom/client");
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

/*
 * The bridge, scripted the way the released backend answers: `auth.start` returns
 * `starting` with no URL, the first poll carries the URL, the second reports the
 * credential. That is the shape the first-click defect lived on, so the flow this
 * test drives is the shipped one, not a shortcut.
 */
const AUTH_URL = "https://claude.ai/oauth/authorize?state=remount";
const opened = [];
let polls = 0;
const snapshot = (state, extra = {}) => ({
	id: "op-1",
	provider: "anthropic",
	state,
	message: "",
	auth_url: null,
	instructions: null,
	input_required: false,
	prompt_id: null,
	expires_in: 540,
	...extra,
});

const CENSUS = JSON.parse(
	readFileSync("scripts/fixtures/auth-providers-first-run.json", "utf8"),
).providers;

/*
 * The bridge answers `config.get` with the envelope the BACKEND sends -- and that
 * shape is the point of a round-3 finding, not a detail: this stub used to return
 * `{hosting, model}` flat, so the guard that was supposed to skip the UI's own
 * default write looked at the right key on the wrong object, never matched, and
 * silently replaced a working default on every later connect (QA round 3 Q3-2, UX
 * round 3 U11). A stub that flattens the envelope cannot catch that.
 */
let configHosting = null;
/** What a key save replies. `null` is the OLD backend: no `defaults_applied` at all. */
let keyReply = null;
/** Whether the success reply carries the backend's own receipt sentence. */
let receipted = true;

/**
 * The tunnel's verdict, as `accounts.list` answers it.
 *
 * `ok` for every case except U19's, so the panel's success view is the plain success
 * everywhere else and the verdict is only in play where a case is about it.
 */
let verdictState = "ok";
/** Every op the panel asked main for, with its payload, so absence is assertable. */
const ops = [];
const opsOf = (op) => ops.filter((entry) => entry.op === op);

let currentProvider = "anthropic";
globalThis.window.api = {
	desktop: {
		request: async (request) => {
			const ok = (result) => ({ status: 200, body: { result } });
			switch (request.op) {
				case "capabilities":
					return ok({
						desktop_contract: 1,
						desktop_available: true,
						desktop_auth: "bearer",
						/*
						 * `tunnel` is on because the SURFACE'S VERDICT is what the panel must
						 * answer to (UX round 5, U19): without the feature there is no verdict
						 * read at all, and a panel that cannot see one cannot be tested for
						 * contradicting it.
						 */
						data: {
							auth: true,
							config: true,
							catalogue: false,
							tunnel: true,
						},
					});
				case "accounts.list":
					return ok({
						accounts: [],
						radient_login: {
							state: verdictState,
							credential_id: verdictState === "ok" ? 7 : null,
						},
					});
				case "providers.list":
					return ok({ providers: CENSUS });
				case "config.get":
					ops.push({ op: "config.get" });
					return ok({
						version: 1,
						metadata: {},
						values: { hosting: configHosting, model: null },
					});
				case "config.update":
					ops.push({ op: "config.update", value: request.value });
					return ok({ version: 2, metadata: {}, values: request.value });
				case "auth.key":
					ops.push({ op: "auth.key", provider: request.provider });
					return ok(keyReply);
				case "auth.start":
					return ok(snapshot("starting"));
				case "auth.status":
					polls += 1;
					if (polls === 1) {
						return ok(snapshot("waiting", { auth_url: AUTH_URL }));
					}
					return ok(
						snapshot("succeeded", {
							message: "Signed in.",
							defaults_applied: {
								hosting: currentProvider,
								model: "claude-opus-5-5",
								model_name: "Claude Opus 5.5",
								...(receipted
									? { receipt: "Set default hosting and model." }
									: {}),
							},
						}),
					);
				case "auth.cancel":
					return ok(snapshot("cancelled", { message: "Sign-in cancelled." }));
				case "auth.open":
					opened.push(request);
					return ok({ opened: true, reopen: Boolean(request.reopen) });
				default:
					return ok(null);
			}
		},
		openAuthorization: async (payload) => {
			opened.push(payload);
			return { opened: true };
		},
	},
};

const bundle = await build({
	stdin: {
		contents: `
			import { createElement } from "react";
			export { QueryClient, QueryClientProvider } from "@tanstack/react-query";
			export { ProviderDetail } from "./src/renderer/src/features/providers/provider-detail";
			export { resetSignInSessions, peekSignInState } from "./src/renderer/src/features/providers/sign-in-sessions";
			export { useModelsStore } from "./src/renderer/src/shared/store/models-store";
			export { createElement };
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	mainFields: ["module", "main"],
	conditions: ["import"],
	alias: {
		"@shared": "./src/renderer/src/shared",
		"@features": "./src/renderer/src/features",
	},
	external: [
		"react",
		"react-dom",
		"react/jsx-runtime",
		"@tanstack/react-query",
	],
	packages: "external",
	loader: { ".css": "empty" },
	jsx: "automatic",
	/*
	 * `ProviderDetail` now reaches the config module (it may write a default the
	 * backend did not), which reads `import.meta.env` at MODULE LOAD -- and Vite is
	 * not the bundler here, so an undefined `import.meta.env` throws before any
	 * assertion runs. An empty object is what a browser build without any VITE_*
	 * value looks like.
	 */
	define: { "import.meta.env": "{}" },
	write: false,
});

const bundlePath = new URL(
	"./_provider-detail-remount.bundle.mjs",
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
after(() => unlink(bundlePath).catch(() => {}));

const {
	QueryClient,
	QueryClientProvider,
	createElement,
	ProviderDetail,
	resetSignInSessions,
	peekSignInState,
	useModelsStore,
} = await import(bundlePath.href);

/**
 * Seed the catalogue the panel reads for its own default write. An empty store is
 * what a released backend gives until something asks it for a list, and the shapes
 * here are the store's own: `getHostingProviders` converts through
 * `model.info.recommended` and the provider's own fields, so a hand-rolled partial
 * record converts to a provider with no models and quietly asserts nothing.
 */
const seedCatalogue = (providerId, models) => {
	useModelsStore.setState({
		isInitialized: true,
		providers: [
			{
				id: providerId,
				name: providerId,
				description: "",
				url: "",
				requiredCredentials: [],
			},
		],
		models: models.map((model) => ({
			id: model.id,
			name: model.name,
			provider: providerId,
			owned_by: providerId,
			created: 0,
			info: {
				description: "",
				context_window: 0,
				max_tokens: 0,
				recommended: Boolean(model.recommended),
				input_price: null,
				output_price: null,
				supports_images: false,
			},
		})),
	});
};

const rowFor = (id) => CENSUS.find((row) => row.id === id);

const mount = async (t) => {
	/*
	 * The tree is allocated FIRST and the teardown registered after it, because the
	 * callback below closes over `mounted`: registering a teardown that dereferences
	 * a binding which does not exist yet turns any early throw into a second error
	 * inside the cleanup, and a mounted tree that is never unmounted keeps the event
	 * loop open -- the hang this repository's rendered-surface tests all guard
	 * against (see `backend-settings-collapse.test.mjs`).
	 */
	const mounted = {
		client: new QueryClient({ defaultOptions: { queries: { retry: false } } }),
	};
	t.after(() => {
		try {
			mounted.root?.unmount();
		} finally {
			mounted.container?.remove();
			mounted.client?.clear();
			resetSignInSessions();
		}
	});
	mounted.container = document.createElement("div");
	document.body.append(mounted.container);
	mounted.root = createRoot(mounted.container);
	mounted.render = async (id, key) => {
		await act(async () => {
			mounted.root.render(
				createElement(
					QueryClientProvider,
					{ client: mounted.client },
					createElement(ProviderDetail, { key, provider: rowFor(id) }),
				),
			);
		});
	};
	mounted.find = (selector) => mounted.container.querySelector(selector);
	mounted.text = () => mounted.container.textContent ?? "";
	return mounted;
};

/** Poll the DOM, because the flow settles on a real 1.5 s timer. */
const waitFor = async (predicate, what, timeout = 15000) => {
	const started = Date.now();
	for (;;) {
		if (predicate()) return;
		if (Date.now() - started > timeout) {
			throw new Error(`timed out waiting for ${what}`);
		}
		await act(async () => {
			await new Promise((resolve) => setTimeout(resolve, 100));
		});
	}
};

const clickButton = async (root, name) => {
	const button = [...root.container.querySelectorAll("button")].find(
		(candidate) => (candidate.textContent ?? "").includes(name),
	);
	assert.ok(button, `the "${name}" control must be rendered`);
	await act(async () => {
		button.dispatchEvent(new window.MouseEvent("click", { bubbles: true }));
	});
};

/*
 * WHY THIS SUITE ENDS ITSELF.
 *
 * After the tree is unmounted and the query cache cleared, this process still holds
 * a socket and timer handles, so node never exits on its own and the runner reports
 * a PASSING file as a job timeout -- which is exactly what happened to this file and
 * its sibling under `scripts/run-desktop-tests.mjs` ("Promise resolution is still
 * pending", node 22 and 26, review round 4 R4-m4). The exit is explicit and carries
 * the code the run earned, so a failure can never be reported as green.
 */
after(() => process.exit(failures > 0 ? 1 : 0));

let failures = 0;
const trackedTest = (name, body) =>
	test(name, async (t) => {
		try {
			await body(t);
		} catch (error) {
			failures += 1;
			throw error;
		}
	});

trackedTest(
	"a completed sign-in survives the remount the row move causes",
	async (t) => {
		polls = 0;
		currentProvider = "anthropic";
		const mounted = await mount(t);

		await mounted.render("anthropic", "row-1");
		assert.ok(
			mounted.find('[data-sign-in-state="idle"]'),
			"a fresh panel starts idle",
		);
		await clickButton(mounted, "Continue in browser");
		await waitFor(
			() => mounted.find('[data-sign-in-state="succeeded"]'),
			"the success state",
		);

		/*
		 * THE ROW MOVE. The provider leaves "Add a provider" and is re-rendered inside
		 * "Connected", which is a different list item: React unmounts this panel and
		 * mounts a new one under a new key. With the mount-time `reset()` back in, this
		 * is the assertion that fails -- the panel comes back idle and invites a second
		 * sign-in.
		 */
		await mounted.render("anthropic", "row-2");
		assert.ok(
			mounted.find('[data-sign-in-state="succeeded"]'),
			"the receipt must still be on screen after the row moves",
		);
		/*
		 * The pane names the backend's own sentence and NOTHING ELSE, because that
		 * sentence already carries the fact: the app's line used to repeat it in plain
		 * words ("... model to 'anthropic/claude-opus-5.5'. Default model: Claude Opus
		 * 5.5") and the guard that was meant to stop it compared the model's DISPLAY name
		 * against a sentence carrying its ID, so it never matched (UX round 3 U12, round 4
		 * U17). The receipt-less case below is where the app's own naming is owed.
		 */
		assert.match(
			mounted.text(),
			/Set default hosting and model\./,
			"the backend's receipt is what the pane shows",
		);
		assert.doesNotMatch(
			mounted.text(),
			/Default model:/,
			"the app must not restate what the backend's receipt already said",
		);
	},
);

trackedTest(
	"a settled sign-in does not claim one the surface says is refused",
	async (t) => {
		/*
		 * U19, at the branch it was measured in: this panel renders its receipt view
		 * whenever the sign-in OPERATION settled succeeded, and an operation that
		 * succeeded does not mean the provider still accepts the grant it stored. Live,
		 * the row read "Needs re-authentication" while the panel under it read "Signed in
		 * to Radient" with a green check -- and the alert written for that state sat in
		 * the panel's idle branch, which a configured provider never reaches. The panel
		 * now takes the verdict its surface holds, so the two cannot disagree: reverting
		 * the `verdict` on the settled branch fails this case.
		 */
		polls = 0;
		currentProvider = "radient";
		verdictState = "login_required";
		t.after(() => {
			verdictState = "ok";
		});
		const mounted = await mount(t);

		await mounted.render("radient", "row-1");
		await clickButton(mounted, "Continue in browser");
		await waitFor(
			() => mounted.find('[data-sign-in-state="succeeded"]'),
			"the success state",
		);
		/*
		 * And for the VERDICT. The panel reads it from the surface's own query, and the
		 * state U19 is about is the one where both answers are in: a receipt from the
		 * operation and a refusal from the provider. A panel that never reaches the
		 * verdict is the defect this waits out.
		 */
		await waitFor(
			() => mounted.find("[data-verdict]") !== null,
			"the surface's verdict on the settled view",
		);
		const text = mounted.text();
		assert.ok(
			!text.includes("Signed in to Radient"),
			`the panel must not assert a sign-in the surface refuses: ${text}`,
		);
		assert.match(
			text,
			/Needs (re-authentication|sign-in)/,
			`the panel must state the verdict it can prove: ${text}`,
		);
		assert.match(
			text,
			/This app could not confirm the sign-in stored on this machine for Radient\./,
			`in the verdict's own register -- this census holds no credential, so the arm is
			 the unconfirmed one and the sentence must not claim a refusal: ${text}`,
		);
		/*
		 * THE TONE, AS THIS HARNESS CAN REACH IT. `needs credential` decides which of
		 * `providerReadiness`' two verdict arms answers: the census here is a first run
		 * whose Radient row holds no credential, so the label is the neutral "Needs
		 * sign-in" rather than the attention-tone "Needs re-authentication". The
		 * attention arm is the state the live app was measured in and the one the swept
		 * story renders (its census says configured); what is pinned HERE is that the
		 * verdict reaches this branch at all and is published for the rigs.
		 */
		assert.equal(
			mounted.find('[data-verdict="neutral"]') !== null,
			true,
			`the settled view must publish the verdict it was rendered under: ${text}`,
		);
		assert.doesNotMatch(
			mounted.find("[data-verdict]")?.innerHTML ?? "",
			/text-success/,
			"and must not keep the success ink while it states a verdict that is not one",
		);
		/*
		 * And the receipt is still there -- it is what the OPERATION did, which is a fact
		 * this panel is the only place to read.
		 */
		assert.ok(
			text.includes("Set default hosting and model."),
			`the receipt still states what the sign-in set: ${text}`,
		);
	},
);

trackedTest(
	"a backend that sends no receipt is where the pane names the model itself",
	async (t) => {
		/*
		 * An OLD backend applies no defaults and sends no sentence, so the app's own line
		 * is the only thing that names what the sign-in chose (the same class as the
		 * release-backend half of U1). Without this case, deleting the line entirely --
		 * the over-fix for U17 -- would pass the suite.
		 */
		polls = 0;
		currentProvider = "anthropic";
		receipted = false;
		t.after(() => {
			receipted = true;
		});
		const mounted = await mount(t);

		await mounted.render("anthropic", "row-1");
		await clickButton(mounted, "Continue in browser");
		await waitFor(
			() => mounted.find('[data-sign-in-state="succeeded"]'),
			"the success state",
		);
		assert.match(
			mounted.text(),
			/Default model: Claude Opus 5\.5/,
			"with no receipt the pane must still name the model the backend applied",
		);
	},
);

trackedTest(
	"the same panel, re-rendered for ANOTHER provider, shows that provider and keeps the first one's receipt",
	async (t) => {
		/*
		 * SAME key on purpose. Re-rendering under a new key mounts a new panel and proves
		 * nothing about the switch: the round-3 probe did exactly that and the branch it
		 * was meant to pin could be deleted with both cases still green (review round 3
		 * R3-m1).
		 */
		polls = 0;
		currentProvider = "anthropic";
		const mounted = await mount(t);

		await mounted.render("anthropic", "row-1");
		await clickButton(mounted, "Continue in browser");
		await waitFor(
			() => mounted.find('[data-sign-in-state="succeeded"]'),
			"the success state",
		);

		await mounted.render("openai", "row-1");
		assert.ok(
			!mounted.find('[data-sign-in-state="succeeded"]'),
			"another provider's panel must not inherit a receipt",
		);
		assert.ok(
			mounted.find('[data-sign-in-state="idle"]'),
			"it starts in the idle view",
		);

		/*
		 * And the receipt is still THERE, not thrown away: coming back shows it, which is
		 * what fails if the switch is "fixed" by resetting the session the panel is
		 * leaving (the round-3 probe's other half: that reset hit Anthropic's session and
		 * stopped its poll).
		 */
		await mounted.render("anthropic", "row-1");
		assert.ok(
			mounted.find('[data-sign-in-state="succeeded"]'),
			"the first provider's own receipt must survive the switch away and back",
		);
	},
);

/** Type into the provider's key field, the way a person does. */
const typeKey = async (root, providerId, value) => {
	const input = root.find(`#key-${providerId}`);
	assert.ok(input, `the key field for ${providerId} must be rendered`);
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLInputElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(input, value);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
};

/** Save a key and let whatever follows it settle. */
const saveKey = async (root, providerId) => {
	await typeKey(root, providerId, "sk-test-not-a-real-key");
	await clickButton(root, "Save key");
	await act(async () => {
		await new Promise((resolve) => setTimeout(resolve, 100));
	});
};

trackedTest(
	"a connect the backend ANSWERED writes no default of its own -- including its deliberate null",
	async (t) => {
		/*
		 * TypeSafe is decision-only: the backend replies `defaults_applied: {hosting:
		 * null, receipt: "Nothing changed…"}` and hosts nothing for chat. Reading a null
		 * hosting as "the old backend applied nothing" made the UI write `hosting:
		 * typesafe`, a provider that cannot answer a message (review round 3 R3-M1).
		 */
		ops.length = 0;
		configHosting = null;
		keyReply = {
			valid: true,
			reason: null,
			defaults_applied: {
				hosting: null,
				model: null,
				model_name: null,
				receipt: "Nothing changed - pick a chat model with /model first.",
			},
		};
		seedCatalogue("typesafe", [{ id: "typesafe-chat", name: "TypeSafe Chat" }]);
		const mounted = await mount(t);

		await mounted.render("typesafe", "row-1");
		await saveKey(mounted, "typesafe");

		assert.equal(
			opsOf("auth.key").length,
			1,
			"the key save must have reached the backend, or this asserts nothing",
		);
		assert.deepEqual(
			opsOf("config.update"),
			[],
			"the UI moved a default the backend had just declined to set",
		);
	},
);

trackedTest(
	"a second provider never moves a default that already works",
	async (t) => {
		/*
		 * QA round 3 Q3-2 and UX round 3 U11: a working `deepseek / deepseek-flash`
		 * became `typesafe / …` on a later connect, because the guard read `config.get`'s
		 * result at the wrong level -- `hosting` lives under `values`, and the stub in
		 * this very file returned it flat, which is why the suite was green.
		 */
		ops.length = 0;
		configHosting = "deepseek";
		keyReply = null;
		seedCatalogue("typesafe", [{ id: "typesafe-chat", name: "TypeSafe Chat" }]);
		const mounted = await mount(t);

		await mounted.render("typesafe", "row-1");
		await saveKey(mounted, "typesafe");

		assert.equal(
			opsOf("auth.key").length,
			1,
			"the key save must have reached the backend, or this asserts nothing",
		);
		assert.deepEqual(
			opsOf("config.update"),
			[],
			"a connect to a second provider replaced the default the user already had",
		);
	},
);

trackedTest(
	"an old backend's connect leaves a model the Local Operator can see, preferring the suggestion",
	async (t) => {
		/*
		 * The released backend applies nothing and sends no `defaults_applied` at all, so
		 * an adopted default is the UI's own write -- and it names a model its catalogue
		 * lists, preferring the backend's `suggested_model` over the listing's first row
		 * (review round 3 R3-m5). Without a model there is NO write: a hosting with an
		 * empty model is the pair that failed the user's first message.
		 */
		ops.length = 0;
		configHosting = null;
		keyReply = null;
		seedCatalogue("typesafe", [
			{ id: "typesafe-other", name: "TypeSafe Other" },
			{ id: "typesafe-chat", name: "TypeSafe Chat" },
		]);
		const row = rowFor("typesafe");
		const saved = row.suggested_model;
		row.suggested_model = { id: "typesafe-chat", name: "TypeSafe Chat" };
		try {
			const mounted = await mount(t);
			await mounted.render("typesafe", "row-1");
			await saveKey(mounted, "typesafe");
		} finally {
			row.suggested_model = saved;
		}

		assert.deepEqual(
			opsOf("config.update").map((entry) => entry.value),
			[{ hosting: "typesafe", model_name: "typesafe-chat" }],
			"the adopted default did not take the backend's suggestion",
		);
	},
);

trackedTest(
	"one panel instance reused for another provider follows the id, and leaves the first provider's flow alone",
	async (t) => {
		/*
		 * Callers key the panel per provider, so this is a guard rather than the common
		 * path -- and the guard was wrong: re-rendering one instance from `anthropic` to
		 * `openai` during a running Anthropic flow reset ANTHROPIC's session (stopping its
		 * poll without cancelling it), cleared OpenAI's saved-key state, and then ran
		 * OpenAI's Start through Anthropic's flow (review round 3 R3-m1).
		 */
		polls = 0;
		currentProvider = "anthropic";
		const mounted = await mount(t);

		await mounted.render("anthropic", "panel");
		await clickButton(mounted, "Continue in browser");
		await waitFor(
			() => mounted.find('[data-sign-in-state="waiting"]'),
			"the Anthropic flow to reach its browser wait",
		);
		assert.equal(
			peekSignInState("anthropic").phase,
			"active",
			"the Anthropic flow must be running before the switch",
		);

		await mounted.render("openai", "panel");

		assert.equal(
			mounted
				.find('[data-sign-in-state="idle"]')
				?.getAttribute("data-sign-in-state"),
			"idle",
			"the panel must show the provider it was re-rendered for",
		);
		assert.equal(
			peekSignInState("anthropic").phase,
			"active",
			"switching the panel reset the OTHER provider's running flow",
		);
		assert.notEqual(
			peekSignInState("openai").phase,
			"active",
			"the new provider inherited the old provider's flow",
		);
	},
);
