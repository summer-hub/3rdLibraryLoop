/**
 * ScriptExecutor —— 脚本执行器
 *
 * 职责：
 *   1. 根据脚本扩展名选择解释器（.sh→bash, .py→python3, .js→node）。
 *   2. 通过 child_process.spawn 执行脚本，参数以 JSON 字符串形式传入。
 *   3. 捕获 stdout/stderr，超时自动终止。
 *
 * 设计原则：
 *   - 高内聚：所有脚本执行逻辑集中在此模块。
 *   - 低耦合：不感知工具注册表和 MCP 协议，只接收路径+参数，返回输出。
 *   - 安全：执行超时自动 SIGTERM，避免僵尸进程。
 *
 * 参数传递方式：
 *   Gateway 将 MCP 工具参数序列化为 JSON 字符串，作为脚本的第一个参数传入。
 *   脚本内通过 $1（bash）或 sys.argv[1]（python）获取后自行解析。
 */

import { spawn } from 'node:child_process';
import { createLogger } from '../library/logger.js';

const log = createLogger('ScriptExecutor');

/** 扩展名 → 解释器映射 */
const INTERPRETERS = {
    '.sh': 'bash',
    '.py': 'python3',
    '.js': 'node',
    '.cjs': 'node',
    '.ts': 'npx',
    '.mjs': 'node'
};

class ScriptExecutor {
    /**
     * @param {number} timeout - 执行超时（ms）
     */
    constructor(timeout) {
        this._timeout = timeout;
    }

    /**
     * 执行脚本，返回 stdout + stderr。
     *
     * - 退出码为 0 时，返回 stdout（trim）
     * - 退出码非 0 时，返回 stdout + stderr + 退出码（便于 AI 排查）
     * - 超时时自动终止子进程并 reject
     *
     * @param {string} filePath   - 脚本文件绝对路径
     * @param {string} extension  - 文件扩展名
     * @param {Object} args       - 工具参数（序列化为 JSON 传入脚本）
     * @returns {Promise<string>} 脚本输出
     */
    async execute(filePath, extension, args) {
        const interpreter = _getInterpreter(extension);
        const argsJson = JSON.stringify(args);

        log.debug(`执行脚本: ${filePath}`, { interpreter, args: argsJson });

        // .ts 需要通过 npx tsx 执行
        const cmd = extension === '.ts'
            ? spawn(interpreter, ['tsx', filePath, argsJson], { stdio: ['pipe', 'pipe', 'pipe'] })
            : spawn(interpreter, [filePath, argsJson], { stdio: ['pipe', 'pipe', 'pipe'] });

        return new Promise((resolve, reject) => {
            let stdout = '';
            let stderr = '';

            cmd.stdout.on('data', (data) => { stdout += data.toString(); });
            cmd.stderr.on('data', (data) => { stderr += data.toString(); });

            const timer = setTimeout(() => {
                cmd.kill('SIGTERM');
                reject(new Error(`脚本执行超时 (${this._timeout}ms): ${filePath}`));
            }, this._timeout);

            cmd.on('close', (code) => {
                clearTimeout(timer);
                if (code === 0) {
                    resolve(stdout.trim());
                } else {
                    // 非零退出码：拼接 stdout + stderr + 退出码，便于 AI 排查
                    const output = [
                        stdout.trim(),
                        stderr.trim() ? `[STDERR]\n${stderr.trim()}` : '',
                        `[Exit Code: ${code}]`
                    ].filter(Boolean).join('\n');
                    resolve(output);
                }
            });

            cmd.on('error', (err) => {
                clearTimeout(timer);
                reject(new Error(`脚本启动失败: ${err.message}`));
            });
        });
    }
}

/**
 * 根据扩展名获取解释器命令。
 * @param {string} extension
 * @returns {string}
 * @private
 */
function _getInterpreter(extension) {
    return INTERPRETERS[extension] || 'bash';
}

export default ScriptExecutor;
