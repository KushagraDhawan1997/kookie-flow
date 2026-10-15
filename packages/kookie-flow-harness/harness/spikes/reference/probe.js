// Evaluated in the reference page: the computed look of each v2 part, pseudo-elements included.
() => {
  const strip = (s) => s.replace(/url\("data:image\/svg[^)]*\)/g, 'url(noise)');
  const keys = ['content','position','inset','width','height','borderRadius','backgroundColor','backgroundImage','boxShadow','border','opacity','filter','backdropFilter','mask','maskImage','webkitMaskImage','maskComposite','padding','color','fontSize','fontWeight','transform','cornerShape','stroke','strokeWidth','fill'];
  const read = (el, pseudo) => {
    const s = getComputedStyle(el, pseudo);
    if (pseudo && (s.content === 'none' || s.content === 'normal')) return null;
    const o = {};
    for (const k of keys) {
      const v = s[k];
      if (v && v !== 'none' && v !== 'normal' && v !== 'auto' && v !== '0px' && v !== 'rgba(0, 0, 0, 0)' && v !== 'static') o[k] = strip(String(v)).slice(0, 700);
    }
    return o;
  };
  const pick = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { cls: el.className && String(el.className.baseVal ?? el.className), box: [r.x, r.y, r.width, r.height].map((n) => +n.toFixed(2)), self: read(el), before: read(el, '::before'), after: read(el, '::after') };
  };
  const theme = document.querySelector('.kui-theme') ?? document.documentElement;
  const ts = getComputedStyle(theme);
  const tokens = {};
  for (const t of ['--neutral-1','--neutral-2','--neutral-3','--neutral-4','--neutral-5','--neutral-a7','--neutral-11','--neutral-12','--accent-9','--radius-row-2','--panel-p-2','--control-height-2','--target-min','--material-regular-ring-control','--material-regular-ring','--material-pool-control','--material-control-wash-medium','--material-glass-border','--shadow-3','--material-row-wash','--control-chrome','--grip-cast','--focus-ring-width','--focus-ring-offset']) tokens[t] = ts.getPropertyValue(t).trim().slice(0, 400);
  const out = { tokens };
  const parts = {
    field: '#field .kui-field',
    trigger: '#select .kui-field',
    chevron: '#select .kui-field svg',
    chevronPath: '#select .kui-field svg path, #select .kui-field svg polyline',
    track: '#slider .kui-slider-thumb',
    checkOff: '#checks > :nth-child(1)',
    checkOn: '#checks .kui-checkbox:nth-of-type(2)',
    checkOnSvg: '#checks .kui-checkbox[data-checked] svg',
    checkOnPath: '#checks .kui-checkbox[data-checked] svg path, #checks .kui-checkbox[data-checked] svg polyline',
    button: '#toolbar button:nth-child(2)',
    popup: '.kui-floating-rows',
    popupBody: '.kui-floating-rows > *',
    row1: '.kui-floating-rows .kui-row',
    row2: '.kui-floating-rows .kui-row:nth-of-type(2)',
    tick: '.kui-floating-rows .kui-row svg',
    tickPath: '.kui-floating-rows .kui-row svg path, .kui-floating-rows .kui-row svg polyline',
  };
  for (const [k, s] of Object.entries(parts)) out[k] = pick(s);
  const sliderRoot = document.querySelector('#slider > *');
  out.sliderTree = sliderRoot ? sliderRoot.outerHTML.replace(/style="[^"]*"/g, '').slice(0, 900) : null;
  out.selectTree = document.querySelector('#select')?.innerHTML.slice(0, 900);
  out.popupTree = document.querySelector('.kui-floating-rows')?.outerHTML.slice(0, 1400);
  return out;
}
