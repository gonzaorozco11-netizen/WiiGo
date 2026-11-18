/* WiiGo · Estaciones de Bienestar — la tienda online (app.wiigo.com.ar/tienda).
   Diseño aprobado por Gonzalo el 2026-11-14: el formato práctico de Alifrut (buscador, accesos, productos
   de a dos con «Agregar», marcas → rubros en el menú ☰) con los colores de la pantalla asesora, kcal en
   cada producto, el planeta en «Del mundo» y arriba la persona cargando energía.
   El catálogo viene de /api/tienda/catalogo (lib/tiendaCatalogo.ts), con el stock real del local.
   Etapa 2: la cuenta WiiGo Club (DNI + código por mail) y la compra: retiro en la estación, pago por
   transferencia o al retirar, y el seguimiento del pedido con la escena del local (/api/tienda/pedido).
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
    canasta: '<path d="M3 10h18l-2 9H5z"/><path d="m8 10 3-6M16 10l-3-6"/>',
    compartir: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m8.6 13.5 6.8 4M15.4 6.5l-6.8 4"/>',
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
  var ILUS_CARGA = '<svg viewBox="0 0 152 160" role="img" aria-label="Una persona cargando energía en una estación WiiGo">' +
    '<ellipse cx="74" cy="152" rx="62" ry="5" fill="rgba(0,0,0,.25)"/>' +
    // la estación (clara, sobre el cartel verde oscuro)
    // Colores del local (18/11): surtidor blanco, pantalla gris oscuro, madera clara.
    '<rect x="4" y="46" width="38" height="102" rx="10" fill="#ffffff"/><rect x="10" y="56" width="26" height="22" rx="5" fill="#2d2d2d"/>' +
    '<path class="rayo-pantalla" d="M25 59l-6 9h5l-3 7 7-10h-5l2-6z" fill="#f1c75b"/>' +
    '<text x="23" y="100" text-anchor="middle" font-family="Bricolage Grotesque,sans-serif" font-weight="800" font-size="11" fill="#2d2d2d">WiiGo</text>' +
    '<rect x="10" y="108" width="26" height="4" rx="2" fill="#8d9880"/><rect x="10" y="116" width="18" height="4" rx="2" fill="#e6d8c0"/>' +
    '<rect x="41" y="80" width="7" height="14" rx="3" fill="#e6d8c0"/><rect x="0" y="144" width="46" height="7" rx="3.5" fill="#e6d8c0"/>' +
    // el cable con energía que corre
    '<path d="M47 87C66 86 58 122 78 100" fill="none" stroke="#2d2d2d" stroke-width="5" stroke-linecap="round"/>' +
    '<path class="flujo" d="M47 87C66 86 58 122 78 100" fill="none" stroke="#f1c75b" stroke-width="2.6" stroke-linecap="round"/>' +
    // la persona: cuando la batería se llena, salta y saca músculo con el brazo libre (Gonzalo, 16/11)
    '<g class="persona">' +
    '<rect x="95" y="118" width="9" height="30" rx="4.5" fill="#e6d8c0"/><rect x="107" y="118" width="9" height="30" rx="4.5" fill="#e6d8c0"/>' +
    '<rect x="88" y="62" width="34" height="62" rx="15" fill="#2d2d2d"/>' +
    '<path d="M92 72L79 97" stroke="#2d2d2d" stroke-width="9" stroke-linecap="round"/><circle cx="78" cy="99" r="5.5" fill="#d9a37f"/>' +
    '<g class="brazo-normal"><path d="M118 72l6 22" stroke="#2d2d2d" stroke-width="9" stroke-linecap="round"/><circle cx="124.5" cy="96" r="5" fill="#d9a37f"/></g>' +
    '<g class="brazo-fuerza"><path d="M118 72L133 70" stroke="#2d2d2d" stroke-width="9" stroke-linecap="round"/><path d="M133 70L136 54" stroke="#2d2d2d" stroke-width="8.5" stroke-linecap="round"/>' +
    '<g class="biceps"><ellipse cx="126" cy="65" rx="7" ry="6" fill="#2d2d2d"/><path d="M121.5 63q4.5-4 9 0" fill="none" stroke="#6a6a6a" stroke-width="1.8" stroke-linecap="round"/></g><circle cx="136.5" cy="50.5" r="5.5" fill="#d9a37f"/>' +
    '<path class="fuerza" d="M130 44l-3-4M137 41v-5M143 45l3-4" stroke="#f1c75b" stroke-width="2.4" stroke-linecap="round"/></g>' +
    '<circle cx="105" cy="45" r="14" fill="#d9a37f"/><path d="M91 44c0-10 6-16 14-16s14 6 14 15c-4-6-9-8-14-8s-10 3-14 9z" fill="#3a2010"/>' +
    '<circle cx="100" cy="46" r="1.6" fill="#3a2010"/><circle cx="110" cy="46" r="1.6" fill="#3a2010"/><path d="M100 51q5 4 10 0" fill="none" stroke="#3a2010" stroke-width="1.6" stroke-linecap="round"/>' +
    // la batería en el pecho
    '<rect x="101" y="72" width="7" height="3" rx="1" fill="#fffaf2"/><rect x="96" y="75" width="17" height="32" rx="4" fill="rgba(0,0,0,.2)" stroke="#fffaf2" stroke-width="2"/>' +
    '<rect class="nivel" x="99" y="78" width="11" height="26" rx="2" fill="#f1c75b"/><path d="M106 81l-5 9h4l-2 8 6-10h-4l2-7z" fill="#fffaf2"/>' +
    '</g>' +
    // chispas de energía cuando se llena
    '<path class="chispa" d="M88 30l-5-5" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/><path class="chispa b" d="M105 24v-7" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/><path class="chispa c" d="M122 30l5-5" stroke="#f1c75b" stroke-width="3" stroke-linecap="round"/>' +
    '</svg>';
  // Banner 2: el pedido en 4 pasos, con la barra que corre hasta los 15 minutos.
  var PASOS_15 = [
    ['Pedís', '<rect x="7" y="2" width="10" height="20" rx="2.5"/><path d="M11 18h2"/>'],
    ['Pagás', '<rect x="2" y="5" width="20" height="14" rx="2.5"/><path d="M2 10h20M6 15h4"/>'],
    ['Lo armamos', '<path d="M5 8h14l-1.2 11.2a2 2 0 0 1-2 1.8H8.2a2 2 0 0 1-2-1.8L5 8z"/><path d="M9 11V7a3 3 0 0 1 6 0v4"/>'],
    ['Retirás', '<path d="M5 12.5l4.5 4.5L19 7.5"/>']
  ];
  // Cada paso con el minuto en que pasa: el cronómetro corre hasta ese minuto cuando se prende.
  var MIN_15 = [0, 30, 60, 660, 870]; // segundos: arranque, pedís, pagás, lo armamos, retirás (14:30)
  var BANNER_15 = '<div class="b-crono" aria-hidden="true"><b id="b-tiempo">00:00</b><small>minutos</small></div>' +
    '<div class="b-pasos" aria-hidden="true"><div class="b-linea"><i></i></div>' + PASOS_15.map(function (p, i) {
      return '<span class="b-paso"><span class="b-ic"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">' + p[1] + '</svg></span><small>' + p[0] + '</small><em>' + Math.floor(MIN_15[i + 1] / 60) + '′</em></span>';
    }).join('') + '</div>';
  // Banner 3: la tarjeta del Club, inclinada, con un brillo que pasa y puntos que saltan.
  var TARJETA_CLUB = '<div class="b-tarjeta" aria-hidden="true"><div class="tc"><span class="tc-logo">WiiGo</span><span class="tc-estrella">★</span><b>Club</b><small>Socio · puntos</small><i class="tc-brillo"></i></div>' +
    '<span class="burbuja" style="--i:0;--x:-6px">+20</span><span class="burbuja" style="--i:1;--x:44px">+5</span><span class="burbuja" style="--i:2;--x:70px">+20</span>' +
    '<span class="chispa-c" style="--i:0;left:4px;top:8px">✦</span><span class="chispa-c" style="--i:1;right:2px;top:2px">✦</span><span class="chispa-c" style="--i:2;right:16px;bottom:6px">✦</span></div>';
  function banners() {
    // Compactos y sin botones: se toca el banner entero.
    var b = [
      '<div class="banner carga" data-a="ver-todo" role="button" tabindex="0"><div><h1 class="hola">La estación de servicio de <em>tu cuerpo</em>.</h1><p class="hola-sub">Cargá energía: pedí online y retiralo listo en 15 minutos.</p></div>' + ILUS_CARGA + '</div>',
      '<div class="banner b-15" data-a="ver-todo" role="button" tabindex="0"><div><h2 class="hola">Pedí y retirá en <em>15 minutos</em>.</h2>' + BANNER_15 + '</div></div>',
      '<div class="banner b-club" data-a="cuenta" role="button" tabindex="0"><div><h2 class="hola">Unite a <em>WiiGo Club</em>.</h2><p class="hola-sub">Sumá puntos en cada compra, online o en la estación.</p><span class="b-chip">' + (S.usuario ? '★ Tenés ' + S.usuario.puntos.toLocaleString('es-AR') + ' puntos' : 'Gratis · con tu DNI') + '</span></div>' + TARJETA_CLUB + '</div>'
    ];
    return '<section class="banners" aria-roledescription="carrusel" aria-label="Novedades de WiiGo"><div class="b-pista" id="b-pista">' + b.join('') + '</div><div class="b-puntos">' + b.map(function (_, i) { return '<button data-a="banner" data-i="' + i + '" aria-label="Banner ' + (i + 1) + '"' + (i === 0 ? ' aria-current="true"' : '') + '></button>'; }).join('') + '</div></section>';
  }
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
  // La porción recomendada en gramos, de la ficha: «30 g (un puñado)» → 30. Sin gramos, null.
  function gramosPorcion(p) { var m = /(\d+(?:[.,]\d+)?)\s*(g|gr|grs|gramos|ml|cc)\b/i.exec(p.po || ''); var g = m ? Number(m[1].replace(',', '.')) : 0; return g > 0 && g <= 1000 ? g : null; }
  // Los valores de la ficha son cada 100 g: se pasan a la porción.
  function nutriPorcion(p) {
    var g = gramosPorcion(p), f = g ? g / 100 : 1, x = function (v) { return v == null ? null : Number(v) * f; };
    // Porción sin gramos («1 vianda»): los números de la ficha ya son por esa porción (Gonzalo, 14/11, viandas de Alta).
    var unidad = !g && p.po && p.po.trim() ? p.po.trim().replace(/^1\s+/, '') : null;
    return { g: g, unidad: unidad, txt: g ? 'por porción (' + coma(g) + ' g)' : unidad ? 'por ' + unidad : 'cada 100 g', k: x(p.k), pr: x(p.pr), ca: x(p.ca), gr: x(p.gr), fi: x(p.fi) };
  }
  function nutriChica(p) {
    if (!tieneNutri(p)) return '';
    var n = nutriPorcion(p), m = function (l, v) { return v == null ? '' : '<span>' + l + ' ' + coma(v) + '</span>'; };
    return '<div class="t-nutri" title="' + n.txt + '">' + (n.k != null ? '<span class="kcal">' + Math.round(n.k) + ' kcal</span>' : '') + m('P', n.pr) + m('C', n.ca) + m('G', n.gr) + '<span class="por">' + (n.g ? 'porción ' + coma(n.g) + ' g' : n.unidad ? 'por ' + esc(n.unidad) : 'c/100 g') + '</span></div>';
  }
  // Cómo se lee la marca propia: «WiiGo Dietética» (Gonzalo, 16/11; el dato sigue siendo «WiiGo»).
  function nombreMarca(n) { return n === 'WiiGo' ? 'WiiGo Dietética' : n; }
  // El orden de las marcas y su rubro chiquito abajo del nombre (Gonzalo, 16/11). Una marca nueva va al final.
  var ORDEN_MARCAS = ['WiiGo', 'Animalfit', 'Alta', 'Crislo', 'Fruppi'];
  var RUBRO_MARCA = { WiiGo: 'Dietética', Animalfit: 'Suplementos', Alta: 'Viandas', Crislo: 'Cosmética', Fruppi: 'Snacks' };
  var lugarMarca = function (n) { var i = ORDEN_MARCAS.indexOf(n); return i < 0 ? 99 : i; };
  var MARCAS = D.marcas.slice().sort(function (a, b) { return lugarMarca(a.n) - lugarMarca(b.n) || (b.cant || 0) - (a.cant || 0); }), MARCA = {}; MARCAS.forEach(function (m) { MARCA[m.n] = m; });
  // Nuevos: los 20 que entraron último (con stock), no todo lo del mes.
  var NUEVOS = PROD.filter(function (p) { return p.s > 0 && p.dias <= 30; }).sort(function (a, b) { return a.dias - b.dias; }).slice(0, 20);
  // Ofertas: lo que hoy tiene descuento y hay stock (el descuento viene del catálogo, `dto`).
  var OFERTAS = PROD.filter(function (p) { return p.s > 0 && Number(p.dto) > 0; }).sort(function (a, b) { return Number(b.dto) - Number(a.dto); });
  function ordenar(l) { return l.slice().sort(function (a, b) { return (b.s > 0) - (a.s > 0) || (b.img ? 1 : 0) - (a.img ? 1 : 0) || a.t.localeCompare(b.t, 'es'); }); }

  /* estado */
  var S = { vista: 'inicio', f: null, q: '', limite: 20, menu: false, menuMarca: null, menuQ: '', ficha: null, pedido: false, cuenta: false, paso: 'dni', datos: {}, usuario: null, enviando: false, compraAbierta: null };
  // Puntos WiiGo Club: 5 cada $1.000 en todo, el 0,5 % (Gonzalo, 16/11; antes 20 en productos WiiGo).
  // Tiene que coincidir con PUNTOS_OTORGADOS y PUNTOS_OTORGADOS_PROPIOS de Configuración (lib/puntosWiigo.ts).
  function puntosDe(p, importe) { return Math.floor(5 * importe / 1000); }
  // La cuenta habla con /api/tienda/cuenta (app/api/tienda/cuenta/route.ts). La sesión es una cookie que la página no ve.
  function api(cuerpo) {
    return fetch('/api/tienda/cuenta', cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), credentials: 'same-origin' } : { credentials: 'same-origin' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok && !j.error) j.error = 'Algo falló. Probá de nuevo en un momento.'; return j; }); })
      .catch(function () { return { error: 'Sin conexión. Revisá internet y probá de nuevo.' }; });
  }
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
  /* ---------- Combos (Gonzalo, 16/11) ----------
     Un combo no es un producto: si en el pedido están sus productos, el precio baja solo.
     Es la misma cuenta que lib/combos.ts (aplicarCombos): si se cambia allá, cambiarla acá.
     El servidor la vuelve a hacer al guardar el pedido (/api/tienda/pedido). */
  var COMBOS = (D.combos || []).filter(function (c) { return c && c.g && c.g.length && c.p > 0; });
  var POR_COMBO = {}; COMBOS.forEach(function (c) { POR_COMBO[c.id] = c; });
  function precioCombo(c, modo) { return modo === 'EFECTIVO' && c.e > 0 ? c.e : c.p; }
  function aplicarCombos(modo) {
    var lineas = carrito.map(function (l) { var p = POR_ID[l.id]; return { clave: l.id + '|' + (l.v || ''), id: l.id, q: l.q, precio: modo === 'EFECTIVO' ? (p.e || p.p) : p.p }; });
    var libres = {}; lineas.forEach(function (l) { libres[l.clave] = (libres[l.clave] || 0) + l.q; });
    // Una vez de un combo con lo que queda suelto: { prueba, d } o null si no entra.
    function unaVez(c) {
      var prueba = {}, k; for (k in libres) prueba[k] = libres[k];
      var elegidas = [];
      for (var gi = 0; gi < c.g.length; gi++) {
        var g = c.g[gi], faltan = g.q;
        for (var li = 0; li < lineas.length && faltan > 0; li++) {
          var l = lineas[li]; if (g.ids.indexOf(l.id) < 0) continue;
          var toma = Math.min(prueba[l.clave] || 0, faltan); if (toma <= 0) continue;
          prueba[l.clave] -= toma; faltan -= toma; for (var u = 0; u < toma; u++) elegidas.push(l);
        }
        if (faltan > 0) return null;
      }
      var suma = elegidas.reduce(function (t, l) { return t + l.precio; }, 0), d = suma - precioCombo(c, modo);
      return d > 0 ? { prueba: prueba, d: d } : null;
    }
    // Cada vez, el combo que más le ahorra con lo que queda (igual que lib/combos.ts).
    var por = {}, total = 0;
    for (var vuelta = 0; vuelta < 100; vuelta++) {
      var mejor = null;
      COMBOS.forEach(function (c) { var r = unaVez(c); if (r && (!mejor || r.d > mejor.r.d)) mejor = { c: c, r: r }; });
      if (!mejor) break;
      libres = mejor.r.prueba; total += mejor.r.d;
      var a = por[mejor.c.id] || (por[mejor.c.id] = { c: mejor.c, veces: 0, d: 0 }); a.veces++; a.d += mejor.r.d;
    }
    return { aplicados: COMBOS.map(function (c) { return por[c.id]; }).filter(Boolean), d: total };
  }
  function totales() {
    var t = { u: 0, g: 0, e: 0, p: 0 };
    carrito.forEach(function (l) { var p = POR_ID[l.id]; t.u += l.q; t.g += p.p * l.q; t.e += (p.e || p.p) * l.q; });
    var cl = aplicarCombos('LISTA'), ce = aplicarCombos('EFECTIVO');
    t.g -= cl.d; t.e -= ce.d; t.combos = cl.aplicados; t.combosE = ce.aplicados;
    t.p = Math.floor(5 * t.g / 1000); // 5 puntos cada $1.000 (como puntosDe)
    return t;
  }
  // Las líneas «🎁 Combo …» del pedido (con el descuento con tarjeta o transferencia).
  function filasCombos(t, estilo) {
    return (t.combos || []).map(function (a) { return '<div class="total combo-ok"' + (estilo || '') + '><span>🎁 Combo ' + esc(a.c.n) + (a.veces > 1 ? ' ×' + a.veces : '') + '</span><b>−' + plata(a.d) + '</b></div>'; }).join('');
  }
  function aviso(t) { var d = document.createElement('div'); d.className = 'aviso'; d.setAttribute('role', 'status'); d.textContent = t; document.body.appendChild(d); setTimeout(function () { d.remove(); }, 1800); }

  /* la tarjeta, de a dos, como Alifrut */
  // Sin el optimizador de Vercel (2026-11-14): cada foto achicada cuenta para el tope del plan, y el
  // proyecto quedó pausado. Las fotos ya vienen a 1000 px y hasta 150 KB; el navegador las achica solo.
  function chica(url) { return url; }
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
      precioTarjeta(p) + '<div data-acc="' + p.id + '">' + boton(p) + '</div></div></article>';
  }
  // Sin stock se muestra el producto, pero sin precio (Gonzalo, 2026-11-14).
  function precioTarjeta(p) { return p.s > 0 ? '<div class="t-precio"><b>' + plata(p.p) + '</b><span>' + plata(p.e || p.p) + ' efectivo</span></div>' : '<div class="t-precio"><span style="color:var(--gris)">Sin stock por ahora</span></div>'; }
  // Formato de app de delivery (Gonzalo, 16/11, maqueta aprobada): texto a la izquierda y la foto a la
  // derecha con el «+» encima, que pasa a «− cantidad +». Con sabores, el «+» abre la ficha para elegirlo.
  function cuantosDe(p) { return carrito.filter(function (l) { return l.id === p.id; }).reduce(function (a, l) { return a + l.q; }, 0); }
  function botonItem(p) {
    if (p.s <= 0) return '';
    if (p.v && p.v.length) {
      var t = cuantosDe(p);
      return '<button class="it-mas' + (t ? ' con' : '') + '" data-a="ficha" data-id="' + p.id + '" aria-label="Elegir sabor de ' + esc(p.t) + '">' + (t || '+') + '</button>';
    }
    var n = enCarrito(p.id, null);
    if (!n) return '<button class="it-mas" data-a="sumar" data-id="' + p.id + '" aria-label="Agregar ' + esc(p.t) + '">+</button>';
    return '<div class="it-paso"><button data-a="restar" data-id="' + p.id + '" aria-label="Uno menos">−</button><span>' + n + '</span><button data-a="sumar" data-id="' + p.id + '" aria-label="Uno más">+</button></div>';
  }
  function kcalItem(p) {
    if (!tieneNutri(p)) return '';
    var n = nutriPorcion(p);
    return '<span class="it-kcal">' + (n.k != null ? Math.round(n.k) + ' kcal' : '') + (n.pr ? ' · ' + coma(n.pr) + ' g prot' : '') + ' ' + (n.g || n.unidad ? 'por porción' : 'c/100 g') + '</span>';
  }
  // El nombre sin la marca de fábrica repetida al final: «Iso Gold Protein 2lbs - Gold Nutrition» → la
  // marca va abajo, en gris (18/11). Solo Animalfit, que revende varias marcas y las escribe así (Star
  // Nutrition, Gold Nutrition, Granger…); en WiiGo «Fideos De Arroz - Spaghetti» es el tipo, no la marca.
  function partirNombre(p) {
    var m = p.m === 'Animalfit' ? /^(.*\S)\s+-\s+([A-Za-zÀ-ÿ&'.]+(?:\s+[A-Za-zÀ-ÿ&'.]+){0,2})(\s+—\s+.*)?$/.exec(p.t) : null;
    return m ? { nom: m[1] + (m[3] || ''), mar: m[2] } : { nom: p.t, mar: nombreMarca(p.mf || p.m) };
  }
  // Renglón corto (Gonzalo, 18/11, maqueta aprobada): foto chica, nombre, marca, los dos precios y el «+».
  // La descripción y las calorías se ven al tocarlo, en la ficha.
  function item(p) {
    var sin = p.s <= 0, nm = partirNombre(p);
    return '<article class="item' + (sin ? ' sin' : '') + '"><button class="it-foto" data-a="ficha" data-id="' + p.id + '" aria-label="Ver ' + esc(p.t) + '">' + foto(p, 128) + '</button>' +
      '<button class="it-tx" data-a="ficha" data-id="' + p.id + '">' +
      '<span class="it-nom">' + esc(nm.nom) + '</span><span class="it-mar">' + esc(nm.mar) + '</span>' +
      // Las estrellas de los clientes (18/11), si tiene opiniones.
      (p.rc ? '<span class="it-est">' + estrellas(p.r) + ' ' + coma(p.r) + ' <small>(' + p.rc + ')</small></span>' : '') +
      (sin ? '<span class="it-sin">Sin stock por ahora</span>' : '<span class="it-pr"><b>' + plata(p.p) + '</b><span>' + plata(p.e || p.p) + ' efectivo</span></span>' + (p.s <= 2 ? '<span class="it-poco">Últimas ' + p.s + '</span>' : '')) +
      '</button><div class="it-acc" data-acc="' + p.id + '" data-tipo="item">' + botonItem(p) + '</div></article>';
  }
  void kcalItem;
  function grilla(l) { return '<div class="items">' + l.map(item).join('') + '</div>'; }
  function conMas(l) { return grilla(l.slice(0, S.limite)) + (l.length > S.limite ? '<button class="ver-mas" data-a="mas">Ver más productos (' + (l.length - S.limite) + ')</button>' : ''); }

  /* qué productos mostrar */
  function filtrados() {
    var f = S.f || {}, l = PROD;
    if (f.marca) l = l.filter(function (p) { return p.m === f.marca; });
    if (f.sub) l = l.filter(function (p) { return p.sc === f.sub; });
    if (f.cat) l = l.filter(function (p) { return p.c === f.cat; });
    if (f.nuevos) l = NUEVOS;
    if (f.ofertas) l = OFERTAS;
    if (f.obj) l = l.filter(function (p) { return (p.ob || []).indexOf(f.obj) >= 0; });
    if (f.lugar) l = l.filter(function (p) { return p.lugar === f.lugar; });
    else if (f.mundo) l = l.filter(function (p) { return p.lugar; });
    if (S.q.length >= 2) {
      var ws = norm(S.q).split(' ').filter(Boolean);
      // En TODOS los productos, aunque haya marca, rubro u objetivo elegido.
      return PROD.filter(function (p) { return ws.every(function (w) { return p.busca.indexOf(w) >= 0 || (w.length > 3 && p.busca.indexOf(w.slice(0, -1)) >= 0); }); })
        .sort(function (a, b) { var w = norm(S.q); return (norm(b.n).indexOf(w) === 0) - (norm(a.n).indexOf(w) === 0) || (b.s > 0) - (a.s > 0) || a.t.localeCompare(b.t, 'es'); });
    }
    return f.nuevos ? l.slice().sort(function (a, b) { return a.dias - b.dias; }) : ordenar(l);
  }

  /* pantallas */
  // Los rubros (las macro categorías del catálogo), en este orden y con su ícono.
  var RUBROS = [['Suplementación y rendimiento', 'Suplementos', '💪'], ['Snacks y dulces', 'Snacks', '🍫'], ['Frutos secos y semillas', 'Frutos secos', '🥜'], ['Almacén consciente', 'Almacén', '🫙'],
    ['Desayuno y cereales', 'Desayuno', '🥣'], ['Viandas saludables', 'Viandas', '🍱'], ['Bienestar natural', 'Bienestar', '🌿'], ['Cuidado personal', 'Cuidado', '🧴']];
  function rubrosDe(l) {
    var hay = {}; l.forEach(function (p) { hay[p.c] = (hay[p.c] || 0) + 1; });
    var r = RUBROS.filter(function (x) { return hay[x[0]]; });
    Object.keys(hay).forEach(function (c) { if (!RUBROS.some(function (x) { return x[0] === c; })) r.push([c, c, '🛍️']); });
    return r;
  }
  // Abierto o cerrado según el horario de la estación (lunes a sábado de 9 a 13 y de 17 a 21).
  function horario() {
    var d = new Date(), dia = d.getDay(), h = d.getHours() + d.getMinutes() / 60;
    if (dia === 0) return [false, 'abre el lunes a las 9'];
    if (h < 9) return [false, 'abre a las 9'];
    if (h < 13) return [true, 'hasta las 13'];
    if (h < 17) return [false, 'abre a las 17'];
    if (h < 21) return [true, 'hasta las 21'];
    return [false, dia === 6 ? 'abre el lunes a las 9' : 'abre mañana a las 9'];
  }
  function botonesAccesos(copia) {
    var extra = copia ? ' aria-hidden="true" tabindex="-1"' : '';
    var lista = [
      ['ir-sec" data-s="s-elegido', '⭐', 'Lo más elegido', ''],
      ['objetivos', '🎯', 'Objetivos', ''],
      ['mundo', '🌍', 'Del mundo', ''],
      ['pros', '👩‍💻', 'Profesionales', ''],
      ['combos', '🎁', 'Combos', COMBOS.length ? '<em>' + COMBOS.length + '</em>' : '<em class="pronto">Pronto</em>'],
      ['ofertas', '🏷️', 'Ofertas', OFERTAS.length ? '<em>' + OFERTAS.length + '</em>' : '']
    ];
    return lista.map(function (b, i) { return '<button data-a="' + b[0] + '"' + extra + (copia && i === 0 ? ' data-copia' : '') + '><span>' + b[1] + '</span>' + b[2] + b[3] + '</button>'; }).join('');
  }
  // Más limpia (Gonzalo, 18/11, maqueta aprobada): el local en una sola línea en vez de la tarjeta grande.
  // Cómo se paga y los puntos quedaron en el pie.
  function tarjetaLocal() {
    var hr = horario();
    return '<p class="local-linea"><b class="' + (hr[0] ? 'abierto' : 'cerrado') + '">● ' + (hr[0] ? 'Abierto' : 'Cerrado') + ' · ' + hr[1] + '</b><span>Retirás en 15 min</span><a class="dir-mapa" href="' + MAPA + '" target="_blank" rel="noopener"><u>Arístides 256</u></a></p>';
  }
  // «Para vos» (Gonzalo, 18/11, como «Relacionado con tus pedidos»): con la cuenta adentro, lo que más
  // compra (online y en la estación con su DNI) y lo que suele ir con eso: misma subcategoría, lo mejor
  // calificado y lo más vendido primero. Siempre dice por qué se lo mostramos.
  function tarjetaChica(p, abajo) {
    return '<article class="eleg"><div class="it-ft"><button class="it-foto" data-a="ficha" data-id="' + p.id + '" aria-label="Ver ' + esc(p.t) + '">' + foto(p, 256) + '</button><div class="it-acc" data-acc="' + p.id + '" data-tipo="item">' + botonItem(p) + '</div></div>' +
      '<button class="eleg-tx" data-a="ficha" data-id="' + p.id + '"><span>' + esc(partirNombre(p).nom) + '</span><b>' + plata(p.p) + '</b>' + (abajo ? '<small class="eleg-por">' + abajo + '</small>' : '') + '</button></article>';
  }
  function paraVos() {
    var u = S.usuario; if (!u || !u.compras || !u.compras.length) return '';
    var veces = {}, ultima = {}, deSub = {};
    u.compras.forEach(function (c) { productosDe(c).forEach(function (it) { veces[it.id] = (veces[it.id] || 0) + 1; if (!ultima[it.id]) ultima[it.id] = c.fecha; }); });
    Object.keys(veces).forEach(function (id) { var p = POR_ID[id]; if (p) deSub[p.sc] = (deSub[p.sc] || 0) + veces[id]; });
    var volver = Object.keys(veces).map(function (id) { return POR_ID[id]; }).filter(function (p) { return p && p.s > 0; })
      .sort(function (a, b) { return veces[b.id] - veces[a.id] || (ultima[b.id] > ultima[a.id] ? 1 : -1); }).slice(0, 10);
    var gustar = PROD.filter(function (p) { return p.s > 0 && !veces[p.id] && deSub[p.sc]; })
      .sort(function (a, b) { return deSub[b.sc] - deSub[a.sc] || (b.r || 0) - (a.r || 0) || (a.top || 999) - (b.top || 999); }).slice(0, 10);
    var subMas = Object.keys(deSub).sort(function (a, b) { return deSub[b] - deSub[a]; })[0];
    var fila = function (l, extra) { return '<div class="elegidos">' + l.map(function (p) { return tarjetaChica(p, extra(p)); }).join('') + '</div>'; };
    return (volver.length ? '<section class="rubro-sec" id="s-volver"><h2 class="seccion">Volver a pedir</h2><p class="rub-cant">Lo que más comprás, online y en la estación</p>' +
        fila(volver, function (p) { return veces[p.id] > 1 ? 'Lo compraste ' + veces[p.id] + ' veces' : 'Última vez: ' + esc(new Date(ultima[p.id]).toLocaleDateString('es-AR', { day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' })); }) + '</section>' : '') +
      (gustar.length ? '<section class="rubro-sec" id="s-gustar"><h2 class="seccion">Te puede gustar</h2><p class="rub-cant">Porque llevás ' + esc(String(subMas || '').toLowerCase()) + '</p>' +
        fila(gustar, function (p) { return p.rc ? estrellas(p.r) + ' (' + p.rc + ')' : ''; }) + '</section>' : '');
  }
  // Cuatro accesos redondos, quietos (18/11). «Lo más elegido» y «Ofertas» son secciones de la página.
  function accesos4() {
    var l = [['objetivos', '🎯', 'Objetivos', ''], ['mundo', '🌍', 'Del mundo', ''], ['combos', '🎁', 'Combos', COMBOS.length ? '<em>' + COMBOS.length + '</em>' : ''], ['pros', '👩‍💻', 'Profesionales', '']];
    return '<div class="accesos-4" role="group" aria-label="Accesos">' + l.map(function (b) { return '<button data-a="' + b[0] + '"><span>' + b[1] + b[3] + '</span>' + b[2] + '</button>'; }).join('') + '</div>';
  }
  // Formato de app de delivery (Gonzalo, 16/11): banners arriba, el local, los accesos de siempre, las pestañas
  // de rubros pegadas abajo del buscador, las marcas para filtrar, «Lo más elegido» y cada rubro con sus categorías.
  function inicio() {
    var l = S.marcaIni ? PROD.filter(function (p) { return p.m === S.marcaIni; }) : PROD;
    var porMarca = {}; PROD.forEach(function (p) { if (p.img && p.s > 0) (porMarca[p.m] = porMarca[p.m] || []).push(p); });
    // «Lo más elegido» (Gonzalo, 16/11): los más vendidos del último mes con stock, por puesto (`top`, del
    // catálogo). Si todavía hay pocas ventas, se completa con uno de cada marca, como antes.
    var dest = PROD.filter(function (p) { return p.top && p.s > 0; }).sort(function (a, b) { return a.top - b.top; }).slice(0, 10);
    var vuelta = 0; while (dest.length < 10 && vuelta < 12) { MARCAS.forEach(function (m) { var x = porMarca[m.n]; if (x && x[vuelta] && dest.length < 10 && dest.indexOf(x[vuelta]) < 0) dest.push(x[vuelta]); }); vuelta++; }
    var rub = rubrosDe(l);
    // Con una marca elegida, las pestañas y las secciones son TODAS sus subcategorías (Gonzalo, 16/11:
    // «toco WiiGo y no veo todas las subcategorías»). Sin marca, los rubros.
    var subsMarca = null;
    if (S.marcaIni) {
      var cuenta = {}; l.forEach(function (p) { (cuenta[p.sc] = cuenta[p.sc] || []).push(p); });
      subsMarca = Object.keys(cuenta).sort(function (a, b) { return a.localeCompare(b, 'es'); }).map(function (s) { return [s, cuenta[s]]; });
    }
    // Con una marca: arriba, pegadas, las categorías como pastillas con una fotito. Tocar una lleva hasta ella,
    // pero se puede seguir subiendo y bajando: la pastilla marcada cambia sola a la categoría que se está
    // mirando (Gonzalo, 16/11, «como a la siguiente subcategoría automático»).
    var fotoSub = function (ps) { var c = ps.filter(function (p) { return p.img && p.s > 0; })[0] || ps.filter(function (p) { return p.img; })[0]; return c ? imagen(c.img, 96) : ''; };
    // Sin rubros (Gonzalo, 18/11: «no los pongas si luego cuando ponen las marcas ahí figuran las
    // subcategorías»): las pestañas son solo las subcategorías de la marca elegida, con su fotito.
    var tabs = subsMarca ? '<nav class="tabs-rubros pastillas" id="tabs-rubros" aria-label="Categorías">' +
      subsMarca.map(function (s, i) { return '<button class="pastilla" data-a="ir-sec" data-s="s-s' + i + '">' + fotoSub(s[1]) + esc(s[0]) + ' <em>' + s[1].length + '</em></button>'; }).join('') + '</nav>' : '';
    var marcas = '<div class="marcas-ini" role="group" aria-label="Marcas"><button class="marca-p todo" data-a="marca-ini" data-m="" aria-pressed="' + !S.marcaIni + '">Todo</button>' + MARCAS.map(function (m) {
      return '<button class="marca-p" data-a="marca-ini" data-m="' + esc(m.n) + '" aria-pressed="' + (S.marcaIni === m.n) + '">' + (m.logo ? imagen(m.logo, 64) : '<i>' + esc(m.n.charAt(0)) + '</i>') + '<span class="mp-tx"><b>' + esc(m.n) + '</b>' + (RUBRO_MARCA[m.n] ? '<small>' + RUBRO_MARCA[m.n] + '</small>' : '') + '</span></button>';
    }).join('') + '</div>';
    var elegido = S.marcaIni ? '' : '<section class="rubro-sec" id="s-elegido"><h2 class="seccion">Lo más elegido</h2><div class="elegidos">' + dest.map(function (p) {
      return '<article class="eleg"><div class="it-ft"><button class="it-foto" data-a="ficha" data-id="' + p.id + '" aria-label="Ver ' + esc(p.t) + '">' + foto(p, 256) + '</button><div class="it-acc" data-acc="' + p.id + '" data-tipo="item">' + botonItem(p) + '</div></div>' +
        '<button class="eleg-tx" data-a="ficha" data-id="' + p.id + '"><span>' + esc(p.t) + '</span><b>' + plata(p.p) + '</b></button></article>';
    }).join('') + '</div><button class="ver-mas" data-a="nuevos">✨ Lo nuevo de la semana (' + NUEVOS.length + ')</button>' +
      (OFERTAS.length ? '<button class="ver-mas" data-a="ofertas">🏷️ Ofertas (' + OFERTAS.length + ')</button>' : '') + '</section>';
    var secciones = subsMarca ? subsMarca.map(function (s, i) {
      return '<section class="rubro-sec" id="s-s' + i + '"><h2 class="seccion">' + esc(s[0]) + '</h2><p class="rub-cant">' + s[1].length + (s[1].length === 1 ? ' producto' : ' productos') + ' de ' + esc(nombreMarca(S.marcaIni)) + '</p>' + grilla(ordenar(s[1])) + '</section>';
    }).join('') : MARCAS.map(function (m, i) {
      // Sin marca elegida: cada marca con 4 productos y «Ver todo», que la elige (18/11). Antes eran
      // todos los productos uno abajo del otro, por rubro: la página era larguísima.
      var deM = ordenar(PROD.filter(function (p) { return p.m === m.n; }));
      if (!deM.length) return '';
      return '<section class="rubro-sec" id="s-m' + i + '"><div class="sec-cab"><h2 class="seccion">' + esc(nombreMarca(m.n)) + '</h2><button data-a="marca-ini" data-m="' + esc(m.n) + '">Ver todo (' + deM.length + ') ›</button></div>' + grilla(deM.slice(0, 4)) + '</section>';
    }).join('');
    void rub;
    // Más limpia (18/11): el banner, el local en una línea y 4 accesos; abajo, pegadas al bajar, las marcas
    // y —con una marca elegida— sus subcategorías.
    return '<div class="ini-top">' + banners() + '</div>' + tarjetaLocal() + accesos4() +
      '<div class="pegado-ini" id="pegado-ini">' + marcas + tabs + '</div>' + (S.marcaIni ? '' : paraVos()) + elegido + secciones + pie();
  }
  function lista() {
    var f = S.f || {}, l = filtrados(), extra = '';
    if (f.mundo) {
      var total = CLAVES_MUNDO.reduce(function (a, k) { return a + DEL_MUNDO[k].length; }, 0);
      extra = '<div class="mundo"><div class="globo" id="globo"></div><div class="mundo-txt"><b>' + (f.lugar ? 'Desde ' + esc(LUGARES[f.lugar].n) : 'De cada rincón, a tu estación') + '</b><span>' + (f.lugar ? DEL_MUNDO[f.lugar].length + ' productos · tocá otro lugar en el planeta' : total + ' productos con su origen en ' + CLAVES_MUNDO.length + ' lugares · girá el planeta y tocá uno') + '</span></div></div>' +
        '<div class="accesos" style="margin:0 -14px 12px"><button class="acceso" data-a="lugar" data-k="" aria-pressed="' + !f.lugar + '">Todos</button>' + CLAVES_MUNDO.map(function (k) { return '<button class="acceso" data-a="lugar" data-k="' + k + '" aria-pressed="' + (f.lugar === k) + '">' + esc(LUGARES[k].n) + ' · ' + DEL_MUNDO[k].length + '</button>'; }).join('') + '</div>';
    }
    if (f.objetivos) extra = '<div class="accesos tonos" style="margin:0 -14px 12px">' + D.objetivos.map(function (o, i) { var n = PROD.filter(function (p) { return (p.ob || []).indexOf(o) >= 0; }).length, t = TONOS[i % TONOS.length]; return n ? '<button class="acceso" data-a="obj" data-o="' + esc(o) + '" aria-pressed="' + (f.obj === o) + '" style="background:' + t[0] + ';color:' + t[1] + (f.obj === o ? ';box-shadow:0 0 0 3px var(--fondo),0 0 0 5px ' + t[0] : ';opacity:.82') + '">' + esc(o) + ' · ' + n + '</button>' : ''; }).join('') + '</div>';
    if (S.q.length >= 2) extra = '';
    // Objetivos sin elegir: los botones de cada uno, con sus colores (como la pantalla asesora).
    if (f.objetivos && !f.obj && S.q.length < 2) {
      return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>¿Cuál es tu objetivo?</b><small>Elegí uno y te mostramos lo que mejor te queda</small></span></div><div class="objetivos">' +
        D.objetivos.map(function (o, i) { var n = PROD.filter(function (p) { return (p.ob || []).indexOf(o) >= 0; }).length, t = TONOS[i % TONOS.length]; return n ? '<button class="objetivo" data-a="obj" data-o="' + esc(o) + '" style="background:' + t[0] + ';color:' + t[1] + '"><b>' + esc(o) + '</b><span>' + n + (n === 1 ? ' producto' : ' productos') + '</span></button>' : ''; }).join('') + '</div>';
    }
    var tit = S.q.length >= 2 ? 'Resultados para «' + esc(S.q) + '»' : esc(f.titulo || 'Productos');
    return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>' + tit + '</b><small>' + l.length + (l.length === 1 ? ' producto' : ' productos') + (f.sub && S.q.length < 2 ? ' · ' + esc(f.marca) : '') + '</small></span></div>' + extra +
      (l.length ? conMas(l) : '<div class="vacio"><b>No encontramos eso</b><p>Probá con otra palabra o volvé al inicio y mirá por rubro o por marca.</p></div>');
  }
  function profesionales() {
    return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>Profesionales</b><small>Nutricionistas que trabajan con WiiGo</small></span></div><div style="display:grid;gap:10px">' +
      D.profesionales.map(function (p) { return '<div class="tarjeta" style="flex-direction:row;gap:14px;padding:12px;align-items:center">' + (p.foto ? imagen(p.foto, 256, ' style="width:84px;height:100px;object-fit:cover;border-radius:14px"') : '') + '<span><b style="font:800 18px/1.1 var(--display)">' + esc(p.n) + '</b><small style="display:block;color:var(--gris);margin:4px 0 8px">' + esc(p.t) + '</small>' + (p.ob ? '<button class="acceso" data-a="obj-directo" data-o="' + esc(p.ob) + '">Productos para ' + esc(p.ob.toLowerCase()) + '</button>' : '') + '</span></div>'; }).join('') + '</div>';
  }
  function pie() { return '<footer class="pie"><img src="/wiigo-logo-negro.png" alt="WiiGo"><a class="dir-mapa" href="' + MAPA + '" target="_blank" rel="noopener"><b>Estación Arístides Villanueva 256</b>, Mendoza · <u>Cómo llegar</u></a><span>Lunes a sábado de 9 a 13 y de 17 a 21</span><span>Retiro en la estación, listo en menos de 15 minutos · Envío a domicilio: próximamente</span><span>Pagás al retirar o por transferencia · Precio especial en efectivo · Sumás puntos WiiGo Club</span>' + redesPie() +
      // Gonzalo (16/11): que no se vea la sociedad. La ley de comercio electrónico pide que estén razón social,
      // CUIT y el link de Defensa del Consumidor, así que quedan guardados en «Información legal», que se abre al tocar.
      '<details class="legal"><summary>Información legal</summary><span>NUOVO IMPERO S.A.S. · CUIT 30-71851497-1 · Arístides Villanueva 256, Mendoza</span>' +
      '<a href="https://www.argentina.gob.ar/produccion/defensadelconsumidor/formulario" target="_blank" rel="noopener">Defensa de las y los consumidores: para reclamos ingresá acá</a></details></footer>'; }
  // Redes de WiiGo en el pie (Gonzalo, 16/11: los dos son @wiigo.arg).
  var REDES = { ig: 'wiigo.arg', tt: 'wiigo.arg' };
  var IC_RED = {
    ig: 'M7.0301.084c-1.2768.0602-2.1487.264-2.911.5634-.7888.3075-1.4575.72-2.1228 1.3877-.6652.6677-1.075 1.3368-1.3802 2.127-.2954.7638-.4956 1.6365-.552 2.914-.0564 1.2775-.0689 1.6882-.0626 4.947.0062 3.2586.0206 3.6671.0825 4.9473.061 1.2765.264 2.1482.5635 2.9107.308.7889.72 1.4573 1.388 2.1228.6679.6655 1.3365 1.0743 2.1285 1.38.7632.295 1.6361.4961 2.9134.552 1.2773.056 1.6884.069 4.9462.0627 3.2578-.0062 3.668-.0207 4.9478-.0814 1.28-.0607 2.147-.2652 2.9098-.5633.7889-.3086 1.4578-.72 2.1228-1.3881.665-.6682 1.0745-1.3378 1.3795-2.1284.2957-.7632.4966-1.636.552-2.9124.056-1.2809.0692-1.6898.063-4.948-.0063-3.2583-.021-3.6668-.0817-4.9465-.0607-1.2797-.264-2.1487-.5633-2.9117-.3084-.7889-.72-1.4568-1.3876-2.1228C21.2982 1.33 20.628.9208 19.8378.6165 19.074.321 18.2017.1197 16.9244.0645 15.6471.0093 15.236-.005 11.977.0014 8.718.0076 8.31.0215 7.0301.0839m.1402 21.6932c-1.17-.0509-1.8053-.2453-2.2287-.408-.5606-.216-.96-.4771-1.3819-.895-.422-.4178-.6811-.8186-.9-1.378-.1644-.4234-.3624-1.058-.4171-2.228-.0595-1.2645-.072-1.6442-.079-4.848-.007-3.2037.0053-3.583.0607-4.848.05-1.169.2456-1.805.408-2.2282.216-.5613.4762-.96.895-1.3816.4188-.4217.8184-.6814 1.3783-.9003.423-.1651 1.0575-.3614 2.227-.4171 1.2655-.06 1.6447-.072 4.848-.079 3.2033-.007 3.5835.005 4.8495.0608 1.169.0508 1.8053.2445 2.228.408.5608.216.96.4754 1.3816.895.4217.4194.6816.8176.9005 1.3787.1653.4217.3617 1.056.4169 2.2263.0602 1.2655.0739 1.645.0796 4.848.0058 3.203-.0055 3.5834-.061 4.848-.051 1.17-.245 1.8055-.408 2.2294-.216.5604-.4763.96-.8954 1.3814-.419.4215-.8181.6811-1.3783.9-.4224.1649-1.0577.3617-2.2262.4174-1.2656.0595-1.6448.072-4.8493.079-3.2045.007-3.5825-.006-4.848-.0608M16.953 5.5864A1.44 1.44 0 1 0 18.39 4.144a1.44 1.44 0 0 0-1.437 1.4424M5.8385 12.012c.0067 3.4032 2.7706 6.1557 6.173 6.1493 3.4026-.0065 6.157-2.7701 6.1506-6.1733-.0065-3.4032-2.771-6.1565-6.174-6.1498-3.403.0067-6.156 2.771-6.1496 6.1738M8 12.0077a4 4 0 1 1 4.008 3.9921A3.9996 3.9996 0 0 1 8 12.0077',
    tt: 'M12.525.02c1.31-.02 2.61-.01 3.91-.02.08 1.53.63 3.09 1.75 4.17 1.12 1.11 2.7 1.62 4.24 1.79v4.03c-1.44-.05-2.89-.35-4.2-.97-.57-.26-1.1-.59-1.62-.93-.01 2.92.01 5.84-.02 8.75-.08 1.4-.54 2.79-1.35 3.94-1.31 1.92-3.58 3.17-5.91 3.21-1.43.08-2.86-.31-4.08-1.03-2.02-1.19-3.44-3.37-3.65-5.71-.02-.5-.03-1-.01-1.49.18-1.9 1.12-3.72 2.58-4.96 1.66-1.44 3.98-2.13 6.15-1.72.02 1.48-.04 2.96-.04 4.44-.99-.32-2.15-.23-3.02.37-.63.41-1.11 1.04-1.36 1.75-.21.51-.15 1.07-.14 1.61.24 1.64 1.82 3.02 3.5 2.87 1.12-.01 2.19-.66 2.77-1.61.19-.33.4-.67.41-1.06.1-1.79.06-3.57.07-5.36.01-4.03-.01-8.05.02-12.07z'
  };
  function redesPie() {
    // Con los colores de cada red (Gonzalo, 16/11): Instagram con su degradé y TikTok en negro con la nota
    // en celeste y rosa desplazados, como su logo.
    var glifo = function (k) {
      var p = '<path d="' + IC_RED[k] + '"/>';
      return '<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">' +
        (k === 'tt' ? '<g fill="#25F4EE" transform="translate(-.8 -.8)">' + p + '</g><g fill="#FE2C55" transform="translate(.8 .8)">' + p + '</g>' : '') +
        '<g fill="#fff">' + p + '</g></svg>';
    };
    var red = function (k, url, nombre) { return '<a class="red red-' + k + '" href="' + url + '" target="_blank" rel="noopener" aria-label="WiiGo en ' + nombre + '">' + glifo(k) + '<span>' + nombre + '<small>@' + esc(REDES[k]) + '</small></span></a>'; };
    return '<div class="redes">' + (REDES.ig ? red('ig', 'https://www.instagram.com/' + REDES.ig + '/', 'Instagram') : '') + (REDES.tt ? red('tt', 'https://www.tiktok.com/@' + REDES.tt, 'TikTok') : '') + '</div>';
  }

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
      '<div class="f-foto">' + foto(p, 828) + '</div><h2 class="f-nombre">' + esc(p.t) + '</h2><span class="f-de">' + esc(nombreMarca(p.mf || p.m)) + ' · ' + esc(p.sc) + '</span>' +
      (p.rc ? '<div class="f-est">' + estrellas(p.r) + ' <b>' + coma(p.r) + '</b> · ' + p.rc + (p.rc === 1 ? ' opinión' : ' opiniones') + '</div>' : '') +
      (p.s > 0 ? '<div class="f-precio"><b>' + plata(p.p) + '</b><span>' + plata(p.e || p.p) + ' efectivo</span></div>' : '<div class="f-precio"><span style="color:var(--gris)">Sin stock por ahora. Preguntá en la estación cuándo entra.</span></div>') + sabores(p) + '<div style="margin-top:10px" data-acc="' + p.id + '">' + boton(p) + '</div>' +
      // Compartir con un amigo (Gonzalo, 16/11): WhatsApp o lo que tenga el celu.
      '<button class="compartir" data-a="compartir" data-id="' + p.id + '">' + ic('compartir', 18) + 'Compartir con un amigo</button>' +
      // Nutrición en números, sin explicación. Después, el texto chico.
      (nutri ? '<div class="f-nutri" title="' + nutriPorcion(p).txt + '">' + (function (n) { return [['kcal', 'Kcal', n.k, ''], ['', 'Prot.', n.pr, ' g'], ['', 'Carbos', n.ca, ' g'], ['', 'Grasas', n.gr, ' g'], ['', 'Fibra', n.fi, ' g']]; })(nutriPorcion(p)).map(function (x) { return '<div class="' + x[0] + '"><small>' + x[1] + '</small><b>' + (x[2] == null ? '—' : (x[0] ? Math.round(x[2]) : coma(x[2])) + x[3]) + '</b></div>'; }).join('') + '</div><p class="f-chico" style="margin-top:6px">' + (gramosPorcion(p) || nutriPorcion(p).unidad ? 'Por porción: ' + esc(p.po) : 'Cada 100 g') + '</p>' : '') +
      (p.fl && p.fl.length ? '<p class="f-chico" style="color:#3f5536;font-weight:800">' + esc(p.fl.map(function (x) { return titulo(x.replace(/\s+/g, ' ')); }).join(' · ')) + '</p>' : '') +
      (p.de ? '<p class="f-desc' + (S.descAbierta ? ' abierta' : '') + '" data-a="desc">' + esc(p.de) + '</p>' : '') +
      (p.o ? '<p class="f-chico"><b>Origen:</b> ' + esc(p.o) + '</p>' : '') +
      (p.in ? '<p class="f-chico"><b>Ingredientes:</b> ' + esc(p.in) + (p.al ? ' · <b>Alérgenos:</b> ' + esc(p.al) : '') + '</p>' : '') +
      // Lo que dicen los que lo compraron (18/11): los comentarios ya aprobados.
      (p.op && p.op.length ? '<h3 class="sub-cuenta">Lo que dicen los que lo compraron</h3>' + p.op.map(function (o) {
        return '<div class="f-rese"><div><b>' + esc(o.n) + '</b>' + estrellas(o.e) + '</div><p>' + esc(o.c) + '</p><small>✓ Compra verificada · ' + esc(new Date(o.f + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'short' })) + '</small></div>';
      }).join('') : '') + '</div></section>';
  }
  /* ---------- Cuenta WiiGo Club: DNI → (datos) → código al mail → Mi WiiGo ---------- */
  function cuenta() {
    if (!S.cuenta) return '';
    var d = S.datos, cuerpo = '', espera = S.enviando ? ' disabled' : '';
    var t2 = function (t) { return '<h2 class="f-nombre" style="margin-top:0">' + t + '</h2>'; };
    if (S.usuario) cuerpo = miWiigo();
    // Primero cómo registrarse (Gonzalo, 16/11): sin cuenta no se compra online. Es gratis y sin contraseña.
    else if (S.paso === 'dni') cuerpo = t2('Creá tu cuenta o entrá') +
      '<p class="texto-cuenta">Para comprar online necesitás tu cuenta WiiGo. Es gratis, sin contraseña, y es la misma del WiiGo Club.</p>' +
      '<ol class="pasos-cuenta"><li><b>Poné tu DNI.</b> Si ya compraste en la estación, te reconocemos.</li><li><b>Si es tu primera vez,</b> completás nombre, apellido y mail.</li><li><b>Te llega un código</b> de 6 números al mail y listo.</li></ol>' +
      '<div class="form"><label class="campo">Tu DNI<input id="c-dni" inputmode="numeric" autocomplete="off" placeholder="Solo números, sin puntos" value="' + esc(d.dni || '') + '"></label><button class="cta" data-a="c-dni"' + espera + '>' + (S.enviando ? 'Un momento…' : 'Seguir') + '</button></div>';
    // Con un DNI del Club sin mail no se muestra nada de esa persona hasta que confirme su apellido.
    else if (S.paso === 'datos') cuerpo = t2(d.encontrado ? 'Este DNI ya es del Club' : 'Creá tu cuenta') +
      '<p class="texto-cuenta">' + (d.encontrado ? 'Confirmá tu apellido y sumá tu mail para entrar desde el celu.' : 'Es la misma cuenta del WiiGo Club: tus puntos se suman online y en la estación.') + '</p><div class="form">' +
      (d.encontrado ? '<label class="campo">Tu apellido<input id="c-apellido-conf" autocomplete="family-name"><small style="font-weight:500">Para cuidar tu cuenta: el mismo que diste en la estación.</small></label>'
        : '<div class="dos"><label class="campo">Nombre<input id="c-nombre" autocomplete="given-name"></label><label class="campo">Apellido<input id="c-apellido" autocomplete="family-name"></label></div>') +
      '<label class="campo">DNI<input value="' + esc(d.dni) + '" readonly></label><label class="campo">Mail<input id="c-mail" type="email" autocomplete="email" placeholder="tu@mail.com"></label>' +
      '<label class="campo">Cumpleaños<input id="c-cumple" type="date"></label>' +
      '<label class="tilde"><input id="c-promos" type="checkbox"><span>Quiero recibir novedades y promos por mail<small>Es opcional. Te das de baja cuando quieras.</small></span></label>' +
      '<button class="cta" data-a="c-datos"' + espera + '>' + (S.enviando ? 'Mandando…' : 'Mandame el código') + '</button><button class="ver-mas" style="margin-top:0" data-a="c-volver">Usar otro DNI</button></div>';
    else cuerpo = t2('Revisá tu mail') + '<p class="texto-cuenta">Te mandamos un código de 6 números a <b>' + esc(d.mail || 'tu mail') + '</b>. Vence en 15 minutos. Si no lo ves, mirá en «Spam» o «Promociones».</p>' +
      '<div class="form"><label class="campo">Código<input id="c-codigo" class="codigo" inputmode="numeric" maxlength="6" autocomplete="one-time-code"></label><button class="cta naranja" data-a="c-codigo"' + espera + '>' + (S.enviando ? 'Entrando…' : 'Entrar') + '</button>' +
      '<button class="ver-mas" style="margin-top:0" data-a="c-volver">Usar otro DNI</button></div>' +
      (d.encontrado === undefined ? '<p class="f-chico">¿Ese no es tu mail? Pedí que lo corrijan en la estación.</p>' : '');
    return '<div class="fondo" data-a="cerrar-cuenta"></div><section class="hoja" role="dialog" aria-modal="true" aria-label="Mi WiiGo"><div class="hoja-cab"><span></span><button class="redondo" data-a="cerrar-cuenta" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div><div class="hoja-cuerpo">' + cuerpo + '</div></section>';
  }
  function fechaCorta(iso) { return new Date(iso).toLocaleDateString('es-AR', { weekday: 'short', day: 'numeric', month: 'short', timeZone: 'America/Argentina/Buenos_Aires' }); }
  // Estrellas en texto: ★★★★☆
  function estrellas(n) { var r = Math.round(n); return '<span class="estrellas" aria-label="' + coma(n) + ' de 5 estrellas">' + '★★★★★'.slice(0, r) + '<i>' + '★★★★★'.slice(r) + '</i></span>'; }
  // Los productos distintos de una compra (para opinar): uno por producto, con su foto.
  function productosDe(c) { var vistos = {}; return c.items.filter(function (it) { if (!it.id || vistos[it.id]) return false; vistos[it.id] = 1; return true; }); }
  // Opinar sobre una compra (Gonzalo, 18/11): estrellas por producto y un comentario opcional.
  function hojaOpinar() {
    var c = S.usuario.compras[S.opinar]; if (!c) return '';
    var ya = Object.keys(c.opino || {}).length > 0;
    return '<h2 class="f-nombre" style="margin-top:0">¿Qué te pareció?</h2><p class="texto-cuenta">Tocá las estrellas de cada producto. El comentario es opcional: lo publicamos después de revisarlo.</p>' +
      productosDe(c).map(function (it) {
        var e = S.opEst[it.id] || (c.opino || {})[it.id] || 0;
        return '<div class="op-item"><span class="mini">' + (it.img ? imagen(it.img, 96) : '') + '</span><div><b>' + esc(titulo(it.n)) + '</b><div class="op-est" role="group" aria-label="Estrellas para ' + esc(titulo(it.n)) + '">' +
          [1, 2, 3, 4, 5].map(function (k) { return '<button data-a="op-est" data-id="' + it.id + '" data-e="' + k + '" aria-label="' + k + ' estrellas" aria-pressed="' + (k <= e) + '">★</button>'; }).join('') + '</div></div>' +
          '<textarea data-op="' + it.id + '" maxlength="500" placeholder="Contanos qué te pareció (opcional)">' + esc(S.opCom[it.id] || '') + '</textarea></div>';
      }).join('') +
      (ya ? '' : '<p class="op-premio">★ Sumás 10 puntos por opinar</p>') +
      '<button class="cta" data-a="op-enviar">' + (S.enviando ? 'Enviando…' : 'Enviar opinión') + '</button><button class="ver-mas" style="margin-top:8px" data-a="op-cerrar">Ahora no</button>';
  }
  function miWiigo() {
    var u = S.usuario;
    if (S.opinar != null) return hojaOpinar();
    // «Mis pedidos» (18/11): online y en la estación juntos, con fotos, «Opinar» y «Repetir».
    var compras = u.compras.length ? u.compras.map(function (c, i) {
      var abierta = S.compraAbierta === i, n = c.items.reduce(function (a, it) { return a + it.q; }, 0), prods = productosDe(c);
      var opinados = prods.filter(function (it) { return (c.opino || {})[it.id]; });
      var prom = opinados.length ? opinados.reduce(function (a, it) { return a + c.opino[it.id]; }, 0) / opinados.length : 0;
      var fotos = '<div class="ped-fotos">' + prods.slice(0, 4).map(function (it) { return '<span class="mini">' + (it.img ? imagen(it.img, 96) : '') + '</span>'; }).join('') + (prods.length > 4 ? '<span class="mini mas-n">+' + (prods.length - 4) + '</span>' : '') + '</div>';
      var acciones = opinados.length === prods.length && prods.length
        ? '<div class="ped-ya">' + estrellas(prom) + ' Ya opinaste · gracias</div><div class="ped-acc uno"><button data-a="c-repetir" data-i="' + i + '">↻ Repetir</button></div>'
        : '<div class="ped-acc">' + (c.opinable && prods.length ? '<button class="op" data-a="c-opinar" data-i="' + i + '">☆ Opinar</button>' : '') + '<button data-a="c-repetir" data-i="' + i + '">↻ Repetir</button></div>';
      return '<div class="compra"><button class="compra-cab" data-a="c-compra" data-i="' + i + '" aria-expanded="' + abierta + '"><span><b>' + plata(c.total) + '</b><small>' + esc(fechaCorta(c.fecha)) + ' · ' + esc(c.donde) + '</small><small>' + n + (n === 1 ? ' producto' : ' productos') + (c.pago ? ' · ' + esc(c.pago) : '') + '</small></span><span class="pts">+' + c.puntos + '<span>puntos</span></span>' + ic('abajo', 18) + '</button>' +
        fotos + acciones +
        (abierta ? '<div class="compra-items">' + c.items.map(function (it) { return '<div class="compra-item"><span class="mini">' + (it.img ? imagen(it.img, 96) : '') + '</span><span>' + (it.q > 1 ? it.q + ' × ' : '') + esc(titulo(it.n)) + (it.v ? ' — ' + esc(it.v) : '') + '</span><b>' + plata(it.imp) + '</b></div>'; }).join('') + '</div>' : '') + '</div>';
    }).join('') : '<p class="texto-cuenta">Todavía no hay compras. Las que hagas acá o en la estación (dando tu DNI) aparecen solas.</p>';
    var cumple = u.cumple ? '<div class="dato"><span>Cumpleaños</span><b>' + esc(new Date(u.cumple + 'T12:00:00').toLocaleDateString('es-AR', { day: 'numeric', month: 'long' })) + '</b></div>'
      : '<div class="dato" style="align-items:center"><span>Cumpleaños</span><span style="display:flex;gap:6px"><input id="c-cumple2" type="date" aria-label="Tu cumpleaños" style="height:40px;border:1.5px solid var(--linea);border-radius:10px;padding:0 8px;font:600 14px var(--texto);background:var(--carta)"><button class="acceso" data-a="c-cumple">Guardar</button></span></div>';
    // Recién registrado: la bienvenida al Club con cómo funciona, una sola vez (Gonzalo, 16/11).
    var bienv = S.bienvenida ? '<div class="bienvenida"><b>¡Bienvenido/a a WiiGo Club, ' + esc(u.nombre) + '!</b>' +
      '<ul><li>Sumás <b>5 puntos cada $1.000</b> que comprás, acá o en la estación (dando tu DNI).</li><li>Cada punto vale <b>$1</b> para pagar productos WiiGo Dietética, hasta el 10 % de la compra.</li><li>Ves tus puntos y tus compras acá, en tu cuenta.</li></ul>' +
      '<button class="cta" data-a="c-bienv">Empezar a comprar</button></div>' : '';
    return bienv + '<div class="club"><small>Hola, ' + esc(u.nombre) + ' · WiiGo Club</small><b>' + u.puntos.toLocaleString('es-AR') + ' puntos</b><span>Sumás 5 puntos cada $1.000 de compra, online o en la estación. Los canjeás en productos WiiGo Dietética.</span></div>' +
      '<h3 class="sub-cuenta">Mis pedidos</h3>' + compras +
      '<h3 class="sub-cuenta">Mis datos</h3><div class="dato"><span>Nombre</span><b>' + esc((u.nombre + ' ' + u.apellido).trim()) + '</b></div><div class="dato"><span>DNI</span><b>' + esc(u.dni) + '</b></div><div class="dato"><span>Mail</span><b>' + esc(u.email) + '</b></div>' + cumple +
      '<label class="tilde" style="margin:14px 2px"><input type="checkbox" data-a="c-promos"' + (u.promos ? ' checked' : '') + '><span>Recibir novedades y promos por mail</span></label>' +
      '<button class="ver-mas" data-a="c-salir">Salir de mi cuenta</button>';
  }
  // Manda un paso de la cuenta y repinta con lo que conteste el servidor.
  // Mientras espera, solo se apaga el botón (sin redibujar, así no se borra lo que escribió).
  function pasoCuenta(cuerpo, siOk) {
    if (S.enviando) return;
    S.enviando = true;
    var b = document.querySelector('.hoja .cta'), texto = b ? b.textContent : '';
    if (b) { b.disabled = true; b.textContent = 'Un momento…'; }
    api(cuerpo).then(function (r) {
      S.enviando = false;
      if (r.error) { if (b) { b.disabled = false; b.textContent = texto; } aviso(r.error); return; }
      siOk(r); pintar(false);
    });
  }
  /* ---------- Pantalla «Combos» y la hoja para elegir el sabor (maqueta aprobada, 16/11) ---------- */
  function precioSuelto(c, modo) {
    // Lo que sale llevar los productos sueltos (el más barato de cada grupo), para el «Ahorrás».
    return c.g.reduce(function (t, g) {
      var min = Infinity; g.ids.forEach(function (id) { var p = POR_ID[id]; if (p) min = Math.min(min, modo === 'EFECTIVO' ? (p.e || p.p) : p.p); });
      return t + (min === Infinity ? 0 : min) * g.q;
    }, 0);
  }
  function comboConStock(c) { return c.g.every(function (g) { return g.ids.reduce(function (t, id) { var p = POR_ID[id]; return t + (p ? p.s : 0); }, 0) >= g.q; }); }
  function llevaCombo(c) {
    return c.g.map(function (g) {
      var nombres = g.ids.map(function (id) { return POR_ID[id] ? POR_ID[id].t : ''; }).filter(Boolean).join(' o ');
      var conSabor = g.ids.some(function (id) { var p = POR_ID[id]; return p && p.v && p.v.length > 1; });
      return '<b>' + (g.q > 1 ? g.q + ' × ' : '') + esc(nombres) + '</b>' + (conSabor ? ' (elegís el sabor)' : '');
    }).join(' + ');
  }
  function fotoCombo(c) {
    if (c.img) return imagen(c.img, 828);
    // Sin foto del combo: las de sus productos, una al lado de la otra.
    return '<span class="combo-fotos">' + c.g.map(function (g) { var p = POR_ID[g.ids[0]]; return p ? '<span>' + foto(p) + '</span>' : ''; }).join('') + '</span>';
  }
  function vistaCombos() {
    var marcas = COMBOS.map(function (c) { return c.m; }).filter(function (m, i, a) { return m && a.indexOf(m) === i; });
    return '<div class="filtro-cab"><button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button><span><b>Combos</b><small>' + COMBOS.length + (COMBOS.length === 1 ? ' combo' : ' combos') + ' · precio especial llevando los productos juntos</small></span></div>' +
      '<div class="combos">' + COMBOS.map(function (c) {
        var suelto = precioSuelto(c, 'LISTA'), ahorro = suelto - c.p, hay = comboConStock(c);
        return '<article class="combo-t"><div class="combo-foto">' + fotoCombo(c) + (ahorro > 0 ? '<span class="combo-ahorro">Ahorrás ' + plata(ahorro) + '</span>' : '') + (c.m ? '<span class="combo-marca">' + esc(c.m) + '</span>' : '') + '</div>' +
          '<div class="combo-info"><h3>' + esc(c.n) + '</h3><p class="combo-lleva">Llevás ' + llevaCombo(c) + '</p>' +
          '<div class="combo-precios"><b>' + plata(c.p) + '</b>' + (c.e > 0 && c.e < c.p ? '<span>' + plata(c.e) + ' efectivo</span>' : '') + (suelto > c.p ? '<s>' + plata(suelto) + '</s>' : '') + '</div>' +
          (hay ? '<button class="agregar" data-a="combo-elegir" data-id="' + esc(c.id) + '">Agregar combo</button>' : '<button class="agregar" disabled>Sin stock por ahora</button>') + '</div></article>';
      }).join('') + '</div>' + (marcas.length ? '<p class="f-chico" style="text-align:center">Combos armados por ' + esc(marcas.join(', ')) + '. El descuento se aplica solo en tu pedido.</p>' : '');
  }
  // Lo que eligió en cada grupo del combo: producto (si hay más de uno) y sabor (si tiene).
  function eleccionCombo(c) {
    var sel = S.comboSel || (S.comboSel = {});
    return c.g.map(function (g, gi) {
      var e = sel[gi] || (sel[gi] = {});
      if (!e.id || g.ids.indexOf(e.id) < 0) e.id = g.ids.filter(function (id) { return POR_ID[id] && POR_ID[id].s > 0; })[0] || g.ids[0];
      var p = POR_ID[e.id];
      if (p && p.v && p.v.length) { if (!e.v || !p.v.some(function (x) { return x.n === e.v && x.s > 0; })) e.v = ((p.v.filter(function (x) { return x.s >= g.q; })[0]) || (p.v.filter(function (x) { return x.s > 0; })[0]) || {}).n || null; }
      else e.v = null;
      return e;
    });
  }
  function hojaCombo() {
    var c = S.combo && POR_COMBO[S.combo]; if (!c) return '';
    var el = eleccionCombo(c);
    var cuerpo = c.g.map(function (g, gi) {
      var p = POR_ID[el[gi].id], h = '';
      if (g.ids.length > 1) h += '<span class="combo-paso">Producto</span><div class="t-sabores">' + g.ids.map(function (id) { var q = POR_ID[id]; return q ? '<button data-a="combo-prod" data-g="' + gi + '" data-x="' + esc(id) + '" aria-pressed="' + (el[gi].id === id) + '"' + (q.s < g.q ? ' disabled' : '') + '>' + esc(q.t) + '</button>' : ''; }).join('') + '</div>';
      if (p && p.v && p.v.length > 1) h += '<span class="combo-paso">Sabor · ' + esc(p.t) + (g.q > 1 ? ' (los ' + g.q + ')' : '') + '</span><div class="t-sabores">' + p.v.map(function (x) { return '<button data-a="combo-sabor" data-g="' + gi + '" data-x="' + esc(x.n) + '" aria-pressed="' + (el[gi].v === x.n) + '"' + (x.s < g.q ? ' disabled' : '') + '>' + esc(x.n) + '</button>'; }).join('') + '</div>';
      if (!h && p) h = '<p class="combo-fijo">' + (g.q > 1 ? g.q + ' × ' : '') + esc(p.t) + (el[gi].v ? ' — ' + esc(el[gi].v) : '') + '</p>';
      return h;
    }).join('');
    return '<div class="fondo" data-a="cerrar-combo"></div><section class="hoja" role="dialog" aria-modal="true" aria-label="' + esc(c.n) + '"><div class="hoja-cab"><h2 style="font-size:20px">' + esc(c.n) + '</h2><button class="redondo" data-a="cerrar-combo" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div>' +
      '<div class="hoja-cuerpo"><div class="combo-elegir">' + cuerpo + '</div></div><div class="hoja-pie"><button class="cta naranja" data-a="combo-agregar">Agregar · ' + plata(c.p) + '</button></div></section>';
  }
  // Suma al pedido lo elegido, si alcanza el stock de todo (si no, no agrega nada).
  function agregarCombo(c) {
    var el = eleccionCombo(c);
    for (var gi = 0; gi < c.g.length; gi++) {
      var p = POR_ID[el[gi].id];
      if (!p || stockDe(p, el[gi].v) - enCarrito(p.id, el[gi].v) < c.g[gi].q) return aviso('No alcanza el stock de ' + (p ? p.t : 'un producto') + (el[gi].v ? ' — ' + el[gi].v : ''));
    }
    c.g.forEach(function (g, gi) { sumar(el[gi].id, el[gi].v, g.q); });
    S.combo = null; S.comboSel = null; S.pedido = true;
    aviso('🎁 Combo agregado: el descuento ya está en tu pedido');
    pintar(false);
  }

  function pedido() {
    if (!S.pedido) return '';
    var t = totales();
    return '<div class="fondo" data-a="cerrar-pedido"></div><section class="hoja" role="dialog" aria-modal="true" aria-label="Mi pedido"><div class="hoja-cab"><h2>Mi pedido</h2><button class="redondo" data-a="cerrar-pedido" aria-label="Cerrar">' + ic('cruz', 20) + '</button></div><div class="hoja-cuerpo">' +
      (carrito.length ? carrito.map(function (l) { var p = POR_ID[l.id]; return '<div class="linea-ped"><span class="mini">' + foto(p) + '</span><span><b>' + esc(p.t) + (l.v ? ' — ' + esc(l.v) : '') + '</b><small>' + plata(p.p * l.q) + ' · efectivo ' + plata((p.e || p.p) * l.q) + '</small></span><div class="paso"><button data-a="p-restar" data-id="' + l.id + '" data-v="' + esc(l.v || '') + '" aria-label="Uno menos">−</button><span>' + l.q + '</span><button data-a="p-sumar" data-id="' + l.id + '" data-v="' + esc(l.v || '') + '" aria-label="Uno más">+</button></div></div>'; }).join('') : '<div class="vacio">Todavía no agregaste nada.</div>') + '</div>' +
      (carrito.length ? '<div class="hoja-pie">' + filasCombos(t) + '<div class="total"><span>Total</span><b>' + plata(t.g) + '</b></div><div class="total ef"><span>Pagando en efectivo al retirar</span><b>' + plata(t.e) + '</b></div>' +
      '<div class="total" style="font-size:14px"><span>' + (S.usuario ? 'Sumás en WiiGo Club' : '<button data-a="cuenta" style="border:0;background:none;padding:0;color:var(--energia);font-weight:800;text-decoration:underline">Entrá con tu DNI</button> y sumás') + '</span><b style="font-size:16px;color:var(--energia)">+' + t.p + ' puntos</b></div><span class="nota">Lo retirás en <a class="dir-mapa" href="' + MAPA + '" target="_blank" rel="noopener">Arístides Villanueva 256</a>, listo en menos de 15 minutos.</span><button class="agregar" style="min-height:52px" data-a="continuar">Continuar</button></div>' : '') + '</section>';
  }

  /* ---------- Parte 3: comprar y seguir el pedido (maqueta aprobada, 2026-11-16) ---------- */
  // El pedido lo arma el servidor (/api/tienda/pedido): acá solo va qué y cuántos.
  // Los precios y el stock se vuelven a calcular allá.
  var ESTADOS_PED = [
    { t: 'Recibido', d: 'Le llegó a la estación. En instantes lo confirman.' },
    { t: 'Aceptado', d: 'El equipo lo tomó y empieza a armarlo.' },
    { t: 'Armando', d: 'Estamos juntando cada producto de tu pedido.' },
    { t: 'Listo para retirar', d: 'Te espera en la estación. Decí tu DNI y tu palabra secreta.' },
    { t: 'Retirado', d: '¡Gracias! Ya sumaste tus puntos.' }
  ];
  function apiPedido(cuerpo) {
    return fetch('/api/tienda/pedido', cuerpo ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo), credentials: 'same-origin' } : { credentials: 'same-origin', cache: 'no-store' })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { if (!r.ok && !j.error) j.error = 'Algo falló. Probá de nuevo en un momento.'; return j; }); })
      .catch(function () { return { error: 'Sin conexión. Revisá internet y probá de nuevo.' }; });
  }
  function abiertoPed(p) { return p.estado === 'NUEVO' || p.estado === 'ARMANDO' || p.estado === 'LISTO'; }
  function pedidoVisto() {
    var l = S.pedidos || [];
    return l.filter(function (p) { return p.codigo === S.verCodigo; })[0] || l.filter(abiertoPed)[0] || l[0] || null;
  }
  function cargarPedidos() {
    if (!S.usuario) return;
    apiPedido().then(function (r) {
      if (!r || !r.pedidos) return;
      var antes = JSON.stringify(S.pedidos || []);
      S.pedidos = r.pedidos;
      // Desde el link del mail: /tienda?pedido=WG-XXXX abre el seguimiento.
      if (S.abrirCodigo) { if (r.pedidos.some(function (p) { return p.codigo === S.abrirCodigo; })) { S.verCodigo = S.abrirCodigo; S.vista = 'seguir'; } S.abrirCodigo = null; pintar(true); return; }
      if (JSON.stringify(r.pedidos) !== antes) pintar(false);
    });
  }
  function checkout() {
    // Sin link de Mercado Pago (comisión cara): transferencia al alias a precio de góndola, o pagás al retirar.
    var t = totales(), co = S.co || (S.co = { pago: 'transf' });
    var op = function (a, v, on, tit, sub, extra) { return '<button class="opcion" data-a="' + a + '" data-v="' + v + '" aria-pressed="' + on + '"' + (extra || '') + '><span class="radio"></span><span><b>' + tit + '</b><small>' + sub + '</small></span></button>'; };
    // Más simple (Gonzalo, 18/11, maqueta «La tienda, como el local»): dónde retirás, cómo pagás con el monto
    // al lado, el total, los puntos y un botón. El alias aparece después de confirmar, en el seguimiento.
    var hr = horario();
    return '<div class="filtro-cab"><button class="redondo" data-a="abrir-pedido" aria-label="Volver al pedido">' + ic('atras') + '</button><span><b>Finalizar compra</b></span></div>' +
      '<div class="fc-caja"><p class="fc-t">Retirás en</p><div class="fc-retiro"><span>📍</span><span><b>Arístides Villanueva 256</b><small>Listo en 15 min · gratis' + (hr[0] ? '' : ' · ' + hr[1]) + '</small></span></div></div>' +
      '<div class="fc-caja"><p class="fc-t">¿Cómo pagás?</p><div class="opciones">' +
      op('pago', 'transf', co.pago === 'transf', 'Transferencia', '<span class="fc-monto">' + plata(t.g) + '</span>') +
      op('pago', 'retiro', co.pago === 'retiro', 'Al retirar', 'Efectivo <span class="fc-monto">' + plata(t.e) + '</span> · tarjeta o QR ' + plata(t.g)) + '</div></div>' +
      '<div class="fc-caja"><p class="fc-t">Tu pedido</p>' +
      '<details class="fc-det"><summary>' + t.u + (t.u === 1 ? ' producto' : ' productos') + ' <span>Ver detalle</span></summary>' +
      carrito.map(function (l) { var p = POR_ID[l.id]; return '<div class="total" style="font-size:14px;font-weight:600"><span>' + l.q + ' × ' + esc(p.t) + (l.v ? ' — ' + esc(l.v) : '') + '</span><b style="font-size:14px;font-family:var(--texto)">' + plata(p.p * l.q) + '</b></div>'; }).join('') +
      filasCombos(t, ' style="margin-top:6px"') + '</details>' +
      '<div class="total" style="border-top:1px solid var(--linea);padding-top:10px;margin-top:6px"><span>Total</span><b>' + plata(co.pago === 'retiro' ? t.e : t.g) + '</b></div>' +
      (co.pago === 'retiro' ? '<p class="f-chico" style="margin:0">En efectivo. Con tarjeta o QR: ' + plata(t.g) + '.</p>' : '') +
      '<div class="total" style="font-size:14px"><span>Sumás en WiiGo Club</span><b style="font-size:16px;color:var(--energia)">+' + t.p + ' puntos</b></div></div>' +
      '<button class="cta naranja" style="margin-top:14px" data-a="confirmar"' + (S.enviando ? ' disabled' : '') + '>' + (S.enviando ? 'Enviando…' : co.pago === 'transf' ? 'Confirmar y transferir ' + plata(t.g) : 'Confirmar pedido') + '</button>' +
      '<p class="f-chico" style="text-align:center">Al confirmar aceptás los términos · 10 días para arrepentirte</p>';
  }
  // La escena del local en cada paso del pedido (del primer prototipo aprobado, 2026-11-11).
  function escenaPedido(k) {
    var base = '<polygon points="200,118 372,206 200,294 28,206" fill="#e9dcc2"/><polygon points="28,206 200,118 200,40 28,128" fill="#f6f0e4"/><polygon points="200,118 372,206 372,128 200,40" fill="#ece2cf"/>' +
      '<polygon points="46,182 168,120 168,80 46,142" fill="#b6bd9f"/><polygon points="46,182 168,120 168,125 46,187" fill="#7d8a66"/>' +
      '<polygon points="58,162 72,155 72,141 58,148" fill="#e8743b"/><polygon points="82,150 96,143 96,129 82,136" fill="#f1c75b"/><polygon points="106,138 120,131 120,117 106,124" fill="#d9a37f"/><polygon points="130,126 144,119 144,105 130,112" fill="#3f6b6d"/><polygon points="58,180 72,173 72,163 58,170" fill="#d9a37f"/><polygon points="94,162 108,155 108,145 94,152" fill="#e8743b"/><polygon points="130,144 144,137 144,127 130,134" fill="#f1c75b"/>' +
      '<polygon points="214,210 284,175 336,201 266,236" fill="#3f6b6d"/><polygon points="214,210 266,236 266,262 214,236" fill="#2f5456"/><polygon points="266,236 336,201 336,227 266,262" fill="#284849"/>' +
      '<polygon points="290,108 340,133 340,170 290,145" fill="#18231a"/><text x="315" y="142" text-anchor="middle" font-size="7" font-weight="800" fill="#b6bd9f" font-family="Figtree" transform="skewY(27)">PEDIDOS</text><polygon points="236,72 260,84 260,112 236,100" fill="#22301f"/>';
    var persona = function (x, y, color, extra) { return '<g style="animation:e-paso .6s ease-in-out infinite"><ellipse cx="' + x + '" cy="' + (y + 40) + '" rx="13" ry="5" fill="rgba(0,0,0,.2)"/><rect x="' + (x - 11) + '" y="' + y + '" width="22" height="36" rx="10" fill="' + color + '"/><circle cx="' + x + '" cy="' + (y - 11) + '" r="11" fill="#d9a37f"/>' + (extra || '') + '</g>'; };
    var bolsa = function (x, y, cerrada) { return '<g><polygon points="' + x + ',' + y + ' ' + (x + 24) + ',' + (y - 12) + ' ' + (x + 38) + ',' + (y - 5) + ' ' + (x + 14) + ',' + (y + 7) + '" fill="#d9a37f"/><polygon points="' + x + ',' + y + ' ' + (x + 14) + ',' + (y + 7) + ' ' + (x + 14) + ',' + (y + 32) + ' ' + x + ',' + (y + 25) + '" fill="#c48d47"/><polygon points="' + (x + 14) + ',' + (y + 7) + ' ' + (x + 38) + ',' + (y - 5) + ' ' + (x + 38) + ',' + (y + 20) + ' ' + (x + 14) + ',' + (y + 32) + '" fill="#b07a3c"/>' + (cerrada ? '<rect x="' + (x + 17) + '" y="' + (y + 10) + '" width="16" height="9" fill="#18231a" transform="skewY(-27)"/>' : '') + '</g>'; };
    var s = '';
    if (k === 'recibido') s = '<circle cx="262" cy="190" r="14" fill="none" stroke="#f1c75b" stroke-width="3" style="animation:e-onda 1.6s ease-out infinite"/><circle cx="262" cy="190" r="14" fill="none" stroke="#f1c75b" stroke-width="3" style="animation:e-onda 1.6s ease-out infinite .8s"/><rect x="253" y="176" width="18" height="30" rx="4" fill="#18231a" stroke="#f5f1e8" stroke-width="2"/><g style="animation:e-ticket 1.8s ease-in-out infinite"><rect x="226" y="196" width="18" height="22" rx="2" fill="#fff"/><rect x="229" y="201" width="12" height="2" fill="#8a826f"/><rect x="229" y="206" width="9" height="2" fill="#8a826f"/></g>';
    else if (k === 'aceptado') s = persona(300, 150, '#e8743b', '<rect x="306" y="158" width="14" height="18" rx="2" fill="#18231a"/>') + '<g style="animation:e-rebote 1.4s ease-in-out infinite"><circle cx="300" cy="104" r="16" fill="#b6bd9f"/><path d="M292 104l6 6 10-11" stroke="#1b2219" stroke-width="3.5" fill="none" stroke-linecap="round" stroke-linejoin="round"/></g>';
    else if (k === 'preparando') s = '<g style="animation:e-caminar 4.4s ease-in-out infinite">' + persona(250, 168, '#e8743b') + '</g>' + bolsa(272, 196, false) + ['#f1c75b', '#b6bd9f', '#e8743b'].map(function (c, i) { return '<rect x="196" y="156" width="10" height="10" rx="2" fill="' + c + '" style="animation:e-saltar 2.2s ease-in infinite ' + (i * 0.7) + 's"/>'; }).join('');
    else if (k === 'listo') s = '<g style="animation:e-rebote 2s ease-in-out infinite">' + bolsa(298, 134, true) + '<rect x="290" y="96" width="62" height="22" rx="6" fill="#f1c75b"/><text x="321" y="111" text-anchor="middle" font-family="ui-monospace,monospace" font-size="11" font-weight="800" fill="#3b2f0e">LISTO</text></g>';
    else if (k === 'entregado') s = persona(222, 180, '#e8743b') + persona(300, 214, '#3f6b6d') + '<g style="animation:e-entrega 2.4s ease-in-out infinite alternate">' + bolsa(232, 200, true) + '</g>' + ['#f1c75b', '#e8743b', '#b6bd9f', '#fff', '#3f6b6d'].map(function (c, i) { return '<rect x="' + (60 + i * 64) + '" y="0" width="8" height="8" fill="' + c + '" style="animation:e-confeti ' + (2.2 + i * 0.3) + 's linear infinite ' + (i * 0.35) + 's"/>'; }).join('') + '<text x="130" y="76" font-family="Bricolage Grotesque" font-size="30" font-weight="800" fill="#f1c75b" style="animation:e-subePts 2.6s ease-out infinite">+ puntos</text>';
    else if (k === 'cancelado') s = '<rect x="0" y="0" width="400" height="300" fill="rgba(24,35,26,.55)"/><circle cx="200" cy="150" r="40" fill="#c2361f"/><path d="M184 134l32 32M216 134l-32 32" stroke="#fff" stroke-width="7" stroke-linecap="round"/>';
    return '<svg class="esc" viewBox="0 0 400 300" aria-hidden="true">' + base + s + '</svg>';
  }
  function seguimiento() {
    var p = pedidoVisto(), volver = '<button class="redondo" data-a="inicio" aria-label="Volver al inicio">' + ic('atras') + '</button>';
    if (!p) return '<div class="filtro-cab">' + volver + '<span><b>Mis pedidos</b></span></div><div class="vacio">' + (S.usuario ? 'No tenés pedidos en curso.' : 'Entrá con tu DNI para ver tus pedidos.') + '</div>';
    var cancelado = p.estado === 'CANCELADO', e = Math.max(0, p.paso), falta = p.pago === 'transf' && !p.pagoOk && abiertoPed(p), c = p.transferencia;
    // Transferencia sin confirmar: arriba de todo, los datos para transferir.
    var transf = falta && c ? '<div class="transf"><small>Transferí</small><b>' + plata(p.total) + '</b>' +
      '<div class="dato-t"><span>Alias</span><b>' + esc(c.alias) + '</b><button class="acceso" data-a="copiar" data-x="' + esc(c.alias) + '">Copiar</button></div>' +
      '<div class="dato-t"><span>CVU</span><b>' + esc(c.cvu) + '</b><button class="acceso" data-a="copiar" data-x="' + esc(c.cvu) + '">Copiar</button></div>' +
      '<div class="dato-t"><span>Titular</span><b>' + esc(c.titular) + '</b></div>' +
      '<a class="cta" style="display:grid;place-items:center;text-decoration:none;margin-top:8px;background:#009ee3;color:#fff" href="' + esc(c.link) + '" target="_blank" rel="noopener">Transferir con Mercado Pago</a>' +
      '<span class="f-chico" style="color:#5a4510">En el concepto poné <b>Pedido #' + p.num + '</b>. Cuando la vemos, empezamos a armarlo.</span></div>' : '';
    var faltaron = p.items.filter(function (it) { return it.hay != null && it.hay < it.q; });
    var avisoFalta = faltaron.length && !cancelado ? '<div class="seg-falta"><b>No encontramos todo</b>' + faltaron.map(function (it) { return '<span>' + esc(titulo(it.n)) + (it.v ? ' — ' + esc(it.v) : '') + ': ' + (it.hay === 0 ? 'no había' : 'había ' + it.hay + ' de ' + it.q) + '</span>'; }).join('') +
      '<span>' + (p.devolver > 0 ? (p.devuelto ? 'Ya te devolvimos ' + plata(p.devolver) + '.' : 'Te devolvemos <b>' + plata(p.devolver) + '</b> por transferencia.') : 'El total quedó en <b>' + plata(p.total) + '</b>.') + '</span></div>' : '';
    var sub = cancelado ? 'Cancelado' : p.pago === 'transf' ? (falta ? 'Esperando tu transferencia' : 'Transferencia recibida ✓') : 'Pagás al retirar: efectivo ' + plata(p.efectivo) + ' o tarjeta ' + plata(p.total);
    var estado = cancelado ? '<div class="seg-estado"><b>Pedido cancelado</b><span>' + esc(p.motivo || 'Se canceló.') + (p.devolver > 0 ? ' Te devolvemos ' + plata(p.devolver) + ' a la misma cuenta.' : '') + '</span></div>'
      : falta ? '<div class="seg-estado"><b>Esperando tu transferencia</b><span>Apenas la vemos en la cuenta, el equipo acepta tu pedido y lo arma.</span></div>'
      : '<div class="seg-estado"><b>' + ESTADOS_PED[e].t + '</b><span>' + ESTADOS_PED[e].d + '</span>' + (e < 3 ? '<em>Listo en unos ' + [15, 12, 6][e] + ' minutos</em>' : '') + '</div>';
    var otros = (S.pedidos || []).filter(function (x) { return x.codigo !== p.codigo; });
    return '<div class="filtro-cab">' + volver + '<span><b>Pedido #' + p.num + '</b><small>' + sub + '</small></span></div>' + transf + avisoFalta +
      '<div class="estacion3d"><div class="tablero">' + escenaPedido(cancelado ? 'cancelado' : ['recibido', 'aceptado', 'preparando', 'listo', 'entregado'][e]) + '</div></div>' +
      (cancelado ? '' : '<div class="seg-codigo"><small>Tu palabra secreta</small><b>' + esc(p.palabra || p.codigo) + '</b><span>Para retirar decí tu DNI y esta palabra</span></div>') + estado +
      (cancelado ? '' : '<ol class="seg-pasos">' + ESTADOS_PED.map(function (x, i) { return '<li class="' + (i < e ? 'hecho' : i === e ? 'ahora' : '') + '"><i>' + (i < e ? '✓' : i + 1) + '</i><span>' + x.t + '</span></li>'; }).join('') + '</ol>') +
      '<div class="seg-items">' + p.items.map(function (it) { var n = it.hay == null ? it.q : it.hay; return '<div class="total" style="font-size:14px;font-weight:600"><span>' + (n === 0 ? '<s>' : '') + (n === it.q ? it.q : n + ' de ' + it.q) + ' × ' + esc(titulo(it.n)) + (it.v ? ' — ' + esc(it.v) : '') + (n === 0 ? '</s>' : '') + '</span><b style="font-size:14px;font-family:var(--texto)">' + plata(it.p * n) + '</b></div>'; }).join('') +
      '<div class="total" style="border-top:1px solid var(--linea);padding-top:8px;margin-top:2px"><span>Total</span><b>' + plata(p.total) + '</b></div></div>' +
      '<p class="f-chico">Te avisamos por mail en cada paso.' + (abiertoPed(p) && !p.pagoOk ? ' Te lo guardamos hasta mañana a las 21.' : '') + '</p>' +
      (otros.length ? '<h3 class="sub-cuenta">Tus otros pedidos</h3>' + otros.map(function (x) { return '<button class="ver-mas" style="margin-top:6px" data-a="ver-pedido" data-c="' + esc(x.codigo) + '">Pedido #' + x.num + ' · ' + (x.estado === 'CANCELADO' ? 'Cancelado' : ESTADOS_PED[Math.max(0, x.paso)].t) + '</button>'; }).join('') : '');
  }

  /* pintar */
  function buscador() {
    return '<label class="buscar">' + ic('lupa', 20) + '<span class="oculto">Buscar producto</span><input id="q" type="search" autocomplete="off" autocorrect="off" spellcheck="false" placeholder="Buscar en la estación" value="' + esc(S.q) + '">' + (S.q ? '<button class="limpiar" data-a="limpiar" aria-label="Borrar búsqueda">' + ic('cruz', 18) + '</button>' : '') + '</label>';
  }
  // Baja hasta donde el buscador, las marcas y las categorías quedan pegados arriba, con los productos justo abajo.
  function alPegado() {
    var acc = document.querySelector('.accesos-4'), cab = document.getElementById('cab');
    if (acc) window.scrollTo(0, acc.getBoundingClientRect().bottom + window.scrollY - (cab ? cab.offsetHeight : 0));
  }
  function pintar(arriba) {
    var t = totales();
    // Arriba, siempre: el logo, la cuenta, el pedido y el buscador (busca en todo). Las marcas y los rubros
    // ahora están en el inicio (pastillas y pestañas), así que el menú ☰ ya no va.
    var cab = '<header class="cab" id="cab"><div class="cab-fila"><button data-a="inicio" style="border:0;background:none;padding:0" aria-label="Inicio"><img class="logo" src="/wiigo-logo-negro.png" alt="WiiGo Estaciones de Bienestar"></button><span class="espacio"></span>' +
      (S.usuario ? '<button class="pts-cab" data-a="cuenta" aria-label="Mi WiiGo: ' + S.usuario.puntos + ' puntos">★ ' + S.usuario.puntos.toLocaleString('es-AR') + '</button>' : '<button class="cab-cuenta" data-a="cuenta" aria-label="Entrar o sumarme a WiiGo">' + ic('persona', 22) + '</button>') +
        // Arriba, distinto de Alifrut (Gonzalo, 16/11, opción B): la cuenta en verde bosque y el pedido en naranja con la cantidad.
        '<button class="cab-pedido" data-a="abrir-pedido" aria-label="Mi pedido: ' + t.u + ' productos">' + ic('canasta', 20) + '<b>' + t.u + '</b></button></div>' +
      // El buscador siempre acá arriba, en el encabezado (Gonzalo, 16/11: «mejor arriba como estaba al principio»).
      buscador() + '</header>';
    var cuerpo = S.vista === 'checkout' && S.usuario && carrito.length ? checkout() : S.vista === 'seguir' ? seguimiento() : S.vista === 'pros' ? profesionales() : (S.vista === 'lista' || S.q.length >= 2) ? lista() : S.vista === 'combos' ? vistaCombos() : inicio();
    // Con un pedido en curso y el carrito vacío, la barra lleva a seguirlo.
    var enCurso = (S.pedidos || []).filter(abiertoPed)[0];
    var barra = t.u && !S.pedido && !S.ficha && S.vista !== 'checkout' ? '<div class="barra"><button data-a="abrir-pedido"><span>' + ic('bolsa', 20) + t.u + (t.u === 1 ? ' producto' : ' productos') + ' · ' + plata(t.g) + '</span><span>Ver mi pedido ' + ic('flecha', 18) + '</span></button></div>'
      : !t.u && enCurso && S.vista !== 'seguir' && !S.pedido ? '<div class="barra"><button data-a="ver-pedido" data-c="' + esc(enCurso.codigo) + '"><span>' + ic('bolsa', 20) + 'Pedido #' + enCurso.num + ' · ' + (enCurso.pago === 'transf' && !enCurso.pagoOk ? 'Falta tu transferencia' : ESTADOS_PED[Math.max(0, enCurso.paso)].t) + '</span><span>Seguir ' + ic('flecha', 18) + '</span></button></div>' : '';
    var foco = document.activeElement && (document.activeElement.id === 'q' || document.activeElement.id === 'mq') ? document.activeElement.id : null;
    var pos = foco ? document.activeElement.selectionStart : 0, y = window.scrollY;
    app.innerHTML = cab + '<main>' + cuerpo + '</main>' + (S.cuenta || S.combo ? '' : barra) + cajon() + ficha() + pedido() + hojaCombo() + cuenta();
    if (foco) { var i = document.getElementById(foco); if (i) { i.focus(); try { i.setSelectionRange(pos, pos); } catch (e) {} } }
    window.scrollTo(0, arriba ? 0 : y);
    montarGlobo();
    montarBanners();
    espiarRubros();
  }

  // Las pestañas de rubros quedan pegadas justo abajo del buscador, y se marca sola la del rubro que se
  // está mirando al bajar (como en las apps de delivery).
  var espia = null;
  function espiarRubros() {
    var cab = document.getElementById('cab'), alto = cab ? cab.offsetHeight : 120;
    document.documentElement.style.setProperty('--alto-cab', alto + 'px');
    // En el inicio, lo pegado arriba es el encabezado + el buscador con las pestañas.
    var peg = document.getElementById('pegado-ini');
    document.documentElement.style.setProperty('--alto-pegado', (peg ? peg.offsetHeight : 48) + 'px');
    if (peg) alto += peg.offsetHeight - 60;
    if (espia) { espia.disconnect(); espia = null; }
    var tabs = document.getElementById('tabs-rubros');
    if (!tabs || !('IntersectionObserver' in window)) return;
    espia = new IntersectionObserver(function (es) {
      es.forEach(function (e) {
        if (!e.isIntersecting) return;
        var tab = tabs.querySelector('[data-s="' + e.target.id + '"]'); if (!tab) return;
        tabs.querySelectorAll('[data-s]').forEach(function (x) { x.removeAttribute('aria-current'); });
        tab.setAttribute('aria-current', 'true');
        tabs.scrollLeft = tab.offsetLeft - 16;
      });
    }, { rootMargin: '-' + (alto + 60) + 'px 0px -55% 0px' });
    document.querySelectorAll('.rubro-sec[id]').forEach(function (s) { espia.observe(s); });
  }

  /* Los banners de arriba: se deslizan con el dedo y pasan solos cada 6 s (si nadie los tocó recién). */
  function montarBanners() {
    var p = document.getElementById('b-pista'); if (!p) return;
    p.scrollLeft = (S.banner || 0) * p.clientWidth;
    p.onscroll = function () { var i = Math.round(p.scrollLeft / Math.max(1, p.clientWidth)); if (i !== (S.banner || 0)) { S.banner = i; marcarPuntos(); } };
    p.onpointerdown = p.ontouchstart = function () { S.bannerQuieto = Date.now(); };
    marcarPuntos(); pasos15();
  }
  function marcarPuntos() {
    document.querySelectorAll('.b-puntos button').forEach(function (b, i) { if (i === (S.banner || 0)) b.setAttribute('aria-current', 'true'); else b.removeAttribute('aria-current'); });
    // El de los 15 minutos arranca de cero cada vez que aparece (Gonzalo, 18/11).
    var p = document.getElementById('b-pista'), b15 = p && p.children[S.banner || 0];
    if (b15 && b15.classList.contains('b-15')) { if (!visto15) arrancar15(); visto15 = true; } else visto15 = false;
  }
  setInterval(function () {
    var p = document.getElementById('b-pista');
    if (!p || window.matchMedia('(prefers-reduced-motion: reduce)').matches || S.ficha || S.pedido || S.cuenta || S.menu || S.cartelIni) return;
    if (Date.now() - (S.bannerQuieto || 0) < 9000) return;
    var r = p.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) return;
    S.banner = ((S.banner || 0) + 1) % p.children.length;
    p.scrollTo({ left: S.banner * p.clientWidth, behavior: 'smooth' });
  }, 6000);
  // El banner de los 15 minutos: apenas aparece se prende «Pedís» y cada 0,9 s el paso siguiente; la barra
  // avanza y el cronómetro corre hasta el minuto de ese paso. Termina en 14:30 «¡Listo!» y queda ahí
  // hasta que pasa al banner siguiente. Solo corre mientras se ve (18/11: antes corría siempre y al
  // aparecer ya estaba por la mitad o terminado).
  var paso15 = 0, segs15 = 0, reloj15 = null, visto15 = false;
  function arrancar15() {
    clearTimeout(reloj15); paso15 = 0; segs15 = 0; pasos15();
    (function sig() { reloj15 = setTimeout(function () { if (!visto15 || paso15 >= 4) return; paso15++; pasos15(); sig(); }, paso15 === 0 ? 200 : 900); })();
  }
  function mmss(s) { return String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(Math.floor(s % 60)).padStart(2, '0'); }
  function pasos15() {
    var ps = document.querySelectorAll('.b-paso'); if (!ps.length) return;
    var n = Math.min(paso15, 4);
    ps.forEach(function (el, i) { el.classList.toggle('hecho', i < n); });
    var barra = document.querySelector('.b-linea i'); if (barra) barra.style.width = (n <= 1 ? 0 : (n - 1) / 3 * 100) + '%';
    var t = document.getElementById('b-tiempo'); if (!t) return;
    var crono = t.parentNode; crono.classList.toggle('listo', n === 4);
    var desde = segs15, hasta = MIN_15[n], ini = performance.now();
    if (n === 0 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { segs15 = hasta; t.textContent = mmss(hasta); return; }
    (function correr(ahora) {
      var k = Math.min(1, (ahora - ini) / 900); segs15 = desde + (hasta - desde) * (1 - Math.pow(1 - k, 3));
      var el = document.getElementById('b-tiempo'); if (el) el.textContent = mmss(segs15);
      if (k < 1) requestAnimationFrame(correr);
    })(ini);
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
  function refrescar(id) { document.querySelectorAll('[data-acc="' + id + '"]').forEach(function (el) { el.innerHTML = el.dataset.tipo === 'item' ? botonItem(POR_ID[id]) : boton(POR_ID[id]); }); var y = window.scrollY; pintar(false); window.scrollTo(0, y); }

  var A = {
    inicio: function () { S.vista = 'inicio'; S.f = null; S.q = ''; S.limite = 20; S.marcaIni = null; pintar(true); },
    // Una pestaña de rubro: baja hasta esa parte (el margen deja ver el título abajo del buscador).
    'ir-sec': function (d) {
      if (S.vista !== 'inicio' || S.q) { S.vista = 'inicio'; S.f = null; S.q = ''; pintar(true); }
      // La cuenta a mano (no scrollIntoView): que el título quede justo abajo de lo pegado arriba.
      var s = document.getElementById(d.s), cab = document.getElementById('cab'), pg = document.getElementById('pegado-ini');
      if (s) {
        var destino = s.getBoundingClientRect().top + window.scrollY - (cab ? cab.offsetHeight : 0) - (pg ? pg.offsetHeight : 0) - 4;
        // Lejos, salta directo (la animación tarda más de un segundo); cerca, baja suave.
        window.scrollTo({ top: destino, behavior: menosMov || Math.abs(destino - window.scrollY) > 1400 ? 'auto' : 'smooth' });
      }
    },
    // Una marca: el inicio muestra solo lo de esa marca (se vuelve a tocar y aparece todo).
    'marca-ini': function (d) {
      // «Todo» (data-m vacío) vuelve a todas las marcas; desde «Ver todo» de una sección, elige esa marca.
      S.marcaIni = !d.m || S.marcaIni === d.m ? null : d.m; pintar(false); alPegado();
      var mp = document.querySelector('.marca-p[aria-pressed="true"]'); if (mp) mp.parentNode.scrollLeft = mp.offsetLeft - 16;
    },
    'abrir-menu': function () { S.menu = true; S.menuMarca = (S.f && S.f.marca) || null; pintar(false); },
    'cerrar-menu': function () { S.menu = false; S.menuQ = ''; pintar(false); },
    'menu-marca': function (d) { S.menuMarca = S.menuMarca === d.x ? null : d.x; pintar(false); },
    'ver-todo': function () { ver({ titulo: 'Todos los productos' }); },
    'ver-marca': function (d) { ver({ marca: d.m, titulo: d.m }); },
    'ver-sub': function (d) { ver({ marca: d.m, sub: d.s, titulo: d.s }); },
    nuevos: function () { ver({ nuevos: true, titulo: 'Nuevos esta semana' }); },
    // Ofertas: lo que tiene descuento hoy. Combos: todavía no hay (los arma Gonzalo más adelante).
    ofertas: function () { if (!OFERTAS.length) return aviso('Hoy no hay ofertas: volvé pronto'); ver({ ofertas: true, titulo: 'Ofertas' }); },
    combos: function () { if (!COMBOS.length) return aviso('Muy pronto: combos con precio especial'); S.vista = 'combos'; S.q = ''; S.menu = false; pintar(true); },
    // Un combo sin nada para elegir (un solo producto, sin sabores) se agrega directo; si no, se abre la hoja.
    'combo-elegir': function (d) {
      var c = POR_COMBO[d.id]; if (!c) return;
      S.comboSel = null;
      var hayQueElegir = c.g.some(function (g) { return g.ids.length > 1 || g.ids.some(function (id) { var p = POR_ID[id]; return p && p.v && p.v.length > 1; }); });
      if (!hayQueElegir) return agregarCombo(c);
      S.combo = c.id; pintar(false);
    },
    'combo-prod': function (d) { var e = (S.comboSel || {})[d.g]; if (e) { e.id = d.x; e.v = null; } pintar(false); },
    'combo-sabor': function (d) { var e = (S.comboSel || {})[d.g]; if (e) e.v = d.x; pintar(false); },
    'combo-agregar': function () { var c = POR_COMBO[S.combo]; if (c) agregarCombo(c); },
    'cerrar-combo': function () { S.combo = null; S.comboSel = null; pintar(false); },
    mundo: function () { ver({ mundo: true, titulo: 'Productos del mundo' }); },
    lugar: function (d) { var f = S.f; f.lugar = d.k && f.lugar !== d.k ? d.k : null; f.titulo = 'Productos del mundo'; S.limite = 20; pintar(false); if (G) G.marcar(f.lugar); },
    desc: function () { S.descAbierta = !S.descAbierta; pintar(false); },
    objetivos: function () { ver({ objetivos: true, titulo: 'Por objetivo' }); },
    obj: function (d) { var f = S.f; f.obj = d.o; f.titulo = d.o; S.limite = 20; pintar(false); },
    'obj-directo': function (d) { ver({ objetivos: true, obj: d.o, titulo: d.o }); },
    pros: function () { S.vista = 'pros'; S.f = null; S.q = ''; pintar(true); },
    cuenta: function () { S.cuenta = true; S.pedido = false; S.ficha = null; S.menu = false; if (!S.usuario && S.paso !== 'codigo') { S.paso = 'dni'; } pintar(false); var i = document.getElementById('c-dni'); if (i) i.focus(); },
    'cerrar-cuenta': function () { S.cuenta = false; S.opinar = null; pintar(false); },
    'c-volver': function () { S.paso = 'dni'; S.datos = {}; pintar(false); },
    'c-dni': function () {
      var dni = (document.getElementById('c-dni').value || '').replace(/\D/g, '');
      if (dni.length < 7) return aviso('Escribí tu DNI, sin puntos');
      S.datos = { dni: dni };
      pasoCuenta({ accion: 'dni', dni: dni }, function (r) { if (r.paso === 'codigo') { S.datos.mail = r.mail; S.paso = 'codigo'; } else { S.datos.encontrado = !!r.encontrado; S.paso = 'datos'; } });
    },
    'c-datos': function () {
      var v = function (id) { var e = document.getElementById(id); return e ? e.value.trim() : ''; }, d = S.datos;
      if (!d.encontrado && (!v('c-nombre') || !v('c-apellido'))) return aviso('Completá tu nombre y apellido');
      if (d.encontrado && !v('c-apellido-conf')) return aviso('Escribí tu apellido');
      if (!/^\S+@\S+\.\S+$/.test(v('c-mail'))) return aviso('Revisá el mail');
      pasoCuenta({ accion: 'datos', dni: d.dni, nombre: v('c-nombre'), apellido: v('c-apellido'), apellidoConf: v('c-apellido-conf'), email: v('c-mail'), cumple: v('c-cumple'), promos: document.getElementById('c-promos').checked },
        function (r) { S.datos.mail = r.mail; S.paso = 'codigo'; });
    },
    'c-bienv': function () { S.bienvenida = false; S.cuenta = false; pintar(false); },
    'c-codigo': function () {
      var codigo = (document.getElementById('c-codigo').value || '').replace(/\D/g, '');
      if (codigo.length !== 6) return aviso('El código tiene 6 números');
      pasoCuenta({ accion: 'codigo', dni: S.datos.dni, codigo: codigo }, function (r) {
        // Pasó por «Creá tu cuenta» (no solo entró de nuevo): es el momento de contarle cómo funciona el Club (16/11).
        var recien = S.datos.encontrado !== undefined;
        S.usuario = r.usuario; S.paso = 'dni'; S.datos = {}; cargarPedidos();
        S.bienvenida = recien;
        // Venía de «Continuar»: sigue derecho a finalizar la compra (la bienvenida queda para cuando abra su cuenta).
        if (S.trasEntrar === 'checkout' && carrito.length) { S.cuenta = false; S.vista = 'checkout'; window.scrollTo(0, 0); if (recien) aviso('¡Listo! Ya sos WiiGo Club: esta compra suma puntos'); }
        S.trasEntrar = null;
        setTimeout(function () { aviso('¡Listo, ' + r.usuario.nombre + '! Ya estás en WiiGo Club'); }, 50);
      });
    },
    'c-compra': function (d) { var i = Number(d.i); S.compraAbierta = S.compraAbierta === i ? null : i; pintar(false); },
    // Opinar (18/11): estrellas por producto, comentario opcional y 10 puntos la primera vez.
    'c-opinar': function (d) { S.opinar = Number(d.i); S.opEst = {}; S.opCom = {}; pintar(false); var h = document.querySelector('.hoja-cuerpo'); if (h) h.scrollTop = 0; },
    'op-cerrar': function () { S.opinar = null; pintar(false); },
    'op-est': function (d) { S.opEst[d.id] = Number(d.e); pintar(false); },
    'op-enviar': function () {
      var c = S.usuario.compras[S.opinar]; if (!c) return;
      var ops = productosDe(c).map(function (it) { return { id: it.id, e: S.opEst[it.id] || (c.opino || {})[it.id] || 0, c: S.opCom[it.id] || '' }; }).filter(function (o) { return o.e > 0; });
      if (!ops.length) { aviso('Tocá las estrellas de al menos un producto'); return; }
      pasoCuenta({ accion: 'opinar', venta: c.id, opiniones: ops }, function (r) {
        S.usuario = r.usuario || S.usuario; S.opinar = null;
        aviso(r.puntos ? '¡Gracias! Sumaste ' + r.puntos + ' puntos' : '¡Gracias por tu opinión!');
      });
    },
    'c-repetir': function (d) {
      var c = S.usuario.compras[Number(d.i)], agregados = 0, faltan = 0;
      c.items.forEach(function (it) {
        var p = it.id && POR_ID[it.id]; if (!p) { faltan++; return; }
        var v = it.v && (p.v || []).some(function (x) { return x.n === it.v; }) ? it.v : saborDe(p), antes = enCarrito(p.id, v);
        sumar(p.id, v, it.q); if (enCarrito(p.id, v) > antes) agregados++; else faltan++;
      });
      S.cuenta = false; S.pedido = agregados > 0; pintar(false);
      aviso(!agregados ? 'Nada de esa compra tiene stock ahora' : faltan ? 'Agregamos lo que hay en stock (' + faltan + ' sin stock)' : 'Agregamos todo a tu pedido');
    },
    banner: function (d) { var p = document.getElementById('b-pista'); S.banner = Number(d.i); S.bannerQuieto = Date.now(); if (p) p.scrollTo({ left: S.banner * p.clientWidth, behavior: 'smooth' }); marcarPuntos(); },
    'c-cumple': function () { var v = document.getElementById('c-cumple2').value; if (!v) return aviso('Elegí la fecha'); pasoCuenta({ accion: 'actualizar', cumple: v }, function (r) { S.usuario = r.usuario; aviso('Guardado'); }); },
    'c-promos': function () {
      var quiere = !S.usuario.promos;
      api({ accion: 'actualizar', promos: quiere }).then(function (r) {
        if (r.error) { aviso(r.error); pintar(false); return; }
        S.usuario = r.usuario; pintar(false); aviso(quiere ? 'Vas a recibir novedades' : 'Listo, no te mandamos más novedades');
      });
    },
    'c-salir': function () { pasoCuenta({ accion: 'salir' }, function () { S.usuario = null; S.cuenta = false; S.compraAbierta = null; S.pedidos = []; if (S.vista === 'checkout' || S.vista === 'seguir') S.vista = 'inicio'; }); },
    // Parte 3: del pedido a finalizar la compra (hay que entrar con el DNI), pagar y seguirlo.
    continuar: function () {
      S.pedido = false;
      if (!S.usuario) { S.trasEntrar = 'checkout'; A.cuenta(); aviso('Entrá con tu DNI para hacer el pedido'); return; }
      S.vista = 'checkout'; pintar(true);
    },
    x: function () {},
    pago: function (d) { S.co = S.co || {}; S.co.pago = d.v; pintar(false); },
    confirmar: function () {
      if (S.enviando || !carrito.length) return;
      S.enviando = true; pintar(false);
      var pago = (S.co && S.co.pago) === 'retiro' ? 'AL_RETIRAR' : 'TRANSFERENCIA';
      apiPedido({ pago: pago, items: carrito.map(function (l) { return { id: l.id, v: l.v, q: l.q }; }) }).then(function (r) {
        S.enviando = false;
        if (r.error) {
          // Se terminó algo mientras armaba el pedido: se ajusta solo a lo que queda.
          (r.faltan || []).forEach(function (f) { carrito.forEach(function (l) { if (l.id === f.id && (l.v || null) === (f.v || null)) l.q = f.quedan; }); });
          carrito = carrito.filter(function (l) { return l.q > 0; });
          if (r.faltan && r.faltan.length) { S.vista = 'inicio'; S.pedido = true; }
          pintar(false); aviso(r.error); return;
        }
        carrito = []; sabor = {}; S.co = null;
        S.pedidos = [r.pedido].concat((S.pedidos || []).filter(function (p) { return p.codigo !== r.pedido.codigo; }));
        S.verCodigo = r.pedido.codigo; S.vista = 'seguir'; pintar(true);
        aviso(pago === 'TRANSFERENCIA' ? '¡Pedido hecho! Ahora transferí y lo armamos' : '¡Pedido hecho! Te avisamos cuando esté listo');
      });
    },
    'ver-pedido': function (d) { S.verCodigo = d.c || null; S.vista = 'seguir'; S.pedido = false; pintar(true); cargarPedidos(); },
    copiar: function (d) { try { navigator.clipboard.writeText(d.x); aviso('Copiado: ' + d.x); } catch (e) { aviso(d.x); } },
    sabor: function (d) { sabor[d.id] = d.x; refrescar(d.id); },
    sumar: function (d) { var p = POR_ID[d.id]; sumar(d.id, saborDe(p), 1); refrescar(d.id); },
    restar: function (d) { var p = POR_ID[d.id]; sumar(d.id, saborDe(p), -1); refrescar(d.id); },
    ficha: function (d) { S.ficha = d.id; S.descAbierta = false; pintar(false); },
    'cerrar-ficha': function () { S.ficha = null; pintar(false); },
    // El link abre la ficha de este producto (wiigo.com.ar/?p=…), con la foto y el precio en la vista previa de WhatsApp.
    // En el celu abre el menú de compartir del teléfono (WhatsApp, Instagram…); si no lo tiene, va directo a WhatsApp.
    compartir: function (d) {
      var p = POR_ID[d.id]; if (!p) return;
      var url = location.origin + '/?p=' + p.id, texto = 'Mirá esto en WiiGo: ' + p.t + ' — ' + plata(p.p);
      if (navigator.share) { navigator.share({ title: p.t + ' · WiiGo', text: texto, url: url }).catch(function () {}); return; }
      window.open('https://wa.me/?text=' + encodeURIComponent(texto + '\n' + url), '_blank', 'noopener');
    },
    'abrir-pedido': function () { S.pedido = true; S.ficha = null; pintar(false); },
    'cerrar-pedido': function () { S.pedido = false; pintar(false); },
    'p-sumar': function (d) { sumar(d.id, d.v || null, 1); pintar(false); },
    'p-restar': function (d) { sumar(d.id, d.v || null, -1); pintar(false); },
    limpiar: function () { S.q = ''; pintar(false); var i = document.getElementById('q'); if (i) i.focus(); },
    mas: function () { S.limite += 20; pintar(false); }
  };
  document.addEventListener('click', function (e) { var el = e.target.closest('[data-a]'); if (!el || el.tagName === 'INPUT') return; var a = A[el.getAttribute('data-a')]; if (a) { e.preventDefault(); a(el.dataset); } });
  // Las casillas avisan con «change» (el clic no pasa por A para no frenar el tilde).
  document.addEventListener('change', function (e) { if (e.target.getAttribute && e.target.getAttribute('data-a') === 'c-promos') A['c-promos'](e.target.dataset); });
  // La dirección abre el mapa (Gonzalo, 16/11). En iPhone, Apple Maps (siempre está instalado);
  // en el resto, Google Maps (en Android abre la app). Misma búsqueda en el mail de «¡Está listo!».
  var DIR_MAPA = 'Arístides Villanueva 256, Mendoza, Argentina';
  var MAPA = /iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent) && 'ontouchend' in document
    ? 'https://maps.apple.com/?q=' + encodeURIComponent('WiiGo') + '&address=' + encodeURIComponent(DIR_MAPA)
    : 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(DIR_MAPA);
  // La fila de accesos da vueltas sola, sin fin (Gonzalo, 16/11: «que se vayan deslizando siempre hasta que la
  // toques y luego vuelve»). Los botones van dos veces seguidas: cuando la primera tanda terminó de pasar, se salta
  // atrás exactamente esa distancia y no se nota. Al tocarla se frena y el cliente la desliza a mano (también da la
  // vuelta); 3 s después de soltarla sigue sola. Quieta fuera de la pantalla, con una hoja abierta o con «reducir
  // movimiento». Solo mueve el scroll: no redibuja ni consulta al servidor.
  var accesosQuieto = 0, accesosTocando = false, accesosPos = -1, accesosFila = null;
  document.addEventListener('touchstart', function (e) { if (e.target.closest && e.target.closest('.accesos-ini')) { accesosTocando = true; accesosPos = -1; } }, { passive: true });
  document.addEventListener('touchend', function () { if (accesosTocando) { accesosTocando = false; accesosQuieto = Date.now() + 3000; } }, { passive: true });
  ['pointerdown', 'wheel'].forEach(function (ev) {
    document.addEventListener(ev, function (e) { if (e.target.closest && e.target.closest('.accesos-ini')) { accesosQuieto = Date.now() + 3000; accesosPos = -1; } }, { passive: true });
  });
  var sinMovimiento = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  function vueltaAccesos(f) {
    // Ancho de una tanda = donde empieza la copia (el primer botón repetido).
    var copia = f.querySelector('[data-copia]'); if (!copia) return 0;
    return copia.offsetLeft - f.firstElementChild.offsetLeft;
  }
  var accesosAntes = 0;
  function moverAccesos(ahora) {
    requestAnimationFrame(moverAccesos);
    // Por tiempo, no por cuadro: igual de rápido en un celu de 60 Hz que en un iPhone de 120 Hz.
    var dt = accesosAntes ? Math.min(100, ahora - accesosAntes) : 0; accesosAntes = ahora;
    var f = document.querySelector('.accesos-ini');
    if (!f) return;
    if (f !== accesosFila) { accesosFila = f; accesosPos = -1; }
    var tanda = vueltaAccesos(f); if (tanda <= 0) return;
    // A mano también da la vuelta, para los dos lados.
    if (f.scrollLeft >= tanda) { f.scrollLeft -= tanda; accesosPos = -1; }
    else if (f.scrollLeft <= 0 && accesosTocando === false && Date.now() < accesosQuieto) { f.scrollLeft += tanda; accesosPos = -1; }
    if (sinMovimiento || accesosTocando || Date.now() < accesosQuieto || document.hidden || S.cuenta || S.pedido || S.ficha) return;
    var r = f.getBoundingClientRect(); if (r.bottom < 0 || r.top > window.innerHeight) return;
    if (accesosPos < 0) accesosPos = f.scrollLeft;
    accesosPos += dt * 0.025; // 25 px por segundo: se lee mientras pasa
    if (accesosPos >= tanda) accesosPos -= tanda;
    f.scrollLeft = accesosPos;
  }
  requestAnimationFrame(moverAccesos);
  // El teclado del celu no tapa las hojas (Entrá a WiiGo, el pedido): con visualViewport se sabe cuánto
  // ocupa y la hoja se apoya arriba de él. Al tocar un campo, se lo trae a la vista (Gonzalo, 16/11).
  function ajustarTeclado() {
    var vv = window.visualViewport; if (!vv) return;
    var tapado = Math.max(0, Math.round(window.innerHeight - vv.height - vv.offsetTop));
    document.documentElement.style.setProperty('--teclado', tapado + 'px');
    document.documentElement.style.setProperty('--alto-visible', Math.round(vv.height) + 'px');
  }
  if (window.visualViewport) { window.visualViewport.addEventListener('resize', ajustarTeclado); window.visualViewport.addEventListener('scroll', ajustarTeclado); ajustarTeclado(); }
  document.addEventListener('focusin', function (e) {
    var t = e.target;
    if (t && t.closest && t.closest('.hoja') && /INPUT|SELECT|TEXTAREA/.test(t.tagName)) setTimeout(function () { try { t.scrollIntoView({ block: 'center' }); } catch (x) {} }, 320);
  });
  var tecleo = null;
  document.addEventListener('input', function (e) {
    if (e.target.id === 'q') {
      var antes = S.q.length >= 2;
      S.q = e.target.value; S.limite = 20; if (S.q.length < 2 && S.vista !== 'lista') S.vista = S.vista === 'pros' ? 'pros' : 'inicio';
      var ahora = S.q.length >= 2;
      // Rápido al tipear (Gonzalo, 16/11): con menos de 2 letras no se redibuja nada (la pantalla no
      // cambia), y mientras se escribe se espera un instante entre letras en vez de redibujar en cada una.
      clearTimeout(tecleo);
      if (!antes && !ahora) return;
      if (antes !== ahora) { pintar(true); return; } // al empezar a buscar o al borrar: arriba de todo
      tecleo = setTimeout(function () { pintar(false); }, 140);
    }
    if (e.target.id === 'mq') { S.menuQ = e.target.value; pintar(false); }
    // El comentario de Opinar se guarda mientras escribe (tocar una estrella redibuja la hoja).
    if (e.target.dataset && e.target.dataset.op) { S.opCom = S.opCom || {}; S.opCom[e.target.dataset.op] = e.target.value; }
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && e.target.id === 'q') e.target.blur();
    if (e.key === 'Enter' && /^c-/.test(e.target.id || '')) { var f = e.target.closest('.form'), b = f && f.querySelector('.cta'); if (b) { e.preventDefault(); b.click(); } }
    if (e.key === 'Escape') { S.menu = false; S.ficha = null; S.pedido = false; pintar(false); }
  });
  // Cartel «WiiGo llegó a Mendoza» (Gonzalo, 18/11, maqueta aprobada): una sola vez por celular, la
  // primera vez que entra. No sale si viene de un link de producto o de su pedido. El logo se prende
  // como el cartel de la fachada. Va aparte de pintar() para que no se borre al redibujar.
  function cartelBienvenida(desdeLink) {
    var CLAVE = 'wiigo-bienvenida-mza';
    try { if (localStorage.getItem(CLAVE)) return; } catch (e) { return; }
    if (desdeLink) { try { localStorage.setItem(CLAVE, '1'); } catch (e) {} return; }
    S.cartelIni = true;
    var d = document.createElement('div');
    d.className = 'bv';
    d.innerHTML = '<div class="bv-velo" data-bv></div><section class="bv-cartel" role="dialog" aria-modal="true" aria-labelledby="bv-t">' +
      '<div class="bv-arriba"><button class="bv-x" type="button" aria-label="Cerrar" data-bv>' + ic('cruz', 18) + '</button>' +
      '<img class="bv-logo" src="/wiigo-logo-negro.png" alt="WiiGo Estaciones de Bienestar"><span class="bv-pin">📍 Arístides Villanueva 256</span></div>' +
      '<div class="bv-abajo"><h2 id="bv-t">WiiGo llegó a <em>Mendoza</em>.</h2><p>La primera Estación de Bienestar. Pedí online y retirá en 15 minutos.</p>' +
      '<button class="bv-entrar" type="button" data-bv>Entrar a la tienda</button></div></section>';
    document.body.appendChild(d);
    var cerrar = function () {
      try { localStorage.setItem(CLAVE, '1'); } catch (e) {}
      S.cartelIni = false; d.classList.remove('abierto'); document.removeEventListener('keydown', esc_);
      setTimeout(function () { d.remove(); }, 450);
    };
    var esc_ = function (e) { if (e.key === 'Escape') cerrar(); };
    d.querySelectorAll('[data-bv]').forEach(function (b) { b.addEventListener('click', cerrar); });
    document.addEventListener('keydown', esc_);
    setTimeout(function () { d.classList.add('abierto'); var b = d.querySelector('.bv-entrar'); if (b) b.focus({ preventScroll: true }); }, 350);
  }
  // Desde el mail: /tienda?pedido=WG-XXXX abre el seguimiento de ese pedido.
  try { var codigoUrl = new URLSearchParams(location.search).get('pedido'); if (codigoUrl && /^WG-[A-Z0-9]{4}$/.test(codigoUrl)) { S.abrirCodigo = codigoUrl; S.vista = 'seguir'; } } catch (e) {}
  // El link que mandó un amigo (?p=<producto>): abre la ficha de ese producto.
  try { var prodUrl = new URLSearchParams(location.search).get('p'); if (prodUrl && POR_ID[prodUrl]) S.ficha = prodUrl; } catch (e) {}
  pintar(false);
  cartelBienvenida(!!(S.abrirCodigo || S.ficha));
  // ¿Ya entró antes en este celu? La cookie la lee el servidor.
  api().then(function (r) { if (r && r.usuario) { S.usuario = r.usuario; pintar(false); cargarPedidos(); } else if (S.abrirCodigo) { A.cuenta(); aviso('Entrá con tu DNI para ver tu pedido'); } });
  // Mientras mira su pedido en curso, se actualiza solo cada 30 segundos (no menos: cada pregunta cuenta para el plan de Vercel).
  setInterval(function () {
    var p = S.vista === 'seguir' && pedidoVisto();
    if (p && abiertoPed(p) && document.visibilityState === 'visible') cargarPedidos();
  }, 30000);
})();
