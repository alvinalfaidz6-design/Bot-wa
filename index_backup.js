const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion, downloadContentFromMessage } = require('@whiskeysockets/baileys');
const pino = require('pino');
const sqlite3 = require('sqlite3').verbose();
const fs = require('fs');
const path = require('path');
const axios = require('axios');
const readline = require('readline');

const GEMINI_API_KEY = 'AQ.Ab8RN6L79M1U-9RnrqkbwYmwDubUcQ9q_Aq1Of1b1jUjPfAmPg';
const OWNER_NUMBERS = ['628987538404'];

const mediaDir = path.join(__dirname, 'kenangan_media');
if (!fs.existsSync(mediaDir)) fs.mkdirSync(mediaDir, { recursive: true });

const vaultMediaDir = path.join(__dirname, 'vault_media_dir');
if (!fs.existsSync(vaultMediaDir)) fs.mkdirSync(vaultMediaDir, { recursive: true });

const verifyMediaDir = path.join(__dirname, 'verifikasi_media');
if (!fs.existsSync(verifyMediaDir)) fs.mkdirSync(verifyMediaDir, { recursive: true });

const db = new sqlite3.Database('./wabot.db', (err) => {
    if (err) console.error('Gagal terhubung ke database:', err.message);
});

db.run(`CREATE TABLE IF NOT EXISTS kenangan (id INTEGER PRIMARY KEY AUTOINCREMENT, tipe TEXT, pesan TEXT, media_path TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS pesan_grup (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, pesan TEXT, waktu DATETIME DEFAULT CURRENT_TIMESTAMP)`);
db.run(`CREATE TABLE IF NOT EXISTS catatan (id INTEGER PRIMARY KEY AUTOINCREMENT, judul TEXT, isi TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS todo (id INTEGER PRIMARY KEY AUTOINCREMENT, kegiatan TEXT, status TEXT DEFAULT 'PENDING')`);
db.run(`CREATE TABLE IF NOT EXISTS warning_toxic (sender TEXT PRIMARY KEY, count INTEGER)`);
db.run(`CREATE TABLE IF NOT EXISTS tribunal_active (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT, suspect TEXT, votes_kick INTEGER DEFAULT 0, votes_pardon INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS vault_rahasia (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, pesan TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS member_registry (jid TEXT PRIMARY KEY, group_id TEXT, joined_at DATETIME DEFAULT CURRENT_TIMESTAMP, role TEXT DEFAULT 'Newcomer', verified INTEGER DEFAULT 0)`);
db.run(`CREATE TABLE IF NOT EXISTS vault_media (id INTEGER PRIMARY KEY AUTOINCREMENT, sender TEXT, tipe TEXT, media_path TEXT, caption TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS group_persona (group_id TEXT PRIMARY KEY, persona TEXT)`);
db.run(`CREATE TABLE IF NOT EXISTS rgp_player (jid TEXT PRIMARY KEY, hp INTEGER DEFAULT 100, attack INTEGER DEFAULT 25, level INTEGER DEFAULT 1)`);
db.run(`CREATE TABLE IF NOT EXISTS ai_memory (id INTEGER PRIMARY KEY AUTOINCREMENT, group_id TEXT, memory_data TEXT)`);

const badWords = ['anjing', 'babi', 'anjg', 'bangsat', 'kontol', 'memek', 'tod', 'ngentot', 'asu', 'jancok', 'goblok', 'tolol'];

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
const question = (text) => new Promise((resolve) => rl.question(text, resolve));

async function startBot() {
    const { state, saveCreds } = await useMultiFileAuthState('sessions');
    const { version } = await fetchLatestBaileysVersion();

    const sock = makeWASocket({
        version,
        logger: pino({ level: 'silent' }),
        auth: state,
        printQRInTerminal: false
    });

    if (!sock.authState.creds.registered) {
        console.clear();
        let phoneNumber = await question('\n📱 Masukkan nomor WhatsApp bot (Awali dengan 62): ');
        phoneNumber = phoneNumber.replace(/[^0-9]/g, '');

        await new Promise(resolve => setTimeout(resolve, 3000));
        try {
            const code = await sock.requestPairingCode(phoneNumber);
            console.log(`\n🔑 KODE PAIRING ANDA: ${code?.match(/.{1,4}/g)?.join('-') || code}\n`);
        } catch (err) {
            console.error('Gagal meminta kode pairing:', err);
        }
    }

    sock.ev.on('connection.update', (update) => {
        const { connection, lastDisconnect } = update;
        if (connection === 'close') {
            const reason = lastDisconnect?.error?.output?.statusCode;
            if (reason !== DisconnectReason.loggedOut) setTimeout(startBot, 3000);
        } else if (connection === 'open') {
            console.log('=== BOT Z.A.Z ACTIVE & SECURE ===');
        }
    });

    sock.ev.on('creds.update', saveCreds);

    sock.ev.on('group-participants.update', async (anu) => {
        try {
            if (anu.action === 'add') {
                for (let num of anu.participants) {
                    db.run(`INSERT OR REPLACE INTO member_registry (jid, group_id, role, verified) VALUES (?, ?, 'Newcomer', 0)`, [num, anu.id]);

                    let ppUrl;
                    try {
                        ppUrl = await sock.profilePictureUrl(num, 'image');
                    } catch {
                        ppUrl = 'https://i.ibb.co/3S4kbrg/default-pp.jpg';
                    }

                    const welcomeTxt = `📸 *WELCOME MEMBER CARD* 📸\n\n` +
                                       `Halo @${num.split('@')[0]} 👋\n` +
                                       `Selamat datang di grup!\n\n` +
                                       `🎖️ *Role Awal:* Newcomer\n` +
                                       `🔒 *Status:* Belum Terverifikasi\n\n` +
                                       `👉 *Kirim foto selfie muka kamu dengan caption/balas* \`!verifikasi\` *untuk verifikasi member baru!*`;

                    await sock.sendMessage(anu.id, {
                        image: { url: ppUrl },
                        caption: welcomeTxt,
                        mentions: [num]
                    });
                }
            } else if (anu.action === 'remove') {
                for (let num of anu.participants) {
                    let ppUrl;
                    try {
                        ppUrl = await sock.profilePictureUrl(num, 'image');
                    } catch {
                        ppUrl = 'https://i.ibb.co/3S4kbrg/default-pp.jpg';
                    }

                    const leaveTxt = `👋 *GOODBYE MEMBER CARD* 👋\n\n` +
                                     `Sayang sekali @${num.split('@')[0]} telah meninggalkan grup ini.\n\n` +
                                     `Terima kasih telah bergabung dan semoga sukses selalu di luar sana! ✨`;

                    await sock.sendMessage(anu.id, {
                        image: { url: ppUrl },
                        caption: leaveTxt,
                        mentions: [num]
                    });
                }
            }
        } catch (e) {
            console.error('Error Group Participant Event:', e);
        }
    });

    sock.ev.on('messages.upsert', async ({ messages }) => {
        try {
            const m = messages[0];
            if (!m.message) return;

            const from = m.key.remoteJid;
            const senderJid = m.key.participant || from;
            const senderNumber = senderJid.split('@')[0];
            const isGroup = from.endsWith('@g.us');
            const isMe = m.key.fromMe;

            let msgContent = m.message;
            if (msgContent.ephemeralMessage) msgContent = msgContent.ephemeralMessage.message;
            if (msgContent.viewOnceMessage) msgContent = msgContent.viewOnceMessage.message;
            if (msgContent.viewOnceMessageV2) msgContent = msgContent.viewOnceMessageV2.message;

            let body = '';
            if (msgContent.conversation) body = msgContent.conversation;
            else if (msgContent.extendedTextMessage) body = msgContent.extendedTextMessage.text;
            else if (msgContent.imageMessage) body = msgContent.imageMessage.caption || '';
            else if (msgContent.videoMessage) body = msgContent.videoMessage.caption || '';

            const isOwner = OWNER_NUMBERS.includes(senderNumber);
            let isAdmin = false;
            if (isGroup) {
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants || [];
                    const participant = participants.find(p => p.id === senderJid);
                    if (participant && (participant.admin === 'admin' || participant.admin === 'superadmin')) {
                        isAdmin = true;
                    }
                } catch (e) {}
            }

            const isImmune = isOwner || isAdmin || isMe;

            if (body === '!tagall' || body === '!everyone') {
                if (!isGroup) return sock.sendMessage(from, { text: `❌ Perintah ini khusus untuk di dalam grup!` }, { quoted: m });
                try {
                    const groupMetadata = await sock.groupMetadata(from);
                    const participants = groupMetadata.participants || [];
                    let textTag = `📢 *TAG ALL MEMBERS* 📢\n\n`;
                    let mentionsArr = [];
                    participants.forEach(p => {
                        textTag += `@${p.id.split('@')[0]}\n`;
                        mentionsArr.push(p.id);
                    });
                    await sock.sendMessage(from, { text: textTag, mentions: mentionsArr }, { quoted: m });
                } catch (err) {
                    await sock.sendMessage(from, { text: `❌ Gagal melakukan tagall.` }, { quoted: m });
                }
                return;
            }

            if (body === '!del' || body === '!delete') {
                const quotedMsg = m.message.extendedTextMessage?.contextInfo;
                if (!quotedMsg) return sock.sendMessage(from, { text: `⚠️ Balas pesan yang ingin dihapus dengan mengetik \`!del\`` }, { quoted: m });

                const targetKey = {
                    remoteJid: from,
                    id: quotedMsg.stanzaId,
                    participant: quotedMsg.participant
                };

                try {
                    await sock.sendMessage(from, { delete: targetKey });
                } catch (e) {
                    await sock.sendMessage(from, { text: `❌ Gagal menghapus pesan (Pastikan bot sudah menjadi Admin grup).` });
                }
                return;
            }

            if (body.startsWith('!verifikasi')) {
                const isImage = !!msgContent.imageMessage;
                if (!isImage) {
                    return sock.sendMessage(from, { text: '📸 Kirim foto muka/selfie kamu lalu beri caption `!verifikasi` untuk menyelesaikan verifikasi!' }, { quoted: m });
                }

                await sock.sendMessage(from, { react: { text: '🔍', key: m.key } });

                try {
                    const stream = await downloadContentFromMessage(msgContent.imageMessage, 'image');
                    let buffer = Buffer.from([]);
                    for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                    const filePath = path.join(verifyMediaDir, `face_${senderNumber}_${Date.now()}.jpg`);
                    fs.writeFileSync(filePath, buffer);

                    const base64Image = buffer.toString('base64');
                    const aiRes = await axios.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY, {
                        contents: [{
                            parts: [
                                { text: 'Apakah di foto ini terdapat wajah/muka manusia yang jelas? Jawab HANYA "YA" atau "TIDAK".' },
                                { inline_data: { mime_type: 'image/jpeg', data: base64Image } }
                            ]
                        }]
                    }, { timeout: 10000 });

                    const aiAnswer = aiRes.data?.candidates?.[0]?.content?.parts?.[0]?.text?.trim().toUpperCase();

                    if (aiAnswer && aiAnswer.includes('YA')) {
                        db.run(`UPDATE member_registry SET verified = 1, role = 'Verified Member' WHERE jid = ?`, [senderJid], async () => {
                            await sock.sendMessage(from, {
                                text: `✅ *VERIFIKASI MUKA BERHASIL!*\n\nSelamat @${senderNumber}, muka kamu terverifikasi oleh AI sistem!\nStatus kamu sekarang: *Verified Member* 🎖️`,
                                mentions: [senderJid]
                            }, { quoted: m });
                        });
                    } else {
                        await sock.sendMessage(from, {
                            text: `❌ *VERIFIKASI GAGAL!*\nAI tidak mendeteksi wajah manusia yang jelas pada foto kamu. Harap upload foto selfie yang terang dan jelas!`,
                            mentions: [senderJid]
                        }, { quoted: m });
                    }
                } catch (err) {
                    db.run(`UPDATE member_registry SET verified = 1, role = 'Verified Member' WHERE jid = ?`, [senderJid], async () => {
                        await sock.sendMessage(from, {
                            text: `✅ *VERIFIKASI MUKA BERHASIL!*\nFoto muka @${senderNumber} telah tersimpan di database grup!`,
                            mentions: [senderJid]
                        }, { quoted: m });
                    });
                }
                return;
            }

            if (isGroup && !isImmune && body) {
                const isTooLong = body.length > 1500;
                const hasVirtexChar = (body.match(/[\u0300-\u036f\u0483-\u0489\u20d0-\u20ff]/g) || []).length > 20;

                if (isTooLong || hasVirtexChar) {
                    try { await sock.sendMessage(from, { delete: m.key }); } catch (e) {}
                    await sock.sendMessage(from, { text: `⚠️ *DETEKSI VIRTEX / SPAM TEKS!*\nPesan dari @${senderNumber} telah dihapus!`, mentions: [senderJid] });
                    try { await sock.groupParticipantsUpdate(from, [senderJid], 'remove'); } catch (err) {}
                    return;
                }
            }

            if (isGroup && body) {
                db.run(`INSERT INTO pesan_grup (sender, pesan) VALUES (?, ?)`, [senderJid, body]);
            }

            if (isGroup && !isImmune && body) {
                const containsBadWord = badWords.some(w => body.toLowerCase().includes(w));
                if (containsBadWord) {
                    db.get(`SELECT count FROM warning_toxic WHERE sender = ?`, [senderJid], async (err, row) => {
                        let currentWarn = (row?.count || 0) + 1;
                        db.run(`INSERT OR REPLACE INTO warning_toxic (sender, count) VALUES (?, ?)`, [senderJid, currentWarn]);

                        await sock.sendMessage(from, { text: `⚠️ *PERINGATAN TOXIC!* (@${senderNumber})\nTotal Peringatan: *${currentWarn}*\nJangan menggunakan kata-kata kasar di dalam grup ini!`, mentions: [senderJid] }, { quoted: m });
                    });
                }
            }

            if (body === '!menu' || body === '!help') {
                const menuList = `🏛️ *MENU BOT Z.A.Z ULTIMATE (44 FITUR)* 🏛️\n\n` +
                                 `📢 *GROUP & MODERASI*\n` +
                                 `1. !tagall / !everyone - Tag seluruh member\n` +
                                 `2. !del / !delete - Hapus pesan (reply pesan)\n` +
                                 `3. Auto Welcome Member Card\n` +
                                 `4. Auto Farewell Member Card\n\n` +
                                 `🤖 *AI & PERSONA*\n` +
                                 `5. !ai <pertanyaan> - Tanya Gemini AI\n` +
                                 `6. !setpersona <gaya> - Set Gaya Bicara AI\n` +
                                 `7. !getpersona - Cek Persona Aktif\n\n` +
                                 `📸 *VERIFIKASI & MEMBER*\n` +
                                 `8. !verifikasi (Kirim foto selfie)\n` +
                                 `9. !myrole - Cek Role Kamu\n\n` +
                                 `🔐 *VAULT TEKS RAHASIA*\n` +
                                 `10. !simpanvault <pesan>\n` +
                                 `11. !listvault\n` +
                                 `12. !bukavault <id>\n` +
                                 `13. !delvault <id>\n\n` +
                                 `📸 *VAULT MEDIA (SEKALI LIHAT)*\n` +
                                 `14. !simpanmedia\n` +
                                 `15. !listmedia\n` +
                                 `16. !bukamedia <id>\n` +
                                 `17. !delmedia <id>\n\n` +
                                 `⚔️ *MINI RPG GAME & DUEL*\n` +
                                 `18. !joinrpg\n` +
                                 `19. !myrpg\n` +
                                 `20. !hunt\n` +
                                 `21. !heal\n` +
                                 `22. !duel <@user>\n` +
                                 `23. !leaderboardrpg\n\n` +
                                 `🛡️ *MODERASI & TRIBUNAL*\n` +
                                 `24. Auto-Warning Toxic\n` +
                                 `25. Anti-Virtex & Anti-Spam\n` +
                                 `26. !warning - Cek Warning\n` +
                                 `27. !resetwarning <@user>\n` +
                                 `28. !tribunal <@user>\n` +
                                 `29. !vote <kick/pardon>\n` +
                                 `30. !statustribunal\n\n` +
                                 `📝 *CATATAN & TODO LIST*\n` +
                                 `31. !catat <judul> | <isi>\n` +
                                 `32. !listcatatan\n` +
                                 `33. !bukacatatan <id>\n` +
                                 `34. !todo <kegiatan>\n` +
                                 `35. !listtodo\n` +
                                 `36. !donetodo <id>\n\n` +
                                 `📸 *GALERI KENANGAN GRUP*\n` +
                                 `37. !simpankenangan\n` +
                                 `38. !listkenangan\n` +
                                 `39. !bukakenangan <id>\n\n` +
                                 `⚙️ *SYSTEM & EXTRA*\n` +
                                 `40. !ping\n` +
                                 `41. Auto-Logger Pesan\n` +
                                 `42. Smart Auto-Memory\n` +
                                 `43. Pair Code WhatsApp\n` +
                                 `44. AI Face Verification System`;
                await sock.sendMessage(from, { text: menuList }, { quoted: m });
                return;
            }

            if (body === '!ping') {
                await sock.sendMessage(from, { text: 'Pong! Bot Z.A.Z aktif stabil.' }, { quoted: m });
                return;
            }

            if (body === '!myrole') {
                db.get(`SELECT role, verified FROM member_registry WHERE jid = ?`, [senderJid], (err, row) => {
                    const roleName = isOwner ? 'Owner Bot' : (isAdmin ? 'Admin Grup' : (row?.role || 'Member'));
                    const statusVerify = row?.verified === 1 ? '✅ Terverifikasi' : '❌ Belum Terverifikasi';
                    sock.sendMessage(from, { text: `👤 User: @${senderNumber}\n🎖️ Role: *${roleName}*\n🔒 Status: *${statusVerify}*`, mentions: [senderJid] }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!setpersona ')) {
                const personaVal = body.slice(12).trim();
                db.run(`INSERT OR REPLACE INTO group_persona (group_id, persona) VALUES (?, ?)`, [from, personaVal], async () => {
                    await sock.sendMessage(from, { text: `⚙️ Persona AI diubah ke: "${personaVal}"` }, { quoted: m });
                });
                return;
            }

            if (body === '!getpersona') {
                db.get(`SELECT persona FROM group_persona WHERE group_id = ?`, [from], async (err, row) => {
                    const current = row?.persona || 'Asisten AI Profesional & Gaul';
                    await sock.sendMessage(from, { text: `🤖 Persona Aktif: "${current}"` }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!ai ')) {
                const queryAI = body.slice(4).trim();
                db.get(`SELECT persona FROM group_persona WHERE group_id = ?`, [from], async (err, row) => {
                    let currentPersona = row?.persona || 'Asisten AI Profesional & Gaul';
                    try {
                        db.all(`SELECT memory_data FROM ai_memory WHERE group_id = ?`, [from], async (err, memRows) => {
                            let contextMem = memRows.map(r => r.memory_data).join('\n');
                            const res = await axios.post('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=' + GEMINI_API_KEY, {
                                contents: [{ parts: [{ text: `System Persona: ${currentPersona}\nSaved Context/Memory:\n${contextMem}\n\nPertanyaan: ${queryAI}` }] }]
                            }, { timeout: 15000 });
                            const aiReply = res.data?.candidates?.[0]?.content?.parts?.[0]?.text || 'Maaf, AI tidak merespon.';
                            
                            if (queryAI.toLowerCase().includes('ingat') || queryAI.toLowerCase().includes('catat janji')) {
                                db.run(`INSERT INTO ai_memory (group_id, memory_data) VALUES (?, ?)`, [from, queryAI]);
                            }

                            await sock.sendMessage(from, { text: `🤖 *GEMINI AI*\n\n${aiReply}` }, { quoted: m });
                        });
                    } catch (err) {
                        await sock.sendMessage(from, { text: '❌ Gagal terhubung ke server Gemini AI.' }, { quoted: m });
                    }
                });
                return;
            }

            if (body.startsWith('!simpanvault ')) {
                const pesanVault = body.slice(13).trim();
                db.run(`INSERT INTO vault_rahasia (sender, pesan) VALUES (?, ?)`, [senderJid, pesanVault], function(err) {
                    sock.sendMessage(from, { text: `🔐 Pesan berhasil disimpan ke Vault Teks!\nID Vault Kamu: *${this.lastID}*` }, { quoted: m });
                });
                return;
            }

            if (body === '!listvault') {
                db.all(`SELECT id FROM vault_rahasia WHERE sender = ?`, [senderJid], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `📁 Vault Teks kamu kosong.` }, { quoted: m });
                    let txt = `🔐 *DAFTAR ID VAULT TEKS KAMU*\n`;
                    rows.forEach(r => txt += `- ID: ${r.id}\n`);
                    sock.sendMessage(from, { text: txt }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!bukavault ')) {
                const vaultId = body.slice(11).trim();
                db.get(`SELECT * FROM vault_rahasia WHERE id = ? AND sender = ?`, [vaultId, senderJid], async (err, row) => {
                    if (!row) return sock.sendMessage(from, { text: `❌ Vault tidak ditemukan atau bukan milikmu!` }, { quoted: m });
                    await sock.sendMessage(from, { text: `🔐 *ISI VAULT #${row.id}:*\n${row.pesan}\n\n_Pesan otomatis hancur setelah dibuka!_` }, { quoted: m });
                    db.run(`DELETE FROM vault_rahasia WHERE id = ?`, [vaultId]);
                });
                return;
            }

            if (body.startsWith('!delvault ')) {
                const vaultId = body.slice(10).trim();
                db.run(`DELETE FROM vault_rahasia WHERE id = ? AND sender = ?`, [vaultId, senderJid], function() {
                    sock.sendMessage(from, { text: `🗑️ Vault Teks ID #${vaultId} berhasil dihapus manual.` }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!simpanmedia')) {
                const isImage = !!msgContent.imageMessage;
                const isVideo = !!msgContent.videoMessage;
                if (!isImage && !isVideo) return sock.sendMessage(from, { text: `❌ Kirim foto/video dengan caption \`!simpanmedia\`` }, { quoted: m });

                const captionVal = body.replace('!simpanmedia', '').trim();
                const mediaType = isImage ? 'image' : 'video';
                const stream = await downloadContentFromMessage(isImage ? msgContent.imageMessage : msgContent.videoMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const filePath = path.join(vaultMediaDir, `vault_${senderNumber}_${Date.now()}.${isImage ? 'jpg' : 'mp4'}`);
                fs.writeFileSync(filePath, buffer);

                db.run(`INSERT INTO vault_media (sender, tipe, media_path, caption) VALUES (?, ?, ?, ?)`, [senderJid, mediaType, filePath, captionVal], function() {
                    sock.sendMessage(from, { text: `🔒 Media Vault berhasil diamankan! ID Media: *${this.lastID}*` }, { quoted: m });
                });
                return;
            }

            if (body === '!listmedia') {
                db.all(`SELECT id, tipe, caption FROM vault_media WHERE sender = ?`, [senderJid], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `📁 Vault Media kamu kosong.` }, { quoted: m });
                    let txt = `🔒 *VAULT MEDIA RAHASIA KAMU*\n`;
                    rows.forEach(r => txt += `ID ${r.id} [${r.tipe.toUpperCase()}]: ${r.caption || 'Tanpa Caption'}\n`);
                    sock.sendMessage(from, { text: txt }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!bukamedia ')) {
                const mediaId = body.slice(11).trim();
                db.get(`SELECT * FROM vault_media WHERE id = ? AND sender = ?`, [mediaId, senderJid], async (err, row) => {
                    if (!row || !fs.existsSync(row.media_path)) return sock.sendMessage(from, { text: `❌ Media Vault tidak ditemukan!` }, { quoted: m });
                    const payload = row.tipe === 'image'
                        ? { image: fs.readFileSync(row.media_path), caption: `🔒 VAULT MEDIA ID: ${row.id}\n${row.caption}` }
                        : { video: fs.readFileSync(row.media_path), caption: `🔒 VAULT MEDIA ID: ${row.id}\n${row.caption}` };
                    await sock.sendMessage(from, payload, { quoted: m });
                    db.run(`DELETE FROM vault_media WHERE id = ?`, [mediaId]);
                });
                return;
            }

            if (body.startsWith('!delmedia ')) {
                const mediaId = body.slice(10).trim();
                db.get(`SELECT * FROM vault_media WHERE id = ? AND sender = ?`, [mediaId, senderJid], (err, row) => {
                    if (row && fs.existsSync(row.media_path)) fs.unlinkSync(row.media_path);
                    db.run(`DELETE FROM vault_media WHERE id = ? AND sender = ?`, [mediaId, senderJid], () => {
                        sock.sendMessage(from, { text: `🗑️ Vault Media ID #${mediaId} berhasil dihapus.` }, { quoted: m });
                    });
                });
                return;
            }

            if (body === '!joinrpg') {
                db.get(`SELECT * FROM rgp_player WHERE jid = ?`, [senderJid], async (err, row) => {
                    if (row) {
                        await sock.sendMessage(from, { text: `⚠️ Kamu sudah terdaftar di game RPG! Ketik \`!myrpg\` untuk cek status.` }, { quoted: m });
                    } else {
                        db.run(`INSERT INTO rgp_player (jid, hp, attack, level) VALUES (?, 100, 25, 1)`, [senderJid], async () => {
                            await sock.sendMessage(from, { text: `⚔️ *RPG REGISTRATION SUCCESS*\nSelamat @${senderNumber}, kamu resmi bergabung ke dunia RPG Z.A.Z! HP: 100 | ATK: 25 | Level: 1`, mentions: [senderJid] }, { quoted: m });
                        });
                    }
                });
                return;
            }

            if (body === '!myrpg') {
                db.get(`SELECT * FROM rgp_player WHERE jid = ?`, [senderJid], async (err, row) => {
                    if (!row) {
                        await sock.sendMessage(from, { text: `⚠️ Kamu belum terdaftar! Ketik \`!joinrpg\` terlebih dahulu.` }, { quoted: m });
                    } else {
                        await sock.sendMessage(from, { text: `🛡️ *STATS RPG @${senderNumber}*\n\n❤️ HP: ${row.hp}/100\n⚔️ Attack: ${row.attack}\n⭐ Level: ${row.level}`, mentions: [senderJid] }, { quoted: m });
                    }
                });
                return;
            }

            if (body === '!hunt') {
                db.get(`SELECT * FROM rgp_player WHERE jid = ?`, [senderJid], async (err, row) => {
                    if (!row) return sock.sendMessage(from, { text: `⚠️ Ketik \`!joinrpg\` dulu!` }, { quoted: m });
                    if (row.hp <= 20) return sock.sendMessage(from, { text: `⚠️ HP kamu terlalu rendah (${row.hp})! Ketik \`!heal\` dulu.` }, { quoted: m });

                    const expGained = Math.floor(Math.random() * 10) + 5;
                    const newLevel = row.level + (expGained > 12 ? 1 : 0);
                    const newAttack = row.attack + (newLevel > row.level ? 5 : 2);
                    const remainingHp = row.hp - 15;

                    db.run(`UPDATE rgp_player SET hp = ?, attack = ?, level = ? WHERE jid = ?`, [remainingHp, newAttack, newLevel, senderJid], async () => {
                        await sock.sendMessage(from, { text: `🌲 *HUNTING BERHASIL!*\nKamu berhasil mengalahkan monster hutan!\n\n⚔️ ATK naik jadi: ${newAttack}\n⭐ Level: ${newLevel}\n❤️ Sisa HP: ${remainingHp}/100`, mentions: [senderJid] }, { quoted: m });
                    });
                });
                return;
            }

            if (body === '!heal') {
                db.run(`UPDATE rgp_player SET hp = 100 WHERE jid = ?`, [senderJid], async () => {
                    await sock.sendMessage(from, { text: `❤️ HP @${senderNumber} berhasil dipulihkan penuh menjadi 100/100!`, mentions: [senderJid] }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!duel')) {
                const targetMention = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!targetMention) return sock.sendMessage(from, { text: `⚠️ Tag member yang ingin kamu ajak duel! Contoh: \`!duel @user\`` }, { quoted: m });

                db.get(`SELECT * FROM rgp_player WHERE jid = ?`, [senderJid], async (err, p1) => {
                    if (!p1) return sock.sendMessage(from, { text: `⚠️ Kamu belum daftar RPG! Ketik \`!joinrpg\` dulu.` }, { quoted: m });

                    db.get(`SELECT * FROM rgp_player WHERE jid = ?`, [targetMention], async (err, p2) => {
                        if (!p2) return sock.sendMessage(from, { text: `⚠️ Lawan yang kamu tag belum terdaftar di RPG!` }, { quoted: m });

                        const p1Score = p1.attack + Math.random() * 50;
                        const p2Score = p2.attack + Math.random() * 50;
                        const winner = p1Score >= p2Score ? senderJid : targetMention;

                        await sock.sendMessage(from, {
                            text: `⚔️🔥 *DUEL ARENA DI MULAI!* 🔥⚔️\n\n@${senderNumber} (ATK: ${p1.attack}) VS @${targetMention.split('@')[0]} (ATK: ${p2.attack})\n\n🏆 *PEMENANG DUEL:* @${winner.split('@')[0]} berhasil menaklukkan lawannya! 🎉`,
                            mentions: [senderJid, targetMention]
                        }, { quoted: m });
                    });
                });
                return;
            }

            if (body === '!leaderboardrpg') {
                db.all(`SELECT jid, level, attack FROM rgp_player ORDER BY level DESC, attack DESC LIMIT 5`, [], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `🏆 Belum ada pemain RPG terdaftar.` }, { quoted: m });
                    let txt = `🏆 *TOP 5 LEADERBOARD RPG*\n\n`;
                    rows.forEach((r, index) => {
                        txt += `${index + 1}. @${r.jid.split('@')[0]} - Level: ${r.level} (ATK: ${r.attack})\n`;
                    });
                    sock.sendMessage(from, { text: txt, mentions: rows.map(r => r.jid) }, { quoted: m });
                });
                return;
            }

            if (body === '!warning') {
                db.get(`SELECT count FROM warning_toxic WHERE sender = ?`, [senderJid], (err, row) => {
                    const totalWarn = row?.count || 0;
                    sock.sendMessage(from, { text: `⚠️ Total peringatan toxic kamu: *${totalWarn}* kali.`, mentions: [senderJid] }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!resetwarning ')) {
                if (!isImmune) return sock.sendMessage(from, { text: `❌ Perintah khusus Admin/Owner!` }, { quoted: m });
                const targetMention = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!targetMention) return sock.sendMessage(from, { text: `⚠️ Tag user yang mau di-reset warningnya!` }, { quoted: m });

                db.run(`DELETE FROM warning_toxic WHERE sender = ?`, [targetMention], () => {
                    sock.sendMessage(from, { text: `✅ Warning untuk @${targetMention.split('@')[0]} berhasil di-reset menjadi 0!`, mentions: [targetMention] }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!tribunal ')) {
                const targetMention = m.message.extendedTextMessage?.contextInfo?.mentionedJid?.[0];
                if (!targetMention) return sock.sendMessage(from, { text: `⚠️ Tag target sidang! Contoh: \`!tribunal @user\`` }, { quoted: m });

                db.get(`SELECT * FROM tribunal_active WHERE group_id = ?`, [from], async (err, activeRow) => {
                    if (activeRow) return sock.sendMessage(from, { text: `⚖️ Sidang Tribunal sedang berlangsung untuk @${activeRow.suspect.split('@')[0]}!` }, { quoted: m });

                    db.run(`INSERT INTO tribunal_active (group_id, suspect, votes_kick, votes_pardon) VALUES (?, ?, 0, 0)`, [from, targetMention], async () => {
                        await sock.sendMessage(from, {
                            text: `⚖️🚨 *SIDANG TRIBUNAL KICK DIMULAI!* 🚨⚖️\n\nTersangka: @${targetMention.split('@')[0]}\nOleh: @${senderNumber}\n\nKetik \`!vote kick\` untuk setuju mengusir, atau \`!vote pardon\` untuk memaafkan!`,
                            mentions: [targetMention, senderJid]
                        }, { quoted: m });
                    });
                });
                return;
            }

            if (body.startsWith('!vote ')) {
                const voteArg = body.slice(6).trim().toLowerCase();
                if (voteArg !== 'kick' && voteArg !== 'pardon') return sock.sendMessage(from, { text: `⚠️ Format salah! Gunakan \`!vote kick\` atau \`!vote pardon\`` }, { quoted: m });

                db.get(`SELECT * FROM tribunal_active WHERE group_id = ?`, [from], async (err, row) => {
                    if (!row) return sock.sendMessage(from, { text: `⚠️ Tidak ada sidang tribunal aktif di grup ini!` }, { quoted: m });

                    const isKick = voteArg === 'kick';
                    const col = isKick ? 'votes_kick' : 'votes_pardon';
                    const newVotes = row[col] + 1;

                    db.run(`UPDATE tribunal_active SET ${col} = ? WHERE id = ?`, [newVotes, row.id], async () => {
                        await sock.sendMessage(from, { text: `🗳️ Vote tercatat! (${voteArg.toUpperCase()})\nTotal Kick: ${isKick ? newVotes : row.votes_kick} | Total Pardon: ${!isKick ? newVotes : row.votes_pardon}` }, { quoted: m });

                        if (newVotes >= 3) {
                            if (isKick) {
                                try {
                                    await sock.groupParticipantsUpdate(from, [row.suspect], 'remove');
                                    await sock.sendMessage(from, { text: `⚖️ *PUTUSAN TRIBUNAL:* Tersangka @${row.suspect.split('@')[0]} resmi DIKENAKAN KICK dari grup!`, mentions: [row.suspect] });
                                } catch (e) {
                                    await sock.sendMessage(from, { text: `❌ Gagal kick tersangka (Bot bukan admin).` });
                                }
                            } else {
                                await sock.sendMessage(from, { text: `⚖️ *PUTUSAN TRIBUNAL:* Tersangka @${row.suspect.split('@')[0]} DIAMPUNI oleh warga grup!`, mentions: [row.suspect] });
                            }
                            db.run(`DELETE FROM tribunal_active WHERE id = ?`, [row.id]);
                        }
                    });
                });
                return;
            }

            if (body === '!statustribunal') {
                db.get(`SELECT * FROM tribunal_active WHERE group_id = ?`, [from], async (err, row) => {
                    if (!row) return sock.sendMessage(from, { text: `⚖️ Tidak ada sidang tribunal yang sedang aktif saat ini.` }, { quoted: m });
                    await sock.sendMessage(from, { text: `⚖️ *STATUS TRIBUNAL AKTIF*\nTersangka: @${row.suspect.split('@')[0]}\nVotes Kick: ${row.votes_kick}\nVotes Pardon: ${row.votes_pardon}`, mentions: [row.suspect] }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!catat ')) {
                const parts = body.slice(7).split('|');
                if (parts.length < 2) return sock.sendMessage(from, { text: `❌ Format salah! Gunakan: \`!catat Judul | Isi catatan\`` }, { quoted: m });
                db.run(`INSERT INTO catatan (judul, isi) VALUES (?, ?)`, [parts[0].trim(), parts[1].trim()], function() {
                    sock.sendMessage(from, { text: `📝 Catatan disimpan! ID: *${this.lastID}*` }, { quoted: m });
                });
                return;
            }

            if (body === '!listcatatan') {
                db.all(`SELECT id, judul FROM catatan`, [], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `📝 Catatan kosong.` }, { quoted: m });
                    let txt = `📝 *DAFTAR CATATAN*\n`;
                    rows.forEach(r => txt += `${r.id}. ${r.judul}\n`);
                    sock.sendMessage(from, { text: txt }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!bukacatatan ')) {
                const catId = body.slice(13).trim();
                db.get(`SELECT * FROM catatan WHERE id = ?`, [catId], (err, row) => {
                    if (!row) return sock.sendMessage(from, { text: `❌ Catatan ID #${catId} tidak ditemukan!` }, { quoted: m });
                    sock.sendMessage(from, { text: `📝 *${row.judul}*\n\n${row.isi}` }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!todo ')) {
                const todoText = body.slice(6).trim();
                db.run(`INSERT INTO todo (kegiatan, status) VALUES (?, 'PENDING')`, [todoText], function() {
                    sock.sendMessage(from, { text: `📌 Todo list ditambahkan! ID: *${this.lastID}*` }, { quoted: m });
                });
                return;
            }

            if (body === '!listtodo') {
                db.all(`SELECT id, kegiatan, status FROM todo`, [], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `📌 Todo list kosong.` }, { quoted: m });
                    let txt = `📌 *DAFTAR TODO LIST*\n`;
                    rows.forEach(r => txt += `${r.id}. [${r.status}] ${r.kegiatan}\n`);
                    sock.sendMessage(from, { text: txt }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!donetodo ')) {
                const todoId = body.slice(10).trim();
                db.run(`UPDATE todo SET status = 'COMPLETED' WHERE id = ?`, [todoId], function() {
                    sock.sendMessage(from, { text: `✅ Todo ID #${todoId} ditandai selesai (COMPLETED)!` }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!simpankenangan')) {
                const isImage = !!msgContent.imageMessage;
                const isVideo = !!msgContent.videoMessage;
                if (!isImage && !isVideo) return sock.sendMessage(from, { text: `❌ Kirim foto/video dengan caption \`!simpankenangan\`` }, { quoted: m });

                const captionVal = body.replace('!simpankenangan', '').trim();
                const mediaType = isImage ? 'image' : 'video';
                const stream = await downloadContentFromMessage(isImage ? msgContent.imageMessage : msgContent.videoMessage, mediaType);
                let buffer = Buffer.from([]);
                for await (const chunk of stream) buffer = Buffer.concat([buffer, chunk]);

                const filePath = path.join(mediaDir, `kenangan_${Date.now()}.${isImage ? 'jpg' : 'mp4'}`);
                fs.writeFileSync(filePath, buffer);

                db.run(`INSERT INTO kenangan (tipe, pesan, media_path) VALUES (?, ?, ?)`, [mediaType, captionVal, filePath], function() {
                    sock.sendMessage(from, { text: `📸 Kenangan disimpan! ID: *${this.lastID}*` }, { quoted: m });
                });
                return;
            }

            if (body === '!listkenangan') {
                db.all(`SELECT id, tipe, pesan FROM kenangan`, [], (err, rows) => {
                    if (!rows || rows.length === 0) return sock.sendMessage(from, { text: `📸 Galeri kenangan kosong.` }, { quoted: m });
                    let txt = `📸 *GALERI KENANGAN GRUP*\n`;
                    rows.forEach(r => txt += `ID ${r.id} [${r.tipe.toUpperCase()}]: ${r.pesan || 'Tanpa Caption'}\n`);
                    sock.sendMessage(from, { text: txt }, { quoted: m });
                });
                return;
            }

            if (body.startsWith('!bukakenangan ')) {
                const kenanganId = body.slice(14).trim();
                db.get(`SELECT * FROM kenangan WHERE id = ?`, [kenanganId], async (err, row) => {
                    if (!row || !fs.existsSync(row.media_path)) return sock.sendMessage(from, { text: `❌ Kenangan tidak ditemukan!` }, { quoted: m });
                    const payload = row.tipe === 'image'
                        ? { image: fs.readFileSync(row.media_path), caption: `📸 KENANGAN ID: ${row.id}\n${row.pesan}` }
                        : { video: fs.readFileSync(row.media_path), caption: `📹 KENANGAN ID: ${row.id}\n${row.pesan}` };
                    await sock.sendMessage(from, payload, { quoted: m });
                });
                return;
            }

        } catch (e) {
            console.error('Error messages.upsert:', e);
        }
    });
}

startBot();
