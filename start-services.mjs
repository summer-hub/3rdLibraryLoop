#!/usr/bin/env node

/**
 * 3rdLibraryLoop 服务启动脚本
 *
 * 先执行环境检测（调用 check-env.mjs），全部通过后启动三个服务：
 *   ① Server 后端 API:  node Server/Routes/server.js --port 3000 --type opencode
 *   ② Web 前端:         node Web/server.js --port 8080 --backend http://127.0.0.1:3000
 *   ③ opencode 服务:     opencode serve
 *
 * 用法:
 *   node start-services.mjs                  # 先检测环境，通过后启动服务
 *   node start-services.mjs --skip-check      # 跳过环境检测，直接启动服务
 *
 * 按 Ctrl+C 停止所有服务。
 */

import path from 'node:path';
import { spawn, execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { runChecks } from './check-env.mjs';

// ─── 路径常量 ──────────────────────────────────────────────────────────────
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PROJECT_ROOT = __dirname;

// ─── ANSI 颜色 ─────────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const C = isTTY ? {
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
    gray: '\x1b[90m',
    bgGreen: '\x1b[42m',
    bgRed: '\x1b[41m',
} : {
    reset: '', bold: '', red: '', green: '', yellow: '', blue: '',
    cyan: '', gray: '', bgGreen: '', bgRed: '',
};

// ─── 工具函数 ──────────────────────────────────────────────────────────────

function banner(text) {
    const line = '─'.repeat(Math.max(text.length * 2, 50));
    console.log(`\n${C.cyan}${C.bold}┌${line}┐${C.reset}`);
    const pad = ' '.repeat(Math.floor((line.length - text.length * 2) / 2));
    console.log(`${C.cyan}${C.bold}│${pad}${text}${pad}│${C.reset}`);
    console.log(`${C.cyan}${C.bold}└${line}┘${C.reset}\n`);
}

function ok(msg) {
    console.log(`  ${C.green}✓${C.reset} ${msg}`);
}

function fail(msg) {
    console.log(`  ${C.red}✗${C.reset} ${msg}`);
}

function hint(msg) {
    console.log(`  ${C.gray}${msg}${C.reset}`);
}

// ─── 端口/进程工具 ──────────────────────────────────────────────────────────

/**
 * 关闭占用指定端口的进程（跨平台）
 * @returns true 表示有进程被关闭
 */
function killPort(port) {
    try {
        if (process.platform === 'win32') {
            const out = execSync(`netstat -ano | findstr :${port}`, { encoding: 'utf8' });
            const pids = new Set();
            for (const line of out.trim().split('\n')) {
                const parts = line.trim().split(/\s+/);
                const pid = parts[parts.length - 1];
                if (pid && /^\d+$/.test(pid)) pids.add(pid);
            }
            for (const pid of pids) {
                execSync(`taskkill /PID ${pid} /F`, { stdio: 'ignore' });
            }
        } else {
            const out = execSync(`lsof -ti:${port}`, { encoding: 'utf8' });
            const pids = out.trim().split('\n').filter(Boolean);
            for (const pid of pids) {
                execSync(`kill -9 ${pid}`, { stdio: 'ignore' });
            }
        }
        return true;
    } catch {
        return false;
    }
}

/**
 * 检查指定命令的进程是否正在运行（跨平台）
 */
function isProcessRunning(pattern) {
    try {
        if (process.platform === 'win32') {
            const out = execSync(`tasklist /FI "IMAGENAME eq ${pattern}" /NH`, { encoding: 'utf8' });
            return !out.includes('No tasks') && !out.includes('INFO:');
        } else {
            execSync(`pgrep -f "${pattern}"`, { encoding: 'utf8', stdio: 'pipe' });
            return true;
        }
    } catch {
        return false;
    }
}

// ─── 环境检测 ──────────────────────────────────────────────────────────────

const skipCheck = process.argv.includes('--skip-check');

if (!skipCheck) {
    banner('🔍 环境检测');
    console.log(`  ${C.gray}启动前先执行环境检测，确保依赖就绪...${C.reset}\n`);

    const allPassed = runChecks();

    if (!allPassed) {
        console.log(`  ${C.bgRed}${C.bold} 环境检测未通过，无法启动服务 ${C.reset}\n`);
        console.log(`  ${C.gray}请修复上述问题后重试，或使用 ${C.cyan}node start-services.mjs --skip-check${C.reset} 跳过检测${C.reset}\n`);
        process.exit(1);
    }

    console.log(`  ${C.bgGreen}${C.bold} 环境检测通过，准备启动服务 ${C.reset}\n`);
} else {
    console.log(`\n  ${C.yellow}⚠ 已跳过环境检测 (--skip-check)${C.reset}\n`);
}

// ─── 服务定义 ──────────────────────────────────────────────────────────────

const services = [
    {
        name: 'Server 后端 API',
        cmd: 'node',
        args: [path.join(PROJECT_ROOT, 'Server', 'Routes', 'server.js'), '--port', '3000', '--type', 'opencode'],
        cwd: PROJECT_ROOT,
        color: C.green,
        url: 'http://127.0.0.1:3000',
        port: 3000,
        restart: true,               // 先关闭旧进程再启动
    },
    {
        name: 'Web 前端',
        cmd: 'node',
        args: [path.join(PROJECT_ROOT, 'Web', 'server.js'), '--port', '8080', '--backend', 'http://127.0.0.1:3000'],
        cwd: PROJECT_ROOT,
        color: C.cyan,
        url: 'http://localhost:8080',
        port: 8080,
        restart: true,               // 先关闭旧进程再启动
    },
    {
        name: 'MCP Gateway',
        cmd: 'node',
        args: [path.join(PROJECT_ROOT, 'MCP', 'src', 'index.js'), '--config', path.join(PROJECT_ROOT, 'MCP', 'config.json')],
        cwd: path.join(PROJECT_ROOT, 'MCP'),
        color: C.blue,
        url: null,                    // stdio 传输，无 HTTP 端口
        skipIfRunning: 'MCP/src/index.js',  // 已在运行（如 opencode 已 spawn）则跳过
    },
    {
        name: 'opencode serve',
        cmd: 'opencode',
        args: ['serve'],
        cwd: path.resolve(PROJECT_ROOT, '..'), // 在 3rdLibraryLoop 上一级目录执行
        color: C.yellow,
        url: null,
        skipIfRunning: 'opencode serve',  // 已在运行则跳过
    },
];

// ─── 启动服务 ──────────────────────────────────────────────────────────────

banner('🚀 启动服务');

const processes = [];
const skipped = [];

for (const svc of services) {
    // opencode serve: 已在运行则跳过
    if (svc.skipIfRunning && isProcessRunning(svc.skipIfRunning)) {
        console.log(`\n  ${svc.color}○ ${svc.name} 已在运行，跳过启动${C.reset}`);
        hint(`检测到进程: ${svc.skipIfRunning}`);
        skipped.push(svc);
        continue;
    }

    // Server / Web: 先关闭占用端口的旧进程
    if (svc.restart && svc.port) {
        const killed = killPort(svc.port);
        console.log(`\n  ${svc.color}▶ 启动 ${svc.name}...${C.reset}`);
        if (killed) hint(`已关闭占用端口 ${svc.port} 的旧进程`);
    } else {
        console.log(`\n  ${svc.color}▶ 启动 ${svc.name}...${C.reset}`);
    }
    hint(`命令: ${svc.cmd} ${svc.args.join(' ')}`);

    try {
        const child = spawn(svc.cmd, svc.args, {
            cwd: svc.cwd,
            stdio: ['pipe', 'pipe', 'pipe'],
            shell: process.platform === 'win32', // Windows 需要 shell
            detached: false,
        });

        const prefix = `[${svc.name}]`;

        child.stdout.on('data', (data) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                console.log(`  ${svc.color}${prefix}${C.reset} ${line}`);
            }
        });

        child.stderr.on('data', (data) => {
            const lines = data.toString().trim().split('\n');
            for (const line of lines) {
                console.error(`  ${svc.color}${prefix}${C.reset} ${C.red}${line}${C.reset}`);
            }
        });

        child.on('error', (err) => {
            console.error(`  ${svc.color}${prefix}${C.reset} ${C.red}启动失败: ${err.message}${C.reset}`);
        });

        child.on('exit', (code) => {
            if (code !== null && code !== 0) {
                console.log(`  ${svc.color}${prefix}${C.reset} ${C.yellow}进程退出 (code=${code})${C.reset}`);
            }
        });

        processes.push({ ...svc, child });
        ok(`${svc.name} 已启动 (PID: ${child.pid})`);

    } catch (err) {
        fail(`启动 ${svc.name} 失败: ${err.message}`);
    }
}

// 等待片刻后显示访问信息
setTimeout(() => {
    console.log();
    banner('✅ 服务启动完成');
    console.log(`  ${C.bold}访问地址:${C.reset}`);
    for (const svc of services) {
        const isSkipped = skipped.includes(svc);
        if (svc.url) {
            const tag = isSkipped ? ` ${C.gray}(已运行)${C.reset}` : '';
            console.log(`    ${C.green}${svc.name}:${C.reset}  ${C.cyan}${svc.url}${C.reset}${tag}`);
        } else {
            const tag = isSkipped ? ', 已运行' : '';
            console.log(`    ${C.green}${svc.name}:${C.reset}  ${C.gray}(后台服务${tag})${C.reset}`);
        }
    }
    console.log();
    console.log(`  ${C.gray}按 Ctrl+C 停止由本脚本启动的服务${C.reset}`);
    console.log();
}, 3000);

// ─── 优雅退出 ──────────────────────────────────────────────────────────────

const shutdown = () => {
    console.log(`\n\n  ${C.yellow}正在停止所有服务...${C.reset}`);
    for (const { name, child } of processes) {
        try {
            if (!child.killed) {
                child.kill('SIGTERM');
                console.log(`  ${C.gray}已停止: ${name}${C.reset}`);
            }
        } catch { /* ignore */ }
    }
    // Windows 下需要用 taskkill 杀进程树
    if (process.platform === 'win32') {
        for (const { child } of processes) {
            try {
                execSync(`taskkill /pid ${child.pid} /T /F`, { stdio: 'ignore' });
            } catch { /* ignore */ }
        }
    }
    process.exit(0);
};

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// 保持进程不退出
process.stdin.resume();
