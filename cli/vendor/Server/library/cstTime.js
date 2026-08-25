/**
 * 将 epoch 毫秒或 Date 格式化为北京时间字符串（ISO 8601 带时区偏移 +08:00）。
 *
 * 使用 +08:00 偏移而非 'Z'，使存储和显示均为北京时间；
 * 同时 Date.parse 仍可正确解析，不影响卡死检测的时间计算。
 *
 * @param {number|Date} [input] - epoch 毫秒或 Date 对象，不传则取当前时间
 * @returns {string} 如 "2026-07-27T15:12:08.774+08:00"
 */
export function nowCST(input) {
    const d = input != null ? new Date(input) : new Date();
    return d.toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai', hour12: false })
        .replace(' ', 'T') + '+08:00';
}

export default nowCST;
