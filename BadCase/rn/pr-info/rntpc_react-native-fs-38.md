# PR #38: fix:解决read接口读取其他格式的文件失败

- **状态**: merged
- **作者**: chenbaodi123
- **创建时间**: 2026-06-25T20:49:29+08:00
- **分支**: br_rnoh0.72 → br_rnoh0.72
- **变更文件数**: 24

## PR 描述

问题原因：read接口以前只能读取text的文件，无法读取其他文件，底层使用readText
解决方案：read接口底层使用readSync

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `OAT.xml` | ? | +4 | -0 |
| `buildEnv.sh` | added | +8 | -0 |
| `example/harmony/build-profile.template.json5` | ? | +1 | -2 |
| `example/harmony/entry/oh-package.json5` | ? | +1 | -2 |
| `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets` | ? | +22 | -4 |
| `example/harmony/entry/src/main/ets/pages/Index.ets` | ? | +22 | -4 |
| `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets` | ? | +22 | -4 |
| `example/harmony/oh-package.json5` | ? | +1 | -1 |
| `example/package.json` | ? | +4 | -3 |
| `harmony/fs/BuildProfile.ets` | ? | +22 | -4 |
| `harmony/fs/hvigorfile.ts` | ? | +22 | -4 |
| `harmony/fs/index.ets` | ? | +22 | -4 |
| `harmony/fs/src/main/cpp/RNFSPackage.h` | ? | +22 | -4 |
| `harmony/fs/src/main/ets/FsPackage.ets` | ? | +22 | -4 |
| `harmony/fs/src/main/ets/FsTurboModule.ts` | ? | +56 | -18 |
| `harmony/fs/src/ohosTest/ets/test/Ability.test.ets` | ? | +22 | -4 |
| `harmony/fs/src/ohosTest/ets/test/List.test.ets` | ? | +22 | -4 |
| `harmony/fs/src/ohosTest/ets/testability/TestAbility.ets` | ? | +22 | -4 |
| `harmony/fs/src/ohosTest/ets/testability/pages/Index.ets` | ? | +22 | -4 |
| `harmony/fs/src/ohosTest/ets/testrunner/OpenHarmonyTestRunner.ets` | ? | +22 | -4 |
| `harmony/fs/src/test/List.test.ets` | ? | +22 | -4 |
| `harmony/fs/src/test/LocalUnit.test.ets` | ? | +22 | -4 |
| `harmony/fs/ts.ets` | ? | +22 | -4 |
| `src/NativeReactNativeFs.ts` | ? | +22 | -4 |

## Diff

### `OAT.xml`

```diff
@@ -34,6 +34,8 @@
                 <filteritem type="filepath" name="index.*" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-config.json5" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filepath" name=".jshintrc" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不添加许可证头"/>
             </filefilter>
             <filefilter name="defaultPolicyFilter" desc="Filters for compatibility，license header policies">
                 <filteritem type="filepath" name="example/.*" desc="示例工程，不添加版权头"/>
@@ -54,6 +56,8 @@
                 <filteritem type="filepath" name="index.*" desc="第三方开源软件源码，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-wrapper.js" desc="工程模板，不修改版权头，以防有修改版权风险"/>
                 <filteritem type="filepath" name="hvigor/hvigor-config.json5" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filepath" name=".jshintrc" desc="工程模板，不修改版权头，以防有修改版权风险"/>
+                <filteritem type="filepath" name="buildEnv.sh" desc="工程模板，不添加许可证头"/>
             </filefilter>
 
             <filefilter name="binaryFileTypePolicyFilter" desc="Filters for copyright header policies">

```

### `buildEnv.sh`

```diff
@@ -0,0 +1,8 @@
+#!/bin/bash
+BUILD_PKG_DIR=example
+BUILD_SAMPLE_DIR=example/harmony
+BUILD_THIRD_PARTY_DIR=harmony/
+
+# BUILD_PKG_DIR: 用来打 tgz 包的工程目录
+# BUILD_SAMPLE_DIR：用来打 har 包的目录
+# BUILD_THIRD_PARTY_DIR：库模块源码目录

```

### `example/harmony/build-profile.template.json5`

```diff
@@ -4,8 +4,7 @@
       {
         "name": 'default',
         "signingConfig": 'default',
-        "compileSdkVersion": '5.0.1(13)',
-        "compatibleSdkVersion": '5.0.1(13)',
+        compatibleSdkVersion: '5.0.0(12)',
         "runtimeOS": 'HarmonyOS'
       },
     ],

```

### `example/harmony/entry/oh-package.json5`

```diff
@@ -5,8 +5,7 @@
   "description": "example description",
   "version": "1.0.0",
   "dependencies": {
-    "@rnoh/react-native-openharmony": "0.72.38",
-//      "@react-native-ohos/react-native-fs": "file:../fs"
+    "@rnoh/react-native-openharmony": "file:../../node_modules/react-native-harmony/react_native_openharmony.har",
     "@react-native-ohos/react-native-fs": "file:../../node_modules/@react-native-ohos/react-native-fs/harmony/fs.har",
   }
 }
\ No newline at end of file

```

### `example/harmony/entry/src/main/ets/entryability/EntryAbility.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import {RNAbility} from '@rnoh/react-native-openharmony';

```

### `example/harmony/entry/src/main/ets/pages/Index.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import {

```

### `example/harmony/entry/src/main/ets/pages/SurfaceDeadlockTest.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 import { RNInstance, JSBundleProvider, RNAbility, RNSurface } from '@rnoh/react-native-openharmony'
 import { CustomComponentBuilder } from "@rnoh/react-native-openharmony/src/main/ets/RNOHCorePackage"

```

### `example/harmony/oh-package.json5`

```diff
@@ -6,7 +6,7 @@
   "repository": {},
   "version": "1.0.0",
   "overrides": {
-    "@rnoh/react-native-openharmony": "0.72.38"
+     "@rnoh/react-native-openharmony": "file:./../node_modules/react-native-harmony/react_native_openharmony.har"
   },
   "dynamicDependencies": {}
 }
\ No newline at end of file

```

### `example/package.json`

```diff
@@ -8,15 +8,16 @@
     "start": "hdc rport tcp:8081 tcp:8081 && react-native start",
     "codegen": "react-native codegen-harmony --rnoh-module-path ./harmony/entry/oh_modules/@rnoh/react-native-openharmony",
     "pack:pkg": "cd ../ && npm run pack && cd ./example",
-    "install:pkg": "npm uninstall @react-native-ohos/react-native-fs && npm run pack:pkg && npm i @react-native-ohos/react-native-fs@file:../react-native-ohos-react-native-fs-2.20.1-rc.2.tgz",
+    "install:pkg": "npm uninstall @react-native-ohos/react-native-fs && npm run pack:pkg && npm i @react-native-ohos/react-native-fs@file:../react-native-ohos-react-native-fs-2.20.1-1.tgz",
     "dev": "npm run codegen && react-native bundle-harmony --dev --minify=false",
     "prod": "npm run codegen && react-native bundle-harmony --dev=false --minify=true",
     "postinstall": "node ./scripts/create-build-profile",
-    "fast:pkg": "cd ../ && npm i --legacy-peer-deps && npm pack && cd ./example && npm i && npm run dev"
+    "fast-install-project": "cd ../ && npm i --force && npm run pack && rm -r node_modules && cd ./example && npm i --force",
+    "fast:pkg": "npm run fast-install-project && npm run dev"
   },
   "dependencies": {
     "@gorhom/portal": "^1.0.14",
-    "@react-native-ohos/react-native-fs": "file:../react-native-ohos-react-native-fs-2.20.1-rc.2.tgz",
+    "@react-native-ohos/react-native-fs": "file:../react-native-ohos-react-native-fs-2.20.1-1.tgz",
     "@rnoh/testerino": "npm:@react-native-oh-tpl/testerino@0.0.9",
     "react": "18.2.0",
     "react-native": "0.72.5",

```

### `harmony/fs/BuildProfile.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 /**

```

### `harmony/fs/hvigorfile.ts`

```diff
@@ -1,6 +1,24 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 export  { harTasks } from '@ohos/hvigor-ohos-plugin';
\ No newline at end of file

```

### `harmony/fs/index.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 import { FsPackage } from './src/main/ets/FsPackage'
 export * from './ts'

```

### `harmony/fs/src/main/cpp/RNFSPackage.h`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 #ifndef FSPACKAGE_H
 #define FSPACKAGE_H

```

### `harmony/fs/src/main/ets/FsPackage.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import { RNPackage, TurboModulesFactory } from '@rnoh/react-native-openharmony/ts';

```

### `harmony/fs/src/main/ets/FsTurboModule.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import { TurboModule, RNOHError, TurboModuleContext } from '@rnoh/react-native-openharmony/ts';
@@ -482,8 +500,9 @@ export class FsTurboModule extends TurboModule implements TM.ReactNativeFs.Spec
   readFile(path: string): Promise<string> {
     this.logger.info('readFile')
     return new Promise((resolve, reject) => {
+      let file: fs.File | null = null;
       try {
-        let file = fs.openSync(path);
+        file = fs.openSync(path);
         let bufSize = this.FOUR_ZERO_NINE_SIX;
         let readSize = this.ZERO;
         let buf = new ArrayBuffer(bufSize);
@@ -499,7 +518,6 @@ export class FsTurboModule extends TurboModule implements TM.ReactNativeFs.Spec
           buffers.push(buffer.from(buf.slice(this.ZERO, readLen)))
           readLen = fs.readSync(file.fd, buf, readOptions);
         }
-        fs.closeSync(file);
         let finalBuf: ArrayBuffer = buffer.concat(buffers).buffer;
         let base64Helper = new util.Base64Helper;
         let result = base64Helper.encodeToStringSync(new Uint8Array(finalBuf));
@@ -507,6 +525,14 @@ export class FsTurboModule extends TurboModule implements TM.ReactNativeFs.Spec
       } catch (e) {
         this.logger.error(`readFile error: ${e?.message}`)
         reject(e);
+      } finally {
+        if (file) {
+          try {
+            fs.closeSync(file);
+          } catch (closeErr: any) {
+            this.logger.error(`readFile close error: ${closeErr?.message}`);
+          }
+        }
       }
     })
   };
@@ -682,19 +708,31 @@ export class FsTurboModule extends TurboModule implements TM.ReactNativeFs.Spec
   // 文件内容部分读
   read(path: string, length: number, position: number): Promise<string> {
     return new Promise((resolve, reject) => {
-      let readTextOption: ReadTextOptions = {
-        offset: position,
-        length: length,
-        encoding: this.UTF_8
-      };
-      fs.readText(path, readTextOption, (err: BusinessError, str: string) => {
-        if (err) {
-          reject('readText failed with error message: ' + err.message + ', error code: ' + err.code);
-        } else {
-          let result = buffer.from(str, this.UTF8).toString(this.BASE64);
-          resolve(result);
+      let file: fs.File | null = null;
+      try {
+        file = fs.openSync(path);
+        let buf = new ArrayBuffer(length);
+        let readOptions: ReadOptions = {
+          offset: position,
+          length: length
+        };
+        let readLen = fs.readSync(file.fd, buf, readOptions);
+        let actualBuf = buf.slice(0, readLen);
+        let base64Helper = new util.Base64Helper();
+        let result = base64Helper.encodeToStringSync(new Uint8Array(actualBuf));
+        resolve(result);
+      } catch (e) {
+        this.logger.error(`read error: ${e?.message}`)
+        reject(e);
+      } finally {
+        if (file) {
+          try {
+            fs.closeSync(file);
+          } catch (closeErr: any) {
+            this.logger.error(`read close error: ${closeErr?.message}`);
+          }
         }
-      });
+      }
     })
   }
 

```

### `harmony/fs/src/ohosTest/ets/test/Ability.test.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import hilog from '@ohos.hilog';

```

### `harmony/fs/src/ohosTest/ets/test/List.test.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import abilityTest from './Ability.test';

```

### `harmony/fs/src/ohosTest/ets/testability/TestAbility.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import UIAbility from '@ohos.app.ability.UIAbility';

```

### `harmony/fs/src/ohosTest/ets/testability/pages/Index.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 @Entry

```

### `harmony/fs/src/ohosTest/ets/testrunner/OpenHarmonyTestRunner.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import hilog from '@ohos.hilog';

```

### `harmony/fs/src/test/List.test.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import localUnitTest from './LocalUnit.test';

```

### `harmony/fs/src/test/LocalUnit.test.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import { describe, beforeAll, beforeEach, afterEach, afterAll, it, expect } from '@ohos/hypium';

```

### `harmony/fs/ts.ets`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 export * from "./src/main/ets/FsPackage"

```

### `src/NativeReactNativeFs.ts`

```diff
@@ -1,7 +1,25 @@
-/*
- * Copyright (c) 2024 Huawei Device Co., Ltd. All rights reserved
- * Use of this source code is governed by a MIT license that can be
- * found in the LICENSE file.
+/**
+ * MIT License
+ *
+ * Copyright (C) 2024 Huawei Device Co., Ltd.
+ *
+ * Permission is hereby granted, free of charge, to any person obtaining a copy
+ * of this software and associated documentation files (the "Software"), to deal
+ * in the Software without restriction, including without limitation the rights
+ * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
+ * copies of the Software, and to permit persons to whom the Software is
+ * furnished to do so, subject to the following conditions:
+ *
+ * The above copyright notice and this permission notice shall be included in all
+ * copies or substantial portions of the Software.
+ *
+ * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
+ * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
+ * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
+ * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
+ * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
+ * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
+ * SOFTWARE.
  */
 
 import type { TurboModule } from 'react-native';

```
