// ROUND 2 (review R2-1): the A -> files written -> B flow, photographed live.
//
// A = "I'll write the deliverables to <dir>/:" + two bare names, seeded BEFORE
// the files exist. The first capture shows both names as plain text (the probe
// answered missing). The rig then WRITES the files, appends B to the SAME
// session, and captures again: both names must be anchors in BOTH messages.
// At the round-1 head the negative A cached was read by B forever, so the
// second frame showed four plain names; that is the regression this pins.
//
// Launch -> read -> capture -> write -> append -> capture -> reap, ONE command.
// Facade of the repo's own driver, same shape as capture.mjs: isolated daemon,
// headless app, no operator session, no visible window.
import {
	appendFileSync,
	mkdirSync,
	readFileSync,
	writeFileSync,
} from "node:fs";
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
// argv: <backend> <configDir> <fixtureDir> <sessionId> <outDir> <label>
const [BACKEND, CONFIG, DIR, SESSION, OUT, LABEL] = process.argv.slice(2);
const PDF = "report.pdf";
const XLSX = "data.xlsx";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
prepareDriverContext({ apiUrl: BACKEND });
const handle = await launchApp({
	armed: true,
	logName: `app-${LABEL}.log`,
	tag: LABEL,
});
const report = { label: LABEL, session: SESSION };
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
	await verb(cdp, "setTheme", "localOperatorDark");
	await verb(cdp, "navigate", `/chat/${SESSION}`);
	const until = async (expr, ms = 20_000) => {
		const t0 = Date.now();
		for (;;) {
			const v = await cdp.evaluate(expr).catch(() => null);
			if (v) return v;
			if (Date.now() - t0 > ms) return null;
			await sleep(300);
		}
	};
	await until(`document.querySelector('[role="log"] li') ? true : null`);
	// Per message: the listed names, and whether each is an anchor.
	const readMessages = `(() => { const log = document.querySelector('[role="log"]'); if (!log) return null; return JSON.stringify([...log.querySelectorAll('li')].map((li) => ({ text: li.textContent.trim().slice(0, 60), anchor: li.querySelector('a')?.textContent ?? null }))); })()`;
	const settle = async () => {
		let last = "";
		let stable = 0;
		for (let i = 0; i < 60 && stable < 6; i += 1) {
			const now = (await cdp.evaluate(readMessages).catch(() => "")) ?? "";
			stable = now === last ? stable + 1 : 0;
			last = now;
			await sleep(500);
		}
		return JSON.parse(last || "null");
	};
	await cdp.evaluate(
		`(() => { const li = document.querySelector('[role="log"] li'); if (li) li.scrollIntoView({ block: "center" }); return true; })()`,
	);
	await sleep(600);
	report.before = await settle();
	report.beforeFrame = (await capture(cdp, `r2-before-${LABEL}`)).path;

	// THE TOOL RUNS: the two files A named are written now, not before.
	mkdirSync(DIR, { recursive: true });
	writeFileSync(join(DIR, PDF), "%PDF-1.4\n%%EOF\n");
	writeFileSync(join(DIR, XLSX), "PK [redacted] xlsx placeholder");

	// B arrives in the same session, naming the same paths.
	const row = {
		id: "r2b00000000000000000000000000000001",
		ts: Date.now() / 1000,
		type: "message",
		payload: {
			kind: "message",
			role: "assistant",
			content: [
				{ text: `Done. Files are in \`${DIR}/\`:\n- ${PDF}\n- ${XLSX}` },
			],
		},
	};
	appendFileSync(
		join(CONFIG, "sessions", SESSION, "transcript.jsonl"),
		`${JSON.stringify(row)}\n`,
	);
	// Re-enter the route so the store re-reads the appended transcript. The
	// driver's navigate is a no-op when the hash already names this session, so
	// the detour through a draft is what forces the re-read.
	await verb(cdp, "navigate", "/");
	await sleep(1500);
	await verb(cdp, "navigate", `/chat/${SESSION}`);
	await until(
		`document.querySelectorAll('[role="log"] li').length >= 4 ? true : null`,
	);
	await sleep(2000);
	report.after = await settle();
	await cdp.evaluate(
		`(() => { const lis = document.querySelectorAll('[role="log"] li'); const li = lis[lis.length - 1]; if (li) li.scrollIntoView({ block: "center" }); return true; })()`,
	);
	await sleep(600);
	report.afterFrame = (await capture(cdp, `r2-after-${LABEL}`)).path;
	writeFileSync(
		join(OUT, `report-${LABEL}.json`),
		JSON.stringify(report, null, 2),
	);
	console.log(JSON.stringify(report, null, 2));
} catch (error) {
	console.error(`FAILED: ${error?.stack ?? error}`);
	code = 1;
} finally {
	await reapLiveBoots({ code, why: "r2 capture done" });
}
process.exit(code);
