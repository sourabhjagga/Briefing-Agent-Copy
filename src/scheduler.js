/**
 * Scheduler Module
 * Runs scheduled briefings at 6:00 AM, 2:00 PM, and 10:00 PM IST (Asia/Kolkata timezone).
 * Dynamically iterates over ALL active categories from the database,
 * staggering each category's brief by 30 seconds to avoid AI API quota conflicts.
 */

const cron = require('node-cron');
const logger = require('./logger');

class Scheduler {
  constructor(summarizer, botInstances, database) {
    this.summarizer = summarizer;
    this.botInstances = botInstances; // Map<slug, TelegramBotDispatcher>
    this.database = database;
    this.jobs = [];
  }

  start() {
    const schedules = [
      { time: '0 6 * * *', label: 'Morning' },
      { time: '0 14 * * *', label: 'Mid-day' },
      { time: '0 22 * * *', label: 'Nightly' }
    ];

    schedules.forEach(s => {
      const job = cron.schedule(s.time, async () => {
        logger.info(`📅 Scheduled ${s.label} briefing job triggered.`);
        await this._runAllCategoryBriefs();
      }, {
        timezone: 'Asia/Kolkata',
      });
      
      this.jobs.push(job);
    });

    logger.info('📅 Briefing schedules armed: 6:00 AM, 2:00 PM, and 10:00 PM IST.');

    // Schedule daily database cleanup at 3:00 AM IST to purge messages older than 30 days
    const cleanupJob = cron.schedule('0 3 * * *', () => {
      logger.info('🧹 Running daily SQLite database cleanup...');
      this.database.cleanup();
    }, {
      timezone: 'Asia/Kolkata',
    });
    this.jobs.push(cleanupJob);
  }

  /**
   * Iterates over all active categories from the DB and runs a briefing for each.
   * Staggered by 30 seconds between categories to avoid concurrent API quota collisions.
   */
  async _runAllCategoryBriefs() {
    const categories = this.database.getActiveCategories();
    logger.info(`📂 Running briefs for ${categories.length} active categories...`);

    for (let i = 0; i < categories.length; i++) {
      const cat = categories[i];
      const botInstance = this.botInstances.get(cat.slug);

      if (!botInstance) {
        logger.warn(`⚠️ No bot instance found for category "${cat.slug}". Skipping.`);
        continue;
      }

      if (i > 0) {
        logger.info(`⏳ Staggering "${cat.display_name}" briefing by 30 seconds...`);
        await new Promise(r => setTimeout(r, 30000));
      }

      await this._runSummaryJob(cat.slug, botInstance, cat.ai_prompt);
    }
  }

  async _runSummaryJob(sourcePrefix, telegramInstance, customPrompt = undefined) {
    logger.info(`=== STARTING ${sourcePrefix.toUpperCase()} BRIEFING GENERATION ===`);
    const today = new Date().toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata' });

    try {
      const messages = this.database.getTodayMessages(sourcePrefix);
      logger.info(`[${sourcePrefix}] Found ${messages.length} messages for today's brief.`);

      if (messages.length === 0) {
        logger.info(`[${sourcePrefix}] Skipping brief because 0 messages were captured today.`);
        await telegramInstance.sendMessage(`🤷‍♂️ <b>No updates today!</b>\n\nThere were no messages captured from your monitored ${sourcePrefix.toUpperCase()} sources today.`);
        return;
      }

      const groups = this.database.getTodayActiveGroups(sourcePrefix);
      logger.info(`[${sourcePrefix}] Active groups: ${groups.map(g => `${g.group_name}(${g.count})`).join(', ')}`);

      const summary = await this.summarizer.generateSummary(messages, customPrompt);

      let finalSummary = summary;
      if (sourcePrefix === 'cc') {
        finalSummary += "\n\n<i>This brief is from the new clean application.</i>";
      }

      const sent = await telegramInstance.sendMessage(finalSummary);

      // Save summary and brief logs to SQLite for history retrieval
      if (sourcePrefix === 'cc') {
        this.database.saveSummary(today, messages.length, finalSummary, sent);
        this.database.saveBrief(today, finalSummary, messages.length);
      }

      logger.info(`=== ${sourcePrefix.toUpperCase()} BRIEFING COMPLETED ===`);
    } catch (error) {
      logger.error(`[${sourcePrefix}] Briefing generation failed: ${error.message}`);
      try {
        await telegramInstance.sendMessage(
          `⚠️ <b>Briefing Error</b>\n\nFailed to generate today's ${sourcePrefix.toUpperCase()} summary.\nError: ${error.message}`
        );
      } catch (e) {
        logger.error(`Could not dispatch error notification: ${e.message}`);
      }
    }
  }

  async triggerNow() {
    logger.info('⚡ Manual summary trigger requested across all profiles.');
    await this._runAllCategoryBriefs();
  }

  /**
   * Update bot instances map at runtime (e.g., when a category is added/removed via dashboard).
   */
  updateBotInstances(newBotInstances) {
    this.botInstances = newBotInstances;
    logger.info(`🔄 Scheduler bot instances updated. Active: ${Array.from(this.botInstances.keys()).join(', ')}`);
  }

  stop() {
    logger.info('Stopping all scheduler cron jobs...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
    logger.info('Scheduler successfully stopped.');
  }
}

module.exports = Scheduler;
