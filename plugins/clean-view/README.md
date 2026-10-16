# Clean View

Mod de Claude Code (0.1.0) para Claude Desktop (pestaña Code) y terminal.

## Qué hace

- **Panel sobre el cuadro de texto** mientras Claude trabaja: lista de pasos en español (con el activo marcado), tiempo transcurrido y estado general.
- Los pasos salen solo del plan real de la sesión (`TodoWrite`). Sin plan, el panel dice «Sin plan emitido por la sesión». No hay porcentajes inventados: el estado es «En curso».
- **Tres estados visibles**: Terminado (respuesta completa), Detenido (interrupción o error del turno) y Pendiente de mi respuesta (pregunta `AskUserQuestion` o permiso esperando decisión).
- **Vista simple** (`/simple on` | `/simple off`, o el botón del panel): oculta las filas técnicas de herramientas, sus resultados, los grupos de llamadas y el progreso. Se conservan siempre las filas con error o interrumpidas, las respuestas del asistente, las preguntas y las solicitudes de permiso (que dibuja el motor).
- Al desactivar, las filas vuelven a dibujarse. Nada de la transcripción se borra o reescribe: el mod solo cambia cómo se dibuja.
- La preferencia se guarda con `$.store` (clave `enabled`) y se restaura al iniciar una sesión. Valor por defecto: desactivada.

## Estructura

- `.claude-plugin/plugin.json`: manifiesto, versión 0.1.0, tipos en `types/index.d.ts`.
- `hooks/hooks.json`: módulo de hooks `./register.tsx`.
- `hooks/register.tsx`: hooks (`session.start`, `command.run`, `prompt.submit`, `turn.start`, `tool.check`, `tool.call`, `turn.complete`, `session.end`, `ui.render` de `ToolUse`, `ToolResult`, `ToolGroup`, `ToolProgress` y `AbovePrompt`).
- `hooks/logic.ts`: lógica pura (estados, filtrado de filas, pasos, formato de tiempo, parseo de preferencia y de `/simple`).
- `hooks/logic.test.ts`, `hooks/register.test.ts`: pruebas (`claude plugin test .`).
- `types/index.d.ts`: contrato de estado `clean-view` en `PluginState`.
- `tsconfig.json`: extiende los tipos que el motor escribe en `.claude-plugin/types/`.

## Instalación

```
/plugin install clean-view --marketplace r1305/claude-mods
```

## Uso

- `/simple on`: oculta las filas técnicas.
- `/simple off`: las restaura.
- `/simple` sin argumento: muestra el estado actual y el uso.
- Botón «Vista simple» en el panel: alterna lo mismo.

## Limitaciones conocidas

- Un permiso denegado no emite evento propio: el estado «Pendiente de mi respuesta» se limpia en la siguiente llamada de herramienta o al terminar el turno.
- El tiempo se refresca cada segundo mientras el turno está en curso; al terminar queda congelado.
- El panel permanece visible tras terminar o detener un turno hasta que se envía el siguiente mensaje.
- Un error del modelo que termina el turno se muestra como Detenido.
