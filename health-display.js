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

/* collapsible-left-navigation */
(() => {
  'use strict';
  function initSidebar(){
    const app=document.getElementById('appView');
    const sidebar=app?.querySelector('.sidebar');
    if(!app||!sidebar||document.getElementById('sidebarMenuToggle'))return;

    if(!document.querySelector('link[data-sidebar-css]')){
      const link=document.createElement('link');
      link.rel='stylesheet';
      link.href='./sidebar.css';
      link.dataset.sidebarCss='1';
      document.head.appendChild(link);
    }

    const toggle=document.createElement('button');
    toggle.id='sidebarMenuToggle';
    toggle.className='sidebar-menu-toggle';
    toggle.type='button';
    toggle.setAttribute('aria-label','メニューを開閉');
    toggle.setAttribute('aria-controls','nav');

    const overlay=document.createElement('div');
    overlay.className='sidebar-overlay';
    overlay.setAttribute('aria-hidden','true');
    app.appendChild(toggle);
    app.appendChild(overlay);

    const mobile=()=>window.matchMedia('(max-width:980px)').matches;
    const setOpen=(open,remember=true)=>{
      app.classList.toggle('sidebar-open',open);
      toggle.setAttribute('aria-expanded',String(open));
      toggle.textContent=open?'×':'☰';
      if(remember&&!mobile())localStorage.setItem('tm-sidebar-open',open?'1':'0');
    };

    const saved=localStorage.getItem('tm-sidebar-open');
    setOpen(mobile()?false:saved!=='0',false);
    toggle.addEventListener('click',()=>setOpen(!app.classList.contains('sidebar-open')));
    overlay.addEventListener('click',()=>setOpen(false,false));
    sidebar.addEventListener('click',e=>{
      if(mobile()&&e.target.closest('[data-page]'))setOpen(false,false);
    });

    let wasMobile=mobile();
    window.addEventListener('resize',()=>{
      const nowMobile=mobile();
      if(nowMobile!==wasMobile){
        wasMobile=nowMobile;
        const stored=localStorage.getItem('tm-sidebar-open');
        setOpen(nowMobile?false:stored!=='0',false);
      }
    });
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',()=>setTimeout(initSidebar,0));
  else setTimeout(initSidebar,0);
})();

/* chatgpt-body-photo-import */
(() => {
  'use strict';
  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) return;
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const STORAGE_KEY = 'tm-body-chatgpt-import-token';
  let polling = false;

  function statusEl(){ return document.getElementById('bodyChatgptImportStatus'); }

  function mount(){
    const page = document.getElementById('page-body');
    const panel = page?.querySelector('.panel');
    const details = panel?.querySelector('.import-box');
    if(!panel || !details || document.getElementById('bodyChatgptPhotoBtn')) return;

    const wrap = document.createElement('div');
    wrap.className = 'import-box';
    wrap.style.marginBottom = '14px';
    wrap.innerHTML = `
      <div class="panel-head" style="margin-bottom:8px"><div><h3>写真から自動登録</h3><p>ChatGPTに体組成計の写真を送り、Training Managerへ直接反映します。</p></div></div>
      <button id="bodyChatgptPhotoBtn" class="primary-btn" type="button">ChatGPTで写真から登録</button>
      <p id="bodyChatgptImportStatus" class="helper" aria-live="polite">写真を送ったあとTraining Managerへ戻ると、登録結果を自動確認します。</p>`;
    details.insertAdjacentElement('beforebegin', wrap);
    document.getElementById('bodyChatgptPhotoBtn').addEventListener('click', startImport);
    checkPending();
  }

  async function startImport(){
    const btn = document.getElementById('bodyChatgptPhotoBtn');
    const status = statusEl();
    try{
      btn.disabled = true;
      status.textContent = 'ChatGPT連携を準備しています…';
      const {data:{session}} = await sb.auth.getSession();
      if(!session?.user) throw new Error('ログインが必要です');

      const token = crypto.randomUUID();
      const {error} = await sb.from('body_import_requests').insert({token,user_id:session.user.id,status:'waiting'});
      if(error) throw error;
      localStorage.setItem(STORAGE_KEY, token);

      const prompt = `Training Managerの体組成写真登録です。次のメッセージで体組成計の結果写真を送ります。写真を受け取るまではデータベース操作をしないでください。\n\n写真を受け取ったら、画像に表示されている数値を読み取り、インストール済みのSupabaseプラグインを使って project_id「gdfhiikjiajudqxujozp」に保存してください。確認質問は不要です。\n\nインポートトークン: ${token}\n\n手順:\n1. public.body_import_requests から token='${token}' かつ status='waiting' かつ expires_at>now() の1行を取得する。該当がなければ重複登録せず、その旨を伝える。\n2. その行の user_id を使い、public.body_composition に1件INSERTする。\n3. 写真から読み取れる項目を以下へ対応させる。不明な項目はNULL。\n measured_at=測定日, measured_time=測定時刻, weight_kg=体重, body_fat_pct=体脂肪率, muscle_mass_kg=筋肉量, bone_mass_kg=推定骨量, visceral_fat_level=内臓脂肪レベル, bmr_kcal=基礎代謝量, body_water_pct=体水分率, body_age=体内年齢, fat_mass_kg=脂肪量, lean_mass_kg=除脂肪量, bmi=BMI。\n4. 写真にfat_mass_kgがなくweight_kgとbody_fat_pctがある場合は weight_kg*body_fat_pct/100 で計算する。lean_mass_kgがなければ weight_kg-fat_mass_kg で計算する。BMIがなく身長情報も写真にない場合はNULL。\n5. INSERT成功後、public.body_import_requests の同じtokenの行を status='ready' に更新する。\n6. 最後に、保存した主要数値を短く表示して「Training Managerに反映しました」と伝える。\n\n写真が複数枚ある場合は同一測定の補足情報として統合し、body_compositionへのINSERTは1件だけにしてください。`;

      try { await navigator.clipboard.writeText(prompt); } catch {}
      status.textContent = 'ChatGPTを開きます。体組成計の写真を送ってください。';
      const url = `https://chatgpt.com/?q=${encodeURIComponent(prompt)}`;
      window.open(url, '_blank', 'noopener,noreferrer');
    }catch(e){
      console.error(e);
      status.textContent = `準備に失敗しました：${e.message || '再度お試しください'}`;
    }finally{
      btn.disabled = false;
    }
  }

  async function checkPending(){
    if(polling) return;
    const token = localStorage.getItem(STORAGE_KEY);
    if(!token) return;
    polling = true;
    try{
      const {data,error} = await sb.from('body_import_requests')
        .select('status,error_message,expires_at')
        .eq('token',token)
        .maybeSingle();
      if(error) throw error;
      if(!data){ localStorage.removeItem(STORAGE_KEY); return; }
      if(data.status === 'ready'){
        localStorage.removeItem(STORAGE_KEY);
        statusEl() && (statusEl().textContent = 'ChatGPTから体組成を反映しました。更新しています…');
        await sb.from('body_import_requests').delete().eq('token',token);
        setTimeout(()=>location.reload(),500);
        return;
      }
      if(data.status === 'error'){
        localStorage.removeItem(STORAGE_KEY);
        statusEl() && (statusEl().textContent = `ChatGPT連携エラー：${data.error_message || '読み取りに失敗しました'}`);
        return;
      }
      if(new Date(data.expires_at).getTime() < Date.now()){
        localStorage.removeItem(STORAGE_KEY);
        statusEl() && (statusEl().textContent = '連携の有効時間が切れました。もう一度ボタンから開始してください。');
        return;
      }
      statusEl() && (statusEl().textContent = 'ChatGPTの写真読み取り・登録を待っています…');
    }catch(e){ console.error(e); }
    finally{ polling = false; }
  }

  document.addEventListener('click',e=>{
    if(e.target.closest('[data-page="body"]')) setTimeout(()=>{mount();checkPending();},250);
  });
  window.addEventListener('focus',()=>setTimeout(checkPending,250));
  document.addEventListener('visibilitychange',()=>{ if(!document.hidden)setTimeout(checkPending,250); });
  setInterval(()=>{ if(!document.hidden)checkPending(); },5000);

  if(document.readyState==='loading') document.addEventListener('DOMContentLoaded',()=>setTimeout(mount,500));
  else setTimeout(mount,500);
})();
