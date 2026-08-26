# PR #32: fix:修复77分支中bad_weak_ptr问题，导致的崩溃

- **状态**: merged
- **作者**: tyBrave_g
- **创建时间**: 2026-08-08T17:16:30+08:00
- **分支**: br_rnoh0.77 → br_rnoh0.77
- **变更文件数**: 6

## PR 描述

- fix:修复77分支中bad_weak_ptr问题，导致的崩溃
- Closed: [#27](https://gitcode.com/CPF-RN/rntpc_react-native-SmartRefreshLayout/issues/27)

## 变更文件

| 文件 | 变更 | +行 | -行 |
|------|------|-----|-----|
| `harmony/smart_refresh_layout/src/main/cpp/PullToRefreshNode.cpp` | ? | +1 | -0 |
| `harmony/smart_refresh_layout/src/main/cpp/PullToRefreshNode.h` | ? | +7 | -4 |
| `harmony/smart_refresh_layout/src/main/cpp/RNCMaterialHeaderComponentInstance.cpp` | ? | +11 | -6 |
| `harmony/smart_refresh_layout/src/main/cpp/RNCStoreHouseHeaderNode.cpp` | ? | +1 | -1 |
| `harmony/smart_refresh_layout/src/main/cpp/SmartRefreshLayoutComponentInstance.cpp` | ? | +27 | -18 |
| `harmony/smart_refresh_layout/src/main/cpp/conversions.h` | ? | +68 | -64 |

## Diff

### `harmony/smart_refresh_layout/src/main/cpp/PullToRefreshNode.cpp`

```diff
@@ -26,6 +26,7 @@ namespace rnoh {
           refreshConfigurator{std::make_shared<PullToRefreshConfigurator>()}{}
 
     PullToRefreshNode::~PullToRefreshNode() {
+        std::unique_lock<std::shared_mutex> lock(config_mutex_);
         refreshConfigurator = nullptr;
     }
     void PullToRefreshNode::setPullToRefreshNodeDelegate(PullToRefreshNodeDelegate *pullToRefreshNodeDelegate) {

```

### `harmony/smart_refresh_layout/src/main/cpp/PullToRefreshNode.h`

```diff
@@ -43,7 +43,8 @@ protected:
     ArkUI_NodeHandle m_listArkUINodeHandle;
     PullToRefreshNodeDelegate *m_pullToRefreshNodeDelegate;
     std::shared_ptr<PullToRefreshConfigurator> refreshConfigurator;
-
+    std::shared_mutex config_mutex_;
+    
 public:
     PullToRefreshNode();
     ~PullToRefreshNode() override;
@@ -59,9 +60,11 @@ public:
     void setMaxTranslate(float maxHeight);
     void setHeaderBackgroundColor(facebook::react::SharedColor const &color);
 
-    std::shared_ptr<PullToRefreshConfigurator> getPullToRefreshConfigurator() {
-        CHECK(refreshConfigurator != nullptr) 
-            << "[PullToRefreshNode] refreshConfigurator is null!";
+   std::shared_ptr<PullToRefreshConfigurator> getPullToRefreshConfigurator() {
+        std::shared_lock<std::shared_mutex> lock(config_mutex_);
+        if (!refreshConfigurator) {
+            LOG(ERROR)<<"[PullToRefreshNode] getPullToRefreshConfigurator refreshConfigurator is null!";
+        }
         return refreshConfigurator;
     }
     void onNodeEvent(ArkUI_NodeEventType eventType, EventArgs &eventArgs) override;

```

### `harmony/smart_refresh_layout/src/main/cpp/RNCMaterialHeaderComponentInstance.cpp`

```diff
@@ -88,22 +88,27 @@ namespace rnoh {
     void RNCMaterialHeaderComponentInstance::setScaleAnimate(int32_t dur) {
 
         TaskCommonThread *task = new TaskCommonThread();
-        task->setTaskParams(static_cast<std::chrono::milliseconds>(dur), [this](double v) {
-            scaleSize = 1.0 - static_cast<float>(v);
-            auto instance = std::static_pointer_cast<RNInstanceInternal>(m_deps->rnInstance.lock());
+        auto self = shared_from_this(); 
+        task->setTaskParams(static_cast<std::chrono::milliseconds>(dur), [self](double v) {
+            if (!self) return;
+            auto ptrValue = std::static_pointer_cast<RNCMaterialHeaderComponentInstance>(self);
+            if (!ptrValue) return;
+            ptrValue->scaleSize = 1.0 - static_cast<float>(v);
+            auto instance = std::static_pointer_cast<RNInstanceInternal>(ptrValue->m_deps->rnInstance.lock());
             if (!instance) {
                 return;
             }
             instance->getTaskExecutor()->runTask(
-                TaskThread::MAIN, [wptr = this->weak_from_this(), wInstance = instance->weak_from_this()] {
-                    auto ptr = std::static_pointer_cast<RNCMaterialHeaderComponentInstance>(wptr.lock());
+                TaskThread::MAIN, [wptr = ptrValue] {
+                    auto ptr = std::static_pointer_cast<RNCMaterialHeaderComponentInstance>(wptr);
                     if (ptr) {
+                        double count_001 = 0.01;
                         float value = ptr->scaleSize;
                         ArkUI_NumberValue scaleArray[] = {{.f32 = value}, {.f32 = value}};
                         ArkUI_AttributeItem scaleValue[] = {scaleArray, 2};
                         NativeNodeApi::getInstance()->setAttribute(ptr->imageStack.getArkUINodeHandle(), NODE_SCALE,
                                                                    scaleValue);
-                        if (std::abs(value - 0.01) < 1e-6) {
+                        if (std::abs(value - count_001) < 1e-6) {
                             ArkUI_NumberValue scaleArray[] = {{.f32 = 1.0}, {.f32 = 1.0}};
                             ArkUI_AttributeItem scaleValue[] = {scaleArray, 2};
                             NativeNodeApi::getInstance()->setAttribute(ptr->imageStack.getArkUINodeHandle(), NODE_SCALE,

```

### `harmony/smart_refresh_layout/src/main/cpp/RNCStoreHouseHeaderNode.cpp`

```diff
@@ -165,7 +165,7 @@ void RNCStoreHouseHeaderNode::OnDraw(ArkUI_NodeCustomEvent *event) {
                 if (progress <= startPadding) {
                     realProgress = 0;
                 } else {
-                    realProgress = std::min(1, (int)((progress - startPadding) / mInternalAnimationFactor));
+                    realProgress = std::min(1, static_cast<int>((progress - startPadding) / mInternalAnimationFactor));
                 }
                 offsetX += storeHouseBarItem->translationX * (1 - realProgress);
                 offsetY += -mDropHeight * (1 - realProgress);

```

### `harmony/smart_refresh_layout/src/main/cpp/SmartRefreshLayoutComponentInstance.cpp`

```diff
@@ -73,24 +73,29 @@ void SmartRefreshLayoutComponentInstance::onAppArea() {
     panGesture(m_pullToRefreshNode.getArkUINodeHandle());
     if (this->autoRefresh.refresh) {
         int32_t delayTime = (int32_t)autoRefresh.time;
+        const int count_2 = 2;
         if (delayTime > 0) {
             TaskProcessor *taskProcessor = new TaskProcessor();
-            taskProcessor->startDelayTask(static_cast<std::chrono::milliseconds>(delayTime), [this]() {
-                auto instance = std::static_pointer_cast<RNInstanceInternal>(m_deps->rnInstance.lock());
+            auto self = shared_from_this(); 
+            taskProcessor->startDelayTask(static_cast<std::chrono::milliseconds>(delayTime), [self]() {
+                if (!self) return;
+                auto ptrValue = std::static_pointer_cast<SmartRefreshLayoutComponentInstance>(self);
+                if (!ptrValue) return;
+                auto instance = std::static_pointer_cast<RNInstanceInternal>(ptrValue->m_deps->rnInstance.lock());
                 if (!instance) {
                     return;
                 }
                 instance->getTaskExecutor()->runTask(
-                    TaskThread::MAIN, [wptr = this->shared_from_this(), wInstance = instance->weak_from_this()] {
+                        TaskThread::MAIN, [wptr = ptrValue, wInstance = instance->weak_from_this()] {
                         auto ptr = std::static_pointer_cast<SmartRefreshLayoutComponentInstance>(wptr);
                         if (ptr) {
-                            ptr->trYTop = ptr->headerHeight * 2;
+                            ptr->trYTop = ptr->headerHeight * count_2;
                             ptr->onActionEnd();
                         }
                     });
             });
         } else {
-            this->trYTop = this->headerHeight * 2;
+            this->trYTop = this->headerHeight * count_2;
             this->onActionEnd();
         }
     }
@@ -279,15 +284,19 @@ void SmartRefreshLayoutComponentInstance::closeRefresh(float start, float target
     if (animation == nullptr) {
         animation = std::make_shared<Animation>();
     }
+    auto self = shared_from_this(); 
     animation->SetAnimationParams(
-        static_cast<std::chrono::milliseconds>(duration), start, target, [this, &target](double value) {
-            trYTop = value < 0 ? 0 : value;
-            auto instance = std::static_pointer_cast<RNInstanceInternal>(m_deps->rnInstance.lock());
+        static_cast<std::chrono::milliseconds>(duration), start, target, [self, target](double value) {
+            if (!self) return;
+            auto ptrValue = std::static_pointer_cast<SmartRefreshLayoutComponentInstance>(self);
+            if (!ptrValue) return;
+            ptrValue->trYTop = value < 0 ? 0 : value;
+            auto instance = std::static_pointer_cast<RNInstanceInternal>(ptrValue->m_deps->rnInstance.lock());
             if (!instance) {
                 return;
             }
             instance->getTaskExecutor()->runTask(
-                TaskThread::MAIN, [wptr = this->shared_from_this(), wInstance = instance->weak_from_this()] {
+                TaskThread::MAIN, [wptr = ptrValue] {
                     auto ptr = std::static_pointer_cast<SmartRefreshLayoutComponentInstance>(wptr);
                     if (ptr) {
                         ptr->setPullHeaderHeight(ptr->trYTop);
@@ -310,7 +319,12 @@ void SmartRefreshLayoutComponentInstance::closeRefresh(float start, float target
 void SmartRefreshLayoutComponentInstance::finishRefresh() {
     state = IS_REFRESHED;
     changeStatus();
-    closeRefresh(trYTop, 0, m_pullToRefreshNode.getPullToRefreshConfigurator()->getAnimDuration());
+    uint32_t duration = 150;
+    auto config = m_pullToRefreshNode.getPullToRefreshConfigurator();
+    if (config){
+        duration = config->getAnimDuration();
+    }
+    closeRefresh(trYTop, 0, duration);
 }
 
 bool SmartRefreshLayoutComponentInstance::isComponentTop() {
@@ -469,14 +483,9 @@ void SmartRefreshLayoutComponentInstance::handleCommand(std::string const &comma
     if (commandName == "finishRefresh" && args.isArray() && args.size() == 2) {
         auto delayed = args[0];
         auto success = args[1];
-        if (delayed != INFINITY) {
-            if (delayed >= 0) {
-                m_pullToRefreshNode.getPullToRefreshConfigurator()->setFinishDelay(delayed.asInt());
-            } else {
-                m_pullToRefreshNode.getPullToRefreshConfigurator()->setFinishDelay(0);
-            }
-        } else {
-            m_pullToRefreshNode.getPullToRefreshConfigurator()->setFinishDelay(500);
+        auto config = m_pullToRefreshNode.getPullToRefreshConfigurator();
+        if (config) {
+            config->setFinishDelay(delayed != INFINITY ? delayed >= 0 ? delayed.asInt() : 0 : 500);
         }
         finishRefresh();
     }

```

### `harmony/smart_refresh_layout/src/main/cpp/conversions.h`

```diff
@@ -28,85 +28,89 @@ namespace react {
 inline void fromRawValue(
     const PropsParserContext &context,
     const RawValue &value,
-    ScrollViewSnapToAlignment &result) {
-  auto string = (std::string)value;
-  if (string == "start") {
-    result = ScrollViewSnapToAlignment::Start;
-    return;
-  }
-  if (string == "center") {
-    result = ScrollViewSnapToAlignment::Center;
-    return;
-  }
-  if (string == "end") {
-    result = ScrollViewSnapToAlignment::End;
-    return;
-  }
-  abort();
+    ScrollViewSnapToAlignment &result)
+{
+    auto string = (std::string)value;
+    if (string == "start") {
+        result = ScrollViewSnapToAlignment::Start;
+        return;
+    }
+    if (string == "center") {
+        result = ScrollViewSnapToAlignment::Center;
+        return;
+    }
+    if (string == "end") {
+        result = ScrollViewSnapToAlignment::End;
+        return;
+    }
+    throw std::runtime_error("Invalid value");
 }
 
 inline void fromRawValue(
     const PropsParserContext &context,
     const RawValue &value,
-    ScrollViewIndicatorStyle &result) {
-  auto string = (std::string)value;
-  if (string == "default") {
-    result = ScrollViewIndicatorStyle::Default;
-    return;
-  }
-  if (string == "black") {
-    result = ScrollViewIndicatorStyle::Black;
-    return;
-  }
-  if (string == "white") {
-    result = ScrollViewIndicatorStyle::White;
-    return;
-  }
-  abort();
+    ScrollViewIndicatorStyle &result)
+{
+    auto string = (std::string)value;
+    if (string == "default") {
+        result = ScrollViewIndicatorStyle::Default;
+        return;
+    }
+    if (string == "black") {
+        result = ScrollViewIndicatorStyle::Black;
+        return;
+    }
+    if (string == "white") {
+        result = ScrollViewIndicatorStyle::White;
+        return;
+    }
+    throw std::runtime_error("Invalid value");
 }
 
 inline void fromRawValue(
     const PropsParserContext &context,
     const RawValue &value,
-    ScrollViewKeyboardDismissMode &result) {
-  auto string = (std::string)value;
-  if (string == "none") {
-    result = ScrollViewKeyboardDismissMode::None;
-    return;
-  }
-  if (string == "on-drag") {
-    result = ScrollViewKeyboardDismissMode::OnDrag;
-    return;
-  }
-  if (string == "interactive") {
-    result = ScrollViewKeyboardDismissMode::Interactive;
-    return;
-  }
-  abort();
+    ScrollViewKeyboardDismissMode &result)
+{
+    auto string = (std::string)value;
+    if (string == "none") {
+        result = ScrollViewKeyboardDismissMode::None;
+        return;
+    }
+    if (string == "on-drag") {
+        result = ScrollViewKeyboardDismissMode::OnDrag;
+        return;
+    }
+    if (string == "interactive") {
+        result = ScrollViewKeyboardDismissMode::Interactive;
+        return;
+    }
+    throw std::runtime_error("Invalid value");
 }
 
 inline void fromRawValue(
     const PropsParserContext &context,
     const RawValue &value,
-    ContentInsetAdjustmentBehavior &result) {
-  auto string = (std::string)value;
-  if (string == "never") {
-    result = ContentInsetAdjustmentBehavior::Never;
-    return;
-  }
-  if (string == "automatic") {
-    result = ContentInsetAdjustmentBehavior::Automatic;
-    return;
-  }
-  if (string == "scrollableAxes") {
-    result = ContentInsetAdjustmentBehavior::ScrollableAxes;
-    return;
-  }
-  if (string == "always") {
-    result = ContentInsetAdjustmentBehavior::Always;
-    return;
-  }
-  abort();
+    ContentInsetAdjustmentBehavior &result)
+{
+    auto string = (std::string)value;
+    if (string == "never") {
+        result = ContentInsetAdjustmentBehavior::Never;
+        return;
+    }
+    if (string == "automatic") {
+        result = ContentInsetAdjustmentBehavior::Automatic;
+        return;
+    }
+    if (string == "scrollableAxes") {
+        result = ContentInsetAdjustmentBehavior::ScrollableAxes;
+        return;
+    }
+    if (string == "always") {
+        result = ContentInsetAdjustmentBehavior::Always;
+        return;
+    }
+    throw std::runtime_error("Invalid value");
 }
 
 inline void fromRawValue(

```
