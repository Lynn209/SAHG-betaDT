export const EPS=1e-12;
export function sigmoid(x){return 1/(1+Math.exp(-x));}
export function softmax(a){const m=Math.max(...a);const e=a.map(x=>Math.exp(x-m));const s=e.reduce((p,c)=>p+c,0);return e.map(x=>x/s);}
export function mean(a){return a.reduce((p,c)=>p+c,0)/a.length;}
export function sampleSd(a){if(a.length<2)return 0;const m=mean(a);return Math.sqrt(a.reduce((s,x)=>s+(x-m)*(x-m),0)/(a.length-1));}
export function clamp(x,a,b){return Math.max(a,Math.min(b,x));}
export function effectSign(x,tol){return x>tol?1:(x<-tol?-1:0);}
export function median(a){if(!a.length)return NaN;const b=[...a].sort((x,y)=>x-y),n=b.length,m=Math.floor(n/2);return n%2?b[m]:(b[m-1]+b[m])/2;}
export function finite(x){return Number.isFinite(Number(x));}
