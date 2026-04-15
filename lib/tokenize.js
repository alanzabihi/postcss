'use strict'

const SINGLE_QUOTE = "'".charCodeAt(0)
const DOUBLE_QUOTE = '"'.charCodeAt(0)
const BACKSLASH = '\\'.charCodeAt(0)
const SLASH = '/'.charCodeAt(0)
const NEWLINE = '\n'.charCodeAt(0)
const SPACE = ' '.charCodeAt(0)
const FEED = '\f'.charCodeAt(0)
const TAB = '\t'.charCodeAt(0)
const CR = '\r'.charCodeAt(0)
const OPEN_SQUARE = '['.charCodeAt(0)
const CLOSE_SQUARE = ']'.charCodeAt(0)
const OPEN_PARENTHESES = '('.charCodeAt(0)
const CLOSE_PARENTHESES = ')'.charCodeAt(0)
const OPEN_CURLY = '{'.charCodeAt(0)
const CLOSE_CURLY = '}'.charCodeAt(0)
const SEMICOLON = ';'.charCodeAt(0)
const ASTERISK = '*'.charCodeAt(0)
const COLON = ':'.charCodeAt(0)
const AT = '@'.charCodeAt(0)

const RE_BAD_BRACKET = /.[\r\n"'(/\\]/
const RE_HEX_ESCAPE = /[\da-f]/i

// Lookup table for word-end characters: \t \n \f \r space ! " # ' ( ) : ; @ [ \ ] { }
// Plus / when followed by * (handled inline)
let WORD_END_TABLE = new Uint8Array(128)
WORD_END_TABLE[9] = 1    // \t
WORD_END_TABLE[10] = 1   // \n
WORD_END_TABLE[12] = 1   // \f
WORD_END_TABLE[13] = 1   // \r
WORD_END_TABLE[32] = 1   // space
WORD_END_TABLE[33] = 1   // !
WORD_END_TABLE[34] = 1   // "
WORD_END_TABLE[35] = 1   // #
WORD_END_TABLE[39] = 1   // '
WORD_END_TABLE[40] = 1   // (
WORD_END_TABLE[41] = 1   // )
WORD_END_TABLE[58] = 1   // :
WORD_END_TABLE[59] = 1   // ;
WORD_END_TABLE[64] = 1   // @
WORD_END_TABLE[91] = 1   // [
WORD_END_TABLE[92] = 1   // \
WORD_END_TABLE[93] = 1   // ]
WORD_END_TABLE[123] = 1  // {
WORD_END_TABLE[125] = 1  // }

// Lookup table for at-end characters: \t \n \f \r space " # ' ( ) / ; [ \ ] { }
let AT_END_TABLE = new Uint8Array(128)
AT_END_TABLE[9] = 1    // \t
AT_END_TABLE[10] = 1   // \n
AT_END_TABLE[12] = 1   // \f
AT_END_TABLE[13] = 1   // \r
AT_END_TABLE[32] = 1   // space
AT_END_TABLE[34] = 1   // "
AT_END_TABLE[35] = 1   // #
AT_END_TABLE[39] = 1   // '
AT_END_TABLE[40] = 1   // (
AT_END_TABLE[41] = 1   // )
AT_END_TABLE[47] = 1   // /
AT_END_TABLE[59] = 1   // ;
AT_END_TABLE[91] = 1   // [
AT_END_TABLE[92] = 1   // \
AT_END_TABLE[93] = 1   // ]
AT_END_TABLE[123] = 1  // {
AT_END_TABLE[125] = 1  // }

module.exports = function tokenizer(input, options = {}) {
  let css = input.css.valueOf()
  let ignore = options.ignoreErrors

  let code, content, escape, next, quote
  let currentToken, escaped, escapePos, n, prev

  let length = css.length
  let pos = 0
  let buffer = []
  let returned = []

  function position() {
    return pos
  }

  function unclosed(what) {
    throw input.error('Unclosed ' + what, pos)
  }

  function endOfFile() {
    return returned.length === 0 && pos >= length
  }

  function nextToken(opts) {
    if (returned.length) return returned.pop()
    if (pos >= length) return

    let ignoreUnclosed = opts ? opts.ignoreUnclosed : false

    code = css.charCodeAt(pos)

    switch (code) {
      case NEWLINE:
      case SPACE:
      case TAB:
      case CR:
      case FEED: {
        next = pos
        do {
          next += 1
          code = css.charCodeAt(next)
        } while (
          code === SPACE ||
          code === NEWLINE ||
          code === TAB ||
          code === CR ||
          code === FEED
        )

        currentToken = ['space', css.slice(pos, next)]
        pos = next - 1
        break
      }

      case OPEN_SQUARE:
      case CLOSE_SQUARE:
      case OPEN_CURLY:
      case CLOSE_CURLY:
      case COLON:
      case SEMICOLON:
      case CLOSE_PARENTHESES: {
        let controlChar = String.fromCharCode(code)
        currentToken = [controlChar, controlChar, pos]
        break
      }

      case OPEN_PARENTHESES: {
        prev = buffer.length ? buffer.pop()[1] : ''
        n = css.charCodeAt(pos + 1)
        if (
          prev === 'url' &&
          n !== SINGLE_QUOTE &&
          n !== DOUBLE_QUOTE &&
          n !== SPACE &&
          n !== NEWLINE &&
          n !== TAB &&
          n !== FEED &&
          n !== CR
        ) {
          next = pos
          do {
            escaped = false
            next = css.indexOf(')', next + 1)
            if (next === -1) {
              if (ignore || ignoreUnclosed) {
                next = pos
                break
              } else {
                unclosed('bracket')
              }
            }
            escapePos = next
            while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
              escapePos -= 1
              escaped = !escaped
            }
          } while (escaped)

          currentToken = ['brackets', css.slice(pos, next + 1), pos, next]

          pos = next
        } else {
          next = css.indexOf(')', pos + 1)
          content = css.slice(pos, next + 1)

          if (next === -1 || RE_BAD_BRACKET.test(content)) {
            currentToken = ['(', '(', pos]
          } else {
            currentToken = ['brackets', content, pos, next]
            pos = next
          }
        }

        break
      }

      case SINGLE_QUOTE:
      case DOUBLE_QUOTE: {
        quote = code === SINGLE_QUOTE ? "'" : '"'
        next = pos
        do {
          escaped = false
          next = css.indexOf(quote, next + 1)
          if (next === -1) {
            if (ignore || ignoreUnclosed) {
              next = pos + 1
              break
            } else {
              unclosed('string')
            }
          }
          escapePos = next
          while (css.charCodeAt(escapePos - 1) === BACKSLASH) {
            escapePos -= 1
            escaped = !escaped
          }
        } while (escaped)

        currentToken = ['string', css.slice(pos, next + 1), pos, next]
        pos = next
        break
      }

      case AT: {
        next = pos + 1
        while (next < length) {
          code = css.charCodeAt(next)
          if (code < 128 && AT_END_TABLE[code]) {
            next--
            break
          }
          next++
        }
        if (next >= length) next = length - 1

        currentToken = ['at-word', css.slice(pos, next + 1), pos, next]

        pos = next
        break
      }

      case BACKSLASH: {
        next = pos
        escape = true
        while (css.charCodeAt(next + 1) === BACKSLASH) {
          next += 1
          escape = !escape
        }
        code = css.charCodeAt(next + 1)
        if (
          escape &&
          code !== SLASH &&
          code !== SPACE &&
          code !== NEWLINE &&
          code !== TAB &&
          code !== CR &&
          code !== FEED
        ) {
          next += 1
          if (RE_HEX_ESCAPE.test(css.charAt(next))) {
            while (RE_HEX_ESCAPE.test(css.charAt(next + 1))) {
              next += 1
            }
            if (css.charCodeAt(next + 1) === SPACE) {
              next += 1
            }
          }
        }

        currentToken = ['word', css.slice(pos, next + 1), pos, next]

        pos = next
        break
      }

      default: {
        if (code === SLASH && css.charCodeAt(pos + 1) === ASTERISK) {
          next = css.indexOf('*/', pos + 2) + 1
          if (next === 0) {
            if (ignore || ignoreUnclosed) {
              next = css.length
            } else {
              unclosed('comment')
            }
          }

          currentToken = ['comment', css.slice(pos, next + 1), pos, next]
          pos = next
        } else {
          next = pos + 1
          while (next < length) {
            code = css.charCodeAt(next)
            if (code < 128 && WORD_END_TABLE[code]) {
              next--
              break
            }
            // Handle /(?=*) — slash followed by asterisk
            if (code === SLASH && css.charCodeAt(next + 1) === ASTERISK) {
              next--
              break
            }
            next++
          }
          if (next >= length) next = length - 1

          currentToken = ['word', css.slice(pos, next + 1), pos, next]
          buffer.push(currentToken)
          pos = next
        }

        break
      }
    }

    pos++
    return currentToken
  }

  function back(token) {
    returned.push(token)
  }

  return {
    back,
    endOfFile,
    nextToken,
    position
  }
}
