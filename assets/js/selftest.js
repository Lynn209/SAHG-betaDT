import {prepareInput} from './preprocess.js';
import {evaluatePolicy} from './policy.js';
import {sigmoid,softmax} from './math.js';

function maxAbs(a,b){if(a.length!==b.length)return Infinity;let m=0;for(let i=0;i<a.length;i++){const x=Number(a[i]),y=Number(b[i]);if(!Number.isFinite(x)||!Number.isFinite(y)){if(!(Number.isNaN(x)&&Number.isNaN(y))&&x!==y)return Infinity;continue;}m=Math.max(m,Math.abs(x-y));}return m;}
function assertTol(name,a,b,tol,rows){const d=maxAbs(a,b);rows.push({name,max_abs:d,tolerance:tol,pass:d<=tol});if(!(d<=tol))throw Error(`Browser self-test failed: ${name} max_abs=${d} > ${tol}`);}
function actionEligibility(ctx){
  const raw=[1,0,0,0,0,0,1];raw[1]=(ctx.current_anti_mrsa>0||(ctx.current_beta_lactam_count>0&&ctx.current_antibacterial_count>1))?1:0;
  if(Number.isFinite(ctx.current_beta_asi)){raw[2]=ctx.current_beta_asi>=2?1:0;raw[3]=ctx.current_beta_asi>=4?1:0;}raw[4]=ctx.current_beta_lactam_count>0?1:0;raw[5]=ctx.current_antibacterial_count>0?1:0;
  return [raw[0],raw[1],Math.max(raw[2],raw[3]),raw[4],raw[5],raw[6]];
}

export async function runBrowserSelfTest({model,donor,norm,structuralProfiles,gate,lock,policy,oodRef}){
  const fixture=await fetch('runtime/browser_selftest.json').then(r=>{if(!r.ok)throw Error('Missing runtime/browser_selftest.json');return r.json()});
  const tol=fixture.tolerances||{}, rows=[];
  const structural=structuralProfiles.profiles?.miiv;if(!structural)throw Error('Browser self-test requires frozen MIMIC-IV structural profile.');
  const p=prepareInput(fixture.context,fixture.timeline,norm,structural,policy), ep=fixture.expected.prepared;
  assertTol('preprocess.values',p.values,ep.values,tol.preprocess??1e-6,rows);
  assertTol('preprocess.valid',p.valid,ep.valid,0,rows);
  assertTol('preprocess.tidx',p.tidx,ep.tidx,0,rows);
  assertTol('preprocess.vidx',p.vidx,ep.vidx,0,rows);
  assertTol('preprocess.tvals',p.tvals,ep.tvals,tol.preprocess??1e-6,rows);
  assertTol('preprocess.selected_mask',p.selectedMask,ep.selected_mask,0,rows);
  assertTol('preprocess.time',p.time,ep.time,tol.preprocess??1e-6,rows);
  assertTol('preprocess.static',p.static,ep.static,tol.preprocess??1e-6,rows);
  assertTol('preprocess.static_mask',p.staticMask,ep.static_mask,0,rows);
  assertTol('preprocess.structural',p.structural,ep.structural,0,rows);
  const expectedElig=actionEligibility(fixture.context);assertTol('preprocess.eligibility',p.eligibility,expectedElig,0,rows);

  const pred=await model.predict(p,gate);
  assertTol('anchor',pred.anchor,fixture.expected.anchor,tol.anchor??5e-4,rows);
  for(let i=0;i<fixture.expected.models.length;i++){
    const e=fixture.expected.models[i], logits=e.propensity_logits.map((x,k)=>p.eligibility[k]>0?x:-1e9), prop=softmax(logits), g=e.factual_binary_logits.map(sigmoid), r=e.targeted_binary_logits.map(sigmoid);
    assertTol(`model${i}.propensity_probability`,pred.raw[i].prop,prop,tol.model_logits??5e-4,rows);
    assertTol(`model${i}.gcomp_risk`,pred.raw[i].g,g,tol.model_logits??5e-4,rows);
    assertTol(`model${i}.targeted_risk`,pred.raw[i].r,r,tol.model_logits??5e-4,rows);
  }
  const d=donor.query(pred.anchor);
  for(let k=0;k<6;k++){
    const e=fixture.expected.donor[k],a=d[k];
    for(const key of ['estimate','ess','mean_distance','nearest_distance','n_available'])assertTol(`donor.A${k}.${key}`,[a[key]],[e[key]],key==='n_available'?0:(tol.donor??2e-4),rows);
  }
  const ind=evaluatePolicy({pred,donor:d,eligibility:p.eligibility,regimenNode:p.regimen_node,decisionHour:fixture.context.decision_hour_after_t0,recentFactualA5:false,gate,lock,policy,oodRef});
  assertTol('ood_distance',[ind.ood_distance],[fixture.expected.ood_distance],tol.ood??2e-3,rows);
  const py=fixture.expected.policy;
  for(const key of ['independent_recommended_action','true_abstain','ood_flag'])if(Number(ind[key])!==Number(py[key]))throw Error(`Browser self-test failed: policy ${key} browser=${ind[key]} python=${py[key]}`);
  if(String(ind.independent_selection_reason)!==String(py.independent_selection_reason))throw Error(`Browser self-test failed: policy selection reason mismatch`);
  if(String(ind.independent_confidence)!==String(py.independent_confidence))throw Error(`Browser self-test failed: policy confidence mismatch`);
  for(let k=0;k<6;k++){
    const a=ind.actions[k],e=py.actions[k];
    for(const key of ['risk','risk_difference','risk_difference_ucb','propensity','donor_estimate','donor_ess','policy_score'])assertTol(`policy.A${k}.${key}`,[a[key]],[e[key]],tol.donor??2e-4,rows);
    for(const key of ['minimum_support','counterfactual_supported'])if(Number(a[key])!==Number(e[key]))throw Error(`Browser self-test failed: policy A${k} ${key} mismatch`);
  }
  return {status:'PASS',checks:rows.length,max_abs:Math.max(...rows.map(x=>Number.isFinite(x.max_abs)?x.max_abs:0)),details:rows};
}
