require("dotenv").config();
var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const geolocationUtlis = require("geolocation-utils");
const taxiRanksDb = JSON.parse(fs.readFileSync("taxiRanks_points.txt", "utf8"));
const path = require("path");
const MongoClient = require("mongodb").MongoClient;

var app = express();
var server = http.createServer(app);
const io = require("socket.io")(server);
const mysql = require("mysql");
const requestAPI = require("request");
const crypto = require("crypto");
//....
const { promisify, inspect } = require("util");
const urlParser = require("url");
const redis = require("redis");
const client = redis.createClient();
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

//CRUCIAL VARIABLES
var _INTERVAL_PERSISTER_LATE_REQUESTS = null; //Will hold the interval for checking whether or not a requests has takne too long and should be cancelled.
var _INTERVAL_PERSISTER_LATE_REQUESTS_TIME = 10000; //Will hold the timeout for the late requests watchdog - default: 5 sec
//...

const clientMongo = new MongoClient(process.env.URL_MONGODB, {
  useUnifiedTopology: true,
});

function resolveDate() {
  //Resolve date
  var date = new Date();
  date = moment(date.getTime()).utcOffset(2);

  dateObject = date;
  date =
    date.year() +
    "-" +
    (date.month() + 1) +
    "-" +
    date.date() +
    " " +
    date.hour() +
    ":" +
    date.minute() +
    ":" +
    date.second();
  chaineDateUTC = date;
}
resolveDate();

/**
 * Responsible for sending push notification to devices
 */
var sendPushUPNotification = function (data) {
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
      //console.log("Response:");
    });
  });

  req.on("error", function (e) {});

  req.write(JSON.stringify(data));
  req.end();
};

/**
 * @func generateUniqueFingerprint()
 * Generate unique fingerprint for any string size.
 */
function generateUniqueFingerprint(str, encryption = false, resolve) {
  str = str.trim();
  let fingerprint = null;
  if (encryption === false) {
    fingerprint = crypto
      .createHmac(
        "sha512WithRSAEncryption",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } else if (/md5/i.test(encryption)) {
    fingerprint = crypto
      .createHmac(
        "md5WithRSAEncryption",
        "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY"
      )
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  } //Other - default
  else {
    fingerprint = crypto
      .createHmac("sha256", "TAXICONNECTBASICKEYFINGERPRINTS-RIDES-DELIVERY")
      .update(str)
      .digest("hex");
    resolve(fingerprint);
  }
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Watcher services active.");
  const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
  const collectionRidesDeliveryData = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collectionRelativeDistances = dbMongo.collection(
    "relative_distances_riders_drivers"
  ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
  const collectionRidersLocation_log = dbMongo.collection(
    "historical_positioning_logs"
  ); //Hold all the location updated from the rider
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      res.send("Watcher services up");
    })
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }));

  /**
   * WATCH REQUESTS MADE IN ORDER TO TRGIIGER TIMEOUT WHEN THE REQUESTS
   * HAVE BEEN THERE FOR EXACTLY 25MIN WITHOUT ACCEPTANCE.
   * Reference it from the last acceptance time.
   */
  _INTERVAL_PERSISTER_LATE_REQUESTS = setInterval(() => {
    //console.log("Requests watcher");
  }, _INTERVAL_PERSISTER_LATE_REQUESTS_TIME);
});

server.listen(process.env.WATCHER_SERVICE_PORT);
