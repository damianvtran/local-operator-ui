// Positive control for the page-side Runtime.enable detectors: real Chrome,
// one CDP client that enables Runtime before navigating to the probe.
const port = process.argv[2];
const url = process.argv[3];
const enable = process.argv[4] !== "none";
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const t = list.find((x) => x.type === "page");
const ws = new WebSocket(t.webSocketDebuggerUrl);
let id = 0;
const send = (method, params = {}) =>
	new Promise((r) => {
		const i = ++id;
		const h = (m) => {
			const d = JSON.parse(m.data);
			if (d.id === i) {
				ws.removeEventListener("message", h);
				r(d);
			}
		};
		ws.addEventListener("message", h);
		ws.send(JSON.stringify({ id: i, method, params }));
	});
await new Promise((r) => ws.addEventListener("open", r));
if (enable) await send("Runtime.enable");
await send("Page.navigate", { url });
await new Promise((r) => setTimeout(r, 5000));
ws.close();
