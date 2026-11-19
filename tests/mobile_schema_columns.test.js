const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

function extractSchemaColumns() {
  const tableColumns = {
    batches: new Set(['id', 'data', 'updated_at'])
  };

  ['schema.sql'].forEach(file => {
    const filePath = path.join(ROOT, 'supabase', file);
    const content = fs.readFileSync(filePath, 'utf8');

    // Parse CREATE TABLE statements
    const createRegex = /CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?(?:public\.)?([a-zA-Z0-9_]+)\s*\(([\s\S]*?)\);/gi;
    let match;
    while ((match = createRegex.exec(content)) !== null) {
      const tableName = match[1].toLowerCase();
      const body = match[2];
      if (!tableColumns[tableName]) tableColumns[tableName] = new Set();

      const lines = body.split('\n');
      lines.forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('--') || trimmed.toUpperCase().startsWith('CONSTRAINT') || trimmed.toUpperCase().startsWith('PRIMARY') || trimmed.toUpperCase().startsWith('UNIQUE') || trimmed.toUpperCase().startsWith('CHECK')) {
          return;
        }
        const colMatch = trimmed.match(/^([a-zA-Z0-9_]+)\s+[a-zA-Z0-9_]+/);
        if (colMatch) {
          const colName = colMatch[1].toLowerCase();
          tableColumns[tableName].add(colName);
        }
      });
    }
  });

  return tableColumns;
}

function extractJsQueries(jsContent) {
  const operations = [];
  // Match .from('tableName').... chains
  // A query starts with .from('table')
  const fromRegex = /\.from\s*\(\s*['"]([a-zA-Z0-9_]+)['"]\s*\)([\s\S]*?)(?=(?:\.from\s*\(|(?:\r?\n\s*\r?\n)|function|const|let|var|return\s+sb|return\s+\w|\bawait\s+sb|\bawait\s+bridge|$))/g;
  let fromMatch;
  while ((fromMatch = fromRegex.exec(jsContent)) !== null) {
    const table = fromMatch[1];
    const chain = fromMatch[2];

    // .select('...')
    const selectMatches = chain.matchAll(/\.select\s*\(\s*['"]([^'"]+)['"]\s*\)/g);
    for (const sm of selectMatches) {
      sm[1].split(',').map(s => s.trim()).forEach(col => {
        if (col && col !== '*') operations.push({ table, col, op: 'select' });
      });
    }

    // .eq/.neq/.order/.in/.gte/.lte('col', ...)
    const filterMatches = chain.matchAll(/\.(?:eq|neq|order|in|gte|lte)\s*\(\s*['"]([a-zA-Z0-9_]+)['"]/g);
    for (const fm of filterMatches) {
      operations.push({ table, col: fm[1], op: 'filter' });
    }
  }

  return operations;
}

function validateJsColumns(jsFiles, schema) {
  const violations = [];
  jsFiles.forEach(file => {
    const fullPath = path.join(ROOT, file);
    if (!fs.existsSync(fullPath)) return;
    const content = fs.readFileSync(fullPath, 'utf8');
    const ops = extractJsQueries(content);
    ops.forEach(op => {
      const tableSchema = schema[op.table];
      if (!tableSchema) {
        violations.push({ file, ...op, reason: `Unknown table ${op.table}` });
      } else if (!tableSchema.has(op.col.toLowerCase())) {
        violations.push({ file, ...op, reason: `Column ${op.col} does not exist in table ${op.table}` });
      }
    });
  });
  return violations;
}

test('AC-1: mobile_*.js 파일의 조회/저장 열이 모두 스키마 SQL에 존재함', () => {
  const schema = extractSchemaColumns();
  assert.ok(schema.todo_schedules && schema.todo_schedules.has('target_time'), 'todo_schedules 스키마 파싱 확인');
  assert.ok(schema.equipment_jobs && schema.equipment_jobs.has('start_code'), 'equipment_jobs 스키마 파싱 확인');
  assert.ok(schema.batches && schema.batches.has('data'), 'batches 스키마 파싱 확인');

  const mobileFiles = fs.readdirSync(path.join(ROOT, 'js'))
    .filter(f => f.startsWith('mobile_') && f.endsWith('.js'))
    .map(f => 'js/' + f);

  const violations = validateJsColumns(mobileFiles, schema);
  assert.deepEqual(violations, [], `스키마에 없는 열 참조 발견: ${JSON.stringify(violations)}`);
});

test('AC-1 음성 케이스: task_time 열을 조회/정렬할 경우 유효성 검사 실패', () => {
  const schema = extractSchemaColumns();
  const fakeJsContent = `
    sb.from('todo_schedules').select('*').order('task_time', { ascending: true });
  `;
  const ops = extractJsQueries(fakeJsContent);
  const violations = [];
  ops.forEach(op => {
    const tableSchema = schema[op.table];
    if (!tableSchema || !tableSchema.has(op.col.toLowerCase())) {
      violations.push(op);
    }
  });

  assert.equal(violations.length, 1);
  assert.equal(violations[0].col, 'task_time');
  assert.equal(violations[0].table, 'todo_schedules');
});
