'use strict'

let Node = require('./node')

class Comment extends Node {
  constructor(defaults) {
    super(defaults)
    this.type = 'comment'
    this._typeId = 4
  }
}

module.exports = Comment
Comment.default = Comment
