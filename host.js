/**
 * dsh-pet-quota — Host half.
 *
 * Two jobs:
 *   1. count today's tokens, with the same convention as the sidebar's usage
 *      panel (`input + cacheRead + cacheWrite + output`, folded from the
 *      `assistant/message` session events, seeded from dsh-usage's ledger so a
 *      plugin installed mid-day still shows the whole day);
 *   2. turn that number into a tier (轻度 / 中度 / 重度) and push it to the pet as
 *      an announcement bubble through the pet service's documented cross-plugin
 *      API (`ctx.pet.announce`), plus the small JSON API the client half reads.
 *
 * Nothing here is a hard dependency: with no `pet` service the counting and the
 * HTTP API still work, and with no `webServer` the pet still gets bubbles.
 *
 * @module dsh-pet-quota
 */

import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'

export const name = 'pet-quota'

/** No hard dependency: every facility is read opportunistically. */
export const inject = []

const DEFAULT_CONFIG = {
  lowMax: 50_000_000, // 5000w
  midMax: 100_000_000, // 1亿
  enabled: true,
  announceOnTurnEnd: true,
  announceWhileRunning: true,
  runningReminderMs: 90_000,
  heartbeatMs: 60_000,
}

const FLUSH_DEBOUNCE_MS = 3_000

/** Local-time day key, matching the usage panel's definition of "today". */
export function localDayKey(ms) {
  const d = new Date(ms)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}

/** The panel's official total: cache reads and writes count, reasoning does not
 * (it is already inside outputTokens). */
export function totalOf(usage) {
  if (usage === undefined || usage === null) return 0
  const n = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  return n(usage.inputTokens) + n(usage.cacheReadTokens) + n(usage.cacheWriteTokens) + n(usage.outputTokens)
}

/** 12345678 -> "1234.6万"; 1.2e8 -> "1.2亿" (trailing zeros trimmed) */
export function formatTokens(n) {
  const trim = (value) => String(Number(value))
  if (n >= 100_000_000) return `${trim((n / 100_000_000).toFixed(2))}亿`
  if (n >= 10_000) return `${trim((n / 10_000).toFixed(1))}万`
  return String(Math.round(n))
}

export function tierOf(total, cfg) {
  if (total >= cfg.midMax) return 2
  if (total >= cfg.lowMax) return 1
  return 0
}

/**
 * The three tiers. Names are the user's: 轻度 / 中度 / 重度. `tone` is the pet's
 * bubble accent, `dot` is the colour that carries the tier inside the bubble,
 * `line` is the flavour text that rides along in the note.
 */
export function tierMeta(tier, cfg) {
  return [
    { name: '轻度', tone: 'ok', dot: '🟢', line: '今天很省，慢慢来～' },
    { name: '中度', tone: 'warn', dot: '🟡', line: '今天烧得有点猛了…' },
    { name: '重度', tone: 'low', dot: '🔴', line: '鲸吞模式，我有点热…' },
  ][tier] ?? { name: '轻度', tone: 'ok', dot: '🟢', line: '' }
}

/**
 * The standing quota bubble as a pure value: total in, payload out. Exported so
 * the shape can be asserted without waiting for a heartbeat.
 */
export function quotaBubbleFor(total, cfg) {
  const tier = tierOf(total, cfg)
  const meta = tierMeta(tier, cfg)
  return {
    kind: 'cost',
    title: '今日额度',
    amount: `${formatTokens(total)} tok`,
    note: `${meta.dot} ${meta.name} · ${meta.line}`,
    tone: meta.tone,
    ttlMs: cfg.heartbeatMs ?? 60_000,
  }
}

/** Resolve DSH_HOME the way the rest of the harness does. */
export function resolveDshHome(env = process.env, home = os.homedir()) {
  const raw = typeof env.DSH_HOME === 'string' && env.DSH_HOME.trim() !== '' ? env.DSH_HOME.trim() : path.join(home, '.dsh')
  if (raw === '~') return home
  if (raw.startsWith('~/') || raw.startsWith('~\\')) return path.join(home, raw.slice(2))
  return path.resolve(raw)
}

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp`
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(tmp, JSON.stringify(value, null, 1), 'utf8')
  fs.renameSync(tmp, file)
}

export function apply(ctx, config = {}) {
  const logger = ctx.logger ?? console
  const home = resolveDshHome()
  const dataDir = path.join(home, 'pet-quota')
  const storePath = path.join(dataDir, 'today.json')
  const configPath = path.join(dataDir, 'config.json')
  fs.mkdirSync(dataDir, { recursive: true })

  // Precedence: defaults < plugin row config < the plugin's own settings file
  // (the settings card writes that one, so a threshold change needs no reload).
  const saved = readJson(configPath)
  let cfg = { ...DEFAULT_CONFIG, ...config, ...(saved !== undefined && typeof saved === 'object' ? saved : {}) }
  const saveConfig = () => {
    try {
      writeJsonAtomic(configPath, {
        lowMax: cfg.lowMax,
        midMax: cfg.midMax,
        enabled: cfg.enabled,
        announceOnTurnEnd: cfg.announceOnTurnEnd,
        announceWhileRunning: cfg.announceWhileRunning,
      })
    } catch (error) {
      logger.warn?.(`pet-quota: cannot persist config: ${String(error?.message ?? error)}`)
    }
  }

  let state = { day: localDayKey(Date.now()), total: 0, calls: 0, byModel: {}, seededFromPanel: false }
  const stored = readJson(storePath)
  if (stored !== undefined && stored.day === state.day) {
    state = { ...state, ...stored, day: state.day }
    // One-time cleanup from before the attribution fix: every call used to land
    // under 'unknown'. Those tokens are still in the total, so dropping the
    // bucket only removes a breakdown entry that never meant anything.
    if (state.byModel !== undefined && state.byModel.unknown !== undefined) delete state.byModel.unknown
  }

  /** Seed / reconcile against the usage panel's own ledger, so the number a
   * user compares against the sidebar always agrees once we have seen events. */
  const seedFromPanel = () => {
    const ledger = readJson(path.join(home, 'dsh-usage', 'usage-ledger.json'))
    const day = ledger?.days?.[state.day]
    if (day === undefined) return
    let total = 0
    let calls = 0
    for (const models of Object.values(day)) {
      for (const row of Object.values(models)) {
        total += totalOf(row)
        calls += Number(row?.calls ?? 0)
      }
    }
    if (total > state.total) {
      state.total = total
      state.calls = Math.max(state.calls, calls)
      state.seededFromPanel = true
    }
  }
  seedFromPanel()

  let flushTimer
  const flush = () => {
    flushTimer = undefined
    try {
      writeJsonAtomic(storePath, state)
    } catch (error) {
      logger.warn?.(`pet-quota: cannot persist usage: ${String(error?.message ?? error)}`)
    }
  }
  const scheduleFlush = () => {
    if (flushTimer !== undefined) return
    flushTimer = setTimeout(flush, FLUSH_DEBOUNCE_MS)
    flushTimer.unref?.()
  }

  const rollDay = () => {
    const key = localDayKey(Date.now())
    if (key !== state.day) {
      flush()
      state = { day: key, total: 0, calls: 0, byModel: {}, seededFromPanel: false }
      seedFromPanel()
      lastTier = tierOf(state.total, cfg)
      scheduleFlush()
      return true
    }
    return false
  }

  let lastTier = tierOf(state.total, cfg)
  let lastSessionDelta = new Map()
  /** sessionId -> 'provider/model', learned from the session's request events. */
  const routes = new Map()
  let runningTimer
  let heartbeatTimer
  let lastAnnounceAt = 0

  const pet = () => {
    try {
      return ctx.get('pet')
    } catch {
      return undefined
    }
  }

  /**
   * Whether this session is a delegated child. Subagents run their own turns
   * (often dozens inside one workflow), so a completion bubble per child turn
   * would be noise. Their tokens still count.
   */
  const isDelegated = (session) => session?.header?.origin === 'subagent'

  /** Push one bubble. `ttlMs` doubles as the repeat cadence: the pet keeps only
   * the newest announcement and drops it when it expires. */
  const announce = (payload) => {
    const service = pet()
    if (service === undefined || typeof service.announce !== 'function') return false
    try {
      const result = service.announce({ source: 'pet-quota', ttlMs: cfg.heartbeatMs, ...payload })
      if (result?.ok === true) {
        lastAnnounceAt = Date.now()
        return true
      }
      return false
    } catch (error) {
      logger.warn?.(`pet-quota: announce rejected: ${String(error?.message ?? error)}`)
      return false
    }
  }

  /** The tier's visual language: one coloured dot, plus the flavour line that
   * goes with it. Every bubble here is `kind: 'cost'` — the `plan` kind is what
   * renders a progress bar and a percentage, and neither belongs on this pet. */
  const tierDot = (tier) => ['🟢', '🟡', '🔴'][tier] ?? '🟢'

  /** The standing bubble: today's total as the amount, the dot and its line as
   * the note. Re-pushed on the heartbeat so it never lapses. */
  const quotaBubble = (extra = {}) => ({ ...quotaBubbleFor(state.total, cfg), ...extra })

  /** A tier crossing gets its own moment: the same amount, but the headline is
   * the move itself. No percentage and no bar — the dot colour says where. */
  const tierChangeBubble = (tier) => {
    const meta = tierMeta(tier, cfg)
    return {
      kind: 'cost',
      title: tier === 2 ? '进入重度 · 鲸吞模式' : tier === 1 ? '进入中度' : '回到轻度',
      amount: `${formatTokens(state.total)} tok`,
      note: `${tierDot(tier)} ${meta.name} · ${meta.line}`,
      tone: meta.tone,
      ttlMs: 45_000,
    }
  }

  /** Announce a tier transition once, whatever moved the total (a live message
   * or a re-seed from the usage panel). The total is monotonic within a day, so
   * this fires at most twice a day and never oscillates. */
  const reflectTier = () => {
    const tier = tierOf(state.total, cfg)
    if (tier === lastTier) return false
    lastTier = tier
    announce(tierChangeBubble(tier))
    return true
  }

  /** Shape census of the events this fold actually receives: one entry per type
   * with the payload's key names, so a composition that names a field
   * differently can be diagnosed without a debugger. Message bodies are never
   * captured — only which keys exist. */
  const shapes = new Map()
  const recordShape = (event) => {
    const type = String(event?.type ?? '?')
    const entry = shapes.get(type) ?? { count: 0, dataKeys: [], extra: {} }
    entry.count += 1
    if (entry.dataKeys.length === 0) {
      const data = event?.data ?? {}
      entry.dataKeys = Object.keys(data)
      if (type === 'assistant/message') {
        entry.extra = {
          usageKeys: Object.keys(data.usage ?? {}),
          sourceKeys: Object.keys(data.source ?? {}),
          hasModel: typeof data.model === 'string',
        }
      } else {
        entry.extra = { preview: JSON.stringify(data).slice(0, 300) }
      }
    }
    shapes.set(type, entry)
  }

  const onSessionEvent = (session, event) => {
    try {
      recordShape(event)
      const sid = String(session?.id ?? session?.header?.id ?? 'session')

      // The route of a session is announced before its messages: remember it so
      // per-model attribution names the real model instead of 'unknown'
      // (assistant/message carries usage but, in this composition, no model).
      if (event?.type === 'request/header' || event?.type === 'request/context') {
        const config = event.data?.header?.config ?? event.data ?? {}
        const provider = String(config.provider ?? '')
        const model = String(config.model ?? '')
        if (model !== '') routes.set(sid, provider === '' ? model : `${provider}/${model}`)
        return
      }

      if (event?.type === 'assistant/message') {
        const usage = event.data?.usage
        if (usage === undefined) return
        rollDay()
        const gained = totalOf(usage)
        if (gained <= 0) return
        state.total += gained
        state.calls += 1
        // Attribution, in the order the compositions actually provide it: the
        // durable assistant message's own source (this profile), then a route
        // remembered from request events (profiles that emit them), then the
        // event's own source.
        const source = event.data?.message?.source ?? event.data?.source ?? {}
        const model = routes.get(sid)
          ?? (typeof source.model === 'string' && source.model !== ''
            ? (typeof source.provider === 'string' && source.provider !== '' ? `${source.provider}/${source.model}` : source.model)
            : 'unknown')
        state.byModel[model] = (state.byModel[model] ?? 0) + gained
        lastSessionDelta.set(sid, (lastSessionDelta.get(sid) ?? 0) + gained)
        scheduleFlush()
        reflectTier()
        return
      }

      if (event?.type === 'turn/start' || event?.type === 'step/start') {
        if (isDelegated(session)) return
        if (runningTimer === undefined) {
          runningTimer = setTimeout(() => {
            runningTimer = undefined
            if (!cfg.announceWhileRunning) return
            const meta = tierMeta(tierOf(state.total, cfg), cfg)
            announce({
              kind: 'cost',
              title: '还在跑…',
              amount: `${formatTokens(state.total)} tok`,
              note: `${tierDot(tierOf(state.total, cfg))} ${meta.name} · ${meta.line}`,
              tone: meta.tone,
              ttlMs: 30_000,
            })
          }, cfg.runningReminderMs)
          runningTimer.unref?.()
        }
        return
      }

      if (event?.type === 'turn/end') {
        if (isDelegated(session)) return
        if (runningTimer !== undefined) {
          clearTimeout(runningTimer)
          runningTimer = undefined
        }
        if (!cfg.announceOnTurnEnd) return
        const kind = event.data?.reason?.kind
        const delta = lastSessionDelta.get(sid) ?? 0
        lastSessionDelta.set(sid, 0)
        const tier = tierOf(state.total, cfg)
        const meta = tierMeta(tier, cfg)
        if (kind === 'completed') {
          announce({
            kind: 'cost',
            title: '任务完成',
            amount: `${formatTokens(state.total)} tok`,
            note: `本轮 +${formatTokens(delta)} · ${tierDot(tier)} ${meta.name}`,
            tone: meta.tone,
            ttlMs: 45_000,
          })
        } else if (kind === 'error' || kind === 'max-tokens' || kind === 'interrupted') {
          announce({
            kind: 'cost',
            title: kind === 'interrupted' ? '这一轮被打断了' : '这一轮没跑完',
            amount: `${formatTokens(state.total)} tok`,
            note: meta.line,
            tone: 'warn',
            ttlMs: 30_000,
          })
        }
      }
    } catch (error) {
      logger.warn?.(`pet-quota: session fold failed: ${String(error?.message ?? error)}`)
    }
  }

  ctx.effect(() => {
    const off = ctx.on('session/event', onSessionEvent)
    return () => {
      off?.()
      if (runningTimer !== undefined) clearTimeout(runningTimer)
      if (heartbeatTimer !== undefined) clearInterval(heartbeatTimer)
      if (flushTimer !== undefined) clearTimeout(flushTimer)
      flush()
    }
  }, 'pet-quota: session fold')

  // A slow heartbeat keeps the quota bubble alive without spamming: the pet drops
  // an announcement when its TTL lapses, so the cadence is the TTL.
  ctx.effect(() => {
    heartbeatTimer = setInterval(() => {
      if (!cfg.enabled) return
      if (rollDay()) {
        announce(quotaBubble())
        return
      }
      // Re-read the usage panel's ledger: events that arrived while this plugin
      // was disabled still land in the total, and a tier move it triggers is
      // reflected exactly as a live one.
      seedFromPanel()
      if (reflectTier()) return
      if (state.total <= 0) return
      if (Date.now() - lastAnnounceAt < cfg.heartbeatMs * 0.8) return
      announce(quotaBubble())
    }, Math.max(15_000, Math.floor(cfg.heartbeatMs / 2)))
    heartbeatTimer.unref?.()
    return () => clearInterval(heartbeatTimer)
  }, 'pet-quota: heartbeat')

  const snapshot = () => {
    const tier = tierOf(state.total, cfg)
    const meta = tierMeta(tier, cfg)
    const nextAt = tier === 0 ? cfg.lowMax : tier === 1 ? cfg.midMax : undefined
    return {
      day: state.day,
      total: state.total,
      calls: state.calls,
      tier,
      tierName: meta.name,
      tone: meta.tone,
      line: meta.line,
      thresholds: { lowMax: cfg.lowMax, midMax: cfg.midMax },
      nextAt,
      remaining: nextAt === undefined ? 0 : Math.max(0, nextAt - state.total),
      totalText: formatTokens(state.total),
      byModel: state.byModel,
      config: {
        enabled: cfg.enabled,
        lowMax: cfg.lowMax,
        midMax: cfg.midMax,
        announceOnTurnEnd: cfg.announceOnTurnEnd,
        announceWhileRunning: cfg.announceWhileRunning,
      },
      petAvailable: pet() !== undefined,
    }
  }

  ctx.inject(['webServer'], (webCtx) => {
    const routes = [
      {
        method: 'GET',
        path: '/api/pet-quota/today',
        handler: async (req, res) => {
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          res.end(JSON.stringify(snapshot()))
        },
      },
      {
        method: 'GET',
        path: '/api/pet-quota/boot',
        handler: async (req, res) => {
          res.setHeader('cache-control', 'no-store')
          res.setHeader('content-type', 'application/json; charset=utf-8')
          const out = { available: false, entries: [], allIds: [], clientPath: null }
          try {
            const modules = ctx.get('clientModules')
            if (modules !== undefined) {
              const graph = modules.graph?.()
              const entries = Array.isArray(graph?.entries) ? graph.entries : []
              out.available = true
              out.rev = graph?.rev
              out.allIds = entries.map((entry) => String(entry?.id ?? ''))
              out.allEntries = entries.map((entry) => ({ id: entry.id, url: entry.url, rev: entry.rev }))
              out.entries = entries
                .filter((entry) => String(entry?.id ?? '').includes('pet-quota'))
                .map((entry) => ({ id: entry.id, url: entry.url, rev: entry.rev, immediately: entry.immediately, inject: entry.inject }))
              out.clientPath = modules.clientPath?.('dsh-pet-quota') ?? null
            }
          } catch (error) {
            out.error = String(error?.message ?? error)
          }
          out.eventShapes = Object.fromEntries(shapes)
          out.routes = Object.fromEntries(routes)
          res.end(JSON.stringify(out))
        },
      },
      {
        method: 'POST',
        path: '/api/pet-quota/config',
        handler: async (req, res) => {
          let body = ''
          for await (const chunk of req) body += chunk
          res.setHeader('content-type', 'application/json; charset=utf-8')
          try {
            const patch = JSON.parse(body === '' ? '{}' : body)
            const next = { ...cfg }
            const num = (value, min, max) => {
              const n = Number(value)
              if (!Number.isFinite(n)) return undefined
              return Math.max(min, Math.min(max, Math.round(n)))
            }
            if (patch.lowMax !== undefined) next.lowMax = num(patch.lowMax, 1_000, 1e12) ?? next.lowMax
            if (patch.midMax !== undefined) next.midMax = num(patch.midMax, 2_000, 1e12) ?? next.midMax
            if (next.midMax <= next.lowMax) throw new Error('重度阈值必须大于中度阈值')
            for (const key of ['enabled', 'announceOnTurnEnd', 'announceWhileRunning']) {
              if (patch[key] !== undefined) next[key] = patch[key] === true
            }
            cfg = next
            saveConfig()
            // A threshold change re-tiers immediately: the dot in the bubble is
            // the feedback, so the change is visible without opening anything.
            reflectTier()
            res.end(JSON.stringify({ ok: true, ...snapshot() }))
          } catch (error) {
            res.statusCode = 400
            res.end(JSON.stringify({ ok: false, error: String(error?.message ?? error) }))
          }
        },
      },
    ]
    const disposers = routes.map((route) => webCtx.webServer.register(route))
    return () => { for (const dispose of disposers) dispose() }
  })

  ctx.inject(['settings'], (settingsCtx) => {
    // The settings card in the browser half owns the editable fields and writes
    // them through /api/pet-quota/config, so nothing is registered here beyond
    // a namespace reservation when the service is present.
    try {
      settingsCtx.settings?.register?.('petQuota', { enabled: cfg.enabled })
    } catch { /* settings surface is optional */ }
  })

  logger.info?.(`pet-quota: ready (day ${state.day}, today ${formatTokens(state.total)} tokens, tier ${tierMeta(tierOf(state.total, cfg), cfg).name})`)
}


