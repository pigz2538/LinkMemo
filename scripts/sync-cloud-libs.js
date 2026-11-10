const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const sourceDir = path.join(root, 'miniprogram', 'utils')
const cloudLibDir = path.join(root, 'cloudfunctions', 'api', 'lib')
const serverLibDir = path.join(root, 'server', 'lib')
const files = ['parser.js', 'pinyin.js', 'pinyin-table.js', 'format.js']

function syncDir(targetDir) {
  fs.mkdirSync(targetDir, { recursive: true })
  files.forEach((file) => {
    fs.copyFileSync(path.join(sourceDir, file), path.join(targetDir, file))
    console.log('synced ' + path.relative(root, path.join(targetDir, file)))
  })
}

syncDir(cloudLibDir)
syncDir(serverLibDir)

const fetcher = path.join(root, 'cloudfunctions', 'api', 'lib', 'fetcher.js')
fs.copyFileSync(fetcher, path.join(serverLibDir, 'fetcher.js'))
console.log('synced server/lib/fetcher.js')
