/**
 * dsh-pet-quota — browser half.
 *
 * Contributes exactly one surface: a `settings.section` page with today's total,
 * the three tiers as dots, the thresholds and the bubble switches. There is no
 * floating element of ours in the frame — the bubble itself is pushed by the
 * host half through the pet service.
 *
 * The page reads the host half's own `/api/pet-quota/*` routes.
 *
 * Hand-written ModuleLoader bundle: no build step, no dependency beyond the
 * `react` the shell already provides. All colour comes from theme variables so
 * the surface survives a light/dark switch.
 */
window.__ModuleLoader__.load({
  id: 'dsh-pet-quota',
  factory: require => {
    const module = { exports: {} }
    const exports = module.exports
    const React = require('react')
    const { createElement: h, useState, useEffect, useCallback } = React

    const inject = ['slots']
    const POLL_MS = 5000

    const CSS = `
.pq_page{display:flex;flex-direction:column;gap:14px;max-width:760px;font:13px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:var(--dsw-alias-label-primary)}
.pq_card{padding:14px 16px;border-radius:14px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);display:flex;flex-direction:column;gap:10px}
.pq_head{display:flex;align-items:center;gap:10px;flex-wrap:wrap}
.pq_big{font-size:22px;font-weight:650;font-variant-numeric:tabular-nums}
.pq_tag{font-size:11px;padding:2px 9px;border-radius:999px;border:1px solid var(--dsw-alias-border-l2);color:var(--dsw-alias-label-secondary)}
/* The whole tier language: one dot, three colours. No bar, no percentage. */
.pq_dotbig{width:10px;height:10px;border-radius:50%;flex:none;display:inline-block;background:#3fb950}
.pq_dotbig[data-tier="0"]{background:#3fb950}
.pq_dotbig[data-tier="1"]{background:#d29922}
.pq_dotbig[data-tier="2"]{background:#f85149}
.pq_hint{color:var(--dsw-alias-label-secondary);font-size:11.5px}
.pq_ladder{display:flex;gap:8px;flex-wrap:wrap}
.pq_step{flex:1 1 160px;padding:10px 12px;border-radius:11px;border:1px solid var(--dsw-alias-border-l1);background:var(--dsw-alias-bg-layer-2);display:flex;flex-direction:column;gap:3px}
.pq_step[data-on="true"]{border-color:var(--dsw-alias-brand-primary)}
.pq_step b{font-size:12.5px}
.pq_grid{display:flex;gap:8px;flex-wrap:wrap}
.pq_btn{font:inherit;font-size:12px;padding:4px 10px;border-radius:8px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);cursor:pointer}
.pq_btn:hover{border-color:var(--dsw-alias-brand-primary)}
.pq_btn[disabled]{opacity:.5;cursor:default}
.pq_fields{display:flex;gap:14px;flex-wrap:wrap}
.pq_field{display:flex;flex-direction:column;gap:4px;min-width:190px}
.pq_field>span:first-child{font-size:11.5px;color:var(--dsw-alias-label-secondary)}
.pq_input{font:inherit;font-size:12.5px;padding:5px 9px;border-radius:9px;border:1px solid var(--dsw-alias-border-l2);background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-primary)}
.pq_input:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}
.pq_checks{display:flex;gap:16px;flex-wrap:wrap}
.pq_check{display:flex;align-items:center;gap:6px;font-size:12px;color:var(--dsw-alias-label-secondary);cursor:pointer}
.pq_check input{accent-color:var(--dsw-alias-brand-primary)}
`

    async function getJson(url, init) {
      const response = await fetch(url, { credentials: 'same-origin', ...init })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      return response.json()
    }

    function useToday() {
      const [data, setData] = useState(null)
      const [error, setError] = useState(null)
      const load = useCallback(() => {
        getJson('/api/pet-quota/today').then(setData).catch(e => setError(String(e.message ?? e)))
      }, [])
      useEffect(() => {
        load()
        const timer = window.setInterval(load, POLL_MS)
        return () => window.clearInterval(timer)
      }, [load])
      return { data, error, reload: load }
    }

    function SettingsCard() {
      const { data, error, reload } = useToday()
      if (error !== null) {
        return h('div', { className: 'pq_page' }, h('div', { className: 'pq_card' }, `无法连接插件后端：${error}`))
      }
      if (data === null) return h('div', { className: 'pq_page' }, h('div', { className: 'pq_card' }, '正在读取今日用量…'))
      const nextText = data.nextAt === undefined || data.nextAt === null
        ? '已在最高档'
        : `距下一档还差 ${data.remaining.toLocaleString()} token`
      return h('div', { className: 'pq_page' },
        h('div', { className: 'pq_card' },
          h('div', { className: 'pq_head' },
            h('span', { className: 'pq_dotbig', 'data-tier': data.tier }),
            h('span', { className: 'pq_big' }, `${data.totalText} tok`),
            h('span', { className: 'pq_tag' }, `${data.day} · ${data.tierName}`),
            h('span', { className: 'pq_hint' }, `${data.calls} 次调用`)),
          h('div', { className: 'pq_hint' }, `${nextText}（口径与侧边栏一致：输入+缓存读+缓存写+输出）`)),
        h('div', { className: 'pq_ladder' },
          [
            { tier: 0, name: '轻度', range: `< ${data.thresholds.lowMax.toLocaleString()}` },
            { tier: 1, name: '中度', range: `${data.thresholds.lowMax.toLocaleString()} – ${data.thresholds.midMax.toLocaleString()}` },
            { tier: 2, name: '重度', range: `> ${data.thresholds.midMax.toLocaleString()}` },
          ].map(step => h('div', { key: step.name, className: 'pq_step', 'data-on': data.tier === step.tier },
            h('div', { className: 'pq_head' },
              h('span', { className: 'pq_dotbig', 'data-tier': step.tier }),
              h('b', null, step.name)),
            h('span', { className: 'pq_hint' }, step.range),
            h('span', { className: 'pq_hint' }, data.tier === step.tier ? `当前 · ${data.line}` : '')))),
        h('div', { className: 'pq_card' },
          h('b', null, '气泡'),
          h('span', { className: 'pq_hint' }, '档位在气泡里只用一个彩色圆点表示（🟢 轻度 · 🟡 中度 · 🔴 重度），没有进度条也没有百分比。'),
          h('span', { className: 'pq_hint' }, '除了常驻的「今日额度」，还有三条事件气泡：任务完成（本轮 +X）、这一轮没跑完/被打断、以及跨档时的「进入重度 · 鲸吞模式」。它们和额度气泡共用同一个位置，后者会在下一次心跳时回来。'),
          h('span', { className: 'pq_hint' }, '计数口径与侧边栏一致：输入 + 缓存读 + 缓存写 + 输出；重启后从当天已记录的数字继续，不会归零。')),
        h('div', { className: 'pq_card' },
          h('b', null, '前提'),
          h('span', { className: 'pq_hint' }, data.petAvailable
            ? '已检测到宠物服务，气泡会挂在宠物身上。'
            : '没找到宠物服务：先启用 @linxin666/dsh-pet，气泡才有地方显示。')),
        h(Prefs, { config: data.config, onSaved: reload }))
    }

    /** Thresholds and switches: written straight to the host's own config file,
     * so a change applies immediately and survives a restart. */
    function Prefs(props) {
      const { config, onSaved } = props
      const [draft, setDraft] = useState(null)
      const [busy, setBusy] = useState(false)
      const [note, setNote] = useState('')
      const current = draft ?? config ?? {}
      const save = patch => {
        setBusy(true)
        setNote('')
        getJson('/api/pet-quota/config', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(patch),
        })
          .then(data => { setDraft(null); onSaved?.(data); setNote('已保存') })
          .catch(error => setNote(`保存失败：${String(error.message ?? error)}`))
          .finally(() => setBusy(false))
      }
      const num = (key, label, hint) => h('label', { className: 'pq_field' },
        h('span', null, label),
        h('input', {
          className: 'pq_input',
          type: 'number',
          min: 1000,
          step: 10000,
          value: current[key] ?? '',
          disabled: busy,
          onChange: event => setDraft(d => ({ ...(d ?? config), [key]: Number(event.target.value.replace(/[^0-9]/g, '')) || 0 })),
        }),
        h('span', { className: 'pq_hint' }, hint))
      const toggle = (key, label) => h('label', { className: 'pq_check' },
        h('input', {
          type: 'checkbox',
          checked: current[key] === true,
          disabled: busy,
          onChange: event => save({ [key]: event.target.checked }),
        }),
        h('span', null, label))
      return h('div', { className: 'pq_card' },
        h('b', null, '档位设置'),
        h('div', { className: 'pq_fields' },
          num('lowMax', '中度阈值（token）', '超过它进入中度，默认 5000万'),
          num('midMax', '重度阈值（token）', '超过它进入重度，默认 1亿')),
        h('div', { className: 'pq_checks' },
          toggle('enabled', '显示今日额度气泡'),
          toggle('announceOnTurnEnd', '任务完成时冒泡'),
          toggle('announceWhileRunning', '长时间运行中冒泡')),
        h('div', { className: 'pq_head' },
          h('button', { className: 'pq_btn', type: 'button', disabled: busy || draft === null, onClick: () => save({ lowMax: current.lowMax, midMax: current.midMax }) }, '保存阈值'),
          h('span', { className: 'pq_hint' }, note)))
    }

    /**
     * The browser half contributes exactly one surface: the settings page. The
     * bubble itself is pushed by the host half through the pet service, so there
     * is no floating element of ours in the frame at all.
     */
    function apply(ctx) {
      ctx.effect(() => {
        const style = document.createElement('style')
        style.setAttribute('data-pet-quota', '')
        style.textContent = CSS
        document.head.appendChild(style)
        return () => { try { style.remove() } catch { /* already gone */ } }
      }, 'pet-quota: styles')

      ctx.slots.inject('settings.section', () => ctx.slots.register({
        name: 'settings.section',
        id: 'dsh-pet-quota',
        order: 132,
        label: () => '宠物额度',
      }, () => h(SettingsCard)))
    }

    exports.apply = apply
    exports.inject = inject
    exports.name = 'dsh-pet-quota'
    return module.exports
  },
})




