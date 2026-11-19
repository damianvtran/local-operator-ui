/* Real app, real file IPC and PDFium. Only the daemon catalogue is synthetic.
 * Run after a build bound to http://127.0.0.1:${PDF_FIXTURE_PORT:-8080}:
 * node scripts/pdf-canvas-proof.mjs --seed-onboarding-complete --out <scratch-dir>
 * Uses the supported driver lifecycle; no browser engine, visible window or
 * operator profile. The unknown PDF in the reported screenshot is NOT a fixture.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
	chmodSync,
	cpSync,
	mkdirSync,
	readFileSync,
	statSync,
	unlinkSync,
	utimesSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import sharp from "sharp";
import { ASK_SESSION_IDS, startAsksAppFixture } from "./asks-app-fixture.mjs";
import { rendererDriverApi as a } from "./renderer-driver.mjs";

for (const name of Object.keys(process.env))
	if (name.startsWith("CMUX_")) Reflect.deleteProperty(process.env, name);
Reflect.deleteProperty(process.env, "XPC_FLAGS");
const fixturePort = Number(process.env.PDF_FIXTURE_PORT ?? 8080);
assert(
	Number.isInteger(fixturePort) && fixturePort > 1024 && fixturePort < 65536,
	"explicit nonprivileged fixture port",
);
const outIndex = process.argv.indexOf("--out");
assert(
	outIndex !== -1 && process.argv[outIndex + 1],
	"explicit --out required",
);
const out = process.argv[outIndex + 1];
mkdirSync(out, { recursive: true });
const source = execFileSync("git", ["rev-parse", "HEAD"], {
	encoding: "utf8",
}).trim();
const runtime = JSON.parse(
	readFileSync("node_modules/electron/package.json", "utf8"),
).version;
const pin = JSON.parse(readFileSync("package.json", "utf8"))
	.optionalDependencies.electron;
assert.equal(
	runtime,
	pin,
	"shared runtime must match this branch's pin before boot",
);

/** Valid xref offsets and independent pages, not a magic-header pseudo-PDF. */
function makePdf(label) {
	const objects = [
		"<< /Type /Catalog /Pages 2 0 R >>",
		"<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
		"",
		"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
		"",
		"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
	];
	for (const [index, page] of [
		[3, "ONE"],
		[5, "TWO"],
	]) {
		const stream = `BT /F1 24 Tf 48 700 Td (${label} - page ${page}) Tj ET`;
		objects[index] =
			`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`;
	}
	let body = "%PDF-1.4\n";
	const offsets = [];
	objects.forEach((object, i) => {
		offsets.push(body.length);
		body += `${i + 1} 0 obj\n${object}\nendobj\n`;
	});
	const xref = body.length;
	body += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((n) => `${String(n).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
	return body;
}
const digest = (path) =>
	createHash("sha256").update(readFileSync(path)).digest("hex");
const identity = Object.fromEntries(
	[
		"src/main/window-guards.ts",
		"src/main/window-guards-electron.ts",
		"src/main/pdf-viewer-status.ts",
		"src/main/index.ts",
		"src/preload/index.ts",
		"src/renderer/src/features/chat/components/canvas/pdf-preview.tsx",
		"src/renderer/src/features/chat/components/canvas/pdf-viewer-poll.ts",
		"src/renderer/src/shared/hooks/use-file-blob-url.ts",
		"out/main/index.js",
		"out/preload/index.js",
		"out/renderer/index.html",
	].map((path) => [path, digest(path)]),
);
const matrix = [];
const record = (surface, actual) => {
	matrix.push({ surface, result: "PASS", actual });
	console.log(`PASS ${surface}: ${JSON.stringify(actual)}`);
};
let fixture;
let cdp;
let main;
let app;
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(predicate, label, timeout = 35_000) {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		const result = await predicate();
		if (result) return result;
		await pause(100);
	}
	throw new Error(`Timed out: ${label}`);
}
async function pdfState() {
	return cdp.evaluate(
		"({status:document.querySelector('[data-pdf-status]')?.dataset.pdfStatus,text:document.querySelector('[data-pdf-status]')?.innerText,src:document.querySelector('iframe')?.src})",
	);
}
async function open(path) {
	const result = await a.verb(cdp, "openCanvasDocument", { path });
	assert.equal(result.encoding, "bytes");
	return result;
}
async function settled(status) {
	return waitFor(async () => {
		const s = await pdfState();
		return s.status === status ? s : null;
	}, `PDF ${status}`);
}
async function capture(label) {
	return a.capture(cdp, label);
}
/** Fixture-only paint latch, not a universal PDF validity heuristic. */
async function painted(label) {
	const readings = [];
	let consecutive = 0;
	await waitFor(
		async () => {
			const frame = await capture(`${label}-${readings.length}`);
			const roi = await cdp.evaluate(
				"(()=>{const r=document.querySelector('iframe').getBoundingClientRect(),d=devicePixelRatio;return {left:Math.round((r.x+12)*d),top:Math.round((r.y+12)*d),width:Math.round((r.width-24)*d),height:Math.round((r.height-24)*d)};})()",
			);
			assert(
				roi.width >= 200 && roi.height >= 200,
				"a meaningful PDF pane, not a narrow sliver",
			);
			const { data, info } = await sharp(frame.path)
				.extract(roi)
				.removeAlpha()
				.raw()
				.toBuffer({ resolveWithObject: true });
			let white = 0;
			for (let i = 0; i < data.length; i += info.channels)
				if (data[i] > 240 && data[i + 1] > 240 && data[i + 2] > 240) white++;
			const ratio = white / (info.width * info.height);
			readings.push({ path: frame.path, roi, nearWhite: ratio });
			consecutive = ratio > 0.65 ? consecutive + 1 : 0;
			return consecutive >= 2;
		},
		`${label}: two consecutive actually painted white fixture pages`,
		10_000,
	);
	return { frames: readings.slice(-2) };
}
async function pressRetry() {
	await a.verb(cdp, "press", { selector: "[data-pdf-status] button" });
}
async function nativeStatus() {
	return main.evaluate(
		`(async()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));return Promise.all(w.mainFrame.framesInSubtree.filter(f=>f.url==='chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html').map(f=>f.executeJavaScript("(()=>{const v=document.querySelector('pdf-viewer');return {state:v?.loadState_,pages:v?.documentDimensions?.pageDimensions?.length,page:v?.viewport?.getMostVisiblePage?.()};})()")));})()`,
	);
}
let exit = 0;
try {
	fixture = await startAsksAppFixture({
		root: join(out, "fixture"),
		port: fixturePort,
		token: "synthetic-pdf-proof-token",
	});
	process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = "synthetic-pdf-proof-token";
	const ctx = a.prepareDriverContext({ apiUrl: fixture.url });
	cpSync(fixture.records, join(ctx.config, "run", "serve"), {
		recursive: true,
	});
	app = await a.launchApp({ armed: true });
	await a.waitForDevtools(app);
	cdp = await a.CdpClient.attach(app.port, "/out/renderer/index.html");
	await a.waitForPage(cdp);
	await a.waitForBridge(cdp);
	main = await a.CdpClient.attachNode(app.inspectPort);
	// Count the real filesystem reads, not status/probe calls or watcher refreshes.
	await main.evaluate(
		`(()=>{const fs=process.mainModule?.require('node:fs')??globalThis.require('node:fs');const original=fs.readFileSync;globalThis.pdfReadCounts={};fs.readFileSync=function(path,...args){if(typeof path==='string'&&path.startsWith(${JSON.stringify(ctx.scratch)})&&path.endsWith('.pdf'))globalThis.pdfReadCounts[path]=(globalThis.pdfReadCounts[path]??0)+1;return Reflect.apply(original,this,[path,...args]);};return true;})()`,
	);
	await cdp.evaluate(
		"(()=>{globalThis.pdfBlobUrls=[];const original=URL.createObjectURL;URL.createObjectURL=function(blob){const url=Reflect.apply(original,this,[blob]);globalThis.pdfBlobUrls.push(url);return url;};return true;})()",
	);
	const hello = await a.verb(cdp, "hello");
	assert(hello.userAgent.includes(`Electron/${pin}`));
	assert.equal(hello.apiBaseUrl, fixture.url);
	record("source/runtime", {
		source,
		pin,
		userAgent: hello.userAgent,
		appLog: app.logPath,
	});
	await a.verb(cdp, "navigate", `/chat/${ASK_SESSION_IDS[0]}`);
	await pause(500);
	const generated = join(ctx.scratch, "generated résumé two pages.pdf");
	const attached = join(ctx.scratch, "attached 合成 report.pdf");
	writeFileSync(generated, makePdf("Generated PDF"));
	writeFileSync(attached, makePdf("Synthetic attachment"));
	await open(generated);
	await settled("ready");
	const parsed = await nativeStatus();
	assert(parsed.some((s) => s.state === "success" && s.pages === 2));
	const firstPaint = await painted("pdf-generated-ready");
	record("generated + spaces/non-ASCII: first page painted, two pages parsed", {
		parsed,
		...firstPaint,
	});
	const box = await cdp.evaluate(
		"(()=>{const r=document.querySelector('iframe').getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};})()",
	);
	for (
		let wheel = 0;
		wheel < 10 && !(await nativeStatus()).some((status) => status.page === 1);
		wheel++
	) {
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseWheel",
			...box,
			deltaX: 0,
			deltaY: 640,
			button: "none",
			buttons: 0,
		});
		await pause(400);
	}
	await waitFor(
		async () => (await nativeStatus()).some((status) => status.page === 1),
		"second page after real wheel over visible guest",
	);
	const secondPaint = await painted("pdf-second-page");
	record("page TWO after real wheel, two painted frames", {
		native: await nativeStatus(),
		...secondPaint,
	});
	await open(attached);
	await settled("ready");
	record("synthetic materialized attachment painted (not upload)", {
		native: await nativeStatus(),
		...(await painted("pdf-attached-ready")),
	});
	await open(generated);
	await settled("ready");
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));e.BrowserWindow.fromWebContents(w).setSize(1220,820);return true;})()`,
	);
	await waitFor(
		() => cdp.evaluate("innerWidth===1220"),
		"native resize to meaningful narrow window",
	);
	await settled("ready");
	record(
		"switch/reopen/native resize 1220x820 painted",
		await painted("pdf-resized"),
	);
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));e.BrowserWindow.fromWebContents(w).setSize(1380,900);return true;})()`,
	);
	await waitFor(
		() => cdp.evaluate("innerWidth===1380"),
		"restore native viewport",
	);
	// The file is real at the probe/open boundary, then disappears before retry.
	const missing = join(ctx.scratch, "missing after open.pdf");
	writeFileSync(missing, makePdf("Missing"));
	await open(missing);
	await settled("ready");
	await open(generated);
	await settled("ready");
	unlinkSync(missing);
	await a.verb(cdp, "press", {
		selector: `[role="tab"][title=${JSON.stringify(missing)}]`,
	});
	const missingState = await settled("unavailable");
	assert(missingState.text.includes("File no longer exists"));
	record("missing file reopened from real tab", missingState);
	await capture("pdf-missing-error");
	const missingRead = await cdp.evaluate(
		`window.api.readFileBytes(${JSON.stringify(missing)})`,
	);
	assert.equal(missingRead.success, false);
	assert.equal(missingRead.code, "not-found");
	record("missing byte access", missingRead);
	const denied = join(ctx.scratch, "denied.pdf");
	writeFileSync(denied, makePdf("Read permission retry"));
	chmodSync(denied, 0o000);
	try {
		await open(denied);
		const deniedState = await settled("unavailable");
		assert(deniedState.text.includes("This PDF could not be opened"));
		assert(
			!deniedState.text.includes("EACCES"),
			"permission errors use path-only detail, not Node diagnostics",
		);
		record("denied file read and recovery actions", deniedState);
		await capture("pdf-denied-error");
	} finally {
		chmodSync(denied, 0o600);
	}
	await pressRetry();
	await settled("ready");
	record("transient read denial retry recovers", await pdfState());
	const invalid = join(ctx.scratch, "invalid.pdf");
	const repaired = makePdf("Repaired PDF");
	// Keep BOTH metadata fields fixed: the freshness watcher must not rescue Retry.
	const fixedTime = new Date("2025-10-09T08:53:20Z");
	writeFileSync(
		invalid,
		"%PDF-1.4\nnot a PDF body\n%%EOF".padEnd(repaired.length, " "),
	);
	utimesSync(invalid, fixedTime, fixedTime);
	await open(invalid);
	const invalidState = await settled("failed");
	assert(invalidState.text.includes("This PDF could not be opened"));
	assert(invalidState.text.includes("Retry"));
	record("malformed parse + retry/OS fallback", invalidState);
	await capture("pdf-invalid-error");
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));e.BrowserWindow.fromWebContents(w).setSize(1220,820);return true;})()`,
	);
	await waitFor(() => cdp.evaluate("innerWidth===1220"), "narrow error state");
	const controls = await cdp.evaluate(
		"(()=>{const p=document.querySelector('[data-pdf-status]'),r=p.getBoundingClientRect();return [...p.querySelectorAll('button')].map(b=>{const q=b.getBoundingClientRect();return {text:b.innerText,inside:q.left>=r.left&&q.right<=r.right&&q.top>=r.top&&q.bottom<=r.bottom};});})()",
	);
	assert.equal(controls.length, 2);
	assert(controls.every((control) => control.inside));
	record("narrow error recovery controls stay inside pane", controls);
	await capture("pdf-invalid-error-narrow");
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));e.BrowserWindow.fromWebContents(w).setSize(1380,900);return true;})()`,
	);
	await waitFor(
		() => cdp.evaluate("innerWidth===1380"),
		"restore error viewport",
	);
	const readsBefore = await main.evaluate(
		`globalThis.pdfReadCounts[${JSON.stringify(invalid)}] ?? 0`,
	);
	const blobsBefore = await cdp.evaluate("globalThis.pdfBlobUrls.slice()");
	const metadataBefore = statSync(invalid);
	writeFileSync(invalid, repaired);
	utimesSync(invalid, fixedTime, fixedTime);
	assert.equal(statSync(invalid).mtimeMs, metadataBefore.mtimeMs);
	assert.equal(statSync(invalid).size, metadataBefore.size);
	await pressRetry();
	await settled("ready");
	const readsAfter = await main.evaluate(
		`globalThis.pdfReadCounts[${JSON.stringify(invalid)}] ?? 0`,
	);
	const fresh = await pdfState();
	assert.equal(
		readsAfter,
		readsBefore + 1,
		"Retry alone causes a new actual filesystem read",
	);
	assert(
		!blobsBefore.includes(fresh.src.split("#")[0]),
		"Retry publishes fresh blob identity",
	);
	record("Retry fresh read/blob with fixed mtime and size", {
		readsBefore,
		readsAfter,
		mtimeMs: metadataBefore.mtimeMs,
		size: metadataBefore.size,
		...(await painted("pdf-retry-ready")),
	});
	// Reproduce the original guard failure as a native navigation fault, without
	// replacing byte reads, the status handler, React or the app's authorization.
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));globalThis.pdfBlock=(event)=>{if(event.url.startsWith('chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/'))event.preventDefault();};w.on('will-frame-navigate',globalThis.pdfBlock);return true;})()`,
	);
	const blocked = join(ctx.scratch, "blocked initialization.pdf");
	writeFileSync(blocked, makePdf("Blocked initialization"));
	await open(blocked);
	await settled("loading");
	await capture("pdf-loading");
	const blockedState = await settled("failed");
	assert(blockedState.text.includes("Retry"));
	record("blocked guest initialization times out with recovery", blockedState);
	await capture("pdf-initialization-error");
	await main.evaluate(
		`(()=>{const e=process.mainModule?.require('electron')??globalThis.require('electron');const w=e.webContents.getAllWebContents().find(w=>w.getURL().includes('/out/renderer/index.html'));w.off('will-frame-navigate',globalThis.pdfBlock);return true;})()`,
	);
	await pressRetry();
	await settled("ready");
	record("initialization retry recovers", await nativeStatus());
	// On a real supported app document, asking for an arbitrary URL is refused.
	for (const url of [
		"https://attacker.test/",
		"blob:https://attacker.test/x",
		"chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/index.html",
	])
		assert.equal(
			await cdp.evaluate(`window.api.pdfViewerStatus(${JSON.stringify(url)})`),
			"failed",
		);
	record("status rejects foreign URL/extension selection", true);
	const target =
		"chrome-extension://mhjfbmdgcfjbbpaeojofohoefgiehjai/53b6d933-cf85-403b-8748-8fecd8431f90";
	await cdp.evaluate(
		`(()=>{const f=document.createElement('iframe');f.dataset.pdfAttack='direct';f.src=${JSON.stringify(target)};document.body.append(f);return true;})()`,
	);
	await pause(400);
	app.flush();
	let log = readFileSync(app.logPath, "utf8");
	assert(log.includes(`blocked child-frame navigation to ${target}`));
	await cdp.evaluate("document.querySelector('[data-pdf-attack]').remove()");
	record("direct extension iframe cannot forge internal provenance", true);
	const blockedBeforeBlob =
		log.split(`blocked child-frame navigation to ${target}`).length - 1;
	// Same-origin blob HTML still cannot lend the internal extension's provenance.
	await cdp.evaluate(
		`(()=>{const f=document.createElement('iframe');f.dataset.pdfAttack='blob';f.src=URL.createObjectURL(new Blob([${JSON.stringify(`<iframe src="${target}"></iframe>`)}],{type:'text/html'}));document.body.append(f);return true;})()`,
	);
	await pause(400);
	app.flush();
	log = readFileSync(app.logPath, "utf8");
	assert.equal(
		log.split(`blocked child-frame navigation to ${target}`).length - 1,
		blockedBeforeBlob + 1,
	);
	await cdp.evaluate(
		"(()=>{const f=document.querySelector('[data-pdf-attack]');URL.revokeObjectURL(f.src);f.remove();return true;})()",
	);
	record("unrelated blob HTML cannot forge internal provenance", true);
	writeFileSync(
		join(out, "matrix.json"),
		JSON.stringify(
			{
				source,
				pin,
				identity,
				matrix,
				console: cdp.console,
				fixture: "owned synthetic catalogue; production file IPC and PDFium",
				limitations:
					"Unknown reported PDF unavailable; synthetic materialized attachment does not exercise upload. Native-window resize and independent QA are separate.",
			},
			null,
			2,
		),
	);
} catch (error) {
	exit = 1;
	console.error(error.stack);
	writeFileSync(
		join(out, "matrix.json"),
		JSON.stringify({ source, pin, matrix, error: String(error) }, null, 2),
	);
} finally {
	if (app) {
		app.flush();
		cpSync(app.logPath, join(out, "app.log"));
	}
	cdp?.close();
	main?.close();
	await fixture?.close();
	await a.reapLiveBoots({ code: exit, why: "PDF proof complete" });
}
