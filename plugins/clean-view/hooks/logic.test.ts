import { test, expect } from 'claude-code/testing'

import { addPending, dropPending, formatElapsed, isPendingVerdict, keepGroup, keepRow, markOf, panelState, panelVisible, parseCommand, parsePref, stepsOf, turnEnd } from './logic'

test('pending permissions are a set: finishing one call keeps the others waiting', () => {
  const two = addPending(addPending([], 'c1'), 'c2')
  expect(two).toEqual(['c1', 'c2'])
  expect(addPending(two, 'c1')).toEqual(['c1', 'c2'])
  expect(dropPending(two, 'c1')).toEqual(['c2'])
  expect(dropPending(dropPending(two, 'c1'), 'c2')).toEqual([])
  expect(dropPending(two, 'x')).toEqual(['c1', 'c2'])
  expect(panelState('running', dropPending(two, 'c1').length > 0)).toBe('pendiente')
})

test('panel state: idle hides, running is en curso, a pending answer wins, end reasons map to done or stopped', () => {
  expect(panelState('idle', false)).toBe('inactivo')
  expect(panelState('running', false)).toBe('en-curso')
  expect(panelState('running', true)).toBe('pendiente')
  expect(panelState('done', false)).toBe('terminado')
  expect(panelState('stopped', false)).toBe('detenido')
  expect(turnEnd('answer')).toBe('done')
  expect(turnEnd('aborted')).toBe('stopped')
  expect(turnEnd('error')).toBe('stopped')
  expect(turnEnd('refusal')).toBe('stopped')
})

test('the panel is drawn only with something real: a running turn, steps, a pending answer or a stopped turn', () => {
  expect(panelVisible('idle', false, false)).toBe(false)
  expect(panelVisible('done', false, false)).toBe(false)
  expect(panelVisible('running', false, false)).toBe(true)
  expect(panelVisible('idle', false, true)).toBe(false)
  expect(panelVisible('done', false, true)).toBe(true)
  expect(panelVisible('done', true, false)).toBe(true)
  expect(panelVisible('stopped', false, false)).toBe(true)
})

test('turno idle: residual steps never draw the panel, a pending answer or permission always does', () => {
  expect(panelVisible('idle', false, true)).toBe(false)
  expect(panelVisible('idle', true, false)).toBe(true)
  expect(panelVisible('idle', true, true)).toBe(true)
  expect(panelState('idle', true)).toBe('pendiente')
  expect(panelState('idle', false)).toBe('inactivo')
  expect(panelVisible('running', false, false)).toBe(true)
})

test('a permission verdict is pending only when it asks the person', () => {
  expect(isPendingVerdict('ask')).toBe(true)
  expect(isPendingVerdict('allow')).toBe(false)
  expect(isPendingVerdict('deny')).toBe(false)
})

test('rows that carry an error or an interruption are kept, the rest hide', () => {
  expect(keepRow({ isErrored: true })).toBe(true)
  expect(keepRow({ isInterrupted: true })).toBe(true)
  expect(keepRow({ isErrored: false, isInterrupted: false })).toBe(false)
  expect(keepRow({})).toBe(false)
  expect(keepGroup([{ isErrored: false }, { isErrored: true }])).toBe(true)
  expect(keepGroup([{ isErrored: false }, { isInterrupted: false }])).toBe(false)
  expect(keepGroup([])).toBe(false)
})

test('stepsOf reads only well-formed TodoWrite rows and never invents one', () => {
  expect(stepsOf(undefined)).toEqual([])
  expect(stepsOf({ todos: 'no' })).toEqual([])
  expect(
    stepsOf({
      todos: [
        { content: 'Leer el código', status: 'completed', activeForm: 'Leyendo el código' },
        { content: 'Escribir tests', status: 'in_progress', activeForm: 'Escribiendo tests' },
        { content: '', status: 'pending', activeForm: 'x' },
        { content: 'Revisar', status: 'bogus', activeForm: 'x' },
        { content: 'Publicar', status: 'pending' },
      ],
    }),
  ).toEqual([
    { content: 'Leer el código', status: 'completed', activeForm: 'Leyendo el código' },
    { content: 'Escribir tests', status: 'in_progress', activeForm: 'Escribiendo tests' },
    { content: 'Publicar', status: 'pending', activeForm: 'Publicar' },
  ])
  expect(markOf('pending')).toBe('[ ]')
  expect(markOf('in_progress')).toBe('[>]')
  expect(markOf('completed')).toBe('[x]')
})

test('the /simple argument parses on and off only', () => {
  expect(parseCommand('on')).toBe('on')
  expect(parseCommand(' OFF ')).toBe('off')
  expect(parseCommand('')).toBeUndefined()
  expect(parseCommand('quizá')).toBeUndefined()
})

test('the stored preference falls back to off when it is not a boolean', () => {
  expect(parsePref(true)).toBe(true)
  expect(parsePref(false)).toBe(false)
  expect(parsePref(undefined)).toBe(false)
  expect(parsePref('on')).toBe(false)
  expect(parsePref({ enabled: true })).toBe(false)
})

test('elapsed time reads as mm:ss and h:mm:ss, never negative', () => {
  expect(formatElapsed(0)).toBe('00:00')
  expect(formatElapsed(65_900)).toBe('01:05')
  expect(formatElapsed(3_723_000)).toBe('1:02:03')
  expect(formatElapsed(-5_000)).toBe('00:00')
})
