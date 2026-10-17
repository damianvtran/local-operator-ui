// UX2 walkthrough for PR #1099 @ be259 — one boot per invocation.
// usage (cwd = ux2 worktree): node ux2-walk.mjs --mode <old|fixed|unknown> --out <dir> --window-size WxH --theme <name> --version <v>
// Reuses the driver's exported facade (launchApp/CdpClient/verb/capture/reapLiveBoots) and the committed stub daemon.
import { execFileSync, spawn } from "node:child_process";
import {
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	symlinkSync,
	writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

const arg = (n, d = null) => {
	const i = process.argv.indexOf(n);
	return i === -1 ? d : (process.argv[i + 1] ?? d);
};
const MODE = arg("--mode");
const OUT = arg("--out");
const VERSION = arg("--version");
const THEME = arg("--theme", "localOperatorDark");
const SIZE = arg("--window-size", "1380x900");
const ROOT = process.cwd();
process.env.LOCAL_OPERATOR_DESKTOP_TOKEN = "synthetic-ux2-token";
for (const k of Object.keys(process.env))
	if (k.startsWith("CMUX_") || k === "XPC_FLAGS") delete process.env[k];

const mod = await import(
	pathToFileURL(join(ROOT, "scripts/renderer-driver.mjs")).href
);
const { CdpClient, launchApp, verb, capture, reapLiveBoots } =
	mod.rendererDriverApi;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const results = [];
let fails = 0;
const log = (k, v) => {
	const s = typeof v === "string" ? v : JSON.stringify(v);
	console.log(`[${k}] ${s}`);
	results.push({ k, v });
};
const check = (name, ok, detail = "") => {
	if (!ok) fails++;
	console.log(
		`[${ok ? "PASS" : "FAIL"}] ${name}${detail ? " :: " + (typeof detail === "string" ? detail : JSON.stringify(detail)) : ""}`,
	);
	results.push({ name, ok, detail });
};

mkdirSync(OUT, { recursive: true });
const rec = join(OUT, "records");
mkdirSync(rec, { recursive: true });
// --- stub daemon (own process group, exact-pid reap)
const stub = spawn(
	"node",
	[
		"docs/evidence/hub-links/harness/stub-daemon.mjs",
		"--port",
		"8127",
		"--records",
		rec,
		"--core-version",
		VERSION,
	],
	{
		cwd: ROOT,
		stdio: ["ignore", "pipe", "pipe"],
		detached: true,
		env: process.env,
	},
);
let stubLog = "";
stub.stdout.on("data", (d) => (stubLog += d));
stub.stderr.on("data", (d) => (stubLog += d));
const stubReq = () =>
	stubLog
		.split("\n")
		.filter((l) => /PATCH|POST \/v1\/desktop\/hub|hub\/updates/.test(l));
let stopped = false;
async function stopStub() {
	if (stopped) return;
	stopped = true;
	try {
		process.kill(-stub.pid, "SIGTERM");
	} catch {}
	await wait(400);
	if (stub.exitCode === null) {
		try {
			process.kill(-stub.pid, "SIGKILL");
		} catch {}
	}
}
for (const sig of ["SIGTERM", "SIGINT"])
	process.once(sig, async () => {
		await stopStub();
		await reapLiveBoots({ code: 143, why: "r3 bounded abort" });
		process.exit(143);
	});

const healthy = async () => {
	for (let i = 0; i < 60; i++) {
		try {
			const r = await fetch("http://127.0.0.1:8127/health");
			if (r.ok) return await r.json();
		} catch {}
		await wait(200);
	}
	throw new Error("stub never healthy");
};

let cdp = null;
try {
	const health = await healthy();
	check(
		"stub reports the requested core version",
		health.result.version === VERSION,
		health.result.version,
	);
	// --- per-run context: CSP narrowing (build output only) + serve record link
	const ctx = mod.prepareDriverContext({ apiUrl: "http://127.0.0.1:8127" });
	// Candidate CSP is constrained ONCE before asset pinning; no per-boot HTML mutation.
	const serve = join(ctx.config, "run", "serve");
	mkdirSync(serve, { recursive: true });
	for (const e of readdirSync(rec))
		if (e.endsWith(".json")) symlinkSync(join(rec, e), join(serve, e));

	const handle = await launchApp({
		armed: true,
		logName: "ux2-app.log",
		tag: "ux2",
	});
	globalThis.__r3AppPid = handle.pid;
	log("app", { pid: handle.pid, port: handle.port, size: SIZE });
	// wait devtools
	for (let i = 0; i < 240; i++) {
		try {
			if ((await fetch(`http://127.0.0.1:${handle.port}/json/version`)).ok)
				break;
		} catch {}
		await wait(250);
	}
	cdp = await CdpClient.attach(handle.port, "out/renderer/index.html");
	for (let i = 0; i < 360; i++) {
		const v = await cdp
			.evaluate(
				"typeof window.__loDevDriver?.verbs==='function'?window.__loDevDriver.verbs():null",
			)
			.catch(() => null);
		if (Array.isArray(v) && v.includes("hello")) break;
		await wait(250);
	}
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			"window.__r3Csp=[];addEventListener('securitypolicyviolation',e=>window.__r3Csp.push({directive:e.effectiveDirective,uri:e.blockedURI}))",
	});
	await cdp.send("Page.addScriptToEvaluateOnNewDocument", {
		source:
			'try{localStorage.setItem("onboarding-storage",JSON.stringify({state:{isModalComplete:true,isTourComplete:true,currentStep:"create_agent"},version:0}))}catch(e){}',
	});
	await cdp.send("Page.reload", { ignoreCache: false });
	await wait(2500);
	await cdp
		.send("Emulation.setFocusEmulationEnabled", { enabled: true })
		.catch(() => {});
	const E = (x) => cdp.evaluate(x);
	const waitFor = async (expr, ms = 20000) => {
		const s = Date.now();
		for (;;) {
			const v = await E(expr).catch(() => null);
			if (v) return v;
			if (Date.now() - s > ms) return null;
			await wait(60);
		}
	};
	const key = async (k, { shift = false } = {}) => {
		const map = {
			Tab: [9, "Tab", ""],
			" ": [32, "Space", " "],
			Enter: [13, "Enter", "\r"],
			Escape: [27, "Escape", ""],
		};
		const [vk, code, text] = map[k];
		const modifiers = shift ? 8 : 0;
		await cdp.send("Input.dispatchKeyEvent", {
			type: text ? "keyDown" : "rawKeyDown",
			key: k,
			code,
			windowsVirtualKeyCode: vk,
			text,
			modifiers,
		});
		await cdp.send("Input.dispatchKeyEvent", {
			type: "keyUp",
			key: k,
			code,
			windowsVirtualKeyCode: vk,
			modifiers,
		});
		await wait(180);
	};
	const active = () =>
		E(
			`(()=>{const a=document.activeElement;if(!a)return null;return {tag:a.tagName,role:a.getAttribute('role'),label:a.getAttribute('aria-label')||(a.textContent||'').trim().slice(0,40),disabled:a.disabled===true,state:a.getAttribute('data-state')}})()`,
		);
	const snap = (name) => capture(cdp, `${name}`);
	await verb(cdp, "setTheme", THEME);
	await verb(cdp, "navigate", "/agents?name=reviewer");
	const exp = '[data-agents-pane] button[aria-expanded="false"]';
	check(
		"linked profile is browsable (expander present)",
		!!(await waitFor(`!!document.querySelector('${exp}')`, 30000)),
	);
	await verb(cdp, "press", exp);
	const row = '[data-hub-link="link-public-agent"]';
	await waitFor(
		`document.querySelector('${row} button[role="switch"]')`,
		30000,
	);
	await wait(800);
	await probe({
		E,
		waitFor,
		key,
		active,
		snap,
		row,
		wait,
		log,
		check,
		verb,
		cdp,
		stubReq: () => stubLog.split("\n").filter((l) => /PATCH/.test(l)),
		stopStub,
	});
} catch (e) {
	console.log("[FAIL] run threw: " + (e?.stack ?? e));
	fails++;
} finally {
	try {
		cdp?.close();
	} catch {}
	await stopStub();
	writeFileSync(
		join(OUT, `probe-${MODE}-results.json`),
		JSON.stringify({ MODE, VERSION, SIZE, fails, results }, null, 2),
	);
	writeFileSync(join(OUT, `probe-${MODE}-stub.log`), stubLog);
	await reapLiveBoots({ code: fails ? 1 : 0, why: "r3 candidate probe done" });
	process.exitCode = fails ? 1 : 0;
}

async function probe({
	E,
	waitFor,
	key,
	active,
	snap,
	row,
	wait,
	log,
	check,
	cdp,
	stubReq,
	stopStub,
}) {
	const facts = await E("window.__loDevDriver.facts()");
	check(
		"headless never shown/focused",
		facts.windowMode === "headless" &&
			facts.visible === false &&
			facts.focused === false,
		facts,
	);
	const switches = `${row} button[role=switch]`;
	const state = async (i) =>
		E(
			`document.querySelectorAll('${switches}')[${i}].getAttribute('data-state')`,
		);
	const focus = async (i) =>
		E(`document.querySelectorAll('${switches}')[${i}].focus()`);
	const hold = async (selector, label) => {
		const result = await E(
			`new Promise(resolve=>{const e=document.querySelector(${JSON.stringify(selector)}),t=performance.now();let lost=null,n=0;const timer=setInterval(()=>{n++;if(document.activeElement!==e&&lost===null)lost=Math.round(performance.now()-t);if(performance.now()-t>=11500){clearInterval(timer);resolve({samples:n,firstLostAtMs:lost,disabled:e.disabled,active:document.activeElement===e})}},25)})`,
		);
		log(label, result);
		check(
			label + " held 11.5s across polls",
			result.firstLostAtMs === null && result.active && !result.disabled,
			result,
		);
	};
	const dialogOpen = () =>
		waitFor(`!!document.querySelector('[role=dialog]')`, 4000);
	if (MODE === "fixed" || MODE === "fixed-short") {
		if (MODE === "fixed") {
			await focus(0);
			await hold(`${switches}:first-of-type`, "subscribe focus");
			await snap("r3-fixed-switch-held");
			await key(" ");
			check(
				"Subscribe Space reaches confirmed OFF",
				!!(await waitFor(
					`document.querySelectorAll('${switches}')[0].getAttribute('data-state')==='unchecked'`,
					4000,
				)),
			);
		}
		await focus(1);
		await key(" ");
		check("Auto-push opens consent", !!(await dialogOpen()));
		await key("Tab");
		check(
			"Enable has keyboard focus",
			/Enable auto-push/.test((await active())?.label ?? ""),
			await active(),
		);
		const target = await E(
			`(()=>{const b=[...document.querySelectorAll('[role=dialog] button')].find(e=>/Enable auto-push/.test(e.textContent));b.dataset.r3Enable='true';return !!b})()`,
		);
		check("actual primary located", target);
		if (MODE === "fixed") {
			await hold("[data-r3-enable]", "consent Enable focus");
			await snap("r3-fixed-dialog-held");
		}
		const before = stubReq().length;
		await key("Enter");
		check(
			"Enter confirms auto-push after real answer",
			!!(await waitFor(
				`!document.querySelector('[role=dialog]')&&document.querySelectorAll('${switches}')[1].getAttribute('data-state')==='checked'`,
				4000,
			)),
		);
		const added = stubReq().slice(before);
		check(
			"exact linkID PATCH returns200 once",
			added.length === 1 &&
				added[0].includes("/v1/desktop/hub/links/link-public-agent -> 200"),
			added,
		);
		await snap("r3-fixed-policy-confirmed");
		await focus(1);
		await key(" ");
		await waitFor(
			`document.querySelectorAll('${switches}')[1].getAttribute('data-state')==='unchecked'`,
			3000,
		);
		await focus(1);
		await key(" ");
		await dialogOpen();
	} else if (MODE === "lost") {
		await focus(1);
		await key(" ");
		check("dialog opens before backend loss", !!(await dialogOpen()));
	} else {
		const blocked = await E(
			`(()=>{const r=document.querySelector('${row}');return {buttons:[...r.querySelectorAll('button')].map(b=>({disabled:b.disabled,text:b.textContent})),text:r.textContent}})()`,
		);
		check(
			"old/prerelease keeps every write control disabled",
			blocked.buttons.length >= 5 && blocked.buttons.every((b) => b.disabled),
			blocked.buttons,
		);
		check(
			"action names backend published release minimum",
			/Update the Local Operator backend to a published release 0\.72\.1 or newer/.test(
				blocked.text,
			),
			blocked.text,
		);
		check(
			"blocked row never promises manual availability",
			!/Manual (check|pull)/.test(blocked.text),
		);
		await E(
			`[...document.querySelectorAll('${row} button')].forEach(b=>b.click())`,
		);
		await wait(200);
		check(
			"blocked controls send zero PATCH",
			stubReq().length === 0,
			stubReq(),
		);
		await snap(MODE === "old" ? "r3-old-wide" : "r3-prerelease-narrow-light");
	}
	if (MODE === "fixed" || MODE === "fixed-short" || MODE === "lost") {
		await stopStub();
		const reason = await waitFor(
			`(()=>{const d=document.querySelector('[role=dialog]');const a=d?.querySelector('[role=alert]');return a&&/Reconnect the Local Operator backend/.test(a.textContent)?a.textContent:null})()`,
			12000,
		);
		check("backend loss reason is INSIDE consent", !!reason, reason);
		const disabled = await E(
			`(()=>{const d=document.querySelector('[role=dialog]');return [...d.querySelectorAll('button')].filter(b=>/Enable auto-push|Cancel/.test(b.textContent)).map(b=>({text:b.textContent,disabled:b.disabled}))})()`,
		);
		check(
			"Enable disabled but Cancel stays usable",
			disabled.some((b) => /Enable/.test(b.text) && b.disabled) &&
				disabled.some((b) => /Cancel/.test(b.text) && !b.disabled),
			disabled,
		);
		await snap(
			MODE === "fixed"
				? "r3-fixed-disconnected-dialog"
				: "r3-disconnected-narrow-light",
		);
	}
	const geometry = await E(
		`(()=>{const r=document.querySelector('${row}');let s=r.parentElement;while(s&&(!/(auto|scroll)/.test(getComputedStyle(s).overflowY)||s.clientHeight<=0))s=s.parentElement;const box=e=>{if(!e)return null;const b=e.getBoundingClientRect();return{x:b.x,y:b.y,w:b.width,h:b.height,cw:e.clientWidth,ch:e.clientHeight,sw:e.scrollWidth}};return {viewport:{w:innerWidth,h:innerHeight,dpr:devicePixelRatio},row:box(r),scroller:box(s),dialog:box(document.querySelector('[role=dialog]'))}})()`,
	);
	writeFileSync(join(OUT, "geometry.json"), JSON.stringify(geometry, null, 2));
	check(
		"actual viewport matches planned size",
		geometry.viewport.w === Number(SIZE.split("x")[0]) &&
			geometry.viewport.h === Number(SIZE.split("x")[1]),
		geometry.viewport,
	);
	check(
		"actual nonzero painted row and no horizontal overflow",
		geometry.row.w > 0 &&
			geometry.row.h > 0 &&
			geometry.scroller?.cw > 0 &&
			geometry.scroller.cw === geometry.scroller.sw,
		geometry,
	);
	const { isPaintedScrollBox } = await import(
		pathToFileURL(join(ROOT, "scripts/hub-guard-geometry.mjs")).href
	);
	check(
		"painted scroller positive accepted",
		isPaintedScrollBox(geometry.scroller),
	);
	check(
		"zero-wrapper negative refused",
		!isPaintedScrollBox({
			...geometry.scroller,
			w: 0,
			h: 0,
			cw: 0,
			ch: 0,
			sw: 0,
		}),
	);
	check(
		"horizontal-overflow negative refused",
		!isPaintedScrollBox({ ...geometry.scroller, sw: geometry.scroller.cw + 1 }),
	);
	if (MODE === "fixed" || MODE === "fixed-short") {
		await E(`fetch('http://127.0.0.1:8139/r3-csp-negative').catch(()=>null)`);
		await wait(100);
		const denied = await E(`window.__r3Csp.filter(v=>v.uri.includes('8139'))`);
		check(
			"CSP actual violation refuses undeclared loopback port",
			denied.length > 0,
			denied,
		);
	}
	const bad = cdp.requests.filter(
		(r) =>
			/^https?:/.test(r.url) &&
			!r.url.startsWith("http://127.0.0.1:8127/") &&
			!r.url.startsWith("http://127.0.0.1:8139/r3-csp-negative"),
	);
	check(
		"all observed renderer HTTP intents confined to stub plus denied control",
		bad.length === 0,
		bad,
	);
	check(
		"no live Radient request",
		!cdp.requests.some((r) => r.url.includes("api.radienthq.com")),
	);
	log("request observation", cdp.requests);
	log("actual fixture PATCHes", stubReq());
}
