const assert = require('assert')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const parserPath = path.join(root, 'miniprogram', 'utils', 'parser.js')
const cloudParserPath = path.join(root, 'cloudfunctions', 'api', 'lib', 'parser.js')
const parserSource = fs.readFileSync(parserPath, 'utf8')
const cloudParserSource = fs.readFileSync(cloudParserPath, 'utf8')

console.log('no sample-overfitting tests')

assert.strictEqual(cloudParserSource, parserSource, 'cloud parser must be a synced copy')

const sampleSpecificStrings = [
  '微塑料蓝是什么蓝',
  '汇聚英才',
  'yingjiesheng.com/jobdetail/165746825',
  'AAA猪彼得',
  '等不到李老师',
  '记得有事情',
  '试卷.pdf',
  '微信图片_20261109151804_236',
  '盐都老味道',
  '北京玻色量子',
  '2026年11月09日 21:53'
]

sampleSpecificStrings.forEach((value) => {
  assert.strictEqual(
    parserSource.indexOf(value),
    -1,
    'parser must not contain sample-specific string: ' + value
  )
})

const productConstants = [
  'mp.weixin.qq.com',
  'jobTitle',
  'utm_',
  '文件',
  '小程序',
  '语音'
]
productConstants.forEach((value) => {
  assert.ok(
    parserSource.indexOf(value) !== -1,
    'parser should keep product-spec constant: ' + value
  )
})

console.log('  ok  parser has no sample-specific hardcoding')
console.log('  ok  parser keeps only documented product constants')
console.log('\nno sample-overfitting tests passed')
