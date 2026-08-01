/**
 * lock.js — 简易文件锁
 *
 * 基于原子性 `fs.open(..., 'wx')` 实现独占写入锁。
 * 写入 PID 与时间戳，崩溃后可通过 stale 时间自动复用。
 *
 * 返回 release 函数供 finally 调用，确保锁释放。
 */

import fs from 'node:fs';
import path from 'node:path';
import { LOCK_STALE_MS } from '../constants.js';

/**
 * 获取一个文件锁。
 * @param {string} lockPath 锁文件路径
 * @param {number} [staleMs] stale 时间（毫秒）
 * @returns {Promise<() => Promise<void>>} release 函数
 */
export async function acquireLock(lockPath, staleMs = LOCK_STALE_MS) {
  await fs.promises.mkdir(path.dirname(lockPath), { recursive: true });

  // 轮询获取锁（带 stale 检测）
  // eslint-disable-next-line no-constant-condition
  while (true) {
    try {
      const handle = await fs.promises.open(lockPath, 'wx');
      const payload = JSON.stringify({ pid: process.pid, ts: Date.now() });
      await handle.writeFile(payload, 'utf-8');
      await handle.close();
      return () => fs.promises.unlink(lockPath).catch(() => {});
    } catch (error) {
      if (/** @type {NodeJS.ErrnoException} */ (error).code !== 'EEXIST') {
        throw error;
      }
    }

    // 锁已被占用，判断是否 stale
    const stale = await isStale(lockPath, staleMs);
    if (stale) {
      // 强制释放后下一轮重试
      await fs.promises.unlink(lockPath).catch(() => {});
      continue;
    }

    // 等待后重试
    await sleep(200);
  }
}

/**
 * 判断锁是否过期。
 * @param {string} lockPath
 * @param {number} staleMs
 * @returns {Promise<boolean>}
 */
async function isStale(lockPath, staleMs) {
  try {
    const raw = await fs.promises.readFile(lockPath, 'utf-8');
    const info = JSON.parse(raw);
    return Date.now() - info.ts > staleMs;
  } catch {
    return false;
  }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
