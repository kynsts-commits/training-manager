(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  if (!cfg.SUPABASE_URL || !cfg.SUPABASE_ANON_KEY || !window.supabase) return;

  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY);
  const $ = id => document.getElementById(id);
  const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt = v => (v === null || v === undefined || v === '') ? '—' : Number(v).toFixed(Number(v) % 1 ? 1 : 0);
  let searching = false;
  let lastAutoQuery = '';
  let historyRows = [];

  function mount() {
    const input = $('foodSearchInput');
    const searchRow = input?.closest('.search-row');
    if (!input || !searchRow || $('nutritionWebBox')) return;

    const history = document.createElement('div');
    history.id = 'foodHistorySearchBox';
    history.innerHTML = `
      <div id="foodHistorySearchStatus" class="helper" aria-live="polite"></div>
      <div id="foodHistorySearchResults" class="search-results"></div>`;
    searchRow.insertAdjacentElement('afterend', history);

    const box = document.createElement('div');
    box.id = 'nutritionWebBox';
    box.innerHTML = `
      <div class="nutrition-web-actions">
        <button id="nutritionWebBtn" class="ghost-btn" type="button">Webから栄養素を探す</button>
        <span class="helper">無料・API課金なし。メーカー公式など公開ページを優先して探します。</span>
      </div>
      <div id="nutritionWebStatus" class="helper" aria-live="polite"></div>
      <div id="nutritionWebResults" class="search-results"></div>`;
    history.insertAdjacentElement('afterend', box);

    $('nutritionWebBtn').addEventListener('click', () => lookup(input.value.trim() || $('foodName')?.value.trim() || ''));

    $('foodSearchBtn')?.addEventListener('click', () => searchHistory(input.value.trim()));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') searchHistory(input.value.trim());
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        lookup(input.value.trim());
      }
    });

    let debounce;
    input.addEventListener('input', () => {
      clearTimeout(debounce);
      const q = input.value.trim();
      if (q.length < 2) {
        historyRows = [];
        if ($('foodHistorySearchStatus')) $('foodHistorySearchStatus').textContent = '';
        if ($('foodHistorySearchResults')) $('foodHistorySearchResults').innerHTML = '';
        return;
      }
      debounce = setTimeout(() => searchHistory(q), 280);
    });

    const offStatus = $('foodSearchStatus');
    if (offStatus) {
      const observer = new MutationObserver(() => {
        const text = offStatus.textContent || '';
        const q = input.value.trim();
        if (q && q !== lastAutoQuery && /見つかりませんでした/.test(text)) {
          lastAutoQuery = q;
          lookup(q, true);
        }
      });
      observer.observe(offStatus, {childList:true, subtree:true, characterData:true});
    }
  }

  async function searchHistory(q) {
    q = String(q || '').trim();
    const status = $('foodHistorySearchStatus');
    const results = $('foodHistorySearchResults');
    if (!status || !results) return;
    if (q.length < 2) {
      status.textContent = '';
      results.innerHTML = '';
      return;
    }

    try {
      const { data: auth } = await sb.auth.getSession();
      const user = auth?.session?.user;
      if (!user) return;
      const safe = q.replace(/[%_,()]/g, ' ').replace(/\s+/g, ' ').trim();
      if (!safe) return;
      const { data, error } = await sb
        .from('food_logs')
        .select('id,eaten_date,meal_type,food_name,amount_g,kcal,protein_g,fat_g,carbs_g,note,source,barcode')
        .eq('user_id', user.id)
        .ilike('food_name', `%${safe}%`)
        .order('eaten_date', { ascending: false })
        .limit(30);
      if (error) throw error;

      const unique = [];
      const seen = new Set();
      for (const row of data || []) {
        const key = String(row.food_name || '').trim().toLocaleLowerCase('ja');
        if (!key || seen.has(key)) continue;
        seen.add(key);
        unique.push(row);
        if (unique.length >= 8) break;
      }
      historyRows = unique;

      if (!unique.length) {
        status.textContent = '';
        results.innerHTML = '';
        return;
      }
      status.innerHTML = `<strong>過去に登録した商品 ${unique.length}件</strong> — 選択すると前回の栄養成分をそのまま使えます。`;
      results.innerHTML = unique.map((r, i) => `
        <div class="search-card">
          <div>
            <strong>${esc(r.food_name)}</strong>
            <small>前回 ${esc(r.eaten_date)} / ${fmt(r.amount_g)}g<br>${fmt(r.kcal)}kcal　P ${fmt(r.protein_g)}g　F ${fmt(r.fat_g)}g　C ${fmt(r.carbs_g)}g</small>
          </div>
          <button class="ghost-btn" type="button" data-history-food="${i}">選択</button>
        </div>`).join('');
    } catch (e) {
      console.error(e);
      status.textContent = '';
      results.innerHTML = '';
    }
  }

  function useHistory(index) {
    const r = historyRows[index];
    if (!r) return;
    if ($('foodName')) $('foodName').value = r.food_name || '';
    if ($('foodAmount')) $('foodAmount').value = Number(r.amount_g) || 100;
    if ($('foodKcal')) $('foodKcal').value = Number(r.kcal) || 0;
    if ($('foodProtein')) $('foodProtein').value = Number(r.protein_g) || 0;
    if ($('foodFat')) $('foodFat').value = Number(r.fat_g) || 0;
    if ($('foodCarbs')) $('foodCarbs').value = Number(r.carbs_g) || 0;
    if ($('foodNote')) $('foodNote').value = r.note || '';
    if ($('barcodeInput') && r.barcode) $('barcodeInput').value = r.barcode;

    const amount = $('foodAmount');
    if (amount) {
      const base = Number(r.amount_g) || 100;
      amount.dataset.nutritionBaseAmount = String(base);
      amount.dataset.nutritionBaseKcal = String(Number(r.kcal) || 0);
      amount.dataset.nutritionBaseProtein = String(Number(r.protein_g) || 0);
      amount.dataset.nutritionBaseFat = String(Number(r.fat_g) || 0);
      amount.dataset.nutritionBaseCarbs = String(Number(r.carbs_g) || 0);
    }
    const status = $('foodHistorySearchStatus');
    if (status) status.textContent = '過去の登録内容を入力しました。摂取量を変更すると栄養素も自動計算されます。';
    $('foodName')?.scrollIntoView({behavior:'smooth', block:'center'});
  }

  async function lookup(q, automatic = false) {
    q = String(q || '').trim();
    if (q.length < 2) {
      $('nutritionWebStatus').textContent = '商品名を2文字以上入力してください。';
      return;
    }
    if (searching) return;
    searching = true;
    const btn = $('nutritionWebBtn');
    const status = $('nutritionWebStatus');
    const results = $('nutritionWebResults');
    if (btn) btn.disabled = true;
    status.textContent = automatic ? '商品データベースで見つからなかったため、Webから探しています…' : 'Webから栄養成分を探しています…';
    results.innerHTML = '';

    try {
      const { data, error } = await sb.functions.invoke('nutrition-search', { body: { q } });
      if (error) throw error;
      const candidates = Array.isArray(data?.candidates) ? data.candidates : [];
      if (!candidates.length) {
        const google = `https://www.google.com/search?q=${encodeURIComponent(q + ' 栄養成分 カロリー たんぱく質 脂質 炭水化物')}`;
        status.textContent = '自動取得できるページが見つかりませんでした。商品名を詳しくするか、通常のWeb検索で確認できます。';
        results.innerHTML = `<div class="notice"><strong>候補なし</strong><span>メーカー名・容量まで入れると見つかりやすくなります。</span><a class="ghost-btn nutrition-source-link" href="${google}" target="_blank" rel="noopener noreferrer">Web検索を開く</a></div>`;
        return;
      }

      status.textContent = `${candidates.length}件の候補を取得しました。単位と出典を確認して選んでください。`;
      results.innerHTML = candidates.map((c, i) => `
        <div class="search-card nutrition-web-card">
          <div>
            <strong>${esc(c.title || c.domain || '栄養成分')}</strong>
            <small>${esc(c.domain || '')}${c.basis ? ` / ${esc(c.basis)}` : ' / 掲載単位'}<br>
              ${fmt(c.kcal)}kcal　P ${fmt(c.protein)}g　F ${fmt(c.fat)}g　C ${fmt(c.carbs)}g
            </small>
            <a class="nutrition-source-link" href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">出典ページを確認</a>
          </div>
          <button class="ghost-btn" type="button" data-web-nutrition="${i}">この内容を使う</button>
        </div>`).join('');
      results._nutritionCandidates = candidates;
      results._nutritionQuery = q;
    } catch (e) {
      console.error(e);
      status.textContent = 'Web検索に失敗しました。少し時間を置いて再試行してください。';
    } finally {
      searching = false;
      if (btn) btn.disabled = false;
    }
  }

  function useCandidate(index) {
    const results = $('nutritionWebResults');
    const c = results?._nutritionCandidates?.[index];
    if (!c) return;
    const q = results._nutritionQuery || $('foodSearchInput')?.value.trim() || '';

    if ($('foodName') && !$('foodName').value.trim()) $('foodName').value = q;
    if ($('foodKcal') && c.kcal !== null && c.kcal !== undefined) $('foodKcal').value = c.kcal;
    if ($('foodProtein') && c.protein !== null && c.protein !== undefined) $('foodProtein').value = c.protein;
    if ($('foodFat') && c.fat !== null && c.fat !== undefined) $('foodFat').value = c.fat;
    if ($('foodCarbs') && c.carbs !== null && c.carbs !== undefined) $('foodCarbs').value = c.carbs;

    const grams = String(c.basis || '').match(/([0-9]+(?:\.[0-9]+)?)\s*g/i);
    if (grams && $('foodAmount')) $('foodAmount').value = grams[1];

    if ($('foodNote')) {
      const basis = c.basis || '掲載単位';
      $('foodNote').value = `Web取得 / ${basis} / ${c.domain || '出典確認済み'}`;
    }

    const status = $('nutritionWebStatus');
    if (status) status.textContent = '栄養素を入力しました。出典・単位を確認してから保存してください。';
    $('foodName')?.scrollIntoView({behavior:'smooth', block:'center'});
  }

  document.addEventListener('click', e => {
    const historyBtn = e.target.closest('[data-history-food]');
    if (historyBtn) {
      useHistory(Number(historyBtn.dataset.historyFood));
      return;
    }
    const btn = e.target.closest('[data-web-nutrition]');
    if (btn) useCandidate(Number(btn.dataset.webNutrition));
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();