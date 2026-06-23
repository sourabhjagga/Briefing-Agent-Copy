/**
 * Database Module
 * High-performance, pre-compiled query layer for storing, retrieving, and searching messages/sources.
 * Includes per-category schedule_rules and scraper_health tables.
 */

const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class DatabaseManager {
  constructor(dbPath) {
    const resolvedPath = path.resolve(dbPath);
    const dir = path.dirname(resolvedPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    this.db = new Database(resolvedPath);
    this.db.pragma('journal_mode = WAL');
    this.db.pragma('synchronous = NORMAL');
    this.db.pragma('foreign_keys = ON');
    this._initSchema();
    this._compileStatements();
    logger.info(`✅ Database initialized: ${resolvedPath}`);
  }

  _initSchema() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS messages (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        message_id TEXT UNIQUE,
        group_id TEXT,
        group_name TEXT,
        chat_type TEXT DEFAULT 'group',
        sender_name TEXT,
        sender_id TEXT,
        body TEXT,
        timestamp INTEGER,
        source_type TEXT,
        is_reply INTEGER DEFAULT 0,
        reply_to TEXT,
        media_type TEXT,
        url TEXT
      );
      CREATE INDEX IF NOT EXISTS idx_messages_timestamp ON messages(timestamp);
      CREATE INDEX IF NOT EXISTS idx_messages_source_type ON messages(source_type);
      CREATE INDEX IF NOT EXISTS idx_messages_group_id ON messages(group_id);

      CREATE TABLE IF NOT EXISTS daily_briefs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        brief_date TEXT UNIQUE,
        brief_text TEXT,
        message_count INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS summary_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        summary_date TEXT,
        message_count INTEGER,
        summary_text TEXT,
        sent_to_telegram INTEGER DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS sources (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        source_id TEXT UNIQUE NOT NULL,
        type TEXT NOT NULL,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS categories (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        slug TEXT UNIQUE NOT NULL,
        display_name TEXT NOT NULL,
        bot_token TEXT,
        chat_id TEXT,
        ai_prompt TEXT,
        is_active INTEGER DEFAULT 1,
        delivery_channel TEXT DEFAULT 'telegram',
        whatsapp_delivery_jid TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS schedule_rules (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_slug TEXT NOT NULL,
        cron_expression TEXT NOT NULL,
        label TEXT,
        is_active INTEGER DEFAULT 1,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS scraper_health (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id TEXT NOT NULL,
        source_type TEXT NOT NULL,
        last_success DATETIME,
        last_attempt DATETIME,
        error_count INTEGER DEFAULT 0,
        last_error TEXT,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );

      CREATE TABLE IF NOT EXISTS cookies_store (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        site TEXT UNIQUE NOT NULL,
        cookies_json TEXT NOT NULL,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      );
    `);

    // Migrate: add delivery_channel column if not present (for existing installs)
    try {
      this.db.exec(`ALTER TABLE categories ADD COLUMN delivery_channel TEXT DEFAULT 'telegram'`);
      logger.info('📊 Migrated: added delivery_channel column to categories');
    } catch (e) { /* already exists */ }

    // Migrate: add whatsapp_delivery_jid column if not present
    try {
      this.db.exec(`ALTER TABLE categories ADD COLUMN whatsapp_delivery_jid TEXT`);
      logger.info('📊 Migrated: added whatsapp_delivery_jid column to categories');
    } catch (e) { /* already exists */ }
  }

  _compileStatements() {
    this.statements = {
      insertMessage: this.db.prepare(`
        INSERT OR IGNORE INTO messages
          (message_id, group_id, group_name, chat_type, sender_name, sender_id, body, timestamp, source_type, is_reply, reply_to, media_type, url)
        VALUES
          (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `),
      getTodayMessages: this.db.prepare(`
        SELECT * FROM messages
        WHERE source_type LIKE ? AND timestamp >= ?
        ORDER BY timestamp ASC
      `),
      getTodayMessageCount: this.db.prepare(`
        SELECT COUNT(*) as count FROM messages
        WHERE source_type LIKE ? AND timestamp >= ?
      `),
      getTodayActiveGroups: this.db.prepare(`
        SELECT group_name, group_id, chat_type, COUNT(*) as count
        FROM messages
        WHERE source_type LIKE ? AND timestamp >= ?
        GROUP BY group_id
        ORDER BY count DESC
      `),
      searchMessages: this.db.prepare(`
        SELECT * FROM messages
        WHERE body LIKE ? AND source_type LIKE ?
        ORDER BY timestamp DESC
        LIMIT ?
      `),
      getMessagesByTopic: this.db.prepare(`
        SELECT * FROM messages
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
      getSourcesByCategory: this.db.prepare(`
        SELECT * FROM sources WHERE type LIKE ? ORDER BY created_at DESC
      `),
      getLatestMessageForSource: this.db.prepare(`
        SELECT body, timestamp, sender_name
        FROM messages
        WHERE source_type = ?
          AND (
            LOWER(group_name) LIKE ?
            OR LOWER(group_id) = ?
            OR LOWER(group_id) LIKE ?
            OR LOWER(message_id) LIKE ?
          )
        ORDER BY timestamp DESC
        LIMIT 1
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
        INSERT INTO sources (name, source_id, type, is_active)
        VALUES (?, ?, ?, 0)
        ON CONFLICT(source_id) DO UPDATE SET 
          name=excluded.name, 
          type=excluded.type
      `),
      toggleSource: this.db.prepare(`UPDATE sources SET is_active = ? WHERE id = ?`),
      updateSourceType: this.db.prepare(`UPDATE sources SET type = ? WHERE id = ?`),
      deleteSource: this.db.prepare(`DELETE FROM sources WHERE id = ?`),
      getAllCategories: this.db.prepare(`SELECT * FROM categories ORDER BY created_at ASC`),
      getActiveCategories: this.db.prepare(`SELECT * FROM categories WHERE is_active = 1 ORDER BY created_at ASC`),
      getCategoryBySlug: this.db.prepare(`SELECT * FROM categories WHERE slug = ?`),
      getCategoryById: this.db.prepare(`SELECT * FROM categories WHERE id = ?`),
      insertCategory: this.db.prepare(`
        INSERT INTO categories (slug, display_name, bot_token, chat_id, ai_prompt, is_active, delivery_channel, whatsapp_delivery_jid)
        VALUES (?, ?, ?, ?, ?, 1, ?, ?)
      `),
      updateCategory: this.db.prepare(`
        UPDATE categories
        SET display_name = ?, bot_token = ?, chat_id = ?, ai_prompt = ?, delivery_channel = ?, whatsapp_delivery_jid = ?
        WHERE id = ?
      `),
      toggleCategory: this.db.prepare(`UPDATE categories SET is_active = ? WHERE id = ?`),
      deleteCategory: this.db.prepare(`DELETE FROM categories WHERE id = ?`),
      getAllScheduleRules: this.db.prepare(`SELECT * FROM schedule_rules ORDER BY category_slug, id`),
      getScheduleRulesByCategory: this.db.prepare(`SELECT * FROM schedule_rules WHERE category_slug = ? ORDER BY id`),
      insertScheduleRule: this.db.prepare(`
        INSERT INTO schedule_rules (category_slug, cron_expression, label, is_active)
        VALUES (?, ?, ?, 1)
      `),
      updateScheduleRule: this.db.prepare(`
        UPDATE schedule_rules SET cron_expression = ?, label = ?, is_active = ? WHERE id = ?
      `),
      deleteScheduleRule: this.db.prepare(`DELETE FROM schedule_rules WHERE id = ?`),
      deleteScheduleRulesByCategory: this.db.prepare(`DELETE FROM schedule_rules WHERE category_slug = ?`),
      upsertScraperHealth: this.db.prepare(`
        INSERT INTO scraper_health (source_id, source_type, last_success, last_attempt, error_count, last_error, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(source_id) DO UPDATE SET
          last_success = excluded.last_success,
          last_attempt = excluded.last_attempt,
          error_count = excluded.error_count,
          last_error = excluded.last_error,
          updated_at = CURRENT_TIMESTAMP
      `),
      getScraperHealth: this.db.prepare(`SELECT * FROM scraper_health ORDER BY updated_at DESC`),
      saveCookies: this.db.prepare(`
        INSERT INTO cookies_store (site, cookies_json) VALUES (?, ?)
        ON CONFLICT(site) DO UPDATE SET cookies_json = excluded.cookies_json, updated_at = CURRENT_TIMESTAMP
      `),
      getCookies: this.db.prepare(`SELECT cookies_json FROM cookies_store WHERE site = ?`),
      getAllCookieSites: this.db.prepare(`SELECT site, updated_at FROM cookies_store`),
    };
  }

  insertMessage(data) {
    const result = this.statements.insertMessage.run(
      data.message_id, data.group_id, data.group_name, data.chat_type || 'group',
      data.sender_name, data.sender_id, data.body, data.timestamp,
      data.source_type, data.is_reply ? 1 : 0, data.reply_to || null,
      data.media_type || null, data.url || null
    );
    return result.changes > 0;
  }

  getTodayMessages(sourcePrefix) {
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    return this.statements.getTodayMessages.all(`${sourcePrefix}%`, startOfDay);
  }

  getTodayMessageCount(sourcePrefix) {
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    return this.statements.getTodayMessageCount.get(`${sourcePrefix}%`, startOfDay).count;
  }

  getTodayActiveGroups(sourcePrefix) {
    const startOfDay = Math.floor(new Date().setHours(0, 0, 0, 0) / 1000);
    return this.statements.getTodayActiveGroups.all(`${sourcePrefix}%`, startOfDay);
  }

  searchMessages(keyword, limit = 20, sourcePrefix = '') {
    const pattern = `%${keyword}%`;
    const typePattern = sourcePrefix ? `${sourcePrefix}%` : '%';
    return this.statements.searchMessages.all(pattern, typePattern, limit);
  }

  getMessagesByTopic(topic, days = 7) {
    const since = Math.floor(Date.now() / 1000) - days * 24 * 60 * 60;
    return this.statements.getMessagesByTopic.all(`%${topic}%`, since);
  }

  saveBrief(date, briefText, messageCount, categorySlug = 'cc') {
    // categorySlug accepted for forward-compatibility with multi-category persistence.
    this.statements.saveBrief.run(date, briefText, messageCount);
    if (categorySlug && categorySlug !== 'cc') {
      logger.info(`[DB] saveBrief called for category "${categorySlug}" — stored in shared daily_briefs table.`);
    }
  }

  getBrief(date) {
    return this.statements.getBrief.get(date);
  }

  getAllBriefs(limit = 30) {
    return this.statements.getAllBriefs.all(limit);
  }

  saveSummary(date, messageCount, summaryText, sentToTelegram, categorySlug = 'cc') {
    // categorySlug accepted for forward-compatibility with multi-category persistence.
    this.statements.saveSummary.run(date, messageCount, summaryText, sentToTelegram ? 1 : 0);
    if (categorySlug && categorySlug !== 'cc') {
      logger.info(`[DB] saveSummary called for category "${categorySlug}" — stored in shared summary_log table.`);
    }
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
  getSourcesByCategory(categorySlug) { return this.statements.getSourcesByCategory.all(`${categorySlug}-%`); }

  /**
   * Returns the single most-recent message for a given source.
   * Used by the /test bot command. Replaces the raw db.prepare() that was inline in telegram-bot.js.
   */
  getLatestMessageForSource(sourceType, cleanName, cleanSourceId) {
    return this.statements.getLatestMessageForSource.get(
      sourceType,
      `%${cleanName}%`,
      cleanSourceId,
      `%${cleanSourceId}%`,
      `%${cleanSourceId}%`
    );
  }

  addSource(name, sourceId, type) { this.statements.addSource.run(name, sourceId, type); }
  addSourceInactive(name, sourceId, type) { this.statements.addSourceInactive.run(name, sourceId, type); }
  toggleSource(id, isActive) { this.statements.toggleSource.run(isActive ? 1 : 0, id); }
  updateSourceType(id, type) { this.statements.updateSourceType.run(type, id); }
  deleteSource(id) { this.statements.deleteSource.run(id); }
  getAllCategories() { return this.statements.getAllCategories.all(); }
  getActiveCategories() { return this.statements.getActiveCategories.all(); }
  getCategoryBySlug(slug) { return this.statements.getCategoryBySlug.get(slug); }
  getCategoryById(id) { return this.statements.getCategoryById.get(id); }

  insertCategory(slug, displayName, botToken, chatId, aiPrompt, deliveryChannel = 'telegram', whatsappDeliveryJid = null) {
    return this.statements.insertCategory.run(slug, displayName, botToken, chatId, aiPrompt, deliveryChannel, whatsappDeliveryJid);
  }

  updateCategory(id, displayName, botToken, chatId, aiPrompt, deliveryChannel = 'telegram', whatsappDeliveryJid = null) {
    this.statements.updateCategory.run(displayName, botToken, chatId, aiPrompt, deliveryChannel, whatsappDeliveryJid, id);
  }

  toggleCategory(id, isActive) { this.statements.toggleCategory.run(isActive ? 1 : 0, id); }
  deleteCategory(id) { this.statements.deleteCategory.run(id); }

  getAllScheduleRules() { return this.statements.getAllScheduleRules.all(); }
  getScheduleRulesByCategory(slug) { return this.statements.getScheduleRulesByCategory.all(slug); }

  insertScheduleRule(categorySlug, cronExpression, label) {
    return this.statements.insertScheduleRule.run(categorySlug, cronExpression, label);
  }

  updateScheduleRule(id, cronExpression, label, isActive) {
    this.statements.updateScheduleRule.run(cronExpression, label, isActive ? 1 : 0, id);
  }

  deleteScheduleRule(id) { this.statements.deleteScheduleRule.run(id); }
  deleteScheduleRulesByCategory(slug) { this.statements.deleteScheduleRulesByCategory.run(slug); }

  seedDefaultSchedules() {
    const existing = this.getAllScheduleRules();
    if (existing.length > 0) return;

    const defaults = [
      { slug: 'cc',    cron: '0 6 * * *',  label: '6 AM Brief'  },
      { slug: 'cc',    cron: '0 14 * * *', label: '2 PM Brief'  },
      { slug: 'cc',    cron: '0 22 * * *', label: '10 PM Brief' },
      { slug: 'deals', cron: '0 6 * * *',  label: '6 AM Brief'  },
      { slug: 'deals', cron: '0 14 * * *', label: '2 PM Brief'  },
      { slug: 'deals', cron: '0 22 * * *', label: '10 PM Brief' },
    ];

    for (const d of defaults) {
      try { this.insertScheduleRule(d.slug, d.cron, d.label); } catch (e) { /* ignore */ }
    }
    logger.info('📅 Seeded default schedule rules for cc and deals categories.');
  }

  getWhatsAppTargets(categorySlug) {
    return this.getAllSources().filter(s => 
      s.type === `${categorySlug}-whatsapp` && s.is_active === 1
    );
  }

  saveCookies(site, cookiesArray) {
    try { this.statements.saveCookies.run(site, JSON.stringify(cookiesArray)); }
    catch (err) { logger.error(`Failed to save cookies for ${site} in DB: ${err.message}`); }
  }

  getCookies(site) {
    try {
      const row = this.statements.getCookies.get(site);
      return row ? JSON.parse(row.cookies_json) : null;
    } catch (err) {
      logger.error(`Failed to get cookies for ${site}: ${err.message}`);
      return null;
    }
  }

  getAllCookieSites() {
    try { return this.statements.getAllCookieSites.all(); }
    catch (err) { return []; }
  }

  upsertScraperHealth(sourceId, sourceType, success, errorMsg = null) {
    const now = new Date().toISOString();
    try {
      const existing = this.db.prepare('SELECT error_count FROM scraper_health WHERE source_id = ?').get(sourceId);
      const errCount = success ? 0 : (existing ? existing.error_count + 1 : 1);
      this.statements.upsertScraperHealth.run(
        sourceId, sourceType,
        success ? now : (existing?.last_success || null),
        now, errCount, errorMsg
      );
    } catch (err) {
      logger.warn(`Could not update scraper health for ${sourceId}: ${err.message}`);
    }
  }

  getScraperHealth() {
    try { return this.statements.getScraperHealth.all(); }
    catch (err) { return []; }
  }

  close() {
    this.db.close();
    logger.info('Database connection closed.');
  }
}

module.exports = DatabaseManager;
