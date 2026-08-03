/**
 * ScriptRegistry —— 脚本注册表 + 自动发现
 *
 * 职责：
 *   1. 扫描脚本目录，解析脚本头部 @tool 注释，提取元数据。
 *   2. 维护脚本工具注册表（toolName → ScriptMeta）。
 *   3. 支持文件监听（chokidar），脚本增删时自动更新注册表并回调通知。
 *
 * 设计原则：
 *   - 高内聚：所有脚本发现/解析/监听逻辑集中在此模块。
 *   - 低耦合：不执行脚本，不注册 MCP 工具，只输出 ScriptMeta 数据。
 *
 * 脚本头部注释约定：
 *   # @tool <名称>              — 必填，工具名（中文可用）
 *   # @description <描述>        — 工具描述，给 AI 理解用途
 *   # @param <名>: <类型> - <说明>  — 参数定义（类型: string/number/boolean）
 *   # @example <调用示例>        — 调用示例
 *
 * 示例：
 *   #!/bin/bash
 *   # @tool git操作
 *   # @description 执行 Git 操作
 *   # @param action: string - 操作类型 (clone|pull|push)
 */

import fs from 'node:fs';
import path from 'node:path';
import chokidar from 'chokidar';
import { createLogger } from '../library/logger.js';

const log = createLogger('ScriptRegistry');

/** 只解析脚本前 N 行的注释 */
const MAX_SCAN_LINES = 20;

class ScriptRegistry {
    /**
     * @param {string} scriptsDir       - 脚本目录绝对路径
     * @param {string[]} allowedExtensions - 允许的扩展名（如 ['.sh', '.py']）
     */
    constructor(scriptsDir, allowedExtensions) {
        this._scriptsDir = scriptsDir;
        this._allowedExtensions = allowedExtensions;
        /** @type {Map<string, import('../types.js').ScriptMeta>} */
        this._scripts = new Map();
        /** @type {chokidar.FSWatcher | null} */
        this._watcher = null;
    }

    /**
     * 扫描脚本目录，解析所有脚本的元数据并注册。
     * @returns {Promise<import('../types.js').ScriptMeta[]>}
     */
    async scanAll() {
        this._scripts.clear();

        let files;
        try {
            files = fs.readdirSync(this._scriptsDir);
        } catch (err) {
            if (err.code === 'ENOENT') {
                log.warn(`脚本目录不存在: ${this._scriptsDir}`);
                return [];
            }
            throw err;
        }

        const metas = [];
        for (const file of files) {
            const filePath = path.join(this._scriptsDir, file);
            const meta = this._parseAndRegister(filePath);
            if (meta) metas.push(meta);
        }

        log.info(`脚本扫描完成`, { count: metas.length, dir: this._scriptsDir });
        return metas;
    }

    /**
     * 解析单个脚本的元数据并注册到注册表。
     * @param {string} filePath - 脚本文件绝对路径
     * @returns {import('../types.js').ScriptMeta | null}
     * @private
     */
    _parseAndRegister(filePath) {
        let stat;
        try {
            stat = fs.statSync(filePath);
        } catch {
            return null;
        }
        if (!stat.isFile()) return null;

        const ext = path.extname(filePath);
        if (!this._allowedExtensions.includes(ext)) return null;

        const meta = this._parseScriptMeta(filePath);
        if (!meta) return null;

        this._scripts.set(meta.toolName, meta);
        return meta;
    }

    /**
     * 解析脚本头部注释，提取 @tool / @description / @param。
     * @param {string} filePath
     * @returns {import('../types.js').ScriptMeta | null} 无 @tool 注释返回 null
     * @private
     */
    _parseScriptMeta(filePath) {
        let content;
        try {
            content = fs.readFileSync(filePath, 'utf-8');
        } catch (err) {
            log.warn(`读取脚本失败: ${filePath}`, { error: err.message });
            return null;
        }

        const lines = content.split('\n').slice(0, MAX_SCAN_LINES);

        let rawName = '';
        let description = '';
        const params = [];

        for (const line of lines) {
            // @tool <名称>
            const toolMatch = line.match(/@tool\s+(.+)/);
            if (toolMatch) {
                rawName = toolMatch[1].trim();
                continue;
            }

            // @description <描述>
            const descMatch = line.match(/@description\s+(.+)/);
            if (descMatch) {
                description = descMatch[1].trim();
                continue;
            }

            // @param <名>: <类型> - <说明>
            const paramMatch = line.match(/@param\s+(\w+):\s*(\w+)\s*-\s*(.+)/);
            if (paramMatch) {
                params.push({
                    name: paramMatch[1],
                    type: paramMatch[2],
                    description: paramMatch[3].trim(),
                    required: true
                });
                continue;
            }
        }

        if (!rawName) return null; // 无 @tool 注释的脚本跳过

        return {
            toolName: `script_${rawName}`,
            rawName,
            description: description || `Script: ${rawName}`,
            filePath,
            extension: path.extname(filePath),
            params
        };
    }

    /**
     * 启动文件监听。脚本增删时自动更新注册表并回调。
     * @param {(meta: import('../types.js').ScriptMeta, action: 'add'|'remove') => void} onChange
     */
    startWatch(onChange) {
        this._watcher = chokidar.watch(this._scriptsDir, {
            ignoreInitial: true,
            persistent: true
        });

        this._watcher.on('add', (filePath) => {
            const meta = this._parseAndRegister(filePath);
            if (meta) {
                log.info(`脚本新增: ${meta.toolName}`);
                onChange(meta, 'add');
            }
        });

        this._watcher.on('unlink', (filePath) => {
            for (const [name, meta] of this._scripts) {
                if (meta.filePath === filePath) {
                    this._scripts.delete(name);
                    log.info(`脚本移除: ${name}`);
                    onChange(meta, 'remove');
                    break;
                }
            }
        });

        this._watcher.on('error', (err) => {
            log.error('脚本监听错误', { error: err.message });
        });

        log.info('脚本热加载监听已启动');
    }

    /**
     * 停止文件监听。
     */
    async stopWatch() {
        if (this._watcher) {
            await this._watcher.close();
            this._watcher = null;
            log.info('脚本热加载监听已停止');
        }
    }

    /**
     * 根据 toolName 获取脚本元数据。
     * @param {string} toolName
     * @returns {import('../types.js').ScriptMeta | undefined}
     */
    get(toolName) {
        return this._scripts.get(toolName);
    }

    /**
     * 获取所有已注册脚本。
     * @returns {import('../types.js').ScriptMeta[]}
     */
    getAll() {
        return Array.from(this._scripts.values());
    }

    /**
     * 获取脚本数量。
     * @returns {number}
     */
    size() {
        return this._scripts.size;
    }
}

export default ScriptRegistry;
