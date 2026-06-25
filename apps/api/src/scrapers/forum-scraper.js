/**
 * Technofino Forum Scraper (Puppeteer Stealth Headless Upgrade)
 * 
 * FAILPROOF BROWSER-BASED EXTRACTION:
 * - Solves XenForo Cloudflare challenges natively in the background.
 * - Restores imported login cookies seamlessly inside the browser context.
 * - Synchronizes active browser cookies back to the SQLite DB to maintain active session health.
 * - Judges session health by VIP Lounge thread count (0 threads = session expired).
 */

const cheerio = require('cheerio');
const axios = require('axios');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const browserManager = require('../browser-manager');

class ForumScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/technofino_cookies.json');
    this.checkInterval = 45 * 60 * 1000; // 45 minutes
    
    this.isSessionAlerted = false;
    this.consecutiveVipFailures = 0; // Track consecutive VIP Lounge 0-thread scrapes
  }

  async start() {
    logger.info('🌐 Technofino forum Puppeteer scraper initialized (scrapes every 45 min)...');
    try {
      await this.scrape();
      this.intervalId = setInterval(() => this.scrape(), this.checkInterval);
    } catch (err) {
      logger.error(`Forum scraper startup failed: ${err.message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async scrape() {
    logger.info('🔄 Starting Technofino HTTP scrape session via Headless Browser...');

    // Load targets from database — no more hardcoded source URLs
    const targets = this.database.getAllSources()
      .filter(s => s.is_active && s.type.endsWith('-forum') && s.url)
      .map(s => ({ name: s.name, url: s.url, isPrivate: !!s.is_private }));

    if (targets.length === 0) {
      logger.warn('⚠️ No active forum sources with URLs found in database.');
      return;
    }

    let page = null;
    try {
      // 1. Open new tab inside the shared browser instance
      page = await browserManager.newPage();

      // 2. Set authenticated cookies inside browser session if available
      await this._injectCookies(page);

      for (const target of targets) {
        await this._scrapeTarget(page, target);
        // Stagger requests between 3 and 7 seconds
        const delay = Math.floor(Math.random() * 4000) + 3000;
        await new Promise(r => setTimeout(r, delay));
      }

      // 3. Sync cookies from browser back to database to maintain Cloudflare and session tokens
      const currentCookies = await page.cookies();
      this._saveUpdatedCookies(currentCookies);

    } catch (err) {
      logger.error(`Technofino scrape run failed: ${err.message}`);
    } finally {
      if (page) {
        try {
          await page.close();
        } catch (e) {
          logger.debug(`Error closing page: ${e.message}`);
        }
      }
    }
  }

  async _scrapeTarget(page, target) {
    logger.debug(`Scraping Technofino target: "${target.name}"`);
    try {
      // Navigate browser to target URL
      await page.goto(target.url, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Stagger and wait for tables to load
      try {
        await page.waitForSelector('.structItem--thread, .structItem--post', { timeout: 15000 });
      } catch (e) {
        logger.debug(`Timeout waiting for structItem selector on "${target.name}". Processing raw DOM...`);
      }

      const html = await page.content();
      const $ = cheerio.load(html);
      const items = [];

      $('.structItem--thread, .structItem--post').each((i, el) => {
        const row = $(el);
        const titleEl = row.find('.structItem-title a').last();
        const authorEl = row.find('.structItem-startDate a, .username').first();
        const dateEl = row.find('.structItem-startDate time, time[datetime]').first();
        
        let link = titleEl.attr('href') || '';
        if (link && !link.startsWith('http')) {
          link = 'https://technofino.in' + link;
        }

        const idMatch = link.match(/\.(\d+)\/?$/);
        const uniqueId = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);

        if (titleEl.length > 0) {
          items.push({
            id: `forum_${uniqueId}`,
            title: titleEl.text().trim(),
            author: authorEl.length > 0 ? authorEl.text().trim() : 'Forum User',
            link: link,
            datetime: dateEl.attr('datetime') || null
          });
        }
      });

      if (items.length === 0) {
        logger.warn(`⚠️ Found 0 threads in Technofino: "${target.name}" via DOM — attempting RSS fallback.`);
        try {
          const rssUrl = target.url.endsWith('/') ? `${target.url}index.rss` : `${target.url}/index.rss`;
          
          let cookieString = '';
          const cookiesArray = this.database.getCookies('technofino');
          if (cookiesArray && Array.isArray(cookiesArray)) {
            cookieString = cookiesArray.map(c => `${c.name}=${c.value}`).join('; ');
          }

          const response = await axios.get(rssUrl, {
            headers: {
              'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
              'Cookie': cookieString
            },
            timeout: 10000
          });

          const $rss = cheerio.load(response.data, { xmlMode: true });
          $rss('item').each((i, el) => {
            const item = $rss(el);
            const title = item.children('title').text();
            let link = item.children('link').text();
            const author = item.children('dc\\:creator').text() || 'Forum User';
            const pubDate = item.children('pubDate').text();

            if (link && !link.startsWith('http')) link = 'https://technofino.in' + link;
            const idMatch = link.match(/\.(\d+)\/?$/);
            const uniqueId = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);

            items.push({
              id: `forum_${uniqueId}`,
              title: title.trim(),
              author: author.trim(),
              link: link,
              datetime: pubDate
            });
          });
          logger.info(`✅ RSS Fallback succeeded. Found ${items.length} threads in "${target.name}".`);
        } catch (rssErr) {
          logger.error(`❌ RSS Fallback failed for "${target.name}": ${rssErr.message}`);
        }
      } else {
        logger.info(`✅ Found ${items.length} threads in Technofino: "${target.name}"`);
      }

      // Judge session health by VIP Lounge results
      if (target.isPrivate) {
        if (items.length > 0) {
          this.consecutiveVipFailures = 0;
          this.isSessionAlerted = false;
          logger.info('🔓 VIP Lounge access confirmed — session is authenticated!');
        } else {
          this.consecutiveVipFailures++;
          logger.warn(`⚠️  VIP Lounge returned 0 threads (consecutive failures: ${this.consecutiveVipFailures}).`);
          
          // Alert after 2 consecutive failures (90 min)
          if (this.consecutiveVipFailures >= 2 && !this.isSessionAlerted && this.onAlert) {
            this.onAlert(
              '⚠️ <b>Technofino VIP Lounge Access Lost</b>\n\nThe VIP Credit Card Lounge has returned 0 threads for 2 consecutive scrapes, indicating your session has expired. Please login to Technofino in your browser, export fresh cookies via EditThisCookie, and paste them into the Web Dashboard.'
            );
            this.isSessionAlerted = true;
          }
        }
      }

      for (const item of items) {
        const timestamp = Math.floor(Date.now() / 1000);
        this.database.saveMessage({
          messageId: item.id,
          groupName: target.name,
          groupId: 'forum_technofino',
          chatType: 'forum',
          senderName: item.author,
          senderNumber: '',
          body: `${item.title}\nSource: ${item.link}`,
          timestamp,
          hasMedia: false,
          mediaCaption: '',
          isForwarded: false,
          sourceType: 'cc-forum'
        });
      }
    } catch (err) {
      logger.error(`Failed to scrape Technofino target "${target.name}": ${err.message}`);
    }
  }

  async _injectCookies(page) {
    let cookiesArray = this.database.getCookies('technofino');
    if (!cookiesArray && fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        cookiesArray = JSON.parse(raw);
        this.database.saveCookies('technofino', cookiesArray);
      } catch (err) {
        logger.error(`Failed to load cookies file: ${err.message}`);
      }
    }

    if (cookiesArray && Array.isArray(cookiesArray) && cookiesArray.length > 0) {
      logger.debug(`Injecting ${cookiesArray.length} cookies into browser tab for Technofino...`);
      const sanitized = cookiesArray.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path: c.path || '/'
      }));
      await page.setCookie(...sanitized);
    }
  }

  _saveUpdatedCookies(newCookies) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = this.database.getCookies('technofino') || [];
      const essentialKeys = ['xf_user', 'xf_session', 'xf_csrf', 'xf_notice_dismiss'];

      const mergedMap = {};
      originalCookies.forEach(c => { mergedMap[c.name] = c; });

      newCookies.forEach(c => {
        // Essential session cookies from manual import are preserved unless updated with authentic values
        if (essentialKeys.includes(c.name) && mergedMap[c.name] && !c.value) {
          return;
        }
        mergedMap[c.name] = c;
      });

      const mergedCookies = Object.values(mergedMap);
      this.database.saveCookies('technofino', mergedCookies);
    } catch (e) {
      logger.debug(`Failed to save updated cookies: ${e.message}`);
    }
  }
}

module.exports = ForumScraper;
