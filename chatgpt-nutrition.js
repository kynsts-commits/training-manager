(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const val = id => $(id)?.value.trim() || '';

  function mount() {
    const anchor = $('foodSearchResults');
    if (!anchor || $('chatgptNutritionBox')) return;

    const box = document.createElement('div');
    box.id = 'chatgptNutritionBox';
    box.className = 'import-box';
    box.style.margin = '14px 0 18px';
    box.innerHTML = `
      <div class="panel-head"><div><h3>ChatGPTで栄養素を調べる</h3><p>商品データベースにない商品の補助。検索結果は項目別に取り込めます。</p></div></div>
      <div class="search-row">
        <button id="openChatGptNutrition" class="ghost-btn" type="button">ChatGPTで検索</button>
      </div>
      <details style="margin-top:10px" open>
        <summary>ChatGPTの結果を貼り付け</summary>
        <textarea id="chatgptNutritionPaste" rows="8" placeholder="ChatGPTで表示された7項目をまとめてコピーして、ここに貼り付け"></textarea>
        <button id="parseChatgptNutrition" class="ghost-btn" type="button">項目ごとに分ける</button>
        <p id="chatgptNutritionStatus" class="helper"></p>
        <div class="form-grid" style="margin-top:10px">
          <label class="wide">商品名<input id="cgName" type="text"></label>
          <label>基準量<input id="cgBasis" type="text" placeholder="例：1個 113g"></label>
          <label>カロリー (kcal)<input id="cgKcal" type="number" step="0.1" min="0"></label>
          <label>たんぱく質 P (g)<input id="cgProtein" type="number" step="0.1" min="0"></label>
          <label>脂質 F (g)<input id="cgFat" type="number" step="0.1" min="0"></label>
          <label>炭水化物 C (g)<input id="cgCarbs" type="number" step="0.1" min="0"></label>
          <label class="wide">出典URL<input id="cgSource" type="url" inputmode="url"></label>
          <div class="form-actions"><button id="applyChatgptNutrition" class="primary-btn" type="button">食事入力欄に反映</button></div>
        </div>
      </details>`;
    anchor.insertAdjacentElement('afterend', box);

    $('openChatGptNutrition').addEventListener('click', openChatGPT);
    $('parseChatgptNutrition').addEventListener('click', parsePaste);
    $('applyChatgptNutrition').addEventListener('click', apply);
  }

  function openChatGPT() {
    const q = val('foodSearchInput') || val('foodName');
    if (!q) {
      $('chatgptNutritionStatus').textContent = '先に商品名を入力してください。';
      return;
    }
    const prompt = `「${q}」の栄養成分をWeb検索してください。メーカー・販売元の公式情報を最優先し、見つからなければ信頼できる商品情報を使ってください。別商品や別容量と混同しないでください。回答の最後に、コピーしやすいよう必ず次の7項目だけを1項目1行で出してください。数値には単位を付けても構いません。\n商品名: \n基準量: \nkcal: \nP: \nF: \nC: \n出典URL: `;
    window.open(`https://chatgpt.com/?q=${encodeURIComponent(prompt)}`, '_blank', 'noopener,noreferrer');
  }

  function numberOf(s) {
    const m = String(s || '').replace(/,/g, '').match(/\d+(?:\.\d+)?/);
    return m ? m[0] : '';
  }

  function parsePaste() {
    const text = val('chatgptNutritionPaste');
    if (!text) return;
    const lines = text.split(/\r?\n/).map(x => x.trim()).filter(Boolean);
    const pick = patterns => {
      const line = lines.find(l => patterns.some(p => p.test(l)));
      return line ? line.replace(/^[^:：]+[:：]\s*/, '').trim() : '';
    };
    const set = (id, v) => { if ($(id) && v) $(id).value = v; };
    set('cgName', pick([/^商品名\s*[:：]/i]));
    set('cgBasis', pick([/^基準量\s*[:：]/i, /^単位\s*[:：]/i]));
    set('cgKcal', numberOf(pick([/^kcal\s*[:：]/i, /^カロリー\s*[:：]/i, /^エネルギー\s*[:：]/i])));
    set('cgProtein', numberOf(pick([/^P\s*[:：]/i, /^たんぱく質\s*[:：]/i, /^タンパク質\s*[:：]/i])));
    set('cgFat', numberOf(pick([/^F\s*[:：]/i, /^脂質\s*[:：]/i])));
    set('cgCarbs', numberOf(pick([/^C\s*[:：]/i, /^炭水化物\s*[:：]/i])));
    set('cgSource', pick([/^出典URL\s*[:：]/i, /^URL\s*[:：]/i, /^出典\s*[:：]/i]).match(/https?:\/\/\S+/)?.[0] || '');
    $('chatgptNutritionStatus').textContent = '項目ごとに分けました。内容を確認して「食事入力欄に反映」を押してください。';
  }

  function apply() {
    const set = (id, v) => { if ($(id) && v !== '') $(id).value = v; };
    set('foodName', val('cgName') || val('foodSearchInput'));
    set('foodKcal', val('cgKcal'));
    set('foodProtein', val('cgProtein'));
    set('foodFat', val('cgFat'));
    set('foodCarbs', val('cgCarbs'));
    const basis = val('cgBasis');
    const grams = basis.match(/(\d+(?:\.\d+)?)\s*g/i);
    if (grams) set('foodAmount', grams[1]);
    const source = val('cgSource');
    if ($('foodNote')) $('foodNote').value = ['ChatGPT Web検索', basis, source].filter(Boolean).join(' / ');
    $('chatgptNutritionStatus').textContent = '食事入力欄に反映しました。商品・基準量・栄養成分を確認して保存してください。';
    $('foodName')?.scrollIntoView({behavior:'smooth', block:'center'});
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mount);
  else mount();
})();