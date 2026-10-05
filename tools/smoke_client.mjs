/**
 * Browser-half smoke test: load the hand-written ModuleLoader bundle under
 * stubs, apply it to a fake client context, and render every registered slot
 * entry once. Catches the class of error that would otherwise only appear in a
 * browser console (bad h() trees, undefined references, wrong slot payloads).
 *
 * Run: node tools/smoke_client.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const BUNDLE = path.join(HERE, '..', 'client.js')

// ── stubs ────────────────────────────────────────────────────────────────────
const registrations = []
const styles = []
const slots = {
  inject: (key, callback) => {
    assert.equal(typeof callback, 'function', 'inject takes a callback')
    const dispose = callback()
    return () => dispose?.()
  },
  register: (definition, render) => {
    registrations.push({ definition, render })
    return () => {}
  },
}

globalThis.document = {
  head: { appendChild: (el) => styles.push(el) },
  createElement: () => ({ setAttribute() {}, remove() {}, textContent: '' }),
}

globalThis.fetch = async () => ({ ok: true, status: 200, json: async () => ({}) })

let loaded = null
globalThis.window = {
  __ModuleLoader__: { load: (spec) => { loaded = spec } },
  setInterval: () => 0,
  clearInterval: () => {},
}

// Minimal React stub: hooks keep the initial value, createElement records shape.
const React = {
  createElement: (type, props, ...children) => ({ $$element: true, type, props: props ?? {}, children }),
  useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  useEffect: () => {},
  useCallback: (fn) => fn,
}

const source = fs.readFileSync(BUNDLE, 'utf8')
new Function('window', 'document', 'fetch', source)(globalThis.window, globalThis.document, globalThis.fetch)

assert.ok(loaded !== null, 'the bundle registered itself on window.__ModuleLoader__')
assert.equal(loaded.id, 'dsh-pet-quota', 'bundle id matches the package')
assert.equal(typeof loaded.factory, 'function')

const exportsObject = loaded.factory((spec) => {
  if (spec === 'react') return React
  throw new Error(`unexpected require(${spec})`)
})

console.log('exports      :', Object.keys(exportsObject).join(', '))
assert.equal(exportsObject.name, 'dsh-pet-quota')
assert.deepEqual(exportsObject.inject, ['slots'])
assert.equal(typeof exportsObject.apply, 'function')

const ctx = {
  slots,
  effect: (fn) => { const dispose = fn(); return () => dispose?.() },
}
exportsObject.apply(ctx)

console.log('styles       :', styles.length, 'injected')
assert.ok(styles.length >= 1, 'the bundle injects its stylesheet')
const css = styles[0].textContent
assert.match(css, /\.pq_dotbig\{/, 'the tier dot is styled')
for (const tier of ['0', '1', '2']) assert.ok(css.includes(`.pq_dotbig[data-tier="${tier}"]`), `tier ${tier} has its own dot colour`)
assert.ok(!/\.pq_bar/.test(css), 'the progress bar is gone')
assert.ok(!/\.pq_pill/.test(css), 'the floating card is gone')
assert.ok(!/undefined/.test(css), 'no undefined leaked into the stylesheet')

console.log('registrations:', registrations.map((r) => `${r.definition.name}#${r.definition.id}`).join(', '))
const bySlot = new Map(registrations.map((r) => [r.definition.name, r]))
assert.equal(registrations.length, 1, 'exactly one surface is contributed')
assert.ok(!bySlot.has('shell.overlay'), 'nothing is registered in the floating overlay layer any more')
assert.ok(bySlot.has('settings.section'), 'registers a settings.section entry')
assert.equal(bySlot.get('settings.section').definition.id, 'dsh-pet-quota')
assert.equal(typeof bySlot.get('settings.section').definition.label, 'function')
assert.equal(bySlot.get('settings.section').definition.label(), '宠物额度')

// Render the entry once, as the shell would. The data hook starts empty, so a
// placeholder result is correct here — the point is that nothing throws.
const settingsTree = bySlot.get('settings.section').render({})
console.log('render       :', settingsTree.$$element === true ? `<${settingsTree.type.name}>` : typeof settingsTree)
assert.equal(settingsTree.$$element, true, 'the settings entry renders an element')
const settingsInner = settingsTree.type()
assert.ok(settingsInner !== null && settingsInner.$$element === true, 'SettingsCard renders its loading card without data')

// The routes the browser half depends on must exist in the host half; `boot` is
// host-only diagnostics, so it is asserted on the host side alone.
const host = fs.readFileSync(path.join(HERE, '..', 'host.js'), 'utf8')
for (const route of ['/api/pet-quota/today', '/api/pet-quota/config']) {
  assert.ok(host.includes(`'${route}'`), `host half serves ${route}`)
  assert.ok(source.includes(`'${route}'`), `browser half calls ${route}`)
}
assert.ok(host.includes("'/api/pet-quota/boot'"), 'host half serves the boot diagnostic')
assert.ok(!source.includes('/pet/'), 'the browser half no longer reaches for pet assets (it ships none)')

console.log('\nALL BROWSER-HALF CHECKS PASSED')



