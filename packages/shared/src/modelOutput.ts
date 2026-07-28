export const DEFAULT_MODEL_OUTPUT_CHAR_LIMIT = 20_000
export const MAX_MODEL_OUTPUT_CHAR_LIMIT = 80_000
export const DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT = 4_000
export const MAX_MODEL_OUTPUT_TOKEN_LIMIT = 6_000
export const APPROXIMATE_CHARS_PER_TOKEN = 4

export type ModelOutputLimitInput = Readonly<{
  charLimit?: number
  tokenLimit?: number
  defaultCharLimit?: number
  maxCharLimit?: number
  defaultTokenLimit?: number
  maxTokenLimit?: number
}>

export type ModelOutputTruncation = Readonly<{
  truncated: boolean
  charLimit: number
  originalLength?: number
  returnedLength: number
  nextOffset?: number
}>

export const resolveModelOutputCharLimit = (input: ModelOutputLimitInput = {}): number => {
  const maxCharLimit = input.maxCharLimit ?? MAX_MODEL_OUTPUT_CHAR_LIMIT
  const maxTokenLimit = input.maxTokenLimit ?? MAX_MODEL_OUTPUT_TOKEN_LIMIT
  const charLimit = Math.min(input.charLimit ?? input.defaultCharLimit ?? DEFAULT_MODEL_OUTPUT_CHAR_LIMIT, maxCharLimit)
  const tokenLimit = Math.min(input.tokenLimit ?? input.defaultTokenLimit ?? DEFAULT_MODEL_OUTPUT_TOKEN_LIMIT, maxTokenLimit)
  return Math.max(1, Math.min(charLimit, tokenLimit * APPROXIMATE_CHARS_PER_TOKEN))
}

export const limitModelOutputText = (
  value: string,
  input: ModelOutputLimitInput & Readonly<{ offset?: number }> = {},
): { text: string; truncation: ModelOutputTruncation } => {
  const charLimit = resolveModelOutputCharLimit(input)
  const start = Math.min(Math.max(0, input.offset ?? 0), value.length)
  const end = Math.min(start + charLimit, value.length)
  const text = value.slice(start, end)
  return {
    text,
    truncation: {
      truncated: end < value.length,
      charLimit,
      originalLength: value.length,
      returnedLength: text.length,
      ...(end < value.length ? { nextOffset: end } : {}),
    },
  }
}

export const limitModelOutputItems = <T>(
  items: readonly T[],
  input: ModelOutputLimitInput & Readonly<{ offset?: number; maxItems?: number }> = {},
): { items: T[]; truncation: ModelOutputTruncation } => {
  const charLimit = resolveModelOutputCharLimit(input)
  const start = Math.min(Math.max(0, input.offset ?? 0), items.length)
  const maxItems = Math.max(1, input.maxItems ?? items.length)
  const selected: T[] = []
  let serializedLength = 2
  for (let index = start; index < items.length && selected.length < maxItems; index += 1) {
    const item = items[index] as T
    const itemLength = JSON.stringify(item).length + (selected.length > 0 ? 1 : 0)
    if (serializedLength + itemLength > charLimit) break
    selected.push(item)
    serializedLength += itemLength
  }
  const nextOffset = start + selected.length
  return {
    items: selected,
    truncation: {
      truncated: nextOffset < items.length,
      charLimit,
      originalLength: items.length,
      returnedLength: selected.length,
      ...(nextOffset < items.length ? { nextOffset } : {}),
    },
  }
}
