import numpy as np, subprocess, sys, json
def load(p, sr=22050):
    raw=subprocess.check_output(['ffmpeg','-v','error','-i',p,'-ac','1','-ar',str(sr),'-f','f32le','-'])
    return np.frombuffer(raw,np.float32), sr
def bands(x,sr,hop=368):  # ~60 fps
    n=2048; win=np.hanning(n); frames=1+(len(x)-n)//hop
    idx=np.arange(n)[None,:]+hop*np.arange(frames)[:,None]
    S=np.abs(np.fft.rfft(x[idx]*win,axis=1)); f=np.fft.rfftfreq(n,1/sr)
    def b(lo,hi): return S[:,(f>=lo)&(f<hi)].sum(1)
    return dict(sub=b(20,90),bass=b(90,250),mid=b(250,2000),high=b(4000,11000),rms=np.sqrt((x[idx]**2).mean(1))), hop/sr, S, f
def flux(e):
    d=np.diff(np.log1p(e*10),prepend=0); return np.maximum(d,0)
def tempo(on,fps):
    on=on-on.mean(); ac=np.correlate(on,on,'full')[len(on)-1:]
    lags=np.arange(len(ac)); bpm=60*fps/np.maximum(lags,1)
    m=(bpm>70)&(bpm<180); l=lags[m][np.argmax(ac[m])]; return 60*fps/l
for p in (sys.argv[1:] if __name__=="__main__" else []):
    x,sr=load(p); B,dt,S,f=bands(x,sr); fps=1/dt
    on=flux(B['sub']+B['bass'])+0.5*flux(B['mid'])
    bpm=tempo(on,fps)
    # energy per 1s window
    w=int(fps); E=np.convolve(B['rms'],np.ones(w)/w,'same'); low=np.convolve(B['sub']/B['sub'].max(),np.ones(w)/w,'same')
    sec=np.arange(0,len(E),int(fps))
    print(p.split('/')[-1], 'dur %.1fs'%(len(x)/sr),'bpm~%.1f'%bpm)
    print(' rms/s :',' '.join('%.0f'%(100*E[i]/E.max()) for i in sec))
    print(' sub/s :',' '.join('%.0f'%(100*low[i]/low.max()) for i in sec))
