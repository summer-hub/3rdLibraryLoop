/**
 * opencode.js —— AI CLI serve 生命周期管理（opencode / deveco-code）
 *
 * 策略（A4）：
 *   - 类型：由 CLI_TYPE 决定（显式参数 > 环境变量/.env 链 > 默认 deveco-code），
 *     deveco-code 时拉起 `deveco serve`，否则 `opencode serve`
 *     （deveco-code 基于 opencode 扩展，HTTP API 同源，/health 通用）
 *   - 探测：操作前 checkHealth()（HTTP GET /health）
 *   - 拉起：CLI 自持 spawn('<bin> serve --port <port>')，透传 stderr 前几行；
 *     已在运行则复用不接管；远端 host（非 localhost）只探测不拉起
 *   - 归属：CLI 自己拉的记 pid，退出时先 abortLoop 再杀子进程
 *   - 已知坑（AGENTS.md）：serve 需在项目上一级目录执行；
 *     子任务 session 创建时强制指定 cwd 会触发权限问题（已验证 SkillExecutor.drop cwd）
 *
 * 跨平台进程清理：
 *   Windows 无进程组语义，须用 taskkill /T /F 杀进程树；Unix 用 process.kill(SIGTERM)。
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import { resolveCliType } from './config.js';

/** CLI 类型 → 可执行文件名 */
const CLI_BINS = { opencode: 'opencode', 'deveco-code': 'deveco' };

/** CLI 类型 → host/port 环境变量（与 Server/CLI 适配器同源） */
const CLI_HOST_ENV = { opencode: 'OPENCODE_HOST', 'deveco-code': 'DEVECO_HOST' };
const CLI_PORT_ENV = { opencode: 'OPENCODE_PORT', 'deveco-code': 'DEVECO_PORT' };

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

/**
 * 解析某 CLI 类型的 serve 连接配置（bin / host / port）。
 *
 * 优先级与 Server/CLI 适配器、check-env.mjs 的 resolveCliServePort 保持一致：
 *   环境变量（含 .env 链注入）> 默认 localhost:4096。
 *
 * @param {string} [cliType] - 未传时按 resolveCliType() 解析
 * @returns {{ cliType: 'opencode'|'deveco-code', bin: string, host: string, port: number }}
 */
export function resolveCliServeConfig(cliType) {
    const type = resolveCliType(cliType);
    const port = Number.parseInt(String(process.env[CLI_PORT_ENV[type]] ?? ''), 10) || 4096;
    const host = String(process.env[CLI_HOST_ENV[type]] ?? '').trim() || 'localhost';
    return { cliType: type, bin: CLI_BINS[type], host, port };
}

/**
 * AI CLI serve 服务管理器（opencode / deveco-code 统一）。
 *
 * @example
 * const mgr = new CliServeManager({ projectRoot });
 * await mgr.ensureRunning();     // 探测 -> 若未运行则拉起
 * await mgr.stop();              // 若由本 CLI 拉起则杀掉
 */
export class CliServeManager {
    /**
     * @param {object} opts
     * @param {string} opts.projectRoot - 项目根（serve 需在上一级目录运行）
     * @param {string} [opts.cliType]   - CLI 类型（默认按 CLI_TYPE 环境解析）
     * @param {string} [opts.host]      - 服务主机（默认 OPENCODE_HOST/DEVECO_HOST 或 localhost）
     * @param {number} [opts.port]      - 服务端口（默认 OPENCODE_PORT/DEVECO_PORT 或 4096）
     */
    constructor(opts = {}) {
        const cfg = resolveCliServeConfig(opts.cliType);
        this.cliType = cfg.cliType;
        this.bin = cfg.bin;
        this.projectRoot = opts.projectRoot || process.cwd();
        this.host = opts.host || cfg.host;
        this.port = opts.port || cfg.port;
        this.baseUrl = `http://${this.host}:${this.port}`;
        /** @type {import('node:child_process').ChildProcess|null} */
        this.child = null;
        /** @type {boolean} 是否由本 CLI 拉起（决定退出时是否杀） */
        this.spawnedByUs = false;
    }

    /**
     * 探测 serve 是否已在运行。
     * 通过 HTTP /health 连通性判断（opencode / deveco-code 同源 API）。
     * @returns {Promise<{ ok: boolean, message: string }>}
     */
    async checkHealth() {
        try {
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
                return { ok: true, message: `${this.cliType} 服务正常 (${this.baseUrl})` };
            }
            return { ok: false, message: `${this.cliType} 服务响应异常 (HTTP ${res.status})` };
        } catch {
            return { ok: false, message: `${this.cliType} 服务未运行 (${this.baseUrl})` };
        }
    }

    /**
     * 确保 serve 正在运行。
     * 未运行时自动拉起（在项目上一级目录执行；远端 host 只探测不拉起）。
     * @returns {Promise<{ ok: boolean, message: string, spawned: boolean }>}
     */
    async ensureRunning() {
        const health = await this.checkHealth();
        if (health.ok) {
            return { ok: true, message: health.message, spawned: false };
        }

        // 远端 host：无法本地拉起，直接返回探测结果
        if (!LOCAL_HOSTS.has(this.host)) {
            return {
                ok: false,
                message: `${this.cliType} 服务不可达 (${this.baseUrl})，且远端 host 无法自动拉起，请先启动 ${this.bin} serve`,
                spawned: false,
            };
        }

        // 未运行 → 尝试拉起
        const cwd = path.resolve(this.projectRoot, '..');
        this._log(`尝试启动 ${this.bin} serve --port ${this.port} (cwd=${cwd})...`);

        try {
            const child = spawn(this.bin, ['serve', '--port', String(this.port)], {
                cwd,
                stdio: ['ignore', 'pipe', 'pipe'],
                shell: process.platform === 'win32',
                detached: false,
            });

            this.child = child;
            this.spawnedByUs = true;

            // 透传前几行 stderr 供诊断
            let stderrLines = [];
            child.stderr?.on('data', (chunk) => {
                const text = chunk.toString().trim();
                if (stderrLines.length < 5) stderrLines.push(text);
            });

            // 等待健康（最多 15s）
            const deadline = Date.now() + 15000;
            while (Date.now() < deadline) {
                await this._sleep(1000);
                const healthAgain = await this.checkHealth();
                if (healthAgain.ok) {
                    return { ok: true, message: `已启动 ${this.cliType} serve (${this.baseUrl})`, spawned: true };
                }
                // 子进程提前退出则报错
                if (child.exitCode != null) {
                    break;
                }
            }

            const stderrSnippet = stderrLines.join('\n  ');
            return {
                ok: false,
                message: `${this.cliType} serve 启动超时或失败` + (stderrSnippet ? `：\n  ${stderrSnippet}` : ''),
                spawned: true,
            };
        } catch (err) {
            return {
                ok: false,
                message: `启动 ${this.cliType} serve 失败: ${err.message}`,
                spawned: false,
            };
        }
    }

    /**
     * 停止由本 CLI 拉起的 serve 进程。
     */
    async stop() {
        if (!this.spawnedByUs || !this.child || this.child.pid == null) return;
        const pid = this.child.pid;
        this._log(`停止由本 CLI 拉起的 ${this.cliType} serve (pid=${pid})`);
        try {
            if (process.platform === 'win32') {
                execSync(`taskkill /pid ${pid} /T /F`, { stdio: 'ignore' });
            } else {
                this.child.kill('SIGTERM');
                // 等待退出
                await new Promise(resolve => {
                    const t = setTimeout(resolve, 3000);
                    this.child.once('exit', () => { clearTimeout(t); resolve(); });
                });
            }
        } catch {
            // 进程可能已死
        }
        this.child = null;
        this.spawnedByUs = false;
    }

    _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

    _log(msg) {
        process.stderr.write(`[${this.bin}] ${msg}\n`);
    }
}

/** 兼容旧名（历史上仅支持 opencode）。新代码请使用 CliServeManager。 */
export const OpencodeManager = CliServeManager;
