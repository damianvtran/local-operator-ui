#!/usr/bin/env node
/*
 * Test double for `storybook dev`, used only through WITH_STORYBOOK_BIN by
 * with-storybook.test.mjs: serves 200 on `-p <port>`, and forks a grandchild so a test
 * can prove the helper reaches the whole process GROUP and not just the leader.
 * `STUB_PIDFILE` receives "<leader> <grandchild>". `STUB_IGNORE_TERM=1` makes both
 * ignore SIGTERM, to exercise the SIGKILL escalation.
 */
import { spawn } from "node:child_process";
import { writeFileSync } from "node:fs";
import { createServer } from "node:http";

if (process.env.STUB_IGNORE_TERM === "1") process.on("SIGTERM", () => {});
const port = Number(process.argv[process.argv.indexOf("-p") + 1]);
const grandchild = spawn(
	process.execPath,
	[
		"-e",
		"if(process.env.STUB_IGNORE_TERM==='1')process.on('SIGTERM',()=>{});setInterval(()=>{},1000)",
	],
	{ stdio: "ignore" },
);
if (process.env.STUB_PIDFILE) {
	writeFileSync(process.env.STUB_PIDFILE, `${process.pid} ${grandchild.pid}\n`);
}
createServer((_request, response) => response.end("ok")).listen(port);
