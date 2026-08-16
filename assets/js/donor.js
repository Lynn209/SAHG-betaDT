import {median} from './math.js';

const DONOR_ASSET_VERSION='11.1';
const DONOR_FETCH_TIMEOUT_MS=180000; // retry a genuinely stalled large-file transfer

function sleep(ms){return new Promise(r=>setTimeout(r,ms));}

async function fetchArrayBufferWithProgress(url,{expectedBytes=0,onBytes=null}={}){
  let lastError=null;

  for(let attempt=0;attempt<2;attempt++){
    const controller=new AbortController();
    const timer=setTimeout(()=>controller.abort(),DONOR_FETCH_TIMEOUT_MS);
    let loaded=0;

    try{
      const sep=url.includes('?')?'&':'?';
      const versioned=`${url}${sep}v=${DONOR_ASSET_VERSION}${attempt?`&retry=${Date.now()}`:''}`;
      const r=await fetch(versioned,{
        cache:attempt===0?'force-cache':'reload',
        signal:controller.signal
      });
      if(!r.ok)throw Error(`HTTP ${r.status} while loading ${url}`);

      if(!r.body || !r.body.getReader){
        const b=await r.arrayBuffer();
        loaded=b.byteLength;
        if(onBytes)onBytes(loaded,expectedBytes||loaded);
        clearTimeout(timer);
        return b;
      }

      const reader=r.body.getReader();
      const chunks=[];
      let total=0;
      while(true){
        const {done,value}=await reader.read();
        if(done)break;
        chunks.push(value);
        total+=value.byteLength;
        loaded=total;
        if(onBytes)onBytes(loaded,expectedBytes||total);
      }

      const merged=new Uint8Array(total);
      let offset=0;
      for(const c of chunks){merged.set(c,offset);offset+=c.byteLength;}

      if(expectedBytes>0 && total!==expectedBytes){
        throw Error(`Unexpected donor asset size for ${url}: ${total} bytes; expected ${expectedBytes}`);
      }

      clearTimeout(timer);
      return merged.buffer;
    }catch(e){
      clearTimeout(timer);
      lastError=e;
      if(onBytes)onBytes(0,expectedBytes);
      if(attempt===0){
        await sleep(500);
        continue;
      }
    }
  }

  throw Error(`Failed to load donor asset after retry: ${url} · ${lastError?.message||lastError}`);
}

export class DonorRuntime{
  constructor(base='runtime/donor'){this.base=base;this.actions={};this.manifest=null;}
  async load(onProgress=null){
    const progress=(fraction,label)=>{if(onProgress)onProgress(Math.max(0,Math.min(1,fraction)),label);};
    progress(0.01,'Loading donor manifest…');

    this.manifest=await fetch(`${this.base}/manifest.json?v=${DONOR_ASSET_VERSION}`,{cache:'force-cache'})
      .then(r=>{if(!r.ok)throw Error('Failed to load donor manifest');return r.json()});

    const entries=Object.entries(this.manifest.actions);

    // Exact expected byte sizes from the frozen float32/int32 runtime contract.
    const specs=[];
    for(const [k,m] of entries){
      const n=Number(m.n_rows), d=Number(m.dim);
      specs.push({k,m,type:'emb',url:`${this.base}/${m.embeddings}`,bytes:n*d*4});
      specs.push({k,m,type:'out',url:`${this.base}/${m.outcomes}`,bytes:n*4});
      specs.push({k,m,type:'grp',url:`${this.base}/${m.groups}`,bytes:n*4});
    }

    const expectedTotal=specs.reduce((s,x)=>s+x.bytes,0);
    const loadedByUrl=new Map(specs.map(x=>[x.url,0]));

    const report=(url,loaded)=>{
      loadedByUrl.set(url,loaded);
      let done=0;
      for(const v of loadedByUrl.values())done+=v;
      const mbDone=done/1024/1024, mbTotal=expectedTotal/1024/1024;
      progress(
        expectedTotal>0?done/expectedTotal:0,
        `Downloading donor runtime · ${mbDone.toFixed(1)} / ${mbTotal.toFixed(1)} MB`
      );
    };

    // Download all frozen donor arrays concurrently. This changes only transport;
    // binary bytes, typed arrays and all donor mathematics remain identical.
    const buffers=await Promise.all(specs.map(async s=>{
      const b=await fetchArrayBufferWithProgress(s.url,{
        expectedBytes:s.bytes,
        onBytes:(loaded)=>report(s.url,loaded)
      });
      return {spec:s,buffer:b};
    }));

    progress(0.98,'Building local donor arrays…');

    const temp={};
    for(const [k,m] of entries)temp[k]={m};
    for(const {spec,buffer} of buffers){
      if(spec.type==='emb')temp[spec.k].emb=new Float32Array(buffer);
      else if(spec.type==='out')temp[spec.k].out=new Float32Array(buffer);
      else temp[spec.k].grp=new Int32Array(buffer);
    }

    // Hard dimension QA before allowing inference.
    for(const [k,a] of Object.entries(temp)){
      const n=Number(a.m.n_rows),d=Number(a.m.dim);
      if(a.emb.length!==n*d)throw Error(`A${k} donor embedding dimension mismatch`);
      if(a.out.length!==n)throw Error(`A${k} donor outcome dimension mismatch`);
      if(a.grp.length!==n)throw Error(`A${k} donor group dimension mismatch`);
    }

    this.actions=temp;
    progress(1,'Donor support runtime ready');
    return this;
  }
  kernel(distances){const d=distances,dmin=Math.min(...d),shift=d.map(x=>Math.max(x-dmin,0)),tau=Math.max(Number(this.manifest.temperature),1e-8);let bandwidth=tau;
    if(this.manifest.bandwidth_mode==='adaptive_local'){const rank=Math.min(Math.max(1,this.manifest.adaptive_scale_neighbor_rank),d.length),local0=shift[rank-1],pos=shift.filter(x=>Number.isFinite(x)&&x>1e-8);let local=local0;if(!Number.isFinite(local)||local<=1e-8)local=pos.length?median(pos):1;bandwidth=Math.max(tau*local,1e-8);}
    const lw=shift.map(x=>-x/bandwidth),mx=Math.max(...lw),w=lw.map(x=>Math.exp(x-mx)),s=w.reduce((a,b)=>a+b,0);return w.map(x=>x/(s>0?s:w.length));
  }
  queryOne(anchor,k){const a=this.actions[String(k)];if(!a)return {estimate:NaN,ess:0,mean_distance:Infinity,nearest_distance:Infinity,n_available:0};const {m,emb,out,grp}=a,n=m.n_rows,d=m.dim,nSearch=Math.min(n,Math.max(this.manifest.n_neighbors*5,this.manifest.n_neighbors,this.manifest.adaptive_scale_neighbor_rank*5));const rows=new Array(n);
    for(let i=0;i<n;i++){let s=0,off=i*d;for(let j=0;j<d;j++){const z=emb[off+j]-anchor[j];s+=z*z;}rows[i]=[Math.sqrt(s),i];}
    rows.sort((x,y)=>x[0]-y[0]);const seen=new Set(),idx=[],dist=[];for(let p=0;p<Math.min(nSearch,rows.length);p++){const [dd,i]=rows[p],g=grp[i];if(seen.has(g))continue;seen.add(g);idx.push(i);dist.push(dd);if(idx.length>=this.manifest.n_neighbors)break;}
    if(!idx.length)return {estimate:NaN,ess:0,mean_distance:Infinity,nearest_distance:Infinity,n_available:0};const w=this.kernel(dist);let est=0,essDen=0,md=0;for(let i=0;i<idx.length;i++){est+=w[i]*out[idx[i]];essDen+=w[i]*w[i];md+=w[i]*dist[i];}return {estimate:est,ess:1/essDen,mean_distance:md,nearest_distance:Math.min(...dist),n_available:idx.length};
  }
  query(anchor){const res=[];for(let k=0;k<this.manifest.n_actions;k++)res.push(this.queryOne(anchor,k));return res;}
}
