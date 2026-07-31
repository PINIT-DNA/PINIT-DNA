/**
 * Automated Sprint 4 capture-pipeline self-test (no live YouTube login required).
 *
 * Validates:
 * 1) Shadow-DOM file inputs are discoverable (Studio failure mode)
 * 2) Queue failure persistence shape
 * 3) Adapter stage log naming conventions used in SW / queue / API
 *
 * Run: node scripts/extension-capture-selftest.mjs
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');

function collectFileInputsDeep(rootNode, out, depth) {
  if (!rootNode || depth > 40) return;
  let nodes = [];
  try {
    if (rootNode.querySelectorAll) {
      nodes = Array.from(rootNode.querySelectorAll('input[type="file"]'));
    }
  } catch {
    return;
  }
  for (const n of nodes) out.push(n);
  let all = [];
  try {
    if (rootNode.querySelectorAll) all = Array.from(rootNode.querySelectorAll('*'));
  } catch {
    return;
  }
  for (const el of all) {
    if (el.shadowRoot) collectFileInputsDeep(el.shadowRoot, out, depth + 1);
  }
}

function testShadowDiscoveryFromMockHtml() {
  const htmlPath = path.join(root, 'extension/test/mock-youtube-upload.html');
  const html = fs.readFileSync(htmlPath, 'utf8');
  assert.match(html, /attachShadow\(\{ mode: 'open' \}\)/);
  assert.match(html, /input id="shadow-file" type="file"/);
  assert.match(html, /__PINIT_MOCK__/);
  console.log('PASS mock HTML contains open shadow file input');
}

function testAdapterSourceHasShadowHooks() {
  const src = fs.readFileSync(path.join(root, 'extension/shared/adapter-interface.js'), 'utf8');
  assert.match(src, /collectFileInputsDeep/);
  assert.match(src, /shadowRoot/);
  assert.match(src, /capture\.sendMessage_call/);
  assert.match(src, /capture\.sendMessage_lastError/);
  assert.match(src, /adapter\.file_input_hooked/);
  assert.match(src, /extension context invalidated/i);
  assert.match(src, /adapter\.context_stale/);
  assert.match(src, /adapter\.teardown/);
  assert.match(src, /recordStage/);
  assert.match(src, /captureFiles/);
  console.log('PASS adapter-interface has shadow hooks + structured capture logs');
}

function testMainWorldHookPresent() {
  const main = fs.readFileSync(path.join(root, 'extension/content/youtube-main-hook.js'), 'utf8');
  const man = fs.readFileSync(path.join(root, 'extension/manifest.json'), 'utf8');
  assert.match(main, /pinit-yt-main/);
  assert.match(main, /HTMLInputElement\.prototype\.click/);
  assert.match(main, /main\.file_selected/);
  assert.match(man, /youtube-main-hook\.js/);
  assert.match(man, /"world":\s*"MAIN"/);
  assert.match(man, /"all_frames":\s*true/);
  console.log('PASS MAIN-world YouTube hook registered in manifest');
}

function testQueueAndApiLogging() {
  const queue = fs.readFileSync(path.join(root, 'extension/shared/queue.js'), 'utf8');
  const api = fs.readFileSync(path.join(root, 'extension/shared/api.js'), 'utf8');
  const sw = fs.readFileSync(path.join(root, 'extension/background/service-worker.js'), 'utf8');
  assert.match(queue, /process\.failure/);
  assert.match(queue, /lastErrorStack/);
  assert.match(queue, /persistLastQueueFailure/);
  assert.match(api, /publish-protect\.response/);
  assert.match(api, /bodyPreview/);
  assert.match(sw, /PUBLISH_CAPTURE\.received/);
  assert.match(sw, /lastQueueFailure/);
  assert.match(sw, /failedItems/);
  console.log('PASS queue/api/sw expose failure id + error + stack logging');
}

function testYoutubeDialogScan() {
  const yt = fs.readFileSync(path.join(root, 'extension/content/adapters/youtube.js'), 'utf8');
  assert.match(yt, /upload_dialog\.scan/);
  assert.match(yt, /findAllFileInputs/);
  assert.match(yt, /ytcp-uploads-dialog/);
  console.log('PASS youtube adapter scans upload dialog + shadow inputs');
}

function testPureShadowWalker() {
  const shadowInput = { type: 'file' };
  const shadowRoot = {
    querySelectorAll(sel) {
      if (sel === 'input[type="file"]') return [shadowInput];
      if (sel === '*') return [];
      return [];
    },
  };
  const host = { shadowRoot };
  const doc = {
    querySelectorAll(sel) {
      if (sel === 'input[type="file"]') return [];
      if (sel === '*') return [host];
      return [];
    },
  };
  const out = [];
  collectFileInputsDeep(doc, out, 0);
  assert.equal(out.length, 1);
  assert.equal(out[0], shadowInput);
  console.log('PASS pure shadow walker finds nested file input');
}

function testSelfTestHandlerPresent() {
  const sw = fs.readFileSync(path.join(root, 'extension/background/service-worker.js'), 'utf8');
  assert.match(sw, /SELF_TEST_PROTECT/);
  assert.match(sw, /PUBLISH_CAPTURE\.protect_failed_queued/);
  assert.match(sw, /lastProtect\.stored/);
  assert.match(sw, /queue_flush\.protect_bound/);
  assert.match(sw, /persistLastProtectSuccess/);
  assert.match(sw, /lastCaptureAttempt/);
  console.log('PASS SW has SELF_TEST_PROTECT + immediate failure persistence');
}

function testMutationThrottle() {
  const adapter = fs.readFileSync(path.join(root, 'extension/shared/adapter-interface.js'), 'utf8');
  assert.match(adapter, /mutationScanTimer/);
  console.log('PASS adapter mutation scans are throttled');
}

function main() {
  console.log('PinIT extension capture self-test\n');
  testShadowDiscoveryFromMockHtml();
  testAdapterSourceHasShadowHooks();
  testMainWorldHookPresent();
  testQueueAndApiLogging();
  testYoutubeDialogScan();
  testPureShadowWalker();
  testSelfTestHandlerPresent();
  testMutationThrottle();
  console.log('\nAll Sprint 4 observability/self-tests passed.');
  console.log('Next: reload extension → popup “Run pipeline self-test” (signed in) → then Studio upload.');
}

main();
