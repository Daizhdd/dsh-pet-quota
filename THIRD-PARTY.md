# 第三方内容说明

本插件的代码是 MIT。它对外只有一处依赖，且**不改动任何第三方代码**。

## 运行时依赖：`@linxin666/dsh-pet`

气泡是通过它的**公开跨插件接口**推送的：

```js
ctx.pet.announce({ source, kind, title, amount, note, tone, ttlMs })
```

这条接口写在它自己的 README 里（"Host-side sibling plugins can push one structured announcement through the `pet` cordis service"），属于官方支持的协作方式。它的设计笔记还明确记着：该契约自 2026-09-17 起**没有内置发布方**，预期由第三方插件使用。
除此之外本插件只读 `ctx.get('pet')` 是否存在来判断"有没有地方显示气泡"，
**不写对方的配置、不改对方的文件、不动对方的宠物选择**。

未安装它时：插件不报错，数字照常统计，只是气泡无处显示（`GET /api/pet-quota/today`
的 `petAvailable` 会是 `false`）。

## 数据来源：`dsh-usage` 的账本（可选）

插件启动时会**只读**一次 `$DSH_HOME/dsh-usage/usage-ledger.json`，用来回填当天的历史用量。
该文件属于 `@linxin666/dsh-usage`（同样来自 dsh-web 全家桶）。文件不存在时跳过回填，
插件自行从零开始累计，不影响使用。

## 本仓库不含美术素材

没有宠物形象、没有截图、没有预览图。额度气泡是纯文本 + Emoji 圆点，
所以本插件可以独立于任何角色形象使用。

