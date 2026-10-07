# experiments

实验性工作区。这里放各种「验证某个想法」的独立项目，不属于主程序。

每个子目录自带一份构建配置，产物和主程序完全隔离，不进正式发布。
子目录里的实验产物同样不入库。

## pack-jianxin

**模拟器 + 游戏打包成单一静态页面，打开即玩。**

动机：主程序的形态是「用户打开网站 → 看到空列表 → 自己找 .jar」。
这个实验想验证另一种形态：「用户打开一个链接 → 游戏直接启动」，
把模拟器和游戏当成一个不可分割的整体发布，屏蔽掉 jar、J2ME 这些概念。

### 用法

游戏 jar 需要自己准备 —— 《仙剑奇侠传》之类商业作品不能进仓库，
`experiments/**/games/*.jar` 已加入 `.gitignore`。

把 jar 放到 `experiments/pack-jianxin/games/` 下，然后改
`pack.config.json` 里的 `game.name` / `game.fileName` / `game.jar`，
以及 `identity`（见下面「存档隔离」）。

```bash
npm install
npx vite build --config experiments/pack-jianxin/vite.pack.config.ts
node experiments/pack-jianxin/verify-dist.cjs    # 可选，校验内嵌的 jar 是否完整
```

产物在 `experiments/pack-jianxin/dist/`。

### 静态托管

产物是**纯静态**，没有后端、没有服务端渲染、没有 WASM、没有 CDN 依赖，
没有任何运行时外部请求。丢到哪儿都能跑：

```bash
cd experiments/pack-jianxin/dist && python3 -m http.server 8000
```

- 任意静态托管：GitHub Pages、Cloudflare Pages、Nginx、对象存储……
- 放子目录也可以，`base: './'` 走相对路径（`/games/jianxin/` 不会 404）
- `file://` 直接双击 `index.html` 同样能跑
- HTTPS 不是必需，但公网托管一般会强制

一份《仙剑奇侠传 忘情篇》实测：
`index.html` + `app.js` + `index.css` 共 **3 个文件 1.72 MB**，
`tar -czf` 之后 **1.20 MB**。GitHub Pages 额度 1 GB，用掉 0.12%。

### 打包模式下和主程序的差异

`__PACK__` 存在时会：

- 跳过库界面，启动即 `play()` 内嵌的 jar，不渲染上传入口
- 不渲染工具栏的「← 返回游戏列表」和崩溃界面的「返回列表」
  （没有列表可回退，按钮只会跳到只能上传 jar 的空页面）
- 用固定的 `identity` 作为 IndexedDB 名和 RMS `storageId`

`__PACK__` 不存在时（即正式构建）行为完全不变，走原来的库流程。

### 存档隔离

`identity.databaseName` 和 `identity.storageId` 在配置里**写死**，
不从 jar 清单推导。因为同域名下部署多个游戏包时如果都从 manifest 推导，
很可能撞车 —— 结果是一个游戏的存档被另一个覆盖。

换游戏时记得同时换这两个值，否则会读到上一个游戏的存档。

### 一个值得记的坑

注入 `window.__PACK__ = {...}` 必须放在 `main.ts` 的**模块顶部**，
不能拼在文件尾部。

ESM 模块内代码按书写顺序执行，而 `boot()` 是 `async` 函数、同步部分
立刻跑到底。如果赋值排在 `boot()` 调用之后，读取到的还是 `undefined`，
于是错误地回退到库界面 —— 表现为「打包后打开是空列表」，
但构建产物里的 `__PACK__` 明明存在（很容易误判成 jar 没打进去）。

另外注入代码必须是纯 JS，不能带 TS 语法（如 `as any`），
否则在 transform 阶段会按 JS 解析而报错。

`verify-dist.cjs` 用来防这类问题：它会静态解析产物里的注入对象，
校验内嵌的 jar 与磁盘上的原文件**逐字节相同**，不做字符串包含判断
（jar 是 base64，直接搜前缀会因为优化/转义产生误判）。

### 当前状态

已跑通。直接打开即进入游戏，无库界面。