// Centro de Operaciones: detecta proyectos y recalcula horas (commits), progreso (Obsidian), uso de las apps y tokens.
// Versión Node de actualizar.py + tokens.py (en el PC de David no hay Python).
//
// Uso: node actualizar.mjs [carpeta_salida]   (por defecto ./out junto a este archivo)
//
// Un repo de github.com/davidodo123 entra en el panel si tiene la marca `diario/Roadmap.md` (la bóveda de Obsidian
// del proyecto). Los de SIEMPRE entran aunque no la tengan. Escribe proyectos.json, proyectos_metricas.json,
// horas_dia.json, fases.json y tokens_dia.json. Los repos se clonan en ./repos (se reutilizan de un día a otro).
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { tokensPorDia } from "./tokens.mjs";

const AQUI = dirname(fileURLToPath(import.meta.url));
const USUARIO = "davidodo123";
const MARCA = "diario/Roadmap.md";
const SIEMPRE = { "Eat-em": "docs/PENDIENTE.md", StatsRun: MARCA }; // repo -> fichero de progreso si falta la marca
const EXTRA = ["Lifer"]; // por si la API de GitHub se deja alguno
const GAP = 2 * 3600; // commits a menos de 2 h = misma sesión
const ARRANQUE = 30 * 60; // cada sesión suma 30 min antes de su primer commit
const DIAS_ACTIVO = 21; // sin commits en 21 días -> Pausado
// resumen de uso de la app en producción (solo totales, sin datos personales) -> campos app_* de sus métricas
const RESUMEN_APP = { StatsRun: "https://run-in-out.vercel.app/api/admin/resumen" };

// sin preguntas de credenciales (un repo privado no se queda esperando) y con tiempo máximo
const git = (args, cwd) =>
  execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 64 << 20, timeout: 300_000, env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GCM_INTERACTIVE: "never" } });
const traza = (...a) => console.error(new Date().toISOString().slice(11, 19), ...a);
const hoyLocal = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const diasEntre = (a, b) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

async function reposDeGithub() {
  const nombres = new Set();
  for (let pagina = 1; pagina <= 5; pagina++) {
    const r = await fetch(`https://api.github.com/users/${USUARIO}/repos?per_page=100&page=${pagina}`, { headers: { "User-Agent": "centro-operaciones" }, signal: AbortSignal.timeout(30_000) }).catch(() => undefined);
    if (!r) break;
    if (!r.ok) break;
    const lista = await r.json();
    for (const x of lista) nombres.add(x.name);
    if (lista.length < 100) break;
  }
  return [...nombres];
}

async function tieneMarca(repo) {
  const r = await fetch(`https://raw.githubusercontent.com/${USUARIO}/${repo}/HEAD/${MARCA}`, { method: "HEAD", signal: AbortSignal.timeout(20_000) }).catch(() => undefined);
  return Boolean(r?.ok);
}

function clonar(base, repo) {
  const d = join(base, repo);
  if (existsSync(join(d, ".git"))) {
    try {
      git(["fetch", "-q", "--all"], d);
      git(["remote", "set-head", "origin", "-a"], d);
      git(["reset", "-q", "--hard", "origin/HEAD"], d);
      return d;
    } catch {
      // clon a medias (se cortó la primera vez): se borra y se clona de nuevo
      rmSync(d, { recursive: true, force: true });
    }
  }
  git(["clone", "-q", `https://github.com/${USUARIO}/${repo}.git`, d]);
  return d;
}

function horas(d) {
  // cada commit con su hora y la fecha en su propia zona horaria (los 10 primeros caracteres de %aI)
  const ts = git(["log", "--all", "--format=%aI"], d)
    .split(/\s+/)
    .filter(Boolean)
    .map((s) => ({ t: new Date(s), dia: s.slice(0, 10) }))
    .sort((a, b) => a.t - b.t);
  const dias = {};
  let total = 0;
  let sesiones = 0;
  let prev;
  for (const { t, dia } of ts) {
    let add;
    if (!prev || (t - prev) / 1000 > GAP) {
      add = ARRANQUE;
      sesiones++;
    } else add = (t - prev) / 1000;
    total += add;
    dias[dia] = (dias[dia] ?? 0) + add;
    prev = t;
  }
  return [
    {
      commits: ts.length,
      sesiones,
      horas: Math.round((total / 3600) * 10) / 10,
      primer_commit: ts.length ? ts[0].dia : null,
      ultimo_commit: ts.length ? ts.at(-1).dia : null,
    },
    dias,
  ];
}

const CASILLA = /^\s*[-*] \[(.)\]\s*(.*)/;
const limpiar = (txt) =>
  txt
    .replace(/\[\[([^\]|#]*)[^\]]*\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .replace(/^[ →\-—]+|[ →\-—]+$/g, "");

function roadmap(texto) {
  // [x] hecho, [/] empezado (medio), [ ] pendiente, [-] descartado (no cuenta). Fases = secciones '## '
  let fases = [];
  let actual = null;
  let siguiente = null;
  for (const linea of texto.split(/\r?\n/)) {
    if (linea.startsWith("## ")) {
      let titulo = linea.slice(3).replace(/\[\[.*?\]\]/g, "").split("—")[0].split("→")[0];
      titulo = titulo.replace(/[^\p{L}\p{N}_\s·.,()/:+-]/gu, "").replace(/^[ ·*]+|[ ·*]+$/g, "");
      actual = { fase: titulo, hechas: 0, total: 0 };
      fases.push(actual);
      continue;
    }
    const m = CASILLA.exec(linea);
    if (!m || !actual) continue;
    const c = m[1].toLowerCase();
    if (c === "-") continue;
    actual.total++;
    actual.hechas += c === "x" ? 1 : c === "/" ? 0.5 : 0;
    if ((c === " " || c === "/") && siguiente === null) siguiente = limpiar(m[2].split("—")[0]).slice(0, 160);
  }
  fases = fases.filter((f) => f.total);
  const h = fases.reduce((s, f) => s + f.hechas, 0);
  const t = fases.reduce((s, f) => s + f.total, 0);
  return [t ? Math.round((100 * h) / t) : null, `${Math.trunc(h)} de ${t} tareas del Roadmap (Obsidian)`, fases, siguiente];
}

function fasesPendiente(texto) {
  // Tabla '| Fase | Estado |' de PENDIENTE.md: ✅ = 1, 🟡 = 0,5, ⏳ = 0
  const fases = [];
  let siguiente = null;
  for (const linea of texto.split(/\r?\n/)) {
    const m = /^\|\s*(\d+)(?:\s*a\s*(\d+))?\.?\s*([^|]*)\|\s*([^|]*)\|/.exec(linea);
    if (!m) continue;
    const a = Number(m[1]);
    const b = Number(m[2] ?? m[1]);
    const v = m[4].includes("✅") ? 1 : m[4].includes("🟡") ? 0.5 : 0;
    for (let n = a; n <= b; n++) {
      const nombre = a === b ? m[3].trim().replace(/^[ .]+|[ .]+$/g, "") : "";
      const fase = `Fase ${n}` + (nombre ? ` · ${nombre}` : "");
      fases.push({ fase, hechas: v, total: 1 });
      if (v < 1 && siguiente === null) siguiente = `${fase} (${v ? "en curso" : "sin empezar"})`;
    }
  }
  const t = fases.length;
  const h = fases.reduce((s, f) => s + f.hechas, 0);
  const hechas = fases.filter((f) => f.hechas === 1).length;
  const curso = fases.filter((f) => f.hechas === 0.5).length;
  return [t ? Math.round((100 * h) / t) : null, `${hechas} de ${t} fases hechas, ${curso} en curso (PENDIENTE.md)`, fases, siguiente];
}

const leer = (d, ruta) => (existsSync(join(d, ruta)) ? readFileSync(join(d, ruta), "utf8") : "");

function descripcion(d) {
  // primer párrafo de texto de diario/Inicio.md o del README
  for (const ruta of ["diario/Inicio.md", "README.md"]) {
    let texto = leer(d, ruta).replace(/^﻿/, "").replace(/\r\n/g, "\n");
    texto = texto.replace(/^---\n[\s\S]*?\n---\n/, "");
    for (const parrafo of texto.split(/\n\s*\n/)) {
      let p = parrafo.trim();
      if (p && !/^(#|>|-|\*|\||```|<|!)/.test(p)) {
        p = limpiar(p);
        if (p.length > 280) {
          const corte = p.slice(0, 280).lastIndexOf(". ");
          p = corte > 80 ? p.slice(0, corte + 1) : p.slice(0, 277) + "…";
        }
        return p;
      }
    }
  }
  return "Sin descripción: añade un párrafo en diario/Inicio.md.";
}

function stack(d) {
  const partes = [];
  const pj = leer(d, "package.json");
  if (pj) {
    let deps = {};
    try {
      const j = JSON.parse(pj);
      deps = { ...j.dependencies, ...j.devDependencies };
    } catch {}
    const mapa = [
      ["next", "Next.js"], ["react-native", "React Native"], ["expo", "Expo"], ["react", "React"], ["vue", "Vue"], ["svelte", "Svelte"],
      ["@supabase/supabase-js", "Supabase"], ["@capacitor/core", "Capacitor"], ["@upstash/redis", "Redis"], ["prisma", "Prisma"],
      ["tailwindcss", "Tailwind"], ["express", "Express"],
    ];
    for (const [dep, nombre] of mapa)
      if (dep in deps && !(nombre === "React" && (partes.includes("Next.js") || partes.includes("React Native")))) partes.push(nombre);
  }
  const composer = leer(d, "composer.json");
  if (composer) partes.push(composer.includes("laravel/framework") ? "Laravel" : "PHP");
  if (leer(d, "requirements.txt") || leer(d, "pyproject.toml")) partes.push("Python");
  if (leer(d, "vercel.json") || leer(d, "diario/Configuración.md").toLowerCase().includes("vercel")) partes.push("Vercel");
  return [...new Set(partes)].join(" · ") || "Por definir";
}

async function resumenApp(repo) {
  // usuarios, activos, IA y copia de seguridad de la app; {} si no tiene o no responde
  const url = RESUMEN_APP[repo];
  if (!url) return {};
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(30_000) });
    if (!r.ok) return {};
    const j = await r.json();
    const copia = j.copia ?? {};
    return {
      app_usuarios: j.usuarios, app_activos7: j.activos7, app_nuevos_semana: j.nuevosSemana, app_entrenos_semana: j.entrenosSemana,
      app_ia_mensajes_hoy: j.iaMensajesHoy, app_ia_reajustes_hoy: j.iaReajustesHoy, app_fallos_ia: j.usuariosConFalloIA,
      app_datos_kb: j.datosKB, app_copia_ok: copia.ok ?? null, app_copia_fecha: copia.fecha ? copia.fecha.slice(0, 10) : null, app_leido: j.generado,
    };
  } catch {
    return {};
  }
}

async function main(salida) {
  const base = join(AQUI, "repos");
  mkdirSync(base, { recursive: true });
  mkdirSync(salida, { recursive: true });
  const repos = [...new Set([...Object.keys(SIEMPRE), ...EXTRA, ...(await reposDeGithub())])];
  const hoy = hoyLocal();
  const proyectos = [];
  const metricas = [];
  const horasDia = [];
  const fasesOut = [];
  traza(`${repos.length} repos candidatos`);
  for (const repo of repos) {
    const conMarca = await tieneMarca(repo);
    traza(repo, conMarca ? "con marca" : "sin marca");
    if (!conMarca && !(repo in SIEMPRE)) continue;
    let d;
    try {
      d = clonar(base, repo);
    } catch (e) {
      console.error(`No se pudo clonar ${repo}: ${e.message}`);
      continue;
    }
    const [g, dias] = horas(d);
    const fichero = conMarca ? MARCA : SIEMPRE[repo];
    const [pct, metodo, fases, siguiente] = (fichero === MARCA ? roadmap : fasesPendiente)(leer(d, fichero));
    const pid = repo.toLowerCase();
    const activo = g.ultimo_commit && diasEntre(g.ultimo_commit, hoy) <= DIAS_ACTIVO;
    proyectos.push({
      id: pid, nombre: repo, area: "Trabajo", estado: activo ? "Activo" : "Pausado", agente: "@dev", stack: stack(d), descripcion: descripcion(d),
      siguiente: siguiente || "Sin tareas pendientes en el Roadmap.", actualizado: hoy,
    });
    metricas.push({ id: pid, proyecto: repo, repo: `${USUARIO}/${repo}`, progreso: pct, metodo_progreso: metodo, ...g, calculado: hoy, ...(await resumenApp(repo)) });
    for (const [k, v] of Object.entries(dias).sort()) horasDia.push({ proyecto: repo, fecha: k, horas: Math.round((v / 3600) * 100) / 100 });
    for (const f of fases) fasesOut.push({ proyecto: repo, ...f, pct: Math.round((100 * f.hechas) / f.total) });
  }
  traza("tokens");
  const tokens = tokensPorDia(proyectos.map((p) => p.nombre));
  for (const [nombre, datos] of [["proyectos", proyectos], ["proyectos_metricas", metricas], ["horas_dia", horasDia], ["fases", fasesOut], ["tokens_dia", tokens]])
    writeFileSync(join(salida, `${nombre}.json`), JSON.stringify(datos, null, 1));
  console.log(
    JSON.stringify({
      proyectos: metricas.map((m) => ({ repo: m.proyecto, progreso: m.progreso, horas: m.horas, commits: m.commits, usuarios: m.app_usuarios })),
      tokens: { filas: tokens.length, total: tokens.reduce((s, x) => s + x.total, 0) },
    }),
  );
}

await main(process.argv[2] ?? join(AQUI, "out"));
