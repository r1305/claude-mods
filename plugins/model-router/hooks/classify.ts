import type { ModelRouterLevel } from '../types'

export const STRONG =
  /\barquitectur\w*|\barchitect\w*|\brediseñ\w*|\bredesign\w*|\broot cause\b|\bcausa ra[ií]z\b|\bsin causa\b|\bunknown cause\b|\bintermitentes?\b|\bflaky\b|\brace conditions?\b|\bcondici[oó]n(es)? de carrera\b|\bdeadlocks?\b|\bdebug\w*|\bdepur\w*|\binvestig\w*|\banaliz\w*|\boptimiz\w*|\brendimiento\b|\bperformance\b|\bN\+1\b|\bmulti-?(archivos?|files?|m[oó]dulos?|modules?)\b|\bvarios (archivos|m[oó]dulos)\b|\bacross (files|modules)\b/i

export const DOMAIN =
  /\bauth(n|z|entication|orization)?\b|\bautenticaci\w*|\bautorizaci\w*|\boauth\w*|\bjwt\b|\bpasswords?\b|\bcontraseñ\w*|\bpermis\w*|\bvulnerab\w*|\bcifrad\w*|\bencrypt\w*|\binyecci\w*|\binjection\b|\bIDOR\b|\bXSS\b|\bseguridad\b|\bsecurity\b|\bpagos?\b|\bpayments?\b|\bcheckout\b|\bbilling\b|\bcobros?\b|\bconcurren\w*|\btransacci\w*|\btransactions?\b|(?<![\w-])lock(s|ing)?\b|\bmigraci\w*|\bmigrations?\b|\brefactor\w*/i

export const SAFE = /\bcopias? de seguridad\b|\bbackups?\b/gi

export const CHANGE_VERB =
  /\bimplement\w*|\bintegr\w*|\brefactor\w*|\bcambi\w*|\bmodific\w*|\bañad\w*|\bagreg\w*|\bcrea(r|te|do|da)?\b|\badd\b|\bchange\b|\bfix\w*|\barregl\w*|\bcorrig\w*|\brewrite\b|\breescrib\w*|\bmigr\w*|\bredise\w*|\bescrib\w*|\bwrite\b|\bupdate\b|\bactualiz\w*|\belimin\w*|\bborra\w*|\bdelete\b|\bremove\b/i

export const STRONG_CHANGE =
  /\bcrea(r|n|s|te|ndo|do|da)?\b|\bcreat\w*|\bimplement\w*|\barregl\w*|\bagreg\w*|\bcorrig\w*|\bcorrij\w*|\brefactor\w*|\bmigr\w*|\bescrib\w*|\bescrit\w*|\bañad\w*|\bwrit(e|es|ing|ten)\b|\badd(s|ed|ing)?\b|\bfix\w*/i

export const WEAK_CHANGE =
  /\bactualiz\w*|\belimin\w*|\bcambi\w*|\bintegr(a|ar|an|e|en|ando)\b|\bmodific\w*|\bupdat(e|es|ed|ing)\b|\bchang(e|es|ed|ing)\b|\bdelet(e|es|ed|ing)\b|\bremov(e|es|ed|ing)\b/i

export const EDIT_OBJECT =
  /\barchivos?\b|\bfiles?\b|\bc[oó]digo\b|\bcode\b|\bcss\b|\bestilos?\b|\bstyles?\b|\bcomponentes?\b|\bcomponents?\b|\bendpoints?\b|\bfunci[oó]n(es)?\b|\bfunctions?\b|\btests?\b|\bconfig\w*|\bbase de datos\b|\bdatabase\b|\btablas?\b|\btables?\b|\brutas?\b|\broutes?\b/i

export const READ_START =
  /^\W*(busca|buscar|lee|leer|lista|listar|resume|resumir|explica|explicar|explora|explorar|mapea|mapear|d[oó]nde|cu[aá]l(es)?|qu[eé])\b/i

export const HARD_FAULT = /\bbugs?\b|\berror(es)?\b|\bfall(a|o|an)\b|\bcrash\w*/i

export const COSMETIC =
  /\btexto\b|\btext\b|\bcopy\b|\bcss\b|\bestilos?\b|\bstyles?\b|\bcolou?r\b|\btypo\b|\blabel\b|\betiqueta\b|\bbot[oó]n\b|\bbutton\b|\biconos?\b|\bicons?\b|\breadme\b|\bcomentarios?\b|\bcomments?\b/i

export const READ_ONLY =
  /\bbusca(r|ndo)?\b|\bsearch(es|ing)?\b|\bfind\b|\blocate\b|\bencuentra\b|\bd[oó]nde (est|se)\w*|\bwhere (is|are|does)\b|\blee\b|\bleer\b|\bread\b|\blist\b|\blista(r|do)?\b|\bexplora(r)?\b|\bexplore\b|\bresum\w*|\bsummar\w*|\bgrep\b|\bglob\b|\bmapea\w*/i

export const LIGHT_EDIT = /\brenombr\w*|\brename\b|\btypo\b/i

export const INVESTIGATE = /\bbugs?\b|\berror(es)?\b|\bfall(a|o|an)\b|\bpor qu[eé](?![a-z])|\bwhy\b|\bcrash\w*/i

export const MEDIUM =
  /\bimplement\w*|\bfeatures?\b|\bfuncionalidad\w*|\bendpoints?\b|\bcomponentes?\b|\bcomponents?\b|\btests?\b|\bprueba\w*|\bbugs?\b|\bfix\w*|\barregl\w*|\bcorrig\w*/i

export const ESCALATE =
  /\btras (dos|2|varios|m[uú]ltiples) intentos\b|\bsegundo intento\b|\btercer intento\b|\bafter (two|2|several|multiple) attempts\b|\bsigue fallando\b|\bstill failing\b/i

const ARCH = /\barquitectur\w*|\barchitect\w*|\bdiseñ\w*|\bdesign\w*|\brediseñ\w*|\bredesign\w*/i
const MULTI = /\bmulti-?(archivos?|files?|m[oó]dulos?|modules?)\b|\bvarios (archivos|m[oó]dulos)\b|\bacross (files|modules)\b/i
const RISK = /\bauth(n|z|entication|orization)?\b|\bautenticaci\w*|\bseguridad\b|\bsecurity\b|\bvulnerab\w*|\bpagos?\b|\bpayments?\b|\bcheckout\b|\bbilling\b|\bcobros?\b/i
const PROD = /\b(bd|db|base de datos|datos) (de |en )?prod\w*|\bproduction (db|database|data)\b|\bprod(uction)? (db|database|data)\b/i
const CONC = /\bconcurren\w*|\brace conditions?\b|\bcondici[oó]n(es)? de carrera\b|\bdeadlocks?\b|\btransacci\w*|\btransactions?\b/i

export const isGoat = (intro: string, all: string) =>
  ESCALATE.test(all) || (CHANGE_VERB.test(intro) && [ARCH.test(intro) && MULTI.test(intro), RISK.test(intro), PROD.test(intro), CONC.test(intro)].filter(Boolean).length >= 2)

export const head = (prompt: string) =>
  prompt
    .split(/[.!?\n]/)
    .filter(s => s.trim() !== '')
    .slice(0, 2)
    .join('. ')
    .slice(0, 400)

const clean = (s: string) => s.replace(SAFE, ' ')

export function classify(description: string, prompt: string): ModelRouterLevel {
  const desc = clean(description)
  const top = clean(head(prompt))
  const all = clean(`${description}\n${prompt}`)
  const isStrong = STRONG.test(all)
  const isChange = CHANGE_VERB.test(all)
  const isReadOnly = READ_ONLY.test(`${desc}\n${top}`) && !isChange && !INVESTIGATE.test(all) && !isStrong
  if (isReadOnly) return 'haiku'
  if (isGoat(`${desc}\n${top}`, all)) return 'fable'
  if (isStrong) return 'opus'
  const isCosmetic = COSMETIC.test(desc) || COSMETIC.test(top)
  if (!isCosmetic && (DOMAIN.test(desc) || (DOMAIN.test(top) && CHANGE_VERB.test(top)))) return 'opus'
  const isLight = (LIGHT_EDIT.test(all) || isCosmetic) && !MEDIUM.test(all) && !DOMAIN.test(`${desc}\n${top}`)
  if (isLight) return 'haiku'
  return 'sonnet'
}

const isReadTask = (description: string, prompt: string) => {
  const d = clean(description)
  const first = clean(prompt).trimStart().split(/[.!?\n]/)[0] ?? ''
  return READ_START.test(d) || READ_START.test(first) || READ_ONLY.test(`${d}\n${clean(head(prompt))}`)
}

export function classifyDefault(description: string, prompt: string): ModelRouterLevel {
  const level = classify(description, prompt)
  if (level === 'opus' || level === 'fable') return level
  const all = clean(`${description}\n${prompt}`)
  if (STRONG_CHANGE.test(all)) return 'sonnet'
  const readTask = isReadTask(description, prompt)
  if (!readTask && WEAK_CHANGE.test(all) && EDIT_OBJECT.test(all)) return 'sonnet'
  if (readTask) return HARD_FAULT.test(all) ? 'sonnet' : 'haiku'
  if (INVESTIGATE.test(all)) return 'sonnet'
  return 'haiku'
}
