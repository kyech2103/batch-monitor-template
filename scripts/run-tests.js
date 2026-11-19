// 단위 테스트와 E2E 러너를 동시에 돌리고 결과를 test-output.log로 남긴다.
// 사용법: node scripts/run-tests.js --run run-YYYYMMDD-HHMMSS [--only unit,timeline] [--failed] [--jobs 4]
//   --run    : 결과를 임시 폴더의 agent-runs/<run>/에 저장 (없으면 환경변수 AGENT_RUN_ID, 그것도 없으면 화면에만 출력)
//   --only   : 이름에 이 글자가 들어간 묶음만 실행 (쉼표로 여러 개)
//   --failed : 같은 run에서 마지막으로 실패한 묶음만 다시 실행
//   --jobs   : 동시에 돌릴 묶음 수 (기본: CPU 수 - 1, 최대 4)
// 전체 실행만 test-output.log를 쓴다. --only/--failed 실행은 test-output.partial.log에 쓴다.
const { spawn, spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');

// 새 E2E 러너(tests/e2e/)를 만들면 여기에 추가한다.
const E2E_RUNNERS = ['qa_runner_todo_rules.py', 'qa_runner_main_board.py', 'qa_runner_timeline.py', 'qa_runner_process_names.py', 'qa_runner_process_colors.py', 'qa_runner_popup_layout.py', 'qa_runner_push.py', 'qa_runner_mobile.py', 'qa_runner_mobile_edit.py', 'qa_runner_worker_admin.py', 'qa_runner_shelf_parity.py', 'qa_runner_daily_todo_view.py', 'qa_runner_batch_writes.py', 'qa_runner_batch_assist.py', 'qa_runner_shelf_sync.py', 'qa_runner_batch_form.py'];

function parseArgs(argv) {
    const args = {};
    for (let i = 0; i < argv.length; i++) {
        const key = argv[i].replace(/^--/, '');
        if (argv[i + 1] === undefined || argv[i + 1].startsWith('--')) args[key] = true;
        else args[key] = argv[++i];
    }
    return args;
}

function unitFiles() {
    return fs.readdirSync(path.join(ROOT, 'tests'))
        .filter(f => f.endsWith('.test.js'))
        .map(f => 'tests/' + f);
}

function suites() {
    return [
        { name: 'unit', cmd: 'node', args: ['--test', ...unitFiles()] },
        ...E2E_RUNNERS.map(f => ({ name: f, cmd: 'python', args: ['tests/e2e/' + f] }))
    ];
}

function runSuite(suite, env) {
    return new Promise(resolve => {
        const started = Date.now();
        const chunks = [];
        const child = spawn(suite.cmd, suite.args, { cwd: ROOT, env });
        child.stdout.on('data', d => chunks.push(d));
        child.stderr.on('data', d => chunks.push(d));
        const finish = code => {
            const header = `${'='.repeat(70)}\n=== ${suite.name}\n=== COMMAND: ${suite.cmd} ${suite.args.join(' ')}\n${'='.repeat(70)}\n`;
            const body = `${Buffer.concat(chunks).toString('utf8')}\n[EXIT CODE: ${code}] (${((Date.now() - started) / 1000).toFixed(1)}s)\n\n`;
            resolve({ name: suite.name, ok: code === 0, text: header + body });
        };
        child.on('error', e => finish(`ERROR ${e.message}`));
        child.on('close', finish);
    });
}

// 순서를 지키며 jobs개씩 동시에 실행한다. 끝나는 대로 화면에 출력한다.
async function runAll(list, env, jobs) {
    const results = new Array(list.length);
    let next = 0;
    async function worker() {
        while (next < list.length) {
            const i = next++;
            results[i] = await runSuite(list[i], env);
            process.stdout.write(results[i].text);
        }
    }
    await Promise.all(Array.from({ length: Math.min(jobs, list.length) }, worker));
    return results;
}

function selectSuites(args, failedFile) {
    let list = suites();
    if (args.only) {
        const only = String(args.only).split(',');
        list = list.filter(s => only.some(o => s.name.includes(o)));
    }
    if (args.failed) {
        const prev = fs.existsSync(failedFile) ? JSON.parse(fs.readFileSync(failedFile, 'utf8')) : null;
        if (!prev) { console.error('이전 실패 기록이 없습니다. 먼저 전체 실행을 하세요.'); process.exit(2); }
        list = list.filter(s => prev.includes(s.name));
    }
    return list;
}

// 실행 설정: run 폴더, 실패 기록 파일, 부분 실행 여부, 동시 실행 수, 환경변수
function options(args) {
    const runId = (typeof args.run === 'string' && args.run) || process.env.AGENT_RUN_ID;
    const dir = runId ? path.join(os.tmpdir(), 'agent-runs', runId) : fs.mkdtempSync(path.join(os.tmpdir(), 'rt-'));
    fs.mkdirSync(dir, { recursive: true });
    return {
        runId, dir,
        failedFile: path.join(dir, 'last-failed.json'),
        partial: Boolean(args.only || args.failed),
        jobs: Number(args.jobs) || Math.max(1, Math.min(4, os.cpus().length - 1)),
        env: { ...process.env, PYTHONIOENCODING: 'utf-8', ...(runId ? { AGENT_RUN_ID: runId } : {}) }
    };
}

function writeResults(opt, results, seconds) {
    const failed = results.filter(r => !r.ok).map(r => r.name);
    const summary = `=== RESULT: ${results.length} suites, passed ${results.length - failed.length}, failed ${failed.length}` +
        (failed.length ? ` (${failed.join(', ')})` : '') + ` [${opt.partial ? 'partial' : 'full'}, ${seconds.toFixed(1)}s, jobs ${opt.jobs}]\n`;
    process.stdout.write(summary);
    fs.writeFileSync(opt.failedFile, JSON.stringify(failed), 'utf8');
    if (opt.runId) {
        const logName = opt.partial ? 'test-output.partial.log' : 'test-output.log';
        fs.writeFileSync(path.join(opt.dir, logName), results.map(r => r.text).join('') + summary, 'utf8');
    }
    return failed;
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const opt = options(args);
    const started = Date.now();
    // E2E는 빌드 결과(dist)를 띄운다. 타입 오류나 빌드 실패면 테스트하지 않는다
    for (const step of ['typecheck', 'build']) {
        const r = spawnSync('npm', ['run', step], { cwd: ROOT, shell: true, encoding: 'utf8' });
        if (r.status !== 0) { console.error(r.stdout + r.stderr); console.error(`=== RESULT: npm run ${step} 실패`); process.exit(1); }
    }
    const results = await runAll(selectSuites(args, opt.failedFile), opt.env, opt.jobs);
    const failed = writeResults(opt, results, (Date.now() - started) / 1000);
    process.exit(failed.length ? 1 : 0);
}

main();
