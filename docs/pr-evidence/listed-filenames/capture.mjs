// Launch -> read -> capture -> reap, one command. Facade of the repo's own driver,
// the same shape as docs/evidence/files-artifacts/capture-files-view.mjs.
import { writeFileSync } from "node:fs";
import { join } from "node:path";
const REPO = process.cwd();
const { rendererDriverApi } = await import(
	join(REPO, "scripts/renderer-driver.mjs")
);
const {
	CdpClient,
	launchApp,
	prepareDriverContext,
	verb,
	capture,
	reapLiveBoots,
} = rendererDriverApi;
// SESSIONS is seed.mjs's output, `<id>:<name>,...`: one launch photographs every
// session in turn (round 1, F4), so the host pays for one app boot, not four.
const [BACKEND, SESSIONS, OUT, LABEL] = process.argv.slice(2);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({
	armed: true,
	logName: `app-${LABEL}.log`,
	tag: LABEL,
});
const report = { label: LABEL, sessions: {} };
let code = 0;
try {
	for (let i = 0; i < 240; i += 1) {
		try {
			if ((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).ok)
				break;
		} catch {}
		await sleep(250);
	}
	const cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	const bridge = async () => {
		for (let i = 0; i < 360; i += 1) {
			if (
				await cdp
					.evaluate("typeof window.__loDevDriver?.verbs === 'function'")
					.catch(() => false)
			)
				return;
			await sleep(250);
		}
	};
	await bridge();
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try { localStorage.setItem("onboarding-storage", JSON.stringify({ state: { isModalComplete: true, isTourComplete: true, currentStep: "create_agent" }, version: 0 })); } catch (e) {}',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await sleep(2500);
	await bridge();
	report.facts = await cdp
		.evaluate(
			"window.__loDevDriver.facts ? window.__loDevDriver.facts() : null",
		)
		.catch(() => null);
	await verb(cdp, "setTheme", "localOperatorDark");
	const until = async (expr, ms = 45_000) => {
		const t0 = Date.now();
		for (;;) {
			const v = await cdp.evaluate(expr).catch(() => null);
			if (v) return v;
			if (Date.now() - t0 > ms) return null;
			await sleep(300);
		}
	};
	const readItems = `(() => { const log = document.querySelector('[role="log"]'); if (!log) return null; return JSON.stringify([...log.querySelectorAll('li')].map((li) => ({ text: li.textContent.trim(), linked: Boolean(li.querySelector('a')), anchor: li.querySelector('a')?.textContent ?? null, href: li.querySelector('a')?.getAttribute('href') ?? null }))); })()`;
	const readLinks = `(() => { const log = document.querySelector('[role="log"]'); if (!log) return null; return [...log.querySelectorAll('a')].map((a) => ({ text: a.textContent.trim(), href: a.getAttribute('href') })); })()`;
	let first = null;
	for (const entry of SESSIONS.split(",")) {
		const [session, name] = entry.split(":");
		first ??= session;
		await verb(cdp, "navigate", `/chat/${session}`);
		const painted = Boolean(
			await until(
				`document.querySelector('[role="log"] li') && location.hash.includes('${session}') ? true : null`,
			),
		);
		/*
		 * A listed name links only after the disk answers, one probe round trip
		 * after paint - so read until the list stops changing (six identical reads
		 * 500 ms apart), rather than trusting one fixed sleep.
		 */
		let last = "";
		let stable = 0;
		for (let i = 0; i < 60 && stable < 6; i += 1) {
			const now = (await cdp.evaluate(readItems).catch(() => "")) ?? "";
			stable = now === last ? stable + 1 : 0;
			last = now;
			await sleep(500);
		}
		await cdp.evaluate(
			`(() => { const li = document.querySelector('[role="log"] li'); if (li) li.scrollIntoView({ block: "center" }); return true; })()`,
		);
		await sleep(600);
		report.sessions[name] = {
			session,
			painted,
			listItems: JSON.parse(last || "null"),
			transcriptLinks: await cdp.evaluate(readLinks),
			transcriptFrame: (await capture(cdp, `transcript-${LABEL}-${name}-dark`))
				.path,
		};
	}
	await verb(cdp, "navigate", `/chat/${first}`);
	await sleep(1500);
	await until(
		`document.querySelector('[data-tour-tag="open-canvas-button"]') ? true : null`,
	);
	if (
		!(await cdp.evaluate(
			`document.querySelector('[data-tour-tag="canvas-dock"]') ? true : false`,
		))
	)
		await cdp.evaluate(
			`document.querySelector('[data-tour-tag="open-canvas-button"]').click(); true`,
		);
	await until(
		`document.querySelector('[data-tour-tag="canvas-container"]') ? true : null`,
	);
	await until(
		`document.querySelector('[data-tour-tag="file-row"]') ? true : null`,
		20_000,
	);
	let last = -1;
	let stable = 0;
	for (let i = 0; i < 60 && stable < 8; i += 1) {
		const n = await cdp.evaluate(
			`document.querySelectorAll('[data-tour-tag="file-row"]').length`,
		);
		stable = n === last ? stable + 1 : 0;
		last = n;
		await sleep(300);
	}
	await sleep(1500);
	report.fileRows = await cdp.evaluate(
		`[...document.querySelectorAll('[data-tour-tag="file-row"]')].map((row) => (row.innerText || '').replace(/\\s+/g, ' ').trim())`,
	);
	report.filesFrame = (await capture(cdp, `files-${LABEL}-dark`)).path;
	writeFileSync(
		join(OUT, `report-${LABEL}.json`),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	console.error(`FAILED: ${error?.stack ?? error}`);
	code = 1;
} finally {
	await reapLiveBoots({ code, why: "capture done" });
}
process.exit(code);
