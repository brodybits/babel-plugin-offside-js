'use strict'
const fs = require('fs');
const path = require('path');
const babel = require('babel-core');

const babel_opt = {
  plugins: [path.resolve(__dirname, '../index.js')],
  sourceMaps: 'inline',
}


fs.readFile(path.resolve(__dirname, './example1.js'), 'utf-8', (err, original) => {
  if (err) throw err;

  let res = babel.transform(original, babel_opt)
  console.log()
  console.log("#### Original:")
  console.log()
  console.log('```javascript')
  console.log(original)
  console.log('```')
  console.log()

  console.log()
  console.log("#### Transformed:")
  console.log()
  console.log('```javascript')
  console.log(res.code)
  console.log('```')
  console.log()
})
