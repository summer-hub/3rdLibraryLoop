/**
 * Server/LoopEngine/index.js —— 统一导出（**纯转发门面**，实现已迁入 `plugins/engines/loopengine/`）
 *
 * 外部使用（与迁移前逐名一致）：
 *   import { LoopEngine, LoopStatus } from './LoopEngine/index.js';
 *   const engine = new LoopEngine({ brainController, orchestratorController, storage });
 *   const result = await engine.startLoop({ taskDescription: '…' });
 *
 * 导出面：具名 `LoopEngine` / `LoopStatus` / `ABORTED_ERROR` + `default`，与迁移前的
 * `Server/LoopEngine/{LoopEngine,index}.js` 完全一致，且**就是插件里那几个绑定**（`===`）。
 *
 * 三条无宿主兜底（engine-testcheck / create-storage / cli-controller）的登记在
 * `./LoopEngine.js`——因为"import 门面"在既有代码里两种写法都有
 * （`from './LoopEngine/index.js'` 与 `from '../LoopEngine/LoopEngine.js'`），
 * 登记点选在**两条路径都必经**的那个文件上（与 `Server/TestCheck/TestCheck.js`、
 * `Server/Orchestrator/Orchestrator.js` 同一取舍）。
 */

export { LoopEngine, LoopStatus, ABORTED_ERROR } from './LoopEngine.js';
export { default } from './LoopEngine.js';
