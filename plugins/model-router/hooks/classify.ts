import type { ModelRouterLevel } from '../types'

export const STRONG =
  /\barquitectur\w*|\barchitect\w*|\brediseñ\w*|\bredesign\w*|\broot cause\b|\bcausa ra[ií]z\b|\bsin causa\b|\bunknown cause\b|\bintermitentes?\b|\bflaky\b|\brace conditions?\b|\bcondici[oó]n(es)? de carrera\b|\bdeadlocks?\b|\bdebug\w*|\bdepur\w*|\binvestig\w*|\banaliz\w*|\boptimiz\w*|\brendimiento\b|\bperformance\b|\bN\+1\b|\bmulti-?(archivos?|files?|m[oó]dulos?|modules?)\b|\bvarios (archivos|m[oó]dulos)\b|\bacross (files|modules)\b/i

export const DOMAIN =
  /\bauth(n|z|entication|orization)?\b|\bautenticaci\w*|\bautorizaci\w*|\boauth\w*|\bjwt\b|\bpasswords?\b|\bcontraseñ\w*|\bpermis\w*|\bvulnerab\w*|\bcifrad\w*|\bencrypt\w*|\binyecci\w*|\binjection\b|\bIDOR\b|\bXSS\b|\bseguridad\b|\bsecurity\b|\bpagos?\b|\bpayments?\b|\bcheckout\b|\bbilling\b|\bcobros?\b|\bconcurren\w*|\btransacci\w*|\btransactions?\b|(?<![\w-])lock(s|ing)?\b|\bmigraci\w*|\bmigrations?\b|\brefactor\w*/i

export const SAFE = /\bcopias? de seguridad\b|\bbackups?\b/gi

export const CHANGE_VERB =
  /\bimplement\w*|\bintegr\w*|\brefactor\w*|\bcambi\w*|\bmodific\w*|\bañad\w*|\bagreg\w*|\bcrea(r|te|do|da)?\b|\badd\b|\bchange\b|\bfix\w*|\barregl\w*|\bcorrig\w*|\brewrite\b|\breescrib\w*|\bmigr\w*|\bredise\w*|\bescrib\w*|\bwrite\b|\bupdate\b|\bactualiz\w*|\belimin\w*|\bborra\w*|\bdelete\b|\bremove\b/i

export const COSMETIC =
  /\btexto\b|\btext\b|\bcopy\b|\bcss\b|\bestilos?\b|\bstyles?\b|\bcolou?r\b|\btypo\b|\blabel\b|\betiqueta\b|\bbot[oó]n\b|\bbutton\b|\biconos?\b|\bicons?\b|\breadme\b|\bcomentarios?\b|\bcomments?\b/i

export const READ_ONLY =
  /\bbusca(r|ndo)?\b|\bsearch(es|ing)?\b|\bfind\b|\blocate\b|\bencuentra\b|\bd[oó]nde (est|se)\w*|\bwhere (is|are|does)\b|\blee\b|\bleer\b|\bread\b|\blist\b|\blista(r|do)?\b|\bexplora(r)?\b|\bexplore\b|\bresum\w*|\bsummar\w*|\bgrep\b|\bglob\b|\bmapea\w*/i

export const LIGHT_EDIT = /\brenombr\w*|\brename\b|\btypo\b/i

export const INVESTIGATE = /\bbugs?\b|\berror(es)?\b|\bfall(a|o|an)\b|\bpor qu[eé](?![a-z])|\bwhy\b|\bcrash\w*/i

export const MEDIUM =
  /\bimplement\w*|\bfeatures?\b|\bfuncionalidad\w*|\bendpoints?\b|\bcomponentes?\b|\bcomponents?\b|\btests?\b|\bprueba\w*|\bbugs?\b|\bfix\w*|\barregl\w*|\bcorrig\w*/i

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
  if (isStrong) return 'opus'
  const isCosmetic = COSMETIC.test(desc) || COSMETIC.test(top)
  if (!isCosmetic && (DOMAIN.test(desc) || (DOMAIN.test(top) && CHANGE_VERB.test(top)))) return 'opus'
  const isLight = (LIGHT_EDIT.test(all) || isCosmetic) && !MEDIUM.test(all) && !DOMAIN.test(`${desc}\n${top}`)
  if (isLight) return 'haiku'
  return 'sonnet'
}

export function classifyDefault(description: string, prompt: string): ModelRouterLevel {
  const level = classify(description, prompt)
  if (level === 'opus') return 'opus'
  const all = clean(`${description}\n${prompt}`)
  if (CHANGE_VERB.test(all)) return 'sonnet'
  if (INVESTIGATE.test(all) && !READ_ONLY.test(`${clean(description)}
${clean(head(prompt))}`)) return 'sonnet'
  return 'haiku'
}
