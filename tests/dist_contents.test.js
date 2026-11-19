// Vercel은 빌드 결과(dist)만 배포한다. 화면이 부르는 파일이 dist에 빠지면 배포본에서 조용히 깨지고,
// 문서·SQL·테스트가 dist에 들어가면 인터넷에 공개된다. 둘 다 여기서 막는다. run-tests.js가 먼저 빌드한다.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const DIST = path.join(__dirname, '..', 'dist');

test('dist의 화면이 부르는 로컬 파일은 모두 dist에 있다', () => {
  const pages = ['index.html', ...fs.readdirSync(DIST).filter(d => d.startsWith('sub_')).map(d => `${d}/Index.html`)];
  assert.ok(pages.length >= 6, `화면 수: ${pages}`);
  const missing = [];
  for (const p of pages) {
    const html = fs.readFileSync(path.join(DIST, p), 'utf8');
    for (const [, ref] of html.matchAll(/(?:src|href)="([^"#?]+)/g)) {
      if (/^[a-z]+:|^\/\//i.test(ref)) continue; // 외부 주소
      const file = ref.startsWith('/') ? path.join(DIST, ref) : path.join(DIST, path.dirname(p), ref);
      if (!fs.existsSync(file)) missing.push(`${p} → ${ref}`);
    }
  }
  for (const f of ['sw.js', 'icons/icon-192.png']) if (!fs.existsSync(path.join(DIST, f))) missing.push(f);
  assert.deepEqual(missing, []);
});

test('내부 문서·SQL·테스트·소스는 dist에 없다', () => {
  for (const secret of ['docs', 'supabase', 'tests', 'scripts', 'src', 'package.json', 'node_modules', 'README.md']) {
    assert.ok(!fs.existsSync(path.join(DIST, secret)), `${secret}가 배포된다`);
  }
  assert.ok(!fs.readdirSync(DIST).some(f => f.endsWith('.py')), '파이썬 파일이 배포된다');
});
