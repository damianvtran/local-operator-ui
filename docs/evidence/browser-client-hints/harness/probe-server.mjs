import fs from "node:fs";
// Neutral loopback probe: echoes request headers (incl. high-entropy client hints
// after Accept-CH) and collects JS-side identity facts POSTed by the page.
import http from "node:http";
const port = Number(process.argv[2] || 47811);
const out = process.argv[3] || "results.jsonl";
const HINTS =
	"Sec-CH-UA, Sec-CH-UA-Mobile, Sec-CH-UA-Platform, Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch, Sec-CH-UA-Bitness, Sec-CH-UA-Model, Sec-CH-UA-WoW64, Sec-CH-UA-Form-Factors, Sec-CH-UA-Full-Version";
const page = (
	hdrs,
) => `<!doctype html><meta charset=utf-8><title>identity probe</title>
<style>body{font:13px monospace;white-space:pre-wrap}</style><body><div id=o>running…</div><script>
(async()=>{const r={label:location.hash.slice(1)||"none",headers:${JSON.stringify(hdrs)}};
r.ua=navigator.userAgent;r.webdriver=navigator.webdriver;r.vendor=navigator.vendor;
const d=navigator.userAgentData;r.uad=d?{brands:d.brands,mobile:d.mobile,platform:d.platform}:null;
if(d){try{r.uadHigh=await d.getHighEntropyValues(["architecture","bitness","brands","formFactors","fullVersionList","model","platformVersion","uaFullVersion","wow64"])}catch(e){r.uadHigh=String(e)}}
r.chrome={present:typeof window.chrome,runtime:typeof (window.chrome&&chrome.runtime),app:typeof (window.chrome&&chrome.app),csi:typeof (window.chrome&&chrome.csi),loadTimes:typeof (window.chrome&&chrome.loadTimes)};
r.plugins=navigator.plugins.length;r.mimeTypes=navigator.mimeTypes.length;r.pdfViewerEnabled=navigator.pdfViewerEnabled;
r.notification=typeof Notification!=="undefined"?Notification.permission:"absent";
try{r.permNotifications=(await navigator.permissions.query({name:"notifications"})).state}catch(e){r.permNotifications="err:"+e.message}
r.languages=navigator.languages;r.hwc=navigator.hardwareConcurrency;r.publicKeyCredential=typeof window.PublicKeyCredential;
try{r.uvpa=await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable()}catch(e){r.uvpa="err"}
try{r.conditionalMediation=await PublicKeyCredential.isConditionalMediationAvailable()}catch(e){r.conditionalMediation="err"}
// Runtime.enable detectors: console serialisation only touches these objects
// when a CDP client has the Runtime domain enabled.
const detect=()=>{const hit={stack:false,proxy:false};
const e=new Error("x");Object.defineProperty(e,"stack",{configurable:true,get(){hit.stack=true;return ""}});console.debug(e);
const px=new Proxy({},{ownKeys(t){hit.proxy=true;return Reflect.ownKeys(t)},getOwnPropertyDescriptor(t,k){hit.proxy=true;return Reflect.getOwnPropertyDescriptor(t,k)}});console.debug(px);
return hit;};
r.cdpEarly=detect();await new Promise(s=>setTimeout(s,2500));r.cdpLate=detect();await new Promise(s=>setTimeout(s,200));
r.runtimeEnableDetected=r.cdpEarly.stack||r.cdpEarly.proxy||r.cdpLate.stack||r.cdpLate.proxy;
r.outer=[outerWidth,outerHeight];r.visibility=document.visibilityState;r.hasFocus=document.hasFocus();
document.getElementById("o").textContent=JSON.stringify(r,null,1);
fetch("/report",{method:"POST",body:JSON.stringify(r)});})();
</script>`;
http
	.createServer((req, res) => {
		if (req.method === "POST") {
			let b = "";
			req.on("data", (c) => (b += c));
			req.on("end", () => {
				let j = {};
				try {
					j = JSON.parse(b);
				} catch {}
				j.reportHeaders = Object.fromEntries(
					Object.entries(req.headers).filter(
						([k]) => k.startsWith("sec-ch") || k === "user-agent",
					),
				);
				fs.appendFileSync(out, JSON.stringify(j) + "\n");
				res.end("ok");
			});
			return;
		}
		if (req.url !== "/" && !req.url.startsWith("/?")) {
			res.statusCode = 404;
			return res.end();
		}
		const h = Object.fromEntries(
			Object.entries(req.headers).filter(
				([k]) => k.startsWith("sec-ch") || k === "user-agent",
			),
		);
		res.setHeader("Accept-CH", HINTS);
		res.setHeader(
			"Critical-CH",
			"Sec-CH-UA-Full-Version-List, Sec-CH-UA-Platform-Version, Sec-CH-UA-Arch",
		);
		res.setHeader("Content-Type", "text/html");
		res.end(page(h));
	})
	.listen(port, "127.0.0.1", () => console.log("listening", port));
