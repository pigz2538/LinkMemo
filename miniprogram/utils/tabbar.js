function hide() {
  if (wx.hideTabBar) {
    wx.hideTabBar({ animation: false, fail: function () {} })
  }
}

function show() {
  if (wx.showTabBar) {
    wx.showTabBar({ animation: false, fail: function () {} })
  }
}

module.exports = { hide, show }
