import { build } from "esbuild";
import { writeFile, unlink } from "node:fs/promises";
const b = await build({ stdin: { contents: `export {inlineImageSpans} from './src/renderer/src/features/team-bridge/inline-data-receipt';`, resolveDir: process.cwd() },
  bundle: true, platform: "node", format: "esm", write: false, alias: { "@shared": `${process.cwd()}/src/renderer/src/shared` }, packages: "external", jsx: "automatic", loader: { ".css": "empty" } });
const p = `${process.env.LOCAL_OPERATOR_SCRATCHPAD}/qa1554/probe-bundle-${process.pid}.mjs`;
await writeFile(p, b.outputFiles[0].text);
const { inlineImageSpans } = await import(p); await unlink(p);
const B64 = (n) => "Qk+/x9Zp".repeat(Math.ceil(n / 8)).slice(0, n);
const B64URL = (n) => "Qk-_x9Zp".repeat(Math.ceil(n / 8)).slice(0, n);
const wrap = (s, w) => s.match(new RegExp(`.{1,${w}}`, "g")).join("\n");
const cases = {
  repro: `[image 1/1: photo.jpg; jpeg 1600x1200; 452118 bytes; sha256 ${"a".repeat(64)}] data:image/jpeg;base64,/9j/4AAQ${B64(550000)}`,
  svg: `SVG: data:image/svg+xml;base64,${B64(20000)} end.`,
  upper: `DATA:IMAGE/PNG;BASE64,${B64(20000)} end.`,
  wrapped76: `W:\ndata:image/png;base64,${wrap(B64(8000), 76)}\nAfter.`,
  wrapped76_1500: `W:\ndata:image/png;base64,${wrap(B64(1500), 76)}\nAfter.`,
  wrapped76_2100: `W:\ndata:image/png;base64,${wrap(B64(2100), 76)}\nAfter.`,
  wrapped_crlf: `W:\r\ndata:image/png;base64,${wrap(B64(8000), 76).replace(/\n/g, "\r\n")}\r\nAfter.`,
  short: "S: data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg== is 1x1.",
  tail: `T: data:image/jpeg;base64,${B64(20000)}AB==!!!then tail.`,
  b64url: `U: data:image/png;base64,${B64URL(20000)} end.`,
  b64url_big: `U: data:image/png;base64,${B64URL(550000)} end.`,
  nonb64_param: `P: data:image/png;name=x;base64,${B64(20000)} end.`,
  utf8_svg: `X: data:image/svg+xml;utf8,<svg>${"x".repeat(20000)}</svg> end.`,
  space_wrapped: `S: data:image/png;base64,${B64(1000)} ${B64(1000)} ${B64(1000)} ${B64(1000)} end.`,
};
for (const [k, body] of Object.entries(cases)) {
  const t0 = performance.now(); const spans = inlineImageSpans(body); const ms = (performance.now() - t0).toFixed(1);
  let cursor = 0, visible = 0, maxRun = 0;
  for (const s of spans) { const seg = body.slice(cursor, s.start); visible += seg.length; maxRun = Math.max(maxRun, ...seg.split(/\s+/).map(x=>x.length)); cursor = s.end; }
  const rest = body.slice(cursor); visible += rest.length; maxRun = Math.max(maxRun, ...rest.split(/\s+/).map(x=>x.length));
  console.log(`${k.padEnd(15)} len=${String(body.length).padStart(6)} spans=${JSON.stringify(spans.map(s=>({n:s.end-s.start,mime:s.mime,u:!!s.uncertain})))} visibleChars=${visible} longestVisibleToken=${maxRun} ${ms}ms`);
}
