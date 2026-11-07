// The staged-image upload path: what a DATA URL and what a FILE PATH each do.
//
// WHY THIS SUITE EXISTS. The Team Bridge composer stages TWO different things in
// one store field (`path`): the picker and a Finder drop put a filesystem path
// there, while the shared composer's paste handler puts a `data:image/...` URL
// there (it reads the clipboard's `File` with `FileReader.readAsDataURL`). The
// send used to treat both as a path, so a pasted picture went to
// `window.api.readFile` (a MAIN-process filesystem read), failed as "damaged",
// and was named by splitting the data URL on "/" - which printed the base64 tail
// to the operator. These cases pin the three rules the fix rests on:
//
//   1. a data URL is decoded from its OWN payload, in the renderer, and never
//      reaches the filesystem read;
//   2. a filesystem path still takes the filesystem read (the control: one
//      prepare path, two sources);
//   3. a failure row's NAME is never derived from the payload - no base64 run and
//      no `data:` prefix can appear in it - and a corrupt image still fails with
//      a reason from the closed set.
//
// WHAT THIS IS NOT: the transport here is a fake, so this is module/state proof.
// The bytes the hub receives and the row a person would read are
// `scripts/team-bridge-staged-upload-seam.mjs`'s claim against a recording stub,
// and the rendered sentence is design's Storybook frames' - not this file's.

import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import Module from "node:module";
import { beforeEach, test } from "node:test";
import { build } from "esbuild";

const bundle = await build({
	stdin: {
		contents: `export {uploadStagedImages, stagedSource} from "./src/renderer/src/features/team-bridge/team-bridge-staged-upload";
 export {getFileName} from "./src/renderer/src/features/chat/utils/get-file-name";
 export {setLocale} from "./src/i18n";`,
		resolveDir: process.cwd(),
	},
	bundle: true,
	format: "cjs",
	platform: "node",
	external: ["@tanstack/react-query", "react", "react-dom"],
	define: { "import.meta.env": "__viteEnv" },
	banner: { js: "const __viteEnv = {};" },
	loader: {
		".css": "empty",
		".svg": "text",
		".png": "dataurl",
		".webp": "dataurl",
		".ttf": "empty",
		".woff": "empty",
		".woff2": "empty",
	},
	tsconfig: "tsconfig.app.json",
	write: false,
});
const compiledPath = `${process.cwd()}/scripts/team-bridge-staged-upload-runtime.cjs`;
const compiled = new Module(compiledPath);
compiled.filename = compiledPath;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const { uploadStagedImages, stagedSource, getFileName, setLocale } =
	compiled.exports;
// The failure name composes a keyed position label, so the suite pins the source
// language the way the sibling attachment suite does.
setLocale("en");

/* A 1x1 PNG: real magic numbers, no fixture file. */
const PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
	),
	(c) => c.charCodeAt(0),
);
const PNG_DATA_URL = `data:image/png;base64,${Buffer.from(PNG).toString("base64")}`;
/* A second PNG with different bytes, so "three uploads" cannot be one picture thrice. */
const SMALL_PNG = Uint8Array.from(
	atob(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
	),
	(char) => char.charCodeAt(0),
);

const CAP = {
	enabled: true,
	max_count: 4,
	max_bytes: 5 * 1024 * 1024,
	max_pixels: 16_777_216,
	mime_types: ["image/png", "image/jpeg"],
};
const BASE64_RUN = /[A-Za-z0-9+/]{40,}={0,2}/;
const sha256 = (bytes) =>
	createHash("sha256").update(Buffer.from(bytes)).digest("hex");

/*
 * THE TRANSPORT, IN ONE PLACE. `window.api.desktop.media` is the raw-body relay
 * the upload uses, and `window.api.readFile` is the filesystem read the paste path
 * must never reach. Both record their calls so a case can assert which one ran.
 */
let reads = [];
let uploads = [];
let readFileAnswer = null;
beforeEach(() => {
	reads = [];
	uploads = [];
	readFileAnswer = null;
	globalThis.window = {
		api: {
			readFile: async (path) => {
				reads.push(path);
				return readFileAnswer ?? { success: false, error: "no such file" };
			},
			desktop: {
				media: async (request, bytes) => {
					uploads.push({ request, bytes });
					return {
						kind: "json",
						status: 201,
						body: {
							result: {
								attachment: {
									id: `batt_${uploads.length}`,
									mime: "image/png",
									size: bytes?.byteLength ?? 0,
									width: 1,
									height: 1,
								},
							},
						},
					};
				},
			},
		},
	};
});

const upload = (paths) =>
	uploadStagedImages({
		paths,
		accountId: "acc_1",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: CAP,
	});

/* ------------------------------------------------------------ the kind */

test("a staged value's KIND is decided once, and a malformed one is refused", () => {
	assert.deepEqual(stagedSource(PNG_DATA_URL), {
		kind: "dataUrl",
		dataUrl: PNG_DATA_URL,
		mime: "image/png",
	});
	assert.deepEqual(stagedSource("/tmp/shot.png"), {
		kind: "path",
		path: "/tmp/shot.png",
	});
	// A blank value is not "a path with an odd name": it is nothing this client
	// stages, so it must not reach the filesystem read.
	assert.equal(stagedSource("   "), null);
	// `data:` with no payload separator is not a data URL either.
	assert.equal(stagedSource("data:image/png;base64"), null);
});

/* ---------------------------------------------------------- the decode */

test("a pasted data URL is decoded from its own payload and never read as a file", async () => {
	const result = await upload([PNG_DATA_URL]);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(result.ids, ["batt_1"]);
	assert.deepEqual(
		reads,
		[],
		"the filesystem read must not run for a data URL",
	);
	assert.equal(uploads.length, 1);
	assert.equal(uploads[0].request.op, "team_bridge.attachment.upload");
	assert.equal(
		sha256(uploads[0].bytes),
		sha256(PNG),
		"the hub is handed the picture's own bytes",
	);
});

test("a filesystem path still takes the filesystem read (one prepare path, two sources)", async () => {
	readFileAnswer = {
		success: true,
		data: Buffer.from(PNG).toString("base64"),
	};
	const result = await upload(["/tmp/shot.png"]);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(reads, ["/tmp/shot.png"]);
	assert.equal(sha256(uploads[0].bytes), sha256(PNG));
});

test("three staged data URLs upload in staged order, each its own bytes", async () => {
	/* A third picture with bytes of its own: the 1x1 PNG plus a trailing byte, which
	   keeps the magic this suite sniffs on and makes the digest unmistakable. */
	const third = Buffer.concat([Buffer.from(PNG), Buffer.from([0x00])]);
	const result = await upload([
		PNG_DATA_URL,
		`data:image/png;base64,${Buffer.from(SMALL_PNG).toString("base64")}`,
		`data:image/png;base64,${third.toString("base64")}`,
	]);
	assert.deepEqual(result.failures, []);
	assert.deepEqual(
		result.ids,
		["batt_1", "batt_2", "batt_3"],
		"ids in staged order",
	);
	assert.equal(uploads.length, 3);
	assert.equal(sha256(uploads[0].bytes), sha256(PNG));
	assert.equal(sha256(uploads[1].bytes), sha256(SMALL_PNG));
	assert.equal(sha256(uploads[2].bytes), sha256(third));
	assert.equal(
		new Set(uploads.map((entry) => sha256(entry.bytes))).size,
		3,
		"three distinct pictures, three distinct digests",
	);
});

test("the failure rows of three staged values name each by its own position", async () => {
	const result = await upload([
		`data:image/png;base64,${Buffer.from("one").toString("base64")}`,
		`data:image/png;base64,${Buffer.from("two").toString("base64")}`,
		`data:image/png;base64,${Buffer.from("three").toString("base64")}`,
	]);
	assert.deepEqual(
		result.failures.map((failure) => failure.name),
		[
			"Pasted image · Image 1 of 3",
			"Pasted image · Image 2 of 3",
			"Pasted image · Image 3 of 3",
		],
		"there is no way to tell which image failed unless the row says so",
	);
	assert.deepEqual(
		result.failures.map((failure) => failure.reason),
		["unsupported", "unsupported", "unsupported"],
	);
});

test("a valid picture over the hub's ceiling is a FORMAT refusal, not damage", async () => {
	// R2-1 / QA Q-2: an oversize image is a VALID picture that this hub cannot take,
	// so it keeps the format sentence. Saying "couldn't be read, it may be damaged"
	// about a picture that decoded perfectly is a false statement about its integrity.
	const result = await uploadStagedImages({
		paths: [PNG_DATA_URL],
		accountId: "acc_1",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		// Smaller than the fixture: the prepare step refuses it as `too_large`.
		capability: { ...CAP, max_bytes: 10 },
	});
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].reason, "unsupported");
	assert.equal(result.failures[0].name, "Pasted image");
});

test("a long path's name is truncated to a filename's worth", async () => {
	// D4: whatever a staged path turns out to be, the row is one line tall. This
	// value cannot be read (no such file), so the name is all that is under test.
	const longName = `${"a".repeat(180)}.png`;
	const result = await upload([`/tmp/${longName}`]);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].reason, "read");
	assert.equal(result.failures[0].name.length, 120);
	assert.ok(result.failures[0].name.endsWith("…"), "an ellipsis marks the cut");
	assert.equal(
		result.failures[0].name.includes("a".repeat(120)),
		false,
		"no 120-character run of the original survives",
	);
});

test("a data URL that is not base64 is a FORMAT refusal, not a read failure", async () => {
	// A percent-encoded data URL: a legal `data:` spelling that carries no `;base64`,
	// which nothing in this app writes. It is not a damaged picture, so its sentence
	// must not be the damaged one.
	const percent = "data:image/png,%89PNG%0D%0A%1A%0A";
	const result = await upload([percent]);
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].reason, "unsupported");
	assert.deepEqual(reads, [], "still never a filesystem read");
});

test("a payload that declares base64 and will not decode is a READ failure", async () => {
	const declared = `data:image/png;base64,${Buffer.from("not-base64-@@@").toString("base64")}@@@`;
	const result = await upload([declared]);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].reason, "read");
	assert.equal(BASE64_RUN.test(result.failures[0].name), false);
});

/* ------------------------------------------------------------ the name */

test("a failure row's name never carries the payload", async () => {
	// A data URL whose bytes are NOT a picture this client can prepare: the read
	// succeeds and the prepare step refuses it, which is the "unsupported" arm.
	const notAnImage = `data:image/png;base64,${Buffer.from("not a png at all").toString("base64")}`;
	const result = await upload([notAnImage]);
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures.length, 1);
	const failure = result.failures[0];
	assert.equal(failure.reason, "unsupported");
	assert.equal(failure.name, "Pasted image");
	assert.equal(BASE64_RUN.test(failure.name), false, "no base64 run");
	assert.equal(failure.name.includes("data:"), false, "no data: prefix");
	assert.equal(
		failure.name,
		getFileName(notAnImage),
		"one naming helper; a lone image needs no position",
	);
});

test("a corrupt image still reports a reason from the closed set, echoing nothing", async () => {
	// A truncated payload is not merely short: base64 that decodes to a partial PNG
	// is refused by the prepare step, and the reason stays one the chip has copy
	// for (the page maps `read` to the "may be damaged" sentence) - never a thrown
	// message that could carry bytes.
	const truncated = `${PNG_DATA_URL.slice(0, 40)}@@not-base64@@`;
	const result = await upload([truncated]);
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures.length, 1);
	/* EXACT, not "one of": a payload that declares base64 and will not decode is a
	   source that could not be READ (the "may be damaged" sentence), and drifting
	   that to `unsupported` would tell the operator their picture was the wrong
	   format. */
	assert.equal(result.failures[0].reason, "read");
	assert.equal(
		result.failures[0].name,
		"Pasted image",
		"a neutral name, never the payload",
	);
	assert.equal(BASE64_RUN.test(result.failures[0].name), false);
	assert.equal(result.failures[0].name.includes("data:"), false);
});

test("a blank staged value is refused as unsupported, not read as a file", async () => {
	const result = await upload(["   "]);
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures.length, 1);
	assert.equal(result.failures[0].reason, "unsupported");
	assert.deepEqual(reads, []);
});

test("no attachments capability means nothing is uploaded and nothing is guessed", async () => {
	const result = await uploadStagedImages({
		paths: [PNG_DATA_URL],
		accountId: "acc_1",
		tenantId: "tnt_1",
		conversationId: "bcv_1",
		capability: null,
	});
	assert.equal(result.ids.length, 0);
	assert.equal(result.failures[0].reason, "unsupported");
	assert.equal(BASE64_RUN.test(result.failures[0].name), false);
	assert.deepEqual(uploads, []);
	assert.deepEqual(reads, []);
});
