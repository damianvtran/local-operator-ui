#!/usr/bin/env node
/**
 * Capture the oversize-message frames from the real chat surface.
 *
 * Why this exists rather than a hand-taken screenshot: it drives Chrome over
 * raw CDP exactly the way `scripts/capture-evidence.mjs` does - same private
 * `--headless=new` profile under the system temp dir, same DevTools websocket,
 * same `Page.captureScreenshot` - so these frames come from the repo's
 * established capture mechanism and not from a second browser stack. The
 * difference from that script is only WHAT is photographed: it sweeps
 * Storybook stories across twelve themes, and this drives one live composer
 * through a send.
 *
 * The surface is the browser dev server (`chat-413.vite.mjs`), which serves
 * the app's own `index.html` and mounts the shipped chat components. Its
 * `/__desktop` route calls the SAME `requestDesktop` in
 * `src/main/desktop-transport.ts` that Electron's IPC handler calls, so the
 * per-op budget lookup and the 413 under test are the shipping ones. What it
 * does NOT exercise is packaged Electron IPC, native dialogs, or a real
 * backend - see the README beside the frames, which states that plainly.
 *
 *     node capture-413.mjs <out-dir> <case>
 *
 * `case` is `fits` (five Retina screenshots, must be admitted) or `overflow`
 * (GIFs, which the ladder must not re-encode and the budget check must refuse).
 */

import { spawn } from "node:child_process";
import { mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const OUT = process.argv[2];
const CASE = process.argv[3] ?? "fits";
const ORIGIN = process.env.DESKTOP_413_ORIGIN ?? "http://localhost:5199";
const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

/** Same minimal CDP client as `scripts/capture-evidence.mjs`. */
class Cdp {
	constructor(ws) {
		this.ws = ws;
		this.next = 0;
		this.pending = new Map();
		ws.addEventListener("message", (ev) => {
			const msg = JSON.parse(ev.data);
			if (msg.id !== undefined && this.pending.has(msg.id)) {
				const { resolve, reject } = this.pending.get(msg.id);
				this.pending.delete(msg.id);
				msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result);
			}
		});
	}
	send(method, params = {}) {
		const id = ++this.next;
		this.ws.send(JSON.stringify({ id, method, params }));
		return new Promise((resolve, reject) =>
			this.pending.set(id, { resolve, reject }),
		);
	}
}

let chrome = null;
let dataDir = null;
const teardown = () => {
	if (chrome) {
		chrome.kill("SIGKILL");
		chrome = null;
	}
	if (dataDir) {
		rmSync(dataDir, { recursive: true, force: true });
		dataDir = null;
	}
};
// Same discipline as the sweep in capture-evidence.mjs: a run killed by a
// `timeout` wrapper never reaches teardown, and each abandoned profile is
// ~180MB that nothing else collects.
const sweepStaleProfiles = () => {
	const mine = `lo-413-${process.pid}`;
	for (const name of readdirSync(tmpdir())) {
		if (!name.startsWith("lo-413-") || name === mine) continue;
		try {
			process.kill(Number(name.slice("lo-413-".length)), 0);
			continue;
		} catch {
			rmSync(join(tmpdir(), name), { recursive: true, force: true });
		}
	}
};

const ATTACHMENTS = {
	fits: "screenshot-1.png,screenshot-2.png,screenshot-3.png,screenshot-4.png,screenshot-5.png",
	// GIF is exempt from the downscale ladder by design (a canvas draws one
	// frame, so re-encoding would flatten an animation). That exemption is what
	// makes it the genuine-overflow case the refusal copy exists for.
	overflow: "anim-1.gif,anim-2.gif",
};
const MESSAGES = {
	fits: "Here are five screenshots from the failing run. Each is an ordinary Retina capture, and together with this note they used to be refused before any request was made.",
	overflow:
		"These two animations cannot be downscaled without destroying them, so they will not fit in one message.",
};

const main = async () => {
	sweepStaleProfiles();
	mkdirSync(OUT, { recursive: true });
	dataDir = join(tmpdir(), `lo-413-${process.pid}`);
	mkdirSync(dataDir, { recursive: true });

	chrome = spawn(CHROME, [
		"--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--hide-scrollbars",
		`--user-data-dir=${dataDir}`,
		"--remote-debugging-port=0",
		"about:blank",
	]);
	const wsUrl = await new Promise((resolve, reject) => {
		let buf = "";
		const timer = setTimeout(
			() => reject(new Error("Chrome did not report a debug port")),
			30_000,
		);
		chrome.stderr.on("data", (d) => {
			buf += d.toString();
			const m = buf.match(/DevTools listening on (ws:\/\/[^\s]+)/);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		});
		chrome.on("exit", (code) =>
			reject(new Error(`Chrome exited early (${code})`)),
		);
	});
	const { host } = new URL(wsUrl);
	const list = await fetch(`http://${host}/json`).then((r) => r.json());
	const target = list.find((t) => t.type === "page");
	const ws = new WebSocket(target.webSocketDebuggerUrl);
	await new Promise((resolve, reject) => {
		ws.addEventListener("open", resolve, { once: true });
		ws.addEventListener("error", reject, { once: true });
	});
	const cdp = new Cdp(ws);
	await cdp.send("Page.enable");
	await cdp.send("Runtime.enable");
	await cdp.send("Emulation.setDeviceMetricsOverride", {
		width: 1440,
		height: 900,
		deviceScaleFactor: 2,
		mobile: false,
	});

	const evaluate = async (expression) => {
		const { result, exceptionDetails } = await cdp.send("Runtime.evaluate", {
			expression,
			awaitPromise: true,
			returnByValue: true,
		});
		if (exceptionDetails)
			throw new Error(exceptionDetails.exception?.description ?? "eval failed");
		return result.value;
	};
	const shoot = async (name) => {
		const { data } = await cdp.send("Page.captureScreenshot", {
			format: "png",
		});
		writeFileSync(join(OUT, `${name}.png`), Buffer.from(data, "base64"));
		process.stdout.write(`captured ${name}.png\n`);
	};
	const settle = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

	await cdp.send("Page.navigate", {
		url: `${ORIGIN}/?attach=${ATTACHMENTS[CASE]}`,
	});
	await settle(9000);

	// Drive the product's own controls rather than its store: the click path
	// through `handleAttachFile` and `submitMessage` is the thing under test.
	await evaluate(`(() => {
		const button = [...document.querySelectorAll('button')]
			.find((b) => b.textContent?.trim() === 'New chat' && b.closest('main'));
		if (button) button.click();
		return Boolean(button);
	})()`);
	await settle(2500);
	await evaluate(
		`document.querySelector('button[aria-label="Attach file"]').click()`,
	);
	await settle(4000);
	// React tracks the textarea's value on its own descriptor, so a plain
	// assignment is not seen. Setting through the prototype setter and firing a
	// bubbling input event is how a real keystroke reaches the component.
	await evaluate(`(() => {
		const area = document.querySelector('[aria-label="Message"]');
		const setter = Object.getOwnPropertyDescriptor(
			window.HTMLTextAreaElement.prototype, 'value').set;
		setter.call(area, ${JSON.stringify(MESSAGES[CASE])});
		area.dispatchEvent(new Event('input', { bubbles: true }));
		return area.value.length;
	})()`);
	await settle(1500);
	await shoot(`${CASE}-composed`);

	await evaluate(
		`document.querySelector('button[aria-label="Send message"]').click()`,
	);
	await settle(20000);
	await shoot(`${CASE}-result`);

	// The banner is the FIRST alert in the flow; the sidebar carries its own
	// unrelated one, so scope to the chat pane rather than taking [0] blindly.
	const banner = await evaluate(`(() => {
		const alerts = [...document.querySelectorAll('[role="alert"]')]
			.map((node) => node.innerText.trim())
			.filter((text) => text && !text.includes('Retry refresh'));
		return alerts[0] ?? '';
	})()`);
	process.stdout.write(`banner: ${JSON.stringify(banner)}\n`);

	// The latch check, and the whole point of refusing before admission: the
	// banner tells the user to remove an image, so removing one must actually
	// let the message go. Before this change the draft was pinned to a
	// byte-identical retry and this second send was refused as a payload change.
	if (CASE === "overflow") {
		const removed = await evaluate(`(() => {
			const remove = document.querySelectorAll('button[aria-label="Remove attachment"]');
			if (!remove.length) return 0;
			remove[remove.length - 1].click();
			return remove.length;
		})()`);
		process.stdout.write(`attachments before removal: ${removed}\n`);
		await settle(2000);
		await shoot("overflow-after-removing-one");
		await evaluate(
			`document.querySelector('button[aria-label="Send message"]').click()`,
		);
		await settle(20000);
		await shoot("overflow-retry-accepted");
		const after = await evaluate(`(() => {
			const alerts = [...document.querySelectorAll('[role="alert"]')]
				.map((node) => node.innerText.trim())
				.filter((text) => text && !text.includes('Retry refresh'));
			return alerts[0] ?? '';
		})()`);
		process.stdout.write(`banner after retry: ${JSON.stringify(after)}\n`);
	}
};

process.on("exit", teardown);
process.on("SIGINT", () => process.exit(130));
process.on("SIGTERM", () => process.exit(143));
main().then(teardown, (error) => {
	teardown();
	process.stderr.write(`${error.stack ?? error}\n`);
	process.exit(1);
});
