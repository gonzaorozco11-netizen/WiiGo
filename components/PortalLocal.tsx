// De qué sucursal son los números que está viendo la marca.
//
// Hoy el portal NO filtra por local: suma todo lo que se vendió de esa marca
// en WiiGo. Con un solo local da igual y poner el nombre es información útil
// —"los números son de Arístides 256"—, pero con dos decir "Sucursal 1"
// sería mentira. Por eso con varias dice "Todas las sucursales".
//
// Cuando haga falta elegir una, esto se vuelve un `select` y hay que filtrar
// por local las consultas de app/portal/actions.ts. Un selector que no filtra
// sería peor que no tenerlo: muestra una sucursal y devuelve los números de
// todas.

export type LocalPortal = { nombre: string; direccion: string | null };

export default function PortalLocal({ locales }: { locales: LocalPortal[] }) {
  if (locales.length === 0) return null;

  if (locales.length === 1) {
    const l = locales[0];
    return (
      <span className="portal-local">
        <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M7 12.5s4.5-4 4.5-7a4.5 4.5 0 1 0-9 0c0 3 4.5 7 4.5 7Z" />
          <circle cx="7" cy="5.5" r="1.6" />
        </svg>
        {l.nombre}
        {l.direccion && <span className="dir"> · {l.direccion}</span>}
      </span>
    );
  }

  return (
    <span className="portal-local">
      <svg width="11" height="11" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M7 12.5s4.5-4 4.5-7a4.5 4.5 0 1 0-9 0c0 3 4.5 7 4.5 7Z" />
        <circle cx="7" cy="5.5" r="1.6" />
      </svg>
      Todas las sucursales
      <span className="dir"> · {locales.length}</span>
    </span>
  );
}
