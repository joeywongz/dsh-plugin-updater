/**
 * Integration harness for the built artifacts.
 *
 * It loads dist/client.js exactly as the host loader does (a `factory(require)`
 * registration), runs it against a fake Cordis-like context and fake Remotes,
 * renders the React tree with a tiny hook-capable renderer, and drives the UI
 * through real clicks. The Host half from lib/index.js is exercised the same
 * way with a fake Host context.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(import.meta.dirname, '..')
const failures = []
let checkCount = 0

function check(label, condition, detail) {
  checkCount += 1
  if (!condition) {
    failures.push(label + (detail ? ' — ' + detail : ''))
    console.error('FAIL ' + label + (detail ? ' — ' + detail : ''))
    return
  }
  console.log('PASS ' + label)
}

const wait = (ms) => new Promise((resolveWait) => setTimeout(resolveWait, ms))

// ---------------------------------------------------------------- fake React
let hookStates = new Map()
let currentKey = ''
let cursor = 0
let pendingEffects = []
let effectsRun = new Set()
let dirty = false

function stateList() {
  let list = hookStates.get(currentKey)
  if (!list) {
    list = []
    hookStates.set(currentKey, list)
  }
  return list
}

const React = {
  Fragment: Symbol('Fragment'),
  createElement(type, props, ...children) {
    const nextProps = { ...(props || {}) }
    if (children.length === 1) nextProps.children = children[0]
    else if (children.length > 1) nextProps.children = children
    return { type, props: nextProps, children }
  },
  useState(initial) {
    const list = stateList()
    const index = cursor
    cursor += 1
    if (!(index in list)) list[index] = typeof initial === 'function' ? initial() : initial
    return [
      list[index],
      (value) => {
        list[index] = typeof value === 'function' ? value(list[index]) : value
        dirty = true
      },
    ]
  },
  useRef(initial) {
    const list = stateList()
    const index = cursor
    cursor += 1
    if (!(index in list)) list[index] = { current: initial }
    return list[index]
  },
  useMemo(factory) {
    const list = stateList()
    const index = cursor
    cursor += 1
    if (!(index in list)) list[index] = factory()
    return list[index]
  },
  useCallback(fn) {
    const list = stateList()
    const index = cursor
    cursor += 1
    if (!(index in list)) list[index] = fn
    return list[index]
  },
  useEffect(effect) {
    const list = stateList()
    const index = cursor
    cursor += 1
    if (!(index in list)) {
      list[index] = true
      pendingEffects.push(effect)
    }
  },
  useLayoutEffect(effect) {
    React.useEffect(effect)
  },
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot()
  },
  useDebugValue() {},
}

function renderNode(node, path) {
  if (node === null || node === undefined || node === false || node === true) return null
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map((child, index) => renderNode(child, path + '/' + index))
  if (typeof node.type === 'function') {
    const key = node.props && node.props.key !== undefined ? '#' + String(node.props.key) : ''
    const componentPath = path + key
    const previousKey = currentKey
    const previousCursor = cursor
    currentKey = componentPath
    cursor = 0
    const output = node.type(node.props)
    currentKey = previousKey
    cursor = previousCursor
    return renderNode(output, componentPath)
  }
  const children = (node.children || []).map((child, index) => renderNode(child, path + '/' + index))
  return { type: node.type, props: node.props || {}, children }
}

function flushEffects() {
  const effects = pendingEffects
  pendingEffects = []
  for (const effect of effects) {
    try {
      effect()
    } catch (error) {
      console.error('effect failed', error)
    }
  }
}

function* walk(node) {
  if (!node) return
  if (Array.isArray(node)) {
    for (const child of node) yield* walk(child)
    return
  }
  if (typeof node === 'string') return
  yield node
  for (const child of node.children || []) yield* walk(child)
}

function textOf(node) {
  if (node === null || node === undefined) return ''
  if (typeof node === 'string') return node
  if (Array.isArray(node)) return node.map(textOf).join('')
  return (node.children || []).map(textOf).join('')
}

function normalizedText(node) {
  return textOf(node).replace(/\s+/g, ' ').trim()
}

function findButtons(tree, predicate) {
  const output = []
  for (const node of walk(tree)) {
    if (node && node.type === 'button' && predicate(node)) output.push(node)
  }
  return output
}

function findButtonByText(tree, text) {
  return findButtons(tree, (node) => normalizedText(node) === text)[0] || null
}

function findRow(tree, name) {
  for (const node of walk(tree)) {
    if (node && node.props && node.props['data-dsh-plugin-row'] === name) return node
  }
  return null
}

function buttonsInRow(tree, name, text) {
  const row = findRow(tree, name)
  if (!row) return []
  return findButtons(row, (node) => normalizedText(node) === text)
}

function findLinks(node) {
  const output = []
  for (const item of walk(node)) {
    if (item && item.type === 'a' && item.props && typeof item.props.href === 'string') output.push(item)
  }
  return output
}

function linksInRow(tree, name) {
  const row = findRow(tree, name)
  return row ? findLinks(row) : []
}

function findSwitches(node) {
  const output = []
  for (const item of walk(node)) {
    if (item && item.props && item.props.role === 'switch') output.push(item)
  }
  return output
}

// ------------------------------------------------------------ fake page/env
function createElement(tag) {
  return {
    tagName: tag,
    dataset: {},
    textContent: '',
    remove() {},
  }
}

globalThis.window = globalThis
globalThis.document = {
  head: { appendChild() {} },
  createElement,
  addEventListener() {},
  removeEventListener() {},
}
Object.defineProperty(globalThis, 'navigator', {
  value: { language: 'zh-CN' },
  configurable: true,
})

let capturedDefinition = null
globalThis.__ModuleLoader__ = {
  load(definition) {
    capturedDefinition = definition
  },
}

const fetchCalls = []
let flakyMode = true

function fakeFetch(url) {
  const target = String(url)
  fetchCalls.push(target)
  if (flakyMode && target.includes('/flaky-plugin/')) {
    // Simulates a timeout / network failure: not a definitive "no such package".
    return Promise.reject(new Error('fake network down'))
  }
  const match = /registry\.(?:npmjs\.org|npmmirror\.com)\/(.+)$/.exec(target)
  if (!match) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
  const path = decodeURIComponent(match[1])
  for (const name of Object.keys(manifests)) {
    if (path === name + '/latest' || path === name + '/' + manifests[name].version) {
      return Promise.resolve({ ok: true, status: 200, json: async () => manifests[name] })
    }
  }
  const document = documents[path]
  if (!document) return Promise.resolve({ ok: false, status: 404, json: async () => ({}) })
  return Promise.resolve({ ok: true, status: 200, json: async () => document })
}

/** Abbreviated packuments used by version checks. */
const documents = {
  'dsh-context': {
    'dist-tags': { latest: '0.74.0' },
    versions: {
      '0.73.3': { name: 'dsh-context', version: '0.73.3', engines: { dsh: '>=0.1.7-rc.2 || >=0.2.0-rc.2' } },
      '0.74.0': { name: 'dsh-context', version: '0.74.0', engines: { dsh: '>=0.1.7-rc.2 || >=0.2.0-rc.2' } },
    },
  },
  '@michengai/dsh-skills-manager': {
    'dist-tags': { latest: '1.2.11' },
    versions: {
      '1.2.9': { name: '@michengai/dsh-skills-manager', version: '1.2.9' },
      '1.2.11': { name: '@michengai/dsh-skills-manager', version: '1.2.11' },
    },
  },
  'weird-repo': {
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { name: 'weird-repo', version: '1.0.0' } },
  },
  'gitlab-mono': {
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { name: 'gitlab-mono', version: '1.0.0' } },
  },
  'flaky-plugin': {
    'dist-tags': { latest: '1.0.0' },
    versions: { '1.0.0': { name: 'flaky-plugin', version: '1.0.0' } },
  },
}

/**
 * Per-version manifests used by the official-address lookup.
 * dsh-context declares a homepage, the skills manager only a repository,
 * dsh-base is a shipped bundle, and the market bundle has no link metadata so
 * the npm package page is the fallback.
 */
const manifests = {
  'dsh-context': {
    name: 'dsh-context',
    version: '0.74.0',
    homepage: 'https://github.com/bowenliang123/dsh-context',
    repository: { type: 'git', url: 'git+https://github.com/bowenliang123/dsh-context.git' },
  },
  '@michengai/dsh-skills-manager': {
    name: '@michengai/dsh-skills-manager',
    version: '1.2.11',
    repository: { type: 'git', url: 'git+ssh://git@github.com/MichengAI/dsh-skills-manager.git' },
  },
  '@deepseek-ai/dsh-base': {
    name: '@deepseek-ai/dsh-base',
    version: '0.2.1-rc.2',
    homepage: 'https://github.com/deepseek-ai/deepseek-harness#readme',
    repository: {
      type: 'git',
      url: 'git+https://github.com/deepseek-ai/deepseek-harness.git',
      directory: 'packages/bundle/base',
    },
  },
  'local-published': {
    name: 'local-published',
    version: '1.0.0',
    homepage: 'https://github.com/example/local-published#readme',
  },
  '@deepseek-ai/dsh-experimental-plugin-market-bundle': {
    name: '@deepseek-ai/dsh-experimental-plugin-market-bundle',
    version: '0.2.1-rc.2',
  },
  'weird-repo': { name: 'weird-repo', version: '1.0.0', repository: 'file:../x' },
  'gitlab-mono': {
    name: 'gitlab-mono',
    version: '1.0.0',
    repository: { type: 'git', url: 'git+https://gitlab.com/a/b.git', directory: 'pkg/x' },
  },
  'flaky-plugin': {
    name: 'flaky-plugin',
    version: '1.0.0',
    homepage: 'https://github.com/example/flaky-plugin',
  },
}
globalThis.fetch = fakeFetch

// ---------------------------------------------------------------- fake remotes
function makeBundles() {
  return [
    {
      name: 'dsh-context',
      official: false,
      availability: 'profile',
      version: '0.73.3',
      installed: true,
      enabled: true,
      removable: true,
      source: 'dsh-context@^0.73.3',
      meta: { title: { en: 'Context', zh: '上下文' } },
      description: 'context panel',
      rows: [],
      overrides: [],
    },
    {
      name: '@michengai/dsh-skills-manager',
      official: false,
      availability: 'profile',
      version: '1.2.9',
      installed: true,
      enabled: true,
      removable: true,
      source: '@michengai/dsh-skills-manager@^1.2.9',
      rows: [],
      overrides: [],
    },
    {
      name: 'dsh-plugin-updater',
      official: false,
      availability: 'profile',
      version: '2.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'link:/Users/joeywong/dsh-plugins/dsh-plugin-updater',
      rows: [],
      overrides: [],
    },
    {
      name: 'git-plugin',
      official: false,
      availability: 'profile',
      version: '1.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'git+https://github.com/example/git-plugin',
      rows: [],
      overrides: [],
    },
    {
      name: 'market-plugin',
      official: false,
      availability: 'profile',
      version: '1.1.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'market-plugin@^1.1.0',
      rows: [],
      overrides: [],
    },
    {
      name: 'weird-repo',
      official: false,
      availability: 'profile',
      version: '1.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'weird-repo@^1.0.0',
      rows: [],
      overrides: [],
    },
    {
      name: 'gitlab-mono',
      official: false,
      availability: 'profile',
      version: '1.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'gitlab-mono@^1.0.0',
      rows: [],
      overrides: [],
    },
    {
      name: 'flaky-plugin',
      official: false,
      availability: 'profile',
      version: '1.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'flaky-plugin@^1.0.0',
      rows: [],
      overrides: [],
    },
    {
      name: 'local-published',
      official: false,
      availability: 'profile',
      version: '1.0.0',
      installed: true,
      enabled: true,
      removable: true,
      source: 'link:/tmp/local-published',
      rows: [],
      overrides: [],
    },
    {
      name: '@deepseek-ai/dsh-base',
      official: false,
      availability: 'installation',
      version: '0.2.1-rc.2',
      installed: false,
      enabled: true,
      removable: false,
      readOnlyReason: 'management-required',
      rows: [],
      overrides: [],
    },
    {
      name: '@deepseek-ai/dsh-web-app',
      official: false,
      availability: 'installation',
      version: '0.2.1-rc.2',
      installed: false,
      enabled: true,
      removable: false,
      readOnlyReason: 'management-required',
      rows: [],
      overrides: [],
    },
    {
      name: '@deepseek-ai/dsh-experimental-terminal-bundle',
      official: true,
      optional: true,
      availability: 'installation',
      version: '0.2.1-rc.2',
      installed: false,
      enabled: true,
      removable: false,
      meta: { title: { en: 'Persistent terminals', zh: '持久终端' } },
      rows: [],
      overrides: [],
    },
    {
      name: '@deepseek-ai/dsh-experimental-plugin-market-bundle',
      official: true,
      optional: true,
      availability: 'installation',
      version: '0.2.1-rc.2',
      installed: false,
      enabled: false,
      removable: false,
      rows: [],
      overrides: [],
    },
    {
      name: '@deepseek-ai/dsh-subagent-codex',
      official: true,
      availability: 'missing',
      installed: false,
      enabled: false,
      removable: false,
      rows: [],
      overrides: [],
    },
  ]
}

let bundles = makeBundles()
const managerCalls = []
const installRefusals = new Set()

const manager = {
  async listBundles() {
    return { ok: true, value: bundles.map((bundle) => ({ ...bundle })) }
  },
  async registries() {
    return {
      ok: true,
      value: { registry: null, fallbackRegistries: [], resolved: 'https://registry.npmjs.org/' },
    }
  },
  async setBundleEnabled(name, enabled) {
    managerCalls.push(['setBundleEnabled', name, enabled])
    const target = bundles.find((bundle) => bundle.name === name)
    if (target) target.enabled = enabled
    return { ok: true, value: { application: 'applied', stage: 'enable', target: name, changed: true, enabled } }
  },
  async removeBundle(name) {
    managerCalls.push(['remove', name])
    bundles = bundles.filter((bundle) => bundle.name !== name)
    return { ok: true, value: { application: 'applied', stage: 'remove', target: name, changed: true } }
  },
  async installBundle(spec, options) {
    managerCalls.push(['install', spec, options])
    if (installRefusals.has(spec)) {
      return { ok: false, error: { code: 'incompatible-version', message: 'mock refusal: needs a newer DSH' } }
    }
    const at = spec.lastIndexOf('@')
    const name = spec.slice(0, at)
    const version = spec.slice(at + 1)
    const existing = bundles.find((bundle) => bundle.name === name)
    if (existing) existing.version = version
    else
      bundles.push({
        name,
        official: false,
        availability: 'profile',
        version,
        installed: true,
        enabled: options && options.enabled !== false,
        removable: true,
        source: name + '@' + version,
        rows: [],
        overrides: [],
      })
    return {
      ok: true,
      value: { application: 'applied', stage: 'install', target: spec, changed: true, bundle: name, version },
    }
  },
}

const marketCalls = []
const marketIndex = { url: 'https://market.example/index.json', title: 'Test market' }
function marketResult(url, entries) {
  return {
    ok: true,
    value: { url, title: 'Test market', entries, total: entries.length, nextOffset: null, fetchedAt: Date.now() },
  }
}
const market = {
  async listIndexes() {
    return { ok: true, value: [marketIndex] }
  },
  async search(url, query) {
    marketCalls.push([url, query])
    if (query && query.text === 'market-plugin') {
      return marketResult(url, [
        {
          name: 'market-plugin',
          title: { en: 'Market plugin' },
          homepage: 'https://example.com/market-plugin',
          versions: [{ version: '1.1.0' }],
          defaultVersion: '1.1.0',
        },
      ])
    }
    return marketResult(url, [])
  },
}

const commandCalls = []
const commands = {
  async execute(agentId, line, attachments) {
    commandCalls.push([agentId, line, attachments])
    return { ok: true, value: { commandId: 'command-1', result: { kind: 'success', text: 'ok' } } }
  },
}

// ------------------------------------------------------------------- context
const registrations = []
let injectedManager = null
let injectedMarket = null
let injectedCommands = null

const locale = {
  getLocale: () => ({ locale: 'zh' }),
  bind: () => (key) => key,
  register: () => () => {},
  subscribe: () => () => {},
}

const ctx = {
  locale,
  slots: {
    inject(_name, callback) {
      callback()
      return () => {}
    },
    register(options, component) {
      registrations.push({ options, component })
      return () => {}
    },
  },
  inject(deps, callback) {
    if (deps.includes('remote.pluginManager')) injectedManager = callback
    if (deps.includes('remote.pluginMarket')) injectedMarket = callback
    if (deps.includes('remote.commands')) injectedCommands = callback
  },
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
}

// ------------------------------------------------------------------ rendering
function renderTab() {
  const registration = registrations.find((item) => item.options.name === 'plugins.tab')
  if (!registration) throw new Error('plugins.tab was not registered')
  const element = registration.component({})
  return renderNode(element, 'tab')
}

function flushRender() {
  let tree = null
  let guard = 0
  do {
    dirty = false
    tree = renderTab()
    flushEffects()
    guard += 1
  } while (dirty && guard < 25)
  return tree
}

async function settle(ms = 25) {
  await wait(ms)
  return flushRender()
}

async function until(predicate, timeoutMs = 3000) {
  const start = Date.now()
  let tree = flushRender()
  while (!predicate(tree)) {
    if (Date.now() - start > timeoutMs) return tree
    await wait(20)
    tree = flushRender()
  }
  return tree
}

// ---------------------------------------------------------------------- boot
const bundleSource = readFileSync(resolve(root, 'dist', 'client.js'), 'utf8')
const moduleUrl = 'data:text/javascript;charset=utf-8,' + encodeURIComponent(bundleSource)
await import(moduleUrl)

const plugin = capturedDefinition.factory((specifier) => {
  if (specifier === 'react') return React
  throw new Error('unexpected require: ' + specifier)
})

if (!plugin || typeof plugin.apply !== 'function') throw new Error('bundle did not return a plugin')
plugin.apply(ctx)

check('registers the plugins tab and the session menu item', registrations.length === 2, 'got ' + registrations.length)
const tabRegistration = registrations.find((item) => item.options.name === 'plugins.tab')
const menuRegistration = registrations.find((item) => item.options.name === 'sidebar.workspaces.session.menu.item')
check('plugins tab id', Boolean(tabRegistration) && tabRegistration.options.id === 'updater')
check(
  'session menu registration',
  Boolean(menuRegistration) && menuRegistration.options.id === 'updater-refresh-title' && menuRegistration.options.order === 425,
)

injectedManager({ remote: { pluginManager: manager } })
injectedMarket({ remote: { pluginMarket: market } })
injectedCommands({ remote: { commands } })

let tree = await until(
  (current) => normalizedText(current).includes('0.74.0') && findLinks(current).length === 9,
)

const bootText = normalizedText(tree)
check('auto-check resolves latest versions', bootText.includes('0.74.0') && bootText.includes('1.2.11'))
check('shows current versions', bootText.includes('0.73.3') && bootText.includes('1.2.9'))
check('skips missing bundles', !bootText.includes('dsh-subagent-codex'))
check(
  'groups external first, then built-in and experimental',
  bootText.indexOf('groupExternal') >= 0 &&
    bootText.indexOf('groupExternal') < bootText.indexOf('groupBuiltin') &&
    bootText.indexOf('groupBuiltin') < bootText.indexOf('groupExperimental'),
)
check('shipped rows show the shipped status', bootText.includes('statusShipped'))

// ---- official address links
const officialLinks = findLinks(tree)
check(
  'renders one official link for every resolvable plugin',
  officialLinks.length === 9,
  'got ' + officialLinks.length + ' ' + JSON.stringify(officialLinks.map((link) => link.props.href)),
)
check(
  'npm plugin links to the homepage from its manifest',
  linksInRow(tree, 'dsh-context')[0]?.props.href === 'https://github.com/bowenliang123/dsh-context',
  JSON.stringify(linksInRow(tree, 'dsh-context').map((link) => link.props.href)),
)
check(
  'repository-only package links to a browsable Git URL',
  linksInRow(tree, '@michengai/dsh-skills-manager')[0]?.props.href === 'https://github.com/MichengAI/dsh-skills-manager',
  JSON.stringify(linksInRow(tree, '@michengai/dsh-skills-manager').map((link) => link.props.href)),
)
check(
  'shipped bundle deep-links to its monorepo package directory',
  linksInRow(tree, '@deepseek-ai/dsh-base')[0]?.props.href ===
    'https://github.com/deepseek-ai/deepseek-harness/tree/HEAD/packages/bundle/base',
  JSON.stringify(linksInRow(tree, '@deepseek-ai/dsh-base').map((link) => link.props.href)),
)
check(
  'manifest without links falls back to the npm package page',
  linksInRow(tree, '@deepseek-ai/dsh-experimental-plugin-market-bundle')[0]?.props.href ===
    'https://www.npmjs.com/package/@deepseek-ai/dsh-experimental-plugin-market-bundle',
  JSON.stringify(
    linksInRow(tree, '@deepseek-ai/dsh-experimental-plugin-market-bundle').map((link) => link.props.href),
  ),
)
check(
  'Git-sourced plugin links to its repository without a registry lookup',
  linksInRow(tree, 'git-plugin')[0]?.props.href === 'https://github.com/example/git-plugin',
  JSON.stringify(linksInRow(tree, 'git-plugin').map((link) => link.props.href)),
)
check(
  'locally developed but published plugin still gets its npm homepage',
  linksInRow(tree, 'local-published')[0]?.props.href === 'https://github.com/example/local-published#readme',
  JSON.stringify(linksInRow(tree, 'local-published').map((link) => link.props.href)),
)
check(
  'market index homepage is used when the registry has no manifest',
  linksInRow(tree, 'market-plugin')[0]?.props.href === 'https://example.com/market-plugin',
  JSON.stringify(linksInRow(tree, 'market-plugin').map((link) => link.props.href)),
)
check(
  'locally linked updater shows no broken npm link',
  linksInRow(tree, 'dsh-plugin-updater').length === 0,
  JSON.stringify(linksInRow(tree, 'dsh-plugin-updater').map((link) => link.props.href)),
)
check(
  'unusable repository metadata falls back to the npm package page',
  linksInRow(tree, 'weird-repo')[0]?.props.href === 'https://www.npmjs.com/package/weird-repo',
  JSON.stringify(linksInRow(tree, 'weird-repo').map((link) => link.props.href)),
)
check(
  'non-GitHub repository with a directory links to the repository root',
  linksInRow(tree, 'gitlab-mono')[0]?.props.href === 'https://gitlab.com/a/b',
  JSON.stringify(linksInRow(tree, 'gitlab-mono').map((link) => link.props.href)),
)
check(
  'Git-sourced rows trigger no registry request at all',
  fetchCalls.every((url) => !url.includes('git-plugin')),
  JSON.stringify(fetchCalls.filter((url) => url.includes('git-plugin'))),
)

// ---- a transient registry failure must not be cached as "no page"
await settle(80)
check(
  'transient manifest failure leaves the row without a link (not cached)',
  linksInRow(tree, 'flaky-plugin').length === 0,
  JSON.stringify(linksInRow(tree, 'flaky-plugin').map((link) => link.props.href)),
)
flakyMode = false
const checkNowButton = findButtonByText(tree, 'checkNow')
check('check-now button is available for the retry', Boolean(checkNowButton))
checkNowButton.props.onClick()
tree = await until((current) => linksInRow(current, 'flaky-plugin').length === 1)
check(
  'a later check retries a transient manifest failure and shows the link',
  linksInRow(tree, 'flaky-plugin')[0]?.props.href === 'https://github.com/example/flaky-plugin',
  JSON.stringify(linksInRow(tree, 'flaky-plugin').map((link) => link.props.href)),
)
tree = await settle(150)
check(
  'official links open in a new tab with rel=noopener',
  officialLinks.every(
    (link) => link.props.target === '_blank' && String(link.props.rel).includes('noopener'),
  ),
)
check(
  'official link uses the localized label',
  normalizedText(linksInRow(tree, 'dsh-context')[0]).includes('officialLink'),
)

// ---- one version-menu upgrade
const upgradeButtons = findButtons(tree, (node) => normalizedText(node) === 'upgrade ▾')
check('renders upgrade buttons for updatable plugins', upgradeButtons.length === 2, 'got ' + upgradeButtons.length)
const firstRowUpgrade = buttonsInRow(tree, 'dsh-context', 'upgrade ▾')[0]
firstRowUpgrade.props.onClick()
tree = await settle()
const versionButton = findButtons(tree, (node) => normalizedText(node).startsWith('0.74.0'))[0]
check('version menu lists the target version', Boolean(versionButton))
managerCalls.length = 0
versionButton.props.onClick()
tree = await until((current) => {
  const row = findRow(current, 'dsh-context')
  return Boolean(row) && normalizedText(row).includes('statusLatest') && !normalizedText(current).includes('statusBusy')
})
const removeCall = managerCalls.find((call) => call[0] === 'remove')
const installCall = managerCalls.find((call) => call[0] === 'install')
check('upgrade removes then installs the chosen version', Boolean(removeCall) && Boolean(installCall))
check(
  'upgrade installs the exact version with enabled+saveExact',
  Boolean(installCall) &&
    installCall[1] === 'dsh-context@0.74.0' &&
    installCall[2].enabled === true &&
    installCall[2].saveExact === true,
  JSON.stringify(installCall),
)

// ---- enable switch
const rowName = '@michengai/dsh-skills-manager'
const switches = findSwitches(findRow(tree, rowName))
check('row renders one enable switch', switches.length === 1)
check('switch reflects the enabled state', switches[0].props['aria-checked'] === true)
managerCalls.length = 0
switches[0].props.onClick()
tree = await until((current) => findSwitches(findRow(current, rowName))[0]?.props['aria-checked'] === false)
const toggleCall = managerCalls.find((call) => call[0] === 'setBundleEnabled')
check(
  'turning the switch off calls setBundleEnabled(name,false)',
  Boolean(toggleCall) && toggleCall[1] === rowName && toggleCall[2] === false,
  JSON.stringify(toggleCall),
)

// ---- uninstall with confirmation
const removeButtons = findButtons(tree, (node) => normalizedText(node) === 'uninstall')
check('renders uninstall for removable plugins', removeButtons.length === 8, 'got ' + removeButtons.length)
buttonsInRow(tree, 'git-plugin', 'uninstall')[0].props.onClick()
tree = await settle()
check('uninstall asks for confirmation', normalizedText(tree).includes('confirmRemove'))
managerCalls.length = 0
buttonsInRow(tree, 'git-plugin', 'confirmRemoveAction')[0].props.onClick()
tree = await until((current) => !normalizedText(current).includes('git-plugin'))
const uninstallCall = managerCalls.find((call) => call[0] === 'remove')
check('confirmed uninstall removes the bundle', Boolean(uninstallCall) && uninstallCall[1] === 'git-plugin')

// ---- upgrade all (only the external section owns the button)
const upgradeAllButtons = findButtons(tree, (node) => normalizedText(node) === 'upgradeAll')
check('upgrade-all button lives in the external section', upgradeAllButtons.length === 1)
managerCalls.length = 0
upgradeAllButtons[0].props.onClick()
tree = await until((current) => !normalizedText(current).includes('upgrade ▾') && normalizedText(current).includes('doneMessage'))
const allInstalls = managerCalls.filter((call) => call[0] === 'install').map((call) => call[1])
check(
  'upgrade all installs every pending plugin',
  allInstalls.length === 1 && allInstalls[0] === '@michengai/dsh-skills-manager@1.2.11',
  JSON.stringify(allInstalls),
)

// ---- session menu item
const injected = typeof menuRegistration.options.inject === 'function' ? menuRegistration.options.inject() : {}
check('session menu exposes refreshTitle', typeof injected.refreshTitle === 'function')
const menuElement = menuRegistration.component({
  sessionId: 'session-1',
  displayTitle: 'Some session',
  useMenuOpenState: () => [true, () => {}],
  t: (key) => key,
  ...injected,
})
const menuTree = renderNode(menuElement, 'menu')
const refreshButton = findButtonByText(menuTree, 'refreshTitle')
check('session menu renders the refresh item', Boolean(refreshButton) && refreshButton.props.role === 'menuitem')
commandCalls.length = 0
refreshButton.props.onClick()
await wait(20)
check(
  'refresh title executes /refresh-title for the row session',
  commandCalls.length === 1 && commandCalls[0][0] === 'session-1' && commandCalls[0][1] === '/refresh-title',
  JSON.stringify(commandCalls),
)

// ---- host half
const hostModule = await import(pathToFileURL(resolve(root, 'lib', 'index.js')).href)
const hostCommands = []
const refreshedSessions = []
const hostCtx = {
  get(name) {
    if (name === 'sessionTitle') {
      return {
        async refresh(session) {
          refreshedSessions.push(session)
          return { title: '新的标题' }
        },
      }
    }
    return undefined
  },
  sessions: { get: (id) => (id === 'missing' ? undefined : { id, marker: true }) },
  commands: {
    register(definition) {
      hostCommands.push(definition)
      return () => {}
    },
  },
  effect(fn) {
    const dispose = fn()
    return typeof dispose === 'function' ? dispose : () => {}
  },
}
hostModule.apply(hostCtx)
check('host half registers /refresh-title', hostCommands.length === 1 && hostCommands[0].name === 'refresh-title')
const outcome = await hostCommands[0].handler({ agent: { id: 'session-1' }, signal: new AbortController().signal })
check(
  'host command refreshes the live session title',
  outcome.kind === 'success' &&
    String(outcome.text).includes('新的标题') &&
    refreshedSessions.length === 1 &&
    refreshedSessions[0].id === 'session-1',
  JSON.stringify(outcome),
)
const missing = await hostCommands[0].handler({ agent: { id: 'missing' }, signal: new AbortController().signal })
check('host command reports a missing session as an error', missing.kind === 'error')

// -------------------------------------------------------------------- summary
if (failures.length) {
  console.error('\nHARNESS FAILED: ' + failures.length + ' of ' + checkCount + ' checks failed')
  for (const failure of failures) console.error(' - ' + failure)
  process.exit(1)
}
console.log('\nALL ' + checkCount + ' HARNESS CHECKS PASSED')
