# RN Jest 测试运行工作流

---

## 一、概述

RN 三方库 XTS 测试基于 Jest 框架运行，通过 `jest.mock()` 模拟原生模块，在 Node.js 环境中执行 JavaScript/TypeScript 测试用例。

---

## 二、运行前准备

### 2.1 确认 RN_TEST_PROJECT 路径

从 `.oh-xts-config.json` 中读取 `RN_TEST_PROJECT` 路径。

### 2.2 确认 Jest 依赖

确保项目已安装 Jest：

```bash
# 检查 package.json 中是否有 jest 依赖
cat {RN_TEST_PROJECT}/package.json | grep jest

# 如果没有，安装 Jest
cd {RN_TEST_PROJECT}
npm install --save-dev jest @types/jest ts-jest typescript
```

### 2.3 最小化 package.json 配置

如果输出目录是新建的独立目录（如文档驱动模式），需要创建 `package.json`：

```json
{
  "name": "[库名]-xts",
  "version": "1.0.0",
  "private": true,
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage"
  },
  "devDependencies": {
    "jest": "^29.7.0",
    "@types/jest": "^29.5.0",
    "ts-jest": "^29.1.0",
    "typescript": "^5.3.0"
  }
}
```

### 2.4 tsconfig.json 配置（TypeScript 项目需要）

```json
{
  "compilerOptions": {
    "target": "ES2020",
    "module": "commonjs",
    "lib": ["ES2020"],
    "strict": true,
    "esModuleInterop": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "moduleResolution": "node",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true,
    "outDir": "./dist",
    "rootDir": ".",
    "types": ["jest"]
  },
  "include": ["__tests__/**/*.ts", "__mocks__/**/*.ts"],
  "exclude": ["node_modules", "dist"]
}
```

### 2.5 确认测试文件位置

```
{输出目录}/
├── __tests__/
│   ├── [库名简写]Test.test.ts
│   ├── [库名简写]EventTest.test.ts
│   ├── [库名简写]PermTest.test.ts
│   └── [库名简写]UtilsTest.test.ts
├── __mocks__/
│   └── @react-native-ohos/
│       └── [库名]/
│           └── index.ts
├── jest.config.js
├── jest.setup.js
└── package.json
```

---

## 三、jest.config.js 配置

### 3.1 基础配置

```javascript
module.exports = {
  preset: 'react-native',
  testEnvironment: 'node',
  testMatch: ['**/__tests__/**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': 'ts-jest',
  },
  transformIgnorePatterns: [
    'node_modules/(?!(react-native|@react-native|@react-native-ohos)/)',
  ],
  moduleNameMapper: {
    // 如果使用 __mocks__ 目录
    '^@react-native-ohos/(.*)$': '<rootDir>/__mocks__/@react-native-ohos/$1',
  },
  setupFilesAfterEnv: ['<rootDir>/jest.setup.js'],
  collectCoverageFrom: [
    'src/**/*.{ts,tsx}',
    '!src/**/*.d.ts',
    '!src/**/index.ts',
  ],
};
```

### 3.2 jest.setup.js

```javascript
// jest.setup.js
jest.mock('react-native', () => ({
  Platform: { OS: 'harmony' },
  NativeModules: {},
  NativeEventEmitter: jest.fn().mockImplementation(() => ({
    addListener: jest.fn(),
    removeListeners: jest.fn(),
  })),
}));
```

### 3.3 package.json scripts

```json
{
  "scripts": {
    "test": "jest",
    "test:watch": "jest --watch",
    "test:coverage": "jest --coverage",
    "test:audio": "jest --testPathPattern=Audio"
  }
}
```

---

## 四、运行测试

### 4.1 运行所有测试

```bash
cd {RN_TEST_PROJECT}
npm test
```

### 4.2 运行指定测试文件

```bash
npx jest __tests__/AudioRecorderTest.test.ts
```

### 4.3 运行指定测试套件

```bash
npx jest --testNamePattern="AudioRecorderPrepareTest"
```

### 4.4 监听模式

```bash
npx jest --watch
```

### 4.5 生成覆盖率报告

```bash
npx jest --coverage
```

---

## 五、测试输出说明

### 5.1 通过

```
PASS  __tests__/AudioRecorderTest.test.ts
  AudioRecorderPrepareTest
    ✓ should prepare recording with valid path and options (2 ms)
    ✓ should return false when path is empty (1 ms)
  AudioRecorderAuthorizationTest
    ✓ should resolve authorization to true (1 ms)
```

### 5.2 失败

```
FAIL  __tests__/AudioRecorderTest.test.ts
  ● AudioRecorderPrepareTest › should prepare recording with valid path and options
    expect(jest.fn()).toHaveBeenCalledWith(expected)
    Expected: "/data/app/files/test.aac", {"AudioEncoding": "aac", "Channels": 1, "SampleRate": 22050}
    Received: "/data/app/files/test.aac", {"AudioEncoding": "aac", "Channels": 2, "SampleRate": 22050}
```

---

## 六、常见问题排查

### 6.1 Mock 未生效

**错误信息**：`TypeError: xxx.prepareRecordingAtPath is not a function`

**解决方案**：
1. 确保 `jest.mock()` 在 `import` 之前
2. Jest 会自动提升 `jest.mock()` 调用，但如果使用变量则不会
3. 检查 Mock 对象是否覆盖了所有导出

### 6.2 TypeScript 类型错误

**错误信息**：`Property 'mockReturnValue' does not exist on type 'xxx'`

**解决方案**：
```typescript
// 使用 as jest.Mock 类型断言
(AudioRecorder.prepareRecordingAtPath as jest.Mock).mockReturnValue(true);
```

### 6.3 测试相互影响

**错误信息**：测试单独运行通过，但批量运行失败

**解决方案**：
1. 在 `beforeEach` 中调用 `jest.clearAllMocks()`
2. 在 `afterEach` 中重置事件回调
3. 不要在测试之间共享可变状态

### 6.4 找不到模块

**错误信息**：`Cannot find module '@react-native-ohos/react-native-audio'`

**解决方案**：
1. 检查 `jest.config.js` 中的 `moduleNameMapper`
2. 检查 `transformIgnorePatterns` 是否包含该模块
3. 确保 `jest.mock()` 中的模块名与实际导入一致

### 6.5 异步测试超时

**错误信息**：`Timeout - Async callback was not invoked within the 5000 ms timeout`

**解决方案**：
```typescript
// 增加超时时间
it('should handle slow async operation', async () => {
  // ...
}, 10000); // 10秒超时
```
