# The Begining of Maliu

## Summary

我 Vibe 了项目的基础架构。采用的是 `react-native` + `expo` 的软件栈。目前有一个基础的 agent loop 。

前路险阻呀，因为我既不懂 `react` ，也不懂 `agent` ，甚至连 Typescript 懂得都不是很多。

## Typescript

补充了一波 Promise 等异步编程相关的知识，记录在了 [这里](https://thysrael.github.io/obsidian-quartz/Javascript-Async) 。

再次感慨为什么自己的第一门语言不是 Javascript/Typescript ，这个语言更清晰地描述了“异步”或者“状态管理”这些问题，它们在 C 或者 C++ 中，常常被机械的语法和繁复的底层细节所掩盖。

## React

### F(props, state) -> UI

```javascript
F(props, state) -> UI
```

这是 `react` 的一种设计理念，我理解就是，UI 组件会被 `react` 表达成一个 JS 函数 `F`，如下所示：

```javascript
function F(props) {
  return <Text>{props}</Text>;
}
```

可以看到返回的部分是一个类似于 HTML 的代码（BTW，这种语法叫做 `JSX`，也就是 JavaScript XML）。然后这个 HTML 代码内部是用 `{}` 嵌入了 JS 的函数变量的。在渲染过程中，react 就会调用这个函数，来渲染出相关的组件。

> 强调一下，只要触发 UI 的渲染，react 都会重新调用这个函数。

`props` 是 `properties` 的缩写，说白了就是组件的输入，也就是函数的参数。

那么为什么还有一个 `state` ，这是因为如果仅依赖 `props` 那么函数就是一个毫无副作用的纯函数了，这样表达能力有限，所以我们还需要一种类似于“全局变量”的东西，去帮我们跨渲染次数的维护状态，这就是 `state` 。引入了 `state` 的示意函数如图所示：

```javascript
function F(props) {
  const initValue = 'hello';
  const [state, setState] = useState(initValue);
  return <Text>{props + state}</Text>;
}
```

可以看到我们用 `useState()` 声明了一个 `state`：

```javascript
const [state, setState] = useState(initValue);
```

我们传入 state 的初始值，返回这个 state 和它对应的 setter 。之所以需要额外的 setter，是因为 react 需要拦截 state 的变化，方便异步编程。

### UseEffect

那么 state 有什么独特之处呢？我理解 state 是构建 react 异步编程的重要节点。当 state 发生变化的时候，注册在它上面的 callback 函数就会被调用，进而导致 UI 状态的刷新。盲猜一波，这就是 react 名字“响应式”的由来。

为了实现这个功能，react 采用 `useEffect()` 来实现：

```javascript
useEffect(callback, dependency);
```

也就是当 `dependency` 发生变化的时候，就调用 `callback` 函数。`dependency` 就是一个 state 数组。比如说：

```javascript
useEffect(() => {
  console.log(count);
}, [count]);
```

以后 `count` 这个 state 每次变化的时候，都会在控制台打印它。

此外 `dependency` 也有两种特殊情况：

```java
useEffect(callback); // 本次 UI 提交后执行，以后每次提交渲染后也执行
useEffect(callback, []); // 首次 UI 提交后执行，普通重新渲染不会再次执行。
```

需要注意的是，它们都是“UI 提交”（也就是 `return` ）后执行，这是因为提交意味着“渲染成功”，此时再计算副作用才是合理的；如果渲染失败了，那就不应该考虑副作用。

这个执行顺序也很有趣，也就是说有如下例子：

```javascript
function F() {
  const [state, setState] = useState(1);
  useEffect(() => {
    console.log(count);
  }, []);
  console.log(2);
  return <Text>"hello"</Text>;
}
// print "2 1", not "1 2"
```

### SafeArea

`safe` 指屏幕上不会被设备系统元素遮挡的可用区域。

### UseRef

`useRef()` 和 `useState()` 类似，都是可以跨函数保存的“全局变量”，但是 `useRef` 是不会触发渲染的，也就是你修改了 `useRef()` 并不会导致 UI 重新渲染，所以一般使用 `useRef` 的都不是在 UI 上会展示的变量。

`useRef` 使用方法如下：

```java
const value = useRef(initialValue);

value.current;       // read
value.current = xxx; // write
```

注意它是不需要 setter 来更新的。这是因为 ref 不会触发渲染，也不会触发 effect ，所以没必要额外用一个 setter 去拦截。

### UseCallback

虽然这个 hook 的名字叫做 `callback` ，但是和回调这个动作没有关系（我还以为它和 `useEffect()` 相似呢）。它主要是避免回调函数的重复声明，看下面这个例子：

```javascript
function Counter() {
  const [count, setCount] = useState(0);

  const increment = () => {
    setCount(count + 1);
  };

  return <Button title="Add" onPress={increment} />;
}
```

可以看到这里定义了一个 `increment` 函数，但是问题在于，每次重新渲染的时候，都会重新定义创建一遍 `increment` ，在不同的渲染调用中，这是不同的，这就产生了一定的开销。能不能每次都复用函数呢？这就是 `useCallback` 的作用：

```javascript
function Counter() {
  const [count, setCount] = useState(0);

  const increment = useCallback(() => {
    setCount((prev) => prev + 1);
  }, []);

  return <Button title="Add" onPress={increment} />;
}
```

## Folder Structure

APP 的入口文件是 `app.tsx` ，里面进行了初始化，并调用了 `src/screens/MainScreen.tsx`，在这里面调用 `runTurn()` ，再在 `runTurn()` 中调用 `runAgent()` 。

- `src/`: APP 源码目录
  - `screens/`: 是 APP 的 UI 界面，不同功能对应不同界面
  - `components/`: 可以被复用的 UI 组件
  - `agent/`: agent 相关实现
  - `model/`: 模型 API 适配
  - `tools/`: 模型用到的工具
  - `memory/`: 模型记忆
- `scripts/`: 开发脚本
- `eval/`: 评测框架

## Agent

### Types

一个对话被称为一个 `conversation`，每个 conversation 中又有多轮用户交互，被称作 `turn`，每个 `turn` 又由多个 `message` 组成。

注意一个 turn 是以用户输入一次为标志的，所以一个 turn 可能内部有多轮 API 与 Agent 的交互。

```text
conversation 1：讨论旅行计划
│
├─ turn 1
│  ├─ user message：推荐一个旅行目的地
│  └─ assistant message：可以考虑杭州……
│
└─ turn 2
   ├─ user message：查一下那里的天气
   ├─ assistant message：请求调用天气工具
   ├─ tool message：工具返回天气信息
   └─ assistant message：根据天气给出建议
```
