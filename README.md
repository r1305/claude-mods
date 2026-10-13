# claude-mods

Dos mods (plugins) para [Claude Code](https://claude.com/claude-code), instalables como marketplace desde este repositorio.

| Mod | Qué hace |
|-----|----------|
| `model-router` | Elige el modelo (haiku/sonnet/opus) para los subagentes genéricos (`general-purpose`, `Explore`) que no traen modelo propio, para ahorrar tokens. Muestra un panel en vivo con las tareas, los límites de tu plan y el consumo de tokens por día y por sesión. |
| `session-link` | Comunica sesiones paralelas de Claude Code: panel de sesiones activas, mensajes entre ellas y una pizarra compartida para publicar contratos, esquemas o decisiones. |

## Qué hace cada mod

### model-router

- Clasifica cada subagente genérico por su descripción/prompt: tareas simples a `haiku`, normales a `sonnet`, y solo lo delicado (arquitectura, auth/seguridad, pagos, concurrencia/transacciones, migraciones...) a `opus`. Nunca pisa un modelo que ya venga fijado ni las tablas de modelos de tu `CLAUDE.md`.
- Panel con tres pestañas: **Resumen**, **Tareas** y **Consumo**.
- Los porcentajes de límites son los oficiales de tu cuenta; los tokens son los que cuenta el mod (solo sesiones con model-router).

Ejemplo del texto de `/model-router usage`:

```
Hoy: 3,5 k tokens (Haiku 14 % · Opus 86 %)
Últimos 7 días: 4,5 k tokens
Los % de límites son los oficiales de tu cuenta; los tokens son los que contó este mod (las sesiones sin model-router no aparecen).
```

### session-link

- Cada sesión publica su presencia; las demás la ven en el panel y en `/link who`.
- Mensajes directos entre sesiones (usa `SendMessage`/`ListAgents` nativos como transporte).
- Pizarra compartida por temas (`/link share`), agrupada por proyecto, con barras de actividad.

Ejemplo (texto del panel):

```
★ proyecto-a · proyecto-a   ahora   71%
  proyecto-b · proyecto-b   1 min   14%
<- proyecto-b 12:03  el endpoint cambio a /v2/pedidos
-> proyecto-b-session 12:05  ok, lo uso
▪ proyecto-a  █████░░░░░  2  50%
  api GET /pedidos devuelve {id} · proyecto-a · hace 1 h
```

## Requisitos

- Una versión de Claude Code con soporte de mods (plugins con function hooks `ui.render`/`session`...). Probado con **Claude Code 2.1.296**.
- Windows, macOS o Linux.

## Instalación A (recomendada)

Desde una terminal con `claude` (la pestaña Code de la app de escritorio **no** admite `/plugin`; un plugin instalado así a nivel usuario se carga también en la app de escritorio):

```
/plugin install model-router --marketplace r1305/claude-mods
/plugin install session-link --marketplace r1305/claude-mods
```

Responde `y` para añadir el marketplace y elige el scope **user**.

## Instalación B (clonar)

Útil para la app de escritorio o para modificarlos:

```
git clone https://github.com/r1305/claude-mods
```

Añade en `~/.claude/settings.json`, dentro de `env`:

```json
{
  "env": {
    "CLAUDE_CODE_PLUGIN_DIRS": "<ruta>/claude-mods/plugins/model-router;<ruta>/claude-mods/plugins/session-link"
  }
}
```

El separador es `;` en Windows y `:` en macOS/Linux. Reinicia las sesiones. Alternativa para probar: `claude --plugin-dir <ruta>/claude-mods/plugins/model-router`.

## Comandos

| Comando | Efecto |
|---------|--------|
| `/model-router` | Abre el panel |
| `/model-router usage` | Resumen de consumo (hoy, 7 días) |
| `/model-router on` / `off` | Activa/desactiva el enrutado automático |
| `/link` | Abre el panel y muestra la ayuda |
| `/link who` | Sesiones activas y su destino en `ListAgents` |
| `/link send <destino> <texto>` | Mensaje directo a otra sesión |
| `/link share <tema>: <texto>` | Publica en la pizarra (se rechazan textos que parecen secretos) |
| `/link name <nombre>` | Cambia la etiqueta de esta sesión |

El panel de model-router cambia de pestaña con `1` Resumen, `2` Tareas, `3` Consumo; `p` pausa o reactiva el enrutado (también hay botones clicables en el panel).

## Privacidad

- **session-link** guarda presencia y pizarra en **texto plano** en `~/.claude/session-link/` (o `$CLAUDE_CONFIG_DIR/session-link/`), legible por todas tus sesiones. Filtra textos que parecen secretos (claves, tokens, passwords, cadenas de alta entropía) y las entradas caducan a los **7 días**. No publiques información sensible.
- **model-router** guarda solo contadores de tokens por sesión/día en `~/.claude/model-router/usage/`. No guarda prompts.
- Ninguno envía datos a servidores externos.

## Limitaciones conocidas

- La pestaña Code de la app de escritorio no puede ejecutar `/plugin`; instala desde terminal o usa la instalación B.
- Los tokens de model-router solo cuentan sesiones donde el mod está activo.
- La clasificación de modelo es heurística (palabras clave); revisa las tablas de modelos de tu proyecto si necesitas control fino.
- API de mods en evolución: puede requerir ajustes con versiones nuevas de Claude Code.

## Desinstalar

```
/plugin uninstall model-router
/plugin uninstall session-link
```

Si usaste la instalación B, quita `CLAUDE_CODE_PLUGIN_DIRS` de `settings.json`. Opcional: borra `~/.claude/session-link/` y `~/.claude/model-router/`.

## Tests y validación

```
claude plugin validate .
claude plugin validate plugins/model-router
claude plugin test plugins/model-router     # 41 tests
claude plugin validate plugins/session-link
claude plugin test plugins/session-link     # 32 tests
```

Los tipos (`.claude-plugin/types/`) los genera el motor de Claude Code y no se versionan; cada plugin tiene un `tsconfig.json` que los extiende, así que el type-check funciona tras cargar el plugin una vez con Claude Code.

Licencia: MIT.

---

## English summary

`claude-mods` is a Claude Code plugin marketplace with two mods:

- **model-router**: picks haiku/sonnet/opus for generic subagents and shows a live dashboard (tasks, plan limits, token usage per day/session).
- **session-link**: messaging and a shared board between parallel Claude Code sessions.

Install from a terminal `claude` session (not supported in the desktop Code tab, but user-scope installs load there too):

```
/plugin install model-router --marketplace r1305/claude-mods
/plugin install session-link --marketplace r1305/claude-mods
```

Or clone the repo and set `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json` (`;` on Windows, `:` elsewhere). Tested with Claude Code 2.1.296. session-link stores its board as plain text in `~/.claude/session-link/` (secret filter, 7-day expiry). MIT licensed.
