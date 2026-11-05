#!/usr/bin/env node
/**
 * The Team Bridge staged-image seam, driven against a stub hub that records BYTES.
 *
 * WHY THIS RUN EXISTS, and what it is honest about. The operator's report is that a
 * pasted image reaches the bridge's send as a base64 TAIL in a failure row. The
 * SHIPPED path is: the composer's paste handler stages
 * `FileReader.readAsDataURL(file)` into `conversation-input-store.path`, and the
 * send hands those strings to `uploadStagedImages`, which reads each one, prepares
 * it (`prepareImageForUpload`), and posts the bytes to the hub.
 *
 * The built-app page could not be made to paint on this host inside the lane's
 * budget: the Team Bridge route lands in the app's own error boundary before its
 * first read, and the chat pane mounts no composer against a stub hub. So this run
 * drives the SAME shipped modules - bundled from `src/` by esbuild, exactly as the
 * sibling suites do - against a stub that speaks the desktop transport over real
 * HTTP and RECORDS what it was handed. What it is not: a rendered frame, or proof
 * about the OS pasteboard. It is the seam, which is where the defect lives.
 *
 * WHAT IT ANSWERS, per cell:
 *   - the staged value's KIND and the size of the base64 payload it carried;
 *   - what the stub received (count, bytes, mime, decoded dimensions, sha256);
 *   - the failure rows the send built: each `name` and `reason` - the two things the
 *     page's row renders, and the place the operator's screenshot shows a base64 tail.
 *
 * Usage:
 *     node scripts/team-bridge-staged-upload-seam.mjs --expect broken|fixed
 *     node scripts/team-bridge-staged-upload-seam.mjs --expect fixed --json
 *
 * It never touches the macOS pasteboard, starts no Electron window, and binds one
 * loopback port for the stub only.
 */

import { createHash, randomUUID } from "node:crypto";
import { mkdtempSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import Module from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { deflateSync } from "node:zlib";
import { build } from "esbuild";

const flag = (name) => {
	const at = process.argv.indexOf(name);
	if (at === -1) return null;
	const value = process.argv[at + 1];
	return value === undefined || value.startsWith("--") ? null : value;
};
const EXPECT = flag("--expect");
if (EXPECT !== "broken" && EXPECT !== "fixed")
	throw new Error(
		`--expect takes broken|fixed (got ${JSON.stringify(EXPECT)}): the base tree and the fix are this run's two claims, and a defaulted value would silently answer the other one`,
	);

/* --------------------------------------------------------------- fixtures -- */

/** A deterministic truecolour PNG, minted here (no encoder in the dependency tree). */
function gradientPng({ width, height }) {
	const crcTable = (() => {
		const table = new Uint32Array(256);
		for (let n = 0; n < 256; n += 1) {
			let c = n;
			for (let k = 0; k < 8; k += 1)
				c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
			table[n] = c >>> 0;
		}
		return table;
	})();
	const crc32 = (bytes) => {
		let c = 0xffffffff;
		for (const byte of bytes) c = crcTable[(c ^ byte) & 0xff] ^ (c >>> 8);
		return (c ^ 0xffffffff) >>> 0;
	};
	const chunk = (type, data) => {
		const out = Buffer.alloc(8 + data.length + 4);
		out.writeUInt32BE(data.length, 0);
		out.write(type, 4, "ascii");
		data.copy(out, 8);
		out.writeUInt32BE(crc32(out.subarray(4, 8 + data.length)), 8 + data.length);
		return out;
	};
	const raw = Buffer.alloc((width * 3 + 1) * height);
	let at = 0;
	for (let y = 0; y < height; y += 1) {
		raw[at++] = 0;
		for (let x = 0; x < width; x += 1) {
			const t = (x / Math.max(1, width - 1) + y / Math.max(1, height - 1)) / 2;
			raw[at++] = Math.round(20 + 200 * t);
			raw[at++] = Math.round(80 + 120 * (1 - t));
			raw[at++] = Math.round(180 - 90 * t);
		}
	}
	const ihdr = Buffer.alloc(13);
	ihdr.writeUInt32BE(width, 0);
	ihdr.writeUInt32BE(height, 4);
	ihdr[8] = 8;
	ihdr[9] = 2;
	return Buffer.concat([
		Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
		chunk("IHDR", ihdr),
		chunk("IDAT", deflateSync(raw)),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

const PNG = gradientPng({ width: 1600, height: 1000 });
const SMALL = gradientPng({ width: 240, height: 160 });
/** A data URL built the way `FileReader.readAsDataURL` builds one. */
const dataUrlFor = (bytes, mime = "image/png") =>
	`data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;

/* ------------------------------------------------------------------ the stub -- */

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");

function dimensionsOf(bytes) {
	if (bytes.length > 24 && bytes[0] === 0x89 && bytes[1] === 0x50)
		return {
			mime: "image/png",
			width: bytes.readUInt32BE(16),
			height: bytes.readUInt32BE(20),
		};
	if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8)
		return { mime: "image/jpeg", width: 0, height: 0 };
	return { mime: "application/octet-stream", width: 0, height: 0 };
}

async function startStub() {
	const uploads = [];
	const server = createServer((request, response) => {
		if (request.method !== "POST") {
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ result: {} }));
			return;
		}
		const chunks = [];
		request.on("data", (chunk) => chunks.push(chunk));
		request.on("end", () => {
			const body = Buffer.concat(chunks);
			const header = request.headers["x-desktop-media"];
			let request_ = null;
			try {
				request_ = header ? JSON.parse(String(header)) : null;
			} catch {
				request_ = null;
			}
			if (request_?.op === "team_bridge.attachment.upload") {
				const dims = dimensionsOf(body);
				const receipt = {
					conversation_id: request_.conversationId ?? null,
					bytes: body.length,
					sha256: sha(body),
					mime: dims.mime,
					width: dims.width,
					height: dims.height,
				};
				uploads.push(receipt);
				response.writeHead(201, { "content-type": "application/json" });
				response.end(
					JSON.stringify({
						result: {
							attachment: {
								id: `att_${uploads.length}`,
								mime: dims.mime,
								size: body.length,
								width: dims.width,
								height: dims.height,
								sha256: receipt.sha256,
								state: "staged",
							},
						},
					}),
				);
				return;
			}
			response.writeHead(200, { "content-type": "application/json" });
			response.end(JSON.stringify({ result: {} }));
		});
	});
	await new Promise((resolve, reject) => {
		server.once("error", reject);
		server.listen(0, "127.0.0.1", resolve);
	});
	const { port } = server.address();
	return { server, port, uploads };
}

/* --------------------------------------------------------------- the modules -- */

/*
 * THE REAL MODULES, BUNDLED FROM `src/`. Same recipe as the sibling suites: CJS so
 * `require` resolves, Vite's `import.meta.env` defined because the app's config
 * loader reads it at import time.
 */
const bundle = await build({
	stdin: {
		contents: `export {uploadStagedImages} from "./src/renderer/src/features/team-bridge/team-bridge-staged-upload"; export {prepareImageForUpload, sniffImage} from "./src/renderer/src/features/team-bridge/team-bridge-attachments-model";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	loader: { ".css": "empty", ".svg": "text", ".png": "dataurl" },
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = join(
	mkdtempSync(join(tmpdir(), "tb-seam-")),
	"runtime.cjs",
);
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { uploadStagedImages } = compiled.exports;

/*
 * THE STAGED VALUE'S OWN SHAPE, read here rather than through the module: the base
 * tree has no `stagedSource` export (that is the fix), and this run has to describe
 * a value on BOTH trees with one instrument.
 */
function shapeOf(value) {
	const isDataUrl = typeof value === "string" && value.startsWith("data:");
	return {
		kind: isDataUrl ? "dataUrl" : "path",
		mime: isDataUrl ? value.slice(5, value.indexOf(";")) : null,
		payloadChars: isDataUrl ? value.length - value.indexOf(",") - 1 : null,
		// NEVER THE PAYLOAD: the tail is what the operator's screenshot shows, and
		// printing more than the tail is what the defect itself did.
		tailIfSplitOnSlash: isDataUrl ? value.split("/").pop().slice(-28) : null,
	};
}

/* ------------------------------------------------------------------- the run -- */

const STUB = await startStub();

/*
 * THE TRANSPORT SHIM. The app's real `TeamBridgeApi` reaches the hub through
 * `window.api.desktop.media` (main's bearer relay). Here that function posts the
 * SAME raw body to the stub over real HTTP, so the bytes the receipt records are
 * the bytes the shipped prepare step produced.
 */
globalThis.window = {
	api: {
		readFile: async () => ({ success: false, error: "no such file" }),
		desktop: {
			media: async (request, bytes) => {
				const response = await fetch(
					`http://127.0.0.1:${STUB.port}/v1/desktop/media/start`,
					{
						method: "POST",
						headers: {
							"content-type": "application/octet-stream",
							"x-desktop-media": JSON.stringify(request),
						},
						body: bytes ? Buffer.from(bytes) : undefined,
					},
				);
				const body = await response.json();
				return { kind: "json", status: response.status, body };
			},
		},
	},
};

const CAPABILITY = {
	enabled: true,
	max_count: 4,
	max_bytes: 8 * 1024 * 1024,
	mime_types: ["image/png", "image/jpeg"],
};

/** One cell: the staged values, then what the send did with them. */
async function cell(label, staged) {
	const before = STUB.uploads.length;
	const result = await uploadStagedImages({
		paths: staged,
		accountId: "acc_seam",
		tenantId: "org_seam",
		conversationId: "bcv_seam",
		capability: CAPABILITY,
	});
	const received = STUB.uploads.slice(before);
	const shapes = staged.map(shapeOf);
	return {
		label,
		stagedCount: staged.length,
		shapes,
		ids: result.ids,
		failures: result.failures,
		received: received.map((receipt) => ({
			bytes: receipt.bytes,
			sha256: receipt.sha256,
			mime: receipt.mime,
			dimensions: `${receipt.width}x${receipt.height}`,
		})),
	};
}

const cells = [];
cells.push(await cell("paste-png", [dataUrlFor(PNG)]));
cells.push(
	await cell("paste-three", [
		dataUrlFor(SMALL),
		dataUrlFor(gradientPng({ width: 320, height: 200 })),
		dataUrlFor(gradientPng({ width: 200, height: 320 })),
	]),
);
cells.push(
	await cell("paste-corrupt", [
		`data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}`,
	]),
);

/* A filesystem path cell needs a real file: this is the control, not the defect. */
const pathCell = join(tmpdir(), `tb-seam-${process.pid}.png`);
writeFileSync(pathCell, SMALL);
globalThis.window.api.readFile = async (path) =>
	path === pathCell
		? { success: true, data: Buffer.from(SMALL).toString("base64") }
		: { success: false, error: "no such file" };
cells.push(await cell("file-picker-path", [pathCell]));

/* ------------------------------------------------------------------ the report -- */

const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/;
/* A base64 TAIL is short: the operator's own row was 28 characters. */
const base64Tail = /^[A-Za-z0-9+/]{16,}={0,2}$/;
const summary = {
	expect: EXPECT,
	stubPort: STUB.port,
	cells,
	assertions: [],
};

function assert(label, ok, detail) {
	summary.assertions.push({ label, ok, detail });
}

const first = cells[0];
const three = cells[1];
const corrupt = cells[2];
const picker = cells[3];

if (EXPECT === "broken") {
	/*
	 * THE OPERATOR'S SYMPTOM, EXACTLY. A pasted picture's failure row is NAMED by the
	 * base64 tail (the PNG IEND marker is the end of a base64 stream), and no bytes
	 * reach the hub.
	 */
	assert(
		"NO bytes reach the hub for a pasted PNG (the functional break)",
		first.received.length === 0,
		JSON.stringify(first.received),
	);
	assert(
		"the pasted PNG's failure row is named by a base64 tail (the defect)",
		first.failures.length === 1 && base64Tail.test(first.failures[0].name),
		JSON.stringify(first.failures),
	);
	assert(
		"the row's name IS the tail of the payload, not a file name",
		first.failures[0]?.name === first.shapes[0]?.tailIfSplitOnSlash,
		JSON.stringify({
			name: first.failures[0]?.name,
			tail: first.shapes[0]?.tailIfSplitOnSlash,
		}),
	);
	assert(
		"three pasted pictures produce three failure rows, each echoing its own tail",
		three.failures.length === 3 &&
			three.failures.every((failure) => base64Tail.test(failure.name)),
		JSON.stringify(three.failures),
	);
	assert(
		"the corrupt image's row echoes payload too (the header and the whole payload)",
		corrupt.failures.length === 1 &&
			corrupt.failures[0].name.includes("base64,"),
		JSON.stringify(corrupt.failures),
	);
	assert(
		"the file-picker control still works (a real path is read and uploaded)",
		picker.received.length === 1 && picker.failures.length === 0,
		JSON.stringify(picker),
	);
} else {
	/*
	 * BYTE-IDENTICAL HERE, ON PURPOSE. This process has no canvas, so
	 * `boundImageForWire`'s downscale is a documented pass-through (the sibling
	 * attachment suite says the same): the sha256 below is the SOURCE's, which is what
	 * proves the staged payload was carried whole. The 1024px bound runs in Chromium
	 * and is not what this run can claim.
	 */
	assert(
		"a pasted PNG reaches the hub as bytes",
		first.received.length === 1 &&
			first.received[0].sha256 === sha(PNG) &&
			first.received[0].dimensions === "1600x1000",
		JSON.stringify({ received: first.received, expectedSha: sha(PNG) }),
	);
	assert(
		"a pasted PNG produces no failure row",
		first.failures.length === 0,
		JSON.stringify(first.failures),
	);
	assert(
		"three pasted pictures produce three uploads and no failure rows",
		three.received.length === 3 && three.failures.length === 0,
		JSON.stringify({ received: three.received, failures: three.failures }),
	);
	assert(
		"a genuinely corrupt image still reports a reason, with no payload in its name",
		corrupt.failures.length === 1 &&
			corrupt.failures[0].reason === "unsupported" &&
			base64Tail.test(corrupt.failures[0].name) === false &&
			!corrupt.failures[0].name.includes("data:") &&
			!corrupt.failures[0].name.includes("base64"),
		JSON.stringify(corrupt.failures),
	);
	assert(
		"the file-picker control still works (a real path is read and uploaded)",
		picker.received.length === 1 && picker.failures.length === 0,
		JSON.stringify(picker),
	);
}

STUB.server.close();

if (process.argv.includes("--json")) {
	console.log(JSON.stringify(summary, null, 1));
} else {
	console.log(
		`\n=== team-bridge staged-upload seam (expect: ${EXPECT}) ===\nstub: 127.0.0.1:${STUB.port}\n`,
	);
	console.log(
		"cell | staged (kind/payload chars) | ids | failures (name | reason) | received (bytes, dims, sha256)",
	);
	for (const entry of cells) {
		console.log(
			[
				entry.label,
				entry.shapes
					.map((shape) => `${shape.kind}/${shape.payloadChars ?? "-"}`)
					.join(" + "),
				`${entry.ids.length}`,
				entry.failures.length === 0
					? "none"
					: entry.failures
							.map((failure) => `${failure.name} | ${failure.reason}`)
							.join(" ; "),
				entry.received.length === 0
					? "none"
					: entry.received
							.map(
								(receipt) =>
									`${receipt.bytes}B ${receipt.dimensions} ${receipt.mime} ${receipt.sha256.slice(0, 16)}`,
							)
							.join(" ; "),
			].join(" | "),
		);
	}
	console.log("");
	for (const assertion of summary.assertions)
		console.log(
			`${assertion.ok ? "PASS" : "FAIL"}  ${assertion.label}\n        ${assertion.detail}`,
		);
	const failures = summary.assertions.filter((assertion) => !assertion.ok);
	console.log(
		`\n${summary.assertions.length - failures.length}/${summary.assertions.length} assertions passed`,
	);
	if (failures.length > 0) process.exitCode = 1;
}
