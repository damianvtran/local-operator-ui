/**
 * Hosted macOS native API proof, not Dock-pixel proof: headless deliberately
 * calls app.dock.hide(). Never widen resolvedWindowMode/the notifications gate
 * to photograph a tile. Main CDP reads Electron's real getBadge(); renderer PNGs
 * and hidden/unfocused window facts are separate evidence, not Dock screenshots.
 *
 * The built app connects to a SHA-pinned real core with a throwaway HOME and a
 * synthetic token. Every transition uses core's own notification/ask/approval
 * writers: the adapter never acknowledges anything. No model, OS banner, SSH,
 * operator signer or live account participates. Denial requires no signing key.
 * Counts spread over four synthetic sessions respect the store's 30/hour cap.
 *
 * Only GitHub-hosted macOS may launch this scene. Refuse before importing the
 * driver (which resolves Electron), so refusal needs no dependency installation.
 * CI supplies LOCAL_OPERATOR_CORE_BIN/PYTHON/REF and RUNNER_TEMP. The workflow's
 * explicit core PR pin must follow its merged SHA before this UI PR merges.
 */
import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";
import { isEntryPoint } from "./entry-point.mjs";
import { pythonChildEnv } from "./python-child-env.mjs";

const OUT = resolve("artifacts/app-icon-badge-native");
const SESSION = "badd00000001";
const ASK = "a-bad1";
const pause = (ms) => new Promise((done) => setTimeout(done, ms));

export function missingScenePrerequisites(
	env = process.env,
	platform = process.platform,
) {
	const missing = [];
	for (const name of ["CI", "GITHUB_ACTIONS"])
		if (env[name] !== "true") missing.push(`${name}=true`);
	if (env.RUNNER_ENVIRONMENT !== "github-hosted")
		missing.push("GitHub-hosted runner");
	if (platform !== "darwin") missing.push("macOS");
	for (const name of [
		"RUNNER_TEMP",
		"LOCAL_OPERATOR_CORE_BIN",
		"LOCAL_OPERATOR_CORE_PYTHON",
	])
		if (!env[name]) missing.push(name);
	if (!/^[a-f0-9]{40}$/.test(env.LOCAL_OPERATOR_CORE_REF ?? ""))
		missing.push("40-hex core pin");
	return missing;
}

const freePort = () =>
	new Promise((done, fail) => {
		const server = createServer();
		server.on("error", fail);
		server.listen(0, "127.0.0.1", () => {
			const { port } = server.address();
			server.close(() => done(port));
		});
	});

// Exported source contract: tests can inspect real writer usage without Electron.
export function mutationPython(input) {
	return `import json, time
from pathlib import Path
from types import SimpleNamespace
from local_operator.notifications.store import NotificationStore
from local_operator.asks import store as asks
from local_operator.asks.queue import AskQueue
from local_operator.network import approvals as A
data = json.loads(${JSON.stringify(JSON.stringify(input))})
config = Path(data["config"])
sid = ${JSON.stringify(SESSION)}
aid = ${JSON.stringify(ASK)}
sd = config / "sessions" / sid
store = NotificationStore(config)
action = data["action"]
result = {}
if action == "notify":
    items = []
    for index in range(data["start"], data["end"]):
        item = store.notify(f"badc{index // 25:08x}", key=f"badge-{index}", title="Synthetic badge item", body_md="CI badge projection only.")
        items.append([item.item_id, item.revision])
    result = {"items": items}
elif action == "read_notifications":
    result = {"changed": store.apply("read", ids=[tuple(item) for item in data["items"]]).changed}
elif action == "ask":
    sd.mkdir(parents=True, exist_ok=True)
    row = {"v": 1, "type": "message", "id": "badge-user", "timestamp": time.time(), "payload": {"kind": "message", "role": "user", "content": [{"text": "Synthetic native badge scene."}]}}
    (sd / "transcript.jsonl").write_text(json.dumps(row) + "\\n")
    now = asks.now_ms()
    assert asks.append_event(sd, {"v": 1, "kind": "queued", "at": now, "ask_id": aid, "created_at": now, "expires_at": now + 3600000, "timeout_s": 3600, "urgent": False, "questions": [{"id": "BADGE", "question": "Synthetic badge decision", "options": [{"label": "Continue"}]}]})
    queue = AskQueue(SimpleNamespace(), config_dir=config, session_id=sid, cwd=str(sd))
    asks.write_entry(config, sid, cwd=str(sd), asks=queue.projection())
    result = {"asks": queue.projection()}
elif action == "read_ask":
    result = {"changed": store.mark_refs([f"ask:{sid}:{aid}"], read=True)}
elif action == "withdraw_ask":
    assert asks.append_event(sd, {"v": 1, "kind": "withdrawn", "ask_id": aid, "at": asks.now_ms(), "reason": "synthetic scene finished"})
    queue = AskQueue(SimpleNamespace(), config_dir=config, session_id=sid, cwd=str(sd))
    asks.write_entry(config, sid, cwd=str(sd), asks=queue.projection())
    result = {"asks": queue.projection()}
elif action == "approval":
    record = A.create_request(kind=A.KIND_LOCAL_AUTHORITY, request_id=A.new_request_id(), requested_by={"session_id": sid, "surface": "desktop"}, machine={"hostname": "ci-badge", "platform": "darwin", "uid": "501", "backend": "file-only", "level": "operator-file-only"}, what={"install": True}, credential_ref=None, root=config)
    result = {"approval_id": record["approval_id"], "state": record["state"]}
elif action == "deny":
    record = A.deny(data["approval_id"], root=config)
    result = {"approval_id": record["approval_id"], "state": record["state"]}
else:
    raise ValueError(action)
print(json.dumps(result))
`;
}

async function main() {
	const missing = missingScenePrerequisites();
	if (missing.length)
		throw new Error(`native badge scene refused: ${missing.join(", ")}`);
	// No inherited multiplexer/session or Python binding can reach the child.
	for (const name of Object.keys(process.env))
		if (name.startsWith("CMUX_") || name === "XPC_FLAGS")
			delete process.env[name];
	const { rendererDriverApi: api } = await import("./renderer-driver.mjs");
	mkdirSync(OUT, { recursive: true });
	const root = mkdtempSync(join(process.env.RUNNER_TEMP, "badge-scene-"));
	const home = join(root, "home");
	const config = join(home, ".local-operator");
	mkdirSync(config, { recursive: true });
	const token = randomBytes(24).toString("base64url");
	const port = await freePort();
	const base = `http://127.0.0.1:${port}`;
	const env = pythonChildEnv({
		extra: {
			HOME: home,
			LOCAL_OPERATOR_CONFIG_DIR: config,
			LOCAL_OPERATOR_DESKTOP_TOKEN: token,
			LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			LOCAL_OPERATOR_UI_TELEMETRY: "off",
		},
	});
	const core = (source) =>
		execFileSync(process.env.LOCAL_OPERATOR_CORE_PYTHON, ["-c", source], {
			env: pythonChildEnv({ base: env }),
			cwd: home,
			encoding: "utf8",
			timeout: 15_000,
		});
	const mutate = (action, fields = {}) =>
		JSON.parse(core(mutationPython({ config, action, ...fields })));
	const receipt = {
		sourceCommit: execFileSync("git", ["rev-parse", "HEAD"], {
			encoding: "utf8",
		}).trim(),
		coreRef: process.env.LOCAL_OPERATOR_CORE_REF,
		startedAt: new Date().toISOString(),
		claim:
			"Native app.dock.getBadge() readback; Dock pixels NOT captured (headless hides tile)",
		states: [],
		result: "failed",
	};
	const log = [];
	let backend;
	let cdp;
	let nodeCdp;
	let finishing = false;
	async function finish(exitCode) {
		let code = exitCode;
		if (finishing) return;
		finishing = true;
		cdp?.close();
		nodeCdp?.close();
		if (backend?.pid) {
			// This detached process group belongs only to this pinned backend.
			// Reap it before the driver exits/purges Python scratch; never pkill.
			// Group probes are exact ownership checks, including a reparented child.
			for (const signal of ["SIGTERM", "SIGKILL"]) {
				try {
					process.kill(-backend.pid, signal);
				} catch (error) {
					if (error.code !== "ESRCH") {
						receipt.teardownError = String(error);
						code = 1;
					}
				}
				const deadline = Date.now() + 2_000;
				while (
					backend.exitCode === null &&
					backend.signalCode === null &&
					Date.now() < deadline
				)
					await pause(50);
			}
			try {
				process.kill(-backend.pid, 0);
				receipt.teardownError = "owned backend process group survived teardown";
				code = 1;
			} catch (error) {
				if (error.code !== "ESRCH") {
					receipt.teardownError = String(error);
					code = 1;
				}
			}
		}
		receipt.endedAt = new Date().toISOString();
		writeFileSync(
			join(OUT, "native-scene.json"),
			JSON.stringify(receipt, null, 2),
		);
		writeFileSync(join(OUT, "core.log"), log.join(""));
		await api.reapLiveBoots({ code, why: "native badge scene complete" });
	}
	process.once("SIGTERM", () => {
		void finish(143);
	});
	process.once("SIGINT", () => {
		void finish(130);
	});
	try {
		const installed = JSON.parse(
			core(`import importlib.metadata, json
print(importlib.metadata.distribution("local-operator").read_text("direct_url.json"))`),
		);
		assert.equal(
			installed.vcs_info?.commit_id,
			receipt.coreRef,
			"core install must match explicit SHA",
		);
		backend = spawn(
			process.env.LOCAL_OPERATOR_CORE_BIN,
			["serve", "--host", "127.0.0.1", "--port", String(port)],
			{
				env: pythonChildEnv({ base: env }),
				cwd: home,
				detached: true,
				stdio: ["ignore", "pipe", "pipe"],
			},
		);
		backend.on("error", (error) => log.push(String(error)));
		backend.stdout.on("data", (chunk) => log.push(chunk.toString()));
		backend.stderr.on("data", (chunk) => log.push(chunk.toString()));
		const healthDeadline = Date.now() + 90_000;
		for (;;) {
			try {
				const response = await fetch(`${base}/health`, {
					signal: AbortSignal.timeout(2_000),
				});
				if (response.ok) break;
			} catch {
				/* readiness has a finite deadline, never a fallback core */
			}
			assert.ok(Date.now() < healthDeadline, "pinned core health timeout");
			await pause(250);
		}
		const handle = await api.launchApp({
			armed: false,
			apiUrl: base,
			tag: "app-icon-badge",
			logName: "app-icon-badge.log",
			windowMode: "headless",
			envExtra: {
				LOCAL_OPERATOR_DESKTOP_TOKEN: token,
				LOCAL_OPERATOR_UI_APP_ICON_BADGE_SCENE: "1",
				LOCAL_OPERATOR_UI_TELEMETRY: "off",
				LOCAL_OPERATOR_NO_NOTIFICATIONS: "1",
			},
		});
		receipt.pid = handle.pid;
		receipt.compiledMainSha256 = createHash("sha256")
			.update(readFileSync("out/main/index.js"))
			.digest("hex");
		await api.waitForDevtools(handle);
		cdp = await api.CdpClient.attach(handle.port, "out/renderer/index.html");
		nodeCdp = await api.CdpClient.attachNode(handle.inspectPort);
		await api.waitForPage(cdp);
		const facts = () =>
			nodeCdp.evaluate(`(() => {
			const e = process.mainModule?.require("electron") ?? globalThis.require?.("electron");
			return { badge: e.app.dock.getBadge(), dockVisible: e.app.dock.isVisible(),
				projection: globalThis.__lopAppIconBadgeSceneRead?.() ?? null,
				windows: e.BrowserWindow.getAllWindows().map(w => ({visible: w.isVisible(), focused: w.isFocused()})) };
		})()`);
		async function capture(name, badge, unreadCount, pending, writer = null) {
			const deadline = Date.now() + 30_000;
			let value;
			for (;;) {
				value = await facts();
				if (
					value?.badge === badge &&
					value.projection?.unreadCount === unreadCount &&
					value.projection?.pending === pending &&
					value.projection?.lastResult === "applied"
				)
					break;
				assert.ok(
					Date.now() < deadline,
					`${name} did not converge: ${JSON.stringify(value)}`,
				);
				await pause(200);
			}
			assert.equal(
				value.dockVisible,
				false,
				"headless must not reveal a Dock tile",
			);
			assert.ok(value.windows.length > 0, "real renderer window required");
			assert.ok(
				value.windows.every((w) => !w.visible && !w.focused),
				"scene must never show/focus a window",
			);
			const description = value.projection.lastDescription;
			if (badge === "") assert.equal(description, "");
			else
				assert.ok(
					description.length > 0,
					"keyed projection description required",
				);
			if (unreadCount > 0)
				assert.ok(
					description.includes(String(unreadCount)),
					"description must retain exact count",
				);
			const frames = [];
			// Consecutive frames show settling separately from native API facts.
			for (let index = 0; index < 2; index++) {
				const answer = await cdp.send("Page.captureScreenshot", {
					format: "png",
				});
				const data = answer?.result?.data ?? answer?.data;
				assert.ok(
					typeof data === "string" && data.length > 0,
					"renderer PNG missing",
				);
				const filename = `${name}-${index}.png`;
				writeFileSync(join(OUT, filename), Buffer.from(data, "base64"));
				frames.push(filename);
				await pause(150);
			}
			const after = await facts();
			assert.deepEqual(
				after,
				value,
				`${name} changed while renderer frames settled`,
			);
			receipt.states.push({ name, writer, native: value, frames });
			writeFileSync(
				join(OUT, "native-scene.json"),
				JSON.stringify(receipt, null, 2),
			);
		}
		await capture("clear", "", 0, false);
		const items = [];
		for (const [start, end, expected] of [
			[0, 1, "1"],
			[1, 12, "12"],
			[12, 100, "99+"],
		]) {
			const writer = mutate("notify", { start, end });
			items.push(...writer.items);
			await capture(`count-${end}`, expected, end, false, writer);
		}
		await capture(
			"notifications-read",
			"",
			0,
			false,
			mutate("read_notifications", { items }),
		);
		await capture("ask-open", "1", 1, true, mutate("ask"));
		await capture("ask-read-pending", "•", 0, true, mutate("read_ask"));
		await capture("ask-withdrawn", "", 0, false, mutate("withdraw_ask"));
		const approval = mutate("approval");
		await capture("approval-requested", "•", 0, true, approval);
		await capture(
			"approval-denied",
			"",
			0,
			false,
			mutate("deny", { approval_id: approval.approval_id }),
		);
		receipt.result = "native-api-readback-confirmed-not-dock-pixels";
	} catch (error) {
		receipt.error = String(error?.stack ?? error);
	} finally {
		await finish(
			receipt.result === "native-api-readback-confirmed-not-dock-pixels"
				? 0
				: 1,
		);
	}
}

if (isEntryPoint(import.meta.url)) await main();
