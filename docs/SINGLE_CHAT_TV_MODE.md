# Single-chat Telegram video mode

This change narrows the normal TV viewing interface to one Telegram group or channel. The selected source is stored
per Telegram account and reopened directly after app restarts. The settings screen provides a source picker and a
public Telegram post URL input.

## Behaviour

- First launch after login: choose one group or channel with Up / Down and OK.
- Later launches: open the saved source directly. The source is not replaced by other chats, search results or links.
- Main list: Telegram video messages and document messages recognized as video by filename extension or MIME type;
  newest first, 40 at a time, with older pages loaded as the focus approaches the end.
- Titles: show the Telegram caption title or complete document filename; long values wrap instead of being cut to a
  short fixed title.
- Remote: Up / Down moves the list, OK plays, Back opens Settings. In the player the existing remote controls remain
  in place; Back returns to the selected source list.
- Settings: "Change selected chat / channel" reopens the picker; "Open Telegram post URL" opens an input for
  `https://t.me/channel_username/message_id`.
- Public post: resolve the public username through the existing authenticated mtcute client, fetch the exact message
  ID, validate its media, then hand the returned item to the existing player. Deleted, inaccessible, invalid and
  non-video posts produce a message and return to the list. This does not grant access to private channels.

Selection and last-entered post URL use the account-scoped `Accounts.scope()` storage and are removed when that
account is removed. The selected source key migrates from the previous `lastSource` value on upgrade.

## Streaming preservation

Telegram video playback remains on the existing path:

`app.js play() -> TG.source(item) -> Player.create() / player.open() -> MediaSource`

`app/js/player.js`, `app/js/mp4.js` and `app/js/mkv.js` are unchanged. Telegram chunk/range fetching, throttling,
back-pressure, seeking, file-reference refresh, audio-track selection and subtitle handling remain in the original
implementation. Public post playback feeds the resolved Telegram message into this same path; it is not converted to
an HTTP video URL and is not downloaded as a whole file first.

## Tests run in the development container

Passed:

- `node --check` for every `app/js/*.js` file (excluding generated `tg.bundle.js` / `tg.legacy.js`, which are not in
  the source archive).
- `node test/single-chat.mjs` — video/document filtering, supported filename/MIME classes, merged newest-first
  pagination, URL parsing, exact message lookup, non-video/deleted/private errors, account-scoped persistence, and
  static checks that the player streaming files and call path remain unchanged.
- `node test/i18n.mjs`
- `node tools/update-verify.mjs`
- `node tools/diag-verify.mjs`
- `node test/check.mjs`
- `node test/check-flac.mjs`
- `node test/check-mkv.mjs`

Not completed in this container:

- `tools/syntax-verify.mjs`, `test/compat.mjs` and `test/legacy-bigint.mjs` need npm packages (`acorn` / `jsbi`) that
  are not installed. The npm registry could not be resolved from this environment, and its npm cache has no copies.
- `test/apikey.mjs`, `test/weblist.mjs` and `test/worker-expire.mjs` need `playwright-core`, which is not installed.
- `test/check-subs.mjs` passed its standalone subtitle parsing checks but stopped when the archive's omitted
  `test/media/a_h264_fast.mp4` fixture was needed for MP4-internal subtitle tests. `test/skew.mjs` requires explicit
  source and destination media paths and was not run without those fixtures.
- No live Telegram account, Samsung TV, remote or playback session was available. The mocked API tests do not claim
  to prove live Telegram or TV playback.

## Build a signed WGT

The provided source ZIP has no `.git` directory, and the existing `tools/release.sh` deliberately packages a clean
Git `HEAD` (`git archive HEAD app`). In addition, a working release environment needs macOS/zsh, Node/npm, the
Tizen Studio CLI (`tizen` and `sdb`), a release signing profile, and the Telegram API ID/hash in a private config.

On a configured macOS machine, after extracting this source project:

```sh
cd telegram-tizen-master
# release.sh packages the committed HEAD, not uncommitted working-tree files
git init
git add .
git commit -m "Import Telegram Tizen single-chat video mode"

# Keep these values outside the repository, in ~/.telegram-tizen.conf:
# TG_API_ID=your_numeric_api_id
# TG_API_HASH=your_32_character_api_hash

# Install the locked build dependencies, then run the project's actual signer/packager:
rm -rf build/node_modules
npm ci --prefix build --no-audit --no-fund
zsh tools/release.sh
```

The release script creates `dist/telegram-tizen-1.2.9.wgt`, signs it with its configured `BiliRelease` profile,
checks the package contents and signatures, and rejects uncommitted changes to the app/build inputs. Do not put API
credentials, certificates, Telegram sessions or machine-specific settings in the source archive or Git repository.

## Install with Apps2Samsung

1. On the TV, open **Apps**, enter `12345` on the remote, turn **Developer Mode** on, set **Host PC IP** to the
   computer/phone running Apps2Samsung, confirm, then restart/power-cycle the TV.
2. Install and open Apps2Samsung on a computer or Android phone connected to the same network as the TV.
3. Select the TV (or add it by IP), choose **Custom WGT File** / **Install a file**, select the generated
   `telegram-tizen-1.2.9.wgt`, and press **Install**. Apps2Samsung handles the TV signing/install step; the first
   install may ask you to sign in to your Samsung account to create its TV certificate.
4. Launch **TG Video** from the TV's Apps screen and scan the QR code with Telegram → **Settings → Devices → Link
   Desktop Device**. The existing session/2-step verification flow is retained.

The precise menu wording can vary by Apps2Samsung build. Its current documentation explicitly supports installing
your own `.wgt` / `.tpk` file.
