# Model router

Mod de Claude Code (0.12.0) para Claude Desktop (pestaña Code) y terminal.

Elige el modelo (haiku, sonnet, opus o fable) de cada subagente según una tabla de suelos por agente, la complejidad de la tarea y los límites de uso de la cuenta. Muestra un único panel de cuotas y consumo: límites de 5 h y semanal, alertas, tokens por modelo y consumo por día y por sesión.

## Qué hace

- **Enrutado de subagentes**: reescribe el `model` de cada llamada Agent (salvo forks y agentes de flujo). Con uso alto baja un escalón; con uso crítico, todo a haiku salvo los suelos.
- **Panel principal** (pane `model-router`): estado del enrutado (Activo/Pausado y botón), semáforo, medidores de 5 h y semanal con «se reinicia en», un resumen de una línea con el modelo elegido para los subagentes en curso y el consumo de hoy y 7 días. Lo que ya muestra savvy-progress (plan, costo, contexto, tiempo por agente) no se repite. En el escritorio los medidores son barras SVG animadas de estilo neón: íconos animados (núcleo girando y check al terminar, reloj y escudo en límites, radar de esfuerzo, glifo por modelo), barra de tarea con un segmento por subagente, escaneo mientras corren y pulso al 100 %, modo oscuro por defecto y `prefers-reduced-motion`; en terminal, barras de texto con ◉/✓. El detalle de consumo (tokens por modelo exacto, por día, por sesión) está en `/quota`.
- **Tareas en progreso** (bloque siempre visible del panel): los subagentes del turno actual agrupados por modelo (Opus, Sonnet, Haiku; cabecera con su color, glifo y número de tareas) y una fila por tarea con descripción, esfuerzo en letra pequeña con color (low verde, medium ámbar, high/xhigh/max rojo, desconocido `—` gris; mismas constantes `EFFORT_COLOR` en escritorio y terminal) y estado (en curso, hecha, error); en curso primero dentro de cada grupo. Si el modelo de la sesión principal se conoce, añade la fila `Principal · <modelo> · <esfuerzo>`. Cada prompt nuevo reinicia la lista; sin subagentes muestra «Sin tareas en este turno».
- **Vista de tokens** (pane `model-router-tokens`, con `/model-router tokens` o la tecla `t` del panel): tokens de hoy y de 7 días por familia (Haiku, Sonnet, Opus, Otros, todas las sesiones con el mod) con barra de reparto semanal, y los tokens de esta sesión por nombre exacto de modelo, en filas con glifo y barra de reparto entre entrada, salida y caché. Se actualiza tras cada turno.
- **Historial de tareas** (pane `model-router-history`, con `/model-router historial` o la tecla `h` del panel): tareas ya completadas (hechas o con error) agrupadas por modelo (Opus, Sonnet, Haiku), las más recientes primero, con descripción, esfuerzo coloreado (bajo verde, medio ámbar, alto/xhigh/max rojo), estado y duración si hay. Es el historial de la sesión actual: el estado guarda hasta 200 tareas y no sobrevive a reinicios; no se persiste en disco.
- **Semáforo de niveles** con dos umbrales configurables, 80 % (aviso) y 90 % (crítico). Es el mismo para el panel, la línea de estado, el texto de uso y el enrutado.
- **Alertas** con aviso emergente al cruzar cada umbral, una vez por umbral y ventana.
- **Tokens por modelo** de la sesión, por nombre exacto de modelo, con entrada, salida y caché de lectura y escritura por separado.
- **Progreso de la tarea**: cuenta los subagentes lanzados en el turno actual y cuántos han terminado (`Tarea 2/5`, con barra y porcentaje). Se muestra en dos sitios: como bloque «Tarea en curso» del panel y como barra encima del cuadro de prompt, que avanza según terminan los subagentes. La barra está siempre visible: cada prompt nuevo reinicia la cuenta y, sin subagentes, muestra `Tarea 0/0 · en espera`; el bloque del panel aparece cuando el turno lanza el primero.
- **Esfuerzo**: indica el `effort` (low, medium, high, xhigh, max) con el que corre la sesión principal y la tarea, leído del `turn.step`. Cada subagente guarda también su esfuerzo.
- **Histórico** de 7 días por familia (haiku, sonnet, opus, otros), compartido entre sesiones con el mod.
- No hace llamadas a modelos, no usa procesos, no abre conexiones y no tiene temporizadores sin limpieza.

## Niveles de escalado

| Nivel | Modelo | Cuándo |
| --- | --- | --- |
| junior | haiku | lectura, búsqueda, cambios cosméticos |
| middle | sonnet | implementación normal |
| senior | opus | arquitectura, causa raíz, auth/seguridad, pagos, concurrencia, migraciones |
| goat | fable | escalado explícito («tras dos intentos», «sigue fallando») o dos señales duras juntas en la descripción o el inicio del prompt con verbo de cambio: diseño multiarchivo, seguridad/pagos, datos de producción, concurrencia/transacciones |

Cada tarea entra por su nivel y nunca pasa el techo del agente. Solo el agente `dev` tiene techo fable; el resto (plan, review, qa, explorer, tooling y genéricos) llega como máximo a opus. Con uso en aviso baja un escalón (fable → opus); un límite semanal de fable en aviso quita fable. En el panel las tareas fable aparecen en «Otros».

## Comandos

| Comando | Qué hace |
| --- | --- |
| `/model-router` | Abre el panel. |
| `/model-router on` / `off` | Activa o pausa el enrutado automático. |
| `/model-router tokens` | Abre la vista de tokens por modelo (pane `model-router-tokens`). |
| `/model-router historial` | Abre el historial de tareas completadas de la sesión (pane `model-router-history`). |
| `/model-router usage` | Resumen en texto: límites, alertas, tokens por modelo, hoy y 7 días. Abre el panel. |
| `/quota` | Alias de `/model-router usage`. |
| `/model-router alerts on` / `off` | Muestra u oculta los avisos emergentes. Los umbrales ya pasados siguen contando como avisados. |
| `/model-router umbrales <aviso> <crítico>` | Cambia los dos umbrales (enteros de 1 a 100, aviso menor que crítico). Ejemplo: `umbrales 70 85`. |

`/quota` es un segundo comando registrado, no un alias del motor: `CommandSpec` no admite alias. Responde igual que `/model-router usage` y, si lleva argumentos, los ignora.

## Umbrales y semáforo

| Nivel | Condición | Panel | Enrutado |
| --- | --- | --- | --- |
| normal | por debajo del aviso | verde, ● normal | sin cambio |
| aviso | desde el aviso (80 % por defecto) | amarillo, ▲ aviso | un escalón menos; sin opus si un límite de opus está en aviso |
| crítico | desde el crítico (90 % por defecto) | rojo, ■ crítico | todo a haiku salvo los suelos |

Las preferencias (alertas y umbrales) se guardan con `$.store` bajo la clave `prefs`. Si no existen, si no se pueden leer o si son inválidas (aviso no menor que crítico, valores fuera de 1 a 100), se usan 80 y 90.

**Cambio de comportamiento respecto a 0.5.2**: el enrutado bajaba a haiku al 95 % de uso general; ahora baja al umbral crítico configurado (90 % por defecto). El semáforo de 60 % y 95 % fijos ya no existe.

## Alertas

- Un aviso al cruzar el aviso y otro al cruzar el crítico, una sola vez por umbral y por ventana (5 h y semanal por separado).
- La ventana se reinicia cuando cambia su hora de reinicio o cuando baja el porcentaje; entonces los umbrales vuelven a poder avisar.
- Con las alertas ocultas, los umbrales se marcan igual: al mostrarlas de nuevo no se repiten.
- Se evalúan con el evento `session.measure` (tras cada turno o cuando una ventana sube un punto entero) y tras cada lectura de límites.
- Se cuenta con el porcentaje redondeado a una décima que se muestra: 79,96 % muestra «80 %» y ya cuenta como aviso.

## Cómo se mantienen los datos de límites

Un único lector: `$.session.usage()` se llama en un solo sitio (`refreshLimits`), y solo en estos momentos:

1. Al iniciar la sesión.
2. Al ejecutar `/model-router usage` o `/quota`.
3. Cada 30 s, mientras el panel está abierto. El temporizador se crea al dibujar el panel y se cancela al cerrarlo (`ui.close`) y al terminar la sesión (`session.end`).

Los demás caminos no leen el motor: `session.measure` entrega sus propias cifras de límites, `agent.spawn` usa el último dato guardado y dibujar el panel solo lee el estado. Cada lectura guarda límites, coste, contexto y alertas, y las alertas se evalúan una vez por lectura.

## Tokens

Un solo acumulador por nombre exacto de modelo, en el estado de la sesión: entrada, salida, caché de lectura y caché de escritura. Las cifras por familia del reparto y de la línea de consumo se derivan de él. La caché se conserva en todos los totales. El histórico de 7 días sigue agrupando por familia, como antes.

Las cifras cubren los turnos vistos desde que empezó la sesión; no se reconstruye el historial. Un hot reload del mod conserva el estado de la sesión (los tokens y las alertas siguen).

## Fuentes de datos

| Dato | Fuente | Notas |
| --- | --- | --- |
| Porcentaje y reinicio de 5 h y semanal | `$.session.usage()` y evento `session.measure` (`rateLimits`) | Las mismas cifras que el panel de uso del plan. Sin suscripción, muestran «Sin dato». |
| Tokens por modelo | evento `turn.complete` (`usage`) | Un turno con varios modelos se atribuye al último que respondió. Los turnos de subagentes también suman. |
| Coste y contexto | `$.session.usage()` y `session.measure` | El coste se muestra si el motor lo informa. |

## Estructura

- `.claude-plugin/plugin.json`: manifiesto, versión 0.12.0, contrato de estado en `types/index.d.ts`.
- `hooks/hooks.json`: módulo de hooks `./register.tsx`.
- `hooks/register.tsx`: hooks y cableado (`session.start`, `session.measure`, `turn.complete`, `agent.spawn`, `command.run` de `/model-router` y `/quota`, `ui.render` de los panes `model-router`, `model-router-tokens` y `model-router-history`, `prompt.compose`).
- `hooks/quota.ts`: lógica pura de límites, umbrales, alertas, preferencias, tokens por modelo y comandos.
- `hooks/route.ts`: enrutado por agente y bajadas por uso.
- `hooks/usage.ts`: formatos, semáforo, texto de uso, histórico por familia y líneas de estado.
- `hooks/view.tsx`: el panel, la barra de progreso, la vista de tokens y el historial.
- `hooks/progress.ts`: progreso y lista de tareas del turno.
- `hooks/*.test.ts`: pruebas (`claude plugin test .`).
- `types/index.d.ts`: contrato de estado del mod.

## Instalación y desarrollo

Instalar desde el marketplace:

```
/plugin install model-router --marketplace r1305/claude-mods
```

Carpeta de desarrollo: `dev-mods/<sesión>/model-router/` (recarga en caliente). En otra sesión: `claude --plugin-dir <ruta al mod>`.

```
claude plugin validate <ruta al mod>
claude plugin test <ruta al mod>
```

## Migración desde quota-watch

quota-watch queda retirado: su panel, alertas, tokens por modelo y `/quota` están en este mod. Sus preferencias guardadas (alertas y umbrales) no se importan: `$.store` es por mod, así que este mod arranca con 80 y 90 hasta que se configure. Si quota-watch sigue instalado junto a este mod, ambos registran `/quota`; retira uno de los dos.

## Limitaciones conocidas

- El pane lo coloca el motor. El mod no puede forzar el lado ni el ancho.
- Las alertas se disparan con `session.measure`, que llega tras cada turno, así que un aviso puede aparecer al final del turno y no en mitad de él.
- Los tokens cubren solo los turnos vistos desde que empezó la sesión.
- Si el motor no tiene lectura de ventanas, el panel y el texto muestran «Sin dato».
- El refresco de 30 s y la posición del pane solo se confirman en la app real.
