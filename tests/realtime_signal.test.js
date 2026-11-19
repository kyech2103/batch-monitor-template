const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const BATCH_FORM = 'src/batches/BatchForm.tsx';

// 실시간 방송 채널은 공개 키만 있으면 누구나 듣고 보낼 수 있다.
// 그래서 브로드캐스트에는 데이터를 싣지 않고, 받은 쪽도 내용(payload.payload)을 쓰지 않는다.
const FILES = ['src/batch/sync.ts', BATCH_FORM, 'src/rooms/store.ts'];

for (const f of FILES) {
  const src = fs.readFileSync(path.resolve(__dirname, '..', f), 'utf8');

  test(`${f}: 브로드캐스트에 데이터를 싣지 않음`, () => {
    const sends = [...src.matchAll(/type:\s*'broadcast'[\s\S]*?payload:\s*(\{\s*\}|[^\s,}]+)/g)].map(m => m[1].trim());
    assert.ok(sends.length > 0, '브로드캐스트 전송이 있어야 함');
    for (const p of sends) assert.equal(p, '{}', `데이터를 실어 보냄: payload: ${p}`);
  });

  test(`${f}: 받은 브로드캐스트 내용을 쓰지 않음`, () => {
    assert.ok(!/payload\.payload/.test(src), 'payload.payload를 읽음');
  });

}

const ROOT = path.resolve(__dirname, '..');
const ALL_JS = [
  ...fs.readdirSync(path.join(ROOT, 'js')).filter(n => n.endsWith('.js')).map(n => `js/${n}`),
  ...fs.readdirSync(path.join(ROOT, 'src'), { recursive: true }).filter(n => /\.tsx?$/.test(n)).map(n => `src/${n.replace(/\\/g, '/')}`)
];
// 화면 사이 메시지(iframe)는 없앴다. 다시 생기면 다른 주소에서 온 것은 버려야 한다
test('postMessage 수신이 있으면 다른 주소의 메시지를 버림', () => {
  for (const f of ALL_JS) {
    const src = fs.readFileSync(path.join(ROOT, f), 'utf8');
    for (const m of src.matchAll(/addEventListener\('message'[^\n]*\n([^\n]*\n){0,3}/g)) {
      // 처리 함수를 이름으로 넘겼으면 그 함수의 첫 줄들을 본다
      const name = m[0].match(/addEventListener\('message', (\w+)\)/)?.[1];
      const body = name ? (src.match(new RegExp(`${name} = \\([^)]*\\) => \\{\\r?\\n([^\\n]*\\n){0,3}`)) || [''])[0] : m[0];
      assert.match(body, /e\.origin !== location\.origin/, `${f}: ${m[0]}`);
    }
  }
});
