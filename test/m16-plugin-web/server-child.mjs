/**
 * M16 测试用子进程：在**假 HOME** 下起一次 Web 前端服务。
 *
 * 为什么必须开子进程：`plugin-store.js` 的 overlay 路径取自 `os.homedir()`
 * （Windows 读 USERPROFILE，POSIX 读 HOME），而它在**模块加载时**就被算好了。
 * 测试进程内改环境变量已经来不及，而且一旦漏改就会写到真实用户目录。
 * 所以由父进程指定一个 mkdtemp 出来的假家目录，整条写盘路径都落在临时目录里。
 *
 * 用法：node server-child.mjs <port> <backendUrl> [accessToken]
 * 就绪后在 stdout 打一行 `READY <port>`。
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startWebServer } from '../../cli/lib/web.js';

const ROOT = fileURLToPath(new URL('../../', import.meta.url));
const port = Number(process.argv[2] || 0);
const backend = process.argv[3] || 'http://127.0.0.1:1';
const accessToken = process.argv[4] || '';

const server = await startWebServer({
    port,
    backend,
    accessToken,
    webRootFlag: path.join(ROOT, 'Web', 'public'),
    // 本套件只验插件端点与静态资源，不挂扩展：少一份无关的挂载日志与目录扫描
    noExt: true,
    log: () => {},
});

process.stdout.write(`READY ${server.address().port}\n`);

for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        server.close();
        process.exit(0);
    });
}
