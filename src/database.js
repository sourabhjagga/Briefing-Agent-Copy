/**
 * Database Module
 * High-performance, pre-compiled query layer for storing, retrieving, and searching messages/sources.
 * Includes per-category schedule_rules and scraper_health tables.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class MessageDatabase {
  constructor(dbPath) {
    const resolvedPath = path.resolve(dbPath || process.env.DB_PATH || './data/messages.db');
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    
    this._initialize();
    this._compileStatements();
    
    logger.info(`✅ SQLite Database initialized at: ${resolvedPath}`);
  }

  _initialize() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        group_name TEXT NOT NULL,
        group_id TEXT,
        chat_type TEXT DEFAULT 'group',
        sender_name TEXT,
        sender_number TEXT,
        body TEXT,
        timestamp INTEGER NOT NULL,
        has_media INTEGER DEFAULT 0,
        media_caption TEXT,
        is_forwarded INTEGER DEFAULT 0,
        source_type TEXT DEFAULT 'cc-whatsapp',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);
      CREATE INDEX IF NOT EXISTS idx_messages_search ON messages(body, source_type);
      CREATE INDEX IF NOT EXISTS idx_messages_composite ON messages(source_type, timestamp);

      CREATE TABLE IF NOT EXISTS summary_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_date TEXT NOT NULL,
        message_count INTEGER,
        summary_text TEXT,
        sent_to_telegram INTEGER DEFAULT 0,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS daily_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_date TEXT NOT NULL UNIQUE,
        brief_text TEXT NOT NULL,
        message_count INTEGER,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_id TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        bot_token TEXT,
        chat_id TEXT,
        ai_prompt TEXT,
        is_active INTEGER DEFAULT 1,
        delivery_channel TEXT DEFAULT 'telegram',
        created_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS cookies (
        site TEXT PRIMARY KEY,
        cookies_json TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE TABLE IF NOT EXISTS schedule_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_slug TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        label TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT (datetime('now')),
        updated_at TEXT DEFAULT (datetime('now'))
      );

      CREATE INDEX IF NOT EXISTS idx_schedule_rules_slug ON schedule_rules(category_slug);

      CREATE TABLE IF NOT EXISTS scraper_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scraper_name TEXT NOT NULL UNIQUE,
        last_success_at TEXT,
        last_failure_at TEXT,
        consecutive_failures INTEGER DEFAULT 0,
        last_error TEXT,
        updated_at TEXT DEFAULT (datetime('now'))
      );
    `);
  }

  _compileStatements() {
    this.statements = {
      saveMessage: this.db.prepare(`
        INSERT OR IGNORE INTO messages 
          (message_id, group_name, group_id, chat_type, sender_name, sender_number, body, timestamp, has_media, media_caption, is_forwarded, source_type)
        VALUES 
          (@message_id, @group_name, @group_id, @chat_type, @sender_name, @sender_number, @body, @timestamp, @has_media, @media_caption, @is_forwarded, @source_type)
      `),
      getTodayMessages: this.db.prepare(`
        SELECT group_name, group_id, chat_type, sender_name, body, timestamp, has_media, media_caption, is_forwarded
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        ORDER BY group_name, timestamp ASC
      `),
      getTodayActiveGroups: this.db.prepare(`
        SELECT group_name, group_id, chat_type, COUNT(*) as count
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        GROUP BY group_id
        ORDER BY count DESC
      `),
      searchMessages: this.db.prepare(`
        SELECT group_name, sender_name, body, timestamp, chat_type
        FROM messages
        WHERE body LIKE ? AND source_type LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      getMessagesByTopic: this.db.prepare(`
        SELECT group_name, sender_name, body, timestamp, chat_type
        FROM messages
        WHERE body LIKE ? AND timestamp >= ?
        ORDER BY timestamp DESC
        LIMIT 50
      `),
      saveBrief: this.db.prepare(`
        INSERT OR REPLACE INTO daily_briefs (brief_date, brief_text, message_count)
        VALUES (?, ?, ?)
      `),
      getBrief: this.db.prepare(`
        SELECT * FROM daily_briefs WHERE brief_date = ?
      `),
      getAllBriefs: this.db.prepare(`
        SELECT brief_date, message_count, created_at FROM daily_briefs ORDER BY created_at DESC LIMIT ?
      `),
      saveSummary: this.db.prepare(`
        INSERT INTO summary_log (summary_date, message_count, summary_text, sent_to_telegram)
        VALUES (?, ?, ?, ?)
      `),
      getStatsTotal: this.db.prepare(`
        SELECT COUNT(*) as total FROM messages WHERE timestamp >= ? AND source_type LIKE ?
      `),
      getStatsByGroup: this.db.prepare(`
        SELECT group_name, chat_type, COUNT(*) as count 
        FROM messages WHERE timestamp >= ? AND source_type LIKE ?
        GROUP BY group_name ORDER BY count DESC
      `),
      cleanup: this.db.prepare(`
        DELETE FROM messages WHERE timestamp < ?
      `),
      getAllSources: this.db.prepare(`
        SELECT * FROM sources ORDER BY created_at DESC
      `),
      getActiveSourcesByType: this.db.prepare(`
        SELECT source_id FROM sources WHERE type = ? AND is_active = 1
      `),
      addSource: this.db.prepare(`
        INSERT INTO sources (name, source_id, type, is_active)
        VALUES (?, ?, ?, 1)
        ON CONFLICT(source_id) DO UPDATE SET 
          name=excluded.name, 
          type=excluded.type, 
          is_active=1
      `),
      addSourceInactive: this.db.prepare(`
        INSERT OR IGNORE INTO sources (name, source_id, type, is_active)
        VALUES (?, ?, ?, 0)
      `),
      toggleSource: this.db.prepare(`
        UPDATE sources SET is_active = ? WHERE id = ?
      `),
      deleteSource: this.db.prepare(`
        DELETE FROM sources WHERE id = ?
      `),
      getAllCategories: this.db.prepare(`
        SELECT * FROM categories ORDER BY created_at ASC
      `),
      getActiveCategories: this.db.prepare(`
        SELECT * FROM categories WHERE is_active = 1 ORDER BY created_at ASC
      `),
      getCategoryBySlug: this.db.prepare(`
        SELECT * FROM categories WHERE slug = ?
      `),
      addCategory: this.db.prepare(`
        INSERT INTO categories (slug, display_name, bot_token, chat_id, ai_prompt, is_active, delivery_channel)
        VALUES (?, ?, ?, ?, ?, 1, ?)
        ON CONFLICT(slug) DO UPDATE SET
          display_name=excluded.display_name,
          bot_token=excluded.bot_token,
          chat_id=excluded.chat_id,
          ai_prompt=excluded.ai_prompt,
          delivery_channel=excluded.delivery_channel,
          is_active=1
      `),
      updateCategory: this.db.prepare(`
        UPDATE categories SET display_name=?, bot_token=?, chat_id=?, ai_prompt=?, is_active=?, delivery_channel=? WHERE id=?
      `),
      deleteCategory: this.db.prepare(`
        DELETE FROM categories WHERE id = ? AND slug NOT IN ('cc', 'deals')
      `),
      toggleCategory: this.db.prepare(`
        UPDATE categories SET is_active = ? WHERE id = ?
      `),
      saveCookies: this.db.prepare(`
        INSERT INTO cookies (site, cookies_json)
        VALUES (?, ?)
        ON CONFLICT(site) DO UPDATE SET
          cookies_json=excluded.cookies_json,
          updated_at=datetime('now')
      `),
      getCookies: this.db.prepare(`
        SELECT cookies_json FROM cookies WHERE site = ?
      `),
      deleteCookies: this.db.prepare(`
        DELETE FROM cookies WHERE site = ?
      `),
      // Schedule rules
      getScheduleRules: this.db.prepare(`
        SELECT * FROM schedule_rules WHERE category_slug = ? ORDER BY id ASC
      `),
      getAllScheduleRules: this.db.prepare(`
        SELECT * FROM schedule_rules ORDER BY category_slug, id ASC
      `),
      addScheduleRule: this.db.prepare(`
        INSERT INTO schedule_rules (category_slug, cron_expression, label, is_active)
        VALUES (?, ?, ?, 1)
      `),
      updateScheduleRule: this.db.prepare(`
        UPDATE schedule_rules SET cron_expression=?, label=?, is_active=?, updated_at=datetime('now') WHERE id=?
      `),
      deleteScheduleRule: this.db.prepare(`
        DELETE FROM schedule_rules WHERE id=?
      `),
      toggleScheduleRule: this.db.prepare(`
        UPDATE schedule_rules SET is_active=?, updated_at=datetime('now') WHERE id=?
      `),
      // Scraper health
      recordScraperSuccess: this.db.prepare(`
        INSERT INTO scraper_health (scraper_name, last_success_at, consecutive_failures, updated_at)
        VALUES (?, datetime('now'), 0, datetime('now'))
        ON CONFLICT(scraper_name) DO UPDATE SET
          last_success_at=datetime('now'), consecutive_failures=0, updated_at=datetime('now')
      `),
      recordScraperFailure: this.db.prepare(`
        INSERT INTO scraper_health (scraper_name, last_failure_at, consecutive_failures, last_error, updated_at)
        VALUES (?, datetime('now'), 1, ?, datetime('now'))
        ON CONFLICT(scraper_name) DO UPDATE SET
          last_failure_at=datetime('now'),
          consecutive_failures=consecutive_failures+1,
          last_error=excluded.last_error,
          updated_at=datetime('now')
      `),
      getAllScraperHealth: this.db.prepare(`
        SELECT * FROM scraper_health ORDER BY scraper_name ASC
      `),
    };
  }

  saveMessage(message) {
    try {
      this.statements.saveMessage.run({
        message_id: message.messageId,
        group_name: message.groupName,
        group_id: message.groupId || '',
        chat_type: message.chatType || 'group',
        sender_name: message.senderName || 'Unknown',
        sender_number: message.senderNumber || '',
        body: message.body || '',
        timestamp: message.timestamp,
        has_media: message.hasMedia ? 1 : 0,
        media_caption: message.mediaCaption || '',
        is_forwarded: message.isForwarded ? 1 : 0,
        source_type: message.sourceType || 'cc-whatsapp',
      });
    } catch (err) {
      if (!err.message.includes('UNIQUE constraint')) {
        logger.error(`Failed to save message: ${err.message}`);
      }
    }
  }

  getTodayMessages(sourcePrefix = 'cc') {
    const midnightUTC = this._getMidnightIST();
    return this.statements.getTodayMessages.all(midnightUTC, `${sourcePrefix}%`);
  }

  getTodayMessageCount(sourcePrefix = 'cc') {
    return this.getTodayMessages(sourcePrefix).length;
  }

  getTodayActiveGroups(sourcePrefix = 'cc') {
    const midnightUTC = this._getMidnightIST();
    return this.statements.getTodayActiveGroups.all(midnightUTC, `${sourcePrefix}%`);
  }

  searchMessages(keyword, limit = 20, sourcePrefix = 'cc') {
    return this.statements.searchMessages.all(`%${keyword}%`, `${sourcePrefix}%`, limit);
  }

  getMessagesByTopic(topic, days = 7) {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    return this.statements.getMessagesByTopic.all(`%${topic}%`, since);
  }

  saveBrief(date, briefText, messageCount) {
    this.statements.saveBrief.run(date, briefText, messageCount);
  }

  getBrief(date) {
    return this.statements.getBrief.get(date);
  }

  getAllBriefs(limit = 30) {
    return this.statements.getAllBriefs.all(limit);
  }

  saveSummary(date, messageCount, summaryText, sentToTelegram) {
    this.statements.saveSummary.run(date, messageCount, summaryText, sentToTelegram ? 1 : 0);
  }

  getStats(days = 7, sourcePrefix = 'cc') {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    const total = this.statements.getStatsTotal.get(since, `${sourcePrefix}%`).total;
    const groups = this.statements.getStatsByGroup.all(since, `${sourcePrefix}%`);
    return { totalMessages: total, byGroup: groups };
  }

  cleanup(daysToKeep = 30) {
    const cutoff = Math.floor(Date.now() / 1000) - daysToKeep * 24 * 60 * 60;
    const result = this.statements.cleanup.run(cutoff);
    if (result.changes > 0) {
      logger.info(`🧹 Cleaned up ${result.changes} messages older than ${daysToKeep} days`);
    }
  }

  getAllSources() { return this.statements.getAllSources.all(); }
  getActiveSourcesByType(type) { return this.statements.getActiveSourcesByType.all(type).map(r => r.source_id); }
  addSource(name, sourceId, type) { this.statements.addSource.run(name, sourceId, type); }
  addSourceInactive(name, sourceId, type) { this.statements.addSourceInactive.run(name, sourceId, type); }
  toggleSource(id, isActive) { this.statements.toggleSource.run(isActive ? 1 : 0, id); }
  deleteSource(id) { this.statements.deleteSource.run(id); }
  getAllCategories() { return this.statements.getAllCategories.all(); }
  getActiveCategories() { return this.statements.getActiveCategories.all(); }
  getCategoryBySlug(slug) { return this.statements.getCategoryBySlug.get(slug); }
  addCategory(slug, displayName, botToken, chatId, aiPrompt, deliveryChannel = 'telegram') {
    this.statements.addCategory.run(slug, displayName, botToken || null, chatId || null, aiPrompt || null, deliveryChannel);
  }
  updateCategory(id, displayName, botToken, chatId, aiPrompt, isActive, deliveryChannel = 'telegram') {
    this.statements.updateCategory.run(displayName, botToken || null, chatId || null, aiPrompt || null, isActive ? 1 : 0, deliveryChannel, id);
  }
  deleteCategory(id) { return this.statements.deleteCategory.run(id); }
  toggleCategory(id, isActive) { this.statements.toggleCategory.run(isActive ? 1 : 0, id); }

  seedDefaultCategories(ccBotToken, ccChatId, dealsBotToken, dealsChatId) {
    const ccExists = this.getCategoryBySlug('cc');
    if (!ccExists) this.addCategory('cc', 'Credit Cards', ccBotToken, ccChatId, null);
    const premiumDealsPrompt = 'You are a premium, high-impact Shopping Deals AI assistant. Summarize the best, high-value shopping deals from the provided messages. Organize deals cleanly into logical categories (e.g., 💻 Electronics & Gadgets, 👕 Fashion & Lifestyle, 🛒 Groceries & Essentials, 🎫 Gift Cards & Vouchers, ✈️ Travel & Others).\nFor each deal:\n- Highlight the product/deal name and the final deal price or discount percentage in bold.\n- Isolate credit card specific savings or cashbacks (e.g., HDFC/SBI card discounts) and state them clearly.\n- CRITICAL: For every deal listing, you MUST provide the link as a clean HTML hyperlink: <a href="URL">View Deal</a> or <a href="URL">Get Deal</a>. DO NOT write "View Deal" or "Get Deal" as plain text without the <a> anchor tag, and NEVER print raw URLs.\nAvoid listing minor items, generic spams, or deals with no clear details/prices. Keep the brief exciting, highly structured, and elegant!';
    const dealsExists = this.getCategoryBySlug('deals');
    if (!dealsExists) {
      if (dealsBotToken) this.addCategory('deals', 'Shopping Deals', dealsBotToken, dealsChatId, premiumDealsPrompt);
    } else {
      if (!dealsExists.ai_prompt || !dealsExists.ai_prompt.includes('MUST provide the link as a clean HTML hyperlink')) {
        this.db.prepare("UPDATE categories SET ai_prompt = ? WHERE slug = 'deals'").run(premiumDealsPrompt);
        logger.info('🚀 Auto-upgraded Deals AI Prompt in database to enforce HTML hyperlinks.');
      }
    }
  }

  seedDefaultSchedules() {
    const defaults = [
      { slug: 'cc',    cron: '0 6 * * *',  label: 'Morning' },
      { slug: 'cc',    cron: '0 14 * * *', label: 'Mid-day' },
      { slug: 'cc',    cron: '0 22 * * *', label: 'Nightly' },
      { slug: 'deals', cron: '0 6 * * *',  label: 'Morning' },
      { slug: 'deals', cron: '0 14 * * *', label: 'Mid-day' },
      { slug: 'deals', cron: '0 22 * * *', label: 'Nightly' },
    ];
    const existing = this.statements.getAllScheduleRules.all();
    if (existing.length === 0) {
      for (const d of defaults) {
        this.statements.addScheduleRule.run(d.slug, d.cron, d.label);
      }
      logger.info('📅 Seeded default schedule rules for cc and deals categories.');
    }
  }

  getSourcesByCategory(categorySlug) {
    return this.getAllSources().filter(s => s.type.startsWith(categorySlug + '-'));
  }

  saveCookies(site, cookiesArray) {
    try { this.statements.saveCookies.run(site, JSON.stringify(cookiesArray)); }
    catch (err) { logger.error(`Failed to save cookies for ${site} in DB: ${err.message}`); }
  }
  getCookies(site) {
    try {
      const row = this.statements.getCookies.get(site);
      return row ? JSON.parse(row.cookies_json) : null;
    } catch (err) { logger.error(`Failed to get cookies for ${site} from DB: ${err.message}`); return null; }
  }
  deleteCookies(site) {
    try { this.statements.deleteCookies.run(site); }
    catch (err) { logger.error(`Failed to delete cookies for ${site} from DB: ${err.message}`); }
  }

  // Schedule rule CRUD
  getScheduleRules(categorySlug) { return this.statements.getScheduleRules.all(categorySlug); }
  getAllScheduleRules() { return this.statements.getAllScheduleRules.all(); }
  addScheduleRule(categorySlug, cronExpression, label) {
    return this.statements.addScheduleRule.run(categorySlug, cronExpression, label);
  }
  updateScheduleRule(id, cronExpression, label, isActive) {
    this.statements.updateScheduleRule.run(cronExpression, label, isActive ? 1 : 0, id);
  }
  deleteScheduleRule(id) { this.statements.deleteScheduleRule.run(id); }
  toggleScheduleRule(id, isActive) { this.statements.toggleScheduleRule.run(isActive ? 1 : 0, id); }

  // Scraper health
  recordScraperSuccess(scraperName) { this.statements.recordScraperSuccess.run(scraperName); }
  recordScraperFailure(scraperName, errorMsg) { this.statements.recordScraperFailure.run(scraperName, errorMsg || ''); }
  getAllScraperHealth() { return this.statements.getAllScraperHealth.all(); }

  _getMidnightIST() {
    const now = new Date();
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istNow = new Date(now.getTime() + istOffset);
    const istMidnight = new Date(istNow.getFullYear(), istNow.getMonth(), istNow.getDate());
    return Math.floor((istMidnight.getTime() - istOffset) / 1000);
  }

  close() {
    this.db.close();
    logger.info('Database connection closed');
  }
}

module.exports = MessageDatabase;
