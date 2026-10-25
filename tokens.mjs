// Centro de Operaciones: tokens de Claude Code por día y por proyecto (versión Node de tokens.py, misma salida).
// Lee ~/.claude/projects (o $CLAUDE_CONFIG_DIR/projects): cada respuesta del modelo trae su `usage`.
// El proyecto sale de la carpeta de trabajo (`cwd`): si un tramo de la ruta coincide con un nombre de la lista
// (sin mayúsculas), cuenta para ese proyecto; si no, para el nombre de la carpeta. Fecha en hora local del PC.
// Uso suelto: node tokens.mjs <salida.json> [Proyecto1,Proyecto2,...]   (actualizar.mjs ya lo llama)
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const fechaLocal = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export function tokensPorDia(nombres) {
  const conocidos = new Map(nombres.map((n) => [n.toLowerCase(), n]));
  const base = process.env.CLAUDE_CONFIG_DIR ? join(process.env.CLAUDE_CONFIG_DIR, "projects") : join(homedir(), ".claude", "projects");
  const ficheros = [];
  const recorrer = (d) => {
    for (const n of readdirSync(d)) {
      const p = join(d, n);
      if (statSync(p).isDirectory()) recorrer(p);
      else if (n.endsWith(".jsonl")) ficheros.push(p);
    }
  };
  if (existsSync(base)) recorrer(base);

  const proyectoDe = (cwd) => {
    if (!cwd) return "Sin carpeta";
    const partes = String(cwd).split(/[\\/]+/).filter((p) => p && !p.endsWith(":"));
    for (const p of [...partes].reverse()) if (conocidos.has(p.toLowerCase())) return conocidos.get(p.toLowerCase());
    return partes.at(-1) ?? "Sin carpeta";
  };

  const vistos = new Set();
  const filas = new Map();
  for (const f of ficheros) {
    let cwdFichero;
    for (const linea of readFileSync(f, "utf8").split("\n")) {
      let r;
      try {
        r = JSON.parse(linea);
      } catch {
        continue;
      }
      if (!r || typeof r !== "object") continue;
      cwdFichero = r.cwd || cwdFichero;
      const msg = r.message;
      if (r.type !== "assistant" || !msg || typeof msg.usage !== "object" || !msg.usage) continue;
      if (msg.id != null || r.requestId != null) {
        // una respuesta se guarda en varias líneas: contarla una vez
        const clave = `${msg.id}|${r.requestId}`;
        if (vistos.has(clave)) continue;
        vistos.add(clave);
      }
      const t = new Date(String(r.timestamp));
      if (Number.isNaN(t.getTime())) continue;
      const n = (k) => Number.parseInt(msg.usage[k] ?? 0, 10) || 0;
      const fecha = fechaLocal(t);
      const proyecto = proyectoDe(r.cwd || cwdFichero);
      const k = `${fecha}|${proyecto}`;
      if (!filas.has(k)) filas.set(k, { fecha, proyecto, entrada: 0, salida: 0, cache_escritura: 0, cache_lectura: 0, respuestas: 0 });
      const fila = filas.get(k);
      fila.entrada += n("input_tokens");
      fila.salida += n("output_tokens");
      fila.cache_escritura += n("cache_creation_input_tokens");
      fila.cache_lectura += n("cache_read_input_tokens");
      fila.respuestas += 1;
    }
  }
  const datos = [...filas.values()].sort((a, b) => a.fecha.localeCompare(b.fecha) || a.proyecto.localeCompare(b.proyecto));
  for (const x of datos) x.total = x.entrada + x.salida + x.cache_escritura + x.cache_lectura;
  return datos;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [salida, lista = ""] = process.argv.slice(2);
  const datos = tokensPorDia(lista.split(",").map((s) => s.trim()).filter(Boolean));
  writeFileSync(salida, JSON.stringify(datos, null, 1));
  console.log(JSON.stringify({ filas: datos.length, total: datos.reduce((s, x) => s + x.total, 0) }));
}
