#!/usr/bin/env node
/**
 * Browser-tool fixture for the actual compiled observer. No browser is launched
 * or driven here. Synthetic promise controls are explicitly labelled; the two
 * real WebAuthn controls fail before authenticator UI (invalid RP / pre-abort).
 * They never create a credential, read a password, or request a native sheet.
 *
 * Run: node scripts/passkey-recovery-fixture.mjs [port]
 * Open the printed localhost URL with the harness browser. ?native=1 models a
 * configured Touch ID gate; ?before=1 compiles the pinned base observer from git.
 * --base=<sha> overrides that control's revision explicitly. Reload between
 * controls. Only the fixture's promise outcomes are synthetic, never credentials.
 */
import { execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { resolve } from "node:path";
import { build } from "esbuild";

const base =
	process.argv.find((arg) => arg.startsWith("--base="))?.slice(7) ??
	"0331b07583134b06f641bb962b5f8ec67cbcc0ca";
const port = Number(
	process.argv.slice(2).find((arg) => !arg.startsWith("--")) ?? 0,
);
const oldSource = execFileSync(
	"git",
	["show", `${base}:src/main/browser/passkey-notice.ts`],
	{ encoding: "utf8" },
);
async function observer(contents) {
	const result = await build({
		stdin: { contents, loader: "ts", resolveDir: resolve("src/main/browser") },
		bundle: true,
		platform: "node",
		format: "esm",
		write: false,
	});
	// Main-side imports are not used by passkeyShimSource; importing this bundle
	// in Node avoids exposing crypto or any main-process API to the fixture page.
	return (
		await import(
			`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
		)
	).passkeyShimSource;
}
const before = await observer(oldSource);
const after = await observer(
	'export { passkeyShimSource } from "./passkey-notice";',
);
const nonce = "00000000-0000-4000-8000-000000000001";
const server = createServer((request, response) => {
	const url = new URL(request.url, "http://localhost");
	response.setHeader("Cache-Control", "no-store");
	if (url.pathname === "/shim.js") {
		response.setHeader("Content-Type", "text/javascript; charset=utf-8");
		response.end(
			(url.searchParams.has("before") ? before : after)(
				nonce,
				!url.searchParams.has("native"),
			),
		);
		return;
	}
	if (url.pathname !== "/") {
		response.writeHead(404).end();
		return;
	}
	response.setHeader("Content-Type", "text/html; charset=utf-8");
	response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Passkey observer fixture</title>
<style>body{font:16px system-ui;max-width:900px;margin:24px}button{margin:6px;padding:10px}pre{white-space:pre-wrap;overflow-wrap:anywhere}</style>
<h1>Passkey observer fixture</h1><p>No credential is created. Synthetic controls test the observer, not native support. Reload between controls.</p>
<p id="configuration"></p><div id="controls"></div><pre id="result">No request</pre><pre id="signals">[]</pre>
<script>
const lines=[]; const nativeGet=CredentialsContainer.prototype.get;
let mode='real', last;
const paint=()=>document.querySelector('#signals').textContent=JSON.stringify(lines,null,2);
const debug=console.debug.bind(console);
console.debug=function(line){ if(typeof line==='string' && line.startsWith('local-operator:passkey-pending:')){lines.push(line);paint();} debug(...arguments); };
// This is the synthetic ORIGINAL under observation, not a browser authenticator.
CredentialsContainer.prototype.get=function(options){
 if(mode==='real') last=nativeGet.call(this,options);
 else if(mode==='success') last=Promise.resolve({id:'synthetic-only'});
 else if(mode==='pending') last=new Promise(()=>{});
 else last=Promise.reject(new DOMException('synthetic-only',mode==='security'?'SecurityError':'NotAllowedError'));
 return last;
};
</script><script src="/shim.js?${url.searchParams.has("before") ? "before=1&" : ""}${url.searchParams.has("native") ? "native=1" : ""}"></script><script>
const config=new URLSearchParams(location.search);
document.querySelector('#configuration').textContent=(config.has('before')?'BASE observer':'FIXED observer')+'; '+(config.has('native')?'configured-native gate':'gate off');
const controls=[['reject','Synthetic NotAllowedError'],['success','Synthetic success'],['pending','Synthetic pending'],['conditional','Synthetic conditional mediation'],['aborted','Synthetic explicitly aborted signal'],['security','Synthetic SecurityError'],['real-abort','Real WebAuthn pre-aborted'],['real-origin','Real WebAuthn wrong RP']];
for(const [id,label] of controls){const button=document.createElement('button');button.id=id;button.textContent=label;button.onclick=async()=>{
 mode=id.startsWith('real-')?'real':(['conditional','aborted'].includes(id)?'reject':id);
 const controller=new AbortController();
 const options={publicKey:{challenge:new Uint8Array(32),rpId:id==='real-origin'?'127.0.0.2':location.hostname}};
 if(id==='conditional')options.mediation='conditional';
 if(id==='aborted'||id==='real-abort'){controller.abort();options.signal=controller.signal;}
 const result=document.querySelector('#result');result.textContent='pending';
 try{const promise=navigator.credentials.get(options);const identity=promise===last;await promise;result.textContent=JSON.stringify({settled:'resolved',originalPromise:identity});}
 catch(error){result.textContent=JSON.stringify({settled:'rejected',name:error.name});}
};document.querySelector('#controls').append(button);}
</script></html>`);
});
server.listen(port, "127.0.0.1", () =>
	console.log(
		`PASSKEY_FIXTURE http://127.0.0.1:${server.address().port}/ base=${base}`,
	),
);
for (const signal of ["SIGTERM", "SIGINT"])
	process.on(signal, () => server.close(() => process.exit(0)));
