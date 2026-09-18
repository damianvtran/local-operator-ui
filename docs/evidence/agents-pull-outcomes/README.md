# Pulling from the hub: four outcomes, told apart

The pull's only visible surface is a toast plus the navigation that follows it,
and every outcome used to read the same way: the mutation's own words ("Agent
downloaded") over the name the user REQUESTED. Two of those outcomes are not
clean successes, and one is a refusal whose reason was hidden behind a transport
prefix — contract §0.2 D-4 and §3.6:

- **A pulled agent can land under a name this machine already holds.**
  `import_agent` skips the registry's name check, and the local lookup is exact
  and case-sensitive, so `Coder` beside `coder` is legal and the profile resolver
  then picks one of them arbitrarily. The backend's own fix is on `main` now
  (`resolve_import_name`, `local_operator/agents.py`): it imports as
  `"<name>-2"` — a HYPHEN, not the `" (N)"` spelling an earlier revision of the
  contract used, because that spelling carries a space the hub's name rule
  refuses and would hand the user an agent the hub will not take — and returns
  `renamed_from`. The renderer behaves honestly in BOTH states: `adjusted-name/`
  is that fix's shape, and `already-held/` is an older backend that renames
  nothing, where the hook can see the name is now held twice and says so instead
  of reporting a clean success.
- **A refusal arrived as transport prose.** `Download agent from Radient failed:
  Error downloading agent from Radient: …` names the route it came from and
  repeats itself, and one layer deeper the hub proxy adds the listing's id and
  the Python client's own exception repr. Stripping those is not enough on its
  own — what they wrap is still machinery — so the residue is CLASSIFIED: a
  `requests` read timeout is the retryable case and gets the `hub_unavailable`
  sentence, and a 404 the hub answered with gets the `agent_not_found` one.

## What produced these frames

Storybook built from this tree, through the repo's own capturer, all twelve
themes, one narrowed (append-mode) pass, on port 6041:

```
node scripts/capture-evidence.mjs http://localhost:6041 --only=agents-pull-outcomes
```

This worktree's `.env` points `VITE_LOCAL_OPERATOR_API_URL` at a dead port on
purpose, so the run needs no `--allow-backend` and no frame can quote a live
backend. Each story mounts the SHIPPED `useDownloadAgentMutation` — the real
hook, the real `AgentsApi`, the real toast manager — over a stubbed desktop
transport that answers the `legacy.agent.download` op, and `toastDuration:
Infinity` holds the toast open because an auto-closed toast is a frame that
cannot be reproduced. That mechanism and the reason it exists are
`scripts/toast-lifetime.test.mjs`'s.

## The frames

| Frame | What it is |
|---|---|
| `downloaded/` | The clean case: the agent arrived under the hub's own name. |
| `adjusted-name/` | The backend renamed it (`renamed_from`): the row landed as `Inbox triage-2`, and the receipt quotes the name the pulled one collided with. |
| `already-held/` | The same situation on a backend older than the fix: the row landed beside a name this machine already holds, and the warning says two agents now answer to that name. |
| `refused/` | A refusal with a code (`agent_not_found`): the listing is gone, nothing was downloaded, and nothing is worth retrying. |
| `refused-prose/` | An older backend's single prose refusal, with the transport's wrappers stripped AND the residue classified: a read timeout is a retryable fault, so it reads as one. |

## What these frames do NOT prove

- **The navigation.** On success the app routes to the created row's id
  (`/chat/<id>`), which is what makes the toast and the page agree; a still cannot
  show a route change, and the end-to-end run in the pull request is where the
  created row is shown (two rows named `ok-agent` after two pulls of one listing).
- **That the hub produces `renamed_from`.** It is the agreed backend contract
  (§3.6) and it IS implemented on `main` — `resolve_import_name` in
  `local_operator/agents.py`, measured against backend `main` at 0.56.13: two
  pulls of one listing return `{"name":"Twitter","renamed_from":null}` then
  `{"name":"Twitter-2","renamed_from":"Twitter"}` — so `adjusted-name/` records
  the shape the backend ships. It is still a fixture of the STUB rather than a
  frame of the app talking to that backend, which is what the end-to-end run in
  the pull request shows; the second, cache-based arm exists for a backend older
  than the fix.
- **That the cache arm fires in the app.** These stories seed the React Query
  cache the same way a loaded agents list does, but whether the list is loaded
  when a user clicks Download depends on which surfaces they have visited; the
  hook reads the cache and reports nothing when it is empty, by design.
- **Nothing about ordering, stacking or lifetime** of the toasts, which
  `scripts/toast-lifetime.test.mjs` owns.
