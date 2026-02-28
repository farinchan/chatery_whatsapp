/**
 * Message Formatter Utility
 * Format pesan WhatsApp untuk response API
 */
class MessageFormatter {
    /**
     * Format message untuk response
     * @param {Object} msg - Raw message object dari Baileys
     * @returns {Object|null}
     */
    static formatMessage(msg) {
        if (!msg || !msg.message) return null;

        const messageContent = msg.message;
        let type = 'unknown';
        let content = null;
        let caption = null;
        let mimetype = null;
        let filename = null;

        if (messageContent?.conversation) {
            type = 'text';
            content = messageContent.conversation;
        } else if (messageContent?.extendedTextMessage) {
            type = 'text';
            content = messageContent.extendedTextMessage.text;
        } else if (messageContent?.imageMessage) {
            type = 'image';
            caption = messageContent.imageMessage.caption || null;
            mimetype = messageContent.imageMessage.mimetype || null;
        } else if (messageContent?.videoMessage) {
            type = 'video';
            caption = messageContent.videoMessage.caption || null;
            mimetype = messageContent.videoMessage.mimetype || null;
        } else if (messageContent?.audioMessage) {
            type = messageContent.audioMessage.ptt ? 'ptt' : 'audio';
            mimetype = messageContent.audioMessage.mimetype || null;
        } else if (messageContent?.documentMessage) {
            type = 'document';
            filename = messageContent.documentMessage.fileName || null;
            mimetype = messageContent.documentMessage.mimetype || null;
        } else if (messageContent?.stickerMessage) {
            type = 'sticker';
            mimetype = messageContent.stickerMessage.mimetype || null;
        } else if (messageContent?.locationMessage) {
            type = 'location';
            content = {
                latitude: messageContent.locationMessage.degreesLatitude,
                longitude: messageContent.locationMessage.degreesLongitude,
                name: messageContent.locationMessage.name || null,
                address: messageContent.locationMessage.address || null
            };
        } else if (messageContent?.contactMessage) {
            type = 'contact';
            content = {
                displayName: messageContent.contactMessage.displayName,
                vcard: messageContent.contactMessage.vcard
            };
        } else if (messageContent?.contactsArrayMessage) {
            type = 'contacts';
            content = messageContent.contactsArrayMessage.contacts?.map(c => ({
                displayName: c.displayName,
                vcard: c.vcard
            }));
        } else if (messageContent?.reactionMessage) {
            type = 'reaction';
            content = {
                emoji: messageContent.reactionMessage.text,
                targetMessageId: messageContent.reactionMessage.key?.id
            };
        } else if (messageContent?.pollCreationMessage || messageContent?.pollCreationMessageV2 || messageContent?.pollCreationMessageV3) {
            type = 'poll';
            const pollMsg = messageContent.pollCreationMessage || messageContent.pollCreationMessageV2 || messageContent.pollCreationMessageV3;
            content = {
                question: pollMsg.name,
                options: pollMsg.options?.map(o => o.optionName) || [],
                selectableCount: pollMsg.selectableOptionsCount || 1
            };
        } else if (messageContent?.pollUpdateMessage) {
            type = 'poll_vote';
            const pollVote = messageContent.pollUpdateMessage;
            content = {
                pollCreationMessageKey: pollVote.pollCreationMessageKey ? {
                    id: pollVote.pollCreationMessageKey.id,
                    fromMe: pollVote.pollCreationMessageKey.fromMe || false,
                    remoteJid: pollVote.pollCreationMessageKey.remoteJid
                } : null,
                selectedOptions: pollVote.vote?.selectedOptions?.map(opt => opt.toString('hex')) || []
            };
        } else if (messageContent?.protocolMessage) {
            type = 'protocol';
            content = messageContent.protocolMessage.type;
        }

        return {
            id: msg.key.id,
            chatId: msg.key.remoteJid,
            fromMe: msg.key.fromMe || false,
            sender: msg.key.participant || msg.key.remoteJid,
            senderPhone: (msg.key.participant || msg.key.remoteJid)?.split('@')[0],
            senderName: msg.pushName || null,
            timestamp: typeof msg.messageTimestamp === 'object' 
                ? msg.messageTimestamp.low 
                : msg.messageTimestamp,
            type: type,
            content: content,
            caption: caption,
            mimetype: mimetype,
            filename: filename,
            mediaUrl: msg._mediaPath || null,  // URL to access saved media
            isGroup: msg.key.remoteJid?.includes('@g.us') || false,
            quotedMessage: msg.message?.extendedTextMessage?.contextInfo?.quotedMessage ? {
                id: msg.message.extendedTextMessage.contextInfo.stanzaId,
                sender: msg.message.extendedTextMessage.contextInfo.participant
            } : null
        };
    }

    /**
     * Format last message preview untuk chat overview
     * @param {Object} msg - Raw message object
     * @returns {Object|null}
     */
    static formatLastMessagePreview(msg) {
        if (!msg || !msg.message) return null;

        const content = msg.message;
        let type = 'unknown';
        let text = null;

        if (content.conversation) {
            type = 'text';
            text = content.conversation;
        } else if (content.extendedTextMessage?.text) {
            type = 'text';
            text = content.extendedTextMessage.text;
        } else if (content.imageMessage) {
            type = 'image';
            text = content.imageMessage.caption || '📷 Photo';
        } else if (content.videoMessage) {
            type = 'video';
            text = content.videoMessage.caption || '🎥 Video';
        } else if (content.audioMessage) {
            type = content.audioMessage.ptt ? 'ptt' : 'audio';
            text = content.audioMessage.ptt ? '🎤 Voice message' : '🎵 Audio';
        } else if (content.documentMessage) {
            type = 'document';
            text = `📄 ${content.documentMessage.fileName || 'Document'}`;
        } else if (content.stickerMessage) {
            type = 'sticker';
            text = '🏷️ Sticker';
        } else if (content.locationMessage) {
            type = 'location';
            text = '📍 Location';
        } else if (content.contactMessage) {
            type = 'contact';
            text = `👤 ${content.contactMessage.displayName || 'Contact'}`;
        } else if (content.reactionMessage) {
            type = 'reaction';
            text = content.reactionMessage.text || '👍';
        } else if (content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3) {
            type = 'poll';
            const pollMsg = content.pollCreationMessage || content.pollCreationMessageV2 || content.pollCreationMessageV3;
            text = `📊 ${pollMsg.name || 'Poll'}`;
        } else if (content.pollUpdateMessage) {
            type = 'poll_vote';
            text = '📊 Poll vote';
        }

        return {
            type: type,
            text: text ? (text.length > 100 ? text.substring(0, 100) + '...' : text) : null,
            fromMe: msg.key?.fromMe || false,
            timestamp: msg.messageTimestamp || 0
        };
    }
}

module.exports = MessageFormatter;
