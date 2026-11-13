import numpy as np, json, sys
sys.path.insert(0,sys.argv[1]); from analyze import load,bands,flux
x,sr=load('/mnt/project-files/test-tracks/flip.wav'); B,dt,S,f=bands(x,sr,hop=735)  # 30fps
fps=1/dt; n=len(B['rms'])
def norm(a,p=99): a=a/np.percentile(a,p); return np.clip(a,0,1)
def env(a,att=0.6,rel=0.85):
    o=np.zeros_like(a); v=0
    for i,s in enumerate(a): v = s if s>v else v*rel; o[i]=v
    return o
kickon=norm(flux(B['sub']),99.5); snon=norm(flux(B['mid']+B['high']),99.5)
# peak pick kicks
def peaks(o,th,gap):
    out=[];last=-99
    for i in range(1,len(o)-1):
        if o[i]>th and o[i]>=o[i-1] and o[i]>=o[i+1] and i-last>=gap: out.append(i); last=i
    return out
kp=peaks(kickon,0.35,int(fps*0.2)); sp=peaks(snon,0.45,int(fps*0.2))
rms=norm(np.convolve(B['rms'],np.ones(3)/3,'same'))
sub=norm(B['sub']); drop_i=next(i for i in range(int(40*fps),n) if np.mean(sub[i:i+15])>0.5)
# tempo refine around 133
on=kickon+0.5*snon
best=None
for bpm in np.arange(128,138,0.05):
    per=60/bpm*fps
    for ph in np.linspace(0,per,40,endpoint=False):
        t=np.arange(ph,n-1,per).astype(int); s=on[t].sum()
        if best is None or s>best[0]: best=(s,bpm,ph)
_,bpm,ph=best
# align phase so a beat lands on drop frame
per=60/bpm*fps; k=round((drop_i-ph)/per); ph=drop_i-k*per
print('frames',n,'fps',round(fps,3),'bpm',round(bpm,2),'drop at %.2fs'%(drop_i/fps),'kicks',len(kp),'snares',len(sp))
r=lambda a:[round(float(v),3) for v in a]
d=dict(fps=fps,n=n,bpm=round(float(bpm),3),beat0=round(float(ph/fps),4),drop=round(drop_i/fps,3),
  sections=[{"name":"intro","start":0,"end":round(14.5,2)},{"name":"build","start":14.5,"end":round(drop_i/fps,3)},{"name":"drop","start":round(drop_i/fps,3),"end":round(n/fps,3)}],
  rms=r(rms),sub=r(env(sub,rel=0.8)),bass=r(norm(B['bass'])),mid=r(norm(B['mid'])),high=r(norm(B['high'])),
  kick=r(env(kickon,rel=0.82)),snare=r(env(snon,rel=0.8)),kicks=[round(i/fps,3) for i in kp],snares=[round(i/fps,3) for i in sp])
json.dump(d,open(sys.argv[2],'w'),separators=(',',':'))
