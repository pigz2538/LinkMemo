const config = require('../config')

function getMode() {
  return config.backendMode || (config.cloudEnabled ? 'cloud' : 'local')
}

function getModeLabel() {
  const mode = getMode()
  if (mode === 'http') return '自建服务器模式'
  if (mode === 'cloud') return 'CloudBase 模式'
  return '本地模式'
}

module.exports = { getMode, getModeLabel }
