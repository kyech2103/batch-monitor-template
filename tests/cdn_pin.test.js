const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

// CDN 스크립트는 정확한 버전과 무결성 해시로 고정한다. '@2'처럼 떠 있는 태그는 CDN·패키지가 바뀌면 모든 PC에서 다른 코드가 돈다
const PAGES = ['index.html', ...['sub_batches', 'sub_toolroom', 'sub_packaging', 'sub_supplies', 'sub_warehouse'].map(d => `${d}/Index.html`)];

for (const page of PAGES) {
  test(`${page}: supabase-js 버전·무결성 고정`, () => {
    const html = fs.readFileSync(path.resolve(__dirname, '..', page), 'utf8');
    const tags = html.match(/<script[^>]*supabase-js[^>]*>/g) || [];
    assert.equal(tags.length, 1, 'supabase-js 스크립트가 하나여야 함');
    assert.match(tags[0], /supabase-js@\d+\.\d+\.\d+\//, `정확한 버전이 아님: ${tags[0]}`);
    assert.match(tags[0], /integrity="sha384-[A-Za-z0-9+/=]+"/, `무결성 해시 없음: ${tags[0]}`);
    assert.match(tags[0], /crossorigin="anonymous"/, `crossorigin 없음: ${tags[0]}`);
  });
}
