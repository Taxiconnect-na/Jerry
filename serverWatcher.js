require("dotenv").config();
//require("newrelic");
//var dash = require("appmetrics-dash");
var express = require("express");
const http = require("http");
const fs = require("fs");
const MongoClient = require("mongodb").MongoClient;
const certFile = fs.readFileSync("./rds-combined-ca-bundle.pem");

var app = express();
var server = http.createServer(app);
const crypto = require("crypto");
const cron = require("node-cron");
//....
const { logger } = require("./LogService");
const requestAPI = require("request");
const redis = require("redis");
const client = /production/i.test(String(process.env.EVIRONMENT))
  ? null
  : redis.createClient({
      host: process.env.REDIS_HOST,
      port: process.env.REDIS_PORT,
    });
var RedisClustr = require("redis-clustr");
var redisCluster = /production/i.test(String(process.env.EVIRONMENT))
  ? new RedisClustr({
      servers: [
        {
          host: process.env.REDIS_HOST_ELASTICACHE,
          port: process.env.REDIS_PORT_ELASTICACHE,
        },
      ],
      createClient: function (port, host) {
        // this is the default behaviour
        return redis.createClient(port, host);
      },
    })
  : client;

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");

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
  logger.info("Notify data");
  logger.info(data);
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
      //logger.info("Response:");
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
  let requestFilter = {
    taxi_id: false,
    "ride_state_vars.isAccepted": false,
    request_type: "immediate", //? Only handle immediate requests for now.
  }; //?Indexed
  //..
  collectionRidesDeliveryData
    .find(requestFilter)
    //!.collation({ locale: "en", strength: 2 })
    .toArray(function (err, holdRequests) {
      if (err) {
        resolve({ response: "error", flag: "unable_to_clean_x_hold_requests" });
      }
      //...
      if (holdRequests !== undefined && holdRequests.length > 0) {
        //Found some hold requests - check the time as well
        //Will contain the 'age_minutes', 'request_fp', 'client_id' and 'pushNotif_token' as an obj
        //? Bulk compute the age
        //logger.info(holdRequests);
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
                      `${
                        /production/i.test(process.env.EVIRONMENT)
                          ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                          : process.env.LOCAL_URL
                      }` +
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
                              logger.info(
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
                                  en: "Sorry we couldn't find for you an available ride, please try again.",
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
                              logger.info(body);
                            }
                          } catch (error) {
                            logger.info(error);
                          }
                        } else {
                          logger.info(error);
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
              logger.info(error);
              resolve({
                response: "error",
                flag: "unable_to_clean_x_hold_requests",
              });
            }
          )
          .catch((error) => {
            logger.info(error);
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
 * @param collectionRidesDeliveryData: all the rides
 * @param collectionGlobalEvents: global events list
 * @param resolve
 */
function updateNext_paymentDateDrivers(
  collectionDrivers_profiles,
  collectionWalletTransactions_logs,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  resolve
) {
  let amount = 0;
  collectionDrivers_profiles.find({}).toArray(function (err, driversMega) {
    if (err) {
      resolve({ response: "error_getting_drivers_mega_data" });
    }
    //...
    if (driversMega !== undefined && driversMega.length > 0) {
      //Found some data
      let parentPromises = driversMega.map((driverData) => {
        resolveDate();
        return new Promise((resPaymentCycle) => {
          //!Check if a reference point exists - if not set one to NOW
          //? For days before wednesday, set to wednesdat and for those after wednesday, set to next week that same day.
          //! Annotation string: startingPoint_forFreshPayouts

          collectionWalletTransactions_logs
            .find({
              flag_annotation: "startingPoint_forFreshPayouts",
              user_fingerprint: driverData.driver_fingerprint,
            })
            //!.collation({ locale: "en", strength: 2 })
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

                if (dateDiffChecker <= 0) {
                  logger.info(
                    `Found obsolete date, add 7 days --> Tag: ${driverData.driver_fingerprint.substr(
                      0,
                      10
                    )}`
                  );
                  //? Check the current comission state
                  let url =
                    `${
                      /production/i.test(process.env.EVIRONMENT)
                        ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                        : process.env.LOCAL_URL
                    }` +
                    ":" +
                    process.env.ACCOUNTS_SERVICE_PORT +
                    "/getDrivers_walletInfosDeep?user_fingerprint=" +
                    driverData.driver_fingerprint;

                  requestAPI(url, function (error, response, body) {
                    if (error === null) {
                      try {
                        body = JSON.parse(body);
                        if (body.header !== undefined && body.header !== null) {
                          //?Check for the comission
                          if (
                            body.header.remaining_commission !== undefined &&
                            body.header.remaining_commission !== null
                          ) {
                            //Detected a potential comission
                            //? Check if there's a pending payment > than the comission threshold (process.env.DRIVERS_MAXIMUM_COMISSION_THRESHOLD)
                            if (
                              parseFloat(body.header.remaining_commission) >=
                              parseFloat(
                                process.env.DRIVERS_MAXIMUM_COMISSION_THRESHOLD
                              )
                            ) {
                              amount += parseFloat(
                                body.header.remaining_commission
                              );
                              amount -= parseFloat(
                                body.header.remaining_due_to_driver
                              );
                              //Has reached the threshold
                              if (
                                parseFloat(
                                  body.header.remaining_due_to_driver
                                ) < 0
                              ) {
                                logger.info(body.header);
                                logger.info(driverData.driver_fingerprint);
                              }
                              logger.info(amount);
                              //? Check the waiting period
                              if (
                                parseFloat(
                                  process.env
                                    .COMISSION_WAITING_PERIOD_BEFORE_SUSPENSION_DAYS
                                ) <= Math.abs(parseFloat(dateDiffChecker))
                              ) {
                                //? Compute the amount left COMISSION-DUE based on who's greater of course.
                                let amount =
                                  parseFloat(body.header.remaining_commission) >
                                  parseFloat(
                                    body.header.remaining_due_to_driver
                                  )
                                    ? Math.ceil(
                                        parseFloat(
                                          body.header.remaining_commission
                                        ) -
                                          parseFloat(
                                            body.header.remaining_due_to_driver
                                          )
                                      )
                                    : Math.ceil(
                                        parseFloat(
                                          body.header.remaining_commission
                                        )
                                      );
                                //! Passed waiting period
                                //? Check if there's any trip in progress.
                                let checkExistingRide = {
                                  taxi_id: driverData.driver_fingerprint,
                                  "ride_state_vars.isRideCompleted_driverSide": false,
                                };
                                //...
                                collectionRidesDeliveryData
                                  .find(checkExistingRide)
                                  .toArray(function (err, tripData) {
                                    if (err) {
                                      logger.info(err);
                                      resPaymentCycle(false);
                                    }
                                    //...
                                    if (
                                      tripData !== undefined &&
                                      tripData.length > 0
                                    ) {
                                      //Found an undone trip
                                      //! Wait for the trip to be completed
                                      logger.info(
                                        `TRIP IN PROGRESS, HOLD SUSPENSION --> Tag: ${driverData.driver_fingerprint.substr(
                                          0,
                                          15
                                        )}`
                                      );
                                      resPaymentCycle(true);
                                    } //No trip in progress
                                    else {
                                      //! SUSPEND THE DRIVER
                                      collectionDrivers_profiles
                                        .find({
                                          driver_fingerprint:
                                            driverData.driver_fingerprint,
                                        })
                                        .toArray(function (err, newDriverData) {
                                          if (err) {
                                            logger.info(err);
                                            resPaymentCycle(false);
                                          }
                                          //...
                                          if (
                                            newDriverData !== undefined &&
                                            newDriverData.length > 0
                                          ) {
                                            //Found a driver data
                                            resolveDate();
                                            //? Append the new suspension to the suspension array
                                            let suspensionInfos_array =
                                              newDriverData[0]
                                                .suspension_infos !==
                                                undefined &&
                                              newDriverData[0]
                                                .suspension_infos !== null
                                                ? newDriverData[0]
                                                    .suspension_infos
                                                : [];
                                            /*suspensionInfos_array.push({
                                              reason: "UNPAID_COMISSION",
                                              state: "SUSPENDED",
                                              amount: amount,
                                              bot_locker: "Junkstem",
                                              date: new Date(chaineDateUTC),
                                            });*/
                                            suspensionInfos_array = [
                                              {
                                                reason: "UNPAID_COMISSION",
                                                state: "SUSPENDED",
                                                amount: amount,
                                                bot_locker: "Junkstem",
                                                date: new Date(chaineDateUTC),
                                              },
                                            ];
                                            //...
                                            // collectionDrivers_profiles.updateOne(
                                            //   {
                                            //     driver_fingerprint:
                                            //       driverData.driver_fingerprint,
                                            //   },
                                            //   {
                                            //     $set: {
                                            //       "operational_state.status":
                                            //         "online", //! PUT OFFLINE - ONLINE TO KEEP RECEIVING REQUESTS.
                                            //       //isDriverSuspended: false, //!DO NOT SUSPEND FOR NOW
                                            //       // suspension_infos:
                                            //       //   suspensionInfos_array,
                                            //     },
                                            //   },
                                            //   function (err, rest) {
                                            //     //? DONE
                                            //     logger.info(
                                            //       `DRIVER SUSPENDED --> Tag: ${driverData.driver_fingerprint.substr(
                                            //         0,
                                            //         15
                                            //       )}`
                                            //     );
                                            //     resPaymentCycle(true);
                                            //   }
                                            // );
                                            resPaymentCycle(true);
                                          } //No driver data found
                                          else {
                                            resPaymentCycle(false);
                                          }
                                        });
                                    }
                                  });
                                logger.info(body.header);
                              } //? Not yet over the waiting period
                              else {
                                //? NOTIFICATION AREA
                                new Promise((resNotify) => {
                                  //? Compute the amount left COMISSION-DUE based on who's greater of course.
                                  let amount =
                                    parseFloat(
                                      body.header.remaining_commission
                                    ) >
                                    parseFloat(
                                      body.header.remaining_due_to_driver
                                    )
                                      ? Math.ceil(
                                          parseFloat(
                                            body.header.remaining_commission
                                          ) -
                                            parseFloat(
                                              body.header
                                                .remaining_due_to_driver
                                            )
                                        )
                                      : Math.ceil(
                                          parseFloat(
                                            body.header.remaining_commission
                                          )
                                        );
                                  //.....
                                  //1. Check the time from the last notification
                                  //? Event name: comission_reminder_comission_drivers
                                  collectionGlobalEvents
                                    .find({
                                      event_name:
                                        "comission_reminder_comission_drivers",
                                      user_fingerprint:
                                        driverData.driver_fingerprint,
                                    })
                                    .toArray(function (err, eventData) {
                                      if (err) {
                                        logger.info(err);
                                        resNotify(false);
                                      }
                                      //...
                                      if (
                                        eventData !== undefined &&
                                        eventData.length > 0
                                      ) {
                                        resolveDate();
                                        //Found a previous event
                                        //? Check the time elapsed after the previous notification
                                        eventData =
                                          eventData[eventData.length - 1];
                                        //...
                                        logger.info(
                                          `Next notification cycle count -> ${
                                            diff_min(
                                              new Date(eventData.date),
                                              new Date(chaineDateUTC)
                                            ).difference
                                          }min`
                                        );
                                        if (
                                          diff_min(
                                            new Date(eventData.date),
                                            new Date(chaineDateUTC)
                                          ).difference >= 30
                                        ) {
                                          //Send a new one
                                          //? Send a fresh notification
                                          logger.info(
                                            `SEND NOTIFICATION -> Tag: ${driverData.driver_fingerprint.substr(
                                              0,
                                              15
                                            )}`
                                          );
                                          sendComission_notificationsDrivers(
                                            driverData,
                                            amount,
                                            Math.abs(dateDiffChecker),
                                            collectionGlobalEvents,
                                            resNotify
                                          );
                                        } //Pass - waiting for the next 30 from the previous notification
                                        else {
                                          logger.info(
                                            `Waiting for the next notification cycle - Tag: ${driverData.driver_fingerprint.substr(
                                              0,
                                              5
                                            )}`
                                          );
                                          resNotify(true);
                                        }
                                      } //No previous event data - send a fresh notification
                                      else {
                                        logger.info(
                                          `SEND NOTIFICATION -> Tag: ${driverData.driver_fingerprint.substr(
                                            0,
                                            15
                                          )}`
                                        );
                                        sendComission_notificationsDrivers(
                                          driverData,
                                          amount,
                                          Math.abs(dateDiffChecker),
                                          collectionGlobalEvents,
                                          resNotify
                                        );
                                      }
                                    });
                                })
                                  .then(
                                    () => {},
                                    () => {}
                                  )
                                  .catch((error) => {
                                    logger.info(error);
                                  });

                                logger.info("WAIT FOR FINAL DDEADLINE");
                                //! Do not update the payment date
                                resPaymentCycle(true);
                              }
                            } //Not reached the threshold already - so update the payment cycle
                            else {
                              //? Unlock the driver if locked --------------------------------
                              new Promise((resUnlock) => {
                                lock_unlock_drivers(
                                  "PAID_COMISSION",
                                  "Junkstem",
                                  false,
                                  driverData,
                                  collectionDrivers_profiles,
                                  resUnlock
                                );
                              })
                                .then(
                                  () => {},
                                  () => {}
                                )
                                .catch((error) => logger.info(error));
                              //?----------------------------------------------------------------------
                              //! Day passed already by 24 hours - update - ADD 7 days
                              //! Update the payment cycle
                              new Promise((resCompute) => {
                                updateNextPaymentDate_cycle(
                                  driverData,
                                  collectionWalletTransactions_logs,
                                  resCompute
                                );
                              })
                                .then(
                                  (result) => {
                                    resPaymentCycle(true);
                                  },
                                  (error) => {
                                    logger.info(error);
                                    resPaymentCycle(false);
                                  }
                                )
                                .catch((error) => {
                                  logger.info(error);
                                  resPaymentCycle(false);
                                });
                            }
                          } //No comission found - Ignore
                          else {
                            //? Unlock the driver if locked --------------------------------
                            new Promise((resUnlock) => {
                              lock_unlock_drivers(
                                "PAID_COMISSION",
                                "Junkstem",
                                false,
                                driverData,
                                collectionDrivers_profiles,
                                resUnlock
                              );
                            })
                              .then(
                                () => {},
                                () => {}
                              )
                              .catch((error) => logger.info(error));
                            //?----------------------------------------------------------------------

                            //! Day passed already by 24 hours - update - ADD 7 days
                            //! Update the payment cycle
                            new Promise((resCompute) => {
                              updateNextPaymentDate_cycle(
                                driverData,
                                collectionWalletTransactions_logs,
                                resCompute
                              );
                            })
                              .then(
                                (result) => {
                                  resPaymentCycle(true);
                                },
                                (error) => {
                                  logger.info(error);
                                  resPaymentCycle(false);
                                }
                              )
                              .catch((error) => {
                                logger.info(error);
                                resPaymentCycle(false);
                              });
                          }
                        } //Error
                        else {
                          resPaymentCycle(false);
                        }
                      } catch (error) {
                        logger.info(error);
                        resPaymentCycle(false);
                      }
                    } else {
                      resPaymentCycle(false);
                    }
                  });
                } //? The date looks good - skip
                else {
                  logger.info("Next payment date not obsolete found!");
                  //? Unlock the driver if locked --------------------------------
                  new Promise((resUnlock) => {
                    lock_unlock_drivers(
                      "PAID_COMISSION",
                      "Junkstem",
                      false,
                      driverData,
                      collectionDrivers_profiles,
                      resUnlock
                    );
                  })
                    .then(
                      () => {},
                      () => {}
                    )
                    .catch((error) => logger.info(error));
                  //?----------------------------------------------------------------------
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
            logger.info(error);
            resolve({
              response:
                "Done checking and updating obsolete next payment dates",
            });
          }
        )
        .catch((error) => {
          logger.info(error);
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

/**
 * @func lock_unlock_drivers
 * Responsible for locking or unlocking drivers basedd on diverse scenarios
 * @param reason: the locking/unlocking reason.
 * @param locker: the admin/bot who performed the locking/unlocking action.
 * @param locking_state: the locking state - true (locked) or false (unlocked)
 * @param driverData: the driver profile's data
 * @param collectionDrivers_profiles: the list of all drivers
 * @param resolve
 */
function lock_unlock_drivers(
  reason,
  locker,
  locking_state,
  driverData,
  collectionDrivers_profiles,
  resolve
) {
  collectionDrivers_profiles
    .find({
      driver_fingerprint: driverData.driver_fingerprint,
    })
    .toArray(function (err, newDriverData) {
      if (err) {
        logger.info(err);
        resolvee(false);
      }
      //...
      if (newDriverData !== undefined && newDriverData.length > 0) {
        //! ONLY UNLOCK IF THE LAST SUSPENSION REASON IS RELATED TO THE UNPAID COMISSION
        if (
          newDriverData !== undefined &&
          newDriverData.length > 0 &&
          newDriverData[0].suspension_infos !== undefined &&
          newDriverData[0].suspension_infos !== null &&
          /UNPAID_COMISSION/i.test(newDriverData[0].suspension_infos[0].reason)
        ) {
          //Found a driver data
          resolveDate();
          //? Append the new suspension to the suspension array
          let suspensionInfos_array =
            newDriverData[0].suspension_infos !== undefined &&
            newDriverData[0].suspension_infos !== null &&
            newDriverData[0].suspension_infos[0] !== undefined &&
            newDriverData[0].suspension_infos[0] !== null
              ? newDriverData[0].suspension_infos[0]
              : [];
          /*suspensionInfos_array.push({
            reason: reason,
            state: locking_state,
            bot_locker: locker,
            date: new Date(chaineDateUTC),
          });*/
          suspensionInfos_array = [
            {
              reason: reason,
              state: locking_state,
              bot_locker: locker,
              date: new Date(chaineDateUTC),
            },
          ];
          //...
          collectionDrivers_profiles.updateOne(
            {
              driver_fingerprint: driverData.driver_fingerprint,
            },
            {
              $set: {
                isDriverSuspended: false,
                suspension_infos: suspensionInfos_array,
              },
            },
            function (err, rest) {
              //? DONE
              logger.info(
                `DRIVER UNLOCKED --> Tag: ${driverData.driver_fingerprint.substr(
                  0,
                  15
                )}`
              );
              resolve(true);
            }
          );
        } //! No proper suspension reason found - pass
        else {
          logger.info("No proper unsuspension reason found, pass.");
          resolve(false);
        }
      } //No driver data found
      else {
        resolve(false);
      }
    });
}

/**
 * @func sendComission_notificationsDrivers
 * Responsible for sending the comission notifications to drivers.
 * @param driverData: the driver's infos
 * @param amount: the actual comission to be paid.
 * @param days_left: the number of days left for the comission to be paid.
 * @param collectionGlobalEvents: the global events list
 * @param resolve
 */
function sendComission_notificationsDrivers(
  driverData,
  amount,
  days_left,
  collectionGlobalEvents,
  resolve
) {
  resolveDate();
  //...
  let messageText =
    days_left < 2
      ? `Hi ${
          driverData.name
        }, you have a pending TaxiConnect comission of N$${amount} to be paid today, you have about ${
          parseInt(
            process.env.COMISSION_WAITING_PERIOD_BEFORE_SUSPENSION_DAYS
          ) - parseInt(days_left)
        } days before a potential service suspension. Kind regards.`
      : `Hi ${driverData.name}, you have a pending TaxiConnect comission of N$${amount} to be paid today, otherwise a service suspension will take please. Kind regards.`;
  //...
  //Send the push notifications
  let message = {
    app_id: process.env.DRIVERS_APP_ID_ONESIGNAL,
    android_channel_id:
      process.env.DRIVERS_ONESIGNAL_CHANNEL_COMISSION_NOTIFICATION,
    priority: 10,
    contents: {
      en: messageText,
    },
    headings: { en: "COMISSION PENDING" },
    content_available: true,
    include_player_ids: [
      driverData.operational_state.push_notification_token !== undefined &&
      driverData.operational_state.push_notification_token !== null &&
      driverData.operational_state.push_notification_token.userId !==
        undefined &&
      driverData.operational_state.push_notification_token.userId !== null
        ? driverData.operational_state.push_notification_token.userId
        : null,
    ],
  };
  logger.info(messageText);
  //Send

  if (/production/i.test(String(process.env.EVIRONMENT))) {
    sendPushUPNotification(message);
  } //Notification development lock
  else {
    logger.warn("Commission push notification development lock!");
  }
  //? SAVE THE EVENT
  let event = {
    event_name: "comission_reminder_comission_drivers",
    user_fingerprint: driverData.driver_fingerprint,
    user_nature: "driver",
    date: new Date(chaineDateUTC),
  };
  collectionGlobalEvents.insertOne(event, function (err, result) {
    if (err) {
      logger.info(err);
      resolve(false);
    }
    //...DONE
    resolve(true);
  });
}

/**
 * @func updateNextPaymentDate_cycle
 * Responsible for updating the next payment cycle date.
 * @param driverData: the driver's data
 * @param collectionWalletTransactions_logs: all the transactions.
 * @param resolve
 */
function updateNextPaymentDate_cycle(
  driverData,
  collectionWalletTransactions_logs,
  resPaymentCycle
) {
  let tmpDate = new Date(
    new Date(chaineDateUTC).getTime() +
      parseFloat(process.env.TAXICONNECT_PAYMENT_FREQUENCY) * 3600 * 1000
  )
    .toDateString()
    .split(" ")[0];
  if (/(mon|tue)/i.test(tmpDate)) {
    //For mondays and tuesdays - add 3 days
    let tmpNextDate = new Date(
      new Date(chaineDateUTC).getTime() +
        (3 + parseFloat(process.env.TAXICONNECT_PAYMENT_FREQUENCY)) *
          24 *
          3600 *
          1000
    ).toISOString();
    //...
    collectionWalletTransactions_logs.updateOne(
      {
        flag_annotation: "startingPoint_forFreshPayouts",
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
        parseFloat(process.env.TAXICONNECT_PAYMENT_FREQUENCY * 24 * 3600 * 1000)
    ).toISOString();
    //?----
    collectionWalletTransactions_logs.updateOne(
      {
        flag_annotation: "startingPoint_forFreshPayouts",
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

function diff_min(dt1, dt2) {
  if (dt2 > dt1) {
    return { difference: Math.abs(dt2 - dt1) / 60000, state: "onTime" };
  } else {
    return { difference: Math.abs(dt2 - dt1) / 60000, state: "late" };
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
    request_type: "scheduled",
    isArrivedToDestination: false,
    "ride_state_vars.isRideCompleted_driverSide": false,
  }; //?Indexed

  collectionRidesDeliveryData
    .find(requestFilter0)
    //!.collation({ locale: "en", strength: 2 })
    .toArray(function (err, dataScheduledRequests) {
      if (err) {
        logger.info(err);
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
                        logger.info(err);
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
                logger.info(error);
                resAge(recordObj);
              });
          });
        });
        //...DONE
        Promise.all(parentPromises)
          .then(
            (scheduledRequestsBulk) => {
              logger.info(scheduledRequestsBulk);
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
                              en: "Hi, you have a scheduled request to attend in about 2 minutes.",
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
                                  logger.info(err);
                                  resRedispatch(false);
                                }
                                //...
                                if (
                                  fullRequestOriginals !== undefined &&
                                  fullRequestOriginals.length > 0
                                ) {
                                  //Found the request mother
                                  let url =
                                    `${
                                      /production/i.test(process.env.EVIRONMENT)
                                        ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                                        : process.env.LOCAL_URL
                                    }` +
                                    ":" +
                                    process.env.DISPATCH_SERVICE_PORT +
                                    "/redispatcherAlreadyParsedRequests";

                                  requestAPI.post(
                                    { url, form: fullRequestOriginals[0] },
                                    function (error, response, body) {
                                      logger.info(body);
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
                                          logger.info(error);
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
                                logger.info(resltRedispatch);
                              },
                              (error) => {
                                logger.info(error);
                              }
                            )
                            .catch((error) => {
                              logger.info(error);
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
                            en: "Hi, you have a scheduled request in about 2 minutes.",
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
                          `${
                            /production/i.test(process.env.EVIRONMENT)
                              ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                              : process.env.LOCAL_URL
                          }` +
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
                                  logger.info(
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
                                      en: "Sorry we couldn't find for you an available ride, please try again.",
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
                                  logger.info(body);
                                  resCompute(true);
                                }
                              } catch (error) {
                                logger.info(error);
                                resCompute(true);
                              }
                            } else {
                              logger.info(error);
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
                      logger.info(fullComputeReslt);
                      resolve({
                        response:
                          "successfully_wentThrough_scheduled_requestsFor_watch",
                      });
                    },
                    (error) => {
                      logger.info(error);
                      resolve({ response: "An error occured", flag: error });
                    }
                  )
                  .catch((error) => {
                    logger.info(error);
                    resolve({ response: "An error occured", flag: error });
                  });
              } //No requests found
              else {
                resolve({ response: "empty_scheduled_requestsFor_watch" });
              }
            },
            (error) => {
              logger.info(error);
              resolve({ response: "An error occured", flag: error });
            }
          )
          .catch((error) => {
            logger.info(error);
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
        logger.info(err);
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
              request.allowed_drivers_see.includes(null) /* ||
              request.allowed_drivers_see.includes(undefined)*/
            ) {
              //? Get dates and convert from milliseconds to seconds
              let dateRequested = new Date(request.date_requested);
              let referenceDate = new Date(chaineDateUTC);
              //...Compute the diff and convert to minutes
              let diff =
                diff_hours(dateRequested, referenceDate).difference * 3600; //? to seconds
              logger.info("SUBSCRIBELESS DIFF --------> ", diff);
              //! Check the wait time
              if (
                diff >=
                process.env.MAXIMUM_WAIT_TIME_BEFORE_GLOBAL_SUBSCRIPTION_SECONDS
              ) {
                //Auto subscribe all
                //Get all the driver's fp of the same city and country
                let driverFilter = {
                  "operational_state.status": { $in: ["offline", "online"] },
                  "operational_state.last_location.city":
                    /false/i.test(request.pickup_location_infos.city) ||
                    request.pickup_location_infos.city === false
                      ? "Windhoek"
                      : request.pickup_location_infos.city,
                  "operational_state.last_location.country": request.country,
                  operation_clearances: {
                    $in: [
                      request.ride_mode.toUpperCase(),
                      `${request.ride_mode[0].toUpperCase()}${request.ride_mode
                        .substr(1)
                        .toLowerCase()}`,
                      request.ride_mode.toLowerCase(),
                    ],
                  },
                  //Filter the drivers based on the vehicle type if provided
                  "operational_state.default_selected_car.vehicle_type":
                    request.carTypeSelected !== undefined &&
                    request.carTypeSelected !== false
                      ? request.carTypeSelected
                      : {
                          $in: [
                            "normalTaxiEconomy",
                            "electricEconomy",
                            "comfortNormalRide",
                            "comfortElectricRide",
                            "luxuryNormalRide",
                            "luxuryElectricRide",
                            "electricBikes",
                            "bikes",
                            "carDelivery",
                            "vanDelivery",
                          ],
                        },
                };
                //...
                collectionDrivers_profiles
                  .find(driverFilter)
                  //!.collation({ locale: "en", strength: 2 })
                  .toArray(function (err, driversFullData) {
                    if (err) {
                      logger.info(err);
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
                      newSubscribedDrivers_array =
                        newSubscribedDrivers_array.filter(
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
                            logger.info(err);
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
                              logger.info(error);
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
              logger.info(error);
              resolve({
                response: "error_watching_subscribeless_requests",
                flag: error,
              });
            }
          )
          .catch((error) => {
            logger.info(error);
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
 * @func updateDrivers_walletCachedData
 * Responsible for reduce the requests time to show the updated wallet infos.
 * @param collectionDrivers_profiles: list of all drivers.
 * @param resolve
 */
function updateDrivers_walletCachedData(collectionDrivers_profiles, resolve) {
  logger.info("Starting drivers wallet refreshing.");
  //1. Get all the drivers
  collectionDrivers_profiles.find({}).toArray(function (err, driverData) {
    if (err) {
      logger.info(err);
      resolve({
        response: "error_fetch_driver_data",
        flag: err,
      });
    }
    //...
    if (driverData !== undefined && driverData.length > 0) {
      logger.info(`Found ${driverData.length} drivers to update.`);
      //Found some driver data
      //2. Compute wallet data
      let parentPromises = driverData.map((driverInfo, index) => {
        return new Promise((resCompute) => {
          let url =
            `${
              /production/i.test(process.env.EVIRONMENT)
                ? `http://${process.env.INSTANCE_PRIVATE_IP}`
                : process.env.LOCAL_URL
            }` +
            ":" +
            process.env.ACCOUNTS_SERVICE_PORT +
            "/getDrivers_walletInfosDeep?user_fingerprint=" +
            driverInfo.driver_fingerprint +
            "&avoidCached_data=true";

          requestAPI(url, function (error, response, body) {
            if (error === null) {
              try {
                resCompute(index);
              } catch (error) {
                resCompute(false);
              }
            } else {
              resCompute(false);
            }
          });
        });
      });
      //DONE
      Promise.all(parentPromises)
        .then(
          (result) => {
            resolve(result);
          },
          (error) => {
            resolve({
              response: "error_compute_driver_wallet",
              flag: error,
            });
          }
        )
        .catch((error) => {
          resolve({
            response: "error_compute_driver_wallet",
            flag: error,
          });
        });
    } //No driver Data
    else {
      resolve({
        response: "Empty_driver_data",
        flag: "Empty",
      });
    }
  });
}

/**
 * @func observeReferralData_andUpdateExpiration
 * Responsible for checking the expiration dates for the referrals and update their respective expiration status.
 * @param collectionReferralsInfos: hold all the referrals.
 * @param collectionPassengers_profiles: hold all the riders data
 * @param collectionDrivers_profiles: hold all the drivers data
 * @param resolve
 */
function observeReferralData_andUpdateExpiration(
  collectionReferralsInfos,
  collectionPassengers_profiles,
  collectionDrivers_profiles,
  resolve
) {
  resolveDate();
  //...
  collectionReferralsInfos
    .find({
      is_referralExpired: false,
    })
    .toArray(function (err, referralData) {
      if (err) {
        resolve(false);
      }
      //..
      if (referralData !== undefined && referralData.length > 0) {
        //Found some referral data
        let parentPromises = referralData.map((refData) => {
          return new Promise((resCompute) => {
            //? Compute the time left in days
            let diff =
              new Date(refData.expiration_time) - new Date(chaineDateUTC);
            //...
            if (diff < 0) {
              //! Already expired
              //UPdate the expiration flag to false
              collectionReferralsInfos.updateOne(
                {
                  referral_fingerprint: refData.referral_fingerprint,
                },
                {
                  $set: {
                    is_referralExpired: true,
                  },
                },
                function (err, result) {
                  if (err) {
                    resCompute(false);
                  }
                  //...
                  //Notify the user
                  new Promise((resNotify) => {
                    //! Check that the user is authentic
                    let collectionToCheck = /rider/i.test(refData.user_nature)
                      ? collectionPassengers_profiles
                      : collectionDrivers_profiles;
                    let finderUserQuery = /rider/i.test(refData.user_nature)
                      ? { user_fingerprint: refData.user_referrer }
                      : { driver_fingerprint: refData.user_referrer };

                    //....
                    collectionToCheck
                      .find(finderUserQuery)
                      .toArray(function (err, refererData) {
                        if (err) {
                          resNotify(false);
                        }
                        //...
                        if (
                          refererData !== undefined &&
                          refererData.length > 0
                        ) {
                          //Found a user
                          //! Notify the rider
                          //Send the push notifications
                          let message = {
                            app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                            android_channel_id:
                              process.env
                                .RIDERS_ONESIGNAL_CHANNEL_AUTOCANCELLED_REQUEST, //Ride - Auto-cancelled group
                            priority: 10,
                            contents: {
                              en: `Hi ${refererData.name}, your referral for the taxi driver ${refData.taxi_number} has expired.`,
                            },
                            headings: { en: "Referral expired" },
                            content_available: true,
                            include_player_ids: [
                              refererData.pushnotif_token !== null &&
                              refererData.pushnotif_token.userId !== undefined
                                ? refererData.pushnotif_token.userId
                                : "false",
                            ],
                          };
                          //Send
                          sendPushUPNotification(message);
                          resNotify(true);
                        } //No user
                        else {
                          resNotify(false);
                        }
                      });
                  })
                    .then()
                    .catch();
                  //...DONE
                  resCompute(true);
                }
              );
            } //? Still valid
            else {
              resCompute(true);
            }
          });
        });
        //Done
        Promise.all(parentPromises)
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            logger.warn(error);
            resolve(false);
          });
      } //No data - done
      else {
        resolve(true);
      }
    });
}

/**
 * @func notifyRidersOf_completedRides
 * Responsible for checking for the completed rides that are not yet confirmed by the rider
 * and notify them accordingly.
 * @param collectionPassengers_profiles: contains all the riders.
 * @param collectionRidesDeliveryData: contains all the requests made.
 * @param collectionGlobalEvents: contains all the events
 * @param antiNotificationSpammerLog: to contain unique fps to avoid notifications spamming.
 * @param resolve
 */
function notifyRidersOf_completedRides(
  collectionPassengers_profiles,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  antiNotificationSpammerLog,
  resolve
) {
  logger.info("Finding trips that are not comfirmed drop off by the riders.");
  let requestFilter = {
    isArrivedToDestination: false,
    "ride_state_vars.isRideCompleted_driverSide": true,
    "ride_state_vars.isRideCompleted_riderSide": false,
  }; //?Indexed

  collectionRidesDeliveryData
    .find(requestFilter)
    .toArray(function (err, tripsData) {
      if (err) {
        logger.warn(err);
        resolve(false);
      }
      //...
      if (tripsData !== undefined && tripsData.length > 0) {
        logger.info("Found some unconfirmed trips by the rider.");
        //Found some rides that are not completed yet
        let parentPromises = tripsData.map((trip) => {
          return new Promise((resCompute) => {
            //Find the passenger
            collectionPassengers_profiles
              .find({ user_fingerprint: trip.client_id })
              .toArray(function (err, riderData) {
                if (err) {
                  logger.warn(err);
                  resCompute(false);
                }
                //...
                if (
                  riderData !== undefined &&
                  riderData.length > 0 &&
                  antiNotificationSpammerLog.has(
                    riderData[0].user_fingerprint
                  ) === false
                ) {
                  //! Save fp in antiSpam
                  antiNotificationSpammerLog.add(riderData[0].user_fingerprint);
                  //!...
                  //? Save the event
                  new Promise((res) => {
                    collectionGlobalEvents.insertOne({
                      event_name: "reminding_rider_toConfirm_dropofff",
                      request_fp: trip.request_fp,
                      driver_fingerprint: trip.taxi_id,
                      user_fingerprint: trip.client_id,
                      date: new Date(chaineDateUTC),
                    });
                    res(true);
                  }).then(
                    () => {},
                    () => {}
                  );

                  //Found the rider
                  riderData = riderData[0];
                  //...
                  new Promise((resNotify) => {
                    //! Notify the rider
                    //Send the push notifications
                    let message = {
                      app_id: process.env.RIDERS_APP_ID_ONESIGNAL,
                      android_channel_id:
                        process.env
                          .RIDERS_ONESIGNAL_CHANNEL_AUTOCANCELLED_REQUEST, //Ride - Auto-cancelled group
                      priority: 10,
                      contents: {
                        en: `Hi ${riderData.name}, don't forget to confirm your drop off.`,
                      },
                      headings: { en: "Your trip is completed" },
                      content_available: true,
                      include_player_ids: [
                        riderData.pushnotif_token !== null &&
                        riderData.pushnotif_token.userId !== undefined
                          ? riderData.pushnotif_token.userId
                          : "false",
                      ],
                    };
                    //Send
                    sendPushUPNotification(message);
                    resNotify(true);
                  })
                    .then()
                    .catch();
                  //...
                  resCompute(riderData.user_fingerprint);
                } //No rider found? Strange
                else {
                  logger.info("No unconfirmed trips by riders.");
                  resCompute(false);
                }
              });
          });
        });
        //...DONE
        Promise.all(parentPromises)
          .then((result) => {
            resolve(result);
          })
          .catch((error) => {
            logger.warn(error);
            resolve(false);
          });
      } //No unconfirmed rides
      else {
        resolve(false);
      }
    });
}

/**
 * MAIN
 */

redisCluster.on("connect", function () {
  logger.info("[*] Redis connected");
  MongoClient.connect(
    process.env.URL_MONGODB,
    /production/i.test(process.env.EVIRONMENT)
      ? {
          tlsCAFile: certFile, //The DocDB cert
          useUnifiedTopology: true,
          useNewUrlParser: true,
        }
      : {
          useUnifiedTopology: true,
          useNewUrlParser: true,
        },
    function (err, clientMongo) {
      if (err) throw err;
      logger.info("[+] Watcher services active.");
      const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
      const collectionPassengers_profiles = dbMongo.collection(
        "passengers_profiles"
      ); //Hold all the passengers profiles
      const collectionRidesDeliveryData = dbMongo.collection(
        "rides_deliveries_requests"
      ); //Hold all the requests made (rides and deliveries)
      const collection_OTP_dispatch_map =
        dbMongo.collection("OTP_dispatch_map");
      const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
      const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
      const collectionWalletTransactions_logs = dbMongo.collection(
        "wallet_transactions_logs"
      ); //Hold all the wallet transactions (exlude rides/deliveries records which are in the rides/deliveries collection)
      collectionReferralsInfos = dbMongo.collection(
        "referrals_information_global"
      ); //Hold all the referrals infos
      //-------------
      app
        .get("/", function (req, res) {
          logger.info("Account services up");
        })
        .use(
          express.json({
            limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
            extended: true,
          })
        )
        .use(
          express.urlencoded({
            limit: process.env.MAX_DATA_BANDWIDTH_EXPRESS,
            extended: true,
          })
        );

      /**
       * MAIN Watcher loop
       * ! ONLY USE PROMISIFIED FUNCTIONS!
       * ! ALWAYS CATCH TROUBLE!
       */
      //! Every 2 min - Light work
      cron.schedule("*/2 * * * *", function () {
        resolveDate();
        //...
        logger.info(`[${chaineDateUTC}] - Watcher loopedi`);

        //? 4. Observe all the subscribeless requests
        /*new Promise((res4) => {
      requestsDriverSubscriber_watcher(
        collectionRidesDeliveryData,
        collectionDrivers_profiles,
        res4
      );
    })
      .then(
        (result) => {
          logger.info(result);
        },
        (error) => {
          logger.info(error);
        }
      )
      .catch((error) => {
        logger.info(error);
      });*/

        //? 5. Auto switch on all the drivers by default
        //! TO BE REVISED
        /*new Promise((res5) => {
        collectionDrivers_profiles
          .find({ "operational_state.status": "offline" })
          .toArray(function (err, driverData) {
            if (err) {
              res5(false);
            }
            //...
            if (driverData !== undefined && driverData.length > 0) {
              //Found offline drivers
              //? Switch online
              collectionDrivers_profiles.updateMany(
                { "operational_state.status": "offline" },
                { $set: { "operational_state.status": "online" } },
                function (err, resultUpdate) {
                  res5(true);
                }
              );
            } else {
              res5(true);
            }
          });
      })
        .then((result) => {
          logger.info(result);
        })
        .catch((error) => {
          logger.info(error);
        });*/

        //? 6. Watch all the referral's expiration dates and updates the corresponding expiration flag.
        new Promise((res6) => {
          observeReferralData_andUpdateExpiration(
            collectionReferralsInfos,
            collectionPassengers_profiles,
            collectionDrivers_profiles,
            res6
          );
        })
          .then(
            (result) => {
              logger.info(result);
            },
            (error) => {
              logger.info(error);
            }
          )
          .catch((error) => {
            logger.info(error);
          });
      });

      //! FOR SUPER HEAVY PROCESSES - 5min
      cron.schedule("*/5 * * * *", function () {
        //? 1. Refresh every driver's wallet
        new Promise((res1) => {
          updateDrivers_walletCachedData(collectionDrivers_profiles, res1);
        })
          .then(
            (result) => {
              logger.info(result);
            },
            (error) => {
              logger.info(error);
            }
          )
          .catch((error) => {
            logger.info(error);
          });
      });

      //! FOR LIGHT HEAVY PROCESSES REQUIRING - 30min
      var antiNotificationSpammerLog = new Set(); //To hold unique user fps to avoid sending many notifications to one user.
      cron.schedule("*/30 * * * *", function () {
        //? 7. Watch all the trips which are not confirmed by the riders yet
        new Promise((res7) => {
          notifyRidersOf_completedRides(
            collectionPassengers_profiles,
            collectionRidesDeliveryData,
            collectionGlobalEvents,
            antiNotificationSpammerLog,
            res7
          );
        })
          .then(
            (result) => {
              logger.info(result);
              antiNotificationSpammerLog = new Set();
            },
            (error) => {
              logger.info(error);
              antiNotificationSpammerLog = new Set();
            }
          )
          .catch((error) => {
            logger.info(error);
            antiNotificationSpammerLog = new Set();
          });
      });

      //! FOR LIGHT HEAVY PROCESSES REQUIRING - 5min
      cron.schedule("*/5 * * * *", function () {
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
              //logger.info(result);
            },
            (error) => {
              //logger.info(error);
            }
          )
          .catch((error) => {
            //logger.info(error);
          });

        //? 2. Keep the drivers next payment date UP TO DATE
        new Promise((res2) => {
          updateNext_paymentDateDrivers(
            collectionDrivers_profiles,
            collectionWalletTransactions_logs,
            collectionRidesDeliveryData,
            collectionGlobalEvents,
            res2
          );
        })
          .then(
            (result) => {
              logger.info(result);
            },
            (error) => {
              logger.info(error);
            }
          )
          .catch((error) => {
            logger.info(error);
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
              logger.info(result);
            },
            (error) => {
              logger.info(error);
            }
          )
          .catch((error) => {
            logger.info(error);
          });

        //? 2. Reinforce the date type for the transaction logs
        /*new Promise((res2) => {
        collectionWalletTransactions_logs
          .find({ date_captured: { $type: "string" } })
          .toArray(function (err, transactionData) {
            if (err) {
              logger.info(err);
              res2(false);
            }
            //...
            if (transactionData !== undefined && transactionData.length > 0) {
              //Found some dirty data
              logger.info("Dirty date with string type found");
              let parentPromises = transactionData.map((transaction) => {
                return new Promise((resCompute) => {
                  collectionWalletTransactions_logs.updateOne(
                    { _id: ObjectId(transaction._id) },
                    {
                      $set: {
                        date_captured: new Date(transaction.date_captured),
                      },
                    },
                    function (err, resultUpdate) {
                      if (err) {
                        logger.info(err);
                        resCompute(false);
                      }
                      //...
                      resCompute(true);
                    }
                  );
                });
              });
              //DONE
              Promise.all(parentPromises)
                .then(
                  (result) => {
                    res2(result);
                  },
                  (error) => {
                    logger.info(error);
                    res2(false);
                  }
                )
                .catch((error) => {
                  logger.info(error);
                  res2(false);
                });
            } //No data found
            else {
              res2(true);
            }
          });
      })
        .then(
          (result) => {
            logger.info(result);
          },
          (error) => {
            logger.info(error);
          }
        )
        .catch((error) => {
          logger.info(error);
        });*/
      });
    }
  );
});

server.listen(process.env.WATCHER_SERVICE_PORT);
