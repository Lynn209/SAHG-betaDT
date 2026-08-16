import {parseTimelineCSV,prepareInput} from './preprocess.js?v=8.1';
import {ModelRuntime} from './model.js?v=8.1';
import {DonorRuntime} from './donor.js?v=8.1';
import {evaluatePolicy,applyTemporal,newTemporalState} from './policy.js';
import {runBrowserSelfTest} from './selftest.js?v=8.1';

const $=id=>document.getElementById(id);
const ACTIONS={0:['A0','Continue current regimen','#77AADD'],1:['A1','Remove companion coverage','#F1CE63'],2:['A2','β-lactam de-escalation','#009988'],3:['A3','Discontinue β-lactam','#9467BD'],4:['A4','Discontinue all antibacterials','#E73F74'],5:['A5','Rescue / escalation-or-other','#882255'],'-1':['Ø','True abstention','#AAAA00']};

let timeline=[],norm,structuralProfiles,gate,lock,policy,oodRef,model,donor,loaded=false;
let contractsPromise=null, contractsReady=false, currentFile=null, currentFileUrl=null, fileValid=false;
let calcTimer=null, calcStartedAt=0;

const esc=x=>String(x??'').replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const pct=x=>Number.isFinite(+x)?(+x*100).toFixed(1)+'%':'—';
const num=(x,d=2)=>Number.isFinite(+x)?(+x).toFixed(d):'—';
const setText=(id,text)=>{const el=$(id);if(el)el.textContent=text};

function setStatus(text,ok=false){
  setText('runtimeStatusText',text);
  const el=$('runtimeStatus');
  if(el)el.classList.toggle('ready',ok);
}

function setCalcProgress(pctValue,label,state='running'){
  const wrap=$('calcProgress'),bar=$('calcProgressBar'),pctEl=$('calcProgressPct'),labelEl=$('calcProgressLabel');
  if(!wrap||!bar||!pctEl||!labelEl)return;

  wrap.classList.remove('hidden','success','error');
  if(state==='success')wrap.classList.add('success');
  if(state==='error')wrap.classList.add('error');

  const p=Math.max(0,Math.min(100,Math.round(pctValue)));
  bar.style.width=p+'%';
  pctEl.textContent=p+'%';
  labelEl.textContent=label;
}

function hideCalcProgress(){
  const wrap=$('calcProgress');
  if(wrap)wrap.classList.add('hidden');
}

function formatElapsed(ms){
  const s=Math.max(0,Math.floor(ms/1000));
  if(s<60)return `${s} s`;
  const m=Math.floor(s/60),r=s%60;
  return `${m}:${String(r).padStart(2,'0')}`;
}

function startCalcTimer(){
  stopCalcTimer();
  calcStartedAt=performance.now();
  setText('calcElapsed','0 s');
  calcTimer=setInterval(()=>{
    setText('calcElapsed',formatElapsed(performance.now()-calcStartedAt));
  },500);
}

function stopCalcTimer(){
  if(calcTimer){
    clearInterval(calcTimer);
    calcTimer=null;
  }
  if(calcStartedAt){
    setText('calcElapsed',formatElapsed(performance.now()-calcStartedAt));
  }
}

function paint(){
  return new Promise(resolve=>requestAnimationFrame(()=>resolve()));
}

function sessionKey(){return 'sahg_v17_path_'+(($('patientCode')?.value||'WEB-001').trim()||'WEB-001')}
function loadState(){try{return JSON.parse(localStorage.getItem(sessionKey()))||newTemporalState()}catch{return newTemporalState()}}
function saveState(s){localStorage.setItem(sessionKey(),JSON.stringify(s));renderPathState(s)}
function renderPathState(s){
  setText('pathState',`stage=${s.stage} · cooldown=${s.cooldown} · pending=${s.pending_count}${s.pending_hour!=null?' @ '+s.pending_hour+'h':''} · last=${s.last_hour==null?'none':s.last_hour+'h'}`);
}

function numericFieldValid(id){
  const el=$(id);
  if(!el || el.value.trim()==='') return false;
  const x=Number(el.value);
  if(!Number.isFinite(x)) return false;
  if(el.min!=='' && x<Number(el.min)) return false;
  if(el.max!=='' && x>Number(el.max)) return false;
  return true;
}

function patientFieldsValid(){
  const numericIds=['age','weight','betaAsi','abxCount','betaCount'];
  if(!numericIds.every(numericFieldValid)) return false;

  const abx=Number($('abxCount').value);
  const beta=Number($('betaCount').value);
  if(!Number.isInteger(abx) || !Number.isInteger(beta)) return false;
  if(beta>abx) return false;

  return Boolean(
    $('decisionHour')?.value &&
    $('sex')?.value &&
    $('antiMrsa')?.value !== '' &&
    $('carbapenem')?.value !== '' &&
    $('recentA5select')?.value !== ''
  );
}

function updateRunState(){
  const btn=$('runBtn');
  if(!btn) return;

  const fieldsOk=patientFieldsValid();
  const inputReady=fieldsOk && fileValid && timeline.length>0;

  // UI readiness depends only on user input.
  // Frozen runtime/model assets are loaded or retried after the user clicks.
  btn.disabled=!inputReady;

  const hint=$('readyHint');
  if(!hint) return;

  if(!fieldsOk){
    hint.textContent='Complete all required patient fields to continue.';
    hint.classList.remove('ready');
  }else if(!fileValid || !timeline.length){
    hint.textContent='Upload a valid longitudinal timeline CSV to continue.';
    hint.classList.remove('ready');
  }else if(!contractsReady){
    hint.textContent='Ready — click the button to load the frozen V17 runtime and calculate.';
    hint.classList.add('ready');
  }else{
    hint.textContent='Ready — patient information and timeline CSV are complete.';
    hint.classList.add('ready');
  }
}

async function loadContracts(){
  [norm,structuralProfiles,gate,lock,policy,oodRef]=await Promise.all(
    ['runtime/normalization.json?v=6.1','runtime/structural_masks.json?v=6.1','runtime/gate_calibration.json?v=6.1','runtime/policy_lock.json?v=6.1','runtime/runtime_policy.json?v=6.1','runtime/ood_reference.json?v=6.1']
      .map(u=>fetch(u,{cache:'no-store'}).then(r=>{if(!r.ok)throw Error('Missing runtime asset: '+u);return r.json()}))
  );

  const s=await fetch('data/policy_summary.json?v=6.1',{cache:'no-store'}).then(r=>r.json()).catch(()=>null);
  if(s?.development_selection){
    setText('statPatients',s.development_selection.n_evaluable_patients?.toLocaleString?.() ?? '');
    setText('statDecisions',s.development_selection.n_evaluable_decisions?.toLocaleString?.() ?? '');
    setText('statAbstain',pct(s.development_selection.true_abstention_rate));
    setText('statESS',num(s.development_selection.median_selected_donor_ess,1));
  }
}

async function ensureContracts(){
  if(contractsReady && norm && structuralProfiles && gate && lock && policy && oodRef) return;

  setStatus('Loading frozen V17 runtime contracts…');

  // Always create a fresh retry promise after an earlier failure.
  contractsPromise=loadContracts();

  try{
    await contractsPromise;
    contractsReady=true;
    setStatus('Runtime contracts ready · models load on calculation',true);
  }catch(e){
    contractsReady=false;
    contractsPromise=null;
    throw e;
  }finally{
    updateRunState();
  }
}

async function ensureRuntime(){
  if(loaded){
    setCalcProgress(78,'Frozen V17 runtime already loaded');
    return;
  }

  setCalcProgress(8,'Loading frozen V17 runtime contracts…');
  await ensureContracts();
  await paint();

  setStatus('Loading frozen ONNX models and donor runtime…');

  model=await new ModelRuntime().load((fraction,label)=>{
    setCalcProgress(12+fraction*38,label);
  });

  donor=await new DonorRuntime().load((fraction,label)=>{
    setCalcProgress(50+fraction*22,label);
  });

  setStatus('Running browser-vs-Python V17 self-test…');
  const qa=await runBrowserSelfTest({
    model,donor,norm,structuralProfiles,gate,lock,policy,oodRef,
    onProgress:(fraction,label)=>setCalcProgress(72+fraction*16,label)
  });

  loaded=true;
  setCalcProgress(88,`Browser self-test PASS · ${qa.checks} checks`,'success');
  setStatus(`V17 browser runtime verified · ${qa.checks} checks PASS`,true);
  setText('selfTestInfo',`Runtime self-test PASS · max numeric deviation ${qa.max_abs.toExponential(2)}`);
}

function setProgress(pctValue,label,complete=false){
  const wrap=$('uploadProgress'), bar=$('uploadProgressBar'), pctEl=$('uploadProgressPct'), labelEl=$('uploadProgressLabel');
  if(!wrap||!bar||!pctEl||!labelEl)return;
  wrap.classList.remove('hidden');
  wrap.classList.toggle('complete',complete);
  const p=Math.max(0,Math.min(100,Math.round(pctValue)));
  bar.style.width=p+'%';
  pctEl.textContent=p+'%';
  labelEl.textContent=label;
}

function clearUploadedFileCard(){
  $('uploadedFileCard')?.classList.remove('show');
  setText('uploadedFileName','—');
  setText('uploadedFileMeta','—');
  const dl=$('uploadedFileDownload');
  if(dl){
    dl.removeAttribute('href');
    dl.removeAttribute('download');
  }
  if(currentFileUrl){
    URL.revokeObjectURL(currentFileUrl);
    currentFileUrl=null;
  }
}

function showUploadedFileCard(f){
  currentFile=f;
  clearUploadedFileCard();
  currentFile=f;
  currentFileUrl=URL.createObjectURL(f);

  setText('uploadedFileName',f.name);
  const vs=new Set(timeline.map(x=>x.variable));
  const hs=timeline.map(x=>x.rel_t0_hour);
  const size=f.size<1024 ? `${f.size} B` : f.size<1024*1024 ? `${(f.size/1024).toFixed(1)} KB` : `${(f.size/1024/1024).toFixed(2)} MB`;
  setText('uploadedFileMeta',`${timeline.length} rows · ${vs.size} recognized measurements · ${Math.min(...hs)} to ${Math.max(...hs)} h · ${size}`);

  const dl=$('uploadedFileDownload');
  if(dl){
    dl.href=currentFileUrl;
    dl.download=f.name;
    dl.textContent='Download';
  }
  $('uploadedFileCard')?.classList.add('show');
}

function summary(){
  const fs=$('fileSummary');
  if(!fs)return;
  const first=fs.querySelector('.timeline-status') || fs.firstElementChild;
  if(!timeline.length){
    if(first) first.textContent='No timeline loaded';
    return;
  }
  if(first) first.textContent='Timeline CSV loaded and validated';
}

function readFileWithProgress(f){
  return new Promise((resolve,reject)=>{
    const reader=new FileReader();

    reader.onloadstart=()=>{
      setProgress(2,'Loading CSV locally…',false);
    };

    reader.onprogress=e=>{
      if(e.lengthComputable){
        setProgress(Math.max(5,(e.loaded/e.total)*90),'Loading CSV locally…',false);
      }else{
        setProgress(45,'Loading CSV locally…',false);
      }
    };

    reader.onerror=()=>reject(reader.error || new Error('Unable to read the selected CSV.'));
    reader.onabort=()=>reject(new Error('CSV loading was cancelled.'));
    reader.onload=()=>resolve(String(reader.result ?? ''));

    reader.readAsText(f);
  });
}

async function handleFile(f){
  if(!f)return;
  timeline=[];
  fileValid=false;
  clearUploadedFileCard();
  summary();
  updateRunState();
  setText('formMessage','');

  try{
    const text=await readFileWithProgress(f);
    setProgress(94,'Validating clinical measurement names…',false);
    timeline=parseTimelineCSV(text);
    fileValid=timeline.length>0;
    showUploadedFileCard(f);
    summary();
    setProgress(100,'CSV loaded and validated',true);
    setText('formMessage','');
  }catch(e){
    timeline=[];
    fileValid=false;
    summary();
    setProgress(100,'CSV could not be validated',false);
    setText('formMessage',e.message || String(e));
  }finally{
    updateRunState();
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

  if(!patientFieldsValid()){
    setText('formMessage','Please complete all required patient fields with valid values.');
    updateRunState();
    return;
  }
  if(!fileValid || !timeline.length){
    setText('formMessage','Please upload a valid timeline CSV first.');
    updateRunState();
    return;
  }
  const mode=$('mode').value,dh=+$('decisionHour').value,state=loadState();

  $('runBtn').disabled=true;
  $('runBtn').querySelector('span').textContent='Running SAHG-βDT locally…';
  setText('readyHint','Running the calculator locally in this browser…');
  $('readyHint')?.classList.remove('ready');

  startCalcTimer();
  setCalcProgress(2,'Validating patient information and timeline…');
  await paint();

  try{
    await ensureContracts();
    await ensureRuntime();

    setCalcProgress(89,'Preparing patient-specific model input…');
    await paint();

    const c=context(),sp=structuralProfiles.profiles[c.source_profile];
    if(!sp)throw Error(`Unknown structural profile: ${c.source_profile}`);

    const p=prepareInput(c,timeline,norm,sp,policy);

    const pred=await model.predict(p,gate,(fraction,label)=>{
      setCalcProgress(90+fraction*6,label);
    });

    setCalcProgress(97,'Evaluating nearest-donor support and ESS…');
    await paint();
    const d=donor.query(pred.anchor);

    setCalcProgress(99,'Applying frozen coverage_p050 safety policy…');
    await paint();
    const ind=evaluatePolicy({
      pred,donor:d,eligibility:p.eligibility,regimenNode:p.regimen_node,
      decisionHour:c.decision_hour_after_t0,recentFactualA5:$('recentA5').checked,
      gate,lock,policy,oodRef
    });
    const final=applyTemporal(ind,policy,state,mode);
    if(mode==='dynamic')saveState(final.state);
    render(final,p);
    setCalcProgress(100,'Recommendation ready','success');
    setText('formMessage','');
  }catch(err){
    console.error(err);
    const msg=err?.message || String(err);
    setCalcProgress(100,'Calculation stopped','error');
    setText('formMessage','Calculation could not start: '+msg);
    setStatus('Runtime error · '+msg);
  }finally{
    stopCalcTimer();
    $('runBtn').querySelector('span').textContent='Get SAHG-βDT recommendation';
    updateRunState();
  }
}

function setupUpload(){
  const dz=$('dropZone'), fi=$('timelineFile'), choose=$('chooseFile');
  if(!dz||!fi)return;

  // Native label-for-file opens the picker even if runtime/model JS later fails.
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
    if(fi.files?.[0])handleFile(fi.files[0]);
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
    if(e.dataTransfer?.files?.[0])handleFile(e.dataTransfer.files[0]);
  });
}

function setupValidation(){
  const ids=['decisionHour','sex','age','weight','betaAsi','abxCount','betaCount','antiMrsa','carbapenem','recentA5select'];
  for(const id of ids){
    const el=$(id);
    if(!el)continue;
    el.addEventListener('input',updateRunState);
    el.addEventListener('change',updateRunState);
  }
}

function setup(){
  setupUpload();
  setupValidation();

  $('policyForm')?.addEventListener('submit',run);

  $('resetPath')?.addEventListener('click',()=>{
    localStorage.removeItem(sessionKey());
    renderPathState(newTemporalState());
    setText('formMessage','Dynamic path reset.');
  });

  $('patientCode')?.addEventListener('change',()=>renderPathState(loadState()));

  const recent=$('recentA5select'), recentHidden=$('recentA5');
  const syncRecent=()=>{
    if(recent&&recentHidden)recentHidden.checked=recent.value==='1';
    updateRunState();
  };
  recent?.addEventListener('change',syncRecent);
  syncRecent();

  renderPathState(loadState());
  updateRunState();
}

(async()=>{
  setup();

  // Best-effort background check only.
  // A transient asset/cache/network failure must never permanently disable
  // the recommendation button; clicking the button retries the contracts.
  try{
    setStatus('Checking static V17 runtime…');
    contractsPromise=loadContracts();
    await contractsPromise;
    contractsReady=true;
    setStatus('Calculator ready · models load on first calculation',true);
  }catch(e){
    console.warn('Background runtime contract check failed; calculation will retry on demand.',e);
    contractsReady=false;
    contractsPromise=null;
    setStatus('Runtime will be checked when you calculate');
  }finally{
    updateRunState();
  }
})();

window.addEventListener('beforeunload',()=>{
  if(currentFileUrl)URL.revokeObjectURL(currentFileUrl);
});
