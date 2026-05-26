/**
 * Reddit Scraper (Puppeteer Stealth Headless Upgrade)
 * 
 * FAILPROOF THREE-LAYER EXTRACTION:
 * - Layer 1: Public Reddit JSON API (highly efficient, zero-overhead).
 * - Layer 2: Headless Puppeteer Stealth (bypasses cloud datacenter IP blocks, supports cookies).
 * - Layer 3: RSS feed to JSON fallback (immune to basic scraper triggers).
 */

const axios = require('axios');
const cheerio = require('cheerio');
const fs = require('fs');
const path = require('path');
const logger = require('../logger');
const browserManager = require('../browser-manager');

class RedditScraper {
  constructor(database, onAlert) {
    this.database = database;
    this.onAlert = onAlert;
    this.cookiePath = path.resolve(__dirname, '../../data/reddit_cookies.json');
    this.checkInterval = 15 * 60 * 1000; // 15 minutes
    this.isSessionAlerted = false;
  }

  async start() {
    logger.info('🚀 Reddit Scraper stack initialized (scrapes subreddits every 15 min)...');
    try {
      await this.scrape();
      this.intervalId = setInterval(() => this.scrape(), this.checkInterval);
    } catch (err) {
      logger.error(`Reddit Scraper startup failed: ${err.message}`);
    }
  }

  stop() {
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
  }

  async scrape() {
    const allSources = this.database.getAllSources();
    const activeReddit = allSources.filter(s => s.is_active === 1 && (s.type === 'cc-reddit' || s.type === 'deals-reddit'));
    if (activeReddit.length === 0) return;

    logger.info(`🔍 Starting Reddit scrape session for ${activeReddit.length} subreddits...`);

    for (const source of activeReddit) {
      const sub = this._cleanRedditId(source.source_id);
      if (!sub) continue;

      let success = await this._scrapeViaJSON(sub, source.type, source.name);
      
      if (!success) {
        success = await this._scrapeViaCookies(sub, source.type, source.name);
      }
      
      if (!success) {
        success = await this._scrapeViaRSS(sub, source.type, source.name);
      }

      if (!success) {
        logger.error(`❌ All Reddit ingestion layers failed for r/${sub}`);
      }

      // Random delay between 3 and 7 seconds
      const delay = Math.floor(Math.random() * 4000) + 3000;
      await new Promise(r => setTimeout(r, delay));
    }
  }

  // --- LAYER 1: Reddit Public JSON API ---
  async _scrapeViaJSON(sub, sourceType, sourceName) {
    logger.debug(`Reddit Layer 1: Attempting public JSON API for r/${sub}`);
    try {
      const res = await axios.get(`https://www.reddit.com/r/${sub}/new.json?limit=15`, {
        headers: {
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1 cc-brief-agent-v1',
          'Accept': 'application/json'
        },
        timeout: 15000
      });

      if (res.data && res.data.data && res.data.data.children) {
        const posts = res.data.data.children.map(child => child.data);
        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 1: Ingested ${posts.length} posts from r/${sub}`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 1 failed for r/${sub}: ${err.message}`);
      return false;
    }
  }

  // --- LAYER 2: Reddit Authenticated Puppeteer Scrape ---
  async _scrapeViaCookies(sub, sourceType, sourceName) {
    let cookiesArray = this.database.getCookies('reddit');
    if (!cookiesArray && fs.existsSync(this.cookiePath)) {
      try {
        const raw = fs.readFileSync(this.cookiePath, 'utf8');
        cookiesArray = JSON.parse(raw);
        this.database.saveCookies('reddit', cookiesArray);
      } catch (err) {
        logger.error(`Failed to load Reddit cookies file: ${err.message}`);
      }
    }

    if (!cookiesArray || cookiesArray.length === 0) {
      logger.debug('Reddit Layer 2: Skipping, no session cookies active.');
      return false;
    }

    logger.debug(`Reddit Layer 2: Attempting authenticated Puppeteer scraper for r/${sub}`);
    let page = null;
    try {
      page = await browserManager.newPage();

      // Inject cookies from DB
      const sanitized = cookiesArray.map(c => ({
        name: c.name,
        value: c.value,
        domain: c.domain.startsWith('.') ? c.domain : `.${c.domain}`,
        path: c.path || '/'
      }));
      await page.setCookie(...sanitized);

      const targetUrl = `https://www.reddit.com/r/${sub}/new/`;
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 45000 });

      // Stagger and wait for shreddit-posts to settle
      try {
        await page.waitForSelector('shreddit-post, article, [data-testid="post-container"]', { timeout: 15000 });
      } catch (e) {
        logger.debug(`Timeout waiting for Reddit selectors on r/${sub}.`);
      }

      // Sync updated cookies back to database
      const currentCookies = await page.cookies();
      this._saveUpdatedCookies(currentCookies);

      const html = await page.content();
      const $ = cheerio.load(html);
      const posts = [];

      // Parse Reddit's modern custom shreddit-post elements
      $('shreddit-post, article, [data-testid="post-container"]').each((i, el) => {
        if (i >= 15) return;
        const art = $(el);
        const title = art.attr('post-title') || art.find('h1, h2, h3, a[href*="/comments/"]').first().text().trim();
        const permalink = art.attr('permalink') || art.find('a[href*="/comments/"]').first().attr('href') || '';
        const author = art.attr('author') || 'Reddit User';
        const id = art.attr('id') ? art.attr('id').replace('t3_', '') : Math.random().toString(36).slice(2);
        const text = art.find('[slot="text-body"], .feed-card-text, [data-click-id="text_body"]').first().text().trim();

        if (title) {
          posts.push({
            id,
            title,
            selftext: text,
            permalink,
            author
          });
        }
      });

      if (posts.length > 0) {
        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 2: Ingested ${posts.length} posts from r/${sub} via Puppeteer`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 2 failed for r/${sub}: ${err.message}`);
      return false;
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

  // --- LAYER 3: Public RSS to JSON Fallback ---
  async _scrapeViaRSS(sub, sourceType, sourceName) {
    logger.debug(`Reddit Layer 3: Attempting RSS-to-JSON fallback for r/${sub}`);
    try {
      const res = await axios.get(
        `https://api.rss2json.com/v1/api.json?rss_url=https://www.reddit.com/r/${sub}/new/.rss`,
        {
          headers: { 'User-Agent': 'Mozilla/5.0' },
          timeout: 15000
        }
      );

      if (res.data && res.data.status === 'ok') {
        const items = res.data.items || [];
        const posts = items.map(item => {
          const guid = item.guid || item.link || '';
          const idMatch = guid.match(/\/comments\/([a-z0-9]+)\//i);
          const id = idMatch ? idMatch[1] : Math.random().toString(36).slice(2);
          
          let content = item.content || '';
          content = content.replace(/<[^>]*>/g, '').trim(); // Strip HTML tags

          return {
            id,
            title: item.title,
            selftext: content,
            permalink: item.link.replace('https://www.reddit.com', ''),
            author: item.author || 'Reddit User'
          };
        });

        await this._saveRedditPosts(posts, sub, sourceType, sourceName);
        logger.info(`✅ Reddit Layer 3: Ingested ${posts.length} posts from r/${sub} via RSS`);
        return true;
      }
      return false;
    } catch (err) {
      logger.debug(`Reddit Layer 3 failed for r/${sub}: ${err.message}`);
      return false;
    }
  }

  _saveUpdatedCookies(newCookies) {
    if (!newCookies || !Array.isArray(newCookies)) return;
    try {
      const originalCookies = this.database.getCookies('reddit') || [];
      const essentialKeys = ['reddit_session', 'token', 'session_tracker', 'loid', 'edgebucket'];

      const mergedMap = {};
      originalCookies.forEach(c => { mergedMap[c.name] = c; });

      newCookies.forEach(c => {
        if (essentialKeys.includes(c.name) && mergedMap[c.name] && !c.value) {
          return;
        }
        mergedMap[c.name] = c;
      });

      const mergedCookies = Object.values(mergedMap);
      this.database.saveCookies('reddit', mergedCookies);
    } catch (e) {
      logger.debug(`Failed to save updated cookies: ${e.message}`);
    }
  }

  async _saveRedditPosts(posts, sub, sourceType, sourceName) {
    for (const post of posts) {
      const id = post.id || Math.random().toString(36).slice(2);
      const title = post.title || '';
      const text = post.selftext || post.text || '';
      const author = post.author || 'Reddit User';
      let link = post.permalink || post.url || '';
      
      if (link && !link.startsWith('http')) {
        link = 'https://www.reddit.com' + link;
      }

      this.database.saveMessage({
        messageId: `reddit_${id}`,
        groupName: `r/${sub}`,
        groupId: `reddit_${sub}`,
        chatType: 'forum',
        senderName: author,
        senderNumber: '',
        body: `${title}\n\n${text}\nSource: ${link}`,
        timestamp: Math.floor(Date.now() / 1000),
        hasMedia: false,
        mediaCaption: '',
        isForwarded: false,
        sourceType: sourceType
      });
    }
  }

  _cleanRedditId(str) {
    if (!str) return null;
    let clean = str.trim();
    if (clean.includes('reddit.com/r/')) {
      clean = clean.split('reddit.com/r/').pop();
    }
    if (clean.startsWith('r/')) {
      clean = clean.replace('r/', '');
    }
    return clean.split('/')[0].split('?')[0];
  }
}

module.exports = RedditScraper;
