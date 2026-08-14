# webrtc 接口规格说明

> **ArkTS 导出项类级条目数 S = 144（类 26 + 接口 118 + 函数 0 + 变量 0），枚举 2（不计入接口统计），方法级接口总数 N = 513，Native 导出 M = 0（Native 声明为 .d.ts，已计入 N）**

## 1. 鸿蒙原生库概述

状态: 成功

## 2. 入口文件与分析范围

**入口文件：** `./ohos_webrtc/Index.ets`

**分析涉及的源文件：**
- `./ohos_webrtc/src/main/libohos_webrtc/index.d.ts`
- `./ohos_webrtc/src/main/libohos_webrtc/webrtc.d.ts`
- `./ohos_webrtc/src/main/ets/log/Logging.ets`
- `./ohos_webrtc/src/main/ets/xcomponent/VideoRenderController.ets`

## 3. 对外导出的类

### 3.1 Logging

> 装饰器：无（普通导出类，全部为静态成员，不可实例化）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | Logging | static injectLoggable(injectedLoggable: Loggable, severity: LoggingSeverity): void | 方法 |
| 2    |  | static deleteInjectedLoggable(): void | 方法 |
| 3    |  | static enableLogThreads(): void | 方法 |
| 4    |  | static enableLogTimeStamps(): void | 方法 |
| 5    |  | static enableLogToDebugOutput(severity: LoggingSeverity): void | 方法 |
| 6    |  | static log(severity: LoggingSeverity, tag: string, message: string): void | 方法 |
| 7    |  | static d(tag: string, message: string): void | 方法 |
| 8    |  | static e(tag: string, message: string, e?: Error): void | 方法 |
| 9    |  | static w(tag: string, message: string, e: Error): void | 方法 |
| 10    |  | static v(tag: string, message: string): void | 方法 |

### 3.2 VideoRenderController

> 装饰器：无（普通导出类，可 `new` 实例化，支持单例或多实例模式）

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | VideoRenderController | setVideoTrack(track: MediaStreamTrack \| null): void | 方法 |
| 2    |  | setMirror(mirror: boolean): void | 方法 |
| 3    |  | setMirrorVertically(mirrorVertically: boolean): void | 方法 |
| 4    |  | setScalingMode(mode: ScalingMode): void | 方法 |
| 5    |  | onSurfaceCreated(surfaceId: string): void | 方法 |
| 6    |  | onSurfaceChanged(surfaceId: string, rect: SurfaceRect): void | 方法 |
| 7    |  | onSurfaceDestroyed(surfaceId: string): void | 方法 |

### 3.3 RTCSessionDescription（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCSessionDescription | readonly sdp: string | 属性 |
| 2    |  | readonly type: RTCSdpType | 属性 |
| 3    |  | toJSON(): RTCSessionDescriptionInit | 方法 |

### 3.4 RTCIceCandidate（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCIceCandidate | readonly candidate: string | 属性 |
| 2    |  | readonly sdpMid?: string | 属性 |
| 3    |  | readonly sdpMLineIndex?: number | 属性 |
| 4    |  | readonly foundation?: string | 属性 |
| 5    |  | readonly component?: RTCIceComponent | 属性 |
| 6    |  | readonly priority?: number | 属性 |
| 7    |  | readonly address?: string | 属性 |
| 8    |  | readonly protocol?: RTCIceProtocol | 属性 |
| 9    |  | readonly port?: number | 属性 |
| 10    |  | readonly type?: RTCIceCandidateType | 属性 |
| 11    |  | readonly tcpType?: RTCIceTcpCandidateType | 属性 |
| 12    |  | readonly relatedAddress?: string | 属性 |
| 13    |  | readonly relatedPort?: number | 属性 |
| 14    |  | readonly usernameFragment?: string | 属性 |
| 15    |  | toJSON(): RTCIceCandidateInit | 方法 |

### 3.5 RTCDataChannel（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCDataChannel | readonly label: string | 属性 |
| 2    |  | readonly ordered: boolean | 属性 |
| 3    |  | readonly maxPacketLifeTime?: number | 属性 |
| 4    |  | readonly maxRetransmits?: number | 属性 |
| 5    |  | readonly protocol: string | 属性 |
| 6    |  | readonly negotiated: boolean | 属性 |
| 7    |  | readonly id?: number | 属性 |
| 8    |  | readonly readyState: DataChannelState | 属性 |
| 9    |  | readonly bufferedAmount: number | 属性 |
| 10    |  | bufferedAmountLowThreshold: number | 属性 |
| 11    |  | binaryType: BinaryType | 属性 |
| 12    |  | onbufferedamountlow: ((this: RTCDataChannel, ev: Event) => any) \| null | 事件回调属性 |
| 13    |  | onclose: ((this: RTCDataChannel, ev: Event) => any) \| null | 事件回调属性 |
| 14    |  | onclosing: ((this: RTCDataChannel, ev: Event) => any) \| null | 事件回调属性 |
| 15    |  | onopen: ((this: RTCDataChannel, ev: Event) => any) \| null | 事件回调属性 |
| 16    |  | onmessage: ((this: RTCDataChannel, ev: MessageEvent<any>) => any) \| null | 事件回调属性 |
| 17    |  | onerror: ((this: RTCDataChannel, ev: RTCErrorEvent) => any) \| null | 事件回调属性 |
| 18    |  | close(): void | 方法 |
| 19    |  | send(data: string): void | 方法 |
| 20    |  | send(data: ArrayBuffer): void | 方法 |

### 3.6 RTCPeerConnection（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCPeerConnection | static generateCertificate(keygenAlgorithm: AlgorithmIdentifier): Promise<RTCCertificate> | 静态方法 |
| 2    |  | readonly canTrickleIceCandidates?: boolean | 属性 |
| 3    |  | readonly signalingState: RTCSignalingState | 属性 |
| 4    |  | readonly iceGatheringState: RTCIceGatheringState | 属性 |
| 5    |  | readonly iceConnectionState: RTCIceConnectionState | 属性 |
| 6    |  | readonly connectionState: RTCPeerConnectionState | 属性 |
| 7    |  | readonly localDescription?: RTCSessionDescription | 属性 |
| 8    |  | readonly remoteDescription?: RTCSessionDescription | 属性 |
| 9    |  | readonly currentLocalDescription?: RTCSessionDescription | 属性 |
| 10    |  | readonly currentRemoteDescription?: RTCSessionDescription | 属性 |
| 11    |  | readonly pendingLocalDescription?: RTCSessionDescription | 属性 |
| 12    |  | readonly pendingRemoteDescription?: RTCSessionDescription | 属性 |
| 13    |  | readonly sctp?: RTCSctpTransport | 属性 |
| 14    |  | onnegotiationneeded: ((this: RTCPeerConnection, ev: Event) => any) \| null | 事件回调属性 |
| 15    |  | onicecandidate: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceEvent) => any) \| null | 事件回调属性 |
| 16    |  | onicecandidateerror: ((this: RTCPeerConnection, ev: RTCPeerConnectionIceErrorEvent) => any) \| null | 事件回调属性 |
| 17    |  | oniceconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) \| null | 事件回调属性 |
| 18    |  | onicegatheringstatechange: ((this: RTCPeerConnection, ev: Event) => any) \| null | 事件回调属性 |
| 19    |  | onsignalingstatechange: ((this: RTCPeerConnection, ev: Event) => any) \| null | 事件回调属性 |
| 20    |  | onconnectionstatechange: ((this: RTCPeerConnection, ev: Event) => any) \| null | 事件回调属性 |
| 21    |  | ontrack: ((this: RTCPeerConnection, ev: RTCTrackEvent) => any) \| null | 事件回调属性 |
| 22    |  | ondatachannel: ((this: RTCPeerConnection, ev: RTCDataChannelEvent) => any) \| null | 事件回调属性 |
| 23    |  | addTrack(track: MediaStreamTrack, ...streams: MediaStream[]): RTCRtpSender | 方法 |
| 24    |  | removeTrack(sender: RTCRtpSender): void | 方法 |
| 25    |  | setLocalDescription(description?: RTCSessionDescriptionInit): Promise<void> | 方法 |
| 26    |  | setRemoteDescription(description: RTCSessionDescriptionInit): Promise<void> | 方法 |
| 27    |  | createOffer(options?: RTCOfferOptions): Promise<RTCSessionDescriptionInit> | 方法 |
| 28    |  | createAnswer(options?: RTCAnswerOptions): Promise<RTCSessionDescriptionInit> | 方法 |
| 29    |  | createDataChannel(label: string, dataChannelDict?: RTCDataChannelInit): RTCDataChannel | 方法 |
| 30    |  | addIceCandidate(candidate?: RTCIceCandidateInit): Promise<void> | 方法 |
| 31    |  | getSenders(): RTCRtpSender[] | 方法 |
| 32    |  | getReceivers(): RTCRtpReceiver[] | 方法 |
| 33    |  | getTransceivers(): RTCRtpTransceiver[] | 方法 |
| 34    |  | getConfiguration(): RTCConfiguration | 方法 |
| 35    |  | restartIce(): void | 方法 |
| 36    |  | setConfiguration(configuration?: RTCConfiguration): void | 方法 |
| 37    |  | addTransceiver(trackOrKind: MediaStreamTrack \| string, init?: RTCRtpTransceiverInit): RTCRtpTransceiver | 方法 |
| 38    |  | close(): void | 方法 |
| 39    |  | getStats(selector?: MediaStreamTrack): Promise<RTCStatsReport> | 方法 |
| 40    |  | setAudioRecording(recording: boolean): void | 方法 |
| 41    |  | setAudioPlayout(playout: boolean): void | 方法 |

### 3.7 RTCRtpReceiver（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCRtpReceiver | static getCapabilities(kind: string): RTCRtpCapabilities \| null | 静态方法 |
| 2    |  | readonly track: MediaStreamTrack | 属性 |
| 3    |  | readonly transport: RTCDtlsTransport \| null | 属性 |
| 4    |  | readonly id: string \| null | 属性 |
| 5    |  | getParameters(): RTCRtpReceiveParameters | 方法 |
| 6    |  | getStats(): Promise<RTCStatsReport> | 方法 |
| 7    |  | getContributingSources(): RTCRtpContributingSource[] | 方法 |
| 8    |  | getSynchronizationSources(): RTCRtpSynchronizationSource[] | 方法 |

### 3.8 RTCRtpSender（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCRtpSender | static getCapabilities(kind: string): RTCRtpCapabilities \| null | 静态方法 |
| 2    |  | readonly track: MediaStreamTrack \| null | 属性 |
| 3    |  | readonly transport: RTCDtlsTransport \| null | 属性 |
| 4    |  | readonly dtmf: RTCDTMFSender \| null | 属性 |
| 5    |  | readonly id: string \| null | 属性 |
| 6    |  | setParameters(parameters: RTCRtpSendParameters): Promise<void> | 方法 |
| 7    |  | getParameters(): RTCRtpSendParameters | 方法 |
| 8    |  | replaceTrack(withTrack: MediaStreamTrack \| null): Promise<void> | 方法 |
| 9    |  | setStreams(...streams: MediaStream[]): void | 方法 |
| 10    |  | getStats(): Promise<RTCStatsReport> | 方法 |

### 3.9 RTCDTMFSender（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCDTMFSender | readonly canInsertDTMF: boolean | 属性 |
| 2    |  | readonly toneBuffer: string | 属性 |
| 3    |  | ontonechange: ((this: RTCDTMFSender, ev: RTCDTMFToneChangeEvent) => any) \| null | 事件回调属性 |
| 4    |  | insertDTMF(tones: string, duration?: number, interToneGap?: number): void | 方法 |

### 3.10 RTCRtpTransceiver（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCRtpTransceiver | readonly mid: string \| null | 属性 |
| 2    |  | readonly sender: RTCRtpSender | 属性 |
| 3    |  | readonly receiver: RTCRtpReceiver | 属性 |
| 4    |  | direction: RTCRtpTransceiverDirection | 属性 |
| 5    |  | readonly currentDirection: RTCRtpTransceiverDirection \| null | 属性 |
| 6    |  | stop(): void | 方法 |
| 7    |  | setCodecPreferences(codecs: RTCRtpCodec[]): void | 方法 |

### 3.11 RTCDtlsTransport（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCDtlsTransport | readonly iceTransport: RTCIceTransport | 属性 |
| 2    |  | readonly state: RTCDtlsTransportState | 属性 |
| 3    |  | onstatechange: ((this: RTCDtlsTransport, ev: Event) => any) \| null | 事件回调属性 |
| 4    |  | onerror: ((this: RTCDtlsTransport, ev: RTCErrorEvent) => any) \| null | 事件回调属性 |
| 5    |  | getRemoteCertificates(): ArrayBuffer[] | 方法 |

### 3.12 RTCCertificate（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCCertificate | readonly expires: EpochTimeStamp | 属性 |
| 2    |  | getFingerprints(): RTCDtlsFingerprint[] | 方法 |

### 3.13 RTCIceTransport（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCIceTransport | readonly role: RTCIceRole | 属性 |
| 2    |  | readonly component: RTCIceComponent | 属性 |
| 3    |  | readonly state: RTCIceTransportState | 属性 |
| 4    |  | readonly gatheringState: RTCIceGathererState | 属性 |
| 5    |  | onstatechange: ((this: RTCIceTransport, ev: Event) => any) \| null | 事件回调属性 |
| 6    |  | ongatheringstatechange: ((this: RTCIceTransport, ev: Event) => any) \| null | 事件回调属性 |
| 7    |  | onselectedcandidatepairchange: ((this: RTCIceTransport, ev: Event) => any) \| null | 事件回调属性 |
| 8    |  | getSelectedCandidatePair(): RTCIceCandidatePair \| null | 方法 |

### 3.14 RTCSctpTransport（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | RTCSctpTransport | readonly maxChannels?: number | 属性 |
| 2    |  | readonly maxMessageSize: number | 属性 |
| 3    |  | readonly state: RTCSctpTransportState | 属性 |
| 4    |  | readonly transport: RTCDtlsTransport | 属性 |
| 5    |  | onstatechange: ((this: RTCSctpTransport, ev: Event) => any) \| null | 事件回调属性 |

### 3.15 MediaStreamTrack（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | MediaStreamTrack | readonly kind: string | 属性 |
| 2    |  | readonly id: string | 属性 |
| 3    |  | enabled: boolean | 属性 |
| 4    |  | readonly readyState: MediaStreamTrackState | 属性 |
| 5    |  | stop(): void | 方法 |
| 6    |  | getSource(): MediaSource \| null | 方法 |
| 7    |  | applyConstraints(constraints: MediaTrackConstraints): Promise<void> | 方法 |

### 3.16 MediaStream（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | MediaStream | readonly id: string | 属性 |
| 2    |  | readonly active: boolean | 属性 |
| 3    |  | addTrack(track: MediaStreamTrack): void | 方法 |
| 4    |  | removeTrack(track: MediaStreamTrack): void | 方法 |
| 5    |  | getTrackById(trackId: string): MediaStreamTrack \| null | 方法 |
| 6    |  | getTracks(): MediaStreamTrack[] | 方法 |
| 7    |  | getAudioTracks(): MediaStreamTrack[] | 方法 |
| 8    |  | getVideoTracks(): MediaStreamTrack[] | 方法 |

### 3.17 MediaDevices（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | MediaDevices | enumerateDevices(): Promise<MediaDeviceInfo[]> | 方法 |
| 2    |  | getSupportedConstraints(): MediaTrackSupportedConstraints | 方法 |
| 3    |  | getUserMedia(constraints?: MediaStreamConstraints): Promise<MediaStream> | 方法 |
| 4    |  | getDisplayMedia(options?: DisplayMediaStreamOptions): Promise<MediaStream> | 方法 |

### 3.18 NativeVideoRenderer（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | NativeVideoRenderer | readonly surfaceId?: string | 属性 |
| 2    |  | readonly videoTrack?: MediaStreamTrack | 属性 |
| 3    |  | onFrameResolutionChanged: ((this: NativeVideoRenderer, ev: Event) => any) \| null | 事件回调属性 |
| 4    |  | init(surfaceId: string): void | 方法 |
| 5    |  | setVideoTrack(videoTrack: MediaStreamTrack \| null): void | 方法 |
| 6    |  | setMirror(mirrorHorizontally: boolean): void | 方法 |
| 7    |  | setMirrorVertically(mirrorVertically: boolean): void | 方法 |
| 8    |  | setScalingMode(mode: number): void | 方法 |
| 9    |  | release(): void | 方法 |

### 3.19 AudioDeviceModule（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | AudioDeviceModule | static isBuiltInAcousticEchoCancelerSupported(): boolean | 静态方法 |
| 2    |  | static isBuiltInNoiseSuppressorSupported(): boolean | 静态方法 |
| 3    |  | oncapturererror: ((this: AudioDeviceModule, event: AudioErrorEvent) => void) \| null | 事件回调属性 |
| 4    |  | oncapturerstatechange: ((this: AudioDeviceModule, event: AudioStateChangeEvent) => void) \| null | 事件回调属性 |
| 5    |  | oncapturersamplesready: ((this: AudioDeviceModule, event: AudioCapturerSamplesReadyEvent) => void) \| null | 事件回调属性 |
| 6    |  | onrenderererror: ((this: AudioDeviceModule, event: AudioErrorEvent) => void) \| null | 事件回调属性 |
| 7    |  | onrendererstatechange: ((this: AudioDeviceModule, event: AudioStateChangeEvent) => void) \| null | 事件回调属性 |
| 8    |  | setSpeakerMute(mute: boolean): void | 方法 |
| 9    |  | setMicrophoneMute(mute: boolean): void | 方法 |
| 10    |  | setNoiseSuppressorEnabled(enabled: boolean): boolean | 方法 |
| 11    |  | release(): void | 方法 |

### 3.20 AudioProcessingFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | AudioProcessingFactory | create(): AudioProcessing | 方法 |

### 3.21 HardwareVideoEncoderFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | HardwareVideoEncoderFactory | readonly enableH264HighProfile: boolean | 属性 |

### 3.22 SoftwareVideoEncoderFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | SoftwareVideoEncoderFactory | — | 类描述 |

### 3.23 HardwareVideoDecoderFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | HardwareVideoDecoderFactory | — | 类描述 |

### 3.24 SoftwareVideoDecoderFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | SoftwareVideoDecoderFactory | — | 类描述 |

### 3.25 PeerConnectionFactory（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | PeerConnectionFactory | static getDefault(): PeerConnectionFactory | 静态方法 |
| 2    |  | static setDefault(factory: PeerConnectionFactory): void | 静态方法 |
| 3    |  | createPeerConnection(config: RTCConfiguration): RTCPeerConnection | 方法 |
| 4    |  | createAudioSource(constraints?: MediaTrackConstraints): AudioSource | 方法 |
| 5    |  | createAudioTrack(id: string, source: AudioSource): AudioTrack | 方法 |
| 6    |  | createVideoSource(constraints?: MediaTrackConstraints, isScreencast?: boolean): VideoSource | 方法 |
| 7    |  | createVideoTrack(id: string, source: VideoSource): VideoTrack | 方法 |
| 8    |  | startAecDump(fd: number, max_size_bytes: number): boolean | 方法 |
| 9    |  | stopAecDump(): void | 方法 |

### 3.26 NativeLogging（.d.ts 类）

> 来源：`declared in .d.ts`，可 `new` 实例化。
> 装饰器：无（Native 类型声明类）。
> ⚠️ **new 构造签名不列入表格（构造函数不计入 N）**，仅由 `declare var` 判定可 new。

| 序号 | 类名/成员 | 方法/属性 | 功能描述 |
|------|-----------|-----------|----------|
| 1    | NativeLogging | static static injectLoggable(loggable: Loggable, severity: number): void | 静态方法 |
| 2    |  | static static deleteLoggable(): void | 静态方法 |
| 3    |  | static static enableLogToDebugOutput(severity: number): void | 静态方法 |
| 4    |  | static static enableLogThreads(): void | 静态方法 |
| 5    |  | static static enableLogTimeStamps(): void | 静态方法 |
| 6    |  | static static log(message: string, severity: number, tag: string): void | 静态方法 |

## 4. 对外导出的接口/类型

### 4.1 ULongRange (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ULongRange | interface | max? | number | 否 | - |
| 2    |  | interface | min? | number | 否 | - |

### 4.2 DoubleRange (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DoubleRange | interface | max? | number | 否 | - |
| 2    |  | interface | min? | number | 否 | - |

### 4.3 ConstrainBooleanParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainBooleanParameters | interface | exact? | boolean | 否 | - |
| 2    |  | interface | ideal? | boolean | 否 | - |

### 4.4 ConstrainStringParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainStringParameters | interface | exact? | string \| string[] | 否 | - |
| 2    |  | interface | ideal? | string \| string[] | 否 | - |

### 4.5 ConstrainDoubleRange (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainDoubleRange | interface | exact? | number | 否 | - |
| 2    |  | interface | ideal? | number | 否 | - |

### 4.6 ConstrainULongRange (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainULongRange | interface | exact? | number | 否 | - |
| 2    |  | interface | ideal? | number | 否 | - |

### 4.7 Event (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | Event | interface | type | string | 是 | - |

### 4.8 EventTarget (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | EventTarget | interface | — | — | — | 空接口（无字段） |

### 4.9 RTCErrorInit (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCErrorInit | interface | errorDetail | RTCErrorDetailType | 是 | - |
| 2    |  | interface | sdpLineNumber? | number | 否 | - |
| 3    |  | interface | sctpCauseCode? | number | 否 | - |
| 4    |  | interface | receivedAlert? | number | 否 | - |
| 5    |  | interface | sentAlert? | number | 否 | - |

### 4.10 RTCError (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCError | interface | errorDetail | RTCErrorDetailType | 是 | - |
| 2    |  | interface | sdpLineNumber? | number | 否 | - |
| 3    |  | interface | sctpCauseCode? | number | 否 | - |
| 4    |  | interface | receivedAlert? | number | 否 | - |
| 5    |  | interface | sentAlert? | number | 否 | - |

### 4.11 RTCErrorEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCErrorEvent | interface | error | RTCError | 是 | - |

### 4.12 RTCTrackEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCTrackEvent | interface | receiver | RTCRtpReceiver | 是 | - |
| 2    |  | interface | track | MediaStreamTrack | 是 | - |
| 3    |  | interface | streams | ReadonlyArray<MediaStream> | 是 | - |
| 4    |  | interface | transceiver | RTCRtpTransceiver | 是 | - |

### 4.13 RTCPeerConnectionIceEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCPeerConnectionIceEvent | interface | candidate? | RTCIceCandidate | 否 | - |
| 2    |  | interface | url? | string \| null | 否 | - |

### 4.14 RTCPeerConnectionIceErrorEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCPeerConnectionIceErrorEvent | interface | address? | string | 否 | - |
| 2    |  | interface | port? | number | 否 | - |
| 3    |  | interface | url? | string | 否 | - |
| 4    |  | interface | errorCode? | number | 否 | - |
| 5    |  | interface | errorText? | string | 否 | - |

### 4.15 RTCDataChannelEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCDataChannelEvent | interface | channel | RTCDataChannel | 是 | - |

### 4.16 RTCDTMFToneChangeEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCDTMFToneChangeEvent | interface | tone | string | 是 | - |

### 4.17 MessageEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MessageEvent | interface | data | T | 是 | - |

### 4.18 MediaStreamTrackEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaStreamTrackEvent | interface | track | MediaStreamTrack | 是 | - |

### 4.19 VideoCapturerStartedEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoCapturerStartedEvent | interface | success | boolean | 是 | - |

### 4.20 CameraSwitchDoneEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | CameraSwitchDoneEvent | interface | newCameraId | string | 是 | - |

### 4.21 CameraSwitchErrorEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | CameraSwitchErrorEvent | interface | errorMessage | string | 是 | - |

### 4.22 Algorithm (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | Algorithm | interface | name | string | 是 | - |

### 4.23 RTCRtpTransceiverInit (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpTransceiverInit | interface | direction? | RTCRtpTransceiverDirection | 否 | - |
| 2    |  | interface | streams? | MediaStream[] | 否 | - |
| 3    |  | interface | sendEncodings? | RTCRtpEncodingParameters[] | 否 | - |

### 4.24 RTCSessionDescriptionInit (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCSessionDescriptionInit | interface | sdp? | string | 否 | - |
| 2    |  | interface | type | RTCSdpType | 是 | - |

### 4.25 RTCIceCandidateInit (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceCandidateInit | interface | candidate | string | 是 | - |
| 2    |  | interface | sdpMLineIndex? | number | 否 | - |
| 3    |  | interface | sdpMid? | string | 否 | - |
| 4    |  | interface | usernameFragment? | string | 否 | - |

### 4.26 RTCDataChannelInit (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCDataChannelInit | interface | ordered? | boolean | 否 | - |
| 2    |  | interface | maxPacketLifeTime? | number | 否 | - |
| 3    |  | interface | maxRetransmits? | number | 否 | - |
| 4    |  | interface | protocol? | string | 否 | - |
| 5    |  | interface | negotiated? | boolean | 否 | - |
| 6    |  | interface | id? | number | 否 | - |

### 4.27 RTCConfiguration (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCConfiguration | interface | iceServers? | RTCIceServer[] | 否 | - |
| 2    |  | interface | iceTransportPolicy? | RTCIceTransportPolicy | 否 | - |
| 3    |  | interface | bundlePolicy? | RTCBundlePolicy | 否 | - |
| 4    |  | interface | rtcpMuxPolicy? | RTCRtcpMuxPolicy | 否 | - |
| 5    |  | interface | certificates? | RTCCertificate[] | 否 | - |
| 6    |  | interface | iceCandidatePoolSize? | number | 否 | - |

### 4.28 RTCIceServer (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceServer | interface | urls | string \| string[] | 是 | - |
| 2    |  | interface | username? | string | 否 | - |
| 3    |  | interface | credential? | string | 否 | - |

### 4.29 RTCOfferAnswerOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCOfferAnswerOptions | interface | — | — | — | 空接口（无字段） |

### 4.30 RTCOfferOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCOfferOptions | interface | iceRestart? | boolean | 否 | - |

### 4.31 RTCAnswerOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCAnswerOptions | interface | — | — | — | 空接口（无字段） |

### 4.32 RTCRtpCodingParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpCodingParameters | interface | rid? | string | 否 | - |

### 4.33 RTCRtpEncodingParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpEncodingParameters | interface | active? | boolean | 否 | - |
| 2    |  | interface | maxBitrate? | number | 否 | - |
| 3    |  | interface | maxFramerate? | number | 否 | - |
| 4    |  | interface | scaleResolutionDownBy? | number | 否 | - |

### 4.34 RTCRtpCodecParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpCodecParameters | interface | clockRate | number | 是 | - |
| 2    |  | interface | channels? | number | 否 | - |
| 3    |  | interface | mimeType | string | 是 | - |
| 4    |  | interface | sdpFmtpLine | string | 是 | - |
| 5    |  | interface | payloadType | number | 是 | - |

### 4.35 RTCRtpHeaderExtensionParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpHeaderExtensionParameters | interface | id | number | 是 | - |
| 2    |  | interface | uri | string | 是 | - |
| 3    |  | interface | encrypted? | boolean | 否 | - |

### 4.36 RTCRtcpParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtcpParameters | interface | cname? | string | 否 | - |
| 2    |  | interface | reducedSize? | boolean | 否 | - |

### 4.37 RTCRtpParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpParameters | interface | codecs | RTCRtpCodecParameters[] | 是 | - |
| 2    |  | interface | headerExtensions | RTCRtpHeaderExtensionParameters[] | 是 | - |
| 3    |  | interface | rtcp | RTCRtcpParameters | 是 | - |

### 4.38 RTCRtpSendParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpSendParameters | interface | encodings | RTCRtpEncodingParameters[] | 是 | - |
| 2    |  | interface | transactionId | string | 是 | - |

### 4.39 RTCRtpReceiveParameters (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpReceiveParameters | interface | encodings | RTCRtpEncodingParameters[] | 是 | - |
| 2    |  | interface | transactionId | string | 是 | - |

### 4.40 RTCRtpContributingSource (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpContributingSource | interface | timestamp | HighResTimeStamp | 是 | - |
| 2    |  | interface | source | number | 是 | - |
| 3    |  | interface | audioLevel? | number | 否 | - |
| 4    |  | interface | rtpTimestamp | number | 是 | - |

### 4.41 RTCRtpSynchronizationSource (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpSynchronizationSource | interface | — | — | — | 空接口（无字段） |

### 4.42 RTCRtpCodec (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpCodec | interface | payloadType? | number | 否 | - |
| 2    |  | interface | mimeType | string | 是 | - |
| 3    |  | interface | clockRate | number | 是 | - |
| 4    |  | interface | channels? | number | 否 | - |
| 5    |  | interface | sdpFmtpLine? | string | 否 | - |

### 4.43 RTCRtpHeaderExtensionCapability (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpHeaderExtensionCapability | interface | uri | string | 是 | - |

### 4.44 RTCRtpCapabilities (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpCapabilities | interface | codecs | RTCRtpCodec[] | 是 | - |
| 2    |  | interface | headerExtensions | RTCRtpHeaderExtensionCapability[] | 是 | - |

### 4.45 RTCDtlsFingerprint (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCDtlsFingerprint | interface | algorithm? | string | 否 | - |
| 2    |  | interface | value? | string | 否 | - |

### 4.46 RTCIceCandidatePair (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceCandidatePair | interface | local? | RTCIceCandidate | 否 | - |
| 2    |  | interface | remote? | RTCIceCandidate | 否 | - |

### 4.47 RTCStats (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCStats | interface | timestamp | HighResTimeStamp | 是 | - |
| 2    |  | interface | type | RTCStatsType | 是 | - |
| 3    |  | interface | id | string | 是 | - |

### 4.48 RTCStatsReport (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCStatsReport | interface | stats | Map<string, RTCStats> | 是 | - |

### 4.49 RTCTransportStats (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCTransportStats | interface | packetsSent? | number | 否 | - |
| 2    |  | interface | packetsReceived? | number | 否 | - |
| 3    |  | interface | bytesSent? | number | 否 | - |
| 4    |  | interface | bytesReceived? | number | 否 | - |
| 5    |  | interface | iceRole? | RTCIceRole | 否 | - |
| 6    |  | interface | iceLocalUsernameFragment? | string | 否 | - |
| 7    |  | interface | dtlsState | RTCDtlsTransportState | 是 | - |
| 8    |  | interface | iceState? | RTCIceTransportState | 否 | - |
| 9    |  | interface | selectedCandidatePairId? | string | 否 | - |
| 10    |  | interface | localCertificateId? | string | 否 | - |
| 11    |  | interface | remoteCertificateId? | string | 否 | - |
| 12    |  | interface | tlsVersion? | string | 否 | - |
| 13    |  | interface | dtlsCipher? | string | 否 | - |
| 14    |  | interface | srtpCipher? | string | 否 | - |
| 15    |  | interface | selectedCandidatePairChanges | number | 是 | - |

### 4.50 RTCRtpStreamStats (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpStreamStats | interface | ssrc | number | 是 | - |
| 2    |  | interface | kind | string | 是 | - |
| 3    |  | interface | transportId? | string | 否 | - |
| 4    |  | interface | codecId? | string | 否 | - |

### 4.51 RTCIceCandidatePairStats (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceCandidatePairStats | interface | transportId | string | 是 | - |
| 2    |  | interface | localCandidateId | string | 是 | - |
| 3    |  | interface | remoteCandidateId | string | 是 | - |
| 4    |  | interface | state | RTCStatsIceCandidatePairState | 是 | - |
| 5    |  | interface | nominated? | boolean | 否 | - |
| 6    |  | interface | packetsSent? | number | 否 | - |
| 7    |  | interface | packetsReceived? | number | 否 | - |
| 8    |  | interface | bytesSent? | number | 否 | - |
| 9    |  | interface | bytesReceived? | number | 否 | - |
| 10    |  | interface | lastPacketSentTimestamp? | HighResTimeStamp | 否 | - |
| 11    |  | interface | lastPacketReceivedTimestamp? | HighResTimeStamp | 否 | - |
| 12    |  | interface | totalRoundTripTime? | number | 否 | - |
| 13    |  | interface | currentRoundTripTime? | number | 否 | - |
| 14    |  | interface | availableOutgoingBitrate? | number | 否 | - |
| 15    |  | interface | availableIncomingBitrate? | number | 否 | - |
| 16    |  | interface | requestsReceived? | number | 否 | - |
| 17    |  | interface | requestsSent? | number | 否 | - |
| 18    |  | interface | responsesReceived? | number | 否 | - |
| 19    |  | interface | responsesSent? | number | 否 | - |
| 20    |  | interface | consentRequestsSent? | number | 否 | - |
| 21    |  | interface | packetsDiscardedOnSend? | number | 否 | - |
| 22    |  | interface | bytesDiscardedOnSend? | number | 否 | - |

### 4.52 MediaTrackCapabilities (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackCapabilities | interface | width? | ULongRange | 否 | - |
| 2    |  | interface | height? | ULongRange | 否 | - |
| 3    |  | interface | aspectRatio? | DoubleRange | 否 | - |
| 4    |  | interface | frameRate? | DoubleRange | 否 | - |
| 5    |  | interface | facingMode? | string[] | 否 | - |
| 6    |  | interface | resizeMode? | string[] | 否 | - |
| 7    |  | interface | sampleRate? | ULongRange | 否 | - |
| 8    |  | interface | sampleSize? | ULongRange | 否 | - |
| 9    |  | interface | echoCancellation? | boolean[] | 否 | - |
| 10    |  | interface | autoGainControl? | boolean[] | 否 | - |
| 11    |  | interface | noiseSuppression? | boolean[] | 否 | - |
| 12    |  | interface | latency? | DoubleRange | 否 | - |
| 13    |  | interface | channelCount? | ULongRange | 否 | - |
| 14    |  | interface | deviceId? | string | 否 | - |
| 15    |  | interface | groupId? | string | 否 | - |

### 4.53 MediaTrackConstraintSet (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackConstraintSet | interface | width? | ConstrainULong | 否 | - |
| 2    |  | interface | height? | ConstrainULong | 否 | - |
| 3    |  | interface | aspectRatio? | ConstrainDouble | 否 | - |
| 4    |  | interface | frameRate? | ConstrainDouble | 否 | - |
| 5    |  | interface | zoom? | ConstrainDouble | 否 | - |
| 6    |  | interface | facingMode? | ConstrainString | 否 | - |
| 7    |  | interface | resizeMode? | ConstrainString | 否 | - |
| 8    |  | interface | sampleRate? | ConstrainULong | 否 | - |
| 9    |  | interface | sampleSize? | ConstrainULong | 否 | - |
| 10    |  | interface | echoCancellation? | ConstrainBoolean | 否 | - |
| 11    |  | interface | autoGainControl? | ConstrainBoolean | 否 | - |
| 12    |  | interface | noiseSuppression? | ConstrainBoolean | 否 | - |
| 13    |  | interface | latency? | ConstrainDouble | 否 | - |
| 14    |  | interface | channelCount? | ConstrainULong | 否 | - |
| 15    |  | interface | deviceId? | ConstrainString | 否 | - |
| 16    |  | interface | groupId? | ConstrainString | 否 | - |

### 4.54 MediaTrackConstraintSet (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackConstraintSet | interface | ohosScreenCaptureMode? | ConstrainString | 否 | - |
| 2    |  | interface | ohosScreenCaptureDisplayId? | ConstrainULong | 否 | - |
| 3    |  | interface | ohosScreenCaptureMissionId? | ConstrainString | 否 | - |
| 4    |  | interface | ohosScreenCaptureWindowFilter? | ConstrainString | 否 | - |
| 5    |  | interface | ohosScreenCaptureAudioFilter? | ConstrainString | 否 | - |
| 6    |  | interface | ohosScreenCaptureSkipPrivacyMode? | ConstrainString | 否 | - |
| 7    |  | interface | ohosScreenCaptureAutoRotation? | ConstrainBoolean | 否 | - |

### 4.55 MediaTrackConstraints (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackConstraints | interface | advanced? | MediaTrackConstraintSet[] | 否 | - |

### 4.56 MediaTrackSettings (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackSettings | interface | width? | number | 否 | - |
| 2    |  | interface | height? | number | 否 | - |
| 3    |  | interface | aspectRatio? | number | 否 | - |
| 4    |  | interface | frameRate? | number | 否 | - |
| 5    |  | interface | facingMode? | string | 否 | - |
| 6    |  | interface | resizeMode? | string | 否 | - |
| 7    |  | interface | sampleRate? | number | 否 | - |
| 8    |  | interface | sampleSize? | number | 否 | - |
| 9    |  | interface | echoCancellation? | boolean | 否 | - |
| 10    |  | interface | autoGainControl? | boolean | 否 | - |
| 11    |  | interface | noiseSuppression? | boolean | 否 | - |
| 12    |  | interface | latency? | number | 否 | - |
| 13    |  | interface | channelCount? | number | 否 | - |
| 14    |  | interface | deviceId? | string | 否 | - |
| 15    |  | interface | groupId? | string | 否 | - |

### 4.57 MediaTrackSupportedConstraints (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaTrackSupportedConstraints | interface | width? | boolean | 否 | - |
| 2    |  | interface | height? | boolean | 否 | - |
| 3    |  | interface | aspectRatio? | boolean | 否 | - |
| 4    |  | interface | frameRate? | boolean | 否 | - |
| 5    |  | interface | facingMode? | boolean | 否 | - |
| 6    |  | interface | resizeMode? | boolean | 否 | - |
| 7    |  | interface | sampleRate? | boolean | 否 | - |
| 8    |  | interface | sampleSize? | boolean | 否 | - |
| 9    |  | interface | echoCancellation? | boolean | 否 | - |
| 10    |  | interface | autoGainControl? | boolean | 否 | - |
| 11    |  | interface | noiseSuppression? | boolean | 否 | - |
| 12    |  | interface | latency? | boolean | 否 | - |
| 13    |  | interface | channelCount? | boolean | 否 | - |
| 14    |  | interface | deviceId? | boolean | 否 | - |
| 15    |  | interface | groupId? | boolean | 否 | - |

### 4.58 MediaStreamConstraints (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaStreamConstraints | interface | video? | boolean \| MediaTrackConstraints | 否 | - |
| 2    |  | interface | audio? | boolean \| MediaTrackConstraints | 否 | - |

### 4.59 DisplayMediaStreamOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DisplayMediaStreamOptions | interface | video? | boolean \| MediaTrackConstraints | 否 | - |
| 2    |  | interface | audio? | boolean \| MediaTrackConstraints | 否 | - |

### 4.60 DisplayMediaStreamOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DisplayMediaStreamOptions | interface | ohosSystemAudio? | boolean \| MediaTrackConstraints | 否 | - |

### 4.61 MediaSource (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaSource | interface | state | MediaSourceState | 是 | - |

### 4.62 AudioSource (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioSource | interface | — | — | — | 空接口（无字段） |

### 4.63 VideoSource (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoSource | interface | oncapturerstarted | ((this: VideoSource, ev: VideoCapturerStartedEvent) => any) \| null | 否 | - |
| 2    |  | interface | oncapturerstopped | ((this: VideoSource, ev: Event) => any) \| null | 否 | - |
| 3    |  | interface | oncameraswitchdone | ((this: VideoSource, ev: CameraSwitchDoneEvent) => any) \| null | 否 | - |
| 4    |  | interface | oncameraswitcherror | ((this: VideoSource, ev: CameraSwitchErrorEvent) => any) \| null | 否 | - |

### 4.64 AudioTrack (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioTrack | interface | — | — | — | 空接口（无字段） |

### 4.65 VideoTrack (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoTrack | interface | — | — | — | 空接口（无字段） |

### 4.66 MediaDeviceInfo (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaDeviceInfo | interface | deviceId | string | 是 | - |
| 2    |  | interface | kind | MediaDeviceKind | 是 | - |
| 3    |  | interface | label | string | 是 | - |
| 4    |  | interface | groupId | string | 是 | - |

### 4.67 DeviceChangeEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DeviceChangeEvent | interface | devices | ReadonlyArray<MediaDeviceInfo> | 是 | - |
| 2    |  | interface | userInsertedDevices | ReadonlyArray<MediaDeviceInfo> | 是 | - |

### 4.68 AudioError (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioError | interface | type | AudioErrorType | 是 | - |

### 4.69 AudioErrorEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioErrorEvent | interface | error | AudioError | 是 | - |

### 4.70 AudioStateChangeEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioStateChangeEvent | interface | state | AudioState | 是 | - |

### 4.71 AudioCapturerSamplesReadyEvent (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioCapturerSamplesReadyEvent | interface | samples | AudioSamples | 是 | - |

### 4.72 AudioDeviceModuleOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioDeviceModuleOptions | interface | audioSource? | number | 否 | - |
| 2    |  | interface | audioFormat? | number | 否 | - |
| 3    |  | interface | inputSampleRate? | number | 否 | - |
| 4    |  | interface | useStereoInput? | boolean | 否 | - |
| 5    |  | interface | outputSampleRate? | number | 否 | - |
| 6    |  | interface | useStereoOutput? | boolean | 否 | - |
| 7    |  | interface | rendererUsage? | number | 否 | - |
| 8    |  | interface | useLowLatency? | boolean | 否 | - |
| 9    |  | interface | useHardwareAcousticEchoCanceler? | boolean | 否 | - |
| 10    |  | interface | useHardwareNoiseSuppressor? | boolean | 否 | - |

### 4.73 AudioSamples (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioSamples | interface | audioFormat | number | 是 | - |
| 2    |  | interface | channelCount | number | 是 | - |
| 3    |  | interface | sampleRate | number | 是 | - |
| 4    |  | interface | data | ArrayBuffer | 是 | - |

### 4.74 AudioProcessing (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioProcessing | interface | — | — | — | 空接口（无字段） |

### 4.75 VideoEncoderFactory (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoEncoderFactory | interface | — | — | — | 空接口（无字段） |

### 4.76 VideoDecoderFactory (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoDecoderFactory | interface | — | — | — | 空接口（无字段） |

### 4.77 PeerConnectionFactoryOptions (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | PeerConnectionFactoryOptions | interface | adm? | AudioDeviceModule | 否 | - |
| 2    |  | interface | videoEncoderFactory? | VideoEncoderFactory | 否 | - |
| 3    |  | interface | videoDecoderFactory? | VideoDecoderFactory | 否 | - |
| 4    |  | interface | audioProcessing? | AudioProcessing | 否 | - |

### 4.78 Loggable (interface)

> ⚠️ **类型：interface** — 不能用 `new` 实例化！Demo 代码须用对象字面量 `{ field1: val1, field2: val2 }` 赋值。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | Loggable | interface | — | — | — | 空接口（无字段） |

### 4.79 RTCErrorDetailType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCErrorDetailType | type | — | "data-channel-failure" \| "dtls-failure" \| "fingerprint-failure" \| "hardware-encoder-error" \| "hardware-encoder-not-available" \| "sctp-failure" \| "sdp-syntax-error" | 是 | - |

### 4.80 RTCIceProtocol (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceProtocol | type | — | "tcp" \| "udp" | 是 | - |

### 4.81 RTCIceCandidateType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceCandidateType | type | — | "host" \| "prflx" \| "relay" \| "srflx" | 是 | - |

### 4.82 RTCIceTcpCandidateType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceTcpCandidateType | type | — | "active" \| "passive" \| "so" | 是 | - |

### 4.83 RTCIceComponent (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceComponent | type | — | "rtp" \| "rtcp" | 是 | - |

### 4.84 RTCIceGathererState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceGathererState | type | — | "complete" \| "gathering" \| "new" | 是 | - |

### 4.85 RTCIceTransportState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceTransportState | type | — | "checking" \| "closed" \| "completed" \| "connected" \| "disconnected" \| "failed" \| "new" | 是 | - |

### 4.86 RTCIceRole (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceRole | type | — | "unknown" \| "controlling" \| "controlled" | 是 | - |

### 4.87 RTCSdpType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCSdpType | type | — | 'offer' \| 'answer' \| "pranswer" \| "rollback" | 是 | - |

### 4.88 BinaryType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | BinaryType | type | — | "blob" \| "arraybuffer" | 是 | - |

### 4.89 DataChannelState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DataChannelState | type | — | "closed" \| "closing" \| "connecting" \| "open" | 是 | - |

### 4.90 RTCDtlsTransportState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCDtlsTransportState | type | — | "new" \| "connecting" \| "connected" \| "closed" \| "failed" | 是 | - |

### 4.91 RTCIceGatheringState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceGatheringState | type | — | "new" \| "gathering" \| "complete" | 是 | - |

### 4.92 RTCIceConnectionState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceConnectionState | type | — | "checking" \| "closed" \| "completed" \| "connected" \| "disconnected" \| "failed" \| "new" | 是 | - |

### 4.93 RTCSignalingState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCSignalingState | type | — | "closed" \| "have-local-offer" \| "have-local-pranswer" \| "have-remote-offer" \| "have-remote-pranswer" \| "stable" | 是 | - |

### 4.94 RTCPeerConnectionState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCPeerConnectionState | type | — | "closed" \| "connected" \| "connecting" \| "disconnected" \| "failed" \| "new" | 是 | - |

### 4.95 RTCBundlePolicy (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCBundlePolicy | type | — | "balanced" \| "max-bundle" \| "max-compat" | 是 | - |

### 4.96 RTCRtcpMuxPolicy (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtcpMuxPolicy | type | — | "require" | 是 | - |

### 4.97 RTCIceTransportPolicy (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCIceTransportPolicy | type | — | "all" \| "relay" | 是 | - |

### 4.98 DegradationPreference (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | DegradationPreference | type | — | "balanced" \| "maintain-framerate" \| "maintain-resolution" | 是 | - |

### 4.99 RTCRtpTransceiverDirection (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCRtpTransceiverDirection | type | — | "inactive" \| "recvonly" \| "sendonly" \| "sendrecv" \| "stopped" | 是 | export type RTCPriorityType = "high" \| "low" \| "medium" \| "very-low"; |

### 4.100 RTCSctpTransportState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCSctpTransportState | type | — | "connecting" \| "connected" \| "closed" | 是 | - |

### 4.101 RTCStatsType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCStatsType | type | — | "candidate-pair" \| "certificate" \| "codec" \| "data-channel" \| "inbound-rtp" \| "local-candidate" \| "media-playout" \| "media-source" \| "outbound-rtp" \| "peer-connection" \| "remote-candidate" \| "remote-inbound-rtp" \| "remote-outbound-rtp" \| "transport" | 是 | - |

### 4.102 RTCStatsIceCandidatePairState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | RTCStatsIceCandidatePairState | type | — | "failed" \| "frozen" \| "in-progress" \| "succeeded" \| "waiting" | 是 | - |

### 4.103 MediaStreamTrackState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaStreamTrackState | type | — | 'live' \| 'ended' | 是 | - |

### 4.104 MediaDeviceKind (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaDeviceKind | type | — | 'audioinput' \| 'audiooutput' \| 'videoinput' | 是 | - |

### 4.105 MediaSourceState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | MediaSourceState | type | — | 'initializing' \| 'live' \| 'ended' \| 'muted' | 是 | - |

### 4.106 VideoFacingModeEnum (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoFacingModeEnum | type | — | "user" \| "environment" \| "left" \| "right" | 是 | - |

### 4.107 VideoResizeModeEnum (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | VideoResizeModeEnum | type | — | "none" \| "crop-and-scale" | 是 | - |

### 4.108 AudioErrorType (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioErrorType | type | — | 'init' \| 'start-exception' \| 'start-state-mismatch' \| 'general' | 是 | - |

### 4.109 AudioState (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AudioState | type | — | 'start' \| 'stop' | 是 | - |

### 4.110 ScreenCaptureMode (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ScreenCaptureMode | type | — | 'home-screen' \| 'specified-screen' \| 'specified-window' | 是 | - |

### 4.111 ScreenCaptureAudioFilterEnum (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ScreenCaptureAudioFilterEnum | type | — | 'current-app' \| 'notification' | 是 | - |

### 4.112 AlgorithmIdentifier (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | AlgorithmIdentifier | type | — | Algorithm \| string | 是 | - |

### 4.113 HighResTimeStamp (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | HighResTimeStamp | type | — | number | 是 | - |

### 4.114 EpochTimeStamp (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | EpochTimeStamp | type | — | number | 是 | - |

### 4.115 ConstrainBoolean (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainBoolean | type | — | boolean \| ConstrainBooleanParameters | 是 | - |

### 4.116 ConstrainULong (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainULong | type | — | number \| ConstrainULongRange | 是 | - |

### 4.117 ConstrainDouble (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainDouble | type | — | number \| ConstrainDoubleRange | 是 | - |

### 4.118 ConstrainString (type)

> ⚠️ **类型：type alias** — 不能用 `new` 实例化，仅作类型引用。

| 序号 | 接口/类型名 | 类型(interface/class) | 字段 | 字段类型 | 必填 | 描述 |
|------|------------|----------------------|------|----------|------|------|
| 1    | ConstrainString | type | — | string \| string[] \| ConstrainStringParameters | 是 | - |

## 5. UI 组件装饰器兼容性

无。本库未导出 @Component/@ComponentV2 struct 组件。

## 6. 对外导出的函数

无。

## 7. 对外导出的变量/常量

无。

## 8. Native 模块导出

### 8.1 Native 声明为 `.d.ts`（已计入 N/S，仅说明来源）

> 本库 Native 声明为 `.d.ts`（./ohos_webrtc/src/main/libohos_webrtc/webrtc.d.ts），其全部公开接口已展开纳入第 3/4/6/7 章并**计入 ArkTS 接口统计**，此处不再列表格（M=0）。

## 9. 注意事项

{PENDING}

## 10. 枚举导出（不计入接口统计）

> 以下枚举为类型定义，非可调用的 API，**不纳入 S/N 接口统计**，仅作导出清单展示。

| 序号 | 枚举名 | 源文件 | 枚举值 | 功能描述 |
|------|--------|--------|--------|----------|
| 1    | LoggingSeverity | `./ohos_webrtc/src/main/ets/log/Logging.ets` | `VERBOSE, INFO, WARNING, ERROR, NONE` | - |
| 2    | ScalingMode | `./ohos_webrtc/src/main/ets/xcomponent/VideoRenderController.ets` | `Fill, AspectFill, AspectFit` | - |

---
{PENDING}
