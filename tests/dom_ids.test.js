const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 마크업에는 없지만 스크립트에서 동적으로 생성하거나 레거시 폴백으로 참조하는 ID 허용 목록
const ALLOWLIST = {
  'index.html': [
    'floorplan-svg',        // 레거시 SVG 평면도 폴백 ID (dashboard-container || floorplan-svg)
    'layer-batch-icons',    // SVG 평면도 렌더링 레이어 ID
    'blueprint-container',  // 레거시 도면 컨테이너 폴백 ID (dashboard-container || blueprint-container)
    'floorplan-toast'       // 스크립트에서 동적 생성되는 토스트 알림 div ID
  ],
  // 선반·창고·배치 등록 새 창은 로그인 확인 가림막만 있고 화면은 React(src/)가 그린다
  'sub_toolroom/Index.html': [],
  'sub_supplies/Index.html': [],
  'sub_packaging/Index.html': [],
  'sub_warehouse/Index.html': [],
  'sub_batches/Index.html': []
};

function extractIds(htmlContent) {
  const markupIds = new Set();
  const idAttrRegex = /\bid=["']([a-zA-Z0-9_\-]+)["']/g;
  let m;
  while ((m = idAttrRegex.exec(htmlContent)) !== null) {
    markupIds.add(m[1].trim());
  }

  const scriptIds = new Set();
  const getElRegex = /getElementById\s*\(\s*['"]([a-zA-Z0-9_\-]+)['"]\s*\)/g;
  while ((m = getElRegex.exec(htmlContent)) !== null) {
    scriptIds.add(m[1].trim());
  }

  const qsRegex = /querySelector(?:All)?\s*\(\s*(['"])(.*?)\1\s*\)/g;
  while ((m = qsRegex.exec(htmlContent)) !== null) {
    const sel = m[2];
    const idMatches = sel.matchAll(/#([a-zA-Z0-9_\-]+)/g);
    for (const im of idMatches) {
      scriptIds.add(im[1].trim());
    }
  }

  return { markupIds, scriptIds };
}

function tsxFiles(dir = path.join(ROOT, 'src')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
    e.isDirectory() ? tsxFiles(path.join(dir, e.name)) : e.name.endsWith('.tsx') ? [fs.readFileSync(path.join(dir, e.name), 'utf8')] : []);
}

function findMissingIds(htmlContent, allowedList = []) {
  const { markupIds, scriptIds } = extractIds(htmlContent);
  const allowed = new Set(allowedList);
  return [...scriptIds].filter(id => !markupIds.has(id) && !allowed.has(id));
}

for (const [file, allowed] of Object.entries(ALLOWLIST)) {
  test(`DOM IDs: ${file} 스크립트 ID 참조가 마크업 또는 허용목록에 존재해야 함`, () => {
    const fullPath = path.join(ROOT, file);
    assert.equal(fs.existsSync(fullPath), true, `${file} 파일 존재`);
    const html = fs.readFileSync(fullPath, 'utf8');
    // 화면 스크립트를 파일로 옮겼으므로, 그 화면이 불러오는 앱 스크립트도 함께 검사한다
    const appScripts = [...html.matchAll(/<script[^>]*\bsrc="((?:\.\.\/)?js\/app\/[^"]+)"/g)]
      .map(m => fs.readFileSync(path.join(path.dirname(fullPath), m[1]), 'utf8'));
    // React 화면(src/**/*.tsx)이 그리는 요소도 마크업으로 친다
    const content = [html, ...appScripts].join('\n');
    const reactIds = file === 'index.html' ? extractIds(tsxFiles().join('\n')).markupIds : new Set();
    const missing = findMissingIds(content, allowed).filter(id => !reactIds.has(id));
    assert.deepEqual(missing, [], `${file}에 존재하지 않는 DOM ID 참조: ${missing.join(', ')}`);
  });
}

module.exports = { extractIds, findMissingIds, ALLOWLIST };
