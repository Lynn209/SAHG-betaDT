import {clamp} from './math.js';

/*
 * Public input contract:
 *   time_from_t0_hours, measurement, value [, unit_or_encoding]
 *
 * The browser translates publication-ready clinical measurement names into the
 * frozen internal 66-variable identifiers before any model preprocessing.
 * Legacy rel_t0_hour,variable,value files remain supported for reproducibility.
 */
export const MEASUREMENT_DEFINITIONS = {
  "heart_rate": {label:"Heart rate", unit:"beats/min"},
  "systolic_bp": {label:"Systolic blood pressure", unit:"mmHg"},
  "diastolic_bp": {label:"Diastolic blood pressure", unit:"mmHg"},
  "map": {label:"Mean arterial pressure", unit:"mmHg"},
  "respiratory_rate": {label:"Respiratory rate", unit:"breaths/min"},
  "spo2": {label:"Peripheral oxygen saturation (SpO₂)", unit:"%"},
  "temperature": {label:"Body temperature", unit:"°C"},
  "fio2": {label:"Fraction of inspired oxygen (FiO₂)", unit:"%"},
  "po2": {label:"Arterial oxygen partial pressure (PaO₂)", unit:"mmHg"},
  "safi": {label:"SpO₂/FiO₂ ratio (S/F ratio)", unit:"ratio"},
  "pafi": {label:"PaO₂/FiO₂ ratio (P/F ratio)", unit:"ratio"},
  "lactate": {label:"Blood lactate", unit:"mmol/L"},
  "creatinine": {label:"Serum creatinine", unit:"mg/dL"},
  "bun": {label:"Blood urea nitrogen", unit:"mg/dL"},
  "sodium": {label:"Serum sodium", unit:"mmol/L"},
  "potassium": {label:"Serum potassium", unit:"mmol/L"},
  "chloride": {label:"Serum chloride", unit:"mmol/L"},
  "bicarbonate": {label:"Serum bicarbonate", unit:"mmol/L"},
  "glucose": {label:"Blood glucose", unit:"mg/dL"},
  "calcium": {label:"Total serum calcium", unit:"mg/dL"},
  "ionized_calcium": {label:"Ionized calcium", unit:"mmol/L"},
  "hemoglobin": {label:"Hemoglobin", unit:"g/dL"},
  "hematocrit": {label:"Hematocrit", unit:"%"},
  "platelet": {label:"Platelet count", unit:"×10⁹/L"},
  "wbc": {label:"White blood cell count", unit:"×10⁹/L"},
  "neutrophil_pct": {label:"Neutrophils", unit:"%"},
  "lymphocyte_pct": {label:"Lymphocytes", unit:"%"},
  "albumin": {label:"Serum albumin", unit:"g/dL"},
  "bilirubin": {label:"Total bilirubin", unit:"mg/dL"},
  "crp": {label:"C-reactive protein (CRP)", unit:"mg/L"},
  "inr_pt": {label:"International normalized ratio (INR)", unit:"ratio"},
  "pt": {label:"Prothrombin time (PT)", unit:"s"},
  "ptt": {label:"Partial thromboplastin time (PTT)", unit:"s"},
  "sofa": {label:"Sequential Organ Failure Assessment (SOFA) score", unit:"points"},
  "sirs": {label:"Systemic Inflammatory Response Syndrome (SIRS) score", unit:"points"},
  "news": {label:"National Early Warning Score (NEWS)", unit:"points"},
  "news_partial": {label:"Partial NEWS indicator", unit:"0/1"},
  "gcs": {label:"Glasgow Coma Scale (GCS)", unit:"points"},
  "urine": {label:"Urine output", unit:"mL/h"},
  "invasive_ventilation": {label:"Invasive mechanical ventilation", unit:"0/1"},
  "hfnc": {label:"High-flow nasal cannula (HFNC)", unit:"0/1"},
  "niv": {label:"Non-invasive ventilation (NIV)", unit:"0/1"},
  "tracheostomy": {label:"Tracheostomy", unit:"0/1"},
  "rrt_present": {label:"Renal replacement therapy present", unit:"0/1"},
  "rrt_active": {label:"Renal replacement therapy active", unit:"0/1"},
  "ecmo_any": {label:"Extracorporeal membrane oxygenation (ECMO)", unit:"0/1"},
  "vaso_ind": {label:"Vasopressor use", unit:"0/1"},
  "norepi_equiv": {label:"Norepinephrine-equivalent dose", unit:"µg/kg/min"},
  "norepi_rate": {label:"Norepinephrine infusion rate", unit:"µg/kg/min"},
  "epi_rate": {label:"Epinephrine infusion rate", unit:"µg/kg/min"},
  "dopa_rate": {label:"Dopamine infusion rate", unit:"µg/kg/min"},
  "dobu_rate": {label:"Dobutamine infusion rate", unit:"µg/kg/min"},
  "vasopressin_rate": {label:"Vasopressin infusion rate", unit:"U/min"},
  "sedation_ind": {label:"Sedation exposure", unit:"0/1"},
  "treatment_active_antibacterial_count": {label:"Number of active systemic antibacterials", unit:"count"},
  "treatment_active_beta_lactam_count": {label:"Number of active β-lactams", unit:"count"},
  "treatment_anti_mrsa": {label:"Anti-MRSA coverage", unit:"0/1"},
  "treatment_beta_asi": {label:"β-lactam Modified Antibiotic Spectrum Index (ASI)", unit:"points"},
  "treatment_carbapenem": {label:"Carbapenem exposure", unit:"0/1"},
  "treatment_anaerobic_addon": {label:"Additional anaerobic coverage", unit:"0/1"},
  "treatment_atypical_coverage": {label:"Atypical pathogen coverage", unit:"0/1"},
  "treatment_aminoglycoside": {label:"Aminoglycoside exposure", unit:"0/1"},
  "treatment_fluoroquinolone": {label:"Fluoroquinolone exposure", unit:"0/1"},
  "treatment_polymyxin": {label:"Polymyxin exposure", unit:"0/1"},
  "treatment_antifungal": {label:"Antifungal exposure", unit:"0/1"},
  "treatment_antiviral": {label:"Antiviral exposure", unit:"0/1"}
};

function normalizeMeasurementLabel(x){
  return String(x ?? '')
    .trim()
    .toLowerCase()
    .replace(/β/g,'beta')
    .replace(/₂/g,'2')
    .replace(/⁹/g,'9')
    .replace(/[–—−]/g,'-')
    .replace(/[_]+/g,' ')
    .replace(/[^a-z0-9%/+.-]+/g,' ')
    .replace(/\s+/g,' ')
    .trim();
}

const measurementAliasMap = new Map();
for(const [canonical, d] of Object.entries(MEASUREMENT_DEFINITIONS)){
  measurementAliasMap.set(normalizeMeasurementLabel(canonical), canonical);
  measurementAliasMap.set(normalizeMeasurementLabel(d.label), canonical);
}

// Common publication/clinical abbreviations accepted in addition to the template labels.
const EXTRA_ALIASES = {
  'hr':'heart_rate',
  'sbp':'systolic_bp',
  'dbp':'diastolic_bp',
  'mean arterial pressure':'map',
  'rr':'respiratory_rate',
  'spo2':'spo2',
  'fio2':'fio2',
  'pao2':'po2',
  'sf ratio':'safi',
  's/f ratio':'safi',
  'pf ratio':'pafi',
  'p/f ratio':'pafi',
  'bun':'bun',
  'wbc':'wbc',
  'crp':'crp',
  'inr':'inr_pt',
  'sofa':'sofa',
  'sirs':'sirs',
  'news':'news',
  'gcs':'gcs',
  'hfnc':'hfnc',
  'niv':'niv',
  'ecmo':'ecmo_any',
  'rrt present':'rrt_present',
  'rrt active':'rrt_active'
};
for(const [alias, canonical] of Object.entries(EXTRA_ALIASES)){
  measurementAliasMap.set(normalizeMeasurementLabel(alias), canonical);
}

export function canonicalMeasurementName(name){
  return measurementAliasMap.get(normalizeMeasurementLabel(name)) ?? null;
}

export function parseTimelineCSV(text){
  const lines=text.replace(/^\uFEFF/,'').split(/\r?\n/).filter(x=>x.trim());
  if(!lines.length)throw Error('Timeline CSV is empty.');

  const h=lines[0].split(',').map(x=>x.trim().toLowerCase());
  const ih = h.indexOf('time_from_t0_hours') >= 0
    ? h.indexOf('time_from_t0_hours')
    : h.indexOf('rel_t0_hour');
  const im = h.indexOf('measurement') >= 0
    ? h.indexOf('measurement')
    : h.indexOf('variable');
  const iz=h.indexOf('value');

  if(ih<0||im<0||iz<0){
    throw Error('CSV requires columns: time_from_t0_hours, measurement, value. The legacy rel_t0_hour, variable, value format is also accepted.');
  }

  const rows=[];
  const unknown=new Set();

  for(let i=1;i<lines.length;i++){
    const a=lines[i].split(',');
    const hs=(a[ih]??'').trim();
    const measurement=(a[im]||'').trim();
    const vs=(a[iz]??'').trim();

    if(!measurement||hs===''||vs==='')continue;

    const hour=Number(hs), value=Number(vs);
    if(!Number.isFinite(hour)||!Number.isFinite(value)){
      throw Error(`Invalid numeric value on CSV line ${i+1}.`);
    }

    const canonical=canonicalMeasurementName(measurement);
    if(!canonical){
      unknown.add(measurement);
      continue;
    }

    rows.push({
      rel_t0_hour:hour,
      variable:canonical,
      measurement,
      value
    });
  }

  if(unknown.size){
    throw Error(`Unrecognized measurement name(s): ${Array.from(unknown).slice(0,6).join(', ')}${unknown.size>6?' …':''}. Please use the names in the downloadable template.`);
  }

  if(!rows.length){
    throw Error('No usable measurements were found in the CSV.');
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
    if(grouped.has(key))throw Error(`Duplicate hour × measurement after 1-h binning: ${MEASUREMENT_DEFINITIONS[r.variable]?.label || r.variable} at ${r.rel_t0_hour} h. Provide one value per hour per measurement.`);
    grouped.set(key,{bin,vid,value:Number(r.value)});
  }

  if(unknown.size)throw Error(`Internal measurement mapping error: ${Array.from(unknown).slice(0,8).join(', ')}.`);

  const x=new Float32Array(T*V), mask=new Float32Array(T*V); let nEvents=0; const observedVars=new Set();
  const implicitZero=new Set(policy.implicit_zero_variables||[]);
  const firstAvailableBin=clamp(Math.ceil((availableStart-startMin)/policy.grid_minutes),0,T-1);

  for(const name of implicitZero){
    const vid=varId.get(name);
    if(vid===undefined||structuralObj.values[vid]<=0)continue;
    for(let t=firstAvailableBin;t<T;t++)mask[t*V+vid]=1;
  }

  for(const g of grouped.values()){
    const name=vars[g.vid], raw=g.value, st=norm.event[name];
    const z=(clamp(raw,Number(st.lower),Number(st.upper))-Number(st.median))/Math.max(Number(st.iqr),1e-6);
    const pos=g.bin*V+g.vid; x[pos]=z; mask[pos]=1; nEvents++; observedVars.add(g.vid);
  }

  if(nEvents<policy.minimum_observed_events)throw Error(`Only ${nEvents} observed hourly measurements; the calculator requires at least ${policy.minimum_observed_events}.`);
  if(observedVars.size<policy.minimum_observed_variables)throw Error(`Only ${observedVars.size} distinct measurements were recognized; the calculator requires at least ${policy.minimum_observed_variables}.`);

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
  const staticRaw={
    age:ctx.age,
    weight_kg:ctx.weight_kg,
    decision_hour_after_t0:ctx.decision_hour_after_t0,
    current_beta_asi:ctx.current_beta_asi,
    current_antibacterial_count:ctx.current_antibacterial_count,
    current_beta_lactam_count:ctx.current_beta_lactam_count,
    current_anti_mrsa:ctx.current_anti_mrsa
  };

  sc.forEach((name,j)=>{
    const raw=Number(staticRaw[name]);
    if(Number.isFinite(raw)){
      const st=norm.static[name];
      sv[j]=(raw-Number(st.median))/Math.max(Number(st.iqr),1e-6);
      sm[j]=1;
    }
  });

  const sx=sexValues(ctx.sex);
  sv[sc.length]=sx.v[0];sv[sc.length+1]=sx.v[1];
  sm[sc.length]=sx.m[0];sm[sc.length+1]=sx.m[1];

  const structural=new Float32Array(structuralObj.values);
  if(structural.length!==V)throw Error('Structural mask dimension mismatch.');

  return {
    T,V,E,values,valid,tidx,vidx,tvals,selectedMask,time,
    static:sv,staticMask:sm,structural,
    eligibility:eligibility(ctx),
    regimen_node:regimenNode(ctx),
    nEvents,
    nVariables:observedVars.size
  };
}
