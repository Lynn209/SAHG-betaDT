import {parseTimelineCSV,prepareInput} from './preprocess.js';
import {ModelRuntime} from './model.js';
import {DonorRuntime} from './donor.js';
import {evaluatePolicy,applyTemporal,newTemporalState} from './policy.js';
import {runBrowserSelfTest} from './selftest.js';

const $=id=>document.getElementById(id);
const ACTIONS={0:['A0','Continue current regimen','#77AADD'],1:['A1','Remove companion coverage','#F1CE63'],2:['A2','β-lactam de-escalation','#009988'],3:['A3','Discontinue β-lactam','#9467BD'],4:['A4','Discontinue all antibacterials','#E73F74'],5:['A5','Rescue / escalation-or-other','#882255'],'-1':['Ø','True abstention','#AAAA00']};

let timeline=[],norm,structuralProfiles,gate,lock,policy,oodRef,model,donor,loaded=false;
let contractsPromise=null;

const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pct=x=>Number.isFinite(+x)?(+x*100).toFixed(1)+'%':'—';
const num=(x,d=2)=>Number.isFinite(+x)?(+x).toFixed(d):'—';
const setText=(id,text)=>{const el=$(id);if(el)el.textContent=text};

function setStatus(text,ok=false){
  setText('runtimeStatusText',text);
  const el=$('runtimeStatus');
  if(el)el.classList.toggle('ready',ok);
}
function sessionKey(){return 'sahg_v17_path_'+(($('patientCode')?.value||'WEB-001').trim()||'WEB-001')}
function loadState(){try{return JSON.parse(localStorage.getItem(sessionKey()))||newTemporalState()}catch{return newTemporalState()}}
function saveState(s){localStorage.setItem(sessionKey(),JSON.stringify(s));renderPathState(s)}
function renderPathState(s){
  setText('pathState',`stage=${s.stage} · cooldown=${s.cooldown} · pending=${s.pending_count}${s.pending_hour!=null?' @ '+s.pending_hour+'h':''} · last=${s.last_hour==null?'none':s.last_hour+'h'}`);
}

async function loadContracts(){
  [norm,structuralProfiles,gate,lock,policy,oodRef]=await Promise.all(
    ['runtime/normalization.json','runtime/structural_masks.json','runtime/gate_calibration.json','runtime/policy_lock.json','runtime/runtime_policy.json','runtime/ood_reference.json']
      .map(u=>fetch(u).then(r=>{if(!r.ok)throw Error('Missing runtime asset: '+u);return r.json()}))
  );

  const s=await fetch('data/policy_summary.json').then(r=>r.json()).catch(()=>null);
  if(s?.development_selection){
    setText('statPatients',s.development_selection.n_evaluable_patients?.toLocaleString?.() ?? '');
    setText('statDecisions',s.development_selection.n_evaluable_decisions?.toLocaleString?.() ?? '');
    setText('statAbstain',pct(s.development_selection.true_abstention_rate));
    setText('statESS',num(s.development_selection.median_selected_donor_ess,1));
  }
}

async function ensureRuntime(){
  if(loaded)return;
  if(contractsPromise) await contractsPromise;
  setStatus('Loading frozen ONNX models and donor runtime…');
  model=await new ModelRuntime().load();
  donor=await new DonorRuntime().load();
  setStatus('Running browser-vs-Python V17 self-test…');
  const qa=await runBrowserSelfTest({model,donor,norm,structuralProfiles,gate,lock,policy,oodRef});
  loaded=true;
  setStatus(`V17 browser runtime verified · ${qa.checks} checks PASS`,true);
  setText('selfTestInfo',`Runtime self-test PASS · max numeric deviation ${qa.max_abs.toExponential(2)}`);
}

function summary(){
  const fs=$('fileSummary');
  if(!fs)return;
  const first=fs.firstElementChild;
  if(!timeline.length){
    if(first)first.textContent='No timeline loaded';
    return;
  }
  const vs=new Set(timeline.map(x=>x.variable));
  const hs=timeline.map(x=>x.rel_t0_hour);
  if(first)first.textContent=`${timeline.length} rows · ${vs.size} recognized measurements · ${Math.min(...hs)} to ${Math.max(...hs)} h`;
}

async function handleFile(f){
  if(!f)return;
  try{
    timeline=parseTimelineCSV(await f.text());
    summary();
    setText('formMessage','CSV loaded successfully.');
  }catch(e){
    timeline=[];
    summary();
    setText('formMessage',e.message);
  }
}

function context(){
  return {
    decision_hour_after_t0:+$('decisionHour').value,
    sex:$('sex').value,
    age:+$('age').value,
    weight_kg:+$('weight').value,
    current_beta_asi:+$('betaAsi').value,
    current_antibacterial_count:+$('abxCount').value,
    current_beta_lactam_count:+$('betaCount').value,
    current_anti_mrsa:+$('antiMrsa').value,
    current_carbapenem:+$('carbapenem').value,
    source_profile:$('sourceProfile').value
  };
}

function render(r,p){
  $('emptyResult').classList.add('hidden');
  $('policyResult').classList.remove('hidden');
  const a=ACTIONS[String(r.recommended_action)]||ACTIONS['-1'];
  $('recCode').textContent=a[0];
  $('recLabel').textContent=a[1];
  $('recConfidence').textContent=r.recommendation_confidence;
  $('recReason').textContent=r.independent_selection_reason+' · '+r.transition_type;
  $('recommendationBox').style.borderLeftColor=a[2];
  $('badgeOOD').textContent='OOD '+(r.ood_flag?'FLAG':'PASS');
  $('badgeAbstain').textContent='Abstain '+(r.true_abstain?'YES':'NO');
  $('badgeTransition').textContent='Transition '+r.transition_type;

  $('actionTable').innerHTML=
    '<div class="action-row header"><span>Action</span><span>Policy state</span><span>Risk</span><span>Δ vs A0</span><span>ESS</span></div>'+
    r.actions.map(x=>{
      const q=ACTIONS[String(x.action)];
      return `<div class="action-row${x.action===r.recommended_action?' selected':''}"><span class="code" style="color:${q[2]}">${q[0]}</span><span>${esc(q[1])}</span><span>${pct(x.risk)}</span><span>${(x.risk_difference*100).toFixed(1)} pp</span><span>${num(x.donor_ess,1)}</span></div>`;
    }).join('');

  const sel=r.recommended_action>=0?r.actions[r.recommended_action]:null;
  const d=[
    ['Policy score',sel?num(sel.policy_score,3):'—'],
    ['Selected Δ risk',sel?(sel.risk_difference*100).toFixed(2)+' pp':'—'],
    ['Predicted failure',sel?pct(sel.risk):'—'],
    ['Donor ESS',sel?num(sel.donor_ess,1):'—'],
    ['OOD distance',num(r.ood_distance,2)],
    ['Regimen node',r.current_regimen_node],
    ['Minimum support',sel?(sel.minimum_support===1?'PASS':'FAIL'):'—'],
    ['Decision hour',r.decision_hour_after_t0+' h'],
    ['Observed events',String(p.nEvents)],
    ['Observed variables',String(p.nVariables)]
  ];
  $('diagGrid').innerHTML=d.map(([k,v])=>`<div class="diag"><span>${esc(k)}</span><b>${esc(v)}</b></div>`).join('');
  $('runtimeFoot').textContent='V17 · coverage_p050 · browser-only WASM/ONNX · no API request';
  renderPathState(r.state);
}

async function run(e){
  e.preventDefault();
  setText('formMessage','');
  if(!timeline.length){
    setText('formMessage','Please upload a timeline CSV first.');
    return;
  }

  const mode=$('mode').value,dh=+$('decisionHour').value,state=loadState();
  if(mode==='dynamic'&&state.last_hour==null&&dh!==24){
    setText('formMessage','For exact temporally smoothed V17 output, start a new dynamic path at 24 h.');
    return;
  }

  $('runBtn').disabled=true;
  $('runBtn').querySelector('span').textContent='Running locally in this browser…';

  try{
    if(contractsPromise) await contractsPromise;
    await ensureRuntime();

    const c=context(),sp=structuralProfiles.profiles[c.source_profile];
    if(!sp)throw Error(`Unknown structural profile: ${c.source_profile}`);

    const p=prepareInput(c,timeline,norm,sp,policy);
    const pred=await model.predict(p,gate);
    const d=donor.query(pred.anchor);
    const ind=evaluatePolicy({
      pred,donor:d,eligibility:p.eligibility,regimenNode:p.regimen_node,
      decisionHour:c.decision_hour_after_t0,recentFactualA5:$('recentA5').checked,
      gate,lock,policy,oodRef
    });
    const final=applyTemporal(ind,policy,state,mode);
    if(mode==='dynamic')saveState(final.state);
    render(final,p);
  }catch(err){
    console.error(err);
    setText('formMessage',err.message||String(err));
  }finally{
    $('runBtn').disabled=false;
    $('runBtn').querySelector('span').textContent='Get SAHG-βDT recommendation';
  }
}

function setupUpload(){
  const dz=$('dropZone'), fi=$('timelineFile'), choose=$('chooseFile');
  if(!dz||!fi) return;

  // Native <label for="timelineFile"> works even before JS initialization.
  if(choose && choose.tagName!=='LABEL'){
    choose.addEventListener('click',e=>{
      e.preventDefault();
      e.stopPropagation();
      fi.click();
    });
  }

  dz.addEventListener('click',e=>{
    if(e.target.closest('a,button,label,input'))return;
    fi.click();
  });

  dz.addEventListener('keydown',e=>{
    if(e.key==='Enter'||e.key===' '){
      e.preventDefault();
      fi.click();
    }
  });

  fi.addEventListener('change',()=>{
    if(fi.files?.[0]) handleFile(fi.files[0]);
  });

  ['dragenter','dragover'].forEach(n=>dz.addEventListener(n,e=>{
    e.preventDefault();
    dz.classList.add('drag');
  }));

  ['dragleave','drop'].forEach(n=>dz.addEventListener(n,e=>{
    e.preventDefault();
    dz.classList.remove('drag');
  }));

  dz.addEventListener('drop',e=>{
    if(e.dataTransfer?.files?.[0]) handleFile(e.dataTransfer.files[0]);
  });
}

function setup(){
  // Bind upload FIRST. A runtime-contract error must never disable file selection.
  setupUpload();

  $('policyForm')?.addEventListener('submit',run);

  $('resetPath')?.addEventListener('click',()=>{
    localStorage.removeItem(sessionKey());
    renderPathState(newTemporalState());
    setText('formMessage','Dynamic path reset.');
  });

  $('patientCode')?.addEventListener('change',()=>renderPathState(loadState()));

  const recent=$('recentA5select'), recentHidden=$('recentA5');
  const syncRecent=()=>{if(recent&&recentHidden)recentHidden.checked=recent.value==='1'};
  recent?.addEventListener('change',syncRecent);
  syncRecent();

  renderPathState(loadState());
}

(async()=>{
  setup();
  try{
    setStatus('Checking static V17 runtime…');
    contractsPromise=loadContracts();
    await contractsPromise;
    setStatus('Calculator ready · models load on first calculation',true);
  }catch(e){
    console.error(e);
    setStatus('Runtime asset check failed: '+e.message);
    setText('formMessage','The file uploader is available, but the calculator runtime could not be initialized. Refresh after confirming the runtime/ assets are present.');
  }
})();
