# dsh-pet-quota

[![test](https://github.com/Daizhdd/dsh-pet-quota/actions/workflows/test.yml/badge.svg)](https://github.com/Daizhdd/dsh-pet-quota/actions/workflows/test.yml)

给 DSH（DeepSeek Harness）桌面宠物头上挂一条**今日 token 额度气泡**：
按今天的用量分轻度 / 中度 / 重度三档，档位在气泡里**只用一个彩色圆点**表示——
没有进度条，也没有百分比。

依赖 [`@linxin666/dsh-pet`](https://www.npmjs.com/package/@linxin666/dsh-pet)，
通过它公开的跨插件接口工作，**不需要修改它的代码**。

> **English**: A token-quota bubble for the DSH desktop pet. It folds today's usage from the
> session event stream (the same numbers the sidebar shows) and publishes bubbles through the
> pet's documented `ctx.pet.announce()` API. The tier is one coloured dot — no progress bar, no
> percentage. On dsh-pet 0.4.6+ the pet's own status bubbles can be switched off in its settings
> (设置 → 宠物 → 状态气泡); this plugin never touches them itself. No artwork is shipped and no
> third-party code is patched.

## 它填的是上游留出的空位

`dsh-pet` 的公告契约（`ctx.pet.announce`）是 2026-08-29 **为用量类气泡专门设计**的，
当时的内置发布方是 `dsh-usage`。2026-09-17 上游按用户要求把两者解耦——公告管线整体移出
`dsh-usage`，用量事实改到侧栏折叠摘要条——并在设计笔记里留下这段话：

> 宠物保留公告契约但**失去唯一内置发布方**——在下一个插件发布公告前，气泡栈只渲染会话驱动的气泡。

也就是说，这个契约现在**是空的，且上游明确预期由第三方插件来用**。本插件就是那个发布方：
它不改任何第三方代码、不注册常驻浮层，只用公开接口把「今日额度」放上宠物。

（契约本身只留了**一个公告位**。上游笔记里写了应对预案：「单公告槽意味着第二个公告插件会顶掉
第一个的气泡；届时**应先升级为按键 map 或槽位**，而不是叠补丁。」——如果你也在用别的公告类插件，
两者的气泡会互相顶掉；这是上游已知的待升级项，不是本插件的 bug。）

---

## 气泡长这样

```
常驻   ┌──────────────────────────┐
       │ 今日额度                  │
       │ 4352.1万 tok             │
       │ 🟢 轻度 · 今天很省，慢慢来～ │
       └──────────────────────────┘

跨档   进入中度 / 进入重度 · 鲸吞模式      （带本轮用量与圆点）
完成   任务完成 · 本轮 +1234.5万 · 🟡 中度
异常   这一轮没跑完 / 这一轮被打断了
```

| 档位 | 阈值（默认） | 圆点 | 台词 |
|---|---|---|---|
| 轻度 | `< 5000万` | 🟢 | 今天很省，慢慢来～ |
| 中度 | `5000万 – 1亿` | 🟡 | 今天烧得有点猛了… |
| 重度 | `> 1亿` | 🔴 | 鲸吞模式，我有点热… |

阈值可以在设置页改，改完立刻生效（不用重启）。

## 宠物自己也在冒泡？把它关掉（dsh-pet 0.4.6 起）

本插件只发自己的气泡，**不动宠物自带的会话/状态气泡**（「正在思考」「正在使用 xxx」）。
想只留额度气泡，把宠物那一栈关掉：

> **设置 → 宠物 → 状态气泡 → 关**（等价于给宠物那条配置写 `statusBubbles: off`）

`off` 只隐藏宠物自带的会话气泡栈与旧式单状态气泡；**本插件的公告气泡与互动反馈气泡
照常渲染**——这正是「自建气泡面」的插件需要的那一半。两种模式下状态快照都照常携带
气泡数据，只有渲染被门控，所以随时拨回来即刻恢复。

为什么不是插件替你关：上游实现这个开关时明确否决了「让发布方自行避让」（否则每个发
气泡的插件都要重造一遍抑制策略），开关属于用户。旧于该字段的 dsh-pet 没有它——
`voice.json` 的空池会被当作「没有覆盖」丢弃，皮肤机制也只换 idle 轨道——那种版本
只能改构建产物，本插件不做这件事。

## 数字是怎么来的

- 折叠 `session/event` 里的 `assistant/message.usage`，口径与侧边栏用量面板**完全一致**：
  `输入 + 缓存读 + 缓存写 + 输出`（推理 token 已含在输出里，不重复计）。
- 启动时读一次 `$DSH_HOME/dsh-usage/usage-ledger.json` 回填，所以**插件中途装上，当天的数字也是完整的**；
  之后每个心跳再对一次账，插件被禁用期间漏掉的事件也会补上。
- 跨日自动归零重算（按本地日期）。
- 子代理的轮次**只计 token、不播报**——一个 workflow 会跑几十个子轮次，逐条播报只会变成噪音。

## 安装

```bash
# link 安装（改代码后重新启用即生效）
dsh plugin --profile <你的 profile> add link:/path/to/dsh-pet-quota

# 或发布到 npm 之后
dsh plugin --profile <你的 profile> add dsh-pet-quota
```

装完**刷新一次页面**即可（加载插件的浏览器半身）。本插件不含任何宠物素材，
也不需要重扫宠物目录，所以你原有的宠物形象原样不动。

前提：profile 里启用了 `@linxin666/dsh-pet`（`@linxin666/dsh-web-all` 全家桶里自带）。
没有它时插件不会报错：数字照常统计，只是气泡没有地方显示。

## 配置

设置页在 **设置 → 宠物额度**：今日用量与档位阶梯、两个阈值输入框、三个开关
（显示额度气泡 / 任务完成时冒泡 / 长时间运行中冒泡）。改动写入
`$DSH_HOME/pet-quota/config.json`，立即生效并跨重启保留。

命令行/脚本改配置：

```bash
curl -X POST http://127.0.0.1:<port>/api/pet-quota/config \
  -H 'content-type: application/json' \
  -d '{"lowMax":30000000,"midMax":80000000}'
```

| 路由 | 用途 |
|---|---|
| `GET /api/pet-quota/today` | 当日用量、档位、阈值、开关、按模型分布 |
| `POST /api/pet-quota/config` | 改阈值与开关（越界、或重度阈值 ≤ 中度阈值会被拒） |
| `GET /api/pet-quota/boot` | 诊断：前端是否已进启动图、事件形状采样 |

## 阈值合不合适？拿你自己的账本量一下

```bash
python tools/tier_backtest.py
```

它读 `$DSH_HOME/dsh-usage/usage-ledger.json`，按**含缓存**与**不含缓存**两种口径
把你每天的用量分档，并打印峰值——一眼就能看出默认的 5000万 / 1亿 对你是太松还是太紧。
（本机实测：18 天里 14 天轻度、3 天中度、1 天重度；换成"不含缓存"口径则 18 天全是轻度——
所以口径必须含缓存，否则三档形同虚设。）

## 自测

```bash
node tools/smoke_host.mjs      # 宿主：回填、折叠、分档、圆点气泡、三类事件气泡、子代理静默、配置
node tools/smoke_client.mjs    # 前端：桩环境装配 + 渲染设置页 + 断言没有浮层注册
```

两个脚本都用临时目录当 `DSH_HOME`，**不碰你的真实数据**，可以直接当 CI 用。

## 工程笔记（踩过的坑，供同类插件参考）

1. **加载器按 specifier 缓存模块**：改了入口文件再重新启用插件，跑的还是内存里的旧模块
   （报错行号甚至会指向已删除的文件）。本插件的 `entry.js` 是一个稳定壳，每次 apply 用带
   时间戳的 query 动态载入 `host.js`——这样「改代码 → 重新启用」必定生效。
2. **`ctx.setTimeout` 是 `timer` 服务的 mixin**，没在 `inject` 里声明就会抛
   `cannot get property "timer" without inject`。本插件零硬依赖，一律用全局定时器。
3. **气泡的 `kind` 决定渲染器**：`kind:'plan'` 会被渲染成「百分比 + 进度条」，
   不想要进度条就只能用 `kind:'cost'` 或 `'balance'`。
4. **模型归属**：这个组合里没有 `request/header` 事件，模型信息在
   `assistant/message.data.message.source` 里——照抄别的插件读 `request/header` 会一直拿到
   `unknown`。
5. **数字要对得上侧边栏**：面板自己的 `totalTokens = 输入 + 缓存读 + 缓存写 + 输出`，
   而它的账本是 3 秒去抖落盘的，所以两边允许有几百 token 的瞬时差。

## 许可

MIT（见 [LICENSE](LICENSE)）。本仓库不含任何美术素材；唯一的外部依赖是运行时的
`@linxin666/dsh-pet`，见 [THIRD-PARTY.md](THIRD-PARTY.md)。
