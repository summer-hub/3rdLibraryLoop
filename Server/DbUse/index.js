/**
 * DbUse —— 统一持久化存储入口
 *
 * 分层架构（高内聚低耦合）：
 *
 *   ┌──────────────────────────────────────────────────────────┐
 *   │  入口层  index.js                                        │
 *   │  对外统一导出：createStorage() 工厂 + 各 Store 类          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Store 层  stores/                                       │
 *   │  业务语义：SessionStore / TaskStepStore / ...             │
 *   │  只依赖适配器接口，不感知存储格式                          │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Manager  StorageManager.js                              │
 *   │  工厂/注册表：统一根目录、按 (type,subDir) 复用适配器实例   │
 *   ├──────────────────────────────────────────────────────────┤
 *   │  Adapter 层  adapters/                                   │
 *   │  存储格式实现：Json / Jsonl / Sqlite / File (+ Base)      │
 *   │  互不依赖，新增格式只需加子类                             │
 *   └──────────────────────────────────────────────────────────┘
 *
 * 目录布局（workspace 根下 db/，自动创建）：
 *   db/
 *     ├── Session/              # Session 对话存档（jsonl + meta.json）
 *     │   ├── <sid>.jsonl
 *     │   └── <sid>.meta.json
 *     ├── TaskStep/             # 任务步骤存档（SQLite）
 *     │   └── store.db
 *     └── Artifacts/            # 任务产物文件（原始文件，按需）
 *
 * 使用示例：
 *   import { createStorage } from './DbUse/index.js';
 *   const storage = createStorage();
 *   const sessionStore = storage.sessionStore();
 *   const taskStepStore = storage.taskStepStore();
 *
 * 扩展方式：
 *   - 新增业务存储：在 stores/ 下新建 Store，通过 manager.get(type, subDir) 取适配器
 *   - 新增存储格式：在 adapters/ 下继承 BaseAdapter，注册到 StorageManager._ADAPTERS
 */

import StorageManager from './StorageManager.js';
import SessionStore from './stores/SessionStore.js';
import TaskStepStore from './stores/TaskStepStore.js';
import TaskExecutionStore from './stores/TaskExecutionStore.js';
import MessageArchive from './MessageArchive.js';

export { StorageManager, SessionStore, TaskStepStore, TaskExecutionStore, MessageArchive };
export { default as BaseAdapter } from './adapters/BaseAdapter.js';
export { default as JsonAdapter } from './adapters/JsonAdapter.js';
export { default as JsonlAdapter } from './adapters/JsonlAdapter.js';
export { default as SqliteAdapter } from './adapters/SqliteAdapter.js';
export { default as FileAdapter } from './adapters/FileAdapter.js';

/**
 * 子域名称常量，避免散落的魔法字符串。
 */
export const SubDirs = Object.freeze({
    SESSION: 'Session',
    TASK_STEP: 'TaskStep',
    TASK: 'task',
    ARTIFACTS: 'Artifacts'
});

/**
 * 创建统一的存储门面，组合各 Store 并共享同一 StorageManager。
 *
 * @param {object} [options]
 * @param {string} [options.rootDir] - 存储根目录绝对路径（默认 workspace 根/db）
 * @param {number} [options.stallThresholdMs] - Session 卡死判定阈值
 * @returns {{
 *   manager: StorageManager,
 *   sessionStore: () => SessionStore,
 *   taskStepStore: () => TaskStepStore,
 *   taskExecStore: () => TaskExecutionStore,
 *   messageArchive: () => MessageArchive,
 *   file: (subDir?: string) => import('./adapters/FileAdapter.js').default,
 *   json: (subDir: string) => import('./adapters/JsonAdapter.js').default,
 *   jsonl: (subDir: string) => import('./adapters/JsonlAdapter.js').default,
 *   sqlite: (subDir: string) => import('./adapters/SqliteAdapter.js').default,
 *   close: () => Promise<void>
 * }}
 */
export function createStorage(options = {}) {
    const manager = new StorageManager(options);
    const stallThresholdMs = options.stallThresholdMs;

    // 懒初始化的 Store 实例（首次调用时创建，复用同一适配器实例）
    let _sessionStore, _taskStepStore, _taskExecStore, _messageArchive;

    return {
        manager,

        /** Session 对话存档（jsonl 消息流 + meta） */
        sessionStore() {
            if (!_sessionStore) {
                _sessionStore = new SessionStore({
                    jsonl: manager.jsonl(SubDirs.SESSION),
                    json: manager.json(SubDirs.SESSION),
                    stallThresholdMs
                });
            }
            return _sessionStore;
        },

        /** 任务步骤存档（SQLite） */
        taskStepStore() {
            if (!_taskStepStore) {
                _taskStepStore = new TaskStepStore({
                    sqlite: manager.sqlite(SubDirs.TASK_STEP)
                });
            }
            return _taskStepStore;
        },

        /** 任务执行记录（JSON 文件，db/task/{taskId}/stepid_{stepId}.json） */
        taskExecStore() {
            if (!_taskExecStore) {
                _taskExecStore = new TaskExecutionStore({
                    json: manager.json(SubDirs.TASK)
                });
            }
            return _taskExecStore;
        },

        /** MessageArchive 兼容门面（供 CLI 适配器直接使用） */
        messageArchive() {
            if (!_messageArchive) {
                _messageArchive = new MessageArchive({ manager, stallThresholdMs });
            }
            return _messageArchive;
        },

        // 适配器直接访问（供自定义 Store 使用）
        json: (subDir) => manager.json(subDir),
        jsonl: (subDir) => manager.jsonl(subDir),
        sqlite: (subDir) => manager.sqlite(subDir),
        file: (subDir = SubDirs.ARTIFACTS) => manager.file(subDir),

        /** 关闭所有存储（释放数据库连接等） */
        async close() {
            await manager.closeAll();
        }
    };
}

export default { createStorage, StorageManager, SessionStore, TaskStepStore, MessageArchive, SubDirs };
