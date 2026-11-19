import assert from "node:assert/strict";
import { test } from "node:test";
import { runInNewContext } from "node:vm";
import { build } from "esbuild";

const bundle = await build({
	entryPoints: ["src/main/pdf-viewer-status.ts"],
	bundle: true,
	platform: "node",
	format: "esm",
	write: false,
});
const { pdfViewerStatus, PDF_PARSE_STATUS_SCRIPT } = await import(
	`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString("base64")}`
);
const APP = "file:///Applications/Local%20Operator.app/out/renderer/index.html";
const BLOB = "blob:file:///53b6d933-cf85-403b-8748-8fecd8431f90";
const VIEWER = "chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html";
function fixture(result = "ready") {
	const scripts = [];
	const mainFrame = { url: APP, framesInSubtree: [] };
	const pdf = { url: `${BLOB}#toolbar=0`, parent: mainFrame };
	const viewer = {
		url: VIEWER,
		parent: pdf,
		async executeJavaScript(script) {
			scripts.push(script);
			return result;
		},
	};
	mainFrame.framesInSubtree = [mainFrame, pdf, viewer];
	return { contents: { mainFrame }, mainFrame, pdf, viewer, scripts };
}

test("status reads only the exact PDF guest belonging to the asked blob", async () => {
	const f = fixture();
	assert.equal(await pdfViewerStatus(f.contents, BLOB, [APP]), "ready");
	assert.deepEqual(f.scripts, [PDF_PARSE_STATUS_SCRIPT]);
	assert.equal(
		await pdfViewerStatus(f.contents, `${BLOB}-other`, [APP]),
		"loading",
	);
	assert.equal(f.scripts.length, 1);
});

test("foreign URL, app document, extension and untrusted sender cannot select a frame", async () => {
	for (const url of [
		null,
		{},
		APP,
		VIEWER,
		"https://attacker.test/",
		"blob:https://attacker.test/id",
	]) {
		const f = fixture();
		assert.equal(await pdfViewerStatus(f.contents, url, [APP]), "failed");
		assert.equal(f.scripts.length, 0);
	}
	const f = fixture();
	f.mainFrame.url = "https://attacker.test/";
	assert.equal(await pdfViewerStatus(f.contents, BLOB, [APP]), "failed");
	assert.equal(f.scripts.length, 0);
});

test("sibling PDF and nested/untrusted guest ancestors cannot lend their status", async () => {
	for (const modify of [
		(f) => {
			f.viewer.url = `${VIEWER}?lookalike=1`;
		},
		(f) => {
			f.pdf.url = "blob:file:///other-document";
		},
		(f) => {
			f.pdf.parent = { url: APP };
		},
		(f) => {
			f.pdf.parent = { url: "http://localhost:1111/v1/static/html?path=x" };
		},
		(f) => {
			f.viewer.parent = null;
		},
	]) {
		const f = fixture();
		modify(f);
		assert.equal(await pdfViewerStatus(f.contents, BLOB, [APP]), "loading");
		assert.equal(f.scripts.length, 0);
	}
});

test("parse result is enum-only; destroyed and future guest states remain pending", async () => {
	for (const result of [
		"ready",
		"failed",
		"loading",
		null,
		{ script: "evil" },
		"future",
	]) {
		const f = fixture(result);
		assert.equal(
			await pdfViewerStatus(f.contents, BLOB, [APP]),
			["ready", "failed"].includes(result) ? result : "loading",
		);
	}
	const f = fixture();
	f.viewer.executeJavaScript = async () => {
		throw new Error("frame destroyed");
	};
	assert.equal(await pdfViewerStatus(f.contents, BLOB, [APP]), "loading");
});

test("a non-answering guest is bounded to one second", async () => {
	const f = fixture();
	let calls = 0;
	f.viewer.executeJavaScript = () => {
		calls++;
		return new Promise(() => {});
	};
	assert.deepEqual(
		await Promise.all([
			pdfViewerStatus(f.contents, BLOB, [APP]),
			pdfViewerStatus(f.contents, BLOB, [APP]),
		]),
		["loading", "loading"],
	);
	assert.equal(
		calls,
		1,
		"a busy guest gets one evaluation, not a queue of polls",
	);
});

test("fixed parse expression requires actual success and positive page geometry", () => {
	const status = (viewer) =>
		runInNewContext(PDF_PARSE_STATUS_SCRIPT, {
			document: {
				querySelector: (selector) => {
					assert.equal(selector, "pdf-viewer");
					return viewer;
				},
			},
		});
	assert.equal(status(null), "loading");
	assert.equal(status({ loadState_: "failed" }), "failed");
	assert.equal(status({ loadState_: "success" }), "loading");
	assert.equal(
		status({
			loadState_: "success",
			documentDimensions: { pageDimensions: [] },
		}),
		"loading",
	);
	assert.equal(
		status({
			loadState_: "success",
			documentDimensions: { pageDimensions: [{ width: 0, height: 792 }] },
		}),
		"loading",
	);
	assert.equal(
		status({
			loadState_: "success",
			documentDimensions: {
				pageDimensions: [
					{ width: 612, height: 792 },
					{ width: 600, height: 800 },
				],
			},
		}),
		"ready",
	);
});
