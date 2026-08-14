import {median} from './math.js';

async function fetchF32(url){const b=await fetch(url).then(r=>{if(!r.ok)throw Error('Failed to load '+url);return r.arrayBuffer()});return new Float32Array(b);}
async function fetchI32(url){const b=await fetch(url).then(r=>{if(!r.ok)throw Error('Failed to load '+url);return r.arrayBuffer()});return new Int32Array(b);}

export class DonorRuntime{
  constructor(base='runtime/donor'){this.base=base;this.actions={};this.manifest=null;}
  async load(){this.manifest=await fetch(`${this.base}/manifest.json`).then(r=>r.json());for(const [k,m] of Object.entries(this.manifest.actions)){this.actions[k]={m,emb:await fetchF32(`${this.base}/${m.embeddings}`),out:await fetchF32(`${this.base}/${m.outcomes}`),grp:await fetchI32(`${this.base}/${m.groups}`)}}return this;}
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
