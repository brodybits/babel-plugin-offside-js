require('source-map-support').install()
const {genSyntaxTestCases, standardTransforms} = require('./_xform_syntax_variations')

const tap = require('tap-lite-tester')
tap.start()

genSyntaxTestCases @ tap, iterSyntaxVariations()
if 1 ::
  for let xform of Object.values @ standardTransforms ::
    genSyntaxTestCases @ tap, xform @ iterSyntaxVariations()

tap.finish()


function * iterSyntaxVariations() ::
  yield * iterIfStmts()
  yield * iterCompoundExpressions()
  yield * iterIfElseStmts()
  yield * iterIfElseIfElseStmts()
  yield * iterExtendedIfElseIfElseStmts()

function * iterIfStmts() ::
  // if (expr) body variations
  yield :: expectSyntaxError: true
    , title: 'linted if statement with expression'
    , source: @[] 'if (expr) singleStatement'

  yield :: expectValid: true
    , title: 'vanilla if statement'
    , source: @[] 'if (expr) { blockStatement }'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside if statement'
    , source: @[] 'if (expr) :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside if statement, multiline'
    , source: @[] 'if (expr) ::'
                , '  blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside if statement'
    , source: @[] 'if expr :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside if statement, multiline'
    , source: @[] 'if expr ::'
                , '  blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'eof'


function * iterCompoundExpressions() ::
  // compound expression variants
  yield :: expectValid: true
    , title: 'offside compound if expression'
    , source: @[] 'if test @ a, b, c :: blockStatement'
    , tokens: @[] "if", "(", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'offside compound if expression, multiline'
    , source: @[] 'if test @ a, b, c ::'
                , '  blockStatement'
    , tokens: @[] "if", "(", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'offside dual compound if expression'
    , source: @[] 'if other && test @ a, b, c ::'
                , '  blockStatement'
    , tokens: @[] "if", "(", "name", "&&", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"


  // @ prefixed expressions
  yield :: expectValid: true
    , title: 'offside compound if @ expression'
    , source: @[] 'if @ test @ a, b, c :: blockStatement'
    , tokens: @[] "if", "(", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'offside compound if @ expression, multiline'
    , source: @[] 'if @ test @ a, b, c ::'
                , '  blockStatement'
    , tokens: @[] "if", "(", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"

  yield :: expectValid: true
    , title: 'offside dual compound if @ expression'
    , source: @[] 'if @ other && test @ a, b, c ::'
                , '  blockStatement'
    , tokens: @[] "if", "(", "name", "&&", "name", "(", "name", ",", "name", ",", "name", ")", ")", "{", "name", "}", "eof"



function * iterIfElseStmts() ::
  // if (expr) body else body variations
  yield :: expectSyntaxError: true
    , title: 'linted if / else statement with expression + block'
    , source: @[] 'if (expr) singleStatement else { blockStatement }'

  yield :: expectSyntaxError: true
    , title: 'linted if / else statement with block + expression'
    , source: @[] 'if (expr) { blockStatement } else singleStatement'

  yield :: expectSyntaxError: true
    , title: 'linted if / else statement with block + expression'
    , source: @[] 'if (expr) :: blockStatement'
                , 'else singleStatement'

  yield :: expectValid: true
    , title: 'vanilla if / else statement'
    , source: @[] 'if (expr) { blockStatement } else { blockStatement }'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside if / else statement'
    , source: @[] 'if (expr) :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside if / else statement'
    , source: @[] 'if expr :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'


function * iterIfElseIfElseStmts() ::
  // if (expr) body else if (expr) else body variations
  yield :: expectSyntaxError: true
    , title: 'linted if / else statement with block + expression'
    , source: @[] 'if (expr) :: blockStatement'
                , 'else if (expr) singleStatement'
                , 'else :: blockStatement'

  yield :: expectValid: true
    , title: 'vanilla if / else if / else statement'
    , source: @[] 'if (expr) { blockStatement } else if (expr) { blockStatement } else { blockStatement }'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'offside if / else if / else statement'
    , source: @[] 'if (expr) :: blockStatement'
                , 'else if (expr) :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'keyword offside if / else if / else statement'
    , source: @[] 'if expr :: blockStatement'
                , 'else if expr :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'


function * iterExtendedIfElseIfElseStmts() ::
  yield :: expectValid: true
    , title: 'mixed variant 1 keyword offside if / else if / else statement'
    , source: @[] 'if (expr) :: blockStatement'
                , 'else if expr :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'mixed variant 2 keyword offside if / else if / else statement'
    , source: @[] 'if expr :: blockStatement'
                , 'else if (expr) :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'mixed variant 3 keyword offside if / else if / else statement'
    , source: @[] 'if @ expr :: blockStatement'
                , 'else if @ expr :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'mixed variant 4 keyword offside if / else if / else statement'
    , source: @[] 'if @ expr :: blockStatement'
                , 'else if expr :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'

  yield :: expectValid: true
    , title: 'mixed variant 5 keyword offside if / else if / else statement'
    , source: @[] 'if @ expr :: blockStatement'
                , 'else if (expr) :: blockStatement'
                , 'else :: blockStatement'
    , tokens: @[] 'if', '(', 'name', ')', '{', 'name', '}', 'else', 'if', '(', 'name', ')', '{', 'name', '}', 'else', '{', 'name', '}', 'eof'
