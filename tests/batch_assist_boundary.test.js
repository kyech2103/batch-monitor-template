// AI 입력 기능은 자기 폴더 안에만 있다. 기존 코드가 이 기능을 언급하면 실패한다 (키 해지 때 폴더만 지우면 되도록).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const MENTION = /batch[_-]?assist|ai_input|AI 입력/i;
const SOURCE = /\.(html|js|mjs|ts|css|py)$/;
const SKIP_DIRS = new Set(['node_modules', 'dist', 'graphify-out', '__pycache__']);
const OWNED = ['js/ai_input/', 'supabase/functions/batch-assist/', 'tests/batch_assist_', 'tests/fixtures/batch_assist/', 'tests/e2e/qa_runner_batch_assist.py'];
// 기존 파일에 허용하는 단 하나의 연결 지점. 이 글자를 지우면 기능이 빠진다
const HOOKS = {
  'index.html': '<!-- AI 입력 기능(지우려면 README "AI 입력 기능 빼기" 참고) -->\n<script src="js/ai_input/core.js"></script>\n<script src="js/ai_input/ui.js"></script>\n',
  'scripts/run-tests.js': ", 'qa_runner_batch_assist.py'"
};

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    if (e.isDirectory()) return e.name.startsWith('.') || SKIP_DIRS.has(e.name) ? [] : walk(path.join(dir, e.name));
    return SOURCE.test(e.name) ? [path.relative(ROOT, path.join(dir, e.name)).replace(/\\/g, '/')] : [];
  });
}

function offenders(files, read) {
  return files.filter(f => !OWNED.some(o => f.startsWith(o))).filter(f => {
    let text = read(f).replace(/\r\n/g, '\n');
    if (HOOKS[f]) {
      assert.equal(text.split(HOOKS[f]).length, 2, `${f}에 AI 입력 연결 지점이 정확히 한 번 있어야 함`);
      text = text.replace(HOOKS[f], '');
    }
    return MENTION.test(text);
  });
}

const readRepo = f => fs.readFileSync(path.join(ROOT, f), 'utf8');

test('경계: 기존 코드는 AI 입력 기능을 언급하지 않는다 (index.html 표시 블록, E2E_RUNNERS 한 줄만 예외)', () => {
  assert.deepEqual(offenders(walk(ROOT), readRepo), []);
});

test('경계 검사가 실제로 잡는다: 기존 파일에 언급을 넣거나 연결 지점을 두 번 넣으면 실패', () => {
  const planted = f => (f === 'src/mobile/card.ts' ? `${readRepo(f)}\n// openBatchAssist` : readRepo(f));
  assert.deepEqual(offenders(walk(ROOT), planted), ['src/mobile/card.ts']);
  const doubled = f => (f === 'index.html' ? readRepo(f) + HOOKS[f] : readRepo(f));
  assert.throws(() => offenders(walk(ROOT), doubled), /정확히 한 번/);
});
