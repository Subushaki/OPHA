const { Client, GatewayIntentBits, Partials, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, Routes, PermissionsBitField } = require("discord.js");
const { SlashCommandBuilder } = require('@discordjs/builders');
const { createClient } = require('@supabase/supabase-js');
const cron = require('node-cron');
const config = require("./config.json");

// =======================================================
// 1. İLK AYARLAR
// =======================================================

// Supabase Bağlantı Bilgilerini ORTAM DEĞİŞKENLERİNDEN (Render'dan) oku
const supabaseUrl = process.env.SUPABASE_URL; // Render'daki ad: SUPABASE_URL
const supabaseAnonKey = process.env.SUPABASE_KEY; // Render'daki ad: SUPABASE_KEY

// Supabase Bağlantısı
const supabase = createClient(supabaseUrl, supabaseAnonKey);

// Discord Client Oluşturma
// config dosyasından okunan "token" bilgisini de düzeltmemiz gerekiyor!
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
                .setDescription('Çekiliş süresi (Örn: 24h, 7d, 30d)')
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
        // BURAYA ZAMANLANMIŞ İŞ (CRON JOB) BAŞLATMA GELECEK
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

        // Süre hesaplama (Basit bir örnek)
        let bitisZamani = new Date();
        const sureRegex = /(\d+)(h|d|m)/i; // Örn: 24h, 7d, 30d
        const match = sureStr.match(sureRegex);

        if (!match) {
            return interaction.editReply({ content: 'Geçersiz süre formatı. Lütfen 24h, 7d veya 30d gibi kullanın.', ephemeral: true });
        }

        const [_, miktar, birim] = match;
        const miktarInt = parseInt(miktar);

        if (birim === 'h') {
            bitisZamani.setHours(bitisZamani.getHours() + miktarInt);
        } else if (birim === 'd') {
            bitisZamani.setDate(bitisZamani.getDate() + miktarInt);
        } else if (birim === 'm') {
            bitisZamani.setMinutes(bitisZamani.getMinutes() + miktarInt);
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
            return interaction.editReply({ content: 'Çekiliş başlatıldı ancak veritabanına kayıtta hata oluştu.', ephemeral: true });
        }

        await interaction.editReply({ content: `Çekiliş başarıyla başlatıldı ve veritabanına kaydedildi: ${sentMessage.url}`, ephemeral: true });
    }
});


// =======================================================
// 4. BOT BAŞLATMA
// =======================================================
client.login(process.env.DISCORD_TOKEN);