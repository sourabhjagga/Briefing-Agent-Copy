// ============================================================
// Brief Agent Dashboard — Full React UI
// All sections wired to real backend API endpoints
// ============================================================

const { useState, useEffect, useCallback, useRef } = React;
const { createRoot } = ReactDOM;

// ─── Utility helpers ─────────────────────────────────────────
const api = {
  get: (url) => fetch(url).then(r => r.json()),
  post: (url, body) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  patch: (url, body) => fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()),
  del: (url) => fetch(url, { method: 'DELETE' }).then(r => r.json()),
};

function timeAgo(isoOrUnix) {
  if (!isoOrUnix) return '—';
  const ms = typeof isoOrUnix === 'number' ? isoOrUnix * 1000 : new Date(isoOrUnix).getTime();
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function fmtUptime(seconds) {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

// ─── Toast notification system ───────────────────────────────
let _toastFn = null;
function toast(msg, type = 'success') { if (_toastFn) _toastFn(msg, type); }

function Toast() {
  const [toasts, setToasts] = useState([]);
  useEffect(() => {
    _toastFn = (msg, type) => {
      const id = Date.now();
      setToasts(prev => [...prev, { id, msg, type }]);
      setTimeout(() => setToasts(prev => prev.filter(t => t.id !== id)), 3500);
    };
  }, []);
  return React.createElement('div', { className: 'toast-container' },
    toasts.map(t =>
      React.createElement('div', { key: t.id, className: `toast toast-${t.type}` }, t.msg)
    )
  );
}

// ─── Shared Components ────────────────────────────────────────
function Card({ title, children, action }) {
  return React.createElement('div', { className: 'card' },
    (title || action) && React.createElement('div', { className: 'card-header' },
      title && React.createElement('h3', { className: 'card-title' }, title),
      action && React.createElement('div', { className: 'card-action' }, action)
    ),
    React.createElement('div', { className: 'card-body' }, children)
  );
}

function Badge({ label, variant = 'default' }) {
  return React.createElement('span', { className: `badge badge-${variant}` }, label);
}

function Toggle({ checked, onChange, disabled }) {
  return React.createElement('label', { className: `toggle ${disabled ? 'disabled' : ''}` },
    React.createElement('input', { type: 'checkbox', checked: !!checked, onChange: e => !disabled && onChange(e.target.checked) }),
    React.createElement('span', { className: 'toggle-slider' })
  );
}

function Modal({ open, title, onClose, children }) {
  if (!open) return null;
  return React.createElement('div', { className: 'modal-overlay', onClick: e => e.target === e.currentTarget && onClose() },
    React.createElement('div', { className: 'modal' },
      React.createElement('div', { className: 'modal-header' },
        React.createElement('h3', null, title),
        React.createElement('button', { className: 'modal-close', onClick: onClose }, '✕')
      ),
      React.createElement('div', { className: 'modal-body' }, children)
    )
  );
}

function EmptyState({ icon, message, sub }) {
  return React.createElement('div', { className: 'empty-state' },
    React.createElement('div', { className: 'empty-icon' }, icon || '📭'),
    React.createElement('p', { className: 'empty-msg' }, message),
    sub && React.createElement('p', { className: 'empty-sub' }, sub)
  );
}

function Spinner() {
  return React.createElement('div', { className: 'spinner-wrap' },
    React.createElement('div', { className: 'spinner' })
  );
}

// ─── Section: Health ─────────────────────────────────────────
function HealthSection() {
  const [health, setHealth] = useState(null);
  const [scrapers, setScrapers] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const [h, s] = await Promise.all([api.get('/health'), api.get('/api/health')]);
      setHealth(h);
      setScrapers(Array.isArray(s) ? s : []);
    } catch (e) {
      toast('Failed to load health data', 'error');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); const t = setInterval(load, 30000); return () => clearInterval(t); }, [load]);

  if (loading) return React.createElement(Spinner);

  const waOk = health && health.whatsapp === 'connected';

  const kpis = [
    { label: 'WhatsApp', value: health ? (waOk ? '🟢 Connected' : '🔴 Connecting') : '—', sub: health ? `${health.targetGroups || 0} groups` : '' },
    { label: 'Messages Today', value: health ? health.messagesToday : '—', sub: 'cc category' },
    { label: 'Uptime', value: health ? fmtUptime(health.uptime) : '—', sub: 'process uptime' },
    { label: 'Scrapers', value: scrapers.length, sub: `${scrapers.filter(s => s.error_count === 0).length} healthy` },
  ];

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'kpi-grid' },
      kpis.map(k => React.createElement('div', { key: k.label, className: 'kpi-card' },
        React.createElement('div', { className: 'kpi-value' }, k.value),
        React.createElement('div', { className: 'kpi-label' }, k.label),
        k.sub && React.createElement('div', { className: 'kpi-sub' }, k.sub)
      ))
    ),

    health && health.whatsappQr && React.createElement(Card, { title: '📱 WhatsApp QR Code' },
      React.createElement('p', { className: 'text-muted' }, 'Scan this QR code with WhatsApp to connect:'),
      React.createElement('pre', { className: 'qr-code' }, health.whatsappQr)
    ),

    React.createElement(Card, {
      title: '🔍 Scraper Health',
      action: React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: load }, '↺ Refresh')
    },
      scrapers.length === 0
        ? React.createElement(EmptyState, { icon: '🤖', message: 'No scraper health data yet', sub: 'Data appears after the first scrape run' })
        : React.createElement('div', { className: 'table-wrap' },
            React.createElement('table', { className: 'data-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  ['Source', 'Type', 'Last Success', 'Last Attempt', 'Errors', 'Status'].map(h =>
                    React.createElement('th', { key: h }, h)
                  )
                )
              ),
              React.createElement('tbody', null,
                scrapers.map(s => {
                  const ok = s.error_count === 0;
                  return React.createElement('tr', { key: s.source_id },
                    React.createElement('td', null, React.createElement('code', { className: 'source-id' }, s.source_id)),
                    React.createElement('td', null, React.createElement(Badge, { label: s.source_type, variant: 'info' })),
                    React.createElement('td', null, timeAgo(s.last_success)),
                    React.createElement('td', null, timeAgo(s.last_attempt)),
                    React.createElement('td', null, s.error_count > 0 ? React.createElement('span', { className: 'text-error' }, s.error_count) : '0'),
                    React.createElement('td', null, React.createElement(Badge, { label: ok ? 'Healthy' : 'Errors', variant: ok ? 'success' : 'error' }))
                  );
                })
              )
            )
          )
    )
  );
}

// ─── Section: Sources ─────────────────────────────────────────
function SourcesSection() {
  const [sources, setSources] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', source_id: '', type: '' });
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get('/api/sources'), api.get('/api/categories')]);
      setSources(Array.isArray(s) ? s : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load sources', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (id, current) => {
    await api.patch(`/api/sources/${id}`, { is_active: !current });
    setSources(s => s.map(x => x.id === id ? { ...x, is_active: !current ? 1 : 0 } : x));
  };

  const del = async (id, name) => {
    if (!confirm(`Delete source "${name}"?`)) return;
    const r = await api.del(`/api/sources/${id}`);
    if (r.success) { toast('Source deleted'); setSources(s => s.filter(x => x.id !== id)); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const add = async () => {
    if (!form.name || !form.source_id || !form.type) { toast('All fields required', 'error'); return; }
    const r = await api.post('/api/sources', form);
    if (r.success) { toast('Source added'); setShowAdd(false); setForm({ name: '', source_id: '', type: '' }); load(); }
    else toast(r.error || 'Add failed', 'error');
  };

  const filtered = sources.filter(s =>
    !filter || s.name.toLowerCase().includes(filter.toLowerCase()) || s.type.toLowerCase().includes(filter.toLowerCase())
  );

  // Build type options from categories
  const typeOptions = ['cc-whatsapp', 'deals-whatsapp', 'cc-telegram', 'deals-telegram', ...categories.map(c => c.slug + '-whatsapp'), ...categories.map(c => c.slug + '-telegram')];
  const uniqueTypes = [...new Set(typeOptions)];

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'toolbar' },
      React.createElement('input', {
        className: 'search-input', placeholder: 'Filter sources…', value: filter,
        onChange: e => setFilter(e.target.value)
      }),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAdd(true) }, '+ Add Source')
    ),

    loading ? React.createElement(Spinner) :
    React.createElement(Card, null,
      filtered.length === 0
        ? React.createElement(EmptyState, { icon: '📡', message: 'No sources found', sub: 'Add your first WhatsApp group or Telegram channel' })
        : React.createElement('div', { className: 'table-wrap' },
            React.createElement('table', { className: 'data-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  ['Name', 'Source ID', 'Type', 'Active', 'Added', 'Actions'].map(h => React.createElement('th', { key: h }, h))
                )
              ),
              React.createElement('tbody', null,
                filtered.map(s => React.createElement('tr', { key: s.id, className: s.is_active ? '' : 'row-inactive' },
                  React.createElement('td', null, React.createElement('strong', null, s.name)),
                  React.createElement('td', null, React.createElement('code', { className: 'source-id' }, s.source_id)),
                  React.createElement('td', null, React.createElement(Badge, { label: s.type, variant: 'info' })),
                  React.createElement('td', null, React.createElement(Toggle, { checked: !!s.is_active, onChange: () => toggle(s.id, !!s.is_active) })),
                  React.createElement('td', null, React.createElement('span', { className: 'text-muted' }, timeAgo(s.created_at))),
                  React.createElement('td', null,
                    React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(s.id, s.name) }, 'Delete')
                  )
                ))
              )
            )
          )
    ),

    React.createElement(Modal, { open: showAdd, title: 'Add Source', onClose: () => setShowAdd(false) },
      React.createElement('div', { className: 'form-grid' },
        React.createElement('label', { className: 'form-label' }, 'Display Name'),
        React.createElement('input', { className: 'form-input', placeholder: 'e.g. DesiDime Deals', value: form.name, onChange: e => setForm(f => ({ ...f, name: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Source ID (Group JID / Channel ID)'),
        React.createElement('input', { className: 'form-input', placeholder: 'e.g. 1234567890@g.us', value: form.source_id, onChange: e => setForm(f => ({ ...f, source_id: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Type'),
        React.createElement('select', { className: 'form-input', value: form.type, onChange: e => setForm(f => ({ ...f, type: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select type —'),
          uniqueTypes.map(t => React.createElement('option', { key: t, value: t }, t))
        ),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => setShowAdd(false) }, 'Cancel'),
          React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Source')
        )
      )
    )
  );
}

// ─── Section: Categories ──────────────────────────────────────
function CategoriesSection() {
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editCat, setEditCat] = useState(null);
  const emptyForm = { slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '', delivery_channel: 'telegram', whatsapp_delivery_jid: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try { const c = await api.get('/api/categories'); setCats(Array.isArray(c) ? c : []); }
    catch (e) { toast('Failed to load categories', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (cat) => {
    const r = await api.patch(`/api/categories/${cat.id}`, { is_active: !cat.is_active });
    if (r.success) { toast(`Category ${!cat.is_active ? 'activated' : 'deactivated'}`); load(); }
    else toast(r.error || 'Toggle failed', 'error');
  };

  const del = async (cat) => {
    if (!confirm(`Delete category "${cat.display_name}"? This will also remove all associated sources and schedules.`)) return;
    const r = await api.del(`/api/categories/${cat.id}`);
    if (r.success) { toast('Category deleted'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const testBot = async (cat) => {
    toast('Sending test message…');
    const r = await api.post(`/api/categories/${cat.id}/test`, {});
    if (r.success) toast('✅ Test message sent!');
    else toast(r.error || 'Test failed', 'error');
  };

  const openEdit = (cat) => {
    setEditCat(cat);
    setForm({
      slug: cat.slug,
      display_name: cat.display_name,
      bot_token: cat.bot_token || '',
      chat_id: cat.chat_id || '',
      ai_prompt: cat.ai_prompt || '',
      delivery_channel: cat.delivery_channel || 'telegram',
      whatsapp_delivery_jid: cat.whatsapp_delivery_jid || '',
    });
  };

  const save = async () => {
    let r;
    if (editCat) {
      r = await api.patch(`/api/categories/${editCat.id}`, {
        display_name: form.display_name,
        bot_token: form.bot_token,
        chat_id: form.chat_id,
        ai_prompt: form.ai_prompt || null,
        delivery_channel: form.delivery_channel,
        whatsapp_delivery_jid: form.whatsapp_delivery_jid || null,
      });
    } else {
      r = await api.post('/api/categories', form);
    }
    if (r.success) { toast(editCat ? 'Category updated' : 'Category created'); setEditCat(null); setShowAdd(false); setForm(emptyForm); load(); }
    else toast(r.error || 'Save failed', 'error');
  };

  const isBuiltIn = (slug) => slug === 'cc' || slug === 'deals';

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'toolbar' },
      React.createElement('span', { className: 'text-muted' }, `${cats.length} categories`),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => { setEditCat(null); setForm(emptyForm); setShowAdd(true); } }, '+ New Category')
    ),

    loading ? React.createElement(Spinner) :
    cats.length === 0
      ? React.createElement(EmptyState, { icon: '📂', message: 'No categories yet' })
      : React.createElement('div', { className: 'card-list' },
          cats.map(cat => React.createElement('div', { key: cat.id, className: `cat-card ${cat.is_active ? '' : 'inactive'}` },
            React.createElement('div', { className: 'cat-card-left' },
              React.createElement('div', { className: 'cat-name' },
                React.createElement('strong', null, cat.display_name),
                React.createElement(Badge, { label: cat.slug, variant: 'info' }),
                isBuiltIn(cat.slug) && React.createElement(Badge, { label: 'built-in', variant: 'default' })
              ),
              React.createElement('div', { className: 'cat-meta' },
                React.createElement('span', null, `📬 ${cat.delivery_channel || 'telegram'}`),
                cat.bot_token ? React.createElement('span', null, '🤖 Bot configured') : React.createElement('span', { className: 'text-error' }, '⚠ No bot token'),
                cat.chat_id ? React.createElement('span', null, `💬 ${cat.chat_id}`) : React.createElement('span', { className: 'text-muted' }, 'No chat ID')
              )
            ),
            React.createElement('div', { className: 'cat-card-right' },
              React.createElement(Toggle, { checked: !!cat.is_active, onChange: () => toggle(cat) }),
              React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: () => openEdit(cat) }, 'Edit'),
              React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: () => testBot(cat), title: 'Send test Telegram message' }, '🧪 Test'),
              !isBuiltIn(cat.slug) && React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(cat) }, 'Delete')
            )
          ))
        ),

    React.createElement(Modal, { open: showAdd || !!editCat, title: editCat ? `Edit: ${editCat.display_name}` : 'New Category', onClose: () => { setShowAdd(false); setEditCat(null); setForm(emptyForm); } },
      React.createElement('div', { className: 'form-grid' },
        !editCat && React.createElement(React.Fragment, null,
          React.createElement('label', { className: 'form-label' }, 'Slug (e.g. deals, crypto)'),
          React.createElement('input', { className: 'form-input', placeholder: 'lowercase-slug', value: form.slug, onChange: e => setForm(f => ({ ...f, slug: e.target.value })) })
        ),
        React.createElement('label', { className: 'form-label' }, 'Display Name'),
        React.createElement('input', { className: 'form-input', placeholder: 'CC & Finance', value: form.display_name, onChange: e => setForm(f => ({ ...f, display_name: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Telegram Bot Token'),
        React.createElement('input', { className: 'form-input', placeholder: '123456:ABC…', value: form.bot_token, onChange: e => setForm(f => ({ ...f, bot_token: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Telegram Chat ID'),
        React.createElement('input', { className: 'form-input', placeholder: '-100123456789', value: form.chat_id, onChange: e => setForm(f => ({ ...f, chat_id: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Delivery Channel'),
        React.createElement('select', { className: 'form-input', value: form.delivery_channel, onChange: e => setForm(f => ({ ...f, delivery_channel: e.target.value })) },
          React.createElement('option', { value: 'telegram' }, 'Telegram'),
          React.createElement('option', { value: 'whatsapp' }, 'WhatsApp')
        ),
        form.delivery_channel === 'whatsapp' && React.createElement(React.Fragment, null,
          React.createElement('label', { className: 'form-label' }, 'WhatsApp Delivery JID'),
          React.createElement('input', { className: 'form-input', placeholder: '91XXXXXXXXXX@s.whatsapp.net', value: form.whatsapp_delivery_jid, onChange: e => setForm(f => ({ ...f, whatsapp_delivery_jid: e.target.value })) })
        ),
        React.createElement('label', { className: 'form-label' }, 'AI Prompt Override (optional)'),
        React.createElement('textarea', { className: 'form-input', rows: 3, placeholder: 'Custom summarization instructions…', value: form.ai_prompt, onChange: e => setForm(f => ({ ...f, ai_prompt: e.target.value })) }),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => { setShowAdd(false); setEditCat(null); setForm(emptyForm); } }, 'Cancel'),
          React.createElement('button', { className: 'btn btn-primary', onClick: save }, editCat ? 'Save Changes' : 'Create Category')
        )
      )
    )
  );
}

// ─── Section: Schedules ───────────────────────────────────────
function SchedulesSection() {
  const [rules, setRules] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const emptyForm = { category_slug: '', cron_expression: '', label: '' };
  const [form, setForm] = useState(emptyForm);
  const [triggering, setTriggering] = useState(null);

  const load = useCallback(async () => {
    try {
      const [r, c] = await Promise.all([api.get('/api/schedules'), api.get('/api/categories')]);
      setRules(Array.isArray(r) ? r : []);
      setCats(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load schedules', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const toggle = async (rule) => {
    const r = await api.patch(`/api/schedules/${rule.id}`, { is_active: !rule.is_active });
    if (r.success) { toast(rule.is_active ? 'Schedule paused' : 'Schedule activated'); load(); }
    else toast(r.error || 'Toggle failed', 'error');
  };

  const del = async (id) => {
    if (!confirm('Delete this schedule rule?')) return;
    const r = await api.del(`/api/schedules/${id}`);
    if (r.success) { toast('Rule deleted'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const trigger = async (slug) => {
    setTriggering(slug);
    const r = await api.post('/api/schedules/trigger', { slug });
    if (r.success) toast(`✅ Brief triggered for "${slug}"`);
    else toast(r.error || 'Trigger failed', 'error');
    setTriggering(null);
  };

  const triggerAll = async () => {
    setTriggering('all');
    const r = await api.post('/api/schedules/trigger', {});
    if (r.success) toast('✅ All briefs triggered');
    else toast(r.error || 'Trigger failed', 'error');
    setTriggering(null);
  };

  const add = async () => {
    if (!form.category_slug || !form.cron_expression || !form.label) { toast('All fields required', 'error'); return; }
    const r = await api.post('/api/schedules', form);
    if (r.success) { toast('Schedule added'); setShowAdd(false); setForm(emptyForm); load(); }
    else toast(r.error || 'Add failed', 'error');
  };

  // Group rules by category
  const grouped = rules.reduce((acc, r) => {
    if (!acc[r.category_slug]) acc[r.category_slug] = [];
    acc[r.category_slug].push(r);
    return acc;
  }, {});

  const catMap = cats.reduce((m, c) => { m[c.slug] = c.display_name; return m; }, {});

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'toolbar' },
      React.createElement('button', { className: 'btn btn-ghost', onClick: triggerAll, disabled: triggering === 'all' },
        triggering === 'all' ? '⏳ Triggering…' : '⚡ Trigger All Now'
      ),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAdd(true) }, '+ Add Rule')
    ),

    loading ? React.createElement(Spinner) :
    Object.keys(grouped).length === 0
      ? React.createElement(EmptyState, { icon: '📅', message: 'No schedule rules yet', sub: 'Add a cron rule to auto-send daily briefs' })
      : Object.entries(grouped).map(([slug, slugRules]) =>
          React.createElement(Card, {
            key: slug,
            title: `${catMap[slug] || slug}`,
            action: React.createElement('button', {
              className: 'btn btn-sm btn-ghost',
              onClick: () => trigger(slug),
              disabled: triggering === slug
            }, triggering === slug ? '⏳' : '⚡ Trigger Now')
          },
            React.createElement('div', { className: 'table-wrap' },
              React.createElement('table', { className: 'data-table' },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    ['Label', 'Cron', 'Active', 'Running', 'Actions'].map(h => React.createElement('th', { key: h }, h))
                  )
                ),
                React.createElement('tbody', null,
                  slugRules.map(rule => React.createElement('tr', { key: rule.id, className: rule.is_active ? '' : 'row-inactive' },
                    React.createElement('td', null, rule.label),
                    React.createElement('td', null, React.createElement('code', { className: 'source-id' }, rule.cron_expression)),
                    React.createElement('td', null, React.createElement(Toggle, { checked: !!rule.is_active, onChange: () => toggle(rule) })),
                    React.createElement('td', null, React.createElement(Badge, { label: rule.is_running ? 'Live' : 'Idle', variant: rule.is_running ? 'success' : 'default' })),
                    React.createElement('td', null,
                      React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(rule.id) }, 'Delete')
                    )
                  ))
                )
              )
            )
          )
        ),

    React.createElement(Modal, { open: showAdd, title: 'Add Schedule Rule', onClose: () => { setShowAdd(false); setForm(emptyForm); } },
      React.createElement('div', { className: 'form-grid' },
        React.createElement('label', { className: 'form-label' }, 'Category'),
        React.createElement('select', { className: 'form-input', value: form.category_slug, onChange: e => setForm(f => ({ ...f, category_slug: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select category —'),
          cats.map(c => React.createElement('option', { key: c.slug, value: c.slug }, c.display_name))
        ),
        React.createElement('label', { className: 'form-label' }, 'Cron Expression'),
        React.createElement('input', { className: 'form-input', placeholder: '0 8 * * * (8 AM daily)', value: form.cron_expression, onChange: e => setForm(f => ({ ...f, cron_expression: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Label'),
        React.createElement('input', { className: 'form-input', placeholder: '8 AM Brief', value: form.label, onChange: e => setForm(f => ({ ...f, label: e.target.value })) }),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => { setShowAdd(false); setForm(emptyForm); } }, 'Cancel'),
          React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Rule')
        )
      )
    )
  );
}

// ─── Section: Telegram ────────────────────────────────────────
function TelegramSection() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [step, setStep] = useState('idle'); // idle | sent | done
  const [channels, setChannels] = useState([]);
  const [discovering, setDiscovering] = useState(false);

  const loadStatus = useCallback(async () => {
    try { const s = await api.get('/api/telegram/status'); setStatus(s); if (s.isReady) setStep('done'); else if (s.tempPhone) setStep('sent'); }
    catch (e) { toast('Failed to load Telegram status', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const sendCode = async () => {
    if (!phone) { toast('Enter phone number', 'error'); return; }
    const r = await api.post('/api/telegram/send-code', { phoneNumber: phone });
    if (r.success) { toast('OTP sent!'); setStep('sent'); }
    else toast(r.error || 'Failed to send code', 'error');
  };

  const submitCode = async () => {
    if (!code) { toast('Enter OTP code', 'error'); return; }
    const r = await api.post('/api/telegram/submit-code', { code, password });
    if (r.success) { toast('✅ Logged in!'); setStep('done'); loadStatus(); }
    else toast(r.error || 'Login failed', 'error');
  };

  const logout = async () => {
    if (!confirm('Log out Telegram user session?')) return;
    const r = await api.post('/api/telegram/logout', {});
    if (r.success) { toast('Logged out'); setStep('idle'); loadStatus(); }
    else toast(r.error || 'Logout failed', 'error');
  };

  const discover = async () => {
    setDiscovering(true);
    try { const r = await api.get('/api/telegram/discover'); setChannels(Array.isArray(r) ? r : []); }
    catch (e) { toast('Discovery failed', 'error'); }
    setDiscovering(false);
  };

  if (loading) return React.createElement(Spinner);

  return React.createElement('div', { className: 'section-content' },
    React.createElement(Card, { title: '📡 Telegram User Session' },
      React.createElement('div', { className: 'status-row' },
        React.createElement('div', { className: `status-indicator ${status && status.isReady ? 'status-ok' : 'status-warn'}` }),
        React.createElement('span', null, status && status.isReady ? 'Connected' : (status && status.tempPhone ? `Waiting for OTP — ${status.tempPhone}` : 'Not connected'))
      ),

      !status?.isReady && step === 'idle' && React.createElement('div', { className: 'form-grid mt-4' },
        React.createElement('label', { className: 'form-label' }, 'Phone Number (with country code)'),
        React.createElement('input', { className: 'form-input', placeholder: '+919876543210', value: phone, onChange: e => setPhone(e.target.value) }),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-primary', onClick: sendCode }, 'Send OTP')
        )
      ),

      !status?.isReady && step === 'sent' && React.createElement('div', { className: 'form-grid mt-4' },
        React.createElement('label', { className: 'form-label' }, 'OTP Code'),
        React.createElement('input', { className: 'form-input', placeholder: '12345', value: code, onChange: e => setCode(e.target.value) }),
        React.createElement('label', { className: 'form-label' }, '2FA Password (if enabled)'),
        React.createElement('input', { className: 'form-input', type: 'password', placeholder: 'Leave blank if not set', value: password, onChange: e => setPassword(e.target.value) }),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => setStep('idle') }, '← Back'),
          React.createElement('button', { className: 'btn btn-primary', onClick: submitCode }, 'Verify & Login')
        )
      ),

      status?.isReady && React.createElement('div', { className: 'form-actions mt-4' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: discover, disabled: discovering },
          discovering ? '🔍 Discovering…' : '🔍 Discover Channels'
        ),
        React.createElement('button', { className: 'btn btn-danger', onClick: logout }, 'Logout')
      )
    ),

    channels.length > 0 && React.createElement(Card, { title: `📋 Subscribed Channels (${channels.length})` },
      React.createElement('div', { className: 'table-wrap' },
        React.createElement('table', { className: 'data-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['ID', 'Title', 'Type', 'Members'].map(h => React.createElement('th', { key: h }, h))
            )
          ),
          React.createElement('tbody', null,
            channels.map((ch, i) => React.createElement('tr', { key: i },
              React.createElement('td', null, React.createElement('code', { className: 'source-id' }, ch.id)),
              React.createElement('td', null, ch.title),
              React.createElement('td', null, React.createElement(Badge, { label: ch.type || 'channel', variant: 'info' })),
              React.createElement('td', null, ch.participants_count || '—')
            ))
          )
        )
      )
    )
  );
}

// ─── Section: Cookies ─────────────────────────────────────────
function CookiesSection() {
  const SITES = ['desidime', 'technofino', 'reddit', 'youtube'];
  const [siteData, setSiteData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSite, setActiveSite] = useState(null);
  const [cookieText, setCookieText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try { const r = await api.get('/api/cookies'); setSiteData(Array.isArray(r) ? r : []); }
    catch (e) { toast('Failed to load cookies', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const openPaste = (site) => { setActiveSite(site); setCookieText(''); };

  const save = async () => {
    if (!cookieText.trim()) { toast('Paste cookie JSON first', 'error'); return; }
    setSaving(true);
    const r = await api.post('/api/cookies/import', { site: activeSite, cookies: cookieText.trim() });
    setSaving(false);
    if (r.success) { toast(`✅ Cookies saved for ${activeSite}`); setActiveSite(null); load(); }
    else toast(r.error || 'Save failed', 'error');
  };

  const deleteCookies = async (site) => {
    if (!confirm(`Delete cookies for ${site}?`)) return;
    const r = await api.post('/api/cookies/delete', { site });
    if (r.success) { toast(`Cookies deleted for ${site}`); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  if (loading) return React.createElement(Spinner);

  const siteMap = siteData.reduce((m, s) => { m[s.site] = s; return m; }, {});

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'cookie-grid' },
      SITES.map(site => {
        const info = siteMap[site] || { site, has_cookies: false, updated_at: null };
        return React.createElement('div', { key: site, className: `cookie-card ${info.has_cookies ? 'has-cookies' : ''}` },
          React.createElement('div', { className: 'cookie-card-top' },
            React.createElement('span', { className: `cookie-icon ${info.has_cookies ? 'text-success' : 'text-muted'}` }, info.has_cookies ? '🔐' : '🔓'),
            React.createElement('div', null,
              React.createElement('div', { className: 'cookie-site' }, site),
              React.createElement('div', { className: 'text-muted text-sm' }, info.has_cookies ? `Updated ${timeAgo(info.updated_at)}` : 'No cookies')
            )
          ),
          React.createElement('div', { className: 'cookie-actions' },
            React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: () => openPaste(site) }, info.has_cookies ? 'Update' : 'Add Cookies'),
            info.has_cookies && React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => deleteCookies(site) }, 'Clear')
          )
        );
      })
    ),

    React.createElement(Modal, { open: !!activeSite, title: `Paste Cookies — ${activeSite}`, onClose: () => setActiveSite(null) },
      React.createElement('p', { className: 'text-muted mb-2' }, 'Paste the full JSON array of cookies exported from your browser (e.g. via EditThisCookie extension):'),
      React.createElement('textarea', {
        className: 'form-input cookie-textarea',
        rows: 12,
        placeholder: '[{"name": "session", "value": "...", ...}]',
        value: cookieText,
        onChange: e => setCookieText(e.target.value)
      }),
      React.createElement('div', { className: 'form-actions mt-2' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => setActiveSite(null) }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: save, disabled: saving },
          saving ? 'Saving…' : 'Save Cookies'
        )
      )
    )
  );
}

// ─── Section: WhatsApp Sources ────────────────────────────────
function WhatsAppSection() {
  const [sources, setSources] = useState([]);
  const [discovered, setDiscovered] = useState([]);
  const [cats, setCats] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const emptyForm = { name: '', source_id: '', category_slug: '' };
  const [form, setForm] = useState(emptyForm);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get('/api/whatsapp/sources'), api.get('/api/categories')]);
      setSources(Array.isArray(s) ? s : []);
      setCats(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load WhatsApp data', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const discover = async () => {
    setDiscovering(true);
    try { const r = await api.get('/api/whatsapp/discover'); setDiscovered(Array.isArray(r) ? r : []); if (!r.length) toast('No groups found. Is WhatsApp connected?', 'error'); }
    catch (e) { toast('Discovery failed — WhatsApp may not be connected', 'error'); }
    setDiscovering(false);
  };

  const add = async () => {
    if (!form.name || !form.source_id || !form.category_slug) { toast('All fields required', 'error'); return; }
    const r = await api.post('/api/whatsapp/sources', form);
    if (r.success) { toast('Source added'); setShowAdd(false); setForm(emptyForm); load(); }
    else toast(r.error || 'Add failed', 'error');
  };

  const del = async (id, name) => {
    if (!confirm(`Remove "${name}"?`)) return;
    const r = await api.del(`/api/whatsapp/sources/${id}`);
    if (r.success) { toast('Removed'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const prefill = (g) => {
    setForm({ name: g.name || g.subject || g.id, source_id: g.id, category_slug: cats[0]?.slug || '' });
    setShowAdd(true);
  };

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'toolbar' },
      React.createElement('button', { className: 'btn btn-ghost', onClick: discover, disabled: discovering },
        discovering ? '🔍 Scanning…' : '🔍 Discover Groups'
      ),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAdd(true) }, '+ Add Group')
    ),

    discovered.length > 0 && React.createElement(Card, { title: `📱 Discovered Groups (${discovered.length}) — click to add` },
      React.createElement('div', { className: 'table-wrap' },
        React.createElement('table', { className: 'data-table' },
          React.createElement('thead', null,
            React.createElement('tr', null, ['Name', 'ID', 'Action'].map(h => React.createElement('th', { key: h }, h)))
          ),
          React.createElement('tbody', null,
            discovered.map((g, i) => React.createElement('tr', { key: i },
              React.createElement('td', null, g.name || g.subject || '—'),
              React.createElement('td', null, React.createElement('code', { className: 'source-id' }, g.id)),
              React.createElement('td', null, React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: () => prefill(g) }, '+ Add'))
            ))
          )
        )
      )
    ),

    loading ? React.createElement(Spinner) :
    React.createElement(Card, { title: `📋 Tracked Groups (${sources.length})` },
      sources.length === 0
        ? React.createElement(EmptyState, { icon: '💬', message: 'No WhatsApp groups tracked yet', sub: 'Discover groups or add manually' })
        : React.createElement('div', { className: 'table-wrap' },
            React.createElement('table', { className: 'data-table' },
              React.createElement('thead', null,
                React.createElement('tr', null, ['Name', 'Source ID', 'Category', 'Active', 'Actions'].map(h => React.createElement('th', { key: h }, h)))
              ),
              React.createElement('tbody', null,
                sources.map(s => React.createElement('tr', { key: s.id, className: s.is_active ? '' : 'row-inactive' },
                  React.createElement('td', null, React.createElement('strong', null, s.name)),
                  React.createElement('td', null, React.createElement('code', { className: 'source-id' }, s.source_id)),
                  React.createElement('td', null, React.createElement(Badge, { label: s.type.replace('-whatsapp', ''), variant: 'info' })),
                  React.createElement('td', null, React.createElement(Badge, { label: s.is_active ? 'Active' : 'Inactive', variant: s.is_active ? 'success' : 'default' })),
                  React.createElement('td', null, React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(s.id, s.name) }, 'Remove'))
                ))
              )
            )
          )
    ),

    React.createElement(Modal, { open: showAdd, title: 'Add WhatsApp Group', onClose: () => { setShowAdd(false); setForm(emptyForm); } },
      React.createElement('div', { className: 'form-grid' },
        React.createElement('label', { className: 'form-label' }, 'Group Name'),
        React.createElement('input', { className: 'form-input', placeholder: 'Deals Group', value: form.name, onChange: e => setForm(f => ({ ...f, name: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Group JID'),
        React.createElement('input', { className: 'form-input', placeholder: '1234567890-12345@g.us', value: form.source_id, onChange: e => setForm(f => ({ ...f, source_id: e.target.value })) }),
        React.createElement('label', { className: 'form-label' }, 'Category'),
        React.createElement('select', { className: 'form-input', value: form.category_slug, onChange: e => setForm(f => ({ ...f, category_slug: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select category —'),
          cats.map(c => React.createElement('option', { key: c.slug, value: c.slug }, c.display_name))
        ),
        React.createElement('div', { className: 'form-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => { setShowAdd(false); setForm(emptyForm); } }, 'Cancel'),
          React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Group')
        )
      )
    )
  );
}

// ─── App Shell ────────────────────────────────────────────────
const NAV_ITEMS = [
  { id: 'health',     label: '🩺 Health',     title: 'System Health' },
  { id: 'categories', label: '📂 Categories', title: 'Categories' },
  { id: 'sources',    label: '📡 Sources',    title: 'Sources' },
  { id: 'whatsapp',   label: '💬 WhatsApp',   title: 'WhatsApp Groups' },
  { id: 'schedules',  label: '📅 Schedules',  title: 'Schedule Rules' },
  { id: 'telegram',   label: '✈️ Telegram',   title: 'Telegram Session' },
  { id: 'cookies',    label: '🍪 Cookies',    title: 'Cookie Manager' },
];

const SECTION_MAP = {
  health:     HealthSection,
  categories: CategoriesSection,
  sources:    SourcesSection,
  whatsapp:   WhatsAppSection,
  schedules:  SchedulesSection,
  telegram:   TelegramSection,
  cookies:    CookiesSection,
};

function App() {
  const [active, setActive] = useState('health');
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const current = NAV_ITEMS.find(n => n.id === active);
  const SectionComp = SECTION_MAP[active];

  return React.createElement('div', { className: `app-shell ${sidebarOpen ? 'sidebar-open' : ''}` },
    // Sidebar
    React.createElement('aside', { className: 'sidebar' },
      React.createElement('div', { className: 'sidebar-logo' },
        React.createElement('span', { className: 'logo-icon' }, '⚡'),
        React.createElement('span', { className: 'logo-text' }, 'Brief Agent')
      ),
      React.createElement('nav', { className: 'sidebar-nav' },
        NAV_ITEMS.map(item =>
          React.createElement('button', {
            key: item.id,
            className: `nav-item ${active === item.id ? 'active' : ''}`,
            onClick: () => { setActive(item.id); setSidebarOpen(false); }
          }, item.label)
        )
      )
    ),

    // Mobile overlay
    sidebarOpen && React.createElement('div', { className: 'sidebar-overlay', onClick: () => setSidebarOpen(false) }),

    // Main content
    React.createElement('div', { className: 'main-area' },
      React.createElement('header', { className: 'topbar' },
        React.createElement('button', { className: 'hamburger', onClick: () => setSidebarOpen(o => !o) }, '☰'),
        React.createElement('h1', { className: 'page-title' }, current?.title || ''),
        React.createElement('div', { className: 'topbar-right' },
          React.createElement('span', { className: 'version-badge' }, 'v2.0')
        )
      ),
      React.createElement('main', { className: 'content-area' },
        React.createElement(SectionComp)
      )
    ),

    React.createElement(Toast)
  );
}

// ─── Mount ────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  const root = createRoot(document.getElementById('root'));
  root.render(React.createElement(App));
});
