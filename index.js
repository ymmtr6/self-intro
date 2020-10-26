// `cp _env .env` then modify it
// See https://github.com/motdotla/dotenv
const config = require("dotenv").config().parsed;
// Overwrite env variables anyways
for (const k in config) {
  process.env[k] = config[k];
}

const fs = require("fs");

const { LogLevel } = require("@slack/logger");
const logLevel = process.env.SLACK_LOG_LEVEL || LogLevel.DEBUG;

const { App, ExpressReceiver } = require("@slack/bolt");
// If you deploy this app to FaaS, turning this on is highly recommended
// Refer to https://github.com/slackapi/bolt/issues/395 for details
const processBeforeResponse = false;
// Manually instantiate to add external routes afterwards
const receiver = new ExpressReceiver({
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  processBeforeResponse,
});
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  logLevel,
  receiver,
  processBeforeResponse,
});

// Request dumper middleware for easier debugging
if (process.env.SLACK_REQUEST_LOG_ENABLED === "1") {
  app.use(async (args) => {
    const copiedArgs = JSON.parse(JSON.stringify(args));
    copiedArgs.context.botToken = 'xoxb-***';
    if (copiedArgs.context.userToken) {
      copiedArgs.context.userToken = 'xoxp-***';
    }
    copiedArgs.client = {};
    copiedArgs.logger = {};
    args.logger.debug(
      "Dumping request data for debugging...\n\n" +
      JSON.stringify(copiedArgs, null, 2) +
      "\n"
    );
    const result = await args.next();
    args.logger.debug("next() call completed");
    return result;
  });
}

let data_store = {}; // {user_id: message_text}

// ---------------------------------------------------------------
// Start coding here..
// see https://slack.dev/bolt/

// https://api.slack.com/apps/{APP_ID}/event-subscriptions
app.shortcut("set-intro", async ({ logger, client, body, ack }) => {
  await registerModal({ logger, client, ack, body });
});

app.shortcut("show-intro", async ({ logger, client, body, ack }) => {
  if (body.user.id === body.message.user) {
    await registerModal({ logger, client, ack, body });
  } else {
    await infoModal({ logger, client, ack, body });
  }
});


// ---------------------------------------------------------------

async function infoModal({ logger, client, ack, body }) {
  logger.debug("info modal: \n" + JSON.stringify(body, null, 2));
  try {
    const user_info = data_store[body.message.user];
    logger.debug(user_info);
    if (!user_info) {
      await client.views.open({
        "trigger_id": body.trigger_id,
        "view": {
          "type": "modal",
          "title": {
            "type": "plain_text",
            "text": `自己紹介`,
            "emoji": true
          },
          "close": {
            "type": "plain_text",
            "text": "閉じる",
            "emoji": true
          },
          "blocks": [
            {
              "type": "section",
              "text": {
                "type": "mrkdwn",
                "text": "自己紹介メッセージが登録されていません"
              }
            }
          ]
        }
      });
      return;
    }
    const res = await client.views.open({
      "trigger_id": body.trigger_id,
      // Block Kit Builder - http://j.mp/bolt-starter-modal-json
      "view": {
        "type": "modal",
        "title": {
          "type": "plain_text",
          "text": user_info.user_name || "自己紹介",
          "emoji": true
        },
        "close": {
          "type": "plain_text",
          "text": "閉じる",
          "emoji": true
        },
        "blocks": [
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": user_info.text
            }
          }
          //C01C6FUUJ15
        ]
      }
    });
    logger.debug("views.open response:\n\n" + JSON.stringify(res, null, 2) + "\n");
    await ack();
  } catch (e) {
    logger.error("views.open error:\n\n" + JSON.stringify(e, null, 2) + "\n");
    await ack(`:x: Failed to open a modal due to *${e.code}* ...`);
  }
}

async function registerModal({ logger, client, ack, body }) {
  try {
    logger.debug("registerModal:\n" + JSON.stringify(body, null, 2));
    const user_info = data_store[body.user.id]
    if (!user_info) {
      user_info = { "text": "" };
    }
    const res = await client.views.open({
      "trigger_id": body.trigger_id,
      // Block Kit Builder - http://j.mp/bolt-starter-modal-json
      "view": {
        "type": "modal",
        "callback_id": "register-intro",
        "private_metadata": JSON.stringify(body),
        "title": {
          "type": "plain_text",
          "text": "自己紹介を設定する",
          "emoji": true
        },
        "submit": {
          "type": "plain_text",
          "text": "登録",
          "emoji": true
        },
        "close": {
          "type": "plain_text",
          "text": "キャンセル",
          "emoji": true
        },
        "blocks": [
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "変更前",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": user_info.text || "*NO_DATA*"
            }
          },
          {
            "type": "divider"
          },
          {
            "type": "header",
            "text": {
              "type": "plain_text",
              "text": "変更後",
              "emoji": true
            }
          },
          {
            "type": "section",
            "text": {
              "type": "mrkdwn",
              "text": body.message.text || "*NO_DATA*"
            }
          }
        ]
      }
    });
    logger.debug("views.open response:\n\n" + JSON.stringify(res, null, 2) + "\n");
    await ack();
  } catch (e) {
    logger.error("views.open error:\n\n" + JSON.stringify(e, null, 2) + "\n");
    await ack(`:x: Failed to open a modal due to *${e.code}* ...`);
  }
}

app.view("register-intro", async ({ logger, client, body, ack }) => {
  logger.debug("view_submission view payload:\n\n" + JSON.stringify(body.view, null, 2) + "\n");
  try {
    await ack();
    message = JSON.parse(body.view.private_metadata);
    user_info = await client.users.info({
      user: message.message.user
    });
    data_store[message.message.user] = {
      "user_id": message.message.user,
      "user_name": user_info.user.real_name,
      "text": message.message.text,
      "channel_id": message.channel.id,
      "ts": message.message.ts
    }
    writeConfig("data_store.json", data_store);
  } catch (e) {
    await ack("メッセージの登録に失敗しました\n" + JSON.stringify(e, null, 2));
    logger.debug(JSON.stringify(e, null, 2))
  }
});

// Utility to post a message using response_url
const axios = require('axios');
function postViaResponseUrl(responseUrl, response) {
  return axios.post(responseUrl, response);
}

// ファイルに保存する
function existsConfig(filename) {
  return fs.existsSync(`./config/${filename}`);
}

function readConfig(filename) {
  return JSON.parse(fs.readFileSync(`./config/${filename}`));
}

function writeConfig(filename, json_object) {
  fs.writeFileSync(`./config/${filename}`, JSON.stringify(json_object, null, 2));
}

receiver.app.get("/", (_req, res) => {
  res.send("Your Bolt ⚡️ App is running!");
});

(async () => {
  await app.start(process.env.PORT || 3000);
  if (existsConfig("data_store.json")) {
    data_store = readConfig("data_store.json")
  }
  console.log("⚡️ Bolt app is running!");
})();
