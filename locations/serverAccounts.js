var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const https = require("https");
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
var otpGenerator = require("otp-generator");

const URL_MONGODB = "mongodb://localhost:27017";
const localURL = "http://localhost";
const DB_NAME_MONGODB = "Taxiconnect";
const URL_SEARCH_SERVICES = "http://www.taxiconnectna.com:7007/";
const URL_ROUTE_SERVICES = "http://www.taxiconnectna.com:7008/route?";
const PRICING_SERVICE_PORT = 8989;
const MAP_SERVICE_PORT = 9090;

const clientMongo = new MongoClient(URL_MONGODB, { useUnifiedTopology: true });

function SendSMSTo(phone_number, message) {
  let username = "taxiconnect";
  let password = "Taxiconnect*1";

  let postData = JSON.stringify({
    to: phone_number,
    body: message,
  });

  let options = {
    hostname: "api.bulksms.com",
    port: 443,
    path: "/v1/messages",
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Content-Length": postData.length,
      Authorization:
        "Basic " + Buffer.from(username + ":" + password).toString("base64"),
    },
  };

  let req = https.request(options, (resp) => {
    console.log("statusCode:", resp.statusCode);
    let data = "";
    resp.on("data", (chunk) => {
      data += chunk;
    });
    resp.on("end", () => {
      console.log("Response:", data);
    });
  });

  req.on("error", (e) => {
    console.error(e);
  });

  req.write(postData);
  req.end();
}

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

const port = 9696;

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
 * @func checkUserStatus
 * @param phone_number: the user's phone number
 * @param otp: the otp generated for this user
 * @param collection_OTP_dispatch_map: the collection holding all the OTP dispatch
 * @param collectionPassengers_profiles: the collection of all the passengers
 * @param resolve
 * Responsible for checking whether the user is registeredd or not, if yes send back
 * the user fingerprint.
 */
function checkUserStatus(
  phone_number,
  otp,
  collection_OTP_dispatch_map,
  collectionPassengers_profiles,
  resolve
) {
  //Save the dispatch map for this user
  new Promise((res) => {
    let dispatchMap = {
      phone_number: phone_number,
      otp: otp,
      date_sent: chaineDateUTC,
    };
    collection_OTP_dispatch_map.insertOne(dispatchMap, function (error, reslt) {
      res(true);
    });
  }).then(
    () => {},
    () => {}
  );
  //...Check the user's status
  let checkUser = {
    phone_number: { $regex: phone_number, $options: "i" },
  };

  collectionPassengers_profiles
    .find(checkUser)
    .toArray(function (error, result) {
      if (error) {
        resolve({ response: "error_checking_user" });
      }
      //..
      if (result.length > 0) {
        //User already registered
        //Send the fingerprint
        resolve({
          response: "registered",
          user_fp: result[0].user_fingerprint,
          otp: otp,
        });
      } //Not yet registeredd
      else {
        resolve({ response: "not_yet_registered", otp: otp });
      }
    });
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Account services active.");
  const dbMongo = clientMongo.db(DB_NAME_MONGODB);
  const collectionPassengers_profiles = dbMongo.collection(
    "passengers_profiles"
  ); //Hold all the passengers profiles
  const collection_OTP_dispatch_map = dbMongo.collection("OTP_dispatch_map");
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      res.send("Watcher services up");
    })
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }));

  /**
   * GENERATE OTP AND CHECK THE USER EXISTANCE
   * Responsible for generating an otp and checking whether a user was already registered or not.
   * If already registered send also the user fingerprint.
   */
  app.get("/sendOTPAndCheckUserStatus", function (req, res) {
    resolveDate();
    let params = urlParser.parse(req.url, true);
    req = params.query;

    if (
      req.phone_number !== undefined &&
      req.phone_number !== null &&
      req.phone_number.length > 8
    ) {
      req.phone_number = req.phone_number.replace("+", "").trim(); //Critical, should only contain digits
      console.log(req.phone_number);
      //Ok
      //Send the message then check the passenger's status
      let otp = otpGenerator.generate(5, {
        upperCase: false,
        specialChars: false,
        alphabets: false,
      });
      //1. Generate and SMS the OTP
      new Promise((res0) => {
        let message =
          `<#> ` + otp + ` is your TaxiConnect Verification Code. QEg7axwB9km`;
        SendSMSTo(req.phone_number, message);
        res0(true);
        //SMS
      }).then(
        () => {
          console.log("OTP sent");
        },
        (error) => {
          console.log(error);
        }
      );
      //2. Check the user's status
      new Promise((res1) => {
        checkUserStatus(
          req.phone_number,
          otp,
          collection_OTP_dispatch_map,
          collectionPassengers_profiles,
          res1
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({ response: "error_checking_user" });
        }
      );
    } //Error phone number not received
    else {
      res.send({ response: "error_phone_number_not_received" });
    }
  });
});

server.listen(port);
