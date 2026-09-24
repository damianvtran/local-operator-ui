// design-482-r2 rig: an unbuffered loopback proxy on 8080 in front of the daemon's
// OS-chosen port, plus a mirror of the daemon's serve record rewritten to 8080
// (refreshed every 2 s so its heartbeat stays current). Scratch only.
import http from "node:http";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { join, basename } from "node:path";
const [target, recordPath, mirrorDir] = process.argv.slice(2);
const t = new URL(target);
mkdirSync(mirrorDir, { recursive: true });
const mirror = () => {
	try {
		const rec = JSON.parse(readFileSync(recordPath, "utf8"));
		rec.port = 8080; rec.host = "127.0.0.1";
		if (rec.url) rec.url = "http://127.0.0.1:8080";
		writeFileSync(join(mirrorDir, basename(recordPath)), JSON.stringify(rec));
	} catch (e) { console.error("mirror", String(e)); }
};
mirror(); setInterval(mirror, 2000);
// design-482-r3: hold every thread send (POST .../messages) for 4 s before forwarding,
// so #479's "Sending your message" window is long enough to put an aside on top of it.
const HOLD_MS = 4000;
const server = http.createServer(async (req, res) => {
	if (req.method === "POST" && /\/messages$/.test(req.url.split("?")[0])) { console.log("holding", req.url); await new Promise((r) => setTimeout(r, HOLD_MS)); }
	const up = http.request({ host: t.hostname, port: t.port, method: req.method, path: req.url, headers: { ...req.headers, host: `${t.hostname}:${t.port}` } }, (r) => {
		res.writeHead(r.statusCode, r.headers);
		res.flushHeaders?.();
		r.on("data", (c) => res.write(c));
		r.on("end", () => res.end());
	});
	up.on("error", (e) => { res.writeHead(502); res.end(String(e)); });
	req.pipe(up);
});
server.listen(8080, "127.0.0.1", () => console.log("proxy up on 8080 ->", target));
