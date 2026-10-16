import { test, expect } from 'claude-code/testing'

import { DOMAIN, classify, classifyDefault } from './classify'
import { applyUsage, route, routeNote, usageState } from './route'

const LONG_SEARCH = `Lista todos los archivos que usan el helper de fechas y resume en qué módulo está cada uno. ${'Incluye rutas, nombres de funciones y el número de línea de cada llamada encontrada en el repositorio. '.repeat(15)}`

test('classify: search tasks stay cheap even with sensitive topics or long prompts', () => {
  expect(classify('Buscar validación', 'busca dónde se valida el password')).toBe('haiku')
  expect(classify('Listar usos', LONG_SEARCH)).toBe('haiku')
  expect(LONG_SEARCH.length).toBeGreaterThan(600)
  expect(classify('Explorar', 'explora el proyecto y mapea las rutas de autenticación')).toBe('haiku')
})

test('classify: complex work goes to opus', () => {
  expect(classify('Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos en varios archivos')).toBe('opus')
  expect(classify('Investigar fallo', 'investiga la causa raíz del error intermitente al guardar')).toBe('opus')
  expect(classify('Login', 'implementa el cambio de contraseña con JWT')).toBe('opus')
})

test('classify: word boundaries avoid false positives', () => {
  expect(DOMAIN.test('update the author name')).toBe(false)
  expect(DOMAIN.test('authorship of the doc')).toBe(false)
  expect(DOMAIN.test('add auth to the route')).toBe(true)
  expect(classify('Update author field', 'update the author name in the footer')).not.toBe('opus')
  expect(classify('Actualizar package-lock', 'regenera package-lock.json')).not.toBe('opus')
})

test('classify: the complexity signal is read in the whole prompt, not only the first sentence', () => {
  const p = `Actualiza el listado de clientes. ${'Mantén el formato actual de la tabla. '.repeat(10)}Antes de tocar nada busca la causa raíz del deadlock que aparece al guardar.`
  expect(classify('Listado', p)).toBe('opus')
})

test('route: named agents keep their floor and ceiling', () => {
  expect(route('review', 'Buscar usos', 'busca donde se usa el helper', []).model).toBe('sonnet')
  expect(route('review', 'Revisar cambios', 'revisa el diff de la rama', []).model).toBe('opus')
  expect(route('qa', 'Validar', 'valida que compila y pasa los tests', []).model).toBe('haiku')
  expect(route('qa', 'Validar con BD prod', 'valida el cambio contra la BD prod', []).model).toBe('sonnet')
  expect(route('qa', 'Limpieza', 'limpieza de registros de prueba', []).model).toBe('sonnet')
  expect(route('qa', 'Refactor de pagos multiarchivo', 'valida el refactor de pagos multiarchivo', []).model).toBe('sonnet')
  expect(route('explorer', 'Mapa nuevo', 'explora el proyecto y crea su mapa', []).model).toBe('sonnet')
  expect(route('explorer', 'Actualizar mapa', 'actualiza el mapa del proyecto', []).model).toBe('haiku')
  expect(route('tooling', 'Actualizar skill', 'actualiza el skill existente con el nuevo puerto', []).model).toBe('sonnet')
  expect(route('tooling', 'Actualizar skill', 'actualiza el skill existente con el puerto 3000', []).model).toBe('haiku')
  expect(route('dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos', []).model).toBe('opus')
  expect(route('dev', 'Cambiar color', 'cambia el color del botón en css', []).model).toBe('haiku')
  expect(route('Plan', 'Plan de migración', 'diseña la arquitectura de la migración', []).model).toBe('opus')
  expect(route('general-purpose', 'Buscar validación', 'busca dónde se valida el password', []).model).not.toBe('opus')
  expect(route('Explore', 'Buscar', LONG_SEARCH, []).model).toBe('haiku')
})

test('route: an explicit model is recorded, not obeyed', () => {
  const d = route('general-purpose', 'Buscar archivos', 'busca donde esta el login', [], 'opus')
  expect(d.model).toBe('haiku')
  expect(d.reason).toContain('pedido opus (ignorado)')
})

test('usage: review never drops under sonnet', () => {
  for (const p of [0, 50, 80, 90, 95, 99]) {
    expect(route('review', 'Buscar', 'busca el helper', [{ kind: 'five_hour', percentUsed: p }]).model).not.toBe('haiku')
    expect(route('review', 'Revisar', 'revisa el diff', [{ kind: 'seven_day', percentUsed: p }]).model).not.toBe('haiku')
  }
})

test('usage: weekly opus at 80% or more removes opus', () => {
  const lim = [{ kind: 'five_hour', percentUsed: 10 }, { kind: 'seven_day_opus', percentUsed: 82 }]
  expect(route('dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos', lim).model).toBe('sonnet')
  expect(route('review', 'Revisar', 'revisa el diff', lim).model).toBe('sonnet')
  expect(routeNote(lim).text).toContain('sin opus')
})

test('usage: 80% general drops one step, 95% sends everything to haiku except the floor', () => {
  const high = [{ kind: 'seven_day', percentUsed: 85 }]
  expect(route('dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos', high).model).toBe('sonnet')
  expect(route('dev', 'Endpoint', 'implementa el endpoint nuevo y sus tests', high).model).toBe('haiku')
  expect(route('review', 'Revisar', 'revisa el diff', high).model).toBe('sonnet')
  const crit = [{ kind: 'five_hour', percentUsed: 96 }]
  expect(route('dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos', crit).model).toBe('haiku')
  expect(route('qa', 'Validar con BD prod', 'valida el cambio contra la BD prod', crit).model).toBe('haiku')
  expect(route('review', 'Revisar', 'revisa el diff', crit).model).toBe('sonnet')
  expect(route('Plan', 'Plan', 'diseña la arquitectura', crit).model).toBe('haiku')
  expect(routeNote(crit).level).toBe('critical')
  expect(routeNote(crit).text).toContain('todo a haiku salvo suelos')
})

test('usage: without data nothing is lowered and the note says so', () => {
  expect(usageState(undefined).hasData).toBe(false)
  expect(usageState([{ kind: 'spend_limit', percentUsed: 99 }]).hasData).toBe(false)
  expect(applyUsage('opus', 'haiku', usageState([])).level).toBe('opus')
  expect(route('dev', 'Refactor de pagos multiarchivo', 'refactoriza el módulo de pagos', []).reason).toContain('sin datos de uso')
  expect(routeNote([]).text).toContain('sin datos de uso')
  expect(routeNote([{ kind: 'five_hour', percentUsed: 20 }]).text).toBe('elige el modelo de todos los subagentes')
})

test('default rule: unclassified agents start at haiku, change verbs go to sonnet, strong signals to opus', () => {
  for (const t of ['general-purpose', 'Explore', 'some-plugin:agent', '']) {
    expect(route(t, 'Buscar', 'busca donde esta el login', []).model).toBe('haiku')
    expect(route(t, 'Leer', 'lee el archivo de configuracion', []).model).toBe('haiku')
    expect(route(t, 'Listar', 'lista los endpoints existentes', []).model).toBe('haiku')
    expect(route(t, 'Resumir', 'resume el modulo de fechas', []).model).toBe('haiku')
    expect(route(t, 'Implementar', 'implementa el helper de fechas', []).model).toBe('sonnet')
    expect(route(t, 'Crear', 'crea el archivo de utilidades', []).model).toBe('sonnet')
    expect(route(t, 'Arreglar', 'arregla el formulario', []).model).toBe('sonnet')
    expect(route(t, 'Fix', 'fix the date helper', []).model).toBe('sonnet')
    expect(route(t, 'Cambiar color', 'cambia el color del boton en css', []).model).toBe('sonnet')
    expect(route(t, 'Investigar', 'investiga la causa raiz del error intermitente', []).model).toBe('opus')
    expect(route(t, 'Arquitectura', 'rediseña la arquitectura del modulo', []).model).toBe('opus')
  }
  expect(route('general-purpose', 'Buscar', LONG_SEARCH, []).model).toBe('haiku')
  expect(classifyDefault('Listar', 'lista los archivos')).toBe('haiku')
})

test('default rule: usage limits still apply', () => {
  expect(route('Explore', 'Implementar', 'implementa el helper', [{ kind: 'five_hour', percentUsed: 85 }]).model).toBe('haiku')
  expect(route('Explore', 'Investigar', 'investiga la causa raiz del error', [{ kind: 'five_hour', percentUsed: 85 }]).model).toBe('sonnet')
  expect(route('Explore', 'Investigar', 'investiga la causa raiz del error', [{ kind: 'five_hour', percentUsed: 96 }]).model).toBe('haiku')
})
