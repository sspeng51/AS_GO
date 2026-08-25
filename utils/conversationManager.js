class ConversationManager {
  constructor() {
    this.storageKey = 'conversations'
    this.currentConversationId = null
    // 每个对话最多保留的消息数量，超出时移除最早的消息
    this.maxMessagesPerConv = 100
  }

  generateId() {
    return Date.now().toString(36) + Math.random().toString(36).substring(2)
  }

  getCurrentTimestamp() {
    return new Date().toLocaleString('zh-CN', {
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit'
    })
  }

  getAllConversations() {
    try {
      const data = wx.getStorageSync(this.storageKey)
      return data ? JSON.parse(data) : []
    } catch (error) {
      console.error('Get Conversations Error:', error)
      return []
    }
  }

  saveAllConversations(conversations) {
    wx.setStorageSync(this.storageKey, JSON.stringify(conversations))
  }

  createNewConversation(title = '新对话') {
    const conversation = {
      id: this.generateId(),
      title: title,
      createdAt: this.getCurrentTimestamp(),
      updatedAt: this.getCurrentTimestamp(),
      messageCount: 0,
      preview: '',
      messages: []
    }

    const allConversations = this.getAllConversations()
    allConversations.unshift(conversation)
    this.saveAllConversations(allConversations)

    this.currentConversationId = conversation.id
    return conversation
  }

  getConversation(id) {
    const conversations = this.getAllConversations()
    return conversations.find(c => c.id === id) || null
  }

  updateConversation(id, updates) {
    let conversations = this.getAllConversations()
    const index = conversations.findIndex(c => c.id === id)
    
    if (index !== -1) {
      conversations[index] = {
        ...conversations[index],
        ...updates,
        updatedAt: this.getCurrentTimestamp()
      }
      this.saveAllConversations(conversations)
      return conversations[index]
    }
    return null
  }

  addMessage(conversationId, message) {
    const conversation = this.getConversation(conversationId)
    if (!conversation) return null

    const msg = {
      id: this.generateId(),
      ...message,
      timestamp: this.getCurrentTimestamp()
    }

    conversation.messages.push(msg)
    conversation.messageCount = conversation.messages.length

    // 限制每个对话的消息数量，超出时移除最早的消息
    if (conversation.messages.length > this.maxMessagesPerConv) {
      conversation.messages = conversation.messages.slice(-this.maxMessagesPerConv)
      conversation.messageCount = conversation.messages.length
    }

    if (message.role === 'user' && conversation.messages.length <= 1) {
      conversation.preview = message.content.substring(0, 50) + (message.content.length > 50 ? '...' : '')
      conversation.title = message.content.substring(0, 20) + (message.content.length > 20 ? '...' : '')
    }

    this.updateConversation(conversationId, conversation)
    return msg
  }

  deleteConversation(id) {
    let conversations = this.getAllConversations()
    conversations = conversations.filter(c => c.id !== id)
    this.saveAllConversations(conversations)
  }

  clearAllConversations() {
    wx.removeStorageSync(this.storageKey)
    this.currentConversationId = null
  }

  setCurrentConversation(id) {
    this.currentConversationId = id
  }

  getCurrentConversation() {
    if (this.currentConversationId) {
      return this.getConversation(this.currentConversationId)
    }
    return null
  }

  getRecentConversations(limit = 10) {
    const conversations = this.getAllConversations()
    return conversations.slice(0, limit)
  }
}

module.exports = ConversationManager
