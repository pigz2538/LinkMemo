const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const sourceDir = path.join(root, 'miniprogram', 'utils')
const targetDir = path.join(root, 'cloudfunctions', 'api', 'lib')
const files = ['parser.js', 'pinyin.js', 'pinyin-table.js', 'format.js']

fs.mkdirSync(targetDir, { recursive: true })
files.forEach((file) => {
  fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file))
  console.log('synced ' + file)
})
