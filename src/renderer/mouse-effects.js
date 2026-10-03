/* Original Canvas2D artwork. No dependencies, network, or application data. */
(function () {
  'use strict';
  const TAU = Math.PI * 2;
  const presets = [
    [1,'月光涟漪','轻柔','浅浅月环跟随','三重涟漪舒展','安静的银蓝水纹，适合长时间阅读。','#8caed0',true],
    [2,'银尘星轨','轻柔','细碎星尘拖尾','四芒星轻轻绽放','细小星光随手势渐隐，轻盈而克制。','#a4a6db',true],
    [3,'流萤微光','自然','萤火缓缓游走','微光向四周散开','黄绿微光带着轻微摆动，像夏夜流萤。','#8bbf69',true],
    [4,'墨迹留白','奇想','干笔墨痕渐隐','墨滴晕开成花','带有纸墨质感的曲线和不规则墨滴。','#76818d',false],
    [5,'彗星拖尾','光影','修长彗尾掠过','流星向外飞散','方向明确的光束，滑动越快越有速度感。','#69b9df',false],
    [6,'星座连线','奇想','星点自动连线','一幅星图展开','离散星点组成短暂星座，清晰又有秩序。','#8b9ed3',true],
    [7,'水晶折光','光影','菱形碎晶旋转','多面晶片散开','透明切面与彩色细线形成水晶折射感。','#7dbbc0',false],
    [8,'极光丝带','光影','柔软彩带飘动','弧形光带舒展','双层渐变丝带随着轨迹弯曲和消散。','#81b4c2',false],
    [9,'樱花轻落','自然','花瓣摇曳飘落','五瓣樱花绽开','粉色花瓣缓缓落下，柔和且有季节感。','#d995ad',false],
    [10,'羽毛掠影','轻柔','羽毛轻柔翻转','一簇轻羽散开','纤细羽轴与羽枝留下轻软的手势痕迹。','#b4a8c7',false],
    [11,'气泡浮光','自然','小气泡慢慢上浮','透明气泡向外弹开','带高光的圆泡轻轻浮动，活泼而通透。','#75b5c5',false],
    [12,'霓虹脉冲','光影','双色霓虹轨迹','同心光环扩张','粉蓝霓虹双线和圆环，动感鲜明。','#b488cf',false],
    [13,'电弧跃迁','光影','细电弧沿轨迹跳跃','分叉电弧向外延伸','短暂锯齿光线渐隐，不使用频闪。','#759bcf',false],
    [14,'像素星屑','奇想','方形像素逐格落下','八方向像素爆开','清晰的方块与十字星，带一点复古趣味。','#a58fcc',false],
    [15,'蝶影漫游','自然','小蝶扇翼飞舞','蝶群向四周起飞','成对翅膀轻轻开合，飞行轨迹自然摆动。','#ba93cc',false],
    [16,'魔法星阵','奇想','符文光点跟随','双三角星阵展开','细线圆阵缓缓转动，带有奇幻仪式感。','#b399d0',false],
    [17,'雪落无声','自然','六角雪花飘落','雪晶轻柔散落','真正的六角雪晶，缓慢旋转并融化。','#88afc6',false],
    [18,'金色书页','奇想','微小书页翻飞','金色书页扇形展开','带文字线条的纸页，呼应阅读主题。','#c4a268',false],
    [19,'珍珠光链','轻柔','圆润珍珠串成链','珍珠项链向外展开','细线串起有高光的小珠，优雅而整齐。','#b5a4bc',false],
    [20,'萤蓝花火','光影','蓝色火星轻轻飘落','一束蓝色烟花绽放','长短不同的火星划出弧线，缓缓熄灭。','#6fadd9',false]
  ].map(([id,name,category,moveText,clickText,description,color,recommend]) =>
    Object.freeze({id,name,category,moveText,clickText,description,color,recommend}));
  const clamp = (v, low, high, fallback) => Number.isFinite(Number(v)) ? Math.max(low, Math.min(high, Number(v))) : fallback;
  const rand = (a,b) => a + Math.random() * (b-a);
  const glowyTypes = new Set(['star','glow','comet','shoot','neon','bolt','ember','pulse','magic']);
  const sparsePresets = new Set([9,10,11,15,17,18]);

  function create(canvas, options) {
    if (!canvas || typeof canvas.getContext !== 'function') throw new TypeError('A canvas is required.');
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas2D is unavailable.');
    options = options || {};
    let id = presets.some(p => p.id === Number(options.id)) ? Number(options.id) : 1;
    let intensity = clamp(options.intensity,.5,1.5,1), scale = clamp(options.scale,.7,1.5,1);
    let particles = [], frame = 0, previousTime = 0, destroyed = false;
    let width = 1, height = 1, dpr = 1, last = null;
    let paintedBounds = null;
    const drawBounds = { left:0, top:0, right:0, bottom:0 };
    const starSprites = new Map();
    function releaseSprite(sprite) {
      if (sprite && typeof sprite.surface.close === 'function') sprite.surface.close();
    }
    function clearSprites() {
      for (const sprite of starSprites.values()) releaseSprite(sprite);
      starSprites.clear();
    }
    const parent = canvas.parentElement || canvas;
    function resize() {
      if (destroyed) return;
      const box = parent.getBoundingClientRect();
      const nextWidth = Math.max(1, box.width), nextHeight = Math.max(1, box.height);
      const nextDpr = Math.min(2, window.devicePixelRatio || 1);
      const backingWidth = Math.round(nextWidth*nextDpr), backingHeight = Math.round(nextHeight*nextDpr);
      // ResizeObserver also fires when views change without resizing the window.
      // Assigning a canvas dimension in that case erases the current click burst.
      if (width === nextWidth && height === nextHeight && dpr === nextDpr &&
        canvas.width === backingWidth && canvas.height === backingHeight) return;
      if (dpr !== nextDpr) clearSprites();
      width = nextWidth; height = nextHeight; dpr = nextDpr;
      const backingChanged=canvas.width !== backingWidth || canvas.height !== backingHeight;
      if (canvas.width !== backingWidth) canvas.width = backingWidth;
      if (canvas.height !== backingHeight) canvas.height = backingHeight;
      if (!backingChanged) { ctx.setTransform(1,0,0,1,0,0); ctx.clearRect(0,0,canvas.width,canvas.height); }
      paintedBounds = null;
      ctx.setTransform(dpr,0,0,dpr,0,0);
    }
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(resize) : null;
    if (observer) observer.observe(parent);
    window.addEventListener('resize',resize); resize();
    function add(type,x,y,extra) {
      if (particles.length >= 500) particles.shift();
      particles.push(Object.assign({type,x,y,vx:0,vy:0,g:0,drag:0,age:0,life:.8,
        size:3*scale,angle:rand(0,TAU),spin:0,phase:rand(0,TAU),color:presets[id-1].color,
        alpha:1,grow:0,wobble:0,frequency:4},extra));
    }
    function wake() { if (!frame && !destroyed && particles.length) { previousTime=0; frame=requestAnimationFrame(render); } }
    function radial(type,x,y,count,speed,extra) {
      count=Math.max(1,Math.round(count*intensity));
      const phase=rand(0,TAU);
      for (let i=0;i<count;i++) {
        const a=phase+i/count*TAU+rand(-.1,.1), v=rand(.55,1)*speed*scale;
        add(type,x,y,Object.assign({vx:Math.cos(a)*v,vy:Math.sin(a)*v,angle:a,spin:rand(-1,1),life:rand(.7,1.3)},extra));
      }
    }
    function segment(type,x,y,px,py,extra) {
      add(type,(x+px)/2,(y+py)/2,Object.assign({angle:Math.atan2(y-py,x-px),length:Math.hypot(x-px,y-py),life:.55},extra));
    }
    function emitMove(x,y,px,py) {
      const color=presets[id-1].color, s=scale;
      switch(id) {
        case 1: add('ring',x,y,{size:3*s,grow:12*s,life:.72,alpha:.75,flatten:.65}); break;
        case 2: add('star',x+rand(-7,7)*s,y+rand(-7,7)*s,{size:rand(1.5,3.5)*s,vy:8,spin:.5,life:.8}); break;
        case 3: add('glow',x+rand(-6,6),y+rand(-6,6),{size:rand(1.5,2.7)*s,vy:-rand(8,18),vx:rand(-8,8),wobble:6*s,life:1.3}); break;
        case 4: segment('inkline',x,y,px,py,{size:rand(1.1,2.8)*s,life:.85}); add('ink',x,y,{size:rand(1,2.5)*s,vx:rand(-5,5),vy:6,alpha:.45}); break;
        case 5: segment('comet',x,y,px,py,{length:Math.max(18*s,Math.hypot(x-px,y-py)*1.8),size:2*s,life:.38}); break;
        case 6: segment('link',x,y,px,py,{life:1,alpha:.55}); add('star',x,y,{size:2.1*s,life:1.05,spin:.2}); break;
        case 7: add('crystal',x+rand(-5,5),y+rand(-5,5),{size:rand(3,6)*s,vy:12,spin:rand(-2,2),life:1,color:Math.random()>.5?color:'#b19bce'}); break;
        case 8: segment('ribbon',x,y,px,py,{size:5*s,length:Math.max(14*s,Math.hypot(x-px,y-py)+6),life:.9,vy:-5}); break;
        case 9: add('petal',x+rand(-5,5),y,{size:rand(4,6)*s,vy:rand(18,28),vx:rand(-8,8),spin:1.2,wobble:9*s,life:1.45}); break;
        case 10: add('feather',x,y,{size:rand(6,9)*s,vy:10,vx:rand(-7,7),spin:.4,wobble:7*s,life:1.5}); break;
        case 11: add('bubble',x+rand(-5,5),y,{size:rand(3,7)*s,vy:-rand(12,25),vx:rand(-5,5),wobble:4*s,life:1.3}); break;
        case 12: segment('neon',x,y,px,py,{size:1.3*s,life:.65}); break;
        case 13: segment('bolt',x,y,px,py,{size:3*s,length:Math.max(15*s,Math.hypot(x-px,y-py)),life:.42,seed:rand(0,100)}); break;
        case 14: add('pixel',Math.round(x/3)*3,Math.round(y/3)*3,{size:rand(2,4)*s,vx:rand(-9,9),vy:10,g:30,life:.9,angle:0}); break;
        case 15: add('butterfly',x,y,{size:rand(4,6)*s,vy:-10,vx:rand(-12,12),wobble:10*s,frequency:5,life:1.5,spin:.25}); break;
        case 16: add('rune',x,y,{size:rand(3,5)*s,vy:-7,spin:.5,life:1,variant:Math.floor(rand(0,3))}); break;
        case 17: add('snow',x+rand(-5,5),y,{size:rand(3,5)*s,vy:rand(12,22),wobble:6*s,spin:.5,life:1.6}); break;
        case 18: add('page',x,y,{size:rand(4,6)*s,vy:14,vx:rand(-10,10),spin:1.3,wobble:6*s,life:1.35}); break;
        case 19: segment('link',x,y,px,py,{alpha:.35,life:.85}); add('pearl',x,y,{size:3.8*s,life:1}); break;
        case 20: add('ember',x,y,{size:rand(1.5,2.6)*s,vx:rand(-12,12),vy:rand(-6,10),g:35,life:1,tail:6*s}); break;
      }
    }
    function move(x,y) {
      if(destroyed||!Number.isFinite(x)||!Number.isFinite(y)) return;
      const now=performance.now();
      if(!last||now-last.time>170) {
        emitMove(x,y,x-2*scale,y);
        last={x,y,time:now};wake();return;
      }
      const dx=x-last.x,dy=y-last.y,distance=Math.hypot(dx,dy),elapsed=now-last.time;
      const spacing=(sparsePresets.has(id)?13:6)/intensity;
      if(distance<spacing&&elapsed<25) return;
      if(distance<.35) return;
      const steps=Math.min(5,Math.max(1,Math.floor(distance/spacing)));
      let px=last.x,py=last.y;
      for(let i=1;i<=steps;i++) { const nx=last.x+dx*i/steps,ny=last.y+dy*i/steps;emitMove(nx,ny,px,py);px=nx;py=ny; }
      last={x,y,time:now}; wake();
    }
    function click(x,y) {
      if(destroyed||!Number.isFinite(x)||!Number.isFinite(y)) return;
      const s=scale;
      switch(id) {
        case 1:
          for(let i=0;i<3;i++) add('ring',x,y,{size:(4+i*8)*s,grow:(48-i*7)*s,life:1.05+i*.12,flatten:.67,angle:0,alpha:.85-i*.15});
          radial('glow',x,y,7,38,{size:1.5*s,life:.8}); break;
        case 2: radial('star',x,y,16,85,{size:rand(3,5)*s,spin:1.2,drag:1.1,life:1.2});add('star',x,y,{size:13*s,life:.45});break;
        case 3: radial('glow',x,y,18,50,{size:2.7*s,drag:1.3,wobble:12*s,life:1.7,frequency:5});break;
        case 4: radial('ink',x,y,12,42,{size:6*s,grow:2*s,drag:2,life:1.05});add('inkring',x,y,{size:5*s,grow:35*s,life:1.1});break;
        case 5: radial('shoot',x,y,13,135,{size:2.1*s,tail:24*s,drag:1,life:.9});break;
        case 6:
          add('constellation',x,y,{size:7*s,grow:44*s,life:1.5,spin:.12});radial('star',x,y,6,37,{size:3*s,life:1.25,drag:1});break;
        case 7: radial('crystal',x,y,16,78,{size:7*s,g:14,spin:2,drag:.5,life:1.2});add('diamond',x,y,{size:5*s,grow:35*s,life:.7});break;
        case 8:
          for(let i=0;i<3;i++)add('aurora',x,y,{size:(8+i*7)*s,grow:(48-i*8)*s,life:1.3,angle:i*.7,spin:.3,color:i===1?'#b09acb':'#7fb8bc'});break;
        case 9: add('flower',x,y,{size:4*s,grow:22*s,life:.7,spin:.15});radial('petal',x,y,13,50,{size:7*s,vy:10,g:22,spin:1.4,wobble:7*s,life:1.6});break;
        case 10: radial('feather',x,y,9,46,{size:12*s,drag:.8,g:12,wobble:11*s,spin:.65,life:1.8});break;
        case 11: radial('bubble',x,y,13,58,{size:7*s,g:-18,drag:1,life:1.5});add('ring',x,y,{size:5*s,grow:33*s,alpha:.45,life:.55});break;
        case 12:
          for(let i=0;i<3;i++) add('pulse',x,y,{size:(4+i*8)*s,grow:(70-i*14)*s,life:.9+i*.12,angle:i*.5,color:i===1?'#73bdd2':'#b588d3'});break;
        case 13:
          for(let i=0;i<9;i++){const a=i/9*TAU;add('bolt',x+Math.cos(a)*29*s,y+Math.sin(a)*29*s,{size:7*s,length:65*s,angle:a,life:.7,seed:rand(0,100)});}break;
        case 14:
          for(let i=0;i<24*intensity;i++){const a=Math.floor(rand(0,8))/8*TAU,v=rand(30,100)*s;add('pixel',x,y,{vx:Math.cos(a)*v,vy:Math.sin(a)*v,g:40,size:rand(3,6)*s,angle:0,life:1.1});}
          add('cross',x,y,{size:8*s,grow:13*s,life:.5,angle:0});break;
        case 15: radial('butterfly',x,y,9,44,{size:8*s,wobble:12*s,frequency:6,life:1.7,g:-5,spin:.25});break;
        case 16: add('magic',x,y,{size:7*s,grow:47*s,life:1.65,spin:.25});radial('rune',x,y,8,43,{size:5*s,life:1.1,spin:.7,variant:1});break;
        case 17: radial('snow',x,y,17,48,{size:6*s,g:16,spin:.65,wobble:6*s,life:1.85,drag:.4});break;
        case 18:
          for(let i=0;i<11*intensity;i++){const a=-Math.PI+(.15+i/(11*intensity)*.7)*Math.PI;add('page',x,y,{size:8*s,vx:Math.cos(a)*rand(40,80)*s,vy:Math.sin(a)*rand(40,80)*s,g:42,spin:rand(-1.5,1.5),life:1.6});}break;
        case 19: add('necklace',x,y,{size:8*s,grow:42*s,life:1.4,spin:.18});break;
        case 20: radial('ember',x,y,35,115,{size:2.1*s,tail:11*s,g:58,drag:.6,life:1.45});add('star',x,y,{size:13*s,life:.35});break;
      }
      wake();
    }
    function pathStar(r,points,inner,target=ctx) {
      target.beginPath();for(let i=0;i<points*2;i++){const a=-Math.PI/2+i*Math.PI/points,d=i%2?r*inner:r;target[i?'lineTo':'moveTo'](Math.cos(a)*d,Math.sin(a)*d);}target.closePath();
    }
    function starSprite(radius,color) {
      // Cache the original four-point artwork and its glow. Radius buckets are
      // a quarter of a backing pixel, preserving the selected size at every DPR.
      const r = Math.max(.25,Math.round(radius*dpr*4)/(dpr*4));
      const key = `${r}:${color}`;
      if (starSprites.has(key)) return starSprites.get(key);
      const blur = 4*scale, padding = (blur*2+2)/dpr;
      const pixels = Math.ceil((r+padding)*2*dpr);
      let surface;
      if (typeof OffscreenCanvas === 'function') surface = new OffscreenCanvas(pixels,pixels);
      else if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
        surface = document.createElement('canvas'); surface.width = pixels; surface.height = pixels;
      }
      if (!surface) return null;
      // Rasterize these tiny, static sources in CPU memory. A mutable GPU
      // canvas used as a drawImage source would require repeated readbacks if
      // Chromium falls back to software rendering on the destination canvas.
      const texture = surface.getContext('2d',{willReadFrequently:true});
      if (!texture) return null;
      texture.setTransform(dpr,0,0,dpr,pixels/2,pixels/2);
      texture.fillStyle = color; texture.shadowColor = color; texture.shadowBlur = blur;
      pathStar(r,4,.2,texture); texture.fill();
      // An immutable bitmap can be cached by either the GPU or software canvas
      // backend. The HTML-canvas fallback above also stays in CPU memory.
      if (typeof surface.transferToImageBitmap === 'function') surface = surface.transferToImageBitmap();
      const sprite = { surface, size: pixels/dpr, half: pixels/dpr/2 };
      // Alternate presets remain supported without retaining an unbounded atlas.
      if (starSprites.size >= 96) {
        const oldest=starSprites.keys().next().value;
        releaseSprite(starSprites.get(oldest));starSprites.delete(oldest);
      }
      starSprites.set(key,sprite);
      return sprite;
    }
    function circle(r) {ctx.beginPath();ctx.arc(0,0,Math.max(.1,r),0,TAU);}
    function line(x1,y1,x2,y2) {ctx.beginPath();ctx.moveTo(x1,y1);ctx.lineTo(x2,y2);ctx.stroke();}
    function pearl(r,color) {
      const gradient=ctx.createRadialGradient(-r*.35,-r*.4,.1,0,0,r);
      gradient.addColorStop(0,'#ffffff');gradient.addColorStop(.27,'#e3ddec');gradient.addColorStop(1,color);
      ctx.fillStyle=gradient;circle(r);ctx.fill();ctx.stroke();
    }
    function draw(p) {
      const u=p.age/p.life,r=Math.max(.1,p.size+p.grow*u),alpha=p.alpha*Math.pow(1-u,.9)*Math.min(1,p.age/.025);
      const x=p.x+Math.sin(p.age*p.frequency+p.phase)*p.wobble*u, angle=p.angle+p.spin*p.age;
      // Electron supplies this flag from its actual GPU feature status. Skia's
      // software backend handles the small original paths faster than rotated
      // bitmap sampling, while accelerated canvases benefit from the atlas.
      if (p.type === 'star' && options.softwareRendering !== true) {
        const sprite = starSprite(r,p.color);
        if (sprite) {
          const cos=Math.cos(angle)*dpr,sin=Math.sin(angle)*dpr;
          ctx.setTransform(cos,sin,-sin,cos,x*dpr,p.y*dpr);
          ctx.globalAlpha=alpha;
          ctx.drawImage(sprite.surface,-sprite.half,-sprite.half,sprite.size,sprite.size);
          const extent=sprite.half*Math.SQRT2+2;
          drawBounds.left=x-extent;drawBounds.top=p.y-extent;drawBounds.right=x+extent;drawBounds.bottom=p.y+extent;
          return drawBounds;
        }
      }
      ctx.setTransform(dpr,0,0,dpr,0,0);
      ctx.save();ctx.translate(x,p.y);ctx.rotate(angle);
      ctx.globalAlpha=alpha;ctx.strokeStyle=p.color;ctx.fillStyle=p.color;ctx.lineWidth=1.1*scale;ctx.lineCap='round';ctx.lineJoin='round';
      if(glowyTypes.has(p.type)){ctx.shadowColor=p.color;ctx.shadowBlur=p.type==='glow'?10*scale:4*scale;}
      switch(p.type) {
        case 'ring': ctx.scale(1,p.flatten||1);circle(r);ctx.stroke();break;
        case 'star': pathStar(r,4,.2);ctx.fill();break;
        case 'glow': {
          const g=ctx.createRadialGradient(0,0,0,0,0,r*3);g.addColorStop(0,p.color);g.addColorStop(.25,p.color);g.addColorStop(1,'transparent');ctx.fillStyle=g;circle(r*3);ctx.fill();ctx.fillStyle='#eff9db';circle(r*.45);ctx.fill();break;
        }
        case 'ink': ctx.beginPath();for(let i=0;i<10;i++){const a=i/10*TAU,d=r*(.72+.22*Math.sin(i*5+p.phase));ctx[i?'lineTo':'moveTo'](Math.cos(a)*d,Math.sin(a)*d);}ctx.closePath();ctx.fill();break;
        case 'inkline':ctx.lineWidth=r;line(-p.length/2,0,p.length/2,0);ctx.globalAlpha=alpha*.3;ctx.lineWidth=.6;line(-p.length/2,3*scale,p.length/2,2*scale);break;
        case 'inkring':ctx.lineWidth=1.8*scale;ctx.beginPath();for(let i=0;i<=70;i++){const a=i/70*TAU,d=r*(1+.025*Math.sin(i*2));ctx[i?'lineTo':'moveTo'](Math.cos(a)*d,Math.sin(a)*d);}ctx.stroke();break;
        case 'comet': {
          const g=ctx.createLinearGradient(-p.length/2,0,p.length/2,0);g.addColorStop(0,'transparent');g.addColorStop(1,p.color);ctx.strokeStyle=g;ctx.lineWidth=r;line(-p.length/2,0,p.length/2,0);ctx.translate(p.length/2,0);ctx.fillStyle='#d8f2ff';circle(r*.7);ctx.fill();break;
        }
        case 'shoot': case 'ember': {
          const a=Math.atan2(p.vy,p.vx)-(p.angle+p.spin*p.age);ctx.rotate(a);const len=p.tail||9*scale;ctx.lineWidth=r;ctx.globalAlpha=alpha*.4;line(-len,0,0,0);ctx.globalAlpha=alpha;circle(r);ctx.fill();ctx.fillStyle='#e6f6ff';circle(r*.5);ctx.fill();break;
        }
        case 'link':ctx.lineWidth=.8*scale;line(-p.length/2,0,p.length/2,0);break;
        case 'constellation': {
          const points=[[-.85,.2],[-.45,-.75],[.15,-.25],[.85,-.6],[.6,.6],[-.1,.9]];
          ctx.beginPath();points.forEach(([x,y],i)=>ctx[i?'lineTo':'moveTo'](x*r,y*r));ctx.stroke();line(-.45*r,-.75*r,.6*r,.6*r);
          points.forEach(([x,y],i)=>{ctx.save();ctx.translate(x*r,y*r);pathStar((i%2?2.3:3.2)*scale,4,.23);ctx.fill();ctx.restore();});break;
        }
        case 'crystal':case 'diamond':ctx.beginPath();ctx.moveTo(0,-r*1.5);ctx.lineTo(r,0);ctx.lineTo(0,r*1.5);ctx.lineTo(-r,0);ctx.closePath();ctx.stroke();if(p.type==='crystal'){ctx.globalAlpha=alpha*.24;ctx.fill();ctx.globalAlpha=alpha;line(-r,0,r,0);line(0,-r*1.5,0,r*1.5);}break;
        case 'ribbon': {
          const len=p.length/2,bend=Math.sin(p.phase+p.age*3)*r;
          for(let i=0;i<3;i++){ctx.strokeStyle=i===1?'#b7a2d0':p.color;ctx.globalAlpha=alpha*(i===1?.55:.3);ctx.lineWidth=(i===1?2:4)*scale;ctx.beginPath();ctx.moveTo(-len,(i-1)*2*scale);ctx.bezierCurveTo(-len/3,bend+i*scale,len/3,-bend+i*scale,len,(i-1)*2*scale);ctx.stroke();}break;
        }
        case 'aurora':ctx.scale(1,.5);for(let i=0;i<3;i++){ctx.globalAlpha=alpha*(.25+i*.16);ctx.lineWidth=(7-i*2)*scale;ctx.beginPath();ctx.arc(0,0,r+i*3*scale,.2,Math.PI*1.8);ctx.stroke();}break;
        case 'petal':ctx.beginPath();ctx.moveTo(0,-r);ctx.bezierCurveTo(r*1.4,-r*.7,r*1.15,r*.9,0,r);ctx.bezierCurveTo(-r*1.1,r*.3,-r*.75,-r*.7,0,-r);ctx.fill();ctx.strokeStyle='#edc0ce';ctx.lineWidth=.65*scale;line(0,-r*.5,0,r*.65);break;
        case 'flower':for(let i=0;i<5;i++){ctx.save();ctx.rotate(i/5*TAU);ctx.beginPath();ctx.ellipse(0,-r*.6,r*.34,r*.6,0,0,TAU);ctx.fill();ctx.restore();}ctx.fillStyle='#e7c897';circle(r*.17);ctx.fill();break;
        case 'feather':ctx.lineWidth=.8*scale;ctx.beginPath();ctx.moveTo(-r*.2,r);ctx.quadraticCurveTo(r*.2,0,0,-r);ctx.stroke();for(let i=0;i<7;i++){const y=-r*.8+i*r*.24,w=Math.sin((i+1)/9*Math.PI)*r*.45;ctx.beginPath();ctx.moveTo(0,y+.2*r);ctx.quadraticCurveTo(-w,y+.05*r,-w,y-.22*r);ctx.moveTo(0,y+.14*r);ctx.quadraticCurveTo(w,y-.05*r,w*.8,y-.29*r);ctx.stroke();}break;
        case 'bubble':circle(r);ctx.globalAlpha=alpha*.12;ctx.fill();ctx.globalAlpha=alpha;ctx.stroke();ctx.strokeStyle='#dceef3';ctx.lineWidth=1.3*scale;ctx.beginPath();ctx.arc(0,0,r*.65,Math.PI*1.07,Math.PI*1.58);ctx.stroke();break;
        case 'neon':ctx.lineWidth=r;line(-p.length/2,-2*scale,p.length/2,-2*scale);ctx.strokeStyle='#74bccf';line(-p.length/2,2*scale,p.length/2,2*scale);break;
        case 'pulse':circle(r);ctx.lineWidth=1.3*scale;ctx.stroke();ctx.lineWidth=.7*scale;ctx.globalAlpha=alpha*.45;circle(r+4*scale);ctx.stroke();for(let i=0;i<4;i++){ctx.save();ctx.rotate(i/4*TAU);line(r+7*scale,0,r+11*scale,0);ctx.restore();}break;
        case 'bolt': {
          ctx.beginPath();for(let i=0;i<=7;i++){const x=-p.length/2+i*p.length/7,y=(i===0||i===7)?0:Math.sin(i*17.3+p.seed)*r;ctx[i?'lineTo':'moveTo'](x,y);}ctx.stroke();ctx.globalAlpha=alpha*.55;line(0,Math.sin(3*17.3+p.seed)*r,p.length*.13,-r*1.7);break;
        }
        case 'pixel':ctx.rotate(-p.angle-p.spin*p.age);ctx.fillRect(Math.round(-r/2),Math.round(-r/2),Math.ceil(r),Math.ceil(r));break;
        case 'cross':ctx.fillRect(-r,-r*.25,2*r,r*.5);ctx.fillRect(-r*.25,-r,r*.5,2*r);break;
        case 'butterfly': {
          const flap=.55+Math.sin(p.age*18+p.phase)*.3;ctx.scale(flap,1);
          for(const side of [-1,1]){ctx.beginPath();ctx.moveTo(0,0);ctx.bezierCurveTo(side*r*1.6,-r*1.8,side*r*2,-r*.1,side*r*.25,r*.12);ctx.bezierCurveTo(side*r*1.6,r*.65,side*r*.5,r*1.45,0,r*.35);ctx.fill();}
          ctx.strokeStyle='#8f77aa';ctx.lineWidth=.9*scale;line(0,-r*.4,0,r*.6);break;
        }
        case 'rune':ctx.lineWidth=.95*scale;if(p.variant===1){pathStar(r,3,.5);ctx.stroke();circle(r*1.15);ctx.stroke();}else{line(0,-r,0,r);line(-r*.6,-r*.2,0,-r*.7);line(0,0,r*.65,-r*.4);}break;
        case 'magic':circle(r);ctx.stroke();circle(r*.8);ctx.globalAlpha=alpha*.6;ctx.stroke();ctx.globalAlpha=alpha;for(let j=0;j<2;j++){ctx.save();ctx.rotate(j*Math.PI);pathStar(r*.84,3,.5);ctx.stroke();ctx.restore();}for(let i=0;i<12;i++){ctx.save();ctx.rotate(i/12*TAU);line(r*.9,0,r*.97,0);ctx.restore();}break;
        case 'snow':ctx.lineWidth=.85*scale;for(let i=0;i<6;i++){ctx.save();ctx.rotate(i/6*TAU);line(0,0,0,-r);line(0,-r*.62,-r*.23,-r*.8);line(0,-r*.62,r*.23,-r*.8);ctx.restore();}break;
        case 'page':ctx.scale(.7+Math.abs(Math.sin(p.age*3+p.phase))*.3,1);ctx.globalAlpha=alpha*.2;ctx.fillRect(-r*.65,-r,r*1.3,r*2);ctx.globalAlpha=alpha;ctx.strokeRect(-r*.65,-r,r*1.3,r*2);ctx.lineWidth=.65*scale;for(let i=0;i<3;i++)line(-r*.38,-r*.5+i*r*.4,r*(i===2?.1:.35),-r*.5+i*r*.4);break;
        case 'pearl':pearl(r,p.color);break;
        case 'necklace':ctx.globalAlpha=alpha*.45;circle(r);ctx.stroke();ctx.globalAlpha=alpha;for(let i=0;i<14;i++){ctx.save();ctx.rotate(i/14*TAU);ctx.translate(r,0);pearl((i%2?3:4)*scale,p.color);ctx.restore();}break;
      }
      ctx.restore();
      if (p.type === 'star') {
        const extent=r+(8*scale+2)/dpr+2;
        drawBounds.left=x-extent;drawBounds.top=p.y-extent;drawBounds.right=x+extent;drawBounds.bottom=p.y+extent;
        return drawBounds;
      }
    }
    function render(time) {
      frame=0;if(destroyed)return;
      const dt=previousTime?Math.min(.04,Math.max(.001,(time-previousTime)/1000)):1/60;previousTime=time;
      ctx.setTransform(dpr,0,0,dpr,0,0);
      if (paintedBounds) {
        const left=Math.max(0,Math.floor(paintedBounds.left)),top=Math.max(0,Math.floor(paintedBounds.top));
        const right=Math.min(width,Math.ceil(paintedBounds.right)),bottom=Math.min(height,Math.ceil(paintedBounds.bottom));
        if (right>left && bottom>top) ctx.clearRect(left,top,right-left,bottom-top);
      }
      ctx.save();
      if(typeof options.clip==='function')options.clip(ctx,width,height);
      let alive=0, left=Infinity, top=Infinity, right=-Infinity, bottom=-Infinity, fullCanvas=false;
      // Compact the existing array; a long trail no longer allocates a new
      // particle array every animation frame or reruns a shadow blur per star.
      for (let i=0;i<particles.length;i++) {
        const p=particles[i];
        p.age+=dt;if(p.age>=p.life)continue;
        p.vy+=p.g*dt;const friction=p.drag?Math.exp(-p.drag*dt):1;
        p.vx*=friction;p.vy*=friction;p.x+=p.vx*dt;p.y+=p.vy*dt;
        const bounds=draw(p);
        if (!bounds) fullCanvas=true;
        else {
          left=Math.min(left,bounds.left);top=Math.min(top,bounds.top);
          right=Math.max(right,bounds.right);bottom=Math.max(bottom,bounds.bottom);
        }
        particles[alive++]=p;
      }
      particles.length=alive;
      paintedBounds=fullCanvas?{left:0,top:0,right:width,bottom:height}:
        (alive?{left,top,right,bottom}:null);
      ctx.restore();
      if(particles.length)frame=requestAnimationFrame(render);else previousTime=0;
    }
    function resetTrail() {last=null;}
    function clear() {if(frame)cancelAnimationFrame(frame);frame=0;previousTime=0;particles.length=0;paintedBounds=null;resetTrail();ctx.setTransform(1,0,0,1,0,0);ctx.clearRect(0,0,canvas.width,canvas.height);ctx.setTransform(dpr,0,0,dpr,0,0);}
    function setPreset(value) {const next=Number(value);if(!presets.some(p=>p.id===next))return;clear();clearSprites();id=next;}
    function setOptions(next) {next=next||{};if(next.intensity!==undefined)intensity=clamp(next.intensity,.5,1.5,intensity);if(next.scale!==undefined){const previousScale=scale;scale=clamp(next.scale,.7,1.5,scale);if(scale!==previousScale)clearSprites();}}
    function destroy() {if(destroyed)return;clear();clearSprites();destroyed=true;if(observer)observer.disconnect();window.removeEventListener('resize',resize);}
    return {move,click,setPreset,setOptions,resetTrail,clear,destroy,getState:()=>({id,particles:particles.length,active:!!frame,intensity,scale,width,height,destroyed,softwareRendering:options.softwareRendering===true})};
  }
  window.MouseEffects=Object.freeze({presets:Object.freeze(presets),create});
})();
