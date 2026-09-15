/**
 * The Chrome keychain switch, applied to every headless Chrome this repo's
 * capture, geometry and proof rigs launch.
 *
 * WHY THIS EXISTS. On 2026-09-15 a modal alert kept appearing on the
 * operator's screen while agents worked these rigs: **"Keychain Not Found — A
 * keychain cannot be found to store "Chrome.""**, with Chrome's icon and
 * `Cancel` / `Reset To Defaults` buttons. An alert raised by the OS on behalf
 * of a test run is a defect in the SUITE, exactly as the 46 Notification
 * Center banners were (see `notifications-off.mjs`), and this is the same
 * class: the rig asks the operator's desktop for something it has no business
 * asking for, and it cannot be seen from inside the repository.
 *
 * THE MECHANISM. Every rig below launches a private headless Chrome with a
 * scratch `--user-data-dir` under the system temp dir. Runs are routinely
 * invoked - by agents on a shared machine, and by anyone who wants a run kept
 * out of their own state - with `HOME` AND `TMPDIR` redirected to a scratch
 * directory. The rigs inherit that environment; nothing in this repo sets it.
 * macOS resolves the keychain from the process's `HOME`, so in that environment
 * there is no login keychain at all. Measured:
 *
 *     HOME=/tmp/scratch security default-keychain
 *       security: SecKeychainCopyDefault: A default keychain could not be found.
 *     HOME=/tmp/scratch security list-keychains
 *       "/Library/Keychains/System.keychain"      # no login keychain to write
 *     security default-keychain                   # the operator's own shell
 *       "/Users/damian/Library/Keychains/login.keychain-db"
 *
 * Chrome encrypts its cookie and password stores through OSCrypt, whose macOS
 * key comes out of the keychain, so in that environment it cannot encrypt. The
 * three symptoms, all measured on the rigs' own Chrome argv with a scratch
 * `HOME`, over CDP:
 *
 *   - Chrome's stderr carried
 *     `ERROR:components/password_manager/core/browser/password_store/login_database_async_helper.cc:99]
 *     Encryption is not available.` - so the rig's cookie store is silently
 *     DEAD: `Network.setCookie` answered `{"success": true}` while the
 *     profile's `Default/Cookies` took no row at all, and a rig that measures
 *     anything cookie-shaped measures nothing.
 *   - macOS logged `authd … Failed to authorize right
 *     'system.keychain.create.loginkc' by client '/Applications/Google
 *     Chrome.app' for authorization created by '/Applications/Google
 *     Chrome.app'` - Chrome, finding no login keychain, trying to CREATE one.
 *     That authorization is the alert on screen.
 *   - Two such denials two minutes apart (17:29:36 and 17:31:42, from two
 *     sessions' rigs), inside a window the same log shows five Chrome processes
 *     reaching the Security framework in (17:27:40-17:29:36), is why it "kept
 *     popping up" rather than appearing once.
 *
 * THE SWITCH. `--use-mock-keychain` makes Chromium's `KeychainPassword` return
 * a constant mock password instead of calling Keychain Services, so OSCrypt
 * never touches the operator's keychain wherever `HOME` points. Measured on the
 * same argv with it: no `Encryption is not available`, no `create.loginkc`
 * authorization request, and the cookie `Network.setCookie` wrote is on disk as
 * a 67-byte value with OSCrypt's `v10` prefix - the rig keeps working cookies;
 * it encrypts them with the mock key.
 *
 * WHY NOT THE ALTERNATIVES.
 *
 *  - *Stop redirecting `HOME`.* The redirect arrives in the inherited
 *    environment, and it is the right thing to want: a rig must not write into
 *    the operator's own config and session store. A rig that only works when
 *    handed the operator's real `HOME` is broken in the shape agents actually
 *    run it. And even with the real `HOME`, a capture rig writing a "Chrome
 *    Safe Storage" item into that login keychain is a test suite writing into
 *    the operator's personal credential store; the switch removes that too,
 *    which is why it is applied unconditionally rather than only when `HOME`
 *    looks redirected.
 *  - *Give the scratch `HOME` a keychain of its own.* `security
 *    create-keychain` asks the operator to authorize creating it. Replacing one
 *    unexplained OS prompt from a test run with another is not a fix.
 *
 * WHAT DELIBERATELY DOES NOT COME THROUGH HERE. `scripts/
 * session-cookie-restart-proof.mjs` symlinks the scratch `HOME`'s
 * `Library/Keychains` at the real one, and `scripts/session-cookie-electron.
 * test.mjs` deliberately does not override `HOME` at all, because both boot the
 * PRODUCT to exercise Electron's own `safeStorage` path: that the vault key
 * round-trips through Keychain Services is what they are proving, so reaching
 * the keychain is their subject rather than collateral. Those are app launches
 * rather than Chrome launches, they are named as such in the test beside this
 * file, and this helper does not touch them.
 *
 * EVERY SITE IS ENUMERATED RATHER THAN REMEMBERED.
 * `scripts/chrome-keychain.test.mjs` scans `scripts/`, `bin/` and each
 * `docs/evidence/<surface>/harness/` for the calls that start Chrome and fails on one
 * whose argv does not come through `withMockKeychain`, because the rig somebody
 * adds next month is exactly the one that would forget this line.
 *
 * The Linux analogue is `--password-store=basic`. Nothing here runs Chrome off
 * macOS - every rig hardcodes the macOS bundle path, `diff-body-evidence.mjs`'s
 * `CHROME_PATH` override included - so the switch is not spelled for a platform
 * no rig uses.
 */

/**
 * The switch, spelled once.
 *
 * Callers take the string from here rather than restating it: a rig that typed
 * `--use-mock-keychain` by hand would drift the day the switch it needs is
 * something else, and the scan in `chrome-keychain.test.mjs` asserts this
 * spelling appears in exactly this module.
 */
export const MOCK_KEYCHAIN_SWITCH = "--use-mock-keychain";

/**
 * `args` with the mock-keychain switch appended, for a Chrome about to be
 * spawned.
 *
 * Returns the SAME array, so a call site can wrap its literal inline:
 *
 *     spawn(CHROME, withMockKeychain([
 *         "--headless=new",
 *         `--user-data-dir=${dataDir}`,
 *         "about:blank",
 *     ]));
 *
 * Idempotent, so a rig that has its own reason to name the switch can do so
 * without it arriving twice - Chromium would accept the repeat, but a rig whose
 * argv says the same thing twice is one nobody can read.
 */
export function withMockKeychain(args) {
	if (!args.includes(MOCK_KEYCHAIN_SWITCH)) args.push(MOCK_KEYCHAIN_SWITCH);
	return args;
}
