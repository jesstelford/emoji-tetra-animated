const ora = require('ora');
const path = require('path');
const puppeteer = require('puppeteer');
const promiseRetry = require('promise-retry');
const debug = require('debug')('tetra');

const generateGif = require('./generate-gif');

const timeout = 1000;
const iv = 100;

const waitForNavigationAndContext = (page, maxTimeout = 120000) =>
  promiseRetry(
    async (retry, number) => {
      try {
        await page.evaluate(
          iv =>
            new Promise((resolve, reject) => {
              checkReadyState();

              function checkReadyState() {
                if (document.readyState === 'complete') {
                  resolve();
                } else {
                  setTimeout(checkReadyState, iv);
                }
              }
            }),
          iv,
        );
      } catch (err) {
        if (err.message.indexOf('Cannot find context with specified id undefined') !== -1) {
          retry();
        } else {
          throw err;
        }
      }
    },
    { retries: Math.ceil(maxTimeout / timeout), minTimeout: timeout, maxTimeout: timeout },
  );

const nextTweetInThread = async (page, author) =>
  await page.evaluate((selector) => {
    const element = document.querySelector(selector);
    if (!element) {
      return null;
    }
    return element.dataset.tweetId;
  }, `.permalink-replies.replies-to [data-tweet-id]${author ? `[data-screen-name="${author}"]` : ''}`);

/**
 * Takes a screenshot of a DOM element on the page, with optional padding.
 */
async function screenshotDOMElement(page, opts = {}) {
  const padding = 'padding' in opts ? opts.padding : 0;
  const outPath = 'outPath' in opts ? opts.outPath : null;
  const selector = opts.selector;

  if (!selector) {
    throw new Error('Please provide a selector.');
  }

  debug('Getting element for selector %s', selector);
  const element = await page.$(selector);

  debug('Taking screenshot of element %s, and saving to %s', selector, outPath);
  return await element.screenshot({
    path: outPath,
  });
}

const screenshotTweet = async (page, outDir, tweetId, author) => {
  const screenshotPath = path.join(outDir, `tweet_${tweetId}.png`);
  const URL = `https://twitter.com/i/web/status/${tweetId}`;
  debug('going to %s', URL);
  await page.goto(URL, { waitUntil: 'networkidle2' });
  await waitForNavigationAndContext(page, 60000);
  debug('%s loaded', URL);

  debug('cleaning up DOM');

  const tweetSelector = `[data-tweet-id="${tweetId}"]`;

  const redirectToTweetId = await page.evaluate((selector) => {
    if (
      document
        .querySelector(`${selector} .tweet-text`)
        .innerText.indexOf('Game continues in new thread') === -1
    ) {
      return null;
    }

    const quoteWrapper = document.querySelector(`${selector} .QuoteTweet [data-item-id]`);
    if (!quoteWrapper) {
      throw new Error(`Thought element ${selector} was a quote, but its not :/`);
    }

    return quoteWrapper.dataset.itemId;
  }, tweetSelector);

  if (redirectToTweetId) {
    debug('Redirecting from %s to %s', tweetId, redirectToTweetId);
    return screenshotTweet(page, outDir, redirectToTweetId, author);
  }

  await page.evaluate(
    (selector, tweetId) => {
      const tweetElement = document.querySelector(selector);
      if (!tweetElement) {
        return;
      }
      [
        tweetElement.querySelector('.tweet-details-fixer'),
        tweetElement.querySelector('.stream-item-footer'),
        tweetElement.querySelector('.content .follow-bar'),
        tweetElement.querySelector('.content .ProfileTweet-action'),
      ]
        .filter(Boolean)
        .forEach(element => element.remove());

      const styleNode = document.createElement('style');
      styleNode.innerHTML = `
      .permalink-tweet-container::before, .permalink-tweet-container::after { visibility: hidden; }
      .permalink .permalink-tweet { padding-top: 11px !important; padding-bottom: 30px !important; height: 510px !important; width: 310px !important; }
      ${selector}:after {
        content: 'twitter.com/EmojiTetra/status/${tweetId}';
        position: absolute;
        right: 10px;
        bottom: 3px;
        font-size: smaller;
        opacity: 0.1;
      }
    `;
      document.body.appendChild(styleNode);
    },
    tweetSelector,
    tweetId,
  );

  debug('DOM cleaned');

  await screenshotDOMElement(page, {
    outPath: screenshotPath,
    selector: `[data-tweet-id="${tweetId}"]`,
    padding: 0,
  });

  debug('screenshot captured to %s', screenshotPath);

  const nextTweetId = await nextTweetInThread(page, author);

  debug('nextTweetId %s', nextTweetId);

  return {
    nextTweetId,
    screenshotPath,
  };
};

async function* screenshotTwitterThread(page, outDir, startId, author, limit = Infinity) {
  let count = 0;
  let currentId = startId;
  let result;
  while (currentId && count < limit) {
    const { nextTweetId, screenshotPath } = await screenshotTweet(page, outDir, currentId, author);
    result = {
      nextTweetId,
      tweetId: currentId,
      screenshotPath,
    };
    debug('yielding with %o', result);
    yield result;
    count++;
    currentId = nextTweetId;
  }
  debug('no nextTweetId');
}

function cliTextForTweet(tweetId) {
  return `Taking screenshot of tweet ${tweetId}`;
}

try {
  (async () => {
    const spinner = ora('Setting up Headless Chrome').start();

    const browser = await puppeteer.launch();
    const page = await browser.newPage();

    // Adjustments particular to this page to ensure we hit desktop breakpoint.
    page.setViewport({ width: 1000, height: 1200, deviceScaleFactor: 1 });

    const firstTweetId = process.argv[2]; // eg; 989912736971636736

    if (!firstTweetId) {
      throw new Error('Must provide a tweet ID to get started: node index.js <tweetId>');
    }

    spinner.succeed().start(cliTextForTweet(firstTweetId));

    for await (const screenshotInfo of screenshotTwitterThread(
      page,
      'screens',
      firstTweetId,
      'EmojiTetra',
    )) {
      spinner.succeed(`Saved screenshot for tweet ${screenshotInfo.tweetId}`);
      if (screenshotInfo.nextTweetId) {
        spinner.start(cliTextForTweet(screenshotInfo.nextTweetId));
      }
    }

    spinner.succeed('All screenshots taken').start('Cleaning up');

    browser.close();

    spinner.succeed('Done!');

    generateGif();
  })();
} catch (error) {
  throw error;
}
