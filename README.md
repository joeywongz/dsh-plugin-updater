# dsh-my-plugin-updater

DeepSeek Harness (dsh) 插件管理器：检查已安装插件的新版本、按版本升级、一键升级、启用/停用（开关）、卸载，展示每个插件的官方地址链接，以及在会话菜单里刷新会话标题。

源码在 `/Users/joeywong/dsh-plugins/dsh-my-plugin-updater`。

## 技术栈

- **TypeScript**（strict）—— 宿主半边与浏览器半边全部类型化
- **React 18** —— 页面与会话菜单组件（`React.createElement` 经典 JSX，React 由宿主注入，不打进 bundle）
- **Tailwind CSS 3** —— 样式在构建时编译进 bundle，运行时注入 `<style>`；关闭 `preflight`，避免影响宿主页面；颜色全部映射到 `--dsw-alias-*` 主题变量
- **Zustand 4**（vanilla core）—— 插件状态存于单一 store，React 用轻量 hook 订阅
- **Vite 6** —— 把浏览器半边打成 CommonJS，再由 `scripts/build.mjs` 包进 DSH 的 `window.__ModuleLoader__.load({ factory(require) {…} })`
- **tsc** —— 编译宿主半边（`src/host` → `lib/index.js`）

## 目录结构

```
src/
  host/index.ts          宿主半边：注册 /refresh-title 会话命令
  shared/types.ts        宿主/浏览器共用类型（BundleInfo、ChangeResult…）
  client/
    entry.tsx            构建入口：导出客户端插件对象
    plugin.tsx           apply：样式注入、i18n、槽位注册、Remote 绑定
    App.tsx              「插件更新」标签页
    BundleRow.tsx        单行：版本、状态、启用开关、升级菜单、卸载确认
    SessionMenu.tsx      会话行「…」菜单项：刷新标题
    components.tsx       Tailwind 基础控件（按钮/开关/图标/状态）
    engine.ts            全部操作：检查、升级、启停、卸载、刷新标题
    store.ts             Zustand store 与状态更新助手
    hooks.ts             store / locale 的 React 绑定
    i18n.ts              中英文案与 locale 辅助
    services.ts          Remote 接口与命名空间解析
    utils.ts             semver、registry URL、错误文案等纯函数
    styles.css           Tailwind 指令
dist/client.js           构建产物（package exports "./client"）
lib/index.js             构建产物（package 主入口）
test/harness.mjs         针对构建产物的集成测试
scripts/build.mjs        vite → loader 包装 → tsc
```

## 开发

```sh
npm install
npm run typecheck   # tsc 严格模式检查浏览器半边
npm test            # 43 项集成检查（加载真实构建产物 + 伪 Remote + 迷你 React 渲染器）
npm run build       # 重新生成 dist/client.js 与 lib/index.js
```

改完源码后 `npm run build`。页面开着时，Host 的 client-hmr 会轮询本包的 `dist/client.js`（约 500ms），检测到改动后自动热替换本插件，无需刷新页面或重启应用。

注意：Host 会把每个包的客户端元数据（`dsh.client` 声明、`exports["./client"]` 指向的路径）缓存到重启为止。若改动过这两处，或在 Host 启动后才新增／重装插件，热替换不会生效，旧缓存还会让客户端半边加载失败；此时需要完全退出并重新打开 DeepSeek Harness（仅关闭再启用插件、仅刷新页面都不够）。

## 功能

- **打开即检查**：客户端加载时（`dsh.client.immediately`）读取已安装插件，并向 npm registry 并发查询最新版本；失败时退回已配置的插件市场索引。
- **入口在左侧栏「插件」里**：Plugins 页面新增 **插件更新 / Updates** 标签页。
- **按「外部 / 内置 / 实验箱」分组**（外部在最上面）：
  - **外部**：安装在本 profile 的第三方插件，唯一可升级的一组；「一键升级」位于该组标题栏右侧；
  - **内置**：DSH 安装包自带的组合包，随客户端升级；
  - **实验箱**：DSH 随包提供的实验性 / 可选组合包，同样随客户端升级。
- **版本对照 + 按版本升级**：点「升级 ▾」展开可用版本号（标出最新 / 预发布 / engines.dsh 提示），选中即按该版本重装。
- **每个插件展示官方地址**：标题旁显示「官方地址 ↗」徽标，点击在新标签页打开该插件的官方页面。若版本来自已配置的市场索引，优先使用该条目的 `homepage` / `repository`；否则按 npm 版本清单解析：`repository.directory` 目录深链（如 `…/tree/HEAD/packages/bundle/base`，让同仓库的多个内置插件各自指向自己的包目录）→ `homepage` → `repository`（Git URL 自动转成网页地址）→ 公共 npm 包页面。Git 安装的插件直接使用其仓库地址；`file:` / `link:` 本地安装的插件仍会按包名查询 npm，因此「本地开发但已发布」的插件也能拿到官方地址；确实没有公开页面的插件不显示链接，避免给出打不开的地址。
- **启用 / 停用**：每行一个「启用」开关，切换即走 `setBundleEnabled`；由 DSH 托管的组合包不显示。
- **卸载**：仅对 profile 安装的插件显示，二次确认后走 `removeBundle`。
- **刷新会话标题**：会话行「…」菜单里的「刷新标题」，调用宿主命令 `/refresh-title` → `ctx.sessionTitle.refresh()`，同时取消手动改名造成的标题固定；也可在输入框直接输入 `/refresh-title`。

## 实现要点

- **React 只从宿主加载**：bundle 把 `react` 标记为 external，构建产物里只有 `require("react")`，由 DSH 的模块加载器提供，避免出现第二份 React。
- **样式随插件注入**：`styles.css?inline` 编译成字符串，`apply` 时插入 `<style data-dsh-plugin="dsh-my-plugin-updater">`，插件卸载时移除。
- **升级路径**：DSH 没有 `updateBundle`，所以是 `removeBundle` + `installBundle(name@version, { enabled, saveExact: true })`；失败自动回滚到原版本。
- **官方地址解析**：`resolveOfficialUrls` 与版本检查并行执行（并发 3），对每个插件请求**当前已安装版本**的版本清单（比完整 packument 小），失败再退回 `/latest`，避免过期 dist-tag 决定链接；取 `repository.directory` 目录深链 / `homepage` / `repository`，必要时回退到 `https://www.npmjs.com/package/<name>`。市场索引搜索结果里的 `homepage` / `repository` 也会在版本检查时补上（`shared/types.ts` 的 `MarketEntry` 已补字段）。链接按「插件名 + 已安装版本」缓存，升级后会重新解析；只有所有请求都明确返回 404/410 时才缓存「无链接」，超时 / 5xx 等瞬时失败不缓存，下次检查重试。`repository` 支持 `git+https`、`git+ssh`、`git://`、`git@host:owner/repo` 与 `github:` 等缩写，并拒绝 `file:`、`link:`、Windows 盘符等非网页地址；目录深链只对「根路径恰为 owner/repo」的 GitHub 仓库生成，目录会做 URL 编码。链接以 `target="_blank"` + `rel="noopener noreferrer"` 渲染。
- **状态归属**：Zustand store 只保存派生数据，所有写操作仍以 Host 的 `pluginManager` Remote 结果为准，操作后重新 `listBundles()`。

## 验证

`npm test` 加载 `dist/client.js`（与宿主相同的 `factory(require)` 方式）、`lib/index.js`，用伪 `pluginManager` / `pluginMarket` / `commands` 驱动真实 UI 点击，覆盖：自动检查、分组顺序、官方地址解析与回退（首页 / 目录深链 / 仓库 / npm 页面 / Git 源 / 市场索引 / 本地安装 / 异常仓库地址 / 瞬时失败重试 / 不做多余请求）、版本菜单升级、开关启停、卸载二次确认、一键升级、会话菜单刷新标题、宿主命令。43 项全部通过。

**验证边界**：DSH 页面的视觉渲染需要真实浏览器；本仓库的测试验证的是构建产物行为与 UI 结构，不代替页面截图。
