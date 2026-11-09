const PENDING_KEY = 'linkmemo_pending_filter'

function openArchiveWithFilter(filter) {
  try {
    wx.setStorageSync(PENDING_KEY, filter || {})
  } catch (e) {}
  wx.switchTab({ url: '/pages/archive/archive' })
}

function takePendingFilter() {
  try {
    const value = wx.getStorageSync(PENDING_KEY)
    if (value) wx.removeStorageSync(PENDING_KEY)
    return value || null
  } catch (e) {
    return null
  }
}

module.exports = { openArchiveWithFilter, takePendingFilter }
