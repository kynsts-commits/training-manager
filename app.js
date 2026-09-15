(() => {
  'use strict';

  const cfg = window.APP_CONFIG || {};
  const hasSupabaseConfig = Boolean(cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase);
  const sb = hasSupabaseConfig ? window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY) : null;
  const DEMO_KEY = 'training-manager-free-v2';
  const OLD_DEMO_KEY = 'training-manager-free-v1';

  const $ = (id) => document.getElementById(id);
  const today = () => localDateString(new Date());

  let authMode = 'login';
  let currentUser = null;
  let state = emptyState();
  let charts = {};
  let barcodeScanner = null;
  let currentPer100 = null;
  const round1 = (n) => Number.isFinite(Number(n)) ? Math.round(Number(n) * 10) / 10 : 0;
  const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`);
  const esc = (v) => String(v ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
  const fmt = (v) => (v === null || v === undefined || v === '') ? '--' : round1(v);

  function localDateString(d) {
    return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  }
  function parseDate(s) {
    if (!s) return null;
    const [y,m,d] = s.split('-').map(Number);
    if (!y || !m || !d) return null;
    return new Date(y,m-1,d,12,0,0,0);
  }
  function dateDaysAgo(days) {
    const d = new Date(); d.setHours(12,0,0,0); d.setDate(d.getDate()-days); return d;
  }
  function emptyState() {
    return {
      profile: {
        name:'', height:168, goalWeight:75, goalKcal:2200, goalP:160, goalF:60, goalC:250,
        trackingStartDate: today(), fallbackExpenditure: 2400, timezone:'Asia/Tokyo',
        notificationsEnabled:false, shareCode:'', shortcutKey:''
      },
      body: [], training: [], cardio: [], food: [], health: [], partnerPermissions: [], partnerProfiles: []
    };
  }
  function normalizeState(raw) {
    const base = emptyState();
    const r = raw || {};
    return {
      ...base,
      ...r,
      profile: {...base.profile, ...(r.profile || {})},
      body: Array.isArray(r.body) ? r.body : [],
      training: Array.isArray(r.training) ? r.training : [],
      cardio: Array.isArray(r.cardio) ? r.cardio : [],
      food: Array.isArray(r.food) ? r.food : [],
      health: Array.isArray(r.health) ? r.health : [],
      partnerPermissions: Array.isArray(r.partnerPermissions) ? r.partnerPermissions : [],
      partnerProfiles: Array.isArray(r.partnerProfiles) ? r.partnerProfiles : []
    };
  }
  function mine(list) {
    if (!hasSupabaseConfig) return list || [];
    return (list || []).filter(r => String(r.userId) === String(currentUser?.id));
  }
  function partnerId() {
    if (!hasSupabaseConfig || !currentUser) return null;
    const p = state.partnerPermissions.find(x => String(x.ownerUserId) === String(currentUser.id));
    return p?.partnerUserId || null;
  }
  function partnerRows(list) {
    const pid = partnerId();
    return pid ? (list || []).filter(r => String(r.userId) === String(pid)) : [];
  }

  function showToast(message) {
    const el = $('toast'); el.textContent = message; el.classList.add('show');
    clearTimeout(showToast.t); showToast.t = setTimeout(() => el.classList.remove('show'), 2400);
  }
  function showApp() {
    $('authView').classList.add('hidden'); $('appView').classList.remove('hidden');
    $('accountBadge').textContent = hasSupabaseConfig ? 'Cloud' : 'Demo';
    $('clearDemoBtn').classList.toggle('hidden', hasSupabaseConfig);
    setDefaults(); renderAll();
  }
  function showAuth() {
    $('appView').classList.add('hidden'); $('authView').classList.remove('hidden');
    $('supabaseAuth').classList.toggle('hidden', !hasSupabaseConfig);
    $('demoAuth').classList.toggle('hidden', hasSupabaseConfig);
  }
  function setDefaults() {
    ['bodyDate','trainingDate','cardioDate','foodDate','healthDate'].forEach(id => { if (!$(id).value) $(id).value = today(); });
    const now = new Date();
    if (!$('bodyTime').value) $('bodyTime').value = `${String(now.getHours()).padStart(2,'0')}:${String(now.getMinutes()).padStart(2,'0')}`;
    syncSettingsForm(); updateBodyComputed(); updateTrainingComputed(); updateHealthComputed(); renderTrainingSuggestionPreview();
  }

  function localSave() { localStorage.setItem(DEMO_KEY, JSON.stringify(state)); }
  function localLoad() {
    try {
      const current = localStorage.getItem(DEMO_KEY);
      const legacy = localStorage.getItem(OLD_DEMO_KEY);
      state = normalizeState(JSON.parse(current || legacy || 'null'));
      if (!current && legacy) localSave();
    } catch { state = emptyState(); }
  }

  async function cloudLoad() {
    const [profilesRes, bodyRes, trainingRes, cardioRes, foodRes, healthRes, permsRes] = await Promise.all([
      sb.from('profiles').select('*'),
      sb.from('body_composition').select('*').order('measured_at', {ascending:false}),
      sb.from('training_logs').select('*').order('training_date', {ascending:false}),
      sb.from('cardio_logs').select('*').order('cardio_date', {ascending:false}),
      sb.from('food_logs').select('*').order('eaten_date', {ascending:false}),
      sb.from('health_daily').select('*').order('health_date', {ascending:false}),
      sb.from('partner_permissions').select('*')
    ]);
    const critical = [profilesRes, bodyRes, trainingRes, cardioRes, foodRes, healthRes, permsRes].find(r => r.error);
    if (critical) throw critical.error;
    state = emptyState();
    const profiles = profilesRes.data || [];
    const own = profiles.find(p => String(p.user_id) === String(currentUser.id));
    if (own) state.profile = {
      ...state.profile,
      name: own.display_name || '', height: own.height_cm || 168, goalWeight: own.goal_weight_kg || 75,
      goalKcal: own.goal_kcal || 2200, goalP: own.goal_protein_g || 160, goalF: own.goal_fat_g || 60,
      goalC: own.goal_carbs_g || 250, trackingStartDate: own.tracking_start_date || today(),
      fallbackExpenditure: own.fallback_expenditure_kcal || 2400, timezone: own.timezone || 'Asia/Tokyo',
      notificationsEnabled: Boolean(own.notifications_enabled), shareCode: own.share_code || '', shortcutKey: own.shortcut_key || ''
    };
    state.partnerProfiles = profiles.filter(p => String(p.user_id) !== String(currentUser.id)).map(p => ({
      userId:p.user_id,name:p.display_name || 'パートナー',shareCode:p.share_code || ''
    }));
    state.body = (bodyRes.data || []).map(r => ({
      id:r.id,userId:r.user_id,date:r.measured_at,time:r.measured_time || '',weight:r.weight_kg,fat:r.body_fat_pct,
      muscle:r.muscle_mass_kg,bone:r.bone_mass_kg,visceral:r.visceral_fat_level,bmr:r.bmr_kcal,water:r.body_water_pct,
      bodyAge:r.body_age,fatMass:r.fat_mass_kg,lean:r.lean_mass_kg,bmi:r.bmi
    }));
    state.training = (trainingRes.data || []).map(r => ({
      id:r.id,userId:r.user_id,date:r.training_date,part:r.body_part,exercise:r.exercise_name,weight:r.weight_kg,reps:r.reps,
      sets:r.sets,rpe:r.rpe,volume:r.volume_kg,oneRm:r.estimated_1rm,note:r.note || ''
    }));
    state.cardio = (cardioRes.data || []).map(r => ({
      id:r.id,userId:r.user_id,date:r.cardio_date,exercise:r.exercise_name,incline:r.incline_pct,duration:r.duration_minutes,
      calories:r.calories_kcal,note:r.note || '',source:r.source || 'manual',externalId:r.external_id || ''
    }));
    state.food = (foodRes.data || []).map(r => ({
      id:r.id,userId:r.user_id,date:r.eaten_date,meal:r.meal_type,name:r.food_name,amount:r.amount_g,kcal:r.kcal,
      protein:r.protein_g,fat:r.fat_g,carbs:r.carbs_g,note:r.note || '',source:r.source || 'manual',barcode:r.barcode || ''
    }));
    state.health = (healthRes.data || []).map(r => ({
      id:r.id,userId:r.user_id,date:r.health_date,steps:r.steps,resting:r.resting_kcal,active:r.active_kcal,
      total:r.total_kcal || (num(r.resting_kcal)+num(r.active_kcal)),source:r.source || 'manual'
    }));
    state.partnerPermissions = (permsRes.data || []).map(r => ({
      id:r.id,ownerUserId:r.owner_user_id,partnerUserId:r.partner_user_id,shareBody:Boolean(r.share_body),
      shareTraining:Boolean(r.share_training),shareFood:Boolean(r.share_food),shareHealth:Boolean(r.share_health)
    }));
  }

  async function saveProfile() {
    if (!hasSupabaseConfig) { localSave(); return; }
    const payload = {
      user_id:currentUser.id,display_name:state.profile.name,height_cm:state.profile.height,goal_weight_kg:state.profile.goalWeight,
      goal_kcal:state.profile.goalKcal,goal_protein_g:state.profile.goalP,goal_fat_g:state.profile.goalF,goal_carbs_g:state.profile.goalC,
      tracking_start_date:state.profile.trackingStartDate || today(),fallback_expenditure_kcal:state.profile.fallbackExpenditure,
      timezone:state.profile.timezone || 'Asia/Tokyo',notifications_enabled:Boolean(state.profile.notificationsEnabled),updated_at:new Date().toISOString()
    };
    const {error} = await sb.from('profiles').upsert(payload,{onConflict:'user_id'}); if (error) throw error;
    const {data} = await sb.from('profiles').select('share_code,shortcut_key').eq('user_id',currentUser.id).single();
    if (data) { state.profile.shareCode = data.share_code || ''; state.profile.shortcutKey = data.shortcut_key || ''; }
  }
  async function addBody(record) {
    if (!hasSupabaseConfig) { state.body.unshift(record); localSave(); return; }
    const {data,error} = await sb.from('body_composition').insert({
      user_id:currentUser.id,measured_at:record.date,measured_time:record.time||null,weight_kg:record.weight,body_fat_pct:record.fat||null,
      muscle_mass_kg:record.muscle||null,bone_mass_kg:record.bone||null,visceral_fat_level:record.visceral||null,bmr_kcal:record.bmr||null,
      body_water_pct:record.water||null,body_age:record.bodyAge||null,fat_mass_kg:record.fatMass||null,lean_mass_kg:record.lean||null,bmi:record.bmi||null
    }).select().single(); if(error)throw error; record.id=data.id;record.userId=currentUser.id;state.body.unshift(record);
  }
  async function addTraining(record) {
    if (!hasSupabaseConfig) { state.training.unshift(record); localSave(); return; }
    const {data,error} = await sb.from('training_logs').insert({
      user_id:currentUser.id,training_date:record.date,body_part:record.part,exercise_name:record.exercise,weight_kg:record.weight,
      reps:record.reps,sets:record.sets,rpe:record.rpe||null,volume_kg:record.volume,estimated_1rm:record.oneRm,note:record.note||null
    }).select().single(); if(error)throw error;record.id=data.id;record.userId=currentUser.id;state.training.unshift(record);
  }
  async function addCardio(record) {
    if (!hasSupabaseConfig) { state.cardio.unshift(record); localSave(); return; }
    const {data,error} = await sb.from('cardio_logs').insert({
      user_id:currentUser.id,cardio_date:record.date,exercise_name:record.exercise,incline_pct:record.incline||null,
      duration_minutes:record.duration,calories_kcal:record.calories,note:record.note||null,source:record.source||'manual',external_id:record.externalId||null
    }).select().single(); if(error)throw error;record.id=data.id;record.userId=currentUser.id;state.cardio.unshift(record);
  }
  async function addFood(record) {
    if (!hasSupabaseConfig) { state.food.unshift(record); localSave(); return; }
    const {data,error} = await sb.from('food_logs').insert({
      user_id:currentUser.id,eaten_date:record.date,meal_type:record.meal,food_name:record.name,amount_g:record.amount,kcal:record.kcal,
      protein_g:record.protein,fat_g:record.fat,carbs_g:record.carbs,note:record.note||null,source:record.source||'manual',barcode:record.barcode||null
    }).select().single();if(error)throw error;record.id=data.id;record.userId=currentUser.id;state.food.unshift(record);
  }
  async function addHealth(record) {
    if (!hasSupabaseConfig) {
      const idx=state.health.findIndex(x=>x.date===record.date);
      if(idx>=0) state.health[idx]={...state.health[idx],...record}; else state.health.unshift(record);
      localSave(); return;
    }
    const {data,error}=await sb.from('health_daily').upsert({
      user_id:currentUser.id,health_date:record.date,steps:record.steps,resting_kcal:record.resting,active_kcal:record.active,total_kcal:record.total,source:record.source||'manual'
    },{onConflict:'user_id,health_date'}).select().single();
    if(error)throw error;
    const mapped={...record,id:data.id,userId:currentUser.id};
    const idx=state.health.findIndex(x=>String(x.id)===String(data.id)||x.date===record.date&&String(x.userId)===String(currentUser.id));
    if(idx>=0)state.health[idx]=mapped;else state.health.unshift(mapped);
  }
  async function removeRecord(type,id) {
    const map={body:['body_composition','body'],training:['training_logs','training'],cardio:['cardio_logs','cardio'],food:['food_logs','food'],health:['health_daily','health']};
    const [table,key]=map[type]; if(!table)return;
    if(hasSupabaseConfig){const {error}=await sb.from(table).delete().eq('id',id);if(error)throw error;}
    state[key]=state[key].filter(r=>String(r.id)!==String(id)); if(!hasSupabaseConfig)localSave();
  }

  function syncSettingsForm() {
    $('profileName').value=state.profile.name||'';$('profileHeight').value=state.profile.height||'';$('goalWeight').value=state.profile.goalWeight||'';
    $('goalKcal').value=state.profile.goalKcal||'';$('goalP').value=state.profile.goalP||'';$('goalF').value=state.profile.goalF||'';$('goalC').value=state.profile.goalC||'';
    $('trackingStartDate').value=state.profile.trackingStartDate||today();$('fallbackExpenditure').value=state.profile.fallbackExpenditure||'';
    $('notificationsEnabled').checked=Boolean(state.profile.notificationsEnabled);$('shortcutKey').value=state.profile.shortcutKey||'Supabase接続後に発行';
  }
  function renderAll() {
    refreshExerciseDatalist();renderDashboard();renderBodyTable();renderTrainingTable();renderCardioTable();renderFoodTable();renderAnalysis();renderHealth();renderSharing();syncSettingsForm();renderSystemStatus();
    $('welcomeText').textContent=`${state.profile.name||'ユーザー'}さんの記録`;
  }

  function sumFood(date,userId=currentUser?.id) {
    const list = hasSupabaseConfig ? state.food.filter(x=>String(x.userId)===String(userId)) : state.food;
    return list.filter(x=>x.date===date).reduce((a,x)=>({k:a.k+num(x.kcal),p:a.p+num(x.protein),f:a.f+num(x.fat),c:a.c+num(x.carbs)}),{k:0,p:0,f:0,c:0});
  }
  function healthFor(date,userId=currentUser?.id) {
    const list=hasSupabaseConfig?state.health.filter(x=>String(x.userId)===String(userId)):state.health;
    return list.find(x=>x.date===date)||null;
  }
  function expenditureFor(date) {
    const h=healthFor(date); const total=h?num(h.total)||num(h.resting)+num(h.active):0;
    return total>0?total:num(state.profile.fallbackExpenditure);
  }
  function balanceFor(date) {
    const food=sumFood(date); if(food.k<=0)return null;
    const expenditure=expenditureFor(date); if(expenditure<=0)return null;
    return {date,intake:food.k,expenditure,under:expenditure-food.k};
  }
  function dailyBalances() {
    const start=state.profile.trackingStartDate||'0000-01-01';
    const dates=[...new Set(mine(state.food).map(x=>x.date).filter(Boolean))].filter(d=>d>=start&&d<=today()).sort();
    let cumulative=0;
    return dates.map(d=>{const b=balanceFor(d);if(!b)return null;cumulative+=b.under;return {...b,cumulative};}).filter(Boolean);
  }

  function renderDashboard() {
    const body=[...mine(state.body)].sort((a,b)=>(b.date||'').localeCompare(a.date||''));const latest=body[0];
    $('metricWeight').textContent=latest?.weight??'--';$('metricFat').textContent=latest?.fat??'--';$('metricLean').textContent=latest?.lean??'--';
    const sum=sumFood(today());$('metricKcal').textContent=Math.round(sum.k);$('pfcP').textContent=`${round1(sum.p)}g`;$('pfcF').textContent=`${round1(sum.f)}g`;$('pfcC').textContent=`${round1(sum.c)}g`;
    const goals=state.profile;$('goalText').textContent=`${goals.goalKcal||0}kcal / P${goals.goalP||0} F${goals.goalF||0} C${goals.goalC||0}`;
    setBar('barP',sum.p,goals.goalP);setBar('barF',sum.f,goals.goalF);setBar('barC',sum.c,goals.goalC);
    const todayBal=balanceFor(today()); const balances=dailyBalances(); const cumulative=balances.length?balances[balances.length-1].cumulative:null;
    $('metricDeficit').textContent=todayBal?Math.round(todayBal.under):'--';$('metricCumulative').textContent=cumulative===null?'--':Math.round(cumulative);
    $('todayBalanceBox').innerHTML=todayBal?`消費 <b>${Math.round(todayBal.expenditure).toLocaleString()} kcal</b> − 摂取 <b>${Math.round(todayBal.intake).toLocaleString()} kcal</b><br>本日のアンダーカロリー <span class="${todayBal.under>=0?'balance-positive':'balance-negative'}">${todayBal.under>=0?'+':''}${Math.round(todayBal.under).toLocaleString()} kcal</span>`:'食事を記録すると今日の収支を表示します。';

    const train=[...mine(state.training)].sort((a,b)=>(b.date||'').localeCompare(a.date||'')).slice(0,5);const prKeys=currentPrIds();
    $('recentTraining').className=train.length?'mini-list':'list-empty';$('recentTraining').innerHTML=train.length?train.map(r=>`<div class="mini-row"><div><b>${esc(r.exercise)}</b>${prKeys.has(String(r.id))?'<span class="pr-badge">PR</span>':''}<span> ${esc(r.part)} / ${esc(r.date)}</span></div><div>${round1(r.weight)}kg × ${r.reps} × ${r.sets}</div></div>`).join(''):'記録がありません';
    if(body.length){const prev=body[1];const diff=prev?round1(latest.weight-prev.weight):null;$('recentBody').className='mini-list';$('recentBody').innerHTML=`<div class="mini-row"><div><b>${latest.weight}kg</b><span> ${esc(latest.date)}</span></div><div>${diff===null?'初回記録':`${diff>0?'+':''}${diff}kg`}</div></div><div class="mini-row"><div>体脂肪率</div><div>${latest.fat||'--'}%</div></div><div class="mini-row"><div>除脂肪体重</div><div>${latest.lean||'--'}kg</div></div>`;}else{$('recentBody').className='list-empty';$('recentBody').textContent='記録がありません';}
    renderSuggestions(); drawLineChart('weightChart',body.slice(0,12).reverse().map(r=>({x:r.date,y:num(r.weight)})),'体重','kg');
    if(body.length){const delta=round1(num(body[0].weight)-num(body[body.length-1].weight));$('weightTrendLabel').textContent=`${delta>0?'+':''}${delta}kg`;}else $('weightTrendLabel').textContent='データなし';
  }
  function setBar(id,value,goal){$(id).style.width=`${goal?Math.min(100,(value/goal)*100):0}%`;}

  function renderBodyTable(){const rows=[...mine(state.body)].sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('bodyTable').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${fmt(r.weight)}kg</td><td>${fmt(r.fat)}%</td><td>${fmt(r.lean)}kg</td><td>${fmt(r.muscle)}kg</td><td><button class="row-delete" data-del-type="body" data-id="${r.id}">削除</button></td></tr>`).join(''):`<tr><td colspan="6" class="muted">まだ記録がありません</td></tr>`;}
  function renderTrainingTable(){const rows=[...mine(state.training)].sort((a,b)=>(b.date||'').localeCompare(a.date||''));const prs=currentPrIds();$('trainingTable').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.part)}</td><td>${esc(r.exercise)}${prs.has(String(r.id))?' <span class="pr-badge">PR</span>':''}</td><td>${fmt(r.weight)}kg × ${r.reps} × ${r.sets}${r.rpe?` / RPE${fmt(r.rpe)}`:''}</td><td>${fmt(r.oneRm)}kg</td><td>${Math.round(num(r.volume)).toLocaleString()}kg</td><td><button class="row-delete" data-del-type="training" data-id="${r.id}">削除</button></td></tr>`).join(''):`<tr><td colspan="7" class="muted">まだ記録がありません</td></tr>`;}
  function renderCardioTable(){const rows=[...mine(state.cardio)].sort((a,b)=>(b.date||'').localeCompare(a.date||''));$('cardioTable').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.date)}</td><td>${esc(r.exercise)}</td><td>${r.incline!==null&&r.incline!==undefined&&r.incline!==''?`${fmt(r.incline)}%`:'--'}</td><td>${Math.round(num(r.duration))}分</td><td>${Math.round(num(r.calories))}kcal</td><td>${r.source==='apple_health_shortcut'?'Apple Health':'手入力'}</td><td><button class="row-delete" data-del-type="cardio" data-id="${r.id}">削除</button></td></tr>`).join(''):`<tr><td colspan="7" class="muted">まだ記録がありません</td></tr>`;}
  function renderFoodTable(){const rows=[...mine(state.food)].filter(r=>r.date===today()).sort((a,b)=>String(a.meal).localeCompare(String(b.meal),'ja'));const sum=rows.reduce((a,x)=>({k:a.k+num(x.kcal),p:a.p+num(x.protein),f:a.f+num(x.fat),c:a.c+num(x.carbs)}),{k:0,p:0,f:0,c:0});$('todayFoodSummary').textContent=`${Math.round(sum.k)} kcal / P${round1(sum.p)} F${round1(sum.f)} C${round1(sum.c)}`;$('foodTable').innerHTML=rows.length?rows.map(r=>`<tr><td>${esc(r.meal)}</td><td>${esc(r.name)}</td><td>${Math.round(num(r.kcal))}</td><td>${fmt(r.protein)}</td><td>${fmt(r.fat)}</td><td>${fmt(r.carbs)}</td><td><button class="row-delete" data-del-type="food" data-id="${r.id}">削除</button></td></tr>`).join(''):`<tr><td colspan="7" class="muted">今日の記録はありません</td></tr>`;}

  function updateBodyComputed(){const weight=num($('bodyWeight').value),fat=num($('bodyFat').value),height=num(state.profile.height);const fatMass=weight&&fat?weight*fat/100:0;const autoLean=weight?weight-fatMass:0;const bmi=weight&&height?weight/((height/100)**2):0;$('bodyFatMass').value=fatMass?round1(fatMass):'';if(!$('bodyLean').dataset.manual)$('bodyLean').value=autoLean?round1(autoLean):'';$('bodyBmi').value=bmi?round1(bmi):'';}
  function updateTrainingComputed(){const w=num($('trainingWeight').value),reps=num($('trainingReps').value);$('training1rm').value=(w&&reps)?round1(w*(1+reps/30)):'';renderTrainingSuggestionPreview();}
  function updateHealthComputed(){$('healthTotal').value=Math.round(num($('healthResting').value)+num($('healthActive').value));}

  function parseBodyImport(){const t=$('bodyImportText').value.replace(/，/g,',');if(!t.trim()){$('parseMessage').textContent='読み取り結果を貼り付けてください。';return;}const get=(labels)=>{for(const label of labels){const m=t.match(new RegExp(`${label}\\s*[：:]?\\s*([0-9]+(?:\\.[0-9]+)?)`,'i'));if(m)return m[1];}return '';};const dateMatch=t.match(/(?:測定日|日付)\s*[：:]?\s*(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})/);if(dateMatch)$('bodyDate').value=`${dateMatch[1]}-${dateMatch[2].padStart(2,'0')}-${dateMatch[3].padStart(2,'0')}`;const timeMatch=t.match(/(?:測定時刻|時刻)\s*[：:]?\s*(\d{1,2}):(\d{2})/);if(timeMatch)$('bodyTime').value=`${timeMatch[1].padStart(2,'0')}:${timeMatch[2]}`;const map=[['bodyWeight',['体重']],['bodyFat',['体脂肪率','体脂肪']],['bodyMuscle',['筋肉量']],['bodyBone',['推定骨量','骨量']],['bodyVisceral',['内臓脂肪レベル','内臓脂肪']],['bodyBmr',['基礎代謝量','基礎代謝']],['bodyWater',['体水分率','水分率']],['bodyAge',['体年齢']],['bodyLean',['除脂肪体重','除脂肪量']]];let count=0;map.forEach(([id,labels])=>{const v=get(labels);if(v){$(id).value=v;if(id==='bodyLean')$('bodyLean').dataset.manual='1';count++;}});updateBodyComputed();$('parseMessage').textContent=`${count}項目を入力しました。数値を確認して保存してください。`;}

  async function searchFoodProducts(){const q=$('foodSearchInput').value.trim();if(!q)return;$('foodSearchStatus').textContent='検索中…';$('foodSearchResults').innerHTML='';try{const url=`https://world.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(q)}&search_simple=1&action=process&json=1&page_size=8&fields=code,product_name,brands,nutriments,serving_size`;
      const res=await fetch(url,{headers:{Accept:'application/json'}});if(!res.ok)throw new Error('search failed');const data=await res.json();renderProductResults((data.products||[]).filter(p=>p.product_name&&p.nutriments));}catch{$('foodSearchStatus').textContent='商品検索に失敗しました。手入力は利用できます。';}}
  async function lookupBarcode(codeArg){const code=(codeArg||$('barcodeInput').value).replace(/\D/g,'');if(!code){showToast('バーコードを入力してください');return;}$('foodSearchStatus').textContent='バーコード検索中…';$('foodSearchResults').innerHTML='';try{const res=await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=code,product_name,brands,nutriments,serving_size`);if(!res.ok)throw new Error('lookup failed');const data=await res.json();if(data.status!==1||!data.product){$('foodSearchStatus').textContent='商品が見つかりませんでした。手入力してください。';return;}renderProductResults([data.product]);}catch{$('foodSearchStatus').textContent='バーコード検索に失敗しました。';}}
  function renderProductResults(products){if(!products.length){$('foodSearchStatus').textContent='見つかりませんでした。商品名を変えるか手入力してください。';return;}$('foodSearchStatus').textContent=`${products.length}件表示（基本は100gあたり）`;$('foodSearchResults')._products=products;$('foodSearchResults').innerHTML=products.map((p,i)=>{const n=p.nutriments||{},k=n['energy-kcal_100g']??n['energy-kcal'];return `<div class="search-card"><div><strong>${esc(p.product_name)}</strong><small>${esc(p.brands||'')} ${p.code?`/ ${esc(p.code)}`:''}<br>${fmt(k)}kcal P${fmt(n.proteins_100g)} F${fmt(n.fat_100g)} C${fmt(n.carbohydrates_100g)} / 100g</small></div><button class="ghost-btn" data-product="${i}" type="button">選択</button></div>`;}).join('');}
  function selectProduct(index){const p=$('foodSearchResults')._products?.[index];if(!p)return;const n=p.nutriments||{};currentPer100={kcal:num(n['energy-kcal_100g']??n['energy-kcal']),protein:num(n.proteins_100g),fat:num(n.fat_100g),carbs:num(n.carbohydrates_100g),barcode:p.code||''};$('foodName').value=[p.product_name,p.brands].filter(Boolean).join(' / ');$('foodAmount').value=100;$('barcodeInput').value=p.code||'';recalcFoodFromPer100();$('foodNote').value='Open Food Facts / 100g基準';showToast('商品情報を入力しました');}
  function recalcFoodFromPer100(){if(!currentPer100)return;const ratio=(num($('foodAmount').value)||100)/100;$('foodKcal').value=round1(currentPer100.kcal*ratio);$('foodProtein').value=round1(currentPer100.protein*ratio);$('foodFat').value=round1(currentPer100.fat*ratio);$('foodCarbs').value=round1(currentPer100.carbs*ratio);}
  async function startBarcodeScanner(){if(!window.Html5Qrcode){showToast('カメラ読み取りライブラリを読み込めませんでした');return;}try{$('barcodePanel').classList.remove('hidden');barcodeScanner=new Html5Qrcode('barcodeReader');await barcodeScanner.start({facingMode:'environment'},{fps:10,qrbox:{width:260,height:140},aspectRatio:1.777},async decoded=>{$('barcodeInput').value=decoded;await stopBarcodeScanner();lookupBarcode(decoded);},()=>{});}catch(e){showToast('カメラを開始できません。HTTPS・カメラ許可を確認してください');$('barcodePanel').classList.add('hidden');}}
  async function stopBarcodeScanner(){if(barcodeScanner){try{await barcodeScanner.stop();await barcodeScanner.clear();}catch{}barcodeScanner=null;}$('barcodePanel').classList.add('hidden');}

  function exerciseGroups(){const map=new Map();for(const r of mine(state.training)){const k=(r.exercise||'').trim();if(!k)continue;if(!map.has(k))map.set(k,[]);map.get(k).push(r);}for(const arr of map.values())arr.sort((a,b)=>(a.date||'').localeCompare(b.date||''));return map;}
  function currentPrIds(){const ids=new Set();for(const arr of exerciseGroups().values()){let best=-Infinity,bestRow=null;for(const r of arr){if(num(r.oneRm)>best){best=num(r.oneRm);bestRow=r;}}if(bestRow)ids.add(String(bestRow.id));}return ids;}
  function prHistoryRows(){const out=[];for(const [exercise,arr] of exerciseGroups()){let best=-Infinity;arr.forEach((r,i)=>{const v=num(r.oneRm);if(v>best){if(i>0)out.push({...r,exercise,previous:best});best=v;}});}return out.sort((a,b)=>(b.date||'').localeCompare(a.date||''));}
  function calculatePrs(){const rows=[];for(const [exercise,arr] of exerciseGroups()){const bestWeight=arr.reduce((a,b)=>num(b.weight)>num(a.weight)?b:a,arr[0]);const best1=arr.reduce((a,b)=>num(b.oneRm)>num(a.oneRm)?b:a,arr[0]);const bestRep=arr.reduce((a,b)=>num(b.weight)*num(b.reps)>num(a.weight)*num(a.reps)?b:a,arr[0]);rows.push({exercise,bestWeight,best1,bestRep});}return rows.sort((a,b)=>num(b.best1?.oneRm)-num(a.best1?.oneRm));}
  function incrementFor(r){const text=(r.exercise||'').toLowerCase();if(r.part==='脚'||/デッド|スクワット|レッグプレス/.test(text))return 5;return 2.5;}
  function suggestionFor(r){if(!r)return'';const w=num(r.weight),reps=num(r.reps),rpe=num(r.rpe);const inc=incrementFor(r);if(!w)return`${r.exercise}: 前回は自重・有酸素系。回数または時間を5〜10%増やす。`;if(rpe>=9.5)return`${r.exercise}: ${w}kgを維持。RPEが高いため、まず同重量で回数・フォームを安定させる。`;if(reps>=10&&(!rpe||rpe<=8.5))return`${r.exercise}: ${round1(w+inc)}kgへ増量し、前回セット数を維持する。`;if(reps<6)return`${r.exercise}: ${w}kgを維持し、各セットで+1回を狙う。`;return`${r.exercise}: ${w}kgのまま総レップ数を+1〜3回。達成後に${round1(w+inc)}kgへ。`;}
  function renderSuggestions(){const latest=[];for(const [exercise,arr] of exerciseGroups()){latest.push({...arr[arr.length-1],exercise});}latest.sort((a,b)=>(b.date||'').localeCompare(a.date||''));const rows=latest.slice(0,5);$('suggestionsList').className=rows.length?'mini-list':'list-empty';$('suggestionsList').innerHTML=rows.length?rows.map(r=>`<div class="mini-row"><div><b>${esc(r.exercise)}</b><span> 前回 ${esc(r.date)}</span></div><div>${esc(suggestionFor(r).replace(`${r.exercise}: `,''))}</div></div>`).join(''):'記録がありません';}
  function renderTrainingSuggestionPreview(){const name=$('trainingExercise').value.trim();if(!name){$('trainingSuggestionPreview').textContent='種目名を入力すると、過去記録がある場合は次回目安を表示します。';return;}const arr=exerciseGroups().get(name)||[];const latest=arr[arr.length-1];$('trainingSuggestionPreview').textContent=latest?`過去実績からの提案: ${suggestionFor(latest)}`:'この種目は初回記録です。無理のない重量から開始してください。';}
  function refreshExerciseDatalist(){const names=[...exerciseGroups().keys()].sort((a,b)=>a.localeCompare(b,'ja'));$('exerciseDatalist').innerHTML=names.map(n=>`<option value="${esc(n)}"></option>`).join('');const sel=$('analysisExercise');const current=sel.value;sel.innerHTML=names.length?names.map(n=>`<option value="${esc(n)}">${esc(n)}</option>`).join(''):'<option value="">記録なし</option>';if(names.includes(current))sel.value=current;}

  function renderAnalysis(){const train=mine(state.training);const now=new Date(),weekStart=new Date(now);weekStart.setHours(0,0,0,0);const day=(weekStart.getDay()+6)%7;weekStart.setDate(weekStart.getDate()-day);const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const weekVol=train.filter(r=>{const d=parseDate(r.date);return d&&d>=weekStart;}).reduce((s,r)=>s+num(r.volume),0);const monthVol=train.filter(r=>{const d=parseDate(r.date);return d&&d>=monthStart;}).reduce((s,r)=>s+num(r.volume),0);$('weekVolume').textContent=Math.round(weekVol).toLocaleString();$('monthVolume').textContent=Math.round(monthVol).toLocaleString();$('exerciseCount').textContent=exerciseGroups().size;$('prCount').textContent=prHistoryRows().length;
    const prs=calculatePrs();$('prList').className=prs.length?'mini-list':'list-empty';$('prList').innerHTML=prs.length?prs.map(p=>`<div class="mini-row"><div><b>${esc(p.exercise)}</b><span> 実重量 ${fmt(p.bestWeight.weight)}kg</span></div><div>推定1RM <b>${fmt(p.best1.oneRm)}kg</b><br><span>${fmt(p.bestRep.weight)}kg × ${p.bestRep.reps}回</span></div></div>`).join(''):'記録がありません';
    const hist=prHistoryRows();$('prHistory').className=hist.length?'mini-list':'list-empty';$('prHistory').innerHTML=hist.length?hist.slice(0,20).map(r=>`<div class="mini-row"><div><b>${esc(r.exercise)}</b><span> ${esc(r.date)}</span></div><div>${fmt(r.previous)} → <b>${fmt(r.oneRm)}kg</b></div></div>`).join(''):'更新履歴はありません';
    renderExerciseChart();renderVolumeChart();renderCorrelationChart();}
  function renderExerciseChart(){const name=$('analysisExercise').value;if(!name){destroyChart('exerciseChart');return;}const metric=$('analysisMetric').value,days=$('analysisRange').value;let arr=(exerciseGroups().get(name)||[]);if(days!=='all'){const min=dateDaysAgo(num(days));arr=arr.filter(r=>{const d=parseDate(r.date);return d&&d>=min;});}const label={oneRm:'推定1RM',weight:'重量',volume:'総ボリューム'}[metric];drawLineChart('exerciseChart',arr.map(r=>({x:r.date,y:num(r[metric])})),label,metric==='volume'?'kg':'kg');}
  function renderVolumeChart(){const parts=['胸','背中','脚','肩','腕','腹','全身'];const now=new Date(),weekStart=new Date(now);weekStart.setHours(0,0,0,0);weekStart.setDate(weekStart.getDate()-((weekStart.getDay()+6)%7));const monthStart=new Date(now.getFullYear(),now.getMonth(),1);const train=mine(state.training);const week={},month={};parts.forEach(p=>{week[p]=0;month[p]=0;});train.forEach(r=>{const d=parseDate(r.date);if(!d)return;if(d>=weekStart)week[r.part]=(week[r.part]||0)+num(r.volume);if(d>=monthStart)month[r.part]=(month[r.part]||0)+num(r.volume);});drawBarChart('volumeChart',parts.filter(p=>(week[p]||month[p])),parts.filter(p=>(week[p]||month[p])).map(p=>week[p]||0),parts.filter(p=>(week[p]||month[p])).map(p=>month[p]||0));}
  function pearson(points){if(points.length<3)return null;const xs=points.map(p=>p.x),ys=points.map(p=>p.y);const mx=xs.reduce((a,b)=>a+b,0)/xs.length,my=ys.reduce((a,b)=>a+b,0)/ys.length;let n=0,dx=0,dy=0;for(let i=0;i<xs.length;i++){const a=xs[i]-mx,b=ys[i]-my;n+=a*b;dx+=a*a;dy+=b*b;}if(!dx||!dy)return null;return n/Math.sqrt(dx*dy);}
  function renderCorrelationChart(){const bodyByDate=new Map(mine(state.body).map(r=>[r.date,r]));const points=[];for(const [date,b] of bodyByDate){const f=sumFood(date);if(f.k>0&&num(b.weight)>0)points.push({x:Math.round(f.k),y:num(b.weight),date});}const r=pearson(points);$('correlationLabel').textContent=r===null?'データ不足':`r = ${r.toFixed(2)} / ${points.length}日`;drawScatterChart('correlationChart',points);}

  function renderHealth(){const rows=dailyBalances().slice().reverse();const todayB=balanceFor(today());const cumulative=rows.length?rows[0].cumulative:0;$('balanceSummary').innerHTML=`<div class="summary-card"><span>本日のアンダーカロリー</span><strong>${todayB?`${Math.round(todayB.under).toLocaleString()} kcal`:'未計算'}</strong></div><div class="summary-card"><span>測定開始からの累積</span><strong>${rows.length?`${Math.round(cumulative).toLocaleString()} kcal`:'未計算'}</strong></div><div class="summary-card"><span>算出済み日数</span><strong>${rows.length}日</strong></div>`;$('healthTable').innerHTML=rows.length?rows.slice(0,90).map(r=>{const h=healthFor(r.date);return `<tr><td>${esc(r.date)}</td><td>${Math.round(r.intake)}</td><td>${Math.round(r.expenditure)}</td><td class="${r.under>=0?'balance-positive':'balance-negative'}">${r.under>=0?'+':''}${Math.round(r.under)}</td><td>${r.cumulative>=0?'+':''}${Math.round(r.cumulative)}</td><td>${h?`<button class="row-delete" data-del-type="health" data-id="${h.id}">消費削除</button>`:''}</td></tr>`;}).join(''):`<tr><td colspan="6" class="muted">食事と消費データを登録すると計算されます</td></tr>`;const ordered=dailyBalances();drawLineChart('balanceChart',ordered.map(r=>({x:r.date,y:Math.round(r.cumulative)})),'累積カロリー差','kcal');}

  function renderSharing(){const cloud=hasSupabaseConfig;$('sharingCloudOnly').classList.toggle('hidden',cloud);$('sharingControls').classList.toggle('hidden',!cloud);if(!cloud){$('partnerOverview').className='list-empty';$('partnerOverview').textContent='正式運用時にSupabaseへ接続すると利用できます。';return;}$('myShareCode').value=state.profile.shareCode||'読み込み中';const pid=partnerId();const ownPerm=state.partnerPermissions.find(p=>String(p.ownerUserId)===String(currentUser.id));$('shareBody').checked=Boolean(ownPerm?.shareBody);$('shareTraining').checked=Boolean(ownPerm?.shareTraining);$('shareFood').checked=Boolean(ownPerm?.shareFood);$('shareHealth').checked=Boolean(ownPerm?.shareHealth);const pp=state.partnerProfiles.find(p=>String(p.userId)===String(pid));if(pid){$('partnerStatus').innerHTML=`<strong>${esc(pp?.name||'パートナー')}と連携中</strong><span>共有範囲は各自が設定できます。</span>`;}else{$('partnerStatus').innerHTML='<strong>未連携</strong><span>相手の共有コードで連携します。</span>';}
    const pBody=partnerRows(state.body).sort((a,b)=>(b.date||'').localeCompare(a.date||''));const pTrain=partnerRows(state.training).sort((a,b)=>(b.date||'').localeCompare(a.date||''));const pCardio=partnerRows(state.cardio).sort((a,b)=>(b.date||'').localeCompare(a.date||''));const pFood=partnerRows(state.food).filter(x=>x.date===today());const pHealth=partnerRows(state.health).find(x=>x.date===today());const blocks=[];if(pBody[0])blocks.push(`<div class="summary-card"><span>最新体組成</span><strong>${fmt(pBody[0].weight)}kg / ${fmt(pBody[0].fat)}%</strong></div>`);if(pTrain[0])blocks.push(`<div class="summary-card"><span>最新筋トレ</span><strong>${esc(pTrain[0].exercise)} ${fmt(pTrain[0].weight)}kg×${pTrain[0].reps}</strong></div>`);if(pCardio[0])blocks.push(`<div class="summary-card"><span>最新有酸素</span><strong>${esc(pCardio[0].exercise)} ${Math.round(num(pCardio[0].duration))}分 / ${Math.round(num(pCardio[0].calories))}kcal</strong></div>`);if(pFood.length)blocks.push(`<div class="summary-card"><span>今日の摂取</span><strong>${Math.round(pFood.reduce((s,x)=>s+num(x.kcal),0))} kcal</strong></div>`);if(pHealth)blocks.push(`<div class="summary-card"><span>今日の消費</span><strong>${Math.round(num(pHealth.total))} kcal</strong></div>`);$('partnerOverview').className=blocks.length?'summary-stack':'list-empty';$('partnerOverview').innerHTML=blocks.length?blocks.join(''):'相手が共有したデータはまだありません。';}
  async function connectPartner(){const code=$('partnerShareCode').value.trim();if(!code||!hasSupabaseConfig)return;try{const {error}=await sb.rpc('connect_partner_by_code',{p_code:code});if(error)throw error;await cloudLoad();renderAll();showToast('夫婦アカウントを連携しました');}catch(e){showToast(e.message||'連携に失敗しました');}}
  async function saveSharing(){if(!hasSupabaseConfig)return;const pid=partnerId();if(!pid){showToast('先にパートナーを連携してください');return;}try{const {error}=await sb.from('partner_permissions').update({share_body:$('shareBody').checked,share_training:$('shareTraining').checked,share_food:$('shareFood').checked,share_health:$('shareHealth').checked,updated_at:new Date().toISOString()}).eq('owner_user_id',currentUser.id).eq('partner_user_id',pid);if(error)throw error;await cloudLoad();renderAll();showToast('共有設定を保存しました');}catch(e){showToast('共有設定の保存に失敗しました');}}

  function destroyChart(id){if(charts[id]){charts[id].destroy();delete charts[id];}}
  function chartReady(){return Boolean(window.Chart);}
  function drawLineChart(id,points,label,unit){destroyChart(id);if(!chartReady())return;const el=$(id);if(!el)return;charts[id]=new Chart(el,{type:'line',data:{labels:points.map(p=>p.x),datasets:[{label,data:points.map(p=>p.y),borderWidth:2,tension:.25,pointRadius:3}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{ticks:{maxRotation:0,autoSkip:true,maxTicksLimit:8}},y:{beginAtZero:false,title:{display:Boolean(unit),text:unit}}}}});}
  function drawBarChart(id,labels,week,month){destroyChart(id);if(!chartReady())return;charts[id]=new Chart($(id),{type:'bar',data:{labels,datasets:[{label:'今週',data:week},{label:'今月',data:month}]},options:{responsive:true,maintainAspectRatio:false,scales:{y:{beginAtZero:true,title:{display:true,text:'kg'}}}}});}
  function drawScatterChart(id,points){destroyChart(id);if(!chartReady())return;charts[id]=new Chart($(id),{type:'scatter',data:{datasets:[{label:'体重 × 摂取カロリー',data:points.map(p=>({x:p.x,y:p.y}))}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false}},scales:{x:{title:{display:true,text:'摂取カロリー (kcal)'}},y:{title:{display:true,text:'体重 (kg)'}}}}});}

  async function registerServiceWorker(){if('serviceWorker'in navigator){try{return await navigator.serviceWorker.register('./sw.js');}catch{return null;}}return null;}
  function base64ToUint8Array(base64){const padding='='.repeat((4-base64.length%4)%4);const normalized=(base64+padding).replace(/-/g,'+').replace(/_/g,'/');const raw=atob(normalized);return Uint8Array.from([...raw].map(c=>c.charCodeAt(0)));}
  async function enablePush(){if(!hasSupabaseConfig){showToast('Push通知はSupabase接続後に利用できます');return;}if(!cfg.VAPID_PUBLIC_KEY){$('pushStatus').textContent='config.js に VAPID_PUBLIC_KEY を設定してください。';return;}if(!('Notification'in window)||!('serviceWorker'in navigator)||!('PushManager'in window)){$('pushStatus').textContent='このブラウザはWeb Pushに対応していません。';return;}try{const perm=await Notification.requestPermission();if(perm!=='granted'){throw new Error('通知が許可されませんでした');}const reg=await navigator.serviceWorker.ready;let sub=await reg.pushManager.getSubscription();if(!sub)sub=await reg.pushManager.subscribe({userVisibleOnly:true,applicationServerKey:base64ToUint8Array(cfg.VAPID_PUBLIC_KEY)});const json=sub.toJSON();const {error}=await sb.from('push_subscriptions').upsert({user_id:currentUser.id,endpoint:json.endpoint,p256dh:json.keys?.p256dh,auth:json.keys?.auth,user_agent:navigator.userAgent},{onConflict:'endpoint'});if(error)throw error;state.profile.notificationsEnabled=true;$('notificationsEnabled').checked=true;await saveProfile();$('pushStatus').textContent='この端末のPush通知を有効にしました。';showToast('Push通知を有効にしました');}catch(e){$('pushStatus').textContent=e.message||'Push通知の設定に失敗しました。';}}
  function renderSystemStatus(){const rows=[['保存先',hasSupabaseConfig?'Supabase Free':'端末内デモ'],['AI API','未使用（0円）'],['商品検索','Open Food Facts'],['バーコード','カメラ / JAN・EAN'],['Apple Health',hasSupabaseConfig?'ショートカット連携可能':'Supabase接続後'],['22時Push',hasSupabaseConfig&&cfg.VAPID_PUBLIC_KEY?'設定可能':'VAPID/Supabase設定後']];$('systemStatus').innerHTML=rows.map(([a,b])=>`<div class="summary-card"><span>${esc(a)}</span><strong>${esc(b)}</strong></div>`).join('');}

  function switchPage(page){if(!document.getElementById(`page-${page}`))return;document.querySelectorAll('.page').forEach(x=>x.classList.remove('active'));document.querySelectorAll('.nav-item').forEach(x=>x.classList.toggle('active',x.dataset.page===page));$(`page-${page}`).classList.add('active');const names={dashboard:'ダッシュボード',body:'体組成',training:'トレーニング',analysis:'分析・PR',food:'食事',health:'消費カロリー',sharing:'夫婦共有',settings:'設定'};$('pageTitle').textContent=names[page]||'';if(location.hash!==`#${page}`)history.replaceState(null,'',`#${page}`);if(page==='dashboard')renderDashboard();if(page==='analysis')renderAnalysis();if(page==='health')renderHealth();if(page==='sharing')renderSharing();}

  document.addEventListener('click',async e=>{const nav=e.target.closest('[data-page]');if(nav)switchPage(nav.dataset.page);const del=e.target.closest('[data-del-type]');if(del&&confirm('この記録を削除しますか？')){try{await removeRecord(del.dataset.delType,del.dataset.id);renderAll();showToast('削除しました');}catch{showToast('削除に失敗しました');}}const product=e.target.closest('[data-product]');if(product)selectProduct(Number(product.dataset.product));});
  $('demoStart').addEventListener('click',()=>{localLoad();state.profile.name=$('demoName').value.trim()||state.profile.name||'ユーザー';localSave();currentUser={id:'demo'};showApp();const target=location.hash.slice(1);if(target)switchPage(target);});
  $('loginTab').addEventListener('click',()=>{authMode='login';$('loginTab').classList.add('active');$('signupTab').classList.remove('active');$('authSubmit').textContent='ログイン';});
  $('signupTab').addEventListener('click',()=>{authMode='signup';$('signupTab').classList.add('active');$('loginTab').classList.remove('active');$('authSubmit').textContent='新規登録';});
  $('authForm').addEventListener('submit',async e=>{e.preventDefault();if(!sb)return;const email=$('emailInput').value,password=$('passwordInput').value;$('authMessage').textContent='処理中…';const result=authMode==='signup'?await sb.auth.signUp({email,password}):await sb.auth.signInWithPassword({email,password});if(result.error){$('authMessage').textContent=result.error.message;return;}if(authMode==='signup'&&!result.data.session){$('authMessage').textContent='確認メールを送信しました。メール認証後にログインしてください。';return;}currentUser=result.data.user;try{await cloudLoad();if(!state.profile.name){state.profile.name=email.split('@')[0];await saveProfile();await cloudLoad();}showApp();}catch(err){$('authMessage').textContent=`初期読み込みに失敗: ${err.message}`;}});
  $('logoutBtn').addEventListener('click',async()=>{if(sb)await sb.auth.signOut();currentUser=null;state=emptyState();showAuth();});
  $('quickFood').addEventListener('click',()=>switchPage('food'));$('quickBody').addEventListener('click',()=>switchPage('body'));$('quickTraining').addEventListener('click',()=>switchPage('training'));
  ['bodyWeight','bodyFat'].forEach(id=>$(id).addEventListener('input',updateBodyComputed));$('bodyLean').addEventListener('input',()=>{$('bodyLean').dataset.manual='1';});
  ['trainingWeight','trainingReps','trainingRpe'].forEach(id=>$(id).addEventListener('input',updateTrainingComputed));$('trainingExercise').addEventListener('input',renderTrainingSuggestionPreview);$('parseBodyText').addEventListener('click',parseBodyImport);
  ['healthResting','healthActive'].forEach(id=>$(id).addEventListener('input',updateHealthComputed));

  $('bodyForm').addEventListener('submit',async e=>{e.preventDefault();const record={id:uid(),userId:currentUser?.id||'demo',date:$('bodyDate').value,time:$('bodyTime').value,weight:num($('bodyWeight').value),fat:num($('bodyFat').value),muscle:num($('bodyMuscle').value),bone:num($('bodyBone').value),visceral:num($('bodyVisceral').value),bmr:num($('bodyBmr').value),water:num($('bodyWater').value),bodyAge:num($('bodyAge').value),fatMass:num($('bodyFatMass').value),lean:num($('bodyLean').value),bmi:num($('bodyBmi').value)};try{await addBody(record);renderAll();showToast('体組成を保存しました');e.target.reset();delete $('bodyLean').dataset.manual;setDefaults();}catch{showToast('保存に失敗しました');}});
  $('trainingForm').addEventListener('submit',async e=>{e.preventDefault();const w=num($('trainingWeight').value),r=num($('trainingReps').value),s=num($('trainingSets').value);const record={id:uid(),userId:currentUser?.id||'demo',date:$('trainingDate').value,part:$('trainingPart').value,exercise:$('trainingExercise').value.trim(),weight:w,reps:r,sets:s,rpe:num($('trainingRpe').value)||null,volume:round1(w*r*s),oneRm:num($('training1rm').value),note:$('trainingNote').value.trim()};try{await addTraining(record);renderAll();showToast('トレーニングを保存しました');$('trainingExercise').value='';$('trainingNote').value='';$('trainingRpe').value='';renderTrainingSuggestionPreview();}catch{showToast('保存に失敗しました');}});
  $('cardioForm').addEventListener('submit',async e=>{e.preventDefault();const record={id:uid(),userId:currentUser?.id||'demo',date:$('cardioDate').value,exercise:$('cardioExercise').value,incline:$('cardioIncline').value===''?null:num($('cardioIncline').value),duration:num($('cardioDuration').value),calories:num($('cardioCalories').value),note:$('cardioNote').value.trim(),source:'manual',externalId:''};try{await addCardio(record);renderAll();showToast('有酸素運動を保存しました');$('cardioIncline').value='';$('cardioDuration').value='';$('cardioCalories').value='';$('cardioNote').value='';}catch{showToast('保存に失敗しました');}});
  $('foodForm').addEventListener('submit',async e=>{e.preventDefault();const amount=num($('foodAmount').value)||100;const record={id:uid(),userId:currentUser?.id||'demo',date:$('foodDate').value,meal:$('mealType').value,name:$('foodName').value.trim(),amount,kcal:num($('foodKcal').value),protein:num($('foodProtein').value),fat:num($('foodFat').value),carbs:num($('foodCarbs').value),note:$('foodNote').value.trim(),source:currentPer100?'openfoodfacts':'manual',barcode:currentPer100?.barcode||$('barcodeInput').value.trim()};try{await addFood(record);renderAll();showToast('食事を保存しました');['foodName','foodKcal','foodProtein','foodFat','foodCarbs','foodNote','barcodeInput'].forEach(id=>$(id).value='');$('foodAmount').value=100;currentPer100=null;}catch{showToast('保存に失敗しました');}});
  $('healthForm').addEventListener('submit',async e=>{e.preventDefault();const record={id:uid(),userId:currentUser?.id||'demo',date:$('healthDate').value,steps:num($('healthSteps').value),resting:num($('healthResting').value),active:num($('healthActive').value),total:num($('healthTotal').value),source:'manual'};try{await addHealth(record);renderAll();showToast('消費データを保存しました');}catch{showToast('保存に失敗しました');}});

  $('foodSearchBtn').addEventListener('click',searchFoodProducts);$('foodSearchInput').addEventListener('keydown',e=>{if(e.key==='Enter'){e.preventDefault();searchFoodProducts();}});$('foodAmount').addEventListener('input',recalcFoodFromPer100);$('barcodeLookupBtn').addEventListener('click',()=>lookupBarcode());$('scanBarcodeBtn').addEventListener('click',startBarcodeScanner);$('stopBarcodeBtn').addEventListener('click',stopBarcodeScanner);
  ['analysisExercise','analysisMetric','analysisRange'].forEach(id=>$(id).addEventListener('change',renderExerciseChart));
  $('connectPartnerBtn').addEventListener('click',connectPartner);$('saveSharingBtn').addEventListener('click',saveSharing);$('enablePushBtn').addEventListener('click',enablePush);
  $('notificationsEnabled').addEventListener('change',async()=>{state.profile.notificationsEnabled=$('notificationsEnabled').checked;if(hasSupabaseConfig){try{await saveProfile();showToast('通知設定を保存しました');}catch{showToast('通知設定の保存に失敗しました');}}else localSave();});
  $('settingsForm').addEventListener('submit',async e=>{e.preventDefault();state.profile={...state.profile,name:$('profileName').value.trim()||'ユーザー',height:num($('profileHeight').value),goalWeight:num($('goalWeight').value),goalKcal:num($('goalKcal').value),goalP:num($('goalP').value),goalF:num($('goalF').value),goalC:num($('goalC').value),trackingStartDate:$('trackingStartDate').value||today(),fallbackExpenditure:num($('fallbackExpenditure').value)};try{await saveProfile();renderAll();showToast('設定を保存しました');}catch{showToast('設定保存に失敗しました');}});
  $('exportBtn').addEventListener('click',()=>{const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=`training-manager-${today()}.json`;a.click();URL.revokeObjectURL(a.href);});
  $('clearDemoBtn').addEventListener('click',()=>{if(confirm('この端末のデモデータをすべて削除しますか？')){localStorage.removeItem(DEMO_KEY);localStorage.removeItem(OLD_DEMO_KEY);state=emptyState();showToast('デモデータを削除しました');showAuth();}});

  async function init(){showAuth();registerServiceWorker();const target=location.hash.slice(1);if(hasSupabaseConfig){const {data}=await sb.auth.getSession();if(data.session){currentUser=data.session.user;try{await cloudLoad();showApp();if(target)switchPage(target);}catch(err){$('authMessage').textContent=`読み込みに失敗: ${err.message}`;}}}else if(target&&currentUser){switchPage(target);}}
  init();
})();
