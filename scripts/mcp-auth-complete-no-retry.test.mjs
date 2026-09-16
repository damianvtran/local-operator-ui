import assert from "node:assert/strict";
import { unlink, writeFile } from "node:fs/promises";
import { after, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * The sign-in dialog's footer when the sign-in has FINISHED.
 *
 * The operator's report, with the frame he sent: at `Sign-in complete.` the
 * dialog offered `Close` and `Try again` side by side. The second control is
 * the probe's retry, and at a settled success it is not one press away from
 * another attempt at the same thing — it is one press away from re-running the
 * probe, being told "this server takes OAuth", and being handed back
 * `Continue in browser`: a control that re-offers the grant that just
 * succeeded, sitting under a sentence that says it worked. The pair reads as
 * though the sign-in had failed, which is the whole complaint.
 *
 * WHY THIS FILE MOUNTS THE COMPONENT RATHER THAN GREPPING ITS SOURCE. The claim
 * is about what a reader sees, and the footer is assembled from three branches
 * (`state.kind === "notice"`, a recorded press failure, and
 * `state.kind === "running" && !running`) whose inputs are the operation the
 * poll answered with. A regex over the
 * predicate would pin the spelling of the fix and nothing about the state it
 * produces — and the arithmetic that makes `running` false at a COMPLETE
 * operation (line `const running = …`) is exactly where this defect lived, so
 * the discriminating proof is the DOM: the real component, mounted with the
 * real bridge seam, driven through a real press.
 *
 * The instruments are `suggestion-stack-react.test.mjs`'s: jsdom, React's own
 * `act`, and an esbuild bundle of the SHIPPED component with the renderer's
 * `@shared` alias declared by hand (esbuild cannot read tsconfig paths). The
 * bridge is `mcp-auth-surface.test.mjs`'s seam — `window.api.desktop.request`,
 * the path the product itself uses, answering the same envelopes the backend
 * sends.
 *
 * Three cases, and the two controls are what make the first one mean anything: a
 * `complete` operation must lose the retry, and a `failed` or `cancelled` one must
 * KEEP it. Without those two, "the retry was dropped here" and "the retry was
 * dropped everywhere" are the same green run.
 */

/*
 * React DOM feature-detects the DOM at import time, so a document has to exist
 * before anything imports it. `suggestion-stack-react.test.mjs` bootstraps one
 * for the same reason; a real origin rather than jsdom's opaque default,
 * because the bundle's stores resolve `localStorage` at module init.
 */
const bootstrapDOM = new JSDOM("<!doctype html>", { url: "http://localhost/" });
globalThis.window = bootstrapDOM.window;
globalThis.document = bootstrapDOM.window.document;
globalThis.localStorage = bootstrapDOM.window.localStorage;
const { createRoot } = await import("react-dom/client");
const { MemoryRouter } = await import("react-router-dom");
const { QueryClient, QueryClientProvider } = await import(
	"@tanstack/react-query"
);
after(() => {
	bootstrapDOM.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
	globalThis.localStorage = undefined;
});

const source = "src/renderer/src/features/chat/components/run-details";
const bundle = await build({
	stdin: {
		contents: `export { McpAuthDialog } from "./${source}/mcp-auth-dialog";`,
		resolveDir: process.cwd(),
		loader: "tsx",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	packages: "external",
	jsx: "automatic",
	alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` },
	// The component tree imports styles from its story, not from itself; this
	// keeps a CSS import from failing the bundle if one is added beside it.
	loader: { ".css": "empty" },
	write: false,
});
const bundlePath = new URL(
	`./_mcp-auth-complete-${process.pid}.mjs`,
	import.meta.url,
);
await writeFile(bundlePath, bundle.outputFiles[0].text);
const { McpAuthDialog } = await import(bundlePath.href);
await unlink(bundlePath);

/** The body sentence the settle waits for, whatever status the case settled at. */
const SETTLED_SENTENCE = /Sign-in (complete|failed|cancelled)\./;
/** The sentence a completed grant states, which the fix must not disturb. */
const COMPLETED_SENTENCE = /Sign-in complete\./;

/** The dialog's row: an HTTP server whose probe answers "OAuth". */
const ROW = {
	name: "hubspot",
	status: "auth-required",
	problem: true,
	toolCount: null,
	scope: "global",
	transport: "http",
};
/** `useDesktopCapabilities`'s answer, with the feature this dialog is gated on. */
const CAPABILITIES = {
	desktop_contract: 1,
	desktop_available: true,
	desktop_auth: "bearer",
	features: { mcp_auth: 1 },
};
/** A `mcp.control {action:"probe"}` answer, one envelope level down. */
const PROBE_OAUTH = {
	name: "hubspot",
	transport_oauth_supported: true,
	secret_refs: [
		{
			id: "HUBSPOT_TOKEN",
			bindings: [{ field: "headers", key: "Authorization" }],
		},
	],
	key_submission_supported: true,
};

/** One `mcp.list` operation for the row, with the status under test. */
const operation = (status) => ({
	id: `op-${status}`,
	name: "hubspot",
	action: "login",
	status,
	created_at: 1_760_000_000,
	credential_removed: false,
});

/** The bridge, standing where the preload's `desktop.request` stands. */
const installBridge = (status) => {
	const sent = [];
	globalThis.window.api = {
		desktop: {
			request: async (request) => {
				sent.push(request);
				if (request.op === "capabilities")
					return { status: 200, body: { result: CAPABILITIES } };
				if (request.op === "mcp.control")
					return { status: 200, body: { result: { data: PROBE_OAUTH } } };
				if (request.op === "mcp.list")
					return {
						status: 200,
						body: {
							result: {
								data: { servers: [ROW], operations: [operation(status)] },
							},
						},
					};
				throw new Error(
					`the dialog sent an op no case here answers: ${request.op}`,
				);
			},
		},
	};
	return sent;
};

/** The buttons of one element, by their own labels. */
const labels = (element) =>
	[...element.querySelectorAll("button")].map((button) =>
		button.textContent.trim(),
	);
const buttonLabelled = (scope, label) =>
	[...scope.querySelectorAll("button")].find(
		(button) => button.textContent.trim() === label,
	) ?? null;

/**
 * A fresh page, a fresh QueryClient and the real dialog, driven to a settled
 * operation `status`.
 *
 * The client is built with `retry: false` and the surface's own poll left on:
 * the poll is the component's, so the frames below are the ones a reader gets
 * rather than a state a test rewrote.
 */
async function fixture(status, run) {
	const dom = new JSDOM("<div id='root'></div>", {
		url: "http://localhost/",
		// `pretendToBeVisual` is what gives the page a `requestAnimationFrame`,
		// which Radix's Presence reads as a bare global.
		pretendToBeVisual: true,
	});
	const { window } = dom;
	const originals = new Map();
	for (const [key, value] of Object.entries({
		window,
		document: window.document,
		HTMLElement: window.HTMLElement,
		IS_REACT_ACT_ENVIRONMENT: true,
		/*
		 * Radix's `Presence` and its scroll lock reach for these as BARE globals
		 * (`getComputedStyle(node)`, `requestAnimationFrame(...)`), so a page that
		 * only exports `window` and `document` throws inside the dialog primitive
		 * before anything of ours renders. Bound to the case's own window rather
		 * than to the bootstrap one, so a read never crosses documents.
		 */
		getComputedStyle: window.getComputedStyle.bind(window),
		requestAnimationFrame: window.requestAnimationFrame.bind(window),
		cancelAnimationFrame: window.cancelAnimationFrame.bind(window),
		/*
		 * The rest of what the dialog primitive reaches for as bare globals:
		 * `FocusScope` observes the DOM and dispatches focus events, and the
		 * scroll lock listens for key/wheel input. All are the page's own classes,
		 * so a node built here is one this document's APIs recognise.
		 */
		MutationObserver: window.MutationObserver,
		Node: window.Node,
		NodeFilter: window.NodeFilter,
		Element: window.Element,
		Text: window.Text,
		DocumentFragment: window.DocumentFragment,
		HTMLInputElement: window.HTMLInputElement,
		HTMLAnchorElement: window.HTMLAnchorElement,
		HTMLButtonElement: window.HTMLButtonElement,
		Event: window.Event,
		CustomEvent: window.CustomEvent,
		KeyboardEvent: window.KeyboardEvent,
		MouseEvent: window.MouseEvent,
		FocusEvent: window.FocusEvent,
		DOMRect: window.DOMRect,
		getSelection: window.getSelection.bind(window),
		/*
		 * jsdom ships no `matchMedia` and no `ResizeObserver`, and Radix's
		 * presence/scroll-lock path asks for both. A stub rather than a polyfill:
		 * nothing here is about a media query or an observed size, and a real
		 * implementation would make these tests depend on layout jsdom does not
		 * have.
		 */
		matchMedia: () => ({
			matches: false,
			addEventListener() {},
			removeEventListener() {},
			addListener() {},
			removeListener() {},
			dispatchEvent: () => false,
		}),
		ResizeObserver: class {
			observe() {}
			unobserve() {}
			disconnect() {}
		},
	})) {
		originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
		Object.defineProperty(globalThis, key, {
			configurable: true,
			writable: true,
			value,
		});
	}
	const sent = installBridge(status);
	const pressed = [];
	const client = new QueryClient({
		defaultOptions: {
			queries: { retry: false, refetchOnWindowFocus: false },
		},
	});
	const root = createRoot(window.document.getElementById("root"));

	/** Poll the DOM with `act`, so React's work is flushed around each read. */
	const settle = async (read, what) => {
		const deadline = Date.now() + 5000;
		while (Date.now() < deadline) {
			const value = read();
			if (value) return value;
			await act(async () => {
				await new Promise((resolve) => setTimeout(resolve, 25));
			});
		}
		throw new Error(`the dialog never reached ${what}`);
	};
	const dialog = () => window.document.querySelector('[role="dialog"]');

	const api = {
		window,
		sent,
		pressed,
		dialog,
		labels,
		/** One button of THIS dialog, by its own label. */
		button: (label) => buttonLabelled(dialog(), label),
	};

	try {
		await act(() =>
			root.render(
				React.createElement(
					QueryClientProvider,
					{ client },
					React.createElement(
						MemoryRouter,
						null,
						React.createElement(McpAuthDialog, {
							row: ROW,
							onClose: () => {},
							/*
							 * The transition owner the dialog shares with the run panel,
							 * stubbed at its own interface: nothing here is about what the
							 * press does, only about the footer its RESULT is rendered in.
							 */
							remedy: {
								sessionId: "session-1",
								press: (row, action) => pressed.push({ row, action }),
								pressKey: async () => false,
								cancel: () => {},
								reload: async () => false,
								pendingName: null,
								failureFor: () => null,
								clearFailure: () => {},
							},
						}),
					),
				),
			),
		);
		// The probe's own press: the same control the operator pressed, clicked
		// as a real DOM click rather than by forcing the phase into the store.
		const grant = await settle(
			() => buttonLabelled(window.document, "Continue in browser"),
			"the grant state",
		);
		await act(() => grant.click());
		await settle(
			() => SETTLED_SENTENCE.test(dialog().textContent ?? ""),
			`a settled ${status} operation`,
		);
		await run(api);
	} finally {
		await act(() => root.unmount());
		/*
		 * One macrotask of drain BEFORE the page is torn down. Radix's
		 * `FocusScope` dispatches its own unmount event from a `setTimeout(0)`
		 * scheduled by the dialog's cleanup, and that dispatch resolves
		 * `CustomEvent` from the GLOBALS at the moment it runs — so closing the
		 * page and swapping the globals synchronously leaves it dispatching into
		 * a realm that is already gone, which node:test reports as asynchronous
		 * activity after the test ended. The timer is scheduled after this one,
		 * so one turn is enough to let it land in its own page.
		 */
		await new Promise((resolve) => setTimeout(resolve, 0));
		client.clear();
		window.close();
		for (const [key, descriptor] of originals) {
			if (descriptor) Object.defineProperty(globalThis, key, descriptor);
			else delete globalThis[key];
		}
	}
}

test("a completed sign-in offers Close alone, under the sentence that says it worked", async () => {
	await fixture("complete", async ({ dialog, labels: read, button, sent }) => {
		const close = button("Close");
		assert.ok(close, "the dialog must keep its Close action");
		assert.deepEqual(
			read(close.parentElement),
			["Close"],
			"the footer of a completed sign-in is Close and nothing else",
		);
		// The body sentence survives the fix: the control was removed, not the
		// outcome the sentence states.
		assert.match(dialog().textContent, COMPLETED_SENTENCE);
		assert.ok(
			!dialog().textContent.includes("Try again"),
			"a completed sign-in must not offer a retry anywhere in the dialog",
		);
		/*
		 * And the completion came from the POLL, which is the read the footer's own
		 * predicate is fed by: `mcp.list` was asked for and answered with the
		 * operation, rather than the phase being forced in the test.
		 */
		assert.ok(
			sent.some((request) => request.op === "mcp.list"),
			"the completion has to come from the poll this dialog renders",
		);
	});
});

for (const status of ["failed", "cancelled"]) {
	test(`a ${status} sign-in keeps Close and Try again`, async () => {
		await fixture(status, async ({ dialog, labels: read, button, pressed }) => {
			const close = button("Close");
			assert.ok(close, "the dialog must keep its Close action");
			/*
			 * Both controls, on the footer that carries them. The retry is the honest
			 * move for a sign-in that did not finish, so it stays; what it must not
			 * do is appear under a success.
			 */
			assert.deepEqual(read(close.parentElement), ["Close", "Try again"]);
			assert.match(dialog().textContent, new RegExp(`Sign-in ${status}\\.`));
			assert.ok(
				button("Try again"),
				`a ${status} sign-in must still offer the retry`,
			);
			// The press that started this sign-in is the dialog's own primary.
			assert.deepEqual(pressed.length, 1);
		});
	});
}
