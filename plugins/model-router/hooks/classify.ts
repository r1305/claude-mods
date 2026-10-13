import type { ModelRouterLevel } from '../types'

export const COMPLEX =
  /arquitectur|architect|\bauth|autenticaci|autorizaci|oauth|\bjwt\b|stripe|concurren|race condition|condici[oó]n de carrera|deadlock|transacci|(?<![\w-])lock(s|ing)?\b|migraci|migration|rediseñ|redesign|vulnerab|cifrad|encrypt|root cause|causa ra[ií]z|sin causa|unknown cause|intermitente|flaky|debug|depur|investig|analiz|optimiz|rendimiento|performance|N\+1|permis|\bIDOR\b|\bXSS\b|inyecci|injection|password|contraseñ/i

export const GENERIC = /refactor|seguridad|security|\bpagos?\b|payments?\b/i

export const SAFE_GENERIC = /copias? de seguridad|backups?/gi

export const CHANGE_VERB =
  /\bimplement\w*|\bintegr\w*|\brefactoriz\w*|\bcambi\w*|\bmodific\w*|\bañad\w*|\bagreg\w*|\bcrea\w*|\badd\b|\bchange\b|\bfix\w*|\barregl\w*|\bcorrig\w*|\brewrite\b|\breescrib\w*|\bmigr\w*|\bredise\w*/i

export const COSMETIC =
  /\btexto\b|\btext\b|\bcopy\b|\bcss\b|\bestilos?\b|\bstyles?\b|\bcolou?r\b|\btypo\b|\blabel\b|\betiqueta\b|bot[oó]n|\bbutton\b|\biconos?\b|\bicons?\b|\breadme\b|\bcomentarios?\b|\bcomments?\b/i

export const SIMPLE =
  /\bbusca(r|ndo)?\b|\bsearch(es|ing)?\b|\bfind\b|\blocate\b|\bencuentra\b|d[oó]nde est|where is|\blee\b|\bleer\b|\bread\b|\blist\b|\blista(r|do)?\b|\bexplora(r)?\b|\bexplore\b|\brenombr\w*|\brename\b|\btypo\b|\btexto\b|\btext\b|\bcopy\b|\bcss\b|\bestilos?\b|\bstyles?\b|\bcolou?r\b|\bcomentarios?\b|\bcomments?\b|\breadme\b|\bresumen\b|\bsummar\w*|\bgrep\b|\bglob\b|\bmapea\w*/i

export const MEDIUM =
  /\bimplement\w*|\bfeatures?\b|funcionalidad|\bcrea(r|te)?\b|\bcreate\b|\badd\b|\bagrega\w*|\bfix\w*|\barregl\w*|\bcorrig\w*|bugs?\b|\btests?\b|\bprueba\w*|\bendpoints?\b|\bcomponentes?\b|\bcomponents?\b|\bvalid\w*/i

const firstSentence = (prompt: string) =>
  (prompt.split(/[.!?\n]/).find(s => s.trim() !== '') ?? '').slice(0, 300)

const isGenericComplex = (description: string, sentence: string) => {
  const d = description.replace(SAFE_GENERIC, ' ')
  const s = sentence.replace(SAFE_GENERIC, ' ')
  if (COSMETIC.test(d) || COSMETIC.test(s)) return false
  return GENERIC.test(d) || (GENERIC.test(s) && CHANGE_VERB.test(s))
}

export function classify(description: string, prompt: string): ModelRouterLevel {
  const sentence = firstSentence(prompt)
  const head = `${description}\n${sentence}`
  const isComplex = COMPLEX.test(head.replace(SAFE_GENERIC, ' ')) || isGenericComplex(description, sentence)
  if (isComplex) return 'opus'
  const all = `${description}\n${prompt}`
  const isSimple = SIMPLE.test(all) && !MEDIUM.test(all) && !COMPLEX.test(all.replace(SAFE_GENERIC, ' '))
  if (prompt.length < 600 && isSimple) return 'haiku'
  return 'sonnet'
}
