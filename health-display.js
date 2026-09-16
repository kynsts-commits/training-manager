(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) return;

  const client = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const today = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  };

  function ensurePanel() {
    const page = document.getElementById('page-health');
    if (!page) return null;
    let panel = document.getElementById('appleHealthLivePanel');
    if (panel) return panel;
    panel = document.createElement('article');
    panel.id = 'appleHealthLivePanel';
    panel.className = 'panel';
    page.prepend(panel);
    return panel;
  }

  async function renderAppleHealth() {
    const panel = ensurePanel();
    if (!panel) return;
    panel.innerHTML = '<div class="panel-head"><div><h3>Apple Health</h3><p>歩数・安静時消費・アクティブ消費の最新データ</p></div></div><div class="list-empty">読み込み中…</div>';

    try {
      const { data: authData } = await client.auth.getSession();
      const user = authData?.session?.user;
      if (!user) {
        panel.innerHTML = '<div class="panel-head"><div><h3>Apple Health</h3><p>ログイン後に表示されます。</p></div></div>';
        return;
      }

      const { data, error } = await client
        .from('health_daily')
        .select('id,health_date,steps,resting_kcal,active_kcal,total_kcal,source,updated_at')
        .eq('user_id', user.id)
        .order('health_date', { ascending: false })
        .limit(90);
      if (error) throw error;

      const rows = data || [];
      const current = rows.find(r => r.health_date === today()) || null;
      const latest = rows[0] || null;
      const shown = current || latest;

      let summary = '';
      if (shown) {
        const total = num(shown.total_kcal) || num(shown.resting_kcal) + num(shown.active_kcal);
        const title = current ? '今日のApple Health' : `最新のApple Health（${esc(shown.health_date)}）`;
        const note = current ? '' : '<p class="helper" style="margin-top:8px">今日分はまだ取り込まれていません。</p>';
        summary = `
          <div class="panel-head"><div><h3>${title}</h3><p>食事登録の有無に関係なく表示します。</p></div></div>
          <div class="metric-grid">
            <div class="metric-card"><span>歩数</span><strong>${Math.round(num(shown.steps)).toLocaleString()}</strong><small>歩</small></div>
            <div class="metric-card"><span>安静時消費</span><strong>${Math.round(num(shown.resting_kcal)).toLocaleString()}</strong><small>kcal</small></div>
            <div class="metric-card"><span>アクティブ消費</span><strong>${Math.round(num(shown.active_kcal)).toLocaleString()}</strong><small>kcal</small></div>
            <div class="metric-card"><span>総消費</span><strong>${Math.round(total).toLocaleString()}</strong><small>kcal</small></div>
          </div>${note}`;
      } else {
        summary = '<div class="panel-head"><div><h3>今日のApple Health</h3><p>まだデータがありません。</p></div></div>';
      }

      const history = rows.length ? `
        <div class="panel-head" style="margin-top:18px"><div><h3>Apple Health履歴</h3><p>直近90件</p></div></div>
        <div class="table-scroll"><table><thead><tr><th>日付</th><th>歩数</th><th>安静時</th><th>アクティブ</th><th>総消費</th></tr></thead><tbody>
          ${rows.map(r => {
            const total = num(r.total_kcal) || num(r.resting_kcal) + num(r.active_kcal);
            return `<tr><td>${esc(r.health_date)}</td><td>${Math.round(num(r.steps)).toLocaleString()}</td><td>${Math.round(num(r.resting_kcal)).toLocaleString()}</td><td>${Math.round(num(r.active_kcal)).toLocaleString()}</td><td>${Math.round(total).toLocaleString()}</td></tr>`;
          }).join('')}
        </tbody></table></div>` : '';

      panel.innerHTML = summary + history;
    } catch (e) {
      panel.innerHTML = '<div class="panel-head"><div><h3>Apple Health</h3><p>データを読み込めませんでした。画面を再読み込みしてください。</p></div></div>';
    }
  }

  document.addEventListener('click', e => {
    const nav = e.target.closest('[data-page="health"]');
    if (nav) setTimeout(renderAppleHealth, 250);
  });
  window.addEventListener('focus', () => {
    if (document.getElementById('page-health')?.classList.contains('active')) renderAppleHealth();
  });
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden && document.getElementById('page-health')?.classList.contains('active')) renderAppleHealth();
  });
  setTimeout(renderAppleHealth, 900);
})();
