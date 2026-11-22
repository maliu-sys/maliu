# The Initialization of Browser

## 设计新的 UI

随着上周 APP 构建流程的更新，我也是在真机上安装了 maliu ，然后就被它的 AI 生成的 UI 恶心到了。

然后我就开始尝试联系我认识的美工（没错，打死我也不会自己做 UI 的哈哈哈哈哈）。我发现最难的地方是，我并不知道该如何与美工沟通我的需求：我脑子中并没有一个类似于“UI 就应该是这样”的想法，只有“我想要个好的 UI”这种模糊念头。

不过我还是尝试梳理了一下需求。我们需要一个新的吉祥物，因为之前的“在麻线团旁边哭泣小孩”实在是有些复杂，无论是当 APP Logo 还是手机内部桌宠，或者其他文档上的图案，感觉都密密麻麻挤在一起，除了信息过于嘈杂外，也不是很有记忆点。

这个问题我初步选择了一个“一**溜**烟小跑的**麻**线团”当吉祥物，既符合产品名字，感觉也比较独特且可爱。

此外，我们也考虑交互式场景 UI 的设计。我比较厌倦传统的 chatbox 式的消息列表。我想做一个类似于“旅行青蛙”或者“部落冲突”式的交互场景。当一个任务下达的时候，我们可以可视化地看见我们的吉祥物在场景中使用各种道具完成用户的指令，我们也可以点击不同的道具（可能分别代表 memory ，tools 之类的）来进行查看和配置。

当然这种方式也对于 UI 框架提出了一定的挑战，这可能对应着新的 UI 插件设计，所以我把它留在明天了。

难求好的美工啊！

## 操作浏览器

### 敏捷开发

本来在 memory 初稿弄完之后，我打算做一些 memory 的智能 benchmark，来看看 memory 有什么可以改进的内容。但是我又想了想，也和人讨论了讨论，感觉目前还是应当以将尽可能多的新 feature 开发出来为首要目的。

这是因为残缺的 APP 让人没有使用的欲望，没有使用，就没有真实的用户反馈，进而也没有办法完善 APP 。如果 APP 修改的反馈仅仅来自 benchmark ，那么我觉得也是很不客观的。这点我觉得在 agent 这种含有部分黑盒逻辑的项目里尤其明显。此外尽快开发出全部的 feature ，也有利于暴露更多的开发问题和设计。正反馈也会更强一些。

但是这并不意味着我要放弃古法 review 或者降低代码质量。有一个自己可控的，认真打磨的项目，是我的初心，即使这个项目不是 sota 。

### 多种完成路径

之所以选择浏览器作为下一个 feature ，是我觉得这是跃过很多 APP 操作的一种比较通用的方式，应该是比无障碍阅读要提供了更加详细的信息，也更不容易被封号（这个我也没有具体调研过）。

如果再考虑上纯 GUI 方案，那么其实一个任务有多种完成路径，那么具体该选择哪个呢？感觉还是需要后续的设计的。

### 软件栈

目前使用 `react-native-webview` 来实现，我理解就是一个内置的浏览器 tab，方便 agent 去操作。它的底层使用的是系统（比如说安卓）自己的浏览器组件（什么时候能跨平台呀）。

在使用中，我们是通过一个 `useRef` 作为 handler 来操控 `WebView` 的，如下定义：

```typescript
const webView = useRef<WebView<unknown>>(null);

<WebView
  ref={webView}
  source={{ uri: 'https://example.com' }}
/>;
```

`webView` 就是 browser handler ，我们可以调用“刷新”和“后退”等各种方法：

```typescript
webView.current?.reload();
webView.current?.goBack();
webView.current?.injectJavaScript(script);
```

最后一个方法比较重要，它说的是我们注入一段 JS 代码，在 `WebView` 中运行。我们的 browser tool 就是最终以这段 JS 为媒介，操作浏览器的，我们注入的代码就在 `./src/browser/page-script.ts` 下。

### Page Scripts

每次调用浏览器工具的时候，我们都会往 `WebView` 中注入一小段代码，但是这些代码基本上就是个结构体。在初始化，我们需要注入一个 `switch` 类型的函数，用于分发不同的 tool 操作。也就是 `__maliuBrowser` 。

```javascript
window.__maliuBrowser = {
  run(id, action, args) {
    try {
      send({ id, result: act(action, args) });
    } catch (error) {
      send({ id, error: String(error.message || error) });
    }
  },
};
```

可以看到它内部基本上就是调用 `act()` 函数，而 `act()` 就是那个分发函数：

```javascript
const act = (action, args) => {
  if (action === 'snapshot') return snapshot();
  if (action === 'read') {
  }
  if (action === 'scroll') {
  } else if (action === 'click') {
  } else if (action === 'fill') {
  } else if (el.isContentEditable) {
  } else if (action === 'press') {
  }
};
```

### 对 Agent Loop 的影响

主要有两个区别：

目前的 agent loop 在调用浏览器的时候可能会停止，交给用户执行关键操作（被称作 `handoff`），所以对应的 loop 循环中也会有一些“暂停”的操作。

另一个区别是在 `ToolEnv` 中加入 `BrowserController`。之前我一直没有关注过这个类（之前它叫做 `ToolContext`），但是我觉得还挺有意思的，它说的是调用 `tool` 的参数，并不一定是 LLM 提供的，还有可能是 agent 自己提供的。原来这个里面是 `conversationID` 就是用于 memory tool 检索对话，`currentUserMessage` 用于 memory tool 查看当前要记忆的信息。

之所以引入了 `browser` ，是因为 LLM 需要连续操作浏览器，`browser` 相当于是一个持续存储的浏览器状态。

所以更进一步，其实 `ToolEnv` 中存着的是与 tool 相关的持久状态量。

## 日程管理

此外我还想到，maliu 的核心卖点是什么，如果只是说功能的强大，那可能再怎么努力，也比不过 compute-use 的 agent 。

那么 mobile app 到底有什么不同呢？那么我觉得日程管理功能了，毕竟只有手机才是唯一全天陪伴我们的计算设备，那么日程管理 feature 似乎就是很重要的了。
