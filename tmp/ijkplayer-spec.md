# ijkplayer 接口规格说明

> **ArkTS 导出项类级条目数 S = 15（类 4 + 接口 11 + 函数 0 + 变量 0），枚举 4（不计入接口统计），方法级接口总数 N = 148，Native 导出 M = 0**

## 1. 鸿蒙原生库概述

状态: 成功

## 2. 入口文件与分析范围

**入口文件：** `./ijkplayer/Index.ets`

**分析涉及的源文件：**
- `./ijkplayer/src/main/ets/ijkplayer/IjkMediaPlayer.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnPreparedListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnCompletionListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnVideoSizeChangedListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnBufferingUpdateListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnErrorListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnInfoListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnSeekCompleteListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/callback/OnTimedTextListener.ets`
- `./ijkplayer/src/main/ets/ijkplayer/common/MessageType.ets`
- `./ijkplayer/src/main/ets/ijkplayer/common/PropertiesType.ets`
- `./ijkplayer/src/main/ets/ijkplayer/utils/LogUtils.ets`

## 3. 对外导出的类

### 3.1 IjkMediaPlayer

> 装饰器：无（普通导出类，可 `new` 实例化，支持单例或多实例模式）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | IjkMediaPlayer | public static OPT_CATEGORY_FORMAT: string = "1" | 静态常量 |
| 2    |  | public static OPT_CATEGORY_CODEC: string = "2" | 静态常量 |
| 3    |  | public static OPT_CATEGORY_SWS: string = "3" | 静态常量 |
| 4    |  | public static OPT_CATEGORY_PLAYER: string = "4" | 静态常量 |
| 5    |  | public static LOOP_INFINITE: string = "0" | 静态常量 |
| 6    |  | public static LOOP_ONCE: string = "1" | 静态常量 |
| 7    |  | public static NOT_PRIORITY: string = "0" | 静态常量 |
| 8    |  | public static PRIORITY: string = "1" | 静态常量 |
| 9    |  | static getInstance(): IjkMediaPlayer | 方法 |
| 10    |  | setContext(context: object, id?: string): void | 方法 |
| 11    |  | setAudioId(id: string): void | 方法 |
| 12    |  | setDebug(open: boolean): void | 方法 |
| 13    |  | setDataSource(url: string): void | 方法 |
| 14    |  | setDataSourceHeader(headers: Map<string, string>): void | 方法 |
| 15    |  | setOption(category: string, key: string, value: string): void | 方法 |
| 16    |  | setOptionLong(category: string, key: string, value: string): void | 方法 |
| 17    |  | prepareAsync(): void | 方法 |
| 18    |  | start(): void | 方法 |
| 19    |  | stop(): void | 方法 |
| 20    |  | pause(): void | 方法 |
| 21    |  | reset(): void | 方法 |
| 22    |  | release(): void | 方法 |
| 23    |  | seekTo(msec: string): void | 方法 |
| 24    |  | setScreenOnWhilePlaying(on: boolean): void | 方法 |
| 25    |  | setSpeed(speed: string): void | 方法 |
| 26    |  | getSpeed(): number | 方法 |
| 27    |  | isPlaying(): boolean | 方法 |
| 28    |  | on(type: AudioInterrupt\|AudioDeviceChange,  callback: Callback<InterruptEvent>): void | 方法 |
| 29    |  | off(type: AudioInterrupt\|AudioDeviceChange): void | 方法 |
| 30    |  | setOnVideoSizeChangedListener(listener: OnVideoSizeChangedListener): void | 方法 |
| 31    |  | setOnPreparedListener(listener: OnPreparedListener): void | 方法 |
| 32    |  | setOnCompletionListener(listener: OnCompletionListener): void | 方法 |
| 33    |  | setOnInfoListener(listener: OnInfoListener): void | 方法 |
| 34    |  | setOnErrorListener(listener: OnErrorListener): void | 方法 |
| 35    |  | setOnBufferingUpdateListener(listener: OnBufferingUpdateListener): void | 方法 |
| 36    |  | setOnSeekCompleteListener(listener: OnSeekCompleteListener): void | 方法 |
| 37    |  | setOnTimedTextListener(listener: OnTimedTextListener): void | 方法 |
| 38    |  | setMessageListener(): void | 方法 |
| 39    |  | getVideoWidth(): number | 方法 |
| 40    |  | getVideoHeight(): number | 方法 |
| 41    |  | getVideoSarNum(): number | 方法 |
| 42    |  | getVideoSarDen(): number | 方法 |
| 43    |  | getDuration(): number | 方法 |
| 44    |  | getCurrentPosition(): number | 方法 |
| 45    |  | getAudioSessionId(): number | 方法 |
| 46    |  | setVolume(leftVolume: string, rightVolume: string): void | 方法 |
| 47    |  | setLoopCount(looping: boolean): void | 方法 |
| 48    |  | isLooping(): boolean | 方法 |
| 49    |  | selectTrack(track: string): void | 方法 |
| 50    |  | deselectTrack(track: string): void | 方法 |
| 51    |  | getVideoDecoder(): number | 方法 |
| 52    |  | getVideoOutputFramesPerSecond(): number | 方法 |
| 53    |  | getVideoDecodeFramesPerSecond(): number | 方法 |
| 54    |  | getVideoCachedDuration(): number | 方法 |
| 55    |  | getAudioCachedDuration(): number | 方法 |
| 56    |  | getVideoCachedBytes(): number | 方法 |
| 57    |  | getAudioCachedBytes(): number | 方法 |
| 58    |  | getVideoCachedPackets(): number | 方法 |
| 59    |  | getAudioCachedPackets(): number | 方法 |
| 60    |  | getAsyncStatisticBufBackwards(): number | 方法 |
| 61    |  | getAsyncStatisticBufForwards(): number | 方法 |
| 62    |  | getAsyncStatisticBufCapacity(): number | 方法 |
| 63    |  | getTrafficStatisticByteCount(): number | 方法 |
| 64    |  | getCacheStatisticPhysicalPos(): number | 方法 |
| 65    |  | getCacheStatisticFileForwards(): number | 方法 |
| 66    |  | getCacheStatisticFilePos(): number | 方法 |
| 67    |  | getCacheStatisticCountBytes(): number | 方法 |
| 68    |  | getFileSize(): number | 方法 |
| 69    |  | getBitRate(): number | 方法 |
| 70    |  | getTcpSpeed(): number | 方法 |
| 71    |  | getSeekLoadDuration(): number | 方法 |
| 72    |  | getDropFrameRate(): number | 方法 |
| 73    |  | setCacheShare(share: string): void | 方法 |
| 74    |  | getMediaInfo(): object | 方法 |
| 75    |  | native_setup(mode?: VideoCodecMode): void | 方法 |
| 76    |  | startRecord(saveFilePath: string): boolean | 方法 |
| 77    |  | stopRecord(): Promise<boolean> | 方法 |
| 78    |  | isRecord(): boolean | 方法 |
| 79    |  | screenshot(saveFilePath: string): Promise<boolean> | 方法 |
| 80    |  | stopAsync(): Promise<boolean> | 方法 |
| 81    |  | releaseAsync(): Promise<boolean> | 方法 |
| 82    |  | setRecordDefaultFrameRate(frameRate: string, isPriority: boolean): boolean | 方法 |

### 3.2 MessageType

> 装饰器：无（普通导出类，全部为静态成员，不可实例化）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | MessageType | static MEDIA_PREPARED: number = 1 | 静态常量 |
| 2    |  | static MEDIA_PLAYBACK_COMPLETE: number = 2 | 静态常量 |
| 3    |  | static MEDIA_BUFFERING_UPDATE: number = 3 | 静态常量 |
| 4    |  | static MEDIA_SEEK_COMPLETE: number = 4 | 静态常量 |
| 5    |  | static MEDIA_SET_VIDEO_SIZE: number = 5 | 静态常量 |
| 6    |  | static MEDIA_TIMED_TEXT: number = 99 | 静态常量 |
| 7    |  | static MEDIA_ERROR: number = 100 | 静态常量 |
| 8    |  | static MEDIA_INFO: number = 200 | 静态常量 |
| 9    |  | static MEDIA_AUDIO_INTERRUPT: number = 201 | 静态常量 |
| 10    |  | static MEDIA_AUDIO_DEVICE_CHANGE: number = 202 | 静态常量 |
| 11    |  | static MEDIA_SET_VIDEO_SAR: number = 10001 | 静态常量 |

### 3.3 PropertiesType

> 装饰器：无（普通导出类，全部为静态成员，不可实例化）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | PropertiesType | static PROP_FLOAT_VIDEO_DECODE_FRAMES_PER_SECOND: string = "10001" | 静态常量 |
| 2    |  | static PROP_FLOAT_VIDEO_OUTPUT_FRAMES_PER_SECOND: string = "10002" | 静态常量 |
| 3    |  | static FFP_PROP_FLOAT_PLAYBACK_RATE: string = "10003" | 静态常量 |
| 4    |  | static FFP_PROP_FLOAT_DROP_FRAME_RATE: string = "10007" | 静态常量 |
| 5    |  | static FFP_PROP_INT64_SELECTED_VIDEO_STREAM: string = "20001" | 静态常量 |
| 6    |  | static FFP_PROP_INT64_SELECTED_AUDIO_STREAM: string = "20002" | 静态常量 |
| 7    |  | static FFP_PROP_INT64_SELECTED_TIMEDTEXT_STREAM: string = "20011" | 静态常量 |
| 8    |  | static FFP_PROP_INT64_VIDEO_DECODER: string = "20003" | 静态常量 |
| 9    |  | static FFP_PROP_INT64_AUDIO_DECODER: string = "20004" | 静态常量 |
| 10    |  | static FFP_PROPV_DECODER_UNKNOWN: string = "0" | 静态常量 |
| 11    |  | static FFP_PROPV_DECODER_AVCODEC: string = "1" | 静态常量 |
| 12    |  | static FFP_PROPV_DECODER_MEDIACODEC: string = "2" | 静态常量 |
| 13    |  | static FFP_PROPV_DECODER_VIDEOTOOLBOX: string = "3" | 静态常量 |
| 14    |  | static FFP_PROP_INT64_VIDEO_CACHED_DURATION: string = "20005" | 静态常量 |
| 15    |  | static FFP_PROP_INT64_AUDIO_CACHED_DURATION: string = "20006" | 静态常量 |
| 16    |  | static FFP_PROP_INT64_VIDEO_CACHED_BYTES: string = "20007" | 静态常量 |
| 17    |  | static FFP_PROP_INT64_AUDIO_CACHED_BYTES: string = "20008" | 静态常量 |
| 18    |  | static FFP_PROP_INT64_VIDEO_CACHED_PACKETS: string = "20009" | 静态常量 |
| 19    |  | static FFP_PROP_INT64_AUDIO_CACHED_PACKETS: string = "20010" | 静态常量 |
| 20    |  | static FFP_PROP_INT64_ASYNC_STATISTIC_BUF_BACKWARDS: string = "20201" | 静态常量 |
| 21    |  | static FFP_PROP_INT64_ASYNC_STATISTIC_BUF_FORWARDS: string = "20202" | 静态常量 |
| 22    |  | static FFP_PROP_INT64_ASYNC_STATISTIC_BUF_CAPACITY: string = "20203" | 静态常量 |
| 23    |  | static FFP_PROP_INT64_TRAFFIC_STATISTIC_BYTE_COUNT: string = "20204" | 静态常量 |
| 24    |  | static FFP_PROP_INT64_CACHE_STATISTIC_PHYSICAL_POS: string = "20205" | 静态常量 |
| 25    |  | static FFP_PROP_INT64_CACHE_STATISTIC_FILE_FORWARDS: string = "20206" | 静态常量 |
| 26    |  | static FFP_PROP_INT64_CACHE_STATISTIC_FILE_POS: string = "20207" | 静态常量 |
| 27    |  | static FFP_PROP_INT64_CACHE_STATISTIC_COUNT_BYTES: string = "20208" | 静态常量 |
| 28    |  | static FFP_PROP_INT64_LOGICAL_FILE_SIZE: string = "20209" | 静态常量 |
| 29    |  | static FFP_PROP_INT64_SHARE_CACHE_DATA: string = "20210" | 静态常量 |
| 30    |  | static FFP_PROP_INT64_BIT_RATE: string = "20100" | 静态常量 |
| 31    |  | static FFP_PROP_INT64_TCP_SPEED: string = "20200" | 静态常量 |
| 32    |  | static FFP_PROP_INT64_LATEST_SEEK_LOAD_DURATION: string = "20300" | 静态常量 |
| 33    |  | static FFP_PROP_INT64_IMMEDIATE_RECONNECT: string = "20211" | 静态常量 |

### 3.4 LogUtils

> 装饰器：无（普通导出类，可 `new` 实例化，支持单例或多实例模式）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | LogUtils | public static readonly TAG: string = "ijkplayer:js" | 静态常量 |
| 2    |  | public static readonly DOMAIN: number = 0xD002220 | 静态常量 |
| 3    |  | static getInstance(): void | 方法 |
| 4    |  | setLogSwitch(logOpen: boolean): void | 方法 |
| 5    |  | LOGI(message: string, ...args: Object[]): void | 方法 |
| 6    |  | debug(message: string, ...args: Object[]): void | 方法 |
| 7    |  | info(message: string, ...args: Object[]): void | 方法 |
| 8    |  | warn(message: string, ...args: Object[]): void | 方法 |
| 9    |  | error(message: string, ...args: Object[]): void | 方法 |

## 4. 对外导出的接口/类型

### 4.1 InterruptEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | InterruptEvent | interface | forceType? | InterruptForceType | 否 | - |
| 2    |  | interface | hintType? | InterruptHintType | 否 | - |
| 3    |  | interface | reason? | DeviceChangeReason | 否 | - |

### 4.2 OnPreparedListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnPreparedListener | interface | onPrepared | () => void | 否 | - |

### 4.3 OnCompletionListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnCompletionListener | interface | onCompletion | () => void | 否 | - |

### 4.4 OnVideoSizeChangedListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnVideoSizeChangedListener | interface | onVideoSizeChanged | (width: number, height: number, sar_num: number, sar_den: number) => void | 否 | - |

### 4.5 OnBufferingUpdateListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnBufferingUpdateListener | interface | onBufferingUpdate | (percent: number) => void | 否 | - |

### 4.6 OnErrorListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnErrorListener | interface | onError | (what: number, extra: number) => void | 否 | - |

### 4.7 OnInfoListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnInfoListener | interface | onInfo | (what: number, extra: number) => void | 否 | - |

### 4.8 OnSeekCompleteListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnSeekCompleteListener | interface | onSeekComplete | () => void | 否 | - |

### 4.9 OnTimedTextListener (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | OnTimedTextListener | interface | onTimedText | (text: string) => void | 否 | - |

### 4.10 AudioInterrupt (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioInterrupt | type | — | 'audioInterrupt' | 是 | - |

### 4.11 AudioDeviceChange (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioDeviceChange | type | — | 'deviceChange' | 是 | - |

## 5. UI 组件装饰器兼容性

无。本库未导出 @Component/@ComponentV2 struct 组件。

## 6. 对外导出的函数

无。

## 7. 对外导出的变量/常量

无。

## 8. Native 模块导出

> 无 Native 模块导出。

## 9. 注意事项

{PENDING}

## 10. 枚举导出（不计入接口统计）

> 以下枚举为类型定义，非可调用的 API，**不纳入 S/N 接口统计**，仅作导出清单展示。

| 序号 | 枚举名 | 源文件 | 枚举值 | 功能描述 |
|------|--------|--------|--------|----------|
| 1    | InterruptHintType | `./ijkplayer/src/main/ets/ijkplayer/IjkMediaPlayer.ets` | `INTERRUPT_HINT_NONE = 0, INTERRUPT_HINT_RESUME = 1, INTERRUPT_HINT_PAUSE = 2, INTERRUPT_HINT_STOP = 3, INTERRUPT_HINT_DUCK = 4, INTERRUPT_HINT_UNDUCK = 5` | - |
| 2    | InterruptForceType | `./ijkplayer/src/main/ets/ijkplayer/IjkMediaPlayer.ets` | `INTERRUPT_FORCE = 0, INTERRUPT_SHARE = 1` | - |
| 3    | DeviceChangeReason | `./ijkplayer/src/main/ets/ijkplayer/IjkMediaPlayer.ets` | `/* Unknown. */, REASON_UNKNOWN = 0, /* New Device available. */, REASON_NEW_DEVICE_AVAILABLE = 1, /* Old Device unavailable. Applications should consider to pause the audio playback when this reason is, reported. */, REASON_OLD_DEVICE_UNAVAILABLE = 2, /* Device is overrode by user or system. */, REASON_OVERRODE = 3` | - |
| 4    | VideoCodecMode | `./ijkplayer/src/main/ets/ijkplayer/IjkMediaPlayer.ets` | `BUFFER = 0, SURFACE = 1` | - |

---
{PENDING}
