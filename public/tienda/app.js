/* WiiGo · Estaciones de Bienestar — la tienda online (app.wiigo.com.ar/tienda).
   Diseño aprobado por Gonzalo el 2026-11-14: el formato práctico de Alifrut (buscador, accesos, productos
   de a dos con «Agregar», marcas → rubros en el menú ☰) con los colores de la pantalla asesora, kcal en
   cada producto, el planeta en «Del mundo» y arriba la persona cargando energía.
   El catálogo viene de /api/tienda/catalogo (lib/tiendaCatalogo.ts), con el stock real del local.
   Etapa 2, parte 1: solo para mirar. El pedido se arma en el navegador; pagar y la cuenta, «Muy pronto».
   Sin paso de compilación: este archivo se sirve tal cual desde public/tienda. */
(function () {
  'use strict';
  var D = window.WIIGO, app = document.getElementById('app');
  if (!D) { app.innerHTML = '<p style="padding:60px 16px;text-align:center">No se pudieron cargar los productos.</p>'; return; }

  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function norm(s) { return String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim(); }
  function plata(n) { return '$' + Math.round(n || 0).toLocaleString('es-AR'); }
  function coma(n) { return String(Math.round(n * 10) / 10).replace('.', ','); }
  var MINUS = { de: 1, del: 1, con: 1, y: 1, sin: 1, en: 1, la: 1, el: 1, a: 1, o: 1, para: 1, al: 1, e: 1 };
  function titulo(s) {
    return String(s || '').toLowerCase().split(' ').map(function (w, i) {
      if (!w || /^x?\d/.test(w) || /^(g|gr|grs|kg|ml|cc|lt|l|u|mg|cm)\.?$/.test(w) || (i > 0 && MINUS[w])) return w;
      var j = w.search(/[a-záéíóúñü]/);
      return j < 0 ? w : w.slice(0, j) + w.charAt(j).toUpperCase() + w.slice(j + 1);
    }).join(' ');
  }
  var IC = {
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>', persona: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    bolsa: '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/>',
    lupa: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-3.5-3.5"/>', ojo: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    cruz: '<path d="M6 6l12 12M18 6L6 18"/>', abajo: '<path d="M6 9l6 6 6-6"/>', atras: '<path d="M15 18l-6-6 6-6"/>', flecha: '<path d="M9 6l6 6-6 6"/>',
    chispa: '<path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6"/>', marcas: '<rect x="3" y="3" width="7" height="7" rx="2"/><rect x="14" y="3" width="7" height="7" rx="2"/><rect x="3" y="14" width="7" height="7" rx="2"/><rect x="14" y="14" width="7" height="7" rx="2"/>',
    globo: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>', objetivo: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1"/>',
    salud: '<path d="M12 20s-7-4.5-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.5-7 10-7 10z"/>'
  };
  function ic(n, t) { return '<svg width="' + (t || 22) + '" height="' + (t || 22) + '" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + IC[n] + '</svg>'; }

  // Dónde va cada origen en el planeta (el mismo mapa de la tienda). Solo orígenes reales, de la ficha.
  var LUGARES = {
    egipto: { n: 'Egipto', lat: 26.8, lon: 30.8 }, argelia: { n: 'Argelia', lat: 28, lon: 2.6 }, vietnam: { n: 'Vietnam', lat: 14.1, lon: 108.3 },
    brasil: { n: 'Brasil', lat: -10, lon: -52 }, pakistan: { n: 'Pakistán · Himalaya', lat: 30.4, lon: 69.3 }, bolivia: { n: 'Bolivia', lat: -16.3, lon: -63.6 },
    peru: { n: 'Perú', lat: -9.2, lon: -75 }, chile: { n: 'Chile', lat: -33, lon: -71 }, china: { n: 'China', lat: 35.9, lon: 104.2 },
    eeuu: { n: 'Estados Unidos', lat: 39, lon: -98 }, iran: { n: 'Irán', lat: 32, lon: 53 }, turquia: { n: 'Turquía', lat: 39, lon: 35 },
    misiones: { n: 'Misiones, Argentina', lat: -27, lon: -54.6 }, mendoza: { n: 'Mendoza, Argentina', lat: -33.5, lon: -68.8 }, argentina: { n: 'Argentina', lat: -37, lon: -62 }
  };
  function lugarClave(txt) {
    var t = norm(txt);
    var tabla = [['misiones', 'misiones'], ['mendoza', 'mendoza'], ['pakistan', 'pakistan'], ['himalaya', 'pakistan'], ['egipto', 'egipto'], ['argelia', 'argelia'], ['vietnam', 'vietnam'], ['brasil', 'brasil'], ['bolivia', 'bolivia'], ['peru', 'peru'], ['chile', 'chile'], ['china', 'china'], ['eeuu', 'eeuu'], ['estados unidos', 'eeuu'], ['iran', 'iran'], ['turqu', 'turquia'], ['argentin', 'argentina']];
    for (var i = 0; i < tabla.length; i++) if (t && t.indexOf(tabla[i][0]) >= 0) return tabla[i][1];
    return null;
  }
  // Una persona enchufada a una estación WiiGo: la batería del pecho se llena (naranja → amarillo → verde).
  var ILUS_CARGA = '<svg viewBox="0 0 140 160" role="img" aria-label="Una persona cargando energía en una estación WiiGo">' +
    '<ellipse cx="74" cy="152" rx="62" ry="5" fill="rgba(0,0,0,.25)"/>' +
    // la estación (clara, sobre el cartel verde oscuro)
    '<rect x="4" y="46" width="38" height="102" rx="10" fill="#f5efe3"/><rect x="10" y="56" width="26" height="22" rx="5" fill="#22301f"/>' +
    '<path class="rayo-pantalla" d="M25 59l-6 9h5l-3 7 7-10h-5l2-6z" fill="#f1c75b"/>' +
    '<text x="23" y="100" text-anchor="middle" font-family="Bricolage Grotesque,sans-serif" font-weight="800" font-size="11" fill="#22301f">WiiGo</text>' +
    '<rect x="10" y="108" width="26" height="4" rx="2" fill="#e8743b"/><rect x="10" y="116" width="18" height="4" rx="2" fill="#b6bca2"/>' +
    '<rect x="41" y="80" width="7" height="14" rx="3" fill="#b6bca2"/><rect x="0" y="144" width="46" height="7" rx="3.5" fill="#b6bca2"/>' +
    // el cable con energía que corre
    '<path d="M47 87C66 86 58 122 78 100" fill="none" stroke="#b6bca2" stroke-width="5" stroke-linecap="round"/>' +
    '<path class="flujo" d="M47 87C66 86 58 122 78 100" fill="none" stroke="#f1c75b" stroke-width="2.6" stroke-linecap="round"/>' +
    // la persona
    '<rect x="95" y="118" width="9" height="30" rx="4.5" fill="#b6bca2"/><rect x="107" y="118" width="9" height="30" rx="4.5" fill="#b6bca2"/>' +
    '<rect x="88" y="62" width="34" height="62" rx="15" fill="#e8743b"/>' +
    '<path d="M92 72L79 97" stroke="#e8743b" stroke-width="9" stroke-linecap="round"/><circle cx="78" cy="99" r="5.5" fill="#d9a37f"/>' +
    '<path d="M118 72l6 22" stroke="#e8743b" stroke-width="9" stroke-linecap="round"/><circle cx="124.5" cy="96" r="5" fill="#d9a37f"/>' +
    '<circle cx="105" cy="45" r="14" fill="#d9a37f"/><path d="M91 44c0-10 6-16 14-16s14 6 14 15c-4-6-9-8-14-8s-10 3-14 9z" fill="#3a2010"/>' +
    '<circle cx="100" cy="46" r="1.6" fill="#3a2010"/><circle cx="110" cy="46" r="1.6" fill="#3a2010"/><path d="M100 51q5 4 10 0" fill="none" stroke="#3a2010" stroke-width="1.6" stroke-linecap="round"/>' +
    // la batería en el pecho
    '<rect x="101" y="72" width="7" height="3" rx="1" fill="#fffaf2"/><rect x="96" y="75" width="17" height="32" rx="4" fill="rgba(0,0,0,.2)" stroke="#fffaf2" stroke-width="2"/>' +
    '<rect class="nivel" x="99" y="78" width="11" height="26" rx="2" fill="#f1c75b"/><path d="M106 81l-5 9h4l-2 8 6-10h-4l2-7z" fill="#fffaf2"/>' +
    // chispas de energía cuando se llena
    '<path class="chispa" d="M88 30l-5-5" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/><path class="chispa b" d="M105 24v-7" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/><path class="chispa c" d="M122 30l5-5" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/>' +
    '</svg>';
  var TONOS = [['#e8743b', '#2a1406'], ['#2e3f29', '#f5efe3'], ['#f1c75b', '#3b2f0e'], ['#a8c08a', '#1f2b17'], ['#d9a37f', '#3a2010'], ['#3f6b6d', '#eef5f2']];
  var HOY = Date.now();
  var PROD = D.productos.map(function (p) {
    var x = {}; for (var k in p) x[k] = p[k];
    x.t = titulo(p.n); x.busca = norm([p.n, p.m, p.mf, p.sc, p.c, (p.ob || []).join(' '), p.o, (p.v || []).map(function (v) { return v.n; }).join(' ')].join(' '));
    x.dias = p.alta ? Math.floor((HOY - new Date(p.alta + 'T12:00:00').getTime()) / 864e5) : 999;
    x.lugar = p.o ? lugarClave(p.o) : null; return x;
  });
  var POR_ID = {}; PROD.forEach(function (p) { POR_ID[p.id] = p; });
  var DEL_MUNDO = {}; PROD.forEach(function (p) { if (p.lugar) (DEL_MUNDO[p.lugar] = DEL_MUNDO[p.lugar] || []).push(p); });
  var CLAVES_MUNDO = Object.keys(DEL_MUNDO).sort(function (a, b) { return DEL_MUNDO[b].length - DEL_MUNDO[a].length; });
  // Info nutricional chiquita (cada 100 g): kcal y macros, sin explicación.
  // Si todo da cero (la creatina, por ejemplo) no se muestra: «0 kcal · P 0 · C 0» no le dice nada al cliente.
  function tieneNutri(p) { return [p.k, p.pr, p.ca, p.gr].some(function (v) { return v != null && Number(v) > 0; }); }
  function nutriChica(p) {
    if (!tieneNutri(p)) return '';
    var m = function (l, v) { return v == null ? '' : '<span>' + l + ' ' + coma(v) + '</span>'; };
    return '<div class="t-nutri" title="Cada 100 g">' + (p.k != null ? '<span class="kcal">' + Math.round(p.k) + ' kcal</span>' : '') + m('P', p.pr) + m('C', p.ca) + m('G', p.gr) + '</div>';
  }
  var MARCAS = D.marcas, MARCA = {}; MARCAS.forEach(function (m) { MARCA[m.n] = m; });
  // Nuevos: los 20 que entraron último (con stock), no todo lo del mes.
  var NUEVOS = PROD.filter(function (p) { return p.s > 0 && p.dias <= 30; }).sort(function (a, b) { return a.dias - b.dias; }).slice(0, 20);
  function ordenar(l) { return l.slice().sort(function (a, b) { return (b.s > 0) - (a.s > 0) || (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.t.localeCompare(b.t, 'es'); }); }

  /* estado */
  var S = { vista: 'inicio', f: null, q: '', limite: 20, menu: false, menuMarca: null, menuQ: '', ficha: null, pedido: false };
  var carrito = [], sabor = {};
  function stockDe(p, v) { if (v) { var x = (p.v || []).filter(function (y) { return y.n === v; })[0]; return x ? x.s : 0; } return p.s; }
  function saborDe(p) { if (!p.v || !p.v.length) return null; if (sabor[p.id] === undefined) sabor[p.id] = ((p.v.filter(function (v) { return v.s > 0; })[0]) || {}).n || null; return sabor[p.id]; }
  function enCarrito(id, v) { var l = carrito.filter(function (x) { return x.id === id && x.v === (v || null); })[0]; return l ? l.q : 0; }
  function sumar(id, v, n) {
    var p = POR_ID[id], l = carrito.filter(function (x) { return x.id === id && x.v === (v || null); })[0];
    if (!l) { if (n <= 0) return; l = { id: id, v: v || null, q: 0 }; carrito.push(l); }
    var antes = l.q; l.q = Math.max(0, Math.min(stockDe(p, v), l.q + n));
    if (n > 0 && l.q === antes) aviso('No hay más stock de este producto');
    carrito = carrito.filter(function (x) { return x.q > 0; });
  }
  function totales() { var t = { u: 0, g: 0, e: 0 }; carrito.forEach(function (l) { var p = POR_ID[l.id]; t.u += l.q; t.g += p.p * l.q; t.e += (p.e || p.p) * l.q; }); return t; }
  function aviso(t) { var d = document.createElement('div'); d.className = 'aviso'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1800); }

  /* la tarjeta, de a dos, como Alifrut */
  // Las fotos pesan hasta 150 KB a 1000 px: el optimizador de Next las manda del tamaño justo.
  // Si el optimizador no responde, onerror vuelve a la foto original.
  function chica(url, w) { return url && url.indexOf('https://') === 0 ? '/_next/image?url=' + encodeURIComponent(url) + '&w=' + w + '&q=75' : url; }
  function imagen(url, w, extra) { return '<img src="' + esc(chica(url, w)) + '" data-orig="' + esc(url) + '" onerror="if(this.dataset.orig&&this.src.indexOf(\'/_next/\')>=0)this.src=this.dataset.orig" alt="" loading="lazy" decoding="async"' + (extra || '') + '>'; }
  function foto(p, w) {
    if (p.img) return imagen(p.img, w || 384);
    var m = MARCA[p.m];
    if (p.m !== 'WiiGo' && m && m.logo) return imagen(m.logo, 256, ' style="width:60%;height:60%;border-radius:50%"');
    return '<span class="kraft">' + esc(p.t) + '</span>';
  }
  function boton(p) {
    var v = saborDe(p), st = p.v && p.v.length ? (v ? stockDe(p, v) : 0) : p.s, n = enCarrito(p.id, v);
    if (st <= 0) return '<button class="agregar" disabled>Sin stock</button>';
    if (!n) return '<button class="agregar" data-a="sumar" data-id="' + p.id + '">Agregar</button>';
    return '<div class="paso"><button data-a="restar" data-id="' + p.id + '" aria-label="Uno menos">−</button><span>' + n + '</span><button data-a="sumar" data-id="' + p.id + '" aria-label="Uno más">+</button></div>';
  }
  function sabores(p) {
    if (!p.v || !p.v.length) return '';
    var v = saborDe(p);
    return '<div class="t-sabores">' + p.v.map(function (x) { return '<button data-a="sabor" data-id="' + p.id + '" data-x="' + esc(x.n) + '" aria-pressed="' + (v === x.n) + '"' + (x.s <= 0 ? ' disabled' : '') + '>' + esc(x.n) + '</button>'; }).join('') + '</div>';
  }
  function tarjeta(p) {
    var etq = p.s <= 0 ? '<span class="t-etq sin">Sin stock</span>' : p.s <= 2 ? '<span class="t-etq poco">Últimas ' + p.s + '</span>' : '';
    return '<article class="tarjeta"><div class="t-arriba"><span class="t-rubro">' + esc(p.sc) + '</span>' + etq +
      '<button class="t-foto" data-a="ficha" data-id="' + p.id + '" aria-label="Ver ' + esc(p.t) + '">' + foto(p) + '</button>' +
      '<span class="t-marca">' + esc(p.mf || p.m) + '</span><button class="t-ver" data-a="ficha" data-id="' + p.id + '" aria-label="Ver detalle">' + ic('ojo', 18) + '</button></div>' +
      '<div class="t-cuerpo"><span class="t-nombre">' + esc(p.t) + '</span>' + nutriChica(p) + sabores(p) +
      '<div class="t-precio"><b>' + plata(p.p) + '</b><span>' + plata(p.e || p.p) + ' efectivo</span></div><div data-acc="' + p.id + '">' + boton(p) + '</div></div></article>';
  }
  function grilla(l) { return '<div class="grilla">' + l.map(tarjeta).join('') + '</div>'; }
  function conMas(l) { return grilla(l.slice(0, S.limite)) + (l.length > S.limite ? '<button class="ver-mas" data-a="mas">Ver más productos (' + (l.length - S.limite) + ')</button>' : ''); }

  /* qué productos mostrar */
  function filtrados() {
    var f = S.f || {}, l = PROD;
    if (f.marca) l = l.filter(function (p) { return p.m === f.marca; });
    if (f.sub) l = l.filter(function (p) { return p.sc === f.sub; });
    if (f.cat) l = l.filter(function (p) { return p.c === f.cat; });
    if (f.nuevos) l = NUEVOS;
    if (f.obj) l = l.filter(function (p) { return (p.ob || []).indexOf(f.obj) >= 0; });
    if (f.lugar) l = l.filter(function (p) { return p.lugar === f.lugar; });
    else if (f.mundo) l = l.filter(function (p) { return p.lugar; });
    if (S.q.length >= 2) {
      var ws = norm(S.q).split(' ').filter(Boolean);
      return l.filter(function (p) { return ws.every(function (w) { return p.busca.indexOf(w) >= 0 || (w.length > 3 && p.busca.indexOf(w.slice(0, -1)) >= 0); }); })
        .sort(function (a, b) { var w = norm(S.q); return (norm(b.n).indexOf(w) === 0) - (norm(a.n).indexOf(w) === 0) || (b.s > 0) - (a.s > 0) || a.t.localeCompare(b.t, 'es'); });
    }
    return f.nuevos ? l.slice().sort(function (a, b) { return a.dias - b.dias; }) : ordenar(l);
  }

  /* pantallas */
  function inicio() {
    var recientes = PROD.filter(function (p) { return p.s > 0; }).sort(function (a, b) { return a.dias - b.dias || (b.img ? 1 : 0) - (a.img ? 1 : 0); }).slice(0, 10);
    var porMarca = {}; PROD.forEach(function (p) { if (p.img && p.s > 0 && recientes.indexOf(p) < 0) (porMarca[p.m] = porMarca[p.m] || []).push(p); });
    var dest = [], vuelta = 0; while (dest.length < 8 && vuelta < 12) { MARCAS.forEach(function (m) { var l = porMarca[m.n]; if (l && l[vuelta] && dest.length < 8) dest.push(l[vuelta]); }); vuelta++; }
    return '<section class="carga"><div><h1 class="hola">La estación de servicio de <em>tu cuerpo</em>.</h1><p class="hola-sub">Cargá energía: pedí online y retiralo listo en 15 minutos.</p></div>' + ILUS_CARGA + '</section>' +
      '<h2 class="seccion">Recién ingresados</h2><div class="carrusel">' + recientes.map(tarjeta).join('') + '</div>' +
      '<h2 class="seccion">Destacados</h2>' + grilla(dest) +
      '<h2 class="seccion">Todos los productos</h2>' + conMas(ordenar(PROD)) + pie();
  }
  function lista() {
    var f = S.f || {}, l = filtrados(), extra = '';
    if (f.mundo) {
      var total = CLAVES_MUNDO.reduce(function (a, k) { return a + DEL_MUNDO[k].length; }, 0);
      extra = '<div class="mundo"><div class="globo" id="globo"></div><div class="mundo-txt"><b>' + (f.lugar ? 'Desde ' + esc(LUGARES[f.lugar].n) : 'De cada rincón, a tu estación') + '</b><span>' + (f.lugar ? DEL_MUNDO[f.lugar].length + ' productos · tocá otro lugar en el planeta' : total + ' productos con su origen en ' + CLAVES_MUNDO.length + ' lugares · girá el planeta y tocá uno') + '</span></div></div>' +
        '<div class="accesos" style="margin:0 -14px 12px"><button class="acceso" data-a="lugar" data-k="" aria-pressed="' + !f.lugar + '">Todos</button>' + CLAVES_MUNDO.map(function (k) { return '<button class="acceso" data-a="lugar" data-k="' + k + '" aria-pressed="' + (f.lugar === k) + '">' + esc(LUGARES[k].n) + ' · ' + DEL_MUNDO[k].length + '</button>'; }).join('') + '</div>';
    }
    if (f.objetivos) extra = '<div class="accesos tonos" style="margin:0 -14px 12px">' + D.objetivos.map(function (o, i) { var n = PROD.filter(function (p) { return (p.ob || []).indexOf(o) >= 0; }).length, t = TONOS[i % TONOS.length]; return n ? '<button class="acceso" data-a="obj" data-o="' + esc(o) + '" aria-pressed="' + (f.obj === o) + '" style="background:' + t[0] + ';color:' + t[1] + (f.obj === o ? ';box-shadow:0 0 0 3px var(--fondo),0 0 0 5px ' + t[0] : ';opacity:.82') + '">' + esc(o) + ' · ' + n + '</button>' : ''; }).join('') + '</div>';
    var tit = S.q.length >= 2 && !S.f ? 'Resultados para «' + esc(S.q) + '»' : esc(f.titulo || 'Productos');
    return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>' + tit + '</b><small>' + l.length + (l.length === 1 ? ' producto' : ' productos') + (f.sub ? ' · ' + esc(f.marca) : '') + '</small></span></div>' + extra +
      (l.length ? conMas(l) : '<div class="vacio"><b>No encontramos eso</b><p>Probá con otra palabra o mirá las marcas en el menú ☰.</p></div>');
  }
  function profesionales() {
    return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>Profesionales</b><small>Nutricionistas que trabajan con WiiGo</small></span></div><div style="display:grid;gap:10px">' +
      D.profesionales.map(function (p) { return '<div class="tarjeta" style="flex-direction:row;gap:14px;padding:12px;align-items:center">' + (p.foto ? imagen(p.foto, 256, ' style="width:84px;height:100px;object-fit:cover;border-radius:14px"') : '') + '<span><b style="font:800 18px/1.1 var(--display)">' + esc(p.n) + '</b><small style="display:block;color:var(--gris);margin:4px 0 8px">' + esc(p.t) + '</small>' + (p.ob ? '<button class="acceso" data-a="obj-directo" data-o="' + esc(p.ob) + '">Productos para ' + esc(p.ob.toLowerCase()) + '</button>' : '') + '</span></div>'; }).join('') + '</div>';
  }
  function pie() { return '<footer class="pie"><img src="/wiigo-logo-negro.png" alt="WiiGo"><span><b>Estación Arístides Villanueva 256</b>, Mendoza</span><span>Lunes a sábado de 9 a 13 y de 17 a 21</span><span>Retiro en la estación, listo en menos de 15 minutos · Envío a domicilio: próximamente</span><span>@wiigo.arg</span><span style="font-size:12px">NUOVO IMPERO S.A.S. · CUIT 30-71851497-1 · Defensa de las y los consumidores</span></footer>'; }

  function cajon() {
    if (!S.menu) return '';
    var w = norm(S.menuQ);
    var marcas = MARCAS.map(function (m) {
      var subs = {}; PROD.forEach(function (p) { if (p.m === m.n) subs[p.sc] = (subs[p.sc] || 0) + 1; });
      var claves = Object.keys(subs).sort(function (a, b) { return a.localeCompare(b, 'es'); });
      var coinciden = w ? claves.filter(function (s) { return norm(s).indexOf(w) >= 0; }) : claves;
      if (w && !coinciden.length && norm(m.n).indexOf(w) < 0) return '';
      var abierta = S.menuMarca === m.n || (w && coinciden.length);
      return '<button class="c-fila" data-a="menu-marca" data-x="' + esc(m.n) + '" aria-expanded="' + !!abierta + '">' + (m.logo ? imagen(m.logo, 64) : '') + '<span>' + esc(m.n) + '</span><span class="cant">' + m.cant + '</span>' + ic('abajo', 18) + '</button>' +
        (abierta ? '<div class="c-subs"><button class="c-fila" data-a="ver-marca" data-m="' + esc(m.n) + '"><span>Todo ' + esc(m.n) + '</span></button>' + (w ? coinciden : claves).map(function (s) { return '<button class="c-fila" data-a="ver-sub" data-m="' + esc(m.n) + '" data-s="' + esc(s) + '"><span>' + esc(s) + '</span><span class="cant">' + subs[s] + '</span></button>'; }).join('') + '</div>' : '');
    }).join('');
    return '<div class="fondo" data-a="cerrar-menu"></div><aside class="cajon" role="dialog" aria-modal="true" aria-label="Marcas y rubros"><div class="cajon-cab"><span><b>WiiGo</b><small>Marcas y rubros</small></span><button class="redondo" data-a="cerrar-menu" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div>' +
      '<label class="buscar">' + ic('lupa', 18) + '<span class="oculto">Buscar rubro</span><input id="mq" type="search" autocomplete="off" placeholder="Buscar rubro" value="' + esc(S.menuQ) + '"></label>' +
      '<div class="cajon-lista"><button class="c-fila" data-a="ver-todo"><span>Todos los productos</span><span class="cant">' + PROD.length + '</span></button>' + (marcas || '<p>No hay rubros con ese nombre</p>') + '</div></aside>';
  }
  function ficha() {
    var p = POR_ID[S.ficha]; if (!p) return '';
    var nutri = tieneNutri(p);
    return '<div class="fondo" data-a="cerrar-ficha"></div><section class="hoja" role="dialog" aria-modal="true" aria-label="' + esc(p.t) + '"><div class="hoja-cab"><span></span><button class="redondo" data-a="cerrar-ficha" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div><div class="hoja-cuerpo">' +
      '<div class="f-foto">' + foto(p, 828) + '</div><h2 class="f-nombre">' + esc(p.t) + '</h2><span class="f-de">' + esc(p.mf || p.m) + ' · ' + esc(p.sc) + '</span>' +
      '<div class="f-precio"><b>' + plata(p.p) + '</b><span>' + plata(p.e || p.p) + ' efectivo</span></div>' + sabores(p) + '<div style="margin-top:10px" data-acc="' + p.id + '">' + boton(p) + '</div>' +
      // Nutrición en números, sin explicación. Después, el texto chico.
      (nutri ? '<div class="f-nutri" title="Cada 100 g">' + [['kcal', 'Kcal', p.k, ''], ['', 'Prot.', p.pr, ' g'], ['', 'Carbos', p.ca, ' g'], ['', 'Grasas', p.gr, ' g'], ['', 'Fibra', p.fi, ' g']].map(function (x) { return '<div class="' + x[0] + '"><small>' + x[1] + '</small><b>' + (x[2] == null ? '—' : (x[0] ? Math.round(x[2]) : coma(x[2])) + x[3]) + '</b></div>'; }).join('') + '</div><p class="f-chico" style="margin-top:6px">Cada 100 g' + (p.po ? ' · porción: ' + esc(p.po) : '') + '</p>' : '') +
      (p.fl && p.fl.length ? '<p class="f-chico" style="color:#3f5536;font-weight:800">' + esc(p.fl.map(function (x) { return titulo(x.replace(/\s+/g, ' ')); }).join(' · ')) + '</p>' : '') +
      (p.de ? '<p class="f-desc' + (S.descAbierta ? ' abierta' : '') + '" data-a="desc">' + esc(p.de) + '</p>' : '') +
      (p.o ? '<p class="f-chico"><b>Origen:</b> ' + esc(p.o) + '</p>' : '') +
      (p.in ? '<p class="f-chico"><b>Ingredientes:</b> ' + esc(p.in) + (p.al ? ' · <b>Alérgenos:</b> ' + esc(p.al) : '') + '</p>' : '') + '</div></section>';
  }
  function pedido() {
    if (!S.pedido) return '';
    var t = totales();
    return '<div class="fondo" data-a="cerrar-pedido"></div><section class="hoja" role="dialog" aria-modal="true" aria-label="Mi pedido"><div class="hoja-cab"><h2>Mi pedido</h2><button class="redondo" data-a="cerrar-pedido" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div><div class="hoja-cuerpo">' +
      (carrito.length ? carrito.map(function (l) { var p = POR_ID[l.id]; return '<div class="linea-ped"><span class="mini">' + foto(p) + '</span><span><b>' + esc(p.t) + (l.v ? ' — ' + esc(l.v) : '') + '</b><small>' + plata(p.p * l.q) + ' · efectivo ' + plata((p.e || p.p) * l.q) + '</small></span><div class="paso"><button data-a="p-restar" data-id="' + l.id + '" data-v="' + esc(l.v || '') + '" aria-label="Uno menos">−</button><span>' + l.q + '</span><button data-a="p-sumar" data-id="' + l.id + '" data-v="' + esc(l.v || '') + '" aria-label="Uno más">+</button></div></div>'; }).join('') : '<div class="vacio">Todavía no agregaste nada.</div>') + '</div>' +
      (carrito.length ? '<div class="hoja-pie"><div class="total"><span>Total</span><b>' + plata(t.g) + '</b></div><div class="total ef"><span>Pagando en efectivo al retirar</span><b>' + plata(t.e) + '</b></div><span class="nota">Lo retirás en Arístides Villanueva 256, listo en menos de 15 minutos.</span><span class="nota" style="background:var(--salvia-t);border-color:#d7dcc8"><b>Muy pronto vas a poder pagar online</b> con Mercado Pago o en efectivo al retirar. Mientras tanto, mostrá este pedido en la estación y te lo armamos.</span></div>' : '') + '</section>';
  }

  /* pintar */
  function pintar(arriba) {
    var t = totales(), f = S.f || {};
    var acc = function (a, ico, txt, on, n) { return '<button class="acceso" data-a="' + a + '" aria-pressed="' + !!on + '">' + ic(ico, 16) + txt + (n ? '<span class="n">' + n + '</span>' : '') + '</button>'; };
    var cab = '<header class="cab"><div class="cab-fila"><button class="redondo" data-a="abrir-menu" aria-label="Marcas y rubros">' + ic('menu') + '</button><button data-a="inicio" style="border:0;background:none;padding:0" aria-label="Inicio"><img class="logo" src="/wiigo-logo-negro.png" alt="WiiGo Estaciones de Bienestar"></button><span class="espacio"></span>' +
      '<button class="redondo" data-a="cuenta" aria-label="Mi cuenta">' + ic('persona') + '</button><button class="redondo" data-a="abrir-pedido" aria-label="Mi pedido">' + ic('bolsa') + '<span class="n">' + t.u + '</span></button></div>' +
      '<label class="buscar">' + ic('lupa', 20) + '<span class="oculto">Buscar producto</span><input id="q" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Buscar producto" value="' + esc(S.q) + '">' + (S.q ? '<button class="limpiar" data-a="limpiar" aria-label="Borrar búsqueda">' + ic('cruz', 18) + '</button>' : '') + '</label>' +
      '<div class="accesos">' + acc('nuevos', 'chispa', 'Nuevos', f.nuevos, NUEVOS.length) + acc('abrir-menu', 'marcas', 'Marcas', false) + acc('mundo', 'globo', 'Del mundo', f.mundo) + acc('objetivos', 'objetivo', 'Objetivos', f.objetivos) + acc('pros', 'salud', 'Profesionales', S.vista === 'pros') + '</div></header>';
    var cuerpo = S.vista === 'pros' ? profesionales() : (S.vista === 'lista' || S.q.length >= 2) ? lista() : inicio();
    var barra = t.u && !S.pedido && !S.ficha ? '<div class="barra"><button data-a="abrir-pedido"><span>' + ic('bolsa', 20) + t.u + (t.u === 1 ? ' producto' : ' productos') + ' · ' + plata(t.g) + '</span><span>Ver mi pedido ' + ic('flecha', 18) + '</span></button></div>' : '';
    var foco = document.activeElement && (document.activeElement.id === 'q' || document.activeElement.id === 'mq') ? document.activeElement.id : null;
    var pos = foco ? document.activeElement.selectionStart : 0, y = window.scrollY;
    app.innerHTML = cab + '<main>' + cuerpo + '</main>' + barra + cajon() + ficha() + pedido();
    if (foco) { var i = document.getElementById(foco); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }
    window.scrollTo(0, arriba ? 0 : y);
    montarGlobo();
  }

  /* El planeta (three.js, el mismo de la tienda). Se crea una vez y se vuelve a enganchar en cada pintada. */
  var G = null, menosMov = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function cargarThree(listo) {
    if (window.THREE) return listo();
    if (cargarThree.esperando) return cargarThree.esperando.push(listo);
    cargarThree.esperando = [listo];
    var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
    s.onload = function () { cargarThree.esperando.forEach(function (f) { f(); }); cargarThree.esperando = null; };
    s.onerror = function () { cargarThree.fallo = true; montarGlobo(); };
    document.head.appendChild(s);
  }
  function hayWebGL() { try { var c = document.createElement('canvas'); return !!(c.getContext('webgl') || c.getContext('experimental-webgl')); } catch (e) { return false; } }
  function montarGlobo() {
    var cont = document.getElementById('globo'); if (!cont) { if (G) G.visible = false; return; }
    if (cargarThree.fallo || !hayWebGL()) { cont.innerHTML = '<div class="liviano"></div>'; return; }
    cargarThree(function () {
      var c = document.getElementById('globo'); if (!c) return;
      if (!G) G = crearGlobo();
      c.appendChild(G.renderer.domElement); c.appendChild(G.etiquetas); G.atar(c); G.cont = c; G.visible = true; G.ajustar(); G.marcar(S.f && S.f.lugar);
    });
  }
  function aVector(lat, lon, r) { var phi = (90 - lat) * Math.PI / 180, th = (lon + 180) * Math.PI / 180; return new THREE.Vector3(-r * Math.sin(phi) * Math.cos(th), r * Math.cos(phi), r * Math.sin(phi) * Math.sin(th)); }
  function crearGlobo() {
    var renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true });
    renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    var escena = new THREE.Scene(), camara = new THREE.PerspectiveCamera(32, 1, 0.1, 100); camara.position.set(0, 0, 4.1);
    var carga = new THREE.TextureLoader(), grupo = new THREE.Group(); escena.add(grupo);
    grupo.add(new THREE.Mesh(new THREE.SphereGeometry(1, 64, 64), new THREE.MeshPhongMaterial({ map: carga.load('img/tierra.jpg'), bumpMap: carga.load('img/tierra-relieve.jpg'), bumpScale: 0.035, specular: new THREE.Color(0x1d2a3a), shininess: 16 })));
    var atm = new THREE.Mesh(new THREE.SphereGeometry(1.14, 64, 64), new THREE.ShaderMaterial({
      vertexShader: 'varying vec3 vN; void main(){ vN = normalize(normalMatrix * normal); gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'varying vec3 vN; void main(){ float i = pow(0.66 - dot(vN, vec3(0.0, 0.0, 1.0)), 3.0); gl_FragColor = vec4(0.45, 0.7, 1.0, 1.0) * i; }',
      blending: THREE.AdditiveBlending, side: THREE.BackSide, transparent: true }));
    escena.add(atm); escena.add(new THREE.AmbientLight(0xffffff, 0.38));
    var sol = new THREE.DirectionalLight(0xffffff, 1.1); sol.position.set(-3, 1.6, 3.2); escena.add(sol);
    var est = new THREE.BufferGeometry(), pos = new Float32Array(900 * 3);
    for (var i = 0; i < 900; i++) { var v = new THREE.Vector3(Math.random() - 0.5, Math.random() - 0.5, Math.random() - 0.5).normalize().multiplyScalar(18 + Math.random() * 20); pos[i * 3] = v.x; pos[i * 3 + 1] = v.y; pos[i * 3 + 2] = v.z; }
    est.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    escena.add(new THREE.Points(est, new THREE.PointsMaterial({ color: 0xffffff, size: 0.05, transparent: true, opacity: 0.75 })));
    var etiquetas = document.createElement('div'); etiquetas.className = 'etiquetas';
    var pines = CLAVES_MUNDO.map(function (k) {
      var L = LUGARES[k], p = aVector(L.lat, L.lon, 1.005);
      var punto = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 12), new THREE.MeshBasicMaterial({ color: 0xe8743b })); punto.position.copy(p); grupo.add(punto);
      var aro = new THREE.Mesh(new THREE.RingGeometry(0.022, 0.03, 32), new THREE.MeshBasicMaterial({ color: 0xe8743b, transparent: true, opacity: 0.8, side: THREE.DoubleSide }));
      aro.position.copy(p); aro.lookAt(p.clone().multiplyScalar(2)); grupo.add(aro);
      var b = document.createElement('button'); b.className = 'pin'; b.setAttribute('data-a', 'lugar'); b.setAttribute('data-k', k); b.innerHTML = '<i></i>' + esc(L.n) + ' · ' + DEL_MUNDO[k].length;
      etiquetas.appendChild(b);
      return { k: k, pos: p, aro: aro, boton: b };
    });
    grupo.rotation.set(0.35, -1.0, 0);
    var g = { renderer: renderer, etiquetas: etiquetas, cont: null, visible: true, arrastre: null, objetivo: null, quieto: 0 };
    g.ajustar = function () { if (!g.cont) return; var w = g.cont.clientWidth, h = g.cont.clientHeight; renderer.setSize(w, h, false); camara.aspect = w / h; camara.updateProjectionMatrix(); };
    g.marcar = function (k) {
      pines.forEach(function (p) { p.boton.setAttribute('aria-pressed', String(p.k === k)); });
      if (!k) { g.objetivo = null; return; }
      var L = LUGARES[k], v = aVector(L.lat, L.lon, 1); g.objetivo = { y: -Math.atan2(v.x, v.z), x: L.lat * Math.PI / 180 };
    };
    g.atar = function (cont) {
      cont.onpointerdown = function (e) { if (e.target.closest('.pin')) return; g.arrastre = { x: e.clientX, y: e.clientY, ry: grupo.rotation.y, rx: grupo.rotation.x }; g.objetivo = null; };
      cont.onpointermove = function (e) { if (!g.arrastre) return; grupo.rotation.y = g.arrastre.ry + (e.clientX - g.arrastre.x) * 0.006; grupo.rotation.x = Math.max(-1.1, Math.min(1.1, g.arrastre.rx + (e.clientY - g.arrastre.y) * 0.004)); };
      cont.onpointerup = cont.onpointercancel = cont.onpointerleave = function () { g.arrastre = null; g.quieto = performance.now(); };
    };
    var cam = new THREE.Vector3(), w2 = new THREE.Vector3();
    function cuadro(t) {
      requestAnimationFrame(cuadro);
      if (!g.visible || !g.cont || !document.body.contains(g.cont)) return;
      if (g.objetivo) { var dy = g.objetivo.y - grupo.rotation.y; dy = Math.atan2(Math.sin(dy), Math.cos(dy)); grupo.rotation.y += dy * 0.07; grupo.rotation.x += (g.objetivo.x - grupo.rotation.x) * 0.07; }
      else if (!g.arrastre && !menosMov && t - g.quieto > 1500) grupo.rotation.y += 0.0016;
      atm.rotation.copy(grupo.rotation);
      var s = 1 + 0.35 * Math.sin(t / 400), elegido = S.f && S.f.lugar;
      grupo.updateMatrixWorld(); cam.copy(camara.position).normalize();
      var w = g.cont.clientWidth, h = g.cont.clientHeight, puestos = [];
      pines.slice().sort(function (a, b) { return (b.k === elegido) - (a.k === elegido) || DEL_MUNDO[b.k].length - DEL_MUNDO[a.k].length; }).forEach(function (p) {
        p.aro.scale.set(s, s, s);
        w2.copy(p.pos).applyMatrix4(grupo.matrixWorld);
        var frente = w2.clone().normalize().dot(cam) > 0.18, pr = w2.clone().project(camara), x = (pr.x * 0.5 + 0.5) * w, y = (-pr.y * 0.5 + 0.5) * h;
        if (!p.ancho) p.ancho = p.boton.offsetWidth;
        var izq = x > w * 0.62, caja = { x: izq ? x - p.ancho + 11 : x - 11, y: y - 13, w: p.ancho, h: 26 };
        var choca = frente && puestos.some(function (o) { return caja.x < o.x + o.w && caja.x + caja.w > o.x && caja.y < o.y + o.h && caja.y + caja.h > o.y; });
        if (frente && !choca) puestos.push(caja);
        p.boton.classList.toggle('punto', choca); p.boton.classList.toggle('izq', izq);
        p.boton.style.transform = choca ? 'translate(' + (x - 10.5) + 'px,' + (y - 10.5) + 'px)' : 'translate(' + caja.x + 'px,' + caja.y + 'px)';
        p.boton.style.opacity = frente ? '1' : '0'; p.boton.style.pointerEvents = frente ? 'auto' : 'none';
      });
      renderer.render(escena, camara);
    }
    requestAnimationFrame(cuadro);
    window.addEventListener('resize', function () { g.ajustar(); });
    return g;
  }
  function ver(f) { S.f = f; S.vista = 'lista'; S.q = ''; S.limite = 20; S.menu = false; pintar(true); }
  function refrescar(id) { document.querySelectorAll('[data-acc="' + id + '"]').forEach(function (el) { el.innerHTML = boton(POR_ID[id]); }); var y = window.scrollY; pintar(false); window.scrollTo(0, y); }

  var A = {
    inicio: function () { S.vista = 'inicio'; S.f = null; S.q = ''; S.limite = 20; pintar(true); },
    'abrir-menu': function () { S.menu = true; S.menuMarca = (S.f && S.f.marca) || null; pintar(false); },
    'cerrar-menu': function () { S.menu = false; S.menuQ = ''; pintar(false); },
    'menu-marca': function (d) { S.menuMarca = S.menuMarca === d.x ? null : d.x; pintar(false); },
    'ver-todo': function () { ver({ titulo: 'Todos los productos' }); },
    'ver-marca': function (d) { ver({ marca: d.m, titulo: d.m }); },
    'ver-sub': function (d) { ver({ marca: d.m, sub: d.s, titulo: d.s }); },
    nuevos: function () { ver({ nuevos: true, titulo: 'Nuevos esta semana' }); },
    mundo: function () { ver({ mundo: true, titulo: 'Productos del mundo' }); },
    lugar: function (d) { var f = S.f; f.lugar = d.k && f.lugar !== d.k ? d.k : null; f.titulo = 'Productos del mundo'; S.limite = 20; pintar(false); if (G) G.marcar(f.lugar); },
    desc: function () { S.descAbierta = !S.descAbierta; pintar(false); },
    objetivos: function () { var o = D.objetivos.filter(function (x) { return PROD.some(function (p) { return (p.ob || []).indexOf(x) >= 0; }); })[0]; ver({ objetivos: true, obj: o, titulo: o || 'Por objetivo' }); },
    obj: function (d) { var f = S.f; f.obj = d.o; f.titulo = d.o; S.limite = 20; pintar(false); },
    'obj-directo': function (d) { ver({ objetivos: true, obj: d.o, titulo: d.o }); },
    pros: function () { S.vista = 'pros'; S.f = null; S.q = ''; pintar(true); },
    cuenta: function () { aviso('Muy pronto: tu cuenta WiiGo Club con tus compras y puntos'); },
    sabor: function (d) { sabor[d.id] = d.x; refrescar(d.id); },
    sumar: function (d) { var p = POR_ID[d.id]; sumar(d.id, saborDe(p), 1); refrescar(d.id); },
    restar: function (d) { var p = POR_ID[d.id]; sumar(d.id, saborDe(p), -1); refrescar(d.id); },
    ficha: function (d) { S.ficha = d.id; S.descAbierta = false; pintar(false); },
    'cerrar-ficha': function () { S.ficha = null; pintar(false); },
    'abrir-pedido': function () { S.pedido = true; S.ficha = null; pintar(false); },
    'cerrar-pedido': function () { S.pedido = false; pintar(false); },
    'p-sumar': function (d) { sumar(d.id, d.v || null, 1); pintar(false); },
    'p-restar': function (d) { sumar(d.id, d.v || null, -1); pintar(false); },
    limpiar: function () { S.q = ''; pintar(false); var i = document.getElementById('q'); if (i) i.focus(); },
    mas: function () { S.limite += 20; pintar(false); }
  };
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-a]'); if (!el || el.tagName === 'INPUT') return; var a = A[el.getAttribute('data-a')]; if (a) { e.preventDefault(); a(el.dataset); } });
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') { S.q = e.target.value; S.limite = 20; if (S.q.length < 2 && S.vista !== 'lista') S.vista = S.vista === 'pros' ? 'pros' : 'inicio'; pintar(false); }
    if (e.target.id === 'mq') { S.menuQ = e.target.value; pintar(false); }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'q') e.target.blur();
    if (e.key === 'Escape') { S.menu = false; S.ficha = null; S.pedido = false; pintar(false); }
  });
  pintar(false);
})();
