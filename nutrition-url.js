(() => {
  'use strict';
  const cfg=window.APP_CONFIG||{};
  if(!cfg.SUPABASE_URL||!cfg.SUPABASE_ANON_KEY||!window.supabase)return;
  const sb=window.supabase.createClient(cfg.SUPABASE_URL,cfg.SUPABASE_ANON_KEY);
  const $=id=>document.getElementById(id);
  const fmt=v=>(v===null||v===undefined||v==='')?'—':Number(v).toFixed(Number(v)%1?1:0);

  function mount(){
    const host=$('nutritionWebBox');
    if(!host||$('nutritionUrlBox'))return;
    const box=document.createElement('div');
    box.id='nutritionUrlBox';
    box.className='import-box';
    box.style.marginTop='12px';
    box.innerHTML=`<div class="panel-head"><div><strong>Web検索で商品ページが見つかった場合</strong><p>商品・メーカーのページURLを貼ると、掲載されている栄養成分を読み取ります。</p></div></div>
      <div class="search-row"><input id="nutritionPageUrl" type="url" inputmode="url" placeholder="https://… 商品ページのURLを貼り付け" /><button id="nutritionUrlReadBtn" class="ghost-btn" type="button">このページから取得</button></div>
      <div id="nutritionUrlStatus" class="helper" aria-live="polite"></div>
      <div id="nutritionUrlResult" class="search-results"></div>`;
    host.appendChild(box);
    $('nutritionUrlReadBtn').addEventListener('click',readUrl);
  }

  async function readUrl(){
    const url=String($('nutritionPageUrl')?.value||'').trim();
    const status=$('nutritionUrlStatus');
    const result=$('nutritionUrlResult');
    if(!/^https:\/\//i.test(url)){status.textContent='商品ページのhttps://から始まるURLを貼り付けてください。';return;}
    const btn=$('nutritionUrlReadBtn');btn.disabled=true;status.textContent='ページから栄養成分を読み取っています…';result.innerHTML='';
    try{
      const {data,error}=await sb.functions.invoke('nutrition-search',{body:{url}});
      if(error)throw error;
      const c=Array.isArray(data?.candidates)?data.candidates[0]:null;
      if(!c){status.textContent='このページから栄養成分を自動取得できませんでした。栄養成分が掲載された商品詳細ページを貼ってください。';return;}
      status.textContent='栄養成分を取得しました。単位と数値を確認してください。';
      result.innerHTML=`<div class="search-card nutrition-web-card"><div><strong>${escapeHtml(c.title||c.domain||'栄養成分')}</strong><small>${escapeHtml(c.domain||'')} / ${escapeHtml(c.basis||'掲載単位')}<br>${fmt(c.kcal)}kcal　P ${fmt(c.protein)}g　F ${fmt(c.fat)}g　C ${fmt(c.carbs)}g</small><a class="nutrition-source-link" href="${escapeHtml(c.url||url)}" target="_blank" rel="noopener noreferrer">出典ページを確認</a></div><button id="useNutritionUrl" class="primary-btn" type="button">この内容を反映</button></div>`;
      $('useNutritionUrl').addEventListener('click',()=>apply(c));
    }catch(e){console.error(e);status.textContent='ページを読み取れませんでした。別の商品詳細ページで試してください。';}
    finally{btn.disabled=false;}
  }

  function apply(c){
    const q=String($('foodSearchInput')?.value||'').trim();
    if($('foodName')&&!$('foodName').value.trim()&&q)$('foodName').value=q;
    if($('foodKcal')&&c.kcal!=null)$('foodKcal').value=c.kcal;
    if($('foodProtein')&&c.protein!=null)$('foodProtein').value=c.protein;
    if($('foodFat')&&c.fat!=null)$('foodFat').value=c.fat;
    if($('foodCarbs')&&c.carbs!=null)$('foodCarbs').value=c.carbs;
    const grams=String(c.basis||'').match(/([0-9]+(?:\.[0-9]+)?)\s*g/i);
    if(grams&&$('foodAmount'))$('foodAmount').value=grams[1];
    if($('foodNote'))$('foodNote').value=`Web取得 / ${c.basis||'掲載単位'} / ${c.domain||'出典ページ'}`;
    $('nutritionUrlStatus').textContent='食事入力欄へ反映しました。数値と単位を確認して保存してください。';
    $('foodName')?.scrollIntoView({behavior:'smooth',block:'center'});
  }
  function escapeHtml(v){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
  const timer=setInterval(()=>{mount();if($('nutritionUrlBox'))clearInterval(timer)},250);
  setTimeout(()=>clearInterval(timer),10000);
})();