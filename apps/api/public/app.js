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

  // FIX #1 (sources): toggle uses PATCH /api/sources/:id — this was already correct.
  // Sends only {is_active} so backend handles it cleanly.
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
    !filter || s.name?.toLowerCase().includes(filter.toLowerCase()) || s.type?.toLowerCase().includes(filter.toLowerCase())
  );

  if (loading) return React.createElement(Spinner);

  const typeOptions = [
    { value: 'cc-telegram', label: 'CC — Telegram' },
    { value: 'cc-whatsapp', label: 'CC — WhatsApp' },
    { value: 'cc-forum', label: 'CC — Forum (TechnoFino)' },
    { value: 'deals-telegram', label: 'Deals — Telegram' },
    { value: 'deals-whatsapp', label: 'Deals — WhatsApp' },
    { value: 'deals-reddit', label: 'Deals — Reddit' },
    { value: 'deals-youtube', label: 'Deals — YouTube' },
    { value: 'deals-forum', label: 'Deals — Forum (DesiDime)' },
    ...categories
      .filter(c => c.slug !== 'cc' && c.slug !== 'deals')
      .flatMap(c => [
        { value: `${c.slug}-telegram`, label: `${c.display_name} — Telegram` },
        { value: `${c.slug}-whatsapp`, label: `${c.display_name} — WhatsApp` },
      ]),
  ];

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'section-toolbar' },
      React.createElement('input', {
        className: 'input search-input',
        placeholder: '🔍 Filter sources…',
        value: filter,
        onChange: e => setFilter(e.target.value),
      }),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAdd(true) }, '+ Add Source')
    ),

    React.createElement(Card, { title: `Sources (${filtered.length})` },
      filtered.length === 0
        ? React.createElement(EmptyState, { icon: '📡', message: 'No sources found', sub: filter ? 'Try a different filter' : 'Add a source to get started' })
        : React.createElement('div', { className: 'table-wrap' },
            React.createElement('table', { className: 'data-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  ['Name', 'Source ID', 'Type', 'Active', 'Actions'].map(h =>
                    React.createElement('th', { key: h }, h)
                  )
                )
              ),
              React.createElement('tbody', null,
                filtered.map(s =>
                  React.createElement('tr', { key: s.id },
                    React.createElement('td', null, s.name),
                    React.createElement('td', null, React.createElement('code', { className: 'source-id' }, s.source_id)),
                    React.createElement('td', null, React.createElement(Badge, { label: s.type, variant: 'info' })),
                    React.createElement('td', null,
                      React.createElement(Toggle, { checked: !!s.is_active, onChange: () => toggle(s.id, !!s.is_active) })
                    ),
                    React.createElement('td', null,
                      React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(s.id, s.name) }, 'Delete')
                    )
                  )
                )
              )
            )
          )
    ),

    React.createElement(Modal, { open: showAdd, title: 'Add Source', onClose: () => setShowAdd(false) },
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Display Name'),
        React.createElement('input', { className: 'input', placeholder: 'e.g. CC India TF', value: form.name, onChange: e => setForm(f => ({ ...f, name: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Source ID'),
        React.createElement('input', { className: 'input', placeholder: 'Telegram channel username or WhatsApp JID', value: form.source_id, onChange: e => setForm(f => ({ ...f, source_id: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Type'),
        React.createElement('select', { className: 'input', value: form.type, onChange: e => setForm(f => ({ ...f, type: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select type —'),
          typeOptions.map(o => React.createElement('option', { key: o.value, value: o.value }, o.label))
        )
      ),
      React.createElement('div', { className: 'modal-actions' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => setShowAdd(false) }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Source')
      )
    )
  );
}

// ─── Section: Categories ──────────────────────────────────────
function CategoriesSection() {
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editTarget, setEditTarget] = useState(null);
  const [form, setForm] = useState({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '', delivery_channel: 'telegram', whatsapp_delivery_jid: '' });
  const [testing, setTesting] = useState(null);

  const load = useCallback(async () => {
    try {
      const c = await api.get('/api/categories');
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load categories', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // FIX #1 (categories): toggle now calls PATCH /api/categories/:id with ONLY {is_active}.
  // Previously called PATCH /api/categories/:id/toggle which does NOT exist on the backend.
  // Sending only {is_active} triggers the isToggleOnly fast-path in the backend handler,
  // which calls database.toggleCategory() and reloads the scheduler — no other fields needed.
  const toggle = async (id, current) => {
    const r = await api.patch(`/api/categories/${id}`, { is_active: !current });
    if (r.success) {
      setCategories(c => c.map(x => x.id === id ? { ...x, is_active: !current ? 1 : 0 } : x));
    } else {
      toast(r.error || 'Toggle failed', 'error');
    }
  };

  const del = async (id, name, slug) => {
    if (slug === 'cc' || slug === 'deals') { toast('Cannot delete built-in categories', 'error'); return; }
    if (!confirm(`Delete category "${name}"? All associated sources will also be removed.`)) return;
    const r = await api.del(`/api/categories/${id}`);
    if (r.success) { toast('Category deleted'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const openEdit = (cat) => {
    setEditTarget(cat);
    setForm({
      slug: cat.slug,
      display_name: cat.display_name || '',
      bot_token: cat.bot_token || '',
      chat_id: cat.chat_id || '',
      ai_prompt: cat.ai_prompt || '',
      // FIX #4: preserve delivery_channel and whatsapp_delivery_jid on edit
      delivery_channel: cat.delivery_channel || 'telegram',
      whatsapp_delivery_jid: cat.whatsapp_delivery_jid || '',
    });
    setShowAdd(true);
  };

  const save = async () => {
    if (!form.display_name) { toast('Display name is required', 'error'); return; }
    if (!editTarget && (!form.slug || !/^[a-z0-9-]+$/.test(form.slug))) {
      toast('Slug must be lowercase letters, numbers, and hyphens only', 'error'); return;
    }

    let r;
    if (editTarget) {
      // FIX #4: send delivery_channel and whatsapp_delivery_jid in the update payload
      // so the backend doesn't silently reset those columns to NULL.
      r = await api.patch(`/api/categories/${editTarget.id}`, {
        display_name: form.display_name,
        bot_token: form.bot_token || null,
        chat_id: form.chat_id || null,
        ai_prompt: form.ai_prompt || null,
        delivery_channel: form.delivery_channel || 'telegram',
        whatsapp_delivery_jid: form.whatsapp_delivery_jid || null,
      });
    } else {
      // FIX #4: include delivery_channel and whatsapp_delivery_jid on creation too
      r = await api.post('/api/categories', {
        slug: form.slug,
        display_name: form.display_name,
        bot_token: form.bot_token || null,
        chat_id: form.chat_id || null,
        ai_prompt: form.ai_prompt || null,
        delivery_channel: form.delivery_channel || 'telegram',
        whatsapp_delivery_jid: form.whatsapp_delivery_jid || null,
      });
    }

    if (r.success) {
      toast(editTarget ? 'Category updated' : 'Category created');
      setShowAdd(false);
      setEditTarget(null);
      setForm({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '', delivery_channel: 'telegram', whatsapp_delivery_jid: '' });
      load();
    } else {
      toast(r.error || 'Save failed', 'error');
    }
  };

  const test = async (id) => {
    setTesting(id);
    try {
      const r = await api.post(`/api/categories/${id}/test`, {});
      if (r.success) toast(r.message || 'Test message sent!');
      else toast(r.error || 'Test failed', 'error');
    } catch (e) {
      toast('Test request failed', 'error');
    } finally {
      setTesting(null);
    }
  };

  if (loading) return React.createElement(Spinner);

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'section-toolbar' },
      React.createElement('span', { className: 'toolbar-title' }, `${categories.length} categories`),
      React.createElement('button', { className: 'btn btn-primary', onClick: () => { setEditTarget(null); setForm({ slug: '', display_name: '', bot_token: '', chat_id: '', ai_prompt: '', delivery_channel: 'telegram', whatsapp_delivery_jid: '' }); setShowAdd(true); } }, '+ New Category')
    ),

    React.createElement('div', { className: 'category-grid' },
      categories.map(cat =>
        React.createElement('div', { key: cat.id, className: `category-card ${cat.is_active ? 'active' : 'inactive'}` },
          React.createElement('div', { className: 'category-card-header' },
            React.createElement('div', { className: 'category-info' },
              React.createElement('h4', { className: 'category-name' }, cat.display_name),
              React.createElement('code', { className: 'category-slug' }, cat.slug)
            ),
            React.createElement(Toggle, {
              checked: !!cat.is_active,
              // FIX #1: calls toggle() which now uses PATCH /api/categories/:id (not /toggle)
              onChange: () => toggle(cat.id, !!cat.is_active),
              disabled: cat.slug === 'cc'
            })
          ),
          React.createElement('div', { className: 'category-meta' },
            React.createElement('span', { className: 'meta-item' }, cat.bot_token ? '✅ Bot token' : '⚠️ No bot token'),
            React.createElement('span', { className: 'meta-item' }, cat.chat_id ? '✅ Chat ID' : '⚠️ No chat ID'),
            React.createElement('span', { className: 'meta-item' }, `📡 ${cat.delivery_channel || 'telegram'}`)
          ),
          cat.ai_prompt && React.createElement('div', { className: 'category-prompt' },
            React.createElement('p', { className: 'prompt-preview' }, cat.ai_prompt.slice(0, 100) + (cat.ai_prompt.length > 100 ? '…' : ''))
          ),
          React.createElement('div', { className: 'category-actions' },
            React.createElement('button', { className: 'btn btn-sm btn-ghost', onClick: () => openEdit(cat) }, '✏️ Edit'),
            React.createElement('button', {
              className: 'btn btn-sm btn-secondary',
              onClick: () => test(cat.id),
              disabled: testing === cat.id || !cat.bot_token || !cat.chat_id
            }, testing === cat.id ? '⏳ Testing…' : '🧪 Test'),
            cat.slug !== 'cc' && cat.slug !== 'deals' &&
              React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(cat.id, cat.display_name, cat.slug) }, '🗑️ Delete')
          )
        )
      )
    ),

    React.createElement(Modal, {
      open: showAdd,
      title: editTarget ? `Edit: ${editTarget.display_name}` : 'New Category',
      onClose: () => { setShowAdd(false); setEditTarget(null); }
    },
      !editTarget && React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Slug (cannot be changed later)'),
        React.createElement('input', { className: 'input', placeholder: 'e.g. crypto', value: form.slug, onChange: e => setForm(f => ({ ...f, slug: e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, '') })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Display Name'),
        React.createElement('input', { className: 'input', placeholder: 'e.g. Crypto News', value: form.display_name, onChange: e => setForm(f => ({ ...f, display_name: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Telegram Bot Token'),
        React.createElement('input', { className: 'input', placeholder: '123456:ABC-DEF...', value: form.bot_token, onChange: e => setForm(f => ({ ...f, bot_token: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Telegram Chat ID'),
        React.createElement('input', { className: 'input', placeholder: '-1001234567890', value: form.chat_id, onChange: e => setForm(f => ({ ...f, chat_id: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Delivery Channel'),
        React.createElement('select', { className: 'input', value: form.delivery_channel, onChange: e => setForm(f => ({ ...f, delivery_channel: e.target.value })) },
          React.createElement('option', { value: 'telegram' }, 'Telegram'),
          React.createElement('option', { value: 'whatsapp' }, 'WhatsApp'),
          React.createElement('option', { value: 'both' }, 'Both')
        )
      ),
      (form.delivery_channel === 'whatsapp' || form.delivery_channel === 'both') &&
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { className: 'form-label' }, 'WhatsApp Delivery JID'),
          React.createElement('input', { className: 'input', placeholder: '120363xxxxxxxxxx@g.us', value: form.whatsapp_delivery_jid, onChange: e => setForm(f => ({ ...f, whatsapp_delivery_jid: e.target.value })) })
        ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'AI Prompt (optional)'),
        React.createElement('textarea', { className: 'input textarea', rows: 4, placeholder: 'Custom summarisation instructions for this category…', value: form.ai_prompt, onChange: e => setForm(f => ({ ...f, ai_prompt: e.target.value })) })
      ),
      React.createElement('div', { className: 'modal-actions' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => { setShowAdd(false); setEditTarget(null); } }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: save }, editTarget ? 'Save Changes' : 'Create Category')
      )
    )
  );
}

// ─── Section: Schedules ──────────────────────────────────────
function SchedulesSection() {
  const [schedules, setSchedules] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [triggering, setTriggering] = useState(null);
  const [form, setForm] = useState({ category_slug: '', cron_expression: '', label: '' });

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get('/api/schedules'), api.get('/api/categories')]);
      setSchedules(Array.isArray(s) ? s : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load schedules', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  // FIX #2: toggle schedule now calls PATCH /api/schedules/:id with {is_active}
  // instead of PATCH /api/schedules/:id/toggle, keeping all schedule mutations
  // through one route and matching how category toggle works.
  const toggle = async (id, current) => {
    const r = await api.patch(`/api/schedules/${id}`, { is_active: !current });
    if (r.success) {
      setSchedules(s => s.map(x => x.id === id ? { ...x, is_active: !current ? 1 : 0 } : x));
    } else {
      toast(r.error || 'Toggle failed', 'error');
    }
  };

  const del = async (id) => {
    if (!confirm('Delete this schedule rule?')) return;
    const r = await api.del(`/api/schedules/${id}`);
    if (r.success) { toast('Schedule deleted'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  // FIX #3: trigger now calls POST /api/schedules/trigger (canonical route)
  // instead of the legacy POST /api/trigger alias.
  const trigger = async (slug) => {
    setTriggering(slug || 'all');
    try {
      const r = await api.post('/api/schedules/trigger', { slug: slug || null });
      if (r.success) toast(r.message || 'Brief triggered!');
      else toast(r.error || 'Trigger failed', 'error');
    } catch (e) {
      toast('Trigger request failed', 'error');
    } finally {
      setTriggering(null);
    }
  };

  const add = async () => {
    if (!form.category_slug || !form.cron_expression || !form.label) {
      toast('All fields required', 'error'); return;
    }
    const r = await api.post('/api/schedules', form);
    if (r.success) { toast('Schedule added'); setShowAdd(false); setForm({ category_slug: '', cron_expression: '', label: '' }); load(); }
    else toast(r.error || 'Add failed', 'error');
  };

  if (loading) return React.createElement(Spinner);

  const grouped = {};
  schedules.forEach(s => {
    if (!grouped[s.category_slug]) grouped[s.category_slug] = [];
    grouped[s.category_slug].push(s);
  });

  return React.createElement('div', { className: 'section-content' },
    React.createElement('div', { className: 'section-toolbar' },
      React.createElement('span', { className: 'toolbar-title' }, `${schedules.length} schedule rules`),
      React.createElement('div', { className: 'toolbar-actions' },
        // FIX #3: trigger all now calls POST /api/schedules/trigger
        React.createElement('button', {
          className: 'btn btn-secondary',
          onClick: () => trigger(null),
          disabled: triggering === 'all'
        }, triggering === 'all' ? '⏳ Triggering…' : '⚡ Trigger All'),
        React.createElement('button', { className: 'btn btn-primary', onClick: () => setShowAdd(true) }, '+ Add Schedule')
      )
    ),

    Object.keys(grouped).length === 0
      ? React.createElement(EmptyState, { icon: '📅', message: 'No schedules configured', sub: 'Add schedule rules to automate brief delivery' })
      : Object.entries(grouped).map(([slug, rules]) => {
          const cat = categories.find(c => c.slug === slug);
          return React.createElement(Card, {
            key: slug,
            title: `📅 ${cat ? cat.display_name : slug}`,
            action: React.createElement('button', {
              className: 'btn btn-sm btn-secondary',
              // FIX #3: per-category trigger also uses POST /api/schedules/trigger
              onClick: () => trigger(slug),
              disabled: triggering === slug
            }, triggering === slug ? '⏳ Triggering…' : '⚡ Trigger Now')
          },
            React.createElement('div', { className: 'table-wrap' },
              React.createElement('table', { className: 'data-table' },
                React.createElement('thead', null,
                  React.createElement('tr', null,
                    ['Label', 'Cron', 'Active', 'Running', 'Actions'].map(h =>
                      React.createElement('th', { key: h }, h)
                    )
                  )
                ),
                React.createElement('tbody', null,
                  rules.map(rule =>
                    React.createElement('tr', { key: rule.id },
                      React.createElement('td', null, rule.label),
                      React.createElement('td', null, React.createElement('code', { className: 'cron-expr' }, rule.cron_expression)),
                      React.createElement('td', null,
                        // FIX #2: toggle() now sends to PATCH /api/schedules/:id
                        React.createElement(Toggle, { checked: !!rule.is_active, onChange: () => toggle(rule.id, !!rule.is_active) })
                      ),
                      React.createElement('td', null,
                        React.createElement(Badge, { label: rule.is_running ? 'Running' : 'Idle', variant: rule.is_running ? 'success' : 'default' })
                      ),
                      React.createElement('td', null,
                        React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(rule.id) }, 'Delete')
                      )
                    )
                  )
                )
              )
            )
          );
        }),

    React.createElement(Modal, { open: showAdd, title: 'Add Schedule Rule', onClose: () => setShowAdd(false) },
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Category'),
        React.createElement('select', { className: 'input', value: form.category_slug, onChange: e => setForm(f => ({ ...f, category_slug: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select category —'),
          categories.map(c => React.createElement('option', { key: c.slug, value: c.slug }, c.display_name))
        )
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Cron Expression'),
        React.createElement('input', { className: 'input', placeholder: '0 8 * * * (daily at 8 AM)', value: form.cron_expression, onChange: e => setForm(f => ({ ...f, cron_expression: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Label'),
        React.createElement('input', { className: 'input', placeholder: 'e.g. Daily Morning Brief', value: form.label, onChange: e => setForm(f => ({ ...f, label: e.target.value })) })
      ),
      React.createElement('div', { className: 'modal-actions' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => setShowAdd(false) }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Schedule')
      )
    )
  );
}

// ─── Section: Telegram Login ──────────────────────────────────
function TelegramSection() {
  const [status, setStatus] = useState(null);
  const [channels, setChannels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [step, setStep] = useState('idle'); // idle | phone | otp | done
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState('');
  const [password, setPassword] = useState('');

  const loadStatus = useCallback(async () => {
    try {
      const s = await api.get('/api/telegram/status');
      setStatus(s);
      if (s.isReady) setStep('done');
    } catch (e) { toast('Failed to load Telegram status', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { loadStatus(); }, [loadStatus]);

  const sendCode = async () => {
    if (!phone) { toast('Enter a phone number', 'error'); return; }
    const r = await api.post('/api/telegram/send-code', { phoneNumber: phone });
    if (r.success) { toast('OTP sent!'); setStep('otp'); }
    else toast(r.error || 'Failed to send code', 'error');
  };

  const submitCode = async () => {
    if (!otp) { toast('Enter the OTP', 'error'); return; }
    const r = await api.post('/api/telegram/submit-code', { code: otp, password: password || undefined });
    if (r.success) { toast('Logged in!'); setStep('done'); loadStatus(); }
    else toast(r.error || 'Login failed', 'error');
  };

  const logout = async () => {
    if (!confirm('Log out from Telegram user account?')) return;
    const r = await api.post('/api/telegram/logout', {});
    if (r.success) { toast('Logged out'); setStep('idle'); loadStatus(); }
    else toast(r.error || 'Logout failed', 'error');
  };

  const discover = async () => {
    setDiscovering(true);
    try {
      const ch = await api.get('/api/telegram/discover');
      setChannels(Array.isArray(ch) ? ch : []);
      if (!Array.isArray(ch) || ch.length === 0) toast('No channels found', 'error');
    } catch (e) { toast('Discovery failed', 'error'); }
    finally { setDiscovering(false); }
  };

  if (loading) return React.createElement(Spinner);

  return React.createElement('div', { className: 'section-content' },
    React.createElement(Card, { title: '🔐 Telegram User Session' },
      step === 'idle' && React.createElement('div', null,
        React.createElement('p', { className: 'text-muted mb-4' }, 'Log in with your Telegram user account to enable channel discovery and message ingestion.'),
        React.createElement('button', { className: 'btn btn-primary', onClick: () => setStep('phone') }, 'Login with Telegram')
      ),
      step === 'phone' && React.createElement('div', { className: 'login-form' },
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { className: 'form-label' }, 'Phone Number (with country code)'),
          React.createElement('input', { className: 'input', placeholder: '+919876543210', value: phone, onChange: e => setPhone(e.target.value) })
        ),
        React.createElement('div', { className: 'modal-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => setStep('idle') }, 'Back'),
          React.createElement('button', { className: 'btn btn-primary', onClick: sendCode }, 'Send OTP')
        )
      ),
      step === 'otp' && React.createElement('div', { className: 'login-form' },
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { className: 'form-label' }, 'OTP Code'),
          React.createElement('input', { className: 'input', placeholder: '12345', value: otp, onChange: e => setOtp(e.target.value) })
        ),
        React.createElement('div', { className: 'form-group' },
          React.createElement('label', { className: 'form-label' }, '2FA Password (if enabled)'),
          React.createElement('input', { className: 'input', type: 'password', placeholder: 'Leave blank if not set', value: password, onChange: e => setPassword(e.target.value) })
        ),
        React.createElement('div', { className: 'modal-actions' },
          React.createElement('button', { className: 'btn btn-ghost', onClick: () => setStep('phone') }, 'Back'),
          React.createElement('button', { className: 'btn btn-primary', onClick: submitCode }, 'Submit OTP')
        )
      ),
      step === 'done' && React.createElement('div', null,
        React.createElement('p', { className: 'text-success mb-4' }, '✅ Telegram user session is active.'),
        React.createElement('div', { className: 'modal-actions' },
          React.createElement('button', { className: 'btn btn-secondary', onClick: discover, disabled: discovering }, discovering ? '⏳ Discovering…' : '🔍 Discover Channels'),
          React.createElement('button', { className: 'btn btn-danger', onClick: logout }, 'Logout')
        )
      )
    ),

    channels.length > 0 && React.createElement(Card, { title: `📋 Subscribed Channels (${channels.length})` },
      React.createElement('div', { className: 'table-wrap' },
        React.createElement('table', { className: 'data-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['Title', 'Username', 'Type', 'Members'].map(h => React.createElement('th', { key: h }, h))
            )
          ),
          React.createElement('tbody', null,
            channels.map((ch, i) =>
              React.createElement('tr', { key: i },
                React.createElement('td', null, ch.title || ch.name || '—'),
                React.createElement('td', null, ch.username ? React.createElement('code', null, '@' + ch.username) : '—'),
                React.createElement('td', null, React.createElement(Badge, { label: ch.type || 'channel', variant: 'info' })),
                React.createElement('td', null, ch.participantsCount?.toLocaleString() || '—')
              )
            )
          )
        )
      )
    )
  );
}

// ─── Section: WhatsApp ────────────────────────────────────────
function WhatsAppSection() {
  const [groups, setGroups] = useState([]);
  const [sources, setSources] = useState([]);
  const [loading, setLoading] = useState(true);
  const [discovering, setDiscovering] = useState(false);
  const [showAdd, setShowAdd] = useState(false);
  const [form, setForm] = useState({ name: '', source_id: '', category_slug: '' });
  const [categories, setCategories] = useState([]);
  const [filter, setFilter] = useState('');

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get('/api/whatsapp/sources'), api.get('/api/categories')]);
      setSources(Array.isArray(s) ? s : []);
      setCategories(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load WhatsApp data', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const discover = async () => {
    setDiscovering(true);
    try {
      const g = await api.get('/api/whatsapp/discover');
      setGroups(Array.isArray(g) ? g : []);
      if (!Array.isArray(g) || g.length === 0) toast('No groups found — make sure WhatsApp is connected', 'error');
    } catch (e) { toast('Discovery failed', 'error'); }
    finally { setDiscovering(false); }
  };

  const add = async () => {
    if (!form.name || !form.source_id || !form.category_slug) { toast('All fields required', 'error'); return; }
    const r = await api.post('/api/whatsapp/sources', form);
    if (r.success) { toast('WhatsApp source added'); setShowAdd(false); setForm({ name: '', source_id: '', category_slug: '' }); load(); }
    else toast(r.error || 'Add failed', 'error');
  };

  const del = async (id) => {
    if (!confirm('Delete this WhatsApp source?')) return;
    const r = await api.del(`/api/whatsapp/sources/${id}`);
    if (r.success) { toast('Source deleted'); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  const addFromGroup = (g) => {
    setForm({ name: g.name || g.id, source_id: g.id, category_slug: '' });
    setShowAdd(true);
  };

  const filteredGroups = groups.filter(g => !filter || (g.name || '').toLowerCase().includes(filter.toLowerCase()));

  if (loading) return React.createElement(Spinner);

  return React.createElement('div', { className: 'section-content' },
    React.createElement(Card, { title: '💬 WhatsApp Sources',
      action: React.createElement('div', { className: 'card-actions' },
        React.createElement('button', { className: 'btn btn-sm btn-secondary', onClick: discover, disabled: discovering }, discovering ? '⏳ Discovering…' : '🔍 Discover Groups'),
        React.createElement('button', { className: 'btn btn-sm btn-primary', onClick: () => setShowAdd(true) }, '+ Add Source')
      )
    },
      sources.length === 0
        ? React.createElement(EmptyState, { icon: '💬', message: 'No WhatsApp sources', sub: 'Discover groups or add a JID manually' })
        : React.createElement('div', { className: 'table-wrap' },
            React.createElement('table', { className: 'data-table' },
              React.createElement('thead', null,
                React.createElement('tr', null,
                  ['Name', 'JID', 'Category', 'Actions'].map(h => React.createElement('th', { key: h }, h))
                )
              ),
              React.createElement('tbody', null,
                sources.map(s =>
                  React.createElement('tr', { key: s.id },
                    React.createElement('td', null, s.name),
                    React.createElement('td', null, React.createElement('code', { className: 'source-id' }, s.source_id)),
                    React.createElement('td', null, React.createElement(Badge, { label: s.type?.replace('-whatsapp', '') || '—', variant: 'info' })),
                    React.createElement('td', null,
                      React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => del(s.id) }, 'Delete')
                    )
                  )
                )
              )
            )
          )
    ),

    groups.length > 0 && React.createElement(Card, { title: '📋 Discovered Groups' },
      React.createElement('div', { className: 'section-toolbar' },
        React.createElement('input', {
          className: 'input search-input',
          placeholder: '🔍 Filter groups…',
          value: filter,
          onChange: e => setFilter(e.target.value),
        })
      ),
      React.createElement('div', { className: 'table-wrap' },
        React.createElement('table', { className: 'data-table' },
          React.createElement('thead', null,
            React.createElement('tr', null,
              ['Name', 'JID', 'Action'].map(h => React.createElement('th', { key: h }, h))
            )
          ),
          React.createElement('tbody', null,
            filteredGroups.map((g, i) =>
              React.createElement('tr', { key: i },
                React.createElement('td', null, g.name || '—'),
                React.createElement('td', null, React.createElement('code', { className: 'source-id' }, g.id)),
                React.createElement('td', null,
                  React.createElement('button', { className: 'btn btn-sm btn-primary', onClick: () => addFromGroup(g) }, '+ Add')
                )
              )
            )
          )
        )
      )
    ),

    React.createElement(Modal, { open: showAdd, title: 'Add WhatsApp Source', onClose: () => setShowAdd(false) },
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Name'),
        React.createElement('input', { className: 'input', placeholder: 'Group display name', value: form.name, onChange: e => setForm(f => ({ ...f, name: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'WhatsApp JID'),
        React.createElement('input', { className: 'input', placeholder: '120363xxxxxxxxxx@g.us', value: form.source_id, onChange: e => setForm(f => ({ ...f, source_id: e.target.value })) })
      ),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Category'),
        React.createElement('select', { className: 'input', value: form.category_slug, onChange: e => setForm(f => ({ ...f, category_slug: e.target.value })) },
          React.createElement('option', { value: '' }, '— Select category —'),
          categories.map(c => React.createElement('option', { key: c.slug, value: c.slug }, c.display_name))
        )
      ),
      React.createElement('div', { className: 'modal-actions' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => setShowAdd(false) }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: add }, 'Add Source')
      )
    )
  );
}

// ─── Section: Cookies ─────────────────────────────────────────
function CookiesSection() {
  const [cookieStatus, setCookieStatus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeImport, setActiveImport] = useState(null);
  const [cookieText, setCookieText] = useState('');
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      const c = await api.get('/api/cookies');
      setCookieStatus(Array.isArray(c) ? c : []);
    } catch (e) { toast('Failed to load cookie status', 'error'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  const importCookies = async () => {
    if (!cookieText.trim()) { toast('Paste cookie JSON first', 'error'); return; }
    setSaving(true);
    try {
      const r = await api.post('/api/cookies/import', { site: activeImport, cookies: cookieText.trim() });
      if (r.success) { toast(`Cookies saved for ${activeImport}`); setActiveImport(null); setCookieText(''); load(); }
      else toast(r.error || 'Save failed', 'error');
    } catch (e) { toast('Request failed', 'error'); }
    finally { setSaving(false); }
  };

  const deleteCookies = async (site) => {
    if (!confirm(`Delete cookies for ${site}?`)) return;
    const r = await api.post('/api/cookies/delete', { site });
    if (r.success) { toast(`Cookies deleted for ${site}`); load(); }
    else toast(r.error || 'Delete failed', 'error');
  };

  if (loading) return React.createElement(Spinner);

  const siteInfo = {
    youtube: { icon: '▶️', name: 'YouTube', hint: 'Paste cookies from youtube.com after login' },
    technofino: { icon: '🏦', name: 'TechnoFino', hint: 'Paste cookies from technofino.com after login' },
    desidime: { icon: '💰', name: 'DesiDime', hint: 'Paste cookies from desidime.com after login' },
    reddit: { icon: '🤖', name: 'Reddit', hint: 'Paste cookies from reddit.com after login' },
  };

  return React.createElement('div', { className: 'section-content' },
    React.createElement(Card, { title: '🔐 Session Cookies' },
      React.createElement('p', { className: 'text-muted mb-4' }, 'Session cookies allow scrapers to access authenticated content. Use the EditThisCookie browser extension to export cookies as JSON.'),
      React.createElement('div', { className: 'cookie-grid' },
        cookieStatus.map(item => {
          const info = siteInfo[item.site] || { icon: '🌐', name: item.site, hint: '' };
          return React.createElement('div', { key: item.site, className: `cookie-card ${item.has_cookies ? 'has-cookies' : ''}` },
            React.createElement('div', { className: 'cookie-icon' }, info.icon),
            React.createElement('div', { className: 'cookie-info' },
              React.createElement('div', { className: 'cookie-name' }, info.name),
              React.createElement('div', { className: 'cookie-status' },
                item.has_cookies
                  ? React.createElement('span', { className: 'text-success' }, `✅ Active${item.updated_at ? ' · ' + timeAgo(item.updated_at) : ''}`)
                  : React.createElement('span', { className: 'text-muted' }, '⚪ No cookies')
              )
            ),
            React.createElement('div', { className: 'cookie-actions' },
              React.createElement('button', { className: 'btn btn-sm btn-primary', onClick: () => { setActiveImport(item.site); setCookieText(''); } }, item.has_cookies ? '🔄 Update' : '+ Import'),
              item.has_cookies && React.createElement('button', { className: 'btn btn-sm btn-danger', onClick: () => deleteCookies(item.site) }, '🗑️')
            )
          );
        })
      )
    ),

    React.createElement(Modal, {
      open: !!activeImport,
      title: `Import cookies — ${siteInfo[activeImport]?.name || activeImport}`,
      onClose: () => setActiveImport(null)
    },
      React.createElement('p', { className: 'text-muted mb-4' }, siteInfo[activeImport]?.hint || ''),
      React.createElement('div', { className: 'form-group' },
        React.createElement('label', { className: 'form-label' }, 'Cookie JSON Array'),
        React.createElement('textarea', {
          className: 'input textarea',
          rows: 8,
          placeholder: '[{"name":"session","value":"...","domain":"..."}]',
          value: cookieText,
          onChange: e => setCookieText(e.target.value)
        })
      ),
      React.createElement('div', { className: 'modal-actions' },
        React.createElement('button', { className: 'btn btn-ghost', onClick: () => setActiveImport(null) }, 'Cancel'),
        React.createElement('button', { className: 'btn btn-primary', onClick: importCookies, disabled: saving }, saving ? '⏳ Saving…' : 'Import Cookies')
      )
    )
  );
}

// ─── App Shell ────────────────────────────────────────────────
const TABS = [
  { id: 'health',     label: '📊 Health',     Component: HealthSection },
  { id: 'categories', label: '📁 Categories', Component: CategoriesSection },
  { id: 'sources',    label: '📡 Sources',    Component: SourcesSection },
  { id: 'schedules',  label: '📅 Schedules',  Component: SchedulesSection },
  { id: 'telegram',   label: '✈️ Telegram',   Component: TelegramSection },
  { id: 'whatsapp',   label: '💬 WhatsApp',   Component: WhatsAppSection },
  { id: 'cookies',    label: '🍪 Cookies',    Component: CookiesSection },
];

function App() {
  const [activeTab, setActiveTab] = useState('health');
  const active = TABS.find(t => t.id === activeTab);

  return React.createElement('div', { className: 'app' },
    React.createElement('header', { className: 'app-header' },
      React.createElement('div', { className: 'header-brand' },
        React.createElement('span', { className: 'brand-icon' }, '🤖'),
        React.createElement('span', { className: 'brand-name' }, 'Brief Agent'),
        React.createElement('span', { className: 'brand-tag' }, 'Dashboard')
      ),
      React.createElement('nav', { className: 'header-nav' },
        TABS.map(t =>
          React.createElement('button', {
            key: t.id,
            className: `nav-tab ${activeTab === t.id ? 'active' : ''}`,
            onClick: () => setActiveTab(t.id)
          }, t.label)
        )
      )
    ),
    React.createElement('main', { className: 'app-main' },
      React.createElement('div', { className: 'section-header' },
        React.createElement('h2', { className: 'section-title' }, active?.label || '')
      ),
      active && React.createElement(active.Component)
    ),
    React.createElement(Toast)
  );
}

const root = createRoot(document.getElementById('root'));
root.render(React.createElement(App));
