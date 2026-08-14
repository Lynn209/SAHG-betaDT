import {clamp,effectSign,finite} from './math.js';

const Z95_ONE_SIDED=1.6448536269514722;

function mapNum(obj,k,d){if(obj==null)return d;const v=obj[String(k)]??obj[k];return v==null?d:Number(v)}
function mapBool(obj,k,d){if(obj==null)return d;const v=obj[String(k)]??obj[k];return v==null?d:Boolean(v)}

export function oodDistance(anchor,ref){let s=0;const n=anchor.length,d=new Float64Array(n);for(let i=0;i<n;i++)d[i]=anchor[i]-ref.mean[i];for(let i=0;i<n;i++){let r=0;const row=ref.inv_cov[i];for(let j=0;j<n;j++)r+=row[j]*d[j];s+=d[i]*r;}return s;}

function issueCount(a){return (a.soft_propensity_deficit>0?1:0)+(a.soft_ess_deficit>0.5?1:0)+(a.soft_distance_excess>0?1:0)+(a.soft_node_penalty>0?1:0)+(a.soft_disagreement_ratio>1?1:0)+(a.soft_direction_penalty>0?1:0)}

export function evaluatePolicy({pred,donor,eligibility,regimenNode,decisionHour,recentFactualA5,gate,lock,policy,oodRef}){
  const oodD=oodDistance(pred.anchor,oodRef),ood=oodD>Number(oodRef.threshold),n=6,actions=[];
  const risk0=pred.risks[0], donor0=donor[0].estimate, ess0=donor[0].ess;
  const nodeMap=gate.development_regimen_node_action_support||{},devSupport=gate.development_action_support||{};
  const dthr=gate.donor_distance_thresholds||{},radii=gate.paired_risk_difference_radii||{},pmin=gate.minimum_propensity_by_action||{},pmax=gate.maximum_propensity_by_action||{},agreeThr=gate.maximum_model_donor_disagreement_by_action||{};
  const recommendable=new Set(policy.recommendable_gate_actions||[0,1,2,3]),margin=Number(gate.noninferiority_margin_absolute_risk??policy.noninferiority_margin),tol=Number(policy.direction_tolerance||0.005);
  for(let k=0;k<n;k++){
    const risk=pred.risks[k],sd=pred.diffSd[k],delta=risk-risk0,radius=mapNum(radii,k,0),ucb=delta+Z95_ONE_SIDED*sd+radius,prop=pred.props[k],dn=donor[k],donorDelta=dn.estimate-donor0,gcompDelta=pred.gcomp[k]-pred.gcomp[0];
    const ts=effectSign(delta,tol),ds=effectSign(donorDelta,tol),gs=effectSign(gcompDelta,tol);let direction=((ts===ds||ts===0||ds===0)&&(ts===gs||ts===0||gs===0)&&finite(donorDelta)&&finite(gcompDelta));if(k===0)direction=true;
    const nodeOk=Boolean(nodeMap[`${regimenNode}|${k}`]),distanceOk=dn.mean_distance<=mapNum(dthr,k,Infinity)&&mapBool(devSupport,k,false),pLo=mapNum(pmin,k,0.05),pHi=mapNum(pmax,k,1),agreement=Math.abs(delta-donorDelta),aThr=mapNum(agreeThr,k,0.05);
    const referenceFailure=k!==0&&(ess0<Number(gate.minimum_effective_sample_size||10)||!(donor[0].mean_distance<=mapNum(dthr,0,Infinity)&&mapBool(devSupport,0,false))||!Boolean(nodeMap[`${regimenNode}|0`])||!finite(donor0));
    const supported=eligibility[k]>0 && prop>=pLo && prop<=pHi && dn.ess>=Number(gate.minimum_effective_sample_size||10) && distanceOk && nodeOk && finite(dn.estimate) && !referenceFailure && agreement<=aThr && direction && !ood;
    let safe=supported&&ucb<=margin&&recommendable.has(k);if(k===0)safe=supported&&recommendable.has(0);
    actions.push({action:k,risk,gcomp_risk:pred.gcomp[k],risk_difference:delta,risk_difference_ucb:ucb,risk_difference_ensemble_sd:sd,propensity:prop,donor_estimate:dn.estimate,donor_ess:dn.ess,donor_mean_distance:dn.mean_distance,donor_nearest_distance:dn.nearest_distance,n_available_donors:dn.n_available,node_action_supported:nodeOk?1:0,donor_distance_ok:distanceOk?1:0,directionally_agree:direction?1:0,model_donor_contrast_disagreement:agreement,counterfactual_supported:supported?1:0,safe_action:safe?1:0,paired_radius:radius});
  }

  // Stage07c attach_support_and_penalties, frozen Stage08 settings.
  const hardMin=Number(lock.hard_minimum_donor_ess??policy.hard_minimum_donor_ess),hardProp=Number(lock.hard_propensity_floor??policy.hard_propensity_floor),preferred=Number(lock.preferred_donor_ess??policy.preferred_donor_ess),cap=Number(lock.calibration_radius_cap??policy.calibration_radius_cap),profile=policy.coverage_profile;
  for(const a of actions){const k=a.action,pLo=mapNum(pmin,k,0),distT=mapNum(dthr,k,Infinity),disT=mapNum(agreeThr,k,0.05),radius=mapNum(radii,k,0),globalSupport=mapBool(devSupport,k,false),finiteCore=[a.risk,a.risk_difference,a.risk_difference_ensemble_sd,a.propensity,a.donor_estimate,a.donor_ess,a.donor_mean_distance].every(finite),propAbs=k===0||a.propensity>=hardProp;
    a.minimum_support_base=(eligibility[k]>0&&finiteCore&&propAbs&&a.donor_ess>=hardMin&&a.n_available_donors>=1&&globalSupport&&!ood)?1:0;
    const propDen=Math.max(pLo,hardProp,1e-6);a.soft_propensity_deficit=clamp((pLo-a.propensity)/propDen,0,2);a.soft_ess_deficit=clamp((preferred-a.donor_ess)/Math.max(preferred,1e-6),0,1);a.soft_distance_excess=Number.isFinite(distT)&&distT>0?clamp(a.donor_mean_distance/distT-1,0,2):(finite(a.donor_mean_distance)?0:2);a.soft_node_penalty=a.node_action_supported?0:1;a.soft_disagreement_ratio=clamp(a.model_donor_contrast_disagreement/Math.max(disT,1e-6),0,2);a.soft_direction_penalty=a.directionally_agree?0:1;a.soft_uncertainty_width=clamp(Z95_ONE_SIDED*Math.max(a.risk_difference_ensemble_sd,0),0,1);a.soft_calibration_component=Math.min(Math.max(radius,0),cap);
  }
  const a0base=actions[0].minimum_support_base===1;for(const a of actions)a.minimum_support=(a.action===0?a.minimum_support_base:(a.minimum_support_base&&a0base?1:0));
  const coreMissing=!actions.some(a=>finite(a.risk)),noEligible=Array.from(eligibility).every(x=>x<=0),noSupport=actions.every(a=>a.minimum_support!==1),a0Missing=actions[0].minimum_support!==1;let abstainReason='not_abstain';if(noSupport)abstainReason='all_actions_lack_minimum_support';if(a0Missing)abstainReason='reference_A0_lacks_minimum_support';if(noEligible)abstainReason='no_clinically_implementable_action';if(coreMissing)abstainReason='input_data_severely_insufficient';if(ood)abstainReason='out_of_distribution';const trueAbstain=abstainReason!=='not_abstain';

  for(const a of actions){a.policy_score=a.risk_difference+profile.uncertainty_weight*a.soft_uncertainty_width+profile.calibration_weight*a.soft_calibration_component+profile.propensity_weight*a.soft_propensity_deficit+profile.ess_weight*a.soft_ess_deficit+profile.distance_weight*a.soft_distance_excess+profile.node_weight*a.soft_node_penalty+profile.disagreement_weight*a.soft_disagreement_ratio+profile.direction_weight*a.soft_direction_penalty;a.soft_issue_count=issueCount(a);}
  const strictSupported=k=>actions[k].counterfactual_supported===1;
  const stopGate=decisionHour>=profile.minimum_stop_hour&&actions[0].risk<=profile.stop_reference_risk_max&&actions[4].risk<=profile.stop_action_risk_max&&!recentFactualA5&&eligibility[4]>0;
  const rescue=actions[5].minimum_support===1&&strictSupported(5)&&actions[0].risk>=policy.shared_rescue_reference_risk_min&&actions[5].risk<actions[0].risk&&actions[5].risk_difference<=policy.shared_rescue_delta_max&&actions[5].risk_difference_ucb<=policy.shared_rescue_ucb_max&&!trueAbstain;
  const pass=new Array(6).fill(false);for(const k of policy.active_deescalation_actions){const a=actions[k];pass[k]=a.minimum_support===1&&a.risk_difference<=profile.raw_delta_ceiling&&a.policy_score<=profile.score_limit;}pass[4]=pass[4]&&stopGate;
  let selected=0,reason='continue_no_active_adjustment_passed';for(const k of policy.active_deescalation_actions)if(pass[k])selected=k;if(pass.slice(1,5).some(Boolean))reason='active_adjustment_selected';if(rescue){selected=5;reason='A5_rescue_override';}if(trueAbstain){selected=-1;reason=abstainReason;}
  let confidence='Low confidence';if(selected===-1)confidence='Abstain';else if(selected===0)confidence=actions[0].safe_action===1?'High confidence':'Moderate confidence';else{const a=actions[selected],high=strictSupported(selected)&&a.risk_difference_ucb<=0.05,moderate=!high&&a.policy_score<=0.05&&a.soft_issue_count<=2;confidence=high?'High confidence':(moderate?'Moderate confidence':'Low confidence');}
  return {candidate_id:'coverage_p050',policy_family:'coverage',policy_mode:'penalized_risk_difference',decision_hour_after_t0:decisionHour,current_regimen_node:regimenNode,ood_distance:oodD,ood_flag:ood?1:0,true_abstain:trueAbstain?1:0,true_abstain_reason:abstainReason,independent_recommended_action:selected,independent_selection_reason:reason,independent_confidence:confidence,rescue_trigger:rescue?1:0,stop_all_proxy_gate:stopGate?1:0,actions};
}

export function newTemporalState(){return {stage:0,cooldown:0,pending_level:0,pending_count:0,pending_hour:null,first_done:false,last_hour:null};}
export function applyTemporal(ind,policy,state,mode='dynamic'){
  if(mode!=='dynamic')return {...ind,recommended_action:ind.independent_recommended_action,recommendation_confidence:ind.independent_confidence,transition_type:'independent_landmark_only',policy_stage_before:state.stage,policy_stage_after:state.stage,pending_confirmation:0,state};
  const s={...state};const independent=ind.independent_recommended_action,confidence=ind.independent_confidence,hour=ind.decision_hour_after_t0,stageBefore=s.stage;let final=independent,transition='continue_current_regimen',pending=0,reverse=0;
  if(s.last_hour!=null&&hour<=s.last_hour)throw Error('Dynamic mode requires strictly increasing decision landmarks. Reset the dynamic path to restart.');
  if(independent===-1){final=-1;transition='true_abstain';s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
  else if(independent===5){final=5;transition='rescue_override';s.stage=0;s.cooldown=policy.coverage_profile.rescue_cooldown_decisions;s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
  else if(s.cooldown>0){final=0;transition='post_rescue_cooldown_hold';s.cooldown-=1;s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
  else if(policy.active_deescalation_actions.includes(independent)){
    if(independent<=s.stage){final=0;transition='maintain_prior_policy_stage';reverse=independent<s.stage?1:0;s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
    else{const confReq=confidence==='Low confidence'?policy.coverage_profile.low_confidence_confirmation_count:1,actReq=independent===4?policy.A4_required_confirmations:1,req=Math.max(confReq,actReq),adj=s.pending_hour!=null&&hour-s.pending_hour>0&&hour-s.pending_hour<=30;
      if(req>1){if(adj&&independent>=s.pending_level){s.pending_count+=1;s.pending_level=Math.max(s.pending_level,independent);}else{s.pending_level=independent;s.pending_count=1;}s.pending_hour=hour;if(s.pending_count<req){final=0;transition='pending_low_confidence_confirmation';pending=1;}else{final=s.pending_level;s.stage=s.pending_level;transition='confirmed_deescalation_advance';s.pending_level=0;s.pending_count=0;s.pending_hour=null;}}
      else{final=independent;s.stage=independent;transition='deescalation_advance';s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
    }
  } else {final=0;transition=s.stage>0?'maintain_prior_policy_stage':'continue_current_regimen';s.pending_level=0;s.pending_count=0;s.pending_hour=null;}
  let finalConfidence=confidence;if(final!==independent&&final===0)finalConfidence=ind.actions[0].minimum_support===1?'Moderate confidence':'Low confidence';s.last_hour=hour;
  return {...ind,recommended_action:final,recommendation_confidence:finalConfidence,transition_type:transition,policy_stage_before:stageBefore,policy_stage_after:s.stage,pending_confirmation:pending,raw_reverse_signal:reverse,state:s};
}
