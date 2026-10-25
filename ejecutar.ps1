# Centro de Operaciones, parte del PC: lo lanza cada noche (22:30) el Programador de tareas de Windows.
# Recalcula los datos con actualizar.mjs y los sube a GitHub (davidodo123/centro-operaciones, carpeta out/).
# A las 22:52 la tarea de la nube «Actualizar Centro de Operaciones» los descarga y los pone en el panel.
$dir = "C:\Users\david\centro-operaciones"
Set-Location $dir
$registro = Join-Path $dir "registro.txt"
function Apuntar($texto) { Add-Content -Path $registro -Encoding utf8 -Value $texto }
$env:GIT_TERMINAL_PROMPT = "0"
$env:GCM_INTERACTIVE = "never"

Apuntar "==== $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss') ===="
git pull -q --rebase 2>&1 | ForEach-Object { Apuntar "$_" }
node actualizar.mjs 2>&1 | ForEach-Object { Apuntar "$_" }
if ($LASTEXITCODE -ne 0) { Apuntar "actualizar.mjs falló: no se sube nada"; exit 1 }
git add out 2>&1 | Out-Null
git diff --cached --quiet
if ($LASTEXITCODE -eq 0) { Apuntar "Sin cambios en los datos"; exit 0 }
git commit -q -m "Datos del $(Get-Date -Format 'yyyy-MM-dd')" 2>&1 | ForEach-Object { Apuntar "$_" }
git push -q 2>&1 | ForEach-Object { Apuntar "$_" }
Apuntar "Subido"
