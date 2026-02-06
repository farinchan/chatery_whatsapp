/**
 * Custom in-memory store for Baileys
 * Optimized version with pre-computed caches for fast queries
 */
class BaileysStore {
  constructor(sessionId = null) {
    this.sessionId = sessionId;
    
    // Core data stores
    this.chats = new Map();
    this.contacts = new Map();
    this.messages = new Map();
    this.groupMetadata = new Map();
    
    // Optimized caches for fast queries
    this.chatsOverview = new Map(); // Pre-computed chat overview
    this.profilePictures = new Map(); // Cached profile pictures
    this.contactsCache = new Map(); // Cached contacts with profile pics
    
    // Media files tracking: messageId -> filePath
    this.mediaFiles = new Map();
    
    // Cache timestamps
    this.lastOverviewUpdate = 0;
    this.lastContactsUpdate = 0;
    this.cacheTimeout = 30000; // 30 seconds cache validity
  }

  /**
   * Bind store to Baileys socket events
   */
  bind(ev) {
    // Handle chat updates
    ev.on('chats.set', ({ chats }) => {
      for (const chat of chats) {
        this.chats.set(chat.id, chat);
      }
      this._invalidateOverviewCache();
    });

    ev.on('chats.upsert', (chats) => {
      for (const chat of chats) {
        this.chats.set(chat.id, { ...this.chats.get(chat.id), ...chat });
        this._updateSingleChatOverview(chat.id);
      }
    });

    ev.on('chats.update', (updates) => {
      for (const update of updates) {
        const existing = this.chats.get(update.id);
        if (existing) {
          this.chats.set(update.id, { ...existing, ...update });
          this._updateSingleChatOverview(update.id);
        }
      }
    });

    ev.on('chats.delete', (ids) => {
      for (const id of ids) {
        this.chats.delete(id);
        this.chatsOverview.delete(id);
        this.messages.delete(id);
      }
    });

    // Handle contact updates
    ev.on('contacts.set', ({ contacts }) => {
      for (const contact of contacts) {
        this.contacts.set(contact.id, contact);
      }
      this._invalidateContactsCache();
    });

    ev.on('contacts.upsert', (contacts) => {
      for (const contact of contacts) {
        this.contacts.set(contact.id, { ...this.contacts.get(contact.id), ...contact });
      }
      this._invalidateContactsCache();
    });

    ev.on('contacts.update', (updates) => {
      for (const update of updates) {
        const existing = this.contacts.get(update.id);
        if (existing) {
          this.contacts.set(update.id, { ...existing, ...update });
        }
      }
      this._invalidateContactsCache();
    });

    // Handle message updates - OPTIMIZED
    ev.on('messages.set', ({ messages, isLatest }) => {
      for (const msg of messages) {
        // Skip null/invalid messages
        if (!msg || !msg.key || !msg.key.remoteJid || !msg.key.id) continue;
        
        const chatId = msg.key.remoteJid;
        if (!this.messages.has(chatId)) {
          this.messages.set(chatId, new Map());
        }
        this.messages.get(chatId).set(msg.key.id, msg);
        this._updateSingleChatOverview(chatId, msg);
      }
    });

    ev.on('messages.upsert', ({ messages, type }) => {
      for (const msg of messages) {
        // Skip null/invalid messages
        if (!msg || !msg.key || !msg.key.remoteJid || !msg.key.id) continue;
        
        const chatId = msg.key.remoteJid;
        if (!this.messages.has(chatId)) {
          this.messages.set(chatId, new Map());
        }
        this.messages.get(chatId).set(msg.key.id, msg);
        this._updateSingleChatOverview(chatId, msg);
      }
    });

    ev.on('messages.update', (updates) => {
      for (const { key, update } of updates) {
        // Skip invalid updates
        if (!key || !key.remoteJid || !key.id) continue;
        
        const chatMessages = this.messages.get(key.remoteJid);
        if (chatMessages) {
          const existing = chatMessages.get(key.id);
          if (existing) {
            chatMessages.set(key.id, { ...existing, ...update });
          }
        }
      }
    });

    ev.on('messages.delete', (item) => {
      if ('keys' in item) {
        for (const key of item.keys) {
          // Skip invalid keys
          if (!key || !key.remoteJid) continue;
          
          const chatMessages = this.messages.get(key.remoteJid);
          if (chatMessages) {
            chatMessages.delete(key.id);
            // Also delete associated media file
            this._deleteMediaFile(key.id);
          }
        }
      }
    });

    // Handle group metadata
    ev.on('groups.upsert', (groups) => {
      for (const group of groups) {
        this.groupMetadata.set(group.id, group);
      }
    });

    ev.on('groups.update', (updates) => {
      for (const update of updates) {
        const existing = this.groupMetadata.get(update.id);
        if (existing) {
          this.groupMetadata.set(update.id, { ...existing, ...update });
        }
      }
    });
  }

  /**
   * Update single chat overview (called on message events)
   */
  _updateSingleChatOverview(chatId, newMessage = null) {
    const chat = this.chats.get(chatId);
    const chatMessages = this.messages.get(chatId);
    
    if (!chatMessages || chatMessages.size === 0) {
      this.chatsOverview.delete(chatId);
      return;
    }

    // Find latest message
    let latestMessage = newMessage;
    if (!latestMessage) {
      const messagesArray = Array.from(chatMessages.values()).filter(m => m != null);
      if (messagesArray.length === 0) {
        this.chatsOverview.delete(chatId);
        return;
      }
      messagesArray.sort((a, b) => (b?.messageTimestamp || 0) - (a?.messageTimestamp || 0));
      latestMessage = messagesArray[0];
    }

    // Skip if no valid message found
    if (!latestMessage) {
      return;
    }

    const contact = this.contacts.get(chatId);
    const isGroup = chatId.endsWith('@g.us');
    const groupMeta = isGroup ? this.groupMetadata.get(chatId) : null;

    this.chatsOverview.set(chatId, {
      id: chatId,
      name: groupMeta?.subject || contact?.name || contact?.notify || chat?.name || chatId.replace('@s.whatsapp.net', '').replace('@g.us', ''),
      isGroup,
      unreadCount: chat?.unreadCount || 0,
      lastMessage: {
        id: latestMessage?.key?.id,
        timestamp: latestMessage?.messageTimestamp,
        preview: this._extractMessagePreview(latestMessage),
        fromMe: latestMessage?.key?.fromMe || false
      },
      profilePicture: this.profilePictures.get(chatId) || null,
      conversationTimestamp: chat?.conversationTimestamp || latestMessage?.messageTimestamp
    });
  }

  /**
   * Extract message preview text
   */
  _extractMessagePreview(message) {
    if (!message?.message) return '';
    
    const msg = message.message;
    
    if (msg.conversation) return msg.conversation.substring(0, 100);
    if (msg.extendedTextMessage?.text) return msg.extendedTextMessage.text.substring(0, 100);
    if (msg.imageMessage) return '📷 Image';
    if (msg.videoMessage) return '🎥 Video';
    if (msg.audioMessage) return '🎵 Audio';
    if (msg.documentMessage) return `📄 ${msg.documentMessage.fileName || 'Document'}`;
    if (msg.stickerMessage) return '🎭 Sticker';
    if (msg.contactMessage) return `👤 Contact: ${msg.contactMessage.displayName}`;
    if (msg.locationMessage) return '📍 Location';
    if (msg.buttonsMessage) return msg.buttonsMessage.contentText || 'Buttons';
    if (msg.templateMessage) return 'Template Message';
    if (msg.listMessage) return msg.listMessage.title || 'List';
    
    return 'Message';
  }

  /**
   * Invalidate overview cache
   */
  _invalidateOverviewCache() {
    this.lastOverviewUpdate = 0;
  }

  /**
   * Invalidate contacts cache
   */
  _invalidateContactsCache() {
    this.lastContactsUpdate = 0;
    this.contactsCache.clear();
  }

  /**
   * Set profile picture (called from session)
   */
  setProfilePicture(jid, url) {
    this.profilePictures.set(jid, url);
    // Update overview if exists
    const overview = this.chatsOverview.get(jid);
    if (overview) {
      overview.profilePicture = url;
    }
  }

  /**
   * Get cached profile picture
   */
  getProfilePicture(jid) {
    return this.profilePictures.get(jid) || null;
  }

  /**
   * FAST: Get chats overview (uses pre-computed cache)
   */
  getChatsOverviewFast(options = {}) {
    const { limit = 50, offset = 0 } = options;
    
    // Build overview if empty
    if (this.chatsOverview.size === 0) {
      this._rebuildOverviewCache();
    }
    
    // Convert to array and sort by timestamp
    let overview = Array.from(this.chatsOverview.values());
    overview.sort((a, b) => {
      const timeA = a.conversationTimestamp || a.lastMessage?.timestamp || 0;
      const timeB = b.conversationTimestamp || b.lastMessage?.timestamp || 0;
      return timeB - timeA;
    });
    
    // Apply pagination
    return {
      total: overview.length,
      offset,
      limit,
      data: overview.slice(offset, offset + limit)
    };
  }

  /**
   * Rebuild overview cache from scratch
   */
  _rebuildOverviewCache() {
    this.chatsOverview.clear();
    
    for (const [chatId, chatMessages] of this.messages) {
      if (chatMessages.size > 0) {
        this._updateSingleChatOverview(chatId);
      }
    }
  }

  /**
   * FAST: Get contacts (optimized)
   */
  getContactsFast(options = {}) {
    const { limit = 100, offset = 0, search = '' } = options;
    
    let contacts = Array.from(this.contacts.values())
      .filter(c => c.id.endsWith('@s.whatsapp.net'))
      .map(c => ({
        id: c.id,
        name: c.name || c.notify || c.id.replace('@s.whatsapp.net', ''),
        notify: c.notify,
        verifiedName: c.verifiedName,
        profilePicture: this.profilePictures.get(c.id) || null
      }));
    
    // Apply search filter
    if (search) {
      const searchLower = search.toLowerCase();
      contacts = contacts.filter(c => 
        c.name?.toLowerCase().includes(searchLower) ||
        c.notify?.toLowerCase().includes(searchLower) ||
        c.id.includes(search)
      );
    }
    
    // Sort by name
    contacts.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
    
    return {
      total: contacts.length,
      offset,
      limit,
      data: contacts.slice(offset, offset + limit)
    };
  }

  /**
   * Get all chats
   */
  getAllChats() {
    return Array.from(this.chats.values());
  }

  /**
   * Get messages for a specific chat
   */
  getMessages(chatId, options = {}) {
    const { limit = 50, before = null } = options;
    const chatMessages = this.messages.get(chatId);
    
    if (!chatMessages) return [];
    
    let messages = Array.from(chatMessages.values())
      .filter(m => m && m.key && m.messageTimestamp); // Filter invalid messages
    
    messages.sort((a, b) => {
      const timeA = typeof a.messageTimestamp === 'object' ? (a.messageTimestamp.low || 0) : (a.messageTimestamp || 0);
      const timeB = typeof b.messageTimestamp === 'object' ? (b.messageTimestamp.low || 0) : (b.messageTimestamp || 0);
      return timeB - timeA;
    });
    
    if (before) {
      const beforeIndex = messages.findIndex(m => m.key?.id === before);
      if (beforeIndex > -1) {
        messages = messages.slice(beforeIndex + 1);
      }
    }
    
    return messages.slice(0, limit);
  }

  /**
   * Get a specific message by ID from a chat
   */
  getMessage(chatId, messageId) {
    const chatMessages = this.messages.get(chatId);
    if (!chatMessages) return null;
    return chatMessages.get(messageId) || null;
  }

  /**
   * Get a specific contact
   */
  getContact(jid) {
    return this.contacts.get(jid) || null;
  }

  /**
   * Get group metadata
   */
  getGroupMetadata(groupId) {
    return this.groupMetadata.get(groupId) || null;
  }

  /**
   * Get chat by ID
   */
  getChat(chatId) {
    return this.chats.get(chatId) || null;
  }

  /**
   * Safe JSON serialization (handles circular references and binary data)
   */
  _safeSerialize(data) {
    const seen = new WeakSet();
    
    return JSON.stringify(data, (key, value) => {
      // Skip binary data and buffers
      if (value instanceof Uint8Array || value instanceof ArrayBuffer) {
        return undefined;
      }
      if (Buffer.isBuffer && Buffer.isBuffer(value)) {
        return undefined;
      }
      
      // Skip functions
      if (typeof value === 'function') {
        return undefined;
      }
      
      // Handle circular references
      if (typeof value === 'object' && value !== null) {
        if (seen.has(value)) {
          return undefined;
        }
        seen.add(value);
      }
      
      return value;
    }, 2);
  }

  /**
   * Write store to file (for persistence) - FIXED JSON serialization
   */
  writeToFile(filePath) {
    const fs = require('fs');
    const path = require('path');
    
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      
      // Convert Maps to arrays for serialization
      const data = {
        chats: Array.from(this.chats.entries()),
        contacts: Array.from(this.contacts.entries()),
        messages: Array.from(this.messages.entries()).map(([chatId, msgs]) => [
          chatId,
          Array.from(msgs.entries()).slice(-100) // Keep only last 100 messages per chat
        ]),
        groupMetadata: Array.from(this.groupMetadata.entries()),
        profilePictures: Array.from(this.profilePictures.entries())
      };
      
      // Use safe serialization to avoid .enc or corrupted files
      const jsonContent = this._safeSerialize(data);
      
      // Write to temp file first, then rename (atomic write)
      const tempPath = filePath + '.tmp';
      fs.writeFileSync(tempPath, jsonContent, 'utf8');
      
      // Rename temp to final (atomic on most filesystems)
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
      fs.renameSync(tempPath, filePath);
      
      return true;
    } catch (error) {
      console.error('Error writing store to file:', error.message);
      return false;
    }
  }

  /**
   * Read store from file (for restoration)
   */
  readFromFile(filePath) {
    const fs = require('fs');
    
    try {
      if (!fs.existsSync(filePath)) {
        return false;
      }
      
      const content = fs.readFileSync(filePath, 'utf8');
      
      // Validate JSON before parsing
      if (!content || content.trim() === '') {
        console.warn('Store file is empty');
        return false;
      }
      
      // Check if file is corrupted (e.g., .enc issue)
      if (!content.startsWith('{')) {
        console.warn('Store file appears corrupted, skipping restore');
        // Delete corrupted file
        fs.unlinkSync(filePath);
        return false;
      }
      
      const data = JSON.parse(content);
      
      // Restore Maps
      if (data.chats) {
        this.chats = new Map(data.chats);
      }
      if (data.contacts) {
        this.contacts = new Map(data.contacts);
      }
      if (data.messages) {
        this.messages = new Map(
          data.messages.map(([chatId, msgs]) => [chatId, new Map(msgs)])
        );
      }
      if (data.groupMetadata) {
        this.groupMetadata = new Map(data.groupMetadata);
      }
      if (data.profilePictures) {
        this.profilePictures = new Map(data.profilePictures);
      }
      
      // Rebuild overview cache after restore
      this._rebuildOverviewCache();
      
      return true;
    } catch (error) {
      console.error('Error reading store from file:', error.message);
      return false;
    }
  }

  /**
   * Clear all data
   */
  clear() {
    // Clean up all media files first
    this._cleanupAllMedia();
    
    this.chats.clear();
    this.contacts.clear();
    this.messages.clear();
    this.groupMetadata.clear();
    this.chatsOverview.clear();
    this.profilePictures.clear();
    this.contactsCache.clear();
    this.mediaFiles.clear();
  }

  /**
   * Get store statistics
   */
  getStats() {
    let totalMessages = 0;
    for (const [, chatMessages] of this.messages) {
      totalMessages += chatMessages.size;
    }
    
    return {
      chats: this.chats.size,
      contacts: this.contacts.size,
      messages: totalMessages,
      groups: this.groupMetadata.size,
      mediaFiles: this.mediaFiles.size
    };
  }

  /**
   * Register a media file for a message
   */
  registerMediaFile(messageId, filePath) {
    this.mediaFiles.set(messageId, filePath);
  }

  /**
   * Delete media file for a message
   */
  _deleteMediaFile(messageId) {
    const fs = require('fs');
    const filePath = this.mediaFiles.get(messageId);
    if (filePath) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`🗑️ [${this.sessionId}] Media deleted: ${filePath}`);
        }
      } catch (e) {
        // Silent fail
      }
      this.mediaFiles.delete(messageId);
    }
  }

  /**
   * Cleanup all media files
   */
  _cleanupAllMedia() {
    const fs = require('fs');
    for (const [messageId, filePath] of this.mediaFiles) {
      try {
        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (e) {
        // Silent fail
      }
    }
    this.mediaFiles.clear();
  }

  /**
   * Cleanup old media files (keep only last N messages per chat)
   */
  cleanupOldMedia(maxMessagesPerChat = 100) {
    const fs = require('fs');
    const messagesToKeep = new Set();
    
    // Collect message IDs that should be kept
    for (const [chatId, chatMessages] of this.messages) {
      const msgs = Array.from(chatMessages.values())
        .filter(m => m && m.messageTimestamp)
        .sort((a, b) => {
          const timeA = typeof a.messageTimestamp === 'object' ? (a.messageTimestamp.low || 0) : (a.messageTimestamp || 0);
          const timeB = typeof b.messageTimestamp === 'object' ? (b.messageTimestamp.low || 0) : (b.messageTimestamp || 0);
          return timeB - timeA;
        })
        .slice(0, maxMessagesPerChat);
      
      for (const msg of msgs) {
        if (msg.key?.id) {
          messagesToKeep.add(msg.key.id);
        }
      }
    }
    
    // Delete media files for messages that will be removed
    for (const [messageId, filePath] of this.mediaFiles) {
      if (!messagesToKeep.has(messageId)) {
        try {
          if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            console.log(`🗑️ [${this.sessionId}] Old media cleaned: ${filePath}`);
          }
        } catch (e) {
          // Silent fail
        }
        this.mediaFiles.delete(messageId);
      }
    }
  }
}

module.exports = BaileysStore;
