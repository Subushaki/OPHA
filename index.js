const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes, PermissionsBitField } = require("discord.js");
const { SlashCommandBuilder } = require('@discordjs/builders');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
// const config = require("./config.json"); // Artık kullanılmıyor

// =======================================================
// 1. İLK AYARLAR
// =======================================================

// Supabase Bağlantı Bilgilerini ORTAM DEĞİŞKENLERİNDEN (Render'dan) oku
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_KEY;

// Supabase Bağlantısı
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Discord Client Oluşturma
const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.GuildMembers,
        GatewayIntentBits.GuildMessageReactions
    ],
    partials: [Partials.Message, Partials.Channel, Partials.Reaction]
});

// =======================================================
// 2. HAZIRLIK VE KOMUT KAYDI
// =======================================================

// Slash Komutlarını tanımla
const commands = [
    new SlashCommandBuilder()
        .setName('cekilis-olustur')
        .setDescription('Yeni bir çekiliş başlatır ve veritabanına kaydeder.')
        .addStringOption(option =>
            option.setName('odul')
                .setDescription('Çekilişin ödülü (örn: AK-47 Skin)')
                .setRequired(true))
        .addIntegerOption(option =>
            option.setName('kazanan_sayisi')
                .setDescription('Kaç kişi kazanacak?')
                .setRequired(true))
        .addStringOption(option =>
            option.setName('sure')
                .setDescription('Çekiliş süresi (Örn: 24h, 7d, 30d). Maksimum 30d.')
                .setRequired(true))
].map(command => command.toJSON());

// Bot Hazır olduğunda
client.once("ready", async () => {
    console.log(`🚀 Botunuz Hazır! ${client.user.tag} olarak giriş yaptı.`);
    client.user.setActivity("SLT-CS2 Çekilişlerini", { type: 4 });

    // Komutları Discord API'ye kaydet (Global olarak kaydedelim)
    try {
        const data = await client.application.commands.set(commands);
        console.log(`✅ ${data.size} adet Slash Komutu başarıyla yüklendi.`);

        // ---------------------------------------------
        // ZAMANLANMIŞ İŞ (CRON JOB): Her dakika kontrol et
        // ---------------------------------------------
        cron.schedule('* * * * *', () => {
            console.log('CRON: Süresi dolan çekilişler kontrol ediliyor...');
            sonuclandir();
        });

    } catch (error) {
        console.error("Komutları yüklerken hata:", error);
    }
});

// =======================================================
// 3. KOMUT İŞLEYİCİ
// =======================================================

client.on('interactionCreate', async interaction => {
    if (!interaction.isCommand()) return;

    const { commandName } = interaction;

    if (commandName === 'cekilis-olustur') {
        // YALNIZCA BELİRLİ ROL VEYA İZİNLERE SAHİP KİŞİLER KULLANABİLİR
        if (!interaction.member.permissions.has(PermissionsBitField.Flags.ManageGuild)) {
            return interaction.reply({ content: 'Bu komutu kullanma yetkiniz yok.', ephemeral: true });
        }

        await interaction.deferReply({ ephemeral: true }); // Kullanıcıya bekleme mesajı gönder

        const odul = interaction.options.getString('odul');
        const kazananSayisi = interaction.options.getInteger('kazanan_sayisi');
        const sureStr = interaction.options.getString('sure');

        // Süre hesaplama ve Maksimum 30 Gün (1 Ay) Limiti Kontrolü
        let bitisZamani = new Date();
        const sureRegex = /(\d+)(h|d)/i; // 'm' dakika birimini kaldırdık, sadece saat ve gün kullanacağız.
        const match = sureStr.match(sureRegex);

        if (!match) {
            return interaction.editReply({ content: 'Geçersiz süre formatı. Lütfen 24h, 7d, 30d gibi kullanın.', ephemeral: true });
        }

        const [_, miktar, birim] = match;
        const miktarInt = parseInt(miktar);
        const maxSureMs = 30 * 24 * 60 * 60 * 1000; // 30 Gün milisaniye cinsinden

        if (birim === 'h') {
            const sureMs = miktarInt * 60 * 60 * 1000;
            if (sureMs > maxSureMs) {
                return interaction.editReply({ content: 'Çekiliş süresi maksimum 30 gün (720h) olabilir.', ephemeral: true });
            }
            bitisZamani.setHours(bitisZamani.getHours() + miktarInt);
        } else if (birim === 'd') {
            const sureMs = miktarInt * 24 * 60 * 60 * 1000;
            if (sureMs > maxSureMs) {
                return interaction.editReply({ content: 'Çekiliş süresi maksimum 30 gün olabilir.', ephemeral: true });
            }
            bitisZamani.setDate(bitisZamani.getDate() + miktarInt);
        }

        // Çekiliş Mesajı (Embed) Oluşturma
        const giveawayEmbed = new EmbedBuilder()
            .setColor(0x0099ff)
            .setTitle(`🎉 YENİ ÇEKİLİŞ: ${odul}`)
            .setDescription(`Bu çekilişe katılmak için aşağıdaki 🎁 tepkisine tıklayın.\n\n**Kazanan Sayısı:** ${kazananSayisi}\n**Bitiş Zamanı:** <t:${Math.floor(bitisZamani.getTime() / 1000)}:R>`)
            .setTimestamp(bitisZamani)
            .setFooter({ text: 'İyi Şanslar!' });

        // Çekiliş Mesajını Gönder
        const giveawayChannel = interaction.channel;
        const sentMessage = await giveawayChannel.send({ embeds: [giveawayEmbed] });

        // Emoji Tepkisi Ekle
        await sentMessage.react('🎁');

        // Supabase'e Kaydetme
        const { error } = await supabase
            .from('giveaways')
            .insert([
                {
                    message_id: sentMessage.id,
                    channel_id: giveawayChannel.id,
                    guild_id: interaction.guildId,
                    prize: odul,
                    winner_count: kazananSayisi,
                    end_time: bitisZamani.toISOString()
                }
            ]);

        if (error) {
            console.error("Supabase'e kaydederken hata:", error);
            return interaction.editReply({ content: 'Çekiliş başlatıldı ancak veritabanına kayıtta hata oluştu. Lütfen logları kontrol edin.', ephemeral: true });
        }

        await interaction.editReply({ content: `Çekiliş başarıyla başlatıldı ve veritabanına kaydedildi: ${sentMessage.url}`, ephemeral: true });
    }
});


// =======================================================
// 4. WEB SİTESİ ENTEGRASYONU
// =======================================================

// Web sitesi API adresi için ENV kullanacağız (örneğin: WEB_API_URL)
async function sendToSLTCS2Web(data) {
    if (!process.env.WEB_API_URL) {
        console.warn('Web sitesi API URL\'si tanımlı değil. Sonuçlar web sitesine gönderilmedi. Veri:', data);
        return;
    }

    try {
        // fetch modülünü require etmemiz gerekiyor
        const fetch = require('node-fetch');

        const response = await fetch(process.env.WEB_API_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                // Güvenlik için özel bir API Key de gönderebiliriz
                'X-API-KEY': process.env.WEB_API_SECRET || '', 
            },
            body: JSON.stringify(data)
        });

        if (response.ok) {
            console.log('Çekiliş sonuçları web sitesine başarıyla gönderildi.');
        } else {
            // Hata detayını yakalamak için
            const text = await response.text();
            console.error(`Web sitesine veri gönderilirken HTTP hata: ${response.status} ${response.statusText}`, text);
        }
    } catch (e) {
        console.error('Web sitesi bağlantı hatası:', e);
    }
}


// =======================================================
// 5. ZAMANLANMIŞ İŞLEVLER (Çekiliş Sonuçlandırma)
// =======================================================

async function sonuclandir() {
    // 1. Süresi Dolmuş Çekilişleri Bul
    const { data: giveaways, error } = await supabase
        .from('giveaways')
        .select('*')
        .lte('end_time', new Date().toISOString());

    if (error) {
        console.error("Supabase'den çekiliş çekerken hata:", error);
        return;
    }

    if (giveaways.length === 0) return; // Sonuçlanacak çekiliş yok

    for (const giveaway of giveaways) {
        try {
            const guild = client.guilds.cache.get(giveaway.guild_id);
            if (!guild) continue;

            const channel = guild.channels.cache.get(giveaway.channel_id);
            if (!channel) continue;

            const message = await channel.messages.fetch(giveaway.message_id);
            if (!message) continue;

            // 2. Katılımcıları Topla (🎁 tepkisini verenler)
            const reaction = message.reactions.cache.get('🎁');
            if (!reaction) {
                await channel.send(`🎉 Çekiliş sonuçlandı: **${giveaway.prize}**! Katılımcı bulunamadı.`);
                await supabase.from('giveaways').delete().eq('message_id', giveaway.message_id);
                continue;
            }

            // Reaction fetch yaparken 100 limitini aşmamak için cache kullanıyoruz. 
            const users = await reaction.users.fetch({ limit: 100 }); 
            let participants = users.filter(user => !user.bot).map(user => user.id); // Botları ele

            // 3. Kazananları Seç
            let winners = [];
            let winnerCount = Math.min(giveaway.winner_count, participants.length);

            while (winners.length < winnerCount && participants.length > 0) {
                const randomIndex = Math.floor(Math.random() * participants.length);
                const winnerId = participants[randomIndex];
                
                if (winnerId) {
                    winners.push(winnerId);
                    // Seçilen kişiyi katılımcı listesinden çıkar (tekrar kazanmasın)
                    participants.splice(randomIndex, 1);
                } else {
                     break; 
                }
            }

            // 4. Discord'da Duyur ve Web Sitesine Gönder
            let resultMessage = '';
            let webData = {}; // Web sitesine gönderilecek temiz veri

            if (winners.length > 0) {
                const winnerMentions = winners.map(id => `<@${id}>`).join(', ');
                resultMessage = `🎉🎉🎉 **TEBRİKLER!** 🎉🎉🎉\n\n**Ödül:** ${giveaway.prize}\n**Kazananlar:** ${winnerMentions}\n\nLütfen ödülünüzü almak için "talep" oluşturun.`;
                
                // Web Sitesi için veri hazırlama (Kullanıcı adlarını çekmek gerekebilir)
                const winnerUsernames = winners.map(id => guild.members.cache.get(id)?.user.tag || `ID: ${id}`);

                webData = {
                    date: new Date().toISOString().split('T')[0], // YYYY-MM-DD
                    prize: giveaway.prize,
                    winner_count: giveaway.winner_count,
                    winners: winnerUsernames, 
                    message_url: message.url 
                };
                
                await sendToSLTCS2Web(webData); // Web sitesine gönder

            } else {
                resultMessage = `Çekiliş sonuçlandı: **${giveaway.prize}**! Yeterli katılımcı bulunamadığı için kazanan seçilemedi.`;
            }

            // Orijinal mesajı düzenle
            const finalEmbed = new EmbedBuilder(message.embeds[0].toJSON())
                .setDescription(`~~Bu çekilişe katılmak için aşağıdaki 🎁 tepkisine tıklayın.~~\n\n**Kazanan Sayısı:** ${giveaway.winner_count}\n**BİTTİ!**`)
                .setColor(0xff0000) // Kırmızıya çevir
                .setTitle(`🏆 SONUÇLANDI: ${giveaway.prize}`);

            await message.edit({ embeds: [finalEmbed], components: [] }); // Butonları ve tepkiyi kaldır
            await channel.send(resultMessage); // Sonuç duyurusunu gönder

            // 5. Supabase'den Sil (Artık sonuçlandığı için)
            await supabase.from('giveaways').delete().eq('message_id', giveaway.message_id);


        } catch (e) {
            console.error(`Çekiliş sonuçlandırma hatası (ID: ${giveaway.message_id}):`, e);
        }
    }
}


// =======================================================
// 6. BOT BAŞLATMA
// =======================================================
client.login(process.env.DISCORD_TOKEN);