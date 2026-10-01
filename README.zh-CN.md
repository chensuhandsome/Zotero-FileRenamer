# Zotero FileRenamer

Zotero FileRenamer 用 INSPIRE-HEP 的参考文献与被引关系，为 Zotero 条目自动生成结构化标签，并把标签放在题名前面。

示例：

- `[N1] 基础文献标题`
- `[N1-4] N1 的第 4 个参考文献`
- `[N1-C2] 第 2 篇引用 N1 的文献`
- `[N1][N2-C3] 同时和多个基础文献相关的条目`

显示效果是在 Zotero 标题列中直接看到：

```text
[N1-4] Paper title
```

## 功能概览

- 在标题前缀中直接显示标签
- 在 `Extra` 中保存插件管理状态，避免标签漂移
- 支持把选中文献标记为一级文献（basic / first-order）
- 根据 INSPIRE 的参考文献与被引关系更新派生标签
- 条目进入插件管理时，默认使用当前 Zotero 标题作为题名主体
- 文献进入插件管理后，用户仍可自由修改题名主体
- 错误与提示使用 Zotero 右下角/角落通知，不弹独立窗口
- 可分别设置一级文献和派生文献的标题颜色

## 兼容性

- 支持 Zotero 7、8、9 和 10（从 v1.1.0 起支持 Zotero 10）
- 需要目标条目能识别出 INSPIRE recid

插件会按以下顺序识别 INSPIRE recid：

- `archiveLocation` 字段中是纯数字
- `URL` 字段中包含 `inspirehep.net/literature/...` 或 `.../record/...`
- `Extra` 字段中包含 INSPIRE 链接

## 安装

### 从 Release 安装

1. 从 GitHub Releases 下载最新 `.xpi`
2. 在 Zotero 中打开 `工具 -> 插件`
3. 点击右上角齿轮，选择 `Install Plugin From File...`
4. 选中下载的 `.xpi`
5. 如果 Zotero 提示重启，则重启 Zotero

### 本地构建

```bash
npm install
npm test
npm run build
```

打包后的插件位于 `build/` 目录。

## 基本使用流程

1. 把相关文献放在同一个 collection，或者直接在整个 library 中操作
2. 确保这些文献能识别出 INSPIRE recid
3. 选中一级文献，右键使用 `FileRenamer -> Mark as Basic`
4. 对选中文献使用 `Update Labels`，或对当前 collection / library 使用 `Update All`
5. 在 Zotero 设置中的 `FileRenamer` 面板调整参数

## 右键菜单说明

插件会在 Zotero 条目右键菜单中增加 `FileRenamer` 子菜单。

### Update Labels

只更新当前选中的条目。

但排序与识别所依据的一级文献集合，仍然来自当前 collection 或当前 library。

规则：

- 只处理已经有标签的条目
- 或者标题中手动写入了一个合法 basic 标签的条目
- 普通未标记条目会被忽略

### Mark as Basic

把选中文献标记为一级文献。

例如：

- 前缀设置为 `N` 时：`N1`, `N2`, `N3`
- 前缀留空时：`1`, `2`, `3`

### Clear Labels

清除选中文献上的 FileRenamer 标签。

效果：

- 从标题中去掉可见标签前缀
- 从 `Extra` 中去掉插件管理的标签行
- 保留存储的题名主体，方便后续重新进入管理

### Update All

更新当前 collection 中所有符合条件的条目；如果当前没有选中 collection，则更新当前 library 中所有符合条件的条目。

它不会：

- 给普通未标记条目自动加标签
- 自动修正非法手写前缀

它只会处理：

- 已经被插件管理的条目
- 或标题中已有一个合法 basic 标签的条目

## 标签规则

### 一级标签（basic label）

一级标签用于表示根文献。

示例：

- `[N1]`
- `[A3]`
- `[1]`

合法格式：

```text
^(?:[A-Za-z]+)?\d+$
```

含义：

- 前缀只允许 ASCII 字母
- 末尾必须是数字
- 前缀可以为空
- 中文前缀或其他非 ASCII 前缀不会被识别为合法标签

### 派生标签（derived label）

派生标签来自一级文献与当前条目的 INSPIRE 关系。

示例：

- `[N1-4]`：该条目是 `N1` 的第 4 个参考文献
- `[N1-C2]`：该条目是第 2 篇引用 `N1` 的文献

合法格式：

```text
^(?:[A-Za-z]+)?\d+-(?:\d+|C\d+)$
```

规则：

- 同一层中，普通参考标签排在 citation 标签之前
- citation 使用 `C`
- 三层标签如 `[N1-2-3]` 会被丢弃
- 派生标签不能在未标记条目上手动创建

### 截断显示标签

如果一个条目的真实标签数量超过显示上限，标题中会显示 `[+N]`。

例如：

```text
[N1][N2-C1][+3] Some paper
```

注意：

- `[+N]` 只是显示摘要
- 它不被当作真实标签
- 每次刷新标题时都会根据真实元数据重新生成

## 手动命名规则

插件对手写前缀采用严格规则。

### 允许的情况

只有在条目当前没有标签时，才允许手动创建标签；而且标题前缀必须恰好是一个合法 basic 标签。

合法示例：

- `[N1] Paper`
- `[M2] Paper`
- `[3] Paper`

### 不允许的情况

以下写法不会被识别为插件标签，也不会被自动纠正：

- `[中文1] Paper`
- `[A-1] Paper`
- `[N1-C2] Paper`
- `[N1][N2] Paper`

如果条目已经处于 FileRenamer 管理之下，手动改动已有标签前缀会被恢复，以保持一致性。

## 标题与 `Extra` 的管理方式

插件把“标签前缀”和“题名主体”分开管理。

### 可见标题

Zotero 标题字段最终会显示为：

```text
[labels] base title
```

### `Extra` 中保存的内容

插件会写入两行：

```text
FileRenamer: N1, N2-C3
FileRenamerBase: Base title without labels
```

含义：

- `FileRenamer:` 保存真实标签
- `FileRenamerBase:` 保存不带标签前缀的题名主体

### 用户优先的题名主体

一旦条目进入插件管理：

- 用户修改题名主体时，插件会同步更新 `FileRenamerBase:`
- 插件保留现有标签，不会把用户改动的题名主体覆盖掉
- 之后再次刷新时，会用当前标签和保存的题名主体重新拼接标题

如果条目刚进入管理且还没有保存的主体标题，插件会直接使用当前 Zotero 标题文本作为初始题名主体。

## 插件如何收集并识别条目

这是插件更新标签时使用的核心逻辑。

### 作用范围

插件始终以当前 Zotero 视图为准：

- 如果当前选中了 collection，就以该 collection 为范围
- 否则就以当前 library 为范围

### 一级文献集合的识别

在当前范围内，插件会寻找满足以下条件的条目：

- 是普通 Zotero 条目
- 恰好有一个一级标签
- 能识别出 INSPIRE recid

这些条目构成当前的一级文献集合。

### 派生条目的识别

对于每个一级文献，插件会读取或抓取 INSPIRE 数据：

- 该一级文献引用了哪些文献
- 哪些文献引用了该一级文献

如果某条目的 recid 出现在对应列表中，就会得到：

- `Base-N` 形式的参考文献标签
- `Base-CN` 形式的被引标签

同一个条目可以同时从多个一级文献获得标签。

### 排序规则

- 参考文献标签按 INSPIRE 返回顺序编号
- citation 标签按 INSPIRE `dateasc` 顺序编号
- 同一层内，普通标签排在 citation 标签之前

## 设置项

插件会在 Zotero 设置中注册 `FileRenamer` 面板。

### Auto-Update

- 开启或关闭后台自动更新
- 设定更新频率（小时）

后台更新会扫描所有 library，但只会重新处理已经有管理标签的条目，或标题中已有一个合法 basic 标签的条目。

### Network

- `Offline Mode`：只用缓存，不访问 INSPIRE

开启后，插件不会发出网络请求。

### Labeling

- `Max labels shown per item`
- `Basic label prefix`
- `Highlight basic titles`
- `First-order title color`
- `Highlight derived titles`
- `Derived title color`

补充说明：

- basic 前缀留空时，一级标签直接使用 `1`, `2`, `3`
- 修改 basic 前缀只影响之后新生成的一级标签
- 现有标签不会被自动整批改写

## 提示与错误

插件使用 Zotero 角落通知显示状态。

常见提示包括：

- 当前范围内没有找到一级文献
- 缺少 INSPIRE recid
- 非法手写前缀被原样保留
- 某条目有多个一级标签，因此被跳过

## 限制

- 标签生成依赖 INSPIRE recid
- `Update Labels` 虽然只更新选中条目，但一级文献集合仍来自当前 collection 或 library
- 未标记条目只能手动创建一级标签，不能手动创建派生标签

## 更新日志

### 1.1.0

- 支持 Zotero 10：manifest 允许的最高版本改为 `10.0.*`，Zotero 7-9 仍可使用。
- 适配 Zotero 10 重构后的条目列表，标题着色恢复正常（1.0.0 使用的渲染钩子在 Zotero 10 中已不存在）。
- 当前视图没有条目时，标签作用范围改为所有选中的 collection 或 library；在 Zotero 10 的分类栏中多选时不再报错。

## 开发

常用命令：

```bash
npm test
npm run build
npm start
```

主要源码位置：

- `src/modules/labeler.ts`：标签解析、存储与更新
- `src/modules/menu.ts`：右键菜单
- `src/modules/settings.ts`：设置读取
- `src/modules/titleStyler.ts`：标题颜色
- `src/modules/inspireApi.ts`：INSPIRE 数据抓取与缓存
