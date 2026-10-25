# Centro de Operaciones · datos

Datos diarios del panel «Centro de Operaciones» de David y los scripts que los generan.

- `actualizar.mjs`: por cada repo de github.com/davidodo123 con `diario/Roadmap.md`, calcula horas (por sesiones de commits), progreso (casillas del Roadmap de Obsidian) y fases; para Run-In-Out añade su uso (`/api/admin/resumen`, solo totales). También llama a `tokens.mjs`.
- `tokens.mjs`: tokens de Claude Code por día y proyecto, leídos de los registros locales.
- `ejecutar.ps1`: lo lanza el Programador de tareas de Windows cada noche a las 22:30; recalcula y sube `out/`.
- `out/`: los cinco JSON que la tarea de la nube pone en el panel a las 22:52.
- `INSTRUCCIONES-TAREA.txt`: las instrucciones de esa tarea.

Nada de claves ni datos personales: solo cifras de proyectos públicos, tokens y totales de uso.
