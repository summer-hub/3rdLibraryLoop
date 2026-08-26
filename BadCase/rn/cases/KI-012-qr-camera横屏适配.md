# KI-012 react-native-qr-decode-image-camera：Pura X Max 横屏展示不正确

- **元数据**: `rule: R-09` · `verified: diff` · `source: community-issue` · `severity: medium` · `status: draft`
- **PR**: https://gitcode.com/CPF-RN/rntpc_react-native-qr-decode-image-camera/pull/37（merged，2 文件）
- **diff 材料**: [../pr-info/rntpc_react-native-qr-decode-image-camera-37.md](../pr-info/rntpc_react-native-qr-decode-image-camera-37.md)

## 现象

react-native-qr-decode-image-camera 库在 Pura X Max 上横屏状态下相机视图向下偏移，展示不正确。

## 根因

相机组件使用固定 aspectRatio（3/4）和固定定位，未检测横竖屏状态动态调整布局——横屏时 aspectRatio 不再适用，提示文字固定 bottom 定位导致在横屏时位置错误。

## 错误代码（修复前）

```tsx
// Camera.tsx — ① 固定 3:4 宽高比
camera: {
    width: '100%',
    aspectRatio: 3 / 4,  // ← 横屏时比例不适用
},

// QRScannerView.js — ② 提示文字固定 bottom 定位
<View style={{ position: 'absolute', bottom: this.props.hintTextPosition }}>
    <Text style={[this.props.hintTextStyle, { top: this.props.finderY, left: this.props.finderX }]}>
        {this.props.hintText}
    </Text>
</View>
```

## 正确代码（修复后）

```tsx
// Camera.tsx — ① 改用 flex 自适应
camera: {
    flex: 1,  // 自适应横竖屏
},

// QRScannerView.js — ② 检测横竖屏状态
const { width, height } = Dimensions.get('window');
this.state = { isLandscape: width > height };

// ③ 根据横竖屏切换定位
<View style={{
    position: 'absolute',
    ...(this.state.isLandscape
        ? { top: this.getBottomMaskHeight() - this.props.finderY + 10, left: 0, right: 0, alignItems: 'center' }
        : { bottom: this.props.hintTextPosition })
}}>
    <Text style={[this.props.hintTextStyle, !this.state.isLandscape ? { top: this.props.finderY, left: this.props.finderX } : {}]}>
        {this.props.hintText}
    </Text>
</View>
```

## 修复方式

1. 相机组件从固定 aspectRatio 改为 flex: 1 自适应；2. 通过 Dimensions.get('window') 检测横竖屏（width > height）；3. 提示文字叠加层根据 isLandscape 状态切换 top/bottom 定位。