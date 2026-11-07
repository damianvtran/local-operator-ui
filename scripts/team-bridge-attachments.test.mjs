import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import Module from "node:module";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

// Shared, non-global matchers keep this touched test file lint-ratchet clean.
const BOUND_ATTACHMENT_ID = /batt_a/;
const INLINE_BYTES = /base64|data:|iVBOR/;
const PREVIEW_BLOB_URL = /^blob:test\//;
const TERMINAL_REASON = /expired|deleted|withheld/i;
const ATTACHMENT_ID_PREFIX = /batt_/;
const MARKDOWN_ALT = /shot/;
const UNTRUSTED_IMAGE_URL = /https:\/\/evil\.example\/p\.png/;
const RENDER_LIMIT_ERROR = /rendered more than 3 times/;
const SETTLE_LIMIT_ERROR = /did not settle within 20 ms/;
const STORAGE_REFUSAL = /browser storage denied/;
const ACCOUNT_CHANGED_COPY =
	/Signed-in account has changed since this message was started/i;
const SIGNED_OUT_COPY = /signed out/i;
const IMAGE_QUOTA_COPY = /too many images/i;
const RETRY_COPY = /retry/i;
const OPAQUE_ID = /opaque/;
const COUNT_ONLY_COPY = /3 attachments/;
// Both size spellings: the raw count the bordered card printed, and the human
// `2 KB` the chips print since the inline-image refresh (agent review round 1,
// minor 2) - a size must not leak onto a refused or expired tile in either.
const PRIVATE_TERMINAL_METADATA =
	/expired|withheld|deleted|unknown|revoked|opaque|2,048|\bKB\b/;
const GENERIC_FILE_COPY = /File/;
// A human size on the chip (`2 KB`), never the raw "2,048 bytes" receipt the
// bordered card printed before the inline-image refresh (SPEC §3.1).
const HUMAN_SIZE = /2 KB/;
const RAW_BYTE_COUNT = /bytes/;
const PRIVATE_FILE_METADATA = /secret|script|private/;
const TINY_RESERVED_BOX = /width: 64px; height: 64px/;

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
 export {OwnerAuditPanelView} from "./src/renderer/src/features/team-bridge/team-bridge-owner-audit";
 export {BridgeAttachmentGroup, BridgeFileGroup} from "./src/renderer/src/features/team-bridge/attachments/bridge-attachment-group";
 export {AuditAttachmentGroup} from "./src/renderer/src/features/team-bridge/attachments/audit-attachment-group";
 export {fileSaveFailure, fileSaveName, fileView, middleTruncateFileName, splitFileNameTail, toBridgeFileDescriptor} from "./src/renderer/src/features/team-bridge/attachments/attachment-model";
 export {ownerAuditMessageSchema} from "./src/shared/team-bridge-owner-audit-contract";
 export {attachmentBox, attachmentFit} from "./src/renderer/src/features/team-bridge/attachments/attachment-model";
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
 export {TeamBridgeAttachmentChip, attachmentPasteHandlers} from "./src/renderer/src/features/team-bridge/team-bridge-attachments";
 export {t} from "./src/renderer/src/shared/i18n";
 export {browserDraftStorage} from "./src/renderer/src/shared/store/team-bridge-draft-account";
 export {TeamBridgeApi} from "./src/renderer/src/shared/api/local-operator/team-bridge-api";
 export {resetPendingSendsForTest, usePendingSends} from "./src/renderer/src/features/team-bridge/team-bridge-pending-sends";
 export {TeamBridgeFilesStrip} from "./src/renderer/src/features/team-bridge/team-bridge-files-strip";
 export {useTeamBridgeFiles, filesCapability, splitBridgeFiles} from "./src/renderer/src/features/team-bridge/use-team-bridge-files";
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
	/*
	 * THE SAME REASON AS THE INPUT STORE, ONE LAYER DOWN: optimistic sends live in
	 * a module singleton (`team-bridge-pending-sends`), so a send one case leaves
	 * unconfirmed is still there when the next case mounts the same conversation -
	 * and a second mount for a conversation carrying an extra row is a different
	 * page from the one the next case meant to build (QA round 1, r8 m1: the
	 * reader opened a row short of the end because F9's "mine" was still pending).
	 * The store is reset, never emptied at unmount: in the app a pending send must
	 * survive a remount, which `Q-2: a channel remounted...` now pins.
	 */
	m.resetPendingSendsForTest();
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
let pasteboardText = "";
const PNG_BASE64 =
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
window.api = {
	getPathForFile: () => `/fixtures/dropped-${++droppedSeq}.png`,
	// The preload's synchronous pasteboard read (#1573), set per paste case.
	readPasteTextSync: () => pasteboardText,
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
	assert.match(raw, BOUND_ATTACHMENT_ID);
	assert.doesNotMatch(raw, INLINE_BYTES, "no image bytes in storage");
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
	assert.match(imgs[0].getAttribute("src"), PREVIEW_BLOB_URL);
	const placeholders = [
		...view.element.querySelectorAll("[data-attachment-placeholder]"),
	].map((node) => node.getAttribute("data-attachment-placeholder"));
	assert.deepEqual(placeholders.sort(), ["unavailable"]);
	assert.equal(
		view.element.querySelectorAll('[data-bridge-attachment-card="unavailable"]')
			.length,
		2,
	);
	assert.doesNotMatch(view.element.textContent, TERMINAL_REASON);
	/* The ready tile's hover cluster (Open, Save) is not a retry; count the
	   controls outside it. */
	assert.equal(
		[...view.element.querySelectorAll("button")].filter(
			(node) => !node.closest("[data-attachment-actions]"),
		).length,
		1,
		"404 and terminal descriptors expose no retry",
	);
	assert.equal(
		view.element.querySelector(".team-bridge-message-body"),
		null,
		"image-only message draws no empty prose block",
	);
	assert.doesNotMatch(
		view.element.textContent,
		ATTACHMENT_ID_PREFIX,
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
	assert.match(view.element.textContent, MARKDOWN_ALT);
	assert.match(view.element.textContent, UNTRUSTED_IMAGE_URL);
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
				...(req.headers["x-bridge-file-name"]
					? { fileName: req.headers["x-bridge-file-name"] }
					: {}),
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

		// Actual HTTP relay, not a direct client call: file mode and percent-
		// encoded display name reach the existing core route unchanged.
		const fileUp = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
				mode: "file",
				fileName: "notes + résumé.txt",
			},
			new Uint8Array(6 * 1024 * 1024),
			base,
			"t0k",
		);
		assert.equal(
			fileUp.response.kind,
			"json",
			"file mode is not capped at image 5 MiB",
		);
		assert.deepEqual(seen.at(-1), {
			method: "POST",
			url: "/v1/desktop/team-bridge/conversations/bcv_1/attachments?tenant_id=tnt_1&expected_account_id=acc_1&mode=file",
			auth: true,
			type: "application/octet-stream",
			bytes: 6 * 1024 * 1024,
			fileName: "notes%20%2B%20r%C3%A9sum%C3%A9.txt",
		});
		const beforeFileRefusal = seen.length;
		const tooBigFile = await m.requestDesktopMediaOutcome(
			{
				op: "team_bridge.attachment.upload",
				tenantId: "tnt_1",
				conversationId: "bcv_1",
				expectedAccountId: "acc_1",
				mode: "file",
			},
			new Uint8Array(25 * 1024 * 1024 + 1),
			base,
			"t0k",
		);
		assert.equal(tooBigFile.response.status, 413);
		assert.equal(seen.length, beforeFileRefusal);

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
	assert.throws(() => budget.tick(), RENDER_LIMIT_ERROR);
	await assert.rejects(
		within(20, new Promise(() => {}), "a step that never settles"),
		SETTLE_LIMIT_ERROR,
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
		assert.throws(() => localStorage, STORAGE_REFUSAL);
		assert.throws(() => globalThis.localStorage, STORAGE_REFUSAL);
		assert.throws(() => window.localStorage, STORAGE_REFUSAL);
		// And the pre-fix status-client shape, called through the real
		// reconcileDraftAccount, now rejects: the harness would catch it.
		await assert.rejects(
			(async () =>
				m.reconcileDraftAccount(localStorage, { state: "signed_out" }))(),
			STORAGE_REFUSAL,
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
/*
 * THE DESCRIPTORS AS THE PROCESS STARTED WITH THEM, captured once, before any
 * test can install an override. Every run restores THESE, never "whatever was
 * installed when I started": a run that leaked (a throw outside a `finally`, two
 * runs overlapping on the shared prototype) used to hand its getter to the next
 * run's `saved`, and the next restore re-installed it - a ratchet that made a
 * viewport report `clientHeight` 520 against this file's own `CLIENT = 400` and
 * turned r8 m1 red only when it ran after another geometry test.
 */
const SCROLL_PROTO = window.HTMLElement.prototype;
const SCROLL_DESCRIPTORS = {
	scrollHeight: Object.getOwnPropertyDescriptor(SCROLL_PROTO, "scrollHeight"),
	clientHeight: Object.getOwnPropertyDescriptor(SCROLL_PROTO, "clientHeight"),
	scrollTop: Object.getOwnPropertyDescriptor(SCROLL_PROTO, "scrollTop"),
};
function withScrollGeometry(run) {
	const proto = SCROLL_PROTO;
	/* Drop anything a previous run left behind before installing ours, so no
	   stale own descriptor can shadow the model this run is about to measure. */
	for (const name of Object.keys(SCROLL_DESCRIPTORS))
		Reflect.deleteProperty(proto, name);
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
		for (const [name, descriptor] of Object.entries(SCROLL_DESCRIPTORS))
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
 * OPENING A CONVERSATION THAT WAS OPENED BEFORE (QA round 1, Q-2 / r8 m1).
 *
 * The regression only ever reproduced as a SIDE EFFECT of another test: mount
 * `bcv_dm`, send, unmount, mount `bcv_dm` again - and the second mount opened a
 * row short of the bottom. Which test ran first decided whether it showed up at
 * all, which is not a reproduction. This is the same sequence inside ONE test
 * body: mount, send with a stub that never settles (the optimistic row stays
 * pending, which is the state the pending-sends store persists per
 * conversation), unmount, remount, and ask the only question that matters:
 * is the reader at the bottom?
 */
test(
	"Q-2: a channel remounted with a still-pending send opens at the bottom",
	{ timeout: 30_000 },
	() =>
		withScrollGeometry(async () => {
			localStorage.clear();
			m.resetPendingSendsForTest();
			const rows = Array.from({ length: 10 }, (_, i) =>
				message({
					id: `bmsg_h${i + 1}`,
					seq: i + 1,
					conversation_id: "bcv_dm",
					body: `h ${i + 1}`,
				}),
			);
			const sends = [];
			// A send nobody ever confirms (see the note above): the row stays pending.
			const neverSettles = new Promise(() => {});
			const base = {
				target: { type: "conversation", id: "bcv_dm" },
				onSend: (body) => {
					sends.push(body);
					return neverSettles;
				},
			};
			/* The TIMELINE's viewport, not the first scroll area on the page: an
			   empty shell has a sidebar viewport too, and measuring that one made the
			   assertions below vacuous (agent review round 2, m6). */
			const timelineOf = (element) => {
				const found = [
					...element.querySelectorAll("[data-radix-scroll-area-viewport]"),
				].filter((node) => node.querySelector("[data-message-id]"));
				assert.equal(found.length, 1, "one timeline viewport");
				return found[0];
			};
			const first = await mountPage(pageProps({ ...base, messages: rows }));
			assert.ok(
				atBottom(timelineOf(first.element)),
				"the first mount opens at the bottom",
			);
			await typeBody(first.element, "still pending");
			await act(async () => sendButton(first.element).click());
			await settle();
			await first.close();

			const second = await mountPage(pageProps({ ...base, messages: rows }));
			try {
				const viewport = timelineOf(second.element);
				const rowsMounted =
					viewport.querySelectorAll("[data-message-id]").length;
				assert.ok(
					atBottom(viewport),
					`the remount opens at the bottom (rows=${rowsMounted}, scrollTop=${viewport.scrollTop}, scrollHeight=${viewport.scrollHeight}, client=${viewport.clientHeight})`,
				);
				/*
				 * AND THE PENDING SEND IS STILL DRAWN (agent review round 2, m6). Opening
				 * at the bottom says nothing about retention: dropping pending sends at
				 * unmount would keep the assertion above green while losing the row the
				 * reader typed, which is the whole point of the store outliving a mount.
				 * The body is asserted by its own text, not by a row count, so a
				 * placeholder or an empty local row cannot satisfy it.
				 */
				assert.match(
					viewport.textContent ?? "",
					/still pending/,
					"the unconfirmed send survived the remount",
				);
			} finally {
				await second.close();
				m.resetPendingSendsForTest();
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
			ACCOUNT_CHANGED_COPY,
			"the account-change sentence is shown",
		);
		assert.equal(
			SIGNED_OUT_COPY.test(text),
			false,
			"a sign-out is a different fact and must not be claimed",
		);
		assert.equal(
			IMAGE_QUOTA_COPY.test(text),
			false,
			"the quota sentence is reserved for the actual limit refusal",
		);
		// A retry would 409 again until the account is resolved.
		assert.equal(
			[...element.querySelectorAll("button")].some((button) =>
				RETRY_COPY.test(button.textContent ?? ""),
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

/* Shared presentation: these probe the actual shipped group, not a copy. Audit
 * supplies metadata only; a renderPreview spy is the negative control proving
 * terminal metadata cannot even commission a member resource component. */
async function renderAttachmentGroup(props) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	await act(async () =>
		root.render(React.createElement(m.BridgeAttachmentGroup, props)),
	);
	return {
		element,
		close: async () => {
			await act(async () => root.unmount());
			element.remove();
		},
	};
}

test("shared audit cards: bound descriptors and count-only receipts never fetch", async () => {
	mediaCalls = [];
	for (const props of [
		{
			attachments: [
				{
					id: "opaque",
					mime: "image/png",
					size: 2048,
					width: null,
					height: null,
					state: "bound",
				},
			],
		},
		{ attachments: [], count: 3 },
	]) {
		const view = await renderAttachmentGroup(props);
		assert.equal(view.element.querySelectorAll("li").length, 1);
		assert.equal(view.element.querySelectorAll("button,img,a").length, 0);
		assert.doesNotMatch(view.element.textContent, OPAQUE_ID);
		if (props.count === 3)
			assert.match(view.element.textContent, COUNT_ONLY_COPY);
		assert.equal(mediaCalls.length, 0);
		await view.close();
	}
	const empty = await renderAttachmentGroup({ attachments: [] });
	assert.equal(empty.element.innerHTML, "");
	await empty.close();
});

test("shared cards: every terminal state is generic and cannot commission a preview", async () => {
	let commissioned = 0;
	const view = await renderAttachmentGroup({
		attachments: [
			"expired",
			"withheld",
			"deleted",
			"unknown",
			"revoked",
			"",
		].map((state, index) => ({
			id: `opaque-${index}`,
			mime: "image/png",
			size: 2048,
			state,
		})),
		renderPreview: () => {
			commissioned++;
			return React.createElement("button", { type: "button" }, "forbidden");
		},
	});
	assert.equal(commissioned, 0);
	assert.equal(
		view.element.querySelectorAll('[data-bridge-attachment-card="unavailable"]')
			.length,
		6,
	);
	assert.doesNotMatch(view.element.textContent, PRIVATE_TERMINAL_METADATA);
	assert.equal(view.element.querySelectorAll("button,img,a").length, 0);
	await view.close();
});

test("shared file metadata: generic safe name, no raw descriptor text or inline bytes", async () => {
	let commissioned = 0;
	const view = await renderAttachmentGroup({
		attachments: [
			{
				id: "private/id",
				mime: "<script>alert(1)</script>",
				size: 2048,
				state: "bound",
				filename: "/private/home/secret.txt",
			},
		],
		renderPreview: () => {
			commissioned++;
			return null;
		},
	});
	assert.equal(commissioned, 0);
	assert.match(view.element.textContent, GENERIC_FILE_COPY);
	assert.match(view.element.textContent, HUMAN_SIZE);
	assert.doesNotMatch(view.element.textContent, RAW_BYTE_COUNT);
	assert.doesNotMatch(view.element.textContent, PRIVATE_FILE_METADATA);
	assert.equal(view.element.querySelectorAll("button,img,a,script").length, 0);
	await view.close();
});

test("shared geometry: nullable, invalid and huge dimensions stay finite and bounded", () => {
	for (const width of [
		null,
		0,
		-1,
		Number.NaN,
		Number.POSITIVE_INFINITY,
		1e300,
	]) {
		for (const compact of [false, true]) {
			const box = m.attachmentBox({ width, height: width }, true, compact);
			assert.ok(Number.isFinite(box.width) && Number.isFinite(box.height));
			assert.ok(box.width > 0 && box.width <= (compact ? 280 : 400));
			assert.ok(box.height > 0 && box.height <= (compact ? 220 : 320));
		}
	}
	// A grid cell is square at half the group's width less the 4px gutter.
	assert.deepEqual(m.attachmentBox(null, false, true), {
		width: 138,
		height: 138,
	});
	assert.deepEqual(m.attachmentBox(null, false, false), {
		width: 198,
		height: 198,
	});
});

test("member resource: authenticated refusal is terminal; 503 alone offers explicit retry", async () => {
	for (const status of [401, 403, 404, 410, 503]) {
		mediaCalls = [];
		let ready = false;
		mediaAnswer = () =>
			ready
				? { status: 200, kind: "bytes", mimeType: "image/png", data: PNG }
				: { status, kind: "error" };
		const view = await renderList([
			message({
				id: `refusal-${status}`,
				attachments: [
					{
						id: `resource-${status}`,
						mime: "image/png",
						size: 10,
						width: 4,
						height: 3,
						state: "bound",
					},
				],
			}),
		]);
		assert.equal(mediaCalls.length, 1);
		assert.equal(mediaCalls[0].request.expectedAccountId, "acct_a");
		const retry = [...view.element.querySelectorAll("button")].find(
			(node) =>
				node.textContent === m.t("ui.teamBridge.attachments.retry_load"),
		);
		assert.equal(Boolean(retry), status === 503);
		if (retry) {
			const box = view.element
				.querySelector("[data-attachment-placeholder]")
				.getAttribute("style");
			ready = true;
			await act(async () => retry.click());
			await settle();
			await settle();
			assert.equal(mediaCalls.length, 2);
			assert.equal(view.element.querySelectorAll("img").length, 1);
			const reserved = view.element.querySelector("[data-attachment-reserved]");
			assert.equal(
				reserved,
				null,
				"ready preview replaces reserved loading frame",
			);
			assert.match(box, TINY_RESERVED_BOX);
		}
		await view.close();
	}
});

// Exercise the production audit decoration, not just the standalone group:
// a null-rendering React element still counts as a supplied list decoration.
test("audit attachment presence: zero blank bodies keep fallback; descriptors/count-only stay nonfetchable", async () => {
	mediaCalls = [];
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const conversation = {
		id: "bcv_audit_presence",
		tenant_id: "tnt_audit_presence",
		kind: "dm",
		title: null,
		visibility: "private",
		status: "active",
		builtin: null,
		members: [],
		member_count: 0,
		viewers: [],
		agent: {
			account_id: "acct_audit_agent",
			display_label: "Synthetic agent",
			state: "active",
			joined_seq: 0,
			left_seq: null,
		},
		created_at: "2026-10-23T10:00:00Z",
		last_message_at: null,
		latest_seq: 6,
		last_thread_root_id: null,
	};
	const attachment = {
		id: "opaque_audit_image",
		mime: "image/png",
		size: 2048,
		width: 640,
		height: 480,
		state: "bound",
	};
	const cases = [
		{ id: "audit_blank", body: "", attachments: [], attachment_count: 0 },
		{
			id: "audit_whitespace",
			body: " \n\t",
			attachments: [],
			attachment_count: 0,
		},
		{
			id: "audit_text",
			body: "No attachments",
			attachments: [],
			attachment_count: 0,
		},
		{
			id: "audit_metadata",
			body: "Image and file metadata",
			attachments: [
				attachment,
				{ ...attachment, id: "opaque_file", mime: "application/octet-stream" },
			],
			attachment_count: 2,
		},
		{
			id: "audit_revoked",
			body: "Terminal receipt",
			attachments: [{ ...attachment, state: "revoked" }],
			attachment_count: 1,
		},
		{
			id: "audit_count",
			body: "Count only",
			attachments: [],
			attachment_count: 3,
		},
	];
	const rows = cases.map((item, seq) => ({
		...message({}),
		conversation_id: conversation.id,
		seq: seq + 1,
		body_hash: null,
		agent_label: null,
		thread_root_id: null,
		reply_count: null,
		last_reply_at: null,
		reply_participants: null,
		agent_delivery_status: "admitted",
		agent_verdict_at: null,
		...item,
	}));
	await act(async () =>
		root.render(
			React.createElement(
				m.QueryClientProvider,
				{ client: new m.QueryClient() },
				React.createElement(m.OwnerAuditPanelView, {
					conversation,
					messages: rows,
					state: "ready",
					retry: () => {},
					readerAccountId: "acct_audit_owner",
					people: [],
				}),
			),
		),
	);
	await settle();
	await settle();
	for (const id of ["audit_blank", "audit_whitespace"]) {
		const row = element.querySelector(`[data-message-id="${id}"]`);
		assert.ok(
			row.textContent.includes(m.t("ui.ownerAudit.body_unavailable")),
			`${id} retains unavailable body`,
		);
		assert.equal(
			row.querySelectorAll("[data-bridge-attachment-card]").length,
			0,
		);
	}
	const byId = (id) => element.querySelector(`[data-message-id="${id}"]`);
	assert.equal(
		byId("audit_text").querySelectorAll("[data-bridge-attachment-card]").length,
		0,
	);
	assert.equal(
		byId("audit_metadata").querySelectorAll(
			'[data-bridge-attachment-card="metadata"]',
		).length,
		2,
	);
	assert.equal(
		byId("audit_revoked").querySelectorAll(
			'[data-bridge-attachment-card="unavailable"]',
		).length,
		1,
	);
	assert.ok(
		byId("audit_count").textContent.includes(
			m.t("ui.teamBridge.attachmentCard.list", { count: 3 }),
		),
	);
	assert.equal(
		byId("audit_count").querySelectorAll("[data-bridge-attachment-card]")
			.length,
		1,
	);
	assert.equal(element.querySelectorAll("img").length, 0);
	assert.equal(
		mediaCalls.filter((call) => call.request.op === "team_bridge.attachment")
			.length,
		0,
	);
	await act(async () => root.unmount());
	element.remove();
});

/*
 * A PASTED IMAGE FILE IS NOT ALSO PASTED AS ITS NAME (issue #1573).
 *
 * Both bridge paste handlers kept the browser's default whenever the clipboard
 * carried `text/plain`, on the reading that the reader was pasting prose. A file
 * copied in Finder carries `text/plain` too - its NAME - so that rule inserted
 * "shot.png" beside the chip. The rule is now "keep the default only for text
 * that is more than the pasted files' names"; the controls pin the prose arm.
 *
 * MEASURED SHAPE FIRST (QA round 1, Electron 45.1.0 on macOS): a file paste
 * reaches the handler as `types: ["Files"]` with no `text/plain`, and the
 * pasteboard's plain string is read through the preload's `readPasteTextSync`
 * (`pasteboardText` here). The `["Files","text/plain"]` shape is kept too.
 */
const finderPaste = (file, text, { onEvent = true } = {}) => {
	const event = new window.Event("paste", { bubbles: true, cancelable: true });
	pasteboardText = text;
	Object.defineProperty(event, "clipboardData", {
		value: {
			types: onEvent ? ["Files", "text/plain"] : ["Files"],
			items: [
				{ kind: "file", type: file.type, getAsFile: () => file },
				...(onEvent
					? [{ kind: "string", type: "text/plain", getAsFile: () => null }]
					: []),
			],
			files: [file],
			getData: (type) => (onEvent && type === "text/plain" ? text : ""),
		},
	});
	return event;
};

for (const [text, prevented, label, onEvent] of [
	["shot.png", true, "only the file's name: no text insert", true],
	["look at this", false, "real prose alongside the file: kept", true],
	[
		"shot.png",
		true,
		'types ["Files"], name on the pasteboard: no insert',
		false,
	],
	[
		"look at this",
		false,
		'types ["Files"], prose on the pasteboard: kept',
		false,
	],
	["", true, 'types ["Files"], empty pasteboard: cancelled as before', false],
]) {
	test(`#1573 thread-pane paste handler: ${label}`, () => {
		const added = [];
		const handlers = m.attachmentPasteHandlers({
			add: (files) => added.push(...files),
		});
		const file = new File([PNG], "shot.png", { type: "image/png" });
		const event = finderPaste(file, text, { onEvent });
		handlers.onPaste(event);
		pasteboardText = "";
		assert.equal(added.length, 1, "the image was taken either way");
		assert.equal(event.defaultPrevented, prevented);
	});

	test(`#1573 page composer paste: ${label}`, async () => {
		localStorage.clear();
		const app = await mountPage(
			pageProps({ target: { type: "person", accountId: "acct_b" } }),
		);
		const field = app.element.querySelector("textarea");
		assert.ok(field, "composer field is mounted");
		const file = new File([PNG], "shot.png", { type: "image/png" });
		const event = finderPaste(file, text, { onEvent });
		await act(async () => field.dispatchEvent(event));
		pasteboardText = "";
		for (let i = 0; i < 5; i += 1) await settle();
		assert.equal(
			app.element.querySelectorAll("[data-attachment-id]").length,
			1,
			"the image staged on the bar",
		);
		assert.equal(event.defaultPrevented, prevented);
		await app.close();
	});
}

/*
 * S3b GENERIC FILES (UI slice U1). The fixture copies the message-view shape of
 * agent-server `docs/bridge-files-s3b-binding.md` ("Message view" table) and
 * `internal/responses/bridge_file.go`: id, class, mime=application/octet-stream,
 * size, display_name, state bound|expired, expires_at, download_only=true; plus
 * `file_count` for every reader. DOM/state proof under JSDOM only: there is no
 * layout engine here, so "wraps without overflow" is asserted as the bounded
 * card widths + wrapping container, and the rendered-frame proof is QA's.
 */
const S3B_NAME = "Q4 board report (signed).pdf";
const RTL_NAME = "تقرير الربع الرابع.csv";
const s3bFile = (overrides = {}) => ({
	id: "bfile_0f8a",
	class: "pdf",
	mime: "application/octet-stream",
	size: 184320,
	display_name: S3B_NAME,
	state: "bound",
	expires_at: "0001-01-01T00:00:00Z",
	download_only: true,
	...overrides,
});
const s3bMessage = (overrides = {}) =>
	message({
		id: "bmsg_s3b",
		body: null,
		files: [
			s3bFile(),
			s3bFile({
				id: "bfile_csv",
				class: "text",
				size: 920,
				display_name: RTL_NAME,
			}),
			s3bFile({
				id: "bfile_gone",
				state: "expired",
				size: 0,
				display_name: undefined,
				class: "",
			}),
		],
		file_count: 3,
		...overrides,
	});
const NAME_LEAK = /Q4 board|تقرير|secret-name/;
const PDF_META = /PDF · 184 KB/;
const CSV_META = /CSV · 920 B/;
const FILE_ID_PREFIX = /bfile_/;
const WRAPS = /flex-wrap/;
const GRID_TWO_COLUMNS = /grid-cols-2/;
const SPANS_TWO_ROWS = /row-span-2/;
const SQUARE_CELL = /aspect-square/;
const SHRINKS = /min-w-0/;
const CAPPED = /max-w-full/;
const TRUNCATES = /truncate/;
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])/;
const NO_SHRINK = /shrink-0/;
const EXTENSION_TAIL = /^\.(pdf|bin)$/;

function attributeText(element) {
	return [...element.querySelectorAll("*")]
		.flatMap((node) => [...node.attributes].map((a) => `${a.name}=${a.value}`))
		.join("\n");
}

test("S3b files: member thread renders one card per descriptor; Save is the only control and moves no bytes until pressed", async () => {
	mediaCalls = [];
	const logged = [];
	const original = {
		log: console.log,
		warn: console.warn,
		error: console.error,
		info: console.info,
		debug: console.debug,
	};
	for (const level of Object.keys(original))
		console[level] = (...args) => {
			logged.push(args.map(String).join(" "));
			original[level](...args);
		};
	const wire = m.teamBridgeMessageSchema.parse(s3bMessage());
	assert.equal(wire.files.length, 3);
	assert.equal(wire.file_count, 3);
	let view;
	try {
		view = await renderList([wire]);
	} finally {
		Object.assign(console, original);
	}
	const cards = view.element.querySelectorAll("[data-bridge-file-card]");
	assert.equal(cards.length, 3);
	assert.equal(
		view.element.querySelectorAll('[data-bridge-file-card="available"]').length,
		2,
	);
	// The sweeper's `expired` state says so, in the file's own words.
	const expired = view.element.querySelector(
		'[data-bridge-file-card="expired"]',
	);
	assert.ok(expired);
	assert.ok(
		expired.textContent.includes(m.t("ui.teamBridge.fileCard.expired")),
	);
	/* Decision a-fdf0: an available card offers exactly ONE control, Save, named
	   by position (never by the file's name) with the image tile's tooltip; a
	   terminal card offers none. Nothing opens, previews or links. */
	for (const [index, card] of [...cards].entries()) {
		const buttons = card.querySelectorAll("button");
		assert.equal(card.querySelectorAll("a,img,input").length, 0);
		if (card.dataset.bridgeFileCard !== "available") {
			assert.equal(buttons.length, 0);
			continue;
		}
		assert.equal(buttons.length, 1);
		assert.equal(
			buttons[0].getAttribute("aria-label"),
			m.t("ui.teamBridge.fileCard.save", {
				index: String(index + 1),
				count: "3",
			}),
		);
		assert.equal(
			buttons[0].getAttribute("title"),
			m.t("ui.chat.image_actions.save_as"),
		);
		assert.equal(card.dataset.fileSave, "idle");
	}
	// Rendering a card moves no bytes: the file lane runs only on a press.
	assert.equal(mediaCalls.length, 0);
	// The name is visible text, bidi-isolated by its own direction ...
	assert.ok(view.element.textContent.includes(S3B_NAME));
	const rtl = [...view.element.querySelectorAll('[dir="auto"]')].find(
		(n) => n.textContent === RTL_NAME,
	);
	assert.ok(rtl, "RTL name rendered inside dir=auto");
	assert.match(view.element.textContent, PDF_META);
	assert.match(view.element.textContent, CSV_META);
	// ... and never an aria-label, id, key, data attribute or log line (D9).
	assert.doesNotMatch(attributeText(view.element), NAME_LEAK);
	assert.doesNotMatch(attributeText(view.element), FILE_ID_PREFIX);
	assert.doesNotMatch(logged.join("\n"), NAME_LEAK);
	const list = view.element.querySelector('ul[aria-label="3 files"]');
	assert.ok(list, "accessible name is a count, not a name");
	await view.close();
});

test("S3b files: count-only receipt from file_count when no descriptors (agent-shaped read)", async () => {
	const wire = m.teamBridgeMessageSchema.parse(
		message({ id: "bmsg_count", file_count: 2 }),
	);
	const view = await renderList([wire]);
	const cards = view.element.querySelectorAll("[data-bridge-file-card]");
	assert.equal(cards.length, 1);
	assert.equal(cards[0].dataset.bridgeFileCard, "count-only");
	assert.ok(
		cards[0].textContent.includes(
			m.t("ui.teamBridge.fileCard.list", { count: 2 }),
		),
	);
	assert.equal(
		view.element.querySelectorAll(
			"[data-bridge-file-card] button, [data-bridge-file-card] a",
		).length,
		0,
	);
	await view.close();
});

test("S3b files: malformed files[] costs the descriptors, never the message", () => {
	const wire = m.teamBridgeMessageSchema.parse(
		message({
			id: "bmsg_bad",
			files: [{ id: "bad id!", size: -1 }],
			file_count: 1,
		}),
	);
	assert.equal(wire.files, undefined);
	assert.equal(wire.file_count, 1);
	const audit = m.ownerAuditMessageSchema.parse({
		...message({ id: "bmsg_bad_audit" }),
		files: "nope",
		file_count: "x",
	});
	assert.equal(audit.files, undefined);
	assert.equal(audit.file_count, undefined);
	// A state-less descriptor fails closed to unavailable.
	assert.equal(m.toBridgeFileDescriptor({ id: "bfile_x", size: 3 }).state, "");
});

test("S3b files: mixed 4 images + 6 files at compact density stays bounded and wrapping", async () => {
	const images = [0, 1, 2, 3].map((index) => ({
		id: `batt_mix${index}`,
		mime: "image/png",
		size: 2048,
		width: 4000,
		height: 3000,
		state: "expired",
	}));
	const files = ["pdf", "text", "container", "other", "pdf", "text"].map(
		(cls, index) =>
			m.toBridgeFileDescriptor(
				s3bFile({
					id: `bfile_mix${index}`,
					class: cls,
					display_name: `${"very-long-file-name-".repeat(6)}${index}.${cls === "pdf" ? "pdf" : "bin"}`,
				}),
			),
	);
	const view = await renderAttachmentGroup({
		attachments: images,
		compact: true,
		files,
		fileCount: 6,
	});
	const lists = view.element.querySelectorAll("ul");
	assert.equal(lists.length, 2);
	/* The images are a bounded 2-column grid (SPEC §3.1), capped at the compact
	   group width; the file chips still wrap. Both may shrink. */
	const [imageGrid, fileList] = lists;
	assert.match(imageGrid.className, GRID_TWO_COLUMNS);
	assert.equal(imageGrid.style.maxWidth, "280px");
	assert.match(fileList.className, WRAPS);
	for (const list of lists) assert.match(list.className, SHRINKS);
	const cards = view.element.querySelectorAll("[data-bridge-file-card]");
	assert.equal(cards.length, 6);
	for (const card of cards) {
		assert.equal(card.style.width, "240px");
		assert.match(card.className, CAPPED);
		const name = card.querySelector('[dir="auto"]');
		const head = name.querySelector('[data-file-name-part="head"]');
		const tail = name.querySelector('[data-file-name-part="tail"]');
		// Only the head may ellipsise; the extension sits in its own
		// non-shrinking element, so CSS cannot clip what middle truncation kept.
		assert.match(head.className, TRUNCATES);
		assert.match(head.className, SHRINKS);
		assert.match(tail.className, NO_SHRINK);
		assert.doesNotMatch(tail.className, TRUNCATES);
		assert.match(tail.textContent, EXTENSION_TAIL);
		/* No character budget any more (design D2): the head holds the whole stem
		   and CSS is the only truncator, so the only ellipsis on the card is the
		   one the browser draws at the width the card actually gets. */
		assert.doesNotMatch(head.textContent, /…/);
		assert.equal(name.textContent, `${head.textContent}${tail.textContent}`);
	}
	assert.equal(view.element.querySelectorAll("button,a").length, 0);
	await view.close();
});

test("S3b files: middle truncation keeps both ends and never splits a code point", () => {
	assert.equal(m.middleTruncateFileName("short.pdf", 28), "short.pdf");
	const cut = m.middleTruncateFileName(`${"a".repeat(40)}.pdf`, 11);
	assert.equal(cut, "aaaaa…a.pdf");
	const emoji = m.middleTruncateFileName("😀".repeat(30), 9);
	assert.equal(Array.from(emoji).length, 9);
	assert.ok(!LONE_SURROGATE.test(emoji));
});

test("S3b files: owner audit without a captured scope renders file cards with no Save and no media read", async () => {
	mediaCalls = [];
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const conversation = {
		id: "bcv_audit_files",
		tenant_id: "tnt_audit_files",
		kind: "dm",
		title: null,
		visibility: "private",
		status: "active",
		builtin: null,
		members: [],
		member_count: 0,
		viewers: [],
		agent: {
			account_id: "acct_audit_agent",
			display_label: "Synthetic agent",
			state: "active",
			joined_seq: 0,
			left_seq: null,
		},
		created_at: "2026-10-23T10:00:00Z",
		last_message_at: null,
		latest_seq: 2,
		last_thread_root_id: null,
	};
	const base = {
		conversation_id: conversation.id,
		body_hash: null,
		agent_label: null,
		thread_root_id: null,
		reply_count: null,
		last_reply_at: null,
		reply_participants: null,
		agent_delivery_status: "admitted",
		agent_verdict_at: null,
	};
	const rows = [
		m.ownerAuditMessageSchema.parse({
			...s3bMessage({ id: "audit_files", body: "with files" }),
			...base,
			seq: 1,
		}),
		m.ownerAuditMessageSchema.parse({
			...message({ id: "audit_file_count", body: "count only" }),
			...base,
			seq: 2,
			file_count: 4,
		}),
	];
	await act(async () =>
		root.render(
			React.createElement(
				m.QueryClientProvider,
				{ client: new m.QueryClient() },
				React.createElement(m.OwnerAuditPanelView, {
					conversation,
					messages: rows,
					state: "ready",
					retry: () => {},
					readerAccountId: "acct_audit_owner",
					people: [],
				}),
			),
		),
	);
	await settle();
	await settle();
	const byId = (id) => element.querySelector(`[data-message-id="${id}"]`);
	assert.equal(
		byId("audit_files").querySelectorAll("[data-bridge-file-card]").length,
		3,
	);
	assert.equal(
		byId("audit_files").querySelectorAll('[data-bridge-file-card="expired"]')
			.length,
		1,
	);
	/* No captured owner scope on this panel (`attachmentScope` absent), so the
	   cards have no byte authority: no Save, and nothing is read. The scoped
	   case is the next test. */
	assert.equal(
		byId("audit_files").querySelectorAll(
			"[data-bridge-file-card] button, [data-bridge-file-card] a",
		).length,
		0,
	);
	assert.ok(byId("audit_files").textContent.includes(S3B_NAME));
	assert.doesNotMatch(attributeText(byId("audit_files")), NAME_LEAK);
	assert.equal(
		byId("audit_file_count").querySelector("[data-bridge-file-card]").dataset
			.bridgeFileCard,
		"count-only",
	);
	assert.equal(mediaCalls.length, 0);
	await act(async () => root.unmount());
	element.remove();
});

test("S3b files: the tail is a protected element; only the head ellipsises (Q1/D1/U2)", async () => {
	assert.deepEqual(m.splitFileNameTail("Customer onboarding…list v12.docx"), {
		head: "Customer onboarding…list v12",
		tail: ".docx",
	});
	// No short extension: the last code points are protected, emoji intact.
	const emoji = m.splitFileNameTail("会议记录最终版😀😀😀😀");
	assert.equal(emoji.tail, "😀😀😀😀");
	assert.doesNotMatch(emoji.head + emoji.tail, LONE_SURROGATE);
	// The tail never starts before the inserted ellipsis.
	const cut = m.splitFileNameTail("abcdefgh…xyz");
	assert.ok(cut.head.endsWith("…"));
	assert.equal(cut.tail, "xyz");
	assert.deepEqual(m.splitFileNameTail("README"), { head: "README", tail: "" });

	const names = [
		"Customer onboarding checklist v12.docx",
		"تقرير الربع الرابع.csv",
		"四半期の取締役会報告書と議事録の最終版.pdf",
		// No extension: the protected tail is the name's own ending, not a format.
		"ملف بدون امتداد طويل",
	];
	const view = await renderAttachmentGroup({
		attachments: [],
		files: names.map((displayName, index) =>
			m.toBridgeFileDescriptor({
				id: `bfile_tail${index}`,
				class: "pdf",
				size: 2048,
				display_name: displayName,
				state: "bound",
			}),
		),
	});
	const rows = view.element.querySelectorAll("[data-bridge-file-card]");
	assert.equal(rows.length, names.length);
	for (const [index, card] of [...rows].entries()) {
		const label = card.querySelector('[dir="auto"]');
		const head = label.querySelector('[data-file-name-part="head"]');
		const tail = label.querySelector('[data-file-name-part="tail"]');
		assert.equal(head.parentElement, label);
		assert.equal(tail.parentElement, label);
		assert.match(head.className, TRUNCATES);
		assert.match(tail.className, NO_SHRINK);
		assert.equal(head.style.unicodeBidi, "isolate");
		assert.equal(tail.style.unicodeBidi, "isolate");
		assert.equal(tail.textContent, m.splitFileNameTail(names[index]).tail);
		/* D3: an EXTENSION is Latin-ordered data and must not inherit an RTL run's
		   direction, or `.csv` paints as `csv.`. A tail that is a fragment of the
		   name's own script must keep the row's direction instead. */
		assert.equal(
			tail.getAttribute("dir"),
			tail.textContent.startsWith(".") ? "ltr" : null,
			names[index],
		);
	}
	// D9 holds for the split label: no name fragment in any attribute.
	const attrs = attributeText(view.element);
	for (const name of names)
		for (const part of [name, name.slice(0, 8), name.split(".").shift()])
			assert.ok(!attrs.includes(part), part);
	/* The D1 limit sentence ("Preview unavailable in this view") became false
	   when Save landed (decision a-fdf0), so no card carries a title any more;
	   with no `readFile` there is no control and nothing titled at all. */
	assert.equal(view.element.querySelectorAll("[title]").length, 0);
	assert.equal(view.element.querySelectorAll("button").length, 0);
	assert.equal(
		view.element.querySelectorAll("[aria-label] [aria-label]").length,
		0,
	);
	await view.close();
	/* With a Save, the ONLY titles are the buttons' fixed "Save as…" - never a
	   name - and the only labels are positions. */
	const saving = await renderAttachmentGroup({
		attachments: [],
		files: names.map((displayName, index) =>
			m.toBridgeFileDescriptor({
				id: `bfile_tail${index}`,
				class: "pdf",
				size: 2048,
				display_name: displayName,
				state: "bound",
			}),
		),
		readFile: async () => {
			throw new Error("not pressed in this test");
		},
	});
	const titled = [...saving.element.querySelectorAll("[title]")];
	assert.equal(titled.length, names.length);
	for (const node of titled) {
		assert.equal(node.tagName, "BUTTON");
		assert.equal(
			node.getAttribute("title"),
			m.t("ui.chat.image_actions.save_as"),
		);
	}
	const savingAttrs = attributeText(saving.element);
	for (const name of names)
		for (const part of [name, name.slice(0, 8), name.split(".").shift()])
			assert.ok(!savingAttrs.includes(part), part);
	await saving.close();
});

/* ------------------------------------------------------------------ *\
   Generic-file Save (decision a-fdf0): authority, states, naming, focus.
   Component + synthetic preload relay only: no hub, no core, no native
   dialog. The anchor click is captured; its 60 s URL revoke is run here.
\* ------------------------------------------------------------------ */

const FILE_BYTES = new TextEncoder().encode("synthetic file bytes");
const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
function captureSaves() {
	const saved = [];
	const timers = [];
	const click = window.HTMLAnchorElement.prototype.click;
	const setTimer = window.setTimeout;
	window.HTMLAnchorElement.prototype.click = function () {
		saved.push({ download: this.download, href: this.href });
	};
	// `downloadBlob` revokes its URL a minute later; run that here instead.
	window.setTimeout = (fn, ms, ...args) => {
		if (ms < 60_000) return setTimer(fn, ms, ...args);
		timers.push(fn);
		return 0;
	};
	return {
		saved,
		restore: () => {
			window.HTMLAnchorElement.prototype.click = click;
			window.setTimeout = setTimer;
			for (const fn of timers) fn();
		},
	};
}
const saveButton = (card) => card.querySelector("button");
const press = async (button) => {
	await act(async () => {
		button.click();
		await tick();
	});
	await act(async () => {
		await tick();
	});
};

test("file Save: one press reads the member FILE lane once, saves under the descriptor's name, and never double-fires", async () => {
	mediaCalls = [];
	let release;
	mediaAnswer = (request) =>
		request.mode === "file"
			? new Promise((resolve) => {
					release = () =>
						resolve({
							status: 200,
							kind: "bytes",
							mimeType: "application/octet-stream",
							data: FILE_BYTES,
						});
				})
			: { status: 404, kind: "error", detail: "no" };
	const capture = captureSaves();
	try {
		const view = await renderList([
			m.teamBridgeMessageSchema.parse(s3bMessage()),
		]);
		const card = view.element.querySelector(
			'[data-bridge-file-card="available"]',
		);
		const button = saveButton(card);
		// Two presses inside one frame: the second is refused, not queued.
		await act(async () => {
			button.click();
			button.click();
			await tick();
		});
		const fileCalls = mediaCalls.filter((call) => call.request.mode === "file");
		assert.equal(fileCalls.length, 1);
		assert.deepEqual(fileCalls[0].request, {
			op: "team_bridge.attachment",
			mode: "file",
			tenantId: "tnt_1",
			conversationId: "bcv_1",
			messageId: "bmsg_s3b",
			attachmentId: "bfile_0f8a",
			expectedAccountId: "acct_a",
		});
		// Saving: busy, still focusable, and the line says so.
		assert.equal(card.dataset.fileSave, "saving");
		assert.equal(button.getAttribute("aria-busy"), "true");
		assert.equal(button.getAttribute("aria-disabled"), "true");
		assert.equal(button.disabled, false);
		assert.ok(card.textContent.includes(m.t("ui.teamBridge.fileCard.saving")));
		await act(async () => {
			button.click();
			await tick();
		});
		assert.equal(
			mediaCalls.filter((call) => call.request.mode === "file").length,
			1,
			"a press while saving is refused",
		);
		await act(async () => {
			release();
			await tick();
		});
		await act(async () => {
			await tick();
		});
		// Handed to the platform's save path, named from the descriptor.
		assert.equal(capture.saved.length, 1);
		assert.equal(capture.saved[0].download, S3B_NAME);
		assert.notEqual(capture.saved[0].download, "attachment.bin");
		// A cancelled dialog never reports back: the card simply returns to idle.
		assert.equal(card.dataset.fileSave, "idle");
		assert.match(card.textContent, PDF_META);
		await view.close();
	} finally {
		capture.restore();
		mediaAnswer = () => ({ status: 404, kind: "error", detail: "no" });
	}
});

test("file Save: each relay answer has its own state, register and focus", async () => {
	const cases = [
		// The hub's uniform refusal, an account change, a bad query.
		{
			status: 404,
			state: "unavailable",
			key: "ui.teamBridge.fileCard.unavailable",
			control: false,
			danger: false,
		},
		{
			status: 409,
			state: "unavailable",
			key: "ui.teamBridge.fileCard.unavailable",
			control: false,
			danger: false,
		},
		{
			status: 401,
			state: "unavailable",
			key: "ui.teamBridge.fileCard.unavailable",
			control: false,
			danger: false,
		},
		// Main's over-ceiling answer.
		{
			status: 413,
			state: "too_large",
			key: "ui.teamBridge.fileCard.too_large",
			control: false,
			// Not retryable, so no alarm (design round 1, D4).
			danger: false,
		},
		// Transport, upstream and rate failures: the reader may press again.
		{
			status: 503,
			state: "failed",
			key: "ui.teamBridge.fileCard.save_failed",
			control: true,
			danger: true,
		},
		{
			status: 502,
			state: "failed",
			key: "ui.teamBridge.fileCard.save_failed",
			control: true,
			danger: true,
		},
		{
			status: 429,
			state: "failed",
			key: "ui.teamBridge.fileCard.save_failed",
			control: true,
			danger: true,
		},
	];
	const capture = captureSaves();
	try {
		for (const expected of cases) {
			mediaCalls = [];
			mediaAnswer = (request) =>
				request.mode === "file"
					? { status: expected.status, kind: "error", detail: "private reason" }
					: { status: 404, kind: "error", detail: "no" };
			const view = await renderList([
				m.teamBridgeMessageSchema.parse(s3bMessage()),
			]);
			const card = view.element.querySelector(
				'[data-bridge-file-card="available"]',
			);
			const button = saveButton(card);
			// D2: the image tile's Save, exactly - radius, 16px glyph, inset ring.
			for (const cls of [
				"size-7",
				"rounded-xs",
				"hover:bg-row-hover",
				"focus-visible:-outline-offset-2",
			])
				assert.ok(button.classList.contains(cls), `${expected.status} ${cls}`);
			assert.equal(button.querySelector("svg").getAttribute("width"), "16");
			button.focus();
			await press(button);
			const label = String(expected.status);
			assert.equal(
				card.dataset.bridgeFileCard,
				expected.state === "unavailable" ? "unavailable" : "available",
				label,
			);
			assert.ok(card.textContent.includes(m.t(expected.key)), label);
			assert.ok(!card.textContent.includes("private reason"), label);
			assert.equal(Boolean(saveButton(card)), expected.control, label);
			/* Danger marks a RETRYABLE failure by its glyph, never its words
			   (design round 1, D3/D4): the status text stays in the status ink,
			   and the tile's kind glyph becomes a danger alert glyph. */
			const status = card.querySelector("[aria-live]");
			assert.equal(status.classList.contains("text-danger"), false, label);
			assert.ok(status.classList.contains("text-ink-dim"), label);
			// D1: the status wraps to two lines and the card grows, never clips.
			assert.ok(status.classList.contains("line-clamp-2"), label);
			assert.ok(!status.classList.contains("truncate"), label);
			assert.ok(card.classList.contains("min-h-12"), label);
			assert.ok(!card.classList.contains("h-12"), label);
			const glyph = card.querySelector("[data-file-save-failed]");
			assert.equal(Boolean(glyph), expected.danger, label);
			if (glyph) assert.ok(glyph.classList.contains("text-danger"), label);
			// Focus never falls to the document: the control keeps it, or the card takes it.
			assert.equal(
				document.activeElement,
				expected.control ? saveButton(card) : card,
				label,
			);
			assert.equal(capture.saved.length, 0, label);
			await view.close();
		}
	} finally {
		capture.restore();
		mediaAnswer = () => ({ status: 404, kind: "error", detail: "no" });
	}
});

test("file Save: expired by state or by a passed deadline offers nothing and reads nothing", async () => {
	mediaCalls = [];
	const view = await renderAttachmentGroup({
		attachments: [],
		files: [
			{
				id: "bfile_state",
				class: "pdf",
				size: 10,
				display_name: "a.pdf",
				state: "expired",
			},
			{
				id: "bfile_lapsed",
				class: "pdf",
				size: 10,
				display_name: "b.pdf",
				state: "bound",
				expires_at: "2020-01-01T00:00:00Z",
			},
			{
				id: "bfile_live",
				class: "pdf",
				size: 10,
				display_name: "c.pdf",
				state: "bound",
				expires_at: "2999-01-01T00:00:00Z",
			},
			{
				id: "bfile_garbled",
				class: "pdf",
				size: 10,
				display_name: "d.pdf",
				state: "bound",
				expires_at: "not a time",
			},
			// The hub's unset deadline (a non-pointer Go time) is no deadline.
			{
				id: "bfile_zero",
				class: "pdf",
				size: 10,
				display_name: "z.pdf",
				state: "bound",
				expires_at: "0001-01-01T00:00:00Z",
			},
			{
				id: "bfile_withheld",
				class: "pdf",
				size: 10,
				display_name: "e.pdf",
				state: "withheld",
			},
		].map(m.toBridgeFileDescriptor),
		readFile: async () => {
			mediaCalls.push("read");
			return FILE_BYTES;
		},
	});
	const states = [
		...view.element.querySelectorAll("[data-bridge-file-card]"),
	].map((card) => [card.dataset.bridgeFileCard, Boolean(saveButton(card))]);
	assert.deepEqual(states, [
		["expired", false],
		["expired", false],
		["available", true],
		// An unparseable deadline is ignored: never a grant, never "expired".
		["available", true],
		["available", true],
		["unavailable", false],
	]);
	const cards = view.element.querySelectorAll("[data-bridge-file-card]");
	assert.ok(
		cards[1].textContent.includes(m.t("ui.teamBridge.fileCard.expired")),
	);
	assert.ok(
		cards[5].textContent.includes(m.t("ui.teamBridge.fileCard.unavailable")),
	);
	assert.equal(mediaCalls.length, 0);
	await view.close();
	assert.equal(
		m.fileView(
			m.toBridgeFileDescriptor({
				id: "x",
				size: 1,
				state: "bound",
				expires_at: "2026-11-06T12:00:00Z",
			}),
			Date.parse("2026-11-06T12:00:01Z"),
		),
		"expired",
	);
});

test("file Save: the proposed name is the descriptor's, made safe, with a class fallback", () => {
	const name = (display_name, cls = "pdf", index = 0) =>
		m.fileSaveName(
			m.toBridgeFileDescriptor({
				id: "x",
				class: cls,
				size: 1,
				state: "bound",
				display_name,
			}),
			index,
		);
	assert.equal(
		name("Q4 board report (signed).pdf"),
		"Q4 board report (signed).pdf",
	);
	assert.equal(
		name("تقرير الربع الرابع.csv", "text"),
		"تقرير الربع الرابع.csv",
	);
	assert.equal(name("../../etc/passwd", "other"), "_.._etc_passwd");
	assert.equal(
		name('a:b*c?"d<e>f|g\\h/i.txt', "text"),
		"a_b_c__d_e_f_g_h_i.txt",
	);
	assert.equal(name("line\u0007break\u0085.txt", "text"), "line_break_.txt");
	assert.equal(name("  .hidden.  ", "text"), "hidden");
	assert.equal(name(undefined, "pdf", 1), "file-2.pdf");
	assert.equal(name(undefined, "text", 0), "file-1.txt");
	assert.equal(name(undefined, "container", 2), "file-3.zip");
	assert.equal(name(undefined, "other", 0), "file-1");
	assert.equal(name("///", "pdf", 0), "file-1.pdf");
	/* R2: Unicode format characters go by the bridge's own rule - a bidi
	   override would show `invoiceexe.pdf` in the dialog and save an `.exe`. */
	assert.equal(name("invoice\u202Efdp.exe", "other"), "invoicefdp.exe");
	assert.equal(name("a\u200Eb.txt", "text"), "ab.txt");
	assert.equal(name("\u2066report\u2069.pdf"), "report.pdf");
	assert.equal(name("x\u200By\uFEFF.txt", "text"), "xy.txt");
	// ZWNJ/ZWJ shape hi/ur names and build emoji: kept.
	assert.equal(name("می\u200Cخواهم.txt", "text"), "می\u200Cخواهم.txt");
	assert.equal(name("क्\u200Dष.pdf"), "क्\u200Dष.pdf");
	/* R3: a 200-byte UTF-8 budget with the extension kept whole. */
	const bytes = (value) => new TextEncoder().encode(value).byteLength;
	const long = name(`${"a".repeat(300)}.pdf`);
	assert.equal(bytes(long), 200);
	assert.ok(long.endsWith("a.pdf"), long);
	const wide = name(`${"報".repeat(300)}.xlsx`, "other");
	assert.ok(bytes(wide) <= 200, String(bytes(wide)));
	assert.ok(wide.endsWith("報.xlsx"), wide);
	assert.equal(bytes(name("😀".repeat(300), "other")), 200);
	assert.equal(name("short.pdf"), "short.pdf");
	/* R4: Windows device names, bare or with an extension, become files. */
	for (const device of [
		"CON",
		"prn",
		"Aux",
		"NUL",
		"COM1",
		"com9",
		"LPT1",
		"lpt9",
	]) {
		assert.equal(name(device, "other"), `_${device}`);
		assert.equal(name(`${device}.txt`, "text"), `_${device}.txt`);
	}
	assert.equal(name("nul.tar.gz", "other"), "_nul.tar.gz");
	for (const ordinary of [
		"CONSOLE.txt",
		"COM10.txt",
		"lpt0.txt",
		"aux-notes.md",
		"nullable.ts",
	])
		assert.equal(name(ordinary, "text"), ordinary);
	for (const status of [404, 401, 403, 409, 410, 422])
		assert.equal(m.fileSaveFailure(status), "unavailable", String(status));
	assert.equal(m.fileSaveFailure(413), "too_large");
	for (const status of [null, 408, 429, 500, 502, 503])
		assert.equal(m.fileSaveFailure(status), "failed", String(status));
});

test("file Save: an owner-audit card saves through the OWNER relay in file mode, never the member one", async () => {
	mediaCalls = [];
	mediaAnswer = (request) =>
		request.op === "team_bridge.owner_audit.attachment" &&
		request.mode === "file"
			? {
					status: 200,
					kind: "bytes",
					mimeType: "application/octet-stream",
					data: FILE_BYTES,
				}
			: { status: 404, kind: "error", detail: "no" };
	const capture = captureSaves();
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	try {
		await act(async () =>
			root.render(
				React.createElement(m.AuditAttachmentGroup, {
					attachments: [],
					count: 0,
					files: s3bMessage().files.map(m.toBridgeFileDescriptor),
					fileCount: 3,
					scope: {
						accountId: "acct_owner",
						tenantId: "tnt_audit",
						conversationId: "bcv_audit",
						messageId: "bmsg_audit",
					},
				}),
			),
		);
		assert.equal(mediaCalls.length, 0, "nothing is read before a press");
		const card = element.querySelector('[data-bridge-file-card="available"]');
		await press(saveButton(card));
		assert.deepEqual(
			mediaCalls.map((call) => call.request),
			[
				{
					op: "team_bridge.owner_audit.attachment",
					mode: "file",
					tenantId: "tnt_audit",
					expectedAccountId: "acct_owner",
					conversationId: "bcv_audit",
					messageId: "bmsg_audit",
					attachmentId: "bfile_0f8a",
				},
			],
		);
		assert.deepEqual(
			capture.saved.map((row) => row.download),
			[S3B_NAME],
		);
	} finally {
		capture.restore();
		mediaAnswer = () => ({ status: 404, kind: "error", detail: "no" });
		await act(async () => root.unmount());
		element.remove();
	}
});

test("composer routing: the BYTES pick the lane, so every file type travels", async () => {
	const png = Uint8Array.from(atob(PNG_BASE64), (c) => c.charCodeAt(0));
	const heicHeader = new Uint8Array([
		0,
		0,
		0,
		24,
		...new TextEncoder().encode("ftypheic"),
		0,
		0,
		0,
		0,
	]);
	const files = [
		new File([png], "shot.png", { type: "image/png" }),
		new File([png], "untyped-shot", { type: "" }),
		// Declared pictures the image lane cannot prepare used to strand here.
		new File(["<svg xmlns='http://www.w3.org/2000/svg'/>"], "logo.svg", {
			type: "image/svg+xml",
		}),
		new File(
			[new Uint8Array([0x49, 0x49, 0x2a, 0x00, 1, 2, 3, 4])],
			"scan.tiff",
			{ type: "image/tiff" },
		),
		new File([new Uint8Array([0x42, 0x4d, 1, 2, 3, 4])], "icon.bmp", {
			type: "image/bmp",
		}),
		new File(["%PDF-1.7"], "lying.png", { type: "image/png" }),
		new File(["plain"], "notes.txt", { type: "text/plain" }),
		new File(["PK\u0003\u0004"], "deck.pptx", { type: "" }),
		new File([heicHeader], "IMG_0001.HEIC", { type: "image/heic" }),
	];
	const saved = globalThis.createImageBitmap;
	try {
		globalThis.createImageBitmap = undefined;
		let parts = await m.splitBridgeFiles(files);
		assert.deepEqual(
			parts.images.map((f) => f.name),
			["shot.png", "untyped-shot"],
		);
		assert.deepEqual(
			parts.generic.map((f) => f.name),
			[
				"logo.svg",
				"scan.tiff",
				"icon.bmp",
				"lying.png",
				"notes.txt",
				"deck.pptx",
				"IMG_0001.HEIC",
			],
		);
		// A build that can decode HEIC keeps it inline, as before.
		globalThis.createImageBitmap = async () => ({ close() {} });
		parts = await m.splitBridgeFiles([files[8]]);
		assert.deepEqual(
			parts.images.map((f) => f.name),
			["IMG_0001.HEIC"],
		);
		globalThis.createImageBitmap = async () => {
			throw new Error("no HEIC decoder");
		};
		parts = await m.splitBridgeFiles([files[8]]);
		assert.deepEqual(
			parts.generic.map((f) => f.name),
			["IMG_0001.HEIC"],
		);
	} finally {
		globalThis.createImageBitmap = saved;
	}
});

test("composer chips say their own state: Attached, Upload failed, Not uploaded", async () => {
	const render = async (state) => {
		const element = document.createElement("div");
		document.body.append(element);
		const root = createRoot(element);
		await act(async () =>
			root.render(React.createElement(m.TeamBridgeFilesStrip, { state })),
		);
		const lines = [...element.querySelectorAll("[data-file-chip]")].map(
			(chip) => [
				chip.dataset.fileChip,
				chip.querySelector("span.text-xs").textContent,
			],
		);
		await act(async () => root.unmount());
		element.remove();
		return lines;
	};
	const chip = (key, status) => ({
		key,
		status,
		file: new File(["x"], `${key}.txt`),
	});
	const base = { retry() {}, remove() {} };
	assert.deepEqual(
		await render({
			...base,
			enabled: true,
			chips: [
				chip("a", "held"),
				chip("b", "ready"),
				chip("c", "uploading"),
				chip("d", "error"),
			],
		}),
		[
			["held", m.t("ui.teamBridge.files.attached")],
			["ready", m.t("ui.teamBridge.files.attached")],
			["uploading", m.t("ui.teamBridge.files.uploading")],
			["error", m.t("ui.teamBridge.files.failed")],
		],
	);
	// Capability off: nothing was attempted, so the chip does not claim a failure.
	assert.deepEqual(
		await render({ ...base, enabled: false, chips: [chip("e", "error")] }),
		[["error", m.t("ui.teamBridge.files.not_uploaded")]],
	);
});

/* ------------------------------------------------------------------ *\
   Inline images (SPEC §3.1): grid layout, +N, fit, per-image Save.
   Added in agent review round 1 (M1, minors 3 and 5).
\* ------------------------------------------------------------------ */

const sixImages = (fourthState) =>
	[0, 1, 2, 3, 4, 5].map((index) => ({
		id: `batt_six${index}`,
		mime: "image/png",
		size: 10,
		width: 4,
		height: 3,
		state: index === 3 ? fourthState : "bound",
	}));

test("inline grid: +N survives a failed fourth tile; tiles 5+ stay mounted but hidden (M1)", async () => {
	for (const fourthState of ["bound", "expired", "withheld", "deleted"]) {
		const view = await renderAttachmentGroup({
			attachments: sixImages(fourthState),
			renderPreview: (_attachment, index) =>
				React.createElement("span", null, `tile${index}`),
		});
		const items = [...view.element.querySelectorAll("ul > li")];
		assert.equal(items.length, 6, `${fourthState}: every image is mounted`);
		assert.deepEqual(
			items.map((li) => li.hidden),
			[false, false, false, false, true, true],
			`${fourthState}: positions 5 and 6 are hidden`,
		);
		const overflow = view.element.querySelectorAll(
			"[data-attachment-overflow]",
		);
		assert.equal(overflow.length, 1, `${fourthState}: one +N label`);
		assert.equal(overflow[0].textContent, "+2");
		assert.ok(
			items[3].contains(overflow[0]),
			`${fourthState}: the label sits on the fourth slot`,
		);
		await view.close();
	}
});

test("inline grid: member Placeholder and failed fourth tile keep +N; ready fourth tile names it (M1)", async () => {
	mediaAnswer = (request) =>
		request.attachmentId === "batt_six3"
			? { status: 404, kind: "error", detail: "x" }
			: { status: 200, kind: "bytes", mimeType: "image/png", data: PNG };
	const failed = await renderList([
		message({ id: "bmsg_six_fail", attachments: sixImages("bound") }),
	]);
	assert.equal(
		failed.element.querySelector("[data-attachment-overflow]")?.textContent,
		"+2",
		"a refused fourth picture still says +2",
	);
	await failed.close();
	mediaAnswer = () => ({
		status: 200,
		kind: "bytes",
		mimeType: "image/png",
		data: PNG,
	});
	const ready = await renderList([
		message({ id: "bmsg_six_ok", attachments: sixImages("bound") }),
	]);
	const more = m.t("ui.chat.canonical.fold.more_images", {
		count: 2,
		count_display: "2",
	});
	const fourth = ready.element.querySelectorAll("ul > li")[3];
	assert.equal(
		fourth.querySelector("button[aria-label]").getAttribute("aria-label"),
		more,
		"label in name: the +2 tile is named for what it shows",
	);
	assert.equal(
		fourth.querySelector("[data-attachment-actions]"),
		null,
		"the +N tile carries no action cluster",
	);
	await ready.close();
});

test("inline grid: three images put the first across both rows", async () => {
	const view = await renderAttachmentGroup({
		attachments: sixImages("bound").slice(0, 3),
		renderPreview: () => React.createElement("span"),
	});
	const items = [...view.element.querySelectorAll("ul > li")];
	assert.match(items[0].className, SPANS_TWO_ROWS);
	for (const li of items.slice(1)) assert.match(li.className, SQUARE_CELL);
	await view.close();
});

test("inline image fit: cover inside 2.5:1..1:2.5, contain outside and when unknown", () => {
	assert.equal(m.attachmentFit({ width: 400, height: 300 }), "cover");
	assert.equal(m.attachmentFit({ width: 250, height: 100 }), "cover");
	assert.equal(m.attachmentFit({ width: 40, height: 100 }), "cover");
	assert.equal(m.attachmentFit({ width: 251, height: 100 }), "contain");
	assert.equal(m.attachmentFit({ width: 39, height: 100 }), "contain");
	assert.equal(m.attachmentFit({ width: null, height: 100 }), "contain");
	assert.equal(m.attachmentFit(null), "contain");
});

test("member ready tile: Save is offered per image and named for that image (minor 5)", async () => {
	mediaAnswer = () => ({
		status: 200,
		kind: "bytes",
		mimeType: "image/png",
		data: PNG,
	});
	const view = await renderList([
		message({ id: "bmsg_two", attachments: sixImages("bound").slice(0, 2) }),
	]);
	const saves = [
		...view.element.querySelectorAll("[data-attachment-actions] button"),
	].filter((node) => node.getAttribute("aria-hidden") !== "true");
	assert.deepEqual(
		saves.map((node) => node.getAttribute("aria-label")),
		[1, 2].map((index) =>
			m.t("ui.common.forms.autocomplete_field.save", {
				label: m.t("ui.teamBridge.attachments.position", {
					index: String(index),
					count: "2",
				}),
			}),
		),
	);
	await view.close();
});

// U2: these are component/HTTP-relay contract tests, NOT real hub transfer.
const FILE_CAP = {
	version: 1,
	enabled: true,
	download_only: true,
	classes: [{ class: "text", max_bytes: 25 * 1024 * 1024 }],
	max_items: 10,
};
const FILE_SCOPE = {
	scopeKey: "file-test",
	accountId: "acct_a",
	tenantId: "tnt_1",
	conversationId: "bcv_1",
	capability: FILE_CAP,
};
let fileHook;
async function mountFiles(props = FILE_SCOPE) {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	function Probe(next) {
		fileHook = m.useTeamBridgeFiles(next);
		return null;
	}
	const render = (next) =>
		act(async () =>
			root.render(
				React.createElement(
					React.StrictMode,
					null,
					React.createElement(Probe, next),
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
const documentFile = () =>
	new File(["fixture file bytes"], "notes + résumé.txt", {
		type: "text/plain",
	});
const stagedFile = (id) => ({
	status: 201,
	kind: "json",
	body: {
		result: {
			file: {
				id,
				mime: "application/octet-stream",
				size: 18,
				display_name: "notes.txt",
				class: "text",
				state: "staged",
			},
		},
	},
});

test("U2 files capability is versioned, download-only, bounded and fail-closed", () => {
	assert.deepEqual(
		m.filesCapability({ status: { files: FILE_CAP } }),
		FILE_CAP,
	);
	for (const block of [
		null,
		{ ...FILE_CAP, enabled: false },
		{ ...FILE_CAP, version: 2 },
		{ ...FILE_CAP, download_only: false },
		{ ...FILE_CAP, classes: [] },
		{ ...FILE_CAP, classes: [{ class: "text", max_bytes: 26 * 1024 * 1024 }] },
	])
		assert.equal(m.filesCapability({ status: { files: block } }), null);
});
test("U2 send binds files independently, file-only succeeds, image wire retained", () => {
	const send = {
		op: "team_bridge.messages.send",
		expected_account_id: "acct_a",
		conversation_id: "bcv_1",
		tenant_id: "tnt_1",
		client_ref: "ref-file",
		body: "",
		files: ["batt_file"],
	};
	assert.equal(m.desktopRequestSchema.safeParse(send).success, true);
	assert.deepEqual(m.desktopEndpoint(send).body.files, ["batt_file"]);
	assert.equal(
		m.desktopRequestSchema.safeParse({ ...send, files: [] }).success,
		false,
	);
	assert.equal(
		m.desktopRequestSchema.safeParse({ ...send, attachment_ids: ["batt_file"] })
			.success,
		false,
	);
	assert.equal(
		m.desktopRequestSchema.safeParse({
			...send,
			files: Array.from({ length: 10 }, (_, i) => `batt_f${i}`),
			attachment_ids: ["batt_image"],
		}).success,
		false,
	);
	assert.equal(
		"files" in
			m.desktopEndpoint({ ...send, body: "text", files: undefined }).body,
		false,
	);
});
test("U2 opaque file upload failure is visible, retry preserves bytes and bound IDs", async () => {
	mediaCalls = [];
	let fail = true;
	mediaAnswer = () => {
		if (fail) {
			fail = false;
			return { kind: "error", status: 503 };
		}
		return stagedFile("batt_file");
	};
	const app = await mountFiles();
	await act(async () => fileHook.add([documentFile()]));
	await settle();
	assert.equal(fileHook.chips[0].status, "error");
	assert.equal(fileHook.blocked, true);
	await act(async () => fileHook.retry(fileHook.chips[0].key));
	await settle();
	assert.equal(fileHook.chips[0].status, "ready");
	assert.equal(fileHook.blocked, false);
	assert.deepEqual(await fileHook.stageInto("bcv_1", "tnt_1"), ["batt_file"]);
	assert.equal(mediaCalls.length, 2);
	assert.equal(mediaCalls[0].size, 18);
	assert.equal(mediaCalls[0].request.mode, "file");
	assert.equal(mediaCalls[0].request.fileName, "notes + résumé.txt");
	assert.equal(mediaCalls[0].request.expectedAccountId, "acct_a");
	await assert.rejects(fileHook.stageInto("bcv_1", "tnt_2"));
	await act(async () => fileHook.remove(fileHook.chips[0].key));
	assert.equal(fileHook.chips.length, 0);
	await app.close();
});
test("U2 capability OFF retains removable refusal, never uploads or binds", async () => {
	mediaCalls = [];
	const app = await mountFiles({ ...FILE_SCOPE, capability: null });
	await act(async () => fileHook.add([documentFile()]));
	await settle();
	assert.equal(fileHook.chips.length, 1);
	assert.equal(fileHook.blocked, true);
	assert.equal(mediaCalls.length, 0);
	await assert.rejects(fileHook.stageInto("bcv_1", "tnt_1"));
	await app.close();
});
test("U2 held files upload only after conversation creation and reject changed tenant", async () => {
	mediaCalls = [];
	mediaAnswer = () => stagedFile("batt_held_file");
	const app = await mountFiles({ ...FILE_SCOPE, conversationId: null });
	await act(async () => fileHook.add([documentFile()]));
	assert.equal(mediaCalls.length, 0);
	assert.equal(fileHook.chips[0].status, "held");
	await assert.rejects(fileHook.stageInto("bcv_new", "tnt_other"));
	assert.equal(mediaCalls.length, 0);
	await act(async () =>
		assert.deepEqual(await fileHook.stageInto("bcv_new", "tnt_1"), [
			"batt_held_file",
		]),
	);
	assert.equal(mediaCalls[0].request.conversationId, "bcv_new");
	await app.close();
});
test("U2 account/tenant/conversation switches reject stale callbacks and completion resurrection", async () => {
	for (const delta of [
		{ accountId: "acct_b" },
		{ tenantId: "tnt_2" },
		{ conversationId: "bcv_2" },
	]) {
		let finish;
		mediaAnswer = () =>
			new Promise((resolve) => {
				finish = resolve;
			});
		const app = await mountFiles();
		await act(async () => fileHook.add([documentFile()]));
		await settle();
		const receipt = fileHook.receipt();
		const staleAdd = fileHook.add;
		await app.render({ ...FILE_SCOPE, ...delta });
		assert.equal(fileHook.chips.length, 0);
		await act(async () => staleAdd([documentFile()]));
		assert.equal(fileHook.chips.length, 0);
		await act(async () => finish(stagedFile("batt_late")));
		await settle();
		assert.equal(fileHook.chips.length, 0);
		await assert.rejects(receipt.stageInto("bcv_1", "tnt_1"));
		await app.render(FILE_SCOPE);
		assert.equal(fileHook.chips.length, 0, "A→B→A must not resurrect");
		await app.close();
	}
});
test("U2 removed in-flight chip cannot resurrect; overlimit blocks", async () => {
	let finish;
	mediaAnswer = () =>
		new Promise((resolve) => {
			finish = resolve;
		});
	const app = await mountFiles();
	await act(async () => fileHook.add([documentFile()]));
	await settle();
	await act(async () => fileHook.remove(fileHook.chips[0].key));
	await act(async () => finish(stagedFile("batt_removed")));
	await settle();
	assert.equal(fileHook.chips.length, 0);
	await app.close();
	const held = await mountFiles({ ...FILE_SCOPE, conversationId: null });
	await act(async () => fileHook.add(Array.from({ length: 11 }, documentFile)));
	assert.equal(fileHook.blocked, true);
	await assert.rejects(fileHook.stageInto("bcv_new", "tnt_1"));
	await held.close();
});
test("U2 untyped Finder documents do not enter image conversion; images still do", async () => {
	const image = new File([PNG], "image.png");
	const file = new File(["%PDF fixture"], "paper.pdf");
	const parts = await m.splitBridgeFiles([image, file]);
	assert.deepEqual(parts.images, [image]);
	assert.deepEqual(parts.generic, [file]);
});

async function dropDocument(element) {
	const file = documentFile();
	const event = new window.Event("drop", { bubbles: true, cancelable: true });
	event.dataTransfer = {
		types: ["Files"],
		items: [{ kind: "file", getAsFile: () => file }],
		files: [file],
	};
	await act(async () =>
		element.querySelector("[data-composer-bar]").dispatchEvent(event),
	);
	await settle();
	await settle();
}
for (const body of ["", "A document note"])
	test(`U2 page file-only/text drop reaches files bind, never image IDs (${body ? "caption" : "file-only"})`, async () => {
		mediaAnswer = () => stagedFile("batt_page_file");
		const sends = [];
		const app = await mountPage(
			pageProps({
				target: { type: "conversation", id: "bcv_dm" },
				filesCapability: FILE_CAP,
				onSchedule: async () => {
					throw new Error("Files cannot schedule");
				},
				onSend: async (body, _ref, attachments) => {
					const ids = await attachments.stageHeld("bcv_dm", "org_page");
					sends.push({ body, ids, files: attachments.files });
				},
			}),
		);
		if (body) await typeBody(app.element, body);
		await dropDocument(app.element);
		assert.equal(app.element.querySelectorAll("[data-file-chip]").length, 1);
		assert.equal(
			app.element.querySelector('button[aria-label="Schedule message"]')
				.disabled,
			true,
		);
		await act(async () => sendButton(app.element).click());
		await settle();
		assert.deepEqual(sends, [{ body, ids: [], files: ["batt_page_file"] }]);
		assert.equal(app.element.querySelectorAll("[data-file-chip]").length, 0);
		await app.close();
	});
test("U2 page capability OFF blocks prose fallback and keeps file removal available", async () => {
	let sends = 0;
	const app = await mountPage(
		pageProps({
			target: { type: "conversation", id: "bcv_dm" },
			filesCapability: null,
			onSend: async () => {
				sends += 1;
			},
		}),
	);
	await typeBody(app.element, "Do not send alone");
	await dropDocument(app.element);
	assert.equal(sendButton(app.element).disabled, true);
	assert.equal(sends, 0);
	assert.ok(app.element.textContent.includes("Files are unavailable"));
	const remove = app.element.querySelector('button[aria-label="Remove file"]');
	assert.ok(remove);
	await act(async () => remove.click());
	assert.equal(sendButton(app.element).disabled, false);
	await app.close();
});

// R1: the response may arrive after the author stages the NEXT message. Exercise
// the real thread component beside the channel control; transport remains the
// suite's disclosed stub, never a claim about native/core/hub delivery.
for (const surface of ["thread", "channel"]) {
	test(`U2 R1 ${surface}: accepted send retires only press-time file keys`, async () => {
		let finish;
		let sequence = 0;
		const sent = [];
		mediaAnswer = () => stagedFile(`batt_pending${++sequence}`);
		let app;
		if (surface === "thread") {
			const element = document.createElement("div");
			document.body.append(element);
			const root = createRoot(element);
			await act(async () =>
				root.render(
					React.createElement(m.TeamBridgeThreadPaneView, {
						root: message({ id: "bmsg_1", body: "root" }),
						replies: [],
						state: "ready",
						labelFor: (sender) => sender.display_label,
						onClose: () => {},
						onRetry: () => {},
						tenantId: "tnt_1",
						conversationId: "bcv_1",
						accountId: "acct_a",
						filesCapability: FILE_CAP,
						onSend: async (_body, _ref, _images, files) => {
							sent.push([...files]);
							await new Promise((resolve) => {
								finish = resolve;
							});
						},
					}),
				),
			);
			app = {
				element,
				close: async () => {
					await act(async () => root.unmount());
					element.remove();
				},
			};
		} else {
			app = await mountPage(
				pageProps({
					target: { type: "conversation", id: "bcv_dm" },
					filesCapability: FILE_CAP,
					onSend: async (_body, _ref, attachments) => {
						await attachments.stageHeld("bcv_dm", "org_page");
						sent.push([...attachments.files]);
						await new Promise((resolve) => {
							finish = resolve;
						});
					},
				}),
			);
		}
		const drop = async (name) => {
			const file = new File(["document"], name, { type: "text/plain" });
			const event = new window.Event("drop", {
				bubbles: true,
				cancelable: true,
			});
			event.dataTransfer = {
				types: ["Files"],
				items: [{ kind: "file", getAsFile: () => file }],
				files: [file],
			};
			await act(async () =>
				app.element.querySelector("textarea").dispatchEvent(event),
			);
			await settle();
			await settle();
		};
		try {
			await drop("first.txt");
			await act(async () => sendButton(app.element).click());
			await settle();
			assert.deepEqual(
				sent,
				[["batt_pending1"]],
				"the first request carries only its own file",
			);
			await drop("second-unsent.txt");
			assert.equal(app.element.querySelectorAll("[data-file-chip]").length, 2);
			await act(async () => finish());
			await settle();
			const remaining = app.element.querySelectorAll("[data-file-chip]");
			assert.equal(
				remaining.length,
				1,
				"a later unsent file must survive the previous response",
			);
			assert.equal(
				remaining[0].querySelector("bdi").textContent,
				"second-unsent.txt",
			);
			assert.deepEqual(
				sent,
				[["batt_pending1"]],
				"the preserved file was never bound by the first request",
			);
		} finally {
			await app.close();
		}
	});
}

test("U2 D1: full filename disclosure keeps bidi text and fixed mutation labels", async () => {
	const element = document.createElement("div");
	document.body.append(element);
	const root = createRoot(element);
	const name = "تقارير-very-long-name-with-two-suffixes-final-2026.csv";
	const file = new File(["fixture"], name, { type: "text/plain" });
	try {
		await act(async () =>
			root.render(
				React.createElement(m.TeamBridgeFilesStrip, {
					state: {
						chips: [{ key: "local", file, status: "ready" }],
						enabled: true,
						remove: () => {},
					},
				}),
			),
		);
		const disclosure = element.querySelector("details");
		const summary = disclosure.querySelector("summary");
		assert.equal(
			summary.querySelector("bdi").textContent,
			name,
			"full authorized content stays bidi-isolated",
		);
		assert.equal(disclosure.open, false);
		await act(async () => summary.click());
		assert.equal(
			disclosure.open,
			true,
			"native summary exposes the full wrapping filename",
		);
		assert.equal(
			element
				.querySelector('button[aria-label="Remove file"]')
				.getAttribute("aria-label"),
			"Remove file",
		);
		assert.equal(
			summary.hasAttribute("aria-label"),
			false,
			"do not inject filenames into mutation-control metadata",
		);
	} finally {
		await act(async () => root.unmount());
		element.remove();
	}
});
