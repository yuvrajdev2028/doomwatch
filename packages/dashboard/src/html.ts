/**
 * Doomwatch Dashboard HTML & Client-Side Application
 * Provides an interactive UI for exploring traces, waterfalls, and inspecting payloads.
 */

export const DASHBOARD_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Doomwatch | Observability Dashboard</title>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600;700&family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet">
  <style>
    :root {
      --bg-dark: #0a0d14;
      --bg-panel: #111522;
      --bg-card: #181d2f;
      --bg-card-hover: #1f253d;
      --border: #262c45;
      --border-focus: #3b82f6;
      --text-main: #f1f5f9;
      --text-muted: #94a3b8;
      --text-dim: #64748b;
      --primary: #3b82f6;
      --primary-hover: #2563eb;
      --accent: #8b5cf6;
      --success: #10b981;
      --warning: #f59e0b;
      --danger: #ef4444;
      --code-bg: #090c14;
    }

    * {
      box-sizing: border-box;
      margin: 0;
      padding: 0;
    }

    body {
      font-family: 'Plus Jakarta Sans', -apple-system, BlinkMacSystemFont, sans-serif;
      background-color: var(--bg-dark);
      color: var(--text-main);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      overflow-x: hidden;
    }

    code, pre {
      font-family: 'JetBrains Mono', monospace;
    }

    /* Header */
    header {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      justify-content: space-between;
      align-items: center;
      position: sticky;
      top: 0;
      z-index: 40;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 12px;
      text-decoration: none;
      color: var(--text-main);
    }

    .brand-icon {
      font-size: 24px;
      background: linear-gradient(135deg, #3b82f6, #8b5cf6);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
      display: flex;
      align-items: center;
    }

    .brand-title {
      font-size: 18px;
      font-weight: 800;
      letter-spacing: -0.5px;
      background: linear-gradient(to right, #60a5fa, #c084fc);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .brand-badge {
      font-size: 11px;
      font-weight: 600;
      padding: 2px 8px;
      background: rgba(59, 130, 246, 0.15);
      color: #60a5fa;
      border: 1px solid rgba(59, 130, 246, 0.3);
      border-radius: 999px;
    }

    .header-actions {
      display: flex;
      align-items: center;
      gap: 16px;
    }

    .status-pill {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      padding: 4px 10px;
      background: rgba(16, 185, 129, 0.1);
      color: var(--success);
      border: 1px solid rgba(16, 185, 129, 0.25);
      border-radius: 20px;
      font-weight: 500;
    }

    .pulse-dot {
      width: 8px;
      height: 8px;
      background-color: var(--success);
      border-radius: 50%;
      box-shadow: 0 0 8px var(--success);
      animation: pulse 2s infinite;
    }

    @keyframes pulse {
      0% { opacity: 1; transform: scale(1); }
      50% { opacity: 0.4; transform: scale(0.85); }
      100% { opacity: 1; transform: scale(1); }
    }

    .btn {
      background: var(--bg-card);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 6px 14px;
      border-radius: 6px;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: all 0.2s ease;
    }

    .btn:hover {
      background: var(--bg-card-hover);
      border-color: var(--border-focus);
    }

    .btn-primary {
      background: var(--primary);
      border-color: var(--primary);
      color: #fff;
    }

    .btn-primary:hover {
      background: var(--primary-hover);
      border-color: var(--primary-hover);
    }

    /* Filter Bar */
    .filter-bar {
      background: var(--bg-panel);
      border-bottom: 1px solid var(--border);
      padding: 12px 24px;
      display: flex;
      gap: 12px;
      flex-wrap: wrap;
      align-items: center;
    }

    .search-input, .select-input {
      background: var(--bg-dark);
      border: 1px solid var(--border);
      color: var(--text-main);
      padding: 6px 12px;
      border-radius: 6px;
      font-size: 13px;
      outline: none;
      transition: border-color 0.2s;
    }

    .search-input {
      flex: 1;
      min-width: 200px;
    }

    .search-input:focus, .select-input:focus {
      border-color: var(--primary);
    }

    .checkbox-label {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 13px;
      color: var(--text-muted);
      cursor: pointer;
      user-select: none;
    }

    /* Main Layout */
    .main-container {
      display: flex;
      flex: 1;
      height: calc(100vh - 110px);
      overflow: hidden;
    }

    /* Left: Traces List */
    .trace-list-panel {
      width: 420px;
      min-width: 340px;
      border-right: 1px solid var(--border);
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      background: var(--bg-dark);
    }

    .trace-item {
      padding: 14px 18px;
      border-bottom: 1px solid var(--border);
      cursor: pointer;
      transition: background 0.15s ease;
      position: relative;
    }

    .trace-item:hover {
      background: var(--bg-panel);
    }

    .trace-item.active {
      background: var(--bg-card);
      border-left: 4px solid var(--primary);
    }

    .trace-item-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 6px;
    }

    .trace-name {
      font-weight: 700;
      font-size: 14px;
      color: #fff;
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .badge {
      font-size: 11px;
      font-weight: 700;
      padding: 2px 6px;
      border-radius: 4px;
      text-transform: uppercase;
    }

    .badge-2xx { background: rgba(16, 185, 129, 0.15); color: #34d399; }
    .badge-4xx { background: rgba(245, 158, 11, 0.15); color: #fbbf24; }
    .badge-5xx { background: rgba(239, 68, 68, 0.15); color: #f87171; }

    .trace-meta {
      display: flex;
      align-items: center;
      gap: 12px;
      font-size: 12px;
      color: var(--text-dim);
      margin-top: 6px;
    }

    .service-tags {
      display: flex;
      gap: 6px;
      flex-wrap: wrap;
      margin-top: 8px;
    }

    .service-tag {
      font-size: 11px;
      padding: 2px 6px;
      background: rgba(255, 255, 255, 0.05);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      color: var(--text-muted);
    }

    /* Right: Waterfall Detail View */
    .detail-panel {
      flex: 1;
      overflow-y: auto;
      background: var(--bg-panel);
      display: flex;
      flex-direction: column;
    }

    .empty-placeholder {
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      height: 100%;
      color: var(--text-dim);
      gap: 12px;
    }

    .empty-icon {
      font-size: 48px;
      opacity: 0.5;
    }

    .detail-header {
      padding: 20px 24px;
      border-bottom: 1px solid var(--border);
      background: var(--bg-card);
    }

    .detail-header-top {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 10px;
    }

    .trace-id-display {
      font-size: 12px;
      color: var(--text-muted);
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .trace-id-code {
      background: var(--code-bg);
      padding: 3px 8px;
      border-radius: 4px;
      border: 1px solid var(--border);
      color: #60a5fa;
    }

    .copy-btn {
      background: none;
      border: none;
      color: var(--text-dim);
      cursor: pointer;
      font-size: 12px;
    }

    .copy-btn:hover {
      color: var(--text-main);
    }

    .detail-stats {
      display: flex;
      gap: 20px;
      margin-top: 12px;
    }

    .stat-card {
      background: var(--bg-panel);
      border: 1px solid var(--border);
      padding: 8px 14px;
      border-radius: 6px;
    }

    .stat-label {
      font-size: 11px;
      color: var(--text-dim);
      text-transform: uppercase;
      font-weight: 600;
    }

    .stat-value {
      font-size: 16px;
      font-weight: 700;
      color: var(--text-main);
      margin-top: 2px;
    }

    /* Waterfall Chart */
    .waterfall-container {
      padding: 24px;
      flex: 1;
    }

    .timeline-axis {
      display: flex;
      justify-content: space-between;
      border-bottom: 1px solid var(--border);
      padding-bottom: 8px;
      margin-bottom: 12px;
      font-size: 11px;
      color: var(--text-dim);
      margin-left: 280px;
    }

    .waterfall-row {
      display: flex;
      align-items: center;
      padding: 6px 0;
      border-bottom: 1px solid rgba(255, 255, 255, 0.03);
      cursor: pointer;
      border-radius: 4px;
      transition: background 0.1s ease;
    }

    .waterfall-row:hover {
      background: rgba(255, 255, 255, 0.04);
    }

    .span-label-col {
      width: 280px;
      min-width: 280px;
      display: flex;
      align-items: center;
      gap: 8px;
      padding-right: 12px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }

    .tree-branch {
      color: var(--text-dim);
      font-size: 12px;
      user-select: none;
    }

    .span-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--text-main);
      overflow: hidden;
      text-overflow: ellipsis;
    }

    .span-timeline-col {
      flex: 1;
      position: relative;
      height: 26px;
      display: flex;
      align-items: center;
    }

    .timeline-bar-wrapper {
      position: absolute;
      height: 18px;
      display: flex;
      align-items: center;
      border-radius: 4px;
      box-shadow: 0 1px 3px rgba(0,0,0,0.3);
      transition: transform 0.1s ease;
    }

    .timeline-bar-wrapper:hover {
      transform: scaleY(1.15);
      z-index: 10;
    }

    .bar-duration-label {
      position: absolute;
      left: calc(100% + 6px);
      font-size: 11px;
      color: var(--text-muted);
      font-weight: 600;
      white-space: nowrap;
    }

    /* Span Details Drawer */
    .drawer-overlay {
      position: fixed;
      top: 0;
      left: 0;
      width: 100vw;
      height: 100vh;
      background: rgba(0, 0, 0, 0.6);
      backdrop-filter: blur(2px);
      z-index: 50;
      display: none;
    }

    .drawer {
      position: fixed;
      top: 0;
      right: 0;
      width: 620px;
      max-width: 90vw;
      height: 100vh;
      background: var(--bg-panel);
      border-left: 1px solid var(--border);
      z-index: 51;
      box-shadow: -10px 0 30px rgba(0,0,0,0.5);
      display: flex;
      flex-direction: column;
      transform: translateX(100%);
      transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);
    }

    .drawer.open {
      transform: translateX(0);
    }

    .drawer-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--border);
      display: flex;
      justify-content: space-between;
      align-items: center;
      background: var(--bg-card);
    }

    .drawer-title {
      font-size: 16px;
      font-weight: 700;
    }

    .drawer-close {
      background: none;
      border: none;
      font-size: 20px;
      color: var(--text-muted);
      cursor: pointer;
    }

    .drawer-body {
      padding: 20px;
      overflow-y: auto;
      flex: 1;
      display: flex;
      flex-direction: column;
      gap: 20px;
    }

    .drawer-section {
      background: var(--bg-card);
      border: 1px solid var(--border);
      border-radius: 8px;
      padding: 16px;
    }

    .drawer-section-title {
      font-size: 13px;
      font-weight: 700;
      color: var(--text-muted);
      text-transform: uppercase;
      letter-spacing: 0.5px;
      margin-bottom: 12px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }

    .info-grid {
      display: grid;
      grid-template-columns: 140px 1fr;
      gap: 10px 14px;
      font-size: 13px;
    }

    .info-label {
      color: var(--text-dim);
      font-weight: 500;
    }

    .info-value {
      color: var(--text-main);
      word-break: break-all;
    }

    .json-code {
      background: var(--code-bg);
      border: 1px solid var(--border);
      border-radius: 6px;
      padding: 12px;
      font-size: 12px;
      color: #cbd5e1;
      overflow-x: auto;
      max-height: 250px;
    }

    .error-box {
      background: rgba(239, 68, 68, 0.1);
      border: 1px solid rgba(239, 68, 68, 0.3);
      color: #fca5a5;
      padding: 12px;
      border-radius: 6px;
      font-size: 12px;
    }

    /* Service Color Generator */
    .svc-color-0 { background: #3b82f6; }
    .svc-color-1 { background: #8b5cf6; }
    .svc-color-2 { background: #10b981; }
    .svc-color-3 { background: #ec4899; }
    .svc-color-4 { background: #f59e0b; }
    .svc-color-5 { background: #06b6d4; }
  </style>
</head>
<body>

  <!-- Top Header -->
  <header>
    <a href="/" class="brand">
      <div class="brand-icon">👁️</div>
      <div class="brand-title">DOOMWATCH</div>
      <span class="brand-badge">OBSERVABILITY</span>
    </a>
    <div class="header-actions">
      <div id="collector-status" class="status-pill">
        <span class="pulse-dot"></span>
        <span id="status-text">Collector Live</span>
      </div>
      <button id="refresh-btn" class="btn btn-primary" onclick="loadTraces()">
        🔄 Refresh
      </button>
    </div>
  </header>

  <!-- Filter Bar -->
  <div class="filter-bar">
    <input type="text" id="search-input" class="search-input" placeholder="Search by Trace ID or Span Name..." oninput="handleSearch()">
    
    <select id="service-select" class="select-input" onchange="handleFilterChange()">
      <option value="">All Services</option>
    </select>

    <select id="status-select" class="select-input" onchange="handleFilterChange()">
      <option value="">All Statuses</option>
      <option value="2xx">2xx Success</option>
      <option value="4xx">4xx Client Error</option>
      <option value="5xx">5xx Server Error</option>
    </select>

    <label class="checkbox-label">
      <input type="checkbox" id="errors-only-cb" onchange="handleFilterChange()">
      Errors Only
    </label>

    <label class="checkbox-label">
      <input type="checkbox" id="auto-refresh-cb" checked onchange="toggleAutoRefresh(this.checked)">
      Live Polling (3s)
    </label>
  </div>

  <!-- Main Split Layout -->
  <div class="main-container">
    <!-- Left: Trace List -->
    <div class="trace-list-panel" id="trace-list">
      <!-- Trace Items Injected Here -->
    </div>

    <!-- Right: Trace Details & Waterfall -->
    <div class="detail-panel" id="detail-panel">
      <div class="empty-placeholder">
        <div class="empty-icon">📊</div>
        <h3>Select a trace to inspect waterfall</h3>
        <p>Real-time distributed traces will appear as requests flow through your services.</p>
      </div>
    </div>
  </div>

  <!-- Span Detail Drawer -->
  <div class="drawer-overlay" id="drawer-overlay" onclick="closeDrawer()"></div>
  <div class="drawer" id="span-drawer">
    <div class="drawer-header">
      <div class="drawer-title" id="drawer-span-name">Span Details</div>
      <button class="drawer-close" onclick="closeDrawer()">&times;</button>
    </div>
    <div class="drawer-body" id="drawer-content">
      <!-- Span inspection injected here -->
    </div>
  </div>

  <script>
    let traces = [];
    let activeTrace = null;
    let autoRefreshTimer = null;
    let serviceColorMap = new Map();

    const SERVICE_COLORS = [
      '#3b82f6', '#8b5cf6', '#10b981', '#ec4899', '#f59e0b', '#06b6d4', '#6366f1'
    ];

    function getServiceColor(serviceName) {
      if (!serviceColorMap.has(serviceName)) {
        const color = SERVICE_COLORS[serviceColorMap.size % SERVICE_COLORS.length];
        serviceColorMap.set(serviceName, color);
      }
      return serviceColorMap.get(serviceName);
    }

    async function checkHealth() {
      try {
        const res = await fetch('/health');
        if (res.ok) {
          const data = await res.json();
          document.getElementById('status-text').innerText = \`Collector Live (\${data.storage})\`;
        }
      } catch (err) {
        document.getElementById('collector-status').style.borderColor = 'rgba(239, 68, 68, 0.4)';
        document.getElementById('status-text').innerText = 'Collector Offline';
        document.getElementById('status-text').style.color = '#f87171';
      }
    }

    async function loadTraces() {
      try {
        const params = new URLSearchParams();
        const service = document.getElementById('service-select').value;
        const errorsOnly = document.getElementById('errors-only-cb').checked;

        if (service) params.set('service', service);
        if (errorsOnly) params.set('has_error', 'true');

        const res = await fetch(\`/v1/traces?\${params.toString()}\`);
        if (!res.ok) return;

        const data = await res.json();
        traces = data.traces || [];
        populateServiceFilter(traces);
        renderTraceList();
      } catch (e) {
        console.error('Failed to load traces:', e);
      }
    }

    function populateServiceFilter(traceList) {
      const select = document.getElementById('service-select');
      const current = select.value;
      const services = new Set();
      traceList.forEach(t => (t.service_names || []).forEach(s => services.add(s)));

      select.innerHTML = '<option value="">All Services</option>';
      services.forEach(s => {
        const opt = document.createElement('option');
        opt.value = s;
        opt.innerText = s;
        if (s === current) opt.selected = true;
        select.appendChild(opt);
      });
    }

    function renderTraceList() {
      const listEl = document.getElementById('trace-list');
      const query = document.getElementById('search-input').value.trim().toLowerCase();
      const statusFilter = document.getElementById('status-select').value;

      let filtered = traces;
      if (query) {
        filtered = filtered.filter(t => 
          t.trace_id.toLowerCase().includes(query) || 
          (t.root_span_name && t.root_span_name.toLowerCase().includes(query))
        );
      }
      if (statusFilter === '2xx') {
        filtered = filtered.filter(t => t.status_code && t.status_code >= 200 && t.status_code < 300);
      } else if (statusFilter === '4xx') {
        filtered = filtered.filter(t => t.status_code && t.status_code >= 400 && t.status_code < 500);
      } else if (statusFilter === '5xx') {
        filtered = filtered.filter(t => t.has_error || (t.status_code && t.status_code >= 500));
      }

      if (filtered.length === 0) {
        listEl.innerHTML = '<div style="padding: 24px; text-align: center; color: var(--text-dim);">No traces found</div>';
        return;
      }

      listEl.innerHTML = filtered.map(t => {
        const isActive = activeTrace && activeTrace.trace_id === t.trace_id;
        const statusClass = t.has_error || (t.status_code >= 500) ? 'badge-5xx' : (t.status_code >= 400 ? 'badge-4xx' : 'badge-2xx');
        const statusLabel = t.status_code || (t.has_error ? 'ERROR' : 'OK');
        const timeAgo = formatTimeAgo(t.start_time_unix_ms);

        return \`
          <div class="trace-item \${isActive ? 'active' : ''}" onclick="selectTrace('\${t.trace_id}')">
            <div class="trace-item-header">
              <div class="trace-name">
                <span>\${escapeHtml(t.root_span_name || 'root')}</span>
                <span class="badge \${statusClass}">\${statusLabel}</span>
              </div>
              <span style="font-weight: 700; color: #60a5fa; font-size: 13px;">\${t.total_duration_ms}ms</span>
            </div>
            <div class="service-tags">
              \${(t.service_names || []).map(s => \`
                <span class="service-tag" style="border-left: 3px solid \${getServiceColor(s)};">
                  \${escapeHtml(s)}
                </span>
              \`).join('')}
            </div>
            <div class="trace-meta">
              <span>\${t.span_count} spans</span>
              <span>•</span>
              <span>\${timeAgo}</span>
            </div>
          </div>
        \`;
      }).join('');
    }

    async function selectTrace(traceId) {
      try {
        const res = await fetch(\`/v1/traces/\${traceId}\`);
        if (!res.ok) return;
        activeTrace = await res.json();
        renderTraceList();
        renderWaterfall(activeTrace);
      } catch (e) {
        console.error('Failed to load trace detail:', e);
      }
    }

    function renderWaterfall(trace) {
      const panel = document.getElementById('detail-panel');
      const rootStart = trace.start_time_unix_ms;
      const totalDuration = Math.max(1, trace.total_duration_ms);

      // Build tree nodes with depth
      const spanMap = new Map();
      trace.spans.forEach(s => spanMap.set(s.span_id, { ...s, children: [] }));

      const roots = [];
      spanMap.forEach(s => {
        if (s.parent_span_id && spanMap.has(s.parent_span_id)) {
          spanMap.get(s.parent_span_id).children.push(s);
        } else {
          roots.push(s);
        }
      });

      // Flatten tree chronologically preserving depth
      const flattened = [];
      function traverse(node, depth = 0) {
        flattened.push({ ...node, depth });
        node.children.sort((a, b) => a.start_time_unix_ms - b.start_time_unix_ms);
        node.children.forEach(child => traverse(child, depth + 1));
      }
      roots.forEach(r => traverse(r, 0));

      const statusBadge = trace.has_error ? '<span class="badge badge-5xx">FAILED</span>' : '<span class="badge badge-2xx">SUCCESS</span>';

      panel.innerHTML = \`
        <div class="detail-header">
          <div class="detail-header-top">
            <div>
              <h2 style="font-size: 20px; font-weight: 800; display: flex; align-items: center; gap: 10px;">
                \${escapeHtml(trace.root_span_name || 'Trace Waterfall')}
                \${statusBadge}
              </h2>
              <div class="trace-id-display" style="margin-top: 6px;">
                Trace ID: <code class="trace-id-code">\${trace.trace_id}</code>
                <button class="copy-btn" onclick="copyToClipboard('\${trace.trace_id}')">📋 Copy</button>
              </div>
            </div>
          </div>
          <div class="detail-stats">
            <div class="stat-card">
              <div class="stat-label">Total Latency</div>
              <div class="stat-value">\${trace.total_duration_ms}ms</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Total Spans</div>
              <div class="stat-value">\${trace.span_count}</div>
            </div>
            <div class="stat-card">
              <div class="stat-label">Services Traversed</div>
              <div class="stat-value">\${(trace.service_names || []).length}</div>
            </div>
          </div>
        </div>

        <div class="waterfall-container">
          <div class="timeline-axis">
            <span>0ms</span>
            <span>\${Math.round(totalDuration * 0.25)}ms</span>
            <span>\${Math.round(totalDuration * 0.50)}ms</span>
            <span>\${Math.round(totalDuration * 0.75)}ms</span>
            <span>\${totalDuration}ms</span>
          </div>

          \${flattened.map((span, idx) => {
            const offsetMs = Math.max(0, span.start_time_unix_ms - rootStart);
            const leftPercent = Math.min(96, (offsetMs / totalDuration) * 100);
            const widthPercent = Math.max(2, (Math.max(1, span.duration_ms) / totalDuration) * 100);
            const color = getServiceColor(span.service_name);
            const isError = span.error || (span.http?.status_code >= 400);

            return \`
              <div class="waterfall-row" onclick="openSpanDrawer('\${span.span_id}')">
                <div class="span-label-col" style="padding-left: \${span.depth * 18}px;">
                  <span class="tree-branch">\${span.depth > 0 ? '└──' : '•'}</span>
                  <span class="badge" style="background: \${color}22; color: \${color}; border: 1px solid \${color}44;">
                    \${escapeHtml(span.service_name)}
                  </span>
                  <span class="span-name" title="\${escapeHtml(span.name)}">\${escapeHtml(span.name)}</span>
                </div>
                <div class="span-timeline-col">
                  <div class="timeline-bar-wrapper" style="left: \${leftPercent}%; width: \${widthPercent}%; background: \${isError ? '#ef4444' : color};">
                    <span class="bar-duration-label">\${span.duration_ms}ms</span>
                  </div>
                </div>
              </div>
            \`;
          }).join('')}
        </div>
      \`;
    }

    function openSpanDrawer(spanId) {
      if (!activeTrace) return;
      const span = activeTrace.spans.find(s => s.span_id === spanId);
      if (!span) return;

      document.getElementById('drawer-span-name').innerText = span.name;
      const color = getServiceColor(span.service_name);

      let contentHtml = \`
        <div class="drawer-section">
          <div class="drawer-section-title">Overview</div>
          <div class="info-grid">
            <div class="info-label">Service:</div>
            <div class="info-value"><span class="badge" style="background: \${color}22; color: \${color};">\${escapeHtml(span.service_name)}</span></div>
            <div class="info-label">Kind:</div>
            <div class="info-value"><code>\${span.span_kind}</code></div>
            <div class="info-label">Duration:</div>
            <div class="info-value" style="font-weight: 700; color: #60a5fa;">\${span.duration_ms}ms</div>
            <div class="info-label">Span ID:</div>
            <div class="info-value"><code>\${span.span_id}</code></div>
            <div class="info-label">Parent Span ID:</div>
            <div class="info-value"><code>\${span.parent_span_id || 'null (Root)'}</code></div>
            <div class="info-label">Runtime:</div>
            <div class="info-value">\${escapeHtml(span.runtime || 'unknown')}</div>
          </div>
        </div>
      \`;

      if (span.error) {
        contentHtml += \`
          <div class="drawer-section">
            <div class="drawer-section-title" style="color: #f87171;">Error Details</div>
            <div class="error-box">
              <strong>\${escapeHtml(span.error.name)}:</strong> \${escapeHtml(span.error.message)}
              \${span.error.stack ? \`<pre style="margin-top: 8px; font-size: 11px;">\${escapeHtml(span.error.stack)}</pre>\` : ''}
            </div>
          </div>
        \`;
      }

      if (span.http) {
        contentHtml += \`
          <div class="drawer-section">
            <div class="drawer-section-title">HTTP Attributes</div>
            <div class="info-grid">
              <div class="info-label">Method & Route:</div>
              <div class="info-value"><code>\${span.http.method} \${escapeHtml(span.http.route || span.http.url)}</code></div>
              <div class="info-label">Status Code:</div>
              <div class="info-value"><span class="badge \${span.http.status_code >= 400 ? 'badge-5xx' : 'badge-2xx'}">\${span.http.status_code || 'N/A'}</span></div>
              <div class="info-label">Full URL:</div>
              <div class="info-value"><code>\${escapeHtml(span.http.url)}</code></div>
            </div>
          </div>
        \`;

        if (span.http.request_body) {
          contentHtml += \`
            <div class="drawer-section">
              <div class="drawer-section-title">Request Payload</div>
              <pre class="json-code">\${escapeHtml(JSON.stringify(span.http.request_body, null, 2))}</pre>
            </div>
          \`;
        }

        if (span.http.response_body) {
          contentHtml += \`
            <div class="drawer-section">
              <div class="drawer-section-title">Response Payload</div>
              <pre class="json-code">\${escapeHtml(JSON.stringify(span.http.response_body, null, 2))}</pre>
            </div>
          \`;
        }
      }

      document.getElementById('drawer-content').innerHTML = contentHtml;
      document.getElementById('drawer-overlay').style.display = 'block';
      document.getElementById('span-drawer').classList.add('open');
    }

    function closeDrawer() {
      document.getElementById('drawer-overlay').style.display = 'none';
      document.getElementById('span-drawer').classList.remove('open');
    }

    function toggleAutoRefresh(enabled) {
      if (autoRefreshTimer) clearInterval(autoRefreshTimer);
      if (enabled) {
        autoRefreshTimer = setInterval(() => {
          loadTraces();
          checkHealth();
        }, 3000);
      }
    }

    function handleSearch() { renderTraceList(); }
    function handleFilterChange() { loadTraces(); }

    function formatTimeAgo(timestamp) {
      const seconds = Math.floor((Date.now() - timestamp) / 1000);
      if (seconds < 5) return 'just now';
      if (seconds < 60) return \`\${seconds}s ago\`;
      const minutes = Math.floor(seconds / 60);
      if (minutes < 60) return \`\${minutes}m ago\`;
      const hours = Math.floor(minutes / 60);
      return \`\${hours}h ago\`;
    }

    function copyToClipboard(text) {
      navigator.clipboard.writeText(text);
      alert('Trace ID copied to clipboard: ' + text);
    }

    function escapeHtml(str) {
      if (!str) return '';
      return String(str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    // Initial load
    checkHealth();
    loadTraces();
    toggleAutoRefresh(true);
  </script>
</body>
</html>
`;
