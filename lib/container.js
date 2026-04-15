'use strict'

let Comment = require('./comment')
let Declaration = require('./declaration')
let Node = require('./node')
let { isClean, my } = require('./symbols')

let AtRule, parse, Root, Rule

function cleanSource(nodes) {
  return nodes.map(i => {
    if (i.nodes) i.nodes = cleanSource(i.nodes)
    delete i.source
    return i
  })
}

function markTreeDirty(node) {
  node[isClean] = false
  if (node.proxyOf.nodes) {
    for (let i of node.proxyOf.nodes) {
      markTreeDirty(i)
    }
  }
}

class Container extends Node {
  get first() {
    if (!this.proxyOf.nodes) return undefined
    return this.proxyOf.nodes[0]
  }

  get last() {
    if (!this.proxyOf.nodes) return undefined
    return this.proxyOf.nodes[this.proxyOf.nodes.length - 1]
  }

  append(...children) {
    for (let child of children) {
      let nodes = this.normalize(child, this.last)
      for (let node of nodes) this.proxyOf.nodes.push(node)
    }

    this.markDirty()

    return this
  }

  cleanRaws(keepBetween) {
    super.cleanRaws(keepBetween)
    if (this.nodes) {
      for (let node of this.nodes) node.cleanRaws(keepBetween)
    }
  }

  each(callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()

    let index, result
    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      result = callback(this.proxyOf.nodes[index], index)
      if (result === false) break

      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  every(condition) {
    return this.nodes.every(condition)
  }

  getIterator() {
    if (!this.lastEach) this.lastEach = 0
    if (!this.indexes) this.indexes = {}

    this.lastEach += 1
    let iterator = this.lastEach
    this.indexes[iterator] = 0

    return iterator
  }

  getProxyProcessor() {
    return {
      get(node, prop) {
        if (prop === 'proxyOf') {
          return node
        } else if (!node[prop]) {
          return node[prop]
        } else if (
          prop === 'each' ||
          (typeof prop === 'string' && prop.startsWith('walk'))
        ) {
          return (...args) => {
            return node[prop](
              ...args.map(i => {
                if (typeof i === 'function') {
                  return (child, index) => i(child.toProxy(), index)
                } else {
                  return i
                }
              })
            )
          }
        } else if (prop === 'every' || prop === 'some') {
          return cb => {
            return node[prop]((child, ...other) =>
              cb(child.toProxy(), ...other)
            )
          }
        } else if (prop === 'root') {
          return () => node.root().toProxy()
        } else if (prop === 'nodes') {
          return node.nodes.map(i => i.toProxy())
        } else if (prop === 'first' || prop === 'last') {
          return node[prop].toProxy()
        } else {
          return node[prop]
        }
      },

      set(node, prop, value) {
        if (node[prop] === value) return true
        node[prop] = value
        if (prop === 'name' || prop === 'params' || prop === 'selector') {
          node.markDirty()
        }
        return true
      }
    }
  }

  index(child) {
    if (typeof child === 'number') return child
    if (child.proxyOf) child = child.proxyOf
    return this.proxyOf.nodes.indexOf(child)
  }

  insertAfter(exist, add) {
    let existIndex = this.index(exist)
    let nodes = this.normalize(add, this.proxyOf.nodes[existIndex]).reverse()
    existIndex = this.index(exist)
    for (let node of nodes) this.proxyOf.nodes.splice(existIndex + 1, 0, node)

    let index
    for (let id in this.indexes) {
      index = this.indexes[id]
      if (existIndex < index) {
        this.indexes[id] = index + nodes.length
      }
    }

    this.markDirty()

    return this
  }

  insertBefore(exist, add) {
    let existIndex = this.index(exist)
    let type = existIndex === 0 ? 'prepend' : false
    let nodes = this.normalize(
      add,
      this.proxyOf.nodes[existIndex],
      type
    ).reverse()
    existIndex = this.index(exist)
    for (let node of nodes) this.proxyOf.nodes.splice(existIndex, 0, node)

    let index
    for (let id in this.indexes) {
      index = this.indexes[id]
      if (existIndex <= index) {
        this.indexes[id] = index + nodes.length
      }
    }

    this.markDirty()

    return this
  }

  normalize(nodes, sample) {
    if (typeof nodes === 'string') {
      nodes = cleanSource(parse(nodes).nodes)
    } else if (typeof nodes === 'undefined') {
      nodes = []
    } else if (Array.isArray(nodes)) {
      nodes = nodes.slice(0)
      for (let i of nodes) {
        if (i.parent) i.parent.removeChild(i, 'ignore')
      }
    } else if (nodes.type === 'root' && this.type !== 'document') {
      nodes = nodes.nodes.slice(0)
      for (let i of nodes) {
        if (i.parent) i.parent.removeChild(i, 'ignore')
      }
    } else if (nodes.type) {
      nodes = [nodes]
    } else if (nodes.prop) {
      if (typeof nodes.value === 'undefined') {
        throw new Error('Value field is missed in node creation')
      } else if (typeof nodes.value !== 'string') {
        nodes.value = String(nodes.value)
      }
      nodes = [new Declaration(nodes)]
    } else if (nodes.selector || nodes.selectors) {
      nodes = [new Rule(nodes)]
    } else if (nodes.name) {
      nodes = [new AtRule(nodes)]
    } else if (nodes.text) {
      nodes = [new Comment(nodes)]
    } else {
      throw new Error('Unknown node type in node creation')
    }

    let processed = nodes.map(i => {
      /* c8 ignore next */
      if (!i[my]) Container.rebuild(i)
      i = i.proxyOf
      if (i.parent) i.parent.removeChild(i)
      if (i[isClean]) markTreeDirty(i)

      if (!i.raws) i.raws = {}
      if (typeof i.raws.before === 'undefined') {
        if (sample && typeof sample.raws.before !== 'undefined') {
          i.raws.before = sample.raws.before.replace(/\S/g, '')
        }
      }
      i.parent = this.proxyOf
      return i
    })

    return processed
  }

  prepend(...children) {
    children = children.reverse()
    for (let child of children) {
      let nodes = this.normalize(child, this.first, 'prepend').reverse()
      for (let node of nodes) this.proxyOf.nodes.unshift(node)
      for (let id in this.indexes) {
        this.indexes[id] = this.indexes[id] + nodes.length
      }
    }

    this.markDirty()

    return this
  }

  push(child) {
    child.parent = this
    this.proxyOf.nodes.push(child)
    return this
  }

  removeAll() {
    for (let node of this.proxyOf.nodes) node.parent = undefined
    this.proxyOf.nodes = []

    this.markDirty()

    return this
  }

  removeChild(child) {
    child = this.index(child)
    this.proxyOf.nodes[child].parent = undefined
    this.proxyOf.nodes.splice(child, 1)

    let index
    for (let id in this.indexes) {
      index = this.indexes[id]
      if (index >= child) {
        this.indexes[id] = index - 1
      }
    }

    this.markDirty()

    return this
  }

  replaceValues(pattern, opts, callback) {
    if (!callback) {
      callback = opts
      opts = {}
    }

    this.walkDecls(decl => {
      if (opts.props && !opts.props.includes(decl.prop)) return
      if (opts.fast && !decl.value.includes(opts.fast)) return

      decl.value = decl.value.replace(pattern, callback)
    })

    this.markDirty()

    return this
  }

  some(condition) {
    return this.nodes.some(condition)
  }

  walk(callback) {
    return this.each((child, i) => {
      let result
      try {
        result = callback(child, i)
      } catch (e) {
        throw child.addToError(e)
      }
      if (result !== false && child.walk) {
        result = child.walk(callback)
      }

      return result
    })
  }

  walkAtRules(name, callback) {
    if (!callback) {
      callback = name
      return this._walkAtRulesAll(callback)
    }
    if (name instanceof RegExp) {
      return this._walkAtRulesRe(name, callback)
    }
    return this._walkAtRulesStr(name, callback)
  }

  _walkAtRulesAll(callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'atrule') {
        try {
          result = callback(child, index)
        } catch (e) {
          throw child.addToError(e)
        }
        if (result !== false && child.nodes) {
          result = child._walkAtRulesAll(callback)
        }
      } else if (child.nodes) {
        result = child._walkAtRulesAll(callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkAtRulesRe(name, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'atrule') {
        if (name.test(child.name)) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
        if (result !== false && child.nodes) {
          result = child._walkAtRulesRe(name, callback)
        }
      } else if (child.nodes) {
        result = child._walkAtRulesRe(name, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkAtRulesStr(name, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'atrule') {
        if (child.name === name) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
        if (result !== false && child.nodes) {
          result = child._walkAtRulesStr(name, callback)
        }
      } else if (child.nodes) {
        result = child._walkAtRulesStr(name, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  walkComments(callback) {
    return this._walkComments(callback)
  }

  _walkComments(callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'comment') {
        try {
          result = callback(child, index)
        } catch (e) {
          throw child.addToError(e)
        }
      } else if (child.nodes) {
        result = child._walkComments(callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  walkDecls(prop, callback) {
    if (!callback) {
      callback = prop
      return this._walkDeclsAll(callback)
    }
    if (prop instanceof RegExp) {
      return this._walkDeclsRe(prop, callback)
    }
    return this._walkDeclsStr(prop, callback)
  }

  _walkDeclsAll(callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'decl') {
        try {
          result = callback(child, index)
        } catch (e) {
          throw child.addToError(e)
        }
      } else if (child.nodes) {
        result = child._walkDeclsAll(callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkDeclsRe(prop, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'decl') {
        if (prop.test(child.prop)) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
      } else if (child.nodes) {
        result = child._walkDeclsRe(prop, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkDeclsStr(prop, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'decl') {
        if (child.prop === prop) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
      } else if (child.nodes) {
        result = child._walkDeclsStr(prop, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  walkRules(selector, callback) {
    if (!callback) {
      callback = selector
      return this._walkRulesAll(callback)
    }
    if (selector instanceof RegExp) {
      return this._walkRulesRe(selector, callback)
    }
    return this._walkRulesStr(selector, callback)
  }

  _walkRulesAll(callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'rule') {
        try {
          result = callback(child, index)
        } catch (e) {
          throw child.addToError(e)
        }
        if (result !== false && child.nodes) {
          result = child._walkRulesAll(callback)
        }
      } else if (child.nodes) {
        result = child._walkRulesAll(callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkRulesRe(selector, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'rule') {
        if (selector.test(child.selector)) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
        if (result !== false && child.nodes) {
          result = child._walkRulesRe(selector, callback)
        }
      } else if (child.nodes) {
        result = child._walkRulesRe(selector, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }

  _walkRulesStr(selector, callback) {
    if (!this.proxyOf.nodes) return undefined
    let iterator = this.getIterator()
    let index, result, child

    while (this.indexes[iterator] < this.proxyOf.nodes.length) {
      index = this.indexes[iterator]
      child = this.proxyOf.nodes[index]

      if (child.type === 'rule') {
        if (child.selector === selector) {
          try {
            result = callback(child, index)
          } catch (e) {
            throw child.addToError(e)
          }
        }
        if (result !== false && child.nodes) {
          result = child._walkRulesStr(selector, callback)
        }
      } else if (child.nodes) {
        result = child._walkRulesStr(selector, callback)
      }

      if (result === false) break
      this.indexes[iterator] += 1
    }

    delete this.indexes[iterator]
    return result
  }
}

Container.registerParse = dependant => {
  parse = dependant
}

Container.registerRule = dependant => {
  Rule = dependant
}

Container.registerAtRule = dependant => {
  AtRule = dependant
}

Container.registerRoot = dependant => {
  Root = dependant
}

module.exports = Container
Container.default = Container

/* c8 ignore start */
Container.rebuild = node => {
  if (node.type === 'atrule') {
    Object.setPrototypeOf(node, AtRule.prototype)
  } else if (node.type === 'rule') {
    Object.setPrototypeOf(node, Rule.prototype)
  } else if (node.type === 'decl') {
    Object.setPrototypeOf(node, Declaration.prototype)
  } else if (node.type === 'comment') {
    Object.setPrototypeOf(node, Comment.prototype)
  } else if (node.type === 'root') {
    Object.setPrototypeOf(node, Root.prototype)
  }

  node[my] = true

  if (node.nodes) {
    node.nodes.forEach(child => {
      Container.rebuild(child)
    })
  }
}
/* c8 ignore stop */
