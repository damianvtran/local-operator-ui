# Agent-tab passkey prompts under user custody — evidence

`fixture.html` is a synthetic relying party (RP id = the page's host, served from
`http://localhost:<port>` with `python3 -m http.server`). It prints, every 500 ms,
how `navigator.credentials.get` is wired in the page (instance accessor vs the
prototype, whether the app's passkey shim marker is present, which custom elements
an extension inserted) and logs each `get()`/`create()` call and its outcome.

## Before (installed 0.54.1, 1Password 8.12.44.33, agent-driven tab)

Driven with the harness browser in a tab an agent owns:

```
instance own get: undefined/accessor
navigator.credentials.get === proto.get: false
instance get src: async function L(e){return await q(e?.publicKey?.hints)?H(e):d.credentials.get(e
lop marker: true
custom elements w/ shadow: com-1password-notification   (after create())
16:55:26.709 get() called
16:55:26.775 get() REJECTED NotAllowedError             (1Password had nothing for the RP: native path)
16:55:47.458 create() called                            (1Password's notification element inserted;
                                                         its chrome-extension:// frame refused)
```

`before-agent-tab-installed-0.54.1.png` is that page. The `create()` later
resolved (16:55:54Z) — a prompt outside the page was answered on the operator's
machine; no further `create()` was made against the operator's profile.

The app's own `logs` for the tab showed only `local-operator:passkey-pending:<nonce>:get:not-allowed`:
1Password's accessor serves the request it takes without calling the prototype the
app's shim wraps, which is why custody is decided from the frame navigation in main.
