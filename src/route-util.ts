import { HttpError } from './http.js'

/** Validate one question-answer batch coming from the app. */
export function normalizeAnswers(value: unknown): Array<{ id: string; selected: string[]; custom?: string }> {
  if (!Array.isArray(value) || value.length === 0) {
    throw new HttpError(400, 'bad-answers', 'answers must be a non-empty array')
  }
  return value.map((item) => {
    if (typeof item !== 'object' || item === null) throw new HttpError(400, 'bad-answers', 'each answer must be an object')
    const candidate = item as { id?: unknown; selected?: unknown; custom?: unknown }
    if (typeof candidate.id !== 'string' || !Array.isArray(candidate.selected) || !candidate.selected.every(label => typeof label === 'string')) {
      throw new HttpError(400, 'bad-answers', 'each answer needs an id and a selected string array')
    }
    return {
      id: candidate.id,
      selected: candidate.selected,
      ...(typeof candidate.custom === 'string' ? { custom: candidate.custom } : {}),
    }
  })
}
