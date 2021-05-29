require("dotenv").config();
/**
 * Responsible for sending push notification to devices
 */
/*var sendPushUPNotification = function (data) {
  console.log("Notify data");
  console.log(data);
  var headers = {
    "Content-Type": "application/json; charset=utf-8",
  };

  var options = {
    host: "onesignal.com",
    port: 443,
    path: "/api/v1/notifications",
    method: "POST",
    headers: headers,
  };

  var https = require("https");
  var req = https.request(options, function (res) {
    res.on("data", function (data) {
      console.log(data);
    });
  });

  req.on("error", function (e) {});

  req.write(JSON.stringify(data));
  req.end();
};

let message = {
  app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
  android_channel_id: process.env.DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION,
  priority: 10,
  contents: {
    en: "TEST NOTIFICATION",
  },
  headings: { en: "TaxiConnect" },
  content_available: true,
  include_player_ids: ["77204af8-1f31-4f52-abe4-54f78bd92126"],
};
//Send
sendPushUPNotification(message);*/
const url = require;
