import {sigmoid,softmax,mean,sampleSd} from './math.js';

function tensorF32(x,dims){return new ort.Tensor('float32',x,dims)}
function tensorI32(x,dims){return new ort.Tensor('int32',x,dims)}

export class ModelRuntime{
  constructor(base='runtime'){this.base=base;this.anchor=null;this.models=[];this.manifest=null;}
  async load(){
    if(typeof ort==='undefined')throw Error('ONNX Runtime Web failed to load.');
    // Pin JS and WASM to the same ONNX Runtime Web build. Official ORT guidance
    // requires matching bundles when wasmPaths is overridden.
    ort.env.wasm.wasmPaths='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.22.0/dist/';
    ort.env.wasm.numThreads=1;
    this.manifest=await fetch(`${this.base}/runtime_manifest.json`).then(r=>r.json());
    const opt={executionProviders:['wasm'],graphOptimizationLevel:'all'};
    this.anchor=await ort.InferenceSession.create(`${this.base}/models/anchor_sahg.onnx`,opt);
    for(let i=0;i<5;i++)this.models.push(await ort.InferenceSession.create(`${this.base}/models/final_dr_ensemble_${i}.onnx`,opt));
    return this;
  }
  feeds(p,causal=false){const b=1;const f={values:tensorF32(p.values,[b,p.E]),valid:tensorF32(p.valid,[b,p.E]),tidx:tensorI32(p.tidx,[b,p.E]),vidx:tensorI32(p.vidx,[b,p.E]),tvals:tensorF32(p.tvals,[b,p.E]),selected_mask:tensorF32(p.selectedMask,[b,p.T,p.V]),time:tensorF32(p.time,[b,p.T])};if(causal){f.static=tensorF32(p.static,[b,p.static.length]);f.static_mask=tensorF32(p.staticMask,[b,p.staticMask.length]);f.structural_mask=tensorF32(p.structural,[b,p.V]);}return f;}
  async predict(p,gate){
    const ar=await this.anchor.run(this.feeds(p,false)),anchor=Array.from(ar.anchor_representation.data);
    const raw=[];
    for(const s of this.models){const o=await s.run(this.feeds(p,true));let logits=Array.from(o.propensity_logits.data);logits=logits.map((x,k)=>p.eligibility[k]>0?x:-1e9);raw.push({prop:softmax(logits),g:Array.from(o.factual_binary_logits.data).map(sigmoid),r:Array.from(o.targeted_binary_logits.data).map(sigmoid)});}
    const risks=[],gcomp=[],props=[],riskSd=[],diffSd=[];
    for(let k=0;k<6;k++){const rr=raw.map(x=>x.r[k]),gg=raw.map(x=>x.g[k]),pp=raw.map(x=>x.prop[k]);risks[k]=mean(rr);gcomp[k]=mean(gg);props[k]=mean(pp);riskSd[k]=sampleSd(rr);diffSd[k]=sampleSd(raw.map(x=>x.r[k]-x.r[0]));}
    const temp=Number(gate.propensity_temperature||1),pcal=softmax(props.map(x=>Math.log(Math.max(x,1e-8))/Math.max(temp,1e-6)));
    return {anchor,risks,gcomp,props:pcal,riskSd,diffSd,raw};
  }
}
