# The Evaluation Framework and Memory Initial

## Evaluation

### Types

对于 Agent ，需要测试的东西是比普通软件要多的：

- 功能正确性：程序是否实现了预期的功能
- 性能：程序运行的是否很快
- 智力：模型完成任务的成功率高不高
- 其他：比如说 API 的用量，耗电情况等

所以要有不同的方法去测试。

### Tradeoff

我觉得可以首先只测试程序的正确性，而性能（尤其是），智力之类的指标，可以后面随着需求的增加而逐步提升，而不是现在开发出一套完整的评测框架。

这是因为我在项目初期，也很难积累下来足够评测他们的样例，所以只能暂时延后了。

正确性测试是不需要在线的 API 的。基于这些点，我对于最开始 vibe 出来的统一框架进行了删减。目前它们都在 `test/` 下。

## AGENTS.md

考虑到 vibe coding 的大背景，我觉得提供一些专门给 Agent 的 context 是很有必要的。目前是写了 `AGENTS.md` 和 `CONTRIBUTING.md` 。

主要是避免防御性编程，并统一 git 使用规范。

## Memory

只有开始做 Memory 之后，我才意识到 memory 有多难。

### 种类

Memory 的种类是很多的，我粗略想了想，大概是 [这里](../memory.md) 里面列举的这几种。

和测试一样，我就先实现了非常简单的记忆功能，即“从过去的聊天记录中搜索”和“用 key-value 的形式保存的事实记忆”。

### 文件夹

我新建了一个 `memory/` 的文件夹，用于专门放 memory 相关的代码，主要是因为我觉得对于 mobile-use 这种智能比较有限的场景，还是需要专门设计一个强力的 memory 系统的（Hermes 也是类似思路）。

### Fact 实现

引入了一个名为 `memories` 的 sql 新表用于记录 facts ，本质就是 KV map 。

提供了 `search`, `upsert`, `delete` 工具用于查询和更新记忆。目前记忆的新建依然是依赖于 LLM 自己的调用的。
