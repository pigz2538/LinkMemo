const config = require('../config')

const mode = config.backendMode || (config.cloudEnabled ? 'cloud' : 'local')

module.exports = mode === 'cloud'
  ? require('./cloud-api')
  : mode === 'http'
    ? require('./http-api')
    : require('./local-api')
