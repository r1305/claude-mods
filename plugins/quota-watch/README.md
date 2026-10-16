# Quota Watch

Mod de Claude Code (0.1.0) para Claude Desktop (pestaña Code) y terminal.

## Qué hace

- **Panel sobre el cuadro de texto** con el porcentaje usado de la ventana de 5 h y de la ventana semanal, su hora de reinicio y, si lo hay, el nivel (aviso o crítico). Sin dato del motor, muestra «Sin dato»; nunca inventa un porcentaje.
- **Alertas** al 80 % (aviso) y al 90 % (crítico) de cada ventana. Cada umbral avisa una sola vez por ventana; al resetearse la ventana (cambia la hora de reinicio o baja el porcentaje) las alertas vuelven a poder salir. El nivel y el aviso se calculan con el porcentaje redondeado que se muestra (una décima): 79,96 % muestra «80 %» y ya cuenta como aviso.
- **Tokens por modelo** de la sesión actual: entrada, salida, caché de lectura y caché de escritura, sumados por modelo y en total. Al iniciar una sesión nueva (o recargar el mod) empiezan de cero, igual que las alertas.
- **`/quota`** muestra todo bajo demanda y permite cambiar las preferencias.
- Preferencias (alertas visibles o no, umbrales) guardadas con `$.store`; si la lectura o la escritura falla, usa los valores por defecto.
- No hace llamadas a modelos, no usa procesos, no abre conexiones y no tiene temporizadores.

## Fuentes de datos

| Dato | Fuente del motor | Notas |
| --- | --- | --- |
| Porcentaje y reinicio de 5 h y semanal | `$.session.usage()` al iniciar y evento `session.measure` (`rateLimits`) | Las mismas cifras que el panel de uso del plan. Sin suscripción, o antes de la primera lectura, quedan como «Sin dato». |
| Tokens por modelo | evento `turn.complete` (`usage`: entrada, salida, caché y modelo) | Solo cuenta los turnos de la sesión actual, desde su inicio. Un turno que usó varios modelos se atribuye al último que respondió (así lo define el motor en `TurnUsage`). Los turnos de subagentes también suman. |
| Total de la sesión en dólares | no se muestra | El motor expone `cost` en `$.session.usage()`; no se incluyó por no pedirse. |

## Estructura

- `.claude-plugin/plugin.json`: manifiesto, versión 0.1.0, contrato de estado en `types/index.d.ts`.
- `hooks/hooks.json`: módulo de hooks `./register.tsx`.
- `hooks/register.tsx`: hooks (`session.start`, `session.measure`, `turn.complete`, `command.run` de `/quota`, `ui.render` de `AbovePrompt`) y estado en átomos.
- `hooks/logic.ts`: lógica pura: ventanas, alertas, tokens, formato, preferencias y parseo de `/quota`. Los umbrales por defecto (`DEFAULT_PREFS`: 80 % y 90 %) están solo aquí.
- `hooks/logic.test.ts`, `hooks/register.test.ts`: pruebas (`claude plugin test .`).
- `types/index.d.ts`: contrato de estado `quota-watch` en `PluginState`.
- `tsconfig.json`: configuración propia; incluye los tipos que el motor escribe en `.claude-plugin/types/` (aparecen al cargar el mod) y `hooks/`, `types/`.

## Uso

- `/quota`: estado de las ventanas, alertas, tokens por modelo y uso.
- `/quota alerts on` | `/quota alerts off`: muestra u oculta los avisos emergentes. Los umbrales ya pasados siguen contando como avisados.
- `/quota umbrales 70 85`: cambia el aviso y el crítico (entre 1 y 100, aviso menor que crítico).

## Instalación y desarrollo

Instalar desde el marketplace:

```
/plugin install quota-watch --marketplace r1305/claude-mods
```

Carpeta de desarrollo: `dev-mods/<sesión>/quota-watch/` (recarga en caliente). En otra sesión: `claude --plugin-dir <ruta al mod>`.

```
claude plugin validate <ruta al mod>
claude plugin test <ruta al mod>
```

## Limitaciones conocidas

- Si el motor no tiene lectura de ventanas (cuenta sin suscripción, o API sin cifras), el panel y `/quota` muestran «Sin dato».
- Las alertas se disparan con el evento `session.measure`, que el motor emite tras cada turno y cuando una ventana sube un punto entero. Un aviso puede llegar al final del turno y no en mitad de él.
- Los tokens cubren solo los turnos vistos desde que empezó la sesión; no se reconstruye su historial.
- Las alertas se guardan en la memoria de la sesión: al iniciar otra sesión vuelven a evaluarse desde cero, que es lo esperado al resetearse la ventana.
