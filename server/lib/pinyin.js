const { MAIN_START, MAIN_TABLE } = require('./pinyin-table')

const LETTER_RE = /^[a-zA-Z]$/
const DIGIT_RE = /^[0-9]$/

function firstLetter(text) {
  const value = String(text || '').trim()
  if (!value) return '#'

  for (let i = 0; i < value.length; i++) {
    const ch = value[i]
    const code = value.charCodeAt(i)

    if (code >= MAIN_START && code <= MAIN_START + MAIN_TABLE.length - 1) {
      const initial = MAIN_TABLE[code - MAIN_START]
      if (initial && initial !== '#') return initial.toUpperCase()
      return '#'
    }

    if (LETTER_RE.test(ch)) return ch.toUpperCase()
    if (DIGIT_RE.test(ch)) return '#'
  }

  return '#'
}

module.exports = { firstLetter }
