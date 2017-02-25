const babylon = require('babylon');
const tt = babylon.tokTypes;

var _g_offsidePluginOpts;
const default_offsidePluginOpts = { keyword_blocks: true };

const _base_module_parse = babylon.parse;
babylon.parse = (input, options) => {
  _g_offsidePluginOpts = options ? options.offsidePluginOpts : undefined;
  return _base_module_parse(input, options);
};

const Parser = hookBabylon();
const baseProto = Parser.prototype;
const pp = Parser.prototype = Object.create(baseProto);

function hookBabylon() {
  // abuse Babylon token updateContext callback extract
  // the reference to Parser

  let Parser;
  let tgt_patch = babylon.tokTypes.braceL;
  let fn_updateContext = tgt_patch.updateContext;
  tgt_patch.updateContext = function (prevType) {
    tgt_patch.updateContext = fn_updateContext;
    Parser = this.constructor;
  };

  babylon.parse('{}');
  if (!Parser) {
    throw new Error("Failed to hook Babylon Parser");
  }
  return Parser;
}

pp._base_parse = baseProto.parse;
pp.parse = function () {
  this.initOffside();
  return this._base_parse();
};

class OffsideBreakout extends Error {}
const offsideBreakout = new OffsideBreakout();

pp.initOffside = function () {
  this.state.offside = [];
  this.state.offsideNextOp = null;
  this.offside_lines = parseOffsideIndexMap(this.input);
  this.offsidePluginOpts = _g_offsidePluginOpts || {};
  _g_offsidePluginOpts = null;

  this.state._pos = this.state.pos;
  Object.defineProperty(this.state, 'pos', { enumerable: true,
    get() {
      return this._pos;
    }, set(pos) {
      // interrupt skipSpace algorithm when we hit our position 'breakpoint'
      let offPos = this.offsidePos;
      if (offPos >= 0 && pos > offPos) {
        throw offsideBreakout;
      }

      this._pos = pos;
    } });
};

let tt_offside_keyword_with_args = new Set([tt._if, tt._while, tt._for, tt._catch, tt._switch]);

let tt_offside_keyword_lookahead_skip = new Set([tt.parenL, tt.colon, tt.comma, tt.dot]);

let at_offside = { '::': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, codeBlock: true },
  '::@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 1 },
  '::()': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, extraChars: 2 },
  '::{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: false, extraChars: 2 },
  '::[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: false, extraChars: 2 },
  '@': { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: true, keywordBlock: true },
  '@()': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@{}': { tokenPre: tt.braceL, tokenPost: tt.braceR, nestInner: true, extraChars: 2 },
  '@[]': { tokenPre: tt.bracketL, tokenPost: tt.bracketR, nestInner: true, extraChars: 2 }
  // note:  no '@()' -- standardize to use single-char '@ ' instead
  , keyword_args: { tokenPre: tt.parenL, tokenPost: tt.parenR, nestInner: false, inKeywordArg: true } };

pp._base_finishToken = baseProto.finishToken;
pp.finishToken = function (type, val) {
  const state = this.state;

  if (tt_offside_keyword_with_args.has(type)) {
    let isKeywordAllowed = !this.isLookahead && tt.dot !== state.type;

    state.offsideRecentKeyword = isKeywordAllowed;
    if (!isKeywordAllowed) {
      return this._base_finishToken(type, val);
    }

    const lookahead = this.lookahead();

    if (!tt_offside_keyword_lookahead_skip.has(lookahead.type)) {
      state.offsideNextOp = at_offside.keyword_args;
    }

    return this._base_finishToken(type, val);
  }

  const recentKeyword = state.offsideRecentKeyword;
  state.offsideRecentKeyword = null;
  if (type === tt.at || type === tt.doubleColon) {
    const pos0 = state.start,
          pos1 = state.pos + 2;
    const str_op = this.input.slice(pos0, pos1).split(/\s/, 1)[0];

    let op = at_offside[str_op];
    if (op.keywordBlock && recentKeyword && tt_offside_keyword_with_args.has(state.type)) {
      op = at_offside.keyword_args;
    }
    if (op) {
      return this.finishOffsideOp(op);
    }
  }

  if (tt.eof === type) {
    if (state.offside.length) {
      return this.popOffside();
    }
  }

  return this._base_finishToken(type, val);
};

pp.offsideIndent = function (line0, outerIndent, innerIndent) {
  const offside_lines = this.offside_lines;

  if (null == innerIndent) {
    const innerLine = offside_lines[line0 + 1];
    innerIndent = innerLine ? innerLine.indent : '';
  }

  let line = line0 + 1,
      last = offside_lines[line0];
  while (line < offside_lines.length) {
    const cur = offside_lines[line];
    if (cur.content && outerIndent >= cur.indent) {
      line--; // backup to previous line
      break;
    }

    line++;last = cur;
    if (innerIndent > cur.indent) {
      innerIndent = cur.indent;
    }
  }

  return { line, last, innerIndent };
};

pp.offsideBlock = function (op, stackTop, recentKeywordTop) {
  let offside_lines = this.offside_lines;

  const line0 = this.state.curLine;
  const first = offside_lines[line0];

  let indent, keywordNestedIndent;
  if (recentKeywordTop) {
    indent = recentKeywordTop.first.indent;
  } else if (op.nestInner && stackTop && line0 === stackTop.first.line) {
    indent = stackTop.innerIndent;
  } else if (op.inKeywordArg) {
    indent = first.indent;
    const indent_block = this.offsideIndent(line0, indent);
    const indent_keyword = this.offsideIndent(line0, indent_block.innerIndent);
    if (indent_keyword.innerIndent > indent_block.innerIndent) {
      // autodetect keyword argument using '@' for function calls
      indent = indent_block.innerIndent;
      keywordNestedIndent = indent_keyword.innerIndent;
    }
  } else {
    indent = first.indent;
  }

  let { last, innerIndent } = this.offsideIndent(line0, indent, keywordNestedIndent);

  // cap to 
  innerIndent = first.indent > innerIndent ? first.indent : innerIndent;

  return { op, innerIndent, first, last };
};

pp.finishOffsideOp = function (op) {
  const stack = this.state.offside;
  let stackTop = stack[stack.length - 1];
  let recentKeywordTop;
  if (op.codeBlock) {
    if (stackTop && stackTop.inKeywordArg) {
      this.popOffside();
      this.state.offsideNextOp = op;
      this.state.offsideRecentTop = stackTop;
      return;
    }

    recentKeywordTop = this.state.offsideRecentTop;
    this.state.offsideRecentTop = null;
  }

  if (op.extraChars) {
    this.state.pos += op.extraChars;
  }

  this._base_finishToken(op.tokenPre);

  if (this.isLookahead) {
    return;
  }

  stackTop = stack[stack.length - 1];
  let blk = this.offsideBlock(op, stackTop, recentKeywordTop);
  blk.inKeywordArg = op.inKeywordArg || stackTop && stackTop.inKeywordArg;
  this.state.offside.push(blk);
};

pp._base_skipSpace = baseProto.skipSpace;
pp.skipSpace = function () {
  if (null !== this.state.offsideNextOp) {
    return;
  }

  const stack = this.state.offside;
  let stackTop;
  if (stack && stack.length) {
    stackTop = stack[stack.length - 1];
    this.state.offsidePos = stackTop.last.posLastContent;
  } else {
    this.state.offsidePos = -1;
  }

  try {
    this._base_skipSpace();
    this.state.offsidePos = -1;
  } catch (err) {
    if (err !== offsideBreakout) {
      throw err;
    }
  }
};

pp._base_readToken = baseProto.readToken;
pp.readToken = function (code) {
  const offsideNextOp = this.state.offsideNextOp;
  if (null !== offsideNextOp) {
    this.state.offsideNextOp = null;
    return this.finishOffsideOp(offsideNextOp);
  } else if (this.state.pos === this.state.offsidePos) {
    return this.popOffside();
  } else {
    return this._base_readToken(code);
  }
};

pp.popOffside = function () {
  const stack = this.state.offside;
  let stackTop = this.isLookahead ? stack[stack.length - 1] : stack.pop();
  this.state.offsidePos = -1;

  this._base_finishToken(stackTop.op.tokenPost);
  return stackTop;
};

const rx_offside = /^([ \t]*)(.*)$/mg;
function parseOffsideIndexMap(input) {
  let lines = [null],
      posLastContent = 0,
      last = ['', 0];

  let ans = input.replace(rx_offside, (match, indent, content, pos) => {
    if (!content) {
      [indent, posLastContent] = last; // blank line; use last valid content as end
    } else {
        // valid content; set last to current indent
        posLastContent = pos + match.length;
        last = [indent, posLastContent];
      }

    lines.push({ line: lines.length, posLastContent, indent, content });
    return '';
  });

  return lines;
}

const keyword_block_parents = { IfStatement: 'if',
  ForStatement: 'for',
  ForOfStatement: 'for',
  WhileStatement: 'while',
  DoWhileStatement: 'do-while' };
const lint_keyword_block_parents = new Set(Object.keys(keyword_block_parents));

const babel_plugin_id = `babel-plugin-offside--${Date.now()}`;
module.exports = exports = babel => {
  return {
    name: babel_plugin_id,
    pre(state) {
      this.opts = Object.assign({}, default_offsidePluginOpts, this.opts);
    }, manipulateOptions(opts, parserOpts) {
      parserOpts.plugins.push('decorators', 'functionBind');
      const offsidePluginOpts = opts.plugins.filter(plugin => plugin[0] && babel_plugin_id === plugin[0].key && plugin[1]).map(plugin => plugin[1]).pop();
      parserOpts.offsidePluginOpts = offsidePluginOpts || default_offsidePluginOpts;
    }, visitor: {
      ExpressionStatement(path) {
        if (!this.opts.keyword_blocks) {
          return;
        }
        if (!lint_keyword_block_parents.has(path.parent.type)) {
          return;
        }

        let keyword = keyword_block_parents[path.parent.type];
        if ('if' === keyword && path.node === path.parent.alternate) {
          keyword = 'else'; // fixup if/else combined parent condition
        }throw path.buildCodeFrameError(`Keyword '${keyword}' should be followed by a block statement using '::' or matching '{' / '}'. \n` + `    (From 'keyword_blocks' enforcement option of babel-plugin-offside)`);
      } } };
};

Object.assign(exports, {
  hookBabylon,
  parseOffsideIndexMap });
//# sourceMappingURL=data:application/json;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uL2NvZGUvaW5kZXguanMiXSwibmFtZXMiOlsiYmFieWxvbiIsInJlcXVpcmUiLCJ0dCIsInRva1R5cGVzIiwiX2dfb2Zmc2lkZVBsdWdpbk9wdHMiLCJkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzIiwia2V5d29yZF9ibG9ja3MiLCJfYmFzZV9tb2R1bGVfcGFyc2UiLCJwYXJzZSIsImlucHV0Iiwib3B0aW9ucyIsIm9mZnNpZGVQbHVnaW5PcHRzIiwidW5kZWZpbmVkIiwiUGFyc2VyIiwiaG9va0JhYnlsb24iLCJiYXNlUHJvdG8iLCJwcm90b3R5cGUiLCJwcCIsIk9iamVjdCIsImNyZWF0ZSIsInRndF9wYXRjaCIsImJyYWNlTCIsImZuX3VwZGF0ZUNvbnRleHQiLCJ1cGRhdGVDb250ZXh0IiwicHJldlR5cGUiLCJjb25zdHJ1Y3RvciIsIkVycm9yIiwiX2Jhc2VfcGFyc2UiLCJpbml0T2Zmc2lkZSIsIk9mZnNpZGVCcmVha291dCIsIm9mZnNpZGVCcmVha291dCIsInN0YXRlIiwib2Zmc2lkZSIsIm9mZnNpZGVOZXh0T3AiLCJvZmZzaWRlX2xpbmVzIiwicGFyc2VPZmZzaWRlSW5kZXhNYXAiLCJfcG9zIiwicG9zIiwiZGVmaW5lUHJvcGVydHkiLCJlbnVtZXJhYmxlIiwiZ2V0Iiwic2V0Iiwib2ZmUG9zIiwib2Zmc2lkZVBvcyIsInR0X29mZnNpZGVfa2V5d29yZF93aXRoX2FyZ3MiLCJTZXQiLCJfaWYiLCJfd2hpbGUiLCJfZm9yIiwiX2NhdGNoIiwiX3N3aXRjaCIsInR0X29mZnNpZGVfa2V5d29yZF9sb29rYWhlYWRfc2tpcCIsInBhcmVuTCIsImNvbG9uIiwiY29tbWEiLCJkb3QiLCJhdF9vZmZzaWRlIiwidG9rZW5QcmUiLCJ0b2tlblBvc3QiLCJicmFjZVIiLCJuZXN0SW5uZXIiLCJjb2RlQmxvY2siLCJwYXJlblIiLCJleHRyYUNoYXJzIiwiYnJhY2tldEwiLCJicmFja2V0UiIsImtleXdvcmRCbG9jayIsImtleXdvcmRfYXJncyIsImluS2V5d29yZEFyZyIsIl9iYXNlX2ZpbmlzaFRva2VuIiwiZmluaXNoVG9rZW4iLCJ0eXBlIiwidmFsIiwiaGFzIiwiaXNLZXl3b3JkQWxsb3dlZCIsImlzTG9va2FoZWFkIiwib2Zmc2lkZVJlY2VudEtleXdvcmQiLCJsb29rYWhlYWQiLCJyZWNlbnRLZXl3b3JkIiwiYXQiLCJkb3VibGVDb2xvbiIsInBvczAiLCJzdGFydCIsInBvczEiLCJzdHJfb3AiLCJzbGljZSIsInNwbGl0Iiwib3AiLCJmaW5pc2hPZmZzaWRlT3AiLCJlb2YiLCJsZW5ndGgiLCJwb3BPZmZzaWRlIiwib2Zmc2lkZUluZGVudCIsImxpbmUwIiwib3V0ZXJJbmRlbnQiLCJpbm5lckluZGVudCIsImlubmVyTGluZSIsImluZGVudCIsImxpbmUiLCJsYXN0IiwiY3VyIiwiY29udGVudCIsIm9mZnNpZGVCbG9jayIsInN0YWNrVG9wIiwicmVjZW50S2V5d29yZFRvcCIsImN1ckxpbmUiLCJmaXJzdCIsImtleXdvcmROZXN0ZWRJbmRlbnQiLCJpbmRlbnRfYmxvY2siLCJpbmRlbnRfa2V5d29yZCIsInN0YWNrIiwib2Zmc2lkZVJlY2VudFRvcCIsImJsayIsInB1c2giLCJfYmFzZV9za2lwU3BhY2UiLCJza2lwU3BhY2UiLCJwb3NMYXN0Q29udGVudCIsImVyciIsIl9iYXNlX3JlYWRUb2tlbiIsInJlYWRUb2tlbiIsImNvZGUiLCJwb3AiLCJyeF9vZmZzaWRlIiwibGluZXMiLCJhbnMiLCJyZXBsYWNlIiwibWF0Y2giLCJrZXl3b3JkX2Jsb2NrX3BhcmVudHMiLCJJZlN0YXRlbWVudCIsIkZvclN0YXRlbWVudCIsIkZvck9mU3RhdGVtZW50IiwiV2hpbGVTdGF0ZW1lbnQiLCJEb1doaWxlU3RhdGVtZW50IiwibGludF9rZXl3b3JkX2Jsb2NrX3BhcmVudHMiLCJrZXlzIiwiYmFiZWxfcGx1Z2luX2lkIiwiRGF0ZSIsIm5vdyIsIm1vZHVsZSIsImV4cG9ydHMiLCJiYWJlbCIsIm5hbWUiLCJwcmUiLCJvcHRzIiwiYXNzaWduIiwibWFuaXB1bGF0ZU9wdGlvbnMiLCJwYXJzZXJPcHRzIiwicGx1Z2lucyIsImZpbHRlciIsInBsdWdpbiIsImtleSIsIm1hcCIsInZpc2l0b3IiLCJFeHByZXNzaW9uU3RhdGVtZW50IiwicGF0aCIsInBhcmVudCIsImtleXdvcmQiLCJub2RlIiwiYWx0ZXJuYXRlIiwiYnVpbGRDb2RlRnJhbWVFcnJvciJdLCJtYXBwaW5ncyI6IkFBQUEsTUFBTUEsVUFBVUMsUUFBUSxTQUFSLENBQWhCO0FBQ0EsTUFBTUMsS0FBS0YsUUFBUUcsUUFBbkI7O0FBRUEsSUFBSUMsb0JBQUo7QUFDQSxNQUFNQyw0QkFDSixFQUFJQyxnQkFBZ0IsSUFBcEIsRUFERjs7QUFHQSxNQUFNQyxxQkFBcUJQLFFBQVFRLEtBQW5DO0FBQ0FSLFFBQVFRLEtBQVIsR0FBZ0IsQ0FBQ0MsS0FBRCxFQUFRQyxPQUFSLEtBQW9CO0FBQ2xDTix5QkFBdUJNLFVBQVVBLFFBQVFDLGlCQUFsQixHQUFzQ0MsU0FBN0Q7QUFDQSxTQUFPTCxtQkFBbUJFLEtBQW5CLEVBQTBCQyxPQUExQixDQUFQO0FBQXlDLENBRjNDOztBQUlBLE1BQU1HLFNBQVNDLGFBQWY7QUFDQSxNQUFNQyxZQUFZRixPQUFPRyxTQUF6QjtBQUNBLE1BQU1DLEtBQUtKLE9BQU9HLFNBQVAsR0FBbUJFLE9BQU9DLE1BQVAsQ0FBY0osU0FBZCxDQUE5Qjs7QUFFQSxTQUFTRCxXQUFULEdBQXVCO0FBQ3JCO0FBQ0E7O0FBRUEsTUFBSUQsTUFBSjtBQUNBLE1BQUlPLFlBQVlwQixRQUFRRyxRQUFSLENBQWlCa0IsTUFBakM7QUFDQSxNQUFJQyxtQkFBbUJGLFVBQVVHLGFBQWpDO0FBQ0FILFlBQVVHLGFBQVYsR0FBMEIsVUFBVUMsUUFBVixFQUFvQjtBQUM1Q0osY0FBVUcsYUFBVixHQUEwQkQsZ0JBQTFCO0FBQ0FULGFBQVMsS0FBS1ksV0FBZDtBQUF5QixHQUYzQjs7QUFJQXpCLFVBQVFRLEtBQVIsQ0FBYyxJQUFkO0FBQ0EsTUFBSSxDQUFDSyxNQUFMLEVBQWE7QUFDWCxVQUFNLElB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ekJwRjs7QUE0QkExSSxPQUFPOEgsTUFBUCxDQUFnQkwsT0FBaEIsRUFDRTtBQUNFN0gsYUFERjtBQUVFcUIsc0JBRkYsRUFERiIsImZpbGUiOiJpbmRleC5qcyIsInNvdXJjZXNDb250ZW50IjpbImNvbnN0IGJhYnlsb24gPSByZXF1aXJlKCdiYWJ5bG9uJylcbmNvbnN0IHR0ID0gYmFieWxvbi50b2tUeXBlc1xuXG52YXIgX2dfb2Zmc2lkZVBsdWdpbk9wdHNcbmNvbnN0IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHMgPVxuICBAe30ga2V5d29yZF9ibG9ja3M6IHRydWVcblxuY29uc3QgX2Jhc2VfbW9kdWxlX3BhcnNlID0gYmFieWxvbi5wYXJzZVxuYmFieWxvbi5wYXJzZSA9IChpbnB1dCwgb3B0aW9ucykgPT4gOjpcbiAgX2dfb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRpb25zID8gb3B0aW9ucy5vZmZzaWRlUGx1Z2luT3B0cyA6IHVuZGVmaW5lZFxuICByZXR1cm4gX2Jhc2VfbW9kdWxlX3BhcnNlKGlucHV0LCBvcHRpb25zKVxuXG5jb25zdCBQYXJzZXIgPSBob29rQmFieWxvbigpXG5jb25zdCBiYXNlUHJvdG8gPSBQYXJzZXIucHJvdG90eXBlXG5jb25zdCBwcCA9IFBhcnNlci5wcm90b3R5cGUgPSBPYmplY3QuY3JlYXRlKGJhc2VQcm90bylcblxuZnVuY3Rpb24gaG9va0JhYnlsb24oKSA6OlxuICAvLyBhYnVzZSBCYWJ5bG9uIHRva2VuIHVwZGF0ZUNvbnRleHQgY2FsbGJhY2sgZXh0cmFjdFxuICAvLyB0aGUgcmVmZXJlbmNlIHRvIFBhcnNlclxuXG4gIGxldCBQYXJzZXJcbiAgbGV0IHRndF9wYXRjaCA9IGJhYnlsb24udG9rVHlwZXMuYnJhY2VMXG4gIGxldCBmbl91cGRhdGVDb250ZXh0ID0gdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHRcbiAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmdW5jdGlvbiAocHJldlR5cGUpIDo6XG4gICAgdGd0X3BhdGNoLnVwZGF0ZUNvbnRleHQgPSBmbl91cGRhdGVDb250ZXh0XG4gICAgUGFyc2VyID0gdGhpcy5jb25zdHJ1Y3RvclxuXG4gIGJhYnlsb24ucGFyc2UoJ3t9JylcbiAgaWYgKCFQYXJzZXIpIDo6XG4gICAgdGhyb3cgbmV3IEVycm9yIEAgXCJGYWlsZWQgdG8gaG9vayBCYWJ5bG9uIFBhcnNlclwiXG4gIHJldHVybiBQYXJzZXJcblxuXG5cbnBwLl9iYXNlX3BhcnNlID0gYmFzZVByb3RvLnBhcnNlXG5wcC5wYXJzZSA9IGZ1bmN0aW9uKCkgOjpcbiAgdGhpcy5pbml0T2Zmc2lkZSgpXG4gIHJldHVybiB0aGlzLl9iYXNlX3BhcnNlKClcblxuXG5jbGFzcyBPZmZzaWRlQnJlYWtvdXQgZXh0ZW5kcyBFcnJvciB7fVxuY29uc3Qgb2Zmc2lkZUJyZWFrb3V0ID0gbmV3IE9mZnNpZGVCcmVha291dCgpXG5cbnBwLmluaXRPZmZzaWRlID0gZnVuY3Rpb24oKSA6OlxuICB0aGlzLnN0YXRlLm9mZnNpZGUgPSBbXVxuICB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3AgPSBudWxsXG4gIHRoaXMub2Zmc2lkZV9saW5lcyA9IHBhcnNlT2Zmc2lkZUluZGV4TWFwKHRoaXMuaW5wdXQpXG4gIHRoaXMub2Zmc2lkZVBsdWdpbk9wdHMgPSBfZ19vZmZzaWRlUGx1Z2luT3B0cyB8fCB7fVxuICBfZ19vZmZzaWRlUGx1Z2luT3B0cyA9IG51bGxcblxuICB0aGlzLnN0YXRlLl9wb3MgPSB0aGlzLnN0YXRlLnBvc1xuICBPYmplY3QuZGVmaW5lUHJvcGVydHkgQCB0aGlzLnN0YXRlLCAncG9zJyxcbiAgICBAe30gZW51bWVyYWJsZTogdHJ1ZVxuICAgICAgLCBnZXQoKSA6OiByZXR1cm4gdGhpcy5fcG9zXG4gICAgICAsIHNldChwb3MpIDo6XG4gICAgICAgICAgLy8gaW50ZXJydXB0IHNraXBTcGFjZSBhbGdvcml0aG0gd2hlbiB3ZSBoaXQgb3VyIHBvc2l0aW9uICdicmVha3BvaW50J1xuICAgICAgICAgIGxldCBvZmZQb3MgPSB0aGlzLm9mZnNpZGVQb3NcbiAgICAgICAgICBpZiAob2ZmUG9zPj0wICYmIChwb3MgPiBvZmZQb3MpKSA6OlxuICAgICAgICAgICAgdGhyb3cgb2Zmc2lkZUJyZWFrb3V0XG5cbiAgICAgICAgICB0aGlzLl9wb3MgPSBwb3NcblxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX3dpdGhfYXJncyA9IG5ldyBTZXQgQFxuICBAW10gdHQuX2lmLCB0dC5fd2hpbGUsIHR0Ll9mb3JcbiAgICAsIHR0Ll9jYXRjaCwgdHQuX3N3aXRjaFxuXG5sZXQgdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwID0gbmV3IFNldCBAXG4gIEBbXSB0dC5wYXJlbkwsIHR0LmNvbG9uLCB0dC5jb21tYSwgdHQuZG90XG5cbmxldCBhdF9vZmZzaWRlID1cbiAgQHt9ICc6Oic6ICAge3Rva2VuUHJlOiB0dC5icmFjZUwsIHRva2VuUG9zdDogdHQuYnJhY2VSLCBuZXN0SW5uZXI6IGZhbHNlLCBjb2RlQmxvY2s6IHRydWV9XG4gICAgLCAnOjpAJzogIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgZXh0cmFDaGFyczogMX1cbiAgICAsICc6OigpJzoge3Rva2VuUHJlOiB0dC5wYXJlbkwsIHRva2VuUG9zdDogdHQucGFyZW5SLCBuZXN0SW5uZXI6IGZhbHNlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJzo6e30nOiB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnOjpbXSc6IHt0b2tlblByZTogdHQuYnJhY2tldEwsIHRva2VuUG9zdDogdHQuYnJhY2tldFIsIG5lc3RJbm5lcjogZmFsc2UsIGV4dHJhQ2hhcnM6IDJ9XG4gICAgLCAnQCc6ICAgIHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiB0cnVlLCBrZXl3b3JkQmxvY2s6IHRydWV9XG4gICAgLCAnQCgpJzogIHt0b2tlblByZTogdHQuYnJhY2VMLCB0b2tlblBvc3Q6IHR0LmJyYWNlUiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgICwgJ0B7fSc6ICB7dG9rZW5QcmU6IHR0LmJyYWNlTCwgdG9rZW5Qb3N0OiB0dC5icmFjZVIsIG5lc3RJbm5lcjogdHJ1ZSwgZXh0cmFDaGFyczogMn1cbiAgICAsICdAW10nOiAge3Rva2VuUHJlOiB0dC5icmFja2V0TCwgdG9rZW5Qb3N0OiB0dC5icmFja2V0UiwgbmVzdElubmVyOiB0cnVlLCBleHRyYUNoYXJzOiAyfVxuICAgIC8vIG5vdGU6ICBubyAnQCgpJyAtLSBzdGFuZGFyZGl6ZSB0byB1c2Ugc2luZ2xlLWNoYXIgJ0AgJyBpbnN0ZWFkXG4gICAgLCBrZXl3b3JkX2FyZ3M6IHt0b2tlblByZTogdHQucGFyZW5MLCB0b2tlblBvc3Q6IHR0LnBhcmVuUiwgbmVzdElubmVyOiBmYWxzZSwgaW5LZXl3b3JkQXJnOiB0cnVlfVxuXG5wcC5fYmFzZV9maW5pc2hUb2tlbiA9IGJhc2VQcm90by5maW5pc2hUb2tlblxucHAuZmluaXNoVG9rZW4gPSBmdW5jdGlvbih0eXBlLCB2YWwpIDo6XG4gIGNvbnN0IHN0YXRlID0gdGhpcy5zdGF0ZVxuXG4gIGlmICh0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyh0eXBlKSkgOjpcbiAgICBsZXQgaXNLZXl3b3JkQWxsb3dlZCA9ICF0aGlzLmlzTG9va2FoZWFkXG4gICAgICAmJiB0dC5kb3QgIT09IHN0YXRlLnR5cGVcblxuICAgIHN0YXRlLm9mZnNpZGVSZWNlbnRLZXl3b3JkID0gaXNLZXl3b3JkQWxsb3dlZFxuICAgIGlmICghaXNLZXl3b3JkQWxsb3dlZCkgOjpcbiAgICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICAgIGNvbnN0IGxvb2thaGVhZCA9IHRoaXMubG9va2FoZWFkKClcblxuICAgIGlmICghdHRfb2Zmc2lkZV9rZXl3b3JkX2xvb2thaGVhZF9za2lwLmhhcyhsb29rYWhlYWQudHlwZSkpIDo6XG4gICAgICBzdGF0ZS5vZmZzaWRlTmV4dE9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcblxuICAgIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuICBjb25zdCByZWNlbnRLZXl3b3JkID0gc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmRcbiAgc3RhdGUub2Zmc2lkZVJlY2VudEtleXdvcmQgPSBudWxsXG4gIGlmICh0eXBlID09PSB0dC5hdCB8fCB0eXBlID09PSB0dC5kb3VibGVDb2xvbikgOjpcbiAgICBjb25zdCBwb3MwID0gc3RhdGUuc3RhcnQsIHBvczEgPSBzdGF0ZS5wb3MgKyAyXG4gICAgY29uc3Qgc3RyX29wID0gdGhpcy5pbnB1dC5zbGljZShwb3MwLCBwb3MxKS5zcGxpdCgvXFxzLywgMSlbMF1cblxuICAgIGxldCBvcCA9IGF0X29mZnNpZGVbc3RyX29wXVxuICAgIGlmIChvcC5rZXl3b3JkQmxvY2sgJiYgcmVjZW50S2V5d29yZCAmJiB0dF9vZmZzaWRlX2tleXdvcmRfd2l0aF9hcmdzLmhhcyhzdGF0ZS50eXBlKSkgOjpcbiAgICAgIG9wID0gYXRfb2Zmc2lkZS5rZXl3b3JkX2FyZ3NcbiAgICBpZiAob3ApIDo6IHJldHVybiB0aGlzLmZpbmlzaE9mZnNpZGVPcChvcClcblxuICBpZiAodHQuZW9mID09PSB0eXBlKSA6OlxuICAgIGlmIChzdGF0ZS5vZmZzaWRlLmxlbmd0aCkgOjpcbiAgICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIHJldHVybiB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKHR5cGUsIHZhbClcblxuXG5wcC5vZmZzaWRlSW5kZW50ID0gZnVuY3Rpb24gKGxpbmUwLCBvdXRlckluZGVudCwgaW5uZXJJbmRlbnQpIDo6XG4gIGNvbnN0IG9mZnNpZGVfbGluZXMgPSB0aGlzLm9mZnNpZGVfbGluZXNcblxuICBpZiAobnVsbCA9PSBpbm5lckluZGVudCkgOjpcbiAgICBjb25zdCBpbm5lckxpbmUgPSBvZmZzaWRlX2xpbmVzW2xpbmUwKzFdXG4gICAgaW5uZXJJbmRlbnQgPSBpbm5lckxpbmUgPyBpbm5lckxpbmUuaW5kZW50IDogJydcblxuICBsZXQgbGluZT1saW5lMCsxLCBsYXN0PW9mZnNpZGVfbGluZXNbbGluZTBdXG4gIHdoaWxlIChsaW5lIDwgb2Zmc2lkZV9saW5lcy5sZW5ndGgpIDo6XG4gICAgY29uc3QgY3VyID0gb2Zmc2lkZV9saW5lc1tsaW5lXVxuICAgIGlmIChjdXIuY29udGVudCAmJiBvdXRlckluZGVudCA+PSBjdXIuaW5kZW50KSA6OlxuICAgICAgbGluZS0tIC8vIGJhY2t1cCB0byBwcmV2aW91cyBsaW5lXG4gICAgICBicmVha1xuXG4gICAgbGluZSsrOyBsYXN0ID0gY3VyXG4gICAgaWYgKGlubmVySW5kZW50ID4gY3VyLmluZGVudCkgOjpcbiAgICAgIGlubmVySW5kZW50ID0gY3VyLmluZGVudFxuXG4gIHJldHVybiBAe30gbGluZSwgbGFzdCwgaW5uZXJJbmRlbnRcblxuXG5wcC5vZmZzaWRlQmxvY2sgPSBmdW5jdGlvbiAob3AsIHN0YWNrVG9wLCByZWNlbnRLZXl3b3JkVG9wKSA6OlxuICBsZXQgb2Zmc2lkZV9saW5lcyA9IHRoaXMub2Zmc2lkZV9saW5lc1xuXG4gIGNvbnN0IGxpbmUwID0gdGhpcy5zdGF0ZS5jdXJMaW5lXG4gIGNvbnN0IGZpcnN0ID0gb2Zmc2lkZV9saW5lc1tsaW5lMF1cblxuICBsZXQgaW5kZW50LCBrZXl3b3JkTmVzdGVkSW5kZW50XG4gIGlmIChyZWNlbnRLZXl3b3JkVG9wKSA6OlxuICAgIGluZGVudCA9IHJlY2VudEtleXdvcmRUb3AuZmlyc3QuaW5kZW50XG4gIGVsc2UgaWYgKG9wLm5lc3RJbm5lciAmJiBzdGFja1RvcCAmJiBsaW5lMCA9PT0gc3RhY2tUb3AuZmlyc3QubGluZSkgOjpcbiAgICBpbmRlbnQgPSBzdGFja1RvcC5pbm5lckluZGVudFxuICBlbHNlIGlmIChvcC5pbktleXdvcmRBcmcpIDo6XG4gICAgaW5kZW50ID0gZmlyc3QuaW5kZW50XG4gICAgY29uc3QgaW5kZW50X2Jsb2NrID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQpXG4gICAgY29uc3QgaW5kZW50X2tleXdvcmQgPSB0aGlzLm9mZnNpZGVJbmRlbnQobGluZTAsIGluZGVudF9ibG9jay5pbm5lckluZGVudClcbiAgICBpZiAoaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnQgPiBpbmRlbnRfYmxvY2suaW5uZXJJbmRlbnQpIDo6XG4gICAgICAvLyBhdXRvZGV0ZWN0IGtleXdvcmQgYXJndW1lbnQgdXNpbmcgJ0AnIGZvciBmdW5jdGlvbiBjYWxsc1xuICAgICAgaW5kZW50ID0gaW5kZW50X2Jsb2NrLmlubmVySW5kZW50XG4gICAgICBrZXl3b3JkTmVzdGVkSW5kZW50ID0gaW5kZW50X2tleXdvcmQuaW5uZXJJbmRlbnRcbiAgZWxzZSA6OlxuICAgIGluZGVudCA9IGZpcnN0LmluZGVudFxuXG4gIGxldCB7bGFzdCwgaW5uZXJJbmRlbnR9ID0gdGhpcy5vZmZzaWRlSW5kZW50KGxpbmUwLCBpbmRlbnQsIGtleXdvcmROZXN0ZWRJbmRlbnQpXG5cbiAgLy8gY2FwIHRvIFxuICBpbm5lckluZGVudCA9IGZpcnN0LmluZGVudCA+IGlubmVySW5kZW50XG4gICAgPyBmaXJzdC5pbmRlbnQgOiBpbm5lckluZGVudFxuXG4gIHJldHVybiB7b3AsIGlubmVySW5kZW50LCBmaXJzdCwgbGFzdH1cblxuXG5cbnBwLmZpbmlzaE9mZnNpZGVPcCA9IGZ1bmN0aW9uIChvcCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoIC0gMV1cbiAgbGV0IHJlY2VudEtleXdvcmRUb3BcbiAgaWYgKG9wLmNvZGVCbG9jaykgOjpcbiAgICBpZiAoc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnKSA6OlxuICAgICAgdGhpcy5wb3BPZmZzaWRlKClcbiAgICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG9wXG4gICAgICB0aGlzLnN0YXRlLm9mZnNpZGVSZWNlbnRUb3AgPSBzdGFja1RvcFxuICAgICAgcmV0dXJuXG5cbiAgICByZWNlbnRLZXl3b3JkVG9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUmVjZW50VG9wID0gbnVsbFxuXG4gIGlmIChvcC5leHRyYUNoYXJzKSA6OlxuICAgIHRoaXMuc3RhdGUucG9zICs9IG9wLmV4dHJhQ2hhcnNcblxuICB0aGlzLl9iYXNlX2ZpbmlzaFRva2VuKG9wLnRva2VuUHJlKVxuXG4gIGlmICh0aGlzLmlzTG9va2FoZWFkKSA6OiByZXR1cm5cblxuICBzdGFja1RvcCA9IHN0YWNrW3N0YWNrLmxlbmd0aCAtIDFdXG4gIGxldCBibGsgPSB0aGlzLm9mZnNpZGVCbG9jayhvcCwgc3RhY2tUb3AsIHJlY2VudEtleXdvcmRUb3ApXG4gIGJsay5pbktleXdvcmRBcmcgPSBvcC5pbktleXdvcmRBcmcgfHwgc3RhY2tUb3AgJiYgc3RhY2tUb3AuaW5LZXl3b3JkQXJnXG4gIHRoaXMuc3RhdGUub2Zmc2lkZS5wdXNoKGJsaylcblxuXG5wcC5fYmFzZV9za2lwU3BhY2UgPSBiYXNlUHJvdG8uc2tpcFNwYWNlXG5wcC5za2lwU3BhY2UgPSBmdW5jdGlvbigpIDo6XG4gIGlmIChudWxsICE9PSB0aGlzLnN0YXRlLm9mZnNpZGVOZXh0T3ApIDo6IHJldHVyblxuXG4gIGNvbnN0IHN0YWNrID0gdGhpcy5zdGF0ZS5vZmZzaWRlXG4gIGxldCBzdGFja1RvcFxuICBpZiAoc3RhY2sgJiYgc3RhY2subGVuZ3RoKSA6OlxuICAgIHN0YWNrVG9wID0gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgdGhpcy5zdGF0ZS5vZmZzaWRlUG9zID0gc3RhY2tUb3AubGFzdC5wb3NMYXN0Q29udGVudFxuICBlbHNlIDo6IHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG5cbiAgdHJ5IDo6XG4gICAgdGhpcy5fYmFzZV9za2lwU3BhY2UoKVxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZVBvcyA9IC0xXG4gIGNhdGNoIChlcnIpIDo6XG4gICAgaWYgKGVyciAhPT0gb2Zmc2lkZUJyZWFrb3V0KSA6OiB0aHJvdyBlcnJcblxuXG5wcC5fYmFzZV9yZWFkVG9rZW4gPSBiYXNlUHJvdG8ucmVhZFRva2VuXG5wcC5yZWFkVG9rZW4gPSBmdW5jdGlvbihjb2RlKSA6OlxuICBjb25zdCBvZmZzaWRlTmV4dE9wID0gdGhpcy5zdGF0ZS5vZmZzaWRlTmV4dE9wXG4gIGlmIChudWxsICE9PSBvZmZzaWRlTmV4dE9wKSA6OlxuICAgIHRoaXMuc3RhdGUub2Zmc2lkZU5leHRPcCA9IG51bGxcbiAgICByZXR1cm4gdGhpcy5maW5pc2hPZmZzaWRlT3Aob2Zmc2lkZU5leHRPcClcblxuICBlbHNlIGlmICh0aGlzLnN0YXRlLnBvcyA9PT0gdGhpcy5zdGF0ZS5vZmZzaWRlUG9zKSA6OlxuICAgIHJldHVybiB0aGlzLnBvcE9mZnNpZGUoKVxuXG4gIGVsc2UgOjpcbiAgICByZXR1cm4gdGhpcy5fYmFzZV9yZWFkVG9rZW4oY29kZSlcblxucHAucG9wT2Zmc2lkZSA9IGZ1bmN0aW9uKCkgOjpcbiAgY29uc3Qgc3RhY2sgPSB0aGlzLnN0YXRlLm9mZnNpZGVcbiAgbGV0IHN0YWNrVG9wID0gdGhpcy5pc0xvb2thaGVhZFxuICAgID8gc3RhY2tbc3RhY2subGVuZ3RoLTFdXG4gICAgOiBzdGFjay5wb3AoKVxuICB0aGlzLnN0YXRlLm9mZnNpZGVQb3MgPSAtMVxuXG4gIHRoaXMuX2Jhc2VfZmluaXNoVG9rZW4oc3RhY2tUb3Aub3AudG9rZW5Qb3N0KVxuICByZXR1cm4gc3RhY2tUb3BcblxuXG5cbmNvbnN0IHJ4X29mZnNpZGUgPSAvXihbIFxcdF0qKSguKikkL21nXG5mdW5jdGlvbiBwYXJzZU9mZnNpZGVJbmRleE1hcChpbnB1dCkgOjpcbiAgbGV0IGxpbmVzID0gW251bGxdLCBwb3NMYXN0Q29udGVudD0wLCBsYXN0PVsnJywgMF1cblxuICBsZXQgYW5zID0gaW5wdXQucmVwbGFjZSBAIHJ4X29mZnNpZGUsIChtYXRjaCwgaW5kZW50LCBjb250ZW50LCBwb3MpID0+IDo6XG4gICAgaWYgKCFjb250ZW50KSA6OlxuICAgICAgW2luZGVudCwgcG9zTGFzdENvbnRlbnRdID0gbGFzdCAvLyBibGFuayBsaW5lOyB1c2UgbGFzdCB2YWxpZCBjb250ZW50IGFzIGVuZFxuICAgIGVsc2UgOjpcbiAgICAgIC8vIHZhbGlkIGNvbnRlbnQ7IHNldCBsYXN0IHRvIGN1cnJlbnQgaW5kZW50XG4gICAgICBwb3NMYXN0Q29udGVudCA9IHBvcyArIG1hdGNoLmxlbmd0aFxuICAgICAgbGFzdCA9IFtpbmRlbnQsIHBvc0xhc3RDb250ZW50XVxuXG4gICAgbGluZXMucHVzaCh7bGluZTogbGluZXMubGVuZ3RoLCBwb3NMYXN0Q29udGVudCwgaW5kZW50LCBjb250ZW50fSlcbiAgICByZXR1cm4gJydcblxuICByZXR1cm4gbGluZXNcblxuXG5jb25zdCBrZXl3b3JkX2Jsb2NrX3BhcmVudHMgPVxuIEB7fSBJZlN0YXRlbWVudDogJ2lmJ1xuICAgLCBGb3JTdGF0ZW1lbnQ6ICdmb3InXG4gICAsIEZvck9mU3RhdGVtZW50OiAnZm9yJ1xuICAgLCBXaGlsZVN0YXRlbWVudDogJ3doaWxlJ1xuICAgLCBEb1doaWxlU3RhdGVtZW50OiAnZG8td2hpbGUnXG5jb25zdCBsaW50X2tleXdvcmRfYmxvY2tfcGFyZW50cyA9IG5ldyBTZXQgQCBPYmplY3Qua2V5cyBAIGtleXdvcmRfYmxvY2tfcGFyZW50c1xuXG5jb25zdCBiYWJlbF9wbHVnaW5faWQgPSBgYmFiZWwtcGx1Z2luLW9mZnNpZGUtLSR7RGF0ZS5ub3coKX1gXG5tb2R1bGUuZXhwb3J0cyA9IGV4cG9ydHMgPSAoYmFiZWwpID0+IDo6XG4gIHJldHVybiA6OlxuICAgIG5hbWU6IGJhYmVsX3BsdWdpbl9pZFxuICAgICwgcHJlKHN0YXRlKSA6OlxuICAgICAgdGhpcy5vcHRzID0gT2JqZWN0LmFzc2lnbiBAIHt9LCBkZWZhdWx0X29mZnNpZGVQbHVnaW5PcHRzLCB0aGlzLm9wdHNcblxuICAgICwgbWFuaXB1bGF0ZU9wdGlvbnMob3B0cywgcGFyc2VyT3B0cykgOjpcbiAgICAgICAgcGFyc2VyT3B0cy5wbHVnaW5zLnB1c2goJ2RlY29yYXRvcnMnLCAnZnVuY3Rpb25CaW5kJylcbiAgICAgICAgY29uc3Qgb2Zmc2lkZVBsdWdpbk9wdHMgPSBvcHRzLnBsdWdpbnNcbiAgICAgICAgICAuZmlsdGVyIEAgcGx1Z2luID0+IHBsdWdpblswXSAmJiBiYWJlbF9wbHVnaW5faWQgPT09IHBsdWdpblswXS5rZXkgJiYgcGx1Z2luWzFdXG4gICAgICAgICAgLm1hcCBAIHBsdWdpbiA9PiBwbHVnaW5bMV1cbiAgICAgICAgICAucG9wKClcbiAgICAgICAgcGFyc2VyT3B0cy5vZmZzaWRlUGx1Z2luT3B0cyA9IG9mZnNpZGVQbHVnaW5PcHRzIHx8IGRlZmF1bHRfb2Zmc2lkZVBsdWdpbk9wdHNcblxuICAgICwgdmlzaXRvcjogOjpcbiAgICAgICAgRXhwcmVzc2lvblN0YXRlbWVudChwYXRoKSA6OlxuICAgICAgICAgIGlmICghdGhpcy5vcHRzLmtleXdvcmRfYmxvY2tzKSA6OiByZXR1cm5cbiAgICAgICAgICBpZiAoIWxpbnRfa2V5d29yZF9ibG9ja19wYXJlbnRzLmhhcyhwYXRoLnBhcmVudC50eXBlKSkgOjogcmV0dXJuXG5cbiAgICAgICAgICBsZXQga2V5d29yZCA9IGtleXdvcmRfYmxvY2tfcGFyZW50c1twYXRoLnBhcmVudC50eXBlXVxuICAgICAgICAgIGlmICgnaWYnID09PSBrZXl3b3JkICYmIHBhdGgubm9kZSA9PT0gcGF0aC5wYXJlbnQuYWx0ZXJuYXRlKSA6OlxuICAgICAgICAgICAga2V5d29yZCA9ICdlbHNlJyAvLyBmaXh1cCBpZi9lbHNlIGNvbWJpbmVkIHBhcmVudCBjb25kaXRpb25cblxuICAgICAgICAgIHRocm93IHBhdGguYnVpbGRDb2RlRnJhbWVFcnJvciBAXG4gICAgICAgICAgICBgS2V5d29yZCAnJHtrZXl3b3JkfScgc2hvdWxkIGJlIGZvbGxvd2VkIGJ5IGEgYmxvY2sgc3RhdGVtZW50IHVzaW5nICc6Oicgb3IgbWF0Y2hpbmcgJ3snIC8gJ30nLiBcXG5gICtcbiAgICAgICAgICAgIGAgICAgKEZyb20gJ2tleXdvcmRfYmxvY2tzJyBlbmZvcmNlbWVudCBvcHRpb24gb2YgYmFiZWwtcGx1Z2luLW9mZnNpZGUpYFxuXG5cbk9iamVjdC5hc3NpZ24gQCBleHBvcnRzLFxuICBAe31cbiAgICBob29rQmFieWxvbixcbiAgICBwYXJzZU9mZnNpZGVJbmRleE1hcCxcblxuIl19