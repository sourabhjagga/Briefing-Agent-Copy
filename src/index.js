/**
 * CC & Deals Briefing Agent — Main Entry Point
 *
 * 1. Initializes the optimized pre-compiled database layer.
 * 2. Seeds default CC & Deals categories and loads all custom categories.
 * 3. Creates Telegram bot instances for each active category.
 * 4. Starts pure socket-based WhatsApp and Telegram listeners in background.
 * 5. Schedules daily briefings staggered by 45 seconds per category.
 * 6. Runs Express server exposing source CRUD, category CRUD, schedule CRUD, OTP, and session cookies APIs.
 * 7. Handles graceful shutdowns under Coolify and Docker containers.
 */

require('dotenv').config();

const express = require('express');
const path = require('path');
const fs = require('fs');

const logger = require('./logger');
const MessageDatabase = require('./database');
const WhatsAppListener = require('./whatsapp');
const TelegramUserListener = require('./telegram-user');
const TelegramBotDispatcher = require('./telegram-bot');
const Summarizer = require('./summarizer');
const Scheduler = require('./scheduler');

const ForumScraper = require('./scrapers/forum-scraper');
const DealsScraper = require('./scrapers/deals-scraper');
const RedditScraper = require('./scrapers/reddit-scraper');
const YoutubeScraper = require('./scrapers/youtube-scraper');

function validateConfig() {
  const required = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID', 'GEMINI_API_KEY'];
  const missing = required.filter(key => !process.env[key] || process.env[key].includes('_here'));
  if (missing.length > 0) {
    logger.error('Missing configuration! Set these in .env:');
    missing.forEach(key => logger.error(`  ❌ ${key}`));
    process.exit(1);
  }
}

// ─── Dynamic Bot Instance Factory ──────────────────────────────────────────
function createBotInstances(database, summarizer) {
  const categories = database.getActiveCategories();
  const botInstances = new Map();

  for (const cat of categories) {
    const token = cat.bot_token;
    const chatId = cat.chat_id;

    if (!token || !chatId) {
      logger.warn(`⚠️ Category "${cat.display_name}" (${cat.slug}) is missing bot_token or chat_id. Skipping bot creation.`);
      continue;
    }

    try {
      const bot = new TelegramBotDispatcher(
        token,
        chatId,
        database,
        summarizer,
        cat.slug,
        cat.ai_prompt || undefined
      );
      botInstances.set(cat.slug, bot);
      logger.info(`🤖 Created bot instance for category: ${cat.display_name} (${cat.slug})`);
    } catch (err) {
      logger.error(`Failed to create bot for category "${cat.slug}": ${err.message}`);
    }
  }

  return botInstances;
}

// ─── Dashboard & API Express Server ──────────────────────────────────────────
function startDashboardServer(database, whatsapp, telegramUser, scheduler, summarizer, botInstances, scrapers = {}) {
  const PORT = parseInt(process.env.HEALTH_PORT || '3000', 10);
  const app = express();

  app.use(express.json());
  app.use(express.static(path.join(__dirname, '../public')));

  // ─── Health ──────────────────────────────────────────────────────────────
  app.get('/health', (req, res) => {
    const waStatus = whatsapp.getStatus();
    const msgCount = database.getTodayMessageCount('cc');
    res.json({
      healthy: true,
      whatsapp: waStatus.isReady ? 'connected' : 'connecting',
      whatsappQr: waStatus.qr || null,
      messagesToday: msgCount,
      targetGroups: waStatus.targetCount,
      uptime: Math.floor(process.uptime()),
    });
  });

  // ─── Scraper Health API ───────────────────────────────────────────────────
  app.get('/api/health', (req, res) => {
    try {
      res.json(database.getAllScraperHealth());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Sources CRUD ────────────────────────────────────────────────────────
  app.get('/api/sources', (req, res) => {
    try {
      res.json(database.getAllSources());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/sources', (req, res) => {
    try {
      const { name, source_id, type } = req.body;
      if (!name || !source_id || !type) return res.status(400).json({ error: 'Missing fields' });
      database.addSource(name, source_id.trim(), type);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/sources/:id', (req, res) => {
    try {
      database.deleteSource(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/sources/:id', (req, res) => {
    try {
      const { is_active } = req.body;
      database.toggleSource(req.params.id, is_active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Categories CRUD ─────────────────────────────────────────────────────
  app.get('/api/categories', (req, res) => {
    try {
      res.json(database.getAllCategories());
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/categories', async (req, res) => {
    try {
      const { slug, display_name, bot_token, chat_id, ai_prompt, delivery_channel, whatsapp_delivery_jid } = req.body;
      if (!slug || !display_name) {
        return res.status(400).json({ error: 'Missing slug or display_name' });
      }
      if (!/^[a-z0-9-]+$/.test(slug)) {
        return res.status(400).json({ error: 'Slug must be lowercase letters, numbers, and hyphens only' });
      }
      database.addCategory(slug, display_name, bot_token, chat_id, ai_prompt, delivery_channel, whatsapp_delivery_jid);

      if (bot_token && chat_id) {
        try {
          const newBot = new TelegramBotDispatcher(
            bot_token, chat_id, database, summarizer, slug, ai_prompt || undefined
          );
          botInstances.set(slug, newBot);
          await newBot.start();
          scheduler.updateBotInstances(botInstances);
          logger.info(`🔄 Hot-loaded new bot instance for category: ${slug}`);
        } catch (botErr) {
          logger.error(`Bot creation failed for new category "${slug}": ${botErr.message}`);
        }
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX: allow toggle-only PATCH (only is_active) without requiring display_name
  app.patch('/api/categories/:id', async (req, res) => {
    try {
      const { display_name, bot_token, chat_id, ai_prompt, is_active, delivery_channel, whatsapp_delivery_jid } = req.body;

      // Toggle-only call: just flip is_active, no full update needed
      if (is_active !== undefined && !display_name && !bot_token && !chat_id && ai_prompt === undefined) {
        database.toggleCategory(req.params.id, is_active ? 1 : 0);
        return res.json({ success: true });
      }

      if (!display_name) return res.status(400).json({ error: 'Missing display_name' });
      database.updateCategory(
        req.params.id, display_name, bot_token, chat_id, ai_prompt,
        is_active !== undefined ? is_active : 1, delivery_channel, whatsapp_delivery_jid);

      const updatedCat = database.getAllCategories().find(c => c.id === parseInt(req.params.id));
      if (updatedCat && bot_token && chat_id) {
        try {
          const oldBot = botInstances.get(updatedCat.slug);
          if (oldBot) { await oldBot.stop(); botInstances.delete(updatedCat.slug); }
          const newBot = new TelegramBotDispatcher(
            bot_token, chat_id, database, summarizer, updatedCat.slug, ai_prompt || undefined
          );
          botInstances.set(updatedCat.slug, newBot);
          await newBot.start();
          scheduler.updateBotInstances(botInstances);
          logger.info(`🔄 Hot-reloaded bot instance for category: ${updatedCat.slug}`);
        } catch (botErr) {
          logger.error(`Bot hot-reload failed for category "${updatedCat.slug}": ${botErr.message}`);
        }
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/categories/:id', async (req, res) => {
    try {
      const allCats = database.getAllCategories();
      const cat = allCats.find(c => c.id === parseInt(req.params.id));

      if (cat && (cat.slug === 'cc' || cat.slug === 'deals')) {
        return res.status(400).json({ error: 'Cannot delete built-in CC or Deals categories' });
      }

      database.deleteCategory(req.params.id);

      if (cat && botInstances.has(cat.slug)) {
        try { await botInstances.get(cat.slug).stop(); } catch (e) { /* ignore */ }
        botInstances.delete(cat.slug);
        scheduler.updateBotInstances(botInstances);
      }

      if (cat) {
        const catSources = database.getSourcesByCategory(cat.slug);
        catSources.forEach(s => database.deleteSource(s.id));
      }

      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/categories/:id/test', async (req, res) => {
    try {
      const cat = database.getAllCategories().find(c => c.id === parseInt(req.params.id));
      if (!cat) return res.status(404).json({ error: 'Category not found' });
      if (!cat.bot_token || !cat.chat_id) {
        return res.status(400).json({ error: 'Category must have a bot token and chat ID configured' });
      }
      const { Telegraf } = require('telegraf');
      const testBot = new Telegraf(cat.bot_token);
      await testBot.telegram.sendMessage(
        cat.chat_id,
        `🧪 <b>Test Message</b>\n\n✅ Category "${cat.display_name}" is configured correctly!\nBot token and Chat ID verified successfully.`,
        { parse_mode: 'HTML' }
      );
      res.json({ success: true, message: 'Test message sent successfully!' });
    } catch (err) {
      res.status(500).json({ error: `Test failed: ${err.message}` });
    }
  });

  app.patch('/api/categories/:id/toggle', (req, res) => {
    try {
      const { is_active } = req.body;
      database.toggleCategory(req.params.id, is_active);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Schedules CRUD ──────────────────────────────────────────────────────
  app.get('/api/schedules', (req, res) => {
    try {
      const rules = database.getAllScheduleRules();
      const liveStatus = scheduler.getStatus();
      const liveIds = new Set(liveStatus.map(j => j.ruleId));
      const enriched = rules.map(r => ({ ...r, is_running: liveIds.has(r.id) }));
      res.json(enriched);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/schedules/:slug', (req, res) => {
    try {
      const rules = database.getScheduleRules(req.params.slug);
      res.json(rules);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // FIX: /api/schedules/trigger MUST be registered BEFORE POST /api/schedules
  // Otherwise Express matches "trigger" as the body of POST /api/schedules and returns an error.
  app.post('/api/schedules/trigger', async (req, res) => {
    try {
      const { slug } = req.body;
      logger.info(`⚡ Manual trigger via API${slug ? ` for category: ${slug}` : ' for all categories'}.`);
      scheduler.triggerNow(slug || null).catch(e =>
        logger.error(`Manual trigger error: ${e.message}`)
      );
      res.json({ success: true, message: slug ? `Brief triggered for "${slug}"` : 'Brief triggered for all categories' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Keep legacy /api/trigger alias so any old bookmarks still work
  app.post('/api/trigger', async (req, res) => {
    try {
      const { slug } = req.body;
      logger.info(`⚡ [legacy /api/trigger] Manual trigger${slug ? ` for: ${slug}` : ' for all'}.`);
      scheduler.triggerNow(slug || null).catch(e =>
        logger.error(`Manual trigger error: ${e.message}`)
      );
      res.json({ success: true, message: slug ? `Brief triggered for "${slug}"` : 'Brief triggered for all categories' });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/schedules', (req, res) => {
    try {
      const { category_slug, cron_expression, label } = req.body;
      if (!category_slug || !cron_expression || !label) {
        return res.status(400).json({ error: 'Missing category_slug, cron_expression, or label' });
      }
      const cron = require('node-cron');
      if (!cron.validate(cron_expression)) {
        return res.status(400).json({ error: `Invalid cron expression: "${cron_expression}"` });
      }
      const cat = database.getCategoryBySlug(category_slug);
      if (!cat) {
        return res.status(404).json({ error: `Category "${category_slug}" not found` });
      }
      database.addScheduleRule(category_slug, cron_expression, label);
      scheduler.reload();
      logger.info(`📅 New schedule rule added for "${category_slug}": ${label} (${cron_expression})`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/schedules/:id', (req, res) => {
    try {
      const { cron_expression, label, is_active } = req.body;
      // Allow toggle-only PATCH (only is_active, no cron/label required)
      if (is_active !== undefined && !cron_expression && !label) {
        database.toggleScheduleRule(req.params.id, is_active ? 1 : 0);
        scheduler.reload();
        return res.json({ success: true });
      }
      if (!cron_expression || !label) {
        return res.status(400).json({ error: 'Missing cron_expression or label' });
      }
      const cron = require('node-cron');
      if (!cron.validate(cron_expression)) {
        return res.status(400).json({ error: `Invalid cron expression: "${cron_expression}"` });
      }
      database.updateScheduleRule(
        req.params.id, cron_expression, label,
        is_active !== undefined ? (is_active ? 1 : 0) : 1
      );
      scheduler.reload();
      logger.info(`📅 Schedule rule #${req.params.id} updated.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.patch('/api/schedules/:id/toggle', (req, res) => {
    try {
      const { is_active } = req.body;
      if (is_active === undefined) return res.status(400).json({ error: 'Missing is_active' });
      database.toggleScheduleRule(req.params.id, is_active ? 1 : 0);
      scheduler.reload();
      logger.info(`📅 Schedule rule #${req.params.id} toggled to ${is_active ? 'active' : 'paused'}.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/schedules/:id', (req, res) => {
    try {
      database.deleteScheduleRule(req.params.id);
      scheduler.reload();
      logger.info(`📅 Schedule rule #${req.params.id} deleted.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Telegram User Auth APIs ──────────────────────────────────────────────
  app.get('/api/telegram/status', (req, res) => {
    res.json({ isReady: telegramUser.isReady, tempPhone: telegramUser.tempPhone });
  });

  app.post('/api/telegram/send-code', async (req, res) => {
    try {
      const { phoneNumber } = req.body;
      if (!phoneNumber) return res.status(400).json({ error: 'Missing phone number' });
      await telegramUser.sendLoginCode(phoneNumber);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/submit-code', async (req, res) => {
    try {
      const { code, password } = req.body;
      if (!code) return res.status(400).json({ error: 'Missing OTP code' });
      await telegramUser.submitLoginCode(code, password);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/telegram/logout', async (req, res) => {
    try {
      await telegramUser.logout();
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/telegram/discover', async (req, res) => {
    try {
      const channels = await telegramUser.listAllSubscribedChannels();
      res.json(channels);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get('/api/whatsapp/discover', (req, res) => {
    try {
      const groups = whatsapp.getAllChats();
      res.json(groups);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── WhatsApp Sources Management ──────────────────────────────────────────
  app.get('/api/whatsapp/sources', (req, res) => {
    try {
      const allSources = database.getAllSources().filter(s => s.type.endsWith('-whatsapp'));
      res.json(allSources);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/whatsapp/sources', (req, res) => {
    try {
      const { name, source_id, category_slug } = req.body;
      if (!name || !source_id || !category_slug) {
        return res.status(400).json({ error: 'Missing name, source_id, or category_slug' });
      }
      const type = `${category_slug}-whatsapp`;
      database.addSource(name, source_id.trim(), type);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/whatsapp/sources/:id', (req, res) => {
    try {
      database.deleteSource(req.params.id);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // ─── Session Cookies Manager APIs ─────────────────────────────────────────
  app.get('/api/cookies', (req, res) => {
    try {
      const SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
      const result = SITES.map(site => {
        const row = database.getCookies(site);
        const filePath = path.resolve(__dirname, `../data/${site}_cookies.json`);
        const fileExists = fs.existsSync(filePath);
        let updatedAt = null;
        if (row) {
          try {
            const meta = database.db.prepare('SELECT updated_at FROM cookies WHERE site = ?').get(site);
            updatedAt = meta ? meta.updated_at : null;
          } catch (e) { /* ignore */ }
        } else if (fileExists) {
          const stat = fs.statSync(filePath);
          updatedAt = stat.mtime.toISOString();
        }
        return { site, has_cookies: !!(row || fileExists), updated_at: updatedAt };
      });
      res.json(result);
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cookies', (req, res) => {
    try {
      const { site, cookies } = req.body;
      if (!site || !cookies) return res.status(400).json({ error: 'Missing site or cookies payload' });
      const VALID_SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
      if (!VALID_SITES.includes(site)) {
        return res.status(400).json({ error: `Invalid site. Must be one of: ${VALID_SITES.join(', ')}` });
      }
      let parsedCookies = cookies;
      if (typeof cookies === 'string') {
        try { parsedCookies = JSON.parse(cookies.trim()); }
        catch (e) { return res.status(400).json({ error: 'Invalid JSON format. Please paste the full cookies array.' }); }
      }
      if (!Array.isArray(parsedCookies) || parsedCookies.length === 0) {
        return res.status(400).json({ error: 'Cookies must be a non-empty JSON array.' });
      }
      database.saveCookies(site, parsedCookies);
      try {
        const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(parsedCookies, null, 2), 'utf8');
      } catch (fileErr) {
        logger.debug(`Could not write cookies to file: ${fileErr.message}`);
      }
      logger.info(`🔐 Saved ${parsedCookies.length} cookies for ${site}.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.delete('/api/cookies/:site', (req, res) => {
    try {
      const { site } = req.params;
      const VALID_SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
      if (!VALID_SITES.includes(site)) {
        return res.status(400).json({ error: `Invalid site. Must be one of: ${VALID_SITES.join(', ')}` });
      }
      database.deleteCookies(site);
      const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      logger.info(`❌ Deleted cookies for ${site}.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  // Legacy import/delete endpoints (keep for backward compat)
  app.get('/api/cookies/status', (req, res) => {
    const SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
    const result = {};
    for (const site of SITES) {
      const row = database.getCookies(site);
      const filePath = path.resolve(__dirname, `../data/${site}_cookies.json`);
      result[site] = !!(row || fs.existsSync(filePath));
    }
    res.json(result);
  });

  app.post('/api/cookies/import', (req, res) => {
    try {
      const { site, cookies } = req.body;
      if (!site || !cookies) return res.status(400).json({ error: 'Missing site or cookies payload' });
      const VALID_SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
      if (!VALID_SITES.includes(site)) {
        return res.status(400).json({ error: 'Invalid site name' });
      }
      let parsedCookies = cookies;
      if (typeof cookies === 'string') {
        try { parsedCookies = JSON.parse(cookies.trim()); }
        catch (e) { return res.status(400).json({ error: 'Invalid JSON format.' }); }
      }
      if (!Array.isArray(parsedCookies)) {
        return res.status(400).json({ error: 'Cookies must be a valid JSON array.' });
      }
      database.saveCookies(site, parsedCookies);
      try {
        const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
        const dir = path.dirname(targetPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        fs.writeFileSync(targetPath, JSON.stringify(parsedCookies, null, 2), 'utf8');
      } catch (fileErr) {
        logger.debug(`Could not write cookies to legacy file: ${fileErr.message}`);
      }
      logger.info(`🔐 Saved imported cookies for ${site} successfully in DB & file.`);
      if (scrapers && scrapers[site]) {
        const fn = site === 'desidime'
          ? () => scrapers[site].scrapeDesiDime()
          : () => scrapers[site].scrape();
        fn().catch(e => logger.error(`Immediate ${site} scrape fail: ${e.message}`));
      }
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  app.post('/api/cookies/delete', (req, res) => {
    try {
      const { site } = req.body;
      if (!site) return res.status(400).json({ error: 'Missing site parameter' });
      const VALID_SITES = ['youtube', 'technofino', 'desidime', 'reddit'];
      if (!VALID_SITES.includes(site)) {
        return res.status(400).json({ error: 'Invalid site name' });
      }
      database.deleteCookies(site);
      const targetPath = path.resolve(__dirname, `../data/${site}_cookies.json`);
      if (fs.existsSync(targetPath)) fs.unlinkSync(targetPath);
      logger.info(`❌ Deleted session cookies for ${site} from DB & file.`);
      res.json({ success: true });
    } catch (err) {
      res.status(500).json({ error: err.message });
    }
  });

  const server = app.listen(PORT, () => {
    logger.info(`🌐 Dashboard Server successfully started on port ${PORT} — http://localhost:${PORT}`);
  });
  return server;
}

async function main() {
  logger.info('🚀 CC & Deals Brief Agent Clean-Slate Starting...');
  logger.info('================================================');

  validateConfig();

  const database = new MessageDatabase();

  database.seedDefaultCategories(
    process.env.TELEGRAM_BOT_TOKEN,
    process.env.TELEGRAM_CHAT_ID,
    process.env.DEALS_BOT_TOKEN || null,
    process.env.TELEGRAM_CHAT_ID
  );

  const summarizer = new Summarizer(process.env.GEMINI_API_KEY, process.env.OPENROUTER_API_KEY);
  const botInstances = createBotInstances(database, summarizer);

  const sendSystemAlert = async (message) => {
    logger.warn(`🚨 [System Alert] ${message}`);
    const plainMessage = message.replace(/<[^>]*>/g, '');

    // Send to Telegram
    const ccBotInstance = botInstances.get('cc');
    if (ccBotInstance) {
      try {
        await ccBotInstance.sendMessage(`🚨 <b>Session Alert</b>\n\n${message}`);
      } catch (err) {
        logger.error(`Failed to send Telegram system alert: ${err.message}`);
      }
    }

    // Send to WhatsApp Admin
    const adminJid = process.env.WHATSAPP_ADMIN_JID;
    if (adminJid) {
      try {
        await whatsapp.sendMessage(adminJid, `🚨 *Session Alert*\n\n${plainMessage}`);
      } catch (err) {
        logger.error(`Failed to send WhatsApp system alert: ${err.message}`);
      }
    }
  };

  const whatsapp = new WhatsAppListener(database, sendSystemAlert);
  const telegramUser = new TelegramUserListener(database, sendSystemAlert);
  const scheduler = new Scheduler(summarizer, botInstances, database, whatsapp);

  // Global restart function for critical failures
  global.restartWhatsApp = async (force = false) => {
    logger.warn('🔄 Received global request to restart WhatsApp client...');
    await whatsapp.stop();
    if (force) {
        const authPath = path.resolve(__dirname, '../data/baileys_auth');
        if (fs.existsSync(authPath)) {
            fs.rmSync(authPath, { recursive: true, force: true });
            logger.info('🧹 Forcing clean session. Cleared baileys_auth credentials folder.');
        }
    }
    setTimeout(() => {
        whatsapp.start().catch(err => logger.error(`WhatsApp restart failed: ${err.message}`));
    }, 5000);
  };

  const forumScraper = new ForumScraper(database, sendSystemAlert);
  const dealsScraper = new DealsScraper(database, sendSystemAlert);
  const redditScraper = new RedditScraper(database, sendSystemAlert);
  const youtubeScraper = new YoutubeScraper(database, summarizer);

  const scrapers = {
    reddit: redditScraper,
    technofino: forumScraper,
    desidime: dealsScraper,
  };
  const healthServer = startDashboardServer(
    database, whatsapp, telegramUser, scheduler, summarizer, botInstances, scrapers
  );

  for (const [slug, bot] of botInstances) {
    const connected = await bot.start();
    if (!connected) {
      logger.warn(`⚠️ Telegram Bot for category "${slug}" failed to connect.`);
      if (slug === 'cc') {
        logger.error('Cannot connect to Main CC Telegram Bot. Verify your TELEGRAM_BOT_TOKEN.');
        process.exit(1);
      }
    }
  }

  whatsapp.start().catch(err => logger.error(`WhatsApp listener failed: ${err.message}`));
  telegramUser.start().catch(err => logger.error(`Telegram user listener failed: ${err.message}`));
  scheduler.start();

  forumScraper.start();
  dealsScraper.start();
  redditScraper.start();
  youtubeScraper.start();

  for (const [slug, bot] of botInstances) {
    try {
      if (slug === 'cc') {
        await bot.sendStartupNotification();
      } else {
        const cat = database.getCategoryBySlug(slug);
        const displayName = cat ? cat.display_name : slug.toUpperCase();
        await bot.sendMessage(`🟢 <b>${displayName} Brief Agent Started</b>\nAll scrapers operational.`);
      }
    } catch (err) {
      logger.warn(`Failed to send startup notification for "${slug}": ${err.message}`);
    }
  }

  const shutdown = async (signal) => {
    logger.info(`\n${signal} signal received. Powering down gracefully...`);
    scheduler.stop();
    forumScraper.stop();
    dealsScraper.stop();
    redditScraper.stop();
    youtubeScraper.stop();
    await whatsapp.stop();
    await telegramUser.logout();
    for (const [, bot] of botInstances) {
      try { await bot.stop(); } catch (e) { /* ignore */ }
    }
    database.close();
    healthServer.close();
    logger.info('Graceful shutdown complete. Bye! 👋');
    process.exit(0);
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  logger.error(`Fatal boot error: ${err.message}`);
  logger.error(err.stack);
  process.exit(1);
});
