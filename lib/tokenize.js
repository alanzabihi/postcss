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
const HASH = '#'.charCodeAt(0)
const EXCL = '!'.charCodeAt(0)

// Lookup table: 1 = AT_END char, 2 = WORD_END char, 3 = both
// AT_END:   [\t\n\f\r "#'()/;[\\\]{}]
// WORD_END: [\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)
// Common:   [\t\n\f\r "#'();[\\\]{}]
// AT only:  /
// WORD only: !:@
let IS_AT_END = new Uint8Array(128)
let IS_WORD_END = new Uint8Array(128)

// Set AT_END chars: \t \n \f \r   " # ' ( ) / ; [ \ ] { }
IS_AT_END[9] = 1    // \t
IS_AT_END[10] = 1   // \n
IS_AT_END[12] = 1   // \f
IS_AT_END[13] = 1   // \r
IS_AT_END[32] = 1   // space
IS_AT_END[34] = 1   // "
IS_AT_END[35] = 1   // #
IS_AT_END[39] = 1   // '
IS_AT_END[40] = 1   // (
IS_AT_END[41] = 1   // )
IS_AT_END[47] = 1   // /
IS_AT_END[59] = 1   // ;
IS_AT_END[91] = 1   // [
IS_AT_END[92] = 1   // \
IS_AT_END[93] = 1   // ]
IS_AT_END[123] = 1  // {
IS_AT_END[125] = 1  // }

// Set WORD_END chars: \t \n \f \r   ! " # ' ( ) : ; @ [ \ ] { }
// Note: / is special - only ends word if followed by *
IS_WORD_END[9] = 1    // \t
IS_WORD_END[10] = 1   // \n
IS_WORD_END[12] = 1   // \f
IS_WORD_END[13] = 1   // \r
IS_WORD_END[32] = 1   // space
IS_WORD_END[33] = 1   // !
IS_WORD_END[34] = 1   // "
IS_WORD_END[35] = 1   // #
IS_WORD_END[39] = 1   // '
IS_WORD_END[40] = 1   // (
IS_WORD_END[41] = 1   // )
IS_WORD_END[58] = 1   // :
IS_WORD_END[59] = 1   // ;
IS_WORD_END[64] = 1   // @
IS_WORD_END[91] = 1   // [
IS_WORD_END[92] = 1   // \
IS_WORD_END[93] = 1   // ]
IS_WORD_END[123] = 1  // {
IS_WORD_END[125] = 1  // }

// Whitespace lookup
let IS_WS = new Uint8Array(128)
IS_WS[32] = 1   // space
IS_WS[10] = 1   // \n
IS_WS[9] = 1    // \t
IS_WS[13] = 1   // \r
IS_WS[12] = 1   // \f

const RE_BAD_BRACKET = /.[\r\n"'(/\\]/

// Pre-compute control char strings (avoids String.fromCharCode per call)
let CONTROL_CHARS = {}
CONTROL_CHARS[OPEN_SQUARE] = '['
CONTROL_CHARS[CLOSE_SQUARE] = ']'
CONTROL_CHARS[OPEN_CURLY] = '{'
CONTROL_CHARS[CLOSE_CURLY] = '}'
CONTROL_CHARS[COLON] = ':'
CONTROL_CHARS[SEMICOLON] = ';'
CONTROL_CHARS[CLOSE_PARENTHESES] = ')'

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

  // Inline indexOf replacement for single char using charCodeAt
  function indexOfChar(str, charCode, from) {
    for (let i = from; i < str.length; i++) {
      if (str.charCodeAt(i) === charCode) return i
    }
    return -1
  }

  // Find '*/' comment close
  function indexOfCommentClose(str, from) {
    for (let i = from; i < str.length - 1; i++) {
      if (str.charCodeAt(i) === ASTERISK && str.charCodeAt(i + 1) === SLASH) {
        return i
      }
    }
    return -1
  }

  // Scan for AT_END char, replacing RE_AT_END regex
  function scanAtEnd(from) {
    for (let i = from; i < length; i++) {
      let c = css.charCodeAt(i)
      if (c < 128 && IS_AT_END[c]) return i
    }
    return -1
  }

  // Scan for WORD_END char, replacing RE_WORD_END regex
  // RE_WORD_END = /[\t\n\f\r !"#'():;@[\\\]{}]|\/(?=\*)/g
  function scanWordEnd(from) {
    for (let i = from; i < length; i++) {
      let c = css.charCodeAt(i)
      if (c < 128) {
        if (IS_WORD_END[c]) return i
        // / followed by * also ends a word
        if (c === SLASH && i + 1 < length && css.charCodeAt(i + 1) === ASTERISK) {
          return i
        }
      }
    }
    return -1
  }

  // Inline hex check replacing RE_HEX_ESCAPE
  function isHex(c) {
    return (
      (c >= 48 && c <= 57) ||   // 0-9
      (c >= 65 && c <= 70) ||   // A-F
      (c >= 97 && c <= 102)     // a-f
    )
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
        next = pos + 1
        while (next < length) {
          code = css.charCodeAt(next)
          if (code < 128 && IS_WS[code]) {
            next++
          } else {
            break
          }
        }

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
        let controlChar = CONTROL_CHARS[code]
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
            next = indexOfChar(css, CLOSE_PARENTHESES, next + 1)
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
          next = indexOfChar(css, CLOSE_PARENTHESES, pos + 1)
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
        quote = code
        next = pos
        do {
          escaped = false
          next = indexOfChar(css, quote, next + 1)
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
        let found = scanAtEnd(pos + 1)
        if (found === -1) {
          next = css.length - 1
        } else {
          next = found - 1
        }

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
          if (isHex(css.charCodeAt(next))) {
            while (isHex(css.charCodeAt(next + 1))) {
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
          let found = indexOfCommentClose(css, pos + 2)
          if (found === -1) {
            if (ignore || ignoreUnclosed) {
              next = css.length
            } else {
              unclosed('comment')
            }
          } else {
            next = found + 1
          }

          currentToken = ['comment', css.slice(pos, next + 1), pos, next]
          pos = next
        } else {
          let found = scanWordEnd(pos + 1)
          if (found === -1) {
            next = css.length - 1
          } else {
            next = found - 1
          }

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
