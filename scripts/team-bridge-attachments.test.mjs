import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Module from "node:module";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/*
 * Team Bridge image attachments: wire contract, pure model, staging hook,
 * draft persistence and message rendering - exercising the SHIPPED modules
 * (bundled with esbuild, as the sibling team-bridge tests do).
 *
 * WHAT IS MOCKED, stated so nobody reads more into a green run: the desktop
 * media relay (`window.api.desktop.media`) and the JSON transport
 * (`window.api.desktop.request`) answer from in-test fakes shaped by the
 * frozen contract; there is no hub, runtime or Electron main here, and JSDOM
 * has no canvas, so `prepareImageForUpload`'s convert/bound path is the
 * documented pass-through for already-bounded PNG/JPEG. This is DOM/state and
 * wire-contract proof, never a rendered-frame claim.
 */
const dom = new JSDOM("<!doctype html><div id='root'></div>", {
	url: "http://localhost/",
});
globalThis.window = dom.window;

/*
 * THE DESKTOP BRIDGE, INERT. The page mounts the shared composer, whose mount
 * registers the global dictation chord (`use-speech-to-text-manager.ts` reads
 * `window.electron.ipcRenderer`), so a DOM probe needs the preload surface to
 * exist. A call that answers nothing is the honest stand-in for a bridge this rig
 * does not have - `agents-composer-mount.test.mjs` states the same stub.
 */
dom.window.electron = {
	ipcRenderer: {
		on: () => () => {},
		removeListener: () => {},
		send: () => {},
		invoke: async () => ({}),
	},
};
globalThis.document = dom.window.document;

globalThis.localStorage = dom.window.localStorage;
for (const name of [
	"HTMLElement",
	"Element",
	"Node",
	"NodeFilter",
	"MutationObserver",
	"DocumentFragment",
	"CustomEvent",
	"HTMLInputElement",
	"HTMLButtonElement",
	"HTMLTextAreaElement",
	"MouseEvent",
	"KeyboardEvent",
	"FocusEvent",
	"FileReader",
])
	globalThis[name] = dom.window[name];
// JSDOM has no layout observers; the shared composer's @mention overlay needs
// the browser API to mount, but these tests assert its state rather than layout.
globalThis.ResizeObserver ??= class {
	observe() {}
	unobserve() {}
	disconnect() {}
};
globalThis.getComputedStyle = dom.window.getComputedStyle;
globalThis.requestAnimationFrame = (callback) =>
	setTimeout(() => callback(0), 0);
globalThis.cancelAnimationFrame = clearTimeout;
Object.defineProperty(dom.window.document, "visibilityState", {
	value: "hidden",
});
Object.defineProperty(dom.window.document, "hidden", { value: true });
// JSDOM has no object URLs; the blob cache needs a create/revoke pair it can count.
let urlSeq = 0;
const liveUrls = new Set();
URL.createObjectURL = () => {
	const url = `blob:test/${++urlSeq}`;
	liveUrls.add(url);
	return url;
};
URL.revokeObjectURL = (url) => liveUrls.delete(url);

globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
// The page imports the sidebar's selected-row role; stub it like the drafts
// suite does so the page-level probes do not pull the whole chat sidebar in.
const sidebarRole = readFileSync(
	"src/renderer/src/features/chat/components/chat-sidebar.tsx",
	"utf8",
).match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(sidebarRole);
const SIDEBAR_IMPORT = /chat\/components\/chat-sidebar$/;
const ANY_PATH = /.*/;
const sidebarStub = {
	name: "chat-sidebar-stub",
	setup(build) {
		build.onResolve({ filter: SIDEBAR_IMPORT }, () => ({
			path: "sidebar-role",
			namespace: "stub",
		}));
		build.onLoad({ filter: ANY_PATH, namespace: "stub" }, () => ({
			contents: `export const rowCurrent = ${sidebarRole};`,
			loader: "js",
		}));
	},
};
const bundle = await build({
	stdin: {
		contents: `export * from "./src/renderer/src/features/team-bridge/team-bridge-attachments-model";
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-attachments";
 export * from "./src/renderer/src/features/team-bridge/use-team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-drafts";
 export * from "./src/renderer/src/features/team-bridge/team-bridge-scheduling";
 export {TeamBridgeMessageList} from "./src/renderer/src/features/team-bridge/team-bridge-message-list";
 export {TeamBridgeMarkdown} from "./src/renderer/src/features/team-bridge/team-bridge-markdown";
 export {TeamBridgeScheduledAttachments} from "./src/renderer/src/features/team-bridge/team-bridge-attachments";
 export {desktopEndpoint, desktopRequestSchema} from "./src/shared/desktop-contract";
 export {teamBridgeMessageSchema, teamBridgeScheduledMessageSchema} from "./src/shared/team-bridge-contract";
 export {reconcileDraftAccount} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {requestDesktopMediaOutcome} from "./src/main/desktop-media";
 export {TeamBridgePageView} from "./src/renderer/src/features/team-bridge/team-bridge-page";
 export {registerCatalogue, setLocale} from "./src/i18n";
 export {QueryClient, QueryClientProvider} from "@tanstack/react-query";
 export {useStickToBottom} from "./src/renderer/src/features/team-bridge/use-stick-to-bottom";
 export {TeamBridgeThreadPaneView} from "./src/renderer/src/features/team-bridge/team-bridge-thread-pane";
 export {TeamBridgeAttachmentChip} from "./src/renderer/src/features/team-bridge/team-bridge-attachments";
 export {t} from "./src/renderer/src/shared/i18n";
 export {browserDraftStorage} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {TeamBridgeApi} from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
 export {useConversationInputStore} from "./src/renderer/src/shared/store/conversation-input-store";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	plugins: [sidebarStub],
	// Vite's `import.meta.env` is read at IMPORT time by the app's config loader,
	// which the shared composer's chain pulls in (`load-config.ts`): bundling for
	// node leaves it undefined and the module throws before a single assertion runs
	// (`browser-chrome.test.mjs` records the same trap). The URL is dead on purpose.
	define: { "import.meta.env": "__viteEnv" },
	/*
	 * BOTH SHIMS THE APP'S BUNDLER GIVES THE SAME MODULES. `__viteEnv` is Vite's
	 * `import.meta.env`; `require` is what a CJS dependency inside an ESM bundle
	 * needs (the composer's graph keeps one), resolved from THIS file the way the
	 * app resolves it. `agents-composer-mount.test.mjs` states the same recipe.
	 */
	// CJS output: `require` is already there, so only Vite's env needs defining.
	banner: { js: "const __viteEnv = {};" },
	// The page mounts the SHARED composer now, which pulls the brand mark (.png).
	// Bundling it keeps these DOM/state probes on the real component tree; a
	// `dataurl` rather than a file keeps the harness asset-free.
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
		".eot": "empty",
	},
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-attachments-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const m = compiled.exports;
// The suite deliberately changes locale in one case; pin the source language
// here so each later page reads the same English control labels.
m.setLocale("en");
/*
 * A CLEAN COMPOSER BETWEEN CASES. The box's text and chips live in
 * `conversation-input-store`, which is module-global and keyed by the bridge
 * composer key - and several page cases mount the same account/scope/target, so a
 * chip staged by one case was still on the box in the next (`localStorage.clear()`
 * empties the persisted copy, never the live store). Resetting the rows here keeps
 * each case's staged set its own; without it a "one chip" assertion reads the
 * leftovers of its predecessor.
 */
beforeEach(() => {
	droppedSeq = 0;
	m.useConversationInputStore.setState({ inputByConversation: {} });
});

/* A 1x1 PNG and a 1x1 JPEG header: real magic numbers, no fixture files. */
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 16, 0x4a, 0x46]);
const SVG = new TextEncoder().encode(
	"<svg xmlns='http://www.w3.org/2000/svg'/>",
);
const WEBP = new TextEncoder().encode("RIFF\0\0\0\0WEBPVP8 ");
const HEIC = new Uint8Array([
	0,
	0,
	0,
	24,
	...new TextEncoder().encode("ftypheic"),
]);
const CAP = {
	enabled: true,
	max_count: 4,
	max_bytes: 5 * 1024 * 1024,
	max_pixels: 16_777_216,
	mime_types: ["image/png", "image/jpeg"],
};

/* ---------------------------------------------------------------- wire */

test("send/schedule DTOs carry attachment_ids only when present, and refuse empty messages", () => {
	const ok = (request) => m.desktopRequestSchema.safeParse(request).success;
	const send = {
		op: "team_bridge.messages.send",
		conversation_id: "bcv_1",
		tenant_id: "tnt_1",
		client_ref: "ref_1",
	};
	assert.equal(ok({ ...send, body: "" }), false, "empty without images");
	assert.equal(ok({ ...send, body: "  " }), false, "blank without images");
	assert.equal(ok({ ...send, body: "", attachment_ids: ["batt_a"] }), true);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["a", "b", "c", "d", "e"] }),
		false,
		"5th image",
	);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["a", "a"] }),
		false,
		"duplicate id",
	);
	assert.equal(
		ok({ ...send, body: "x", attachment_ids: ["../etc"] }),
		false,
		"path text",
	);
	const textOnly = m.desktopEndpoint({ ...send, body: "hi" });
	assert.equal("attachment_ids" in textOnly.body, false, "text-only unchanged");
	const withImages = m.desktopEndpoint({
		...send,
		body: "",
		attachment_ids: ["batt_a", "batt_b"],
	});
	assert.deepEqual(withImages.body.attachment_ids, ["batt_a", "batt_b"]);
	assert.equal(withImages.body.body, "");

	const create = {
		op: "team_bridge.scheduled.create",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		client_ref: "ref_1",
		send_at: "2030-01-01T12:00:00Z",
	};
	assert.equal(ok({ ...create, body: "" }), false);
	assert.deepEqual(
		m.desktopEndpoint({ ...create, body: "", attachment_ids: ["batt_a"] }).body
			.attachment_ids,
		["batt_a"],
	);
	const patch = {
		op: "team_bridge.scheduled.update",
		tenant_id: "tnt_1",
		scheduled_id: "bsm_1",
	};
	// `[]` is meaningful on PATCH (remove every image) and must reach the wire.
	assert.deepEqual(
		m.desktopEndpoint({ ...patch, attachment_ids: [] }).body.attachment_ids,
		[],
	);
	assert.equal(
		"attachment_ids" in
			m.desktopEndpoint({ ...patch, send_at: "2030-01-02T12:00:00Z" }).body,
		false,
	);
	assert.equal(
		ok({ ...patch, body: "" }),
		false,
		"PATCH to empty with no images",
	);
	const del = m.desktopEndpoint({
		op: "team_bridge.attachments.delete",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		attachment_id: "batt_a",
		expected_account_id: "acct_a",
	});
	assert.equal(del.method, "DELETE");
	assert.equal(
		del.path,
		"/v1/desktop/team-bridge/conversations/bcv_1/attachments/batt_a?tenant_id=tnt_1&expected_account_id=acct_a",
	);
});

test("message and scheduled schemas accept additive attachment descriptors", () => {
	const message = m.teamBridgeMessageSchema.parse({
		id: "bmsg_1",
		conversation_id: "bcv_1",
		seq: 1,
		sender: { account_id: "acct_a", kind: "human", display_label: "Ana" },
		body: "",
		origin: "human",
		created_at: "2026-10-21T10:00:00Z",
		attachments: [
			{
				id: "batt_a",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				state: "bound",
				sha256: "x",
			},
		],
	});
	assert.equal(message.attachments.length, 1);
	const old = m.teamBridgeMessageSchema.parse({
		...message,
		attachments: undefined,
	});
	assert.equal(old.attachments, undefined, "old hub: no attachments field");
	const scheduled = m.teamBridgeScheduledMessageSchema.parse({
		id: "bsm_1",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		body: "",
		send_at: "2030-01-01T12:00:00Z",
		status: "scheduled",
		created_at: "2026-10-21T10:00:00Z",
		attachments: [
			{
				id: "batt_a",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				state: "reserved",
			},
		],
	});
	assert.equal(scheduled.attachments[0].state, "reserved");
});

/* --------------------------------------------------------------- model */

test("scheduled rows: descriptors win; S2's attachment_ids become id-only tiles", () => {
	const row = {
		id: "bsch_1",
		tenant_id: "org_1",
		conversation_id: "bcv_1",
		body: "",
		send_at: "2030-01-01T00:00:00Z",
		status: "scheduled",
		created_at: "2029-12-31T00:00:00Z",
	};
	const ids = m.teamBridgeScheduledMessageSchema.parse({
		...row,
		attachment_ids: ["batt_a", "batt_b"],
	});
	assert.deepEqual(
		ids.attachments.map((a) => [a.id, a.width, a.state]),
		[
			["batt_a", 0, "reserved"],
			["batt_b", 0, "reserved"],
		],
	);
	assert.equal("attachment_ids" in ids, false);
	const both = m.teamBridgeScheduledMessageSchema.parse({
		...row,
		attachment_ids: ["batt_a"],
		attachments: [
			{ id: "batt_a", mime: "image/png", size: 9, width: 4, height: 3 },
		],
	});
	assert.deepEqual(
		both.attachments.map((a) => [a.id, a.width]),
		[["batt_a", 4]],
	);
	assert.equal(
		m.teamBridgeScheduledMessageSchema.parse(row).attachments,
		undefined,
	);
	// Edits keep/remove by id regardless of which shape arrived.
	assert.deepEqual(m.scheduledEditPatch(ids, ids.send_at, "", ["batt_a"]), {
		attachment_ids: ["batt_a"],
	});
});

test("capability gate: absent, disabled or narrower blocks hide attachments", () => {
	assert.equal(m.attachmentCapability({ status: { tenants: [] } }), null);
	assert.equal(m.attachmentCapability({ status: null }), null);
	assert.equal(m.attachmentCapability(undefined), null);
	assert.equal(
		m.attachmentCapability({
			status: { attachments: { ...CAP, enabled: false } },
		}),
		null,
	);
	assert.equal(
		m.attachmentCapability({
			status: { attachments: { ...CAP, mime_types: ["image/png"] } },
		}),
		null,
	);
	const on = m.attachmentCapability({ status: { attachments: CAP } });
	assert.equal(on.max_count, 4);
	assert.equal(m.maxAttachments({ ...CAP, max_count: 9 }), 4, "never above 4");
	assert.equal(m.maxAttachments({ ...CAP, max_count: 2 }), 2);
	assert.equal(m.maxAttachments(null), 0);
});

test("sniffing reads magic bytes, never the declared type", () => {
	assert.equal(m.sniffImage(PNG), "image/png");
	assert.equal(m.sniffImage(JPEG), "image/jpeg");
	assert.equal(m.sniffImage(WEBP), "image/webp");
	assert.equal(m.sniffImage(HEIC), "image/heic");
	assert.equal(
		m.sniffImage(new TextEncoder().encode("GIF89a......")),
		"image/gif",
	);
	assert.equal(m.sniffImage(SVG), null, "SVG is never an image here");
	assert.equal(m.sniffImage(new Uint8Array()), null);
});

test("prepare: png/jpeg pass, svg is refused, convert needs a canvas (unsupported without one)", async () => {
	const png = await m.prepareImageForUpload(
		new Blob([PNG], { type: "image/webp" }),
		CAP.max_bytes,
	);
	assert.equal(png.mime, "image/png", "declared type ignored");
	assert.equal(png.bytes.byteLength, PNG.byteLength);
	await assert.rejects(
		m.prepareImageForUpload(
			new Blob([SVG], { type: "image/png" }),
			CAP.max_bytes,
		),
		(error) => error.reason === "unsupported",
	);
	// JSDOM has no createImageBitmap/OffscreenCanvas: a webp cannot be
	// converted, and the honest answer is "unsupported", never a raw upload.
	await assert.rejects(
		m.prepareImageForUpload(new Blob([WEBP]), CAP.max_bytes),
		(error) => error.reason === "unsupported",
	);
	await assert.rejects(
		m.prepareImageForUpload(new Blob([PNG]), 10),
		(error) => error.reason === "too_large",
	);
});

test("bubble state is fail-closed: only absent/bound is fetched", () => {
	const base = { id: "a", mime: "image/png", size: 1, width: 1, height: 1 };
	assert.equal(m.attachmentView(base), "fetch");
	assert.equal(m.attachmentView({ ...base, state: "bound" }), "fetch");
	assert.equal(m.attachmentView({ ...base, state: "expired" }), "expired");
	assert.equal(m.attachmentView({ ...base, state: "deleted" }), "unavailable");
	assert.equal(m.attachmentView({ ...base, state: "withheld" }), "unavailable");
	assert.equal(m.attachmentView({ ...base, state: "future" }), "unavailable");
	assert.equal(
		m.attachmentView({ ...base, mime: "image/svg+xml" }),
		"unavailable",
		"never fetch a non-picture type",
	);
});

test("upload failures map to a closed set of reasons", () => {
	assert.equal(m.uploadFailure(413), "too_large");
	assert.equal(m.uploadFailure(415), "unsupported");
	assert.equal(m.uploadFailure(422), "invalid");
	assert.equal(m.uploadFailure(429), "rate_limited");
	assert.equal(m.uploadFailure(400), "limit");
	assert.equal(m.uploadFailure(404), "expired");
	// QA Q3: a mid-compose sign-out answers 401 bridge_signin_required.
	assert.equal(m.uploadFailure(401), "signed_out");
	assert.equal(m.uploadFailure(null), "offline");
	assert.equal(m.uploadFailure(500), "failed");
	assert.equal(
		m.isAttachmentNotFound({ status: 404, code: "attachment_not_found" }),
		true,
	);
	assert.equal(
		m.isAttachmentNotFound({ status: 404, code: "conversation_not_found" }),
		false,
	);
	// R1-05: an undeclared 404 (the conversation itself) is not an expiry.
	assert.equal(m.isAttachmentNotFound({ status: 404 }), false);
});

test("scheduled edit patch sends the whole image set only when it changed", () => {
	const message = {
		body: "x",
		send_at: "2030-01-01T12:00:00Z",
		attachments: [{ id: "a" }, { id: "b" }],
	};
	assert.deepEqual(
		m.scheduledEditPatch(message, message.send_at, "x", ["a", "b"]),
		{},
	);
	assert.deepEqual(m.scheduledEditPatch(message, message.send_at, "x", []), {
		attachment_ids: [],
	});
	assert.deepEqual(
		m.scheduledEditPatch(message, message.send_at, "x", undefined),
		{},
	);
	// R1-03: clearing the caption but keeping the images is an image-only edit,
	// so the unchanged set rides along and the contract accepts it.
	const imageOnly = m.scheduledEditPatch(message, message.send_at, "", [
		"a",
		"b",
	]);
	assert.deepEqual(imageOnly, { body: "", attachment_ids: ["a", "b"] });
});

test("first-send scheduling stages held images into the new conversation BEFORE the POST", async () => {
	const calls = [];
	await m.scheduleTeamBridgeDraft({
		tenantId: "tnt_1",
		recipients: [{ kind: "human", accountId: "acct_b", label: "Bea" }],
		body: "",
		clientRef: "ref_1",
		sendAt: "2030-01-01T12:00:00Z",
		remembered: new Map(),
		onCreated: (id) => calls.push(`created:${id}`),
		create: async () => ({ id: "bcv_new", tenant_id: "tnt_1" }),
		stageHeld: async (id, tenant) => {
			calls.push(`stage:${id}:${tenant}`);
			return ["batt_x"];
		},
		schedule: async (input) => {
			calls.push(
				`schedule:${input.attachment_ids.join(",")}:${JSON.stringify(input.body)}`,
			);
		},
	});
	assert.deepEqual(calls, [
		"created:bcv_new",
		"stage:bcv_new:tnt_1",
		'schedule:batt_x:""',
	]);
	// A failed stage throws: nothing is scheduled text-only, the group id is remembered.
	const remembered = new Map();
	let scheduled = false;
	await assert.rejects(
		m.scheduleTeamBridgeDraft({
			tenantId: "tnt_1",
			recipients: [
				{ kind: "human", accountId: "acct_b", label: "Bea" },
				{ kind: "human", accountId: "acct_c", label: "Cy" },
			],
			body: "with images",
			clientRef: "ref_2",
			sendAt: "2030-01-01T12:00:00Z",
			remembered,
			onCreated: () => {},
			create: async () => ({ id: "bcv_group", tenant_id: "tnt_1" }),
			stageHeld: async () => {
				throw new Error("attachments not staged");
			},
			schedule: async () => {
				scheduled = true;
			},
		}),
	);
	assert.equal(scheduled, false);
	assert.equal(
		[...remembered.values()][0].id,
		"bcv_group",
		"retry reuses the group",
	);
});

/* ---------------------------------------------------- relay fakes + hook */

let mediaCalls = [];
let requestCalls = [];
/*
 * ONE PATH PER DROPPED FILE. A real Finder drop of two files yields two paths, and
 * the schedule success path removes "the paths this schedule carried" by matching
 * them - so a fixture handing every file one path made that removal eat a chip the
 * request never carried. The counter keeps the fixture shaped like the desktop
 * preload it stands in for.
 */
let droppedSeq = 0;
let mediaAnswer = () => ({ status: 404, kind: "error", detail: "no" });
/*
 * THE DESKTOP PRELOAD'S TWO FILE CALLS, which the shared composer's drop path and
 * the bridge's staged upload both use. A real Finder drop carries a PATH
 * (`getPathForFile`), and the bridge reads those bytes only when a send binds them
 * (`readFile`); a fixture without them sends the composer down its "dragged out of
 * another page" data-URL route and cannot answer the upload at all.
 */
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
window.api = {
	getPathForFile: () => `/fixtures/dropped-${++droppedSeq}.png`,
	readFile: async () => ({ success: true, data: PNG_BASE64 }),
	desktop: {
		media: async (request, bytes) => {
			mediaCalls.push({ request, size: bytes?.byteLength ?? 0 });
			return mediaAnswer(request, bytes);
		},
		request: async (request) => {
			requestCalls.push(request);
			return { status: 204, body: null };
		},
	},
};

let hook;
function HookProbe(props) {
	hook = m.useTeamBridgeAttachments(props);
	return null;
}
async function mountHook(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	// No query context is needed: the hook CAPTURES the account with `useRef` and
	// never looks one up. The provider stays only because this harness is shared
	// with the page tests; a reader must not "fix" the hook toward a live lookup
	// on the strength of this wrapper.
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const render = async (next) =>
		act(async () =>
			root.render(
				React.createElement(
					m.QueryClientProvider,
					{ client },
					React.createElement(HookProbe, next),
				),
			),
		);
	await render(props);
	return {
		render,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}
const settle = () =>
	act(async () => new Promise((resolve) => setTimeout(resolve, 0)));
/* The runtime's real answer shape: its CRUD envelope around the hub's `{attachment}`. */
const staged = (id) => ({
	status: 201,
	kind: "json",
	body: {
		status: 201,
		message: "Attachment staged.",
		result: {
			attachment: {
				id,
				mime: "image/png",
				size: PNG.byteLength,
				width: 1,
				height: 1,
				state: "staged",
				expires_at: "2099-01-01T00:00:00Z",
			},
		},
	},
});

test("hook: upload into an existing conversation, max 4, retry after failure, remove deletes", async () => {
	mediaCalls = [];
	requestCalls = [];
	let n = 0;
	let failNext = true;
	mediaAnswer = (request) => {
		if (request.op !== "team_bridge.attachment.upload")
			return { status: 404, kind: "error" };
		if (failNext) {
			failNext = false;
			return { status: 503, kind: "error", detail: "x" };
		}
		return staged(`batt_${++n}`);
	};
	const persisted = [];
	const app = await mountHook({
		scopeKey: "a",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: CAP,
		onPersist: (next) => persisted.push(next.map((row) => row.id)),
	});
	await act(async () => hook.add([1, 2, 3, 4, 5].map(() => new Blob([PNG]))));
	assert.equal(hook.notice, "limit", "5th image is refused with a note");
	await settle();
	await settle();
	assert.equal(hook.count, 4);
	const statuses = hook.chips.map((chip) => chip.status).sort();
	assert.deepEqual(statuses, ["error", "ready", "ready", "ready"]);
	assert.equal(hook.blocked, true, "a failed chip blocks send");
	const failed = hook.chips.find((chip) => chip.status === "error");
	assert.equal(failed.reason, "offline");
	await act(async () => hook.retry(failed.key));
	await settle();
	assert.equal(
		hook.chips.every((chip) => chip.status === "ready"),
		true,
	);
	assert.equal(hook.readyIds().length, 4);
	// Every upload went through the media relay with the conversation's tenant,
	// a raw body, and no filename or declared type anywhere in the request.
	for (const call of mediaCalls) {
		assert.deepEqual(Object.keys(call.request).sort(), [
			"conversationId",
			"expectedAccountId",
			"op",
			"tenantId",
		]);
		assert.equal(call.request.tenantId, "tnt_1");
		// The receipt is the account this composer was rendered under.
		assert.equal(call.request.expectedAccountId, "acct_a");
	}
	// Drafts persisted descriptors (ids), never bytes.
	assert.equal(persisted.at(-1).length, 4);
	const victim = hook.chips[0];
	await act(async () => hook.remove(victim.key));
	assert.equal(hook.count, 3);
	assert.equal(requestCalls.at(-1).op, "team_bridge.attachments.delete");
	assert.equal(requestCalls.at(-1).attachment_id, victim.attachment.id);
	await act(async () => hook.markExpired());
	assert.equal(
		hook.chips.every((chip) => chip.status === "expired"),
		true,
	);
	assert.equal(hook.readyIds().length, 0, "expired ids are never sent");
	await app.close();
});

test("hook: a captured account the runtime refuses never becomes a silent success", async () => {
	mediaCalls = [];
	// The captured-owner guard: the runtime answers 409 when the receipt names an
	// account that is no longer the signed-in one. The composer must surface that
	// refusal (error chip, send blocked) instead of showing a ready image that
	// would 422/409 at send time.
	mediaAnswer = (request) =>
		request.op === "team_bridge.attachment.upload"
			? { status: 409, kind: "error", code: "account_mismatch" }
			: { status: 404, kind: "error" };
	const app = await mountHook({
		scopeKey: "a",
		accountId: "acct_stale",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: CAP,
	});
	try {
		// Re-render the SAME hook under another account before the upload: a live
		// lookup would now send `acct_b`, which is exactly what the guard must not
		// receive (review round 1, R1-04).
		await app.render({
			scopeKey: "a",
			accountId: "acct_b",
			tenantId: "tnt_1",
			conversationId: "bcv_1",
			capability: CAP,
		});
		await act(async () => hook.add([new Blob([PNG])]));
		await settle();
		await settle();
		assert.equal(mediaCalls.length, 1);
		// The receipt is the account the composer was rendered under, not a fresh
		// lookup of whoever is signed in when the request runs.
		assert.equal(mediaCalls.at(-1).request.expectedAccountId, "acct_stale");
		assert.deepEqual(
			hook.chips.map((chip) => chip.status),
			["error"],
			"the refusal surfaces as an error chip",
		);
		assert.equal(hook.chips[0].reason, "account_mismatch");
		assert.equal(hook.readyIds().length, 0, "nothing is sendable");
		assert.equal(hook.blocked, true, "send is blocked");
	} finally {
		await app.close();
	}
});

test("hook: a draft with no conversation HOLDS images and stages them on first send", async () => {
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_h${++n}`);
	const app = await mountHook({
		scopeKey: "compose",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: null,
		capability: CAP,
	});
	await act(async () => hook.add([new Blob([PNG]), new Blob([JPEG])]));
	await settle();
	assert.deepEqual(
		hook.chips.map((chip) => chip.status),
		["held", "held"],
	);
	assert.equal(
		mediaCalls.length,
		0,
		"pasting creates nothing and uploads nothing",
	);
	let ids;
	await act(async () => {
		ids = await hook.uploadHeld("bcv_new", "tnt_1");
	});
	assert.deepEqual(ids, ["batt_h1", "batt_h2"]);
	assert.deepEqual(
		mediaCalls.map((call) => call.request.conversationId),
		["bcv_new", "bcv_new"],
	);
	await app.close();
});

test("hook: no capability shows the unsupported note and stages nothing", async () => {
	mediaCalls = [];
	const app = await mountHook({
		scopeKey: "x",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: null,
	});
	assert.equal(hook.enabled, false);
	await act(async () => hook.add([new Blob([PNG])]));
	assert.equal(hook.notice, "unsupported");
	assert.equal(hook.count, 0);
	assert.equal(mediaCalls.length, 0);
	await app.close();
});

/* --------------------------------------------------------------- drafts */

let drafts;
function DraftProbe(props) {
	drafts = m.useTeamBridgeDrafts(
		props.account ?? "acct_a",
		"tnt_1",
		props.target,
		"",
		props.signedOut,
	);
	return null;
}

test("drafts persist descriptors only, restore them, and the logout fence clears them", async () => {
	localStorage.clear();
	const target = { type: "conversation", id: "bcv_1" };
	const element = document.createElement("div");
	const root = createRoot(element);
	await act(async () =>
		root.render(React.createElement(DraftProbe, { target })),
	);
	const before = drafts.current?.clientRef;
	await act(async () =>
		drafts.setAttachments([
			{
				id: "batt_a",
				conversationId: "bcv_1",
				mime: "image/png",
				size: 10,
				width: 1,
				height: 1,
				expiresAt: "2099-01-01T00:00:00Z",
			},
		]),
	);
	assert.notEqual(
		drafts.current.clientRef,
		before,
		"a new image set is a new idempotency key",
	);
	const raw = Object.entries(localStorage).find(([key]) =>
		key.startsWith("team-bridge-authored-drafts:v1:"),
	)[1];
	assert.match(raw, /batt_a/);
	assert.doesNotMatch(raw, /base64|data:|iVBOR/, "no image bytes in storage");
	// A tampered entry carrying bytes is dropped on read, never restored.
	const key = Object.keys(localStorage).find((k) =>
		k.startsWith("team-bridge-authored-drafts:v1:"),
	);
	const parsed = JSON.parse(raw);
	parsed["conversation:bcv_1"].attachments[0].data = "iVBORw0K";
	assert.deepEqual(
		m.readDrafts({ getItem: () => JSON.stringify(parsed) }, key),
		{},
	);
	// Sent ids leave the draft; a body-less, image-less draft is removed.
	await act(async () =>
		drafts.clearSent("conversation:bcv_1", "", drafts.current.clientRef, [
			"batt_a",
		]),
	);
	assert.equal(drafts.current, undefined);
	await act(async () =>
		drafts.setAttachments([
			{
				id: "batt_b",
				conversationId: "bcv_1",
				mime: "image/png",
				size: 1,
				width: 1,
				height: 1,
			},
		]),
	);
	m.rememberUploadPreview(
		"acct_a",
		"batt_b",
		new Blob([PNG], { type: "image/png" }),
	);
	assert.ok(m.uploadPreview("acct_a", "batt_b"));
	assert.equal(
		m.uploadPreview("acct_other", "batt_b"),
		null,
		"previews are account-scoped",
	);
	m.reconcileDraftAccount(localStorage, {
		state: "signed_out",
		account_id: null,
	});
	assert.equal(
		Object.keys(localStorage).some((k) =>
			k.startsWith("team-bridge-authored-drafts:v1:"),
		),
		false,
	);
	assert.equal(
		m.uploadPreview("acct_a", "batt_b"),
		null,
		"fence drops in-memory previews too",
	);
	assert.equal(m.isStagedExpired({ expiresAt: "2000-01-01T00:00:00Z" }), true);
	await act(async () => root.unmount());
});

/* -------------------------------------------------------------- render */

const message = (overrides) => ({
	id: "bmsg_1",
	conversation_id: "bcv_1",
	seq: 1,
	sender: { account_id: "acct_b", kind: "human", display_label: "Bea" },
	body: "",
	origin: "human",
	created_at: "2026-10-21T10:00:00Z",
	...overrides,
});

async function renderList(messages, tenantId = "tnt_1") {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	await act(async () =>
		root.render(
			React.createElement(m.TeamBridgeMessageList, {
				messages,
				labelFor: (sender) => sender.display_label,
				tenantId,
				// The byte route carries the captured-owner receipt, so the list
				// is rendered with the account it is authorized under.
				accountId: "acct_a",
			}),
		),
	);
	await settle();
	await settle();
	return {
		element,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}

test("bubble: images render ONLY from attachments[], fetched member-gated; placeholders never fetch", async () => {
	mediaCalls = [];
	mediaAnswer = (request) =>
		request.op === "team_bridge.attachment"
			? request.attachmentId === "batt_fail"
				? { status: 404, kind: "error", detail: "x" }
				: { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
			: { status: 404, kind: "error" };
	const base = { mime: "image/png", size: 10, width: 4, height: 3 };
	const view = await renderList([
		message({
			body: "",
			attachments: [
				{ id: "batt_ok", ...base, state: "bound" },
				{ id: "batt_exp", ...base, state: "expired" },
				{ id: "batt_del", ...base, state: "deleted" },
				{ id: "batt_fail", ...base },
			],
		}),
	]);
	const fetched = mediaCalls.map((call) => call.request.attachmentId).sort();
	assert.deepEqual(
		fetched,
		["batt_fail", "batt_ok"],
		"expired/deleted are never requested",
	);
	for (const call of mediaCalls) {
		assert.equal(call.request.op, "team_bridge.attachment");
		assert.equal(call.request.tenantId, "tnt_1");
		assert.equal(call.request.messageId, "bmsg_1");
	}
	const imgs = [...view.element.querySelectorAll("img")];
	assert.equal(imgs.length, 1);
	assert.match(imgs[0].getAttribute("src"), /^blob:test\//);
	const placeholders = [
		...view.element.querySelectorAll("[data-attachment-placeholder]"),
	].map((node) => node.getAttribute("data-attachment-placeholder"));
	assert.deepEqual(placeholders.sort(), ["expired", "failed", "unavailable"]);
	assert.equal(
		view.element.querySelector(".team-bridge-message-body"),
		null,
		"image-only message draws no empty prose block",
	);
	assert.doesNotMatch(
		view.element.textContent,
		/batt_/,
		"ids never reach the screen",
	);
	await view.close();
	// The cache defers a revoke by one microtask (a fold swap hands a URL to a
	// new holder inside one commit), so the count is read after a macrotask.
	await settle();
	await new Promise((resolve) => setTimeout(resolve, 10));
	assert.equal(liveUrls.size, 0, "blob URLs are revoked on unmount");
});

test("markdown images in a body stay alt text and fetch nothing", async () => {
	mediaCalls = [];
	const view = await renderList([
		message({
			body: "look ![shot](http://localhost:1111/v1/secret) and ![](https://evil.example/p.png)",
		}),
	]);
	assert.equal(view.element.querySelectorAll("img").length, 0);
	assert.match(view.element.textContent, /shot/);
	assert.match(view.element.textContent, /https:\/\/evil\.example\/p\.png/);
	assert.equal(mediaCalls.length, 0);
	await view.close();
});

test("scheduled images: descriptor tile, or this account's own in-memory preview; never a fetch", async () => {
	mediaCalls = [];
	m.rememberUploadPreview(
		"acct_a",
		"batt_s1",
		new Blob([PNG], { type: "image/png" }),
	);
	const element = document.createElement("div");
	const root = createRoot(element);
	await act(async () =>
		root.render(
			React.createElement(m.TeamBridgeScheduledAttachments, {
				accountId: "acct_a",
				attachments: [
					{
						id: "batt_s1",
						mime: "image/png",
						size: 1,
						width: 1,
						height: 1,
						state: "reserved",
					},
					{
						id: "batt_s2",
						mime: "image/png",
						size: 1,
						width: 1,
						height: 1,
						state: "reserved",
					},
				],
			}),
		),
	);
	const tiles = [
		...element.querySelectorAll("[data-attachment-scheduled]"),
	].map((node) => node.getAttribute("data-attachment-scheduled"));
	assert.deepEqual(tiles, ["preview", "descriptor"]);
	assert.equal(mediaCalls.length, 0);
	// D6: the undrawable tile is NAMED by position and DESCRIBED as attached
	// but not previewable; the drawn one carries no such description.
	const [drawn, undrawn] = element.querySelectorAll(
		"[data-attachment-scheduled]",
	);
	assert.equal(drawn.getAttribute("role"), "img");
	assert.equal(drawn.getAttribute("aria-label"), "Image 1 of 2");
	assert.equal(drawn.getAttribute("aria-describedby"), null);
	assert.equal(undrawn.getAttribute("role"), "img");
	assert.equal(undrawn.getAttribute("aria-label"), "Image 2 of 2");
	assert.equal(undrawn.getAttribute("title"), "Preview unavailable");
	const describedBy = undrawn.getAttribute("aria-describedby");
	assert.ok(describedBy);
	assert.equal(
		element.querySelector(`[id="${describedBy}"]`)?.textContent,
		"Preview unavailable",
	);
	await act(async () => root.unmount());
});

/*
 * MAIN'S RELAY, over real loopback HTTP: the bearer is attached here (never by
 * the renderer), ids are shape-checked before a path is built, the upload is a
 * raw octet-stream with no filename/type, the 5 MiB ceiling refuses before
 * sending, and a picture route answering anything but png/jpeg (SVG is
 * script-capable) never reaches the renderer as bytes.
 */
test("main relay: upload/fetch paths, bearer, id validation, type and size refusal", async () => {
	const seen = [];
	let answer = { status: 201, type: "application/json", body: "{}" };
	const server = createServer((req, res) => {
		const chunks = [];
		req.on("data", (chunk) => chunks.push(chunk));
		req.on("end", () => {
			seen.push({
				method: req.method,
				url: req.url,
				auth: req.headers.authorization === "Bearer t0k",
				type: req.headers["content-type"],
				bytes: Buffer.concat(chunks).length,
			});
			res.writeHead(answer.status, { "content-type": answer.type });
			res.end(answer.body);
		});
	});
	await new Promise((done) => server.listen(0, "127.0.0.1", done));
	const base = `http://127.0.0.1:${server.address().port}`;
	try {
		answer = {
			status: 201,
			type: "application/json",
			body: JSON.stringify({ attachment: { id: "batt_1" } }),
		};
		const up = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
			},
			new Uint8Array(PNG),
			base,
			"t0k",
		);
		assert.equal(up.response.kind, "json");
		assert.deepEqual(seen.at(-1), {
			method: "POST",
			url: "/v1/desktop/team-bridge/conversations/bcv_1/attachments?tenant_id=tnt_1&expected_account_id=acc_1",
			auth: true,
			type: "application/octet-stream",
			bytes: PNG.length,
		});

		answer = { status: 200, type: "image/png", body: Buffer.from(PNG) };
		const got = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(got.response.kind, "bytes");
		assert.equal(
			seen.at(-1).url,
			"/v1/desktop/team-bridge/conversations/bcv_1/messages/bmsg_1/attachments/batt_1?tenant_id=tnt_1&expected_account_id=acc_1",
		);
		assert.equal(seen.at(-1).method, "GET");

		answer = { status: 200, type: "image/svg+xml", body: "<svg/>" };
		const svg = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(
			svg.response.kind,
			"error",
			"non-png/jpeg answer is refused in main",
		);
		assert.equal(svg.response.status, 502);

		answer = {
			status: 404,
			type: "application/json",
			body: JSON.stringify({ detail: "attachment_not_found" }),
		};
		const gone = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
				messageId: "bmsg_1",
				attachmentId: "batt_other",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(gone.response.kind, "error");
		assert.equal(gone.response.status, 404);

		const before = seen.length;
		const traversal = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment",
				tenantId: "tnt_1",
				conversationId: "../../v1/admin",
				expectedAccountId: "acc_1",
				messageId: "bmsg_1",
				attachmentId: "batt_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(traversal.response.status, 422);
		assert.equal(traversal.answered, false);
		const huge = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
			},
			new Uint8Array(5 * 1024 * 1024 + 1),
			base,
			"t0k",
		);
		assert.equal(huge.response.status, 413);
		assert.equal(huge.answered, false);
		const empty = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
			},
			null,
			base,
			"t0k",
		);
		assert.equal(empty.response.status, 422);
		const noToken = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
			},
			new Uint8Array(PNG),
			base,
			null,
		);
		assert.equal(noToken.response.status, 503);
		assert.equal(seen.length, before, "refused requests never left main");
	} finally {
		await new Promise((done) => server.close(done));
	}
});

/* ------------------------------------------------------------ page level */

/*
 * TeamBridgePageView submit with held images, driven the way an author does:
 * drop a PNG on the composer, click Send. These are the round-1 R1-01/R1-02
 * reproductions; both failed on cf1d7c616c (text posted alone / draft left
 * behind) and must stay green.
 */
const human = (account_id, display_label) => ({
	account_id,
	kind: "human",
	display_label,
	state: "active",
	role: "member",
});
const dmRow = {
	id: "bcv_dm",
	tenant_id: "org_page",
	kind: "dm",
	name: null,
	members: [human("acct_a", "Ada"), human("acct_b", "Bea")],
	visibility: "private",
	agent_capable: false,
	status: "open",
	created_by: "acct_a",
	last_message_at: "2030-01-01T00:00:00Z",
	latest_seq: 1,
	last_read_seq: 1,
	unread_count: 0,
	muted: false,
};
const pageProps = (overrides) => ({
	selfAccountId: "acct_a",
	scope: "org_page",
	conversations: [dmRow],
	people: [
		{ account_id: "acct_b", display_label: "Bea", email: "bea@example.com" },
	],
	messages: [],
	organizations: [
		{ tenantId: "org_page", name: "Page org", role: "owner", unread: 0 },
	],
	totalUnread: 0,
	listState: "ready",
	messageState: "ready",
	attachmentCapability: CAP,
	onTarget: () => {},
	onNewChannel: () => {},
	onScopeChange: () => {},
	...overrides,
});
async function mountPage(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	// The Scheduled quick view reads through react-query. The provider comes
	// from the SAME bundle as the page, so the context instance matches.
	const client = new m.QueryClient({
		defaultOptions: { queries: { retry: false } },
	});
	const draw = (next) =>
		act(async () =>
			root.render(
				React.createElement(
					m.QueryClientProvider,
					{ client },
					React.createElement(m.TeamBridgePageView, next),
				),
			),
		);
	await draw(props);
	return {
		element,
		// Re-render with new props on the SAME root (a new message arriving).
		render: draw,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}
async function dropImage(element) {
	const field = element.querySelector("textarea");
	assert.ok(field, "composer field is mounted");
	const box = field.parentElement;
	// Node's File: JSDOM's has no arrayBuffer(), which prepare reads.
	const file = new File([PNG], "", { type: "image/png" });
	const transfer = {
		types: ["Files"],
		items: [{ kind: "file", getAsFile: () => file }],
		files: [file],
	};
	const event = new window.Event("drop", { bubbles: true, cancelable: true });
	event.dataTransfer = transfer;
	await act(async () => box.dispatchEvent(event));
	for (let i = 0; i < 5; i += 1) await settle();
}
async function typeBody(element, text) {
	const field = element.querySelector("textarea");
	const setter = Object.getOwnPropertyDescriptor(
		window.HTMLTextAreaElement.prototype,
		"value",
	).set;
	await act(async () => {
		setter.call(field, text);
		field.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
}
const sendButton = (element) =>
	[...element.querySelectorAll("button")].find((button) =>
		["Send", "Send message"].includes(button.getAttribute("aria-label")),
	);

for (const [label, body] of [
	["text + image", "see attached"],
	["image only", ""],
]) {
	test(`page R1-01: a person row whose DM exists uploads on drop and sends the ids (${label})`, async () => {
		localStorage.clear();
		mediaCalls = [];
		let n = 0;
		mediaAnswer = () => staged(`batt_p${++n}`);
		const sends = [];
		const app = await mountPage(
			pageProps({
				target: { type: "person", accountId: "acct_b" },
				/*
				 * THE CONTAINER'S JOB, not the composer's: `sendBody` in production is
				 * what turns the staged paths into hub ids (`stagedForSend`), so a fake
				 * that never calls `stageHeld` proves nothing about the picture reaching
				 * the hub. This is the same sequence R1-02 states for a draft that creates
				 * its conversation first.
				 */
				onSend: async (sent, _clientRef, attachments) => {
					const ids = attachments?.stageHeld
						? await attachments.stageHeld("bcv_dm", "org_page")
						: [];
					sends.push({
						body: sent,
						ids: [...ids],
						held: Boolean(attachments?.stageHeld),
					});
				},
			}),
		);
		if (body) await typeBody(app.element, body);
		await dropImage(app.element);
		/*
		 * WHAT THE OLD ASSERTION PINNED: the drop uploaded immediately, so `mediaCalls`
		 * named the DM before any send - true while the bridge drew its own chip strip
		 * and its hook owned the upload.
		 *
		 * THE NEW TRUTH: the chips are the SHARED composer's, and a chip is a local file
		 * until a request binds it - the page's `stagedForSend` uploads INSIDE the send
		 * (`team-bridge-page.tsx`: "EVERY request uploads inside itself"). So the drop
		 * stages and nothing reaches the relay yet; the send is what uploads into
		 * `bcv_dm`. A bespoke textarea has no staging store and would upload at drop,
		 * failing this pair.
		 */
		assert.deepEqual(
			mediaCalls,
			[],
			"the drop stages the picture; nothing is uploaded yet",
		);
		assert.equal(
			app.element.querySelectorAll("[data-attachment-id]").length,
			1,
			"the staged picture is the composer's own chip",
		);
		const send = sendButton(app.element);
		assert.ok(send && !send.disabled, "send is enabled with a staged image");
		await act(async () => send.click());
		await settle();
		assert.deepEqual(
			mediaCalls.map((call) => call.request.conversationId),
			["bcv_dm"],
			"the send uploads into the existing DM",
		);
		assert.deepEqual(sends, [{ body, ids: ["batt_p1"], held: true }]);
		assert.equal(
			app.element.querySelectorAll("[data-attachment-id]").length,
			0,
			"a bound chip leaves the composer with the message",
		);
		await app.close();
	});
}

test("page R1-02: first send to a new DM stages held images under the SAME key and clears the draft", async () => {
	localStorage.clear();
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_n${++n}`);
	const keys = [];
	let staged_ids = null;
	const target = { type: "person", accountId: "acct_c" };
	const app = await mountPage(
		pageProps({
			people: [
				{ account_id: "acct_b", display_label: "Bea", email: "b@example.com" },
				{ account_id: "acct_c", display_label: "Cy", email: "c@example.com" },
			],
			target,
			onSend: async (_sent, clientRef, attachments) => {
				keys.push(clientRef);
				assert.ok(attachments?.stageHeld, "no DM yet: images are held");
				// The container creates the DM, then stages into it, then posts.
				staged_ids = await attachments.stageHeld("bcv_new", "org_page");
				keys.push(clientRef);
			},
		}),
	);
	await typeBody(app.element, "hello");
	await dropImage(app.element);
	assert.equal(mediaCalls.length, 0, "held, not uploaded, before the send");
	await act(async () => sendButton(app.element).click());
	for (let i = 0; i < 5; i += 1) await settle();
	assert.deepEqual(staged_ids, ["batt_n1"]);
	const store = Object.keys(localStorage)
		.filter((key) => key.includes("org_page"))
		.map((key) => JSON.parse(localStorage.getItem(key)));
	const entry = store
		.map((drafts) => drafts[m.draftTargetKey(target)])
		.find(Boolean);
	assert.equal(
		entry?.body ?? "",
		"",
		"the sent text does not come back as a draft",
	);
	assert.equal(
		entry?.attachments,
		undefined,
		"bound ids are not left behind for a later send",
	);
	assert.equal(
		app.element.querySelectorAll("[data-attachment-chip]").length,
		0,
	);
	await app.close();
});

test("page R2-01: an image dropped DURING a send stays in the composer and the draft", async () => {
	localStorage.clear();
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_d${++n}`);
	const sends = [];
	let release;
	const target = { type: "person", accountId: "acct_b" };
	const app = await mountPage(
		pageProps({
			target,
			onSend: async (sent, _clientRef, attachments) => {
				// The container's own sequence: stage the paths into the conversation the
				// request addresses, then post - and stay in flight until the test settles it.
				const ids = await attachments.stageHeld("bcv_dm", "org_page");
				sends.push({ body: sent, ids: [...ids] });
				return new Promise((resolve) => {
					release = resolve;
				});
			},
		}),
	);
	await typeBody(app.element, "first");
	await dropImage(app.element);
	await act(async () => sendButton(app.element).click());
	await settle();
	assert.deepEqual(sends, [{ body: "first", ids: ["batt_d1"] }]);
	assert.equal(
		mediaCalls.length,
		1,
		"the send uploaded the picture it carried",
	);
	// The author keeps working while the POST is in flight.
	await dropImage(app.element);
	/*
	 * WHAT THE OLD ASSERTIONS PINNED: a mid-flight drop uploaded at once (`mediaCalls`
	 * grew) and left a `ready` chip in the bridge's own strip, with the hub's
	 * descriptor in the journal's `attachments` array.
	 *
	 * THE NEW TRUTH: the composer's chips are local files until a request binds them,
	 * so a drop during an in-flight send STAGES and uploads nothing - the next send is
	 * what would bind it. What must survive is the staged picture itself: one chip on
	 * the box, and that path persisted in `conversation-input-store` (the one owner of
	 * composer content), which is what a remount reads back.
	 */
	assert.equal(
		mediaCalls.length,
		1,
		"the mid-send drop stages; nothing uploads until a send carries it",
	);
	await act(async () => release());
	for (let i = 0; i < 5; i += 1) await settle();
	assert.equal(
		app.element.querySelectorAll("[data-attachment-id]").length,
		1,
		"only the sent image left the composer; the mid-send drop stayed",
	);
	const stagedRow = Object.values(
		JSON.parse(localStorage.getItem("conversation-input-store") ?? "{}").state
			?.inputByConversation ?? {},
	).find((row) => row?.attachments?.length);
	assert.deepEqual(
		stagedRow?.attachments?.map((attachment) => attachment.path) ?? [],
		["/fixtures/dropped-2.png"],
		"the unsent image survives in the composer's durable row",
	);
	assert.equal(
		stagedRow?.currentInput ?? "",
		"",
		"the sent text does not come back",
	);
	await app.close();
});

/*
 * Round 3 (R3-01): the schedule twin of `page R2-01`, and the R2-02 alert
 * suppression. Both paths were remediated without a pinning test.
 */
test("page R3-01: an image dropped DURING a schedule stays in the composer and the draft", async () => {
	localStorage.clear();
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_s${++n}`);
	const schedules = [];
	let release;
	const target = { type: "person", accountId: "acct_b" };
	const app = await mountPage(
		pageProps({
			target,
			onSend: async () => {},
			onSchedule: async (
				_body,
				_clientRef,
				_sendAt,
				_cid,
				_ack,
				attachments,
			) => {
				// `scheduleBody` stages inside the schedule the same way a send does.
				const ids = await attachments.stageHeld("bcv_dm", "org_page");
				schedules.push([...ids]);
				return new Promise((resolve) => {
					release = resolve;
				});
			},
		}),
	);
	await typeBody(app.element, "later");
	await dropImage(app.element);
	await act(async () =>
		app.element.querySelector('button[aria-label="Schedule message"]').click(),
	);
	const dialog = document.querySelector('[role="dialog"]');
	const input = dialog.querySelector('input[type="datetime-local"]');
	await act(async () => {
		Object.getOwnPropertyDescriptor(
			window.HTMLInputElement.prototype,
			"value",
		).set.call(
			input,
			m.scheduledLocalInput(new Date(Date.now() + 7_200_000).toISOString()),
		);
		input.dispatchEvent(new window.Event("input", { bubbles: true }));
	});
	const action = () =>
		[...dialog.querySelectorAll("button")].find(
			(button) =>
				button.textContent === "Review schedule" ||
				button.textContent === "Confirm schedule",
		);
	await act(async () => action().click());
	await act(async () => action().click());
	await settle();
	assert.deepEqual(schedules, [["batt_s1"]]);
	assert.equal(
		mediaCalls.length,
		1,
		"the schedule uploaded the image it carried",
	);
	await dropImage(app.element);
	/*
	 * WHAT THE OLD ASSERTIONS PINNED: a mid-flight drop uploaded at once (`mediaCalls`
	 * grew) and left a `ready` chip in the bridge's own strip, with the hub's
	 * descriptor in the journal's `attachments` array.
	 *
	 * THE NEW TRUTH: the composer's chips are local files until a request binds them,
	 * so a drop during an in-flight send STAGES and uploads nothing - the next send is
	 * what would bind it. What must survive is the staged picture itself: one chip on
	 * the box, and that path persisted in `conversation-input-store` (the one owner of
	 * composer content), which is what a remount reads back.
	 */
	assert.equal(
		mediaCalls.length,
		1,
		"the mid-schedule drop stages; nothing uploads until a schedule carries it",
	);
	await act(async () => release());
	for (let i = 0; i < 5; i += 1) await settle();
	assert.equal(
		app.element.querySelectorAll("[data-attachment-id]").length,
		1,
		"only the scheduled image left the composer",
	);
	const stagedRow = Object.values(
		JSON.parse(localStorage.getItem("conversation-input-store") ?? "{}").state
			?.inputByConversation ?? {},
	).find((row) => row?.attachments?.length);
	assert.deepEqual(
		stagedRow?.attachments?.map((attachment) => attachment.path) ?? [],
		["/fixtures/dropped-2.png"],
		"the unscheduled image survives in the composer's durable row",
	);
	await app.close();
});

test("page R3-01: with no hub capability, a staged picture blocks the send with the strip note only", async () => {
	localStorage.clear();
	mediaCalls = [];
	const target = { type: "person", accountId: "acct_b" };
	const sends = [];
	const app = await mountPage(
		pageProps({
			target,
			attachmentCapability: null,
			onSend: async (sent, _ref, attachments) => {
				sends.push({ sent, ids: attachments?.ids });
			},
		}),
	);
	await settle();
	/*
	 * WHAT THE OLD CASE PINNED: chips RESTORED from the bridge's own descriptor
	 * journal, because the bespoke composer drew hub descriptors it had persisted.
	 *
	 * THE NEW TRUTH: a composer chip is a local PATH in `conversation-input-store`;
	 * hub descriptors are the message surface's business, not the box's. The claim
	 * that survives - and the reason this case exists - is that a staged picture
	 * against a hub without the capability cannot be sent, is refused in the strip's
	 * own words, and raises no "marked with an error" alert. A staged path is the only
	 * shape the box has now, so it is what the case stages.
	 */
	const field = app.element.querySelector("textarea");
	assert.ok(field, "the composer renders");
	await typeBody(app.element, "hello");
	await dropImage(app.element);
	assert.equal(
		app.element.querySelectorAll("[data-attachment-id]").length,
		1,
		"the picture is staged on the box",
	);
	// Enter submits; the page's capability guard refuses the whole payload.
	await act(async () =>
		field.dispatchEvent(
			new window.KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		),
	);
	await settle();
	assert.deepEqual(
		sends,
		[],
		"nothing is sent to a hub that cannot take images",
	);
	assert.deepEqual(
		mediaCalls,
		[],
		"and nothing is uploaded either: the refusal precedes staging",
	);
	/*
	 * WHAT THE OLD ASSERTION PINNED: no alert at all, because the bespoke strip
	 * carried the note in a `role="status"` line of its own.
	 *
	 * THE NEW TRUTH: the sentence is the PAGE's refusal (`sendRefusal.kind ===
	 * "capability"`), drawn in the composer's error paragraph, and it is the one
	 * sentence this state may say - not the generic "marked with an error" copy, and
	 * not a second sentence stacked beside it. Asserting the exact set is what keeps
	 * a future generic banner from slipping in as "still one alert".
	 */
	assert.deepEqual(
		[...app.element.querySelectorAll('[role="alert"]')].map(
			(node) => node.textContent,
		),
		["Images can’t be sent in this organization yet."],
	);
	assert.equal(
		app.element.querySelectorAll("[data-attachment-id]").length,
		1,
		"a refused send leaves the picture staged for a hub that later allows it",
	);
	await app.close();
});

test("hook R3-02: a 404 expires only the ids the request carried", async () => {
	mediaCalls = [];
	let n = 0;
	mediaAnswer = () => staged(`batt_x${++n}`);
	const app = await mountHook({
		scopeKey: "dm",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_dm",
		capability: CAP,
	});
	await act(async () => hook.add([new Blob([PNG]), new Blob([JPEG])]));
	for (let i = 0; i < 5; i += 1) await settle();
	assert.deepEqual(hook.readyIds(), ["batt_x1", "batt_x2"]);
	await act(async () => hook.markExpired(["batt_x1"]));
	assert.deepEqual(
		hook.chips.map((chip) => chip.status),
		["expired", "ready"],
		"the image added mid-send was never sent, so it is not expired",
	);
	await app.close();
});

/*
 * Fail-fast guards for page tests that can regress into a runaway. Reverting
 * the R4-02 fix put the page into an unbounded render/memory loop (a 3 GB,
 * 120 s capped run timed out instead of failing; two uncapped runs were
 * killed by the host's memory guard). A regression must be an ASSERTION:
 * - `renderBudget` throws from inside render once a component has rendered
 *   more than `limit` times, which stops a synchronous render loop that would
 *   otherwise starve every timer;
 * - `within` rejects when an async step has not settled in `ms`, which stops
 *   a loop that keeps yielding to the event loop.
 */
function renderBudget(limit, what) {
	let renders = 0;
	return {
		tick() {
			renders += 1;
			if (renders > limit)
				throw new assert.AssertionError({
					message: `${what} rendered more than ${limit} times (runaway render loop)`,
				});
		},
		get count() {
			return renders;
		},
	};
}
function within(ms, promise, what) {
	let timer;
	return Promise.race([
		promise,
		new Promise((_, reject) => {
			timer = setTimeout(
				() =>
					reject(
						new assert.AssertionError({
							message: `${what} did not settle within ${ms} ms`,
						}),
					),
				ms,
			);
		}),
	]).finally(() => clearTimeout(timer));
}

test("fail-fast guards: the render budget and the settle bound turn a runaway into an assertion", async () => {
	const budget = renderBudget(3, "probe");
	budget.tick();
	budget.tick();
	budget.tick();
	assert.equal(budget.count, 3);
	assert.throws(() => budget.tick(), /rendered more than 3 times/);
	await assert.rejects(
		within(20, new Promise(() => {}), "a step that never settles"),
		/did not settle within 20 ms/,
	);
	assert.equal(
		await within(1000, Promise.resolve("ok"), "a settled step"),
		"ok",
	);
});

/*
 * Round 4 (R4-02): with a thread open, the Drafts/Scheduled quick views must
 * close it. Below 1024px the thread overlays the whole region and hides the
 * section, so a quick view under an open thread changed nothing visible. JSDOM
 * cannot evaluate container queries, so this pins the state the CSS keys on:
 * the overlay is unmounted and the close hook fires.
 */
test(
	"page R4-02: opening Drafts or Scheduled closes an open thread",
	{
		timeout: 30_000,
	},
	async () => {
		for (const label of ["Drafts", "Scheduled"]) {
			localStorage.clear();
			let closed = 0;
			// Each page render while the thread is open calls the probe; a handful
			// is normal (mount, effects, the click). Far more is the runaway.
			const budget = renderBudget(40, "the thread probe");
			const app = await mountPage(
				pageProps({
					target: { type: "conversation", id: "bcv_dm" },
					/* The thread lane is capability-gated; this fixture exercises the
					   page's own close-on-quick-view wiring, so it states the enabled
					   capability rather than relying on a default. */
					threadsCapabilityState: "enabled",
					threadLink: {
						tenantId: "org_page",
						conversationId: "bcv_dm",
						rootId: "bcmsg_root",
					},
					renderThreadPane: () => {
						budget.tick();
						return React.createElement("div", { "data-thread-probe": "" });
					},
					onCloseThread: () => {
						closed += 1;
					},
					onSend: async () => {},
				}),
			);
			// try/finally: a failing assertion must still unmount, or the mounted
			// Scheduled view keeps the test process alive (seen as a runaway run
			// while negative-controlling this fix).
			try {
				assert.ok(
					app.element.querySelector("[data-thread-probe]"),
					"the thread is open before the quick view",
				);
				const button = [...app.element.querySelectorAll("nav button")].find(
					(node) => node.textContent === label,
				);
				assert.ok(button, `${label} quick view button`);
				await within(
					5_000,
					// An async wrapper, not `act(...).then(...)`: React's act thenable
					// does not return a promise from `then`, so the race would win
					// at once and leave the act scope open.
					(async () => {
						await act(async () => button.click());
						await settle();
					})(),
					`${label} click`,
				);
				assert.equal(
					app.element.querySelector("[data-thread-probe]"),
					null,
					`${label} closes the thread overlay`,
				);
				assert.equal(closed, 1, `${label} notifies the thread owner once`);
				assert.equal(button.getAttribute("aria-current"), "page");
			} finally {
				await app.close();
			}
		}
	},
);

/*
 * #1309 integration (6b0de644ac): SSR has no browser storage and a browser
 * policy can deny the `localStorage` getter. Every team-bridge storage access
 * goes through the nullable `browserDraftStorage()`; this pins that the
 * ATTACHMENT paths this PR added (restored descriptors, a fresh upload's
 * descriptor, message tiles) and the status client's account fence neither
 * crash nor write anything when storage is unavailable.
 */
test("denied browser storage: attachment draft and descriptor paths render, read and persist nothing", async () => {
	localStorage.clear();
	const descriptor = Object.getOwnPropertyDescriptor(window, "localStorage");
	/*
	 * BOTH bindings are denied (R6-02). The harness binds
	 * `globalThis.localStorage` to JSDOM's store separately from
	 * `window.localStorage`, so denying only the window left a bare
	 * `localStorage` in source reaching a working store - the test passed
	 * with the bug present. Same shape as team-bridge-directory.test.mjs.
	 */
	const globalDescriptor = Object.getOwnPropertyDescriptor(
		globalThis,
		"localStorage",
	);
	let reads = 0;
	const denied = {
		configurable: true,
		get() {
			reads += 1;
			throw new Error("browser storage denied");
		},
	};
	Object.defineProperty(window, "localStorage", denied);
	Object.defineProperty(globalThis, "localStorage", denied);
	mediaCalls = [];
	mediaAnswer = (request) =>
		request.op === "team_bridge.attachment"
			? { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
			: staged("batt_denied1");
	let app;
	let list;
	const realRequest = window.api.desktop.request;
	try {
		// Harness self-check: a bare `localStorage` read (what the pre-fix
		// status clients did) now throws, so a reintroduced bare read fails
		// the identity() assertion below instead of finding a working store.
		assert.throws(() => localStorage, /browser storage denied/);
		assert.throws(() => globalThis.localStorage, /browser storage denied/);
		assert.throws(() => window.localStorage, /browser storage denied/);
		// And the pre-fix status-client shape, called through the real
		// reconcileDraftAccount, now rejects: the harness would catch it.
		await assert.rejects(
			(async () =>
				m.reconcileDraftAccount(localStorage, { state: "signed_out" }))(),
			/browser storage denied/,
		);
		assert.equal(
			m.browserDraftStorage(),
			null,
			"a throwing getter reads as no storage",
		);
		app = await mountPage(
			pageProps({
				target: { type: "person", accountId: "acct_b" },
				onSend: async () => {},
			}),
		);
		await settle();
		assert.ok(app.element.querySelector("textarea"), "the composer renders");
		await dropImage(app.element);
		/*
		 * WHAT THE OLD ASSERTION PINNED: the drop uploaded at once and left a `ready`
		 * hub-descriptor chip in the bridge's strip.
		 *
		 * THE NEW TRUTH: the drop stages a local path on the composer, and the upload
		 * happens when a send carries it. With storage denied the store still holds the
		 * chip IN MEMORY - the thing this case is about - so the assertion is the
		 * composer's own chip, not a relay call.
		 */
		assert.equal(
			mediaCalls.length,
			0,
			"nothing uploads until a send carries it",
		);
		assert.equal(
			app.element.querySelectorAll("[data-attachment-id]").length,
			1,
			"the chip is usable in memory",
		);
		list = await renderList([
			message({
				body: "",
				attachments: [
					{
						id: "batt_ok",
						mime: "image/png",
						size: 10,
						width: 4,
						height: 3,
						state: "bound",
					},
				],
			}),
		]);
		assert.ok(list.element.querySelector("img"), "a message tile renders");
		// The status client's account fence (team-bridge-api.ts identity/status).
		window.api.desktop.request = async () => ({
			status: 200,
			body: {
				result: {
					state: "signed_out",
					account_id: null,
					tenant_id: null,
				},
			},
		});
		await assert.doesNotReject(
			m.TeamBridgeApi.identity(),
			"identity reconciles drafts without storage",
		);
		assert.ok(reads > 0, "the guarded getter was actually exercised");
	} finally {
		window.api.desktop.request = realRequest;
		if (list) await list.close();
		if (app) await app.close();
		Object.defineProperty(window, "localStorage", descriptor);
		if (globalDescriptor)
			Object.defineProperty(globalThis, "localStorage", globalDescriptor);
		else Reflect.deleteProperty(globalThis, "localStorage");
	}
	/*
	 * WHAT THE OLD ASSERTION PINNED: an empty `localStorage`, because the bridge wrote
	 * its attachment descriptors itself.
	 *
	 * THE NEW TRUTH: the shared composer's store persists its OWN row (an empty one
	 * after the box clears), and that row is not attachment data. The claim this case
	 * exists for is narrower and still exact: no PICTURE was persisted - no row holds
	 * an attachment, in the composer's store or in the bridge's draft journal.
	 */
	for (const key of ["conversation-input-store"]) {
		const stored = JSON.parse(localStorage.getItem(key) ?? "{}");
		for (const row of Object.values(stored.state?.inputByConversation ?? {}))
			assert.deepEqual(
				row?.attachments ?? [],
				[],
				`${key} persisted no staged picture`,
			);
	}
	assert.deepEqual(
		Object.keys(localStorage).filter((key) =>
			key.startsWith("teamBridge.drafts."),
		),
		[],
		"no bridge draft row (the descriptor path) was written",
	);

	// SSR: no `window` at all.
	const savedWindow = globalThis.window;
	try {
		globalThis.window = undefined;
		assert.equal(
			m.browserDraftStorage(),
			null,
			"no window reads as no storage",
		);
		assert.doesNotThrow(() =>
			m.reconcileDraftAccount(m.browserDraftStorage(), {
				state: "signed_out",
				account_id: null,
			}),
		);
	} finally {
		globalThis.window = savedWindow;
	}
});

test("QA Q3: a 401 upload marks the chip signed_out and says so with the sign-in sentence", async () => {
	mediaCalls = [];
	mediaAnswer = () => ({
		status: 401,
		kind: "error",
		detail: "x",
		// The runtime's real refusal code for a lost sign-in (review r7 N1).
		code: "bridge_signin_required",
	});
	const app = await mountHook({
		scopeKey: "q3",
		accountId: "acct_a",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: CAP,
	});
	try {
		await act(async () => hook.add([new Blob([PNG])]));
		await settle();
		await settle();
		const [chip] = hook.chips;
		assert.equal(chip.status, "error");
		assert.equal(chip.reason, "signed_out");
		const view = document.createElement("div");
		document.body.append(view);
		const root = createRoot(view);
		await act(async () =>
			root.render(
				React.createElement(m.TeamBridgeAttachmentChip, {
					chip,
					index: 0,
					count: 1,
					onRemove: () => {},
					onRetry: () => {},
				}),
			),
		);
		const sentence = m.t("ui.teamBridge.plan.sign_in_reason");
		assert.ok(
			view.textContent.includes(sentence) ||
				[
					...view.querySelectorAll("[aria-label],[title],[aria-description]"),
				].some((node) =>
					[
						node.getAttribute("aria-label"),
						node.getAttribute("title"),
						node.getAttribute("aria-description"),
					]
						.join(" ")
						.includes(sentence),
				),
			"the chip names the sign-in fact, not a generic upload failure",
		);
		// r7 M2: Retry would 401 again until sign-in, so it is not offered.
		const retryLabel = m.t("ui.teamBridge.attachments.retry", {
			label: m.t("ui.teamBridge.attachments.position", {
				index: "1",
				count: "1",
			}),
		});
		assert.equal(
			view.querySelector(`[aria-label="${retryLabel}"]`),
			null,
			"a signed_out chip offers Remove only",
		);
		const removeLabel = m.t("ui.teamBridge.attachments.remove", {
			label: m.t("ui.teamBridge.attachments.position", {
				index: "1",
				count: "1",
			}),
		});
		assert.ok(
			view.querySelector(`[aria-label="${removeLabel}"]`),
			"Remove is still there, by its own label (r8 n1)",
		);
		await act(async () => root.unmount());
		view.remove();
	} finally {
		await app.close();
	}
});

/*
 * F9 (live E2E): stick-to-bottom. JSDOM has no layout, so the Radix viewport's
 * geometry is modelled here: `scrollHeight` grows with the rendered rows
 * (ROW px each), `clientHeight` is fixed, and `scrollTop` is clamped to
 * [0, scrollHeight - clientHeight] like a browser does. What is measured is
 * the hook's DECISIONS (open at bottom, pin on own send, follow vs not yank),
 * not Chromium's scroll physics; the story frames cover the rendered pixels.
 */
const ROW = 120;
const CLIENT = 400;
function withScrollGeometry(run) {
	const proto = window.HTMLElement.prototype;
	const saved = {
		scrollHeight: Object.getOwnPropertyDescriptor(proto, "scrollHeight"),
		clientHeight: Object.getOwnPropertyDescriptor(proto, "clientHeight"),
		scrollTop: Object.getOwnPropertyDescriptor(proto, "scrollTop"),
	};
	const tops = new WeakMap();
	const isViewport = (el) => el.hasAttribute("data-radix-scroll-area-viewport");
	// `data-test-extra-height` models growth that is NOT a message row (a
	// reply rollup, a reaction, a wrapped line) - the case r8 m1 is about.
	const height = (el) =>
		isViewport(el)
			? el.querySelectorAll("[data-message-id]").length * ROW +
				200 +
				[...el.querySelectorAll("[data-test-extra-height]")].reduce(
					(sum, node) => sum + Number(node.dataset.testExtraHeight),
					0,
				)
			: 0;
	Object.defineProperty(proto, "scrollHeight", {
		configurable: true,
		get() {
			return height(this);
		},
	});
	Object.defineProperty(proto, "clientHeight", {
		configurable: true,
		get() {
			return isViewport(this) ? CLIENT : 0;
		},
	});
	Object.defineProperty(proto, "scrollTop", {
		configurable: true,
		get() {
			return tops.get(this) ?? 0;
		},
		set(value) {
			const max = Math.max(0, height(this) - CLIENT);
			tops.set(this, Math.max(0, Math.min(max, value)));
		},
	});
	const restore = () => {
		for (const [name, descriptor] of Object.entries(saved))
			if (descriptor) Object.defineProperty(proto, name, descriptor);
			else Reflect.deleteProperty(proto, name);
	};
	return Promise.resolve().then(run).finally(restore);
}
const viewportOf = (element) =>
	element.querySelector("[data-radix-scroll-area-viewport]");
const atBottom = (viewport) =>
	viewport.scrollHeight - viewport.scrollTop - viewport.clientHeight <= 1;
const thread = (n) =>
	Array.from({ length: n }, (_, i) =>
		message({
			id: `bmsg_r${i + 1}`,
			seq: i + 2,
			body: `reply ${i + 1}`,
			thread_root_id: "bmsg_1",
		}),
	);
async function scrollTo(viewport, top) {
	await act(async () => {
		viewport.scrollTop = top;
		viewport.dispatchEvent(new window.Event("scroll"));
	});
}

test("F9 harness self-check: an overflowing viewport left alone is NOT at the bottom", () =>
	withScrollGeometry(async () => {
		const viewport = document.createElement("div");
		viewport.setAttribute("data-radix-scroll-area-viewport", "");
		for (let i = 0; i < 8; i += 1) {
			const row = document.createElement("div");
			row.dataset.messageId = `x${i}`;
			viewport.append(row);
		}
		// What F9 measured: scrollTop 0 with the newest row below the fold.
		assert.equal(viewport.scrollTop, 0);
		assert.ok(viewport.scrollHeight > viewport.clientHeight);
		assert.equal(
			atBottom(viewport),
			false,
			"the pre-fix state fails the assertion",
		);
		viewport.scrollTop = 1e9;
		assert.ok(atBottom(viewport), "clamped like a browser");
	}));

test(
	"F9 thread pane: opens at the newest reply, follows when pinned, never yanks a reader who scrolled up",
	{
		timeout: 30_000,
	},
	() =>
		withScrollGeometry(async () => {
			const element = document.createElement("div");
			document.body.append(element);
			const root = createRoot(element);
			const props = (replies, extra = {}) => ({
				root: message({ id: "bmsg_1", body: "root" }),
				replies,
				state: "ready",
				labelFor: (sender) => sender.display_label,
				onClose: () => {},
				onRetry: () => {},
				onSend: async () => {},
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				...extra,
			});
			const render = (replies, extra) =>
				act(async () =>
					root.render(
						React.createElement(
							m.TeamBridgeThreadPaneView,
							props(replies, extra),
						),
					),
				);
			try {
				await render(thread(8));
				const viewport = viewportOf(element);
				assert.ok(viewport, "the thread has a Radix viewport");
				assert.ok(
					viewport.scrollHeight > viewport.clientHeight,
					"the fixture overflows",
				);
				assert.ok(
					atBottom(viewport),
					"opens at the newest reply, not scrollTop 0",
				);

				// Pinned: a new reply keeps the view at the bottom.
				await render(thread(9));
				assert.ok(atBottom(viewport), "a new reply while pinned stays in view");

				// Scrolled up: a new reply does not move the reader.
				await scrollTo(viewport, 100);
				await render(thread(10));
				assert.equal(
					viewport.scrollTop,
					100,
					"a reader who scrolled up is not yanked",
				);

				// Own send: jump to the bottom, then the reply lands in view.
				const field = element.querySelector("textarea");
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLTextAreaElement.prototype,
					"value",
				).set;
				await act(async () => {
					setter.call(field, "mine");
					field.dispatchEvent(new window.Event("input", { bubbles: true }));
				});
				const send = sendButton(element);
				assert.ok(send, "thread send button");
				await act(async () => send.click());
				await settle();
				assert.ok(atBottom(viewport), "own send scrolls to the bottom");
				await render(thread(11));
				assert.ok(atBottom(viewport), "the sent reply lands in view");
			} finally {
				await act(async () => root.unmount());
				element.remove();
			}
		}),
);

test(
	"F9 channel timeline: opens at the newest message, own send pins, scrolled-up reader stays put",
	{ timeout: 30_000 },
	() =>
		withScrollGeometry(async () => {
			localStorage.clear();
			const many = (n) =>
				Array.from({ length: n }, (_, i) =>
					message({
						id: `bmsg_t${i + 1}`,
						seq: i + 1,
						conversation_id: "bcv_dm",
						body: `m ${i + 1}`,
					}),
				);
			const sends = [];
			const base = {
				target: { type: "conversation", id: "bcv_dm" },
				onSend: async (body) => {
					sends.push(body);
				},
			};
			const app = await mountPage(pageProps({ ...base, messages: many(10) }));
			try {
				const viewports = [
					...app.element.querySelectorAll("[data-radix-scroll-area-viewport]"),
				].filter((node) => node.querySelector("[data-message-id]"));
				assert.equal(viewports.length, 1, "one timeline viewport");
				const [viewport] = viewports;
				assert.ok(
					viewport.scrollHeight > viewport.clientHeight,
					"the fixture overflows",
				);
				assert.ok(atBottom(viewport), "opens at the newest message");

				await app.render(pageProps({ ...base, messages: many(11) }));
				assert.ok(
					atBottom(viewport),
					"an incoming message while pinned stays in view",
				);

				await scrollTo(viewport, 50);
				await app.render(pageProps({ ...base, messages: many(12) }));
				assert.equal(
					viewport.scrollTop,
					50,
					"a reader who scrolled up is not yanked",
				);

				await typeBody(app.element, "mine");
				await act(async () => sendButton(app.element).click());
				await settle();
				assert.deepEqual(sends, ["mine"]);
				assert.ok(atBottom(viewport), "own send scrolls to the bottom");
				await app.render(pageProps({ ...base, messages: many(13) }));
				assert.ok(atBottom(viewport), "the sent message lands in view");
			} finally {
				await app.close();
			}
		}),
);

/*
 * r8 m1 / m2. A recording ResizeObserver stands in for the browser's (JSDOM has
 * none): `fire(node)` delivers a resize for a node ONLY if the hook observes it,
 * so a hook still watching the timeline's fixed h-full wrapper fails here.
 */
function withResizeObserver(run) {
	const saved = globalThis.ResizeObserver;
	const observers = [];
	globalThis.ResizeObserver = class {
		constructor(callback) {
			this.callback = callback;
			this.targets = new Set();
			observers.push(this);
		}
		observe(target) {
			this.targets.add(target);
		}
		unobserve(target) {
			this.targets.delete(target);
		}
		disconnect() {
			this.targets.clear();
		}
	};
	const fire = (node) =>
		act(async () => {
			for (const observer of observers)
				if (observer.targets.has(node))
					observer.callback([{ target: node }], observer);
		});
	return Promise.resolve()
		.then(() => run(fire))
		.finally(() => {
			globalThis.ResizeObserver = saved;
		});
}

test(
	"r8 m1: non-message growth in the channel timeline keeps a pinned reader at the bottom",
	{ timeout: 30_000 },
	() =>
		withScrollGeometry(() =>
			withResizeObserver(async (fire) => {
				localStorage.clear();
				const many = Array.from({ length: 10 }, (_, i) =>
					message({
						id: `bmsg_g${i + 1}`,
						seq: i + 1,
						conversation_id: "bcv_dm",
						body: `g ${i + 1}`,
					}),
				);
				const app = await mountPage(
					pageProps({
						target: { type: "conversation", id: "bcv_dm" },
						messages: many,
						onSend: async () => {},
					}),
				);
				try {
					const viewport = [
						...app.element.querySelectorAll(
							"[data-radix-scroll-area-viewport]",
						),
					].find((node) => node.querySelector("[data-message-id]"));
					assert.ok(atBottom(viewport), "opens at the bottom");
					// The inner column (the wrapper's child) grows by 300px; no message
					// was added, so contentKey does not change.
					const column = viewport.firstElementChild.firstElementChild;
					assert.ok(column, "the timeline's inner column");
					const growth = document.createElement("div");
					growth.dataset.testExtraHeight = "300";
					column.append(growth);
					assert.equal(
						atBottom(viewport),
						false,
						"the growth pushed the bottom away",
					);
					await fire(column);
					assert.ok(
						atBottom(viewport),
						"the observer on the inner column re-pinned",
					);
				} finally {
					await app.close();
				}
			}),
		),
);

test(
	"r8 m2: Load more replies keeps the reader's place instead of jumping past the new page",
	{
		timeout: 30_000,
	},
	() =>
		withScrollGeometry(async () => {
			const element = document.createElement("div");
			document.body.append(element);
			const root = createRoot(element);
			let more = 0;
			const render = (replies, hasMore) =>
				act(async () =>
					root.render(
						React.createElement(m.TeamBridgeThreadPaneView, {
							root: message({ id: "bmsg_1", body: "root" }),
							replies,
							state: "ready",
							labelFor: (sender) => sender.display_label,
							onClose: () => {},
							onRetry: () => {},
							onSend: async () => {},
							tenantId: "tnt_1",
							conversationId: "bcv_1",
							hasMore,
							onMore: () => {
								more += 1;
							},
						}),
					),
				);
			try {
				await render(thread(8), true);
				const viewport = viewportOf(element);
				assert.ok(
					atBottom(viewport),
					"the reader is at the bottom, by the button",
				);
				const before = viewport.scrollTop;
				const button = [...element.querySelectorAll("button")].find(
					(node) => node.textContent === m.t("ui.teamBridge.replies.more"),
				);
				assert.ok(button, "Load more replies");
				await act(async () => button.click());
				assert.equal(more, 1);
				await render(thread(16), false);
				assert.equal(
					viewport.scrollTop,
					before,
					"the new page appears below; the reader reads it from where they were",
				);
				assert.equal(atBottom(viewport), false);
			} finally {
				await act(async () => root.unmount());
				element.remove();
			}
		}),
);

test("R1-01: an account change is its own sentence — never a quota, never a sign-out", async () => {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(m.TeamBridgeAttachmentChip, {
					chip: {
						key: "k1",
						status: "error",
						reason: "account_mismatch",
						prepared: { bytes: PNG, mime: "image/png" },
					},
					index: 0,
					count: 1,
				}),
			),
		);
		const text = element.textContent;
		assert.match(
			text,
			/Signed-in account has changed since this message was started/i,
			"the account-change sentence is shown",
		);
		assert.equal(
			/signed out/i.test(text),
			false,
			"a sign-out is a different fact and must not be claimed",
		);
		assert.equal(
			/too many images/i.test(text),
			false,
			"the quota sentence is reserved for the actual limit refusal",
		);
		// A retry would 409 again until the account is resolved.
		assert.equal(
			[...element.querySelectorAll("button")].some((button) =>
				/retry/i.test(button.textContent ?? ""),
			),
			false,
			"no Retry on an account mismatch",
		);
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});

test("R1-01: a bare 409 is not read as the image quota either", () => {
	assert.equal(m.uploadFailure(409), "failed");
	assert.equal(m.uploadFailure(400), "limit");
	assert.equal(m.uploadFailure(409, "account_mismatch"), "account_mismatch");
	assert.equal(m.uploadFailure(401), "signed_out");
});

test("R1-02: the delete receipt is required by the shipped schema", () => {
	const base = {
		op: "team_bridge.attachments.delete",
		tenant_id: "tnt_1",
		conversation_id: "bcv_1",
		attachment_id: "batt_1",
	};
	assert.equal(
		m.desktopRequestSchema.safeParse(base).success,
		false,
		"no receipt is refused before the route",
	);
	assert.equal(
		m.desktopRequestSchema.safeParse({ ...base, expected_account_id: "" })
			.success,
		false,
		"a blank receipt is refused",
	);
	assert.equal(
		m.desktopRequestSchema.safeParse({ ...base, expected_account_id: "acct_a" })
			.success,
		true,
	);
});
