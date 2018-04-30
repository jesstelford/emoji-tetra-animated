const ora = require('ora');
const path = require('path');
const Twit = require('twit');
const cuid = require('cuid');
const delay = require('delay');
const firebase = require('firebase-admin');

const scrape = require('./scrape');
const generateGif = require('./generate-gif');
const firebaseKey = require('../firebase-emojitetragif-admin.json');

const EMJOI_TETRA_TWITTER_ID = '842095599100997636';
const UNIQUE_INSTANCE_ID = process.env.NOW ? `${process.env.NOW_URL}-${cuid()}` : 'test';

const words = [
  'Progress so far',
  'Keep at it, friends!',
  'Progress is being made',
  'Hmm, I wonder how many rocketships we can get? 🤔🚀',
  'Up up down down left right left right b a',
  "Oh, we're so close!",
  'I can feel some points coming on!',
  'What a game so far!',
  'This is nailbiting',
  'Hand-drawing all those emojis must take _forever_!',
  'Ah, strategy at its finest',
  'The wisdom of the crowd',
  "Who'd have thought MMO Twitter games were so much fun!?",
  'Eeek, watch out for that next one',
  'Maybe we should put our heads together on this one?',
  "Awww, they're all so cute!",
  'tetra /ˈtɛtrə/ (noun): a small tropical freshwater fish that is typically brightly coloured. Native to Africa and America, many tetras are popular in aquaria.',
  "Don't tell @RikerGoogling about this one!",
  'Starting to see a pattern here',
  "We've got this!",
  'What a team!',
];

console.log({ UNIQUE_INSTANCE_ID });

const spinner = ora();

const twitter = new Twit({
  consumer_key: process.env.TWITTER_CONSUMER_KEY,
  consumer_secret: process.env.TWITTER_CONSUMER_SECRET,
  access_token: process.env.TWITTER_ACCESS_TOKEN,
  access_token_secret: process.env.TWITTER_ACCESS_TOKEN_SECRET,
  timeout_ms: 60 * 1000, // optional HTTP request timeout to apply to all requests.
});

firebase.initializeApp({
  credential: firebase.credential.cert(firebaseKey),
  databaseURL: 'https://emojitetragif.firebaseio.com',
});

const database = firebase.database();
const lastHandledIdDbRef = database.ref(`bot/${UNIQUE_INSTANCE_ID}/lastHandledId`);

(async function () {
  // Loop forever
  for await (const result of continuousGifGenerator()) {
    // with 60s gap between runs
    await delay(60000);
  }
}());

// async generator to avoid recursion stack overflow
async function* continuousGifGenerator() {
  while (true) {
    yield await generateLatestGif();
  }
}

function generateLatestGif() {
  spinner.start(`Getting last handled ID for instance ${UNIQUE_INSTANCE_ID}`);

  return new Promise((resolve) => {
    // Retreive the last handled ID
    lastHandledIdDbRef.once('value', async (value) => {
      const lastHandledId = value.val();

      spinner.succeed(`Got last handled ID (${lastHandledId})`);

      if (!lastHandledId) {
        spinner.info('Unknown last handled ID, will scrape all within thread');
      }

      const latestTweets = await getLatestTweet(twitter, EMJOI_TETRA_TWITTER_ID, lastHandledId);

      if (!latestTweets) {
        spinner.info('Nothing to do, no new tweets found');
        resolve();
        return;
      }

      const { id_str } = latestTweets;

      if (!id_str) {
        throw new Error(`Unable to get latest tweet since ${lastHandledId}`);
      }

      await scrape({
        firstTweetId: id_str,
        lastTweetId: lastHandledId,
        direction: 'backward',
        spinner,
      });

      await generateGif(spinner);

      await tweetGif(twitter, 'anim.gif', id_str, spinner);

      spinner.start(`Updating lastHandleId to ${id_str} for instance ${UNIQUE_INSTANCE_ID}`);

      await lastHandledIdDbRef.transaction(() => id_str);

      spinner.succeed(`Updated lastHandleId to ${id_str} for instance ${UNIQUE_INSTANCE_ID}`);

      resolve();
    });
  });
}

function getLatestTweet(twitter, userId, sinceId) {
  spinner.start(`Fetching lastest tweets for @${userId} since ${sinceId}`);

  let errHandled = false;

  const opts = {
    user_id: userId,
    trim_user: true,
    include_rts: false,
    count: 100,
  };

  if (sinceId) {
    opts.since_id = sinceId;
  }

  // Grab all the tweets by the EmojiTetra user
  return twitter
    .get('statuses/user_timeline', opts)
    .catch((err) => {
      spinner.fail(`Failed to fetch tweets for @${userId}`);
      errHandled = true;
      throw err;
    })
    .then(({ data }) => {
      spinner
        .succeed(`Fetched @${userId}'s ${data.length} latest tweets`)
        .start('Fetching replies');

      // Just get the latest one
      return data[0];
    });
}

function postMediaToTwitter(twitter, filePath) {
  return new Promise((resolve, reject) => {
    twitter.postMediaChunked({ file_path: filePath }, (error, data) => {
      if (error) {
        return reject(error);
      }
      return resolve(data);
    });
  });
}

function getRandomInt(max) {
  return Math.floor(Math.random() * Math.floor(max));
}

function tweetGif(twitter, file, replyToId, spinner) {
  spinner.start('Uploading gif to Twitter');

  let errHandled = false;
  const filePath = path.join(process.cwd(), file);

  let mediaIdStr;

  // first we must post the media to Twitter
  return postMediaToTwitter(twitter, filePath)
    .catch((err) => {
      spinner.fail('Failed to upload to Twitter');
      errHandled = true;
      throw err;
    })
    .then((data) => {
      spinner.succeed('Uploaded to Twitter').start('Adding metadata to Twitter upload');

      // now we can assign alt text to the media, for use by screen readers and
      // other text-based presentations and interpreters
      mediaIdStr = data.media_id_string;
      const altText = 'Animation of @EmojiTetra progress so far';
      const meta_params = { media_id: mediaIdStr, alt_text: { text: altText } };

      return twitter.post('media/metadata/create', meta_params);
    })
    .catch((err) => {
      if (!errHandled) {
        spinner.fail('Failed to upload to Twitter');
        spinner.fail('Failed to add meta data to Twitter upload');
        errHandled = true;
      }
      throw err;
    })
    .then(({ data }) => {
      spinner.succeed('Meta data added to Twitter upload').start('Tweeting');

      // now we can reference the media and post a tweet (media will attach to the tweet)
      const params = {
        status: words[getRandomInt(words.length)],
        media_ids: [mediaIdStr],
        in_reply_to_status_id: replyToId,
        auto_populate_reply_metadata: true,
      };

      return twitter.post('statuses/update', params);
    })
    .catch((err) => {
      if (!errHandled) {
        spinner.fail('Failed to upload to Twitter');
        errHandled = true;
      }
      throw err;
    })
    .then(({ data }) => {
      spinner.succeed(
        `Tweeted: https://twitter.com/${data.user.screen_name}/status/${data.id_str}`,
      );
      return data;
    });
}
