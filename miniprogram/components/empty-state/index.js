Component({
  properties: {
    title: { type: String, value: '还没有内容' },
    desc: { type: String, value: '' },
    icon: { type: String, value: '/assets/icons/folder-gray.png' },
    actionText: { type: String, value: '' }
  },

  methods: {
    onAction() {
      this.triggerEvent('action')
    }
  }
})
