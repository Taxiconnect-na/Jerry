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
    request_type: { $regex: /immediate/, $options: "i" }, //? Only handle immediate requests for now.
  };
  //..
  collectionRidesDeliveryData
    .find(requestFilter)
    .toArray(function (err, holdRequests) {
      if (err) {
        resolve({ response: "error", flag: "unable_to_clean_x_hold_requests" });
      }
      //...
      if (holdRequests !== undefined && holdRequests.length > 0) {
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
                                app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                                android_channel_id:
                                  process.env
                                    .RIDERS_ONESIGNAL_CHANNEL_AUTOCANCELLED_REQUEST, //Ride - Auto-cancelled group
                                priority: 10,
                                contents: {
                                  en:
                                    "Sorry we couldn't find for you an available ride, please try again.",
                                },
                                headings: { en: "Unable to find a ride" },
                                content_available: true,
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

function date_diff_indays(date1, date2) {
  dt1 = new Date(date1);
  dt2 = new Date(date2);
  return Math.floor(
    (Date.UTC(dt2.getFullYear(), dt2.getMonth(), dt2.getDate()) -
      Date.UTC(dt1.getFullYear(), dt1.getMonth(), dt1.getDate())) /
      (1000 * 60 * 60 * 24)
  );
}

/**
 * @func updateNext_paymentDateDrivers
 * Responsible for updating the driver's next payments date, only for those having a date start.
 * ? Only consider drivers already having a starting point, that should already be the case for
 * ? any drivers that already logged in once.
 * ! Only if there was not a previous
 * @param collectionDrivers_profiles: the driver's list
 * @param collectionWalletTransactions_logs: all the transactions.
 * @param resolve
 */
function updateNext_paymentDateDrivers(
  collectionDrivers_profiles,
  collectionWalletTransactions_logs,
  resolve
) {
  collectionDrivers_profiles.find({}).toArray(function (err, driversMega) {
    if (err) {
      resolve({ response: "error_getting_drivers_mega_data" });
    }
    //...
    if (driversMega !== undefined && driversMega.length > 0) {
      //Found some data
      let parentPromises = driversMega.map((driverData) => {
        return new Promise((resPaymentCycle) => {
          //!Check if a reference point exists - if not set one to NOW
          //? For days before wednesday, set to wednesdat and for those after wednesday, set to next week that same day.
          //! Annotation string: startingPoint_forFreshPayouts

          collectionWalletTransactions_logs
            .find({
              flag_annotation: {
                $regex: /startingPoint_forFreshPayouts/,
                $options: "i",
              },
              user_fingerprint: driverData.driver_fingerprint,
            })
            .toArray(function (err, referenceData) {
              if (err) {
                resPaymentCycle(false);
              }
              //...
              if (
                referenceData !== undefined &&
                referenceData.length > 0 &&
                referenceData[0].date_captured !== undefined
              ) {
                referenceData = referenceData[0];
                //? Check if the date is not old, not behing of 24h
                let refDate = new Date(chaineDateUTC);
                let nextPaymentDate = new Date(referenceData.date_captured);
                let dateDiffChecker = date_diff_indays(
                  refDate,
                  nextPaymentDate
                ); //In days

                if (dateDiffChecker <= -1) {
                  console.log("Found obsolete date, add 7 days");
                  //! Day passed already by 24 hours - update - ADD 7 days
                  let tmpDate = new Date(
                    new Date(chaineDateUTC).getTime() +
                      parseFloat(process.env.TAXICONNECT_PAYMENT_FREQUENCY) *
                        3600 *
                        1000
                  )
                    .toDateString()
                    .split(" ")[0];
                  if (/(mon|tue)/i.test(tmpDate)) {
                    //For mondays and tuesdays - add 3 days
                    let tmpNextDate = new Date(
                      new Date(chaineDateUTC).getTime() +
                        (3 +
                          parseFloat(
                            process.env.TAXICONNECT_PAYMENT_FREQUENCY
                          )) *
                          24 *
                          3600 *
                          1000
                    ).toISOString();
                    //...
                    collectionWalletTransactions_logs.updateOne(
                      {
                        flag_annotation: {
                          $regex: /startingPoint_forFreshPayouts/,
                          $options: "i",
                        },
                        user_fingerprint: driverData.driver_fingerprint,
                      },
                      {
                        $set: {
                          flag_annotation: "startingPoint_forFreshPayouts",
                          date_captured: new Date(tmpNextDate),
                        },
                      },
                      function (err, reslt) {
                        resPaymentCycle(true);
                      }
                    );
                  } //After wednesday - OK
                  else {
                    let dateNext = new Date(
                      new Date(chaineDateUTC).getTime() +
                        parseFloat(
                          process.env.TAXICONNECT_PAYMENT_FREQUENCY *
                            24 *
                            3600 *
                            1000
                        )
                    ).toISOString();
                    //?----
                    collectionWalletTransactions_logs.updateOne(
                      {
                        flag_annotation: {
                          $regex: /startingPoint_forFreshPayouts/,
                          $options: "i",
                        },
                        user_fingerprint: driverData.driver_fingerprint,
                      },
                      {
                        $set: {
                          flag_annotation: "startingPoint_forFreshPayouts",
                          date_captured: new Date(dateNext),
                        },
                      },
                      function (err, reslt) {
                        resPaymentCycle(true);
                      }
                    );
                  }
                } //? The date looks good - skip
                else {
                  console.log("Next payment date not obsolete found!");
                  resPaymentCycle(true);
                }
              } //No annotation yet - create one
              else {
                resPaymentCycle(true);
              }
            });
        });
      });
      //? DONE
      Promise.all(parentPromises)
        .then(
          (reslt) => {
            resolve({
              response:
                "Done checking and updating obsolete next payment dates",
            });
          },
          (error) => {
            console.log(error);
            resolve({
              response:
                "Done checking and updating obsolete next payment dates",
            });
          }
        )
        .catch((error) => {
          console.log(error);
          resolve({
            response: "Done checking and updating obsolete next payment dates",
          });
        });
    } //Empty driver's mega data
    else {
      resolve({ response: "empty_drivers_mega_data" });
    }
  });
}

function getDaysInMonth(month, year) {
  // Here January is 1 based
  //Day 0 is the last day in the previous month
  return new Date(year, month, 0).getDate();
  // Here January is 0 based
  // return new Date(year, month+1, 0).getDate();
}

function diff_hours(dt1, dt2) {
  if (dt2 > dt1) {
    return { difference: Math.abs(dt2 - dt1) / 3600000, state: "onTime" };
  } else {
    return { difference: Math.abs(dt2 - dt1) / 3600000, state: "late" };
  }
}

/**
 * @func scheduledRequestsWatcher_junky
 * Responsible for checking the wished pickup time for all the sheduled requests and alert
 * the linked drivers 5 min before the ride or redispatch the request if no drivers has accepted it yet.
 * ! If the wished pickup time exceeded __MAXIMUM_REQUEST_AGE_FOR_CLEANING_MINUTES__ (from the wished pickup time) of waiting time without being attended,
 * ! auto-cancel the request and notify the client as usual.
 * @param collectionRidesDeliveryData: the list of all the requests
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param collectionPassengers_profiles: the list of all the passengers.
 * @param resolve
 */
function scheduledRequestsWatcher_junky(
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  collectionPassengers_profiles,
  resolve
) {
  //1. Get all the scheduled requests not done yet
  let requestFilter0 = {
    request_type: { $regex: /scheduled/, $options: "i" },
    isArrivedToDestination: false,
    "ride_state_vars.isRideCompleted_driverSide": false,
  };

  collectionRidesDeliveryData
    .find(requestFilter0)
    .toArray(function (err, dataScheduledRequests) {
      if (err) {
        console.log(err);
        resolve({ response: "An error occured", flag: err });
      }
      //...
      if (
        dataScheduledRequests !== undefined &&
        dataScheduledRequests.length > 0
      ) {
        //Found some scheduled requests
        let parentPromises = dataScheduledRequests.map((request) => {
          return new Promise((resAge) => {
            //? Get dates and convert from milliseconds to seconds
            let dateRequested = new Date(request.wished_pickup_time);
            let referenceDate = new Date(chaineDateUTC);
            //...Compute the diff and convert to minutes
            let diff = diff_hours(referenceDate, dateRequested);
            //...Save
            let recordObj = {
              age_minutes: diff.difference * 60,
              onTime_state: diff.state,
              request_fp: request.request_fp,
              client_id: request.client_id,
              pushNotif_token: null,
              driverInfos: {
                driver_fp: null,
                pushNotif_token: null,
              },
            };
            //Get the push notif token
            new Promise((resGetPassengerInfos) => {
              collectionPassengers_profiles
                .find({ user_fingerprint: request.client_id })
                .toArray(function (err, riderProfile) {
                  if (err) {
                    resGetPassengerInfos(recordObj);
                  }
                  //...
                  if (riderProfile.length > 0) {
                    //Found the rider's profile
                    //Update the pushNotif_token if found
                    recordObj.pushNotif_token =
                      riderProfile[0].pushnotif_token !== null &&
                      riderProfile[0].pushnotif_token !== false
                        ? riderProfile[0].pushnotif_token.userId !==
                            undefined &&
                          riderProfile[0].pushnotif_token.userId !== null
                          ? riderProfile[0].pushnotif_token.userId
                          : null
                        : null;
                    //DDone
                    resGetPassengerInfos(recordObj);
                  } //No profile found
                  else {
                    resGetPassengerInfos(recordObj);
                  }
                });
            })
              .then((passengerInfos) => {
                //? Get the driver's infos
                if (
                  request.taxi_id !== false &&
                  request.taxi_id !== "false" &&
                  request.taxi_id !== null
                ) {
                  //Has a linked driver
                  //Get the driver's infos
                  collectionDrivers_profiles
                    .find({ driver_fingerprint: request.taxi_id })
                    .toArray(function (err, driverData) {
                      if (err) {
                        console.log(err);
                        resAge(passengerInfos);
                      }
                      //...
                      if (driverData !== undefined && driverData.length > 0) {
                        //Found the driver's profile
                        //Update the driver's finggerprint
                        passengerInfos.driverInfos.driver_fp =
                          driverData[0].driver_fingerprint;
                        //Update the pushNotif_token if found
                        passengerInfos.driverInfos.pushNotif_token =
                          driverData[0].operational_state
                            .push_notification_token !== null &&
                          driverData[0].operational_state
                            .push_notification_token !== false
                            ? driverData[0].operational_state
                                .push_notification_token.userId !== undefined &&
                              driverData[0].operational_state
                                .push_notification_token.userId !== null
                              ? driverData[0].operational_state
                                  .push_notification_token.userId
                              : null
                            : null;
                        //? DONE
                        resAge(passengerInfos);
                      } //No driver infos found - strange
                      else {
                        resAge(passengerInfos);
                      }
                    });
                } //No linked driver - proceed
                else {
                  resAge(passengerInfos);
                }
              })
              .catch((error) => {
                console.log(error);
                resAge(recordObj);
              });
          });
        });
        //...DONE
        Promise.all(parentPromises)
          .then(
            (scheduledRequestsBulk) => {
              console.log(scheduledRequestsBulk);
              if (scheduledRequestsBulk.length > 0) {
                //Found some requests
                let parentPromises2 = scheduledRequestsBulk.map((request) => {
                  return new Promise((resCompute) => {
                    if (/onTime/i.test(request.onTime_state)) {
                      //? Still on time - remind the linked driver or redispatch when it's TIME_TO_WATCH_BEFORE_REMINDING_SCHEDULED_REQUEST_MINUTES
                      let regChecker = new RegExp(
                        `${process.env.TIME_TO_WATCH_BEFORE_REMINDING_SCHEDULED_REQUEST_MINUTES}`,
                        "i"
                      );
                      if (/^2\.5/.test(`${request.age_minutes}`)) {
                        //1. Remind the driver if any
                        if (
                          request.driverInfos.driver_fp !== null &&
                          request.driverInfos.driver_fp !== false
                        ) {
                          //Has a linked driver
                          //Send the push notifications
                          let message = {
                            app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                            android_channel_id:
                              process.env
                                .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION,
                            priority: 10,
                            contents: {
                              en:
                                "Hi, you have a scheduled request to attend in about 2 minutes.",
                            },
                            headings: { en: "Upcoming scheduled request" },
                            content_available: true,
                            include_player_ids: [
                              request.driverInfos.pushNotif_token,
                            ],
                          };
                          //Send
                          sendPushUPNotification(message);
                        } //! REDISPATCH
                        else {
                          new Promise((resRedispatch) => {
                            //? Get the full request
                            collectionRidesDeliveryData
                              .find({ request_fp: result.request_fp })
                              .toArray(function (err, fullRequestOriginals) {
                                if (err) {
                                  console.log(err);
                                  resRedispatch(false);
                                }
                                //...
                                if (
                                  fullRequestOriginals !== undefined &&
                                  fullRequestOriginals.length > 0
                                ) {
                                  //Found the request mother
                                  let url =
                                    process.env.LOCAL_URL +
                                    ":" +
                                    process.env.DISPATCH_SERVICE_PORT +
                                    "/redispatcherAlreadyParsedRequests";

                                  requestAPI.post(
                                    { url, form: fullRequestOriginals[0] },
                                    function (error, response, body) {
                                      console.log(body);
                                      if (error === null) {
                                        try {
                                          body = JSON.parse(body);
                                          if (body.response !== undefined) {
                                            //Error
                                            resRedispatch(body);
                                          } //SUCCESS
                                          else {
                                            resRedispatch(body);
                                          }
                                        } catch (error) {
                                          console.log(error);
                                          resRedispatch(false);
                                        }
                                      } else {
                                        resRedispatch(false);
                                      }
                                    }
                                  );
                                } //No requests found - strange or maybe cancelled
                                else {
                                  resRedispatch(false);
                                }
                              });
                          })
                            .then(
                              (resltRedispatch) => {
                                console.log(resltRedispatch);
                              },
                              (error) => {
                                console.log(error);
                              }
                            )
                            .catch((error) => {
                              console.log(error);
                            });
                        }

                        //2. Remind the rider
                        let message = {
                          app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                          android_channel_id:
                            process.env
                              .RIDERS_ONESIGNAL_CHANNEL_ACCEPTTEDD_REQUEST,
                          priority: 10,
                          contents: {
                            en:
                              "Hi, you have a scheduled request in about 2 minutes.",
                          },
                          headings: { en: "Upcoming scheduled request" },
                          content_available: true,
                          include_player_ids: [request.pushNotif_token],
                        };
                        //Send
                        sendPushUPNotification(message);
                        //? DONE ------------------------
                        resCompute(true);
                      } //Do nothing
                      else {
                        resCompute(true);
                      }
                    } //! Late, check that it doesn't stay after MAXIMUM_REQUEST_AGE_FOR_CLEANING_MINUTES
                    else {
                      if (
                        request.age_minutes >
                        process.env.MAXIMUM_REQUEST_AGE_FOR_CLEANING_MINUTES
                      ) {
                        //! AUTO-CANCEL
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
                              user_fingerprint: request.client_id,
                              request_fp: request.request_fp,
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
                                    app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                                    android_channel_id:
                                      process.env
                                        .RIDERS_ONESIGNAL_CHANNEL_AUTOCANCELLED_REQUEST, //Ride - Auto-cancelled group
                                    priority: 10,
                                    contents: {
                                      en:
                                        "Sorry we couldn't find for you an available ride, please try again.",
                                    },
                                    headings: { en: "Unable to find a ride" },
                                    content_available: true,
                                    include_player_ids: [
                                      request.pushNotif_token,
                                    ],
                                  };
                                  //Send
                                  sendPushUPNotification(message);
                                  resCompute(true);
                                } //error
                                else {
                                  console.log(body);
                                  resCompute(true);
                                }
                              } catch (error) {
                                console.log(error);
                                resCompute(true);
                              }
                            } else {
                              console.log(error);
                              resCompute(true);
                            }
                          }
                        );
                      } //Do nothing
                      else {
                        resCompute(true);
                      }
                    }
                  });
                });
                //DONE
                Promise.all(parentPromises2)
                  .then(
                    (fullComputeReslt) => {
                      console.log(fullComputeReslt);
                      resolve({
                        response:
                          "successfully_wentThrough_scheduled_requestsFor_watch",
                      });
                    },
                    (error) => {
                      console.log(error);
                      resolve({ response: "An error occured", flag: error });
                    }
                  )
                  .catch((error) => {
                    console.log(error);
                    resolve({ response: "An error occured", flag: error });
                  });
              } //No requests found
              else {
                resolve({ response: "empty_scheduled_requestsFor_watch" });
              }
            },
            (error) => {
              console.log(error);
              resolve({ response: "An error occured", flag: error });
            }
          )
          .catch((error) => {
            console.log(error);
            resolve({ response: "An error occured", flag: error });
          });
      } //No scheduled requests so far
      else {
        resolve({ response: "empty_scheduled_requestsFor_watch" });
      }
    });
}

/**
 * @func requestsDriverSubscriber_watcher
 * Responsible to check if there's any driver subscribed to a specific request after about MAXIMUM_WAIT_TIME_BEFORE_GLOBAL_SUBSCRIPTION_SECONDS
 * before subscribing to all the drivers.
 * ! Only if after __MAXIMUM_WAIT_TIME_BEFORE_GLOBAL_SUBSCRIPTION_SECONDS__ there's no driver subscribed to the request.
 * @param collectionRidesDeliveryData: the list of all the requests
 * @param collectionDrivers_profiles: the list of all the drivers.
 * @param resolve
 */
function requestsDriverSubscriber_watcher(
  collectionRidesDeliveryData,
  collectionDrivers_profiles,
  resolve
) {
  //1. Get all the requests not accepted yet
  let requestFilter0 = {
    taxi_id: false,
    isArrivedToDestination: false,
    "ride_state_vars.isRideCompleted_driverSide": false,
  };

  collectionRidesDeliveryData
    .find(requestFilter0)
    .toArray(function (err, dataRequests) {
      if (err) {
        console.log(err);
        resolve({ response: "An error occured", flag: err });
      }
      //...
      if (dataRequests !== undefined && dataRequests.length > 0) {
        //Found some scheduled requests
        let parentPromises = dataRequests.map((request) => {
          return new Promise((resAge) => {
            //Check if there's no subscribed drivers yet
            //No subscribers yet
            if (
              request.allowed_drivers_see.length <= 0 ||
              request.allowed_drivers_see.includes(null) ||
              request.allowed_drivers_see.includes(undefined)
            ) {
              //? Get dates and convert from milliseconds to seconds
              let dateRequested = new Date(request.date_requested);
              let referenceDate = new Date(chaineDateUTC);
              //...Compute the diff and convert to minutes
              let diff =
                diff_hours(dateRequested, referenceDate).difference * 3600; //? to seconds
              console.log("SUBSCRIBELESS DIFF --------> ", diff);
              //! Check the wait time
              if (
                diff >=
                process.env.MAXIMUM_WAIT_TIME_BEFORE_GLOBAL_SUBSCRIPTION_SECONDS
              ) {
                //Auto subscribe all
                //Get all the driver's fp of the same city and country
                let driverFilter = {
                  "operational_state.status": {
                    $regex: /(offline|online)/,
                    $options: "i",
                  },
                  "operational_state.last_location.city": {
                    $regex:
                      /false/i.test(request.pickup_location_infos.city) ||
                      request.pickup_location_infos.city === false
                        ? "Windhoek"
                        : request.pickup_location_infos.city,
                    $options: "i",
                  },
                  "operational_state.last_location.country": {
                    $regex: request.country,
                    $options: "i",
                  },
                  operation_clearances: {
                    $regex: request.ride_mode,
                    $options: "i",
                  },
                  //Filter the drivers based on the vehicle type if provided
                  "operational_state.default_selected_car.vehicle_type":
                    request.carTypeSelected !== undefined &&
                    request.carTypeSelected !== false
                      ? { $regex: request.carTypeSelected, $options: "i" }
                      : { $regex: /[a-zA-Z]/, $options: "i" },
                };
                //...
                collectionDrivers_profiles
                  .find(driverFilter)
                  .toArray(function (err, driversFullData) {
                    if (err) {
                      console.log(err);
                      resAge(false);
                    }
                    //...
                    if (
                      driversFullData !== undefined &&
                      driversFullData.length > 0
                    ) {
                      //Found some drivers
                      //1. Gather all the fingerprints
                      let driversFps = driversFullData.map(
                        (driver) => driver.driver_fingerprint
                      );

                      let newSubscribedDrivers_array = [
                        ...new Set([
                          ...request.allowed_drivers_see,
                          ...driversFps,
                        ]),
                      ];
                      //*. Remove the null
                      newSubscribedDrivers_array = newSubscribedDrivers_array.filter(
                        (data) => data !== null && data !== undefined
                      );
                      //2. Update  the subscribed driver array
                      collectionRidesDeliveryData.updateOne(
                        {
                          request_fp: request.request_fp,
                        },
                        {
                          $set: {
                            allowed_drivers_see: newSubscribedDrivers_array,
                          },
                        },
                        function (err, resultUpdate) {
                          if (err) {
                            console.log(err);
                            resAge(false);
                          }
                          //...
                          //SEND THE NOTIFICATIONS
                          let parentPromises = driversFullData.map((driver) => {
                            return new Promise((resSend) => {
                              //Send the push notifications
                              let message = {
                                app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
                                android_channel_id: /RIDE/i.test(
                                  request.ride_mode
                                )
                                  ? process.env
                                      .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION
                                  : process.env
                                      .DRIVERS_ONESIGNAL_CHANNEL_NEW_NOTIFICATION, //Ride or delivery channel
                                priority: 10,
                                contents: /RIDE/i.test(request.ride_mode)
                                  ? {
                                      en:
                                        "You have a new ride request " +
                                        (request.pickup_location_infos
                                          .suburb !== false
                                          ? "from " +
                                              request.pickup_location_infos
                                                .suburb !==
                                            undefined
                                            ? request.pickup_location_infos
                                                .suburb !== undefined &&
                                              request.pickup_location_infos
                                                .suburb !== false &&
                                              request.pickup_location_infos
                                                .suburb !== null
                                              ? request.pickup_location_infos.suburb.toUpperCase()
                                              : "near your location"
                                            : "near your location" +
                                                " to " +
                                                request.pickup_location_infos
                                                  .suburb !==
                                              undefined
                                            ? request.pickup_location_infos
                                                .suburb !== undefined &&
                                              request.pickup_location_infos
                                                .suburb !== false &&
                                              request.pickup_location_infos
                                                .suburb !== null
                                              ? request.pickup_location_infos.suburb.toUpperCase()
                                              : "near your location"
                                            : "near your location" +
                                              ". Click here for more details."
                                          : "near your location, click here for more details."),
                                    }
                                  : {
                                      en:
                                        "You have a new delivery request " +
                                        (request.pickup_location_infos
                                          .suburb !== false
                                          ? "from " +
                                              request.pickup_location_infos
                                                .suburb !==
                                            undefined
                                            ? request.pickup_location_infos
                                                .suburb !== undefined &&
                                              request.pickup_location_infos
                                                .suburb !== false &&
                                              request.pickup_location_infos
                                                .suburb !== null
                                              ? request.pickup_location_infos.suburb.toUpperCase()
                                              : "near your location"
                                            : "near your location" +
                                                " to " +
                                                request.pickup_location_infos
                                                  .suburb !==
                                              undefined
                                            ? request.pickup_location_infos
                                                .suburb !== undefined &&
                                              request.pickup_location_infos
                                                .suburb !== false &&
                                              request.pickup_location_infos
                                                .suburb !== null
                                              ? request.pickup_location_infos.suburb.toUpperCase()
                                              : "near your location"
                                            : "near your location" +
                                              ". Click here for more details."
                                          : "near your location, click here for more details."),
                                    },
                                headings: /RIDE/i.test(request.ride_mode)
                                  ? {
                                      en: "New ride request, N$" + request.fare,
                                    }
                                  : {
                                      en:
                                        "New delivery request, N$" +
                                        request.fare,
                                    },
                                content_available: true,
                                include_player_ids: [
                                  driver.operational_state
                                    .push_notification_token.userId,
                                ],
                              };
                              //Send
                              sendPushUPNotification(message);
                              //...
                              resSend(true);
                            });
                          });
                          Promise.all(parentPromises)
                            .then()
                            .catch((error) => {
                              console.log(error);
                            });

                          //...DONE
                          resAge(true);
                        }
                      );
                    } //No drivers found
                    else {
                      resAge(false);
                    }
                  });
              } //Do nothing
              else {
                resAge(false);
              }
            } else {
              //Has some subscribers - SKIP
              resAge(false);
            }
          });
        });
        //DONE
        Promise.all(parentPromises)
          .then(
            (reslt) => {
              resolve({ response: "done_watching_subscribeless_requests" });
            },
            (error) => {
              console.log(error);
              resolve({
                response: "error_watching_subscribeless_requests",
                flag: error,
              });
            }
          )
          .catch((error) => {
            console.log(error);
            resolve({
              response: "error_watching_subscribeless_requests",
              flag: error,
            });
          });
      } //No requests
      else {
        resolve({
          response: "empty_watching_subscribeless_requests",
        });
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
    /*new Promise((res1) => {
      removeOldRequests_madeWithoutBeingAttended(
        collectionPassengers_profiles,
        collectionRidesDeliveryData,
        res1
      );
    })
      .then(
        (result) => {
          //console.log(result);
        },
        (error) => {
          //console.log(error);
        }
      )
      .catch((error) => {
        //console.log(error);
      });*/

    //? 2. Keep the drivers next payment date UP TO DATE
    new Promise((res2) => {
      updateNext_paymentDateDrivers(
        collectionDrivers_profiles,
        collectionWalletTransactions_logs,
        res2
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

    //? 3. Observe all the scheduled requests for executions
    new Promise((res3) => {
      scheduledRequestsWatcher_junky(
        collectionRidesDeliveryData,
        collectionDrivers_profiles,
        collectionPassengers_profiles,
        res3
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

    //? 4. Observe all the subscribeless requests
    new Promise((res4) => {
      requestsDriverSubscriber_watcher(
        collectionRidesDeliveryData,
        collectionDrivers_profiles,
        res4
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
