// StrataGate Memory UI — read-only DSH Web settings page.
window.__ModuleLoader__.load({
  id: 'stratagate-dsh',
  factory: (require) => {
    const module = { exports: {} }
    const exports = module.exports
    Object.defineProperty(exports, Symbol.toStringTag, { value: 'Module' })
    const React = require('react')
    const h = React.createElement
    const STAR_REPOSITORY_URL = 'https://github.com/diqierjia/StrataGate-AgentMemory'
    const STAR_DISMISSED_KEY = 'stratagate.starPrompt.dismissed.v1'
    const STAR_PROMPT_USAGE_THRESHOLD = 3

    const panel = {
      padding: '16px', display: 'flex', flexDirection: 'column', gap: '14px', maxWidth: '1180px', margin: '0 auto',
    }
    const row = { display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }
    const card = { border: '1px solid rgba(128,128,128,.28)', borderRadius: '10px', padding: '12px', background: 'rgba(128,128,128,.055)' }
    const muted = { opacity: 0.68, fontSize: '12px' }
    const code = { fontFamily: 'ui-monospace, SFMono-Regular, Consolas, monospace', fontSize: '12px' }

    function wasStarPromptDismissed() {
      try {
        return window.localStorage?.getItem(STAR_DISMISSED_KEY) === '1'
      } catch {
        return false
      }
    }

    function rememberStarPromptDismissal() {
      try {
        window.localStorage?.setItem(STAR_DISMISSED_KEY, '1')
      } catch {
        // The prompt can still be hidden for this render when storage is unavailable.
      }
    }

    function api(path, params) {
      const query = new URLSearchParams(params || {})
      return fetch('/api/stratagate/' + path + (query.size ? '?' + query : ''))
        .then((res) => res.json().catch(() => ({})).then((data) => {
          if (!res.ok) throw new Error((data && data.error) || 'HTTP ' + res.status)
          return data
        }))
    }

    function Stat({ label, value }) {
      return h('div', { style: { ...card, minWidth: '112px', flex: '1 1 112px' } },
        h('div', { style: { fontSize: '22px', fontWeight: 700 } }, String(value)),
        h('div', { style: muted }, label))
    }

    function StarPrompt({ usageRecords }) {
      const [dismissed, setDismissed] = React.useState(wasStarPromptDismissed)
      if (dismissed || Number(usageRecords || 0) < STAR_PROMPT_USAGE_THRESHOLD) return null

      const dismiss = () => {
        rememberStarPromptDismissal()
        setDismissed(true)
      }

      return h('div', { style: { ...card, borderColor: '#d6a84b' }, 'data-testid': 'stratagate-star-prompt' },
        h('div', { style: { fontWeight: 650 } },
          'StrataGate 已帮助当前项目完成 ', String(usageRecords), ' 次有证据支持的记忆召回。'),
        h('div', { style: { ...muted, marginTop: '5px' } },
          '如果它对你有帮助，欢迎给项目一个 Star，让更多 DeepSeek Harness 用户发现它。'),
        h('div', { style: { ...row, marginTop: '10px' } },
          h('a', {
            href: STAR_REPOSITORY_URL,
            target: '_blank',
            rel: 'noopener noreferrer',
            onClick: dismiss,
            style: { color: 'inherit', fontWeight: 650 },
          }, '⭐ 在 GitHub 给 StrataGate 点 Star'),
          h('button', { onClick: dismiss }, '不再提示')))
    }

    function SourceMessages({ messages }) {
      if (!Array.isArray(messages) || messages.length === 0) return h('div', { style: muted }, '没有可显示的原始消息。')
      return h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } }, messages.map((message) =>
        h('div', { key: message.id, style: { ...card, borderLeft: '3px solid #5794f2' } },
          h('div', { style: { ...row, justifyContent: 'space-between' } },
            h('strong', null, String(message.role)),
            h('span', { style: muted }, String(message.createdAt || '') + (message.blockId ? ' · ' + message.blockId : ' · open tail'))),
          h('pre', { style: { ...code, whiteSpace: 'pre-wrap', margin: '8px 0 0', overflowWrap: 'anywhere' } }, String(message.content || '')),
          message.toolCalls && message.toolCalls.length
            ? h('pre', { style: { ...code, whiteSpace: 'pre-wrap', margin: '8px 0 0', overflowWrap: 'anywhere', opacity: 0.82 } }, JSON.stringify(message.toolCalls, null, 2))
            : null)))
    }

    function Detail({ detail, onClose }) {
      if (!detail) return null
      return h('div', { style: { ...card, borderColor: '#5794f2' } },
        h('div', { style: { ...row, justifyContent: 'space-between' } },
          h('strong', null, '来源证据'),
          h('button', { onClick: onClose }, '关闭')),
        Array.isArray(detail.events) && detail.events.length
          ? h('div', { style: { margin: '10px 0' } }, detail.events.map((event) =>
              h('div', { key: event.id, style: { marginBottom: '8px' } },
                h('div', { style: { fontWeight: 600 } }, event.title),
                h('div', { style: muted }, event.summary))))
          : null,
        h(SourceMessages, { messages: detail.messages || detail.sourceMessages }))
    }

    function MemoryItem({ item, kind, openSource }) {
      const title = kind === 'events' ? item.title : kind === 'elements' ? item.name : item.title
      const body = kind === 'events' ? item.summary : kind === 'elements' ? item.currentState : item.summary
      const sourceParams = kind === 'events' ? { eventId: item.id } : kind === 'elements' ? { elementId: item.id } : { blockId: item.id }
      return h('div', { style: card },
        h('div', { style: { ...row, justifyContent: 'space-between' } },
          h('strong', null, String(title || item.id)),
          h('button', { onClick: () => openSource(sourceParams) }, '查看原始证据')),
        h('div', { style: { marginTop: '6px', whiteSpace: 'pre-wrap' } }, String(body || '')),
        h('div', { style: { ...muted, marginTop: '8px' } },
          kind === 'events'
            ? [item.status, item.scope, item.criticality, 'confidence ' + item.confidence].join(' · ')
            : kind === 'elements'
              ? [item.type, (item.facts || []).length + ' facts', (item.sourceEventIds || []).length + ' events'].join(' · ')
              : ['turns ' + (item.turnRange || []).join('–'), item.sourceMessages + ' messages', 'L' + item.currentLevel].join(' · ')))
    }

    function AuditItem({ item }) {
      const audit = item.audit || {}
      return h('details', { style: card },
        h('summary', { style: { cursor: 'pointer' } },
          h('strong', null, audit.sessionId ? '回答 · Session ' + audit.sessionId + (audit.turn !== undefined ? ' · Turn ' + audit.turn : '') : item.id),
          h('span', { style: { ...muted, marginLeft: '8px' } }, String(item.createdAt || ''))),
        h('div', { style: { marginTop: '10px' } },
          h('div', { style: muted }, [audit.verdict || 'legacy receipt', audit.batchId, audit.nextStrategy].filter(Boolean).join(' · ')),
          audit.fit ? h('p', null, h('strong', null, 'Fit: '), audit.fit) : null,
          h('div', { style: code }, 'Evidence: ' + ((audit.evidenceRefs || []).join(', ') || 'legacy IDs only')),
          h('div', { style: { ...muted, margin: '8px 0' } },
            (item.events || []).length + ' events · ' + (item.elements || []).length + ' elements · ' + (item.sourceMessages || []).length + ' source messages'),
          h('div', { style: { fontWeight: 600, margin: '10px 0 6px' } }, '采用的 Memory'),
          [...(item.events || []), ...(item.elements || [])].map((memory) =>
            h('div', { key: memory.id, style: { ...card, marginBottom: '6px' } },
              h('div', { style: { ...row, justifyContent: 'space-between' } },
                h('strong', null, memory.title || memory.name || memory.id),
                h('span', { style: code }, memory.id)),
              h('div', { style: muted }, memory.summary || memory.currentState || ''))),
          h('div', { style: { fontWeight: 600, margin: '10px 0 6px' } }, '追溯到的原始证据'),
          h(SourceMessages, { messages: item.sourceMessages })))
    }

    function MemoryPage() {
      const [overview, setOverview] = React.useState({ namespaces: [] })
      const [namespace, setNamespace] = React.useState('')
      const [tab, setTab] = React.useState('overview')
      const [payload, setPayload] = React.useState({ items: [] })
      const [query, setQuery] = React.useState('')
      const [detail, setDetail] = React.useState(null)
      const [loading, setLoading] = React.useState(true)
      const [error, setError] = React.useState('')

      const refreshOverview = React.useCallback(() => {
        setLoading(true)
        setError('')
        return api('overview').then((data) => {
          setOverview(data)
          if (!namespace && data.namespaces && data.namespaces[0]) setNamespace(data.namespaces[0].namespace)
        }).catch((err) => setError(String(err.message || err))).finally(() => setLoading(false))
      }, [namespace])

      React.useEffect(() => { void refreshOverview() }, [])

      React.useEffect(() => {
        if (!namespace || tab === 'overview') return
        setLoading(true)
        setError('')
        setDetail(null)
        const request = tab === 'audit'
          ? api('audit', { namespace, limit: '100' })
          : api('memories', { namespace, kind: tab, limit: '200' })
        request.then(setPayload).catch((err) => setError(String(err.message || err))).finally(() => setLoading(false))
      }, [namespace, tab])

      const openSource = (params) => {
        setError('')
        api('sources', { namespace, ...params }).then(setDetail).catch((err) => setError(String(err.message || err)))
      }

      const selected = (overview.namespaces || []).find((item) => item.namespace === namespace)
      const filtered = (payload.items || []).filter((item) => !query.trim()
        || JSON.stringify(item).toLowerCase().includes(query.trim().toLowerCase()))
      const tabs = [['overview', '概览'], ['events', 'Events'], ['elements', 'Elements'], ['blocks', 'Sources'], ['audit', 'Usage Audit']]

      return h('div', { style: panel, 'data-testid': 'stratagate-memory-ui' },
        h('div', { style: { ...row, justifyContent: 'space-between' } },
          h('div', null,
            h('div', { style: { fontSize: '20px', fontWeight: 700 } }, 'StrataGate Memory'),
            h('div', { style: muted }, '只读记忆、来源和回答证据审计')),
          h('button', { onClick: () => tab === 'overview' ? refreshOverview() : setTab('overview') }, tab === 'overview' ? '刷新' : '返回概览')),
        h('div', { style: row },
          h('select', { value: namespace, onChange: (event) => setNamespace(event.target.value), style: { minWidth: '280px' } },
            (overview.namespaces || []).map((item) => h('option', { key: item.namespace, value: item.namespace }, item.namespace))),
          tabs.map(([id, label]) => h('button', { key: id, onClick: () => setTab(id), disabled: id !== 'overview' && !namespace, style: id === tab ? { fontWeight: 700 } : {} }, label))),
        error ? h('div', { style: { ...card, color: '#e06c75' } }, error) : null,
        loading ? h('div', { style: muted }, '加载中…') : null,
        tab === 'overview'
          ? selected
            ? h(React.Fragment, null,
                h('div', { style: row },
                  h(Stat, { label: 'Blocks', value: selected.blocks }),
                  h(Stat, { label: 'Events', value: selected.events }),
                  h(Stat, { label: 'Elements', value: selected.elements }),
                  h(Stat, { label: 'Usage records', value: selected.usageReceipts }),
                  h(Stat, { label: 'Failed jobs', value: selected.failedJobs })),
                h(StarPrompt, { usageRecords: selected.usageReceipts }),
                h('div', { style: card },
                  h('div', { style: code }, selected.namespace),
                  h('div', { style: muted }, 'Schema v' + selected.schemaVersion + ' · turn ' + selected.currentTurn + ' · last activity ' + (selected.lastActivityAt || 'none'))))
            : h('div', { style: muted }, '数据库中还没有记忆 namespace。完成一些 DSH 回合后再回来查看。')
          : h(React.Fragment, null,
              tab !== 'audit' ? h('input', { value: query, onChange: (event) => setQuery(event.target.value), placeholder: '过滤当前列表…', style: { padding: '8px' } }) : null,
              h(Detail, { detail, onClose: () => setDetail(null) }),
              h('div', { style: { display: 'flex', flexDirection: 'column', gap: '8px' } },
                filtered.length === 0 && !loading ? h('div', { style: muted }, '没有匹配记录。') : null,
                filtered.map((item) => tab === 'audit'
                  ? h(AuditItem, { key: item.id, item })
                  : h(MemoryItem, { key: item.id, item, kind: tab, openSource })))) )
    }

    function apply(ctx) {
      const slots = ctx.get('slots')
      if (!slots) return
      slots.inject('settings.section', () => slots.register(
        { name: 'settings.section', id: 'stratagate-memory', order: 32, label: () => 'StrataGate Memory' },
        () => h(MemoryPage, null),
      ))
    }

    exports.name = 'stratagate-dsh'
    exports.inject = ['slots']
    exports.apply = apply
    return module.exports
  },
})
