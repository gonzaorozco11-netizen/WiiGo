// Las redes de cada profesional (columna profesionales.redes, jsonb; ver
// sql/profesionales-redes.sql). Se guarda el link entero del perfil.
//
// En la pantalla del local no se abren: desde el tótem el cliente se iría de
// WiiGo. Se muestra el usuario y un QR que escanea con su celular.
//
// Sin dependencias de servidor: lo usan su espacio (para avisarle mientras
// escribe), la ficha interna, la bandeja de Aprobaciones y la pantalla.

export const REDES = [
  { clave: "instagram", nombre: "Instagram", sello: "IG", ejemplo: "@tuusuario" },
  { clave: "tiktok", nombre: "TikTok", sello: "TT", ejemplo: "@tuusuario" },
  { clave: "facebook", nombre: "Facebook", sello: "FB", ejemplo: "facebook.com/tupagina" },
  { clave: "youtube", nombre: "YouTube", sello: "YT", ejemplo: "youtube.com/@tucanal" },
  { clave: "linkedin", nombre: "LinkedIn", sello: "in", ejemplo: "linkedin.com/in/tu-nombre" },
  { clave: "web", nombre: "Página web", sello: "www", ejemplo: "tusitio.com.ar" },
] as const;

export type ClaveRed = (typeof REDES)[number]["clave"];
export type Redes = Partial<Record<ClaveRed, string>>;

// Los dominios de cada red, para reconocer un link pegado en el casillero equivocado.
const DOMINIOS: Record<Exclude<ClaveRed, "web">, RegExp> = {
  instagram: /^(instagram\.com|instagr\.am)(\/|$)/i,
  tiktok: /^((vm|vt)\.)?tiktok\.com(\/|$)/i,
  facebook: /^(facebook\.com|fb\.com|fb\.me)(\/|$)/i,
  youtube: /^(youtube\.com|youtu\.be)(\/|$)/i,
  linkedin: /^linkedin\.com(\/|$)/i,
};

type Resultado = { link: string | null; error: string | null };
const mal = (error: string): Resultado => ({ link: null, error });

/** Lo que escribió sin "https://", "www." ni "m." adelante. */
function sinPrefijo(escrito: string) {
  return escrito.trim().replace(/^https?:\/\//i, "").replace(/^(www\.|m\.)/i, "");
}

/** Si pegó el link de otra red, cuál. */
function deOtraRed(clave: ClaveRed, s: string) {
  return (Object.keys(DOMINIOS) as Exclude<ClaveRed, "web">[]).find((otra) => otra !== clave && DOMINIOS[otra].test(s));
}

/** La parte del link que va después del dominio, sin "?…" ni "#…" ni la barra final. */
function camino(s: string, dominio: RegExp) {
  return s.replace(dominio, "").replace(/^\//, "").split(/[?#]/)[0].replace(/\/+$/, "");
}

/**
 * Pasa lo que escribió (usuario, @usuario o link) al link de su perfil. Vacío
 * es válido: quiere decir que esa red no la usa.
 */
export function linkDeRed(clave: ClaveRed, escrito: string): Resultado {
  const s = sinPrefijo(escrito);
  if (!s) return { link: null, error: null };
  if (s.length > 200 || /\s/.test(s)) return mal("Escribí solo tu usuario o pegá el link, sin espacios.");

  const otra = deOtraRed(clave, s);
  if (otra) return mal(`Eso es un link de ${REDES.find((r) => r.clave === otra)?.nombre}. Va en su casillero.`);

  if (clave === "instagram") {
    const resto = DOMINIOS.instagram.test(s) ? camino(s, DOMINIOS.instagram) : s.split(/[/?#]/)[0];
    const usuario = resto.split("/")[0].replace(/^@/, "");
    if (/^(p|reel|reels|stories|tv|explore)$/i.test(usuario)) return mal("Ese es el link de una publicación. Poné el de tu perfil: @tuusuario.");
    if (!/^[A-Za-z0-9._]{1,30}$/.test(usuario)) return mal("No parece un usuario de Instagram. Escribilo así: @tuusuario.");
    return { link: `https://www.instagram.com/${usuario}/`, error: null };
  }

  if (clave === "tiktok") {
    if (/^(vm|vt)\./i.test(s)) return mal("Ese link corto no sirve. Poné tu usuario: @tuusuario.");
    const resto = DOMINIOS.tiktok.test(s) ? camino(s, DOMINIOS.tiktok) : s;
    const usuario = resto.split("/")[0].replace(/^@/, "");
    if (!/^[A-Za-z0-9._]{2,24}$/.test(usuario)) return mal("No parece un usuario de TikTok. Escribilo así: @tuusuario.");
    return { link: `https://www.tiktok.com/@${usuario}`, error: null };
  }

  if (clave === "facebook") {
    const conDominio = DOMINIOS.facebook.test(s);
    const resto = conDominio ? s.replace(DOMINIOS.facebook, "").replace(/^\//, "") : s;
    // Los perfiles sin nombre propio son "profile.php?id=123": ahí el número es todo.
    const perfilConNumero = resto.match(/^profile\.php\?id=(\d+)/i);
    if (perfilConNumero) return { link: `https://www.facebook.com/profile.php?id=${perfilConNumero[1]}`, error: null };
    const pagina = resto.split(/[?#]/)[0].replace(/\/+$/, "");
    if (!pagina || !/^[A-Za-z0-9.\-_/]+$/.test(pagina)) return mal("Pegá el link de tu página: facebook.com/tupagina.");
    return { link: `https://www.facebook.com/${pagina}`, error: null };
  }

  if (clave === "youtube") {
    if (/^youtu\.be\//i.test(s) || /^youtube\.com\/(watch|shorts)/i.test(s)) return mal("Ese es el link de un video. Poné el de tu canal: youtube.com/@tucanal.");
    const resto = DOMINIOS.youtube.test(s) ? camino(s, DOMINIOS.youtube) : s.replace(/\/+$/, "");
    const canal = resto.startsWith("@") || /^(channel|c|user)\//i.test(resto) ? resto : `@${resto}`;
    if (!/^(@[A-Za-z0-9._-]{3,30}|(channel|c|user)\/[A-Za-z0-9._-]+)$/.test(canal)) return mal("Pegá el link de tu canal: youtube.com/@tucanal.");
    return { link: `https://www.youtube.com/${canal}`, error: null };
  }

  if (clave === "linkedin") {
    const resto = DOMINIOS.linkedin.test(s) ? camino(s, DOMINIOS.linkedin) : `in/${s.replace(/\/+$/, "")}`;
    if (!/^(in|company)\/[A-Za-z0-9\-_%.]+$/.test(resto)) return mal("Pegá el link de tu perfil: linkedin.com/in/tu-nombre.");
    return { link: `https://www.linkedin.com/${resto}`, error: null };
  }

  // Página web: cualquier sitio, pero que sea un sitio.
  const protocolo = /^http:\/\//i.test(escrito.trim()) ? "http" : "https";
  const sitio = escrito.trim().replace(/^https?:\/\//i, "").replace(/\/+$/, "");
  try {
    const url = new URL(`${protocolo}://${sitio}`);
    if (!/\.[a-z]{2,}$/i.test(url.hostname)) throw new Error();
    return { link: `${protocolo}://${sitio}`, error: null };
  } catch {
    return mal("No parece una página web. Escribila así: tusitio.com.ar.");
  }
}

/** Cómo se lee cada red: "@usuario" donde se usa así, el link corto en las demás. */
export function textoDeRed(clave: ClaveRed, link: string): string {
  const s = sinPrefijo(link).replace(/\/+$/, "");
  if (clave === "instagram") return `@${s.replace(DOMINIOS.instagram, "").replace(/^\//, "")}`;
  if (clave === "tiktok") return s.replace(DOMINIOS.tiktok, "").replace(/^\//, "");
  if (clave === "youtube") {
    const canal = s.replace(DOMINIOS.youtube, "").replace(/^\//, "");
    return canal.startsWith("@") ? canal : s;
  }
  return s;
}

/** Lo que está guardado, por si la columna trae algo raro: solo links de las redes conocidas. */
export function leerRedes(valor: unknown): Redes {
  const redes: Redes = {};
  if (!valor || typeof valor !== "object" || Array.isArray(valor)) return redes;
  for (const r of REDES) {
    const v = (valor as Record<string, unknown>)[r.clave];
    if (typeof v === "string" && /^https?:\/\//i.test(v.trim())) redes[r.clave] = v.trim();
  }
  return redes;
}

/** Valida todas juntas. El error dice en qué red está, para que sepa dónde mirar. */
export function normalizarRedes(escritas: Partial<Record<string, string>>): { redes: Redes; error: string | null } {
  const redes: Redes = {};
  for (const r of REDES) {
    const { link, error } = linkDeRed(r.clave, String(escritas[r.clave] ?? ""));
    if (error) return { redes: {}, error: `${r.nombre}: ${error}` };
    if (link) redes[r.clave] = link;
  }
  return { redes, error: null };
}

export const mismasRedes = (a: Redes, b: Redes) => REDES.every((r) => (a[r.clave] ?? null) === (b[r.clave] ?? null));
