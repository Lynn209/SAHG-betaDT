import {clamp} from './math.js';

export function parseTimelineCSV(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length)throw Error('Timeline CSV is empty.');
  const h=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const ih=h.indexOf('rel_t0_hour'),iv=h.indexOf('variable'),iz=h.indexOf('value');
  if(ih<0||iv<0||iz<0)throw Error('CSV requires columns: rel_t0_hour, variable, value.');
  const rows=[];
  for(let i=1;i<lines.length;i++){
    const a=lines[i].split(','), hs=(a[ih]??'').trim(), variable=(a[iv]||'').trim(), vs=(a[iz]??'').trim();
    if(!variable||hs===''||vs==='')continue;
    const hour=Number(hs), value=Number(vs);
    if(!Number.isFinite(hour)||!Number.isFinite(value))throw Error(`Invalid numeric value on CSV line ${i+1}.`);
    rows.push({rel_t0_hour:hour,variable,value});
  }
  return rows;
}

export function regimenNode(c){
  let base;
  if(c.current_antibacterial_count<=0) base='no_systemic_antibacterial';
  else if(c.current_beta_lactam_count<=0) base='non_beta_antibacterial';
  else if(c.current_carbapenem>0 || (Number.isFinite(c.current_beta_asi)&&c.current_beta_asi>=9)) base='carbapenem_or_very_broad_beta';
  else if(Number.isFinite(c.current_beta_asi)&&c.current_beta_asi>=7) base='broad_noncarbapenem_beta';
  else if(Number.isFinite(c.current_beta_asi)&&c.current_beta_asi>=4) base='moderate_beta';
  else base='narrow_beta';
  return base+(c.current_anti_mrsa>0?'_plus_anti_mrsa':'');
}

export function eligibility(c){
  const raw=new Float32Array(7); raw[0]=1;
  raw[1]=(c.current_anti_mrsa>0 || (c.current_beta_lactam_count>0&&c.current_antibacterial_count>1))?1:0;
  if(Number.isFinite(c.current_beta_asi)){raw[2]=c.current_beta_asi>=2?1:0;raw[3]=c.current_beta_asi>=4?1:0;}
  raw[4]=c.current_beta_lactam_count>0?1:0; raw[5]=c.current_antibacterial_count>0?1:0; raw[6]=1;
  return new Float32Array([raw[0],raw[1],Math.max(raw[2],raw[3]),raw[4],raw[5],raw[6]]);
}

function sexValues(sex){
  const s=String(sex||'').toLowerCase(), known=['m','male','f','female'].includes(s);
  return {v:[['m','male'].includes(s)?1:0,['f','female'].includes(s)?1:0],m:[known?1:0,known?1:0]};
}

export function prepareInput(ctx,timeline,norm,structuralObj,policy){
  const vars=norm.variable_order, V=vars.length, T=Math.floor(policy.history_hours*60/policy.grid_minutes)+1, E=policy.max_events;
  const varId=new Map(vars.map((v,i)=>[v,i]));
  const binary=new Set(policy.binary_variables||[]);
  const decisionMin=ctx.decision_hour_after_t0*60, startMin=decisionMin-policy.history_hours*60;
  const availableStart=Math.max(startMin,-policy.pre_t0_history_hours*60);
  const grouped=new Map(), unknown=new Set();
  for(const r of timeline){
    const vid=varId.get(r.variable); if(vid===undefined){unknown.add(r.variable);continue;}
    const tm=r.rel_t0_hour*60; if(tm<availableStart||tm>decisionMin)continue;
    const bin=clamp(Math.floor((tm-startMin)/policy.grid_minutes),0,T-1), key=bin+'|'+vid;
    // The frozen EventStoreDataset consumes canonical events that are already unique
    // at hour × variable. Silently aggregating duplicates would change the model input.
    if(grouped.has(key))throw Error(`Duplicate canonical hour×variable input after 1-h binning: ${r.variable} at rel_t0_hour=${r.rel_t0_hour}. Provide one canonical value per hour×variable.`);
    grouped.set(key,{bin,vid,value:Number(r.value)});
  }
  if(unknown.size)throw Error(`Unknown variable name(s): ${Array.from(unknown).slice(0,8).join(', ')}${unknown.size>8?' …':''}. Use the frozen 66-variable contract exactly.`);
  const x=new Float32Array(T*V), mask=new Float32Array(T*V); let nEvents=0; const observedVars=new Set();
  // Exact EventStoreDataset implicit-zero behavior. V17 currently freezes this list
  // as empty, but retaining the logic protects the contract if the runtime manifest is audited.
  const implicitZero=new Set(policy.implicit_zero_variables||[]);
  const firstAvailableBin=clamp(Math.ceil((availableStart-startMin)/policy.grid_minutes),0,T-1);
  for(const name of implicitZero){const vid=varId.get(name);if(vid===undefined||structuralObj.values[vid]<=0)continue;for(let t=firstAvailableBin;t<T;t++)mask[t*V+vid]=1;}
  for(const g of grouped.values()){
    const name=vars[g.vid], raw=g.value, st=norm.event[name];
    const z=(clamp(raw,Number(st.lower),Number(st.upper))-Number(st.median))/Math.max(Number(st.iqr),1e-6);
    const pos=g.bin*V+g.vid; x[pos]=z; mask[pos]=1; nEvents++; observedVars.add(g.vid);
  }
  if(nEvents<policy.minimum_observed_events)throw Error(`Only ${nEvents} observed hourly events; frozen eligibility requires at least ${policy.minimum_observed_events}.`);
  if(observedVars.size<policy.minimum_observed_variables)throw Error(`Only ${observedVars.size} observed variables; frozen eligibility requires at least ${policy.minimum_observed_variables}.`);

  const events=[];
  for(let t=0;t<T;t++)for(let v=0;v<V;v++){const pos=t*V+v;if(mask[pos]>0)events.push([t,v,x[pos]]);}
  let selected=events;
  if(events.length>E){
    const nRecent=Math.floor(E*0.75), older=events.slice(0,events.length-nRecent), recent=events.slice(events.length-nRecent), nOld=E-nRecent, picks=[];
    if(nOld===1)picks.push(older[0]); else for(let j=0;j<nOld;j++){const p=Math.floor(j*(older.length-1)/(nOld-1));picks.push(older[p]);}
    selected=picks.concat(recent);
  }
  const values=new Float32Array(E),valid=new Float32Array(E),tidx=new Int32Array(E),vidx=new Int32Array(E),tvals=new Float32Array(E),selectedMask=new Float32Array(T*V);
  const time=new Float32Array(T); for(let t=0;t<T;t++)time[t]=t/(T-1);
  if(!selected.length){selected=[[T-1,0,0]];}
  selected.forEach((e,j)=>{if(j>=E)return;const [t,v,z]=e;values[j]=z;valid[j]=events.length?1:0;tidx[j]=t;vidx[j]=v;tvals[j]=time[t];if(events.length)selectedMask[t*V+v]=1;});

  const sc=norm.static_columns, sv=new Float32Array(sc.length+2), sm=new Float32Array(sc.length+2);
  const staticRaw={age:ctx.age,weight_kg:ctx.weight_kg,decision_hour_after_t0:ctx.decision_hour_after_t0,current_beta_asi:ctx.current_beta_asi,current_antibacterial_count:ctx.current_antibacterial_count,current_beta_lactam_count:ctx.current_beta_lactam_count,current_anti_mrsa:ctx.current_anti_mrsa};
  sc.forEach((name,j)=>{const raw=Number(staticRaw[name]);if(Number.isFinite(raw)){const st=norm.static[name];sv[j]=(raw-Number(st.median))/Math.max(Number(st.iqr),1e-6);sm[j]=1;}});
  const sx=sexValues(ctx.sex);sv[sc.length]=sx.v[0];sv[sc.length+1]=sx.v[1];sm[sc.length]=sx.m[0];sm[sc.length+1]=sx.m[1];
  const structural=new Float32Array(structuralObj.values);
  if(structural.length!==V)throw Error('Structural mask dimension mismatch.');
  return {T,V,E,values,valid,tidx,vidx,tvals,selectedMask,time,static:sv,staticMask:sm,structural,eligibility:eligibility(ctx),regimen_node:regimenNode(ctx),nEvents,nVariables:observedVars.size};
}
