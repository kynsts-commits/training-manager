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

  function mount() {
    const input = $('foodSearchInput');
    const searchRow = input?.closest('.search-row');
    if (!input || !searchRow || $('nutritionWebBox')) return;

    const box = document.createElement('div');
    box.id = 'nutritionWebBox';
    box.innerHTML = `
      <div class="nutrition-web-actions">
        <button id="nutritionWebBtn" class="ghost-btn" type="button">Webから栄養素を探す</button>
        <span class="helper">無料・API課金なし。メーカー公式など公開ページを優先して探します。</span>
      </div>
      <div id="nutritionWebStatus" class="helper" aria-live="polite"></div>
      <div id="nutritionWebResults" class="search-results"></div>`;
    searchRow.insertAdjacentElement('afterend', box);

    $('nutritionWebBtn').addEventListener('click', () => lookup(input.value.trim() || $('foodName')?.value.trim() || ''));

    input.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.shiftKey) {
        e.preventDefault();
        lookup(input.value.trim());
      }
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
    const btn = e.target.closest('[data-web-nutrition]');
    if (btn) useCandidate(Number(btn.dataset.webNutrition));
  });

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();