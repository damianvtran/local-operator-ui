import assert from "node:assert/strict";
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";
import { build } from "esbuild";

/*
 * Remote files parity, UI half (core docs/design/remote-files-parity.md §3).
 *
 * REAL: `canonical/remote-files.ts` (the action table and the row mapping),
 * `canonical/remote-file-transfer.tsx` (content/download doors, landed paths),
 * `components/remote-file-actions-menu.tsx` (`performRemoteAction`, the one
 * dispatcher the menu calls), and the real English catalogue through `t()`.
 *
 * SUBSTITUTED: the desktop transport (`desktopRequest`/`desktopMedia`, recorded
 * and answered by the test), the toast channel (recorded), the UI primitives
 * the menu module imports but this file never renders, and `window.api`'s
 * openFile/showItemInFolder/readFileBytes (spies). The spies are the point of
 * I3-1: a remote row's owner path must never reach any of them.
 */

const ROOT = resolve(import.meta.dirname, "..");
const CACHE = join(ROOT, "node_modules", ".cache", "remote-files");

const stubs = {
	"@shared/api/local-operator/desktop-api": `
		export const desktopRequest = (r) => globalThis.__remote.request(r);
		export const desktopMedia = (r) => globalThis.__remote.media(r);`,
	"@shared/utils/toast-manager": `
		const note = (kind) => (message, options) => { globalThis.__remote.toasts.push({ kind, message, options }); return 1; };
		export const showErrorToast = note("error");
		export const showInfoToast = note("info");
		export const showSuccessToast = note("success");`,
	"@shared/components/ui": `
		const C = () => null;
		export const Button = C, DropdownMenu = C, DropdownMenuContent = C,
			DropdownMenuItem = C, DropdownMenuTrigger = C, Tooltip = C;`,
	"@shared/i18n/use-locale": "export const useI18nLocale = () => 'en';",
	"@shared/lib/external-open-refusal":
		"export const showExternalOpenRefusal = () => {};",
};

const bundle = await build({
	stdin: {
		contents: `
			export { remoteOf, remoteFileActions, remoteUnreadableText, REMOTE_PREVIEW_MAX_BYTES } from "./src/renderer/src/features/chat/canonical/remote-files";
			export { downloadRemoteFile, fetchRemoteFileBlob, landedPathFor, rememberLanded } from "./src/renderer/src/features/chat/canonical/remote-file-transfer";
			export { performRemoteAction } from "./src/renderer/src/features/chat/components/remote-file-actions-menu";
			export { indexedDocument } from "./src/renderer/src/features/chat/canonical/session-files";
			export { AttachmentOwnerUnreachableError } from "./src/renderer/src/features/chat/canonical/use-attachment-url";
		`,
		resolveDir: ROOT,
		loader: "ts",
	},
	bundle: true,
	format: "esm",
	platform: "node",
	jsx: "automatic",
	mainFields: ["module", "main"],
	conditions: ["import", "module", "default"],
	alias: {
		"@assets": resolve(ROOT, "src/renderer/src/assets"),
		"@features": resolve(ROOT, "src/renderer/src/features"),
		"@renderer": resolve(ROOT, "src/renderer/src"),
		"@shared": resolve(ROOT, "src/renderer/src/shared"),
	},
	plugins: [
		{
			name: "remote-files-edges",
			setup(builder) {
				// Stubbed edges only; every other `@shared/…` resolves through the
				// alias to the real module (undefined = esbuild's own resolution).
				builder.onResolve({ filter: /^@shared\// }, (args) =>
					stubs[args.path] !== undefined
						? { path: args.path, namespace: "stub" }
						: undefined,
				);
				builder.onLoad({ filter: /.*/, namespace: "stub" }, ({ path }) => ({
					contents: stubs[path],
					loader: "js",
				}));
			},
		},
	],
	write: false,
});

mkdirSync(CACHE, { recursive: true });
const bundlePath = join(CACHE, "remote-files.mjs");
writeFileSync(bundlePath, bundle.outputFiles[0].text);
const {
	remoteOf,
	remoteFileActions,
	remoteUnreadableText,
	REMOTE_PREVIEW_MAX_BYTES,
	downloadRemoteFile,
	fetchRemoteFileBlob,
	landedPathFor,
	performRemoteAction,
	indexedDocument,
	AttachmentOwnerUnreachableError,
} = await import(pathToFileURL(bundlePath).href);

// ------------------------------------------------------------- the rig

const OWNER_PATH = "~/.local-operator/sessions/abc/scratchpad/chart.png";
const ISOLATES = /[\u2066-\u2069]/g;
const plain = (text) => String(text).replace(ISOLATES, "");

const calls = { open: [], reveal: [], read: [], clipboard: [] };
globalThis.window = {
	api: {
		openFile: async (path) => {
			calls.open.push(path);
			return { ok: true };
		},
		showItemInFolder: async (path) => {
			calls.reveal.push(path);
			return { ok: true };
		},
		readFileBytes: async (path) => {
			calls.read.push(path);
			return { success: false };
		},
	},
};
Object.defineProperty(globalThis, "navigator", {
	value: {
		clipboard: {
			writeText: async (text) => {
				calls.clipboard.push(text);
			},
			write: async () => {},
		},
	},
	configurable: true,
});
globalThis.ClipboardItem = class {};
globalThis.document = {
	createElement: () => ({ click() {} }),
	body: { appendChild() {}, removeChild() {} },
};
globalThis.URL.createObjectURL = () => "blob:test/1";
globalThis.URL.revokeObjectURL = () => {};

const remoteState = { request: null, media: null, toasts: [] };
globalThis.__remote = remoteState;
function resetCalls() {
	for (const key of Object.keys(calls)) calls[key].length = 0;
	remoteState.toasts.length = 0;
	remoteState.requests = [];
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return { status: 500, body: null };
	};
	remoteState.media = async (request) => {
		remoteState.requests.push(request);
		return {
			kind: "bytes",
			status: 200,
			mimeType: "image/png",
			data: new Uint8Array([137, 80, 78, 71]),
		};
	};
}

let nextFileId = 0;
const row = (overrides = {}) => ({
	id: (nextFileId++).toString(16).padStart(16, "0"),
	ref: { type: "path", path: OWNER_PATH },
	name: "chart.png",
	kind: "image",
	size_bytes: 1024,
	created_at: 1,
	modified_at: 1,
	origin: "write",
	highlighted: false,
	highlight_why: null,
	first_seq: 1,
	last_seq: 1,
	first_ts: 1,
	last_ts: 1,
	exists: true,
	session: { id: "aaaaaaaaaaaa", role: "self", child_id: null, label: null },
	remote: true,
	origin_device: { id: "dev2", name: "lop-remote-node-2" },
	remote_read: { kind: "path" },
	remote_unreadable: null,
	...overrides,
});

const PATH_ACTIONS = new Set(["open-file", "open-folder", "copy-file-path"]);
const REASONS = [
	"outside_session_files",
	"missing",
	"too_large",
	"sensitive",
	"not_referenced",
];

// ------------------------------------------------------------- the rows

test("a local row has no remote facts; a remote row carries the viewer-stamped device", () => {
	assert.equal(remoteOf(row({ remote: undefined }), "aaaaaaaaaaaa"), null);
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	assert.equal(remote.deviceName, "lop-remote-node-2");
	assert.equal(remote.readKind, "path");
	assert.equal(remote.unreadable, null);
	assert.equal(remote.ownerPath, OWNER_PATH);
	assert.equal(remote.sessionId, "aaaaaaaaaaaa");
});

test("a remote row with no read verdict is unreadable, never guessed readable", () => {
	const remote = remoteOf(
		row({ remote_read: null, remote_unreadable: null }),
		"aaaaaaaaaaaa",
	);
	assert.equal(remote.unreadable, "outside_session_files");
});

test("indexedDocument keeps the remote row on the same classification path, without a local path identity", () => {
	const local = indexedDocument(row({ remote: undefined }), "aaaaaaaaaaaa");
	const remote = indexedDocument(row(), "aaaaaaaaaaaa");
	assert.equal(remote.type, local.type, "same kind → same sticky section");
	assert.equal(remote.title, local.title);
	assert.ok(remote.id.startsWith("remote:"), "id is the owner's row id");
	assert.ok(remote.remote, "carries its remote facts");
	assert.equal(local.remote, undefined);
});

// ------------------------------------------------------------- §3 table

test("readable, not yet downloaded: preview, Download, Copy path on <device>, Save as, Copy image — no local path actions", () => {
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const actions = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: true,
		landedPath: null,
	});
	assert.deepEqual(
		actions.map((action) => action.id),
		[
			"show-in-canvas",
			"expand-image",
			"download",
			"copy-owner-path",
			"save-as",
			"copy-image",
		],
	);
	assert.ok(actions.every((action) => action.disabledReason === null));
	const download = actions.find((action) => action.id === "download");
	assert.equal(plain(download.label), "Download to this device");
	const copy = actions.find((action) => action.id === "copy-owner-path");
	assert.equal(plain(copy.label), "Copy path on lop-remote-node-2");
	assert.equal(copy.target, OWNER_PATH, "copied as text, labelled as theirs");
});

test("readable, downloaded: Open file / Open folder / Copy file path act on the LANDED path", () => {
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const landed = "/home/me/Downloads/chart.png";
	const actions = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: false,
		landedPath: landed,
	});
	const ids = actions.map((action) => action.id);
	assert.ok(!ids.includes("download"), "no second download offer");
	assert.ok(!ids.includes("copy-owner-path"), "the local copy's path wins");
	for (const id of PATH_ACTIONS)
		assert.equal(actions.find((action) => action.id === id).target, landed);
});

test("readable over 32 MiB: Download stays, Save as and Copy image are hidden", () => {
	const remote = remoteOf(
		row({ size_bytes: REMOTE_PREVIEW_MAX_BYTES + 1 }),
		"aaaaaaaaaaaa",
	);
	const ids = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: true,
		canExpand: false,
		landedPath: null,
	}).map((action) => action.id);
	assert.ok(ids.includes("download"));
	assert.ok(!ids.includes("save-as"));
	assert.ok(!ids.includes("copy-image"));
});

test("unreadable rows: preview/open/folder disabled WITH the reason, byte actions hidden, owner path still copyable", () => {
	for (const reason of REASONS) {
		const remote = remoteOf(
			row({ remote_read: null, remote_unreadable: reason }),
			"aaaaaaaaaaaa",
		);
		const actions = remoteFileActions(remote, {
			mediaKind: "image",
			canShowInCanvas: true,
			canExpand: true,
			landedPath: null,
		});
		const sentence = remoteUnreadableText(remote);
		assert.ok(plain(sentence).includes("lop-remote-node-2"), reason);
		for (const id of ["show-in-canvas", "open-file", "open-folder"]) {
			const action = actions.find((entry) => entry.id === id);
			assert.equal(action.disabledReason, sentence, `${reason}: ${id}`);
			assert.equal(action.target, null);
		}
		const ids = actions.map((action) => action.id);
		for (const hidden of ["download", "save-as", "copy-image", "expand-image"])
			assert.ok(!ids.includes(hidden), `${reason}: ${hidden} hidden`);
		assert.ok(ids.includes("copy-owner-path"));
	}
	const workspace = remoteOf(
		row({ remote_read: null, remote_unreadable: "outside_session_files" }),
		"aaaaaaaaaaaa",
	);
	assert.equal(
		plain(remoteUnreadableText(workspace)),
		"Lives in lop-remote-node-2's workspace. Ask the session to copy it to its scratchpad.",
	);
});

// ------------------------------------------------------------- I3-1

function* everyRemoteCase() {
	for (const unreadable of [null, ...REASONS])
		for (const landed of [null, "/home/me/Downloads/chart (1).png"])
			for (const mediaKind of ["image", "video", "audio", "file"])
				for (const size of [1024, REMOTE_PREVIEW_MAX_BYTES + 1, null]) {
					const remote = remoteOf(
						row({
							size_bytes: size,
							remote_read: unreadable ? null : { kind: "path" },
							remote_unreadable: unreadable,
						}),
						"aaaaaaaaaaaa",
					);
					yield { remote, landed, mediaKind };
				}
}

test("I3-1 (table): no path-shaped action ever targets the owner's path", () => {
	let checked = 0;
	for (const { remote, landed, mediaKind } of everyRemoteCase()) {
		for (const action of remoteFileActions(remote, {
			mediaKind,
			canShowInCanvas: true,
			canExpand: true,
			landedPath: landed,
		})) {
			if (!PATH_ACTIONS.has(action.id)) continue;
			checked += 1;
			assert.notEqual(action.target, OWNER_PATH, action.id);
			assert.ok(
				action.target === null || action.target === landed,
				`${action.id} acts on the landed copy or nothing`,
			);
		}
	}
	assert.ok(checked > 0, "the property was exercised");
});

test("I3-1 (dispatch): performing every action never hands the owner path to openFile, showItemInFolder or readFileBytes", async () => {
	resetCalls();
	let performed = 0;
	for (const { remote, landed, mediaKind } of everyRemoteCase()) {
		const document = {
			id: `remote:${remote.fileId}`,
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote,
		};
		for (const action of remoteFileActions(remote, {
			mediaKind,
			canShowInCanvas: true,
			canExpand: true,
			landedPath: landed,
		})) {
			await performRemoteAction(action, {
				document,
				saveName: "chart.png",
				onShowInCanvas: () => {},
				onExpand: () => {},
			});
			performed += 1;
		}
	}
	assert.ok(performed > 100, `exercised ${performed} dispatches`);
	assert.ok(!calls.open.includes(OWNER_PATH), "openFile never saw it");
	assert.ok(
		!calls.reveal.includes(OWNER_PATH),
		"showItemInFolder never saw it",
	);
	assert.equal(calls.read.length, 0, "no local file read at all");
	assert.ok(calls.open.length > 0, "landed copies did open");
	for (const request of remoteState.requests)
		assert.ok(
			!JSON.stringify(request).includes(OWNER_PATH),
			"no transport request carries the owner path either",
		);
});

// ------------------------------------------------------------- doors

test("content: a path row's bytes come over sessions.files.content by row id", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const blob = await fetchRemoteFileBlob({
		id: "remote:x",
		title: "chart.png",
		path: OWNER_PATH,
		content: "",
		remote,
	});
	assert.equal(blob.type, "image/png");
	assert.deepEqual(remoteState.requests, [
		{
			op: "sessions.files.content",
			sessionId: "aaaaaaaaaaaa",
			fileId: remote.fileId,
		},
	]);
	assert.equal(calls.read.length, 0);
});

test("content: a 504 is AttachmentOwnerUnreachableError (retryable)", async () => {
	resetCalls();
	remoteState.media = async () => ({
		kind: "error",
		status: 504,
		detail: "pending",
	});
	await assert.rejects(
		fetchRemoteFileBlob({
			id: "remote:x",
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote: remoteOf(row(), "aaaaaaaaaaaa"),
		}),
		(error) => error instanceof AttachmentOwnerUnreachableError,
	);
});

test("download: a receipt lands the path, toasts it, and unlocks the local actions", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	const landed = "/home/me/Downloads/chart.png";
	remoteState.request = async (request) => {
		remoteState.requests.push(request);
		return {
			status: 200,
			body: {
				result: {
					path: landed,
					name: "chart.png",
					bytes: 4,
					sha256: "0".repeat(64),
					created: true,
				},
			},
		};
	};
	const receipt = await downloadRemoteFile(remote);
	assert.equal(receipt.path, landed);
	assert.deepEqual(remoteState.requests, [
		{
			op: "sessions.files.download",
			sessionId: "aaaaaaaaaaaa",
			fileId: remote.fileId,
		},
	]);
	assert.equal(landedPathFor(remote), landed);
	const toast = remoteState.toasts.at(-1);
	assert.equal(toast.kind, "success");
	assert.equal(plain(toast.message), "Downloaded chart.png");
	assert.ok(toast.options?.description, "the receipt carries its actions");
	const open = remoteFileActions(remote, {
		mediaKind: "image",
		canShowInCanvas: false,
		canExpand: false,
		landedPath: landedPathFor(remote),
	}).find((action) => action.id === "open-file");
	await performRemoteAction(open, {
		document: {
			id: "x",
			title: "chart.png",
			path: OWNER_PATH,
			content: "",
			remote,
		},
		saveName: "chart.png",
	});
	assert.deepEqual(calls.open, [landed]);
});

test("download: a 504 says the transfer is still running and lands nothing", async () => {
	resetCalls();
	const remote = remoteOf(row(), "aaaaaaaaaaaa");
	remoteState.request = async () => ({ status: 504, body: null });
	assert.equal(await downloadRemoteFile(remote), null);
	assert.equal(landedPathFor(remote), null);
	assert.equal(
		plain(remoteState.toasts.at(-1).message),
		"Still fetching from lop-remote-node-2. Try again in a moment.",
	);
});

test("download: an unreadable row never reaches the backend", async () => {
	resetCalls();
	const remote = remoteOf(
		row({ remote_read: null, remote_unreadable: "sensitive" }),
		"aaaaaaaaaaaa",
	);
	assert.equal(await downloadRemoteFile(remote), null);
	assert.equal(remoteState.requests.length, 0);
});
