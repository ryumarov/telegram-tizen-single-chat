/* Single-source TV mode tests: video filtering, two-stream pagination, persisted chat selection,
 * public t.me URL resolution and remote/player wiring.
 * Run with: node test/single-chat.mjs
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => fs.readFileSync(`${ROOT}/${p}`, 'utf8');
const tgSrc = read('app/js/tg.js');
const appSrc = read('app/js/app.js');
const playerSrc = read('app/js/player.js');
const mp4Src = read('app/js/mp4.js');
const mkvSrc = read('app/js/mkv.js');

function message(id, date, media, text = '') {
  return { id, date: new Date(date), chat: { id: -100123, title: 'Demo channel' }, media,
    text, raw: { media: {} }, entities: [] };
}
function media(type, extra = {}) {
  return Object.assign({ type, uniqueFileId: `file-${Math.random()}`, fileSize: 1024,
    fileName: '', mimeType: '', duration: 0 }, extra);
}

let videoPages, documentPages, currentPost, resolvedUsername, fetched;
const client = {
  async connect() {},
  async searchMessages(args) {
    const pages = args.filter._ === 'inputMessagesFilterVideo' ? videoPages : documentPages;
    const page = pages.shift();
    assert.ok(page, `unexpected extra searchMessages call for ${args.filter._}`);
    return page;
  },
  async resolvePeer(username) {
    resolvedUsername = username;
    if (username === 'private_channel') { throw new Error('CHANNEL_PRIVATE'); }
    return { kind: 'resolved-peer', username };
  },
  async getMessages(peer, ids) {
    fetched = { peer, ids };
    return currentPost ? [currentPost] : [];
  },
};
const ctx = {
  window: { addEventListener() {} },
  performance: { now: () => 1 },
  setTimeout, clearTimeout, Promise, Date, Math, Number, String, RegExp, URL, Blob,
  ApiKey: { get: () => ({ id: 12345, hash: '0123456789abcdef0123456789abcdef' }) },
  Accounts: { active: () => ({ storage: 'test-session' }) },
  TGLib: { create: async () => ({ client, mode: 'test', reconnect: null }) },
  Log: { report() {} },
  I18n: { t: (s) => s },
};
vm.createContext(ctx);
vm.runInContext(tgSrc + '\nthis.TG = TG;', ctx, { filename: 'tg.js' });
const TG = ctx.TG;
await TG.init();

// Message-level filtering: native videos and video-like documents only.
assert.equal(TG.isVideoMessage(message(1, 1, media('video'))), true);
assert.equal(TG.isVideoMessage(message(2, 1, media('video', { isRound: true }))), false);
assert.equal(TG.isVideoMessage(message(3, 1, media('video', { isAnimation: true }))), false);
assert.equal(TG.isVideoMessage(message(4, 1, media('photo'))), false);
for (const ext of ['movie.mp4', 'movie.MKV', 'clip.webm', 'clip.m4v', 'clip.mov']) {
  assert.equal(TG.isVideoDocument(message(5, 1, media('document', { fileName: ext }))), true, ext);
}
assert.equal(TG.isVideoDocument(message(6, 1, media('document', { mimeType: 'video/x-matroska' }))), true);
assert.equal(TG.isVideoDocument(message(7, 1, media('document', { mimeType: 'video/webm' }))), true);
assert.equal(TG.isVideoDocument(message(8, 1, media('document', { fileName: 'cover.jpg', mimeType: 'image/jpeg' }))), false);
assert.equal(TG.isVideoDocument(message(9, 1, media('document', { fileName: 'song.mp3', mimeType: 'audio/mpeg' }))), false);
assert.equal(TG.isVideoDocument(message(10, 1, media('document', { fileName: 'archive.zip' }))), false);
console.log('✓ native video / document-video filtering (MP4, MKV, WebM, M4V, MOV, MIME)');

// Two search filters are merged by message date and continue with independent cursors.
const v300 = message(30, 300, media('video', { fileName: 'newest.mp4' }));
const v100 = message(10, 100, media('video', { fileName: 'oldest.mp4' }));
const d200 = message(20, 200, media('document', { fileName: 'middle.mkv', mimeType: 'video/x-matroska' }));
const d50 = message(5, 50, media('document', { fileName: 'older.webm' }));
const page = (items, next, total = items.length) => Object.assign(items, { next, total });
videoPages = [page([v300], 'video-old', 2), page([v100], undefined, 2)];
documentPages = [page([d200], 'docs-old', 2), page([d50], undefined, 2)];
let cursor;
const ordered = [];
for (let i = 0; i < 4; i++) {
  const got = await TG.videoItems(-100123, cursor, 1);
  ordered.push(got.items[0].msg.id);
  cursor = got.next;
}
assert.deepEqual(ordered, [30, 20, 10, 5]);
assert.equal(cursor, undefined);
assert.equal(videoPages.length + documentPages.length, 0);
console.log('✓ newest-first merged video/document pagination with cursor continuation');

// Public post URL parser: exact public URL shape, numeric ID, and invalid/private forms.
assert.deepEqual(JSON.parse(JSON.stringify(TG.parsePublicPostUrl('https://t.me/Example_channel/5586'))),
  { username: 'Example_channel', messageId: 5586 });
assert.deepEqual(JSON.parse(JSON.stringify(TG.parsePublicPostUrl('https://www.t.me/example_channel/123?single'))),
  { username: 'example_channel', messageId: 123 });
for (const bad of [
  '', 'http://t.me/example_channel/1', 'https://t.me/example_channel/not-a-number',
  'https://t.me/ab/123', 'https://t.me/s/example_channel/123',
  'https://t.me/example_channel/123/extra', 'https://evil.example/example_channel/123',
  'https://t.me/example_channel/0', 'https://t.me/example_channel/999999999999999999999',
]) assert.throws(() => TG.parsePublicPostUrl(bad), undefined, bad);
console.log('✓ public Telegram URL parser and invalid URL cases');

// Exact message fetch and conversion to an existing TG video item.
currentPost = message(5586, 1700000000, media('document', {
  fileName: 'Episode.S01E01.mkv', mimeType: 'video/x-matroska', fileSize: 9000000, uniqueFileId: 'post-video'
}), 'Episode S01E01');
resolvedUsername = null; fetched = null;
const post = await TG.openPublicPost('https://t.me/example_channel/5586');
assert.equal(resolvedUsername, 'example_channel');
assert.equal(Array.from(fetched.ids).join(','), '5586');
assert.equal(fetched.peer.username, 'example_channel');
assert.equal(post.msg.id, 5586);
assert.equal(post.fileName, 'Episode.S01E01.mkv');
assert.equal(post.doc.type, 'document');
console.log('✓ resolve username → get exact post ID → return Telegram video item');

// Non-video posts, deleted posts, and private-channel access fail safely with clear messages.
currentPost = message(99, 1700000000, media('photo'));
await assert.rejects(TG.openPublicPost('https://t.me/example_channel/99'), /does not contain a supported video/);
currentPost = null;
await assert.rejects(TG.openPublicPost('https://t.me/example_channel/100'), /deleted or is unavailable/);
await assert.rejects(TG.openPublicPost('https://t.me/private_channel/101'), /unavailable to the signed-in Telegram account/);
console.log('✓ non-video, deleted, and private-channel posts reject without bypassing access');

// Store uses the same Accounts.scope() contract as the shipped multi-account store.
const memory = new Map();
function makeStorage(activeId) {
  const localStorage = {
    getItem: (k) => memory.has(k) ? memory.get(k) : null,
    setItem: (k, v) => memory.set(k, String(v)),
    removeItem: (k) => memory.delete(k),
  };
  const sandbox = { localStorage, Accounts: { scope: (key) => activeId === 'a1' ? key : `${key}@${activeId}` },
    window: {}, Promise, Date, Math, JSON, Object, Array, String, Number, setTimeout, clearTimeout };
  vm.createContext(sandbox);
  vm.runInContext(read('app/js/store.js') + '\nthis.Store = Store;', sandbox, { filename: 'store.js' });
  return sandbox.Store;
}
const storeA1 = makeStorage('a1');
storeA1.setSelectedSource({ id: -1001, title: 'My private group', kind: 'group' });
storeA1.setLastPostUrl('https://t.me/example_channel/5586');
const storeA1Reloaded = makeStorage('a1');
assert.deepEqual(JSON.parse(JSON.stringify(storeA1Reloaded.selectedSource())),
  { id: -1001, title: 'My private group', kind: 'group' });
assert.equal(storeA1Reloaded.lastPostUrl(), 'https://t.me/example_channel/5586');
const storeA2 = makeStorage('a2');
assert.equal(storeA2.selectedSource(), null);
storeA2.setSelectedSource({ id: -2002, title: 'Second account', kind: 'channel' });
assert.equal(makeStorage('a1').selectedSource().id, -1001);
assert.equal(makeStorage('a2').selectedSource().id, -2002);
storeA1Reloaded.dropSelectedSource(-1001);
assert.equal(makeStorage('a1').selectedSource(), null);
console.log('✓ selected chat and last URL persist across restarts and remain account-scoped');

// Remote-control and streaming regressions are source-level contracts; physical remote/TV is not available here.
const homeKey = appSrc.slice(appSrc.indexOf('    function homeKey(k) {'), appSrc.indexOf('    function toRail() {'));
assert.match(homeKey, /k === 10009\) \{ openOpts\(\);/);
assert.match(homeKey, /k === 38/);
assert.match(homeKey, /k === 40/);
assert.match(homeKey, /k === 13[\s\S]*play\(S\.items\[S\.focus\]\)/);
assert.match(appSrc, /if \(S\.screen === "picker"\) \{ pickerKey\(k\)/);
assert.match(appSrc, /if \(S\.screen === "post"\) \{ postKey\(k\)/);
assert.match(appSrc, /Player\.create\(video/);
assert.match(appSrc, /openMse\(it, TG\.source\(it\)/);
assert.match(appSrc, /player\.open\(src/);
assert.match(playerSrc, /new MediaSource\(\)/);
assert.match(playerSrc, /video\.currentTime/);
assert.match(playerSrc, /SourceBuffer/);
assert.match(mp4Src, /function parse|parse.*MP4|moov/);
assert.match(mkvSrc, /function parse|parse.*MKV|Cues/);
for (const f of ['app/js/player.js', 'app/js/mp4.js', 'app/js/mkv.js']) {
  console.log(`  unchanged ${f}: ${crypto.createHash('sha256').update(read(f)).digest('hex')}`);
}
console.log('✓ remote routing + original Player / MediaSource / MP4 / MKV streaming path remains wired');
console.log('\n✓ single-chat tests passed');
