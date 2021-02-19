require("dotenv").config();
//var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const geolocationUtlis = require("geolocation-utils");
const path = require("path");
const MongoClient = require("mongodb").MongoClient;

var app = express();
var server = http.createServer(app);
const io = require("socket.io")(server);
const crypto = require("crypto");
//....
const { promisify, inspect } = require("util");
const urlParser = require("url");
const requestAPI = require("request");
const redis = require("redis");
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");

//CRUCIAL VARIABLES
var _INTERVAL_PERSISTER_LATE_REQUESTS = null; //Will hold the interval for checking whether or not a requests has takne too long and should be cancelled.
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
  chaineDateUTC = new Date(date).toISOString();
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
 * @func removeOldRequests_madeWithoutBeingAttended
 * responsible for removing the requests that did X amount of time without being accepted
 * and notify the user who requested.
 * @param collectionPassengers_profiles: contains all the riders.
 * @param collectionRidesDeliveryData: contains all the requests made.
 * @param resolve
 */
function removeOldRequests_madeWithoutBeingAttended(
  collectionPassengers_profiles,
  collectionRidesDeliveryData,
  resolve
) {
  resolveDate(); //! Update date

  let requestFilter = {
    taxi_id: false,
    "ride_state_vars.isAccepted": false,
  };
  //..
  collectionRidesDeliveryData
    .find(requestFilter)
    .toArray(function (err, holdRequests) {
      if (err) {
        resolve({ response: "error", flag: "unable_to_clean_x_hold_requests" });
      }
      //...
      if (holdRequests.length > 0) {
        //Found some hold requests - check the time as well
        //Will contain the 'age_minutes', 'request_fp', 'client_id' and 'pushNotif_token' as an obj
        //? Bulk compute the age
        //console.log(holdRequests);
        let parentPromises = holdRequests.map((request) => {
          return new Promise((resAge) => {
            //? Get dates and convert from milliseconds to seconds
            let dateRequested =
              new Date(request.date_requested).getTime() / 1000;
            let referenceDate = new Date(chaineDateUTC).getTime() / 1000;
            //...Compute the diff and convert to minutes
            let diff = (referenceDate - dateRequested) / 60;
            //...Save
            let recordObj = {
              age_minutes: diff,
              request_fp: request.request_fp,
              client_id: request.client_id,
              pushNotif_token: null,
            };
            //Get the push notif token
            collectionPassengers_profiles
              .find({ user_fingerprint: request.client_id })
              .toArray(function (err, riderProfile) {
                if (err) {
                  resAge(recordObj);
                }
                //...
                if (riderProfile.length > 0) {
                  //Found the rider's profile
                  //Update the pushNotif_token if found
                  recordObj.pushNotif_token =
                    riderProfile[0].pushnotif_token !== null &&
                    riderProfile[0].pushnotif_token !== false
                      ? riderProfile[0].pushnotif_token.userId !== undefined &&
                        riderProfile[0].pushnotif_token.userId !== null
                        ? riderProfile[0].pushnotif_token.userId
                        : null
                      : null;
                  //DDone
                  resAge(recordObj);
                } //No profile found
                else {
                  resAge(recordObj);
                }
              });
          });
        });
        //Done
        Promise.all(parentPromises)
          .then(
            (bulkRecordData) => {
              if (
                bulkRecordData.length > 0 &&
                bulkRecordData[0].pushNotif_token !== undefined
              ) {
                //? Has some records
                //? Go through and auto-cancel very hold requests
                bulkRecordData.map((recordData) => {
                  if (
                    recordData.age_minutes >=
                    parseInt(
                      process.env.MAXIMUM_REQUEST_AGE_FOR_CLEANING_MINUTES
                    )
                  ) {
                    //Geeather than the maximum age
                    //! Auto cancel - and flag it as done by Junkstem
                    let url =
                      process.env.LOCAL_URL +
                      ":" +
                      process.env.DISPATCH_SERVICE_PORT +
                      "/cancelRiders_request";

                    requestAPI.post(
                      {
                        url,
                        form: {
                          user_fingerprint: recordData.client_id,
                          request_fp: recordData.request_fp,
                          flag: "Junkstem",
                        },
                      },
                      function (error, response, body) {
                        if (error === null) {
                          try {
                            body = JSON.parse(body);
                            if (/successully/i.test(body.response)) {
                              //Successfully cancelled
                              console.log(
                                "notifying the rider of the cancellation of the request"
                              );
                              //! Notify the rider
                              //Send the push notifications
                              let message = {
                                app_id: "05ebefef-e2b4-48e3-a154-9a00285e394b",
                                android_channel_id:
                                  "52d845a9-9064-4bc0-9fc6-2eb3802a380e", //Ride - Auto-cancelled group
                                priority: 10,
                                contents: {
                                  en:
                                    "Sorry we couldn't find for you an available ride, please try again.",
                                },
                                headings: "Unable to find a ride",
                                include_player_ids: [
                                  recordData.pushNotif_token,
                                ],
                              };
                              //Send
                              sendPushUPNotification(message);
                            } //error
                            else {
                              console.log(body);
                            }
                          } catch (error) {
                            console.log(error);
                          }
                        } else {
                          console.log(error);
                        }
                      }
                    );
                  }
                });
                resolve({
                  response: "success",
                  flag: "nicely_cleansed_requests_to_clean_x",
                });
              } //No records - surely an error
              else {
                resolve({
                  response: "success",
                  flag: "emptyHold_requests_to_clean_x",
                });
              }
            },
            (error) => {
              console.log(error);
              resolve({
                response: "error",
                flag: "unable_to_clean_x_hold_requests",
              });
            }
          )
          .catch((error) => {
            console.log(error);
            resolve({
              response: "error",
              flag: "unable_to_clean_x_hold_requests",
            });
          });
      } //No hold requests
      else {
        resolve({ response: "success", flag: "emptyHold_requests_to_clean_x" });
      }
    });
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Watcher services active.");
  const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
  const collectionPassengers_profiles = dbMongo.collection(
    "passengers_profiles"
  ); //Hold all the passengers profiles
  const collectionRidesDeliveryData = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collection_OTP_dispatch_map = dbMongo.collection("OTP_dispatch_map");
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
  const collectionWalletTransactions_logs = dbMongo.collection(
    "wallet_transactions_logs"
  ); //Hold all the wallet transactions (exlude rides/deliveries records which are in the rides/deliveries collection)
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      console.log("Account services up");
    })
    .use(
      bodyParser.json({
        limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
        extended: true,
      })
    )
    .use(
      bodyParser.urlencoded({
        limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
        extended: true,
      })
    )
    .use(bodyParser.urlencoded({ extended: true }));

  /**
   * MAIN Watcher loop
   * ! ONLY USE PROMISIFIED FUNCTIONS!
   * ! ALWAYS CATCH TROUBLE!
   */
  _INTERVAL_PERSISTER_LATE_REQUESTS = setInterval(function () {
    resolveDate();
    //...
    console.log(`[${chaineDateUTC}] - Watcher loopedi`);
    //? 1. Clean X hold requests
    new Promise((res1) => {
      removeOldRequests_madeWithoutBeingAttended(
        collectionPassengers_profiles,
        collectionRidesDeliveryData,
        res1
      );
    })
      .then(
        (result) => {
          console.log(result);
        },
        (error) => {
          console.log(error);
        }
      )
      .catch((error) => {
        console.log(error);
      });
  }, process.env.INTERVAL_PERSISTER_MAIN_WATCHER_MILLISECONDS);
});

server.listen(process.env.WATCHER_SERVICE_PORT);
