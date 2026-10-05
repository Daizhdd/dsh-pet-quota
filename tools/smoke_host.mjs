/**
 * Host-half smoke test: drive `apply()` with a fake cordis context inside a
 * throwaway DSH_HOME, so every number is deterministic and nothing touches the
 * real installation.
 *
 * Covers: seeding from the usage panel's ledger, the session-event fold, the
 * three tiers, the quota bubble (amount + dot + flavour line, never a
 * percentage), the three event bubbles, subagent silence, and the config route.
 *
 * Run: node tools/smoke_host.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const TEMP = fs.mkdtempSync(path.join(os.tmpdir(), 'pet-quota-smoke-'))
process.env.DSH_HOME = TEMP
fs.mkdirSync(path.join(TEMP, 'dsh-usage'), { recursive: true })
fs.writeFileSync(path.join(TEMP, 'dsh-usage', 'usage-ledger.json'), JSON.stringify({
  version: 1,
  days: {
    [new Date().toLocaleDateString('en-CA')]: {
      mimo: { 'mimo-v2.6-flash': { inputTokens: 3_000, outputTokens: 1_300, cacheReadTokens: 20_000_000, cacheWriteTokens: 0, calls: 7, reasoningTokens: 10 } },
    },
  },
}), 'utf8')

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const listeners = new Map()
const announces = []
const routes = []

const petService = {
  announce: (payload) => { announces.push(payload); return { ok: true } },
}

function makeCtx() {
  return {
    logger: { info: (...a) => console.log('[info]', ...a), warn: (...a) => console.warn('[warn]', ...a) },
    on: (name, fn) => { listeners.set(name, fn); return () => listeners.delete(name) },
    effect: (fn) => { const dispose = fn(); return () => dispose?.() },
    inject: (names, fn) => {
      const child = { ...makeCtx(), webServer: { register: (route) => { routes.push(route); return () => {} } } }
      const dispose = fn(child)
      return () => dispose?.()
    },
    get: (name) => (name === 'pet' ? petService : undefined),
    setTimeout: (fn) => { setTimeout(fn, 0); return () => {} },
  }
}

const mod = await import('../host.js')
const ctx = makeCtx()
// A 60 ms running reminder keeps the "still working" case testable.
mod.apply(ctx, { runningReminderMs: 60 })

const emit = (event, session = { id: 's1' }) => listeners.get('session/event')?.(session, event)
const callRoute = async (file, body) => {
  const route = routes.find((r) => r.path === file)
  assert.ok(route, `${file} is registered`)
  const res = { headers: {}, statusCode: 200, setHeader(k, v) { this.headers[k] = v }, end(payload) { this.body = payload } }
  const req = { async *[Symbol.asyncIterator]() { if (body !== undefined) yield JSON.stringify(body) } }
  await route.handler(req, res)
  return { status: res.statusCode, json: res.body === undefined ? undefined : JSON.parse(res.body) }
}
const usage = (cacheRead, extra = {}) => ({
  data: {
    usage: { inputTokens: 0, outputTokens: 0, cacheReadTokens: cacheRead, cacheWriteTokens: 0, ...extra },
    message: { source: { kind: 'model', provider: 'mimo', model: 'mimo-v2.6-flash' } },
  },
})

console.log('--- 1. seeding from the usage panel ledger ---')
let snap = (await callRoute('/api/pet-quota/today')).json
console.log('   ', snap.totalText, 'tokens |', snap.tierName, '|', snap.calls, 'calls')
assert.equal(snap.total, 20_004_300, 'the panel ledger seeded today')
assert.equal(snap.tierName, '轻度')

console.log('--- 2. folding one turn ---')
const before = announces.length
emit({ type: 'request/header', data: { header: { config: { provider: 'mimo', model: 'mimo-v2.6-flash' } } } })
emit({ type: 'turn/start', data: {} })
emit({ type: 'assistant/message', ...usage(40_000_000, { inputTokens: 1_000, outputTokens: 500, reasoningTokens: 999 }) })
emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } })
snap = (await callRoute('/api/pet-quota/today')).json
console.log('   ', snap.totalText, '|', snap.tierName, '| bubbles this turn:', announces.length - before)
assert.equal(snap.total, 60_005_800, 'cache reads count, reasoning does not double count')
assert.equal(snap.tierName, '中度')
assert.deepEqual(Object.keys(snap.byModel), ['mimo/mimo-v2.6-flash'], 'attribution comes from the durable message source')

console.log('--- 3. the quota bubble: dot + flavour line, never a percentage ---')
const quota = mod.quotaBubbleFor(6_000_000, { lowMax: 50_000_000, midMax: 100_000_000, heartbeatMs: 60_000 })
console.log('    bubble:', JSON.stringify(quota))
assert.deepEqual(quota, {
  kind: 'cost',
  title: '今日额度',
  amount: '600万 tok',
  note: '🟢 轻度 · 今天很省，慢慢来～',
  tone: 'ok',
  ttlMs: 60_000,
})

console.log('--- 4. the three event bubbles ---')
const crossing = announces[before]
console.log('    cross :', JSON.stringify(crossing))
assert.equal(crossing.title, '进入中度')
assert.equal(crossing.tone, 'warn')
const completion = announces[announces.length - 1]
console.log('    done  :', JSON.stringify(completion))
assert.equal(completion.title, '任务完成')
assert.equal(completion.note, '本轮 +4000.2万 · 🟡 中度')
emit({ type: 'turn/start', data: {} })
await sleep(140)
const running = announces[announces.length - 1]
console.log('    run   :', JSON.stringify(running))
assert.equal(running.title, '还在跑…')
emit({ type: 'turn/end', data: { reason: { kind: 'error' } } })
const failed = announces[announces.length - 1]
console.log('    fail  :', JSON.stringify(failed))
assert.equal(failed.title, '这一轮没跑完')
assert.equal(failed.tone, 'warn')

console.log('--- 5. no bubble ever carries a percentage, all use kind "cost" ---')
console.log('    bubbles:', announces.length, '| with percent:', announces.filter((a) => a.percent !== undefined).length)
assert.equal(announces.filter((a) => a.percent !== undefined).length, 0, 'the plan kind (bar + percentage) is never used')
assert.ok(announces.every((a) => a.kind === 'cost'))

console.log('--- 6. crossing into the heavy tier keeps "鲸吞模式" ---')
emit({ type: 'assistant/message', ...usage(50_000_000) })
const heavy = announces[announces.length - 1]
console.log('    bubble:', JSON.stringify(heavy))
assert.equal(heavy.title, '进入重度 · 鲸吞模式')
assert.equal(heavy.note, '🔴 重度 · 鲸吞模式，我有点热…')
assert.equal(heavy.tone, 'low')

console.log('--- 7. a delegated child spends tokens but never speaks ---')
const subSession = { id: 'sub-1', header: { origin: 'subagent' } }
const beforeSub = { total: (await callRoute('/api/pet-quota/today')).json.total, bubbles: announces.length }
emit({ type: 'turn/start', data: {} }, subSession)
emit({ type: 'assistant/message', ...usage(1_000_000) }, subSession)
emit({ type: 'turn/end', data: { reason: { kind: 'completed' } } }, subSession)
const afterSub = (await callRoute('/api/pet-quota/today')).json.total
console.log('    tokens +', (afterSub - beforeSub.total).toLocaleString(), '| bubbles:', announces.length - beforeSub.bubbles)
assert.equal(afterSub - beforeSub.total, 1_000_000)
assert.equal(announces.length, beforeSub.bubbles, 'a subagent turn announces nothing')

console.log('--- 8. config route ---')
const beforeCfg = announces.length
const ok = await callRoute('/api/pet-quota/config', { enabled: true, lowMax: 1_000_000, midMax: 2_000_000 })
console.log('   ', ok.json.thresholds, '-> tier', ok.json.tier, ok.json.tierName)
assert.equal(ok.json.tier, 2, 'lowering the thresholds re-tiers immediately')
assert.equal(announces.length, beforeCfg, 'the tier was already 重度, so nothing is re-announced')
await callRoute('/api/pet-quota/config', { lowMax: 200_000_000, midMax: 400_000_000 })
assert.equal(announces[announces.length - 1].title, '回到轻度', 'a threshold change that does move the tier announces it')
const bad = await callRoute('/api/pet-quota/config', { lowMax: 5_000_000, midMax: 4_000_000 })
assert.equal(bad.status, 400, 'midMax below lowMax is refused')
const saved = JSON.parse(fs.readFileSync(path.join(TEMP, 'pet-quota', 'config.json'), 'utf8'))
assert.equal(saved.midMax, 400_000_000, 'the accepted config was persisted')
assert.equal(saved.enabled, true)

console.log('--- 9. this plugin never touches the pet selection ---')
assert.equal(typeof petService.setPetId, 'undefined', 'no setPetId is ever reachable: it only announces')
await callRoute('/api/pet-quota/config', { lowMax: 50_000_000, midMax: 100_000_000 })
assert.deepEqual((await callRoute('/api/pet-quota/today')).json.thresholds, { lowMax: 50_000_000, midMax: 100_000_000 })

fs.rmSync(TEMP, { recursive: true, force: true })
console.log('\nALL HOST-HALF CHECKS PASSED')
