import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import Module from "node:module";
import { after } from "node:test";
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import React, { act } from "react";

/* Shared with the integration lane's optimistic-container probe. Mount the
 * production container/view, real query hooks and TeamBridgeApi. Only the preload wire and unrelated
 * auth/membership/sidebar boundaries are fixtures. No onSend behavior stub,
 * direct acknowledgeSend call or independently reimplemented pending reducer.
 * This proves DOM/state/transport behavior, NOT native or rendered pixels. */
const dom = new JSDOM("<!doctype html><body></body>", { url: "http://localhost/" });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
for (const name of ["HTMLElement", "Element", "Node", "NodeFilter", "MutationObserver", "DocumentFragment", "CustomEvent", "HTMLInputElement", "HTMLTextAreaElement", "HTMLButtonElement"]) globalThis[name] = dom.window[name];
globalThis.getComputedStyle = dom.window.getComputedStyle;
dom.window.HTMLElement.prototype.scrollIntoView = () => {};
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const { createRoot } = await import("react-dom/client");
after(() => dom.window.close());
const SIDEBAR = /chat\/components\/chat-sidebar$/;
const AUTH = /use-radient-auth$/;
const MEMBERSHIPS = /use-memberships-query$/;
const ANY = /.*/;
const role = readFileSync("src/renderer/src/features/chat/components/chat-sidebar.tsx", "utf8").match(/export const rowCurrent =\s*("[^"]+")/)?.[1];
assert.ok(role);
const bundle = await build({
 stdin: { contents: `export {TeamBridgePage} from './src/renderer/src/features/team-bridge/team-bridge-page';
 export {teamBridgeKeys} from './src/renderer/src/features/team-bridge/use-team-bridge';
 export {teamBridgeViewingConversation} from './src/renderer/src/features/team-bridge/team-bridge-viewing';
 export {QueryClient,QueryClientProvider} from '@tanstack/react-query';
 export {MemoryRouter} from 'react-router-dom';`, resolveDir: process.cwd() },
 bundle: true, format: "cjs", platform: "node", external: ["react", "react-dom"],
 loader: { ".css": "empty" }, tsconfig: "tsconfig.app.json", write: false,
 plugins: [{ name: "unrelated-boundaries", setup(b) {
  b.onResolve({filter:SIDEBAR},()=>({path:"sidebar",namespace:"fixture"}));
  b.onResolve({filter:AUTH},()=>({path:"auth",namespace:"fixture"}));
  b.onResolve({filter:MEMBERSHIPS},()=>({path:"memberships",namespace:"fixture"}));
  b.onLoad({filter:ANY,namespace:"fixture"},({path})=>({loader:"js",contents:path==="sidebar"?`export const rowCurrent=${role};`:path==="auth"?`export const useRadientAuth=()=>({user:{name:'Fixture owner'},isAuthenticated:true});`:`export const useMembershipsQuery=()=>({memberships:[],isPending:false,isLoading:false,isError:false});`}));
 }}],
});
const compiled = new Module(`${process.cwd()}/scripts/pending-owner-container-runtime.cjs`);
compiled.filename = `${process.cwd()}/scripts/pending-owner-container-runtime.cjs`;
compiled.paths = Module._nodeModulePaths(process.cwd());
compiled._compile(bundle.outputFiles[0].text, compiled.filename);
const ui = compiled.exports;
const now = "2026-10-23T12:00:00Z";
const person = (id) => ({ account_id:id,kind:"human",display_label:id,state:"active",role:"member" });
const conversation = (id="bcv_shared") => ({id,tenant_id:"org_shared",kind:"group",name:"Shared thread",visibility:"private",agent_capable:false,status:"open",created_by:"acct_a",last_message_at:now,latest_seq:0,members:[person("acct_a"),person("acct_b")],last_read_seq:0,unread_count:0,muted:false});
const reply = (result) => ({status:200,body:{result}});
const delay = () => act(async()=>new Promise(resolve=>setTimeout(resolve,10)));
async function until(predicate, label) { for(let i=0;i<150;i++){if(predicate())return;await delay();} assert.fail(`timed out: ${label}`); }
function deferred() { let resolve;const promise=new Promise(done=>{resolve=done;});return {promise,resolve}; }
async function mount({ empty = false } = {}) {
 localStorage.clear();
 const fixture = { account: "acct_a", tenant: "org_shared", refuse: true, calls: [], messages: new Map(), createGate: null, postGate: null, empty, generation: "A", enabled: true, readOnly: false };
 window.api = { desktop: { request: async (request) => {
  // The fake server captures ownership at dispatch, just as an authenticated
  // request does. A late A reply must not silently become B's server history.
  const owner = fixture.account;
  const tenant = fixture.tenant;
  const generation = fixture.generation;
  const ownerKey = JSON.stringify([owner, tenant]);
  fixture.calls.push({ owner, tenant, ...request });
  switch (request.op) {
   case "team_bridge.status": return reply({ capability: 1, state: "ready", read_only: fixture.readOnly, account_id: owner, tenant_id: tenant, surface_state: "D", visibility: { settings: true, inbox: true, account_door: true, onboarding: false }, update_required: false, local: { enabled: fixture.enabled, onboarding: "done", session: "present" }, status: { tenants: [{ tenant_id: "org_shared", tenant_name: "Shared", eligible: true, endpoint: null }, { tenant_id: "org_other", tenant_name: "Other", eligible: true, endpoint: null }] }, consent: null, error: null });
   case "team_bridge.conversations.list": return reply({ conversations: fixture.empty ? [] : [{ ...conversation(), tenant_id: tenant }] });
   case "team_bridge.directory": return reply({ members: ["Peer", "Other peer"].map((name, index) => ({ account_id: `acct_peer_${index}`, display_label: name, role: "member", bridge_enabled: true, bridge_state: "active" })) });
   case "team_bridge.unread": return reply({ total: 0, organizations: [], conversations: [] });
   case "team_bridge.messages.list": return reply({ messages: fixture.messages.get(ownerKey) ?? [], has_more: false });
   case "team_bridge.conversations.create":
    if (fixture.createGate) await fixture.createGate.promise;
    return reply({ ...conversation(`created-${generation}`), tenant_id: tenant });
   case "team_bridge.messages.send":
    if (fixture.postGate) await fixture.postGate.promise;
    if (fixture.refuse) return { status: 503, body: { detail: "transport refused" } };
    fixture.messages.set(ownerKey, [{ id: `msg_${owner}`, conversation_id: request.conversation_id, seq: 1, sender: person(owner), body: request.body, origin: "human", created_at: now, client_ref: request.client_ref }]);
    return reply({ id: `msg_${owner}` });
   case "team_bridge.read": return reply({ conversation_id: request.conversation_id, last_read_seq: request.seq ?? 0, unread_count: 0, muted: false });
   default: return reply({});
  }
 } } };
 const host = document.createElement("div"); document.body.append(host);
 const root = createRoot(host);
 const client = new ui.QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 }, mutations: { retry: false, gcTime: 0 } } });
 const frames = [];
 const render = () => root.render(React.createElement(ui.QueryClientProvider, { client }, React.createElement(ui.MemoryRouter, { initialEntries: [empty ? "/team-bridge?tenant=org_shared" : "/team-bridge?tenant=org_shared&conversation=bcv_shared"] }, React.createElement(React.Profiler, {
  id: "owner-boundary",
  // A final DOM assertion misses an effect-only reset leaking for one commit.
  // The profiler observes every committed production tree before passive effects.
  onRender: () => {
   const status = client.getQueryData(ui.teamBridgeKeys.status);
   frames.push({ account: status?.account_id, tenant: status?.tenant_id, text: host.textContent, draft: host.querySelector("textarea")?.value ?? "" });
  },
 }, React.createElement(ui.TeamBridgePage)))));
 await act(async () => render());
 await until(() => empty ? host.textContent.includes("Peer") : host.querySelector("textarea"), "production container ready");
 return { host, fixture, client, frames, render,
  async changeOwner(boundary) {
   fixture.generation = "B";
   if (boundary === "account") fixture.account = "acct_b";
   if (boundary === "tenant") fixture.tenant = "org_other";
   if (boundary === "unresolved") {
    await act(async () => {
     client.getQueryCache().find({ queryKey: ui.teamBridgeKeys.status }).setState({ data: undefined, status: "pending", fetchStatus: "idle" });
     render();
    });
   } else {
    await act(async () => client.invalidateQueries({ queryKey: ui.teamBridgeKeys.status }));
   }
   await delay();
  },
  async close() { await act(async () => root.unmount()); client.clear(); host.remove(); },
 };
}
async function type(host,body) {const field=host.querySelector("textarea");assert.ok(field);await act(async()=>{Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,"value").set.call(field,body);field.dispatchEvent(new window.Event("input",{bubbles:true}));});}
async function send(host) {const button=[...host.querySelectorAll("button")].find(b=>["Send","Send message"].includes(b.getAttribute("aria-label")));assert.ok(button&&!button.disabled, JSON.stringify({buttons:[...host.querySelectorAll("button")].map(b=>[b.textContent,b.getAttribute("aria-label"),b.disabled]),field:host.querySelector("textarea")?.value,text:host.textContent}));await act(async()=>button.click());}
const sends = fixture => fixture.calls.filter(c=>c.op==="team_bridge.messages.send");

export async function mountPendingOwnerPage({ existing = false } = {}) {
 const app = await mount({ empty: !existing });
 const { host, fixture } = app;
 const composeGroup = async () => {
  if (!host.querySelector('input[role="combobox"]')) {
   const button = host.querySelector('button[aria-label="New message"]');
   assert.ok(button && !button.disabled, "real new-message control");
   await act(async () => button.click());
  }
  const field = host.querySelector('input[role="combobox"]');
  assert.ok(field, "real recipient picker");
  await act(async () => field.focus());
  // Preserve an already-addressed draft across the boundary. Reopening it
  // would hide the exact same-target ownership collision this test exercises.
  for (const name of ["Peer", "Other peer"]) {
   const option = [...host.querySelectorAll('[role="option"]')].find(node => node.textContent.endsWith(name));
   if (option) await act(async () => option.click());
  }
 };
 return {
  text: () => host.textContent,
  foreignFrames: (body) => app.frames.filter(frame =>
   (frame.account !== "acct_a" || frame.tenant !== "org_shared") &&
   (frame.text.includes(body) || frame.draft.includes(body))),
  posts: () => sends(fixture).map(call => ({ ...call, id: call.conversation_id, input: call })),
  creates: () => fixture.calls.filter(call => call.op === "team_bridge.conversations.create"),
  readCount: () => fixture.calls.filter(call => ["team_bridge.conversations.list", "team_bridge.messages.list", "team_bridge.unread"].includes(call.op)).length,
  selectedCreatedA: () => ui.teamBridgeViewingConversation() === "created-A",
  changeOwner: app.changeOwner,
  async setPermission(mode) {
   fixture.enabled = mode !== "off";
   fixture.readOnly = mode === "readonly";
   await act(async () => app.client.invalidateQueries({ queryKey: ui.teamBridgeKeys.status }));
   await delay();
  },
  async openChannel() {
   const button = host.querySelector('button[aria-label="Create a channel"]');
   assert.ok(button && !button.disabled);
   await act(async () => button.click());
   const field = document.querySelector('[role="dialog"] input');
   assert.ok(field);
   await act(async () => {
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set.call(field, "private-channel");
    field.dispatchEvent(new window.Event("input", { bubbles: true }));
   });
  },
  async submitChannelIfVisible() {
   const button = [...document.querySelectorAll('[role="dialog"] button')].find(node => node.textContent === "Create");
   if (button && !button.disabled) await act(async () => button.click());
   await delay();
  },
  async retryIfVisible() {
   const button = [...host.querySelectorAll("button")].find(node => node.textContent === "Retry");
   if (button && !button.disabled) await act(async () => button.click());
   await delay();
  },
  close: app.close,
  async sendPrivateGroup(body, mode) {
   fixture.refuse = mode === "failed";
   if (mode === "create") fixture.createGate = deferred();
   if (mode === "post") fixture.postGate = deferred();
   if (!existing) await composeGroup();
   const previousSends = sends(fixture).length;
   const previousCreates = fixture.calls.filter(call => call.op === "team_bridge.conversations.create").length;
   await type(host, body);
   await send(host);
   await until(() => mode === "create"
    ? fixture.calls.filter(call => call.op === "team_bridge.conversations.create").length > previousCreates
    : sends(fixture).length > previousSends, "production write dispatched");
   if (mode === "failed") await until(() => host.querySelector('[data-pending="failed"]'), "failed production row");
   await delay();
  },
  async release(phase) {
   const gate = fixture[`${phase}Gate`];
   assert.ok(gate, "expected held transport phase");
   fixture[`${phase}Gate`] = null;
   fixture.refuse = false;
   await act(async () => gate.resolve());
   await delay(); await delay(); await delay();
  },
  async rerender() { await act(async () => app.render()); await delay(); },
  async retry() {
   fixture.refuse = false;
   const button = [...host.querySelectorAll("button")].find(node => node.textContent === "Retry");
   assert.ok(button, "real failed-row retry");
   await act(async () => button.click());
   await until(() => sends(fixture).length === 2, "same-owner retry dispatch");
   await delay();
  },
 };
}

