/** Cold5002-row UI path through the real app, not a reconstructed file view. */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { rendererDriverApi } from "../../../../scripts/renderer-driver.mjs";
const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	verb,
	capture,
	reapLiveBoots,
} = rendererDriverApi;
const arg = (name) => {
	const i = process.argv.indexOf(name);
	return i < 0 ? null : process.argv[i + 1];
};
const backend = arg("--backend");
const out = arg("--out");
const label = arg("--label");
const theme = arg("--theme") ?? "localOperatorLight";
if (!backend || !out || !label || !process.env.LOCAL_OPERATOR_DESKTOP_TOKEN)
	throw new Error("Missing owned backend/output/label/token binding");
mkdirSync(out, { recursive: true });
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
prepareDriverContext({ apiUrl: backend });
const boot = await launchApp({
	armed: true,
	logName: `app-${label}.log`,
	tag: label,
});
let code = 0;
const report = { label, theme, samples: [], frames: {} };
try {
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(`http://127.0.0.1:${boot.port}/json/version`)).ok) break;
		} catch {}
		await sleep(250);
	}
	const cdp = await CdpClient.attach(boot.port, "out/renderer/index.html");
	const until = async (expression, ms = 45000) => {
		const deadline = Date.now() + ms;
		while (Date.now() < deadline) {
			if (await cdp.evaluate(expression).catch(() => false)) return;
			await sleep(100);
		}
		throw new Error(`Timed out observing ${expression}`);
	};
	await until("typeof window.__loDevDriver?.verbs === 'function'");
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}));',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(1500);
	await until("typeof window.__loDevDriver?.verbs === 'function'");
	await verb(cdp, "setTheme", theme);
	await verb(cdp, "navigate", "/chat/new");
	await sleep(300);
	report.facts = await cdp.evaluate("window.__loDevDriver.facts()");
	if (report.facts.visible || report.facts.focused)
		throw new Error("App must remain headless/unfocused");
	await fetch(`${backend}/__cold_reset`);
	const start = Date.now();
	await verb(cdp, "navigate", "/chat/b1f1de000001");
	await until(
		"Boolean(document.querySelector('[data-tour-tag=\"open-canvas-button\"]'))",
	);
	await cdp.evaluate(
		"document.querySelector('[data-tour-tag=\"open-canvas-button\"]').click()",
	);
	await until(
		"Boolean(document.querySelector('button[aria-label^=\"Files\"][aria-pressed]'))",
	);
	await cdp.evaluate(
		"document.querySelector('button[aria-label^=\"Files\"][aria-pressed]').click()",
	);
	let settled = 0;
	for (let sample = 0; sample < 120; sample++) {
		const snapshot = await cdp.evaluate(
			`(()=>{const s=document.querySelector('[data-tour-tag="files-scroller"]');const head=document.querySelector('[data-tour-tag="files-scanner-head"]');const rows=[...document.querySelectorAll('[data-tour-tag="file-row"]')];const h=head?.innerText??'';const body=s?.innerText??'';return {rows:rows.length,first:rows[0]?.getAttribute('data-file-id')??null,headers:[...s?.querySelectorAll('h3')??[]].map(n=>n.innerText),head:h,body,loading:/Loading session files|Building the file index/.test(h+' '+body),width:s?.getBoundingClientRect().width,headWidth:head?.clientWidth,headScrollWidth:head?.scrollWidth,imgs:s?.querySelectorAll('img').length??0};})()`,
		);
		snapshot.elapsed = Date.now() - start;
		snapshot.resources = await verb(cdp, "filesFacts");
		report.samples.push(snapshot);
		if (sample === 0)
			report.frames.first = (await capture(cdp, `${label}-first`)).path;
		if (!report.frames.progress && snapshot.elapsed > 1500 && snapshot.loading)
			report.frames.progress = (await capture(cdp, `${label}-progress`)).path;
		settled = !snapshot.loading && snapshot.rows > 0 ? settled + 1 : 0;
		if (settled >= 8) break;
		await sleep(250);
	}
	const final = report.samples.at(-1);
	if (final.loading || !final.rows)
		throw new Error("Cold generation never became complete content");
	report.frames.final = (await capture(cdp, `${label}-final`)).path;
	report.requests = await (await fetch(`${backend}/__cold_stats`)).json();
	report.loadingSamples = report.samples.filter((s) => s.loading);
	report.firstContent = report.samples.find((s) => s.rows > 0);
	report.distinctFirst = [
		...new Set(report.samples.filter((s) => s.rows > 0).map((s) => s.first)),
	];
	report.finalReads = final.resources.reads;
	report.loadingMaxReads = Math.max(
		0,
		...report.loadingSamples.map((s) => s.resources.reads),
	);
	if (!process.argv.includes("--expect-old")) {
		if (!report.loadingSamples.length)
			throw new Error("No controlled delayed loading observed");
		if (
			report.loadingSamples.some((s) => s.rows || s.imgs || s.resources.reads)
		)
			throw new Error(
				"Incomplete generation triggered content or thumbnail reads",
			);
		if (report.distinctFirst.length !== 1)
			throw new Error("First content row changed after publication");
		if (!report.firstContent.headers.some((s) => s.startsWith("Highlights")))
			throw new Error("Highlights absent from first content paint");
		if (report.finalReads > 14 || final.resources.peakActive > 4)
			throw new Error(
				"Cold complete-generation thumbnail working set exceeded bound",
			);
	}
	if (process.argv.includes("--sort-control")) {
		const key = async () => {
			for (const type of ["keyDown", "keyUp"])
				await cdp.send("Input.dispatchKeyEvent", { type, key: "Enter" });
		};
		await cdp.evaluate(
			"document.querySelector('button[aria-label^=Sort]').focus()",
		);
		await key();
		await until("Boolean(document.querySelector('[role=menuitemcheckbox]'))");
		await cdp.evaluate(
			"[...document.querySelectorAll('[role=menuitemcheckbox]')].find(n=>n.textContent.trim()==='Size').focus()",
		);
		await key();
		await cdp.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: report.facts.windowSize.width - 150,
			y: 230,
		});
		const rows = [];
		for (let i = 0; i < 10; i++) {
			await sleep(100);
			rows.push(
				await cdp.evaluate(
					"document.querySelectorAll('[data-tour-tag=file-row]').length",
				),
			);
		}
		report.sortControl = {
			rows,
			beforePages: report.requests.pages,
			afterPages: (await (await fetch(`${backend}/__cold_stats`)).json()).pages,
		};
		if (
			rows.some((n) => !n) ||
			report.sortControl.afterPages !== report.sortControl.beforePages
		)
			throw new Error("Client sort reset membership or repaginated");
	}
	writeFileSync(join(out, "report.json"), JSON.stringify(report, null, 2));
	console.log(
		JSON.stringify({
			label,
			width: final.width,
			pages: report.requests.pages,
			loadingSamples: report.loadingSamples.length,
			distinctFirst: report.distinctFirst.length,
			loadingMaxReads: report.loadingMaxReads,
			finalReads: report.finalReads,
			peak: final.resources.peakActive,
			firstHeaders: report.firstContent.headers,
		}),
	);
} catch (error) {
	code = 1;
	console.error(error.stack ?? error);
} finally {
	await reapLiveBoots({ code, why: "cold-generation evidence complete" });
}
