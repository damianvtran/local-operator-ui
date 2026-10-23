/**
 * The desktop half of the attachment contract, exercised end to end.
 *
 * WHY THESE ARE NODE TESTS AND NOT STORYBOOK PLAYS. Three of the four claims are
 * about behaviour that a still cannot show: which bytes a send would put on the
 * wire, what happens when the daemon refuses an upload, and whether a stored
 * document row maps back to the card the transcript paints. The fourth - the
 * card's own shape - is covered by the committed Storybook frames beside the
 * composer stories; what is pinned here is the data those frames are built from.
 *
 * The encoder and the reducer are bundled from source so the assertions run
 * against the shipped modules, not a copy of their rules.
 */

import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { build } from "esbuild";

/*
 * ONE BUNDLE FOR EVERY SHIPPED MODULE UNDER TEST. Node cannot import the repo's
 * TypeScript directly, and esbuild resolves each module's own imports (including
 * `desktop-contract`) against the real tree, so the assertions run against the
 * code the app ships rather than a paraphrase of its rules.
 */
const bundle = await build({
	stdin: {
		contents: `
			export { uploadAttachment } from "./src/main/attachment-upload";
			export { encodeAttachments } from "./src/renderer/src/features/chat/utils/attachment-encode";
			export { fileOverflowRefusal, unreadableAttachmentRefusal } from "./src/renderer/src/features/chat/utils/attachment-read";
		`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "esm",
	platform: "node",
	write: false,
	tsconfig: "tsconfig.web.json",
	logLevel: "silent",
});
const {
	uploadAttachment,
	encodeAttachments,
	fileOverflowRefusal,
	unreadableAttachmentRefusal,
} = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#core`
);

/* ------------------------------------------------------------------------- *
 * The encoder: images inline, files uploaded, failures named.
 * ------------------------------------------------------------------------- */

const wire = {
	readFile: null,
	uploadAttachment: null,
};

globalThis.window = { api: wire };

const DIGEST = "0123456789abcdef0123456789abcdef";

const uploaded = (name, mime, bytes = 2048) => ({
	success: true,
	attachment: {
		digest: DIGEST,
		name,
		mime_type: mime,
		bytes,
		path: `/tmp/${name}`,
		stored_path: `/store/${DIGEST}.bin`,
	},
});

test("an image from disk rides inline and keeps its origin path", async () => {
	wire.readFile = async () => ({ success: true, data: "QUJD" });
	wire.uploadAttachment = null;
	const result = await encodeAttachments(["/tmp/shot.png"], "look");
	assert.equal(result.images.length, 1);
	assert.equal(result.images[0].mime_type, "image/png");
	assert.equal(result.images[0].origin_path, "/tmp/shot.png");
	assert.deepEqual(result.files, []);
	assert.deepEqual(result.failures, []);
});

test("a pasted image has no origin path, because it has none", async () => {
	wire.readFile = null;
	wire.uploadAttachment = null;
	const result = await encodeAttachments(["data:image/png;base64,QUJD"], "");
	assert.equal(result.images.length, 1);
	assert.equal(result.images[0].origin_path, undefined);
});

test("a non-image from disk uploads and rides as a file reference", async () => {
	const calls = [];
	wire.readFile = null;
	wire.uploadAttachment = async (source) => {
		calls.push(source);
		return uploaded("report.pdf", "application/pdf", 4096);
	};
	const result = await encodeAttachments(["/tmp/report.pdf"], "read this");
	assert.deepEqual(calls, [
		{ kind: "path", path: "/tmp/report.pdf", name: "report.pdf" },
	]);
	assert.equal(result.files.length, 1);
	assert.deepEqual(result.files[0], {
		digest: DIGEST,
		name: "report.pdf",
		mime_type: "application/pdf",
		bytes: 4096,
		path: "/tmp/report.pdf",
	});
	assert.deepEqual(result.images, []);
	assert.deepEqual(result.failures, []);
});

test("an upload refusal is reported with the daemon's own reason, and the send refuses by name", async () => {
	wire.readFile = null;
	wire.uploadAttachment = async () => ({
		success: false,
		code: "too-large",
		error:
			"report.pdf is 40000000 bytes, over the 33554432-byte attachment limit",
	});
	const result = await encodeAttachments(["/tmp/report.pdf"], "");
	assert.equal(result.files.length, 0);
	assert.deepEqual(result.failures, [
		{
			name: "report.pdf",
			kind: "upload",
			detail:
				"report.pdf is 40000000 bytes, over the 33554432-byte attachment limit",
		},
	]);
	assert.equal(
		unreadableAttachmentRefusal(result.failures),
		"report.pdf could not be attached (report.pdf is 40000000 bytes, over the 33554432-byte attachment limit), so this message was not sent. Attach it again, or remove it from the draft.",
	);
});

test("a file addressed to a remote conversation is refused before any upload", async () => {
	let uploads = 0;
	wire.readFile = null;
	wire.uploadAttachment = async () => {
		uploads += 1;
		return uploaded("report.pdf", "application/pdf");
	};
	const result = await encodeAttachments(["/tmp/report.pdf"], "", {
		remoteOwned: true,
	});
	assert.equal(uploads, 0, "no bytes leave this machine for a peer-owned chat");
	assert.deepEqual(result.failures, [{ name: "report.pdf", kind: "remote" }]);
	assert.match(
		unreadableAttachmentRefusal(result.failures) ?? "",
		/^report\.pdf cannot be attached because this conversation is owned by another device/,
	);
});

test("a missing image is reported rather than skipped", async () => {
	wire.readFile = async () => ({ success: false, error: "ENOENT" });
	wire.uploadAttachment = null;
	const result = await encodeAttachments(["/tmp/gone.png"], "");
	assert.deepEqual(result.failures, [{ name: "gone.png", kind: "read" }]);
	assert.match(
		unreadableAttachmentRefusal(result.failures) ?? "",
		/gone\.png could not be read/,
	);
});

test("a draft past the file ceiling refuses WITHOUT uploading anything", async () => {
	let uploads = 0;
	wire.readFile = null;
	wire.uploadAttachment = async (source) => {
		uploads += 1;
		return uploaded(
			source.kind === "path" ? source.name : "pasted",
			"text/plain",
		);
	};
	const paths = Array.from({ length: 10 }, (_, index) => `/tmp/f${index}.txt`);
	const result = await encodeAttachments(paths, "");
	/*
	 * The refusal is decided by the staged list, so the store must see none of the
	 * ten files: uploading first and slicing after wrote up to 10 x 32 MB for a
	 * message that could never be admitted (agent review round 1, m1).
	 */
	assert.equal(uploads, 0, "a refused draft writes no bytes into the store");
	assert.equal(result.files.length, 0);
	assert.equal(result.fileOverflow, 2);
	assert.match(
		fileOverflowRefusal(result.fileOverflow) ?? "",
		/^This draft carries 10 files and one message carries up to 8/,
	);
});

/* ------------------------------------------------------------------------- *
 * The upload transport: bound, multipart, typed failures.
 * ------------------------------------------------------------------------- */

const scratchFile = (name, contents) => {
	const dir = mkdtempSync(join(tmpdir(), "attach-upload-"));
	const path = join(dir, name);
	writeFileSync(path, contents);
	return path;
};

/** A server that records the raw body and answers with one canned response. */
const recordingServer = async (status, payload) => {
	const seen = [];
	const server = createServer((request, response) => {
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			seen.push({
				url: request.url,
				authorization: request.headers.authorization,
				contentType: request.headers["content-type"],
				body: Buffer.concat(chunks),
			});
			response.writeHead(status, { "content-type": "application/json" });
			response.end(JSON.stringify(payload));
		});
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const { port } = server.address();
	return {
		url: `http://127.0.0.1:${port}`,
		seen,
		close: () => new Promise((resolve) => server.close(resolve)),
	};
};

test("an upload posts real multipart bytes to the route, with the token", async () => {
	const path = scratchFile("report.pdf", "%PDF-1.7\nhello");
	const server = await recordingServer(200, {
		digest: DIGEST,
		name: "report.pdf",
		mime_type: "application/pdf",
		bytes: 15,
		path,
		stored_path: `/store/${DIGEST}.bin`,
	});
	try {
		const result = await uploadAttachment({
			source: { kind: "path", path },
			backendUrl: server.url,
			token: "tok",
		});
		assert.equal(result.success, true);
		assert.equal(result.attachment.digest, DIGEST);
		const request = server.seen[0];
		assert.equal(request.url, "/v1/desktop/attachments");
		assert.match(request.contentType ?? "", /^multipart\/form-data; boundary=/);
		assert.equal(request.authorization, "Bearer tok");
		const body = request.body.toString("utf8");
		assert.match(body, /name="file"; filename="report\.pdf"/);
		assert.match(body, /name="name"\r\n\r\nreport\.pdf/);
		assert.match(body, new RegExp(`name="origin_path"\\r\\n\\r\\n${path}`));
		assert.match(body, /%PDF-1\.7/);
	} finally {
		await server.close();
	}
});

test("a file over the cap is refused before its bytes are read", async () => {
	const path = scratchFile("big.bin", "0123456789");
	const result = await uploadAttachment({
		source: { kind: "path", path },
		backendUrl: "http://127.0.0.1:1",
		token: null,
		maxBytes: 4,
	});
	assert.equal(result.success, false);
	assert.equal(result.code, "too-large");
	assert.equal(result.sizeBytes, 10);
});

test("the daemon's refusal sentence survives as the upload's reason", async () => {
	const path = scratchFile("report.pdf", "%PDF-1.7");
	const server = await recordingServer(413, {
		detail: { code: "too_large", message: "File exceeds the 32 MB limit" },
	});
	try {
		const result = await uploadAttachment({
			source: { kind: "path", path },
			backendUrl: server.url,
			token: null,
		});
		assert.equal(result.success, false);
		assert.equal(result.code, "refused");
		assert.equal(result.error, "File exceeds the 32 MB limit");
	} finally {
		await server.close();
	}
});

test("a 2xx answer with no attachment record is a failure, never a quiet success", async () => {
	const path = scratchFile("report.pdf", "%PDF-1.7");
	const server = await recordingServer(200, { ok: true });
	try {
		const result = await uploadAttachment({
			source: { kind: "path", path },
			backendUrl: server.url,
			token: null,
		});
		assert.equal(result.success, false);
		assert.equal(result.code, "refused");
	} finally {
		await server.close();
	}
});

test("a pasted file uploads from its data URL with no origin path", async () => {
	const server = await recordingServer(200, {
		digest: DIGEST,
		name: "clip.txt",
		mime_type: "text/plain",
		bytes: 5,
		path: null,
		stored_path: `/store/${DIGEST}.bin`,
	});
	try {
		const result = await uploadAttachment({
			source: {
				kind: "dataUrl",
				dataUrl: "data:text/plain;base64,aGVsbG8=",
				name: "clip.txt",
			},
			backendUrl: server.url,
			token: null,
		});
		assert.equal(result.success, true);
		const body = server.seen[0].body.toString("utf8");
		assert.match(body, /hello/);
		assert.doesNotMatch(body, /name="origin_path"/);
	} finally {
		await server.close();
	}
});

/* ------------------------------------------------------------------------- *
 * The history mapping: a stored document block becomes the card's data.
 * ------------------------------------------------------------------------- */

test("a document block maps to the sent-file card's view record, legacy rows included", async () => {
	const bundle = await build({
		entryPoints: [
			"src/renderer/src/features/chat/canonical/transcript-reducer.ts",
		],
		bundle: true,
		format: "esm",
		platform: "node",
		write: false,
		tsconfig: "tsconfig.web.json",
		logLevel: "silent",
	});
	const module = await import(
		`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}#${Math.random()}`
	);

	const payload = {
		content: [
			{ type: "text", text: "read this" },
			{
				type: "document",
				attachment: DIGEST,
				filename: "report.pdf",
				mime_type: "application/pdf",
				path: "/tmp/report.pdf",
				bytes: 4096,
				injection: "native",
			},
		],
	};
	const documents = module.extractDocuments(payload, "row-1");
	assert.equal(documents.length, 1);
	assert.deepEqual(documents[0], {
		id: "row-1:doc:0",
		attachment: DIGEST,
		filename: "report.pdf",
		mimeType: "application/pdf",
		path: "/tmp/report.pdf",
		// The client's FileRef carries no store path; the durable block is what can
		// name the retained copy, and this row does not.
		storedPath: null,
		bytes: 4096,
		injection: "native",
	});

	// The owner's row can name the retained copy, which is the value the missing
	// state copies instead of the dead origin path (design D2 follow-up).
	const stored = module.extractDocuments(
		{
			content: [
				{
					type: "document",
					attachment: DIGEST,
					filename: "report.pdf",
					mime_type: "application/pdf",
					path: "/tmp/report.pdf",
					stored_path: "/var/attachments/0123456789abcdef0123456789abcdef.bin",
					bytes: 4096,
				},
			],
		},
		"row-4",
	);
	assert.equal(stored.length, 1);
	assert.equal(
		stored[0].storedPath,
		"/var/attachments/0123456789abcdef0123456789abcdef.bin",
	);

	// A row written before `type` existed: `filename` + `mime_type` + a digest is
	// the legacy spelling the core routes to the same block (contract v1 §2).
	const legacy = module.extractDocuments(
		{
			content: [
				{
					attachment: DIGEST,
					filename: "old.csv",
					mime_type: "text/csv",
					bytes: 10,
				},
			],
		},
		"row-2",
	);
	assert.equal(legacy.length, 1);
	assert.equal(legacy[0].filename, "old.csv");
	assert.equal(legacy[0].path, null);
	assert.equal(legacy[0].storedPath, null);

	// Identity is preserved when nothing changed, so a per-token repaint does not
	// remount every file card.
	assert.equal(module.extractDocuments(payload, "row-1", documents), documents);

	// And an image block is not mistaken for a document despite its digest.
	assert.deepEqual(
		module.extractDocuments(
			{ content: [{ attachment: DIGEST, mime_type: "image/png" }] },
			"row-3",
		),
		[],
	);
});
