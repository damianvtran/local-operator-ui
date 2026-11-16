# Updater cause evidence

Source head: 67b04b674adf16b249848c8aa9c0895992b4bcb9. Remote agent 213b authored the change; the Mac coordinator transported it and executed the evidence. This is hybrid evidence, not a wholly remote proof.

The before image is the user-provided incident screenshot, not a new same-viewport capture. The two after images are actual browser-tool captures, opened and inspected, of the shipped React component in Storybook with its existing stub updater and real stylesheet/theme providers. No installer or native app was launched; no native glass proof is claimed.

For the successful scoped setup, the exact files under rig/ were placed at .storybook-local/ in the source worktree. They inherit the repository configuration and actual preview, selecting the single updater story file with prop-doc extraction disabled. Before launch both files were syntax-parsed; the installed builder root was derived as the parent of configDir and asserted to be the worktree root, and the stylesheet imports and selected story were checked.

Historical command: STORYBOOK_CACHE_PRUNE=off NODE_OPTIONS=--max-old-space-size=1024 node_modules/.bin/storybook dev -c .storybook-local --host 127.0.0.1 --port 6019 --ci --no-open --exact-port

The command had an enforced whole-process-group 2 GiB ceiling and a mechanical timeout before the allocated hard deadline; Node heap size was not the memory guard. The browser used iframe.html?id=common-updatenotification--backend-update-failed-unknown&viewMode=story with args theme:localOperatorLight or localOperatorDark;locale:en;glass:off. It was closed and the server was reaped. The earlier invalid/failed setup attempts are disclosed in evidence.json and are not visual passes.

These are receipts, not authorization to restart the exhausted visual lane. A fresh run needs the current coordinator/QA-host allocation. Long-token layout was not rendered; ordinary wrapping was measured, and independent QA must assess possible overflow. The fixture/tree tests are not pixel evidence. The capacity reproduction touched only fresh synthetic roots, not the live record namespace.
