const { describe, it } = require('node:test');
const assert = require('node:assert/strict');
const MessageFormatter = require('../../src/services/whatsapp/MessageFormatter');

describe('MessageFormatter', () => {
    describe('formatMessage()', () => {
        it('should return null when msg or msg.message is missing or invalid', () => {
            assert.equal(MessageFormatter.formatMessage(null), null);
            assert.equal(MessageFormatter.formatMessage(undefined), null);
            assert.equal(MessageFormatter.formatMessage({}), null);
            assert.equal(MessageFormatter.formatMessage({ key: {} }), null);
        });

        it('should format simple text message (conversation)', () => {
            const rawMsg = {
                key: {
                    id: 'MSG_001',
                    remoteJid: '6281234567890@s.whatsapp.net',
                    fromMe: false
                },
                pushName: 'Budi',
                messageTimestamp: 1700000000,
                message: {
                    conversation: 'Halo apa kabar?'
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.id, 'MSG_001');
            assert.equal(formatted.chatId, '6281234567890@s.whatsapp.net');
            assert.equal(formatted.fromMe, false);
            assert.equal(formatted.sender, '6281234567890@s.whatsapp.net');
            assert.equal(formatted.senderPhone, '6281234567890');
            assert.equal(formatted.senderName, 'Budi');
            assert.equal(formatted.timestamp, 1700000000);
            assert.equal(formatted.type, 'text');
            assert.equal(formatted.content, 'Halo apa kabar?');
            assert.equal(formatted.isGroup, false);
            assert.equal(formatted.caption, null);
            assert.equal(formatted.mimetype, null);
            assert.equal(formatted.filename, null);
            assert.equal(formatted.mediaUrl, null);
            assert.equal(formatted.quotedMessage, null);
        });

        it('should format extended text message and handle Long timestamp object', () => {
            const rawMsg = {
                key: {
                    id: 'MSG_002',
                    remoteJid: '6281234567890@s.whatsapp.net',
                    fromMe: true
                },
                pushName: 'Admin',
                messageTimestamp: { low: 1700001000, high: 0, unsigned: true },
                message: {
                    extendedTextMessage: {
                        text: 'Pesan teks panjang atau dengan link'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.id, 'MSG_002');
            assert.equal(formatted.fromMe, true);
            assert.equal(formatted.timestamp, 1700001000);
            assert.equal(formatted.type, 'text');
            assert.equal(formatted.content, 'Pesan teks panjang atau dengan link');
        });

        it('should format image message with caption, mimetype and mediaUrl', () => {
            const rawMsg = {
                key: {
                    id: 'IMG_001',
                    remoteJid: '6281234567890@s.whatsapp.net',
                    fromMe: false
                },
                _mediaPath: '/media/images/IMG_001.jpg',
                message: {
                    imageMessage: {
                        caption: 'Foto pemandangan indah',
                        mimetype: 'image/jpeg'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'image');
            assert.equal(formatted.caption, 'Foto pemandangan indah');
            assert.equal(formatted.mimetype, 'image/jpeg');
            assert.equal(formatted.mediaUrl, '/media/images/IMG_001.jpg');
        });

        it('should format video message with caption and mimetype', () => {
            const rawMsg = {
                key: {
                    id: 'VID_001',
                    remoteJid: '6281234567890@s.whatsapp.net',
                    fromMe: false
                },
                message: {
                    videoMessage: {
                        caption: 'Tutorial video',
                        mimetype: 'video/mp4'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'video');
            assert.equal(formatted.caption, 'Tutorial video');
            assert.equal(formatted.mimetype, 'video/mp4');
        });

        it('should format audio message (standard audio vs PTT voice note)', () => {
            const regularAudioMsg = {
                key: { id: 'AUD_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    audioMessage: {
                        mimetype: 'audio/mp3',
                        ptt: false
                    }
                }
            };

            const pttMsg = {
                key: { id: 'AUD_002', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    audioMessage: {
                        mimetype: 'audio/ogg; codecs=opus',
                        ptt: true
                    }
                }
            };

            const formattedAudio = MessageFormatter.formatMessage(regularAudioMsg);
            assert.equal(formattedAudio.type, 'audio');
            assert.equal(formattedAudio.mimetype, 'audio/mp3');

            const formattedPtt = MessageFormatter.formatMessage(pttMsg);
            assert.equal(formattedPtt.type, 'ptt');
            assert.equal(formattedPtt.mimetype, 'audio/ogg; codecs=opus');
        });

        it('should format document message with fileName and mimetype', () => {
            const rawMsg = {
                key: { id: 'DOC_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    documentMessage: {
                        fileName: 'Financial_Report_2026.pdf',
                        mimetype: 'application/pdf'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'document');
            assert.equal(formatted.filename, 'Financial_Report_2026.pdf');
            assert.equal(formatted.mimetype, 'application/pdf');
        });

        it('should format sticker message', () => {
            const rawMsg = {
                key: { id: 'STK_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    stickerMessage: {
                        mimetype: 'image/webp'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'sticker');
            assert.equal(formatted.mimetype, 'image/webp');
        });

        it('should format location message', () => {
            const rawMsg = {
                key: { id: 'LOC_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    locationMessage: {
                        degreesLatitude: -6.2088,
                        degreesLongitude: 106.8456,
                        name: 'Monumen Nasional',
                        address: 'Gambir, Jakarta Pusat'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'location');
            assert.deepEqual(formatted.content, {
                latitude: -6.2088,
                longitude: 106.8456,
                name: 'Monumen Nasional',
                address: 'Gambir, Jakarta Pusat'
            });
        });

        it('should format contact message', () => {
            const rawMsg = {
                key: { id: 'CNT_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    contactMessage: {
                        displayName: 'Siti Rahma',
                        vcard: 'BEGIN:VCARD\nFN:Siti Rahma\nTEL:+62811111111\nEND:VCARD'
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'contact');
            assert.deepEqual(formatted.content, {
                displayName: 'Siti Rahma',
                vcard: 'BEGIN:VCARD\nFN:Siti Rahma\nTEL:+62811111111\nEND:VCARD'
            });
        });

        it('should format contacts array message', () => {
            const rawMsg = {
                key: { id: 'CNTS_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    contactsArrayMessage: {
                        contacts: [
                            { displayName: 'Alice', vcard: 'VCARD_ALICE' },
                            { displayName: 'Bob', vcard: 'VCARD_BOB' }
                        ]
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'contacts');
            assert.deepEqual(formatted.content, [
                { displayName: 'Alice', vcard: 'VCARD_ALICE' },
                { displayName: 'Bob', vcard: 'VCARD_BOB' }
            ]);
        });

        it('should format reaction message', () => {
            const rawMsg = {
                key: { id: 'RCT_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    reactionMessage: {
                        text: '❤️',
                        key: { id: 'ORIGINAL_MSG_99' }
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'reaction');
            assert.deepEqual(formatted.content, {
                emoji: '❤️',
                targetMessageId: 'ORIGINAL_MSG_99'
            });
        });

        it('should format poll creation messages (standard, V2, and V3)', () => {
            // Standard
            const pollMsg1 = {
                key: { id: 'POL_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    pollCreationMessage: {
                        name: 'Makan siang apa?',
                        options: [{ optionName: 'Nasi Padang' }, { optionName: 'Bakso' }],
                        selectableOptionsCount: 1
                    }
                }
            };
            const formatted1 = MessageFormatter.formatMessage(pollMsg1);
            assert.equal(formatted1.type, 'poll');
            assert.deepEqual(formatted1.content, {
                question: 'Makan siang apa?',
                options: ['Nasi Padang', 'Bakso'],
                selectableCount: 1
            });

            // V2
            const pollMsg2 = {
                key: { id: 'POL_002', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    pollCreationMessageV2: {
                        name: 'Pilih jadwal rapat',
                        options: [{ optionName: 'Senin' }, { optionName: 'Rabu' }],
                        selectableOptionsCount: 2
                    }
                }
            };
            const formatted2 = MessageFormatter.formatMessage(pollMsg2);
            assert.equal(formatted2.type, 'poll');
            assert.equal(formatted2.content.selectableCount, 2);

            // V3 with default selectable count
            const pollMsg3 = {
                key: { id: 'POL_003', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    pollCreationMessageV3: {
                        name: 'Poll V3',
                        options: [{ optionName: 'Pilihan A' }]
                    }
                }
            };
            const formatted3 = MessageFormatter.formatMessage(pollMsg3);
            assert.equal(formatted3.type, 'poll');
            assert.equal(formatted3.content.selectableCount, 1);
        });

        it('should format poll update message (vote)', () => {
            const rawMsg = {
                key: { id: 'VOT_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    pollUpdateMessage: {
                        pollCreationMessageKey: {
                            id: 'POL_001',
                            fromMe: false,
                            remoteJid: '6281234567890@s.whatsapp.net'
                        },
                        vote: {
                            selectedOptions: [Buffer.from('Option1Hash', 'utf8')]
                        }
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'poll_vote');
            assert.equal(formatted.content.pollCreationMessageKey.id, 'POL_001');
            assert.equal(formatted.content.pollCreationMessageKey.fromMe, false);
            assert.equal(formatted.content.selectedOptions[0], Buffer.from('Option1Hash', 'utf8').toString('hex'));
        });

        it('should format protocol message', () => {
            const rawMsg = {
                key: { id: 'PRT_001', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    protocolMessage: {
                        type: 5 // e.g. ephemeral settings or revoke
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.type, 'protocol');
            assert.equal(formatted.content, 5);
        });

        it('should handle group message correctly and detect participant sender', () => {
            const rawMsg = {
                key: {
                    id: 'GRP_001',
                    remoteJid: '1203630123456789@g.us',
                    participant: '6281122334455@s.whatsapp.net',
                    fromMe: false
                },
                pushName: 'Charlie',
                message: {
                    conversation: 'Halo anggota grup'
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.equal(formatted.isGroup, true);
            assert.equal(formatted.chatId, '1203630123456789@g.us');
            assert.equal(formatted.sender, '6281122334455@s.whatsapp.net');
            assert.equal(formatted.senderPhone, '6281122334455');
        });
    });

    describe('LID JID Resolution with store', () => {
        it('should resolve LID chatId and sender using store.resolveIdentity', () => {
            const mockStore = {
                resolveIdentity(lid) {
                    if (lid === '10001@lid') {
                        return { jid: '6281234567890@s.whatsapp.net', pn: '6281234567890', lid: '10001@lid' };
                    }
                    if (lid === '20002@lid') {
                        return { jid: '6289876543210@s.whatsapp.net', pn: '6289876543210', lid: '20002@lid' };
                    }
                    return null;
                }
            };

            const rawMsg = {
                key: {
                    id: 'LID_MSG_1',
                    remoteJid: '10001@lid',
                    participant: '20002@lid'
                },
                message: {
                    conversation: 'Test resolusi LID'
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg, mockStore);

            assert.equal(formatted.chatId, '6281234567890@s.whatsapp.net');
            assert.equal(formatted.sender, '6289876543210@s.whatsapp.net');
            assert.equal(formatted.senderPhone, '6289876543210');
        });

        it('should keep raw LID when store is not provided or resolveIdentity returns null', () => {
            const rawMsg = {
                key: {
                    id: 'LID_MSG_2',
                    remoteJid: '10001@lid',
                    participant: '20002@lid'
                },
                message: {
                    conversation: 'Tanpa store resolusi'
                }
            };

            // Without store
            const formattedNoStore = MessageFormatter.formatMessage(rawMsg, null);
            assert.equal(formattedNoStore.chatId, '10001@lid');
            assert.equal(formattedNoStore.sender, '20002@lid');

            // With store returning null
            const mockEmptyStore = { resolveIdentity: () => null };
            const formattedUnknown = MessageFormatter.formatMessage(rawMsg, mockEmptyStore);
            assert.equal(formattedUnknown.chatId, '10001@lid');
            assert.equal(formattedUnknown.sender, '20002@lid');
        });
    });

    describe('Quoted Message Parsing', () => {
        it('should correctly parse quotedMessage with stanzaId and sender', () => {
            const rawMsg = {
                key: {
                    id: 'REPLY_001',
                    remoteJid: '6281234567890@s.whatsapp.net'
                },
                message: {
                    extendedTextMessage: {
                        text: 'Saya balas pesan ini',
                        contextInfo: {
                            stanzaId: 'ORIG_001',
                            participant: '6289876543210@s.whatsapp.net',
                            quotedMessage: {
                                conversation: 'Pesan asli yang dibalas'
                            }
                        }
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);

            assert.notEqual(formatted.quotedMessage, null);
            assert.equal(formatted.quotedMessage.id, 'ORIG_001');
            assert.equal(formatted.quotedMessage.sender, '6289876543210@s.whatsapp.net');
        });

        it('should resolve quotedMessage LID sender when store is provided', () => {
            const mockStore = {
                resolveIdentity(lid) {
                    if (lid === '99999@lid') {
                        return { jid: '628111222333@s.whatsapp.net' };
                    }
                    return null;
                }
            };

            const rawMsg = {
                key: {
                    id: 'REPLY_002',
                    remoteJid: '6281234567890@s.whatsapp.net'
                },
                message: {
                    extendedTextMessage: {
                        text: 'Membalas LID sender',
                        contextInfo: {
                            stanzaId: 'ORIG_002',
                            participant: '99999@lid',
                            quotedMessage: {
                                conversation: 'Pesan dari user LID'
                            }
                        }
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg, mockStore);

            assert.notEqual(formatted.quotedMessage, null);
            assert.equal(formatted.quotedMessage.id, 'ORIG_002');
            assert.equal(formatted.quotedMessage.sender, '628111222333@s.whatsapp.net');
        });

        it('should return null for quotedMessage when contextInfo has no quotedMessage', () => {
            const rawMsg = {
                key: { id: 'MSG_NO_QUOTE', remoteJid: '6281234567890@s.whatsapp.net' },
                message: {
                    extendedTextMessage: {
                        text: 'Pesan tanpa quote',
                        contextInfo: {
                            mentionedJid: ['6281234567890@s.whatsapp.net']
                        }
                    }
                }
            };

            const formatted = MessageFormatter.formatMessage(rawMsg);
            assert.equal(formatted.quotedMessage, null);
        });
    });

    describe('formatLastMessagePreview()', () => {
        it('should return null when input message is null or empty', () => {
            assert.equal(MessageFormatter.formatLastMessagePreview(null), null);
            assert.equal(MessageFormatter.formatLastMessagePreview({}), null);
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: null }), null);
        });

        it('should format preview for conversation text', () => {
            const rawMsg = {
                key: { fromMe: false },
                messageTimestamp: 1700000000,
                message: { conversation: 'Halo semuanya' }
            };

            const preview = MessageFormatter.formatLastMessagePreview(rawMsg);
            assert.deepEqual(preview, {
                type: 'text',
                text: 'Halo semuanya',
                fromMe: false,
                timestamp: 1700000000
            });
        });

        it('should truncate preview text if longer than 100 characters', () => {
            const longString = 'a'.repeat(120);
            const rawMsg = {
                key: { fromMe: true },
                messageTimestamp: 1700000000,
                message: { conversation: longString }
            };

            const preview = MessageFormatter.formatLastMessagePreview(rawMsg);
            assert.equal(preview.text.length, 103); // 100 + '...'
            assert.equal(preview.text.endsWith('...'), true);
            assert.equal(preview.text, 'a'.repeat(100) + '...');
        });

        it('should format preview for image with and without caption', () => {
            const withCaption = {
                message: { imageMessage: { caption: 'Foto liburan' } }
            };
            const preview1 = MessageFormatter.formatLastMessagePreview(withCaption);
            assert.equal(preview1.type, 'image');
            assert.equal(preview1.text, 'Foto liburan');

            const withoutCaption = {
                message: { imageMessage: {} }
            };
            const preview2 = MessageFormatter.formatLastMessagePreview(withoutCaption);
            assert.equal(preview2.type, 'image');
            assert.equal(preview2.text, '📷 Photo');
        });

        it('should format preview for video with and without caption', () => {
            const withCaption = {
                message: { videoMessage: { caption: 'Video seru' } }
            };
            const preview1 = MessageFormatter.formatLastMessagePreview(withCaption);
            assert.equal(preview1.type, 'video');
            assert.equal(preview1.text, 'Video seru');

            const withoutCaption = {
                message: { videoMessage: {} }
            };
            const preview2 = MessageFormatter.formatLastMessagePreview(withoutCaption);
            assert.equal(preview2.type, 'video');
            assert.equal(preview2.text, '🎥 Video');
        });

        it('should format preview for audio and voice notes (ptt)', () => {
            const audio = {
                message: { audioMessage: { ptt: false } }
            };
            const previewAudio = MessageFormatter.formatLastMessagePreview(audio);
            assert.equal(previewAudio.type, 'audio');
            assert.equal(previewAudio.text, '🎵 Audio');

            const ptt = {
                message: { audioMessage: { ptt: true } }
            };
            const previewPtt = MessageFormatter.formatLastMessagePreview(ptt);
            assert.equal(previewPtt.type, 'ptt');
            assert.equal(previewPtt.text, '🎤 Voice message');
        });

        it('should format preview for document', () => {
            const withFileName = {
                message: { documentMessage: { fileName: 'Tugas.docx' } }
            };
            const previewDoc = MessageFormatter.formatLastMessagePreview(withFileName);
            assert.equal(previewDoc.type, 'document');
            assert.equal(previewDoc.text, '📄 Tugas.docx');

            const withoutFileName = {
                message: { documentMessage: {} }
            };
            const previewDefaultDoc = MessageFormatter.formatLastMessagePreview(withoutFileName);
            assert.equal(previewDefaultDoc.text, '📄 Document');
        });

        it('should format preview for sticker, location, contact, reaction, poll and poll vote', () => {
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { stickerMessage: {} } }).text, '🏷️ Sticker');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { locationMessage: {} } }).text, '📍 Location');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { contactMessage: { displayName: 'Fajri' } } }).text, '👤 Fajri');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { reactionMessage: { text: '🔥' } } }).text, '🔥');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { reactionMessage: {} } }).text, '👍');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { pollCreationMessage: { name: 'Makan siang?' } } }).text, '📊 Makan siang?');
            assert.equal(MessageFormatter.formatLastMessagePreview({ message: { pollUpdateMessage: {} } }).text, '📊 Poll vote');
        });
    });
});
