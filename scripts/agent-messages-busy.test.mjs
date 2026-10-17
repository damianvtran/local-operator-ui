#!/usr/bin/env node
/**
 * The §5.3 busy rule's own suite: what holds the agent-messages on-ramp back
 * when a natural boundary check lands (R1/R3 = U1/U3 = Q1/Q3).
 *
 * WHY A REAL-STORE MOUNT, NOT FLAG FIXTURES. Round 1's finding was precisely
 * that "blocked" was assembled from the wrong facts (a staged-draft key
 * instead of the composer's own store; four modal types instead of six), and a
 * probe that feeds flags would pass whether or not the wiring reads the store
 * the composer actually writes through. So this suite drives the REAL
 * `conversation-input-store` keystroke path, the REAL canonical-store actions
 * (`stageDraft`, `requestArchiveConfirm`), the REAL webauthn queue, and the
 * real hook, mounted with react-dom in jsdom.
 *
 * DOM/event plumbing only. jsdom has NO layout; the rendered geometry and the
 * app-level integration belong to the connected/rendered QA lease, never to
 * this suite's passing assertions (it does not mount app.tsx or the dialogs).
 */
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { after, test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

const REACT_MODULE = /^(react|react-dom)(\/.*)?$/;

const dom = new JSDOM("<!doctype html><html><body></body></html>", {
	url: "http://localhost/",
	pretendToBeVisual: true,
});
for (const key of Object.getOwnPropertyNames(dom.window)) {
	if (key in globalThis) continue;
	try {
		globalThis[key] = dom.window[key];
	} catch {
		/* jsdom context-bound accessors */
	}
}
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
const require = createRequire(import.meta.url);
const bundled = await build({
	stdin: {
		contents:
			'export {useAgentMessagesBusy} from "./src/renderer/src/features/agent-messages/use-agent-messages-busy"; export {useCanonicalSessionsStore} from "./src/renderer/src/shared/store/canonical-sessions-store"; export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store"; export {noteWebauthnRequest,clearWebauthnRequest,noteWebauthnEnding,clearWebauthnEnding} from "./src/renderer/src/shared/browser-webauthn-queue";',
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	jsx: "automatic",
	mainFields: ["module", "main"],
	alias: {
		"@renderer": resolve("src/renderer/src"),
		"@components": resolve("src/renderer/src/components"),
		"@features": resolve("src/renderer/src/features"),
		"@shared": resolve("src/renderer/src/shared"),
		"@assets": resolve("src/renderer/src/assets"),
		"@hooks": resolve("src/renderer/src/hooks"),
		"@api": resolve("src/renderer/src/api"),
		"@store": resolve("src/renderer/src/store"),
	},
	plugins: [
		{
			name: "isolated-react",
			setup(builder) {
				builder.onResolve({ filter: REACT_MODULE }, (args) => {
					if (args.path.startsWith("@shared")) return undefined;
					return {
						path: pathToFileURL(require.resolve(args.path)).href,
						external: true,
					};
				});
			},
		},
	],
});
const api = await import(
	`data:text/javascript;base64,${Buffer.from(`${bundled.outputFiles[0].text}\n//# sourceURL=agent-messages-busy-fixture.mjs`).toString("base64")}`
);
after(() => {
	dom.window.close();
	globalThis.window = undefined;
	globalThis.document = undefined;
});

const SESSION = "session-1";

const Probe = ({ archiveEnabled = true }) => {
	const busy = api.useAgentMessagesBusy({
		displayedSessionId: SESSION,
		archiveEnabled,
	});
	window.__busy = busy;
	return null;
};
const readBusy = () => window.__busy;

async function mount(t) {
	// Fresh stores per test: keystrokes, drafts, rows, modals and the queue.
	api.useConversationInputStore.setState({ inputByConversation: {} });
	api.useCanonicalSessionsStore.setState({
		sessions: [],
		activeDraftKey: null,
		archiveCandidate: null,
	});
	const container = document.createElement("div");
	document.body.append(container);
	const root = createRoot(container);
	t.after(async () => {
		await act(async () => root.unmount());
		container.remove();
	});
	await act(async () =>
		root.render(React.createElement(Probe, { archiveEnabled: true })),
	);
	return root;
}

test("unsent currentInput and returned pendingText in the displayed conversation hold the busy fact", async (t) => {
	await mount(t);
	assert.equal(readBusy(), false);
	// The REAL keystroke path the composer writes through
	// (`use-message-input.ts:778-784`'s `setCurrentInput`).
	await act(async () => {
		api.useConversationInputStore
			.getState()
			.setCurrentInput(SESSION, "unsent draft");
	});
	assert.equal(readBusy(), true);
	// Whitespace alone is not text (the ask policy's own boolean rule).
	await act(async () => {
		api.useConversationInputStore.getState().setCurrentInput(SESSION, "   ");
	});
	assert.equal(readBusy(), false);
	// `pendingText` is a returned message waiting to be adopted - the user's
	// words - seeded through the row the adopt path persists into.
	await act(async () => {
		const rows = api.useConversationInputStore.getState().inputByConversation;
		api.useConversationInputStore.setState({
			inputByConversation: {
				...rows,
				[SESSION]: {
					...(rows[SESSION] ?? { currentInput: "", submittedMessages: [] }),
					pendingText: "returned words",
				},
			},
		});
	});
	assert.equal(readBusy(), true);
	await act(async () => {
		const rows = api.useConversationInputStore.getState().inputByConversation;
		api.useConversationInputStore.setState({
			inputByConversation: {
				...rows,
				[SESSION]: {
					...rows[SESSION],
					currentInput: "",
					pendingText: undefined,
				},
			},
		});
	});
	assert.equal(readBusy(), false);
});

test("staged draft, busy displayed row, archive confirmation and passkey chooser each hold it - and their own bounds", async (t) => {
	const root = await mount(t);
	// Staged draft: the real action the new-chat door uses.
	await act(async () => {
		api.useCanonicalSessionsStore.getState().stageDraft();
	});
	assert.equal(readBusy(), true);
	await act(async () => {
		api.useCanonicalSessionsStore.setState({ activeDraftKey: null });
	});
	assert.equal(readBusy(), false);
	// A turn in flight in the DISPLAYED row counts; another session's does not.
	await act(async () => {
		api.useCanonicalSessionsStore.setState({
			sessions: [{ session_id: "session-2", status: { code: "busy" } }],
		});
	});
	assert.equal(readBusy(), false);
	await act(async () => {
		api.useCanonicalSessionsStore.setState({
			sessions: [{ session_id: SESSION, status: { code: "busy" } }],
		});
	});
	assert.equal(readBusy(), true);
	await act(async () => {
		api.useCanonicalSessionsStore.setState({ sessions: [] });
	});
	// Archive confirmation: the real action the row/header doors call.
	await act(async () => {
		api.useCanonicalSessionsStore
			.getState()
			.requestArchiveConfirm({ sessionId: SESSION, fromRow: true });
	});
	assert.equal(readBusy(), true);
	// ...and the archive capability's own gate: with that dialog not mountable
	// (`archiveEnabled` false) the candidate must not block.
	await act(async () =>
		root.render(React.createElement(Probe, { archiveEnabled: false })),
	);
	assert.equal(readBusy(), false);
	await act(async () =>
		root.render(React.createElement(Probe, { archiveEnabled: true })),
	);
	assert.equal(readBusy(), true);
	await act(async () => {
		api.useCanonicalSessionsStore.getState().requestArchiveConfirm(null);
	});
	assert.equal(readBusy(), false);
	// Passkey chooser: the live queue the prompt renders from. (`noteWebauthnRequest`
	// is the same entry main's push uses; the panel's transient "ending" state is
	// component-local and deliberately out of scope - the hook's own note says so.)
	await act(async () => {
		api.noteWebauthnRequest({
			requestId: "w1",
			relyingPartyId: "example.test",
			accounts: [],
			tabId: null,
			pageTitle: null,
		});
	});
	assert.equal(readBusy(), true);
	await act(async () => {
		api.clearWebauthnRequest("w1");
	});
	assert.equal(readBusy(), false);
	// The acknowledgement an UNATTENDED settlement leaves behind keeps the SAME
	// modal open until dismissed (round-2 R3: there is no timed lifetime), so
	// the queue length alone would miss an open modal.
	await act(async () => {
		api.noteWebauthnEnding({
			requestId: "w1",
			title: "Passkey request ended",
			body: "The request expired before it was answered.",
		});
	});
	assert.equal(readBusy(), true);
	await act(async () => {
		api.clearWebauthnEnding();
	});
	assert.equal(readBusy(), false);
});
