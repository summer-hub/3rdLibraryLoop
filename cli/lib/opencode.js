/**
 * opencode.js —— opencode serve 生命周期管理
 *
 * 策略（A4）：
 *   - 探测：操作前 checkHealth()（SDK session.list()）
 *   - 拉起：CLI 自持 spawn('opencode serve')，透传 stderr 前几行；已在运行则复用不接管
 *   - 归属：CLI 自己拉的记 pid，退出时先 abortLoop 再杀子进程
 *   - 已知坑（AGENTS.md）：opencode 需在项目上一级目录执行 opencode serve；
 *     子任务 session 创建时强制指定 cwd 会触发权限问题（已验证 SkillExecutor.drop cwd）
 *
 * 跨平台进程清理：
 *   Windows 无进程组语义，须用 taskkill /T /F 杀进程树；Unix 用 process.kill(SIGTERM)。
 */

import { spawn, execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

/**
 * opencode 服务管理器。
 *
 * @example
 * const mgr = new OpencodeManager({ projectRoot });
 * await mgr.ensureRunning();     // 探测 -> 若未运行则拉起
 * await mgr.stop();              // 若由本 CLI 拉起则杀掉
 */
export class OpencodeManager {
    /**
     * @param {object} opts
     * @param {string} opts.projectRoot - 项目根（opencode serve 需在上一级目录运行）
     * @param {number} [opts.port]      - opencode 端口（默认 4096）
     */
    constructor(opts = {}) {
        this.projectRoot = opts.projectRoot || process.cwd();
        this.port = opts.port || 4096;
        this.baseUrl = `http://localhost:${this.port}`;
        /** @type {import('node:child_process').ChildProcess|null} */
        this.child = null;
        /** @type {boolean} 是否由本 CLI 拉起（决定退出时是否杀） */
        this.spawnedByUs = false;
    }

    /**
     * 探测 opencode 是否已在运行。
     * 通过 HTTP /health 或 session.list 连通性判断。
     * @returns {Promise<{ ok: boolean, message: string }>}
     */
    async checkHealth() {
        try {
            // 轻量探测：尝试连接 baseUrl 的 /health（opencode 服务提供）
            const controller = new AbortController();
            const timer = setTimeout(() => controller.abort(), 3000);
            const res = await fetch(`${this.baseUrl}/health`, { signal: controller.signal });
            clearTimeout(timer);
            if (res.ok) {
                return { ok: true, message: `opencode 服务正常 (${this.baseUrl})` };
            }
            return { ok: false, message: `opencode 服务响应异常 (HTTP ${res.status})` };
        } catch {
            return { ok: false, message: `opencode 服务未运行 (${this.baseUrl})` };
        }
    }

    /**
     * 确保 opencode serve 正在运行。
     * 未运行时自动拉起（在项目上一级目录执行）。
     * @returns {Promise<{ ok: boolean, message: string, spawned: boolean }>}
     */
    async ensureRunning() {
        const health = await this.checkHealth();
        if (health.ok) {
            return { ok: true, message: health.message, spawned: false };
        }

        // 未运行 → 尝试拉起
        const cwd = path.resolve(this.projectRoot, '..');
        this._log(`尝试启动 opencode serve (cwd=${cwd})...`);

        try {
            const child = spawn('opencode', ['serve'], {
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
                    return { ok: true, message: `已启动 opencode serve (${this.baseUrl})`, spawned: true };
                }
                // 子进程提前退出则报错
                if (child.exitCode != null) {
                    break;
                }
            }

            const stderrSnippet = stderrLines.join('\n  ');
            return {
                ok: false,
                message: 'opencode serve 启动超时或失败' + (stderrSnippet ? `：\n  ${stderrSnippet}` : ''),
                spawned: true,
            };
        } catch (err) {
            return {
                ok: false,
                message: `启动 opencode serve 失败: ${err.message}`,
                spawned: false,
            };
        }
    }

    /**
     * 停止由本 CLI 拉起的 opencode 进程。
     */
    async stop() {
        if (!this.spawnedByUs || !this.child || this.child.pid == null) return;
        const pid = this.child.pid;
        this._log(`停止由本 CLI 拉起的 opencode serve (pid=${pid})`);
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
        process.stderr.write(`[opencode] ${msg}\n`);
    }
}