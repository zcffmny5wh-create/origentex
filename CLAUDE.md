# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Start dev server (requires nvm)
export NVM_DIR="$HOME/.nvm" && . "$NVM_DIR/nvm.sh" && npm start

# Production build
npm run build

# Deploy to Vercel production
vercel --prod --yes

# Run tests
npm test
```

## Architecture

The entire app lives in a single file: `src/App.jsx` (~5000 lines). There is no routing library — navigation is a `tab` state variable that conditionally renders one of 14 module components. All state is managed in the root `App()` component and passed down as props.

### Data flow

1. On mount, `App` loads all tables from Supabase in a single `useEffect` and maps snake_case DB columns to camelCase JS objects.
2. State setters are wrapped in `*Sync` functions (e.g. `setOrdenesSync`) that immediately upsert to Supabase after updating local state — optimistic UI with no rollback.
3. Real-time updates arrive via a Supabase channel (`cambios_produccion`) subscribed to `INSERT` events on the `registros` table.

### Supabase tables

| Table | Purpose |
|---|---|
| `usuarios` | Users with hashed passwords and roles |
| `ordenes` | Production orders with sequences and tallas |
| `catalogo` | Garment catalog / product definitions |
| `asignaciones` | Operator → order + operations mapping |
| `registros` | Production taps (one row per piece/stop/defect) |
| `pedidos` | Commercial orders (sales → production pipeline) |
| `horarios` | Single-row shift config (stored as JSON in `config` column) |
| `maquinas` | Machine list |

### Auth

Custom auth — no Supabase Auth. Passwords are SHA-256 hashed client-side using `hashClave(clave, usuario)` with a salt `"origentex_" + usuario + "_" + clave.length + "_v2"`. The hardcoded admin is `ADMIN_ROOT` (usuario: `admin`). All other users are stored in the `usuarios` table.

Session is kept in React state only (no localStorage). It expires after 8h (`SESION_MS`) or 30min of inactivity (`INACTIVIDAD_MS`).

### Roles and permissions

Defined in `ROLES` constant. Each role has a `permisos` array of tab IDs it can access. `OPERARIO` role gets a separate full-screen `TabletOperario` layout. Tabs are filtered from `TABS_ALL` based on the logged-in user's role.

### UI system

All styling is inline CSS using the `T` design tokens object (dark theme, `#0a0a0f` background, neon accents). Key reusable primitives: `Glass` (frosted card), `KPI` (metric card), `Badge`, `ProgressBar`. Fonts: `Barlow Condensed` + `Share Tech Mono` loaded from Google Fonts in `public/index.html`.

### Modules (tabs)

- **inicio** — welcome / overview
- **pipeline** — pedido → orden production pipeline (Director)
- **pedidos** — commercial order management (Comercial)
- **dashboard** — real-time efficiency KPIs per module
- **ordenes** — production order CRUD + sequence builder
- **catalogo** — garment catalog with operations and SAM times
- **inventario/compras** — materials and purchasing (Jefe Compras)
- **corte** — cutting room management (Jefe Corte)
- **operarios** — operator management + module assignment
- **eficiencia** — efficiency reports per operator and module
- **horarios** — shift configuration (breaks, productive hours, extra hours per module)
- **reporte** — end-of-shift report + TXT export (Tablet view)
- **usuarios** — user CRUD with password reset (Admin only)
- **log** — activity log with integrity hashes (Admin only)

### Efficiency calculation

`calcEficienciaRealModulo()` computes module efficiency: `(facturables / meta) * 100`. `meta` = `floor(totalProductiveMinutes / SAM)`. Billable units (`facturables`) come from the quality-control operation or the last assigned operation as fallback. Stops and defects are tracked separately in `registros` with `es_parada` / `es_defecto` flags.

## Environment variables

```
REACT_APP_SUPABASE_URL=https://vsdlmymzrerhmitbjyki.supabase.co
REACT_APP_SUPABASE_ANON_KEY=<anon key>
DISABLE_ESLINT_PLUGIN=true
CI=false
```
