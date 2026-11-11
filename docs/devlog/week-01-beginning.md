# The Begining of Maliu

## Architecture

我 Vibe 了项目的基础架构。基于 `Expo` 和 ``React Native`` 构建移动端应用，agent 本体采用 Typescript 实现，涉及 Android 原生能力，通过 Expo Modules API 编写 Kotlin 原生模块。主要是为了后续的跨平台做准备。

## Typescript

补充了一波 Promise 等异步编程相关的知识，记录在了 [这里](https://thysrael.github.io/obsidian-quartz/Javascript-Async) 。

再次感慨为什么自己的第一门语言不是 Javascript/Typescript ，这个语言更清晰地描述了“异步”或者“状态管理”这些问题，它们在 C 或者 C++ 中，常常被机械的语法和繁复的底层细节所掩盖。

## React

又补充了一波 React 的基础知识，这是真的一点也不会啊。记录在了

了解过后感觉 DSH 的那一套理论，也没有那么石破天惊了。可能像前端这种复杂场景，早就需要用函数式，effect 等形式化的表述了。

## Folder Structure

APP 的入口文件是 `app.tsx` ，里面进行了初始化，并调用了 `src/screens/MainScreen.tsx`，在这里面调用 `runTurn()` ，再在 `runTurn()` 中调用 `runAgent()` 。

- `src/`: APP 源码目录
  - `screens/`: 是 APP 的 UI 界面，不同功能对应不同界面
  - `components/`: 可以被复用的 UI 组件
  - `agent/`: agent 相关实现
  - `model/`: 模型 API 适配
  - `tools/`: 模型用到的工具
  - `memory/`: 模型记忆
- `module`: Android 原生模块
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

### Loop

如前所述，当用户输入了一条信息（prompt）以后，就会发生：

```javascript
send() => runTurn() =>  runAgent()
```

在 `runTurn()` 中，主要是负责：

- 组装 `context`:
  - `history`: 过去的历史信息，LLM API 是无状态的。这里会根据 `maxChar` 对较老的历史做截断。
  - `tools`: 工具调用信息
  - `systemPrompt`: 这一版是 agent 生成的，感觉主要强调了时间，工具调用，避免幻觉
  - `prompt`: 也就是用户的输入
- 让 agent 输出落盘到数据库中。

而 `runAgent()` 就是经典的 ReAct Loop，调用 Model API，处理 tool calls，并用传入的 `publish` 更新页面。

### Session

目前用 mysql 来持久化 session 。主要是 `conversations` 和 `messages` 两张表。`messages` 里面每个表项是一条 `message` ，通过 `conversationId` 来记录自己属于哪个 `conversation` 。

### Tools

`execute()` 是 tools 的实现，是不用发给大模型的。

## Summary

目前只有一个基础的 agent loop 。前路险阻呀，因为我既不懂 `react` ，也不懂 `agent` ，甚至连 Typescript 懂得都不是很多。

希望后面能开发出一个模块化很好的 agent 的，为插件化做准备。

不应该 vibe 一大坨的，太难 review 了。
