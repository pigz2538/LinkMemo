const config = require('../config')

module.exports = config.cloudEnabled
  ? require('./cloud-api')
  : require('./local-api')
