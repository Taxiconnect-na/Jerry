require("dotenv").config();
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
const client = redis.createClient({
  host: process.env.REDIS_HOST,
  port: process.env.REDIS_PORT,
});
const redisGet = promisify(client.get).bind(client);

var chaineDateUTC = null;
var dateObject = null;
const moment = require("moment");
const e = require("express");

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
 * @func parseRequestData
 * @param resolve
 * @param inputData: received request data straight from the rider's device.
 * Responsible for transforming the ride or delivery received data into a more refined
 * supported internal one.
 */
function parseRequestData(inputData, resolve) {
  resolveDate();
  //Check data consistency
  if (
    inputData.destinationData !== undefined &&
    inputData.destinationData.passenger1Destination !== undefined &&
    inputData.fareAmount !== undefined &&
    inputData.pickupData !== undefined &&
    inputData.pickupData.coordinates !== undefined &&
    inputData.user_fingerprint !== undefined &&
    inputData.rideType !== undefined
  ) {
    //Valid input
    let parsedData = {};
    let tmpDate = new Date();
    //Complete unnested data
    parsedData.client_id = inputData.user_fingerprint;
    parsedData.request_fp = dateObject.unix();
    //Compute the request fp
    let uniqueString =
      inputData.user_fingerprint +
      "-" +
      inputData.passengersNo +
      "-" +
      chaineDateUTC;
    new Promise((res) => {
      generateUniqueFingerprint(uniqueString, false, res);
    })
      .then(
        (result) => {
          console.log("here res");
          parsedData.request_fp = result; //Update with the fingerprint;
        },
        (error) => {
          console.log(error);
          parsedData.request_fp =
            parsedData.user_fingerprint + dateObject.unix(); //Make a fingerprint out of the timestamp
        }
      )
      .finally(() => {
        console.log("here");
        //Continue
        parsedData.taxi_id = false;
        parsedData.payment_method = inputData.paymentMethod
          .trim()
          .toUpperCase();
        parsedData.connect_type = inputData.connectType;
        parsedData.ride_mode = inputData.rideType;
        parsedData.fare = inputData.fareAmount;
        parsedData.passengers_number = inputData.passengersNo;
        parsedData.request_type = /now/i.test(inputData.timeScheduled)
          ? "immediate"
          : "scheduled";
        parsedData.allowed_drivers_see = []; //LIST OF THE DRIVERS WHO CAN SEE THE REQUEST IN THEIR APP.
        //Resolve the pickup time
        new Promise((res1) => {
          if (/immediate/i.test(parsedData.request_type)) {
            //Now request - now date
            parsedData.wished_pickup_time = chaineDateUTC;
            res1(true);
          } //Scheduled
          else {
            if (/today/i.test(inputData.timeScheduled)) {
              //For today
              //Generate a date mockup for today
              //Timestring format of eg. Today at 14:30 - EXTREMELY IMPORTANT
              let specifiedTIme = inputData.timeScheduled
                .split(" ")[2]
                .split(":");
              let tmpDateString =
                dateObject.year() +
                "-" +
                (dateObject.month() + 1) +
                "-" +
                dateObject.date() +
                " " +
                specifiedTIme[0] +
                ":" +
                specifiedTIme[1] +
                ":00";
              //...
              parsedData.wished_pickup_time = tmpDateString;
              res1(true);
            } //TOmorrow
            else {
              //Generate a date mockup for tomorrow
              //Timestring format of eg. Today at 14:30 - EXTREMELY IMPORTANT
              let specifiedTIme = inputData.timeScheduled
                .split(" ")[2]
                .split(":");
              let tmpDateString = new Date(
                dateObject.year() +
                  "-" +
                  (dateObject.month() + 1) +
                  "-" +
                  dateObject.date() +
                  " " +
                  specifiedTIme[0] +
                  ":" +
                  specifiedTIme[1] +
                  ":00"
              );
              tmpDateString = tmpDateString.getTime();
              tmpDateString += 86400000; //Add a day in ms
              tmpDateString = moment(tmpDateString);
              tmpDateString =
                tmpDateString.year() +
                "-" +
                (tmpDateString.month() + 1) +
                "-" +
                tmpDateString.date() +
                " " +
                tmpDateString.hour() +
                ":" +
                tmpDateString.minute() +
                ":" +
                tmpDateString.second();
              //...
              parsedData.wished_pickup_time = tmpDateString;
              res1(true);
            }
          }
        })
          .then(
            () => {},
            () => {}
          )
          .finally(() => {
            //COntinue
            parsedData.country = inputData.country;
            //Compute the simplified fingerprint
            new Promise((res2) => {
              generateUniqueFingerprint(uniqueString, "md5", res2);
            })
              .then(
                (result) => {
                  parsedData.trip_simplified_id = result;
                },
                (erro) => {
                  parsedData.trip_simplified_id =
                    parsedData.client_id.substring(0, 15) +
                    dateObject.milliseconds();
                }
              )
              .finally(() => {
                //continue
                parsedData.carTypeSelected = inputData.carTypeSelected;
                parsedData.isAllGoingToSameDestination =
                  inputData.isAllGoingToSameDestination;
                parsedData.isArrivedToDestination = false;
                parsedData.date_dropoff = false;
                parsedData.date_pickup = false;
                parsedData.date_requested = chaineDateUTC;
                parsedData.date_accepted = false;
                //Parse nested data
                //1. Ride state vars
                parsedData.ride_state_vars = {
                  isAccepted: false,
                  inRideToDestination: false,
                  isRideCompleted_driverSide: false,
                  isRideCompleted_riderSide: false,
                  rider_driverRating: "notYet",
                };
                //2.Pickup location infos
                parsedData.pickup_location_infos = {
                  pickup_type: inputData.naturePickup,
                  coordinates: {
                    latitude: inputData.pickupData.coordinates[0],
                    longitude: inputData.pickupData.coordinates[1],
                  },
                  location_name: inputData.pickupData.location_name,
                  street_name: inputData.pickupData.street_name,
                  suburb: false,
                  pickup_note: inputData.pickupNote,
                  city: inputData.pickupData.city,
                };
                //Auto complete the suburb
                new Promise((res3) => {
                  let url =
                    process.env.LOCAL_URL +
                    ":" +
                    process.env.PRICING_SERVICE_PORT +
                    "/getCorrespondingSuburbInfos?location_name=" +
                    inputData.pickupData.location_name +
                    "&street_name=" +
                    inputData.pickupData.street_name +
                    "&city=" +
                    inputData.pickupData.city +
                    "&country=" +
                    inputData.country +
                    "&latitude=" +
                    inputData.pickupData.coordinates[0] +
                    "&longitude=" +
                    inputData.pickupData.coordinates[1] +
                    "&user_fingerprint=" +
                    inputData.user_fingerprint;
                  requestAPI(url, function (error, response, body) {
                    if (error === null) {
                      try {
                        body = JSON.parse(body);
                        parsedData.pickup_location_infos.suburb = body.suburb;
                        res3(true);
                      } catch (error) {
                        res3(false);
                      }
                    } else {
                      res3(false);
                    }
                  });
                })
                  .then(
                    () => {},
                    () => {}
                  )
                  .finally(() => {
                    //Continue
                    //3. Delivery infos
                    parsedData.delivery_infos = {
                      receiverName_delivery: inputData.receiverName_delivery,
                      receiverPhone_delivery: inputData.receiverPhone_delivery,
                    };
                    //4. Rider infos
                    parsedData.rider_infos = {
                      actualRider: /^someonelese$/i.test(inputData.actualRider)
                        ? "someoneelse"
                        : "me",
                      actualRiderPhone_number:
                        inputData.actualRiderPhone_number,
                    };
                    console.log("DESTInation data autoc");
                    //5. DESTINATION DATA
                    let cleanInputData = { destinationData: null };
                    //Resolve destination infos
                    new Promise((res5) => {
                      console.log("Inside");
                      cleanInputData.destinationData = [];
                      let tmpSchemaArray = [1, 2, 3, 4]; //Just for iterations, nothing more, instead of using for loop
                      if (inputData.passengersNo > 1) {
                        //Many passengers
                        //Check if all going to the same destination
                        if (inputData.isAllGoingToSameDestination) {
                          //yes
                          tmpSchemaArray.map((element, index) => {
                            cleanInputData.destinationData.push({
                              passenger_number_id: index + 1,
                              dropoff_type: false,
                              coordinates: {
                                latitude:
                                  inputData.destinationData
                                    .passenger1Destination.coordinates[1],
                                longitude:
                                  inputData.destinationData
                                    .passenger1Destination.coordinates[0],
                              },
                              location_name:
                                inputData.destinationData.passenger1Destination
                                  .location_name !== undefined &&
                                inputData.destinationData.passenger1Destination
                                  .location_name !== false
                                  ? inputData.destinationData
                                      .passenger1Destination.location_name
                                  : false,
                              street_name:
                                inputData.destinationData.passenger1Destination
                                  .street !== undefined &&
                                inputData.destinationData.passenger1Destination
                                  .street !== false
                                  ? inputData.destinationData
                                      .passenger1Destination.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                          });
                          //Done
                          res5(cleanInputData);
                        } //Independent destinations,.....:(
                        else {
                          if (inputData.passengersNo == 2) {
                            //Passenger1
                            let passenger1Data =
                              inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger1Data.coordinates[1],
                                longitude: passenger1Data.coordinates[0],
                              },
                              location_name:
                                passenger1Data.location_name !== undefined &&
                                passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name:
                                passenger1Data.street !== undefined &&
                                passenger1Data.street !== false
                                  ? passenger1Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data =
                              inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger2Data.coordinates[1],
                                longitude: passenger2Data.coordinates[0],
                              },
                              location_name:
                                passenger2Data.location_name !== undefined &&
                                passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name:
                                passenger2Data.street !== undefined &&
                                passenger2Data.street !== false
                                  ? passenger2Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Done
                            res5(cleanInputData);
                          } else if (inputData.passengersNo == 3) {
                            //Passenger1
                            let passenger1Data =
                              inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger1Data.coordinates[1],
                                longitude: passenger1Data.coordinates[0],
                              },
                              location_name:
                                passenger1Data.location_name !== undefined &&
                                passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name:
                                passenger1Data.street !== undefined &&
                                passenger1Data.street !== false
                                  ? passenger1Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data =
                              inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger2Data.coordinates[1],
                                longitude: passenger2Data.coordinates[0],
                              },
                              location_name:
                                passenger2Data.location_name !== undefined &&
                                passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name:
                                passenger2Data.street !== undefined &&
                                passenger2Data.street !== false
                                  ? passenger2Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger3
                            let passenger3Data =
                              inputData.destinationData.passenger3Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 3,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger3Data.coordinates[1],
                                longitude: passenger3Data.coordinates[0],
                              },
                              location_name:
                                passenger3Data.location_name !== undefined &&
                                passenger3Data.location_name !== false
                                  ? passenger3Data.location_name
                                  : false,
                              street_name:
                                passenger3Data.street !== undefined &&
                                passenger3Data.street !== false
                                  ? passenger3Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Done
                            res5(cleanInputData);
                          } else if (inputData.passengersNo == 4) {
                            console.log("Foudn 4");
                            //Passenger1
                            let passenger1Data =
                              inputData.destinationData.passenger1Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 1,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger1Data.coordinates[1],
                                longitude: passenger1Data.coordinates[0],
                              },
                              location_name:
                                passenger1Data.location_name !== undefined &&
                                passenger1Data.location_name !== false
                                  ? passenger1Data.location_name
                                  : false,
                              street_name:
                                passenger1Data.street !== undefined &&
                                passenger1Data.street !== false
                                  ? passenger1Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger2
                            let passenger2Data =
                              inputData.destinationData.passenger2Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 2,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger2Data.coordinates[1],
                                longitude: passenger2Data.coordinates[0],
                              },
                              location_name:
                                passenger2Data.location_name !== undefined &&
                                passenger2Data.location_name !== false
                                  ? passenger2Data.location_name
                                  : false,
                              street_name:
                                passenger2Data.street !== undefined &&
                                passenger2Data.street !== false
                                  ? passenger2Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger3
                            let passenger3Data =
                              inputData.destinationData.passenger3Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 3,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger3Data.coordinates[1],
                                longitude: passenger3Data.coordinates[0],
                              },
                              location_name:
                                passenger3Data.location_name !== undefined &&
                                passenger3Data.location_name !== false
                                  ? passenger3Data.location_name
                                  : false,
                              street_name:
                                passenger3Data.street !== undefined &&
                                passenger3Data.street !== false
                                  ? passenger3Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Passenger4
                            let passenger4Data =
                              inputData.destinationData.passenger4Destination;
                            cleanInputData.destinationData.push({
                              passenger_number_id: 4,
                              dropoff_type: false,
                              coordinates: {
                                latitude: passenger4Data.coordinates[1],
                                longitude: passenger4Data.coordinates[0],
                              },
                              location_name:
                                passenger4Data.location_name !== undefined &&
                                passenger4Data.location_name !== false
                                  ? passenger4Data.location_name
                                  : false,
                              street_name:
                                passenger4Data.street !== undefined &&
                                passenger4Data.street !== false
                                  ? passenger4Data.street
                                  : false,
                              suburb: false,
                              state: false,
                              city: inputData.pickupData.city,
                            });
                            //Done
                            res5(cleanInputData);
                          }
                        }
                      } //Single passenger
                      else {
                        cleanInputData.destinationData.push({
                          passenger_number_id: 1,
                          dropoff_type: false,
                          coordinates: {
                            latitude:
                              inputData.destinationData.passenger1Destination
                                .coordinates[1],
                            longitude:
                              inputData.destinationData.passenger1Destination
                                .coordinates[0],
                          },
                          location_name:
                            inputData.destinationData.passenger1Destination
                              .location_name !== undefined &&
                            inputData.destinationData.passenger1Destination
                              .location_name !== false
                              ? inputData.destinationData.passenger1Destination
                                  .location_name
                              : false,
                          street_name:
                            inputData.destinationData.passenger1Destination
                              .street !== undefined &&
                            inputData.destinationData.passenger1Destination
                              .street !== false
                              ? inputData.destinationData.passenger1Destination
                                  .street
                              : false,
                          suburb: false,
                          state: false,
                          city: inputData.pickupData.city,
                        });
                        res5(cleanInputData);
                      }
                    }).then(
                      (reslt) => {
                        //DONE
                        let url =
                          process.env.LOCAL_URL +
                          ":" +
                          process.env.PRICING_SERVICE_PORT +
                          "/manageAutoCompleteSuburbsAndLocationTypes";

                        requestAPI.post(
                          {
                            url,
                            form: {
                              locationData: reslt.destinationData,
                              user_fingerprint: inputData.user_fingerprint,
                            },
                          },
                          function (error, response, body) {
                            console.log(body);
                            if (error === null) {
                              try {
                                body = JSON.parse(body);
                                if (body.response !== undefined) {
                                  //Error
                                  resolve(false);
                                } //SUCCESS
                                else {
                                  //Update the destination data
                                  parsedData.destinationData = body;
                                  //DONE
                                  resolve(parsedData);
                                }
                              } catch (error) {
                                console.log(error);
                                resolve(false);
                              }
                            } else {
                              resolve(false);
                            }
                          }
                        );
                      },
                      (error) => {
                        console.log(error);
                        resolve(false);
                      }
                    );
                  });
              });
          });
      });
  } //Invalid data
  else {
    resolve(false);
  }
}

/**
 * @func intitiateStagedDispatch
 * @param resolve
 * @param snapshotTripInfos: this will contain basic review of the trip, specifically the fare, passengers number, ride type (ride/delivery),
 * @param collectionRidesDeliveryData: rides and delivery collection
 * @param collectionDrivers_profiles: drivers profiles collection
 * connect type (connectMe/connectUS).
 * Responsible for sending notifications to drivers and a staged manner:
 * * Closest first (1 driver)
 * after 1min30'' of not accepting
 * * increase the radius (3 drivers)
 * after 1 min of not accepting
 * * increase the radius (5 drivers)
 * after 1 min of not accepting
 * * increase the radius (all the rest)
 * * after 20 min of not accepting - AUTO cancel request
 */
function intitiateStagedDispatch(
  snapshotTripInfos,
  collectionDrivers_profiles,
  collectionRidesDeliveryData,
  resolve
) {
  //Get the list of all the closest drivers
  let url =
    process.env.LOCAL_URL +
    ":" +
    process.env.MAP_SERVICE_PORT +
    "/getVitalsETAOrRouteInfos2points?user_fingerprint=" +
    snapshotTripInfos.user_fingerprint +
    "&org_latitude=" +
    snapshotTripInfos.org_latitude +
    "&org_longitude=" +
    snapshotTripInfos.org_longitude +
    "&ride_type=" +
    snapshotTripInfos.ride_type +
    "&city=" +
    snapshotTripInfos.city +
    "&country=" +
    snapshotTripInfos.country +
    "&list_limit=all";
  requestAPI(url, function (error, response, body) {
    console.log(body);
    if (error === null) {
      try {
        body = JSON.parse(body);
        if (body.response !== undefined || response === false) {
          //Error getting the list - send to all drivers
          new Promise((res) => {
            sendStagedNotificationsDrivers(
              false,
              snapshotTripInfos,
              collectionDrivers_profiles,
              collectionRidesDeliveryData,
              res
            );
          }).then(
            (result) => {
              console.log(result);
              resolve(result);
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        } //Successfully got the list
        else {
          new Promise((res) => {
            sendStagedNotificationsDrivers(
              body,
              snapshotTripInfos,
              collectionDrivers_profiles,
              collectionRidesDeliveryData,
              res
            );
          }).then(
            (result) => {
              console.log(result);
              resolve(result);
            },
            (error) => {
              console.log(error);
              resolve(false);
            }
          );
        }
      } catch (error) {
        console.log(error);
        //Error getting the list of closest drivers - send to all the drivers
        new Promise((res) => {
          sendStagedNotificationsDrivers(
            false,
            snapshotTripInfos,
            collectionDrivers_profiles,
            collectionRidesDeliveryData,
            res
          );
        }).then(
          (result) => {
            console.log(result);
            resolve(result);
          },
          (error) => {
            console.log(error);
            resolve(false);
          }
        );
      }
    } else {
      //Error getting the list of closest drivers - send to all the drivers
      new Promise((res) => {
        sendStagedNotificationsDrivers(
          false,
          snapshotTripInfos,
          collectionDrivers_profiles,
          collectionRidesDeliveryData,
          res
        );
      }).then(
        (result) => {
          console.log(result);
          resolve(result);
        },
        (error) => {
          console.log(error);
          resolve(false);
        }
      );
    }
  });
}

/**
 * @func sendStagedNotificationsDrivers
 * @param resolve
 * @param collectionRidesDeliveryData: rides and delivery collection
 * @param collectionDrivers_profiles: drivers profiles collection
 * @param snapshotTripInfos: brief trip infos
 * @param closestDriversList: the list of all the closest drivers OR false if failed to get the list,
 * in the last scenario, dispatch to all the online drivers.
 * Responsible for EXECUTING the staged sending of notifications and adding correspoding drivers to
 * the allowed_drivers_see list of the request so that they can access the trip from their app if not
 * yet accepted.
 * ? Closest first (1 driver)
 * after 1min30'' of not accepting
 * ? increase the radius (3 drivers)
 * after 1 min of not accepting
 * ? increase the radius (5 drivers)
 * after 1 min of not accepting
 * ? increase the radius (all the rest)
 * ! after 20 min of not accepting - AUTO cancel request
 */
function sendStagedNotificationsDrivers(
  closestDriversList,
  snapshotTripInfos,
  collectionDrivers_profiles,
  collectionRidesDeliveryData,
  resolve
) {
  if (closestDriversList === false || closestDriversList[0] === undefined) {
    //Send to all the drivers
    //1. Filter the drivers based on trip requirements
    //2. Register their fp in the allowed_drivers_see on the requests
    //3. Send the notifications to each selected one.
    let driverFilter = {
      "operational_state.status": { $regex: /online/i },
      "operational_state.last_location.city": {
        $regex: snapshotTripInfos.city,
        $options: "i",
      },
      "operational_state.last_location.country": {
        $regex: snapshotTripInfos.country,
        $options: "i",
      },
      operation_clearances: {
        $regex: snapshotTripInfos.ride_type,
        $options: "i",
      },
      //Filter the drivers based on the vehicle type if provided
      "operational_state.default_selected_car.vehicle_type": {
        $regex: snapshotTripInfos.vehicle_type,
        $options: "i",
      },
    };
    //..
    collectionDrivers_profiles
      .find(driverFilter)
      .toArray(function (err, driversProfiles) {
        //Filter the drivers based on their car's maximum capacity (the amount of passengers it can handle)
        //They can receive 3 additional requests on top of the limit of sits in their selected cars.
        driversProfiles = driversProfiles.filter(
          (dData) =>
            dData.operational_state.accepted_requests_infos
              .total_passengers_number <=
            dData.operational_state.default_selected_car.max_passengers + 3
        );

        //...Register the drivers fp so that thei can see tne requests
        let driversFp = driversProfiles.map((data) => data.driver_fp); //Drivers fingerprints
        let driversPushNotif_token = driversProfiles.map(
          (data) => data.push_notification_token
        ); //Push notification token
        collectionRidesDeliveryData.updateOne(
          { request_fp: snapshotTripInfos.request_fp },
          { $set: { allowed_drivers_see: driversFp } },
          function (err, reslt) {
            //Send the push notifications
            let message = {
              app_id: "1e2207f0-99c2-4782-8813-d623bd0ff32a",
              android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? "4ff13528-5fbb-4a98-9925-00af10aaf9fb"
                : "4ff13528-5fbb-4a98-9925-00af10aaf9fb", //Ride or delivery channel
              priority: 10,
              contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? {
                    en:
                      "You have a new ride request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " +
                          snapshotTripInfos.pickup_suburb.toUpperCase() +
                          " to " +
                          snapshotTripInfos.destination_suburb.toUpperCase() +
                          ". Click here for more details."
                        : "near your location, click here for more details."),
                  }
                : {
                    en:
                      "You have a new delivery request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " +
                          snapshotTripInfos.pickup_suburb.toUpperCase() +
                          " to " +
                          snapshotTripInfos.destination_suburb.toUpperCase() +
                          ". Click here for more details."
                        : "near your location, click here for more details."),
                  },
              headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                : { en: "New delivery request, N$" + snapshotTripInfos.fare },
              include_player_ids: driversPushNotif_token,
            };
            //Send
            sendPushUPNotification(message);
            resolve({ response: "successfully_dispatched" });
          }
        );
      });
  } //Staged send
  else {
    console.log("Staged send");
    //...Register the drivers fp so that thei can see tne requests
    let driversFp = closestDriversList.map((data) => data.driver_fingerprint); //Drivers fingerprints
    let driversPushNotif_token = closestDriversList.map(
      (data) => data.push_notification_token
    ); //Push notification token

    console.log("REQUEST TICKET " + snapshotTripInfos.request_fp);
    new Promise((res) => {
      //Asnwer
      console.log(
        "[1] Closest drivers ---ticket: " + snapshotTripInfos.request_fp
      );
      new Promise((res5) => {
        registerAllowedDriversForRidesAndNotify(
          snapshotTripInfos.request_fp,
          snapshotTripInfos,
          { drivers_fp: driversFp, pushNotif_tokens: driversPushNotif_token },
          collectionRidesDeliveryData,
          1,
          res5
        );
      }).then(
        (reslt) => {
          if (/staged_dispatch_successfull/i.test(reslt.response)) {
            //CONCLUDE THE REQUEST
            resolve({ response: "successfully_dispatched" });
            //Proceed with the staged dispatch
            //1. Wait for 1 min 30'' - in ms
            console.log(
              "Waiting for 1min 30. ---ticket: " + snapshotTripInfos.request_fp
            );
            setTimeout(() => {
              new Promise((res2) => {
                console.log(
                  "[2] Less closest after 1min 30. ---ticket: " +
                    snapshotTripInfos.request_fp
                );
                new Promise((res6) => {
                  registerAllowedDriversForRidesAndNotify(
                    snapshotTripInfos.request_fp,
                    snapshotTripInfos,
                    {
                      drivers_fp: driversFp,
                      pushNotif_tokens: driversPushNotif_token,
                    },
                    collectionRidesDeliveryData,
                    2,
                    res6
                  );
                }).then(
                  (reslt) => {
                    if (/staged_dispatch_successfull/i.test(reslt.response)) {
                      //Proceed with the staged dispatch
                      //Allow these drivers to see the requests athen resolve 2
                      res(true); //Conclude promise 1
                      res2(true); //Conclude promise 2
                    } //End the staged dispatch - done
                    else {
                      console.log(
                        "DONE STAGED DISPATCH  ---ticket: " +
                          snapshotTripInfos.request_fp
                      );
                      resolve({ response: "successfully_dispatched" });
                    }
                  },
                  (error) => {
                    console.log(
                      "DONE STAGED DISPATCH  ---ticket: " +
                        snapshotTripInfos.request_fp
                    );
                    //Error - but notify dispatch as successfull
                    resolve({ response: "successfully_dispatched" });
                  }
                );
              })
                .then()
                .finally(() => {
                  //2. Wait for 1 min
                  console.log(
                    "Waiting for 1min ---ticket: " +
                      snapshotTripInfos.request_fp
                  );
                  setTimeout(() => {
                    new Promise((res3) => {
                      console.log(
                        "[3] Less*2 closest after 1 min. ---ticket: " +
                          snapshotTripInfos.request_fp
                      );
                      new Promise((res7) => {
                        registerAllowedDriversForRidesAndNotify(
                          snapshotTripInfos.request_fp,
                          snapshotTripInfos,
                          {
                            drivers_fp: driversFp,
                            pushNotif_tokens: driversPushNotif_token,
                          },
                          collectionRidesDeliveryData,
                          3,
                          res7
                        );
                      }).then(
                        (reslt) => {
                          if (
                            /staged_dispatch_successfull/i.test(reslt.response)
                          ) {
                            //Proceed with the staged dispatch
                            //Allow these drivers to see the requests athen resolve 3
                            res3(true); //Conclude promise 3
                          } //End the staged dispatch - done
                          else {
                            console.log(
                              "DONE STAGED DISPATCH  ---ticket: " +
                                snapshotTripInfos.request_fp
                            );
                            resolve({ response: "successfully_dispatched" });
                          }
                        },
                        (error) => {
                          console.log(
                            "DONE STAGED DISPATCH  ---ticket: " +
                              snapshotTripInfos.request_fp
                          );
                          //Error - but notify dispatch as successfull
                          resolve({ response: "successfully_dispatched" });
                        }
                      );
                    })
                      .then()
                      .finally(() => {
                        //3. Wait for 1 min
                        console.log(
                          "Waiting for 1min ---ticket: " +
                            snapshotTripInfos.request_fp
                        );
                        setTimeout(() => {
                          new Promise((res4) => {
                            console.log(
                              "[4] Less*3 closest after 1 min. ---ticket: " +
                                snapshotTripInfos.request_fp
                            );
                            new Promise((res8) => {
                              registerAllowedDriversForRidesAndNotify(
                                snapshotTripInfos.request_fp,
                                snapshotTripInfos,
                                {
                                  drivers_fp: driversFp,
                                  pushNotif_tokens: driversPushNotif_token,
                                },
                                collectionRidesDeliveryData,
                                4,
                                res8
                              );
                            }).then(
                              (reslt) => {
                                if (
                                  /staged_dispatch_successfull/i.test(
                                    reslt.response
                                  )
                                ) {
                                  //Proceed with the staged dispatch
                                  //Allow these drivers to see the requests athen resolve 4
                                  res4(true); //Conclude promise 4
                                } //End the staged dispatch - done
                                else {
                                  console.log(
                                    "DONE STAGED DISPATCH  ---ticket: " +
                                      snapshotTripInfos.request_fp
                                  );
                                  resolve({
                                    response: "successfully_dispatched",
                                  });
                                }
                              },
                              (error) => {
                                console.log(
                                  "DONE STAGED DISPATCH  ---ticket: " +
                                    snapshotTripInfos.request_fp
                                );
                                //Error - but notify dispatch as successfull
                                resolve({
                                  response: "successfully_dispatched",
                                });
                              }
                            );
                          })
                            .then()
                            .finally(() => {
                              console.log(
                                "DONE STAGED DISPATCH  ---ticket: " +
                                  snapshotTripInfos.request_fp
                              );
                              //Done FULL STAGED DISPATCH!
                              resolve({ response: "successfully_dispatched" });
                            });
                        }, 1 * 60 * 1000);
                      });
                  }, 1 * 60 * 1000);
                });
            }, 90 * 1000);
          } //End the staged dispatch - done
          else {
            resolve({ response: "successfully_dispatched" });
          }
        },
        (error) => {
          //Error - but notify dispatch as successfull
          resolve({ response: "successfully_dispatched" });
        }
      );
    });
  }
}

/**
 * @func registerAllowedDriversForRidesAndNotify
 * @param resolve
 * @param collectionRidesDeliveryData: rides and deliveries collection
 * @param driversSnap: 2 lists, one of drivers fingerprints(drivers_fp), the other for their push notification tokens(pushNotif_tokens).
 * @param request_fp: request's fingerprint
 * @param snapshotTripInfos: brief trip infos
 * @param incrementalStage: number indicating which driver circle to dispatch to (from 1->4) - default:1 (closest drivers)
 * Responsible for adding drivers to the list of those who can see the requests
 * and send out push notification after.
 * Also CHECK IF THE REQUEST WAS ALREADY ACCEPTED, if so end the staged dispatch process.
 * Also CHECK IF THE NUMBER OF CLOSEST DRIVERS ALLOW the incremental stage numer.
 */
function registerAllowedDriversForRidesAndNotify(
  request_fp,
  snapshotTripInfos,
  driversSnap,
  collectionRidesDeliveryData,
  incrementalStage = 1,
  resolve
) {
  //Fit back to boundary.limit max
  if (incrementalStage > 4) {
    incrementalStage = 4;
  }
  //Staged boundaries
  let stagedBoundaries = {
    1: { start: 0, end: 1 },
    2: { start: 1, end: 4 },
    3: { start: 4, end: 9 },
    4: { start: 9, end: false },
  };
  //Slice the drivers fp and push notif tokens to be within the boundaries
  console.log(driversSnap.drivers_fp);
  driversSnap.drivers_fp = driversSnap.drivers_fp.slice(
    stagedBoundaries[incrementalStage].start,
    stagedBoundaries[incrementalStage].end === false
      ? driversSnap.drivers_fp.length
      : stagedBoundaries[incrementalStage].end
  );
  driversSnap.pushNotif_tokens = driversSnap.pushNotif_tokens.slice(
    stagedBoundaries[incrementalStage].start,
    stagedBoundaries[incrementalStage].end === false
      ? driversSnap.pushNotif_tokens.length
      : stagedBoundaries[incrementalStage].end
  );
  console.log(driversSnap.drivers_fp);
  //Check whether the request was accepted or not.
  let checkAcceptance = {
    "ride_state_vars.isAccepted": false,
    request_fp: request_fp,
  };
  collectionRidesDeliveryData
    .find(checkAcceptance)
    .toArray(function (err, requestInfos) {
      if (requestInfos.length > 0 && driversSnap.drivers_fp.length > 0) {
        //Not yet accepted
        requestInfos = requestInfos[0];
        //...
        //Add the drivers' fingerprints to the allowed_drivers_see
        let updatedAllowedSee = {
          $set: {
            allowed_drivers_see: [
              ...new Set([
                ...requestInfos.allowed_drivers_see,
                ...driversSnap.drivers_fp,
              ]),
            ],
          },
        };
        collectionRidesDeliveryData.updateOne(
          checkAcceptance,
          updatedAllowedSee,
          function (err, reslt) {
            console.log(err);
            //Send notifications to the newly registered drivers to the allowed_drivers_see
            //Send the push notifications
            let message = {
              app_id: "1e2207f0-99c2-4782-8813-d623bd0ff32a",
              android_channel_id: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? "4ff13528-5fbb-4a98-9925-00af10aaf9fb"
                : "4ff13528-5fbb-4a98-9925-00af10aaf9fb", //Ride or delivery channel
              priority: 10,
              contents: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? {
                    en:
                      "You have a new ride request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " +
                          snapshotTripInfos.pickup_suburb.toUpperCase() +
                          " to " +
                          snapshotTripInfos.destination_suburb.toUpperCase() +
                          ". Click here for more details."
                        : "near your location, click here for more details."),
                  }
                : {
                    en:
                      "You have a new delivery request " +
                      (snapshotTripInfos.pickup_suburb !== false
                        ? "from " +
                          snapshotTripInfos.pickup_suburb.toUpperCase() +
                          " to " +
                          snapshotTripInfos.destination_suburb.toUpperCase() +
                          ". Click here for more details."
                        : "near your location, click here for more details."),
                  },
              headings: /RIDE/i.test(snapshotTripInfos.ride_type)
                ? { en: "New ride request, N$" + snapshotTripInfos.fare }
                : { en: "New delivery request, N$" + snapshotTripInfos.fare },
              include_player_ids: driversSnap.drivers_fp,
            };
            //Send
            sendPushUPNotification(message);
            //...
            resolve({ response: "staged_dispatch_successfull" });
          }
        );
      } //Request already accepted
      else {
        resolve({ response: "request_already_accepted" });
      }
    });
}

/**
 * @func confirmDropoff_fromRider_side
 * @param resolve
 * @param dropOffMeta_bundle: contains all the necessary information about the rating (rating_score, compliments array, personal note AND REQUEST FINGERPRINT)
 * @param collectionRidesDeliveryData: rides and deliveries collection
 * Responsible for confirming the drop off of a ride EXCLUSIVELY for the riders.
 * Tasks:
 * 1. Mark as arrived to destination.
 * 2. Mark as confirmed from the rider side
 * 3. Assign the rating
 * 4. Assign compliments (if any)
 * 5. Assign custom note (if any)
 * //Reinforce all drop off vars in case
 */
function confirmDropoff_fromRider_side(
  dropOffMeta_bundle,
  collectionRidesDeliveryData,
  resolve
) {
  resolveDate();

  let retrieveTrip = {
    client_id: dropOffMeta_bundle.user_fingerprint,
    request_fp: dropOffMeta_bundle.request_fp,
  };
  //Updatedd data
  let dropOffDataUpdate = {
    $set: {
      isArrivedToDestination: true,
      date_dropoff: chaineDateUTC,
      ride_state_vars: {
        isAccepted: true,
        inRideToDestination: true,
        isRideCompleted_driverSide: true,
        isRideCompleted_riderSide: true,
        rider_driverRating: dropOffMeta_bundle.rating_score,
        rating_compliment: dropOffMeta_bundle.dropoff_compliments,
        rating_personal_note: dropOffMeta_bundle.dropoff_personal_note,
      },
    },
  };
  //..
  collectionRidesDeliveryData.updateOne(
    retrieveTrip,
    dropOffDataUpdate,
    function (err, result) {
      if (err) {
        resolve({ response: "error" });
      }
      //..
      resolve({ response: "successfully_confirmed" });
    }
  );
}

/**
 * @func cancelRider_request
 * @param resolve
 * @param collectionRidesDeliveryData: list of all the rides/delivery requests
 * @param collection_cancelledRidesDeliveryData: list of all the cancelledd rides/delivery requests.
 * @param requestBundle_data: object containing the request fp and the rider's fp
 * Responsible for cancelling requests for riders and all the related processes.
 */
function cancelRider_request(
  requestBundle_data,
  collectionRidesDeliveryData,
  collection_cancelledRidesDeliveryData,
  resolve
) {
  resolveDate();
  //Get the request first, if empty - error (very strange), if got something - migrate to the cancelled collection
  //AND delete from the active requests collection.
  let checkRequest = {
    client_id: requestBundle_data.user_fingerprint,
    request_fp: requestBundle_data.request_fp,
  };
  //Get data
  collectionRidesDeliveryData
    .find(checkRequest)
    .toArray(function (err, requestData) {
      if (err) {
        resolve({ response: "error_cancelling" });
      }
      //...
      if (requestData.length > 0) {
        //Found something
        //Add the deleted date
        requestData[0].date_deleted = chaineDateUTC;
        //Save in the cancelled collection
        collection_cancelledRidesDeliveryData.insertOne(
          requestData[0],
          function (err2, result) {
            if (err2) {
              resolve({ response: "error_cancelling" });
            }
            //...
            //Remove from the active collection!!!!
            collectionRidesDeliveryData.deleteOne(
              checkRequest,
              function (err3, result) {
                if (err3) {
                  resolve({ response: "error_cancelling" });
                }
                //...DONE
                resolve({ response: "successully_cancelled" });
              }
            );
          }
        );
      } //No records found of the request - very strange -error
      else {
        resolve({ response: "error_cancelling" });
      }
    });
}

/**
 * @func declineRequest_driver
 * Responsible for declining any requests from the driver side, thus placing the corresponding driver's fingerprint
 * on the "intentional_request_decline" array making him/her unable to ever see the request again.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param resolve
 */
function declineRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  resolve
) {
  resolveDate();
  //Only decline if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: bundleWorkingData.driver_fingerprint,
    })
    .toArray(function (err, result) {
      if (err) {
        resolve({ response: "unable_to_decline_request_error" });
      }
      //...
      if (result.length <= 0) {
        //Wasn't accepted by this driver - proceed to the declining
        //Save the declining event
        new Promise((res) => {
          collectionGlobalEvents.insertOne({
            event_name: "driver_declining_request",
            request_fp: bundleWorkingData.request_fp,
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: chaineDateUTC,
          });
        }).then(
          () => {},
          () => {}
        );
        //...Get the request
        collectionRidesDeliveryData
          .find({ request_fp: bundleWorkingData.request_fp })
          .toArray(function (err, trueRequest) {
            if (err) {
              resolve({ response: "unable_to_decline_request_error" });
            }
            //...
            if (trueRequest.length > 0) {
              //Request still exists - proceed
              let oldItDeclineList =
                trueRequest.intentional_request_decline !== undefined &&
                trueRequest.intentional_request_decline !== null
                  ? trueRequest.intentional_request_decline
                  : [];
              //Update the old list
              oldItDeclineList.push(bundleWorkingData.driver_fingerprint);
              //..
              collectionRidesDeliveryData.updateOne(
                { request_fp: bundleWorkingData.request_fp },
                { $set: { intentional_request_decline: oldItDeclineList } },
                function (err, res) {
                  if (err) {
                    resolve({ response: "unable_to_decline_request_error" });
                  }
                  //DONE
                  resolve({ response: "successfully_declined" });
                }
              );
            } //Request not existing anymore - error
            else {
              resolve({ response: "unable_to_decline_request_error_notExist" });
            }
          });
      } //Ride accepted by this driver previously - abort the declining
      else {
        resolve({ response: "unable_to_decline_request_prev_accepted" });
      }
    });
}

/**
 * @func acceptRequest_driver
 * Responsible for accepting any request from the driver app, If and only if the request was not declined by the driver and if it's
 * not already accepted by another driver.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param resolve
 */
function acceptRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  resolve
) {
  resolveDate();
  //Only decline if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: false,
      intentional_request_decline: {
        $not: { $regex: bundleWorkingData.driver_fingerprint },
      },
    })
    .toArray(function (err, result) {
      if (err) {
        resolve({ response: "unable_to_accept_request_error" });
      }
      //...
      if (result.length > 0) {
        //Wasn't accepted by a driver yet - proceed to the accepting
        //Save the accepting event
        new Promise((res) => {
          collectionGlobalEvents.insertOne({
            event_name: "driver_accepting_request",
            request_fp: bundleWorkingData.request_fp,
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: chaineDateUTC,
          });
        }).then(
          () => {},
          () => {}
        );
        //Update the true request
        collectionRidesDeliveryData.updateOne(
          {
            request_fp: bundleWorkingData.request_fp,
            taxi_id: false,
            intentional_request_decline: {
              $not: { $regex: bundleWorkingData.driver_fingerprint },
            },
          },
          {
            $set: {
              taxi_id: bundleWorkingData.driver_fingerprint,
              "ride_state_vars.isAccepted": true,
            },
          },
          function (err, res) {
            if (err) {
              resolve({ response: "unable_to_accept_request_error" });
            }
            //DONE
            resolve({ response: "successfully_accepted" });
          }
        );
      } //abort the accepting
      else {
        resolve({ response: "unable_to_accept_request_already_taken" });
      }
    });
}

/**
 * @func cancelRequest_driver
 * Responsible for cancelling any request from the driver app, If and only if the request was accepted by the driver who's requesting for the cancellation.
 * @param collectionRidesDeliveryData: list of all the requests made.
 * @param collectionGlobalEvents: hold all the random events that happened somewhere.
 * @param bundleWorkingData: contains the driver_fp and the request_fp.
 * @param resolve
 */
function cancelRequest_driver(
  bundleWorkingData,
  collectionRidesDeliveryData,
  collectionGlobalEvents,
  resolve
) {
  resolveDate();
  //Only decline if not yet accepted by the driver
  collectionRidesDeliveryData
    .find({
      request_fp: bundleWorkingData.request_fp,
      taxi_id: bundleWorkingData.driver_fingerprint,
    })
    .toArray(function (err, result) {
      if (err) {
        resolve({ response: "unable_to_cancel_request_error" });
      }
      //...
      if (result.length > 0) {
        //The driver requesting for the cancellation is the one who's currently associated to the request - proceed to the cancellation
        //Save the cancellation event
        new Promise((res) => {
          collectionGlobalEvents.insertOne({
            event_name: "driver_cancelling_request",
            request_fp: bundleWorkingData.request_fp,
            driver_fingerprint: bundleWorkingData.driver_fingerprint,
            date: chaineDateUTC,
          });
        }).then(
          () => {},
          () => {}
        );
        //Update the true request
        collectionRidesDeliveryData.updateOne(
          {
            request_fp: bundleWorkingData.request_fp,
            taxi_id: bundleWorkingData.driver_fingerprint,
          },
          {
            $set: {
              taxi_id: false,
              "ride_state_vars.isAccepted": false,
            },
          },
          function (err, res) {
            if (err) {
              resolve({ response: "unable_to_cancel_request_error" });
            }
            //DONE
            resolve({ response: "successfully_cancelled" });
          }
        );
      } //abort the cancelling
      else {
        resolve({ response: "unable_to_cancel_request_not_owned" });
      }
    });
}

/**
 * MAIN
 */

clientMongo.connect(function (err) {
  //if (err) throw err;
  console.log("[+] Dispatch services active.");
  const dbMongo = clientMongo.db(process.env.DB_NAME_MONGODDB);
  const collectionRidesDeliveryData = dbMongo.collection(
    "rides_deliveries_requests"
  ); //Hold all the requests made (rides and deliveries)
  const collection_cancelledRidesDeliveryData = dbMongo.collection(
    "cancelled_rides_deliveries_requests"
  ); //Hold all the cancelled requests made (rides and deliveries)
  const collectionRelativeDistances = dbMongo.collection(
    "relative_distances_riders_drivers"
  ); //Hold the relative distances between rider and the drivers (online, same city, same country) at any given time
  const collectionRidersLocation_log = dbMongo.collection(
    "historical_positioning_logs"
  ); //Hold all the location updated from the rider
  const collectionDrivers_profiles = dbMongo.collection("drivers_profiles"); //Hold all the drivers profiles
  const collectionGlobalEvents = dbMongo.collection("global_events"); //Hold all the random events that happened somewhere.
  //-------------
  const bodyParser = require("body-parser");
  app
    .get("/", function (req, res) {
      res.send("Dispatch services up");
    })
    .use(bodyParser.json())
    .use(bodyParser.urlencoded({ extended: true }));

  /**
   * RIDES OR DELIVERY DISPATCHER
   * Responsible for sending staged ride or delivery requests to the drivers in the best position
   * of accepting it.
   * @param requestRawData: ride or delivery data coming from the rider's device for booking (MUST contain the city and country)
   */
  app.post("/dispatchRidesOrDeliveryRequests", function (req, res) {
    req = req.body;
    //TEST DATA
    /*let testData = {
      actualRider: "someonelese",
      actualRiderPhone_number: "0817563369",
      carTypeSelected: "comfortNormalRide",
      connectType: "ConnectUs",
      country: "Namibia",
      destinationData: {
        passenger1Destination: {
          _id: "5f7e16126661813ab09e417f",
          averageGeo: -10.989369499999999,
          city: "Windhoek",
          coordinates: [-22.548558, 17.0504368],
          country: "Namibia",
          location_id: 242368923,
          location_name: "Grove Khomasdal Funky Town - Pequena Angola",
          query: "Grovr",
          state: "Khomas",
          street: false,
        },
        passenger2Destination: {
          _id: "5fc8dde588e09715d0df05ca",
          averageGeo: -5.491276299999999,
          city: "Windhoek",
          coordinates: [-22.5818168, 17.0878857],
          country: "Namibia",
          location_id: 1768699533,
          location_name: "Showground Parking Area",
          query: "Showg",
          state: "Khomas",
          street: "Jan Jonker Weg",
        },
        passenger3Destination: {
          _id: "5f7de487c6811253c83529b3",
          averageGeo: -10.975441900000003,
          city: "Windhoek",
          coordinates: [-22.56578, 17.0751551],
          country: "Namibia",
          location_id: 244132971,
          location_name: "NUST Main St",
          query: "Nust",
          state: "Khomas",
          street: false,
        },
        passenger4Destination: {
          _id: "5f7de491c6811253c83529f6",
          averageGeo: -11.1064516,
          city: "Windhoek",
          coordinates: [-22.6121691, 17.0233537],
          country: "Namibia",
          location_id: 6520901,
          location_name: "University of Namibia (UNAM)",
          query: "Unam",
          state: "Khomas",
          street: "Mandume Ndemufayo Avenue",
        },
      },
      fareAmount: 280,
      isAllGoingToSameDestination: false,
      naturePickup: "PrivateLocation",
      passengersNo: 4,
      pickupData: {
        city: "Windhoek",
        coordinates: [-22.5705005, 17.0809437],
        location_name: "Embassy of Brazil in Windhoek",
        street_name: "Simeon Shixungileni Steet",
      },
      pickupNote: "Hello world",
      receiverName_delivery: false,
      receiverPhone_delivery: false,
      rideType: "RIDE",
      timeScheduled: "now",
      paymentMethod: "CASH",
      user_fingerprint: "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
    };
    req = testData;*/
    //...
    if (req.user_fingerprint !== undefined && req.user_fingerprint !== null) {
      //1. CHECK THAT THIS RIDER DOESN'T ALREADY HAVE AN ACTIVE RIDE/DELIVERY
      //Request is considered as completed when the rider has submited a rating.
      let checkPrevRequest = {
        client_id: req.user_fingerprint,
        "ride_state_vars.isRideCompleted_riderSide": false,
      };
      collectionRidesDeliveryData
        .find(checkPrevRequest)
        .toArray(function (err, prevRequest) {
          if (prevRequest.length === 0) {
            prevRequest = prevRequest[0];
            //No previous pending request - MAKE REQUEST VALID
            //Parse the data
            new Promise((res) => {
              parseRequestData(req, res);
            }).then(
              (result) => {
                if (result !== false) {
                  console.log(result);
                  //Save the request in mongodb
                  collectionRidesDeliveryData.insertOne(
                    result,
                    function (err, requestDt) {
                      if (err) {
                        res.send({ response: "Unable_to_make_the_request" });
                      }

                      //2. INITIATE STAGED toDrivers DISPATCH
                      new Promise((resStaged) => {
                        //FORM THE REQUEST SNAPSHOT
                        let snapshotTripInfos = {
                          user_fingerprint: result.client_id,
                          city: result.pickup_location_infos.city,
                          country: result.country,
                          ride_type: result.ride_mode,
                          vehicle_type: result.carTypeSelected,
                          org_latitude:
                            result.pickup_location_infos.coordinates.latitude,
                          org_longitude:
                            result.pickup_location_infos.coordinates.longitude,
                          request_fp: result.request_fp,
                          pickup_suburb: result.pickup_location_infos.suburb,
                          destination_suburb: result.destinationData[0].suburb,
                          fare: result.fare,
                        };
                        intitiateStagedDispatch(
                          snapshotTripInfos,
                          collectionDrivers_profiles,
                          collectionRidesDeliveryData,
                          resStaged
                        );
                      }).then(
                        (result) => {
                          console.log(result);
                        },
                        (error) => {
                          console.log(error);
                        }
                      );

                      //..Success - respond to the user
                      res.send({ response: "successfully_requested" });
                    }
                  );
                } //Error
                else {
                  res.send({ response: "Unable_to_make_the_request" });
                }
              },
              (error) => {
                console.log(error);
                res.send({ response: "Unable_to_make_the_request" });
              }
            );
          } //Has a previous uncompleted ride
          else {
            res.send({ response: "already_have_a_pending_request" });
          }
        });
    } //Invalid user fp
    else {
      res.send({ response: "Unable_to_make_the_request" });
    }
  });

  /**
   * CONFIRM RIDER DROP OFF
   * Responsible for handling all the processes related to the drop off confirmation of a rider.
   */
  app.post("/confirmRiderDropoff_requests", function (req, res) {
    req = req.body;
    console.log(req);
    //TEST data
    /*req = {
      user_fingerprint:
        "7c57cb6c9471fd33fd265d5441f253eced2a6307c0207dea57c987035b496e6e8dfa7105b86915da",
      dropoff_compliments: {
        neatAndTidy: false,
        excellentService: true,
        greatMusic: false,
        greatConversation: false,
        expertNavigator: true,
      },
      dropoff_personal_note: "Very good experience",
      rating_score: 5,
      request_fp:
        "87109d03cab8bc5032a71683e084551107f1c1bafb5136f6ee5a7c990550b81ef3ecf5c96b13f2afde2cc75e6c8187ce290c973dd1e8d137caf27fee334a68e8",
    };*/

    //Do basic checking
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      //Auto assign 5 stars if invalid score found
      req.rating_score =
        req.rating_score === undefined ||
        req.rating_score === null ||
        req.rating_score < 0
          ? 5
          : req.rating_score > 5
          ? 2
          : req.rating_score; //Driver's rating safety shield - give 2 stars for fraudulous dropoffs
      //...
      new Promise((res0) => {
        confirmDropoff_fromRider_side(req, collectionRidesDeliveryData, res0);
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({ response: "error" });
        }
      );
    }
  });

  /**
   * CANCEL RIDER REQUESTS
   * Responsible for cancelling the rider's requests and all it's the related process
   */
  app.post("/cancelRiders_request", function (req, res) {
    req = req.body;
    console.log(req);

    //Do basic checking
    if (
      req.user_fingerprint !== undefined &&
      req.user_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      //...
      new Promise((res0) => {
        cancelRider_request(
          req,
          collectionRidesDeliveryData,
          collection_cancelledRidesDeliveryData,
          res0
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({ response: "error_cancelling" });
        }
      );
    }
  });

  /**
   * DECLINE REQUESTS - DRIVERS
   * Responsible for handling the declining of requests from the drivers side.
   */
  app.post("/decline_request", function (req, res) {
    //DEBUG
    /*req.body = {
      driver_fingerprint:
        "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
      request_fp:
        "999999f5c51c380ef9dee9680872a6538cc9708ef079a8e42de4d762bfa7d49efdcde41c6009cbdd9cdf6f0ae0544f74cb52caa84439cbcda40ce264f90825e8",
    };*/
    //...
    req = req.body;
    console.log(req);

    //Do basic checking
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      //...
      new Promise((res0) => {
        declineRequest_driver(
          req,
          collectionRidesDeliveryData,
          collectionGlobalEvents,
          res0
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({ response: "unable_to_decline_request_error" });
        }
      );
    }
  });

  /**
   * ACCEPT REQUESTS - DRIVERS
   * Responsible for handling the accepting of requests from the drivers side.
   */
  app.post("/accept_request", function (req, res) {
    //DEBUG
    /*req.body = {
      driver_fingerprint:
        "23c9d088e03653169b9c18193a0b8dd329ea1e43eb0626ef9f16b5b979694a429710561a3cb3ddae",
      request_fp:
        "999999f5c51c380ef9dee9680872a6538cc9708ef079a8e42de4d762bfa7d49efdcde41c6009cbdd9cdf6f0ae0544f74cb52caa84439cbcda40ce264f90825e8",
    };*/
    //...
    req = req.body;
    console.log(req);

    //Do basic checking
    if (
      req.driver_fingerprint !== undefined &&
      req.driver_fingerprint !== null &&
      req.request_fp !== undefined &&
      req.request_fp !== null
    ) {
      //...
      new Promise((res0) => {
        acceptRequest_driver(
          req,
          collectionRidesDeliveryData,
          collectionGlobalEvents,
          res0
        );
      }).then(
        (result) => {
          res.send(result);
        },
        (error) => {
          console.log(error);
          res.send({ response: "unable_to_accept_request_error" });
        }
      );
    }
  });
});

server.listen(process.env.DISPATCH_SERVICE_PORT);
